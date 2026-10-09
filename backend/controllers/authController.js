const { OAuth2Client } = require('google-auth-library');
const { config } = require('../config');
const {
    findUserByLogin,
    verifyPassword,
    signToken,
    publicUser,
    findOrCreateGoogleUser
} = require('../models/userModel');

const getConfig = (req, res) => {
    res.json({
        success: true,
        googleClientId: config.googleClientId || ''
    });
};

const login = async (req, res) => {
    const loginValue = String(req.body?.email || req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!loginValue || !password) {
        return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const user = await findUserByLogin(loginValue);
    if (!user || !(await verifyPassword(user, password))) {
        return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    return res.json({
        success: true,
        token: signToken(user),
        user: publicUser(user)
    });
};

const googleLogin = async (req, res) => {
    if (!config.googleClientId) {
        return res.status(503).json({
            success: false,
            error: 'Google login is not configured. Set GOOGLE_CLIENT_ID in backend/.env'
        });
    }

    const credential = String(req.body?.credential || '').trim();
    if (!credential) {
        return res.status(400).json({ success: false, error: 'Google credential is required.' });
    }

    try {
        const client = new OAuth2Client(config.googleClientId);
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: config.googleClientId
        });
        const payload = ticket.getPayload() || {};
        if (!payload.email_verified) {
            return res.status(401).json({ success: false, error: 'Google email is not verified.' });
        }

        const user = await findOrCreateGoogleUser({
            googleId: payload.sub,
            email: payload.email,
            name: payload.name
        });

        return res.json({
            success: true,
            token: signToken(user),
            user: publicUser(user)
        });
    } catch (error) {
        return res.status(401).json({ success: false, error: error.message || 'Google login failed.' });
    }
};

const me = (req, res) => {
    res.json({ success: true, user: req.user });
};

module.exports = { getConfig, login, googleLogin, me };
