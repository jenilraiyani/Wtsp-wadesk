const { canAccessDevice } = require('../models/userModel');
const {
    listRules,
    getRuleById,
    createRule,
    updateRule,
    setRuleActive,
    deleteRule,
    listAutomationLogs
} = require('../models/automationModel');
const { invalidateRules, saveAutomationFile, cleanupUnusedFiles } = require('../services/automationService');

const cleanupFilesLater = () => {
    cleanupUnusedFiles().catch((error) => console.warn('Automation file cleanup failed:', error.message));
};

const loadOwnedRule = async (req, res) => {
    const rule = await getRuleById(req.params.id);
    if (!rule) {
        res.status(404).json({ success: false, error: 'Rule not found.' });
        return null;
    }
    if (!canAccessDevice(req.user, rule.deviceId)) {
        res.status(403).json({ success: false, error: 'You do not have access to this device.' });
        return null;
    }
    return rule;
};

const list = async (req, res) => {
    try {
        const deviceId = req.query.deviceId ? String(req.query.deviceId) : undefined;
        if (deviceId && !canAccessDevice(req.user, deviceId)) {
            return res.status(403).json({ success: false, error: 'You do not have access to this device.' });
        }
        const rules = await listRules(req.user, { deviceId });
        return res.json({ success: true, rules });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
};

const create = async (req, res) => {
    try {
        const rule = await createRule(req.body || {}, req.user?.id);
        invalidateRules(rule.deviceId);
        return res.json({ success: true, rule });
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }
};

const update = async (req, res) => {
    try {
        const existing = await loadOwnedRule(req, res);
        if (!existing) return;
        const rule = await updateRule(existing.id, req.body || {});
        invalidateRules(existing.deviceId);
        invalidateRules(rule.deviceId);
        cleanupFilesLater();
        return res.json({ success: true, rule });
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }
};

const toggle = async (req, res) => {
    try {
        const existing = await loadOwnedRule(req, res);
        if (!existing) return;
        const isActive = req.body?.isActive === undefined ? !existing.isActive : Boolean(req.body.isActive);
        const rule = await setRuleActive(existing.id, isActive);
        invalidateRules(rule.deviceId);
        return res.json({ success: true, rule });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const existing = await loadOwnedRule(req, res);
        if (!existing) return;
        await deleteRule(existing.id);
        invalidateRules(existing.deviceId);
        cleanupFilesLater();
        return res.json({ success: true, message: 'Rule deleted.' });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
};

const upload = (req, res) => {
    const { filename, mimeType, dataBase64 } = req.body || {};
    if (!filename || !dataBase64) {
        return res.status(400).json({ success: false, error: 'filename and dataBase64 are required' });
    }
    try {
        const saved = saveAutomationFile({ filename, mimeType, dataBase64 });
        return res.json({ success: true, ...saved });
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }
};

const logs = async (req, res) => {
    try {
        const deviceId = req.query.deviceId ? String(req.query.deviceId) : undefined;
        if (deviceId && !canAccessDevice(req.user, deviceId)) {
            return res.status(403).json({ success: false, error: 'You do not have access to this device.' });
        }
        const items = await listAutomationLogs(req.user, {
            deviceId,
            ruleId: req.query.ruleId,
            limit: req.query.limit
        });
        return res.json({ success: true, logs: items });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = {
    list,
    create,
    update,
    toggle,
    remove,
    upload,
    logs
};
