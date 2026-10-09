const express = require('express');
const { requireRole } = require('../middleware/auth');
const usersController = require('../controllers/usersController');

const router = express.Router();

router.get('/', requireRole('admin'), usersController.list);
router.post('/', requireRole('admin'), usersController.create);
router.put('/:id', requireRole('admin'), usersController.update);
router.delete('/:id', requireRole('admin'), usersController.remove);

module.exports = router;