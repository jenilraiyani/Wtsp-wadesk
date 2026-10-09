const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');
const { ROOT, PUPPETEER_CACHE_PATH, CHROME_PATH_FILE, WWEB_PUPPETEER_PATH } = require('../utils/paths');

let BROWSER_PATH = null;

const isExecutableFile = (filePath) => {
    try {
        return filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
};

const getLaunchPuppeteer = () => {
    try {
        if (fs.existsSync(path.join(WWEB_PUPPETEER_PATH, 'package.json'))) {
            return require(WWEB_PUPPETEER_PATH);
        }
    } catch {
        // fall through
    }
    return puppeteer;
};

const readSavedChromePath = () => {
    try {
        if (fs.existsSync(CHROME_PATH_FILE)) {
            const saved = fs.readFileSync(CHROME_PATH_FILE, 'utf8').trim();
            if (isExecutableFile(saved)) return saved;
        }
    } catch {   
        // ignore
    }
    return null;
};

const saveChromePath = (chromePath) => {
    try {
        fs.writeFileSync(CHROME_PATH_FILE, chromePath, 'utf8');
    } catch (error) {
        console.warn('Could not save chrome path file:', error.message);
    }
};

const getExtraCacheRoots = () => {
    const roots = [
        PUPPETEER_CACHE_PATH,
        path.join(ROOT, 'node_modules', 'puppeteer', '.local-chromium'),
        path.join(WWEB_PUPPETEER_PATH, '.local-chromium')
    ];

    const home = process.env.USERPROFILE || process.env.HOME || '';
    if (home) {
        roots.push(path.join(home, '.cache', 'puppeteer'));
    }

    if (process.platform === 'win32') {
        const windir = process.env.WINDIR || 'C:\\Windows';
        roots.push(path.join(windir, 'System32', 'config', 'systemprofile', '.cache', 'puppeteer'));
        roots.push(path.join(windir, 'SysWOW64', 'config', 'systemprofile', '.cache', 'puppeteer'));
    }

    return [...new Set(roots)];
};

const findChromeInDirectory = (dir, depth = 0, results = []) => {
    if (!dir || depth > 12) return results;

    let entries;
    try {
        if (!fs.existsSync(dir)) return results;
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return results;
    }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === 'chrome.exe') {
            results.push(fullPath);
        }
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const name = entry.name.toLowerCase();
        if (name === 'node_modules' && depth > 1) continue;
        if (['.git', 'iisnode', 'tmp'].includes(name)) continue;
        findChromeInDirectory(path.join(dir, entry.name), depth + 1, results);
    }

    return results;
};

const collectBrowserCandidates = async () => {
    const candidates = [];
    const add = (candidate) => {
        if (candidate && typeof candidate === 'string') {
            candidates.push(candidate);
        }
    };

    add(readSavedChromePath());

    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        add(process.env.PUPPETEER_EXECUTABLE_PATH);
    }

    if (process.platform === 'win32') {
        [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
        ].forEach(add);
    }

    for (const root of getExtraCacheRoots()) {
        findChromeInDirectory(root).forEach(add);
    }

    findChromeInDirectory(PUPPETEER_CACHE_PATH).forEach(add);
    findChromeInDirectory(path.join(ROOT, 'node_modules', 'puppeteer')).forEach(add);
    findChromeInDirectory(WWEB_PUPPETEER_PATH).forEach(add);

    try {
        const browsers = await import('@puppeteer/browsers');
        const platform = browsers.detectBrowserPlatform();
        const chromeRoot = path.join(PUPPETEER_CACHE_PATH, 'chrome');
        if (platform && fs.existsSync(chromeRoot)) {
            for (const entry of fs.readdirSync(chromeRoot)) {
                const parts = entry.split('-');
                if (parts.length < 2) continue;
                const buildId = parts.slice(1).join('-');
                try {
                    add(browsers.computeExecutablePath({
                        browser: browsers.Browser.CHROME,
                        cacheDir: PUPPETEER_CACHE_PATH,
                        platform,
                        buildId
                    }));
                } catch {
                    // try next build
                }

                try {
                    add(browsers.computeExecutablePath({
                        browser: browsers.Browser.CHROMEHEADLESSSHELL,
                        cacheDir: PUPPETEER_CACHE_PATH,
                        platform,
                        buildId
                    }));
                } catch {
                    // try next build
                }
            }
        }
    } catch (error) {
        console.warn('Puppeteer cache lookup failed:', error.message);
    }

    const launchPuppeteer = getLaunchPuppeteer();
    try {
        add(await launchPuppeteer.executablePath());
    } catch (error) {
        console.warn('WhatsApp puppeteer executablePath failed:', error.message);
    }

    try {
        add(await puppeteer.executablePath());
    } catch (error) {
        console.warn('Root puppeteer executablePath failed:', error.message);
    }

    return [...new Set(candidates)].filter(isExecutableFile);
};

