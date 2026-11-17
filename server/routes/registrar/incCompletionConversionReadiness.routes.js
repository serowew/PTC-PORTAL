import express from "express";
import db from "../../db.js";
import { processModernIncConversion } from "../../services/gradebookModernIncSource.service.js";
import { calculateGradePreview } from "../gradebookRoster.routes.js";
import { inspectModernIncExpiryReadiness } from "../../services/gradebookModernIncExpiryReadiness.service.js";
import { processModernIncExpiry } from "../../services/gradebookModernIncExpiryProcess.service.js";
import { processModernScoreCorrection } from "../../services/gradebookModernScoreCorrections.service.js";
import { assertQaGradingDatabase } from "../../services/gradebookQaWriteGuard.service.js";
const router = express.Router();
const QA_DATABASE = "databaseforptc1_admission_test";
const QA_OFFERING_ID = 131;

function requestError(status, code, message) {
  const error = new Error(message);
  error.httpStatus = status;
  error.code = code;
  throw error;
}

function sendError(res, error) {
  const status =
    Number.isInteger(error?.httpStatus) &&
    error.httpStatus >= 400 &&
    error.httpStatus < 500
      ? error.httpStatus
      : Number.isInteger(error?.status) &&
          error.status >= 400 &&
          error.status < 500
        ? error.status
        : 500;
  if (status === 500)
    console.error("REGISTRAR INC CONVERSION READINESS:", error);
  return res.status(status).json({
    success: false,
    code: status === 500 ? "INC_CONVERSION_READINESS_ERROR" : error.code,
    message:
      status === 500
        ? "Could not inspect INC conversion readiness."
        : error.message,
  });
}

function positiveId(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value);
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function assertTestDatabase(connection) {
  const [[row]] = await connection.execute(
    "SELECT DATABASE() AS current_database",
  );
  if (row?.current_database !== QA_DATABASE) {
    requestError(
      403,
      "INC_CONVERSION_TEST_DATABASE_ONLY",
      "INC conversion readiness is limited to the admission-test database.",
    );
  }
}

async function activeRegistrar(connection, req) {
  const userId = positiveId(req.user?.user_id);
  if (!userId) {
    requestError(
      401,
      "INC_CONVERSION_AUTH_REQUIRED",
      "Registrar authentication is required.",
    );
  }
  const [rows] = await connection.execute(
    `SELECT u.user_id
       FROM users u JOIN roles r ON r.role_id = u.role_id
      WHERE u.user_id = ? AND r.role_name = 'Registrar'
        AND u.is_active = 1 AND u.is_archived = 0`,
    [userId],
  );
  if (rows.length !== 1) {
    requestError(
      403,
      "INC_CONVERSION_REGISTRAR_REQUIRED",
      "Only an active Registrar may view conversion readiness.",
    );
  }
  return userId;
}

function displayGrade(row) {
  return {
    grade_id: Number(row.grade_id),
    grade_status: row.grade_status,
    grading_policy: row.grading_policy,
    grading_outcome: row.grading_outcome,
    final_rating: row.final_rating === null ? null : String(row.final_rating),
    remarks: row.remarks,
    enrollment_subject_id: Number(row.enrollment_subject_id),
    enrollment_subject_status: row.enrollment_subject_status,
    enrollment_status: row.enrollment_status,
    student_id: Number(row.student_id),
    student_number: row.student_number,
    offering_id: Number(row.offering_id),
    config_id: Number(row.config_id),
  };
}

