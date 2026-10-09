const { MessageMedia } = require('../utils/media');
const { sessions, getConnectedSession } = require('../services/sessionService');
const { collectAttachments, hasAttachments, sendToChat } = require('../services/sendService');
const { sendSingleLog } = require('../utils/webhooks');
const { normalizePhoneNumber, sleep } = require('../utils/helpers');
const { applyTemplate, parseRecipients, withCountryCode } = require('../utils/personalize');
const { resolveGap, randomGapMs } = require('../utils/gap');

const sleepUnlessCancelled = async (session, ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until && !session.cancelStream) {
        await sleep(Math.min(500, until - Date.now()));
    }
};
const { createCampaign, addCampaignLog, finishCampaign, listCampaigns, getCampaignLogs, getDashboardStats, createScheduledCampaign, listScheduledCampaigns, cancelScheduledCampaign } = require('../models/campaignModel');
const { canAccessDevice } = require('../models/userModel');

const sendBulkStream = async (req, res) => {
    const { deviceId, numbers, recipients, message, imageUrl, imageUrls, attachmentName, attachmentNames, minGap, maxGap } = req.body;
    const attachments = collectAttachments({ imageUrl, imageUrls, attachmentName, attachmentNames });

    if (!deviceId || (!numbers && !(Array.isArray(recipients) && recipients.length))) {
        return res.status(400).json({ success: false, error: 'Missing deviceId or numbers.' });
    }
    if (!message && !hasAttachments(attachments)) {
        return res.status(400).json({ success: false, error: 'Message or attachment is required.' });
    }

    let gap;
    try {
        gap = resolveGap(minGap, maxGap);
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }

    const session = getConnectedSession(deviceId);
    if (!session) {
        return res.status(503).json({ success: false, error: `Device ${deviceId} is not ready.` });
    }

    const recipientList = parseRecipients(numbers, recipients);

    if (recipientList.length === 0) {
        return res.status(400).json({ success: false, error: 'No valid numbers found.' });
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');

    session.cancelStream = false;
    session.pauseStream = false;

    const campaignId = await createCampaign({
        name: req.body.name || 'Live campaign',
        userId: req.user?.id,
        deviceId,
        message: message || '',
        totalCount: recipientList.length
    }).catch(() => null);

    let aborted = false;

    for (let i = 0; i < recipientList.length; i++) {
        while (session.pauseStream && !session.cancelStream) {
            await sleep(1000);
        }

        if (session.cancelStream) {
            aborted = true;
            res.write(JSON.stringify({ status: 'aborted', message: 'Campaign forcefully stopped by user.' }) + '\n');
            break;
        }

        const row = recipientList[i];
        const currentNumber = withCountryCode(row.phone);
        const personalized = applyTemplate(message || '', row);

        let isSuccess = false;
        let errorMsg = null;

        try {
            await sendToChat(session, currentNumber, personalized, attachments);
            isSuccess = true;
        } catch (error) {
            isSuccess = false;
            errorMsg = error.message;
        }

        if (campaignId) {
            await addCampaignLog({
                campaignId,
                phoneNumber: currentNumber,
                status: isSuccess ? 'success' : 'failed',
                errorMessage: errorMsg
            }).catch(() => {});
        }

        res.write(JSON.stringify({
            status: isSuccess ? 'success' : 'failed',
            index: i + 1,
            total: recipientList.length,
            number: currentNumber,
            error: errorMsg,
            campaignId
        }) + '\n');

        if (i < recipientList.length - 1 && !session.cancelStream) {
            await sleepUnlessCancelled(session, randomGapMs(gap));
        }
    }

    if (campaignId) await finishCampaign(campaignId, aborted ? 'aborted' : 'completed').catch(() => {});

    session.cancelStream = false;
    session.pauseStream = false;
    res.end();
};

const sendVoterSlipsStream = async (req, res) => {
    const { deviceId, bannerUrl, agentName, companyName, customEndpoint, appId, userId } = req.body;
    if (!deviceId) {
        return res.status(400).json({ success: false, error: 'Missing deviceId.' });
    }

    const session = getConnectedSession(deviceId);
    if (!session) {
        return res.status(503).json({ success: false, error: `Device ${deviceId} is not ready.` });
    }

    const voters = req.body.voters || [
        {
            partNo: '69', boothNo: '2', serialNo: '3',
            name: 'Sample Voter',
            genderAge: 'M/51',
            idCard: 'JVT1984517',
            address: 'Polling location',
            mobile: '917383360300'
        }
    ];

    const finalAgentName = agentName || '';
    const finalCompany = companyName || '';
    const bannerCSS = bannerUrl
        ? '.banner { width: 100%; height: auto; display: block; }'
        : '.banner { display: none; }';
    const bannerHTML = bannerUrl ? `<img class="banner" src="${bannerUrl}" />` : '';
    const hasFooter = finalAgentName.trim() !== '' || finalCompany.trim() !== '';
    const footerHTML = hasFooter ? `
        <div class="footer-wrapper">
            <div class="footer-main">
                <div class="agent-info">
                    <div class="agent-icon"><svg width="30" height="30" viewBox="0 0 24 24"><path fill="#555" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg></div>
                    <div class="agent-name">${finalAgentName}</div>
                </div>
            </div>
            <div class="company-banner">${finalCompany}</div>
        </div>
    ` : '';

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.flushHeaders();

    let imagePage;
    try {
        imagePage = await session.client.pupBrowser.newPage();
        await imagePage.setViewport({ width: 600, height: 50 });

        const htmlTemplate = `
            <html>
            <head>
                <style>
                    body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; background: white; color: #000; }
                    ${bannerCSS}
                    .cut-line-container { padding: 15px 0px; position: relative; }
                    .cut-line { border-top: 2px dashed #333; width: 100%; }
                    .scissors { position: absolute; right: 25px; top: -15px; font-size: 28px; background: white; padding-left: 10px; }
                    .details-container { padding: 10px 30px; position: relative; min-height: 380px; font-size: 22px; line-height: 1.6; }
                    .footer-wrapper { background-color: #000; color: #fff; padding: 20px 30px; }
                    .footer-main { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #333; padding-bottom: 0px; }
                    .agent-info { display: flex; align-items: center; margin-bottom:10px; }
                    .agent-icon { background: #f8d49f; width: 60px; height: 60px; border-radius: 50%; display: flex; justify-content: center; align-items: center; margin-right: 15px; }
                    .agent-name { color: #f1c40f; font-size: 28px; font-weight: bold; }
                    .company-banner { text-align: center; padding-top: 15px; padding-bottom: 0px; color: #f1c40f; font-size: 28px; font-weight: bold; font-family: Georgia, serif; }
                </style>
            </head>
            <body>
                ${bannerHTML}
                <div class="cut-line-container">
                    <div class="cut-line"></div>
                </div>
                <div class="details-container">
                    <p style="margin-top: 0;">Ac No. - <span id="v-part"></span> &nbsp;&nbsp;Booth No. - <span id="v-booth"></span> &nbsp;&nbsp; Serial No. - <span id="v-serial"></span></p>
                    <p>Name : <span id="v-name"></span></p>
                    <p>age : <span id="v-gender"></span></p>
                    <p>Id Card No : <span id="v-id" style="font-weight: 800;"></span></p>
                    <p>Polling Location : <span id="v-address"></span></p>
                </div>
                ${footerHTML}
            </body>
            </html>
        `;

        await imagePage.setContent(htmlTemplate);
        session.cancelStream = false;
        session.pauseStream = false;

        for (let i = 0; i < voters.length; i++) {
            while (session.pauseStream && !session.cancelStream) {
                await sleep(1000);
            }

            if (session.cancelStream) {
                res.write(JSON.stringify({ status: 'aborted', message: 'Campaign forcefully stopped by user.' }) + '\n');
                break;
            }

            const voter = voters[i];
            const currentNumber = normalizePhoneNumber(voter.mobile);
            const chatId = `${currentNumber}@c.us`;
            let isSuccess = false;
            let errorMsg = null;

            try {
                const isRegistered = await session.client.isRegisteredUser(chatId);
                if (!isRegistered) {
                    throw new Error('Number is not registered on WhatsApp.');
                }

                await imagePage.evaluate((data) => {
                    document.getElementById('v-part').innerText = data.partNo;
                    document.getElementById('v-booth').innerText = data.boothNo;
                    document.getElementById('v-serial').innerText = data.serialNo;
                    document.getElementById('v-name').innerText = data.name;

                    const genderEl = document.getElementById('v-gender');
                    if (data.genderAge) {
                        genderEl.parentElement.style.display = 'block';
                        genderEl.innerText = data.genderAge;
                    } else {
                        genderEl.parentElement.style.display = 'none';
                    }

                    document.getElementById('v-id').innerText = data.idCard;
                    document.getElementById('v-address').innerText = data.address;
                }, voter);

                const base64Image = await imagePage.screenshot({ encoding: 'base64', fullPage: true });
                const media = new MessageMedia('image/png', base64Image, `VoterSlip_${voter.idCard}.png`);

                try {
                    await session.client.sendMessage(chatId, media);
                } catch (sendError) {
                    const chat = await session.client.getChatById(chatId);
                    await chat.sendMessage(media);
                }

                isSuccess = true;

                if (customEndpoint && appId && userId && voter.idCard) {
                    await sendSingleLog(customEndpoint, appId, userId, voter.idCard);
                }
            } catch (error) {
                isSuccess = false;
                errorMsg = error.message;
            }

            res.write(JSON.stringify({
                status: isSuccess ? 'success' : 'failed',
                index: i + 1,
                total: voters.length,
                number: currentNumber,
                voterName: voter.name,
                error: errorMsg
            }) + '\n');

            if (i < voters.length - 1 && !session.cancelStream) {
                await sleep(1500);
            }
        }

        session.cancelStream = false;
        session.pauseStream = false;
        if (imagePage) await imagePage.close();
        res.end();
    } catch (criticalError) {
        console.error('Voter Stream API Failed:', criticalError);
        res.write(JSON.stringify({ status: 'failed', error: 'Critical server error building images.' }) + '\n');
        if (imagePage) await imagePage.close().catch(() => console.log('Could not close page'));
        res.end();
    }
};

const streamControl = (flag, message) => (req, res) => {
    const { deviceId } = req.body;
    if (!deviceId) {
        return res.status(400).json({ success: false, error: 'Missing deviceId.' });
    }

    const session = sessions[deviceId];
    if (!session) {
        return res.status(404).json({ success: false, message: 'Device not found' });
    }

    if (flag === 'cancel') session.cancelStream = true;
    if (flag === 'pause') session.pauseStream = true;
    if (flag === 'resume') session.pauseStream = false;

    return res.status(200).json({
        success: true,
        message: `${message} ${deviceId}.`
    });
};

const stopStream = streamControl('cancel', 'Stop signal sent to device');
const pauseStream = streamControl('pause', 'Pause signal sent to device');
const resumeStream = streamControl('resume', 'Resume signal sent to device');

const stats = async (req, res) => {
    try {
        const stats = await getDashboardStats(req.user);
        const { sessions: liveSessions } = require('../services/sessionService');
        const { filterDeviceIds } = require('../models/userModel');
        const connectedIds = filterDeviceIds(
            req.user,
            Object.keys(liveSessions).filter((id) => liveSessions[id]?.status === 'CONNECTED' && liveSessions[id]?.client)
        );
        res.json({ success: true, stats: { ...stats, connectedDevices: connectedIds.length } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const list = async (req, res) => {
    try {
        const campaigns = await listCampaigns(req.user, { q: req.query.q });
        res.json({ success: true, campaigns });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const logs = async (req, res) => {
    try {
        const campaigns = await listCampaigns(req.user);
        if (!campaigns.some((item) => item.id === req.params.id)) {
            return res.status(404).json({ success: false, error: 'Campaign not found.' });
        }
        const logs = await getCampaignLogs(req.params.id);
        res.json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const schedule = async (req, res) => {
    try {
        const { deviceId, numbers, recipients, message, name, scheduledAt, attachmentName, imageUrl, imageUrls, minGap, maxGap } = req.body || {};
        if (!deviceId || (!numbers && !(Array.isArray(recipients) && recipients.length))) {
            return res.status(400).json({ success: false, error: 'Missing deviceId or numbers.' });
        }
        if (!scheduledAt) {
            return res.status(400).json({ success: false, error: 'scheduledAt is required.' });
        }
        if (!message && !attachmentName && !imageUrl && !(imageUrls && imageUrls.length)) {
            return res.status(400).json({ success: false, error: 'Message or attachment is required.' });
        }
        if (!canAccessDevice(req.user, deviceId)) {
            return res.status(403).json({ success: false, error: 'You do not have access to this device.' });
        }

        const created = await createScheduledCampaign({
            name: name || 'Scheduled campaign',
            userId: req.user?.id,
            deviceId,
            message: message || '',
            numbers,
            recipients,
            scheduledAt,
            attachmentName: attachmentName || null,
            imageUrl: imageUrl || (Array.isArray(imageUrls) ? imageUrls[0] : null),
            minGap,
            maxGap
        });

        return res.json({
            success: true,
            message: 'Campaign scheduled.',
            campaign: created
        });
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }
};

const listScheduled = async (req, res) => {
    try {
        const campaigns = await listScheduledCampaigns(req.user);
        res.json({ success: true, campaigns });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const cancelSchedule = async (req, res) => {
    try {
        await cancelScheduledCampaign(req.user, req.params.id);
        res.json({ success: true, message: 'Schedule cancelled.' });
    } catch (error) {
        res.status(error.status || 400).json({ success: false, error: error.message });
    }
};

module.exports = {
    sendBulkStream,
    sendVoterSlipsStream,
    stopStream,
    pauseStream,
    resumeStream,
    stats,
    list,
    logs,
    schedule,
    listScheduled,
    cancelSchedule
};
