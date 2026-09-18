// routes/programhead/classes.js

import express from "express";
import db from "../../db.js";

const router = express.Router();

// =====================================================
// HELPERS
// =====================================================

function toPositiveInt(value) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0
    ? number
    : null;
}

// =====================================================
// GET AUTHENTICATED PROGRAM HEAD
// =====================================================
//
// JWT user_id
//      ↓
// faculty.user_id
//      ↓
// program_heads.faculty_id
//      ↓
// department_id
//
// Never accept:
// - program_head_id
// - faculty_id
// - department_id
//
// from frontend.
//
// =====================================================

async function getAuthenticatedProgramHead(req, res) {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: "Authentication is required.",
    });

    return null;
  }

  if (req.user.role_name !== "Program Head") {
    res.status(403).json({
      success: false,
      message:
        "Program Head access is required.",
    });

    return null;
  }

  const userId =
    toPositiveInt(req.user.user_id);

  if (!userId) {
    res.status(401).json({
      success: false,
      message:
        "Authenticated Program Head user ID is invalid.",
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

    WHERE
        f.user_id = ?

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
      message:
        "No active Program Head assignment was found for this account.",
    });

    return null;
  }

  const row = rows[0];

  return {
    program_head_id:
      Number(row.program_head_id),

    faculty_id:
      Number(row.faculty_id),

    user_id:
      Number(row.user_id),

    employee_number:
      row.employee_number,

    username:
      row.username,

    first_name:
      row.first_name,

    middle_name:
      row.middle_name,

    last_name:
      row.last_name,

    program_head_name: [
      row.first_name,
      row.middle_name,
      row.last_name,
    ]
      .filter(Boolean)
      .join(" "),

    email:
      row.email,

    department_id:
      Number(row.department_id),

    department_code:
      row.department_code,

    department_name:
      row.department_name,
  };
}

// =====================================================
// GET PROGRAM HEAD DEPARTMENT CLASSES
// =====================================================
//
// GET /api/program-head/classes
//
// Optional:
//
// ?academic_year_id=2
// ?semester_id=2
//
// SECURITY:
//
// Program Head
//      ↓
// program_heads.department_id
//      ↓
// courses.department_id
//      ↓
// sections
//      ↓
// subject_offerings
//
// Program Head can therefore see classes belonging
// only to their department.
//
// =====================================================

