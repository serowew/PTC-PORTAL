import express from "express";
import db from "../db.js";
import { loadGradebookOfferingConfig } from "../services/gradebookOfferingConfig.service.js";

const router = express.Router();

function positiveId(value) {
  const raw = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function sendError(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;

  if (status === 500) {
    console.error("GRADEBOOK ASSESSMENTS ERROR:", error);
  }

  return res.status(status).json({
    success: false,
    code:
      status === 500
        ? "GRADEBOOK_INTERNAL_ERROR"
        : (error.code ?? "GRADEBOOK_REQUEST_FAILED"),
    message:
      status === 500
        ? "Could not retrieve gradebook assessments."
        : error.message,
  });
}

// Shared assessment columns become immutable for the submitted grading term.
// The legacy full-semester lock still blocks both terms until migrated.
// Call only after locking the offering and gradebook config rows FOR UPDATE.
async function assertAssessmentTermEditable(
  connection,
  configId,
  offeringId,
  gradingTerm,
) {
  if (!["MIDTERM", "FINAL_TERM"].includes(gradingTerm)) {
    const error = new Error("The assessment has an invalid grading term.");
    error.code = "INVALID_GRADING_TERM";
    error.status = 409;
    throw error;
  }

  const [legacyLocks] = await connection.execute(
    "SELECT config_id FROM gradebook_structure_locks WHERE config_id = ? LIMIT 1",
    [configId],
  );
  const [legacyAttempts] = await connection.execute(
    `SELECT 1
       FROM gradebook_grade_submission_attempts sa
       JOIN grades g ON g.grade_id = sa.grade_id
       JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
      WHERE es.offering_id = ? LIMIT 1`,
    [offeringId],
  );
  if (legacyLocks.length || legacyAttempts.length) {
    const error = new Error(
      "Legacy full-semester submissions prevent assessment structure changes.",
    );
    error.code = "GRADEBOOK_LEGACY_SUBMISSION_LOCKED";
    error.status = 409;
    throw error;
  }

  const [termLocks] = await connection.execute(
    `SELECT first_submission_id
       FROM gradebook_term_structure_locks
      WHERE config_id = ? AND grading_term = ? LIMIT 1`,
    [configId, gradingTerm],
  );
  if (termLocks.length) {
    const error = new Error(
      `${gradingTerm} assessment structure is locked after the first term submission.`,
    );
    error.code = "GRADEBOOK_TERM_STRUCTURE_LOCKED";
    error.status = 409;
    throw error;
  }

  // Fail closed if a submission exists but its matching lock is missing.
  const [termAttempts] = await connection.execute(
    `SELECT term_submission_id
       FROM gradebook_term_submission_attempts
      WHERE config_id = ? AND grading_term = ? LIMIT 1`,
    [configId, gradingTerm],
  );
  if (termAttempts.length) {
    const error = new Error(
      `${gradingTerm} submission history exists; its assessment structure cannot change.`,
    );
    error.code = "GRADEBOOK_TERM_SUBMISSION_ALREADY_STARTED";
    error.status = 409;
    throw error;
  }
}

// GET /api/gradebook/:offeringId/assessments?include_removed=true
// Read-only list. Registration in server.js applies authentication and role checks.
router.get("/:offeringId/assessments", async (req, res) => {
  const offeringId = positiveId(req.params.offeringId);
  if (!offeringId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_OFFERING_ID",
      message: "offeringId must be a positive integer.",
    });
  }

  const includeRemovedRaw = req.query.include_removed;
  if (
    Array.isArray(includeRemovedRaw) ||
    (includeRemovedRaw !== undefined &&
      includeRemovedRaw !== "true" &&
      includeRemovedRaw !== "false")
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_INCLUDE_REMOVED",
      message: "include_removed must be true or false.",
    });
  }
  const includeRemoved = includeRemovedRaw === "true";

  try {
    // Only the assigned instructor may inspect assessment structure.
    // Global authenticate + requireRole middleware is also required.
    const [ownership] = await db.execute(
      `SELECT so.offering_id, f.user_id AS assigned_user_id
         FROM subject_offerings so
         LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
        WHERE so.offering_id = ?`,
      [offeringId],
    );

    if (ownership.length !== 1) {
      return res.status(404).json({
        success: false,
        code: "OFFERING_NOT_FOUND",
        message: "Subject offering was not found.",
      });
    }

    if (Number(ownership[0].assigned_user_id) !== Number(req.user.user_id)) {
      return res.status(403).json({
        success: false,
        code: "GRADEBOOK_INSTRUCTOR_REQUIRED",
        message: "Only the assigned instructor can view this gradebook.",
      });
    }

    // Reuse policy validation from Step 2.2.
    const config = await loadGradebookOfferingConfig(db, offeringId);
    if (!config.is_initialized) {
      return res.status(409).json({
        success: false,
        code: "GRADEBOOK_NOT_INITIALIZED",
        message: "This offering has no initialized gradebook.",
      });
    }

    const [legacyLocks] = await db.execute(
      "SELECT config_id FROM gradebook_structure_locks WHERE config_id = ? LIMIT 1",
      [config.config_id],
    );
    const [legacyAttempts] = await db.execute(
      `SELECT 1
         FROM gradebook_grade_submission_attempts sa
         JOIN grades g ON g.grade_id = sa.grade_id
         JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
        WHERE es.offering_id = ? LIMIT 1`,
      [offeringId],
    );
    const legacyLocked = legacyLocks.length > 0 || legacyAttempts.length > 0;

    const [termLocks] = await db.execute(
      `SELECT grading_term
         FROM gradebook_term_structure_locks
        WHERE config_id = ?`,
      [config.config_id],
    );
    const [termAttempts] = await db.execute(
      `SELECT DISTINCT grading_term
         FROM gradebook_term_submission_attempts
        WHERE config_id = ?`,
      [config.config_id],
    );
    const lockedTerms = new Set([
      ...termLocks.map((row) => row.grading_term),
      ...termAttempts.map((row) => row.grading_term),
    ]);
    const termStructureLocked = {
      MIDTERM: legacyLocked || lockedTerms.has("MIDTERM"),
      FINAL_TERM: legacyLocked || lockedTerms.has("FINAL_TERM"),
    };
    // The legacy top-level flag remains conservative for older clients.
    const structureLocked =
      termStructureLocked.MIDTERM || termStructureLocked.FINAL_TERM;
    const [assessments] = await db.execute(
      `SELECT
          a.assessment_id,
          a.offering_category_id,
          oc.category_code,
          a.grading_term,
          a.header_name,
          a.maximum_score,
          a.display_order,
          a.record_status,
          a.record_version,
          a.created_at,
          a.updated_at,
          a.removed_at
        FROM gradebook_assessments a
        INNER JOIN gradebook_offering_categories oc
          ON oc.offering_category_id = a.offering_category_id
        WHERE oc.config_id = ?
          AND (? = 1 OR a.record_status = 'ACTIVE')
        ORDER BY
          CASE a.grading_term WHEN 'MIDTERM' THEN 0 ELSE 1 END,
          oc.display_order,
          a.display_order,
          a.assessment_id`,
      [config.config_id, includeRemoved ? 1 : 0],
    );

    // Empty category groups are returned as part of the official layout.
    const makeCategories = () =>
      config.categories.map((category) => ({
        category_code: category.category_code,
        category_name: category.category_name,
        category_percent: category.category_percent,
        display_order: category.display_order,
        assessments: [],
      }));

    const terms = {
      MIDTERM: {
        categories: makeCategories(),
        structure_locked: termStructureLocked.MIDTERM,
        can_edit_structure:
          !termStructureLocked.MIDTERM && config.offering_status === "Open",
      },
      FINAL_TERM: {
        categories: makeCategories(),
        structure_locked: termStructureLocked.FINAL_TERM,
        can_edit_structure:
          !termStructureLocked.FINAL_TERM && config.offering_status === "Open",
      },
    };

    let activeCount = 0;
    let removedCount = 0;

    for (const assessment of assessments) {
      const category = terms[assessment.grading_term]?.categories.find(
        (item) => item.category_code === assessment.category_code,
      );
      if (!category) {
        const error = new Error(
          "Assessment belongs to an invalid term or category.",
        );
        error.code = "GRADEBOOK_ASSESSMENT_DATA_INVALID";
        error.status = 409;
        throw error;
      }

      category.assessments.push({
        assessment_id: Number(assessment.assessment_id),
        offering_category_id: Number(assessment.offering_category_id),
        header_name: assessment.header_name,
        maximum_score: String(assessment.maximum_score),
        display_order: Number(assessment.display_order),
        record_status: assessment.record_status,
        record_version: Number(assessment.record_version),
        created_at: assessment.created_at,
        updated_at: assessment.updated_at,
        removed_at: assessment.removed_at,
      });

      if (assessment.record_status === "REMOVED") removedCount += 1;
      else activeCount += 1;
    }

    return res.json({
      success: true,
      offering_id: config.offering_id,
      config_id: config.config_id,
      subject_code: config.subject_code,
      subject_name: config.subject_name,
      grading_classification: config.grading_classification,
      grading_policy: config.grading_policy,
      policy_version: config.policy_version,
      offering_status: config.offering_status,
      structure_locked: structureLocked,
      can_edit_structure: !structureLocked && config.offering_status === "Open",
      term_structure_locked: termStructureLocked,
      include_removed: includeRemoved,
      active_assessment_count: activeCount,
      removed_assessment_count: removedCount,
      terms,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

// POST /api/gradebook/:offeringId/assessments
// Draft assessment creation. A dry run performs all INSERTs then rolls back.
router.post("/:offeringId/assessments", async (req, res) => {
  const offeringId = positiveId(req.params.offeringId);
  if (!offeringId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_OFFERING_ID",
      message: "offeringId must be a positive integer.",
    });
  }

  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ASSESSMENT_INPUT",
      message: "A JSON object is required.",
    });
  }

  const allowed = new Set([
    "grading_term",
    "category_code",
    "header_name",
    "maximum_score",
    "dry_run",
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    return res.status(400).json({
      success: false,
      code: "UNSUPPORTED_ASSESSMENT_FIELD",
      message:
        "Assessment columns cannot override official category weights or other managed fields.",
    });
  }

  if (!["MIDTERM", "FINAL_TERM"].includes(body.grading_term)) {
    return res.status(400).json({
      success: false,
      code: "INVALID_GRADING_TERM",
      message: "grading_term must be MIDTERM or FINAL_TERM.",
    });
  }

  if (
    typeof body.category_code !== "string" ||
    !/^[A-Z][A-Z0-9_]*$/.test(body.category_code)
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_CATEGORY",
      message: "A valid official category_code is required.",
    });
  }

  if (body.category_code === "ATTENDANCE") {
    return res.status(422).json({
      success: false,
      code: "ATTENDANCE_USES_MEETINGS",
      message:
        "Attendance is recorded by class meetings, not assessment columns.",
    });
  }

  if (typeof body.header_name !== "string") {
    return res.status(400).json({
      success: false,
      code: "INVALID_HEADER_NAME",
      message: "header_name must be text.",
    });
  }

  const headerName = body.header_name.trim();
  if (
    !headerName ||
    Array.from(headerName).length > 120 ||
    /[\x00-\x1f\x7f]/.test(headerName)
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_HEADER_NAME",
      message:
        "header_name must be 1–120 characters without control characters.",
    });
  }

  // DECIMAL(10,2) allows at most eight integer digits and two decimal places.
  // Keep the maximum as a decimal string, never a floating-point computation.
  const maximumRaw = body.maximum_score;
  const maximumText =
    typeof maximumRaw === "number" || typeof maximumRaw === "string"
      ? String(maximumRaw).trim()
      : "";
  if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(maximumText)) {
    return res.status(400).json({
      success: false,
      code: "INVALID_MAXIMUM_SCORE",
      message:
        "maximum_score must be positive with at most two decimals, within DECIMAL(10,2).",
    });
  }
  const [whole, decimal = ""] = maximumText.split(".");
  const pointsInHundredths =
    BigInt(whole) * 100n + BigInt(decimal.padEnd(2, "0"));
  if (pointsInHundredths <= 0n) {
    return res.status(400).json({
      success: false,
      code: "INVALID_MAXIMUM_SCORE",
      message: "maximum_score must be greater than zero.",
    });
  }
  const maximumScore = `${whole}.${decimal.padEnd(2, "0")}`;

  if (typeof body.dry_run !== "boolean") {
    return res.status(400).json({
      success: false,
      code: "DRY_RUN_REQUIRED",
      message: "Specify dry_run: true to test, or dry_run: false to save.",
    });
  }

  // Permanent writes remain limited to the verified test offering.
  // Remove this test restriction only in a later production integration step.
  if (!body.dry_run && offeringId !== 131) {
    return res.status(403).json({
      success: false,
      code: "TEST_OFFERING_ONLY",
      message: "Committed assessment testing is limited to Offering #131.",
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

  const connection = await db.getConnection().catch((error) => {
    console.error("GRADEBOOK CONNECTION ERROR:", error);
    return null;
  });
  if (!connection) {
    return res.status(500).json({
      success: false,
      code: "GRADEBOOK_INTERNAL_ERROR",
      message: "Could not start the assessment transaction.",
    });
  }

  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;

    if (!body.dry_run) {
      const [dbRows] = await connection.execute(
        "SELECT DATABASE() AS database_name",
      );
      if (dbRows[0]?.database_name !== "databaseforptc1_admission_test") {
        const error = new Error(
          "Committed test is disabled outside the admission-test database.",
        );
        error.code = "TEST_DATABASE_ONLY";
        error.status = 403;
        throw error;
      }
    }

    // Serialize assessment structure changes against this offering.
    const [offerings] = await connection.execute(
      `SELECT so.offering_id, so.status, so.faculty_id,
              f.user_id AS assigned_user_id,
              u.is_active, u.is_archived, r.role_name
         FROM subject_offerings so
         LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
         LEFT JOIN users u ON u.user_id = f.user_id
         LEFT JOIN roles r ON r.role_id = u.role_id
        WHERE so.offering_id = ? FOR UPDATE`,
      [offeringId],
    );
    if (offerings.length !== 1) {
      const error = new Error("Subject offering was not found.");
      error.code = "OFFERING_NOT_FOUND";
      error.status = 404;
      throw error;
    }
    const offering = offerings[0];
    if (
      Number(offering.assigned_user_id) !== actorUserId ||
      Number(offering.is_active) !== 1 ||
      Number(offering.is_archived) !== 0 ||
      !["Faculty", "Program Head"].includes(offering.role_name)
    ) {
      const error = new Error(
        "Only the active assigned instructor can create assessments.",
      );
      error.code = "GRADEBOOK_INSTRUCTOR_REQUIRED";
      error.status = 403;
      throw error;
    }
    if (offering.status !== "Open") {
      const error = new Error(
        "Assessment columns can only be added to Open offerings.",
      );
      error.code = "OFFERING_NOT_OPEN";
      error.status = 409;
      throw error;
    }

    // The frozen configuration row is the common serialization point
    // for subsequent submission and assessment mutation routes.
    const [configRows] = await connection.execute(
      "SELECT config_id FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE",
      [offeringId],
    );
    if (configRows.length !== 1) {
      const error = new Error("This offering has no initialized gradebook.");
      error.code = "GRADEBOOK_NOT_INITIALIZED";
      error.status = 409;
      throw error;
    }
    const configId = Number(configRows[0].config_id);

    // Revalidate classification, policy V1, and all fixed category weights.
    const config = await loadGradebookOfferingConfig(connection, offeringId);
    if (!config.is_initialized || Number(config.config_id) !== configId) {
      const error = new Error("Offering configuration failed validation.");
      error.code = "GRADEBOOK_CONFIG_INVALID";
      error.status = 409;
      throw error;
    }

    await assertAssessmentTermEditable(
      connection,
      configId,
      offeringId,
      body.grading_term,
    );

    const [categories] = await connection.execute(
      `SELECT offering_category_id
         FROM gradebook_offering_categories
        WHERE config_id = ? AND category_code = ?`,
      [configId, body.category_code],
    );
    if (
      categories.length !== 1 ||
      !config.categories.some(
        (category) => category.category_code === body.category_code,
      )
    ) {
      const error = new Error(
        "Category does not belong to this offering policy.",
      );
      error.code = "INVALID_CATEGORY";
      error.status = 422;
      throw error;
    }
    const offeringCategoryId = Number(categories[0].offering_category_id);

    // Prevent duplicate names in the same category and term.
    const [duplicates] = await connection.execute(
      `SELECT assessment_id
         FROM gradebook_assessments
        WHERE offering_category_id = ?
          AND grading_term = ?
          AND record_status = 'ACTIVE'
          AND LOWER(TRIM(header_name)) = LOWER(?)
        LIMIT 1`,
      [offeringCategoryId, body.grading_term, headerName],
    );
    if (duplicates.length) {
      const error = new Error(
        "An active assessment with this name already exists in the category and term.",
      );
      error.code = "ASSESSMENT_NAME_EXISTS";
      error.status = 409;
      throw error;
    }

    const [orderRows] = await connection.execute(
      `SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order
         FROM gradebook_assessments
        WHERE offering_category_id = ? AND grading_term = ?`,
      [offeringCategoryId, body.grading_term],
    );
    const displayOrder = Number(orderRows[0].next_order);
    if (
      !Number.isSafeInteger(displayOrder) ||
      displayOrder < 1 ||
      displayOrder > 4294967295
    ) {
      const error = new Error("No valid display order is available.");
      error.code = "ASSESSMENT_ORDER_OVERFLOW";
      error.status = 409;
      throw error;
    }

    const [created] = await connection.execute(
      `INSERT INTO gradebook_assessments
        (offering_category_id, grading_term, header_name,
         maximum_score, display_order, record_status,
         record_version, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', 1, ?)`,
      [
        offeringCategoryId,
        body.grading_term,
        headerName,
        maximumScore,
        displayOrder,
        actorUserId,
      ],
    );
    const assessmentId = Number(created.insertId);
    if (!Number.isSafeInteger(assessmentId) || assessmentId < 1) {
      throw new Error("Assessment insert returned an invalid identifier.");
    }

    // CREATED has no previous values, no score changes, and no removal data.
    // The audit event must commit or roll back together with the assessment.
    const [event] = await connection.execute(
      `INSERT INTO gradebook_assessment_events
        (assessment_id, event_type, change_context,
         new_offering_category_id, new_grading_term,
         new_header_name, new_maximum_score,
         new_display_order, new_record_status,
         affected_score_rows, affected_scored_rows,
         scored_removal_confirmed, change_reason,
         changed_by_user_id, assessment_version_after)
       VALUES (?, 'CREATED', 'DRAFT_STRUCTURE',
               ?, ?, ?, ?, ?, 'ACTIVE',
               0, 0, 0, NULL, ?, 1)`,
      [
        assessmentId,
        offeringCategoryId,
        body.grading_term,
        headerName,
        maximumScore,
        displayOrder,
        actorUserId,
      ],
    );
    if (Number(event.affectedRows) !== 1) {
      throw new Error("Audit event was not recorded.");
    }

    const result = {
      success: true,
      offering_id: offeringId,
      config_id: configId,
      assessment: {
        assessment_id: assessmentId,
        offering_category_id: offeringCategoryId,
        grading_term: body.grading_term,
        category_code: body.category_code,
        header_name: headerName,
        maximum_score: maximumScore,
        display_order: displayOrder,
        record_status: "ACTIVE",
        record_version: 1,
      },
      audit_event: "CREATED",
      dry_run: body.dry_run,
      persisted: !body.dry_run,
    };

    if (body.dry_run) await connection.rollback();
    else await connection.commit();
    transactionStarted = false;

    return res.status(body.dry_run ? 200 : 201).json(result);
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("GRADEBOOK ASSESSMENT ROLLBACK FAILED:", rollbackError);
      }
    }
    return sendError(res, error);
  } finally {
    connection.release();
  }
});

