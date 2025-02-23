const express = require("express");
const router = express.Router();
const Sale = require("../models/Sales");
const Product = require("../models/Product");

// Get all sales
router.get("/", async (req, res) => {
  try {
    const sales = await Sale.find().populate("product"); // Populate product details
    res.json(sales);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get top 5 sales (highest total price)
router.get("/top", async (req, res) => {
  try {
    const sales = await Sale.find().sort({ totalPrice: -1 }).limit(5).populate("product");
    res.json(sales);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get specific sale by ID
router.get("/:saleId", async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.saleId).populate("product");
    if (!sale) return res.status(404).json({ message: "Sale not found" });

    res.json(sale);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a new sale
router.post("/", async (req, res) => {
  try {
    const { productId, quantity } = req.body;

    if (!productId || !quantity) {
      return res.status(400).json({ message: "Product ID and quantity are required." });
    }

    // Find product
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Check if enough stock is available
    if (product.stockQuantity < quantity) {
      return res.status(400).json({ message: "Not enough stock available" });
    }

    // Calculate total price
    const totalPrice = product.price * quantity;

    // Create and save the sale
    const sale = new Sale({
      product: productId,
      quantity,
      totalPrice
    });

    await sale.save();

    // Reduce stock quantity in product
    product.stockQuantity -= quantity;
    await product.save();

    res.status(201).json(sale);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update sale details
router.patch("/:saleId", async (req, res) => {
  try {
    const updatedSale = await Sale.findByIdAndUpdate(
      req.params.saleId,
      { $set: req.body },
      { new: true, runValidators: true }
    ).populate("product");

    if (!updatedSale) return res.status(404).json({ message: "Sale not found" });

    res.json(updatedSale);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete a sale
router.delete("/:saleId", async (req, res) => {
  try {
    const removedSale = await Sale.findByIdAndDelete(req.params.saleId);
    if (!removedSale) return res.status(404).json({ message: "Sale not found" });

    res.json({ message: "Sale deleted successfully", sale: removedSale });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
