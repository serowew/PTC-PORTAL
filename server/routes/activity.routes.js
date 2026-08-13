import express from "express";
import db from "../db.js";

const router = express.Router();

// ==========================================
// GET ALL ACTIVITY LOGS
// GET /api/activity-logs
// ==========================================
router.get("/", async (req, res) => {
  console.log("GET /api/activity-logs called");

  try {
    const [rows] = await db.execute(`
      SELECT
        a.activity_id,
        a.user_id,
        u.username,
        r.role_name AS role,
        a.activity_type,
        a.module_name,
        a.description,
        a.created_at
      FROM activity_logs a
      INNER JOIN users u
        ON a.user_id = u.user_id
      INNER JOIN roles r
        ON u.role_id = r.role_id
      ORDER BY a.created_at DESC
      LIMIT 50
    `);

    console.log(rows);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ==========================================
// GET SINGLE USER ACTIVITY
// GET /api/activity-logs/user/:id
// ==========================================
router.get("/user/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.execute(
      `
      SELECT
        a.activity_id,
        a.user_id,
        u.username,
        r.role_name AS role,
        a.activity_type,
        a.module_name,
        a.description,
        a.created_at
      FROM activity_logs a
      INNER JOIN users u
        ON a.user_id = u.user_id
      INNER JOIN roles r
        ON u.role_id = r.role_id
      WHERE a.user_id = ?
      ORDER BY a.created_at DESC
      `,
      [id],
    );

    res.json(rows);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to load user activity.",
    });
  }
});

// ==========================================
// DELETE ALL LOGS (Optional)
// ==========================================
router.delete("/", async (req, res) => {
  try {
    await db.execute("DELETE FROM activity_logs");

    res.json({
      message: "Activity logs cleared successfully.",
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Failed to clear activity logs.",
    });
  }
});

export default router;
