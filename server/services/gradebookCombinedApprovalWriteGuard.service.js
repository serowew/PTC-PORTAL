const QA_DATABASE = "databaseforptc1_admission_test";

function deny(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 403;
  throw error;
}

export async function assertCombinedApprovalWriteAllowed(connection) {
  const [rows] = await connection.execute("SELECT DATABASE() AS database_name");

  const activeDatabase =
    Array.isArray(rows) && rows.length === 1 ? rows[0]?.database_name : null;

  if (typeof activeDatabase !== "string" || !activeDatabase.trim()) {
    deny(
      "COMBINED_APPROVAL_DATABASE_UNKNOWN",
      "Could not verify the active database.",
    );
  }

  if (activeDatabase === QA_DATABASE) {
    if (process.env.NODE_ENV === "production") {
      deny(
        "COMBINED_APPROVAL_QA_PRODUCTION_FORBIDDEN",
        "QA approvals are not allowed in production.",
      );
    }

    return { isQaDatabase: true };
  }

  if (process.env.GRADEBOOK_APPROVAL_WRITES_ENABLED !== "true") {
    deny(
      "COMBINED_APPROVAL_WRITES_DISABLED",
      "Combined-semester approvals are disabled for this deployment.",
    );
  }

  const configuredDatabase = process.env.DB_NAME?.trim();

  const targetDatabase = process.env.GRADEBOOK_APPROVAL_TARGET_DATABASE?.trim();

  if (
    !configuredDatabase ||
    !targetDatabase ||
    targetDatabase !== configuredDatabase ||
    activeDatabase !== targetDatabase
  ) {
    deny(
      "COMBINED_APPROVAL_DATABASE_MISMATCH",
      "The connected database is not authorized for combined-semester approvals.",
    );
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.GRADEBOOK_APPROVAL_PRODUCTION_ENABLED !== "true"
  ) {
    deny(
      "COMBINED_APPROVAL_PRODUCTION_DISABLED",
      "Production combined-semester approvals require separate authorization.",
    );
  }

  return { isQaDatabase: false };
}
