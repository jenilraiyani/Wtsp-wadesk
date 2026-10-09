const fs = require('fs');
const path = require('path');
const mime = require('mime');
const { getUsedTemplateFileNames } = require('../models/templateModel');
const { UPLOADS_PATH } = require('../utils/paths');

// Subfolder of uploads: the hourly upload cleanup only deletes top-level files, so template files stay.
const TEMPLATE_FOLDER = 'templates';
const TEMPLATE_FILES_PATH = path.join(UPLOADS_PATH, TEMPLATE_FOLDER);
const UNUSED_FILE_GRACE_MS = 60 * 60 * 1000;

const ALLOWED_TYPES = {
    image: /^image\//,
    file: /^(application\/pdf|video\/.+|audio\/.+|text\/plain|application\/msword|application\/vnd\.ms-(excel|powerpoint)|application\/vnd\.openxmlformats-officedocument\..+)$/
};

const saveTemplateFile = ({ kind, filename, mimeType, dataBase64 }) => {
    const rule = ALLOWED_TYPES[kind];
    if (!rule) throw new Error('kind must be image or file.');
    const type = String(mimeType || mime.getType(filename || '') || '');
    if (!rule.test(type)) {
        throw new Error(kind === 'image'
            ? 'Only image files are allowed here.'
            : 'Allowed files: PDF, video, audio, Word, Excel, PowerPoint or text.');
    }
    if (!fs.existsSync(TEMPLATE_FILES_PATH)) fs.mkdirSync(TEMPLATE_FILES_PATH, { recursive: true });
    const safeName = `${Date.now()}_${path.basename(String(filename)).replace(/[^a-zA-Z0-9._-]/g, '_')}`.slice(0, 200);
    fs.writeFileSync(path.join(TEMPLATE_FILES_PATH, safeName), Buffer.from(dataBase64, 'base64'));
    return { name: safeName, mimeType: type };
};

const templateAttachmentNames = (template) => [template.imageName, template.fileName]
    .filter(Boolean)
    .map((name) => `${TEMPLATE_FOLDER}/${name}`);

const missingTemplateFiles = (template) => [template.imageName, template.fileName]
    .filter(Boolean)
    .filter((name) => !fs.existsSync(path.join(TEMPLATE_FILES_PATH, name)));

const cleanupUnusedTemplateFiles = async () => {
    if (!fs.existsSync(TEMPLATE_FILES_PATH)) return;
    const used = await getUsedTemplateFileNames();
    const now = Date.now();
    for (const file of fs.readdirSync(TEMPLATE_FILES_PATH)) {
        if (used.has(file)) continue;
        const filePath = path.join(TEMPLATE_FILES_PATH, file);
        try {
            const stats = fs.statSync(filePath);
            if (stats.isFile() && now - stats.mtimeMs > UNUSED_FILE_GRACE_MS) fs.unlinkSync(filePath);
        } catch (error) {
            console.warn(`Could not remove template file ${file}:`, error.message);
        }
    }
};

module.exports = {
    saveTemplateFile,
    templateAttachmentNames,
    missingTemplateFiles,
    cleanupUnusedTemplateFiles
};
