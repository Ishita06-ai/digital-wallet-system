const express = require("express");
const { createAccountController, getUserAccountsController, getAccountBalanceController } = require("../controllers/account.controller");
const { authMiddleware } = require("../middleware/auth.middleware");
const { validateCreateAccount, validateGetBalance } = require("../validators");

const router = express.Router();

router.post("/", authMiddleware, validateCreateAccount, createAccountController);
router.get("/", authMiddleware, getUserAccountsController);
router.get("/:accountId/balance", authMiddleware, validateGetBalance, getAccountBalanceController);

module.exports = router;