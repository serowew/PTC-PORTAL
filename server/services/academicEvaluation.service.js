// server/services/academicEvaluation.service.js

import db from "../db.js";
import { getOfficialTransferCreditsForStudent } from "./transferCredit.service.js";
// =====================================================
// CONSTANTS
// =====================================================

export const ACADEMIC_RESULT = Object.freeze({
  PASSED: "Passed",
  FAILED: "Failed",
  INCOMPLETE: "Incomplete",
  INVALID: "Invalid",
  NONE: "None",
});

export const ELIGIBILITY_TYPE = Object.freeze({
  REGULAR: "Regular",
  RETAKE: "Retake",
  CARRY_OVER: "Carry Over",
  ALREADY_PASSED: "Already Passed",
  BLOCKED_PREREQUISITE: "Blocked - Prerequisite",
  UNRESOLVED: "Unresolved",
});

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

// =====================================================
// CLASSIFY FINAL RATING
// =====================================================
//
// Academic rule:
//
// 1.00 - 3.00 = Passed
// 4.00        = Incomplete / Retake
// 5.00        = Failed / Retake
//
// Anything else is NOT a valid official academic result.
//
// =====================================================

export function classifyFinalRating(finalRating) {
  if (finalRating === null || finalRating === undefined || finalRating === "") {
    return ACADEMIC_RESULT.NONE;
  }

  const rating = Number(finalRating);

  if (!Number.isFinite(rating)) {
    return ACADEMIC_RESULT.INVALID;
  }

  if (rating >= 1 && rating <= 3) {
    return ACADEMIC_RESULT.PASSED;
  }

  if (rating === 4) {
    return ACADEMIC_RESULT.INCOMPLETE;
  }

  if (rating === 5) {
    return ACADEMIC_RESULT.FAILED;
  }

  return ACADEMIC_RESULT.INVALID;
}

// =====================================================
// GET APPROVED ACADEMIC HISTORY
// =====================================================
//
// IMPORTANT:
//
// Academic history comes ONLY from:
//
// grades.grade_status = Approved
// enrollments.enrollment_status = Approved
//
// Draft / Submitted / Returned grades are NOT official.
//
// Student identity comes from enrollments.student_id.
//
// Subject identity comes from enrollment_subjects.subject_id.
//
// =====================================================

export async function getApprovedAcademicHistory(studentId, executor = db) {
  const safeStudentId = toPositiveInt(studentId, "studentId");

  const database = getExecutor(executor);

  const [rows] = await database.execute(
    `
      SELECT
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
          g.reviewed_at,
          g.review_remarks,

          es.enrollment_id,
          es.subject_id,
          es.status AS enrollment_subject_status,

          s.subject_code,
          s.subject_name,
          s.units,

          e.student_id,
          e.academic_year_id,
          e.semester_id,
          e.enrollment_status,
          e.approved_at AS enrollment_approved_at

      FROM grades g

      INNER JOIN enrollment_subjects es
          ON es.enrollment_subject_id =
             g.enrollment_subject_id

      INNER JOIN enrollments e
          ON e.enrollment_id =
             es.enrollment_id

      INNER JOIN subjects s
          ON s.subject_id =
             es.subject_id

      WHERE
          e.student_id = ?

          AND e.enrollment_status = 'Approved'

          AND g.grade_status = 'Approved'

      ORDER BY
          COALESCE(
              g.reviewed_at,
              g.updated_at,
              g.created_at
          ) DESC,

          g.grade_id DESC
    `,
    [safeStudentId],
  );

  return rows.map((row) => ({
    grade_id: Number(row.grade_id),

    enrollment_subject_id: Number(row.enrollment_subject_id),

    enrollment_id: Number(row.enrollment_id),

    student_id: Number(row.student_id),

    subject_id: Number(row.subject_id),

    subject_code: row.subject_code,

    subject_name: row.subject_name,

    units: Number(row.units),

    academic_year_id: Number(row.academic_year_id),

    semester_id: Number(row.semester_id),

    enrollment_status: row.enrollment_status,

    enrollment_subject_status: row.enrollment_subject_status,

    faculty_id: row.faculty_id === null ? null : Number(row.faculty_id),

    prelim_grade: row.prelim_grade === null ? null : Number(row.prelim_grade),

    midterm_grade:
      row.midterm_grade === null ? null : Number(row.midterm_grade),

    final_grade: row.final_grade === null ? null : Number(row.final_grade),

    final_rating: row.final_rating === null ? null : Number(row.final_rating),

    result: classifyFinalRating(row.final_rating),

    remarks: row.remarks,

    grade_status: row.grade_status,

    submitted_at: row.submitted_at,

    reviewed_by: row.reviewed_by === null ? null : Number(row.reviewed_by),

    reviewed_at: row.reviewed_at,

    review_remarks: row.review_remarks,

    enrollment_approved_at: row.enrollment_approved_at,
  }));
}

