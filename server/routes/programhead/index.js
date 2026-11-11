import express from "express";
import db from "../../db.js";

import classesRouter from "./classes.js";
import gradesRouter from "./grades.js";
import profileRouter from "./profile.js";
import transferevaluationRouter from "./transferEvaluations.js";
import offeringBatchesRouter from "./offeringBatches.js";

const router = express.Router();

router.use("/profile", profileRouter);
router.use("/classes", classesRouter);
router.use("/grades", gradesRouter);
router.use("/transfer-evaluations", transferevaluationRouter);
router.use("/offering-batches", offeringBatchesRouter);

function periodError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function sendPeriodError(res, error) {
  if (error?.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      success: false,
      code: "TERM_SUBMISSION_PERIOD_ALREADY_EXISTS",
      message:
        "A submission period already exists for this department, academic year, semester, and grading term.",
    });
  }
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
  if (status === 500) console.error("PROGRAM HEAD TERM PERIOD ERROR:", error);
  return res.status(status).json({
    success: false,
    code:
      status === 500
        ? "TERM_SUBMISSION_PERIOD_INTERNAL_ERROR"
        : error.code || "TERM_SUBMISSION_PERIOD_REQUEST_FAILED",
    message:
      status === 500
        ? "Could not process the term submission period."
        : error.message,
  });
}

function periodPositiveId(value) {
  const raw = String(value ?? "").trim();
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const num = Number(raw);
  return Number.isSafeInteger(num) ? num : null;
}

function periodTerm(value) {
  return value === "MIDTERM" || value === "FINAL_TERM" ? value : null;
}

function periodReason(value, required = false) {
  if (value === undefined || value === null) {
    if (required)
      periodError(
        "TERM_PERIOD_REASON_REQUIRED",
        "A documented change_reason is required.",
        400,
      );
    return null;
  }
  if (typeof value !== "string")
    periodError(
      "TERM_PERIOD_REASON_INVALID",
      "change_reason must be a string.",
      400,
    );
  const result = value.trim();
  if (required && result.length < 5) {
    periodError(
      "TERM_PERIOD_REASON_REQUIRED",
      "Provide a meaningful change_reason (at least 5 characters).",
      400,
    );
  }
  if (result.length > 1000)
    periodError(
      "TERM_PERIOD_REASON_TOO_LONG",
      "change_reason must not exceed 1000 characters.",
      400,
    );
  return result || null;
}

// DATETIME values are interpreted in the database server's session timezone.
// No automatic timezone conversion is performed on official submission deadlines.
function periodDeadline(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
  ) {
    periodError(
      "TERM_PERIOD_DEADLINE_INVALID",
      "submission_deadline_at must use YYYY-MM-DD HH:mm:ss (database local time).",
      400,
    );
  }
  const [datePart, timePart] = value.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second
  ) {
    periodError(
      "TERM_PERIOD_DEADLINE_INVALID",
      "submission_deadline_at must be a valid date and time.",
      400,
    );
  }
  return value;
}

function allowedPeriodKeys(body, keys) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    periodError("TERM_PERIOD_BODY_INVALID", "A JSON object is required.", 400);
  }
  const extras = Object.keys(body).filter((k) => !keys.includes(k));
  if (extras.length)
    periodError(
      "TERM_PERIOD_FIELDS_UNSUPPORTED",
      `Unsupported field(s): ${extras.join(", ")}.`,
      400,
    );
}

async function getActiveTermProgramHead(client, req) {
  const userId = periodPositiveId(req.user?.user_id);
  if (!userId)
    periodError(
      "TERM_PERIOD_AUTH_REQUIRED",
      "A valid Program Head login is required.",
      401,
    );
  const [rows] = await client.execute(
    `SELECT ph.program_head_id, ph.department_id
       FROM program_heads ph
       INNER JOIN faculty f ON f.faculty_id = ph.faculty_id
      WHERE f.user_id = ? AND ph.is_active = 1
        AND (ph.start_date IS NULL OR ph.start_date <= CURDATE())
        AND (ph.end_date IS NULL OR ph.end_date >= CURDATE())
      ORDER BY ph.program_head_id DESC LIMIT 1`,
    [userId],
  );
  if (!rows.length) {
    periodError(
      "ACTIVE_PROGRAM_HEAD_ASSIGNMENT_REQUIRED",
      "This account has no active Program Head department assignment.",
      403,
    );
  }
  return { userId, departmentId: Number(rows[0].department_id) };
}

