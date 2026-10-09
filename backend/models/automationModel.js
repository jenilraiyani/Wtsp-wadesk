const crypto = require('crypto');
const { query } = require('./db');
const { canAccessDevice } = require('./userModel');

const MATCH_TYPES = ['exact', 'contains', 'starts_with'];

let tablesReady = false;

const ensureAutomationTables = async () => {
    if (tablesReady) return;
    await query(`
        IF OBJECT_ID('dbo.AutomationRules', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.AutomationRules (
                Id NVARCHAR(40) NOT NULL PRIMARY KEY,
                Name NVARCHAR(200) NOT NULL,
                DeviceId NVARCHAR(40) NOT NULL,
                MatchType NVARCHAR(20) NOT NULL CONSTRAINT DF_AutomationRules_MatchType DEFAULT 'contains',
                Keywords NVARCHAR(MAX) NOT NULL,
                ReplyMessage NVARCHAR(MAX) NOT NULL,
                Priority INT NOT NULL CONSTRAINT DF_AutomationRules_Priority DEFAULT 0,
                IsActive BIT NOT NULL CONSTRAINT DF_AutomationRules_IsActive DEFAULT 1,
                UserId NVARCHAR(40) NULL,
                CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_AutomationRules_CreatedAt DEFAULT SYSUTCDATETIME(),
                UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_AutomationRules_UpdatedAt DEFAULT SYSUTCDATETIME()
            );
            CREATE INDEX IX_AutomationRules_Device ON dbo.AutomationRules (DeviceId, IsActive, Priority DESC);
        END
    `);
    await query(`
        IF COL_LENGTH('dbo.AutomationRules', 'Variables') IS NULL
            ALTER TABLE dbo.AutomationRules ADD Variables NVARCHAR(MAX) NULL;
    `);
    await query(`
        IF COL_LENGTH('dbo.AutomationRules', 'Options') IS NULL
            ALTER TABLE dbo.AutomationRules ADD Options NVARCHAR(MAX) NULL;
    `);
    await query(`
        IF COL_LENGTH('dbo.AutomationRules', 'AttachmentName') IS NULL
            ALTER TABLE dbo.AutomationRules ADD AttachmentName NVARCHAR(260) NULL;
    `);
    await query(`
        IF COL_LENGTH('dbo.AutomationRules', 'WorkingHours') IS NULL
            ALTER TABLE dbo.AutomationRules ADD WorkingHours NVARCHAR(MAX) NULL;
    `);
    await query(`
        IF OBJECT_ID('dbo.AutomationLogs', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.AutomationLogs (
                Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                RuleId NVARCHAR(40) NULL,
                RuleName NVARCHAR(200) NULL,
                DeviceId NVARCHAR(40) NOT NULL,
                ChatId NVARCHAR(80) NOT NULL,
                ContactName NVARCHAR(120) NULL,
                IncomingText NVARCHAR(4000) NULL,
                MatchedKeyword NVARCHAR(200) NULL,
                ReplyText NVARCHAR(MAX) NULL,
                Status NVARCHAR(20) NOT NULL,
                ErrorMessage NVARCHAR(800) NULL,
                CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_AutomationLogs_CreatedAt DEFAULT SYSUTCDATETIME()
            );
            CREATE INDEX IX_AutomationLogs_Device_Created ON dbo.AutomationLogs (DeviceId, CreatedAt DESC);
            CREATE INDEX IX_AutomationLogs_Rule ON dbo.AutomationLogs (RuleId, CreatedAt DESC);
        END
    `);
    tablesReady = true;
};

const parseKeywords = (value) => {
    const list = Array.isArray(value) ? value : String(value || '').split(/[\n,]+/);
    const seen = new Set();
    const out = [];
    for (const raw of list) {
        const word = String(raw || '').trim();
        const key = word.toLowerCase();
        if (!word || seen.has(key)) continue;
        seen.add(key);
        out.push(word.slice(0, 200));
    }
    return out;
};

const RESERVED_VARIABLES = ['name', 'phone', 'message'];
const MAX_VARIABLES = 30;

const parseVariables = (value) => {
    let source = value;
    if (typeof source === 'string') {
        try {
            source = source.trim() ? JSON.parse(source) : {};
        } catch {
            source = {};
        }
    }
    const entries = Array.isArray(source)
        ? source.map((item) => [item?.key, item?.value])
        : Object.entries(source || {});
    const out = {};
    for (const [rawKey, rawValue] of entries) {
        const key = String(rawKey || '').trim().toLowerCase();
        if (!key) continue;
        out[key] = rawValue == null ? '' : String(rawValue).slice(0, 2000);
    }
    return out;
};

