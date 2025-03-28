const mongoose = require('mongoose');

const promotionSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  discount: { type: Number, required: true }, // Phần trăm hoặc số tiền
  type: { type: String, enum: ['percent', 'fixed'], required: true },
  minOrderValue: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true }
});

module.exports = mongoose.model('Promotion', promotionSchema);