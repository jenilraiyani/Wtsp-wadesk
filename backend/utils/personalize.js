const phoneDigits = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 9 && digits.length <= 15 ? digits : '';
};

const applyTemplate = (template, vars = {}) => {
    const map = {};
    Object.keys(vars || {}).forEach((key) => {
        map[String(key).toLowerCase()] = vars[key] == null ? '' : String(vars[key]);
    });
    return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
        const found = map[String(key).toLowerCase()];
        return found != null ? found : '';
    });
};

const normalizeRecipient = (item) => {
    if (item == null) return null;
    if (typeof item === 'string' || typeof item === 'number') {
        const phone = phoneDigits(item);
        return phone ? { phone } : null;
    }
    if (typeof item !== 'object') return null;
    const phone = phoneDigits(item.phone || item.number || item.mobile || item.whatsapp);
    if (!phone) return null;
    const out = { ...item, phone };
    delete out.number;
    delete out.mobile;
    delete out.whatsapp;
    return out;
};

/** Accepts plain "n1,n2" / newlines, or JSON array of { phone, name, ... }. */
const parseRecipients = (numbers, recipients) => {
    if (Array.isArray(recipients) && recipients.length) {
        const seen = new Set();
        const list = [];
        for (const raw of recipients) {
            const row = normalizeRecipient(raw);
            if (!row) continue;
            if (seen.has(row.phone)) continue;
            seen.add(row.phone);
            list.push(row);
        }
        return list;
    }

    const text = String(numbers || '').trim();
    if (!text) return [];

    if (text.startsWith('[')) {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) return parseRecipients(null, parsed);
        } catch {
            // fall through to plain numbers
        }
    }

    const seen = new Set();
    const list = [];
    for (const part of text.split(/[\n,]+/)) {
        const phone = phoneDigits(part);
        if (!phone || seen.has(phone)) continue;
        seen.add(phone);
        list.push({ phone });
    }
    return list;
};

const withCountryCode = (phone) => {
    let currentNumber = String(phone || '');
    if (
        !currentNumber.startsWith('91')
        && !currentNumber.startsWith('1')
        && !currentNumber.startsWith('44')
        && !currentNumber.startsWith('971')
    ) {
        currentNumber = `91${currentNumber}`;
    }
    return currentNumber;
};

module.exports = {
    applyTemplate,
    parseRecipients,
    withCountryCode,
    phoneDigits
};
