const fs = require('fs');
const { collectBrowserCandidates, pickBrowserPath, getBrowserPath, PUPPETEER_CACHE_PATH } = require('../services/browserService');
const { sessions } = require('../services/sessionService');
const { loadRegistry } = require('../models/deviceModel');
const { ROOT } = require('../utils/paths');

const publicHealth = (req, res) => {
    res.json({ ok: true, sessions: Object.keys(sessions).length });
};

const details = async (req, res) => {
    const browserPath = await pickBrowserPath();
    const candidates = await collectBrowserCandidates();
    res.json({
        ok: true,
        browserFound: !!browserPath,
        browserPath: getBrowserPath() || browserPath,
        candidateCount: candidates.length,
        candidates: candidates.slice(0, 5),
        cacheFolder: PUPPETEER_CACHE_PATH,
        cacheExists: fs.existsSync(PUPPETEER_CACHE_PATH),
        projectPath: ROOT,
        platform: process.platform,
        sessions: Object.keys(sessions).length,
        registry: (await loadRegistry()).length
    });
};

module.exports = { publicHealth, details };
