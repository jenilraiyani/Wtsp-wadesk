const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const fetch = require('node-fetch');
const mime = require('mime');
const { MessageMedia } = require('../utils/media');
const { UPLOADS_PATH } = require('../utils/paths');
const { formatChatId, normalizePhoneNumber, sleep } = require('../utils/helpers');

const parseStringList = (...values) => {
    const result = [];
    for (const value of values) {
        if (value == null || value === '') continue;
        if (Array.isArray(value)) {
            value.forEach((item) => {
                const trimmed = String(item).trim();
                if (trimmed) result.push(trimmed);
            });
            continue;
        }
        String(value)
            .split(/[\n,]+/)
            .map((item) => item.trim())
            .filter(Boolean)
            .forEach((item) => result.push(item));
    }
    return [...new Set(result)];
};

const parseImageUrlList = (imageUrl, imageUrls) => {
    const combined = imageUrls != null ? imageUrls : imageUrl;
    if (combined == null || combined === '') return [];

    if (Array.isArray(combined)) {
        return combined.map((item) => String(item).trim()).filter((item) => /^https?:\/\//i.test(item));
    }

    const str = String(combined).trim();
    if (!str) return [];

    const parts = str.includes(',')
        ? str.split(/,(?=https?:\/\/)/i).map((item) => item.trim())
        : [str];

    return parts.filter((item) => /^https?:\/\//i.test(item));
};

const collectAttachments = (body = {}) => ({
    imageUrls: parseImageUrlList(body.imageUrl, body.imageUrls),
    attachmentNames: parseStringList(body.attachmentName, body.attachmentNames)
});

const hasAttachments = (attachments) =>
    attachments.imageUrls.length > 0 || attachments.attachmentNames.length > 0;

const createMediaFromUrl = async (imageUrl) => {
    const parsedUrl = new URL(imageUrl);
    let response;

    try {
        response = await fetch(imageUrl, {
            headers: {
                Accept: 'image/*,*/*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            redirect: 'follow'
        });
    } catch (error) {
        throw new Error(`Unable to download image from URL: ${error.message}`);
    }

    if (!response.ok) {
        throw new Error(`Image download failed (${response.status} ${response.statusText}) for ${imageUrl}`);
    }

    const buffer = await response.buffer();
    if (!buffer.length) {
        throw new Error(`Image download returned empty content for ${imageUrl}`);
    }

    const headerMime = (response.headers.get('content-type') || '').split(';')[0].trim();
    const mimetype = headerMime || mime.getType(parsedUrl.pathname) || 'image/jpeg';
    const rawFilename = path.basename(parsedUrl.pathname) || 'image.jpg';
    const filename = rawFilename.length > 80
        ? `${rawFilename.slice(0, 40)}_${Date.now()}${path.extname(rawFilename) || '.jpg'}`
        : rawFilename;

    return new MessageMedia(mimetype, buffer.toString('base64'), filename, buffer.length);
};

const sendMessageToChat = async (session, chatId, text) => {
    try {
        await session.client.sendMessage(chatId, text);
    } catch (sendError) {
        const chat = await session.client.getChatById(chatId);
        await chat.sendMessage(text);
    }
};

const sendMediaToChat = async (session, chatId, media, options = {}) => {
    try {
        await session.client.sendMessage(chatId, media, options);
    } catch (sendError) {
        const chat = await session.client.getChatById(chatId);
        await chat.sendMessage(media, options);
    }
};

const sendToChat = async (session, number, message, attachments = {}) => {
    const chatId = formatChatId(normalizePhoneNumber(number));
    const imageUrls = attachments.imageUrls || [];
    const attachmentNames = attachments.attachmentNames || [];
    const hasMedia = imageUrls.length > 0 || attachmentNames.length > 0;

    if (!hasMedia) {
        if (!message) {
            throw new Error('Message or attachment is required.');
        }
        await sendMessageToChat(session, chatId, message);
        return { imagesSent: 0, filesSent: 0 };
    }

    let captionUsed = false;
    const nextCaption = () => {
        if (!message || captionUsed) return {};
        captionUsed = true;
        return { caption: message };
    };

    const totalItems = imageUrls.length + attachmentNames.length;

    for (let i = 0; i < imageUrls.length; i++) {
        const media = await createMediaFromUrl(imageUrls[i]);
        await sendMediaToChat(session, chatId, media, nextCaption());
        if (i < totalItems - 1) await sleep(800);
    }

    for (let i = 0; i < attachmentNames.length; i++) {
        const filePath = path.join(UPLOADS_PATH, attachmentNames[i]);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Attachment file not found: ${attachmentNames[i]}`);
        }
        const media = MessageMedia.fromFilePath(filePath);
        await sendMediaToChat(session, chatId, media, nextCaption());
        if (i < attachmentNames.length - 1) await sleep(800);
    }

    return { imagesSent: imageUrls.length, filesSent: attachmentNames.length };
};

module.exports = {
    collectAttachments,
    hasAttachments,
    sendToChat
};
