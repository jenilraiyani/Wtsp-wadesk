const crypto = require('crypto');
const { query } = require('./db');

const createCampaign = async ({ name, userId, deviceId, message, totalCount }) => {
    const id = `c_${crypto.randomBytes(8).toString('hex')}`;
    await query(
        `INSERT INTO dbo.Campaigns (Id, Name, UserId, DeviceId, Message, Status, TotalCount)
         VALUES (@id, @name, @userId, @deviceId, @message, 'running', @totalCount)`,
        {
            id,
            name: name || 'Bulk campaign',
            userId: userId || null,
            deviceId: deviceId || null,
            message: message || '',
            totalCount: totalCount || 0
        }
    );
    return id;
};

const addCampaignLog = async ({ campaignId, phoneNumber, status, errorMessage }) => {
    if (!campaignId) return;
    await query(
        `INSERT INTO dbo.CampaignLogs (CampaignId, PhoneNumber, Status, ErrorMessage)
         VALUES (@campaignId, @phoneNumber, @status, @errorMessage)`,
        {
            campaignId,
            phoneNumber: String(phoneNumber || ''),
            status,
            errorMessage: errorMessage ? String(errorMessage).slice(0, 800) : null
        }
    );
};

const finishCampaign = async (campaignId, status = 'completed') => {
    if (!campaignId) return;
    await query(
        `UPDATE dbo.Campaigns
         SET Status = @status,
             SentCount = (SELECT COUNT(*) FROM dbo.CampaignLogs WHERE CampaignId = @campaignId AND Status = 'success'),
             FailedCount = (SELECT COUNT(*) FROM dbo.CampaignLogs WHERE CampaignId = @campaignId AND Status = 'failed'),
             CompletedAt = SYSUTCDATETIME()
         WHERE Id = @campaignId`,
        { campaignId, status }
    );
};

const listCampaigns = async (user, { q } = {}) => {
    const isAdmin = user?.role === 'admin';
    const needle = String(q || '').trim();
    const params = { userId: user?.id || '' };
    const userClause = isAdmin ? '' : ' AND c.UserId = @userId';
    let searchClause = '';

    if (needle) {
        params.q = `%${needle}%`;
        const digits = needle.replace(/\D/g, '');
        const phoneClause = digits.length >= 3
            ? 'OR l.PhoneNumber LIKE @qDigits'
            : '';
        if (digits.length >= 3) params.qDigits = `%${digits}%`;
        searchClause = `
          AND (
            c.Name LIKE @q
            OR c.DeviceId LIKE @q
            OR c.Status LIKE @q
            OR ISNULL(c.Message, '') LIKE @q
            OR EXISTS (
              SELECT 1 FROM dbo.CampaignLogs l
              WHERE l.CampaignId = c.Id
                AND (
                  l.PhoneNumber LIKE @q
                  ${phoneClause}
                  OR l.Status LIKE @q
                  OR ISNULL(l.ErrorMessage, '') LIKE @q
                )
            )
          )`;
    }

    const result = await query(
        `SELECT TOP 80 c.*, u.Name AS UserName
         FROM dbo.Campaigns c
         LEFT JOIN dbo.Users u ON u.Id = c.UserId
         WHERE 1 = 1 ${userClause} ${searchClause}
         ORDER BY c.CreatedAt DESC`,
        params
    );

    return result.recordset.map((row) => ({
        id: row.Id,
        name: row.Name,
        userId: row.UserId,
        userName: row.UserName,
        deviceId: row.DeviceId,
        message: row.Message,
        status: row.Status,
        totalCount: row.TotalCount,
        sentCount: row.SentCount,
        failedCount: row.FailedCount,
        createdAt: row.CreatedAt,
        completedAt: row.CompletedAt,
        scheduledAt: row.ScheduledAt || null
    }));
};