async function assertPeriodScope(client, academicYearId, semesterId) {
  const [rows] = await client.execute(
    `SELECT
       (SELECT COUNT(*) FROM academic_years WHERE academic_year_id = ?) AS academic_year_exists,
       (SELECT COUNT(*) FROM semesters WHERE semester_id = ?) AS semester_exists`,
    [academicYearId, semesterId],
  );
  if (
    !Number(rows[0]?.academic_year_exists) ||
    !Number(rows[0]?.semester_exists)
  ) {
    periodError(
      "TERM_PERIOD_REFERENCE_NOT_FOUND",
      "Academic year or semester was not found.",
      404,
    );
  }
}

async function assertDeadlineFuture(client, deadline) {
  const [rows] = await client.execute(
    "SELECT (? > NOW()) AS deadline_is_future",
    [deadline],
  );
  if (Number(rows[0]?.deadline_is_future) !== 1) {
    periodError(
      "TERM_PERIOD_DEADLINE_NOT_FUTURE",
      "The submission deadline must be after the database server's current time.",
      422,
    );
  }
}

const periodSelectColumns = `
  p.period_id, p.department_id, p.academic_year_id, p.semester_id,
  p.grading_term, p.period_status, p.reopen_count, p.last_reopen_reason,
  p.created_by_user_id, p.updated_by_user_id, p.record_version,
  DATE_FORMAT(p.opened_at, '%Y-%m-%d %H:%i:%s') AS opened_at,
  DATE_FORMAT(p.submission_deadline_at, '%Y-%m-%d %H:%i:%s') AS submission_deadline_at,
  DATE_FORMAT(p.closed_at, '%Y-%m-%d %H:%i:%s') AS closed_at,
  DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS database_now,
  CASE WHEN p.submission_deadline_at IS NOT NULL AND NOW() > p.submission_deadline_at
       THEN 1 ELSE 0 END AS deadline_passed`;

function periodOutput(row) {
  return {
    period_id: row.period_id,
    department_id: row.department_id,
    academic_year_id: row.academic_year_id,
    semester_id: row.semester_id,
    grading_term: row.grading_term,
    period_status: row.period_status,
    opened_at: row.opened_at,
    submission_deadline_at: row.submission_deadline_at,
    closed_at: row.closed_at,
    reopen_count: Number(row.reopen_count),
    last_reopen_reason: row.last_reopen_reason,
    record_version: Number(row.record_version),
    deadline_passed: Boolean(Number(row.deadline_passed)),
    can_submit_within_window:
      row.period_status === "OPEN" && !Number(row.deadline_passed),
    database_now: row.database_now,
    created_by_user_id: row.created_by_user_id,
    updated_by_user_id: row.updated_by_user_id,
  };
}

async function readPeriod(client, periodId, departmentId, forUpdate = false) {
  const [rows] = await client.execute(
    `SELECT ${periodSelectColumns}
       FROM gradebook_term_submission_periods p
      WHERE p.period_id = ? AND p.department_id = ?
      ${forUpdate ? "FOR UPDATE" : ""}`,
    [periodId, departmentId],
  );
  if (!rows.length)
    periodError(
      "TERM_PERIOD_NOT_FOUND",
      "Submission period was not found in your department.",
      404,
    );
  return rows[0];
}

