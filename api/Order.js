const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const authMiddleware = require('../middleware/auth');

// Thanh toán
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { paymentMethod, shippingAddress } = req.body;
    const cart = await Cart.findOne({ userId: req.user.userId }).populate('items.productId');
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    let totalAmount = 0;
    const items = [];

    for (const item of cart.items) {
      if (item.productId.stockQuantity < item.quantity) {
        return res.status(400).json({ message: `Not enough stock for ${item.productId.name}` });
      }
      totalAmount += item.productId.price * item.quantity;
      items.push({
        productId: item.productId._id,
        quantity: item.quantity,
        price: item.productId.price
      });
    }

    const order = new Order({
      userId: req.user.userId,
      items,
      totalAmount,
      paymentMethod,
      shippingAddress
    });

    // Giảm số lượng tồn kho
    for (const item of items) {
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { stockQuantity: -item.quantity }
      });
    }

    // Xóa giỏ hàng sau khi đặt hàng
    await Cart.deleteOne({ userId: req.user.userId });
    await order.save();
    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;