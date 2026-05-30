const express = require('express');
const {
    registerUser,
    loginUser,
    verifyCode,
    resendCode,
    refreshSession,
    logout,
    getUserProfile,
    updateUserProfile,
} = require('../controllers/userController');
const { setup2FA, enable2FA, disable2FA, verify2FA } = require('../controllers/twoFactorController');
const { protect } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const auth = require('../validators/auth');

const router = express.Router();

// Public routes
router.post('/register',    validate({ body: auth.register }),   registerUser);
router.post('/login',       validate({ body: auth.login }),      loginUser);
router.post('/verify-code', validate({ body: auth.verifyCode }), verifyCode);
router.post('/resend-code', validate({ body: auth.resendCode }), resendCode);

// Session management (public — callable without a valid access token)
router.post('/refresh',  refreshSession);
router.post('/logout',   logout);

// 2FA verification (uses fa_temp cookie set by /login — not a protected route)
router.post('/2fa/verify', validate({ body: auth.twoFactorVerify }), verify2FA);

// Protected routes
router.get('/profile',  protect, getUserProfile);
router.put('/profile',  protect, validate({ body: auth.updateProfile }), updateUserProfile);

// 2FA management (require full auth)
router.post('/2fa/setup',   protect, setup2FA);
router.post('/2fa/enable',  protect, validate({ body: auth.twoFactorVerify }), enable2FA);
router.post('/2fa/disable', protect, validate({ body: auth.twoFactorVerify }), disable2FA);

module.exports = router;
