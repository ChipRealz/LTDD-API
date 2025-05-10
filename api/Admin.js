require("dotenv").config();
const express = require("express");
const router = express.Router();
const Admin = require("./../models/Admin");
const PendingAdmin = require("./../models/PendingAdmin");
const AdminOTPVerification = require("./../models/AdminOTPVerification");
const PasswordReset = require("./../models/AdminPasswordReset");
const Sale = require("../models/Sales");
const Order = require("../models/Order");
const Product = require("../models/Product");
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

// Ensure environment variables are set
if (!process.env.AUTH_EMAIL || !process.env.AUTH_PASS) {
  console.error("Missing critical environment variables.");
  process.exit(1);
}

// Configure Nodemailer
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.AUTH_EMAIL,
    pass: process.env.AUTH_PASS,
  },
});

transporter.verify((error) => {
  if (error) console.error("Mail server error:", error);
  else console.log("Mail server is ready to send messages.");
});

// Send OTP Verification Email
const sendOTPVerificationEmail = async ({ _id, email }, res, type = "signup") => {
  try {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Clear existing OTP records
    await AdminOTPVerification.deleteMany({ adminId: _id });

    // Save new OTP record
    const otpVerification = new AdminOTPVerification({
      adminId: _id,
      otp,
      createdAt: Date.now(),
      expiredAt: Date.now() + 600000, // 10 minutes
    });

    await otpVerification.save();
    console.log("Saved OTP record:", otpVerification);

    // Email options
    const mailOptions = {
      from: process.env.AUTH_EMAIL,
      to: email,
      subject: type === "signup" ? "Admin Account Verification OTP" : "Admin Login OTP",
      html: `
        <p>Your OTP for ${type === "signup" ? "admin account verification" : "admin login"} is <b>${otp}</b>.</p>
        <p>This OTP <b>expires in 10 minutes</b>.</p>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({
      status: "PENDING",
      message: "OTP sent!",
      adminId: _id,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "FAILED", message: "Error sending OTP!" });
  }
};

// Admin Signup Route
router.post("/signup", async (req, res) => {
  try {
    let { name, email, password, dateOfBirth } = req.body;
    if (!name || !email || !password || !dateOfBirth) {
      return res.status(400).json({ status: "FAILED", message: "All required fields must be provided!" });
    }

    name = name.trim();
    email = email.trim();
    password = password.trim();
    dateOfBirth = dateOfBirth.trim();

    if (!/^[a-zA-Z ]*$/.test(name)) return res.status(400).json({ status: "FAILED", message: "Invalid name format!" });
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
      return res.status(400).json({ status: "FAILED", message: "Invalid email format!" });
    }
    if (isNaN(new Date(dateOfBirth).getTime())) return res.status(400).json({ status: "FAILED", message: "Invalid date of birth!" });
    if (password.length < 8) return res.status(400).json({ status: "FAILED", message: "Password must be at least 8 characters!" });

    // Check if email is already registered in Admin or PendingAdmin
    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) return res.status(400).json({ status: "FAILED", message: "Email already registered!" });

    const existingPendingAdmin = await PendingAdmin.findOne({ email });
    if (existingPendingAdmin) return res.status(400).json({ status: "FAILED", message: "Email is pending verification!" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newPendingAdmin = new PendingAdmin({
      name,
      email,
      password: hashedPassword,
      dateOfBirth,
    });

    const savedPendingAdmin = await newPendingAdmin.save();
    sendOTPVerificationEmail(savedPendingAdmin, res, "signup");
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "FAILED", message: "Internal server error!" });
  }
});

// Verify OTP Route (Used for Signup and Login)
router.post("/verifyOTP", async (req, res) => {
  try {
    const { adminId, otp } = req.body;
    console.log("Received adminId:", adminId);
    console.log("Received otp:", otp);

    if (!adminId || !otp) {
      return res.status(400).json({ status: "FAILED", message: "All fields are required!" });
    }

    // Check PendingAdmin for signup verification
    let pendingAdmin = await PendingAdmin.findById(adminId);
    let admin = await Admin.findById(adminId);

    if (!pendingAdmin && !admin) {
      return res.status(400).json({ status: "FAILED", message: "Admin not found!" });
    }

    const otpVerification = await AdminOTPVerification.findOne({ adminId });
    console.log("Found OTP record:", otpVerification);
    if (!otpVerification) return res.status(400).json({ status: "FAILED", message: "Invalid OTP request!" });
    if (Date.now() > otpVerification.expiredAt) return res.status(400).json({ status: "FAILED", message: "OTP expired!" });

    if (otp !== otpVerification.otp) return res.status(400).json({ status: "FAILED", message: "Invalid OTP!" });

    if (pendingAdmin) {
      // Move from PendingAdmin to Admin
      const newAdmin = new Admin({
        name: pendingAdmin.name,
        email: pendingAdmin.email,
        password: pendingAdmin.password,
        dateOfBirth: pendingAdmin.dateOfBirth,
        verified: true,
      });

      await newAdmin.save();
      admin = newAdmin;
      await PendingAdmin.deleteOne({ _id: adminId });
    } else if (admin) {
      // For login OTP verification, just update verified status
      await Admin.updateOne({ _id: adminId }, { verified: true });
    }

    await AdminOTPVerification.deleteOne({ adminId });

    // Generate JWT token
    const token = jwt.sign(
      { adminId: admin._id, email: admin.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({
      status: "SUCCESS",
      message: "OTP verified successfully!",
      adminId: admin._id,
      token
    });
  } catch (error) {
    console.error("Error in verifyOTP:", error);
    res.status(500).json({ status: "FAILED", message: "Internal server error!" });
  }
});

// Resend OTP Route
router.post("/resendOTPVerification", async (req, res) => {
  try {
    let { adminId, email } = req.body;

    if (!adminId || !email) {
      return res.status(400).json({ status: "FAILED", message: "Admin ID and email are required!" });
    }

    // Check if adminId exists in either PendingAdmin or Admin
    const pendingAdmin = await PendingAdmin.findById(adminId);
    const admin = await Admin.findById(adminId);

    if (!pendingAdmin && !admin) {
      return res.status(400).json({ status: "FAILED", message: "Admin not found!" });
    }

    if (pendingAdmin && pendingAdmin.email !== email) {
      return res.status(400).json({ status: "FAILED", message: "Email does not match!" });
    }
    if (admin && admin.email !== email) {
      return res.status(400).json({ status: "FAILED", message: "Email does not match!" });
    }

    await AdminOTPVerification.deleteMany({ adminId });
    sendOTPVerificationEmail({ _id: adminId, email }, res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "FAILED", message: error.message });
  }
});

// Admin Signin Route
router.post("/signin", async (req, res) => {
  try {
    let { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ status: "FAILED", message: "All fields are required!" });
    }

    email = email.trim();
    password = password.trim();

    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(400).json({ status: "FAILED", message: "Admin not found!" });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(400).json({ status: "FAILED", message: "Invalid credentials!" });

    sendOTPVerificationEmail(admin, res, "login");
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "FAILED", message: "Internal server error!" });
  }
});

// Request Password Reset (with OTP)
router.post("/requestPasswordReset", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ status: "FAILED", message: "Email is required!" });
    }

    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(400).json({ status: "FAILED", message: "Admin not found!" });
    if (!admin.verified) return res.status(400).json({ status: "FAILED", message: "Admin not verified!" });

    // Send OTP for password reset
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Clear existing reset records
    await PasswordReset.deleteMany({ adminId: admin._id });

    // Save new OTP record
    const reset = new PasswordReset({
      adminId: admin._id,
      resetString: otp,
      createdAt: Date.now(),
      expiredAt: Date.now() + 3600000, // 60 minutes
    });

    await reset.save();

    // Send OTP email
    const mailOptions = {
      from: process.env.AUTH_EMAIL,
      to: email,
      subject: "Admin Password Reset OTP",
      html: `
        <p>You requested a password reset.</p>
        <p>Your OTP is <b>${otp}</b>.</p>
        <p>This OTP <b>expires in 60 minutes</b>.</p>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({
      status: "PENDING",
      message: "Password reset OTP sent!",
      adminId: admin._id,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "FAILED", message: "Error sending password reset OTP!" });
  }
});

