const crypto = require('crypto');
const { query } = require('./db');

const MAX_CONTACTS_PER_USER = 50000;
const MAX_IMPORT_ROWS = 2000;
const MAX_GROUPS_PER_USER = 100;
const MAX_FIELDS = 20;
// SQL Server allows 2100 parameters per request; each imported row uses 3.
const IMPORT_BATCH_SIZE = 500;

let tablesReady = false;

const ensureContactTables = async () => {
    if (tablesReady) return;
    await query(`
        IF OBJECT_ID('dbo.Contacts', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.Contacts (
                Id BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                UserId NVARCHAR(40) NOT NULL,
                Phone NVARCHAR(20) NOT NULL,
                Name NVARCHAR(200) NULL,
                Fields NVARCHAR(MAX) NULL,
                CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Contacts_CreatedAt DEFAULT SYSUTCDATETIME(),
                UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_Contacts_UpdatedAt DEFAULT SYSUTCDATETIME()
            );
            CREATE UNIQUE INDEX UX_Contacts_User_Phone ON dbo.Contacts (UserId, Phone);
        END
    `);
    await query(`
        IF OBJECT_ID('dbo.ContactGroups', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.ContactGroups (
                Id NVARCHAR(40) NOT NULL PRIMARY KEY,
                UserId NVARCHAR(40) NOT NULL,
                Name NVARCHAR(120) NOT NULL,
                CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ContactGroups_CreatedAt DEFAULT SYSUTCDATETIME()
            );
            CREATE UNIQUE INDEX UX_ContactGroups_User_Name ON dbo.ContactGroups (UserId, Name);
        END
    `);
    await query(`
        IF OBJECT_ID('dbo.ContactGroupMembers', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.ContactGroupMembers (
                GroupId NVARCHAR(40) NOT NULL,
                ContactId BIGINT NOT NULL,
                CONSTRAINT PK_ContactGroupMembers PRIMARY KEY (GroupId, ContactId)
            );
            CREATE INDEX IX_ContactGroupMembers_Contact ON dbo.ContactGroupMembers (ContactId);
        END
    `);
    tablesReady = true;
};

const cleanPhone = (value) => {
    const digits = String(value ?? '').replace(/\D/g, '').replace(/^0+/, '');
    if (digits.length === 10) return `91${digits}`;
    return digits.length >= 11 && digits.length <= 15 ? digits : '';
};

const cleanFields = (value) => {
    let source = value;
    if (typeof source === 'string') {
        try {
            source = source.trim() ? JSON.parse(source) : {};
        } catch {
            source = {};
        }
    }
    const out = {};
    Object.entries(source && typeof source === 'object' ? source : {}).slice(0, MAX_FIELDS).forEach(([rawKey, rawValue]) => {
        const key = String(rawKey || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 40);
        if (!key || key === 'phone' || key === 'name') return;
        const text = rawValue == null ? '' : String(rawValue).trim().slice(0, 500);
        if (text) out[key] = text;
    });
    return out;
};

const parseIds = (value) => [...new Set((Array.isArray(value) ? value : [])
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isInteger(id) && id > 0))];

const parseGroupIds = (value) => [...new Set((Array.isArray(value) ? value : [])
    .map((id) => String(id || '').trim())
    .filter((id) => /^cg_[a-f0-9]{16}$/.test(id)))];

const ID_CHUNK = 1000;

const chunk = (list, size = ID_CHUNK) => {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
};

const inList = (prefix, values, params) => values.map((value, i) => {
    params[`${prefix}${i}`] = value;
    return `@${prefix}${i}`;
}).join(', ');

const mapContact = (row) => ({
    id: Number(row.Id),
    phone: row.Phone,
    name: row.Name || '',
    fields: cleanFields(row.Fields),
    groupIds: row.GroupIds ? String(row.GroupIds).split(',').filter(Boolean) : [],
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt
});

const mapGroup = (row) => ({
    id: row.Id,
    name: row.Name,
    count: Number(row.MemberCount) || 0,
    createdAt: row.CreatedAt
});

