const express = require('express');
const router = express.Router();
const {
  userLoginController,
  userLogoutController,
  userRegisterController
} = require('../controllers/auth.controller');
const { validateRegister, validateLogin } = require('../validators');
const { createAuthLimiter } = require('../middleware/rateLimit.middleware');

// Apply rate limiting to auth endpoints using factory for consistent limits
const authLimiter = createAuthLimiter();

router.post('/register', authLimiter, validateRegister, userRegisterController);
router.post('/login', authLimiter, validateLogin, userLoginController);
router.post('/logout', userLogoutController);

module.exports = router;