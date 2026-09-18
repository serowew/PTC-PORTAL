// routes/faculty/classes.js
//
// =====================================================
// FACULTY CLASS MANAGEMENT
// =====================================================
//
// Responsibility:
//
// Authenticated Faculty
//        ↓
// Resolve faculty profile
//        ↓
// subject_offerings.faculty_id
//        ↓
// Assigned Classes
//
// IMPORTANT:
//
// - Faculty identity comes ONLY from req.user.
// - Never accept faculty_id from query/body/frontend.
// - subject_offerings is the authoritative teaching
//   assignment created by Registrar.
// - Closed offerings may still appear because Closed
//   means enrollment is no longer accepting placement.
// - Cancelled offerings are excluded from the normal
//   active class list.
// - Official student count includes APPROVED
//   enrollments only.
// =====================================================

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
// GET AUTHENTICATED FACULTY
// =====================================================

async function getAuthenticatedFaculty(req, res) {
  // -------------------------------------------------
  // AUTHENTICATION
  // -------------------------------------------------

  if (!req.user) {
    res.status(401).json({
      success: false,
      message: "Authentication is required.",
    });

    return null;
  }

  // -------------------------------------------------
  // ROLE
  // -------------------------------------------------

  if (req.user.role_name !== "Faculty") {
    res.status(403).json({
      success: false,
      message: "Faculty access is required.",
    });

    return null;
  }

  // -------------------------------------------------
  // AUTHENTICATED USER ID
  // -------------------------------------------------

  const userId = toPositiveInt(req.user.user_id);

  if (!userId) {
    res.status(401).json({
      success: false,
      message: "Authenticated Faculty user ID is invalid.",
    });

    return null;
  }

  // -------------------------------------------------
  // FACULTY PROFILE
  //
  // IMPORTANT:
  // faculty_id is resolved from the authenticated
  // user account.
  //
  // We never trust a faculty_id sent by the client.
  // -------------------------------------------------

  const [facultyRows] = await db.execute(
    `
    SELECT
        f.faculty_id,
        f.user_id,
        f.employee_number,

        f.first_name,
        f.middle_name,
        f.last_name,

        f.email,
        f.contact_number,

        f.department_id,
        f.employment_status,
        f.hire_date,

        u.username

    FROM faculty f

    INNER JOIN users u
        ON u.user_id = f.user_id

    WHERE f.user_id = ?

    LIMIT 1
    `,
    [userId],
  );

  if (facultyRows.length === 0) {
    res.status(404).json({
      success: false,
      message:
        "No Faculty profile is connected to this account.",
    });

    return null;
  }

  const row = facultyRows[0];

  return {
    faculty_id: Number(row.faculty_id),
    user_id: Number(row.user_id),

    employee_number: row.employee_number,

    username: row.username,

    first_name: row.first_name,
    middle_name: row.middle_name,
    last_name: row.last_name,

    faculty_name: [
      row.first_name,
      row.middle_name,
      row.last_name,
    ]
      .filter(Boolean)
      .join(" "),

    email: row.email || null,
    contact_number: row.contact_number || null,

    department_id:
      row.department_id !== null &&
      row.department_id !== undefined
        ? Number(row.department_id)
        : null,

    employment_status:
      row.employment_status || null,

    hire_date: row.hire_date || null,
  };
}

// =====================================================
// GET MY CLASSES
//
// GET /api/faculty/classes
//
// Optional query:
//
// ?academic_year_id=2
// ?semester_id=2
//
// or:
//
// ?academic_year_id=2&semester_id=2
//
// RULES:
//
// 1. Faculty comes from JWT.
// 2. Only subject_offerings assigned to that Faculty.
// 3. Cancelled offerings are excluded.
// 4. Open AND Closed offerings may appear.
// 5. Student count is based ONLY on:
//
//      enrollment_status = Approved
//      enrollment_subject status = Enrolled
//
// Pending students must NOT appear in Faculty counts.
// =====================================================