router.get("/", async (req, res) => {
  try {
    // =================================================
    // AUTHENTICATED PROGRAM HEAD
    // =================================================

    const programHead =
      await getAuthenticatedProgramHead(
        req,
        res,
      );

    if (!programHead) {
      return;
    }

    // =================================================
    // OPTIONAL FILTERS
    // =================================================

    let academicYearId = null;
    let semesterId = null;

    if (
      req.query.academic_year_id !==
        undefined &&
      req.query.academic_year_id !== ""
    ) {
      academicYearId =
        toPositiveInt(
          req.query.academic_year_id,
        );

      if (!academicYearId) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid academic year ID.",
        });
      }
    }

    if (
      req.query.semester_id !== undefined &&
      req.query.semester_id !== ""
    ) {
      semesterId =
        toPositiveInt(
          req.query.semester_id,
        );

      if (!semesterId) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid semester ID.",
        });
      }
    }

    // =================================================
    // FILTER CONDITIONS
    // =================================================

    const conditions = [
      "c.department_id = ?",
      "so.status <> 'Cancelled'",
    ];

    const params = [
      programHead.department_id,
    ];

    if (academicYearId) {
      conditions.push(
        "so.academic_year_id = ?",
      );

      params.push(academicYearId);
    }

    if (semesterId) {
      conditions.push(
        "so.semester_id = ?",
      );

      params.push(semesterId);
    }

    // =================================================
    // GET DEPARTMENT CLASSES
    // =================================================

    const [rows] = await db.execute(
      `
      SELECT
          -- ===========================================
          -- OFFERING
          -- ===========================================

          so.offering_id,
          so.section_subject_id,

          so.faculty_id,

          so.room_id,

          so.academic_year_id,
          so.semester_id,

          so.schedule_days,
          so.schedule_time,

          so.max_students,

          so.status
              AS offering_status,

          so.created_at,

          -- ===========================================
          -- SECTION SUBJECT
          -- ===========================================

          ss.status
              AS section_subject_status,

          -- ===========================================
          -- SUBJECT
          -- ===========================================

          sub.subject_id,
          sub.subject_code,
          sub.subject_name,

          sub.units,
          sub.lecture_hours,
          sub.laboratory_hours,

          -- ===========================================
          -- SECTION / COURSE
          -- ===========================================

          sec.section_id,
          sec.section_name,
          sec.year_level,

          c.course_id,
          c.course_code,
          c.course_name,
          c.department_id,

          -- ===========================================
          -- ACADEMIC PERIOD
          -- ===========================================

          ay.academic_year,
          ay.is_current
              AS academic_year_is_current,

          sem.semester_name,

          -- ===========================================
          -- ASSIGNED FACULTY
          -- ===========================================

          f.employee_number
              AS faculty_employee_number,

          f.first_name
              AS faculty_first_name,

          f.middle_name
              AS faculty_middle_name,

          f.last_name
              AS faculty_last_name,

          f.email
              AS faculty_email,

          -- ===========================================
          -- ROOM
          -- ===========================================

          r.room_code,
          r.room_name,

          -- ===========================================
          -- OFFICIAL GRADING STUDENTS
          -- ===========================================
          -- We include final subject statuses because
          -- approved grades change:
          --
          -- Enrolled -> Completed / Failed / Incomplete
          --
          -- Those students must remain visible in
          -- Program Head grading/history.
          -- ===========================================

          (
              SELECT COUNT(*)

              FROM enrollment_subjects es_count

              INNER JOIN enrollments e_count
                  ON e_count.enrollment_id =
                     es_count.enrollment_id

              WHERE
                  es_count.offering_id =
                      so.offering_id

                  AND e_count.enrollment_status =
                      'Approved'

                  AND es_count.status IN (
                      'Enrolled',
                      'Completed',
                      'Failed',
                      'Incomplete'
                  )
          ) AS official_student_count,

          -- ===========================================
          -- GRADE COUNTS
          -- ===========================================

          (
              SELECT COUNT(*)

              FROM grades g_count

              INNER JOIN enrollment_subjects
                  es_grade
                  ON es_grade.enrollment_subject_id =
                     g_count.enrollment_subject_id

              WHERE
                  es_grade.offering_id =
                      so.offering_id

                  AND g_count.grade_status =
                      'Draft'
          ) AS draft_grade_count,

          (
              SELECT COUNT(*)

              FROM grades g_count

              INNER JOIN enrollment_subjects
                  es_grade
                  ON es_grade.enrollment_subject_id =
                     g_count.enrollment_subject_id

              WHERE
                  es_grade.offering_id =
                      so.offering_id

                  AND g_count.grade_status =
                      'Submitted'
          ) AS submitted_grade_count,

          (
              SELECT COUNT(*)

              FROM grades g_count

              INNER JOIN enrollment_subjects
                  es_grade
                  ON es_grade.enrollment_subject_id =
                     g_count.enrollment_subject_id

              WHERE
                  es_grade.offering_id =
                      so.offering_id

                  AND g_count.grade_status =
                      'Returned'
          ) AS returned_grade_count,

          (
              SELECT COUNT(*)

              FROM grades g_count

              INNER JOIN enrollment_subjects
                  es_grade
                  ON es_grade.enrollment_subject_id =
                     g_count.enrollment_subject_id

              WHERE
                  es_grade.offering_id =
                      so.offering_id

                  AND g_count.grade_status =
                      'Approved'
          ) AS approved_grade_count

      FROM subject_offerings so

      INNER JOIN section_subjects ss
          ON ss.section_subject_id =
             so.section_subject_id

      INNER JOIN subjects sub
          ON sub.subject_id =
             so.subject_id

      INNER JOIN sections sec
          ON sec.section_id =
             so.section_id

      INNER JOIN courses c
          ON c.course_id =
             sec.course_id

      INNER JOIN academic_years ay
          ON ay.academic_year_id =
             so.academic_year_id

      INNER JOIN semesters sem
          ON sem.semester_id =
             so.semester_id

      LEFT JOIN faculty f
          ON f.faculty_id =
             so.faculty_id

      LEFT JOIN rooms r
          ON r.room_id =
             so.room_id

      WHERE
          ${conditions.join(
            "\n          AND ",
          )}

      ORDER BY
          ay.is_current DESC,

          so.academic_year_id DESC,
          so.semester_id DESC,

          c.course_code ASC,
          sec.year_level ASC,
          sec.section_name ASC,

          sub.subject_code ASC,
          so.offering_id ASC
      `,
      params,
    );

    // =================================================
    // FORMAT CLASSES
    // =================================================

    const classes = rows.map((row) => {
      const facultyAssigned =
        row.faculty_id !== null;

      const officialStudents =
        Number(
          row.official_student_count || 0,
        );

      const draft =
        Number(
          row.draft_grade_count || 0,
        );

      const submitted =
        Number(
          row.submitted_grade_count || 0,
        );

      const returned =
        Number(
          row.returned_grade_count || 0,
        );

      const approved =
        Number(
          row.approved_grade_count || 0,
        );

      return {
        offering_id:
          Number(row.offering_id),

        section_subject_id:
          Number(
            row.section_subject_id,
          ),

        offering_status:
          row.offering_status,

        section_subject_status:
          row.section_subject_status,

        // =============================================
        // DIRECT GRADING READINESS
        // =============================================
        //
        // Program Head can inspect department classes.
        //
        // But current DB grade rules require
        // grades.faculty_id to match the Faculty
        // assigned to subject_offerings.
        //
        // So direct grade encoding is only safe when
        // an offering has an assigned Faculty.
        //
        // =============================================

        grading_ready:
          facultyAssigned,

        grading_block_reason:
          facultyAssigned
            ? null
            : "No Faculty is assigned to this offering.",

        subject: {
          subject_id:
            Number(row.subject_id),

          subject_code:
            row.subject_code,

          subject_name:
            row.subject_name,

          units:
            Number(row.units || 0),

          lecture_hours:
            Number(
              row.lecture_hours || 0,
            ),

          laboratory_hours:
            Number(
              row.laboratory_hours || 0,
            ),
        },

        section: {
          section_id:
            Number(row.section_id),

          section_name:
            row.section_name,

          year_level:
            Number(
              row.year_level || 0,
            ),

          course: {
            course_id:
              Number(row.course_id),

            course_code:
              row.course_code,

            course_name:
              row.course_name,
          },
        },

        faculty:
          facultyAssigned
            ? {
                faculty_id:
                  Number(
                    row.faculty_id,
                  ),

                employee_number:
                  row.faculty_employee_number,

                first_name:
                  row.faculty_first_name,

                middle_name:
                  row.faculty_middle_name,

                last_name:
                  row.faculty_last_name,

                faculty_name: [
                  row.faculty_first_name,
                  row.faculty_middle_name,
                  row.faculty_last_name,
                ]
                  .filter(Boolean)
                  .join(" "),

                email:
                  row.faculty_email,
              }
            : null,

        academic_period: {
          academic_year_id:
            Number(
              row.academic_year_id,
            ),

          academic_year:
            row.academic_year,

          is_current_academic_year:
            Boolean(
              row.academic_year_is_current,
            ),

          semester_id:
            Number(
              row.semester_id,
            ),

          semester_name:
            row.semester_name,
        },

        schedule: {
          days:
            row.schedule_days,

          time:
            row.schedule_time,
        },

        room:
          row.room_id !== null
            ? {
                room_id:
                  Number(
                    row.room_id,
                  ),

                room_code:
                  row.room_code,

                room_name:
                  row.room_name,
              }
            : null,

        capacity: {
          max_students:
            Number(
              row.max_students || 0,
            ),

          official_students:
            officialStudents,
        },

        grades: {
          draft,
          submitted,
          returned,
          approved,

          total_with_grade:
            draft +
            submitted +
            returned +
            approved,

          without_grade:
            Math.max(
              officialStudents -
                (
                  draft +
                  submitted +
                  returned +
                  approved
                ),
              0,
            ),
        },

        created_at:
          row.created_at,
      };
    });

    // =================================================
    // SUMMARY
    // =================================================

    const summary = {
      total_classes:
        classes.length,

      grading_ready:
        classes.filter(
          (item) =>
            item.grading_ready,
        ).length,

      without_faculty:
        classes.filter(
          (item) =>
            !item.grading_ready,
        ).length,

      open:
        classes.filter(
          (item) =>
            item.offering_status ===
            "Open",
        ).length,

      closed:
        classes.filter(
          (item) =>
            item.offering_status ===
            "Closed",
        ).length,

      total_official_students:
        classes.reduce(
          (total, item) =>
            total +
            item.capacity
              .official_students,
          0,
        ),

      total_submitted_grades:
        classes.reduce(
          (total, item) =>
            total +
            item.grades.submitted,
          0,
        ),

      total_approved_grades:
        classes.reduce(
          (total, item) =>
            total +
            item.grades.approved,
          0,
        ),
    };

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      program_head: {
        program_head_id:
          programHead.program_head_id,

        faculty_id:
          programHead.faculty_id,

        user_id:
          programHead.user_id,

        employee_number:
          programHead.employee_number,

        username:
          programHead.username,

        program_head_name:
          programHead.program_head_name,

        department: {
          department_id:
            programHead.department_id,

          department_code:
            programHead.department_code,

          department_name:
            programHead.department_name,
        },
      },

      filters: {
        academic_year_id:
          academicYearId,

        semester_id:
          semesterId,
      },

      summary,

      classes,
    });
  } catch (error) {
    console.error(
      "GET /api/program-head/classes error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to retrieve Program Head classes.",
    });
  }
});


