// Shared with the frontend for grade previews.
// The backend always recalculates the authoritative result.

export { calculateGrade, GRADING_POLICY } from "../shared/gradingPolicy.js";

export function gradePolicyFields(row) {
  return {
    grading_policy: row.grading_policy || "LEGACY",

    grading_outcome: row.grading_outcome || "NUMERIC",

    outcome_reason: row.outcome_reason || null,

    overall_percentage:
      row.overall_percentage == null ? null : Number(row.overall_percentage),
  };
}