// PATCH /api/gradebook/:offeringId/assessments/:assessmentId
// Change the name and/or maximum before scores or the first submission.
// Changes and UPDATED audit history are committed together.
router.patch("/:offeringId/assessments/:assessmentId", async (req, res) => {
  const offeringId = positiveId(req.params.offeringId);
  const assessmentId = positiveId(req.params.assessmentId);

  if (!offeringId || !assessmentId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ASSESSMENT_ID",
      message: "offeringId and assessmentId must be positive integers.",
    });
  }

  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ASSESSMENT_INPUT",
      message: "A JSON object is required.",
    });
  }

  const allowed = new Set([
    "record_version",
    "header_name",
    "maximum_score",
    "dry_run",
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    return res.status(400).json({
      success: false,
      code: "UNSUPPORTED_ASSESSMENT_FIELD",
      message:
        "Only the header name and maximum score may be changed during Draft.",
    });
  }

  const expectedVersion = positiveId(body.record_version);
  if (!expectedVersion) {
    return res.status(400).json({
      success: false,
      code: "INVALID_RECORD_VERSION",
      message: "Provide the current positive record_version.",
    });
  }

  if (typeof body.dry_run !== "boolean") {
    return res.status(400).json({
      success: false,
      code: "DRY_RUN_REQUIRED",
      message: "Specify dry_run: true to test or dry_run: false to save.",
    });
  }

  const hasName = Object.prototype.hasOwnProperty.call(body, "header_name");
  const hasMaximum = Object.prototype.hasOwnProperty.call(
    body,
    "maximum_score",
  );
  if (!hasName && !hasMaximum) {
    return res.status(400).json({
      success: false,
      code: "ASSESSMENT_CHANGE_REQUIRED",
      message: "Provide header_name and/or maximum_score.",
    });
  }

  let requestedName;
  if (hasName) {
    if (typeof body.header_name !== "string") {
      return res.status(400).json({
        success: false,
        code: "INVALID_HEADER_NAME",
        message: "header_name must be text.",
      });
    }
    requestedName = body.header_name.trim();
    if (
      !requestedName ||
      Array.from(requestedName).length > 120 ||
      /[\x00-\x1f\x7f]/.test(requestedName)
    ) {
      return res.status(400).json({
        success: false,
        code: "INVALID_HEADER_NAME",
        message:
          "header_name must be 1–120 characters without control characters.",
      });
    }
  }

  let requestedMaximum;
  if (hasMaximum) {
    const raw = body.maximum_score;
    const text =
      typeof raw === "string" || typeof raw === "number"
        ? String(raw).trim()
        : "";
    if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(text)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_MAXIMUM_SCORE",
        message:
          "maximum_score must be positive with at most two decimals, within DECIMAL(10,2).",
      });
    }
    const [whole, decimals = ""] = text.split(".");
    const hundredths = BigInt(whole) * 100n + BigInt(decimals.padEnd(2, "0"));
    if (hundredths <= 0n) {
      return res.status(400).json({
        success: false,
        code: "INVALID_MAXIMUM_SCORE",
        message: "maximum_score must be greater than zero.",
      });
    }
    requestedMaximum = `${whole}.${decimals.padEnd(2, "0")}`;
  }

  // During integration, permanent writes are limited to the verified test offering.
  if (!body.dry_run && offeringId !== 131) {
    return res.status(403).json({
      success: false,
      code: "TEST_OFFERING_ONLY",
      message: "Committed assessment testing is limited to Offering #131.",
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

  let connection;
  try {
    connection = await db.getConnection();
  } catch (error) {
    return sendError(res, error);
  }

  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;

    if (!body.dry_run) {
      const [databaseRows] = await connection.execute(
        "SELECT DATABASE() AS database_name",
      );
      if (databaseRows[0]?.database_name !== "databaseforptc1_admission_test") {
        const error = new Error(
          "Committed test is disabled outside the admission-test database.",
        );
        error.code = "TEST_DATABASE_ONLY";
        error.status = 403;
        throw error;
      }
    }

    // Use the same lock ordering as assessment creation.
    const [offerings] = await connection.execute(
      `SELECT so.offering_id, so.status,
              f.user_id AS assigned_user_id,
              u.is_active, u.is_archived, r.role_name
         FROM subject_offerings so
         LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
         LEFT JOIN users u ON u.user_id = f.user_id
         LEFT JOIN roles r ON r.role_id = u.role_id
        WHERE so.offering_id = ? FOR UPDATE`,
      [offeringId],
    );

    if (offerings.length !== 1) {
      const error = new Error("Subject offering was not found.");
      error.code = "OFFERING_NOT_FOUND";
      error.status = 404;
      throw error;
    }
    const offering = offerings[0];
    if (
      Number(offering.assigned_user_id) !== actorUserId ||
      Number(offering.is_active) !== 1 ||
      Number(offering.is_archived) !== 0 ||
      !["Faculty", "Program Head"].includes(offering.role_name)
    ) {
      const error = new Error(
        "Only the active assigned instructor can update assessments.",
      );
      error.code = "GRADEBOOK_INSTRUCTOR_REQUIRED";
      error.status = 403;
      throw error;
    }
    if (offering.status !== "Open") {
      const error = new Error(
        "Assessment structure can only change in Open offerings.",
      );
      error.code = "OFFERING_NOT_OPEN";
      error.status = 409;
      throw error;
    }

    const [configs] = await connection.execute(
      "SELECT config_id FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE",
      [offeringId],
    );
    if (configs.length !== 1) {
      const error = new Error("This offering has no initialized gradebook.");
      error.code = "GRADEBOOK_NOT_INITIALIZED";
      error.status = 409;
      throw error;
    }
    const configId = Number(configs[0].config_id);
    const config = await loadGradebookOfferingConfig(connection, offeringId);
    if (!config.is_initialized || Number(config.config_id) !== configId) {
      const error = new Error(
        "Offering configuration failed policy validation.",
      );
      error.code = "GRADEBOOK_CONFIG_INVALID";
      error.status = 409;
      throw error;
    }

    const [assessments] = await connection.execute(
      `SELECT a.assessment_id, a.offering_category_id,
              a.grading_term, a.header_name, a.maximum_score,
              a.display_order, a.record_status, a.record_version,
              oc.category_code
         FROM gradebook_assessments a
         JOIN gradebook_offering_categories oc
           ON oc.offering_category_id = a.offering_category_id
        WHERE a.assessment_id = ? AND oc.config_id = ?
        FOR UPDATE`,
      [assessmentId, configId],
    );
    if (assessments.length !== 1) {
      const error = new Error("Assessment was not found in this offering.");
      error.code = "ASSESSMENT_NOT_FOUND";
      error.status = 404;
      throw error;
    }
    const current = assessments[0];
    await assertAssessmentTermEditable(
      connection,
      configId,
      offeringId,
      current.grading_term,
    );
    if (current.record_status !== "ACTIVE") {
      const error = new Error("Removed assessments cannot be edited.");
      error.code = "ASSESSMENT_REMOVED";
      error.status = 409;
      throw error;
    }
    if (Number(current.record_version) !== expectedVersion) {
      const error = new Error(
        "Assessment has changed. Reload its latest version.",
      );
      error.code = "ASSESSMENT_VERSION_CONFLICT";
      error.status = 409;
      throw error;
    }

    const nextName = hasName ? requestedName : current.header_name;
    const nextMaximum = hasMaximum
      ? requestedMaximum
      : String(current.maximum_score);
    const nameChanged = nextName !== current.header_name;
    const maxChanged = nextMaximum !== String(current.maximum_score);

    if (!nameChanged && !maxChanged) {
      const error = new Error(
        "Assessment name and maximum score are unchanged.",
      );
      error.code = "ASSESSMENT_NO_CHANGES";
      error.status = 409;
      throw error;
    }

    if (nameChanged) {
      const [duplicates] = await connection.execute(
        `SELECT assessment_id
           FROM gradebook_assessments
          WHERE offering_category_id = ?
            AND grading_term = ?
            AND record_status = 'ACTIVE'
            AND assessment_id <> ?
            AND LOWER(TRIM(header_name)) = LOWER(?)
          LIMIT 1`,
        [
          current.offering_category_id,
          current.grading_term,
          assessmentId,
          nextName,
        ],
      );
      if (duplicates.length) {
        const error = new Error(
          "An active assessment with this name already exists in the category and term.",
        );
        error.code = "ASSESSMENT_NAME_EXISTS";
        error.status = 409;
        throw error;
      }
    }

    // A maximum-score change could reinterpret already saved student scores.
    // Allow name changes when scores exist, but keep the maximum unchanged.
    if (maxChanged) {
      const [scoreRows] = await connection.execute(
        "SELECT score_id FROM gradebook_scores WHERE assessment_id = ? FOR UPDATE",
        [assessmentId],
      );
      if (scoreRows.length > 0) {
        const error = new Error(
          "Cannot change maximum_score after student score records exist.",
        );
        error.code = "ASSESSMENT_MAXIMUM_HAS_SCORES";
        error.status = 409;
        throw error;
      }
    }

    const nextVersion = expectedVersion + 1;
    if (!Number.isSafeInteger(nextVersion) || nextVersion > 4294967295) {
      const error = new Error("Assessment version limit reached.");
      error.code = "ASSESSMENT_VERSION_OVERFLOW";
      error.status = 409;
      throw error;
    }

    const [updated] = await connection.execute(
      `UPDATE gradebook_assessments
          SET header_name = ?, maximum_score = ?,
              record_version = ?, updated_at = CURRENT_TIMESTAMP()
        WHERE assessment_id = ? AND record_version = ?
          AND record_status = 'ACTIVE'`,
      [nextName, nextMaximum, nextVersion, assessmentId, expectedVersion],
    );
    if (Number(updated.affectedRows) !== 1) {
      const error = new Error("Assessment was changed by another request.");
      error.code = "ASSESSMENT_VERSION_CONFLICT";
      error.status = 409;
      throw error;
    }

    // An UPDATED audit event contains the complete before/after structure.
    const [event] = await connection.execute(
      `INSERT INTO gradebook_assessment_events (
          assessment_id, event_type, change_context,
          previous_offering_category_id, previous_grading_term,
          previous_header_name, previous_maximum_score,
          previous_display_order, previous_record_status,
          new_offering_category_id, new_grading_term,
          new_header_name, new_maximum_score,
          new_display_order, new_record_status,
          affected_score_rows, affected_scored_rows,
          scored_removal_confirmed, change_reason,
          changed_by_user_id, assessment_version_after
        ) VALUES (
          ?, 'UPDATED', 'DRAFT_STRUCTURE',
          ?, ?, ?, ?, ?, 'ACTIVE',
          ?, ?, ?, ?, ?, 'ACTIVE',
          0, 0, 0, ?, ?, ?
        )`,
      [
        assessmentId,
        current.offering_category_id,
        current.grading_term,
        current.header_name,
        String(current.maximum_score),
        current.display_order,
        current.offering_category_id,
        current.grading_term,
        nextName,
        nextMaximum,
        current.display_order,
        "Assessment name or maximum score updated during Draft.",
        actorUserId,
        nextVersion,
      ],
    );
    if (Number(event.affectedRows) !== 1) {
      throw new Error("Assessment update audit event was not recorded.");
    }

    const result = {
      success: true,
      offering_id: offeringId,
      config_id: configId,
      assessment: {
        assessment_id: assessmentId,
        offering_category_id: Number(current.offering_category_id),
        grading_term: current.grading_term,
        category_code: current.category_code,
        header_name: nextName,
        maximum_score: nextMaximum,
        display_order: Number(current.display_order),
        record_status: "ACTIVE",
        record_version: nextVersion,
      },
      previous: {
        header_name: current.header_name,
        maximum_score: String(current.maximum_score),
        record_version: expectedVersion,
      },
      audit_event: "UPDATED",
      dry_run: body.dry_run,
      persisted: !body.dry_run,
    };

    if (body.dry_run) await connection.rollback();
    else await connection.commit();
    transactionStarted = false;

    return res.status(200).json(result);
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "GRADEBOOK ASSESSMENT UPDATE ROLLBACK FAILED:",
          rollbackError,
        );
      }
    }
    return sendError(res, error);
  } finally {
    connection.release();
  }
});

