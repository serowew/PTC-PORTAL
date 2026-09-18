import express from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";
import authenticate from "../middleware/authenticate.js";

import db from "../db.js";
import { logActivity } from "../utils/activityLogger.js";

const router = express.Router();

// =======================
// Nodemailer
// =======================
const transporter = nodemailer.createTransport({
  host: "smtp.ethereal.email",
  port: 587,
  secure: false,
  auth: {
    user: process.env.ETHEREAL_USER,
    pass: process.env.ETHEREAL_PASS,
  },
});

// =======================
// LOGIN
// =======================
router.post("/login", async (req, res) => {
  console.log("LOGIN REQUEST FOR:", req.body.username);

  const username =
    typeof req.body.username === "string" ? req.body.username.trim() : "";

  const password =
    typeof req.body.password === "string" ? req.body.password : "";

  if (!username || !password) {
    return res.status(400).json({
      error: "Username and password are required.",
    });
  }

  try {
    const [rows] = await db.execute(
      `
      SELECT
        u.user_id,
        u.username,
        u.email,
        u.password_hash,
        u.role_id,
        u.is_verified,
        u.is_active,
        r.role_name
      FROM users u
      INNER JOIN roles r
        ON u.role_id = r.role_id
      WHERE u.username = ?
      `,
      [username],
    );

    // Username does not exist
    if (rows.length === 0) {
      return res.status(401).json({
        error: "Invalid username or password.",
      });
    }

    const user = rows[0];

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      await logActivity(
        user.user_id,
        "FAILED LOGIN",
        "Authentication",
        `${user.username} entered an incorrect password.`,
      );

      return res.status(401).json({
        error: "Invalid username or password.",
      });
    }

    // Account inactive
    if (!user.is_active) {
      await logActivity(
        user.user_id,
        "LOGIN BLOCKED",
        "Authentication",
        `${user.username} attempted to login while inactive.`,
      );

      return res.status(403).json({
        error: "Your account has been deactivated.",
      });
    }

    // Generate OTP
    const otp = crypto.randomInt(100000, 999999).toString();

    // Remove any existing OTP for this user
    await db.execute("DELETE FROM otp_codes WHERE user_id = ?", [user.user_id]);

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await db.execute(
      `
      INSERT INTO otp_codes
      (user_id, otp_code, expires_at)
      VALUES (?, ?, ?)
      `,
      [user.user_id, otp, expiresAt],
    );

    const info = await transporter.sendMail({
      from: '"PTC Portal" <noreply@ptc.edu.ph>',
      to: user.email,
      subject: "PTC Portal OTP",
      text: `Your OTP is ${otp}.`,
      html: `...`,
    });

    console.log("Preview URL:", nodemailer.getTestMessageUrl(info));

    res.json({
      message: "OTP sent successfully.",
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});

router.post("/verify-otp", async (req, res) => {
  const username =
    typeof req.body.username === "string" ? req.body.username.trim() : "";

  const otp = typeof req.body.otp === "string" ? req.body.otp.trim() : "";

  if (!username || !otp) {
    return res.status(400).json({
      error: "Username and OTP are required.",
    });
  }

  try {
    // ==========================================
    // 1. Find user + current role
    // ==========================================

    const [users] = await db.execute(
      `
      SELECT
        u.user_id,
        u.username,
        u.email,
        u.role_id,
        u.is_verified,
        u.is_active,
        r.role_name
      FROM users u
      INNER JOIN roles r
        ON u.role_id = r.role_id
      WHERE u.username = ?
      LIMIT 1
      `,
      [username],
    );

    if (users.length === 0) {
      return res.status(404).json({
        error: "User not found.",
      });
    }

    const user = users[0];

    // ==========================================
    // 2. Make sure account is still active
    // ==========================================

    if (!user.is_active) {
      return res.status(403).json({
        error: "Your account has been deactivated.",
      });
    }

    // ==========================================
    // 3. Find OTP
    // ==========================================

    const [otpRows] = await db.execute(
      `
      SELECT
        otp_code,
        expires_at
      FROM otp_codes
      WHERE user_id = ?
      LIMIT 1
      `,
      [user.user_id],
    );

    if (otpRows.length === 0) {
      return res.status(400).json({
        error: "OTP not found.",
      });
    }

    const storedOtp = otpRows[0];

    // ==========================================
    // 4. Check expiration
    // ==========================================

    if (new Date() > new Date(storedOtp.expires_at)) {
      await db.execute(
        `
        DELETE FROM otp_codes
        WHERE user_id = ?
        `,
        [user.user_id],
      );

      return res.status(400).json({
        error: "OTP has expired.",
      });
    }

    // ==========================================
    // 5. Compare OTP
    // ==========================================

    if (String(storedOtp.otp_code) !== String(otp)) {
      return res.status(400).json({
        error: "Invalid OTP.",
      });
    }

    // ==========================================
    // 6. Verify account
    // ==========================================

    if (!user.is_verified) {
      await db.execute(
        `
        UPDATE users
        SET is_verified = 1
        WHERE user_id = ?
        `,
        [user.user_id],
      );

      user.is_verified = 1;
    }

    // ==========================================
    // 7. Delete used OTP
    // ==========================================

    await db.execute(
      `
      DELETE FROM otp_codes
      WHERE user_id = ?
      `,
      [user.user_id],
    );

    // ==========================================
    // 8. Check JWT configuration
    // ==========================================

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured.");

      return res.status(500).json({
        success: false,
        error: "Authentication configuration error.",
      });
    }

    // ==========================================
    // 9. Create JWT
    // ==========================================

    const token = jwt.sign(
      {
        user_id: Number(user.user_id),
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "8h",
      },
    );

    // ==========================================
    // 10. Log successful login
    // ==========================================

    await logActivity(
      user.user_id,
      "LOGIN",
      "Authentication",
      `${user.username} logged in successfully.`,
    );

    // ==========================================
    // 11. Return authenticated session
    // ==========================================

    return res.json({
      success: true,
      message: "Login successful.",

      token,

      user: {
        user_id: Number(user.user_id),
        username: user.username,
        email: user.email,
        role_id: Number(user.role_id),

        // Frontend canonical role field
        role: user.role_name,

        // Keep DB/API field too
        role_name: user.role_name,
      },
    });
  } catch (err) {
    console.error("VERIFY OTP ERROR:", err);

    return res.status(500).json({
      success: false,
      error: "Server error.",
    });
  }
});
// =======================
// CURRENT AUTHENTICATED USER
// =======================
router.get("/me", authenticate, async (req, res) => {
  try {
    return res.json({
      success: true,

      user: {
        user_id: Number(user.user_id),
        username: user.username,
        email: user.email,
        role_id: Number(user.role_id),

        // Frontend canonical role field
        role: user.role_name,

        // Keep DB/API field too
        role_name: user.role_name,
      },
    });
  } catch (error) {
    console.error("GET /auth/me ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load authenticated user.",
    });
  }
});

