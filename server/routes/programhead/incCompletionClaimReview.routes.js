import express from "express";
import db from "../../db.js";
import {
  readModernIncSource,
  reviewModernIncClaim,
} from "../../services/gradebookModernIncSource.service.js";
const router = express.Router();
const QA_DB = "databaseforptc1_admission_test";
const QA_OFFERING_ID = 131;
const MAX_RESULTS = 100;

function fail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function respondError(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
  if (status === 500) {
    console.error("PROGRAM HEAD INC COMPLETION REVIEW ERROR:", error);
  }
  return res.status(status).json({
    success: false,
    code:
      status === 500
        ? "INC_COMPLETION_REVIEW_INTERNAL_ERROR"
        : error.code || "INC_COMPLETION_REVIEW_FAILED",
    message:
      status === 500
        ? "Could not process INC completion review request."
        : error.message,
  });
}

function positiveInt(value) {
  if (typeof value === "boolean") return null;
  const raw = String(value ?? "");
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function claimId(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/.test(value))
    return null;
  if (BigInt(value) > 18446744073709551615n) return null;
  return value;
}

function noQueryParameters(req) {
  if (Object.keys(req.query || {}).length !== 0) {
    fail(
      "INC_COMPLETION_REVIEW_QUERY_UNSUPPORTED",
      "This endpoint does not accept query parameters.",
      400,
    );
  }
}

async function assertQaDatabase(connection) {
  const [[database]] = await connection.execute(
    "SELECT DATABASE() AS database_name",
  );
  if (database?.database_name !== QA_DB) {
    fail(
      "INC_COMPLETION_REVIEW_TEST_DATABASE_ONLY",
      "INC completion review is restricted to the admission-test database.",
      403,
    );
  }
}

// Verified INC Sheet Deadline
async function readVerifiedIncSheetDeadline(connection, sheet) {
  const verifiedFieldsPresent = Boolean(
    sheet &&
    ["IN_PROGRESS", "FINALIZED"].includes(sheet.sheet_status) &&
    sheet.original_official_submitted_on &&
    sheet.inc_completion_deadline_on &&
    String(sheet.official_submission_reference ?? "").trim() &&
    positiveInt(sheet.official_date_verified_by_user_id) &&
    sheet.official_date_verified_at,
  );

  if (!verifiedFieldsPresent) {
    return {
      deadline: null,
      verifiedFieldsPresent: false,
      auditValid: false,
    };
  }

  const [events] = await connection.execute(
    `SELECT event_type, previous_record_version, record_version_after,
            DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_date,
            official_submission_reference, performed_by_user_id
       FROM gradebook_official_sheet_submission_events
      WHERE sheet_id = ?
      ORDER BY record_version_after, event_id`,
    [String(sheet.sheet_id)],
  );

  const recorded = events[0];
  const verified = events[1];

  const auditValid =
    events.length === 2 &&
    recorded.event_type === "RECORDED" &&
    recorded.previous_record_version == null &&
    Number(recorded.record_version_after) === 1 &&
    Number(recorded.performed_by_user_id) > 0 &&
    verified.event_type === "VERIFIED" &&
    Number(verified.previous_record_version) === 1 &&
    Number(verified.record_version_after) === 2 &&
    Number(verified.performed_by_user_id) ===
      Number(sheet.official_date_verified_by_user_id) &&
    events.every(
      (event) =>
        event.original_date === sheet.original_official_submitted_on &&
        event.official_submission_reference ===
          sheet.official_submission_reference,
    );

  return {
    deadline: auditValid ? sheet.inc_completion_deadline_on : null,
    verifiedFieldsPresent: true,
    auditValid,
  };
}

async function activeProgramHead(connection, req) {
  const userId = positiveInt(req.user?.user_id);
  if (!userId) {
    fail(
      "INC_COMPLETION_REVIEW_AUTH_REQUIRED",
      "An authenticated Program Head is required.",
      401,
    );
  }

  // Confirm the actor is currently active and appointed for the department.
  const [rows] = await connection.execute(
    `SELECT DISTINCT ph.department_id
       FROM users u
       JOIN roles r ON r.role_id = u.role_id
       JOIN faculty f ON f.user_id = u.user_id
       JOIN program_heads ph ON ph.faculty_id = f.faculty_id
      WHERE u.user_id = ? AND r.role_name = 'Program Head'
        AND u.is_active = 1 AND u.is_archived = 0
        AND ph.is_active = 1
        AND (ph.start_date IS NULL OR ph.start_date <= CURDATE())
        AND (ph.end_date IS NULL OR ph.end_date >= CURDATE())`,
    [userId],
  );
  const departments = rows
    .map((row) => Number(row.department_id))
    .filter((id) => positiveInt(id) !== null);
  if (!departments.length) {
    fail(
      "INC_COMPLETION_ACTIVE_PROGRAM_HEAD_REQUIRED",
      "Only an active Program Head assigned to the offering's department may review this claim.",
      403,
    );
  }
  return { userId, departments };
}

const claimFrom = `
  FROM gradebook_inc_completion_claims cl
  JOIN grades g ON g.grade_id = cl.grade_id
  JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
  JOIN enrollments e ON e.enrollment_id = es.enrollment_id
  JOIN students s ON s.student_id = e.student_id
  JOIN subject_offerings so ON so.offering_id = es.offering_id
  JOIN gradebook_offering_config cfg ON cfg.offering_id = so.offering_id
  JOIN sections sec ON sec.section_id = so.section_id
  JOIN courses cr ON cr.course_id = sec.course_id`;

