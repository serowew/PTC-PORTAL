// routes/registrar/transferEvaluations.js
//
// ============================================================
// PTC PORTAL
// REGISTRAR TRANSFER / TRANSFEREE EVALUATION
// ============================================================
//
// PURPOSE:
//
// Previous-school academic records must remain separate from:
//
// - PTC enrollments
// - PTC enrollment_subjects
// - PTC grades
//
// Flow:
//
// Registrar creates Draft evaluation
//        ↓
// Registrar encodes previous-school subjects
//        ↓
// Subjects are mapped to PTC equivalents
//        ↓
// Academic review
//        ↓
// Evaluation Completed
//        ↓
// Credited subjects may satisfy PTC requirements
//
// IMPORTANT:
//
// - Mounted behind authenticate + requireRole("Registrar")
// - req.user is authoritative
// - Never accept created_by from frontend
// - Never create fake PTC grade rows
// - Every mutation is audited
// ============================================================

import express from "express";
import db from "../../db.js";
import { getOfficialTransferCreditsForStudent } from "../../services/transferCredit.service.js";

const router = express.Router();

// ============================================================
// HELPERS
// ============================================================

function toPositiveInt(value) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    return null;
  }

  return number;
}

function cleanOptionalText(value, maxLength = null) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const clean = value.trim();

  if (!clean) {
    return null;
  }

  if (maxLength !== null && clean.length > maxLength) {
    return null;
  }

  return clean;
}

function getRegistrarActor(req, res) {
  if (!req.user) {
    res.status(401).json({
      success: false,

      code: "AUTHENTICATION_REQUIRED",

      message: "Authentication is required.",
    });

    return null;
  }

  if (req.user.role_name !== "Registrar") {
    res.status(403).json({
      success: false,

      code: "REGISTRAR_ACCESS_REQUIRED",

      message: "Registrar access is required.",
    });

    return null;
  }

  const userId = toPositiveInt(req.user.user_id);

  if (!userId) {
    res.status(401).json({
      success: false,

      code: "INVALID_AUTHENTICATED_USER",

      message: "Authenticated Registrar user ID is invalid.",
    });

    return null;
  }

  return {
    user_id: userId,

    username: req.user.username || null,
  };
}

// ============================================================
// ROUTE 1
// CREATE DRAFT TRANSFER EVALUATION
//
// POST
// /api/registrar/transfer-evaluations
//
// BODY:
//
// {
//   "student_id": 120,
//   "curriculum_id": 6,
//   "source_school": "Previous College",
//   "source_course": "BS Computer Science",
//   "source_student_number": "2024-0001",
//   "transcript_document_id": null,
//   "transcript_reference": "TOR-2026-001",
//   "entry_year_level": 2,
//   "entry_semester_id": 1,
//   "remarks": "Initial transferee evaluation."
// }
//
// IMPORTANT:
//
// evaluation_status is ALWAYS created as Draft.
//
// Frontend may NOT send:
// - created_by
// - submitted_by
// - reviewed_by
// - evaluation_status
//
// Those belong to backend workflow transitions.
// ============================================================

