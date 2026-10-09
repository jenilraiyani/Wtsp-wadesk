const {
    MAX_TEMPLATES_PER_USER,
    listTemplates,
    getTemplateById,
    createTemplate,
    updateTemplate,
    deleteTemplate
} = require('../models/templateModel');
const {
    saveTemplateFile,
    templateAttachmentNames,
    missingTemplateFiles,
    cleanupUnusedTemplateFiles
} = require('../services/templateService');
const campaignsController = require('./campaignsController');

const cleanupFilesLater = () => {
    cleanupUnusedTemplateFiles().catch((error) => console.warn('Template file cleanup failed:', error.message));
};

const loadOwnTemplate = async (req, res) => {
    const template = await getTemplateById(req.params.id);
    if (!template || template.userId !== String(req.user?.id || '')) {
        res.status(404).json({ success: false, error: 'Template not found.' });
        return null;
    }
    return template;
};

const list = async (req, res) => {
    try {
        const templates = await listTemplates(req.user?.id);
        return res.json({ success: true, templates, limit: MAX_TEMPLATES_PER_USER });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
};

const create = async (req, res) => {
    try {
        const template = await createTemplate(req.body || {}, req.user?.id);
        return res.json({ success: true, template });
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }
};

const update = async (req, res) => {
    try {
        const existing = await loadOwnTemplate(req, res);
        if (!existing) return;
        const template = await updateTemplate(existing.id, req.body || {});
        cleanupFilesLater();
        return res.json({ success: true, template });
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const existing = await loadOwnTemplate(req, res);
        if (!existing) return;
        await deleteTemplate(existing.id);
        cleanupFilesLater();
        return res.json({ success: true, message: 'Template deleted.' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
};

const upload = (req, res) => {
    const { kind, filename, mimeType, dataBase64 } = req.body || {};
    if (!filename || !dataBase64) {
        return res.status(400).json({ success: false, error: 'filename and dataBase64 are required' });
    }
    try {
        const saved = saveTemplateFile({ kind, filename, mimeType, dataBase64 });
        return res.json({ success: true, ...saved });
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }
};

const sendStream = async (req, res) => {
    try {
        const template = await loadOwnTemplate(req, res);
        if (!template) return;
        const missing = missingTemplateFiles(template);
        if (missing.length) {
            return res.status(400).json({ success: false, error: `Template file not found: ${missing.join(', ')}` });
        }
        req.body = {
            deviceId: req.body.deviceId,
            name: req.body.name || `Template: ${template.name}`,
            numbers: req.body.numbers,
            recipients: req.body.recipients,
            minGap: req.body.minGap,
            maxGap: req.body.maxGap,
            message: template.body,
            attachmentNames: templateAttachmentNames(template)
        };
        return campaignsController.sendBulkStream(req, res);
    } catch (error) {
        if (res.headersSent) return res.end();
        return res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = {
    list,
    create,
    update,
    remove,
    upload,
    sendStream
};