// Reset Password (with OTP)
router.post("/resetPassword", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ status: "FAILED", message: "All fields are required!" });
    }

    console.log("Reset password request for email:", email);
    const admin = await Admin.findOne({ email });
    console.log("Found admin:", admin);
    const reset = await PasswordReset.findOne({ adminId: admin?._id });
    console.log("Found reset record:", reset);

    if (!reset) return res.status(400).json({ status: "FAILED", message: "Invalid reset request!" });
    if (Date.now() > reset.expiredAt) return res.status(400).json({ status: "FAILED", message: "OTP expired!" });

    if (otp !== reset.resetString) return res.status(400).json({ status: "FAILED", message: "Invalid OTP!" });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await Admin.updateOne({ _id: admin._id }, { password: hashedPassword });
    await PasswordReset.deleteOne({ adminId: admin._id });

    res.status(200).json({
      status: "SUCCESS",
      message: "Password reset successful!",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "FAILED", message: "Internal server error!" });
  }
});

router.get("/", async (req, res) => {
    res.status(200).json({ status: "SUCCESS", message: "Admin API is working!" });
})

// Get all registered admins
router.get("/get-all-admins", async (req, res) => {
    console.log("Received request to get all admins");
    try {
        const admins = await Admin.find({}, {
            password: 0, // Exclude password from the response
            __v: 0      // Exclude version key
        });
        
        console.log("Found admins:", admins);
        
        res.status(200).json({
            status: "SUCCESS",
            message: "Admins retrieved successfully",
            data: admins
        });
    } catch (error) {
        console.error("Error fetching admins:", error);
        res.status(500).json({ 
            status: "FAILED", 
            message: "Error retrieving admin list" 
        });
    }
});

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

