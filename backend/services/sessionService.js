const fs = require('fs');
const path = require('path');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const pino = require('pino');
const { AUTH_DATA_PATH } = require('../utils/paths');
const { addToRegistry } = require('../models/deviceModel');
const { normalizePhoneNumber } = require('../utils/helpers');

const sessions = {};
const logger = pino({ level: 'silent' });
const recoverTimers = {};
const forgottenDevices = new Set();
const recoverAttempts = {};
const sessionCreateLocks = new Set();

let baileysLib = null;

const loadBaileys = async () => {
    if (baileysLib) return baileysLib;

    let mod;
    try {
        mod = require('@whiskeysockets/baileys');
    } catch {
        mod = await import('@whiskeysockets/baileys');
    }

    const makeWASocket = typeof mod.default === 'function'
        ? mod.default
        : (mod.makeWASocket || mod.default?.makeWASocket || mod.default);
    const useMultiFileAuthState = mod.useMultiFileAuthState || mod.default?.useMultiFileAuthState;
    const DisconnectReason = mod.DisconnectReason || mod.default?.DisconnectReason || {};
    const fetchLatestBaileysVersion = mod.fetchLatestBaileysVersion || mod.default?.fetchLatestBaileysVersion;
    const Browsers = mod.Browsers || mod.default?.Browsers;

    if (typeof makeWASocket !== 'function' || typeof useMultiFileAuthState !== 'function') {
        throw new Error('Failed to load @whiskeysockets/baileys');
    }

    baileysLib = { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers };
    return baileysLib;
};

const toJid = (chatId) => {
    const raw = String(chatId || '')
        .replace(/@c\.us$/i, '')
        .replace(/@s\.whatsapp\.net$/i, '')
        .replace(/\D/g, '');
    return `${raw}@s.whatsapp.net`;
};

const mediaPayload = (media, caption) => {
    const buffer = Buffer.from(media.data, 'base64');
    const mimetype = media.mimetype || 'application/octet-stream';
    const fileName = media.filename || 'file';

    if (mimetype.startsWith('image/')) {
        return { image: buffer, mimetype, caption, fileName };
    }
    if (mimetype.startsWith('video/')) {
        return { video: buffer, mimetype, caption, fileName };
    }
    if (mimetype.startsWith('audio/')) {
        return { audio: buffer, mimetype };
    }
    return { document: buffer, mimetype, fileName, caption };
};

const clearRecoverTimer = (deviceId) => {
    if (recoverTimers[deviceId]) {
        clearTimeout(recoverTimers[deviceId]);
        delete recoverTimers[deviceId];
    }
};

const forgetDevice = (deviceId) => {
    forgottenDevices.add(String(deviceId));
    clearRecoverTimer(deviceId);
};

const rememberDevice = (deviceId) => {
    forgottenDevices.delete(String(deviceId));
};

const isDeviceForgotten = (deviceId) => forgottenDevices.has(String(deviceId));

const wrapBaileysClient = (deviceId, sock) => ({
    _sock: sock,
    get pupBrowser() {
        return {
            newPage: async () => {
                const session = sessions[deviceId];
                if (!session) throw new Error('Session was removed.');
                if (!session.puppeteerBrowser) {
                    const puppeteer = require('puppeteer');
                    const { getPuppeteerConfig, ensureBrowserReady } = require('./browserService');
                    await ensureBrowserReady();
                    session.puppeteerBrowser = await puppeteer.launch(getPuppeteerConfig());
                }
                return session.puppeteerBrowser.newPage();
            }
        };
    },
    async sendMessage(chatId, content, options = {}) {
        const jid = toJid(chatId);
        if (typeof content === 'string') {
            return sock.sendMessage(jid, { text: content });
        }
        if (content && content.data) {
            return sock.sendMessage(jid, mediaPayload(content, options.caption));
        }
        throw new Error('Unsupported message payload');
    },
    async getChatById(chatId) {
        const client = sessions[deviceId]?.client;
        return {
            sendMessage: (content, options) => client.sendMessage(chatId, content, options)
        };
    },
    async requestPairingCode(number) {
        const phone = String(number || '').replace(/\D/g, '');
        return sock.requestPairingCode(phone);
    },
    async isRegisteredUser(chatId) {
        const raw = String(chatId || '')
            .replace(/@c\.us$/i, '')
            .replace(/@s\.whatsapp\.net$/i, '')
            .replace(/\D/g, '');
        const result = await sock.onWhatsApp(raw);
        return Boolean(result?.[0]?.exists);
    },
    async logout() {
        await sock.logout();
    },
    async destroy() {
        try {
            sock.end(undefined);
        } catch {
            // already closed
        }
    },
    removeAllListeners() {
        try {
            sock.ev.removeAllListeners();
        } catch {
            // ignore
        }
    }
});

