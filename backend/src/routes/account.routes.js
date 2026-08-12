const express = require("express");
const { createAccountController, getUserAccountsController, getAccountBalanceController } = require("../controllers/account.controller");
const { authMiddleware } = require("../middleware/auth.middleware");

const router = express.Router();

router.post("/", authMiddleware, createAccountController);
router.get("/", authMiddleware, getUserAccountsController);
router.get("/:accountId/balance", authMiddleware, getAccountBalanceController);

module.exports = router;