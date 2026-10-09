const fs = require('fs');
const path = require('path');
const { getConnectedSession, sessions } = require('../services/sessionService');
const { collectAttachments, hasAttachments, sendToChat } = require('../services/sendService');
const { UPLOADS_PATH } = require('../utils/paths');
const { sleep } = require('../utils/helpers');
const {
    createCampaign,
    addCampaignLog,
    finishCampaign,
    recordSingleSend,
    getComposeSendCount
} = require('../models/campaignModel');

const uploadAttachment = (req, res) => {
    const { filename, mimeType, dataBase64 } = req.body;
    if (!filename || !dataBase64) {
        return res.status(400).json({ success: false, error: 'filename and dataBase64 are required' });
    }

    try {
        const safeName = `${Date.now()}_${path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const filePath = path.join(UPLOADS_PATH, safeName);
        fs.writeFileSync(filePath, Buffer.from(dataBase64, 'base64'));
        return res.json({
            success: true,
            attachmentName: safeName,
            mimeType: mimeType || 'application/octet-stream'
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
};

const sendBulk = async (req, res) => {
    const { deviceId, numbers, message, attachmentName, attachmentNames, imageUrl, imageUrls } = req.body;
    const attachments = collectAttachments({ attachmentName, attachmentNames, imageUrl, imageUrls });
    if (!deviceId || !numbers) {
        return res.status(400).json({ success: false, error: 'Missing deviceId or numbers.' });
    }
    if (!message && !hasAttachments(attachments)) {
        return res.status(400).json({ success: false, error: 'Message or attachment is required.' });
    }

    const session = getConnectedSession(deviceId);
    if (!session) {
        return res.status(503).json({ success: false, error: `Device ${deviceId} is not connected.` });
    }

    const rawNumbers = String(numbers)
        .split(/[\n,]+/)
        .map((n) => n.replace(/\D/g, ''))
        .filter((n) => n.length >= 10);

    if (rawNumbers.length === 0) {
        return res.status(400).json({ success: false, error: 'No valid numbers found.' });
    }

    const results = [];
    const campaignId = await createCampaign({
        name: req.body.name || 'Bulk send',
        userId: req.user?.id,
        deviceId,
        message: message || '',
        totalCount: rawNumbers.length
    }).catch(() => null);

    for (let i = 0; i < rawNumbers.length; i++) {
        const currentNumber = rawNumbers[i];
        try {
            await sendToChat(session, currentNumber, message || '', attachments);
            results.push({ number: currentNumber, success: true });
            if (campaignId) await addCampaignLog({ campaignId, phoneNumber: currentNumber, status: 'success' }).catch(() => {});
        } catch (error) {
            results.push({ number: currentNumber, success: false, error: error.message });
            if (campaignId) await addCampaignLog({ campaignId, phoneNumber: currentNumber, status: 'failed', errorMessage: error.message }).catch(() => {});
        }

        if (i < rawNumbers.length - 1) {
            await sleep(3000);
        }
    }

    if (campaignId) await finishCampaign(campaignId, 'completed').catch(() => {});

    return res.json({
        success: true,
        total: rawNumbers.length,
        sent: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        results
    });
};

const sendOne = async (req, res) => {
    const { deviceId, number, message, attachmentName, attachmentNames, imageUrl, imageUrls } = req.body;
    const attachments = collectAttachments({ attachmentName, attachmentNames, imageUrl, imageUrls });

    if (!deviceId || !number) {
        return res.status(400).json({ success: false, error: 'Missing deviceId or number.' });
    }
    if (!message && !hasAttachments(attachments)) {
        return res.status(400).json({ success: false, error: 'Message or attachment is required.' });
    }

    const session = getConnectedSession(deviceId);
    if (!session) {
        if (!sessions[deviceId]) {
            return res.status(404).json({ success: false, message: 'Device not found' });
        }
        return res.status(503).json({ success: false, error: `Device ${deviceId} is not connected.` });
    }

    try {
        const sent = await sendToChat(session, number, message || '', attachments);
        await recordSingleSend({
            userId: req.user?.id,
            deviceId,
            number,
            message: message || '',
            success: true
        }).catch(() => {});
        return res.status(200).json({
            success: true,
            message: 'Message delivered.',
            attachmentsSent: sent.imagesSent + sent.filesSent
        });
    } catch (error) {
        await recordSingleSend({
            userId: req.user?.id,
            deviceId,
            number,
            message: message || '',
            success: false,
            errorMessage: error.message
        }).catch(() => {});
        return res.status(500).json({ success: false, error: 'Failed to send message.', details: error.message });
    }
};

const sendImage = async (req, res) => {
    const { deviceId, number, message, imageUrl, imageUrls } = req.body;
    const attachments = collectAttachments({ imageUrl, imageUrls });

    if (!deviceId || !number) {
        return res.status(400).json({ success: false, error: 'Missing deviceId or number.' });
    }
    if (!hasAttachments(attachments)) {
        return res.status(400).json({ success: false, error: 'Missing imageUrl or imageUrls.' });
    }

    const session = getConnectedSession(deviceId);
    if (!session) {
        return res.status(503).json({ success: false, error: `Device ${deviceId} is not ready.` });
    }

    try {
        const sent = await sendToChat(session, number, message || '', attachments);
        await recordSingleSend({
            userId: req.user?.id,
            deviceId,
            number,
            message: message || '',
            success: true
        }).catch(() => {});
        return res.status(200).json({
            success: true,
            message: 'Image sent successfully!',
            attachmentsSent: sent.imagesSent
        });
    } catch (error) {
        console.error('Image Send Error:', error);
        await recordSingleSend({
            userId: req.user?.id,
            deviceId,
            number,
            message: message || '',
            success: false,
            errorMessage: error.message
        }).catch(() => {});
        return res.status(500).json({ success: false, error: 'Failed to send image.', details: error.message });
    }
};

const composeStats = async (req, res) => {
    try {
        const counts = await getComposeSendCount(req.user);
        res.json({ success: true, ...counts });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = {
    uploadAttachment,
    sendBulk,
    sendOne,
    sendImage,
    composeStats
};