const removeDeviceAuthFolder = (deviceId) => {
    const sessionDir = path.join(AUTH_DATA_PATH, `session-${deviceId}`);
    try {
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
            console.log(`Removed auth folder for ${deviceId}`);
        }
    } catch (error) {
        console.error(`Failed to remove auth folder for ${deviceId}:`, error.message);
    }
};

const destroySession = async (deviceId, { removeAuth = true, logout = true } = {}) => {
    clearRecoverTimer(deviceId);
    const session = sessions[deviceId];
    const client = session?.client;
    const puppeteerBrowser = session?.puppeteerBrowser;
    delete sessions[deviceId];

    if (puppeteerBrowser) {
        try {
            await puppeteerBrowser.close();
        } catch (error) {
            console.warn(`Puppeteer close warning for ${deviceId}:`, error.message);
        }
    }

    if (client) {
        try {
            client.removeAllListeners();
            if (logout) {
                try {
                    await Promise.race([
                        client.logout(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('logout timeout')), 4000))
                    ]);
                } catch (logoutError) {
                    console.warn(`Logout warning for ${deviceId}:`, logoutError.message);
                }
            }
            await client.destroy();
        } catch (error) {
            console.error(`Error destroying client ${deviceId}:`, error.message);
        }
    }

    if (removeAuth) {
        removeDeviceAuthFolder(deviceId);
    }
};

