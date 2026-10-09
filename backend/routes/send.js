const express = require('express');
const { requireDeviceAccess } = require('../middleware/auth');
const sendController = require('../controllers/sendController');

const router = express.Router();

router.post('/upload-attachment', sendController.uploadAttachment);
router.post('/send-bulk', requireDeviceAccess, sendController.sendBulk);
router.post('/send', requireDeviceAccess, sendController.sendOne);
router.post('/send-image', requireDeviceAccess, sendController.sendImage);
router.get('/compose-stats', sendController.composeStats);

module.exports = router;