// GET /api/registrar/gradebook/inc-completion-conversions/grades/:gradeId/readiness
// This GET handler is read-only; the separate POST below is transaction guarded.
router.get("/grades/:gradeId/readiness", async (req, res) => {
  let connection;
  try {
    if (Object.keys(req.query || {}).length !== 0) {
      requestError(
        400,
        "INC_CONVERSION_QUERY_UNSUPPORTED",
        "This endpoint does not accept query parameters.",
      );
    }
    const requestedGradeId = positiveId(req.params.gradeId);
    if (!requestedGradeId) {
      requestError(
        400,
        "INC_CONVERSION_GRADE_ID_INVALID",
        "gradeId must be a positive integer.",
      );
    }

    connection = await db.getConnection();
    await assertTestDatabase(connection);
    const registrarUserId = await activeRegistrar(connection, req);

    const [gradeRows] = await connection.execute(
      `SELECT g.grade_id, g.grade_status, g.grading_policy, g.grading_outcome,
              g.final_rating, g.remarks, g.faculty_id AS grade_faculty_id,
              es.enrollment_subject_id, es.offering_id,
              es.status AS enrollment_subject_status,
              e.enrollment_status, e.student_id, s.student_number,
              so.faculty_id AS offering_faculty_id, cfg.config_id
         FROM grades g
         JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
         JOIN enrollments e ON e.enrollment_id = es.enrollment_id
         JOIN students s ON s.student_id = e.student_id
         JOIN subject_offerings so ON so.offering_id = es.offering_id
         JOIN gradebook_offering_config cfg ON cfg.offering_id = so.offering_id
        WHERE g.grade_id = ?`,
      [requestedGradeId],
    );
    // Do not reveal records outside the isolated QA offering.
    if (
      gradeRows.length !== 1 ||
      Number(gradeRows[0].offering_id) !== QA_OFFERING_ID
    ) {
      requestError(
        404,
        "INC_CONVERSION_GRADE_NOT_FOUND",
        "No grade was found in the authorized QA offering.",
      );
    }
    const grade = gradeRows[0];
    const configId = Number(grade.config_id);
    const blockers = [];
    const block = (code, message) => blockers.push({ code, message });

    if (
      grade.grade_status !== "Approved" ||
      grade.grading_policy !== "TWO_TERM_50_50" ||
      grade.grading_outcome !== "INCOMPLETE" ||
      Number(grade.final_rating) !== 4 ||
      grade.remarks !== "Incomplete"
    ) {
      block(
        "INC_CONVERSION_OFFICIAL_GRADE_INELIGIBLE",
        "The original grade must remain an Approved TWO_TERM_50_50 INC 4.00 record.",
      );
    }
    if (
      grade.enrollment_status !== "Approved" ||
      grade.enrollment_subject_status !== "Incomplete"
    ) {
      block(
        "INC_CONVERSION_STUDENT_STATUS_INELIGIBLE",
        "The approved enrollment and Incomplete enrollment-subject status must still exist.",
      );
    }
    if (
      !grade.grade_faculty_id ||
      Number(grade.grade_faculty_id) !== Number(grade.offering_faculty_id)
    ) {
      block(
        "INC_CONVERSION_FACULTY_MISMATCH",
        "The official grade instructor does not match its subject offering.",
      );
    }

    const [outcomeRequests] = await connection.execute(
      `SELECT inc_request_id, request_status
         FROM gradebook_inc_outcome_requests
        WHERE config_id = ? AND enrollment_subject_id = ?`,
      [configId, grade.enrollment_subject_id],
    );
    if (
      outcomeRequests.length !== 1 ||
      outcomeRequests[0].request_status !== "APPROVED"
    ) {
      block(
        "INC_CONVERSION_APPROVED_OUTCOME_MISSING",
        "The original INC outcome must still have one approved request.",
      );
    }

    const [claims] = await connection.execute(
      `SELECT claim_id, grade_id, grade_change_request_id,
              DATE_FORMAT(claimed_completed_on, '%Y-%m-%d') AS claimed_completed_on,
              evidence_summary, verification_status,
              DATE_FORMAT(verified_completed_on, '%Y-%m-%d') AS verified_completed_on,
              verification_remarks, submitted_by_user_id, verified_by_user_id,
              DATE_FORMAT(verified_at, '%Y-%m-%d %H:%i:%s') AS verified_at,
              record_version
         FROM gradebook_inc_completion_claims
        WHERE grade_id = ?`,
      [requestedGradeId],
    );
    if (claims.length === 0) {
      block(
        "INC_CONVERSION_CLAIM_MISSING",
        "Faculty has not submitted an INC completion claim.",
      );
    } else if (claims.length !== 1) {
      block(
        "INC_CONVERSION_DUPLICATE_CLAIMS",
        "Multiple claims exist for this grade and require reconciliation.",
      );
    }
    const claim = claims.length === 1 ? claims[0] : null;
    let auditSummary = null;
    if (claim) {
      if (claim.grade_change_request_id !== null) {
        block(
          "INC_CONVERSION_LEGACY_CLAIM_LINK",
          "The claim is linked to a legacy grade-change request requiring reconciliation.",
        );
      }
      if (claim.verification_status !== "VERIFIED_TIMELY") {
        const reason =
          claim.verification_status === "VERIFIED_LATE"
            ? "Program Head verified completion after the official one-year deadline. It is not eligible for routine conversion."
            : "The claim must have a Program Head VERIFIED_TIMELY decision before Registrar conversion review.";
        block("INC_CONVERSION_NOT_VERIFIED_TIMELY", reason);
      }
      if (
        !claim.verified_completed_on ||
        !claim.verified_by_user_id ||
        !claim.verified_at ||
        !String(claim.verification_remarks ?? "").trim() ||
        !String(claim.evidence_summary ?? "").trim()
      ) {
        block(
          "INC_CONVERSION_EVIDENCE_INCOMPLETE",
          "The completion claim lacks a complete verified date, evidence, or reviewer attestation.",
        );
      }
      const [events] = await connection.execute(
        `SELECT event_id, event_type, previous_status, new_status,
                DATE_FORMAT(new_claimed_completed_on, '%Y-%m-%d') AS new_claimed_completed_on,
                DATE_FORMAT(new_verified_completed_on, '%Y-%m-%d') AS new_verified_completed_on,
                new_evidence_summary, new_verification_remarks,
                performed_by_user_id, claim_version_after
           FROM gradebook_inc_completion_claim_events
          WHERE claim_id = ? ORDER BY claim_version_after, event_id`,
        [String(claim.claim_id)],
      );
      const first = events[0] ?? null;
      const last = events.at(-1) ?? null;
      const sequential = events.every(
        (event, index) => Number(event.claim_version_after) === index + 1,
      );
      auditSummary = {
        total_events: events.length,
        first_event: first?.event_type ?? null,
        last_event: last?.event_type ?? null,
        last_event_id: last ? String(last.event_id) : null,
        last_record_version: last ? Number(last.claim_version_after) : null,
        versions_sequential: sequential,
      };
      if (
        !first ||
        first.event_type !== "CREATED" ||
        Number(first.claim_version_after) !== 1 ||
        !last ||
        !sequential ||
        events.length !== Number(claim.record_version) ||
        last.new_status !== claim.verification_status ||
        last.new_verified_completed_on !== claim.verified_completed_on ||
        last.new_claimed_completed_on !== claim.claimed_completed_on ||
        String(last.new_evidence_summary ?? "") !==
          String(claim.evidence_summary ?? "") ||
        String(last.new_verification_remarks ?? "") !==
          String(claim.verification_remarks ?? "") ||
        (claim.verification_status === "VERIFIED_TIMELY" &&
          (last.event_type !== "VERIFIED" ||
            Number(last.performed_by_user_id) !==
              Number(claim.verified_by_user_id)))
      ) {
        block(
          "INC_CONVERSION_CLAIM_AUDIT_INCONSISTENT",
          "The claim does not match its chronological audit history.",
        );
      }
    }

    const [sheetRows] = await connection.execute(
      `SELECT sheet_id, sheet_status, record_version,
              DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_official_submitted_on,
              official_submission_reference, official_date_verified_by_user_id,
              DATE_FORMAT(official_date_verified_at, '%Y-%m-%d %H:%i:%s') AS official_date_verified_at,
              finalized_by_user_id, finalized_at,
              CASE WHEN original_official_submitted_on IS NOT NULL
                         AND official_date_verified_by_user_id IS NOT NULL
                         AND official_date_verified_at IS NOT NULL
                   THEN DATE_FORMAT(DATE_ADD(original_official_submitted_on, INTERVAL 1 YEAR), '%Y-%m-%d')
                   ELSE NULL END AS inc_completion_deadline_on
         FROM gradebook_official_sheets WHERE config_id = ?`,
      [configId],
    );
    if (sheetRows.length === 0) {
      block(
        "INC_CONVERSION_SHEET_MISSING",
        "Registrar has not recorded the original official grading-sheet submission date.",
      );
    } else if (sheetRows.length !== 1) {
      block(
        "INC_CONVERSION_SHEET_DUPLICATE",
        "Multiple official grading sheets exist for this offering.",
      );
    }
    const sheet = sheetRows.length === 1 ? sheetRows[0] : null;
    const deadline = sheet?.inc_completion_deadline_on ?? null;
    let sheetAudit = null;
    if (sheet) {
      if (
        !deadline ||
        !String(sheet.official_submission_reference ?? "").trim()
      ) {
        block(
          "INC_CONVERSION_DEADLINE_UNVERIFIED",
          "Registrar must verify the original grading-sheet date and supporting reference.",
        );
      }
      const [events] = await connection.execute(
        `SELECT event_id, event_type, previous_record_version, record_version_after,
                DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_official_submitted_on,
                official_submission_reference, performed_by_user_id
           FROM gradebook_official_sheet_submission_events
          WHERE sheet_id = ? ORDER BY record_version_after, event_id`,
        [String(sheet.sheet_id)],
      );
      const first = events[0] ?? null;
      const last = events.at(-1) ?? null;
      const verifiedEvents = events.filter(
        (event) => event.event_type === "VERIFIED",
      );
      sheetAudit = {
        total_events: events.length,
        first_event: first?.event_type ?? null,
        last_event: last?.event_type ?? null,
        record_version: Number(sheet.record_version),
        verified_event_present: verifiedEvents.length > 0,
      };
      if (
        !first ||
        first.event_type !== "RECORDED" ||
        !last ||
        Number(last.record_version_after) !== Number(sheet.record_version) ||
        !verifiedEvents.length ||
        !verifiedEvents.some(
          (event) =>
            Number(event.performed_by_user_id) ===
              Number(sheet.official_date_verified_by_user_id) &&
            event.original_official_submitted_on ===
              sheet.original_official_submitted_on &&
            String(event.official_submission_reference ?? "") ===
              String(sheet.official_submission_reference ?? ""),
        )
      ) {
        block(
          "INC_CONVERSION_SHEET_AUDIT_INCONSISTENT",
          "The official sheet verification does not match its preserved audit events.",
        );
      }
    }

    const [incRequests] = await connection.execute(
      `SELECT grade_change_request_id, status, requested_by, requested_by_role,
              requested_at, reviewed_by, reviewed_at
         FROM grade_change_requests
        WHERE grade_id = ? AND request_type = 'INC_COMPLETION'
          AND status IN ('Pending Program Head', 'For Registrar Processing')`,
      [requestedGradeId],
    );
    const authorizedRequest =
      incRequests.length === 1 &&
      claim &&
      incRequests[0].status === "For Registrar Processing" &&
      incRequests[0].requested_by_role === "Faculty" &&
      Number(incRequests[0].requested_by) ===
        Number(claim.submitted_by_user_id) &&
      incRequests[0].reviewed_by !== null &&
      incRequests[0].reviewed_at !== null &&
      claim.verification_status === "VERIFIED_TIMELY" &&
      claim.verified_at !== null &&
      new Date(incRequests[0].requested_at).getTime() >=
        new Date(claim.verified_at).getTime() &&
      new Date(incRequests[0].reviewed_at).getTime() >=
        new Date(incRequests[0].requested_at).getTime();
    if (incRequests.length && !authorizedRequest) {
      block(
        "INC_CONVERSION_REQUEST_RECONCILIATION_REQUIRED",
        "An existing INC change request is unreviewed, ambiguous, or does not belong to the verified claim.",
      );
    }
    const [[clock]] = await connection.execute(
      "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS database_today",
    );
    if (
      claim?.verified_completed_on &&
      claim.verified_completed_on > clock.database_today
    ) {
      block(
        "INC_CONVERSION_DATE_IN_FUTURE",
        "The verified completion date cannot be later than today.",
      );
    }
    if (
      claim?.verified_completed_on &&
      deadline &&
      claim.verified_completed_on > deadline
    ) {
      block(
        "INC_CONVERSION_AFTER_DEADLINE",
        "Verified completion occurred after the Registrar-established deadline.",
      );
    }

    // INC Expiry Review
    const expired = Boolean(deadline && clock.database_today > deadline);

    const claimNeedsDecision =
      claim?.verification_status === "PENDING_VERIFICATION";

    const timelyCompletionProtected =
      claim?.verification_status === "VERIFIED_TIMELY";

    const claimAuditValid =
      !claim ||
      (auditSummary?.first_event === "CREATED" &&
        auditSummary.versions_sequential === true &&
        auditSummary.total_events === Number(claim.record_version) &&
        auditSummary.last_record_version === Number(claim.record_version) &&
        auditSummary.last_event ===
          (claim.verification_status === "REJECTED"
            ? "REJECTED"
            : "VERIFIED") &&
        !blockers.some(
          (item) => item.code === "INC_CONVERSION_CLAIM_AUDIT_INCONSISTENT",
        ));

    const expiredIncReviewReady = Boolean(
      expired &&
      !claimNeedsDecision &&
      !timelyCompletionProtected &&
      !incRequests.length &&
      claimAuditValid &&
      sheet?.sheet_status === "FINALIZED" &&
      sheet?.finalized_by_user_id &&
      sheet?.finalized_at &&
      sheetAudit?.verified_event_present &&
      !blockers.some(
        (item) => item.code === "INC_CONVERSION_SHEET_AUDIT_INCONSISTENT",
      ) &&
      grade.grade_status === "Approved" &&
      grade.grading_policy === "TWO_TERM_50_50" &&
      grade.grading_outcome === "INCOMPLETE" &&
      Number(grade.final_rating) === 4 &&
      grade.remarks === "Incomplete" &&
      grade.enrollment_status === "Approved" &&
      grade.enrollment_subject_status === "Incomplete" &&
      Number(grade.grade_faculty_id) === Number(grade.offering_faculty_id) &&
      outcomeRequests.length === 1 &&
      outcomeRequests[0].request_status === "APPROVED" &&
      (!claim ||
        ["REJECTED", "VERIFIED_LATE"].includes(claim.verification_status)),
    );

    const expiryReviewStatus = !deadline
      ? "DEADLINE_NOT_VERIFIED"
      : !expired
        ? "WITHIN_DEADLINE"
        : timelyCompletionProtected
          ? "TIMELY_COMPLETION_PROTECTED"
          : claimNeedsDecision
            ? "CLAIM_REVIEW_PENDING"
            : expiredIncReviewReady
              ? "REGISTRAR_REVIEW_REQUIRED"
              : "RECONCILIATION_REQUIRED";

    const reviewEligible = blockers.length === 0;
    return res.status(200).json({
      success: true,
      read_only: true,
      registrar_user_id: registrarUserId,
      qa_offering_id: QA_OFFERING_ID,
      official_grade: displayGrade(grade),
      claim: claim
        ? {
            claim_id: String(claim.claim_id),
            verification_status: claim.verification_status,
            claimed_completed_on: claim.claimed_completed_on,
            verified_completed_on: claim.verified_completed_on,
            verification_remarks: claim.verification_remarks,
            verified_by_user_id:
              claim.verified_by_user_id === null
                ? null
                : Number(claim.verified_by_user_id),
            record_version: Number(claim.record_version),
          }
        : null,
      official_sheet: sheet
        ? {
            sheet_id: String(sheet.sheet_id),
            sheet_status: sheet.sheet_status,
            record_version: Number(sheet.record_version),
            original_official_submitted_on:
              sheet.original_official_submitted_on,
            official_submission_reference: sheet.official_submission_reference,
            official_date_verified_by_user_id:
              sheet.official_date_verified_by_user_id,
            deadline_established: deadline !== null,
            inc_completion_deadline_on: deadline,
          }
        : null,
      audit_checks: {
        claim: auditSummary,
        sheet: sheetAudit,
      },

      expiry_review: {
        evaluated_on: clock.database_today,
        deadline_on: deadline,
        deadline_passed: expired,
        status: expiryReviewStatus,
        can_begin_registrar_review: expiredIncReviewReady,
        can_convert_to_failing_grade: false,
        conversion_write_enabled: false,
        note: "Expiry requires documented Registrar action and an audited failing-grade outcome.",
      },

      review: {
        can_begin_conversion_review: reviewEligible,
        can_convert_official_grade: false,
        conversion_write_enabled: false,
        process_route_available: true,
        authorized_request_id: authorizedRequest
          ? Number(incRequests[0].grade_change_request_id)
          : null,
        blockers,
        next_requirement: reviewEligible
          ? "Submit a Program Head-reviewed INC grade-change request. Use the guarded process action only when both official term snapshots are approved and the sheet is finalized."
          : "Resolve the blockers using genuine Faculty, Program Head, and Registrar evidence. No official-grade changes are permitted.",
      },
      official_grade_unchanged: true,
    });
  } catch (error) {
    return sendError(res, error);
  } finally {
    connection?.release();
  }
});