// SALES MANAGEMENT
// Get all sales
router.get("/sales", adminAuthMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, page = 1, limit = 10 } = req.query;
    const query = {};

    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const sales = await Sale.find(query)
      .populate("product")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Sale.countDocuments(query);

    res.json({
      success: true,
      sales,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    res.status(500).json({ 
      success: false,
      message: "Error fetching sales",
      error: err.message 
    });
  }
});

// Get sales statistics
router.get("/sales/stats", adminAuthMiddleware, async (req, res) => {
  try {
    const { period = 'daily' } = req.query;
    let groupBy;

    switch (period) {
      case 'daily':
        groupBy = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
        break;
      case 'monthly':
        groupBy = { $dateToString: { format: "%Y-%m", date: "$createdAt" } };
        break;
      case 'yearly':
        groupBy = { $dateToString: { format: "%Y", date: "$createdAt" } };
        break;
      default:
        groupBy = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
    }

    const stats = await Sale.aggregate([
      {
        $group: {
          _id: groupBy,
          totalSales: { $sum: "$totalPrice" },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      stats
    });
  } catch (err) {
    res.status(500).json({ 
      success: false,
      message: "Error fetching sales statistics",
      error: err.message 
    });
  }
});

// Get top selling products
router.get("/sales/top-products", adminAuthMiddleware, async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    const topProducts = await Sale.aggregate([
      {
        $group: {
          _id: "$product",
          totalQuantity: { $sum: "$quantity" },
          totalRevenue: { $sum: "$totalPrice" }
        }
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: parseInt(limit) },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "productDetails"
        }
      },
      { $unwind: "$productDetails" }
    ]);

    res.json({
      success: true,
      topProducts
    });
  } catch (err) {
    res.status(500).json({ 
      success: false,
      message: "Error fetching top products",
      error: err.message 
    });
  }
});

// CASH FLOW MANAGEMENT
// Get cash flow statistics
router.get("/cash-flow", adminAuthMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const matchStage = {};

    if (startDate && endDate) {
      matchStage.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Get order statistics
    const orderStats = await Order.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$status",
          totalAmount: { $sum: "$totalAmount" },
          count: { $sum: 1 }
        }
      }
    ]);

    // Get sales statistics
    const salesStats = await Sale.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalSales: { $sum: "$totalPrice" },
          count: { $sum: 1 }
        }
      }
    ]);

    // Calculate cash flow
    const cashFlow = {
      orders: {
        pending: { total: 0, count: 0 },
        processing: { total: 0, count: 0 },
        completed: { total: 0, count: 0 },
        cancelled: { total: 0, count: 0 }
      },
      sales: {
        total: salesStats[0]?.totalSales || 0,
        count: salesStats[0]?.count || 0
      }
    };

    // Map order statistics
    orderStats.forEach(stat => {
      switch (stat._id) {
        case 'New':
        case 'Confirmed':
          cashFlow.orders.pending.total += stat.totalAmount;
          cashFlow.orders.pending.count += stat.count;
          break;
        case 'Preparing':
        case 'Delivering':
          cashFlow.orders.processing.total += stat.totalAmount;
          cashFlow.orders.processing.count += stat.count;
          break;
        case 'Delivered':
          cashFlow.orders.completed.total += stat.totalAmount;
          cashFlow.orders.completed.count += stat.count;
          break;
        case 'Canceled':
          cashFlow.orders.cancelled.total += stat.totalAmount;
          cashFlow.orders.cancelled.count += stat.count;
          break;
      }
    });

    res.json({
      success: true,
      cashFlow
    });
  } catch (err) {
    res.status(500).json({ 
      success: false,
      message: "Error fetching cash flow statistics",
      error: err.message 
    });
  }
});

// Get daily revenue
router.get("/cash-flow/daily", adminAuthMiddleware, async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const dailyRevenue = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: { $in: ['Delivered', 'Completed'] }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          revenue: { $sum: "$totalAmount" },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      dailyRevenue
    });
  } catch (err) {
    res.status(500).json({ 
      success: false,
      message: "Error fetching daily revenue",
      error: err.message 
    });
  }
});

router.adminAuthMiddleware = adminAuthMiddleware;

module.exports = router;