const userModel = require("../models/user.model")
const accountModel = require("../models/account.model")
const transactionController = require("./transaction.controller")
const FundRequest = require("../models/fundRequest.model")
// GET USERS WHO REQUESTED FUNDS
async function getPendingUsers(req, res) {

  try {

    const users = await userModel.find({
      systemUser: false
    }).select("_id name email")

    res.json({ users })

  } catch (err) {

    console.error(err)

    res.status(500).json({
      message: "Failed to fetch users"
    })

  }

}

async function getPendingRequests(req,res){
try {
    const requests = await FundRequest.find({
      status: "pending"
    }).populate("user");
console.log("Pending requests:", requests); 
    res.json({ requests });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
}

// APPROVE FUND REQUEST


async function approveFundRequest(req, res) {

  try {

    const { userId, amount, requestId } = req.body;
console.log("Request ID:", requestId);
    const user = await userModel.findById(userId);

    if (!user) {
      return res.status(404).json({
        message: "User not found"
      });
    }

    const userAccount = await accountModel.findOne({
      user: user._id
    });

    if (!userAccount) {
      return res.status(404).json({
        message: "User account not found"
      });
    }

    req.body = {
      toAccount: userAccount._id,
      amount,
      idempotencyKey: `seed-${userId}-${Date.now()}`
    };

    await transactionController.createInitialFundsTransaction(req);

    await userModel.findByIdAndUpdate(userId, {
      isFunded: true,
      fundRequested: false
    });

    await FundRequest.findByIdAndUpdate(requestId, {
      status: "approved"
    });

    res.json({
      message: "Funds approved successfully"
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      message: err.message
    });

  }

}

module.exports = {
  approveFundRequest,
  getPendingUsers,
    getPendingRequests
}