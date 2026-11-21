export function assertCurrentNumericApprovalEvidence(
  current,
  snapshot,
  configId,
) {
  if (
    !current ||
    !snapshot ||
    Number(current.config_id) !== Number(configId) ||
    current.grading_policy !== "TWO_TERM_50_50" ||
    current.grading_classification !== snapshot.classification ||
    JSON.stringify(current.term_weights) !==
      JSON.stringify(snapshot.term_weights) ||
    current.terms?.MIDTERM?.state !== "READY" ||
    current.terms?.FINAL_TERM?.state !== "READY" ||
    current.semester?.state !== "READY" ||
    JSON.stringify(current.terms.MIDTERM) !==
      JSON.stringify(snapshot.calculated_terms?.MIDTERM) ||
    JSON.stringify(current.terms.FINAL_TERM) !==
      JSON.stringify(snapshot.calculated_terms?.FINAL_TERM) ||
    JSON.stringify(current.semester) !==
      JSON.stringify(snapshot.calculated_semester)
  ) {
    const error = new Error(
      "Scores, attendance, or semester calculations changed after submission. Return the grade for correction.",
    );

    error.code = "COMBINED_APPROVAL_CURRENT_EVIDENCE_CHANGED";
    error.status = 409;

    throw error;
  }
}

function exactNumericFail(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  throw error;
}

function exactNumericFraction(n, d, source, maxDigits) {
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
    exactNumericFail(
      "COMBINED_APPROVAL_EXACT_SOURCE_INVALID",
      "Approved calculations must match the submitted exact source fractions.",
    );
  }

  const ratio = {
    n: BigInt(numerator),
    d: BigInt(denominator),
  };

  if (ratio.n > 100n * ratio.d) {
    exactNumericFail(
      "COMBINED_APPROVAL_PERCENT_INVALID",
      "Grade percentage is outside 0–100.",
    );
  }

  return ratio;
}

function exactNumericDecimal12(ratio) {
  const scale = 1000000000000n;
  const units = (ratio.n * scale * 2n + ratio.d) / (ratio.d * 2n);

  return Number(`${units / scale}.${String(units % scale).padStart(12, "0")}`);
}

function exactNumericRating(ratio) {
  for (const [minimum, rating] of [
    [97n, "1.00"],
    [94n, "1.25"],
    [91n, "1.50"],
    [88n, "1.75"],
    [85n, "2.00"],
    [82n, "2.25"],
    [79n, "2.50"],
    [76n, "2.75"],
    [75n, "3.00"],
  ]) {
    if (ratio.n >= minimum * ratio.d) {
      return rating;
    }
  }

  return "5.00";
}

export function assertExactNumericApprovalEvidence(
  submission,
  grade,
  snapshot,
) {
  const mid = exactNumericFraction(
    submission.midterm_exact_numerator,
    submission.midterm_exact_denominator,
    snapshot?.calculated_terms?.MIDTERM?.term_percentage,
    255,
  );

  const fin = exactNumericFraction(
    submission.final_term_exact_numerator,
    submission.final_term_exact_denominator,
    snapshot?.calculated_terms?.FINAL_TERM?.term_percentage,
    255,
  );

  const all = exactNumericFraction(
    submission.overall_exact_numerator,
    submission.overall_exact_denominator,
    snapshot?.calculated_semester?.semester_percentage,
    1200,
  );

  // Verify the exact 50/50 semester calculation.
  if ((mid.n * fin.d + fin.n * mid.d) * all.d !== 2n * mid.d * fin.d * all.n) {
    exactNumericFail(
      "COMBINED_APPROVAL_ARITHMETIC",
      "Saved semester ratio does not equal the exact 50/50 term calculation.",
    );
  }

  const exactRating = exactNumericRating(all);

  const same12 = (actual, expected, tolerance = 0) =>
    actual != null &&
    Number.isFinite(Number(actual)) &&
    Math.abs(Number(actual) - Number(expected)) <= tolerance;

  if (
    !same12(
      submission.midterm_percentage_snapshot,
      exactNumericDecimal12(mid),
    ) ||
    !same12(
      submission.final_term_percentage_snapshot,
      exactNumericDecimal12(fin),
    ) ||
    !same12(
      submission.overall_percentage_snapshot,
      exactNumericDecimal12(all),
    ) ||
    !same12(grade.midterm_grade, submission.midterm_percentage_snapshot) ||
    !same12(grade.final_grade, submission.final_term_percentage_snapshot) ||
    !same12(
      grade.overall_percentage,
      submission.overall_percentage_snapshot,
      2e-12,
    ) ||
    !same12(grade.final_rating, exactRating) ||
    !same12(submission.final_rating_snapshot, exactRating) ||
    !same12(snapshot?.calculated_semester?.numeric_equivalent, exactRating)
  ) {
    exactNumericFail(
      "COMBINED_APPROVAL_GRADE_MISMATCH",
      "Saved grade differs from its exact approved-calculation evidence.",
    );
  }
}
