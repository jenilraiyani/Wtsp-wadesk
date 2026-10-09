const express = require('express');
const { requireDeviceAccess } = require('../middleware/auth');
const templatesController = require('../controllers/templatesController');

const router = express.Router();

router.get('/templates', templatesController.list);
router.post('/templates', templatesController.create);
router.post('/templates/upload', templatesController.upload);
router.put('/templates/:id', templatesController.update);
router.delete('/templates/:id', templatesController.remove);
router.post('/templates/:id/send-stream', requireDeviceAccess, templatesController.sendStream);

module.exports = router;
