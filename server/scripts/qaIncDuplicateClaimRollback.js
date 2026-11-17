// PTC Portal — Step 2.8.11K3B2.13D
// Destination: server/scripts/qaIncDuplicateClaimRollback.js
// Run from the server folder: node scripts/qaIncDuplicateClaimRollback.js
// QA ONLY: attempts two synthetic claims in one transaction and ALWAYS rolls back.
// It does not create an audit record, alter a grade, or establish an INC deadline.

import db from "../db.js";

const QA_DB = "databaseforptc1_admission_test";
const GRADE_ID = 122;
const FACULTY_USER_ID = 32;
const QA_DATE = "2026-11-10";
const QA_EVIDENCE =
  "QA ONLY — synthetic evidence for unique-index rollback verification.";

let connection;
let transactionOpen = false;
let failure = null;
let sawExpectedDuplicate = false;

function requireCheck(ok, message) {
  if (!ok) throw new Error(message);
}

async function query(sql, params = []) {
  const [rows] = await connection.execute(sql, params);
  return rows;
}

async function checkProtectedState(stage) {
  const rows = await query(
    `SELECT g.grade_id, g.grade_status, g.grading_outcome, g.final_rating,
            (SELECT COUNT(*) FROM gradebook_inc_completion_claims c
              WHERE c.grade_id = g.grade_id) AS claim_count
       FROM grades g WHERE g.grade_id = ?`,
    [GRADE_ID],
  );
  requireCheck(
    rows.length === 1,
    `${stage}: expected one protected grade, found ${rows.length}.`,
  );
  const row = rows[0];
  const safe =
    row.grade_status === "Approved" &&
    row.grading_outcome === "INCOMPLETE" &&
    Number(row.final_rating) === 4 &&
    Number(row.claim_count) === 0;
  console.log(
    `${stage}:`,
    JSON.stringify({
      grade_id: row.grade_id,
      grade_status: row.grade_status,
      grading_outcome: row.grading_outcome,
      final_rating: String(row.final_rating),
      claim_count: Number(row.claim_count),
    }),
  );
  requireCheck(
    safe,
    `${stage}: protected grade or claim count is not in the expected state. STOP.`,
  );
}

try {
  connection = await db.getConnection();
  const [database] = await query("SELECT DATABASE() AS db_name");
  requireCheck(
    database?.db_name === QA_DB,
    `Wrong database: ${database?.db_name}. STOP.`,
  );

  const indexes = await query(
    `SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'gradebook_inc_completion_claims'
        AND INDEX_NAME = 'uq_inc_claim_grade_id'`,
    [QA_DB],
  );
  requireCheck(
    indexes.length === 1 &&
      Number(indexes[0].NON_UNIQUE) === 0 &&
      indexes[0].COLUMN_NAME === "grade_id",
    "Unique grade index is missing or invalid. STOP.",
  );

  await checkProtectedState("BEFORE_TEST");

  await connection.beginTransaction();
  transactionOpen = true;

  const grades = await query(
    `SELECT grade_id, grade_status, grading_outcome, final_rating
       FROM grades WHERE grade_id = ? FOR UPDATE`,
    [GRADE_ID],
  );
  requireCheck(
    grades.length === 1 &&
      grades[0].grade_status === "Approved" &&
      grades[0].grading_outcome === "INCOMPLETE" &&
      Number(grades[0].final_rating) === 4,
    "Official INC grade changed before test insert. STOP.",
  );

  const [beforeClaims] = await query(
    "SELECT COUNT(*) AS total FROM gradebook_inc_completion_claims WHERE grade_id = ?",
    [GRADE_ID],
  );
  requireCheck(Number(beforeClaims.total) === 0, "Claim already exists. STOP.");

  const insertSql = `INSERT INTO gradebook_inc_completion_claims
      (grade_id, claimed_completed_on, evidence_summary, verification_status,
       submitted_by_user_id, record_version)
      VALUES (?, ?, ?, 'PENDING_VERIFICATION', ?, 1)`;
  const insertParams = [GRADE_ID, QA_DATE, QA_EVIDENCE, FACULTY_USER_ID];

  const firstInsert = await query(insertSql, insertParams);
  requireCheck(
    Number(firstInsert.affectedRows) === 1,
    "First QA insert failed.",
  );
  console.log("FIRST_INSERT: accepted inside uncommitted transaction.");

  try {
    await query(insertSql, insertParams);
    throw new Error(
      "SECURITY TEST FAILED: second claim was allowed for the same grade.",
    );
  } catch (error) {
    if (error?.code !== "ER_DUP_ENTRY" || Number(error?.errno) !== 1062) {
      throw error;
    }
    requireCheck(
      String(error.message).includes("uq_inc_claim_grade_id"),
      `Duplicate rejected by a different constraint: ${error.message}`,
    );
    sawExpectedDuplicate = true;
    console.log(
      "SECOND_INSERT: correctly rejected (ER_DUP_ENTRY 1062, uq_inc_claim_grade_id).",
    );
  }

  const [withinTxn] = await query(
    "SELECT COUNT(*) AS total FROM gradebook_inc_completion_claims WHERE grade_id = ?",
    [GRADE_ID],
  );
  requireCheck(
    Number(withinTxn.total) === 1,
    "Unexpected claim count inside the test transaction.",
  );
} catch (error) {
  failure = error;
  console.error("TEST ERROR:", error?.message ?? error);
} finally {
  if (connection) {
    if (transactionOpen) {
      try {
        await connection.rollback();
        transactionOpen = false;
        console.log("ROLLBACK COMPLETED — no test claim committed.");
      } catch (error) {
        failure ??= error;
        console.error("ROLLBACK ERROR:", error?.message ?? error);
      }
    }
    if (!transactionOpen) {
      try {
        await checkProtectedState("AFTER_ROLLBACK");
      } catch (error) {
        failure ??= error;
        console.error("POST-TEST VERIFICATION ERROR:", error?.message ?? error);
      }
    }
    connection.release();
  }
  try {
    await db.end();
  } catch (error) {
    failure ??= error;
    console.error("POOL SHUTDOWN ERROR:", error?.message ?? error);
  }
}

if (failure || !sawExpectedDuplicate || transactionOpen) {
  console.error("RESULT: FAIL — inspect QA database before continuing.");
  process.exitCode = 1;
} else {
  console.log(
    "RESULT: PASS — unique constraint rejected the duplicate; Grade #122 preserved.",
  );
}
