const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const authMiddleware = require('../middleware/auth');
const cron = require('node-cron');
const OrderModel = require('../models/Order');
const { adminAuthMiddleware } = require('./Admin');


// CREATE ORDER / CHECKOUT
// ... existing code ...
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { paymentMethod, shippingInfo, note, promotionCode, usePoints } = req.body;

    if (!paymentMethod || !shippingInfo) {
      return res.status(400).json({
        success: false,
        message: 'Payment method and shipping info are required'
      });
    }

    // Validate shipping info
    if (!shippingInfo.address || !shippingInfo.phone || !shippingInfo.name) {
      return res.status(400).json({
        success: false,
        message: 'Complete shipping information is required'
      });
    }

    // Find the user's cart and populate product details
    const cart = await Cart.findOne({ userId: req.user.userId }).populate('items.productId');

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cart is empty'
      });
    }

    // Prepare items from cart and validate stock
    const items = [];
    let totalAmount = 0;

    for (const item of cart.items) {
      if (!item.productId) {
        return res.status(400).json({
          success: false,
          message: 'Invalid product in cart'
        });
      }

      if (item.productId.stockQuantity < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Not enough stock for ${item.productId.name}. Available: ${item.productId.stockQuantity}`
        });
      }

      const itemTotal = item.productId.price * item.quantity;
      totalAmount += itemTotal;

      items.push({
        productId: item.productId._id,
        quantity: item.quantity,
        price: item.productId.price,
        name: item.productId.name,
        total: itemTotal
      });
    }

    // --- DISCOUNT LOGIC ---
    let discount = 0;
    let discountType = null;
    let appliedCode = null;
    let discountSource = null;
    let discountAmount = 0;
    let finalAmount = totalAmount;

    // 1. Check for promotion
    if (promotionCode) {
      const Promotion = require('../models/Promotion');
      const now = new Date();
      const promo = await Promotion.findOne({
        code: promotionCode,
        expiresAt: { $gt: now },
        $or: [ { userId: req.user.userId }, { userId: null } ]
      });
      if (!promo) {
        return res.status(400).json({ success: false, message: 'Invalid or expired promotion code' });
      }
      if (promo.minOrderValue && totalAmount < promo.minOrderValue) {
        return res.status(400).json({ success: false, message: 'Order does not meet minimum value for promotion' });
      }
      discount = promo.discount;
      discountType = promo.type;
      appliedCode = promo.code;
      discountSource = 'promotion';
      // If user-specific, delete after use
      if (promo.userId) {
        await Promotion.deleteOne({ _id: promo._id });
      }
    }

    // 2. Apply discount
    if (discount) {
      if (discountType === 'percent') {
        discountAmount = totalAmount * (discount / 100);
        finalAmount = totalAmount - discountAmount;
      } else if (discountType === 'fixed') {
        discountAmount = discount;
        finalAmount = Math.max(0, totalAmount - discountAmount);
      }
    }

    // 3. Apply points
    if (usePoints) {
      const User = require('../models/User');
      const user = await User.findById(req.user.userId);
      if (user.points < usePoints) return res.status(400).json({ success: false, message: 'Not enough points' });
      discountSource = discountSource ? discountSource + '+points' : 'points';
      discountAmount += Number(usePoints);
      finalAmount = Math.max(0, finalAmount - Number(usePoints));
      await User.findByIdAndUpdate(req.user.userId, { $inc: { points: -Number(usePoints) } });
    }

    // --- END DISCOUNT LOGIC ---

    // Create the order with discount info
    const order = await Order.create({
      userId: req.user.userId,
      items,
      totalAmount: finalAmount,
      paymentMethod,
      shippingInfo,
      note: note || '',
      status: 'NEW',
      orderNumber: `ORD${Date.now()}${Math.floor(Math.random() * 1000)}`,
      discount: discountAmount || 0,
      discountCode: appliedCode || null,
      discountSource: discountSource || null,
      statusHistory: [{
        status: 'NEW',
        timestamp: new Date(),
        note: 'Order placed successfully'
      }]
    });

    // Update product stock and purchase count
    for (const item of items) {
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { 
          stockQuantity: -item.quantity,
          purchaseCount: item.quantity 
        }
      });
    }

    // Clear the cart
    await Cart.deleteOne({ userId: req.user.userId });

    // Schedule automatic order status change from NEW to CONFIRMED after 30 minutes
    setTimeout(async () => {
      try {
        const currentOrder = await Order.findById(order._id);
        if (currentOrder && currentOrder.status === 'NEW') {
          currentOrder.status = 'CONFIRMED';
          currentOrder.statusHistory.push({
            status: 'CONFIRMED',
            timestamp: new Date(),
            note: 'Order automatically confirmed after 30 minutes'
          });
          await currentOrder.save();
        }
      } catch (error) {
        console.error('Error in automatic order status update:', error);
      }
    }, 30 * 60 * 1000); // 30 minutes

    // Populate the response with product details
    const populatedOrder = await Order.findById(order._id)
      .populate('items.productId', 'name price image')
      .populate('userId', 'name email');

    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      order: populatedOrder
    });
  } catch (error) {
    console.error('Error in create order:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating order',
      error: error.message
    });
  }
});
// ... existing code ...
// GET MY ORDERS
router.get('/my-orders', authMiddleware, async (req, res) => {
  try {
    const { status, page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const query = { userId: req.user.userId };
    
    if (status) {
      query.status = status;
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const orders = await Order
      .find(query)
      .populate('userId', 'name email')
      .populate({
        path: 'items.productId',
        select: 'name price image',
        model: 'Product'
      })
      .sort(sortOptions)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(query);

    // Guarantee the structure: items, and each item.productId is a product object
    const mappedOrders = orders.map(order => ({
      ...order.toObject(),
      items: order.items.map(item => ({
        ...item,
        productId: typeof item.productId === 'object' ? item.productId : null
      }))
    }));

    res.status(200).json({
      success: true,
      message: 'Orders fetched successfully',
      orders: mappedOrders,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error in get my orders:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching orders',
      error: error.message
    });
  }
});

// GET SINGLE ORDER DETAILS
router.get('/my-orders/:id', authMiddleware, async (req, res) => {
  try {
    console.log('Request user ID:', req.user.userId);
    console.log('Request order ID:', req.params.id);

    const order = await Order
      .findById(req.params.id)
      .populate({
        path: 'items.productId',
        model: 'Product',
        select: 'name price image stockQuantity description'
      })
      .populate('userId', 'name email phone');

    if (!order) {
      console.log('Order not found');
      return res.status(404).json({
        success: false,
        message: 'No order found'
      });
    }

    console.log('Order user ID:', order.userId._id);
    console.log('Request user ID:', req.user.userId);
    console.log('IDs match?', order.userId._id.toString() === req.user.userId.toString());

    if (order.userId._id.toString() !== req.user.userId.toString()) {
      console.log('Authorization failed: User IDs do not match');
      return res.status(403).json({
        success: false,
        message: 'Unauthorized to view this order'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Order fetched successfully',
      order
    });
  } catch (error) {
    console.error('Error in get single order:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error fetching order details',
      error: error.message
    });
  }
});

// GET ORDERS BY STATUS
router.get('/status/:status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.params;
    const validStatuses = ['NEW', 'CONFIRMED', 'PREPARING', 'DELIVERING', 'DELIVERED', 'CANCELED', 'CANCELREQUESTED'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order status'
      });
    }

    const orders = await Order
      .find({ status, userId: req.user.userId })
      .populate('userId', 'name email')
      .populate('items.productId', 'name price image')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      message: `Orders with status ${status} fetched successfully`,
      totalOrder: orders.length,
      orders
    });
  } catch (error) {
    console.error('Error in get orders by status:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching orders by status',
      error: error.message
    });
  }
});

// CANCEL ORDER
router.put('/cancel/:id', authMiddleware, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('items.productId');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.userId.toString() !== req.user.userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized to cancel this order'
      });
    }

    const now = new Date();
    const timeDiff = now - order.createdAt;
    const timeLimit = 30 * 60 * 1000; // 30 minutes

    if (timeDiff <= timeLimit && order.status === 'NEW') {
      order.status = 'CANCELED';

      // Restore product stock
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.productId._id, {
          $inc: { stockQuantity: item.quantity }
        });
      }

      await order.save();

      return res.status(200).json({
        success: true,
        message: 'Order canceled successfully',
        order
      });
    }

    if (order.status === 'PREPARING') {
      order.status = 'CANCELREQUESTED';
      await order.save();
      
      return res.status(200).json({
        success: true,
        message: 'Cancellation request has been sent to the shop',
        order
      });
    }

    return res.status(403).json({
      success: false,
      message: 'Cannot cancel order after 30 minutes or in current status'
    });
  } catch (error) {
    console.error('Error in cancel order:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error canceling order',
      error: error.message
    });
  }
});

// GET ALL ORDERS (ADMIN)
router.get('/admin/get-all-orders', authMiddleware, async (req, res) => {
  try {
    const { status, page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const query = {};
    
    if (status) {
      query.status = status;
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const orders = await Order
      .find(query)
      .populate('userId', 'name email')
      .populate('items.productId', 'name price image')
      .sort(sortOptions)
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(query);

    res.status(200).json({
      success: true,
      message: 'All orders fetched successfully',
      orders,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error in get all orders:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching all orders',
      error: error.message
    });
  }
});

// CHANGE ORDER STATUS (ADMIN)
router.put('/admin/order/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('items.productId');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const validStatuses = ['NEW', 'CONFIRMED', 'PREPARING', 'DELIVERING', 'DELIVERED', 'CANCELED', 'CANCELREQUESTED'];
    const { status } = req.body;

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status provided'
      });
    }

    if (order.status === 'DELIVERED' || order.status === 'CANCELED') {
      return res.status(400).json({
        success: false,
        message: `Order is already ${order.status}`
      });
    }

    // Handle status changes
    if (status === 'CANCELED' && order.status !== 'CANCELREQUESTED') {
      // Restore product stock when canceling
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.productId._id, {
          $inc: { stockQuantity: item.quantity }
        });
      }
    }

    order.status = status;
    if (status === 'DELIVERED') {
      order.deliveredAt = new Date();
    }
    order.statusHistory.push({
      status,
      timestamp: new Date(),
      note: `Status updated to ${status} by admin`
    });

    await order.save();

    res.status(200).json({
      success: true,
      message: 'Order status updated successfully',
      order
    });
  } catch (error) {
    console.error('Error in change order status:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error updating order status',
      error: error.message
    });
  }
});

// UPDATE ORDER STATUS
router.put('/status/:orderId', authMiddleware, async (req, res) => {
  try {
    const { status, note } = req.body;
    const validStatuses = ['NEW', 'CONFIRMED', 'PREPARING', 'DELIVERING', 'DELIVERED', 'CANCELED', 'CANCELREQUESTED'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const order = await Order.findById(req.params.orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Check if user is authorized to update this order
    if (order.userId.toString() !== req.user.userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized to update this order'
      });
    }

    // Handle cancellation logic
    if (status === 'CANCELED') {
      const now = new Date();
      const timeDiff = now - order.createdAt;
      const timeLimit = 30 * 60 * 1000; // 30 minutes

      if (timeDiff > timeLimit && order.status === 'NEW') {
        return res.status(400).json({
          success: false,
          message: 'Cannot cancel order after 30 minutes'
        });
      }

      if (order.status === 'PREPARING') {
        order.status = 'CANCELREQUESTED';
        order.statusHistory.push({
          status: 'CANCELREQUESTED',
          timestamp: new Date(),
          note: note || 'Cancellation requested by customer'
        });
        await order.save();
        return res.status(200).json({
          success: true,
          message: 'Cancellation request sent to shop',
          order
        });
      }
    }

    // Update order status
    order.status = status;
    order.statusHistory.push({
      status,
      timestamp: new Date(),
      note: note || `Status updated to ${status}`
    });

    await order.save();

    res.status(200).json({
      success: true,
      message: 'Order status updated successfully',
      order
    });
  } catch (error) {
    console.error('Error in update order status:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating order status',
      error: error.message
    });
  }
});

// Run every 5 minutes to auto-change orders from 'NEW' to 'CONFIRMED' after 30 minutes
cron.schedule('*/5 * * * *', async () => {
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
  const orders = await OrderModel.find({ status: 'NEW', createdAt: { $lte: thirtyMinsAgo } });
  for (const order of orders) {
    order.status = 'CONFIRMED';
    order.statusHistory.push({
      status: 'CONFIRMED',
      timestamp: new Date(),
      note: 'Order automatically confirmed after 30 minutes'
    });
    await order.save();
  }
});

module.exports = router;
