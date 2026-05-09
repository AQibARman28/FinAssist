const User = require('../models/User');
const { generateToken, generateTempToken } = require('../middleware/authMiddleware');
const { masterEncrypt, masterDecrypt, encrypt, safeDecrypt, hashEmail, generateDataKey } = require('../utils/encryption');
const { generateUserKeyBundle } = require('../utils/keyManagement');

const buildPublicUser = (user, plainName, plainEmail) => ({
    _id: user._id,
    name: plainName,
    email: plainEmail,
    currency: user.currency,
    role: user.role,
    twoFactorEnabled: user.twoFactorEnabled
});

// POST /api/auth/register
const registerUser = async (req, res) => {
    try {
        const { name, email, password, currency } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ success: false, message: 'Name, email and password are required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
        }

        const emailHash = await hashEmail(email);
        if (await User.findOne({ emailHash })) {
            return res.status(400).json({ success: false, message: 'Email already registered' });
        }

        // Generate per-user AES data key, encrypt it with the system master key
        const rawDataKey = generateDataKey();
        const encryptedDataKey = await masterEncrypt(rawDataKey);
        const dataKeyBuf = Buffer.from(rawDataKey, 'hex');

        // Encrypt PII
        const encName  = await encrypt(name, dataKeyBuf);
        const encEmail = await encrypt(email, dataKeyBuf);

        // Generate RSA-2048 + ECC P-256 key pairs; store private keys encrypted
        const keyBundle = await generateUserKeyBundle(dataKeyBuf);

        const user = await User.create({
            name: encName,
            email: encEmail,
            emailHash,
            password,
            currency: currency || 'BDT',
            encryptedDataKey,
            ...keyBundle
        });

        res.status(201).json({
            success: true,
            data: {
                ...buildPublicUser(user, name, email),
                token: (await generateToken(user._id))
            }
        });
    } catch (error) {
        console.error('Register error:', error);
        if (error.name === 'ValidationError') {
            const msg = Object.values(error.errors).map(e => e.message).join(', ');
            return res.status(400).json({ success: false, message: msg });
        }
        res.status(500).json({ success: false, message: 'Server error during registration' });
    }
};

// POST /api/auth/login
const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required' });
        }

        const emailHash = await hashEmail(email);
        const user = await User.findOne({ emailHash });

        if (!user || !(await user.comparePassword(password))) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        // 2FA — issue a short-lived temp token and wait for TOTP verification
        if (user.twoFactorEnabled) {
            return res.json({
                success: true,
                requires2FA: true,
                tempToken: (await generateTempToken(user._id))
            });
        }

        // Decrypt PII for the response
        const rawKey = await masterDecrypt(user.encryptedDataKey);
        const dataKey = Buffer.from(rawKey, 'hex');

        res.json({
            success: true,
            data: {
                ...buildPublicUser(user, (await safeDecrypt(user.name, dataKey)), (await safeDecrypt(user.email, dataKey))),
                token: (await generateToken(user._id))
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error during login' });
    }
};

// GET /api/auth/profile
const getUserProfile = async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                ...buildPublicUser(req.user, req.user._name, req.user._email),
                rsaPublicKey: req.user.rsaPublicKey,
                eccPublicKey: req.user.eccPublicKey,
                keyVersion:   req.user.keyVersion
            }
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching profile' });
    }
};

// PUT /api/auth/profile
const updateUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const dataKey = req.dataKey;

        if (req.body.name)     user.name  = await encrypt(req.body.name, dataKey);
        if (req.body.currency) user.currency = req.body.currency;

        // Email change requires updating emailHash too
        if (req.body.email) {
            const newEmail = req.body.email.toLowerCase().trim();
            const newHash  = await hashEmail(newEmail);
            const existing = await User.findOne({ emailHash: newHash });
            if (existing && existing._id.toString() !== user._id.toString()) {
                return res.status(400).json({ success: false, message: 'Email already in use' });
            }
            user.email     = await encrypt(newEmail, dataKey);
            user.emailHash = newHash;
        }

        if (req.body.password) user.password = req.body.password;

        await user.save();

        const plainName  = req.body.name  || req.user._name;
        const plainEmail = req.body.email || req.user._email;

        res.json({
            success: true,
            data: {
                ...buildPublicUser(user, plainName, plainEmail),
                token: (await generateToken(user._id))
            }
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ success: false, message: 'Server error updating profile' });
    }
};

module.exports = { registerUser, loginUser, getUserProfile, updateUserProfile };
