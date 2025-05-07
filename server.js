require('./config/db');
const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server); // Tạo server Socket.IO
const cors = require('cors');

const port = process.env.PORT || 5000;
const bodyParser = require('express').json;
app.use(bodyParser());
app.use(cors());

// Các router
const UserRouter = require('./api/User');
const CategoryRouter = require('./api/Category');
const ProductRouter = require('./api/Product');
const SaleRouter = require('./api/Sales');
const CartRouter = require('./api/Cart');
const CheckoutRouter = require('./api/Checkout');
const OrderHistoryRouter = require('./api/OrderHistory');
const ReviewRouter = require('./api/Review');
const ProductFeaturesRouter = require('./api/ProductFeatures');
const PromotionRouter = require('./api/Promotion');
const AdminRouter = require('./api/Admin');

app.use('/user', UserRouter);
app.use('/category', CategoryRouter);
app.use('/product', ProductRouter);
app.use('/sale', SaleRouter);
app.use('/cart', CartRouter);
app.use('/checkout', CheckoutRouter);
app.use('/order-history', OrderHistoryRouter);
app.use('/review', ReviewRouter);
app.use('/product-features', ProductFeaturesRouter);
app.use('/promotion', PromotionRouter);
app.use('/admin', AdminRouter);

// Model Notification
const Notification = require('./models/Notification');

// Xử lý Socket.IO
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Gửi thông báo cho user cụ thể
  socket.on('join', (userId) => {
    socket.join(userId); // Tham gia room của user
    console.log(`User ${userId} joined room`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Hàm gửi thông báo
const sendNotification = async (userId, message, type) => {
  const notification = new Notification({
    userId,
    message,
    type,
    createdAt: new Date()
  });
  await notification.save();
  io.to(userId).emit('notification', notification); // Gửi thông báo đến user cụ thể
};

// Gắn hàm gửi thông báo vào global để sử dụng trong các router
global.sendNotification = sendNotification;

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});