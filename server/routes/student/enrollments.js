// routes/student/enrollments.js

import express from "express";
import db from "../../db.js";

import {
  ELIGIBILITY_TYPE,
  evaluateCurriculumTerm,
  getApprovedAcademicHistory,
  getCarryOverCandidates,
  getRetakeCandidates,
} from "../../services/academicEvaluation.service.js";

const router = express.Router();

// =====================================================
// STUDENT YEAR-LEVEL PROGRESSION
//
// RULES:
//
// First Semester
//   - May advance year level.
//
// Second Semester
//   - Keeps the same year level.
//
// Progression requires:
//   - A previous Approved Second Semester enrollment.
//   - Every active subject in that enrollment must have
//     an Approved grade with final_rating.
//
// IMPORTANT:
//
// 4.00 / 5.00 are RESOLVED academic results.
// They do NOT stop year progression.
// They remain Retake candidates.
//
// Draft / Submitted / Returned / missing grade
// DO stop progression.
//
// Maximum supported year level = 4.
// There is no Year 5.
// =====================================================

async function resolveStudentProgression({
  executor,
  studentId,
  currentYearLevel,
  profileAcademicYearId,
  profileSemesterId,
  currentAcademicYearId,
  currentSemesterId,
}) {
  const normalizedYearLevel = Number(currentYearLevel);

  const normalizedProfileAcademicYearId =
    profileAcademicYearId !== null && profileAcademicYearId !== undefined
      ? Number(profileAcademicYearId)
      : null;

  const normalizedProfileSemesterId =
    profileSemesterId !== null && profileSemesterId !== undefined
      ? Number(profileSemesterId)
      : null;

  const academicYearId = Number(currentAcademicYearId);

  const semesterId = Number(currentSemesterId);

  // ===================================================
  // VALIDATION
  // ===================================================

  if (
    !Number.isInteger(normalizedYearLevel) ||
    normalizedYearLevel < 1 ||
    normalizedYearLevel > 4
  ) {
    throw new Error(`Invalid Student year level: ${currentYearLevel}.`);
  }

  if (!Number.isInteger(academicYearId) || academicYearId <= 0) {
    throw new Error("Current academic year ID is invalid.");
  }

  if (![1, 2].includes(semesterId)) {
    return {
      can_enroll: false,

      blocked: true,

      code: "UNSUPPORTED_ENROLLMENT_SEMESTER",

      reason: "Only First Semester and Second Semester are supported.",

      previous_year_level: normalizedYearLevel,

      effective_year_level: normalizedYearLevel,

      advanced: false,

      previous_second_semester_enrollment: null,

      resolution: {
        active_subjects: 0,
        resolved_subjects: 0,
        unresolved_subjects: 0,
      },
    };
  }

  // ===================================================
  // SECOND SEMESTER
  //
  // Same academic year = same year level.
  // ===================================================

  if (semesterId === 2) {
    return {
      can_enroll: true,

      blocked: false,

      code: "SAME_YEAR_SECOND_SEMESTER",

      reason: "Second Semester continues the Student's current year level.",

      previous_year_level: normalizedYearLevel,

      effective_year_level: normalizedYearLevel,

      advanced: false,

      previous_second_semester_enrollment: null,

      resolution: {
        active_subjects: 0,
        resolved_subjects: 0,
        unresolved_subjects: 0,
      },
    };
  }

  // ===================================================
  // FIRST SEMESTER — ALREADY SYNCED
  //
  // This prevents:
  //
  // Year 1 → Year 2
  // then another prepare attempt incorrectly doing
  // Year 2 → Year 3 in the SAME academic year.
  // ===================================================

  if (normalizedProfileAcademicYearId === academicYearId) {
    return {
      can_enroll: true,

      blocked: false,

      code: "PROFILE_ALREADY_SYNCED",

      reason:
        "Student profile is already aligned with the current academic year.",

      previous_year_level: normalizedYearLevel,

      effective_year_level: normalizedYearLevel,

      advanced: false,

      previous_second_semester_enrollment: null,

      resolution: {
        active_subjects: 0,
        resolved_subjects: 0,
        unresolved_subjects: 0,
      },
    };
  }
  if (normalizedProfileAcademicYearId === null) {
    return {
      can_enroll: true,

      blocked: false,

      code: "NO_PREVIOUS_ACADEMIC_YEAR",

      reason: "No previous academic year requires year-level progression.",

      previous_year_level: normalizedYearLevel,

      effective_year_level: normalizedYearLevel,

      advanced: false,

      previous_second_semester_enrollment: null,

      resolution: {
        active_subjects: 0,
        resolved_subjects: 0,
        unresolved_subjects: 0,
      },
    };
  }
  // ===================================================
  // FIND MOST RECENT APPROVED SECOND SEMESTER
  //
  // It must be before the current AY.
  // Summer is not considered.
  // ===================================================

  const [previousEnrollmentRows] = await executor.execute(
    `
        SELECT
            e.enrollment_id,
            e.student_id,

            e.academic_year_id,
            ay.academic_year,

            e.semester_id,
            sem.semester_name,

            e.enrollment_status,
            e.approved_at

        FROM enrollments e

        INNER JOIN academic_years ay
            ON ay.academic_year_id =
               e.academic_year_id

        INNER JOIN semesters sem
            ON sem.semester_id =
               e.semester_id

        WHERE e.student_id = ?

          AND e.enrollment_status = 'Approved'

          AND e.semester_id = 2

          AND e.academic_year_id = ?

        ORDER BY
            e.academic_year_id DESC,
            e.enrollment_id DESC

        LIMIT 1
      `,
    [studentId, normalizedProfileAcademicYearId],
  );

  // ===================================================
  // NO PREVIOUS SECOND SEMESTER
  //
  // Freshmen / newly admitted Student.
  //
  // Do NOT automatically increment.
  // ===================================================

  if (previousEnrollmentRows.length === 0) {
    return {
      can_enroll: true,

      blocked: false,

      code: "NO_PREVIOUS_SECOND_SEMESTER",

      reason:
        "No previous Approved Second Semester enrollment requires year-level advancement.",

      previous_year_level: normalizedYearLevel,

      effective_year_level: normalizedYearLevel,

      advanced: false,

      previous_second_semester_enrollment: null,

      resolution: {
        active_subjects: 0,
        resolved_subjects: 0,
        unresolved_subjects: 0,
      },
    };
  }

  const previousEnrollment = previousEnrollmentRows[0];

  const previousEnrollmentId = Number(previousEnrollment.enrollment_id);

  // ===================================================
  // CHECK PREVIOUS SECOND SEMESTER RESULTS
  //
  // Every active enrollment_subject must have:
  //
  // grade_status = Approved
  // final_rating IS NOT NULL
  //
  // final_rating:
  // 1.00–3.00 = Passed
  // 4.00      = Incomplete
  // 5.00      = Failed
  //
  // ALL THREE are academically RESOLVED.
  // ===================================================

  const [resolutionRows] = await executor.execute(
    `
        SELECT
            COUNT(*) AS active_subjects,

            SUM(
              CASE
                WHEN EXISTS (
                  SELECT 1

                  FROM grades g

                  WHERE g.enrollment_subject_id =
                        es.enrollment_subject_id

                    AND g.grade_status = 'Approved'

                    AND g.final_rating IS NOT NULL
                )
                THEN 1
                ELSE 0
              END
            ) AS resolved_subjects,

            SUM(
              CASE
                WHEN EXISTS (
                  SELECT 1

                  FROM grades g

                  WHERE g.enrollment_subject_id =
                        es.enrollment_subject_id

                    AND g.grade_status = 'Approved'

                    AND g.final_rating IS NOT NULL
                )
                THEN 0
                ELSE 1
              END
            ) AS unresolved_subjects

        FROM enrollment_subjects es

        WHERE es.enrollment_id = ?

          AND es.status NOT IN (
            'Dropped',
            'Withdrawn'
          )
      `,
    [previousEnrollmentId],
  );

  const resolutionRow = resolutionRows[0] || {};

  const activeSubjects = Number(resolutionRow.active_subjects || 0);

  const resolvedSubjects = Number(resolutionRow.resolved_subjects || 0);

  const unresolvedSubjects = Number(resolutionRow.unresolved_subjects || 0);

  // ===================================================
  // DEFENSIVE — PREVIOUS ENROLLMENT HAS NO SUBJECTS
  // ===================================================

  if (activeSubjects === 0) {
    return {
      can_enroll: false,

      blocked: true,

      code: "PREVIOUS_TERM_HAS_NO_ACTIVE_SUBJECTS",

      reason:
        "The previous Approved Second Semester enrollment has no active subjects to evaluate.",

      previous_year_level: normalizedYearLevel,

      effective_year_level: normalizedYearLevel,

      advanced: false,

      previous_second_semester_enrollment: {
        enrollment_id: previousEnrollmentId,

        academic_year_id: Number(previousEnrollment.academic_year_id),

        academic_year: previousEnrollment.academic_year,

        semester_id: 2,

        semester_name: previousEnrollment.semester_name,

        approved_at: previousEnrollment.approved_at,
      },

      resolution: {
        active_subjects: activeSubjects,

        resolved_subjects: resolvedSubjects,

        unresolved_subjects: unresolvedSubjects,
      },
    };
  }

  // ===================================================
  // UNRESOLVED GRADES
  //
  // Prevent next-year progression until Faculty / PH
  // completes the grade lifecycle.
  // ===================================================

  if (unresolvedSubjects > 0) {
    return {
      can_enroll: false,

      blocked: true,

      code: "PREVIOUS_TERM_GRADES_UNRESOLVED",

      reason: `${unresolvedSubjects} subject(s) from the previous Second Semester do not yet have an Approved final rating.`,

      previous_year_level: normalizedYearLevel,

      effective_year_level: normalizedYearLevel,

      advanced: false,

      previous_second_semester_enrollment: {
        enrollment_id: previousEnrollmentId,

        academic_year_id: Number(previousEnrollment.academic_year_id),

        academic_year: previousEnrollment.academic_year,

        semester_id: 2,

        semester_name: previousEnrollment.semester_name,

        approved_at: previousEnrollment.approved_at,
      },

      resolution: {
        active_subjects: activeSubjects,

        resolved_subjects: resolvedSubjects,

        unresolved_subjects: unresolvedSubjects,
      },
    };
  }

  // ===================================================
  // ADVANCE YEAR
  //
  // Maximum = Year 4.
  //
  // Year 4 remains Year 4 even when entering another AY.
  // Retakes / unfinished requirements remain available.
  // ===================================================

  const effectiveYearLevel = Math.min(normalizedYearLevel + 1, 4);

  const advanced = effectiveYearLevel > normalizedYearLevel;

  return {
    can_enroll: true,

    blocked: false,

    code: advanced ? "YEAR_LEVEL_ADVANCED" : "MAX_YEAR_LEVEL_RETAINED",

    reason: advanced
      ? `Student advances from Year ${normalizedYearLevel} to Year ${effectiveYearLevel}.`
      : "Student remains Year 4 because the program has no Year 5.",

    previous_year_level: normalizedYearLevel,

    effective_year_level: effectiveYearLevel,

    advanced,

    previous_second_semester_enrollment: {
      enrollment_id: previousEnrollmentId,

      academic_year_id: Number(previousEnrollment.academic_year_id),

      academic_year: previousEnrollment.academic_year,

      semester_id: 2,

      semester_name: previousEnrollment.semester_name,

      approved_at: previousEnrollment.approved_at,
    },

    resolution: {
      active_subjects: activeSubjects,

      resolved_subjects: resolvedSubjects,

      unresolved_subjects: unresolvedSubjects,
    },
  };
}