// DELETE /api/gradebook/:offeringId/assessments/:assessmentId
// Soft-remove an assessment during Draft. Scores and audit history are retained.
router.delete("/:offeringId/assessments/:assessmentId", async (req, res) => {
  const offeringId = positiveId(req.params.offeringId);
  const assessmentId = positiveId(req.params.assessmentId);

  if (!offeringId || !assessmentId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ASSESSMENT_ID",
      message: "offeringId and assessmentId must be positive integers.",
    });
  }

  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ASSESSMENT_INPUT",
      message: "A JSON object is required.",
    });
  }

  const allowed = new Set([
    "record_version",
    "dry_run",
    "confirm_removal",
    "confirm_scored_removal",
    "change_reason",
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    return res.status(400).json({
      success: false,
      code: "UNSUPPORTED_ASSESSMENT_FIELD",
      message:
        "Removal accepts only record_version, dry_run and confirmation/reason fields.",
    });
  }

  const expectedVersion = positiveId(body.record_version);
  if (!expectedVersion) {
    return res.status(400).json({
      success: false,
      code: "INVALID_RECORD_VERSION",
      message: "Provide the current positive record_version.",
    });
  }
  if (typeof body.dry_run !== "boolean") {
    return res.status(400).json({
      success: false,
      code: "DRY_RUN_REQUIRED",
      message: "Specify dry_run: true to test or dry_run: false to save.",
    });
  }
  if (
    body.confirm_removal !== undefined &&
    typeof body.confirm_removal !== "boolean"
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_REMOVAL_CONFIRMATION",
      message: "confirm_removal must be true or false.",
    });
  }
  if (
    body.confirm_scored_removal !== undefined &&
    typeof body.confirm_scored_removal !== "boolean"
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_REMOVAL_CONFIRMATION",
      message: "confirm_scored_removal must be true or false.",
    });
  }
  if (
    body.change_reason !== undefined &&
    typeof body.change_reason !== "string"
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_CHANGE_REASON",
      message: "change_reason must be text.",
    });
  }

  const requestedReason = String(body.change_reason ?? "").trim();
  if (
    Array.from(requestedReason).length > 2000 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(requestedReason)
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_CHANGE_REASON",
      message:
        "change_reason must be at most 2000 characters without control characters.",
    });
  }

  // Production enablement is intentionally deferred.
  if (!body.dry_run && offeringId !== 131) {
    return res.status(403).json({
      success: false,
      code: "TEST_OFFERING_ONLY",
      message: "Committed assessment testing is limited to Offering #131.",
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

  let connection;
  try {
    connection = await db.getConnection();
  } catch (error) {
    return sendError(res, error);
  }

  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;

    if (!body.dry_run) {
      const [databaseRows] = await connection.execute(
        "SELECT DATABASE() AS database_name",
      );
      if (databaseRows[0]?.database_name !== "databaseforptc1_admission_test") {
        const error = new Error(
          "Committed test is disabled outside the admission-test database.",
        );
        error.code = "TEST_DATABASE_ONLY";
        error.status = 403;
        throw error;
      }
    }

    // Use the same lock order as create/update: offering -> config -> assessment -> scores.
    const [offerings] = await connection.execute(
      `SELECT so.offering_id, so.status,
              f.user_id AS assigned_user_id,
              u.is_active, u.is_archived, r.role_name
         FROM subject_offerings so
         LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
         LEFT JOIN users u ON u.user_id = f.user_id
         LEFT JOIN roles r ON r.role_id = u.role_id
        WHERE so.offering_id = ? FOR UPDATE`,
      [offeringId],
    );
    if (offerings.length !== 1) {
      const error = new Error("Subject offering was not found.");
      error.code = "OFFERING_NOT_FOUND";
      error.status = 404;
      throw error;
    }
    const offering = offerings[0];
    if (
      Number(offering.assigned_user_id) !== actorUserId ||
      Number(offering.is_active) !== 1 ||
      Number(offering.is_archived) !== 0 ||
      !["Faculty", "Program Head"].includes(offering.role_name)
    ) {
      const error = new Error(
        "Only the active assigned instructor can remove assessments.",
      );
      error.code = "GRADEBOOK_INSTRUCTOR_REQUIRED";
      error.status = 403;
      throw error;
    }
    if (offering.status !== "Open") {
      const error = new Error(
        "Assessment structure can only change in Open offerings.",
      );
      error.code = "OFFERING_NOT_OPEN";
      error.status = 409;
      throw error;
    }

    const [configs] = await connection.execute(
      "SELECT config_id FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE",
      [offeringId],
    );
    if (configs.length !== 1) {
      const error = new Error("This offering has no initialized gradebook.");
      error.code = "GRADEBOOK_NOT_INITIALIZED";
      error.status = 409;
      throw error;
    }
    const configId = Number(configs[0].config_id);
    const config = await loadGradebookOfferingConfig(connection, offeringId);
    if (!config.is_initialized || Number(config.config_id) !== configId) {
      const error = new Error(
        "Offering configuration failed policy validation.",
      );
      error.code = "GRADEBOOK_CONFIG_INVALID";
      error.status = 409;
      throw error;
    }

    // Structure is immutable after the first student submission.
    const [assessments] = await connection.execute(
      `SELECT a.assessment_id, a.offering_category_id,
              a.grading_term, a.header_name, a.maximum_score,
              a.display_order, a.record_status, a.record_version,
              a.removed_at, a.removed_by_user_id, oc.category_code
         FROM gradebook_assessments a
         JOIN gradebook_offering_categories oc
           ON oc.offering_category_id = a.offering_category_id
        WHERE a.assessment_id = ? AND oc.config_id = ?
        FOR UPDATE`,
      [assessmentId, configId],
    );
    if (assessments.length !== 1) {
      const error = new Error("Assessment was not found in this offering.");
      error.code = "ASSESSMENT_NOT_FOUND";
      error.status = 404;
      throw error;
    }
    const current = assessments[0];
    await assertAssessmentTermEditable(
      connection,
      configId,
      offeringId,
      current.grading_term,
    );
    if (current.record_status !== "ACTIVE") {
      const error = new Error("Assessment is already removed.");
      error.code = "ASSESSMENT_ALREADY_REMOVED";
      error.status = 409;
      throw error;
    }
    if (Number(current.record_version) !== expectedVersion) {
      const error = new Error(
        "Assessment has changed. Reload its latest version.",
      );
      error.code = "ASSESSMENT_VERSION_CONFLICT";
      error.status = 409;
      throw error;
    }

    // Scores are never deleted. Locking them prevents a simultaneous change
    // from slipping between count/confirmation and soft removal.
    const [scores] = await connection.execute(
      `SELECT score_id, score_status
         FROM gradebook_scores
        WHERE assessment_id = ?
        ORDER BY score_id FOR UPDATE`,
      [assessmentId],
    );
    const affectedScoreRows = scores.length;
    const affectedScoredRows = scores.filter(
      (score) => score.score_status === "SCORED",
    ).length;

    if (affectedScoreRows > 0 && body.confirm_removal !== true) {
      const error = new Error(
        "This assessment has student score records. Confirm removal explicitly.",
      );
      error.code = "ASSESSMENT_REMOVAL_CONFIRMATION_REQUIRED";
      error.status = 409;
      error.details = { affected_score_rows: affectedScoreRows };
      throw error;
    }
    if (affectedScoredRows > 0 && body.confirm_scored_removal !== true) {
      const error = new Error(
        "This assessment has saved student scores. Confirm scored removal explicitly.",
      );
      error.code = "ASSESSMENT_SCORED_REMOVAL_CONFIRMATION_REQUIRED";
      error.status = 409;
      throw error;
    }
    if (affectedScoredRows > 0 && !requestedReason) {
      const error = new Error(
        "Explain why an assessment with saved scores is being removed.",
      );
      error.code = "ASSESSMENT_REMOVAL_REASON_REQUIRED";
      error.status = 400;
      throw error;
    }

    const nextVersion = expectedVersion + 1;
    if (!Number.isSafeInteger(nextVersion) || nextVersion > 4294967295) {
      const error = new Error("Assessment version limit reached.");
      error.code = "ASSESSMENT_VERSION_OVERFLOW";
      error.status = 409;
      throw error;
    }
    const reason = requestedReason || "Assessment removed during Draft.";

    const [updated] = await connection.execute(
      `UPDATE gradebook_assessments
          SET record_status = 'REMOVED',
              removed_at = CURRENT_TIMESTAMP(),
              removed_by_user_id = ?,
              record_version = ?,
              updated_at = CURRENT_TIMESTAMP()
        WHERE assessment_id = ?
          AND record_version = ?
          AND record_status = 'ACTIVE'`,
      [actorUserId, nextVersion, assessmentId, expectedVersion],
    );
    if (Number(updated.affectedRows) !== 1) {
      const error = new Error("Assessment was changed by another request.");
      error.code = "ASSESSMENT_VERSION_CONFLICT";
      error.status = 409;
      throw error;
    }

    const [removedRows] = await connection.execute(
      `SELECT removed_at
         FROM gradebook_assessments
        WHERE assessment_id = ?`,
      [assessmentId],
    );
    if (removedRows.length !== 1 || !removedRows[0].removed_at) {
      throw new Error("Removal timestamp was not saved.");
    }

    // Preserve the complete before/after structure in the same transaction.
    const [event] = await connection.execute(
      `INSERT INTO gradebook_assessment_events (
          assessment_id, event_type, change_context,
          previous_offering_category_id, previous_grading_term,
          previous_header_name, previous_maximum_score,
          previous_display_order, previous_record_status,
          new_offering_category_id, new_grading_term,
          new_header_name, new_maximum_score,
          new_display_order, new_record_status,
          new_removed_at, new_removed_by_user_id,
          affected_score_rows, affected_scored_rows,
          scored_removal_confirmed, change_reason,
          changed_by_user_id, assessment_version_after
        ) VALUES (
          ?, 'REMOVED', 'DRAFT_STRUCTURE',
          ?, ?, ?, ?, ?, 'ACTIVE',
          ?, ?, ?, ?, ?, 'REMOVED',
          ?, ?, ?, ?, ?, ?, ?, ?
        )`,
      [
        assessmentId,
        current.offering_category_id,
        current.grading_term,
        current.header_name,
        String(current.maximum_score),
        current.display_order,
        current.offering_category_id,
        current.grading_term,
        current.header_name,
        String(current.maximum_score),
        current.display_order,
        removedRows[0].removed_at,
        actorUserId,
        affectedScoreRows,
        affectedScoredRows,
        affectedScoredRows > 0 ? 1 : 0,
        reason,
        actorUserId,
        nextVersion,
      ],
    );
    if (Number(event.affectedRows) !== 1) {
      throw new Error("Removal audit event was not recorded.");
    }

    const result = {
      success: true,
      offering_id: offeringId,
      config_id: configId,
      assessment: {
        assessment_id: assessmentId,
        offering_category_id: Number(current.offering_category_id),
        grading_term: current.grading_term,
        category_code: current.category_code,
        header_name: current.header_name,
        maximum_score: String(current.maximum_score),
        display_order: Number(current.display_order),
        record_status: "REMOVED",
        record_version: nextVersion,
      },
      previous: {
        record_status: current.record_status,
        record_version: expectedVersion,
      },
      affected_score_rows: affectedScoreRows,
      affected_scored_rows: affectedScoredRows,
      scores_preserved: true,
      audit_event: "REMOVED",
      dry_run: body.dry_run,
      persisted: !body.dry_run,
    };

    if (body.dry_run) await connection.rollback();
    else await connection.commit();
    transactionStarted = false;

    return res.status(200).json(result);
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "GRADEBOOK ASSESSMENT REMOVAL ROLLBACK FAILED:",
          rollbackError,
        );
      }
    }
    return sendError(res, error);
  } finally {
    connection.release();
  }
});

