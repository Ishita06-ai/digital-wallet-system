const mongoose = require("mongoose");

const fundRequestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Account",
    required: true
  },

  amount: {
    type: Number,
    default: 1000
  },

  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending"
  },

  requestedAt: {
    type: Date,
    default: Date.now
  },

  approvedAt: Date

});

module.exports = mongoose.model("FundRequest", fundRequestSchema);