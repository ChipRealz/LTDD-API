require('./config/db')

const app = require('express')();
const port = process.env.PORT || 5000;

const UserRouter = require('./api/User')
const CategoryRouter = require('./api/Category')
const ProductRouter = require('./api/Product')
const SaleRouter = require('./api/Sales')

const bodyParser = require('express').json;
app.use(bodyParser());

app.use('/user', UserRouter)

app.use('/category', CategoryRouter)

app.use('/product', ProductRouter)

app.use('/sale', SaleRouter)

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
})