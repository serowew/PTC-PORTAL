import db from "../db.js";

import {
  getApprovedAcademicHistory,
  getRetakeCandidates,
} from "../services/academicEvaluation.service.js";

async function run() {
  let connection;

  try {
    console.log("======================================");
    console.log("RETAKE SERVICE TRANSACTION TEST");
    console.log("======================================");

    connection = await db.getConnection();

    await connection.beginTransaction();

    // ================================================
    // 1. VERIFY STARTING SUBJECT STATUS
    // ================================================

    const [beforeRows] = await connection.execute(
      `
        SELECT
            enrollment_subject_id,
            subject_id,
            status
        FROM enrollment_subjects
        WHERE enrollment_subject_id = 7
        FOR UPDATE
      `,
    );

    console.log("\nBEFORE:");
    console.log(beforeRows[0]);

    // ================================================
    // 2. CREATE FAILED DRAFT
    //
    // Wrong remarks intentionally supplied.
    // 5.00 must force Failed.
    // ================================================

    await connection.execute(
      `
        INSERT INTO grades (
            enrollment_subject_id,
            faculty_id,
            midterm_grade,
            final_grade,
            final_rating,
            remarks,
            grade_status
        )
        VALUES (
            7,
            1,
            5.00,
            5.00,
            5.00,
            'Passed',
            'Draft'
        )
      `,
    );

    // ================================================
    // 3. SUBMIT
    // ================================================

    await connection.execute(
      `
        UPDATE grades
        SET grade_status = 'Submitted'
        WHERE enrollment_subject_id = 7
      `,
    );

    // ================================================
    // 4. PROGRAM HEAD APPROVES
    //
    // reviewed_by = users.user_id 3
    // ================================================

    await connection.execute(
      `
        UPDATE grades
        SET
            grade_status = 'Approved',
            reviewed_by = 3,
            review_remarks = NULL
        WHERE enrollment_subject_id = 7
      `,
    );

    // ================================================
    // 5. VERIFY DATABASE RESULT
    // ================================================

    const [gradeRows] = await connection.execute(
      `
        SELECT
            grade_id,
            enrollment_subject_id,
            final_rating,
            remarks,
            grade_status,
            reviewed_by
        FROM grades
        WHERE enrollment_subject_id = 7
      `,
    );

    console.log("\nAPPROVED GRADE:");
    console.log(gradeRows[0]);

    const [statusRows] = await connection.execute(
      `
        SELECT
            enrollment_subject_id,
            subject_id,
            status
        FROM enrollment_subjects
        WHERE enrollment_subject_id = 7
      `,
    );

    console.log("\nENROLLMENT SUBJECT AFTER APPROVAL:");
    console.log(statusRows[0]);

    // ================================================
    // 6. TEST SHARED ACADEMIC HISTORY
    // ================================================

    const history = await getApprovedAcademicHistory(119, connection);

    const failedHistory = history.find((item) => item.subject_id === 37);

    console.log("\nACADEMIC HISTORY FOR SUBJECT 37:");
    console.log(failedHistory || null);

    // ================================================
    // 7. TEST RETAKE CANDIDATES
    // ================================================

    const retakes = await getRetakeCandidates(119, 6, connection);

    const subject37Retake = retakes.find((item) => item.subject_id === 37);

    console.log("\nRETAKE CANDIDATE FOR SUBJECT 37:");
    console.log(subject37Retake || null);

    // ================================================
    // 8. ROLLBACK EVERYTHING
    // ================================================

    await connection.rollback();

    // ================================================
    // 9. VERIFY CLEANUP
    // ================================================

    const [cleanupGrades] = await connection.execute(
      `
        SELECT grade_id
        FROM grades
        WHERE enrollment_subject_id = 7
      `,
    );

    const [cleanupSubject] = await connection.execute(
      `
        SELECT
            enrollment_subject_id,
            status
        FROM enrollment_subjects
        WHERE enrollment_subject_id = 7
      `,
    );

    console.log("\nAFTER ROLLBACK:");

    console.log("Grade rows:", cleanupGrades.length);

    console.log("Enrollment subject status:", cleanupSubject[0]?.status);

    console.log("\n======================================");
    console.log("TEST COMPLETE");
    console.log("======================================");
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch {
        // Ignore secondary rollback failure.
      }
    }

    console.error("\nRETAKE SERVICE TEST FAILED:", error);

    process.exitCode = 1;
  } finally {
    if (connection) {
      connection.release();
    }

    await db.end();
  }
}

run();
