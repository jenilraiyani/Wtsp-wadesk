const crypto = require('crypto');
const { query } = require('./db');

const MAX_TEMPLATES_PER_USER = 5;

let tableReady = false;

const ensureTemplateTable = async () => {
    if (tableReady) return;
    await query(`
        IF OBJECT_ID('dbo.MessageTemplates', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.MessageTemplates (
                Id NVARCHAR(40) NOT NULL PRIMARY KEY,
                UserId NVARCHAR(40) NOT NULL,
                Name NVARCHAR(200) NOT NULL,
                Body NVARCHAR(MAX) NULL,
                ImageName NVARCHAR(260) NULL,
                FileName NVARCHAR(260) NULL,
                CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_MessageTemplates_CreatedAt DEFAULT SYSUTCDATETIME(),
                UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_MessageTemplates_UpdatedAt DEFAULT SYSUTCDATETIME()
            );
            CREATE INDEX IX_MessageTemplates_User ON dbo.MessageTemplates (UserId, CreatedAt);
        END
    `);
    tableReady = true;
};

const extractVariables = (body) => {
    const found = new Set();
    String(body || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
        found.add(String(key).toLowerCase());
        return '';
    });
    return [...found];
};

const cleanFileName = (value) => {
    const name = String(value || '').trim();
    if (!name) return '';
    if (!/^[\w.-]{1,200}$/.test(name)) throw new Error('Invalid file.');
    return name;
};

const mapTemplate = (row) => ({
    id: row.Id,
    userId: row.UserId,
    name: row.Name,
    body: row.Body || '',
    imageName: row.ImageName || '',
    fileName: row.FileName || '',
    variables: extractVariables(row.Body),
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt
});

const validateTemplateInput = (input = {}) => {
    const name = String(input.name || '').trim();
    const body = String(input.body || '').trim();
    const imageName = cleanFileName(input.imageName);
    const fileName = cleanFileName(input.fileName);
    if (!name) throw new Error('Template name is required.');
    if (!body && !imageName && !fileName) throw new Error('Add a message, image or file.');
    return { name: name.slice(0, 200), body, imageName, fileName };
};

const listTemplates = async (userId) => {
    await ensureTemplateTable();
    const result = await query(
        `SELECT * FROM dbo.MessageTemplates
         WHERE UserId = @userId
         ORDER BY CreatedAt ASC`,
        { userId: String(userId || '') }
    );
    return result.recordset.map(mapTemplate);
};

const getTemplateById = async (id) => {
    await ensureTemplateTable();
    const result = await query('SELECT * FROM dbo.MessageTemplates WHERE Id = @id', { id: String(id) });
    return result.recordset[0] ? mapTemplate(result.recordset[0]) : null;
};

const countTemplates = async (userId) => {
    await ensureTemplateTable();
    const result = await query(
        'SELECT COUNT(*) AS Total FROM dbo.MessageTemplates WHERE UserId = @userId',
        { userId: String(userId || '') }
    );
    return Number(result.recordset[0]?.Total) || 0;
};

const createTemplate = async (input, userId) => {
    if (!userId) throw new Error('Login required.');
    const template = validateTemplateInput(input);
    if (await countTemplates(userId) >= MAX_TEMPLATES_PER_USER) {
        throw new Error(`You can create only ${MAX_TEMPLATES_PER_USER} templates. Delete one to add a new template.`);
    }
    const id = `t_${crypto.randomBytes(8).toString('hex')}`;
    await query(
        `INSERT INTO dbo.MessageTemplates (Id, UserId, Name, Body, ImageName, FileName)
         VALUES (@id, @userId, @name, @body, @imageName, @fileName)`,
        {
            id,
            userId: String(userId),
            name: template.name,
            body: template.body || null,
            imageName: template.imageName || null,
            fileName: template.fileName || null
        }
    );
    return getTemplateById(id);
};

const updateTemplate = async (id, input) => {
    await ensureTemplateTable();
    const template = validateTemplateInput(input);
    await query(
        `UPDATE dbo.MessageTemplates
         SET Name = @name,
             Body = @body,
             ImageName = @imageName,
             FileName = @fileName,
             UpdatedAt = SYSUTCDATETIME()
         WHERE Id = @id`,
        {
            id: String(id),
            name: template.name,
            body: template.body || null,
            imageName: template.imageName || null,
            fileName: template.fileName || null
        }
    );
    return getTemplateById(id);
};

const deleteTemplate = async (id) => {
    await ensureTemplateTable();
    await query('DELETE FROM dbo.MessageTemplates WHERE Id = @id', { id: String(id) });
};

const getUsedTemplateFileNames = async () => {
    await ensureTemplateTable();
    const result = await query('SELECT ImageName, FileName FROM dbo.MessageTemplates');
    const names = new Set();
    result.recordset.forEach((row) => {
        if (row.ImageName) names.add(row.ImageName);
        if (row.FileName) names.add(row.FileName);
    });
    return names;
};

module.exports = {
    MAX_TEMPLATES_PER_USER,
    ensureTemplateTable,
    listTemplates,
    getTemplateById,
    countTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    getUsedTemplateFileNames
};
