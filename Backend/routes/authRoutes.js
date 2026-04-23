const express = require('express');
const {
    registerUser,
    loginUser,
    getUserProfile,
    updateUserProfile
} = require('../controllers/userController');
const { setup2FA, enable2FA, disable2FA, verify2FA } = require('../controllers/twoFactorController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Public routes
router.post('/register', registerUser);
router.post('/login',    loginUser);

// 2FA verification (uses temp token — not a protected route)
router.post('/2fa/verify', verify2FA);

// Protected routes
router.get('/profile',  protect, getUserProfile);
router.put('/profile',  protect, updateUserProfile);

// 2FA management (require full auth)
router.post('/2fa/setup',   protect, setup2FA);
router.post('/2fa/enable',  protect, enable2FA);
router.post('/2fa/disable', protect, disable2FA);

module.exports = router;
