const mongoose = require("mongoose");
const ledgerModel = require("./ledger.model");

const accountSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  status: { type: String, enum: ["active", "inactive"], default: "active" },
  currency: { type: String, default: "INR" },
  balance: { type: Number, default: 0 },
}, { timestamps: true });

// Compute balance from ledger
// Optional session allows the balance to be read inside a MongoDB transaction
accountSchema.methods.getBalance = async function (session) {
  const result = await ledgerModel.aggregate([
    { $match: { account: this._id } },
    {
      $group: {
        _id: null,
        totalDebit: { $sum: { $cond: [{ $eq: ["$type", "debit"] }, "$amount", 0] } },
        totalCredit: { $sum: { $cond: [{ $eq: ["$type", "credit"] }, "$amount", 0] } },
      },
    },
    { $project: { _id: 0, balance: { $subtract: ["$totalCredit", "$totalDebit"] } } }
  ]).session(session);

  return result.length ? result[0].balance : 0;
};

module.exports = mongoose.model("Account", accountSchema);