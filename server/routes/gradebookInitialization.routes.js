import express from "express";
import db from "../db.js";
import { initializeGradebookOffering } from "../services/gradebookInitialization.service.js";

const router = express.Router();

function positiveId(value) {
  const raw = String(value ?? "");

  if (!/^[1-9]\d*$/.test(raw)) {
    return null;
  }

  const id = Number(raw);

  return Number.isSafeInteger(id) ? id : null;
}

function sendError(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 600
      ? error.status
      : 500;

  if (status === 500) {
    console.error("GRADEBOOK INIT ERROR:", error);
  }

  return res.status(status).json({
    success: false,
    code:
      status === 500
        ? "GRADEBOOK_INTERNAL_ERROR"
        : (error.code ?? "GRADEBOOK_REQUEST_FAILED"),
    message:
      status === 500
        ? "Gradebook initialization could not be completed."
        : error.message,

    ...(error?.code === "HISTORICAL_GRADES_EXIST"
      ? {
          existing_grade_count: error.existing_grade_count,
        }
      : {}),
  });
}

// Find uninitialized offerings assigned to the current instructor.
router.get("/candidates", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `
        SELECT
          so.offering_id,
          s.subject_code,
          s.subject_name,
          s.laboratory_hours,
          so.status AS offering_status,

          (
            SELECT COUNT(*)
            FROM enrollment_subjects es
            WHERE es.offering_id = so.offering_id
          ) AS assigned_subjects

        FROM subject_offerings so

        JOIN faculty f
          ON f.faculty_id = so.faculty_id

        JOIN subjects s
          ON s.subject_id = so.subject_id

        WHERE f.user_id = ?
          AND so.status = 'Open'

          AND NOT EXISTS (
            SELECT 1
            FROM gradebook_offering_config c
            WHERE c.offering_id = so.offering_id
          )

          AND NOT EXISTS (
            SELECT 1
            FROM enrollment_subjects es
            JOIN grades g
              ON g.enrollment_subject_id =
                 es.enrollment_subject_id
            WHERE es.offering_id = so.offering_id
          )

        ORDER BY so.offering_id DESC
        LIMIT 20
      `,
      [req.user.user_id],
    );

    return res.json({
      success: true,
      total: rows.length,
      candidates: rows,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

// Read-only preflight. This does not authorize database writes.
async function preflight(offeringId, actorId) {
  const [rows] = await db.execute(
    `
      SELECT
        so.offering_id,
        so.status AS offering_status,
        s.subject_code,
        s.subject_name,
        s.laboratory_hours,
        f.user_id AS assigned_user_id,

        (
          SELECT COUNT(*)
          FROM gradebook_offering_config c
          WHERE c.offering_id = so.offering_id
        ) AS configuration_count,

        (
          SELECT COUNT(*)
          FROM enrollment_subjects es
          WHERE es.offering_id = so.offering_id
        ) AS enrollment_subject_count,

        (
          SELECT COUNT(*)
          FROM enrollment_subjects es
          JOIN grades g
            ON g.enrollment_subject_id =
               es.enrollment_subject_id
          WHERE es.offering_id = so.offering_id
        ) AS existing_grade_count

      FROM subject_offerings so

      JOIN subjects s
        ON s.subject_id = so.subject_id

      LEFT JOIN faculty f
        ON f.faculty_id = so.faculty_id

      WHERE so.offering_id = ?
    `,
    [offeringId],
  );

  if (rows.length !== 1) {
    const error = new Error("Offering not found.");
    error.status = 404;
    error.code = "OFFERING_NOT_FOUND";
    throw error;
  }

  const row = rows[0];

  if (Number(row.assigned_user_id) !== actorId) {
    const error = new Error(
      "Only the assigned instructor may access this gradebook.",
    );

    error.status = 403;
    error.code = "GRADEBOOK_INSTRUCTOR_REQUIRED";
    throw error;
  }

  const blockers = [];

  if (row.offering_status !== "Open") {
    blockers.push("OFFERING_NOT_OPEN");
  }

  if (Number(row.existing_grade_count) !== 0) {
    blockers.push("HISTORICAL_GRADES_EXIST");
  }

  if (Number(row.configuration_count) !== 0) {
    blockers.push("GRADEBOOK_ALREADY_INITIALIZED");
  }

  return {
    offering_id: Number(row.offering_id),
    subject_code: row.subject_code,
    subject_name: row.subject_name,
    laboratory_hours: Number(row.laboratory_hours),
    offering_status: row.offering_status,

    configuration_count: Number(row.configuration_count),

    existing_grade_count: Number(row.existing_grade_count),

    enrollment_subject_count: Number(row.enrollment_subject_count),

    can_initialize: blockers.length === 0,
    blockers,
  };
}

// GET /api/gradebook/preflight/:offeringId
router.get("/preflight/:offeringId", async (req, res) => {
  const id = positiveId(req.params.offeringId);

  if (!id) {
    return res.status(400).json({
      success: false,
      code: "INVALID_OFFERING_ID",
    });
  }

  try {
    return res.json({
      success: true,
      ...(await preflight(id, req.user.user_id)),
    });
  } catch (error) {
    return sendError(res, error);
  }
});

// POST /api/gradebook/dry-run/:offeringId
// Test-only endpoint. Always rolls back newly created records.
router.post("/dry-run/:offeringId", async (req, res) => {
  const id = positiveId(req.params.offeringId);

  if (!id) {
    return res.status(400).json({
      success: false,
      code: "INVALID_OFFERING_ID",
    });
  }

  if (req.body?.dry_run !== true) {
    return res.status(400).json({
      success: false,
      code: "DRY_RUN_REQUIRED",
      message: 'This test endpoint only accepts {"dry_run":true}.',
    });
  }

  try {
    const result = await initializeGradebookOffering(db, id, req.user.user_id, {
      dryRun: true,
    });

    if (!result.created) {
      return res.status(409).json({
        success: false,
        code: "GRADEBOOK_ALREADY_INITIALIZED",
        message: "This offering already has a gradebook configuration.",
      });
    }

    if (result.persisted || !result.dry_run) {
      return res.status(500).json({
        success: false,
        code: "UNEXPECTED_GRADEBOOK_INIT_STATE",
        message: "Gradebook dry-run returned an unexpected state.",
      });
    }

    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

// The temporary /commit-test route has been removed.

export default router;