const validateVariables = (value) => {
    const variables = parseVariables(value);
    const keys = Object.keys(variables);
    if (keys.length > MAX_VARIABLES) throw new Error(`Maximum ${MAX_VARIABLES} variables per rule.`);
    for (const key of keys) {
        if (!/^[a-z0-9_]{1,40}$/.test(key)) {
            throw new Error(`Variable "${key}" can use only letters, numbers and _ (max 40).`);
        }
        if (RESERVED_VARIABLES.includes(key)) {
            throw new Error(`"${key}" is a built-in variable; choose another name.`);
        }
    }
    return variables;
};

const MAX_OPTIONS = 20;

const cleanAttachmentName = (value) => {
    const name = String(value || '').trim();
    if (!name) return '';
    if (!/^[\w.-]{1,200}$/.test(name)) throw new Error('Invalid attachment file.');
    return name;
};

const parseOptions = (value) => {
    let source = value;
    if (typeof source === 'string') {
        try {
            source = source.trim() ? JSON.parse(source) : [];
        } catch {
            source = [];
        }
    }
    if (!Array.isArray(source)) return [];
    return source
        .map((item) => ({
            label: String(item?.label || '').trim().slice(0, 100),
            reply: String(item?.reply || '').trim(),
            attachmentName: String(item?.attachmentName || '').trim()
        }))
        .filter((item) => item.label || item.reply || item.attachmentName);
};

const validateOptions = (value) => {
    const options = parseOptions(value);
    if (options.length > MAX_OPTIONS) throw new Error(`Maximum ${MAX_OPTIONS} options per rule.`);
    const seen = new Set();
    options.forEach((option, index) => {
        if (!option.label) throw new Error(`Option ${index + 1}: name is required.`);
        option.attachmentName = cleanAttachmentName(option.attachmentName);
        if (!option.reply && !option.attachmentName) {
            throw new Error(`Option "${option.label}": add a reply message or a file.`);
        }
        const key = option.label.toLowerCase();
        if (seen.has(key)) throw new Error(`Option "${option.label}" is added twice.`);
        seen.add(key);
    });
    return options;
};

