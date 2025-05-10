const express = require('express');
const router = express.Router();
const Promotion = require('../models/Promotion');
const User = require('../models/User');
const Order = require('../models/Order');
const authMiddleware = require('../middleware/auth');

// Lấy danh sách khuyến mãi
router.get('/', async (req, res) => {
  try {
    const promotions = await Promotion.find({ expiresAt: { $gt: Date.now() } });
    res.json(promotions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Áp dụng mã giảm giá hoặc điểm tích lũy khi thanh toán
router.post('/apply', authMiddleware, async (req, res) => {
  try {
    const { code, usePoints, orderId } = req.body;
    const order = await Order.findById(orderId);
    if (!order || order.userId.toString() !== req.user.userId) {
      return res.status(404).json({ message: 'Order not found' });
    }

    let discount = 0;

    // Áp dụng mã giảm giá
    if (code) {
      const promotion = await Promotion.findOne({ code, expiresAt: { $gt: Date.now() } });

      if (promotion) {
        discount = promotion.type === 'percent'
          ? order.totalAmount * (promotion.discount / 100)
          : promotion.discount;
        if (order.totalAmount < promotion.minOrderValue) {
          return res.status(400).json({ message: 'Order value too low for this promotion' });
        }
      } else {
        return res.status(400).json({ message: 'Invalid or expired code' });
      }
    }

    // Áp dụng điểm tích lũy
    if (usePoints) {
      const user = await User.findById(req.user.userId);
      if (user.points < usePoints) return res.status(400).json({ message: 'Not enough points' });
      discount += usePoints; // 1 điểm = 1 đơn vị tiền tệ
      await User.findByIdAndUpdate(req.user.userId, { $inc: { points: -usePoints } });
    }

    order.totalAmount -= discount;
    await order.save();
    res.json({ order, discountApplied: discount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tạo khuyến mãi (dành cho admin)
router.post('/create', authMiddleware, async (req, res) => {
  try {
    const { code, discount, type, minOrderValue, expiresAt } = req.body;
    const promotion = new Promotion({ code, discount, type, minOrderValue, expiresAt });
    await promotion.save();
    res.status(201).json(promotion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;