// =====================================================
// GET LATEST APPROVED GRADE FOR ONE SUBJECT
// =====================================================

export async function getLatestApprovedGrade(
  studentId,
  subjectId,
  executor = db,
) {
  const safeStudentId = toPositiveInt(studentId, "studentId");

  const safeSubjectId = toPositiveInt(subjectId, "subjectId");

  const database = getExecutor(executor);

  const [rows] = await database.execute(
    `
      SELECT
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
          g.reviewed_at,
          g.review_remarks,

          es.enrollment_id,
          es.subject_id,
          es.status AS enrollment_subject_status,

          s.subject_code,
          s.subject_name,
          s.units,

          e.student_id,
          e.academic_year_id,
          e.semester_id,
          e.enrollment_status

      FROM grades g

      INNER JOIN enrollment_subjects es
          ON es.enrollment_subject_id =
             g.enrollment_subject_id

      INNER JOIN enrollments e
          ON e.enrollment_id =
             es.enrollment_id

      INNER JOIN subjects s
          ON s.subject_id =
             es.subject_id

      WHERE
          e.student_id = ?

          AND es.subject_id = ?

          AND e.enrollment_status = 'Approved'

          AND g.grade_status = 'Approved'

      ORDER BY
          COALESCE(
              g.reviewed_at,
              g.updated_at,
              g.created_at
          ) DESC,

          g.grade_id DESC

      LIMIT 1
    `,
    [safeStudentId, safeSubjectId],
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];

  return {
    grade_id: Number(row.grade_id),

    enrollment_subject_id: Number(row.enrollment_subject_id),

    enrollment_id: Number(row.enrollment_id),

    student_id: Number(row.student_id),

    subject_id: Number(row.subject_id),

    subject_code: row.subject_code,

    subject_name: row.subject_name,

    units: Number(row.units),

    academic_year_id: Number(row.academic_year_id),

    semester_id: Number(row.semester_id),

    enrollment_subject_status: row.enrollment_subject_status,

    final_rating: row.final_rating === null ? null : Number(row.final_rating),

    result: classifyFinalRating(row.final_rating),

    remarks: row.remarks,

    grade_status: row.grade_status,

    reviewed_by: row.reviewed_by === null ? null : Number(row.reviewed_by),

    reviewed_at: row.reviewed_at,
  };
}

// =====================================================
// HAS PASSED SUBJECT
// =====================================================
//
// Only an APPROVED 1.00 - 3.00 result counts.
//
// =====================================================

export async function hasPassedSubject(studentId, subjectId, executor = db) {
  const safeStudentId = toPositiveInt(studentId, "studentId");

  const safeSubjectId = toPositiveInt(subjectId, "subjectId");

  const database = getExecutor(executor);

  const [rows] = await database.execute(
    `
      SELECT
          1 AS passed

      FROM grades g

      INNER JOIN enrollment_subjects es
          ON es.enrollment_subject_id =
             g.enrollment_subject_id

      INNER JOIN enrollments e
          ON e.enrollment_id =
             es.enrollment_id

      WHERE
          e.student_id = ?

          AND es.subject_id = ?

          AND e.enrollment_status = 'Approved'

          AND g.grade_status = 'Approved'

          AND g.final_rating >= 1.00

          AND g.final_rating <= 3.00

      LIMIT 1
    `,
    [safeStudentId, safeSubjectId],
  );

  return rows.length > 0;
}

// =====================================================
// GET SUBJECT PREREQUISITES
// =====================================================

