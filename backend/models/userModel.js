const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { config } = require('../config');
const { query } = require('./db');
const { getDeviceIdFromRequest } = require('../utils/helpers');

const SALT_ROUNDS = 10;

const publicUser = (user) => ({
    id: user.id,
    username: user.username,
    email: user.email || '',
    name: user.name || user.username,
    role: user.role,
    authProvider: user.authProvider || 'local',
    allowedDevices: Array.isArray(user.allowedDevices) ? user.allowedDevices : [],
    createdAt: user.createdAt
});

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

const mapUser = async (row) => {
    if (!row) return null;
    const devices = await query(
        'SELECT DeviceId FROM dbo.UserDevices WHERE UserId = @userId',
        { userId: row.Id }
    );
    return {
        id: row.Id,
        username: row.Username,
        email: row.Email || '',
        googleId: row.GoogleId || '',
        authProvider: row.AuthProvider || 'local',
        name: row.Name,
        role: row.Role,
        passwordHash: row.PasswordHash,
        allowedDevices: (devices.recordset || []).map((item) => item.DeviceId),
        createdAt: row.CreatedAt
    };
};

const loadUsers = async () => {
    const result = await query('SELECT * FROM dbo.Users ORDER BY CreatedAt ASC');
    const users = [];
    for (const row of result.recordset) {
        users.push(await mapUser(row));
    }
    return users;
};

const findUserByUsername = async (username) => {
    const needle = String(username || '').trim().toLowerCase();
    const result = await query(
        'SELECT TOP 1 * FROM dbo.Users WHERE LOWER(Username) = @username',
        { username: needle }
    );
    return mapUser(result.recordset[0]);
};

const findUserByEmail = async (email) => {
    const needle = String(email || '').trim().toLowerCase();
    if (!needle) return null;
    const result = await query(
        'SELECT TOP 1 * FROM dbo.Users WHERE LOWER(Email) = @email',
        { email: needle }
    );
    return mapUser(result.recordset[0]);
};

const findUserByGoogleId = async (googleId) => {
    if (!googleId) return null;
    const result = await query(
        'SELECT TOP 1 * FROM dbo.Users WHERE GoogleId = @googleId',
        { googleId: String(googleId) }
    );
    return mapUser(result.recordset[0]);
};

const findUserByLogin = async (login) => {
    const needle = String(login || '').trim().toLowerCase();
    if (!needle) return null;
    const byEmail = await findUserByEmail(needle);
    if (byEmail) return byEmail;
    return findUserByUsername(needle);
};

const findUserById = async (id) => {
    const result = await query('SELECT TOP 1 * FROM dbo.Users WHERE Id = @id', { id });
    return mapUser(result.recordset[0]);
};

const setUserDevices = async (userId, deviceIds) => {
    await query('DELETE FROM dbo.UserDevices WHERE UserId = @userId', { userId });
    for (const deviceId of [...new Set((deviceIds || []).map(String))]) {
        await query(
            `IF EXISTS (SELECT 1 FROM dbo.Devices WHERE Id = @deviceId)
             INSERT INTO dbo.UserDevices (UserId, DeviceId) VALUES (@userId, @deviceId)`,
            { userId, deviceId }
        );
    }
};

/** Add one device to an operator without clearing their other devices. */
const grantUserDevice = async (userId, deviceId) => {
    if (!userId || !deviceId || userId === 'api-key') return;
    await query(
        `IF EXISTS (SELECT 1 FROM dbo.Devices WHERE Id = @deviceId)
         AND NOT EXISTS (
             SELECT 1 FROM dbo.UserDevices WHERE UserId = @userId AND DeviceId = @deviceId
         )
         INSERT INTO dbo.UserDevices (UserId, DeviceId) VALUES (@userId, @deviceId)`,
        { userId: String(userId), deviceId: String(deviceId) }
    );
};

const ensureAdminUser = async () => {
    const admins = await query("SELECT COUNT(*) AS Total FROM dbo.Users WHERE Role = 'admin'");
    if (admins.recordset[0].Total > 0) {
        if (config.adminEmail) {
            await query(
                `UPDATE dbo.Users
                 SET Email = @email
                 WHERE Role = 'admin' AND Username = @username AND (Email IS NULL OR Email = '')`,
                { email: config.adminEmail, username: config.adminUsername.trim() || 'admin' }
            );
        }
        return;
    }

    const username = config.adminUsername.trim() || 'admin';
    const passwordHash = await bcrypt.hash(config.adminPassword, SALT_ROUNDS);
    const existing = await findUserByUsername(username);

    if (existing) {
        await query(
            "UPDATE dbo.Users SET Role = 'admin', PasswordHash = @passwordHash, Email = COALESCE(NULLIF(Email, ''), @email) WHERE Id = @id",
            { passwordHash, id: existing.id, email: config.adminEmail || null }
        );
        console.log(`Promoted existing user "${username}" to admin.`);
        return;
    }

    await query(
        `INSERT INTO dbo.Users (Id, Username, Email, Name, PasswordHash, Role, AuthProvider)
         VALUES (@id, @username, @email, @name, @passwordHash, 'admin', 'local')`,
        {
            id: `u_${crypto.randomBytes(8).toString('hex')}`,
            username,
            email: config.adminEmail || null,
            name: 'Admin',
            passwordHash
        }
    );
    console.log(`Seeded admin user "${username}" in MSSQL. Change ADMIN_PASSWORD after first login.`);
};