const claimSelect = `
  cl.claim_id, cl.grade_id, cl.grade_change_request_id,
  DATE_FORMAT(cl.claimed_completed_on, '%Y-%m-%d') AS claimed_completed_on,
  cl.evidence_summary, cl.verification_status,
  DATE_FORMAT(cl.verified_completed_on, '%Y-%m-%d') AS verified_completed_on,
  cl.verification_remarks, cl.submitted_by_user_id,
  cl.verified_by_user_id, cl.record_version,
  DATE_FORMAT(cl.submitted_at, '%Y-%m-%d %H:%i:%s') AS submitted_at,
  DATE_FORMAT(cl.verified_at, '%Y-%m-%d %H:%i:%s') AS verified_at,
  g.grade_status, g.grading_policy, g.grading_outcome, g.final_rating,
  g.faculty_id AS grade_faculty_id,
  es.enrollment_subject_id, es.status AS enrollment_subject_status,
  e.student_id, e.enrollment_status,
  s.student_number, s.first_name, s.middle_name, s.last_name,
  so.offering_id, so.faculty_id AS offering_faculty_id,
  cfg.config_id, cr.department_id`;

function formatClaim(row) {
  return {
    claim_id: String(row.claim_id),
    grade_id: Number(row.grade_id),
    grade_change_request_id:
      row.grade_change_request_id === null
        ? null
        : Number(row.grade_change_request_id),
    offering_id: Number(row.offering_id),
    config_id: Number(row.config_id),
    department_id: Number(row.department_id),
    enrollment_subject_id: Number(row.enrollment_subject_id),
    student_id: Number(row.student_id),
    student_number: row.student_number,
    student_name: [row.first_name, row.middle_name, row.last_name]
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join(" "),
    claimed_completed_on: row.claimed_completed_on,
    evidence_summary: row.evidence_summary,
    verification_status: row.verification_status,
    verified_completed_on: row.verified_completed_on,
    verification_remarks: row.verification_remarks,
    submitted_by_user_id: Number(row.submitted_by_user_id),
    verified_by_user_id:
      row.verified_by_user_id === null ? null : Number(row.verified_by_user_id),
    submitted_at: row.submitted_at,
    verified_at: row.verified_at,
    record_version: Number(row.record_version),
  };
}

// GET /api/program-head/gradebook/inc-completion-claims
// Default: pending claims only. A department head never sees other departments.
router.get("/", async (req, res) => {
  let connection;
  try {
    const queryFields = Object.keys(req.query || {});
    if (queryFields.some((key) => key !== "verification_status")) {
      fail(
        "INC_COMPLETION_REVIEW_QUERY_UNSUPPORTED",
        "Only verification_status is supported.",
        400,
      );
    }
    const verificationStatus =
      req.query.verification_status ?? "PENDING_VERIFICATION";
    const allowedStatuses = new Set([
      "PENDING_VERIFICATION",
      "VERIFIED_TIMELY",
      "VERIFIED_LATE",
      "REJECTED",
      "ALL",
    ]);
    if (
      typeof verificationStatus !== "string" ||
      !allowedStatuses.has(verificationStatus)
    ) {
      fail(
        "INC_COMPLETION_REVIEW_STATUS_INVALID",
        "Unsupported verification_status.",
        400,
      );
    }
    connection = await db.getConnection();
    const actor = await activeProgramHead(connection, req);
    const placeholders = actor.departments.map(() => "?").join(",");
    const statusWhere =
      verificationStatus === "ALL" ? "" : "AND cl.verification_status = ?";
    const values = [...actor.departments];

    if (verificationStatus !== "ALL") {
      values.push(verificationStatus);
    }

    const [rows] = await connection.execute(
      `SELECT ${claimSelect},
                 CASE
            WHEN EXISTS (
              SELECT 1
                FROM gradebook_official_grade_publications pub
               WHERE pub.grade_id = cl.grade_id
                 AND pub.config_id = cfg.config_id
                 AND pub.enrollment_subject_id = es.enrollment_subject_id
                 AND pub.publication_source = 'COMBINED_SEMESTER'
                 AND pub.grading_outcome_snapshot = 'INCOMPLETE'
                 AND pub.combined_submission_id IS NOT NULL
            ) THEN 'MODERN_COMBINED_INC'

            WHEN NOT EXISTS (
              SELECT 1
                FROM gradebook_official_grade_publications pub
               WHERE pub.grade_id = cl.grade_id
            )
            AND EXISTS (
              SELECT 1
                FROM gradebook_inc_outcome_requests inc
               WHERE inc.config_id = cfg.config_id
                 AND inc.enrollment_subject_id = es.enrollment_subject_id
                 AND inc.request_status = 'APPROVED'
            )
            AND EXISTS (
              SELECT 1
                FROM gradebook_official_sheets sheet
               WHERE sheet.config_id = cfg.config_id
                 AND sheet.sheet_status = 'FINALIZED'
            ) THEN 'HISTORICAL_INC'

            ELSE 'SOURCE_NOT_CLASSIFIED'
          END AS source_workflow

     ${claimFrom}

    WHERE cr.department_id IN (${placeholders})
      ${statusWhere}

    ORDER BY cl.submitted_at DESC, cl.claim_id DESC
    LIMIT ${MAX_RESULTS}`,
      values,
    );

    res.set("Cache-Control", "no-store");

    return res.json({
      success: true,
      read_only: true,
      reviewer_user_id: actor.userId,
      offering_scope: "ASSIGNED_DEPARTMENTS",
      offering_id: null,
      verification_status_filter: verificationStatus,
      count: rows.length,
      has_more: rows.length === MAX_RESULTS,
      claims: rows.map((row) => ({
        claim_id: String(row.claim_id),

        offering_id: Number(row.offering_id),

        source_workflow: row.source_workflow,

        review_readiness_supported:
          row.source_workflow === "MODERN_COMBINED_INC" ||
          (row.source_workflow === "HISTORICAL_INC" &&
            Number(row.offering_id) === QA_OFFERING_ID),

        grade_id: Number(row.grade_id),
        enrollment_subject_id: Number(row.enrollment_subject_id),
        student_id: Number(row.student_id),
        student_number: row.student_number,
        student_name: [row.first_name, row.middle_name, row.last_name]
          .map((p) => String(p ?? "").trim())
          .filter(Boolean)
          .join(" "),
        claimed_completed_on: row.claimed_completed_on,
        verification_status: row.verification_status,
        record_version: Number(row.record_version),
        submitted_at: row.submitted_at,
      })),
    });
  } catch (error) {
    return respondError(res, error);
  } finally {
    connection?.release();
  }
});