// =====================================================
// GET PROGRAM HEAD CLASS GRADEBOOK
// =====================================================
//
// GET
// /api/program-head/classes/:offeringId/gradebook
//
// Program Head may inspect any non-cancelled offering
// belonging to their department.
//
// Students included:
//
// Enrolled
// Completed
// Failed
// Incomplete
//
// Dropped / Withdrawn are excluded.
//
// =====================================================

router.get(
  "/:offeringId/gradebook",
  async (req, res) => {
    try {
      // ===============================================
      // AUTHENTICATED PROGRAM HEAD
      // ===============================================

      const programHead =
        await getAuthenticatedProgramHead(
          req,
          res,
        );

      if (!programHead) {
        return;
      }

      // ===============================================
      // VALIDATE OFFERING ID
      // ===============================================

      const offeringId =
        toPositiveInt(
          req.params.offeringId,
        );

      if (!offeringId) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid offering ID.",
        });
      }

      // ===============================================
      // FIND CLASS + VERIFY DEPARTMENT
      // ===============================================

      const [offeringRows] =
        await db.execute(
          `
          SELECT
              so.offering_id,
              so.section_subject_id,

              so.subject_id,
              so.section_id,

              so.faculty_id,
              so.room_id,

              so.academic_year_id,
              so.semester_id,

              so.schedule_days,
              so.schedule_time,
              so.max_students,

              so.status
                  AS offering_status,

              ss.status
                  AS section_subject_status,

              sub.subject_code,
              sub.subject_name,
              sub.units,
              sub.lecture_hours,
              sub.laboratory_hours,

              sec.section_name,
              sec.year_level,

              c.course_id,
              c.course_code,
              c.course_name,
              c.department_id,

              ay.academic_year,
              ay.is_current
                  AS academic_year_is_current,

              sem.semester_name,

              f.employee_number
                  AS faculty_employee_number,

              f.first_name
                  AS faculty_first_name,

              f.middle_name
                  AS faculty_middle_name,

              f.last_name
                  AS faculty_last_name,

              f.email
                  AS faculty_email,

              r.room_code,
              r.room_name

          FROM subject_offerings so

          INNER JOIN section_subjects ss
              ON ss.section_subject_id =
                 so.section_subject_id

          INNER JOIN subjects sub
              ON sub.subject_id =
                 so.subject_id

          INNER JOIN sections sec
              ON sec.section_id =
                 so.section_id

          INNER JOIN courses c
              ON c.course_id =
                 sec.course_id

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 so.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 so.semester_id

          LEFT JOIN faculty f
              ON f.faculty_id =
                 so.faculty_id

          LEFT JOIN rooms r
              ON r.room_id =
                 so.room_id

          WHERE
              so.offering_id = ?

              AND c.department_id = ?

          LIMIT 1
          `,
          [
            offeringId,
            programHead.department_id,
          ],
        );

      if (offeringRows.length === 0) {
        return res.status(404).json({
          success: false,
          message:
            "Class was not found or is outside your Program Head department.",
        });
      }

      const offering =
        offeringRows[0];

      // ===============================================
      // CANCELLED OFFERING
      // ===============================================

      if (
        offering.offering_status ===
        "Cancelled"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "This class offering has been cancelled.",
        });
      }

      // ===============================================
      // GET OFFICIAL STUDENTS + GRADES
      // ===============================================
      //
      // IMPORTANT:
      //
      // Approved grades change the enrollment subject:
      //
      // Passed     -> Completed
      // Failed     -> Failed
      // Incomplete -> Incomplete
      //
      // Therefore finalized students must remain in
      // the Program Head gradebook.
      //
      // ===============================================

      const [rows] =
        await db.execute(
          `
          SELECT
              es.enrollment_subject_id,
              es.enrollment_id,

              es.status
                  AS enrollment_subject_status,

              e.student_id,
              e.enrollment_status,

              s.student_number,
              s.first_name,
              s.middle_name,
              s.last_name,

              u.email,

              g.grade_id,

              g.faculty_id
                  AS grade_faculty_id,

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
                  AS grade_updated_at

          FROM enrollment_subjects es

          INNER JOIN enrollments e
              ON e.enrollment_id =
                 es.enrollment_id

          INNER JOIN students s
              ON s.student_id =
                 e.student_id

          LEFT JOIN users u
              ON u.user_id =
                 s.user_id

          LEFT JOIN grades g
              ON g.enrollment_subject_id =
                 es.enrollment_subject_id

          LEFT JOIN users reviewer
              ON reviewer.user_id =
                 g.reviewed_by

          WHERE
              es.offering_id = ?

              AND es.subject_id = ?

              AND es.section_id = ?

              AND e.academic_year_id = ?

              AND e.semester_id = ?

              AND e.enrollment_status =
                  'Approved'

              AND es.status IN (
                  'Enrolled',
                  'Completed',
                  'Failed',
                  'Incomplete'
              )

          ORDER BY
              s.last_name ASC,
              s.first_name ASC,
              s.middle_name ASC,
              s.student_number ASC
          `,
          [
            offering.offering_id,
            offering.subject_id,
            offering.section_id,
            offering.academic_year_id,
            offering.semester_id,
          ],
        );

      // ===============================================
      // FORMAT STUDENTS
      // ===============================================

      const students =
        rows.map((row) => {
          const hasGrade =
            row.grade_id !== null;

          return {
            enrollment_subject_id:
              Number(
                row.enrollment_subject_id,
              ),

            enrollment_id:
              Number(
                row.enrollment_id,
              ),

            student_id:
              Number(
                row.student_id,
              ),

            student_number:
              row.student_number,

            first_name:
              row.first_name,

            middle_name:
              row.middle_name,

            last_name:
              row.last_name,

            full_name: [
              row.first_name,
              row.middle_name,
              row.last_name,
            ]
              .filter(Boolean)
              .join(" "),

            email:
              row.email,

            enrollment_status:
              row.enrollment_status,

            subject_status:
              row.enrollment_subject_status,

            grade:
              hasGrade
                ? {
                    grade_id:
                      Number(
                        row.grade_id,
                      ),

                    faculty_id:
                      row.grade_faculty_id !==
                      null
                        ? Number(
                            row.grade_faculty_id,
                          )
                        : null,

                    prelim_grade:
                      row.prelim_grade !==
                      null
                        ? Number(
                            row.prelim_grade,
                          )
                        : null,

                    midterm_grade:
                      row.midterm_grade !==
                      null
                        ? Number(
                            row.midterm_grade,
                          )
                        : null,

                    final_grade:
                      row.final_grade !== null
                        ? Number(
                            row.final_grade,
                          )
                        : null,

                    final_rating:
                      row.final_rating !==
                      null
                        ? Number(
                            row.final_rating,
                          )
                        : null,

                    remarks:
                      row.remarks,

                    grade_status:
                      row.grade_status,

                    submitted_at:
                      row.submitted_at,

                    review: {
                      reviewed_by:
                        row.reviewed_by,

                      reviewed_by_username:
                        row.reviewed_by_username,

                      reviewed_at:
                        row.reviewed_at,

                      review_remarks:
                        row.review_remarks,
                    },

                    created_at:
                      row.grade_created_at,

                    updated_at:
                      row.grade_updated_at,
                  }
                : null,
          };
        });

      // ===============================================
      // SUMMARY
      // ===============================================

      const summary = {
        total_students:
          students.length,

        without_grade:
          students.filter(
            (student) =>
              student.grade === null,
          ).length,

        draft:
          students.filter(
            (student) =>
              student.grade
                ?.grade_status ===
              "Draft",
          ).length,

        submitted:
          students.filter(
            (student) =>
              student.grade
                ?.grade_status ===
              "Submitted",
          ).length,

        returned:
          students.filter(
            (student) =>
              student.grade
                ?.grade_status ===
              "Returned",
          ).length,

        approved:
          students.filter(
            (student) =>
              student.grade
                ?.grade_status ===
              "Approved",
          ).length,
      };

      // ===============================================
      // RESPONSE
      // ===============================================

      return res.status(200).json({
        success: true,

        program_head: {
          program_head_id:
            programHead.program_head_id,

          user_id:
            programHead.user_id,

          program_head_name:
            programHead.program_head_name,

          department: {
            department_id:
              programHead.department_id,

            department_code:
              programHead.department_code,

            department_name:
              programHead.department_name,
          },
        },

        class: {
          offering_id:
            Number(
              offering.offering_id,
            ),

          section_subject_id:
            Number(
              offering.section_subject_id,
            ),

          offering_status:
            offering.offering_status,

          section_subject_status:
            offering.section_subject_status,

          grading_ready:
            offering.faculty_id !== null,

          grading_block_reason:
            offering.faculty_id !== null
              ? null
              : "No Faculty is assigned to this offering.",

          subject: {
            subject_id:
              Number(
                offering.subject_id,
              ),

            subject_code:
              offering.subject_code,

            subject_name:
              offering.subject_name,

            units:
              Number(
                offering.units || 0,
              ),

            lecture_hours:
              Number(
                offering.lecture_hours ||
                  0,
              ),

            laboratory_hours:
              Number(
                offering.laboratory_hours ||
                  0,
              ),
          },

          section: {
            section_id:
              Number(
                offering.section_id,
              ),

            section_name:
              offering.section_name,

            year_level:
              Number(
                offering.year_level || 0,
              ),

            course: {
              course_id:
                Number(
                  offering.course_id,
                ),

              course_code:
                offering.course_code,

              course_name:
                offering.course_name,
            },
          },

          faculty:
            offering.faculty_id !== null
              ? {
                  faculty_id:
                    Number(
                      offering.faculty_id,
                    ),

                  employee_number:
                    offering.faculty_employee_number,

                  faculty_name: [
                    offering.faculty_first_name,
                    offering.faculty_middle_name,
                    offering.faculty_last_name,
                  ]
                    .filter(Boolean)
                    .join(" "),

                  email:
                    offering.faculty_email,
                }
              : null,

          academic_period: {
            academic_year_id:
              Number(
                offering.academic_year_id,
              ),

            academic_year:
              offering.academic_year,

            is_current_academic_year:
              Boolean(
                offering
                  .academic_year_is_current,
              ),

            semester_id:
              Number(
                offering.semester_id,
              ),

            semester_name:
              offering.semester_name,
          },

          schedule: {
            days:
              offering.schedule_days,

            time:
              offering.schedule_time,
          },

          room:
            offering.room_id !== null
              ? {
                  room_id:
                    Number(
                      offering.room_id,
                    ),

                  room_code:
                    offering.room_code,

                  room_name:
                    offering.room_name,
                }
              : null,
        },

        summary,

        students,
      });
    } catch (error) {
      console.error(
        "GET /api/program-head/classes/:offeringId/gradebook error:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to retrieve Program Head class gradebook.",
      });
    }
  },
);


