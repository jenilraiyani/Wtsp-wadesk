const fs = require('fs');
const path = require('path');
const mime = require('mime');
const { getActiveRulesForDevice, addAutomationLog, getUsedAttachmentNames } = require('../models/automationModel');
const { resolveChatIdentity, extractMessageContent, sendTextReply, resolveReplyJid } = require('../utils/chat');
const { applyTemplate } = require('../utils/personalize');
const { UPLOADS_PATH } = require('../utils/paths');

// Subfolder of uploads: the hourly upload cleanup only deletes top-level files, so rule files stay.
const AUTOMATION_FILES_PATH = path.join(UPLOADS_PATH, 'automation');
const ALLOWED_FILE_TYPES = /^(image\/|video\/|application\/pdf$)/;
const UNUSED_FILE_GRACE_MS = 60 * 60 * 1000;

const RULE_CACHE_MS = 30 * 1000;
const MAX_MESSAGE_AGE_MS = 2 * 60 * 1000;
// Stops two bots (or a customer spamming "hi") from triggering endless replies.
const CHAT_COOLDOWN_MS = 10 * 1000;
const MENU_TTL_MS = 30 * 60 * 1000;

const ruleCache = new Map();
const lastReplyAt = new Map();
const handledIds = new Set();
// Chats that were sent an options menu and may now answer with a number or option name.
const pendingMenus = new Map();

const normalize = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();

const invalidateRules = (deviceId) => {
    if (deviceId) ruleCache.delete(String(deviceId));
    else ruleCache.clear();
};

const getRules = async (deviceId) => {
    const cached = ruleCache.get(deviceId);
    if (cached && Date.now() - cached.at < RULE_CACHE_MS) return cached.rules;
    const rules = await getActiveRulesForDevice(deviceId);
    ruleCache.set(deviceId, { at: Date.now(), rules });
    return rules;
};

const matchKeyword = (rule, text) => {
    const incoming = normalize(text);
    if (!incoming) return null;
    for (const keyword of rule.keywords) {
        const needle = normalize(keyword);
        if (!needle) continue;
        if (rule.matchType === 'exact' && incoming === needle) return keyword;
        if (rule.matchType === 'starts_with' && incoming.startsWith(needle)) return keyword;
        if (rule.matchType === 'contains' && incoming.includes(needle)) return keyword;
    }
    return null;
};

// Working hours are entered in Indian time, whatever timezone the server runs in.
const WORKING_HOURS_TIMEZONE = 'Asia/Kolkata';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const localClock = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: WORKING_HOURS_TIMEZONE,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    return { day: WEEKDAYS.indexOf(get('weekday')), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
};

const toMinutes = (time) => {
    const [hours, minutes] = String(time).split(':').map(Number);
    return hours * 60 + minutes;
};

const isWithinWorkingHours = (hours, date = new Date()) => {
    if (!hours?.enabled) return true;
    const { day, minutes } = localClock(date);
    const start = toMinutes(hours.start);
    const end = toMinutes(hours.end);
    if (start < end) return hours.days.includes(day) && minutes >= start && minutes < end;
    // Overnight range such as 22:00-06:00: the early-morning part belongs to the previous day.
    if (minutes >= start) return hours.days.includes(day);
    if (minutes < end) return hours.days.includes((day + 6) % 7);
    return false;
};

const findMatchingRule = (rules, text) => {
    for (const rule of rules) {
        const keyword = matchKeyword(rule, text);
        if (!keyword) continue;
        if (isWithinWorkingHours(rule.workingHours)) return { rule, keyword, open: true };
        if (rule.workingHours?.offReply) return { rule, keyword, open: false };
    }
    return null;
};

const buildMenuText = (text, options) => {
    if (!options?.length) return text;
    const lines = options.map((option, index) => `${index + 1}. ${option.label}`);
    const menu = `${lines.join('\n')}\n\nReply with the number or name.`;
    return text ? `${text}\n\n${menu}` : menu;
};

const matchOption = (options, text) => {
    const incoming = normalize(text).replace(/[.)\s]+$/, '');
    if (!incoming) return null;
    if (/^\d+$/.test(incoming)) {
        const index = Number(incoming) - 1;
        return options[index] || null;
    }
    return options.find((option) => normalize(option.label) === incoming) || null;
};

const getPendingMenu = (key) => {
    const menu = pendingMenus.get(key);
    if (!menu) return null;
    if (Date.now() - menu.at > MENU_TTL_MS) {
        pendingMenus.delete(key);
        return null;
    }
    return menu;
};

const saveAutomationFile = ({ filename, mimeType, dataBase64 }) => {
    const type = String(mimeType || mime.getType(filename || '') || '');
    if (!ALLOWED_FILE_TYPES.test(type)) throw new Error('Only image, video or PDF files are allowed.');
    if (!fs.existsSync(AUTOMATION_FILES_PATH)) fs.mkdirSync(AUTOMATION_FILES_PATH, { recursive: true });
    const safeName = `${Date.now()}_${path.basename(String(filename)).replace(/[^a-zA-Z0-9._-]/g, '_')}`.slice(0, 200);
    fs.writeFileSync(path.join(AUTOMATION_FILES_PATH, safeName), Buffer.from(dataBase64, 'base64'));
    return { attachmentName: safeName, mimeType: type };
};

const displayFileName = (attachmentName) => String(attachmentName).replace(/^\d+_/, '');

const buildMediaContent = (attachmentName, caption) => {
    const filePath = path.join(AUTOMATION_FILES_PATH, path.basename(attachmentName));
    if (!fs.existsSync(filePath)) throw new Error(`Attachment file not found: ${attachmentName}`);
    const buffer = fs.readFileSync(filePath);
    const mimetype = mime.getType(filePath) || 'application/octet-stream';
    const extra = caption ? { caption } : {};
    if (mimetype.startsWith('image/')) return { image: buffer, mimetype, ...extra };
    if (mimetype.startsWith('video/')) return { video: buffer, mimetype, ...extra };
    return { document: buffer, mimetype, fileName: displayFileName(attachmentName), ...extra };
};

