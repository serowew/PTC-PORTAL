function deny(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 403;
  throw error;
}

// Dedicated rollout gate for special-outcome returns.
export async function assertSpecialOutcomeReturnWriteAllowed(connection) {
  if (process.env.SPECIAL_RETURN_WRITES_ENABLED !== "true") {
    deny(
      "SPECIAL_RETURN_WRITES_DISABLED",
      "Special-outcome returns are not enabled for this deployment.",
    );
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.SPECIAL_RETURN_PRODUCTION_ENABLED !== "true"
  ) {
    deny(
      "SPECIAL_RETURN_PRODUCTION_DISABLED",
      "Production special-outcome returns require separate authorization.",
    );
  }

  const targetDatabase = process.env.SPECIAL_RETURN_TARGET_DATABASE?.trim();

  const configuredDatabase = process.env.DB_NAME?.trim();

  if (!targetDatabase || targetDatabase !== configuredDatabase) {
    deny(
      "SPECIAL_RETURN_DATABASE_NOT_CONFIGURED",
      "Special-outcome return database is not explicitly authorized.",
    );
  }

  const [rows] = await connection.execute("SELECT DATABASE() AS database_name");

  if (
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    rows[0]?.database_name !== targetDatabase
  ) {
    deny(
      "SPECIAL_RETURN_DATABASE_MISMATCH",
      "The active database is not authorized for special-outcome returns.",
    );
  }
}
