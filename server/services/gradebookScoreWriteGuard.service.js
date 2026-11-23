const QA_DATABASE = "databaseforptc1_admission_test";

function deny(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 403;
  throw error;
}

export async function assertGradebookScoreWriteAllowed(connection) {
  const [rows] = await connection.execute("SELECT DATABASE() AS database_name");
  const activeDatabase = rows?.length === 1 ? rows[0]?.database_name : null;

  if (typeof activeDatabase !== "string" || !activeDatabase.trim()) {
    deny(
      "GRADEBOOK_SCORE_DATABASE_UNKNOWN",
      "The active database could not be verified.",
    );
  }

  // Existing isolated QA database remains usable in non-production environments.
  if (activeDatabase === QA_DATABASE) {
    if (process.env.NODE_ENV === "production") {
      deny(
        "GRADEBOOK_SCORE_QA_PRODUCTION_FORBIDDEN",
        "QA score entry is unavailable in production mode.",
      );
    }
    return { isQaDatabase: true };
  }

  if (process.env.GRADEBOOK_SCORE_WRITES_ENABLED !== "true") {
    deny(
      "GRADEBOOK_SCORE_WRITES_DISABLED",
      "Score entry has not been enabled for this deployment.",
    );
  }

  const configuredDatabase = process.env.DB_NAME?.trim();
  const allowedDatabase = process.env.GRADEBOOK_SCORE_TARGET_DATABASE?.trim();
  if (
    !configuredDatabase ||
    !allowedDatabase ||
    configuredDatabase !== allowedDatabase ||
    activeDatabase !== allowedDatabase
  ) {
    deny(
      "GRADEBOOK_SCORE_DATABASE_MISMATCH",
      "The active database does not match the explicitly authorized score database.",
    );
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.GRADEBOOK_SCORE_PRODUCTION_ENABLED !== "true"
  ) {
    deny(
      "GRADEBOOK_SCORE_PRODUCTION_DISABLED",
      "Production score entry requires separate authorization.",
    );
  }

  return { isQaDatabase: false };
}
