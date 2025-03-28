require('./config/db');
const app = require('express')();
const port = process.env.PORT || 5000;

const bodyParser = require('express').json;
app.use(bodyParser());

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

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});