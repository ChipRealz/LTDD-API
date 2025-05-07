const express = require('express');
const router = express.Router();
const { OpenAI } = require('openai');
const Product = require('../models/Product');
const Admin = require('../models/Admin');
const jwt = require('jsonwebtoken');
const Category = require('../models/Category');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Utility to split message into keywords (alphanumeric, min length 2)
function extractKeywords(message) {
  return message
    .toLowerCase()
    .split(/[^a-zA-Z0-9]+/)
    .filter(word => word.length > 1);
}

// Admin authentication middleware
const adminAuthMiddleware = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({
        status: "FAILED",
        message: "No token provided, authorization denied"
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const admin = await Admin.findById(decoded.adminId);
    if (!admin) {
      return res.status(401).json({
        status: "FAILED",
        message: "Admin not found, authorization denied"
      });
    }

    if (!admin.verified) {
      return res.status(401).json({
        status: "FAILED",
        message: "Admin not verified, authorization denied"
      });
    }

    req.admin = admin;
    next();
  } catch (err) {
    res.status(401).json({
      status: "FAILED",
      message: "Token is not valid",
      error: err.message
    });
  }
};

// In-memory context for admin sessions (for demo; use Redis/DB for production)
const adminContext = {};

// Admin Chatbot endpoint
router.post('/', adminAuthMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    const adminId = req.admin._id.toString();

    if (!message) {
      return res.status(400).json({
        status: "FAILED",
        message: "Message is required"
      });
    }

    const keywords = extractKeywords(message);
    const isQuantityQuery = /quantity|stock|available|amount|inventory/i.test(message);
    const isPriceQuery = /price|cost|how much|value/i.test(message);
    const isDescriptionQuery = /description|details|info|information/i.test(message);
    const isCategoryQuery = /category|categories|type|kind|group/i.test(message);
    let products = [];

    if (keywords.length > 0 && !isQuantityQuery && !isPriceQuery && !isDescriptionQuery && !isCategoryQuery) {
      products = await Product.find({
        $or: [
          { name: { $regex: keywords.join('|'), $options: 'i' } },
          { description: { $regex: keywords.join('|'), $options: 'i' } }
        ]
      }).limit(5);
      if (products.length > 0) {
        adminContext[adminId] = { lastProduct: products[0] };
      }
    } else if (isQuantityQuery) {
      const lastProduct = adminContext[adminId]?.lastProduct;
      if (lastProduct) {
        return res.json({
          status: "SUCCESS",
          reply: `The quantity for ${lastProduct.name} is ${lastProduct.stockQuantity}.`,
          products: [lastProduct]
        });
      } else {
        return res.json({
          status: "SUCCESS",
          reply: "Please specify the product you want the quantity information for.",
          products: []
        });
      }
    } else if (isPriceQuery) {
      const lastProduct = adminContext[adminId]?.lastProduct;
      if (lastProduct) {
        return res.json({
          status: "SUCCESS",
          reply: `The price for ${lastProduct.name} is $${lastProduct.price}.`,
          products: [lastProduct]
        });
      } else {
        return res.json({
          status: "SUCCESS",
          reply: "Please specify the product you want the price information for.",
          products: []
        });
      }
    } else if (isDescriptionQuery) {
      const lastProduct = adminContext[adminId]?.lastProduct;
      if (lastProduct) {
        return res.json({
          status: "SUCCESS",
          reply: `Description for ${lastProduct.name}: ${lastProduct.description}`,
          products: [lastProduct]
        });
      } else {
        return res.json({
          status: "SUCCESS",
          reply: "Please specify the product you want the description for.",
          products: []
        });
      }
    } else if (isCategoryQuery) {
      const categoryKeyword = keywords.find(word => word.length > 2);
      const allCategories = await Category.find().select('name');
      const categoryNames = allCategories.map(c => c.name).join(', ');

      if (categoryKeyword) {
        const categoryDoc = await Category.findOne({ name: { $regex: categoryKeyword, $options: 'i' } });
        if (categoryDoc) {
          const categoryProducts = await Product.find({ category: categoryDoc._id }).limit(5);
          if (categoryProducts.length > 0) {
            adminContext[adminId] = { lastProduct: categoryProducts[0] };
            return res.json({
              status: "SUCCESS",
              reply: `Here are some products in the category '${categoryDoc.name}': ${categoryProducts.map(p => p.name).join(', ')}`,
              products: categoryProducts
            });
          } else {
            return res.json({
              status: "SUCCESS",
              reply: `No products found in the category '${categoryDoc.name}'. Available categories: ${categoryNames}`,
              products: []
            });
          }
        } else {
          return res.json({
            status: "SUCCESS",
            reply: `Category '${categoryKeyword}' not found. Available categories: ${categoryNames}`,
            products: []
          });
        }
      } else {
        return res.json({
          status: "SUCCESS",
          reply: `Please specify the category you want to query. Available categories: ${categoryNames}`,
          products: []
        });
      }
    } else {
      products = []; // Don't force products if it's a general question
    }

    const productContext = products.length > 0
      ? products.map(p => `Product: ${p.name}, Price: $${p.price}, Stock: ${p.stockQuantity}, Description: ${p.description}`).join('\n')
      : 'No matching products found.';

    const systemMessage = `
You are an intelligent assistant for an e-commerce platform. 
You can help admins with:
1. Product and inventory questions
2. Category and stock searches
3. Sales and customer insights
4. System and admin tasks
5. General questions (weather, facts, jokes, etc.)

If product info is given, use it. If not, still answer using your knowledge.
${products.length > 0 ? `\nHere are some products you can reference:\n${productContext}` : ''}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: message }
      ],
      max_tokens: 250,
      temperature: 0.7
    });

    const reply = completion.choices[0].message.content;

    res.json({
      status: "SUCCESS",
      reply,
      products
    });

  } catch (error) {
    console.error('Admin Chatbot error:', error);
    res.status(500).json({
      status: "FAILED",
      message: "Error processing your request",
      error: error.message
    });
  }
});

module.exports = router;
