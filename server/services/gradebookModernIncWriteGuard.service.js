const QA_DATABASE = "databaseforptc1_admission_test";

function deny(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 403;
  throw error;
}

export async function assertModernIncWriteAllowed(connection) {
  const [rows] = await connection.execute("SELECT DATABASE() AS database_name");

  const activeDatabase =
    Array.isArray(rows) && rows.length === 1 ? rows[0]?.database_name : null;

  if (typeof activeDatabase !== "string" || !activeDatabase.trim()) {
    deny(
      "MODERN_INC_DATABASE_UNKNOWN",
      "The active grading database could not be verified.",
    );
  }

  if (activeDatabase === QA_DATABASE) {
    if (process.env.NODE_ENV === "production") {
      deny(
        "MODERN_INC_QA_PRODUCTION_FORBIDDEN",
        "QA INC operations are not permitted in production mode.",
      );
    }

    return { isQaDatabase: true };
  }

  if (process.env.GRADEBOOK_MODERN_INC_SOURCE_WRITE_SCOPE_ENABLED !== "true") {
    deny(
      "MODERN_INC_WRITES_DISABLED",
      "Modern INC operations are not enabled for this deployment.",
    );
  }

  const configuredDatabase = process.env.DB_NAME?.trim();

  const targetDatabase =
    process.env.GRADEBOOK_MODERN_INC_TARGET_DATABASE?.trim();

  if (
    !configuredDatabase ||
    !targetDatabase ||
    configuredDatabase !== targetDatabase ||
    activeDatabase !== targetDatabase
  ) {
    deny(
      "MODERN_INC_DATABASE_MISMATCH",
      "The active database does not match the authorized INC database.",
    );
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.GRADEBOOK_MODERN_INC_PRODUCTION_ENABLED !== "true"
  ) {
    deny(
      "MODERN_INC_PRODUCTION_DISABLED",
      "Production INC operations require separate authorization.",
    );
  }

  return { isQaDatabase: false };
}
