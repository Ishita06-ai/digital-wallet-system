require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const userModel = require("./src/models/user.model");
const accountModel = require("./src/models/account.model");
const ledgerModel = require("./src/models/ledger.model");

async function seedSystemUser() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to:", mongoose.connection.name);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const hashedPassword = await bcrypt.hash("i1d2r3@123", 10);

    // Ensure system user exists
    const systemUser = await userModel.findOneAndUpdate(
      { email: "backendledger.dev@gmail.com" },
      {
        name: "IshitaRander",
        password: hashedPassword,
        systemUser: true
      },
      { upsert: true, returnDocument: "after", session }
    );

    console.log("System user ensured");

    // Ensure account exists
    let account = await accountModel.findOne({ user: systemUser._id }).session(session);

    if (!account) {
      account = await accountModel.create(
        [
          {
            user: systemUser._id,
            status: "active",
            balance: 0
          }
        ],
        { session }
      );
      account = account[0];
      console.log("Account created");
    }

    // 🔥 CHANGE THIS AMOUNT WHENEVER YOU WANT TO FUND AGAIN
    const fundAmount = 100000;

    // Always create new ledger entry (like real banking logic)
    await ledgerModel.create(
      [
        {
          account: account._id,
          amount: fundAmount,
          type: "credit",
          source: "SYSTEM",
          transaction: null
        }
      ],
      { session }
    );

    account.balance += fundAmount;
    await account.save({ session });

    await session.commitTransaction();
    session.endSession();

    console.log(`System funded with ₹${fundAmount}`);
    console.log("DONE ✅");
    process.exit();

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error:", error.message);
    process.exit(1);
  }
}

seedSystemUser();