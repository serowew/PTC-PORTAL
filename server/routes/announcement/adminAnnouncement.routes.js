import express from "express";
import db from "../../db.js";
import { logActivity } from "../../utils/activityLogger.js";

const router = express.Router();

// ======================================================
// PERMISSION CHECK
// ADMIN = 1
// REGISTRAR = 5
// ======================================================

function hasAnnouncementPermission(role_id) {
  return Number(role_id) === 1 || Number(role_id) === 2;
}

// ======================================================
// GET ALL ANNOUNCEMENTS
// GET /api/announcements/manage
// ======================================================

router.get("/", async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT

        a.announcement_id,
        a.title,
        a.content,

        u.username AS created_by,

        a.publish_date,
        a.expiry_date,
        a.is_active,
        a.created_at,


        GROUP_CONCAT(
          DISTINCT r.role_name
          ORDER BY r.role_name
          SEPARATOR ', '
        ) AS recipients,


        GROUP_CONCAT(
          DISTINCT f.original_name
          ORDER BY f.original_name
          SEPARATOR ', '
        ) AS attachments


      FROM announcements a


      LEFT JOIN users u
      ON u.user_id = a.created_by


      LEFT JOIN announcement_recipients ar
      ON ar.announcement_id = a.announcement_id


      LEFT JOIN roles r
      ON r.role_id = ar.role_id


      LEFT JOIN announcement_attachments aa
      ON aa.announcement_id = a.announcement_id


      LEFT JOIN files f
      ON f.file_id = aa.file_id


      GROUP BY

        a.announcement_id,
        a.title,
        a.content,
        u.username,
        a.publish_date,
        a.expiry_date,
        a.is_active,
        a.created_at


      ORDER BY a.created_at DESC

    `);

    res.json(rows);
  } catch (error) {
    console.error("GET MANAGE ANNOUNCEMENTS ERROR:", error);

    res.status(500).json({
      error: "Failed to load announcements.",
    });
  }
});

// ======================================================
// GET SINGLE ANNOUNCEMENT
// GET /api/announcements/manage/:id
// ======================================================

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

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


LEFT JOIN users u

ON u.user_id=a.created_by


WHERE a.announcement_id=?

`,
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: "Announcement not found.",
      });
    }

    const [recipientRows] = await db.execute(
      `

SELECT

r.role_id,
r.role_name


FROM announcement_recipients ar


INNER JOIN roles r

ON r.role_id=ar.role_id


WHERE ar.announcement_id=?

`,
      [id],
    );

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

ON f.file_id=aa.file_id


WHERE aa.announcement_id=?

`,
      [id],
    );

    res.json({
      ...rows[0],

      recipients: recipientRows,

      attachments: attachmentRows,
    });
  } catch (error) {
    console.error("GET SINGLE MANAGE ANNOUNCEMENT ERROR:", error);

    res.status(500).json({
      error: "Failed to load announcement.",
    });
  }
});

// ======================================================
// CREATE ANNOUNCEMENT
// POST /api/announcements/manage
// ======================================================

router.post("/", async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const {
      title,

      content,

      created_by,

      role_id,

      publish_date,

      expiry_date,

      is_active,

      recipients,

      attachments,
    } = req.body;

    if (!hasAnnouncementPermission(role_id)) {
      return res.status(403).json({
        error: "No permission to create announcement.",
      });
    }

    const [result] = await connection.execute(
      `

INSERT INTO announcements

(

title,
content,
created_by,
publish_date,
expiry_date,
is_active

)

VALUES (?,?,?,?,?,?)

`,

      [title, content, created_by, publish_date, expiry_date, is_active],
    );

    const announcementId = result.insertId;

    if (Array.isArray(recipients)) {
      for (const recipient of recipients) {
        await connection.execute(
          `

INSERT INTO announcement_recipients

(

announcement_id,
role_id

)

VALUES (?,?)

`,

          [announcementId, recipient],
        );
      }
    }

    if (Array.isArray(attachments)) {
      for (const fileId of attachments) {
        await connection.execute(
          `

INSERT INTO announcement_attachments

(

announcement_id,
file_id

)

VALUES (?,?)

