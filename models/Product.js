const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ProductSchema = new Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, maxlength: 1000 },
  price: { type: Number, required: true, min: 0 },
  category: { type: Schema.Types.ObjectId, ref: "Category", required: true },
  stockQuantity: { type: Number, required: true, min: 0 }, // Track stock
  createdAt: { type: Date, default: Date.now }
});

const Product = mongoose.model("Product", ProductSchema);
module.exports = Product;