const countContacts = async (userId) => {
    const result = await query('SELECT COUNT(*) AS Total FROM dbo.Contacts WHERE UserId = @userId', { userId: String(userId) });
    return Number(result.recordset[0]?.Total) || 0;
};

const ownedGroupIds = async (userId, groupIds) => {
    const ids = parseGroupIds(groupIds);
    if (!ids.length) return [];
    const params = { userId: String(userId) };
    const result = await query(
        `SELECT Id FROM dbo.ContactGroups WHERE UserId = @userId AND Id IN (${inList('groupValue', ids, params)})`,
        params
    );
    return result.recordset.map((row) => row.Id);
};

const ownedContactIds = async (userId, contactIds) => {
    const ids = parseIds(contactIds).slice(0, 5000);
    const owned = [];
    for (const part of chunk(ids)) {
        const params = { userId: String(userId) };
        const result = await query(
            `SELECT Id FROM dbo.Contacts WHERE UserId = @userId AND Id IN (${inList('contactValue', part, params)})`,
            params
        );
        result.recordset.forEach((row) => owned.push(Number(row.Id)));
    }
    return owned;
};

const addMembers = async (groupId, contactIds) => {
    for (const part of chunk(contactIds)) {
        const params = { groupId };
        const values = part.map((id, i) => { params[`contactValue${i}`] = id; return `(@contactValue${i})`; }).join(', ');
        await query(
            `SET NOCOUNT ON;
             DECLARE @ids TABLE (ContactId BIGINT PRIMARY KEY);
             INSERT INTO @ids (ContactId) VALUES ${values};
             INSERT INTO dbo.ContactGroupMembers (GroupId, ContactId)
             SELECT @groupId, i.ContactId FROM @ids i
             WHERE NOT EXISTS (
                 SELECT 1 FROM dbo.ContactGroupMembers m WHERE m.GroupId = @groupId AND m.ContactId = i.ContactId
             );`,
            params
        );
    }
};

const listGroups = async (userId) => {
    await ensureContactTables();
    const result = await query(
        `SELECT g.Id, g.Name, g.CreatedAt, COUNT(m.ContactId) AS MemberCount
         FROM dbo.ContactGroups g
         LEFT JOIN dbo.ContactGroupMembers m ON m.GroupId = g.Id
         WHERE g.UserId = @userId
         GROUP BY g.Id, g.Name, g.CreatedAt
         ORDER BY g.Name`,
        { userId: String(userId) }
    );
    return result.recordset.map(mapGroup);
};

const validateGroupName = (value) => {
    const name = String(value || '').trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('Group name is required.');
    return name.slice(0, 120);
};

const findGroupByName = async (userId, name) => {
    const result = await query(
        'SELECT Id FROM dbo.ContactGroups WHERE UserId = @userId AND Name = @name',
        { userId: String(userId), name }
    );
    return result.recordset[0]?.Id || null;
};

const createGroup = async (userId, rawName) => {
    await ensureContactTables();
    const name = validateGroupName(rawName);
    if (await findGroupByName(userId, name)) throw new Error(`Group "${name}" already exists.`);
    const groups = await listGroups(userId);
    if (groups.length >= MAX_GROUPS_PER_USER) throw new Error(`You can create up to ${MAX_GROUPS_PER_USER} groups.`);
    const id = `cg_${crypto.randomBytes(8).toString('hex')}`;
    await query(
        'INSERT INTO dbo.ContactGroups (Id, UserId, Name) VALUES (@id, @userId, @name)',
        { id, userId: String(userId), name }
    );
    return { id, name, count: 0 };
};

const renameGroup = async (userId, groupId, rawName) => {
    await ensureContactTables();
    const name = validateGroupName(rawName);
    const [owned] = await ownedGroupIds(userId, [groupId]);
    if (!owned) throw new Error('Group not found.');
    const existing = await findGroupByName(userId, name);
    if (existing && existing !== owned) throw new Error(`Group "${name}" already exists.`);
    await query('UPDATE dbo.ContactGroups SET Name = @name WHERE Id = @id', { id: owned, name });
};