export async function getSubjectPrerequisites(subjectId, executor = db) {
  const safeSubjectId = toPositiveInt(subjectId, "subjectId");

  const database = getExecutor(executor);

  const [rows] = await database.execute(
    `
      SELECT
          sp.prerequisite_id,

          sp.subject_id,

          sp.prerequisite_subject_id,

          prereq.subject_code
              AS prerequisite_subject_code,

          prereq.subject_name
              AS prerequisite_subject_name,

          prereq.units
              AS prerequisite_units

      FROM subject_prerequisites sp

      INNER JOIN subjects prereq
          ON prereq.subject_id =
             sp.prerequisite_subject_id

      WHERE
          sp.subject_id = ?

      ORDER BY
          prereq.subject_code,
          sp.prerequisite_id
    `,
    [safeSubjectId],
  );

  return rows.map((row) => ({
    prerequisite_id: Number(row.prerequisite_id),

    subject_id: Number(row.subject_id),

    prerequisite_subject_id: Number(row.prerequisite_subject_id),

    prerequisite_subject_code: row.prerequisite_subject_code,

    prerequisite_subject_name: row.prerequisite_subject_name,

    prerequisite_units: Number(row.prerequisite_units),
  }));
}
// =====================================================
// CHECK PREREQUISITES
// =====================================================
//
// A prerequisite is academically satisfied by EITHER:
//
// 1. Official PTC passing grade
//
//    enrollment_status = Approved
//    grade_status      = Approved
//    final_rating      = 1.00 - 3.00
//
// OR
//
// 2. Official transfer credit
//
//    transfer evaluation = Completed
//    transfer subject     = Credited
//
// Draft / Submitted / Returned transfer evaluations
// must never satisfy prerequisites.
//
// =====================================================

export async function checkPrerequisites(studentId, subjectId, executor = db) {
  const safeStudentId = toPositiveInt(studentId, "studentId");

  const safeSubjectId = toPositiveInt(subjectId, "subjectId");

  const database = getExecutor(executor);

  // ===================================================
  // 1. LOAD AUTHORITATIVE OFFICIAL TRANSFER CREDITS
  //
  // Reuse transferCredit.service.js so the official
  // Completed + Credited rule remains centralized.
  // ===================================================

  const transferCreditResult = await getOfficialTransferCreditsForStudent(
    safeStudentId,
    {
      executor: database,
    },
  );

  const officialTransferSubjectIds = new Set(
    (transferCreditResult.satisfied_ptc_subject_ids || []).map(Number),
  );

  // ===================================================
  // 2. LOAD SUBJECT PREREQUISITES
  //
  // The SQL below determines only whether the
  // prerequisite has an official PTC passing grade.
  //
  // Transfer-credit satisfaction is merged afterward.
  // ===================================================

  const [rows] = await database.execute(
    `
        SELECT
            sp.prerequisite_id,

            sp.subject_id,

            sp.prerequisite_subject_id,

            prereq.subject_code
                AS prerequisite_subject_code,

            prereq.subject_name
                AS prerequisite_subject_name,

            prereq.units
                AS prerequisite_units,

            CASE
                WHEN EXISTS (
                    SELECT 1

                    FROM grades g

                    INNER JOIN enrollment_subjects es
                        ON es.enrollment_subject_id =
                           g.enrollment_subject_id

                    INNER JOIN enrollments e
                        ON e.enrollment_id =
                           es.enrollment_id

                    WHERE
                        e.student_id = ?

                        AND es.subject_id =
                            sp.prerequisite_subject_id

                        AND e.enrollment_status =
                            'Approved'

                        AND g.grade_status =
                            'Approved'

                        AND g.final_rating >= 1.00

                        AND g.final_rating <= 3.00
                )

                THEN 1
                ELSE 0

            END AS has_ptc_approved_pass

        FROM subject_prerequisites sp

        INNER JOIN subjects prereq
            ON prereq.subject_id =
               sp.prerequisite_subject_id

        WHERE
            sp.subject_id = ?

        ORDER BY
            prereq.subject_code,
            sp.prerequisite_id
      `,
    [safeStudentId, safeSubjectId],
  );

  // ===================================================
  // 3. MERGE BOTH OFFICIAL ACADEMIC SOURCES
  // ===================================================

  const prerequisites = rows.map((row) => {
    const prerequisiteSubjectId = Number(row.prerequisite_subject_id);

    const ptcApprovedGradePass = Number(row.has_ptc_approved_pass) === 1;

    const officialTransferCredit = officialTransferSubjectIds.has(
      prerequisiteSubjectId,
    );

    const isSatisfied = ptcApprovedGradePass || officialTransferCredit;

    let satisfactionSource = null;

    if (ptcApprovedGradePass) {
      satisfactionSource = "PTC_APPROVED_GRADE";
    } else if (officialTransferCredit) {
      satisfactionSource = "TRANSFER_CREDIT";
    }

    return {
      prerequisite_id: Number(row.prerequisite_id),

      prerequisite_subject_id: prerequisiteSubjectId,

      prerequisite_subject_code: row.prerequisite_subject_code,

      prerequisite_subject_name: row.prerequisite_subject_name,

      prerequisite_units:
        row.prerequisite_units !== null ? Number(row.prerequisite_units) : null,

      // -----------------------------------------------
      // AUTHORITATIVE FINAL SATISFACTION
      // -----------------------------------------------

      is_satisfied: isSatisfied,

      satisfaction_source: satisfactionSource,

      // -----------------------------------------------
      // SOURCE DETAIL
      // -----------------------------------------------

      ptc_approved_grade_pass: ptcApprovedGradePass,

      official_transfer_credit: officialTransferCredit,
    };
  });

  // ===================================================
  // 4. MISSING PREREQUISITES
  // ===================================================

  const missingPrerequisites = prerequisites.filter(
    (prerequisite) => !prerequisite.is_satisfied,
  );

  // ===================================================
  // 5. FINAL RESULT
  // ===================================================

  return {
    student_id: safeStudentId,

    subject_id: safeSubjectId,

    has_prerequisites: prerequisites.length > 0,

    prerequisites,

    missing_prerequisites: missingPrerequisites,

    satisfied: missingPrerequisites.length === 0,

    academic_rule: {
      ptc_approved_grade_pass: true,

      official_transfer_credit: true,

      transfer_credit_requirement: "Completed + Credited",
    },
  };
}
// =====================================================
// EVALUATE ONE SUBJECT
// =====================================================

