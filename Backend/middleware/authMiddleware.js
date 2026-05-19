const native = require('../utils/nativeCrypto');
const User = require('../models/User');
const { masterDecrypt, safeDecrypt } = require('../utils/encryption');
const { hasLegacyKeyBundle, regenerateUserKeyBundle } = require('../utils/keyManagement');

const protect = async (req, res, next) => {
    try {
        let token;
        if (req.headers.authorization?.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
        }

        let decoded;
        try {
            decoded = native.verifyJwt(token, process.env.JWT_SECRET);
        } catch {
            return res.status(401).json({ success: false, message: 'Token is not valid.' });
        }

        // Reject temp 2FA tokens from accessing protected routes
        if (decoded.type === 'temp_2fa') {
            return res.status(401).json({ success: false, message: 'Complete two-factor authentication first.' });
        }

        const user = await User.findById(decoded.id).select('-password');
        if (!user) {
            return res.status(401).json({ success: false, message: 'User not found.' });
        }

        // Decrypt user's data key and attach to request for use in controllers
        if (user.encryptedDataKey) {
            const rawKey = await masterDecrypt(user.encryptedDataKey);
            req.dataKey = Buffer.from(rawKey, 'hex');

            // JIT migration: if the user still carries hex-JSON keypairs from
            // the Python era, rotate them to PEM now. One-time cost per legacy
            // user. After this, signRecord / encryptNote / getUserPrivateKeys
            // all see PEM and don't need to branch.
            if (hasLegacyKeyBundle(user)) {
                await regenerateUserKeyBundle(user, req.dataKey);
                await user.save();
            }

            req.user = user;
            req.user._name  = await safeDecrypt(user.name, req.dataKey);
            req.user._email = await safeDecrypt(user.email, req.dataKey);
        } else {
            // Legacy user without encryption at all
            req.dataKey = null;
            req.user = user;
            req.user._name  = user.name;
            req.user._email = user.email;
        }

        next();
    } catch (error) {
        console.error('Auth middleware error:', error.message);
        return res.status(401).json({ success: false, message: 'Token is not valid.' });
    }
};

const generateToken = async (id) => {
    return native.signJwt({ id }, process.env.JWT_SECRET, process.env.JWT_EXPIRE || '30d');
};

// Short-lived token used only to gate the 2FA verification step
const generateTempToken = async (id) => {
    return native.signJwt({ id, type: 'temp_2fa' }, process.env.JWT_SECRET, '5m');
};

module.exports = { protect, generateToken, generateTempToken };