const deleteGroup = async (userId, groupId) => {
    await ensureContactTables();
    const [owned] = await ownedGroupIds(userId, [groupId]);
    if (!owned) throw new Error('Group not found.');
    await query(
        `DELETE FROM dbo.ContactGroupMembers WHERE GroupId = @id;
         DELETE FROM dbo.ContactGroups WHERE Id = @id;`,
        { id: owned }
    );
};

const addToGroup = async (userId, groupId, contactIds) => {
    await ensureContactTables();
    const [owned] = await ownedGroupIds(userId, [groupId]);
    if (!owned) throw new Error('Group not found.');
    const ids = await ownedContactIds(userId, contactIds);
    await addMembers(owned, ids);
    return ids.length;
};

const removeFromGroup = async (userId, groupId, contactIds) => {
    await ensureContactTables();
    const [owned] = await ownedGroupIds(userId, [groupId]);
    if (!owned) throw new Error('Group not found.');
    const ids = parseIds(contactIds);
    for (const part of chunk(ids)) {
        const params = { groupId: owned };
        await query(
            `DELETE FROM dbo.ContactGroupMembers WHERE GroupId = @groupId AND ContactId IN (${inList('contactValue', part, params)})`,
            params
        );
    }
    return ids.length;
};

const buildContactFilter = (userId, { search, groupId } = {}) => {
    const params = { userId: String(userId) };
    let where = 'WHERE c.UserId = @userId';
    const term = String(search || '').trim().slice(0, 100);
    if (term) {
        params.search = `%${term.replace(/[%_[\]]/g, '[$&]')}%`;
        where += ' AND (c.Phone LIKE @search OR c.Name LIKE @search OR c.Fields LIKE @search)';
    }
    if (groupId) {
        params.groupId = String(groupId);
        where += ' AND EXISTS (SELECT 1 FROM dbo.ContactGroupMembers fm WHERE fm.ContactId = c.Id AND fm.GroupId = @groupId)';
    }
    return { where, params };
};

const CONTACT_COLUMNS = `c.Id, c.Phone, c.Name, c.Fields, c.CreatedAt, c.UpdatedAt,
    STUFF((SELECT ',' + m.GroupId FROM dbo.ContactGroupMembers m WHERE m.ContactId = c.Id FOR XML PATH('')), 1, 1, '') AS GroupIds`;

const listContacts = async (userId, { search, groupId, page, pageSize } = {}) => {
    await ensureContactTables();
    const size = Math.max(10, Math.min(200, Number.parseInt(pageSize, 10) || 50));
    const current = Math.max(1, Number.parseInt(page, 10) || 1);
    const { where, params } = buildContactFilter(userId, { search, groupId });
    const totalResult = await query(`SELECT COUNT(*) AS Total FROM dbo.Contacts c ${where}`, params);
    const result = await query(
        `SELECT ${CONTACT_COLUMNS}
         FROM dbo.Contacts c ${where}
         ORDER BY c.CreatedAt DESC, c.Id DESC
         OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY`,
        { ...params, offset: (current - 1) * size, size }
    );
    return {
        contacts: result.recordset.map(mapContact),
        total: Number(totalResult.recordset[0]?.Total) || 0,
        page: current,
        pageSize: size
    };
};

const exportContacts = async (userId, { search, groupId } = {}) => {
    await ensureContactTables();
    const { where, params } = buildContactFilter(userId, { search, groupId });
    const result = await query(
        `SELECT ${CONTACT_COLUMNS}
         FROM dbo.Contacts c ${where}
         ORDER BY c.CreatedAt DESC, c.Id DESC`,
        params
    );
    return result.recordset.map(mapContact);
};

const validateContactInput = (input = {}) => {
    const phone = cleanPhone(input.phone);
    if (!phone) throw new Error('Enter a valid phone number (10 to 15 digits).');
    return {
        phone,
        name: String(input.name || '').trim().slice(0, 200),
        fields: cleanFields(input.fields)
    };
};

