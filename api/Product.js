const express = require("express");
const router = express.Router();
const Product = require("../models/Product");

// Get all products
router.get("/", async (req, res) => {
  try {
    const products = await Product.find().populate("category"); // Populate category details
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get specific product by ID
router.get("/:productId", async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId).populate("category");
    if (!product) return res.status(404).json({ message: "Product not found" });

    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new product
router.post("/", async (req, res) => {
  try {
    const { name, description, price, category, stockQuantity } = req.body;

    if (!name || !price || !category) {
      return res.status(400).json({ message: "Name, price, and category are required." });
    }

    const product = new Product({
      name,
      description,
      price,
      category,
      stockQuantity: stockQuantity || 0 // Default stock to 0 if not provided
    });

    const savedProduct = await product.save();
    res.status(201).json(savedProduct);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update product details
router.patch("/:productId", async (req, res) => {
  try {
    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.productId,
      { $set: req.body },
      { new: true, runValidators: true }
    ).populate("category");

    if (!updatedProduct) return res.status(404).json({ message: "Product not found" });

    res.json(updatedProduct);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete product
router.delete("/:productId", async (req, res) => {
  try {
    const removedProduct = await Product.findByIdAndDelete(req.params.productId);
    if (!removedProduct) return res.status(404).json({ message: "Product not found" });

    res.json({ message: "Product deleted successfully", product: removedProduct });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
