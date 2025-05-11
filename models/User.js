const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  name: String,
  email: String,
  password: String,
  dateOfBirth: Date,
  verified: Boolean,
  points: { type: Number, default: 0 },
  image: { type: String, trim: true }, // Optional field for Cloudinary image URL
  address: { type: String, trim: true } // Optional field for user address
});

const User = mongoose.model("User", UserSchema);

module.exports = User;