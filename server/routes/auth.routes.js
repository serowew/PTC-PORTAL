import express from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import nodemailer from "nodemailer";
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
  console.log("LOGIN REQUEST:", req.body);
  const { username, password } = req.body;

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

// =======================
// VERIFY OTP
// =======================
router.post("/verify-otp", async (req, res) => {
  const { username, otp } = req.body;

  if (!username || !otp) {
    return res.status(400).json({
      error: "Username and OTP are required.",
    });
  }

  try {
    const [users] = await db.execute(
      `
      SELECT
        u.user_id,
        u.username,
        u.email,
        u.role_id,
        u.is_verified,
        u.is_active,
        r.role_name,
        s.student_id
      FROM users u
      INNER JOIN roles r
        ON u.role_id = r.role_id
      LEFT JOIN students s
        ON s.user_id = u.user_id
      WHERE u.username = ?
      `,
      [username],
    );

    if (users.length === 0) {
      return res.status(404).json({
        error: "User not found.",
      });
    }

    const user = users[0];

    const [otpRows] = await db.execute(
      `
      SELECT otp_code, expires_at
      FROM otp_codes
      WHERE user_id = ?
      `,
      [user.user_id],
    );

    if (otpRows.length === 0) {
      return res.status(400).json({
        error: "OTP not found.",
      });
    }

    const storedOtp = otpRows[0];

    if (new Date() > new Date(storedOtp.expires_at)) {
      await db.execute("DELETE FROM otp_codes WHERE user_id = ?", [
        user.user_id,
      ]);

      return res.status(400).json({
        error: "OTP has expired.",
      });
    }

    if (storedOtp.otp_code !== otp) {
      return res.status(400).json({
        error: "Invalid OTP.",
      });
    }

    // Verify account after successful OTP
    if (!user.is_verified) {
      await db.execute(
        `
        UPDATE users
        SET is_verified = 1
        WHERE user_id = ?
        `,
        [user.user_id],
      );
    }

    // Delete used OTP (no re-insert needed)
    await db.execute("DELETE FROM otp_codes WHERE user_id = ?", [user.user_id]);

    await logActivity(
      user.user_id,
      "LOGIN",
      "Authentication",
      `${user.username} logged in successfully.`,
    );

    res.json({
      user_id: user.user_id,
      student_id: user.student_id,
      username: user.username,
      email: user.email,
      role: user.role_name,
      role_id: user.role_id,
    });
  } catch (err) {
    console.error("VERIFY OTP ERROR:");
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
});

export default router;