`,

          [announcementId, fileId],
        );
      }
    }

    await connection.commit();

    await logActivity(
      created_by,

      "Create",

      "Announcements",

      `Created announcement "${title}".`,
    );

    res.status(201).json({
      message: "Announcement created successfully.",

      announcement_id: announcementId,
    });
  } catch (error) {
    await connection.rollback();

    console.error("CREATE ANNOUNCEMENT ERROR:", error);

    res.status(500).json({
      error: error.message,
    });
  } finally {
    connection.release();
  }
});
// ======================================================
// UPDATE ANNOUNCEMENT
// PUT /api/announcements/manage/:id
// ======================================================

router.put("/:id", async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { id } = req.params;

    const {
      title,

      content,

      publish_date,

      expiry_date,

      is_active,

      recipients,

      attachments,

      updated_by,

      role_id,
    } = req.body;

    if (!hasAnnouncementPermission(role_id)) {
      return res.status(403).json({
        error: "No permission to update announcement.",
      });
    }

    await connection.execute(
      `

      UPDATE announcements

      SET

      title=?,

      content=?,

      publish_date=?,

      expiry_date=?,

      is_active=?


      WHERE announcement_id=?

      `,

      [title, content, publish_date, expiry_date, is_active, id],
    );

    // REMOVE OLD RECIPIENTS

    await connection.execute(
      `

      DELETE FROM announcement_recipients

      WHERE announcement_id=?

      `,

      [id],
    );

    // INSERT NEW RECIPIENTS

    if (Array.isArray(recipients)) {
      for (const roleId of recipients) {
        await connection.execute(
          `

          INSERT INTO announcement_recipients

          (

          announcement_id,

          role_id

          )


          VALUES (?,?)

          `,

          [id, roleId],
        );
      }
    }

    // REMOVE OLD ATTACHMENTS

    await connection.execute(
      `

      DELETE FROM announcement_attachments

      WHERE announcement_id=?

      `,

      [id],
    );

    // INSERT NEW ATTACHMENTS

    if (Array.isArray(attachments)) {
      for (const fileId of attachments) {
        await connection.execute(
          `

          INSERT INTO announcement_attachments

          (

          announcement_id,

          file_id

          )


          VALUES (?,?)

          `,

          [id, fileId],
        );
      }
    }

    await connection.commit();

    await logActivity(
      updated_by,

      "Update",

      "Announcements",

      `Updated announcement "${title}".`,
    );

    res.json({
      message: "Announcement updated successfully.",
    });
  } catch (error) {
    await connection.rollback();

    console.error(
      "UPDATE ANNOUNCEMENT ERROR:",

      error,
    );

    res.status(500).json({
      error: error.message,
    });
  } finally {
    connection.release();
  }
});

// ======================================================
// DELETE ANNOUNCEMENT
// DELETE /api/announcements/manage/:id
// ======================================================

router.delete("/:id", async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { id } = req.params;

    const {
      deleted_by,

      role_id,
    } = req.body;

    if (!hasAnnouncementPermission(role_id)) {
      return res.status(403).json({
        error: "No permission to delete announcement.",
      });
    }

    const [rows] = await connection.execute(
      `

SELECT title

FROM announcements

WHERE announcement_id=?

`,

      [id],
    );

    if (rows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        error: "Announcement not found.",
      });
    }

    const title = rows[0].title;

    await connection.execute(
      `

DELETE FROM announcement_attachments

WHERE announcement_id=?

`,

      [id],
    );

    await connection.execute(
      `

DELETE FROM announcement_recipients

WHERE announcement_id=?

`,

      [id],
    );

    await connection.execute(
      `

DELETE FROM announcements

WHERE announcement_id=?

`,

      [id],
    );

    await connection.commit();

    await logActivity(
      deleted_by,

      "Delete",

      "Announcements",

      `Deleted announcement "${title}".`,
    );

    res.json({
      message: "Announcement deleted successfully.",
    });
  } catch (error) {
    await connection.rollback();

    console.error(
      "DELETE ANNOUNCEMENT ERROR:",

      error,
    );

    res.status(500).json({
      error: error.message,
    });
  } finally {
    connection.release();
  }
});

// ======================================================
// CHANGE STATUS
// PATCH /api/announcements/manage/:id/status
// ======================================================

router.patch("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;

    const {
      is_active,

      role_id,

      updated_by,
    } = req.body;

    if (!hasAnnouncementPermission(role_id)) {
      return res.status(403).json({
        error: "No permission to change status.",
      });
    }

    await db.execute(
      `

UPDATE announcements

SET is_active=?

WHERE announcement_id=?

`,

      [is_active, id],
    );

    await logActivity(
      updated_by,

      "Update",

      "Announcements",

      `Changed announcement status.`,
    );

    res.json({
      message: "Announcement status updated.",
    });
  } catch (error) {
    console.error(
      "STATUS UPDATE ERROR:",

      error,
    );

    res.status(500).json({
      error: "Failed to update status.",
    });
  }
});

export default router;
