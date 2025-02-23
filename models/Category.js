const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const CategorySchema = new Schema({
  name: { type: String, required: true, unique: true, trim: true },
  description: { type: String, maxlength: 500 },
  products: [{ type: Schema.Types.ObjectId, ref: "Product" }],
  createdAt: { type: Date, default: Date.now }
});

const Category = mongoose.model("Category", CategorySchema);
module.exports = Category;
