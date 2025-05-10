const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true },
    name: { type: String, required: true },
    total: { type: Number, required: true }
  }],
  totalAmount: { type: Number, required: true },
  paymentMethod: { type: String, enum: ['COD', 'WALLET'], required: true },
  status: { 
    type: String, 
    enum: ['New', 'Confirmed', 'Preparing', 'Delivering', 'Delivered', 'Canceled', 'CancelRequested'],
    default: 'New' 
  },
  statusHistory: [{
    status: { 
      type: String, 
      enum: ['New', 'Confirmed', 'Preparing', 'Delivering', 'Delivered', 'Canceled', 'CancelRequested'],
      required: true 
    },
    timestamp: { type: Date, default: Date.now },
    note: { type: String }
  }],
  shippingInfo: {
    name: { type: String, required: true },
    address: { type: String, required: true },
    phone: { type: String, required: true }
  },
  note: { type: String },
  orderNumber: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
  deliveredAt: { type: Date }
});

module.exports = mongoose.model('Order', orderSchema);