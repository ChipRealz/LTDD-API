// models/ViewedProduct.js
const mongoose = require('mongoose');

const viewedProductSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  viewedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ViewedProduct', viewedProductSchema);