const getCampaignLogs = async (campaignId) => {
    const result = await query(
        `SELECT PhoneNumber, Status, ErrorMessage, CreatedAt
         FROM dbo.CampaignLogs
         WHERE CampaignId = @campaignId
         ORDER BY Id ASC`,
        { campaignId }
    );
    return result.recordset.map((row) => ({
        number: row.PhoneNumber,
        status: row.Status,
        error: row.ErrorMessage,
        createdAt: row.CreatedAt
    }));
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const getWeeklyTrend = async (user) => {
    const userFilter = user?.role === 'admin' ? '' : ' AND c.UserId = @userId';
    const result = await query(
        `SELECT
            CONVERT(char(10), DATEADD(minute, 330, l.CreatedAt), 23) AS DayKey,
            SUM(CASE WHEN LOWER(l.Status) = 'success' THEN 1 ELSE 0 END) AS Sent,
            SUM(CASE WHEN LOWER(l.Status) = 'failed' THEN 1 ELSE 0 END) AS Failed
         FROM dbo.CampaignLogs l
         INNER JOIN dbo.Campaigns c ON c.Id = l.CampaignId
         WHERE l.CreatedAt >= DATEADD(day, -8, SYSUTCDATETIME())
         ${userFilter}
         GROUP BY CONVERT(char(10), DATEADD(minute, 330, l.CreatedAt), 23)`,
        { userId: user?.id || '' }
    );

    const byDay = {};
    for (const row of result.recordset) {
        byDay[String(row.DayKey).slice(0, 10)] = {
            sent: Number(row.Sent) || 0,
            failed: Number(row.Failed) || 0
        };
    }

    const days = [];
    const istNow = new Date(Date.now() + (5.5 * 60 * 60 * 1000));
    for (let i = 6; i >= 0; i -= 1) {
        const d = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() - i));
        const key = d.toISOString().slice(0, 10);
        const dayNum = Number(key.slice(8, 10));
        days.push({
            date: key,
            label: `${WEEKDAYS[d.getUTCDay()]} ${dayNum}`,
            sent: byDay[key]?.sent || 0,
            failed: byDay[key]?.failed || 0
        });
    }
    return days;
};

const getDashboardStats = async (user) => {
    const userFilter = user?.role === 'admin' ? '' : ' AND UserId = @userId';

    const campaigns = await query(
        `SELECT
            COUNT(*) AS TotalCampaigns,
            SUM(CASE WHEN CreatedAt >= DATEADD(day, -1, SYSUTCDATETIME()) THEN 1 ELSE 0 END) AS CampaignsToday,
            ISNULL(SUM(SentCount), 0) AS MessagesSent,
            ISNULL(SUM(FailedCount), 0) AS MessagesFailed,
            ISNULL(SUM(CASE WHEN CreatedAt >= DATEADD(day, -1, SYSUTCDATETIME()) THEN SentCount ELSE 0 END), 0) AS SentToday
         FROM dbo.Campaigns
         WHERE 1 = 1 ${userFilter}`,
        { userId: user?.id || '' }
    );

    let totalDevices = 0;
    if (user?.role === 'admin') {
        const devices = await query('SELECT COUNT(*) AS Total FROM dbo.Devices');
        totalDevices = devices.recordset[0].Total || 0;
    } else {
        const allowed = Array.isArray(user?.allowedDevices) ? user.allowedDevices : [];
        if (allowed.length) {
            const params = { userId: user?.id || '' };
            const parts = allowed.map((id, i) => {
                const key = `dev${i}`;
                params[key] = String(id);
                return `@${key}`;
            });
            const devices = await query(
                `SELECT COUNT(*) AS Total
                 FROM dbo.Devices
                 WHERE Id IN (${parts.join(',')})`,
                params
            );
            totalDevices = devices.recordset[0].Total || 0;
        } else {
            totalDevices = 0;
        }
    }

    return {
        totalDevices,
        totalCampaigns: campaigns.recordset[0].TotalCampaigns || 0,
        campaignsToday: campaigns.recordset[0].CampaignsToday || 0,
        messagesSent: campaigns.recordset[0].MessagesSent || 0,
        messagesFailed: campaigns.recordset[0].MessagesFailed || 0,
        sentToday: campaigns.recordset[0].SentToday || 0,
        weekly: await getWeeklyTrend(user)
    };
};

