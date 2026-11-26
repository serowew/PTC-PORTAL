// Source verification for second-or-later combined INC/UD submission attempts.
// Called inside the Program Head approval transaction; it makes no writes.

function check(condition, code, message) {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    error.status = 409;
    throw error;
  }
}

const equalId = (a, b) => a != null && b != null && String(a) === String(b);
const positiveId = (v) => Number.isSafeInteger(Number(v)) && Number(v) > 0;
const readable = (v, lo, hi) =>
  typeof v === "string" &&
  v.trim().length >= lo &&
  v.trim().length <= hi &&
  !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(v);
const parse = (raw) => {
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
};
const canonical = (v) =>
  JSON.stringify(v, (_k, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value,
  );
const sameNullable = (a, b) => (a ?? null) === (b ?? null);
const numericEqual = (a, b) =>
  a != null &&
  b != null &&
  /^\d+(?:\.\d{1,12})?$/.test(String(a)) &&
  /^\d+(?:\.\d{1,12})?$/.test(String(b)) &&
  Number(a) === Number(b);

function termExact(submission, snapshot, term) {
  const prefix = term === "MIDTERM" ? "midterm" : "final_term";

  const n = String(submission[`${prefix}_exact_numerator`] ?? "");

  const d = String(submission[`${prefix}_exact_denominator`] ?? "");

  const source = snapshot.calculated_terms?.[term]?.term_percentage;

  check(
    /^(0|[1-9]\d*)$/.test(n) &&
      /^[1-9]\d*$/.test(d) &&
      n.length <= 255 &&
      d.length <= 255 &&
      source?.exact_numerator === n &&
      source?.exact_denominator === d,
    "SPECIAL_APPROVAL_TERM_SOURCE_INVALID",
    `The submitted INC ${term} fraction is inconsistent.`,
  );

  const num = BigInt(n);
  const den = BigInt(d);

  check(
    num <= 100n * den,
    "SPECIAL_APPROVAL_TERM_SOURCE_INVALID",
    `The submitted INC ${term} percentage is outside 0–100.`,
  );

  const scale = 1000000000000n;
  const rounded = (num * scale * 2n + den) / (den * 2n);

  return Number(
    `${rounded / scale}.${String(rounded % scale).padStart(12, "0")}`,
  );
}

// expectedSubmissionVersion = 1 for approval, 2 for later publication.
export async function validateResubmittedSpecialApproval(
  connection,
  target,
  grade,
  submission,
  snapshot,
  reviewerUserId,
  expectedSubmissionVersion = 1,
  lock = true,
) {
  // Always verify that the submission matches its gradebook scope.
  check(
    [
      target?.offering_id,
      target?.config_id,
      target?.enrollment_subject_id,
      target?.grade_id,
      target?.sheet_id,
      target?.period_id,
      submission?.submission_id,
      reviewerUserId,
    ].every(positiveId) &&
      equalId(submission?.grade_id, target.grade_id) &&
      equalId(submission?.sheet_id, target.sheet_id) &&
      equalId(submission?.period_id, target.period_id) &&
      equalId(snapshot?.offering_id, target.offering_id) &&
      equalId(snapshot?.config_id, target.config_id) &&
      equalId(snapshot?.enrollment_subject_id, target.enrollment_subject_id) &&
      equalId(snapshot?.grade_id, target.grade_id),
    "SPECIAL_APPROVAL_SCOPE_INVALID",
    "The special-outcome submission does not match its gradebook scope.",
  );

  // Verify record identity independently of the pilot offering and reviewer IDs.
  check(
    [
      target.offering_id,
      target.config_id,
      target.enrollment_subject_id,
      target.grade_id,
      target.sheet_id,
      target.period_id,
      reviewerUserId,
    ].every(positiveId) &&
      equalId(grade.grade_id, target.grade_id) &&
      equalId(submission.grade_id, target.grade_id) &&
      equalId(submission.sheet_id, target.sheet_id) &&
      equalId(submission.period_id, target.period_id),
    "SPECIAL_APPROVAL_SOURCE_MISMATCH",
    "The resubmitted INC/UD grade, sheet, and submission do not match.",
  );

  // Verify the reviewer belongs to the offering's department.
  const [reviewerRows] = await connection.execute(
    `SELECT ph.program_head_id
       FROM gradebook_offering_config c
       JOIN subject_offerings so
         ON so.offering_id = c.offering_id
       JOIN sections sec
         ON sec.section_id = so.section_id
       JOIN courses cr
         ON cr.course_id = sec.course_id
       JOIN enrollment_subjects es
         ON es.offering_id = so.offering_id
       JOIN grades g
         ON g.enrollment_subject_id = es.enrollment_subject_id
       JOIN program_heads ph
         ON ph.department_id = cr.department_id
       JOIN faculty f
         ON f.faculty_id = ph.faculty_id
       JOIN users u
         ON u.user_id = f.user_id
       JOIN roles r
         ON r.role_id = u.role_id
      WHERE c.config_id = ?
        AND so.offering_id = ?
        AND es.enrollment_subject_id = ?
        AND g.grade_id = ?
        AND f.user_id = ?
        AND ph.is_active = 1
        AND (ph.start_date IS NULL OR ph.start_date <= CURDATE())
        AND (ph.end_date IS NULL OR ph.end_date >= CURDATE())
        AND u.is_active = 1
        AND u.is_archived = 0
        AND r.role_name = 'Program Head'
      LIMIT 1`,
    [
      target.config_id,
      target.offering_id,
      target.enrollment_subject_id,
      target.grade_id,
      reviewerUserId,
    ],
  );

  check(
    reviewerRows.length === 1,
    "SPECIAL_APPROVAL_REVIEWER_SCOPE_INVALID",
    "The reviewer is not an active Program Head for this offering.",
  );

  const type = grade.grading_outcome;
  const inc = type === "INCOMPLETE";
  const rating = inc ? "4.00" : "6.00";
  const attemptNumber = Number(submission.attempt_number);
  check(
    ["INCOMPLETE", "UNOFFICIAL_DROP"].includes(type) &&
      Number.isSafeInteger(attemptNumber) &&
      attemptNumber >= 2 &&
      attemptNumber < 4294967295 &&
      [1, 2].includes(expectedSubmissionVersion) &&
      Number(submission.record_version) === expectedSubmissionVersion &&
      submission.submission_status ===
        (expectedSubmissionVersion === 1 ? "SUBMITTED" : "APPROVED") &&
      positiveId(submission.special_outcome_id) &&
      submission.grading_outcome_snapshot === type &&
      submission.grading_scope === "FULL_SEMESTER" &&
      submission.returned_edit_scope == null &&
      numericEqual(grade.final_rating, rating) &&
      numericEqual(submission.final_rating_snapshot, rating) &&
      grade.remarks === (inc ? "Incomplete" : "Unofficial Drop") &&
      grade.overall_percentage == null &&
      submission.overall_percentage_snapshot == null &&
      submission.overall_exact_numerator == null &&
      submission.overall_exact_denominator == null,
    "SPECIAL_APPROVAL_SUBMISSION_INVALID",
    "The latest special-outcome attempt is inconsistent.",
  );

  const [attempts] = await connection.execute(
    `SELECT * FROM gradebook_grade_submission_attempts
         WHERE grade_id = ? ORDER BY attempt_number, submission_id ${lock ? "FOR UPDATE" : ""}`,
    [target.grade_id],
  );
  check(
    attempts.length === attemptNumber &&
      equalId(attempts.at(-1)?.submission_id, submission.submission_id),
    "SPECIAL_APPROVAL_ATTEMPT_HISTORY_INVALID",
    "The complete attempt history is missing or out of order.",
  );

  const [outcomes] = await connection.execute(
    `SELECT * FROM gradebook_special_outcomes WHERE grade_id = ? ${lock ? "FOR UPDATE" : ""}`,
    [target.grade_id],
  );
  const outcome = outcomes[0];
  check(
    outcomes.length === 1 &&
      equalId(outcome.special_outcome_id, submission.special_outcome_id) &&
      outcome.outcome_type === type &&
      outcome.record_status === "ACTIVE" &&
      Number(outcome.record_version) === attemptNumber &&
      equalId(outcome.created_by_user_id, submission.submitted_by_user_id) &&
      equalId(outcome.updated_by_user_id, submission.submitted_by_user_id),
    "SPECIAL_APPROVAL_OUTCOME_HISTORY_INVALID",
    "The special-outcome version or ownership is inconsistent.",
  );

  const [events] = await connection.execute(
    `SELECT * FROM gradebook_special_outcome_events
           WHERE special_outcome_id = ? ORDER BY record_version_after, event_id ${lock ? "FOR UPDATE" : ""}`,
    [outcome.special_outcome_id],
  );
  check(
    events.length === attemptNumber,
    "SPECIAL_APPROVAL_EVIDENCE_HISTORY_INVALID",
    "Special-outcome evidence versions are missing.",
  );

  const [reviews] = await connection.execute(
    `SELECT r.* FROM gradebook_grade_submission_reviews r
       JOIN gradebook_grade_submission_attempts a ON a.submission_id = r.submission_id
             WHERE a.grade_id = ? ORDER BY a.attempt_number ${lock ? "FOR UPDATE" : ""}`,
    [target.grade_id],
  );
  const reviewsBySubmission = new Map(
    reviews.map((r) => [String(r.submission_id), r]),
  );
  check(
    reviewsBySubmission.size ===
      attemptNumber - 1 + (expectedSubmissionVersion === 2 ? 1 : 0),
    "SPECIAL_APPROVAL_REVIEW_HISTORY_INVALID",
    "Unexpected Program Head review history.",
  );

  const snapshots = attempts.map((a) => parse(a.calculation_snapshot_json));
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    const saved = snapshots[i];
    const evidence = saved?.special_outcome;
    const event = events[i];
    const priorEvent = events[i - 1];
    const lastAttempt = i === attempts.length - 1;
    const review = reviewsBySubmission.get(String(a.submission_id));

    check(
      Number(a.attempt_number) === i + 1 &&
        equalId(a.grade_id, target.grade_id) &&
        equalId(a.sheet_id, target.sheet_id) &&
        equalId(a.period_id, target.period_id) &&
        equalId(a.special_outcome_id, outcome.special_outcome_id) &&
        equalId(a.submitted_by_user_id, outcome.created_by_user_id) &&
        a.grading_scope === "FULL_SEMESTER" &&
        a.grading_outcome_snapshot === type &&
        numericEqual(a.final_rating_snapshot, rating) &&
        a.special_outcome_reason_snapshot === evidence?.outcome_reason &&
        saved?.policy === "TWO_TERM_50_50" &&
        saved?.grading_scope === "FULL_SEMESTER" &&
        equalId(saved.offering_id, target.offering_id) &&
        equalId(saved.config_id, target.config_id) &&
        equalId(saved.enrollment_subject_id, target.enrollment_subject_id) &&
        equalId(saved.grade_id, target.grade_id) &&
        equalId(saved.special_outcome_id, outcome.special_outcome_id) &&
        saved.grading_outcome === type &&
        evidence?.outcome_type === type &&
        Number(saved.term_weights?.MIDTERM) === 50 &&
        Number(saved.term_weights?.FINAL_TERM) === 50 &&
        readable(evidence.outcome_reason, 10, 500) &&
        readable(evidence.evidence_summary, 20, 2000) &&
        (inc
          ? readable(evidence.missing_requirements, 10, 2000)
          : evidence.missing_requirements === null) &&
        numericEqual(saved.official_result?.final_rating, rating) &&
        saved.official_result?.overall_percentage == null &&
        Number(event.record_version_after) === i + 1 &&
        event.new_record_status === "ACTIVE" &&
        event.new_outcome_type === type &&
        event.new_outcome_reason === evidence.outcome_reason &&
        sameNullable(
          event.new_missing_requirements,
          evidence.missing_requirements,
        ) &&
        event.new_evidence_summary === evidence.evidence_summary &&
        equalId(event.performed_by_user_id, a.submitted_by_user_id),
      "SPECIAL_APPROVAL_ATTEMPT_EVIDENCE_INVALID",
      `Evidence for attempt ${i + 1} is inconsistent.`,
    );

    // Preserve numeric term evidence across submission attempts.
    for (const term of ["MIDTERM", "FINAL_TERM"]) {
      const prefix = term === "MIDTERM" ? "midterm" : "final_term";

      const gradeKey = term === "MIDTERM" ? "midterm_grade" : "final_grade";

      const calculation = saved.calculated_terms?.[term];

      const values = [
        a[`${prefix}_percentage_snapshot`],
        a[`${prefix}_exact_numerator`],
        a[`${prefix}_exact_denominator`],
        saved.official_result?.[gradeKey],
      ];

      if (!inc) {
        check(
          values.every((v) => v == null),
          "SPECIAL_APPROVAL_UD_NUMERIC_INVALID",
          "UD cannot contain numeric term grades.",
        );

        continue;
      }

      check(
        calculation != null,
        "SPECIAL_APPROVAL_INC_TERM_INVALID",
        `Attempt ${i + 1} is missing its ${term} calculation.`,
      );

      if (calculation.state === "READY") {
        const expected = termExact(a, saved, term);

        check(
          numericEqual(values[0], expected) &&
            numericEqual(values[3], expected),
          "SPECIAL_APPROVAL_INC_TERM_INVALID",
          `Attempt ${i + 1} contains inconsistent ${term} evidence.`,
        );
      } else {
        check(
          values.every((v) => v == null),
          "SPECIAL_APPROVAL_INC_TERM_INVALID",
          `Attempt ${i + 1} contains numeric grades for incomplete ${term}.`,
        );
      }
    }

    if (i === 0) {
      check(
        event.event_type === "CREATED" &&
          event.previous_record_status == null &&
          event.previous_outcome_type == null &&
          event.previous_outcome_reason == null &&
          event.previous_missing_requirements == null &&
          event.previous_evidence_summary == null &&
          Number(a.record_version) === 2 &&
          a.submission_status === "RETURNED",
        "SPECIAL_APPROVAL_FIRST_ATTEMPT_INVALID",
        "The original submission or creation event is inconsistent.",
      );
    } else {
      const prior = attempts[i - 1];
      const priorSnapshot = snapshots[i - 1];
      const reconstructed = {
        ...priorSnapshot,
        special_outcome: {
          ...priorSnapshot.special_outcome,
          outcome_reason: evidence.outcome_reason,
          evidence_summary: evidence.evidence_summary,
          missing_requirements: evidence.missing_requirements,
        },
        preceding_submission_id: String(prior.submission_id),
        preceding_return_scope: prior.returned_edit_scope,
        special_evidence_version: i + 1,
      };
      check(
        event.event_type === "UPDATED" &&
          event.previous_record_status === "ACTIVE" &&
          event.previous_outcome_type === type &&
          event.previous_outcome_reason === priorEvent.new_outcome_reason &&
          sameNullable(
            event.previous_missing_requirements,
            priorEvent.new_missing_requirements,
          ) &&
          event.previous_evidence_summary === priorEvent.new_evidence_summary &&
          canonical(saved) === canonical(reconstructed),
        "SPECIAL_APPROVAL_REVISION_CHAIN_INVALID",
        `Resubmission ${i + 1} does not preserve the prior snapshot.`,
      );
    }

    if (!lastAttempt) {
      check(
        a.submission_status === "RETURNED" &&
          Number(a.record_version) === 2 &&
          ["MIDTERM", "FINAL_TERM", "BOTH"].includes(a.returned_edit_scope) &&
          positiveId(a.reviewed_by_user_id) &&
          a.reviewed_at != null &&
          readable(a.review_remarks, 15, 500) &&
          review?.review_decision === "RETURNED" &&
          review.grading_outcome_snapshot === type &&
          review.returned_edit_scope === a.returned_edit_scope &&
          equalId(review.reviewed_by_user_id, a.reviewed_by_user_id) &&
          Number(review.submission_version_after) === 2 &&
          review.review_notes === a.review_remarks &&
          readable(review.evidence_review_notes, 20, 2000),
        "SPECIAL_APPROVAL_RETURN_AUDIT_INVALID",
        `Returned attempt ${i + 1} has no valid Program Head review.`,
      );
    } else if (expectedSubmissionVersion === 1) {
      check(
        !review &&
          a.submission_status === "SUBMITTED" &&
          Number(a.record_version) === 1 &&
          a.returned_edit_scope == null &&
          a.reviewed_by_user_id == null &&
          a.reviewed_at == null,
        "SPECIAL_APPROVAL_CURRENT_REVIEW_INVALID",
        "The latest attempt is already reviewed.",
      );
    } else {
      check(
        review?.review_decision === "APPROVED" &&
          review.grading_outcome_snapshot === type &&
          Number(review.submission_version_after) === 2 &&
          Number(review.reviewed_by_user_id) === reviewerUserId &&
          a.submission_status === "APPROVED" &&
          Number(a.record_version) === 2 &&
          Number(a.reviewed_by_user_id) === reviewerUserId,
        "SPECIAL_APPROVAL_CURRENT_REVIEW_INVALID",
        "The current approval audit is missing.",
      );
    }
  }

  const finalEvidence = snapshot?.special_outcome;
  const lastEvidence = snapshots.at(-1)?.special_outcome;
  check(
    canonical(snapshot) === canonical(snapshots.at(-1)) &&
      lastEvidence.outcome_reason === outcome.outcome_reason &&
      sameNullable(
        lastEvidence.missing_requirements,
        outcome.missing_requirements,
      ) &&
      lastEvidence.evidence_summary === outcome.evidence_summary &&
      grade.outcome_reason === outcome.outcome_reason,
    "SPECIAL_APPROVAL_CURRENT_EVIDENCE_CHANGED",
    "Current grade and active evidence no longer match.",
  );

  const result = snapshot.official_result;

  for (const term of ["MIDTERM", "FINAL_TERM"]) {
    const prefix = term === "MIDTERM" ? "midterm" : "final_term";

    const gradeKey = term === "MIDTERM" ? "midterm_grade" : "final_grade";

    const calculation = snapshot.calculated_terms?.[term];

    const values = [
      grade[gradeKey],
      submission[`${prefix}_percentage_snapshot`],
      submission[`${prefix}_exact_numerator`],
      submission[`${prefix}_exact_denominator`],
      result[gradeKey],
    ];

    if (!inc) {
      check(
        values.every((v) => v == null),
        "SPECIAL_APPROVAL_UD_NUMERIC_INVALID",
        "UD cannot contain invented numeric grades.",
      );

      continue;
    }

    check(
      calculation != null,
      "SPECIAL_APPROVAL_INC_TERM_INVALID",
      `The protected ${term} calculation is missing.`,
    );

    if (calculation.state === "READY") {
      const expected = termExact(submission, snapshot, term);

      check(
        numericEqual(grade[gradeKey], expected) &&
          numericEqual(submission[`${prefix}_percentage_snapshot`], expected) &&
          numericEqual(result[gradeKey], expected),
        "SPECIAL_APPROVAL_INC_TERM_INVALID",
        `The protected INC ${term} calculation is inconsistent.`,
      );
    } else {
      check(
        values.every((v) => v == null),
        "SPECIAL_APPROVAL_INC_TERM_INVALID",
        `The incomplete ${term} contains finalized numeric grades.`,
      );
    }
  }

  // Reconcile the saved academic evidence with the current gradebook rows.
  const [pending] = await connection.execute(
    `SELECT a.assessment_id, a.grading_term, a.header_name, oc.category_code,
            a.maximum_score, sc.score_id, sc.record_version
       FROM gradebook_assessments a
       JOIN gradebook_offering_categories oc ON oc.offering_category_id = a.offering_category_id
       LEFT JOIN gradebook_scores sc ON sc.assessment_id = a.assessment_id AND sc.enrollment_subject_id = ?
      WHERE oc.config_id = ? AND a.record_status = 'ACTIVE'
        AND COALESCE(sc.score_status, 'PENDING') = 'PENDING'
             ORDER BY a.grading_term, a.assessment_id ${lock ? "FOR UPDATE" : ""}`,
    [target.enrollment_subject_id, target.config_id],
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
           ORDER BY m.meeting_date, m.meeting_id ${lock ? "FOR UPDATE" : ""}`,
    [target.enrollment_subject_id, target.config_id],
  );
  const absences = attendance.filter(
    (a) =>
      a.attendance_status === "ABSENT" &&
      a.recorded_at != null &&
      a.recorded_by_user_id != null &&
      Number(a.record_version) > 0,
  );
  check(
    attendance.length > 0 &&
      attendance.every((a) => a.attendance_status !== "PENDING") &&
      canonical(pending) === canonical(finalEvidence.pending_assessments) &&
      canonical(attendance) === canonical(finalEvidence.attendance_entries) &&
      Number(finalEvidence.absent_meetings) === absences.length &&
      (inc
        ? pending.length > 0 &&
          pending.every((a) =>
            ["MIDTERM", "FINAL_TERM"].includes(a.grading_term),
          ) &&
          ["MIDTERM", "FINAL_TERM"].every((term) => {
            const calculation = snapshot.calculated_terms?.[term];

            const ready = calculation?.state === "READY";

            const hasPending = pending.some((a) => a.grading_term === term);

            return calculation != null && ready !== hasPending;
          })
        : absences.length > 0),
    "SPECIAL_APPROVAL_LIVE_EVIDENCE_CHANGED",
    "Current assessment or attendance evidence differs from the submitted source.",
  );
}
