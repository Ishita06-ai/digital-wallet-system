const { Router } = require("express");
const {
  authMiddleware,
  authSystemUserMiddleware
} = require("../middleware/auth.middleware");

const transactionController = require("../controllers/transaction.controller");
const transactionModel = require("../models/transaction.model");
const { validateCreateTransaction, validateInitialFunds, validateTransactionHistory } = require("../validators");

const router = Router();

/**
 * GET transactions for account
 */
router.get("/:accountId", authMiddleware, validateTransactionHistory, async (req, res) => {

  try {

    // Verify the requested account belongs to the authenticated user
    const account = await accountModel.findById(req.params.accountId);
    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }

    // IDOR prevention: ensure user owns the account
    if (account.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Access denied: You can only view your own transaction history" });
    }

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
router.post("/", authMiddleware, validateCreateTransaction, transactionController.createTransaction);

/**
 * Admin seeding initial funds
 */
router.post(
  "/system/initial-funds",
  authSystemUserMiddleware,
  validateInitialFunds,
  transactionController.createInitialFundsTransaction
);

module.exports = router;