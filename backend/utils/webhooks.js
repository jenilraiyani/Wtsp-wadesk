const fetch = require('node-fetch');
const { config } = require('../config');

const webhookHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.webhookBearer}`
});

async function createCampaignLog(endpoint, appId, userId) {
    if (!endpoint || !appId || !userId) return null;

    try {
        const payload = {
            action: 'create_campaign',
            app_id: appId,
            user_id: userId,
            remarks: 'Bulk WhatsApp Sleep Campaign',
            create_by: userId
        };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: webhookHeaders(),
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        const campaignId = data?.campaign_id || data?.data?.campaign_id || data?.id || null;
        console.log(`Campaign Created: ${campaignId}`);
        return campaignId;
    } catch (error) {
        console.error('Webhook Campaign Creation Failed:', error.message);
        return null;
    }
}

async function sendSingleLog(endpoint, appId, userId, singleIdCard) {
    if (!endpoint || !appId || !userId || !singleIdCard) return;

    try {
        const payload = {
            app_id: appId,
            user_id: userId,
            prachar_type: 'API_SLEEP',
            idcard: String(singleIdCard) + ','
        };

        await fetch(endpoint, {
            method: 'POST',
            headers: webhookHeaders(),
            body: JSON.stringify(payload)
        });

        console.log(`Logged IDCard: ${singleIdCard} to Webhook`);
    } catch (error) {
        console.error(`Webhook Log Failed for IDCard ${singleIdCard}:`, error.message);
    }
}

module.exports = { createCampaignLog, sendSingleLog };
