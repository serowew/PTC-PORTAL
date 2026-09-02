// routes/programhead/transferEvaluations.js
//
// ============================================================
// PTC PORTAL
// PROGRAM HEAD TRANSFER CREDIT EVALUATION
// ============================================================
//
// RESPONSIBILITY:
//
// Registrar:
// - encodes previous-school transcript
// - proposes PTC equivalency
// - submits evaluation
//
// Program Head:
// - reviews academic equivalency
// - decides Credited / Not Credited
// - returns evaluation for correction
// - completes evaluation
//
// SECURITY:
//
// JWT user_id
//      ↓
// faculty.user_id
//      ↓
// program_heads.faculty_id
//      ↓
// department_id
//
// Program Head may only access evaluations whose
// curriculum/course belongs to their own department.
//
// Never accept program_head_id / faculty_id / department_id
// from frontend.
// ============================================================

import express from "express";
import db from "../../db.js";

const router = express.Router();

// ============================================================
// HELPERS
// ============================================================

function toPositiveInt(value) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0 ? number : null;
}

// ============================================================
// GET AUTHENTICATED PROGRAM HEAD
// ============================================================

async function getAuthenticatedProgramHead(req, res) {
  if (!req.user) {
    res.status(401).json({
      success: false,
      code: "AUTHENTICATION_REQUIRED",
      message: "Authentication is required.",
    });

    return null;
  }

  if (req.user.role_name !== "Program Head") {
    res.status(403).json({
      success: false,
      code: "PROGRAM_HEAD_ACCESS_REQUIRED",
      message: "Program Head access is required.",
    });

    return null;
  }

  const userId = toPositiveInt(req.user.user_id);

  if (!userId) {
    res.status(401).json({
      success: false,
      code: "INVALID_AUTHENTICATED_USER",
      message: "Authenticated Program Head user ID is invalid.",
    });

    return null;
  }

  const [rows] = await db.execute(
    `
      SELECT
          ph.program_head_id,
          ph.faculty_id,
          ph.department_id,

          ph.start_date,
          ph.end_date,
          ph.is_active,

          f.user_id,
          f.employee_number,

          f.first_name,
          f.middle_name,
          f.last_name,

          f.email,

          u.username,

          d.department_code,
          d.department_name

      FROM program_heads ph

      INNER JOIN faculty f
          ON f.faculty_id =
             ph.faculty_id

      INNER JOIN users u
          ON u.user_id =
             f.user_id

      INNER JOIN departments d
          ON d.department_id =
             ph.department_id

      WHERE f.user_id = ?

        AND ph.is_active = 1

        AND (
          ph.start_date IS NULL
          OR ph.start_date <= CURDATE()
        )

        AND (
          ph.end_date IS NULL
          OR ph.end_date >= CURDATE()
        )

      LIMIT 1
    `,
    [userId],
  );

  if (rows.length === 0) {
    res.status(403).json({
      success: false,
      code: "PROGRAM_HEAD_ASSIGNMENT_NOT_FOUND",
      message: "No active Program Head assignment was found for this account.",
    });

    return null;
  }

  const row = rows[0];

  return {
    program_head_id: Number(row.program_head_id),

    faculty_id: Number(row.faculty_id),

    user_id: Number(row.user_id),

    employee_number: row.employee_number,

    username: row.username,

    first_name: row.first_name,

    middle_name: row.middle_name,

    last_name: row.last_name,

    program_head_name: [row.first_name, row.middle_name, row.last_name]
      .filter(Boolean)
      .join(" "),

    email: row.email,

    department_id: Number(row.department_id),

    department_code: row.department_code,

    department_name: row.department_name,
  };
}

// ============================================================
// ROUTE 1
// GET SUBMITTED TRANSFER EVALUATIONS
//
// GET
// /api/program-head/transfer-evaluations/submitted
//
// PURPOSE:
//
// Review queue for authenticated Program Head.
//
// SECURITY:
//
// Only evaluations whose:
//
// curriculum
//      ↓
// course
//      ↓
// department_id
//
// matches Program Head department.
//
// Only status Submitted appears here.
// ============================================================