// POST /api/registrar/gradebook/inc-completion-conversions/grades/:gradeId/process
// QA-only final Registrar application. All evidence is rechecked inside a
// transaction; no arbitrary client-supplied term grades are accepted.
// The older /grade-change-requests/:id/process INC guard stays unchanged.
function conversionFail(code, message, status = 409) {
  requestError(status, code, message);
}
function parseOfficialRatio(numerator, denominator, name) {
  const nRaw = String(numerator ?? "");
  const dRaw = String(denominator ?? "");
  if (
    !/^(0|[1-9][0-9]*)$/.test(nRaw) ||
    !/^[1-9][0-9]*$/.test(dRaw) ||
    nRaw.length > 255 ||
    dRaw.length > 255
  ) {
    conversionFail(
      "INC_CONVERSION_TERM_FRACTION_INVALID",
      `${name} exact fraction is invalid.`,
    );
  }
  const n = BigInt(nRaw);
  const d = BigInt(dRaw);
  if (n > d * 100n) {
    conversionFail(
      "INC_CONVERSION_TERM_FRACTION_OUT_OF_RANGE",
      `${name} percentage must be 0 through 100.`,
    );
  }
  return { n, d, numerator: nRaw, denominator: dRaw };
}
function decimalScaled(value, places) {
  if (value === null || value === undefined) return null;

  const raw = String(value).trim();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(raw);

  if (!match) return null;

  const fraction = (match[2] ?? "").replace(/0+$/, "");

  if (fraction.length > places) return null;

  return (
    BigInt(match[1]) * 10n ** BigInt(places) +
    BigInt(fraction.padEnd(places, "0") || "0")
  );
}
function roundedRatioScaled(numerator, denominator, places) {
  if (denominator <= 0n || numerator < 0n)
    throw new Error("Invalid rational calculation.");
  const factor = 10n ** BigInt(places);
  return (numerator * factor * 2n + denominator) / (2n * denominator);
}
function formatScaled(scaled, places) {
  const factor = 10n ** BigInt(places);
  return `${scaled / factor}.${String(scaled % factor).padStart(places, "0")}`;
}
function officialRating(numerator, denominator) {
  const thresholds = [
    [97, "1.00"],
    [94, "1.25"],
    [91, "1.50"],
    [88, "1.75"],
    [85, "2.00"],
    [82, "2.25"],
    [79, "2.50"],
    [76, "2.75"],
    [75, "3.00"],
  ];
  for (const [threshold, rating] of thresholds) {
    if (numerator >= BigInt(threshold) * denominator) return rating;
  }
  return "5.00";
}
function sameValue(a, b) {
  return a === null || a === undefined
    ? b === null || b === undefined
    : b !== null && b !== undefined && String(a) === String(b);
}
function parseSnapshot(raw, term, configId, enrollmentSubjectId, n, d) {
  let snapshot;
  try {
    snapshot = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    snapshot = null;
  }
  if (
    !snapshot ||
    !snapshot.calculated_term ||
    snapshot.grading_term !== term ||
    snapshot.policy !== "TWO_TERM_50_50" ||
    Number(snapshot.config_id) !== configId ||
    Number(snapshot.enrollment_subject_id) !== enrollmentSubjectId ||
    snapshot.calculated_term.state !== "READY" ||
    Number(snapshot.term_weights?.MIDTERM) !== 50 ||
    Number(snapshot.term_weights?.FINAL_TERM) !== 50 ||
    String(snapshot.calculated_term.term_percentage?.exact_numerator) !== n ||
    String(snapshot.calculated_term.term_percentage?.exact_denominator) !== d
  ) {
    conversionFail(
      "INC_CONVERSION_SNAPSHOT_INVALID",
      `${term} calculation snapshot is incomplete or inconsistent.`,
    );
  }
  return snapshot;
}
function processBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    conversionFail(
      "INC_CONVERSION_BODY_INVALID",
      "A JSON object is required.",
      400,
    );
  }
  const allowed = new Set([
    "grade_change_request_id",
    "expected_claim_id",
    "expected_claim_version",
    "expected_sheet_record_version",
    "registrar_remarks",
    "dry_run",
    "confirm_authorized_conversion",
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    conversionFail(
      "INC_CONVERSION_FIELDS_UNSUPPORTED",
      "Unsupported fields were supplied.",
      400,
    );
  }
  const requestId = positiveId(body.grade_change_request_id);
  const expectedVersion = positiveId(body.expected_claim_version);
  const sheetVersion = positiveId(body.expected_sheet_record_version);
  const claimId =
    typeof body.expected_claim_id === "string" &&
    /^[1-9][0-9]{0,19}$/.test(body.expected_claim_id)
      ? body.expected_claim_id
      : null;
  const remarks =
    typeof body.registrar_remarks === "string"
      ? body.registrar_remarks.trim()
      : "";
  if (
    !requestId ||
    !expectedVersion ||
    !sheetVersion ||
    !claimId ||
    BigInt(claimId) > 18446744073709551615n ||
    remarks.length < 10 ||
    remarks.length > 1000 ||
    /[\x00-\x08\x0B\x0E-\x1F\x7F]/.test(remarks) ||
    typeof body.dry_run !== "boolean" ||
    body.confirm_authorized_conversion !== true
  ) {
    conversionFail(
      "INC_CONVERSION_INPUT_INVALID",
      "Provide valid request/claim/sheet versions, 10–1000 character registrar_remarks, boolean dry_run, and confirm_authorized_conversion: true.",
      400,
    );
  }
  return {
    requestId,
    claimId,
    expectedVersion,
    sheetVersion,
    remarks,
    dryRun: body.dry_run,
  };
}

