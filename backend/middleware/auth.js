const userModel = require('../models/userModel');

module.exports = {
    authenticate: userModel.authenticate,
    requireRole: userModel.requireRole,
    requireDeviceAccess: userModel.requireDeviceAccess,
    canAccessDevice: userModel.canAccessDevice,
    filterDeviceIds: userModel.filterDeviceIds,
    publicUser: userModel.publicUser,
    signToken: userModel.signToken
};