router.get("/", async (req, res) => {
  try {
    // =================================================
    // 1. AUTHENTICATED FACULTY
    // =================================================

    const faculty = await getAuthenticatedFaculty(
      req,
      res,
    );

    if (!faculty) {
      return;
    }

    const facultyId = faculty.faculty_id;

    // =================================================
    // 2. OPTIONAL FILTERS
    // =================================================

    const rawAcademicYearId =
      req.query.academic_year_id;

    const rawSemesterId =
      req.query.semester_id;

    let academicYearId = null;
    let semesterId = null;

    // -------------------------------------------------
    // ACADEMIC YEAR
    // -------------------------------------------------

    if (
      rawAcademicYearId !== undefined &&
      rawAcademicYearId !== null &&
      String(rawAcademicYearId).trim() !== ""
    ) {
      academicYearId =
        toPositiveInt(rawAcademicYearId);

      if (!academicYearId) {
        return res.status(400).json({
          success: false,
          message: "Invalid academic year ID.",
        });
      }
    }

    // -------------------------------------------------
    // SEMESTER
    // -------------------------------------------------

    if (
      rawSemesterId !== undefined &&
      rawSemesterId !== null &&
      String(rawSemesterId).trim() !== ""
    ) {
      semesterId = toPositiveInt(rawSemesterId);

      if (!semesterId) {
        return res.status(400).json({
          success: false,
          message: "Invalid semester ID.",
        });
      }
    }

    // =================================================
    // 3. BUILD FILTER
    // =================================================

    const conditions = [
      "so.faculty_id = ?",
      "so.status <> 'Cancelled'",
    ];

    const params = [facultyId];

    if (academicYearId) {
      conditions.push(
        "so.academic_year_id = ?",
      );

      params.push(academicYearId);
    }

    if (semesterId) {
      conditions.push("so.semester_id = ?");

      params.push(semesterId);
    }

    // =================================================
    // 4. GET ASSIGNED CLASSES
    //
    // IMPORTANT:
    //
    // This query intentionally does NOT require:
    //
    //     so.status = 'Open'
    //
    // because a Closed offering may still be an actual
    // class that Faculty needs for roster/grade work.
    //
    // Only Cancelled offerings are excluded from this
    // normal active list.
    // =================================================

const [classRows] = await db.execute(
  `
  SELECT
      so.offering_id,
      so.section_subject_id,

      so.status AS offering_status,

      so.schedule_days,
      so.schedule_time,
      so.max_students,
      so.created_at,

      sub.subject_id,
      sub.subject_code,
      sub.subject_name,
      sub.units,
      sub.lecture_hours,
      sub.laboratory_hours,

      ss.status AS section_subject_status,

      sec.section_id,
      sec.section_name,
      sec.year_level,

      c.course_id,
      c.course_code,
      c.course_name,

      ay.academic_year_id,
      ay.academic_year,
      ay.is_current AS academic_year_is_current,

      sem.semester_id,
      sem.semester_name,

      r.room_id,
      r.room_code,
      r.room_name,

      (
          SELECT COUNT(*)

          FROM enrollment_subjects es_count

          INNER JOIN enrollments e_count
              ON e_count.enrollment_id = es_count.enrollment_id

          WHERE es_count.offering_id = so.offering_id

            AND es_count.status = 'Enrolled'

            AND e_count.enrollment_status = 'Approved'
      ) AS official_student_count

  FROM subject_offerings so

  INNER JOIN section_subjects ss
      ON ss.section_subject_id = so.section_subject_id

  INNER JOIN subjects sub
      ON sub.subject_id = so.subject_id

  INNER JOIN sections sec
      ON sec.section_id = so.section_id

  INNER JOIN courses c
      ON c.course_id = sec.course_id

  INNER JOIN academic_years ay
      ON ay.academic_year_id = so.academic_year_id

  INNER JOIN semesters sem
      ON sem.semester_id = so.semester_id

  LEFT JOIN rooms r
      ON r.room_id = so.room_id

  WHERE
      ${conditions.join("\n      AND ")}

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
    // 5. FORMAT CLASSES
    // =================================================

    const classes = classRows.map((row) => {
      const officialStudentCount = Number(
        row.official_student_count || 0,
      );

      const maxStudents = Number(
        row.max_students || 0,
      );

      return {
        offering_id: Number(row.offering_id),

        section_subject_id: Number(
          row.section_subject_id,
        ),

        offering_status:
          row.offering_status,

        section_subject_status:
          row.section_subject_status,

        subject: {
          subject_id: Number(row.subject_id),

          subject_code:
            row.subject_code,

          subject_name:
            row.subject_name,

          units: Number(row.units || 0),

          lecture_hours: Number(
            row.lecture_hours || 0,
          ),

          laboratory_hours: Number(
            row.laboratory_hours || 0,
          ),
        },

        section: {
          section_id: Number(
            row.section_id,
          ),

          section_name:
            row.section_name,

          year_level: Number(
            row.year_level || 0,
          ),

          course: {
            course_id: Number(
              row.course_id,
            ),

            course_code:
              row.course_code,

            course_name:
              row.course_name,
          },
        },

        academic_period: {
          academic_year_id: Number(
            row.academic_year_id,
          ),

          academic_year:
            row.academic_year,

          is_current_academic_year:
            Boolean(
              Number(
                row.academic_year_is_current,
              ),
            ),

          semester_id: Number(
            row.semester_id,
          ),

          semester_name:
            row.semester_name,
        },

        schedule: {
          days:
            row.schedule_days || null,

          time:
            row.schedule_time || null,
        },

        room:
          row.room_id
            ? {
                room_id: Number(
                  row.room_id,
                ),

                room_code:
                  row.room_code || null,

                room_name:
                  row.room_name || null,
              }
            : null,

        capacity: {
          max_students: maxStudents,

          official_students:
            officialStudentCount,
        },

        created_at:
          row.created_at,
      };
    });

    // =================================================
    // 6. SUMMARY
    // =================================================

    const totalOfficialStudents =
      classes.reduce(
        (total, item) =>
          total +
          item.capacity.official_students,
        0,
      );

    const openClasses =
      classes.filter(
        (item) =>
          item.offering_status === "Open",
      ).length;

    const closedClasses =
      classes.filter(
        (item) =>
          item.offering_status === "Closed",
      ).length;

    // =================================================
    // 7. SUCCESS
    // =================================================

    return res.status(200).json({
      success: true,

      faculty,

      filters: {
        academic_year_id:
          academicYearId,

        semester_id:
          semesterId,
      },

      summary: {
        total_classes:
          classes.length,

        open_classes:
          openClasses,

        closed_classes:
          closedClasses,

        total_official_students:
          totalOfficialStudents,
      },

      classes,
    });
  } catch (error) {
    console.error(
      "GET FACULTY CLASSES ERROR:",
      error,
    );

    return res.status(500).json({
      success: false,

      message:
        "Failed to load Faculty classes.",

      error:
        process.env.NODE_ENV ===
        "development"
          ? error.message
          : undefined,
    });
  }
});

// =====================================================
// GET FACULTY CLASS STUDENTS
// =====================================================
//
// GET /api/faculty/classes/:offeringId/students
//
// Purpose:
// Returns the official student roster for one class
// assigned to the authenticated Faculty.
//
// IMPORTANT RULES:
//
// 1. Faculty identity comes from JWT.
// 2. Faculty cannot provide faculty_id manually.
// 3. Faculty can only access their own offering.
// 4. Open and Closed offerings are accessible.
// 5. Cancelled offerings are not part of the active
//    Faculty teaching workflow.
// 6. Only APPROVED enrollments appear.
// 7. Only enrollment_subjects with status Enrolled appear.
// 8. Pending students MUST NOT appear.
//
// =====================================================

router.get("/:offeringId/students", async (req, res) => {
  try {
    // =================================================
    // AUTHENTICATED FACULTY
    // =================================================

    const faculty = await getAuthenticatedFaculty(req, res);

    if (!faculty) {
      return;
    }

    // =================================================
    // VALIDATE OFFERING ID
    // =================================================

    const offeringId = Number(req.params.offeringId);

    if (
      !Number.isInteger(offeringId) ||
      offeringId <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid offering ID.",
      });
    }

    // =================================================
    // FIND CLASS + VERIFY OWNERSHIP
    // =================================================
    //
    // We deliberately do NOT filter only status = Open.
    //
    // A Closed offering may still be an active Faculty
    // class. Closed only means Registrar enrollment
    // placement is closed.
    //
    // =================================================

    const [offeringRows] = await db.execute(
      `
      SELECT
          so.offering_id,
          so.section_subject_id,
          so.subject_id,
          so.section_id,
          so.faculty_id,
          so.academic_year_id,
          so.semester_id,

          so.schedule_days,
          so.schedule_time,
          so.max_students,

          so.status AS offering_status,
          so.created_at,

          ss.status AS section_subject_status,

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

          ay.academic_year,
          ay.is_current AS academic_year_is_current,

          sem.semester_name,

          r.room_id,
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

      LEFT JOIN rooms r
          ON r.room_id =
             so.room_id

      WHERE
          so.offering_id = ?
          AND so.faculty_id = ?

      LIMIT 1
      `,
      [
        offeringId,
        faculty.faculty_id,
      ],
    );

    // =================================================
    // OFFERING NOT FOUND / NOT OWNED
    // =================================================
    //
    // We intentionally use the same response when the
    // offering does not exist OR belongs to another
    // Faculty.
    //
    // This prevents Faculty users from discovering
    // another Faculty's class information.
    //
    // =================================================

    if (offeringRows.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "Class not found or is not assigned to you.",
      });
    }

    const offering = offeringRows[0];

    // =================================================
    // CANCELLED OFFERING
    // =================================================

    if (offering.offering_status === "Cancelled") {
      return res.status(409).json({
        success: false,
        message:
          "This class offering has been cancelled.",
      });
    }

    // =================================================
    // GET OFFICIAL STUDENT ROSTER
    // =================================================
    //
    // enrollment_subjects = exact class placement
    //
    // enrollments = official enrollment approval
    //
    // We DO NOT use students.section_id to determine
    // membership in this class.
    //
    // =================================================

    const [studentRows] = await db.execute(
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

          u.email

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

      WHERE
          es.offering_id = ?

          AND es.subject_id = ?

          AND es.section_id = ?

          AND es.status = 'Enrolled'

          AND e.enrollment_status = 'Approved'

          AND e.academic_year_id = ?

          AND e.semester_id = ?

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

    // =================================================
    // FORMAT STUDENTS
    // =================================================

    const students = studentRows.map((student) => ({
      enrollment_subject_id:
        student.enrollment_subject_id,

      enrollment_id:
        student.enrollment_id,

      student_id:
        student.student_id,

      student_number:
        student.student_number,

      first_name:
        student.first_name,

      middle_name:
        student.middle_name,

      last_name:
        student.last_name,

      full_name: [
        student.first_name,
        student.middle_name,
        student.last_name,
      ]
        .filter(Boolean)
        .join(" "),

      email:
        student.email,

      enrollment_status:
        student.enrollment_status,

      subject_status:
        student.enrollment_subject_status,
    }));

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      faculty: {
        faculty_id:
          faculty.faculty_id,

        employee_number:
          faculty.employee_number,

        faculty_name:
          faculty.faculty_name,
      },

      class: {
        offering_id:
          offering.offering_id,

        section_subject_id:
          offering.section_subject_id,

        offering_status:
          offering.offering_status,

        section_subject_status:
          offering.section_subject_status,

        subject: {
          subject_id:
            offering.subject_id,

          subject_code:
            offering.subject_code,

          subject_name:
            offering.subject_name,

          units:
            Number(offering.units),

          lecture_hours:
            Number(offering.lecture_hours),

          laboratory_hours:
            Number(offering.laboratory_hours),
        },

        section: {
          section_id:
            offering.section_id,

          section_name:
            offering.section_name,

          year_level:
            offering.year_level,

          course: {
            course_id:
              offering.course_id,

            course_code:
              offering.course_code,

            course_name:
              offering.course_name,
          },
        },

        academic_period: {
          academic_year_id:
            offering.academic_year_id,

          academic_year:
            offering.academic_year,

          is_current_academic_year:
            Boolean(
              offering.academic_year_is_current,
            ),

          semester_id:
            offering.semester_id,

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
          offering.room_id
            ? {
                room_id:
                  offering.room_id,

                room_code:
                  offering.room_code,

                room_name:
                  offering.room_name,
              }
            : null,

        capacity: {
          max_students:
            Number(offering.max_students),

          official_students:
            students.length,
        },
      },

      summary: {
        official_students:
          students.length,
      },

      students,
    });
  } catch (error) {
    console.error(
      "GET /api/faculty/classes/:offeringId/students error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to retrieve class students.",
    });
  }
});

// =====================================================
// GET FACULTY CLASS GRADEBOOK
// =====================================================
//
// GET /api/faculty/classes/:offeringId/gradebook
//
// Purpose:
// Returns the official students of one Faculty class
// together with their current grade record.
//
// IMPORTANT:
//
// - Faculty identity comes from JWT.
// - Faculty can only access their own offering.
// - Open and Closed offerings are accessible.
// - Cancelled offerings are rejected.
// - Enrollment must be Approved.
// - Grade is linked through enrollment_subject_id.
// - A missing grade row is returned as grade: null.
// - We do NOT create grade rows during GET.
//
// =====================================================

router.get("/:offeringId/gradebook", async (req, res) => {
  try {
    // =================================================
    // AUTHENTICATED FACULTY
    // =================================================

    const faculty = await getAuthenticatedFaculty(req, res);

    if (!faculty) {
      return;
    }

    // =================================================
    // VALIDATE OFFERING ID
    // =================================================

    const offeringId = Number(req.params.offeringId);

    if (
      !Number.isInteger(offeringId) ||
      offeringId <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid offering ID.",
      });
    }

    // =================================================
    // VERIFY CLASS OWNERSHIP
    // =================================================

    const [offeringRows] = await db.execute(
      `
      SELECT
          so.offering_id,
          so.section_subject_id,
          so.subject_id,
          so.section_id,
          so.faculty_id,
          so.academic_year_id,
          so.semester_id,

          so.schedule_days,
          so.schedule_time,
          so.max_students,

          so.status AS offering_status,
          so.created_at,

          ss.status AS section_subject_status,

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

          ay.academic_year,
          ay.is_current AS academic_year_is_current,

          sem.semester_name,

          r.room_id,
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

      LEFT JOIN rooms r
          ON r.room_id =
             so.room_id

      WHERE
          so.offering_id = ?
          AND so.faculty_id = ?

      LIMIT 1
      `,
      [
        offeringId,
        faculty.faculty_id,
      ],
    );

    // =================================================
    // NOT FOUND / NOT OWNED
    // =================================================

    if (offeringRows.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "Class not found or is not assigned to you.",
      });
    }

    const offering = offeringRows[0];

    // =================================================
    // CANCELLED OFFERING
    // =================================================

    if (offering.offering_status === "Cancelled") {
      return res.status(409).json({
        success: false,
        message:
          "This class offering has been cancelled.",
      });
    }

    // =================================================
    // GET OFFICIAL STUDENTS + GRADES
    // =================================================
    //
    // IMPORTANT:
    //
    // We allow:
    //
    // Enrolled
    // Completed
    // Failed
    // Incomplete
    //
    // because when a grade becomes Approved, your
    // database trigger changes enrollment_subjects.status
    // from Enrolled into one of those final statuses.
    //
    // If we filtered only status = 'Enrolled', an
    // approved student would disappear from the
    // gradebook after approval.
    //
    // Dropped / Withdrawn students are excluded.
    //
    // =================================================

    const [rows] = await db.execute(
      `
      SELECT
          es.enrollment_subject_id,
          es.enrollment_id,
          es.status AS enrollment_subject_status,

          e.student_id,
          e.enrollment_status,

          s.student_number,
          s.first_name,
          s.middle_name,
          s.last_name,

          u.email,

          g.grade_id,
          g.faculty_id AS grade_faculty_id,

          g.prelim_grade,
          g.midterm_grade,
          g.final_grade,
          g.final_rating,

          g.remarks,
          g.grade_status,

          g.submitted_at,

          g.reviewed_by,
          reviewer.username AS reviewed_by_username,

          g.reviewed_at,
          g.review_remarks,

          g.created_at AS grade_created_at,
          g.updated_at AS grade_updated_at

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

          AND e.enrollment_status = 'Approved'

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

    // =================================================
    // FORMAT STUDENTS
    // =================================================

    const students = rows.map((row) => {
      const hasGrade = row.grade_id !== null;

      return {
        enrollment_subject_id:
          row.enrollment_subject_id,

        enrollment_id:
          row.enrollment_id,

        student_id:
          row.student_id,

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

        grade: hasGrade
          ? {
              grade_id:
                row.grade_id,

              faculty_id:
                row.grade_faculty_id,

              prelim_grade:
                row.prelim_grade !== null
                  ? Number(row.prelim_grade)
                  : null,

              midterm_grade:
                row.midterm_grade !== null
                  ? Number(row.midterm_grade)
                  : null,

              final_grade:
                row.final_grade !== null
                  ? Number(row.final_grade)
                  : null,

              final_rating:
                row.final_rating !== null
                  ? Number(row.final_rating)
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

    // =================================================
    // GRADEBOOK SUMMARY
    // =================================================

    const summary = {
      total_students:
        students.length,

      without_grade:
        students.filter(
          (student) => student.grade === null,
        ).length,

      draft:
        students.filter(
          (student) =>
            student.grade?.grade_status === "Draft",
        ).length,

      submitted:
        students.filter(
          (student) =>
            student.grade?.grade_status === "Submitted",
        ).length,

      returned:
        students.filter(
          (student) =>
            student.grade?.grade_status === "Returned",
        ).length,

      approved:
        students.filter(
          (student) =>
            student.grade?.grade_status === "Approved",
        ).length,
    };

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      faculty: {
        faculty_id:
          faculty.faculty_id,

        employee_number:
          faculty.employee_number,

        faculty_name:
          faculty.faculty_name,
      },

      class: {
        offering_id:
          offering.offering_id,

        section_subject_id:
          offering.section_subject_id,

        offering_status:
          offering.offering_status,

        section_subject_status:
          offering.section_subject_status,

        subject: {
          subject_id:
            offering.subject_id,

          subject_code:
            offering.subject_code,

          subject_name:
            offering.subject_name,

          units:
            Number(offering.units),

          lecture_hours:
            Number(offering.lecture_hours),

          laboratory_hours:
            Number(offering.laboratory_hours),
        },

        section: {
          section_id:
            offering.section_id,

          section_name:
            offering.section_name,

          year_level:
            offering.year_level,

          course: {
            course_id:
              offering.course_id,

            course_code:
              offering.course_code,

            course_name:
              offering.course_name,
          },
        },

        academic_period: {
          academic_year_id:
            offering.academic_year_id,

          academic_year:
            offering.academic_year,

          is_current_academic_year:
            Boolean(
              offering.academic_year_is_current,
            ),

          semester_id:
            offering.semester_id,

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
          offering.room_id
            ? {
                room_id:
                  offering.room_id,

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
      "GET /api/faculty/classes/:offeringId/gradebook error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to retrieve class gradebook.",
    });
  }
});


// =====================================================
// SAVE FACULTY DRAFT GRADE
// =====================================================
//
// PUT
// /api/faculty/classes/:offeringId
//                    /grades/:enrollmentSubjectId/draft
//
// Creates a new Draft grade or updates an existing
// editable grade.
//
// Editable:
// - Draft
// - Returned
//
// Locked:
// - Submitted
// - Approved
//
// IMPORTANT:
// faculty_id comes from authenticated Faculty.
// enrollment_subject_id comes from the URL.
// student/subject/enrollment identity is derived from DB.
//
// =====================================================

router.put(
  "/:offeringId/grades/:enrollmentSubjectId/draft",
  async (req, res) => {
    try {
      // ===============================================
      // AUTHENTICATED FACULTY
      // ===============================================

      const faculty = await getAuthenticatedFaculty(
        req,
        res,
      );

      if (!faculty) {
        return;
      }

      // ===============================================
      // VALIDATE IDS
      // ===============================================

      const offeringId = Number(
        req.params.offeringId,
      );

      const enrollmentSubjectId = Number(
        req.params.enrollmentSubjectId,
      );

      if (
        !Number.isInteger(offeringId) ||
        offeringId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid offering ID.",
        });
      }

      if (
        !Number.isInteger(enrollmentSubjectId) ||
        enrollmentSubjectId <= 0
      ) {
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
      // NORMALIZE OPTIONAL NUMERIC VALUES
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

        const numericValue = Number(value);

        if (!Number.isFinite(numericValue)) {
          return {
            valid: false,
            message: `${fieldName} must be a valid number.`,
          };
        }

        return {
          valid: true,
          value: numericValue,
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
          message: prelimResult.message,
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
          message: midtermResult.message,
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
          message: finalGradeResult.message,
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
          message: finalRatingResult.message,
        });
      }

      // ===============================================
      // VALIDATE REMARKS
      // ===============================================

      let normalizedRemarks = null;

      if (
        remarks !== null &&
        remarks !== undefined &&
        remarks !== ""
      ) {
        const allowedRemarks = [
          "Passed",
          "Failed",
          "Incomplete",
        ];

        if (!allowedRemarks.includes(remarks)) {
          return res.status(400).json({
            success: false,
            message:
              "Remarks must be Passed, Failed, Incomplete, or null.",
          });
        }

        normalizedRemarks = remarks;
      }

      // ===============================================
      // VERIFY CLASS + STUDENT MEMBERSHIP
      // ===============================================
      //
      // This simultaneously proves:
      //
      // 1. offering belongs to this Faculty
      // 2. enrollment subject belongs to this offering
      // 3. enrollment is Approved
      // 4. subject is currently Enrolled
      //
      // ===============================================

      const [membershipRows] =
        await db.execute(
          `
          SELECT
              so.offering_id,
              so.faculty_id,
              so.status AS offering_status,

              sub.subject_id,
              sub.subject_code,
              sub.subject_name,

              sec.section_id,
              sec.section_name,

              es.enrollment_subject_id,
              es.enrollment_id,
              es.status
                  AS enrollment_subject_status,

              e.student_id,
              e.enrollment_status,

              s.student_number,
              s.first_name,
              s.middle_name,
              s.last_name

          FROM subject_offerings so

          INNER JOIN subjects sub
              ON sub.subject_id =
                 so.subject_id

          INNER JOIN sections sec
              ON sec.section_id =
                 so.section_id

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

          WHERE
              so.offering_id = ?

              AND so.faculty_id = ?

              AND es.enrollment_subject_id = ?

          LIMIT 1
          `,
          [
            offeringId,
            faculty.faculty_id,
            enrollmentSubjectId,
          ],
        );

      if (membershipRows.length === 0) {
        return res.status(404).json({
          success: false,
          message:
            "Student class enrollment was not found or is not assigned to you.",
        });
      }

      const membership = membershipRows[0];

      // ===============================================
      // OFFERING MUST NOT BE CANCELLED
      // ===============================================

      if (
        membership.offering_status ===
        "Cancelled"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Grades cannot be saved for a cancelled class.",
        });
      }

      // ===============================================
      // ENROLLMENT MUST BE APPROVED
      // ===============================================

      if (
        membership.enrollment_status !==
        "Approved"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Grades can only be saved for an approved enrollment.",
        });
      }

      // ===============================================
// CHECK EXISTING GRADE
// ===============================================
//
// IMPORTANT:
//
// We must check the existing grade BEFORE checking
// enrollment_subject_status.
//
// Why?
//
// Approved Passed grades automatically change:
//
// enrollment_subjects.status
// Enrolled -> Completed
//
// So if we check "Enrolled" first, an Approved grade
// gets the wrong error:
//
// "subject is no longer actively enrolled"
//
// Instead:
//
// Approved  -> locked
// Submitted -> locked
// Draft     -> editable only while Enrolled
// Returned  -> editable only while Enrolled
// No grade  -> creatable only while Enrolled
//
// ===============================================

const [existingRows] =
  await db.execute(
    `
    SELECT
        grade_id,
        enrollment_subject_id,
        faculty_id,

        prelim_grade,
        midterm_grade,
        final_grade,
        final_rating,

        remarks,
        grade_status,

        submitted_at,
        reviewed_by,
        reviewed_at,
        review_remarks,

        created_at,
        updated_at

    FROM grades

    WHERE enrollment_subject_id = ?

    LIMIT 1
    `,
    [enrollmentSubjectId],
  );

let gradeId;
let resultingStatus;

const existingGrade =
  existingRows.length > 0
    ? existingRows[0]
    : null;

// ===============================================
// EXISTING GRADE SECURITY + STATUS LOCKS
// ===============================================

if (existingGrade) {
  // =============================================
  // FACULTY OWNERSHIP CONSISTENCY
  // =============================================

  if (
    existingGrade.faculty_id !== null &&
    Number(existingGrade.faculty_id) !==
      Number(faculty.faculty_id)
  ) {
    return res.status(403).json({
      success: false,
      message:
        "This grade belongs to another Faculty assignment.",
    });
  }

  // =============================================
  // APPROVED IS PERMANENTLY LOCKED
  // =============================================

  if (
    existingGrade.grade_status ===
    "Approved"
  ) {
    return res.status(409).json({
      success: false,
      message:
        "This grade has already been approved and is locked.",
    });
  }

  // =============================================
  // SUBMITTED IS LOCKED FOR FACULTY
  // =============================================

  if (
    existingGrade.grade_status ===
    "Submitted"
  ) {
    return res.status(409).json({
      success: false,
      message:
        "This grade has already been submitted and cannot be edited unless it is returned by the Program Head.",
    });
  }
}

// ===============================================
// SUBJECT MUST STILL BE ENROLLED
// ===============================================
//
// We only reach this point for:
//
// - new grade
// - Draft
// - Returned
//
// Approved and Submitted already exited above.
//
// Draft/Returned editing requires an active
// enrollment_subject status of Enrolled.
//
// ===============================================

if (
  membership.enrollment_subject_status !==
  "Enrolled"
) {
  return res.status(409).json({
    success: false,
    message:
      "This subject is no longer actively enrolled and cannot be edited.",
  });
}

// ===============================================
// CREATE NEW DRAFT
// ===============================================

if (!existingGrade) {
  const [insertResult] =
    await db.execute(
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
        faculty.faculty_id,

        prelimResult.value,
        midtermResult.value,
        finalGradeResult.value,
        finalRatingResult.value,

        normalizedRemarks,
      ],
    );

  gradeId = insertResult.insertId;
  resultingStatus = "Draft";
} else {
  // =============================================
  // DRAFT OR RETURNED CAN BE EDITED
  // =============================================
  //
  // Returned stays Returned while Faculty makes
  // corrections.
  //
  // Allowed:
  //
  // Draft    -> Draft
  // Returned -> Returned
  //
  // Submission is handled by the separate
  // /submit endpoint.
  //
  // =============================================

  resultingStatus =
    existingGrade.grade_status;

  await db.execute(
    `
    UPDATE grades

    SET
        faculty_id = ?,

        prelim_grade = ?,
        midterm_grade = ?,
        final_grade = ?,
        final_rating = ?,

        remarks = ?,

        grade_status = ?

    WHERE grade_id = ?
    `,
    [
      faculty.faculty_id,

      prelimResult.value,
      midtermResult.value,
      finalGradeResult.value,
      finalRatingResult.value,

      normalizedRemarks,

      resultingStatus,

      existingGrade.grade_id,
    ],
  );

  gradeId = existingGrade.grade_id;
}

      // ===============================================
      // READ SAVED GRADE
      // ===============================================

      const [savedRows] = await db.execute(
        `
        SELECT
            grade_id,
            enrollment_subject_id,
            faculty_id,

            prelim_grade,
            midterm_grade,
            final_grade,
            final_rating,

            remarks,
            grade_status,

            submitted_at,
            reviewed_by,
            reviewed_at,
            review_remarks,

            created_at,
            updated_at

        FROM grades

        WHERE grade_id = ?

        LIMIT 1
        `,
        [gradeId],
      );

      const saved = savedRows[0];

      // ===============================================
      // RESPONSE
      // ===============================================

      return res.status(200).json({
        success: true,

        message:
          resultingStatus === "Returned"
            ? "Returned grade corrections saved."
            : "Draft grade saved successfully.",

        student: {
          enrollment_subject_id:
            membership.enrollment_subject_id,

          enrollment_id:
            membership.enrollment_id,

          student_id:
            membership.student_id,

          student_number:
            membership.student_number,

          full_name: [
            membership.first_name,
            membership.middle_name,
            membership.last_name,
          ]
            .filter(Boolean)
            .join(" "),
        },

        class: {
          offering_id:
            membership.offering_id,

          subject: {
            subject_id:
              membership.subject_id,

            subject_code:
              membership.subject_code,

            subject_name:
              membership.subject_name,
          },

          section: {
            section_id:
              membership.section_id,

            section_name:
              membership.section_name,
          },
        },

        grade: {
          grade_id:
            saved.grade_id,

          enrollment_subject_id:
            saved.enrollment_subject_id,

          faculty_id:
            saved.faculty_id,

          prelim_grade:
            saved.prelim_grade !== null
              ? Number(saved.prelim_grade)
              : null,

          midterm_grade:
            saved.midterm_grade !== null
              ? Number(saved.midterm_grade)
              : null,

          final_grade:
            saved.final_grade !== null
              ? Number(saved.final_grade)
              : null,

          final_rating:
            saved.final_rating !== null
              ? Number(saved.final_rating)
              : null,

          remarks:
            saved.remarks,

          grade_status:
            saved.grade_status,

          submitted_at:
            saved.submitted_at,

          reviewed_by:
            saved.reviewed_by,

          reviewed_at:
            saved.reviewed_at,

          review_remarks:
            saved.review_remarks,

          created_at:
            saved.created_at,

          updated_at:
            saved.updated_at,
        },
      });
    } catch (error) {
      console.error(
        "PUT /api/faculty/classes/:offeringId/grades/:enrollmentSubjectId/draft error:",
        error,
      );

      // ===============================================
      // DATABASE BUSINESS-RULE ERROR
      // ===============================================
      //
      // Your grade triggers use SQLSTATE 45000.
      //
      // mysql2 normally exposes that as errno 1644.
      //
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

      // Duplicate enrollment_subject_id
      if (error?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          success: false,
          message:
            "A grade record already exists for this enrollment subject.",
        });
      }

      return res.status(500).json({
        success: false,
        message:
          "Failed to save draft grade.",
      });
    }
  },
);

