const QA_DATABASE = "databaseforptc1_admission_test";

function deny(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 403;
  throw error;
}

// This gate covers first-time numeric submissions and returned numeric resubmissions.
// Special outcomes and other grading writes have separate rollout requirements.
export async function assertCombinedSemesterSubmissionWriteAllowed(connection) {
  const [rows] = await connection.execute("SELECT DATABASE() AS database_name");
  const activeDatabase =
    Array.isArray(rows) && rows.length === 1 ? rows[0]?.database_name : null;

  if (typeof activeDatabase !== "string" || !activeDatabase.trim()) {
    deny(
      "COMBINED_SUBMISSION_DATABASE_UNKNOWN",
      "The active database could not be verified.",
    );
  }

  if (activeDatabase === QA_DATABASE) {
    if (process.env.NODE_ENV === "production") {
      deny(
        "COMBINED_SUBMISSION_QA_PRODUCTION_FORBIDDEN",
        "QA grade submission is not permitted in production mode.",
      );
    }
    return { isQaDatabase: true };
  }

  if (process.env.GRADEBOOK_SEMESTER_SUBMISSION_WRITES_ENABLED !== "true") {
    deny(
      "COMBINED_SUBMISSION_WRITES_DISABLED",
      "Combined-semester submission is not enabled for this deployment.",
    );
  }

  const configuredDatabase = process.env.DB_NAME?.trim();
  const targetDatabase =
    process.env.GRADEBOOK_SEMESTER_SUBMISSION_TARGET_DATABASE?.trim();

  if (
    !configuredDatabase ||
    !targetDatabase ||
    configuredDatabase !== targetDatabase ||
    activeDatabase !== targetDatabase
  ) {
    deny(
      "COMBINED_SUBMISSION_DATABASE_MISMATCH",
      "The active database does not match the authorized submission database.",
    );
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.GRADEBOOK_SEMESTER_SUBMISSION_PRODUCTION_ENABLED !== "true"
  ) {
    deny(
      "COMBINED_SUBMISSION_PRODUCTION_DISABLED",
      "Production combined-semester submission requires separate authorization.",
    );
  }

  return { isQaDatabase: false };
}
