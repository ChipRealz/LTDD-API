const express = require('express');
const router = express.Router();
const { OpenAI } = require('openai');
const Product = require('../models/Product');
const authMiddleware = require('../middleware/auth');

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

// Chatbot endpoint
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ 
        status: "FAILED", 
        message: "Message is required" 
      });
    }

    // First, try to find relevant products
    const keywords = extractKeywords(message);
    let products = [];
    if (keywords.length > 0) {
      products = await Product.find({
        $or: [
          { name: { $regex: keywords.join('|'), $options: 'i' } },
          { description: { $regex: keywords.join('|'), $options: 'i' } }
        ]
      }).limit(5);
    } else {
      products = await Product.find().limit(5); // Return some products if no keywords
    }
    console.log('Keywords:', keywords);
    console.log('Products found:', products.length);

    // Create a context string with product information
    const productContext = products.length > 0 
      ? products.map(p => `Product: ${p.name}, Price: $${p.price}, Stock: ${p.stockQuantity}, Description: ${p.description}`).join('\n')
      : 'No matching products found.';

    // Create the system message with context
    const systemMessage = `You are a helpful e-commerce assistant. Use the following product information to help answer the customer's question:
${productContext}

If the customer is asking about a product that's not in the list, politely inform them that you don't have information about that specific product.
Keep your responses concise and focused on the available product information.`;

    // Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: message }
      ],
      max_tokens: 150,
      temperature: 0.7
    });

    const reply = completion.choices[0].message.content;

    res.json({ 
      status: "SUCCESS",
      reply,
      products: products.length > 0 ? products : []
    });

  } catch (error) {
    console.error('Chatbot error:', error);
    res.status(500).json({ 
      status: "FAILED", 
      message: "Error processing your request",
      error: error.message 
    });
  }
});

module.exports = router; 