const bindClientEvents = (deviceId, sock, DisconnectReason) => {
    const isCurrentClient = () => sessions[deviceId]?.sock === sock;

    sock.ev.on('connection.update', async (update) => {
        if (!isCurrentClient()) return;

        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log(`QR generated for ${deviceId}`);
            sessions[deviceId].qr = qr;
            sessions[deviceId].error = null;
            qrcodeTerminal.generate(qr, { small: true });

            try {
                sessions[deviceId].qrImage = await QRCode.toDataURL(qr, { width: 220, margin: 1 });
                if (!isCurrentClient()) return;
                sessions[deviceId].status = 'WAITING_FOR_QR';
            } catch (err) {
                console.error(`Failed to build QR image for ${deviceId}:`, err.message);
                if (!isCurrentClient()) return;
                sessions[deviceId].qrImage = null;
                sessions[deviceId].status = 'WAITING_FOR_QR';
            }
        }

        if (connection === 'connecting') {
            if (sessions[deviceId].status === 'WAITING_FOR_QR' || sessions[deviceId].status === 'INITIALIZING') {
                if (!sessions[deviceId].qr) {
                    sessions[deviceId].status = 'CONNECTING';
                }
            }
        }

        if (connection === 'open') {
            console.log(`Device ready: ${deviceId}`);
            sessions[deviceId].status = 'CONNECTED';
            sessions[deviceId].qr = null;
            sessions[deviceId].qrImage = null;
            sessions[deviceId].pairingCode = null;
            sessions[deviceId].error = null;
            recoverAttempts[deviceId] = 0;
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const boomMsg = String(lastDisconnect?.error?.message || '');
            const loggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
            const replaced = statusCode === DisconnectReason.connectionReplaced
                || statusCode === 440
                || /conflict/i.test(boomMsg);
            const restartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;
            const badSession = statusCode === DisconnectReason.badSession || statusCode === 500;
            const reason = loggedOut
                ? 'LOGOUT'
                : (replaced ? 'CONFLICT' : (boomMsg || `closed(${statusCode || 'n/a'})`));

            console.log(`Device disconnected ${deviceId}:`, reason, statusCode != null ? `(code ${statusCode})` : '');
            if (!isCurrentClient()) return;
            sessions[deviceId].status = 'DISCONNECTED';
            sessions[deviceId].qr = null;
            sessions[deviceId].qrImage = null;
            sessions[deviceId].pairingCode = null;
            sessions[deviceId].error = `Disconnected: ${reason}`;

            if (loggedOut || badSession) {
                recoverAttempts[deviceId] = 0;
                removeDeviceAuthFolder(deviceId);
                return;
            }

            if (isDeviceForgotten(deviceId)) return;

            // Conflict = another WhatsApp session took the link. Retrying every 15s
            // fights that session forever (connect → conflict → reconnect loop).
            if (replaced) {
                const attempts = (recoverAttempts[deviceId] || 0) + 1;
                recoverAttempts[deviceId] = attempts;
                if (attempts > 2) {
                    console.log(`Stop auto-recover for ${deviceId}: repeated conflict. Use Devices → Reconnect.`);
                    sessions[deviceId].error = 'Disconnected: conflict with another WhatsApp session. Close other linked sessions or use Reconnect.';
                    return;
                }
                const delayMs = 45000 * attempts;
                console.log(`Conflict on ${deviceId}: will retry once in ${Math.round(delayMs / 1000)}s (attempt ${attempts}/2)...`);
                clearRecoverTimer(deviceId);
                recoverTimers[deviceId] = setTimeout(async () => {
                    delete recoverTimers[deviceId];
                    if (isDeviceForgotten(deviceId)) return;
                    if (sessions[deviceId]?.sock !== sock) return;
                    try {
                        const { loadRegistry } = require('../models/deviceModel');
                        const ids = await loadRegistry();
                        if (!ids.includes(deviceId)) return;
                        await destroySession(deviceId, { removeAuth: false, logout: false });
                        await createSession(deviceId);
                    } catch (e) {
                        console.error(`Auto-recovery failed for ${deviceId}:`, e.message);
                    }
                }, delayMs);
                return;
            }

            const attempts = (recoverAttempts[deviceId] || 0) + 1;
            recoverAttempts[deviceId] = attempts;
            if (attempts > 8) {
                console.log(`Stop auto-recover for ${deviceId}: too many disconnects.`);
                sessions[deviceId].error = `Disconnected: ${reason}. Too many retries — use Reconnect.`;
                return;
            }

            const delayMs = restartRequired
                ? 2500
                : Math.min(60000, 5000 * (2 ** Math.min(attempts - 1, 4)));

            console.log(`Attempting to auto-recover device ${deviceId} in ${Math.round(delayMs / 1000)} seconds...`);
            clearRecoverTimer(deviceId);
            recoverTimers[deviceId] = setTimeout(async () => {
                delete recoverTimers[deviceId];
                if (isDeviceForgotten(deviceId)) return;
                if (sessions[deviceId]?.sock !== sock) return;
                try {
                    const { loadRegistry } = require('../models/deviceModel');
                    const ids = await loadRegistry();
                    if (!ids.includes(deviceId)) return;
                    await destroySession(deviceId, { removeAuth: false, logout: false });
                    await createSession(deviceId);
                } catch (e) {
                    console.error(`Auto-recovery failed for ${deviceId}:`, e.message);
                }
            }, delayMs);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (!isCurrentClient() || !Array.isArray(messages) || !messages.length) return;
        const { handleIncomingMessage } = require('./automationService');
        for (const msg of messages) {
            handleIncomingMessage(deviceId, msg, { type }).catch((error) => {
                console.warn(`Automation failed for ${deviceId}:`, error.message);
            });
        }
    });
};

