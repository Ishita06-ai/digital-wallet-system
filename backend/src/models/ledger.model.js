const mongoose = require("mongoose");

const ledgerSchema = new mongoose.Schema({
  account: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true },
  type: { type: String, enum: ["debit", "credit"], required: true },
  amount: { type: Number, required: true },
  description: { type: String },
}, { timestamps: true });

module.exports = mongoose.model("Ledger", ledgerSchema);