// GET /api/program-head/gradebook/term-submission-periods
router.get("/gradebook/term-submission-periods", async (req, res) => {
  try {
    const allowed = ["academic_year_id", "semester_id", "grading_term"];
    if (Object.keys(req.query).some((key) => !allowed.includes(key))) {
      periodError(
        "TERM_PERIOD_QUERY_INVALID",
        "Unsupported submission period query parameter.",
        400,
      );
    }
    const { departmentId } = await getActiveTermProgramHead(db, req);
    const conditions = ["p.department_id = ?"];
    const params = [departmentId];
    for (const field of ["academic_year_id", "semester_id"]) {
      if (req.query[field] !== undefined) {
        const value = periodPositiveId(req.query[field]);
        if (!value)
          periodError(
            "TERM_PERIOD_QUERY_INVALID",
            `${field} must be a positive integer.`,
            400,
          );
        conditions.push(`p.${field} = ?`);
        params.push(value);
      }
    }
    if (req.query.grading_term !== undefined) {
      const gradingTerm = periodTerm(req.query.grading_term);
      if (!gradingTerm)
        periodError(
          "TERM_PERIOD_TERM_INVALID",
          "grading_term must be MIDTERM or FINAL_TERM.",
          400,
        );
      conditions.push("p.grading_term = ?");
      params.push(gradingTerm);
    }
    const [rows] = await db.execute(
      `SELECT ${periodSelectColumns}
         FROM gradebook_term_submission_periods p
        WHERE ${conditions.join(" AND ")}
        ORDER BY p.academic_year_id DESC, p.semester_id, p.grading_term`,
      params,
    );
    return res.json({
      success: true,
      department_id: departmentId,
      count: rows.length,
      periods: rows.map(periodOutput),
    });
  } catch (error) {
    return sendPeriodError(res, error);
  }
});

// POST: create a CLOSED window; opening requires an explicit future deadline.
router.post("/gradebook/term-submission-periods", async (req, res) => {
  let connection;
  let inTransaction = false;
  try {
    allowedPeriodKeys(req.body, [
      "academic_year_id",
      "semester_id",
      "grading_term",
      "change_reason",
    ]);
    const academicYearId = periodPositiveId(req.body.academic_year_id);
    const semesterId = periodPositiveId(req.body.semester_id);
    const gradingTerm = periodTerm(req.body.grading_term);
    if (!academicYearId || !semesterId || !gradingTerm) {
      periodError(
        "TERM_PERIOD_SCOPE_INVALID",
        "Valid academic_year_id, semester_id and grading_term are required.",
        400,
      );
    }
    const reason = periodReason(req.body.change_reason);
    connection = await db.getConnection();
    await connection.beginTransaction();
    inTransaction = true;
    const { userId, departmentId } = await getActiveTermProgramHead(
      connection,
      req,
    );
    await assertPeriodScope(connection, academicYearId, semesterId);
    const [existing] = await connection.execute(
      `SELECT period_id FROM gradebook_term_submission_periods
        WHERE department_id = ? AND academic_year_id = ? AND semester_id = ? AND grading_term = ? LIMIT 1`,
      [departmentId, academicYearId, semesterId, gradingTerm],
    );
    if (existing.length) {
      periodError(
        "TERM_SUBMISSION_PERIOD_ALREADY_EXISTS",
        "A term submission period already exists for this department and academic scope.",
        409,
      );
    }
    const [insert] = await connection.execute(
      `INSERT INTO gradebook_term_submission_periods
        (department_id, academic_year_id, semester_id, grading_term,
         period_status, created_by_user_id, record_version)
       VALUES (?, ?, ?, ?, 'CLOSED', ?, 1)`,
      [departmentId, academicYearId, semesterId, gradingTerm, userId],
    );
    const periodId = insert.insertId;
    const [audit] = await connection.execute(
      `INSERT INTO gradebook_term_submission_period_events
         (period_id, event_type, previous_period_status, new_period_status,
          previous_deadline_at, new_deadline_at, change_reason, changed_by_user_id, period_version_after)
       VALUES (?, 'CREATED', NULL, 'CLOSED', NULL, NULL, ?, ?, 1)`,
      [periodId, reason, userId],
    );
    const period = await readPeriod(connection, periodId, departmentId);
    await connection.commit();
    inTransaction = false;
    return res.status(201).json({
      success: true,
      period: periodOutput(period),
      audit_event: "CREATED",
      audit_event_id: audit.insertId,
    });
  } catch (error) {
    if (inTransaction) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("TERM PERIOD ROLLBACK ERROR:", rollbackError);
      }
    }
    return sendPeriodError(res, error);
  } finally {
    if (connection) connection.release();
  }
});

