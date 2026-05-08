const { jwtSign, jwtVerify } = require('../utils/scratch/jwtScratch');
const User = require('../models/User');
const { masterDecrypt, safeDecrypt } = require('../utils/encryption');

const protect = async (req, res, next) => {
    try {
        let token;
        if (req.headers.authorization?.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
        }

        const decoded = jwtVerify(token, process.env.JWT_SECRET);

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
            const rawKey = masterDecrypt(user.encryptedDataKey);
            req.dataKey = Buffer.from(rawKey, 'hex');
            // Attach decrypted PII for convenience
            req.user = user;
            req.user._name  = safeDecrypt(user.name, req.dataKey);
            req.user._email = safeDecrypt(user.email, req.dataKey);
        } else {
            // Legacy user without encryption
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

const generateToken = (id) => {
    return jwtSign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE || '30d'
    });
};

// Short-lived token used only to gate the 2FA verification step
const generateTempToken = (id) => {
    return jwtSign({ id, type: 'temp_2fa' }, process.env.JWT_SECRET, { expiresIn: '5m' });
};

module.exports = { protect, generateToken, generateTempToken };
