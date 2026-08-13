// db.js
import mysql from "mysql2/promise";

const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Optional: verify the pool can actually reach the database on startup.
try {
  const conn = await db.getConnection();
  console.log("✅ MySQL Connected");
  conn.release();
} catch (err) {
    console.error("❌ MySQL connection failed:", err);
}

export default db;
