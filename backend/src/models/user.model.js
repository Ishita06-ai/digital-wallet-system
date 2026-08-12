const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true, select: false },
  balance: { type: Number, default: 0 },
  systemUser: { type: Boolean, default: false, immutable: true, select: false },
   isFunded: { type: Boolean, default: false },
   fundRequested: { type: Boolean, default: false },
   fundRequestedAt: { type: Date },
}, { timestamps: true });

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return ;

  const bcrypt = require("bcrypt");
  this.password = await bcrypt.hash(this.password, 10);

});

userSchema.methods.comparePassword = function(password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', userSchema);