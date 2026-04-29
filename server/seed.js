import "dotenv/config";
import mysql from "mysql2/promise";
import bcrypt from "bcrypt";

const db = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

await db.execute(`
  CREATE TABLE IF NOT EXISTS users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role          ENUM('admin','student','faculty') NOT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);
await db.execute("DELETE FROM users");
console.log("Cleared existing users.");

const users = [
  { email: "admin@ptc.edu.ph", password: "12345", role: "admin" },
  { email: "student@ptc.edu.ph", password: "12345", role: "student" },
  { email: "faculty@ptc.edu.ph", password: "12345", role: "faculty" },
];

for (const u of users) {
  const hash = await bcrypt.hash(u.password, 10);
  await db.execute(
    "INSERT IGNORE INTO users (email, password_hash, role) VALUES (?, ?, ?)",
    [u.email, hash, u.role],
  );
  console.log(`Seeded: ${u.email}`);
}

console.log("Done.");
await db.end();
