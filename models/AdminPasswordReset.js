const mongoose = require('mongoose');
const AdminPasswordResetSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Admin'
  },
  resetString: String,
  createdAt: Date,
  expiredAt: Date
});
module.exports = mongoose.model('AdminPasswordReset', AdminPasswordResetSchema);
