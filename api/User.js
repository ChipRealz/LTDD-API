require("dotenv").config();
const express = require("express");
const router = express.Router();
const User = require("./../models/User");
const UserOTPVerification = require("./../models/UserOTPVerification");
const PasswordReset = require("./../models/PasswordReset");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

// Ensure environment variables are set
if (!process.env.AUTH_EMAIL || !process.env.AUTH_PASS || !process.env.JWT_SECRET) {
  console.error("Missing critical environment variables.");
  process.exit(1);
}

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Cloudinary storage for multer
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'users',
    allowed_formats: ['jpg', 'png', 'jpeg'],
  },
});

const upload = multer({ storage });

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

// Middleware for token verification
const verifyToken = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(401).json({ status: "FAILED", message: "No token provided!" });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ status: "FAILED", message: "Invalid token!" });
    req.user = decoded;
    next();
  });
};

// Send OTP Verification Email
const sendOTPVerificationEmail = async ({ _id, email }, res, type = "signup") => {
  try {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Clear existing OTP records
    await UserOTPVerification.deleteMany({ userId: _id });

    // Save new OTP record
    const otpVerification = new UserOTPVerification({
      userId: _id,
      otp,
      createdAt: Date.now(),
      expiredAt: Date.now() + 600000, // 10 minutes
    });

    await otpVerification.save();

    // Email options
    const mailOptions = {
      from: process.env.AUTH_EMAIL,
      to: email,
      subject: type === "signup" ? "Account Verification OTP" : "Login OTP",
      html: `
        <p>Your OTP for ${type === "signup" ? "account verification" : "login"} is <b>${otp}</b>.</p>
        <p>This OTP <b>expires in 10 minutes</b>.</p>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({
      status: "PENDING",
      message: "OTP sent!",
      userId: _id,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "FAILED", message: "Error sending OTP!" });
  }
};

// Signup Route (Register with optional image and address)
router.post("/signup", upload.single('image'), async (req, res) => {
  try {
    let { name, email, password, dateOfBirth, address } = req.body;
    if (!name || !email || !password || !dateOfBirth) {
      return res.status(400).json({ status: "FAILED", message: "Name, email, password, and date of birth are required!" });
    }

    name = name.trim();
    email = email.trim();
    password = password.trim();
    dateOfBirth = dateOfBirth.trim();
    address = address ? address.trim() : undefined;

    if (!/^[a-zA-Z ]*$/.test(name)) return res.status(400).json({ status: "FAILED", message: "Invalid name format!" });
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
      return res.status(400).json({ status: "FAILED", message: "Invalid email format!" });
    }
    if (isNaN(new Date(dateOfBirth).getTime())) return res.status(400).json({ status: "FAILED", message: "Invalid date of birth!" });
    if (password.length < 8) return res.status(400).json({ status: "FAILED", message: "Password must be at least 8 characters!" });
    if (address && address.length > 500) return res.status(400).json({ status: "FAILED", message: "Address must not exceed 500 characters!" });

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ status: "FAILED", message: "Email already registered!" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const userData = {
      name,
      email,
      password: hashedPassword,
      dateOfBirth,
      verified: false,
      address // Include address if provided
    };

    // If an image was uploaded, add the Cloudinary URL
    if (req.file) {
      userData.image = req.file.path;
    }

    const newUser = new User(userData);
    const savedUser = await newUser.save();

    sendOTPVerificationEmail(savedUser, res, "signup");
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "FAILED", message: "Internal server error!" });
  }
});

// Update User Profile (with optional image and address)
router.patch("/profile", verifyToken, upload.single('image'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, email, dateOfBirth, address } = req.body;

    const updateData = {};

    // Validate and add fields to update
    if (name) {
      updateData.name = name.trim();
      if (!/^[a-zA-Z ]*$/.test(updateData.name)) {
        return res.status(400).json({ status: "FAILED", message: "Invalid name format!" });
      }
    }

    if (email) {
      updateData.email = email.trim();
      if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(updateData.email)) {
        return res.status(400).json({ status: "FAILED", message: "Invalid email format!" });
      }
      const existingUser = await User.findOne({ email: updateData.email, _id: { $ne: userId } });
      if (existingUser) {
        return res.status(400).json({ status: "FAILED", message: "Email already registered!" });
      }
    }

    if (dateOfBirth) {
      updateData.dateOfBirth = dateOfBirth.trim();
      if (isNaN(new Date(updateData.dateOfBirth).getTime())) {
        return res.status(400).json({ status: "FAILED", message: "Invalid date of birth!" });
      }
    }

    if (address !== undefined) {
      updateData.address = address ? address.trim() : "";
      if (updateData.address && updateData.address.length > 500) {
        return res.status(400).json({ status: "FAILED", message: "Address must not exceed 500 characters!" });
      }
    }

    // If a new image is uploaded, update the image URL
    if (req.file) {
      updateData.image = req.file.path;

      // Optionally, delete the old image from Cloudinary if it exists
      const user = await User.findById(userId);
      if (user.image) {
        const publicId = user.image.split('/').pop().split('.')[0];
        await cloudinary.uploader.destroy(`users/${publicId}`);
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ status: "FAILED", message: "User not found!" });
    }

    res.status(200).json({
      status: "SUCCESS",
      message: "Profile updated successfully!",
      data: updatedUser
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "FAILED", message: "Internal server error!" });
  }
});

// Verify OTP Route
router.post("/verifyOTP", async (req, res) => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return res.status(400).json({ status: "FAILED", message: "All fields are required!" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(400).json({ status: "FAILED", message: "User not found!" });

    const otpVerification = await UserOTPVerification.findOne({ userId });
    if (!otpVerification) return res.status(400).json({ status: "FAILED", message: "Invalid OTP request!" });
    if (Date.now() > otpVerification.expiredAt) return res.status(400).json({ status: "FAILED", message: "OTP expired!" });

    if (otp !== otpVerification.otp) return res.status(400).json({ status: "FAILED", message: "Invalid OTP!" });

    // Mark user as verified
    await User.updateOne({ _id: userId }, { verified: true });
    await UserOTPVerification.deleteOne({ userId });

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({
      status: "SUCCESS",
      message: "OTP verified successfully!",
      token,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "FAILED", message: "Internal server error!" });
  }
});

// Resend OTP Route
router.post("/resendOTPVerification", async (req, res) => {
  try {
    let { userId, email } = req.body;

    if (!userId || !email) {
      return res.status(400).json({ status: "FAILED", message: "User ID and email are required!" });
    }

    await UserOTPVerification.deleteMany({ userId });
    sendOTPVerificationEmail({ _id: userId, email }, res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "FAILED", message: error.message });
  }
});

// Signin Route (Login with OTP)
router.post("/signin", async (req, res) => {
  try {
    let { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ status: "FAILED", message: "All fields are required!" });
    }

    email = email.trim();
    password = password.trim();

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ status: "FAILED", message: "User not found!" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ status: "FAILED", message: "Invalid credentials!" });

    sendOTPVerificationEmail(user, res, "login");
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

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ status: "FAILED", message: "User not found!" });
    if (!user.verified) return res.status(400).json({ status: "FAILED", message: "User not verified!" });

    // Send OTP for password reset
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Clear existing reset records
    await PasswordReset.deleteMany({ userId: user._id });

    // Save new OTP record
    const reset = new PasswordReset({
      userId: user._id,
      resetString: otp,
      createdAt: Date.now(),
      expiredAt: Date.now() + 3600000, // 60 minutes
    });

    await reset.save();

    // Send OTP email
    const mailOptions = {
      from: process.env.AUTH_EMAIL,
      to: email,
      subject: "Password Reset OTP",
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
      userId: user._id,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "FAILED", message: "Error sending password reset OTP!" });
  }
});

// Reset Password (with OTP)
router.post("/resetPassword", async (req, res) => {
  try {
    const { userId, otp, newPassword } = req.body;

    if (!userId || !otp || !newPassword) {
      return res.status(400).json({ status: "FAILED", message: "All fields are required!" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(400).json({ status: "FAILED", message: "User not found!" });

    const reset = await PasswordReset.findOne({ userId });
    if (!reset) return res.status(400).json({ status: "FAILED", message: "Invalid reset request!" });
    if (Date.now() > reset.expiredAt) return res.status(400).json({ status: "FAILED", message: "OTP expired!" });

    if (otp !== reset.resetString) return res.status(400).json({ status: "FAILED", message: "Invalid OTP!" });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.updateOne({ _id: userId }, { password: hashedPassword });
    await PasswordReset.deleteOne({ userId });

    res.status(200).json({ status: "SUCCESS", message: "Password reset successful!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "FAILED", message: "Internal server error!" });
  }
});

module.exports = router;