const cleanupUnusedFiles = async () => {
    if (!fs.existsSync(AUTOMATION_FILES_PATH)) return;
    const used = await getUsedAttachmentNames();
    const now = Date.now();
    for (const file of fs.readdirSync(AUTOMATION_FILES_PATH)) {
        if (used.has(file)) continue;
        const filePath = path.join(AUTOMATION_FILES_PATH, file);
        try {
            const stats = fs.statSync(filePath);
            if (stats.isFile() && now - stats.mtimeMs > UNUSED_FILE_GRACE_MS) fs.unlinkSync(filePath);
        } catch (error) {
            console.warn(`Could not remove automation file ${file}:`, error.message);
        }
    }
};

const sendAutoReply = async ({ deviceId, identity, text, attachmentName, logBase }) => {
    const replyText = attachmentName ? `[File: ${displayFileName(attachmentName)}]${text ? ` ${text}` : ''}` : text;
    try {
        const { getConnectedSession } = require('./sessionService');
        const session = getConnectedSession(deviceId);
        if (!session) throw new Error(`Device ${deviceId} is not connected.`);
        if (attachmentName) {
            const sock = session?.sock || session?.client?._sock;
            if (!sock?.sendMessage) throw new Error('Device socket is not ready.');
            const content = buildMediaContent(attachmentName, text);
            const jid = await resolveReplyJid(session, {
                deviceId,
                chatId: identity.chatId,
                remoteJid: identity.remoteJid
            });
            await sock.sendMessage(jid, content);
        } else {
            await sendTextReply(session, {
                deviceId,
                chatId: identity.chatId,
                remoteJid: identity.remoteJid,
                text
            });
        }
        await addAutomationLog({ ...logBase, replyText, status: 'success' });
        return true;
    } catch (error) {
        console.warn(`Auto reply failed for ${deviceId}:`, error.message);
        await addAutomationLog({ ...logBase, replyText, status: 'failed', errorMessage: error.message }).catch(() => {});
        return false;
    }
};

const rememberHandled = (id) => {
    handledIds.add(id);
    if (handledIds.size > 2000) {
        const first = handledIds.values().next().value;
        handledIds.delete(first);
    }
};

const handleIncomingMessage = async (deviceId, msg, { type } = {}) => {
    if (type && type !== 'notify') return;
    if (!msg?.key || msg.key.fromMe) return;

    const ts = Number(msg.messageTimestamp) * 1000;
    if (ts && Date.now() - ts > MAX_MESSAGE_AGE_MS) return;

    const messageKey = `${deviceId}:${msg.key.id}`;
    if (msg.key.id) {
        if (handledIds.has(messageKey)) return;
        rememberHandled(messageKey);
    }

    const identity = resolveChatIdentity(msg);
    if (!identity) return;
    const content = extractMessageContent(msg);
    if (!content || content.type !== 'text' || !content.body) return;

    const contactName = msg.pushName || '';
    const chatKey = `${deviceId}:${identity.chatId}`;
    const baseVars = { name: contactName, phone: identity.chatId, message: content.body };

    const rules = await getRules(String(deviceId));

    const menu = getPendingMenu(chatKey);
    const menuRule = menu && rules.find((rule) => rule.id === menu.ruleId);
    if (menu && !menuRule?.options?.length) pendingMenus.delete(chatKey);
    if (menuRule?.options?.length) {
        const option = matchOption(menuRule.options, content.body);
        if (option) {
            pendingMenus.delete(chatKey);
            const text = applyTemplate(option.reply, { ...(menuRule.variables || {}), ...baseVars, option: option.label });
            await sendAutoReply({
                deviceId,
                identity,
                text,
                attachmentName: option.attachmentName,
                logBase: {
                    ruleId: menuRule.id,
                    ruleName: menuRule.name,
                    deviceId,
                    chatId: identity.chatId,
                    contactName,
                    incomingText: content.body,
                    matchedKeyword: `Option: ${option.label}`
                }
            });
            return;
        }
    }

    if (!rules.length) return;

    const match = findMatchingRule(rules, content.body);
    if (!match) return;

    const last = lastReplyAt.get(chatKey) || 0;
    if (Date.now() - last < CHAT_COOLDOWN_MS) return;
    lastReplyAt.set(chatKey, Date.now());

    const variables = match.rule.variables || {};
    const options = match.open ? (match.rule.options || []) : [];
    const text = match.open
        ? buildMenuText(applyTemplate(match.rule.replyMessage, { ...variables, ...baseVars }), options)
        : applyTemplate(match.rule.workingHours.offReply, { ...variables, ...baseVars });

    const sent = await sendAutoReply({
        deviceId,
        identity,
        text,
        attachmentName: match.open ? match.rule.attachmentName : '',
        logBase: {
            ruleId: match.rule.id,
            ruleName: match.rule.name,
            deviceId,
            chatId: identity.chatId,
            contactName,
            incomingText: content.body,
            matchedKeyword: match.open ? match.keyword : `${match.keyword} (outside working hours)`
        }
    });

    if (sent && options.length) {
        pendingMenus.set(chatKey, { ruleId: match.rule.id, at: Date.now() });
    } else {
        pendingMenus.delete(chatKey);
    }
};

module.exports = {
    handleIncomingMessage,
    invalidateRules,
    matchKeyword,
    isWithinWorkingHours,
    saveAutomationFile,
    cleanupUnusedFiles
};