const uniqueUsernameFromEmail = async (email) => {
    const base = String(email).split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 24) || 'user';
    let username = base;
    let n = 1;
    while (await findUserByUsername(username)) {
        username = `${base}${n}`;
        n += 1;
    }
    return username;
};

const createUser = async ({ username, email, password, name, role, allowedDevices }) => {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) {
        throw new Error('A valid email is required.');
    }
    const cleanUsername = String(username || '').trim() || await uniqueUsernameFromEmail(cleanEmail);
    if (cleanUsername.length < 3) {
        throw new Error('Username must be at least 3 characters.');
    }
    if (!password || String(password).length < 8) {
        throw new Error('Password must be at least 8 characters.');
    }
    if (!['admin', 'operator'].includes(role)) {
        throw new Error('Role must be admin or operator.');
    }
    if (await findUserByUsername(cleanUsername)) {
        throw new Error('Username already exists.');
    }
    if (await findUserByEmail(cleanEmail)) {
        throw new Error('Email already exists.');
    }

    const user = {
        id: `u_${crypto.randomBytes(8).toString('hex')}`,
        username: cleanUsername,
        email: cleanEmail,
        name: String(name || cleanUsername).trim(),
        role,
        allowedDevices: role === 'admin' ? [] : [...new Set((allowedDevices || []).map(String))],
        passwordHash: await bcrypt.hash(String(password), SALT_ROUNDS),
        createdAt: new Date().toISOString()
    };

    await query(
        `INSERT INTO dbo.Users (Id, Username, Email, Name, PasswordHash, Role, AuthProvider)
         VALUES (@id, @username, @email, @name, @passwordHash, @role, 'local')`,
        {
            id: user.id,
            username: user.username,
            email: user.email,
            name: user.name,
            passwordHash: user.passwordHash,
            role: user.role
        }
    );

    if (user.role === 'operator') {
        await setUserDevices(user.id, user.allowedDevices);
    }

    return publicUser(user);
};

const updateUser = async (id, patch = {}) => {
    const user = await findUserById(id);
    if (!user) throw new Error('User not found.');

    if (patch.username) {
        const cleanUsername = String(patch.username).trim();
        const clash = await query(
            'SELECT Id FROM dbo.Users WHERE LOWER(Username) = @username AND Id <> @id',
            { username: cleanUsername.toLowerCase(), id }
        );
        if (clash.recordset.length) throw new Error('Username already exists.');
        user.username = cleanUsername;
    }

    if (patch.email != null) {
        const cleanEmail = String(patch.email).trim().toLowerCase();
        if (!isValidEmail(cleanEmail)) throw new Error('A valid email is required.');
        const clash = await query(
            'SELECT Id FROM dbo.Users WHERE LOWER(Email) = @email AND Id <> @id',
            { email: cleanEmail, id }
        );
        if (clash.recordset.length) throw new Error('Email already exists.');
        user.email = cleanEmail;
    }

    if (patch.name != null) user.name = String(patch.name).trim() || user.username;

    if (patch.role) {
        if (!['admin', 'operator'].includes(patch.role)) {
            throw new Error('Role must be admin or operator.');
        }
        if (user.role === 'admin' && patch.role !== 'admin') {
            const adminCount = await query("SELECT COUNT(*) AS Total FROM dbo.Users WHERE Role = 'admin'");
            if (adminCount.recordset[0].Total <= 1) throw new Error('Cannot demote the last admin.');
        }
        user.role = patch.role;
    }

    if (patch.password) {
        if (String(patch.password).length < 8) {
            throw new Error('Password must be at least 8 characters.');
        }
        user.passwordHash = await bcrypt.hash(String(patch.password), SALT_ROUNDS);
    }

    await query(
        `UPDATE dbo.Users
         SET Username = @username, Email = @email, Name = @name, Role = @role, PasswordHash = @passwordHash
         WHERE Id = @id`,
        {
            id,
            username: user.username,
            email: user.email || null,
            name: user.name,
            role: user.role,
            passwordHash: user.passwordHash
        }
    );

    if (user.role === 'admin') {
        await query('DELETE FROM dbo.UserDevices WHERE UserId = @id', { id });
        user.allowedDevices = [];
    } else if (patch.allowedDevices) {
        user.allowedDevices = [...new Set(patch.allowedDevices.map(String))];
        await setUserDevices(id, user.allowedDevices);
    }

    return publicUser(user);
};

