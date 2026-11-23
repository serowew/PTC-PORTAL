const QA_DATABASE = "databaseforptc1_admission_test";

function deny(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 403;
  throw error;
}

// Only assessment-structure writes use this permission gate.
export async function assertGradebookAssessmentWriteAllowed(connection) {
  const [rows] = await connection.execute("SELECT DATABASE() AS database_name");
  const activeDatabase = rows?.length === 1 ? rows[0]?.database_name : null;

  if (typeof activeDatabase !== "string" || !activeDatabase.trim()) {
    deny(
      "GRADEBOOK_ASSESSMENT_DATABASE_UNKNOWN",
      "The active database could not be verified.",
    );
  }

  // Existing QA database remains usable for development testing.
  if (activeDatabase === QA_DATABASE) {
    if (process.env.NODE_ENV === "production") {
      deny(
        "GRADEBOOK_ASSESSMENT_QA_PRODUCTION_FORBIDDEN",
        "QA assessment writes are unavailable in production mode.",
      );
    }
    return { isQaDatabase: true };
  }

  if (process.env.GRADEBOOK_ASSESSMENT_WRITES_ENABLED !== "true") {
    deny(
      "GRADEBOOK_ASSESSMENT_WRITES_DISABLED",
      "Assessment editing is not enabled for this deployment.",
    );
  }

  const targetDatabase =
    process.env.GRADEBOOK_ASSESSMENT_TARGET_DATABASE?.trim();
  const configuredDatabase = process.env.DB_NAME?.trim();
  if (
    !targetDatabase ||
    !configuredDatabase ||
    targetDatabase !== configuredDatabase ||
    targetDatabase !== activeDatabase
  ) {
    deny(
      "GRADEBOOK_ASSESSMENT_DATABASE_MISMATCH",
      "The active database does not match the authorized assessment database.",
    );
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.GRADEBOOK_ASSESSMENT_PRODUCTION_ENABLED !== "true"
  ) {
    deny(
      "GRADEBOOK_ASSESSMENT_PRODUCTION_DISABLED",
      "Production assessment editing requires separate authorization.",
    );
  }

  return { isQaDatabase: false };
}
