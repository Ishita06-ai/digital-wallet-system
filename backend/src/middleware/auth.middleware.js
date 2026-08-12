const blacklistModel = require("../models/blacklist.model");
const userModel = require("../models/user.model");
const jwt = require("jsonwebtoken");

async function authMiddleware(req, res, next) {
  try {
    const token =
  req.cookies?.token ||
  (req.headers.authorization &&
    req.headers.authorization.split(" ")[1]);
    
    if (!token) return res.status(401).json({ message: "Unauthorized: No token" });

    const blacklisted = await blacklistModel.findOne({ token });
    if (blacklisted) return res.status(401).json({ message: "Token blacklisted" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await userModel.findById(decoded.id);
    if (!user) return res.status(401).json({ message: "User not found" });

    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ message: "Unauthorized" });
  }
}

async function authSystemUserMiddleware(req, res, next) {
  try {
    const token = req.cookies?.token || req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Unauthorized: No token" });

    const blacklisted = await blacklistModel.findOne({ token });
    if (blacklisted) return res.status(401).json({ message: "Token blacklisted" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await userModel.findById(decoded.id).select("+systemUser");
    if (!user || !user.systemUser) return res.status(403).json({ message: "Admin access required" });

    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ message: "Unauthorized" });
  }
}

module.exports = { authMiddleware, authSystemUserMiddleware };