const getComposeSendCount = async (user) => {
    const userFilter = user?.role === 'admin' ? '' : ' AND UserId = @userId';
    const result = await query(
        `SELECT
            ISNULL(SUM(SentCount), 0) AS SentTotal,
            ISNULL(SUM(FailedCount), 0) AS FailedTotal,
            ISNULL(SUM(CASE WHEN CreatedAt >= DATEADD(day, -1, SYSUTCDATETIME()) THEN SentCount ELSE 0 END), 0) AS SentToday
         FROM dbo.Campaigns
         WHERE Name = N'Compose' ${userFilter}`,
        { userId: user?.id || '' }
    );
    const row = result.recordset[0] || {};
    return {
        sentTotal: Number(row.SentTotal) || 0,
        failedTotal: Number(row.FailedTotal) || 0,
        sentToday: Number(row.SentToday) || 0
    };
};

const recordSingleSend = async ({ userId, deviceId, number, message, success, errorMessage }) => {
    const campaignId = await createCampaign({
        name: 'Compose',
        userId,
        deviceId,
        message: message || '',
        totalCount: 1
    });
    await addCampaignLog({
        campaignId,
        phoneNumber: number,
        status: success ? 'success' : 'failed',
        errorMessage
    });
    await finishCampaign(campaignId, success ? 'completed' : 'failed');
    return campaignId;
};

let scheduleColumnsReady = false;

const ensureScheduleColumns = async () => {
    if (scheduleColumnsReady) return;
    await query(`
        IF COL_LENGTH('dbo.Campaigns', 'ScheduledAt') IS NULL
            ALTER TABLE dbo.Campaigns ADD ScheduledAt DATETIME2 NULL;
    `);
    await query(`
        IF COL_LENGTH('dbo.Campaigns', 'NumbersText') IS NULL
            ALTER TABLE dbo.Campaigns ADD NumbersText NVARCHAR(MAX) NULL;
    `);
    await query(`
        IF COL_LENGTH('dbo.Campaigns', 'AttachmentName') IS NULL
            ALTER TABLE dbo.Campaigns ADD AttachmentName NVARCHAR(260) NULL;
    `);
    await query(`
        IF COL_LENGTH('dbo.Campaigns', 'ImageUrl') IS NULL
            ALTER TABLE dbo.Campaigns ADD ImageUrl NVARCHAR(1000) NULL;
    `);
    await query(`
        IF COL_LENGTH('dbo.Campaigns', 'MinGapSec') IS NULL
            ALTER TABLE dbo.Campaigns ADD MinGapSec INT NULL;
    `);
    await query(`
        IF COL_LENGTH('dbo.Campaigns', 'MaxGapSec') IS NULL
            ALTER TABLE dbo.Campaigns ADD MaxGapSec INT NULL;
    `);
    scheduleColumnsReady = true;
};

