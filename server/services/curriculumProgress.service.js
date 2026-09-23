import db from "../db.js";

import { getOfficialAcademicRecordForStudent } from "./academicRecord.service.js";

export const CURRICULUM_PROGRESS_STATUS = Object.freeze({
  COMPLETED_PTC: "COMPLETED_PTC",
  COMPLETED_TRANSFER: "COMPLETED_TRANSFER",
  RETAKE_REQUIRED: "RETAKE_REQUIRED",
  ELIGIBLE: "ELIGIBLE",
  BLOCKED_PREREQUISITE: "BLOCKED_PREREQUISITE",
  NOT_YET_DUE: "NOT_YET_DUE",
  UNRESOLVED: "UNRESOLVED",
});

function toPositiveInt(value, fieldName) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return number;
}

function toOptionalPositiveInt(value, fieldName) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return toPositiveInt(value, fieldName);
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

function roundToTwo(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function getTermRank(yearLevel, semesterId) {
  const year = Number(yearLevel);
  const semester = Number(semesterId);

  if (!Number.isInteger(year) || year <= 0) {
    return null;
  }

  if (![1, 2].includes(semester)) {
    return null;
  }

  return year * 10 + semester;
}

function isFutureCurriculumTerm({
  subjectYearLevel,
  subjectSemesterId,
  currentYearLevel,
  currentSemesterId,
}) {
  const subjectRank = getTermRank(subjectYearLevel, subjectSemesterId);

  const currentRank = getTermRank(currentYearLevel, currentSemesterId);

  if (subjectRank === null || currentRank === null) {
    return false;
  }

  return subjectRank > currentRank;
}

function selectLatestPtcRecord(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return null;
  }

  return records[records.length - 1];
}

function selectLatestTransferRecord(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return null;
  }

  const sortedRecords = [...records].sort((a, b) => {
    const evaluationA = Number(a.transfer_evaluation_id || 0);
    const evaluationB = Number(b.transfer_evaluation_id || 0);

    if (evaluationA !== evaluationB) {
      return evaluationA - evaluationB;
    }

    return (
      Number(a.transfer_subject_id || 0) - Number(b.transfer_subject_id || 0)
    );
  });

  return sortedRecords[sortedRecords.length - 1];
}

