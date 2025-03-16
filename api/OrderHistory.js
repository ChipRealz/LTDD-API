// api/OrderHistory.js
const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const authMiddleware = require('../middleware/auth');

// Lấy lịch sử đơn hàng
router.get('/', authMiddleware, async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.user.userId })
      .populate('items.productId')
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Theo dõi đơn hàng chi tiết
router.get('/:orderId', authMiddleware, async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.orderId, userId: req.user.userId })
      .populate('items.productId');
    if (!order) return res.status(404).json({ message: 'Order not found' });

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Hủy đơn hàng
router.post('/:orderId/cancel', authMiddleware, async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.orderId, userId: req.user.userId });
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const timeElapsed = (Date.now() - new Date(order.createdAt)) / 60000; // Phút
    if (order.status === 'New' && timeElapsed <= 30) {
      order.status = 'Cancelled';
      // Hoàn lại số lượng tồn kho
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.productId, {
          $inc: { stockQuantity: item.quantity }
        });
      }
    } else if (order.status === 'Shop Preparing') {
      order.status = 'Cancel Requested';
    } else {
      return res.status(400).json({ message: 'Cannot cancel order at this stage' });
    }

    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cập nhật trạng thái đơn hàng (dành cho admin/shop)
router.patch('/:orderId/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = [
      'New',
      'Confirmed',
      'Shop Preparing',
      'Shipping',
      'Delivered',
      'Cancelled',
      'Cancel Requested'
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    // Tự động xác nhận sau 30 phút nếu là đơn mới
    if (order.status === 'New' && status === 'Confirmed') {
      const timeElapsed = (Date.now() - new Date(order.createdAt)) / 60000;
      if (timeElapsed > 30) order.status = 'Confirmed';
    }

    order.status = status;
    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;