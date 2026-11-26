import { assertCombinedApprovalWriteAllowed } from "./gradebookCombinedApprovalWriteGuard.service.js";

function periodPositiveId(value) {
  const raw = String(value ?? "").trim();
  if (!/^[1-9][0-9]*$/.test(raw)) return null;

  const num = Number(raw);
  return Number.isSafeInteger(num) ? num : null;
}

function combinedApprovalFail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
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

export async function combinedApprovalSpecialEvidence(
  connection,
  target,
  grade,
  submission,
  snapshot,
  userId,
  expectedEvidenceVersion = 1,
  lock = true,
  restrictToQa = true,
) {
  const fail = (message) =>
    combinedApprovalFail("COMBINED_APPROVAL_SPECIAL_EVIDENCE_INVALID", message);

  const type = grade?.grading_outcome;
  const inc = type === "INCOMPLETE";
  const rating = inc ? "4.00" : "6.00";

  const evidence = snapshot?.special_outcome;
  const result = snapshot?.official_result;

  const validText = (value, min, max) =>
    typeof value === "string" &&
    value.trim().length >= min &&
    value.trim().length <= max;

  const equalDecimal = (left, right) =>
    left != null &&
    right != null &&
    /^[0-9]+(?:\.[0-9]{1,12})?$/.test(String(left)) &&
    /^[0-9]+(?:\.[0-9]{1,12})?$/.test(String(right)) &&
    Number(left) === Number(right);

  // Verify the grading database before special-outcome approval.
  if (restrictToQa) {
    const { isQaDatabase } =
      await assertCombinedApprovalWriteAllowed(connection);

    if (
      !isQaDatabase &&
      process.env.GRADEBOOK_COMBINED_SPECIAL_APPROVAL_ENABLED !== "true"
    ) {
      combinedApprovalFail(
        "COMBINED_SPECIAL_APPROVAL_WRITES_DISABLED",
        "INC/UD approval is not enabled for this database.",
        403,
      );
    }
  }

  // Validate the gradebook and submission scope.
  if (
    !periodPositiveId(target?.offering_id) ||
    !periodPositiveId(target?.config_id) ||
    !periodPositiveId(target?.enrollment_subject_id) ||
    !periodPositiveId(target?.grade_id) ||
    !periodPositiveId(target?.sheet_id) ||
    !periodPositiveId(target?.period_id) ||
    !periodPositiveId(userId) ||
    !periodPositiveId(submission?.submission_id) ||
    Number(grade?.grade_id) !== Number(target.grade_id) ||
    Number(submission.grade_id ?? submission.attempt_grade_id) !==
      Number(target.grade_id) ||
    Number(submission.sheet_id) !== Number(target.sheet_id) ||
    Number(submission.period_id) !== Number(target.period_id) ||
    Number(snapshot?.offering_id) !== Number(target.offering_id) ||
    Number(snapshot?.config_id) !== Number(target.config_id) ||
    Number(snapshot?.enrollment_subject_id) !==
      Number(target.enrollment_subject_id) ||
    Number(snapshot?.grade_id) !== Number(target.grade_id) ||
    Number(submission.attempt_number) !== 1 ||
    Number(submission.record_version) !== expectedEvidenceVersion ||
    !["INCOMPLETE", "UNOFFICIAL_DROP"].includes(type) ||
    !periodPositiveId(submission.special_outcome_id) ||
    Number(snapshot?.special_outcome_id) !==
      Number(submission.special_outcome_id) ||
    snapshot?.grading_outcome !== type ||
    evidence?.outcome_type !== type ||
    !validText(evidence?.outcome_reason, 10, 500) ||
    !validText(evidence?.evidence_summary, 20, 2000) ||
    (inc
      ? !validText(evidence.missing_requirements, 10, 2000)
      : evidence.missing_requirements !== null) ||
    grade.outcome_reason !== evidence.outcome_reason ||
    submission.special_outcome_reason_snapshot !== evidence.outcome_reason ||
    grade.remarks !== (inc ? "Incomplete" : "Unofficial Drop") ||
    !equalDecimal(grade.final_rating, rating) ||
    !equalDecimal(submission.final_rating_snapshot, rating) ||
    !equalDecimal(result?.final_rating, rating) ||
    [
      grade.overall_percentage,
      submission.overall_percentage_snapshot,
      submission.overall_exact_numerator,
      submission.overall_exact_denominator,
      result?.overall_percentage,
    ].some((v) => v !== null)
  ) {
    fail(
      "The special outcome, submission and grade evidence are inconsistent with the gradebook scope.",
    );
  }

  // Verify the recorded special outcome.
  const [outcomes] = await connection.execute(
    `SELECT *
       FROM gradebook_special_outcomes
      WHERE grade_id = ?
      ${lock ? "FOR UPDATE" : ""}`,
    [target.grade_id],
  );

  const row = outcomes[0];

  if (
    outcomes.length !== 1 ||
    Number(row.special_outcome_id) !== Number(submission.special_outcome_id) ||
    row.outcome_type !== type ||
    row.record_status !== "ACTIVE" ||
    Number(row.record_version) !== 1 ||
    Number(row.created_by_user_id) !==
      Number(submission.submitted_by_user_id) ||
    row.outcome_reason !== evidence.outcome_reason ||
    row.missing_requirements !== evidence.missing_requirements ||
    row.evidence_summary !== evidence.evidence_summary
  ) {
    fail("The linked active special-outcome record is missing or changed.");
  }

  // Verify the original evidence audit event.
  const [events] = await connection.execute(
    `SELECT *
       FROM gradebook_special_outcome_events
      WHERE special_outcome_id = ?
      ORDER BY event_id
      ${lock ? "FOR UPDATE" : ""}`,
    [submission.special_outcome_id],
  );

  const event = events[0];

  if (
    events.length !== 1 ||
    event.event_type !== "CREATED" ||
    event.previous_record_status !== null ||
    event.new_record_status !== "ACTIVE" ||
    event.previous_outcome_type !== null ||
    event.new_outcome_type !== type ||
    Number(event.record_version_after) !== 1 ||
    Number(event.performed_by_user_id) !==
      Number(submission.submitted_by_user_id) ||
    event.new_outcome_reason !== row.outcome_reason ||
    event.new_missing_requirements !== row.missing_requirements ||
    event.new_evidence_summary !== row.evidence_summary
  ) {
    fail(
      "The original special-outcome audit event does not match the submitted evidence.",
    );
  }

  // Check pending assessment evidence.
  const [pending] = await connection.execute(
    `SELECT a.assessment_id,
            a.grading_term,
            a.header_name,
            oc.category_code,
            a.maximum_score,
            sc.score_id,
            sc.record_version
       FROM gradebook_assessments a
       JOIN gradebook_offering_categories oc
         ON oc.offering_category_id = a.offering_category_id
       LEFT JOIN gradebook_scores sc
         ON sc.assessment_id = a.assessment_id
        AND sc.enrollment_subject_id = ?
      WHERE oc.config_id = ?
        AND a.record_status = 'ACTIVE'
        AND COALESCE(sc.score_status, 'PENDING') = 'PENDING'
      ORDER BY a.grading_term, a.assessment_id
      ${lock ? "FOR UPDATE" : ""}`,
    [target.enrollment_subject_id, target.config_id],
  );

  // Check attendance evidence.
  const [attendance] = await connection.execute(
    `SELECT m.meeting_id,
            m.grading_term,
            DATE_FORMAT(m.meeting_date, '%Y-%m-%d') AS meeting_date,
            COALESCE(a.attendance_status, 'PENDING') AS attendance_status,
            a.record_version,
            a.recorded_by_user_id,
            a.recorded_at
       FROM gradebook_attendance_meetings m
       LEFT JOIN gradebook_attendance_entries a
         ON a.meeting_id = m.meeting_id
        AND a.enrollment_subject_id = ?
      WHERE m.config_id = ?
        AND m.meeting_status = 'HELD'
        AND m.meeting_date <= CURDATE()
      ORDER BY m.meeting_date, m.meeting_id
      ${lock ? "FOR UPDATE" : ""}`,
    [target.enrollment_subject_id, target.config_id],
  );

  // Normalize evidence before comparison.
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

  const absences = attendance.filter(
    (r) =>
      r.attendance_status === "ABSENT" &&
      r.recorded_by_user_id != null &&
      r.recorded_at != null &&
      Number(r.record_version) > 0,
  );

  if (
    !attendance.length ||
    attendance.some((r) => r.attendance_status === "PENDING") ||
    canonical(pending) !== canonical(evidence.pending_assessments) ||
    canonical(attendance) !== canonical(evidence.attendance_entries) ||
    Number(evidence.absent_meetings) !== absences.length
  ) {
    fail(
      "Saved assessment or attendance evidence has changed since submission.",
    );
  }

  // Validate special-outcome term evidence.
  if (inc) {
    const terms = [
      {
        code: "MIDTERM",
        gradeValue: grade.midterm_grade,
        snapshotValue: submission.midterm_percentage_snapshot,
        numerator: submission.midterm_exact_numerator,
        denominator: submission.midterm_exact_denominator,
        resultValue: result.midterm_grade,
      },
      {
        code: "FINAL_TERM",
        gradeValue: grade.final_grade,
        snapshotValue: submission.final_term_percentage_snapshot,
        numerator: submission.final_term_exact_numerator,
        denominator: submission.final_term_exact_denominator,
        resultValue: result.final_grade,
      },
    ];

    if (
      !pending.some((r) => ["MIDTERM", "FINAL_TERM"].includes(r.grading_term))
    ) {
      fail("INC requires genuinely outstanding assessments.");
    }

    for (const term of terms) {
      const calculation = snapshot.calculated_terms?.[term.code];

      const ready = calculation?.state === "READY";

      const hasPending = pending.some((r) => r.grading_term === term.code);

      if (!calculation || ready === hasPending) {
        fail(
          `The ${term.code} calculation does not match its outstanding assessment evidence.`,
        );
      }

      if (ready) {
        const fraction = combinedApprovalFraction(
          term.numerator,
          term.denominator,
          calculation.term_percentage,
          255,
        );

        const expected = combinedApprovalDecimal12(fraction);

        if (
          !equalDecimal(term.gradeValue, expected) ||
          !equalDecimal(term.snapshotValue, expected) ||
          !equalDecimal(term.resultValue, expected)
        ) {
          fail(
            `The preserved ${term.code} percentage does not match its exact calculation.`,
          );
        }
      } else {
        if (
          [
            term.gradeValue,
            term.snapshotValue,
            term.numerator,
            term.denominator,
            term.resultValue,
          ].some((v) => v !== null)
        ) {
          fail(
            `The incomplete ${term.code} must not contain a finalized numeric percentage.`,
          );
        }
      }
    }
  } else if (
    !absences.length ||
    [
      grade.midterm_grade,
      grade.final_grade,
      submission.midterm_percentage_snapshot,
      submission.final_term_percentage_snapshot,
      submission.midterm_exact_numerator,
      submission.midterm_exact_denominator,
      submission.final_term_exact_numerator,
      submission.final_term_exact_denominator,
      result.midterm_grade,
      result.final_grade,
    ].some((v) => v !== null)
  ) {
    fail(
      "UD requires documented absences and must not contain fabricated numeric grades.",
    );
  }
}
