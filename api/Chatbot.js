const express = require('express');
const router = express.Router();
const { OpenAI } = require('openai');
const Product = require('../models/Product');
const authMiddleware = require('../middleware/auth');
const Promotion = require('../models/Promotion');
const Order = require('../models/Order');
const Category = require('../models/Category');
const ViewedProduct = require('../models/ViewedProduct');
const Sentiment = require('sentiment');
const sentiment = new Sentiment();
const Review = require('../models/Review');
const mongoose = require('mongoose');
const Fuse = require('fuse.js');
const pluralize = require('pluralize');

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

// Get user's browsing history
async function getUserBrowsingHistory(userId, limit = 10) {
  return await ViewedProduct.find({ userId })
    .sort({ viewedAt: -1 })
    .limit(limit)
    .populate('productId');
}

// Get trending products (based on recent views and purchases)
async function getTrendingProducts(limit = 5) {
  const recentDate = new Date();
  recentDate.setDate(recentDate.getDate() - 7); // Last 7 days

  return await Product.aggregate([
    {
      $lookup: {
        from: 'viewedproducts',
        localField: '_id',
        foreignField: 'productId',
        as: 'views'
      }
    },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'items.productId',
        as: 'orders'
      }
    },
    {
      $addFields: {
        recentViews: {
          $size: {
            $filter: {
              input: '$views',
              as: 'view',
              cond: { $gte: ['$$view.viewedAt', recentDate] }
            }
          }
        },
        recentPurchases: {
          $size: {
            $filter: {
              input: '$orders',
              as: 'order',
              cond: { 
                $and: [
                  { $eq: ['$$order.status', 'DELIVERED'] },
                  { $gte: ['$$order.createdAt', recentDate] }
                ]
              }
            }
          }
        }
      }
    },
    {
      $addFields: {
        trendScore: {
          $add: [
            { $multiply: ['$recentViews', 1] },
            { $multiply: ['$recentPurchases', 2] }
          ]
        }
      }
    },
    { $sort: { trendScore: -1 } },
    { $limit: limit }
  ]);
}

// Get complementary products (frequently bought together)
async function getComplementaryProducts(productId, limit = 5) {
  const product = await Product.findById(productId);
  if (!product) return [];

  return await Order.aggregate([
    {
      $match: {
        'items.productId': productId,
        status: 'DELIVERED'
      }
    },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.productId',
        count: { $sum: 1 }
      }
    },
    {
      $match: {
        _id: { $ne: productId }
      }
    },
    { $sort: { count: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: 'products',
        localField: '_id',
        foreignField: '_id',
        as: 'product'
      }
    },
    { $unwind: '$product' }
  ]);
}

// Get seasonal recommendations
async function getSeasonalRecommendations(limit = 5) {
  const currentMonth = new Date().getMonth();
  const season = currentMonth >= 2 && currentMonth <= 4 ? 'spring' :
                currentMonth >= 5 && currentMonth <= 7 ? 'summer' :
                currentMonth >= 8 && currentMonth <= 10 ? 'fall' : 'winter';

  return await Product.find({
    $or: [
      { description: { $regex: season, $options: 'i' } },
      { tags: season }
    ]
  })
    .sort({ purchaseCount: -1 })
    .limit(limit)
    .populate('category', 'name');
}

// Get review stats for a product
async function getProductReviewStats(productId) {
  const stats = await Review.aggregate([
    { $match: { productId: new mongoose.Types.ObjectId(productId), rating: { $exists: true } } },
    {
      $group: {
        _id: '$productId',
        avgRating: { $avg: '$rating' },
        reviewCount: { $sum: 1 }
      }
    }
  ]);
  return stats[0] || { avgRating: null, reviewCount: 0 };
}