// PATCH: OPEN, CLOSE, REOPEN or CHANGE_DEADLINE.
// Required record_version prevents stale Admin/Program Head browser updates.
router.patch(
  "/gradebook/term-submission-periods/:periodId",
  async (req, res) => {
    let connection;
    let inTransaction = false;
    try {
      const periodId = periodPositiveId(req.params.periodId);
      if (!periodId)
        periodError(
          "TERM_PERIOD_ID_INVALID",
          "periodId must be a positive integer.",
          400,
        );
      allowedPeriodKeys(req.body, [
        "record_version",
        "action",
        "submission_deadline_at",
        "change_reason",
      ]);
      const expectedVersion = periodPositiveId(req.body.record_version);
      if (!expectedVersion)
        periodError(
          "TERM_PERIOD_VERSION_REQUIRED",
          "A positive record_version is required.",
          400,
        );
      const action = req.body.action;
      if (!["OPEN", "CLOSE", "REOPEN", "CHANGE_DEADLINE"].includes(action)) {
        periodError(
          "TERM_PERIOD_ACTION_INVALID",
          "action must be OPEN, CLOSE, REOPEN, or CHANGE_DEADLINE.",
          400,
        );
      }
      const requiresDeadline = ["OPEN", "REOPEN", "CHANGE_DEADLINE"].includes(
        action,
      );
      const reason = periodReason(
        req.body.change_reason,
        ["REOPEN", "CHANGE_DEADLINE"].includes(action),
      );
      if (requiresDeadline && req.body.submission_deadline_at === undefined) {
        periodError(
          "TERM_PERIOD_DEADLINE_REQUIRED",
          "submission_deadline_at is required for this action.",
          400,
        );
      }
      if (!requiresDeadline && req.body.submission_deadline_at !== undefined) {
        periodError(
          "TERM_PERIOD_DEADLINE_UNEXPECTED",
          "CLOSE must not supply submission_deadline_at.",
          400,
        );
      }
      const deadline = requiresDeadline
        ? periodDeadline(req.body.submission_deadline_at)
        : null;
      connection = await db.getConnection();
      await connection.beginTransaction();
      inTransaction = true;
      const { userId, departmentId } = await getActiveTermProgramHead(
        connection,
        req,
      );
      const before = await readPeriod(connection, periodId, departmentId, true);
      if (Number(before.record_version) !== expectedVersion) {
        periodError(
          "TERM_PERIOD_VERSION_CONFLICT",
          "This term submission period changed. Reload before updating it.",
          409,
        );
      }
      if (requiresDeadline) await assertDeadlineFuture(connection, deadline);
      let eventType;
      if (action === "OPEN") {
        if (before.period_status !== "CLOSED" || before.opened_at !== null) {
          periodError(
            "TERM_PERIOD_INVALID_TRANSITION",
            "OPEN is only valid for a newly created, never-opened period.",
            409,
          );
        }
        eventType = "OPENED";
        await connection.execute(
          `UPDATE gradebook_term_submission_periods
            SET period_status = 'OPEN', opened_at = NOW(), closed_at = NULL,
                submission_deadline_at = ?, updated_by_user_id = ?, record_version = record_version + 1
          WHERE period_id = ?`,
          [deadline, userId, periodId],
        );
      } else if (action === "CLOSE") {
        if (before.period_status !== "OPEN") {
          periodError(
            "TERM_PERIOD_INVALID_TRANSITION",
            "Only an OPEN submission period can be closed.",
            409,
          );
        }
        eventType = "CLOSED";
        await connection.execute(
          `UPDATE gradebook_term_submission_periods
            SET period_status = 'CLOSED', closed_at = NOW(),
                updated_by_user_id = ?, record_version = record_version + 1
          WHERE period_id = ?`,
          [userId, periodId],
        );
      } else if (action === "REOPEN") {
        if (before.period_status !== "CLOSED" || before.opened_at === null) {
          periodError(
            "TERM_PERIOD_INVALID_TRANSITION",
            "Only a previously opened and subsequently closed period can be reopened.",
            409,
          );
        }
        eventType = "REOPENED";
        await connection.execute(
          `UPDATE gradebook_term_submission_periods
            SET period_status = 'OPEN', opened_at = NOW(), closed_at = NULL,
                submission_deadline_at = ?, reopen_count = reopen_count + 1,
                last_reopen_reason = ?, updated_by_user_id = ?, record_version = record_version + 1
          WHERE period_id = ?`,
          [deadline, reason, userId, periodId],
        );
      } else {
        if (before.period_status !== "OPEN") {
          periodError(
            "TERM_PERIOD_INVALID_TRANSITION",
            "Deadlines can be changed only while the period is OPEN.",
            409,
          );
        }
        if (before.submission_deadline_at === deadline) {
          periodError(
            "TERM_PERIOD_NO_CHANGES",
            "The new deadline must be different from the current deadline.",
            409,
          );
        }
        eventType = "DEADLINE_CHANGED";
        await connection.execute(
          `UPDATE gradebook_term_submission_periods
            SET submission_deadline_at = ?, updated_by_user_id = ?, record_version = record_version + 1
          WHERE period_id = ?`,
          [deadline, userId, periodId],
        );
      }
      const [audit] = await connection.execute(
        `INSERT INTO gradebook_term_submission_period_events
         (period_id, event_type, previous_period_status, new_period_status,
          previous_deadline_at, new_deadline_at, change_reason, changed_by_user_id, period_version_after)
       SELECT ?, ?, ?, p.period_status, ?, p.submission_deadline_at, ?, ?, p.record_version
         FROM gradebook_term_submission_periods p WHERE p.period_id = ?`,
        [
          periodId,
          eventType,
          before.period_status,
          before.submission_deadline_at,
          reason,
          userId,
          periodId,
        ],
      );
      const after = await readPeriod(connection, periodId, departmentId);
      await connection.commit();
      inTransaction = false;
      return res.json({
        success: true,
        period: periodOutput(after),
        audit_event: eventType,
        audit_event_id: audit.insertId,
      });
    } catch (error) {
      if (inTransaction) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("TERM PERIOD ROLLBACK ERROR:", rollbackError);
        }
      }
      return sendPeriodError(res, error);
    } finally {
      if (connection) connection.release();
    }
  },
);

