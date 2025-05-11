// middleware/auth.js
const jwt = require('jsonwebtoken');

const authMiddleware = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'No token provided, authorization denied' });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Attach user information to request object
    req.user = decoded; // Contains userId and email from the token payload
    
    // Check if user exists (optional, depending on your needs)
    const User = require('../models/User');
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ message: 'User not found, authorization denied' });
    }

    if (!user.verified) {
      return res.status(401).json({ message: 'User not verified, authorization denied' });
    }

    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid', error: err.message });
  }
};

module.exports = authMiddleware;