const createScheduledCampaign = async ({
    name,
    userId,
    deviceId,
    message,
    numbers,
    recipients,
    scheduledAt,
    attachmentName,
    imageUrl,
    minGap,
    maxGap
}) => {
    await ensureScheduleColumns();
    const { parseRecipients } = require('../utils/personalize');
    const { resolveGap } = require('../utils/gap');
    const gap = resolveGap(minGap, maxGap);
    const recipientList = parseRecipients(numbers, recipients);
    if (!recipientList.length) throw new Error('No valid numbers found.');

    const when = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) throw new Error('Invalid schedule time.');
    if (when.getTime() <= Date.now() + 60 * 1000) {
        throw new Error('Schedule time must be at least 1 minute in the future.');
    }

    const hasVars = recipientList.some((row) => Object.keys(row).some((k) => k !== 'phone'));
    const numbersText = hasVars
        ? JSON.stringify(recipientList)
        : recipientList.map((row) => row.phone).join(',');

    const id = `c_${crypto.randomBytes(8).toString('hex')}`;
    await query(
        `INSERT INTO dbo.Campaigns
            (Id, Name, UserId, DeviceId, Message, Status, TotalCount, ScheduledAt, NumbersText, AttachmentName, ImageUrl, MinGapSec, MaxGapSec)
         VALUES
            (@id, @name, @userId, @deviceId, @message, 'scheduled', @totalCount, @scheduledAt, @numbersText, @attachmentName, @imageUrl, @minGapSec, @maxGapSec)`,
        {
            id,
            name: name || 'Scheduled campaign',
            userId: userId || null,
            deviceId: deviceId || null,
            message: message || '',
            totalCount: recipientList.length,
            scheduledAt: when,
            numbersText,
            attachmentName: attachmentName || null,
            imageUrl: imageUrl || null,
            minGapSec: gap.minGap,
            maxGapSec: gap.maxGap
        }
    );
    return {
        id,
        totalCount: recipientList.length,
        scheduledAt: when.toISOString()
    };
};

const listScheduledCampaigns = async (user) => {
    await ensureScheduleColumns();
    const isAdmin = user?.role === 'admin';
    const userClause = isAdmin ? '' : ' AND c.UserId = @userId';
    const result = await query(
        `SELECT TOP 50
            c.Id, c.Name, c.UserId, c.DeviceId, c.Message, c.Status, c.TotalCount,
            c.ScheduledAt, c.CreatedAt, c.CompletedAt,
            ISNULL((
                SELECT COUNT(*) FROM dbo.CampaignLogs l
                WHERE l.CampaignId = c.Id AND LOWER(l.Status) = 'success'
            ), 0) AS SuccessCount,
            ISNULL((
                SELECT COUNT(*) FROM dbo.CampaignLogs l
                WHERE l.CampaignId = c.Id AND LOWER(l.Status) = 'failed'
            ), 0) AS FailCount
         FROM dbo.Campaigns c
         WHERE c.ScheduledAt IS NOT NULL
           AND (
             c.Status IN ('scheduled', 'running')
             OR (
               c.Status IN ('completed', 'failed')
               AND c.CompletedAt IS NOT NULL
               AND c.CompletedAt >= DATEADD(hour, -6, SYSUTCDATETIME())
             )
           )
           ${userClause}
         ORDER BY
           CASE c.Status WHEN 'running' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END,
           c.ScheduledAt ASC`,
        { userId: user?.id || '' }
    );

    return (result.recordset || []).map((row) => {
        const totalCount = Number(row.TotalCount || 0);
        const successCount = Number(row.SuccessCount || 0);
        const failedCount = Number(row.FailCount || 0);
        const processed = successCount + failedCount;
        const progressPct = totalCount > 0
            ? Math.min(100, Math.round((processed / totalCount) * 100))
            : 0;
        const successPct = totalCount > 0
            ? Math.min(100, Math.round((successCount / totalCount) * 100))
            : 0;
        const failedPct = totalCount > 0
            ? Math.min(100, Math.round((failedCount / totalCount) * 100))
            : 0;
        return {
            id: row.Id,
            name: row.Name,
            userId: row.UserId,
            deviceId: row.DeviceId,
            message: row.Message,
            status: row.Status,
            totalCount,
            successCount,
            failedCount,
            processed,
            progressPct,
            successPct,
            failedPct,
            scheduledAt: row.ScheduledAt,
            createdAt: row.CreatedAt,
            completedAt: row.CompletedAt || null
        };
    });
};

