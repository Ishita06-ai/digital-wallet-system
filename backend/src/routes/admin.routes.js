const express = require("express");
const router = express.Router();

const accountModel = require("../models/account.model");
const userModel = require("../models/user.model");

const { authSystemUserMiddleware } = require("../middleware/auth.middleware");

const transactionController = require("../controllers/transaction.controller");

const {
  approveFundRequest,
  getPendingUsers,
  getPendingRequests
} = require("../controllers/admin.controller");


// GET pending users
router.get("/pending-users", authSystemUserMiddleware, getPendingUsers);

// GET pending fund requests
router.get("/pending-requests", getPendingRequests);

// APPROVE fund request
router.post("/approve-funds", authSystemUserMiddleware, approveFundRequest);


// Seed funds manually
router.post("/seed-funds", authSystemUserMiddleware, async (req, res) => {

  const { userId, amount, idempotencyKey } = req.body;

  if (!userId || !amount || !idempotencyKey) {
    return res.status(400).json({
      message: "userId, amount, idempotencyKey required"
    });
  }

  try {

    const user = await userModel.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const account = await accountModel.findOne({ user: user._id });

    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }

    req.body = {
      toAccount: account._id,
      amount,
      idempotencyKey
    };

    await transactionController.createInitialFundsTransaction(req, res);

    user.isFunded = true;
    user.fundRequested = false;

    await user.save();

  } catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Failed to seed funds"
    });

  }

});

module.exports = router;