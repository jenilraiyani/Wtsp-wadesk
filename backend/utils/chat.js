const digitsOnly = (value) => String(value || '').replace(/\D/g, '');

const isGroupOrStatus = (jid) => {
    const raw = String(jid || '');
    return !raw || raw.endsWith('@g.us') || raw === 'status@broadcast' || raw.endsWith('@newsletter');
};

const isLidJid = (jid) => {
    const raw = String(jid || '');
    return raw.includes('@lid') || raw.endsWith('@hosted.lid');
};

const isPhoneJid = (jid) => {
    const raw = String(jid || '');
    return raw.includes('@s.whatsapp.net') || raw.endsWith('@c.us');
};

const toSendJid = (jid) => {
    const raw = String(jid || '').trim();
    if (!raw) return '';
    if (isLidJid(raw) || raw.includes('@hosted')) return raw;
    if (raw.endsWith('@c.us')) return raw.replace(/@c\.us$/i, '@s.whatsapp.net');
    if (raw.includes('@s.whatsapp.net')) return raw;
    const phone = digitsOnly(raw);
    return phone ? `${phone}@s.whatsapp.net` : '';
};

/** Prefer phone chat id when available; always keep a sendable remote JID. */
const resolveChatIdentity = (msg) => {
    const remoteJid = String(msg?.key?.remoteJid || '');
    const altJid = String(msg?.key?.remoteJidAlt || '');
    if (isGroupOrStatus(remoteJid)) return null;

    let replyJid = '';
    let chatId = '';

    if (isPhoneJid(remoteJid)) {
        chatId = digitsOnly(remoteJid);
        replyJid = toSendJid(remoteJid);
    } else if (isLidJid(remoteJid)) {
        replyJid = remoteJid;
        if (isPhoneJid(altJid)) {
            chatId = digitsOnly(altJid);
        } else {
            chatId = digitsOnly(remoteJid);
        }
    } else if (isPhoneJid(altJid)) {
        chatId = digitsOnly(altJid);
        replyJid = toSendJid(altJid);
    } else if (remoteJid) {
        chatId = digitsOnly(remoteJid);
        replyJid = toSendJid(remoteJid);
    }

    if (!chatId || chatId.length < 5) return null;
    return { chatId, remoteJid: replyJid || null };
};

const extractMessageContent = (msg) => {
    const m = msg?.message;
    if (!m) return null;
    if (m.protocolMessage || m.reactionMessage || m.senderKeyDistributionMessage) return null;
    if (m.conversation) return { type: 'text', body: m.conversation };
    if (m.extendedTextMessage?.text) return { type: 'text', body: m.extendedTextMessage.text };
    if (m.imageMessage) return { type: 'image', body: m.imageMessage.caption || '[Image]' };
    if (m.videoMessage) return { type: 'video', body: m.videoMessage.caption || '[Video]' };
    if (m.audioMessage || m.pttMessage) return { type: 'audio', body: '[Audio]' };
    if (m.documentMessage) {
        return { type: 'document', body: m.documentMessage.fileName || m.documentMessage.caption || '[Document]' };
    }
    if (m.stickerMessage) return { type: 'sticker', body: '[Sticker]' };
    if (m.contactMessage) return { type: 'contact', body: m.contactMessage.displayName || '[Contact]' };
    if (m.locationMessage) return { type: 'location', body: '[Location]' };
    if (m.buttonsResponseMessage?.selectedDisplayText) {
        return { type: 'text', body: m.buttonsResponseMessage.selectedDisplayText };
    }
    if (m.listResponseMessage?.title) return { type: 'text', body: m.listResponseMessage.title };
    if (m.templateButtonReplyMessage?.selectedDisplayText) {
        return { type: 'text', body: m.templateButtonReplyMessage.selectedDisplayText };
    }    return { type: 'other', body: '[Message]' };
};

const getSocket = (session) => session?.sock || session?.client?._sock;

const resolveReplyJid = async (session, { chatId, remoteJid }) => {
    const jid = toSendJid(remoteJid || '');
    if (jid && (isLidJid(jid) || isPhoneJid(jid))) return jid;

    const phone = digitsOnly(chatId);
    if (!phone) throw new Error('Missing chat id for reply.');

    const pnJid = `${phone}@s.whatsapp.net`;
    try {
        const lid = await getSocket(session)?.signalRepository?.lidMapping?.getLIDForPN?.(pnJid);
        if (lid) return lid;
    } catch {
        // ignore mapping miss
    }
    return pnJid;
};

const sendTextReply = async (session, { chatId, remoteJid, text }) => {
    const sock = getSocket(session);
    if (!sock?.sendMessage) throw new Error('Device socket is not ready.');
    const jid = await resolveReplyJid(session, { chatId, remoteJid });
    const result = await sock.sendMessage(jid, { text });
    return { jid, result };
};

module.exports = {
    resolveChatIdentity,
    extractMessageContent,
    resolveReplyJid,
    sendTextReply
};