const pickBrowserPath = async () => {
    const saved = readSavedChromePath();
    if (saved) {
        BROWSER_PATH = saved;
        return saved;
    }

    const candidates = await collectBrowserCandidates();
    if (candidates.length > 0) {
        BROWSER_PATH = candidates[0];
        saveChromePath(candidates[0]);
        console.log(`Chrome found: ${candidates[0]}`);
        return candidates[0];
    }

    BROWSER_PATH = null;
    return null;
};

const getBrowserErrorMessage = () => {
    const cacheExists = fs.existsSync(PUPPETEER_CACHE_PATH);
    if (!cacheExists) {
        return 'Chrome cache folder missing. Upload the full httpdocs folder including .puppeteer_cache';
    }
    return 'Chrome found but could not start. Restart IIS Application Pool once, then try again.';
};

const installBundledBrowser = async () => {
    const installScripts = [
        path.join(ROOT, 'node_modules', 'puppeteer', 'install.mjs'),
        path.join(WWEB_PUPPETEER_PATH, 'install.mjs')
    ];

    const env = {
        ...process.env,
        PUPPETEER_CACHE_DIR: PUPPETEER_CACHE_PATH,
        PUPPETEER_DOWNLOAD_PATH: PUPPETEER_CACHE_PATH
    };

    for (const installScript of installScripts) {
        if (!fs.existsSync(installScript)) continue;
        console.log(`Installing Chrome using ${installScript}...`);
        execSync(`"${process.execPath}" "${installScript}"`, {
            cwd: ROOT,
            stdio: 'inherit',
            timeout: 600000,
            env
        });
    }
};

const ensureBrowserReady = async () => {
    let browserPath = await pickBrowserPath();
    if (browserPath) return browserPath;

    try {
        await installBundledBrowser();
    } catch (error) {
        console.error('Automatic browser install failed:', error.message);
    }

    browserPath = await pickBrowserPath();
    return browserPath;
};

const getPuppeteerArgs = () => {
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-default-browser-check'
    ];

    if (process.platform === 'win32') {
        args.push(
            '--disable-software-rasterizer',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-site-isolation-trials'
        );
    }

    if (process.platform !== 'win32') {
        args.push('--disable-software-rasterizer', '--no-zygote', '--single-process');
    }

    return args;
};

const getPuppeteerConfig = () => {
    const config = {
        headless: true,
        args: getPuppeteerArgs(),
        timeout: 120000
    };

    if (BROWSER_PATH && isExecutableFile(BROWSER_PATH)) {
        config.executablePath = BROWSER_PATH;
    }

    return config;
};

const getBrowserPath = () => BROWSER_PATH;

module.exports = {
    collectBrowserCandidates,
    pickBrowserPath,
    ensureBrowserReady,
    getBrowserErrorMessage,
    getPuppeteerConfig,
    getBrowserPath,
    PUPPETEER_CACHE_PATH
};
