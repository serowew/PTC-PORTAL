import { assertSpecialOutcomeReturnWriteAllowed } from "./gradebookSpecialReturnWriteGuard.service.js";
function reject(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

const same = (a, b) => a != null && b != null && String(a) === String(b);
const validId = (id) => Number.isSafeInteger(Number(id)) && Number(id) > 0;
const parsed = (raw) => {
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
};

export async function returnSpecialOutcomeSubmission(connection, input) {
  const {
    submissionId,
    expectedGradeId,
    expectedVersion,
    scope,
    reviewRemarks,
    evidenceNotes,
    actorUserId,
    actorDepartmentId,
    dryRun,
  } = input;
  await assertSpecialOutcomeReturnWriteAllowed(connection);
  if (typeof dryRun !== "boolean") {
    reject(
      "SPECIAL_RETURN_DRY_RUN_REQUIRED",
      "An explicit dryRun value of true or false is required.",
      400,
    );
  }
  // Identify the offering first; subsequent locks follow offering -> config ->
  // enrollment -> grade -> sheet -> submission -> evidence -> review.
  const [targets] = await connection.execute(
    `SELECT a.submission_id, a.grade_id, a.sheet_id, a.period_id,
            g.enrollment_subject_id, es.offering_id, sh.config_id
       FROM gradebook_grade_submission_attempts a
       JOIN grades g ON g.grade_id = a.grade_id
       JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
       JOIN gradebook_official_sheets sh ON sh.sheet_id = a.sheet_id
      WHERE a.submission_id = ?`,
    [submissionId],
  );
  if (targets.length !== 1) {
    reject(
      "SPECIAL_RETURN_SUBMISSION_NOT_FOUND",
      "Combined submission was not found.",
      404,
    );
  }
  const target = targets[0];
  if (!same(target.grade_id, expectedGradeId)) {
    reject(
      "SPECIAL_RETURN_GRADE_MISMATCH",
      "Requested grade does not match the submission.",
    );
  }

  const [offerings] = await connection.execute(
    `SELECT so.offering_id, so.status AS offering_status,
            so.faculty_id, so.academic_year_id, so.semester_id,
            cr.department_id, f.user_id AS instructor_user_id
       FROM subject_offerings so
       JOIN sections sec ON sec.section_id = so.section_id
       JOIN courses cr ON cr.course_id = sec.course_id
       JOIN faculty f ON f.faculty_id = so.faculty_id
      WHERE so.offering_id = ? FOR UPDATE`,
    [target.offering_id],
  );
  const offering = offerings[0];
  if (
    offerings.length !== 1 ||
    !same(offering.department_id, actorDepartmentId) ||
    offering.offering_status === "Cancelled"
  ) {
    reject(
      "SPECIAL_RETURN_DEPARTMENT_FORBIDDEN",
      "Offering is unavailable or outside the Program Head's department.",
      403,
    );
  }

  const [configs] = await connection.execute(
    `SELECT config_id, midterm_percent, final_term_percent
       FROM gradebook_offering_config
      WHERE config_id = ? AND offering_id = ? FOR UPDATE`,
    [target.config_id, target.offering_id],
  );
  if (
    configs.length !== 1 ||
    Number(configs[0].midterm_percent) !== 50 ||
    Number(configs[0].final_term_percent) !== 50
  ) {
    reject(
      "SPECIAL_RETURN_CONFIG_CHANGED",
      "The official 50/50 configuration is invalid.",
    );
  }

  const [subjects] = await connection.execute(
    `SELECT es.enrollment_subject_id, es.offering_id, es.status AS subject_status,
            e.enrollment_status
       FROM enrollment_subjects es
       JOIN enrollments e ON e.enrollment_id = es.enrollment_id
      WHERE es.enrollment_subject_id = ? FOR UPDATE`,
    [target.enrollment_subject_id],
  );
  if (
    subjects.length !== 1 ||
    !same(subjects[0].offering_id, target.offering_id)
  ) {
    reject(
      "SPECIAL_RETURN_ENROLLMENT_SOURCE_INVALID",
      "Enrollment subject and offering do not match.",
    );
  }

  const [periods] = await connection.execute(
    `SELECT period_id, department_id, academic_year_id, semester_id
       FROM gradebook_submission_periods WHERE period_id = ? FOR UPDATE`,
    [target.period_id],
  );
  if (
    periods.length !== 1 ||
    !same(periods[0].department_id, actorDepartmentId) ||
    !same(periods[0].academic_year_id, offering.academic_year_id) ||
    !same(periods[0].semester_id, offering.semester_id)
  ) {
    reject(
      "SPECIAL_RETURN_PERIOD_CHANGED",
      "Submission period no longer matches the offering.",
    );
  }

  const [grades] = await connection.execute(
    `SELECT grade_id, enrollment_subject_id, faculty_id, grade_status,
            grading_policy, grading_outcome, outcome_reason, final_rating,
            remarks, midterm_grade, final_grade, overall_percentage
       FROM grades WHERE grade_id = ? FOR UPDATE`,
    [target.grade_id],
  );
  const grade = grades[0];
  if (
    grades.length !== 1 ||
    !same(grade.enrollment_subject_id, target.enrollment_subject_id)
  ) {
    reject(
      "SPECIAL_RETURN_GRADE_SOURCE_INVALID",
      "The grade and enrollment source differ.",
    );
  }

  const [sheets] = await connection.execute(
    `SELECT sheet_id, config_id, sheet_status,
            original_official_submitted_on, official_date_verified_at
       FROM gradebook_official_sheets WHERE sheet_id = ? FOR UPDATE`,
    [target.sheet_id],
  );
  const sheet = sheets[0];
  if (sheets.length !== 1 || !same(sheet.config_id, target.config_id)) {
    reject(
      "SPECIAL_RETURN_SHEET_SOURCE_INVALID",
      "The official sheet does not match the gradebook.",
    );
  }

  // Critical: do not return an approved or finalized grade under any circumstances.
  if (
    sheet.sheet_status !== "IN_PROGRESS" ||
    sheet.original_official_submitted_on != null ||
    sheet.official_date_verified_at != null ||
    grade.grade_status === "Approved"
  ) {
    reject(
      "SPECIAL_RETURN_FINALIZED_GRADE_PROTECTED",
      "Approved or finalized special outcomes cannot be returned; an audited amendment is required.",
    );
  }

  if (
    grade.grade_status !== "Submitted" ||
    grade.grading_policy !== "TWO_TERM_50_50" ||
    !["INCOMPLETE", "UNOFFICIAL_DROP"].includes(grade.grading_outcome) ||
    !same(grade.faculty_id, offering.faculty_id) ||
    subjects[0].enrollment_status !== "Approved" ||
    subjects[0].subject_status !== "Enrolled"
  ) {
    reject(
      "SPECIAL_RETURN_NOT_SUBMITTED",
      "Only a currently submitted, unapproved INC or UD may be returned.",
    );
  }

  const [publications] = await connection.execute(
    `SELECT publication_id FROM gradebook_official_grade_publications
      WHERE grade_id = ? FOR UPDATE`,
    [target.grade_id],
  );
  if (publications.length !== 0) {
    reject(
      "SPECIAL_RETURN_PUBLISHED_GRADE_PROTECTED",
      "A published grade requires an official amendment.",
    );
  }

  const [termHistory] = await connection.execute(
    `SELECT term_submission_id FROM gradebook_term_submission_attempts
      WHERE config_id = ? LIMIT 1`,
    [target.config_id],
  );
  if (termHistory.length)
    reject(
      "SPECIAL_RETURN_LEGACY_HISTORY",
      "Legacy term history requires reconciliation.",
    );

  const [locks] = await connection.execute(
    `SELECT first_submission_id FROM gradebook_structure_locks
      WHERE config_id = ? FOR UPDATE`,
    [target.config_id],
  );
  if (locks.length !== 1 || !validId(locks[0].first_submission_id)) {
    reject(
      "SPECIAL_RETURN_STRUCTURE_NOT_LOCKED",
      "The combined-semester structure lock is invalid.",
    );
  }

  const [attempts] = await connection.execute(
    `SELECT * FROM gradebook_grade_submission_attempts
      WHERE grade_id = ? ORDER BY attempt_number DESC, submission_id DESC
      LIMIT 1 FOR UPDATE`,
    [target.grade_id],
  );
  const attempt = attempts[0];
  if (
    attempts.length !== 1 ||
    !same(attempt.submission_id, submissionId) ||
    !same(attempt.sheet_id, sheet.sheet_id) ||
    Number(attempt.record_version) !== expectedVersion ||
    attempt.submission_status !== "SUBMITTED" ||
    attempt.grading_scope !== "FULL_SEMESTER" ||
    attempt.returned_edit_scope != null ||
    attempt.reviewed_by_user_id != null ||
    attempt.reviewed_at != null ||
    attempt.grading_outcome_snapshot !== grade.grading_outcome ||
    !validId(attempt.special_outcome_id)
  ) {
    reject(
      "SPECIAL_RETURN_SUBMISSION_STALE",
      "This is not an unchanged pending special-outcome submission.",
    );
  }
  const expectedRating = grade.grading_outcome === "INCOMPLETE" ? 4 : 6;
  if (
    Number(grade.final_rating) !== expectedRating ||
    Number(attempt.final_rating_snapshot) !== expectedRating ||
    (grade.grading_outcome === "INCOMPLETE"
      ? grade.remarks !== "Incomplete" ||
        (grade.midterm_grade !== null && grade.final_grade !== null) ||
        grade.overall_percentage !== null
      : grade.remarks !== "Unofficial Drop" ||
        grade.midterm_grade !== null ||
        grade.final_grade !== null ||
        grade.overall_percentage !== null)
  ) {
    reject(
      "SPECIAL_RETURN_GRADE_SNAPSHOT_CHANGED",
      "Current special grade does not match the submitted outcome.",
    );
  }

  const [outcomes] = await connection.execute(
    `SELECT * FROM gradebook_special_outcomes
      WHERE grade_id = ? FOR UPDATE`,
    [target.grade_id],
  );
  const outcome = outcomes[0];
  if (
    outcomes.length !== 1 ||
    !same(outcome.special_outcome_id, attempt.special_outcome_id) ||
    outcome.outcome_type !== attempt.grading_outcome_snapshot ||
    outcome.record_status !== "ACTIVE" ||
    !same(outcome.created_by_user_id, attempt.submitted_by_user_id) ||
    !same(grade.outcome_reason, outcome.outcome_reason) ||
    !same(attempt.special_outcome_reason_snapshot, outcome.outcome_reason) ||
    !String(outcome.evidence_summary ?? "").trim()
  ) {
    reject(
      "SPECIAL_RETURN_OUTCOME_STALE",
      "Special-outcome evidence is no longer consistent.",
    );
  }

  const [events] = await connection.execute(
    `SELECT event_type, new_record_status, new_outcome_type,
            new_outcome_reason, new_missing_requirements,
            new_evidence_summary, record_version_after
       FROM gradebook_special_outcome_events
      WHERE special_outcome_id = ? ORDER BY record_version_after, event_id FOR UPDATE`,
    [outcome.special_outcome_id],
  );
  const last = events.at(-1);
  if (
    events.length !== Number(outcome.record_version) ||
    events[0]?.event_type !== "CREATED" ||
    !events.every((row, i) => Number(row.record_version_after) === i + 1) ||
    last?.new_record_status !== "ACTIVE" ||
    last.new_outcome_type !== outcome.outcome_type ||
    last.new_outcome_reason !== outcome.outcome_reason ||
    last.new_evidence_summary !== outcome.evidence_summary ||
    (last.new_missing_requirements ?? null) !==
      (outcome.missing_requirements ?? null)
  ) {
    reject(
      "SPECIAL_RETURN_EVIDENCE_AUDIT_CHANGED",
      "Special-outcome audit history does not match the submission.",
    );
  }

  const snapshot = parsed(attempt.calculation_snapshot_json);
  if (
    !snapshot ||
    snapshot.policy !== "TWO_TERM_50_50" ||
    snapshot.grading_scope !== "FULL_SEMESTER" ||
    !same(snapshot.offering_id, offering.offering_id) ||
    !same(snapshot.config_id, target.config_id) ||
    !same(snapshot.enrollment_subject_id, target.enrollment_subject_id) ||
    !same(snapshot.grade_id, grade.grade_id) ||
    snapshot.grading_outcome !== attempt.grading_outcome_snapshot ||
    !same(snapshot.special_outcome_id, outcome.special_outcome_id) ||
    snapshot.special_outcome?.outcome_reason !== outcome.outcome_reason ||
    snapshot.special_outcome?.evidence_summary !== outcome.evidence_summary ||
    (snapshot.special_outcome?.missing_requirements ?? null) !==
      (outcome.missing_requirements ?? null)
  ) {
    reject(
      "SPECIAL_RETURN_SNAPSHOT_INVALID",
      "Submitted special-outcome snapshot or evidence changed.",
    );
  }

  // Preserve both grading term snapshots.
  const inc = grade.grading_outcome === "INCOMPLETE";
  const result = snapshot.official_result;
  const pending = snapshot.special_outcome?.pending_assessments;

  const validTermCodes = ["MIDTERM", "FINAL_TERM"];

  const validDecimal = (value) =>
    value != null &&
    /^\d+(?:\.\d{1,12})?$/.test(String(value)) &&
    Number(value) >= 0 &&
    Number(value) <= 100;

  if (
    !result ||
    Number(result.final_rating) !== expectedRating ||
    result.overall_percentage !== null ||
    attempt.overall_percentage_snapshot !== null ||
    attempt.overall_exact_numerator !== null ||
    attempt.overall_exact_denominator !== null ||
    (inc &&
      (!Array.isArray(pending) ||
        pending.length === 0 ||
        pending.some((a) => !validTermCodes.includes(a?.grading_term))))
  ) {
    reject(
      "SPECIAL_RETURN_GRADE_SNAPSHOT_CHANGED",
      "The saved special-outcome calculation is inconsistent.",
    );
  }

  for (const term of validTermCodes) {
    const prefix = term === "MIDTERM" ? "midterm" : "final_term";

    const gradeKey = term === "MIDTERM" ? "midterm_grade" : "final_grade";

    const calculation = snapshot.calculated_terms?.[term];

    const numerator = attempt[`${prefix}_exact_numerator`];
    const denominator = attempt[`${prefix}_exact_denominator`];

    const values = [
      grade[gradeKey],
      attempt[`${prefix}_percentage_snapshot`],
      result[gradeKey],
    ];

    const invalid = () =>
      reject(
        "SPECIAL_RETURN_GRADE_SNAPSHOT_CHANGED",
        `The protected ${term} calculation is inconsistent.`,
      );

    const ready = calculation?.state === "READY";

    if (inc) {
      const hasPending = pending.some((a) => a.grading_term === term);

      if (!calculation || ready === hasPending) {
        invalid();
      }
    }

    if (!inc || !ready) {
      if ([...values, numerator, denominator].some((v) => v !== null)) {
        invalid();
      }

      continue;
    }

    const n = String(numerator ?? "");
    const d = String(denominator ?? "");
    const source = calculation.term_percentage;

    if (
      !/^(0|[1-9]\d{0,254})$/.test(n) ||
      !/^[1-9]\d{0,254}$/.test(d) ||
      n !== String(source?.exact_numerator ?? "") ||
      d !== String(source?.exact_denominator ?? "")
    ) {
      invalid();
    }

    const num = BigInt(n);
    const den = BigInt(d);
    const scale = 1000000000000n;

    const rounded = (num * scale * 2n + den) / (den * 2n);

    const expected = Number(
      `${rounded / scale}.${String(rounded % scale).padStart(12, "0")}`,
    );

    if (
      num > 100n * den ||
      values.some((v) => !validDecimal(v) || Number(v) !== expected)
    ) {
      invalid();
    }
  }

  const [reviews] = await connection.execute(
    `SELECT review_id FROM gradebook_grade_submission_reviews
      WHERE submission_id = ? FOR UPDATE`,
    [submissionId],
  );
  if (reviews.length)
    reject(
      "SPECIAL_RETURN_ALREADY_REVIEWED",
      "This submission has already been reviewed.",
    );

  const [updated] = await connection.execute(
    `UPDATE gradebook_grade_submission_attempts
        SET submission_status = 'RETURNED', returned_edit_scope = ?,
            review_remarks = ?, reviewed_by_user_id = ?,
            reviewed_at = NOW(), record_version = record_version + 1
      WHERE submission_id = ? AND submission_status = 'SUBMITTED'
        AND record_version = ?`,
    [scope, reviewRemarks, actorUserId, submissionId, expectedVersion],
  );
  if (updated.affectedRows !== 1)
    reject(
      "SPECIAL_RETURN_VERSION_CONFLICT",
      "Submission changed during review.",
    );

  const [gradeUpdate] = await connection.execute(
    `UPDATE grades SET grade_status = 'Returned',
      reviewed_by = ?, review_remarks = ?
      WHERE grade_id = ? AND grade_status = 'Submitted'`,
    [actorUserId, reviewRemarks, grade.grade_id],
  );
  if (gradeUpdate.affectedRows !== 1)
    reject(
      "SPECIAL_RETURN_GRADE_CONFLICT",
      "Submitted grade changed during review.",
    );

  const [reviewInsert] = await connection.execute(
    `INSERT INTO gradebook_grade_submission_reviews
     (submission_id, review_decision, grading_outcome_snapshot,
      review_notes, returned_edit_scope, evidence_review_notes,
      is_self_approval, reviewed_by_user_id, submission_version_after)
     VALUES (?, 'RETURNED', ?, ?, ?, ?, ?, ?, ?)`,
    [
      submissionId,
      attempt.grading_outcome_snapshot,
      reviewRemarks,
      scope,
      evidenceNotes,
      Number(same(actorUserId, offering.instructor_user_id)),
      actorUserId,
      expectedVersion + 1,
    ],
  );
  if (reviewInsert.affectedRows !== 1)
    throw new Error("Special return review audit could not be recorded.");

  return {
    success: true,
    dry_run: dryRun,
    persisted: !dryRun,
    submission_id: String(submissionId),
    grade_id: Number(grade.grade_id),
    grading_outcome: grade.grading_outcome,
    submission_status: "RETURNED",
    grade_status: "Returned",
    returned_edit_scope: scope,
    record_version: expectedVersion + 1,
    review_id: dryRun ? null : String(reviewInsert.insertId),
    special_outcome_id: String(outcome.special_outcome_id),
    original_special_evidence_unchanged: true,
    official_grade_published: false,
    original_sheet_unchanged: true,
    commit_supported: true,
    next_step:
      "Faculty evidence revision and resubmission require a separate guarded implementation.",
    note: dryRun
      ? "Dry-run validation only; caller must roll back this transaction."
      : "Return committed with an auditable review record.",
  };
}
