const express = require('express');
const { requireDeviceAccess } = require('../middleware/auth');
const campaignsController = require('../controllers/campaignsController');

const router = express.Router();

router.post('/send-bulk-stream', requireDeviceAccess, campaignsController.sendBulkStream);
router.post('/send-voter-slips-stream', requireDeviceAccess, campaignsController.sendVoterSlipsStream);
router.post('/stop-stream', requireDeviceAccess, campaignsController.stopStream);
router.post('/pause-stream', requireDeviceAccess, campaignsController.pauseStream);
router.post('/resume-stream', requireDeviceAccess, campaignsController.resumeStream);
router.get('/stats', campaignsController.stats);
router.get('/campaigns', campaignsController.list);
router.get('/campaigns/scheduled', campaignsController.listScheduled);
router.post('/campaigns/schedule', requireDeviceAccess, campaignsController.schedule);
router.post('/campaigns/:id/cancel-schedule', campaignsController.cancelSchedule);
router.get('/campaigns/:id/logs', campaignsController.logs);

module.exports = router;
