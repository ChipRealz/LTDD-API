const express = require('express');
const router = express.Router();
const Review = require('../models/Review');
const Order = require('../models/Order');
const Coupon = require('../models/Coupon');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

// Thêm đánh giá
router.post('/:productId', authMiddleware, async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const { productId } = req.params;

    // Kiểm tra xem người dùng đã mua sản phẩm chưa
    const order = await Order.findOne({
      userId: req.user.userId,
      'items.productId': productId,
      status: 'Delivered'
    });
    if (!order) return res.status(403).json({ message: 'You can only review purchased products' });

    // Kiểm tra xem đã đánh giá chưa
    const existingReview = await Review.findOne({ userId: req.user.userId, productId });
    if (existingReview) return res.status(400).json({ message: 'You already reviewed this product' });

    const review = new Review({
      userId: req.user.userId,
      productId,
      rating,
      comment
    });
    await review.save();

    // Tặng mã giảm giá hoặc điểm tích lũy
    const rewardType = Math.random() > 0.5 ? 'coupon' : 'points';
    if (rewardType === 'coupon') {
      const coupon = new Coupon({
        code: `REVIEW${Date.now()}`,
        discount: 10, // 10% giảm giá
        userId: req.user.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // Hết hạn sau 7 ngày
      });
      await coupon.save();
      res.status(201).json({ review, reward: { type: 'coupon', coupon } });
    } else {
      await User.findByIdAndUpdate(req.user.userId, { $inc: { points: 50 } }); // Tặng 50 điểm
      res.status(201).json({ review, reward: { type: 'points', amount: 50 } });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lấy danh sách đánh giá của sản phẩm
router.get('/:productId', async (req, res) => {
  try {
    const reviews = await Review.find({ productId: req.params.productId }).populate('userId', 'name');
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;