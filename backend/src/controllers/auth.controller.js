const userModel = require('../models/user.model');
const accountModel = require('../models/account.model');
const jwt = require('jsonwebtoken');
const sendEmail = require('../services/email.services');
const bcrypt = require('bcrypt');
const blacklistModel = require("../models/blacklist.model");

async function userRegisterController(req, res, next) {
  try {
    const { name, email, password } = req.body;

    // 1️⃣ Check if email exists
    const isExists = await userModel.findOne({ email });
    if (isExists) {
      return res.status(400).json({ message: "Email already exists" });
    }


    // 3️⃣ Create user with isFunded = false
   const user = await userModel.create({
  name,
  email,
  password,
  isFunded: false
});

// Create account
const account = await accountModel.create({ user: user._id, balance: 0 });

const token = jwt.sign(
  { id: user._id, systemUser: user.systemUser },
  process.env.JWT_SECRET,
  { expiresIn: "2d" }
);

// Send back account info as well
return res.status(201).json({
  message: "User registered successfully",
  user: {
    _id: user._id,
    name: user.name,
    email: user.email,
    systemUser: user.systemUser,
    account: {
      _id: account._id,
      balance: account.balance,
    },
  },
  token,
});
  } catch (error) {
    console.error("REGISTER ERROR:", error);
    return res.status(500).json({ message: error.message });
  }
}
async function userLoginController(req, res) {
  try {
    const { email, password } = req.body;
    const user = await userModel.findOne({ email }).select('+password +systemUser');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(400).json({ message: "Invalid email or password" });
    }
    const account = await accountModel.findOne({ user: user._id });
const token = jwt.sign(
  { id: user._id, systemUser: user.systemUser },
  process.env.JWT_SECRET,
  { expiresIn: "2d" }
);
return res.status(200).json({
  message: "User logged in successfully",
  user: {
    _id: user._id,
    name: user.name,
    email: user.email,
    systemUser: user.systemUser,
    account: {
      _id: account._id,
      balance: account.balance,
    },
  },
  token,
});
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function userLogoutController(req, res) {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  if (token) await blacklistModel.create({ token });
  res.clearCookie("token");
  res.status(200).json({ message: "User logged out successfully" });
}

module.exports = { userRegisterController, userLoginController, userLogoutController };