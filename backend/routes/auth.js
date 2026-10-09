const express = require('express');
const { authenticate } = require('../middleware/auth');
const authController = require('../controllers/authController');

const router = express.Router();

router.get('/config', authController.getConfig);
router.post('/login', authController.login);
router.post('/google', authController.googleLogin);
router.get('/me', authenticate, authController.me);

module.exports = router;
