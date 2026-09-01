// server/services/academicRecord.service.js

import db from "../db.js";

import {
  ACADEMIC_RESULT,
  classifyFinalRating,
} from "./academicEvaluation.service.js";

import { getOfficialTransferCreditsForStudent } from "./transferCredit.service.js";

// =====================================================
// BASIC HELPERS
// =====================================================

function toPositiveInt(value, fieldName) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return number;
}

function getExecutor(executor) {
  if (!executor || typeof executor.execute !== "function") {
    throw new Error("A valid database executor is required.");
  }

  return executor;
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

// =====================================================
// PTC RESULT METADATA
// =====================================================

function buildPtcResultMetadata(finalRating) {
  const result = classifyFinalRating(finalRating);

  if (result === ACADEMIC_RESULT.PASSED) {
    return {
      result_code: "PASSED",
      classification: "Passed",
      passed: true,
      retake: false,
      valid_result: true,
      curriculum_satisfied: true,
    };
  }

  if (result === ACADEMIC_RESULT.INCOMPLETE) {
    return {
      result_code: "INCOMPLETE",
      classification: "Incomplete",
      passed: false,
      retake: true,
      valid_result: true,
      curriculum_satisfied: false,
    };
  }

  if (result === ACADEMIC_RESULT.FAILED) {
    return {
      result_code: "FAILED",
      classification: "Failed",
      passed: false,
      retake: true,
      valid_result: true,
      curriculum_satisfied: false,
    };
  }

  return {
    result_code:
      result === ACADEMIC_RESULT.NONE
        ? "NO_FINAL_RATING"
        : "INVALID_FINAL_RATING",

    classification: "Unknown",

    passed: false,
    retake: false,
    valid_result: false,
    curriculum_satisfied: false,
  };
}

// =====================================================
// SEMESTER SORT VALUE
// =====================================================

function getSemesterSortValue(record) {
  if (record.semester_id !== null && record.semester_id !== undefined) {
    return Number(record.semester_id);
  }

  const semesterName = String(record.semester_name || "").toLowerCase();

  if (semesterName.includes("first")) {
    return 1;
  }

  if (semesterName.includes("second")) {
    return 2;
  }

  if (
    semesterName.includes("summer") ||
    semesterName.includes("midyear") ||
    semesterName.includes("mid-year")
  ) {
    return 3;
  }

  return 99;
}

// =====================================================
// ACADEMIC RECORD SORT
// =====================================================

function compareAcademicRecords(a, b) {
  const academicYearA = String(a.academic_year || "");

  const academicYearB = String(b.academic_year || "");

  const academicYearCompare = academicYearA.localeCompare(academicYearB);

  if (academicYearCompare !== 0) {
    return academicYearCompare;
  }

  const semesterCompare = getSemesterSortValue(a) - getSemesterSortValue(b);

  if (semesterCompare !== 0) {
    return semesterCompare;
  }

  return String(a.subject_code || "").localeCompare(
    String(b.subject_code || ""),
  );
}

// =====================================================
// GET OFFICIAL ACADEMIC RECORD
// =====================================================
//
// Official academic history has TWO independent sources:
//
// 1. PTC GRADE
//
//    enrollment_status = Approved
//    grade_status      = Approved
//
// 2. TRANSFER CREDIT
//
//    transfer evaluation = Completed
//    transfer subject     = Credited
//
// Transfer-credit source grades are NEVER inserted into
// grades.final_rating.
//
// =====================================================

export async function getOfficialAcademicRecordForStudent(
  studentId,
  { curriculumId = null, executor = db } = {},
) {
  const safeStudentId = toPositiveInt(studentId, "studentId");

  const database = getExecutor(executor);

  // ===================================================
  // 1. OFFICIAL PTC GRADE RECORDS
  // ===================================================

  const [gradeRows] = await database.execute(
    `
        SELECT
            -- =========================================
            -- GRADE
            -- =========================================

            g.grade_id,
            g.enrollment_subject_id,
            g.faculty_id,

            g.prelim_grade,
            g.midterm_grade,
            g.final_grade,
            g.final_rating,

            g.remarks,
            g.grade_status,

            g.submitted_at,

            g.reviewed_by,

            reviewer.username
                AS reviewed_by_username,

            g.reviewed_at,
            g.review_remarks,

            g.created_at
                AS grade_created_at,

            g.updated_at
                AS grade_updated_at,

            -- =========================================
            -- ENROLLMENT SUBJECT
            -- =========================================

            es.enrollment_id,
            es.subject_id,

            es.status
                AS subject_status,

            es.offering_id,
            es.section_id,
            es.section_subject_id,

            -- =========================================
            -- SUBJECT
            -- =========================================

            sub.subject_code,
            sub.subject_name,
            sub.units,

            -- =========================================
            -- ENROLLMENT / PERIOD
            -- =========================================

            e.student_id,
            e.academic_year_id,

            ay.academic_year,

            e.semester_id,

            sem.semester_name,

            e.enrollment_status,

            -- =========================================
            -- FACULTY
            -- =========================================

            faculty.employee_number
                AS faculty_employee_number,

            faculty.first_name
                AS faculty_first_name,

            faculty.middle_name
                AS faculty_middle_name,

            faculty.last_name
                AS faculty_last_name

        FROM grades g

        INNER JOIN enrollment_subjects es
            ON es.enrollment_subject_id =
               g.enrollment_subject_id

        INNER JOIN enrollments e
            ON e.enrollment_id =
               es.enrollment_id

        INNER JOIN subjects sub
            ON sub.subject_id =
               es.subject_id

        INNER JOIN academic_years ay
            ON ay.academic_year_id =
               e.academic_year_id

        INNER JOIN semesters sem
            ON sem.semester_id =
               e.semester_id

        LEFT JOIN faculty
            ON faculty.faculty_id =
               g.faculty_id

        LEFT JOIN users reviewer
            ON reviewer.user_id =
               g.reviewed_by

        WHERE
            e.student_id = ?

            AND e.enrollment_status =
                'Approved'

            AND g.grade_status =
                'Approved'

            AND g.final_rating
                IS NOT NULL

            AND e.semester_id
                IN (1, 2)

        ORDER BY
            e.academic_year_id ASC,
            e.semester_id ASC,
            es.enrollment_subject_id ASC,
            g.grade_id ASC
      `,
    [safeStudentId],
  );

  // ===================================================
  // 2. FORMAT PTC RECORDS
  // ===================================================

  const ptcGradeRecords = gradeRows.map((row) => {
    const finalRating = toNullableNumber(row.final_rating);

    const result = buildPtcResultMetadata(finalRating);

    const facultyName = [
      row.faculty_first_name,
      row.faculty_middle_name,
      row.faculty_last_name,
    ]
      .filter(Boolean)
      .join(" ");

    return {
      // ---------------------------------------------
      // RECORD IDENTITY
      // ---------------------------------------------

      record_type: "PTC_GRADE",

      academic_source: "PTC Grade",

      official_record: true,

      // ---------------------------------------------
      // PTC GRADE IDS
      // ---------------------------------------------

      grade_id: Number(row.grade_id),

      enrollment_subject_id: Number(row.enrollment_subject_id),

      enrollment_id: Number(row.enrollment_id),

      transfer_evaluation_id: null,

      transfer_subject_id: null,

      // ---------------------------------------------
      // SUBJECT
      // ---------------------------------------------

      subject_id: Number(row.subject_id),

      subject_code: row.subject_code,

      subject_name: row.subject_name,

      units: Number(row.units || 0),

      // ---------------------------------------------
      // PERIOD
      // ---------------------------------------------

      academic_year_id: Number(row.academic_year_id),

      academic_year: row.academic_year,

      semester_id: Number(row.semester_id),

      semester_name: row.semester_name,

      // ---------------------------------------------
      // ENROLLMENT
      // ---------------------------------------------

      enrollment_status: row.enrollment_status,

      subject_status: row.subject_status,

      // ---------------------------------------------
      // PTC GRADE VALUES
      // ---------------------------------------------

      prelim_grade: toNullableNumber(row.prelim_grade),

      midterm_grade: toNullableNumber(row.midterm_grade),

      final_grade: toNullableNumber(row.final_grade),

      final_rating: finalRating,

      // External-source grade does not apply.
      source_grade: null,

      remarks: row.remarks || null,

      grade_status: row.grade_status,

      // ---------------------------------------------
      // ACADEMIC RESULT
      // ---------------------------------------------

      ...result,

      // ---------------------------------------------
      // FACULTY
      // ---------------------------------------------

      faculty:
        row.faculty_id !== null && row.faculty_id !== undefined
          ? {
              faculty_id: Number(row.faculty_id),

              employee_number: row.faculty_employee_number || null,

              faculty_name: facultyName || "Assigned Faculty",
            }
          : null,

      // ---------------------------------------------
      // APPROVAL
      // ---------------------------------------------

      approval: {
        reviewed_by:
          row.reviewed_by !== null && row.reviewed_by !== undefined
            ? Number(row.reviewed_by)
            : null,

        reviewed_by_username: row.reviewed_by_username || null,

        reviewed_at: row.reviewed_at || null,

        review_remarks: row.review_remarks || null,
      },

      // ---------------------------------------------
      // TRANSFER SOURCE
      // ---------------------------------------------

      transfer_source: null,

      transfer_completion: null,

      // ---------------------------------------------
      // TIMESTAMPS
      // ---------------------------------------------

      submitted_at: row.submitted_at || null,

      created_at: row.grade_created_at || null,

      updated_at: row.grade_updated_at || null,
    };
  });

  // ===================================================
  // 3. OFFICIAL TRANSFER CREDITS
  //
  // The transfer-credit service owns the authoritative
  // Completed + Credited rule.
  // ===================================================

  const transferResult = await getOfficialTransferCreditsForStudent(
    safeStudentId,
    {
      curriculumId,
      executor: database,
    },
  );

  // ===================================================
  // 4. FORMAT TRANSFER-CREDIT RECORDS
  //
  // IMPORTANT:
  //
  // final_grade  = NULL
  // final_rating = NULL
  //
  // We preserve source_grade separately.
  // ===================================================

  const transferCreditRecords = (
    transferResult.official_transfer_credits || []
  ).map((credit) => {
    const creditedUnits = Number(credit.credit?.credited_units || 0);

    return {
      // ---------------------------------------------
      // RECORD IDENTITY
      // ---------------------------------------------

      record_type: "TRANSFER_CREDIT",

      academic_source: "Transfer Credit",

      official_record: true,

      // ---------------------------------------------
      // PTC GRADE IDS
      //
      // These MUST stay NULL.
      // ---------------------------------------------

      grade_id: null,

      enrollment_subject_id: null,

      enrollment_id: null,

      transfer_evaluation_id: Number(credit.transfer_evaluation_id),

      transfer_subject_id: Number(credit.transfer_subject_id),

      // ---------------------------------------------
      // MAPPED PTC SUBJECT
      // ---------------------------------------------

      subject_id: Number(credit.ptc_subject?.subject_id),

      subject_code: credit.ptc_subject?.subject_code || null,

      subject_name: credit.ptc_subject?.subject_name || null,

      // Awarded credit units.
      units: creditedUnits,

      // ---------------------------------------------
      // SOURCE-SCHOOL PERIOD
      //
      // Do NOT manufacture PTC academic_year_id or
      // semester_id for an external institution.
      // ---------------------------------------------

      academic_year_id: null,

      academic_year: credit.source?.academic_year || "Previous School",

      semester_id: null,

      semester_name: credit.source?.semester || "Previous School",

      // ---------------------------------------------
      // NO PTC ENROLLMENT EXISTS
      // ---------------------------------------------

      enrollment_status: null,

      subject_status: "Credited",

      // ---------------------------------------------
      // NO PTC GRADE VALUES
      // ---------------------------------------------

      prelim_grade: null,

      midterm_grade: null,

      final_grade: null,

      final_rating: null,

      // Preserve source exactly.
      source_grade: credit.source?.grade ?? null,

      remarks: credit.source?.remarks || credit.credit?.decision_reason || null,

      grade_status: null,

      // ---------------------------------------------
      // ACADEMIC RESULT
      //
      // "Credited" is intentionally NOT converted
      // into a fake PTC numeric grade.
      // ---------------------------------------------

      result_code: "TRANSFER_CREDIT",

      classification: "Credited",

      passed: true,

      retake: false,

      valid_result: true,

      curriculum_satisfied: true,

      // ---------------------------------------------
      // NO PTC FACULTY
      // ---------------------------------------------

      faculty: null,

      // ---------------------------------------------
      // PROGRAM HEAD CREDIT DECISION
      // ---------------------------------------------

      approval: {
        reviewed_by: credit.credit?.reviewed_by ?? null,

        reviewed_by_username: credit.credit?.reviewed_by_username || null,

        reviewed_at: credit.credit?.reviewed_at || null,

        review_remarks: credit.credit?.decision_reason || null,
      },

      // ---------------------------------------------
      // SOURCE-SCHOOL INFORMATION
      // ---------------------------------------------

      transfer_source: {
        school: credit.source?.school || null,

        course: credit.source?.course || null,

        student_number: credit.source?.student_number || null,

        subject_code: credit.source?.subject_code || null,

        subject_name: credit.source?.subject_name || null,

        units: credit.source?.units ?? null,

        grade: credit.source?.grade ?? null,

        remarks: credit.source?.remarks || null,

        academic_year: credit.source?.academic_year || null,

        year_level: credit.source?.year_level ?? null,

        semester: credit.source?.semester || null,
      },

      // ---------------------------------------------
      // PTC CURRICULUM MAPPING
      // ---------------------------------------------

      curriculum_mapping: {
        curriculum_id: credit.evaluated_curriculum?.curriculum_id ?? null,

        curriculum_name: credit.evaluated_curriculum?.curriculum_name || null,

        curriculum_subject_id:
          credit.evaluated_curriculum?.curriculum_subject
            ?.curriculum_subject_id ?? null,

        year_level:
          credit.evaluated_curriculum?.curriculum_subject?.year_level ?? null,

        semester_id:
          credit.evaluated_curriculum?.curriculum_subject?.semester_id ?? null,

        semester_name:
          credit.evaluated_curriculum?.curriculum_subject?.semester_name ||
          null,

        is_required:
          credit.evaluated_curriculum?.curriculum_subject?.is_required ?? null,
      },

      // ---------------------------------------------
      // EVALUATION COMPLETION
      // ---------------------------------------------

      transfer_completion: {
        evaluation_status: credit.completion?.evaluation_status || "Completed",

        completed_by: credit.completion?.completed_by ?? null,

        completed_by_username: credit.completion?.completed_by_username || null,

        completed_at: credit.completion?.completed_at || null,

        completion_remarks: credit.completion?.completion_remarks || null,
      },

      // Transfer records do not use grade timestamps.
      submitted_at: null,

      created_at: credit.completion?.completed_at || null,

      updated_at: credit.completion?.completed_at || null,
    };
  });

  // ===================================================
  // 5. COMBINED OFFICIAL ACADEMIC RECORD
  // ===================================================

  const records = [...ptcGradeRecords, ...transferCreditRecords].sort(
    compareAcademicRecords,
  );

  // ===================================================
  // 6. PTC SUMMARY
  // ===================================================

  const ptcPassedRecords = ptcGradeRecords.filter(
    (record) => record.classification === "Passed",
  );

  const ptcIncompleteRecords = ptcGradeRecords.filter(
    (record) => record.classification === "Incomplete",
  );

  const ptcFailedRecords = ptcGradeRecords.filter(
    (record) => record.classification === "Failed",
  );

  const ptcRetakeRecords = ptcGradeRecords.filter((record) => record.retake);

  const ptcRecordedUnits = ptcGradeRecords.reduce(
    (total, record) => total + Number(record.units || 0),
    0,
  );

  const ptcEarnedUnits = ptcPassedRecords.reduce(
    (total, record) => total + Number(record.units || 0),
    0,
  );

  // ===================================================
  // 7. UNIQUE TRANSFER-CREDIT UNITS
  //
  // Do not double-count the same mapped PTC subject if
  // historical duplicate official evaluations exist.
  // ===================================================

  const transferSatisfiedUnits = new Map();

  for (const record of transferCreditRecords) {
    const subjectId = Number(record.subject_id);

    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      continue;
    }

    if (!transferSatisfiedUnits.has(subjectId)) {
      transferSatisfiedUnits.set(subjectId, Number(record.units || 0));
    }
  }

  const transferCreditedUnits = Array.from(
    transferSatisfiedUnits.values(),
  ).reduce((total, units) => total + Number(units || 0), 0);

  // ===================================================
  // 8. UNIQUE COMBINED EARNED UNITS
  //
  // A curriculum subject must never contribute earned
  // units twice if legacy data somehow contains both:
  //
  // - an Approved PTC pass
  // - official transfer credit
  // ===================================================

  const satisfiedSubjectUnits = new Map();

  for (const record of ptcPassedRecords) {
    const subjectId = Number(record.subject_id);

    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      continue;
    }

    if (!satisfiedSubjectUnits.has(subjectId)) {
      satisfiedSubjectUnits.set(subjectId, Number(record.units || 0));
    }
  }

  for (const record of transferCreditRecords) {
    const subjectId = Number(record.subject_id);

    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      continue;
    }

    if (!satisfiedSubjectUnits.has(subjectId)) {
      satisfiedSubjectUnits.set(subjectId, Number(record.units || 0));
    }
  }

  const earnedUnits = Array.from(satisfiedSubjectUnits.values()).reduce(
    (total, units) => total + Number(units || 0),
    0,
  );

  // ===================================================
  // 9. FINAL READ-ONLY RESULT
  // ===================================================

  return {
    student_id: safeStudentId,

    summary: {
      // Combined official view
      total_official_records: records.length,

      total_recorded_units: ptcRecordedUnits + transferCreditedUnits,

      earned_units: earnedUnits,

      unique_satisfied_subjects: satisfiedSubjectUnits.size,

      // Existing PTC-grade semantics
      total_approved_subjects: ptcGradeRecords.length,

      ptc_grade_records: ptcGradeRecords.length,

      ptc_recorded_units: ptcRecordedUnits,

      ptc_earned_units: ptcEarnedUnits,

      passed_subjects: ptcPassedRecords.length,

      incomplete_subjects: ptcIncompleteRecords.length,

      failed_subjects: ptcFailedRecords.length,

      retake_subjects: ptcRetakeRecords.length,

      // Transfer-credit semantics
      official_transfer_credit_records: transferCreditRecords.length,

      unique_transfer_credit_subjects: transferSatisfiedUnits.size,

      transfer_credited_units: transferCreditedUnits,
    },

    records,

    ptc_grade_records: ptcGradeRecords,

    transfer_credit_records: transferCreditRecords,

    academic_rule: {
      official_ptc_grade: "Approved enrollment + Approved grade",

      official_transfer_credit:
        "Completed transfer evaluation + Credited transfer subject",

      transfer_grade_stored_as_ptc_grade: false,

      earned_units_deduplicated_by_ptc_subject: true,
    },
  };
}

export default {
  getOfficialAcademicRecordForStudent,
};