const getContactById = async (userId, id) => {
    const result = await query(
        `SELECT ${CONTACT_COLUMNS} FROM dbo.Contacts c WHERE c.Id = @id AND c.UserId = @userId`,
        { id: Number(id), userId: String(userId) }
    );
    return result.recordset[0] ? mapContact(result.recordset[0]) : null;
};

const setContactGroups = async (userId, contactId, groupIds) => {
    const owned = await ownedGroupIds(userId, groupIds);
    await query('DELETE FROM dbo.ContactGroupMembers WHERE ContactId = @id', { id: contactId });
    for (const groupId of owned) await addMembers(groupId, [contactId]);
};

const createContact = async (userId, input) => {
    await ensureContactTables();
    const contact = validateContactInput(input);
    const existing = await query(
        'SELECT Id FROM dbo.Contacts WHERE UserId = @userId AND Phone = @phone',
        { userId: String(userId), phone: contact.phone }
    );
    if (existing.recordset[0]) throw new Error(`+${contact.phone} is already in your contacts.`);
    if (await countContacts(userId) >= MAX_CONTACTS_PER_USER) {
        throw new Error(`You can save up to ${MAX_CONTACTS_PER_USER} contacts.`);
    }
    const result = await query(
        `INSERT INTO dbo.Contacts (UserId, Phone, Name, Fields)
         OUTPUT INSERTED.Id
         VALUES (@userId, @phone, NULLIF(@name, ''), NULLIF(@fields, ''))`,
        {
            userId: String(userId),
            phone: contact.phone,
            name: contact.name,
            fields: Object.keys(contact.fields).length ? JSON.stringify(contact.fields) : ''
        }
    );
    const id = Number(result.recordset[0].Id);
    await setContactGroups(userId, id, input.groupIds);
    return getContactById(userId, id);
};

const updateContact = async (userId, id, input) => {
    await ensureContactTables();
    const current = await getContactById(userId, id);
    if (!current) throw new Error('Contact not found.');
    const contact = validateContactInput(input);
    const duplicate = await query(
        'SELECT Id FROM dbo.Contacts WHERE UserId = @userId AND Phone = @phone AND Id <> @id',
        { userId: String(userId), phone: contact.phone, id: current.id }
    );
    if (duplicate.recordset[0]) throw new Error(`+${contact.phone} is already in your contacts.`);
    await query(
        `UPDATE dbo.Contacts
         SET Phone = @phone, Name = NULLIF(@name, ''), Fields = NULLIF(@fields, ''), UpdatedAt = SYSUTCDATETIME()
         WHERE Id = @id AND UserId = @userId`,
        {
            id: current.id,
            userId: String(userId),
            phone: contact.phone,
            name: contact.name,
            fields: Object.keys(contact.fields).length ? JSON.stringify(contact.fields) : ''
        }
    );
    if (Array.isArray(input.groupIds)) await setContactGroups(userId, current.id, input.groupIds);
    return getContactById(userId, current.id);
};

const deleteContacts = async (userId, contactIds) => {
    await ensureContactTables();
    const ids = await ownedContactIds(userId, contactIds);
    for (const part of chunk(ids)) {
        const params = { userId: String(userId) };
        const list = inList('contactValue', part, params);
        await query(
            `DELETE FROM dbo.ContactGroupMembers WHERE ContactId IN (${list});
             DELETE FROM dbo.Contacts WHERE UserId = @userId AND Id IN (${list});`,
            params
        );
    }
    return ids.length;
};

