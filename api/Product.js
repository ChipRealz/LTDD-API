const express = require("express");
const router = express.Router();
const Product = require("../models/Product");
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const Admin = require('../models/Admin');
const Category = require("../models/Category");

// Configure Cloudinary storage for multer
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'products',
    allowed_formats: ['jpg', 'png', 'jpeg'],
  },
});

const upload = multer({ storage });

// Get all products with search and filter functionality
router.get("/", async (req, res) => {
  try {
    const { search, category, minPrice, maxPrice, sortBy } = req.query;
    let query = {};

    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    if (category) {
      query.category = category;
    }

    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    let sortOption = {};
    if (sortBy === "price_asc") sortOption.price = 1;
    if (sortBy === "price_desc") sortOption.price = -1;
    if (sortBy === "name_asc") sortOption.name = 1;
    if (sortBy === "name_desc") sortOption.name = -1;

    const products = await Product.find(query)
      .populate("category")
      .sort(sortOption);

    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get top-selling products
router.get("/top-selling", async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const products = await Product.find()
      .sort({ purchaseCount: -1 })
      .limit(Number(limit))
      .populate("category")
      .select('name price image description purchaseCount stockQuantity category');

    res.json({
      success: true,
      message: 'Top selling products fetched successfully',
      products
    });
  } catch (err) {
    res.status(500).json({ 
      success: false,
      message: 'Error fetching top selling products',
      error: err.message 
    });
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

// Add new product with image upload
router.post("/", upload.single('image'), async (req, res) => {
  try {
    const { name, description, price, category, stockQuantity } = req.body;

    if (!name || !price || !category) {
      return res.status(400).json({ message: "Name, price, and category are required." });
    }

    const productData = {
      name,
      description,
      price,
      category,
      stockQuantity: stockQuantity || 0,
    };

    // If an image was uploaded, add the Cloudinary URL to product data
    if (req.file) {
      productData.image = req.file.path; // Cloudinary URL
    }

    const product = new Product(productData);
    const savedProduct = await product.save();
    
    // Update the category to include this product
    await Category.findByIdAndUpdate(
      category,
      { $push: { products: savedProduct._id } }
    );

    // Send notification to admin (optional, assuming admin user ID exists)
    if (global.sendNotification) {
      // Find an admin user to send notification to
      const admin = await Admin.findOne();
      if (admin) {
        global.sendNotification(admin._id, `New product added: ${name}`, 'post');
      }
    }

    res.status(201).json(savedProduct);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update product
router.put("/:productId", upload.single('image'), async (req, res) => {
  try {
    const { name, description, price, category, stockQuantity } = req.body;
    const updateData = { name, description, price, category, stockQuantity };

    if (req.file) {
      updateData.image = req.file.path;
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.productId,
      { $set: updateData },
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

    // Optionally, delete the image from Cloudinary if it exists
    if (removedProduct.image) {
      const publicId = removedProduct.image.split('/').pop().split('.')[0];
      await cloudinary.uploader.destroy(`products/${publicId}`);
    }

    res.json({ message: "Product deleted successfully", product: removedProduct });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;