// =====================================================
// PROGRAM HEAD DIRECT ENCODE + APPROVE GRADE
// =====================================================
//
// PUT
// /api/program-head/classes/:offeringId
//                   /grades/:enrollmentSubjectId/direct-approve
//
// PURPOSE:
//
// Program Head directly encodes a student's grade
// and immediately approves it.
//
// IMPORTANT DATABASE RULE:
//
// grades.faculty_id must match
// subject_offerings.faculty_id.
//
// Therefore:
//
// grades.faculty_id = assigned Faculty
// grades.reviewed_by = Program Head user_id
//
// Internally:
//
// INSERT Draft
//      ↓
// Submitted
//      ↓
// Approved
//
// All steps run inside one transaction.
//
// =====================================================

router.put(
  "/:offeringId/grades/:enrollmentSubjectId/direct-approve",
  async (req, res) => {
    let connection;

    try {
      // ===============================================
      // AUTHENTICATED PROGRAM HEAD
      // ===============================================

      const programHead =
        await getAuthenticatedProgramHead(
          req,
          res,
        );

      if (!programHead) {
        return;
      }

      // ===============================================
      // VALIDATE IDS
      // ===============================================

      const offeringId =
        toPositiveInt(
          req.params.offeringId,
        );

      const enrollmentSubjectId =
        toPositiveInt(
          req.params.enrollmentSubjectId,
        );

      if (!offeringId) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid offering ID.",
        });
      }

      if (!enrollmentSubjectId) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid enrollment subject ID.",
        });
      }

      // ===============================================
      // REQUEST VALUES
      // ===============================================

      const {
        prelim_grade,
        midterm_grade,
        final_grade,
        final_rating,
        remarks,
      } = req.body ?? {};

      // ===============================================
      // NORMALIZE NUMBERS
      // ===============================================

      const normalizeNullableNumber = (
        value,
        fieldName,
      ) => {
        if (
          value === null ||
          value === undefined ||
          value === ""
        ) {
          return {
            valid: true,
            value: null,
          };
        }

        const number =
          Number(value);

        if (!Number.isFinite(number)) {
          return {
            valid: false,
            message:
              `${fieldName} must be a valid number.`,
          };
        }

        return {
          valid: true,
          value: number,
        };
      };

      const prelimResult =
        normalizeNullableNumber(
          prelim_grade,
          "Prelim grade",
        );

      if (!prelimResult.valid) {
        return res.status(400).json({
          success: false,
          message:
            prelimResult.message,
        });
      }

      const midtermResult =
        normalizeNullableNumber(
          midterm_grade,
          "Midterm grade",
        );

      if (!midtermResult.valid) {
        return res.status(400).json({
          success: false,
          message:
            midtermResult.message,
        });
      }

      const finalGradeResult =
        normalizeNullableNumber(
          final_grade,
          "Final grade",
        );

      if (!finalGradeResult.valid) {
        return res.status(400).json({
          success: false,
          message:
            finalGradeResult.message,
        });
      }

      const finalRatingResult =
        normalizeNullableNumber(
          final_rating,
          "Final rating",
        );

      if (!finalRatingResult.valid) {
        return res.status(400).json({
          success: false,
          message:
            finalRatingResult.message,
        });
      }

      // ===============================================
      // REMARKS
      // ===============================================

      const allowedRemarks = [
        "Passed",
        "Failed",
        "Incomplete",
      ];

      if (
        !allowedRemarks.includes(remarks)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Remarks must be Passed, Failed, or Incomplete.",
        });
      }

      // ===============================================
      // COMPLETENESS
      // ===============================================
      //
      // Current DB rule:
      //
      // Passed / Failed:
      // all numeric components + final rating required.
      //
      // Incomplete:
      // remarks required, but numeric values may
      // remain incomplete.
      //
      // ===============================================

      if (
        ["Passed", "Failed"].includes(
          remarks,
        )
      ) {
        const missingFields = [];

        if (
          prelimResult.value === null
        ) {
          missingFields.push(
            "prelim_grade",
          );
        }

        if (
          midtermResult.value === null
        ) {
          missingFields.push(
            "midterm_grade",
          );
        }

        if (
          finalGradeResult.value === null
        ) {
          missingFields.push(
            "final_grade",
          );
        }

        if (
          finalRatingResult.value === null
        ) {
          missingFields.push(
            "final_rating",
          );
        }

        if (
          missingFields.length > 0
        ) {
          return res.status(400).json({
            success: false,

            message:
              "Complete grades and final rating are required for Passed or Failed grades.",

            missing_fields:
              missingFields,
          });
        }
      }

      // ===============================================
      // TRANSACTION
      // ===============================================

      connection =
        await db.getConnection();

      await connection.beginTransaction();

      // ===============================================
      // VERIFY CLASS + STUDENT + DEPARTMENT
      // ===============================================
      //
      // IMPORTANT:
      //
      // Program Head department is derived from JWT.
      //
      // No department ID is accepted from frontend.
      //
      // ===============================================

      const [rows] =
        await connection.execute(
          `
          SELECT
              so.offering_id,
              so.section_subject_id,

              so.subject_id,
              so.section_id,

              so.faculty_id
                  AS offering_faculty_id,

              so.academic_year_id,
              so.semester_id,

              so.status
                  AS offering_status,

              sub.subject_code,
              sub.subject_name,

              sec.section_name,

              c.course_id,
              c.course_code,
              c.course_name,
              c.department_id,

              es.enrollment_subject_id,
              es.enrollment_id,

              es.status
                  AS enrollment_subject_status,

              e.student_id,
              e.enrollment_status,

              s.student_number,
              s.first_name,
              s.middle_name,
              s.last_name,

              g.grade_id,
              g.faculty_id
                  AS grade_faculty_id,

              g.grade_status

          FROM subject_offerings so

          INNER JOIN subjects sub
              ON sub.subject_id =
                 so.subject_id

          INNER JOIN sections sec
              ON sec.section_id =
                 so.section_id

          INNER JOIN courses c
              ON c.course_id =
                 sec.course_id

          INNER JOIN enrollment_subjects es
              ON es.offering_id =
                 so.offering_id

              AND es.subject_id =
                  so.subject_id

              AND es.section_id =
                  so.section_id

          INNER JOIN enrollments e
              ON e.enrollment_id =
                 es.enrollment_id

          INNER JOIN students s
              ON s.student_id =
                 e.student_id

          LEFT JOIN grades g
              ON g.enrollment_subject_id =
                 es.enrollment_subject_id

          WHERE
              so.offering_id = ?

              AND es.enrollment_subject_id = ?

              AND c.department_id = ?

          LIMIT 1

          FOR UPDATE
          `,
          [
            offeringId,
            enrollmentSubjectId,
            programHead.department_id,
          ],
        );

      if (rows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "Student class enrollment was not found or is outside your Program Head department.",
        });
      }

      const record =
        rows[0];

      // ===============================================
      // OFFERING VALIDATION
      // ===============================================

      if (
        record.offering_status ===
        "Cancelled"
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Grades cannot be encoded for a cancelled class.",
        });
      }

      // ===============================================
      // FACULTY MUST BE ASSIGNED
      // ===============================================
      //
      // Your current grade trigger requires:
      //
      // grades.faculty_id =
      // subject_offerings.faculty_id
      //
      // ===============================================

      if (
        record.offering_faculty_id ===
        null
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Direct grade encoding is unavailable because no Faculty is assigned to this offering.",
        });
      }

      // ===============================================
      // ENROLLMENT MUST BE APPROVED
      // ===============================================

      if (
        record.enrollment_status !==
        "Approved"
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Grades can only be encoded for approved enrollments.",
        });
      }

     // ===============================================
