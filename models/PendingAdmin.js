const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const PendingAdminSchema = new Schema({
  name: String,
  email: String,
  password: String,
  dateOfBirth: Date,
  role: String,
  createdAt: { type: Date, default: Date.now, expires: 3600 }, // Auto-expire after 1 hour
});

const PendingAdmin = mongoose.model("PendingAdmin", PendingAdminSchema);
module.exports = PendingAdmin;