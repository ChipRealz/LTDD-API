const express = require('express');
const router = express.Router();
const Promotion = require('../models/Promotion');
const User = require('../models/User');
const Order = require('../models/Order');
const authMiddleware = require('../middleware/auth');

// User applies a promotion code for discount
router.post('/apply', authMiddleware, async (req, res) => {
  try {
    let { code, orderId } = req.body;
    code = code ? code.trim() : '';
    const order = await Order.findById(orderId);
    if (!order || order.userId.toString() !== req.user.userId) {
      return res.status(404).json({ message: 'Order not found' });
    }

    let discount = 0;
    console.log('--- PROMOTION DEBUG ---');
    console.log('Order before discount:', order.totalAmount);
    // Apply promotion/coupon
    if (code) {
      const now = new Date();
      const promotion = await Promotion.findOne({
        code,
        expiresAt: { $gt: now },
        $or: [
          { userId: null },
          { userId: req.user.userId }
        ]
      });
      console.log('Promotion found:', promotion);
      if (!promotion) {
        console.log('Promotion not found or expired');
        return res.status(400).json({ message: 'Invalid or expired code' });
      }
      if (promotion.minOrderValue && order.totalAmount < promotion.minOrderValue) {
        console.log('Order value too low for this promotion');
        return res.status(400).json({ message: 'Order value too low for this promotion' });
      }
      discount = promotion.type === 'percent'
        ? order.totalAmount * (promotion.discount / 100)
        : promotion.discount;
      console.log('Discount calculated:', discount);
      // If user-specific, delete after use (like a coupon)
      if (promotion.userId) {
        await Promotion.deleteOne({ _id: promotion._id });
      }
    }
    order.totalAmount = Math.max(0, order.totalAmount - discount);
    await order.save();
    const updatedOrder = await Order.findById(orderId);
    console.log('Order after discount:', updatedOrder.totalAmount);
    console.log('--- END PROMOTION DEBUG ---');
    res.json({ order: updatedOrder, discountApplied: discount });
  } catch (err) {
    console.log('Promotion apply error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router; 