const DEFAULT_WORKING_HOURS = { enabled: false, start: '10:00', end: '19:00', days: [1, 2, 3, 4, 5, 6], offReply: '' };
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const parseWorkingHours = (value) => {
    let source = value;
    if (typeof source === 'string') {
        try {
            source = source.trim() ? JSON.parse(source) : {};
        } catch {
            source = {};
        }
    }
    if (!source || typeof source !== 'object') source = {};
    const days = Array.isArray(source.days)
        ? [...new Set(source.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
        : DEFAULT_WORKING_HOURS.days;
    return {
        enabled: Boolean(source.enabled),
        start: TIME_PATTERN.test(source.start) ? source.start : DEFAULT_WORKING_HOURS.start,
        end: TIME_PATTERN.test(source.end) ? source.end : DEFAULT_WORKING_HOURS.end,
        days,
        offReply: String(source.offReply || '').trim().slice(0, 4000)
    };
};

const validateWorkingHours = (value) => {
    const source = value && typeof value === 'object' ? value : {};
    const hours = parseWorkingHours(value);
    if (!hours.enabled) return hours;
    if (!TIME_PATTERN.test(source.start) || !TIME_PATTERN.test(source.end)) {
        throw new Error('Working hours: enter start and end time as HH:MM.');
    }
    if (hours.start === hours.end) throw new Error('Working hours: start and end time cannot be the same.');
    if (!hours.days.length) throw new Error('Working hours: select at least one day.');
    return hours;
};

const mapRule = (row) => ({
    id: row.Id,
    name: row.Name,
    deviceId: row.DeviceId,
    matchType: row.MatchType,
    keywords: parseKeywords(row.Keywords),
    replyMessage: row.ReplyMessage,
    variables: parseVariables(row.Variables),
    options: parseOptions(row.Options),
    attachmentName: row.AttachmentName || '',
    workingHours: parseWorkingHours(row.WorkingHours),
    priority: Number(row.Priority) || 0,
    isActive: Boolean(row.IsActive),
    userId: row.UserId,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt
});

const mapLog = (row) => ({
    id: row.Id,
    ruleId: row.RuleId,
    ruleName: row.RuleName,
    deviceId: row.DeviceId,
    chatId: row.ChatId,
    contactName: row.ContactName,
    incomingText: row.IncomingText,
    matchedKeyword: row.MatchedKeyword,
    replyText: row.ReplyText,
    status: row.Status,
    error: row.ErrorMessage,
    createdAt: row.CreatedAt
});

const validateRuleInput = (input = {}) => {
    const name = String(input.name || '').trim();
    const deviceId = String(input.deviceId || '').trim();
    const matchType = String(input.matchType || 'contains').trim();
    const keywords = parseKeywords(input.keywords);
    const replyMessage = String(input.replyMessage || '').trim();
    const priority = Number.parseInt(input.priority, 10);
    const variables = validateVariables(input.variables);
    const options = validateOptions(input.options);
    const attachmentName = cleanAttachmentName(input.attachmentName);
    const workingHours = validateWorkingHours(input.workingHours);

    if (!name) throw new Error('Rule name is required.');
    if (!deviceId) throw new Error('Device is required.');
    if (!MATCH_TYPES.includes(matchType)) throw new Error('Trigger must be exact, contains or starts_with.');
    if (!keywords.length) throw new Error('Add at least one keyword.');
    if (!replyMessage && !attachmentName) throw new Error('Add a reply message or a file.');

    return {
        name: name.slice(0, 200),
        deviceId,
        matchType,
        keywords,
        replyMessage,
        variables,
        options,
        attachmentName,
        workingHours,
        priority: Number.isFinite(priority) ? Math.max(-1000, Math.min(1000, priority)) : 0,
        isActive: input.isActive === undefined ? true : Boolean(input.isActive)
    };
};

const listRules = async (user, { deviceId } = {}) => {
    await ensureAutomationTables();
    const params = {};
    let where = '';
    if (deviceId) {
        where = ' WHERE DeviceId = @deviceId';
        params.deviceId = String(deviceId);
    }
    const result = await query(
        `SELECT * FROM dbo.AutomationRules${where}
         ORDER BY Priority DESC, CreatedAt ASC`,
        params
    );
    return result.recordset
        .filter((row) => canAccessDevice(user, row.DeviceId))
        .map(mapRule);
};

const getRuleById = async (id) => {
    await ensureAutomationTables();
    const result = await query('SELECT * FROM dbo.AutomationRules WHERE Id = @id', { id: String(id) });
    return result.recordset[0] ? mapRule(result.recordset[0]) : null;
};

const getActiveRulesForDevice = async (deviceId) => {
    await ensureAutomationTables();
    const result = await query(
        `SELECT * FROM dbo.AutomationRules
         WHERE DeviceId = @deviceId AND IsActive = 1
         ORDER BY Priority DESC, CreatedAt ASC`,
        { deviceId: String(deviceId) }
    );
    return result.recordset.map(mapRule);
};

const createRule = async (input, userId) => {
    await ensureAutomationTables();
    const rule = validateRuleInput(input);
    const id = `ar_${crypto.randomBytes(8).toString('hex')}`;
    await query(
        `INSERT INTO dbo.AutomationRules
            (Id, Name, DeviceId, MatchType, Keywords, ReplyMessage, Variables, Options, AttachmentName, WorkingHours, Priority, IsActive, UserId)
         VALUES (@id, @name, @deviceId, @matchType, @keywords, @replyMessage, @variables, @options, @attachmentName, @workingHours, @priority, @isActive, @userId)`,
        {
            id,
            name: rule.name,
            deviceId: rule.deviceId,
            matchType: rule.matchType,
            keywords: rule.keywords.join('\n'),
            replyMessage: rule.replyMessage,
            variables: JSON.stringify(rule.variables),
            options: JSON.stringify(rule.options),
            attachmentName: rule.attachmentName || null,
            workingHours: JSON.stringify(rule.workingHours),
            priority: rule.priority,
            isActive: rule.isActive ? 1 : 0,
            userId: userId || null
        }
    );
    return getRuleById(id);
};

const updateRule = async (id, input) => {
    await ensureAutomationTables();
    const rule = validateRuleInput(input);
    await query(
        `UPDATE dbo.AutomationRules
         SET Name = @name,
             DeviceId = @deviceId,
             MatchType = @matchType,
             Keywords = @keywords,
             ReplyMessage = @replyMessage,
             Variables = @variables,
             Options = @options,
             AttachmentName = @attachmentName,
             WorkingHours = @workingHours,
             Priority = @priority,
             IsActive = @isActive,
             UpdatedAt = SYSUTCDATETIME()
         WHERE Id = @id`,
        {
            id: String(id),
            name: rule.name,
            deviceId: rule.deviceId,
            matchType: rule.matchType,
            keywords: rule.keywords.join('\n'),
            replyMessage: rule.replyMessage,
            variables: JSON.stringify(rule.variables),
            options: JSON.stringify(rule.options),
            attachmentName: rule.attachmentName || null,
            workingHours: JSON.stringify(rule.workingHours),
            priority: rule.priority,
            isActive: rule.isActive ? 1 : 0
        }
    );
    return getRuleById(id);
};

const setRuleActive = async (id, isActive) => {
    await ensureAutomationTables();
    await query(
        `UPDATE dbo.AutomationRules
         SET IsActive = @isActive, UpdatedAt = SYSUTCDATETIME()
         WHERE Id = @id`,
        { id: String(id), isActive: isActive ? 1 : 0 }
    );
    return getRuleById(id);
};

const deleteRule = async (id) => {
    await ensureAutomationTables();
    await query('DELETE FROM dbo.AutomationRules WHERE Id = @id', { id: String(id) });
};

const getUsedAttachmentNames = async () => {
    await ensureAutomationTables();
    const result = await query('SELECT AttachmentName, Options FROM dbo.AutomationRules');
    const names = new Set();
    for (const row of result.recordset) {
        if (row.AttachmentName) names.add(row.AttachmentName);
        parseOptions(row.Options).forEach((option) => {
            if (option.attachmentName) names.add(option.attachmentName);
        });
    }
    return names;
};

const addAutomationLog = async ({
    ruleId,
    ruleName,
    deviceId,
    chatId,
    contactName,
    incomingText,
    matchedKeyword,
    replyText,
    status,
    errorMessage
}) => {
    await ensureAutomationTables();
    await query(
        `INSERT INTO dbo.AutomationLogs
            (RuleId, RuleName, DeviceId, ChatId, ContactName, IncomingText, MatchedKeyword, ReplyText, Status, ErrorMessage)
         VALUES
            (@ruleId, @ruleName, @deviceId, @chatId, @contactName, @incomingText, @matchedKeyword, @replyText, @status, @errorMessage)`,
        {
            ruleId: ruleId || null,
            ruleName: ruleName ? String(ruleName).slice(0, 200) : null,
            deviceId: String(deviceId),
            chatId: String(chatId || '').slice(0, 80),
            contactName: contactName ? String(contactName).slice(0, 120) : null,
            incomingText: incomingText == null ? null : String(incomingText).slice(0, 4000),
            matchedKeyword: matchedKeyword ? String(matchedKeyword).slice(0, 200) : null,
            replyText: replyText == null ? null : String(replyText),
            status: status === 'success' ? 'success' : 'failed',
            errorMessage: errorMessage ? String(errorMessage).slice(0, 800) : null
        }
    );
};

const listAutomationLogs = async (user, { deviceId, ruleId, limit } = {}) => {
    await ensureAutomationTables();
    const top = Math.max(1, Math.min(500, Number.parseInt(limit, 10) || 200));
    const params = {};
    const clauses = [];
    if (deviceId) {
        clauses.push('DeviceId = @deviceId');
        params.deviceId = String(deviceId);
    }
    if (ruleId) {
        clauses.push('RuleId = @ruleId');
        params.ruleId = String(ruleId);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const result = await query(
        `SELECT TOP ${top} * FROM dbo.AutomationLogs${where}
         ORDER BY CreatedAt DESC, Id DESC`,
        params
    );
    return result.recordset
        .filter((row) => canAccessDevice(user, row.DeviceId))
        .map(mapLog);
};

module.exports = {
    MATCH_TYPES,
    ensureAutomationTables,
    listRules,
    getRuleById,
    getActiveRulesForDevice,
    createRule,
    updateRule,
    setRuleActive,
    deleteRule,
    getUsedAttachmentNames,
    addAutomationLog,
    listAutomationLogs
};
