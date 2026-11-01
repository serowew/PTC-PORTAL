import express from "express";
import db from "../db.js";
import {
  InputError,
  MANILA_NOW_SQL,
  parseManilaDateTime,
  respondError,
  textField,
} from "../utils/admissionPhase1.js";

const router = express.Router();

// Validate admission period information
function getPeriodInput(body) {
  const title = textField(body.title, 120, { required: true });
  const academicYearId = Number(body.academicYearId);

  if (!Number.isInteger(academicYearId) || academicYearId <= 0) {
    throw new InputError("Select a valid academic year.");
  }

  const start = parseManilaDateTime(body.startsAt);
  const end = parseManilaDateTime(body.endsAt);

  if (!start || !end || end.instant <= start.instant) {
    throw new InputError(
      "Provide valid Manila dates, with the deadline after the start.",
    );
  }

  if (end.instant - start.instant > 366 * 24 * 60 * 60 * 1000) {
    throw new InputError("One admission window cannot exceed 366 days.");
  }

  return { title, academicYearId, start, end };
}

// Get admission periods
router.get("/", async (_req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT
        p.admission_period_id AS admissionPeriodId,
        p.academic_year_id AS academicYearId,
        ay.academic_year AS academicYear,
        p.title,
        DATE_FORMAT(p.starts_at, '%Y-%m-%dT%H:%i') AS startsAt,
        DATE_FORMAT(p.ends_at, '%Y-%m-%dT%H:%i') AS endsAt,
        p.status,
        p.created_by AS createdBy,
        p.published_by AS publishedBy,
        CASE
          WHEN p.status = 'Published'
            AND p.starts_at <= ${MANILA_NOW_SQL}
            AND p.ends_at >= ${MANILA_NOW_SQL}
          THEN 1
          ELSE 0
        END AS isOpen
      FROM admission_periods p
      JOIN academic_years ay
        ON ay.academic_year_id = p.academic_year_id
      ORDER BY p.admission_period_id DESC
      LIMIT 100
    `);

    return res.json({
      success: true,
      periods: rows,
    });
  } catch (error) {
    return respondError(res, error, "GET ADMISSION PERIODS ERROR:");
  }
});

// Create admission period as Draft
router.post("/", async (req, res) => {
  try {
    const input = getPeriodInput(req.body || {});

    const [year] = await db.execute(
      `SELECT academic_year_id
       FROM academic_years
       WHERE academic_year_id = ?
       LIMIT 1`,
      [input.academicYearId],
    );

    if (!year.length) {
      throw new InputError("Academic year does not exist.");
    }

    const [result] = await db.execute(
      `INSERT INTO admission_periods
        (academic_year_id, title, starts_at, ends_at, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [
        input.academicYearId,
        input.title,
        input.start.mysql,
        input.end.mysql,
        req.user.user_id,
      ],
    );

    return res.status(201).json({
      success: true,
      admissionPeriodId: result.insertId,
      status: "Draft",
      message: "Admission period created. Publish it when ready.",
    });
  } catch (error) {
    return respondError(res, error, "CREATE ADMISSION PERIOD ERROR:");
  }
});

// Update an unpublished admission period
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      throw new InputError("Invalid admission period ID.");
    }

    const input = getPeriodInput(req.body || {});

    const [year] = await db.execute(
      `SELECT academic_year_id
       FROM academic_years
       WHERE academic_year_id = ?
       LIMIT 1`,
      [input.academicYearId],
    );

    if (!year.length) {
      throw new InputError("Academic year does not exist.");
    }

    const [result] = await db.execute(
      `UPDATE admission_periods
       SET
         academic_year_id = ?,
         title = ?,
         starts_at = ?,
         ends_at = ?
       WHERE admission_period_id = ?
         AND status = 'Draft'`,
      [
        input.academicYearId,
        input.title,
        input.start.mysql,
        input.end.mysql,
        id,
      ],
    );

    if (!result.affectedRows) {
      return res.status(409).json({
        success: false,
        message: "Period not found or no longer editable.",
      });
    }

    return res.json({
      success: true,
      message: "Draft period updated.",
    });
  } catch (error) {
    return respondError(res, error, "UPDATE ADMISSION PERIOD ERROR:");
  }
});

// Publish an admission period
router.post("/:id/publish", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({
      success: false,
      message: "Invalid admission period ID.",
    });
  }

  let conn;
  let locked = false;

  try {
    conn = await db.getConnection();

    const [locks] = await conn.execute(
      "SELECT GET_LOCK('ptc_admission_publish', 5) AS obtained",
    );

    locked = locks[0]?.obtained === 1;

    if (!locked) {
      return res.status(503).json({
        success: false,
        message: "Please retry publishing.",
      });
    }

    const [periods] = await conn.execute(
      `SELECT
         admission_period_id,
         DATE_FORMAT(starts_at, '%Y-%m-%d %H:%i:%s') AS starts_at,
         DATE_FORMAT(ends_at, '%Y-%m-%d %H:%i:%s') AS ends_at,
         status
       FROM admission_periods
       WHERE admission_period_id = ?
       LIMIT 1`,
      [id],
    );

    if (!periods.length) {
      return res.status(404).json({
        success: false,
        message: "Period not found.",
      });
    }

    const period = periods[0];

    if (period.status !== "Draft") {
      return res.status(409).json({
        success: false,
        message: "Only a Draft period can be published.",
      });
    }

    // Prevent overlapping published periods
    const [overlapping] = await conn.execute(
      `SELECT admission_period_id
       FROM admission_periods
       WHERE status = 'Published'
         AND admission_period_id <> ?
         AND starts_at <= ?
         AND ends_at >= ?
       LIMIT 1`,
      [id, period.ends_at, period.starts_at],
    );

    if (overlapping.length) {
      return res.status(409).json({
        success: false,
        message: "Another published admission period overlaps these dates.",
      });
    }

    await conn.execute(
      `UPDATE admission_periods
       SET
         status = 'Published',
         published_by = ?,
         published_at = ${MANILA_NOW_SQL}
       WHERE admission_period_id = ?
         AND status = 'Draft'`,
      [req.user.user_id, id],
    );

    return res.json({
      success: true,
      message:
        "Admission period published. Opening and closing follow its scheduled dates.",
    });
  } catch (error) {
    return respondError(res, error, "PUBLISH ADMISSION PERIOD ERROR:");
  } finally {
    if (conn) {
      if (locked) {
        try {
          await conn.execute("SELECT RELEASE_LOCK('ptc_admission_publish')");
        } catch (releaseError) {
          console.error("RELEASE ADMISSION LOCK ERROR:", releaseError);
          conn.destroy();
          conn = null;
        }
      }

      if (conn) {
        conn.release();
      }
    }
  }
});

export default router;