// EXISTING GRADE
// ===============================================
//
// Program Head direct encoding must never
// overwrite an existing Faculty/grade record.
//
// ===============================================

if (record.grade_id !== null) {
  await connection.rollback();

  if (
    record.grade_status ===
    "Approved"
  ) {
    return res.status(409).json({
      success: false,
      message:
        "This grade has already been approved and is locked.",
    });
  }

  if (
    record.grade_status ===
    "Submitted"
  ) {
    return res.status(409).json({
      success: false,
      message:
        "A submitted Faculty grade already exists. Use the normal Program Head approve or return workflow.",
    });
  }

  if (
    record.grade_status ===
    "Returned"
  ) {
    return res.status(409).json({
      success: false,
      message:
        "A Returned grade already exists and must continue through the Faculty correction workflow.",
    });
  }

  if (
    record.grade_status ===
    "Draft"
  ) {
    return res.status(409).json({
      success: false,
      message:
        "A Draft Faculty grade already exists. Program Head direct encoding will not overwrite Faculty grade work.",
    });
  }

  return res.status(409).json({
    success: false,
    message:
      `An existing ${record.grade_status} grade already exists and cannot be overwritten.`,
  });
}

// ===============================================
// SUBJECT MUST BE ACTIVE
// ===============================================
//
// Only reached when NO grade exists.
//
// A brand-new Program Head direct grade may only
// be created for an actively Enrolled subject.
//
// ===============================================