export async function evaluateSubjectEligibility(
  studentId,
  subjectId,
  executor = db,
) {
  const safeStudentId = toPositiveInt(studentId, "studentId");

  const safeSubjectId = toPositiveInt(subjectId, "subjectId");

  const database = getExecutor(executor);

  // ---------------------------------------------------
  // Subject must exist and be active.
  // ---------------------------------------------------

  const [subjectRows] = await database.execute(
    `
      SELECT
          subject_id,
          subject_code,
          subject_name,
          units,
          is_active

      FROM subjects

      WHERE subject_id = ?

      LIMIT 1
    `,
    [safeSubjectId],
  );

  if (subjectRows.length === 0) {
    throw new Error(`Subject ${safeSubjectId} does not exist.`);
  }

  const subject = subjectRows[0];

  if (Number(subject.is_active) !== 1) {
    return {
      eligible: false,

      eligibility_type: ELIGIBILITY_TYPE.UNRESOLVED,

      reason: "Subject is inactive.",

      subject: {
        subject_id: Number(subject.subject_id),

        subject_code: subject.subject_code,

        subject_name: subject.subject_name,

        units: Number(subject.units),
      },

      latest_approved_grade: null,

      prerequisites: null,
    };
  }

  // ---------------------------------------------------
  // Only Approved history matters.
  // ---------------------------------------------------

  // ---------------------------------------------------
  // LOAD OFFICIAL PTC GRADE HISTORY
  // ---------------------------------------------------

  const latestApprovedGrade = await getLatestApprovedGrade(
    safeStudentId,
    safeSubjectId,
    database,
  );

  // ---------------------------------------------------
  // LOAD OFFICIAL TRANSFER-CREDIT SATISFACTION
  //
  // Only Completed + Credited rows can be returned by
  // transferCredit.service.js.
  // ---------------------------------------------------

  const transferCreditResult = await getOfficialTransferCreditsForStudent(
    safeStudentId,
    {
      executor: database,
    },
  );

  const officialTransferCredit =
    (transferCreditResult.official_transfer_credits || []).find(
      (credit) => Number(credit.ptc_subject?.subject_id) === safeSubjectId,
    ) || null;

  // ---------------------------------------------------
  // PREREQUISITES
  // ---------------------------------------------------

  const prerequisiteCheck = await checkPrerequisites(
    safeStudentId,
    safeSubjectId,
    database,
  );

  const subjectData = {
    subject_id: Number(subject.subject_id),

    subject_code: subject.subject_code,

    subject_name: subject.subject_name,

    units: Number(subject.units),
  };
  // ---------------------------------------------------
  // ALREADY SATISFIED BY APPROVED PTC PASS
  //
  // Never enroll again normally.
  // ---------------------------------------------------

  if (latestApprovedGrade?.result === ACADEMIC_RESULT.PASSED) {
    return {
      eligible: false,

      eligibility_type: ELIGIBILITY_TYPE.ALREADY_PASSED,

      reason: "Subject already has an approved passing PTC grade.",

      subject: subjectData,

      latest_approved_grade: latestApprovedGrade,

      prerequisites: prerequisiteCheck,

      academic_satisfaction: {
        satisfied: true,

        source: "PTC_APPROVED_GRADE",

        official_transfer_credit: false,

        ptc_approved_grade_pass: true,
      },
    };
  }

  // ---------------------------------------------------
  // ALREADY SATISFIED BY OFFICIAL TRANSFER CREDIT
  //
  // Completed + Credited is academically authoritative.
  //
  // It satisfies the curriculum requirement without
  // creating or pretending that a PTC grade exists.
  //
  // It must therefore suppress:
  //
  // - Regular enrollment
  // - Carry Over
  // - Retake
  //
  // ---------------------------------------------------

  if (officialTransferCredit) {
    return {
      eligible: false,

      // Reuse the existing "already academically satisfied"
      // exclusion bucket so all current enrollment callers
      // continue to block this subject correctly.
      eligibility_type: ELIGIBILITY_TYPE.ALREADY_PASSED,

      reason:
        "Subject requirement is already satisfied by official transfer credit.",

      subject: subjectData,

      // Preserve actual PTC grade history separately.
      // This may be null, failed, incomplete, etc.
      latest_approved_grade: latestApprovedGrade,

      prerequisites: prerequisiteCheck,

      academic_satisfaction: {
        satisfied: true,

        source: "TRANSFER_CREDIT",

        ptc_approved_grade_pass: false,

        official_transfer_credit: true,

        transfer_evaluation_id: Number(
          officialTransferCredit.transfer_evaluation_id,
        ),

        transfer_subject_id: Number(officialTransferCredit.transfer_subject_id),

        credited_units: Number(
          officialTransferCredit.credit?.credited_units || 0,
        ),

        source_school: officialTransferCredit.source?.school || null,

        source_subject_code:
          officialTransferCredit.source?.subject_code || null,

        source_subject_name:
          officialTransferCredit.source?.subject_name || null,

        source_grade: officialTransferCredit.source?.grade ?? null,
      },
    };
  }

  // ---------------------------------------------------
  // Invalid / unresolved Approved record.
  //
  // This should not occur after our DB grade contract,
  // but existing legacy data must not silently pass.
  // ---------------------------------------------------

  if (
    latestApprovedGrade &&
    (latestApprovedGrade.result === ACADEMIC_RESULT.INVALID ||
      latestApprovedGrade.result === ACADEMIC_RESULT.NONE)
  ) {
    return {
      eligible: false,

      eligibility_type: ELIGIBILITY_TYPE.UNRESOLVED,

      reason: "Latest approved academic result is unresolved.",

      subject: subjectData,

      latest_approved_grade: latestApprovedGrade,

      prerequisites: prerequisiteCheck,
    };
  }

  // ---------------------------------------------------
  // Prerequisites always apply before eligibility.
  // ---------------------------------------------------

  if (!prerequisiteCheck.satisfied) {
    return {
      eligible: false,

      eligibility_type: ELIGIBILITY_TYPE.BLOCKED_PREREQUISITE,

      reason: "One or more prerequisites have not been passed.",

      subject: subjectData,

      latest_approved_grade: latestApprovedGrade,

      prerequisites: prerequisiteCheck,
    };
  }

  // ---------------------------------------------------
  // 4.00 / 5.00 = valid retake
  // ---------------------------------------------------

  if (
    latestApprovedGrade &&
    (latestApprovedGrade.result === ACADEMIC_RESULT.INCOMPLETE ||
      latestApprovedGrade.result === ACADEMIC_RESULT.FAILED)
  ) {
    return {
      eligible: true,

      eligibility_type: ELIGIBILITY_TYPE.RETAKE,

      reason:
        latestApprovedGrade.result === ACADEMIC_RESULT.INCOMPLETE
          ? "Latest approved result is Incomplete (4.00)."
          : "Latest approved result is Failed (5.00).",

      subject: subjectData,

      latest_approved_grade: latestApprovedGrade,

      prerequisites: prerequisiteCheck,
    };
  }

  // ---------------------------------------------------
  // No Approved attempt + prerequisites satisfied
  // = normal Regular subject.
  //
  // Freshmen with no prior history naturally reach here.
  // ---------------------------------------------------

  return {
    eligible: true,

    eligibility_type: ELIGIBILITY_TYPE.REGULAR,

    reason: "Subject has not been passed and all prerequisites are satisfied.",

    subject: subjectData,

    latest_approved_grade: null,

    prerequisites: prerequisiteCheck,
  };
}

