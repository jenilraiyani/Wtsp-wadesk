const {
    MAX_CONTACTS_PER_USER,
    MAX_IMPORT_ROWS,
    listContacts,
    exportContacts,
    createContact,
    updateContact,
    deleteContacts,
    importContacts,
    listGroups,
    createGroup,
    renameGroup,
    deleteGroup,
    addToGroup,
    removeFromGroup
} = require('../models/contactModel');

const userIdOf = (req) => String(req.user?.id || '');

const handle = (action, errorStatus = 400) => async (req, res) => {
    try {
        if (!userIdOf(req)) return res.status(401).json({ success: false, error: 'Login required.' });
        const payload = await action(req);
        return res.json({ success: true, ...payload });
    } catch (error) {
        return res.status(errorStatus).json({ success: false, error: error.message });
    }
};

const list = handle(async (req) => ({
    ...(await listContacts(userIdOf(req), req.query)),
    limit: MAX_CONTACTS_PER_USER,
    importBatch: MAX_IMPORT_ROWS
}), 500);

const exportAll = handle(async (req) => ({ contacts: await exportContacts(userIdOf(req), req.query) }), 500);

const create = handle(async (req) => ({ contact: await createContact(userIdOf(req), req.body || {}) }));

const update = handle(async (req) => ({ contact: await updateContact(userIdOf(req), req.params.id, req.body || {}) }));

const remove = handle(async (req) => ({ deleted: await deleteContacts(userIdOf(req), req.body?.ids) }));

const importList = handle(async (req) => importContacts(userIdOf(req), req.body || {}));

const groups = handle(async (req) => ({ groups: await listGroups(userIdOf(req)) }), 500);

const createGroupHandler = handle(async (req) => ({ group: await createGroup(userIdOf(req), req.body?.name) }));

const renameGroupHandler = handle(async (req) => {
    await renameGroup(userIdOf(req), req.params.id, req.body?.name);
    return {};
});

const deleteGroupHandler = handle(async (req) => {
    await deleteGroup(userIdOf(req), req.params.id);
    return {};
});

const addMembers = handle(async (req) => ({ added: await addToGroup(userIdOf(req), req.params.id, req.body?.contactIds) }));

const removeMembers = handle(async (req) => ({ removed: await removeFromGroup(userIdOf(req), req.params.id, req.body?.contactIds) }));

module.exports = {
    list,
    exportAll,
    create,
    update,
    remove,
    importList,
    groups,
    createGroup: createGroupHandler,
    renameGroup: renameGroupHandler,
    deleteGroup: deleteGroupHandler,
    addMembers,
    removeMembers
};