router.post("/grades/:gradeId/process", async (req, res) => {
  let connection = null;
  let transactionOpen = false;
  let gradeGuardOn = false;
  try {
    if (Object.keys(req.query ?? {}).length) {
      conversionFail(
        "INC_CONVERSION_QUERY_UNSUPPORTED",
        "Query parameters are not accepted.",
        400,
      );
    }
    const gradeId = positiveId(req.params.gradeId);
    if (!gradeId)
      conversionFail(
        "INC_CONVERSION_GRADE_ID_INVALID",
        "gradeId must be positive.",
        400,
      );
    const input = processBody(req.body);
    connection = await db.getConnection();
    await assertTestDatabase(connection);
    const registrarId = await activeRegistrar(connection, req);
    // Pooled session flags must be cleared before starting and even after errors.
    await connection.execute("SET @allow_approved_inc_grade_change = NULL");
    await connection.execute("SET @allow_approved_grade_correction = NULL");
    await connection.beginTransaction();
    transactionOpen = true;

    // Registrar grading writes remain QA-only.
    await assertQaGradingDatabase(connection);

    const [scope] = await connection.execute(
      `SELECT es.enrollment_subject_id, es.offering_id, cfg.config_id,
              g.grade_id
         FROM grades g
         JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
         JOIN gradebook_offering_config cfg ON cfg.offering_id = es.offering_id
        WHERE g.grade_id = ?`,
      [gradeId],
    );
    if (scope.length !== 1 || Number(scope[0].offering_id) !== QA_OFFERING_ID) {
      conversionFail(
        "INC_CONVERSION_GRADE_NOT_FOUND",
        "Grade is outside the authorized QA offering.",
        404,
      );
    }
    const enrollmentSubjectId = Number(scope[0].enrollment_subject_id);
    const configId = Number(scope[0].config_id);

    // Match the lock order used by Faculty and Program Head claim writers.
    const [offerings] = await connection.execute(
      `SELECT offering_id, faculty_id FROM subject_offerings WHERE offering_id = ? FOR UPDATE`,
      [QA_OFFERING_ID],
    );
    if (offerings.length !== 1)
      conversionFail(
        "INC_CONVERSION_OFFERING_CHANGED",
        "Offering was not found.",
      );
    const [configs] = await connection.execute(
      `SELECT config_id, grading_classification, midterm_percent, final_term_percent
         FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE`,
      [QA_OFFERING_ID],
    );
    if (
      configs.length !== 1 ||
      Number(configs[0].config_id) !== configId ||
      Number(configs[0].midterm_percent) !== 50 ||
      Number(configs[0].final_term_percent) !== 50
    ) {
      conversionFail(
        "INC_CONVERSION_POLICY_CHANGED",
        "Gradebook config must have exactly 50% Midterm and 50% Final Term.",
      );
    }
    const [students] = await connection.execute(
      `SELECT es.enrollment_subject_id, es.offering_id, es.status AS subject_status,
              e.enrollment_status
         FROM enrollment_subjects es
         JOIN enrollments e ON e.enrollment_id = es.enrollment_id
        WHERE es.enrollment_subject_id = ? FOR UPDATE`,
      [enrollmentSubjectId],
    );
    if (
      students.length !== 1 ||
      Number(students[0].offering_id) !== QA_OFFERING_ID ||
      students[0].subject_status !== "Incomplete" ||
      students[0].enrollment_status !== "Approved"
    ) {
      conversionFail(
        "INC_CONVERSION_ENROLLMENT_CHANGED",
        "Only an Approved enrollment with an Incomplete subject may convert.",
      );
    }
    const [grades] = await connection.execute(
      `SELECT grade_id, enrollment_subject_id, faculty_id, grade_status,
              grading_policy, grading_outcome, remarks, outcome_reason,
              midterm_grade, final_grade, overall_percentage, final_rating
         FROM grades WHERE enrollment_subject_id = ? FOR UPDATE`,
      [enrollmentSubjectId],
    );
    if (
      grades.length !== 1 ||
      Number(grades[0].grade_id) !== gradeId ||
      grades[0].grade_status !== "Approved" ||
      grades[0].grading_policy !== "TWO_TERM_50_50" ||
      grades[0].grading_outcome !== "INCOMPLETE" ||
      grades[0].remarks !== "Incomplete" ||
      Number(grades[0].final_rating) !== 4 ||
      Number(grades[0].faculty_id) !== Number(offerings[0].faculty_id)
    ) {
      conversionFail(
        "INC_CONVERSION_OFFICIAL_GRADE_CHANGED",
        "The protected Approved INC 4.00 grade has changed.",
      );
    }
    const grade = grades[0];
    const [outcomes] = await connection.execute(
      `SELECT inc_request_id, request_status FROM gradebook_inc_outcome_requests
        WHERE config_id = ? AND enrollment_subject_id = ? FOR UPDATE`,
      [configId, enrollmentSubjectId],
    );
    if (outcomes.length !== 1 || outcomes[0].request_status !== "APPROVED") {
      conversionFail(
        "INC_CONVERSION_ORIGINAL_INC_NOT_APPROVED",
        "Original INC outcome approval is missing.",
      );
    }
    const [sheetRows] = await connection.execute(
      `SELECT sheet_id, sheet_status, record_version,
              DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_date,
              official_submission_reference, official_date_verified_by_user_id,
              official_date_verified_at, finalized_by_user_id, finalized_at,
              DATE_FORMAT(DATE_ADD(original_official_submitted_on, INTERVAL 1 YEAR), '%Y-%m-%d') AS deadline
         FROM gradebook_official_sheets WHERE config_id = ? FOR UPDATE`,
      [configId],
    );
    if (sheetRows.length !== 1) {
      conversionFail(
        "INC_CONVERSION_SHEET_NOT_READY",
        "A unique Registrar-verified official grading sheet is required.",
      );
    }
    const sheet = sheetRows[0];
    if (
      Number(sheet.record_version) !== input.sheetVersion ||
      !sheet.original_date ||
      !sheet.official_submission_reference ||
      sheet.official_date_verified_by_user_id === null ||
      !sheet.official_date_verified_at ||
      // A finalized official sheet must exist before amendment.
      sheet.sheet_status !== "FINALIZED" ||
      !sheet.finalized_by_user_id ||
      !sheet.finalized_at
    ) {
      conversionFail(
        "INC_CONVERSION_SHEET_NOT_FINALIZED",
        "Finalized official sheet, verified date and matching version are required.",
      );
    }
    const [sheetEvents] = await connection.execute(
      `SELECT event_type, original_official_submitted_on,
              DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS official_date,
              official_submission_reference, performed_by_user_id, record_version_after
         FROM gradebook_official_sheet_submission_events WHERE sheet_id = ?
        ORDER BY record_version_after FOR UPDATE`,
      [String(sheet.sheet_id)],
    );
    const finalSheetEvent = sheetEvents.at(-1);
    if (
      sheetEvents[0]?.event_type !== "RECORDED" ||
      !sheetEvents.some(
        (ev) =>
          ev.event_type === "VERIFIED" &&
          ev.official_date === sheet.original_date &&
          ev.official_submission_reference ===
            sheet.official_submission_reference &&
          Number(ev.performed_by_user_id) ===
            Number(sheet.official_date_verified_by_user_id),
      ) ||
      !finalSheetEvent ||
      Number(finalSheetEvent.record_version_after) >
        Number(sheet.record_version)
    ) {
      conversionFail(
        "INC_CONVERSION_SHEET_AUDIT_INVALID",
        "Original grading-sheet verification audit is inconsistent.",
      );
    }
    const [claims] = await connection.execute(
      `SELECT claim_id, grade_id, grade_change_request_id, verification_status,
              DATE_FORMAT(claimed_completed_on, '%Y-%m-%d') AS claimed_completed_on,
              DATE_FORMAT(verified_completed_on, '%Y-%m-%d') AS verified_completed_on,
              evidence_summary, verification_remarks, submitted_by_user_id,
              verified_by_user_id, verified_at, record_version
         FROM gradebook_inc_completion_claims WHERE grade_id = ? FOR UPDATE`,
      [gradeId],
    );
    if (
      claims.length !== 1 ||
      String(claims[0].claim_id) !== input.claimId ||
      Number(claims[0].record_version) !== input.expectedVersion ||
      claims[0].verification_status !== "VERIFIED_TIMELY" ||
      claims[0].grade_change_request_id !== null ||
      !claims[0].verified_completed_on ||
      !claims[0].verified_at ||
      !String(claims[0].verification_remarks ?? "").trim() ||
      !String(claims[0].evidence_summary ?? "").trim() ||
      !claims[0].verified_by_user_id ||
      claims[0].verified_completed_on > sheet.deadline
    ) {
      conversionFail(
        "INC_CONVERSION_CLAIM_NOT_ELIGIBLE",
        "Only an unchanged, timely, Program Head-verified claim is eligible.",
      );
    }
    const claim = claims[0];
    const [claimEvents] = await connection.execute(
      `SELECT event_id, event_type, new_status, new_verified_completed_on,
              DATE_FORMAT(new_verified_completed_on, '%Y-%m-%d') AS completed_date,
              performed_by_user_id, claim_version_after
         FROM gradebook_inc_completion_claim_events WHERE claim_id = ?
        ORDER BY claim_version_after FOR UPDATE`,
      [input.claimId],
    );
    const lastClaimEvent = claimEvents.at(-1);
    if (
      claimEvents[0]?.event_type !== "CREATED" ||
      claimEvents.length !== Number(claim.record_version) ||
      !claimEvents.every(
        (event, index) => Number(event.claim_version_after) === index + 1,
      ) ||
      !lastClaimEvent ||
      lastClaimEvent.event_type !== "VERIFIED" ||
      lastClaimEvent.new_status !== "VERIFIED_TIMELY" ||
      lastClaimEvent.completed_date !== claim.verified_completed_on ||
      Number(lastClaimEvent.performed_by_user_id) !==
        Number(claim.verified_by_user_id)
    ) {
      conversionFail(
        "INC_CONVERSION_CLAIM_AUDIT_INVALID",
        "Claim approval does not match its complete audit version history.",
      );
    }
    const [requests] = await connection.execute(
      `SELECT * FROM grade_change_requests WHERE grade_change_request_id = ? FOR UPDATE`,
      [input.requestId],
    );
    if (requests.length !== 1)
      conversionFail(
        "INC_CONVERSION_REQUEST_NOT_FOUND",
        "Grade-change request does not exist.",
        404,
      );
    const change = requests[0];
    if (
      Number(change.grade_id) !== gradeId ||
      change.request_type !== "INC_COMPLETION" ||
      change.status !== "For Registrar Processing" ||
      change.requested_by_role !== "Faculty" ||
      Number(change.requested_by) !== Number(claim.submitted_by_user_id) ||
      !change.reviewed_by ||
      !change.reviewed_at ||
      !(new Date(change.requested_at) >= new Date(claim.verified_at)) ||
      !(new Date(change.reviewed_at) >= new Date(change.requested_at)) ||
      Number(change.reviewed_by) !== Number(claim.verified_by_user_id)
    ) {
      conversionFail(
        "INC_CONVERSION_REQUEST_NOT_AUTHORIZED",
        "A Faculty request approved by the verified Program Head after completion verification is required.",
      );
    }
    const [activeRequests] = await connection.execute(
      `SELECT grade_change_request_id FROM grade_change_requests
         WHERE grade_id = ? AND request_type = 'INC_COMPLETION'
           AND status IN ('Pending Program Head','For Registrar Processing') FOR UPDATE`,
      [gradeId],
    );
    if (
      activeRequests.length !== 1 ||
      Number(activeRequests[0].grade_change_request_id) !== input.requestId
    ) {
      conversionFail(
        "INC_CONVERSION_DUPLICATE_REQUESTS",
        "Conflicting active INC requests must be reconciled.",
      );
    }
    const [authorizedBy] = await connection.execute(
      `SELECT ph.department_id
         FROM users u JOIN roles r ON r.role_id = u.role_id
         JOIN faculty f ON f.user_id = u.user_id
         JOIN program_heads ph ON ph.faculty_id = f.faculty_id
        WHERE u.user_id = ? AND r.role_name = 'Program Head'
          AND u.is_active = 1 AND u.is_archived = 0 AND ph.is_active = 1
          AND (ph.start_date IS NULL OR ph.start_date <= CURDATE())
          AND (ph.end_date IS NULL OR ph.end_date >= CURDATE())`,
      [Number(change.reviewed_by)],
    );
    const [offeringDepartments] = await connection.execute(
      `SELECT cr.department_id FROM subject_offerings so
         JOIN sections sec ON sec.section_id = so.section_id
         JOIN courses cr ON cr.course_id = sec.course_id
        WHERE so.offering_id = ?`,
      [QA_OFFERING_ID],
    );
    if (
      offeringDepartments.length !== 1 ||
      !authorizedBy.some(
        (row) =>
          Number(row.department_id) ===
          Number(offeringDepartments[0].department_id),
      )
    ) {
      conversionFail(
        "INC_CONVERSION_PH_SCOPE_INVALID",
        "The approving Program Head is no longer authorized for this department.",
      );
    }
    // Original values must still match the approved official INC record.
    if (
      !sameValue(change.old_midterm_grade, grade.midterm_grade) ||
      !sameValue(change.old_final_grade, grade.final_grade) ||
      !sameValue(change.old_overall_percentage, grade.overall_percentage) ||
      !sameValue(change.old_final_rating, grade.final_rating) ||
      !sameValue(change.old_remarks, grade.remarks) ||
      !sameValue(change.old_grading_outcome, grade.grading_outcome) ||
      !sameValue(change.old_outcome_reason, grade.outcome_reason)
    ) {
      conversionFail(
        "INC_CONVERSION_STALE_REQUEST",
        "The request's original grade no longer matches the protected grade.",
      );
    }
    // New values MUST match approved, immutable gradebook term snapshots.
    // Never substitute percentages supplied in this POST request.
    const [termRows] = await connection.execute(
      `SELECT term_submission_id, grading_term, submission_status, attempt_number,
              term_percentage_exact_numerator, term_percentage_exact_denominator,
              calculation_snapshot_json, reviewed_by_user_id, reviewed_at,
              submitted_by_user_id, submitted_at
         FROM gradebook_term_submission_attempts
        WHERE config_id = ? AND enrollment_subject_id = ?
        ORDER BY grading_term, attempt_number DESC FOR UPDATE`,
      [configId, enrollmentSubjectId],
    );
    const latest = {};
    for (const row of termRows)
      if (!latest[row.grading_term]) latest[row.grading_term] = row;
    const mid = latest.MIDTERM;
    const fin = latest.FINAL_TERM;
    if (
      !mid ||
      !fin ||
      [mid, fin].some(
        (row) =>
          row.submission_status !== "APPROVED" ||
          !row.reviewed_at ||
          !row.reviewed_by_user_id ||
          Number(row.submitted_by_user_id) !==
            Number(claim.submitted_by_user_id),
      )
    ) {
      conversionFail(
        "INC_CONVERSION_APPROVED_TERM_SNAPSHOTS_REQUIRED",
        "Approved numeric Midterm and Final Term gradebook calculation snapshots are required; direct percentages cannot convert INC.",
      );
    }
    // A completed INC must have a Final Term submission and approval after
    // documented verification, and before the Faculty requests conversion.
    // Pre-INC numeric snapshots cannot be reused as completion evidence.
    if (
      !(new Date(fin.submitted_at) >= new Date(claim.verified_at)) ||
      !(new Date(fin.reviewed_at) >= new Date(fin.submitted_at)) ||
      !(new Date(fin.reviewed_at) <= new Date(change.requested_at)) ||
      !(new Date(mid.reviewed_at) <= new Date(change.requested_at)) ||
      Number(fin.reviewed_by_user_id) !== Number(change.reviewed_by)
    ) {
      conversionFail(
        "INC_CONVERSION_COMPLETION_TERM_NOT_AUTHORIZED",
        "The completed Final Term must be submitted and approved after verified INC completion and before the reviewed grade-change request.",
      );
    }
    const m = parseOfficialRatio(
      mid.term_percentage_exact_numerator,
      mid.term_percentage_exact_denominator,
      "MIDTERM",
    );
    const f = parseOfficialRatio(
      fin.term_percentage_exact_numerator,
      fin.term_percentage_exact_denominator,
      "FINAL_TERM",
    );
    parseSnapshot(
      mid.calculation_snapshot_json,
      "MIDTERM",
      configId,
      enrollmentSubjectId,
      m.numerator,
      m.denominator,
    );

    // Require the approved Final Term to be the verified INC completion,
    // not an ordinary or earlier numeric submission.
    const completionSnapshot = parseSnapshot(
      fin.calculation_snapshot_json,
      "FINAL_TERM",
      configId,
      enrollmentSubjectId,
      f.numerator,
      f.denominator,
    );
    if (
      completionSnapshot.submission_context !== "INC_COMPLETION_FINAL_TERM" ||
      String(completionSnapshot.inc_completion_claim_id) !== input.claimId ||
      Number(completionSnapshot.inc_completion_claim_version) !==
        Number(claim.record_version) ||
      Number(completionSnapshot.original_inc_grade_id) !== gradeId ||
      String(completionSnapshot.official_sheet_id) !== String(sheet.sheet_id) ||
      completionSnapshot.verified_completed_on !==
        claim.verified_completed_on ||
      Number(completionSnapshot.offering_id) !== QA_OFFERING_ID
    ) {
      conversionFail(
        "INC_CONVERSION_FINAL_SOURCE_INVALID",
        "Approved Final Term is not linked to the unchanged, verified INC completion claim.",
      );
    }

    // Calculation in exact rational arithmetic, before any display rounding.
    const overallN = m.n * f.d + f.n * m.d;
    const overallD = 2n * m.d * f.d;
    const numericResult = {
      midterm_grade: formatScaled(roundedRatioScaled(m.n, m.d, 12), 12),
      final_grade: formatScaled(roundedRatioScaled(f.n, f.d, 12), 12),
      overall_percentage: formatScaled(
        roundedRatioScaled(overallN, overallD, 12),
        12,
      ),
      proposal_overall_percentage: formatScaled(
        roundedRatioScaled(overallN, overallD, 2),
        2,
      ),
      final_rating: officialRating(overallN, overallD),
      remarks: overallN >= 75n * overallD ? "Passed" : "Failed",
      grading_outcome: "NUMERIC",
    };
    if (
      decimalScaled(change.new_midterm_grade, 2) !==
        roundedRatioScaled(m.n, m.d, 2) ||
      decimalScaled(change.new_final_grade, 2) !==
        roundedRatioScaled(f.n, f.d, 2) ||
      decimalScaled(change.new_overall_percentage, 2) !==
        roundedRatioScaled(overallN, overallD, 2) ||
      decimalScaled(change.new_final_rating, 2) !==
        decimalScaled(numericResult.final_rating, 2) ||
      change.new_remarks !== numericResult.remarks ||
      change.new_grading_outcome !== "NUMERIC"
    ) {
      conversionFail(
        "INC_CONVERSION_PROPOSED_GRADE_MISMATCH",
        "The approved proposed grade does not match the official gradebook exact term snapshots.",
      );
    }
    // Preserve the original finalized INC record.
    const [originalSnapshots] = await connection.execute(
      `SELECT fr.roster_snapshot_id,
              fr.midterm_grade_snapshot
         FROM gradebook_finalized_roster fr
         JOIN enrollment_subjects es
           ON es.enrollment_subject_id = fr.enrollment_subject_id
         JOIN enrollments e
           ON e.enrollment_id = es.enrollment_id
          AND e.student_id = fr.student_id
        WHERE fr.sheet_id = ?
          AND fr.grade_id = ?
          AND fr.enrollment_subject_id = ?
          AND fr.roster_disposition = 'APPROVED_GRADE'
          AND fr.grade_status_snapshot = 'Approved'
          AND fr.grading_outcome_snapshot = 'INCOMPLETE'
          AND fr.enrollment_subject_status_snapshot = 'Incomplete'
          AND fr.grade_remarks_snapshot = 'Incomplete'
          AND fr.final_rating_snapshot = 4.00
          AND fr.final_grade_snapshot IS NULL
          AND fr.overall_percentage_snapshot IS NULL
        FOR UPDATE`,
      [String(sheet.sheet_id), gradeId, enrollmentSubjectId],
    );

    const expectedMidterm = roundedRatioScaled(m.n, m.d, 12);

    if (
      originalSnapshots.length !== 1 ||
      decimalScaled(originalSnapshots[0].midterm_grade_snapshot, 12) !==
        expectedMidterm ||
      decimalScaled(grade.midterm_grade, 12) !== expectedMidterm ||
      grade.final_grade !== null ||
      grade.overall_percentage !== null
    ) {
      conversionFail(
        "INC_CONVERSION_ORIGINAL_SNAPSHOT_INVALID",
        "The original finalized INC snapshot does not match the protected official grade.",
      );
    }

    const rosterSnapshotId = String(originalSnapshots[0].roster_snapshot_id);

    const [priorAmendments] = await connection.execute(
      `SELECT amendment_id FROM gradebook_sheet_amendments
         WHERE grade_change_request_id = ? FOR UPDATE`,
      [input.requestId],
    );
    if (priorAmendments.length !== 0) {
      conversionFail(
        "INC_CONVERSION_ALREADY_AMENDED",
        "This authorized change request already has an official-sheet amendment.",
      );
    }
    const [revisions] = await connection.execute(
      `SELECT sheet_revision_number FROM gradebook_sheet_amendments
         WHERE sheet_id = ? ORDER BY sheet_revision_number DESC LIMIT 1 FOR UPDATE`,
      [String(sheet.sheet_id)],
    );
    const nextRevision = revisions.length
      ? Number(revisions[0].sheet_revision_number) + 1
      : 1;
    if (!Number.isSafeInteger(nextRevision) || nextRevision > 4294967295) {
      conversionFail(
        "INC_CONVERSION_REVISION_LIMIT",
        "The official-sheet revision limit was reached.",
      );
    }
    const previous = {
      grade_id: gradeId,
      enrollment_subject_id: enrollmentSubjectId,
      grade_status: grade.grade_status,
      grading_policy: grade.grading_policy,
      grading_outcome: grade.grading_outcome,
      midterm_grade: grade.midterm_grade,
      final_grade: grade.final_grade,
      overall_percentage: grade.overall_percentage,
      final_rating: grade.final_rating,
      remarks: grade.remarks,
      outcome_reason: grade.outcome_reason,
    };
    const next = {
      ...numericResult,
      grade_id: gradeId,
      grade_status: "Approved",
      grading_policy: "TWO_TERM_50_50",
      outcome_reason: null,
      term_sources: [
        {
          term: "MIDTERM",
          term_submission_id: String(mid.term_submission_id),
          exact_numerator: m.numerator,
          exact_denominator: m.denominator,
        },
        {
          term: "FINAL_TERM",
          term_submission_id: String(fin.term_submission_id),
          exact_numerator: f.numerator,
          exact_denominator: f.denominator,
        },
      ],
      overall_exact_numerator: String(overallN),
      overall_exact_denominator: String(overallD),
      claim_id: input.claimId,
      claim_event_id: String(lastClaimEvent.event_id),
      grade_change_request_id: input.requestId,
      official_sheet_id: String(sheet.sheet_id),
    };
    // Date authorization <= Registrar verification <= application, as required
    // by chk_sheet_amendment_sequence. No amendment is saved on a dry-run.
    await connection.execute("SET @allow_approved_inc_grade_change = 1");
    gradeGuardOn = true;
    let gradeUpdate;
    try {
      [gradeUpdate] = await connection.execute(
        `UPDATE grades SET midterm_grade = ?, final_grade = ?, overall_percentage = ?,
             final_rating = ?, remarks = ?, grading_policy = 'TWO_TERM_50_50',
             grading_outcome = 'NUMERIC', outcome_reason = NULL, grade_status = 'Approved'
          WHERE grade_id = ? AND grade_status = 'Approved'
            AND grading_outcome = 'INCOMPLETE' AND final_rating = 4.00`,
        [
          numericResult.midterm_grade,
          numericResult.final_grade,
          numericResult.overall_percentage,
          numericResult.final_rating,
          numericResult.remarks,
          gradeId,
        ],
      );
    } finally {
      await connection.execute("SET @allow_approved_inc_grade_change = NULL");
      gradeGuardOn = false;
    }
    if (Number(gradeUpdate.affectedRows) !== 1) {
      conversionFail(
        "INC_CONVERSION_GRADE_CONFLICT",
        "Official INC grade changed before the authorized amendment.",
      );
    }
    const newSubjectStatus =
      numericResult.remarks === "Passed" ? "Completed" : "Failed";
    const [subjectRows] = await connection.execute(
      `SELECT status FROM enrollment_subjects
   WHERE enrollment_subject_id = ?`,
      [enrollmentSubjectId],
    );

    if (
      subjectRows.length !== 1 ||
      subjectRows[0].status !== newSubjectStatus
    ) {
      conversionFail(
        "INC_CONVERSION_SUBJECT_CONFLICT",
        "The grade trigger did not synchronize the enrollment-subject status.",
      );
    }
    const [requestUpdate] = await connection.execute(
      `UPDATE grade_change_requests
          SET status = 'Completed', processed_by = ?, processed_at = NOW(), registrar_remarks = ?
        WHERE grade_change_request_id = ? AND status = 'For Registrar Processing'`,
      [registrarId, input.remarks, input.requestId],
    );
    if (Number(requestUpdate.affectedRows) !== 1) {
      conversionFail(
        "INC_CONVERSION_REQUEST_CONFLICT",
        "Authorized change-request status changed.",
      );
    }
    const [amendment] = await connection.execute(
      `INSERT INTO gradebook_sheet_amendments
         (sheet_id, sheet_revision_number, amendment_type,
          grade_change_request_id, roster_snapshot_id,
          amendment_reason, previous_values_summary,
          new_values_summary, progression_review_required,
          requested_by_user_id, authorized_by_user_id,
          authorized_at, verified_by_user_id, verified_at,
          applied_by_user_id, applied_at)
       VALUES (?, ?, 'INC_COMPLETION', ?, ?, ?, ?, ?, 1,
               ?, ?, ?, ?, NOW(), ?, NOW())`,
      [
        String(sheet.sheet_id),
        nextRevision,
        input.requestId,
        rosterSnapshotId,
        input.remarks,
        JSON.stringify(previous),
        JSON.stringify(next),
        Number(change.requested_by),
        Number(change.reviewed_by),
        change.reviewed_at,
        registrarId,
        registrarId,
      ],
    );
    if (Number(amendment.affectedRows) !== 1) {
      throw new Error("INC completion amendment insert failed.");
    }
    const [trail] = await connection.execute(
      `INSERT INTO audit_trail
         (user_id, table_name, record_id, action, old_values, new_values, created_at)
       VALUES (?, 'grades', ?, 'UPDATE', ?, ?, NOW())`,
      [registrarId, gradeId, JSON.stringify(previous), JSON.stringify(next)],
    );
    if (Number(trail.affectedRows) !== 1)
      throw new Error("Official-grade audit trail insert failed.");
    const [log] = await connection.execute(
      `INSERT INTO audit_logs
         (user_id, action, table_name, record_id, description, created_at)
       VALUES (?, 'INC COMPLETION PROCESSED', 'grades', ?, ?, NOW())`,
      [
        registrarId,
        gradeId,
        JSON.stringify({
          grade_change_request_id: input.requestId,
          claim_id: input.claimId,
          amendment_id: String(amendment.insertId),
          sheet_revision_number: nextRevision,
          previous,
          next,
          progression_review_required: true,
        }),
      ],
    );
    if (Number(log.affectedRows) !== 1)
      throw new Error("Official-grade audit log insert failed.");

    if (input.dryRun) await connection.rollback();
    else await connection.commit();
    transactionOpen = false;
    return res.status(200).json({
      success: true,
      dry_run: input.dryRun,
      persisted: !input.dryRun,
      grade_id: gradeId,
      claim_id: input.claimId,
      grade_change_request_id: input.requestId,
      sheet_id: String(sheet.sheet_id),
      amendment_id: input.dryRun ? null : String(amendment.insertId),
      sheet_revision_number: nextRevision,
      official_grade: numericResult,
      previous_official_grade: previous,
      enrollment_subject_status: newSubjectStatus,
      progression_review_required: true,
      official_grade_unchanged: input.dryRun,
      note: input.dryRun
        ? "All updates rolled back. Protected official INC grade is unchanged."
        : "Registrar applied an authorized INC conversion with immutable official-sheet amendment and audit trail.",
    });
  } catch (error) {
    if (transactionOpen && connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("INC conversion rollback failed:", rollbackError);
      }
    }
    if (error?.code === "ER_DUP_ENTRY") {
      return sendError(res, {
        httpStatus: 409,
        code: "INC_CONVERSION_CONFLICT",
        message:
          "A concurrent official-sheet amendment or request conversion was saved.",
      });
    }
    return sendError(res, error);
  } finally {
    if (gradeGuardOn && connection) {
      try {
        await connection.execute("SET @allow_approved_inc_grade_change = NULL");
      } catch (cleanupError) {
        console.error(
          "CRITICAL: INC conversion session guard reset failed:",
          cleanupError,
        );
      }
    }
    // Never return an errored pooled connection with a session grade-write bypass.
    if (connection) {
      try {
        await connection.execute("SET @allow_approved_inc_grade_change = NULL");
        await connection.execute("SET @allow_approved_grade_correction = NULL");
        connection.release();
      } catch (cleanupError) {
        // Terminate suspect connection; do not return it to pool.
        console.error(
          "CRITICAL: failed to reset INC conversion session flags:",
          cleanupError,
        );
        connection.destroy();
      }
    }
  }
});

