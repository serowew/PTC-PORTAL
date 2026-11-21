function batchInputFail(code, message) {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  throw error;
}

function batchPositiveId(value) {
  const raw = String(value ?? "");

  if (!/^[1-9]\d*$/.test(raw)) return null;

  const number = Number(raw);

  return Number.isSafeInteger(number) ? number : null;
}

export function validateNumericBatchApprovalInput(body) {
  const allowed = new Set([
    "submissions",
    "review_remarks",
    "confirm_approval",
    "dry_run",
  ]);

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.has(key)) ||
    !Array.isArray(body.submissions) ||
    body.submissions.length < 2 ||
    body.submissions.length > 50
  ) {
    batchInputFail(
      "COMBINED_BATCH_INPUT_INVALID",
      "Provide 2–50 numeric submission IDs with their expected versions.",
    );
  }

  const remarks =
    typeof body.review_remarks === "string" ? body.review_remarks.trim() : "";

  if (
    remarks.length < 10 ||
    remarks.length > 500 ||
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(remarks) ||
    body.confirm_approval !== true ||
    typeof body.dry_run !== "boolean"
  ) {
    batchInputFail(
      "COMBINED_BATCH_CONFIRMATION_INVALID",
      "Provide review remarks (10–500 characters), confirm_approval true, and boolean dry_run.",
    );
  }

  const seen = new Set();

  const submissions = body.submissions.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).some(
        (key) => !["submission_id", "expected_record_version"].includes(key),
      )
    ) {
      batchInputFail(
        "COMBINED_BATCH_SUBMISSION_INVALID",
        "Each entry must contain only submission_id and expected_record_version.",
      );
    }

    const submissionId = batchPositiveId(item.submission_id);
    const version = batchPositiveId(item.expected_record_version);

    if (!submissionId || !version || version >= 4294967295) {
      batchInputFail(
        "COMBINED_BATCH_SUBMISSION_INVALID",
        "Each entry requires a valid submission ID and current record version.",
      );
    }

    if (seen.has(submissionId)) {
      batchInputFail(
        "COMBINED_BATCH_DUPLICATE_SUBMISSION",
        "The same submission cannot appear twice in one approval batch.",
      );
    }

    seen.add(submissionId);

    return {
      submission_id: submissionId,
      expected_record_version: version,
    };
  });

  // Use a consistent processing order for the future batch transaction.
  submissions.sort((a, b) => a.submission_id - b.submission_id);

  return {
    submissions,
    review_remarks: remarks,
    dry_run: body.dry_run,
  };
}