// =====================================================
// GET CURRENT STUDENT ENROLLMENT
//
// GET /api/student/enrollments/current
//
// AUTH:
// Student JWT required.
//
// IMPORTANT:
// - No user_id from frontend.
// - No student_id from frontend.
// - Student identity comes ONLY from req.user.
// - Student can only view their own enrollment.
// - Approved enrollment is the authoritative source
//   of current-semester class membership.
// - Section / offering placement comes from
//   enrollment_subjects, NOT students.section_id.
// - Summer is excluded.
// =====================================================

router.get("/current", async (req, res) => {
  try {
    // =================================================
    // 1. AUTHENTICATION
    // =================================================

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
    }

    if (req.user.role_name !== "Student") {
      return res.status(403).json({
        success: false,
        message: "Student access is required.",
      });
    }

    const userId = Number(req.user.user_id);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user ID is invalid.",
      });
    }

    // =================================================
    // 2. GET AUTHENTICATED STUDENT
    // =================================================

    const [studentRows] = await db.execute(
      `
        SELECT
            s.student_id,
            s.user_id,
            s.student_number,

            s.first_name,
            s.middle_name,
            s.last_name,

            s.course_id,

            c.course_code,
            c.course_name,

            s.year_level,

            -- Profile values only.
            -- These are NOT authoritative enrollment placement.
            s.section_id AS profile_section_id,
            profile_section.section_name
                AS profile_section_name,

            s.academic_year_id
                AS profile_academic_year_id,

            profile_ay.academic_year
                AS profile_academic_year,

            s.semester_id
                AS profile_semester_id,

            profile_sem.semester_name
                AS profile_semester_name

        FROM students s

        INNER JOIN courses c
            ON c.course_id = s.course_id

        LEFT JOIN sections profile_section
            ON profile_section.section_id =
               s.section_id

        LEFT JOIN academic_years profile_ay
            ON profile_ay.academic_year_id =
               s.academic_year_id

        LEFT JOIN semesters profile_sem
            ON profile_sem.semester_id =
               s.semester_id

        WHERE s.user_id = ?

        LIMIT 1
      `,
      [userId],
    );

    if (studentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No Student profile is connected to this account.",
      });
    }

    const student = studentRows[0];

    const studentId = Number(student.student_id);

    const studentCourseId = Number(student.course_id);

    const yearLevel = Number(student.year_level);

    // =================================================
    // 3. GET ACTIVE CURRICULUM
    // =================================================

    const [curriculumRows] = await db.execute(
      `
        SELECT
            sc.student_curriculum_id,
            sc.student_id,
            sc.curriculum_id,

            sc.assigned_date,
            sc.status AS assignment_status,
            sc.remarks,

            cur.curriculum_name,
            cur.effective_year,
            cur.total_units,
            cur.is_active,

            cur.course_id
                AS curriculum_course_id,

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

          AND sc.status = 'Active'

          AND cur.is_active = 1

          AND cur.course_id = ?

        LIMIT 1
      `,
      [studentId, studentCourseId],
    );

    let curriculum = null;

    if (curriculumRows.length > 0) {
      const row = curriculumRows[0];

      curriculum = {
        student_curriculum_id: Number(row.student_curriculum_id),

        curriculum_id: Number(row.curriculum_id),

        curriculum_name: row.curriculum_name,

        effective_year:
          row.effective_year !== null ? Number(row.effective_year) : null,

        total_units: row.total_units !== null ? Number(row.total_units) : null,

        status: row.assignment_status,

        assigned_date: row.assigned_date,

        remarks: row.remarks || null,

        course: {
          course_id: Number(row.curriculum_course_id),

          course_code: row.course_code,

          course_name: row.course_name,
        },
      };
    }

    // =================================================
    // 4. CURRICULUM ISSUE
    // =================================================

    let curriculumIssue = null;

    if (!curriculum) {
      const [assignmentRows] = await db.execute(
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

            LIMIT 1
          `,
        [studentId],
      );

      if (assignmentRows.length === 0) {
        curriculumIssue = "NO_CURRICULUM";
      } else {
        const assignment = assignmentRows[0];

        if (Number(assignment.course_id) !== studentCourseId) {
          curriculumIssue = "COURSE_CURRICULUM_MISMATCH";
        } else if (assignment.status !== "Active") {
          curriculumIssue = "CURRICULUM_ASSIGNMENT_NOT_ACTIVE";
        } else if (Number(assignment.is_active) !== 1) {
          curriculumIssue = "CURRICULUM_NOT_ACTIVE";
        } else {
          curriculumIssue = "INVALID_CURRICULUM_ASSIGNMENT";
        }
      }
    }

    // =================================================
    // 5. CURRENT SUPPORTED ENROLLMENT PERIOD
    //
    // Summer is excluded.
    //
    // Supported:
    // 1 = First Semester
    // 2 = Second Semester
    // =================================================

    const [periodRows] = await db.execute(
      `
        SELECT
            ep.enrollment_period_id,

            ep.academic_year_id,
            ay.academic_year,

            ep.semester_id,
            sem.semester_name,

            ep.status,
            ep.opened_at,
            ep.remarks

        FROM enrollment_periods ep

        INNER JOIN academic_years ay
            ON ay.academic_year_id =
               ep.academic_year_id

        INNER JOIN semesters sem
            ON sem.semester_id =
               ep.semester_id

        WHERE ep.status = 'Open'

          AND ep.semester_id
              IN (1, 2)

        ORDER BY
            ep.enrollment_period_id DESC

        LIMIT 1
      `,
    );

    // =================================================
    // 6. STUDENT RESPONSE
    //
    // Profile section/term is retained only as profile
    // information.
    //
    // Enrollment placement below is authoritative.
    // =================================================

    const studentResponse = {
      student_id: studentId,

      student_number: student.student_number,

      first_name: student.first_name,

      middle_name: student.middle_name,

      last_name: student.last_name,

      student_name: [student.first_name, student.middle_name, student.last_name]
        .filter(Boolean)
        .join(" "),

      course: {
        course_id: studentCourseId,

        course_code: student.course_code,

        course_name: student.course_name,
      },

      year_level: yearLevel,

      profile_section: {
        section_id:
          student.profile_section_id !== null
            ? Number(student.profile_section_id)
            : null,

        section_name: student.profile_section_name || null,
      },

      profile_academic_period: {
        academic_year_id:
          student.profile_academic_year_id !== null
            ? Number(student.profile_academic_year_id)
            : null,

        academic_year: student.profile_academic_year || null,

        semester_id:
          student.profile_semester_id !== null
            ? Number(student.profile_semester_id)
            : null,

        semester_name: student.profile_semester_name || null,
      },
    };

    // =================================================
    // 7. NO OPEN PERIOD
    // =================================================

    if (periodRows.length === 0) {
      return res.status(200).json({
        success: true,

        message: "Enrollment is currently closed.",

        student: studentResponse,

        curriculum,

        curriculum_issue: curriculumIssue,

        enrollment_period: null,

        enrollment: null,

        subjects: [],

        summary: {
          total_subjects: 0,
          total_units: 0,
          placed_subjects: 0,
          unplaced_subjects: 0,
          placement_complete: false,
        },

        can_prepare: false,
      });
    }

    const period = periodRows[0];

    const academicYearId = Number(period.academic_year_id);

    const semesterId = Number(period.semester_id);

    const enrollmentPeriod = {
      enrollment_period_id: Number(period.enrollment_period_id),

      academic_year_id: academicYearId,

      academic_year: period.academic_year,

      semester_id: semesterId,

      semester_name: period.semester_name,

      status: period.status,

      opened_at: period.opened_at,

      remarks: period.remarks || null,
    };

    // =================================================
    // 8. GET STUDENT ENROLLMENT FOR PERIOD
    // =================================================

    const [enrollmentRows] = await db.execute(
      `
          SELECT
              e.enrollment_id,
              e.student_id,

              e.academic_year_id,
              ay.academic_year,

              e.semester_id,
              sem.semester_name,

              e.enrollment_status,
              e.remarks,

              e.approved_by,
              e.approved_at,

              e.created_at

          FROM enrollments e

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 e.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 e.semester_id

          WHERE e.student_id = ?

            AND e.academic_year_id = ?

            AND e.semester_id = ?

          ORDER BY
              e.created_at DESC,
              e.enrollment_id DESC

          LIMIT 1
        `,
      [studentId, academicYearId, semesterId],
    );

    // =================================================
    // 9. NO ENROLLMENT YET
    // =================================================

    if (enrollmentRows.length === 0) {
      return res.status(200).json({
        success: true,

        message: curriculum
          ? "No enrollment has been prepared for the current enrollment period."
          : "Student enrollment cannot be prepared until the curriculum assignment is corrected.",

        student: studentResponse,

        curriculum,

        curriculum_issue: curriculumIssue,

        enrollment_period: enrollmentPeriod,

        enrollment: null,

        subjects: [],

        summary: {
          total_subjects: 0,
          total_units: 0,
          placed_subjects: 0,
          unplaced_subjects: 0,
          placement_complete: false,
        },

        can_prepare: Boolean(curriculum),
      });
    }

    const enrollment = enrollmentRows[0];

    const enrollmentId = Number(enrollment.enrollment_id);

    const enrollmentStatus = String(enrollment.enrollment_status);

    // =================================================
    // 10. GET CURRENT / OFFICIAL ENROLLMENT SUBJECTS
    //
    // enrollment_subjects is authoritative.
    //
    // IMPORTANT:
    // - enrollment_type is persisted here.
    // - Student does not determine placement.
    // - students.section_id is profile/home section only.
    // - Room is optional.
    // =================================================

    const [subjectRows] = await db.execute(
      `
          SELECT
              -- =======================================
              -- ENROLLMENT SUBJECT
              -- =======================================

              es.enrollment_subject_id,
              es.enrollment_id,
              es.subject_id,

              es.enrollment_type,

              es.status
                  AS subject_status,

              -- =======================================
              -- SUBJECT
              -- =======================================

              sub.subject_code,
              sub.subject_name,
              sub.units,

              sub.lecture_hours,
              sub.laboratory_hours,

              -- =======================================
              -- AUTHORITATIVE PLACEMENT
              -- =======================================

              es.section_id,

              sec.section_name,

              sec.year_level
                  AS section_year_level,

              sec.course_id
                  AS section_course_id,

              placement_course.course_code
                  AS section_course_code,

              placement_course.course_name
                  AS section_course_name,

              -- =======================================
              -- SECTION SUBJECT
              -- =======================================

              es.section_subject_id,

              ss.status
                  AS section_subject_status,

              -- =======================================
              -- OFFERING
              -- =======================================

              es.offering_id,

              so.status
                  AS offering_status,

              so.schedule_days,
              so.schedule_time,

              so.max_students,

              -- =======================================
              -- FACULTY
              -- =======================================

              so.faculty_id,

              TRIM(
                CONCAT_WS(
                  ' ',
                  f.first_name,
                  NULLIF(
                    f.middle_name,
                    ''
                  ),
                  f.last_name
                )
              ) AS faculty_name,

              -- =======================================
              -- ROOM
              -- =======================================

              so.room_id,

              r.room_name

          FROM enrollment_subjects es

          INNER JOIN subjects sub
              ON sub.subject_id =
                 es.subject_id

          LEFT JOIN sections sec
              ON sec.section_id =
                 es.section_id

          LEFT JOIN courses placement_course
              ON placement_course.course_id =
                 sec.course_id

          LEFT JOIN section_subjects ss
              ON ss.section_subject_id =
                 es.section_subject_id

          LEFT JOIN subject_offerings so
              ON so.offering_id =
                 es.offering_id

          LEFT JOIN faculty f
              ON f.faculty_id =
                 so.faculty_id

          LEFT JOIN rooms r
              ON r.room_id =
                 so.room_id

          WHERE es.enrollment_id = ?

            AND es.status
                NOT IN (
                  'Dropped',
                  'Withdrawn'
                )

          ORDER BY
              sub.subject_code ASC
        `,
      [enrollmentId],
    );

    // =================================================
    // 11. CURRENT ENROLLED COUNT PER OFFERING
    //
    // Approved enrollment_subjects are official class
    // membership.
    // =================================================

    const offeringIds = [
      ...new Set(
        subjectRows
          .map((row) =>
            row.offering_id !== null ? Number(row.offering_id) : null,
          )
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    ];

    const offeringEnrollmentCountMap = new Map();

    if (offeringIds.length > 0) {
      const placeholders = offeringIds.map(() => "?").join(", ");

      const [countRows] = await db.execute(
        `
            SELECT
                es.offering_id,

                COUNT(*) AS
                    enrolled_count

            FROM enrollment_subjects es

            INNER JOIN enrollments e
                ON e.enrollment_id =
                   es.enrollment_id

            WHERE es.offering_id
                  IN (${placeholders})

              AND es.status =
                  'Enrolled'

              AND e.enrollment_status =
                  'Approved'

            GROUP BY
                es.offering_id
          `,
        offeringIds,
      );

      for (const row of countRows) {
        offeringEnrollmentCountMap.set(
          Number(row.offering_id),
          Number(row.enrolled_count || 0),
        );
      }
    }

    // =================================================
    // 12. NORMALIZE SUBJECT RESPONSE
    //
    // FIX:
    //
    // Use row.enrollment_type.
    //
    // Do NOT use:
    //
    // subject.enrollment_type
    //
    // because there is no "subject" variable in this
    // map callback.
    // =================================================

    const subjects = subjectRows.map((row) => {
      const offeringId =
        row.offering_id !== null ? Number(row.offering_id) : null;

      const maxStudents =
        row.max_students !== null ? Number(row.max_students) : null;

      const enrolledCount =
        offeringId !== null
          ? Number(offeringEnrollmentCountMap.get(offeringId) || 0)
          : 0;

      const availableSlots =
        maxStudents !== null ? Math.max(maxStudents - enrolledCount, 0) : null;

      const enrollmentType = ["Regular", "Retake", "Carry Over"].includes(
        String(row.enrollment_type || "").trim(),
      )
        ? String(row.enrollment_type).trim()
        : "Regular";

      const isIrregular =
        enrollmentType === "Retake" || enrollmentType === "Carry Over";

      return {
        enrollment_subject_id: Number(row.enrollment_subject_id),

        enrollment_id: Number(row.enrollment_id),

        subject_id: Number(row.subject_id),

        subject_code: row.subject_code,

        subject_name: row.subject_name,

        units: Number(row.units || 0),

        lecture_hours:
          row.lecture_hours !== null ? Number(row.lecture_hours) : null,

        laboratory_hours:
          row.laboratory_hours !== null ? Number(row.laboratory_hours) : null,

        status: row.subject_status,

        // =========================================
        // PERSISTED ENROLLMENT TYPE
        // =========================================

        enrollment_type: enrollmentType,

        is_irregular: isIrregular,

        irregular_reason:
          enrollmentType === "Retake"
            ? "RETAKE"
            : enrollmentType === "Carry Over"
              ? "CARRY_OVER"
              : null,

        // =========================================
        // ACTUAL ENROLLMENT PLACEMENT
        // =========================================

        section: {
          section_id: row.section_id !== null ? Number(row.section_id) : null,

          section_name: row.section_name || null,

          year_level:
            row.section_year_level !== null
              ? Number(row.section_year_level)
              : null,

          course_id:
            row.section_course_id !== null
              ? Number(row.section_course_id)
              : null,

          course_code: row.section_course_code || null,

          course_name: row.section_course_name || null,
        },

        section_subject: {
          section_subject_id:
            row.section_subject_id !== null
              ? Number(row.section_subject_id)
              : null,

          status: row.section_subject_status || null,
        },

        offering: {
          offering_id: offeringId,

          status: row.offering_status || null,

          schedule_days: row.schedule_days || null,

          schedule_time: row.schedule_time || null,

          max_students: maxStudents,

          enrolled_count: enrolledCount,

          available_slots: availableSlots,
        },

        faculty: {
          faculty_id: row.faculty_id !== null ? Number(row.faculty_id) : null,

          faculty_name: row.faculty_name || null,
        },

        room: {
          room_id: row.room_id !== null ? Number(row.room_id) : null,

          room_name: row.room_name || null,
        },

        assignment_complete:
          row.section_id !== null &&
          row.section_subject_id !== null &&
          row.offering_id !== null,
      };
    });

    // =================================================
    // 13. SUMMARY
    // =================================================

    const totalUnits = subjects.reduce(
      (total, subject) => total + Number(subject.units || 0),
      0,
    );

    const placedSubjects = subjects.filter(
      (subject) => subject.assignment_complete,
    ).length;

    const unplacedSubjects = subjects.length - placedSubjects;

    const regularSubjects = subjects.filter(
      (subject) => subject.enrollment_type === "Regular",
    ).length;

    const retakeSubjects = subjects.filter(
      (subject) => subject.enrollment_type === "Retake",
    ).length;

    const carryOverSubjects = subjects.filter(
      (subject) => subject.enrollment_type === "Carry Over",
    ).length;

    const irregularSubjects = subjects.filter(
      (subject) => subject.is_irregular,
    ).length;

    const placementComplete = subjects.length > 0 && unplacedSubjects === 0;

    // =================================================
    // 14. RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      message:
        enrollmentStatus === "Approved"
          ? "Official enrollment loaded successfully."
          : "Current enrollment loaded successfully.",

      student: studentResponse,

      curriculum,

      curriculum_issue: curriculumIssue,

      enrollment_period: enrollmentPeriod,

      enrollment: {
        enrollment_id: enrollmentId,

        student_id: Number(enrollment.student_id),

        academic_year_id: Number(enrollment.academic_year_id),

        academic_year: enrollment.academic_year,

        semester_id: Number(enrollment.semester_id),

        semester_name: enrollment.semester_name,

        enrollment_status: enrollmentStatus,

        remarks: enrollment.remarks || null,

        approved_by:
          enrollment.approved_by !== null
            ? Number(enrollment.approved_by)
            : null,

        approved_at: enrollment.approved_at,

        created_at: enrollment.created_at,
      },

      subjects,

      summary: {
        total_subjects: subjects.length,

        total_units: totalUnits,

        placed_subjects: placedSubjects,

        unplaced_subjects: unplacedSubjects,

        placement_complete: placementComplete,

        regular_subjects: regularSubjects,

        retake_subjects: retakeSubjects,

        carry_over_subjects: carryOverSubjects,

        irregular_subjects: irregularSubjects,

        is_irregular_enrollment: irregularSubjects > 0,
      },

      can_prepare:
        Boolean(curriculum) &&
        !["Draft", "Pending", "Approved"].includes(enrollmentStatus),
    });
  } catch (error) {
    console.error("GET CURRENT STUDENT ENROLLMENT ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to load current Student enrollment.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// =====================================================
// GET STUDENT ENROLLMENT ELIGIBLE SUBJECTS
//
// GET /api/student/enrollments/subjects
//
// AUTH:
// Student JWT required.
//
// PURPOSE:
//
// - Identify Student from req.user
// - Load active assigned curriculum
// - Load current Open enrollment period
// - Evaluate current curriculum subjects
// - Use ONLY Approved Grade V2 academic history
// - Remove already-passed subjects
// - Detect valid retakes
// - Validate prerequisites
// - Show current Draft membership
//
// IMPORTANT:
//
// Student DOES NOT choose:
// - section
// - offering
// - faculty
// - room
// - schedule
//
// Registrar handles placement later.
// =====================================================

router.get("/subjects", async (req, res) => {
  try {
    // =================================================
    // 1. AUTHENTICATION
    // =================================================

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
    }

    if (req.user.role_name !== "Student") {
      return res.status(403).json({
        success: false,
        message: "Student access is required.",
      });
    }

    const userId = Number(req.user.user_id);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({
        success: false,
        message: "Authenticated Student user ID is invalid.",
      });
    }

    // =================================================
    // 2. GET AUTHENTICATED STUDENT
    //
    // Student identity comes ONLY from req.user.
    // =================================================

    const [studentRows] = await db.execute(
      `
        SELECT
            s.student_id,
            s.user_id,
            s.student_number,

            s.first_name,
            s.middle_name,
            s.last_name,

            s.course_id,
            c.course_code,
            c.course_name,

           s.year_level,

s.academic_year_id
    AS profile_academic_year_id,

s.semester_id
    AS profile_semester_id

FROM students s
        INNER JOIN courses c
            ON c.course_id = s.course_id

        WHERE s.user_id = ?

        LIMIT 1
      `,
      [userId],
    );

    if (studentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No Student profile is connected to this account.",
      });
    }

    const student = studentRows[0];

    const studentId = Number(student.student_id);
    const studentCourseId = Number(student.course_id);
    const yearLevel = Number(student.year_level);
    const profileAcademicYearId =
      student.profile_academic_year_id !== null
        ? Number(student.profile_academic_year_id)
        : null;

    const profileSemesterId =
      student.profile_semester_id !== null
        ? Number(student.profile_semester_id)
        : null;
    // =================================================
    // 3. ACTIVE ASSIGNED CURRICULUM
    //
    // Must:
    // - belong to Student
    // - have Active assignment
    // - curriculum itself must be active
    // - curriculum must belong to Student's Course
    // =================================================

    const [curriculumRows] = await db.execute(
      `
        SELECT
            sc.student_curriculum_id,
            sc.curriculum_id,
            sc.assigned_date,
            sc.status AS assignment_status,
            sc.remarks,

            cur.curriculum_name,
            cur.effective_year,
            cur.total_units,
            cur.is_active,
            cur.course_id

        FROM student_curriculum sc

        INNER JOIN curriculum cur
            ON cur.curriculum_id = sc.curriculum_id

        WHERE sc.student_id = ?
          AND sc.status = 'Active'
          AND cur.is_active = 1
          AND cur.course_id = ?

        ORDER BY
            sc.assigned_date DESC,
            sc.student_curriculum_id DESC

        LIMIT 1
      `,
      [studentId, studentCourseId],
    );

    if (curriculumRows.length === 0) {
      return res.status(409).json({
        success: false,

        code: "VALID_ACTIVE_CURRICULUM_REQUIRED",

        message:
          "Student enrollment cannot continue because there is no valid active curriculum assigned to this Student.",
      });
    }

    const curriculum = curriculumRows[0];

    const curriculumId = Number(curriculum.curriculum_id);

    // =================================================
    // 4. CURRENT OPEN ENROLLMENT PERIOD
    // =================================================

    const [periodRows] = await db.execute(
      `
        SELECT
            ep.enrollment_period_id,

            ep.academic_year_id,
            ay.academic_year,

            ep.semester_id,
            sem.semester_name,

            ep.status,
            ep.opened_at,
            ep.remarks

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

    // =================================================
    // 5. ENROLLMENT CLOSED
    //
    // This is NOT an authentication error.
    // Student can still open the enrollment page.
    // =================================================

    if (periodRows.length === 0) {
      return res.status(200).json({
        success: true,

        message: "Enrollment is currently closed.",

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

          course: {
            course_id: studentCourseId,
            course_code: student.course_code,
            course_name: student.course_name,
          },

          year_level: yearLevel,
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

          status: curriculum.assignment_status,
        },

        enrollment_period: null,
        enrollment: null,
        regular_subjects: [],
        carry_over_subjects: [],
        retake_candidates: [],
        blocked_subjects: [],
        completed_subjects: [],

        summary: {
          regular_subjects: 0,
          carry_over_subjects: 0,
          retake_candidates: 0,
          blocked_subjects: 0,
          completed_subjects: 0,
          eligible_units: 0,
        },

        can_prepare: false,
        can_modify_draft: false,
        can_submit: false,
      });
    }

    const period = periodRows[0];

    const academicYearId = Number(period.academic_year_id);
    const semesterId = Number(period.semester_id);

    const progression = await resolveStudentProgression({
      executor: db,

      studentId,

      currentYearLevel: yearLevel,

      profileAcademicYearId,

      profileSemesterId,

      currentAcademicYearId: academicYearId,

      currentSemesterId: semesterId,
    });

    const effectiveYearLevel = Number(progression.effective_year_level);
    // =================================================
    // 6. CURRENT ENROLLMENT
    // =================================================

    const [enrollmentRows] = await db.execute(
      `
        SELECT
            e.enrollment_id,
            e.student_id,

            e.academic_year_id,
            e.semester_id,

            e.enrollment_status,
            e.remarks,

            e.approved_by,
            e.approved_at,

            e.created_at

        FROM enrollments e

        WHERE e.student_id = ?
          AND e.academic_year_id = ?
          AND e.semester_id = ?

        ORDER BY
            e.created_at DESC,
            e.enrollment_id DESC

        LIMIT 1
      `,
      [studentId, academicYearId, semesterId],
    );

    const currentEnrollment =
      enrollmentRows.length > 0 ? enrollmentRows[0] : null;

    // =================================================
    // 7. OFFICIAL APPROVED ACADEMIC HISTORY
    //
    // Grade Model V2:
    //
    // grades
    //   ↓ enrollment_subject_id
    // enrollment_subjects
    //   ↓ enrollment_id
    // enrollments
    //
    // ONLY:
    //
    // grade_status = Approved
    // enrollment_status = Approved
    //
    // final_rating is authoritative.
    // =================================================

    const approvedHistory = await getApprovedAcademicHistory(studentId, db);

    // Build latest Approved academic result per subject.
    //
    // getApprovedAcademicHistory() is already newest-first.
    const latestHistoryMap = new Map();

    for (const record of approvedHistory) {
      const subjectId = Number(record.subject_id);

      if (!latestHistoryMap.has(subjectId)) {
        latestHistoryMap.set(subjectId, record);
      }
    }

    if (!progression.can_enroll) {
      return res.status(200).json({
        success: true,

        message: progression.reason,

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

          course: {
            course_id: studentCourseId,

            course_code: student.course_code,

            course_name: student.course_name,
          },

          year_level: yearLevel,

          effective_year_level: effectiveYearLevel,
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

          status: curriculum.assignment_status,
        },

        enrollment_period: {
          enrollment_period_id: Number(period.enrollment_period_id),

          academic_year_id: academicYearId,

          academic_year: period.academic_year,

          semester_id: semesterId,

          semester_name: period.semester_name,

          status: period.status,

          opened_at: period.opened_at,

          remarks: period.remarks || null,
        },

        enrollment: currentEnrollment
          ? {
              enrollment_id: Number(currentEnrollment.enrollment_id),

              enrollment_status: String(currentEnrollment.enrollment_status),
            }
          : null,

        progression,

        regular_subjects: [],
        carry_over_subjects: [],
        retake_candidates: [],
        blocked_subjects: [],
        completed_subjects: [],

        summary: {
          regular_subjects: 0,
          carry_over_subjects: 0,
          retake_candidates: 0,
          blocked_subjects: 0,
          completed_subjects: 0,
          eligible_units: 0,
        },
        can_prepare: false,

        can_modify_draft: false,

        can_submit: false,
      });
    }
    // =================================================
    // 8. EVALUATE CURRENT CURRICULUM TERM
    //
    // Shared service is now the authoritative source
    // for:
    //
    // - Regular
    // - Retake
    // - Already Passed
    // - Blocked Prerequisite
    // - Unresolved academic result
    // =================================================

    const termEvaluation = await evaluateCurriculumTerm(
      {
        studentId,

        curriculumId,

        yearLevel: effectiveYearLevel,

        semesterId,
      },
      db,
    );

    // =================================================
    // 9. ALL SUBJECTS IN ASSIGNED CURRICULUM
    //
    // Needed to preserve existing response metadata
    // for retakes from earlier semesters.
    // =================================================

    const [allCurriculumRows] = await db.execute(
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
              s.laboratory_hours

          FROM curriculum_subjects cs

          INNER JOIN subjects s
              ON s.subject_id =
                 cs.subject_id

          WHERE cs.curriculum_id = ?

          ORDER BY
              cs.year_level ASC,
              cs.semester_id ASC,
              cs.display_order ASC,
              s.subject_code ASC
        `,
      [curriculumId],
    );

    const curriculumSubjectMap = new Map();

    for (const row of allCurriculumRows) {
      curriculumSubjectMap.set(Number(row.subject_id), row);
    }

    // =================================================
    // 10. HELPER — FORMAT PREREQUISITES
    //
    // Preserve the frontend's existing prerequisite
    // response shape.
    // =================================================

    function formatPrerequisites(prerequisiteCheck) {
      if (
        !prerequisiteCheck ||
        !Array.isArray(prerequisiteCheck.prerequisites)
      ) {
        return [];
      }

      return prerequisiteCheck.prerequisites.map((prerequisite) => {
        const prerequisiteSubjectId = Number(
          prerequisite.prerequisite_subject_id,
        );

        const academicRecord = latestHistoryMap.get(prerequisiteSubjectId);

        return {
          prerequisite_id: Number(prerequisite.prerequisite_id),

          subject_id: prerequisiteSubjectId,

          subject_code: prerequisite.prerequisite_subject_code,

          subject_name: prerequisite.prerequisite_subject_name,

          passed: Boolean(prerequisite.is_satisfied),

          // Keep old API property name for frontend
          // compatibility.
          //
          // Value now correctly comes from final_rating.
          final_grade: academicRecord?.final_rating ?? null,

          academic_status: academicRecord?.result
            ? String(academicRecord.result).toUpperCase()
            : "NOT_TAKEN",
        };
      });
    }

    // =================================================
    // CARRY-OVER / BACKLOG SUBJECTS
    //
    // Carry Over:
    // - required subject from an earlier curriculum term
    // - never successfully completed
    // - not a 4.00 / 5.00 Retake
    // - prerequisites are currently satisfied
    //
    // This endpoint only DISPLAYS the subjects.
    // /prepare will be wired separately later.
    // =================================================

    const carryOverEvaluation = await getCarryOverCandidates(
      studentId,
      curriculumId,
      effectiveYearLevel,
      semesterId,
      db,
    );

    const carryOverSubjects = carryOverEvaluation.eligible.map((subject) => ({
      subject_id: Number(subject.subject_id),

      subject_code: subject.subject_code,

      subject_name: subject.subject_name,

      units: Number(subject.units || 0),

      lecture_hours: Number(subject.lecture_hours || 0),

      laboratory_hours: Number(subject.laboratory_hours || 0),

      original_year_level: Number(subject.original_year_level),

      original_semester_id: Number(subject.original_semester_id),

      curriculum_subject_id: Number(subject.curriculum_subject_id),

      enrollment_type: "Carry Over",

      academic_status: "NOT_TAKEN",

      eligible: true,

      carry_over_reason: subject.carry_over_reason,

      prerequisites: formatPrerequisites(subject.prerequisites),
    }));
    // =================================================
    // 11. COMPLETED / PASSED SUBJECTS
    // =================================================

    const completedSubjectMap = new Map();

    for (const record of approvedHistory) {
      if (record.result !== "Passed") {
        continue;
      }

      const subjectId = Number(record.subject_id);

      if (completedSubjectMap.has(subjectId)) {
        continue;
      }

      completedSubjectMap.set(subjectId, {
        subject_id: subjectId,

        subject_code: record.subject_code,

        subject_name: record.subject_name,

        units: Number(record.units || 0),

        // Existing frontend property name preserved.
        final_grade: record.final_rating,

        academic_status: "PASSED",
      });
    }

    const completedSubjects = Array.from(completedSubjectMap.values());

    // =================================================
    // 12. REGULAR ELIGIBLE SUBJECTS
    // =================================================

    const regularSubjects = termEvaluation.regular.map((subject) => ({
      subject_id: Number(subject.subject_id),

      subject_code: subject.subject_code,

      subject_name: subject.subject_name,

      units: Number(subject.units || 0),

      lecture_hours: Number(subject.lecture_hours || 0),

      laboratory_hours: Number(subject.laboratory_hours || 0),

      year_level: Number(subject.year_level),

      semester_id: Number(subject.semester_id),

      is_required: Boolean(subject.is_required),

      display_order: Number(subject.display_order),

      curriculum_subject_id: Number(subject.curriculum_subject_id),

      enrollment_type: "Regular",

      academic_status: "NOT_TAKEN",

      eligible: true,

      prerequisites: formatPrerequisites(subject.prerequisites),
    }));

    // =================================================
    // 13. BLOCKED SUBJECTS
    //
    // Already-passed subjects are NOT blocked.
    // They belong in completed_subjects.
    // =================================================

    const blockedSubjects = [];

    for (const subject of termEvaluation.blocked) {
      if (subject.eligibility_type === ELIGIBILITY_TYPE.ALREADY_PASSED) {
        continue;
      }

      const prerequisites = formatPrerequisites(subject.prerequisites);

      const missingPrerequisites = prerequisites.filter((item) => !item.passed);

      let reason = "ACADEMIC_RESULT_UNRESOLVED";

      if (subject.eligibility_type === ELIGIBILITY_TYPE.BLOCKED_PREREQUISITE) {
        reason = "PREREQUISITE_NOT_PASSED";
      }

      blockedSubjects.push({
        subject_id: Number(subject.subject_id),

        subject_code: subject.subject_code,

        subject_name: subject.subject_name,

        units: Number(subject.units || 0),

        year_level: Number(subject.year_level),

        semester_id: Number(subject.semester_id),

        curriculum_subject_id: Number(subject.curriculum_subject_id),

        reason,

        prerequisites,

        missing_prerequisites: missingPrerequisites,
      });
    }
    // =================================================
    // BLOCKED CARRY-OVER SUBJECTS
    //
    // These remain visible so the Student can understand
    // which earlier requirements are still unresolved.
    // =================================================

    for (const subject of carryOverEvaluation.blocked) {
      const prerequisites = formatPrerequisites(subject.prerequisites);

      const missingPrerequisites = prerequisites.filter((item) => !item.passed);

      blockedSubjects.push({
        subject_id: Number(subject.subject_id),

        subject_code: subject.subject_code,

        subject_name: subject.subject_name,

        units: Number(subject.units || 0),

        year_level: Number(subject.original_year_level),

        semester_id: Number(subject.original_semester_id),

        original_year_level: Number(subject.original_year_level),

        original_semester_id: Number(subject.original_semester_id),

        curriculum_subject_id: Number(subject.curriculum_subject_id),

        reason: subject.carry_over_reason || "CARRY_OVER_BLOCKED",

        source: "Carry Over",

        prerequisites,

        missing_prerequisites: missingPrerequisites,
      });
    }
    // =================================================
    // 14. VALID RETAKE CANDIDATES
    //
    // Can come from an older year/semester.
    //
    // Shared service guarantees:
    //
    // - subject belongs to assigned curriculum
    // - latest Approved result is 4.00 or 5.00
    // - subject has not later been passed
    // - prerequisites are satisfied
    // =================================================

    const retakeRows = await getRetakeCandidates(studentId, curriculumId, db);

    const retakeCandidates = retakeRows.map((retake) => {
      const curriculumSubject = curriculumSubjectMap.get(
        Number(retake.subject_id),
      );

      return {
        subject_id: Number(retake.subject_id),

        subject_code: retake.subject_code,

        subject_name: retake.subject_name,

        units: Number(retake.units || 0),

        lecture_hours: curriculumSubject
          ? Number(curriculumSubject.lecture_hours || 0)
          : 0,

        laboratory_hours: curriculumSubject
          ? Number(curriculumSubject.laboratory_hours || 0)
          : 0,

        // Keep old frontend property name.
        // This value now comes from final_rating.
        previous_final_grade: retake.previous_final_rating,

        previous_status: String(retake.previous_result).toUpperCase(),

        previous_grade_id: retake.previous_grade_id,

        curriculum_subject_id: curriculumSubject
          ? Number(curriculumSubject.curriculum_subject_id)
          : null,

        original_year_level: curriculumSubject
          ? Number(curriculumSubject.year_level)
          : null,

        original_semester_id: curriculumSubject
          ? Number(curriculumSubject.semester_id)
          : null,

        enrollment_type: "Retake",

        eligible_for_retake: true,

        prerequisites: formatPrerequisites(retake.prerequisites),
      };
    });

    // =================================================
    // 15. CURRENT DRAFT SUBJECT MEMBERSHIP
    //
    // Student does NOT choose placement.
    //
    // We only identify whether subjects are already
    // present in an existing Draft.
    // =================================================

    const draftSubjectMap = new Map();

    if (
      currentEnrollment &&
      String(currentEnrollment.enrollment_status) === "Draft"
    ) {
      const [draftRows] = await db.execute(
        `
          SELECT
    enrollment_subject_id,
    subject_id,
    enrollment_type,
    status
FROM enrollment_subjects  

            WHERE enrollment_id = ?

              AND status NOT IN (
                  'Dropped',
                  'Withdrawn'
              )

            ORDER BY
                enrollment_subject_id ASC
          `,
        [Number(currentEnrollment.enrollment_id)],
      );

      for (const row of draftRows) {
        draftSubjectMap.set(Number(row.subject_id), {
          enrollment_subject_id: Number(row.enrollment_subject_id),

          enrollment_type: row.enrollment_type,

          status: row.status,
        });
      }
    }

    // =================================================
    // 16. MARK CURRENT DRAFT MEMBERSHIP
    // =================================================

    const finalRegularSubjects = regularSubjects.map((subject) => {
      const draft = draftSubjectMap.get(subject.subject_id);

      const matchingDraft = draft?.enrollment_type === "Regular" ? draft : null;

      return {
        ...subject,

        selected_in_draft: Boolean(matchingDraft),

        enrollment_subject_id: matchingDraft?.enrollment_subject_id ?? null,

        enrollment_subject_status: matchingDraft?.status ?? null,

        persisted_enrollment_type: matchingDraft?.enrollment_type ?? null,
      };
    });
    const finalRetakeCandidates = retakeCandidates.map((subject) => {
      const draft = draftSubjectMap.get(subject.subject_id);

      const matchingDraft = draft?.enrollment_type === "Retake" ? draft : null;

      return {
        ...subject,

        selected_in_draft: Boolean(matchingDraft),

        enrollment_subject_id: matchingDraft?.enrollment_subject_id ?? null,

        enrollment_subject_status: matchingDraft?.status ?? null,

        persisted_enrollment_type: matchingDraft?.enrollment_type ?? null,
      };
    });
    const finalCarryOverSubjects = carryOverSubjects.map((subject) => {
      const draft = draftSubjectMap.get(subject.subject_id);

      const matchingDraft =
        draft?.enrollment_type === "Carry Over" ? draft : null;

      return {
        ...subject,

        selected_in_draft: Boolean(matchingDraft),

        enrollment_subject_id: matchingDraft?.enrollment_subject_id ?? null,

        enrollment_subject_status: matchingDraft?.status ?? null,

        persisted_enrollment_type: matchingDraft?.enrollment_type ?? null,
      };
    });
    // =================================================
    // 17. SORT
    // =================================================

    finalRegularSubjects.sort(
      (a, b) =>
        Number(a.display_order || 999999) - Number(b.display_order || 999999),
    );

    finalRetakeCandidates.sort((a, b) =>
      String(a.subject_code).localeCompare(String(b.subject_code)),
    );
    finalCarryOverSubjects.sort((a, b) => {
      const yearDifference =
        Number(a.original_year_level) - Number(b.original_year_level);

      if (yearDifference !== 0) {
        return yearDifference;
      }

      const semesterDifference =
        Number(a.original_semester_id) - Number(b.original_semester_id);

      if (semesterDifference !== 0) {
        return semesterDifference;
      }

      return String(a.subject_code).localeCompare(String(b.subject_code));
    });
    // =================================================
    // 18. SUMMARY
    // =================================================

    const eligibleUnits = finalRegularSubjects.reduce(
      (total, subject) => total + Number(subject.units || 0),
      0,
    );

    const currentStatus = currentEnrollment
      ? String(currentEnrollment.enrollment_status)
      : null;

    const activeEnrollmentExists = ["Draft", "Pending", "Approved"].includes(
      currentStatus,
    );

    // =================================================
    // 19. RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

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

        course: {
          course_id: studentCourseId,

          course_code: student.course_code,

          course_name: student.course_name,
        },

        year_level: yearLevel,

        effective_year_level: effectiveYearLevel,
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

        status: curriculum.assignment_status,
      },

      enrollment_period: {
        enrollment_period_id: Number(period.enrollment_period_id),

        academic_year_id: academicYearId,

        academic_year: period.academic_year,

        semester_id: semesterId,

        semester_name: period.semester_name,

        status: period.status,

        opened_at: period.opened_at,

        remarks: period.remarks || null,
      },

      enrollment: currentEnrollment
        ? {
            enrollment_id: Number(currentEnrollment.enrollment_id),

            student_id: Number(currentEnrollment.student_id),

            enrollment_status: currentStatus,

            remarks: currentEnrollment.remarks || null,

            created_at: currentEnrollment.created_at,
          }
        : null,
      progression,

      regular_subjects: finalRegularSubjects,

      carry_over_subjects: finalCarryOverSubjects,

      retake_candidates: finalRetakeCandidates,

      blocked_subjects: blockedSubjects,

      completed_subjects: completedSubjects,

      summary: {
        regular_subjects: finalRegularSubjects.length,

        carry_over_subjects: finalCarryOverSubjects.length,

        retake_candidates: finalRetakeCandidates.length,

        blocked_subjects: blockedSubjects.length,

        completed_subjects: completedSubjects.length,

        eligible_units: eligibleUnits,
      },

      can_prepare: !activeEnrollmentExists,

      can_modify_draft: currentStatus === "Draft",

      can_submit: currentStatus === "Draft",
    });
  } catch (error) {
    console.error("GET STUDENT ELIGIBLE SUBJECTS ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to load Student enrollment eligibility.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});
// =====================================================
// PREPARE / UPDATE STUDENT DRAFT ENROLLMENT
//
// POST /api/student/enrollments/prepare
//
// BODY:
// {
//   "selected_retake_subject_ids": [subject_id, ...]
// }
//
// RULES:
//
// NO ENROLLMENT
//   -> Create Draft
//
// DRAFT
//   -> Synchronize existing Draft
//
// PENDING / APPROVED
//   -> Locked
//
// Regular
//   -> Automatically included
//
// Carry Over
//   -> Automatically included
//
// Retake
//   -> Student selects from backend-approved candidates
//
// Student NEVER selects:
// - section
// - offering
// - faculty
// - room
// - schedule
//
// Draft placement always remains NULL.
// =====================================================

router.post("/prepare", async (req, res) => {
  let connection;
  let transactionActive = false;

  try {
    // =================================================
    // 1. AUTHENTICATION
    // =================================================

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
    }

    if (req.user.role_name !== "Student") {
      return res.status(403).json({
        success: false,
        message: "Student access is required.",
      });
    }

    const userId = Number(req.user.user_id);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({
        success: false,
        message: "Authenticated Student user ID is invalid.",
      });
    }

    // =================================================
    // 2. SELECTED RETAKES
    // =================================================

    const rawRetakeIds = req.body?.selected_retake_subject_ids ?? [];

    if (!Array.isArray(rawRetakeIds)) {
      return res.status(400).json({
        success: false,
        message: "selected_retake_subject_ids must be an array.",
      });
    }

    const selectedRetakeIds = [
      ...new Set(rawRetakeIds.map((value) => Number(value))),
    ];

    for (const subjectId of selectedRetakeIds) {
      if (!Number.isInteger(subjectId) || subjectId <= 0) {
        return res.status(400).json({
          success: false,
          message:
            "Every selected retake subject ID must be a positive integer.",
        });
      }
    }

    // =================================================
    // 3. TRANSACTION
    // =================================================

    connection = await db.getConnection();

    await connection.beginTransaction();

    transactionActive = true;

    // =================================================
    // 4. AUTHENTICATED STUDENT
    // =================================================

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

              c.course_code,
              c.course_name,

              s.year_level,

              s.academic_year_id
                  AS profile_academic_year_id,

              s.semester_id
                  AS profile_semester_id

          FROM students s

          INNER JOIN courses c
              ON c.course_id =
                 s.course_id

          WHERE s.user_id = ?

          LIMIT 1

          FOR UPDATE
        `,
      [userId],
    );

    if (studentRows.length === 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(404).json({
        success: false,
        message: "No Student profile is connected to this account.",
      });
    }

    const student = studentRows[0];

    const studentId = Number(student.student_id);

    const courseId = Number(student.course_id);

    const yearLevel = Number(student.year_level);

    const profileAcademicYearId =
      student.profile_academic_year_id !== null
        ? Number(student.profile_academic_year_id)
        : null;

    const profileSemesterId =
      student.profile_semester_id !== null
        ? Number(student.profile_semester_id)
        : null;

    // =================================================
    // 5. ACTIVE CURRICULUM
    // =================================================

    const [curriculumRows] = await connection.execute(
      `
          SELECT
              sc.student_curriculum_id,
              sc.curriculum_id,
              sc.assigned_date,

              sc.status
                  AS assignment_status,

              cur.curriculum_name,
              cur.effective_year,
              cur.total_units,
              cur.course_id

          FROM student_curriculum sc

          INNER JOIN curriculum cur
              ON cur.curriculum_id =
                 sc.curriculum_id

          WHERE sc.student_id = ?

            AND sc.status = 'Active'

            AND cur.is_active = 1

            AND cur.course_id = ?

          ORDER BY
              sc.assigned_date DESC,
              sc.student_curriculum_id DESC

          LIMIT 1

          FOR UPDATE
        `,
      [studentId, courseId],
    );

    if (curriculumRows.length === 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "VALID_ACTIVE_CURRICULUM_REQUIRED",

        message:
          "Student enrollment cannot be prepared because there is no valid active curriculum assigned to this Student.",
      });
    }

    const curriculum = curriculumRows[0];

    const curriculumId = Number(curriculum.curriculum_id);

    // =================================================
    // 6. OPEN ENROLLMENT PERIOD
    //
    // Summer excluded.
    // =================================================

    const [periodRows] = await connection.execute(
      `
          SELECT
              ep.enrollment_period_id,

              ep.academic_year_id,
              ay.academic_year,

              ep.semester_id,
              sem.semester_name,

              ep.status,
              ep.opened_at,
              ep.remarks

          FROM enrollment_periods ep

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 ep.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 ep.semester_id

          WHERE ep.status = 'Open'

            AND ep.semester_id
                IN (1, 2)

          ORDER BY
              ep.enrollment_period_id DESC

          LIMIT 1

          FOR UPDATE
        `,
    );

    if (periodRows.length === 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,
        message: "Enrollment is currently closed.",
      });
    }

    const period = periodRows[0];

    const academicYearId = Number(period.academic_year_id);

    const semesterId = Number(period.semester_id);

    // =================================================
    // 7. YEAR PROGRESSION
    // =================================================

    const progression = await resolveStudentProgression({
      executor: connection,

      studentId,

      currentYearLevel: yearLevel,

      profileAcademicYearId,

      profileSemesterId,

      currentAcademicYearId: academicYearId,

      currentSemesterId: semesterId,
    });

    if (!progression.can_enroll) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: progression.code,

        message: progression.reason,

        progression,
      });
    }

    const effectiveYearLevel = Number(progression.effective_year_level);

    // =================================================
    // 8. CURRENT ENROLLMENT
    //
    // Draft:
    //   editable
    //
    // Pending / Approved:
    //   locked
    //
    // Rejected / Cancelled:
    //   may create a new Draft
    // =================================================

    const [existingRows] = await connection.execute(
      `
          SELECT
              enrollment_id,
              enrollment_status,
              remarks,
              created_at

          FROM enrollments

          WHERE student_id = ?

            AND academic_year_id = ?

            AND semester_id = ?

          ORDER BY
              created_at DESC,
              enrollment_id DESC

          LIMIT 1

          FOR UPDATE
        `,
      [studentId, academicYearId, semesterId],
    );

    let existingDraft = null;

    if (existingRows.length > 0) {
      const existing = existingRows[0];

      const existingStatus = String(existing.enrollment_status);

      // ===============================================
      // LOCKED STATES
      // ===============================================

      if (["Pending", "Approved"].includes(existingStatus)) {
        await connection.rollback();

        transactionActive = false;

        return res.status(409).json({
          success: false,

          code: "ENROLLMENT_LOCKED",

          message: `A ${existingStatus} enrollment already exists for this enrollment period and can no longer be modified by the Student.`,

          enrollment: {
            enrollment_id: Number(existing.enrollment_id),

            enrollment_status: existingStatus,

            remarks: existing.remarks || null,

            created_at: existing.created_at,
          },
        });
      }

      // ===============================================
      // EDITABLE DRAFT
      // ===============================================

      if (existingStatus === "Draft") {
        existingDraft = existing;
      }
    }

    // =================================================
    // 9. CURRENT TERM ELIGIBILITY
    // =================================================

    const termEvaluation = await evaluateCurriculumTerm(
      {
        studentId,

        curriculumId,

        yearLevel: effectiveYearLevel,

        semesterId,
      },

      connection,
    );

    // =================================================
    // 10. CARRY OVER
    //
    // Automatically included.
    // =================================================

    const carryOverEvaluation = await getCarryOverCandidates(
      studentId,

      curriculumId,

      effectiveYearLevel,

      semesterId,

      connection,
    );

    // =================================================
    // 11. REGULAR SUBJECTS
    // =================================================

    const regularEligible = termEvaluation.regular.map((subject) => ({
      subject_id: Number(subject.subject_id),

      subject_code: subject.subject_code,

      subject_name: subject.subject_name,

      units: Number(subject.units || 0),

      curriculum_subject_id: Number(subject.curriculum_subject_id),

      enrollment_type: "Regular",
    }));

    // =================================================
    // 12. CARRY OVER SUBJECTS
    // =================================================

    const carryOverEligible = carryOverEvaluation.eligible.map((subject) => ({
      subject_id: Number(subject.subject_id),

      subject_code: subject.subject_code,

      subject_name: subject.subject_name,

      units: Number(subject.units || 0),

      curriculum_subject_id: Number(subject.curriculum_subject_id),

      original_year_level: Number(subject.year_level),

      original_semester_id: Number(subject.semester_id),

      enrollment_type: "Carry Over",

      carry_over_reason:
        subject.carry_over_reason || "EARLIER_REQUIRED_SUBJECT_NOT_TAKEN",
    }));

    // =================================================
    // 13. LOAD ALL CURRICULUM SUBJECTS
    //
    // Retakes may come from older terms.
    // =================================================

    const [curriculumSubjectRows] = await connection.execute(
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
              s.units

          FROM curriculum_subjects cs

          INNER JOIN subjects s
              ON s.subject_id =
                 cs.subject_id

          WHERE cs.curriculum_id = ?

          ORDER BY
              cs.year_level ASC,
              cs.semester_id ASC,
              cs.display_order ASC,
              s.subject_code ASC
        `,
      [curriculumId],
    );

    const curriculumSubjectMap = new Map();

    for (const subject of curriculumSubjectRows) {
      curriculumSubjectMap.set(Number(subject.subject_id), subject);
    }

    // =================================================
    // 14. VALID RETAKE CANDIDATES
    // =================================================

    const validRetakeRows = await getRetakeCandidates(
      studentId,

      curriculumId,

      connection,
    );

    const validRetakeMap = new Map();

    for (const retake of validRetakeRows) {
      const subjectId = Number(retake.subject_id);

      const curriculumSubject = curriculumSubjectMap.get(subjectId);

      if (!curriculumSubject) {
        continue;
      }

      validRetakeMap.set(subjectId, {
        subject_id: subjectId,

        subject_code: retake.subject_code,

        subject_name: retake.subject_name,

        units: Number(retake.units || 0),

        curriculum_subject_id: Number(curriculumSubject.curriculum_subject_id),

        original_year_level: Number(curriculumSubject.year_level),

        original_semester_id: Number(curriculumSubject.semester_id),

        previous_final_grade: retake.previous_final_rating,

        previous_status: retake.previous_result
          ? String(retake.previous_result).toUpperCase()
          : null,

        previous_grade_id: retake.previous_grade_id,

        enrollment_type: "Retake",
      });
    }

    // =================================================
    // 15. VALIDATE SELECTED RETAKES
    // =================================================

    const invalidRetakeIds = selectedRetakeIds.filter(
      (subjectId) => !validRetakeMap.has(subjectId),
    );

    if (invalidRetakeIds.length > 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(400).json({
        success: false,

        message:
          "One or more selected subjects are not valid retake candidates.",

        invalid_retake_subject_ids: invalidRetakeIds,

        valid_retake_subject_ids: Array.from(validRetakeMap.keys()),
      });
    }

    const selectedRetakes = selectedRetakeIds.map((subjectId) =>
      validRetakeMap.get(subjectId),
    );

    // =================================================
    // 16. FINAL DESIRED DRAFT
    //
    // REGULAR
    // + CARRY OVER
    // + SELECTED RETAKES
    // =================================================

    const draftSubjectMap = new Map();

    for (const subject of regularEligible) {
      draftSubjectMap.set(subject.subject_id, subject);
    }

    for (const subject of carryOverEligible) {
      draftSubjectMap.set(subject.subject_id, subject);
    }

    for (const subject of selectedRetakes) {
      draftSubjectMap.set(subject.subject_id, subject);
    }

    const draftSubjects = Array.from(draftSubjectMap.values());

    if (draftSubjects.length === 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        message:
          "There are no eligible Regular, Carry Over, or selected Retake subjects to prepare for this enrollment period.",
      });
    }

    // =================================================
    // 17. SYNC STUDENT ACADEMIC PROFILE
    //
    // Home/profile section is NOT changed.
    // =================================================

    await connection.execute(
      `
        UPDATE students

        SET
            year_level = ?,
            academic_year_id = ?,
            semester_id = ?

        WHERE student_id = ?
      `,
      [effectiveYearLevel, academicYearId, semesterId, studentId],
    );

    // =================================================
    // 18. CREATE OR UPDATE DRAFT
    // =================================================

    let enrollmentId;

    let mode;

    // =================================================
    // UPDATE EXISTING DRAFT
    // =================================================

    if (existingDraft) {
      enrollmentId = Number(existingDraft.enrollment_id);

      mode = "updated";

      await connection.execute(
        `
          UPDATE enrollments

          SET remarks =
              'Updated by Student.'

          WHERE enrollment_id = ?

            AND enrollment_status =
                'Draft'
        `,
        [enrollmentId],
      );

      // ===============================================
      // LOAD ALL EXISTING DRAFT SUBJECT ROWS
      // ===============================================

      const [draftRows] = await connection.execute(
        `
            SELECT
                enrollment_subject_id,
                subject_id,
                enrollment_type,

                offering_id,
                section_id,
                section_subject_id,

                status

            FROM enrollment_subjects

            WHERE enrollment_id = ?

            ORDER BY
                enrollment_subject_id ASC

            FOR UPDATE
          `,
        [enrollmentId],
      );

      const desiredMap = new Map(
        draftSubjects.map((subject) => [Number(subject.subject_id), subject]),
      );

      // Subjects already preserved as active.
      const keptSubjectIds = new Set();

      // Previously dropped rows can be reused if
      // the Student selects the same Retake again.
      const droppedRowsBySubjectId = new Map();

      // ===============================================
      // SYNCHRONIZE EXISTING ROWS
      // ===============================================

      for (const row of draftRows) {
        const subjectId = Number(row.subject_id);

        const status = String(row.status);

        if (status === "Dropped") {
          droppedRowsBySubjectId.set(subjectId, row);

          continue;
        }

        const desired = desiredMap.get(subjectId);

        // =============================================
        // KEEP SUBJECT
        // =============================================

        if (desired && !keptSubjectIds.has(subjectId)) {
          await connection.execute(
            `
              UPDATE enrollment_subjects

              SET
                  enrollment_type = ?,

                  offering_id = NULL,
                  section_id = NULL,
                  section_subject_id = NULL,

                  status = 'Enrolled'

              WHERE enrollment_subject_id = ?

                AND enrollment_id = ?
            `,
            [
              desired.enrollment_type,

              Number(row.enrollment_subject_id),

              enrollmentId,
            ],
          );

          keptSubjectIds.add(subjectId);

          continue;
        }

        // =============================================
        // REMOVE FROM ACTIVE DRAFT
        //
        // Do not DELETE.
        // Preserve the row and mark Dropped.
        // =============================================

        await connection.execute(
          `
            UPDATE enrollment_subjects

            SET
                offering_id = NULL,
                section_id = NULL,
                section_subject_id = NULL,

                status = 'Dropped'

            WHERE enrollment_subject_id = ?

              AND enrollment_id = ?
          `,
          [Number(row.enrollment_subject_id), enrollmentId],
        );
      }

      // ===============================================
      // ADD NEWLY DESIRED SUBJECTS
      // ===============================================

      for (const subject of draftSubjects) {
        const subjectId = Number(subject.subject_id);

        if (keptSubjectIds.has(subjectId)) {
          continue;
        }

        const reusable = droppedRowsBySubjectId.get(subjectId);

        // =============================================
        // REACTIVATE OLD DROPPED DRAFT ROW
        // =============================================

        if (reusable) {
          await connection.execute(
            `
              UPDATE enrollment_subjects

              SET
                  enrollment_type = ?,

                  offering_id = NULL,
                  section_id = NULL,
                  section_subject_id = NULL,

                  status = 'Enrolled'

              WHERE enrollment_subject_id = ?

                AND enrollment_id = ?
            `,
            [
              subject.enrollment_type,

              Number(reusable.enrollment_subject_id),

              enrollmentId,
            ],
          );
        }

        // =============================================
        // INSERT NEW DRAFT SUBJECT
        // =============================================
        else {
          await connection.execute(
            `
              INSERT INTO enrollment_subjects (
                  enrollment_id,
                  subject_id,
                  enrollment_type,

                  offering_id,
                  section_id,
                  section_subject_id,

                  status
              )

              VALUES (
                  ?,
                  ?,
                  ?,

                  NULL,
                  NULL,
                  NULL,

                  'Enrolled'
              )
            `,
            [enrollmentId, subjectId, subject.enrollment_type],
          );
        }
      }
    }

    // =================================================
    // CREATE NEW DRAFT
    // =================================================
    else {
      mode = "created";

      const [enrollmentResult] = await connection.execute(
        `
            INSERT INTO enrollments (
                student_id,
                academic_year_id,
                semester_id,
                enrollment_status,
                remarks
            )

            VALUES (
                ?,
                ?,
                ?,
                'Draft',
                'Prepared by Student.'
            )
          `,
        [studentId, academicYearId, semesterId],
      );

      enrollmentId = Number(enrollmentResult.insertId);

      // ===============================================
      // INSERT AUTHORITATIVE SUBJECT TYPES
      // ===============================================

      for (const subject of draftSubjects) {
        await connection.execute(
          `
            INSERT INTO enrollment_subjects (
                enrollment_id,
                subject_id,
                enrollment_type,

                offering_id,
                section_id,
                section_subject_id,

                status
            )

            VALUES (
                ?,
                ?,
                ?,

                NULL,
                NULL,
                NULL,

                'Enrolled'
            )
          `,
          [enrollmentId, Number(subject.subject_id), subject.enrollment_type],
        );
      }
    }

    // =================================================
    // 19. TOTAL UNITS
    // =================================================

    const totalUnits = draftSubjects.reduce(
      (total, subject) => total + Number(subject.units || 0),

      0,
    );

    // =================================================
    // 20. COMMIT
    // =================================================

    await connection.commit();

    transactionActive = false;

    // =================================================
    // 21. RESPONSE
    // =================================================

    return res.status(mode === "created" ? 201 : 200).json({
      success: true,

      message:
        mode === "created"
          ? "Draft enrollment prepared successfully."
          : "Draft enrollment updated successfully.",

      mode,

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

        course: {
          course_id: courseId,

          course_code: student.course_code,

          course_name: student.course_name,
        },

        year_level: effectiveYearLevel,

        previous_year_level: yearLevel,
      },

      curriculum: {
        curriculum_id: curriculumId,

        curriculum_name: curriculum.curriculum_name,

        effective_year:
          curriculum.effective_year !== null
            ? Number(curriculum.effective_year)
            : null,
      },

      enrollment_period: {
        enrollment_period_id: Number(period.enrollment_period_id),

        academic_year_id: academicYearId,

        academic_year: period.academic_year,

        semester_id: semesterId,

        semester_name: period.semester_name,

        status: period.status,
      },

      enrollment: {
        enrollment_id: enrollmentId,

        student_id: studentId,

        enrollment_status: "Draft",
      },

      progression,

      summary: {
        total_subjects: draftSubjects.length,

        regular_subjects: regularEligible.length,

        carry_over_subjects: carryOverEligible.length,

        selected_retakes: selectedRetakes.length,

        irregular_subjects: carryOverEligible.length + selectedRetakes.length,

        total_units: totalUnits,
      },

      subjects: draftSubjects,

      next_action:
        "Student may continue editing the Draft or submit it for Registrar review.",
    });
  } catch (error) {
    // =================================================
    // ROLLBACK
    // =================================================

    if (connection && transactionActive) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "PREPARE STUDENT ENROLLMENT ROLLBACK ERROR:",
          rollbackError,
        );
      }
    }

    console.error("PREPARE STUDENT ENROLLMENT ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to prepare Student enrollment.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// SUBMIT STUDENT ENROLLMENT
//
// POST /api/student/enrollments/:enrollment_id/submit
//
// AUTH:
// Student JWT required.
//
// FLOW:
//
// Draft
//   ↓
// Revalidate academic eligibility
//   ↓
// Pending
//   ↓
// Registrar reviews and assigns placement
//
// IMPORTANT:
//
// - Student identity comes ONLY from req.user.
// - Student can submit ONLY their own Draft.
// - Enrollment period must still be Open.
// - Active curriculum must still be valid.
// - Every Draft subject is revalidated.
// - All currently eligible Regular subjects must exist.
// - Retakes must still be valid.
// - Passed subjects cannot be submitted again.
// - Blocked prerequisite subjects cannot be submitted.
// - Student does NOT choose placement.
// =====================================================

router.post("/:enrollment_id/submit", async (req, res) => {
  let connection;
  let transactionActive = false;

  try {
    // =================================================
    // 1. ENROLLMENT ID
    // =================================================

    const enrollmentId = Number(req.params.enrollment_id);

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // 2. AUTHENTICATION
    // =================================================

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
    }

    if (req.user.role_name !== "Student") {
      return res.status(403).json({
        success: false,
        message: "Student access is required.",
      });
    }

    const userId = Number(req.user.user_id);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({
        success: false,

        message: "Authenticated Student user ID is invalid.",
      });
    }

    // =================================================
    // 3. CONNECTION + TRANSACTION
    // =================================================

    connection = await db.getConnection();

    await connection.beginTransaction();

    transactionActive = true;

    // =================================================
    // 4. AUTHENTICATED STUDENT
    // =================================================

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
              c.course_code,
              c.course_name,

              s.year_level

          FROM students s

          INNER JOIN courses c
              ON c.course_id =
                 s.course_id

          WHERE s.user_id = ?

          LIMIT 1

          FOR UPDATE
        `,
      [userId],
    );

    if (studentRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(404).json({
        success: false,

        message: "No Student profile is connected to this account.",
      });
    }

    const student = studentRows[0];

    const studentId = Number(student.student_id);

    const studentCourseId = Number(student.course_id);

    const yearLevel = Number(student.year_level);

    // =================================================
    // 5. GET THIS STUDENT'S ENROLLMENT
    //
    // Ownership is enforced here.
    //
    // Student A cannot submit Student B's enrollment.
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
          SELECT
              e.enrollment_id,
              e.student_id,

              e.academic_year_id,
              ay.academic_year,

              e.semester_id,
              sem.semester_name,

              e.enrollment_status,
              e.remarks,

              e.approved_by,
              e.approved_at,

              e.created_at

          FROM enrollments e

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 e.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 e.semester_id

          WHERE e.enrollment_id = ?

            AND e.student_id = ?

          LIMIT 1

          FOR UPDATE
        `,
      [enrollmentId, studentId],
    );

    if (enrollmentRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // 6. ONLY DRAFT CAN BE SUBMITTED
    // =================================================

    const enrollmentStatus = String(enrollment.enrollment_status);

    if (enrollmentStatus !== "Draft") {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        message: `Enrollment cannot be submitted because its current status is "${enrollmentStatus}".`,

        enrollment: {
          enrollment_id: Number(enrollment.enrollment_id),

          enrollment_status: enrollmentStatus,
        },
      });
    }

    // =================================================
    // 7. ENROLLMENT PERIOD MUST STILL BE OPEN
    //
    // Must match this Draft's:
    //
    // academic_year_id
    // semester_id
    // =================================================

    const [periodRows] = await connection.execute(
      `
          SELECT
              ep.enrollment_period_id,

              ep.academic_year_id,
              ay.academic_year,

              ep.semester_id,
              sem.semester_name,

              ep.status,
              ep.opened_at,
              ep.remarks

          FROM enrollment_periods ep

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 ep.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 ep.semester_id

          WHERE ep.academic_year_id = ?

            AND ep.semester_id = ?

          ORDER BY
              ep.enrollment_period_id DESC

          LIMIT 1

          FOR UPDATE
        `,
      [Number(enrollment.academic_year_id), Number(enrollment.semester_id)],
    );

    if (periodRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        message: "The enrollment period for this Draft no longer exists.",
      });
    }

    const enrollmentPeriod = periodRows[0];

    if (String(enrollmentPeriod.status) !== "Open") {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        message:
          "Enrollment can no longer be submitted because the enrollment period is closed.",

        enrollment_period: {
          enrollment_period_id: Number(enrollmentPeriod.enrollment_period_id),

          academic_year: enrollmentPeriod.academic_year,

          semester_name: enrollmentPeriod.semester_name,

          status: enrollmentPeriod.status,
        },
      });
    }

    const semesterId = Number(enrollment.semester_id);
    if (![1, 2].includes(semesterId)) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,
        code: "UNSUPPORTED_ENROLLMENT_SEMESTER",
        message:
          "This enrollment cannot be submitted because Summer enrollment is not supported.",
      });
    }

    // =================================================
    // 8. ACTIVE ASSIGNED CURRICULUM
    //
    // Revalidate because curriculum/profile state may
    // have changed after Draft preparation.
    // =================================================

    const [curriculumRows] = await connection.execute(
      `
          SELECT
              sc.student_curriculum_id,
              sc.curriculum_id,
              sc.assigned_date,
              sc.status AS assignment_status,

              cur.curriculum_name,
              cur.effective_year,
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

          ORDER BY
              sc.assigned_date DESC,
              sc.student_curriculum_id DESC

          LIMIT 1

          FOR UPDATE
        `,
      [studentId, studentCourseId],
    );

    if (curriculumRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "VALID_ACTIVE_CURRICULUM_REQUIRED",

        message:
          "Enrollment cannot be submitted because the Student no longer has a valid active curriculum.",
      });
    }

    const curriculum = curriculumRows[0];

    const curriculumId = Number(curriculum.curriculum_id);

    // =================================================
    // 9. GET ALL DRAFT SUBJECT MEMBERSHIP
    // =================================================

    const [subjectRows] = await connection.execute(
      `
        SELECT
    es.enrollment_subject_id,
    es.enrollment_id,

    es.subject_id,
    es.enrollment_type,

    es.offering_id,
    es.section_id,
    es.section_subject_id,

    es.status,

    s.subject_code,
    s.subject_name,
    s.units

          FROM enrollment_subjects es

          INNER JOIN subjects s
              ON s.subject_id =
                 es.subject_id

          WHERE es.enrollment_id = ?

          ORDER BY
              es.enrollment_subject_id ASC

          FOR UPDATE
        `,
      [enrollmentId],
    );

    // =================================================
    // 10. ACTIVE SUBJECTS
    //
    // Dropped and Withdrawn are historical.
    // =================================================

    const activeSubjects = subjectRows.filter((subject) => {
      const status = String(subject.status || "");

      return !["Dropped", "Withdrawn"].includes(status);
    });

    if (activeSubjects.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(400).json({
        success: false,

        message:
          "Enrollment cannot be submitted because it has no active subjects.",
      });
    }

    // =================================================
    // 11. DRAFT SUBJECT STATUS
    //
    // Before grades exist, Draft membership must still
    // be Enrolled.
    //
    // Completed / Failed / Incomplete belong to
    // finalized academic attempts, not a new Draft.
    // =================================================

    const invalidStatusSubjects = activeSubjects.filter(
      (subject) => String(subject.status) !== "Enrolled",
    );

    if (invalidStatusSubjects.length > 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(400).json({
        success: false,

        message:
          "Some Draft subjects have an invalid enrollment-subject status.",

        invalid_subjects: invalidStatusSubjects.map((subject) => ({
          enrollment_subject_id: Number(subject.enrollment_subject_id),

          subject_id: Number(subject.subject_id),

          subject_code: subject.subject_code,

          status: subject.status,
        })),
      });
    }

    // =================================================
    // 12. DUPLICATE SUBJECT CHECK
    // =================================================

    const draftSubjectIds = activeSubjects.map((subject) =>
      Number(subject.subject_id),
    );

    const uniqueDraftSubjectIds = new Set(draftSubjectIds);

    if (uniqueDraftSubjectIds.size !== draftSubjectIds.length) {
      await connection.rollback();
      transactionActive = false;

      return res.status(400).json({
        success: false,

        message: "Duplicate subjects were found in the Draft enrollment.",
      });
    }

    // =================================================
    // 13. RE-EVALUATE CURRENT TERM
    //
    // This is the authoritative regular-subject check.
    //
    // Uses Grade Model V2 through the shared service:
    //
    // grades.enrollment_subject_id
    //        ↓
    // enrollment_subjects
    //        ↓
    // enrollments.student_id
    //
    // Only:
    //
    // grade_status = Approved
    // enrollment_status = Approved
    //
    // final_rating is authoritative.
    // =================================================

    const termEvaluation = await evaluateCurriculumTerm(
      {
        studentId,
        curriculumId,
        yearLevel,
        semesterId,
      },
      connection,
    );

    // =================================================
    // 14. RE-EVALUATE CARRY-OVER SUBJECTS
    //
    // Carry Over is automatic, just like Regular.
    // =================================================

    const carryOverEvaluation = await getCarryOverCandidates(
      studentId,
      curriculumId,
      yearLevel,
      semesterId,
      connection,
    );

    const eligibleCarryOverMap = new Map();

    for (const subject of carryOverEvaluation.eligible) {
      eligibleCarryOverMap.set(Number(subject.subject_id), subject);
    }
    // =================================================
    // 14. ELIGIBLE REGULAR SUBJECT MAP
    // =================================================

    const eligibleRegularMap = new Map();

    for (const subject of termEvaluation.regular) {
      eligibleRegularMap.set(Number(subject.subject_id), subject);
    }

    // =================================================
    // 15. VALID RETAKE SUBJECT MAP
    //
    // Retakes may come from any previous term in the
    // Student's currently assigned curriculum.
    //
    // Shared service validates:
    //
    // - latest Approved rating is 4.00 or 5.00
    // - no later Approved pass exists
    // - subject belongs to active curriculum
    // - prerequisites are satisfied
    // =================================================

    const retakeRows = await getRetakeCandidates(
      studentId,
      curriculumId,
      connection,
    );

    const validRetakeMap = new Map();

    for (const retake of retakeRows) {
      validRetakeMap.set(Number(retake.subject_id), retake);
    }

    // =================================================
    // 16. VALIDATE EVERY DRAFT SUBJECT
    //
    // Every active Draft subject must currently be:
    //
    // 1. Regular eligible
    //
    // OR
    //
    // 2. Valid retake
    //
    // Anything else is rejected.
    // =================================================

    const invalidAcademicSubjects = [];

    let regularCount = 0;
    let carryOverCount = 0;
    let retakeCount = 0;

    const validEnrollmentTypes = new Set(["Regular", "Carry Over", "Retake"]);

    for (const subject of activeSubjects) {
      const subjectId = Number(subject.subject_id);

      const enrollmentType = String(subject.enrollment_type || "").trim();

      // =================================================
      // VALID STORED ENROLLMENT TYPE
      // =================================================

      if (!validEnrollmentTypes.has(enrollmentType)) {
        invalidAcademicSubjects.push({
          enrollment_subject_id: Number(subject.enrollment_subject_id),

          subject_id: subjectId,

          subject_code: subject.subject_code,

          subject_name: subject.subject_name,

          enrollment_type: enrollmentType || null,

          reason: "INVALID_ENROLLMENT_TYPE",
        });

        continue;
      }

      // =================================================
      // REGULAR
      //
      // Persisted as Regular
      // → must STILL be academically Regular.
      // =================================================

      if (enrollmentType === "Regular") {
        if (eligibleRegularMap.has(subjectId)) {
          regularCount += 1;
          continue;
        }

        const blockedCurrentSubject = termEvaluation.blocked.find(
          (item) => Number(item.subject_id) === subjectId,
        );

        let reason = "REGULAR_SUBJECT_NO_LONGER_ELIGIBLE";

        if (blockedCurrentSubject) {
          if (
            blockedCurrentSubject.eligibility_type ===
            ELIGIBILITY_TYPE.ALREADY_PASSED
          ) {
            reason = "SUBJECT_ALREADY_PASSED";
          } else if (
            blockedCurrentSubject.eligibility_type ===
            ELIGIBILITY_TYPE.BLOCKED_PREREQUISITE
          ) {
            reason = "PREREQUISITE_NOT_PASSED";
          } else if (
            blockedCurrentSubject.eligibility_type ===
            ELIGIBILITY_TYPE.UNRESOLVED
          ) {
            reason = "ACADEMIC_RESULT_UNRESOLVED";
          }
        }

        invalidAcademicSubjects.push({
          enrollment_subject_id: Number(subject.enrollment_subject_id),

          subject_id: subjectId,

          subject_code: subject.subject_code,

          subject_name: subject.subject_name,

          enrollment_type: enrollmentType,

          reason,
        });

        continue;
      }

      // =================================================
      // CARRY OVER
      //
      // Persisted as Carry Over
      // → must STILL be an eligible Carry Over.
      // =================================================

      if (enrollmentType === "Carry Over") {
        if (eligibleCarryOverMap.has(subjectId)) {
          carryOverCount += 1;
          continue;
        }

        const blockedCarryOverSubject = carryOverEvaluation.blocked.find(
          (item) => Number(item.subject_id) === subjectId,
        );

        let reason = "CARRY_OVER_NO_LONGER_ELIGIBLE";

        if (blockedCarryOverSubject) {
          if (
            blockedCarryOverSubject.eligibility_type ===
            ELIGIBILITY_TYPE.BLOCKED_PREREQUISITE
          ) {
            reason = "PREREQUISITE_NOT_PASSED";
          } else if (
            blockedCarryOverSubject.eligibility_type ===
            ELIGIBILITY_TYPE.UNRESOLVED
          ) {
            reason = "ACADEMIC_RESULT_UNRESOLVED";
          } else if (blockedCarryOverSubject.carry_over_reason) {
            reason = blockedCarryOverSubject.carry_over_reason;
          }
        }

        invalidAcademicSubjects.push({
          enrollment_subject_id: Number(subject.enrollment_subject_id),

          subject_id: subjectId,

          subject_code: subject.subject_code,

          subject_name: subject.subject_name,

          enrollment_type: enrollmentType,

          reason,
        });

        continue;
      }

      // =================================================
      // RETAKE
      //
      // Persisted as Retake
      // → must STILL have a valid Approved 4.00/5.00
      // academic result and satisfy Retake rules.
      // =================================================

      if (enrollmentType === "Retake") {
        if (validRetakeMap.has(subjectId)) {
          retakeCount += 1;
          continue;
        }

        invalidAcademicSubjects.push({
          enrollment_subject_id: Number(subject.enrollment_subject_id),

          subject_id: subjectId,

          subject_code: subject.subject_code,

          subject_name: subject.subject_name,

          enrollment_type: enrollmentType,

          reason: "RETAKE_NO_LONGER_ELIGIBLE",
        });
      }
    }

    if (invalidAcademicSubjects.length > 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(400).json({
        success: false,

        message: "Some Draft subjects are no longer academically eligible.",

        invalid_subjects: invalidAcademicSubjects,
      });
    }

    // =================================================
    // 17. VERIFY ALL ELIGIBLE REGULAR SUBJECTS EXIST
    //
    // Regular subjects are automatic.
    //
    // Student may choose whether to take a valid retake,
    // but must not remove eligible Regular subjects
    // from the Draft.
    // =================================================

    const missingRegularSubjects = [];

    for (const [subjectId, subject] of eligibleRegularMap.entries()) {
      if (uniqueDraftSubjectIds.has(subjectId)) {
        continue;
      }

      missingRegularSubjects.push({
        subject_id: Number(subjectId),

        subject_code: subject.subject_code,

        subject_name: subject.subject_name,

        curriculum_subject_id: Number(subject.curriculum_subject_id),
      });
    }

    if (missingRegularSubjects.length > 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(400).json({
        success: false,

        message:
          "Some required eligible regular subjects are missing from the Draft.",

        missing_regular_subjects: missingRegularSubjects,
      });
    }
    // =================================================
    // VERIFY ALL ELIGIBLE CARRY-OVER SUBJECTS EXIST
    //
    // Carry Over subjects are automatic.
    // Student cannot remove them from the Draft.
    // =================================================

    const missingCarryOverSubjects = [];

    for (const [subjectId, subject] of eligibleCarryOverMap.entries()) {
      if (uniqueDraftSubjectIds.has(subjectId)) {
        continue;
      }

      missingCarryOverSubjects.push({
        subject_id: Number(subjectId),

        subject_code: subject.subject_code,

        subject_name: subject.subject_name,

        curriculum_subject_id: Number(subject.curriculum_subject_id),

        original_year_level: Number(subject.original_year_level),

        original_semester_id: Number(subject.original_semester_id),
      });
    }

    if (missingCarryOverSubjects.length > 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(400).json({
        success: false,

        message:
          "Some required eligible Carry-Over subjects are missing from the Draft.",

        missing_carry_over_subjects: missingCarryOverSubjects,
      });
    }
    // =================================================
    // 18. TOTAL UNITS
    // =================================================

    const totalUnits = activeSubjects.reduce(
      (total, subject) => total + Number(subject.units || 0),
      0,
    );

    // =================================================
    // 19. PLACEMENT
    //
    // DO NOT REQUIRE:
    //
    // section_id
    // offering_id
    // section_subject_id
    //
    // Student preparation intentionally leaves them
    // NULL.
    //
    // Registrar owns placement after submission.
    // =================================================

    const unassignedSubjects = activeSubjects.filter(
      (subject) =>
        subject.section_id === null ||
        subject.offering_id === null ||
        subject.section_subject_id === null,
    );

    // =================================================
    // 20. DRAFT → PENDING
    // =================================================

    const submittedRemarks = enrollment.remarks || "Submitted by Student.";

    const [updateResult] = await connection.execute(
      `
          UPDATE enrollments

          SET
              enrollment_status =
                  'Pending',

              remarks = ?

          WHERE enrollment_id = ?

            AND student_id = ?

            AND enrollment_status =
                'Draft'
        `,
      [submittedRemarks, enrollmentId, studentId],
    );

    if (updateResult.affectedRows !== 1) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        message:
          "Enrollment could not be submitted because its status changed before submission.",
      });
    }

    // =================================================
    // 21. COMMIT
    // =================================================

    await connection.commit();

    transactionActive = false;

    // =================================================
    // 22. RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      message:
        "Enrollment submitted successfully and is now pending Registrar review.",

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
      },

      curriculum: {
        curriculum_id: curriculumId,

        curriculum_name: curriculum.curriculum_name,

        effective_year:
          curriculum.effective_year !== null
            ? Number(curriculum.effective_year)
            : null,
      },

      enrollment: {
        enrollment_id: enrollmentId,

        student_id: studentId,

        academic_year_id: Number(enrollment.academic_year_id),

        academic_year: enrollment.academic_year,

        semester_id: Number(enrollment.semester_id),

        semester_name: enrollment.semester_name,

        enrollment_status: "Pending",

        remarks: submittedRemarks,

        created_at: enrollment.created_at,
      },

      summary: {
        total_subjects: activeSubjects.length,

        regular_subjects: regularCount,

        carry_over_subjects: carryOverCount,

        selected_retakes: retakeCount,

        total_units: totalUnits,
      },

      registrar_assignment: {
        required: true,

        message:
          "Registrar must now review the enrollment and assign valid sections and subject offerings.",

        unassigned_subjects: unassignedSubjects.length,
      },

      next_action: "Registrar reviews this Pending enrollment.",
    });
  } catch (error) {
    if (connection && transactionActive) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "SUBMIT STUDENT ENROLLMENT ROLLBACK ERROR:",
          rollbackError,
        );
      }
    }

    console.error("SUBMIT STUDENT ENROLLMENT ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to submit Student enrollment.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});
// =====================================================
// EXPORT ROUTER
// =====================================================

export default router;
