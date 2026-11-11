import express from "express";
import db from "../db.js";
import { loadGradebookOfferingConfig } from "../services/gradebookOfferingConfig.service.js";

const router = express.Router();
const TEST_DATABASE = "databaseforptc1_admission_test";
const TEST_OFFERING_ID = 131;

function fail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function positiveId(value) {
  const raw = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const valueAsNumber = Number(raw);
  return Number.isSafeInteger(valueAsNumber) ? valueAsNumber : null;
}

function sendError(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
  if (status === 500) console.error("GRADEBOOK SCORE SAVE ERROR:", error);
  return res.status(status).json({
    success: false,
    code:
      status === 500
        ? "GRADEBOOK_INTERNAL_ERROR"
        : error.code || "GRADEBOOK_REQUEST_FAILED",
    message:
      status === 500 ? "Could not save the gradebook score." : error.message,
  });
}

// Parse DECIMAL(10,2) exactly. Never round a submitted score implicitly.
function parseScore(value, fieldName) {
  if (typeof value !== "number" && typeof value !== "string") {
    fail(
      "INVALID_SCORE",
      `${fieldName} must be a nonnegative number with at most two decimals.`,
      400,
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    fail("INVALID_SCORE", `${fieldName} must be a finite number.`, 400);
  }
  const raw = String(value).trim();
  if (!/^(0|[1-9]\d{0,7})(?:\.(\d{1,2}))?$/.test(raw)) {
    fail(
      "INVALID_SCORE",
      `${fieldName} must be within DECIMAL(10,2) with at most two decimals.`,
      400,
    );
  }
  const [whole, fraction = ""] = raw.split(".");
  return {
    value: `${whole}.${fraction.padEnd(2, "0")}`,
    cents: BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")),
  };
}

function optionalReason(value, fieldName, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) fail("NA_REASON_REQUIRED", `${fieldName} is required.`, 400);
    return null;
  }
  if (typeof value !== "string") {
    fail("INVALID_REASON", `${fieldName} must be text.`, 400);
  }
  const text = value.trim();
  if (!text) {
    if (required) fail("NA_REASON_REQUIRED", `${fieldName} is required.`, 400);
    return null;
  }
  if (text.length > 2000 || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text)) {
    fail(
      "INVALID_REASON",
      `${fieldName} must be 1–2000 printable characters.`,
      400,
    );
  }
  return text;
}

function validateScoreBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("INVALID_SCORE_INPUT", "A JSON object is required.", 400);
  }
  const allowed = new Set([
    "enrollment_subject_id",
    "assessment_id",
    "record_version",
    "score_status",
    "earned_score",
    "not_applicable_reason",
    "change_reason",
    "dry_run",
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    fail(
      "UNSUPPORTED_SCORE_FIELD",
      "Only student, assessment, score state, reason, version, and dry_run fields are allowed.",
      400,
    );
  }
  const enrollmentSubjectId = positiveId(body.enrollment_subject_id);
  if (!enrollmentSubjectId) {
    fail(
      "INVALID_ENROLLMENT_SUBJECT_ID",
      "A valid enrollment_subject_id is required.",
      400,
    );
  }
  const assessmentId = positiveId(body.assessment_id);
  if (!assessmentId) {
    fail("INVALID_ASSESSMENT_ID", "A valid assessment_id is required.", 400);
  }
  if (
    !Object.hasOwn(body, "record_version") ||
    !(
      body.record_version === null || positiveId(body.record_version) !== null
    ) ||
    typeof body.record_version === "boolean"
  ) {
    fail(
      "RECORD_VERSION_REQUIRED",
      "record_version must be null for a new score, or the latest positive version for an update.",
      400,
    );
  }
  const expectedVersion =
    body.record_version === null ? null : positiveId(body.record_version);
  if (!["PENDING", "SCORED", "NOT_APPLICABLE"].includes(body.score_status)) {
    fail(
      "INVALID_SCORE_STATUS",
      "score_status must be PENDING, SCORED, or NOT_APPLICABLE.",
      400,
    );
  }
  if (typeof body.dry_run !== "boolean") {
    fail(
      "DRY_RUN_REQUIRED",
      "Specify dry_run: true to test or false to save.",
      400,
    );
  }
  let earned = null;
  let naReason = null;
  if (body.score_status === "SCORED") {
    if (body.earned_score === undefined || body.earned_score === null) {
      fail(
        "EARNED_SCORE_REQUIRED",
        "SCORED requires earned_score, including explicit zero.",
        400,
      );
    }
    earned = parseScore(body.earned_score, "earned_score");
    if (
      body.not_applicable_reason !== undefined &&
      body.not_applicable_reason !== null
    ) {
      fail(
        "UNEXPECTED_NA_REASON",
        "SCORED cannot have not_applicable_reason.",
        400,
      );
    }
  } else if (body.score_status === "NOT_APPLICABLE") {
    if (body.earned_score !== undefined && body.earned_score !== null) {
      fail(
        "UNEXPECTED_EARNED_SCORE",
        "NOT_APPLICABLE cannot have an earned score.",
        400,
      );
    }
    naReason = optionalReason(
      body.not_applicable_reason,
      "not_applicable_reason",
      { required: true },
    );
  } else {
    if (body.earned_score !== undefined && body.earned_score !== null) {
      fail(
        "UNEXPECTED_EARNED_SCORE",
        "PENDING must have a blank earned score.",
        400,
      );
    }
    if (
      body.not_applicable_reason !== undefined &&
      body.not_applicable_reason !== null
    ) {
      fail(
        "UNEXPECTED_NA_REASON",
        "PENDING cannot have not_applicable_reason.",
        400,
      );
    }
  }
  return {
    enrollmentSubjectId,
    assessmentId,
    expectedVersion,
    scoreStatus: body.score_status,
    earnedScore: earned?.value ?? null,
    earnedCents: earned?.cents ?? null,
    naReason,
    changeReason: optionalReason(body.change_reason, "change_reason"),
    dryRun: body.dry_run,
  };
}

