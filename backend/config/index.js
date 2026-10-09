const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = {
    port: process.env.PORT || 3000,
    frontendBuildPath: process.env.FRONTEND_BUILD_PATH
        ? path.resolve(path.join(__dirname, '..'), process.env.FRONTEND_BUILD_PATH)
        : path.join(__dirname, '..', '..', 'frontend', 'build'),
    uploadsMaxAgeHours: Number(process.env.UPLOADS_MAX_AGE_HOURS) > 0
        ? Number(process.env.UPLOADS_MAX_AGE_HOURS)
        : 24,
    jwtSecret: process.env.JWT_SECRET || '',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
    apiKey: process.env.API_KEY || '',
    webhookBearer: process.env.WEBHOOK_BEARER_TOKEN || '',
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleAllowedDomain: (process.env.GOOGLE_ALLOWED_DOMAIN || '').trim().toLowerCase(),
    mssql: {
        server: process.env.MSSQL_SERVER || 'localhost',
        database: process.env.MSSQL_DATABASE || 'WhatsAppPanel',
        user: process.env.MSSQL_USER || '',
        password: process.env.MSSQL_PASSWORD || '',
        driver: process.env.MSSQL_DRIVER || 'msnodesqlv8'
    }
};

const validateConfig = () => {
    const missing = [];
    if (!config.jwtSecret || config.jwtSecret.length < 16) missing.push('JWT_SECRET');
    if (!config.adminPassword) missing.push('ADMIN_PASSWORD');
    if (missing.length) {
        throw new Error(`Missing required env values in backend/.env: ${missing.join(', ')}`);
    }
};

module.exports = { config, validateConfig };
