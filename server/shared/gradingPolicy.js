/**
 * Official PTC two-term grading policy.
 *
 * Midterm: 50%
 * Final Term: 50%
 *
 * Scores accept a maximum of two decimal places.
 * The average is not rounded before determining the rating.
 */

export const GRADING_POLICY = "TWO_TERM_50_50";

export const OUTCOMES = Object.freeze([
  "NUMERIC",
  "INCOMPLETE",
  "UNOFFICIAL_DROP",
]);

export const GRADE_BANDS = Object.freeze(
  [
    [97, 1.0],
    [94, 1.25],
    [91, 1.5],
    [88, 1.75],
    [85, 2.0],
    [82, 2.25],
    [79, 2.5],
    [76, 2.75],
    [75, 3.0],
    [0, 5.0],
  ].map((band) => Object.freeze(band)),
);

function scoreInHundredths(value, label) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "number" && typeof value !== "string") {
    throw new Error(`${label} must be a percentage between 0 and 100.`);
  }

  const text = String(value).trim();

  if (text === "") {
    return null;
  }

  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new Error(`${label} must have at most two decimal places.`);
  }

  const numeric = Number(text);
  const hundredths = Math.round(numeric * 100);

  if (
    !Number.isSafeInteger(hundredths) ||
    hundredths < 0 ||
    hundredths > 10000
  ) {
    throw new Error(`${label} must be between 0 and 100.`);
  }

  return hundredths;
}

export function calculateGrade(input = {}, { requireComplete = false } = {}) {
  const midterm = scoreInHundredths(input.midterm_grade, "Midterm");

  const finalTerm = scoreInHundredths(input.final_grade, "Final Term");

  const outcome = input.grading_outcome ?? "NUMERIC";

  if (!OUTCOMES.includes(outcome)) {
    throw new Error("Invalid grading outcome.");
  }

  if (
    input.outcome_reason !== null &&
    input.outcome_reason !== undefined &&
    typeof input.outcome_reason !== "string"
  ) {
    throw new Error("Outcome reason must be text.");
  }

  const reason = (input.outcome_reason ?? "").trim();

  if (reason.length > 500) {
    throw new Error("Outcome reason must not exceed 500 characters.");
  }

  if (outcome !== "NUMERIC" && reason === "") {
    throw new Error("A reason is required for Incomplete or Unofficial Drop.");
  }

  const sum =
    midterm !== null && finalTerm !== null ? midterm + finalTerm : null;

  /*
   * Dividing the sum of hundredths by 200 gives
   * the exact 50/50 average.
   *
   * Example:
   * 74.99 + 75.00 = 149.99
   * 149.99 / 2 = 74.995
   *
   * This must remain failed and must not be
   * rounded upward to 75.
   */
  const average = sum === null ? null : sum / 200;

  let rating =
    outcome === "INCOMPLETE" ? 4 : outcome === "UNOFFICIAL_DROP" ? 6 : null;

  if (outcome === "NUMERIC" && sum !== null) {
    rating = GRADE_BANDS.find(([threshold]) => sum >= threshold * 200)[1];
  }

  if (requireComplete && rating === null) {
    throw new Error(
      "Enter both Midterm and Final Term percentages before submission.",
    );
  }

  let remarks = null;

  if (rating !== null) {
    if (rating >= 1 && rating <= 3) {
      remarks = "Passed";
    } else if (rating === 4) {
      remarks = "Incomplete";
    } else if (rating === 5) {
      remarks = "Failed";
    } else if (rating === 6) {
      remarks = "Unofficial Drop";
    }
  }

  return {
    grading_policy: GRADING_POLICY,
    grading_outcome: outcome,

    outcome_reason: outcome === "NUMERIC" ? null : reason,

    midterm_grade: midterm === null ? null : midterm / 100,

    final_grade: finalTerm === null ? null : finalTerm / 100,

    overall_percentage: average,
    final_rating: rating,
    remarks,
  };
}
