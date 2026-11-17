import "dotenv/config";
import assert from "node:assert/strict";
import db from "../db.js";
import { assertQaGradingDatabase } from "../services/gradebookQaWriteGuard.service.js";

let connection;
const originalMode = process.env.NODE_ENV;

try {
  connection = await db.getConnection();

  const [[database]] = await connection.execute(
    "SELECT DATABASE() AS database_name",
  );

  assert.equal(
    database?.database_name,
    "databaseforptc1_admission_test",
    "Test aborted: database is not the authorized QA database.",
  );

  console.log("PASS - Connected to QA database");

  process.env.NODE_ENV = "test";

  await assertQaGradingDatabase(connection);

  console.log("PASS - QA environment accepted");

  process.env.NODE_ENV = "production";

  await assert.rejects(
    assertQaGradingDatabase(connection),
    (error) =>
      error?.status === 403 &&
      error?.code === "GRADEBOOK_QA_PRODUCTION_FORBIDDEN",
  );

  console.log("PASS - Production-mode write guard rejected");
} catch (error) {
  console.error("FAIL -", error.message);
  process.exitCode = 1;
} finally {
  process.env.NODE_ENV = originalMode;
  connection?.release();
  await db.end();
}
