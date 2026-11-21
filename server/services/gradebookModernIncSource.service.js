import { assertQaGradingDatabase } from "./gradebookQaWriteGuard.service.js";
function sourceFail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const validUserId = (value) =>
  value != null &&
  /^[1-9]\d*$/.test(String(value)) &&
  Number.isSafeInteger(Number(value));

// Check the reviewer against the Program Head assignment at verification time.
async function assertModernIncClaimReviewerAssignment(connection, ids, claim) {
  if (!validUserId(claim?.verified_by_user_id) || !claim?.verified_at) {
    sourceFail(
      "MODERN_INC_CLAIM_REVIEWER_SCOPE_INVALID",
      "The claim has no recorded Program Head verification actor or date.",
    );
  }

  const [reviewers] = await connection.execute(
    `SELECT ph.program_head_id
       FROM program_heads ph
       JOIN faculty reviewer ON reviewer.faculty_id = ph.faculty_id
       JOIN subject_offerings so ON so.offering_id = ?
       JOIN sections sec ON sec.section_id = so.section_id
       JOIN courses cr ON cr.course_id = sec.course_id
      WHERE reviewer.user_id = ?
        AND ph.department_id = cr.department_id
        AND (ph.start_date IS NULL OR ph.start_date <= DATE(?))
        AND (ph.end_date IS NULL OR ph.end_date >= DATE(?))
      LIMIT 1`,
    [
      ids.offeringId,
      claim.verified_by_user_id,
      claim.verified_at,
      claim.verified_at,
    ],
  );

  if (reviewers.length !== 1) {
    sourceFail(
      "MODERN_INC_CLAIM_REVIEWER_SCOPE_INVALID",
      "The recorded verification actor has no matching Program Head assignment for the offering and verification date.",
    );
  }
}
const textPresent = (v, min = 1) =>
  typeof v === "string" && v.trim().length >= min;
const nulls = (...values) => values.every((v) => v === null);