const cancelScheduledCampaign = async (user, campaignId) => {
    await ensureScheduleColumns();
    const isAdmin = user?.role === 'admin';
    const result = await query(
        `UPDATE dbo.Campaigns
         SET Status = 'cancelled', CompletedAt = SYSUTCDATETIME()
         WHERE Id = @id
           AND Status = 'scheduled'
           ${isAdmin ? '' : 'AND UserId = @userId'};
         SELECT @@ROWCOUNT AS Updated;`,
        { id: String(campaignId), userId: user?.id || '' }
    );
    const updated = Number(result.recordset?.[0]?.Updated || result.rowsAffected?.[0] || 0);
    if (!updated) {
        const err = new Error('Scheduled campaign not found or already started.');
        err.status = 404;
        throw err;
    }
    return true;
};

const claimDueScheduledCampaigns = async () => {
    await ensureScheduleColumns();
    const due = await query(
        `SELECT TOP 5 Id
         FROM dbo.Campaigns
         WHERE Status = 'scheduled'
           AND ScheduledAt IS NOT NULL
           AND ScheduledAt <= SYSUTCDATETIME()
         ORDER BY ScheduledAt ASC`
    );
    const claimed = [];
    for (const row of due.recordset || []) {
        const upd = await query(
            `UPDATE dbo.Campaigns
             SET Status = 'running'
             WHERE Id = @id AND Status = 'scheduled';
             SELECT @@ROWCOUNT AS Updated;`,
            { id: row.Id }
        );
        if (Number(upd.recordset?.[0]?.Updated || upd.rowsAffected?.[0] || 0) > 0) {
            claimed.push(row.Id);
        }
    }
    return claimed;
};

const getCampaignForRun = async (campaignId) => {
    await ensureScheduleColumns();
    const result = await query(
        `SELECT TOP 1 Id, Name, UserId, DeviceId, Message, NumbersText, AttachmentName, ImageUrl, TotalCount, Status, MinGapSec, MaxGapSec
         FROM dbo.Campaigns WHERE Id = @id`,
        { id: String(campaignId) }
    );
    const row = result.recordset?.[0];
    if (!row) return null;
    return {
        id: row.Id,
        name: row.Name,
        userId: row.UserId,
        deviceId: row.DeviceId,
        message: row.Message || '',
        numbersText: row.NumbersText || '',
        attachmentName: row.AttachmentName || '',
        imageUrl: row.ImageUrl || '',
        totalCount: row.TotalCount,
        status: row.Status,
        minGap: row.MinGapSec,
        maxGap: row.MaxGapSec
    };
};

const getPendingAttachmentNames = async () => {
    await ensureScheduleColumns();
    const result = await query(
        `SELECT DISTINCT AttachmentName
         FROM dbo.Campaigns
         WHERE Status IN ('scheduled', 'running')
           AND AttachmentName IS NOT NULL
           AND AttachmentName <> ''`
    );
    return new Set((result.recordset || []).map((row) => row.AttachmentName));
};

/** Scheduled campaigns left 'running' by a crash/restart go back to the queue. */
const recoverInterruptedScheduled = async () => {
    await ensureScheduleColumns();
    const result = await query(
        `UPDATE dbo.Campaigns
         SET Status = 'scheduled', ScheduledAt = SYSUTCDATETIME()
         WHERE Status = 'running' AND ScheduledAt IS NOT NULL;
         SELECT @@ROWCOUNT AS Updated;`
    );
    return Number(result.recordset?.[0]?.Updated || 0);
};

const getLoggedPhones = async (campaignId) => {
    const result = await query(
        `SELECT DISTINCT PhoneNumber FROM dbo.CampaignLogs WHERE CampaignId = @campaignId`,
        { campaignId: String(campaignId) }
    );
    return new Set((result.recordset || []).map((row) => String(row.PhoneNumber)));
};

module.exports = {
    createCampaign,
    addCampaignLog,
    finishCampaign,
    listCampaigns,
    getCampaignLogs,
    getDashboardStats,
    getComposeSendCount,
    recordSingleSend,
    ensureScheduleColumns,
    createScheduledCampaign,
    listScheduledCampaigns,
    cancelScheduledCampaign,
    claimDueScheduledCampaigns,
    getCampaignForRun,
    getPendingAttachmentNames,
    recoverInterruptedScheduled,
    getLoggedPhones
};

