const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { config, validateConfig } = require('./config');
const { initPaths, cleanOldUploads, UPLOADS_PATH, ROOT } = require('./utils/paths');
const { getPool } = require('./models/db');
const { ensureAdminUser } = require('./models/userModel');
const { authenticate, requireRole } = require('./middleware/auth');
const { restoreRegisteredDevices } = require('./services/sessionService');
const { ensureBrowserReady, getBrowserErrorMessage, getBrowserPath } = require('./services/browserService');
const { ensureScheduleColumns, getPendingAttachmentNames } = require('./models/campaignModel');
const { ensureAutomationTables } = require('./models/automationModel');
const { ensureTemplateTable } = require('./models/templateModel');
const { ensureContactTables } = require('./models/contactModel');
const { startCampaignScheduler } = require('./services/scheduleService');
const healthController = require('./controllers/healthController');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const devicesRoutes = require('./routes/devices');
const sendRoutes = require('./routes/send');
const campaignsRoutes = require('./routes/campaigns');
const automationRoutes = require('./routes/automation');
const templatesRoutes = require('./routes/templates');
const contactsRoutes = require('./routes/contacts');

initPaths();
validateConfig();

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(UPLOADS_PATH));
app.use('/static', express.static(path.join(__dirname, 'static')));
['asset-manifest.json', 'manifest.json', 'favicon.ico', 'logo192.png', 'logo512.png', 'robots.txt'].forEach((file) => {
    app.get(`/${file}`, (req, res) => res.sendFile(path.join(__dirname, file)));
});
const FRONTEND_INDEX = path.join(__dirname, 'index.html');

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception (server kept alive):', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection (server kept alive):', reason);
});

// Routes (thin) → Controllers → Models / Services
app.get('/api/c', healthController.publicHealth);
app.use('/api/auth', authRoutes);
app.get('/api/health/details', authenticate, requireRole('admin'), healthController.details);
app.get('/api/qr-image', authenticate, devicesRoutes.qrImageHandler);
app.use('/api/users', authenticate, usersRoutes);
app.use('/api/devices', authenticate, devicesRoutes);
app.use('/api', authenticate, sendRoutes);
app.use('/api', authenticate, campaignsRoutes);
app.use('/api', authenticate, automationRoutes);
app.use('/api', authenticate, templatesRoutes);
app.use('/api', authenticate, contactsRoutes);



app.use((req, res) => {
    res.sendFile(FRONTEND_INDEX);
  });

const cleanUploadsSafely = async () => {
    const protectedNames = await getPendingAttachmentNames().catch(() => new Set());
    cleanOldUploads(protectedNames);
};

const startServer = async () => {
    await getPool();
    await ensureScheduleColumns();
    await ensureAutomationTables();
    await ensureTemplateTable();
    await ensureContactTables();
    await ensureAdminUser();
    await ensureBrowserReady();

    app.listen(config.port, () => {
        console.log(`Server running on port ${config.port}`);
        console.log(`Project path: ${ROOT}`);
        console.log(getBrowserPath() ? `Browser: ${getBrowserPath()}` : `WARNING: ${getBrowserErrorMessage()}`);
        console.log(fs.existsSync(FRONTEND_INDEX)
            ? `Frontend: ${config.frontendBuildPath}`
            : 'Frontend build not found — API only (run "npm run build" in frontend).');
        startCampaignScheduler().catch((error) => {
            console.error('Scheduler start failed:', error.message);
        });
        setInterval(() => { cleanUploadsSafely().catch(() => {}); }, 60 * 1000);
        cleanUploadsSafely().catch(() => {});
        restoreRegisteredDevices().catch((error) => {
            console.error('Device restore failed:', error.message);
        });
    });
};

startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});
