const express = require('express');
const router  = express.Router();
const {
  userLoginController,
  userLogoutController,
  userRegisterController
} = require('../controllers/auth.controller');

// Public routes
router.post('/register', userRegisterController);
router.post('/login', userLoginController);
router.post('/logout', userLogoutController);

module.exports = router;