const deleteUser = async (id, requesterId) => {
    if (id === requesterId) throw new Error('You cannot delete your own account.');
    const user = await findUserById(id);
    if (!user) throw new Error('User not found.');
    if (user.role === 'admin') {
        const adminCount = await query("SELECT COUNT(*) AS Total FROM dbo.Users WHERE Role = 'admin'");
        if (adminCount.recordset[0].Total <= 1) throw new Error('Cannot delete the last admin.');
    }
    await query('DELETE FROM dbo.Users WHERE Id = @id', { id });
};

const verifyPassword = async (user, password) => {
    if (!user?.passwordHash) return false;
    return bcrypt.compare(String(password || ''), user.passwordHash);
};

const findOrCreateGoogleUser = async ({ googleId, email, name }) => {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) {
        throw new Error('Google account email is missing.');
    }
    if (config.googleAllowedDomain) {
        const domain = cleanEmail.split('@')[1];
        if (domain !== config.googleAllowedDomain) {
            throw new Error(`Only ${config.googleAllowedDomain} Google accounts are allowed.`);
        }
    }

    let user = await findUserByGoogleId(googleId);
    if (!user) user = await findUserByEmail(cleanEmail);

    if (user) {
        await query(
            `UPDATE dbo.Users
             SET GoogleId = COALESCE(NULLIF(GoogleId, ''), @googleId),
                 Email = COALESCE(NULLIF(Email, ''), @email),
                 AuthProvider = CASE WHEN AuthProvider = 'local' THEN AuthProvider ELSE 'google' END
             WHERE Id = @id`,
            { googleId, email: cleanEmail, id: user.id }
        );
        return findUserById(user.id);
    }

    const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), SALT_ROUNDS);
    const id = `u_${crypto.randomBytes(8).toString('hex')}`;
    const username = await uniqueUsernameFromEmail(cleanEmail);
    await query(
        `INSERT INTO dbo.Users (Id, Username, Email, GoogleId, Name, PasswordHash, Role, AuthProvider)
         VALUES (@id, @username, @email, @googleId, @name, @passwordHash, 'operator', 'google')`,
        {
            id,
            username,
            email: cleanEmail,
            googleId,
            name: name || username,
            passwordHash
        }
    );
    return findUserById(id);
};

const signToken = (user) => jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
);

const canAccessDevice = (user, deviceId) => {
    if (!user || !deviceId) return false;
    if (user.role === 'admin') return true;
    return Array.isArray(user.allowedDevices) && user.allowedDevices.includes(String(deviceId));
};

const filterDeviceIds = (user, deviceIds) => {
    if (!user) return [];
    if (user.role === 'admin') return deviceIds;
    const allowed = user.allowedDevices || [];
    return deviceIds.filter((id) => allowed.includes(String(id)));
};

const authenticate = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && config.apiKey && apiKey === config.apiKey) {
        req.user = {
            id: 'api-key',
            username: 'api-key',
            name: 'API Key',
            role: 'admin',
            allowedDevices: [],
            via: 'api-key'
        };
        return next();
    }

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
        return res.status(401).json({ success: false, error: 'Unauthorized. Login required.' });
    }

    try {
        const payload = jwt.verify(token, config.jwtSecret);
        const user = await findUserById(payload.id);
        if (!user) {
            return res.status(401).json({ success: false, error: 'User not found.' });
        }
        req.user = publicUser(user);
        return next();
    } catch {
        return res.status(401).json({ success: false, error: 'Invalid or expired token.' });
    }
};

const requireRole = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Forbidden. Admin access required.' });
    }
    next();
};

const requireDeviceAccess = (req, res, next) => {
    const deviceId = getDeviceIdFromRequest(req);
    if (!deviceId) {
        return res.status(400).json({ success: false, error: 'deviceId is required.' });
    }
    if (!canAccessDevice(req.user, deviceId)) {
        return res.status(403).json({ success: false, error: 'You do not have access to this device.' });
    }
    next();
};

module.exports = {
    publicUser,
    loadUsers,
    findUserByUsername,
    findUserByEmail,
    findUserByLogin,
    findUserById,
    findOrCreateGoogleUser,
    ensureAdminUser,
    createUser,
    updateUser,
    deleteUser,
    verifyPassword,
    signToken,
    setUserDevices,
    grantUserDevice,
    canAccessDevice,
    filterDeviceIds,
    authenticate,
    requireRole,
    requireDeviceAccess
};