if (
  record.enrollment_subject_status !==
  "Enrolled"
) {
  await connection.rollback();

  return res.status(409).json({
    success: false,
    message:
      "This subject already has a finalized academic status and cannot receive a new direct grade.",
  });
}

      // ===============================================
      // 1. INSERT DRAFT
      // ===============================================
      //
      // faculty_id MUST be assigned offering Faculty.
      //
      // It must NOT be programHead.faculty_id.
      //
      // ===============================================

      const [insertResult] =
        await connection.execute(
          `
          INSERT INTO grades (
              enrollment_subject_id,
              faculty_id,

              prelim_grade,
              midterm_grade,
              final_grade,
              final_rating,

              remarks,
              grade_status
          )
          VALUES (
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              'Draft'
          )
          `,
          [
            enrollmentSubjectId,
            record.offering_faculty_id,

            prelimResult.value,
            midtermResult.value,
            finalGradeResult.value,
            finalRatingResult.value,

            remarks,
          ],
        );

      const gradeId =
        insertResult.insertId;

      // ===============================================
      // 2. DRAFT -> SUBMITTED
      // ===============================================
      //
      // Required because DB transition rules do not
      // allow Draft -> Approved directly.
      //
      // ===============================================

      await connection.execute(
        `
        UPDATE grades

        SET
            grade_status = 'Submitted'

        WHERE grade_id = ?
        `,
        [gradeId],
      );

      // ===============================================
      // 3. SUBMITTED -> APPROVED
      // ===============================================
      //
      // reviewed_by identifies the authenticated
      // Program Head user.
      //
      // DB trigger sets reviewed_at.
      //
      // AFTER UPDATE trigger updates:
      //
      // Passed     -> Completed
      // Failed     -> Failed
      // Incomplete -> Incomplete
      //
      // ===============================================

      await connection.execute(
        `
        UPDATE grades

        SET
            grade_status = 'Approved',
            reviewed_by = ?

        WHERE
            grade_id = ?

            AND grade_status =
                'Submitted'
        `,
        [
          programHead.user_id,
          gradeId,
        ],
      );

      // ===============================================
      // READ FINAL RESULT
      // ===============================================

      const [approvedRows] =
        await connection.execute(
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
              reviewer.username
                  AS reviewed_by_username,

              g.reviewed_at,
              g.review_remarks,

              g.created_at,
              g.updated_at,

              es.status
                  AS enrollment_subject_status

          FROM grades g

          INNER JOIN enrollment_subjects es
              ON es.enrollment_subject_id =
                 g.enrollment_subject_id

          LEFT JOIN users reviewer
              ON reviewer.user_id =
                 g.reviewed_by

          WHERE g.grade_id = ?

          LIMIT 1
          `,
          [gradeId],
        );

      const approved =
        approvedRows[0];

      // ===============================================
      // COMMIT
      // ===============================================

      await connection.commit();

      // ===============================================
      // RESPONSE
      // ===============================================

      return res.status(200).json({
        success: true,

        message:
          "Grade encoded and approved successfully by Program Head.",

        program_head: {
          program_head_id:
            programHead.program_head_id,

          user_id:
            programHead.user_id,

          program_head_name:
            programHead.program_head_name,

          department: {
            department_id:
              programHead.department_id,

            department_code:
              programHead.department_code,

            department_name:
              programHead.department_name,
          },
        },

        student: {
          enrollment_subject_id:
            Number(
              record.enrollment_subject_id,
            ),

          enrollment_id:
            Number(
              record.enrollment_id,
            ),

          student_id:
            Number(
              record.student_id,
            ),

          student_number:
            record.student_number,

          full_name: [
            record.first_name,
            record.middle_name,
            record.last_name,
          ]
            .filter(Boolean)
            .join(" "),
        },

        class: {
          offering_id:
            Number(
              record.offering_id,
            ),

          subject: {
            subject_id:
              Number(
                record.subject_id,
              ),

            subject_code:
              record.subject_code,

            subject_name:
              record.subject_name,
          },

          section: {
            section_id:
              Number(
                record.section_id,
              ),

            section_name:
              record.section_name,

            course: {
              course_id:
                Number(
                  record.course_id,
                ),

              course_code:
                record.course_code,

              course_name:
                record.course_name,
            },
          },

          assigned_faculty_id:
            Number(
              record.offering_faculty_id,
            ),
        },

        grade: {
          grade_id:
            Number(
              approved.grade_id,
            ),

          enrollment_subject_id:
            Number(
              approved.enrollment_subject_id,
            ),

          faculty_id:
            Number(
              approved.faculty_id,
            ),

          prelim_grade:
            approved.prelim_grade !== null
              ? Number(
                  approved.prelim_grade,
                )
              : null,

          midterm_grade:
            approved.midterm_grade !== null
              ? Number(
                  approved.midterm_grade,
                )
              : null,

          final_grade:
            approved.final_grade !== null
              ? Number(
                  approved.final_grade,
                )
              : null,

          final_rating:
            approved.final_rating !== null
              ? Number(
                  approved.final_rating,
                )
              : null,

          remarks:
            approved.remarks,

          grade_status:
            approved.grade_status,

          submitted_at:
            approved.submitted_at,

          reviewed_by:
            approved.reviewed_by,

          reviewed_by_username:
            approved.reviewed_by_username,

          reviewed_at:
            approved.reviewed_at,

          review_remarks:
            approved.review_remarks,

          subject_status:
            approved
              .enrollment_subject_status,

          created_at:
            approved.created_at,

          updated_at:
            approved.updated_at,
        },
      });
    } catch (error) {
      if (connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error(
            "PROGRAM HEAD DIRECT GRADE ROLLBACK ERROR:",
            rollbackError,
          );
        }
      }

      console.error(
        "PUT /api/program-head/classes/:offeringId/grades/:enrollmentSubjectId/direct-approve error:",
        error,
      );

      // ===============================================
      // DATABASE BUSINESS-RULE ERROR
      // ===============================================

      if (
        error?.errno === 1644 ||
        error?.sqlState === "45000"
      ) {
        return res.status(409).json({
          success: false,

          message:
            error.sqlMessage ||
            error.message ||
            "Grade operation was rejected by the database.",
        });
      }

      if (
        error?.code ===
        "ER_DUP_ENTRY"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "A grade already exists for this enrollment subject.",
        });
      }

      return res.status(500).json({
        success: false,
        message:
          "Failed to directly encode and approve grade.",
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  },
);


export default router;