// Get top keywords from comments/reviews
async function getTopKeywords(productId, limit = 5) {
  const comments = await Review.find({ productId, comment: { $exists: true, $ne: '' } }).select('comment');
  const allText = comments.map(c => c.comment).join(' ').toLowerCase();
  const words = allText.match(/\b\w+\b/g) || [];
  const freq = {};
  words.forEach(word => {
    if (word.length > 2) freq[word] = (freq[word] || 0) + 1;
  });
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

// Get sentiment score for a product's reviews
async function getReviewSentiment(productId) {
  const reviews = await Review.find({ productId, comment: { $exists: true, $ne: '' } }).select('comment');
  let totalScore = 0, count = 0;
  reviews.forEach(r => {
    if (r.comment) {
      const result = sentiment.analyze(r.comment);
      totalScore += result.score;
      count++;
    }
  });
  return count ? (totalScore / count) : 0; // >0 positive, <0 negative
}

// Enhance product analytics in chatbot replies
async function addProductAnalytics(products) {
  for (const product of products) {
    const [stats, keywords, sentimentScore] = await Promise.all([
      getProductReviewStats(product._id),
      getTopKeywords(product._id),
      getReviewSentiment(product._id)
    ]);
    product.analytics = {
      avgRating: stats.avgRating,
      reviewCount: stats.reviewCount,
      topKeywords: keywords,
      sentiment: sentimentScore
    };
  }
  return products;
}

// Helper function to calculate user cashflow
async function getUserCashflow(userId) {
  const orders = await Order.find({ userId });
  const statusList = [
    'PENDING', 'SUCCESS', 'FAILED', 'CANCELED', 'DELIVERED',
    'NEW', 'CONFIRMED', 'PREPARING', 'DELIVERING', 'CANCELREQUESTED'
  ];
  const statusTotals = {};
  statusList.forEach(status => { statusTotals[status] = 0; });
  orders.forEach(order => {
    const status = order.status ? order.status.toUpperCase() : '';
    if (statusTotals.hasOwnProperty(status)) {
      statusTotals[status] += order.totalAmount;
    }
  });
  const totalSpent = (statusTotals['DELIVERED'] || 0) + (statusTotals['SUCCESS'] || 0) + (statusTotals['CONFIRMED'] || 0);
  return { ...statusTotals, totalSpent };
}

// Helper: Format product for response
function formatProduct(product) {
  return {
    _id: product._id,
    name: product.name,
    price: product.price,
    image: product.image,
    analytics: product.analytics,
    description: product.description,
    detailsUrl: `/products/${product._id}` // Adjust as needed
  };
}

// Helper: Format order for response
function formatOrder(order) {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    totalAmount: order.totalAmount,
    createdAt: order.createdAt,
    items: order.items.map(item => ({
      name: item.name,
      quantity: item.quantity,
      price: item.price
    }))
  };
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

    // Intent detection: Help or What can I ask
    if (
      /help|what can i ask|what can you do|how to use|options|commands|menu/i.test(message)
    ) {
      const helpText = `
You can ask me things like:
• Show me top products
• What are the best sellers?
• Show me trending products
• Show me products in [category]
• Show me similar products to [product name]
• What do you recommend?
• Show my order history
• Track my order
• Check my cash flow
• Any current promotions?
• Search for [product name or keyword]
…and more! Just ask away! 😄
      `.trim();

      return res.json({
        status: 'SUCCESS',
        reply: helpText,
        suggestions: [
          "Show me top products",
          "Show my order history",
          "Check my cash flow",
          "Any current promotions?"
        ]
      });
    }

    // Intent detection: Top products / Best sellers
    if (/top products|best sellers|most popular|top rated|best products/i.test(message)) {
      const topProducts = await Product.find()
        .sort({ purchaseCount: -1 })
        .limit(5)
        .populate('category', 'name');

      if (topProducts && topProducts.length > 0) {
        await addProductAnalytics(topProducts);
      }

      const funnyTopProductLines = [
        "These products are flying off the shelves faster than hotcakes! 🥞",
        "Our customers can't get enough of these! 😍",
        "If these products were any hotter, they'd need sunscreen! ☀️",
        "Top picks, as chosen by people with excellent taste (like you)! 😎"
      ];
      const randomFunnyLine = funnyTopProductLines[Math.floor(Math.random() * funnyTopProductLines.length)];

      return res.json({
        status: 'SUCCESS',
        reply: `Here are our top products right now:\n${randomFunnyLine}`,
        products: topProducts.map(formatProduct)
      });
    }

    // Intent detection: Trending products
    if (/trending|popular.*now|what.*hot|what.*everyone.*buying/i.test(message)) {
      const trendingProducts = await getTrendingProducts(5);
      await addProductAnalytics(trendingProducts);
      return res.json({
        status: 'SUCCESS',
        reply: "Here are the trending products right now:",
        products: trendingProducts,
        type: 'trending'
      });
    }

    // Intent detection: Seasonal recommendations
    if (/seasonal|season|summer|winter|spring|fall|autumn/i.test(message)) {
      const seasonalProducts = await getSeasonalRecommendations(5);
      await addProductAnalytics(seasonalProducts);
      return res.json({
        status: 'SUCCESS',
        reply: "Here are some seasonal recommendations:",
        products: seasonalProducts,
        type: 'seasonal'
      });
    }

    // Intent detection: Complementary products
    if (/go.*with|pair.*with|complete.*look|what.*else.*need/i.test(message)) {
      const productMatch = message.match(/product\s+(\w+)/i) || message.match(/(\w+)\s+product/i);
      if (productMatch) {
        const productName = productMatch[1];
        const product = await Product.findOne({ name: { $regex: new RegExp(productName, 'i') } });
        
        if (product) {
          const complementaryProducts = await getComplementaryProducts(product._id, 5);
          await addProductAnalytics(complementaryProducts);
          return res.json({
            status: 'SUCCESS',
            reply: `Here are some products that go well with ${product.name}:`,
            products: complementaryProducts.map(cp => cp.product),
            targetProduct: product,
            type: 'complementary'
          });
        }
      }
    }

    // Enhanced category intent detection with fuzzy matching (stricter)
    if (
      /category|products in|show.*in|list.*in|what.*in|find.*in/i.test(message)
    ) {
      // Get all categories from DB
      const allCategories = await Category.find({});
      const categoryNames = allCategories.map(cat => cat.name);
      // Set up Fuse.js for fuzzy matching
      const fuse = new Fuse(categoryNames, {
        threshold: 0.4, // Lower is stricter, higher is fuzzier
        includeScore: true
      });

      // Try to extract a possible category from the message
      let categoryName = null;
      const inMatch = message.match(/in ([a-zA-Z0-9 ]+)/i);
      if (inMatch) categoryName = inMatch[1].trim();
      const catMatch = message.match(/category\s+([a-zA-Z0-9 ]+)/i);
      if (catMatch) categoryName = catMatch[1].trim();
      if (!categoryName && message.trim().split(' ').length === 1) {
        categoryName = message.trim();
      }

      // Fuzzy match using Fuse.js (try both original and plural/singular forms)
      let bestMatch = null;
      if (categoryName) {
        let searchTerms = [
          categoryName,
          pluralize.singular(categoryName),
          pluralize.plural(categoryName)
        ];
        for (const term of searchTerms) {
          const result = fuse.search(term);
          if (result.length > 0 && (!bestMatch || result[0].score < bestMatch.score)) {
            bestMatch = result[0];
          }
        }
      }

      // If still not found, try to match any category name in the message (fuzzy)
      if (!bestMatch) {
        for (const cat of allCategories) {
          const result = fuse.search(cat.name);
          if (result.length > 0 && result[0].score < 0.4) {
            bestMatch = result[0];
            break;
          }
        }
      }

      if (bestMatch) {
        const category = await Category.findOne({ name: bestMatch.item });
        if (category) {
          const products = await Product.find({ category: category._id })
            .sort({ purchaseCount: -1 })
            .limit(5)
            .populate('category', 'name');
          await addProductAnalytics(products);

          return res.json({
            status: 'SUCCESS',
            reply: `Here are some popular products in the ${category.name} category:`,
            products,
            category: category.name
          });
        }
      } else {
        return res.json({
          status: 'SUCCESS',
          reply: `I couldn't find a category matching your request. Would you like to see our available categories?`,
          products: []
        });
      }
    }

    // Intent detection: Similar products
    if (/similar|like this|recommend.*similar|other.*like/i.test(message)) {
      const productMatch = message.match(/product\s+(\w+)/i) || message.match(/(\w+)\s+product/i);
      if (productMatch) {
        const productName = productMatch[1];
        const product = await Product.findOne({ name: { $regex: new RegExp(productName, 'i') } });
        if (product) {
          const priceRange = {
            min: product.price * 0.8,
            max: product.price * 1.2
          };
          const similarProducts = await Product.find({
            _id: { $ne: product._id },
            category: product.category,
            price: { $gte: priceRange.min, $lte: priceRange.max }
          })
            .sort({ purchaseCount: -1 })
            .limit(5)
            .populate('category', 'name');
          await addProductAnalytics(similarProducts);
          return res.json({
            status: 'SUCCESS',
            reply: `Here are some similar products to ${product.name}:`,
            products: similarProducts,
            targetProduct: product
          });
        } else {
          return res.json({
            status: 'SUCCESS',
            reply: `Sorry, I couldn't find a product named "${productName}". Please check the name or try another product.`,
            products: []
          });
        }
      } else {
        return res.json({
          status: 'SUCCESS',
          reply: `Sorry, I couldn't determine which product you meant. Please specify the product name.`,
          products: []
        });
      }
    }

    // Intent detection: Recommendations
    if (/recommend|suggest|what.*buy|looking.*for/i.test(message)) {
      // Get user's browsing history
      const browsingHistory = await getUserBrowsingHistory(req.user.userId);
      const viewedCategories = browsingHistory.map(item => item.productId.category);

      // Get user's purchased categories
      const purchasedCategories = await Order.aggregate([
        { $match: { userId: req.user.userId, status: 'DELIVERED' } },
        { $unwind: '$items' },
        {
          $lookup: {
            from: 'products',
            localField: 'items.productId',
            foreignField: '_id',
            as: 'product'
          }
        },
        { $unwind: '$product' },
        {
          $group: {
            _id: '$product.category',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ]);

      // Combine viewed and purchased categories
      const allCategories = [...new Set([...viewedCategories, ...purchasedCategories.map(c => c._id)])];

      if (allCategories.length > 0) {
        const recommendedProducts = await Product.find({
          category: { $in: allCategories }
        })
          .sort({ purchaseCount: -1 })
          .limit(5)
          .populate('category', 'name');
        await addProductAnalytics(recommendedProducts);

        return res.json({
          status: 'SUCCESS',
          reply: "Based on your browsing and purchase history, here are some products you might like:",
          products: recommendedProducts,
          type: 'personalized'
        });
      } else {
        const popularProducts = await Product.find()
          .sort({ purchaseCount: -1 })
          .limit(5)
          .populate('category', 'name');
        await addProductAnalytics(popularProducts);

        return res.json({
          status: 'SUCCESS',
          reply: "Here are some popular products you might be interested in:",
          products: popularProducts,
          type: 'popular'
        });
      }
    }

    // Intent detection: Promotion
    if (/promotion|coupon|discount|sale|deal/i.test(message)) {
      const now = new Date();
      const promotions = await Promotion.find({ expiresAt: { $gt: now } });
      if (promotions.length > 0) {
        return res.json({
          status: 'SUCCESS',
          reply: `Current promotions: ` + promotions.map(p => `${p.code} (${p.type === 'percent' ? p.discount + '%' : p.discount + ' off'}, min order: ${p.minOrderValue}, expires: ${p.expiresAt.toLocaleDateString()})`).join('; '),
          promotions
        });
      } else {
        return res.json({ status: 'SUCCESS', reply: 'There are no active promotions right now.', promotions: [] });
      }
    }

    // Intent detection: Order status
    if (/order status|where.*order|my order|track.*order/i.test(message)) {
      const latestOrder = await Order.findOne({ userId: req.user.userId })
        .sort({ createdAt: -1 })
        .populate('items.productId', 'name');
      
      if (latestOrder) {
        return res.json({
          status: 'SUCCESS',
          reply: `Your latest order (${latestOrder.orderNumber}) is ${latestOrder.status}.`,
          order: latestOrder
        });
      } else {
        return res.json({
          status: 'SUCCESS',
          reply: "You haven't placed any orders yet."
        });
      }
    }

    // Intent detection: Cashflow
    if (/cashflow|how much.*spent|spending|order total|purchase history|total spent/i.test(message)) {
      const cashflow = await getUserCashflow(req.user.userId);
      const funnyCashflowLines = [
        "Here's your spending summary. Don't worry, your secret's safe with me! 💸🤐",
        "Money well spent! Or at least, that's what I tell myself. 😅",
        "Here's where your wallet's been working overtime! 🦾"
      ];
      const randomCashflowLine = funnyCashflowLines[Math.floor(Math.random() * funnyCashflowLines.length)];
      if (cashflow.totalSpent > 0) {
        return res.json({
          status: 'SUCCESS',
          reply: `Here's a summary of your spending:\n${randomCashflowLine}\n- Total spent: $${cashflow.totalSpent}\n- Delivered: $${cashflow.DELIVERED}\n- Confirmed: $${cashflow.CONFIRMED}\n- Pending: $${cashflow.PENDING}\n- Canceled: $${cashflow.CANCELED}`,
          cashflow,
          products: []
        });
      } else {
        return res.json({
          status: 'SUCCESS',
          reply: "You haven't placed any orders yet, so there's no cash flow to show.",
          cashflow,
          products: []
        });
      }
    }

    // Intent detection: Order history
    if (/history|order history|my orders|recent orders|order list/i.test(message)) {
      const orders = await Order.find({ userId: req.user.userId }).sort({ createdAt: -1 }).limit(5);
      const funnyOrderLines = [
        "Here's your order history—no judgment on the midnight snack orders! 🌙🍕",
        "Look at all these awesome purchases! Retail therapy is real. 🛍️",
        "Your shopping history is almost as impressive as your taste in chatbots! 🤖"
      ];
      const randomOrderLine = funnyOrderLines[Math.floor(Math.random() * funnyOrderLines.length)];
      if (orders.length > 0) {
        return res.json({
          status: 'SUCCESS',
          reply: `Here are your most recent orders:\n${randomOrderLine}`,
          orders: orders.map(formatOrder)
        });
      } else {
        return res.json({
          status: 'SUCCESS',
          reply: "You haven't placed any orders yet. Want to browse our top products? (I promise I won't tell anyone! 🤫)",
          orders: [],
          suggestions: ["Show me top products"]
        });
      }
    }

    // Default: Search products by keywords
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
      products = await Product.find().limit(5);
    }

    if (products && products.length > 0) {
      await addProductAnalytics(products);
      // Create a context string with product information
      const productContext = products.map(p => `Product: ${p.name}, Price: $${p.price}, Stock: ${p.stockQuantity}, Description: ${p.description}`).join('\n');
      // Create the system message with context
      const systemMessage = `You are a helpful e-commerce assistant. Use the following product information to help answer the customer's question:\n${productContext}\n\nIf the customer is asking about a product that's not in the list, politely inform them that you don't have information about that specific product.\nKeep your responses concise and focused on the available product information.`;
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
      return res.json({
        status: "SUCCESS",
        reply,
        products
      });
    } else {
      // User-friendly error message if no products found
      return res.json({
        status: 'SUCCESS',
        reply: "Sorry, I couldn't find any products matching your request. Please try a different keyword or ask for help.",
        products: []
      });
    }
  } catch (error) {
    console.error('Chatbot error:', error);
    res.status(500).json({ 
      status: "FAILED", 
      message: "Error processing your request",
      error: error.message 
    });
  }
});

