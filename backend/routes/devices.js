const express = require('express');
const { requireDeviceAccess } = require('../middleware/auth');
const devicesController = require('../controllers/devicesController');

const router = express.Router();

router.get('/', devicesController.list);
router.get('/connected', devicesController.connected);
router.get('/:id', devicesController.getOne);router.post('/add', devicesController.add);
router.post('/pair-code', requireDeviceAccess, devicesController.pairCode);
router.post('/reconnect', requireDeviceAccess, devicesController.reconnect);
router.post('/remove', requireDeviceAccess, devicesController.remove);

module.exports = router;
module.exports.qrImageHandler = devicesController.qrImageHandler;
