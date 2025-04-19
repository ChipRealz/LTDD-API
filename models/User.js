const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  name: String,
  email: String,
  password: String,
  dateOfBirth: Date,
  verified: Boolean,
  points: { type: Number, default: 0 },
  role: {
    type: String,
    enum: ["user", "manager", "admin"],
    default: "user",
  },
});

const User = mongoose.model("User", UserSchema);

module.exports = User;