
import express from "express";
import db from "../../db.js";

const router = express.Router();

function parseAcademicYear(value) {
  if (typeof value !== "string") return null;

  const normalized = value.trim().replace(/\s+/g, "");
  const match = /^(\d{4})-(\d{4})$/.exec(normalized);

  if (!match) return null;

  const start = Number(match[1]);
  const end = Number(match[2]);

  if (start < 1900 || start > 2199 || end !== start + 1) {
    return null;
  }

  return `${start}-${end}`;
}

// Get academic years
router.get("/", async (_req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT
        ay.academic_year_id,
        ay.academic_year,
        ay.is_current,
        COUNT(ep.enrollment_period_id) AS period_count,
        SUM(CASE WHEN ep.status = 'Open' THEN 1 ELSE 0 END)
          AS open_period_count,
        SUM(CASE WHEN ep.status = 'Closed' THEN 1 ELSE 0 END)
          AS closed_period_count
      FROM academic_years ay
      LEFT JOIN enrollment_periods ep
        ON ep.academic_year_id = ay.academic_year_id
        AND ep.semester_id IN (1, 2)
      GROUP BY
        ay.academic_year_id,
        ay.academic_year,
        ay.is_current
      ORDER BY
        ay.academic_year DESC,
        ay.academic_year_id DESC
    `);

    return res.status(200).json({
      success: true,
      academic_years: rows.map((row) => ({
        academic_year_id: Number(row.academic_year_id),
        academic_year: row.academic_year,
        is_current: Number(row.is_current) === 1,
        period_count: Number(row.period_count),
        open_period_count: Number(row.open_period_count),
        closed_period_count: Number(row.closed_period_count),
      })),
    });
  } catch (error) {
    console.error("LIST ACADEMIC YEARS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load academic years.",
    });
  }
});

// Create academic year
router.post("/", async (req, res) => {
  const academicYear = parseAcademicYear(
    req.body?.academic_year
  );

  if (!academicYear) {
    return res.status(400).json({
      success: false,
      message:
        "Enter a valid consecutive academic year, such as 2027-2028.",
    });
  }

  const actorId = Number(req.user?.user_id);

  if (!Number.isSafeInteger(actorId) || actorId <= 0) {
    return res.status(401).json({
      success: false,
      message: "An authenticated Registrar is required.",
    });
  }

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // New years are not current until enrollment opens.
    const [insert] = await connection.execute(
      `INSERT INTO academic_years
        (academic_year, is_current)
       VALUES (?, 0)`,
      [academicYear],
    );

    // Record the Registrar's action.
    await connection.execute(
      `INSERT INTO activity_logs
        (
          user_id,
          activity_type,
          module_name,
          description,
          ip_address
        )
       VALUES (
         ?,
         'CREATE ACADEMIC YEAR',
         'Academic Years',
         ?,
         ?
       )`,
      [
        actorId,
        `Created academic year ${academicYear}.`,
        req.ip || null,
      ],
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message:
        `Academic year ${academicYear} created. ` +
        "Open its enrollment period when ready.",
      academic_year: {
        academic_year_id: Number(insert.insertId),
        academic_year: academicYear,
        is_current: false,
        period_count: 0,
        open_period_count: 0,
        closed_period_count: 0,
      },
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message:
          `Academic year ${academicYear} already exists.`,
      });
    }

    console.error("CREATE ACADEMIC YEAR ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create academic year.",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

export default router;