const createSession = async (deviceId, { force = false } = {}) => {
    if (!force && isDeviceForgotten(deviceId)) {
        console.log(`Skip session for removed device ${deviceId}`);
        return;
    }
    if (force) {
        rememberDevice(deviceId);
        recoverAttempts[deviceId] = 0;
    }

    if (sessionCreateLocks.has(deviceId)) {
        console.log(`Session create already in progress for ${deviceId}`);
        return;
    }
    sessionCreateLocks.add(deviceId);

    try {
        // Always close any existing socket first — leftover sockets cause WhatsApp "conflict" loops.
        if (sessions[deviceId]?.sock || sessions[deviceId]?.client) {
            await destroySession(deviceId, { removeAuth: false, logout: false });
        }

        console.log(`Starting session setup for: ${deviceId}`);

        const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await loadBaileys();
        const authDir = path.join(AUTH_DATA_PATH, `session-${deviceId}`);
        fs.mkdirSync(authDir, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        let version;
        try {
            if (typeof fetchLatestBaileysVersion === 'function') {
                const latest = await fetchLatestBaileysVersion();
                version = latest?.version;
            }
        } catch (error) {
            console.warn(`Baileys version lookup failed for ${deviceId}:`, error.message);
        }

        const sock = makeWASocket({
            auth: state,
            version,
            logger,
            printQRInTerminal: false,
            browser: Browsers?.ubuntu ? Browsers.ubuntu('Chrome') : ['WaDesk', 'Chrome', '120.0.0'],
            markOnlineOnConnect: false,
            syncFullHistory: false
        });

        const client = wrapBaileysClient(deviceId, sock);

        sessions[deviceId] = {
            client,
            sock,
            status: 'INITIALIZING',
            qr: null,
            qrImage: null,
            pairingCode: null,
            error: null,
            puppeteerBrowser: null
        };

        await addToRegistry(deviceId);
        bindClientEvents(deviceId, sock, DisconnectReason);
        sock.ev.on('creds.update', saveCreds);
    } finally {
        sessionCreateLocks.delete(deviceId);
    }
};

const mapDevice = (id) => {
    const session = sessions[id];
    if (!session) {
        return {
            id,
            name: id,
            status: 'DISCONNECTED',
            qr: null,
            qrImage: null,
            pairingCode: null,
            error: 'Session not found'
        };
    }

    return {
        id,
        name: id,
        status: session.status,
        qr: session.qr,
        qrImage: session.qrImage,
        pairingCode: session.pairingCode,
        error: session.error
    };
};

const waitForDeviceQr = async (deviceId, { phoneNumber, timeoutMs = 90000 } = {}) => {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const session = sessions[deviceId];
        if (!session) {
            throw new Error('Session was removed before QR was ready.');
        }

        if (session.status === 'DISCONNECTED' && session.error) {
            throw new Error(session.error);
        }

        if (session.status === 'CONNECTED') {
            return session;
        }

        if (session.status === 'WAITING_FOR_QR' && session.qr && session.qrImage) {
            return session;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error('Timeout waiting for QR code. Please try again.');
};

const getConnectedSession = (deviceId) => {
    const session = sessions[deviceId];
    if (!session || session.status !== 'CONNECTED' || !session.client) {
        return null;
    }
    return session;
};

const restoreRegisteredDevices = async () => {
    const { loadRegistry } = require('../models/deviceModel');

    for (const deviceId of await loadRegistry()) {
        if (isDeviceForgotten(deviceId)) continue;
        if (!sessions[deviceId]) {
            await createSession(deviceId);
        }
    }
};

module.exports = {
    sessions,
    createSession,
    destroySession,
    mapDevice,
    waitForDeviceQr,
    getConnectedSession,
    removeDeviceAuthFolder,
    restoreRegisteredDevices,
    forgetDevice,
    rememberDevice,
    isDeviceForgotten
};
