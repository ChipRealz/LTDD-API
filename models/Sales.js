const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const SaleSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
  quantity: { type: Number, required: true, min: 1 },
  totalPrice: { type: Number, required: true, min: 0 }, // This must be calculated before saving
  saleDate: { type: Date, default: Date.now }
});

const Sale = mongoose.model("Sale", SaleSchema);
module.exports = Sale;
