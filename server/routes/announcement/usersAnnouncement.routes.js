import express from "express";
import db from "../../db.js";

const router = express.Router();

// ======================================================
// GET ALL ANNOUNCEMENTS BY USER ROLE
// GET /api/announcements?role_id=5
// ======================================================

router.get("/", async (req, res) => {
  try {
    const roleId = Number(req.query.role_id);

    console.log("===== USER ANNOUNCEMENTS =====");
    console.log("ROLE ID:", roleId);

    if (!roleId || Number.isNaN(roleId)) {
      return res.status(400).json({
        error: "Valid role_id is required.",
      });
    }

    const [rows] = await db.execute(
      `
SELECT DISTINCT

    a.announcement_id,
    a.title,
    a.content,

    u.username AS created_by,

    a.publish_date,
    a.expiry_date,
    a.is_active,
    a.created_at,

    GROUP_CONCAT(
        DISTINCT f.original_name
        ORDER BY f.original_name
        SEPARATOR ', '
    ) AS attachments

FROM announcements a

INNER JOIN announcement_recipients ar
ON ar.announcement_id = a.announcement_id

LEFT JOIN users u
ON u.user_id = a.created_by

LEFT JOIN announcement_attachments aa
ON aa.announcement_id = a.announcement_id

LEFT JOIN files f
ON f.file_id = aa.file_id

WHERE

ar.role_id = ?

AND a.is_active = 1

AND a.publish_date <= NOW()

AND (
    a.expiry_date IS NULL
    OR a.expiry_date >= NOW()
)

GROUP BY

a.announcement_id,
a.title,
a.content,
u.username,
a.publish_date,
a.expiry_date,
a.is_active,
a.created_at

ORDER BY

a.publish_date DESC,
a.created_at DESC
`,
      [roleId],
    );

    res.json(rows);
  } catch (error) {
    console.error("GET USER ANNOUNCEMENTS ERROR:", error);

    res.status(500).json({
      error: "Failed to load announcements.",
    });
  }
});

// ======================================================
// GET SINGLE ANNOUNCEMENT
// GET /api/announcements/:id?role_id=5
// ======================================================

router.get("/:id", async (req, res) => {
  try {
    const announcementId = Number(req.params.id);
    const roleId = Number(req.query.role_id);

    console.log("===== USER ANNOUNCEMENT DETAILS =====");
    console.log("Announcement ID:", announcementId);
    console.log("Role ID:", roleId);

    if (!announcementId || Number.isNaN(announcementId)) {
      return res.status(400).json({
        error: "Invalid announcement id.",
      });
    }

    if (!roleId || Number.isNaN(roleId)) {
      return res.status(400).json({
        error: "Valid role_id is required.",
      });
    }

    const [rows] = await db.execute(
      `
SELECT

    a.announcement_id,
    a.title,
    a.content,

    u.username AS created_by,

    a.publish_date,
    a.expiry_date,
    a.is_active,
    a.created_at

FROM announcements a

INNER JOIN announcement_recipients ar
ON ar.announcement_id = a.announcement_id

LEFT JOIN users u
ON u.user_id = a.created_by

WHERE

a.announcement_id = ?

AND ar.role_id = ?

AND a.is_active = 1

AND a.publish_date <= NOW()

AND (
    a.expiry_date IS NULL
    OR a.expiry_date >= NOW()
)
`,
      [announcementId, roleId],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: "Announcement not found.",
      });
    }

    const [attachmentRows] = await db.execute(
      `
SELECT

    f.file_id,
    f.original_name,
    f.file_path,
    f.file_size,
    f.mime_type

FROM announcement_attachments aa

INNER JOIN files f
ON f.file_id = aa.file_id

WHERE aa.announcement_id = ?

ORDER BY f.original_name
`,
      [announcementId],
    );

    return res.json({
      ...rows[0],
      attachments: attachmentRows,
    });
  } catch (error) {
    console.error("GET USER ANNOUNCEMENT DETAILS ERROR:", error);

    res.status(500).json({
      error: "Failed to load announcement.",
    });
  }
});

export default router;