export async function getCurriculumProgressForStudent(
  studentId,
  { curriculumId = null, executor = db } = {},
) {
  const safeStudentId = toPositiveInt(studentId, "studentId");

  const requestedCurriculumId = toOptionalPositiveInt(
    curriculumId,
    "curriculumId",
  );

  const database = getExecutor(executor);

  // =====================================================
  // 1. STUDENT
  // =====================================================

  const [studentRows] = await database.execute(
    `
      SELECT
          s.student_id,
          s.student_number,

          s.first_name,
          s.middle_name,
          s.last_name,

          s.course_id,
          s.year_level,

          s.academic_year_id
              AS profile_academic_year_id,

          s.semester_id
              AS profile_semester_id,

          c.course_code,
          c.course_name

      FROM students s

      INNER JOIN courses c
          ON c.course_id =
             s.course_id

      WHERE s.student_id = ?

      LIMIT 1
    `,
    [safeStudentId],
  );

  if (studentRows.length === 0) {
    const error = new Error("Student profile was not found.");

    error.code = "STUDENT_PROFILE_NOT_FOUND";

    throw error;
  }

  const student = studentRows[0];

  const studentCourseId = Number(student.course_id);

  const currentYearLevel = Number(student.year_level);

  // =====================================================
  // 2. ACTIVE STUDENT CURRICULUM
  // =====================================================

  const curriculumParams = [safeStudentId, studentCourseId];

  let curriculumFilter = "";

  if (requestedCurriculumId !== null) {
    curriculumFilter = "AND sc.curriculum_id = ?";

    curriculumParams.push(requestedCurriculumId);
  }

  const [curriculumRows] = await database.execute(
    `
      SELECT
          sc.student_curriculum_id,
          sc.student_id,
          sc.curriculum_id,
          sc.assigned_date,

          sc.status
              AS assignment_status,

          cur.curriculum_name,
          cur.effective_year,

          cur.total_units
              AS declared_total_units,

          cur.course_id,
          cur.is_active

      FROM student_curriculum sc

      INNER JOIN curriculum cur
          ON cur.curriculum_id =
             sc.curriculum_id

      WHERE sc.student_id = ?

        AND sc.status = 'Active'

        AND cur.is_active = 1

        AND cur.course_id = ?

        ${curriculumFilter}

      ORDER BY
          sc.assigned_date DESC,
          sc.student_curriculum_id DESC

      LIMIT 1
    `,
    curriculumParams,
  );

  if (curriculumRows.length === 0) {
    const error = new Error(
      requestedCurriculumId !== null
        ? "The requested curriculum is not the Student's active curriculum."
        : "The Student does not have a valid active curriculum.",
    );

    error.code =
      requestedCurriculumId !== null
        ? "ACTIVE_CURRICULUM_MISMATCH"
        : "VALID_ACTIVE_CURRICULUM_REQUIRED";

    throw error;
  }

  const curriculum = curriculumRows[0];

  const activeCurriculumId = Number(curriculum.curriculum_id);

  // =====================================================
  // 3. CURRENT ACADEMIC CONTEXT
  //
  // Prefer the currently Open enrollment period.
  //
  // If there is no Open period, fall back to the
  // Student profile semester.
  // =====================================================

  const [openPeriodRows] = await database.execute(
    `
      SELECT
          ep.enrollment_period_id,

          ep.academic_year_id,
          ay.academic_year,

          ep.semester_id,
          sem.semester_name,

          ep.status

      FROM enrollment_periods ep

      INNER JOIN academic_years ay
          ON ay.academic_year_id =
             ep.academic_year_id

      INNER JOIN semesters sem
          ON sem.semester_id =
             ep.semester_id

      WHERE ep.status = 'Open'

        AND ep.semester_id IN (1, 2)

      ORDER BY
          ep.enrollment_period_id DESC

      LIMIT 1
    `,
  );

  const openPeriod = openPeriodRows.length > 0 ? openPeriodRows[0] : null;

  const profileSemesterId = Number(student.profile_semester_id);

  const currentSemesterId = openPeriod
    ? Number(openPeriod.semester_id)
    : [1, 2].includes(profileSemesterId)
      ? profileSemesterId
      : null;

  // =====================================================
  // 4. ALL SUBJECTS IN ACTIVE CURRICULUM
  // =====================================================

  const [curriculumSubjectRows] = await database.execute(
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

          sem.semester_name

      FROM curriculum_subjects cs

      INNER JOIN subjects s
          ON s.subject_id =
             cs.subject_id

      INNER JOIN semesters sem
          ON sem.semester_id =
             cs.semester_id

      WHERE cs.curriculum_id = ?

      ORDER BY
          cs.year_level ASC,
          cs.semester_id ASC,
          cs.display_order ASC,
          s.subject_code ASC
    `,
    [activeCurriculumId],
  );

  // =====================================================
  // 5. OFFICIAL ACADEMIC RECORD
  //
  // Authoritative sources:
  //
  // PTC:
  // Approved enrollment + Approved grade
  //
  // Transfer:
  // Completed evaluation + Credited subject
  //
  // Transfer source grade remains separate.
  // =====================================================

  const academicRecord = await getOfficialAcademicRecordForStudent(
    safeStudentId,
    {
      curriculumId: activeCurriculumId,
      executor: database,
    },
  );

  // =====================================================
  // 6. PTC RECORD MAPS
  // =====================================================

  const ptcRecordsBySubject = new Map();

  const passingPtcBySubject = new Map();

  for (const record of academicRecord.ptc_grade_records || []) {
    const subjectIdValue = Number(record.subject_id);

    if (!Number.isInteger(subjectIdValue) || subjectIdValue <= 0) {
      continue;
    }

    if (!ptcRecordsBySubject.has(subjectIdValue)) {
      ptcRecordsBySubject.set(subjectIdValue, []);
    }

    ptcRecordsBySubject.get(subjectIdValue).push(record);

    if (record.classification === "Passed") {
      // If multiple historical passing records somehow
      // exist, retain the latest one.
      passingPtcBySubject.set(subjectIdValue, record);
    }
  }

  // =====================================================
  // 7. TRANSFER-CREDIT RECORD MAPS
  //
  // Multiple official historical transfer evaluations
  // may map to the same PTC subject.
  //
  // They remain official records, but they satisfy the
  // curriculum requirement only once.
  // =====================================================

  const transferRecordsBySubject = new Map();

  for (const record of academicRecord.transfer_credit_records || []) {
    const subjectIdValue = Number(record.subject_id);

    if (!Number.isInteger(subjectIdValue) || subjectIdValue <= 0) {
      continue;
    }

    if (!transferRecordsBySubject.has(subjectIdValue)) {
      transferRecordsBySubject.set(subjectIdValue, []);
    }

    transferRecordsBySubject.get(subjectIdValue).push(record);
  }

  // =====================================================
  // 8. SATISFIED PTC SUBJECT IDS
  //
  // Satisfaction sources:
  //
  // - Approved passing PTC grade
  // - Official Transfer Credit
  // =====================================================

  const satisfiedSubjectIds = new Set([
    ...passingPtcBySubject.keys(),
    ...transferRecordsBySubject.keys(),
  ]);

  // =====================================================
  // 9. LOAD PREREQUISITES FOR CURRICULUM SUBJECTS
  // =====================================================

  const curriculumSubjectIds = curriculumSubjectRows.map((row) =>
    Number(row.subject_id),
  );

  const prerequisiteMap = new Map();

  if (curriculumSubjectIds.length > 0) {
    const placeholders = curriculumSubjectIds.map(() => "?").join(", ");

    const [prerequisiteRows] = await database.execute(
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

          WHERE sp.subject_id
                IN (${placeholders})

          ORDER BY
              sp.subject_id ASC,
              sp.prerequisite_id ASC
        `,
      curriculumSubjectIds,
    );

    for (const row of prerequisiteRows) {
      const dependentSubjectId = Number(row.subject_id);

      const prerequisiteSubjectId = Number(row.prerequisite_subject_id);

      if (!prerequisiteMap.has(dependentSubjectId)) {
        prerequisiteMap.set(dependentSubjectId, []);
      }

      const ptcPass = passingPtcBySubject.get(prerequisiteSubjectId) || null;

      const transferRecord = selectLatestTransferRecord(
        transferRecordsBySubject.get(prerequisiteSubjectId) || [],
      );

      const ptcApprovedGradePass = Boolean(ptcPass);

      const officialTransferCredit = Boolean(transferRecord);

      const isSatisfied =
        ptcApprovedGradePass ||
        officialTransferCredit ||
        satisfiedSubjectIds.has(prerequisiteSubjectId);

      prerequisiteMap.get(dependentSubjectId).push({
        prerequisite_id: Number(row.prerequisite_id),

        prerequisite_subject_id: prerequisiteSubjectId,

        prerequisite_subject_code: row.prerequisite_subject_code,

        prerequisite_subject_name: row.prerequisite_subject_name,

        prerequisite_units: Number(row.prerequisite_units || 0),

        is_satisfied: isSatisfied,

        satisfaction_source: ptcApprovedGradePass
          ? "PTC_APPROVED_GRADE"
          : officialTransferCredit
            ? "TRANSFER_CREDIT"
            : null,

        ptc_approved_grade_pass: ptcApprovedGradePass,

        official_transfer_credit: officialTransferCredit,

        ptc_final_rating: ptcPass?.final_rating ?? null,

        transfer_source_grade: transferRecord?.source_grade ?? null,
      });
    }
  }

  // =====================================================
  // 10. BUILD CURRICULUM PROGRESS SUBJECTS
  // =====================================================

  const subjects = curriculumSubjectRows.map((row) => {
    const subjectIdValue = Number(row.subject_id);

    const curriculumUnits = Number(row.units || 0);

    const allPtcRecords = ptcRecordsBySubject.get(subjectIdValue) || [];

    const latestPtcRecord = selectLatestPtcRecord(allPtcRecords);

    const passingPtcRecord = passingPtcBySubject.get(subjectIdValue) || null;

    const transferRecords = transferRecordsBySubject.get(subjectIdValue) || [];

    const transferRecord = selectLatestTransferRecord(transferRecords);

    const prerequisites = prerequisiteMap.get(subjectIdValue) || [];

    const missingPrerequisites = prerequisites.filter(
      (prerequisite) => !prerequisite.is_satisfied,
    );

    const baseSubject = {
      curriculum_subject_id: Number(row.curriculum_subject_id),

      curriculum_id: Number(row.curriculum_id),

      subject_id: subjectIdValue,

      subject_code: row.subject_code,

      subject_name: row.subject_name,

      units: curriculumUnits,

      lecture_hours: Number(row.lecture_hours || 0),

      laboratory_hours: Number(row.laboratory_hours || 0),

      year_level: Number(row.year_level),

      semester_id: Number(row.semester_id),

      semester_name: row.semester_name,

      is_required: Number(row.is_required) === 1,

      display_order:
        row.display_order !== null && row.display_order !== undefined
          ? Number(row.display_order)
          : null,

      prerequisites,

      missing_prerequisites: missingPrerequisites,

      prerequisites_satisfied: missingPrerequisites.length === 0,
    };

    // ===============================================
    // COMPLETED BY PTC GRADE
    //
    // PTC completion wins as the displayed source
    // when legacy data contains both a PTC pass and
    // Transfer Credit for the same requirement.
    // ===============================================

    if (passingPtcRecord) {
      return {
        ...baseSubject,

        progress_status: CURRICULUM_PROGRESS_STATUS.COMPLETED_PTC,

        completed: true,

        curriculum_satisfied: true,

        completion_source: "PTC_GRADE",

        curriculum_units_satisfied: curriculumUnits,

        ptc_grade: {
          grade_id: Number(passingPtcRecord.grade_id),

          enrollment_subject_id: Number(passingPtcRecord.enrollment_subject_id),

          enrollment_id: Number(passingPtcRecord.enrollment_id),

          final_rating: passingPtcRecord.final_rating,

          classification: passingPtcRecord.classification,

          academic_year: passingPtcRecord.academic_year,

          semester_name: passingPtcRecord.semester_name,
        },

        transfer_credit: transferRecord
          ? {
              duplicate_satisfaction_record: true,

              transfer_evaluation_id: Number(
                transferRecord.transfer_evaluation_id,
              ),

              transfer_subject_id: Number(transferRecord.transfer_subject_id),

              credited_units: Number(transferRecord.units || 0),

              source_grade: transferRecord.source_grade ?? null,
            }
          : null,

        latest_ptc_result: latestPtcRecord
          ? {
              final_rating: latestPtcRecord.final_rating,

              classification: latestPtcRecord.classification,
            }
          : null,
      };
    }

    // ===============================================
    // COMPLETED BY TRANSFER CREDIT
    // ===============================================

    if (transferRecord) {
      return {
        ...baseSubject,

        progress_status: CURRICULUM_PROGRESS_STATUS.COMPLETED_TRANSFER,

        completed: true,

        curriculum_satisfied: true,

        completion_source: "TRANSFER_CREDIT",

        // Curriculum progress counts the actual
        // requirement units, not duplicate transfer
        // records.
        curriculum_units_satisfied: curriculumUnits,

        // Never manufacture a PTC grade.
        ptc_grade: null,

        transfer_credit: {
          transfer_evaluation_id: Number(transferRecord.transfer_evaluation_id),

          transfer_subject_id: Number(transferRecord.transfer_subject_id),

          credited_units: Number(transferRecord.units || 0),

          source_grade: transferRecord.source_grade ?? null,

          source_school: transferRecord.transfer_source?.school || null,

          source_subject_code:
            transferRecord.transfer_source?.subject_code || null,

          source_subject_name:
            transferRecord.transfer_source?.subject_name || null,

          // Useful for detecting historical
          // duplicate official mappings.
          official_record_count: transferRecords.length,
        },

        latest_ptc_result: latestPtcRecord
          ? {
              final_rating: latestPtcRecord.final_rating,

              classification: latestPtcRecord.classification,
            }
          : null,
      };
    }

    // ===============================================
    // INVALID / UNRESOLVED PTC RESULT
    // ===============================================

    if (latestPtcRecord && latestPtcRecord.classification === "Unknown") {
      return {
        ...baseSubject,

        progress_status: CURRICULUM_PROGRESS_STATUS.UNRESOLVED,

        completed: false,

        curriculum_satisfied: false,

        completion_source: null,

        curriculum_units_satisfied: 0,

        ptc_grade: null,

        transfer_credit: null,

        latest_ptc_result: {
          final_rating: latestPtcRecord.final_rating,

          classification: latestPtcRecord.classification,
        },
      };
    }

    // ===============================================
    // FUTURE CURRICULUM TERM
    //
    // A future subject should not appear blocked
    // merely because an earlier prerequisite has not
    // yet been completed.
    // ===============================================

    const futureTerm = isFutureCurriculumTerm({
      subjectYearLevel: row.year_level,

      subjectSemesterId: row.semester_id,

      currentYearLevel,

      currentSemesterId,
    });

    if (futureTerm) {
      return {
        ...baseSubject,

        progress_status: CURRICULUM_PROGRESS_STATUS.NOT_YET_DUE,

        completed: false,

        curriculum_satisfied: false,

        completion_source: null,

        curriculum_units_satisfied: 0,

        ptc_grade: null,

        transfer_credit: null,

        latest_ptc_result: latestPtcRecord
          ? {
              final_rating: latestPtcRecord.final_rating,

              classification: latestPtcRecord.classification,
            }
          : null,
      };
    }

    // ===============================================
    // PREREQUISITES NOT SATISFIED
    // ===============================================

    if (missingPrerequisites.length > 0) {
      return {
        ...baseSubject,

        progress_status: CURRICULUM_PROGRESS_STATUS.BLOCKED_PREREQUISITE,

        completed: false,

        curriculum_satisfied: false,

        completion_source: null,

        curriculum_units_satisfied: 0,

        ptc_grade: null,

        transfer_credit: null,

        latest_ptc_result: latestPtcRecord
          ? {
              final_rating: latestPtcRecord.final_rating,

              classification: latestPtcRecord.classification,
            }
          : null,
      };
    }

    // ===============================================
    // RETAKE REQUIRED
    //
    // 4.00 = Incomplete
    // 5.00 = Failed
    // ===============================================

    if (
      latestPtcRecord &&
      ["Incomplete", "Failed"].includes(latestPtcRecord.classification)
    ) {
      return {
        ...baseSubject,

        progress_status: CURRICULUM_PROGRESS_STATUS.RETAKE_REQUIRED,

        completed: false,

        curriculum_satisfied: false,

        completion_source: null,

        curriculum_units_satisfied: 0,

        ptc_grade: null,

        transfer_credit: null,

        latest_ptc_result: {
          final_rating: latestPtcRecord.final_rating,

          classification: latestPtcRecord.classification,
        },
      };
    }

    // ===============================================
    // CURRENT / PAST UNSATISFIED REQUIREMENT
    //
    // No Approved passing grade.
    // No official Transfer Credit.
    // Prerequisites satisfied.
    // ===============================================

    return {
      ...baseSubject,

      progress_status: CURRICULUM_PROGRESS_STATUS.ELIGIBLE,

      completed: false,

      curriculum_satisfied: false,

      completion_source: null,

      curriculum_units_satisfied: 0,

      ptc_grade: null,

      transfer_credit: null,

      latest_ptc_result: null,
    };
  });

  // =====================================================
  // 11. CURRICULUM UNIT TOTALS
  //
  // IMPORTANT:
  //
  // Curriculum 6 currently has:
  //
  // declared = 185
  // calculated = 179
  //
  // Never silently hide this mismatch.
  // =====================================================

  const declaredCurriculumUnits = toNullableNumber(
    curriculum.declared_total_units,
  );

  const calculatedCurriculumUnits = curriculumSubjectRows.reduce(
    (total, row) => total + Number(row.units || 0),
    0,
  );

  // =====================================================
  // 12. COMPLETED CURRICULUM REQUIREMENTS
  // =====================================================

  const completedSubjects = subjects.filter((subject) => subject.completed);

  const completedCurriculumUnits = completedSubjects.reduce(
    (total, subject) => total + Number(subject.units || 0),
    0,
  );

  const remainingCurriculumUnits = Math.max(
    calculatedCurriculumUnits - completedCurriculumUnits,
    0,
  );

  const completionPercentage =
    calculatedCurriculumUnits > 0
      ? roundToTwo((completedCurriculumUnits / calculatedCurriculumUnits) * 100)
      : 0;

  // =====================================================
  // 13. DECLARED VS CALCULATED CURRICULUM UNITS
  // =====================================================

  const unitDifference =
    declaredCurriculumUnits !== null
      ? roundToTwo(declaredCurriculumUnits - calculatedCurriculumUnits)
      : null;

  const curriculumUnitMismatch =
    unitDifference !== null && Math.abs(unitDifference) > 0.000001;

  const countStatus = (status) =>
    subjects.filter((subject) => subject.progress_status === status).length;

  // =====================================================
  // 14. FINAL RESULT
  // =====================================================

  return {
    student_id: safeStudentId,

    student: {
      student_id: safeStudentId,

      student_number: student.student_number,

      student_name: [student.first_name, student.middle_name, student.last_name]
        .filter(Boolean)
        .join(" "),

      course: {
        course_id: studentCourseId,

        course_code: student.course_code,

        course_name: student.course_name,
      },

      year_level: currentYearLevel,
    },

    curriculum: {
      student_curriculum_id: Number(curriculum.student_curriculum_id),

      curriculum_id: activeCurriculumId,

      curriculum_name: curriculum.curriculum_name,

      effective_year:
        curriculum.effective_year !== null &&
        curriculum.effective_year !== undefined
          ? Number(curriculum.effective_year)
          : null,

      status: curriculum.assignment_status,

      assigned_date: curriculum.assigned_date || null,
    },

    current_academic_context: {
      year_level: currentYearLevel,

      semester_id: currentSemesterId,

      semester_name: openPeriod?.semester_name || null,

      academic_year_id: openPeriod
        ? Number(openPeriod.academic_year_id)
        : student.profile_academic_year_id !== null &&
            student.profile_academic_year_id !== undefined
          ? Number(student.profile_academic_year_id)
          : null,

      academic_year: openPeriod?.academic_year || null,

      source: openPeriod ? "OPEN_ENROLLMENT_PERIOD" : "STUDENT_PROFILE",
    },

    summary: {
      total_subjects: subjects.length,

      completed_subjects: completedSubjects.length,

      remaining_subjects: Math.max(
        subjects.length - completedSubjects.length,
        0,
      ),

      completed_ptc_subjects: countStatus(
        CURRICULUM_PROGRESS_STATUS.COMPLETED_PTC,
      ),

      completed_transfer_subjects: countStatus(
        CURRICULUM_PROGRESS_STATUS.COMPLETED_TRANSFER,
      ),

      retake_required_subjects: countStatus(
        CURRICULUM_PROGRESS_STATUS.RETAKE_REQUIRED,
      ),

      blocked_prerequisite_subjects: countStatus(
        CURRICULUM_PROGRESS_STATUS.BLOCKED_PREREQUISITE,
      ),

      eligible_subjects: countStatus(CURRICULUM_PROGRESS_STATUS.ELIGIBLE),

      not_yet_due_subjects: countStatus(CURRICULUM_PROGRESS_STATUS.NOT_YET_DUE),

      unresolved_subjects: countStatus(CURRICULUM_PROGRESS_STATUS.UNRESOLVED),

      declared_curriculum_units: declaredCurriculumUnits,

      calculated_curriculum_units: calculatedCurriculumUnits,

      curriculum_unit_mismatch: curriculumUnitMismatch,

      curriculum_unit_difference: unitDifference,

      completed_units: completedCurriculumUnits,

      remaining_units: remainingCurriculumUnits,

      completion_percentage: completionPercentage,

      // Read-only reference to the broader official
      // academic-record summary.
      official_academic_record_earned_units: Number(
        academicRecord.summary?.earned_units || 0,
      ),

      official_academic_record_unique_satisfied_subjects: Number(
        academicRecord.summary?.unique_satisfied_subjects || 0,
      ),
    },

    subjects,

    academic_rule: {
      official_ptc_completion: "Approved enrollment + Approved passing grade",

      official_transfer_completion:
        "Completed transfer evaluation + Credited transfer subject",

      transfer_grade_stored_as_ptc_grade: false,

      completion_deduplicated_by_ptc_subject: true,

      curriculum_progress_units_source:
        "SUM of units for subjects in the active curriculum",

      declared_curriculum_units_source: "curriculum.total_units",

      curriculum_unit_mismatch_exposed: true,

      prerequisite_satisfaction_sources: [
        "PTC_APPROVED_GRADE",
        "TRANSFER_CREDIT",
      ],
    },
  };
}

export default {
  CURRICULUM_PROGRESS_STATUS,
  getCurriculumProgressForStudent,
};
