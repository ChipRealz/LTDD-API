require("dotenv").config();
const express = require("express");
const router = express.Router();
const User = require("./../models/User");
const UserVerification = require("./../models/UserVerification");
const PasswordReset = require("./../models/PasswordReset");
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcrypt");
const path = require("path");
const UserOTPVerification = require("./../models/UserOTPVerification");
const jwt = require("jsonwebtoken");

// Ensure environment variables are set
if (!process.env.AUTH_EMAIL || !process.env.AUTH_PASS) {
  console.error("Missing email authentication credentials in environment variables.");
  process.exit(1);
}

// Configure Nodemailer
const transporter = nodemailer.createTransport({
  host: "smtp.ethereal.email",
  port: 587,
  auth: {
    user: process.env.AUTH_EMAIL,
    pass: process.env.AUTH_PASS,
  },
});

transporter.verify((error) => {
  if (error) console.error("Mail server error:", error);
  else console.log("Mail server is ready to send messages.");
});

// Signup Route
router.post("/signup", async (req, res) => {
  try {
    let { name, email, password, dateOfBirth } = req.body;
    if (!name || !email || !password || !dateOfBirth) {
      return res.status(400).json({ status: "FAILED", message: "All fields are required!" });
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

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ status: "FAILED", message: "Email already registered!" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ name, email, password: hashedPassword, dateOfBirth, verified: false });

    const savedUser = await newUser.save();
    sendVerificationEmail(savedUser, res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "FAILED", message: "Internal server error!" });
  }
});

// Send Verification Email
const sendVerificationEmail = async ({ _id, email }, res) => {
  try {
    const uniqueString = uuidv4() + _id;
    const hashedUniqueString = await bcrypt.hash(uniqueString, 10);
    const verification = new UserVerification({
      userId: _id,
      uniqueString: hashedUniqueString,
      createdAt: Date.now(),
      expiredAt: Date.now() + 21600000, // 6 hours
    });

    await verification.save();
    const verificationLink = `http://localhost:5000/user/verify/${_id}/${uniqueString}`;
    const mailOptions = {
      from: process.env.AUTH_EMAIL,
      to: email,
      subject: "Email Verification",
      html: `<p>Click the link to verify your email: <a href="${verificationLink}">Verify</a></p>`,
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json({ status: "PENDING", message: "Verification email sent!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "FAILED", message: "Error sending verification email!" });
  }
};

// Verify Email Route
router.get("/verify/:userId/:uniqueString", async (req, res) => {
  try {
    const { userId, uniqueString } = req.params;
    const verification = await UserVerification.findOne({ userId });

    if (!verification) {
      return res.redirect(`/user/verified?error=true&message=Invalid verification link!`);
    }
    if (Date.now() > verification.expiredAt) {
      return res.redirect(`/user/verified?error=true&message=Verification link expired!`);
    }

    const isMatch = await bcrypt.compare(uniqueString, verification.uniqueString);
    if (!isMatch) {
      return res.redirect(`/user/verified?error=true&message=Invalid verification link!`);
    }

    await User.updateOne({ _id: userId }, { verified: true });
    await UserVerification.deleteOne({ userId });
    res.sendFile(path.join(__dirname, "./../views/verified.html"));
  } catch (error) {
    console.error(error);
    res.redirect(`/user/verified?error=true&message=Verification error!`);
  }
});

router.get("/verified", (req, res) => {
  res.sendFile(path.join(__dirname, "./../views/verified.html"));
});

// Signin Route
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
  
      // Send OTP Verification Email
      sendOTPVerificationEmail(user, res);
      
    } catch (error) {
      console.error(error);
      res.status(500).json({ status: "FAILED", message: "Internal server error!" });
    }
  });
  

// Request Password Reset
router.post("/requestPasswordReset", async (req, res) => {
  try {
    const { email, redirectUrl } = req.body;
    if (!email || !redirectUrl) {
      return res.status(400).json({ status: "FAILED", message: "All fields are required!" });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ status: "FAILED", message: "User not found!" });
    if (!user.verified) return res.status(400).json({ status: "FAILED", message: "User not verified!" });

    sendResetEmail(user, redirectUrl, res);
  } catch (error) {
    console.error(error);
    res.status(500).json({ status: "FAILED", message: "Internal server error!" });
  }
});