// GET /api/program-head/gradebook/inc-completion-claims/:claimId/review-readiness
// Read-only: reports eligibility, full audit history, and documented deadline state.
router.get("/:claimId/review-readiness", async (req, res) => {
  let connection;
  try {
    noQueryParameters(req);
    const requestedClaimId = claimId(req.params.claimId);
    if (!requestedClaimId) {
      fail(
        "INC_COMPLETION_REVIEW_ID_INVALID",
        "claimId must be a positive claim ID.",
        400,
      );
    }
    connection = await db.getConnection();

    const actor = await activeProgramHead(connection, req);
    const placeholders = actor.departments.map(() => "?").join(",");
    const [rows] = await connection.execute(
      `SELECT ${claimSelect} ${claimFrom}
    WHERE cl.claim_id = ?
      AND cr.department_id IN (${placeholders})`,
      [requestedClaimId, ...actor.departments],
    );
    if (rows.length !== 1) {
      fail(
        "INC_COMPLETION_REVIEW_CLAIM_NOT_FOUND",
        "Completion claim was not found in your assigned department.",
        404,
      );
    }
    const row = rows[0];
    const claim = formatClaim(row);
    const [events] = await connection.execute(
      `SELECT event_id, event_type, previous_status, new_status,
              DATE_FORMAT(previous_claimed_completed_on, '%Y-%m-%d') AS previous_claimed_completed_on,
              DATE_FORMAT(new_claimed_completed_on, '%Y-%m-%d') AS new_claimed_completed_on,
              DATE_FORMAT(previous_verified_completed_on, '%Y-%m-%d') AS previous_verified_completed_on,
              DATE_FORMAT(new_verified_completed_on, '%Y-%m-%d') AS new_verified_completed_on,
              previous_evidence_summary, new_evidence_summary,
              previous_verification_remarks, new_verification_remarks,
              event_reason, performed_by_user_id, claim_version_after,
              DATE_FORMAT(event_at, '%Y-%m-%d %H:%i:%s') AS event_at
         FROM gradebook_inc_completion_claim_events
        WHERE claim_id = ? ORDER BY claim_version_after, event_id`,
      [requestedClaimId],
    );
    // Identify the official source before choosing the readiness workflow.
    const [publications] = await connection.execute(
      `SELECT publication_source, config_id, enrollment_subject_id,
              grading_outcome_snapshot, combined_submission_id
         FROM gradebook_official_grade_publications
        WHERE grade_id = ?`,
      [claim.grade_id],
    );

    const publication = publications[0] ?? null;

    const isModernCombinedInc =
      publications.length === 1 &&
      publication.publication_source === "COMBINED_SEMESTER" &&
      Number(publication.config_id) === claim.config_id &&
      Number(publication.enrollment_subject_id) ===
        claim.enrollment_subject_id &&
      publication.grading_outcome_snapshot === "INCOMPLETE" &&
      publication.combined_submission_id !== null;

    if (isModernCombinedInc) {
      const blockers = [];
      const addBlocker = (code, message) => blockers.push({ code, message });

      const reviewWritesEnabled =
        process.env.GRADEBOOK_MODERN_INC_REVIEW_WRITES_ENABLED === "true";

      const [instructors] = await connection.execute(
        `SELECT f.user_id
       FROM faculty f
      WHERE f.faculty_id = ?`,
        [row.offering_faculty_id],
      );

      const instructorUserId =
        instructors.length === 1 ? positiveInt(instructors[0].user_id) : null;

      let source = null;

      if (!instructorUserId) {
        addBlocker(
          "MODERN_INC_INSTRUCTOR_MISSING",
          "The assigned instructor could not be verified.",
        );
      } else {
        try {
          source = await readModernIncSource(
            connection,
            {
              offeringId: claim.offering_id,
              enrollmentSubjectId: claim.enrollment_subject_id,
              actorUserId: instructorUserId,
            },
            { pilotOnly: false, readOnly: true },
          );
        } catch (error) {
          if (
            ![
              "MODERN_INC_SOURCE_INVALID",
              "GRADEBOOK_INSTRUCTOR_REQUIRED",
            ].includes(error?.code)
          ) {
            throw error;
          }

          addBlocker(
            "MODERN_INC_SOURCE_NOT_VERIFIED",
            "The original combined INC grade, publication, " +
              "finalized roster, or official-sheet evidence is inconsistent.",
          );
        }
      }

      // Claim Audit
      const created = events[0] ?? null;
      const latest = events.at(-1);

      const auditValid =
        events.length > 0 &&
        events.length === claim.record_version &&
        events.every(
          (event, index) => Number(event.claim_version_after) === index + 1,
        ) &&
        created.event_type === "CREATED" &&
        created.previous_status === null &&
        created.new_status === "PENDING_VERIFICATION" &&
        Number(created.claim_version_after) === 1 &&
        Number(created.performed_by_user_id) === claim.submitted_by_user_id &&
        created.new_claimed_completed_on === claim.claimed_completed_on &&
        created.new_evidence_summary === row.evidence_summary &&
        String(created.event_reason ?? "").trim().length >= 10 &&
        Number(latest.claim_version_after) === claim.record_version &&
        latest.new_status === claim.verification_status;

      if (!auditValid) {
        addBlocker(
          "INC_COMPLETION_AUDIT_INCONSISTENT",
          "Claim audit history does not match the stored claim.",
        );
      }

      if (
        claim.grade_change_request_id !== null ||
        !instructorUserId ||
        claim.submitted_by_user_id !== instructorUserId ||
        (source && Number(source.grade.grade_id) !== claim.grade_id)
      ) {
        addBlocker(
          "MODERN_INC_CLAIM_SOURCE_MISMATCH",
          "The claim is not linked to the original assigned instructor and INC grade.",
        );
      }

      if (
        (source && claim.claimed_completed_on > source.sheet.today) ||
        (claim.verification_status === "PENDING_VERIFICATION" &&
          (claim.verified_completed_on !== null ||
            claim.verified_by_user_id !== null ||
            row.verified_at !== null))
      ) {
        addBlocker(
          "MODERN_INC_CLAIM_STATE_INVALID",
          "The stored completion date or pending verification fields are inconsistent.",
        );
      }

      if (
        claim.verification_status === "PENDING_VERIFICATION" &&
        (claim.record_version !== 1 ||
          events.length !== 1 ||
          claim.verification_remarks !== null ||
          String(row.evidence_summary ?? "").trim().length < 10)
      ) {
        addBlocker(
          "MODERN_INC_INITIAL_CLAIM_INVALID",
          "Only the original, unchanged pending claim can receive its first review.",
        );
      }

      if (claim.verification_status !== "PENDING_VERIFICATION") {
        addBlocker(
          "INC_COMPLETION_CLAIM_NOT_PENDING",
          "Only pending claims can receive an initial review.",
        );
      }

      // Legacy Grade-Change Conflicts
      const [conflictingRequests] = await connection.execute(
        `SELECT grade_change_request_id
       FROM grade_change_requests
      WHERE grade_id = ?
        AND status IN (
          'Pending Program Head',
          'For Registrar Processing'
        )
      LIMIT 1`,
        [claim.grade_id],
      );

      if (conflictingRequests.length) {
        addBlocker(
          "INC_COMPLETION_LEGACY_REQUEST_PENDING",
          "A separate pending grade-change request requires reconciliation.",
        );
      }

      // Readiness reports write availability, but never performs a write.
      if (!reviewWritesEnabled) {
        addBlocker(
          "MODERN_INC_REVIEW_WRITES_DISABLED",
          "Program Head INC claim reviews are not enabled on this server.",
        );
      }

      const deadline = source?.sheet.deadline ?? null;
      const canReview = blockers.length === 0;

      const claimedDateComparison = deadline
        ? claim.claimed_completed_on <= deadline
          ? "CLAIMED_ON_OR_BEFORE_DEADLINE"
          : "CLAIMED_AFTER_DEADLINE"
        : null;

      res.set("Cache-Control", "no-store");

      return res.json({
        success: true,
        read_only: true,

        source_workflow: source ? "MODERN_COMBINED_INC" : "SOURCE_NOT_VERIFIED",

        reviewer_user_id: actor.userId,
        claim,
        source_verified: source !== null,

        source: source
          ? {
              publication_source: source.publication.publication_source,

              publication_id: String(source.publication.publication_id),

              combined_submission_id: String(source.attempt.submission_id),

              roster_snapshot_id: String(source.original.roster_snapshot_id),

              special_outcome_id: String(source.attempt.special_outcome_id),
            }
          : null,

        official_grade: {
          grade_id: claim.grade_id,
          grade_status: row.grade_status,
          grading_outcome: row.grading_outcome,
          final_rating: String(row.final_rating),
        },

        initial_completion_reason: created?.event_reason ?? null,

        official_sheet: {
          sheet_id: source ? String(source.sheet.sheet_id) : null,

          original_official_submitted_on: source?.sheet.original_date ?? null,

          deadline_established: deadline !== null,
          inc_completion_deadline_on: deadline,
        },

        claimed_date_comparison_only: claimedDateComparison,

        review: {
          can_review: canReview,
          can_reject: canReview,
          can_verify: canReview && deadline !== null,

          blockers,
          verification_blockers: [],

          note:
            "Readiness is not proof of completion. " +
            "Review requires actual evidence, a verified completion date, " +
            "and a separate protected write request.",
        },

        audit_events: events.map((event) => ({
          ...event,
          event_id: String(event.event_id),
          claim_version_after: Number(event.claim_version_after),
          performed_by_user_id: Number(event.performed_by_user_id),
        })),
      });
    }
    const [sheets] = await connection.execute(
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
      [claim.config_id],
    );
    if (sheets.length > 1) {
      fail(
        "INC_COMPLETION_REVIEW_SHEET_DUPLICATE",
        "Duplicate official grading sheets were found.",
      );
    }
    const [outcomes] = await connection.execute(
      `SELECT inc_request_id, request_status, submitted_by_user_id
         FROM gradebook_inc_outcome_requests
        WHERE config_id = ? AND enrollment_subject_id = ?`,
      [claim.config_id, claim.enrollment_subject_id],
    );
    const blockers = [];
    const verificationBlockers = [];
    const addBlocker = (code, message) => blockers.push({ code, message });
    const addVerificationBlocker = (code, message) =>
      verificationBlockers.push({ code, message });

    if (claim.grade_change_request_id !== null) {
      addBlocker(
        "INC_COMPLETION_LEGACY_LINKED",
        "The claim is linked to a legacy grade-change request requiring reconciliation.",
      );
    }
    const [legacyRequests] = await connection.execute(
      `SELECT grade_change_request_id FROM grade_change_requests
        WHERE grade_id = ? AND request_type = 'INC_COMPLETION'
          AND status IN ('Pending Program Head', 'For Registrar Processing')`,
      [claim.grade_id],
    );
    if (legacyRequests.length) {
      addBlocker(
        "INC_COMPLETION_LEGACY_REQUEST_PENDING",
        "A separate pending INC completion request requires reconciliation.",
      );
    }
    if (claim.verification_status !== "PENDING_VERIFICATION") {
      addBlocker(
        "INC_COMPLETION_CLAIM_NOT_PENDING",
        "Only pending claims can receive an initial review.",
      );
    }
    if (
      row.grade_status !== "Approved" ||
      row.grading_policy !== "TWO_TERM_50_50" ||
      row.grading_outcome !== "INCOMPLETE" ||
      Number(row.final_rating) !== 4
    ) {
      addBlocker(
        "INC_COMPLETION_OFFICIAL_GRADE_CHANGED",
        "The official grade is no longer an Approved INC 4.00 grade.",
      );
    }
    if (Number(row.grade_faculty_id) !== Number(row.offering_faculty_id)) {
      addBlocker(
        "INC_COMPLETION_GRADE_FACULTY_MISMATCH",
        "Official grade ownership requires reconciliation.",
      );
    }
    if (
      row.enrollment_status !== "Approved" ||
      row.enrollment_subject_status !== "Incomplete"
    ) {
      addBlocker(
        "INC_COMPLETION_STUDENT_STATUS_CHANGED",
        "Approved enrollment and Incomplete subject status are required.",
      );
    }
    if (outcomes.length !== 1 || outcomes[0].request_status !== "APPROVED") {
      addBlocker(
        "INC_COMPLETION_APPROVED_OUTCOME_REQUIRED",
        "The INC outcome request must still be approved.",
      );
    }
    const created = events.find(
      (event) =>
        event.event_type === "CREATED" &&
        Number(event.claim_version_after) === 1,
    );
    const last = events.at(-1);
    if (
      !created ||
      !last ||
      Number(last.claim_version_after) !== claim.record_version ||
      last.new_status !== claim.verification_status
    ) {
      addBlocker(
        "INC_COMPLETION_AUDIT_INCONSISTENT",
        "Claim audit history is missing or does not match its current version.",
      );
    }
    const sheet = sheets[0] ?? null;

    const sheetVerification = await readVerifiedIncSheetDeadline(
      connection,
      sheet,
    );

    const deadline = sheetVerification.deadline;

    if (!sheetVerification.verifiedFieldsPresent) {
      addVerificationBlocker(
        "INC_COMPLETION_DEADLINE_UNVERIFIED",
        "Registrar must record the original grading-sheet date, and the Program Head must verify it before a timely/late decision.",
      );
    } else if (!sheetVerification.auditValid) {
      addVerificationBlocker(
        "INC_COMPLETION_SHEET_AUDIT_INVALID",
        "The original sheet date or reference does not match the RECORDED and VERIFIED audit events.",
      );
    }
    const canReview = blockers.length === 0;
    const canVerify = canReview && verificationBlockers.length === 0;
    const claimDateComparison =
      deadline === null
        ? null
        : claim.claimed_completed_on <= deadline
          ? "CLAIMED_ON_OR_BEFORE_DEADLINE"
          : "CLAIMED_AFTER_DEADLINE";

    return res.json({
      success: true,
      read_only: true,
      reviewer_user_id: actor.userId,
      claim,
      official_grade: {
        grade_id: claim.grade_id,
        grade_status: row.grade_status,
        grading_outcome: row.grading_outcome,
        final_rating: String(row.final_rating),
      },
      initial_completion_reason: created?.event_reason ?? null,
      official_sheet: {
        sheet_id: sheet ? String(sheet.sheet_id) : null,
        original_official_submitted_on:
          sheet?.original_official_submitted_on ?? null,
        official_date_verified_by_user_id:
          sheet?.official_date_verified_by_user_id ?? null,
        deadline_established: deadline !== null,
        inc_completion_deadline_on: deadline,
      },
      claimed_date_comparison_only: claimDateComparison,
      review: {
        can_review: canReview,
        can_reject: canReview,
        can_verify: canVerify,
        blockers,
        verification_blockers: verificationBlockers,
        note: "A claimed completion date is not proof. Verification must confirm actual evidence and a genuine completion date. This endpoint never changes the grade.",
      },
      audit_events: events.map((event) => ({
        ...event,
        event_id: String(event.event_id),
        claim_version_after: Number(event.claim_version_after),
        performed_by_user_id: Number(event.performed_by_user_id),
      })),
    });
  } catch (error) {
    return respondError(res, error);
  } finally {
    connection?.release();
  }
});

