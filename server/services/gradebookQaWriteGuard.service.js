export async function assertQaGradingDatabase(connection) {
  if (process.env.NODE_ENV === "production") {
    const error = new Error(
      "QA grading operations are disabled in production mode.",
    );
    error.code = "GRADEBOOK_QA_PRODUCTION_FORBIDDEN";
    error.status = 403;
    throw error;
  }

  const [rows] = await connection.execute("SELECT DATABASE() AS database_name");

  if (
    rows.length !== 1 ||
    rows[0].database_name !== "databaseforptc1_admission_test"
  ) {
    const error = new Error(
      "QA grading operations require the admission-test database.",
    );
    error.code = "GRADEBOOK_QA_DATABASE_ONLY";
    error.status = 403;
    throw error;
  }
}
