const express = require('express');
const contactsController = require('../controllers/contactsController');

const router = express.Router();

// Every change uses POST because the live host blocks PUT and DELETE with 403.
router.get('/contacts', contactsController.list);
router.get('/contacts/export', contactsController.exportAll);
router.post('/contacts', contactsController.create);
router.post('/contacts/import', contactsController.importList);
router.post('/contacts/delete', contactsController.remove);
router.post('/contacts/:id', contactsController.update);

router.get('/contact-groups', contactsController.groups);
router.post('/contact-groups', contactsController.createGroup);
router.post('/contact-groups/:id', contactsController.renameGroup);
router.post('/contact-groups/:id/delete', contactsController.deleteGroup);
router.post('/contact-groups/:id/add', contactsController.addMembers);
router.post('/contact-groups/:id/remove', contactsController.removeMembers);

module.exports = router;
