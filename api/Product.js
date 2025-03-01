const express = require("express");
const router = express.Router();
const Product = require("../models/Product");

// Get all products with search and filter functionality
router.get("/", async (req, res) => {
  try {
    // Extract query parameters for search and filtering
    const { search, category, minPrice, maxPrice, sortBy } = req.query;

    // Build the query object
    let query = {};

    // Search by product name (case-insensitive)
    if (search) {
      query.name = { $regex: search, $options: "i" }; // 'i' for case-insensitive
    }

    // Filter by category (assuming category is an ObjectId or name)
    if (category) {
      query.category = category; // If category is an ObjectId
      // If category is a name, you'd need to fetch the category ID first:
      // const categoryDoc = await Category.findOne({ name: category });
      // if (categoryDoc) query.category = categoryDoc._id;
    }

    // Filter by price range
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    // Sorting logic (e.g., by price or name)
    let sortOption = {};
    if (sortBy) {
      if (sortBy === "price_asc") sortOption.price = 1;
      if (sortBy === "price_desc") sortOption.price = -1;
      if (sortBy === "name_asc") sortOption.name = 1;
      if (sortBy === "name_desc") sortOption.name = -1;
    }

    // Execute the query with population, sorting, and filtering
    const products = await Product.find(query)
      .populate("category") // Populate category details
      .sort(sortOption);

    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get specific product by ID (for viewing product details)
router.get("/:productId", async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId).populate("category");
    if (!product) return res.status(404).json({ message: "Product not found" });

    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new product (unchanged)
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
      stockQuantity: stockQuantity || 0,
    });

    const savedProduct = await product.save();
    res.status(201).json(savedProduct);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update product details (unchanged)
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

// Delete product (unchanged)
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