router.post("/", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  // ==========================================================
  // 1. REQUEST BODY
  // ==========================================================

  const {
    student_id,
    curriculum_id,

    source_school,
    source_course,
    source_student_number,

    transcript_document_id,
    transcript_reference,

    entry_year_level,
    entry_semester_id,

    remarks,
  } = req.body || {};

  // ==========================================================
  // 2. REQUIRED IDS
  // ==========================================================

  const studentId = toPositiveInt(student_id);

  const curriculumId = toPositiveInt(curriculum_id);

  if (!studentId) {
    return res.status(400).json({
      success: false,

      code: "INVALID_STUDENT_ID",

      message: "A valid student_id is required.",
    });
  }

  if (!curriculumId) {
    return res.status(400).json({
      success: false,

      code: "INVALID_CURRICULUM_ID",

      message: "A valid curriculum_id is required.",
    });
  }

  // ==========================================================
  // 3. SOURCE SCHOOL
  // ==========================================================

  if (typeof source_school !== "string" || !source_school.trim()) {
    return res.status(400).json({
      success: false,

      code: "SOURCE_SCHOOL_REQUIRED",

      message: "Previous school name is required.",
    });
  }

  const sourceSchool = source_school.trim();

  if (sourceSchool.length > 255) {
    return res.status(400).json({
      success: false,

      code: "SOURCE_SCHOOL_TOO_LONG",

      message: "Previous school name must not exceed 255 characters.",
    });
  }

  // ==========================================================
  // 4. OPTIONAL SOURCE INFORMATION
  // ==========================================================

  let sourceCourse = null;

  if (
    source_course !== undefined &&
    source_course !== null &&
    source_course !== ""
  ) {
    if (typeof source_course !== "string") {
      return res.status(400).json({
        success: false,

        code: "INVALID_SOURCE_COURSE",

        message: "source_course must be a text value.",
      });
    }

    sourceCourse = source_course.trim() || null;

    if (sourceCourse && sourceCourse.length > 255) {
      return res.status(400).json({
        success: false,

        code: "SOURCE_COURSE_TOO_LONG",

        message: "Previous course must not exceed 255 characters.",
      });
    }
  }

  let sourceStudentNumber = null;

  if (
    source_student_number !== undefined &&
    source_student_number !== null &&
    source_student_number !== ""
  ) {
    if (typeof source_student_number !== "string") {
      return res.status(400).json({
        success: false,

        code: "INVALID_SOURCE_STUDENT_NUMBER",

        message: "source_student_number must be a text value.",
      });
    }

    sourceStudentNumber = source_student_number.trim() || null;

    if (sourceStudentNumber && sourceStudentNumber.length > 100) {
      return res.status(400).json({
        success: false,

        code: "SOURCE_STUDENT_NUMBER_TOO_LONG",

        message: "Previous student number must not exceed 100 characters.",
      });
    }
  }

  // ==========================================================
  // 5. OPTIONAL TRANSCRIPT DOCUMENT
  // ==========================================================

  let transcriptDocumentId = null;

  if (
    transcript_document_id !== undefined &&
    transcript_document_id !== null &&
    transcript_document_id !== ""
  ) {
    transcriptDocumentId = toPositiveInt(transcript_document_id);

    if (!transcriptDocumentId) {
      return res.status(400).json({
        success: false,

        code: "INVALID_TRANSCRIPT_DOCUMENT_ID",

        message: "transcript_document_id must be a valid positive integer.",
      });
    }
  }

  // ==========================================================
  // 6. OPTIONAL TRANSCRIPT REFERENCE
  // ==========================================================

  let transcriptReference = null;

  if (
    transcript_reference !== undefined &&
    transcript_reference !== null &&
    transcript_reference !== ""
  ) {
    if (typeof transcript_reference !== "string") {
      return res.status(400).json({
        success: false,

        code: "INVALID_TRANSCRIPT_REFERENCE",

        message: "transcript_reference must be a text value.",
      });
    }

    transcriptReference = transcript_reference.trim() || null;

    if (transcriptReference && transcriptReference.length > 100) {
      return res.status(400).json({
        success: false,

        code: "TRANSCRIPT_REFERENCE_TOO_LONG",

        message: "Transcript reference must not exceed 100 characters.",
      });
    }
  }

  // ==========================================================
  // 7. ENTRY YEAR LEVEL
  // ==========================================================

  let entryYearLevel = null;

  if (
    entry_year_level !== undefined &&
    entry_year_level !== null &&
    entry_year_level !== ""
  ) {
    entryYearLevel = toPositiveInt(entry_year_level);

    if (!entryYearLevel) {
      return res.status(400).json({
        success: false,

        code: "INVALID_ENTRY_YEAR_LEVEL",

        message: "entry_year_level must be a valid positive integer.",
      });
    }
  }

  // ==========================================================
  // 8. ENTRY SEMESTER
  //
  // Normal PTC enrollment supports:
  //
  // 1 = First Semester
  // 2 = Second Semester
  //
  // Summer is not part of normal progression.
  // ==========================================================

  let entrySemesterId = null;

  if (
    entry_semester_id !== undefined &&
    entry_semester_id !== null &&
    entry_semester_id !== ""
  ) {
    entrySemesterId = toPositiveInt(entry_semester_id);

    if (!entrySemesterId || ![1, 2].includes(entrySemesterId)) {
      return res.status(400).json({
        success: false,

        code: "INVALID_ENTRY_SEMESTER",

        message:
          "entry_semester_id must be 1 (First Semester) or 2 (Second Semester).",

        allowed_semester_ids: [1, 2],
      });
    }
  }

  // ==========================================================
  // 9. REMARKS
  // ==========================================================

  let cleanRemarks = null;

  if (remarks !== undefined && remarks !== null && remarks !== "") {
    if (typeof remarks !== "string") {
      return res.status(400).json({
        success: false,

        code: "INVALID_REMARKS",

        message: "remarks must be a text value.",
      });
    }

    cleanRemarks = remarks.trim() || null;

    if (cleanRemarks && cleanRemarks.length > 500) {
      return res.status(400).json({
        success: false,

        code: "REMARKS_TOO_LONG",

        message: "Remarks must not exceed 500 characters.",
      });
    }
  }

  let connection;

  let transactionActive = false;

  try {
    // ========================================================
    // 10. START TRANSACTION
    // ========================================================

    connection = await db.getConnection();

    await connection.beginTransaction();

    transactionActive = true;

    // ========================================================
    // 11. LOCK STUDENT
    // ========================================================

    const [studentRows] = await connection.execute(
      `
          SELECT
              s.student_id,
              s.user_id,
              s.student_number,

              s.first_name,
              s.middle_name,
              s.last_name,

              s.course_id,
              s.year_level,

              c.course_code,
              c.course_name,
              c.total_years

          FROM students s

          LEFT JOIN courses c
              ON c.course_id =
                 s.course_id

          WHERE s.student_id = ?

          LIMIT 1

          FOR UPDATE
        `,
      [studentId],
    );

    if (studentRows.length === 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(404).json({
        success: false,

        code: "STUDENT_NOT_FOUND",

        message: "Student not found.",
      });
    }

    const student = studentRows[0];

    const studentCourseId =
      student.course_id !== null ? Number(student.course_id) : null;

    // ========================================================
    // STUDENT MUST HAVE COURSE
    // ========================================================

    if (!studentCourseId) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "STUDENT_COURSE_REQUIRED",

        message:
          "The student must have a valid PTC course before transfer credits can be evaluated.",
      });
    }

    // ========================================================
    // ENTRY YEAR MUST FIT COURSE
    // ========================================================

    const courseTotalYears =
      student.total_years !== null ? Number(student.total_years) : null;

    if (
      entryYearLevel !== null &&
      courseTotalYears !== null &&
      entryYearLevel > courseTotalYears
    ) {
      await connection.rollback();

      transactionActive = false;

      return res.status(400).json({
        success: false,

        code: "ENTRY_YEAR_EXCEEDS_COURSE",

        message: `Entry year level ${entryYearLevel} exceeds the ${courseTotalYears}-year duration of ${student.course_code || "the student's course"}.`,

        course: {
          course_id: studentCourseId,

          course_code: student.course_code || null,

          total_years: courseTotalYears,
        },
      });
    }

    // ========================================================
    // 12. ACTIVE STUDENT CURRICULUM
    //
    // The evaluation MUST use the student's actual active
    // assigned curriculum.
    //
    // We do NOT allow a random curriculum_id from frontend.
    // ========================================================

    const [curriculumRows] = await connection.execute(
      `
          SELECT
              sc.student_curriculum_id,
              sc.student_id,
              sc.curriculum_id,

              sc.assigned_date,
              sc.status
                  AS assignment_status,

              sc.remarks
                  AS assignment_remarks,

              cur.course_id
                  AS curriculum_course_id,

              cur.curriculum_name,
              cur.effective_year,
              cur.total_units,
              cur.is_active,

              c.course_code,
              c.course_name

          FROM student_curriculum sc

          INNER JOIN curriculum cur
              ON cur.curriculum_id =
                 sc.curriculum_id

          INNER JOIN courses c
              ON c.course_id =
                 cur.course_id

          WHERE sc.student_id = ?

            AND sc.curriculum_id = ?

            AND sc.status = 'Active'

            AND cur.is_active = 1

          LIMIT 1

          FOR UPDATE
        `,
      [studentId, curriculumId],
    );

    if (curriculumRows.length === 0) {
      // ----------------------------------------------
      // Find whether another active curriculum exists
      // so the API can explain the actual problem.
      // ----------------------------------------------

      const [actualRows] = await connection.execute(
        `
            SELECT
                sc.student_curriculum_id,
                sc.curriculum_id,
                sc.status,

                cur.course_id,
                cur.curriculum_name,
                cur.is_active

            FROM student_curriculum sc

            LEFT JOIN curriculum cur
                ON cur.curriculum_id =
                   sc.curriculum_id

            WHERE sc.student_id = ?

            ORDER BY
                CASE
                    WHEN sc.status = 'Active'
                    THEN 0
                    ELSE 1
                END,

                sc.student_curriculum_id DESC
          `,
        [studentId],
      );

      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "ACTIVE_CURRICULUM_MISMATCH",

        message:
          "The selected curriculum is not the student's active PTC curriculum.",

        requested_curriculum_id: curriculumId,

        student_curriculum_records: actualRows.map((row) => ({
          student_curriculum_id: Number(row.student_curriculum_id),

          curriculum_id: Number(row.curriculum_id),

          curriculum_name: row.curriculum_name || null,

          course_id: row.course_id !== null ? Number(row.course_id) : null,

          assignment_status: row.status,

          curriculum_is_active: Number(row.is_active) === 1,
        })),
      });
    }

    const curriculum = curriculumRows[0];

    // ========================================================
    // CURRICULUM COURSE MUST MATCH STUDENT COURSE
    // ========================================================

    const curriculumCourseId = Number(curriculum.curriculum_course_id);

    if (curriculumCourseId !== studentCourseId) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "COURSE_CURRICULUM_MISMATCH",

        message:
          "The student's active curriculum belongs to a different course. Correct the student/course/curriculum assignment before evaluating transfer credits.",

        student: {
          student_id: studentId,

          student_number: student.student_number,

          course_id: studentCourseId,

          course_code: student.course_code || null,

          course_name: student.course_name || null,
        },

        curriculum: {
          curriculum_id: curriculumId,

          curriculum_name: curriculum.curriculum_name,

          course_id: curriculumCourseId,

          course_code: curriculum.course_code,

          course_name: curriculum.course_name,
        },
      });
    }

    // ========================================================
    // 13. OPTIONAL TRANSCRIPT DOCUMENT
    //
    // If supplied, it must belong to THIS student.
    //
    // Draft creation does not require Verified status yet.
    // We can require verification before submission later.
    // ========================================================

    let transcriptDocument = null;

    if (transcriptDocumentId !== null) {
      const [documentRows] = await connection.execute(
        `
            SELECT
                document_id,
                student_id,

                document_type,
                file_name,

                verification_status,
                verified_by,
                verified_at,

                uploaded_at

            FROM student_documents

            WHERE document_id = ?

            LIMIT 1

            FOR UPDATE
          `,
        [transcriptDocumentId],
      );

      if (documentRows.length === 0) {
        await connection.rollback();

        transactionActive = false;

        return res.status(404).json({
          success: false,

          code: "TRANSCRIPT_DOCUMENT_NOT_FOUND",

          message: "The selected transcript document was not found.",
        });
      }

      transcriptDocument = documentRows[0];

      if (Number(transcriptDocument.student_id) !== studentId) {
        await connection.rollback();

        transactionActive = false;

        return res.status(409).json({
          success: false,

          code: "TRANSCRIPT_STUDENT_MISMATCH",

          message:
            "The selected transcript document belongs to a different student.",
        });
      }
    }

    // ========================================================
    // 14. DUPLICATE ACTIVE EVALUATION CHECK
    //
    // Avoid accidentally creating multiple live evaluations
    // for the same:
    //
    // student
    // + curriculum
    // + previous school
    //
    // Cancelled records are historical and do not block.
    // ========================================================

    const [duplicateRows] = await connection.execute(
      `
          SELECT
              transfer_evaluation_id,

              student_id,
              curriculum_id,

              source_school,

              evaluation_status,

              created_by,
              created_at,
              updated_at

          FROM student_transfer_evaluations

          WHERE student_id = ?

            AND curriculum_id = ?

            AND LOWER(
                  TRIM(source_school)
                ) =
                LOWER(
                  TRIM(?)
                )

            AND evaluation_status
                <> 'Cancelled'

          ORDER BY
              transfer_evaluation_id DESC

          LIMIT 1

          FOR UPDATE
        `,
      [studentId, curriculumId, sourceSchool],
    );

    if (duplicateRows.length > 0) {
      const duplicate = duplicateRows[0];

      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "TRANSFER_EVALUATION_ALREADY_EXISTS",

        message:
          "A non-cancelled transfer evaluation already exists for this student, curriculum, and previous school.",

        existing_evaluation: {
          transfer_evaluation_id: Number(duplicate.transfer_evaluation_id),

          evaluation_status: duplicate.evaluation_status,

          source_school: duplicate.source_school,

          created_at: duplicate.created_at,

          updated_at: duplicate.updated_at,
        },
      });
    }

    // ========================================================
    // 15. INSERT DRAFT EVALUATION
    //
    // Backend controls:
    //
    // evaluation_status = Draft
    // created_by        = authenticated Registrar
    //
    // No submitted/review fields yet.
    // ========================================================

    const [insertResult] = await connection.execute(
      `
          INSERT INTO student_transfer_evaluations (
              student_id,
              curriculum_id,

              source_school,
              source_course,
              source_student_number,

              transcript_document_id,
              transcript_reference,

              entry_year_level,
              entry_semester_id,

              evaluation_status,

              created_by,

              submitted_by,
              submitted_at,

              reviewed_by,
              reviewed_at,
              review_remarks,

              remarks
          )

          VALUES (
              ?,
              ?,

              ?,
              ?,
              ?,

              ?,
              ?,

              ?,
              ?,

              'Draft',

              ?,

              NULL,
              NULL,

              NULL,
              NULL,
              NULL,

              ?
          )
        `,
      [
        studentId,
        curriculumId,

        sourceSchool,
        sourceCourse,
        sourceStudentNumber,

        transcriptDocumentId,
        transcriptReference,

        entryYearLevel,
        entrySemesterId,

        Number(actor.user_id),

        cleanRemarks,
      ],
    );

    const transferEvaluationId = Number(insertResult.insertId);

    if (!transferEvaluationId) {
      throw new Error("Transfer evaluation was inserted without a valid ID.");
    }

    // ========================================================
    // 16. AUDIT
    //
    // Existing audit_trail is append-only history for
    // backend mutations.
    // ========================================================

    const auditNewValues = {
      transfer_evaluation_id: transferEvaluationId,

      student_id: studentId,

      curriculum_id: curriculumId,

      source_school: sourceSchool,

      source_course: sourceCourse,

      source_student_number: sourceStudentNumber,

      transcript_document_id: transcriptDocumentId,

      transcript_reference: transcriptReference,

      entry_year_level: entryYearLevel,

      entry_semester_id: entrySemesterId,

      evaluation_status: "Draft",

      created_by: Number(actor.user_id),

      remarks: cleanRemarks,
    };

    await connection.execute(
      `
        INSERT INTO audit_trail (
            user_id,
            table_name,
            record_id,
            action,
            old_values,
            new_values
        )

        VALUES (
            ?,
            'student_transfer_evaluations',
            ?,
            'INSERT',
            NULL,
            ?
        )
      `,
      [
        Number(actor.user_id),

        transferEvaluationId,

        JSON.stringify(auditNewValues),
      ],
    );

    // ========================================================
    // 17. GET CREATED RECORD
    // ========================================================

    const [createdRows] = await connection.execute(
      `
          SELECT
              ste.transfer_evaluation_id,

              ste.student_id,
              ste.curriculum_id,

              ste.source_school,
              ste.source_course,
              ste.source_student_number,

              ste.transcript_document_id,
              ste.transcript_reference,

              ste.entry_year_level,
              ste.entry_semester_id,

              sem.semester_name
                  AS entry_semester_name,

              ste.evaluation_status,

              ste.created_by,

              creator.username
                  AS created_by_username,

              ste.submitted_by,
              ste.submitted_at,

              ste.reviewed_by,
              ste.reviewed_at,
              ste.review_remarks,

              ste.remarks,

              ste.created_at,
              ste.updated_at

          FROM student_transfer_evaluations ste

          LEFT JOIN semesters sem
              ON sem.semester_id =
                 ste.entry_semester_id

          LEFT JOIN users creator
              ON creator.user_id =
                 ste.created_by

          WHERE ste.transfer_evaluation_id = ?

          LIMIT 1
        `,
      [transferEvaluationId],
    );

    if (createdRows.length === 0) {
      throw new Error("Created transfer evaluation could not be retrieved.");
    }

    const created = createdRows[0];

    // ========================================================
    // 18. COMMIT
    // ========================================================

    await connection.commit();

    transactionActive = false;

    // ========================================================
    // 19. SUCCESS
    // ========================================================

    return res.status(201).json({
      success: true,

      code: "TRANSFER_EVALUATION_CREATED",

      message: "Draft transfer evaluation created successfully.",

      evaluation: {
        transfer_evaluation_id: Number(created.transfer_evaluation_id),

        evaluation_status: created.evaluation_status,

        student: {
          student_id: studentId,

          student_number: student.student_number,

          student_name: [
            student.first_name,
            student.middle_name,
            student.last_name,
          ]
            .filter(Boolean)
            .join(" "),

          current_year_level:
            student.year_level !== null ? Number(student.year_level) : null,

          course: {
            course_id: studentCourseId,

            course_code: student.course_code || null,

            course_name: student.course_name || null,

            total_years: courseTotalYears,
          },
        },

        curriculum: {
          student_curriculum_id: Number(curriculum.student_curriculum_id),

          curriculum_id: curriculumId,

          curriculum_name: curriculum.curriculum_name,

          effective_year:
            curriculum.effective_year !== null
              ? Number(curriculum.effective_year)
              : null,

          course_id: curriculumCourseId,

          course_code: curriculum.course_code,

          course_name: curriculum.course_name,
        },

        source: {
          school: created.source_school,

          course: created.source_course || null,

          student_number: created.source_student_number || null,

          transcript_reference: created.transcript_reference || null,

          transcript_document: transcriptDocument
            ? {
                document_id: Number(transcriptDocument.document_id),

                document_type: transcriptDocument.document_type || null,

                file_name: transcriptDocument.file_name || null,

                verification_status: transcriptDocument.verification_status,
              }
            : null,
        },

        ptc_entry: {
          year_level:
            created.entry_year_level !== null
              ? Number(created.entry_year_level)
              : null,

          semester_id:
            created.entry_semester_id !== null
              ? Number(created.entry_semester_id)
              : null,

          semester_name: created.entry_semester_name || null,
        },

        workflow: {
          status: created.evaluation_status,

          created_by:
            created.created_by !== null ? Number(created.created_by) : null,

          created_by_username: created.created_by_username || actor.username,

          submitted_by: null,

          submitted_at: null,

          reviewed_by: null,

          reviewed_at: null,

          review_remarks: null,
        },

        remarks: created.remarks || null,

        created_at: created.created_at,

        updated_at: created.updated_at,
      },

      summary: {
        transfer_subjects: 0,

        credited_subjects: 0,

        not_credited_subjects: 0,

        pending_subjects: 0,

        official_transfer_credits: 0,
      },

      academic_effect: {
        changes_ptc_grades: false,

        changes_current_enrollment: false,

        satisfies_curriculum_requirements: false,

        reason:
          "A Draft transfer evaluation has no official academic effect until the evaluation is completed and individual subjects are credited.",
      },

      next_action:
        "Registrar may now encode previous-school subjects into this Draft evaluation.",

      actor: {
        user_id: Number(actor.user_id),

        username: actor.username,
      },
    });
  } catch (error) {
    // ========================================================
    // ROLLBACK
    // ========================================================

    if (connection && transactionActive) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "CREATE TRANSFER EVALUATION ROLLBACK ERROR:",
          rollbackError,
        );
      }
    }

    console.error("CREATE TRANSFER EVALUATION ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "TRANSFER_EVALUATION_CREATE_FAILED",

      message: "Failed to create transfer evaluation.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// ============================================================
// ROUTE 2
// ADD PREVIOUS-SCHOOL SUBJECT TO TRANSFER EVALUATION
//
// POST
// /api/registrar/transfer-evaluations/:id/subjects
//
// BODY:
//
// {
//   "source_subject_code": "CS101",
//   "source_subject_name": "Introduction to Computing",
//   "source_units": 3,
//   "source_grade": "1.75",
//   "source_remarks": "Passed",
//   "source_academic_year": "2025-2026",
//   "source_year_level": 1,
//   "source_semester": "First Semester"
// }
//
// IMPORTANT:
//
// This route records RAW previous-school transcript data.
//
// It DOES NOT:
// - create a PTC grade
// - map to a PTC subject
// - grant credit
// - satisfy a curriculum requirement
//
// Mapping and credit decision happen in later routes.
// ============================================================

router.post("/:id/subjects", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  // ==========================================================
  // 1. TRANSFER EVALUATION ID
  // ==========================================================

  const transferEvaluationId = toPositiveInt(req.params.id);

  if (!transferEvaluationId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_TRANSFER_EVALUATION_ID",
      message: "A valid transfer evaluation ID is required.",
    });
  }

  // ==========================================================
  // 2. BODY
  // ==========================================================

  const body = req.body || {};

  const {
    source_subject_code,
    source_subject_name,
    source_units,
    source_grade,
    source_remarks,
    source_academic_year,
    source_year_level,
    source_semester,
  } = body;

  // ==========================================================
  // 3. DO NOT ALLOW EQUIVALENCY / REVIEW FIELDS HERE
  //
  // This route is RAW transcript encoding only.
  // ==========================================================

  const forbiddenFields = [
    "ptc_subject_id",
    "credited_units",
    "credit_status",
    "decision_reason",
    "reviewed_by",
    "reviewed_at",
  ];

  const suppliedForbiddenFields = forbiddenFields.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  );

  if (suppliedForbiddenFields.length > 0) {
    return res.status(400).json({
      success: false,
      code: "TRANSFER_SUBJECT_WORKFLOW_FIELDS_NOT_ALLOWED",
      message:
        "PTC mapping, credit decisions, and review fields cannot be supplied while encoding a raw previous-school subject.",
      forbidden_fields: suppliedForbiddenFields,
    });
  }

  // ==========================================================
  // 4. SOURCE SUBJECT NAME
  // ==========================================================

  if (typeof source_subject_name !== "string" || !source_subject_name.trim()) {
    return res.status(400).json({
      success: false,
      code: "SOURCE_SUBJECT_NAME_REQUIRED",
      message: "Previous-school subject name is required.",
    });
  }

  const sourceSubjectName = source_subject_name.trim();

  if (sourceSubjectName.length > 255) {
    return res.status(400).json({
      success: false,
      code: "SOURCE_SUBJECT_NAME_TOO_LONG",
      message: "Previous-school subject name must not exceed 255 characters.",
    });
  }

  // ==========================================================
  // 5. SOURCE SUBJECT CODE
  // ==========================================================

  let sourceSubjectCode = null;

  if (
    source_subject_code !== undefined &&
    source_subject_code !== null &&
    source_subject_code !== ""
  ) {
    if (typeof source_subject_code !== "string") {
      return res.status(400).json({
        success: false,
        code: "INVALID_SOURCE_SUBJECT_CODE",
        message: "source_subject_code must be a text value.",
      });
    }

    sourceSubjectCode = source_subject_code.trim() || null;

    if (sourceSubjectCode && sourceSubjectCode.length > 100) {
      return res.status(400).json({
        success: false,
        code: "SOURCE_SUBJECT_CODE_TOO_LONG",
        message: "Previous-school subject code must not exceed 100 characters.",
      });
    }
  }

  // ==========================================================
  // 6. SOURCE UNITS
  //
  // Preserve external-school units.
  //
  // 0 is allowed because some institutions may have
  // non-credit / zero-unit transcript entries.
  // ==========================================================

  let sourceUnits = null;

  if (
    source_units !== undefined &&
    source_units !== null &&
    source_units !== ""
  ) {
    sourceUnits = Number(source_units);

    if (
      !Number.isFinite(sourceUnits) ||
      sourceUnits < 0 ||
      sourceUnits > 9999.99
    ) {
      return res.status(400).json({
        success: false,
        code: "INVALID_SOURCE_UNITS",
        message: "source_units must be a valid non-negative number.",
      });
    }

    sourceUnits = Math.round(sourceUnits * 100) / 100;
  }

  // ==========================================================
  // 7. ORIGINAL SOURCE GRADE
  //
  // VARCHAR intentionally.
  //
  // Examples:
  // 1.75
  // 88
  // A
  // B+
  // P
  // INC
  //
  // Require text so formatting is preserved as closely
  // as possible.
  // ==========================================================

  let sourceGrade = null;

  if (
    source_grade !== undefined &&
    source_grade !== null &&
    source_grade !== ""
  ) {
    if (typeof source_grade !== "string") {
      return res.status(400).json({
        success: false,
        code: "INVALID_SOURCE_GRADE",
        message:
          "source_grade must be sent as text so the original external grade can be preserved.",
      });
    }

    sourceGrade = source_grade.trim() || null;

    if (sourceGrade && sourceGrade.length > 50) {
      return res.status(400).json({
        success: false,
        code: "SOURCE_GRADE_TOO_LONG",
        message: "Previous-school grade must not exceed 50 characters.",
      });
    }
  }

  // ==========================================================
  // 8. SOURCE REMARKS
  // ==========================================================

  let sourceRemarks = null;

  if (
    source_remarks !== undefined &&
    source_remarks !== null &&
    source_remarks !== ""
  ) {
    if (typeof source_remarks !== "string") {
      return res.status(400).json({
        success: false,
        code: "INVALID_SOURCE_REMARKS",
        message: "source_remarks must be a text value.",
      });
    }

    sourceRemarks = source_remarks.trim() || null;

    if (sourceRemarks && sourceRemarks.length > 255) {
      return res.status(400).json({
        success: false,
        code: "SOURCE_REMARKS_TOO_LONG",
        message: "Previous-school remarks must not exceed 255 characters.",
      });
    }
  }

  // ==========================================================
  // 9. SOURCE ACADEMIC YEAR
  // ==========================================================

  let sourceAcademicYear = null;

  if (
    source_academic_year !== undefined &&
    source_academic_year !== null &&
    source_academic_year !== ""
  ) {
    if (typeof source_academic_year !== "string") {
      return res.status(400).json({
        success: false,
        code: "INVALID_SOURCE_ACADEMIC_YEAR",
        message: "source_academic_year must be a text value.",
      });
    }

    sourceAcademicYear = source_academic_year.trim() || null;

    if (sourceAcademicYear && sourceAcademicYear.length > 50) {
      return res.status(400).json({
        success: false,
        code: "SOURCE_ACADEMIC_YEAR_TOO_LONG",
        message: "Previous-school academic year must not exceed 50 characters.",
      });
    }
  }

  // ==========================================================
  // 10. SOURCE YEAR LEVEL
  // ==========================================================

  let sourceYearLevel = null;

  if (
    source_year_level !== undefined &&
    source_year_level !== null &&
    source_year_level !== ""
  ) {
    sourceYearLevel = toPositiveInt(source_year_level);

    if (!sourceYearLevel) {
      return res.status(400).json({
        success: false,
        code: "INVALID_SOURCE_YEAR_LEVEL",
        message: "source_year_level must be a valid positive integer.",
      });
    }

    if (sourceYearLevel > 20) {
      return res.status(400).json({
        success: false,
        code: "SOURCE_YEAR_LEVEL_TOO_HIGH",
        message: "source_year_level is outside the supported range.",
      });
    }
  }

  // ==========================================================
  // 11. SOURCE SEMESTER
  //
  // External semester is TEXT because another school may use:
  //
  // First Semester
  // Second Semester
  // Trimester 1
  // Summer
  // Quarter 2
  // ==========================================================

  let sourceSemester = null;

  if (
    source_semester !== undefined &&
    source_semester !== null &&
    source_semester !== ""
  ) {
    if (typeof source_semester !== "string") {
      return res.status(400).json({
        success: false,
        code: "INVALID_SOURCE_SEMESTER",
        message: "source_semester must be a text value.",
      });
    }

    sourceSemester = source_semester.trim() || null;

    if (sourceSemester && sourceSemester.length > 100) {
      return res.status(400).json({
        success: false,
        code: "SOURCE_SEMESTER_TOO_LONG",
        message: "Previous-school semester must not exceed 100 characters.",
      });
    }
  }

  // ==========================================================
  // 12. TRANSACTION
  // ==========================================================

  let connection;
  let transactionActive = false;

  try {
    connection = await db.getConnection();

    await connection.beginTransaction();

    transactionActive = true;

    // ========================================================
    // 13. LOCK TRANSFER EVALUATION
    // ========================================================

    const [evaluationRows] = await connection.execute(
      `
          SELECT
              ste.transfer_evaluation_id,
              ste.student_id,
              ste.curriculum_id,

              ste.source_school,
              ste.evaluation_status,

              ste.created_by,
              ste.submitted_by,
              ste.reviewed_by,

              s.student_number,
              s.first_name,
              s.middle_name,
              s.last_name,

              cur.curriculum_name

          FROM student_transfer_evaluations ste

          INNER JOIN students s
              ON s.student_id =
                 ste.student_id

          INNER JOIN curriculum cur
              ON cur.curriculum_id =
                 ste.curriculum_id

          WHERE ste.transfer_evaluation_id = ?

          LIMIT 1

          FOR UPDATE
        `,
      [transferEvaluationId],
    );

    if (evaluationRows.length === 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(404).json({
        success: false,
        code: "TRANSFER_EVALUATION_NOT_FOUND",
        message: "Transfer evaluation not found.",
      });
    }

    const evaluation = evaluationRows[0];

    const evaluationStatus = String(evaluation.evaluation_status || "").trim();

    // ========================================================
    // 14. EDITABLE WORKFLOW STATES
    //
    // Draft:
    // Initial Registrar encoding.
    //
    // Returned:
    // Academic reviewer sent evaluation back for correction.
    //
    // Submitted / Completed / Cancelled:
    // Raw transcript rows are locked.
    // ========================================================

    if (!["Draft", "Returned"].includes(evaluationStatus)) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,
        code: "TRANSFER_EVALUATION_NOT_EDITABLE",
        message: `Previous-school subjects cannot be added while the transfer evaluation status is "${evaluationStatus}".`,

        evaluation_status: evaluationStatus,

        editable_statuses: ["Draft", "Returned"],
      });
    }

    // ========================================================
    // 15. INSERT RAW TRANSFER SUBJECT
    //
    // PTC equivalency fields are intentionally NULL/Pending.
    // ========================================================

    const [insertResult] = await connection.execute(
      `
          INSERT INTO student_transfer_subjects (
              transfer_evaluation_id,

              source_subject_code,
              source_subject_name,
              source_units,
              source_grade,
              source_remarks,

              source_academic_year,
              source_year_level,
              source_semester,

              ptc_subject_id,
              credited_units,
              credit_status,
              decision_reason,

              reviewed_by,
              reviewed_at
          )

          VALUES (
              ?,

              ?,
              ?,
              ?,
              ?,
              ?,

              ?,
              ?,
              ?,

              NULL,
              NULL,
              'Pending',
              NULL,

              NULL,
              NULL
          )
        `,
      [
        transferEvaluationId,

        sourceSubjectCode,
        sourceSubjectName,
        sourceUnits,
        sourceGrade,
        sourceRemarks,

        sourceAcademicYear,
        sourceYearLevel,
        sourceSemester,
      ],
    );

    const transferSubjectId = Number(insertResult.insertId);

    if (!transferSubjectId) {
      throw new Error("Transfer subject was inserted without a valid ID.");
    }

    // ========================================================
    // 16. AUDIT RAW TRANSCRIPT INSERT
    // ========================================================

    const auditNewValues = {
      transfer_subject_id: transferSubjectId,

      transfer_evaluation_id: transferEvaluationId,

      source_subject_code: sourceSubjectCode,

      source_subject_name: sourceSubjectName,

      source_units: sourceUnits,

      source_grade: sourceGrade,

      source_remarks: sourceRemarks,

      source_academic_year: sourceAcademicYear,

      source_year_level: sourceYearLevel,

      source_semester: sourceSemester,

      ptc_subject_id: null,

      credited_units: null,

      credit_status: "Pending",

      decision_reason: null,

      reviewed_by: null,

      reviewed_at: null,
    };

    await connection.execute(
      `
        INSERT INTO audit_trail (
            user_id,
            table_name,
            record_id,
            action,
            old_values,
            new_values
        )

        VALUES (
            ?,
            'student_transfer_subjects',
            ?,
            'INSERT',
            NULL,
            ?
        )
      `,
      [
        Number(actor.user_id),

        transferSubjectId,

        JSON.stringify(auditNewValues),
      ],
    );

    // ========================================================
    // 17. GET CREATED SUBJECT
    // ========================================================

    const [createdRows] = await connection.execute(
      `
          SELECT
              transfer_subject_id,
              transfer_evaluation_id,

              source_subject_code,
              source_subject_name,
              source_units,
              source_grade,
              source_remarks,

              source_academic_year,
              source_year_level,
              source_semester,

              ptc_subject_id,
              credited_units,
              credit_status,
              decision_reason,

              reviewed_by,
              reviewed_at,

              created_at,
              updated_at

          FROM student_transfer_subjects

          WHERE transfer_subject_id = ?

          LIMIT 1
        `,
      [transferSubjectId],
    );

    if (createdRows.length === 0) {
      throw new Error("Created transfer subject could not be retrieved.");
    }

    const created = createdRows[0];

    // ========================================================
    // 18. SUMMARY
    // ========================================================

    const [summaryRows] = await connection.execute(
      `
          SELECT
              COUNT(*)
                  AS total_subjects,

              SUM(
                  credit_status = 'Pending'
              )
                  AS pending_subjects,

              SUM(
                  credit_status = 'Credited'
              )
                  AS credited_subjects,

              SUM(
                  credit_status = 'Not Credited'
              )
                  AS not_credited_subjects

          FROM student_transfer_subjects

          WHERE transfer_evaluation_id = ?
        `,
      [transferEvaluationId],
    );

    const summary = summaryRows[0] || {};

    // ========================================================
    // 19. COMMIT
    // ========================================================

    await connection.commit();

    transactionActive = false;

    // ========================================================
    // 20. RESPONSE
    // ========================================================

    return res.status(201).json({
      success: true,

      code: "TRANSFER_SUBJECT_CREATED",

      message:
        "Previous-school subject added to the transfer evaluation successfully.",

      evaluation: {
        transfer_evaluation_id: transferEvaluationId,

        evaluation_status: evaluationStatus,

        student_id: Number(evaluation.student_id),

        student_number: evaluation.student_number,

        student_name: [
          evaluation.first_name,
          evaluation.middle_name,
          evaluation.last_name,
        ]
          .filter(Boolean)
          .join(" "),

        curriculum_id: Number(evaluation.curriculum_id),

        curriculum_name: evaluation.curriculum_name,

        source_school: evaluation.source_school,
      },

      transfer_subject: {
        transfer_subject_id: Number(created.transfer_subject_id),

        transfer_evaluation_id: Number(created.transfer_evaluation_id),

        source: {
          subject_code: created.source_subject_code || null,

          subject_name: created.source_subject_name,

          units:
            created.source_units !== null ? Number(created.source_units) : null,

          grade: created.source_grade || null,

          remarks: created.source_remarks || null,

          academic_year: created.source_academic_year || null,

          year_level:
            created.source_year_level !== null
              ? Number(created.source_year_level)
              : null,

          semester: created.source_semester || null,
        },

        ptc_equivalency: {
          subject_id: null,
          credited_units: null,
          credit_status: created.credit_status,
          decision_reason: null,
        },

        review: {
          reviewed_by: null,
          reviewed_at: null,
        },

        created_at: created.created_at,

        updated_at: created.updated_at,
      },

      summary: {
        total_subjects: Number(summary.total_subjects || 0),

        pending_subjects: Number(summary.pending_subjects || 0),

        credited_subjects: Number(summary.credited_subjects || 0),

        not_credited_subjects: Number(summary.not_credited_subjects || 0),

        official_transfer_credits: 0,
      },

      academic_effect: {
        changes_ptc_grades: false,

        changes_current_enrollment: false,

        satisfies_curriculum_requirements: false,

        mapped_to_ptc_subject: false,

        official_transfer_credit: false,

        reason:
          "This row stores raw previous-school transcript data only. It has not yet been mapped or credited.",
      },

      next_action:
        "Registrar may encode additional previous-school subjects or proceed to PTC subject equivalency mapping.",

      actor: {
        user_id: Number(actor.user_id),

        username: actor.username,
      },
    });
  } catch (error) {
    if (connection && transactionActive) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("CREATE TRANSFER SUBJECT ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("CREATE TRANSFER SUBJECT ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "TRANSFER_SUBJECT_CREATE_FAILED",

      message:
        "Failed to add previous-school subject to the transfer evaluation.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// ============================================================
// ROUTE 3
// EDIT RAW PREVIOUS-SCHOOL SUBJECT
//
// PATCH
// /api/registrar/transfer-evaluations/:id/subjects/:transferSubjectId
//
// PURPOSE:
//
// Correct raw transcript information such as:
//
// - source subject code
// - source subject name
// - source units
// - source grade
// - source remarks
// - source academic year
// - source year level
// - source semester
//
// IMPORTANT:
//
// This route DOES NOT:
// - map a subject to PTC
// - make a credit decision
// - approve transfer credit
// - create/edit PTC grades
// - modify current enrollment
//
// Editable only while evaluation is:
// - Draft
// - Returned
// ============================================================

router.patch("/:id/subjects/:transferSubjectId", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  // ========================================================
  // 1. IDS
  // ========================================================

  const transferEvaluationId = toPositiveInt(req.params.id);

  const transferSubjectId = toPositiveInt(req.params.transferSubjectId);

  if (!transferEvaluationId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_TRANSFER_EVALUATION_ID",
      message: "A valid transfer evaluation ID is required.",
    });
  }

  if (!transferSubjectId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_TRANSFER_SUBJECT_ID",
      message: "A valid transfer subject ID is required.",
    });
  }

  // ========================================================
  // 2. BODY
  // ========================================================

  const body = req.body || {};

  const editableFields = [
    "source_subject_code",
    "source_subject_name",
    "source_units",
    "source_grade",
    "source_remarks",
    "source_academic_year",
    "source_year_level",
    "source_semester",
  ];

  const suppliedEditableFields = editableFields.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  );

  if (suppliedEditableFields.length === 0) {
    return res.status(400).json({
      success: false,
      code: "NO_TRANSFER_SUBJECT_CHANGES",
      message: "At least one previous-school subject field must be supplied.",
      editable_fields: editableFields,
    });
  }

  // ========================================================
  // 3. WORKFLOW FIELDS ARE NOT EDITABLE HERE
  // ========================================================

  const forbiddenFields = [
    "transfer_evaluation_id",
    "ptc_subject_id",
    "credited_units",
    "credit_status",
    "decision_reason",
    "reviewed_by",
    "reviewed_at",
  ];

  const suppliedForbiddenFields = forbiddenFields.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  );

  if (suppliedForbiddenFields.length > 0) {
    return res.status(400).json({
      success: false,
      code: "TRANSFER_SUBJECT_WORKFLOW_FIELDS_NOT_ALLOWED",
      message:
        "PTC equivalency, credit decision, and review fields cannot be changed through the raw transcript correction route.",
      forbidden_fields: suppliedForbiddenFields,
    });
  }

  let connection;
  let transactionActive = false;

  try {
    // ======================================================
    // 4. TRANSACTION
    // ======================================================

    connection = await db.getConnection();

    await connection.beginTransaction();

    transactionActive = true;

    // ======================================================
    // 5. LOCK EVALUATION
    // ======================================================

    const [evaluationRows] = await connection.execute(
      `
            SELECT
                ste.transfer_evaluation_id,
                ste.student_id,
                ste.curriculum_id,
                ste.source_school,
                ste.evaluation_status,

                s.student_number,
                s.first_name,
                s.middle_name,
                s.last_name,

                cur.curriculum_name

            FROM student_transfer_evaluations ste

            INNER JOIN students s
                ON s.student_id =
                   ste.student_id

            INNER JOIN curriculum cur
                ON cur.curriculum_id =
                   ste.curriculum_id

            WHERE ste.transfer_evaluation_id = ?

            LIMIT 1

            FOR UPDATE
          `,
      [transferEvaluationId],
    );

    if (evaluationRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(404).json({
        success: false,
        code: "TRANSFER_EVALUATION_NOT_FOUND",
        message: "Transfer evaluation not found.",
      });
    }

    const evaluation = evaluationRows[0];

    const evaluationStatus = String(evaluation.evaluation_status || "").trim();

    // ======================================================
    // 6. HEADER MUST BE EDITABLE
    // ======================================================

    if (!["Draft", "Returned"].includes(evaluationStatus)) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,
        code: "TRANSFER_EVALUATION_NOT_EDITABLE",
        message: `Previous-school subjects cannot be edited while the transfer evaluation status is "${evaluationStatus}".`,
        evaluation_status: evaluationStatus,
        editable_statuses: ["Draft", "Returned"],
      });
    }

    // ======================================================
    // 7. LOCK TRANSFER SUBJECT
    // ======================================================

    const [subjectRows] = await connection.execute(
      `
            SELECT
                transfer_subject_id,
                transfer_evaluation_id,

                source_subject_code,
                source_subject_name,
                source_units,
                source_grade,
                source_remarks,

                source_academic_year,
                source_year_level,
                source_semester,

                ptc_subject_id,
                credited_units,
                credit_status,
                decision_reason,

                reviewed_by,
                reviewed_at,

                created_at,
                updated_at

            FROM student_transfer_subjects

            WHERE transfer_subject_id = ?
              AND transfer_evaluation_id = ?

            LIMIT 1

            FOR UPDATE
          `,
      [transferSubjectId, transferEvaluationId],
    );

    if (subjectRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(404).json({
        success: false,
        code: "TRANSFER_SUBJECT_NOT_FOUND",
        message:
          "Previous-school subject was not found in this transfer evaluation.",
      });
    }

    const current = subjectRows[0];

    // ======================================================
    // 8. REVIEWED/CREDITED SUBJECT MUST NOT BE SILENTLY
    //    CHANGED THROUGH RAW TRANSCRIPT ROUTE
    //
    // Pending/unreviewed rows remain editable.
    //
    // Later workflow routes will handle reopening/resetting
    // reviewed credit decisions if needed.
    // ======================================================

    if (
      current.credit_status !== "Pending" ||
      current.reviewed_by !== null ||
      current.reviewed_at !== null
    ) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,
        code: "TRANSFER_SUBJECT_DECISION_LOCKED",
        message:
          "This previous-school subject already has an academic credit decision or review and cannot be changed through the raw transcript correction route.",
        credit_status: current.credit_status,
        reviewed_by:
          current.reviewed_by !== null ? Number(current.reviewed_by) : null,
        reviewed_at: current.reviewed_at,
      });
    }

    // ======================================================
    // 9. MERGE CURRENT VALUES WITH PATCH
    // ======================================================

    let newSubjectCode = current.source_subject_code;

    let newSubjectName = current.source_subject_name;

    let newUnits =
      current.source_units !== null ? Number(current.source_units) : null;

    let newGrade = current.source_grade;

    let newRemarks = current.source_remarks;

    let newAcademicYear = current.source_academic_year;

    let newYearLevel =
      current.source_year_level !== null
        ? Number(current.source_year_level)
        : null;

    let newSemester = current.source_semester;

    // ======================================================
    // 10. SUBJECT CODE
    // ======================================================

    if (Object.prototype.hasOwnProperty.call(body, "source_subject_code")) {
      if (
        body.source_subject_code === null ||
        body.source_subject_code === ""
      ) {
        newSubjectCode = null;
      } else if (typeof body.source_subject_code !== "string") {
        await connection.rollback();
        transactionActive = false;

        return res.status(400).json({
          success: false,
          code: "INVALID_SOURCE_SUBJECT_CODE",
          message: "source_subject_code must be a text value or null.",
        });
      } else {
        newSubjectCode = body.source_subject_code.trim() || null;

        if (newSubjectCode && newSubjectCode.length > 100) {
          await connection.rollback();
          transactionActive = false;

          return res.status(400).json({
            success: false,
            code: "SOURCE_SUBJECT_CODE_TOO_LONG",
            message:
              "Previous-school subject code must not exceed 100 characters.",
          });
        }
      }
    }

    // ======================================================
    // 11. SUBJECT NAME
    //
    // Required field cannot be cleared.
    // ======================================================

    if (Object.prototype.hasOwnProperty.call(body, "source_subject_name")) {
      if (
        typeof body.source_subject_name !== "string" ||
        !body.source_subject_name.trim()
      ) {
        await connection.rollback();
        transactionActive = false;

        return res.status(400).json({
          success: false,
          code: "SOURCE_SUBJECT_NAME_REQUIRED",
          message: "Previous-school subject name is required.",
        });
      }

      newSubjectName = body.source_subject_name.trim();

      if (newSubjectName.length > 255) {
        await connection.rollback();
        transactionActive = false;

        return res.status(400).json({
          success: false,
          code: "SOURCE_SUBJECT_NAME_TOO_LONG",
          message:
            "Previous-school subject name must not exceed 255 characters.",
        });
      }
    }

    // ======================================================
    // 12. UNITS
    // ======================================================

    if (Object.prototype.hasOwnProperty.call(body, "source_units")) {
      if (body.source_units === null || body.source_units === "") {
        newUnits = null;
      } else {
        const parsedUnits = Number(body.source_units);

        if (
          !Number.isFinite(parsedUnits) ||
          parsedUnits < 0 ||
          parsedUnits > 9999.99
        ) {
          await connection.rollback();
          transactionActive = false;

          return res.status(400).json({
            success: false,
            code: "INVALID_SOURCE_UNITS",
            message:
              "source_units must be a valid non-negative number or null.",
          });
        }

        newUnits = Math.round(parsedUnits * 100) / 100;
      }
    }

    // ======================================================
    // 13. GRADE
    // ======================================================

    if (Object.prototype.hasOwnProperty.call(body, "source_grade")) {
      if (body.source_grade === null || body.source_grade === "") {
        newGrade = null;
      } else if (typeof body.source_grade !== "string") {
        await connection.rollback();
        transactionActive = false;

        return res.status(400).json({
          success: false,
          code: "INVALID_SOURCE_GRADE",
          message: "source_grade must be sent as text or null.",
        });
      } else {
        newGrade = body.source_grade.trim() || null;

        if (newGrade && newGrade.length > 50) {
          await connection.rollback();
          transactionActive = false;

          return res.status(400).json({
            success: false,
            code: "SOURCE_GRADE_TOO_LONG",
            message: "Previous-school grade must not exceed 50 characters.",
          });
        }
      }
    }

    // ======================================================
    // 14. SOURCE REMARKS
    // ======================================================

    if (Object.prototype.hasOwnProperty.call(body, "source_remarks")) {
      if (body.source_remarks === null || body.source_remarks === "") {
        newRemarks = null;
      } else if (typeof body.source_remarks !== "string") {
        await connection.rollback();
        transactionActive = false;

        return res.status(400).json({
          success: false,
          code: "INVALID_SOURCE_REMARKS",
          message: "source_remarks must be a text value or null.",
        });
      } else {
        newRemarks = body.source_remarks.trim() || null;

        if (newRemarks && newRemarks.length > 255) {
          await connection.rollback();
          transactionActive = false;

          return res.status(400).json({
            success: false,
            code: "SOURCE_REMARKS_TOO_LONG",
            message: "Previous-school remarks must not exceed 255 characters.",
          });
        }
      }
    }

    // ======================================================
    // 15. SOURCE ACADEMIC YEAR
    // ======================================================

    if (Object.prototype.hasOwnProperty.call(body, "source_academic_year")) {
      if (
        body.source_academic_year === null ||
        body.source_academic_year === ""
      ) {
        newAcademicYear = null;
      } else if (typeof body.source_academic_year !== "string") {
        await connection.rollback();
        transactionActive = false;

        return res.status(400).json({
          success: false,
          code: "INVALID_SOURCE_ACADEMIC_YEAR",
          message: "source_academic_year must be a text value or null.",
        });
      } else {
        newAcademicYear = body.source_academic_year.trim() || null;

        if (newAcademicYear && newAcademicYear.length > 50) {
          await connection.rollback();
          transactionActive = false;

          return res.status(400).json({
            success: false,
            code: "SOURCE_ACADEMIC_YEAR_TOO_LONG",
            message:
              "Previous-school academic year must not exceed 50 characters.",
          });
        }
      }
    }

    // ======================================================
    // 16. SOURCE YEAR LEVEL
    // ======================================================

    if (Object.prototype.hasOwnProperty.call(body, "source_year_level")) {
      if (body.source_year_level === null || body.source_year_level === "") {
        newYearLevel = null;
      } else {
        newYearLevel = toPositiveInt(body.source_year_level);

        if (!newYearLevel) {
          await connection.rollback();
          transactionActive = false;

          return res.status(400).json({
            success: false,
            code: "INVALID_SOURCE_YEAR_LEVEL",
            message:
              "source_year_level must be a valid positive integer or null.",
          });
        }

        if (newYearLevel > 20) {
          await connection.rollback();
          transactionActive = false;

          return res.status(400).json({
            success: false,
            code: "SOURCE_YEAR_LEVEL_TOO_HIGH",
            message: "source_year_level is outside the supported range.",
          });
        }
      }
    }

    // ======================================================
    // 17. SOURCE SEMESTER
    // ======================================================

    if (Object.prototype.hasOwnProperty.call(body, "source_semester")) {
      if (body.source_semester === null || body.source_semester === "") {
        newSemester = null;
      } else if (typeof body.source_semester !== "string") {
        await connection.rollback();
        transactionActive = false;

        return res.status(400).json({
          success: false,
          code: "INVALID_SOURCE_SEMESTER",
          message: "source_semester must be a text value or null.",
        });
      } else {
        newSemester = body.source_semester.trim() || null;

        if (newSemester && newSemester.length > 100) {
          await connection.rollback();
          transactionActive = false;

          return res.status(400).json({
            success: false,
            code: "SOURCE_SEMESTER_TOO_LONG",
            message: "Previous-school semester must not exceed 100 characters.",
          });
        }
      }
    }

    // ======================================================
    // 18. OLD / NEW AUDIT VALUES
    // ======================================================

    const oldValues = {
      transfer_subject_id: transferSubjectId,

      transfer_evaluation_id: transferEvaluationId,

      source_subject_code: current.source_subject_code,

      source_subject_name: current.source_subject_name,

      source_units:
        current.source_units !== null ? Number(current.source_units) : null,

      source_grade: current.source_grade,

      source_remarks: current.source_remarks,

      source_academic_year: current.source_academic_year,

      source_year_level:
        current.source_year_level !== null
          ? Number(current.source_year_level)
          : null,

      source_semester: current.source_semester,

      ptc_subject_id:
        current.ptc_subject_id !== null ? Number(current.ptc_subject_id) : null,

      credited_units:
        current.credited_units !== null ? Number(current.credited_units) : null,

      credit_status: current.credit_status,

      decision_reason: current.decision_reason,

      reviewed_by:
        current.reviewed_by !== null ? Number(current.reviewed_by) : null,

      reviewed_at: current.reviewed_at,
    };

    const newValues = {
      ...oldValues,

      source_subject_code: newSubjectCode,

      source_subject_name: newSubjectName,

      source_units: newUnits,

      source_grade: newGrade,

      source_remarks: newRemarks,

      source_academic_year: newAcademicYear,

      source_year_level: newYearLevel,

      source_semester: newSemester,
    };

    // ======================================================
    // 19. DETECT ACTUAL CHANGE
    // ======================================================

    const changed = JSON.stringify(oldValues) !== JSON.stringify(newValues);

    if (!changed) {
      await connection.rollback();
      transactionActive = false;

      return res.status(200).json({
        success: true,
        code: "TRANSFER_SUBJECT_UNCHANGED",
        message: "No previous-school subject values changed.",
        transfer_subject_id: transferSubjectId,
      });
    }

    // ======================================================
    // 20. UPDATE
    //
    // PTC mapping / review fields are deliberately untouched.
    // ======================================================

    const [updateResult] = await connection.execute(
      `
            UPDATE student_transfer_subjects

            SET
                source_subject_code = ?,
                source_subject_name = ?,
                source_units = ?,
                source_grade = ?,
                source_remarks = ?,

                source_academic_year = ?,
                source_year_level = ?,
                source_semester = ?

            WHERE transfer_subject_id = ?
              AND transfer_evaluation_id = ?
          `,
      [
        newSubjectCode,
        newSubjectName,
        newUnits,
        newGrade,
        newRemarks,

        newAcademicYear,
        newYearLevel,
        newSemester,

        transferSubjectId,
        transferEvaluationId,
      ],
    );

    if (updateResult.affectedRows !== 1) {
      throw new Error(
        "Transfer subject update did not affect exactly one row.",
      );
    }

    // ======================================================
    // 21. AUDIT UPDATE
    // ======================================================

    await connection.execute(
      `
          INSERT INTO audit_trail (
              user_id,
              table_name,
              record_id,
              action,
              old_values,
              new_values
          )

          VALUES (
              ?,
              'student_transfer_subjects',
              ?,
              'UPDATE',
              ?,
              ?
          )
        `,
      [
        Number(actor.user_id),

        transferSubjectId,

        JSON.stringify(oldValues),
        JSON.stringify(newValues),
      ],
    );

    // ======================================================
    // 22. GET UPDATED ROW
    // ======================================================

    const [updatedRows] = await connection.execute(
      `
            SELECT
                transfer_subject_id,
                transfer_evaluation_id,

                source_subject_code,
                source_subject_name,
                source_units,
                source_grade,
                source_remarks,

                source_academic_year,
                source_year_level,
                source_semester,

                ptc_subject_id,
                credited_units,
                credit_status,
                decision_reason,

                reviewed_by,
                reviewed_at,

                created_at,
                updated_at

            FROM student_transfer_subjects

            WHERE transfer_subject_id = ?
              AND transfer_evaluation_id = ?

            LIMIT 1
          `,
      [transferSubjectId, transferEvaluationId],
    );

    if (updatedRows.length === 0) {
      throw new Error("Updated transfer subject could not be retrieved.");
    }

    const updated = updatedRows[0];

    // ======================================================
    // 23. COMMIT
    // ======================================================

    await connection.commit();

    transactionActive = false;

    // ======================================================
    // 24. RESPONSE
    // ======================================================

    return res.status(200).json({
      success: true,

      code: "TRANSFER_SUBJECT_UPDATED",

      message: "Previous-school subject corrected successfully.",

      evaluation: {
        transfer_evaluation_id: transferEvaluationId,

        evaluation_status: evaluationStatus,

        student_id: Number(evaluation.student_id),

        student_number: evaluation.student_number,

        student_name: [
          evaluation.first_name,
          evaluation.middle_name,
          evaluation.last_name,
        ]
          .filter(Boolean)
          .join(" "),

        curriculum_id: Number(evaluation.curriculum_id),

        curriculum_name: evaluation.curriculum_name,

        source_school: evaluation.source_school,
      },

      transfer_subject: {
        transfer_subject_id: Number(updated.transfer_subject_id),

        transfer_evaluation_id: Number(updated.transfer_evaluation_id),

        source: {
          subject_code: updated.source_subject_code || null,

          subject_name: updated.source_subject_name,

          units:
            updated.source_units !== null ? Number(updated.source_units) : null,

          grade: updated.source_grade || null,

          remarks: updated.source_remarks || null,

          academic_year: updated.source_academic_year || null,

          year_level:
            updated.source_year_level !== null
              ? Number(updated.source_year_level)
              : null,

          semester: updated.source_semester || null,
        },

        ptc_equivalency: {
          subject_id:
            updated.ptc_subject_id !== null
              ? Number(updated.ptc_subject_id)
              : null,

          credited_units:
            updated.credited_units !== null
              ? Number(updated.credited_units)
              : null,

          credit_status: updated.credit_status,

          decision_reason: updated.decision_reason || null,
        },

        review: {
          reviewed_by:
            updated.reviewed_by !== null ? Number(updated.reviewed_by) : null,

          reviewed_at: updated.reviewed_at,
        },

        created_at: updated.created_at,

        updated_at: updated.updated_at,
      },

      changes: {
        old: oldValues,
        new: newValues,
      },

      academic_effect: {
        changes_ptc_grades: false,

        changes_current_enrollment: false,

        satisfies_curriculum_requirements: false,

        official_transfer_credit: false,

        reason:
          "Only raw previous-school transcript information was corrected. No official transfer credit was granted.",
      },

      actor: {
        user_id: Number(actor.user_id),

        username: actor.username,
      },
    });
  } catch (error) {
    if (connection && transactionActive) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("UPDATE TRANSFER SUBJECT ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("UPDATE TRANSFER SUBJECT ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "TRANSFER_SUBJECT_UPDATE_FAILED",

      message: "Failed to correct previous-school subject.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// ============================================================
// ROUTE 4
// MAP PREVIOUS-SCHOOL SUBJECT TO PTC SUBJECT
//
// PATCH
// /api/registrar/transfer-evaluations/:id/subjects/:transferSubjectId/map
//
// BODY:
//
// {
//   "ptc_subject_id": 9
// }
//
// PURPOSE:
//
// Map a raw previous-school transcript subject to a subject
// that actually belongs to the student's evaluated PTC
// curriculum.
//
// IMPORTANT:
//
// Mapping alone DOES NOT:
// - credit the subject
// - satisfy the curriculum
// - create/edit a PTC grade
// - change enrollment
//
// credit_status remains Pending.
// ============================================================

router.patch("/:id/subjects/:transferSubjectId/map", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  // ========================================================
  // 1. IDS
  // ========================================================

  const transferEvaluationId = toPositiveInt(req.params.id);

  const transferSubjectId = toPositiveInt(req.params.transferSubjectId);

  if (!transferEvaluationId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_TRANSFER_EVALUATION_ID",
      message: "A valid transfer evaluation ID is required.",
    });
  }

  if (!transferSubjectId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_TRANSFER_SUBJECT_ID",
      message: "A valid transfer subject ID is required.",
    });
  }

  // ========================================================
  // 2. PTC SUBJECT
  // ========================================================

  const ptcSubjectId = toPositiveInt(req.body?.ptc_subject_id);

  if (!ptcSubjectId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_PTC_SUBJECT_ID",
      message: "A valid ptc_subject_id is required.",
    });
  }

  let connection;
  let transactionActive = false;

  try {
    // ======================================================
    // 3. TRANSACTION
    // ======================================================

    connection = await db.getConnection();

    await connection.beginTransaction();

    transactionActive = true;

    // ======================================================
    // 4. LOCK EVALUATION
    // ======================================================

    const [evaluationRows] = await connection.execute(
      `
            SELECT
                ste.transfer_evaluation_id,
                ste.student_id,
                ste.curriculum_id,
                ste.source_school,
                ste.evaluation_status,

                s.student_number,
                s.first_name,
                s.middle_name,
                s.last_name,

                cur.curriculum_name,
                cur.course_id,

                c.course_code,
                c.course_name

            FROM student_transfer_evaluations ste

            INNER JOIN students s
                ON s.student_id =
                   ste.student_id

            INNER JOIN curriculum cur
                ON cur.curriculum_id =
                   ste.curriculum_id

            INNER JOIN courses c
                ON c.course_id =
                   cur.course_id

            WHERE ste.transfer_evaluation_id = ?

            LIMIT 1

            FOR UPDATE
          `,
      [transferEvaluationId],
    );

    if (evaluationRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(404).json({
        success: false,
        code: "TRANSFER_EVALUATION_NOT_FOUND",
        message: "Transfer evaluation not found.",
      });
    }

    const evaluation = evaluationRows[0];

    const evaluationStatus = String(evaluation.evaluation_status || "").trim();

    // ======================================================
    // 5. ONLY DRAFT / RETURNED CAN BE MAPPED
    // ======================================================

    if (!["Draft", "Returned"].includes(evaluationStatus)) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,
        code: "TRANSFER_EVALUATION_NOT_EDITABLE",
        message: `PTC subject mapping cannot be changed while the evaluation status is "${evaluationStatus}".`,
        evaluation_status: evaluationStatus,
        editable_statuses: ["Draft", "Returned"],
      });
    }

    // ======================================================
    // 6. LOCK RAW TRANSFER SUBJECT
    // ======================================================

    const [transferSubjectRows] = await connection.execute(
      `
            SELECT
                transfer_subject_id,
                transfer_evaluation_id,

                source_subject_code,
                source_subject_name,
                source_units,
                source_grade,
                source_remarks,

                source_academic_year,
                source_year_level,
                source_semester,

                ptc_subject_id,
                credited_units,
                credit_status,
                decision_reason,

                reviewed_by,
                reviewed_at,

                created_at,
                updated_at

            FROM student_transfer_subjects

            WHERE transfer_subject_id = ?
              AND transfer_evaluation_id = ?

            LIMIT 1

            FOR UPDATE
          `,
      [transferSubjectId, transferEvaluationId],
    );

    if (transferSubjectRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(404).json({
        success: false,
        code: "TRANSFER_SUBJECT_NOT_FOUND",
        message:
          "Previous-school subject was not found in this transfer evaluation.",
      });
    }

    const transferSubject = transferSubjectRows[0];

    // ======================================================
    // 7. CREDIT DECISION MUST STILL BE PENDING
    // ======================================================

    if (
      transferSubject.credit_status !== "Pending" ||
      transferSubject.reviewed_by !== null ||
      transferSubject.reviewed_at !== null
    ) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,
        code: "TRANSFER_SUBJECT_DECISION_LOCKED",
        message:
          "This transfer subject already has an academic review or credit decision and its PTC mapping cannot be changed through this route.",
        credit_status: transferSubject.credit_status,
      });
    }

    // ======================================================
    // 8. TARGET PTC SUBJECT MUST BELONG TO THIS CURRICULUM
    //
    // This is critical.
    //
    // Registrar cannot map an external subject to some
    // random subject outside the student's curriculum.
    // ======================================================

    const [targetRows] = await connection.execute(
      `
            SELECT
                cs.curriculum_subject_id,
                cs.curriculum_id,
                cs.subject_id,
                cs.year_level,
                cs.semester_id,
                cs.is_required,
                cs.display_order,

                s.subject_code,
                s.subject_name,
                s.units,
                s.is_active,

                sem.semester_name

            FROM curriculum_subjects cs

            INNER JOIN subjects s
                ON s.subject_id =
                   cs.subject_id

            INNER JOIN semesters sem
                ON sem.semester_id =
                   cs.semester_id

            WHERE cs.curriculum_id = ?
              AND cs.subject_id = ?

            LIMIT 1

            FOR UPDATE
          `,
      [Number(evaluation.curriculum_id), ptcSubjectId],
    );

    if (targetRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,
        code: "PTC_SUBJECT_NOT_IN_EVALUATED_CURRICULUM",
        message:
          "The selected PTC subject does not belong to the curriculum being evaluated.",
        curriculum_id: Number(evaluation.curriculum_id),
        ptc_subject_id: ptcSubjectId,
      });
    }

    const target = targetRows[0];

    // ======================================================
    // 9. TARGET SUBJECT MUST STILL BE ACTIVE
    // ======================================================

    if (Number(target.is_active) !== 1) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,
        code: "PTC_SUBJECT_INACTIVE",
        message:
          "The selected PTC subject is inactive and cannot be used as a transfer-credit equivalent.",
        ptc_subject_id: ptcSubjectId,
        subject_code: target.subject_code,
      });
    }

    // ======================================================
    // 10. PREVENT DUPLICATE LIVE MAPPING
    //
    // Two external transcript rows should not normally map
    // to the same PTC curriculum requirement inside one
    // transfer evaluation.
    //
    // This prevents accidental double-credit preparation.
    // ======================================================

    const [duplicateRows] = await connection.execute(
      `
            SELECT
                transfer_subject_id,
                source_subject_code,
                source_subject_name,
                source_grade,
                credit_status

            FROM student_transfer_subjects

            WHERE transfer_evaluation_id = ?
              AND ptc_subject_id = ?
              AND transfer_subject_id <> ?

            LIMIT 1

            FOR UPDATE
          `,
      [transferEvaluationId, ptcSubjectId, transferSubjectId],
    );

    if (duplicateRows.length > 0) {
      const duplicate = duplicateRows[0];

      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,
        code: "PTC_SUBJECT_ALREADY_MAPPED",
        message:
          "Another previous-school subject in this evaluation is already mapped to the selected PTC subject.",

        existing_mapping: {
          transfer_subject_id: Number(duplicate.transfer_subject_id),

          source_subject_code: duplicate.source_subject_code || null,

          source_subject_name: duplicate.source_subject_name,

          source_grade: duplicate.source_grade || null,

          credit_status: duplicate.credit_status,
        },
      });
    }

    // ======================================================
    // 11. SAME MAPPING = NO CHANGE
    // ======================================================

    const oldPtcSubjectId =
      transferSubject.ptc_subject_id !== null
        ? Number(transferSubject.ptc_subject_id)
        : null;

    if (oldPtcSubjectId === ptcSubjectId) {
      await connection.rollback();
      transactionActive = false;

      return res.status(200).json({
        success: true,
        code: "TRANSFER_SUBJECT_MAPPING_UNCHANGED",
        message:
          "Previous-school subject is already mapped to this PTC subject.",

        transfer_subject_id: transferSubjectId,

        ptc_subject_id: ptcSubjectId,
      });
    }

    // ======================================================
    // 12. AUDIT VALUES
    // ======================================================

    const oldValues = {
      transfer_subject_id: transferSubjectId,

      transfer_evaluation_id: transferEvaluationId,

      source_subject_code: transferSubject.source_subject_code,

      source_subject_name: transferSubject.source_subject_name,

      source_grade: transferSubject.source_grade,

      ptc_subject_id: oldPtcSubjectId,

      credited_units:
        transferSubject.credited_units !== null
          ? Number(transferSubject.credited_units)
          : null,

      credit_status: transferSubject.credit_status,

      decision_reason: transferSubject.decision_reason,

      reviewed_by:
        transferSubject.reviewed_by !== null
          ? Number(transferSubject.reviewed_by)
          : null,

      reviewed_at: transferSubject.reviewed_at,
    };

    const newValues = {
      ...oldValues,

      ptc_subject_id: ptcSubjectId,

      // ----------------------------------------------
      // Mapping alone grants NO credit.
      // ----------------------------------------------

      credited_units: null,

      credit_status: "Pending",

      decision_reason: null,

      reviewed_by: null,

      reviewed_at: null,

      mapping_action: "PTC_EQUIVALENCY_SELECTED",
    };

    // ======================================================
    // 13. UPDATE MAPPING ONLY
    // ======================================================

    const [updateResult] = await connection.execute(
      `
            UPDATE student_transfer_subjects

            SET
                ptc_subject_id = ?,

                credited_units = NULL,

                credit_status = 'Pending',

                decision_reason = NULL,

                reviewed_by = NULL,
                reviewed_at = NULL

            WHERE transfer_subject_id = ?
              AND transfer_evaluation_id = ?
          `,
      [ptcSubjectId, transferSubjectId, transferEvaluationId],
    );

    if (updateResult.affectedRows !== 1) {
      throw new Error(
        "Transfer subject mapping update did not affect exactly one row.",
      );
    }

    // ======================================================
    // 14. AUDIT
    // ======================================================

    await connection.execute(
      `
          INSERT INTO audit_trail (
              user_id,
              table_name,
              record_id,
              action,
              old_values,
              new_values
          )

          VALUES (
              ?,
              'student_transfer_subjects',
              ?,
              'UPDATE',
              ?,
              ?
          )
        `,
      [
        Number(actor.user_id),

        transferSubjectId,

        JSON.stringify(oldValues),

        JSON.stringify(newValues),
      ],
    );

    // ======================================================
    // 15. GET UPDATED RECORD
    // ======================================================

    const [updatedRows] = await connection.execute(
      `
            SELECT
                sts.transfer_subject_id,
                sts.transfer_evaluation_id,

                sts.source_subject_code,
                sts.source_subject_name,
                sts.source_units,
                sts.source_grade,
                sts.source_remarks,

                sts.source_academic_year,
                sts.source_year_level,
                sts.source_semester,

                sts.ptc_subject_id,
                sts.credited_units,
                sts.credit_status,
                sts.decision_reason,

                sts.reviewed_by,
                sts.reviewed_at,

                s.subject_code
                    AS ptc_subject_code,

                s.subject_name
                    AS ptc_subject_name,

                s.units
                    AS ptc_subject_units,

                cs.curriculum_subject_id,

                cs.year_level
                    AS ptc_year_level,

                cs.semester_id
                    AS ptc_semester_id,

                sem.semester_name
                    AS ptc_semester_name,

                cs.is_required,

                sts.created_at,
                sts.updated_at

            FROM student_transfer_subjects sts

            LEFT JOIN subjects s
                ON s.subject_id =
                   sts.ptc_subject_id

            LEFT JOIN curriculum_subjects cs
                ON cs.curriculum_id = ?
               AND cs.subject_id =
                   sts.ptc_subject_id

            LEFT JOIN semesters sem
                ON sem.semester_id =
                   cs.semester_id

            WHERE sts.transfer_subject_id = ?
              AND sts.transfer_evaluation_id = ?

            LIMIT 1
          `,
      [
        Number(evaluation.curriculum_id),

        transferSubjectId,
        transferEvaluationId,
      ],
    );

    if (updatedRows.length === 0) {
      throw new Error("Mapped transfer subject could not be retrieved.");
    }

    const updated = updatedRows[0];

    // ======================================================
    // 16. COMMIT
    // ======================================================

    await connection.commit();

    transactionActive = false;

    // ======================================================
    // 17. RESPONSE
    // ======================================================

    return res.status(200).json({
      success: true,

      code: "TRANSFER_SUBJECT_MAPPED",

      message: `${updated.source_subject_code || updated.source_subject_name} was mapped to ${updated.ptc_subject_code}. No transfer credit has been granted yet.`,

      evaluation: {
        transfer_evaluation_id: transferEvaluationId,

        evaluation_status: evaluationStatus,

        student_id: Number(evaluation.student_id),

        student_number: evaluation.student_number,

        student_name: [
          evaluation.first_name,
          evaluation.middle_name,
          evaluation.last_name,
        ]
          .filter(Boolean)
          .join(" "),

        curriculum: {
          curriculum_id: Number(evaluation.curriculum_id),

          curriculum_name: evaluation.curriculum_name,

          course_id: Number(evaluation.course_id),

          course_code: evaluation.course_code,

          course_name: evaluation.course_name,
        },

        source_school: evaluation.source_school,
      },

      transfer_subject: {
        transfer_subject_id: Number(updated.transfer_subject_id),

        source: {
          subject_code: updated.source_subject_code || null,

          subject_name: updated.source_subject_name,

          units:
            updated.source_units !== null ? Number(updated.source_units) : null,

          grade: updated.source_grade || null,

          remarks: updated.source_remarks || null,

          academic_year: updated.source_academic_year || null,

          year_level:
            updated.source_year_level !== null
              ? Number(updated.source_year_level)
              : null,

          semester: updated.source_semester || null,
        },

        ptc_equivalency: {
          curriculum_subject_id:
            updated.curriculum_subject_id !== null
              ? Number(updated.curriculum_subject_id)
              : null,

          subject_id: Number(updated.ptc_subject_id),

          subject_code: updated.ptc_subject_code,

          subject_name: updated.ptc_subject_name,

          subject_units: Number(updated.ptc_subject_units),

          year_level:
            updated.ptc_year_level !== null
              ? Number(updated.ptc_year_level)
              : null,

          semester_id:
            updated.ptc_semester_id !== null
              ? Number(updated.ptc_semester_id)
              : null,

          semester_name: updated.ptc_semester_name || null,

          is_required: Number(updated.is_required) === 1,

          credited_units: null,

          credit_status: updated.credit_status,

          decision_reason: null,
        },

        review: {
          reviewed_by: null,
          reviewed_at: null,
        },
      },

      academic_effect: {
        mapped_to_ptc_subject: true,

        credit_decision_made: false,

        official_transfer_credit: false,

        satisfies_curriculum_requirements: false,

        changes_ptc_grades: false,

        changes_current_enrollment: false,

        reason:
          "A PTC equivalency was selected, but the transfer subject remains Pending until an academic credit decision is made and the evaluation is completed.",
      },

      changes: {
        old_ptc_subject_id: oldPtcSubjectId,

        new_ptc_subject_id: ptcSubjectId,
      },

      next_action:
        "The mapped subject may now be evaluated for Credited or Not Credited status.",

      actor: {
        user_id: Number(actor.user_id),

        username: actor.username,
      },
    });
  } catch (error) {
    if (connection && transactionActive) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("MAP TRANSFER SUBJECT ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("MAP TRANSFER SUBJECT ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "TRANSFER_SUBJECT_MAPPING_FAILED",

      message: "Failed to map previous-school subject to a PTC subject.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// ============================================================
// ROUTE 5
// SUBMIT TRANSFER EVALUATION FOR ACADEMIC REVIEW
//
// POST
// /api/registrar/transfer-evaluations/:id/submit
//
// WORKFLOW:
//
// Draft / Returned
//       ↓
// Submitted
//       ↓
// Program Head academic review
//
// IMPORTANT:
//
// Registrar prepares:
// - source-school information
// - raw transcript subjects
// - proposed PTC equivalency mappings
//
// Registrar DOES NOT make the final:
// - Credited
// - Not Credited
//
// decision.
//
// Submission itself has NO official academic effect.
// ============================================================

router.post("/:id/submit", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  // ==========================================================
  // 1. EVALUATION ID
  // ==========================================================

  const transferEvaluationId = toPositiveInt(req.params.id);

  if (!transferEvaluationId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_TRANSFER_EVALUATION_ID",
      message: "A valid transfer evaluation ID is required.",
    });
  }

  let connection;
  let transactionActive = false;

  try {
    // ========================================================
    // 2. TRANSACTION
    // ========================================================

    connection = await db.getConnection();

    await connection.beginTransaction();

    transactionActive = true;

    // ========================================================
    // 3. LOCK EVALUATION HEADER
    // ========================================================

    const [evaluationRows] = await connection.execute(
      `
          SELECT
              ste.transfer_evaluation_id,
              ste.student_id,
              ste.curriculum_id,

              ste.source_school,
              ste.source_course,
              ste.source_student_number,

              ste.transcript_document_id,
              ste.transcript_reference,

              ste.entry_year_level,
              ste.entry_semester_id,

              ste.evaluation_status,

              ste.created_by,
              ste.submitted_by,
              ste.submitted_at,

              ste.reviewed_by,
              ste.reviewed_at,
              ste.review_remarks,

              ste.remarks,

              ste.created_at,
              ste.updated_at,

              s.student_number,
              s.first_name,
              s.middle_name,
              s.last_name,

              cur.curriculum_name,
              cur.course_id,

              c.course_code,
              c.course_name

          FROM student_transfer_evaluations ste

          INNER JOIN students s
              ON s.student_id =
                 ste.student_id

          INNER JOIN curriculum cur
              ON cur.curriculum_id =
                 ste.curriculum_id

          INNER JOIN courses c
              ON c.course_id =
                 cur.course_id

          WHERE ste.transfer_evaluation_id = ?

          LIMIT 1

          FOR UPDATE
        `,
      [transferEvaluationId],
    );

    if (evaluationRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(404).json({
        success: false,
        code: "TRANSFER_EVALUATION_NOT_FOUND",
        message: "Transfer evaluation not found.",
      });
    }

    const evaluation = evaluationRows[0];

    const currentStatus = String(evaluation.evaluation_status || "").trim();

    // ========================================================
    // 4. ONLY DRAFT / RETURNED MAY BE SUBMITTED
    // ========================================================

    if (!["Draft", "Returned"].includes(currentStatus)) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,
        code: "TRANSFER_EVALUATION_NOT_SUBMITTABLE",

        message: `Transfer evaluation cannot be submitted while its current status is "${currentStatus}".`,

        evaluation_status: currentStatus,

        allowed_statuses: ["Draft", "Returned"],
      });
    }

    // ========================================================
    // 5. LOCK ALL TRANSFER SUBJECTS
    // ========================================================

    const [subjectRows] = await connection.execute(
      `
          SELECT
              sts.transfer_subject_id,
              sts.transfer_evaluation_id,

              sts.source_subject_code,
              sts.source_subject_name,
              sts.source_units,
              sts.source_grade,
              sts.source_remarks,

              sts.source_academic_year,
              sts.source_year_level,
              sts.source_semester,

              sts.ptc_subject_id,
              sts.credited_units,
              sts.credit_status,
              sts.decision_reason,

              sts.reviewed_by,
              sts.reviewed_at,

              s.subject_code
                  AS ptc_subject_code,

              s.subject_name
                  AS ptc_subject_name,

              s.units
                  AS ptc_subject_units

          FROM student_transfer_subjects sts

          LEFT JOIN subjects s
              ON s.subject_id =
                 sts.ptc_subject_id

          WHERE sts.transfer_evaluation_id = ?

          ORDER BY
              sts.transfer_subject_id ASC

          FOR UPDATE
        `,
      [transferEvaluationId],
    );

    // ========================================================
    // 6. MUST HAVE AT LEAST ONE TRANSCRIPT SUBJECT
    // ========================================================

    if (subjectRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "TRANSFER_EVALUATION_HAS_NO_SUBJECTS",

        message:
          "At least one previous-school subject must be encoded before the transfer evaluation can be submitted.",
      });
    }

    // ========================================================
    // 7. VERIFY SUBJECTS ARE STILL AWAITING REVIEW
    //
    // Registrar submission must not contain existing final
    // academic decisions.
    //
    // Program Head owns those decisions.
    // ========================================================

    const alreadyReviewedSubjects = subjectRows.filter(
      (row) =>
        row.credit_status !== "Pending" ||
        row.reviewed_by !== null ||
        row.reviewed_at !== null,
    );

    if (alreadyReviewedSubjects.length > 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "TRANSFER_EVALUATION_CONTAINS_REVIEWED_SUBJECTS",

        message:
          "The evaluation contains subjects that already have academic review information. Reviewed decisions must be properly returned/reset before Registrar resubmission.",

        subjects: alreadyReviewedSubjects.map((row) => ({
          transfer_subject_id: Number(row.transfer_subject_id),

          source_subject_code: row.source_subject_code || null,

          source_subject_name: row.source_subject_name,

          credit_status: row.credit_status,

          reviewed_by:
            row.reviewed_by !== null ? Number(row.reviewed_by) : null,

          reviewed_at: row.reviewed_at,
        })),
      });
    }

    // ========================================================
    // 8. VALIDATE PTC MAPPINGS
    //
    // IMPORTANT:
    //
    // A subject MAY remain unmapped.
    //
    // Why?
    //
    // Example:
    // External subject has no valid PTC equivalent.
    //
    // Program Head must still be able to review it and later
    // mark it Not Credited.
    //
    // But whenever ptc_subject_id IS present, it must still
    // belong to the evaluated curriculum.
    // ========================================================

    const mappedSubjectIds = subjectRows
      .filter((row) => row.ptc_subject_id !== null)
      .map((row) => Number(row.ptc_subject_id));

    if (mappedSubjectIds.length > 0) {
      const placeholders = mappedSubjectIds.map(() => "?").join(", ");

      const [validMappingRows] = await connection.execute(
        `
            SELECT
                cs.subject_id

            FROM curriculum_subjects cs

            INNER JOIN subjects s
                ON s.subject_id =
                   cs.subject_id

            WHERE cs.curriculum_id = ?

              AND cs.subject_id IN (
                ${placeholders}
              )

              AND s.is_active = 1
          `,
        [Number(evaluation.curriculum_id), ...mappedSubjectIds],
      );

      const validMappedSet = new Set(
        validMappingRows.map((row) => Number(row.subject_id)),
      );

      const invalidMappings = subjectRows.filter(
        (row) =>
          row.ptc_subject_id !== null &&
          !validMappedSet.has(Number(row.ptc_subject_id)),
      );

      if (invalidMappings.length > 0) {
        await connection.rollback();

        transactionActive = false;

        return res.status(409).json({
          success: false,

          code: "INVALID_PTC_EQUIVALENCY_MAPPING",

          message:
            "One or more proposed PTC subject mappings no longer belong to the student's evaluated curriculum or are inactive.",

          subjects: invalidMappings.map((row) => ({
            transfer_subject_id: Number(row.transfer_subject_id),

            source_subject_code: row.source_subject_code || null,

            source_subject_name: row.source_subject_name,

            ptc_subject_id: Number(row.ptc_subject_id),

            ptc_subject_code: row.ptc_subject_code || null,
          })),
        });
      }
    }

    // ========================================================
    // 9. PREVENT DUPLICATE PTC MAPPINGS
    //
    // Two source transcript rows must not prepare the same
    // PTC curriculum requirement for double review.
    // ========================================================

    const seenPtcSubjectIds = new Set();

    const duplicateMappings = [];

    for (const row of subjectRows) {
      if (row.ptc_subject_id === null) {
        continue;
      }

      const subjectId = Number(row.ptc_subject_id);

      if (seenPtcSubjectIds.has(subjectId)) {
        duplicateMappings.push({
          transfer_subject_id: Number(row.transfer_subject_id),

          source_subject_code: row.source_subject_code || null,

          source_subject_name: row.source_subject_name,

          ptc_subject_id: subjectId,

          ptc_subject_code: row.ptc_subject_code || null,
        });
      } else {
        seenPtcSubjectIds.add(subjectId);
      }
    }

    if (duplicateMappings.length > 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "DUPLICATE_PTC_EQUIVALENCY_MAPPING",

        message:
          "Multiple previous-school subjects are mapped to the same PTC subject. Resolve duplicate mappings before submission.",

        duplicates: duplicateMappings,
      });
    }

    // ========================================================
    // 10. BUILD SUBMISSION SUMMARY
    // ========================================================

    const mappedSubjects = subjectRows.filter(
      (row) => row.ptc_subject_id !== null,
    );

    const unmappedSubjects = subjectRows.filter(
      (row) => row.ptc_subject_id === null,
    );

    // ========================================================
    // 11. AUDIT OLD VALUES
    // ========================================================

    const oldValues = {
      transfer_evaluation_id: transferEvaluationId,

      evaluation_status: currentStatus,

      submitted_by:
        evaluation.submitted_by !== null
          ? Number(evaluation.submitted_by)
          : null,

      submitted_at: evaluation.submitted_at,

      reviewed_by:
        evaluation.reviewed_by !== null ? Number(evaluation.reviewed_by) : null,

      reviewed_at: evaluation.reviewed_at,

      review_remarks: evaluation.review_remarks,
    };

    // ========================================================
    // 12. SUBMIT
    //
    // Program Head review information is cleared because
    // Submitted means a fresh review cycle is starting.
    // ========================================================

    const [updateResult] = await connection.execute(
      `
          UPDATE student_transfer_evaluations

          SET
              evaluation_status =
                  'Submitted',

              submitted_by = ?,
              submitted_at = NOW(),

              reviewed_by = NULL,
              reviewed_at = NULL,
              review_remarks = NULL

          WHERE transfer_evaluation_id = ?
            AND evaluation_status IN (
              'Draft',
              'Returned'
            )
        `,
      [Number(actor.user_id), transferEvaluationId],
    );

    if (updateResult.affectedRows !== 1) {
      throw new Error(
        "Transfer evaluation submission did not affect exactly one row.",
      );
    }

    // ========================================================
    // 13. GET SUBMISSION STATE
    // ========================================================

    const [submittedRows] = await connection.execute(
      `
          SELECT
              transfer_evaluation_id,
              evaluation_status,

              submitted_by,
              submitted_at,

              reviewed_by,
              reviewed_at,
              review_remarks,

              updated_at

          FROM student_transfer_evaluations

          WHERE transfer_evaluation_id = ?

          LIMIT 1
        `,
      [transferEvaluationId],
    );

    if (submittedRows.length === 0) {
      throw new Error("Submitted transfer evaluation could not be retrieved.");
    }

    const submitted = submittedRows[0];

    // ========================================================
    // 14. AUDIT NEW VALUES
    // ========================================================

    const newValues = {
      transfer_evaluation_id: transferEvaluationId,

      evaluation_status: "Submitted",

      submitted_by: Number(actor.user_id),

      submitted_at: submitted.submitted_at,

      reviewed_by: null,

      reviewed_at: null,

      review_remarks: null,

      workflow_action: "SUBMITTED_FOR_ACADEMIC_REVIEW",

      subject_summary: {
        total_subjects: subjectRows.length,

        mapped_subjects: mappedSubjects.length,

        unmapped_subjects: unmappedSubjects.length,

        pending_subjects: subjectRows.length,
      },
    };

    await connection.execute(
      `
        INSERT INTO audit_trail (
            user_id,
            table_name,
            record_id,
            action,
            old_values,
            new_values
        )

        VALUES (
            ?,
            'student_transfer_evaluations',
            ?,
            'UPDATE',
            ?,
            ?
        )
      `,
      [
        Number(actor.user_id),

        transferEvaluationId,

        JSON.stringify(oldValues),

        JSON.stringify(newValues),
      ],
    );

    // ========================================================
    // 15. COMMIT
    // ========================================================

    await connection.commit();

    transactionActive = false;

    // ========================================================
    // 16. RESPONSE
    // ========================================================

    return res.status(200).json({
      success: true,

      code: "TRANSFER_EVALUATION_SUBMITTED",

      message:
        "Transfer evaluation submitted for Program Head academic review.",

      evaluation: {
        transfer_evaluation_id: transferEvaluationId,

        evaluation_status: submitted.evaluation_status,

        student: {
          student_id: Number(evaluation.student_id),

          student_number: evaluation.student_number,

          student_name: [
            evaluation.first_name,
            evaluation.middle_name,
            evaluation.last_name,
          ]
            .filter(Boolean)
            .join(" "),
        },

        curriculum: {
          curriculum_id: Number(evaluation.curriculum_id),

          curriculum_name: evaluation.curriculum_name,

          course_id: Number(evaluation.course_id),

          course_code: evaluation.course_code,

          course_name: evaluation.course_name,
        },

        source_school: evaluation.source_school,

        workflow: {
          previous_status: currentStatus,

          current_status: submitted.evaluation_status,

          submitted_by:
            submitted.submitted_by !== null
              ? Number(submitted.submitted_by)
              : null,

          submitted_at: submitted.submitted_at,

          reviewed_by: null,
          reviewed_at: null,
          review_remarks: null,
        },
      },

      summary: {
        total_subjects: subjectRows.length,

        mapped_subjects: mappedSubjects.length,

        unmapped_subjects: unmappedSubjects.length,

        pending_subjects: subjectRows.length,

        credited_subjects: 0,

        not_credited_subjects: 0,

        official_transfer_credits: 0,
      },

      subjects: subjectRows.map((row) => ({
        transfer_subject_id: Number(row.transfer_subject_id),

        source: {
          subject_code: row.source_subject_code || null,

          subject_name: row.source_subject_name,

          units: row.source_units !== null ? Number(row.source_units) : null,

          grade: row.source_grade || null,
        },

        proposed_ptc_equivalency:
          row.ptc_subject_id !== null
            ? {
                subject_id: Number(row.ptc_subject_id),

                subject_code: row.ptc_subject_code,

                subject_name: row.ptc_subject_name,

                subject_units:
                  row.ptc_subject_units !== null
                    ? Number(row.ptc_subject_units)
                    : null,
              }
            : null,

        credit_status: row.credit_status,
      })),

      academic_effect: {
        evaluation_submitted: true,

        credit_decision_made: false,

        official_transfer_credit: false,

        satisfies_curriculum_requirements: false,

        changes_ptc_grades: false,

        changes_current_enrollment: false,

        reason:
          "Submission begins academic review only. Transfer subjects remain Pending until the Program Head makes academic credit decisions and completes the evaluation.",
      },

      next_action:
        "Program Head must review the submitted transfer evaluation and decide whether each previous-school subject is Credited or Not Credited.",

      actor: {
        user_id: Number(actor.user_id),

        username: actor.username,
      },
    });
  } catch (error) {
    if (connection && transactionActive) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "SUBMIT TRANSFER EVALUATION ROLLBACK ERROR:",
          rollbackError,
        );
      }
    }

    console.error("SUBMIT TRANSFER EVALUATION ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "TRANSFER_EVALUATION_SUBMIT_FAILED",

      message: "Failed to submit transfer evaluation for academic review.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// ============================================================
// ROUTE 6
// GET OFFICIAL TRANSFER CREDITS FOR STUDENT
//
// GET
// /api/registrar/transfer-evaluations
//     /students/:studentId/official-credits
//
// Optional:
//
// ?curriculum_id=6
//
// PURPOSE:
//
// Authoritative read-only lookup of PTC subjects officially
// satisfied through previous-school transfer credit.
//
// OFFICIAL RULE:
//
// evaluation_status = Completed
//          +
// credit_status = Credited
//
// ============================================================

router.get("/students/:studentId/official-credits", async (req, res) => {
  try {
    // ======================================================
    // 1. REGISTRAR ACTOR
    // ======================================================

    const actor = getRegistrarActor(req, res);

    if (!actor) {
      return;
    }

    // ======================================================
    // 2. STUDENT ID
    // ======================================================

    const studentId = toPositiveInt(req.params.studentId);

    if (!studentId) {
      return res.status(400).json({
        success: false,

        code: "INVALID_STUDENT_ID",

        message: "A valid student ID is required.",
      });
    }

    // ======================================================
    // 3. OPTIONAL CURRICULUM FILTER
    // ======================================================

    let curriculumId = null;

    if (
      req.query.curriculum_id !== undefined &&
      req.query.curriculum_id !== null &&
      req.query.curriculum_id !== ""
    ) {
      curriculumId = toPositiveInt(req.query.curriculum_id);

      if (!curriculumId) {
        return res.status(400).json({
          success: false,

          code: "INVALID_CURRICULUM_ID",

          message: "curriculum_id must be a valid positive integer.",
        });
      }
    }

    // ======================================================
    // 4. VERIFY STUDENT EXISTS
    // ======================================================

    const [studentRows] = await db.execute(
      `
            SELECT
                s.student_id,
                s.student_number,

                s.first_name,
                s.middle_name,
                s.last_name,

                s.course_id,
                s.year_level,

                c.course_code,
                c.course_name

            FROM students s

            LEFT JOIN courses c
                ON c.course_id =
                   s.course_id

            WHERE s.student_id = ?

            LIMIT 1
          `,
      [studentId],
    );

    if (studentRows.length === 0) {
      return res.status(404).json({
        success: false,

        code: "STUDENT_NOT_FOUND",

        message: "Student was not found.",
      });
    }

    const student = studentRows[0];

    // ======================================================
    // 5. AUTHORITATIVE SERVICE LOOKUP
    // ======================================================

    const result = await getOfficialTransferCreditsForStudent(studentId, {
      curriculumId,
    });

    // ======================================================
    // 6. RESPONSE
    // ======================================================

    return res.status(200).json({
      success: true,

      code: "OFFICIAL_TRANSFER_CREDITS_RETRIEVED",

      message: "Official transfer credits retrieved successfully.",

      student: {
        student_id: Number(student.student_id),

        student_number: student.student_number,

        student_name: [
          student.first_name,
          student.middle_name,
          student.last_name,
        ]
          .filter(Boolean)
          .join(" "),

        current_year_level:
          student.year_level !== null ? Number(student.year_level) : null,

        stored_course: {
          course_id:
            student.course_id !== null ? Number(student.course_id) : null,

          course_code: student.course_code || null,

          course_name: student.course_name || null,
        },
      },

      filter: {
        curriculum_id: curriculumId,
      },

      summary: result.summary,

      satisfied_ptc_subject_ids: result.satisfied_ptc_subject_ids,

      official_transfer_credits: result.official_transfer_credits,

      academic_effect: {
        read_only: true,

        official_transfer_credit_lookup: true,

        changes_ptc_grades: false,

        changes_current_enrollment: false,

        reason:
          "This endpoint only reads official Completed + Credited transfer records. It does not modify academic data.",
      },

      actor: {
        user_id: actor.user_id,

        username: actor.username,
      },
    });
  } catch (error) {
    console.error("GET OFFICIAL TRANSFER CREDITS ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "OFFICIAL_TRANSFER_CREDITS_GET_FAILED",

      message: "Failed to retrieve official transfer credits.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

router.get("/students/:studentId/context", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  try {
    const studentId = toPositiveInt(req.params.studentId);

    if (!studentId) {
      return res.status(400).json({
        success: false,
        code: "INVALID_STUDENT_ID",
        message: "A valid student ID is required.",
      });
    }

    const [studentRows] = await db.execute(
      `
        SELECT
            s.student_id,
            s.student_number,

            s.first_name,
            s.middle_name,
            s.last_name,

            s.course_id,
            s.year_level,
            s.status_id,

            student_status.status_name AS status,

            c.course_code,
            c.course_name,
            c.total_years,
            c.department_id,

            d.department_code,
            d.department_name

FROM students s

LEFT JOIN courses c
    ON c.course_id = s.course_id

LEFT JOIN departments d
    ON d.department_id = c.department_id

LEFT JOIN student_statuses student_status
    ON student_status.status_id = s.status_id
        WHERE s.student_id = ?

        LIMIT 1
      `,
      [studentId],
    );

    if (studentRows.length === 0) {
      return res.status(404).json({
        success: false,
        code: "STUDENT_NOT_FOUND",
        message: "Student not found.",
      });
    }

    const student = studentRows[0];

    const studentCourseId =
      student.course_id !== null ? Number(student.course_id) : null;

    if (!studentCourseId) {
      return res.status(409).json({
        success: false,
        code: "STUDENT_COURSE_REQUIRED",
        message:
          "The student must have a valid PTC course before transfer credits can be evaluated.",
      });
    }

    const [curriculumRows] = await db.execute(
      `
        SELECT
            sc.student_curriculum_id,
            sc.student_id,
            sc.curriculum_id,

            sc.assigned_date,
            sc.status AS assignment_status,
            sc.remarks AS assignment_remarks,

            cur.curriculum_name,
            cur.effective_year,
            cur.total_units,
            cur.is_active,

            cur.course_id,

            c.course_code,
            c.course_name

        FROM student_curriculum sc

        INNER JOIN curriculum cur
            ON cur.curriculum_id = sc.curriculum_id

        INNER JOIN courses c
            ON c.course_id = cur.course_id

        WHERE sc.student_id = ?

          AND sc.status = 'Active'

          AND cur.is_active = 1

          AND cur.course_id = ?

        ORDER BY
            sc.student_curriculum_id DESC

        LIMIT 1
      `,
      [studentId, studentCourseId],
    );

    if (curriculumRows.length === 0) {
      return res.status(200).json({
        success: true,

        code: "TRANSFER_EVALUATION_CONTEXT_RETRIEVED",

        message:
          "Student context retrieved, but no valid active curriculum is assigned.",

        student: {
          student_id: Number(student.student_id),

          student_number: student.student_number,

          student_name: [
            student.first_name,
            student.middle_name,
            student.last_name,
          ]
            .filter(Boolean)
            .join(" "),

          first_name: student.first_name,
          middle_name: student.middle_name,
          last_name: student.last_name,

          year_level:
            student.year_level !== null ? Number(student.year_level) : null,

          status: student.status,

          course: {
            course_id: studentCourseId,
            course_code: student.course_code || null,
            course_name: student.course_name || null,

            total_years:
              student.total_years !== null ? Number(student.total_years) : null,

            department_id:
              student.department_id !== null
                ? Number(student.department_id)
                : null,

            department_code: student.department_code || null,

            department_name: student.department_name || null,
          },
        },

        curriculum: null,

        curriculum_subjects: [],

        curriculum_issue: "ACTIVE_CURRICULUM_NOT_FOUND",

        can_create_evaluation: false,

        actor: {
          user_id: actor.user_id,
          username: actor.username,
        },
      });
    }

    const curriculum = curriculumRows[0];

    const curriculumId = Number(curriculum.curriculum_id);

    const [subjectRows] = await db.execute(
      `
        SELECT
            cs.curriculum_subject_id,
            cs.curriculum_id,
            cs.subject_id,

            cs.year_level,
            cs.semester_id,

            sem.semester_name,

            cs.is_required,
            cs.display_order,

            s.subject_code,
            s.subject_name,

            s.units,
            s.lecture_hours,
            s.laboratory_hours,

            s.description,
            s.is_active

        FROM curriculum_subjects cs

        INNER JOIN subjects s
            ON s.subject_id = cs.subject_id

        LEFT JOIN semesters sem
            ON sem.semester_id = cs.semester_id

        WHERE cs.curriculum_id = ?

          AND s.is_active = 1

        ORDER BY
            cs.year_level ASC,
            cs.semester_id ASC,
            cs.display_order ASC,
            s.subject_code ASC
      `,
      [curriculumId],
    );

    const curriculumSubjects = subjectRows.map((row) => ({
      curriculum_subject_id: Number(row.curriculum_subject_id),

      curriculum_id: Number(row.curriculum_id),

      subject_id: Number(row.subject_id),

      subject_code: row.subject_code,

      subject_name: row.subject_name,

      units: row.units !== null ? Number(row.units) : 0,

      lecture_hours:
        row.lecture_hours !== null ? Number(row.lecture_hours) : null,

      laboratory_hours:
        row.laboratory_hours !== null ? Number(row.laboratory_hours) : null,

      description: row.description || null,

      year_level: row.year_level !== null ? Number(row.year_level) : null,

      semester_id: row.semester_id !== null ? Number(row.semester_id) : null,

      semester_name: row.semester_name || null,

      is_required:
        row.is_required !== null ? Number(row.is_required) === 1 : null,

      display_order:
        row.display_order !== null ? Number(row.display_order) : null,

      is_active: Number(row.is_active) === 1,
    }));

    return res.status(200).json({
      success: true,

      code: "TRANSFER_EVALUATION_CONTEXT_RETRIEVED",

      message: "Transfer evaluation student context retrieved successfully.",

      student: {
        student_id: Number(student.student_id),

        student_number: student.student_number,

        student_name: [
          student.first_name,
          student.middle_name,
          student.last_name,
        ]
          .filter(Boolean)
          .join(" "),

        first_name: student.first_name,

        middle_name: student.middle_name,

        last_name: student.last_name,

        year_level:
          student.year_level !== null ? Number(student.year_level) : null,

        status: student.status,

        course: {
          course_id: studentCourseId,

          course_code: student.course_code,

          course_name: student.course_name,

          total_years:
            student.total_years !== null ? Number(student.total_years) : null,

          department_id:
            student.department_id !== null
              ? Number(student.department_id)
              : null,

          department_code: student.department_code || null,

          department_name: student.department_name || null,
        },
      },

      curriculum: {
        student_curriculum_id: Number(curriculum.student_curriculum_id),

        curriculum_id: curriculumId,

        curriculum_name: curriculum.curriculum_name,

        effective_year:
          curriculum.effective_year !== null
            ? Number(curriculum.effective_year)
            : null,

        total_units:
          curriculum.total_units !== null
            ? Number(curriculum.total_units)
            : null,

        assignment_status: curriculum.assignment_status,

        assigned_date: curriculum.assigned_date,

        assignment_remarks: curriculum.assignment_remarks || null,

        is_active: Number(curriculum.is_active) === 1,

        course: {
          course_id: Number(curriculum.course_id),

          course_code: curriculum.course_code,

          course_name: curriculum.course_name,
        },
      },

      curriculum_subjects: curriculumSubjects,

      curriculum_issue: null,

      can_create_evaluation: true,

      summary: {
        total_curriculum_subjects: curriculumSubjects.length,

        total_curriculum_units: curriculumSubjects.reduce(
          (total, subject) => total + Number(subject.units || 0),
          0,
        ),
      },

      academic_effect: {
        read_only: true,

        changes_ptc_grades: false,

        changes_transfer_evaluations: false,

        changes_current_enrollment: false,

        reason:
          "This endpoint only prepares Registrar transfer-evaluation context and valid PTC curriculum mapping choices.",
      },

      actor: {
        user_id: actor.user_id,

        username: actor.username,
      },
    });
  } catch (error) {
    console.error("GET TRANSFER EVALUATION STUDENT CONTEXT ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "TRANSFER_EVALUATION_CONTEXT_GET_FAILED",

      message: "Failed to retrieve transfer evaluation student context.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

router.get("/", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  try {
    const allowedStatuses = [
      "Draft",
      "Submitted",
      "Returned",
      "Completed",
      "Cancelled",
    ];

    const status =
      typeof req.query.status === "string" ? req.query.status.trim() : "";

    const studentId =
      req.query.student_id !== undefined && req.query.student_id !== ""
        ? toPositiveInt(req.query.student_id)
        : null;

    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_TRANSFER_EVALUATION_STATUS_FILTER",
        message: "Invalid transfer evaluation status filter.",
        allowed_statuses: allowedStatuses,
      });
    }

    if (
      req.query.student_id !== undefined &&
      req.query.student_id !== "" &&
      !studentId
    ) {
      return res.status(400).json({
        success: false,
        code: "INVALID_STUDENT_ID_FILTER",
        message: "student_id must be a valid positive integer.",
      });
    }

    const conditions = [];
    const params = [];

    if (status) {
      conditions.push("ste.evaluation_status = ?");
      params.push(status);
    }

    if (studentId) {
      conditions.push("ste.student_id = ?");
      params.push(studentId);
    }

    if (search) {
      const value = `%${search}%`;

      conditions.push(`
        (
          s.student_number LIKE ?
          OR s.first_name LIKE ?
          OR s.middle_name LIKE ?
          OR s.last_name LIKE ?
          OR ste.source_school LIKE ?
          OR ste.source_course LIKE ?
          OR cur.curriculum_name LIKE ?
          OR c.course_code LIKE ?
          OR c.course_name LIKE ?
        )
      `);

      params.push(
        value,
        value,
        value,
        value,
        value,
        value,
        value,
        value,
        value,
      );
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await db.execute(
      `
        SELECT
            ste.transfer_evaluation_id,
            ste.student_id,
            ste.curriculum_id,

            ste.source_school,
            ste.source_course,
            ste.source_student_number,

            ste.transcript_document_id,
            ste.transcript_reference,

            ste.entry_year_level,
            ste.entry_semester_id,
            entry_sem.semester_name AS entry_semester_name,

            ste.evaluation_status,

            ste.created_by,
            creator.username AS created_by_username,

            ste.submitted_by,
            submitter.username AS submitted_by_username,
            ste.submitted_at,

            ste.reviewed_by,
            reviewer.username AS reviewed_by_username,
            ste.reviewed_at,
            ste.review_remarks,

            ste.remarks,
            ste.created_at,
            ste.updated_at,

            s.student_number,
            s.first_name,
            s.middle_name,
            s.last_name,
            s.year_level AS student_current_year_level,

            cur.curriculum_name,
            cur.effective_year,
            cur.total_units AS curriculum_total_units,

            c.course_id,
            c.course_code,
            c.course_name,
            c.department_id,

            d.department_code,
            d.department_name,

            doc.document_type AS transcript_document_type,
            doc.file_name AS transcript_file_name,
            doc.verification_status AS transcript_verification_status,

            COUNT(sts.transfer_subject_id) AS total_subjects,

            COALESCE(
              SUM(sts.ptc_subject_id IS NOT NULL),
              0
            ) AS mapped_subjects,

            COALESCE(
              SUM(sts.ptc_subject_id IS NULL),
              0
            ) AS unmapped_subjects,

            COALESCE(
              SUM(sts.credit_status = 'Pending'),
              0
            ) AS pending_subjects,

            COALESCE(
              SUM(sts.credit_status = 'Credited'),
              0
            ) AS credited_subjects,

            COALESCE(
              SUM(sts.credit_status = 'Not Credited'),
              0
            ) AS not_credited_subjects

        FROM student_transfer_evaluations ste

        INNER JOIN students s
            ON s.student_id = ste.student_id

        INNER JOIN curriculum cur
            ON cur.curriculum_id = ste.curriculum_id

        INNER JOIN courses c
            ON c.course_id = cur.course_id

        LEFT JOIN departments d
            ON d.department_id = c.department_id

        LEFT JOIN semesters entry_sem
            ON entry_sem.semester_id = ste.entry_semester_id

        LEFT JOIN users creator
            ON creator.user_id = ste.created_by

        LEFT JOIN users submitter
            ON submitter.user_id = ste.submitted_by

        LEFT JOIN users reviewer
            ON reviewer.user_id = ste.reviewed_by

        LEFT JOIN student_documents doc
            ON doc.document_id = ste.transcript_document_id

        LEFT JOIN student_transfer_subjects sts
            ON sts.transfer_evaluation_id =
               ste.transfer_evaluation_id

        ${where}

        GROUP BY
            ste.transfer_evaluation_id,
            ste.student_id,
            ste.curriculum_id,

            ste.source_school,
            ste.source_course,
            ste.source_student_number,

            ste.transcript_document_id,
            ste.transcript_reference,

            ste.entry_year_level,
            ste.entry_semester_id,
            entry_sem.semester_name,

            ste.evaluation_status,

            ste.created_by,
            creator.username,

            ste.submitted_by,
            submitter.username,
            ste.submitted_at,

            ste.reviewed_by,
            reviewer.username,
            ste.reviewed_at,
            ste.review_remarks,

            ste.remarks,
            ste.created_at,
            ste.updated_at,

            s.student_number,
            s.first_name,
            s.middle_name,
            s.last_name,
            s.year_level,

            cur.curriculum_name,
            cur.effective_year,
            cur.total_units,

            c.course_id,
            c.course_code,
            c.course_name,
            c.department_id,

            d.department_code,
            d.department_name,

            doc.document_type,
            doc.file_name,
            doc.verification_status

        ORDER BY
            CASE ste.evaluation_status
              WHEN 'Returned' THEN 1
              WHEN 'Draft' THEN 2
              WHEN 'Submitted' THEN 3
              WHEN 'Completed' THEN 4
              WHEN 'Cancelled' THEN 5
              ELSE 6
            END ASC,

            ste.updated_at DESC,
            ste.transfer_evaluation_id DESC
      `,
      params,
    );

    const evaluations = rows.map((row) => {
      const evaluationStatus = String(row.evaluation_status || "").trim();

      const editable = ["Draft", "Returned"].includes(evaluationStatus);

      return {
        transfer_evaluation_id: Number(row.transfer_evaluation_id),

        evaluation_status: evaluationStatus,

        student: {
          student_id: Number(row.student_id),

          student_number: row.student_number,

          student_name: [row.first_name, row.middle_name, row.last_name]
            .filter(Boolean)
            .join(" "),

          current_year_level:
            row.student_current_year_level !== null
              ? Number(row.student_current_year_level)
              : null,
        },

        curriculum: {
          curriculum_id: Number(row.curriculum_id),

          curriculum_name: row.curriculum_name,

          effective_year:
            row.effective_year !== null ? Number(row.effective_year) : null,

          total_units:
            row.curriculum_total_units !== null
              ? Number(row.curriculum_total_units)
              : null,

          course: {
            course_id: Number(row.course_id),

            course_code: row.course_code,

            course_name: row.course_name,

            department_id:
              row.department_id !== null ? Number(row.department_id) : null,

            department_code: row.department_code || null,

            department_name: row.department_name || null,
          },
        },

        source: {
          school: row.source_school,

          course: row.source_course || null,

          student_number: row.source_student_number || null,

          transcript_reference: row.transcript_reference || null,

          transcript_document:
            row.transcript_document_id !== null
              ? {
                  document_id: Number(row.transcript_document_id),

                  document_type: row.transcript_document_type || null,

                  file_name: row.transcript_file_name || null,

                  verification_status:
                    row.transcript_verification_status || null,
                }
              : null,
        },

        ptc_entry: {
          year_level:
            row.entry_year_level !== null ? Number(row.entry_year_level) : null,

          semester_id:
            row.entry_semester_id !== null
              ? Number(row.entry_semester_id)
              : null,

          semester_name: row.entry_semester_name || null,
        },

        workflow: {
          status: evaluationStatus,

          editable,

          can_submit: editable,

          awaiting_program_head_review: evaluationStatus === "Submitted",

          returned_for_correction: evaluationStatus === "Returned",

          completed: evaluationStatus === "Completed",

          read_only: !editable,

          created_by: row.created_by !== null ? Number(row.created_by) : null,

          created_by_username: row.created_by_username || null,

          submitted_by:
            row.submitted_by !== null ? Number(row.submitted_by) : null,

          submitted_by_username: row.submitted_by_username || null,

          submitted_at: row.submitted_at,

          reviewed_by:
            row.reviewed_by !== null ? Number(row.reviewed_by) : null,

          reviewed_by_username: row.reviewed_by_username || null,

          reviewed_at: row.reviewed_at,

          review_remarks: row.review_remarks || null,
        },

        summary: {
          total_subjects: Number(row.total_subjects || 0),

          mapped_subjects: Number(row.mapped_subjects || 0),

          unmapped_subjects: Number(row.unmapped_subjects || 0),

          pending_subjects: Number(row.pending_subjects || 0),

          credited_subjects: Number(row.credited_subjects || 0),

          not_credited_subjects: Number(row.not_credited_subjects || 0),
        },

        remarks: row.remarks || null,

        created_at: row.created_at,

        updated_at: row.updated_at,
      };
    });

    return res.status(200).json({
      success: true,

      code: "REGISTRAR_TRANSFER_EVALUATIONS_RETRIEVED",

      message: "Registrar transfer evaluations retrieved successfully.",

      filters: {
        status: status || null,

        student_id: studentId,

        search: search || null,
      },

      summary: {
        total_evaluations: evaluations.length,

        draft: evaluations.filter((item) => item.evaluation_status === "Draft")
          .length,

        submitted: evaluations.filter(
          (item) => item.evaluation_status === "Submitted",
        ).length,

        returned: evaluations.filter(
          (item) => item.evaluation_status === "Returned",
        ).length,

        completed: evaluations.filter(
          (item) => item.evaluation_status === "Completed",
        ).length,

        cancelled: evaluations.filter(
          (item) => item.evaluation_status === "Cancelled",
        ).length,
      },

      evaluations,

      academic_effect: {
        read_only: true,

        changes_ptc_grades: false,

        changes_transfer_evaluations: false,

        changes_current_enrollment: false,

        reason:
          "This endpoint only lists transfer evaluations for Registrar workflow management.",
      },

      actor: {
        user_id: actor.user_id,

        username: actor.username,
      },
    });
  } catch (error) {
    console.error("GET REGISTRAR TRANSFER EVALUATIONS ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "REGISTRAR_TRANSFER_EVALUATIONS_GET_FAILED",

      message: "Failed to retrieve Registrar transfer evaluations.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

router.get("/:id", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  try {
    const transferEvaluationId = toPositiveInt(req.params.id);

    if (!transferEvaluationId) {
      return res.status(400).json({
        success: false,

        code: "INVALID_TRANSFER_EVALUATION_ID",

        message: "A valid transfer evaluation ID is required.",
      });
    }

    const [evaluationRows] = await db.execute(
      `
          SELECT
              ste.transfer_evaluation_id,
              ste.student_id,
              ste.curriculum_id,

              ste.source_school,
              ste.source_course,
              ste.source_student_number,

              ste.transcript_document_id,
              ste.transcript_reference,

              ste.entry_year_level,
              ste.entry_semester_id,

              entry_sem.semester_name
                  AS entry_semester_name,

              ste.evaluation_status,

              ste.created_by,

              creator.username
                  AS created_by_username,

              ste.submitted_by,

              submitter.username
                  AS submitted_by_username,

              ste.submitted_at,

              ste.reviewed_by,

              reviewer.username
                  AS reviewed_by_username,

              ste.reviewed_at,
              ste.review_remarks,

              ste.remarks,
              ste.created_at,
              ste.updated_at,

              s.student_number,

              s.first_name,
              s.middle_name,
              s.last_name,

              s.year_level
                  AS student_current_year_level,

              s.course_id
                  AS student_course_id,

              cur.curriculum_name,
              cur.effective_year,

              cur.total_units
                  AS curriculum_total_units,

              cur.is_active
                  AS curriculum_is_active,

              c.course_id,
              c.course_code,
              c.course_name,
              c.total_years,
              c.department_id,

              d.department_code,
              d.department_name,

              doc.document_type
                  AS transcript_document_type,

              doc.file_name
                  AS transcript_file_name,

              doc.file_path
                  AS transcript_file_path,

              doc.verification_status
                  AS transcript_verification_status,

              doc.remarks
                  AS transcript_document_remarks,

              doc.verified_by
                  AS transcript_verified_by,

              doc.verified_at
                  AS transcript_verified_at,

              doc.uploaded_at
                  AS transcript_uploaded_at

          FROM student_transfer_evaluations ste

          INNER JOIN students s
              ON s.student_id =
                 ste.student_id

          INNER JOIN curriculum cur
              ON cur.curriculum_id =
                 ste.curriculum_id

          INNER JOIN courses c
              ON c.course_id =
                 cur.course_id

          LEFT JOIN departments d
              ON d.department_id =
                 c.department_id

          LEFT JOIN semesters entry_sem
              ON entry_sem.semester_id =
                 ste.entry_semester_id

          LEFT JOIN users creator
              ON creator.user_id =
                 ste.created_by

          LEFT JOIN users submitter
              ON submitter.user_id =
                 ste.submitted_by

          LEFT JOIN users reviewer
              ON reviewer.user_id =
                 ste.reviewed_by

          LEFT JOIN student_documents doc
              ON doc.document_id =
                 ste.transcript_document_id

          WHERE ste.transfer_evaluation_id = ?

          LIMIT 1
        `,
      [transferEvaluationId],
    );

    if (evaluationRows.length === 0) {
      return res.status(404).json({
        success: false,

        code: "TRANSFER_EVALUATION_NOT_FOUND",

        message: "Transfer evaluation not found.",
      });
    }

    const evaluation = evaluationRows[0];

    const [subjectRows] = await db.execute(
      `
          SELECT
              sts.transfer_subject_id,
              sts.transfer_evaluation_id,

              sts.source_subject_code,
              sts.source_subject_name,
              sts.source_units,
              sts.source_grade,
              sts.source_remarks,

              sts.source_academic_year,
              sts.source_year_level,
              sts.source_semester,

              sts.ptc_subject_id,
              sts.credited_units,
              sts.credit_status,
              sts.decision_reason,

              sts.reviewed_by,

              subject_reviewer.username
                  AS subject_reviewed_by_username,

              sts.reviewed_at,

              sts.created_at,
              sts.updated_at,

              ptc.subject_code
                  AS ptc_subject_code,

              ptc.subject_name
                  AS ptc_subject_name,

              ptc.units
                  AS ptc_subject_units,

              ptc.lecture_hours
                  AS ptc_lecture_hours,

              ptc.laboratory_hours
                  AS ptc_laboratory_hours,

              ptc.description
                  AS ptc_subject_description,

              ptc.is_active
                  AS ptc_subject_is_active,

              cs.curriculum_subject_id,

              cs.year_level
                  AS ptc_year_level,

              cs.semester_id
                  AS ptc_semester_id,

              ptc_sem.semester_name
                  AS ptc_semester_name,

              cs.is_required,
              cs.display_order

          FROM student_transfer_subjects sts

          LEFT JOIN subjects ptc
              ON ptc.subject_id =
                 sts.ptc_subject_id

          LEFT JOIN curriculum_subjects cs
              ON cs.curriculum_id = ?
             AND cs.subject_id =
                 sts.ptc_subject_id

          LEFT JOIN semesters ptc_sem
              ON ptc_sem.semester_id =
                 cs.semester_id

          LEFT JOIN users subject_reviewer
              ON subject_reviewer.user_id =
                 sts.reviewed_by

          WHERE sts.transfer_evaluation_id = ?

          ORDER BY
              COALESCE(
                sts.source_year_level,
                999
              ) ASC,

              sts.source_academic_year ASC,

              sts.source_semester ASC,

              sts.transfer_subject_id ASC
        `,
      [Number(evaluation.curriculum_id), transferEvaluationId],
    );

    const evaluationStatus = String(evaluation.evaluation_status || "").trim();

    const editable = ["Draft", "Returned"].includes(evaluationStatus);

    const subjects = subjectRows.map((row) => ({
      transfer_subject_id: Number(row.transfer_subject_id),

      transfer_evaluation_id: Number(row.transfer_evaluation_id),

      source: {
        subject_code: row.source_subject_code || null,

        subject_name: row.source_subject_name,

        units: row.source_units !== null ? Number(row.source_units) : null,

        grade: row.source_grade,

        remarks: row.source_remarks || null,

        academic_year: row.source_academic_year || null,

        year_level:
          row.source_year_level !== null ? Number(row.source_year_level) : null,

        semester: row.source_semester || null,
      },

      proposed_ptc_mapping:
        row.ptc_subject_id !== null
          ? {
              subject_id: Number(row.ptc_subject_id),

              subject_code: row.ptc_subject_code || null,

              subject_name: row.ptc_subject_name || null,

              units:
                row.ptc_subject_units !== null
                  ? Number(row.ptc_subject_units)
                  : null,

              lecture_hours:
                row.ptc_lecture_hours !== null
                  ? Number(row.ptc_lecture_hours)
                  : null,

              laboratory_hours:
                row.ptc_laboratory_hours !== null
                  ? Number(row.ptc_laboratory_hours)
                  : null,

              description: row.ptc_subject_description || null,

              currently_active:
                row.ptc_subject_is_active !== null
                  ? Number(row.ptc_subject_is_active) === 1
                  : null,

              curriculum_subject:
                row.curriculum_subject_id !== null
                  ? {
                      curriculum_subject_id: Number(row.curriculum_subject_id),

                      year_level:
                        row.ptc_year_level !== null
                          ? Number(row.ptc_year_level)
                          : null,

                      semester_id:
                        row.ptc_semester_id !== null
                          ? Number(row.ptc_semester_id)
                          : null,

                      semester_name: row.ptc_semester_name || null,

                      is_required:
                        row.is_required !== null
                          ? Number(row.is_required) === 1
                          : null,

                      display_order:
                        row.display_order !== null
                          ? Number(row.display_order)
                          : null,
                    }
                  : null,
            }
          : null,

      decision: {
        credit_status: row.credit_status,

        credited_units:
          row.credited_units !== null ? Number(row.credited_units) : null,

        decision_reason: row.decision_reason || null,

        reviewed_by: row.reviewed_by !== null ? Number(row.reviewed_by) : null,

        reviewed_by_username: row.subject_reviewed_by_username || null,

        reviewed_at: row.reviewed_at,
      },

      editable,

      created_at: row.created_at,

      updated_at: row.updated_at,
    }));

    const mappedSubjectIds = subjects
      .map((subject) => subject.proposed_ptc_mapping?.subject_id || null)
      .filter((subjectId) => subjectId !== null);

    const duplicateMappedSubjectIds = [
      ...new Set(
        mappedSubjectIds.filter(
          (subjectId, index) => mappedSubjectIds.indexOf(subjectId) !== index,
        ),
      ),
    ];

    const alreadyReviewedSubjects = subjects.filter(
      (subject) =>
        subject.decision.credit_status !== "Pending" ||
        subject.decision.reviewed_by !== null ||
        subject.decision.reviewed_at !== null,
    );

    const canSubmit =
      editable &&
      subjects.length > 0 &&
      alreadyReviewedSubjects.length === 0 &&
      duplicateMappedSubjectIds.length === 0;

    return res.status(200).json({
      success: true,

      code: "REGISTRAR_TRANSFER_EVALUATION_RETRIEVED",

      message: "Registrar transfer evaluation retrieved successfully.",

      evaluation: {
        transfer_evaluation_id: Number(evaluation.transfer_evaluation_id),

        evaluation_status: evaluationStatus,

        student: {
          student_id: Number(evaluation.student_id),

          student_number: evaluation.student_number,

          student_name: [
            evaluation.first_name,
            evaluation.middle_name,
            evaluation.last_name,
          ]
            .filter(Boolean)
            .join(" "),

          current_year_level:
            evaluation.student_current_year_level !== null
              ? Number(evaluation.student_current_year_level)
              : null,

          current_course_id:
            evaluation.student_course_id !== null
              ? Number(evaluation.student_course_id)
              : null,
        },

        curriculum: {
          curriculum_id: Number(evaluation.curriculum_id),

          curriculum_name: evaluation.curriculum_name,

          effective_year:
            evaluation.effective_year !== null
              ? Number(evaluation.effective_year)
              : null,

          total_units:
            evaluation.curriculum_total_units !== null
              ? Number(evaluation.curriculum_total_units)
              : null,

          currently_active: Number(evaluation.curriculum_is_active) === 1,

          course: {
            course_id: Number(evaluation.course_id),

            course_code: evaluation.course_code,

            course_name: evaluation.course_name,

            total_years:
              evaluation.total_years !== null
                ? Number(evaluation.total_years)
                : null,

            department_id:
              evaluation.department_id !== null
                ? Number(evaluation.department_id)
                : null,

            department_code: evaluation.department_code || null,

            department_name: evaluation.department_name || null,
          },
        },

        source: {
          school: evaluation.source_school,

          course: evaluation.source_course || null,

          student_number: evaluation.source_student_number || null,

          transcript_reference: evaluation.transcript_reference || null,

          transcript_document:
            evaluation.transcript_document_id !== null
              ? {
                  document_id: Number(evaluation.transcript_document_id),

                  document_type: evaluation.transcript_document_type || null,

                  file_name: evaluation.transcript_file_name || null,

                  file_path: evaluation.transcript_file_path || null,

                  verification_status:
                    evaluation.transcript_verification_status || null,

                  remarks: evaluation.transcript_document_remarks || null,

                  verified_by:
                    evaluation.transcript_verified_by !== null
                      ? Number(evaluation.transcript_verified_by)
                      : null,

                  verified_at: evaluation.transcript_verified_at,

                  uploaded_at: evaluation.transcript_uploaded_at,
                }
              : null,
        },

        ptc_entry: {
          year_level:
            evaluation.entry_year_level !== null
              ? Number(evaluation.entry_year_level)
              : null,

          semester_id:
            evaluation.entry_semester_id !== null
              ? Number(evaluation.entry_semester_id)
              : null,

          semester_name: evaluation.entry_semester_name || null,
        },

        workflow: {
          status: evaluationStatus,

          editable,

          can_submit: canSubmit,

          awaiting_program_head_review: evaluationStatus === "Submitted",

          returned_for_correction: evaluationStatus === "Returned",

          completed: evaluationStatus === "Completed",

          read_only: !editable,

          created_by:
            evaluation.created_by !== null
              ? Number(evaluation.created_by)
              : null,

          created_by_username: evaluation.created_by_username || null,

          submitted_by:
            evaluation.submitted_by !== null
              ? Number(evaluation.submitted_by)
              : null,

          submitted_by_username: evaluation.submitted_by_username || null,

          submitted_at: evaluation.submitted_at,

          reviewed_by:
            evaluation.reviewed_by !== null
              ? Number(evaluation.reviewed_by)
              : null,

          reviewed_by_username: evaluation.reviewed_by_username || null,

          reviewed_at: evaluation.reviewed_at,

          review_remarks: evaluation.review_remarks || null,
        },

        remarks: evaluation.remarks || null,

        created_at: evaluation.created_at,

        updated_at: evaluation.updated_at,
      },

      subjects,

      summary: {
        total_subjects: subjects.length,

        mapped_subjects: subjects.filter(
          (subject) => subject.proposed_ptc_mapping !== null,
        ).length,

        unmapped_subjects: subjects.filter(
          (subject) => subject.proposed_ptc_mapping === null,
        ).length,

        pending_subjects: subjects.filter(
          (subject) => subject.decision.credit_status === "Pending",
        ).length,

        credited_subjects: subjects.filter(
          (subject) => subject.decision.credit_status === "Credited",
        ).length,

        not_credited_subjects: subjects.filter(
          (subject) => subject.decision.credit_status === "Not Credited",
        ).length,

        duplicate_mapped_ptc_subject_ids: duplicateMappedSubjectIds,

        already_reviewed_subjects: alreadyReviewedSubjects.length,
      },

      academic_effect: {
        read_only: true,

        changes_ptc_grades: false,

        changes_transfer_evaluations: false,

        changes_current_enrollment: false,

        reason:
          "This endpoint only retrieves a transfer evaluation for Registrar workflow management.",
      },

      actor: {
        user_id: actor.user_id,

        username: actor.username,
      },
    });
  } catch (error) {
    console.error("GET REGISTRAR TRANSFER EVALUATION ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "REGISTRAR_TRANSFER_EVALUATION_GET_FAILED",

      message: "Failed to retrieve Registrar transfer evaluation.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});
// ============================================================
// EXPORT
// ============================================================

export default router;
