import { randomUUID } from "node:crypto";
import { assertQaGradingDatabase } from "./gradebookQaWriteGuard.service.js";

function reject(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

const eq = (a, b) => a != null && b != null && String(a) === String(b);
const id = (x) => Number.isSafeInteger(Number(x)) && Number(x) > 0;
const json = (x) => {
  try {
    return typeof x === "string" ? JSON.parse(x) : x;
  } catch {
    return null;
  }
};
const canonical = (x) =>
  JSON.stringify(x, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
const textOK = (x, min, max) =>
  typeof x === "string" &&
  x.trim().length >= min &&
  x.trim().length <= max &&
  !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(x);

// Caller opens the transaction, verifies QA database and actor identity,
// and commits/rolls back according to input.dryRun.
export async function resubmitSpecialOutcome(
  connection,
  input,
  calculateGradePreview,
) {
  const {
    offeringId,
    enrollmentSubjectId,
    submissionId,
    expectedVersion,
    actorUserId,
    special,
    dryRun,
  } = input;

  // Keep QA-only validation until both rollout gates are enabled.
  if (
    process.env.GRADEBOOK_COMBINED_SUBMISSION_WRITES_ENABLED !== "true" ||
    process.env.GRADEBOOK_COMBINED_SPECIAL_OUTCOME_WRITES_ENABLED !== "true"
  ) {
    await assertQaGradingDatabase(connection);
  }

  // Require an explicit transaction mode
  if (typeof dryRun !== "boolean") {
    reject(
      "SPECIAL_RESUBMIT_DRY_RUN_REQUIRED",
      "An explicit dryRun value of true or false is required.",
      400,
    );
  }

  // Committed INC/UD resubmissions require both grading rollout gates.
  if (
    dryRun === false &&
    (process.env.GRADEBOOK_COMBINED_SUBMISSION_WRITES_ENABLED !== "true" ||
      process.env.GRADEBOOK_COMBINED_SPECIAL_OUTCOME_WRITES_ENABLED !== "true")
  ) {
    reject(
      "SPECIAL_RESUBMIT_WRITES_DISABLED",
      "Combined INC/UD resubmission is not enabled on this server.",
      403,
    );
  }

  const [offerings] = await connection.execute(
    `SELECT so.offering_id, so.status, so.faculty_id, so.academic_year_id,
            so.semester_id, cr.department_id, f.user_id AS instructor_user_id,
            u.is_active, u.is_archived, r.role_name
       FROM subject_offerings so
       JOIN faculty f ON f.faculty_id = so.faculty_id
       JOIN users u ON u.user_id = f.user_id
       JOIN roles r ON r.role_id = u.role_id
       JOIN sections sec ON sec.section_id = so.section_id
       JOIN courses cr ON cr.course_id = sec.course_id
      WHERE so.offering_id = ? FOR UPDATE`,
    [offeringId],
  );
  const offering = offerings[0];
  if (
    offerings.length !== 1 ||
    offering.status !== "Open" ||
    !eq(offering.instructor_user_id, actorUserId) ||
    Number(offering.is_active) !== 1 ||
    Number(offering.is_archived) !== 0 ||
    !["Faculty", "Program Head"].includes(offering.role_name)
  ) {
    reject(
      "SPECIAL_RESUBMIT_INSTRUCTOR_REQUIRED",
      "An Open offering and its active assigned instructor are required.",
      403,
    );
  }

  const [configs] = await connection.execute(
    `SELECT config_id, midterm_percent, final_term_percent
       FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE`,
    [offeringId],
  );
  const cfg = configs[0];
  if (
    configs.length !== 1 ||
    Number(cfg.midterm_percent) !== 50 ||
    Number(cfg.final_term_percent) !== 50
  ) {
    reject(
      "SPECIAL_RESUBMIT_CONFIG_INVALID",
      "The official combined 50/50 gradebook is required.",
    );
  }
  const configId = Number(cfg.config_id);

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
    !eq(enrollments[0].offering_id, offeringId) ||
    enrollments[0].subject_status !== "Enrolled" ||
    enrollments[0].enrollment_status !== "Approved"
  ) {
    reject(
      "SPECIAL_RESUBMIT_ENROLLMENT_INVALID",
      "An approved, currently enrolled student is required.",
    );
  }

  const [periods] = await connection.execute(
    `SELECT period_id, period_status, submission_deadline_at
       FROM gradebook_submission_periods
      WHERE department_id = ? AND academic_year_id = ? AND semester_id = ?
      FOR UPDATE`,
    [offering.department_id, offering.academic_year_id, offering.semester_id],
  );
  const period = periods[0];
  if (periods.length !== 1 || period.period_status !== "OPEN") {
    reject(
      "SPECIAL_RESUBMIT_PERIOD_CLOSED",
      "The combined semester submission period must be Open.",
    );
  }
  const [[window]] = await connection.execute(
    `SELECT (period_status = 'OPEN' AND
            (submission_deadline_at IS NULL OR NOW() <= submission_deadline_at)) AS allowed
       FROM gradebook_submission_periods WHERE period_id = ? FOR UPDATE`,
    [period.period_id],
  );
  if (Number(window?.allowed) !== 1) {
    reject("SPECIAL_RESUBMIT_DEADLINE", "The submission deadline has passed.");
  }

  const [grades] = await connection.execute(
    `SELECT * FROM grades WHERE enrollment_subject_id = ? FOR UPDATE`,
    [enrollmentSubjectId],
  );
  const grade = grades[0];
  if (
    grades.length !== 1 ||
    grade.grade_status !== "Returned" ||
    grade.grading_policy !== "TWO_TERM_50_50" ||
    !["INCOMPLETE", "UNOFFICIAL_DROP"].includes(grade.grading_outcome) ||
    !eq(grade.faculty_id, offering.faculty_id)
  ) {
    reject(
      "SPECIAL_RESUBMIT_NOT_RETURNED",
      "The student's current special outcome must be Returned.",
    );
  }

  const [sheets] = await connection.execute(
    `SELECT sheet_id, config_id, sheet_status, original_official_submitted_on,
            official_date_verified_at FROM gradebook_official_sheets
      WHERE config_id = ? FOR UPDATE`,
    [configId],
  );
  const sheet = sheets[0];
  if (
    sheets.length !== 1 ||
    sheet.sheet_status !== "IN_PROGRESS" ||
    !eq(sheet.config_id, configId) ||
    sheet.original_official_submitted_on != null ||
    sheet.official_date_verified_at != null
  ) {
    reject(
      "SPECIAL_RESUBMIT_SHEET_FINALIZED",
      "A finalized or verified official sheet is immutable.",
    );
  }
  const [publications] = await connection.execute(
    `SELECT publication_id FROM gradebook_official_grade_publications
      WHERE grade_id = ? FOR UPDATE`,
    [grade.grade_id],
  );
  if (publications.length) {
    reject(
      "SPECIAL_RESUBMIT_PUBLISHED",
      "Published grades require an audited amendment.",
    );
  }
  const [legacy] = await connection.execute(
    `SELECT term_submission_id FROM gradebook_term_submission_attempts
      WHERE config_id = ? LIMIT 1`,
    [configId],
  );
  const [legacyLocks] = await connection.execute(
    `SELECT first_submission_id FROM gradebook_term_structure_locks
      WHERE config_id = ? LIMIT 1`,
    [configId],
  );
  if (legacy.length || legacyLocks.length) {
    reject(
      "SPECIAL_RESUBMIT_LEGACY_HISTORY",
      "Legacy term history cannot mix with combined grading.",
    );
  }
  const [locks] = await connection.execute(
    `SELECT first_submission_id FROM gradebook_structure_locks
      WHERE config_id = ? FOR UPDATE`,
    [configId],
  );
  if (locks.length !== 1 || !id(locks[0].first_submission_id)) {
    reject(
      "SPECIAL_RESUBMIT_STRUCTURE_UNLOCKED",
      "The original combined assessment structure lock is missing.",
    );
  }
  const [originalStructure] = await connection.execute(
    `SELECT submission_id FROM gradebook_grade_submission_attempts
      WHERE submission_id = ? AND sheet_id = ?`,
    [locks[0].first_submission_id, sheet.sheet_id],
  );
  if (originalStructure.length !== 1) {
    reject(
      "SPECIAL_RESUBMIT_STRUCTURE_CHANGED",
      "The original shared structure is not linked to this sheet.",
    );
  }

  const [attempts] = await connection.execute(
    `SELECT * FROM gradebook_grade_submission_attempts
      WHERE grade_id = ? ORDER BY attempt_number DESC, submission_id DESC
      LIMIT 1 FOR UPDATE`,
    [grade.grade_id],
  );
  const old = attempts[0];
  if (
    attempts.length !== 1 ||
    !eq(old.submission_id, submissionId) ||
    !eq(old.period_id, period.period_id) ||
    !eq(old.sheet_id, sheet.sheet_id) ||
    Number(old.record_version) !== expectedVersion ||
    old.submission_status !== "RETURNED" ||
    old.grading_scope !== "FULL_SEMESTER" ||
    old.grading_outcome_snapshot !== grade.grading_outcome ||
    !eq(old.submitted_by_user_id, actorUserId) ||
    !id(old.special_outcome_id) ||
    !["MIDTERM", "FINAL_TERM", "BOTH"].includes(old.returned_edit_scope) ||
    !id(old.reviewed_by_user_id) ||
    old.reviewed_at == null ||
    !eq(grade.reviewed_by, old.reviewed_by_user_id) ||
    String(grade.review_remarks ?? "") !== String(old.review_remarks ?? "") ||
    !Number.isSafeInteger(Number(old.attempt_number)) ||
    Number(old.attempt_number) < 1 ||
    Number(old.attempt_number) >= 4294967295
  ) {
    reject(
      "SPECIAL_RESUBMIT_STALE_RETURN",
      "The latest returned submission, grade or review has changed.",
    );
  }
  const [reviews] = await connection.execute(
    `SELECT review_decision, grading_outcome_snapshot, review_notes,
            evidence_review_notes, returned_edit_scope,
            reviewed_by_user_id, submission_version_after
       FROM gradebook_grade_submission_reviews
      WHERE submission_id = ? FOR UPDATE`,
    [submissionId],
  );
  const review = reviews[0];
  if (
    reviews.length !== 1 ||
    review.review_decision !== "RETURNED" ||
    review.grading_outcome_snapshot !== old.grading_outcome_snapshot ||
    review.returned_edit_scope !== old.returned_edit_scope ||
    !eq(review.reviewed_by_user_id, old.reviewed_by_user_id) ||
    Number(review.submission_version_after) !== expectedVersion ||
    String(review.review_notes ?? "") !== String(old.review_remarks ?? "") ||
    !textOK(review.evidence_review_notes, 20, 2000)
  ) {
    reject(
      "SPECIAL_RESUBMIT_REVIEW_AUDIT_INVALID",
      "The Program Head return review is inconsistent.",
    );
  }

  const [outcomes] = await connection.execute(
    `SELECT * FROM gradebook_special_outcomes WHERE grade_id = ? FOR UPDATE`,
    [grade.grade_id],
  );
  const outcome = outcomes[0];
  if (
    outcomes.length !== 1 ||
    !eq(outcome.special_outcome_id, old.special_outcome_id) ||
    outcome.record_status !== "ACTIVE" ||
    outcome.outcome_type !== grade.grading_outcome ||
    !eq(outcome.created_by_user_id, actorUserId) ||
    Number(outcome.record_version) >= 4294967295
  ) {
    reject(
      "SPECIAL_RESUBMIT_OUTCOME_CHANGED",
      "The original special-outcome record is invalid.",
    );
  }
  const [events] = await connection.execute(
    `SELECT * FROM gradebook_special_outcome_events
      WHERE special_outcome_id = ? ORDER BY record_version_after, event_id FOR UPDATE`,
    [outcome.special_outcome_id],
  );
  if (
    events.length !== Number(outcome.record_version) ||
    events[0]?.event_type !== "CREATED" ||
    !events.every(
      (e, i) =>
        Number(e.record_version_after) === i + 1 &&
        (i === 0 || e.event_type === "UPDATED"),
    ) ||
    events.at(-1)?.new_record_status !== "ACTIVE" ||
    events.at(-1)?.new_outcome_type !== outcome.outcome_type ||
    events.at(-1)?.new_outcome_reason !== outcome.outcome_reason ||
    (events.at(-1)?.new_missing_requirements ?? null) !==
      (outcome.missing_requirements ?? null) ||
    events.at(-1)?.new_evidence_summary !== outcome.evidence_summary
  ) {
    reject(
      "SPECIAL_RESUBMIT_EVIDENCE_AUDIT_CHANGED",
      "The special-outcome evidence audit is inconsistent.",
    );
  }

  const previous = json(old.calculation_snapshot_json);
  const pastEvidence = previous?.special_outcome;
  const official = previous?.official_result;
  const rating = grade.grading_outcome === "INCOMPLETE" ? "4.00" : "6.00";
  if (
    !previous ||
    previous.policy !== "TWO_TERM_50_50" ||
    previous.grading_scope !== "FULL_SEMESTER" ||
    !eq(previous.offering_id, offeringId) ||
    !eq(previous.config_id, configId) ||
    !eq(previous.enrollment_subject_id, enrollmentSubjectId) ||
    !eq(previous.grade_id, grade.grade_id) ||
    !eq(previous.special_outcome_id, outcome.special_outcome_id) ||
    previous.grading_outcome !== grade.grading_outcome ||
    pastEvidence?.outcome_type !== grade.grading_outcome ||
    pastEvidence.outcome_reason !== outcome.outcome_reason ||
    (pastEvidence.missing_requirements ?? null) !==
      (outcome.missing_requirements ?? null) ||
    pastEvidence.evidence_summary !== outcome.evidence_summary ||
    grade.outcome_reason !== outcome.outcome_reason ||
    old.special_outcome_reason_snapshot !== outcome.outcome_reason ||
    Number(grade.final_rating) !== Number(rating) ||
    Number(old.final_rating_snapshot) !== Number(rating) ||
    Number(official?.final_rating) !== Number(rating) ||
    grade.remarks !== (rating === "4.00" ? "Incomplete" : "Unofficial Drop") ||
    grade.final_grade !== null ||
    grade.overall_percentage !== null ||
    old.final_term_percentage_snapshot !== null ||
    old.overall_percentage_snapshot !== null ||
    old.final_term_exact_numerator !== null ||
    old.overall_exact_numerator !== null
  ) {
    reject(
      "SPECIAL_RESUBMIT_ORIGINAL_SNAPSHOT_INVALID",
      "The returned special-grade snapshot no longer matches.",
    );
  }
  if (
    rating === "6.00" &&
    (grade.midterm_grade !== null ||
      old.midterm_percentage_snapshot !== null ||
      old.midterm_exact_numerator !== null)
  ) {
    reject(
      "SPECIAL_RESUBMIT_UD_NUMERIC_CONFLICT",
      "UD must not contain numeric term grades.",
    );
  }
  if (
    rating === "4.00" &&
    (grade.midterm_grade === null ||
      Number(old.midterm_percentage_snapshot) !== Number(grade.midterm_grade) ||
      !/^\d+$/.test(String(old.midterm_exact_numerator ?? "")) ||
      !/^[1-9]\d*$/.test(String(old.midterm_exact_denominator ?? "")) ||
      String(old.midterm_exact_numerator) !==
        String(
          previous.calculated_terms?.MIDTERM?.term_percentage?.exact_numerator,
        ) ||
      String(old.midterm_exact_denominator) !==
        String(
          previous.calculated_terms?.MIDTERM?.term_percentage
            ?.exact_denominator,
        ))
  ) {
    reject(
      "SPECIAL_RESUBMIT_INC_MIDTERM_INVALID",
      "The protected INC Midterm grade is inconsistent.",
    );
  }

  // Evidence-only resubmission: no assessment scores or attendance are edited here.
  const current = await calculateGradePreview(
    connection,
    offeringId,
    enrollmentSubjectId,
    actorUserId,
  );
  if (
    Number(current.config_id) !== configId ||
    canonical(current.terms?.MIDTERM) !==
      canonical(previous.calculated_terms?.MIDTERM) ||
    canonical(current.terms?.FINAL_TERM) !==
      canonical(previous.calculated_terms?.FINAL_TERM) ||
    canonical(current.semester) !== canonical(previous.calculated_semester)
  ) {
    reject(
      "SPECIAL_RESUBMIT_GRADEBOOK_CHANGED",
      "Assessments or term calculations changed; this endpoint revises evidence only.",
    );
  }

  const [pending] = await connection.execute(
    `SELECT a.assessment_id, a.grading_term, a.header_name, oc.category_code,
            a.maximum_score, sc.score_id, sc.record_version
       FROM gradebook_assessments a
       JOIN gradebook_offering_categories oc ON oc.offering_category_id = a.offering_category_id
       LEFT JOIN gradebook_scores sc ON sc.assessment_id = a.assessment_id AND sc.enrollment_subject_id = ?
      WHERE oc.config_id = ? AND a.record_status = 'ACTIVE'
        AND COALESCE(sc.score_status, 'PENDING') = 'PENDING'
      ORDER BY a.grading_term, a.assessment_id FOR UPDATE`,
    [enrollmentSubjectId, configId],
  );
  const [attendance] = await connection.execute(
    `SELECT m.meeting_id, m.grading_term,
            DATE_FORMAT(m.meeting_date, '%Y-%m-%d') AS meeting_date,
            COALESCE(a.attendance_status, 'PENDING') AS attendance_status,
            a.record_version, a.recorded_by_user_id, a.recorded_at
       FROM gradebook_attendance_meetings m
       LEFT JOIN gradebook_attendance_entries a ON a.meeting_id = m.meeting_id
          AND a.enrollment_subject_id = ?
      WHERE m.config_id = ? AND m.meeting_status = 'HELD'
        AND m.meeting_date <= CURDATE()
      ORDER BY m.meeting_date, m.meeting_id FOR UPDATE`,
    [enrollmentSubjectId, configId],
  );
  const absences = attendance.filter(
    (a) =>
      a.attendance_status === "ABSENT" &&
      a.recorded_at != null &&
      a.recorded_by_user_id != null &&
      Number(a.record_version) > 0,
  );
  if (
    !attendance.length ||
    attendance.some((a) => a.attendance_status === "PENDING") ||
    canonical(pending) !== canonical(pastEvidence.pending_assessments) ||
    canonical(attendance) !== canonical(pastEvidence.attendance_entries) ||
    Number(pastEvidence.absent_meetings) !== absences.length ||
    (rating === "6.00" && !absences.length) ||
    (rating === "4.00" &&
      (current.terms?.MIDTERM?.state !== "READY" ||
        current.terms?.FINAL_TERM?.state === "READY" ||
        !pending.some((a) => a.grading_term === "FINAL_TERM")))
  ) {
    reject(
      "SPECIAL_RESUBMIT_ATTENDANCE_SOURCE_CHANGED",
      "Required pending assessments or attendance evidence is missing or changed.",
      422,
    );
  }

  // The return scope is retained. This operation revises documentation only;
  // changes to numeric scores must use the applicable gradebook workflow.
  if (special.outcome_type !== outcome.outcome_type) {
    reject(
      "SPECIAL_RESUBMIT_TYPE_IMMUTABLE",
      "A returned INC cannot be changed to UD, or vice versa.",
    );
  }

  const nextReason = special.outcome_reason.trim();
  const nextEvidence = special.evidence_summary.trim();
  const nextMissing =
    rating === "4.00" ? special.missing_requirements.trim() : null;
  if (
    nextReason === outcome.outcome_reason &&
    nextEvidence === outcome.evidence_summary &&
    nextMissing === (outcome.missing_requirements ?? null)
  ) {
    reject(
      "SPECIAL_RESUBMIT_NO_REVISION",
      "Revise the documented reason, missing requirements or evidence before resubmitting.",
      400,
    );
  }

  const nextOutcomeVersion = Number(outcome.record_version) + 1;
  const [savedOutcome] = await connection.execute(
    `UPDATE gradebook_special_outcomes
        SET outcome_reason = ?, missing_requirements = ?, evidence_summary = ?,
            updated_by_user_id = ?, record_version = record_version + 1
      WHERE special_outcome_id = ? AND record_status = 'ACTIVE' AND record_version = ?`,
    [
      nextReason,
      nextMissing,
      nextEvidence,
      actorUserId,
      outcome.special_outcome_id,
      outcome.record_version,
    ],
  );
  if (Number(savedOutcome.affectedRows) !== 1) {
    reject(
      "SPECIAL_RESUBMIT_OUTCOME_CONFLICT",
      "The special-outcome record changed during resubmission.",
    );
  }

  const [evidenceEvent] = await connection.execute(
    `INSERT INTO gradebook_special_outcome_events
       (special_outcome_id, event_type, previous_record_status, new_record_status,
        previous_outcome_type, new_outcome_type, previous_outcome_reason, new_outcome_reason,
        previous_missing_requirements, new_missing_requirements,
        previous_evidence_summary, new_evidence_summary,
        event_reason, performed_by_user_id, record_version_after)
     VALUES (?, 'UPDATED', 'ACTIVE', 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      outcome.special_outcome_id,
      outcome.outcome_type,
      outcome.outcome_type,
      outcome.outcome_reason,
      nextReason,
      outcome.missing_requirements,
      nextMissing,
      outcome.evidence_summary,
      nextEvidence,
      `Resubmitted following return of submission #${submissionId}: ${review.evidence_review_notes}`,
      actorUserId,
      nextOutcomeVersion,
    ],
  );
  if (Number(evidenceEvent.affectedRows) !== 1) {
    throw new Error("Could not save the evidence-revision audit event.");
  }

  const [savedGrade] = await connection.execute(
    `UPDATE grades SET outcome_reason = ?, grade_status = 'Submitted',
         submitted_at = NOW(), reviewed_by = NULL, reviewed_at = NULL,
         review_remarks = NULL
      WHERE grade_id = ? AND grade_status = 'Returned'
        AND grading_policy = 'TWO_TERM_50_50' AND grading_outcome = ?`,
    [nextReason, grade.grade_id, grade.grading_outcome],
  );
  if (Number(savedGrade.affectedRows) !== 1) {
    reject(
      "SPECIAL_RESUBMIT_GRADE_CONFLICT",
      "The returned grade changed before resubmission.",
    );
  }

  const [[verified]] = await connection.execute(
    `SELECT grade_status, grading_policy, grading_outcome, outcome_reason,
            midterm_grade, final_grade, overall_percentage, final_rating, remarks,
            reviewed_by, reviewed_at
       FROM grades WHERE grade_id = ? FOR UPDATE`,
    [grade.grade_id],
  );
  if (
    verified?.grade_status !== "Submitted" ||
    verified.grading_policy !== "TWO_TERM_50_50" ||
    verified.grading_outcome !== grade.grading_outcome ||
    verified.outcome_reason !== nextReason ||
    verified.reviewed_by !== null ||
    verified.reviewed_at !== null ||
    Number(verified.final_rating) !== Number(rating) ||
    verified.final_grade !== null ||
    verified.overall_percentage !== null ||
    verified.remarks !==
      (rating === "4.00" ? "Incomplete" : "Unofficial Drop") ||
    (rating === "4.00"
      ? Number(verified.midterm_grade) !== Number(grade.midterm_grade)
      : verified.midterm_grade !== null)
  ) {
    reject(
      "SPECIAL_RESUBMIT_TRIGGER_CONFLICT",
      "The grade trigger produced an unexpected special-outcome result.",
    );
  }

  // Preserve the previous JSON snapshot and review. Only the new attempt
  // receives the revised special documentation.
  const snapshot = {
    ...previous,
    special_outcome: {
      ...pastEvidence,
      outcome_reason: nextReason,
      evidence_summary: nextEvidence,
      missing_requirements: nextMissing,
    },
    preceding_submission_id: String(submissionId),
    preceding_return_scope: old.returned_edit_scope,
    special_evidence_version: nextOutcomeVersion,
  };
  const [inserted] = await connection.execute(
    `INSERT INTO gradebook_grade_submission_attempts
       (sheet_id, period_id, grade_id, special_outcome_id, attempt_number,
        submission_batch_ref, grading_scope, grading_outcome_snapshot,
        midterm_percentage_snapshot, final_term_percentage_snapshot,
        overall_percentage_snapshot, final_rating_snapshot,
        special_outcome_reason_snapshot, submission_status,
        submitted_by_user_id, record_version, calculation_snapshot_json,
        midterm_exact_numerator, midterm_exact_denominator,
        final_term_exact_numerator, final_term_exact_denominator,
        overall_exact_numerator, overall_exact_denominator)
     VALUES (?, ?, ?, ?, ?, ?, 'FULL_SEMESTER', ?, ?, NULL, NULL, ?, ?,
             'SUBMITTED', ?, 1, ?, ?, ?, NULL, NULL, NULL, NULL)`,
    [
      sheet.sheet_id,
      period.period_id,
      grade.grade_id,
      outcome.special_outcome_id,
      Number(old.attempt_number) + 1,
      randomUUID(),
      grade.grading_outcome,
      old.midterm_percentage_snapshot,
      rating,
      nextReason,
      actorUserId,
      JSON.stringify(snapshot),
      old.midterm_exact_numerator,
      old.midterm_exact_denominator,
    ],
  );
  if (Number(inserted.affectedRows) !== 1) {
    throw new Error(
      "Could not create a new combined special-outcome submission attempt.",
    );
  }

  return {
    success: true,
    dry_run: dryRun,
    persisted: !dryRun,
    offering_id: offeringId,
    enrollment_subject_id: enrollmentSubjectId,
    grade_id: Number(grade.grade_id),
    special_outcome_id: String(outcome.special_outcome_id),
    special_outcome_record_version: nextOutcomeVersion,
    evidence_event_id: dryRun ? null : String(evidenceEvent.insertId),
    previous_submission_id: String(submissionId),
    submission_id: dryRun ? null : String(inserted.insertId),
    attempt_number: Number(old.attempt_number) + 1,
    record_version: 1,
    grading_outcome: grade.grading_outcome,
    submission_status: "SUBMITTED",
    grade_status: "Submitted",
    official_grade_published: false,
    original_submitted_attempt_unchanged: true,
    original_review_preserved: true,
    official_sheet_unchanged: true,
    next_step:
      "Program Head must individually approve the latest special-outcome attempt using a revised approval validator.",
  };
}

export function validateSpecialResubmissionBody(body) {
  const allowed = new Set([
    "expected_record_version",
    "confirm_resubmission",
    "dry_run",
    "special_outcome",
  ]);
  const specialAllowed = new Set([
    "outcome_type",
    "outcome_reason",
    "missing_requirements",
    "evidence_summary",
  ]);
  const sp = body?.special_outcome;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.has(key)) ||
    !id(body.expected_record_version) ||
    Number(body.expected_record_version) >= 4294967295 ||
    body.confirm_resubmission !== true ||
    typeof body.dry_run !== "boolean" ||
    !sp ||
    typeof sp !== "object" ||
    Array.isArray(sp) ||
    Object.keys(sp).some((key) => !specialAllowed.has(key)) ||
    !["INCOMPLETE", "UNOFFICIAL_DROP"].includes(sp.outcome_type) ||
    !textOK(sp.outcome_reason, 10, 500) ||
    !textOK(sp.evidence_summary, 20, 2000) ||
    (sp.outcome_type === "INCOMPLETE"
      ? !textOK(sp.missing_requirements, 10, 2000)
      : sp.missing_requirements != null)
  ) {
    return false;
  }
  return true;
}
