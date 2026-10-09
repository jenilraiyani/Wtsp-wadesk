const sanitizeDeviceId = (rawId) => {
    const cleaned = String(rawId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    return cleaned || 'DEV_mobile';
};

const getRequestValue = (req, ...keys) => {
    const sources = [req.body, req.query];
    for (const source of sources) {
        if (!source || typeof source !== 'object') continue;

        for (const key of keys) {
            if (source[key] != null && source[key] !== '') {
                return source[key];
            }
        }

        const lowerMap = {};
        for (const [field, value] of Object.entries(source)) {
            lowerMap[String(field).toLowerCase()] = value;
        }

        for (const key of keys) {
            const value = lowerMap[String(key).toLowerCase()];
            if (value != null && value !== '') {
                return value;
            }
        }
    }

    return null;
};

const normalizePhoneNumber = (number) => {
    let cleaned = String(number ?? '').replace(/\D/g, '');
    if (!cleaned) return '';

    if (!cleaned.startsWith('91') &&
        !cleaned.startsWith('1') &&
        !cleaned.startsWith('44') &&
        !cleaned.startsWith('971')) {
        cleaned = '91' + cleaned;
    }

    return cleaned;
};

const formatChatId = (number) => {
    let chatId = String(number).replace(/\D/g, '');
    if (!chatId.includes('@c.us')) chatId = `${chatId}@c.us`;
    return chatId;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getDeviceIdFromRequest = (req) =>
    req.body?.deviceId || req.params?.id || req.query?.deviceId || null;

module.exports = {
    sanitizeDeviceId,
    getRequestValue,
    normalizePhoneNumber,
    formatChatId,
    sleep,
    getDeviceIdFromRequest
};