const importContacts = async (userId, { contacts, groupIds, newGroupName } = {}) => {
    await ensureContactTables();
    const rows = Array.isArray(contacts) ? contacts : [];
    if (!rows.length) throw new Error('No contacts to import.');
    if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Send at most ${MAX_IMPORT_ROWS} contacts per request.`);

    const unique = new Map();
    let invalid = 0;
    for (const row of rows) {
        const phone = cleanPhone(row?.phone);
        if (!phone) {
            invalid += 1;
            continue;
        }
        if (unique.has(phone)) continue;
        const fields = cleanFields(row?.fields);
        unique.set(phone, {
            phone,
            name: String(row?.name || '').trim().slice(0, 200),
            fields: Object.keys(fields).length ? JSON.stringify(fields) : ''
        });
    }
    const duplicates = rows.length - invalid - unique.size;

    const targetGroups = await ownedGroupIds(userId, groupIds);
    if (String(newGroupName || '').trim()) {
        const name = validateGroupName(newGroupName);
        const existing = await findGroupByName(userId, name);
        targetGroups.push(existing || (await createGroup(userId, name)).id);
    }

    const existingCount = await countContacts(userId);
    let added = 0;
    let updated = 0;
    const list = [...unique.values()];
    for (let start = 0; start < list.length; start += IMPORT_BATCH_SIZE) {
        const batch = list.slice(start, start + IMPORT_BATCH_SIZE);
        const params = { userId: String(userId), room: Math.max(0, MAX_CONTACTS_PER_USER - existingCount - added) };
        const values = batch.map((row, i) => {
            params[`rowPhone${i}`] = row.phone;
            params[`rowName${i}`] = row.name;
            params[`rowFields${i}`] = row.fields;
            return `(@rowPhone${i}, @rowName${i}, @rowFields${i})`;
        });
        const result = await query(
            `SET NOCOUNT ON;
             DECLARE @rows TABLE (Phone NVARCHAR(20) PRIMARY KEY, Name NVARCHAR(200), Fields NVARCHAR(MAX));
             DECLARE @actions TABLE (ActionName NVARCHAR(10));
             INSERT INTO @rows (Phone, Name, Fields) VALUES ${values.join(', ')};
             UPDATE c
                SET Name = COALESCE(NULLIF(r.Name, ''), c.Name),
                    Fields = COALESCE(NULLIF(r.Fields, ''), c.Fields),
                    UpdatedAt = SYSUTCDATETIME()
             OUTPUT 'update' INTO @actions
             FROM dbo.Contacts c
             JOIN @rows r ON c.UserId = @userId AND c.Phone = r.Phone;
             INSERT INTO dbo.Contacts (UserId, Phone, Name, Fields)
             OUTPUT 'insert' INTO @actions
             SELECT TOP (@room) @userId, r.Phone, NULLIF(r.Name, ''), NULLIF(r.Fields, '')
             FROM @rows r
             WHERE NOT EXISTS (SELECT 1 FROM dbo.Contacts c WHERE c.UserId = @userId AND c.Phone = r.Phone);
             SELECT
                 SUM(CASE WHEN ActionName = 'insert' THEN 1 ELSE 0 END) AS Added,
                 SUM(CASE WHEN ActionName = 'update' THEN 1 ELSE 0 END) AS Updated
             FROM @actions;`,
            params
        );
        added += Number(result.recordset[0]?.Added) || 0;
        updated += Number(result.recordset[0]?.Updated) || 0;

        if (targetGroups.length) {
            const idParams = { userId: String(userId) };
            const idResult = await query(
                `SELECT Id FROM dbo.Contacts
                 WHERE UserId = @userId AND Phone IN (${inList('phoneValue', batch.map((row) => row.phone), idParams)})`,
                idParams
            );
            const ids = idResult.recordset.map((row) => Number(row.Id));
            for (const groupId of targetGroups) await addMembers(groupId, ids);
        }
    }

    const skippedByLimit = unique.size - added - updated;
    return { added, updated, duplicates, invalid, skippedByLimit, groupIds: targetGroups };
};

module.exports = {
    MAX_CONTACTS_PER_USER,
    MAX_IMPORT_ROWS,
    ensureContactTables,
    listContacts,
    exportContacts,
    createContact,
    updateContact,
    deleteContacts,
    importContacts,
    listGroups,
    createGroup,
    renameGroup,
    deleteGroup,
    addToGroup,
    removeFromGroup
};
