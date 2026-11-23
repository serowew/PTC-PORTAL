import express from "express";
import db from "../../db.js";

import { randomUUID } from "node:crypto";
import { validateNumericBatchApprovalInput } from "../../services/gradebookNumericBatchApprovalInput.service.js";
import classesRouter from "./classes.js";
import gradesRouter from "./grades.js";
import profileRouter from "./profile.js";
import transferevaluationRouter from "./transferEvaluations.js";
import offeringBatchesRouter from "./offeringBatches.js";
import incCompletionClaimReviewRouter from "./incCompletionClaimReview.routes.js";
import { assertQaGradingDatabase } from "../../services/gradebookQaWriteGuard.service.js";
import { assertCombinedApprovalWriteAllowed } from "../../services/gradebookCombinedApprovalWriteGuard.service.js";
import { approveModernIncCompletion } from "../../services/gradebookModernIncSource.service.js";
import { calculateGradePreview } from "../gradebookRoster.routes.js";
import { assertSpecialOutcomeReturnWriteAllowed } from "../../services/gradebookSpecialReturnWriteGuard.service.js";
import { assertCurrentNumericApprovalEvidence } from "../../services/gradebookNumericApprovalEvidence.service.js";
import { combinedApprovalSpecialEvidence } from "../../services/gradebookFirstAttemptSpecialEvidence.service.js";
import { reviewModernScoreCorrection } from "../../services/gradebookModernScoreCorrections.service.js";
import { returnSpecialOutcomeSubmission } from "../../services/gradebookSpecialOutcomeReturn.service.js";
import { validateResubmittedSpecialApproval } from "../../services/gradebookSpecialResubmissionApproval.service.js";
import { validateOfficialSheetSpecialEvidence } from "../../services/gradebookOfficialSheetSpecialEvidence.service.js";
const router = express.Router();

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

// Combined semester submission periods

const SEMESTER_PERIOD_QA_DATABASE = "databaseforptc1_admission_test";

const semesterPeriodColumns = `
  p.period_id,
  p.department_id,
  p.academic_year_id,
  p.semester_id,
  p.period_status,
  p.reopen_count,
  p.last_reopen_reason,
  p.created_by_user_id,
  p.updated_by_user_id,
  p.record_version,
  DATE_FORMAT(p.opened_at, '%Y-%m-%d %H:%i:%s') AS opened_at,
  DATE_FORMAT(p.submission_deadline_at, '%Y-%m-%d %H:%i:%s')
    AS submission_deadline_at,
  DATE_FORMAT(p.closed_at, '%Y-%m-%d %H:%i:%s') AS closed_at,
  DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS database_now,
  CASE
    WHEN p.submission_deadline_at IS NOT NULL
      AND NOW() > p.submission_deadline_at
    THEN 1 ELSE 0
  END AS deadline_passed
`;

function semesterPeriodOutput(row) {
  return {
    ...row,
    reopen_count: Number(row.reopen_count),
    record_version: Number(row.record_version),
    deadline_passed: Boolean(Number(row.deadline_passed)),
    can_submit_within_window:
      row.period_status === "OPEN" && !Number(row.deadline_passed),
    grading_scope: "FULL_SEMESTER",
  };
}

function sendSemesterPeriodError(res, error) {
  if (error?.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      success: false,
      code: "SEMESTER_SUBMISSION_PERIOD_ALREADY_EXISTS",
      message:
        "A combined submission period already exists for this department and academic scope.",
    });
  }

  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;

  if (status === 500) {
    console.error("SEMESTER SUBMISSION PERIOD ERROR:", error);
  }

  return res.status(status).json({
    success: false,
    code:
      status === 500
        ? "SEMESTER_PERIOD_INTERNAL_ERROR"
        : String(error.code || "SEMESTER_PERIOD_REQUEST_FAILED").replace(
            /^TERM_/,
            "SEMESTER_",
          ),
    message:
      status === 500
        ? "Could not process the combined semester submission period."
        : error.message,
  });
}

// Authorization and QA scope

async function getSemesterPeriodActor(client, req) {
  const actor = await getActiveTermProgramHead(client, req);

  const [users] = await client.execute(
    `SELECT u.user_id, u.is_active, u.is_archived, r.role_name
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
      WHERE u.user_id = ?`,
    [actor.userId],
  );

  const user = users[0];

  if (
    users.length !== 1 ||
    Number(user.is_active) !== 1 ||
    Number(user.is_archived) !== 0 ||
    user.role_name !== "Program Head"
  ) {
    periodError(
      "SEMESTER_PERIOD_PROGRAM_HEAD_REQUIRED",
      "An active Program Head account is required.",
      403,
    );
  }

  return actor;
}

async function assertSemesterPeriodQaScope(connection) {
  const [rows] = await connection.execute("SELECT DATABASE() AS database_name");

  const activeDatabase =
    Array.isArray(rows) && rows.length === 1 ? rows[0]?.database_name : null;

  if (typeof activeDatabase !== "string" || !activeDatabase.trim()) {
    periodError(
      "SEMESTER_PERIOD_DATABASE_UNKNOWN",
      "Could not verify the active database.",
      403,
    );
  }

  if (activeDatabase === SEMESTER_PERIOD_QA_DATABASE) {
    if (process.env.NODE_ENV === "production") {
      periodError(
        "SEMESTER_PERIOD_QA_PRODUCTION_FORBIDDEN",
        "QA submission-period changes are disabled in production.",
        403,
      );
    }
    return;
  }

  if (process.env.GRADEBOOK_SEMESTER_PERIOD_WRITES_ENABLED !== "true") {
    periodError(
      "SEMESTER_PERIOD_WRITES_DISABLED",
      "Combined submission-period changes are disabled on this server.",
      403,
    );
  }

  const configuredDatabase = process.env.DB_NAME?.trim();
  const targetDatabase =
    process.env.GRADEBOOK_SEMESTER_PERIOD_TARGET_DATABASE?.trim();

  if (
    !configuredDatabase ||
    !targetDatabase ||
    activeDatabase !== configuredDatabase ||
    activeDatabase !== targetDatabase
  ) {
    periodError(
      "SEMESTER_PERIOD_DATABASE_MISMATCH",
      "The active database is not authorized for submission-period changes.",
      403,
    );
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.GRADEBOOK_SEMESTER_PERIOD_PRODUCTION_ENABLED !== "true"
  ) {
    periodError(
      "SEMESTER_PERIOD_PRODUCTION_DISABLED",
      "Production submission-period changes require separate authorization.",
      403,
    );
  }
}

async function readSemesterSubmissionPeriod(
  client,
  periodId,
  departmentId,
  forUpdate = false,
) {
  const [rows] = await client.execute(
    `SELECT ${semesterPeriodColumns}
       FROM gradebook_submission_periods p
      WHERE p.period_id = ?
        AND p.department_id = ?
      ${forUpdate ? "FOR UPDATE" : ""}`,
    [periodId, departmentId],
  );

  if (rows.length !== 1) {
    periodError(
      "SEMESTER_PERIOD_NOT_FOUND",
      "Combined submission period was not found in your department.",
      404,
    );
  }

  return rows[0];
}

// Audit events

async function insertSemesterPeriodEvent(
  client,
  {
    periodId,
    eventType,
    previousStatus,
    newStatus,
    previousDeadline,
    newDeadline,
    reason,
    userId,
    version,
  },
) {
  const [audit] = await client.execute(
    `INSERT INTO gradebook_submission_period_events (
       period_id,
       event_type,
       previous_status,
       new_status,
       previous_deadline_at,
       new_deadline_at,
       event_reason,
       performed_by_user_id,
       period_version_after
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      periodId,
      eventType,
      previousStatus,
      newStatus,
      previousDeadline,
      newDeadline,
      reason,
      userId,
      version,
    ],
  );

  if (Number(audit.affectedRows) !== 1) {
    throw new Error("Semester submission period audit failed.");
  }
}

// Transaction wrapper

async function semesterPeriodRequest(req, res, handler) {
  let connection;
  let transactionStarted = false;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const actor = await getSemesterPeriodActor(connection, req);

    const result = await handler(connection, actor);

    await connection.commit();
    transactionStarted = false;

    return res.status(result.status ?? 200).json(result.body);
  } catch (error) {
    if (transactionStarted && connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("SEMESTER PERIOD ROLLBACK ERROR:", rollbackError);
      }
    }

    return sendSemesterPeriodError(res, error);
  } finally {
    connection?.release();
  }
}

// List combined submission periods

router.get("/gradebook/semester-submission-periods", async (req, res) =>
  semesterPeriodRequest(req, res, async (connection, actor) => {
    allowedPeriodKeys(req.query, ["academic_year_id", "semester_id"]);

    const conditions = ["p.department_id = ?"];
    const params = [actor.departmentId];

    for (const field of ["academic_year_id", "semester_id"]) {
      if (req.query[field] !== undefined) {
        const id = periodPositiveId(req.query[field]);

        if (!id) {
          periodError(
            "SEMESTER_PERIOD_QUERY_INVALID",
            `${field} must be a positive integer.`,
            400,
          );
        }

        conditions.push(`p.${field} = ?`);
        params.push(id);
      }
    }

    const [rows] = await connection.execute(
      `SELECT ${semesterPeriodColumns}
           FROM gradebook_submission_periods p
          WHERE ${conditions.join(" AND ")}
          ORDER BY p.academic_year_id DESC, p.semester_id`,
      params,
    );

    return {
      body: {
        success: true,
        department_id: actor.departmentId,
        count: rows.length,
        periods: rows.map(semesterPeriodOutput),
      },
    };
  }),
);

// Create a closed combined submission period

router.post("/gradebook/semester-submission-periods", async (req, res) =>
  semesterPeriodRequest(req, res, async (connection, actor) => {
    allowedPeriodKeys(req.body, [
      "academic_year_id",
      "semester_id",
      "change_reason",
    ]);

    const academicYearId = periodPositiveId(req.body.academic_year_id);

    const semesterId = periodPositiveId(req.body.semester_id);

    if (!academicYearId || !semesterId) {
      periodError(
        "SEMESTER_PERIOD_SCOPE_INVALID",
        "Valid academic_year_id and semester_id are required.",
        400,
      );
    }

    const reason = periodReason(req.body.change_reason);

    await assertSemesterPeriodQaScope(connection);

    await assertPeriodScope(connection, academicYearId, semesterId);

    // Serialize period creation within the academic year.
    await connection.execute(
      `SELECT academic_year_id
           FROM academic_years
          WHERE academic_year_id = ?
          FOR UPDATE`,
      [academicYearId],
    );

    const [existing] = await connection.execute(
      `SELECT period_id
           FROM gradebook_submission_periods
          WHERE department_id = ?
            AND academic_year_id = ?
            AND semester_id = ?
          FOR UPDATE`,
      [actor.departmentId, academicYearId, semesterId],
    );

    if (existing.length) {
      periodError(
        "SEMESTER_SUBMISSION_PERIOD_ALREADY_EXISTS",
        "A combined submission period already exists.",
      );
    }

    const [insert] = await connection.execute(
      `INSERT INTO gradebook_submission_periods (
           department_id,
           academic_year_id,
           semester_id,
           period_status,
           created_by_user_id,
           updated_by_user_id,
           record_version
         )
         VALUES (?, ?, ?, 'CLOSED', ?, ?, 1)`,
      [
        actor.departmentId,
        academicYearId,
        semesterId,
        actor.userId,
        actor.userId,
      ],
    );

    const periodId = Number(insert.insertId);

    await insertSemesterPeriodEvent(connection, {
      periodId,
      eventType: "CREATED",
      previousStatus: null,
      newStatus: "CLOSED",
      previousDeadline: null,
      newDeadline: null,
      reason,
      userId: actor.userId,
      version: 1,
    });

    const period = await readSemesterSubmissionPeriod(
      connection,
      periodId,
      actor.departmentId,
    );

    return {
      status: 201,
      body: {
        success: true,
        period: semesterPeriodOutput(period),
        audit_event: "CREATED",
      },
    };
  }),
);

// Open, close, reopen or change deadline

router.patch(
  "/gradebook/semester-submission-periods/:periodId",
  async (req, res) =>
    semesterPeriodRequest(req, res, async (connection, actor) => {
      const periodId = periodPositiveId(req.params.periodId);

      if (!periodId) {
        periodError(
          "SEMESTER_PERIOD_ID_INVALID",
          "A valid periodId is required.",
          400,
        );
      }

      allowedPeriodKeys(req.body, [
        "record_version",
        "action",
        "submission_deadline_at",
        "change_reason",
      ]);

      const expectedVersion = periodPositiveId(req.body.record_version);

      if (!expectedVersion) {
        periodError(
          "SEMESTER_PERIOD_VERSION_REQUIRED",
          "A positive record_version is required.",
          400,
        );
      }

      const action = req.body.action;

      if (!["OPEN", "CLOSE", "REOPEN", "CHANGE_DEADLINE"].includes(action)) {
        periodError(
          "SEMESTER_PERIOD_ACTION_INVALID",
          "Unsupported submission period action.",
          400,
        );
      }

      const reason = periodReason(
        req.body.change_reason,
        ["REOPEN", "CHANGE_DEADLINE"].includes(action),
      );

      const current = await readSemesterSubmissionPeriod(
        connection,
        periodId,
        actor.departmentId,
        true,
      );

      await assertSemesterPeriodQaScope(connection);

      if (Number(current.record_version) !== expectedVersion) {
        periodError(
          "SEMESTER_PERIOD_VERSION_CONFLICT",
          "This submission period has changed. Reload it before updating.",
        );
      }

      if (expectedVersion >= 4294967295) {
        periodError(
          "SEMESTER_PERIOD_VERSION_OVERFLOW",
          "Submission period record version cannot increase further.",
        );
      }

      let nextStatus = current.period_status;
      let nextDeadline = current.submission_deadline_at;
      let eventType;

      if (action === "OPEN") {
        if (
          current.period_status !== "CLOSED" ||
          current.opened_at !== null ||
          current.closed_at !== null
        ) {
          periodError(
            "SEMESTER_PERIOD_CANNOT_OPEN",
            "Use REOPEN for a previously opened and closed period.",
          );
        }

        nextStatus = "OPEN";
        eventType = "OPENED";
      }

      if (action === "CLOSE") {
        if (current.period_status !== "OPEN") {
          periodError(
            "SEMESTER_PERIOD_ALREADY_CLOSED",
            "The submission period is already closed.",
          );
        }

        if (Object.hasOwn(req.body, "submission_deadline_at")) {
          periodError(
            "SEMESTER_PERIOD_UNEXPECTED_DEADLINE",
            "CLOSE does not accept a new deadline.",
            400,
          );
        }

        nextStatus = "CLOSED";
        eventType = "CLOSED";
      }

      if (action === "REOPEN") {
        if (
          current.period_status !== "CLOSED" ||
          current.opened_at === null ||
          current.closed_at === null
        ) {
          periodError(
            "SEMESTER_PERIOD_CANNOT_REOPEN",
            "Only a previously opened and closed period can be reopened.",
          );
        }

        if (Number(current.reopen_count) >= 4294967295) {
          periodError(
            "SEMESTER_PERIOD_REOPEN_COUNT_OVERFLOW",
            "The reopen counter cannot increase further.",
          );
        }

        nextStatus = "OPEN";
        eventType = "REOPENED";
      }

      if (action === "CHANGE_DEADLINE") {
        if (
          current.period_status !== "OPEN" ||
          Number(current.deadline_passed) === 1
        ) {
          periodError(
            "SEMESTER_PERIOD_NOT_ACTIVE",
            "Close and reopen an expired period using an authorized reason.",
          );
        }

        eventType = "DEADLINE_CHANGED";

        // Fail closed if the expected audit event is unavailable.
        const [[eventColumn]] = await connection.execute(
          `SELECT COLUMN_TYPE AS event_type_definition
             FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'gradebook_submission_period_events'
              AND COLUMN_NAME = 'event_type'`,
        );

        if (
          !String(eventColumn?.event_type_definition ?? "").includes(
            "'DEADLINE_CHANGED'",
          )
        ) {
          periodError(
            "SEMESTER_PERIOD_AUDIT_EVENT_UNSUPPORTED",
            "The deadline-change audit event is not supported by the current schema.",
          );
        }
      }

      if (["OPEN", "REOPEN", "CHANGE_DEADLINE"].includes(action)) {
        nextDeadline = periodDeadline(req.body.submission_deadline_at);

        await assertDeadlineFuture(connection, nextDeadline);
      }

      if (
        action === "CHANGE_DEADLINE" &&
        nextDeadline === current.submission_deadline_at
      ) {
        periodError(
          "SEMESTER_PERIOD_DEADLINE_UNCHANGED",
          "The new deadline is identical to the current deadline.",
        );
      }

      const nextVersion = expectedVersion + 1;
      const isOpening = ["OPEN", "REOPEN"].includes(action);
      const isClosing = action === "CLOSE";
      const isReopening = action === "REOPEN";

      const [update] = await connection.execute(
        `UPDATE gradebook_submission_periods
            SET period_status = ?,
                submission_deadline_at = ?,
                opened_at = CASE
                  WHEN ? = 1 THEN NOW()
                  ELSE opened_at
                END,
                closed_at = CASE
                  WHEN ? = 1 THEN NOW()
                  WHEN ? = 1 THEN NULL
                  ELSE closed_at
                END,
                reopen_count = reopen_count + ?,
                last_reopen_reason = CASE
                  WHEN ? = 1 THEN ?
                  ELSE last_reopen_reason
                END,
                updated_by_user_id = ?,
                record_version = ?
          WHERE period_id = ?
            AND department_id = ?
            AND record_version = ?`,
        [
          nextStatus,
          nextDeadline,
          Number(isOpening),
          Number(isClosing),
          Number(isOpening),
          Number(isReopening),
          Number(isReopening),
          reason,
          actor.userId,
          nextVersion,
          periodId,
          actor.departmentId,
          expectedVersion,
        ],
      );

      if (Number(update.affectedRows) !== 1) {
        periodError(
          "SEMESTER_PERIOD_VERSION_CONFLICT",
          "The submission period was modified concurrently.",
        );
      }

      await insertSemesterPeriodEvent(connection, {
        periodId,
        eventType,
        previousStatus: current.period_status,
        newStatus: nextStatus,
        previousDeadline: current.submission_deadline_at,
        newDeadline: nextDeadline,
        reason,
        userId: actor.userId,
        version: nextVersion,
      });

      const period = await readSemesterSubmissionPeriod(
        connection,
        periodId,
        actor.departmentId,
      );

      return {
        body: {
          success: true,
          period: semesterPeriodOutput(period),
          audit_event: eventType,
        },
      };
    }),
);

// Submission period history

router.get(
  "/gradebook/semester-submission-periods/:periodId/history",
  async (req, res) =>
    semesterPeriodRequest(req, res, async (connection, actor) => {
      const periodId = periodPositiveId(req.params.periodId);

      if (!periodId) {
        periodError(
          "SEMESTER_PERIOD_ID_INVALID",
          "A valid periodId is required.",
          400,
        );
      }

      const period = await readSemesterSubmissionPeriod(
        connection,
        periodId,
        actor.departmentId,
      );

      const [events] = await connection.execute(
        `SELECT
           CAST(event_id AS CHAR) AS event_id,
           period_id,
           event_type,
           previous_status,
           new_status,
           DATE_FORMAT(
             previous_deadline_at,
             '%Y-%m-%d %H:%i:%s'
           ) AS previous_deadline_at,
           DATE_FORMAT(
             new_deadline_at,
             '%Y-%m-%d %H:%i:%s'
           ) AS new_deadline_at,
           event_reason,
           performed_by_user_id,
           period_version_after
         FROM gradebook_submission_period_events
         WHERE period_id = ?
         ORDER BY period_version_after, event_id`,
        [periodId],
      );

      return {
        body: {
          success: true,
          period: semesterPeriodOutput(period),
          count: events.length,
          events,
        },
      };
    }),
);

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

    // Legacy term-period writes remain QA-only
    await assertQaGradingDatabase(connection);

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

      // Legacy term-period writes remain QA-only
      await assertQaGradingDatabase(connection);

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

// Gradebook Term Review — controlled test rollout
// Submissions are independently reviewed per MIDTERM or FINAL_TERM.
// Approval publishes an official semester grade only when both terms are approved.
const termReviewTestDatabase = "databaseforptc1_admission_test";
const termReviewPilotOfferingId = 131;

function termReviewFail(code, message, status = 409) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  throw err;
}

function termReviewRespondError(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
  if (status === 500) console.error("PROGRAM HEAD TERM REVIEW ERROR:", error);
  return res.status(status).json({
    success: false,
    code:
      status === 500
        ? "TERM_REVIEW_INTERNAL_ERROR"
        : error.code || "TERM_REVIEW_FAILED",
    message:
      status === 500
        ? "Could not review the student term grade."
        : error.message,
  });
}

async function termReviewAssertTestDatabase(client) {
  const [rows] = await client.execute("SELECT DATABASE() AS database_name");
  if (rows[0]?.database_name !== termReviewTestDatabase) {
    termReviewFail(
      "TERM_REVIEW_TEST_DATABASE_ONLY",
      "Term review pilot endpoints are available only in databaseforptc1_admission_test.",
      403,
    );
  }
}

function termReviewBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    termReviewFail(
      "TERM_REVIEW_BODY_INVALID",
      "A JSON object is required.",
      400,
    );
  }
  const valid = ["action", "record_version", "review_remarks", "dry_run"];
  const extra = Object.keys(body).filter((key) => !valid.includes(key));
  if (extra.length) {
    termReviewFail(
      "TERM_REVIEW_FIELDS_UNSUPPORTED",
      `Unsupported field(s): ${extra.join(", ")}.`,
      400,
    );
  }
  const action = body.action;
  if (!["APPROVE", "RETURN"].includes(action)) {
    termReviewFail(
      "TERM_REVIEW_ACTION_INVALID",
      "action must be APPROVE or RETURN.",
      400,
    );
  }
  const recordVersion = periodPositiveId(body.record_version);
  if (!recordVersion) {
    termReviewFail(
      "TERM_REVIEW_VERSION_REQUIRED",
      "A valid current record_version is required.",
      400,
    );
  }
  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
    termReviewFail(
      "TERM_REVIEW_DRY_RUN_INVALID",
      "dry_run must be true or false.",
      400,
    );
  }
  if (
    body.review_remarks !== undefined &&
    body.review_remarks !== null &&
    typeof body.review_remarks !== "string"
  ) {
    termReviewFail(
      "TERM_REVIEW_REMARKS_INVALID",
      "review_remarks must be a string.",
      400,
    );
  }
  const remarks =
    typeof body.review_remarks === "string" ? body.review_remarks.trim() : null;
  if (remarks && remarks.length > 2000) {
    termReviewFail(
      "TERM_REVIEW_REMARKS_TOO_LONG",
      "review_remarks must not exceed 2000 characters.",
      400,
    );
  }
  if (action === "RETURN" && (!remarks || remarks.length < 5)) {
    termReviewFail(
      "TERM_REVIEW_RETURN_REASON_REQUIRED",
      "Returning a student term requires a documented review_remarks of at least 5 characters.",
      400,
    );
  }
  return {
    action,
    recordVersion,
    remarks: remarks || null,
    dryRun: body.dry_run === true,
  };
}

function termReviewFormatRow(row) {
  return {
    term_submission_id: String(row.term_submission_id),
    config_id: Number(row.config_id),
    offering_id: Number(row.offering_id),
    enrollment_subject_id: Number(row.enrollment_subject_id),
    student_id: Number(row.student_id),
    student_number: row.student_number,
    student_name: [row.first_name, row.middle_name, row.last_name]
      .filter(Boolean)
      .join(" "),
    academic_year_id: Number(row.academic_year_id),
    semester_id: Number(row.semester_id),
    department_id: Number(row.department_id),
    grading_term: row.grading_term,
    attempt_number: Number(row.attempt_number),
    period_id: Number(row.period_id),
    submission_status: row.submission_status,
    term_percentage: {
      exact_numerator: row.term_percentage_exact_numerator,
      exact_denominator: row.term_percentage_exact_denominator,
    },
    submitted_by_user_id: Number(row.submitted_by_user_id),
    submitted_at: row.submitted_at,
    reviewed_by_user_id:
      row.reviewed_by_user_id === null ? null : Number(row.reviewed_by_user_id),
    reviewed_at: row.reviewed_at,
    review_remarks: row.review_remarks,
    record_version: Number(row.record_version),
  };
}

const termReviewSelect = `
    a.term_submission_id, a.config_id, a.enrollment_subject_id,
    a.grading_term, a.period_id, a.attempt_number, a.submission_status,
    a.term_percentage_exact_numerator, a.term_percentage_exact_denominator,
    a.submitted_by_user_id, a.reviewed_by_user_id, a.review_remarks,
    a.record_version,
    DATE_FORMAT(a.submitted_at, '%Y-%m-%d %H:%i:%s.%f') AS submitted_at,
    DATE_FORMAT(a.reviewed_at, '%Y-%m-%d %H:%i:%s.%f') AS reviewed_at,
    c.offering_id, so.academic_year_id, so.semester_id, cr.department_id,
    s.student_id, s.student_number, s.first_name, s.middle_name, s.last_name`;

const termReviewFrom = `
    FROM gradebook_term_submission_attempts a
    JOIN gradebook_offering_config c ON c.config_id = a.config_id
    JOIN subject_offerings so ON so.offering_id = c.offering_id
    JOIN sections sec ON sec.section_id = so.section_id
    JOIN courses cr ON cr.course_id = sec.course_id
    JOIN enrollment_subjects es ON es.enrollment_subject_id = a.enrollment_subject_id
    JOIN enrollments e ON e.enrollment_id = es.enrollment_id
    JOIN students s ON s.student_id = e.student_id`;

// GET /api/program-head/gradebook/term-submissions
// Lists only the latest submission attempt for each student and grading term.
router.get("/gradebook/term-submissions", async (req, res) => {
  try {
    await termReviewAssertTestDatabase(db);
    const supported = [
      "submission_status",
      "grading_term",
      "academic_year_id",
      "semester_id",
    ];
    const extra = Object.keys(req.query).filter(
      (key) => !supported.includes(key),
    );
    if (extra.length) {
      termReviewFail(
        "TERM_REVIEW_QUERY_INVALID",
        `Unsupported query field(s): ${extra.join(", ")}.`,
        400,
      );
    }
    const status = req.query.submission_status ?? "SUBMITTED";
    if (!["SUBMITTED", "APPROVED", "RETURNED", "ALL"].includes(status)) {
      termReviewFail(
        "TERM_REVIEW_STATUS_INVALID",
        "submission_status must be SUBMITTED, APPROVED, RETURNED, or ALL.",
        400,
      );
    }
    if (
      req.query.grading_term !== undefined &&
      !periodTerm(req.query.grading_term)
    ) {
      termReviewFail(
        "TERM_REVIEW_TERM_INVALID",
        "grading_term must be MIDTERM or FINAL_TERM.",
        400,
      );
    }
    const { userId, departmentId } = await getActiveTermProgramHead(db, req);
    const conditions = [
      "cr.department_id = ?",
      `NOT EXISTS (
        SELECT 1 FROM gradebook_term_submission_attempts newer
         WHERE newer.config_id = a.config_id
           AND newer.enrollment_subject_id = a.enrollment_subject_id
           AND newer.grading_term = a.grading_term
           AND (newer.attempt_number > a.attempt_number OR
                (newer.attempt_number = a.attempt_number
                 AND newer.term_submission_id > a.term_submission_id))
      )`,
    ];
    const params = [departmentId];
    if (status !== "ALL") {
      conditions.push("a.submission_status = ?");
      params.push(status);
    }
    if (req.query.grading_term !== undefined) {
      conditions.push("a.grading_term = ?");
      params.push(req.query.grading_term);
    }
    for (const field of ["academic_year_id", "semester_id"]) {
      if (req.query[field] !== undefined) {
        const id = periodPositiveId(req.query[field]);
        if (!id)
          termReviewFail(
            "TERM_REVIEW_QUERY_INVALID",
            `${field} must be a positive integer.`,
            400,
          );
        conditions.push(`so.${field} = ?`);
        params.push(id);
      }
    }
    const [rows] = await db.execute(
      `SELECT ${termReviewSelect} ${termReviewFrom}
       WHERE ${conditions.join(" AND ")}
       ORDER BY a.submitted_at DESC, a.term_submission_id DESC
       LIMIT 100`,
      params,
    );
    return res.json({
      success: true,
      read_only: true,
      department_id: departmentId,
      reviewer_user_id: userId,
      filters: {
        submission_status: status,
        grading_term: req.query.grading_term ?? null,
        academic_year_id: req.query.academic_year_id ?? null,
        semester_id: req.query.semester_id ?? null,
      },
      count: rows.length,
      submissions: rows.map(termReviewFormatRow),
      has_more: rows.length === 100,
      note: "Up to 100 latest student-term attempts are returned. No official grades are published here.",
    });
  } catch (error) {
    return termReviewRespondError(res, error);
  }
});

// GET /api/program-head/gradebook/term-submissions/:submissionId
// Read-only submission snapshot and review details, department restricted.
router.get("/gradebook/term-submissions/:submissionId", async (req, res) => {
  try {
    await termReviewAssertTestDatabase(db);
    if (Object.keys(req.query).length) {
      termReviewFail(
        "TERM_REVIEW_QUERY_INVALID",
        "This endpoint does not accept query parameters.",
        400,
      );
    }
    const submissionId = periodPositiveId(req.params.submissionId);
    if (!submissionId)
      termReviewFail(
        "TERM_REVIEW_ID_INVALID",
        "submissionId must be a positive integer.",
        400,
      );
    const { departmentId } = await getActiveTermProgramHead(db, req);
    const [rows] = await db.execute(
      `SELECT ${termReviewSelect}, a.calculation_snapshot_json
         ${termReviewFrom}
        WHERE a.term_submission_id = ? AND cr.department_id = ?`,
      [submissionId, departmentId],
    );
    if (rows.length !== 1) {
      termReviewFail(
        "TERM_SUBMISSION_NOT_FOUND",
        "Term submission was not found in your department.",
        404,
      );
    }
    const row = rows[0];
    let snapshot = row.calculation_snapshot_json;
    if (Buffer.isBuffer(snapshot)) snapshot = snapshot.toString("utf8");
    if (typeof snapshot === "string") {
      try {
        snapshot = JSON.parse(snapshot);
      } catch {
        termReviewFail(
          "TERM_SUBMISSION_SNAPSHOT_INVALID",
          "The saved calculation snapshot is not valid JSON.",
        );
      }
    }
    return res.json({
      success: true,
      read_only: true,
      submission: termReviewFormatRow(row),
      calculation_snapshot: snapshot,
    });
  } catch (error) {
    return termReviewRespondError(res, error);
  }
});

// Official semester publication — pilot rollout for Offering #131.
// The entire review, publication and existing grade triggers run atomically.
// This requires the additive gradebook_official_grade_publications table.
function publicationExactTerm(submission) {
  const n = String(submission.term_percentage_exact_numerator);
  const d = String(submission.term_percentage_exact_denominator);
  if (
    !/^(0|[1-9][0-9]*)$/.test(n) ||
    !/^[1-9][0-9]*$/.test(d) ||
    n.length > 255 ||
    d.length > 255
  ) {
    termReviewFail(
      "TERM_PUBLICATION_EXACT_PERCENT_INVALID",
      "The saved term percentage is not a valid nonnegative fraction.",
    );
  }
  const numerator = BigInt(n);
  const denominator = BigInt(d);
  if (numerator > denominator * 100n) {
    termReviewFail(
      "TERM_PUBLICATION_PERCENT_OUT_OF_RANGE",
      "An approved term percentage is outside the allowed 0–100 range.",
    );
  }
  return { numerator, denominator };
}

function publicationSnapshot(submission) {
  let snapshot = submission.calculation_snapshot_json;
  if (Buffer.isBuffer(snapshot)) snapshot = snapshot.toString("utf8");
  if (typeof snapshot === "string") {
    try {
      snapshot = JSON.parse(snapshot);
    } catch {
      termReviewFail(
        "TERM_SUBMISSION_SNAPSHOT_INVALID",
        "The original calculation snapshot is invalid.",
      );
    }
  }
  const exact = publicationExactTerm(submission);
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    String(snapshot.config_id) !== String(submission.config_id) ||
    String(snapshot.enrollment_subject_id) !==
      String(submission.enrollment_subject_id) ||
    snapshot.grading_term !== submission.grading_term ||
    snapshot.calculated_term?.state !== "READY" ||
    String(snapshot.calculated_term?.term_percentage?.exact_numerator) !==
      String(submission.term_percentage_exact_numerator) ||
    String(snapshot.calculated_term?.term_percentage?.exact_denominator) !==
      String(submission.term_percentage_exact_denominator)
  ) {
    termReviewFail(
      "TERM_SUBMISSION_SNAPSHOT_MISMATCH",
      "The saved grade calculation snapshot is inconsistent and cannot be reviewed.",
    );
  }
  return exact;
}

function publicationDecimal12(numerator, denominator) {
  const scale = 1000000000000n;
  const scaled = numerator * scale;
  const quotient = scaled / denominator;
  const remainder = scaled % denominator;
  const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  return `${rounded / scale}.${String(rounded % scale).padStart(12, "0")}`;
}

function publicationRating(numerator, denominator) {
  const scale = [
    [97n, "1.00"],
    [94n, "1.25"],
    [91n, "1.50"],
    [88n, "1.75"],
    [85n, "2.00"],
    [82n, "2.25"],
    [79n, "2.50"],
    [76n, "2.75"],
    [75n, "3.00"],
  ];
  for (const [threshold, rating] of scale) {
    if (numerator >= threshold * denominator) return rating;
  }
  return "5.00";
}

// Store exact source term submission IDs and the unrounded official calculation.
// A record is inserted only once, after both terms have been approved.
async function publishApprovedSemester(
  connection,
  { current, offering, reviewerUserId },
) {
  const otherTerm =
    current.grading_term === "MIDTERM" ? "FINAL_TERM" : "MIDTERM";
  const [otherRows] = await connection.execute(
    `SELECT term_submission_id, config_id, enrollment_subject_id,
            grading_term, submission_status, record_version,
            reviewed_by_user_id, reviewed_at,
            term_percentage_exact_numerator, term_percentage_exact_denominator,
            calculation_snapshot_json
       FROM gradebook_term_submission_attempts
      WHERE config_id = ? AND enrollment_subject_id = ? AND grading_term = ?
      ORDER BY attempt_number DESC, term_submission_id DESC
      LIMIT 1 FOR UPDATE`,
    [
      Number(current.config_id),
      Number(current.enrollment_subject_id),
      otherTerm,
    ],
  );
  const other = otherRows[0];
  if (!other || other.submission_status !== "APPROVED") return null;
  if (other.reviewed_by_user_id === null || other.reviewed_at === null) {
    termReviewFail(
      "TERM_PUBLICATION_APPROVAL_INCOMPLETE",
      "The other term has no recorded approval actor and timestamp.",
    );
  }
  if (current.reviewed_by_user_id === null || current.reviewed_at === null) {
    termReviewFail(
      "TERM_PUBLICATION_APPROVAL_INCOMPLETE",
      "The current term has no recorded approval actor and timestamp.",
    );
  }
  if (
    String(other.config_id) !== String(current.config_id) ||
    String(other.enrollment_subject_id) !==
      String(current.enrollment_subject_id) ||
    other.grading_term !== otherTerm
  ) {
    termReviewFail(
      "TERM_PUBLICATION_SCOPE_MISMATCH",
      "The approved terms do not have the same gradebook and student enrollment.",
    );
  }
  const currentExact = publicationSnapshot(current);
  const otherExact = publicationSnapshot(other);
  const mid = current.grading_term === "MIDTERM" ? currentExact : otherExact;
  const fin = current.grading_term === "FINAL_TERM" ? currentExact : otherExact;
  const midtermSubmissionId = String(
    current.grading_term === "MIDTERM"
      ? current.term_submission_id
      : other.term_submission_id,
  );
  const finalTermSubmissionId = String(
    current.grading_term === "FINAL_TERM"
      ? current.term_submission_id
      : other.term_submission_id,
  );

  // The final official conversion uses the exact 50/50 rational, not rounded terms.
  const numerator =
    mid.numerator * fin.denominator + fin.numerator * mid.denominator;
  const denominator = 2n * mid.denominator * fin.denominator;
  const midtermDecimal = publicationDecimal12(mid.numerator, mid.denominator);
  const finalTermDecimal = publicationDecimal12(fin.numerator, fin.denominator);
  const overallDecimal = publicationDecimal12(numerator, denominator);
  const finalRating = publicationRating(numerator, denominator);
  const remarks = finalRating === "5.00" ? "Failed" : "Passed";
  const studentStatus = finalRating === "5.00" ? "Failed" : "Completed";

  if (
    !periodPositiveId(offering.faculty_id) ||
    offering.offering_status === "Cancelled"
  ) {
    termReviewFail(
      "TERM_PUBLICATION_FACULTY_OR_OFFERING_INVALID",
      "The offering must have an assigned faculty member and must not be cancelled.",
    );
  }
  const [facultyRows] = await connection.execute(
    "SELECT faculty_id FROM faculty WHERE faculty_id = ?",
    [Number(offering.faculty_id)],
  );
  if (facultyRows.length !== 1) {
    termReviewFail(
      "TERM_PUBLICATION_FACULTY_NOT_FOUND",
      "The offering assigned faculty member was not found.",
    );
  }
  const [otherLock] = await connection.execute(
    `SELECT first_submission_id
       FROM gradebook_term_structure_locks
      WHERE config_id = ? AND grading_term = ? FOR UPDATE`,
    [Number(current.config_id), otherTerm],
  );
  if (otherLock.length !== 1) {
    termReviewFail(
      "TERM_PUBLICATION_OTHER_TERM_LOCK_MISSING",
      "The second approved term must have a valid structure lock.",
    );
  }

  // Preserve historical records: never upsert or replace a legacy grade.
  const [existing] = await connection.execute(
    "SELECT grade_id FROM grades WHERE enrollment_subject_id = ? FOR UPDATE",
    [Number(current.enrollment_subject_id)],
  );
  if (existing.length) {
    termReviewFail(
      "OFFICIAL_GRADE_REQUIRES_RECONCILIATION",
      "An official grade already exists. Automatic publication will not overwrite it.",
    );
  }

  // Existing database triggers enforce Draft → Submitted → Approved, calculate
  // grade fields, and update the student's subject outcome on approval.
  const [inserted] = await connection.execute(
    `INSERT INTO grades
       (enrollment_subject_id, faculty_id, midterm_grade, final_grade,
        grading_policy, grading_outcome, grade_status)
     VALUES (?, ?, ?, ?, 'TWO_TERM_50_50', 'NUMERIC', 'Draft')`,
    [
      Number(current.enrollment_subject_id),
      Number(offering.faculty_id),
      midtermDecimal,
      finalTermDecimal,
    ],
  );
  const gradeId = Number(inserted.insertId);
  if (!periodPositiveId(gradeId))
    throw new Error("Official grade insert did not create a grade ID.");
  const [submitted] = await connection.execute(
    `UPDATE grades SET grade_status = 'Submitted'
      WHERE grade_id = ? AND grade_status = 'Draft'`,
    [gradeId],
  );
  if (Number(submitted.affectedRows) !== 1) {
    termReviewFail(
      "TERM_PUBLICATION_STATUS_TRANSITION_FAILED",
      "Could not advance the official grade to Submitted.",
    );
  }
  const [approved] = await connection.execute(
    `UPDATE grades
        SET grade_status = 'Approved', reviewed_by = ?
      WHERE grade_id = ? AND grade_status = 'Submitted'`,
    [reviewerUserId, gradeId],
  );
  if (Number(approved.affectedRows) !== 1) {
    termReviewFail(
      "TERM_PUBLICATION_STATUS_TRANSITION_FAILED",
      "Could not approve the official grade.",
    );
  }

  // Guard against threshold errors from decimal rounding in legacy triggers.
  // A mismatch fails closed and rolls back *all* approval/publication changes.
  const [verificationRows] = await connection.execute(
    `SELECT grade_id, enrollment_subject_id, midterm_grade, final_grade,
            overall_percentage, final_rating, remarks, grade_status,
            grading_policy, grading_outcome, faculty_id, reviewed_by
       FROM grades WHERE grade_id = ? FOR UPDATE`,
    [gradeId],
  );
  const verified = verificationRows[0];
  const [subjectRows] = await connection.execute(
    "SELECT status FROM enrollment_subjects WHERE enrollment_subject_id = ?",
    [Number(current.enrollment_subject_id)],
  );
  if (
    !verified ||
    verified.grade_status !== "Approved" ||
    verified.grading_policy !== "TWO_TERM_50_50" ||
    verified.grading_outcome !== "NUMERIC" ||
    String(verified.midterm_grade) !== midtermDecimal ||
    String(verified.final_grade) !== finalTermDecimal ||
    String(verified.overall_percentage) !== overallDecimal ||
    Number(verified.final_rating).toFixed(2) !== finalRating ||
    verified.remarks !== remarks ||
    Number(verified.reviewed_by) !== reviewerUserId ||
    subjectRows[0]?.status !== studentStatus
  ) {
    termReviewFail(
      "TERM_PUBLICATION_GRADE_INTEGRITY_MISMATCH",
      "The official grade, precision or subject status differs from the exact approved calculation. Publication was rolled back.",
    );
  }

  const [linked] = await connection.execute(
    `INSERT INTO gradebook_official_grade_publications
       (grade_id, config_id, enrollment_subject_id,
        midterm_submission_id, final_term_submission_id,
        overall_exact_numerator, overall_exact_denominator,
        published_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      gradeId,
      Number(current.config_id),
      Number(current.enrollment_subject_id),
      midtermSubmissionId,
      finalTermSubmissionId,
      String(numerator),
      String(denominator),
      reviewerUserId,
    ],
  );
  if (!periodPositiveId(linked.insertId)) {
    throw new Error(
      "Could not save the official grade publication audit link.",
    );
  }
  return {
    grade_id: gradeId,
    publication_id: String(linked.insertId),
    midterm_submission_id: midtermSubmissionId,
    final_term_submission_id: finalTermSubmissionId,
    midterm_percentage: midtermDecimal,
    final_term_percentage: finalTermDecimal,
    overall_percentage: overallDecimal,
    overall_exact_numerator: String(numerator),
    overall_exact_denominator: String(denominator),
    final_rating: finalRating,
    remarks,
    grade_status: "Approved",
    enrollment_subject_status: studentStatus,
  };
}

// POST /api/program-head/gradebook/term-submissions/:submissionId/review
// A second term APPROVE creates the official semester grade in the same txn.
router.post(
  "/gradebook/term-submissions/:submissionId/review",
  async (req, res) => {
    let connection;
    let inTransaction = false;
    try {
      if (Object.keys(req.query).length) {
        termReviewFail(
          "TERM_REVIEW_QUERY_INVALID",
          "Term review does not accept query parameters.",
          400,
        );
      }
      const submissionId = periodPositiveId(req.params.submissionId);
      if (!submissionId)
        termReviewFail(
          "TERM_REVIEW_ID_INVALID",
          "submissionId must be a positive integer.",
          400,
        );
      const input = termReviewBody(req.body);
      connection = await db.getConnection();
      await connection.beginTransaction();
      inTransaction = true;

      // Legacy grading reviews remain QA-only
      await assertQaGradingDatabase(connection);

      await termReviewAssertTestDatabase(connection);
      const { userId, departmentId } = await getActiveTermProgramHead(
        connection,
        req,
      );

      // Lock in offering → config → enrollment order, matching score/submission routes.
      const [candidates] = await connection.execute(
        `SELECT a.config_id, a.enrollment_subject_id, a.grading_term, c.offering_id
         FROM gradebook_term_submission_attempts a
         JOIN gradebook_offering_config c ON c.config_id = a.config_id
        WHERE a.term_submission_id = ?`,
        [submissionId],
      );
      if (candidates.length !== 1) {
        termReviewFail(
          "TERM_SUBMISSION_NOT_FOUND",
          "Term submission was not found.",
          404,
        );
      }
      const target = candidates[0];
      const offeringId = Number(target.offering_id);
      if (offeringId !== termReviewPilotOfferingId) {
        termReviewFail(
          "TERM_REVIEW_TEST_OFFERING_ONLY",
          "Committed Program Head term reviews are currently limited to QA Offering #131.",
          403,
        );
      }
      const [offerings] = await connection.execute(
        `SELECT so.offering_id, so.academic_year_id, so.semester_id,
              so.faculty_id, so.status AS offering_status, cr.department_id
         FROM subject_offerings so
         LEFT JOIN sections sec ON sec.section_id = so.section_id
         LEFT JOIN courses cr ON cr.course_id = sec.course_id
        WHERE so.offering_id = ? FOR UPDATE`,
        [offeringId],
      );
      if (
        offerings.length !== 1 ||
        Number(offerings[0].department_id) !== departmentId
      ) {
        termReviewFail(
          "TERM_REVIEW_DEPARTMENT_FORBIDDEN",
          "The submitted grade does not belong to your active department.",
          403,
        );
      }
      const [configs] = await connection.execute(
        "SELECT config_id FROM gradebook_offering_config WHERE config_id = ? AND offering_id = ? FOR UPDATE",
        [Number(target.config_id), offeringId],
      );
      if (configs.length !== 1) {
        termReviewFail(
          "TERM_REVIEW_CONFIG_INVALID",
          "The submitted gradebook configuration is missing.",
        );
      }
      const [enrollments] = await connection.execute(
        `SELECT es.enrollment_subject_id, es.offering_id, es.status,
              e.enrollment_status
         FROM enrollment_subjects es
         JOIN enrollments e ON e.enrollment_id = es.enrollment_id
        WHERE es.enrollment_subject_id = ? FOR UPDATE`,
        [Number(target.enrollment_subject_id)],
      );
      if (
        enrollments.length !== 1 ||
        Number(enrollments[0].offering_id) !== offeringId ||
        enrollments[0].status !== "Enrolled" ||
        enrollments[0].enrollment_status !== "Approved"
      ) {
        termReviewFail(
          "TERM_REVIEW_ENROLLMENT_CHANGED",
          "The student is no longer approved and enrolled in this offering. Registrar reconciliation is required.",
        );
      }
      const [existingGrades] = await connection.execute(
        "SELECT grade_id FROM grades WHERE enrollment_subject_id = ? FOR UPDATE",
        [Number(target.enrollment_subject_id)],
      );
      if (existingGrades.length) {
        termReviewFail(
          "OFFICIAL_GRADE_REQUIRES_RECONCILIATION",
          "This enrollment subject already has an official/legacy grade. Reconcile before term review.",
        );
      }
      // INC proposals and numeric term reviews cannot advance concurrently.
      const [activeIncRequests] = await connection.execute(
        `SELECT inc_request_id FROM gradebook_inc_outcome_requests
          WHERE config_id = ? AND enrollment_subject_id = ?
            AND request_status IN ('SUBMITTED', 'APPROVED')
          LIMIT 1 FOR UPDATE`,
        [Number(target.config_id), Number(target.enrollment_subject_id)],
      );
      if (activeIncRequests.length) {
        termReviewFail(
          "INC_OUTCOME_REQUEST_ACTIVE",
          "A pending or approved INC request prevents numeric term review. Resolve it through the INC workflow.",
        );
      }

      const [attempts] = await connection.execute(
        `SELECT term_submission_id, config_id, enrollment_subject_id,
              grading_term, period_id, attempt_number,
              submission_status, record_version, reviewed_by_user_id, reviewed_at,
              term_percentage_exact_numerator, term_percentage_exact_denominator,
              calculation_snapshot_json
         FROM gradebook_term_submission_attempts
        WHERE config_id = ? AND enrollment_subject_id = ? AND grading_term = ?
        ORDER BY attempt_number DESC, term_submission_id DESC
        LIMIT 1 FOR UPDATE`,
        [
          Number(target.config_id),
          Number(target.enrollment_subject_id),
          target.grading_term,
        ],
      );
      const current = attempts[0];
      if (
        !current ||
        String(current.term_submission_id) !== String(submissionId)
      ) {
        termReviewFail(
          "TERM_REVIEW_NOT_LATEST_ATTEMPT",
          "A newer submission exists. Reload the review queue.",
          409,
        );
      }
      if (Number(current.record_version) !== input.recordVersion) {
        termReviewFail(
          "TERM_REVIEW_VERSION_CONFLICT",
          "This submission was changed. Reload it before reviewing.",
          409,
        );
      }
      if (current.submission_status !== "SUBMITTED") {
        termReviewFail(
          "TERM_REVIEW_ALREADY_RESOLVED",
          "Only submissions awaiting review can be approved or returned.",
          409,
        );
      }
      if (Number(current.record_version) >= 4294967295) {
        termReviewFail(
          "TERM_REVIEW_VERSION_OVERFLOW",
          "This submission has reached the maximum allowed version.",
        );
      }
      publicationSnapshot(current);
      const [locks] = await connection.execute(
        `SELECT first_submission_id FROM gradebook_term_structure_locks
        WHERE config_id = ? AND grading_term = ? FOR UPDATE`,
        [Number(current.config_id), current.grading_term],
      );
      if (locks.length !== 1) {
        termReviewFail(
          "TERM_REVIEW_STRUCTURE_LOCK_MISSING",
          "This term has no valid first-submission structure lock.",
        );
      }
      const [updated] = await connection.execute(
        `UPDATE gradebook_term_submission_attempts
          SET submission_status = ?, reviewed_by_user_id = ?,
              reviewed_at = NOW(6), review_remarks = ?,
              record_version = record_version + 1
        WHERE term_submission_id = ? AND submission_status = 'SUBMITTED'
          AND record_version = ?`,
        [
          input.action === "APPROVE" ? "APPROVED" : "RETURNED",
          userId,
          input.remarks,
          submissionId,
          input.recordVersion,
        ],
      );
      if (Number(updated.affectedRows) !== 1) {
        termReviewFail(
          "TERM_REVIEW_VERSION_CONFLICT",
          "The submission changed during review. Reload and retry.",
          409,
        );
      }
      // Load the actual approval metadata after the DB write, before publication.
      const [reviewedRows] = await connection.execute(
        `SELECT term_submission_id, config_id, enrollment_subject_id,
              grading_term, attempt_number, submission_status, record_version,
              reviewed_by_user_id, reviewed_at,
              term_percentage_exact_numerator, term_percentage_exact_denominator,
              calculation_snapshot_json
         FROM gradebook_term_submission_attempts WHERE term_submission_id = ?`,
        [submissionId],
      );
      if (reviewedRows.length !== 1)
        throw new Error("Term review could not be reloaded.");
      const reviewed = reviewedRows[0];
      const publication =
        input.action === "APPROVE"
          ? await publishApprovedSemester(connection, {
              current: reviewed,
              offering: offerings[0],
              reviewerUserId: userId,
            })
          : null;

      const [resultRows] = await connection.execute(
        `SELECT term_submission_id, config_id, enrollment_subject_id,
              grading_term, attempt_number, submission_status, record_version,
              reviewed_by_user_id, review_remarks,
              DATE_FORMAT(reviewed_at, '%Y-%m-%d %H:%i:%s.%f') AS reviewed_at
         FROM gradebook_term_submission_attempts WHERE term_submission_id = ?`,
        [submissionId],
      );
      if (resultRows.length !== 1)
        throw new Error("Reviewed submission could not be reloaded.");
      const saved = resultRows[0];
      if (input.dryRun) await connection.rollback();
      else await connection.commit();
      inTransaction = false;
      return res.json({
        success: true,
        action: input.action,
        submission: {
          term_submission_id: String(saved.term_submission_id),
          config_id: Number(saved.config_id),
          offering_id: offeringId,
          enrollment_subject_id: Number(saved.enrollment_subject_id),
          grading_term: saved.grading_term,
          attempt_number: Number(saved.attempt_number),
          submission_status: saved.submission_status,
          record_version: Number(saved.record_version),
          reviewed_by_user_id: Number(saved.reviewed_by_user_id),
          reviewed_at: saved.reviewed_at,
          review_remarks: saved.review_remarks,
        },
        dry_run: input.dryRun,
        persisted: !input.dryRun,
        official_grade_published: !!publication && !input.dryRun,
        official_grade: publication
          ? {
              ...publication,
              grade_id: input.dryRun ? null : publication.grade_id,
              publication_id: input.dryRun ? null : publication.publication_id,
            }
          : null,
        publication_pending_reason:
          input.action === "APPROVE" && !publication
            ? "OTHER_TERM_NOT_YET_APPROVED"
            : null,
        other_term_unaffected: true,
        note: input.dryRun
          ? "Dry run only: all review and publication changes were rolled back."
          : publication
            ? "Both terms approved; official semester grade and provenance link were published atomically."
            : "Only this term was reviewed. No official grade was published.",
      });
    } catch (error) {
      if (inTransaction && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("TERM REVIEW ROLLBACK ERROR:", rollbackError);
        }
      }
      return termReviewRespondError(res, error);
    } finally {
      connection?.release();
    }
  },
);

// Step 2.8.11I — Program Head INC review (Offering #131 QA pilot)
// An INC is a documented exception, not a 50/50 numeric grade.
// Approval writes the official 4.00 grade and audit event in one transaction.

function incReviewFail(code, message, status = 409) {
  return termReviewFail(code, message, status);
}

function incReviewSendError(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
  if (status === 500) console.error("PROGRAM HEAD INC REVIEW ERROR:", error);
  return res.status(status).json({
    success: false,
    code:
      status === 500
        ? "INC_REVIEW_INTERNAL_ERROR"
        : error.code || "INC_REVIEW_FAILED",
    message:
      status === 500 ? "Could not process the INC request." : error.message,
  });
}

async function incReviewAssertProgramHead(client, req) {
  const { userId, departmentId } = await getActiveTermProgramHead(client, req);
  // Explicit account and role checks. Route-level middleware also applies.
  const [rows] = await client.execute(
    `SELECT u.is_active, u.is_archived, r.role_name
       FROM users u JOIN roles r ON r.role_id = u.role_id
      WHERE u.user_id = ?`,
    [userId],
  );
  if (
    rows.length !== 1 ||
    Number(rows[0].is_active) !== 1 ||
    Number(rows[0].is_archived) !== 0 ||
    rows[0].role_name !== "Program Head"
  ) {
    incReviewFail(
      "INC_ACTIVE_PROGRAM_HEAD_REQUIRED",
      "Only an active Program Head assigned to this department may review INC requests.",
      403,
    );
  }
  return { userId, departmentId };
}

function incReviewCheckQuery(req) {
  if (Object.keys(req.query).length !== 0) {
    incReviewFail(
      "INC_REVIEW_QUERY_UNSUPPORTED",
      "This endpoint does not accept query parameters.",
      400,
    );
  }
}

function incReviewBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    incReviewFail("INC_REVIEW_BODY_INVALID", "A JSON object is required.", 400);
  }
  const allowed = new Set([
    "action",
    "record_version",
    "review_remarks",
    "dry_run",
  ]);
  const extras = Object.keys(body).filter((key) => !allowed.has(key));
  if (extras.length) {
    incReviewFail(
      "INC_REVIEW_FIELDS_UNSUPPORTED",
      `Unsupported field(s): ${extras.join(", ")}.`,
      400,
    );
  }
  if (!["APPROVE", "RETURN", "REJECT"].includes(body.action)) {
    incReviewFail(
      "INC_REVIEW_ACTION_INVALID",
      "action must be APPROVE, RETURN, or REJECT.",
      400,
    );
  }
  if (
    !Number.isSafeInteger(body.record_version) ||
    body.record_version < 1 ||
    body.record_version > 4294967295
  ) {
    incReviewFail(
      "INC_REVIEW_VERSION_INVALID",
      "record_version must be a positive integer.",
      400,
    );
  }
  if (typeof body.dry_run !== "boolean") {
    incReviewFail(
      "INC_REVIEW_DRY_RUN_REQUIRED",
      "dry_run must be true or false.",
      400,
    );
  }
  if (
    body.review_remarks !== undefined &&
    body.review_remarks !== null &&
    typeof body.review_remarks !== "string"
  ) {
    incReviewFail(
      "INC_REVIEW_REMARKS_INVALID",
      "review_remarks must be text.",
      400,
    );
  }
  const remarks =
    typeof body.review_remarks === "string" ? body.review_remarks.trim() : "";
  if (
    remarks.length > 2000 ||
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(remarks)
  ) {
    incReviewFail(
      "INC_REVIEW_REMARKS_INVALID",
      "review_remarks must be printable text, at most 2000 characters.",
      400,
    );
  }
  if (["RETURN", "REJECT"].includes(body.action) && remarks.length < 10) {
    incReviewFail(
      "INC_REVIEW_REASON_REQUIRED",
      "RETURN and REJECT require at least 10 characters in review_remarks.",
      400,
    );
  }
  return {
    action: body.action,
    recordVersion: body.record_version,
    dryRun: body.dry_run,
    remarks: remarks || null,
  };
}

const incReviewSelect = `
    ir.inc_request_id, ir.config_id, ir.enrollment_subject_id,
    ir.request_status, ir.outcome_reason, ir.evidence_summary,
    ir.midterm_submission_id, ir.submitted_by_user_id,
    DATE_FORMAT(ir.submitted_at, '%Y-%m-%d %H:%i:%s.%f') AS submitted_at,
    ir.reviewed_by_user_id,
    DATE_FORMAT(ir.reviewed_at, '%Y-%m-%d %H:%i:%s.%f') AS reviewed_at,
    ir.review_remarks, ir.record_version,
    c.offering_id, so.academic_year_id, so.semester_id, so.status AS offering_status,
    so.faculty_id, cr.department_id,
    s.student_id, s.student_number, s.first_name, s.middle_name, s.last_name,
    g.grade_id AS current_grade_id, g.grade_status AS current_grade_status,
    g.grading_outcome AS current_grading_outcome, g.final_rating AS current_final_rating,
    es.status AS enrollment_subject_status, e.enrollment_status`;

const incReviewFrom = `
    FROM gradebook_inc_outcome_requests ir
    JOIN gradebook_offering_config c ON c.config_id = ir.config_id
    JOIN subject_offerings so ON so.offering_id = c.offering_id
    JOIN sections sec ON sec.section_id = so.section_id
    JOIN courses cr ON cr.course_id = sec.course_id
    JOIN enrollment_subjects es ON es.enrollment_subject_id = ir.enrollment_subject_id
    JOIN enrollments e ON e.enrollment_id = es.enrollment_id
    JOIN students s ON s.student_id = e.student_id
    LEFT JOIN grades g ON g.enrollment_subject_id = ir.enrollment_subject_id`;

function incReviewFormatRow(row) {
  return {
    inc_request_id: String(row.inc_request_id),
    config_id: Number(row.config_id),
    offering_id: Number(row.offering_id),
    enrollment_subject_id: Number(row.enrollment_subject_id),
    student_id: Number(row.student_id),
    student_number: row.student_number,
    student_name: [row.first_name, row.middle_name, row.last_name]
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join(" "),
    academic_year_id: Number(row.academic_year_id),
    semester_id: Number(row.semester_id),
    department_id: Number(row.department_id),
    request_status: row.request_status,
    outcome_reason: row.outcome_reason,
    evidence_summary: row.evidence_summary,
    midterm_submission_id: String(row.midterm_submission_id),
    submitted_by_user_id: Number(row.submitted_by_user_id),
    submitted_at: row.submitted_at,
    reviewed_by_user_id:
      row.reviewed_by_user_id === null ? null : Number(row.reviewed_by_user_id),
    reviewed_at: row.reviewed_at,
    review_remarks: row.review_remarks,
    record_version: Number(row.record_version),
    official_grade:
      row.current_grade_id === null
        ? null
        : {
            grade_id: Number(row.current_grade_id),
            grade_status: row.current_grade_status,
            grading_outcome: row.current_grading_outcome,
            final_rating:
              row.current_final_rating === null
                ? null
                : String(row.current_final_rating),
          },
    current_enrollment_subject_status: row.enrollment_subject_status,
    enrollment_status: row.enrollment_status,
  };
}

// GET /api/program-head/gradebook/inc-outcome-requests
// Department-scoped pending queue; optional status and academic scope filters.
router.get("/gradebook/inc-outcome-requests", async (req, res) => {
  try {
    await termReviewAssertTestDatabase(db);
    const allowed = new Set([
      "request_status",
      "academic_year_id",
      "semester_id",
    ]);
    const extras = Object.keys(req.query).filter((key) => !allowed.has(key));
    if (extras.length) {
      incReviewFail(
        "INC_REVIEW_QUERY_INVALID",
        `Unsupported query field(s): ${extras.join(", ")}.`,
        400,
      );
    }
    const requestStatus = req.query.request_status ?? "SUBMITTED";
    if (
      ![
        "SUBMITTED",
        "RETURNED",
        "APPROVED",
        "REJECTED",
        "WITHDRAWN",
        "ALL",
      ].includes(requestStatus)
    ) {
      incReviewFail(
        "INC_REVIEW_STATUS_INVALID",
        "Unsupported request_status filter.",
        400,
      );
    }
    const { userId, departmentId } = await incReviewAssertProgramHead(db, req);
    const conditions = ["cr.department_id = ?", "c.offering_id = ?"];
    const params = [departmentId, termReviewPilotOfferingId];
    if (requestStatus !== "ALL") {
      conditions.push("ir.request_status = ?");
      params.push(requestStatus);
    }
    for (const field of ["academic_year_id", "semester_id"]) {
      if (req.query[field] !== undefined) {
        const id = periodPositiveId(req.query[field]);
        if (!id)
          incReviewFail(
            "INC_REVIEW_QUERY_INVALID",
            `${field} must be a positive integer.`,
            400,
          );
        conditions.push(`so.${field} = ?`);
        params.push(id);
      }
    }
    const [rows] = await db.execute(
      `SELECT ${incReviewSelect} ${incReviewFrom}
        WHERE ${conditions.join(" AND ")}
        ORDER BY ir.submitted_at DESC, ir.inc_request_id DESC LIMIT 100`,
      params,
    );
    return res.json({
      success: true,
      read_only: true,
      department_id: departmentId,
      reviewer_user_id: userId,
      filters: {
        request_status: requestStatus,
        academic_year_id: req.query.academic_year_id ?? null,
        semester_id: req.query.semester_id ?? null,
      },
      count: rows.length,
      requests: rows.map(incReviewFormatRow),
      has_more: rows.length === 100,
    });
  } catch (error) {
    return incReviewSendError(res, error);
  }
});

// GET /api/program-head/gradebook/inc-outcome-requests/:requestId
// Includes evidence and audit history; no changes to student records.
router.get("/gradebook/inc-outcome-requests/:requestId", async (req, res) => {
  try {
    await termReviewAssertTestDatabase(db);
    incReviewCheckQuery(req);
    const requestId = periodPositiveId(req.params.requestId);
    if (!requestId)
      incReviewFail(
        "INC_REVIEW_ID_INVALID",
        "requestId must be a positive integer.",
        400,
      );
    const { departmentId } = await incReviewAssertProgramHead(db, req);
    const [rows] = await db.execute(
      `SELECT ${incReviewSelect} ${incReviewFrom}
        WHERE ir.inc_request_id = ? AND cr.department_id = ? AND c.offering_id = ?`,
      [requestId, departmentId, termReviewPilotOfferingId],
    );
    if (rows.length !== 1) {
      incReviewFail(
        "INC_REQUEST_NOT_FOUND",
        "INC request was not found in your department.",
        404,
      );
    }
    const [events] = await db.execute(
      `SELECT event_id, event_type, previous_status, new_status,
              reason_snapshot, evidence_snapshot, event_reason,
              performed_by_user_id, request_version_after,
              DATE_FORMAT(event_at, '%Y-%m-%d %H:%i:%s.%f') AS event_at
         FROM gradebook_inc_outcome_request_events
        WHERE inc_request_id = ? ORDER BY request_version_after, event_id`,
      [requestId],
    );
    const [sheets] = await db.execute(
      `SELECT sheet_id, sheet_status,
              DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_official_submitted_on,
              official_submission_reference, official_date_verified_by_user_id,
              DATE_FORMAT(official_date_verified_at, '%Y-%m-%d %H:%i:%s') AS official_date_verified_at,
              CASE WHEN original_official_submitted_on IS NOT NULL
                         AND official_date_verified_by_user_id IS NOT NULL
                         AND official_date_verified_at IS NOT NULL
                   THEN DATE_FORMAT(DATE_ADD(original_official_submitted_on, INTERVAL 1 YEAR), '%Y-%m-%d')
                   ELSE NULL END AS inc_completion_deadline_on
         FROM gradebook_official_sheets WHERE config_id = ?`,
      [Number(rows[0].config_id)],
    );
    if (sheets.length > 1)
      incReviewFail(
        "INC_OFFICIAL_SHEET_INVALID",
        "Duplicate grading sheets found.",
      );
    return res.json({
      success: true,
      read_only: true,
      request: incReviewFormatRow(rows[0]),
      audit_events: events.map((e) => ({ ...e, event_id: String(e.event_id) })),
      official_sheet: sheets[0]
        ? {
            ...sheets[0],
            sheet_id: String(sheets[0].sheet_id),
            deadline_established: sheets[0].inc_completion_deadline_on !== null,
          }
        : {
            sheet_id: null,
            inc_completion_deadline_on: null,
            deadline_established: false,
          },
    });
  } catch (error) {
    return incReviewSendError(res, error);
  }
});

// POST /api/program-head/gradebook/inc-outcome-requests/:requestId/review
// Versioned APPROVE / RETURN / REJECT; all review writes and publication are atomic.
router.post(
  "/gradebook/inc-outcome-requests/:requestId/review",
  async (req, res) => {
    let connection;
    let inTransaction = false;
    try {
      incReviewCheckQuery(req);
      const requestId = periodPositiveId(req.params.requestId);
      if (!requestId)
        incReviewFail(
          "INC_REVIEW_ID_INVALID",
          "requestId must be a positive integer.",
          400,
        );
      const input = incReviewBody(req.body);
      connection = await db.getConnection();
      await connection.beginTransaction();
      inTransaction = true;
      // Keep legacy review writes in QA.
      await assertQaGradingDatabase(connection);
      await termReviewAssertTestDatabase(connection);
      const { userId, departmentId } = await incReviewAssertProgramHead(
        connection,
        req,
      );

      // Probe without locking, then use the same offering → config → enrollment
      // lock order as Faculty score/term/INC writers.
      const [targets] = await connection.execute(
        `SELECT ir.config_id, ir.enrollment_subject_id, c.offering_id
         FROM gradebook_inc_outcome_requests ir
         JOIN gradebook_offering_config c ON c.config_id = ir.config_id
        WHERE ir.inc_request_id = ?`,
        [requestId],
      );
      if (targets.length !== 1) {
        incReviewFail(
          "INC_REQUEST_NOT_FOUND",
          "INC request was not found.",
          404,
        );
      }
      const target = targets[0];
      const offeringId = Number(target.offering_id);
      if (offeringId !== termReviewPilotOfferingId) {
        incReviewFail(
          "INC_REVIEW_TEST_OFFERING_ONLY",
          "Only QA Offering #131 can be reviewed in this pilot.",
          403,
        );
      }
      const configId = Number(target.config_id);
      const enrollmentSubjectId = Number(target.enrollment_subject_id);
      const [offerings] = await connection.execute(
        `SELECT so.offering_id, so.status AS offering_status, so.faculty_id,
              so.academic_year_id, so.semester_id, cr.department_id,
              f.user_id AS assigned_instructor_user_id,
              u.is_active AS instructor_active, u.is_archived AS instructor_archived,
              r.role_name AS instructor_role
         FROM subject_offerings so
         LEFT JOIN sections sec ON sec.section_id = so.section_id
         LEFT JOIN courses cr ON cr.course_id = sec.course_id
         LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
         LEFT JOIN users u ON u.user_id = f.user_id
         LEFT JOIN roles r ON r.role_id = u.role_id
        WHERE so.offering_id = ? FOR UPDATE`,
        [offeringId],
      );
      if (
        offerings.length !== 1 ||
        Number(offerings[0].department_id) !== departmentId
      ) {
        incReviewFail(
          "INC_REVIEW_DEPARTMENT_FORBIDDEN",
          "This INC request is outside your active department.",
          403,
        );
      }
      const offering = offerings[0];
      if (offering.offering_status === "Cancelled") {
        incReviewFail(
          "INC_OFFERING_CANCELLED",
          "A cancelled offering cannot publish an INC grade.",
        );
      }
      if (
        !periodPositiveId(offering.faculty_id) ||
        Number(offering.instructor_active) !== 1 ||
        Number(offering.instructor_archived) !== 0 ||
        !["Faculty", "Program Head"].includes(offering.instructor_role)
      ) {
        incReviewFail(
          "INC_INSTRUCTOR_UNAVAILABLE",
          "The assigned instructor is no longer an active Faculty/Program Head account.",
        );
      }
      const [configs] = await connection.execute(
        `SELECT config_id, offering_id, grading_classification,
              midterm_percent, final_term_percent
         FROM gradebook_offering_config WHERE config_id = ? AND offering_id = ? FOR UPDATE`,
        [configId, offeringId],
      );
      if (
        configs.length !== 1 ||
        Number(configs[0].midterm_percent) !== 50 ||
        Number(configs[0].final_term_percent) !== 50 ||
        !["PURE_LECTURE", "WITH_LABORATORY"].includes(
          configs[0].grading_classification,
        )
      ) {
        incReviewFail(
          "INC_GRADEBOOK_CONFIG_INVALID",
          "The official two-term gradebook configuration is invalid.",
        );
      }
      const [enrollments] = await connection.execute(
        `SELECT es.enrollment_subject_id, es.offering_id, es.status, e.enrollment_status
         FROM enrollment_subjects es
         JOIN enrollments e ON e.enrollment_id = es.enrollment_id
        WHERE es.enrollment_subject_id = ? FOR UPDATE`,
        [enrollmentSubjectId],
      );
      if (
        enrollments.length !== 1 ||
        Number(enrollments[0].offering_id) !== offeringId ||
        enrollments[0].status !== "Enrolled" ||
        enrollments[0].enrollment_status !== "Approved"
      ) {
        incReviewFail(
          "INC_REVIEW_ENROLLMENT_CHANGED",
          "The student's approved enrollment has changed; Registrar review is required.",
        );
      }
      const [grades] = await connection.execute(
        `SELECT grade_id FROM grades WHERE enrollment_subject_id = ? FOR UPDATE`,
        [enrollmentSubjectId],
      );
      if (grades.length) {
        incReviewFail(
          "OFFICIAL_GRADE_REQUIRES_RECONCILIATION",
          "An official grade already exists for this student and offering.",
        );
      }
      // Lock term histories before the INC request, matching Faculty submission writes.
      const latest = {};
      for (const term of ["MIDTERM", "FINAL_TERM"]) {
        const [rows] = await connection.execute(
          `SELECT term_submission_id, config_id, enrollment_subject_id,
                grading_term, submission_status, record_version,
                reviewed_by_user_id, reviewed_at,
                term_percentage_exact_numerator, term_percentage_exact_denominator,
                calculation_snapshot_json
           FROM gradebook_term_submission_attempts
          WHERE config_id = ? AND enrollment_subject_id = ? AND grading_term = ?
          ORDER BY attempt_number DESC, term_submission_id DESC LIMIT 1 FOR UPDATE`,
          [configId, enrollmentSubjectId, term],
        );
        latest[term] = rows[0] ?? null;
      }
      const [requests] = await connection.execute(
        `SELECT inc_request_id, config_id, enrollment_subject_id,
              request_status, record_version, outcome_reason, evidence_summary,
              midterm_submission_id, submitted_by_user_id
         FROM gradebook_inc_outcome_requests
        WHERE config_id = ? AND enrollment_subject_id = ? FOR UPDATE`,
        [configId, enrollmentSubjectId],
      );
      if (
        requests.length !== 1 ||
        String(requests[0].inc_request_id) !== String(requestId)
      ) {
        incReviewFail(
          "INC_REVIEW_REQUEST_CHANGED",
          "The INC request changed. Reload the review queue.",
        );
      }
      const current = requests[0];
      if (Number(current.record_version) !== input.recordVersion) {
        incReviewFail(
          "INC_REVIEW_VERSION_CONFLICT",
          "INC request version changed. Reload before reviewing.",
        );
      }
      if (current.request_status !== "SUBMITTED") {
        incReviewFail(
          "INC_REVIEW_ALREADY_RESOLVED",
          "Only submitted INC requests can be reviewed.",
        );
      }
      if (Number(current.record_version) >= 4294967295) {
        incReviewFail(
          "INC_REVIEW_VERSION_OVERFLOW",
          "INC request has reached its maximum record version.",
        );
      }
      if (
        !current.outcome_reason?.trim() ||
        !current.evidence_summary?.trim()
      ) {
        incReviewFail(
          "INC_REVIEW_DOCUMENTATION_MISSING",
          "An INC reason and evidence summary are required.",
        );
      }
      const mid = latest.MIDTERM;
      if (
        !mid ||
        mid.grading_term !== "MIDTERM" ||
        mid.submission_status !== "APPROVED" ||
        mid.reviewed_by_user_id === null ||
        mid.reviewed_at === null ||
        String(mid.term_submission_id) !==
          String(current.midterm_submission_id) ||
        Number(mid.config_id) !== configId ||
        Number(mid.enrollment_subject_id) !== enrollmentSubjectId
      ) {
        incReviewFail(
          "INC_MIDTERM_APPROVAL_CHANGED",
          "The approved Midterm is missing or no longer matches this INC request.",
        );
      }
      if (latest.FINAL_TERM !== null) {
        incReviewFail(
          "INC_FINAL_TERM_ATTEMPT_CONFLICT",
          "A numeric Final Term submission already exists.",
        );
      }
      if (
        Number(offering.assigned_instructor_user_id) !==
        Number(current.submitted_by_user_id)
      ) {
        incReviewFail(
          "INC_FACULTY_ASSIGNMENT_CHANGED",
          "The INC request was filed by a different instructor; Registrar reconciliation is required.",
        );
      }
      const [structureLocks] = await connection.execute(
        `SELECT first_submission_id FROM gradebook_term_structure_locks
        WHERE config_id = ? AND grading_term = 'MIDTERM' FOR UPDATE`,
        [configId],
      );
      if (structureLocks.length !== 1) {
        incReviewFail(
          "INC_MIDTERM_LOCK_MISSING",
          "The approved Midterm has no structure lock.",
        );
      }
      // Validate the stored MIDTERM snapshot against the exact rational source.
      const exactMidterm = publicationSnapshot(mid);
      const midtermDecimal = publicationDecimal12(
        exactMidterm.numerator,
        exactMidterm.denominator,
      );

      const status =
        input.action === "APPROVE"
          ? "APPROVED"
          : input.action === "RETURN"
            ? "RETURNED"
            : "REJECTED";
      const [updated] = await connection.execute(
        `UPDATE gradebook_inc_outcome_requests
          SET request_status = ?, reviewed_by_user_id = ?, reviewed_at = NOW(6),
              review_remarks = ?, record_version = record_version + 1
        WHERE inc_request_id = ? AND request_status = 'SUBMITTED' AND record_version = ?`,
        [status, userId, input.remarks, requestId, input.recordVersion],
      );
      if (Number(updated.affectedRows) !== 1) {
        incReviewFail(
          "INC_REVIEW_VERSION_CONFLICT",
          "INC request changed during review. Reload and retry.",
        );
      }
      const nextVersion = input.recordVersion + 1;
      const [audit] = await connection.execute(
        `INSERT INTO gradebook_inc_outcome_request_events
          (inc_request_id, event_type, previous_status, new_status,
           reason_snapshot, evidence_snapshot, event_reason,
           performed_by_user_id, request_version_after)
        VALUES (?, ?, 'SUBMITTED', ?, ?, ?, ?, ?, ?)`,
        [
          requestId,
          status,
          status,
          current.outcome_reason,
          current.evidence_summary,
          input.remarks,
          userId,
          nextVersion,
        ],
      );
      if (Number(audit.affectedRows) !== 1) {
        throw new Error("INC review audit event was not created.");
      }

      let officialGrade = null;
      if (input.action === "APPROVE") {
        // Draft → Submitted → Approved uses the existing grades triggers.
        // A null Final Term means no ordinary semester percentage is fabricated.
        const [insert] = await connection.execute(
          `INSERT INTO grades
           (enrollment_subject_id, faculty_id, midterm_grade, final_grade,
            grading_policy, grading_outcome, outcome_reason, grade_status)
         VALUES (?, ?, ?, NULL, 'TWO_TERM_50_50', 'INCOMPLETE', ?, 'Draft')`,
          [
            enrollmentSubjectId,
            Number(offering.faculty_id),
            midtermDecimal,
            current.outcome_reason,
          ],
        );
        if (
          Number(insert.affectedRows) !== 1 ||
          !periodPositiveId(insert.insertId)
        ) {
          throw new Error("INC official grade insert failed.");
        }
        const gradeId = Number(insert.insertId);
        const [submitted] = await connection.execute(
          `UPDATE grades SET grade_status = 'Submitted'
          WHERE grade_id = ? AND grade_status = 'Draft'`,
          [gradeId],
        );
        if (Number(submitted.affectedRows) !== 1) {
          incReviewFail(
            "INC_GRADE_SUBMISSION_FAILED",
            "Could not submit the official INC grade.",
          );
        }
        const [approved] = await connection.execute(
          `UPDATE grades SET grade_status = 'Approved', reviewed_by = ?
          WHERE grade_id = ? AND grade_status = 'Submitted'`,
          [userId, gradeId],
        );
        if (Number(approved.affectedRows) !== 1) {
          incReviewFail(
            "INC_GRADE_APPROVAL_FAILED",
            "Could not approve the official INC grade.",
          );
        }
        const [verified] = await connection.execute(
          `SELECT grade_id, enrollment_subject_id, midterm_grade, final_grade,
                overall_percentage, final_rating, remarks, grading_policy,
                grading_outcome, outcome_reason, grade_status, reviewed_by
           FROM grades WHERE grade_id = ? FOR UPDATE`,
          [gradeId],
        );
        const [subjectRows] = await connection.execute(
          `SELECT status FROM enrollment_subjects WHERE enrollment_subject_id = ?`,
          [enrollmentSubjectId],
        );
        const grade = verified[0];
        if (
          !grade ||
          Number(grade.enrollment_subject_id) !== enrollmentSubjectId ||
          String(grade.midterm_grade) !== midtermDecimal ||
          grade.final_grade !== null ||
          grade.overall_percentage !== null ||
          Number(grade.final_rating).toFixed(2) !== "4.00" ||
          grade.remarks !== "Incomplete" ||
          grade.grading_policy !== "TWO_TERM_50_50" ||
          grade.grading_outcome !== "INCOMPLETE" ||
          grade.outcome_reason !== current.outcome_reason ||
          grade.grade_status !== "Approved" ||
          Number(grade.reviewed_by) !== userId ||
          subjectRows[0]?.status !== "Incomplete"
        ) {
          incReviewFail(
            "INC_OFFICIAL_GRADE_INTEGRITY_MISMATCH",
            "INC grade or student subject status did not match the approved request. All changes were rolled back.",
          );
        }
        officialGrade = {
          grade_id: input.dryRun ? null : gradeId,
          enrollment_subject_id: enrollmentSubjectId,
          grading_outcome: "INCOMPLETE",
          grade_status: "Approved",
          midterm_grade: midtermDecimal,
          final_grade: null,
          overall_percentage: null,
          final_rating: "4.00",
          remarks: "Incomplete",
          enrollment_subject_status: "Incomplete",
        };
      }
      if (input.dryRun) await connection.rollback();
      else await connection.commit();
      inTransaction = false;
      return res.json({
        success: true,
        action: input.action,
        inc_request: {
          inc_request_id: String(requestId),
          config_id: configId,
          offering_id: offeringId,
          enrollment_subject_id: enrollmentSubjectId,
          request_status: status,
          record_version: nextVersion,
          reviewed_by_user_id: userId,
          review_remarks: input.remarks,
          midterm_submission_id: String(mid.term_submission_id),
        },
        audit_event: status,
        audit_event_id: input.dryRun ? null : String(audit.insertId),
        dry_run: input.dryRun,
        persisted: !input.dryRun,
        official_grade_published: input.action === "APPROVE" && !input.dryRun,
        official_grade: officialGrade,
        inc_completion_deadline_on: null,
        completion_deadline_established: false,
        note: input.dryRun
          ? "INC review dry run rolled back; no request status or official grade was changed."
          : input.action === "APPROVE"
            ? "Official 4.00 INC published; the one-year deadline remains unset until the original official grading-sheet submission date is verified."
            : "INC review saved without publishing an official grade.",
      });
    } catch (error) {
      if (inTransaction && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("INC REVIEW ROLLBACK ERROR:", rollbackError);
        }
      }
      return incReviewSendError(res, error);
    } finally {
      connection?.release();
    }
  },
);

router.post(
  "/gradebook/inc-completion-term-submissions/:submissionId/review",
  async (req, res) => {
    let connection;
    let inTransaction = false;
    try {
      if (Object.keys(req.query).length !== 0) {
        termReviewFail(
          "INC_TERM_REVIEW_QUERY_INVALID",
          "Query parameters are not supported.",
          400,
        );
      }
      const submissionId = periodPositiveId(req.params.submissionId);
      if (!submissionId) {
        termReviewFail(
          "INC_TERM_REVIEW_ID_INVALID",
          "A valid submission ID is required.",
          400,
        );
      }
      // Reuse the existing APPROVE/RETURN + optimistic-version validator.
      const input = termReviewBody(req.body);
      if (
        typeof req.body.dry_run !== "boolean" ||
        !input.remarks ||
        input.remarks.length < 15
      ) {
        termReviewFail(
          "INC_TERM_REVIEW_DOCUMENTATION_REQUIRED",
          "Provide dry_run true/false and at least 15 characters of review_remarks.",
          400,
        );
      }

      connection = await db.getConnection();
      await connection.beginTransaction();
      inTransaction = true;
      await assertQaGradingDatabase(connection);
      await termReviewAssertTestDatabase(connection);
      const { userId, departmentId } = await getActiveTermProgramHead(
        connection,
        req,
      );

      // Determine scope first; lock offering → config → enrollment → grade,
      // matching the Faculty INC score/submission writers.
      const [candidates] = await connection.execute(
        `SELECT a.config_id, a.enrollment_subject_id, a.grading_term, c.offering_id
           FROM gradebook_term_submission_attempts a
           JOIN gradebook_offering_config c ON c.config_id = a.config_id
          WHERE a.term_submission_id = ?`,
        [submissionId],
      );
      if (candidates.length !== 1) {
        termReviewFail(
          "INC_TERM_REVIEW_NOT_FOUND",
          "INC term submission not found.",
          404,
        );
      }
      const target = candidates[0];
      const offeringId = Number(target.offering_id);
      const configId = Number(target.config_id);
      const enrollmentSubjectId = Number(target.enrollment_subject_id);
      if (
        offeringId !== termReviewPilotOfferingId ||
        target.grading_term !== "FINAL_TERM"
      ) {
        termReviewFail(
          "INC_TERM_REVIEW_QA_SCOPE_ONLY",
          "Only Final Term submissions for QA Offering #131 are supported.",
          403,
        );
      }
      const [offerings] = await connection.execute(
        `SELECT so.offering_id, so.faculty_id, so.status,
                so.academic_year_id, so.semester_id, cr.department_id,
                f.user_id AS instructor_user_id
           FROM subject_offerings so
           JOIN sections sec ON sec.section_id = so.section_id
           JOIN courses cr ON cr.course_id = sec.course_id
           JOIN faculty f ON f.faculty_id = so.faculty_id
          WHERE so.offering_id = ? FOR UPDATE`,
        [offeringId],
      );
      const offering = offerings[0];
      if (
        offerings.length !== 1 ||
        Number(offering.department_id) !== departmentId ||
        offering.status === "Cancelled"
      ) {
        termReviewFail(
          "INC_TERM_REVIEW_DEPARTMENT_FORBIDDEN",
          "The submission is outside your active department or offering is cancelled.",
          403,
        );
      }
      const [configs] = await connection.execute(
        `SELECT config_id FROM gradebook_offering_config
          WHERE config_id = ? AND offering_id = ? FOR UPDATE`,
        [configId, offeringId],
      );
      if (configs.length !== 1) {
        termReviewFail(
          "INC_TERM_REVIEW_CONFIG_CHANGED",
          "Gradebook configuration changed.",
        );
      }
      const [enrollments] = await connection.execute(
        `SELECT es.status AS subject_status, e.enrollment_status
           FROM enrollment_subjects es
           JOIN enrollments e ON e.enrollment_id = es.enrollment_id
          WHERE es.enrollment_subject_id = ? AND es.offering_id = ? FOR UPDATE`,
        [enrollmentSubjectId, offeringId],
      );
      if (
        enrollments.length !== 1 ||
        enrollments[0].subject_status !== "Incomplete" ||
        enrollments[0].enrollment_status !== "Approved"
      ) {
        termReviewFail(
          "INC_TERM_REVIEW_ENROLLMENT_CHANGED",
          "The student must still have an approved enrollment and Incomplete subject.",
        );
      }
      const [grades] = await connection.execute(
        `SELECT grade_id, grade_status, grading_policy, grading_outcome,
                final_rating, remarks, faculty_id
           FROM grades WHERE enrollment_subject_id = ? FOR UPDATE`,
        [enrollmentSubjectId],
      );
      const grade = grades[0];
      if (
        grades.length !== 1 ||
        grade.grade_status !== "Approved" ||
        grade.grading_policy !== "TWO_TERM_50_50" ||
        grade.grading_outcome !== "INCOMPLETE" ||
        Number(grade.final_rating) !== 4 ||
        grade.remarks !== "Incomplete" ||
        Number(grade.faculty_id) !== Number(offering.faculty_id)
      ) {
        termReviewFail(
          "INC_TERM_REVIEW_OFFICIAL_GRADE_CHANGED",
          "Original Approved INC 4.00 grade no longer matches the offering.",
        );
      }
      const gradeId = Number(grade.grade_id);

      const [outcomes] = await connection.execute(
        `SELECT request_status, midterm_submission_id
           FROM gradebook_inc_outcome_requests
          WHERE config_id = ? AND enrollment_subject_id = ? FOR UPDATE`,
        [configId, enrollmentSubjectId],
      );
      if (outcomes.length !== 1 || outcomes[0].request_status !== "APPROVED") {
        termReviewFail(
          "INC_TERM_REVIEW_ORIGINAL_INC_UNAPPROVED",
          "The original INC outcome must still be Program Head-approved.",
        );
      }
      const [sheets] = await connection.execute(
        `SELECT sheet_id,
                DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_on,
                official_submission_reference, official_date_verified_by_user_id,
                official_date_verified_at,
                DATE_FORMAT(DATE_ADD(original_official_submitted_on, INTERVAL 1 YEAR), '%Y-%m-%d') AS deadline_on
           FROM gradebook_official_sheets WHERE config_id = ? FOR UPDATE`,
        [configId],
      );
      const sheet = sheets[0];
      if (
        sheets.length !== 1 ||
        !sheet.original_on ||
        !sheet.deadline_on ||
        !String(sheet.official_submission_reference ?? "").trim() ||
        !sheet.official_date_verified_by_user_id ||
        !sheet.official_date_verified_at
      ) {
        termReviewFail(
          "INC_TERM_REVIEW_SHEET_UNVERIFIED",
          "Registrar must verify the actual original official-sheet date.",
        );
      }
      const [claims] = await connection.execute(
        `SELECT claim_id, grade_change_request_id, verification_status,
                DATE_FORMAT(verified_completed_on, '%Y-%m-%d') AS completed_on,
                submitted_by_user_id, verified_by_user_id, verified_at,
                evidence_summary, verification_remarks, record_version
           FROM gradebook_inc_completion_claims WHERE grade_id = ? FOR UPDATE`,
        [gradeId],
      );
      const claim = claims[0];
      if (
        claims.length !== 1 ||
        claim.grade_change_request_id !== null ||
        claim.verification_status !== "VERIFIED_TIMELY" ||
        !claim.completed_on ||
        claim.completed_on > sheet.deadline_on ||
        !claim.verified_by_user_id ||
        !claim.verified_at ||
        !String(claim.evidence_summary ?? "").trim() ||
        !String(claim.verification_remarks ?? "").trim() ||
        Number(claim.submitted_by_user_id) !==
          Number(offering.instructor_user_id)
      ) {
        termReviewFail(
          "INC_TERM_REVIEW_CLAIM_INVALID",
          "A consistent and timely verified Faculty claim is required.",
        );
      }

      // Verify the signed source trail, rather than trusting the current status alone.
      const [sheetEvents] = await connection.execute(
        `SELECT event_type, record_version_after,
                DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_on,
                official_submission_reference, performed_by_user_id
           FROM gradebook_official_sheet_submission_events
          WHERE sheet_id = ? ORDER BY record_version_after`,
        [String(sheet.sheet_id)],
      );
      if (
        sheetEvents.length !== 2 ||
        sheetEvents[0].event_type !== "RECORDED" ||
        sheetEvents[1].event_type !== "VERIFIED" ||
        Number(sheetEvents[0].record_version_after) !== 1 ||
        Number(sheetEvents[1].record_version_after) !== 2 ||
        sheetEvents.some(
          (event) =>
            event.original_on !== sheet.original_on ||
            event.official_submission_reference !==
              sheet.official_submission_reference,
        ) ||
        Number(sheetEvents[1].performed_by_user_id) !==
          Number(sheet.official_date_verified_by_user_id)
      ) {
        termReviewFail(
          "INC_TERM_REVIEW_SHEET_AUDIT_MISMATCH",
          "Official-sheet evidence is inconsistent with its audit history.",
        );
      }
      const [claimEvents] = await connection.execute(
        `SELECT event_type, new_status, claim_version_after,
                performed_by_user_id,
                DATE_FORMAT(new_verified_completed_on, '%Y-%m-%d') AS completed_on
           FROM gradebook_inc_completion_claim_events
          WHERE claim_id = ? ORDER BY claim_version_after`,
        [String(claim.claim_id)],
      );
      const lastClaimEvent = claimEvents.at(-1);
      if (
        claimEvents[0]?.event_type !== "CREATED" ||
        claimEvents.length !== Number(claim.record_version) ||
        !claimEvents.every(
          (event, i) => Number(event.claim_version_after) === i + 1,
        ) ||
        lastClaimEvent?.event_type !== "VERIFIED" ||
        lastClaimEvent.new_status !== "VERIFIED_TIMELY" ||
        lastClaimEvent.completed_on !== claim.completed_on ||
        Number(lastClaimEvent.performed_by_user_id) !==
          Number(claim.verified_by_user_id)
      ) {
        termReviewFail(
          "INC_TERM_REVIEW_CLAIM_AUDIT_MISMATCH",
          "Verified completion claim and audit history disagree.",
        );
      }
      const [activeChanges] = await connection.execute(
        `SELECT grade_change_request_id FROM grade_change_requests
          WHERE grade_id = ? AND request_type = 'INC_COMPLETION'
            AND status IN ('Pending Program Head', 'For Registrar Processing')
          LIMIT 1 FOR UPDATE`,
        [gradeId],
      );
      if (activeChanges.length) {
        termReviewFail(
          "INC_TERM_REVIEW_CHANGE_REQUEST_ACTIVE",
          "A grade-change request has already started. Further term review is locked.",
        );
      }

      const [midterms] = await connection.execute(
        `SELECT term_submission_id, config_id, enrollment_subject_id,
                grading_term, submission_status, reviewed_by_user_id, reviewed_at,
                term_percentage_exact_numerator, term_percentage_exact_denominator,
                calculation_snapshot_json
           FROM gradebook_term_submission_attempts
          WHERE config_id = ? AND enrollment_subject_id = ? AND grading_term = 'MIDTERM'
          ORDER BY attempt_number DESC, term_submission_id DESC
          LIMIT 1 FOR UPDATE`,
        [configId, enrollmentSubjectId],
      );
      const midterm = midterms[0];
      if (
        midterms.length !== 1 ||
        midterm.submission_status !== "APPROVED" ||
        !midterm.reviewed_by_user_id ||
        !midterm.reviewed_at ||
        String(midterm.term_submission_id) !==
          String(outcomes[0].midterm_submission_id)
      ) {
        termReviewFail(
          "INC_TERM_REVIEW_MIDTERM_CHANGED",
          "Original Midterm approval changed.",
        );
      }
      publicationSnapshot(midterm);

      const [finals] = await connection.execute(
        `SELECT term_submission_id, config_id, enrollment_subject_id,
                grading_term, period_id, attempt_number, submission_status,
                record_version, submitted_by_user_id, reviewed_by_user_id, reviewed_at,
                term_percentage_exact_numerator, term_percentage_exact_denominator,
                calculation_snapshot_json
           FROM gradebook_term_submission_attempts
          WHERE config_id = ? AND enrollment_subject_id = ? AND grading_term = 'FINAL_TERM'
          ORDER BY attempt_number DESC, term_submission_id DESC
          LIMIT 1 FOR UPDATE`,
        [configId, enrollmentSubjectId],
      );
      const current = finals[0];
      if (
        !current ||
        String(current.term_submission_id) !== String(submissionId) ||
        current.submission_status !== "SUBMITTED" ||
        Number(current.record_version) !== input.recordVersion ||
        current.reviewed_by_user_id !== null ||
        current.reviewed_at !== null ||
        Number(current.submitted_by_user_id) !==
          Number(offering.instructor_user_id)
      ) {
        termReviewFail(
          "INC_TERM_REVIEW_STALE_SUBMISSION",
          "Only the latest unreviewed Faculty INC Final Term submission can be reviewed.",
        );
      }
      if (Number(current.record_version) >= 4294967295) {
        termReviewFail(
          "INC_TERM_REVIEW_VERSION_OVERFLOW",
          "Submission record version exhausted.",
        );
      }
      publicationSnapshot(current);
      let snapshot = current.calculation_snapshot_json;
      if (Buffer.isBuffer(snapshot)) snapshot = snapshot.toString("utf8");
      if (typeof snapshot === "string") {
        try {
          snapshot = JSON.parse(snapshot);
        } catch {
          termReviewFail(
            "INC_TERM_REVIEW_SNAPSHOT_INVALID",
            "Invalid stored calculation snapshot.",
          );
        }
      }
      if (
        snapshot?.submission_context !== "INC_COMPLETION_FINAL_TERM" ||
        String(snapshot.inc_completion_claim_id) !== String(claim.claim_id) ||
        Number(snapshot.inc_completion_claim_version) !==
          Number(claim.record_version) ||
        Number(snapshot.original_inc_grade_id) !== gradeId ||
        String(snapshot.official_sheet_id) !== String(sheet.sheet_id) ||
        snapshot.verified_completed_on !== claim.completed_on ||
        Number(snapshot.offering_id) !== offeringId ||
        Number(snapshot.department_id) !== departmentId ||
        snapshot.policy !== "TWO_TERM_50_50"
      ) {
        termReviewFail(
          "INC_TERM_REVIEW_SNAPSHOT_SCOPE_INVALID",
          "The saved INC calculation snapshot does not match the verified evidence.",
        );
      }
      const [structure] = await connection.execute(
        `SELECT first_submission_id FROM gradebook_term_structure_locks
          WHERE config_id = ? AND grading_term = 'FINAL_TERM' FOR UPDATE`,
        [configId],
      );
      if (structure.length !== 1) {
        termReviewFail(
          "INC_TERM_REVIEW_STRUCTURE_LOCK_MISSING",
          "Final Term grading structure is not locked by a valid submission.",
        );
      }

      const [updated] = await connection.execute(
        `UPDATE gradebook_term_submission_attempts
            SET submission_status = ?, reviewed_by_user_id = ?, reviewed_at = NOW(6),
                review_remarks = ?, record_version = record_version + 1
          WHERE term_submission_id = ? AND record_version = ?
            AND submission_status = 'SUBMITTED'`,
        [
          input.action === "APPROVE" ? "APPROVED" : "RETURNED",
          userId,
          input.remarks,
          submissionId,
          input.recordVersion,
        ],
      );
      if (Number(updated.affectedRows) !== 1) {
        termReviewFail(
          "INC_TERM_REVIEW_CONFLICT",
          "Submission was reviewed concurrently.",
          409,
        );
      }
      if (input.dryRun) await connection.rollback();
      else await connection.commit();
      inTransaction = false;

      return res.json({
        success: true,
        dry_run: input.dryRun,
        persisted: !input.dryRun,
        action: input.action,
        submission_context: "INC_COMPLETION_FINAL_TERM",
        term_submission_id: String(submissionId),
        submission_status: input.action === "APPROVE" ? "APPROVED" : "RETURNED",
        record_version: input.recordVersion + 1,
        reviewed_by_user_id: userId,
        claim_id: String(claim.claim_id),
        original_inc_grade_id: gradeId,
        official_grade_unchanged: true,
        official_grade_published: false,
        registrar_conversion_enabled: false,
        next_step:
          input.action === "APPROVE"
            ? "Create and approve an authorized replacement-grade change request before Registrar conversion."
            : "Faculty may correct and resubmit this student's Final Term.",
      });
    } catch (error) {
      if (inTransaction && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("INC TERM REVIEW ROLLBACK ERROR:", rollbackError);
        }
      }
      return termReviewRespondError(res, error);
    } finally {
      connection?.release();
    }
  },
);

function udReviewFail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function udReviewError(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
  if (status === 500) console.error("PROGRAM HEAD UD REVIEW:", error);
  return res.status(status).json({
    success: false,
    code: status === 500 ? "UD_REVIEW_INTERNAL_ERROR" : error.code,
    message:
      status === 500 ? "Could not review the UD request." : error.message,
  });
}

// GET /api/program-head/gradebook/ud-outcome-requests
// Department-scoped pending/reviewed requests for the future Program Head UI.
router.get("/gradebook/ud-outcome-requests", async (req, res) => {
  let connection;
  try {
    if (Object.keys(req.query ?? {}).length) {
      udReviewFail(
        "UD_REVIEW_QUERY_UNSUPPORTED",
        "Query filters are not supported yet.",
        400,
      );
    }
    connection = await db.getConnection();
    await termReviewAssertTestDatabase(connection);
    const { departmentId } = await incReviewAssertProgramHead(connection, req);
    const [rows] = await connection.execute(
      `SELECT ur.ud_request_id, ur.config_id, ur.enrollment_subject_id,
              ur.request_status, ur.outcome_reason, ur.evidence_summary,
              ur.attendance_snapshot_json, ur.record_version,
              ur.submitted_by_user_id, ur.submitted_at,
              ur.reviewed_by_user_id, ur.reviewed_at, ur.review_remarks,
              s.student_number, so.offering_id
         FROM gradebook_ud_outcome_requests ur
         JOIN gradebook_offering_config cfg ON cfg.config_id = ur.config_id
         JOIN subject_offerings so ON so.offering_id = cfg.offering_id
         JOIN sections sec ON sec.section_id = so.section_id
         JOIN courses cr ON cr.course_id = sec.course_id
         JOIN enrollment_subjects es ON es.enrollment_subject_id = ur.enrollment_subject_id
         JOIN enrollments e ON e.enrollment_id = es.enrollment_id
         JOIN students s ON s.student_id = e.student_id
        WHERE cr.department_id = ? AND so.offering_id = 131
          AND es.offering_id = so.offering_id
        ORDER BY (ur.request_status = 'SUBMITTED') DESC,
                 ur.updated_at DESC, ur.ud_request_id DESC LIMIT 100`,
      [departmentId],
    );
    return res.json({
      success: true,
      read_only: true,
      requests: rows.map((r) => ({
        ud_request_id: String(r.ud_request_id),
        config_id: Number(r.config_id),
        offering_id: Number(r.offering_id),
        enrollment_subject_id: Number(r.enrollment_subject_id),
        student_number: r.student_number,
        request_status: r.request_status,
        record_version: Number(r.record_version),
        outcome_reason: r.outcome_reason,
        evidence_summary: r.evidence_summary,
        attendance_snapshot:
          typeof r.attendance_snapshot_json === "string"
            ? JSON.parse(r.attendance_snapshot_json)
            : r.attendance_snapshot_json,
        submitted_by_user_id: Number(r.submitted_by_user_id),
        submitted_at: r.submitted_at,
        reviewed_by_user_id:
          r.reviewed_by_user_id === null ? null : Number(r.reviewed_by_user_id),
        reviewed_at: r.reviewed_at,
        review_remarks: r.review_remarks,
      })),
      official_grades_unchanged: true,
    });
  } catch (error) {
    return udReviewError(res, error);
  } finally {
    connection?.release();
  }
});

// POST /api/program-head/gradebook/ud-outcome-requests/:requestId/review
// Actions: APPROVE, RETURN, REJECT. Only request + audit rows change.
router.post(
  "/gradebook/ud-outcome-requests/:requestId/review",
  async (req, res) => {
    let connection;
    let inTransaction = false;
    try {
      if (Object.keys(req.query ?? {}).length) {
        udReviewFail(
          "UD_REVIEW_QUERY_UNSUPPORTED",
          "Query parameters are not supported.",
          400,
        );
      }
      const requestId = periodPositiveId(req.params.requestId);
      if (!requestId)
        udReviewFail("UD_REVIEW_ID_INVALID", "Invalid UD request ID.", 400);
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        udReviewFail(
          "UD_REVIEW_BODY_INVALID",
          "A JSON object is required.",
          400,
        );
      }
      const allowed = new Set([
        "action",
        "expected_request_version",
        "review_remarks",
        "confirm_review",
        "dry_run",
      ]);
      if (Object.keys(body).some((key) => !allowed.has(key))) {
        udReviewFail(
          "UD_REVIEW_FIELDS_UNSUPPORTED",
          "Unsupported review fields.",
          400,
        );
      }
      const action = body.action;
      const version = periodPositiveId(body.expected_request_version);
      const remarks =
        typeof body.review_remarks === "string"
          ? body.review_remarks.trim()
          : "";
      if (
        !["APPROVE", "RETURN", "REJECT"].includes(action) ||
        !version ||
        remarks.length < 15 ||
        remarks.length > 1000 ||
        /[\x00-\x08\x0B\x0E-\x1F\x7F]/.test(remarks) ||
        body.confirm_review !== true ||
        typeof body.dry_run !== "boolean"
      ) {
        udReviewFail(
          "UD_REVIEW_INPUT_INVALID",
          "Provide APPROVE/RETURN/REJECT, current version, review_remarks (15–1000 characters), confirm_review true, and boolean dry_run.",
          400,
        );
      }
      if (version >= 4294967295) {
        udReviewFail(
          "UD_REVIEW_VERSION_LIMIT",
          "UD request version limit reached.",
        );
      }

      connection = await db.getConnection();
      await termReviewAssertTestDatabase(connection);
      const { userId, departmentId } = await incReviewAssertProgramHead(
        connection,
        req,
      );
      await connection.beginTransaction();
      inTransaction = true;

      await assertQaGradingDatabase(connection);
      // Identify scope without locks, then lock in offering -> config -> student order.
      const [targets] = await connection.execute(
        `SELECT ur.config_id, ur.enrollment_subject_id, cfg.offering_id
         FROM gradebook_ud_outcome_requests ur
         JOIN gradebook_offering_config cfg ON cfg.config_id = ur.config_id
        WHERE ur.ud_request_id = ?`,
        [requestId],
      );
      if (targets.length !== 1 || Number(targets[0].offering_id) !== 131) {
        udReviewFail(
          "UD_REVIEW_NOT_FOUND",
          "UD request not found in QA Offering #131.",
          404,
        );
      }
      const configId = Number(targets[0].config_id);
      const studentId = Number(targets[0].enrollment_subject_id);

      const [offerings] = await connection.execute(
        `SELECT so.offering_id, so.faculty_id, so.status, cr.department_id,
              f.user_id AS instructor_user_id
         FROM subject_offerings so
         JOIN sections sec ON sec.section_id = so.section_id
         JOIN courses cr ON cr.course_id = sec.course_id
         JOIN faculty f ON f.faculty_id = so.faculty_id
        WHERE so.offering_id = 131 FOR UPDATE`,
      );
      const offering = offerings[0];
      if (
        offerings.length !== 1 ||
        Number(offering.department_id) !== departmentId ||
        offering.status === "Cancelled"
      ) {
        udReviewFail(
          "UD_REVIEW_DEPARTMENT_FORBIDDEN",
          "Request is outside your active department or offering is cancelled.",
          403,
        );
      }
      const [configs] = await connection.execute(
        `SELECT config_id FROM gradebook_offering_config
        WHERE config_id = ? AND offering_id = 131 FOR UPDATE`,
        [configId],
      );
      if (configs.length !== 1)
        udReviewFail("UD_REVIEW_CONFIG_CHANGED", "Gradebook config changed.");
      const [students] = await connection.execute(
        `SELECT es.status AS subject_status, e.enrollment_status
         FROM enrollment_subjects es
         JOIN enrollments e ON e.enrollment_id = es.enrollment_id
        WHERE es.enrollment_subject_id = ? AND es.offering_id = 131 FOR UPDATE`,
        [studentId],
      );
      if (students.length !== 1)
        udReviewFail(
          "UD_REVIEW_STUDENT_CHANGED",
          "Student offering placement changed.",
        );
      const [grades] = await connection.execute(
        `SELECT grade_id FROM grades WHERE enrollment_subject_id = ? FOR UPDATE`,
        [studentId],
      );
      const [incRequests] = await connection.execute(
        `SELECT inc_request_id FROM gradebook_inc_outcome_requests
        WHERE config_id = ? AND enrollment_subject_id = ?
          AND request_status IN ('SUBMITTED','RETURNED','APPROVED') FOR UPDATE`,
        [configId, studentId],
      );
      const [finalAttempts] = await connection.execute(
        `SELECT term_submission_id FROM gradebook_term_submission_attempts
        WHERE config_id = ? AND enrollment_subject_id = ?
          AND grading_term = 'FINAL_TERM' LIMIT 1 FOR UPDATE`,
        [configId, studentId],
      );
      const [requests] = await connection.execute(
        `SELECT ur.ud_request_id, ur.request_status, ur.outcome_reason,
              ur.evidence_summary, ur.attendance_snapshot_json,
              ur.record_version, ur.submitted_by_user_id
         FROM gradebook_ud_outcome_requests ur
        WHERE ur.ud_request_id = ? AND ur.config_id = ?
          AND ur.enrollment_subject_id = ? FOR UPDATE`,
        [requestId, configId, studentId],
      );
      const request = requests[0];
      if (requests.length !== 1 || request.request_status !== "SUBMITTED") {
        udReviewFail(
          "UD_REVIEW_NOT_PENDING",
          "Only SUBMITTED UD requests may be reviewed.",
        );
      }
      if (Number(request.record_version) !== version) {
        udReviewFail(
          "UD_REVIEW_VERSION_CONFLICT",
          "Request changed; reload before reviewing.",
        );
      }
      const [authorRows] = await connection.execute(
        `SELECT u.user_id, u.is_active, u.is_archived, r.role_name
         FROM users u JOIN roles r ON r.role_id = u.role_id
        WHERE u.user_id = ?`,
        [Number(request.submitted_by_user_id)],
      );
      if (
        authorRows.length !== 1 ||
        Number(authorRows[0].is_active) !== 1 ||
        Number(authorRows[0].is_archived) !== 0 ||
        !["Faculty", "Program Head"].includes(authorRows[0].role_name) ||
        Number(request.submitted_by_user_id) !==
          Number(offering.instructor_user_id)
      ) {
        udReviewFail(
          "UD_REVIEW_INSTRUCTOR_CHANGED",
          "Faculty request author is no longer the active assigned instructor.",
        );
      }

      // Verify the Faculty's immutable request/event history before acting.
      const [events] = await connection.execute(
        `SELECT event_type, previous_status, new_status, reason_snapshot,
              evidence_snapshot, attendance_snapshot_json,
              performed_by_user_id, request_version_after
         FROM gradebook_ud_outcome_request_events
        WHERE ud_request_id = ? ORDER BY request_version_after FOR UPDATE`,
        [requestId],
      );
      const first = events[0];
      const last = events.at(-1);
      if (
        !first ||
        first.event_type !== "SUBMITTED" ||
        Number(first.request_version_after) !== 1 ||
        !last ||
        last.new_status !== "SUBMITTED" ||
        !["SUBMITTED", "RESUBMITTED"].includes(last.event_type) ||
        events.length !== version ||
        !events.every(
          (event, idx) => Number(event.request_version_after) === idx + 1,
        ) ||
        last.reason_snapshot !== request.outcome_reason ||
        last.evidence_snapshot !== request.evidence_summary ||
        String(last.attendance_snapshot_json) !==
          String(request.attendance_snapshot_json) ||
        Number(last.performed_by_user_id) !==
          Number(request.submitted_by_user_id)
      ) {
        udReviewFail(
          "UD_REVIEW_AUDIT_MISMATCH",
          "UD request does not match its audited submission.",
        );
      }

      // For approval, recheck attendance evidence and all competing outcomes.
      if (action === "APPROVE") {
        if (
          students[0].subject_status !== "Enrolled" ||
          students[0].enrollment_status !== "Approved" ||
          grades.length ||
          incRequests.length ||
          finalAttempts.length
        ) {
          udReviewFail(
            "UD_REVIEW_CONFLICT",
            "Student has an existing grade, INC request, Final Term attempt, or inactive enrollment.",
          );
        }
        const [attendance] = await connection.execute(
          `SELECT m.meeting_id, m.grading_term,
                DATE_FORMAT(m.meeting_date, '%Y-%m-%d') AS meeting_date,
                COALESCE(a.attendance_status, 'PENDING') AS attendance_status,
                a.record_version, a.recorded_by_user_id, a.recorded_at
           FROM gradebook_attendance_meetings m
           LEFT JOIN gradebook_attendance_entries a
             ON a.meeting_id = m.meeting_id AND a.enrollment_subject_id = ?
          WHERE m.config_id = ? AND m.meeting_status = 'HELD'
            AND m.meeting_date <= CURDATE()
          ORDER BY m.meeting_date, m.meeting_id FOR UPDATE`,
          [studentId, configId],
        );
        const absences = attendance.filter(
          (x) =>
            x.attendance_status === "ABSENT" &&
            x.recorded_at !== null &&
            x.recorded_by_user_id !== null &&
            Number.isSafeInteger(Number(x.record_version)) &&
            Number(x.record_version) > 0,
        );
        let saved;
        try {
          saved =
            typeof request.attendance_snapshot_json === "string"
              ? JSON.parse(request.attendance_snapshot_json)
              : request.attendance_snapshot_json;
        } catch {
          udReviewFail(
            "UD_REVIEW_SNAPSHOT_INVALID",
            "The submitted attendance evidence cannot be parsed.",
          );
        }
        const expected = {
          config_id: configId,
          offering_id: 131,
          enrollment_subject_id: studentId,
          held_meetings: attendance.length,
          absent_meetings: absences.length,
          present_meetings: attendance.filter(
            (x) => x.attendance_status === "PRESENT",
          ).length,
          late_meetings: attendance.filter(
            (x) => x.attendance_status === "LATE",
          ).length,
          excluded_excused: attendance.filter(
            (x) => x.attendance_status === "EXCUSED",
          ).length,
          excluded_not_applicable: attendance.filter(
            (x) => x.attendance_status === "NOT_APPLICABLE",
          ).length,
          pending_meetings: attendance.filter(
            (x) => x.attendance_status === "PENDING",
          ).length,
          absences: absences.map((x) => ({
            meeting_id: Number(x.meeting_id),
            date: x.meeting_date,
            term: x.grading_term,
            attendance_version: Number(x.record_version),
          })),
        };
        if (
          !absences.length ||
          JSON.stringify(saved) !== JSON.stringify(expected) ||
          request.outcome_reason.trim().length < 10 ||
          request.evidence_summary.trim().length < 20
        ) {
          udReviewFail(
            "UD_REVIEW_EVIDENCE_STALE",
            "Attendance evidence changed or is insufficient. Return the request for Faculty review.",
          );
        }
      }

      const newStatus =
        action === "APPROVE"
          ? "APPROVED"
          : action === "RETURN"
            ? "RETURNED"
            : "REJECTED";
      const nextVersion = version + 1;
      const [updated] = await connection.execute(
        `UPDATE gradebook_ud_outcome_requests
          SET request_status = ?, reviewed_by_user_id = ?,
              reviewed_at = NOW(6), review_remarks = ?,
              record_version = record_version + 1
        WHERE ud_request_id = ? AND request_status = 'SUBMITTED' AND record_version = ?`,
        [newStatus, userId, remarks, requestId, version],
      );
      if (Number(updated.affectedRows) !== 1) {
        udReviewFail(
          "UD_REVIEW_VERSION_CONFLICT",
          "UD request was modified during review.",
        );
      }
      const [audit] = await connection.execute(
        `INSERT INTO gradebook_ud_outcome_request_events
         (ud_request_id, event_type, previous_status, new_status,
          reason_snapshot, evidence_snapshot, attendance_snapshot_json,
          event_reason, performed_by_user_id, request_version_after)
       VALUES (?, ?, 'SUBMITTED', ?, ?, ?, ?, ?, ?, ?)`,
        [
          requestId,
          action === "APPROVE"
            ? "APPROVED"
            : action === "RETURN"
              ? "RETURNED"
              : "REJECTED",
          newStatus,
          request.outcome_reason,
          request.evidence_summary,
          request.attendance_snapshot_json,
          remarks,
          userId,
          nextVersion,
        ],
      );
      if (Number(audit.affectedRows) !== 1) {
        throw new Error("UD review audit event did not save.");
      }
      if (body.dry_run) await connection.rollback();
      else await connection.commit();
      inTransaction = false;
      return res.json({
        success: true,
        dry_run: body.dry_run,
        persisted: !body.dry_run,
        ud_request_id: String(requestId),
        action,
        request_status: newStatus,
        record_version: nextVersion,
        audit_event_id: body.dry_run ? null : String(audit.insertId),
        official_grade_created: false,
        ud_6_00_published: false,
        next_step:
          action === "APPROVE"
            ? "Approved UD evidence is ready for a separate, audited official outcome publication. No grade has changed."
            : action === "RETURN"
              ? "Faculty may correct and resubmit this request."
              : "UD request rejected; no grade or student status was changed.",
      });
    } catch (error) {
      if (inTransaction && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("UD REVIEW ROLLBACK:", rollbackError);
        }
      }
      return udReviewError(res, error);
    } finally {
      connection?.release();
    }
  },
);

// POST /api/program-head/gradebook/ud-outcome-requests/:requestId/publish
router.post(
  "/gradebook/ud-outcome-requests/:requestId/publish",
  async (req, res) => {
    let connection;
    let inTransaction = false;
    try {
      if (Object.keys(req.query ?? {}).length) {
        udReviewFail(
          "UD_PUBLISH_QUERY_UNSUPPORTED",
          "Query parameters are not supported.",
          400,
        );
      }
      const requestId = periodPositiveId(req.params.requestId);
      const body = req.body;
      if (
        !requestId ||
        !body ||
        typeof body !== "object" ||
        Array.isArray(body)
      ) {
        udReviewFail(
          "UD_PUBLISH_INPUT_INVALID",
          "Valid request ID and JSON body required.",
          400,
        );
      }
      const allowed = new Set([
        "expected_request_version",
        "publication_reason",
        "confirm_publication",
        "dry_run",
      ]);
      if (Object.keys(body).some((key) => !allowed.has(key))) {
        udReviewFail(
          "UD_PUBLISH_FIELDS_UNSUPPORTED",
          "Unsupported publication fields.",
          400,
        );
      }
      const expectedVersion = periodPositiveId(body.expected_request_version);
      const publicationReason =
        typeof body.publication_reason === "string"
          ? body.publication_reason.trim()
          : "";
      if (
        !expectedVersion ||
        publicationReason.length < 15 ||
        publicationReason.length > 1000 ||
        /[\x00-\x08\x0B\x0E-\x1F\x7F]/.test(publicationReason) ||
        body.confirm_publication !== true ||
        typeof body.dry_run !== "boolean"
      ) {
        udReviewFail(
          "UD_PUBLISH_INPUT_INVALID",
          "Provide current expected_request_version, publication_reason (15–1000 characters), confirm_publication true and boolean dry_run.",
          400,
        );
      }

      connection = await db.getConnection();

      const { userId, departmentId } = await incReviewAssertProgramHead(
        connection,
        req,
      );
      // Pooled connections must never inherit privileged grade-update modes.
      await connection.execute("SET @allow_approved_inc_grade_change = NULL");
      await connection.execute("SET @allow_approved_grade_correction = NULL");
      await connection.execute("SET @allow_approved_inc_expiry = NULL");
      await connection.beginTransaction();
      inTransaction = true;
      await assertQaGradingDatabase(connection);
      await termReviewAssertTestDatabase(connection);
      const [targetRows] = await connection.execute(
        `SELECT ur.config_id, ur.enrollment_subject_id, cfg.offering_id
         FROM gradebook_ud_outcome_requests ur
         JOIN gradebook_offering_config cfg ON cfg.config_id = ur.config_id
        WHERE ur.ud_request_id = ?`,
        [requestId],
      );
      if (
        targetRows.length !== 1 ||
        Number(targetRows[0].offering_id) !== 131
      ) {
        udReviewFail(
          "UD_PUBLISH_REQUEST_NOT_FOUND",
          "UD request is outside QA Offering #131.",
          404,
        );
      }
      const configId = Number(targetRows[0].config_id);
      const enrollmentSubjectId = Number(targetRows[0].enrollment_subject_id);

      // Match K3B6.2 lock order: offering -> config -> student -> grade -> requests.
      const [offeringRows] = await connection.execute(
        `SELECT so.offering_id, so.faculty_id, so.status, cr.department_id,
              f.user_id AS instructor_user_id, u.is_active AS instructor_active,
              u.is_archived AS instructor_archived
         FROM subject_offerings so
         JOIN sections sec ON sec.section_id = so.section_id
         JOIN courses cr ON cr.course_id = sec.course_id
         JOIN faculty f ON f.faculty_id = so.faculty_id
         JOIN users u ON u.user_id = f.user_id
        WHERE so.offering_id = 131 FOR UPDATE`,
      );
      const offering = offeringRows[0];
      if (
        offeringRows.length !== 1 ||
        Number(offering.department_id) !== departmentId ||
        offering.status === "Cancelled" ||
        Number(offering.instructor_active) !== 1 ||
        Number(offering.instructor_archived) !== 0
      ) {
        udReviewFail(
          "UD_PUBLISH_SCOPE_INVALID",
          "Instructor or Program Head department scope is invalid.",
          403,
        );
      }
      const [configs] = await connection.execute(
        `SELECT config_id, midterm_percent, final_term_percent
         FROM gradebook_offering_config
        WHERE config_id = ? AND offering_id = 131 FOR UPDATE`,
        [configId],
      );
      if (
        configs.length !== 1 ||
        Number(configs[0].midterm_percent) !== 50 ||
        Number(configs[0].final_term_percent) !== 50
      ) {
        udReviewFail(
          "UD_PUBLISH_POLICY_CHANGED",
          "Offering's grading policy changed.",
        );
      }
      const [students] = await connection.execute(
        `SELECT es.status AS subject_status, e.enrollment_status
         FROM enrollment_subjects es
         JOIN enrollments e ON e.enrollment_id = es.enrollment_id
        WHERE es.enrollment_subject_id = ? AND es.offering_id = 131 FOR UPDATE`,
        [enrollmentSubjectId],
      );
      if (
        students.length !== 1 ||
        students[0].subject_status !== "Enrolled" ||
        students[0].enrollment_status !== "Approved"
      ) {
        udReviewFail(
          "UD_PUBLISH_STUDENT_CHANGED",
          "Student is no longer enrolled in an approved enrollment.",
        );
      }
      const [existingGrades] = await connection.execute(
        `SELECT grade_id FROM grades WHERE enrollment_subject_id = ? FOR UPDATE`,
        [enrollmentSubjectId],
      );
      if (existingGrades.length) {
        udReviewFail(
          "UD_PUBLISH_GRADE_EXISTS",
          "Existing grades must not be replaced by UD publication.",
        );
      }
      const [incRequests] = await connection.execute(
        `SELECT inc_request_id FROM gradebook_inc_outcome_requests
        WHERE config_id = ? AND enrollment_subject_id = ?
          AND request_status IN ('SUBMITTED','RETURNED','APPROVED') FOR UPDATE`,
        [configId, enrollmentSubjectId],
      );
      if (incRequests.length) {
        udReviewFail(
          "UD_PUBLISH_INC_CONFLICT",
          "An INC outcome request conflicts with UD publication.",
        );
      }
      const [finalAttempts] = await connection.execute(
        `SELECT term_submission_id FROM gradebook_term_submission_attempts
        WHERE config_id = ? AND enrollment_subject_id = ?
          AND grading_term = 'FINAL_TERM' LIMIT 1 FOR UPDATE`,
        [configId, enrollmentSubjectId],
      );
      if (finalAttempts.length) {
        udReviewFail(
          "UD_PUBLISH_FINAL_CONFLICT",
          "Existing numeric Final Term submission requires reconciliation.",
        );
      }
      const [requestRows] = await connection.execute(
        `SELECT ud_request_id, config_id, enrollment_subject_id, request_status,
              outcome_reason, evidence_summary, attendance_snapshot_json,
              submitted_by_user_id, submitted_at, reviewed_by_user_id,
              reviewed_at, review_remarks, record_version
         FROM gradebook_ud_outcome_requests WHERE ud_request_id = ? FOR UPDATE`,
        [requestId],
      );
      const request = requestRows[0];
      if (
        requestRows.length !== 1 ||
        Number(request.config_id) !== configId ||
        Number(request.enrollment_subject_id) !== enrollmentSubjectId ||
        request.request_status !== "APPROVED" ||
        Number(request.record_version) !== expectedVersion ||
        Number(request.submitted_by_user_id) !==
          Number(offering.instructor_user_id) ||
        Number(request.reviewed_by_user_id) !== userId ||
        !request.reviewed_at ||
        !request.submitted_at ||
        !request.review_remarks ||
        String(request.review_remarks).trim().length < 15 ||
        new Date(request.reviewed_at).getTime() <
          new Date(request.submitted_at).getTime() ||
        String(request.outcome_reason ?? "").trim().length < 10 ||
        String(request.evidence_summary ?? "").trim().length < 20
      ) {
        udReviewFail(
          "UD_PUBLISH_REQUEST_NOT_AUTHORIZED",
          "An unchanged, documented UD approval by the current Program Head is required.",
        );
      }

      const [events] = await connection.execute(
        `SELECT event_type, previous_status, new_status, reason_snapshot,
              evidence_snapshot, attendance_snapshot_json,
              performed_by_user_id, request_version_after
         FROM gradebook_ud_outcome_request_events
        WHERE ud_request_id = ? ORDER BY request_version_after FOR UPDATE`,
        [requestId],
      );
      const first = events[0];
      const last = events.at(-1);
      if (
        !first ||
        first.event_type !== "SUBMITTED" ||
        first.previous_status !== null ||
        Number(first.performed_by_user_id) !==
          Number(request.submitted_by_user_id) ||
        !last ||
        last.event_type !== "APPROVED" ||
        last.previous_status !== "SUBMITTED" ||
        last.new_status !== "APPROVED" ||
        Number(last.performed_by_user_id) !== userId ||
        events.length !== expectedVersion ||
        !events.every((ev, i) => Number(ev.request_version_after) === i + 1) ||
        String(last.reason_snapshot) !== String(request.outcome_reason) ||
        String(last.evidence_snapshot) !== String(request.evidence_summary) ||
        String(last.attendance_snapshot_json) !==
          String(request.attendance_snapshot_json)
      ) {
        udReviewFail(
          "UD_PUBLISH_AUDIT_INVALID",
          "The approved request's complete audit history is inconsistent.",
        );
      }

      // Attendance is checked again at publication: five absences alone NEVER imply UD.
      const [attendance] = await connection.execute(
        `SELECT m.meeting_id, m.grading_term,
              DATE_FORMAT(m.meeting_date, '%Y-%m-%d') AS meeting_date,
              COALESCE(a.attendance_status, 'PENDING') AS attendance_status,
              a.record_version, a.recorded_by_user_id, a.recorded_at
         FROM gradebook_attendance_meetings m
         LEFT JOIN gradebook_attendance_entries a
           ON a.meeting_id = m.meeting_id AND a.enrollment_subject_id = ?
        WHERE m.config_id = ? AND m.meeting_status = 'HELD'
          AND m.meeting_date <= CURDATE()
        ORDER BY m.meeting_date, m.meeting_id FOR UPDATE`,
        [enrollmentSubjectId, configId],
      );
      const absences = attendance.filter(
        (a) =>
          a.attendance_status === "ABSENT" &&
          a.recorded_at !== null &&
          a.recorded_by_user_id !== null &&
          Number.isSafeInteger(Number(a.record_version)) &&
          Number(a.record_version) > 0,
      );
      const snapshot = {
        config_id: configId,
        offering_id: 131,
        enrollment_subject_id: enrollmentSubjectId,
        held_meetings: attendance.length,
        absent_meetings: absences.length,
        present_meetings: attendance.filter(
          (x) => x.attendance_status === "PRESENT",
        ).length,
        late_meetings: attendance.filter((x) => x.attendance_status === "LATE")
          .length,
        excluded_excused: attendance.filter(
          (x) => x.attendance_status === "EXCUSED",
        ).length,
        excluded_not_applicable: attendance.filter(
          (x) => x.attendance_status === "NOT_APPLICABLE",
        ).length,
        pending_meetings: attendance.filter(
          (x) => x.attendance_status === "PENDING",
        ).length,
        absences: absences.map((x) => ({
          meeting_id: Number(x.meeting_id),
          date: x.meeting_date,
          term: x.grading_term,
          attendance_version: Number(x.record_version),
        })),
      };
      let submittedSnapshot;
      try {
        submittedSnapshot =
          typeof request.attendance_snapshot_json === "string"
            ? JSON.parse(request.attendance_snapshot_json)
            : request.attendance_snapshot_json;
      } catch {
        udReviewFail(
          "UD_PUBLISH_SNAPSHOT_INVALID",
          "Saved attendance evidence is invalid.",
        );
      }
      if (
        !absences.length ||
        JSON.stringify(snapshot) !== JSON.stringify(submittedSnapshot)
      ) {
        udReviewFail(
          "UD_PUBLISH_EVIDENCE_CHANGED",
          "Attendance evidence changed after approval; reconcile the request before publishing.",
        );
      }

      // Do not fabricate numeric Midterm/Final Term percentages for a special outcome.
      // Existing Midterm attempts remain in the separate gradebook history.
      const [insert] = await connection.execute(
        `INSERT INTO grades
         (enrollment_subject_id, faculty_id, midterm_grade, final_grade,
          grading_policy, grading_outcome, outcome_reason, grade_status)
       VALUES (?, ?, NULL, NULL, 'TWO_TERM_50_50', 'UNOFFICIAL_DROP', ?, 'Draft')`,
        [
          enrollmentSubjectId,
          Number(offering.faculty_id),
          request.outcome_reason,
        ],
      );
      if (
        Number(insert.affectedRows) !== 1 ||
        !periodPositiveId(insert.insertId)
      ) {
        throw new Error("UD grade insert failed.");
      }
      const gradeId = Number(insert.insertId);
      const [submitted] = await connection.execute(
        `UPDATE grades SET grade_status = 'Submitted'
        WHERE grade_id = ? AND grade_status = 'Draft'`,
        [gradeId],
      );
      if (Number(submitted.affectedRows) !== 1) {
        udReviewFail(
          "UD_PUBLISH_SUBMISSION_FAILED",
          "UD grade submission failed.",
        );
      }
      const [approved] = await connection.execute(
        `UPDATE grades SET grade_status = 'Approved', reviewed_by = ?
        WHERE grade_id = ? AND grade_status = 'Submitted'`,
        [userId, gradeId],
      );
      if (Number(approved.affectedRows) !== 1) {
        udReviewFail("UD_PUBLISH_APPROVAL_FAILED", "UD grade approval failed.");
      }
      const [verified] = await connection.execute(
        `SELECT grade_status, grading_policy, grading_outcome, final_rating,
              remarks, overall_percentage, midterm_grade, final_grade,
              outcome_reason, reviewed_by
         FROM grades WHERE grade_id = ? FOR UPDATE`,
        [gradeId],
      );
      const [subjectRows] = await connection.execute(
        `SELECT status FROM enrollment_subjects WHERE enrollment_subject_id = ?`,
        [enrollmentSubjectId],
      );
      const grade = verified[0];
      if (
        !grade ||
        grade.grade_status !== "Approved" ||
        grade.grading_policy !== "TWO_TERM_50_50" ||
        grade.grading_outcome !== "UNOFFICIAL_DROP" ||
        Number(grade.final_rating) !== 6 ||
        grade.remarks !== "Unofficial Drop" ||
        grade.overall_percentage !== null ||
        grade.midterm_grade !== null ||
        grade.final_grade !== null ||
        grade.outcome_reason !== request.outcome_reason ||
        Number(grade.reviewed_by) !== userId ||
        subjectRows[0]?.status !== "Unofficial Drop"
      ) {
        udReviewFail(
          "UD_PUBLISH_GRADE_MISMATCH",
          "Official grade and subject status are inconsistent; rolled back.",
        );
      }

      // Audit the special outcome and preserve Faculty evidence + reviewer decision.
      const [outcomeInsert] = await connection.execute(
        `INSERT INTO gradebook_special_outcomes
         (grade_id, outcome_type, outcome_reason, missing_requirements,
          evidence_summary, record_status, created_by_user_id)
       VALUES (?, 'UNOFFICIAL_DROP', ?, NULL, ?, 'ACTIVE', ?)`,
        [gradeId, request.outcome_reason, request.evidence_summary, userId],
      );
      if (Number(outcomeInsert.affectedRows) !== 1) {
        throw new Error("UD special-outcome audit insert failed.");
      }
      const specialOutcomeId = Number(outcomeInsert.insertId);
      const [outcomeEvent] = await connection.execute(
        `INSERT INTO gradebook_special_outcome_events
         (special_outcome_id, event_type, previous_record_status, new_record_status,
          previous_outcome_type, new_outcome_type, previous_outcome_reason,
          new_outcome_reason, previous_missing_requirements, new_missing_requirements,
          previous_evidence_summary, new_evidence_summary, event_reason,
          performed_by_user_id, record_version_after)
       VALUES (?, 'CREATED', NULL, 'ACTIVE', NULL, 'UNOFFICIAL_DROP',
               NULL, ?, NULL, NULL, NULL, ?, ?, ?, 1)`,
        [
          specialOutcomeId,
          request.outcome_reason,
          request.evidence_summary,
          `UD_REQUEST_ID=${requestId}; ${publicationReason}`,
          userId,
        ],
      );
      if (Number(outcomeEvent.affectedRows) !== 1) {
        throw new Error("UD special-outcome history was not saved.");
      }
      const [trail] = await connection.execute(
        `INSERT INTO audit_trail
         (user_id, table_name, record_id, action, old_values, new_values)
       VALUES (?, 'grades', ?, 'INSERT', NULL, ?)`,
        [
          userId,
          gradeId,
          JSON.stringify({
            enrollment_subject_id: enrollmentSubjectId,
            grading_outcome: "UNOFFICIAL_DROP",
            final_rating: "6.00",
            request_id: String(requestId),
            special_outcome_id: specialOutcomeId,
            approved_by_user_id: userId,
          }),
        ],
      );
      const [log] = await connection.execute(
        `INSERT INTO audit_logs (user_id, action, table_name, record_id, description)
       VALUES (?, 'UD 6.00 PUBLISHED', 'grades', ?, ?)`,
        [
          userId,
          gradeId,
          JSON.stringify({
            ud_request_id: String(requestId),
            request_version: expectedVersion,
            special_outcome_id: specialOutcomeId,
            publication_reason: publicationReason,
            evidence_summary: request.evidence_summary,
            program_head_user_id: userId,
          }),
        ],
      );
      if (Number(trail.affectedRows) !== 1 || Number(log.affectedRows) !== 1) {
        throw new Error("UD publication audit trail was not saved.");
      }

      if (body.dry_run) await connection.rollback();
      else await connection.commit();
      inTransaction = false;
      return res.json({
        success: true,
        dry_run: body.dry_run,
        persisted: !body.dry_run,
        ud_request_id: String(requestId),
        official_grade_id: body.dry_run ? null : gradeId,
        special_outcome_id: body.dry_run ? null : specialOutcomeId,
        grading_outcome: "UNOFFICIAL_DROP",
        final_rating: "6.00",
        grade_status: "Approved",
        enrollment_subject_status: "Unofficial Drop",
        numeric_grade_fabricated: false,
        audit_recorded: !body.dry_run,
        progression_review_required: true,
      });
    } catch (error) {
      if (inTransaction && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("UD PUBLICATION ROLLBACK:", rollbackError);
        }
      }
      return udReviewError(res, error);
    } finally {
      connection?.release();
    }
  },
);

function gbCorrectionReviewFail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function gbCorrectionReviewSendError(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
  if (status === 500)
    console.error("GRADEBOOK CORRECTION REVIEW ERROR:", error);
  return res.status(status).json({
    success: false,
    code: status === 500 ? "CORRECTION_REVIEW_INTERNAL_ERROR" : error.code,
    message:
      status === 500
        ? "Could not review the correction request."
        : error.message,
  });
}

function gbCorrectionReviewJSON(raw) {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function gbCorrectionReviewCents(raw) {
  const value = String(raw ?? "").trim();
  if (!/^(0|[1-9]\d{0,7})(?:\.(\d{1,2}))?$/.test(value)) return null;
  const [whole, decimal = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(decimal.padEnd(2, "0"));
}

function gbCorrectionReviewSame(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  const ac = gbCorrectionReviewCents(a);
  const bc = gbCorrectionReviewCents(b);
  if (ac !== null && bc !== null) return ac === bc;
  return String(a) === String(b);
}

// Department-scoped list for the Program Head review UI.
// GET /api/program-head/gradebook/score-correction-requests
router.get("/gradebook/score-correction-requests", async (req, res) => {
  let connection;
  try {
    if (Object.keys(req.query ?? {}).length) {
      gbCorrectionReviewFail(
        "CORRECTION_REVIEW_QUERY_UNSUPPORTED",
        "Query parameters are not accepted.",
        400,
      );
    }
    connection = await db.getConnection();
    await termReviewAssertTestDatabase(connection);
    const { departmentId } = await incReviewAssertProgramHead(connection, req);
    const [rows] = await connection.execute(
      `SELECT r.correction_id, r.grade_id, r.enrollment_subject_id,
              r.assessment_id, r.score_id, r.original_earned_score,
              r.proposed_earned_score, r.maximum_score_snapshot,
              r.correction_reason, r.evidence_summary, r.request_status,
              r.record_version, r.submitted_by_user_id, r.submitted_at,
              r.reviewed_by_user_id, r.reviewed_at, r.review_remarks,
              so.offering_id, s.student_number, a.grading_term, a.header_name
         FROM gradebook_correction_requests r
         JOIN gradebook_offering_config cfg ON cfg.config_id = r.config_id
         JOIN subject_offerings so ON so.offering_id = cfg.offering_id
         JOIN sections sec ON sec.section_id = so.section_id
         JOIN courses cr ON cr.course_id = sec.course_id
         JOIN enrollment_subjects es ON es.enrollment_subject_id = r.enrollment_subject_id
         JOIN enrollments e ON e.enrollment_id = es.enrollment_id
         JOIN students s ON s.student_id = e.student_id
         JOIN gradebook_assessments a ON a.assessment_id = r.assessment_id
        WHERE cr.department_id = ? AND so.offering_id = 131
          AND es.offering_id = so.offering_id
        ORDER BY (r.request_status = 'SUBMITTED') DESC,
                 r.updated_at DESC, r.correction_id DESC LIMIT 100`,
      [departmentId],
    );
    return res.json({
      success: true,
      read_only: true,
      requests: rows.map((r) => ({
        correction_id: String(r.correction_id),
        grade_id: Number(r.grade_id),
        enrollment_subject_id: Number(r.enrollment_subject_id),
        offering_id: Number(r.offering_id),
        student_number: r.student_number,
        assessment_id: Number(r.assessment_id),
        score_id: Number(r.score_id),
        grading_term: r.grading_term,
        assessment_name: r.header_name,
        original_score: String(r.original_earned_score),
        proposed_score: String(r.proposed_earned_score),
        maximum_score: String(r.maximum_score_snapshot),
        correction_reason: r.correction_reason,
        evidence_summary: r.evidence_summary,
        request_status: r.request_status,
        record_version: Number(r.record_version),
        submitted_by_user_id: Number(r.submitted_by_user_id),
        submitted_at: r.submitted_at,
        reviewed_by_user_id:
          r.reviewed_by_user_id === null ? null : Number(r.reviewed_by_user_id),
        reviewed_at: r.reviewed_at,
        review_remarks: r.review_remarks,
      })),
      official_grades_unchanged: true,
    });
  } catch (error) {
    return gbCorrectionReviewSendError(res, error);
  } finally {
    connection?.release();
  }
});

// POST /api/program-head/gradebook/score-correction-requests/:correctionId/review
// APPROVE authorizes Registrar processing; RETURN/REJECT do not alter grades.
router.post(
  "/gradebook/score-correction-requests/:correctionId/review",
  async (req, res) => {
    let connection;
    let inTransaction = false;
    try {
      if (Object.keys(req.query ?? {}).length) {
        gbCorrectionReviewFail(
          "CORRECTION_REVIEW_QUERY_UNSUPPORTED",
          "Query parameters are not accepted.",
          400,
        );
      }
      const correctionId = periodPositiveId(req.params.correctionId);
      const body = req.body;
      if (
        !correctionId ||
        !body ||
        typeof body !== "object" ||
        Array.isArray(body)
      ) {
        gbCorrectionReviewFail(
          "CORRECTION_REVIEW_INPUT_INVALID",
          "A valid request ID and JSON object are required.",
          400,
        );
      }
      const allowed = new Set([
        "action",
        "expected_request_version",
        "review_remarks",
        "confirm_review",
        "dry_run",
      ]);
      if (Object.keys(body).some((key) => !allowed.has(key))) {
        gbCorrectionReviewFail(
          "CORRECTION_REVIEW_FIELDS_UNSUPPORTED",
          "Unsupported fields supplied.",
          400,
        );
      }
      const version = periodPositiveId(body.expected_request_version);
      const remarks =
        typeof body.review_remarks === "string"
          ? body.review_remarks.trim()
          : "";
      if (
        !["APPROVE", "RETURN", "REJECT"].includes(body.action) ||
        !version ||
        version >= 4294967295 ||
        remarks.length < 15 ||
        remarks.length > 1000 ||
        /[\x00-\x08\x0B\x0E-\x1F\x7F]/.test(remarks) ||
        body.confirm_review !== true ||
        typeof body.dry_run !== "boolean"
      ) {
        gbCorrectionReviewFail(
          "CORRECTION_REVIEW_INPUT_INVALID",
          "Provide APPROVE/RETURN/REJECT, current version, review_remarks (15–1000), confirm_review true and boolean dry_run.",
          400,
        );
      }

      connection = await db.getConnection();

      const { userId, departmentId } = await incReviewAssertProgramHead(
        connection,
        req,
      );
      await connection.beginTransaction();
      inTransaction = true;
      await assertQaGradingDatabase(connection);
      await termReviewAssertTestDatabase(connection);

      // Resolve scope without locks, then lock offering -> config -> enrollment ->
      // grade -> publication -> term submissions -> score -> correction request.
      const [targets] = await connection.execute(
        `SELECT r.config_id, r.enrollment_subject_id, cfg.offering_id
         FROM gradebook_correction_requests r
         JOIN gradebook_offering_config cfg ON cfg.config_id = r.config_id
        WHERE r.correction_id = ?`,
        [correctionId],
      );
      if (targets.length !== 1 || Number(targets[0].offering_id) !== 131) {
        gbCorrectionReviewFail(
          "CORRECTION_REVIEW_NOT_FOUND",
          "Request not found in QA Offering #131.",
          404,
        );
      }
      const configId = Number(targets[0].config_id);
      const enrollmentSubjectId = Number(targets[0].enrollment_subject_id);

      const [offerings] = await connection.execute(
        `SELECT so.offering_id, so.faculty_id, so.status, cr.department_id,
              f.user_id AS instructor_user_id, u.is_active AS instructor_active,
              u.is_archived AS instructor_archived, role.role_name AS instructor_role
         FROM subject_offerings so
         JOIN sections sec ON sec.section_id = so.section_id
         JOIN courses cr ON cr.course_id = sec.course_id
         JOIN faculty f ON f.faculty_id = so.faculty_id
         JOIN users u ON u.user_id = f.user_id
         JOIN roles role ON role.role_id = u.role_id
        WHERE so.offering_id = 131 FOR UPDATE`,
      );
      if (
        offerings.length !== 1 ||
        Number(offerings[0].department_id) !== departmentId ||
        offerings[0].status === "Cancelled"
      ) {
        gbCorrectionReviewFail(
          "CORRECTION_REVIEW_SCOPE_INVALID",
          "Request is outside your active department or offering is unavailable.",
          403,
        );
      }
      const offering = offerings[0];
      const [configs] = await connection.execute(
        `SELECT config_id, midterm_percent, final_term_percent
         FROM gradebook_offering_config WHERE config_id = ? AND offering_id = 131 FOR UPDATE`,
        [configId],
      );
      if (
        configs.length !== 1 ||
        Number(configs[0].midterm_percent) !== 50 ||
        Number(configs[0].final_term_percent) !== 50
      ) {
        gbCorrectionReviewFail(
          "CORRECTION_REVIEW_CONFIG_CHANGED",
          "The official grading policy has changed.",
        );
      }
      const [subjects] = await connection.execute(
        `SELECT es.status AS subject_status, e.enrollment_status
         FROM enrollment_subjects es JOIN enrollments e ON e.enrollment_id = es.enrollment_id
        WHERE es.enrollment_subject_id = ? AND es.offering_id = 131 FOR UPDATE`,
        [enrollmentSubjectId],
      );
      if (subjects.length !== 1)
        gbCorrectionReviewFail(
          "CORRECTION_REVIEW_STUDENT_MOVED",
          "Student's offering changed.",
        );
      const [grades] = await connection.execute(
        `SELECT grade_id, grade_status, grading_policy, grading_outcome,
              midterm_grade, final_grade, overall_percentage, final_rating,
              remarks, faculty_id
         FROM grades WHERE enrollment_subject_id = ? FOR UPDATE`,
        [enrollmentSubjectId],
      );
      const [publications] = await connection.execute(
        `SELECT publication_id, grade_id, config_id, enrollment_subject_id,
              midterm_submission_id, final_term_submission_id
         FROM gradebook_official_grade_publications WHERE grade_id = ? FOR UPDATE`,
        [grades[0]?.grade_id ?? -1],
      );
      const publication = publications[0];
      const [attempts] = publication
        ? await connection.execute(
            `SELECT term_submission_id, config_id, enrollment_subject_id, grading_term,
              submission_status, calculation_snapshot_json
         FROM gradebook_term_submission_attempts
        WHERE term_submission_id IN (?, ?) FOR UPDATE`,
            [
              String(publication.midterm_submission_id),
              String(publication.final_term_submission_id),
            ],
          )
        : [[]];

      // Read the requested score ID before locking the score row; the
      // locked request below revalidates the same reference and version.
      const [requestPointers] = await connection.execute(
        `SELECT score_id FROM gradebook_correction_requests
        WHERE correction_id = ? AND config_id = ? AND enrollment_subject_id = ?`,
        [correctionId, configId, enrollmentSubjectId],
      );
      if (requestPointers.length !== 1) {
        gbCorrectionReviewFail(
          "CORRECTION_REVIEW_REQUEST_CHANGED",
          "Correction request is missing or moved.",
        );
      }
      const requestedScoreId = Number(requestPointers[0].score_id);
      const [scoreRows] = await connection.execute(
        `SELECT sc.score_id, sc.score_status, sc.earned_score, sc.record_version,
              a.assessment_id, a.grading_term, a.maximum_score, a.record_status,
              oc.config_id
         FROM gradebook_scores sc
         JOIN gradebook_assessments a ON a.assessment_id = sc.assessment_id
         JOIN gradebook_offering_categories oc ON oc.offering_category_id = a.offering_category_id
        WHERE sc.score_id = ? AND sc.enrollment_subject_id = ? FOR UPDATE`,
        [requestedScoreId, enrollmentSubjectId],
      );
      const [lockedRequests] = await connection.execute(
        `SELECT * FROM gradebook_correction_requests
        WHERE correction_id = ? AND config_id = ? AND enrollment_subject_id = ? FOR UPDATE`,
        [correctionId, configId, enrollmentSubjectId],
      );
      if (
        lockedRequests.length !== 1 ||
        Number(lockedRequests[0].score_id) !== requestedScoreId ||
        lockedRequests[0].request_status !== "SUBMITTED" ||
        Number(lockedRequests[0].record_version) !== version
      ) {
        gbCorrectionReviewFail(
          "CORRECTION_REVIEW_VERSION_CONFLICT",
          "Correction request changed during review.",
        );
      }
      const correction = lockedRequests[0];
      if (
        grades.length !== 1 ||
        !publication ||
        Number(correction.grade_id) !== Number(grades[0].grade_id) ||
        Number(correction.publication_id) !==
          Number(publication.publication_id) ||
        Number(publication.config_id) !== configId ||
        Number(publication.enrollment_subject_id) !== enrollmentSubjectId
      ) {
        gbCorrectionReviewFail(
          "CORRECTION_REVIEW_PUBLICATION_CHANGED",
          "The original published grade source is missing or inconsistent.",
        );
      }
      const grade = grades[0];
      const source = gbCorrectionReviewJSON(
        correction.original_grade_snapshot_json,
      );
      if (
        !source ||
        Number(source.grade_id) !== Number(grade.grade_id) ||
        String(source.publication_id) !== String(publication.publication_id) ||
        source.grade_status !== grade.grade_status ||
        source.grading_policy !== grade.grading_policy ||
        source.grading_outcome !== grade.grading_outcome ||
        ![
          "midterm_grade",
          "final_grade",
          "overall_percentage",
          "final_rating",
          "remarks",
        ].every((field) => gbCorrectionReviewSame(source[field], grade[field]))
      ) {
        gbCorrectionReviewFail(
          "CORRECTION_REVIEW_GRADE_STALE",
          "Official grade changed after the Faculty request.",
        );
      }
      const sc = scoreRows[0];
      const originalCents = gbCorrectionReviewCents(
        correction.original_earned_score,
      );
      const proposedCents = gbCorrectionReviewCents(
        correction.proposed_earned_score,
      );
      const maxCents = gbCorrectionReviewCents(
        correction.maximum_score_snapshot,
      );
      const actualCents = gbCorrectionReviewCents(sc?.earned_score);
      const currentMaximum = gbCorrectionReviewCents(sc?.maximum_score);
      const validScore =
        scoreRows.length === 1 &&
        Number(sc.config_id) === configId &&
        Number(sc.assessment_id) === Number(correction.assessment_id) &&
        sc.record_status === "ACTIVE" &&
        sc.score_status === "SCORED" &&
        Number(sc.record_version) ===
          Number(correction.score_version_at_request) &&
        originalCents !== null &&
        proposedCents !== null &&
        maxCents !== null &&
        actualCents === originalCents &&
        currentMaximum === maxCents &&
        proposedCents !== originalCents &&
        proposedCents <= maxCents;

      const term = attempts.find(
        (row) => row.grading_term === sc?.grading_term,
      );
      let approvedScoreMatches = false;
      if (term) {
        const snapshot = gbCorrectionReviewJSON(term.calculation_snapshot_json);
        const assessments = (snapshot?.calculated_term?.categories ?? [])
          .flatMap((category) => category.assessments ?? [])
          .filter(
            (assessment) =>
              Number(assessment.assessment_id) ===
              Number(correction.assessment_id),
          );
        approvedScoreMatches =
          snapshot?.policy === "TWO_TERM_50_50" &&
          snapshot.grading_term === sc.grading_term &&
          Number(snapshot.config_id) === configId &&
          Number(snapshot.enrollment_subject_id) === enrollmentSubjectId &&
          snapshot.calculated_term?.state === "READY" &&
          term.submission_status === "APPROVED" &&
          String(term.term_submission_id) ===
            String(correction.term_submission_id) &&
          assessments.length === 1 &&
          assessments[0].score_status === "SCORED" &&
          gbCorrectionReviewCents(assessments[0].earned_score) ===
            originalCents &&
          gbCorrectionReviewCents(assessments[0].maximum_score) === maxCents;
      }

      const [events] = await connection.execute(
        `SELECT event_type, previous_status, new_status, proposal_snapshot_json,
              performed_by_user_id, request_version_after
         FROM gradebook_correction_request_events
        WHERE correction_id = ? ORDER BY request_version_after, event_id FOR UPDATE`,
        [correctionId],
      );
      const latest = events.at(-1);
      const first = events[0];
      const proposal = gbCorrectionReviewJSON(latest?.proposal_snapshot_json);

      // Validate the initial submission and any return/resubmission history.
      const auditChainValid =
        events.length === version &&
        events.every((event, index) => {
          if (Number(event.request_version_after) !== index + 1) {
            return false;
          }

          if (index === 0) {
            return (
              event.event_type === "SUBMITTED" &&
              event.previous_status === null &&
              event.new_status === "SUBMITTED" &&
              Number(event.performed_by_user_id) ===
                Number(correction.submitted_by_user_id)
            );
          }

          const previousStatus = events[index - 1].new_status;

          if (event.previous_status !== previousStatus) {
            return false;
          }

          if (event.event_type === "RETURNED") {
            return (
              previousStatus === "SUBMITTED" && event.new_status === "RETURNED"
            );
          }

          if (event.event_type === "RESUBMITTED") {
            return (
              previousStatus === "RETURNED" &&
              event.new_status === "SUBMITTED" &&
              Number(event.performed_by_user_id) ===
                Number(correction.submitted_by_user_id)
            );
          }

          return false;
        });

      const auditValid = Boolean(
        first?.event_type === "SUBMITTED" &&
        first.previous_status === null &&
        first.new_status === "SUBMITTED" &&
        auditChainValid &&
        latest?.event_type === (version === 1 ? "SUBMITTED" : "RESUBMITTED") &&
        latest?.new_status === "SUBMITTED" &&
        Number(first.performed_by_user_id) ===
          Number(correction.submitted_by_user_id) &&
        proposal?.correction_scope === "ONE_ASSESSMENT_SCORE" &&
        Number(proposal.grade_id) === Number(correction.grade_id) &&
        Number(proposal.assessment_id) === Number(correction.assessment_id) &&
        Number(proposal.score_id) === Number(correction.score_id) &&
        Number(proposal.score_version_at_request) ===
          Number(correction.score_version_at_request) &&
        gbCorrectionReviewCents(proposal.original_earned_score) ===
          originalCents &&
        gbCorrectionReviewCents(proposal.proposed_earned_score) ===
          proposedCents &&
        gbCorrectionReviewCents(proposal.maximum_score_snapshot) === maxCents &&
        proposal.correction_reason === correction.correction_reason &&
        proposal.evidence_summary === correction.evidence_summary,
      );
      const eligible =
        validScore &&
        approvedScoreMatches &&
        auditValid &&
        attempts.length === 2 &&
        attempts.every((a) => a.submission_status === "APPROVED") &&
        new Set(attempts.map((a) => a.grading_term)).size === 2 &&
        grade.grade_status === "Approved" &&
        grade.grading_outcome === "NUMERIC" &&
        grade.grading_policy === "TWO_TERM_50_50" &&
        Number(grade.faculty_id) === Number(offering.faculty_id) &&
        Number(correction.submitted_by_user_id) ===
          Number(offering.instructor_user_id) &&
        Number(offering.instructor_active) === 1 &&
        Number(offering.instructor_archived) === 0 &&
        ["Faculty", "Program Head"].includes(offering.instructor_role) &&
        subjects[0].enrollment_status === "Approved" &&
        ["Completed", "Failed"].includes(subjects[0].subject_status) &&
        correction.correction_reason?.trim().length >= 10 &&
        correction.evidence_summary?.trim().length >= 20;

      // Audit corruption must be reconciled before ANY review action.
      if (!auditValid) {
        gbCorrectionReviewFail(
          "CORRECTION_REVIEW_AUDIT_INVALID",
          "Correction request audit history is inconsistent.",
        );
      }
      // Stale evidence may be RETURNED or REJECTED; it may never be APPROVED.
      if (body.action === "APPROVE" && !eligible) {
        gbCorrectionReviewFail(
          "CORRECTION_REVIEW_SOURCE_NOT_READY",
          "Correction source or audit is stale. Return it for Faculty review; do not authorize official-grade changes.",
        );
      }
      if (body.action === "APPROVE") {
        const [legacyConflicts] = await connection.execute(
          `SELECT grade_change_request_id FROM grade_change_requests
          WHERE grade_id = ?
            AND status IN ('Pending Program Head', 'For Registrar Processing') FOR UPDATE`,
          [Number(grade.grade_id)],
        );
        if (legacyConflicts.length) {
          gbCorrectionReviewFail(
            "CORRECTION_REVIEW_LEGACY_CONFLICT",
            "An older active grade-change request must be reconciled before approving this correction.",
          );
        }
      }
      const newStatus =
        body.action === "APPROVE"
          ? "APPROVED"
          : body.action === "RETURN"
            ? "RETURNED"
            : "REJECTED";
      const nextVersion = version + 1;
      const [updated] = await connection.execute(
        `UPDATE gradebook_correction_requests
          SET request_status = ?, reviewed_by_user_id = ?, reviewed_at = NOW(6),
              review_remarks = ?, record_version = record_version + 1
        WHERE correction_id = ? AND request_status = 'SUBMITTED' AND record_version = ?`,
        [newStatus, userId, remarks, correctionId, version],
      );
      if (Number(updated.affectedRows) !== 1) {
        gbCorrectionReviewFail(
          "CORRECTION_REVIEW_VERSION_CONFLICT",
          "Correction request changed during review.",
        );
      }
      const [event] = await connection.execute(
        `INSERT INTO gradebook_correction_request_events
         (correction_id, event_type, previous_status, new_status,
          proposal_snapshot_json, event_reason, performed_by_user_id, request_version_after)
       VALUES (?, ?, 'SUBMITTED', ?, ?, ?, ?, ?)`,
        [
          correctionId,
          newStatus,
          newStatus,
          latest.proposal_snapshot_json,
          remarks,
          userId,
          nextVersion,
        ],
      );
      if (Number(event.affectedRows) !== 1)
        throw new Error("Review audit event was not saved.");
      if (body.dry_run) await connection.rollback();
      else await connection.commit();
      inTransaction = false;
      return res.json({
        success: true,
        dry_run: body.dry_run,
        persisted: !body.dry_run,
        correction_id: String(correctionId),
        action: body.action,
        request_status: newStatus,
        record_version: nextVersion,
        audit_event_id: body.dry_run ? null : String(event.insertId),
        official_grade_unchanged: true,
        assessment_score_unchanged: true,
        next_step:
          body.action === "APPROVE"
            ? "Registrar source-linked correction processing and official-sheet amendment. No official-grade update has occurred."
            : body.action === "RETURN"
              ? "Faculty must revise and resubmit through a separate controlled resubmission action."
              : "Request rejected; no official-grade changes made.",
      });
    } catch (error) {
      if (inTransaction && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("CORRECTION REVIEW ROLLBACK:", rollbackError);
        }
      }
      return gbCorrectionReviewSendError(res, error);
    } finally {
      connection?.release();
    }
  },
);

function phSheetFail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function phSheetError(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
  if (status === 500) console.error("PH OFFICIAL SHEET ERROR:", error);
  return res.status(status).json({
    success: false,
    code: status === 500 ? "PH_SHEET_INTERNAL_ERROR" : error.code,
    message:
      status === 500 ? "Could not process the official sheet." : error.message,
  });
}

function phSheetBody(body, allowed) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))
  ) {
    phSheetFail(
      "PH_SHEET_BODY_INVALID",
      "Invalid or unsupported JSON request fields.",
      400,
    );
  }
  if (typeof body.dry_run !== "boolean") {
    phSheetFail(
      "PH_SHEET_DRY_RUN_REQUIRED",
      "dry_run must be true or false.",
      400,
    );
  }
}

async function phSheetScope(connection, req, offeringId, lock = false) {
  const { userId, departmentId } = await incReviewAssertProgramHead(
    connection,
    req,
  );

  const [rows] = await connection.execute(
    `SELECT so.offering_id, so.status AS offering_status, so.academic_year_id,
            so.semester_id, cr.department_id, cfg.config_id,
            cfg.midterm_percent, cfg.final_term_percent
       FROM subject_offerings so
       JOIN sections sec ON sec.section_id = so.section_id
       JOIN courses cr ON cr.course_id = sec.course_id
       JOIN gradebook_offering_config cfg ON cfg.offering_id = so.offering_id
      WHERE so.offering_id = ? ${lock ? "FOR UPDATE" : ""}`,
    [offeringId],
  );
  if (rows.length !== 1) {
    phSheetFail(
      "PH_SHEET_SCOPE_NOT_FOUND",
      "A unique offering and gradebook are required.",
      404,
    );
  }
  const scope = rows[0];
  if (Number(scope.department_id) !== departmentId) {
    phSheetFail(
      "PH_SHEET_DEPARTMENT_FORBIDDEN",
      "This offering is outside your department.",
      403,
    );
  }
  if (
    scope.offering_status === "Cancelled" ||
    Number(scope.midterm_percent) !== 50 ||
    Number(scope.final_term_percent) !== 50
  ) {
    phSheetFail(
      "PH_SHEET_OFFERING_INVALID",
      "The offering or official 50/50 policy is unavailable.",
    );
  }
  return { ...scope, userId, departmentId };
}

async function phSheetRead(connection, configId, lock = false) {
  const [rows] = await connection.execute(
    `SELECT sheet_id, config_id, sheet_status, record_version,
            DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_date,
            official_submission_reference, official_date_verified_by_user_id,
            official_date_verified_at, finalized_roster_count,
            finalized_by_user_id, finalized_at, finalization_remarks
       FROM gradebook_official_sheets WHERE config_id = ?
       ${lock ? "FOR UPDATE" : ""}`,
    [configId],
  );
  if (rows.length !== 1) {
    phSheetFail(
      "PH_SHEET_NOT_RECORDED",
      "Registrar must first record a unique real original submission date and reference.",
      404,
    );
  }
  return rows[0];
}

async function phSheetAudit(connection, sheet, lock = false) {
  const [events] = await connection.execute(
    `SELECT event_type, previous_record_version, record_version_after,
            DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_date,
            official_submission_reference, performed_by_user_id
       FROM gradebook_official_sheet_submission_events
      WHERE sheet_id = ? ORDER BY record_version_after, event_id
      ${lock ? "FOR UPDATE" : ""}`,
    [String(sheet.sheet_id)],
  );
  const recorded = events[0];
  const verified = events[1];
  const baseValid =
    recorded?.event_type === "RECORDED" &&
    recorded.previous_record_version == null &&
    Number(recorded.record_version_after) === 1 &&
    recorded.original_date === sheet.original_date &&
    recorded.official_submission_reference ===
      sheet.official_submission_reference &&
    Number(recorded.performed_by_user_id) > 0;
  const verifiedValid =
    baseValid &&
    events.length === 2 &&
    verified?.event_type === "VERIFIED" &&
    Number(verified.previous_record_version) === 1 &&
    Number(verified.record_version_after) === 2 &&
    verified.original_date === sheet.original_date &&
    verified.official_submission_reference ===
      sheet.official_submission_reference &&
    Number(verified.performed_by_user_id) ===
      Number(sheet.official_date_verified_by_user_id);
  let verifiedByProgramHead = false;
  if (verifiedValid) {
    const [[actor]] = await connection.execute(
      `SELECT r.role_name FROM users u
       JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = ?`,
      [sheet.official_date_verified_by_user_id],
    );
    verifiedByProgramHead = actor?.role_name === "Program Head";
  }
  return { events, baseValid, verifiedValid, verifiedByProgramHead };
}

// PH verification is separate from Registrar's record-submission action.
// POST /api/program-head/gradebook/official-sheets/:offeringId/verify-submission
router.post(
  "/gradebook/official-sheets/:offeringId/verify-submission",
  async (req, res) => {
    let connection;
    let inTransaction = false;
    try {
      if (Object.keys(req.query ?? {}).length)
        phSheetFail(
          "PH_SHEET_QUERY_UNSUPPORTED",
          "Query parameters are not accepted.",
          400,
        );
      const offeringId = periodPositiveId(req.params.offeringId);
      if (!offeringId)
        phSheetFail(
          "PH_SHEET_ID_INVALID",
          "A positive offering ID is required.",
          400,
        );
      phSheetBody(req.body, [
        "expected_sheet_version",
        "confirm_original_date",
        "dry_run",
      ]);
      const version = periodPositiveId(req.body.expected_sheet_version);
      if (!version || req.body.confirm_original_date !== true) {
        phSheetFail(
          "PH_SHEET_VERIFY_INPUT_INVALID",
          "Provide the sheet version and confirm_original_date true.",
          400,
        );
      }
      connection = await db.getConnection();

      await connection.beginTransaction();
      inTransaction = true;

      // Authorize date verification against the actual connected database.
      const [databaseRows] = await connection.execute(
        "SELECT DATABASE() AS database_name",
      );

      const activeDatabase =
        Array.isArray(databaseRows) && databaseRows.length === 1
          ? databaseRows[0]?.database_name
          : null;

      const isQaDatabase = activeDatabase === "databaseforptc1_admission_test";

      if (typeof activeDatabase !== "string" || !activeDatabase.trim()) {
        phSheetFail(
          "PH_SHEET_VERIFY_DATABASE_UNKNOWN",
          "Could not verify the connected database.",
          403,
        );
      }

      if (isQaDatabase) {
        if (process.env.NODE_ENV === "production") {
          phSheetFail(
            "PH_SHEET_VERIFY_QA_PRODUCTION_FORBIDDEN",
            "QA date verification is disabled in production.",
            403,
          );
        }

        if (
          req.body.dry_run !== true &&
          process.env.GRADEBOOK_OFFICIAL_SHEET_VERIFY_WRITES_ENABLED !== "true"
        ) {
          phSheetFail(
            "PH_SHEET_VERIFY_WRITES_DISABLED",
            "Official submission-date verification writes are disabled.",
            403,
          );
        }
      } else {
        const configuredDatabase = process.env.DB_NAME?.trim();
        const targetDatabase =
          process.env.GRADEBOOK_OFFICIAL_SHEET_VERIFY_TARGET_DATABASE?.trim();

        if (
          process.env.GRADEBOOK_OFFICIAL_SHEET_VERIFY_WRITES_ENABLED !== "true"
        ) {
          phSheetFail(
            "PH_SHEET_VERIFY_WRITES_DISABLED",
            "Official submission-date verification is disabled.",
            403,
          );
        }

        if (
          !configuredDatabase ||
          !targetDatabase ||
          activeDatabase !== configuredDatabase ||
          activeDatabase !== targetDatabase
        ) {
          phSheetFail(
            "PH_SHEET_VERIFY_DATABASE_MISMATCH",
            "The connected database is not authorized for date verification.",
            403,
          );
        }

        if (
          process.env.NODE_ENV === "production" &&
          process.env.GRADEBOOK_OFFICIAL_SHEET_VERIFY_PRODUCTION_ENABLED !==
            "true"
        ) {
          phSheetFail(
            "PH_SHEET_VERIFY_PRODUCTION_DISABLED",
            "Production verification requires separate authorization.",
            403,
          );
        }
      }

      const scope = await phSheetScope(connection, req, offeringId, true);

      const sheet = await phSheetRead(connection, scope.config_id, true);
      const audit = await phSheetAudit(connection, sheet, true);
      const [[clock]] = await connection.execute(
        "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today",
      );
      if (
        sheet.sheet_status !== "IN_PROGRESS" ||
        Number(sheet.record_version) !== version ||
        version !== 1 ||
        sheet.official_date_verified_at != null ||
        sheet.official_date_verified_by_user_id != null
      ) {
        phSheetFail(
          "PH_SHEET_VERIFY_CONFLICT",
          "Only the unverified, unchanged original sheet may be verified.",
        );
      }
      if (
        !audit.baseValid ||
        audit.events.length !== 1 ||
        !sheet.original_date ||
        !String(sheet.official_submission_reference ?? "").trim() ||
        sheet.original_date > clock.today
      ) {
        phSheetFail(
          "PH_SHEET_SOURCE_INVALID",
          "Recorded source and RECORDED audit must agree with a genuine nonfuture date.",
        );
      }
      const [update] = await connection.execute(
        `UPDATE gradebook_official_sheets
          SET official_date_verified_by_user_id = ?, official_date_verified_at = NOW(),
              updated_by_user_id = ?, record_version = record_version + 1
        WHERE sheet_id = ? AND sheet_status = 'IN_PROGRESS' AND record_version = 1
          AND official_date_verified_by_user_id IS NULL AND official_date_verified_at IS NULL`,
        [scope.userId, scope.userId, String(sheet.sheet_id)],
      );
      if (Number(update.affectedRows) !== 1)
        phSheetFail(
          "PH_SHEET_VERIFY_CONFLICT",
          "Sheet changed before verification.",
        );
      const [event] = await connection.execute(
        `INSERT INTO gradebook_official_sheet_submission_events
       (sheet_id, event_type, previous_record_version, record_version_after,
        original_official_submitted_on, official_submission_reference, performed_by_user_id)
       VALUES (?, 'VERIFIED', 1, 2, ?, ?, ?)`,
        [
          String(sheet.sheet_id),
          sheet.original_date,
          sheet.official_submission_reference,
          scope.userId,
        ],
      );
      if (Number(event.affectedRows) !== 1)
        throw new Error("Verification audit insert failed.");
      const [[deadlineRow]] = await connection.execute(
        "SELECT DATE_FORMAT(DATE_ADD(?, INTERVAL 1 YEAR), '%Y-%m-%d') AS deadline",
        [sheet.original_date],
      );
      if (!deadlineRow?.deadline)
        throw new Error("Original submission deadline calculation failed.");
      if (req.body.dry_run) await connection.rollback();
      else await connection.commit();
      inTransaction = false;
      return res.json({
        success: true,
        action: "VERIFY_ORIGINAL_DATE",
        persisted: !req.body.dry_run,
        dry_run: req.body.dry_run,
        sheet_id: String(sheet.sheet_id),
        record_version: req.body.dry_run ? version : version + 1,
        original_official_submitted_on: sheet.original_date,
        proposed_inc_completion_deadline_on: deadlineRow.deadline,
        inc_completion_deadline_on: req.body.dry_run
          ? null
          : deadlineRow.deadline,
        grades_modified: false,
        finalized: false,
      });
    } catch (error) {
      if (inTransaction && connection)
        try {
          await connection.rollback();
        } catch (e) {
          console.error("PH SHEET VERIFY ROLLBACK:", e);
        }
      return phSheetError(res, error);
    } finally {
      connection?.release();
    }
  },
);

// The publication uses exact rational term percentages. Never use rounded UI
// percentages for pass/fail or conversion during sheet finalization.
const phSheetScale12 = 1000000000000n;

function phSheetRational(numerator, denominator) {
  const nText = String(numerator ?? "").trim();
  const dText = String(denominator ?? "").trim();
  if (!/^\d{1,1200}$/.test(nText) || !/^\d{1,1200}$/.test(dText)) return null;
  const n = BigInt(nText);
  const d = BigInt(dText);
  if (d === 0n || n > d * 100n) return null;
  return { n, d };
}

function phSheetDecimal12(value) {
  const text = String(value ?? "").trim();
  if (!/^(0|[1-9]\d{0,2})(?:\.(\d{1,12}))?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * phSheetScale12 + BigInt(fraction.padEnd(12, "0"));
}

function phSheetSameRounded12(saved, ratio) {
  const scaled = phSheetDecimal12(saved);
  if (scaled === null || ratio === null) return false;
  // Match MariaDB DECIMAL(15,12) rounding (half up for nonnegative grades).
  const rounded = (2n * ratio.n * phSheetScale12 + ratio.d) / (2n * ratio.d);
  return scaled === rounded;
}

function phSheetNumericEquivalent(ratio) {
  for (const [minimum, rating] of [
    [97n, 1.0],
    [94n, 1.25],
    [91n, 1.5],
    [88n, 1.75],
    [85n, 2.0],
    [82n, 2.25],
    [79n, 2.5],
    [76n, 2.75],
    [75n, 3.0],
  ]) {
    if (ratio.n >= minimum * ratio.d) return rating;
  }
  return 5.0;
}

function phSheetPublishedTermSnapshot(raw, term, grade, ratio) {
  let snapshot;
  try {
    snapshot = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return false;
  }
  const percent = snapshot?.calculated_term?.term_percentage;
  const snapshotRatio = phSheetRational(
    percent?.exact_numerator,
    percent?.exact_denominator,
  );
  return (
    Boolean(snapshotRatio) &&
    snapshot?.policy === "TWO_TERM_50_50" &&
    snapshot.grading_term === term &&
    Number(snapshot.config_id) === Number(grade.config_id) &&
    Number(snapshot.enrollment_subject_id) ===
      Number(grade.enrollment_subject_id) &&
    Number(snapshot.student_id) === Number(grade.student_id) &&
    snapshot.calculated_term?.state === "READY" &&
    snapshotRatio.n * ratio.d === ratio.n * snapshotRatio.d
  );
}

function phSheetPublishedNumericValid(grade, publication) {
  if (
    !publication ||
    Number(publication.grade_id) !== Number(grade.grade_id) ||
    Number(publication.enrollment_subject_id) !==
      Number(grade.enrollment_subject_id) ||
    Number(publication.config_id) !== Number(grade.config_id) ||
    publication.midterm_status !== "APPROVED" ||
    publication.final_status !== "APPROVED" ||
    publication.midterm_term !== "MIDTERM" ||
    publication.final_term !== "FINAL_TERM"
  )
    return false;
  const midterm = phSheetRational(publication.midterm_n, publication.midterm_d);
  const finalTerm = phSheetRational(publication.final_n, publication.final_d);
  const overall = phSheetRational(publication.overall_n, publication.overall_d);
  if (!midterm || !finalTerm || !overall) return false;
  if (
    (midterm.n * finalTerm.d + finalTerm.n * midterm.d) * overall.d !==
    2n * midterm.d * finalTerm.d * overall.n
  )
    return false;
  if (
    !phSheetPublishedTermSnapshot(
      publication.midterm_snapshot,
      "MIDTERM",
      grade,
      midterm,
    ) ||
    !phSheetPublishedTermSnapshot(
      publication.final_snapshot,
      "FINAL_TERM",
      grade,
      finalTerm,
    )
  )
    return false;
  if (
    !phSheetSameRounded12(grade.midterm_grade, midterm) ||
    !phSheetSameRounded12(grade.final_grade, finalTerm) ||
    !phSheetSameRounded12(grade.overall_percentage, overall)
  )
    return false;
  const passed = overall.n >= 75n * overall.d;
  return (
    Number(grade.final_rating) === phSheetNumericEquivalent(overall) &&
    grade.subject_status === (passed ? "Completed" : "Failed") &&
    grade.remarks === (passed ? "Passed" : "Failed")
  );
}

// Verified historical evidence is an alternative provenance source, not a
// substitute for missing modern publication or term-submission records.
function phSheetHistoricalSourceValid(review, row, events) {
  if (!review || !row || !Array.isArray(events) || events.length !== 2)
    return false;
  const [recorded, verified] = events;
  if (
    review.review_status !== "VERIFIED" ||
    Number(review.record_version) !== 2 ||
    Number(review.grade_id) !== Number(row.grade_id) ||
    Number(review.enrollment_subject_id) !==
      Number(row.enrollment_subject_id) ||
    Number(review.offering_id) !== Number(row.offering_id) ||
    !review.reviewed_at ||
    !review.reviewed_by_user_id ||
    !review.recorded_by_user_id ||
    Number(review.recorded_by_user_id) === Number(review.reviewed_by_user_id) ||
    typeof review.source_reference !== "string" ||
    review.source_reference.trim().length < 8 ||
    typeof review.evidence_summary !== "string" ||
    review.evidence_summary.trim().length < 30 ||
    typeof review.review_remarks !== "string" ||
    review.review_remarks.trim().length < 15
  )
    return false;
  if (
    row.grade_status !== "Approved" ||
    row.grading_outcome !== "NUMERIC" ||
    !["LEGACY", "TWO_TERM_50_50"].includes(row.grading_policy) ||
    row.final_rating == null ||
    !["Passed", "Failed"].includes(row.remarks) ||
    row.subject_status !==
      (row.remarks === "Passed" ? "Completed" : "Failed") ||
    row.enrollment_status !== "Approved" ||
    row.reviewed_by == null ||
    row.reviewed_at == null
  )
    return false;
  const classification =
    row.grading_policy === "LEGACY"
      ? "LEGACY_POLICY"
      : "APPROVED_WITHOUT_PUBLICATION";
  if (
    review.source_classification !== classification ||
    recorded.event_type !== "RECORDED" ||
    recorded.previous_status != null ||
    recorded.new_status !== "PENDING_PH_REVIEW" ||
    Number(recorded.review_version_after) !== 1 ||
    Number(recorded.performed_by_user_id) !==
      Number(review.recorded_by_user_id) ||
    recorded.event_reason !== review.evidence_summary ||
    verified.event_type !== "VERIFIED" ||
    verified.previous_status !== "PENDING_PH_REVIEW" ||
    verified.new_status !== "VERIFIED" ||
    Number(verified.review_version_after) !== 2 ||
    Number(verified.performed_by_user_id) !==
      Number(review.reviewed_by_user_id) ||
    verified.event_reason !== review.review_remarks
  )
    return false;
  const original = phHistoricalJSON(review.original_grade_snapshot_json);
  const recordedSnapshot = phHistoricalJSON(recorded.source_snapshot_json);
  const verifiedSnapshot = phHistoricalJSON(verified.source_snapshot_json);
  if (
    !original ||
    !recordedSnapshot ||
    !verifiedSnapshot ||
    JSON.stringify(original) !== JSON.stringify(recordedSnapshot) ||
    JSON.stringify(original) !== JSON.stringify(verifiedSnapshot) ||
    original.source_classification !== classification ||
    original.source_reference !== review.source_reference ||
    original.evidence_summary !== review.evidence_summary
  )
    return false;
  return [
    "grade_id",
    "enrollment_subject_id",
    "offering_id",
    "student_id",
    "student_number",
    "faculty_id",
    "grade_status",
    "grading_policy",
    "grading_outcome",
    "midterm_grade",
    "final_grade",
    "overall_percentage",
    "final_rating",
    "remarks",
    "reviewed_by",
    "reviewed_at",
    "submitted_at",
    "subject_status",
    "enrollment_status",
    "enrollment_type",
    "academic_year_id",
    "semester_id",
  ].every(
    (field) =>
      Object.prototype.hasOwnProperty.call(original, field) &&
      phHistoricalEqual(original[field], row[field]),
  );
}

/* Combined Semester Publication */

function phSheetPublishedCombinedNumericValid(
  row,
  source,
  sheetId,
  departmentId,
) {
  if (
    !source ||
    source.publication_source !== "COMBINED_SEMESTER" ||
    source.midterm_submission_id != null ||
    source.final_term_submission_id != null ||
    String(source.publication_grade_id) !== String(row.grade_id) ||
    Number(source.publication_config_id) !== Number(row.config_id) ||
    Number(source.publication_subject_id) !==
      Number(row.enrollment_subject_id) ||
    String(source.combined_submission_id) !== String(source.submission_id) ||
    String(source.attempt_grade_id) !== String(row.grade_id) ||
    String(source.sheet_id) !== String(sheetId) ||
    Number(source.sheet_config_id) !== Number(row.config_id) ||
    source.sheet_status !== "IN_PROGRESS" ||
    Number(source.period_department_id) !== Number(departmentId) ||
    Number(source.period_year_id) !== Number(row.academic_year_id) ||
    Number(source.period_semester_id) !== Number(row.semester_id) ||
    String(source.latest_submission_id) !== String(source.submission_id) ||
    Number(source.term_attempts_count) !== 0 ||
    source.grading_scope !== "FULL_SEMESTER" ||
    source.attempt_outcome !== "NUMERIC" ||
    source.published_outcome !== "NUMERIC" ||
    source.submission_status !== "APPROVED" ||
    source.special_outcome_id != null ||
    source.returned_edit_scope != null ||
    !source.attempt_submitted_at ||
    !source.attempt_reviewed_at ||
    !source.published_at ||
    !String(source.review_remarks ?? "").trim() ||
    source.review_decision !== "APPROVED" ||
    source.review_outcome !== "NUMERIC" ||
    source.review_return_scope != null ||
    source.review_notes !== source.review_remarks ||
    Number(source.submission_version_after) !== Number(source.record_version) ||
    Number(source.review_actor) !== Number(source.attempt_reviewer_id) ||
    Number(source.published_by_user_id) !==
      Number(source.attempt_reviewer_id) ||
    Number(source.reviewer_active) !== 1 ||
    Number(source.reviewer_archived) !== 0 ||
    source.reviewer_role !== "Program Head" ||
    Number(source.reviewer_department_ok) !== 1 ||
    Number(source.instructor_faculty_id) !== Number(row.faculty_id) ||
    Number(source.instructor_user_id) !== Number(source.submitted_by_user_id) ||
    Number(source.is_self_approval) !==
      Number(
        Number(source.submitted_by_user_id) === Number(source.review_actor),
      ) ||
    row.grade_status !== "Approved" ||
    row.grading_policy !== "TWO_TERM_50_50" ||
    row.grading_outcome !== "NUMERIC" ||
    !row.reviewed_at ||
    !row.submitted_at ||
    Number(row.reviewed_by) !== Number(source.review_actor) ||
    Number(row.inc_approved_count) !== 0 ||
    Number(row.ud_approved_count) !== 0 ||
    Number(row.special_count) !== 0
  ) {
    return false;
  }

  let snapshot;

  try {
    snapshot =
      typeof source.calculation_snapshot_json === "string"
        ? JSON.parse(source.calculation_snapshot_json)
        : source.calculation_snapshot_json;
  } catch {
    return false;
  }

  if (
    !snapshot ||
    snapshot.policy !== "TWO_TERM_50_50" ||
    snapshot.grading_scope !== "FULL_SEMESTER" ||
    Number(snapshot.offering_id) !== Number(row.offering_id) ||
    Number(snapshot.config_id) !== Number(row.config_id) ||
    Number(snapshot.grade_id) !== Number(row.grade_id) ||
    Number(snapshot.enrollment_subject_id) !==
      Number(row.enrollment_subject_id) ||
    Number(snapshot.student?.student_id) !== Number(row.student_id) ||
    Number(snapshot.term_weights?.MIDTERM) !== 50 ||
    Number(snapshot.term_weights?.FINAL_TERM) !== 50 ||
    snapshot.calculated_terms?.MIDTERM?.state !== "READY" ||
    snapshot.calculated_terms?.FINAL_TERM?.state !== "READY" ||
    snapshot.calculated_semester?.state !== "READY"
  ) {
    return false;
  }

  const numeric = (value, max) =>
    /^(0|[1-9]\d*)$/.test(String(value ?? "")) && String(value).length <= max;

  const triplets = [
    [
      source.midterm_n,
      source.midterm_d,
      snapshot.calculated_terms.MIDTERM.term_percentage,
      255,
    ],
    [
      source.final_n,
      source.final_d,
      snapshot.calculated_terms.FINAL_TERM.term_percentage,
      255,
    ],
    [
      source.overall_n,
      source.overall_d,
      snapshot.calculated_semester.semester_percentage,
      1200,
    ],
  ];

  if (
    triplets.some(
      ([n, d, value, max]) =>
        !numeric(n, max) ||
        !numeric(d, max) ||
        String(d) === "0" ||
        String(n) !== String(value?.exact_numerator) ||
        String(d) !== String(value?.exact_denominator),
    )
  ) {
    return false;
  }

  const mid = phSheetRational(source.midterm_n, source.midterm_d);
  const fin = phSheetRational(source.final_n, source.final_d);
  const overall = phSheetRational(source.overall_n, source.overall_d);

  if (
    !mid ||
    !fin ||
    !overall ||
    (mid.n * fin.d + fin.n * mid.d) * overall.d !==
      2n * mid.d * fin.d * overall.n ||
    String(source.published_n) !== String(source.overall_n) ||
    String(source.published_d) !== String(source.overall_d) ||
    !phSheetSameRounded12(source.midterm_percentage_snapshot, mid) ||
    !phSheetSameRounded12(source.final_term_percentage_snapshot, fin) ||
    !phSheetSameRounded12(source.overall_percentage_snapshot, overall) ||
    !phSheetSameRounded12(row.midterm_grade, mid) ||
    !phSheetSameRounded12(row.final_grade, fin)
  ) {
    return false;
  }

  // The grade trigger averages the saved 12-decimal term values.
  // Preserve exact-fraction grading while checking that stored result.
  const storedMid = phSheetDecimal12(row.midterm_grade);
  const storedFin = phSheetDecimal12(row.final_grade);
  const storedOverall = phSheetDecimal12(row.overall_percentage);

  const exactOverall =
    (2n * overall.n * phSheetScale12 + overall.d) / (2n * overall.d);

  if (
    storedMid == null ||
    storedFin == null ||
    storedOverall == null ||
    storedOverall !== (storedMid + storedFin + 1n) / 2n ||
    (storedOverall > exactOverall
      ? storedOverall - exactOverall
      : exactOverall - storedOverall) > 1n
  ) {
    return false;
  }

  const rating = phSheetNumericEquivalent(overall);
  const passed = overall.n >= 75n * overall.d;

  return (
    Number(source.final_rating_snapshot) === rating &&
    Number(snapshot.calculated_semester.numeric_equivalent) === rating &&
    Number(row.final_rating) === rating &&
    row.remarks === (passed ? "Passed" : "Failed") &&
    row.subject_status === (passed ? "Completed" : "Failed")
  );
}
// Validate INC approvals created before the special-outcome mirror.
async function phSheetLegacyIncSourceValid(
  connection,
  scope,
  grade,
  lock = false,
) {
  const reject = (reason) => {
    console.warn("[INC SOURCE VALIDATION FAILED]", {
      grade_id: grade.grade_id,
      reason,
    });

    return false;
  };

  console.log("[INC SOURCE VALIDATION START]", {
    grade_id: grade.grade_id,
    config_id: scope.config_id,
    special_count: grade.special_count,
    inc_approved_count: grade.inc_approved_count,
    grade_status: grade.grade_status,
    grading_policy: grade.grading_policy,
    grading_outcome: grade.grading_outcome,
    subject_status: grade.subject_status,
    remarks: grade.remarks,
  });

  if (
    grade.grade_status !== "Approved" ||
    grade.grading_policy !== "TWO_TERM_50_50" ||
    grade.grading_outcome !== "INCOMPLETE" ||
    grade.subject_status !== "Incomplete" ||
    grade.remarks !== "Incomplete" ||
    Number(grade.final_rating) !== 4 ||
    Number(grade.special_count) !== 0 ||
    Number(grade.inc_approved_count) !== 1 ||
    grade.final_grade != null ||
    grade.overall_percentage != null
  ) {
    return reject("INVALID_ORIGINAL_INC_GRADE");
  }

  const [sources] = await connection.execute(
    `SELECT ir.*,
            g.outcome_reason AS grade_outcome_reason,
            g.submitted_at AS grade_submitted_at,
            g.reviewed_at AS grade_reviewed_at,
            g.reviewed_by AS grade_reviewed_by,
            f.user_id AS grade_faculty_user_id,
            mt.term_submission_id AS midterm_id,
            mt.grading_term AS midterm_term,
            mt.submission_status AS midterm_status,
            mt.reviewed_by_user_id AS midterm_reviewed_by,
            mt.reviewed_at AS midterm_reviewed_at,
            mt.term_percentage_exact_numerator AS midterm_n,
            mt.term_percentage_exact_denominator AS midterm_d,
            mt.calculation_snapshot_json AS midterm_snapshot,
            (
              SELECT t.term_submission_id
              FROM gradebook_term_submission_attempts t
              WHERE t.config_id = ir.config_id
                AND t.enrollment_subject_id = ir.enrollment_subject_id
                AND t.grading_term = 'MIDTERM'
              ORDER BY t.attempt_number DESC,
                       t.term_submission_id DESC
              LIMIT 1
            ) AS latest_midterm_id,
            (
              SELECT COUNT(*)
              FROM gradebook_term_submission_attempts t
              WHERE t.config_id = ir.config_id
                AND t.enrollment_subject_id = ir.enrollment_subject_id
                AND t.grading_term = 'FINAL_TERM'
            ) AS final_term_count
       FROM gradebook_inc_outcome_requests ir
       JOIN grades g
         ON g.enrollment_subject_id = ir.enrollment_subject_id
       JOIN faculty f
         ON f.faculty_id = g.faculty_id
       JOIN gradebook_term_submission_attempts mt
         ON mt.term_submission_id = ir.midterm_submission_id
        AND mt.config_id = ir.config_id
        AND mt.enrollment_subject_id = ir.enrollment_subject_id
      WHERE ir.config_id = ?
        AND ir.enrollment_subject_id = ?
        AND g.grade_id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM gradebook_grade_submission_attempts a
          JOIN grades ag ON ag.grade_id = a.grade_id
          WHERE ag.enrollment_subject_id = ir.enrollment_subject_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM gradebook_official_grade_publications p
          WHERE p.grade_id = g.grade_id
             OR p.enrollment_subject_id = ir.enrollment_subject_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM gradebook_special_outcomes so
          WHERE so.grade_id = g.grade_id
        )
      ${lock ? "FOR UPDATE" : ""}`,
    [scope.config_id, grade.enrollment_subject_id, grade.grade_id],
  );

  console.log("[INC SOURCE QUERY]", {
    source_count: sources.length,
  });

  if (sources.length !== 1) {
    return reject("INC_SOURCE_MISSING_OR_DUPLICATE");
  }

  const source = sources[0];

  if (
    source.request_status !== "APPROVED" ||
    source.midterm_term !== "MIDTERM" ||
    source.midterm_status !== "APPROVED" ||
    !source.midterm_reviewed_by ||
    !source.midterm_reviewed_at ||
    String(source.midterm_id) !== String(source.latest_midterm_id) ||
    Number(source.final_term_count) !== 0 ||
    !source.submitted_at ||
    !source.reviewed_at ||
    !source.grade_submitted_at ||
    !source.grade_reviewed_at ||
    !String(source.review_remarks ?? "").trim() ||
    !String(source.outcome_reason ?? "").trim() ||
    !String(source.evidence_summary ?? "").trim() ||
    source.outcome_reason !== source.grade_outcome_reason ||
    Number(source.reviewed_by_user_id) !== Number(source.grade_reviewed_by) ||
    Number(source.submitted_by_user_id) !== Number(source.grade_faculty_user_id)
  ) {
    return reject("INC_REQUEST_SOURCE_INVALID");
  }

  const [events] = await connection.execute(
    `SELECT *
       FROM gradebook_inc_outcome_request_events
      WHERE inc_request_id = ?
      ORDER BY request_version_after, event_id
      ${lock ? "FOR UPDATE" : ""}`,
    [source.inc_request_id],
  );

  console.log("[INC AUDIT VALIDATION]", {
    event_count: events.length,
    request_version: source.record_version,
  });

  if (events.length < 2 || events.length !== Number(source.record_version)) {
    return reject("INC_AUDIT_COUNT_INVALID");
  }

  const first = events[0];
  const last = events[events.length - 1];

  if (
    first.event_type !== "SUBMITTED" ||
    first.previous_status != null ||
    first.new_status !== "SUBMITTED" ||
    Number(first.performed_by_user_id) !==
      Number(source.submitted_by_user_id) ||
    last.event_type !== "APPROVED" ||
    last.previous_status !== "SUBMITTED" ||
    last.new_status !== "APPROVED" ||
    Number(last.performed_by_user_id) !== Number(source.reviewed_by_user_id) ||
    last.reason_snapshot !== source.outcome_reason ||
    last.evidence_snapshot !== source.evidence_summary ||
    last.event_reason !== source.review_remarks
  ) {
    return reject("INC_AUDIT_SOURCE_MISMATCH");
  }

  const allowedTransitions = new Set([
    "SUBMITTED:RETURNED:RETURNED",
    "RETURNED:RESUBMITTED:SUBMITTED",
    "SUBMITTED:APPROVED:APPROVED",
  ]);

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (Number(event.request_version_after) !== i + 1) {
      return reject("INC_AUDIT_VERSION_INVALID");
    }

    if (i === 0) continue;

    if (event.previous_status !== events[i - 1].new_status) {
      return reject("INC_AUDIT_SEQUENCE_INVALID");
    }

    const transition = `${event.previous_status}:${event.event_type}:${event.new_status}`;

    if (!allowedTransitions.has(transition)) {
      return reject("INC_AUDIT_TRANSITION_INVALID");
    }

    if (event.event_type === "APPROVED" && i !== events.length - 1) {
      return reject("INC_AUDIT_PREMATURE_APPROVAL");
    }
  }

  const midtermRatio = phSheetRational(source.midterm_n, source.midterm_d);

  console.log("[INC MIDTERM VALIDATION]", {
    stored_midterm_grade: grade.midterm_grade,
    exact_numerator: source.midterm_n,
    exact_denominator: source.midterm_d,
    ratio_valid: Boolean(midtermRatio),
  });

  if (
    !midtermRatio ||
    !phSheetSameRounded12(grade.midterm_grade, midtermRatio)
  ) {
    return reject("INC_MIDTERM_CALCULATION_MISMATCH");
  }

  const snapshotValid = phSheetPublishedTermSnapshot(
    source.midterm_snapshot,
    "MIDTERM",
    { ...grade, config_id: scope.config_id },
    midtermRatio,
  );

  console.log("[INC SNAPSHOT VALIDATION]", {
    snapshot_valid: snapshotValid,
    student_id: grade.student_id,
    config_id: scope.config_id,
    enrollment_subject_id: grade.enrollment_subject_id,
  });

  if (!snapshotValid) {
    return reject("INC_MIDTERM_SNAPSHOT_INVALID");
  }

  console.log("[INC SOURCE VALIDATION PASSED]", {
    grade_id: grade.grade_id,
    inc_request_id: source.inc_request_id,
    midterm_submission_id: source.midterm_id,
  });

  return true;
}
async function phSheetPublishedCombinedSpecialValid(
  connection,
  scope,
  row,
  source,
  sheetId,
  lock = false,
) {
  const departmentId = scope.departmentId;
  const type = row.grading_outcome;
  const inc = type === "INCOMPLETE";
  if (
    !["INCOMPLETE", "UNOFFICIAL_DROP"].includes(type) ||
    !source ||
    source.publication_source !== "COMBINED_SEMESTER" ||
    source.midterm_submission_id != null ||
    source.final_term_submission_id != null ||
    String(source.publication_grade_id) !== String(row.grade_id) ||
    Number(source.publication_config_id) !== Number(row.config_id) ||
    Number(source.publication_subject_id) !==
      Number(row.enrollment_subject_id) ||
    String(source.combined_submission_id) !== String(source.submission_id) ||
    String(source.attempt_grade_id) !== String(row.grade_id) ||
    String(source.sheet_id) !== String(sheetId) ||
    Number(source.sheet_config_id) !== Number(row.config_id) ||
    source.sheet_status !== "IN_PROGRESS" ||
    Number(source.period_department_id) !== Number(departmentId) ||
    Number(source.period_year_id) !== Number(row.academic_year_id) ||
    Number(source.period_semester_id) !== Number(row.semester_id) ||
    String(source.latest_submission_id) !== String(source.submission_id) ||
    Number(source.term_attempts_count) !== 0 ||
    source.grading_scope !== "FULL_SEMESTER" ||
    source.attempt_outcome !== type ||
    source.published_outcome !== type ||
    source.submission_status !== "APPROVED" ||
    !periodPositiveId(source.special_outcome_id) ||
    source.returned_edit_scope != null ||
    !source.attempt_submitted_at ||
    !source.attempt_reviewed_at ||
    !source.published_at ||
    !String(source.review_remarks ?? "").trim() ||
    source.review_decision !== "APPROVED" ||
    source.review_outcome !== type ||
    source.review_return_scope != null ||
    source.review_notes !== source.review_remarks ||
    Number(source.submission_version_after) !== Number(source.record_version) ||
    Number(source.review_actor) !== Number(source.attempt_reviewer_id) ||
    Number(source.published_by_user_id) !==
      Number(source.attempt_reviewer_id) ||
    Number(source.reviewer_active) !== 1 ||
    Number(source.reviewer_archived) !== 0 ||
    source.reviewer_role !== "Program Head" ||
    Number(source.reviewer_department_ok) !== 1 ||
    Number(source.instructor_faculty_id) !== Number(row.faculty_id) ||
    Number(source.instructor_user_id) !== Number(source.submitted_by_user_id) ||
    Number(source.is_self_approval) !==
      Number(
        Number(source.submitted_by_user_id) === Number(source.review_actor),
      ) ||
    row.grade_status !== "Approved" ||
    row.grading_policy !== "TWO_TERM_50_50" ||
    row.grading_outcome !== type ||
    !row.reviewed_at ||
    !row.submitted_at ||
    Number(row.reviewed_by) !== Number(source.review_actor) ||
    Number(row.inc_approved_count) !== 0 ||
    Number(row.ud_approved_count) !== 0 ||
    Number(row.special_count) !== 1 ||
    Number(source.record_version) !== 2 ||
    !Number.isSafeInteger(Number(source.attempt_number)) ||
    Number(source.attempt_number) < 1 ||
    source.review_batch_ref != null ||
    typeof source.evidence_review_notes !== "string" ||
    source.evidence_review_notes.trim().length < 20 ||
    source.evidence_review_notes.trim().length > 1000 ||
    source.published_n !== null ||
    source.published_d !== null ||
    row.subject_status !== (inc ? "Incomplete" : "Unofficial Drop")
  ) {
    return false;
  }

  const snapshot = phHistoricalJSON(source.calculation_snapshot_json);
  if (
    !snapshot ||
    snapshot.policy !== "TWO_TERM_50_50" ||
    snapshot.grading_scope !== "FULL_SEMESTER" ||
    Number(snapshot.offering_id) !== Number(row.offering_id) ||
    Number(snapshot.config_id) !== Number(row.config_id) ||
    Number(snapshot.grade_id) !== Number(row.grade_id) ||
    Number(snapshot.enrollment_subject_id) !==
      Number(row.enrollment_subject_id) ||
    Number(snapshot.student?.student_id) !== Number(row.student_id) ||
    Number(snapshot.term_weights?.MIDTERM) !== 50 ||
    Number(snapshot.term_weights?.FINAL_TERM) !== 50
  )
    return false;

  const [legacy] = await connection.execute(
    `SELECT
       EXISTS (SELECT 1 FROM gradebook_term_structure_locks WHERE config_id = ?) AS term_lock,
       EXISTS (SELECT 1 FROM gradebook_inc_outcome_requests WHERE config_id = ? AND enrollment_subject_id = ? AND request_status IN ('SUBMITTED','APPROVED')) AS active_inc,
       EXISTS (SELECT 1 FROM gradebook_ud_outcome_requests WHERE config_id = ? AND enrollment_subject_id = ? AND request_status IN ('SUBMITTED','APPROVED')) AS active_ud`,
    [
      row.config_id,
      row.config_id,
      row.enrollment_subject_id,
      row.config_id,
      row.enrollment_subject_id,
    ],
  );
  if (
    legacy.length !== 1 ||
    Number(legacy[0].term_lock) ||
    Number(legacy[0].active_inc) ||
    Number(legacy[0].active_ud)
  )
    return false;

  const [locks] = await connection.execute(
    `SELECT l.first_submission_id, a.sheet_id
       FROM gradebook_structure_locks l
       JOIN gradebook_grade_submission_attempts a ON a.submission_id = l.first_submission_id
      WHERE l.config_id = ? ${lock ? "FOR UPDATE" : ""}`,
    [row.config_id],
  );
  if (locks.length !== 1 || String(locks[0].sheet_id) !== String(sheetId))
    return false;

  const submission = {
    ...source,
    grade_id: source.attempt_grade_id,
    grading_outcome_snapshot: source.attempt_outcome,
    special_outcome_reason_snapshot: source.special_outcome_reason_snapshot,

    midterm_exact_numerator: source.midterm_n,
    midterm_exact_denominator: source.midterm_d,
    final_term_exact_numerator: source.final_n,
    final_term_exact_denominator: source.final_d,
    overall_exact_numerator: source.overall_n,
    overall_exact_denominator: source.overall_d,
  };

  try {
    await validateOfficialSheetSpecialEvidence(
      connection,
      {
        ...row,
        sheet_id: source.sheet_id,
        period_id: source.period_id,
      },
      row,
      submission,
      snapshot,
      Number(source.review_actor),
      {
        expectedSubmissionVersion: 2,
        lock,
      },
    );

    if (inc) {
      const mid = phSheetRational(source.midterm_n, source.midterm_d);
      if (
        !mid ||
        !phSheetSameRounded12(row.midterm_grade, mid) ||
        !phSheetSameRounded12(source.midterm_percentage_snapshot, mid) ||
        !phSheetSameRounded12(snapshot.official_result.midterm_grade, mid)
      )
        return false;
    }
  } catch (error) {
    if (
      error?.code === "COMBINED_APPROVAL_SPECIAL_EVIDENCE_INVALID" ||
      error?.code === "COMBINED_APPROVAL_EXACT_SOURCE_INVALID" ||
      error?.code === "COMBINED_APPROVAL_PERCENT_INVALID" ||
      (typeof error?.code === "string" &&
        error.code.startsWith("SPECIAL_APPROVAL_"))
    ) {
      return false;
    }

    throw error;
  }
  return true;
}

async function phSheetInspect(connection, scope, lock = false) {
  const blockers = [];
  const sheet = await phSheetRead(connection, scope.config_id, lock);
  const audit = await phSheetAudit(connection, sheet, lock);
  if (sheet.sheet_status !== "IN_PROGRESS") blockers.push("ALREADY_FINALIZED");
  if (
    !sheet.original_date ||
    !String(sheet.official_submission_reference ?? "").trim() ||
    !sheet.official_date_verified_at ||
    !sheet.official_date_verified_by_user_id ||
    !audit.verifiedValid ||
    !audit.verifiedByProgramHead ||
    Number(sheet.record_version) !== 2
  ) {
    blockers.push("PROGRAM_HEAD_ORIGINAL_DATE_VERIFICATION_REQUIRED");
  }
  const [[clock]] = await connection.execute(
    "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today",
  );
  if (sheet.original_date > clock.today)
    blockers.push("ORIGINAL_DATE_IN_FUTURE");
  const [[priorSnapshot]] = await connection.execute(
    `SELECT COUNT(*) AS count FROM gradebook_finalized_roster WHERE sheet_id = ?`,
    [String(sheet.sheet_id)],
  );
  if (Number(priorSnapshot.count) !== 0)
    blockers.push("ROSTER_SNAPSHOT_ALREADY_EXISTS");

  const [roster] = await connection.execute(
    `SELECT es.enrollment_subject_id, es.enrollment_id, es.section_id,
            es.offering_id, es.enrollment_type, es.status AS subject_status,
            e.academic_year_id, e.semester_id, e.enrollment_status,
            s.student_id, s.student_number, s.first_name, s.middle_name, s.last_name,
            g.grade_id, g.faculty_id, g.grade_status, g.grading_policy, g.grading_outcome,
            g.midterm_grade, g.final_grade, g.overall_percentage,
            g.final_rating, g.remarks, g.outcome_reason, g.submitted_at, g.reviewed_by, g.reviewed_at,
            
(SELECT COUNT(*)
   FROM gradebook_official_grade_publications p
  WHERE p.grade_id = g.grade_id
    AND p.config_id = ?
    AND p.enrollment_subject_id = es.enrollment_subject_id
    AND p.grading_outcome_snapshot = 'NUMERIC'
) AS publication_count,

            (SELECT COUNT(*) FROM gradebook_special_outcomes so
              WHERE so.grade_id = g.grade_id AND so.record_status = 'ACTIVE'
                AND so.outcome_type = g.grading_outcome) AS special_count,
            (SELECT COUNT(*) FROM gradebook_inc_outcome_requests ir
              WHERE ir.config_id = ? AND ir.enrollment_subject_id = es.enrollment_subject_id
                AND ir.request_status = 'APPROVED') AS inc_approved_count,
            (SELECT COUNT(*) FROM gradebook_ud_outcome_requests ur
              WHERE ur.config_id = ? AND ur.enrollment_subject_id = es.enrollment_subject_id
                AND ur.request_status = 'APPROVED') AS ud_approved_count
       FROM enrollment_subjects es
       JOIN enrollments e ON e.enrollment_id = es.enrollment_id
       JOIN students s ON s.student_id = e.student_id
       LEFT JOIN grades g ON g.enrollment_subject_id = es.enrollment_subject_id
     WHERE es.offering_id = ?
  AND NOT (
    COALESCE(e.enrollment_status, '') = 'Rejected'
    AND COALESCE(es.status, '') = 'Enrolled'
    AND g.grade_id IS NULL
  ) ORDER BY s.student_number, es.enrollment_subject_id
      ${lock ? "FOR UPDATE" : ""}`,
    [scope.config_id, scope.config_id, scope.config_id, scope.offering_id],
  );
  // Capture exact provenance once, preserving the existing roster lock order.
  const [numericPublications] = await connection.execute(
    `SELECT p.grade_id, p.config_id, p.enrollment_subject_id,
            p.overall_exact_numerator AS overall_n,
            p.overall_exact_denominator AS overall_d,
            mt.term_percentage_exact_numerator AS midterm_n,
            mt.term_percentage_exact_denominator AS midterm_d,
            mt.calculation_snapshot_json AS midterm_snapshot,
            mt.submission_status AS midterm_status,
            mt.grading_term AS midterm_term,
            ft.term_percentage_exact_numerator AS final_n,
            ft.term_percentage_exact_denominator AS final_d,
            ft.calculation_snapshot_json AS final_snapshot,
            ft.submission_status AS final_status,
            ft.grading_term AS final_term
       FROM gradebook_official_grade_publications p
       JOIN enrollment_subjects es ON es.enrollment_subject_id = p.enrollment_subject_id
       JOIN gradebook_term_submission_attempts mt
         ON mt.term_submission_id = p.midterm_submission_id
       JOIN gradebook_term_submission_attempts ft
         ON ft.term_submission_id = p.final_term_submission_id
    WHERE p.config_id = ? AND es.offering_id = ?
  AND p.publication_source = 'TERM_PAIR'
      ORDER BY p.grade_id ${lock ? "FOR UPDATE" : ""}`,
    [scope.config_id, scope.offering_id],
  );
  const numericSources = new Map();
  for (const publication of numericPublications) {
    const id = Number(publication.grade_id);
    if (numericSources.has(id)) blockers.push("DUPLICATE_PUBLICATION_SOURCE");
    numericSources.set(id, publication);
  }

  // New publications point to a single approved full-semester attempt.
  const [combinedRows] = await connection.execute(
    `SELECT p.publication_id, p.publication_source,
            p.grade_id AS publication_grade_id,
            p.config_id AS publication_config_id,
            p.enrollment_subject_id AS publication_subject_id,
            p.midterm_submission_id, p.final_term_submission_id,
            p.combined_submission_id,
            p.grading_outcome_snapshot AS published_outcome,
            p.overall_exact_numerator AS published_n,
            p.overall_exact_denominator AS published_d,
            p.published_by_user_id, p.published_at,

            a.submission_id, a.grade_id AS attempt_grade_id,
            a.sheet_id, a.period_id, a.attempt_number, a.record_version,
            a.grading_scope,
            a.grading_outcome_snapshot AS attempt_outcome,
            a.submission_status, a.special_outcome_id,
            a.returned_edit_scope,
            a.submitted_by_user_id,
            a.submitted_at AS attempt_submitted_at,
            a.reviewed_by_user_id AS attempt_reviewer_id,
            a.reviewed_at AS attempt_reviewed_at,
            a.review_remarks,
            a.midterm_percentage_snapshot,
            a.final_term_percentage_snapshot,
            a.overall_percentage_snapshot,
            a.final_rating_snapshot, a.special_outcome_reason_snapshot,
            a.calculation_snapshot_json,
            a.midterm_exact_numerator AS midterm_n,
            a.midterm_exact_denominator AS midterm_d,
            a.final_term_exact_numerator AS final_n,
            a.final_term_exact_denominator AS final_d,
            a.overall_exact_numerator AS overall_n,
            a.overall_exact_denominator AS overall_d,

            sh.config_id AS sheet_config_id,
            sh.sheet_status,
            sp.department_id AS period_department_id,
            sp.academic_year_id AS period_year_id,
            sp.semester_id AS period_semester_id,
            f.faculty_id AS instructor_faculty_id,
            f.user_id AS instructor_user_id,

            rv.review_decision,
            rv.grading_outcome_snapshot AS review_outcome,
            rv.review_notes, rv.evidence_review_notes, rv.review_batch_ref,
            rv.returned_edit_scope AS review_return_scope,
            rv.is_self_approval,
            rv.reviewed_by_user_id AS review_actor,
            rv.submission_version_after,

            ru.is_active AS reviewer_active,
            ru.is_archived AS reviewer_archived,
            rr.role_name AS reviewer_role,

            EXISTS (
              SELECT 1
              FROM program_heads ph
              JOIN faculty pf
                ON pf.faculty_id = ph.faculty_id
              WHERE pf.user_id = a.reviewed_by_user_id
                AND ph.department_id = cr.department_id
                AND ph.is_active = 1
            ) AS reviewer_department_ok,

            (
              SELECT x.submission_id
              FROM gradebook_grade_submission_attempts x
              WHERE x.grade_id = a.grade_id
              ORDER BY x.attempt_number DESC,
                       x.submission_id DESC
              LIMIT 1
            ) AS latest_submission_id,

            (
              SELECT COUNT(*)
              FROM gradebook_term_submission_attempts t
              WHERE t.config_id = p.config_id
            ) AS term_attempts_count

       FROM gradebook_official_grade_publications p

       JOIN enrollment_subjects es
         ON es.enrollment_subject_id = p.enrollment_subject_id

       JOIN subject_offerings so
         ON so.offering_id = es.offering_id

       JOIN sections sec
         ON sec.section_id = so.section_id

       JOIN courses cr
         ON cr.course_id = sec.course_id

       LEFT JOIN gradebook_grade_submission_attempts a
         ON a.submission_id = p.combined_submission_id

       LEFT JOIN gradebook_official_sheets sh
         ON sh.sheet_id = a.sheet_id

       LEFT JOIN gradebook_submission_periods sp
         ON sp.period_id = a.period_id

       LEFT JOIN faculty f
         ON f.faculty_id = so.faculty_id

       LEFT JOIN gradebook_grade_submission_reviews rv
         ON rv.submission_id = a.submission_id

       LEFT JOIN users ru
         ON ru.user_id = a.reviewed_by_user_id

       LEFT JOIN roles rr
         ON rr.role_id = ru.role_id

      WHERE p.config_id = ?
        AND es.offering_id = ?
        AND p.publication_source = 'COMBINED_SEMESTER'

      ORDER BY p.grade_id
      ${lock ? "FOR UPDATE" : ""}`,
    [scope.config_id, scope.offering_id],
  );

  const combinedSources = new Map();

  for (const source of combinedRows) {
    const gradeId = Number(source.publication_grade_id);

    if (combinedSources.has(gradeId)) {
      blockers.push("DUPLICATE_COMBINED_SOURCE");
    }

    combinedSources.set(gradeId, source);
  }

  // Any modern publication or term attempt forbids historical fallback,
  // including an incomplete or malformed publication chain.
  const [allPublicationRows] = await connection.execute(
    `SELECT p.grade_id FROM gradebook_official_grade_publications p
       JOIN grades g ON g.grade_id = p.grade_id
       JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
      WHERE es.offering_id = ? ORDER BY p.grade_id ${lock ? "FOR UPDATE" : ""}`,
    [scope.offering_id],
  );
  const modernPublicationGrades = new Set(
    allPublicationRows.map((r) => Number(r.grade_id)),
  );
  const [termAttemptRows] = await connection.execute(
    `SELECT t.enrollment_subject_id FROM gradebook_term_submission_attempts t
       JOIN gradebook_offering_config cfg ON cfg.config_id = t.config_id
      WHERE cfg.offering_id = ? ORDER BY t.enrollment_subject_id
      ${lock ? "FOR UPDATE" : ""}`,
    [scope.offering_id],
  );

  const [combinedAttemptRows] = await connection.execute(
    `SELECT g.enrollment_subject_id
       FROM gradebook_grade_submission_attempts a
       JOIN grades g
         ON g.grade_id = a.grade_id
       JOIN enrollment_subjects es
         ON es.enrollment_subject_id = g.enrollment_subject_id
      WHERE es.offering_id = ?
      ORDER BY g.enrollment_subject_id
      ${lock ? "FOR UPDATE" : ""}`,
    [scope.offering_id],
  );

  const combinedAttemptSubjects = new Set(
    combinedAttemptRows.map((r) => Number(r.enrollment_subject_id)),
  );

  const modernAttemptSubjects = new Set(
    [...termAttemptRows, ...combinedAttemptRows].map((r) =>
      Number(r.enrollment_subject_id),
    ),
  );

  const [historyRows] = await connection.execute(
    `SELECT * FROM gradebook_historical_grade_source_reviews
      WHERE offering_id = ? ORDER BY historical_review_id ${lock ? "FOR UPDATE" : ""}`,
    [scope.offering_id],
  );
  const [historyEvents] = await connection.execute(
    `SELECT ev.* FROM gradebook_historical_grade_source_review_events ev
       JOIN gradebook_historical_grade_source_reviews h
         ON h.historical_review_id = ev.historical_review_id
      WHERE h.offering_id = ?
      ORDER BY ev.historical_review_id, ev.review_version_after, ev.historical_event_id
      ${lock ? "FOR UPDATE" : ""}`,
    [scope.offering_id],
  );
  const historyByGrade = new Map();
  const historyEventsByReview = new Map();
  for (const h of historyRows) {
    const gradeId = Number(h.grade_id);
    if (historyByGrade.has(gradeId))
      blockers.push("DUPLICATE_HISTORICAL_REVIEW");
    historyByGrade.set(gradeId, h);
  }
  for (const ev of historyEvents) {
    const id = String(ev.historical_review_id);
    if (!historyEventsByReview.has(id)) historyEventsByReview.set(id, []);
    historyEventsByReview.get(id).push(ev);
  }
  if (!roster.length) blockers.push("ROSTER_EMPTY");
  const seenSubjects = new Set();
  const seenStudents = new Set();
  const rowProblems = [];
  for (const row of roster) {
    const errors = [];
    if (seenSubjects.has(Number(row.enrollment_subject_id)))
      errors.push("DUPLICATE_SUBJECT_GRADE");
    if (seenStudents.has(Number(row.student_id)))
      errors.push("DUPLICATE_STUDENT");
    seenSubjects.add(Number(row.enrollment_subject_id));
    seenStudents.add(Number(row.student_id));
    if (
      row.enrollment_status !== "Approved" ||
      Number(row.academic_year_id) !== Number(scope.academic_year_id) ||
      Number(row.semester_id) !== Number(scope.semester_id)
    ) {
      errors.push("ENROLLMENT_NOT_APPROVED_OR_TERM_MISMATCH");
    }
    if (
      !["Regular", "Retake", "Carry Over"].includes(row.enrollment_type) ||
      !row.student_number
    )
      errors.push("INVALID_ROSTER_IDENTITY");
    if (["Dropped", "Withdrawn"].includes(row.subject_status)) {
      if (row.grade_status === "Approved")
        errors.push("DROPPED_SUBJECT_HAS_APPROVED_GRADE");
    } else if (row.grade_status !== "Approved" || row.grade_id == null) {
      errors.push("APPROVED_GRADE_REQUIRED");
    } else if (row.grading_outcome === "NUMERIC") {
      const history = historyByGrade.get(Number(row.grade_id));
      const hasModernPublication = modernPublicationGrades.has(
        Number(row.grade_id),
      );
      const hasModernAttempt = modernAttemptSubjects.has(
        Number(row.enrollment_subject_id),
      );

      const termSource = numericSources.get(Number(row.grade_id));

      const combinedSource = combinedSources.get(Number(row.grade_id));

      const hasModernSource =
        row.grading_policy === "TWO_TERM_50_50" &&
        Number(row.publication_count) === 1 &&
        Number(Boolean(termSource)) + Number(Boolean(combinedSource)) === 1 &&
        (termSource
          ? phSheetPublishedNumericValid(
              {
                ...row,
                config_id: scope.config_id,
              },
              termSource,
            )
          : phSheetPublishedCombinedNumericValid(
              {
                ...row,
                config_id: scope.config_id,
              },
              combinedSource,
              String(sheet.sheet_id),
              scope.departmentId,
            ));

      if (history && (hasModernPublication || hasModernAttempt)) {
        errors.push("HISTORICAL_REVIEW_CONFLICTS_WITH_MODERN_SOURCE");
      } else if (hasModernSource && !history) {
        // Normal assessment-based approval remains unchanged.
      } else if (
        !hasModernPublication &&
        !hasModernAttempt &&
        phSheetHistoricalSourceValid(
          history,
          row,
          historyEventsByReview.get(String(history?.historical_review_id)),
        )
      ) {
        // Preserve the approved source values; do not invent assessment data.
        row.historical_review_id = String(history.historical_review_id);
      } else {
        errors.push(
          history
            ? "HISTORICAL_SOURCE_UNVERIFIED_OR_STALE"
            : row.grading_policy === "LEGACY"
              ? "LEGACY_GRADE_VERIFIED_SOURCE_REQUIRED"
              : "NUMERIC_EXACT_PUBLICATION_OR_VERIFIED_SOURCE_REQUIRED",
        );
      }
    } else if (row.grading_policy !== "TWO_TERM_50_50") {
      errors.push("LEGACY_SPECIAL_OUTCOME_REQUIRES_SEPARATE_RECONCILIATION");
    } else if (
      ["INCOMPLETE", "UNOFFICIAL_DROP"].includes(row.grading_outcome) &&
      (modernPublicationGrades.has(Number(row.grade_id)) ||
        combinedAttemptSubjects.has(Number(row.enrollment_subject_id)))
    ) {
      // Modern special outcomes must never fall back to legacy request checks.
      const source = combinedSources.get(Number(row.grade_id));
      if (historyByGrade.has(Number(row.grade_id))) {
        errors.push("HISTORICAL_REVIEW_CONFLICTS_WITH_MODERN_SOURCE");
      } else if (
        !(await phSheetPublishedCombinedSpecialValid(
          connection,
          scope,
          { ...row, config_id: scope.config_id },
          source,
          String(sheet.sheet_id),
          lock,
        ))
      ) {
        errors.push("COMBINED_SPECIAL_PUBLICATION_SOURCE_INVALID");
      }
    } else if (row.grading_outcome === "INCOMPLETE") {
      const standardIncValid =
        row.subject_status === "Incomplete" &&
        row.remarks === "Incomplete" &&
        Number(row.final_rating) === 4 &&
        Number(row.special_count) === 1 &&
        Number(row.inc_approved_count) === 1;

      const legacyIncValid =
        !standardIncValid &&
        Number(row.special_count) === 0 &&
        (await phSheetLegacyIncSourceValid(connection, scope, row, lock));

      if (!standardIncValid && !legacyIncValid) {
        errors.push("INC_EVIDENCE_INVALID");
      }
    } else if (row.grading_outcome === "UNOFFICIAL_DROP") {
      if (
        row.subject_status !== "Unofficial Drop" ||
        row.remarks !== "Unofficial Drop" ||
        Number(row.final_rating) !== 6 ||
        Number(row.special_count) !== 1 ||
        Number(row.ud_approved_count) !== 1
      )
        errors.push("UD_EVIDENCE_INVALID");
    } else if (row.grading_outcome === "EXPIRED_INCOMPLETE") {
      // Snapshot enum currently lacks EXPIRED_INCOMPLETE. It needs a separate
      // audited expiry migration and finalized-sheet reconciliation first.
      errors.push("EXPIRED_INC_SNAPSHOT_MIGRATION_REQUIRED");
    } else {
      errors.push("UNSUPPORTED_OFFICIAL_GRADE_OUTCOME");
    }
    if (errors.length)
      rowProblems.push({
        enrollment_subject_id: Number(row.enrollment_subject_id),
        student_number: row.student_number,
        errors,
      });
  }
  if (rowProblems.length) blockers.push("ROSTER_HAS_UNRESOLVED_RESULTS");
  return { sheet, roster, blockers, rowProblems };
}

// Official grading sheets in the Program Head's department.

router.get("/gradebook/official-sheets", async (req, res) => {
  let connection;

  try {
    if (Object.keys(req.query ?? {}).length !== 0) {
      phSheetFail(
        "PH_SHEET_LIST_QUERY_UNSUPPORTED",
        "The official-sheet list does not accept query parameters.",
        400,
      );
    }

    connection = await db.getConnection();

    const { departmentId } = await incReviewAssertProgramHead(connection, req);

    const [rows] = await connection.execute(
      `SELECT
          so.offering_id,
          so.status AS offering_status,
          sub.subject_code,
          sub.subject_name,
          sec.section_name,
          ay.academic_year,
          sem.semester_name,
          cfg.config_id,
          sh.sheet_id,
          sh.sheet_status,
          sh.record_version AS sheet_record_version,
          DATE_FORMAT(
            sh.original_official_submitted_on,
            '%Y-%m-%d'
          ) AS original_official_submitted_on,
          sh.official_submission_reference,
         sh.official_date_verified_by_user_id,

DATE_FORMAT(
  sh.official_date_verified_at,
  '%Y-%m-%d %H:%i:%s'
) AS official_date_verified_at,

CASE
  WHEN sh.original_official_submitted_on IS NOT NULL
   AND sh.official_date_verified_by_user_id IS NOT NULL
   AND sh.official_date_verified_at IS NOT NULL
  THEN DATE_FORMAT(
    DATE_ADD(
      sh.original_official_submitted_on,
      INTERVAL 1 YEAR
    ),
    '%Y-%m-%d'
  )
  ELSE NULL
END AS inc_completion_deadline_on,

sh.finalized_at

       FROM gradebook_offering_config cfg

       JOIN subject_offerings so
         ON so.offering_id = cfg.offering_id

       JOIN subjects sub
         ON sub.subject_id = so.subject_id

       JOIN sections sec
         ON sec.section_id = so.section_id

       JOIN courses cr
         ON cr.course_id = sec.course_id

       JOIN academic_years ay
         ON ay.academic_year_id = so.academic_year_id

       JOIN semesters sem
         ON sem.semester_id = so.semester_id

       LEFT JOIN gradebook_official_sheets sh
         ON sh.config_id = cfg.config_id

       WHERE cr.department_id = ?

       ORDER BY
         (sh.sheet_status = 'IN_PROGRESS') DESC,
         so.academic_year_id DESC,
         so.semester_id DESC,
         so.offering_id DESC`,
      [departmentId],
    );

    res.set("Cache-Control", "no-store");

    return res.json({
      success: true,
      read_only: true,
      offerings: rows.map((row) => ({
        offering_id: Number(row.offering_id),
        offering_status: row.offering_status,
        subject_code: row.subject_code,
        subject_name: row.subject_name,
        section_name: row.section_name,
        academic_year: row.academic_year,
        semester_name: row.semester_name,
        sheet_id: row.sheet_id == null ? null : String(row.sheet_id),
        sheet_status: row.sheet_status ?? "NOT_RECORDED",
        sheet_record_version:
          row.sheet_record_version == null
            ? null
            : Number(row.sheet_record_version),
        original_official_submitted_on: row.original_official_submitted_on,
        official_submission_reference: row.official_submission_reference,
        original_date_verified:
          row.official_date_verified_by_user_id != null &&
          row.official_date_verified_at != null,

        official_date_verified_at: row.official_date_verified_at,

        inc_completion_deadline_on: row.inc_completion_deadline_on,

        finalized_at: row.finalized_at,
      })),
    });
  } catch (error) {
    return phSheetError(res, error);
  } finally {
    connection?.release();
  }
});

// GET /api/program-head/gradebook/official-sheets/:offeringId/finalization-readiness
router.get(
  "/gradebook/official-sheets/:offeringId/finalization-readiness",
  async (req, res) => {
    let connection;
    try {
      if (Object.keys(req.query ?? {}).length)
        phSheetFail(
          "PH_SHEET_QUERY_UNSUPPORTED",
          "Query parameters are not accepted.",
          400,
        );
      const offeringId = periodPositiveId(req.params.offeringId);
      if (!offeringId)
        phSheetFail(
          "PH_SHEET_ID_INVALID",
          "A positive offering ID is required.",
          400,
        );
      connection = await db.getConnection();
      const scope = await phSheetScope(connection, req, offeringId);
      const result = await phSheetInspect(connection, scope);
      return res.json({
        success: true,
        read_only: true,
        offering_id: offeringId,
        sheet_id: String(result.sheet.sheet_id),
        sheet_status: result.sheet.sheet_status,
        sheet_record_version: Number(result.sheet.record_version),
        roster_count: result.roster.length,
        verified_historical_count: result.roster.filter(
          (r) => r.historical_review_id != null,
        ).length,
        blockers: result.blockers,
        problematic_rows: result.rowProblems.slice(0, 30),
        can_finalize: result.blockers.length === 0,
        grades_modified: false,
      });
    } catch (error) {
      return phSheetError(res, error);
    } finally {
      connection?.release();
    }
  },
);

// POST /api/program-head/gradebook/official-sheets/:offeringId/finalize
// A single transaction rechecks everything; no grades or source dates are updated.
router.post(
  "/gradebook/official-sheets/:offeringId/finalize",
  async (req, res) => {
    let connection;
    let inTransaction = false;
    try {
      if (Object.keys(req.query ?? {}).length)
        phSheetFail(
          "PH_SHEET_QUERY_UNSUPPORTED",
          "Query parameters are not accepted.",
          400,
        );
      const offeringId = periodPositiveId(req.params.offeringId);
      if (!offeringId)
        phSheetFail(
          "PH_SHEET_ID_INVALID",
          "A positive offering ID is required.",
          400,
        );
      phSheetBody(req.body, [
        "expected_sheet_version",
        "finalization_remarks",
        "confirm_finalization",
        "dry_run",
      ]);
      const version = periodPositiveId(req.body.expected_sheet_version);
      const remarks =
        typeof req.body.finalization_remarks === "string"
          ? req.body.finalization_remarks.trim()
          : "";
      if (
        !version ||
        version >= 4294967295 ||
        req.body.confirm_finalization !== true ||
        remarks.length < 20 ||
        remarks.length > 1000 ||
        /[\x00-\x08\x0B\x0E-\x1F\x7F]/.test(remarks)
      ) {
        phSheetFail(
          "PH_SHEET_FINALIZE_INPUT_INVALID",
          "Provide current version, confirmation, and documented remarks (20–1000 characters).",
          400,
        );
      }
      connection = await db.getConnection();

      await connection.beginTransaction();
      inTransaction = true;

      // Check the connected database before finalization.
      const [databaseRows] = await connection.execute(
        "SELECT DATABASE() AS database_name",
      );

      const activeDatabase =
        databaseRows.length === 1 ? databaseRows[0]?.database_name : null;

      const isQaDatabase = activeDatabase === "databaseforptc1_admission_test";

      if (typeof activeDatabase !== "string" || !activeDatabase.trim()) {
        phSheetFail(
          "PH_SHEET_FINALIZATION_DATABASE_UNKNOWN",
          "Could not verify the connected database.",
          403,
        );
      }

      if (isQaDatabase) {
        if (process.env.NODE_ENV === "production") {
          phSheetFail(
            "PH_SHEET_FINALIZATION_QA_PRODUCTION_FORBIDDEN",
            "The QA database cannot be finalized in production mode.",
            403,
          );
        }

        if (
          req.body.dry_run !== true &&
          process.env.GRADEBOOK_OFFICIAL_SHEET_FINALIZATION_WRITES_ENABLED !==
            "true"
        ) {
          phSheetFail(
            "PH_SHEET_FINALIZATION_WRITES_DISABLED",
            "Official-sheet finalization writes are not enabled.",
            403,
          );
        }
      } else {
        const configuredDatabase = process.env.DB_NAME?.trim();
        const targetDatabase =
          process.env.GRADEBOOK_OFFICIAL_SHEET_FINALIZATION_TARGET_DATABASE?.trim();

        if (
          process.env.GRADEBOOK_OFFICIAL_SHEET_FINALIZATION_WRITES_ENABLED !==
          "true"
        ) {
          phSheetFail(
            "PH_SHEET_FINALIZATION_WRITES_DISABLED",
            "Official-sheet finalization is disabled for this database.",
            403,
          );
        }

        if (
          !configuredDatabase ||
          !targetDatabase ||
          activeDatabase !== configuredDatabase ||
          activeDatabase !== targetDatabase
        ) {
          phSheetFail(
            "PH_SHEET_FINALIZATION_DATABASE_MISMATCH",
            "This database is not authorized for official-sheet finalization.",
            403,
          );
        }

        if (
          process.env.NODE_ENV === "production" &&
          process.env
            .GRADEBOOK_OFFICIAL_SHEET_FINALIZATION_PRODUCTION_ENABLED !== "true"
        ) {
          phSheetFail(
            "PH_SHEET_FINALIZATION_PRODUCTION_DISABLED",
            "Production finalization requires separate authorization.",
            403,
          );
        }
      }

      const scope = await phSheetScope(connection, req, offeringId, true);

      const result = await phSheetInspect(connection, scope, true);
      if (Number(result.sheet.record_version) !== version) {
        phSheetFail(
          "PH_SHEET_VERSION_CONFLICT",
          "The official sheet version changed; reload readiness.",
        );
      }
      if (result.blockers.length) {
        phSheetFail(
          "PH_SHEET_NOT_FINALIZABLE",
          `Finalization blocked: ${result.blockers.join(", ")}`,
        );
      }
      const sheetId = String(result.sheet.sheet_id);
      for (let i = 0; i < result.roster.length; i++) {
        const row = result.roster[i];
        const hasOfficialGrade = !["Dropped", "Withdrawn"].includes(
          row.subject_status,
        );
        const [inserted] = await connection.execute(
          `INSERT INTO gradebook_finalized_roster
        (sheet_id, enrollment_subject_id, student_id, grade_id, row_position,
         student_number_snapshot, first_name_snapshot, middle_name_snapshot,
         last_name_snapshot, section_id_snapshot, enrollment_type_snapshot,
         enrollment_subject_status_snapshot, roster_disposition,
         grade_status_snapshot, grading_outcome_snapshot, midterm_grade_snapshot,
         final_grade_snapshot, overall_percentage_snapshot, final_rating_snapshot,
         grade_remarks_snapshot, historical_review_id, snapshotted_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sheetId,
            row.enrollment_subject_id,
            row.student_id,
            hasOfficialGrade ? row.grade_id : null,
            i + 1,
            row.student_number,
            row.first_name,
            row.middle_name,
            row.last_name,
            row.section_id,
            row.enrollment_type,
            row.subject_status,
            hasOfficialGrade
              ? "APPROVED_GRADE"
              : row.subject_status.toUpperCase(),
            hasOfficialGrade ? "Approved" : null,
            hasOfficialGrade ? row.grading_outcome : null,
            hasOfficialGrade ? row.midterm_grade : null,
            hasOfficialGrade ? row.final_grade : null,
            hasOfficialGrade ? row.overall_percentage : null,
            hasOfficialGrade ? row.final_rating : null,
            hasOfficialGrade ? row.remarks : null,
            hasOfficialGrade ? (row.historical_review_id ?? null) : null,
            scope.userId,
          ],
        );
        if (Number(inserted.affectedRows) !== 1)
          throw new Error("Roster snapshot insertion failed.");
      }
      const [[rosterCount]] = await connection.execute(
        `SELECT COUNT(*) AS count FROM gradebook_finalized_roster WHERE sheet_id = ?`,
        [sheetId],
      );
      if (Number(rosterCount.count) !== result.roster.length) {
        throw new Error(
          "Finalized roster count mismatch; transaction will roll back.",
        );
      }
      const [updated] = await connection.execute(
        `UPDATE gradebook_official_sheets
          SET sheet_status = 'FINALIZED', finalized_roster_count = ?,
              finalized_by_user_id = ?, finalized_at = NOW(),
              finalization_remarks = ?, updated_by_user_id = ?,
              record_version = record_version + 1
        WHERE sheet_id = ? AND sheet_status = 'IN_PROGRESS'
          AND record_version = ? AND official_date_verified_by_user_id IS NOT NULL`,
        [
          result.roster.length,
          scope.userId,
          remarks,
          scope.userId,
          sheetId,
          version,
        ],
      );
      if (Number(updated.affectedRows) !== 1) {
        phSheetFail(
          "PH_SHEET_FINALIZE_CONFLICT",
          "Sheet changed during finalization.",
        );
      }
      if (req.body.dry_run) await connection.rollback();
      else await connection.commit();
      inTransaction = false;
      return res.json({
        success: true,
        action: "FINALIZE",
        persisted: !req.body.dry_run,
        dry_run: req.body.dry_run,
        sheet_id: sheetId,
        offering_id: offeringId,
        roster_count: result.roster.length,
        verified_historical_count: result.roster.filter(
          (r) => r.historical_review_id != null,
        ).length,
        sheet_status: req.body.dry_run ? "IN_PROGRESS" : "FINALIZED",
        record_version: req.body.dry_run ? version : version + 1,
        original_official_submitted_on: result.sheet.original_date,
        original_date_preserved: true,
        grades_modified: false,
        snapshot_persisted: !req.body.dry_run,
      });
    } catch (error) {
      if (inTransaction && connection)
        try {
          await connection.rollback();
        } catch (e) {
          console.error("PH SHEET FINALIZE ROLLBACK:", e);
        }
      return phSheetError(res, error);
    } finally {
      connection?.release();
    }
  },
);

function phCompatibilityJSON(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

// A finalized roster is a historical snapshot, not a mutable current-grade table.
// GET /api/program-head/gradebook/official-sheets/:offeringId/compatibility-review
router.get(
  "/gradebook/official-sheets/:offeringId/compatibility-review",
  async (req, res) => {
    let connection;
    try {
      if (Object.keys(req.query ?? {}).length) {
        phSheetFail(
          "PH_SHEET_COMPAT_QUERY_UNSUPPORTED",
          "Query parameters are not supported.",
          400,
        );
      }

      const offeringId = periodPositiveId(req.params.offeringId);
      if (!offeringId) {
        phSheetFail(
          "PH_SHEET_COMPAT_OFFERING_INVALID",
          "A positive offering ID is required.",
          400,
        );
      }

      connection = await db.getConnection();
      const scope = await phSheetScope(connection, req, offeringId);
      // The report works before the Registrar has recorded the official date.
      const [sheetRows] = await connection.execute(
        `SELECT sheet_id, config_id, sheet_status, record_version,
                DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_date,
                official_submission_reference, official_date_verified_by_user_id,
                official_date_verified_at, finalized_at, finalized_by_user_id
           FROM gradebook_official_sheets WHERE config_id = ?`,
        [scope.config_id],
      );
      if (sheetRows.length > 1) {
        phSheetFail(
          "PH_SHEET_COMPAT_DUPLICATE_SHEET",
          "Duplicate official-sheet records require reconciliation.",
        );
      }
      const sheet = sheetRows[0] ?? null;
      const sheetAudit = sheet
        ? await phSheetAudit(connection, sheet)
        : { verifiedValid: false, verifiedByProgramHead: false };
      const [[deadline]] = sheet?.original_date
        ? await connection.execute(
            `SELECT DATE_FORMAT(DATE_ADD(?, INTERVAL 1 YEAR), '%Y-%m-%d') AS deadline_on`,
            [sheet.original_date],
          )
        : [[{ deadline_on: null }]];

      const [exceptions] = await connection.execute(
        `SELECT g.grade_id, g.grade_status, g.grading_policy,
                g.grading_outcome, g.final_rating, g.remarks,
                g.overall_percentage, es.enrollment_subject_id,
                es.status AS subject_status, s.student_number,
                pub.publication_id,
                fr.roster_snapshot_id, fr.grade_id AS snapshot_grade_id,
                fr.roster_disposition, fr.grade_status_snapshot,
                fr.grading_outcome_snapshot, fr.final_rating_snapshot,
                fr.enrollment_subject_status_snapshot,
                expiry.expiry_id, expiry.sheet_id AS expiry_sheet_id,
                expiry.amendment_id AS expiry_amendment_id,
                DATE_FORMAT(expiry.deadline_on, '%Y-%m-%d') AS expiry_deadline_on,
                DATE_FORMAT(expiry.processed_at, '%Y-%m-%d %H:%i:%s') AS expiry_processed_at,
                (expiry.processed_at >= (
                  SELECT os.finalized_at FROM gradebook_official_sheets os
                   WHERE os.sheet_id = ?
                )) AS expiry_after_finalization,
                expiry.processed_by_user_id AS expiry_actor_id,
                expiry.expiry_reason,
                amendment.amendment_type, amendment.sheet_id AS amendment_sheet_id,
                amendment.previous_values_summary,
                amendment.new_values_summary,
                amendment.progression_review_required,
                amendment.applied_by_user_id AS amendment_actor_id,
                DATE_FORMAT(amendment.applied_at, '%Y-%m-%d %H:%i:%s') AS amendment_applied_at,
                inc.request_status AS inc_original_request_status,
                original_so.special_outcome_id AS original_inc_evidence_id,
                ud.request_status AS ud_original_request_status,
                ud_so.special_outcome_id AS original_ud_evidence_id
           FROM grades g
           JOIN enrollment_subjects es
             ON es.enrollment_subject_id = g.enrollment_subject_id
           JOIN enrollments en ON en.enrollment_id = es.enrollment_id
           JOIN students s ON s.student_id = en.student_id
           LEFT JOIN gradebook_official_grade_publications pub
             ON pub.grade_id = g.grade_id
           LEFT JOIN gradebook_finalized_roster fr
             ON fr.sheet_id = ? AND fr.enrollment_subject_id = es.enrollment_subject_id
           LEFT JOIN gradebook_inc_expiry_actions expiry
             ON expiry.grade_id = g.grade_id
           LEFT JOIN gradebook_sheet_amendments amendment
             ON amendment.amendment_id = expiry.amendment_id
           LEFT JOIN gradebook_inc_outcome_requests inc
             ON inc.config_id = ? AND inc.enrollment_subject_id = es.enrollment_subject_id
           LEFT JOIN gradebook_special_outcomes original_so
             ON original_so.grade_id = g.grade_id
            AND original_so.outcome_type = 'INCOMPLETE'
            AND original_so.record_status = 'ACTIVE'
           LEFT JOIN gradebook_ud_outcome_requests ud
             ON ud.config_id = ? AND ud.enrollment_subject_id = es.enrollment_subject_id
           LEFT JOIN gradebook_special_outcomes ud_so
             ON ud_so.grade_id = g.grade_id
            AND ud_so.outcome_type = 'UNOFFICIAL_DROP'
            AND ud_so.record_status = 'ACTIVE'
          WHERE es.offering_id = ? AND g.grade_status = 'Approved'
            AND (g.grading_outcome = 'EXPIRED_INCOMPLETE'
                 OR expiry.expiry_id IS NOT NULL
                 OR g.grading_policy = 'LEGACY'
                 OR (g.grading_outcome = 'NUMERIC' AND pub.publication_id IS NULL)
                 OR (g.grading_outcome = 'INCOMPLETE' AND
                     (inc.request_status IS NULL OR inc.request_status <> 'APPROVED'
                      OR original_so.special_outcome_id IS NULL))
                 OR (g.grading_outcome = 'UNOFFICIAL_DROP' AND
                     (ud.request_status IS NULL OR ud.request_status <> 'APPROVED'
                      OR ud_so.special_outcome_id IS NULL)))
          ORDER BY es.enrollment_subject_id, g.grade_id`,
        [
          sheet ? String(sheet.sheet_id) : null,
          sheet ? String(sheet.sheet_id) : null,
          scope.config_id,
          scope.config_id,
          offeringId,
        ],
      );

      const historical = [];
      const expiryReviews = [];
      const expectedDeadline = deadline?.deadline_on ?? null;
      const verifiedOriginalDate =
        sheetAudit.verifiedValid &&
        sheetAudit.verifiedByProgramHead &&
        sheet?.official_date_verified_at != null &&
        sheet?.official_date_verified_by_user_id != null &&
        Boolean(sheet?.original_date && expectedDeadline);

      for (const row of exceptions) {
        const expired =
          row.grading_outcome === "EXPIRED_INCOMPLETE" || row.expiry_id != null;

        if (expired) {
          const findings = [];
          if (
            sheet?.sheet_status !== "FINALIZED" ||
            !sheet?.finalized_at ||
            !sheet?.finalized_by_user_id
          ) {
            findings.push("ORIGINAL_SHEET_NOT_FINALIZED");
          }
          if (!verifiedOriginalDate) {
            findings.push("ORIGINAL_DATE_NOT_PROGRAM_HEAD_VERIFIED");
          }
          if (
            row.grading_outcome !== "EXPIRED_INCOMPLETE" ||
            row.grade_status !== "Approved" ||
            Number(row.final_rating) !== 5 ||
            row.remarks !== "Failed" ||
            row.overall_percentage != null ||
            row.subject_status !== "Failed"
          ) {
            findings.push("CURRENT_EXPIRED_GRADE_OR_STATUS_INVALID");
          }
          if (
            row.roster_snapshot_id == null ||
            Number(row.snapshot_grade_id) !== Number(row.grade_id) ||
            row.roster_disposition !== "APPROVED_GRADE" ||
            row.grade_status_snapshot !== "Approved" ||
            row.grading_outcome_snapshot !== "INCOMPLETE" ||
            Number(row.final_rating_snapshot) !== 4 ||
            row.enrollment_subject_status_snapshot !== "Incomplete"
          ) {
            findings.push("ORIGINAL_INC_4_SNAPSHOT_MISSING_OR_CHANGED");
          }
          if (
            row.inc_original_request_status !== "APPROVED" ||
            row.original_inc_evidence_id == null
          ) {
            findings.push("ORIGINAL_APPROVED_INC_EVIDENCE_MISSING");
          }
          if (
            row.expiry_id == null ||
            String(row.expiry_sheet_id) !==
              (sheet ? String(sheet.sheet_id) : null) ||
            !expectedDeadline ||
            row.expiry_deadline_on !== expectedDeadline ||
            !row.expiry_processed_at ||
            row.expiry_processed_at.slice(0, 10) <= expectedDeadline ||
            Number(row.expiry_after_finalization) !== 1
          ) {
            findings.push("EXPIRY_DATE_OR_ACTION_INVALID");
          }

          const before = phCompatibilityJSON(row.previous_values_summary);
          const after = phCompatibilityJSON(row.new_values_summary);
          if (
            row.expiry_amendment_id == null ||
            row.amendment_type !== "INC_EXPIRY" ||
            String(row.amendment_sheet_id) !==
              (sheet ? String(sheet.sheet_id) : null) ||
            Number(row.progression_review_required) !== 1 ||
            Number(row.expiry_actor_id) !== Number(row.amendment_actor_id) ||
            !row.amendment_applied_at ||
            !String(row.expiry_reason ?? "").trim() ||
            !before ||
            !after ||
            Number(before.grade_id) !== Number(row.grade_id) ||
            before.grading_outcome !== "INCOMPLETE" ||
            Number(before.final_rating) !== 4 ||
            Number(after.grade_id) !== Number(row.grade_id) ||
            after.grading_outcome !== "EXPIRED_INCOMPLETE" ||
            Number(after.final_rating) !== 5 ||
            String(after.sheet_id) !==
              (sheet ? String(sheet.sheet_id) : null) ||
            after.original_official_submitted_on !== sheet?.original_date ||
            after.deadline_on !== expectedDeadline
          ) {
            findings.push("INC_EXPIRY_AMENDMENT_OR_AUDIT_INVALID");
          }

          expiryReviews.push({
            grade_id: Number(row.grade_id),
            enrollment_subject_id: Number(row.enrollment_subject_id),
            student_number: row.student_number,
            current_outcome: row.grading_outcome,
            original_snapshot_outcome: row.grading_outcome_snapshot ?? null,
            original_snapshot_rating:
              row.final_rating_snapshot == null
                ? null
                : String(row.final_rating_snapshot),
            current_rating: String(row.final_rating),
            original_official_submitted_on: sheet?.original_date ?? null,
            deadline_on: expectedDeadline,
            expiry_id: row.expiry_id == null ? null : String(row.expiry_id),
            amendment_id:
              row.expiry_amendment_id == null
                ? null
                : String(row.expiry_amendment_id),
            amendment_progression_review_required:
              Number(row.progression_review_required) === 1,
            audit_consistent: findings.length === 0,
            findings,
          });
        } else {
          // Do not infer that an approved direct-percentage record was produced
          // using the new assessment-based calculation.
          historical.push({
            grade_id: Number(row.grade_id),
            enrollment_subject_id: Number(row.enrollment_subject_id),
            student_number: row.student_number,
            grading_policy_recorded: row.grading_policy,
            recorded_outcome: row.grading_outcome,
            recorded_rating:
              row.final_rating == null ? null : String(row.final_rating),
            has_new_gradebook_publication: row.publication_id != null,
            historical_source_classification:
              row.grading_policy === "LEGACY"
                ? "EXPLICIT_LEGACY_POLICY"
                : row.grading_outcome === "NUMERIC"
                  ? "APPROVED_WITHOUT_NEW_PUBLICATION"
                  : "APPROVED_SPECIAL_OUTCOME_SOURCE_MISSING",
            preservation_policy: "KEEP_ORIGINAL_APPROVED_GRADE",
            sheet_finalization_handling:
              "SEPARATE_DOCUMENTED_LEGACY_RECONCILIATION_REQUIRED",
          });
        }
      }

      const inconsistentExpiries = expiryReviews.filter(
        (x) => !x.audit_consistent,
      );
      return res.json({
        success: true,
        read_only: true,
        offering_id: offeringId,
        sheet_id: sheet ? String(sheet.sheet_id) : null,
        sheet_status: sheet?.sheet_status ?? "NOT_RECORDED",
        original_date_verified_by_program_head: Boolean(verifiedOriginalDate),
        original_official_submitted_on: sheet?.original_date ?? null,
        inc_deadline_on: expectedDeadline,
        historical_approved_records: historical,
        historically_approved_grade_count: historical.length,
        post_finalization_inc_expiries: expiryReviews,
        inc_expiry_count: expiryReviews.length,
        inconsistent_expiry_count: inconsistentExpiries.length,
        needs_manual_reconciliation:
          historical.length > 0 || inconsistentExpiries.length > 0,
        official_grades_modified: false,
        finalized_roster_modified: false,
        note:
          "Finalized roster entries retain the original approved outcome. " +
          "INC expiry is a later audited amendment, not a replacement for the original INC snapshot. " +
          "Historical approved grades remain valid records but require separate documented source reconciliation; " +
          "this read-only review does not authorize finalization or create fabricated assessment history.",
      });
    } catch (error) {
      return phSheetError(res, error);
    } finally {
      connection?.release();
    }
  },
);

function phHistoricalFail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function phHistoricalSendError(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
  if (status === 500) console.error("PH HISTORICAL SOURCE REVIEW:", error);
  return res.status(status).json({
    success: false,
    code: status === 500 ? "PH_HISTORICAL_REVIEW_INTERNAL_ERROR" : error.code,
    message:
      status === 500
        ? "Could not review the historical-grade source."
        : error.message,
  });
}

function phHistoricalJSON(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function phHistoricalEqual(a, b) {
  if (a == null || b == null) return a == null && b == null;
  // mysql2 returns DATE/DATETIME as Date objects on some configurations.
  const text = (value) =>
    value instanceof Date ? value.toISOString() : String(value);
  const left = text(a);
  const right = text(b);
  const decimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
  if (decimal.test(left) && decimal.test(right)) {
    const normalize = (value) => {
      const [whole, fraction = ""] = value.split(".");
      const cleanFraction = fraction.replace(/0+$/, "");
      return `${BigInt(whole)}${cleanFraction ? `.${cleanFraction}` : ""}`;
    };
    return normalize(left) === normalize(right);
  }
  return left === right;
}

// GET /api/program-head/gradebook/historical-grade-source-reviews
router.get("/gradebook/historical-grade-source-reviews", async (req, res) => {
  let connection;
  try {
    if (Object.keys(req.query ?? {}).length !== 0) {
      phHistoricalFail(
        "PH_HISTORICAL_QUERY_UNSUPPORTED",
        "Query parameters are not accepted.",
        400,
      );
    }
    connection = await db.getConnection();
    await termReviewAssertTestDatabase(connection);
    const { departmentId } = await incReviewAssertProgramHead(connection, req);
    const [rows] = await connection.execute(
      `SELECT h.historical_review_id, h.grade_id, h.enrollment_subject_id,
              h.offering_id, h.source_classification, h.review_status,
              h.source_reference, h.evidence_summary, h.record_version,
              h.recorded_by_user_id, h.recorded_at,
              h.reviewed_by_user_id, h.reviewed_at, h.review_remarks,
              g.final_rating, g.grading_policy, s.student_number
         FROM gradebook_historical_grade_source_reviews h
         JOIN subject_offerings so ON so.offering_id = h.offering_id
         JOIN sections sec ON sec.section_id = so.section_id
         JOIN courses c ON c.course_id = sec.course_id
         JOIN grades g ON g.grade_id = h.grade_id
         JOIN enrollment_subjects es ON es.enrollment_subject_id = h.enrollment_subject_id
         JOIN enrollments en ON en.enrollment_id = es.enrollment_id
         JOIN students s ON s.student_id = en.student_id
        WHERE c.department_id = ? AND es.offering_id = so.offering_id
        ORDER BY (h.review_status = 'PENDING_PH_REVIEW') DESC,
                 h.updated_at DESC, h.historical_review_id DESC
        LIMIT 100`,
      [departmentId],
    );
    return res.json({
      success: true,
      read_only: true,
      count: rows.length,
      reviews: rows.map((row) => ({
        historical_review_id: String(row.historical_review_id),
        grade_id: Number(row.grade_id),
        enrollment_subject_id: Number(row.enrollment_subject_id),
        offering_id: Number(row.offering_id),
        student_number: row.student_number,
        source_classification: row.source_classification,
        review_status: row.review_status,
        source_reference: row.source_reference,
        evidence_summary: row.evidence_summary,
        original_rating:
          row.final_rating == null ? null : String(row.final_rating),
        grading_policy: row.grading_policy,
        record_version: Number(row.record_version),
        recorded_by_user_id: Number(row.recorded_by_user_id),
        recorded_at: row.recorded_at,
        reviewed_by_user_id:
          row.reviewed_by_user_id == null
            ? null
            : Number(row.reviewed_by_user_id),
        reviewed_at: row.reviewed_at,
        review_remarks: row.review_remarks,
      })),
      official_grades_unchanged: true,
    });
  } catch (error) {
    return phHistoricalSendError(res, error);
  } finally {
    connection?.release();
  }
});

// POST /api/program-head/gradebook/historical-grade-source-reviews/:reviewId/review
// VERIFY is evidence verification only. REJECT is terminal until a separately
// authorized re-registration/reconsideration process is implemented.
router.post(
  "/gradebook/historical-grade-source-reviews/:reviewId/review",
  async (req, res) => {
    let connection;
    let inTransaction = false;
    try {
      const reviewId = periodPositiveId(req.params.reviewId);
      const body = req.body;
      const allowed = new Set([
        "action",
        "expected_record_version",
        "review_remarks",
        "confirm_review",
        "confirm_source_document_reviewed",
        "dry_run",
      ]);
      if (
        !reviewId ||
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some((field) => !allowed.has(field))
      ) {
        phHistoricalFail(
          "PH_HISTORICAL_BODY_INVALID",
          "Provide a valid review ID and supported JSON fields.",
          400,
        );
      }
      if (Object.keys(req.query ?? {}).length !== 0) {
        phHistoricalFail(
          "PH_HISTORICAL_QUERY_UNSUPPORTED",
          "Query parameters are not accepted.",
          400,
        );
      }
      const expectedVersion = periodPositiveId(body.expected_record_version);
      const remarks =
        typeof body.review_remarks === "string"
          ? body.review_remarks.trim()
          : "";
      if (
        !["VERIFY", "REJECT"].includes(body.action) ||
        !expectedVersion ||
        expectedVersion >= 4294967295 ||
        remarks.length < 15 ||
        remarks.length > 1000 ||
        /[\x00-\x08\x0B\x0E-\x1F\x7F]/.test(remarks) ||
        body.confirm_review !== true ||
        typeof body.dry_run !== "boolean" ||
        (body.action === "VERIFY" &&
          body.confirm_source_document_reviewed !== true)
      ) {
        phHistoricalFail(
          "PH_HISTORICAL_REVIEW_INVALID",
          "Supply VERIFY or REJECT, current version, remarks (15–1000 characters), confirmation, boolean dry_run, and document-reviewed confirmation for VERIFY.",
          400,
        );
      }

      connection = await db.getConnection();
      await termReviewAssertTestDatabase(connection);
      const { userId, departmentId } = await incReviewAssertProgramHead(
        connection,
        req,
      );
      await connection.beginTransaction();
      inTransaction = true;
      // Historical source review writes remain QA-only
      await assertQaGradingDatabase(connection);
      // Lock the offering first, matching the Registrar source-registration path.
      const [pointers] = await connection.execute(
        `SELECT grade_id, enrollment_subject_id, offering_id
           FROM gradebook_historical_grade_source_reviews
          WHERE historical_review_id = ?`,
        [reviewId],
      );
      if (pointers.length !== 1) {
        phHistoricalFail(
          "PH_HISTORICAL_NOT_FOUND",
          "Historical source review was not found.",
          404,
        );
      }
      const pointer = pointers[0];
      const offeringId = Number(pointer.offering_id);
      const [offerings] = await connection.execute(
        `SELECT so.offering_id, so.status, so.academic_year_id, so.semester_id,
                c.department_id
           FROM subject_offerings so
           JOIN sections sec ON sec.section_id = so.section_id
           JOIN courses c ON c.course_id = sec.course_id
          WHERE so.offering_id = ? FOR UPDATE`,
        [offeringId],
      );
      if (
        offerings.length !== 1 ||
        Number(offerings[0].department_id) !== departmentId
      ) {
        phHistoricalFail(
          "PH_HISTORICAL_DEPARTMENT_FORBIDDEN",
          "The offering is outside your department.",
          403,
        );
      }
      const offering = offerings[0];

      const [grades] = await connection.execute(
        `SELECT g.grade_id, g.enrollment_subject_id, g.faculty_id,
                g.grade_status, g.grading_policy, g.grading_outcome,
                g.midterm_grade, g.final_grade, g.overall_percentage,
                g.final_rating, g.remarks, g.submitted_at, g.reviewed_by, g.reviewed_at,
                es.offering_id, es.status AS subject_status, es.enrollment_type,
                en.enrollment_status, en.academic_year_id, en.semester_id, en.student_id,
                s.student_number
           FROM grades g
           JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
           JOIN enrollments en ON en.enrollment_id = es.enrollment_id
           JOIN students s ON s.student_id = en.student_id
          WHERE g.grade_id = ? FOR UPDATE`,
        [Number(pointer.grade_id)],
      );
      const grade = grades[0];
      if (
        grades.length !== 1 ||
        Number(grade.enrollment_subject_id) !==
          Number(pointer.enrollment_subject_id) ||
        Number(grade.offering_id) !== offeringId
      ) {
        phHistoricalFail(
          "PH_HISTORICAL_GRADE_MOVED",
          "The original grade or its subject reference changed.",
        );
      }
      const [publications] = await connection.execute(
        `SELECT publication_id FROM gradebook_official_grade_publications
          WHERE grade_id = ? FOR UPDATE`,
        [grade.grade_id],
      );
      const [modernAttempts] = await connection.execute(
        `SELECT t.term_submission_id
           FROM gradebook_term_submission_attempts t
           JOIN gradebook_offering_config cfg ON cfg.config_id = t.config_id
          WHERE cfg.offering_id = ? AND t.enrollment_subject_id = ?
          LIMIT 1 FOR UPDATE`,
        [offeringId, Number(grade.enrollment_subject_id)],
      );
      const [finalized] = await connection.execute(
        `SELECT roster_snapshot_id FROM gradebook_finalized_roster
          WHERE grade_id = ? FOR UPDATE`,
        [grade.grade_id],
      );
      const [sheetRows] = await connection.execute(
        `SELECT sh.sheet_id, sh.sheet_status
           FROM gradebook_official_sheets sh
           JOIN gradebook_offering_config cfg ON cfg.config_id = sh.config_id
          WHERE cfg.offering_id = ? FOR UPDATE`,
        [offeringId],
      );
      const [requests] = await connection.execute(
        `SELECT * FROM gradebook_historical_grade_source_reviews
          WHERE historical_review_id = ? FOR UPDATE`,
        [reviewId],
      );
      if (
        requests.length !== 1 ||
        requests[0].review_status !== "PENDING_PH_REVIEW" ||
        Number(requests[0].record_version) !== expectedVersion ||
        Number(requests[0].grade_id) !== Number(grade.grade_id) ||
        Number(requests[0].offering_id) !== offeringId ||
        Number(requests[0].enrollment_subject_id) !==
          Number(grade.enrollment_subject_id)
      ) {
        phHistoricalFail(
          "PH_HISTORICAL_VERSION_CONFLICT",
          "Review changed; reload the current record.",
        );
      }
      const request = requests[0];
      const snapshot = phHistoricalJSON(request.original_grade_snapshot_json);
      const [events] = await connection.execute(
        `SELECT event_type, previous_status, new_status, source_snapshot_json,
                event_reason, performed_by_user_id, review_version_after
           FROM gradebook_historical_grade_source_review_events
          WHERE historical_review_id = ? ORDER BY review_version_after, historical_event_id FOR UPDATE`,
        [reviewId],
      );
      const initial = events[0];
      const eventSnapshot = phHistoricalJSON(initial?.source_snapshot_json);
      const auditValid =
        events.length === 1 &&
        initial?.event_type === "RECORDED" &&
        initial.previous_status === null &&
        initial.new_status === "PENDING_PH_REVIEW" &&
        Number(initial.review_version_after) === 1 &&
        Number(initial.performed_by_user_id) ===
          Number(request.recorded_by_user_id) &&
        initial.event_reason === request.evidence_summary &&
        Boolean(snapshot && eventSnapshot) &&
        JSON.stringify(snapshot) === JSON.stringify(eventSnapshot) &&
        Number(request.record_version) === 1;
      if (!auditValid) {
        phHistoricalFail(
          "PH_HISTORICAL_AUDIT_INVALID",
          "The original source audit history is inconsistent.",
        );
      }

      // Any historical-grade verification must recheck the exact original
      // published values; a changed grade requires a formal correction path.
      const gradeFields = [
        "grade_id",
        "enrollment_subject_id",
        "offering_id",
        "student_id",
        "student_number",
        "faculty_id",
        "grade_status",
        "grading_policy",
        "grading_outcome",
        "midterm_grade",
        "final_grade",
        "overall_percentage",
        "final_rating",
        "remarks",
        "reviewed_by",
        "reviewed_at",
        "submitted_at",
        "subject_status",
        "enrollment_status",
        "enrollment_type",
        "academic_year_id",
        "semester_id",
      ];
      const gradeMatchesSnapshot =
        Boolean(snapshot) &&
        gradeFields.every(
          (field) =>
            Object.prototype.hasOwnProperty.call(snapshot, field) &&
            phHistoricalEqual(snapshot[field], grade[field]),
        );
      const expectedClassification =
        grade?.grading_policy === "LEGACY"
          ? "LEGACY_POLICY"
          : "APPROVED_WITHOUT_PUBLICATION";
      const validSource =
        gradeMatchesSnapshot &&
        offering.status !== "Cancelled" &&
        grade.grade_status === "Approved" &&
        grade.grading_outcome === "NUMERIC" &&
        ["LEGACY", "TWO_TERM_50_50"].includes(grade.grading_policy) &&
        grade.final_rating != null &&
        ["Passed", "Failed"].includes(grade.remarks) &&
        grade.subject_status ===
          (grade.remarks === "Passed" ? "Completed" : "Failed") &&
        grade.enrollment_status === "Approved" &&
        grade.reviewed_by != null &&
        grade.reviewed_at != null &&
        Number(grade.academic_year_id) === Number(offering.academic_year_id) &&
        Number(grade.semester_id) === Number(offering.semester_id) &&
        publications.length === 0 &&
        modernAttempts.length === 0 &&
        finalized.length === 0 &&
        sheetRows.length <= 1 &&
        !sheetRows.some((row) => row.sheet_status === "FINALIZED") &&
        request.source_classification === expectedClassification &&
        snapshot?.source_classification === request.source_classification &&
        snapshot?.source_reference === request.source_reference &&
        snapshot?.evidence_summary === request.evidence_summary &&
        typeof request.source_reference === "string" &&
        request.source_reference.trim().length >= 8 &&
        typeof request.evidence_summary === "string" &&
        request.evidence_summary.trim().length >= 30;
      if (body.action === "VERIFY" && !validSource) {
        phHistoricalFail(
          "PH_HISTORICAL_SOURCE_STALE",
          "The historical approved grade, original source, or finalization state changed. Reject or reconcile it; do not verify stale evidence.",
        );
      }

      const newStatus = body.action === "VERIFY" ? "VERIFIED" : "REJECTED";
      const nextVersion = expectedVersion + 1;
      const [updated] = await connection.execute(
        `UPDATE gradebook_historical_grade_source_reviews
            SET review_status = ?, reviewed_by_user_id = ?, reviewed_at = NOW(6),
                review_remarks = ?, record_version = record_version + 1
          WHERE historical_review_id = ? AND review_status = 'PENDING_PH_REVIEW'
            AND record_version = ?`,
        [newStatus, userId, remarks, reviewId, expectedVersion],
      );
      if (Number(updated.affectedRows) !== 1) {
        phHistoricalFail(
          "PH_HISTORICAL_VERSION_CONFLICT",
          "The source review changed during processing.",
        );
      }
      const [event] = await connection.execute(
        `INSERT INTO gradebook_historical_grade_source_review_events
           (historical_review_id, event_type, previous_status, new_status,
            source_snapshot_json, event_reason, performed_by_user_id, review_version_after)
         VALUES (?, ?, 'PENDING_PH_REVIEW', ?, ?, ?, ?, ?)`,
        [
          reviewId,
          newStatus,
          newStatus,
          request.original_grade_snapshot_json,
          remarks,
          userId,
          nextVersion,
        ],
      );
      if (Number(event.affectedRows) !== 1) {
        throw new Error("Historical source review audit was not saved.");
      }
      if (body.dry_run) await connection.rollback();
      else await connection.commit();
      inTransaction = false;
      return res.json({
        success: true,
        dry_run: body.dry_run,
        persisted: !body.dry_run,
        historical_review_id: String(reviewId),
        grade_id: Number(grade.grade_id),
        offering_id: offeringId,
        action: body.action,
        review_status: newStatus,
        record_version: nextVersion,
        historical_event_id: body.dry_run ? null : String(event.insertId),
        source_evidence_verified: newStatus === "VERIFIED",
        official_grade_unchanged: true,
        official_sheet_unchanged: true,
        next_step:
          newStatus === "VERIFIED"
            ? "Verified source may be considered by the separate historical-grade finalization safeguard; no grade or sheet has been changed."
            : "Evidence rejected. A controlled reconsideration or new documented process is required.",
      });
    } catch (error) {
      if (inTransaction && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("PH HISTORICAL REVIEW ROLLBACK:", rollbackError);
        }
      }
      return phHistoricalSendError(res, error);
    } finally {
      connection?.release();
    }
  },
);

/* Combined Semester Return */
// Combined Semester Evidence Review

router.get(
  "/gradebook/semester-submissions/:submissionId/evidence",
  async (req, res) => {
    let connection;

    try {
      if (Object.keys(req.query ?? {}).length !== 0) {
        combinedReturnFail(
          "COMBINED_EVIDENCE_QUERY_INVALID",
          "Evidence review does not accept query parameters.",
          400,
        );
      }

      const submissionId = periodPositiveId(req.params.submissionId);

      if (!submissionId) {
        combinedReturnFail(
          "COMBINED_EVIDENCE_ID_INVALID",
          "Provide a valid submission ID.",
          400,
        );
      }

      connection = await db.getConnection();

      const { departmentId } = await incReviewAssertProgramHead(
        connection,
        req,
      );

      const [rows] = await connection.execute(
        `SELECT
            a.submission_id,
            a.grade_id,
            a.attempt_number,
            a.record_version,
            a.submission_status,
            a.grading_outcome_snapshot,
            a.submitted_at,
            a.calculation_snapshot_json,
            es.enrollment_subject_id,
            so.offering_id,
            s.student_number,
            CONCAT_WS(
              ' ',
              s.first_name,
              NULLIF(s.middle_name, ''),
              s.last_name
            ) AS student_name,
            sub.subject_code,
            sub.subject_name

         FROM gradebook_grade_submission_attempts a

         JOIN grades g
           ON g.grade_id = a.grade_id

         JOIN enrollment_subjects es
           ON es.enrollment_subject_id =
              g.enrollment_subject_id

         JOIN enrollments e
           ON e.enrollment_id = es.enrollment_id

         JOIN students s
           ON s.student_id = e.student_id

         JOIN subject_offerings so
           ON so.offering_id = es.offering_id

         JOIN subjects sub
           ON sub.subject_id = es.subject_id

         JOIN sections sec
           ON sec.section_id = so.section_id

         JOIN courses cr
           ON cr.course_id = sec.course_id

         WHERE a.submission_id = ?
           AND cr.department_id = ?
           AND a.grading_scope = 'FULL_SEMESTER'

           AND NOT EXISTS (
             SELECT 1
             FROM gradebook_grade_submission_attempts newer
             WHERE newer.grade_id = a.grade_id
               AND (
                 newer.attempt_number > a.attempt_number
                 OR (
                   newer.attempt_number = a.attempt_number
                   AND newer.submission_id > a.submission_id
                 )
               )
           )

         LIMIT 1`,
        [submissionId, departmentId],
      );

      if (rows.length !== 1) {
        combinedReturnFail(
          "COMBINED_EVIDENCE_NOT_FOUND",
          "The latest submission was not found in your department.",
          404,
        );
      }

      const row = rows[0];

      let snapshot = row.calculation_snapshot_json;

      if (Buffer.isBuffer(snapshot)) {
        snapshot = snapshot.toString("utf8");
      }

      if (typeof snapshot === "string") {
        try {
          snapshot = JSON.parse(snapshot);
        } catch {
          combinedReturnFail(
            "COMBINED_EVIDENCE_SNAPSHOT_INVALID",
            "The saved submission evidence is not valid JSON.",
          );
        }
      }

      if (
        !snapshot ||
        typeof snapshot !== "object" ||
        Array.isArray(snapshot) ||
        snapshot.policy !== "TWO_TERM_50_50" ||
        snapshot.grading_scope !== "FULL_SEMESTER" ||
        Number(snapshot.grade_id) !== Number(row.grade_id) ||
        Number(snapshot.offering_id) !== Number(row.offering_id) ||
        Number(snapshot.enrollment_subject_id) !==
          Number(row.enrollment_subject_id)
      ) {
        combinedReturnFail(
          "COMBINED_EVIDENCE_SNAPSHOT_MISMATCH",
          "The saved evidence does not match this submission.",
        );
      }

      res.set("Cache-Control", "no-store");

      return res.json({
        success: true,
        read_only: true,

        submission: {
          submission_id: String(row.submission_id),
          grade_id: Number(row.grade_id),
          enrollment_subject_id: Number(row.enrollment_subject_id),
          offering_id: Number(row.offering_id),
          attempt_number: Number(row.attempt_number),
          record_version: Number(row.record_version),
          submission_status: row.submission_status,
          grading_outcome: row.grading_outcome_snapshot,
          submitted_at: row.submitted_at,
          student_name: row.student_name,
          student_number: row.student_number,
          subject_code: row.subject_code,
          subject_name: row.subject_name,
        },

        calculation_snapshot: snapshot,
      });
    } catch (error) {
      const status =
        Number.isInteger(error?.status) &&
        error.status >= 400 &&
        error.status < 500
          ? error.status
          : 500;

      if (status === 500) {
        console.error("COMBINED EVIDENCE REVIEW:", error);
      }

      return res.status(status).json({
        success: false,

        code:
          status === 500
            ? "COMBINED_EVIDENCE_INTERNAL_ERROR"
            : error.code || "COMBINED_EVIDENCE_FAILED",

        message:
          status === 500
            ? "Could not load the saved submission evidence."
            : error.message,
      });
    } finally {
      connection?.release();
    }
  },
);
// Combined Semester Review Queue
router.get("/gradebook/semester-submissions", async (req, res) => {
  let connection;

  try {
    const allowedQuery = new Set(["status", "limit"]);

    if (Object.keys(req.query ?? {}).some((key) => !allowedQuery.has(key))) {
      return res.status(400).json({
        success: false,
        code: "COMBINED_QUEUE_QUERY_INVALID",
        message: "Only status and limit filters are supported.",
      });
    }

    const status = req.query.status ?? "SUBMITTED";
    const statuses = ["SUBMITTED", "RETURNED", "APPROVED", "ALL"];

    if (typeof status !== "string" || !statuses.includes(status)) {
      return res.status(400).json({
        success: false,
        code: "COMBINED_QUEUE_STATUS_INVALID",
        message: "status must be SUBMITTED, RETURNED, APPROVED, or ALL.",
      });
    }

    const limitText = req.query.limit ?? "50";
    const limit =
      typeof limitText === "string" && /^[1-9][0-9]*$/.test(limitText)
        ? Number(limitText)
        : NaN;

    if (!Number.isSafeInteger(limit) || limit > 100) {
      return res.status(400).json({
        success: false,
        code: "COMBINED_QUEUE_LIMIT_INVALID",
        message: "limit must be a whole number from 1 to 100.",
      });
    }

    connection = await db.getConnection();
    const { userId, departmentId } = await incReviewAssertProgramHead(
      connection,
      req,
    );

    const [headRows] = await connection.execute(
      `SELECT ph.program_head_id, ph.faculty_id, f.employee_number,
              u.username, d.department_id, d.department_code, d.department_name,
              CONCAT_WS(' ', f.first_name, NULLIF(f.middle_name, ''), f.last_name)
                AS program_head_name
         FROM program_heads ph
         JOIN faculty f ON f.faculty_id = ph.faculty_id
         JOIN users u ON u.user_id = f.user_id
         JOIN departments d ON d.department_id = ph.department_id
        WHERE f.user_id = ? AND ph.department_id = ? AND ph.is_active = 1
          AND (ph.start_date IS NULL OR ph.start_date <= CURDATE())
          AND (ph.end_date IS NULL OR ph.end_date >= CURDATE())
        LIMIT 1`,
      [userId, departmentId],
    );

    if (headRows.length !== 1) {
      combinedReturnFail(
        "COMBINED_QUEUE_PROGRAM_HEAD_UNAVAILABLE",
        "Active Program Head profile is unavailable.",
        403,
      );
    }

    const head = headRows[0];

    const statusFilter = status === "ALL" ? "" : "AND a.submission_status = ?";
    const params = [departmentId];
    if (status !== "ALL") params.push(status);
    params.push(limit);

    const [rows] = await connection.execute(
      `SELECT a.submission_id, a.grade_id, a.record_version,
              a.attempt_number, a.grading_outcome_snapshot,
              a.submission_status, a.returned_edit_scope,
              a.submitted_at, a.reviewed_at, a.review_remarks,
              a.submitted_by_user_id, a.reviewed_by_user_id,
              a.midterm_percentage_snapshot, a.final_term_percentage_snapshot,
              a.overall_percentage_snapshot, a.final_rating_snapshot,
              a.special_outcome_reason_snapshot,
              g.grade_status, g.grading_policy, g.remarks,
              es.enrollment_subject_id, es.status AS subject_status,
              e.enrollment_id, e.enrollment_status,
              s.student_id, s.student_number,
              s.first_name AS student_first_name,
              s.middle_name AS student_middle_name,
              s.last_name AS student_last_name,
              CONCAT_WS(' ', s.first_name, NULLIF(s.middle_name, ''), s.last_name)
                AS student_name,
              so.offering_id, so.status AS offering_status,
              so.schedule_days, so.schedule_time,
              sub.subject_id, sub.subject_code, sub.subject_name, sub.units,
              sec.section_id, sec.section_name, sec.year_level,
              cr.course_id, cr.course_code, cr.course_name,
              ay.academic_year_id, ay.academic_year,
              ay.is_current AS academic_year_is_current,
              sem.semester_id, sem.semester_name,
              f.faculty_id, f.employee_number AS faculty_employee_number,
              f.first_name AS faculty_first_name,
              f.middle_name AS faculty_middle_name,
              f.last_name AS faculty_last_name, f.email AS faculty_email,
              CONCAT_WS(' ', f.first_name, NULLIF(f.middle_name, ''), f.last_name)
                AS faculty_name,
             
              sh.sheet_status,
              CASE
                WHEN a.grading_outcome_snapshot = 'NUMERIC'
                 AND g.grading_outcome = 'NUMERIC'
                 AND a.submission_status = 'SUBMITTED'
                 AND g.grade_status = 'Submitted'
                 AND g.grading_policy = 'TWO_TERM_50_50'
                 AND sh.sheet_status = 'IN_PROGRESS'
                 AND sh.original_official_submitted_on IS NULL
                 AND sh.official_submission_reference IS NULL
                 AND sh.official_date_verified_at IS NULL
                 AND a.special_outcome_id IS NULL
                 AND a.returned_edit_scope IS NULL
                 AND a.reviewed_by_user_id IS NULL
                 AND a.reviewed_at IS NULL
                 AND a.submitted_at IS NOT NULL
                 AND e.enrollment_status = 'Approved'
                 AND es.status = 'Enrolled'
                 AND so.status <> 'Cancelled'
                 AND NOT EXISTS (
                   SELECT 1
                     FROM gradebook_official_grade_publications p2
                    WHERE p2.grade_id = a.grade_id
                 )
                 THEN 1 ELSE 0
              END AS numeric_batch_candidate,
              CASE WHEN pub.publication_id IS NULL THEN 0 ELSE 1 END
                AS officially_published

         FROM gradebook_grade_submission_attempts a
         JOIN grades g ON g.grade_id = a.grade_id
         JOIN enrollment_subjects es
           ON es.enrollment_subject_id = g.enrollment_subject_id
         JOIN enrollments e ON e.enrollment_id = es.enrollment_id
         JOIN students s ON s.student_id = e.student_id
         JOIN subject_offerings so ON so.offering_id = es.offering_id
         JOIN subjects sub ON sub.subject_id = es.subject_id
         JOIN sections sec ON sec.section_id = so.section_id
         JOIN courses cr ON cr.course_id = sec.course_id
         JOIN academic_years ay ON ay.academic_year_id = so.academic_year_id
         JOIN semesters sem ON sem.semester_id = so.semester_id
         JOIN faculty f ON f.faculty_id = so.faculty_id
         JOIN gradebook_official_sheets sh ON sh.sheet_id = a.sheet_id
         LEFT JOIN gradebook_official_grade_publications pub
           ON pub.combined_submission_id = a.submission_id
        WHERE cr.department_id = ?
          AND a.grading_scope = 'FULL_SEMESTER'
          AND NOT EXISTS (
            SELECT 1
              FROM gradebook_grade_submission_attempts newer
             WHERE newer.grade_id = a.grade_id
               AND (
                 newer.attempt_number > a.attempt_number OR
                 (newer.attempt_number = a.attempt_number
                  AND newer.submission_id > a.submission_id)
               )
          )
          ${statusFilter}
        ORDER BY a.submitted_at DESC, a.submission_id DESC
        LIMIT ?`,
      params,
    );

    res.set("Cache-Control", "no-store");

    return res.json({
      success: true,
      read_only: true,
      status_filter: status,
      program_head: {
        program_head_id: Number(head.program_head_id),
        faculty_id: Number(head.faculty_id),
        user_id: userId,
        employee_number: head.employee_number,
        username: head.username,
        program_head_name: head.program_head_name,
        department: {
          department_id: Number(head.department_id),
          department_code: head.department_code,
          department_name: head.department_name,
        },
      },
      limit,
      count: rows.length,
      submissions: rows.map((row) => ({
        ...row,
        submission_id: String(row.submission_id),
        grade_id: Number(row.grade_id),
        enrollment_subject_id: Number(row.enrollment_subject_id),
        offering_id: Number(row.offering_id),
        record_version: Number(row.record_version),
        attempt_number: Number(row.attempt_number),
        officially_published: Number(row.officially_published) === 1,
        numeric_batch_candidate: Number(row.numeric_batch_candidate) === 1,
      })),
    });
  } catch (error) {
    const status =
      Number.isInteger(error?.status) &&
      error.status >= 400 &&
      error.status < 500
        ? error.status
        : 500;

    if (status === 500) {
      console.error("COMBINED SEMESTER QUEUE:", error);
    }

    return res.status(status).json({
      success: false,
      code:
        status === 500
          ? "COMBINED_QUEUE_INTERNAL_ERROR"
          : error.code || "COMBINED_QUEUE_FAILED",
      message:
        status === 500
          ? "Could not load combined semester submissions."
          : error.message,
    });
  } finally {
    connection?.release();
  }
});

function combinedReturnFail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

async function assertCombinedReturnDatabaseAllowed(connection, dryRun) {
  const [rows] = await connection.execute("SELECT DATABASE() AS database_name");

  const databaseName =
    Array.isArray(rows) && rows.length === 1 ? rows[0]?.database_name : null;

  if (typeof databaseName !== "string" || !databaseName.trim()) {
    combinedReturnFail(
      "COMBINED_RETURN_DATABASE_UNKNOWN",
      "Could not verify the active grading database.",
      403,
    );
  }

  if (databaseName === "databaseforptc1_admission_test") {
    if (process.env.NODE_ENV === "production") {
      combinedReturnFail(
        "COMBINED_RETURN_QA_PRODUCTION_FORBIDDEN",
        "QA grading returns are unavailable in production.",
        403,
      );
    }

    if (
      !dryRun &&
      process.env.GRADEBOOK_COMBINED_RETURN_WRITES_ENABLED !== "true"
    ) {
      combinedReturnFail(
        "COMBINED_RETURN_WRITES_DISABLED",
        "Combined semester returns are not enabled on this server.",
        403,
      );
    }

    return;
  }

  if (process.env.GRADEBOOK_COMBINED_RETURN_WRITES_ENABLED !== "true") {
    combinedReturnFail(
      "COMBINED_RETURN_WRITES_DISABLED",
      "Combined semester returns are not enabled on this server.",
      403,
    );
  }

  const configuredDatabase = process.env.DB_NAME?.trim();
  const targetDatabase =
    process.env.GRADEBOOK_COMBINED_RETURN_TARGET_DATABASE?.trim();

  if (
    !configuredDatabase ||
    !targetDatabase ||
    databaseName !== configuredDatabase ||
    databaseName !== targetDatabase
  ) {
    combinedReturnFail(
      "COMBINED_RETURN_DATABASE_MISMATCH",
      "This database is not authorized for combined semester returns.",
      403,
    );
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.GRADEBOOK_COMBINED_RETURN_PRODUCTION_ENABLED !== "true"
  ) {
    combinedReturnFail(
      "COMBINED_RETURN_PRODUCTION_DISABLED",
      "Production grading returns require separate authorization.",
      403,
    );
  }
}

function combinedReturnRespond(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;

  if (status === 500) {
    console.error("COMBINED SEMESTER RETURN:", error);
  }

  return res.status(status).json({
    success: false,
    code: status === 500 ? "COMBINED_RETURN_INTERNAL_ERROR" : error.code,
    message:
      status === 500 ? "Could not return semester submission." : error.message,
  });
}

router.post(
  "/gradebook/semester-submissions/:submissionId/return",
  async (req, res) => {
    let connection;
    let inTransaction = false;

    try {
      const submissionId = periodPositiveId(req.params.submissionId);

      const body = req.body;

      const allowed = new Set([
        "expected_record_version",
        "returned_edit_scope",
        "review_remarks",
        "confirm_return",
        "dry_run",
      ]);

      const version = periodPositiveId(body?.expected_record_version);

      const scope = body?.returned_edit_scope;

      const remarks =
        typeof body?.review_remarks === "string"
          ? body.review_remarks.trim()
          : "";

      if (
        Object.keys(req.query ?? {}).length ||
        !submissionId ||
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some((key) => !allowed.has(key)) ||
        !version ||
        version >= 4294967295 ||
        !["MIDTERM", "FINAL_TERM", "BOTH"].includes(scope) ||
        remarks.length < 15 ||
        remarks.length > 500 ||
        /[\x00-\x08\x0B\x0E-\x1F\x7F]/.test(remarks) ||
        body.confirm_return !== true ||
        typeof body.dry_run !== "boolean"
      ) {
        combinedReturnFail(
          "COMBINED_RETURN_INPUT_INVALID",
          "Provide submission ID, current version, return scope, remarks (15–500 characters), confirmation, and boolean dry_run.",
          400,
        );
      }

      connection = await db.getConnection();

      await connection.beginTransaction();
      inTransaction = true;

      // Check the actual database before any review writes.
      await assertCombinedReturnDatabaseAllowed(connection, body.dry_run);

      const { userId, departmentId } = await incReviewAssertProgramHead(
        connection,
        req,
      );

      // Identify the submission before locking its related records.
      const [targets] = await connection.execute(
        `SELECT
           a.grade_id,
           a.sheet_id,
           a.period_id,
           a.attempt_number,
           g.enrollment_subject_id,
           es.offering_id,
           sh.config_id
         FROM gradebook_grade_submission_attempts a
         JOIN grades g ON g.grade_id = a.grade_id
         JOIN enrollment_subjects es
           ON es.enrollment_subject_id = g.enrollment_subject_id
         JOIN gradebook_official_sheets sh
           ON sh.sheet_id = a.sheet_id
         WHERE a.submission_id = ?`,
        [submissionId],
      );

      if (targets.length !== 1) {
        combinedReturnFail(
          "COMBINED_SUBMISSION_NOT_FOUND",
          "Combined submission not found.",
          404,
        );
      }

      const target = targets[0];

      // Offering
      const [offerings] = await connection.execute(
        `SELECT
           so.offering_id,
           so.status AS offering_status,
           so.academic_year_id,
           so.semester_id,
           so.faculty_id,
           cr.department_id
         FROM subject_offerings so
         JOIN sections sec
           ON sec.section_id = so.section_id
         JOIN courses cr
           ON cr.course_id = sec.course_id
         WHERE so.offering_id = ?
         FOR UPDATE`,
        [target.offering_id],
      );

      const offering = offerings[0];

      if (
        offerings.length !== 1 ||
        Number(offering.department_id) !== departmentId ||
        offering.offering_status === "Cancelled"
      ) {
        combinedReturnFail(
          "COMBINED_RETURN_DEPARTMENT_FORBIDDEN",
          "Offering is unavailable or outside your department.",
          403,
        );
      }

      // Gradebook configuration
      const [configs] = await connection.execute(
        `SELECT
           config_id,
           offering_id,
           midterm_percent,
           final_term_percent
         FROM gradebook_offering_config
         WHERE config_id = ?
           AND offering_id = ?
         FOR UPDATE`,
        [target.config_id, target.offering_id],
      );

      if (
        configs.length !== 1 ||
        Number(configs[0].midterm_percent) !== 50 ||
        Number(configs[0].final_term_percent) !== 50
      ) {
        combinedReturnFail(
          "COMBINED_RETURN_CONFIG_INVALID",
          "Official 50/50 gradebook configuration changed.",
        );
      }

      // Student enrollment
      const [students] = await connection.execute(
        `SELECT
           es.enrollment_subject_id,
           es.offering_id,
           es.status AS subject_status,
           e.enrollment_status
         FROM enrollment_subjects es
         JOIN enrollments e
           ON e.enrollment_id = es.enrollment_id
         WHERE es.enrollment_subject_id = ?
         FOR UPDATE`,
        [target.enrollment_subject_id],
      );

      if (
        students.length !== 1 ||
        Number(students[0].offering_id) !== Number(target.offering_id) ||
        students[0].subject_status !== "Enrolled" ||
        students[0].enrollment_status !== "Approved"
      ) {
        combinedReturnFail(
          "COMBINED_RETURN_ENROLLMENT_CHANGED",
          "Enrollment is no longer approved and active.",
        );
      }

      // Submission period
      const [periods] = await connection.execute(
        `SELECT
           period_id,
           department_id,
           academic_year_id,
           semester_id
         FROM gradebook_submission_periods
         WHERE period_id = ?
         FOR UPDATE`,
        [target.period_id],
      );

      if (
        periods.length !== 1 ||
        Number(periods[0].department_id) !== departmentId ||
        Number(periods[0].academic_year_id) !==
          Number(offering.academic_year_id) ||
        Number(periods[0].semester_id) !== Number(offering.semester_id)
      ) {
        combinedReturnFail(
          "COMBINED_RETURN_PERIOD_MISMATCH",
          "Submission window does not match the offering.",
        );
      }

      // Grade
      const [grades] = await connection.execute(
        `SELECT
           grade_id,
           enrollment_subject_id,
           faculty_id,
           grade_status,
           grading_policy,
           grading_outcome,
           midterm_grade,
           final_grade,
           overall_percentage,
           final_rating
         FROM grades
         WHERE grade_id = ?
         FOR UPDATE`,
        [target.grade_id],
      );

      const grade = grades[0];

      if (
        grades.length !== 1 ||
        Number(grade.enrollment_subject_id) !==
          Number(target.enrollment_subject_id) ||
        Number(grade.faculty_id) !== Number(offering.faculty_id) ||
        grade.grade_status !== "Submitted" ||
        grade.grading_policy !== "TWO_TERM_50_50" ||
        grade.grading_outcome !== "NUMERIC"
      ) {
        combinedReturnFail(
          "COMBINED_RETURN_GRADE_MISMATCH",
          "Only a source-backed submitted numeric grade can be returned.",
        );
      }

      // Official sheet
      const [sheets] = await connection.execute(
        `SELECT
           sheet_id,
           config_id,
           sheet_status,
           original_official_submitted_on,
           official_date_verified_at
         FROM gradebook_official_sheets
         WHERE sheet_id = ?
         FOR UPDATE`,
        [target.sheet_id],
      );

      if (
        sheets.length !== 1 ||
        Number(sheets[0].config_id) !== Number(target.config_id) ||
        sheets[0].sheet_status !== "IN_PROGRESS" ||
        sheets[0].original_official_submitted_on != null ||
        sheets[0].official_date_verified_at != null
      ) {
        combinedReturnFail(
          "COMBINED_RETURN_SHEET_LOCKED",
          "The official sheet has already reached the official submission-date stage.",
        );
      }

      // Published grades cannot be returned through this route.
      const [publications] = await connection.execute(
        `SELECT publication_id
         FROM gradebook_official_grade_publications
         WHERE grade_id = ?
         FOR UPDATE`,
        [target.grade_id],
      );

      if (publications.length) {
        combinedReturnFail(
          "COMBINED_RETURN_ALREADY_PUBLISHED",
          "Published grades require the audited amendment workflow.",
        );
      }

      // Do not mix historical term submissions with combined submissions.
      const [oldTerms] = await connection.execute(
        `SELECT term_submission_id
         FROM gradebook_term_submission_attempts
         WHERE config_id = ?
         LIMIT 1`,
        [target.config_id],
      );

      if (oldTerms.length) {
        combinedReturnFail(
          "COMBINED_RETURN_LEGACY_HISTORY",
          "This offering has older term-based submissions requiring reconciliation.",
        );
      }

      // Shared structure lock
      const [locks] = await connection.execute(
        `SELECT first_submission_id
         FROM gradebook_structure_locks
         WHERE config_id = ?
         FOR UPDATE`,
        [target.config_id],
      );

      if (locks.length !== 1) {
        combinedReturnFail(
          "COMBINED_RETURN_LOCK_MISSING",
          "First combined-submission structure lock is missing.",
        );
      }

      // Verify the structure lock belongs to this official sheet.
      const [firstSubmissions] = await connection.execute(
        `SELECT submission_id
           FROM gradebook_grade_submission_attempts
          WHERE submission_id = ?
            AND sheet_id = ?
          LIMIT 1`,
        [locks[0].first_submission_id, target.sheet_id],
      );

      if (firstSubmissions.length !== 1) {
        combinedReturnFail(
          "COMBINED_RETURN_STRUCTURE_HISTORY_INVALID",
          "The gradebook structure lock does not belong to this official sheet.",
        );
      }

      // Latest submission and version

      const [latest] = await connection.execute(
        `SELECT *
         FROM gradebook_grade_submission_attempts
         WHERE grade_id = ?
         ORDER BY attempt_number DESC, submission_id DESC
         LIMIT 1
         FOR UPDATE`,
        [target.grade_id],
      );

      const submission = latest[0];

      if (
        latest.length !== 1 ||
        String(submission.submission_id) !== String(submissionId) ||
        String(submission.sheet_id) !== String(target.sheet_id) ||
        Number(submission.period_id) !== Number(target.period_id) ||
        Number(submission.record_version) !== version ||
        submission.submission_status !== "SUBMITTED" ||
        submission.returned_edit_scope != null ||
        submission.reviewed_by_user_id != null ||
        submission.reviewed_at != null ||
        submission.grading_scope !== "FULL_SEMESTER" ||
        submission.grading_outcome_snapshot !== "NUMERIC" ||
        submission.special_outcome_id != null
      ) {
        combinedReturnFail(
          "COMBINED_RETURN_NOT_CURRENT",
          "This is not the latest pending numeric submission. Reload and retry.",
        );
      }

      // Validate the original calculation snapshot.
      const numericSame = (a, b) =>
        a != null && b != null && Number(a) === Number(b);

      let snapshot = null;

      try {
        snapshot =
          typeof submission.calculation_snapshot_json === "string"
            ? JSON.parse(submission.calculation_snapshot_json)
            : submission.calculation_snapshot_json;
      } catch {
        // Invalid source snapshot
      }

      if (
        !snapshot ||
        snapshot.policy !== "TWO_TERM_50_50" ||
        snapshot.grading_scope !== "FULL_SEMESTER" ||
        Number(snapshot.offering_id) !== Number(target.offering_id) ||
        Number(snapshot.config_id) !== Number(target.config_id) ||
        Number(snapshot.enrollment_subject_id) !==
          Number(target.enrollment_subject_id) ||
        Number(snapshot.grade_id) !== Number(target.grade_id) ||
        snapshot.calculated_terms?.MIDTERM?.state !== "READY" ||
        snapshot.calculated_terms?.FINAL_TERM?.state !== "READY" ||
        snapshot.calculated_semester?.state !== "READY" ||
        !numericSame(
          grade.midterm_grade,
          submission.midterm_percentage_snapshot,
        ) ||
        !numericSame(
          grade.final_grade,
          submission.final_term_percentage_snapshot,
        ) ||
        !numericSame(
          grade.overall_percentage,
          submission.overall_percentage_snapshot,
        ) ||
        !numericSame(grade.final_rating, submission.final_rating_snapshot)
      ) {
        combinedReturnFail(
          "COMBINED_RETURN_SOURCE_STALE",
          "The submitted grade or calculation snapshot changed.",
        );
      }

      // Verify immutable exact calculation evidence.
      const ratios = [
        [
          submission.midterm_exact_numerator,
          submission.midterm_exact_denominator,
          snapshot.calculated_terms.MIDTERM.term_percentage,
        ],
        [
          submission.final_term_exact_numerator,
          submission.final_term_exact_denominator,
          snapshot.calculated_terms.FINAL_TERM.term_percentage,
        ],
        [
          submission.overall_exact_numerator,
          submission.overall_exact_denominator,
          snapshot.calculated_semester.semester_percentage,
        ],
      ];

      for (const [numerator, denominator, source] of ratios) {
        if (
          !/^(0|[1-9]\d*)$/.test(String(numerator ?? "")) ||
          !/^[1-9]\d*$/.test(String(denominator ?? "")) ||
          String(numerator) !== String(source?.exact_numerator) ||
          String(denominator) !== String(source?.exact_denominator)
        ) {
          combinedReturnFail(
            "COMBINED_RETURN_RATIO_MISMATCH",
            "Exact calculation provenance is inconsistent.",
          );
        }
      }

      // One review decision per submission attempt.
      const [reviews] = await connection.execute(
        `SELECT review_id
         FROM gradebook_grade_submission_reviews
         WHERE submission_id = ?
         LIMIT 1
         FOR UPDATE`,
        [submissionId],
      );

      if (reviews.length) {
        combinedReturnFail(
          "COMBINED_RETURN_ALREADY_REVIEWED",
          "This attempt already has a review decision.",
        );
      }

      // Return the submitted attempt.
      const [updated] = await connection.execute(
        `UPDATE gradebook_grade_submission_attempts
         SET submission_status = 'RETURNED',
             returned_edit_scope = ?,
             review_remarks = ?,
             reviewed_by_user_id = ?,
             reviewed_at = NOW(),
             record_version = record_version + 1
         WHERE submission_id = ?
           AND submission_status = 'SUBMITTED'
           AND record_version = ?`,
        [scope, remarks, userId, submissionId, version],
      );

      if (Number(updated.affectedRows) !== 1) {
        combinedReturnFail(
          "COMBINED_RETURN_VERSION_CONFLICT",
          "Submission changed during review.",
        );
      }

      // Return the grade without changing its calculated values.
      const [gradeUpdate] = await connection.execute(
        `UPDATE grades
         SET grade_status = 'Returned',
             reviewed_by = ?,
             review_remarks = ?
         WHERE grade_id = ?
           AND grade_status = 'Submitted'`,
        [userId, remarks, target.grade_id],
      );

      if (Number(gradeUpdate.affectedRows) !== 1) {
        combinedReturnFail(
          "COMBINED_RETURN_GRADE_CONFLICT",
          "Grade changed during return.",
        );
      }

      // Save the Program Head review.
      const [audit] = await connection.execute(
        `INSERT INTO gradebook_grade_submission_reviews
         (
           submission_id,
           review_decision,
           grading_outcome_snapshot,
           review_notes,
           returned_edit_scope,
           is_self_approval,
           reviewed_by_user_id,
           submission_version_after
         )
         VALUES (
           ?, 'RETURNED', 'NUMERIC',
           ?, ?, 0, ?, ?
         )`,
        [submissionId, remarks, scope, userId, version + 1],
      );

      if (Number(audit.affectedRows) !== 1) {
        throw new Error("Could not save return-review audit.");
      }

      if (body.dry_run) {
        await connection.rollback();
      } else {
        await connection.commit();
      }

      inTransaction = false;

      return res.json({
        success: true,
        dry_run: body.dry_run,
        persisted: !body.dry_run,
        submission_id: String(submissionId),
        grade_id: Number(target.grade_id),
        submission_status: "RETURNED",
        grade_status: "Returned",
        returned_edit_scope: scope,
        record_version: version + 1,
        review_id: body.dry_run ? null : String(audit.insertId),
        official_grade_published: false,
        note: "Only the returned term scope may be edited. Resubmission requires the authorized combined-semester workflow.",
      });
    } catch (error) {
      if (inTransaction && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("COMBINED RETURN ROLLBACK:", rollbackError);
        }
      }

      if (error?.code === "ER_DUP_ENTRY") {
        return combinedReturnRespond(res, {
          status: 409,
          code: "COMBINED_RETURN_ALREADY_REVIEWED",
          message: "A review was already recorded. Reload the submission.",
        });
      }

      return combinedReturnRespond(res, error);
    } finally {
      connection?.release();
    }
  },
);
/* Combined Semester Approval */

function combinedApprovalFail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function combinedApprovalRespond(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;

  if (status === 500) {
    console.error("COMBINED APPROVAL:", error);
  }

  return res.status(status).json({
    success: false,
    code: status === 500 ? "COMBINED_APPROVAL_ERROR" : error.code,
    message:
      status === 500 ? "Could not approve semester submission." : error.message,
  });
}

function combinedApprovalFraction(n, d, source, maxDigits) {
  const numerator = String(n ?? "");
  const denominator = String(d ?? "");

  if (
    !/^(0|[1-9]\d*)$/.test(numerator) ||
    !/^[1-9]\d*$/.test(denominator) ||
    numerator.length > maxDigits ||
    denominator.length > maxDigits ||
    String(source?.exact_numerator) !== numerator ||
    String(source?.exact_denominator) !== denominator
  ) {
    combinedApprovalFail(
      "COMBINED_APPROVAL_EXACT_SOURCE_INVALID",
      "Approved calculations must match the submitted exact source fractions.",
    );
  }

  const ratio = {
    n: BigInt(numerator),
    d: BigInt(denominator),
  };

  if (ratio.n > 100n * ratio.d) {
    combinedApprovalFail(
      "COMBINED_APPROVAL_PERCENT_INVALID",
      "Grade percentage is outside 0–100.",
    );
  }

  return ratio;
}

function combinedApprovalDecimal12(ratio) {
  const scale = 1000000000000n;
  const units = (ratio.n * scale * 2n + ratio.d) / (ratio.d * 2n);

  return Number(`${units / scale}.${String(units % scale).padStart(12, "0")}`);
}

function combinedApprovalRating(ratio) {
  for (const [minimum, rating] of [
    [97n, "1.00"],
    [94n, "1.25"],
    [91n, "1.50"],
    [88n, "1.75"],
    [85n, "2.00"],
    [82n, "2.25"],
    [79n, "2.50"],
    [76n, "2.75"],
    [75n, "3.00"],
  ]) {
    if (ratio.n >= minimum * ratio.d) {
      return rating;
    }
  }

  return "5.00";
}
// Validate the linked special outcome and its recorded gradebook evidence.

async function handleCombinedSemesterApproval(req, res) {
  let connection;
  let transactionOpen = false;

  try {
    const isBatch = req.params.submissionId == null;

    const batch = isBatch ? validateNumericBatchApprovalInput(req.body) : null;

    const firstItem = batch?.submissions?.[0] ?? null;

    let submissionId = periodPositiveId(
      firstItem?.submission_id ?? req.params.submissionId,
    );

    const body = isBatch
      ? {
          expected_record_version: firstItem.expected_record_version,
          review_remarks: batch.review_remarks,
          confirm_approval: true,
          dry_run: batch.dry_run,
        }
      : req.body;

    const allowed = new Set([
      "expected_record_version",
      "review_remarks",
      "confirm_approval",
      "confirm_special_evidence",
      "evidence_review_notes",
      "dry_run",
    ]);

    let expectedVersion = periodPositiveId(body?.expected_record_version);

    const remarks =
      typeof body?.review_remarks === "string"
        ? body.review_remarks.trim()
        : "";

    if (
      !submissionId ||
      Object.keys(req.query ?? {}).length !== 0 ||
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.has(key)) ||
      !expectedVersion ||
      expectedVersion >= 4294967295 ||
      remarks.length < 10 ||
      remarks.length > 500 ||
      /[\x00-\x08\x0B\x0E-\x1F\x7F]/.test(remarks) ||
      body.confirm_approval !== true ||
      typeof body.dry_run !== "boolean"
    ) {
      combinedApprovalFail(
        "COMBINED_APPROVAL_INPUT_INVALID",
        "Provide the current submission version, review remarks (10–500 characters), confirmation, and boolean dry_run.",
        400,
      );
    }

    connection = await db.getConnection();

    await connection.beginTransaction();
    transactionOpen = true;

    // Require explicit database authorization for every approval request.
    const { isQaDatabase } =
      await assertCombinedApprovalWriteAllowed(connection);

    // Batch approval has a separate commit permission from individual review.
    if (isBatch && !body.dry_run) {
      if (
        process.env.GRADEBOOK_NUMERIC_BATCH_APPROVAL_WRITES_ENABLED !== "true"
      ) {
        combinedApprovalFail(
          "COMBINED_BATCH_APPROVAL_WRITES_DISABLED",
          "Numeric batch approval is not enabled on this server.",
          403,
        );
      }

      if (
        process.env.NODE_ENV === "production" &&
        process.env.GRADEBOOK_NUMERIC_BATCH_APPROVAL_PRODUCTION_ENABLED !==
          "true"
      ) {
        combinedApprovalFail(
          "COMBINED_BATCH_APPROVAL_PRODUCTION_DISABLED",
          "Production numeric batch approvals require separate authorization.",
          403,
        );
      }
    }

    // Retain the original QA commit opt-in for both approval types.
    if (
      isQaDatabase &&
      !body.dry_run &&
      process.env.GRADEBOOK_COMBINED_APPROVAL_WRITES_ENABLED !== "true"
    ) {
      combinedApprovalFail(
        "COMBINED_APPROVAL_WRITES_DISABLED",
        "Combined semester approval is not enabled on this server.",
        403,
      );
    }

    const { userId, departmentId } = await incReviewAssertProgramHead(
      connection,
      req,
    );

    const selected = batch?.submissions ?? [
      {
        submission_id: submissionId,
        expected_record_version: expectedVersion,
      },
    ];

    const reviewBatchRef = isBatch ? randomUUID() : null;
    const approved = [];

    for (const item of selected) {
      submissionId = item.submission_id;
      expectedVersion = item.expected_record_version;

      // Find the submission target.
      const [targets] = await connection.execute(
        `SELECT a.grade_id,
                a.sheet_id,
                a.period_id,
                g.enrollment_subject_id,
                es.offering_id,
                sh.config_id
         FROM gradebook_grade_submission_attempts a
         JOIN grades g
           ON g.grade_id = a.grade_id
         JOIN enrollment_subjects es
           ON es.enrollment_subject_id =
              g.enrollment_subject_id
         JOIN gradebook_official_sheets sh
           ON sh.sheet_id = a.sheet_id
         WHERE a.submission_id = ?`,
        [submissionId],
      );

      if (targets.length !== 1) {
        combinedApprovalFail(
          "COMBINED_APPROVAL_NOT_FOUND",
          "Submission not found.",
          404,
        );
      }

      const target = targets[0];

      // Offering
      const [offerings] = await connection.execute(
        `SELECT so.offering_id,
                so.status,
                so.faculty_id,
                so.academic_year_id,
                so.semester_id,
                cr.department_id,
                f.user_id AS instructor_user_id,
                u.is_active AS instructor_active,
                u.is_archived AS instructor_archived,
                r.role_name AS instructor_role
         FROM subject_offerings so
         JOIN faculty f
           ON f.faculty_id = so.faculty_id
         JOIN users u
           ON u.user_id = f.user_id
         JOIN roles r
           ON r.role_id = u.role_id
         JOIN sections sec
           ON sec.section_id = so.section_id
         JOIN courses cr
           ON cr.course_id = sec.course_id
         WHERE so.offering_id = ?
         FOR UPDATE`,
        [target.offering_id],
      );

      const offering = offerings[0];

      if (
        offerings.length !== 1 ||
        Number(offering.department_id) !== departmentId ||
        offering.status === "Cancelled"
      ) {
        combinedApprovalFail(
          "COMBINED_APPROVAL_DEPARTMENT",
          "Offering is unavailable or outside your department.",
          403,
        );
      }

      if (
        Number(offering.instructor_active) !== 1 ||
        Number(offering.instructor_archived) !== 0 ||
        !["Faculty", "Program Head"].includes(offering.instructor_role)
      ) {
        combinedApprovalFail(
          "COMBINED_APPROVAL_INSTRUCTOR_INVALID",
          "The submitted class instructor is no longer active.",
        );
      }

      // Gradebook configuration
      const [configs] = await connection.execute(
        `SELECT config_id,
                midterm_percent,
                final_term_percent
         FROM gradebook_offering_config
         WHERE config_id = ?
           AND offering_id = ?
         FOR UPDATE`,
        [target.config_id, target.offering_id],
      );

      if (
        configs.length !== 1 ||
        Number(configs[0].midterm_percent) !== 50 ||
        Number(configs[0].final_term_percent) !== 50
      ) {
        combinedApprovalFail(
          "COMBINED_APPROVAL_CONFIG",
          "Official 50/50 gradebook configuration is required.",
        );
      }

      // Student enrollment
      const [students] = await connection.execute(
        `SELECT es.offering_id,
                es.status AS subject_status,
                e.enrollment_status
         FROM enrollment_subjects es
         JOIN enrollments e
           ON e.enrollment_id = es.enrollment_id
         WHERE es.enrollment_subject_id = ?
         FOR UPDATE`,
        [target.enrollment_subject_id],
      );

      if (
        students.length !== 1 ||
        Number(students[0].offering_id) !== Number(target.offering_id) ||
        students[0].subject_status !== "Enrolled" ||
        students[0].enrollment_status !== "Approved"
      ) {
        combinedApprovalFail(
          "COMBINED_APPROVAL_ENROLLMENT",
          "Student enrollment is no longer approved and active.",
        );
      }

      // Submission period
      const [periods] = await connection.execute(
        `SELECT period_id,
                department_id,
                academic_year_id,
                semester_id
         FROM gradebook_submission_periods
         WHERE period_id = ?
         FOR UPDATE`,
        [target.period_id],
      );

      if (
        periods.length !== 1 ||
        Number(periods[0].department_id) !== departmentId ||
        Number(periods[0].academic_year_id) !==
          Number(offering.academic_year_id) ||
        Number(periods[0].semester_id) !== Number(offering.semester_id)
      ) {
        combinedApprovalFail(
          "COMBINED_APPROVAL_PERIOD",
          "Submission period does not match the class.",
        );
      }

      // Program Head review is allowed after
      // the Faculty submission window closes.

      // Grade
      const [grades] = await connection.execute(
        `SELECT grade_id,
                faculty_id,
                grade_status,
                grading_policy,
                grading_outcome,
                midterm_grade,
                final_grade,
                overall_percentage,
                final_rating,
                remarks,
                outcome_reason,
                reviewed_by,
                reviewed_at,
                review_remarks
         FROM grades
         WHERE grade_id = ?
         FOR UPDATE`,
        [target.grade_id],
      );

      const grade = grades[0];

      if (
        grades.length !== 1 ||
        Number(grade.faculty_id) !== Number(offering.faculty_id) ||
        grade.grade_status !== "Submitted" ||
        grade.grading_policy !== "TWO_TERM_50_50" ||
        !["NUMERIC", "INCOMPLETE", "UNOFFICIAL_DROP"].includes(
          grade.grading_outcome,
        ) ||
        grade.reviewed_by != null ||
        grade.reviewed_at != null
      ) {
        combinedApprovalFail(
          "COMBINED_APPROVAL_GRADE_INVALID",
          "Only an unchanged submitted grade can be approved.",
        );
      }

      const [sheets] = await connection.execute(
        `SELECT sheet_id,
                config_id,
                sheet_status,
                original_official_submitted_on,
                official_submission_reference,
                official_date_verified_at
         FROM gradebook_official_sheets
         WHERE sheet_id = ?
         FOR UPDATE`,
        [target.sheet_id],
      );

      if (
        sheets.length !== 1 ||
        Number(sheets[0].config_id) !== Number(target.config_id) ||
        sheets[0].sheet_status !== "IN_PROGRESS" ||
        sheets[0].original_official_submitted_on != null ||
        sheets[0].official_submission_reference != null ||
        sheets[0].official_date_verified_at != null
      ) {
        combinedApprovalFail(
          "COMBINED_APPROVAL_SHEET_LOCKED",
          "Official sheet is no longer editable.",
        );
      }

      // Prevent duplicate official results.
      const [publications] = await connection.execute(
        `SELECT publication_id
         FROM gradebook_official_grade_publications
         WHERE grade_id = ?
         FOR UPDATE`,
        [grade.grade_id],
      );

      const [finalized] = await connection.execute(
        `SELECT roster_snapshot_id
         FROM gradebook_finalized_roster
         WHERE grade_id = ?
         FOR UPDATE`,
        [grade.grade_id],
      );

      if (publications.length || finalized.length) {
        combinedApprovalFail(
          "COMBINED_APPROVAL_ALREADY_OFFICIAL",
          "Published or finalized grades require an amendment.",
        );
      }

      // Preserve historical term submissions.
      const [legacy] = await connection.execute(
        `SELECT term_submission_id
         FROM gradebook_term_submission_attempts
         WHERE config_id = ?
         LIMIT 1`,
        [target.config_id],
      );

      if (legacy.length) {
        combinedApprovalFail(
          "COMBINED_APPROVAL_LEGACY_HISTORY",
          "Cannot mix older term approvals with combined submissions.",
        );
      }

      // Shared gradebook structure lock
      const [locks] = await connection.execute(
        `SELECT first_submission_id
         FROM gradebook_structure_locks
         WHERE config_id = ?
         FOR UPDATE`,
        [target.config_id],
      );

      if (locks.length !== 1) {
        combinedApprovalFail(
          "COMBINED_APPROVAL_STRUCTURE_LOCK",
          "Combined structure lock is missing.",
        );
      }

      const [first] = await connection.execute(
        `SELECT submission_id
         FROM gradebook_grade_submission_attempts
         WHERE submission_id = ?
           AND sheet_id = ?`,
        [locks[0].first_submission_id, target.sheet_id],
      );

      if (first.length !== 1) {
        combinedApprovalFail(
          "COMBINED_APPROVAL_STRUCTURE_HISTORY",
          "Structure lock does not match this sheet.",
        );
      }

      // Latest submission and version
      const [attempts] = await connection.execute(
        `SELECT *
         FROM gradebook_grade_submission_attempts
         WHERE grade_id = ?
         ORDER BY attempt_number DESC,
                  submission_id DESC
         LIMIT 1
         FOR UPDATE`,
        [target.grade_id],
      );

      const submission = attempts[0];

      if (
        attempts.length !== 1 ||
        String(submission.submission_id) !== String(submissionId) ||
        Number(submission.sheet_id) !== Number(target.sheet_id) ||
        Number(submission.period_id) !== Number(target.period_id) ||
        Number(submission.record_version) !== expectedVersion ||
        submission.submission_status !== "SUBMITTED" ||
        submission.grading_scope !== "FULL_SEMESTER" ||
        submission.grading_outcome_snapshot !== grade.grading_outcome ||
        (grade.grading_outcome === "NUMERIC"
          ? submission.special_outcome_id != null
          : !periodPositiveId(submission.special_outcome_id)) ||
        submission.reviewed_by_user_id != null ||
        submission.reviewed_at != null ||
        submission.returned_edit_scope != null ||
        Number(submission.submitted_by_user_id) !==
          Number(offering.instructor_user_id)
      ) {
        combinedApprovalFail(
          "COMBINED_APPROVAL_STALE",
          "Only the latest unreviewed submission can be approved.",
        );
      }

      const isSpecial = grade.grading_outcome !== "NUMERIC";

      if (isBatch && isSpecial) {
        combinedApprovalFail(
          "COMBINED_BATCH_NUMERIC_ONLY",
          "INC and UD submissions require individual Program Head review.",
        );
      }

      const evidenceNotes =
        typeof body.evidence_review_notes === "string"
          ? body.evidence_review_notes.trim()
          : "";
      if (
        isSpecial
          ? body.confirm_special_evidence !== true ||
            evidenceNotes.length < 20 ||
            evidenceNotes.length > 1000 ||
            /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(evidenceNotes)
          : Object.hasOwn(body, "confirm_special_evidence") ||
            Object.hasOwn(body, "evidence_review_notes")
      ) {
        combinedApprovalFail(
          "COMBINED_APPROVAL_EVIDENCE_REQUIRED",
          "Special outcomes require individual evidence confirmation and review notes (20–1000 characters).",
          400,
        );
      }

      // Self-approval uses the authenticated actor.
      const isSelfApproval =
        Number(userId) === Number(submission.submitted_by_user_id);

      if (
        isSelfApproval &&
        Number(offering.instructor_user_id) !== Number(userId)
      ) {
        combinedApprovalFail(
          "COMBINED_SELF_APPROVAL_FORBIDDEN",
          "Self-approval requires the assigned teaching Program Head.",
          403,
        );
      }

      // Numeric results cannot bypass INC/UD review.
      const [inc] = await connection.execute(
        `SELECT inc_request_id
         FROM gradebook_inc_outcome_requests
         WHERE config_id = ?
           AND enrollment_subject_id = ?
           AND request_status IN (
             'SUBMITTED', 'APPROVED'
           )
         LIMIT 1`,
        [target.config_id, target.enrollment_subject_id],
      );

      const [ud] = await connection.execute(
        `SELECT ud_request_id
         FROM gradebook_ud_outcome_requests
         WHERE config_id = ?
           AND enrollment_subject_id = ?
           AND request_status IN (
             'SUBMITTED', 'APPROVED'
           )
         LIMIT 1`,
        [target.config_id, target.enrollment_subject_id],
      );

      if (inc.length || ud.length) {
        combinedApprovalFail(
          "COMBINED_APPROVAL_SPECIAL_OUTCOME_ACTIVE",
          "Resolve INC or UD evidence separately.",
        );
      }

      // Prevent duplicate review decisions.
      const [reviews] = await connection.execute(
        `SELECT review_id
         FROM gradebook_grade_submission_reviews
         WHERE submission_id = ?
         FOR UPDATE`,
        [submissionId],
      );

      if (reviews.length) {
        combinedApprovalFail(
          "COMBINED_APPROVAL_ALREADY_REVIEWED",
          "This attempt already has a review decision.",
        );
      }

      // Parse saved calculation evidence.
      let snapshot;

      try {
        snapshot =
          typeof submission.calculation_snapshot_json === "string"
            ? JSON.parse(submission.calculation_snapshot_json)
            : submission.calculation_snapshot_json;
      } catch {
        snapshot = null;
      }

      if (
        !snapshot ||
        snapshot.policy !== "TWO_TERM_50_50" ||
        snapshot.grading_scope !== "FULL_SEMESTER" ||
        Number(snapshot.offering_id) !== Number(target.offering_id) ||
        Number(snapshot.config_id) !== Number(target.config_id) ||
        Number(snapshot.enrollment_subject_id) !==
          Number(target.enrollment_subject_id) ||
        Number(snapshot.grade_id) !== Number(target.grade_id) ||
        Number(snapshot.term_weights?.MIDTERM) !== 50 ||
        Number(snapshot.term_weights?.FINAL_TERM) !== 50 ||
        (!isSpecial &&
          (snapshot.calculated_terms?.MIDTERM?.state !== "READY" ||
            snapshot.calculated_terms?.FINAL_TERM?.state !== "READY" ||
            snapshot.calculated_semester?.state !== "READY"))
      ) {
        combinedApprovalFail(
          "COMBINED_APPROVAL_SNAPSHOT",
          "Saved semester calculation evidence is invalid.",
        );
      }

      if (isSpecial) {
        const specialAttemptNumber = Number(submission.attempt_number);

        if (
          !Number.isSafeInteger(specialAttemptNumber) ||
          specialAttemptNumber < 1 ||
          specialAttemptNumber >= 4294967295
        ) {
          combinedApprovalFail(
            "COMBINED_APPROVAL_SPECIAL_ATTEMPT_INVALID",
            "The INC/UD submission attempt number is invalid.",
          );
        }

        if (specialAttemptNumber > 1) {
          await validateResubmittedSpecialApproval(
            connection,
            target,
            grade,
            submission,
            snapshot,
            userId,
            expectedVersion,
          );
        } else {
          await combinedApprovalSpecialEvidence(
            connection,
            target,
            grade,
            submission,
            snapshot,
            userId,
          );
        }
      } else {
        // Recalculate against current gradebook evidence.
        const current = await calculateGradePreview(
          connection,
          Number(target.offering_id),
          Number(target.enrollment_subject_id),
          Number(offering.instructor_user_id),
        );

        assertCurrentNumericApprovalEvidence(
          current,
          snapshot,
          target.config_id,
        );

        // Validate exact Midterm and Final calculations.

        const midSource = snapshot.calculated_terms.MIDTERM.term_percentage;

        const finSource = snapshot.calculated_terms.FINAL_TERM.term_percentage;

        const allSource = snapshot.calculated_semester.semester_percentage;

        const mid = combinedApprovalFraction(
          submission.midterm_exact_numerator,
          submission.midterm_exact_denominator,
          midSource,
          255,
        );

        const fin = combinedApprovalFraction(
          submission.final_term_exact_numerator,
          submission.final_term_exact_denominator,
          finSource,
          255,
        );

        const all = combinedApprovalFraction(
          submission.overall_exact_numerator,
          submission.overall_exact_denominator,
          allSource,
          1200,
        );

        // Enforce exact Midterm 50% + Final 50%.
        if (
          (mid.n * fin.d + fin.n * mid.d) * all.d !==
          2n * mid.d * fin.d * all.n
        ) {
          combinedApprovalFail(
            "COMBINED_APPROVAL_ARITHMETIC",
            "Saved semester ratio does not equal the exact 50/50 term calculation.",
          );
        }

        const exactRating = combinedApprovalRating(all);

        const same12 = (actual, expected, tolerance = 0) =>
          actual != null &&
          Number.isFinite(Number(actual)) &&
          Math.abs(Number(actual) - Number(expected)) <= tolerance;

        if (
          !same12(
            submission.midterm_percentage_snapshot,
            combinedApprovalDecimal12(mid),
          ) ||
          !same12(
            submission.final_term_percentage_snapshot,
            combinedApprovalDecimal12(fin),
          ) ||
          !same12(
            submission.overall_percentage_snapshot,
            combinedApprovalDecimal12(all),
          ) ||
          !same12(
            grade.midterm_grade,
            submission.midterm_percentage_snapshot,
          ) ||
          !same12(
            grade.final_grade,
            submission.final_term_percentage_snapshot,
          ) ||
          !same12(
            grade.overall_percentage,
            submission.overall_percentage_snapshot,
            2e-12,
          ) ||
          !same12(grade.final_rating, exactRating) ||
          !same12(submission.final_rating_snapshot, exactRating) ||
          !same12(snapshot.calculated_semester.numeric_equivalent, exactRating)
        ) {
          combinedApprovalFail(
            "COMBINED_APPROVAL_GRADE_MISMATCH",
            "Saved grade differs from its exact approved-calculation evidence.",
          );
        }
      }

      // Approve the submission; publication comes next.
      const [updated] = await connection.execute(
        `UPDATE gradebook_grade_submission_attempts
         SET submission_status = 'APPROVED',
             reviewed_by_user_id = ?,
             reviewed_at = NOW(6),
             review_remarks = ?,
             record_version = record_version + 1
         WHERE submission_id = ?
           AND submission_status = 'SUBMITTED'
           AND record_version = ?`,
        [userId, remarks, submissionId, expectedVersion],
      );

      if (Number(updated.affectedRows) !== 1) {
        combinedApprovalFail(
          "COMBINED_APPROVAL_VERSION_CONFLICT",
          "Submission changed during review.",
        );
      }

      // Save the Program Head audit record.
      const [audit] = await connection.execute(
        `INSERT INTO gradebook_grade_submission_reviews
         (
           submission_id,
           review_decision,
           grading_outcome_snapshot,
           review_notes,
           evidence_review_notes,
           returned_edit_scope,
           is_self_approval,
           review_batch_ref,
           reviewed_by_user_id,
           submission_version_after
         )
         VALUES (
           ?,
           'APPROVED',
           ?,
           ?,
           ?,
           NULL,
           ?,
           ?,
           ?,
           ?
         )`,
        [
          submissionId,
          grade.grading_outcome,
          remarks,
          isSpecial ? evidenceNotes : null,
          isSelfApproval ? 1 : 0,
          reviewBatchRef,
          userId,
          expectedVersion + 1,
        ],
      );

      approved.push({
        submission_id: String(submissionId),
        grade_id: Number(grade.grade_id),
        review_id: body.dry_run ? null : String(audit.insertId),
        submission_status: "APPROVED",
        grade_status: "Submitted",
        record_version: expectedVersion + 1,
        is_self_approval: isSelfApproval,
        grading_outcome: grade.grading_outcome,
        special_evidence_verified: isSpecial,
        official_grade_published: false,
      });
    }

    // Commit only after every selected grade passes.
    if (body.dry_run) {
      await connection.rollback();
    } else {
      await connection.commit();
    }

    transactionOpen = false;

    if (isBatch) {
      return res.json({
        success: true,
        dry_run: body.dry_run,
        persisted: !body.dry_run,
        review_batch_ref: body.dry_run ? null : reviewBatchRef,
        approved_count: approved.length,
        submissions: approved,
        official_grade_published: false,
      });
    }

    return res.json({
      success: true,
      dry_run: body.dry_run,
      persisted: !body.dry_run,
      ...approved[0],
      next_step:
        "Source-linked official publication is required before changing the grade to Approved.",
    });
  } catch (error) {
    if (transactionOpen && connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("COMBINED APPROVAL ROLLBACK:", rollbackError);
      }
    }

    if (error?.code === "ER_DUP_ENTRY") {
      return combinedApprovalRespond(res, {
        status: 409,
        code: "COMBINED_APPROVAL_ALREADY_REVIEWED",
        message: "A review was already recorded. Reload the submission.",
      });
    }

    return combinedApprovalRespond(res, error);
  } finally {
    connection?.release();
  }
}

router.post(
  "/gradebook/semester-submissions/:submissionId/approve",
  handleCombinedSemesterApproval,
);

router.post(
  "/gradebook/semester-submissions/numeric-batch-approve",
  handleCombinedSemesterApproval,
);
/* Combined Semester Official Publication */

function combinedPublishFail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function combinedPublishError(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;

  if (status === 500) {
    console.error("COMBINED PUBLICATION:", error);
  }

  return res.status(status).json({
    success: false,
    code: status === 500 ? "COMBINED_PUBLISH_INTERNAL_ERROR" : error.code,
    message:
      status === 500 ? "Could not publish the semester grade." : error.message,
  });
}

function combinedPublishRatio(n, d, source, limit) {
  const numerator = String(n ?? "");
  const denominator = String(d ?? "");

  if (
    !/^(0|[1-9]\d*)$/.test(numerator) ||
    !/^[1-9]\d*$/.test(denominator) ||
    numerator.length > limit ||
    denominator.length > limit ||
    numerator !== String(source?.exact_numerator) ||
    denominator !== String(source?.exact_denominator)
  ) {
    combinedPublishFail(
      "COMBINED_PUBLISH_EXACT_SOURCE_INVALID",
      "The approved submission has inconsistent exact calculation evidence.",
    );
  }

  const result = {
    n: BigInt(numerator),
    d: BigInt(denominator),
  };

  if (result.n > result.d * 100n) {
    combinedPublishFail(
      "COMBINED_PUBLISH_PERCENT_INVALID",
      "A term percentage is outside 0–100.",
    );
  }

  return result;
}

function combinedPublishDecimalUnits(value) {
  const text = String(value ?? "");
  const match = /^(0|[1-9]\d{0,2})(?:\.(\d{1,12}))?$/.exec(text);

  if (!match) {
    combinedPublishFail(
      "COMBINED_PUBLISH_DECIMAL_INVALID",
      "Saved percentage is invalid.",
    );
  }

  const units =
    BigInt(match[1]) * 1000000000000n +
    BigInt((match[2] ?? "").padEnd(12, "0") || "0");

  if (units > 100000000000000n) {
    combinedPublishFail(
      "COMBINED_PUBLISH_PERCENT_INVALID",
      "Saved percentage is outside 0–100.",
    );
  }

  return units;
}

function combinedPublishRoundedUnits(ratio) {
  return (2n * ratio.n * 1000000000000n + ratio.d) / (2n * ratio.d);
}

function combinedPublishRating(ratio) {
  for (const [minimum, rating] of [
    [97n, "1.00"],
    [94n, "1.25"],
    [91n, "1.50"],
    [88n, "1.75"],
    [85n, "2.00"],
    [82n, "2.25"],
    [79n, "2.50"],
    [76n, "2.75"],
    [75n, "3.00"],
  ]) {
    if (ratio.n >= minimum * ratio.d) {
      return rating;
    }
  }

  return "5.00";
}

router.post(
  "/gradebook/semester-submissions/:submissionId/publish",
  async (req, res) => {
    let connection;
    let inTransaction = false;

    try {
      const submissionId = periodPositiveId(req.params.submissionId);

      const body = req.body;

      const keys = new Set([
        "expected_record_version",
        "confirm_publication",
        "dry_run",
      ]);

      const version = periodPositiveId(body?.expected_record_version);

      if (
        !submissionId ||
        !version ||
        version >= 4294967295 ||
        Object.keys(req.query ?? {}).length !== 0 ||
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some((key) => !keys.has(key)) ||
        body.confirm_publication !== true ||
        typeof body.dry_run !== "boolean"
      ) {
        combinedPublishFail(
          "COMBINED_PUBLISH_INPUT_INVALID",
          "Provide the approved submission ID, current record version, confirmation and boolean dry_run.",
          400,
        );
      }

      connection = await db.getConnection();

      await connection.beginTransaction();
      inTransaction = true;

      // Allow publication only on the explicitly authorized database.
      const [databaseRows] = await connection.execute(
        "SELECT DATABASE() AS database_name",
      );

      const activeDatabase =
        Array.isArray(databaseRows) && databaseRows.length === 1
          ? databaseRows[0]?.database_name
          : null;

      const isQaDatabase = activeDatabase === "databaseforptc1_admission_test";

      if (typeof activeDatabase !== "string" || !activeDatabase.trim()) {
        combinedPublishFail(
          "COMBINED_PUBLICATION_DATABASE_UNKNOWN",
          "Could not verify the active grading database.",
          403,
        );
      }

      if (isQaDatabase) {
        if (process.env.NODE_ENV === "production") {
          combinedPublishFail(
            "COMBINED_PUBLICATION_QA_PRODUCTION_FORBIDDEN",
            "QA publication is not allowed in production.",
            403,
          );
        }

        if (
          !body.dry_run &&
          process.env.GRADEBOOK_COMBINED_PUBLICATION_WRITES_ENABLED !== "true"
        ) {
          combinedPublishFail(
            "COMBINED_PUBLICATION_WRITES_DISABLED",
            "Combined semester publication is disabled on this server.",
            403,
          );
        }
      } else {
        const configuredDatabase = process.env.DB_NAME?.trim();
        const targetDatabase =
          process.env.GRADEBOOK_COMBINED_PUBLICATION_TARGET_DATABASE?.trim();

        if (
          process.env.GRADEBOOK_COMBINED_PUBLICATION_WRITES_ENABLED !== "true"
        ) {
          combinedPublishFail(
            "COMBINED_PUBLICATION_WRITES_DISABLED",
            "Combined semester publication is disabled on this server.",
            403,
          );
        }

        if (
          !configuredDatabase ||
          !targetDatabase ||
          activeDatabase !== configuredDatabase ||
          activeDatabase !== targetDatabase
        ) {
          combinedPublishFail(
            "COMBINED_PUBLICATION_DATABASE_MISMATCH",
            "The active database is not authorized for publication.",
            403,
          );
        }

        if (
          process.env.NODE_ENV === "production" &&
          process.env.GRADEBOOK_COMBINED_PUBLICATION_PRODUCTION_ENABLED !==
            "true"
        ) {
          combinedPublishFail(
            "COMBINED_PUBLICATION_PRODUCTION_DISABLED",
            "Production publication requires separate authorization.",
            403,
          );
        }
      }

      const { userId, departmentId } = await incReviewAssertProgramHead(
        connection,
        req,
      );

      // Find the submission and its parent records.
      const [targets] = await connection.execute(
        `SELECT a.grade_id,
                a.sheet_id,
                a.period_id,
                g.enrollment_subject_id,
                es.offering_id,
                sh.config_id
         FROM gradebook_grade_submission_attempts a
         JOIN grades g
           ON g.grade_id = a.grade_id
         JOIN enrollment_subjects es
           ON es.enrollment_subject_id =
              g.enrollment_subject_id
         JOIN gradebook_official_sheets sh
           ON sh.sheet_id = a.sheet_id
         WHERE a.submission_id = ?`,
        [submissionId],
      );

      if (targets.length !== 1) {
        combinedPublishFail(
          "COMBINED_PUBLISH_NOT_FOUND",
          "Approved submission not found.",
          404,
        );
      }

      const target = targets[0];

      // Lock order: offering, config, enrollment,
      // period, grade, sheet, publication and source.
      const [offerings] = await connection.execute(
        `SELECT so.offering_id,
                so.status,
                so.faculty_id,
                so.academic_year_id,
                so.semester_id,
                cr.department_id,
                f.user_id AS instructor_user_id,
                u.is_active AS instructor_active,
                u.is_archived AS instructor_archived,
                r.role_name AS instructor_role
         FROM subject_offerings so
         JOIN faculty f
           ON f.faculty_id = so.faculty_id
         JOIN users u
           ON u.user_id = f.user_id
         JOIN roles r
           ON r.role_id = u.role_id
         JOIN sections sec
           ON sec.section_id = so.section_id
         JOIN courses cr
           ON cr.course_id = sec.course_id
         WHERE so.offering_id = ?
         FOR UPDATE`,
        [target.offering_id],
      );

      const offering = offerings[0];

      if (
        !offering ||
        Number(offering.department_id) !== departmentId ||
        offering.status === "Cancelled" ||
        Number(offering.instructor_active) !== 1 ||
        Number(offering.instructor_archived) !== 0 ||
        !["Faculty", "Program Head"].includes(offering.instructor_role)
      ) {
        combinedPublishFail(
          "COMBINED_PUBLISH_DEPARTMENT_OR_INSTRUCTOR",
          "Offering or department authorization is invalid.",
          403,
        );
      }

      // Gradebook configuration
      const [configs] = await connection.execute(
        `SELECT config_id,
                offering_id,
                midterm_percent,
                final_term_percent
         FROM gradebook_offering_config
         WHERE config_id = ?
           AND offering_id = ?
         FOR UPDATE`,
        [target.config_id, target.offering_id],
      );

      if (
        configs.length !== 1 ||
        Number(configs[0].midterm_percent) !== 50 ||
        Number(configs[0].final_term_percent) !== 50
      ) {
        combinedPublishFail(
          "COMBINED_PUBLISH_CONFIG_INVALID",
          "The 50/50 gradebook configuration is invalid.",
        );
      }

      // Enrollment
      const [subjects] = await connection.execute(
        `SELECT es.enrollment_subject_id,
                es.offering_id,
                es.status AS subject_status,
                e.enrollment_status
         FROM enrollment_subjects es
         JOIN enrollments e
           ON e.enrollment_id = es.enrollment_id
         WHERE es.enrollment_subject_id = ?
         FOR UPDATE`,
        [target.enrollment_subject_id],
      );

      if (
        subjects.length !== 1 ||
        Number(subjects[0].offering_id) !== Number(target.offering_id) ||
        subjects[0].subject_status !== "Enrolled" ||
        subjects[0].enrollment_status !== "Approved"
      ) {
        combinedPublishFail(
          "COMBINED_PUBLISH_ENROLLMENT_INVALID",
          "The approved enrollment is not active.",
        );
      }

      // Original submission period
      const [periods] = await connection.execute(
        `SELECT period_id,
                department_id,
                academic_year_id,
                semester_id
         FROM gradebook_submission_periods
         WHERE period_id = ?
         FOR UPDATE`,
        [target.period_id],
      );

      if (
        periods.length !== 1 ||
        Number(periods[0].department_id) !== departmentId ||
        Number(periods[0].academic_year_id) !==
          Number(offering.academic_year_id) ||
        Number(periods[0].semester_id) !== Number(offering.semester_id)
      ) {
        combinedPublishFail(
          "COMBINED_PUBLISH_PERIOD_INVALID",
          "The submission period does not match the offering.",
        );
      }

      // Existing grade must still be Submitted.
      const [grades] = await connection.execute(
        `SELECT grade_id,
                enrollment_subject_id,
                faculty_id,
                grade_status,
                grading_policy,
                grading_outcome,
                midterm_grade,
                final_grade,
                overall_percentage,
                final_rating,
                remarks,
                outcome_reason,
                reviewed_by,
                reviewed_at
         FROM grades
         WHERE grade_id = ?
         FOR UPDATE`,
        [target.grade_id],
      );

      const grade = grades[0];

      if (
        !grade ||
        Number(grade.enrollment_subject_id) !==
          Number(target.enrollment_subject_id) ||
        Number(grade.faculty_id) !== Number(offering.faculty_id) ||
        grade.grade_status !== "Submitted" ||
        grade.grading_policy !== "TWO_TERM_50_50" ||
        !["NUMERIC", "INCOMPLETE", "UNOFFICIAL_DROP"].includes(
          grade.grading_outcome,
        ) ||
        grade.reviewed_by != null ||
        grade.reviewed_at != null
      ) {
        combinedPublishFail(
          "COMBINED_PUBLISH_GRADE_INVALID",
          "The submitted grade has changed or was already processed.",
        );
      }

      const isSpecial = grade.grading_outcome !== "NUMERIC";

      // INC/UD outside QA: development dry-run only; publication stays blocked.
      if (isSpecial && !isQaDatabase) {
        if (
          process.env.NODE_ENV === "production" ||
          body.dry_run !== true ||
          process.env
            .GRADEBOOK_COMBINED_SPECIAL_PUBLICATION_DRY_RUNS_ENABLED !== "true"
        ) {
          combinedPublishFail(
            "COMBINED_SPECIAL_PUBLICATION_NOT_MIGRATED",
            "INC/UD publication is limited to authorized development dry runs.",
            403,
          );
        }
      }

      // Official sheet
      const [sheets] = await connection.execute(
        `SELECT sheet_id,
                config_id,
                sheet_status,
                original_official_submitted_on,
                official_date_verified_at
         FROM gradebook_official_sheets
         WHERE sheet_id = ?
         FOR UPDATE`,
        [target.sheet_id],
      );

      const sheet = sheets[0];

      if (
        !sheet ||
        Number(sheet.config_id) !== Number(target.config_id) ||
        sheet.sheet_status !== "IN_PROGRESS" ||
        sheet.original_official_submitted_on != null ||
        sheet.official_date_verified_at != null
      ) {
        combinedPublishFail(
          "COMBINED_PUBLISH_SHEET_LOCKED",
          "The official sheet is not editable.",
        );
      }

      // No duplicate publication or finalized snapshot.
      const [prior] = await connection.execute(
        `SELECT publication_id
         FROM gradebook_official_grade_publications
         WHERE grade_id = ?
            OR enrollment_subject_id = ?
         FOR UPDATE`,
        [target.grade_id, target.enrollment_subject_id],
      );

      const [finalized] = await connection.execute(
        `SELECT roster_snapshot_id
         FROM gradebook_finalized_roster
         WHERE grade_id = ?
            OR enrollment_subject_id = ?
         FOR UPDATE`,
        [target.grade_id, target.enrollment_subject_id],
      );

      if (prior.length || finalized.length) {
        combinedPublishFail(
          "COMBINED_PUBLISH_ALREADY_OFFICIAL",
          "Grade has a publication or finalized roster record.",
        );
      }

      // Do not mix older term-based submissions.
      const [legacy] = await connection.execute(
        `SELECT term_submission_id
         FROM gradebook_term_submission_attempts
         WHERE config_id = ?
         LIMIT 1`,
        [target.config_id],
      );

      const [legacyLock] = await connection.execute(
        `SELECT first_submission_id
         FROM gradebook_term_structure_locks
         WHERE config_id = ?
         LIMIT 1`,
        [target.config_id],
      );

      if (legacy.length || legacyLock.length) {
        combinedPublishFail(
          "COMBINED_PUBLISH_LEGACY_HISTORY",
          "Historical term-based submissions cannot be mixed with combined publication.",
        );
      }

      // Active special outcomes require separate review.
      const [incPending] = await connection.execute(
        `SELECT inc_request_id
         FROM gradebook_inc_outcome_requests
         WHERE config_id = ?
           AND enrollment_subject_id = ?
           AND request_status IN ('SUBMITTED', 'APPROVED')
         LIMIT 1`,
        [target.config_id, target.enrollment_subject_id],
      );

      const [udPending] = await connection.execute(
        `SELECT ud_request_id
         FROM gradebook_ud_outcome_requests
         WHERE config_id = ?
           AND enrollment_subject_id = ?
           AND request_status IN ('SUBMITTED', 'APPROVED')
         LIMIT 1`,
        [target.config_id, target.enrollment_subject_id],
      );

      if (incPending.length || udPending.length) {
        combinedPublishFail(
          "COMBINED_PUBLISH_SPECIAL_OUTCOME_ACTIVE",
          "Resolve the INC or UD request before numeric publication.",
        );
      }

      // Combined structure lock
      const [locks] = await connection.execute(
        `SELECT first_submission_id
         FROM gradebook_structure_locks
         WHERE config_id = ?
         FOR UPDATE`,
        [target.config_id],
      );

      if (locks.length !== 1) {
        combinedPublishFail(
          "COMBINED_PUBLISH_STRUCTURE_LOCK",
          "The first-submission structure lock is missing.",
        );
      }

      const [first] = await connection.execute(
        `SELECT submission_id
         FROM gradebook_grade_submission_attempts
         WHERE submission_id = ?
           AND sheet_id = ?`,
        [locks[0].first_submission_id, target.sheet_id],
      );

      if (first.length !== 1) {
        combinedPublishFail(
          "COMBINED_PUBLISH_LOCK_HISTORY",
          "The structure lock does not match this sheet.",
        );
      }

      // Latest approved submission
      const [attempts] = await connection.execute(
        `SELECT *
         FROM gradebook_grade_submission_attempts
         WHERE grade_id = ?
         ORDER BY attempt_number DESC,
                  submission_id DESC
         LIMIT 1
         FOR UPDATE`,
        [target.grade_id],
      );

      const submission = attempts[0];

      if (
        !submission ||
        String(submission.submission_id) !== String(submissionId) ||
        Number(submission.record_version) !== version ||
        Number(submission.sheet_id) !== Number(target.sheet_id) ||
        Number(submission.period_id) !== Number(target.period_id) ||
        submission.submission_status !== "APPROVED" ||
        submission.grading_scope !== "FULL_SEMESTER" ||
        submission.grading_outcome_snapshot !== grade.grading_outcome ||
        (isSpecial
          ? !periodPositiveId(submission.special_outcome_id)
          : submission.special_outcome_id != null) ||
        submission.returned_edit_scope != null ||
        !submission.reviewed_by_user_id ||
        !submission.reviewed_at ||
        String(submission.reviewed_by_user_id) !== String(userId) ||
        String(submission.submitted_by_user_id) !==
          String(offering.instructor_user_id) ||
        !String(submission.review_remarks ?? "").trim()
      ) {
        combinedPublishFail(
          "COMBINED_PUBLISH_APPROVAL_INVALID",
          "Only the latest approved submission can be published by its reviewer.",
        );
      }

      // Validate Program Head review audit.
      const [reviews] = await connection.execute(
        `SELECT review_id,
                review_decision,
                grading_outcome_snapshot,
                review_notes,
                evidence_review_notes,
                review_batch_ref,
                returned_edit_scope,
                is_self_approval,
                reviewed_by_user_id,
                submission_version_after
         FROM gradebook_grade_submission_reviews
         WHERE submission_id = ?
         FOR UPDATE`,
        [submissionId],
      );

      const review = reviews[0];

      const selfApproval =
        Number(submission.submitted_by_user_id) === Number(userId);

      if (
        !review ||
        reviews.length !== 1 ||
        review.review_decision !== "APPROVED" ||
        review.grading_outcome_snapshot !== grade.grading_outcome ||
        (isSpecial &&
          (review.review_batch_ref != null ||
            typeof review.evidence_review_notes !== "string" ||
            review.evidence_review_notes.trim().length < 20 ||
            review.evidence_review_notes.trim().length > 1000)) ||
        review.returned_edit_scope != null ||
        Number(review.reviewed_by_user_id) !== Number(userId) ||
        Number(review.is_self_approval) !== Number(selfApproval) ||
        Number(review.submission_version_after) !== version ||
        String(review.review_notes ?? "") !==
          String(submission.review_remarks ?? "") ||
        (selfApproval && offering.instructor_role !== "Program Head")
      ) {
        combinedPublishFail(
          "COMBINED_PUBLISH_REVIEW_MISMATCH",
          "The Program Head approval audit does not match the submission.",
        );
      }

      // Recheck saved calculation evidence.
      let snapshot;

      try {
        snapshot =
          typeof submission.calculation_snapshot_json === "string"
            ? JSON.parse(submission.calculation_snapshot_json)
            : submission.calculation_snapshot_json;
      } catch {
        snapshot = null;
      }

      if (
        !snapshot ||
        snapshot.policy !== "TWO_TERM_50_50" ||
        snapshot.grading_scope !== "FULL_SEMESTER" ||
        Number(snapshot.offering_id) !== Number(target.offering_id) ||
        Number(snapshot.config_id) !== Number(target.config_id) ||
        Number(snapshot.enrollment_subject_id) !==
          Number(target.enrollment_subject_id) ||
        Number(snapshot.grade_id) !== Number(target.grade_id) ||
        Number(snapshot.term_weights?.MIDTERM) !== 50 ||
        Number(snapshot.term_weights?.FINAL_TERM) !== 50 ||
        (!isSpecial &&
          (snapshot.calculated_terms?.MIDTERM?.state !== "READY" ||
            snapshot.calculated_terms?.FINAL_TERM?.state !== "READY" ||
            snapshot.calculated_semester?.state !== "READY"))
      ) {
        combinedPublishFail(
          "COMBINED_PUBLISH_SNAPSHOT_INVALID",
          "The approved semester snapshot is incomplete or inconsistent.",
        );
      }

      // Special outcomes have no overall numeric percentage.
      // Special outcomes have no overall numeric percentage.
      if (isSpecial) {
        if (version !== 2) {
          combinedPublishFail(
            "COMBINED_PUBLISH_SPECIAL_VERSION_INVALID",
            "The special outcome must be individually approved at submission version 2.",
          );
        }

        const specialAttemptNumber = Number(submission.attempt_number);

        if (
          !Number.isSafeInteger(specialAttemptNumber) ||
          specialAttemptNumber < 1 ||
          specialAttemptNumber >= 4294967295
        ) {
          combinedPublishFail(
            "COMBINED_PUBLISH_SPECIAL_ATTEMPT_INVALID",
            "The special-outcome submission attempt number is invalid.",
          );
        }

        if (specialAttemptNumber > 1) {
          await validateResubmittedSpecialApproval(
            connection,
            target,
            grade,
            submission,
            snapshot,
            userId,
            2,
          );
        } else {
          await combinedApprovalSpecialEvidence(
            connection,
            target,
            grade,
            submission,
            snapshot,
            userId,
            2,
          );
        }

        const inc = grade.grading_outcome === "INCOMPLETE";
        const specialRating = inc ? "4.00" : "6.00";
        const specialRemarks = inc ? "Incomplete" : "Unofficial Drop";
        const midUnits = inc
          ? combinedPublishRoundedUnits(
              combinedPublishRatio(
                submission.midterm_exact_numerator,
                submission.midterm_exact_denominator,
                snapshot.calculated_terms.MIDTERM.term_percentage,
                255,
              ),
            )
          : null;
        const sameMid = (value) =>
          inc
            ? combinedPublishDecimalUnits(value) === midUnits
            : value === null;
        if (
          !sameMid(grade.midterm_grade) ||
          !sameMid(submission.midterm_percentage_snapshot) ||
          !sameMid(snapshot.official_result.midterm_grade)
        ) {
          combinedPublishFail(
            "COMBINED_PUBLISH_SPECIAL_MIDTERM_MISMATCH",
            "The preserved Midterm grade differs from its exact source.",
          );
        }

        // Do not fabricate a zero fraction for INC or UD.
        const [exactColumns] = await connection.execute(
          `SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gradebook_official_grade_publications'
              AND COLUMN_NAME IN ('overall_exact_numerator', 'overall_exact_denominator')`,
        );
        if (
          exactColumns.length !== 2 ||
          exactColumns.some((c) => c.IS_NULLABLE !== "YES")
        ) {
          combinedPublishFail(
            "COMBINED_PUBLISH_SPECIAL_SCHEMA_REQUIRED",
            "The publication exact-fraction columns must support NULL for special outcomes.",
          );
        }

        const [updated] = await connection.execute(
          `UPDATE grades SET grade_status = 'Approved', reviewed_by = ?
            WHERE grade_id = ? AND grade_status = 'Submitted'
              AND grading_policy = 'TWO_TERM_50_50' AND grading_outcome = ?`,
          [userId, target.grade_id, grade.grading_outcome],
        );
        if (Number(updated.affectedRows) !== 1) {
          combinedPublishFail(
            "COMBINED_PUBLISH_GRADE_CONFLICT",
            "Grade changed during publication.",
          );
        }
        const [[approved]] = await connection.execute(
          `SELECT grade_status, grading_policy, grading_outcome, midterm_grade, final_grade,
                  overall_percentage, final_rating, remarks, outcome_reason, reviewed_by, reviewed_at
             FROM grades WHERE grade_id = ? FOR UPDATE`,
          [target.grade_id],
        );
        const [[subject]] = await connection.execute(
          `SELECT status FROM enrollment_subjects WHERE enrollment_subject_id = ? FOR UPDATE`,
          [target.enrollment_subject_id],
        );
        if (
          !approved ||
          approved.grade_status !== "Approved" ||
          !approved.reviewed_at ||
          approved.grading_policy !== "TWO_TERM_50_50" ||
          approved.grading_outcome !== grade.grading_outcome ||
          Number(approved.reviewed_by) !== Number(userId) ||
          !sameMid(approved.midterm_grade) ||
          approved.final_grade !== null ||
          approved.overall_percentage !== null ||
          String(approved.final_rating) !== specialRating ||
          approved.remarks !== specialRemarks ||
          approved.outcome_reason !== grade.outcome_reason ||
          subject?.status !== specialRemarks
        ) {
          combinedPublishFail(
            "COMBINED_PUBLISH_TRIGGER_MISMATCH",
            "Special-outcome database result differs from its approved source. Publication rolled back.",
          );
        }
        const [inserted] = await connection.execute(
          `INSERT INTO gradebook_official_grade_publications
             (grade_id, config_id, enrollment_subject_id, publication_source,
              midterm_submission_id, final_term_submission_id, combined_submission_id,
              grading_outcome_snapshot, overall_exact_numerator, overall_exact_denominator, published_by_user_id)
           VALUES (?, ?, ?, 'COMBINED_SEMESTER', NULL, NULL, ?, ?, NULL, NULL, ?)`,
          [
            target.grade_id,
            target.config_id,
            target.enrollment_subject_id,
            submissionId,
            grade.grading_outcome,
            userId,
          ],
        );
        if (Number(inserted.affectedRows) !== 1)
          throw new Error("Could not store special-outcome publication.");
        if (body.dry_run) await connection.rollback();
        else await connection.commit();
        inTransaction = false;
        return res.json({
          success: true,
          dry_run: body.dry_run,
          persisted: !body.dry_run,
          publication_id: body.dry_run ? null : String(inserted.insertId),
          submission_id: String(submissionId),
          grade_id: Number(target.grade_id),
          publication_source: "COMBINED_SEMESTER",
          grading_outcome: grade.grading_outcome,
          grade_status: "Approved",
          enrollment_subject_status: specialRemarks,
          midterm_percentage: approved.midterm_grade,
          final_term_percentage: null,
          overall_percentage: null,
          final_rating: specialRating,
          is_self_approval: selfApproval,
          special_evidence_verified: true,
          official_sheet_finalized: false,
        });
      }

      const midterm = combinedPublishRatio(
        submission.midterm_exact_numerator,
        submission.midterm_exact_denominator,
        snapshot.calculated_terms.MIDTERM.term_percentage,
        255,
      );

      const finalTerm = combinedPublishRatio(
        submission.final_term_exact_numerator,
        submission.final_term_exact_denominator,
        snapshot.calculated_terms.FINAL_TERM.term_percentage,
        255,
      );

      const overall = combinedPublishRatio(
        submission.overall_exact_numerator,
        submission.overall_exact_denominator,
        snapshot.calculated_semester.semester_percentage,
        1200,
      );

      // Exact Midterm 50% + Final Term 50%.
      if (
        (midterm.n * finalTerm.d + finalTerm.n * midterm.d) * overall.d !==
        2n * midterm.d * finalTerm.d * overall.n
      ) {
        combinedPublishFail(
          "COMBINED_PUBLISH_50_50_INVALID",
          "The exact semester percentage is not the 50/50 average.",
        );
      }

      // Compare exact grading with database values.
      const midUnits = combinedPublishRoundedUnits(midterm);

      const finalUnits = combinedPublishRoundedUnits(finalTerm);

      const overallUnits = combinedPublishRoundedUnits(overall);

      const rating = combinedPublishRating(overall);

      const remarks = rating === "5.00" ? "Failed" : "Passed";

      const subjectStatus = rating === "5.00" ? "Failed" : "Completed";

      // The existing database trigger calculates the
      // overall grade from stored 12-decimal term values.
      const triggerUnits = (midUnits + finalUnits + 1n) / 2n;

      const difference =
        triggerUnits >= overallUnits
          ? triggerUnits - overallUnits
          : overallUnits - triggerUnits;

      if (
        combinedPublishDecimalUnits(submission.midterm_percentage_snapshot) !==
          midUnits ||
        combinedPublishDecimalUnits(
          submission.final_term_percentage_snapshot,
        ) !== finalUnits ||
        combinedPublishDecimalUnits(submission.overall_percentage_snapshot) !==
          overallUnits ||
        combinedPublishDecimalUnits(grade.midterm_grade) !== midUnits ||
        combinedPublishDecimalUnits(grade.final_grade) !== finalUnits ||
        combinedPublishDecimalUnits(grade.overall_percentage) !==
          triggerUnits ||
        combinedPublishDecimalUnits(
          snapshot.calculated_semester.semester_percentage?.decimal_preview,
        ) !== overallUnits ||
        String(submission.final_rating_snapshot) !== rating ||
        String(grade.final_rating) !== rating ||
        String(snapshot.calculated_semester.numeric_equivalent) !== rating ||
        grade.remarks !== remarks ||
        difference > 1n
      ) {
        combinedPublishFail(
          "COMBINED_PUBLISH_GRADE_MISMATCH",
          "The saved grade and source calculation disagree; publication cancelled.",
        );
      }

      // Approve the grade inside the transaction.
      const [updated] = await connection.execute(
        `UPDATE grades
         SET grade_status = 'Approved',
             reviewed_by = ?
         WHERE grade_id = ?
           AND grade_status = 'Submitted'
           AND grading_policy = 'TWO_TERM_50_50'
           AND grading_outcome = 'NUMERIC'`,
        [userId, target.grade_id],
      );

      if (Number(updated.affectedRows) !== 1) {
        combinedPublishFail(
          "COMBINED_PUBLISH_GRADE_CONFLICT",
          "Grade changed during publication.",
        );
      }

      // Validate the database trigger's result.
      const [[approved]] = await connection.execute(
        `SELECT grade_status,
                grading_policy,
                grading_outcome,
                midterm_grade,
                final_grade,
                overall_percentage,
                final_rating,
                remarks,
                reviewed_by,
                reviewed_at
         FROM grades
         WHERE grade_id = ?
         FOR UPDATE`,
        [target.grade_id],
      );

      const [[subject]] = await connection.execute(
        `SELECT status
         FROM enrollment_subjects
         WHERE enrollment_subject_id = ?`,
        [target.enrollment_subject_id],
      );

      if (
        approved?.grade_status !== "Approved" ||
        !approved.reviewed_at ||
        approved.grading_policy !== "TWO_TERM_50_50" ||
        approved.grading_outcome !== "NUMERIC" ||
        Number(approved.reviewed_by) !== Number(userId) ||
        combinedPublishDecimalUnits(approved.midterm_grade) !== midUnits ||
        combinedPublishDecimalUnits(approved.final_grade) !== finalUnits ||
        combinedPublishDecimalUnits(approved.overall_percentage) !==
          triggerUnits ||
        String(approved.final_rating) !== rating ||
        approved.remarks !== remarks ||
        subject?.status !== subjectStatus
      ) {
        combinedPublishFail(
          "COMBINED_PUBLISH_TRIGGER_MISMATCH",
          "The database trigger produced an unexpected result. Publication rolled back.",
        );
      }

      // Create the official source-linked publication.
      const [inserted] = await connection.execute(
        `INSERT INTO gradebook_official_grade_publications
         (
           grade_id,
           config_id,
           enrollment_subject_id,
           publication_source,
           midterm_submission_id,
           final_term_submission_id,
           combined_submission_id,
           grading_outcome_snapshot,
           overall_exact_numerator,
           overall_exact_denominator,
           published_by_user_id
         )
         VALUES (
           ?, ?, ?,
           'COMBINED_SEMESTER',
           NULL, NULL, ?,
           'NUMERIC',
           ?, ?, ?
         )`,
        [
          target.grade_id,
          target.config_id,
          target.enrollment_subject_id,
          submissionId,
          String(overall.n),
          String(overall.d),
          userId,
        ],
      );

      if (Number(inserted.affectedRows) !== 1) {
        throw new Error(
          "Could not insert the source-linked official publication.",
        );
      }

      if (body.dry_run) {
        await connection.rollback();
      } else {
        await connection.commit();
      }

      inTransaction = false;

      return res.json({
        success: true,
        dry_run: body.dry_run,
        persisted: !body.dry_run,
        publication_id: body.dry_run ? null : String(inserted.insertId),
        submission_id: String(submissionId),
        grade_id: Number(target.grade_id),
        publication_source: "COMBINED_SEMESTER",
        grade_status: "Approved",
        enrollment_subject_status: subjectStatus,
        final_rating: rating,
        is_self_approval: selfApproval,
        official_sheet_finalized: false,
      });
    } catch (error) {
      if (inTransaction && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("COMBINED PUBLISH ROLLBACK:", rollbackError);
        }
      }

      if (error?.code === "ER_DUP_ENTRY") {
        return combinedPublishError(res, {
          status: 409,
          code: "COMBINED_PUBLISH_CONFLICT",
          message:
            "The grade was published or changed concurrently. Reload before trying again.",
        });
      }

      return combinedPublishError(res, error);
    } finally {
      connection?.release();
    }
  },
);
// Approve the modern INC replacement without updating the official grade.
router.post(
  "/gradebook/modern-inc-completion-submissions/:submissionId/approve",
  async (req, res) => {
    let connection;
    let transactionOpen = false;
    try {
      incReviewCheckQuery(req);
      const submissionId = String(req.params.submissionId ?? "");
      if (
        !/^[1-9]\d{0,19}$/.test(submissionId) ||
        BigInt(submissionId) > 18446744073709551615n
      ) {
        incReviewFail(
          "MODERN_INC_APPROVAL_ID_INVALID",
          "A positive submission ID is required.",
          400,
        );
      }
      connection = await db.getConnection();
      await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      await connection.beginTransaction();
      transactionOpen = true;

      // Modern INC approval remains QA-only
      await assertQaGradingDatabase(connection);

      const actor = await incReviewAssertProgramHead(connection, req);
      const result = await approveModernIncCompletion(
        connection,
        actor,
        submissionId,
        req.body,
        calculateGradePreview,
      );
      if (req.body.dry_run) await connection.rollback();
      else await connection.commit();
      transactionOpen = false;
      return res.json(result);
    } catch (error) {
      if (transactionOpen && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("MODERN INC APPROVAL ROLLBACK:", rollbackError);
        }
      }
      if (
        ["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(
          error?.code,
        )
      ) {
        return res.status(409).json({
          success: false,
          code: "MODERN_INC_APPROVAL_CONFLICT",
          message: "Concurrent review detected. Reload and retry.",
        });
      }
      return incReviewSendError(res, error);
    } finally {
      connection?.release();
    }
  },
);

router.post(
  "/gradebook/modern-score-correction-requests/:correctionId/review",
  async (req, res) => {
    let connection = null;
    let transactionOpen = false;
    try {
      incReviewCheckQuery(req);
      const correctionId = String(req.params.correctionId ?? "");
      if (
        !/^[1-9]\d{0,19}$/.test(correctionId) ||
        BigInt(correctionId) > 18446744073709551615n
      ) {
        incReviewFail(
          "MODERN_CORRECTION_REVIEW_ID_INVALID",
          "A positive correction ID is required.",
          400,
        );
      }
      connection = await db.getConnection();
      await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      await connection.beginTransaction();
      transactionOpen = true;
      // Modern correction reviews remain QA-only
      await assertQaGradingDatabase(connection);
      const actor = await incReviewAssertProgramHead(connection, req);
      const result = await reviewModernScoreCorrection(
        connection,
        actor,
        correctionId,
        req.body,
      );
      if (req.body?.dry_run === true) await connection.rollback();
      else await connection.commit();
      transactionOpen = false;
      return res.json(result);
    } catch (error) {
      if (transactionOpen && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error(
            "MODERN SCORE CORRECTION REVIEW ROLLBACK:",
            rollbackError,
          );
          connection.destroy();
          connection = null;
        }
      }
      if (
        ["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(
          error?.code,
        )
      ) {
        return res.status(409).json({
          success: false,
          code: "MODERN_CORRECTION_REVIEW_CONFLICT",
          message: "Concurrent review detected. Reload the correction request.",
        });
      }
      return incReviewSendError(res, error);
    } finally {
      connection?.release();
    }
  },
);

// Add once, immediately before the existing export default router.
router.post(
  "/gradebook/special-outcome-submissions/:submissionId/return",
  async (req, res) => {
    let connection;
    let transactionOpen = false;
    try {
      const id = periodPositiveId(req.params.submissionId);
      const body = req.body;
      const allowed = new Set([
        "expected_grade_id",
        "expected_record_version",
        "returned_edit_scope",
        "review_remarks",
        "evidence_review_notes",
        "confirm_return",
        "dry_run",
      ]);
      const remarks =
        typeof body?.review_remarks === "string"
          ? body.review_remarks.trim()
          : "";
      const evidenceNotes =
        typeof body?.evidence_review_notes === "string"
          ? body.evidence_review_notes.trim()
          : "";
      if (
        !id ||
        Object.keys(req.query ?? {}).length ||
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some((k) => !allowed.has(k)) ||
        !periodPositiveId(body.expected_grade_id) ||
        !periodPositiveId(body.expected_record_version) ||
        !["MIDTERM", "FINAL_TERM", "BOTH"].includes(body.returned_edit_scope) ||
        remarks.length < 15 ||
        remarks.length > 500 ||
        evidenceNotes.length < 20 ||
        evidenceNotes.length > 2000 ||
        /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(remarks + evidenceNotes) ||
        body.confirm_return !== true ||
        typeof body.dry_run !== "boolean" ||
        Number(body.expected_record_version) >= 4294967295
      ) {
        return res.status(400).json({
          success: false,
          code: "SPECIAL_RETURN_INPUT_INVALID",
          message:
            "Provide current grade/submission versions, scope, review reason, evidence notes, confirmation, and boolean dry_run.",
        });
      }
      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionOpen = true;
      await assertSpecialOutcomeReturnWriteAllowed(connection);

      const { userId, departmentId } = await incReviewAssertProgramHead(
        connection,
        req,
      );
      const result = await returnSpecialOutcomeSubmission(connection, {
        submissionId: id,
        expectedGradeId: Number(body.expected_grade_id),
        expectedVersion: Number(body.expected_record_version),
        scope: body.returned_edit_scope,
        reviewRemarks: remarks,
        evidenceNotes,
        actorUserId: userId,
        actorDepartmentId: departmentId,
        dryRun: body.dry_run,
      });
      if (body.dry_run) {
        await connection.rollback();
      } else {
        await connection.commit();
      }

      transactionOpen = false;
      return res.status(200).json(result);
    } catch (error) {
      if (transactionOpen && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("SPECIAL RETURN ROLLBACK:", rollbackError);
        }
      }
      const status =
        Number.isInteger(error?.status) &&
        error.status >= 400 &&
        error.status < 500
          ? error.status
          : 500;
      if (status === 500) console.error("SPECIAL RETURN:", error);
      return res.status(status).json({
        success: false,
        code: status === 500 ? "SPECIAL_RETURN_INTERNAL_ERROR" : error.code,
        message:
          status === 500
            ? "Could not review special-outcome return."
            : error.message,
      });
    } finally {
      connection?.release();
    }
  },
);

router.use("/profile", profileRouter);
router.use("/classes", classesRouter);
router.use("/grades", gradesRouter);
router.use("/transfer-evaluations", transferevaluationRouter);
router.use("/offering-batches", offeringBatchesRouter);
router.use("/gradebook/inc-completion-claims", incCompletionClaimReviewRouter);

export default router;
