const express = require('express');
const router = express.Router();
const Review = require('../models/Review');
const Order = require('../models/Order');
const Coupon = require('../models/Coupon');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

// Add review and reward
router.post('/:productId', authMiddleware, async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const { productId } = req.params;

    // Check if user has purchased and received the product
    const order = await Order.findOne({
      userId: req.user.userId,
      'items.productId': productId,
      status: 'Delivered'
    });
    if (!order) return res.status(403).json({ message: 'You can only review purchased products' });

    // Prevent duplicate reviews
    const existingReview = await Review.findOne({ userId: req.user.userId, productId });
    if (existingReview) return res.status(400).json({ message: 'You already reviewed this product' });

    // Create review
    const review = new Review({
      userId: req.user.userId,
      productId,
      rating,
      comment
    });
    await review.save();

    // Reward: randomly give coupon or points
    let reward;
    if (Math.random() > 0.5) {
      // Give coupon
      const coupon = new Coupon({
        code: `REVIEW${Date.now()}`,
        discount: 10, // 10% discount
        userId: req.user.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      });
      await coupon.save();
      reward = { type: 'coupon', coupon };
    } else {
      // Give points
      await User.findByIdAndUpdate(req.user.userId, { $inc: { points: 50 } });
      reward = { type: 'points', amount: 50 };
    }

    res.status(201).json({ review, reward });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all reviews by the current user
router.get('/my-reviews', authMiddleware, async (req, res) => {
  try {
    const reviews = await Review.find({ userId: req.user.userId }).select('productId');
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get only reviews (with rating) for a product
router.get('/:productId', async (req, res) => {
  try {
    const reviews = await Review.find({ productId: req.params.productId, rating: { $exists: true, $ne: null } })
      .populate('userId', 'name');
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a comment to a product (no rating required)
router.post('/comment/:productId', authMiddleware, async (req, res) => {
  try {
    const { comment } = req.body;
    const { productId } = req.params;
    if (!comment || !comment.trim()) {
      return res.status(400).json({ message: 'Comment is required' });
    }
    const review = new Review({
      userId: req.user.userId,
      productId,
      comment
    });
    await review.save();
    res.status(201).json({ success: true, review });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get only comments (no rating) for a product
router.get('/comment/:productId', async (req, res) => {
  try {
    const comments = await Review.find({ productId: req.params.productId, rating: { $exists: false }, comment: { $exists: true, $ne: '' } })
      .populate('userId', 'name');
    res.json(comments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;