router.get("/submitted", async (req, res) => {
  try {
    // ======================================================
    // 1. AUTHENTICATED PROGRAM HEAD
    // ======================================================

    const programHead = await getAuthenticatedProgramHead(req, res);

    if (!programHead) {
      return;
    }

    // ======================================================
    // 2. QUERY SUBMITTED EVALUATIONS
    //
    // Department protection happens in SQL itself.
    // ======================================================

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

              sem.semester_name
                  AS entry_semester_name,

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

              s.year_level
                  AS student_current_year_level,

              cur.curriculum_name,
              cur.effective_year,
              cur.total_units
                  AS curriculum_total_units,

              c.course_id,
              c.course_code,
              c.course_name,
              c.department_id,

              d.department_code,
              d.department_name,

              submitter.username
                  AS submitted_by_username,

              doc.document_type
                  AS transcript_document_type,

              doc.file_name
                  AS transcript_file_name,

              doc.verification_status
                  AS transcript_verification_status,

              COUNT(sts.transfer_subject_id)
                  AS total_subjects,

              COALESCE(
                SUM(
                  sts.ptc_subject_id IS NOT NULL
                ),
                0
              )
                  AS mapped_subjects,

              COALESCE(
                SUM(
                  sts.ptc_subject_id IS NULL
                ),
                0
              )
                  AS unmapped_subjects,

              COALESCE(
                SUM(
                  sts.credit_status = 'Pending'
                ),
                0
              )
                  AS pending_subjects,

              COALESCE(
                SUM(
                  sts.credit_status = 'Credited'
                ),
                0
              )
                  AS credited_subjects,

              COALESCE(
                SUM(
                  sts.credit_status =
                    'Not Credited'
                ),
                0
              )
                  AS not_credited_subjects

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

          INNER JOIN departments d
              ON d.department_id =
                 c.department_id

          LEFT JOIN semesters sem
              ON sem.semester_id =
                 ste.entry_semester_id

          LEFT JOIN users submitter
              ON submitter.user_id =
                 ste.submitted_by

          LEFT JOIN student_documents doc
              ON doc.document_id =
                 ste.transcript_document_id

          LEFT JOIN student_transfer_subjects sts
              ON sts.transfer_evaluation_id =
                 ste.transfer_evaluation_id

          WHERE
              ste.evaluation_status =
                  'Submitted'

              AND c.department_id = ?

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

              sem.semester_name,

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

              submitter.username,

              doc.document_type,
              doc.file_name,
              doc.verification_status

          ORDER BY
              ste.submitted_at ASC,
              ste.transfer_evaluation_id ASC
        `,
      [programHead.department_id],
    );

    // ======================================================
    // 3. FORMAT RESPONSE
    // ======================================================

    const evaluations = rows.map((row) => ({
      transfer_evaluation_id: Number(row.transfer_evaluation_id),

      evaluation_status: row.evaluation_status,

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

          department_id: Number(row.department_id),

          department_code: row.department_code,

          department_name: row.department_name,
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

                verification_status: row.transcript_verification_status || null,
              }
            : null,
      },

      ptc_entry: {
        year_level:
          row.entry_year_level !== null ? Number(row.entry_year_level) : null,

        semester_id:
          row.entry_semester_id !== null ? Number(row.entry_semester_id) : null,

        semester_name: row.entry_semester_name || null,
      },

      workflow: {
        submitted_by:
          row.submitted_by !== null ? Number(row.submitted_by) : null,

        submitted_by_username: row.submitted_by_username || null,

        submitted_at: row.submitted_at,

        reviewed_by: row.reviewed_by !== null ? Number(row.reviewed_by) : null,

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

        official_transfer_credits: 0,
      },

      remarks: row.remarks || null,

      created_at: row.created_at,

      updated_at: row.updated_at,
    }));

    // ======================================================
    // 4. RESPONSE
    // ======================================================

    return res.status(200).json({
      success: true,

      code: "SUBMITTED_TRANSFER_EVALUATIONS_RETRIEVED",

      message: "Submitted transfer evaluations retrieved successfully.",

      program_head: {
        program_head_id: programHead.program_head_id,

        faculty_id: programHead.faculty_id,

        user_id: programHead.user_id,

        employee_number: programHead.employee_number,

        username: programHead.username,

        program_head_name: programHead.program_head_name,

        department: {
          department_id: programHead.department_id,

          department_code: programHead.department_code,

          department_name: programHead.department_name,
        },
      },

      summary: {
        total_submitted: evaluations.length,

        total_subjects: evaluations.reduce(
          (total, item) => total + item.summary.total_subjects,
          0,
        ),

        mapped_subjects: evaluations.reduce(
          (total, item) => total + item.summary.mapped_subjects,
          0,
        ),

        unmapped_subjects: evaluations.reduce(
          (total, item) => total + item.summary.unmapped_subjects,
          0,
        ),

        pending_subjects: evaluations.reduce(
          (total, item) => total + item.summary.pending_subjects,
          0,
        ),

        official_transfer_credits: 0,
      },

      evaluations,

      academic_effect: {
        read_only: true,

        changes_ptc_grades: false,

        changes_current_enrollment: false,

        satisfies_curriculum_requirements: false,

        official_transfer_credit: false,

        reason:
          "This endpoint only retrieves transfer evaluations waiting for Program Head academic review.",
      },
    });
  } catch (error) {
    console.error("GET SUBMITTED TRANSFER EVALUATIONS ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "SUBMITTED_TRANSFER_EVALUATIONS_GET_FAILED",

      message: "Failed to retrieve submitted transfer evaluations.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================
// ROUTE 2
// GET ONE SUBMITTED TRANSFER EVALUATION FOR REVIEW
//
// GET
// /api/program-head/transfer-evaluations/:id
//
// PURPOSE:
//
// Program Head opens one submitted transfer evaluation and
// reviews:
//
// - student
// - evaluated curriculum
// - previous school
// - transcript information
// - every raw previous-school subject
// - Registrar-proposed PTC equivalency
//
// SECURITY:
//
// Evaluation must belong to a course under the authenticated
// Program Head's department.
//
// This endpoint is READ ONLY.
// ============================================================

router.get("/:id", async (req, res) => {
  try {
    // ========================================================
    // 1. AUTHENTICATED PROGRAM HEAD
    // ========================================================

    const programHead = await getAuthenticatedProgramHead(req, res);

    if (!programHead) {
      return;
    }

    // ========================================================
    // 2. EVALUATION ID
    // ========================================================

    const transferEvaluationId = toPositiveInt(req.params.id);

    if (!transferEvaluationId) {
      return res.status(400).json({
        success: false,

        code: "INVALID_TRANSFER_EVALUATION_ID",

        message: "A valid transfer evaluation ID is required.",
      });
    }

    // ========================================================
    // 3. GET EVALUATION HEADER
    //
    // Department authority is enforced directly in SQL.
    // ========================================================

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

          INNER JOIN departments d
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

          WHERE
              ste.transfer_evaluation_id = ?

              AND c.department_id = ?

          LIMIT 1
        `,
      [transferEvaluationId, programHead.department_id],
    );

    // ========================================================
    // 4. NOT FOUND / OUTSIDE DEPARTMENT
    //
    // Do not reveal whether an evaluation exists in another
    // department.
    // ========================================================

    if (evaluationRows.length === 0) {
      return res.status(404).json({
        success: false,

        code: "TRANSFER_EVALUATION_NOT_FOUND",

        message:
          "Transfer evaluation was not found or is outside your Program Head department.",
      });
    }

    const evaluation = evaluationRows[0];

    const evaluationStatus = String(evaluation.evaluation_status || "").trim();

    // ========================================================
    // 5. ONLY SUBMITTED IS REVIEWABLE HERE
    //
    // Completed / Returned / Cancelled records will later have
    // their own history/workflow handling.
    // ========================================================

    if (evaluationStatus !== "Submitted") {
      return res.status(409).json({
        success: false,

        code: "TRANSFER_EVALUATION_NOT_REVIEWABLE",

        message: `Transfer evaluation cannot be reviewed while its status is "${evaluationStatus}".`,

        evaluation_status: evaluationStatus,

        required_status: "Submitted",
      });
    }

    // ========================================================
    // 6. GET ALL TRANSFER SUBJECTS
    // ========================================================

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

          WHERE
              sts.transfer_evaluation_id = ?

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

    // ========================================================
    // 7. FORMAT SUBJECTS
    // ========================================================

    const subjects = subjectRows.map((row) => ({
      transfer_subject_id: Number(row.transfer_subject_id),

      transfer_evaluation_id: Number(row.transfer_evaluation_id),

      source: {
        subject_code: row.source_subject_code || null,

        subject_name: row.source_subject_name,

        units: row.source_units !== null ? Number(row.source_units) : null,

        grade: row.source_grade || null,

        remarks: row.source_remarks || null,

        academic_year: row.source_academic_year || null,

        year_level:
          row.source_year_level !== null ? Number(row.source_year_level) : null,

        semester: row.source_semester || null,
      },

      proposed_ptc_equivalency:
        row.ptc_subject_id !== null
          ? {
              curriculum_subject_id:
                row.curriculum_subject_id !== null
                  ? Number(row.curriculum_subject_id)
                  : null,

              subject_id: Number(row.ptc_subject_id),

              subject_code: row.ptc_subject_code,

              subject_name: row.ptc_subject_name,

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

              is_active: Number(row.ptc_subject_is_active) === 1,

              curriculum: {
                year_level:
                  row.ptc_year_level !== null
                    ? Number(row.ptc_year_level)
                    : null,

                semester_id:
                  row.ptc_semester_id !== null
                    ? Number(row.ptc_semester_id)
                    : null,

                semester_name: row.ptc_semester_name || null,

                is_required: Number(row.is_required) === 1,

                display_order:
                  row.display_order !== null ? Number(row.display_order) : null,
              },
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

      created_at: row.created_at,

      updated_at: row.updated_at,
    }));

    // ========================================================
    // 8. SUMMARY
    // ========================================================

    const mappedSubjects = subjects.filter(
      (subject) => subject.proposed_ptc_equivalency !== null,
    );

    const unmappedSubjects = subjects.filter(
      (subject) => subject.proposed_ptc_equivalency === null,
    );

    const pendingSubjects = subjects.filter(
      (subject) => subject.decision.credit_status === "Pending",
    );

    const creditedSubjects = subjects.filter(
      (subject) => subject.decision.credit_status === "Credited",
    );

    const notCreditedSubjects = subjects.filter(
      (subject) => subject.decision.credit_status === "Not Credited",
    );

    // ========================================================
    // 9. RESPONSE
    // ========================================================

    return res.status(200).json({
      success: true,

      code: "TRANSFER_EVALUATION_REVIEW_DETAIL_RETRIEVED",

      message: "Transfer evaluation review details retrieved successfully.",

      program_head: {
        program_head_id: programHead.program_head_id,

        faculty_id: programHead.faculty_id,

        user_id: programHead.user_id,

        employee_number: programHead.employee_number,

        username: programHead.username,

        program_head_name: programHead.program_head_name,

        department: {
          department_id: programHead.department_id,

          department_code: programHead.department_code,

          department_name: programHead.department_name,
        },
      },

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

          stored_course_id:
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

          is_active: Number(evaluation.curriculum_is_active) === 1,

          course: {
            course_id: Number(evaluation.course_id),

            course_code: evaluation.course_code,

            course_name: evaluation.course_name,

            total_years:
              evaluation.total_years !== null
                ? Number(evaluation.total_years)
                : null,

            department_id: Number(evaluation.department_id),

            department_code: evaluation.department_code,

            department_name: evaluation.department_name,
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

      summary: {
        total_subjects: subjects.length,

        mapped_subjects: mappedSubjects.length,

        unmapped_subjects: unmappedSubjects.length,

        pending_subjects: pendingSubjects.length,

        credited_subjects: creditedSubjects.length,

        not_credited_subjects: notCreditedSubjects.length,

        official_transfer_credits: 0,
      },

      review_readiness: {
        evaluation_status: evaluationStatus,

        can_review: evaluationStatus === "Submitted",

        can_make_subject_decisions:
          evaluationStatus === "Submitted" && subjects.length > 0,

        all_subjects_decided:
          subjects.length > 0 && pendingSubjects.length === 0,

        can_complete_evaluation:
          evaluationStatus === "Submitted" &&
          subjects.length > 0 &&
          pendingSubjects.length === 0,

        note:
          pendingSubjects.length > 0
            ? `${pendingSubjects.length} subject(s) still require a Credited or Not Credited academic decision.`
            : "All transfer subjects have academic decisions.",
      },

      subjects,

      academic_effect: {
        read_only: true,

        credit_decision_made: false,

        official_transfer_credit: false,

        satisfies_curriculum_requirements: false,

        changes_ptc_grades: false,

        changes_current_enrollment: false,

        reason:
          "Viewing a submitted transfer evaluation has no academic effect.",
      },

      next_action:
        "Program Head may now review each transcript subject and record a Credited or Not Credited academic decision.",
    });
  } catch (error) {
    console.error("GET TRANSFER EVALUATION REVIEW DETAIL ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "TRANSFER_EVALUATION_REVIEW_DETAIL_GET_FAILED",

      message: "Failed to retrieve transfer evaluation review details.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================
// ROUTE 3
// PROGRAM HEAD TRANSFER CREDIT DECISION
//
// PATCH
// /api/program-head/transfer-evaluations/:id
//     /subjects/:transferSubjectId/decision
//
// BODY:
//
// Credited:
//
// {
//   "credit_status": "Credited",
//   "decision_reason":
//     "Course content and units are equivalent."
// }
//
// Not Credited:
//
// {
//   "credit_status": "Not Credited",
//   "decision_reason":
//     "Course content does not sufficiently match the PTC requirement."
// }
//
// IMPORTANT:
//
// A subject-level Credited decision is NOT YET official.
//
// Official academic effect exists only when:
// student_transfer_evaluations.evaluation_status = 'Completed'
// ============================================================

router.patch("/:id/subjects/:transferSubjectId/decision", async (req, res) => {
  const programHead = await getAuthenticatedProgramHead(req, res);

  if (!programHead) {
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
  // 2. DECISION
  // ========================================================

  const creditStatus =
    typeof req.body?.credit_status === "string"
      ? req.body.credit_status.trim()
      : "";

  const allowedStatuses = ["Credited", "Not Credited"];

  if (!allowedStatuses.includes(creditStatus)) {
    return res.status(400).json({
      success: false,

      code: "INVALID_TRANSFER_CREDIT_STATUS",

      message: 'credit_status must be either "Credited" or "Not Credited".',

      allowed_statuses: allowedStatuses,
    });
  }

  // ========================================================
  // 3. DECISION REASON
  // ========================================================

  let decisionReason = null;

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "decision_reason")) {
    if (req.body.decision_reason === null || req.body.decision_reason === "") {
      decisionReason = null;
    } else if (typeof req.body.decision_reason !== "string") {
      return res.status(400).json({
        success: false,

        code: "INVALID_TRANSFER_DECISION_REASON",

        message: "decision_reason must be a text value or null.",
      });
    } else {
      decisionReason = req.body.decision_reason.trim() || null;
    }
  }

  if (decisionReason && decisionReason.length > 500) {
    return res.status(400).json({
      success: false,

      code: "TRANSFER_DECISION_REASON_TOO_LONG",

      message: "Transfer-credit decision reason cannot exceed 500 characters.",
    });
  }

  // --------------------------------------------------------
  // A rejection must explain why.
  // --------------------------------------------------------

  if (creditStatus === "Not Credited" && !decisionReason) {
    return res.status(400).json({
      success: false,

      code: "NOT_CREDITED_REASON_REQUIRED",

      message:
        "A decision reason is required when a transfer subject is marked Not Credited.",
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
    // 5. LOCK EVALUATION + ENFORCE DEPARTMENT AUTHORITY
    // ======================================================

    const [evaluationRows] = await connection.execute(
      `
            SELECT
                ste.transfer_evaluation_id,
                ste.student_id,
                ste.curriculum_id,
                ste.source_school,
                ste.evaluation_status,

                ste.submitted_by,
                ste.submitted_at,

                s.student_number,
                s.first_name,
                s.middle_name,
                s.last_name,

                cur.curriculum_name,

                c.course_id,
                c.course_code,
                c.course_name,
                c.department_id,

                d.department_code,
                d.department_name

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

            INNER JOIN departments d
                ON d.department_id =
                   c.department_id

            WHERE
                ste.transfer_evaluation_id = ?

                AND c.department_id = ?

            LIMIT 1

            FOR UPDATE
          `,
      [transferEvaluationId, programHead.department_id],
    );

    if (evaluationRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(404).json({
        success: false,

        code: "TRANSFER_EVALUATION_NOT_FOUND",

        message:
          "Transfer evaluation was not found or is outside your Program Head department.",
      });
    }

    const evaluation = evaluationRows[0];

    const evaluationStatus = String(evaluation.evaluation_status || "").trim();

    // ======================================================
    // 6. MUST BE SUBMITTED
    // ======================================================

    if (evaluationStatus !== "Submitted") {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "TRANSFER_EVALUATION_NOT_REVIEWABLE",

        message: `Transfer-credit decisions cannot be recorded while the evaluation status is "${evaluationStatus}".`,

        evaluation_status: evaluationStatus,

        required_status: "Submitted",
      });
    }

    // ======================================================
    // 7. LOCK TRANSFER SUBJECT
    // ======================================================

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

                ptc.subject_code
                    AS ptc_subject_code,

                ptc.subject_name
                    AS ptc_subject_name,

                ptc.units
                    AS ptc_subject_units,

                ptc.is_active
                    AS ptc_subject_is_active,

                cs.curriculum_subject_id,

                cs.year_level
                    AS ptc_year_level,

                cs.semester_id
                    AS ptc_semester_id,

                sem.semester_name
                    AS ptc_semester_name,

                cs.is_required

            FROM student_transfer_subjects sts

            LEFT JOIN subjects ptc
                ON ptc.subject_id =
                   sts.ptc_subject_id

            LEFT JOIN curriculum_subjects cs
                ON cs.curriculum_id = ?
               AND cs.subject_id =
                   sts.ptc_subject_id

            LEFT JOIN semesters sem
                ON sem.semester_id =
                   cs.semester_id

            WHERE
                sts.transfer_subject_id = ?

                AND sts.transfer_evaluation_id = ?

            LIMIT 1

            FOR UPDATE
          `,
      [
        Number(evaluation.curriculum_id),

        transferSubjectId,

        transferEvaluationId,
      ],
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

    const subject = subjectRows[0];

    // ======================================================
    // 8. CREDITED REQUIRES VALID PTC EQUIVALENCY
    // ======================================================

    if (creditStatus === "Credited") {
      if (subject.ptc_subject_id === null) {
        await connection.rollback();
        transactionActive = false;

        return res.status(409).json({
          success: false,

          code: "CREDITED_SUBJECT_REQUIRES_PTC_EQUIVALENCY",

          message:
            "A previous-school subject cannot be marked Credited without a proposed PTC subject equivalency.",
        });
      }

      if (subject.curriculum_subject_id === null) {
        await connection.rollback();
        transactionActive = false;

        return res.status(409).json({
          success: false,

          code: "PTC_EQUIVALENCY_NOT_IN_CURRICULUM",

          message:
            "The mapped PTC subject no longer belongs to the evaluated curriculum.",
        });
      }

      if (Number(subject.ptc_subject_is_active) !== 1) {
        await connection.rollback();
        transactionActive = false;

        return res.status(409).json({
          success: false,

          code: "PTC_EQUIVALENCY_INACTIVE",

          message: "The mapped PTC subject is inactive and cannot be credited.",
        });
      }

      if (subject.ptc_subject_units === null) {
        await connection.rollback();
        transactionActive = false;

        return res.status(409).json({
          success: false,

          code: "PTC_EQUIVALENCY_UNITS_MISSING",

          message:
            "The mapped PTC subject has no valid unit value and cannot be credited.",
        });
      }
    }

    // ======================================================
    // 9. CALCULATE CREDITED UNITS
    //
    // For a credited PTC curriculum requirement, use the
    // official PTC subject unit value.
    //
    // Do not trust credited_units from frontend.
    // ======================================================

    const creditedUnits =
      creditStatus === "Credited" ? Number(subject.ptc_subject_units) : null;

    if (
      creditStatus === "Credited" &&
      (!Number.isFinite(creditedUnits) || creditedUnits < 0)
    ) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "INVALID_PTC_CREDITED_UNITS",

        message: "The mapped PTC subject has an invalid unit value.",
      });
    }

    // ======================================================
    // 10. OLD VALUES
    // ======================================================

    const oldValues = {
      transfer_subject_id: transferSubjectId,

      transfer_evaluation_id: transferEvaluationId,

      source_subject_code: subject.source_subject_code,

      source_subject_name: subject.source_subject_name,

      source_grade: subject.source_grade,

      ptc_subject_id:
        subject.ptc_subject_id !== null ? Number(subject.ptc_subject_id) : null,

      credited_units:
        subject.credited_units !== null ? Number(subject.credited_units) : null,

      credit_status: subject.credit_status,

      decision_reason: subject.decision_reason,

      reviewed_by:
        subject.reviewed_by !== null ? Number(subject.reviewed_by) : null,

      reviewed_at: subject.reviewed_at,
    };

    // ======================================================
    // 11. UPDATE DECISION
    //
    // We intentionally allow Program Head to revise a
    // decision while the evaluation is still Submitted.
    //
    // Once evaluation becomes Completed, this endpoint locks.
    // ======================================================

    const [updateResult] = await connection.execute(
      `
            UPDATE student_transfer_subjects

            SET
                credited_units = ?,

                credit_status = ?,

                decision_reason = ?,

                reviewed_by = ?,

                reviewed_at = NOW()

            WHERE
                transfer_subject_id = ?

                AND transfer_evaluation_id = ?
          `,
      [
        creditedUnits,

        creditStatus,

        decisionReason,

        Number(programHead.user_id),

        transferSubjectId,

        transferEvaluationId,
      ],
    );

    if (updateResult.affectedRows !== 1) {
      throw new Error(
        "Transfer-credit decision update did not affect exactly one row.",
      );
    }

    // ======================================================
    // 12. GET UPDATED SUBJECT
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

                reviewer.username
                    AS reviewed_by_username,

                ptc.subject_code
                    AS ptc_subject_code,

                ptc.subject_name
                    AS ptc_subject_name,

                ptc.units
                    AS ptc_subject_units,

                cs.curriculum_subject_id,

                cs.year_level
                    AS ptc_year_level,

                cs.semester_id
                    AS ptc_semester_id,

                sem.semester_name
                    AS ptc_semester_name,

                cs.is_required

            FROM student_transfer_subjects sts

            LEFT JOIN users reviewer
                ON reviewer.user_id =
                   sts.reviewed_by

            LEFT JOIN subjects ptc
                ON ptc.subject_id =
                   sts.ptc_subject_id

            LEFT JOIN curriculum_subjects cs
                ON cs.curriculum_id = ?
               AND cs.subject_id =
                   sts.ptc_subject_id

            LEFT JOIN semesters sem
                ON sem.semester_id =
                   cs.semester_id

            WHERE
                sts.transfer_subject_id = ?

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
      throw new Error(
        "Updated transfer-credit decision could not be retrieved.",
      );
    }

    const updated = updatedRows[0];

    // ======================================================
    // 13. NEW AUDIT VALUES
    // ======================================================

    const newValues = {
      transfer_subject_id: transferSubjectId,

      transfer_evaluation_id: transferEvaluationId,

      source_subject_code: updated.source_subject_code,

      source_subject_name: updated.source_subject_name,

      source_grade: updated.source_grade,

      ptc_subject_id:
        updated.ptc_subject_id !== null ? Number(updated.ptc_subject_id) : null,

      credited_units:
        updated.credited_units !== null ? Number(updated.credited_units) : null,

      credit_status: updated.credit_status,

      decision_reason: updated.decision_reason,

      reviewed_by:
        updated.reviewed_by !== null ? Number(updated.reviewed_by) : null,

      reviewed_at: updated.reviewed_at,

      decision_action:
        oldValues.credit_status === "Pending"
          ? "TRANSFER_CREDIT_DECISION_RECORDED"
          : "TRANSFER_CREDIT_DECISION_REVISED",

      evaluation_status: evaluationStatus,

      official_transfer_credit: false,
    };

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
        Number(programHead.user_id),

        transferSubjectId,

        JSON.stringify(oldValues),

        JSON.stringify(newValues),
      ],
    );

    // ======================================================
    // 15. EVALUATION SUMMARY AFTER DECISION
    // ======================================================

    const [summaryRows] = await connection.execute(
      `
            SELECT
                COUNT(*)
                    AS total_subjects,

                COALESCE(
                  SUM(
                    ptc_subject_id IS NOT NULL
                  ),
                  0
                )
                    AS mapped_subjects,

                COALESCE(
                  SUM(
                    ptc_subject_id IS NULL
                  ),
                  0
                )
                    AS unmapped_subjects,

                COALESCE(
                  SUM(
                    credit_status = 'Pending'
                  ),
                  0
                )
                    AS pending_subjects,

                COALESCE(
                  SUM(
                    credit_status = 'Credited'
                  ),
                  0
                )
                    AS credited_subjects,

                COALESCE(
                  SUM(
                    credit_status =
                      'Not Credited'
                  ),
                  0
                )
                    AS not_credited_subjects

            FROM student_transfer_subjects

            WHERE transfer_evaluation_id = ?
          `,
      [transferEvaluationId],
    );

    const summaryRow = summaryRows[0];

    const summary = {
      total_subjects: Number(summaryRow.total_subjects || 0),

      mapped_subjects: Number(summaryRow.mapped_subjects || 0),

      unmapped_subjects: Number(summaryRow.unmapped_subjects || 0),

      pending_subjects: Number(summaryRow.pending_subjects || 0),

      credited_subjects: Number(summaryRow.credited_subjects || 0),

      not_credited_subjects: Number(summaryRow.not_credited_subjects || 0),

      // ----------------------------------------------
      // Header is still Submitted.
      // Therefore zero official credits.
      // ----------------------------------------------

      official_transfer_credits: 0,
    };

    const allSubjectsDecided =
      summary.total_subjects > 0 && summary.pending_subjects === 0;

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

      code: "TRANSFER_CREDIT_DECISION_RECORDED",

      message:
        creditStatus === "Credited"
          ? `${updated.source_subject_code || updated.source_subject_name} was academically approved as equivalent to ${updated.ptc_subject_code}. The credit is not official until the transfer evaluation is completed.`
          : `${updated.source_subject_code || updated.source_subject_name} was marked Not Credited.`,

      evaluation: {
        transfer_evaluation_id: transferEvaluationId,

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
        },

        curriculum: {
          curriculum_id: Number(evaluation.curriculum_id),

          curriculum_name: evaluation.curriculum_name,

          course: {
            course_id: Number(evaluation.course_id),

            course_code: evaluation.course_code,

            course_name: evaluation.course_name,

            department_id: Number(evaluation.department_id),

            department_code: evaluation.department_code,

            department_name: evaluation.department_name,
          },
        },
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

        proposed_ptc_equivalency:
          updated.ptc_subject_id !== null
            ? {
                curriculum_subject_id:
                  updated.curriculum_subject_id !== null
                    ? Number(updated.curriculum_subject_id)
                    : null,

                subject_id: Number(updated.ptc_subject_id),

                subject_code: updated.ptc_subject_code,

                subject_name: updated.ptc_subject_name,

                units:
                  updated.ptc_subject_units !== null
                    ? Number(updated.ptc_subject_units)
                    : null,

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
              }
            : null,

        decision: {
          previous_credit_status: oldValues.credit_status,

          credit_status: updated.credit_status,

          credited_units:
            updated.credited_units !== null
              ? Number(updated.credited_units)
              : null,

          decision_reason: updated.decision_reason || null,

          reviewed_by:
            updated.reviewed_by !== null ? Number(updated.reviewed_by) : null,

          reviewed_by_username: updated.reviewed_by_username || null,

          reviewed_at: updated.reviewed_at,
        },
      },

      summary,

      review_readiness: {
        all_subjects_decided: allSubjectsDecided,

        pending_subjects: summary.pending_subjects,

        can_complete_evaluation:
          evaluationStatus === "Submitted" && allSubjectsDecided,

        note: allSubjectsDecided
          ? "All transfer subjects now have academic decisions. The evaluation may be completed."
          : `${summary.pending_subjects} subject(s) still require an academic decision.`,
      },

      academic_effect: {
        credit_decision_made: true,

        subject_decision: updated.credit_status,

        subject_marked_credited: updated.credit_status === "Credited",

        official_transfer_credit: false,

        satisfies_curriculum_requirements: false,

        changes_ptc_grades: false,

        changes_current_enrollment: false,

        reason:
          "The Program Head recorded a subject-level academic decision, but transfer credit becomes official only after the complete transfer evaluation is marked Completed.",
      },

      next_action: allSubjectsDecided
        ? "All subjects have decisions. The Program Head may now complete the transfer evaluation."
        : "Continue reviewing the remaining Pending transfer subjects.",

      actor: {
        user_id: programHead.user_id,

        username: programHead.username,

        program_head_id: programHead.program_head_id,

        department_id: programHead.department_id,
      },
    });
  } catch (error) {
    if (connection && transactionActive) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "TRANSFER CREDIT DECISION ROLLBACK ERROR:",
          rollbackError,
        );
      }
    }

    console.error("TRANSFER CREDIT DECISION ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "TRANSFER_CREDIT_DECISION_FAILED",

      message: "Failed to record transfer-credit decision.",

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
// RETURN TRANSFER EVALUATION TO REGISTRAR
//
// PATCH
// /api/program-head/transfer-evaluations/:id/return
//
// BODY:
//
// {
//   "review_remarks":
//     "Please verify the transcript information and proposed equivalency."
// }
//
// WORKFLOW:
//
// Submitted
//    ↓
// Returned
//    ↓
// Registrar correction
//    ↓
// Resubmit
//
// IMPORTANT:
//
// Returning an evaluation reopens its subject decisions:
//
// credit_status   -> Pending
// credited_units  -> NULL
// decision_reason -> NULL
// reviewed_by     -> NULL
// reviewed_at     -> NULL
//
// Existing raw transcript information and ptc_subject_id
// mapping are preserved.
//
// This is necessary so Registrar correction routes and
// resubmission can work safely.
// ============================================================

router.patch("/:id/return", async (req, res) => {
  const programHead = await getAuthenticatedProgramHead(req, res);

  if (!programHead) {
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

  // ==========================================================
  // 2. RETURN REASON
  // ==========================================================

  const reviewRemarks =
    typeof req.body?.review_remarks === "string"
      ? req.body.review_remarks.trim()
      : "";

  if (!reviewRemarks) {
    return res.status(400).json({
      success: false,

      code: "TRANSFER_RETURN_REASON_REQUIRED",

      message: "A return reason is required.",
    });
  }

  if (reviewRemarks.length > 500) {
    return res.status(400).json({
      success: false,

      code: "TRANSFER_RETURN_REASON_TOO_LONG",

      message: "Return reason cannot exceed 500 characters.",
    });
  }

  let connection;
  let transactionActive = false;

  try {
    // ========================================================
    // 3. TRANSACTION
    // ========================================================

    connection = await db.getConnection();

    await connection.beginTransaction();

    transactionActive = true;

    // ========================================================
    // 4. LOCK EVALUATION + ENFORCE PROGRAM HEAD DEPARTMENT
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
              ste.submitted_at,

              ste.reviewed_by,
              ste.reviewed_at,
              ste.review_remarks,

              ste.remarks,

              s.student_number,
              s.first_name,
              s.middle_name,
              s.last_name,

              cur.curriculum_name,

              c.course_id,
              c.course_code,
              c.course_name,
              c.department_id,

              d.department_code,
              d.department_name

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

          INNER JOIN departments d
              ON d.department_id =
                 c.department_id

          WHERE
              ste.transfer_evaluation_id = ?

              AND c.department_id = ?

          LIMIT 1

          FOR UPDATE
        `,
      [transferEvaluationId, programHead.department_id],
    );

    if (evaluationRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(404).json({
        success: false,

        code: "TRANSFER_EVALUATION_NOT_FOUND",

        message:
          "Transfer evaluation was not found or is outside your Program Head department.",
      });
    }

    const evaluation = evaluationRows[0];

    const currentStatus = String(evaluation.evaluation_status || "").trim();

    // ========================================================
    // 5. ONLY SUBMITTED MAY BE RETURNED
    // ========================================================

    if (currentStatus !== "Submitted") {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "TRANSFER_EVALUATION_NOT_RETURNABLE",

        message: `Transfer evaluation cannot be returned while its current status is "${currentStatus}".`,

        evaluation_status: currentStatus,

        required_status: "Submitted",
      });
    }

    // ========================================================
    // 6. LOCK ALL TRANSFER SUBJECTS
    // ========================================================

    const [subjectRows] = await connection.execute(
      `
          SELECT
              transfer_subject_id,
              transfer_evaluation_id,

              source_subject_code,
              source_subject_name,
              source_grade,

              ptc_subject_id,

              credited_units,
              credit_status,
              decision_reason,

              reviewed_by,
              reviewed_at

          FROM student_transfer_subjects

          WHERE transfer_evaluation_id = ?

          ORDER BY
              transfer_subject_id ASC

          FOR UPDATE
        `,
      [transferEvaluationId],
    );

    if (subjectRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "TRANSFER_EVALUATION_HAS_NO_SUBJECTS",

        message:
          "Transfer evaluation has no previous-school subjects and cannot be returned through the academic review workflow.",
      });
    }

    // ========================================================
    // 7. HEADER OLD VALUES
    // ========================================================

    const oldEvaluationValues = {
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
    // 8. UPDATE HEADER
    //
    // Preserve submitted_by/submitted_at as submission history.
    //
    // reviewed_by / reviewed_at / review_remarks describe
    // this Program Head return action.
    // ========================================================

    const [headerUpdateResult] = await connection.execute(
      `
          UPDATE student_transfer_evaluations

          SET
              evaluation_status =
                  'Returned',

              reviewed_by = ?,

              reviewed_at = NOW(),

              review_remarks = ?

          WHERE
              transfer_evaluation_id = ?

              AND evaluation_status =
                  'Submitted'
        `,
      [Number(programHead.user_id), reviewRemarks, transferEvaluationId],
    );

    if (headerUpdateResult.affectedRows !== 1) {
      throw new Error(
        "Transfer evaluation return did not affect exactly one header row.",
      );
    }

    // ========================================================
    // 9. GET UPDATED HEADER
    // ========================================================

    const [returnedRows] = await connection.execute(
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

    if (returnedRows.length === 0) {
      throw new Error("Returned transfer evaluation could not be retrieved.");
    }

    const returned = returnedRows[0];

    // ========================================================
    // 10. RESET SUBJECT-LEVEL ACADEMIC DECISIONS
    //
    // Preserve:
    // - raw transcript values
    // - ptc_subject_id mapping
    //
    // Reset:
    // - credited_units
    // - credit_status
    // - decision_reason
    // - reviewed_by
    // - reviewed_at
    // ========================================================

    const subjectsWithReviewState = subjectRows.filter(
      (row) =>
        row.credit_status !== "Pending" ||
        row.credited_units !== null ||
        row.decision_reason !== null ||
        row.reviewed_by !== null ||
        row.reviewed_at !== null,
    );

    const [subjectResetResult] = await connection.execute(
      `
          UPDATE student_transfer_subjects

          SET
              credited_units = NULL,

              credit_status =
                  'Pending',

              decision_reason = NULL,

              reviewed_by = NULL,

              reviewed_at = NULL

          WHERE transfer_evaluation_id = ?
        `,
      [transferEvaluationId],
    );

    if (subjectResetResult.affectedRows !== subjectRows.length) {
      throw new Error(
        "Transfer subject decision reset did not affect the expected number of rows.",
      );
    }

    // ========================================================
    // 11. AUDIT SUBJECT DECISION RESETS
    //
    // Only subjects that actually had review/decision state
    // need an UPDATE audit entry.
    // ========================================================

    for (const subject of subjectsWithReviewState) {
      const oldSubjectValues = {
        transfer_subject_id: Number(subject.transfer_subject_id),

        transfer_evaluation_id: transferEvaluationId,

        source_subject_code: subject.source_subject_code,

        source_subject_name: subject.source_subject_name,

        source_grade: subject.source_grade,

        ptc_subject_id:
          subject.ptc_subject_id !== null
            ? Number(subject.ptc_subject_id)
            : null,

        credited_units:
          subject.credited_units !== null
            ? Number(subject.credited_units)
            : null,

        credit_status: subject.credit_status,

        decision_reason: subject.decision_reason,

        reviewed_by:
          subject.reviewed_by !== null ? Number(subject.reviewed_by) : null,

        reviewed_at: subject.reviewed_at,
      };

      const newSubjectValues = {
        ...oldSubjectValues,

        credited_units: null,

        credit_status: "Pending",

        decision_reason: null,

        reviewed_by: null,

        reviewed_at: null,

        workflow_action: "TRANSFER_DECISION_RESET_ON_RETURN",

        returned_by: Number(programHead.user_id),

        return_reason: reviewRemarks,

        evaluation_status: "Returned",

        official_transfer_credit: false,
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
              'UPDATE',
              ?,
              ?
          )
        `,
        [
          Number(programHead.user_id),

          Number(subject.transfer_subject_id),

          JSON.stringify(oldSubjectValues),

          JSON.stringify(newSubjectValues),
        ],
      );
    }

    // ========================================================
    // 12. HEADER AUDIT
    // ========================================================
    const newEvaluationValues = {
      transfer_evaluation_id: transferEvaluationId,

      evaluation_status: "Returned",

      submitted_by:
        returned.submitted_by !== null ? Number(returned.submitted_by) : null,

      submitted_at: returned.submitted_at,

      reviewed_by:
        returned.reviewed_by !== null ? Number(returned.reviewed_by) : null,

      reviewed_at: returned.reviewed_at,

      review_remarks: returned.review_remarks,

      returned_by:
        returned.reviewed_by !== null ? Number(returned.reviewed_by) : null,

      returned_at: returned.reviewed_at,

      return_reason: returned.review_remarks,

      workflow_action: "RETURNED_FOR_REGISTRAR_CORRECTION",

      reset_subject_decisions: subjectsWithReviewState.length,

      total_subjects: subjectRows.length,

      official_transfer_credit: false,
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
        Number(programHead.user_id),

        transferEvaluationId,

        JSON.stringify(oldEvaluationValues),

        JSON.stringify(newEvaluationValues),
      ],
    );

    // ========================================================
    // 13. GET RESET SUBJECT SUMMARY
    // ========================================================

    const [summaryRows] = await connection.execute(
      `
          SELECT
              COUNT(*)
                  AS total_subjects,

              COALESCE(
                SUM(
                  ptc_subject_id IS NOT NULL
                ),
                0
              )
                  AS mapped_subjects,

              COALESCE(
                SUM(
                  ptc_subject_id IS NULL
                ),
                0
              )
                  AS unmapped_subjects,

              COALESCE(
                SUM(
                  credit_status = 'Pending'
                ),
                0
              )
                  AS pending_subjects,

              COALESCE(
                SUM(
                  credit_status = 'Credited'
                ),
                0
              )
                  AS credited_subjects,

              COALESCE(
                SUM(
                  credit_status =
                    'Not Credited'
                ),
                0
              )
                  AS not_credited_subjects

          FROM student_transfer_subjects

          WHERE transfer_evaluation_id = ?
        `,
      [transferEvaluationId],
    );

    const summaryRow = summaryRows[0];

    const summary = {
      total_subjects: Number(summaryRow.total_subjects || 0),

      mapped_subjects: Number(summaryRow.mapped_subjects || 0),

      unmapped_subjects: Number(summaryRow.unmapped_subjects || 0),

      pending_subjects: Number(summaryRow.pending_subjects || 0),

      credited_subjects: Number(summaryRow.credited_subjects || 0),

      not_credited_subjects: Number(summaryRow.not_credited_subjects || 0),

      official_transfer_credits: 0,
    };

    // ========================================================
    // 14. COMMIT
    // ========================================================

    await connection.commit();

    transactionActive = false;

    // ========================================================
    // 15. RESPONSE
    // ========================================================

    return res.status(200).json({
      success: true,

      code: "TRANSFER_EVALUATION_RETURNED",

      message: "Transfer evaluation returned to the Registrar for correction.",

      evaluation: {
        transfer_evaluation_id: transferEvaluationId,

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

          course: {
            course_id: Number(evaluation.course_id),

            course_code: evaluation.course_code,

            course_name: evaluation.course_name,

            department_id: Number(evaluation.department_id),

            department_code: evaluation.department_code,

            department_name: evaluation.department_name,
          },
        },

        workflow: {
          previous_status: currentStatus,

          current_status: returned.evaluation_status,

          submitted_by:
            returned.submitted_by !== null
              ? Number(returned.submitted_by)
              : null,

          submitted_at: returned.submitted_at,

          returned_by:
            returned.reviewed_by !== null ? Number(returned.reviewed_by) : null,

          returned_at: returned.reviewed_at,

          return_reason: returned.review_remarks,
        },
      },

      correction_state: {
        raw_transcript_preserved: true,

        ptc_mappings_preserved: true,

        academic_decisions_reset: true,

        reset_subject_decisions: subjectsWithReviewState.length,

        registrar_may_edit: true,

        registrar_may_resubmit: true,
      },

      summary,

      academic_effect: {
        evaluation_returned: true,

        subject_decisions_reopened: true,

        official_transfer_credit: false,

        satisfies_curriculum_requirements: false,

        changes_ptc_grades: false,

        changes_current_enrollment: false,

        reason:
          "The transfer evaluation was returned for correction. Previous academic credit decisions were reset to Pending and no transfer credit is official.",
      },

      next_action:
        "Registrar may correct the transcript information or proposed PTC mappings and resubmit the evaluation for Program Head review.",

      actor: {
        user_id: programHead.user_id,

        username: programHead.username,

        program_head_id: programHead.program_head_id,

        department_id: programHead.department_id,
      },
    });
  } catch (error) {
    if (connection && transactionActive) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "RETURN TRANSFER EVALUATION ROLLBACK ERROR:",
          rollbackError,
        );
      }
    }

    console.error("RETURN TRANSFER EVALUATION ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "TRANSFER_EVALUATION_RETURN_FAILED",

      message: "Failed to return transfer evaluation to the Registrar.",

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
// COMPLETE TRANSFER EVALUATION
//
// POST
// /api/program-head/transfer-evaluations/:id/complete
//
// Optional body:
//
// {
//   "review_remarks":
//     "Transfer-credit evaluation completed after academic review."
// }
//
// WORKFLOW:
//
// Submitted
//    ↓
// all subjects must have decisions
//    ↓
// Completed
//
// OFFICIAL TRANSFER CREDIT RULE:
//
// evaluation_status = 'Completed'
//            +
// credit_status = 'Credited'
//
// Only that combination satisfies a PTC curriculum requirement.
//
// This route does NOT create a normal PTC grade.
// ============================================================

router.post("/:id/complete", async (req, res) => {
  const programHead = await getAuthenticatedProgramHead(req, res);

  if (!programHead) {
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

  // ==========================================================
  // 2. OPTIONAL COMPLETION REMARKS
  // ==========================================================

  let reviewRemarks = null;

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "review_remarks")) {
    if (req.body.review_remarks === null || req.body.review_remarks === "") {
      reviewRemarks = null;
    } else if (typeof req.body.review_remarks !== "string") {
      return res.status(400).json({
        success: false,
        code: "INVALID_TRANSFER_REVIEW_REMARKS",
        message: "review_remarks must be a text value or null.",
      });
    } else {
      reviewRemarks = req.body.review_remarks.trim() || null;
    }
  }

  if (reviewRemarks && reviewRemarks.length > 500) {
    return res.status(400).json({
      success: false,
      code: "TRANSFER_REVIEW_REMARKS_TOO_LONG",
      message: "Review remarks cannot exceed 500 characters.",
    });
  }

  let connection;
  let transactionActive = false;

  try {
    // ========================================================
    // 3. TRANSACTION
    // ========================================================

    connection = await db.getConnection();

    await connection.beginTransaction();

    transactionActive = true;

    // ========================================================
    // 4. LOCK EVALUATION + ENFORCE DEPARTMENT AUTHORITY
    // ========================================================

    const [evaluationRows] = await connection.execute(
      `
          SELECT
              ste.transfer_evaluation_id,
              ste.student_id,
              ste.curriculum_id,

              ste.source_school,
              ste.source_course,

              ste.evaluation_status,

              ste.created_by,

              ste.submitted_by,
              ste.submitted_at,

              ste.reviewed_by,
              ste.reviewed_at,
              ste.review_remarks,

              ste.remarks,

              s.student_number,
              s.first_name,
              s.middle_name,
              s.last_name,

              cur.curriculum_name,
              cur.effective_year,

              c.course_id,
              c.course_code,
              c.course_name,
              c.department_id,

              d.department_code,
              d.department_name

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

          INNER JOIN departments d
              ON d.department_id =
                 c.department_id

          WHERE
              ste.transfer_evaluation_id = ?

              AND c.department_id = ?

          LIMIT 1

          FOR UPDATE
        `,
      [transferEvaluationId, programHead.department_id],
    );

    if (evaluationRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(404).json({
        success: false,
        code: "TRANSFER_EVALUATION_NOT_FOUND",
        message:
          "Transfer evaluation was not found or is outside your Program Head department.",
      });
    }

    const evaluation = evaluationRows[0];

    const currentStatus = String(evaluation.evaluation_status || "").trim();

    // ========================================================
    // 5. ONLY SUBMITTED CAN BE COMPLETED
    // ========================================================

    if (currentStatus !== "Submitted") {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "TRANSFER_EVALUATION_NOT_COMPLETABLE",

        message: `Transfer evaluation cannot be completed while its current status is "${currentStatus}".`,

        evaluation_status: currentStatus,

        required_status: "Submitted",
      });
    }

    // ========================================================
    // 6. LOCK ALL SUBJECT DECISIONS
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

              sts.ptc_subject_id,
              sts.credited_units,
              sts.credit_status,
              sts.decision_reason,

              sts.reviewed_by,
              sts.reviewed_at,

              ptc.subject_code
                  AS ptc_subject_code,

              ptc.subject_name
                  AS ptc_subject_name,

              ptc.units
                  AS ptc_subject_units,

              ptc.is_active
                  AS ptc_subject_is_active,

              cs.curriculum_subject_id,
              cs.year_level
                  AS ptc_year_level,
              cs.semester_id
                  AS ptc_semester_id,
              cs.is_required

          FROM student_transfer_subjects sts

          LEFT JOIN subjects ptc
              ON ptc.subject_id =
                 sts.ptc_subject_id

          LEFT JOIN curriculum_subjects cs
              ON cs.curriculum_id = ?
             AND cs.subject_id =
                 sts.ptc_subject_id

          WHERE
              sts.transfer_evaluation_id = ?

          ORDER BY
              sts.transfer_subject_id ASC

          FOR UPDATE
        `,
      [Number(evaluation.curriculum_id), transferEvaluationId],
    );

    if (subjectRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "TRANSFER_EVALUATION_HAS_NO_SUBJECTS",

        message:
          "Transfer evaluation has no previous-school subjects and cannot be completed.",
      });
    }

    // ========================================================
    // 7. VALIDATE ALL ACADEMIC DECISIONS
    // ========================================================

    const validationErrors = [];

    const mappedSubjectIds = new Set();

    for (const subject of subjectRows) {
      const transferSubjectId = Number(subject.transfer_subject_id);

      const creditStatus = String(subject.credit_status || "").trim();

      // ------------------------------------------------------
      // Pending is never allowed at completion.
      // ------------------------------------------------------

      if (creditStatus === "Pending") {
        validationErrors.push({
          code: "TRANSFER_SUBJECT_DECISION_PENDING",

          transfer_subject_id: transferSubjectId,

          source_subject_code: subject.source_subject_code,

          source_subject_name: subject.source_subject_name,

          message:
            "This previous-school subject still requires a Credited or Not Credited decision.",
        });

        continue;
      }

      if (creditStatus !== "Credited" && creditStatus !== "Not Credited") {
        validationErrors.push({
          code: "INVALID_TRANSFER_SUBJECT_DECISION",

          transfer_subject_id: transferSubjectId,

          message: `Invalid transfer-credit status "${creditStatus}".`,
        });

        continue;
      }

      // ------------------------------------------------------
      // Every final academic decision must have review actor
      // and timestamp.
      // ------------------------------------------------------

      if (subject.reviewed_by === null || subject.reviewed_at === null) {
        validationErrors.push({
          code: "TRANSFER_SUBJECT_REVIEW_INCOMPLETE",

          transfer_subject_id: transferSubjectId,

          message:
            "Transfer subject has a decision but is missing Program Head review information.",
        });
      }

      // ======================================================
      // CREDITED VALIDATION
      // ======================================================

      if (creditStatus === "Credited") {
        if (subject.ptc_subject_id === null) {
          validationErrors.push({
            code: "CREDITED_SUBJECT_REQUIRES_PTC_EQUIVALENCY",

            transfer_subject_id: transferSubjectId,

            message:
              "A credited previous-school subject must have a mapped PTC curriculum subject.",
          });

          continue;
        }

        const ptcSubjectId = Number(subject.ptc_subject_id);

        // ----------------------------------------------------
        // Prevent multiple external rows from satisfying the
        // same PTC requirement inside one evaluation.
        // ----------------------------------------------------

        if (mappedSubjectIds.has(ptcSubjectId)) {
          validationErrors.push({
            code: "DUPLICATE_CREDITED_PTC_EQUIVALENCY",

            transfer_subject_id: transferSubjectId,

            ptc_subject_id: ptcSubjectId,

            message:
              "More than one credited previous-school subject is mapped to the same PTC curriculum requirement.",
          });
        } else {
          mappedSubjectIds.add(ptcSubjectId);
        }

        // ----------------------------------------------------
        // Mapping must still belong to evaluated curriculum.
        // ----------------------------------------------------

        if (subject.curriculum_subject_id === null) {
          validationErrors.push({
            code: "PTC_EQUIVALENCY_NOT_IN_CURRICULUM",

            transfer_subject_id: transferSubjectId,

            ptc_subject_id: ptcSubjectId,

            message:
              "The credited PTC subject no longer belongs to the evaluated curriculum.",
          });
        }

        // ----------------------------------------------------
        // Target subject must still be active.
        // ----------------------------------------------------

        if (Number(subject.ptc_subject_is_active) !== 1) {
          validationErrors.push({
            code: "PTC_EQUIVALENCY_INACTIVE",

            transfer_subject_id: transferSubjectId,

            ptc_subject_id: ptcSubjectId,

            message: "The credited PTC subject is inactive.",
          });
        }

        const ptcUnits =
          subject.ptc_subject_units !== null
            ? Number(subject.ptc_subject_units)
            : null;

        const creditedUnits =
          subject.credited_units !== null
            ? Number(subject.credited_units)
            : null;

        if (ptcUnits === null || !Number.isFinite(ptcUnits) || ptcUnits <= 0) {
          validationErrors.push({
            code: "INVALID_PTC_SUBJECT_UNITS",

            transfer_subject_id: transferSubjectId,

            message:
              "The credited PTC subject does not have valid official units.",
          });
        }

        if (
          creditedUnits === null ||
          !Number.isFinite(creditedUnits) ||
          creditedUnits <= 0
        ) {
          validationErrors.push({
            code: "INVALID_TRANSFER_CREDITED_UNITS",

            transfer_subject_id: transferSubjectId,

            message:
              "Credited transfer subject does not have valid credited units.",
          });
        }

        // ----------------------------------------------------
        // Current model is full-subject equivalency.
        //
        // The decision endpoint derives credited_units from
        // subjects.units, so completion revalidates equality.
        // ----------------------------------------------------

        if (
          Number.isFinite(ptcUnits) &&
          Number.isFinite(creditedUnits) &&
          creditedUnits !== ptcUnits
        ) {
          validationErrors.push({
            code: "TRANSFER_CREDIT_UNITS_MISMATCH",

            transfer_subject_id: transferSubjectId,

            ptc_subject_id: ptcSubjectId,

            expected_units: ptcUnits,

            credited_units: creditedUnits,

            message:
              "Credited units must match the official PTC subject units.",
          });
        }
      }

      // ======================================================
      // NOT CREDITED VALIDATION
      // ======================================================

      if (creditStatus === "Not Credited") {
        if (subject.credited_units !== null) {
          validationErrors.push({
            code: "NOT_CREDITED_UNITS_MUST_BE_NULL",

            transfer_subject_id: transferSubjectId,

            message:
              "A Not Credited transfer subject cannot contain credited units.",
          });
        }

        if (
          !subject.decision_reason ||
          !String(subject.decision_reason).trim()
        ) {
          validationErrors.push({
            code: "NOT_CREDITED_REASON_REQUIRED",

            transfer_subject_id: transferSubjectId,

            message:
              "A Not Credited transfer subject must contain an academic decision reason.",
          });
        }
      }
    }

    // ========================================================
    // 8. BLOCK COMPLETION IF INVALID
    // ========================================================

    if (validationErrors.length > 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "TRANSFER_EVALUATION_NOT_READY_FOR_COMPLETION",

        message:
          "Transfer evaluation has academic review issues that must be resolved before completion.",

        validation: {
          valid: false,

          error_count: validationErrors.length,

          errors: validationErrors,
        },
      });
    }

    // ========================================================
    // 9. CALCULATE FINAL SUMMARY
    // ========================================================

    const creditedSubjects = subjectRows.filter(
      (subject) => subject.credit_status === "Credited",
    );

    const notCreditedSubjects = subjectRows.filter(
      (subject) => subject.credit_status === "Not Credited",
    );

    const mappedSubjects = subjectRows.filter(
      (subject) => subject.ptc_subject_id !== null,
    );

    const totalCreditedUnits = creditedSubjects.reduce(
      (total, subject) => total + Number(subject.credited_units || 0),
      0,
    );

    // ========================================================
    // 10. OLD HEADER VALUES
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
    // 11. COMPLETE HEADER
    // ========================================================

    const [updateResult] = await connection.execute(
      `
          UPDATE student_transfer_evaluations

          SET
              evaluation_status =
                  'Completed',

              reviewed_by = ?,

              reviewed_at = NOW(),

              review_remarks = ?

          WHERE
              transfer_evaluation_id = ?

              AND evaluation_status =
                  'Submitted'
        `,
      [Number(programHead.user_id), reviewRemarks, transferEvaluationId],
    );

    if (updateResult.affectedRows !== 1) {
      throw new Error(
        "Transfer evaluation completion did not affect exactly one row.",
      );
    }

    // ========================================================
    // 12. READ COMPLETED HEADER
    // ========================================================

    const [completedRows] = await connection.execute(
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

    if (completedRows.length === 0) {
      throw new Error("Completed transfer evaluation could not be retrieved.");
    }

    const completed = completedRows[0];

    // ========================================================
    // 13. AUDIT COMPLETION
    // ========================================================

    const newValues = {
      transfer_evaluation_id: transferEvaluationId,

      evaluation_status: "Completed",

      submitted_by:
        completed.submitted_by !== null ? Number(completed.submitted_by) : null,

      submitted_at: completed.submitted_at,

      reviewed_by:
        completed.reviewed_by !== null ? Number(completed.reviewed_by) : null,

      reviewed_at: completed.reviewed_at,

      review_remarks: completed.review_remarks,

      completed_by:
        completed.reviewed_by !== null ? Number(completed.reviewed_by) : null,

      completed_at: completed.reviewed_at,

      workflow_action: "TRANSFER_EVALUATION_COMPLETED",

      subject_summary: {
        total_subjects: subjectRows.length,

        mapped_subjects: mappedSubjects.length,

        credited_subjects: creditedSubjects.length,

        not_credited_subjects: notCreditedSubjects.length,

        pending_subjects: 0,

        total_credited_units: totalCreditedUnits,

        official_transfer_credits: creditedSubjects.length,
      },

      official_transfer_credit: creditedSubjects.length > 0,

      satisfies_curriculum_requirements: creditedSubjects.length > 0,
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
        Number(programHead.user_id),

        transferEvaluationId,

        JSON.stringify(oldValues),

        JSON.stringify(newValues),
      ],
    );

    // ========================================================
    // 14. COMMIT
    // ========================================================

    await connection.commit();

    transactionActive = false;

    // ========================================================
    // 15. OFFICIAL CREDIT RESPONSE
    // ========================================================

    const officialCredits = creditedSubjects.map((subject) => ({
      transfer_subject_id: Number(subject.transfer_subject_id),

      source: {
        subject_code: subject.source_subject_code || null,

        subject_name: subject.source_subject_name,

        units:
          subject.source_units !== null ? Number(subject.source_units) : null,

        grade: subject.source_grade || null,
      },

      ptc_equivalency: {
        curriculum_subject_id: Number(subject.curriculum_subject_id),

        subject_id: Number(subject.ptc_subject_id),

        subject_code: subject.ptc_subject_code,

        subject_name: subject.ptc_subject_name,

        units: Number(subject.ptc_subject_units),

        year_level: Number(subject.ptc_year_level),

        semester_id: Number(subject.ptc_semester_id),

        is_required: Number(subject.is_required) === 1,
      },

      credit_status: "Credited",

      credited_units: Number(subject.credited_units),

      decision_reason: subject.decision_reason || null,

      reviewed_by: Number(subject.reviewed_by),

      reviewed_at: subject.reviewed_at,

      official_transfer_credit: true,

      satisfies_curriculum_requirement: true,
    }));

    return res.status(200).json({
      success: true,

      code: "TRANSFER_EVALUATION_COMPLETED",

      message:
        creditedSubjects.length > 0
          ? "Transfer evaluation completed. Approved transfer credits are now official."
          : "Transfer evaluation completed with no credited PTC subjects.",

      evaluation: {
        transfer_evaluation_id: transferEvaluationId,

        evaluation_status: "Completed",

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

          effective_year:
            evaluation.effective_year !== null
              ? Number(evaluation.effective_year)
              : null,

          course: {
            course_id: Number(evaluation.course_id),

            course_code: evaluation.course_code,

            course_name: evaluation.course_name,

            department_id: Number(evaluation.department_id),

            department_code: evaluation.department_code,

            department_name: evaluation.department_name,
          },
        },

        source_school: evaluation.source_school,

        workflow: {
          previous_status: currentStatus,

          current_status: "Completed",

          submitted_by:
            completed.submitted_by !== null
              ? Number(completed.submitted_by)
              : null,

          submitted_at: completed.submitted_at,

          completed_by:
            completed.reviewed_by !== null
              ? Number(completed.reviewed_by)
              : null,

          completed_at: completed.reviewed_at,

          review_remarks: completed.review_remarks,
        },
      },

      summary: {
        total_subjects: subjectRows.length,

        mapped_subjects: mappedSubjects.length,

        pending_subjects: 0,

        credited_subjects: creditedSubjects.length,

        not_credited_subjects: notCreditedSubjects.length,

        total_credited_units: totalCreditedUnits,

        official_transfer_credits: creditedSubjects.length,
      },

      official_transfer_credits: officialCredits,

      academic_effect: {
        evaluation_completed: true,

        credit_decisions_final: true,

        official_transfer_credit: creditedSubjects.length > 0,

        official_transfer_credit_count: creditedSubjects.length,

        satisfies_curriculum_requirements: creditedSubjects.length > 0,

        satisfied_ptc_subject_ids: creditedSubjects.map((subject) =>
          Number(subject.ptc_subject_id),
        ),

        changes_ptc_grades: false,

        changes_current_enrollment: false,

        reason:
          creditedSubjects.length > 0
            ? "Completed + Credited transfer subjects are now official academic transfer credits and satisfy their mapped PTC curriculum requirements."
            : "The evaluation is complete, but no previous-school subjects were awarded transfer credit.",
      },

      next_action:
        "Official transfer credits may now be used by academic-record, prerequisite, and future-enrollment eligibility logic.",

      actor: {
        user_id: programHead.user_id,

        username: programHead.username,

        program_head_id: programHead.program_head_id,

        department_id: programHead.department_id,
      },
    });
  } catch (error) {
    if (connection && transactionActive) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "COMPLETE TRANSFER EVALUATION ROLLBACK ERROR:",
          rollbackError,
        );
      }
    }

    console.error("COMPLETE TRANSFER EVALUATION ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "TRANSFER_EVALUATION_COMPLETION_FAILED",

      message: "Failed to complete transfer evaluation.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});
// ============================================================
// EXPORT
// ============================================================

export default router;