// POST /api/program-head/gradebook/inc-completion-claims/:claimId/verify
// POST /api/program-head/gradebook/inc-completion-claims/:claimId/reject
// A verified date is an attested fact; the calculated deadline never substitutes for evidence.
// Both actions support an actual transaction rollback via dry_run: true.
function decisionBody(body, decision) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail(
      "INC_COMPLETION_REVIEW_BODY_INVALID",
      "A JSON object is required.",
      400,
    );
  }
  const fields =
    decision === "VERIFY"
      ? [
          "expected_grade_id",
          "expected_record_version",
          "verified_completed_on",
          "verification_remarks",
          "confirm_verified_completion_evidence",
          "dry_run",
        ]
      : [
          "expected_grade_id",
          "expected_record_version",
          "verification_remarks",
          "dry_run",
        ];
  const extra = Object.keys(body).filter((key) => !fields.includes(key));
  if (extra.length) {
    fail(
      "INC_COMPLETION_REVIEW_FIELDS_UNSUPPORTED",
      `Unsupported field(s): ${extra.join(", ")}.`,
      400,
    );
  }
  const expectedGradeId = positiveInt(body.expected_grade_id);
  const version = positiveInt(body.expected_record_version);
  if (!expectedGradeId || !version || version > 4294967294) {
    fail(
      "INC_COMPLETION_REVIEW_EXPECTED_STATE_INVALID",
      "A valid expected_grade_id and expected_record_version are required.",
      400,
    );
  }
  if (typeof body.dry_run !== "boolean") {
    fail(
      "INC_COMPLETION_REVIEW_DRY_RUN_REQUIRED",
      "dry_run must be true or false.",
      400,
    );
  }
  if (typeof body.verification_remarks !== "string") {
    fail(
      "INC_COMPLETION_REVIEW_REMARKS_REQUIRED",
      "Document the review decision in verification_remarks.",
      400,
    );
  }
  const remarks = body.verification_remarks.trim();
  if (
    remarks.length < 15 ||
    remarks.length > 2000 ||
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(remarks)
  ) {
    fail(
      "INC_COMPLETION_REVIEW_REMARKS_INVALID",
      "verification_remarks must contain 15–2000 printable characters.",
      400,
    );
  }
  let verifiedDate = null;
  if (decision === "VERIFY") {
    if (body.confirm_verified_completion_evidence !== true) {
      fail(
        "INC_COMPLETION_REVIEW_EVIDENCE_CONFIRMATION_REQUIRED",
        "The reviewer must confirm the completion date against real supporting evidence.",
        400,
      );
    }
    verifiedDate = body.verified_completed_on;
    if (
      typeof verifiedDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(verifiedDate)
    ) {
      fail(
        "INC_COMPLETION_REVIEW_DATE_INVALID",
        "verified_completed_on must be YYYY-MM-DD.",
        400,
      );
    }
    const [y, m, d] = verifiedDate.split("-").map(Number);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    if (
      y < 1000 ||
      !Number.isFinite(parsed.getTime()) ||
      parsed.getUTCFullYear() !== y ||
      parsed.getUTCMonth() !== m - 1 ||
      parsed.getUTCDate() !== d
    ) {
      fail(
        "INC_COMPLETION_REVIEW_DATE_INVALID",
        "verified_completed_on must be a real calendar date.",
        400,
      );
    }
  }
  return {
    expectedGradeId,
    expectedVersion: version,
    remarks,
    verifiedDate,
    dryRun: body.dry_run,
  };
}

