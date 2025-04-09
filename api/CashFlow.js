const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const authMiddleware = require('../middleware/auth');

// Thống kê dòng tiền
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Tổng hợp theo trạng thái đơn hàng
    const stats = await Order.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: '$status',
          totalAmount: { $sum: '$totalAmount' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Tạo object kết quả
    const cashFlow = {
      pendingConfirmation: { total: 0, count: 0 }, // Chờ xác nhận
      shipping: { total: 0, count: 0 }, // Đang giao
      delivered: { total: 0, count: 0 }, // Đã giao
    };

    stats.forEach(stat => {
      switch (stat._id) {
        case 'New':
        case 'Confirmed':
          cashFlow.pendingConfirmation.total = stat.totalAmount;
          cashFlow.pendingConfirmation.count = stat.count;
          break;
        case 'Shipping':
          cashFlow.shipping.total = stat.totalAmount;
          cashFlow.shipping.count = stat.count;
          break;
        case 'Delivered':
          cashFlow.delivered.total = stat.totalAmount;
          cashFlow.delivered.count = stat.count;
          break;
      }
    });

    res.json(cashFlow);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;