// Get products by category
router.get('/category/:categoryId', async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { limit = 10, page = 1, sort = 'price' } = req.query;

    // Validate category exists
    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    // Build sort options
    let sortOptions = {};
    switch (sort) {
      case 'price_asc':
        sortOptions = { price: 1 };
        break;
      case 'price_desc':
        sortOptions = { price: -1 };
        break;
      case 'popular':
        sortOptions = { purchaseCount: -1 };
        break;
      default:
        sortOptions = { price: 1 };
    }

    // Get products with pagination
    const products = await Product.find({ category: categoryId })
      .sort(sortOptions)
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('category', 'name');

    // Get total count for pagination
    const total = await Product.countDocuments({ category: categoryId });

    if (products && products.length > 0) {
      await addProductAnalytics(products);
    }

    res.json({
      success: true,
      category: category.name,
      products,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get similar products
router.get('/similar/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { limit = 5 } = req.query;

    // Get the target product
    const targetProduct = await Product.findById(productId);
    if (!targetProduct) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Find similar products based on:
    // 1. Same category
    // 2. Similar price range (±20%)
    // 3. Different from the target product
    const priceRange = {
      min: targetProduct.price * 0.8,
      max: targetProduct.price * 1.2
    };

    const similarProducts = await Product.find({
      _id: { $ne: productId },
      category: targetProduct.category,
      price: { $gte: priceRange.min, $lte: priceRange.max }
    })
      .sort({ purchaseCount: -1 }) // Sort by popularity
      .limit(parseInt(limit))
      .populate('category', 'name');

    if (similarProducts && similarProducts.length > 0) {
      await addProductAnalytics(similarProducts);
    }

    res.json({
      success: true,
      targetProduct: {
        name: targetProduct.name,
        price: targetProduct.price,
        category: targetProduct.category
      },
      similarProducts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get product recommendations based on user's purchase history
router.get('/recommendations', async (req, res) => {
  try {
    const { userId } = req.user;
    const { limit = 5 } = req.query;

    // Get user's purchased categories
    const purchasedCategories = await Order.aggregate([
      { $match: { userId: userId, status: 'DELIVERED' } },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.productId',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $group: {
          _id: '$product.category',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    if (purchasedCategories.length === 0) {
      // If no purchase history, return popular products
      const popularProducts = await Product.find()
        .sort({ purchaseCount: -1 })
        .limit(parseInt(limit))
        .populate('category', 'name');
      
      if (popularProducts && popularProducts.length > 0) {
        await addProductAnalytics(popularProducts);
      }

      return res.json({
        success: true,
        type: 'popular',
        products: popularProducts
      });
    }

    // Get top categories from purchase history
    const topCategories = purchasedCategories
      .slice(0, 3)
      .map(cat => cat._id);

    // Find products in these categories
    const recommendedProducts = await Product.find({
      category: { $in: topCategories }
    })
      .sort({ purchaseCount: -1 })
      .limit(parseInt(limit))
      .populate('category', 'name');

    if (recommendedProducts && recommendedProducts.length > 0) {
      await addProductAnalytics(recommendedProducts);
    }

    res.json({
      success: true,
      type: 'personalized',
      products: recommendedProducts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback for truly unknown queries
return res.json({
  status: 'SUCCESS',
  reply: "Sorry, I didn't quite get that. You can ask me about products, your orders, cash flow, or say 'help' to see what I can do! 😊",
  products: []
});

module.exports = router; 