async function processDecision(req, res, decision) {
  let connection;
  let inTransaction = false;
  try {
    noQueryParameters(req);
    const requestedClaimId = claimId(req.params.claimId);
    if (!requestedClaimId) {
      fail(
        "INC_COMPLETION_REVIEW_ID_INVALID",
        "claimId must be a positive claim ID.",
        400,
      );
    }
    const input = decisionBody(req.body, decision);
    connection = await db.getConnection();
    await connection.beginTransaction();
    inTransaction = true;
    const actor = await activeProgramHead(connection, req);

    // Locate first without exposing details from other departments or offerings.
    // The complete scope is rechecked after acquiring write locks.
    const [previews] = await connection.execute(
      `SELECT cl.claim_id, g.enrollment_subject_id, so.offering_id, cfg.config_id, cr.department_id
         FROM gradebook_inc_completion_claims cl
         JOIN grades g ON g.grade_id = cl.grade_id
         JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
         JOIN subject_offerings so ON so.offering_id = es.offering_id
         JOIN gradebook_offering_config cfg ON cfg.offering_id = so.offering_id
         JOIN sections sec ON sec.section_id = so.section_id
         JOIN courses cr ON cr.course_id = sec.course_id
        WHERE cl.claim_id = ?`,
      [requestedClaimId],
    );
    // Modern INC review
    const modernPreview = previews.length === 1 ? previews[0] : null;

    // Confirm that the Program Head belongs to the claim's department.
    if (
      !modernPreview ||
      !actor.departments.includes(Number(modernPreview.department_id))
    ) {
      fail(
        "INC_COMPLETION_REVIEW_CLAIM_NOT_FOUND",
        "Completion claim was not found in your assigned department.",
        404,
      );
    }

    // Identify modern INC claims using their official publication.
    const [modernPublications] = await connection.execute(
      `SELECT pub.publication_id
     FROM gradebook_inc_completion_claims cl
     JOIN gradebook_official_grade_publications pub
       ON pub.grade_id = cl.grade_id
    WHERE cl.claim_id = ?
      AND pub.config_id = ?
      AND pub.enrollment_subject_id = ?
      AND pub.publication_source = 'COMBINED_SEMESTER'
      AND pub.grading_outcome_snapshot = 'INCOMPLETE'
      AND pub.combined_submission_id IS NOT NULL
    LIMIT 1`,
      [
        requestedClaimId,
        modernPreview.config_id,
        modernPreview.enrollment_subject_id,
      ],
    );

    if (modernPublications.length > 0) {
      // Committed modern INC reviews require explicit rollout approval.
      if (
        input.dryRun !== true &&
        process.env.GRADEBOOK_MODERN_INC_REVIEW_WRITES_ENABLED !== "true"
      ) {
        fail(
          "MODERN_INC_REVIEW_WRITES_DISABLED",
          "Program Head INC claim review writes are not enabled on this server.",
          403,
        );
      }
      const result = await reviewModernIncClaim(
        connection,
        actor,
        previews[0],
        requestedClaimId,
        input,
        decision,
      );

      if (input.dryRun) {
        await connection.rollback();
      } else {
        await connection.commit();
      }

      inTransaction = false;

      return res.status(200).json(result);
    }

    // Prevent unsupported publications from entering historical review.
    const [otherPublications] = await connection.execute(
      `SELECT pub.publication_id
         FROM gradebook_inc_completion_claims cl
         JOIN gradebook_official_grade_publications pub
           ON pub.grade_id = cl.grade_id
        WHERE cl.claim_id = ? LIMIT 1`,
      [requestedClaimId],
    );

    if (otherPublications.length > 0) {
      fail(
        "INC_COMPLETION_REVIEW_SOURCE_UNSUPPORTED",
        "This claim's official publication cannot use the historical INC review workflow.",
        409,
      );
    }

    // Historical INC decisions remain restricted to the QA source.
    await assertQaDatabase(connection);

    if (
      previews.length !== 1 ||
      Number(previews[0].offering_id) !== QA_OFFERING_ID ||
      !actor.departments.includes(Number(previews[0].department_id))
    ) {
      fail(
        "INC_COMPLETION_REVIEW_CLAIM_NOT_FOUND",
        "Completion claim was not found in your assigned department.",
        404,
      );
    }
    const preview = previews[0];

    // Same lock order as Faculty claim creation: offering -> config -> student
    // -> official grade -> outcome -> official sheet -> claim -> claim events.
    const [offerings] = await connection.execute(
      `SELECT so.offering_id, so.faculty_id, cr.department_id
         FROM subject_offerings so
         JOIN sections sec ON sec.section_id = so.section_id
         JOIN courses cr ON cr.course_id = sec.course_id
        WHERE so.offering_id = ? FOR UPDATE`,
      [QA_OFFERING_ID],
    );
    if (
      offerings.length !== 1 ||
      !actor.departments.includes(Number(offerings[0].department_id))
    ) {
      fail(
        "INC_COMPLETION_REVIEW_CLAIM_NOT_FOUND",
        "Completion claim was not found in your assigned department.",
        404,
      );
    }
    const [configs] = await connection.execute(
      "SELECT config_id FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE",
      [QA_OFFERING_ID],
    );
    if (
      configs.length !== 1 ||
      Number(configs[0].config_id) !== Number(preview.config_id)
    ) {
      fail(
        "INC_COMPLETION_REVIEW_SCOPE_CHANGED",
        "Gradebook configuration changed. Reload the review.",
      );
    }
    const configId = Number(configs[0].config_id);
    const [students] = await connection.execute(
      `SELECT es.enrollment_subject_id, es.offering_id,
              es.status AS enrollment_subject_status, e.enrollment_status
         FROM enrollment_subjects es
         JOIN enrollments e ON e.enrollment_id = es.enrollment_id
        WHERE es.enrollment_subject_id = ? FOR UPDATE`,
      [preview.enrollment_subject_id],
    );
    if (
      students.length !== 1 ||
      Number(students[0].offering_id) !== QA_OFFERING_ID ||
      students[0].enrollment_status !== "Approved" ||
      students[0].enrollment_subject_status !== "Incomplete"
    ) {
      fail(
        "INC_COMPLETION_REVIEW_STUDENT_INELIGIBLE",
        "The student is no longer an Approved enrollment with an Incomplete subject.",
      );
    }
    const [grades] = await connection.execute(
      `SELECT grade_id, grade_status, grading_policy, grading_outcome, final_rating, faculty_id
         FROM grades WHERE enrollment_subject_id = ? FOR UPDATE`,
      [preview.enrollment_subject_id],
    );
    if (
      grades.length !== 1 ||
      Number(grades[0].grade_id) !== input.expectedGradeId ||
      grades[0].grade_status !== "Approved" ||
      grades[0].grading_policy !== "TWO_TERM_50_50" ||
      grades[0].grading_outcome !== "INCOMPLETE" ||
      Number(grades[0].final_rating) !== 4 ||
      Number(grades[0].faculty_id) !== Number(offerings[0].faculty_id)
    ) {
      fail(
        "INC_COMPLETION_REVIEW_OFFICIAL_GRADE_CHANGED",
        "The official grade or instructor assignment changed. Reload the review.",
      );
    }
    const [outcomes] = await connection.execute(
      `SELECT inc_request_id, request_status
         FROM gradebook_inc_outcome_requests
        WHERE config_id = ? AND enrollment_subject_id = ? FOR UPDATE`,
      [configId, preview.enrollment_subject_id],
    );
    if (publications.length !== 0 || claim.offering_id !== QA_OFFERING_ID) {
      fail(
        "INC_COMPLETION_REVIEW_SOURCE_UNSUPPORTED",
        "This claim has no supported official INC publication source.",
        409,
      );
    }
    const [sheets] = await connection.execute(
      `SELECT sheet_id, sheet_status,
              DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_official_submitted_on,
              official_submission_reference, official_date_verified_by_user_id, official_date_verified_at,
              CASE WHEN original_official_submitted_on IS NOT NULL
                         AND official_date_verified_by_user_id IS NOT NULL
                         AND official_date_verified_at IS NOT NULL
                   THEN DATE_FORMAT(DATE_ADD(original_official_submitted_on, INTERVAL 1 YEAR), '%Y-%m-%d')
                   ELSE NULL END AS inc_completion_deadline_on
         FROM gradebook_official_sheets WHERE config_id = ? FOR UPDATE`,
      [configId],
    );
    if (sheets.length > 1) {
      fail(
        "INC_COMPLETION_REVIEW_SHEET_DUPLICATE",
        "Multiple official grading sheets exist for this offering.",
      );
    }
    const sheet = sheets[0] ?? null;

    const [claims] = await connection.execute(
      `SELECT cl.claim_id, cl.grade_id, cl.grade_change_request_id,
              DATE_FORMAT(cl.claimed_completed_on, '%Y-%m-%d') AS claimed_completed_on,
              cl.evidence_summary, cl.verification_status,
              DATE_FORMAT(cl.verified_completed_on, '%Y-%m-%d') AS verified_completed_on,
              cl.verification_remarks, cl.verified_by_user_id,
              cl.record_version
         FROM gradebook_inc_completion_claims cl WHERE cl.claim_id = ? FOR UPDATE`,
      [requestedClaimId],
    );
    if (
      claims.length !== 1 ||
      Number(claims[0].grade_id) !== input.expectedGradeId
    ) {
      fail(
        "INC_COMPLETION_REVIEW_CLAIM_CHANGED",
        "The claim changed or no longer matches the official grade.",
      );
    }
    const claim = claims[0];
    if (claim.verification_status !== "PENDING_VERIFICATION") {
      fail(
        "INC_COMPLETION_REVIEW_ALREADY_DECIDED",
        "Only pending completion claims may be verified or rejected.",
      );
    }
    if (Number(claim.record_version) !== input.expectedVersion) {
      fail(
        "INC_COMPLETION_REVIEW_VERSION_CONFLICT",
        "The completion claim was updated by another request. Reload its review readiness.",
      );
    }
    if (
      claim.verified_completed_on !== null ||
      claim.verified_by_user_id !== null
    ) {
      fail(
        "INC_COMPLETION_REVIEW_STATE_INCONSISTENT",
        "Pending claim contains previous verification details and must be reconciled.",
      );
    }
    if (claim.grade_change_request_id !== null) {
      fail(
        "INC_COMPLETION_REVIEW_LEGACY_LINKED",
        "A linked legacy grade-change request requires Registrar reconciliation.",
      );
    }
    const [legacy] = await connection.execute(
      `SELECT grade_change_request_id
         FROM grade_change_requests
        WHERE grade_id = ? AND request_type = 'INC_COMPLETION'
          AND status IN ('Pending Program Head', 'For Registrar Processing') FOR UPDATE`,
      [claim.grade_id],
    );
    if (legacy.length) {
      fail(
        "INC_COMPLETION_REVIEW_LEGACY_REQUEST_PENDING",
        "A legacy INC completion change request must be reconciled first.",
      );
    }
    const [history] = await connection.execute(
      `SELECT event_id, event_type, previous_status, new_status, claim_version_after
         FROM gradebook_inc_completion_claim_events
        WHERE claim_id = ? ORDER BY claim_version_after DESC, event_id DESC LIMIT 1 FOR UPDATE`,
      [requestedClaimId],
    );
    const last = history[0];
    if (
      !last ||
      Number(last.claim_version_after) !== input.expectedVersion ||
      last.new_status !== "PENDING_VERIFICATION" ||
      !["CREATED", "UPDATED", "REOPENED"].includes(last.event_type)
    ) {
      fail(
        "INC_COMPLETION_REVIEW_AUDIT_INCONSISTENT",
        "Claim audit version does not match its pending state.",
      );
    }
    const [initial] = await connection.execute(
      `SELECT event_id FROM gradebook_inc_completion_claim_events
        WHERE claim_id = ? AND event_type = 'CREATED' AND claim_version_after = 1 LIMIT 1 FOR UPDATE`,
      [requestedClaimId],
    );
    if (initial.length !== 1) {
      fail(
        "INC_COMPLETION_REVIEW_AUDIT_INCONSISTENT",
        "The claim's original submission audit is missing.",
      );
    }

    let nextStatus = "REJECTED";

    const sheetVerification = await readVerifiedIncSheetDeadline(
      connection,
      sheet,
    );

    const deadline = sheetVerification.deadline;
    const [[clock]] = await connection.execute(
      "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today",
    );
    if (decision === "VERIFY") {
      if (!sheetVerification.verifiedFieldsPresent) {
        fail(
          "INC_COMPLETION_REVIEW_DEADLINE_UNVERIFIED",
          "Registrar must record the original sheet date and reference; the Program Head must verify them first.",
        );
      }

      if (!sheetVerification.auditValid) {
        fail(
          "INC_COMPLETION_REVIEW_SHEET_AUDIT_INVALID",
          "Original official-sheet verification does not match its preserved RECORDED and VERIFIED audit events.",
        );
      }
      if (input.verifiedDate > clock.today) {
        fail(
          "INC_COMPLETION_REVIEW_FUTURE_DATE",
          "The verified completion date cannot be in the future.",
          422,
        );
      }
      nextStatus =
        input.verifiedDate <= deadline ? "VERIFIED_TIMELY" : "VERIFIED_LATE";
    }

    const [updated] = await connection.execute(
      `UPDATE gradebook_inc_completion_claims
          SET verification_status = ?, verified_completed_on = ?,
              verification_remarks = ?, verified_by_user_id = ?, verified_at = NOW(),
              record_version = record_version + 1, updated_at = NOW()
        WHERE claim_id = ? AND grade_id = ? AND record_version = ?
          AND verification_status = 'PENDING_VERIFICATION'`,
      [
        nextStatus,
        input.verifiedDate,
        input.remarks,
        actor.userId,
        requestedClaimId,
        input.expectedGradeId,
        input.expectedVersion,
      ],
    );
    if (Number(updated.affectedRows) !== 1) {
      fail(
        "INC_COMPLETION_REVIEW_VERSION_CONFLICT",
        "The claim changed during verification. Reload its review readiness.",
      );
    }
    const [audit] = await connection.execute(
      `INSERT INTO gradebook_inc_completion_claim_events
         (claim_id, event_type, previous_status, new_status,
          previous_claimed_completed_on, new_claimed_completed_on,
          previous_verified_completed_on, new_verified_completed_on,
          previous_evidence_summary, new_evidence_summary,
          previous_verification_remarks, new_verification_remarks,
          event_reason, performed_by_user_id, claim_version_after)
       VALUES (?, ?, 'PENDING_VERIFICATION', ?,
               ?, ?,
               ?, ?,
               ?, ?,
               ?, ?,
               ?, ?, ?)`,
      [
        requestedClaimId,
        decision === "VERIFY" ? "VERIFIED" : "REJECTED",
        nextStatus,
        claim.claimed_completed_on,
        claim.claimed_completed_on,
        claim.verified_completed_on,
        input.verifiedDate,
        claim.evidence_summary,
        claim.evidence_summary,
        claim.verification_remarks,
        input.remarks,
        input.remarks,
        actor.userId,
        input.expectedVersion + 1,
      ],
    );
    if (Number(audit.affectedRows) !== 1) {
      throw new Error("INC completion review event was not inserted.");
    }
    if (input.dryRun) await connection.rollback();
    else await connection.commit();
    inTransaction = false;

    return res.status(200).json({
      success: true,
      decision,
      dry_run: input.dryRun,
      persisted: !input.dryRun,
      reviewer_user_id: actor.userId,
      offering_id: QA_OFFERING_ID,
      claim: {
        claim_id: requestedClaimId,
        grade_id: input.expectedGradeId,
        previous_status: "PENDING_VERIFICATION",
        verification_status: nextStatus,
        claimed_completed_on: claim.claimed_completed_on,
        verified_completed_on: input.verifiedDate,
        verification_remarks: input.remarks,
        verified_by_user_id: actor.userId,
        previous_record_version: input.expectedVersion,
        record_version: input.expectedVersion + 1,
      },
      official_sheet: {
        sheet_id: sheet ? String(sheet.sheet_id) : null,
        deadline_established: deadline !== null,
        inc_completion_deadline_on: deadline,
      },
      audit_event: decision === "VERIFY" ? "VERIFIED" : "REJECTED",
      audit_event_id: input.dryRun ? null : String(audit.insertId),
      official_grade_unchanged: true,
      grade_conversion_performed: false,
      note: input.dryRun
        ? "Claim and review event were rolled back; official grade and sheet were unchanged."
        : "The claim review and audit event were saved. The official INC grade was not converted.",
    });
  } catch (error) {
    if (inTransaction && connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("INC COMPLETION REVIEW ROLLBACK:", rollbackError);
      }
    }
    if (
      ["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(
        error?.code,
      )
    ) {
      return respondError(res, {
        status: 409,
        code: "INC_COMPLETION_REVIEW_CONFLICT",
        message: "Concurrent claim or audit update detected. Reload and retry.",
      });
    }
    return respondError(res, error);
  } finally {
    connection?.release();
  }
}

router.post("/:claimId/verify", (req, res) =>
  processDecision(req, res, "VERIFY"),
);
router.post("/:claimId/reject", (req, res) =>
  processDecision(req, res, "REJECT"),
);

export default router;
