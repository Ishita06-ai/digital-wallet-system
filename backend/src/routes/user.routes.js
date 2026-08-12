const express = require("express");
const { authMiddleware } = require("../middleware/auth.middleware");
const accountModel = require("../models/account.model");
const userModel = require("../models/user.model");
const FundRequest = require("../models/fundRequest.model")
const router = express.Router();

/**
 * POST /api/user/request-funds
 * User requests funds from admin
 */
router.post("/request-funds", authMiddleware, async (req, res) => {

  try {

    const user = await userModel.findById(req.user._id);

    const account = await accountModel.findOne({
      user: req.user._id
    });
    
const existingRequest = await FundRequest.findOne({
    user: req.user._id,
    status: "pending"
  })

  if (existingRequest) {
    return res.status(400).json({
      message: "You already have a pending request"
    })
  }

  const request = await FundRequest.create({
    user: req.user._id,
    account: account._id,
    amount: 1000
  })

  
    if (!user || !account) {
      return res.status(404).json({
        message: "Account not found"
      });
    }

    // derive balance from ledger
    const balance = await account.getBalance();

    // prevent duplicate pending request
    if (user.fundRequested) {
      return res.status(400).json({
        message: "You already have a pending fund request"
      });
    }

    // mark request
    user.fundRequested = true;
    user.fundRequestedAt = new Date();

    await user.save();

    res.status(200).json({
      message: "Fund request sent successfully",
      request: {
        userId: user._id,
        name: user.name,
        email: user.email,
        accountId: account._id,
        balance: balance
      }
    });

  } catch (err) {

    console.error("REQUEST FUNDS ERROR:", err);

    res.status(500).json({
      message: "Failed to send fund request"
    });

  }

});

module.exports = router;