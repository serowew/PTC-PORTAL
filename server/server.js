import "dotenv/config";
import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import { createClient } from "redis";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import crypto from "crypto";

const app = express();

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// ── MySQL ─────────────────────────────────────────────────────
const db = await mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME,
});
console.log("MySQL connected");

// ── Redis (temporarily disabled while developing User Management) ──
let redis = null;
console.log("Redis temporarily disabled");

// ── Nodemailer ────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: "smtp.ethereal.email",
  port: 587,
  auth: {
    user: "maxie.dach47@ethereal.email",
    pass: "a2xx45B7kzG2rspQzJ",
  },
});

// ── POST /auth/login ──────────────────────────────────────────
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required." });
  }

  try {
    const [rows] = await db.execute("SELECT * FROM users WHERE email = ?", [
      email,
    ]);

    if (!rows.length) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    await redis.setEx(`otp:${email}`, 300, otp);

    const info = await transporter.sendMail({
      from: '"PTC Portal" <noreply@ptc.edu.ph>',
      to: email,
      subject: "Your PTC Portal OTP Code",
      text: `Your OTP code is: ${otp}\n\nIt expires in 5 minutes.`,
      html: `
        <div style="font-family:sans-serif;max-width:400px">
          <h2 style="color:#1a1a2e">PTC Portal OTP</h2>
          <p>Your one-time password is:</p>
          <h1 style="letter-spacing:8px;color:#4f46e5">${otp}</h1>
          <p style="color:#666">Expires in <strong>5 minutes</strong>.</p>
        </div>
      `,
    });

    console.log("OTP email preview:", nodemailer.getTestMessageUrl(info));
    res.json({ message: "OTP sent successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error." });
  }
});

// ── POST /auth/verify-otp ─────────────────────────────────────
app.post("/auth/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ error: "Email and OTP required." });
  }

  try {
    const stored = await redis.get(`otp:${email}`);

    if (!stored) {
      return res
        .status(401)
        .json({ error: "OTP expired. Please login again." });
    }

    if (stored !== otp) {
      return res.status(401).json({ error: "Incorrect OTP." });
    }

    await redis.del(`otp:${email}`);

    const [rows] = await db.execute(
      "SELECT email, role FROM users WHERE email = ?",
      [email],
    );

    res.json({ email: rows[0].email, role: rows[0].role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error." });
  }
});



// ── GET ALL USERS ─────────────────────────────────────────────
app.get("/users", async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT id, full_name, email, role FROM users ORDER BY id DESC"
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch users." });
  }
});

// ── ADD USER ──────────────────────────────────────────────────
app.post("/users", async (req, res) => {
  const { full_name, email, role } = req.body;

  try {
    await db.execute(
      "INSERT INTO users (full_name, email, role) VALUES (?, ?, ?)",
      [full_name, email, role]
    );

    res.json({ message: "User added successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add user." });
  }
});

// ── UPDATE USER ───────────────────────────────────────────────
app.put("/users/:id", async (req, res) => {
  const { id } = req.params;
  const { full_name, email, role } = req.body;

  try {
    await db.execute(
      "UPDATE users SET full_name=?, email=?, role=? WHERE id=?",
      [full_name, email, role, id]
    );

    res.json({ message: "User updated." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update user." });
  }
});

// ── DELETE USER ───────────────────────────────────────────────
app.delete("/users/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await db.execute("DELETE FROM users WHERE id=?", [id]);

    res.json({ message: "User deleted." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete user." });
  }
});
app.get("/test", (req, res) => {
  res.send("Backend is updated!");
});

// ── START SERVER ──────────────────────────────────────────────
app.listen(3000, () => {
  console.log("Backend running on http://localhost:3000");
});