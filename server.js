require('./config/db');
const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);
const cors = require('cors');

const port = process.env.PORT || 5000;
const bodyParser = require('express').json;
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

app.use(bodyParser());
app.use(cors());

// Routers
const UserRouter = require('./api/User');
const CategoryRouter = require('./api/Category');
const ProductRouter = require('./api/Product');
const CartRouter = require('./api/Cart');
const ReviewRouter = require('./api/Review');
const ProductFeaturesRouter = require('./api/ProductFeatures');
const PromotionRouter = require('./api/Promotion');
const AdminRouter = require('./api/Admin');
const ChatbotRouter = require('./api/Chatbot');
const AdminChatbotRouter = require('./api/AdminChatbot');
const OrderRouter = require('./api/Order');
const UserPromotionRouter = require('./api/UserPromotion');

app.use('/user', UserRouter);
app.use('/category', CategoryRouter);
app.use('/product', ProductRouter);
app.use('/cart', CartRouter);
app.use('/review', ReviewRouter);
app.use('/product-features', ProductFeaturesRouter);
app.use('/promotion', PromotionRouter);
app.use('/admin', AdminRouter);
app.use('/chatbot', ChatbotRouter);
app.use('/admin/chatbot', AdminChatbotRouter);
app.use('/order', OrderRouter);
app.use('/userpromotion', UserPromotionRouter);

// Model Notification
const Notification = require('./models/Notification');

// Socket.IO handling
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('join', (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined room`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Function to send notification
const sendNotification = async (userId, message, type) => {
  const notification = new Notification({
    userId,
    message,
    type,
    createdAt: new Date()
  });
  await notification.save();
  io.to(userId).emit('notification', notification);
};

global.sendNotification = sendNotification;

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});