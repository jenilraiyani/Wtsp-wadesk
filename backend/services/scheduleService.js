const { getConnectedSession } = require('./sessionService');
const { collectAttachments, sendToChat } = require('./sendService');
const { sleep } = require('../utils/helpers');
const { applyTemplate, parseRecipients, withCountryCode } = require('../utils/personalize');
const { resolveGap, randomGapMs, DEFAULT_GAP_SEC } = require('../utils/gap');
const {
    ensureScheduleColumns,
    claimDueScheduledCampaigns,
    getCampaignForRun,
    addCampaignLog,
    finishCampaign,
    recoverInterruptedScheduled,
    getLoggedPhones
} = require('../models/campaignModel');

let timer = null;
let running = false;

const runOneScheduledCampaign = async (campaignId) => {
    const campaign = await getCampaignForRun(campaignId);
    if (!campaign) return;

    const session = getConnectedSession(campaign.deviceId);
    if (!session) {
        console.warn(`Scheduled campaign ${campaignId}: device ${campaign.deviceId} not connected — retry in 2 minutes.`);
        const { query } = require('../models/db');
        await query(
            `UPDATE dbo.Campaigns
             SET Status = 'scheduled',
                 ScheduledAt = DATEADD(minute, 2, SYSUTCDATETIME())
             WHERE Id = @id AND Status = 'running'`,
            { id: campaignId }
        ).catch(() => {});
        return;
    }

    const recipientList = parseRecipients(campaign.numbersText);

    if (!recipientList.length) {
        await finishCampaign(campaignId, 'failed');
        return;
    }

    const attachments = collectAttachments({
        attachmentName: campaign.attachmentName,
        imageUrl: campaign.imageUrl
    });

    let gap;
    try {
        gap = resolveGap(campaign.minGap, campaign.maxGap);
    } catch {
        gap = { minGap: DEFAULT_GAP_SEC, maxGap: DEFAULT_GAP_SEC };
    }

    const alreadyLogged = await getLoggedPhones(campaignId).catch(() => new Set());
    if (alreadyLogged.size) {
        console.log(`Resuming scheduled campaign ${campaignId}: ${alreadyLogged.size} already processed.`);
    }

    console.log(`Running scheduled campaign ${campaignId} (${recipientList.length} numbers) on ${campaign.deviceId}`);

    for (let i = 0; i < recipientList.length; i += 1) {
        const row = recipientList[i];
        const currentNumber = withCountryCode(row.phone);
        if (alreadyLogged.has(currentNumber)) continue;
        const personalized = applyTemplate(campaign.message || '', row);

        let isSuccess = false;
        let errorMsg = null;
        try {
            await sendToChat(session, currentNumber, personalized, attachments);
            isSuccess = true;
        } catch (error) {
            isSuccess = false;
            errorMsg = error.message;
        }

        await addCampaignLog({
            campaignId,
            phoneNumber: currentNumber,
            status: isSuccess ? 'success' : 'failed',
            errorMessage: errorMsg
        }).catch(() => {});

        if (i < recipientList.length - 1) {
            await sleep(randomGapMs(gap));
        }
    }

    await finishCampaign(campaignId, 'completed').catch(() => {});
    console.log(`Scheduled campaign ${campaignId} finished.`);
};

const processDueSchedules = async () => {
    if (running) return;
    running = true;
    try {
        await ensureScheduleColumns();
        const dueIds = await claimDueScheduledCampaigns();
        for (const id of dueIds) {
            try {
                await runOneScheduledCampaign(id);
            } catch (error) {
                console.error(`Scheduled campaign ${id} failed:`, error.message);
                await finishCampaign(id, 'failed').catch(() => {});
            }
        }
    } catch (error) {
        console.error('Schedule processor error:', error.message);
    } finally {
        running = false;
    }
};

const startCampaignScheduler = async () => {
    if (timer) return;
    try {
        const recovered = await recoverInterruptedScheduled();
        if (recovered) console.log(`Re-queued ${recovered} interrupted scheduled campaign(s).`);
    } catch (error) {
        console.error('Scheduled campaign recovery failed:', error.message);
    }
    processDueSchedules().catch(() => {});
    timer = setInterval(() => {
        processDueSchedules().catch(() => {});
    }, 20 * 1000);
    console.log('Campaign scheduler started (every 20s)');
};

module.exports = {
    startCampaignScheduler,
    processDueSchedules,
    runOneScheduledCampaign
};
