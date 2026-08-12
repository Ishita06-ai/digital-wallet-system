const { Router } = require("express");
const {
  authMiddleware,
  authSystemUserMiddleware
} = require("../middleware/auth.middleware");

const transactionController = require("../controllers/transaction.controller");
const transactionModel = require("../models/transaction.model");

const router = Router();

/**
 * GET transactions for account
 */
router.get("/:accountId", authMiddleware, async (req, res) => {

  try {

    const transactions = await transactionModel.find({
      $or: [
        { fromAccount: req.params.accountId },
        { toAccount: req.params.accountId }
      ]
    }).sort({ createdAt: -1 });

    res.json({ transactions });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      message: "Failed to fetch transactions"
    });

  }

});

/**
 * User transaction
 */
router.post("/", authMiddleware, transactionController.createTransaction);

/**
 * Admin seeding initial funds
 */
router.post(
  "/system/initial-funds",
  authSystemUserMiddleware,
  transactionController.createInitialFundsTransaction
);

module.exports = router;