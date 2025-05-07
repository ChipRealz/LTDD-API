const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const AdminOTPVerificationSchema = new Schema({
    adminId: { type: Schema.Types.ObjectId, ref: 'PendingAdmin' }, // Can also ref 'Admin' for login OTPs
    otp: String,
    createdAt: Date,
    expiredAt: Date,
});

const AdminOTPVerification = mongoose.model('AdminOTPVerification', AdminOTPVerificationSchema);

module.exports = AdminOTPVerification;