// =====================================================
// GET CURRICULUM SUBJECTS FOR A TERM
// =====================================================

export async function getCurriculumSubjectsForTerm(
  curriculumId,
  yearLevel,
  semesterId,
  executor = db,
) {
  const safeCurriculumId = toPositiveInt(curriculumId, "curriculumId");

  const safeYearLevel = toPositiveInt(yearLevel, "yearLevel");

  const safeSemesterId = toPositiveInt(semesterId, "semesterId");

  const database = getExecutor(executor);

  const [rows] = await database.execute(
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
          s.lecture_hours,
          s.laboratory_hours,
          s.is_active

      FROM curriculum_subjects cs

      INNER JOIN subjects s
          ON s.subject_id =
             cs.subject_id

      WHERE
          cs.curriculum_id = ?

          AND cs.year_level = ?

          AND cs.semester_id = ?

      ORDER BY
          cs.display_order,
          s.subject_code
    `,
    [safeCurriculumId, safeYearLevel, safeSemesterId],
  );

  return rows.map((row) => ({
    curriculum_subject_id: Number(row.curriculum_subject_id),

    curriculum_id: Number(row.curriculum_id),

    subject_id: Number(row.subject_id),

    year_level: Number(row.year_level),

    semester_id: Number(row.semester_id),

    is_required: Number(row.is_required) === 1,

    display_order: Number(row.display_order),

    subject_code: row.subject_code,

    subject_name: row.subject_name,

    units: Number(row.units),

    lecture_hours: Number(row.lecture_hours || 0),

    laboratory_hours: Number(row.laboratory_hours || 0),

    is_active: Number(row.is_active) === 1,
  }));
}

// =====================================================
// EVALUATE CURRENT CURRICULUM TERM
// =====================================================

export async function evaluateCurriculumTerm(
  { studentId, curriculumId, yearLevel, semesterId },
  executor = db,
) {
  const database = getExecutor(executor);

  const subjects = await getCurriculumSubjectsForTerm(
    curriculumId,
    yearLevel,
    semesterId,
    database,
  );

  const evaluatedSubjects = [];

  for (const curriculumSubject of subjects) {
    const evaluation = await evaluateSubjectEligibility(
      studentId,
      curriculumSubject.subject_id,
      database,
    );

    evaluatedSubjects.push({
      ...curriculumSubject,

      eligible: evaluation.eligible,

      eligibility_type: evaluation.eligibility_type,

      reason: evaluation.reason,

      latest_approved_grade: evaluation.latest_approved_grade,

      prerequisites: evaluation.prerequisites,
    });
  }

  return {
    student_id: Number(studentId),

    curriculum_id: Number(curriculumId),

    year_level: Number(yearLevel),

    semester_id: Number(semesterId),

    subjects: evaluatedSubjects,

    regular: evaluatedSubjects.filter(
      (subject) =>
        subject.eligible &&
        subject.eligibility_type === ELIGIBILITY_TYPE.REGULAR,
    ),

    retakes: evaluatedSubjects.filter(
      (subject) =>
        subject.eligible &&
        subject.eligibility_type === ELIGIBILITY_TYPE.RETAKE,
    ),

    blocked: evaluatedSubjects.filter((subject) => !subject.eligible),
  };
}
// =====================================================
// GET CARRY-OVER / BACKLOG SUBJECTS
//
// A Carry-Over subject is:
//
// - part of the Student's active curriculum
// - required
// - from an EARLIER curriculum term
// - not already passed
// - not a 4.00 / 5.00 retake
// - never officially taken in an Approved enrollment
// - prerequisites are now satisfied
//
// IMPORTANT:
//
// An old subject that was officially enrolled but still
// has no Approved academic result is NOT Carry-Over.
// That is an unresolved academic attempt.
// =====================================================

export async function getCarryOverCandidates(
  studentId,
  curriculumId,
  currentYearLevel,
  currentSemesterId,
  executor = db,
) {
  const safeStudentId = toPositiveInt(studentId, "studentId");

  const safeCurriculumId = toPositiveInt(curriculumId, "curriculumId");

  const safeYearLevel = toPositiveInt(currentYearLevel, "currentYearLevel");

  const safeSemesterId = toPositiveInt(currentSemesterId, "currentSemesterId");

  if (![1, 2].includes(safeSemesterId)) {
    throw new Error(
      "Carry-over evaluation supports only First Semester and Second Semester.",
    );
  }

  const database = getExecutor(executor);

  // ===================================================
  // LOAD REQUIRED SUBJECTS FROM EARLIER TERMS
  //
  // Examples:
  //
  // Current: Year 1 / Sem 2
  // Previous:
  //   Year 1 / Sem 1
  //
  // Current: Year 2 / Sem 1
  // Previous:
  //   Year 1 / Sem 1
  //   Year 1 / Sem 2
  //
  // Current: Year 2 / Sem 2
  // Previous:
  //   Year 1 / Sem 1
  //   Year 1 / Sem 2
  //   Year 2 / Sem 1
  // ===================================================

  const [rows] = await database.execute(
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
          s.lecture_hours,
          s.laboratory_hours,
          s.is_active,

          CASE
              WHEN EXISTS (
                  SELECT 1

                  FROM enrollment_subjects es

                  INNER JOIN enrollments e
                      ON e.enrollment_id =
                         es.enrollment_id

                  WHERE e.student_id = ?

                    AND es.subject_id =
                        cs.subject_id

                    AND e.enrollment_status =
                        'Approved'

                    AND es.status NOT IN (
                        'Dropped',
                        'Withdrawn'
                    )
              )
              THEN 1
              ELSE 0
          END AS has_official_attempt

      FROM curriculum_subjects cs

      INNER JOIN subjects s
          ON s.subject_id =
             cs.subject_id

      WHERE cs.curriculum_id = ?

        AND cs.is_required = 1

        AND s.is_active = 1

        AND cs.semester_id IN (1, 2)

        AND (
            cs.year_level < ?

            OR (
                cs.year_level = ?

                AND cs.semester_id < ?
            )
        )

      ORDER BY
          cs.year_level ASC,
          cs.semester_id ASC,
          cs.display_order ASC,
          s.subject_code ASC
    `,
    [
      safeStudentId,
      safeCurriculumId,
      safeYearLevel,
      safeYearLevel,
      safeSemesterId,
    ],
  );

  const eligible = [];
  const blocked = [];

  for (const row of rows) {
    const subjectId = Number(row.subject_id);

    const evaluation = await evaluateSubjectEligibility(
      safeStudentId,
      subjectId,
      database,
    );

    const baseSubject = {
      curriculum_subject_id: Number(row.curriculum_subject_id),

      curriculum_id: Number(row.curriculum_id),

      subject_id: subjectId,

      subject_code: row.subject_code,

      subject_name: row.subject_name,

      units: Number(row.units || 0),

      lecture_hours: Number(row.lecture_hours || 0),

      laboratory_hours: Number(row.laboratory_hours || 0),

      original_year_level: Number(row.year_level),

      original_semester_id: Number(row.semester_id),

      is_required: Number(row.is_required) === 1,

      display_order: Number(row.display_order),

      has_official_attempt: Number(row.has_official_attempt) === 1,

      prerequisites: evaluation.prerequisites,
    };

    // ===============================================
    // ALREADY PASSED
    //
    // Never enroll again.
    // ===============================================

    if (evaluation.eligibility_type === ELIGIBILITY_TYPE.ALREADY_PASSED) {
      continue;
    }

    // ===============================================
    // RETAKE
    //
    // getRetakeCandidates() owns 4.00 / 5.00.
    // Do not duplicate it as Carry-Over.
    // ===============================================

    if (evaluation.eligibility_type === ELIGIBILITY_TYPE.RETAKE) {
      continue;
    }

    // ===============================================
    // OFFICIAL ATTEMPT EXISTS BUT NO RESOLVED
    // APPROVED RESULT
    //
    // This is NOT a never-taken Carry-Over.
    // ===============================================

    if (Number(row.has_official_attempt) === 1) {
      blocked.push({
        ...baseSubject,

        eligible: false,

        eligibility_type: ELIGIBILITY_TYPE.UNRESOLVED,

        reason:
          "Subject has an official enrollment attempt but does not yet have a resolved Approved academic result.",

        carry_over_reason: "OFFICIAL_ATTEMPT_UNRESOLVED",
      });

      continue;
    }

    // ===============================================
    // PREREQUISITES STILL BLOCKED
    // ===============================================

    if (evaluation.eligibility_type === ELIGIBILITY_TYPE.BLOCKED_PREREQUISITE) {
      blocked.push({
        ...baseSubject,

        eligible: false,

        eligibility_type: ELIGIBILITY_TYPE.BLOCKED_PREREQUISITE,

        reason: evaluation.reason,

        carry_over_reason: "PREREQUISITE_NOT_PASSED",
      });

      continue;
    }

    // ===============================================
    // OTHER UNRESOLVED STATE
    // ===============================================

    if (evaluation.eligibility_type === ELIGIBILITY_TYPE.UNRESOLVED) {
      blocked.push({
        ...baseSubject,

        eligible: false,

        eligibility_type: ELIGIBILITY_TYPE.UNRESOLVED,

        reason: evaluation.reason,

        carry_over_reason: "ACADEMIC_RESULT_UNRESOLVED",
      });

      continue;
    }

    // ===============================================
    // NEVER TAKEN + PREREQUISITES SATISFIED
    //
    // Valid Carry-Over.
    // ===============================================

    if (evaluation.eligibility_type === ELIGIBILITY_TYPE.REGULAR) {
      eligible.push({
        ...baseSubject,

        eligible: true,

        eligibility_type: ELIGIBILITY_TYPE.CARRY_OVER,

        enrollment_type: "Carry Over",

        carry_over_reason: "EARLIER_REQUIRED_SUBJECT_NOT_TAKEN",

        reason:
          "Required subject from an earlier curriculum term is now academically eligible.",
      });
    }
  }

  return {
    student_id: safeStudentId,

    curriculum_id: safeCurriculumId,

    current_year_level: safeYearLevel,

    current_semester_id: safeSemesterId,

    eligible,

    blocked,

    summary: {
      eligible: eligible.length,

      blocked: blocked.length,
    },
  };
}