// =====================================================
// SUBMIT FACULTY GRADE
// =====================================================
//
// PATCH
// /api/faculty/classes/:offeringId
//                    /grades/:enrollmentSubjectId/submit
//
// No request body is required.
//
// Allowed:
//
// Draft    -> Submitted
// Returned -> Submitted
//
// Not allowed:
//
// Submitted -> Submitted
// Approved  -> anything
//
// =====================================================

router.patch(
  "/:offeringId/grades/:enrollmentSubjectId/submit",
  async (req, res) => {
    try {
      // ===============================================
      // AUTHENTICATED FACULTY
      // ===============================================

      const faculty = await getAuthenticatedFaculty(
        req,
        res,
      );

      if (!faculty) {
        return;
      }

      // ===============================================
      // VALIDATE IDS
      // ===============================================

      const offeringId = Number(
        req.params.offeringId,
      );

      const enrollmentSubjectId = Number(
        req.params.enrollmentSubjectId,
      );

      if (
        !Number.isInteger(offeringId) ||
        offeringId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid offering ID.",
        });
      }

      if (
        !Number.isInteger(enrollmentSubjectId) ||
        enrollmentSubjectId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid enrollment subject ID.",
        });
      }

      // ===============================================
      // GET GRADE + VERIFY FACULTY OWNERSHIP
      // ===============================================

      const [rows] = await db.execute(
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
            es.status AS enrollment_subject_status,

            e.student_id,
            e.enrollment_status,

            s.student_number,
            s.first_name,
            s.middle_name,
            s.last_name,

            so.offering_id,
            so.faculty_id AS offering_faculty_id,
            so.status AS offering_status,

            sub.subject_id,
            sub.subject_code,
            sub.subject_name,

            sec.section_id,
            sec.section_name

        FROM grades g

        INNER JOIN enrollment_subjects es
            ON es.enrollment_subject_id =
               g.enrollment_subject_id

        INNER JOIN enrollments e
            ON e.enrollment_id =
               es.enrollment_id

        INNER JOIN students s
            ON s.student_id =
               e.student_id

        INNER JOIN subject_offerings so
            ON so.offering_id =
               es.offering_id

        INNER JOIN subjects sub
            ON sub.subject_id =
               so.subject_id

        INNER JOIN sections sec
            ON sec.section_id =
               so.section_id

        WHERE
            g.enrollment_subject_id = ?

            AND es.offering_id = ?

            AND so.faculty_id = ?

        LIMIT 1
        `,
        [
          enrollmentSubjectId,
          offeringId,
          faculty.faculty_id,
        ],
      );

      // ===============================================
      // GRADE / CLASS NOT FOUND
      // ===============================================

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message:
            "Draft grade was not found or this class is not assigned to you.",
        });
      }

      const grade = rows[0];

      // ===============================================
      // VERIFY OFFERING
      // ===============================================

      if (
        grade.offering_status ===
        "Cancelled"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Grades cannot be submitted for a cancelled class.",
        });
      }

      // ===============================================
      // VERIFY ENROLLMENT
      // ===============================================

      if (
        grade.enrollment_status !==
        "Approved"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Only grades from approved enrollments may be submitted.",
        });
      }


      // ===============================================
      // VERIFY GRADE FACULTY
      // ===============================================

      if (
        Number(grade.faculty_id) !==
        Number(faculty.faculty_id)
      ) {
        return res.status(403).json({
          success: false,
          message:
            "This grade belongs to another Faculty assignment.",
        });
      }

      // ===============================================
      // STATUS VALIDATION
      // ===============================================

      if (
        grade.grade_status ===
        "Submitted"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "This grade has already been submitted.",
        });
      }

      if (
        grade.grade_status ===
        "Approved"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "This grade has already been approved and is locked.",
        });
      }

      if (
        ![
          "Draft",
          "Returned",
        ].includes(grade.grade_status)
      ) {
        return res.status(409).json({
          success: false,
          message:
            `Grade status ${grade.grade_status} cannot be submitted.`,
        });
      }


            // ===============================================
      // VERIFY ACTIVE SUBJECT
      // ===============================================

      if (
        grade.enrollment_subject_status !==
        "Enrolled"
      ) {
        return res.status(409).json({
          success: false,
          message:
            "This subject is no longer actively enrolled.",
        });
      }

      // ===============================================
      // APP-LEVEL COMPLETENESS CHECK
      // ===============================================
      //
      // This mirrors your database trigger so the API
      // can return a clean message before MariaDB has
      // to reject the operation.
      //
      // Incomplete:
      //   remarks is required, but a complete numeric
      //   grade is not required by the current DB rule.
      //
      // Passed / Failed:
      //   all grades + final rating are required.
      //
      // ===============================================

      if (grade.remarks === null) {
        return res.status(400).json({
          success: false,
          message:
            "Grade remarks are required before submission.",
        });
      }

      if (
        ["Passed", "Failed"].includes(
          grade.remarks,
        )
      ) {
        const missingFields = [];

        if (grade.prelim_grade === null) {
          missingFields.push(
            "prelim_grade",
          );
        }

        if (grade.midterm_grade === null) {
          missingFields.push(
            "midterm_grade",
          );
        }

        if (grade.final_grade === null) {
          missingFields.push(
            "final_grade",
          );
        }

        if (grade.final_rating === null) {
          missingFields.push(
            "final_rating",
          );
        }

        if (missingFields.length > 0) {
          return res.status(400).json({
            success: false,

            message:
              "Complete grades and final rating are required before submission.",

            missing_fields:
              missingFields,
          });
        }
      }

      // ===============================================
      // SUBMIT
      // ===============================================
      //
      // Database trigger will:
      //
      // Draft -> Submitted
      // Returned -> Submitted
      //
      // and automatically set submitted_at.
      //
      // On Returned -> Submitted it also clears the
      // previous Program Head review information.
      //
      // ===============================================

      await db.execute(
        `
        UPDATE grades

        SET
            grade_status = 'Submitted'

        WHERE grade_id = ?
        `,
        [grade.grade_id],
      );

      // ===============================================
      // READ UPDATED GRADE
      // ===============================================

      const [updatedRows] =
        await db.execute(
          `
          SELECT
              grade_id,
              enrollment_subject_id,
              faculty_id,

              prelim_grade,
              midterm_grade,
              final_grade,
              final_rating,

              remarks,
              grade_status,

              submitted_at,
              reviewed_by,
              reviewed_at,
              review_remarks,

              created_at,
              updated_at

          FROM grades

          WHERE grade_id = ?

          LIMIT 1
          `,
          [grade.grade_id],
        );

      const submitted =
        updatedRows[0];

      // ===============================================
      // RESPONSE
      // ===============================================

      return res.status(200).json({
        success: true,

        message:
          grade.grade_status === "Returned"
            ? "Corrected grade resubmitted successfully."
            : "Grade submitted successfully.",

        student: {
          enrollment_subject_id:
            grade.enrollment_subject_id,

          enrollment_id:
            grade.enrollment_id,

          student_id:
            grade.student_id,

          student_number:
            grade.student_number,

          full_name: [
            grade.first_name,
            grade.middle_name,
            grade.last_name,
          ]
            .filter(Boolean)
            .join(" "),
        },

        class: {
          offering_id:
            grade.offering_id,

          subject: {
            subject_id:
              grade.subject_id,

            subject_code:
              grade.subject_code,

            subject_name:
              grade.subject_name,
          },

          section: {
            section_id:
              grade.section_id,

            section_name:
              grade.section_name,
          },
        },

        grade: {
          grade_id:
            submitted.grade_id,

          enrollment_subject_id:
            submitted.enrollment_subject_id,

          faculty_id:
            submitted.faculty_id,

          prelim_grade:
            submitted.prelim_grade !== null
              ? Number(
                  submitted.prelim_grade,
                )
              : null,

          midterm_grade:
            submitted.midterm_grade !== null
              ? Number(
                  submitted.midterm_grade,
                )
              : null,

          final_grade:
            submitted.final_grade !== null
              ? Number(
                  submitted.final_grade,
                )
              : null,

          final_rating:
            submitted.final_rating !== null
              ? Number(
                  submitted.final_rating,
                )
              : null,

          remarks:
            submitted.remarks,

          grade_status:
            submitted.grade_status,

          submitted_at:
            submitted.submitted_at,

          reviewed_by:
            submitted.reviewed_by,

          reviewed_at:
            submitted.reviewed_at,

          review_remarks:
            submitted.review_remarks,

          created_at:
            submitted.created_at,

          updated_at:
            submitted.updated_at,
        },
      });
    } catch (error) {
      console.error(
        "PATCH /api/faculty/classes/:offeringId/grades/:enrollmentSubjectId/submit error:",
        error,
      );

      // ===============================================
      // DATABASE BUSINESS RULE
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
            "Grade submission was rejected by the database.",
        });
      }

      return res.status(500).json({
        success: false,
        message:
          "Failed to submit grade.",
      });
    }
  },
);


export default router;