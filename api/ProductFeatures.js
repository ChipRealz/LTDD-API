const express = require('express');
const router = express.Router();
const Favorite = require('../models/Favorite');
const ViewedProduct = require('../models/ViewedProduct');
const Product = require('../models/Product');
const Review = require('../models/Review');
const authMiddleware = require('../middleware/auth');

// Thêm sản phẩm yêu thích
router.post('/favorite/:productId', authMiddleware, async (req, res) => {
  try {
    const favorite = new Favorite({
      userId: req.user.userId,
      productId: req.params.productId
    });
    await favorite.save();
    res.status(201).json(favorite);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Xóa sản phẩm yêu thích
router.delete('/favorite/:productId', authMiddleware, async (req, res) => {
  try {
    await Favorite.deleteOne({ userId: req.user.userId, productId: req.params.productId });
    res.json({ message: 'Removed from favorites' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lấy danh sách sản phẩm yêu thích
router.get('/favorite', authMiddleware, async (req, res) => {
  try {
    const favorites = await Favorite.find({ userId: req.user.userId }).populate('productId');
    res.json(favorites);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ghi nhận sản phẩm đã xem
router.post('/viewed/:productId', authMiddleware, async (req, res) => {
  try {
    await ViewedProduct.findOneAndUpdate(
      { userId: req.user.userId, productId: req.params.productId },
      { viewedAt: Date.now() },
      { upsert: true }
    );
    res.json({ message: 'Product view recorded' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lấy danh sách sản phẩm đã xem
router.get('/viewed', authMiddleware, async (req, res) => {
  try {
    const viewed = await ViewedProduct.find({ userId: req.user.userId })
      .populate('productId')
      .sort({ viewedAt: -1 })
      .limit(10);
    res.json(viewed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lấy sản phẩm tương tự
router.get('/similar/:productId', async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const similarProducts = await Product.find({
      category: product.category,
      _id: { $ne: product._id }
    }).limit(5);
    res.json(similarProducts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cập nhật số liệu sản phẩm (mua và bình luận)
router.get('/stats/:productId', async (req, res) => {
  try {
    const purchaseCount = await Order.countDocuments({ 'items.productId': req.params.productId });
    const commentCount = await Review.countDocuments({ productId: req.params.productId });

    await Product.findByIdAndUpdate(req.params.productId, { purchaseCount, commentCount });
    res.json({ purchaseCount, commentCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;