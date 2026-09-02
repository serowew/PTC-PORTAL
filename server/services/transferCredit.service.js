import db from "../db.js";

// ============================================================
// TRANSFER CREDIT SERVICE
// ============================================================
//
// PURPOSE:
//
// Central authoritative lookup for official previous-school
// transfer credits.
//
// OFFICIAL RULE:
//
// student_transfer_evaluations.evaluation_status = 'Completed'
//                     +
// student_transfer_subjects.credit_status = 'Credited'
//
// Transfer credit remains separate from normal PTC grades.
//
// This service will later be reused by:
//
// - prerequisite checking
// - Carry Over classification
// - enrollment eligibility
// - academic records
//
// ============================================================

function toPositiveInt(value) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0 ? number : null;
}

// ============================================================
// GET OFFICIAL TRANSFER CREDITS FOR STUDENT
// ============================================================
//
// studentId:
//   required
//
// options.curriculumId:
//   optional
//
// options.executor:
//   db pool or transaction connection
//
// IMPORTANT:
//
// This is a READ operation.
// It does not modify grades, enrollment, or curriculum.
//
// ============================================================

export async function getOfficialTransferCreditsForStudent(
  studentId,
  { curriculumId = null, executor = db } = {},
) {
  const normalizedStudentId = toPositiveInt(studentId);

  if (!normalizedStudentId) {
    const error = new Error("A valid student ID is required.");

    error.code = "INVALID_STUDENT_ID";

    throw error;
  }

  let normalizedCurriculumId = null;

  if (
    curriculumId !== null &&
    curriculumId !== undefined &&
    curriculumId !== ""
  ) {
    normalizedCurriculumId = toPositiveInt(curriculumId);

    if (!normalizedCurriculumId) {
      const error = new Error("A valid curriculum ID is required.");

      error.code = "INVALID_CURRICULUM_ID";

      throw error;
    }
  }

  // ==========================================================
  // QUERY
  //
  // IMPORTANT:
  //
  // Do not query grades here.
  //
  // Transfer credit is authoritative only from the two
  // transfer-credit tables.
  // ==========================================================

  const params = [normalizedStudentId];

  let curriculumFilter = "";

  if (normalizedCurriculumId) {
    curriculumFilter = "AND ste.curriculum_id = ?";

    params.push(normalizedCurriculumId);
  }

  const [rows] = await executor.execute(
    `
      SELECT
          -- ================================================
          -- TRANSFER EVALUATION
          -- ================================================

          ste.transfer_evaluation_id,
          ste.student_id,
          ste.curriculum_id,

          ste.source_school,
          ste.source_course,
          ste.source_student_number,

          ste.evaluation_status,

          ste.submitted_by,
          ste.submitted_at,

          ste.reviewed_by
              AS evaluation_reviewed_by,

          ste.reviewed_at
              AS evaluation_reviewed_at,

          ste.review_remarks
              AS evaluation_review_remarks,

          ste.created_at
              AS evaluation_created_at,

          ste.updated_at
              AS evaluation_updated_at,

          -- ================================================
          -- TRANSFER SUBJECT
          -- ================================================

          sts.transfer_subject_id,

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

          sts.reviewed_by
              AS subject_reviewed_by,

          sts.reviewed_at
              AS subject_reviewed_at,

          -- ================================================
          -- PTC SUBJECT
          -- ================================================

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

          ptc.is_active
              AS ptc_subject_is_active,

          -- ================================================
          -- EVALUATED CURRICULUM
          -- ================================================

          cur.curriculum_name,
          cur.effective_year,

          c.course_id,
          c.course_code,
          c.course_name,
          c.department_id,

          -- ================================================
          -- CURRICULUM SUBJECT INFORMATION
          --
          -- LEFT JOIN because historical official transfer
          -- credit must remain part of the student's record
          -- even if curriculum configuration changes later.
          -- ================================================

          cs.curriculum_subject_id,

          cs.year_level
              AS curriculum_year_level,

          cs.semester_id
              AS curriculum_semester_id,

          sem.semester_name
              AS curriculum_semester_name,

          cs.is_required,

          -- ================================================
          -- ACTORS
          -- ================================================

          submitter.username
              AS submitted_by_username,

          evaluation_reviewer.username
              AS evaluation_reviewed_by_username,

          subject_reviewer.username
              AS subject_reviewed_by_username

      FROM student_transfer_subjects sts

      INNER JOIN student_transfer_evaluations ste
          ON ste.transfer_evaluation_id =
             sts.transfer_evaluation_id

      INNER JOIN curriculum cur
          ON cur.curriculum_id =
             ste.curriculum_id

      INNER JOIN courses c
          ON c.course_id =
             cur.course_id

      INNER JOIN subjects ptc
          ON ptc.subject_id =
             sts.ptc_subject_id

      LEFT JOIN curriculum_subjects cs
          ON cs.curriculum_id =
             ste.curriculum_id

         AND cs.subject_id =
             sts.ptc_subject_id

      LEFT JOIN semesters sem
          ON sem.semester_id =
             cs.semester_id

      LEFT JOIN users submitter
          ON submitter.user_id =
             ste.submitted_by

      LEFT JOIN users evaluation_reviewer
          ON evaluation_reviewer.user_id =
             ste.reviewed_by

      LEFT JOIN users subject_reviewer
          ON subject_reviewer.user_id =
             sts.reviewed_by

      WHERE
          ste.student_id = ?

          AND ste.evaluation_status =
              'Completed'

          AND sts.credit_status =
              'Credited'

          AND sts.ptc_subject_id
              IS NOT NULL

          ${curriculumFilter}

      ORDER BY
          sts.ptc_subject_id ASC,
          ste.reviewed_at ASC,
          sts.transfer_subject_id ASC
    `,
    params,
  );

  // ==========================================================
  // FORMAT OFFICIAL CREDIT RECORDS
  // ==========================================================

  const credits = rows.map((row) => ({
    transfer_evaluation_id: Number(row.transfer_evaluation_id),

    transfer_subject_id: Number(row.transfer_subject_id),

    student_id: Number(row.student_id),

    source: {
      school: row.source_school,

      course: row.source_course || null,

      student_number: row.source_student_number || null,

      subject_code: row.source_subject_code || null,

      subject_name: row.source_subject_name,

      units: row.source_units !== null ? Number(row.source_units) : null,

      // ----------------------------------------------
      // Keep external grade exactly as source text.
      // ----------------------------------------------

      grade: row.source_grade,

      remarks: row.source_remarks || null,

      academic_year: row.source_academic_year || null,

      year_level:
        row.source_year_level !== null ? Number(row.source_year_level) : null,

      semester: row.source_semester || null,
    },

    ptc_subject: {
      subject_id: Number(row.ptc_subject_id),

      subject_code: row.ptc_subject_code,

      subject_name: row.ptc_subject_name,

      units:
        row.ptc_subject_units !== null ? Number(row.ptc_subject_units) : null,

      lecture_hours:
        row.ptc_lecture_hours !== null ? Number(row.ptc_lecture_hours) : null,

      laboratory_hours:
        row.ptc_laboratory_hours !== null
          ? Number(row.ptc_laboratory_hours)
          : null,

      currently_active: Number(row.ptc_subject_is_active) === 1,
    },

    evaluated_curriculum: {
      curriculum_id: Number(row.curriculum_id),

      curriculum_name: row.curriculum_name,

      effective_year:
        row.effective_year !== null ? Number(row.effective_year) : null,

      course: {
        course_id: Number(row.course_id),

        course_code: row.course_code,

        course_name: row.course_name,

        department_id: Number(row.department_id),
      },

      curriculum_subject:
        row.curriculum_subject_id !== null
          ? {
              curriculum_subject_id: Number(row.curriculum_subject_id),

              year_level: Number(row.curriculum_year_level),

              semester_id: Number(row.curriculum_semester_id),

              semester_name: row.curriculum_semester_name || null,

              is_required: Number(row.is_required) === 1,
            }
          : null,
    },

    credit: {
      credit_status: row.credit_status,

      credited_units:
        row.credited_units !== null ? Number(row.credited_units) : null,

      decision_reason: row.decision_reason || null,

      reviewed_by:
        row.subject_reviewed_by !== null
          ? Number(row.subject_reviewed_by)
          : null,

      reviewed_by_username: row.subject_reviewed_by_username || null,

      reviewed_at: row.subject_reviewed_at,
    },

    completion: {
      evaluation_status: row.evaluation_status,

      completed_by:
        row.evaluation_reviewed_by !== null
          ? Number(row.evaluation_reviewed_by)
          : null,

      completed_by_username: row.evaluation_reviewed_by_username || null,

      completed_at: row.evaluation_reviewed_at,

      completion_remarks: row.evaluation_review_remarks || null,
    },

    // ======================================================
    // AUTHORITATIVE DERIVED FLAGS
    // ======================================================

    official_transfer_credit: true,

    satisfies_mapped_ptc_subject: true,

    academic_source: "Transfer Credit",
  }));

  // ==========================================================
  // UNIQUE SATISFIED PTC SUBJECTS
  //
  // Multiple historical records must never cause the same
  // curriculum requirement to count twice.
  // ==========================================================

  const satisfiedSubjectIds = [
    ...new Set(credits.map((credit) => credit.ptc_subject.subject_id)),
  ];

  const totalCreditedUnits = credits.reduce(
    (total, credit) => total + Number(credit.credit.credited_units || 0),
    0,
  );

  return {
    student_id: normalizedStudentId,

    curriculum_id: normalizedCurriculumId,

    official_transfer_credits: credits,

    satisfied_ptc_subject_ids: satisfiedSubjectIds,

    summary: {
      official_credit_records: credits.length,

      unique_satisfied_ptc_subjects: satisfiedSubjectIds.length,

      total_credited_units: totalCreditedUnits,
    },
  };
}