// POST /api/gradebook/:offeringId/assessments/:assessmentId/restore
// Restore a Draft-only soft-removed assessment without rewriting historical scores.
router.post(
  "/:offeringId/assessments/:assessmentId/restore",
  async (req, res) => {
    const offeringId = positiveId(req.params.offeringId);
    const assessmentId = positiveId(req.params.assessmentId);
    if (!offeringId || !assessmentId) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ASSESSMENT_ID",
        message: "offeringId and assessmentId must be positive integers.",
      });
    }

    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ASSESSMENT_INPUT",
        message: "A JSON object is required.",
      });
    }

    const allowed = new Set(["record_version", "dry_run", "change_reason"]);
    if (Object.keys(body).some((key) => !allowed.has(key))) {
      return res.status(400).json({
        success: false,
        code: "UNSUPPORTED_ASSESSMENT_FIELD",
        message:
          "Restoration accepts record_version, dry_run and change_reason only.",
      });
    }

    const expectedVersion = positiveId(body.record_version);
    if (!expectedVersion || expectedVersion > 4294967295) {
      return res.status(400).json({
        success: false,
        code: "INVALID_RECORD_VERSION",
        message: "Provide the current positive record_version.",
      });
    }
    if (typeof body.dry_run !== "boolean") {
      return res.status(400).json({
        success: false,
        code: "DRY_RUN_REQUIRED",
        message: "Specify dry_run: true to test or dry_run: false to save.",
      });
    }
    if (typeof body.change_reason !== "string") {
      return res.status(400).json({
        success: false,
        code: "RESTORE_REASON_REQUIRED",
        message: "Provide a documented reason for restoring the assessment.",
      });
    }
    const changeReason = body.change_reason.trim();
    if (
      !changeReason ||
      Array.from(changeReason).length > 2000 ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(changeReason)
    ) {
      return res.status(400).json({
        success: false,
        code: "INVALID_CHANGE_REASON",
        message:
          "change_reason must be 1–2000 characters without control characters.",
      });
    }

    // Keep committed write tests isolated to Offering #131 in the admission-test database.
    if (!body.dry_run && offeringId !== 131) {
      return res.status(403).json({
        success: false,
        code: "TEST_OFFERING_ONLY",
        message: "Committed assessment testing is limited to Offering #131.",
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

    let connection;
    try {
      connection = await db.getConnection();
    } catch (error) {
      return sendError(res, error);
    }

    let transactionStarted = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;

      if (!body.dry_run) {
        const [databaseRows] = await connection.execute(
          "SELECT DATABASE() AS database_name",
        );
        if (
          databaseRows[0]?.database_name !== "databaseforptc1_admission_test"
        ) {
          const error = new Error(
            "Committed test is disabled outside the admission-test database.",
          );
          error.code = "TEST_DATABASE_ONLY";
          error.status = 403;
          throw error;
        }
      }

      // Serialize with all other assessment operations: offering -> config -> assessment -> scores.
      const [offerings] = await connection.execute(
        `SELECT so.offering_id, so.status,
              f.user_id AS assigned_user_id,
              u.is_active, u.is_archived, r.role_name
         FROM subject_offerings so
         LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
         LEFT JOIN users u ON u.user_id = f.user_id
         LEFT JOIN roles r ON r.role_id = u.role_id
        WHERE so.offering_id = ? FOR UPDATE`,
        [offeringId],
      );
      if (offerings.length !== 1) {
        const error = new Error("Subject offering was not found.");
        error.code = "OFFERING_NOT_FOUND";
        error.status = 404;
        throw error;
      }
      const offering = offerings[0];
      if (
        Number(offering.assigned_user_id) !== actorUserId ||
        Number(offering.is_active) !== 1 ||
        Number(offering.is_archived) !== 0 ||
        !["Faculty", "Program Head"].includes(offering.role_name)
      ) {
        const error = new Error(
          "Only the active assigned instructor can restore assessments.",
        );
        error.code = "GRADEBOOK_INSTRUCTOR_REQUIRED";
        error.status = 403;
        throw error;
      }
      if (offering.status !== "Open") {
        const error = new Error(
          "Assessment structure can only change in Open offerings.",
        );
        error.code = "OFFERING_NOT_OPEN";
        error.status = 409;
        throw error;
      }

      const [configs] = await connection.execute(
        "SELECT config_id FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE",
        [offeringId],
      );
      if (configs.length !== 1) {
        const error = new Error("This offering has no initialized gradebook.");
        error.code = "GRADEBOOK_NOT_INITIALIZED";
        error.status = 409;
        throw error;
      }
      const configId = Number(configs[0].config_id);
      const config = await loadGradebookOfferingConfig(connection, offeringId);
      if (!config.is_initialized || Number(config.config_id) !== configId) {
        const error = new Error(
          "Offering configuration failed policy validation.",
        );
        error.code = "GRADEBOOK_CONFIG_INVALID";
        error.status = 409;
        throw error;
      }

      const [assessments] = await connection.execute(
        `SELECT a.assessment_id, a.offering_category_id,
              a.grading_term, a.header_name, a.maximum_score,
              a.display_order, a.record_status, a.record_version,
              a.removed_at, a.removed_by_user_id, oc.category_code
         FROM gradebook_assessments a
         JOIN gradebook_offering_categories oc
           ON oc.offering_category_id = a.offering_category_id
        WHERE a.assessment_id = ? AND oc.config_id = ?
        FOR UPDATE`,
        [assessmentId, configId],
      );
      if (assessments.length !== 1) {
        const error = new Error("Assessment was not found in this offering.");
        error.code = "ASSESSMENT_NOT_FOUND";
        error.status = 404;
        throw error;
      }
      const current = assessments[0];
      await assertAssessmentTermEditable(
        connection,
        configId,
        offeringId,
        current.grading_term,
      );
      if (Number(current.record_version) !== expectedVersion) {
        const error = new Error(
          "Assessment has changed. Reload its latest version.",
        );
        error.code = "ASSESSMENT_VERSION_CONFLICT";
        error.status = 409;
        throw error;
      }
      if (current.record_status !== "REMOVED") {
        const error = new Error("Only a removed assessment can be restored.");
        error.code = "ASSESSMENT_NOT_REMOVED";
        error.status = 409;
        throw error;
      }
      if (!current.removed_at || !positiveId(current.removed_by_user_id)) {
        const error = new Error("Removed assessment metadata is incomplete.");
        error.code = "ASSESSMENT_REMOVAL_METADATA_INVALID";
        error.status = 409;
        throw error;
      }

      // Prevent restoring a duplicate name that was reused after the original removal.
      const [duplicates] = await connection.execute(
        `SELECT assessment_id
         FROM gradebook_assessments
        WHERE offering_category_id = ?
          AND grading_term = ?
          AND record_status = 'ACTIVE'
          AND LOWER(TRIM(header_name)) = LOWER(?)
        LIMIT 1`,
        [
          current.offering_category_id,
          current.grading_term,
          current.header_name,
        ],
      );
      if (duplicates.length) {
        const error = new Error(
          "An active assessment already uses this name in the category and term.",
        );
        error.code = "ASSESSMENT_NAME_EXISTS";
        error.status = 409;
        throw error;
      }

      // Lock existing score rows for a consistent audit snapshot. Restoration never edits them.
      const [scores] = await connection.execute(
        `SELECT score_id, score_status
         FROM gradebook_scores
        WHERE assessment_id = ?
        ORDER BY score_id FOR UPDATE`,
        [assessmentId],
      );
      const affectedScoreRows = scores.length;
      const affectedScoredRows = scores.filter(
        (score) => score.score_status === "SCORED",
      ).length;

      const nextVersion = expectedVersion + 1;
      if (!Number.isSafeInteger(nextVersion) || nextVersion > 4294967295) {
        const error = new Error("Assessment version limit reached.");
        error.code = "ASSESSMENT_VERSION_OVERFLOW";
        error.status = 409;
        throw error;
      }

      const [updated] = await connection.execute(
        `UPDATE gradebook_assessments
          SET record_status = 'ACTIVE',
              removed_at = NULL,
              removed_by_user_id = NULL,
              record_version = ?,
              updated_at = CURRENT_TIMESTAMP()
        WHERE assessment_id = ?
          AND record_version = ?
          AND record_status = 'REMOVED'`,
        [nextVersion, assessmentId, expectedVersion],
      );
      if (Number(updated.affectedRows) !== 1) {
        const error = new Error("Assessment was changed by another request.");
        error.code = "ASSESSMENT_VERSION_CONFLICT";
        error.status = 409;
        throw error;
      }

      // Capture the entire before/after state; leave removal metadata empty on ACTIVE.
      const [event] = await connection.execute(
        `INSERT INTO gradebook_assessment_events (
          assessment_id, event_type, change_context,
          previous_offering_category_id, previous_grading_term,
          previous_header_name, previous_maximum_score,
          previous_display_order, previous_record_status,
          new_offering_category_id, new_grading_term,
          new_header_name, new_maximum_score,
          new_display_order, new_record_status,
          affected_score_rows, affected_scored_rows,
          scored_removal_confirmed, change_reason,
          changed_by_user_id, assessment_version_after
        ) VALUES (
          ?, 'RESTORED', 'DRAFT_STRUCTURE',
          ?, ?, ?, ?, ?, 'REMOVED',
          ?, ?, ?, ?, ?, 'ACTIVE',
          ?, ?, 0, ?, ?, ?
        )`,
        [
          assessmentId,
          current.offering_category_id,
          current.grading_term,
          current.header_name,
          String(current.maximum_score),
          current.display_order,
          current.offering_category_id,
          current.grading_term,
          current.header_name,
          String(current.maximum_score),
          current.display_order,
          affectedScoreRows,
          affectedScoredRows,
          changeReason,
          actorUserId,
          nextVersion,
        ],
      );
      if (Number(event.affectedRows) !== 1) {
        throw new Error("Restoration audit event was not recorded.");
      }

      const result = {
        success: true,
        offering_id: offeringId,
        config_id: configId,
        assessment: {
          assessment_id: assessmentId,
          offering_category_id: Number(current.offering_category_id),
          grading_term: current.grading_term,
          category_code: current.category_code,
          header_name: current.header_name,
          maximum_score: String(current.maximum_score),
          display_order: Number(current.display_order),
          record_status: "ACTIVE",
          record_version: nextVersion,
        },
        previous: {
          record_status: "REMOVED",
          record_version: expectedVersion,
        },
        affected_score_rows: affectedScoreRows,
        affected_scored_rows: affectedScoredRows,
        scores_preserved: true,
        audit_event: "RESTORED",
        dry_run: body.dry_run,
        persisted: !body.dry_run,
      };

      if (body.dry_run) await connection.rollback();
      else await connection.commit();
      transactionStarted = false;

      return res.status(200).json(result);
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error(
            "GRADEBOOK ASSESSMENT RESTORE ROLLBACK FAILED:",
            rollbackError,
          );
        }
      }
      return sendError(res, error);
    } finally {
      connection.release();
    }
  },
);

export default router;