// GET: read-only audit history for this Program Head's department.
router.get(
  "/gradebook/term-submission-periods/:periodId/history",
  async (req, res) => {
    try {
      const periodId = periodPositiveId(req.params.periodId);
      if (!periodId)
        periodError(
          "TERM_PERIOD_ID_INVALID",
          "periodId must be a positive integer.",
          400,
        );
      if (Object.keys(req.query).length) {
        periodError(
          "TERM_PERIOD_QUERY_INVALID",
          "This history endpoint does not accept query parameters.",
          400,
        );
      }
      const { departmentId } = await getActiveTermProgramHead(db, req);
      await readPeriod(db, periodId, departmentId);
      const [rows] = await db.execute(
        `SELECT e.event_id, e.period_id, e.event_type,
              e.previous_period_status, e.new_period_status,
              DATE_FORMAT(e.previous_deadline_at, '%Y-%m-%d %H:%i:%s') AS previous_deadline_at,
              DATE_FORMAT(e.new_deadline_at, '%Y-%m-%d %H:%i:%s') AS new_deadline_at,
              e.change_reason, e.changed_by_user_id, e.period_version_after,
              DATE_FORMAT(e.event_at, '%Y-%m-%d %H:%i:%s.%f') AS event_at
         FROM gradebook_term_submission_period_events e
        WHERE e.period_id = ?
        ORDER BY e.event_id DESC LIMIT 500`,
        [periodId],
      );
      return res.json({
        success: true,
        period_id: periodId,
        count: rows.length,
        history: rows,
      });
    } catch (error) {
      return sendPeriodError(res, error);
    }
  },
);

export default router;