// =====================================================
// GET VALID RETAKE CANDIDATES
// =====================================================
//
// Retakes must:
//
// - belong to the student's active curriculum
// - have an Approved 4.00 or 5.00 result
// - not already have a later Approved passing result
//
// =====================================================

export async function getRetakeCandidates(
  studentId,
  curriculumId = null,
  executor = db,
) {
  const safeStudentId = toPositiveInt(studentId, "studentId");

  const database = getExecutor(executor);

  let safeCurriculumId;

  if (curriculumId !== null && curriculumId !== undefined) {
    safeCurriculumId = toPositiveInt(curriculumId, "curriculumId");
  } else {
    const [curriculumRows] = await database.execute(
      `
          SELECT
              sc.curriculum_id

          FROM student_curriculum sc

          INNER JOIN curriculum c
              ON c.curriculum_id =
                 sc.curriculum_id

          WHERE
              sc.student_id = ?

              AND sc.status = 'Active'

              AND c.is_active = 1

          ORDER BY
              sc.assigned_date DESC,
              sc.student_curriculum_id DESC

          LIMIT 1
        `,
      [safeStudentId],
    );

    if (curriculumRows.length === 0) {
      return [];
    }

    safeCurriculumId = Number(curriculumRows[0].curriculum_id);
  }

  const [curriculumSubjects] = await database.execute(
    `
        SELECT DISTINCT
            cs.subject_id,

            s.subject_code,
            s.subject_name,
            s.units

        FROM curriculum_subjects cs

        INNER JOIN subjects s
            ON s.subject_id =
               cs.subject_id

        WHERE
            cs.curriculum_id = ?

            AND s.is_active = 1

        ORDER BY
            s.subject_code
      `,
    [safeCurriculumId],
  );

  const retakes = [];

  for (const subject of curriculumSubjects) {
    const evaluation = await evaluateSubjectEligibility(
      safeStudentId,
      Number(subject.subject_id),
      database,
    );

    if (
      evaluation.eligible &&
      evaluation.eligibility_type === ELIGIBILITY_TYPE.RETAKE
    ) {
      retakes.push({
        subject_id: Number(subject.subject_id),

        subject_code: subject.subject_code,

        subject_name: subject.subject_name,

        units: Number(subject.units),

        previous_final_rating:
          evaluation.latest_approved_grade?.final_rating ?? null,

        previous_result: evaluation.latest_approved_grade?.result ?? null,

        previous_grade_id: evaluation.latest_approved_grade?.grade_id ?? null,

        prerequisites: evaluation.prerequisites,
      });
    }
  }

  return retakes;
}

// =====================================================
// DEFAULT EXPORT
// =====================================================

export default {
  classifyFinalRating,

  getApprovedAcademicHistory,

  getLatestApprovedGrade,

  hasPassedSubject,

  getSubjectPrerequisites,

  checkPrerequisites,

  evaluateSubjectEligibility,

  getCurriculumSubjectsForTerm,

  evaluateCurriculumTerm,

  getCarryOverCandidates,

  getRetakeCandidates,
};
