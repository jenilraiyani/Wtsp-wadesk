const {
    loadUsers,
    publicUser,
    createUser,
    updateUser,
    deleteUser,
    findUserById
} = require('../models/userModel');

const list = async (req, res) => {
    const users = await loadUsers();
    res.json({
        success: true,
        users: users.map(publicUser)
    });
};

const create = async (req, res) => {
    try {
        const user = await createUser({
            username: req.body.username,
            email: req.body.email,
            password: req.body.password,
            name: req.body.name,
            role: req.body.role || 'operator',
            allowedDevices: req.body.allowedDevices || []
        });
        return res.json({ success: true, user });
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }
};

const update = async (req, res) => {
    try {
        if (!(await findUserById(req.params.id))) {
            return res.status(404).json({ success: false, error: 'User not found.' });
        }
        const user = await updateUser(req.params.id, {
            username: req.body.username,
            email: req.body.email,
            password: req.body.password,
            name: req.body.name,
            role: req.body.role,
            allowedDevices: req.body.allowedDevices
        });
        return res.json({ success: true, user });
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }
};

const remove = async (req, res) => {
    try {
        await deleteUser(req.params.id, req.user.id);
        return res.json({ success: true, message: 'User deleted.' });
    } catch (error) {
        return res.status(400).json({ success: false, error: error.message });
    }
};

module.exports = { list, create, update, remove };