const sendResetEmail = async ({ _id, email }, redirectUrl, res) => {
    try {
        const resetString = uuidv4() + _id;

        // First, we clear all existing reset records
        await PasswordReset.deleteMany({ userId: _id });

        // Hash the reset string
        const hashedResetString = await bcrypt.hash(resetString, 10);

        // Save new reset record
        const reset = new PasswordReset({
            userId: _id,
            resetString: hashedResetString,
            createdAt: Date.now(),
            expiredAt: Date.now() + 3600000,
        });

        await reset.save();

        // Construct the reset link
        const resetLink = `${redirectUrl}/${_id}/${resetString}`;

        // Email options
        const mailOptions = {
            from: process.env.AUTH_EMAIL,
            to: email,
            subject: "Password Reset",
            html: `
                <p>We heard that you lost your password.</p>
                <p>Don't worry, use the link below to reset it.</p>
                <p>This link <b>expires in 60 minutes</b>.</p>
                <p>Press <a href="${resetLink}">here</a> to proceed.</p>
            `,
        };

        // Send email
        await transporter.sendMail(mailOptions);

        res.status(200).json({ status: "PENDING", message: "Password reset email sent!" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: "FAILED", message: "Error sending password reset email!" });
    }
};

router.post("/resetPassword", async (req, res) => {
    try {
        const { userId, resetString, newPassword } = req.body;

        if (!userId || !resetString || !newPassword) {
            return res.status(400).json({ status: "FAILED", message: "All fields are required!" });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(400).json({ status: "FAILED", message: "User not found!" });

        const reset = await PasswordReset.findOne({ userId });
        if (!reset) return res.status(400).json({ status: "FAILED", message: "Invalid reset request!" });
        if (Date.now() > reset.expiredAt) return res.status(400).json({ status: "FAILED", message: "Reset link expired!" });

        const isMatch = await bcrypt.compare(resetString, reset.resetString);
        if (!isMatch) return res.status(400).json({ status: "FAILED", message: "Invalid reset request!" });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await User.updateOne({ _id: userId }, { password: hashedPassword });
        await PasswordReset.deleteOne({ userId });

        res.status(200).json({ status: "SUCCESS", message: "Password reset successful!" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: "FAILED", message: "Internal server error!" });
    }
})

const sendOTPVerificationEmail = async ({ _id, email }, res) => {
    try {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // First, we clear all existing OTP records
        await UserOTPVerification.deleteMany({ userId: _id });

        // Save new OTP record
        const otpVerification = new UserOTPVerification({
            userId: _id,
            otp,
            createdAt: Date.now(),
            expiredAt: Date.now() + 600000,
        });

        await otpVerification.save();

        // Email options
        const mailOptions = {
            from: process.env.AUTH_EMAIL,
            to: email,
            subject: "OTP Verification",
            html: `
                <p>Your OTP is <b>${otp}</b>.</p>
                <p>This OTP <b>expires in 10 minutes</b>.</p>
            `,
        };

        // Send email
        await transporter.sendMail(mailOptions);

        res.status(200).json({ status: "PENDING", message: "OTP sent!" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: "FAILED", message: "Error sending OTP!" });
    }
}

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
            token, // Send the JWT token in the response
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: "FAILED", message: "Internal server error!" });
    }
});


router.post("/resendOTPVerification", async (req, res) => {
    try {
        let { userId, email } = req.body;

        if (!userId || !email) {
            throw Error("Empty user details are not allowed");
        } else {
            // Delete existing OTP records and resend OTP
            await UserOTPVerification.deleteMany({ userId });
            sendOTPVerificationEmail({ _id: userId, email }, res);
        }
    } catch (error) {
        res.json({
            status: "FAILED",
            message: error.message,
        });
    }
});

module.exports = router;