// =======================
// DEVELOPMENT LOGIN
// =======================
//
// IMPORTANT:
// This route must NEVER be enabled in production.
//
router.post("/dev-login", async (req, res) => {
  // Disable this endpoint in production.
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({
      success: false,
      message: "Endpoint not found.",
    });
  }

  const { username } = req.body;

  if (!username) {
    return res.status(400).json({
      success: false,
      message: "Username is required.",
    });
  }

  try {
    // ------------------------------------------
    // Load REAL user + REAL role from database
    // ------------------------------------------

    const [rows] = await db.execute(
      `
      SELECT
        u.user_id,
        u.username,
        u.email,
        u.role_id,
        u.is_active,
        u.is_verified,
        r.role_name
      FROM users u
      INNER JOIN roles r
        ON r.role_id = u.role_id
      WHERE u.username = ?
      LIMIT 1
      `,
      [username],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Development user not found.",
      });
    }

    const user = rows[0];

    // ------------------------------------------
    // Account validation
    // ------------------------------------------

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "Development account is inactive.",
      });
    }

    if (!user.is_verified) {
      return res.status(403).json({
        success: false,
        message: "Development account is not verified.",
      });
    }

    // ------------------------------------------
    // JWT configuration
    // ------------------------------------------

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured.");

      return res.status(500).json({
        success: false,
        message: "Authentication configuration error.",
      });
    }

    // ------------------------------------------
    // Create REAL JWT
    // ------------------------------------------

    const token = jwt.sign(
      {
        user_id: Number(user.user_id),
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "8h",
      },
    );

    // ------------------------------------------
    // Optional activity log
    // ------------------------------------------

    await logActivity(
      user.user_id,
      "DEV LOGIN",
      "Authentication",
      `${user.username} logged in using development access.`,
    );

    // ------------------------------------------
    // Return exactly the same structure as OTP
    // ------------------------------------------

    return res.json({
      success: true,
      message: "Development login successful.",

      token,

      user: {
        user_id: Number(user.user_id),
        username: user.username,
        email: user.email,
        role_id: Number(user.role_id),

        role: user.role_name,
        role_name: user.role_name,
      },
    });
  } catch (error) {
    console.error("DEV LOGIN ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Development login failed.",
    });
  }
});

export default router;
