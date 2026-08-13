import express from "express";
import db from "../db.js";

console.log("Roles route loaded");

const router = express.Router();

router.get("/", async (req, res) => {
  console.log("GET /api/roles called");

  try {
    const [rows] = await db.execute(`
      SELECT role_id, role_name
      FROM roles
      ORDER BY role_name
    `);

    res.json(rows);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to load roles.",
    });
  }
});

router.get("/test", (req, res) => {
  console.log("TEST ROUTE");
  res.json({
    success: true,
    message: "Roles router is working",
  });
});

export default router;
