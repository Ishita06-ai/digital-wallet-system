const mongoose = require("mongoose");

const ledgerSchema = new mongoose.Schema({
  account: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
  type: { type: String, enum: ["debit", "credit"], required: true },
  amount: { type: Number, required: true },
  // Reference to the Transaction this ledger entry belongs to, so each
  // debit/credit of a double-entry transfer can be traced back to it.
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", index: true },
  description: { type: String },
}, { timestamps: true });

module.exports = mongoose.model("Ledger", ledgerSchema);