// POST /api/gradebook/:offeringId/scores
// Save one score cell, or test the full transaction using dry_run: true.
// Registration in server.js must supply authenticate + Faculty/Program Head role checks.
router.post("/:offeringId/scores", async (req, res) => {
  let input;
  try {
    input = validateScoreBody(req.body);
  } catch (error) {
    return sendError(res, error);
  }
  const offeringId = positiveId(req.params.offeringId);
  if (!offeringId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_OFFERING_ID",
      message: "offeringId must be a positive integer.",
    });
  }
  const actorUserId = positiveId(req.user?.user_id);
  if (!actorUserId) {
    return res.status(401).json({
      success: false,
      code: "AUTHENTICATION_REQUIRED",
      message: "An authenticated instructor is required.",
    });
  }
  // A deliberately limited first rollout. Never write to other offerings/databases yet.
  if (!input.dryRun && offeringId !== TEST_OFFERING_ID) {
    return res.status(403).json({
      success: false,
      code: "TEST_OFFERING_ONLY",
      message: "Committed score testing is currently limited to Offering #131.",
    });
  }

  let connection;
  let transactionStarted = false;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    if (!input.dryRun) {
      const [databases] = await connection.execute(
        "SELECT DATABASE() AS database_name",
      );
      if (databases[0]?.database_name !== TEST_DATABASE) {
        fail(
          "TEST_DATABASE_ONLY",
          "Committed score saves are disabled outside the admission-test database.",
          403,
        );
      }
    }

    // Serialize score writes with gradebook assessment/submission operations.
    const [offeringRows] = await connection.execute(
      `SELECT so.offering_id, so.status, f.user_id AS assigned_user_id,
              u.is_active, u.is_archived, r.role_name
         FROM subject_offerings so
         LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
         LEFT JOIN users u ON u.user_id = f.user_id
         LEFT JOIN roles r ON r.role_id = u.role_id
        WHERE so.offering_id = ? FOR UPDATE`,
      [offeringId],
    );
    if (offeringRows.length !== 1) {
      fail("OFFERING_NOT_FOUND", "Subject offering was not found.", 404);
    }
    const offering = offeringRows[0];
    if (
      Number(offering.assigned_user_id) !== actorUserId ||
      Number(offering.is_active) !== 1 ||
      Number(offering.is_archived) !== 0 ||
      !["Faculty", "Program Head"].includes(offering.role_name)
    ) {
      fail(
        "GRADEBOOK_INSTRUCTOR_REQUIRED",
        "Only the active assigned instructor may save scores.",
        403,
      );
    }
    if (offering.status !== "Open") {
      fail("OFFERING_NOT_OPEN", "Score entry requires an Open offering.");
    }

    const [configRows] = await connection.execute(
      "SELECT config_id FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE",
      [offeringId],
    );
    if (configRows.length !== 1) {
      fail(
        "GRADEBOOK_NOT_INITIALIZED",
        "This offering has no initialized gradebook.",
      );
    }
    const configId = Number(configRows[0].config_id);
    const config = await loadGradebookOfferingConfig(connection, offeringId);
    if (!config.is_initialized || config.config_id !== configId) {
      fail(
        "GRADEBOOK_CONFIG_INVALID",
        "Official gradebook policy failed validation.",
      );
    }

    // The old FULL_SEMESTER workflow is not migrated to term-specific submissions.
    // If any legacy grade submission is present, continue to fail closed rather
    // than inadvertently allowing edits to official historical grading records.
    const [legacyStructureLocks] = await connection.execute(
      "SELECT config_id FROM gradebook_structure_locks WHERE config_id = ? LIMIT 1",
      [configId],
    );
    const [legacySubmissions] = await connection.execute(
      `SELECT 1
         FROM gradebook_grade_submission_attempts sa
         JOIN grades g ON g.grade_id = sa.grade_id
         JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
        WHERE es.offering_id = ? LIMIT 1`,
      [offeringId],
    );
    if (legacyStructureLocks.length || legacySubmissions.length) {
      fail(
        "GRADEBOOK_LEGACY_SUBMISSION_LOCKED",
        "Legacy full-semester submission history requires the existing correction workflow.",
      );
    }

    const [assessments] = await connection.execute(
      `SELECT a.assessment_id, a.maximum_score, a.record_status,
              a.grading_term, oc.category_code
         FROM gradebook_assessments a
         JOIN gradebook_offering_categories oc
           ON oc.offering_category_id = a.offering_category_id
        WHERE a.assessment_id = ? AND oc.config_id = ? FOR UPDATE`,
      [input.assessmentId, configId],
    );
    if (assessments.length !== 1) {
      fail(
        "ASSESSMENT_NOT_FOUND",
        "Assessment does not belong to this offering.",
        404,
      );
    }
    if (assessments[0].record_status !== "ACTIVE") {
      fail(
        "ASSESSMENT_REMOVED",
        "Scores cannot be entered for removed assessments.",
      );
    }
    if (
      assessments[0].category_code === "ATTENDANCE" ||
      !["MIDTERM", "FINAL_TERM"].includes(assessments[0].grading_term)
    ) {
      fail("INVALID_ASSESSMENT", "The assessment term or category is invalid.");
    }
    const maximum = parseScore(assessments[0].maximum_score, "maximum_score");
    if (maximum.cents <= 0n) {
      fail("INVALID_ASSESSMENT", "Assessment maximum score must exceed zero.");
    }
    if (input.earnedCents !== null && input.earnedCents > maximum.cents) {
      fail(
        "SCORE_EXCEEDS_MAXIMUM",
        `Earned score cannot exceed the assessment maximum of ${maximum.value}.`,
        422,
      );
    }

    // Reject unapproved, dropped, or reassigned enrollment-subject records.
    const [enrollments] = await connection.execute(
      `SELECT es.enrollment_subject_id, es.offering_id,
              es.status AS enrollment_subject_status,
              e.enrollment_status, e.student_id
         FROM enrollment_subjects es
         JOIN enrollments e ON e.enrollment_id = es.enrollment_id
        WHERE es.enrollment_subject_id = ? FOR UPDATE`,
      [input.enrollmentSubjectId],
    );
    if (enrollments.length !== 1) {
      fail(
        "ENROLLMENT_SUBJECT_NOT_FOUND",
        "Enrollment subject was not found.",
        404,
      );
    }
    const enrollment = enrollments[0];
    if (
      Number(enrollment.offering_id) !== offeringId ||
      enrollment.enrollment_status !== "Approved" ||
      enrollment.enrollment_subject_status !== "Enrolled"
    ) {
      fail(
        "GRADEBOOK_STUDENT_NOT_ELIGIBLE",
        "This student is not currently enrolled and approved for this offering.",
        409,
      );
    }

    // The FIRST_TERM_SUBMISSION lock protects shared assessment / meeting
    // structure, NOT score entry for every student in the class.
    // Only this student's latest attempt for the assessment's term determines
    // whether the individual score cell is editable.
    //
    // Serialization contract: the future term-submission and Program Head review
    // handlers MUST acquire the same subject_offerings and gradebook config rows
    // FOR UPDATE before creating/changing a submission, as this route does.
    const gradingTerm = assessments[0].grading_term;
    const [termSubmissionRows] = await connection.execute(
      `SELECT term_submission_id, attempt_number, submission_status
         FROM gradebook_term_submission_attempts
        WHERE config_id = ? AND enrollment_subject_id = ?
          AND grading_term = ?
        ORDER BY attempt_number DESC, term_submission_id DESC
        LIMIT 1`,
      [configId, input.enrollmentSubjectId, gradingTerm],
    );
    const latestTermSubmission = termSubmissionRows[0] ?? null;
    if (
      latestTermSubmission &&
      !["SUBMITTED", "APPROVED", "RETURNED"].includes(
        latestTermSubmission.submission_status,
      )
    ) {
      fail(
        "GRADEBOOK_TERM_SUBMISSION_DATA_INVALID",
        "This student's term has an unsupported submission status.",
      );
    }
    if (latestTermSubmission?.submission_status === "SUBMITTED") {
      fail(
        "GRADEBOOK_TERM_AWAITING_REVIEW",
        `This student's ${gradingTerm} grade is submitted and locked until review.`,
        409,
      );
    }
    if (latestTermSubmission?.submission_status === "APPROVED") {
      fail(
        "GRADEBOOK_TERM_APPROVED_LOCKED",
        `This student's ${gradingTerm} grade is approved. Use the authorized correction workflow.`,
        409,
      );
    }
    // RETURNED is the Program Head's explicit student-and-term-only permission
    // to correct scores; FINAL_TERM stays independent of MIDTERM.

    const [existingRows] = await connection.execute(
      `SELECT score_id, score_status, earned_score, not_applicable_reason,
              record_version
         FROM gradebook_scores
        WHERE assessment_id = ? AND enrollment_subject_id = ?
        FOR UPDATE`,
      [input.assessmentId, input.enrollmentSubjectId],
    );
    if (existingRows.length > 1) {
      fail(
        "GRADEBOOK_SCORE_DATA_INVALID",
        "Duplicate score rows were detected.",
      );
    }
    const previous = existingRows[0] ?? null;
    if (
      (previous && Number(previous.record_version) !== input.expectedVersion) ||
      (!previous && input.expectedVersion !== null)
    ) {
      fail(
        "SCORE_VERSION_CONFLICT",
        "This score has changed. Reload the latest gradebook value before saving.",
      );
    }
    if (previous && Number(previous.record_version) >= 4294967295) {
      fail(
        "SCORE_VERSION_OVERFLOW",
        "Score record version cannot increase further.",
      );
    }

    // Identical score resubmission is a safe no-op; do not generate audit noise.
    const previousEarned =
      previous?.earned_score === null || previous === null
        ? null
        : String(previous.earned_score);
    const previousReason = previous?.not_applicable_reason ?? null;
    if (
      previous &&
      previous.score_status === input.scoreStatus &&
      previousEarned === input.earnedScore &&
      previousReason === input.naReason
    ) {
      await connection.rollback();
      transactionStarted = false;
      return res.json({
        success: true,
        offering_id: offeringId,
        config_id: configId,
        assessment_id: input.assessmentId,
        enrollment_subject_id: input.enrollmentSubjectId,
        score: {
          score_id: Number(previous.score_id),
          score_status: previous.score_status,
          earned_score: previousEarned,
          not_applicable_reason: previousReason,
          record_version: Number(previous.record_version),
        },
        unchanged: true,
        dry_run: input.dryRun,
        persisted: !input.dryRun,
      });
    }

    let scoreId;
    let version;
    let eventType;
    if (!previous) {
      const [insert] = await connection.execute(
        `INSERT INTO gradebook_scores
          (assessment_id, enrollment_subject_id, score_status, earned_score,
           not_applicable_reason, record_version,
           created_by_user_id, updated_by_user_id)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          input.assessmentId,
          input.enrollmentSubjectId,
          input.scoreStatus,
          input.earnedScore,
          input.naReason,
          actorUserId,
          actorUserId,
        ],
      );
      scoreId = Number(insert.insertId);
      version = 1;
      eventType = "CREATED";
    } else {
      scoreId = Number(previous.score_id);
      version = Number(previous.record_version) + 1;
      const [update] = await connection.execute(
        `UPDATE gradebook_scores
            SET score_status = ?, earned_score = ?, not_applicable_reason = ?,
                record_version = ?, updated_by_user_id = ?
          WHERE score_id = ? AND record_version = ?`,
        [
          input.scoreStatus,
          input.earnedScore,
          input.naReason,
          version,
          actorUserId,
          scoreId,
          input.expectedVersion,
        ],
      );
      if (Number(update.affectedRows) !== 1) {
        fail(
          "SCORE_VERSION_CONFLICT",
          "This score was updated concurrently. Reload before saving.",
        );
      }
      eventType = "UPDATED";
    }

    if (!positiveId(scoreId)) {
      throw new Error("Score write returned an invalid score ID.");
    }
    const [event] = await connection.execute(
      `INSERT INTO gradebook_score_events
        (score_id, event_type, change_context,
         previous_score_status, new_score_status,
         previous_earned_score, new_earned_score,
         previous_na_reason, new_na_reason,
         change_reason, changed_by_user_id, score_version_after)
       VALUES (?, ?, 'DRAFT_ENTRY', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scoreId,
        eventType,
        previous?.score_status ?? null,
        input.scoreStatus,
        previousEarned,
        input.earnedScore,
        previousReason,
        input.naReason,
        input.changeReason,
        actorUserId,
        version,
      ],
    );
    if (Number(event.affectedRows) !== 1) {
      throw new Error("Score audit event insert did not succeed.");
    }

    const result = {
      success: true,
      offering_id: offeringId,
      config_id: configId,
      assessment_id: input.assessmentId,
      enrollment_subject_id: input.enrollmentSubjectId,
      student_id: Number(enrollment.student_id),
      grading_term: gradingTerm,
      edit_scope:
        latestTermSubmission?.submission_status === "RETURNED"
          ? "RETURNED_TERM_CORRECTION"
          : "DRAFT_ENTRY",
      assessment_maximum_score: maximum.value,
      score: {
        score_id: scoreId,
        score_status: input.scoreStatus,
        earned_score: input.earnedScore,
        not_applicable_reason: input.naReason,
        record_version: version,
      },
      previous: previous
        ? {
            score_status: previous.score_status,
            earned_score: previousEarned,
            not_applicable_reason: previousReason,
            record_version: Number(previous.record_version),
          }
        : null,
      audit_event: eventType,
      unchanged: false,
      dry_run: input.dryRun,
      persisted: !input.dryRun,
    };

    if (input.dryRun) {
      await connection.rollback();
    } else {
      await connection.commit();
    }
    transactionStarted = false;
    return res.status(!input.dryRun && !previous ? 201 : 200).json(result);
  } catch (error) {
    if (transactionStarted && connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("GRADEBOOK SCORE ROLLBACK ERROR:", rollbackError);
      }
    }
    if (error?.code === "ER_DUP_ENTRY") {
      return sendError(res, {
        status: 409,
        code: "SCORE_VERSION_CONFLICT",
        message:
          "The score was created or updated concurrently. Reload and retry.",
      });
    }
    return sendError(res, error);
  } finally {
    connection?.release();
  }
});

export default router;
