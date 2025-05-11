const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const authMiddleware = require('../middleware/auth');

// Track user's cash flow by order status (supporting all statuses in statusMap)
router.get('/cashflow', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orders = await Order.find({ userId });
    // List of all statuses to track
    const statusList = [
      'PENDING', 'SUCCESS', 'FAILED', 'CANCELED', 'DELIVERED',
      'NEW', 'CONFIRMED', 'PREPARING', 'DELIVERING', 'CANCELREQUESTED'
    ];
    // Initialize totals for each status
    const statusTotals = {};
    statusList.forEach(status => { statusTotals[status] = 0; });
    // Sum totalAmount for each status
    orders.forEach(order => {
      const status = order.status ? order.status.toUpperCase() : '';
      if (statusTotals.hasOwnProperty(status)) {
        statusTotals[status] += order.totalAmount;
      }
    });
    // Calculate total spent (DELIVERED, SUCCESS, CONFIRMED)
    const totalSpent = (statusTotals['DELIVERED'] || 0) + (statusTotals['SUCCESS'] || 0) + (statusTotals['CONFIRMED'] || 0);
    res.json({
      ...statusTotals,
      totalSpent
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router; 