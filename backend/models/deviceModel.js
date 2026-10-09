const { query } = require('./db');

let columnsReady = false;

const ensureDeviceColumns = async () => {
    if (columnsReady) return;
    await query(`
        IF COL_LENGTH('dbo.Devices', 'CreatedByUserId') IS NULL
            ALTER TABLE dbo.Devices ADD CreatedByUserId NVARCHAR(40) NULL;
    `);
    columnsReady = true;
};

const loadRegistry = async () => {
    const result = await query('SELECT Id FROM dbo.Devices ORDER BY CreatedAt ASC');
    return (result.recordset || []).map((row) => row.Id);
};

const addToRegistry = async (deviceId) => {
    await ensureDeviceColumns();
    await query(
        `IF NOT EXISTS (SELECT 1 FROM dbo.Devices WHERE Id = @deviceId)
         INSERT INTO dbo.Devices (Id) VALUES (@deviceId)
         ELSE UPDATE dbo.Devices SET UpdatedAt = SYSUTCDATETIME() WHERE Id = @deviceId`,
        { deviceId: String(deviceId) }
    );
};

const setDeviceCreatedBy = async (deviceId, userId) => {
    if (!deviceId || !userId || userId === 'api-key') return;
    await ensureDeviceColumns();
    await query(
        `UPDATE dbo.Devices
         SET CreatedByUserId = COALESCE(NULLIF(CreatedByUserId, ''), @userId),
             UpdatedAt = SYSUTCDATETIME()
         WHERE Id = @deviceId`,
        { deviceId: String(deviceId), userId: String(userId) }
    );
};

/** Map deviceId → { id, name, email, username, role } for who added / owns it. */
const getDeviceAddedByMap = async (deviceIds = []) => {
    await ensureDeviceColumns();
    const ids = [...new Set((deviceIds || []).map(String).filter(Boolean))];
    if (!ids.length) return {};

    const params = {};
    const placeholders = ids.map((id, i) => {
        const key = `id${i}`;
        params[key] = id;
        return `@${key}`;
    });

    const byCreator = await query(
        `
        SELECT d.Id AS DeviceId, u.Id AS UserId, u.Name, u.Email, u.Username, u.Role
        FROM dbo.Devices d
        LEFT JOIN dbo.Users u ON u.Id = d.CreatedByUserId
        WHERE d.Id IN (${placeholders.join(',')})
        `,
        params
    );

    const map = {};
    for (const row of byCreator.recordset || []) {
        if (row.UserId) {
            map[row.DeviceId] = {
                id: row.UserId,
                name: row.Name || row.Username || '',
                email: row.Email || '',
                username: row.Username || '',
                role: row.Role || ''
            };
        }
    }

    const missing = ids.filter((id) => !map[id]);
    if (missing.length) {
        const mParams = {};
        const mPlace = missing.map((id, i) => {
            const key = `m${i}`;
            mParams[key] = id;
            return `@${key}`;
        });
        const linked = await query(
            `
            SELECT ud.DeviceId, u.Id AS UserId, u.Name, u.Email, u.Username, u.Role,
                   ROW_NUMBER() OVER (PARTITION BY ud.DeviceId ORDER BY u.CreatedAt ASC) AS rn
            FROM dbo.UserDevices ud
            INNER JOIN dbo.Users u ON u.Id = ud.UserId
            WHERE ud.DeviceId IN (${mPlace.join(',')})
            `,
            mParams
        );
        for (const row of linked.recordset || []) {
            if (row.rn !== 1 || map[row.DeviceId]) continue;
            map[row.DeviceId] = {
                id: row.UserId,
                name: row.Name || row.Username || '',
                email: row.Email || '',
                username: row.Username || '',
                role: row.Role || ''
            };
        }
    }

    return map;
};

const removeFromRegistry = async (deviceId) => {
    const id = String(deviceId);
    await query('DELETE FROM dbo.UserDevices WHERE DeviceId = @deviceId', { deviceId: id });
    await query('DELETE FROM dbo.Devices WHERE Id = @deviceId', { deviceId: id });
};

module.exports = {
    loadRegistry,
    addToRegistry,
    removeFromRegistry,
    setDeviceCreatedBy,
    getDeviceAddedByMap,
    ensureDeviceColumns
};
