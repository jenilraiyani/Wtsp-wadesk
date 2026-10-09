const express = require('express');
const { requireDeviceAccess } = require('../middleware/auth');
const automationController = require('../controllers/automationController');

const router = express.Router();

router.get('/automation/rules', automationController.list);
router.post('/automation/rules', requireDeviceAccess, automationController.create);
router.put('/automation/rules/:id', requireDeviceAccess, automationController.update);
// Some hosts block PUT with 403, so the page saves edits with POST.
router.post('/automation/rules/:id', requireDeviceAccess, automationController.update);
router.patch('/automation/rules/:id/toggle', automationController.toggle);
router.delete('/automation/rules/:id', automationController.remove);
router.get('/automation/logs', automationController.logs);
router.post('/automation/upload', automationController.upload);

module.exports = router;
