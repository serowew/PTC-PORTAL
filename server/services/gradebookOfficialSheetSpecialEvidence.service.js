import { validateResubmittedSpecialApproval } from "./gradebookSpecialResubmissionApproval.service.js";
import { combinedApprovalSpecialEvidence } from "./gradebookFirstAttemptSpecialEvidence.service.js";
// Select the appropriate validator for an approved special outcome.
export async function validateOfficialSheetSpecialEvidence(
  connection,
  target,
  grade,
  submission,
  snapshot,
  reviewerUserId,
  { expectedSubmissionVersion = 2, lock = false } = {},
) {
  const attemptNumber = Number(submission?.attempt_number);

  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
    const error = new Error("Invalid special-outcome submission attempt.");
    error.code = "COMBINED_APPROVAL_SPECIAL_EVIDENCE_INVALID";
    throw error;
  }

  if (attemptNumber > 1) {
    return validateResubmittedSpecialApproval(
      connection,
      target,
      grade,
      submission,
      snapshot,
      reviewerUserId,
      expectedSubmissionVersion,
      lock,
    );
  }

  // Reuse the first-attempt validator for official-sheet evidence checks.
  return combinedApprovalSpecialEvidence(
    connection,
    target,
    grade,
    submission,
    snapshot,
    reviewerUserId,
    expectedSubmissionVersion,
    lock,
    false,
  );
}