function jsonObject(value) {
  try {
    if (Buffer.isBuffer(value)) value = value.toString("utf8");
    if (typeof value === "string") value = JSON.parse(value);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

function decimalUnits(value) {
  const raw = String(value ?? "");
  if (!/^(0|[1-9]\d*)(?:\.\d{1,12})?$/.test(raw)) return null;
  const [whole, frac = ""] = raw.split(".");
  return BigInt(whole) * 1000000000000n + BigInt(frac.padEnd(12, "0"));
}

function exactMidterm(attempt, snapshot) {
  const n = String(attempt.midterm_exact_numerator ?? "");
  const d = String(attempt.midterm_exact_denominator ?? "");
  if (!/^(0|[1-9]\d{0,254})$/.test(n) || !/^[1-9]\d{0,254}$/.test(d))
    return null;
  const term = snapshot?.calculated_terms?.MIDTERM;
  const value = term?.term_percentage;
  if (
    term?.state !== "READY" ||
    snapshot?.calculated_terms?.FINAL_TERM?.state === "READY" ||
    String(value?.exact_numerator) !== n ||
    String(value?.exact_denominator) !== d
  )
    return null;
  const numerator = BigInt(n),
    denominator = BigInt(d);
  if (numerator > 100n * denominator) return null;
  return (2n * numerator * 1000000000000n + denominator) / (2n * denominator);
}

// INC completion eligibility; pending score records are handled separately.
function supportsModernIncPilotCompletion(
  evidence,
  { allowMultiple = false } = {},
) {
  const pending = evidence?.pending_assessments;

  if (!Array.isArray(pending) || pending.length < 1 || pending.length > 200) {
    return false;
  }

  if (!allowMultiple && pending.length !== 1) {
    return false;
  }

  const ids = new Set();

  return pending.every((assessment) => {
    const id = Number(assessment?.assessment_id);

    if (!Number.isSafeInteger(id) || id <= 0 || ids.has(id)) {
      return false;
    }

    ids.add(id);

    const originallyMissing =
      assessment.score_id === null && assessment.record_version === null;

    const originallyPending =
      Number.isSafeInteger(assessment.score_id) &&
      assessment.score_id > 0 &&
      Number.isSafeInteger(assessment.record_version) &&
      assessment.record_version > 0;

    return (
      assessment.grading_term === "FINAL_TERM" &&
      typeof assessment.category_code === "string" &&
      assessment.category_code.trim().length > 0 &&
      (allowMultiple || assessment.category_code === "MAJOR_EXAM") &&
      (originallyMissing || originallyPending)
    );
  });
}
// Read the original immutable publication chain. Do not recompute it from later completion scores.
export async function readModernIncSource(
  connection,
  ids,
  { lock = false, pilotOnly = true, readOnly = false } = {},
) {
  if (readOnly && lock) {
    sourceFail(
      "MODERN_INC_READ_ONLY_LOCK_FORBIDDEN",
      "Read-only INC source checks cannot lock grade records.",
      400,
    );
  }

  const suffix = lock ? " FOR UPDATE" : "";

  const invalid = (message) => sourceFail("MODERN_INC_SOURCE_INVALID", message);

  if (
    !ids ||
    !Number.isSafeInteger(ids.offeringId) ||
    ids.offeringId <= 0 ||
    !Number.isSafeInteger(ids.enrollmentSubjectId) ||
    ids.enrollmentSubjectId <= 0 ||
    !Number.isSafeInteger(ids.actorUserId) ||
    ids.actorUserId <= 0
  ) {
    sourceFail(
      "MODERN_INC_SCOPE_INVALID",
      "A valid offering, enrollment subject, and authenticated instructor are required.",
      400,
    );
  }

  // Source checks for committed INC operations must be explicitly enabled.
  // Independent claim/review/conversion write guards remain in effect.
  const generalizedWriteSourceEnabled =
    process.env.GRADEBOOK_MODERN_INC_SOURCE_WRITE_SCOPE_ENABLED === "true";

  if (!readOnly && !generalizedWriteSourceEnabled) {
    if (
      pilotOnly &&
      (ids.offeringId !== 130 || ids.enrollmentSubjectId !== 277)
    ) {
      sourceFail(
        "MODERN_INC_QA_SCOPE_ONLY",
        "Modern INC writes remain limited to the authorized QA pilot.",
        403,
      );
    }

    const [[database]] = await connection.execute(
      "SELECT DATABASE() AS database_name",
    );

    if (database?.database_name !== "databaseforptc1_admission_test") {
      sourceFail(
        "MODERN_INC_QA_DATABASE_ONLY",
        "Modern INC completion is restricted to the admission-test database.",
        403,
      );
    }
  }
  const [offerings] = await connection.execute(
    `SELECT so.offering_id, so.faculty_id, so.academic_year_id, so.semester_id,
            f.user_id, u.is_active, u.is_archived, r.role_name, cr.department_id
       FROM subject_offerings so
       JOIN faculty f ON f.faculty_id = so.faculty_id
       JOIN users u ON u.user_id = f.user_id
       JOIN roles r ON r.role_id = u.role_id
       JOIN sections sec ON sec.section_id = so.section_id
       JOIN courses cr ON cr.course_id = sec.course_id
      WHERE so.offering_id = ?${suffix}`,
    [ids.offeringId],
  );
  const offering = offerings[0];
  if (
    offerings.length !== 1 ||
    !sameId(offering.user_id, ids.actorUserId) ||
    Number(offering.is_active) !== 1 ||
    Number(offering.is_archived) !== 0 ||
    !["Faculty", "Program Head"].includes(offering.role_name)
  ) {
    sourceFail(
      "GRADEBOOK_INSTRUCTOR_REQUIRED",
      "Only the active assigned instructor may access this INC source.",
      403,
    );
  }
  const [configs] = await connection.execute(
    `SELECT config_id, midterm_percent, final_term_percent FROM gradebook_offering_config WHERE offering_id = ?${suffix}`,
    [ids.offeringId],
  );
  if (
    configs.length !== 1 ||
    Number(configs[0].midterm_percent) !== 50 ||
    Number(configs[0].final_term_percent) !== 50
  )
    invalid("The original gradebook configuration is missing or inconsistent.");
  const configId = Number(configs[0].config_id);
  const [students] = await connection.execute(
    `SELECT es.enrollment_subject_id, es.status AS subject_status, e.enrollment_status,
            e.student_id, e.academic_year_id, e.semester_id
       FROM enrollment_subjects es JOIN enrollments e ON e.enrollment_id = es.enrollment_id
      WHERE es.enrollment_subject_id = ? AND es.offering_id = ?${suffix}`,
    [ids.enrollmentSubjectId, ids.offeringId],
  );
  const student = students[0];
  if (
    students.length !== 1 ||
    student.subject_status !== "Incomplete" ||
    student.enrollment_status !== "Approved" ||
    !sameId(student.academic_year_id, offering.academic_year_id) ||
    !sameId(student.semester_id, offering.semester_id)
  )
    invalid(
      "The original approved INC enrollment subject is missing or changed.",
    );
  const [grades] = await connection.execute(
    `SELECT grade_id, faculty_id, grade_status, grading_policy, grading_outcome,
            midterm_grade, final_grade, overall_percentage, final_rating, remarks,
            outcome_reason, reviewed_by, reviewed_at, submitted_at
       FROM grades WHERE enrollment_subject_id = ?${suffix}`,
    [ids.enrollmentSubjectId],
  );
  const grade = grades[0];
  if (
    grades.length !== 1 ||
    grade.grade_status !== "Approved" ||
    grade.grading_policy !== "TWO_TERM_50_50" ||
    grade.grading_outcome !== "INCOMPLETE" ||
    Number(grade.final_rating) !== 4 ||
    grade.remarks !== "Incomplete" ||
    !sameId(grade.faculty_id, offering.faculty_id) ||
    decimalUnits(grade.midterm_grade) === null ||
    !nulls(grade.final_grade, grade.overall_percentage) ||
    !grade.reviewed_at ||
    !grade.submitted_at ||
    !textPresent(grade.outcome_reason, 10)
  )
    invalid("The protected Approved INC grade is missing or inconsistent.");
  const [sheets] = await connection.execute(
    `SELECT *, DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_date,
            DATE_FORMAT(DATE_ADD(original_official_submitted_on, INTERVAL 1 YEAR), '%Y-%m-%d') AS deadline,
            DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today
       FROM gradebook_official_sheets WHERE config_id = ?${suffix}`,
    [configId],
  );
  const sheet = sheets[0];
  if (
    sheets.length !== 1 ||
    sheet.sheet_status !== "FINALIZED" ||
    !sheet.finalized_at ||
    !validUserId(sheet.finalized_by_user_id) ||
    !sheet.official_date_verified_at ||
    !validUserId(sheet.official_date_verified_by_user_id) ||
    !sheet.original_date ||
    !sheet.deadline ||
    sheet.original_date > sheet.today ||
    !textPresent(sheet.official_submission_reference)
  )
    invalid("The finalized sheet and verified original date are required.");
  const [dates] = await connection.execute(
    `SELECT event_type, previous_record_version, record_version_after, performed_by_user_id,
            DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_date, official_submission_reference
       FROM gradebook_official_sheet_submission_events WHERE sheet_id = ? ORDER BY record_version_after, event_id${suffix}`,
    [sheet.sheet_id],
  );
  if (
    dates.length !== 2 ||
    dates[0].event_type !== "RECORDED" ||
    dates[0].previous_record_version !== null ||
    Number(dates[0].record_version_after) !== 1 ||
    !validUserId(dates[0].performed_by_user_id) ||
    sameId(dates[0].performed_by_user_id, dates[1].performed_by_user_id) ||
    dates[1].event_type !== "VERIFIED" ||
    Number(dates[1].previous_record_version) !== 1 ||
    Number(dates[1].record_version_after) !== 2 ||
    !sameId(
      dates[1].performed_by_user_id,
      sheet.official_date_verified_by_user_id,
    ) ||
    dates.some(
      (e) =>
        e.original_date !== sheet.original_date ||
        e.official_submission_reference !== sheet.official_submission_reference,
    )
  )
    invalid("The original sheet-date audit is inconsistent.");
  // Finalization must advance the verified sheet version exactly once.
  const verifiedSheetVersion = Number(dates[1].record_version_after);
  const finalizedSheetVersion = Number(sheet.record_version);

  if (
    !Number.isSafeInteger(finalizedSheetVersion) ||
    finalizedSheetVersion !== verifiedSheetVersion + 1
  ) {
    invalid(
      "The finalized sheet version does not match its verified audit history.",
    );
  }
  const [roster] = await connection.execute(
    `SELECT * FROM gradebook_finalized_roster WHERE sheet_id = ? AND enrollment_subject_id = ?${suffix}`,
    [sheet.sheet_id, ids.enrollmentSubjectId],
  );
  const original = roster[0];
  if (
    roster.length !== 1 ||
    !sameId(original.grade_id, grade.grade_id) ||
    !sameId(original.student_id, student.student_id) ||
    original.grade_status_snapshot !== "Approved" ||
    original.grading_outcome_snapshot !== "INCOMPLETE" ||
    original.enrollment_subject_status_snapshot !== "Incomplete" ||
    original.grade_remarks_snapshot !== "Incomplete" ||
    Number(original.final_rating_snapshot) !== 4 ||
    !sameId(original.snapshotted_by_user_id, sheet.finalized_by_user_id) ||
    decimalUnits(original.midterm_grade_snapshot) !==
      decimalUnits(grade.midterm_grade) ||
    !nulls(original.final_grade_snapshot, original.overall_percentage_snapshot)
  )
    invalid(
      "The original finalized INC roster snapshot does not match the official grade.",
    );
  const [publications] = await connection.execute(
    `SELECT * FROM gradebook_official_grade_publications WHERE grade_id = ?${suffix}`,
    [grade.grade_id],
  );
  const publication = publications[0];
  if (
    publications.length !== 1 ||
    publication.publication_source !== "COMBINED_SEMESTER" ||
    publication.grading_outcome_snapshot !== "INCOMPLETE" ||
    !sameId(publication.config_id, configId) ||
    !sameId(publication.enrollment_subject_id, ids.enrollmentSubjectId) ||
    !publication.combined_submission_id ||
    !publication.published_at ||
    !sameId(publication.published_by_user_id, grade.reviewed_by) ||
    !nulls(
      publication.midterm_submission_id,
      publication.final_term_submission_id,
      publication.overall_exact_numerator,
      publication.overall_exact_denominator,
    )
  )
    invalid(
      "The source-linked combined INC publication is missing or inconsistent.",
    );
  const [attempts] = await connection.execute(
    `SELECT * FROM gradebook_grade_submission_attempts WHERE grade_id = ? ORDER BY attempt_number, submission_id${suffix}`,
    [grade.grade_id],
  );
  const attempt = attempts[0];
  if (
    attempts.length !== 1 ||
    Number(attempt.attempt_number) !== 1 ||
    !sameId(attempt.submission_id, publication.combined_submission_id) ||
    !sameId(attempt.sheet_id, sheet.sheet_id) ||
    attempt.grading_scope !== "FULL_SEMESTER" ||
    attempt.submission_status !== "APPROVED" ||
    attempt.grading_outcome_snapshot !== "INCOMPLETE" ||
    !attempt.special_outcome_id ||
    Number(attempt.record_version) !== 2 ||
    !sameId(attempt.submitted_by_user_id, ids.actorUserId) ||
    !sameId(attempt.reviewed_by_user_id, publication.published_by_user_id) ||
    !attempt.submitted_at ||
    !attempt.reviewed_at ||
    !textPresent(attempt.review_remarks) ||
    attempt.returned_edit_scope !== null ||
    attempt.special_outcome_reason_snapshot !== grade.outcome_reason ||
    Number(attempt.final_rating_snapshot) !== 4 ||
    !nulls(
      attempt.final_term_percentage_snapshot,
      attempt.overall_percentage_snapshot,
      attempt.final_term_exact_numerator,
      attempt.final_term_exact_denominator,
      attempt.overall_exact_numerator,
      attempt.overall_exact_denominator,
    )
  )
    invalid("The approved combined submission does not match its publication.");
  const [periods] = await connection.execute(
    `SELECT department_id, academic_year_id, semester_id FROM gradebook_submission_periods WHERE period_id = ?${suffix}`,
    [attempt.period_id],
  );
  if (
    periods.length !== 1 ||
    !sameId(periods[0].department_id, offering.department_id) ||
    !sameId(periods[0].academic_year_id, offering.academic_year_id) ||
    !sameId(periods[0].semester_id, offering.semester_id)
  )
    invalid("The original submission period is outside the offering scope.");
  const [reviews] = await connection.execute(
    `SELECT * FROM gradebook_grade_submission_reviews WHERE submission_id = ?${suffix}`,
    [attempt.submission_id],
  );
  const review = reviews[0];
  if (
    reviews.length !== 1 ||
    review.review_decision !== "APPROVED" ||
    review.grading_outcome_snapshot !== "INCOMPLETE" ||
    Number(review.submission_version_after) !== 2 ||
    !sameId(review.reviewed_by_user_id, attempt.reviewed_by_user_id) ||
    !sameId(review.reviewed_by_user_id, grade.reviewed_by) ||
    !sameId(review.reviewed_by_user_id, publication.published_by_user_id) ||
    review.review_notes !== attempt.review_remarks ||
    !review.reviewed_at ||
    !textPresent(review.evidence_review_notes, 20) ||
    ![0, 1].includes(Number(review.is_self_approval)) ||
    Number(review.is_self_approval) !==
      Number(
        sameId(review.reviewed_by_user_id, attempt.submitted_by_user_id),
      ) ||
    !nulls(review.returned_edit_scope, review.review_batch_ref)
  )
    invalid(
      "The original individual INC evidence review is missing or inconsistent.",
    );
  const snapshot = jsonObject(attempt.calculation_snapshot_json);
  const evidence = snapshot?.special_outcome;
  const mid = exactMidterm(attempt, snapshot);
  if (
    !snapshot ||
    snapshot.policy !== "TWO_TERM_50_50" ||
    snapshot.grading_scope !== "FULL_SEMESTER" ||
    snapshot.grading_outcome !== "INCOMPLETE" ||
    !sameId(snapshot.offering_id, ids.offeringId) ||
    !sameId(snapshot.config_id, configId) ||
    !sameId(snapshot.grade_id, grade.grade_id) ||
    !sameId(snapshot.enrollment_subject_id, ids.enrollmentSubjectId) ||
    !sameId(snapshot.student?.student_id, student.student_id) ||
    !sameId(snapshot.special_outcome_id, attempt.special_outcome_id) ||
    Number(snapshot.term_weights?.MIDTERM) !== 50 ||
    Number(snapshot.term_weights?.FINAL_TERM) !== 50 ||
    mid === null ||
    [
      grade.midterm_grade,
      attempt.midterm_percentage_snapshot,
      snapshot.official_result?.midterm_grade,
    ].some((v) => decimalUnits(v) !== mid) ||
    Number(snapshot.official_result?.final_rating) !== 4 ||
    !nulls(
      snapshot.official_result?.final_grade,
      snapshot.official_result?.overall_percentage,
    ) ||
    evidence?.outcome_type !== "INCOMPLETE" ||
    evidence.outcome_reason !== grade.outcome_reason ||
    !textPresent(evidence.missing_requirements, 10) ||
    !textPresent(evidence.evidence_summary, 20) ||
    !Array.isArray(evidence.pending_assessments) ||
    !evidence.pending_assessments.length ||
    evidence.pending_assessments.some(
      (a) => a.grading_term !== "FINAL_TERM" || !a.assessment_id,
    ) ||
    !Array.isArray(evidence.attendance_entries) ||
    !evidence.attendance_entries.length ||
    evidence.attendance_entries.some(
      (a) =>
        a.attendance_status === "PENDING" ||
        !a.record_version ||
        !a.recorded_by_user_id ||
        !a.recorded_at,
    ) ||
    Number(evidence.absent_meetings) !==
      evidence.attendance_entries.filter(
        (a) => a.attendance_status === "ABSENT",
      ).length
  )
    invalid(
      "The immutable combined calculation and special-outcome snapshot are inconsistent.",
    );
  const [outcomes] = await connection.execute(
    `SELECT * FROM gradebook_special_outcomes WHERE grade_id = ?${suffix}`,
    [grade.grade_id],
  );
  const outcome = outcomes[0];
  if (
    outcomes.length !== 1 ||
    !sameId(outcome.special_outcome_id, attempt.special_outcome_id) ||
    outcome.record_status !== "ACTIVE" ||
    outcome.outcome_type !== "INCOMPLETE" ||
    Number(outcome.record_version) !== 1 ||
    !sameId(outcome.created_by_user_id, attempt.submitted_by_user_id) ||
    outcome.outcome_reason !== evidence.outcome_reason ||
    outcome.missing_requirements !== evidence.missing_requirements ||
    outcome.evidence_summary !== evidence.evidence_summary
  )
    invalid("The original special-outcome record is missing or changed.");
  const [events] = await connection.execute(
    `SELECT * FROM gradebook_special_outcome_events WHERE special_outcome_id = ?${suffix}`,
    [outcome.special_outcome_id],
  );
  const event = events[0];
  if (
    events.length !== 1 ||
    event.event_type !== "CREATED" ||
    event.previous_record_status !== null ||
    event.new_record_status !== "ACTIVE" ||
    event.previous_outcome_type !== null ||
    event.new_outcome_type !== "INCOMPLETE" ||
    Number(event.record_version_after) !== 1 ||
    !sameId(event.performed_by_user_id, attempt.submitted_by_user_id) ||
    event.new_outcome_reason !== evidence.outcome_reason ||
    event.new_missing_requirements !== evidence.missing_requirements ||
    event.new_evidence_summary !== evidence.evidence_summary
  )
    invalid("The original special-outcome audit does not match its evidence.");
  const [locks] = await connection.execute(
    `SELECT l.first_submission_id, a.sheet_id FROM gradebook_structure_locks l
       JOIN gradebook_grade_submission_attempts a ON a.submission_id = l.first_submission_id WHERE l.config_id = ?${suffix}`,
    [configId],
  );
  if (locks.length !== 1 || !sameId(locks[0].sheet_id, sheet.sheet_id))
    invalid("The original shared structure lock is missing or inconsistent.");
  const [[legacy]] = await connection.execute(
    `SELECT
       EXISTS(SELECT 1 FROM gradebook_term_submission_attempts WHERE config_id = ? AND enrollment_subject_id = ?) AS terms,
       EXISTS(SELECT 1 FROM gradebook_term_structure_locks WHERE config_id = ?) AS term_lock,
       EXISTS(SELECT 1 FROM gradebook_inc_outcome_requests WHERE config_id = ? AND enrollment_subject_id = ? AND request_status IN ('SUBMITTED','APPROVED')) AS inc_request,
       EXISTS(SELECT 1 FROM gradebook_ud_outcome_requests WHERE config_id = ? AND enrollment_subject_id = ? AND request_status IN ('SUBMITTED','APPROVED')) AS ud_request`,
    [
      configId,
      ids.enrollmentSubjectId,
      configId,
      configId,
      ids.enrollmentSubjectId,
      configId,
      ids.enrollmentSubjectId,
    ],
  );
  if (Object.values(legacy).some((v) => Number(v) !== 0))
    invalid("Conflicting legacy gradebook history requires reconciliation.");
  return {
    configId,
    student,
    grade,
    sheet,
    original,
    publication,
    attempt,
    review,
    evidence,
  };
}

export async function modernIncReadiness(connection, ids) {
  const source = await readModernIncSource(connection, ids, {
    pilotOnly: false,
    readOnly: true,
  });
  const {
    configId,
    student,
    grade,
    sheet,
    original,
    publication,
    attempt,
    review,
    evidence,
  } = source;
  const [claims] = await connection.execute(
    `SELECT claim_id, grade_change_request_id, verification_status, record_version,
            DATE_FORMAT(claimed_completed_on, '%Y-%m-%d') AS claimed_completed_on,
            DATE_FORMAT(verified_completed_on, '%Y-%m-%d') AS verified_completed_on
       FROM gradebook_inc_completion_claims WHERE grade_id = ?`,
    [grade.grade_id],
  );
  const [requests] = await connection.execute(
    `SELECT grade_change_request_id, status FROM grade_change_requests WHERE grade_id = ? AND request_type = 'INC_COMPLETION'
      AND status IN ('Pending Program Head', 'For Registrar Processing')`,
    [grade.grade_id],
  );
  const blockers = [];
  const supportedCompletion = supportsModernIncPilotCompletion(evidence, {
    allowMultiple: true,
  });

  if (!supportedCompletion) {
    blockers.push({
      code: "MODERN_INC_COMPLETION_SCOPE_UNSUPPORTED",
      message:
        "Completion requires distinct, originally unscored Final Term " +
        "assessments. Existing PENDING score records require the next workflow update.",
    });
  }

  if (process.env.GRADEBOOK_MODERN_INC_CLAIM_WRITES_ENABLED !== "true") {
    blockers.push({
      code: "MODERN_INC_CLAIM_WRITES_DISABLED",
      message: "INC completion claim submission is not enabled on this server.",
    });
  }

  if (claims.length)
    blockers.push({
      code: "INC_COMPLETION_CLAIM_ALREADY_EXISTS",
      message: "An existing claim must be reviewed before continuing.",
    });
  if (requests.length)
    blockers.push({
      code: "INC_COMPLETION_LEGACY_REQUEST_PENDING",
      message: "A pending grade-change request requires reconciliation.",
    });
  const eligible = blockers.length === 0;
  return {
    success: true,
    read_only: true,
    offering_id: ids.offeringId,
    config_id: configId,
    enrollment_subject_id: ids.enrollmentSubjectId,
    student_id: Number(student.student_id),
    instructor_user_id: ids.actorUserId,
    source_verified: true,
    publication_source: publication.publication_source,
    source: {
      publication_id: String(publication.publication_id),
      combined_submission_id: String(attempt.submission_id),
      roster_snapshot_id: String(original.roster_snapshot_id),
      review_id: String(review.review_id),
      special_outcome_id: Number(attempt.special_outcome_id),
    },
    official_grade: {
      grade_id: Number(grade.grade_id),
      grade_status: grade.grade_status,
      grading_outcome: grade.grading_outcome,
      final_rating: String(grade.final_rating),
      midterm_grade: String(grade.midterm_grade),
      final_grade: null,
      overall_percentage: null,
    },
    official_sheet: {
      sheet_id: String(sheet.sheet_id),
      sheet_status: sheet.sheet_status,
      record_version: Number(sheet.record_version),
      original_official_submitted_on: sheet.original_date,
      deadline_established: true,
      inc_completion_deadline_on: sheet.deadline,
    },
    outstanding_requirements: evidence.missing_requirements,
    pending_final_assessments: evidence.pending_assessments,
    existing_claims: claims.map((c) => ({
      ...c,
      claim_id: String(c.claim_id),
      record_version: Number(c.record_version),
    })),
    legacy_pending_request_count: requests.length,
    completion_claim_source_eligible: eligible,

    can_file_completion_claim: eligible,

    can_dry_run_completion_claim:
      supportedCompletion && !claims.length && !requests.length,

    blockers,
    warnings: [],
    note: "Readiness only. No grade, claim, snapshot, or official date was modified.",
  };
}
export async function createModernIncClaim(connection, ids, input) {
  // Committed claims require explicit rollout approval.
  if (
    input.dryRun !== true &&
    process.env.GRADEBOOK_MODERN_INC_CLAIM_WRITES_ENABLED !== "true"
  ) {
    sourceFail(
      "MODERN_INC_CLAIM_WRITES_DISABLED",
      "INC completion claim submission is not enabled on this server.",
      403,
    );
  }

  // Keep the original QA restriction until generalized source validation
  // is separately enabled. The source verifier applies the same restriction.
  if (process.env.GRADEBOOK_MODERN_INC_SOURCE_WRITE_SCOPE_ENABLED !== "true") {
    await assertQaGradingDatabase(connection);
  }
  const {
    configId,
    student,
    grade,
    sheet,
    original,
    publication,
    attempt,
    evidence,
  } = await readModernIncSource(connection, ids, {
    lock: true,
    pilotOnly: false,
  });

  const supportedForRequest = supportsModernIncPilotCompletion(evidence, {
    allowMultiple: true,
  });

  if (!supportedForRequest) {
    sourceFail(
      "MODERN_INC_COMPLETION_SCOPE_UNSUPPORTED",
      "INC completion requires distinct, originally unscored Final Term assessments.",
    );
  }

  if (!sameId(grade.grade_id, input.expectedGradeId)) {
    sourceFail(
      "INC_COMPLETION_STALE_GRADE",
      "The official INC grade changed. Reload readiness.",
    );
  }
  if (input.claimedDate > sheet.today) {
    sourceFail(
      "INC_COMPLETION_FUTURE_DATE",
      "The claimed completion date cannot be in the future.",
      400,
    );
  }

  const [claims] = await connection.execute(
    `SELECT claim_id FROM gradebook_inc_completion_claims
     WHERE grade_id = ? FOR UPDATE`,
    [grade.grade_id],
  );
  if (claims.length) {
    sourceFail(
      "INC_COMPLETION_CLAIM_ALREADY_EXISTS",
      "A completion claim already exists for this grade. Reload readiness.",
    );
  }
  const [requests] = await connection.execute(
    `SELECT grade_change_request_id FROM grade_change_requests
     WHERE grade_id = ? AND request_type = 'INC_COMPLETION'
       AND status IN ('Pending Program Head', 'For Registrar Processing') FOR UPDATE`,
    [grade.grade_id],
  );
  if (requests.length) {
    sourceFail(
      "INC_COMPLETION_LEGACY_REQUEST_PENDING",
      "A pending INC grade-change request requires reconciliation.",
    );
  }

  // Committed claims stay disabled until the full INC workflow is ready.
  if (
    !input.dryRun &&
    process.env.GRADEBOOK_MODERN_INC_CLAIM_WRITES_ENABLED !== "true"
  ) {
    sourceFail(
      "MODERN_INC_CLAIM_WRITES_DISABLED",
      "INC completion claim submission is not enabled on this server.",
      403,
    );
  }

  const [insert] = await connection.execute(
    `INSERT INTO gradebook_inc_completion_claims
       (grade_id, grade_change_request_id, claimed_completed_on,
        evidence_summary, verification_status, submitted_by_user_id, record_version)
     VALUES (?, NULL, ?, ?, 'PENDING_VERIFICATION', ?, 1)`,
    [grade.grade_id, input.claimedDate, input.evidence, ids.actorUserId],
  );
  if (Number(insert.affectedRows) !== 1 || !insert.insertId) {
    throw new Error("Modern INC completion claim was not inserted.");
  }
  const claimId = String(insert.insertId);
  const [event] = await connection.execute(
    `INSERT INTO gradebook_inc_completion_claim_events
       (claim_id, event_type, previous_status, new_status,
        new_claimed_completed_on, new_evidence_summary,
        event_reason, performed_by_user_id, claim_version_after)
     VALUES (?, 'CREATED', NULL, 'PENDING_VERIFICATION', ?, ?, ?, ?, 1)`,
    [claimId, input.claimedDate, input.evidence, input.reason, ids.actorUserId],
  );
  if (Number(event.affectedRows) !== 1 || !event.insertId) {
    throw new Error("Modern INC completion claim audit was not inserted.");
  }

  return {
    success: true,
    dry_run: input.dryRun,
    persisted: !input.dryRun,
    offering_id: ids.offeringId,
    config_id: configId,
    enrollment_subject_id: ids.enrollmentSubjectId,
    student_id: Number(student.student_id),
    publication_source: publication.publication_source,
    source: {
      publication_id: String(publication.publication_id),
      combined_submission_id: String(attempt.submission_id),
      roster_snapshot_id: String(original.roster_snapshot_id),
    },
    claim: {
      claim_id: input.dryRun ? null : claimId,
      grade_id: Number(grade.grade_id),
      claimed_completed_on: input.claimedDate,
      completion_reason: input.reason,
      evidence_summary: input.evidence,
      verification_status: "PENDING_VERIFICATION",
      record_version: 1,
      submitted_by_user_id: ids.actorUserId,
    },
    audit_event: "CREATED",
    audit_event_id: input.dryRun ? null : String(event.insertId),
    official_sheet: {
      sheet_id: String(sheet.sheet_id),
      deadline_established: true,
      inc_completion_deadline_on: sheet.deadline,
    },
    timeliness_verified: false,
    grade_conversion_performed: false,
    official_grade_unchanged: true,
    note: input.dryRun
      ? "Claim and audit writes rolled back. No grade was changed."
      : "Claim saved pending Program Head evidence verification. The official INC grade remains unchanged.",
  };
}
// Validate every pending-claim revision before a review decision.
function assertPendingModernIncClaimAudit(
  claim,
  events,
  failureCode = "INC_COMPLETION_REVIEW_AUDIT_INCONSISTENT",
) {
  const invalidAudit = () =>
    sourceFail(
      failureCode,
      "The pending claim and its versioned audit history do not match.",
    );

  const version = Number(claim.record_version);

  if (
    !Number.isSafeInteger(version) ||
    version < 1 ||
    events.length !== version
  ) {
    invalidAudit();
  }

  let previousDate = null;
  let previousEvidence = null;

  for (const [index, event] of events.entries()) {
    const first = index === 0;

    if (
      Number(event.claim_version_after) !== index + 1 ||
      event.event_type !== (first ? "CREATED" : "UPDATED") ||
      event.previous_status !== (first ? null : "PENDING_VERIFICATION") ||
      event.new_status !== "PENDING_VERIFICATION" ||
      event.previous_claimed_date !== previousDate ||
      event.previous_evidence_summary !== previousEvidence ||
      event.previous_verified_completed_on !== null ||
      event.new_verified_completed_on !== null ||
      event.previous_verification_remarks !== null ||
      event.new_verification_remarks !== null ||
      !sameId(event.performed_by_user_id, claim.submitted_by_user_id) ||
      !textPresent(event.event_reason, 10) ||
      !event.new_claimed_date ||
      !textPresent(event.new_evidence_summary, 10)
    ) {
      invalidAudit();
    }

    previousDate = event.new_claimed_date;
    previousEvidence = event.new_evidence_summary;
  }

  if (
    previousDate !== claim.claimed_date ||
    previousEvidence !== claim.evidence_summary
  ) {
    invalidAudit();
  }
}
// Modern INC completion review
export async function reviewModernIncClaim(
  connection,
  actor,
  preview,
  requestedClaimId,
  input,
  decision,
) {
  // The caller has already authenticated the Program Head and opened a transaction.
  const offeringId = Number(preview?.offering_id);
  const enrollmentSubjectId = Number(preview?.enrollment_subject_id);
  const departmentId = Number(preview?.department_id);

  if (
    !validUserId(actor?.userId) ||
    !Number.isSafeInteger(offeringId) ||
    offeringId <= 0 ||
    !Number.isSafeInteger(enrollmentSubjectId) ||
    enrollmentSubjectId <= 0 ||
    !Number.isSafeInteger(departmentId) ||
    departmentId <= 0 ||
    !Array.isArray(actor?.departments) ||
    !actor.departments.includes(departmentId) ||
    !["VERIFY", "REJECT"].includes(decision)
  ) {
    sourceFail(
      "INC_COMPLETION_REVIEW_CLAIM_NOT_FOUND",
      "Completion claim was not found in your assigned department.",
      404,
    );
  }

  // Committed reviews require explicit rollout approval.
  if (
    input.dryRun !== true &&
    process.env.GRADEBOOK_MODERN_INC_REVIEW_WRITES_ENABLED !== "true"
  ) {
    sourceFail(
      "MODERN_INC_REVIEW_WRITES_DISABLED",
      "Program Head INC claim review writes are not enabled on this server.",
      403,
    );
  }

  // Keep the QA database guard until the modern INC source rollout is enabled.
  // The review-write flag and caller transaction checks remain separate.
  if (process.env.GRADEBOOK_MODERN_INC_SOURCE_WRITE_SCOPE_ENABLED !== "true") {
    await assertQaGradingDatabase(connection);
  }

  // Use the offering's actual department and instructor for source validation.
  const [scope] = await connection.execute(
    `SELECT cr.department_id, f.user_id AS instructor_user_id
       FROM subject_offerings so
       JOIN faculty f ON f.faculty_id = so.faculty_id
       JOIN sections sec ON sec.section_id = so.section_id
       JOIN courses cr ON cr.course_id = sec.course_id
      WHERE so.offering_id = ? FOR UPDATE`,
    [offeringId],
  );
  if (
    scope.length !== 1 ||
    !sameId(scope[0].department_id, departmentId) ||
    !validUserId(scope[0].instructor_user_id)
  ) {
    sourceFail(
      "INC_COMPLETION_REVIEW_VERSION_CONFLICT",
      "The offering's department or instructor assignment changed. Reload the claim.",
    );
  }

  const instructorUserId = Number(scope[0].instructor_user_id);
  const { configId, grade, sheet, original, publication, attempt } =
    await readModernIncSource(
      connection,
      {
        offeringId,
        enrollmentSubjectId,
        actorUserId: instructorUserId,
      },
      { lock: true, pilotOnly: false },
    );
  if (
    !sameId(configId, preview.config_id) ||
    !sameId(grade.grade_id, input.expectedGradeId)
  ) {
    sourceFail(
      "INC_COMPLETION_REVIEW_VERSION_CONFLICT",
      "The original grade or configuration changed. Reload the claim.",
    );
  }
  const [reviewers] = await connection.execute(
    `SELECT ph.program_head_id FROM program_heads ph
       JOIN faculty f ON f.faculty_id = ph.faculty_id
       JOIN users u ON u.user_id = f.user_id
       JOIN roles r ON r.role_id = u.role_id
      WHERE f.user_id = ? AND ph.department_id = ? AND ph.is_active = 1
        AND (ph.start_date IS NULL OR ph.start_date <= CURDATE())
        AND (ph.end_date IS NULL OR ph.end_date >= CURDATE())
        AND u.is_active = 1 AND u.is_archived = 0 AND r.role_name = 'Program Head'
      FOR UPDATE`,
    [actor.userId, departmentId],
  );
  if (!reviewers.length)
    sourceFail(
      "INC_COMPLETION_REVIEW_FORBIDDEN",
      "An active Program Head assignment is required.",
      403,
    );

  const [claims] = await connection.execute(
    `SELECT *, DATE_FORMAT(claimed_completed_on, '%Y-%m-%d') AS claimed_date
       FROM gradebook_inc_completion_claims WHERE grade_id = ? FOR UPDATE`,
    [grade.grade_id],
  );
  const claim = claims[0];
  if (
    claims.length !== 1 ||
    !sameId(claim.claim_id, requestedClaimId) ||
    claim.verification_status !== "PENDING_VERIFICATION" ||
    Number(claim.record_version) !== input.expectedVersion ||
    !sameId(claim.submitted_by_user_id, attempt.submitted_by_user_id) ||
    !nulls(
      claim.grade_change_request_id,
      claim.verified_completed_on,
      claim.verification_remarks,
      claim.verified_by_user_id,
      claim.verified_at,
    ) ||
    !textPresent(claim.evidence_summary, 10) ||
    !claim.claimed_date ||
    claim.claimed_date > sheet.today
  ) {
    sourceFail(
      "INC_COMPLETION_REVIEW_VERSION_CONFLICT",
      "Only the original pending modern claim can be reviewed in this QA checkpoint.",
    );
  }
  const [requests] = await connection.execute(
    `SELECT grade_change_request_id FROM grade_change_requests
      WHERE grade_id = ? AND status IN ('Pending Program Head', 'For Registrar Processing') FOR UPDATE`,
    [grade.grade_id],
  );
  if (requests.length)
    sourceFail(
      "INC_COMPLETION_REVIEW_REQUEST_PENDING",
      "An active grade-change request requires reconciliation.",
    );
  const [events] = await connection.execute(
    `SELECT *,
            DATE_FORMAT(previous_claimed_completed_on, '%Y-%m-%d') AS previous_claimed_date,
            DATE_FORMAT(new_claimed_completed_on, '%Y-%m-%d') AS new_claimed_date
       FROM gradebook_inc_completion_claim_events
      WHERE claim_id = ?
      ORDER BY claim_version_after, event_id FOR UPDATE`,
    [requestedClaimId],
  );

  assertPendingModernIncClaimAudit(claim, events);

  if (
    decision === "VERIFY" &&
    (!input.verifiedDate || input.verifiedDate > sheet.today)
  ) {
    sourceFail(
      "INC_COMPLETION_REVIEW_FUTURE_DATE",
      "The verified completion date must be a real, non-future date.",
      422,
    );
  }
  const verifiedDate = decision === "VERIFY" ? input.verifiedDate : null;
  const status =
    decision === "REJECT"
      ? "REJECTED"
      : verifiedDate <= sheet.deadline
        ? "VERIFIED_TIMELY"
        : "VERIFIED_LATE";
  const eventType = decision === "VERIFY" ? "VERIFIED" : "REJECTED";
  const [updated] = await connection.execute(
    `UPDATE gradebook_inc_completion_claims
        SET verification_status = ?, verified_completed_on = ?, verification_remarks = ?,
            verified_by_user_id = ?, verified_at = NOW(), record_version = record_version + 1, updated_at = NOW()
      WHERE claim_id = ? AND grade_id = ? AND record_version = ? AND verification_status = 'PENDING_VERIFICATION'`,
    [
      status,
      verifiedDate,
      input.remarks,
      actor.userId,
      requestedClaimId,
      grade.grade_id,
      input.expectedVersion,
    ],
  );
  if (Number(updated.affectedRows) !== 1)
    sourceFail(
      "INC_COMPLETION_REVIEW_VERSION_CONFLICT",
      "The claim changed during review.",
    );
  const [audit] = await connection.execute(
    `INSERT INTO gradebook_inc_completion_claim_events
       (claim_id, event_type, previous_status, new_status,
        previous_claimed_completed_on, new_claimed_completed_on,
        previous_verified_completed_on, new_verified_completed_on,
        previous_evidence_summary, new_evidence_summary,
        previous_verification_remarks, new_verification_remarks,
        event_reason, performed_by_user_id, claim_version_after)
     VALUES (?, ?, 'PENDING_VERIFICATION', ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    [
      requestedClaimId,
      eventType,
      status,
      claim.claimed_date,
      claim.claimed_date,
      verifiedDate,
      claim.evidence_summary,
      claim.evidence_summary,
      input.remarks,
      input.remarks,
      actor.userId,
      input.expectedVersion + 1,
    ],
  );
  if (Number(audit.affectedRows) !== 1 || !audit.insertId)
    throw new Error("Modern INC review audit was not inserted.");
  return {
    success: true,
    decision,
    dry_run: input.dryRun,
    persisted: !input.dryRun,
    reviewer_user_id: actor.userId,
    offering_id: offeringId,
    config_id: configId,
    publication_source: publication.publication_source,
    source: {
      publication_id: String(publication.publication_id),
      combined_submission_id: String(attempt.submission_id),
      roster_snapshot_id: String(original.roster_snapshot_id),
    },
    claim: {
      claim_id: String(requestedClaimId),
      grade_id: Number(grade.grade_id),
      previous_status: "PENDING_VERIFICATION",
      verification_status: status,
      claimed_completed_on: claim.claimed_date,
      verified_completed_on: verifiedDate,
      verification_remarks: input.remarks,
      verified_by_user_id: actor.userId,
      previous_record_version: input.expectedVersion,
      record_version: input.expectedVersion + 1,
    },
    official_sheet: {
      sheet_id: String(sheet.sheet_id),
      deadline_established: true,
      inc_completion_deadline_on: sheet.deadline,
    },
    audit_event: eventType,
    audit_event_id: input.dryRun ? null : String(audit.insertId),
    official_grade_unchanged: true,
    grade_conversion_performed: false,
  };
}
// Verify the complete claim history before using a verified INC claim.
function assertVerifiedModernIncClaimAudit(claim, events) {
  const version = Number(claim.record_version);

  const invalid = () =>
    sourceFail(
      "MODERN_INC_CLAIM_AUDIT_INVALID",
      "The completion claim audit does not match its verified state.",
    );

  if (
    !Number.isSafeInteger(version) ||
    version < 2 ||
    events.length !== version
  ) {
    invalid();
  }

  // Validate all revisions before Program Head verification.
  assertPendingModernIncClaimAudit(
    { ...claim, record_version: version - 1 },
    events.slice(0, -1),
    "MODERN_INC_CLAIM_AUDIT_INVALID",
  );

  const verified = events[version - 1];

  if (
    verified.event_type !== "VERIFIED" ||
    verified.previous_status !== "PENDING_VERIFICATION" ||
    verified.new_status !== "VERIFIED_TIMELY" ||
    Number(verified.claim_version_after) !== version ||
    !sameId(verified.performed_by_user_id, claim.verified_by_user_id) ||
    verified.previous_claimed_date !== claim.claimed_date ||
    verified.new_claimed_date !== claim.claimed_date ||
    verified.previous_evidence_summary !== claim.evidence_summary ||
    verified.new_evidence_summary !== claim.evidence_summary ||
    verified.previous_verified_completed_on !== null ||
    verified.new_verified_date !== claim.verified_date ||
    verified.previous_verification_remarks !== null ||
    verified.new_verification_remarks !== claim.verification_remarks ||
    verified.event_reason !== claim.verification_remarks
  ) {
    invalid();
  }
}

// Modern INC completion score access
export async function requireModernIncPendingScoreEntry(
  connection,
  {
    offeringId,
    configId,
    enrollmentSubjectId,
    studentId,
    actorUserId,
    facultyId,
    gradingTerm,
    assessmentId,
    scoreStatus,
    changeReason,
    dryRun,
  },
) {
  if (gradingTerm !== "FINAL_TERM") {
    sourceFail(
      "MODERN_INC_MIDTERM_LOCKED",
      "The original Midterm is permanently locked.",
    );
  }
  if (scoreStatus !== "SCORED" || !textPresent(changeReason, 10)) {
    sourceFail(
      "MODERN_INC_SCORE_INPUT_INVALID",
      "Completion requires an actual score and a documented change_reason of at least 10 characters.",
      400,
    );
  }

  // INC score writes require their own rollout approval.
  if (
    dryRun !== true &&
    process.env.GRADEBOOK_MODERN_INC_SCORE_WRITES_ENABLED !== "true"
  ) {
    sourceFail(
      "MODERN_INC_SCORE_WRITES_DISABLED",
      "INC completion score entry is not enabled on this server.",
      403,
    );
  }

  // Retain the QA guard until the modern INC source rollout is enabled.
  if (process.env.GRADEBOOK_MODERN_INC_SOURCE_WRITE_SCOPE_ENABLED !== "true") {
    await assertQaGradingDatabase(connection);
  }

  const {
    configId: sourceConfig,
    student,
    grade,
    sheet,
    attempt,
    evidence,
  } = await readModernIncSource(
    connection,
    { offeringId, enrollmentSubjectId, actorUserId },
    { lock: true },
  );
  if (
    !sameId(configId, sourceConfig) ||
    !sameId(studentId, student.student_id) ||
    !sameId(facultyId, grade.faculty_id)
  ) {
    sourceFail(
      "MODERN_INC_SCORE_SOURCE_INVALID",
      "The original finalized grade is outside this score's scope.",
    );
  }

  const [claims] = await connection.execute(
    `SELECT *, DATE_FORMAT(claimed_completed_on, '%Y-%m-%d') AS claimed_date,
            DATE_FORMAT(verified_completed_on, '%Y-%m-%d') AS verified_date
       FROM gradebook_inc_completion_claims WHERE grade_id = ? FOR UPDATE`,
    [grade.grade_id],
  );
  const claim = claims[0];
  if (
    claims.length !== 1 ||
    claim.verification_status !== "VERIFIED_TIMELY" ||
    !sameId(claim.submitted_by_user_id, attempt.submitted_by_user_id) ||
    !validUserId(claim.verified_by_user_id) ||
    !claim.verified_at ||
    !textPresent(claim.evidence_summary, 10) ||
    !textPresent(claim.verification_remarks, 15) ||
    claim.grade_change_request_id !== null ||
    !claim.claimed_date ||
    claim.claimed_date > sheet.today ||
    !claim.verified_date ||
    claim.verified_date > sheet.today ||
    claim.verified_date > sheet.deadline
  ) {
    sourceFail(
      "MODERN_INC_VERIFIED_CLAIM_REQUIRED",
      "A valid, timely Program Head-verified completion claim is required.",
    );
  }

  const [events] = await connection.execute(
    `SELECT *, DATE_FORMAT(previous_claimed_completed_on, '%Y-%m-%d') AS previous_claimed_date,
            DATE_FORMAT(new_claimed_completed_on, '%Y-%m-%d') AS new_claimed_date,
            DATE_FORMAT(new_verified_completed_on, '%Y-%m-%d') AS new_verified_date
       FROM gradebook_inc_completion_claim_events WHERE claim_id = ?
      ORDER BY claim_version_after, event_id FOR UPDATE`,
    [claim.claim_id],
  );
  const [created, verified] = events;
  if (
    events.length !== 2 ||
    created.event_type !== "CREATED" ||
    created.previous_status !== null ||
    created.new_status !== "PENDING_VERIFICATION" ||
    Number(created.claim_version_after) !== 1 ||
    !sameId(created.performed_by_user_id, claim.submitted_by_user_id) ||
    created.new_claimed_date !== claim.claimed_date ||
    created.new_evidence_summary !== claim.evidence_summary ||
    !textPresent(created.event_reason, 10) ||
    verified.event_type !== "VERIFIED" ||
    verified.previous_status !== "PENDING_VERIFICATION" ||
    verified.new_status !== "VERIFIED_TIMELY" ||
    Number(verified.claim_version_after) !== 2 ||
    !sameId(verified.performed_by_user_id, claim.verified_by_user_id) ||
    verified.previous_claimed_date !== claim.claimed_date ||
    verified.new_claimed_date !== claim.claimed_date ||
    verified.new_verified_date !== claim.verified_date ||
    verified.previous_evidence_summary !== claim.evidence_summary ||
    verified.new_evidence_summary !== claim.evidence_summary ||
    verified.new_verification_remarks !== claim.verification_remarks ||
    verified.event_reason !== claim.verification_remarks
  ) {
    sourceFail(
      "MODERN_INC_CLAIM_AUDIT_INVALID",
      "The completion claim audit does not match its verified state.",
    );
  }

  assertVerifiedModernIncClaimAudit(claim, events);

  const [requests] = await connection.execute(
    `SELECT grade_change_request_id FROM grade_change_requests
      WHERE grade_id = ? AND status IN ('Pending Program Head', 'For Registrar Processing') FOR UPDATE`,
    [grade.grade_id],
  );
  if (requests.length) {
    sourceFail(
      "MODERN_INC_SCORE_REVIEW_LOCKED",
      "An active grade-change request locks completion scores.",
    );
  }

  const pending = evidence.pending_assessments.filter((a) =>
    sameId(a.assessment_id, assessmentId),
  );
  if (pending.length !== 1 || pending[0].grading_term !== "FINAL_TERM") {
    sourceFail(
      "MODERN_INC_ASSESSMENT_NOT_PENDING",
      "Only assessments documented as pending in the original INC snapshot may be completed.",
    );
  }
  const original = pending[0];
  const [assessments] = await connection.execute(
    `SELECT a.assessment_id, a.grading_term, a.header_name, a.maximum_score, a.record_status, oc.category_code
       FROM gradebook_assessments a
       JOIN gradebook_offering_categories oc ON oc.offering_category_id = a.offering_category_id
      WHERE a.assessment_id = ? AND oc.config_id = ? FOR UPDATE`,
    [assessmentId, configId],
  );
  const assessment = assessments[0];
  if (
    assessments.length !== 1 ||
    assessment.record_status !== "ACTIVE" ||
    assessment.grading_term !== original.grading_term ||
    assessment.header_name !== original.header_name ||
    assessment.category_code !== original.category_code ||
    decimalUnits(original.maximum_score) === null ||
    decimalUnits(original.maximum_score) !==
      decimalUnits(assessment.maximum_score)
  ) {
    sourceFail(
      "MODERN_INC_ASSESSMENT_SOURCE_INVALID",
      "The assessment no longer matches the original pending requirement.",
    );
  }

  const [scores] = await connection.execute(
    `SELECT score_id, score_status, earned_score, not_applicable_reason, record_version
       FROM gradebook_scores WHERE assessment_id = ? AND enrollment_subject_id = ? FOR UPDATE`,
    [assessmentId, enrollmentSubjectId],
  );
  if (scores.length > 1)
    sourceFail(
      "MODERN_INC_SCORE_SOURCE_INVALID",
      "Multiple score records were found.",
    );
  const score = scores[0] ?? null;
  if (score && score.score_status !== "PENDING") {
    sourceFail(
      "MODERN_INC_SCORE_RESOLVED_LOCKED",
      "The outstanding assessment is already resolved. Further changes require an authorized correction.",
    );
  }
  if (original.score_id === null) {
    if (score !== null || original.record_version !== null) {
      sourceFail(
        "MODERN_INC_SCORE_SOURCE_INVALID",
        "The pending score no longer matches its original snapshot.",
      );
    }
  } else if (
    !score ||
    !sameId(score.score_id, original.score_id) ||
    !sameId(score.record_version, original.record_version) ||
    !nulls(score.earned_score, score.not_applicable_reason)
  ) {
    sourceFail(
      "MODERN_INC_SCORE_SOURCE_INVALID",
      "The pending score no longer matches its original snapshot.",
    );
  }

  return {
    claim_id: String(claim.claim_id),
    grade_id: Number(grade.grade_id),
    verified_completed_on: claim.verified_date,
  };
}
// Validate completed scores against the original INC history.
function assertModernIncCompletionScoreAudit(
  pending,
  score,
  events,
  claimId,
  actorUserId,
) {
  const invalid = () =>
    sourceFail(
      "MODERN_INC_PREVIEW_SCORE_AUDIT_INVALID",
      "The completed score does not match its original INC audit history.",
    );

  const originalVersion =
    pending.score_id === null ? 0 : Number(pending.record_version);
  const completedVersion = originalVersion + 1;

  if (
    !Number.isSafeInteger(completedVersion) ||
    completedVersion < 1 ||
    completedVersion > 4294967295 ||
    Number(score.record_version) !== completedVersion ||
    events.length !== completedVersion ||
    (originalVersion > 0 && !sameId(score.score_id, pending.score_id))
  ) {
    invalid();
  }

  const sameAmount = (left, right) =>
    left === null || right === null
      ? left === right
      : decimalUnits(left) !== null &&
        decimalUnits(left) === decimalUnits(right);

  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    const previous = events[index - 1];

    if (
      !sameId(event.score_id, score.score_id) ||
      Number(event.score_version_after) !== index + 1 ||
      event.event_type !== (index === 0 ? "CREATED" : "UPDATED") ||
      (index === 0
        ? !nulls(
            event.previous_score_status,
            event.previous_earned_score,
            event.previous_na_reason,
          )
        : event.previous_score_status !== previous.new_score_status ||
          !sameAmount(event.previous_earned_score, previous.new_earned_score) ||
          event.previous_na_reason !== previous.new_na_reason)
    ) {
      invalid();
    }
  }

  const originalEvent =
    originalVersion > 0 ? events[originalVersion - 1] : null;

  if (
    originalEvent &&
    (originalEvent.new_score_status !== "PENDING" ||
      !nulls(originalEvent.new_earned_score, originalEvent.new_na_reason))
  ) {
    invalid();
  }

  const completed = events[events.length - 1];

  if (
    completed.change_context !== "DRAFT_ENTRY" ||
    !sameId(completed.changed_by_user_id, actorUserId) ||
    completed.previous_score_status !==
      (originalVersion === 0 ? null : "PENDING") ||
    completed.new_score_status !== "SCORED" ||
    !nulls(
      completed.previous_earned_score,
      completed.previous_na_reason,
      completed.new_na_reason,
    ) ||
    !sameAmount(completed.new_earned_score, score.earned_score) ||
    !String(completed.change_reason ?? "").startsWith(
      `INC_COMPLETION_CLAIM_${claimId}: `,
    )
  ) {
    invalid();
  }
}
// Modern INC completion preview (read-only; shared calculator)
export async function previewModernIncCompletion(
  connection,
  ids,
  calculateGradePreview,
) {
  const source = await readModernIncSource(connection, ids);
  const {
    configId,
    student,
    grade,
    sheet,
    original,
    publication,
    attempt,
    evidence,
  } = source;
  const [claims] = await connection.execute(
    `SELECT *, DATE_FORMAT(claimed_completed_on, '%Y-%m-%d') AS claimed_date,
            DATE_FORMAT(verified_completed_on, '%Y-%m-%d') AS verified_date
       FROM gradebook_inc_completion_claims WHERE grade_id = ?`,
    [grade.grade_id],
  );
  const claim = claims[0];
  if (
    claims.length !== 1 ||
    claim.verification_status !== "VERIFIED_TIMELY" ||
    !sameId(claim.submitted_by_user_id, attempt.submitted_by_user_id) ||
    !validUserId(claim.verified_by_user_id) ||
    !claim.verified_at ||
    !textPresent(claim.evidence_summary, 10) ||
    !textPresent(claim.verification_remarks, 15) ||
    claim.grade_change_request_id !== null ||
    !claim.claimed_date ||
    claim.claimed_date > sheet.today ||
    !claim.verified_date ||
    claim.verified_date > sheet.today ||
    claim.verified_date > sheet.deadline
  ) {
    sourceFail(
      "MODERN_INC_VERIFIED_CLAIM_REQUIRED",
      "A valid, timely Program Head-verified completion claim is required.",
    );
  }

  const [events] = await connection.execute(
    `SELECT *, DATE_FORMAT(previous_claimed_completed_on, '%Y-%m-%d') AS previous_claimed_date,
            DATE_FORMAT(new_claimed_completed_on, '%Y-%m-%d') AS new_claimed_date,
            DATE_FORMAT(new_verified_completed_on, '%Y-%m-%d') AS new_verified_date
       FROM gradebook_inc_completion_claim_events WHERE claim_id = ?
      ORDER BY claim_version_after, event_id`,
    [claim.claim_id],
  );
  const [created, verified] = events;
  if (
    events.length !== 2 ||
    created.event_type !== "CREATED" ||
    created.previous_status !== null ||
    created.new_status !== "PENDING_VERIFICATION" ||
    Number(created.claim_version_after) !== 1 ||
    !sameId(created.performed_by_user_id, claim.submitted_by_user_id) ||
    created.new_claimed_date !== claim.claimed_date ||
    created.new_evidence_summary !== claim.evidence_summary ||
    !textPresent(created.event_reason, 10) ||
    verified.event_type !== "VERIFIED" ||
    verified.previous_status !== "PENDING_VERIFICATION" ||
    verified.new_status !== "VERIFIED_TIMELY" ||
    Number(verified.claim_version_after) !== 2 ||
    !sameId(verified.performed_by_user_id, claim.verified_by_user_id) ||
    verified.previous_claimed_date !== claim.claimed_date ||
    verified.new_claimed_date !== claim.claimed_date ||
    verified.new_verified_date !== claim.verified_date ||
    verified.previous_evidence_summary !== claim.evidence_summary ||
    verified.new_evidence_summary !== claim.evidence_summary ||
    verified.new_verification_remarks !== claim.verification_remarks ||
    verified.event_reason !== claim.verification_remarks
  ) {
    sourceFail(
      "MODERN_INC_CLAIM_AUDIT_INVALID",
      "The completion claim audit does not match its verified state.",
    );
  }

  assertVerifiedModernIncClaimAudit(claim, events);

  const [requests] = await connection.execute(
    `SELECT grade_change_request_id FROM grade_change_requests
      WHERE grade_id = ? AND status IN ('Pending Program Head', 'For Registrar Processing')`,
    [grade.grade_id],
  );
  if (requests.length) {
    sourceFail(
      "MODERN_INC_SCORE_REVIEW_LOCKED",
      "An active grade-change request locks completion scores.",
    );
  }

  // Validate every originally pending Final Term assessment.
  const pendingAssessments = evidence.pending_assessments;
  const pendingIds = new Set();

  if (
    !Array.isArray(pendingAssessments) ||
    pendingAssessments.length === 0 ||
    pendingAssessments.some((pending) => {
      const id = Number(pending?.assessment_id);
      const originallyMissing =
        pending.score_id === null && pending.record_version === null;

      const originallyPending =
        pending.score_id !== null &&
        pending.record_version !== null &&
        Number.isSafeInteger(Number(pending.score_id)) &&
        Number(pending.score_id) > 0 &&
        Number.isSafeInteger(Number(pending.record_version)) &&
        Number(pending.record_version) > 0;

      if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        pendingIds.has(id) ||
        pending.grading_term !== "FINAL_TERM" ||
        !textPresent(pending.category_code) ||
        (!originallyMissing && !originallyPending)
      ) {
        return true;
      }

      pendingIds.add(id);
      return false;
    })
  ) {
    sourceFail(
      "MODERN_INC_PREVIEW_SCOPE_INVALID",
      "Each outstanding assessment must be distinct and originally unscored.",
    );
  }

  const completionScores = [];

  for (const pending of pendingAssessments) {
    const [assessments] = await connection.execute(
      `SELECT
        a.assessment_id,
        a.header_name,
        a.maximum_score,
        a.grading_term,
        a.record_status,
        oc.category_code
     FROM gradebook_assessments a
     JOIN gradebook_offering_categories oc
       ON oc.offering_category_id = a.offering_category_id
     WHERE a.assessment_id = ?
       AND oc.config_id = ?`,
      [pending.assessment_id, configId],
    );

    const assessment = assessments[0];

    if (
      assessments.length !== 1 ||
      assessment.record_status !== "ACTIVE" ||
      assessment.grading_term !== "FINAL_TERM" ||
      assessment.header_name !== pending.header_name ||
      assessment.category_code !== pending.category_code ||
      decimalUnits(assessment.maximum_score) === null ||
      decimalUnits(assessment.maximum_score) !==
        decimalUnits(pending.maximum_score)
    ) {
      sourceFail(
        "MODERN_INC_PREVIEW_ASSESSMENT_INVALID",
        "An outstanding assessment no longer matches the original INC evidence.",
      );
    }

    const [scores] = await connection.execute(
      `SELECT
        score_id,
        score_status,
        earned_score,
        not_applicable_reason,
        record_version
     FROM gradebook_scores
     WHERE assessment_id = ?
       AND enrollment_subject_id = ?`,
      [pending.assessment_id, ids.enrollmentSubjectId],
    );

    const score = scores[0];
    const expectedVersion =
      pending.score_id === null ? 1 : Number(pending.record_version) + 1;

    if (
      scores.length !== 1 ||
      score.score_status !== "SCORED" ||
      Number(score.record_version) !== expectedVersion ||
      (pending.score_id !== null &&
        !sameId(score.score_id, pending.score_id)) ||
      decimalUnits(score.earned_score) === null ||
      decimalUnits(score.earned_score) >
        decimalUnits(assessment.maximum_score) ||
      score.not_applicable_reason !== null
    ) {
      sourceFail(
        "MODERN_INC_PREVIEW_SCORE_REQUIRED",
        "Every outstanding assessment requires a valid completion score.",
      );
    }

    const [scoreEvents] = await connection.execute(
      `SELECT *
     FROM gradebook_score_events
     WHERE score_id = ?
     ORDER BY score_version_after`,
      [score.score_id],
    );

    const event = scoreEvents[0];

    assertModernIncCompletionScoreAudit(
      pending,
      score,
      scoreEvents,
      claim.claim_id,
      ids.actorUserId,
    );
  }

  completionScores.push({
    assessment_id: Number(pending.assessment_id),
    score_id: Number(score.score_id),
    earned_score: String(score.earned_score),
    record_version: Number(score.record_version),
    claim_audit_verified: true,
  });

  const [attendance] = await connection.execute(
    `SELECT m.meeting_id, m.grading_term,
            DATE_FORMAT(m.meeting_date, '%Y-%m-%d') AS meeting_date,
            COALESCE(a.attendance_status, 'PENDING') AS attendance_status,
            a.record_version, a.recorded_by_user_id, a.recorded_at
       FROM gradebook_attendance_meetings m
       LEFT JOIN gradebook_attendance_entries a
         ON a.meeting_id = m.meeting_id AND a.enrollment_subject_id = ?
      WHERE m.config_id = ? AND m.meeting_status = 'HELD' AND m.meeting_date <= CURDATE()
      ORDER BY m.meeting_date, m.meeting_id`,
    [ids.enrollmentSubjectId, configId],
  );
  const canonical = (value) =>
    JSON.stringify(value, (_key, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, v[k]]),
          )
        : v,
    );
  if (canonical(attendance) !== canonical(evidence.attendance_entries)) {
    sourceFail(
      "MODERN_INC_PREVIEW_ATTENDANCE_CHANGED",
      "The original attendance evidence has changed.",
    );
  }

  const calculated = await calculateGradePreview(
    connection,
    ids.offeringId,
    ids.enrollmentSubjectId,
    ids.actorUserId,
    { allowVerifiedIncCompletion: true },
  );
  const snapshot = jsonObject(attempt.calculation_snapshot_json);
  const actualMid = calculated.terms?.MIDTERM;
  const actualFinal = calculated.terms?.FINAL_TERM;
  const originalMid = snapshot?.calculated_terms?.MIDTERM;
  const originalFinal = snapshot?.calculated_terms?.FINAL_TERM;
  // Protect every unaffected assessment, including assessments
  // in categories containing newly completed INC scores.
  const protectedFinalInputsMatch = () => {
    const before = originalFinal?.categories;
    const after = actualFinal?.categories;

    if (
      !Array.isArray(before) ||
      !Array.isArray(after) ||
      before.length !== after.length
    ) {
      return false;
    }

    const seenPending = new Set();

    for (let i = 0; i < before.length; i++) {
      const oldCategory = before[i];
      const newCategory = after[i];

      if (
        oldCategory.category_code !== newCategory.category_code ||
        oldCategory.category_name !== newCategory.category_name ||
        oldCategory.category_weight_percent !==
          newCategory.category_weight_percent
      ) {
        return false;
      }

      const oldRows = oldCategory.assessments;
      const newRows = newCategory.assessments;

      if (!Array.isArray(oldRows) || !Array.isArray(newRows)) {
        if (canonical(oldCategory) !== canonical(newCategory)) {
          return false;
        }

        continue;
      }

      if (
        oldRows.length !== newRows.length ||
        oldCategory.assessment_count !== newCategory.assessment_count
      ) {
        return false;
      }

      let modified = false;

      for (let j = 0; j < oldRows.length; j++) {
        const oldScore = oldRows[j];
        const newScore = newRows[j];

        if (!sameId(oldScore.assessment_id, newScore.assessment_id)) {
          return false;
        }

        if (!pendingIds.has(Number(oldScore.assessment_id))) {
          if (canonical(oldScore) !== canonical(newScore)) {
            return false;
          }
        } else {
          modified = true;

          const completed = completionScores.find((score) =>
            sameId(score.assessment_id, oldScore.assessment_id),
          );

          if (
            seenPending.has(Number(oldScore.assessment_id)) ||
            !completed ||
            oldScore.score_status !== "PENDING" ||
            oldScore.earned_score !== null ||
            newScore.score_status !== "SCORED" ||
            decimalUnits(newScore.earned_score) !==
              decimalUnits(completed.earned_score) ||
            canonical({
              ...oldScore,
              score_status: "SCORED",
              earned_score: newScore.earned_score,
            }) !== canonical(newScore)
          ) {
            return false;
          }

          seenPending.add(Number(oldScore.assessment_id));
        }
      }

      if (!modified && canonical(oldCategory) !== canonical(newCategory)) {
        return false;
      }
    }

    return seenPending.size === pendingIds.size;
  };

  if (
    calculated.config_id !== configId ||
    !sameId(calculated.student?.student_id, student.student_id) ||
    calculated.grading_policy !== "TWO_TERM_50_50" ||
    calculated.grading_classification !== snapshot?.classification ||
    Number(calculated.term_weights?.MIDTERM) !== 50 ||
    Number(calculated.term_weights?.FINAL_TERM) !== 50 ||
    actualMid?.state !== "READY" ||
    canonical(actualMid) !== canonical(originalMid) ||
    !protectedFinalInputsMatch()
  ) {
    sourceFail(
      "MODERN_INC_PREVIEW_PROTECTED_INPUT_CHANGED",
      "A preserved Midterm or unrelated Final Term assessment has changed.",
    );
  }
  if (
    actualFinal?.state !== "READY" ||
    calculated.semester?.state !== "READY"
  ) {
    sourceFail(
      "MODERN_INC_PREVIEW_CALCULATION_INCOMPLETE",
      "All required grade categories must be complete before a replacement preview.",
    );
  }
  return {
    ...calculated,
    success: true,
    read_only: true,
    preview_scope: "INC_COMPLETION_FINAL_TERM",
    publication_source: "COMBINED_SEMESTER",
    source: {
      publication_id: String(publication.publication_id),
      combined_submission_id: String(attempt.submission_id),
      roster_snapshot_id: String(original.roster_snapshot_id),
    },
    protected_official_grade: {
      grade_id: Number(grade.grade_id),
      grade_status: grade.grade_status,
      grading_outcome: grade.grading_outcome,
      final_rating: String(grade.final_rating),
      unchanged: true,
    },
    verified_claim: {
      claim_id: String(claim.claim_id),
      verification_status: claim.verification_status,
      record_version: Number(claim.record_version),
      verified_completed_on: claim.verified_date,
    },
    official_sheet: {
      sheet_id: String(sheet.sheet_id),
      record_version: Number(sheet.record_version),
      original_official_submitted_on: sheet.original_date,
      inc_completion_deadline_on: sheet.deadline,
    },
    completion_scores: completionScores,

    completion_score:
      completionScores.length === 1 ? completionScores[0] : null,
    midterm_approval: {
      combined_submission_id: String(attempt.submission_id),
      matched_approved_snapshot: true,
    },
    numeric_preview_only: true,
    inc_completion_submission_enabled: true,
    official_grade_publication_enabled: false,
    note: "Read-only replacement-grade preview. The original official INC grade and finalized snapshot remain unchanged.",
  };
}

// Validate legacy and versioned INC completion snapshots.
function modernIncCompletionSnapshotFields(
  saved,
  preview,
  { allowMultiple = false } = {},
) {
  const scores = preview?.completion_scores;

  if (
    !saved ||
    !Array.isArray(scores) ||
    scores.length < 1 ||
    scores.length > 200
  ) {
    sourceFail(
      "MODERN_INC_COMPLETION_SNAPSHOT_INVALID",
      "The completed assessment collection is missing or invalid.",
    );
  }

  const validCollection = (items) => {
    if (!Array.isArray(items) || items.length !== scores.length) {
      return false;
    }

    const assessmentIds = new Set();
    const scoreIds = new Set();

    for (const item of items) {
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        Object.keys(item).length !== 5 ||
        ![
          "assessment_id",
          "score_id",
          "earned_score",
          "record_version",
          "claim_audit_verified",
        ].every((key) => Object.prototype.hasOwnProperty.call(item, key)) ||
        !Number.isSafeInteger(item.assessment_id) ||
        item.assessment_id <= 0 ||
        !Number.isSafeInteger(item.score_id) ||
        item.score_id <= 0 ||
        !Number.isSafeInteger(item.record_version) ||
        item.record_version <= 0 ||
        decimalUnits(item.earned_score) === null ||
        item.claim_audit_verified !== true ||
        assessmentIds.has(item.assessment_id) ||
        scoreIds.has(item.score_id)
      ) {
        return false;
      }

      assessmentIds.add(item.assessment_id);
      scoreIds.add(item.score_id);
    }

    return true;
  };

  if (!validCollection(scores)) {
    sourceFail(
      "MODERN_INC_COMPLETION_SNAPSHOT_INVALID",
      "The completion preview contains duplicate or invalid score references.",
    );
  }

  const multiple = scores.length > 1;

  if (multiple && !allowMultiple) {
    sourceFail(
      "MODERN_INC_MULTI_ASSESSMENT_APPROVAL_NOT_ENABLED",
      "Multiple completion scores are not enabled for this operation.",
      403,
    );
  }

  // Preserve historical single-score snapshots.
  if (!Object.prototype.hasOwnProperty.call(saved, "snapshot_schema_version")) {
    if (
      multiple ||
      !preview.completion_score ||
      Object.prototype.hasOwnProperty.call(saved, "completion_scores")
    ) {
      sourceFail(
        "MODERN_INC_COMPLETION_SNAPSHOT_INVALID",
        "The legacy single-score snapshot contains unexpected completion fields.",
      );
    }

    return {
      completion_score: preview.completion_score,
    };
  }

  // Version 2 supports a collection of completed scores.
  if (
    saved.snapshot_schema_version !== 2 ||
    !Array.isArray(saved.completion_scores) ||
    !validCollection(saved.completion_scores) ||
    saved.completion_scores.some(
      (item, index) =>
        item.assessment_id !== scores[index].assessment_id ||
        item.score_id !== scores[index].score_id ||
        item.record_version !== scores[index].record_version ||
        decimalUnits(item.earned_score) !==
          decimalUnits(scores[index].earned_score) ||
        item.claim_audit_verified !== scores[index].claim_audit_verified,
    ) ||
    (multiple
      ? saved.completion_score !== null || preview.completion_score !== null
      : !saved.completion_score || !preview.completion_score)
  ) {
    sourceFail(
      "MODERN_INC_COMPLETION_SNAPSHOT_INVALID",
      "The versioned completion-score collection is inconsistent.",
    );
  }

  return {
    snapshot_schema_version: 2,
    completion_scores: scores,
    completion_score: preview.completion_score,
  };
}

// INC Completion Score Versions

function modernIncExpectedScoreVersionMap(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 200) {
    sourceFail(
      "MODERN_INC_SCORE_VERSIONS_INVALID",
      "Provide 1–200 assessment-specific score versions.",
      400,
    );
  }

  const versions = new Map();
  const scoreIds = new Set();

  for (const row of rows) {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.keys(row).length !== 3 ||
      !["assessment_id", "score_id", "record_version"].every((key) =>
        Object.prototype.hasOwnProperty.call(row, key),
      ) ||
      !Number.isSafeInteger(row.assessment_id) ||
      row.assessment_id <= 0 ||
      !Number.isSafeInteger(row.score_id) ||
      row.score_id <= 0 ||
      !Number.isSafeInteger(row.record_version) ||
      row.record_version <= 0 ||
      versions.has(row.assessment_id) ||
      scoreIds.has(row.score_id)
    ) {
      sourceFail(
        "MODERN_INC_SCORE_VERSIONS_INVALID",
        "Every assessment needs one unique score ID and positive record version.",
        400,
      );
    }

    versions.set(row.assessment_id, row);
    scoreIds.add(row.score_id);
  }

  return versions;
}
// Modern INC replacement-grade submission (first-attempt QA pilot)
export async function submitModernIncCompletion(
  connection,
  ids,
  body,
  calculateGradePreview,
) {
  const usesScoreCollection = Object.prototype.hasOwnProperty.call(
    body ?? {},
    "expected_score_versions",
  );

  const fields = [
    "expected_grade_id",
    "expected_claim_id",
    "expected_claim_version",
    "expected_sheet_version",
    usesScoreCollection ? "expected_score_versions" : "expected_score_version",
    "expected_latest_submission_id",
    "change_reason",
    "dry_run",
  ];
  const positiveInt = (v) => Number.isSafeInteger(v) && v > 0;
  const reason =
    typeof body?.change_reason === "string" ? body.change_reason.trim() : "";
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== fields.length ||
    Object.keys(body).some((k) => !fields.includes(k)) ||
    !positiveInt(body.expected_grade_id) ||
    typeof body.expected_claim_id !== "string" ||
    !/^[1-9]\d{0,19}$/.test(body.expected_claim_id) ||
    BigInt(body.expected_claim_id) > 18446744073709551615n ||
    !positiveInt(body.expected_claim_version) ||
    !positiveInt(body.expected_sheet_version) ||
    (!usesScoreCollection && !positiveInt(body.expected_score_version)) ||
    body.expected_latest_submission_id !== null ||
    reason.length < 10 ||
    reason.length > 1000 ||
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(reason) ||
    typeof body.dry_run !== "boolean"
  ) {
    sourceFail(
      "MODERN_INC_SUBMISSION_BODY_INVALID",
      "Send valid expected IDs, versions, null latest submission, documented reason and dry_run.",
      400,
    );
  }
  const expectedScoreVersions = usesScoreCollection
    ? modernIncExpectedScoreVersionMap(body.expected_score_versions)
    : null;
  // Keep replacement submissions restricted to the QA environment.
  await assertQaGradingDatabase(connection);

  const source = await readModernIncSource(connection, ids, { lock: true });
  const { grade, sheet, attempt, original } = source;
  if (
    !sameId(body.expected_grade_id, grade.grade_id) ||
    !sameId(body.expected_sheet_version, sheet.record_version)
  ) {
    sourceFail(
      "MODERN_INC_SUBMISSION_STALE",
      "The original grade or official sheet has changed. Reload preview.",
    );
  }
  const [claims] = await connection.execute(
    `SELECT claim_id, record_version, verification_status FROM gradebook_inc_completion_claims
      WHERE grade_id = ? FOR UPDATE`,
    [grade.grade_id],
  );
  if (
    claims.length !== 1 ||
    !sameId(claims[0].claim_id, body.expected_claim_id) ||
    !sameId(claims[0].record_version, body.expected_claim_version) ||
    claims[0].verification_status !== "VERIFIED_TIMELY"
  ) {
    sourceFail(
      "MODERN_INC_SUBMISSION_STALE_CLAIM",
      "The verified completion claim has changed. Reload preview.",
    );
  }
  const [existing] = await connection.execute(
    `SELECT submission_id FROM gradebook_modern_inc_submissions WHERE grade_id = ? OR claim_id = ? FOR UPDATE`,
    [grade.grade_id, claims[0].claim_id],
  );
  if (existing.length)
    sourceFail(
      "MODERN_INC_SUBMISSION_ALREADY_EXISTS",
      "A replacement-grade submission already exists.",
    );

  const preview = await previewModernIncCompletion(
    connection,
    ids,
    calculateGradePreview,
  );
  // Multiple scores require an exact per-assessment version list.
  // The source reader still enforces the authorized QA pilot.
  if (
    !Array.isArray(preview.completion_scores) ||
    preview.completion_scores.length === 0 ||
    (preview.completion_scores.length > 1 && !usesScoreCollection)
  ) {
    sourceFail(
      "MODERN_INC_SCORE_VERSIONS_REQUIRED",
      "Submit each completed assessment with its score ID and current record version.",
      400,
    );
  }

  const scoreVersionsMatch = usesScoreCollection
    ? preview.completion_scores.length === expectedScoreVersions.size &&
      preview.completion_scores.every((score) => {
        const expected = expectedScoreVersions.get(score.assessment_id);

        return (
          expected &&
          sameId(expected.score_id, score.score_id) &&
          sameId(expected.record_version, score.record_version)
        );
      })
    : preview.completion_scores.length === 1 &&
      sameId(
        preview.completion_score?.record_version,
        body.expected_score_version,
      );

  if (
    !scoreVersionsMatch ||
    !sameId(
      preview.verified_claim.record_version,
      body.expected_claim_version,
    ) ||
    !sameId(preview.verified_claim.claim_id, body.expected_claim_id) ||
    !sameId(
      preview.official_sheet.record_version,
      body.expected_sheet_version,
    ) ||
    preview.semester.state !== "READY" ||
    preview.terms.FINAL_TERM.state !== "READY" ||
    preview.midterm_approval.matched_approved_snapshot !== true
  ) {
    sourceFail(
      "MODERN_INC_SUBMISSION_STALE_PREVIEW",
      "The completed calculation or assessment evidence has changed. Reload preview.",
    );
  }
  const snapshot = {
    submission_context: "MODERN_INC_COMPLETION_FINAL_TERM",
    publication_source: "COMBINED_SEMESTER",
    offering_id: ids.offeringId,
    config_id: source.configId,
    enrollment_subject_id: ids.enrollmentSubjectId,
    student_id: Number(source.student.student_id),
    original_inc_grade_id: Number(grade.grade_id),
    source: preview.source,
    official_sheet: preview.official_sheet,
    verified_claim: preview.verified_claim,

    snapshot_schema_version: 2,
    completion_scores: preview.completion_scores,
    completion_score: preview.completion_score,

    protected_official_grade: preview.protected_official_grade,
    midterm_approval: preview.midterm_approval,
    grading_policy: preview.grading_policy,
    grading_classification: preview.grading_classification,
    term_weights: preview.term_weights,
    terms: preview.terms,
    semester: preview.semester,
    submission_reason: reason,
  };
  const saved = JSON.stringify(snapshot);
  const [insert] = await connection.execute(
    `INSERT INTO gradebook_modern_inc_submissions
      (claim_id,claim_version,grade_id,sheet_id,combined_submission_id,roster_snapshot_id,
       calculation_snapshot_json,submission_reason,submission_status,record_version,submitted_by_user_id)
     VALUES (?,?,?,?,?,?,?,?,'SUBMITTED',1,?)`,
    [
      claims[0].claim_id,
      body.expected_claim_version,
      grade.grade_id,
      sheet.sheet_id,
      attempt.submission_id,
      original.roster_snapshot_id,
      saved,
      reason,
      ids.actorUserId,
    ],
  );
  if (Number(insert.affectedRows) !== 1)
    throw new Error("Modern INC submission insert failed.");
  const submissionId = String(insert.insertId);
  const [event] = await connection.execute(
    `INSERT INTO gradebook_modern_inc_submission_events
      (submission_id,event_type,previous_status,new_status,submission_version_after,performed_by_user_id,event_reason,snapshot_json)
     VALUES (?,'SUBMITTED',NULL,'SUBMITTED',1,?,?,?)`,
    [submissionId, ids.actorUserId, reason, saved],
  );
  if (Number(event.affectedRows) !== 1)
    throw new Error("Modern INC submission audit insert failed.");
  return {
    success: true,
    dry_run: body.dry_run,
    persisted: !body.dry_run,
    submission_context: snapshot.submission_context,
    offering_id: ids.offeringId,
    config_id: source.configId,
    enrollment_subject_id: ids.enrollmentSubjectId,
    publication_source: snapshot.publication_source,
    source: snapshot.source,
    claim_id: String(claims[0].claim_id),
    original_inc_grade_id: Number(grade.grade_id),
    submission_id: body.dry_run ? null : submissionId,
    submission_status: "SUBMITTED",
    record_version: 1,
    calculated_midterm: preview.terms.MIDTERM.term_percentage,
    calculated_final_term: preview.terms.FINAL_TERM.term_percentage,
    proposed_semester: preview.semester,

    ...(usesScoreCollection
      ? { completion_scores: preview.completion_scores }
      : {}),

    audit_event: "SUBMITTED",
    audit_event_id: body.dry_run ? null : String(event.insertId),
    official_grade_unchanged: true,
    original_snapshot_unchanged: true,
    grade_conversion_performed: false,
  };
}
// Modern INC replacement approval (first-attempt QA pilot).
export async function approveModernIncCompletion(
  connection,
  actor,
  submissionId,
  body,
  calculateGradePreview,
) {
  const fields = [
    "expected_record_version",
    "confirm_approval",
    "review_remarks",
    "dry_run",
  ];
  const remarks =
    typeof body?.review_remarks === "string" ? body.review_remarks.trim() : "";
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== fields.length ||
    Object.keys(body).some((k) => !fields.includes(k)) ||
    body.expected_record_version !== 1 ||
    body.confirm_approval !== true ||
    remarks.length < 20 ||
    remarks.length > 1000 ||
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(remarks) ||
    typeof body.dry_run !== "boolean"
  ) {
    sourceFail(
      "MODERN_INC_APPROVAL_BODY_INVALID",
      "Confirm approval, supply version 1, a documented review reason and dry_run.",
      400,
    );
  }
  // Resolve the Program Head and original INC source.
  if (
    !validUserId(actor?.userId) ||
    !Number.isSafeInteger(Number(actor?.departmentId)) ||
    Number(actor.departmentId) <= 0
  ) {
    sourceFail(
      "MODERN_INC_APPROVAL_FORBIDDEN",
      "An active Program Head assignment is required.",
      403,
    );
  }

  await assertQaGradingDatabase(connection);

  const [submissionSources] = await connection.execute(
    `SELECT
      ms.grade_id AS submitted_grade_id,
      es.enrollment_subject_id,
      es.offering_id,
      f.user_id AS instructor_user_id,
      cr.department_id
   FROM gradebook_modern_inc_submissions ms
   JOIN grades g
     ON g.grade_id = ms.grade_id
   JOIN enrollment_subjects es
     ON es.enrollment_subject_id = g.enrollment_subject_id
   JOIN subject_offerings so
     ON so.offering_id = es.offering_id
   JOIN faculty f
     ON f.faculty_id = so.faculty_id
   JOIN sections sec
     ON sec.section_id = so.section_id
   JOIN courses cr
     ON cr.course_id = sec.course_id
   WHERE ms.submission_id = ?`,
    [submissionId],
  );

  if (submissionSources.length !== 1) {
    sourceFail(
      "MODERN_INC_APPROVAL_NOT_FOUND",
      "The replacement submission was not found.",
      404,
    );
  }

  const selected = submissionSources[0];

  if (!sameId(selected.department_id, actor.departmentId)) {
    sourceFail(
      "MODERN_INC_APPROVAL_NOT_FOUND",
      "The replacement submission is outside your assigned department.",
      404,
    );
  }

  const ids = {
    offeringId: Number(selected.offering_id),
    enrollmentSubjectId: Number(selected.enrollment_subject_id),
    actorUserId: Number(selected.instructor_user_id),
  };

  // Preserve the existing #130 / #277 QA write pilot.
  const source = await readModernIncSource(connection, ids, { lock: true });

  const { grade, sheet, attempt, original, configId } = source;

  if (!sameId(selected.submitted_grade_id, grade.grade_id)) {
    sourceFail(
      "MODERN_INC_APPROVAL_SOURCE_MISMATCH",
      "The replacement submission no longer matches its original INC grade.",
    );
  }
  const [reviewers] = await connection.execute(
    `SELECT ph.program_head_id FROM program_heads ph
       JOIN faculty f ON f.faculty_id = ph.faculty_id
       JOIN users u ON u.user_id = f.user_id
       JOIN roles r ON r.role_id = u.role_id
       JOIN subject_offerings so ON so.offering_id = ?
       JOIN sections sec ON sec.section_id = so.section_id
       JOIN courses cr ON cr.course_id = sec.course_id AND cr.department_id = ph.department_id
      WHERE f.user_id = ? AND ph.department_id = ? AND ph.is_active = 1
        AND (ph.start_date IS NULL OR ph.start_date <= CURDATE())
        AND (ph.end_date IS NULL OR ph.end_date >= CURDATE())
        AND u.is_active = 1 AND u.is_archived = 0 AND r.role_name = 'Program Head'
      FOR UPDATE`,
    [ids.offeringId, actor.userId, actor.departmentId],
  );
  if (!reviewers.length)
    sourceFail(
      "MODERN_INC_APPROVAL_FORBIDDEN",
      "An active Program Head assignment for this offering is required.",
      403,
    );
  const [claims] = await connection.execute(
    `SELECT claim_id, record_version, verification_status FROM gradebook_inc_completion_claims
      WHERE grade_id = ? FOR UPDATE`,
    [grade.grade_id],
  );
  const claim = claims[0];
  if (
    claims.length !== 1 ||
    claim.verification_status !== "VERIFIED_TIMELY" ||
    !Number.isSafeInteger(Number(claim.record_version)) ||
    Number(claim.record_version) < 2
  ) {
    sourceFail(
      "MODERN_INC_APPROVAL_CLAIM_INVALID",
      "The timely completion claim no longer matches its verified version.",
    );
  }
  const [submissions] = await connection.execute(
    `SELECT * FROM gradebook_modern_inc_submissions WHERE grade_id = ? OR claim_id = ? FOR UPDATE`,
    [grade.grade_id, claim.claim_id],
  );
  const submitted = submissions[0];
  if (
    submissions.length !== 1 ||
    !sameId(submitted.submission_id, submissionId)
  ) {
    sourceFail(
      "MODERN_INC_APPROVAL_NOT_FOUND",
      "Replacement submission was not found in the authorized QA scope.",
      404,
    );
  }
  if (
    submitted.submission_status !== "SUBMITTED" ||
    Number(submitted.record_version) !== body.expected_record_version ||
    !sameId(submitted.claim_id, claim.claim_id) ||
    !sameId(submitted.claim_version, claim.record_version) ||
    !sameId(submitted.grade_id, grade.grade_id) ||
    !sameId(submitted.sheet_id, sheet.sheet_id) ||
    !sameId(submitted.combined_submission_id, attempt.submission_id) ||
    !sameId(submitted.roster_snapshot_id, original.roster_snapshot_id) ||
    !sameId(submitted.submitted_by_user_id, ids.actorUserId) ||
    !submitted.submitted_at ||
    !nulls(
      submitted.reviewed_by_user_id,
      submitted.reviewed_at,
      submitted.review_remarks,
    ) ||
    !textPresent(submitted.submission_reason, 10)
  ) {
    sourceFail(
      "MODERN_INC_APPROVAL_STATE_CONFLICT",
      "The submitted replacement or its source links changed. Reload the submission.",
    );
  }
  const [events] = await connection.execute(
    `SELECT * FROM gradebook_modern_inc_submission_events WHERE submission_id = ?
      ORDER BY submission_version_after, event_id FOR UPDATE`,
    [submissionId],
  );
  const saved = jsonObject(submitted.calculation_snapshot_json);
  const event = events[0];
  const canonical = (value) =>
    JSON.stringify(value, (_key, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, v[k]]),
          )
        : v,
    );
  if (
    !saved ||
    events.length !== 1 ||
    event.event_type !== "SUBMITTED" ||
    event.previous_status !== null ||
    event.new_status !== "SUBMITTED" ||
    Number(event.submission_version_after) !== 1 ||
    !sameId(event.performed_by_user_id, submitted.submitted_by_user_id) ||
    event.event_reason !== submitted.submission_reason ||
    canonical(jsonObject(event.snapshot_json)) !== canonical(saved)
  ) {
    sourceFail(
      "MODERN_INC_APPROVAL_AUDIT_INVALID",
      "The original submission audit and calculation do not match.",
    );
  }
  // Read under the same source locks as the score and submission writers.
  const preview = await previewModernIncCompletion(
    connection,
    ids,
    calculateGradePreview,
  );

  const current = {
    submission_context: "MODERN_INC_COMPLETION_FINAL_TERM",
    publication_source: "COMBINED_SEMESTER",
    offering_id: ids.offeringId,
    config_id: configId,
    enrollment_subject_id: ids.enrollmentSubjectId,
    student_id: Number(source.student.student_id),
    original_inc_grade_id: Number(grade.grade_id),
    source: preview.source,
    official_sheet: preview.official_sheet,
    verified_claim: preview.verified_claim,

    ...modernIncCompletionSnapshotFields(saved, preview, {
      allowMultiple: true,
    }),

    protected_official_grade: preview.protected_official_grade,
    midterm_approval: preview.midterm_approval,
    grading_policy: preview.grading_policy,
    grading_classification: preview.grading_classification,
    term_weights: preview.term_weights,
    terms: preview.terms,
    semester: preview.semester,
    submission_reason: submitted.submission_reason,
  };
  if (
    preview.semester.state !== "READY" ||
    preview.terms.FINAL_TERM.state !== "READY" ||
    preview.midterm_approval.matched_approved_snapshot !== true ||
    canonical(saved) !== canonical(current)
  ) {
    sourceFail(
      "MODERN_INC_APPROVAL_CALCULATION_CHANGED",
      "The current validated calculation or evidence differs from the submitted snapshot.",
    );
  }
  const [updated] = await connection.execute(
    `UPDATE gradebook_modern_inc_submissions SET submission_status = 'APPROVED',
        reviewed_by_user_id = ?, reviewed_at = NOW(6), review_remarks = ?, record_version = record_version + 1
      WHERE submission_id = ? AND submission_status = 'SUBMITTED' AND record_version = ?`,
    [actor.userId, remarks, submissionId, body.expected_record_version],
  );
  if (Number(updated.affectedRows) !== 1)
    sourceFail(
      "MODERN_INC_APPROVAL_STATE_CONFLICT",
      "The submission was reviewed concurrently.",
    );
  const [audit] = await connection.execute(
    `INSERT INTO gradebook_modern_inc_submission_events
      (submission_id,event_type,previous_status,new_status,submission_version_after,performed_by_user_id,event_reason,snapshot_json)
     VALUES (?,'APPROVED','SUBMITTED','APPROVED',2,?,?,?)`,
    [submissionId, actor.userId, remarks, JSON.stringify(saved)],
  );
  if (Number(audit.affectedRows) !== 1)
    throw new Error("Modern INC review audit insert failed.");
  return {
    success: true,
    dry_run: body.dry_run,
    persisted: !body.dry_run,
    action: "APPROVE",
    submission_context: saved.submission_context,
    publication_source: saved.publication_source,
    offering_id: ids.offeringId,
    config_id: configId,
    enrollment_subject_id: ids.enrollmentSubjectId,
    source: saved.source,
    submission_id: submissionId,
    claim_id: String(claim.claim_id),
    original_inc_grade_id: Number(grade.grade_id),
    submission_status: "APPROVED",
    record_version: 2,
    reviewed_by_user_id: actor.userId,
    proposed_semester: preview.semester,
    audit_event: "APPROVED",
    audit_event_id: body.dry_run ? null : String(audit.insertId),
    official_grade_unchanged: true,
    original_snapshot_unchanged: true,
    grade_conversion_performed: false,
    registrar_conversion_enabled: false,
  };
}
// Registrar conversion of an approved modern INC replacement (QA pilot).
export async function processModernIncConversion(
  connection,
  registrarId,
  submissionId,
  body,
  calculateGradePreview,
) {
  const fields = [
    "expected_record_version",
    "expected_claim_id",
    "expected_claim_version",
    "expected_sheet_version",
    "expected_grade_id",
    "registrar_remarks",
    "confirm_conversion",
    "dry_run",
  ];
  const remarks =
    typeof body?.registrar_remarks === "string"
      ? body.registrar_remarks.trim()
      : "";
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== fields.length ||
    Object.keys(body).some((k) => !fields.includes(k)) ||
    body.expected_record_version !== 2 ||
    !Number.isSafeInteger(body.expected_claim_version) ||
    body.expected_claim_version < 1 ||
    body.expected_claim_version > 4294967295 ||
    !Number.isSafeInteger(body.expected_sheet_version) ||
    body.expected_sheet_version < 1 ||
    body.expected_sheet_version > 4294967295 ||
    !Number.isSafeInteger(body.expected_grade_id) ||
    body.expected_grade_id < 1 ||
    typeof body.expected_claim_id !== "string" ||
    !/^[1-9]\d{0,19}$/.test(body.expected_claim_id) ||
    BigInt(body.expected_claim_id) > 18446744073709551615n ||
    remarks.length < 20 ||
    remarks.length > 1000 ||
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(remarks) ||
    body.confirm_conversion !== true ||
    typeof body.dry_run !== "boolean"
  ) {
    sourceFail(
      "MODERN_INC_CONVERSION_BODY_INVALID",
      "Supply the approved submission, claim and sheet versions, grade ID, remarks, confirmation and dry_run.",
      400,
    );
  }
  // Require a valid authenticated Registrar account.
  if (!validUserId(registrarId)) {
    sourceFail(
      "MODERN_INC_CONVERSION_FORBIDDEN",
      "A valid authenticated Registrar account is required.",
      403,
    );
  }

  // Require rollout approval for committed INC conversions.
  const conversionRolloutEnabled =
    process.env.GRADEBOOK_MODERN_INC_CONVERSION_WRITES_ENABLED === "true" &&
    process.env.GRADEBOOK_MODERN_INC_SOURCE_WRITE_SCOPE_ENABLED === "true";

  if (body.dry_run !== true && !conversionRolloutEnabled) {
    sourceFail(
      "MODERN_INC_CONVERSION_WRITES_DISABLED",
      "Registrar INC conversion is not enabled on this server.",
      403,
    );
  }

  // Keep QA-only dry-runs until the full conversion rollout is enabled.
  if (!conversionRolloutEnabled) {
    await assertQaGradingDatabase(connection);
  }

  // Resolve the original source from the requested replacement submission.
  // The source reader and later locked submission checks remain authoritative.
  const [submissionSources] = await connection.execute(
    `SELECT ms.grade_id,
          es.enrollment_subject_id,
          es.offering_id,
          f.user_id AS instructor_user_id
     FROM gradebook_modern_inc_submissions ms
     JOIN grades g
       ON g.grade_id = ms.grade_id
     JOIN enrollment_subjects es
       ON es.enrollment_subject_id = g.enrollment_subject_id
     JOIN subject_offerings so
       ON so.offering_id = es.offering_id
     JOIN faculty f
       ON f.faculty_id = so.faculty_id
    WHERE ms.submission_id = ?`,
    [submissionId],
  );

  if (submissionSources.length !== 1) {
    sourceFail(
      "MODERN_INC_CONVERSION_NOT_FOUND",
      "The approved replacement submission was not found.",
      404,
    );
  }

  const selected = submissionSources[0];

  const ids = {
    offeringId: Number(selected.offering_id),
    enrollmentSubjectId: Number(selected.enrollment_subject_id),
    actorUserId: Number(selected.instructor_user_id),
  };

  // Preserve the existing default QA pilot restriction.
  const source = await readModernIncSource(connection, ids, { lock: true });

  const { grade, sheet, attempt, original, configId } = source;

  if (!sameId(selected.grade_id, grade.grade_id)) {
    sourceFail(
      "MODERN_INC_CONVERSION_SOURCE_MISMATCH",
      "The replacement submission no longer matches its original INC grade.",
    );
  }
  const [registrars] = await connection.execute(
    `SELECT u.user_id FROM users u JOIN roles r ON r.role_id = u.role_id
      WHERE u.user_id = ? AND u.is_active = 1 AND u.is_archived = 0 AND r.role_name = 'Registrar' FOR UPDATE`,
    [registrarId],
  );
  if (registrars.length !== 1)
    sourceFail(
      "MODERN_INC_CONVERSION_FORBIDDEN",
      "An active Registrar is required.",
      403,
    );
  if (
    !sameId(grade.grade_id, body.expected_grade_id) ||
    !sameId(sheet.record_version, body.expected_sheet_version)
  )
    sourceFail(
      "MODERN_INC_CONVERSION_STALE",
      "The protected grade or sheet changed.",
    );
  const [claims] = await connection.execute(
    `SELECT claim_id, record_version, verification_status, grade_change_request_id FROM gradebook_inc_completion_claims WHERE grade_id = ? FOR UPDATE`,
    [grade.grade_id],
  );
  const claim = claims[0];
  if (
    claims.length !== 1 ||
    claim.verification_status !== "VERIFIED_TIMELY" ||
    claim.grade_change_request_id !== null ||
    !sameId(claim.claim_id, body.expected_claim_id) ||
    !sameId(claim.record_version, body.expected_claim_version)
  )
    sourceFail(
      "MODERN_INC_CONVERSION_CLAIM_INVALID",
      "The verified completion claim changed.",
    );
  const [submissions] = await connection.execute(
    `SELECT * FROM gradebook_modern_inc_submissions WHERE grade_id = ? OR claim_id = ? FOR UPDATE`,
    [grade.grade_id, claim.claim_id],
  );
  const submitted = submissions[0];
  if (
    submissions.length !== 1 ||
    !sameId(submitted.submission_id, submissionId)
  )
    sourceFail(
      "MODERN_INC_CONVERSION_NOT_FOUND",
      "The authorized replacement submission was not found.",
      404,
    );
  if (
    submitted.submission_status !== "APPROVED" ||
    !sameId(submitted.record_version, body.expected_record_version) ||
    !sameId(submitted.claim_id, claim.claim_id) ||
    !sameId(submitted.claim_version, claim.record_version) ||
    !sameId(submitted.grade_id, grade.grade_id) ||
    !sameId(submitted.sheet_id, sheet.sheet_id) ||
    !sameId(submitted.combined_submission_id, attempt.submission_id) ||
    !sameId(submitted.roster_snapshot_id, original.roster_snapshot_id) ||
    !sameId(submitted.submitted_by_user_id, ids.actorUserId) ||
    !submitted.submitted_at ||
    !validUserId(submitted.reviewed_by_user_id) ||
    !submitted.reviewed_at ||
    !textPresent(submitted.review_remarks, 20) ||
    !textPresent(submitted.submission_reason, 10)
  )
    sourceFail(
      "MODERN_INC_CONVERSION_APPROVAL_INVALID",
      "The replacement approval or its source links are invalid.",
    );
  const [events] = await connection.execute(
    `SELECT * FROM gradebook_modern_inc_submission_events WHERE submission_id = ? ORDER BY submission_version_after, event_id FOR UPDATE`,
    [submissionId],
  );
  const saved = jsonObject(submitted.calculation_snapshot_json);
  const canonical = (value) =>
    JSON.stringify(value, (_key, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, v[k]]),
          )
        : v,
    );
  const [created, approved] = events;
  if (
    !saved ||
    events.length !== 2 ||
    created.event_type !== "SUBMITTED" ||
    created.previous_status !== null ||
    created.new_status !== "SUBMITTED" ||
    Number(created.submission_version_after) !== 1 ||
    !sameId(created.performed_by_user_id, submitted.submitted_by_user_id) ||
    created.event_reason !== submitted.submission_reason ||
    approved.event_type !== "APPROVED" ||
    approved.previous_status !== "SUBMITTED" ||
    approved.new_status !== "APPROVED" ||
    Number(approved.submission_version_after) !== 2 ||
    !sameId(approved.performed_by_user_id, submitted.reviewed_by_user_id) ||
    approved.event_reason !== submitted.review_remarks ||
    events.some(
      (e) => canonical(jsonObject(e.snapshot_json)) !== canonical(saved),
    )
  )
    sourceFail(
      "MODERN_INC_CONVERSION_AUDIT_INVALID",
      "The submission and approval events do not match the immutable calculation.",
    );
  // Check the recorded approval actor's department assignment.
  const [reviewerAssignments] = await connection.execute(
    `SELECT ph.program_head_id
     FROM program_heads ph

     JOIN faculty reviewer
       ON reviewer.faculty_id = ph.faculty_id

     JOIN subject_offerings so
       ON so.offering_id = ?

     JOIN sections sec
       ON sec.section_id = so.section_id

     JOIN courses cr
       ON cr.course_id = sec.course_id

    WHERE reviewer.user_id = ?
      AND ph.department_id = cr.department_id

      AND (
        ph.start_date IS NULL
        OR ph.start_date <= DATE(?)
      )

      AND (
        ph.end_date IS NULL
        OR ph.end_date >= DATE(?)
      )

    LIMIT 1 FOR UPDATE`,
    [
      ids.offeringId,
      submitted.reviewed_by_user_id,
      approved.event_at,
      approved.event_at,
    ],
  );

  if (reviewerAssignments.length !== 1) {
    sourceFail(
      "MODERN_INC_CONVERSION_REVIEWER_SCOPE_INVALID",
      "The recorded approval actor has no matching Program Head assignment for the offering and approval date.",
    );
  }
  // Read under the same source locks as the score and submission writers.
  const preview = await previewModernIncCompletion(
    connection,
    ids,
    calculateGradePreview,
  );
  const current = {
    submission_context: "MODERN_INC_COMPLETION_FINAL_TERM",
    publication_source: "COMBINED_SEMESTER",
    offering_id: ids.offeringId,
    config_id: configId,
    enrollment_subject_id: ids.enrollmentSubjectId,
    student_id: Number(source.student.student_id),
    original_inc_grade_id: Number(grade.grade_id),
    source: preview.source,
    official_sheet: preview.official_sheet,
    verified_claim: preview.verified_claim,

    ...modernIncCompletionSnapshotFields(saved, preview, {
      allowMultiple: true,
    }),
    protected_official_grade: preview.protected_official_grade,
    midterm_approval: preview.midterm_approval,
    grading_policy: preview.grading_policy,
    grading_classification: preview.grading_classification,
    term_weights: preview.term_weights,
    terms: preview.terms,
    semester: preview.semester,
    submission_reason: submitted.submission_reason,
  };
  if (
    preview.semester.state !== "READY" ||
    preview.terms.FINAL_TERM.state !== "READY" ||
    preview.midterm_approval.matched_approved_snapshot !== true ||
    canonical(saved) !== canonical(current)
  ) {
    sourceFail(
      "MODERN_INC_CONVERSION_CALCULATION_CHANGED",
      "The current validated calculation or evidence differs from the submitted snapshot.",
    );
  }

  // Serialize revisions using the already locked official sheet.
  const [amendments] = await connection.execute(
    `SELECT amendment_id, sheet_id, sheet_revision_number, roster_snapshot_id, modern_inc_submission_id
       FROM gradebook_sheet_amendments WHERE sheet_id = ? OR modern_inc_submission_id = ? FOR UPDATE`,
    [sheet.sheet_id, submissionId],
  );
  if (
    amendments.some(
      (a) =>
        sameId(a.roster_snapshot_id, original.roster_snapshot_id) ||
        sameId(a.modern_inc_submission_id, submissionId),
    )
  )
    sourceFail(
      "MODERN_INC_CONVERSION_ALREADY_AMENDED",
      "This approved replacement or original roster row already has an amendment.",
    );
  // Do not append an amendment to a broken official-sheet revision chain.
  const sheetRevisions = amendments
    .filter((a) => sameId(a.sheet_id, sheet.sheet_id))
    .map((a) => Number(a.sheet_revision_number))
    .sort((a, b) => a - b);

  if (
    sheetRevisions.some(
      (revision, index) =>
        !Number.isSafeInteger(revision) || revision !== index + 1,
    )
  ) {
    sourceFail(
      "MODERN_INC_CONVERSION_REVISION_INVALID",
      "The official sheet amendment history has missing or invalid revisions.",
    );
  }

  const nextRevision = sheetRevisions.length + 1;

  if (!Number.isSafeInteger(nextRevision) || nextRevision > 4294967295)
    sourceFail(
      "MODERN_INC_CONVERSION_REVISION_INVALID",
      "The sheet revision is invalid.",
    );
  // Exact ratios remain authoritative; the shared calculator supplies twelve-decimal storage values.
  const mid = preview.terms.MIDTERM.term_percentage;
  const fin = preview.terms.FINAL_TERM.term_percentage;
  const overall = preview.semester.semester_percentage;
  const proposed = {
    grade_id: Number(grade.grade_id),
    grade_status: "Approved",
    grading_policy: "TWO_TERM_50_50",
    grading_outcome: "NUMERIC",
    midterm_grade: mid.decimal_preview,
    final_grade: fin.decimal_preview,
    overall_percentage: overall.decimal_preview,
    final_rating: preview.semester.numeric_equivalent,
    remarks: preview.semester.pass_fail === "PASS" ? "Passed" : "Failed",
    outcome_reason: null,
  };
  if (
    !["PASS", "FAIL"].includes(preview.semester.pass_fail) ||
    decimalUnits(proposed.midterm_grade) !==
      decimalUnits(grade.midterm_grade) ||
    [
      proposed.midterm_grade,
      proposed.final_grade,
      proposed.overall_percentage,
    ].some(
      (v) => decimalUnits(v) === null || decimalUnits(v) > 100000000000000n,
    )
  )
    sourceFail(
      "MODERN_INC_CONVERSION_NUMERIC_INVALID",
      "The replacement must preserve the original Midterm and contain valid numeric results.",
    );
  const previous = {
    grade_id: Number(grade.grade_id),
    grade_status: grade.grade_status,
    grading_policy: grade.grading_policy,
    grading_outcome: grade.grading_outcome,
    midterm_grade: grade.midterm_grade,
    final_grade: grade.final_grade,
    overall_percentage: grade.overall_percentage,
    final_rating: grade.final_rating,
    remarks: grade.remarks,
    outcome_reason: grade.outcome_reason,
    enrollment_subject_status: "Incomplete",
  };
  const newSubjectStatus =
    proposed.remarks === "Passed" ? "Completed" : "Failed";
  const next = {
    ...proposed,
    enrollment_subject_status: newSubjectStatus,
    publication_source: "COMBINED_SEMESTER",
    source: saved.source,
    modern_inc_submission_id: submissionId,
    modern_inc_submission_version: 2,
    approval_event_id: String(approved.event_id),
    claim_id: String(claim.claim_id),
    claim_version: Number(claim.record_version),
    official_sheet_id: String(sheet.sheet_id),

    // Conversion audit references
    amendment_type: "INC_COMPLETION",
    gradebook_config_id: Number(configId),
    official_publication_id: String(source.publication.publication_id),
    roster_snapshot_id: String(original.roster_snapshot_id),
    sheet_revision_number: nextRevision,
    authorized_by_user_id: Number(submitted.reviewed_by_user_id),
    applied_by_user_id: Number(registrarId),
    registrar_remarks: remarks,

    midterm_exact_numerator: mid.exact_numerator,
    midterm_exact_denominator: mid.exact_denominator,
    final_term_exact_numerator: fin.exact_numerator,
    final_term_exact_denominator: fin.exact_denominator,
    overall_exact_numerator: overall.exact_numerator,
    overall_exact_denominator: overall.exact_denominator,
    ...(saved.snapshot_schema_version === 2
      ? {
          snapshot_schema_version: 2,
          completion_scores: saved.completion_scores,
        }
      : {}),

    completion_score: saved.completion_score,
    progression_review_required: true,
  };

  // All grade conversion writes and source locks must be transactional.
  const transactionTables = [
    "grades",
    "enrollment_subjects",
    "gradebook_official_sheets",
    "gradebook_finalized_roster",
    "gradebook_official_grade_publications",
    "gradebook_inc_completion_claims",
    "gradebook_modern_inc_submissions",
    "gradebook_sheet_amendments",
    "audit_trail",
    "audit_logs",
  ];

  const [engineRows] = await connection.execute(
    `SELECT TABLE_NAME AS table_name, ENGINE AS engine
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${transactionTables.map(() => "?").join(", ")})`,
    transactionTables,
  );

  const engineByTable = new Map(
    engineRows.map((row) => [
      row.table_name,
      String(row.engine ?? "").toUpperCase(),
    ]),
  );

  if (
    transactionTables.some((table) => engineByTable.get(table) !== "INNODB")
  ) {
    sourceFail(
      "MODERN_INC_CONVERSION_STORAGE_UNSAFE",
      "Conversion requires transactional grading, official-sheet, and audit tables.",
    );
  }

  // Update only the approved INC row via the existing guarded conversion mechanism.
  await connection.execute("SET @allow_approved_inc_grade_change = 1");
  let changed;
  try {
    [changed] = await connection.execute(
      `UPDATE grades SET final_grade = ?, overall_percentage = ?, final_rating = ?, remarks = ?,
          grading_outcome = 'NUMERIC', outcome_reason = NULL
        WHERE grade_id = ?
          AND enrollment_subject_id = ?
          AND grade_status = 'Approved'
          AND grading_policy = 'TWO_TERM_50_50'
          AND grading_outcome = 'INCOMPLETE'
          AND remarks = 'Incomplete'
          AND final_rating = 4.00
          AND final_grade IS NULL
          AND overall_percentage IS NULL
          AND EXISTS (
            SELECT 1
              FROM gradebook_official_grade_publications pub
             WHERE pub.publication_id = ?
               AND pub.grade_id = grades.grade_id
               AND pub.enrollment_subject_id = grades.enrollment_subject_id
               AND pub.config_id = ?
               AND pub.publication_source = 'COMBINED_SEMESTER'
               AND pub.grading_outcome_snapshot = 'INCOMPLETE'
               AND pub.combined_submission_id = ?
          )`,
      [
        proposed.final_grade,
        proposed.overall_percentage,
        proposed.final_rating,
        proposed.remarks,
        grade.grade_id,
        ids.enrollmentSubjectId,
        source.publication.publication_id,
        configId,
        attempt.submission_id,
      ],
    );
  } finally {
    await connection.execute("SET @allow_approved_inc_grade_change = NULL");
  }
  if (Number(changed.affectedRows) !== 1)
    sourceFail(
      "MODERN_INC_CONVERSION_GRADE_CONFLICT",
      "The official INC changed during processing.",
    );
  const [actualRows] = await connection.execute(
    `SELECT g.grade_status,g.grading_policy,g.grading_outcome,g.midterm_grade,g.final_grade,g.overall_percentage,g.final_rating,g.remarks,g.outcome_reason,es.status AS subject_status
       FROM grades g JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id WHERE g.grade_id = ?`,
    [grade.grade_id],
  );
  const actual = actualRows[0];
  if (
    actualRows.length !== 1 ||
    actual.grade_status !== "Approved" ||
    actual.grading_policy !== proposed.grading_policy ||
    actual.grading_outcome !== "NUMERIC" ||
    actual.outcome_reason !== null ||
    actual.remarks !== proposed.remarks ||
    actual.subject_status !== newSubjectStatus ||
    ["midterm_grade", "final_grade", "overall_percentage"].some(
      (k) => decimalUnits(actual[k]) !== decimalUnits(proposed[k]),
    ) ||
    Number(actual.final_rating) !== Number(proposed.final_rating)
  )
    sourceFail(
      "MODERN_INC_CONVERSION_TRIGGER_MISMATCH",
      "The stored grade or enrollment-subject status differs from the approved calculation.",
    );
  const [originalRows] = await connection.execute(
    `SELECT * FROM gradebook_finalized_roster WHERE roster_snapshot_id = ?`,
    [original.roster_snapshot_id],
  );
  const [sheetRows] = await connection.execute(
    `SELECT sheet_status,record_version,DATE_FORMAT(original_official_submitted_on,'%Y-%m-%d') AS original_date FROM gradebook_official_sheets WHERE sheet_id = ?`,
    [sheet.sheet_id],
  );
  if (
    originalRows.length !== 1 ||
    canonical(originalRows[0]) !== canonical(original) ||
    sheetRows.length !== 1 ||
    sheetRows[0].sheet_status !== "FINALIZED" ||
    !sameId(sheetRows[0].record_version, sheet.record_version) ||
    sheetRows[0].original_date !== sheet.original_date
  )
    sourceFail(
      "MODERN_INC_CONVERSION_HISTORY_CHANGED",
      "The original sheet or finalized roster was modified.",
    );
  const [amendment] = await connection.execute(
    `INSERT INTO gradebook_sheet_amendments
      (sheet_id,sheet_revision_number,amendment_type,grade_change_request_id,modern_inc_submission_id,roster_snapshot_id,
       amendment_reason,previous_values_summary,new_values_summary,progression_review_required,requested_by_user_id,
       authorized_by_user_id,authorized_at,verified_by_user_id,verified_at,applied_by_user_id,applied_at)
     VALUES (?,?,'INC_COMPLETION',NULL,?,?,?,?,?,1,?,?,?, ?,NOW(),?,NOW())`,
    [
      sheet.sheet_id,
      nextRevision,
      submissionId,
      original.roster_snapshot_id,
      remarks,
      JSON.stringify(previous),
      JSON.stringify(next),
      submitted.submitted_by_user_id,
      submitted.reviewed_by_user_id,
      submitted.reviewed_at,
      registrarId,
      registrarId,
    ],
  );
  if (Number(amendment.affectedRows) !== 1)
    throw new Error("Modern INC amendment insert failed.");
  // Confirm the amendment belongs to the original official grade.
  const [amendmentLinks] = await connection.execute(
    `SELECT am.amendment_id
       FROM gradebook_sheet_amendments am
       JOIN gradebook_finalized_roster fr
         ON fr.roster_snapshot_id = am.roster_snapshot_id
        AND fr.sheet_id = am.sheet_id
       JOIN gradebook_modern_inc_submissions ms
         ON ms.submission_id = am.modern_inc_submission_id
        AND ms.sheet_id = am.sheet_id
        AND ms.roster_snapshot_id = fr.roster_snapshot_id
        AND ms.grade_id = fr.grade_id
       JOIN grades g
         ON g.grade_id = ms.grade_id
        AND g.enrollment_subject_id = fr.enrollment_subject_id
       JOIN gradebook_official_grade_publications pub
         ON pub.grade_id = g.grade_id
        AND pub.enrollment_subject_id = g.enrollment_subject_id
        AND pub.publication_source = 'COMBINED_SEMESTER'
        AND pub.grading_outcome_snapshot = 'INCOMPLETE'
        AND pub.combined_submission_id = ms.combined_submission_id
       JOIN gradebook_official_sheets sh
         ON sh.sheet_id = am.sheet_id
        AND sh.config_id = pub.config_id
      WHERE am.amendment_id = ?
        AND am.amendment_type = 'INC_COMPLETION'
        AND am.grade_change_request_id IS NULL
        AND am.modern_score_correction_id IS NULL
        AND am.sheet_id = ?
        AND am.roster_snapshot_id = ?
        AND ms.submission_id = ?
        AND ms.grade_id = ?
        AND ms.claim_id = ?
        AND pub.publication_id = ?`,
    [
      amendment.insertId,
      sheet.sheet_id,
      original.roster_snapshot_id,
      submissionId,
      grade.grade_id,
      claim.claim_id,
      source.publication.publication_id,
    ],
  );

  if (amendmentLinks.length !== 1) {
    sourceFail(
      "MODERN_INC_CONVERSION_AMENDMENT_SOURCE_INVALID",
      "The amendment does not match its original grade, sheet, roster, claim, and publication.",
    );
  }
  const auditResult = {
    ...next,
    original_official_grade: previous,
    amendment_id: String(amendment.insertId),
  };
  const [trail] = await connection.execute(
    `INSERT INTO audit_trail (user_id,table_name,record_id,action,old_values,new_values,created_at)
     VALUES (?,'grades',?,'UPDATE',?,?,NOW())`,
    [
      registrarId,
      grade.grade_id,
      JSON.stringify(previous),
      JSON.stringify(auditResult),
    ],
  );
  const [log] = await connection.execute(
    `INSERT INTO audit_logs (user_id,action,table_name,record_id,description,created_at)
     VALUES (?,'INC COMPLETION PROCESSED','grades',?,?,NOW())`,
    [registrarId, grade.grade_id, JSON.stringify(auditResult)],
  );
  if (Number(trail.affectedRows) !== 1 || Number(log.affectedRows) !== 1)
    throw new Error("Modern INC conversion audit insert failed.");
  return {
    success: true,
    dry_run: body.dry_run,
    persisted: !body.dry_run,
    submission_id: submissionId,
    claim_id: String(claim.claim_id),
    grade_id: Number(grade.grade_id),
    sheet_id: String(sheet.sheet_id),
    roster_snapshot_id: String(original.roster_snapshot_id),
    amendment_id: body.dry_run ? null : String(amendment.insertId),
    sheet_revision_number: nextRevision,
    previous_official_grade: previous,
    proposed_official_grade: proposed,
    enrollment_subject_status_after_conversion: newSubjectStatus,
    original_snapshot_unchanged: true,
    official_sheet_unchanged: true,
    progression_review_required: true,
    conversion_validated: true,
    grade_conversion_performed: !body.dry_run,
    official_grade_unchanged: body.dry_run,
  };
}
