// Registrar read-only check for modern combined-semester INC expiration.
// No grade writes, clock overrides, or synthetic official records.

import {
  evaluateModernIncExpiryEligibility,
  ptcToday,
} from "./gradebookModernIncExpiryPolicy.service.js";

const eq = (a, b) => a != null && b != null && String(a) === String(b);
const yyyyMmDd = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function notFound(message) {
  const error = new Error(message);
  error.httpStatus = 404;
  error.code = "MODERN_INC_EXPIRY_GRADE_NOT_FOUND";
  throw error;
}

function addBlocker(blockers, condition, code, message) {
  if (!condition) blockers.push({ code, message });
}

export async function inspectModernIncExpiryReadiness(connection, gradeId) {
  const [rows] = await connection.execute(
    `SELECT g.grade_id, g.enrollment_subject_id, g.faculty_id AS grade_faculty_id,
            g.grade_status, g.grading_policy, g.grading_outcome,
            g.midterm_grade, g.final_grade, g.overall_percentage, g.final_rating,
            g.remarks, g.outcome_reason,
            es.status AS subject_status, es.offering_id,
            e.student_id, e.enrollment_status, e.academic_year_id AS enrollment_year_id,
            e.semester_id AS enrollment_semester_id,
            so.faculty_id AS offering_faculty_id, so.academic_year_id AS offering_year_id,
            so.semester_id AS offering_semester_id,
            f.user_id AS instructor_user_id,
            u.is_active AS instructor_active, u.is_archived AS instructor_archived,
            r.role_name AS instructor_role
       FROM grades g
       JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
       JOIN enrollments e ON e.enrollment_id = es.enrollment_id
       JOIN subject_offerings so ON so.offering_id = es.offering_id
       LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
       LEFT JOIN users u ON u.user_id = f.user_id
       LEFT JOIN roles r ON r.role_id = u.role_id
      WHERE g.grade_id = ?`,
    [gradeId],
  );
  if (rows.length !== 1) notFound("The official grade was not found.");
  const grade = rows[0];
  const blockers = [];
  const activeInc =
    grade.grade_status === "Approved" &&
    grade.grading_outcome === "INCOMPLETE" &&
    Number(grade.final_rating) === 4 &&
    grade.subject_status === "Incomplete";

  addBlocker(
    blockers,
    grade.enrollment_status === "Approved" &&
      eq(grade.enrollment_year_id, grade.offering_year_id) &&
      eq(grade.enrollment_semester_id, grade.offering_semester_id),
    "INC_EXPIRY_ENROLLMENT_SOURCE_INVALID",
    "The original approved enrollment and offering period do not match.",
  );
  addBlocker(
    blockers,
    eq(grade.grade_faculty_id, grade.offering_faculty_id) &&
      Number(grade.instructor_active) === 1 &&
      Number(grade.instructor_archived) === 0 &&
      ["Faculty", "Program Head"].includes(grade.instructor_role),
    "INC_EXPIRY_INSTRUCTOR_SOURCE_INVALID",
    "The original assigned instructor is missing or inactive.",
  );
  addBlocker(
    blockers,
    grade.grading_policy === "TWO_TERM_50_50",
    "INC_EXPIRY_POLICY_SOURCE_INVALID",
    "This is not a modern two-term official grade.",
  );

  const [configRows] = await connection.execute(
    `SELECT config_id, midterm_percent, final_term_percent
       FROM gradebook_offering_config WHERE offering_id = ?`,
    [grade.offering_id],
  );
  const config = configRows.length === 1 ? configRows[0] : null;
  addBlocker(
    blockers,
    !!config &&
      Number(config.midterm_percent) === 50 &&
      Number(config.final_term_percent) === 50,
    "INC_EXPIRY_CONFIG_SOURCE_INVALID",
    "The offering must have one valid 50/50 grading configuration.",
  );

  let sheet = null;
  let roster = null;
  let publication = null;
  let submission = null;

  if (config) {
    const [sheets] = await connection.execute(
      `SELECT sheet_id, config_id, sheet_status, record_version, finalized_at,
              finalized_by_user_id, finalized_roster_count,
              DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d')
                AS original_official_submitted_on,
              official_submission_reference, official_date_verified_by_user_id,
              official_date_verified_at
         FROM gradebook_official_sheets WHERE config_id = ?`,
      [config.config_id],
    );
    sheet = sheets.length === 1 ? sheets[0] : null;
    addBlocker(
      blockers,
      !!sheet &&
        sheet.sheet_status === "FINALIZED" &&
        !!sheet.finalized_at &&
        !!sheet.finalized_by_user_id &&
        !!sheet.official_date_verified_at &&
        !!sheet.official_date_verified_by_user_id &&
        yyyyMmDd(sheet.original_official_submitted_on) &&
        !!sheet.official_submission_reference &&
        Number(sheet.record_version) >= 3,
      "INC_EXPIRY_OFFICIAL_SHEET_SOURCE_INVALID",
      "A finalized sheet with its verified original submission date is required.",
    );

    if (sheet) {
      const [events] = await connection.execute(
        `SELECT event_type, previous_record_version, record_version_after,
                original_official_submitted_on AS raw_date,
                DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS event_date,
                official_submission_reference, performed_by_user_id
           FROM gradebook_official_sheet_submission_events
          WHERE sheet_id = ? ORDER BY record_version_after, event_id`,
        [sheet.sheet_id],
      );
      const dateAuditValid =
        events.length === 2 &&
        events[0].event_type === "RECORDED" &&
        events[0].previous_record_version === null &&
        Number(events[0].record_version_after) === 1 &&
        events[1].event_type === "VERIFIED" &&
        Number(events[1].previous_record_version) === 1 &&
        Number(events[1].record_version_after) === 2 &&
        eq(
          events[1].performed_by_user_id,
          sheet.official_date_verified_by_user_id,
        ) &&
        events.every(
          (e) =>
            e.event_date === sheet.original_official_submitted_on &&
            e.official_submission_reference ===
              sheet.official_submission_reference,
        );
      addBlocker(
        blockers,
        dateAuditValid,
        "INC_EXPIRY_OFFICIAL_DATE_AUDIT_INVALID",
        "Original official-sheet date audit is incomplete or inconsistent.",
      );

      const [rosters] = await connection.execute(
        `SELECT roster_snapshot_id, sheet_id, grade_id, student_id,
                enrollment_subject_id, roster_disposition, grade_status_snapshot,
                grading_outcome_snapshot, enrollment_subject_status_snapshot,
                final_rating_snapshot, midterm_grade_snapshot,
                final_grade_snapshot, overall_percentage_snapshot,
                grade_remarks_snapshot
           FROM gradebook_finalized_roster
          WHERE sheet_id = ? AND enrollment_subject_id = ?`,
        [sheet.sheet_id, grade.enrollment_subject_id],
      );
      roster = rosters.length === 1 ? rosters[0] : null;
      addBlocker(
        blockers,
        !!roster &&
          eq(roster.grade_id, grade.grade_id) &&
          eq(roster.student_id, grade.student_id) &&
          roster.roster_disposition === "APPROVED_GRADE" &&
          roster.grade_status_snapshot === "Approved" &&
          roster.grading_outcome_snapshot === "INCOMPLETE" &&
          Number(roster.final_rating_snapshot) === 4 &&
          roster.enrollment_subject_status_snapshot === "Incomplete" &&
          roster.grade_remarks_snapshot === "Incomplete" &&
          roster.final_grade_snapshot === null &&
          roster.overall_percentage_snapshot === null,
        "INC_EXPIRY_ORIGINAL_ROSTER_INVALID",
        "The immutable finalized roster must contain the original Approved INC 4.00.",
      );
      if (activeInc && roster) {
        addBlocker(
          blockers,
          Number(grade.midterm_grade) ===
            Number(roster.midterm_grade_snapshot) &&
            grade.final_grade === null &&
            grade.overall_percentage === null,
          "INC_EXPIRY_LIVE_GRADE_DIFFERS_FROM_ORIGINAL",
          "The active INC grade must still match its original Midterm snapshot.",
        );
      }
    }
  }

  const [publications] = await connection.execute(
    `SELECT publication_id, grade_id, config_id, enrollment_subject_id,
            publication_source, grading_outcome_snapshot, combined_submission_id,
            published_by_user_id, published_at
       FROM gradebook_official_grade_publications WHERE grade_id = ?`,
    [gradeId],
  );
  publication = publications.length === 1 ? publications[0] : null;
  addBlocker(
    blockers,
    !!publication &&
      !!config &&
      publication.publication_source === "COMBINED_SEMESTER" &&
      publication.grading_outcome_snapshot === "INCOMPLETE" &&
      eq(publication.config_id, config.config_id) &&
      eq(publication.enrollment_subject_id, grade.enrollment_subject_id) &&
      !!publication.combined_submission_id &&
      !!publication.published_at,
    "INC_EXPIRY_COMBINED_PUBLICATION_INVALID",
    "The original INC must originate from an official combined-semester publication.",
  );

  if (publication) {
    const [attempts] = await connection.execute(
      `SELECT submission_id, grade_id, sheet_id, special_outcome_id,
              grading_scope, grading_outcome_snapshot, final_rating_snapshot,
              submission_status, record_version, submitted_by_user_id,
              reviewed_by_user_id, reviewed_at, returned_edit_scope
         FROM gradebook_grade_submission_attempts WHERE grade_id = ?`,
      [gradeId],
    );
    submission = attempts.length === 1 ? attempts[0] : null;
    addBlocker(
      blockers,
      !!submission &&
        !!sheet &&
        eq(submission.submission_id, publication.combined_submission_id) &&
        eq(submission.sheet_id, sheet.sheet_id) &&
        submission.grading_scope === "FULL_SEMESTER" &&
        submission.grading_outcome_snapshot === "INCOMPLETE" &&
        Number(submission.final_rating_snapshot) === 4 &&
        submission.submission_status === "APPROVED" &&
        Number(submission.record_version) >= 2 &&
        !!submission.special_outcome_id &&
        !!submission.reviewed_at &&
        submission.returned_edit_scope === null &&
        eq(submission.reviewed_by_user_id, publication.published_by_user_id),
      "INC_EXPIRY_ORIGINAL_SUBMISSION_INVALID",
      "The original combined INC submission must be approved and match the publication.",
    );

    if (submission) {
      const [reviews] = await connection.execute(
        `SELECT review_id, review_decision, grading_outcome_snapshot,
                reviewed_by_user_id, submission_version_after, evidence_review_notes
           FROM gradebook_grade_submission_reviews
          WHERE submission_id = ?`,
        [submission.submission_id],
      );
      addBlocker(
        blockers,
        reviews.length === 1 &&
          reviews[0].review_decision === "APPROVED" &&
          reviews[0].grading_outcome_snapshot === "INCOMPLETE" &&
          eq(reviews[0].reviewed_by_user_id, submission.reviewed_by_user_id) &&
          Number(reviews[0].submission_version_after) ===
            Number(submission.record_version) &&
          typeof reviews[0].evidence_review_notes === "string" &&
          reviews[0].evidence_review_notes.trim().length >= 20,
        "INC_EXPIRY_ORIGINAL_REVIEW_INVALID",
        "The required individual Program Head INC evidence approval is missing.",
      );

      const [outcomes] = await connection.execute(
        `SELECT special_outcome_id, outcome_type, record_status
           FROM gradebook_special_outcomes WHERE grade_id = ?`,
        [gradeId],
      );
      addBlocker(
        blockers,
        outcomes.length === 1 &&
          eq(outcomes[0].special_outcome_id, submission.special_outcome_id) &&
          outcomes[0].outcome_type === "INCOMPLETE" &&
          outcomes[0].record_status === "ACTIVE",
        "INC_EXPIRY_SPECIAL_OUTCOME_INVALID",
        "The original approved INC special outcome is missing.",
      );
    }
  }

  const [claims] = await connection.execute(
    `SELECT claim_id, grade_id, record_version, verification_status,
            DATE_FORMAT(claimed_completed_on, '%Y-%m-%d') AS claimed_completed_on,
            DATE_FORMAT(verified_completed_on, '%Y-%m-%d') AS verified_completed_on,
            submitted_by_user_id, verified_by_user_id
       FROM gradebook_inc_completion_claims WHERE grade_id = ?`,
    [gradeId],
  );
  addBlocker(
    blockers,
    claims.length <= 1,
    "INC_EXPIRY_MULTIPLE_CLAIMS",
    "Multiple completion claims need reconciliation.",
  );
  const claim = claims.length === 1 ? claims[0] : null;
  if (claim) {
    const [events] = await connection.execute(
      `SELECT event_type, new_status, claim_version_after, performed_by_user_id,
              DATE_FORMAT(new_claimed_completed_on, '%Y-%m-%d') AS claimed_on,
              DATE_FORMAT(new_verified_completed_on, '%Y-%m-%d') AS verified_on
         FROM gradebook_inc_completion_claim_events
        WHERE claim_id = ? ORDER BY claim_version_after, event_id`,
      [claim.claim_id],
    );
    const last = events.at(-1);
    const auditValid =
      events.length === Number(claim.record_version) &&
      events[0]?.event_type === "CREATED" &&
      events.every((e, i) => Number(e.claim_version_after) === i + 1) &&
      last?.new_status === claim.verification_status &&
      last?.claimed_on === claim.claimed_completed_on &&
      last?.verified_on === claim.verified_completed_on &&
      (claim.verification_status === "PENDING_VERIFICATION" ||
        (claim.verification_status === "REJECTED"
          ? last?.event_type === "REJECTED"
          : last?.event_type === "VERIFIED" &&
            eq(last?.performed_by_user_id, claim.verified_by_user_id)));
    addBlocker(
      blockers,
      auditValid,
      "INC_EXPIRY_CLAIM_AUDIT_INVALID",
      "Completion-claim history does not match the current verification status.",
    );
  }

  const [completionSubmissions] = await connection.execute(
    `SELECT submission_id, submission_status
       FROM gradebook_modern_inc_submissions WHERE grade_id = ?`,
    [gradeId],
  );
  const [requests] = await connection.execute(
    `SELECT grade_change_request_id, status
       FROM grade_change_requests WHERE grade_id = ?
         AND status <> 'Rejected'`,
    [gradeId],
  );
  const [expiryActions] = await connection.execute(
    `SELECT expiry_id FROM gradebook_inc_expiry_actions WHERE grade_id = ?`,
    [gradeId],
  );
  if (roster) {
    const [amendments] = await connection.execute(
      `SELECT amendment_id FROM gradebook_sheet_amendments
        WHERE roster_snapshot_id = ?
          AND amendment_type IN ('INC_COMPLETION','GRADE_CORRECTION','INC_EXPIRY')`,
      [roster.roster_snapshot_id],
    );
    addBlocker(
      blockers,
      amendments.length === 0 || !activeInc,
      "INC_EXPIRY_ORIGINAL_ALREADY_AMENDED",
      "The original roster already has a grade-related amendment.",
    );
  }

  const today = ptcToday();
  const policy = evaluateModernIncExpiryEligibility({
    sheet,
    grade,
    enrollmentSubjectStatus: grade.subject_status,
    claim,
    modernCompletionSubmission: completionSubmissions[0] ?? null,
    hasUnresolvedCorrection: requests.length > 0,
    hasExistingExpiryAction: expiryActions.length > 0,
    today,
  });

  const sourceVerified = blockers.length === 0;
  const eligible =
    sourceVerified && policy.eligible_for_registrar_expiry_review;
  return {
    success: true,
    read_only: true,
    grade_id: Number(grade.grade_id),
    offering_id: Number(grade.offering_id),
    enrollment_subject_id: Number(grade.enrollment_subject_id),
    student_id: Number(grade.student_id),
    official_grade: {
      grade_status: grade.grade_status,
      grading_outcome: grade.grading_outcome,
      final_rating:
        grade.final_rating === null ? null : String(grade.final_rating),
      subject_status: grade.subject_status,
    },
    source: {
      publication_source: publication?.publication_source ?? null,
      publication_id:
        publication?.publication_id == null
          ? null
          : String(publication.publication_id),
      combined_submission_id:
        publication?.combined_submission_id == null
          ? null
          : String(publication.combined_submission_id),
      sheet_id: sheet?.sheet_id == null ? null : String(sheet.sheet_id),
      original_roster_snapshot_id:
        roster?.roster_snapshot_id == null
          ? null
          : String(roster.roster_snapshot_id),
    },
    official_sheet: sheet
      ? {
          sheet_id: String(sheet.sheet_id),
          sheet_status: sheet.sheet_status,
          record_version: Number(sheet.record_version),
          original_official_submitted_on: sheet.original_official_submitted_on,
          inc_completion_deadline_on: policy.deadline_on,
        }
      : null,
    completion_claim: claim
      ? {
          claim_id: String(claim.claim_id),
          verification_status: claim.verification_status,
          record_version: Number(claim.record_version),
        }
      : null,
    modern_completion_submission_count: completionSubmissions.length,
    unresolved_change_request_count: requests.length,
    existing_expiry_action_count: expiryActions.length,
    source_verified: sourceVerified,
    source_blockers: blockers,
    policy_decision: policy,
    eligible_for_registrar_expiry_review: eligible,
    code: sourceVerified ? policy.code : "INC_EXPIRY_SOURCE_NOT_VERIFIED",
    grade_conversion_performed: false,
    official_grade_unchanged: true,
    note: "Read-only evaluation; no grade or official-history record was modified.",
  };
}