router.post("/grades/:gradeId/process-expiry", async (req, res) => {
  let connection = null;
  let inTransaction = false;
  let guardEnabled = false;
  try {
    const gradeId = positiveId(req.params.gradeId);
    if (!gradeId)
      requestError(
        400,
        "INC_EXPIRY_GRADE_ID_INVALID",
        "A positive gradeId is required.",
      );
    if (Object.keys(req.query ?? {}).length) {
      requestError(
        400,
        "INC_EXPIRY_QUERY_UNSUPPORTED",
        "Query parameters are unsupported.",
      );
    }
    const body = req.body;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (key) =>
          ![
            "expected_sheet_id",
            "expected_sheet_record_version",
            "expiry_reason",
            "confirm_inc_expiry",
            "dry_run",
          ].includes(key),
      )
    ) {
      requestError(
        400,
        "INC_EXPIRY_BODY_INVALID",
        "Unexpected expiry request fields.",
      );
    }
    const sheetId =
      typeof body.expected_sheet_id === "string" &&
      /^[1-9]\d{0,19}$/.test(body.expected_sheet_id) &&
      BigInt(body.expected_sheet_id) <= 18446744073709551615n
        ? body.expected_sheet_id
        : null;
    const sheetVersion = positiveId(body.expected_sheet_record_version);
    const reason =
      typeof body.expiry_reason === "string" ? body.expiry_reason.trim() : "";
    if (
      !sheetId ||
      !sheetVersion ||
      reason.length < 20 ||
      reason.length > 400 ||
      /[\x00-\x08\x0B\x0E-\x1F\x7F]/.test(reason) ||
      body.confirm_inc_expiry !== true ||
      typeof body.dry_run !== "boolean"
    ) {
      requestError(
        400,
        "INC_EXPIRY_INPUT_INVALID",
        "Provide sheet ID/version, documented expiry_reason (20–400 chars), confirmation, and boolean dry_run.",
      );
    }

    connection = await db.getConnection();
    // Clear pooled-session grade-write permissions before beginning work.
    await connection.execute("SET @allow_approved_inc_expiry = NULL");
    await connection.execute("SET @allow_approved_inc_grade_change = NULL");
    await connection.execute("SET @allow_approved_grade_correction = NULL");
    await connection.beginTransaction();
    inTransaction = true;

    // Registrar grading writes remain QA-only.
    await assertQaGradingDatabase(connection);
    await assertTestDatabase(connection);
    const registrarId = await activeRegistrar(connection, req);

    // Resolve scope before taking locks. Revalidate after locking.
    const [scope] = await connection.execute(
      `SELECT es.enrollment_subject_id, es.offering_id, cfg.config_id
         FROM grades g
         JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
         JOIN gradebook_offering_config cfg ON cfg.offering_id = es.offering_id
        WHERE g.grade_id = ?`,
      [gradeId],
    );
    if (scope.length !== 1 || Number(scope[0].offering_id) !== QA_OFFERING_ID) {
      requestError(
        404,
        "INC_EXPIRY_GRADE_NOT_FOUND",
        "No approved INC in QA Offering #131 was found.",
      );
    }
    const enrollmentSubjectId = Number(scope[0].enrollment_subject_id);
    const configId = Number(scope[0].config_id);
    const [offerings] = await connection.execute(
      "SELECT offering_id, faculty_id, status FROM subject_offerings WHERE offering_id = ? FOR UPDATE",
      [QA_OFFERING_ID],
    );
    if (offerings.length !== 1 || offerings[0].status === "Cancelled") {
      requestError(
        409,
        "INC_EXPIRY_OFFERING_INVALID",
        "The original offering must still exist.",
      );
    }
    const [configs] = await connection.execute(
      "SELECT config_id FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE",
      [QA_OFFERING_ID],
    );
    if (configs.length !== 1 || Number(configs[0].config_id) !== configId) {
      requestError(
        409,
        "INC_EXPIRY_CONFIG_CHANGED",
        "Offering configuration changed.",
      );
    }
    const [enrollments] = await connection.execute(
      `SELECT es.enrollment_subject_id, es.offering_id, es.status AS subject_status,
              e.enrollment_status
         FROM enrollment_subjects es
         JOIN enrollments e ON e.enrollment_id = es.enrollment_id
        WHERE es.enrollment_subject_id = ? FOR UPDATE`,
      [enrollmentSubjectId],
    );
    if (
      enrollments.length !== 1 ||
      Number(enrollments[0].offering_id) !== QA_OFFERING_ID ||
      enrollments[0].subject_status !== "Incomplete" ||
      enrollments[0].enrollment_status !== "Approved"
    ) {
      requestError(
        409,
        "INC_EXPIRY_ENROLLMENT_INVALID",
        "The enrollment must remain Approved and Incomplete.",
      );
    }
    const [grades] = await connection.execute(
      `SELECT grade_id, enrollment_subject_id, faculty_id, grading_policy,
              grading_outcome, grade_status, midterm_grade, final_grade,
              overall_percentage, final_rating, remarks, outcome_reason
         FROM grades WHERE enrollment_subject_id = ? FOR UPDATE`,
      [enrollmentSubjectId],
    );
    if (
      grades.length !== 1 ||
      Number(grades[0].grade_id) !== gradeId ||
      grades[0].grade_status !== "Approved" ||
      grades[0].grading_policy !== "TWO_TERM_50_50" ||
      grades[0].grading_outcome !== "INCOMPLETE" ||
      grades[0].remarks !== "Incomplete" ||
      Number(grades[0].final_rating) !== 4 ||
      Number(grades[0].faculty_id) !== Number(offerings[0].faculty_id)
    ) {
      requestError(
        409,
        "INC_EXPIRY_GRADE_CHANGED",
        "The original Approved INC 4.00 is no longer eligible.",
      );
    }
    const grade = grades[0];
    const [originalOutcomes] = await connection.execute(
      `SELECT inc_request_id, request_status FROM gradebook_inc_outcome_requests
        WHERE config_id = ? AND enrollment_subject_id = ? FOR UPDATE`,
      [configId, enrollmentSubjectId],
    );
    if (
      originalOutcomes.length !== 1 ||
      originalOutcomes[0].request_status !== "APPROVED"
    ) {
      requestError(
        409,
        "INC_EXPIRY_ORIGINAL_APPROVAL_MISSING",
        "The original INC outcome approval is required.",
      );
    }
    const [sheets] = await connection.execute(
      `SELECT sheet_id, sheet_status, config_id, record_version,
              DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_date,
              official_submission_reference, official_date_verified_by_user_id,
              official_date_verified_at, finalized_by_user_id, finalized_at,
              DATE_FORMAT(DATE_ADD(original_official_submitted_on, INTERVAL 1 YEAR), '%Y-%m-%d') AS deadline_on
         FROM gradebook_official_sheets WHERE config_id = ? FOR UPDATE`,
      [configId],
    );
    if (
      sheets.length !== 1 ||
      String(sheets[0].sheet_id) !== sheetId ||
      Number(sheets[0].record_version) !== sheetVersion ||
      sheets[0].sheet_status !== "FINALIZED" ||
      !sheets[0].finalized_by_user_id ||
      !sheets[0].finalized_at ||
      !sheets[0].original_date ||
      !String(sheets[0].official_submission_reference ?? "").trim() ||
      !sheets[0].official_date_verified_by_user_id ||
      !sheets[0].official_date_verified_at
    ) {
      requestError(
        409,
        "INC_EXPIRY_SHEET_UNVERIFIED",
        "A matching finalized, Registrar-verified official sheet is required.",
      );
    }
    const sheet = sheets[0];
    const [[clock]] = await connection.execute(
      "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today",
    );
    if (!sheet.deadline_on || clock.today <= sheet.deadline_on) {
      requestError(
        409,
        "INC_EXPIRY_DEADLINE_NOT_PASSED",
        "The verified one-year deadline has not passed.",
      );
    }
    const [sheetEvents] = await connection.execute(
      `SELECT event_type, record_version_after,
              DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_date,
              official_submission_reference, performed_by_user_id
         FROM gradebook_official_sheet_submission_events WHERE sheet_id = ?
        ORDER BY record_version_after FOR UPDATE`,
      [sheetId],
    );
    if (
      sheetEvents.length !== 2 ||
      sheetEvents[0].event_type !== "RECORDED" ||
      Number(sheetEvents[0].record_version_after) !== 1 ||
      sheetEvents[1].event_type !== "VERIFIED" ||
      Number(sheetEvents[1].record_version_after) !== 2 ||
      sheetEvents.some(
        (event) =>
          event.original_date !== sheet.original_date ||
          event.official_submission_reference !==
            sheet.official_submission_reference,
      ) ||
      Number(sheetEvents[1].performed_by_user_id) !==
        Number(sheet.official_date_verified_by_user_id)
    ) {
      requestError(
        409,
        "INC_EXPIRY_SHEET_AUDIT_INVALID",
        "Official-sheet date audit is inconsistent.",
      );
    }
    const [claims] = await connection.execute(
      `SELECT claim_id, verification_status, grade_change_request_id,
              DATE_FORMAT(verified_completed_on, '%Y-%m-%d') AS verified_completed_on,
              verified_by_user_id, record_version
         FROM gradebook_inc_completion_claims WHERE grade_id = ? FOR UPDATE`,
      [gradeId],
    );
    if (claims.length > 1) {
      requestError(
        409,
        "INC_EXPIRY_CLAIM_CONFLICT",
        "Duplicate completion claims require reconciliation.",
      );
    }
    const claim = claims[0] ?? null;
    if (
      claim &&
      (claim.grade_change_request_id !== null ||
        !["VERIFIED_LATE", "REJECTED"].includes(claim.verification_status))
    ) {
      requestError(
        409,
        "INC_EXPIRY_CLAIM_PROTECTED",
        "A timely or undecided completion claim cannot be expired.",
      );
    }
    if (claim) {
      const [events] = await connection.execute(
        `SELECT event_type, new_status, new_verified_completed_on,
                DATE_FORMAT(new_verified_completed_on, '%Y-%m-%d') AS verified_date,
                performed_by_user_id, claim_version_after
           FROM gradebook_inc_completion_claim_events WHERE claim_id = ?
          ORDER BY claim_version_after FOR UPDATE`,
        [String(claim.claim_id)],
      );
      const last = events.at(-1);
      const expectedEventType =
        claim.verification_status === "REJECTED" ? "REJECTED" : "VERIFIED";
      if (
        events.length !== Number(claim.record_version) ||
        !events.length ||
        events[0].event_type !== "CREATED" ||
        !events.every((ev, i) => Number(ev.claim_version_after) === i + 1) ||
        last.event_type !== expectedEventType ||
        last.new_status !== claim.verification_status ||
        last.verified_date !== claim.verified_completed_on ||
        (claim.verification_status === "VERIFIED_LATE" &&
          (!claim.verified_completed_on ||
            claim.verified_completed_on <= sheet.deadline_on ||
            Number(last.performed_by_user_id) !==
              Number(claim.verified_by_user_id))) ||
        (claim.verification_status === "REJECTED" &&
          claim.verified_completed_on !== null)
      ) {
        requestError(
          409,
          "INC_EXPIRY_CLAIM_AUDIT_INVALID",
          "Claim evidence/audit requires reconciliation.",
        );
      }
    }
    const [requests] = await connection.execute(
      `SELECT grade_change_request_id, status FROM grade_change_requests
        WHERE grade_id = ? AND request_type = 'INC_COMPLETION'
          AND status IN ('Pending Program Head','For Registrar Processing','Returned','Completed')
        FOR UPDATE`,
      [gradeId],
    );
    if (requests.length) {
      requestError(
        409,
        "INC_EXPIRY_REQUEST_CONFLICT",
        "A completion-grade change request requires reconciliation before expiry.",
      );
    }
    const [previousExpiry] = await connection.execute(
      "SELECT expiry_id FROM gradebook_inc_expiry_actions WHERE grade_id = ? FOR UPDATE",
      [gradeId],
    );
    if (previousExpiry.length) {
      requestError(
        409,
        "INC_EXPIRY_ALREADY_PROCESSED",
        "This grade has already been expired.",
      );
    }
    const [revisions] = await connection.execute(
      `SELECT sheet_revision_number FROM gradebook_sheet_amendments
        WHERE sheet_id = ? ORDER BY sheet_revision_number DESC LIMIT 1 FOR UPDATE`,
      [sheetId],
    );
    const nextRevision = revisions.length
      ? Number(revisions[0].sheet_revision_number) + 1
      : 1;
    if (!Number.isSafeInteger(nextRevision) || nextRevision > 4294967295) {
      requestError(
        409,
        "INC_EXPIRY_REVISION_LIMIT",
        "Official-sheet revision limit was reached.",
      );
    }
    const previous = {
      grade_id: gradeId,
      grade_status: grade.grade_status,
      grading_policy: grade.grading_policy,
      grading_outcome: grade.grading_outcome,
      midterm_grade: grade.midterm_grade,
      final_grade: grade.final_grade,
      overall_percentage: grade.overall_percentage,
      final_rating: grade.final_rating,
      remarks: grade.remarks,
      outcome_reason: grade.outcome_reason,
      subject_status: enrollments[0].subject_status,
    };
    const outcomeReason = `Expired INC after verified deadline ${sheet.deadline_on}. ${reason}`;
    if (outcomeReason.length > 500) {
      requestError(
        400,
        "INC_EXPIRY_REASON_TOO_LONG",
        "Expiry outcome reason cannot exceed 500 characters.",
      );
    }
    const next = {
      ...previous,
      grading_outcome: "EXPIRED_INCOMPLETE",
      overall_percentage: null,
      final_rating: "5.00",
      remarks: "Failed",
      outcome_reason: outcomeReason,
      subject_status: "Failed",
      sheet_id: sheetId,
      original_official_submitted_on: sheet.original_date,
      deadline_on: sheet.deadline_on,
      completion_claim_id: claim ? String(claim.claim_id) : null,
      review_type: "REGISTRAR_AUTHORIZED_INC_EXPIRY",
    };
    // Use the existing connection-local grade trigger override for THIS UPDATE only.
    let update;
    await connection.execute("SET @allow_approved_inc_expiry = 1");
    guardEnabled = true;
    try {
      [update] = await connection.execute(
        `UPDATE grades SET grading_outcome = 'EXPIRED_INCOMPLETE',
             outcome_reason = ?, grade_status = 'Approved'
          WHERE grade_id = ? AND grade_status = 'Approved'
            AND grading_outcome = 'INCOMPLETE' AND final_rating = 4.00`,
        [outcomeReason, gradeId],
      );
    } finally {
      await connection.execute("SET @allow_approved_inc_expiry = NULL");
      guardEnabled = false;
    }
    if (Number(update.affectedRows) !== 1) {
      requestError(
        409,
        "INC_EXPIRY_GRADE_CONFLICT",
        "Grade changed during expiry processing.",
      );
    }
    const [afterGrade] = await connection.execute(
      "SELECT grading_outcome, grade_status, final_rating, remarks, overall_percentage FROM grades WHERE grade_id = ?",
      [gradeId],
    );
    if (
      afterGrade.length !== 1 ||
      afterGrade[0].grading_outcome !== "EXPIRED_INCOMPLETE" ||
      afterGrade[0].grade_status !== "Approved" ||
      Number(afterGrade[0].final_rating) !== 5 ||
      afterGrade[0].remarks !== "Failed" ||
      afterGrade[0].overall_percentage !== null
    ) {
      throw new Error(
        "Grade expiry trigger did not produce the required nonnumeric 5.00 outcome.",
      );
    }
    // The grades AFTER UPDATE trigger already sets the subject to Failed.
    const [subjectRows] = await connection.execute(
      `SELECT status FROM enrollment_subjects
        WHERE enrollment_subject_id = ?`,
      [enrollmentSubjectId],
    );
    if (subjectRows.length !== 1 || subjectRows[0].status !== "Failed") {
      requestError(
        409,
        "INC_EXPIRY_SUBJECT_CONFLICT",
        "The official-grade trigger did not set the subject status to Failed.",
      );
    }
    const [amendment] = await connection.execute(
      `INSERT INTO gradebook_sheet_amendments
         (sheet_id, sheet_revision_number, amendment_type, grade_change_request_id,
          roster_snapshot_id, amendment_reason, previous_values_summary, new_values_summary,
          progression_review_required, requested_by_user_id, authorized_by_user_id,
          authorized_at, verified_by_user_id, verified_at, applied_by_user_id, applied_at)
       VALUES (?, ?, 'INC_EXPIRY', NULL, NULL, ?, ?, ?, 1,
               ?, ?, NOW(), ?, NOW(), ?, NOW())`,
      [
        sheetId,
        nextRevision,
        reason,
        JSON.stringify(previous),
        JSON.stringify(next),
        registrarId,
        registrarId,
        registrarId,
        registrarId,
      ],
    );
    if (Number(amendment.affectedRows) !== 1) {
      throw new Error("INC expiry amendment insert failed.");
    }
    const [expiryAudit] = await connection.execute(
      `INSERT INTO gradebook_inc_expiry_actions
         (grade_id, sheet_id, amendment_id, deadline_on, expiry_reason, processed_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        gradeId,
        sheetId,
        String(amendment.insertId),
        sheet.deadline_on,
        reason,
        registrarId,
      ],
    );
    if (Number(expiryAudit.affectedRows) !== 1) {
      throw new Error("INC expiry action insert failed.");
    }
    const [trail] = await connection.execute(
      `INSERT INTO audit_trail
         (user_id, table_name, record_id, action, old_values, new_values, created_at)
       VALUES (?, 'grades', ?, 'UPDATE', ?, ?, NOW())`,
      [registrarId, gradeId, JSON.stringify(previous), JSON.stringify(next)],
    );
    if (Number(trail.affectedRows) !== 1)
      throw new Error("INC expiry audit_trail insert failed.");
    const [log] = await connection.execute(
      `INSERT INTO audit_logs
         (user_id, action, table_name, record_id, description, created_at)
       VALUES (?, 'INC EXPIRY PROCESSED', 'grades', ?, ?, NOW())`,
      [
        registrarId,
        gradeId,
        JSON.stringify({
          expiry_id: String(expiryAudit.insertId),
          amendment_id: String(amendment.insertId),
          sheet_id: sheetId,
          deadline_on: sheet.deadline_on,
          previous,
          next,
        }),
      ],
    );
    if (Number(log.affectedRows) !== 1)
      throw new Error("INC expiry audit_logs insert failed.");

    if (body.dry_run) await connection.rollback();
    else await connection.commit();
    inTransaction = false;
    return res.status(200).json({
      success: true,
      dry_run: body.dry_run,
      persisted: !body.dry_run,
      grade_id: gradeId,
      expiry_status: "EXPIRED_INCOMPLETE",
      official_rating: body.dry_run ? "4.00" : "5.00",
      simulated_rating: body.dry_run ? "5.00" : null,
      sheet_id: sheetId,
      deadline_on: sheet.deadline_on,
      amendment_id: body.dry_run ? null : String(amendment.insertId),
      expiry_id: body.dry_run ? null : String(expiryAudit.insertId),
      progression_review_required: true,
      official_grade_unchanged: body.dry_run,
    });
  } catch (error) {
    if (connection && guardEnabled) {
      try {
        await connection.execute("SET @allow_approved_inc_expiry = NULL");
      } catch (resetError) {
        console.error("INC EXPIRY GUARD RESET FAILED", resetError);
      }
    }
    if (connection && inTransaction) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("INC EXPIRY ROLLBACK FAILED", rollbackError);
      }
    }
    return sendError(res, error);
  } finally {
    if (connection) {
      try {
        // Never return a connection to the pool with an approved-grade bypass.
        await connection.execute("SET @allow_approved_inc_expiry = NULL");
        await connection.execute("SET @allow_approved_inc_grade_change = NULL");
        await connection.execute("SET @allow_approved_grade_correction = NULL");
        connection.release();
      } catch (cleanupError) {
        console.error(
          "CRITICAL: failed to clear INC expiry session flags:",
          cleanupError,
        );
        connection.destroy();
      }
    }
  }
});

// Modern INC Expiration Readiness
router.get("/modern-expiry/grades/:gradeId/readiness", async (req, res) => {
  let connection = null;
  let inTransaction = false;

  try {
    const gradeId = positiveId(req.params.gradeId);

    if (!gradeId || Object.keys(req.query ?? {}).length) {
      return res.status(400).json({
        success: false,
        code: "MODERN_INC_EXPIRY_READINESS_INPUT_INVALID",
        message: "Provide a positive grade ID without query parameters.",
      });
    }

    connection = await db.getConnection();

    await connection.query("START TRANSACTION READ ONLY");
    inTransaction = true;

    await assertTestDatabase(connection);
    await activeRegistrar(connection, req);

    const result = await inspectModernIncExpiryReadiness(connection, gradeId);

    await connection.rollback();
    inTransaction = false;

    return res.status(200).json(result);
  } catch (error) {
    if (inTransaction && connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("MODERN INC EXPIRY READINESS ROLLBACK:", rollbackError);

        connection.destroy();
        connection = null;
      }
    }

    return sendError(res, error);
  } finally {
    if (connection) connection.release();
  }
});
router.post("/modern-expiry/grades/:gradeId/process", async (req, res) => {
  let connection = null;
  let inTransaction = false;
  try {
    const gradeId = positiveId(req.params.gradeId);
    if (!gradeId || Object.keys(req.query ?? {}).length) {
      return res.status(400).json({
        success: false,
        code: "MODERN_INC_EXPIRY_INPUT_INVALID",
        message: "Provide a positive grade ID without query parameters.",
      });
    }
    connection = await db.getConnection();
    await connection.execute("SET @allow_approved_inc_expiry = NULL");
    await connection.execute("SET @allow_approved_inc_grade_change = NULL");
    await connection.execute("SET @allow_approved_grade_correction = NULL");
    await connection.beginTransaction();
    inTransaction = true;

    // Registrar grading writes remain QA-only.
    await assertQaGradingDatabase(connection);
    await assertTestDatabase(connection);
    const registrarId = await activeRegistrar(connection, req);
    const result = await processModernIncExpiry(
      connection,
      registrarId,
      gradeId,
      req.body,
    );
    if (req.body.dry_run) await connection.rollback();
    else await connection.commit();
    inTransaction = false;
    return res.status(200).json(result);
  } catch (error) {
    if (inTransaction && connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("MODERN INC EXPIRY ROLLBACK:", rollbackError);
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
        code: "MODERN_INC_EXPIRY_CONFLICT",
        message:
          "A concurrent operation changed the official grade. Reload and retry.",
      });
    }
    return sendError(res, error);
  } finally {
    if (connection) {
      try {
        await connection.execute("SET @allow_approved_inc_expiry = NULL");
        await connection.execute("SET @allow_approved_inc_grade_change = NULL");
        await connection.execute("SET @allow_approved_grade_correction = NULL");
        connection.release();
      } catch (cleanupError) {
        console.error("MODERN INC EXPIRY SESSION CLEANUP:", cleanupError);
        connection.destroy();
      }
    }
  }
});

router.post(
  "/modern-score-corrections/:correctionId/process",
  async (req, res) => {
    let connection = null;
    let transactionOpen = false;
    try {
      const correctionId = String(req.params.correctionId ?? "");
      if (
        !/^[1-9]\d{0,19}$/.test(correctionId) ||
        BigInt(correctionId) > 18446744073709551615n ||
        Object.keys(req.query ?? {}).length
      ) {
        return res.status(400).json({
          success: false,
          code: "MODERN_CORRECTION_PROCESS_INPUT_INVALID",
          message:
            "A valid correction ID without query parameters is required.",
        });
      }
      connection = await db.getConnection();
      await connection.execute("SET @allow_approved_grade_correction = NULL");
      await connection.execute("SET @allow_approved_inc_grade_change = NULL");
      await connection.execute("SET @allow_approved_inc_expiry = NULL");
      await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      await connection.beginTransaction();
      transactionOpen = true;

      // Registrar grading writes remain QA-only.
      await assertQaGradingDatabase(connection);
      await assertTestDatabase(connection);
      const registrarId = await activeRegistrar(connection, req);
      const result = await processModernScoreCorrection(
        connection,
        registrarId,
        correctionId,
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
          console.error("MODERN CORRECTION ROLLBACK:", rollbackError);
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
          code: "MODERN_CORRECTION_PROCESS_CONFLICT",
          message: "Concurrent correction detected; reload the request.",
        });
      }
      const httpStatus = Number(error?.httpStatus ?? error?.status);
      if (
        Number.isInteger(httpStatus) &&
        httpStatus >= 400 &&
        httpStatus < 500
      ) {
        return res
          .status(httpStatus)
          .json({ success: false, code: error.code, message: error.message });
      }
      return sendError(res, error);
    } finally {
      if (connection) {
        try {
          await connection.execute(
            "SET @allow_approved_grade_correction = NULL",
          );
          await connection.execute(
            "SET @allow_approved_inc_grade_change = NULL",
          );
          await connection.execute("SET @allow_approved_inc_expiry = NULL");
          connection.release();
        } catch (cleanupError) {
          console.error("MODERN CORRECTION CONNECTION CLEANUP:", cleanupError);
          connection.destroy();
        }
      }
    }
  },
);

// Modern INC conversion
router.post("/modern-submissions/:submissionId/process", async (req, res) => {
  let connection = null;
  let transactionOpen = false;

  try {
    const submissionId = String(req.params.submissionId ?? "");

    if (
      !/^[1-9]\d{0,19}$/.test(submissionId) ||
      BigInt(submissionId) > 18446744073709551615n ||
      Object.keys(req.query ?? {}).length
    ) {
      return res.status(400).json({
        success: false,
        code: "MODERN_INC_CONVERSION_REQUEST_INVALID",
        message:
          "A positive submission ID without query parameters is required.",
      });
    }

    connection = await db.getConnection();

    await connection.execute("SET @allow_approved_inc_grade_change = NULL");
    await connection.execute("SET @allow_approved_grade_correction = NULL");
    await connection.execute("SET @allow_approved_inc_expiry = NULL");
    await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");

    await connection.beginTransaction();
    transactionOpen = true;

    await assertQaGradingDatabase(connection);
    await assertTestDatabase(connection);

    const registrarId = await activeRegistrar(connection, req);

    const result = await processModernIncConversion(
      connection,
      registrarId,
      submissionId,
      req.body,
      calculateGradePreview,
    );

    if (req.body?.dry_run === true) {
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
        console.error("MODERN INC CONVERSION ROLLBACK:", rollbackError);
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
        code: "MODERN_INC_CONVERSION_CONFLICT",
        message: "Concurrent conversion detected. Reload and retry.",
      });
    }

    const status = error?.httpStatus ?? error?.status;

    if (Number.isInteger(status) && status >= 400 && status < 500) {
      return res.status(status).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }

    console.error("MODERN INC CONVERSION:", error);

    return res.status(500).json({
      success: false,
      code: "MODERN_INC_CONVERSION_ERROR",
      message: "The modern INC conversion could not be processed.",
    });
  } finally {
    if (connection) {
      try {
        await connection.execute("SET @allow_approved_inc_grade_change = NULL");
        await connection.execute("SET @allow_approved_grade_correction = NULL");
        await connection.execute("SET @allow_approved_inc_expiry = NULL");

        connection.release();
      } catch (cleanupError) {
        console.error("MODERN INC CONVERSION CLEANUP:", cleanupError);
        connection.destroy();
      }
    }
  }
});

export default router;
