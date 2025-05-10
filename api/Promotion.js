const express = require('express');
const router = express.Router();
const Promotion = require('../models/Promotion');
const User = require('../models/User');
const Order = require('../models/Order');
const authMiddleware = require('../middleware/auth');
const { adminAuthMiddleware } = require('./Admin');
const Admin = require('../models/Admin');

// List all promotions (admin only)
router.get('/', adminAuthMiddleware, async (req, res) => {
  try {
    const promotions = await Promotion.find().sort({ expiresAt: -1 });
    res.json(promotions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a promotion/coupon (admin only)
router.post('/create', adminAuthMiddleware, async (req, res) => {
  try {
    const { code, discount, type, minOrderValue, expiresAt, userId } = req.body;
    const promotion = new Promotion({ code, discount, type, minOrderValue, expiresAt, userId: userId || null });
    await promotion.save();
    // Send notification to admin (optional, assuming admin user ID exists)
    if (global.sendNotification) {
      const admin = await Admin.findOne();
      if (admin) {
        const discountText = type === 'percent' ? `${discount}%` : `${discount} (fixed)`;
        const minOrderText = minOrderValue ? `Min order: ${minOrderValue}` : 'No min order';
        const expiresText = expiresAt ? `Expires: ${new Date(expiresAt).toLocaleString()}` : 'No expiry';
        global.sendNotification(
          admin._id,
          `New promotion added: Code: ${code}, Discount: ${discountText}, ${minOrderText}, ${expiresText}`,
          'promotion'
        );
      }
    }
    res.status(201).json(promotion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a promotion (admin only)
router.delete('/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Promotion.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: 'Promotion not found' });
    }
    res.json({ message: 'Promotion deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;