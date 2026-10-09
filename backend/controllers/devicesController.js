const QRCode = require('qrcode');
const { loadRegistry, removeFromRegistry, setDeviceCreatedBy, getDeviceAddedByMap } = require('../models/deviceModel');
const {
    sessions,
    createSession,
    destroySession,
    mapDevice,
    waitForDeviceQr,
    removeDeviceAuthFolder,
    forgetDevice,
    rememberDevice,
    isDeviceForgotten
} = require('../services/sessionService');
const { filterDeviceIds, canAccessDevice, grantUserDevice } = require('../models/userModel');
const { getRequestValue, normalizePhoneNumber } = require('../utils/helpers');

const liteMap = (id, lite) => {
    const device = mapDevice(id);
    if (lite) delete device.qr;
    return device;
};

const list = async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const registryIds = (await loadRegistry()).filter((id) => !isDeviceForgotten(id));
    const allIds = filterDeviceIds(req.user, registryIds);

    for (const deviceId of allIds) {
        if (!sessions[deviceId]) {
            sessions[deviceId] = {
                client: null,
                status: 'DISCONNECTED',
                qr: null,
                qrImage: null,
                pairingCode: null,
                error: null
            };
        }
    }

    const devices = allIds.map((id) => liteMap(id, req.query.lite === '1'));

    if (req.user?.role === 'admin') {
        const owners = await getDeviceAddedByMap(allIds);
        for (const device of devices) {
            device.addedBy = owners[device.id] || null;
        }
    }

    res.json(devices);
};

const connected = (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    const listConnected = filterDeviceIds(
        req.user,
        Object.keys(sessions).filter((id) => !isDeviceForgotten(id) && sessions[id]?.status === 'CONNECTED' && sessions[id]?.client)
    ).map((id) => liteMap(id, req.query.lite === '1'));
    res.json(listConnected);
};

const getOne = async (req, res) => {
    const deviceId = req.params.id;
    if (!canAccessDevice(req.user, deviceId)) {
        return res.status(403).json({ success: false, error: 'You do not have access to this device.' });
    }
    const registryIds = await loadRegistry();
    if (!sessions[deviceId] && !registryIds.includes(deviceId)) {
        return res.status(404).json({ success: false, error: 'Device not found' });
    }
    res.json(mapDevice(deviceId));
};

const add = async (req, res) => {
    let deviceId = '';

    try {
        const rawPhoneNumber = getRequestValue(
            req,
            'phoneNumber',
            'phone',
            'mobile',
            'phone_number',
            'phonenumber',
            'number'
        );

        if (rawPhoneNumber == null || rawPhoneNumber === '') {
            return res.status(400).json({
                success: false,
                error: 'phoneNumber is required. Send it in JSON body, form-data, or query string.'
            });
        }

        const cleanNumber = normalizePhoneNumber(rawPhoneNumber);
        if (cleanNumber.length < 9) {
            return res.status(400).json({
                success: false,
                error: 'Invalid phoneNumber. Please send a valid mobile number.'
            });
        }

        deviceId = cleanNumber;
        const phoneNumber = cleanNumber;

        const registryIds = await loadRegistry();
        if (
            req.user?.role !== 'admin'
            && registryIds.includes(deviceId)
            && !canAccessDevice(req.user, deviceId)
        ) {
            return res.status(403).json({
                success: false,
                error: 'This number is already linked to another user. Ask an admin for access.'
            });
        }

        const existingSession = sessions[deviceId];
        if (existingSession?.client && existingSession.status === 'CONNECTED') {
            return res.status(400).json({ success: false, error: 'This phone number is already connected.' });
        }

        rememberDevice(deviceId);
        await destroySession(deviceId);
        await createSession(deviceId, { force: true });
        await waitForDeviceQr(deviceId, { phoneNumber });

        if (req.user?.id && req.user.id !== 'api-key') {
            await setDeviceCreatedBy(deviceId, req.user.id);
        }

        // Operator-owned devices: only this user (+ admin) can see/use them
        if (req.user?.role === 'operator' && req.user?.id) {
            await grantUserDevice(req.user.id, deviceId);
            if (Array.isArray(req.user.allowedDevices) && !req.user.allowedDevices.includes(deviceId)) {
                req.user.allowedDevices.push(deviceId);
            }
        }

        return res.json({
            success: true,
            message: 'WhatsApp connection started successfully!',
            device: mapDevice(deviceId)
        });
    } catch (error) {
        console.error('Add device failed:', error);
        const device = deviceId && sessions[deviceId] ? mapDevice(deviceId) : null;
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to add device',
            device
        });
    }
};

const pairCode = async (req, res) => {
    const { deviceId, phoneNumber } = req.body;

    if (!deviceId || !phoneNumber) {
        return res.status(400).json({ success: false, error: 'deviceId and phoneNumber are required' });
    }

    const session = sessions[deviceId];
    if (!session || session.status !== 'WAITING_FOR_QR') {
        return res.status(400).json({
            success: false,
            error: 'Device is not ready. Please wait for the QR code to generate first before requesting a pairing code.'
        });
    }

    try {
        const cleanNumber = phoneNumber.replace(/\D/g, '');
        console.log(`Requesting pairing code for device ${deviceId} with number ${cleanNumber}...`);
        const code = await session.client.requestPairingCode(cleanNumber);
        session.pairingCode = code;
        res.json({ success: true, code });
    } catch (error) {
        console.error('Failed to request pairing code:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to generate pairing code. Ensure the number is correct.' });
    }
};

const reconnect = async (req, res) => {
    const { deviceId } = req.body;
    if (!deviceId) {
        return res.status(400).json({ success: false, error: 'deviceId is required' });
    }

    rememberDevice(deviceId);
    await destroySession(deviceId);
    await createSession(deviceId, { force: true });
    res.json({ success: true, message: `Reconnecting ${deviceId}...` });
};

const remove = async (req, res) => {
    const { deviceId } = req.body;
    if (!deviceId) {
        return res.status(400).json({ success: false, error: 'deviceId is required' });
    }
    if (!canAccessDevice(req.user, deviceId)) {
        return res.status(403).json({ success: false, error: 'You do not have access to this device.' });
    }

    forgetDevice(deviceId);
    await removeFromRegistry(deviceId);

    if (sessions[deviceId]) {
        await destroySession(deviceId);
    } else {
        removeDeviceAuthFolder(deviceId);
    }

    res.json({ success: true, message: `Device ${deviceId} removed.` });
};

const qrImageHandler = async (req, res) => {
    const data = req.query.data;
    if (!data) {
        return res.status(400).json({ success: false, error: 'Missing data query parameter.' });
    }

    try {
        const buffer = await QRCode.toBuffer(String(data), { width: 220, margin: 1 });
        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'no-store');
        return res.send(buffer);
    } catch (error) {
        return res.status(500).json({ success: false, error: 'Failed to generate QR image.' });
    }
};

module.exports = {
    list,
    connected,
    getOne,
    add,
    pairCode,
    reconnect,
    remove,
    qrImageHandler
};
