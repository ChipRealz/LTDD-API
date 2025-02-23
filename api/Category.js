const express = require("express");
const router = express.Router();
const Category = require("../models/Category");
const Product = require("../models/Product");

// Get all categories
router.get("/", async (req, res) => {
  try {
    const categories = await Category.find().populate("products"); // Populate product details
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get specific category by ID
router.get("/:categoryId", async (req, res) => {
  try {
    const category = await Category.findById(req.params.categoryId).populate("products");
    if (!category) return res.status(404).json({ message: "Category not found" });

    res.json(category);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new category
router.post("/", async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Category name is required." });
    }

    const category = new Category({ name, description });

    const savedCategory = await category.save();
    res.status(201).json(savedCategory);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update category details
router.patch("/:categoryId", async (req, res) => {
  try {
    const updatedCategory = await Category.findByIdAndUpdate(
      req.params.categoryId,
      { $set: req.body },
      { new: true, runValidators: true }
    ).populate("products");

    if (!updatedCategory) return res.status(404).json({ message: "Category not found" });

    res.json(updatedCategory);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete category and optionally its products
router.delete("/:categoryId", async (req, res) => {
  try {
    const removedCategory = await Category.findByIdAndDelete(req.params.categoryId);
    if (!removedCategory) return res.status(404).json({ message: "Category not found" });

    // Optionally delete associated products
    await Product.deleteMany({ category: req.params.categoryId });

    res.json({ message: "Category and associated products deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
