const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const AUTH_DATA_PATH = path.join(ROOT, '.baileys_auth');
const TEMP_DATA_PATH = path.join(ROOT, 'tmp');
const PUPPETEER_CACHE_PATH = path.join(ROOT, '.puppeteer_cache');
const UPLOADS_PATH = path.join(ROOT, 'uploads');
const DATA_PATH = path.join(ROOT, 'data');
const REGISTRY_PATH = path.join(ROOT, 'devices.json');
const USERS_PATH = path.join(DATA_PATH, 'users.json');
const CHROME_PATH_FILE = path.join(ROOT, '.chrome-path');
const WWEB_PUPPETEER_PATH = path.join(ROOT, 'node_modules', 'whatsapp-web.js', 'node_modules', 'puppeteer');
const { config } = require('../config');

const UPLOADS_MAX_AGE_MS = config.uploadsMaxAgeHours * 60 * 60 * 1000;

const ensureDir = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

const initPaths = () => {
    [AUTH_DATA_PATH, TEMP_DATA_PATH, PUPPETEER_CACHE_PATH, UPLOADS_PATH, DATA_PATH].forEach(ensureDir);
    process.env.TEMP = TEMP_DATA_PATH;
    process.env.TMP = TEMP_DATA_PATH;
    process.env.PUPPETEER_CACHE_DIR = PUPPETEER_CACHE_PATH;
};

const cleanOldUploads = (protectedNames = new Set()) => {
    try {
        if (!fs.existsSync(UPLOADS_PATH)) return;
        const now = Date.now();
        const files = fs.readdirSync(UPLOADS_PATH);

        for (const file of files) {
            if (protectedNames.has(file)) continue;
            const filePath = path.join(UPLOADS_PATH, file);
            try {
                const stats = fs.statSync(filePath);
                if (!stats.isFile()) continue;
                if (now - stats.mtimeMs > UPLOADS_MAX_AGE_MS) {
                    fs.unlinkSync(filePath);
                    console.log(`Auto-deleted expired upload: ${file}`);
                }
            } catch (fileErr) {
                console.warn(`Could not check/delete ${file}:`, fileErr.message);
            }
        }
    } catch (error) {
        console.error('cleanOldUploads failed:', error.message);
    }
};

module.exports = {
    ROOT,
    AUTH_DATA_PATH,
    TEMP_DATA_PATH,
    PUPPETEER_CACHE_PATH,
    UPLOADS_PATH,
    DATA_PATH,
    REGISTRY_PATH,
    USERS_PATH,
    CHROME_PATH_FILE,
    WWEB_PUPPETEER_PATH,
    ensureDir,
    initPaths,
    cleanOldUploads
};
