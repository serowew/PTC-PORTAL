const QA_DATABASE = "databaseforptc1_admission_test";

function deny(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 403;
  throw error;
}

// Dedicated rollout gate for attendance meetings and attendance entries.
export async function assertGradebookAttendanceWriteAllowed(connection) {
  const [rows] = await connection.execute("SELECT DATABASE() AS database_name");
  const activeDatabase = rows?.length === 1 ? rows[0]?.database_name : null;

  if (typeof activeDatabase !== "string" || !activeDatabase.trim()) {
    deny(
      "GRADEBOOK_ATTENDANCE_DATABASE_UNKNOWN",
      "The active attendance database could not be verified.",
    );
  }

  if (activeDatabase === QA_DATABASE) {
    if (process.env.NODE_ENV === "production") {
      deny(
        "GRADEBOOK_ATTENDANCE_QA_PRODUCTION_FORBIDDEN",
        "QA attendance writes are unavailable in production mode.",
      );
    }
    return { isQaDatabase: true };
  }

  if (process.env.GRADEBOOK_ATTENDANCE_WRITES_ENABLED !== "true") {
    deny(
      "GRADEBOOK_ATTENDANCE_WRITES_DISABLED",
      "Attendance editing is not enabled for this deployment.",
    );
  }

  const targetDatabase =
    process.env.GRADEBOOK_ATTENDANCE_TARGET_DATABASE?.trim();
  const configuredDatabase = process.env.DB_NAME?.trim();
  if (
    !targetDatabase ||
    !configuredDatabase ||
    targetDatabase !== configuredDatabase ||
    targetDatabase !== activeDatabase
  ) {
    deny(
      "GRADEBOOK_ATTENDANCE_DATABASE_MISMATCH",
      "The active database does not match the authorized attendance database.",
    );
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.GRADEBOOK_ATTENDANCE_PRODUCTION_ENABLED !== "true"
  ) {
    deny(
      "GRADEBOOK_ATTENDANCE_PRODUCTION_DISABLED",
      "Production attendance editing requires separate authorization.",
    );
  }

  return { isQaDatabase: false };
}
