// routes/registrar/enrollments.js

import express from "express";
import db from "../../db.js";

const router = express.Router();

// =====================================================
// GET PENDING ENROLLMENTS
//
// GET /api/registrar/enrollments/pending
// =====================================================

router.get("/pending", async (req, res) => {
  try {
    const [enrollments] = await db.execute(`
      SELECT
        e.enrollment_id,
        e.student_id,

        -- Student information
        s.student_number,
        s.first_name,
        s.middle_name,
        s.last_name,

        -- Course information
        c.course_id,
        c.course_code,

        s.year_level,

        -- Enrollment period
        e.academic_year_id,
        ay.academic_year,

        e.semester_id,
        sem.semester_name,

        -- Enrollment status
        e.enrollment_status,
        e.remarks,

        e.created_at

      FROM enrollments e

      INNER JOIN students s
        ON s.student_id = e.student_id

      LEFT JOIN courses c
        ON c.course_id = s.course_id

      INNER JOIN academic_years ay
        ON ay.academic_year_id = e.academic_year_id

      INNER JOIN semesters sem
        ON sem.semester_id = e.semester_id

      WHERE e.enrollment_status = 'Pending'

      ORDER BY
        e.created_at ASC,
        s.last_name ASC,
        s.first_name ASC
    `);

    res.json({
      success: true,
      count: enrollments.length,
      enrollments,
    });
  } catch (error) {
    console.error("GET PENDING ENROLLMENTS ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch pending enrollments.",
    });
  }
});

// =====================================================
// GET REGISTRAR ENROLLMENTS
//
// GET /api/registrar/enrollments
//
// Query parameters:
//
// ?page=1
// ?limit=10
// ?search=Juan
// ?status=Pending
// ?course=1
// ?year=2
// ?section=1
// ?academic_year=2
// ?semester=1
//
// Example:
//
// GET /api/registrar/enrollments?page=1&limit=10
//
// Purpose:
// - Display enrollment records to Registrar
// - Search by student ID / name
// - Filter by enrollment status
// - Filter by course
// - Filter by year level
// - Filter by section
// - Filter by academic year
// - Filter by semester
// - Pagination
// - Return subject count and total units
// =====================================================

router.get("/", async (req, res) => {
  try {
    // =================================================
    // GET QUERY PARAMETERS
    // =================================================

    const {
      page = 1,
      limit = 10,
      search = "",
      status = "",
      course = "",
      year = "",
      section = "",
      academic_year = "",
      semester = "",
    } = req.query;

    // =================================================
    // VALIDATE PAGINATION
    // =================================================

    let currentPage = Number(page);
    let perPage = Number(limit);

    if (!Number.isInteger(currentPage) || currentPage <= 0) {
      currentPage = 1;
    }

    if (!Number.isInteger(perPage) || perPage <= 0) {
      perPage = 10;
    }

    // Prevent extremely large requests
    if (perPage > 100) {
      perPage = 100;
    }

    const offset = (currentPage - 1) * perPage;

    // =================================================
    // BUILD WHERE CONDITIONS
    // =================================================

    const conditions = [];
    const params = [];

    // =================================================
    // SEARCH
    //
    // Search:
    // - Student ID
    // - First name
    // - Last name
    // - Middle name
    // - Username
    // =================================================

    if (String(search).trim() !== "") {
      const searchValue = `%${String(search).trim()}%`;

      conditions.push(`
        (
          CAST(s.student_id AS CHAR) LIKE ?
          OR s.first_name LIKE ?
          OR s.last_name LIKE ?
          OR s.middle_name LIKE ?
          OR u.username LIKE ?
        )
      `);

      params.push(
        searchValue,
        searchValue,
        searchValue,
        searchValue,
        searchValue,
      );
    }

    // =================================================
    // STATUS FILTER
    // =================================================

    if (String(status).trim() !== "") {
      conditions.push(`
        e.enrollment_status = ?
      `);

      params.push(String(status).trim());
    }

    // =================================================
    // COURSE FILTER
    // =================================================

    if (String(course).trim() !== "") {
      const courseId = Number(course);

      if (Number.isInteger(courseId) && courseId > 0) {
        conditions.push(`
          s.course_id = ?
        `);

        params.push(courseId);
      }
    }

    // =================================================
    // YEAR LEVEL FILTER
    // =================================================

    if (String(year).trim() !== "") {
      const yearLevel = Number(year);

      if (Number.isInteger(yearLevel) && yearLevel > 0) {
        conditions.push(`
          COALESCE(sec.year_level, s.year_level) = ?
        `);

        params.push(yearLevel);
      }
    }

    // =================================================
    // SECTION FILTER
    // =================================================

    if (String(section).trim() !== "") {
      const sectionId = Number(section);

      if (Number.isInteger(sectionId) && sectionId > 0) {
        conditions.push(`
          sec.section_id = ?
        `);

        params.push(sectionId);
      }
    }

    // =================================================
    // ACADEMIC YEAR FILTER
    // =================================================

    if (String(academic_year).trim() !== "") {
      const academicYearId = Number(academic_year);

      if (Number.isInteger(academicYearId) && academicYearId > 0) {
        conditions.push(`
          e.academic_year_id = ?
        `);

        params.push(academicYearId);
      }
    }

    // =================================================
    // SEMESTER FILTER
    // =================================================

    if (String(semester).trim() !== "") {
      const semesterId = Number(semester);

      if (Number.isInteger(semesterId) && semesterId > 0) {
        conditions.push(`
          e.semester_id = ?
        `);

        params.push(semesterId);
      }
    }

    // =================================================
    // WHERE CLAUSE
    // =================================================

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // =================================================
    // GET TOTAL COUNT
    // =================================================

    const countParams = [...params];

    const [countRows] = await db.execute(
      `
      SELECT
          COUNT(DISTINCT e.enrollment_id) AS total

      FROM enrollments e

      INNER JOIN students s
          ON s.student_id = e.student_id

      LEFT JOIN users u
          ON u.user_id = s.user_id

      LEFT JOIN sections sec
          ON sec.section_id = s.section_id

      ${whereClause}
      `,
      countParams,
    );

    const total = Number(countRows[0]?.total || 0);

    // =================================================
    // GET ENROLLMENTS
    // =================================================

    const queryParams = [...params, perPage, offset];

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

          e.created_at,

          -- ==========================================
          -- STUDENT
          -- ==========================================

          s.student_number,

          s.first_name,
          s.middle_name,
          s.last_name,

          CONCAT(
            s.last_name,
            ', ',
            s.first_name,
            CASE
              WHEN s.middle_name IS NOT NULL
               AND s.middle_name <> ''
              THEN CONCAT(' ', s.middle_name)
              ELSE ''
            END
          ) AS student_name,

          -- ==========================================
          -- USERNAME
          -- ==========================================

          u.username,

          -- ==========================================
          -- COURSE
          -- ==========================================

          c.course_id,
          c.course_code,
          c.course_name,

          -- ==========================================
          -- SECTION
          -- ==========================================

          sec.section_id,
          sec.section_name,
          sec.year_level,

          -- ==========================================
          -- ACADEMIC YEAR
          -- ==========================================

          ay.academic_year,

          -- ==========================================
          -- SEMESTER
          -- ==========================================

          sem.semester_name,

          -- ==========================================
          -- SUBJECT COUNT
          -- ==========================================

          COUNT(
            DISTINCT
            CASE
              WHEN es.status = 'Enrolled'
              THEN es.enrollment_subject_id
            END
          ) AS total_subjects,

          -- ==========================================
          -- TOTAL UNITS
          -- ==========================================

          COALESCE(
            SUM(
              CASE
                WHEN es.status = 'Enrolled'
                THEN sub.units
                ELSE 0
              END
            ),
            0
          ) AS total_units

      FROM enrollments e

      INNER JOIN students s
          ON s.student_id = e.student_id

      LEFT JOIN users u
          ON u.user_id = s.user_id

      LEFT JOIN courses c
          ON c.course_id = s.course_id

      LEFT JOIN sections sec
          ON sec.section_id = s.section_id

      LEFT JOIN academic_years ay
          ON ay.academic_year_id = e.academic_year_id

      LEFT JOIN semesters sem
          ON sem.semester_id = e.semester_id

      LEFT JOIN enrollment_subjects es
          ON es.enrollment_id = e.enrollment_id

      LEFT JOIN subjects sub
          ON sub.subject_id = es.subject_id

      ${whereClause}

      GROUP BY
          e.enrollment_id,
          e.student_id,
          e.academic_year_id,
          e.semester_id,
          e.enrollment_status,
          e.remarks,
          e.approved_by,
          e.approved_at,
          e.created_at,

          s.student_number,
          s.first_name,
          s.middle_name,
          s.last_name,

          u.username,

          c.course_id,
          c.course_code,
          c.course_name,

          sec.section_id,
          sec.section_name,
          sec.year_level,

          ay.academic_year,
          sem.semester_name

      ORDER BY
          e.created_at DESC,
          e.enrollment_id DESC

      LIMIT ?
      OFFSET ?
      `,
      queryParams,
    );

    // =================================================
    // CALCULATE PAGINATION
    // =================================================

    const totalPages = total > 0 ? Math.ceil(total / perPage) : 0;

    // =================================================
    // FORMAT RESULTS
    // =================================================

    const enrollments = enrollmentRows.map((row) => ({
      enrollment_id: row.enrollment_id,

      student: {
        student_id: row.student_id,
        student_number: row.student_number,
        student_name: row.student_name,
        first_name: row.first_name,
        middle_name: row.middle_name,
        last_name: row.last_name,
        username: row.username,
      },

      course: {
        course_id: row.course_id,
        course_code: row.course_code,
        course_name: row.course_name,
      },

      section: {
        section_id: row.section_id,
        section_name: row.section_name,
        year_level: row.year_level,
      },

      academic_period: {
        academic_year_id: row.academic_year_id,
        academic_year: row.academic_year,
        semester_id: row.semester_id,
        semester_name: row.semester_name,
      },

      enrollment_status: row.enrollment_status,

      remarks: row.remarks,

      approval: {
        approved_by: row.approved_by,
        approved_at: row.approved_at,
      },

      total_subjects: Number(row.total_subjects || 0),

      total_units: Number(row.total_units || 0),

      created_at: row.created_at,
    }));

    // =================================================
    // SUCCESS RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      data: enrollments,

      pagination: {
        page: currentPage,
        limit: perPage,
        total,
        totalPages,
        hasNextPage: currentPage < totalPages,
        hasPreviousPage: currentPage > 1,
      },
    });
  } catch (error) {
    console.error("GET REGISTRAR ENROLLMENTS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load enrollments.",
      error: error.message,
    });
  }
});

// =====================================================
// GET SINGLE ENROLLMENT
//
// GET /api/registrar/enrollments/:id
//
// Returns:
// - Enrollment information
// - Student information
// - Course
// - Academic year
// - Semester
// - Enrollment status
// - All enrolled subjects
// - Subject offering
// - Section
// - Faculty
// - Room
// - Schedule
// =====================================================

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // =================================================
    // VALIDATE ENROLLMENT ID
    // =================================================

    const enrollmentId = Number(id);

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // GET ENROLLMENT HEADER
    // =================================================

    const [enrollmentRows] = await db.execute(
      `
      SELECT

          e.enrollment_id,
          e.student_id,

          -- Student
          s.student_number,
          s.first_name,
          s.middle_name,
          s.last_name,
          s.gender,
          s.birth_date,
          s.contact_number,
          s.year_level,

          -- Course
          c.course_id,
          c.course_code,

          -- Student section
          sec_student.section_id AS student_section_id,
          sec_student.section_name AS student_section_name,

          -- Academic year
          ay.academic_year_id,
          ay.academic_year,

          -- Semester
          sem.semester_id,
          sem.semester_name,

          -- Enrollment
          e.enrollment_status,
          e.remarks,

          -- Approval
          e.approved_by,
          u.username AS approved_by_username,
          e.approved_at,

          e.created_at

      FROM enrollments e

      INNER JOIN students s
          ON s.student_id = e.student_id

      LEFT JOIN courses c
          ON c.course_id = s.course_id

      LEFT JOIN sections sec_student
          ON sec_student.section_id = s.section_id

      INNER JOIN academic_years ay
          ON ay.academic_year_id = e.academic_year_id

      INNER JOIN semesters sem
          ON sem.semester_id = e.semester_id

      LEFT JOIN users u
          ON u.user_id = e.approved_by

      WHERE e.enrollment_id = ?
      `,
      [enrollmentId],
    );

    // =================================================
    // CHECK ENROLLMENT
    // =================================================

    if (enrollmentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // GET ENROLLED SUBJECTS
    // =================================================

    const [subjects] = await db.execute(
      `
      SELECT

          es.enrollment_subject_id,

          -- Subject
          es.subject_id,
          sub.subject_code,
          sub.subject_name,
          sub.units,
          sub.lecture_hours,
          sub.laboratory_hours,

          -- Enrollment subject status
          es.status AS subject_status,

          -- Section
          es.section_id,
          sec.section_name,

          -- Section subject
          es.section_subject_id,

          -- Offering
          es.offering_id,

          -- Faculty
          f.faculty_id,

          -- Room
          r.room_id,

          -- Schedule
          so.schedule_days,
          so.schedule_time,

          -- Offering capacity
          so.max_students

      FROM enrollment_subjects es

      INNER JOIN subjects sub
          ON sub.subject_id = es.subject_id

      LEFT JOIN sections sec
          ON sec.section_id = es.section_id

      LEFT JOIN subject_offerings so
          ON so.offering_id = es.offering_id

      LEFT JOIN faculty f
          ON f.faculty_id = so.faculty_id

      LEFT JOIN rooms r
          ON r.room_id = so.room_id

      WHERE es.enrollment_id = ?

      ORDER BY
          sub.subject_code ASC
      `,
      [enrollmentId],
    );

    // =================================================
    // RESPONSE
    // =================================================

    res.json({
      success: true,

      enrollment,

      totalSubjects: subjects.length,

      subjects,
    });
  } catch (error) {
    console.error("GET ENROLLMENT ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch enrollment.",
    });
  }
});

// =====================================================
// GET AVAILABLE SUBJECT OFFERINGS
//
// GET /api/registrar/enrollments/:id/available-offerings
//
// Optional:
// GET /api/registrar/enrollments/:id/available-offerings?subject_id=5
//
// Purpose:
// - Find subject offerings available for an enrollment
// - Match academic year and semester
// - Show sections
// - Show faculty
// - Show room
// - Show schedule
// - Check section subject status
// - Check offering capacity
// - Calculate current enrollment count
// =====================================================

router.get("/:id/available-offerings", async (req, res) => {
  try {
    // =================================================
    // GET ENROLLMENT ID
    // =================================================

    const { id } = req.params;

    const enrollmentId = Number(id);

    // =================================================
    // VALIDATE ENROLLMENT ID
    // =================================================

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // OPTIONAL SUBJECT FILTER
    // =================================================

    const subjectIdParam = req.query.subject_id;

    let subjectId = null;

    if (subjectIdParam !== undefined) {
      subjectId = Number(subjectIdParam);

      if (!Number.isInteger(subjectId) || subjectId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid subject ID.",
        });
      }
    }

    // =================================================
    // GET ENROLLMENT INFORMATION
    // =================================================

    const [enrollmentRows] = await db.execute(
      `
      SELECT
          e.enrollment_id,
          e.student_id,
          e.academic_year_id,
          e.semester_id,
          e.enrollment_status,

          s.course_id,
          s.section_id AS student_section_id,

          c.course_code

      FROM enrollments e

      INNER JOIN students s
          ON s.student_id = e.student_id

      LEFT JOIN courses c
          ON c.course_id = s.course_id

      WHERE e.enrollment_id = ?
      `,
      [enrollmentId],
    );

    // =================================================
    // CHECK ENROLLMENT
    // =================================================

    if (enrollmentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // BUILD SUBJECT FILTER
    // =================================================

    const subjectCondition = subjectId !== null ? `AND so.subject_id = ?` : "";

    const queryParams =
      subjectId !== null
        ? [enrollment.academic_year_id, enrollment.semester_id, subjectId]
        : [enrollment.academic_year_id, enrollment.semester_id];

    // =================================================
    // GET AVAILABLE OFFERINGS
    // =================================================

    const [offerings] = await db.execute(
      `
      SELECT

          -- Offering
          so.offering_id,

          -- Section Subject
          ss.section_subject_id,
          ss.status AS section_subject_status,

          -- Subject
          sub.subject_id,
          sub.subject_code,
          sub.subject_name,
          sub.units,

          -- Section
          sec.section_id,
          sec.section_name,
          sec.course_id AS section_course_id,

          -- Course
          c.course_code AS section_course_code,

          -- Faculty
          f.faculty_id,

          CONCAT(
              f.first_name,
              ' ',
              COALESCE(f.middle_name, ''),
              ' ',
              f.last_name
          ) AS faculty_name,

          -- Room
          r.room_id,
          r.room_name,

          -- Schedule
          so.schedule_days,
          so.schedule_time,

          -- Capacity
          so.max_students,

          -- Current enrolled students
          (
              SELECT COUNT(*)

              FROM enrollment_subjects es_count

              INNER JOIN enrollments e_count
                  ON e_count.enrollment_id =
                     es_count.enrollment_id

              WHERE es_count.offering_id = so.offering_id

                AND es_count.status = 'Enrolled'

                AND e_count.enrollment_status IN (
                    'Pending',
                    'Approved'
                )
          ) AS enrolled_count,

          -- Remaining capacity
          (
              so.max_students -

              (
                  SELECT COUNT(*)

                  FROM enrollment_subjects es_count

                  INNER JOIN enrollments e_count
                      ON e_count.enrollment_id =
                         es_count.enrollment_id

                  WHERE es_count.offering_id = so.offering_id

                    AND es_count.status = 'Enrolled'

                    AND e_count.enrollment_status IN (
                        'Pending',
                        'Approved'
                    )
              )
          ) AS available_slots

      FROM subject_offerings so

      INNER JOIN section_subjects ss
          ON ss.section_subject_id =
             so.section_subject_id

      INNER JOIN subjects sub
          ON sub.subject_id = so.subject_id

      INNER JOIN sections sec
          ON sec.section_id = so.section_id

      LEFT JOIN courses c
          ON c.course_id = sec.course_id

      LEFT JOIN faculty f
          ON f.faculty_id = so.faculty_id

      LEFT JOIN rooms r
          ON r.room_id = so.room_id

      WHERE so.academic_year_id = ?

        AND so.semester_id = ?

        AND ss.academic_year_id = so.academic_year_id

        AND ss.semester_id = so.semester_id

        AND ss.status = 'Open'

        AND so.max_students > 0

        ${subjectCondition}

      ORDER BY
          sub.subject_code ASC,
          sec.section_name ASC
      `,
      queryParams,
    );

    // =================================================
    // FORMAT RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      enrollment: {
        enrollment_id: enrollment.enrollment_id,
        student_id: enrollment.student_id,
        academic_year_id: enrollment.academic_year_id,
        semester_id: enrollment.semester_id,
        enrollment_status: enrollment.enrollment_status,
        course_id: enrollment.course_id,
        course_code: enrollment.course_code,
        student_section_id: enrollment.student_section_id,
      },

      count: offerings.length,

      offerings,
    });
  } catch (error) {
    // =================================================
    // ERROR
    // =================================================

    console.error("GET AVAILABLE OFFERINGS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch available subject offerings.",
    });
  }
});

// =====================================================
// ADD SUBJECT TO ENROLLMENT
//
// POST /api/registrar/enrollments/:id/subjects
//
// Body:
// {
//   "offering_id": 12
// }
//
// Purpose:
// - Add a subject to an enrollment
// - Supports Pending enrollments
// - Supports Approved enrollments for Registrar corrections
// - Validates offering relationships
// - Validates academic year and semester
// - Validates section subject status
// - Checks offering capacity
// - Prevents duplicate subjects
// =====================================================
// =====================================================
// ADD SUBJECT TO ENROLLMENT
//
// POST /api/registrar/enrollments/:id/subjects
//
// Body:
// {
//   "offering_id": 15,
//   "reason": "Retake subject"
// }
//
// Purpose:
// - Add a subject to an enrollment
// - Supports Pending enrollments
// - Supports Approved enrollments for Registrar corrections
// - Validates the offering
// - Prevents duplicate subjects
// - Checks capacity
// - Records ADD history
// =====================================================

router.post("/:id/subjects", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { id } = req.params;

    const enrollmentId = Number(id);

    // =================================================
    // VALIDATE ENROLLMENT ID
    // =================================================

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // GET REQUEST DATA
    // =================================================

    const { offering_id, reason } = req.body;

    const offeringId = Number(offering_id);

    if (!Number.isInteger(offeringId) || offeringId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid offering ID.",
      });
    }

    // =================================================
    // START TRANSACTION
    // =================================================

    await connection.beginTransaction();

    // =================================================
    // GET ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
        SELECT

            e.enrollment_id,
            e.student_id,
            e.academic_year_id,
            e.semester_id,
            e.enrollment_status,

            s.student_number,
            s.first_name,
            s.middle_name,
            s.last_name,

            c.course_id,
            c.course_code

        FROM enrollments e

        INNER JOIN students s
            ON s.student_id = e.student_id

        LEFT JOIN courses c
            ON c.course_id = s.course_id

        WHERE e.enrollment_id = ?

        FOR UPDATE
        `,
      [enrollmentId],
    );

    // =================================================
    // CHECK ENROLLMENT
    // =================================================

    if (enrollmentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // CHECK ENROLLMENT STATUS
    // =================================================

    if (
      enrollment.enrollment_status !== "Pending" &&
      enrollment.enrollment_status !== "Approved"
    ) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: `Subject cannot be added because enrollment status is '${enrollment.enrollment_status}'.`,
      });
    }

    // =================================================
    // GET OFFERING
    // =================================================

    const [offeringRows] = await connection.execute(
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

            -- Section Subject
            ss.status AS section_subject_status,

            -- Subject
            sub.subject_code,
            sub.subject_name,
            sub.units,

            -- Section
            sec.section_name

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

        WHERE so.offering_id = ?

        FOR UPDATE
        `,
      [offeringId],
    );

    // =================================================
    // OFFERING NOT FOUND
    // =================================================

    if (offeringRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Subject offering not found.",
      });
    }

    const offering = offeringRows[0];

    // =================================================
    // CHECK ACADEMIC YEAR
    // =================================================

    if (
      Number(offering.academic_year_id) !== Number(enrollment.academic_year_id)
    ) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Subject offering does not belong to the enrollment academic year.",
      });
    }

    // =================================================
    // CHECK SEMESTER
    // =================================================

    if (Number(offering.semester_id) !== Number(enrollment.semester_id)) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "Subject offering does not belong to the enrollment semester.",
      });
    }

    // =================================================
    // CHECK SECTION SUBJECT
    // =================================================

    if (offering.section_subject_status !== "Open") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: `Subject offering is ${offering.section_subject_status.toLowerCase()}.`,
      });
    }

    // =================================================
    // CHECK DUPLICATE SUBJECT
    // =================================================

    const [duplicateRows] = await connection.execute(
      `
        SELECT
            enrollment_subject_id,
            status

        FROM enrollment_subjects

        WHERE enrollment_id = ?

          AND subject_id = ?

          AND status IN (
              'Enrolled',
              'Completed'
          )

        LIMIT 1
        `,
      [enrollmentId, offering.subject_id],
    );

    if (duplicateRows.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "This subject is already part of the enrollment.",
      });
    }

    // =================================================
    // CHECK CAPACITY
    // =================================================

    const [capacityRows] = await connection.execute(
      `
        SELECT
            COUNT(*) AS enrolled_count

        FROM enrollment_subjects es

        INNER JOIN enrollments e
            ON e.enrollment_id =
               es.enrollment_id

        WHERE es.offering_id = ?

          AND es.status = 'Enrolled'

          AND e.enrollment_status IN (
              'Pending',
              'Approved'
          )
        `,
      [offeringId],
    );

    const enrolledCount = Number(capacityRows[0]?.enrolled_count || 0);

    const maxStudents = Number(offering.max_students || 0);

    if (maxStudents > 0 && enrolledCount >= maxStudents) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "Subject offering is already full.",
        capacity: {
          max_students: maxStudents,
          enrolled_count: enrolledCount,
          available_slots: 0,
        },
      });
    }

    // =================================================
    // INSERT ENROLLMENT SUBJECT
    // =================================================

    const [insertResult] = await connection.execute(
      `
        INSERT INTO enrollment_subjects (

            enrollment_id,
            subject_id,
            offering_id,
            status,
            section_id,
            section_subject_id

        )
        VALUES (?, ?, ?, 'Enrolled', ?, ?)
        `,
      [
        enrollmentId,
        offering.subject_id,
        offering.offering_id,
        offering.section_id,
        offering.section_subject_id,
      ],
    );

    const enrollmentSubjectId = insertResult.insertId;

    // =================================================
    // GET REGISTRAR
    //
    // Currently we use req.user?.user_id if your
    // authentication system provides it.
    //
    // If no authenticated user is attached, NULL
    // will be recorded.
    // =================================================

    const changedBy = req.user?.user_id || null;

    // =================================================
    // RECORD HISTORY
    // =================================================

    await connection.execute(
      `
      INSERT INTO enrollment_subject_changes (

          enrollment_id,
          enrollment_subject_id,
          subject_id,

          change_type,

          old_offering_id,
          old_section_id,
          old_section_subject_id,

          new_offering_id,
          new_section_id,
          new_section_subject_id,

          reason,
          changed_by

      )
      VALUES (
          ?,
          ?,
          ?,
          'ADD',
          NULL,
          NULL,
          NULL,
          ?,
          ?,
          ?,
          ?,
          ?
      )
      `,
      [
        enrollmentId,
        enrollmentSubjectId,
        offering.subject_id,

        offering.offering_id,
        offering.section_id,
        offering.section_subject_id,

        reason || "Registrar added subject",

        changedBy,
      ],
    );

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(201).json({
      success: true,

      message: "Subject added to enrollment successfully.",

      enrollment_subject: {
        enrollment_subject_id: enrollmentSubjectId,

        enrollment_id: enrollmentId,

        subject_id: offering.subject_id,

        subject_code: offering.subject_code,

        subject_name: offering.subject_name,

        units: offering.units,

        offering_id: offering.offering_id,

        section_subject_id: offering.section_subject_id,

        section_id: offering.section_id,

        section_name: offering.section_name,

        status: "Enrolled",

        schedule_days: offering.schedule_days,

        schedule_time: offering.schedule_time,

        faculty_id: offering.faculty_id,

        room_id: offering.room_id,
      },

      history: {
        change_type: "ADD",
        reason: reason || "Registrar added subject",
      },
    });
  } catch (error) {
    // =================================================
    // ROLLBACK
    // =================================================

    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error("ROLLBACK ADD SUBJECT ERROR:", rollbackError);
    }

    console.error("ADD SUBJECT ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to add subject to enrollment.",
    });
  } finally {
    connection.release();
  }
}); // =====================================================
// CHANGE SUBJECT OFFERING / SECTION
//
// PUT /api/registrar/enrollments/:id/subjects/:enrollmentSubjectId
//
// Body:
// {
//   "offering_id": 15,
//   "reason": "Student retake section correction"
// }
//
// Purpose:
// - Change the section/offering of an enrolled subject
// - Supports Pending enrollments
// - Supports Approved enrollments
// - Prevents changing the actual subject
// - Validates academic year and semester
// - Checks capacity
// - Records CHANGE history
// =====================================================

router.put("/:id/subjects/:enrollmentSubjectId", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { id, enrollmentSubjectId } = req.params;

    // =================================================
    // VALIDATE IDS
    // =================================================

    const enrollmentId = Number(id);

    const enrollmentSubjectIdNumber = Number(enrollmentSubjectId);

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    if (
      !Number.isInteger(enrollmentSubjectIdNumber) ||
      enrollmentSubjectIdNumber <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment subject ID.",
      });
    }

    // =================================================
    // GET REQUEST DATA
    // =================================================

    const { offering_id, reason } = req.body;

    const newOfferingId = Number(offering_id);

    if (!Number.isInteger(newOfferingId) || newOfferingId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid offering ID.",
      });
    }

    // =================================================
    // START TRANSACTION
    // =================================================

    await connection.beginTransaction();

    // =================================================
    // GET ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
          SELECT

              e.enrollment_id,
              e.student_id,

              e.academic_year_id,
              e.semester_id,

              e.enrollment_status,

              s.student_number,
              s.first_name,
              s.middle_name,
              s.last_name,

              c.course_id,
              c.course_code

          FROM enrollments e

          INNER JOIN students s
              ON s.student_id =
                 e.student_id

          LEFT JOIN courses c
              ON c.course_id =
                 s.course_id

          WHERE e.enrollment_id = ?

          FOR UPDATE
          `,
      [enrollmentId],
    );

    // =================================================
    // CHECK ENROLLMENT
    // =================================================

    if (enrollmentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // CHECK ENROLLMENT STATUS
    // =================================================

    if (
      enrollment.enrollment_status !== "Pending" &&
      enrollment.enrollment_status !== "Approved"
    ) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: `Subject cannot be changed because enrollment status is '${enrollment.enrollment_status}'.`,
      });
    }

    // =================================================
    // GET CURRENT ENROLLMENT SUBJECT
    // =================================================

    const [currentSubjectRows] = await connection.execute(
      `
          SELECT

              es.enrollment_subject_id,
              es.enrollment_id,

              es.subject_id,
              es.offering_id,
              es.section_id,
              es.section_subject_id,

              es.status,

              sub.subject_code,
              sub.subject_name,
              sub.units,

              sec.section_name

          FROM enrollment_subjects es

          INNER JOIN subjects sub
              ON sub.subject_id =
                 es.subject_id

          LEFT JOIN sections sec
              ON sec.section_id =
                 es.section_id

          WHERE es.enrollment_subject_id = ?

            AND es.enrollment_id = ?

          FOR UPDATE
          `,
      [enrollmentSubjectIdNumber, enrollmentId],
    );

    // =================================================
    // CHECK CURRENT SUBJECT
    // =================================================

    if (currentSubjectRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment subject not found.",
      });
    }

    const currentSubject = currentSubjectRows[0];

    // =================================================
    // CHECK SUBJECT STATUS
    // =================================================

    if (currentSubject.status !== "Enrolled") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: `Subject cannot be changed because its current status is '${currentSubject.status}'.`,
      });
    }

    // =================================================
    // CHECK SAME OFFERING
    // =================================================

    if (Number(currentSubject.offering_id) === newOfferingId) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "The selected offering is already assigned to this subject.",
      });
    }

    // =================================================
    // GET NEW OFFERING
    // =================================================

    const [offeringRows] = await connection.execute(
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

              -- Section Subject
              ss.status AS section_subject_status,

              -- Subject
              sub.subject_code,
              sub.subject_name,
              sub.units,

              -- Section
              sec.section_name

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

          WHERE so.offering_id = ?

          FOR UPDATE
          `,
      [newOfferingId],
    );

    // =================================================
    // OFFERING NOT FOUND
    // =================================================

    if (offeringRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "New subject offering not found.",
      });
    }

    const newOffering = offeringRows[0];

    // =================================================
    // CHECK SUBJECT
    // =================================================

    if (Number(newOffering.subject_id) !== Number(currentSubject.subject_id)) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "The new offering belongs to a different subject.",
      });
    }

    // =================================================
    // CHECK ACADEMIC YEAR
    // =================================================

    if (
      Number(newOffering.academic_year_id) !==
      Number(enrollment.academic_year_id)
    ) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "The new offering does not belong to the enrollment academic year.",
      });
    }

    // =================================================
    // CHECK SEMESTER
    // =================================================

    if (Number(newOffering.semester_id) !== Number(enrollment.semester_id)) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "The new offering does not belong to the enrollment semester.",
      });
    }

    // =================================================
    // CHECK SECTION SUBJECT STATUS
    // =================================================

    if (newOffering.section_subject_status !== "Open") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: `The new subject offering is ${newOffering.section_subject_status.toLowerCase()}.`,
      });
    }

    // =================================================
    // CHECK CAPACITY
    // =================================================

    const [capacityRows] = await connection.execute(
      `
          SELECT
              COUNT(*) AS enrolled_count

          FROM enrollment_subjects es

          INNER JOIN enrollments e
              ON e.enrollment_id =
                 es.enrollment_id

          WHERE es.offering_id = ?

            AND es.status = 'Enrolled'

            AND e.enrollment_status IN (
                'Pending',
                'Approved'
            )

            AND es.enrollment_subject_id <> ?
          `,
      [newOfferingId, enrollmentSubjectIdNumber],
    );

    const enrolledCount = Number(capacityRows[0]?.enrolled_count || 0);

    const maxStudents = Number(newOffering.max_students || 0);

    if (maxStudents > 0 && enrolledCount >= maxStudents) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "The new subject offering is already full.",
        capacity: {
          max_students: maxStudents,

          enrolled_count: enrolledCount,

          available_slots: 0,
        },
      });
    }

    // =================================================
    // SAVE OLD VALUES
    // =================================================

    const oldOfferingId = currentSubject.offering_id;

    const oldSectionId = currentSubject.section_id;

    const oldSectionSubjectId = currentSubject.section_subject_id;

    // =================================================
    // UPDATE ENROLLMENT SUBJECT
    // =================================================

    await connection.execute(
      `
        UPDATE enrollment_subjects

        SET

            offering_id = ?,

            section_id = ?,

            section_subject_id = ?

        WHERE enrollment_subject_id = ?

          AND enrollment_id = ?
        `,
      [
        newOffering.offering_id,

        newOffering.section_id,

        newOffering.section_subject_id,

        enrollmentSubjectIdNumber,

        enrollmentId,
      ],
    );

    // =================================================
    // GET REGISTRAR
    // =================================================

    const changedBy = req.user?.user_id || null;

    // =================================================
    // RECORD CHANGE HISTORY
    // =================================================

    await connection.execute(
      `
        INSERT INTO enrollment_subject_changes (

            enrollment_id,

            enrollment_subject_id,

            subject_id,

            change_type,

            old_offering_id,

            old_section_id,

            old_section_subject_id,

            new_offering_id,

            new_section_id,

            new_section_subject_id,

            reason,

            changed_by

        )
        VALUES (

            ?,
            ?,
            ?,
            'CHANGE',

            ?,
            ?,
            ?,

            ?,
            ?,
            ?,

            ?,
            ?
        )
        `,
      [
        enrollmentId,

        enrollmentSubjectIdNumber,

        currentSubject.subject_id,

        oldOfferingId,

        oldSectionId,

        oldSectionSubjectId,

        newOffering.offering_id,

        newOffering.section_id,

        newOffering.section_subject_id,

        reason || "Registrar changed subject section/offering",

        changedBy,
      ],
    );

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      message: "Subject offering and section changed successfully.",

      enrollment_subject: {
        enrollment_subject_id: enrollmentSubjectIdNumber,

        enrollment_id: enrollmentId,

        subject_id: currentSubject.subject_id,

        subject_code: newOffering.subject_code,

        subject_name: newOffering.subject_name,

        units: newOffering.units,

        offering_id: newOffering.offering_id,

        section_subject_id: newOffering.section_subject_id,

        section_id: newOffering.section_id,

        section_name: newOffering.section_name,

        status: currentSubject.status,

        schedule_days: newOffering.schedule_days,

        schedule_time: newOffering.schedule_time,

        faculty_id: newOffering.faculty_id,

        room_id: newOffering.room_id,
      },

      history: {
        change_type: "CHANGE",

        old_offering_id: oldOfferingId,

        old_section_id: oldSectionId,

        old_section_subject_id: oldSectionSubjectId,

        new_offering_id: newOffering.offering_id,

        new_section_id: newOffering.section_id,

        new_section_subject_id: newOffering.section_subject_id,

        reason: reason || "Registrar changed subject section/offering",
      },
    });
  } catch (error) {
    // =================================================
    // ROLLBACK
    // =================================================

    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error("ROLLBACK CHANGE SUBJECT ERROR:", rollbackError);
    }

    console.error("CHANGE SUBJECT ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to change subject offering.",
    });
  } finally {
    connection.release();
  }
}); // =====================================================
// REMOVE SUBJECT FROM ENROLLMENT
//
// DELETE /api/registrar/enrollments/:id/subjects/:enrollmentSubjectId
//
// Body:
// {
//   "reason": "Student failed the subject and will retake it"
// }
//
// Purpose:
// - Remove a subject from an enrollment
// - Supports Pending enrollments
// - Supports Approved enrollments for Registrar corrections
// - Records the original subject assignment
// - Records REMOVE history
// =====================================================

router.delete("/:id/subjects/:enrollmentSubjectId", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { id, enrollmentSubjectId } = req.params;

    // =================================================
    // VALIDATE ENROLLMENT ID
    // =================================================

    const enrollmentId = Number(id);

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // VALIDATE ENROLLMENT SUBJECT ID
    // =================================================

    const enrollmentSubjectIdNumber = Number(enrollmentSubjectId);

    if (
      !Number.isInteger(enrollmentSubjectIdNumber) ||
      enrollmentSubjectIdNumber <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment subject ID.",
      });
    }

    // =================================================
    // GET REQUEST DATA
    // =================================================

    const { reason } = req.body;

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "A reason is required when removing a subject.",
      });
    }

    // =================================================
    // START TRANSACTION
    // =================================================

    await connection.beginTransaction();

    // =================================================
    // GET ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
          SELECT

              e.enrollment_id,
              e.student_id,

              e.academic_year_id,
              e.semester_id,

              e.enrollment_status,

              s.student_number,
              s.first_name,
              s.middle_name,
              s.last_name,

              c.course_id,
              c.course_code

          FROM enrollments e

          INNER JOIN students s
              ON s.student_id =
                 e.student_id

          LEFT JOIN courses c
              ON c.course_id =
                 s.course_id

          WHERE e.enrollment_id = ?

          FOR UPDATE
          `,
      [enrollmentId],
    );

    // =================================================
    // CHECK ENROLLMENT
    // =================================================

    if (enrollmentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // CHECK ENROLLMENT STATUS
    // =================================================

    if (
      enrollment.enrollment_status !== "Pending" &&
      enrollment.enrollment_status !== "Approved"
    ) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: `Subject cannot be removed because enrollment status is '${enrollment.enrollment_status}'.`,
      });
    }

    // =================================================
    // GET ENROLLMENT SUBJECT
    // =================================================

    const [subjectRows] = await connection.execute(
      `
          SELECT

              es.enrollment_subject_id,

              es.enrollment_id,

              es.subject_id,

              es.offering_id,

              es.section_id,

              es.section_subject_id,

              es.status,

              sub.subject_code,
              sub.subject_name,
              sub.units,

              sec.section_name,

              so.schedule_days,
              so.schedule_time,

              so.faculty_id,
              so.room_id

          FROM enrollment_subjects es

          INNER JOIN subjects sub
              ON sub.subject_id =
                 es.subject_id

          LEFT JOIN sections sec
              ON sec.section_id =
                 es.section_id

          LEFT JOIN subject_offerings so
              ON so.offering_id =
                 es.offering_id

          WHERE es.enrollment_subject_id = ?

            AND es.enrollment_id = ?

          FOR UPDATE
          `,
      [enrollmentSubjectIdNumber, enrollmentId],
    );

    // =================================================
    // SUBJECT NOT FOUND
    // =================================================

    if (subjectRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment subject not found.",
      });
    }

    const subject = subjectRows[0];

    // =================================================
    // CHECK SUBJECT STATUS
    // =================================================

    if (subject.status !== "Enrolled") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: `Subject cannot be removed because its current status is '${subject.status}'.`,
      });
    }

    // =================================================
    // SAVE OLD VALUES
    // =================================================

    const oldOfferingId = subject.offering_id;

    const oldSectionId = subject.section_id;

    const oldSectionSubjectId = subject.section_subject_id;

    // =================================================
    // GET REGISTRAR
    // =================================================

    const changedBy = req.user?.user_id || null;

    // =================================================
    // RECORD REMOVE HISTORY FIRST
    // =================================================
    //
    // We record the history before deleting because
    // enrollment_subjects will no longer exist after
    // the DELETE.
    //
    // Everything is still inside the transaction.
    // =================================================

    await connection.execute(
      `
        INSERT INTO enrollment_subject_changes (

            enrollment_id,

            enrollment_subject_id,

            subject_id,

            change_type,

            old_offering_id,

            old_section_id,

            old_section_subject_id,

            new_offering_id,

            new_section_id,

            new_section_subject_id,

            reason,

            changed_by

        )
        VALUES (

            ?,
            ?,
            ?,

            'REMOVE',

            ?,
            ?,
            ?,

            NULL,
            NULL,
            NULL,

            ?,
            ?
        )
        `,
      [
        enrollmentId,

        enrollmentSubjectIdNumber,

        subject.subject_id,

        oldOfferingId,

        oldSectionId,

        oldSectionSubjectId,

        reason.trim(),

        changedBy,
      ],
    );

    // =================================================
    // DELETE ENROLLMENT SUBJECT
    // =================================================

    await connection.execute(
      `
        DELETE FROM enrollment_subjects

        WHERE enrollment_subject_id = ?

          AND enrollment_id = ?
        `,
      [enrollmentSubjectIdNumber, enrollmentId],
    );

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // RESPONSE
    // =================================================

    return res.json({
      success: true,

      message: "Subject removed from enrollment successfully.",

      removed_subject: {
        enrollment_subject_id: enrollmentSubjectIdNumber,

        enrollment_id: enrollmentId,

        subject_id: subject.subject_id,

        subject_code: subject.subject_code,

        subject_name: subject.subject_name,

        units: subject.units,

        offering_id: oldOfferingId,

        section_id: oldSectionId,

        section_subject_id: oldSectionSubjectId,

        section_name: subject.section_name,

        status: subject.status,

        schedule_days: subject.schedule_days,

        schedule_time: subject.schedule_time,

        faculty_id: subject.faculty_id,

        room_id: subject.room_id,
      },

      history: {
        change_type: "REMOVE",

        old_offering_id: oldOfferingId,

        old_section_id: oldSectionId,

        old_section_subject_id: oldSectionSubjectId,

        reason: reason.trim(),
      },
    });
  } catch (error) {
    // =================================================
    // ROLLBACK
    // =================================================

    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error("ROLLBACK REMOVE SUBJECT ERROR:", rollbackError);
    }

    console.error("REMOVE SUBJECT ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to remove subject from enrollment.",
    });
  } finally {
    connection.release();
  }
});

// =====================================================
// APPROVE ENROLLMENT
//
// POST /api/registrar/enrollments/:id/approve
//
// Purpose:
// - Approve a pending enrollment
// - Record the Registrar who approved it
// - Record approval date/time
// - Prevent duplicate approval
// - Ensure the enrollment has subjects
// - Use a database transaction
// =====================================================
router.post("/:id/approve", async (req, res) => {
  let connection;

  try {
    // =================================================
    // GET ENROLLMENT ID
    // =================================================

    const { id } = req.params;

    const enrollmentId = Number(id);

    // =================================================
    // VALIDATE ENROLLMENT ID
    // =================================================

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // GET APPROVING USER
    // =================================================

    const { approved_by } = req.body;

    const approvedBy = Number(approved_by);

    if (!Number.isInteger(approvedBy) || approvedBy <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid approving user.",
      });
    }

    // =================================================
    // GET DATABASE CONNECTION
    // =================================================

    connection = await db.getConnection();

    // =================================================
    // START TRANSACTION
    // =================================================

    await connection.beginTransaction();

    // =================================================
    // VERIFY APPROVING USER
    //
    // Make sure the supplied user actually exists
    // and has the Registrar role.
    // =================================================

    const [userRows] = await connection.execute(
      `
      SELECT
          u.user_id,
          u.username,
          r.role_name

      FROM users u

      INNER JOIN roles r
          ON r.role_id = u.role_id

      WHERE u.user_id = ?
        AND r.role_name = 'Registrar'
      `,
      [approvedBy],
    );

    if (userRows.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "Only a Registrar can approve an enrollment.",
      });
    }

    const approvingUser = userRows[0];

    // =================================================
    // GET ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
      SELECT
          e.enrollment_id,
          e.student_id,
          e.academic_year_id,
          e.semester_id,
          e.enrollment_status,
          e.remarks

      FROM enrollments e

      WHERE e.enrollment_id = ?

      FOR UPDATE
      `,
      [enrollmentId],
    );

    // =================================================
    // CHECK ENROLLMENT EXISTS
    // =================================================

    if (enrollmentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // CHECK ENROLLMENT STATUS
    // =================================================

    if (enrollment.enrollment_status !== "Pending") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: `Enrollment cannot be approved because its current status is '${enrollment.enrollment_status}'.`,
      });
    }

    // =================================================
    // GET ENROLLED SUBJECTS
    // =================================================

    const [subjectRows] = await connection.execute(
      `
      SELECT
          es.enrollment_subject_id,
          es.subject_id,
          es.section_id,
          es.section_subject_id,
          es.offering_id,
          es.status

      FROM enrollment_subjects es

      WHERE es.enrollment_id = ?
      `,
      [enrollmentId],
    );

    // =================================================
    // CHECK SUBJECTS
    // =================================================

    if (subjectRows.length === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Enrollment cannot be approved because it has no enrolled subjects.",
      });
    }

    // =================================================
    // APPROVE ENROLLMENT
    // =================================================

    await connection.execute(
      `
      UPDATE enrollments

      SET
          enrollment_status = 'Approved',
          approved_by = ?,
          approved_at = CURRENT_TIMESTAMP

      WHERE enrollment_id = ?
      `,
      [approvedBy, enrollmentId],
    );

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // SUCCESS RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,
      message: "Enrollment approved successfully.",

      enrollment: {
        enrollment_id: enrollmentId,
        student_id: enrollment.student_id,
        academic_year_id: enrollment.academic_year_id,
        semester_id: enrollment.semester_id,
        enrollment_status: "Approved",

        approved_by: {
          user_id: approvingUser.user_id,
          username: approvingUser.username,
        },
      },

      totalSubjects: subjectRows.length,
    });
  } catch (error) {
    // =================================================
    // ROLLBACK
    // =================================================

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("APPROVE ENROLLMENT ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("APPROVE ENROLLMENT ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to approve enrollment.",
    });
  } finally {
    // =================================================
    // RELEASE CONNECTION
    // =================================================

    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// REJECT ENROLLMENT
//
// POST /api/registrar/enrollments/:id/reject
//
// Body:
// {
//   "approved_by": 5,
//   "remarks": "Incomplete enrollment requirements."
// }
//
// Purpose:
// - Reject a pending enrollment
// - Record the Registrar who rejected it
// - Record the rejection reason
// - Record the rejection date/time
// - Prevent rejecting an already processed enrollment
// =====================================================
router.post("/:id/reject", async (req, res) => {
  let connection;

  try {
    // =================================================
    // GET ENROLLMENT ID
    // =================================================

    const { id } = req.params;
    const enrollmentId = Number(id);

    // =================================================
    // VALIDATE ENROLLMENT ID
    // =================================================

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // GET REJECTION INFORMATION
    // =================================================

    const { rejected_by, remarks } = req.body;

    const rejectedBy = Number(rejected_by);

    // =================================================
    // VALIDATE REGISTRAR ID
    // =================================================

    if (!Number.isInteger(rejectedBy) || rejectedBy <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid rejecting user.",
      });
    }

    // =================================================
    // VALIDATE REJECTION REASON
    // =================================================

    if (typeof remarks !== "string" || remarks.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Rejection reason is required.",
      });
    }

    const rejectionReason = remarks.trim();

    // =================================================
    // GET DATABASE CONNECTION
    // =================================================

    connection = await db.getConnection();

    // =================================================
    // START TRANSACTION
    // =================================================

    await connection.beginTransaction();

    // =================================================
    // VERIFY REGISTRAR
    // =================================================

    const [userRows] = await connection.execute(
      `
  SELECT
      u.user_id,
      u.username,
      r.role_name
  FROM users u
  INNER JOIN roles r
      ON r.role_id = u.role_id
  WHERE u.user_id = ?
    AND r.role_name = 'Registrar'
  LIMIT 1
  `,
      [rejectedBy],
    );
    // =================================================
    // CHECK REGISTRAR
    // =================================================

    if (userRows.length === 0) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "Only a Registrar can reject an enrollment.",
      });
    }

    const rejectingUser = userRows[0];

    // =================================================
    // GET ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
      SELECT
          enrollment_id,
          student_id,
          academic_year_id,
          semester_id,
          enrollment_status
      FROM enrollments
      WHERE enrollment_id = ?
      LIMIT 1
      `,
      [enrollmentId],
    );

    // =================================================
    // CHECK ENROLLMENT
    // =================================================

    if (enrollmentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // CHECK ENROLLMENT STATUS
    // =================================================

    if (enrollment.enrollment_status !== "Pending") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: `Cannot reject enrollment with status '${enrollment.enrollment_status}'.`,
      });
    }

    // =================================================
    // REJECT ENROLLMENT
    //
    // approved_by is reused here because the current
    // enrollments table has approved_by and does not
    // have a separate rejected_by column.
    // =================================================

    await connection.execute(
      `
      UPDATE enrollments
      SET
          enrollment_status = 'Rejected',
          remarks = ?,
          approved_by = ?,
          approved_at = NOW()
      WHERE enrollment_id = ?
      `,
      [rejectionReason, rejectingUser.user_id, enrollmentId],
    );

    // =================================================
    // GET SUBJECT COUNT
    // =================================================

    const [subjectRows] = await connection.execute(
      `
      SELECT COUNT(*) AS totalSubjects
      FROM enrollment_subjects
      WHERE enrollment_id = ?
      `,
      [enrollmentId],
    );

    const totalSubjects = Number(subjectRows[0].totalSubjects);

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // SUCCESS RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,
      message: "Enrollment rejected successfully.",
      enrollment: {
        enrollment_id: enrollment.enrollment_id,
        student_id: enrollment.student_id,
        academic_year_id: enrollment.academic_year_id,
        semester_id: enrollment.semester_id,
        enrollment_status: "Rejected",
        rejected_by: {
          user_id: rejectingUser.user_id,
          username: rejectingUser.username,
        },
        rejection_reason: rejectionReason,
      },
      totalSubjects,
    });
  } catch (error) {
    // =================================================
    // ROLLBACK ON ERROR
    // =================================================

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("REJECT ENROLLMENT ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to reject enrollment.",
      error: error.message,
    });
  } finally {
    // =================================================
    // RELEASE CONNECTION
    // =================================================

    if (connection) {
      connection.release();
    }
  }
});
// =====================================================
// ADD SUBJECT TO APPROVED ENROLLMENT
//
// POST /api/registrar/enrollments/:id/subjects
// =====================================================

router.post("/:id/subjects", async (req, res) => {
  let connection;

  try {
    // =================================================
    // GET ENROLLMENT ID
    // =================================================

    const { id } = req.params;
    const enrollmentId = Number(id);

    // =================================================
    // VALIDATE ENROLLMENT ID
    // =================================================

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // GET REQUEST DATA
    // =================================================

    const { offering_id, section_subject_id, section_id } = req.body;

    const offeringId = Number(offering_id);
    const sectionSubjectId = Number(section_subject_id);
    const sectionId = Number(section_id);

    // =================================================
    // VALIDATE OFFERING
    // =================================================

    if (!Number.isInteger(offeringId) || offeringId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid offering ID.",
      });
    }

    // =================================================
    // VALIDATE SECTION SUBJECT
    // =================================================

    if (!Number.isInteger(sectionSubjectId) || sectionSubjectId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid section subject ID.",
      });
    }

    // =================================================
    // VALIDATE SECTION
    // =================================================

    if (!Number.isInteger(sectionId) || sectionId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid section ID.",
      });
    }

    // =================================================
    // GET DATABASE CONNECTION
    // =================================================

    connection = await db.getConnection();

    // =================================================
    // START TRANSACTION
    // =================================================

    await connection.beginTransaction();

    // =================================================
    // GET ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
      SELECT
          e.enrollment_id,
          e.student_id,
          e.academic_year_id,
          e.semester_id,
          e.enrollment_status

      FROM enrollments e

      WHERE e.enrollment_id = ?

      LIMIT 1
      `,
      [enrollmentId],
    );

    // =================================================
    // CHECK ENROLLMENT
    // =================================================

    if (enrollmentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // ONLY APPROVED ENROLLMENTS CAN BE CORRECTED
    // =================================================

    if (enrollment.enrollment_status !== "Approved") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Only approved enrollments can have subjects added.",
      });
    }

    // =================================================
    // GET OFFERING
    // =================================================

    const [offeringRows] = await connection.execute(
      `
      SELECT
          so.offering_id,
          so.subject_id,
          so.section_id,
          so.section_subject_id,
          so.academic_year_id,
          so.semester_id,
          so.max_students,

          ss.status AS section_subject_status

      FROM subject_offerings so

      INNER JOIN section_subjects ss
          ON ss.section_subject_id = so.section_subject_id

      WHERE so.offering_id = ?
        AND so.section_subject_id = ?
        AND so.section_id = ?

      LIMIT 1
      `,
      [offeringId, sectionSubjectId, sectionId],
    );

    // =================================================
    // CHECK OFFERING
    // =================================================

    if (offeringRows.length === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Invalid offering, section subject, or section.",
      });
    }

    const offering = offeringRows[0];

    // =================================================
    // CHECK OFFERING PERIOD
    // =================================================

    if (
      Number(offering.academic_year_id) !==
        Number(enrollment.academic_year_id) ||
      Number(offering.semester_id) !== Number(enrollment.semester_id)
    ) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Offering does not belong to the enrollment's academic period.",
      });
    }

    // =================================================
    // CHECK OFFERING STATUS
    // =================================================

    if (offering.section_subject_status !== "Open") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "This subject offering is not open.",
      });
    }

    // =================================================
    // CHECK DUPLICATE SUBJECT
    // =================================================

    const [existingRows] = await connection.execute(
      `
      SELECT
          enrollment_subject_id

      FROM enrollment_subjects

      WHERE enrollment_id = ?
        AND subject_id = ?

      LIMIT 1
      `,
      [enrollmentId, offering.subject_id],
    );

    if (existingRows.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "Student is already enrolled in this subject.",
      });
    }

    // =================================================
    // CHECK CAPACITY
    // =================================================

    const [countRows] = await connection.execute(
      `
      SELECT
          COUNT(*) AS enrolled_count

      FROM enrollment_subjects es

      INNER JOIN enrollments e
          ON e.enrollment_id = es.enrollment_id

      WHERE es.offering_id = ?
        AND es.status = 'Enrolled'
        AND e.enrollment_status = 'Approved'
      `,
      [offeringId],
    );

    const enrolledCount = Number(countRows[0].enrolled_count);

    if (
      offering.max_students !== null &&
      enrolledCount >= Number(offering.max_students)
    ) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "This subject offering is already full.",
      });
    }

    // =================================================
    // INSERT SUBJECT
    // =================================================

    const [result] = await connection.execute(
      `
      INSERT INTO enrollment_subjects (
          enrollment_id,
          subject_id,
          offering_id,
          status,
          section_id,
          section_subject_id
      )
      VALUES (?, ?, ?, 'Enrolled', ?, ?)
      `,
      [
        enrollmentId,
        offering.subject_id,
        offeringId,
        sectionId,
        sectionSubjectId,
      ],
    );

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // SUCCESS
    // =================================================

    return res.status(201).json({
      success: true,
      message: "Subject added to approved enrollment successfully.",
      enrollment_subject_id: result.insertId,
      enrollment_id: enrollmentId,
      subject_id: offering.subject_id,
      offering_id: offeringId,
      section_id: sectionId,
      section_subject_id: sectionSubjectId,
    });
  } catch (error) {
    // =================================================
    // ROLLBACK
    // =================================================

    if (connection) {
      await connection.rollback();
    }

    console.error("ADD SUBJECT TO ENROLLMENT ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to add subject to enrollment.",
    });
  } finally {
    // =================================================
    // RELEASE CONNECTION
    // =================================================

    if (connection) {
      connection.release();
    }
  }
});
// =====================================================
// ADD SUBJECT TO APPROVED ENROLLMENT
//
// POST /api/registrar/enrollments/:id/subjects
// =====================================================

router.post("/:id/subjects", async (req, res) => {
  let connection;

  try {
    // =================================================
    // GET ENROLLMENT ID
    // =================================================

    const { id } = req.params;
    const enrollmentId = Number(id);

    // =================================================
    // VALIDATE ENROLLMENT ID
    // =================================================

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // GET REQUEST DATA
    // =================================================

    const { offering_id, section_subject_id, section_id } = req.body;

    const offeringId = Number(offering_id);
    const sectionSubjectId = Number(section_subject_id);
    const sectionId = Number(section_id);

    // =================================================
    // VALIDATE OFFERING
    // =================================================

    if (!Number.isInteger(offeringId) || offeringId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid offering ID.",
      });
    }

    // =================================================
    // VALIDATE SECTION SUBJECT
    // =================================================

    if (!Number.isInteger(sectionSubjectId) || sectionSubjectId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid section subject ID.",
      });
    }

    // =================================================
    // VALIDATE SECTION
    // =================================================

    if (!Number.isInteger(sectionId) || sectionId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid section ID.",
      });
    }

    // =================================================
    // GET DATABASE CONNECTION
    // =================================================

    connection = await db.getConnection();

    // =================================================
    // START TRANSACTION
    // =================================================

    await connection.beginTransaction();

    // =================================================
    // GET ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
      SELECT
          e.enrollment_id,
          e.student_id,
          e.academic_year_id,
          e.semester_id,
          e.enrollment_status

      FROM enrollments e

      WHERE e.enrollment_id = ?

      LIMIT 1
      `,
      [enrollmentId],
    );

    // =================================================
    // CHECK ENROLLMENT
    // =================================================

    if (enrollmentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // ONLY APPROVED ENROLLMENTS CAN BE CORRECTED
    // =================================================

    if (enrollment.enrollment_status !== "Approved") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Only approved enrollments can have subjects added.",
      });
    }

    // =================================================
    // GET OFFERING
    // =================================================

    const [offeringRows] = await connection.execute(
      `
      SELECT
          so.offering_id,
          so.subject_id,
          so.section_id,
          so.section_subject_id,
          so.academic_year_id,
          so.semester_id,
          so.max_students,

          ss.status AS section_subject_status

      FROM subject_offerings so

      INNER JOIN section_subjects ss
          ON ss.section_subject_id = so.section_subject_id

      WHERE so.offering_id = ?
        AND so.section_subject_id = ?
        AND so.section_id = ?

      LIMIT 1
      `,
      [offeringId, sectionSubjectId, sectionId],
    );

    // =================================================
    // CHECK OFFERING
    // =================================================

    if (offeringRows.length === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Invalid offering, section subject, or section.",
      });
    }

    const offering = offeringRows[0];

    // =================================================
    // CHECK OFFERING PERIOD
    // =================================================

    if (
      Number(offering.academic_year_id) !==
        Number(enrollment.academic_year_id) ||
      Number(offering.semester_id) !== Number(enrollment.semester_id)
    ) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Offering does not belong to the enrollment's academic period.",
      });
    }

    // =================================================
    // CHECK OFFERING STATUS
    // =================================================

    if (offering.section_subject_status !== "Open") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "This subject offering is not open.",
      });
    }

    // =================================================
    // CHECK DUPLICATE SUBJECT
    // =================================================

    const [existingRows] = await connection.execute(
      `
      SELECT
          enrollment_subject_id

      FROM enrollment_subjects

      WHERE enrollment_id = ?
        AND subject_id = ?

      LIMIT 1
      `,
      [enrollmentId, offering.subject_id],
    );

    if (existingRows.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "Student is already enrolled in this subject.",
      });
    }

    // =================================================
    // CHECK CAPACITY
    // =================================================

    const [countRows] = await connection.execute(
      `
      SELECT
          COUNT(*) AS enrolled_count

      FROM enrollment_subjects es

      INNER JOIN enrollments e
          ON e.enrollment_id = es.enrollment_id

      WHERE es.offering_id = ?
        AND es.status = 'Enrolled'
        AND e.enrollment_status = 'Approved'
      `,
      [offeringId],
    );

    const enrolledCount = Number(countRows[0].enrolled_count);

    if (
      offering.max_students !== null &&
      enrolledCount >= Number(offering.max_students)
    ) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "This subject offering is already full.",
      });
    }

    // =================================================
    // INSERT SUBJECT
    // =================================================

    const [result] = await connection.execute(
      `
      INSERT INTO enrollment_subjects (
          enrollment_id,
          subject_id,
          offering_id,
          status,
          section_id,
          section_subject_id
      )
      VALUES (?, ?, ?, 'Enrolled', ?, ?)
      `,
      [
        enrollmentId,
        offering.subject_id,
        offeringId,
        sectionId,
        sectionSubjectId,
      ],
    );

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // SUCCESS
    // =================================================

    return res.status(201).json({
      success: true,
      message: "Subject added to approved enrollment successfully.",
      enrollment_subject_id: result.insertId,
      enrollment_id: enrollmentId,
      subject_id: offering.subject_id,
      offering_id: offeringId,
      section_id: sectionId,
      section_subject_id: sectionSubjectId,
    });
  } catch (error) {
    // =================================================
    // ROLLBACK
    // =================================================

    if (connection) {
      await connection.rollback();
    }

    console.error("ADD SUBJECT TO ENROLLMENT ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to add subject to enrollment.",
    });
  } finally {
    // =================================================
    // RELEASE CONNECTION
    // =================================================

    if (connection) {
      connection.release();
    }
  }
});
// =====================================================
// REMOVE SUBJECT FROM APPROVED ENROLLMENT
//
// DELETE /api/registrar/enrollments/:id/subjects/:enrollment_subject_id
//
// Example:
// DELETE /api/registrar/enrollments/1/subjects/2
//
// Purpose:
// - Remove a subject from an approved enrollment
// - Verify enrollment exists
// - Verify enrollment is Approved
// - Verify subject belongs to enrollment
// - Delete the enrollment subject
// =====================================================

router.delete("/:id/subjects/:enrollment_subject_id", async (req, res) => {
  let connection;

  try {
    // =================================================
    // GET IDS
    // =================================================

    const { id, enrollment_subject_id } = req.params;

    const enrollmentId = Number(id);
    const enrollmentSubjectId = Number(enrollment_subject_id);

    // =================================================
    // VALIDATE ENROLLMENT ID
    // =================================================

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // VALIDATE ENROLLMENT SUBJECT ID
    // =================================================

    if (!Number.isInteger(enrollmentSubjectId) || enrollmentSubjectId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment subject ID.",
      });
    }

    // =================================================
    // GET DATABASE CONNECTION
    // =================================================

    connection = await db.getConnection();

    // =================================================
    // START TRANSACTION
    // =================================================

    await connection.beginTransaction();

    // =================================================
    // GET ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
        SELECT
            e.enrollment_id,
            e.student_id,
            e.academic_year_id,
            e.semester_id,
            e.enrollment_status

        FROM enrollments e

        WHERE e.enrollment_id = ?

        LIMIT 1

        FOR UPDATE
        `,
      [enrollmentId],
    );

    // =================================================
    // CHECK ENROLLMENT
    // =================================================

    if (enrollmentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // ONLY APPROVED ENROLLMENTS
    // =================================================

    if (enrollment.enrollment_status !== "Approved") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Only approved enrollments can have subjects removed.",
      });
    }

    // =================================================
    // GET ENROLLMENT SUBJECT
    //
    // Get the information BEFORE deleting it.
    // =================================================

    const [subjectRows] = await connection.execute(
      `
        SELECT
            es.enrollment_subject_id,
            es.enrollment_id,
            es.subject_id,
            es.offering_id,
            es.section_id,
            es.section_subject_id,
            es.status,

            s.subject_code,
            s.subject_name,
            s.units,

            sec.section_name

        FROM enrollment_subjects es

        INNER JOIN subjects s
            ON s.subject_id = es.subject_id

        LEFT JOIN sections sec
            ON sec.section_id = es.section_id

        WHERE es.enrollment_subject_id = ?
          AND es.enrollment_id = ?

        LIMIT 1

        FOR UPDATE
        `,
      [enrollmentSubjectId, enrollmentId],
    );

    // =================================================
    // CHECK SUBJECT
    // =================================================

    if (subjectRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment subject not found for this enrollment.",
      });
    }

    const enrollmentSubject = subjectRows[0];

    // =================================================
    // CHECK SUBJECT STATUS
    // =================================================

    if (enrollmentSubject.status !== "Enrolled") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: `Subject cannot be removed because its current status is '${enrollmentSubject.status}'.`,
      });
    }
    // =================================================
    // MARK SUBJECT AS DROPPED
    // =================================================

    const [updateResult] = await connection.execute(
      `
    UPDATE enrollment_subjects

    SET status = 'Dropped'

    WHERE enrollment_subject_id = ?
      AND enrollment_id = ?
    `,
      [enrollmentSubjectId, enrollmentId],
    );

    // =================================================
    // VERIFY UPDATE
    // =================================================

    if (updateResult.affectedRows === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Subject could not be removed.",
      });
    }
    // =================================================
    // GET REGISTRAR
    // =================================================

    const changedBy = req.user?.user_id || null;

    // =================================================
    // RECORD REMOVE HISTORY
    // =================================================

    await connection.execute(
      `
  INSERT INTO enrollment_subject_changes (

      enrollment_id,
      enrollment_subject_id,
      subject_id,

      change_type,

      old_offering_id,
      old_section_id,
      old_section_subject_id,

      new_offering_id,
      new_section_id,
      new_section_subject_id,

      reason,
      changed_by

  )
  VALUES (
      ?,
      ?,
      ?,
      'REMOVE',
      ?,
      ?,
      ?,
      NULL,
      NULL,
      NULL,
      ?,
      ?
  )
  `,
      [
        enrollmentId,
        enrollmentSubjectId,
        enrollmentSubject.subject_id,

        enrollmentSubject.offering_id,
        enrollmentSubject.section_id,
        enrollmentSubject.section_subject_id,

        req.body?.reason || "Registrar removed subject",

        changedBy,
      ],
    );
    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // SUCCESS RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,
      message: "Subject removed from enrollment successfully.",

      removed_subject: {
        enrollment_subject_id: enrollmentSubject.enrollment_subject_id,

        enrollment_id: enrollmentSubject.enrollment_id,

        subject_id: enrollmentSubject.subject_id,

        subject_code: enrollmentSubject.subject_code,

        subject_name: enrollmentSubject.subject_name,

        units: enrollmentSubject.units,

        offering_id: enrollmentSubject.offering_id,

        section_subject_id: enrollmentSubject.section_subject_id,

        section_id: enrollmentSubject.section_id,

        section_name: enrollmentSubject.section_name,

        previous_status: enrollmentSubject.status,
        status: "Dropped",
      },
    });
  } catch (error) {
    // =================================================
    // ROLLBACK
    // =================================================

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("REMOVE SUBJECT ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("REMOVE SUBJECT FROM ENROLLMENT ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to remove subject from enrollment.",
      error: error.message,
    });
  } finally {
    // =================================================
    // RELEASE CONNECTION
    // =================================================

    if (connection) {
      connection.release();
    }
  }
});
// =====================================================
// TRANSFER SUBJECT TO ANOTHER SECTION/OFFERING
//
// PUT /api/registrar/enrollments/:id/subjects/:enrollment_subject_id/transfer
//
// Example:
// PUT /api/registrar/enrollments/1/subjects/1/transfer
//
// Body:
// {
//   "target_section_subject_id": 3,
//   "reason": "Student requested transfer to another section."
// }
// Purpose:
// - Transfer an enrolled subject to another section
// - Verify enrollment exists
// - Verify enrollment is Approved
// - Verify current subject exists
// - Verify target section-subject exists
// - Verify target is the same subject
// - Verify target offering is Open
// - Verify academic year and semester match
// - Check target section capacity
// - Update offering/section information
// =====================================================

router.put(
  "/:id/subjects/:enrollment_subject_id/transfer",
  async (req, res) => {
    let connection;

    try {
      // =================================================
      // GET PARAMETERS
      // =================================================

      const { id, enrollment_subject_id } = req.params;

      const enrollmentId = Number(id);
      const enrollmentSubjectId = Number(enrollment_subject_id);

      // =================================================
      // GET BODY
      // =================================================

      const { target_section_subject_id, reason } = req.body;

      const targetSectionSubjectId = Number(target_section_subject_id);

      // =================================================
      // VALIDATE ENROLLMENT ID
      // =================================================

      if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid enrollment ID.",
        });
      }

      // =================================================
      // VALIDATE ENROLLMENT SUBJECT ID
      // =================================================

      if (!Number.isInteger(enrollmentSubjectId) || enrollmentSubjectId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid enrollment subject ID.",
        });
      }

      // =================================================
      // VALIDATE TARGET SECTION SUBJECT
      // =================================================

      if (
        !Number.isInteger(targetSectionSubjectId) ||
        targetSectionSubjectId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid target section subject ID.",
        });
      }

      // =================================================
      // VALIDATE REASON
      // =================================================

      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "Reason is required when transferring a subject.",
        });
      }

      connection = await db.getConnection();

      // =================================================
      // START TRANSACTION
      // =================================================

      await connection.beginTransaction();

      // =================================================
      // GET ENROLLMENT
      // =================================================

      const [enrollmentRows] = await connection.execute(
        `
        SELECT
            e.enrollment_id,
            e.student_id,
            e.academic_year_id,
            e.semester_id,
            e.enrollment_status

        FROM enrollments e

        WHERE e.enrollment_id = ?

        LIMIT 1

        FOR UPDATE
        `,
        [enrollmentId],
      );

      // =================================================
      // CHECK ENROLLMENT
      // =================================================

      if (enrollmentRows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message: "Enrollment not found.",
        });
      }

      const enrollment = enrollmentRows[0];

      // =================================================
      // ONLY APPROVED ENROLLMENTS
      // =================================================

      if (enrollment.enrollment_status !== "Approved") {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Only approved enrollments can have subjects transferred.",
        });
      }

      // =================================================
      // GET CURRENT ENROLLMENT SUBJECT
      // =================================================

      const [currentSubjectRows] = await connection.execute(
        `
        SELECT
            es.enrollment_subject_id,
            es.enrollment_id,
            es.subject_id,
            es.offering_id,
            es.section_id,
            es.section_subject_id,
            es.status,

            s.subject_code,
            s.subject_name,
            s.units,

            sec.section_name

        FROM enrollment_subjects es

        INNER JOIN subjects s
            ON s.subject_id = es.subject_id

        LEFT JOIN sections sec
            ON sec.section_id = es.section_id

        WHERE es.enrollment_subject_id = ?
          AND es.enrollment_id = ?

        LIMIT 1

        FOR UPDATE
        `,
        [enrollmentSubjectId, enrollmentId],
      );

      // =================================================
      // CHECK CURRENT SUBJECT
      // =================================================

      if (currentSubjectRows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message: "Enrollment subject not found for this enrollment.",
        });
      }

      const currentSubject = currentSubjectRows[0];

      // =================================================
      // CHECK CURRENT STATUS
      // =================================================

      if (currentSubject.status !== "Enrolled") {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: `Subject cannot be transferred because its current status is '${currentSubject.status}'.`,
        });
      }

      // =================================================
      // PREVENT SAME SECTION-SUBJECT
      // =================================================

      if (
        Number(currentSubject.section_subject_id) === targetSectionSubjectId
      ) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "The subject is already assigned to this section.",
        });
      }

      // =================================================
      // GET TARGET SECTION SUBJECT
      // =================================================

      const [targetRows] = await connection.execute(
        `
  SELECT
      ss.section_subject_id,
      ss.subject_id,
      ss.section_id,
      ss.academic_year_id,
      ss.semester_id,
      ss.status AS section_subject_status,

      so.offering_id,
      so.max_students,

      s.subject_code,
      s.subject_name,
      s.units,

      sec.section_name

  FROM section_subjects ss

  INNER JOIN subject_offerings so
      ON so.section_subject_id = ss.section_subject_id

  INNER JOIN subjects s
      ON s.subject_id = ss.subject_id

  INNER JOIN sections sec
      ON sec.section_id = ss.section_id

  WHERE ss.section_subject_id = ?

  LIMIT 1

  FOR UPDATE
  `,
        [targetSectionSubjectId],
      );

      // =================================================
      // CHECK TARGET
      // =================================================

      if (targetRows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message: "Target section subject not found.",
        });
      }

      const target = targetRows[0];

      // =================================================
      // VERIFY SAME SUBJECT
      // =================================================

      if (Number(target.subject_id) !== Number(currentSubject.subject_id)) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "The target section does not offer the same subject.",
        });
      }

      // =================================================
      // VERIFY ACADEMIC YEAR
      // =================================================

      if (
        Number(target.academic_year_id) !== Number(enrollment.academic_year_id)
      ) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Target section belongs to a different academic year.",
        });
      }

      // =================================================
      // VERIFY SEMESTER
      // =================================================

      if (Number(target.semester_id) !== Number(enrollment.semester_id)) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Target section belongs to a different semester.",
        });
      }

      // =================================================
      // VERIFY SECTION SUBJECT STATUS
      // =================================================

      if (target.section_subject_status !== "Open") {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Target section subject is not open.",
        });
      }

      // =================================================
      // CHECK CAPACITY
      // =================================================

      const [capacityRows] = await connection.execute(
        `
        SELECT
            COUNT(*) AS enrolled_count

        FROM enrollment_subjects es

        WHERE es.section_subject_id = ?
          AND es.status = 'Enrolled'
        `,
        [targetSectionSubjectId],
      );

      const enrolledCount = Number(capacityRows[0].enrolled_count);

      const maxStudents = Number(target.max_students);

      // =================================================
      // CHECK FULL SECTION
      // =================================================

      if (Number.isFinite(maxStudents) && enrolledCount >= maxStudents) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Target section is already full.",
          capacity: {
            enrolled: enrolledCount,
            max_students: maxStudents,
          },
        });
      }

      // =================================================
      // UPDATE ENROLLMENT SUBJECT
      // =================================================

      const [updateResult] = await connection.execute(
        `
        UPDATE enrollment_subjects

        SET
            offering_id = ?,
            section_id = ?,
            section_subject_id = ?

        WHERE enrollment_subject_id = ?
          AND enrollment_id = ?
        `,
        [
          target.offering_id,
          target.section_id,
          target.section_subject_id,
          enrollmentSubjectId,
          enrollmentId,
        ],
      );

      // =================================================
      // VERIFY UPDATE
      // =================================================

      if (updateResult.affectedRows === 0) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Subject could not be transferred.",
        });
      }

      // =================================================
      // COMMIT
      // =================================================

      await connection.commit();

      // =================================================
      // SUCCESS
      // =================================================

      return res.status(200).json({
        success: true,

        message: "Subject transferred to the new section successfully.",

        transferred_subject: {
          enrollment_subject_id: currentSubject.enrollment_subject_id,

          enrollment_id: currentSubject.enrollment_id,

          subject_id: currentSubject.subject_id,

          subject_code: currentSubject.subject_code,

          subject_name: currentSubject.subject_name,

          units: currentSubject.units,

          old_offering_id: currentSubject.offering_id,

          old_section_id: currentSubject.section_id,

          old_section_subject_id: currentSubject.section_subject_id,

          old_section_name: currentSubject.section_name,

          new_offering_id: target.offering_id,

          new_section_id: target.section_id,

          new_section_subject_id: target.section_subject_id,

          new_section_name: target.section_name,

          status: currentSubject.status,
        },

        history: {
          change_type: "TRANSFER",
          reason: reason.trim(),
        },
      });
    } catch (error) {
      // =================================================
      // ROLLBACK
      // =================================================

      if (connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("TRANSFER SUBJECT ROLLBACK ERROR:", rollbackError);
        }
      }

      console.error("TRANSFER SUBJECT ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to transfer subject.",
        error: error.message,
      });
    } finally {
      // =================================================
      // RELEASE CONNECTION
      // =================================================

      if (connection) {
        connection.release();
      }
    }
  },
);
// =====================================================
// UPDATE ENROLLMENT SUBJECT STATUS
//
// PUT /api/registrar/enrollments/:id/subjects/:enrollment_subject_id/status
//
// Example:
// PUT /api/registrar/enrollments/1/subjects/1/status
//
// Body:
// {
//   "status": "Dropped",
//   "reason": "Student requested to drop the subject."
// }
//
// Purpose:
// - Change the status of a subject inside an approved enrollment
// - Verify enrollment exists
// - Verify enrollment is Approved
// - Verify subject belongs to enrollment
// - Require a reason
// =====================================================

router.put("/:id/subjects/:enrollment_subject_id/status", async (req, res) => {
  let connection;

  try {
    // =================================================
    // GET PARAMETERS
    // =================================================

    const { id, enrollment_subject_id } = req.params;

    const enrollmentId = Number(id);
    const enrollmentSubjectId = Number(enrollment_subject_id);

    // =================================================
    // GET BODY
    // =================================================

    const { status, reason } = req.body;

    // =================================================
    // VALIDATE ENROLLMENT ID
    // =================================================

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // VALIDATE ENROLLMENT SUBJECT ID
    // =================================================

    if (!Number.isInteger(enrollmentSubjectId) || enrollmentSubjectId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment subject ID.",
      });
    }

    // =================================================
    // VALIDATE STATUS
    // =================================================

    const allowedStatuses = ["Enrolled", "Dropped", "Cancelled", "Incomplete"];

    if (
      !status ||
      typeof status !== "string" ||
      !allowedStatuses.includes(status)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid subject status.",
        allowed_statuses: allowedStatuses,
      });
    }

    // =================================================
    // VALIDATE REASON
    // =================================================

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Reason is required when changing subject status.",
      });
    }

    // =================================================
    // GET DATABASE CONNECTION
    // =================================================

    connection = await db.getConnection();

    // =================================================
    // START TRANSACTION
    // =================================================

    await connection.beginTransaction();

    // =================================================
    // GET ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
        SELECT
            e.enrollment_id,
            e.student_id,
            e.academic_year_id,
            e.semester_id,
            e.enrollment_status

        FROM enrollments e

        WHERE e.enrollment_id = ?

        LIMIT 1

        FOR UPDATE
        `,
      [enrollmentId],
    );

    // =================================================
    // CHECK ENROLLMENT
    // =================================================

    if (enrollmentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // ONLY APPROVED ENROLLMENTS
    // =================================================

    if (enrollment.enrollment_status !== "Approved") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Only approved enrollments can have subject statuses changed.",
      });
    }

    // =================================================
    // GET ENROLLMENT SUBJECT
    // =================================================

    const [subjectRows] = await connection.execute(
      `
        SELECT
            es.enrollment_subject_id,
            es.enrollment_id,
            es.subject_id,
            es.offering_id,
            es.section_id,
            es.section_subject_id,
            es.status,

            s.subject_code,
            s.subject_name,
            s.units,

            sec.section_name

        FROM enrollment_subjects es

        INNER JOIN subjects s
            ON s.subject_id = es.subject_id

        LEFT JOIN sections sec
            ON sec.section_id = es.section_id

        WHERE es.enrollment_subject_id = ?
          AND es.enrollment_id = ?

        LIMIT 1

        FOR UPDATE
        `,
      [enrollmentSubjectId, enrollmentId],
    );

    // =================================================
    // CHECK SUBJECT
    // =================================================

    if (subjectRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment subject not found for this enrollment.",
      });
    }

    const enrollmentSubject = subjectRows[0];

    // =================================================
    // PREVENT SAME STATUS
    // =================================================

    if (enrollmentSubject.status === status) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: `Subject is already '${status}'.`,
      });
    }

    // =================================================
    // UPDATE STATUS
    // =================================================

    const [updateResult] = await connection.execute(
      `
        UPDATE enrollment_subjects

        SET status = ?

        WHERE enrollment_subject_id = ?
          AND enrollment_id = ?
        `,
      [status, enrollmentSubjectId, enrollmentId],
    );

    // =================================================
    // VERIFY UPDATE
    // =================================================

    if (updateResult.affectedRows === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Subject status could not be updated.",
      });
    }

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // SUCCESS RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      message: "Enrollment subject status updated successfully.",

      subject: {
        enrollment_subject_id: enrollmentSubject.enrollment_subject_id,

        enrollment_id: enrollmentSubject.enrollment_id,

        subject_id: enrollmentSubject.subject_id,

        subject_code: enrollmentSubject.subject_code,

        subject_name: enrollmentSubject.subject_name,

        units: enrollmentSubject.units,

        section_id: enrollmentSubject.section_id,

        section_name: enrollmentSubject.section_name,

        previous_status: enrollmentSubject.status,

        new_status: status,
      },

      history: {
        change_type: "STATUS_CHANGE",
        reason: reason.trim(),
      },
    });
  } catch (error) {
    // =================================================
    // ROLLBACK
    // =================================================

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("UPDATE SUBJECT STATUS ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("UPDATE ENROLLMENT SUBJECT STATUS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update enrollment subject status.",
      error: error.message,
    });
  } finally {
    // =================================================
    // RELEASE CONNECTION
    // =================================================

    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// UPDATE ENROLLMENT STATUS
//
// PUT /api/registrar/enrollments/:id/status
//
// Example:
// PUT /api/registrar/enrollments/1/status
//
// Body:
// {
//   "status": "Cancelled",
//   "reason": "Registrar cancelled enrollment for testing."
// }
//
// Purpose:
// - Change the overall enrollment status
// - Verify enrollment exists
// - Require a valid status
// - Require a reason
// - Record approval information when Approved
// =====================================================

router.put("/:id/status", async (req, res) => {
  let connection;

  try {
    // =================================================
    // GET ENROLLMENT ID
    // =================================================

    const { id } = req.params;

    const enrollmentId = Number(id);

    // =================================================
    // GET BODY
    // =================================================

    const { status, reason } = req.body;

    // =================================================
    // VALIDATE ENROLLMENT ID
    // =================================================

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // VALIDATE STATUS
    // =================================================

    const allowedStatuses = ["Pending", "Approved", "Rejected", "Cancelled"];

    if (
      !status ||
      typeof status !== "string" ||
      !allowedStatuses.includes(status)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment status.",
        allowed_statuses: allowedStatuses,
      });
    }

    // =================================================
    // VALIDATE REASON
    // =================================================

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Reason is required when changing enrollment status.",
      });
    }

    // =================================================
    // DATABASE CONNECTION
    // =================================================

    connection = await db.getConnection();

    // =================================================
    // START TRANSACTION
    // =================================================

    await connection.beginTransaction();

    // =================================================
    // GET ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
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

      WHERE e.enrollment_id = ?

      LIMIT 1

      FOR UPDATE
      `,
      [enrollmentId],
    );

    // =================================================
    // CHECK ENROLLMENT
    // =================================================

    if (enrollmentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // PREVENT SAME STATUS
    // =================================================

    if (enrollment.enrollment_status === status) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: `Enrollment is already '${status}'.`,
      });
    }

    // =================================================
    // UPDATE ENROLLMENT
    //
    // If Approved:
    // record registrar/user ID and approval time.
    //
    // If another status:
    // clear approval information.
    // =================================================

    let updateResult;

    if (status === "Approved") {
      const approvedBy = req.user?.user_id || null;

      [updateResult] = await connection.execute(
        `
        UPDATE enrollments

        SET
            enrollment_status = ?,
            remarks = ?,
            approved_by = ?,
            approved_at = CURRENT_TIMESTAMP

        WHERE enrollment_id = ?
        `,
        [status, reason.trim(), approvedBy, enrollmentId],
      );
    } else {
      [updateResult] = await connection.execute(
        `
        UPDATE enrollments

        SET
            enrollment_status = ?,
            remarks = ?,
            approved_by = NULL,
            approved_at = NULL

        WHERE enrollment_id = ?
        `,
        [status, reason.trim(), enrollmentId],
      );
    }

    // =================================================
    // VERIFY UPDATE
    // =================================================

    if (updateResult.affectedRows === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Enrollment status could not be updated.",
      });
    }

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // SUCCESS RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      message: "Enrollment status updated successfully.",

      enrollment: {
        enrollment_id: enrollment.enrollment_id,

        student_id: enrollment.student_id,

        academic_year_id: enrollment.academic_year_id,

        semester_id: enrollment.semester_id,

        previous_status: enrollment.enrollment_status,

        new_status: status,

        remarks: reason.trim(),

        approved_by: status === "Approved" ? req.user?.user_id || null : null,
      },

      history: {
        change_type: "ENROLLMENT_STATUS_CHANGE",
        reason: reason.trim(),
      },
    });
  } catch (error) {
    // =================================================
    // ROLLBACK
    // =================================================

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "UPDATE ENROLLMENT STATUS ROLLBACK ERROR:",
          rollbackError,
        );
      }
    }

    console.error("UPDATE ENROLLMENT STATUS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update enrollment status.",
      error: error.message,
    });
  } finally {
    // =================================================
    // RELEASE CONNECTION
    // =================================================

    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// GET AVAILABLE SECTION SUBJECTS FOR A SUBJECT
//
// GET /api/registrar/enrollments/:id/available-subjects/:subject_id
//
// Example:
// GET /api/registrar/enrollments/1/available-subjects/1
//
// Purpose:
// - Find sections where a subject can be added/transferred
// - Same academic year
// - Same semester
// - Same subject
// - Section subject must be Open
// - Subject offering must be available
// - Exclude the student's current section
// - Exclude full sections
// =====================================================

router.get("/:id/available-subjects/:subject_id", async (req, res) => {
  let connection;

  try {
    // =================================================
    // GET PARAMETERS
    // =================================================

    const { id, subject_id } = req.params;

    const enrollmentId = Number(id);
    const subjectId = Number(subject_id);

    // =================================================
    // VALIDATE ENROLLMENT ID
    // =================================================

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // VALIDATE SUBJECT ID
    // =================================================

    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid subject ID.",
      });
    }

    // =================================================
    // DATABASE CONNECTION
    // =================================================

    connection = await db.getConnection();

    // =================================================
    // GET ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
        SELECT
            e.enrollment_id,
            e.student_id,
            e.academic_year_id,
            e.semester_id,
            e.enrollment_status

        FROM enrollments e

        WHERE e.enrollment_id = ?

        LIMIT 1
        `,
      [enrollmentId],
    );

    // =================================================
    // CHECK ENROLLMENT
    // =================================================

    if (enrollmentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // ONLY APPROVED ENROLLMENTS
    // =================================================

    if (enrollment.enrollment_status !== "Approved") {
      return res.status(400).json({
        success: false,
        message:
          "Available subjects can only be retrieved for approved enrollments.",
      });
    }

    // =================================================
    // GET SUBJECT
    // =================================================

    const [subjectRows] = await connection.execute(
      `
        SELECT
            subject_id,
            subject_code,
            subject_name,
            units

        FROM subjects

        WHERE subject_id = ?

        LIMIT 1
        `,
      [subjectId],
    );

    // =================================================
    // CHECK SUBJECT
    // =================================================

    if (subjectRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Subject not found.",
      });
    }

    const subject = subjectRows[0];

    // =================================================
    // GET AVAILABLE SECTION SUBJECTS
    //
    // section_subjects:
    //   contains section + subject + AY + semester
    //
    // subject_offerings:
    //   contains offering + schedule + capacity
    // =================================================

    const [rows] = await connection.execute(
      `
        SELECT
            ss.section_subject_id,

            ss.section_id,
            sec.section_name,

            ss.subject_id,

            ss.academic_year_id,
            ss.semester_id,

            ss.max_students,
            ss.status AS section_subject_status,

            so.offering_id,
            so.faculty_id,
            so.room_id,
            so.schedule_days,
            so.schedule_time,
            so.max_students AS offering_max_students,

            s.subject_code,
            s.subject_name,
            s.units,

            (
                SELECT COUNT(*)
                FROM enrollment_subjects es2
                WHERE es2.section_subject_id = ss.section_subject_id
                  AND es2.status = 'Enrolled'
            ) AS enrolled_count

        FROM section_subjects ss

        INNER JOIN subject_offerings so
          ON so.section_subject_id = ss.section_subject_id

        INNER JOIN sections sec
            ON sec.section_id = ss.section_id

        INNER JOIN subjects s
            ON s.subject_id = ss.subject_id

        WHERE ss.subject_id = ?

          AND ss.academic_year_id = ?

          AND ss.semester_id = ?

          AND ss.status = 'Open'

        ORDER BY
            sec.section_name ASC
        `,
      [subjectId, enrollment.academic_year_id, enrollment.semester_id],
    );

    // =================================================
    // FILTER AVAILABLE SECTIONS
    // =================================================

    const availableSections = rows
      .filter((row) => {
        const enrolledCount = Number(row.enrolled_count || 0);

        const maxStudents = Number(
          row.offering_max_students ?? row.max_students ?? 0,
        );

        // ---------------------------------------------
        // Check capacity
        // ---------------------------------------------

        if (maxStudents > 0 && enrolledCount >= maxStudents) {
          return false;
        }

        return true;
      })
      .map((row) => ({
        section_subject_id: row.section_subject_id,

        offering_id: row.offering_id,

        section_id: row.section_id,

        section_name: row.section_name,

        subject_id: row.subject_id,

        subject_code: row.subject_code,

        subject_name: row.subject_name,

        units: row.units,

        academic_year_id: row.academic_year_id,

        semester_id: row.semester_id,

        faculty_id: row.faculty_id,

        room_id: row.room_id,

        schedule_days: row.schedule_days,

        schedule_time: row.schedule_time,

        enrolled_count: Number(row.enrolled_count || 0),

        max_students: Number(
          row.offering_max_students ?? row.max_students ?? 0,
        ),

        status: row.section_subject_status,
      }));

    // =================================================
    // SUCCESS
    // =================================================

    return res.status(200).json({
      success: true,

      enrollment: {
        enrollment_id: enrollment.enrollment_id,

        student_id: enrollment.student_id,

        academic_year_id: enrollment.academic_year_id,

        semester_id: enrollment.semester_id,

        enrollment_status: enrollment.enrollment_status,
      },

      subject: {
        subject_id: subject.subject_id,

        subject_code: subject.subject_code,

        subject_name: subject.subject_name,

        units: subject.units,
      },

      total: availableSections.length,

      available_sections: availableSections,
    });
  } catch (error) {
    console.error("GET AVAILABLE SECTION SUBJECTS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve available section subjects.",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

router.post("/:id/subjects", async (req, res) => {
  let connection;

  try {
    // =================================================
    // GET PARAMETERS
    // =================================================

    const { id } = req.params;

    const enrollmentId = Number(id);

    // =================================================
    // GET BODY
    // =================================================

    const { section_subject_id, reason } = req.body;

    const sectionSubjectId = Number(section_subject_id);

    // =================================================
    // VALIDATE ENROLLMENT ID
    // =================================================

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // VALIDATE SECTION SUBJECT ID
    // =================================================

    if (!Number.isInteger(sectionSubjectId) || sectionSubjectId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid section subject ID.",
      });
    }

    // =================================================
    // VALIDATE REASON
    // =================================================

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Reason is required when adding a subject.",
      });
    }

    // =================================================
    // DATABASE CONNECTION
    // =================================================

    connection = await db.getConnection();

    // =================================================
    // START TRANSACTION
    // =================================================

    await connection.beginTransaction();

    // =================================================
    // GET ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
          SELECT
              e.enrollment_id,
              e.student_id,
              e.academic_year_id,
              e.semester_id,
              e.enrollment_status

          FROM enrollments e

          WHERE e.enrollment_id = ?

          LIMIT 1

          FOR UPDATE
          `,
      [enrollmentId],
    );

    // =================================================
    // CHECK ENROLLMENT
    // =================================================

    if (enrollmentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // ONLY APPROVED ENROLLMENTS
    // =================================================

    if (enrollment.enrollment_status !== "Approved") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Subjects can only be added to approved enrollments.",
      });
    }

    // =================================================
    // GET TARGET SECTION SUBJECT
    // =================================================

    const [sectionRows] = await connection.execute(
      `
          SELECT

              ss.section_subject_id,
              ss.section_id,
              ss.subject_id,
              ss.academic_year_id,
              ss.semester_id,
              ss.max_students,
              ss.status AS section_subject_status,

              so.offering_id,
              so.faculty_id,
              so.room_id,
              so.schedule_days,
              so.schedule_time,

              COALESCE(
                  so.max_students,
                  ss.max_students,
                  0
              ) AS offering_max_students,

              s.subject_code,
              s.subject_name,
              s.units,

              sec.section_name

          FROM section_subjects ss

          INNER JOIN subject_offerings so
              ON so.section_subject_id =
                 ss.section_subject_id

          INNER JOIN subjects s
              ON s.subject_id =
                 ss.subject_id

          INNER JOIN sections sec
              ON sec.section_id =
                 ss.section_id

          WHERE ss.section_subject_id = ?

          LIMIT 1

          FOR UPDATE
          `,
      [sectionSubjectId],
    );

    // =================================================
    // CHECK TARGET SECTION SUBJECT
    // =================================================

    if (sectionRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Section subject not found.",
      });
    }

    const target = sectionRows[0];

    // =================================================
    // VERIFY ACADEMIC YEAR
    // =================================================

    if (
      Number(target.academic_year_id) !== Number(enrollment.academic_year_id)
    ) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Section subject belongs to a different academic year.",
      });
    }

    // =================================================
    // VERIFY SEMESTER
    // =================================================

    if (Number(target.semester_id) !== Number(enrollment.semester_id)) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Section subject belongs to a different semester.",
      });
    }

    // =================================================
    // VERIFY SECTION SUBJECT STATUS
    // =================================================

    if (target.section_subject_status !== "Open") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Section subject is not open.",
      });
    }

    // =================================================
    // CHECK IF SUBJECT IS ALREADY ENROLLED
    // =================================================

    const [existingRows] = await connection.execute(
      `
          SELECT
              enrollment_subject_id,
              status

          FROM enrollment_subjects

          WHERE enrollment_id = ?
            AND subject_id = ?

          LIMIT 1

          FOR UPDATE
          `,
      [enrollmentId, target.subject_id],
    );

    // =================================================
    // HANDLE EXISTING SUBJECT
    // =================================================

    if (existingRows.length > 0) {
      const existing = existingRows[0];

      // -----------------------------------------------
      // ALREADY ENROLLED
      // -----------------------------------------------

      if (existing.status === "Enrolled") {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Student is already enrolled in this subject.",
        });
      }

      // -----------------------------------------------
      // DROPPED / PREVIOUS RECORD
      //
      // Instead of creating a duplicate row,
      // restore the existing enrollment record.
      // -----------------------------------------------

      const [restoreResult] = await connection.execute(
        `
            UPDATE enrollment_subjects

            SET
                offering_id = ?,
                section_id = ?,
                section_subject_id = ?,
                status = 'Enrolled'

            WHERE enrollment_subject_id = ?
              AND enrollment_id = ?
            `,
        [
          target.offering_id,
          target.section_id,
          target.section_subject_id,
          existing.enrollment_subject_id,
          enrollmentId,
        ],
      );

      if (restoreResult.affectedRows === 0) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Existing subject could not be restored.",
        });
      }

      await connection.commit();

      return res.status(200).json({
        success: true,

        message: "Previously dropped subject has been added back successfully.",

        restored: true,

        subject: {
          enrollment_subject_id: existing.enrollment_subject_id,

          enrollment_id: enrollmentId,

          subject_id: target.subject_id,

          subject_code: target.subject_code,

          subject_name: target.subject_name,

          units: target.units,

          offering_id: target.offering_id,

          section_id: target.section_id,

          section_subject_id: target.section_subject_id,

          section_name: target.section_name,

          status: "Enrolled",
        },

        history: {
          change_type: "ADD",
          reason: reason.trim(),
        },
      });
    }

    // =================================================
    // CHECK SECTION CAPACITY
    // =================================================

    const [capacityRows] = await connection.execute(
      `
          SELECT
              COUNT(*) AS enrolled_count

          FROM enrollment_subjects

          WHERE section_subject_id = ?
            AND status = 'Enrolled'
          `,
      [sectionSubjectId],
    );

    const enrolledCount = Number(capacityRows[0].enrolled_count || 0);

    const maxStudents = Number(
      target.offering_max_students || target.max_students || 0,
    );

    // =================================================
    // CHECK FULL SECTION
    // =================================================

    if (maxStudents > 0 && enrolledCount >= maxStudents) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Target section is already full.",

        capacity: {
          enrolled: enrolledCount,

          max_students: maxStudents,
        },
      });
    }

    // =================================================
    // INSERT NEW ENROLLMENT SUBJECT
    // =================================================

    const [insertResult] = await connection.execute(
      `
          INSERT INTO enrollment_subjects
          (
              enrollment_id,
              subject_id,
              offering_id,
              section_id,
              section_subject_id,
              status
          )

          VALUES
          (
              ?,
              ?,
              ?,
              ?,
              ?,
              'Enrolled'
          )
          `,
      [
        enrollmentId,
        target.subject_id,
        target.offering_id,
        target.section_id,
        target.section_subject_id,
      ],
    );

    // =================================================
    // VERIFY INSERT
    // =================================================

    if (insertResult.affectedRows === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Subject could not be added.",
      });
    }

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // SUCCESS RESPONSE
    // =================================================

    return res.status(201).json({
      success: true,

      message: "Subject added to enrollment successfully.",

      subject: {
        enrollment_subject_id: insertResult.insertId,

        enrollment_id: enrollmentId,

        subject_id: target.subject_id,

        subject_code: target.subject_code,

        subject_name: target.subject_name,

        units: target.units,

        offering_id: target.offering_id,

        section_id: target.section_id,

        section_subject_id: target.section_subject_id,

        section_name: target.section_name,

        faculty_id: target.faculty_id,

        room_id: target.room_id,

        schedule_days: target.schedule_days,

        schedule_time: target.schedule_time,

        status: "Enrolled",
      },

      history: {
        change_type: "ADD",
        reason: reason.trim(),
      },
    });
  } catch (error) {
    // =================================================
    // ROLLBACK
    // =================================================

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("ADD SUBJECT ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("ADD SUBJECT ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to add subject to enrollment.",
      error: error.message,
    });
  } finally {
    // =================================================
    // RELEASE CONNECTION
    // =================================================

    if (connection) {
      connection.release();
    }
  }
});
// =====================================================
// GET SUBJECTS AVAILABLE FOR ADDITION
//
// GET /api/registrar/enrollments/:id/available-subjects
//
// Example:
// GET /api/registrar/enrollments/1/available-subjects
//
// Purpose:
// - Find subjects that can be added to an enrollment
// - Same academic year
// - Same semester
// - Same course
// - Must have an open section
// - Must have available capacity
// - Must not already be enrolled
// =====================================================

router.get("/:id/available-subjects", async (req, res) => {
  let connection;

  try {
    // =================================================
    // GET ENROLLMENT ID
    // =================================================

    const { id } = req.params;

    const enrollmentId = Number(id);

    // =================================================
    // VALIDATE ENROLLMENT ID
    // =================================================

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // DATABASE CONNECTION
    // =================================================

    connection = await db.getConnection();

    // =================================================
    // GET ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
        SELECT
            e.enrollment_id,
            e.student_id,
            e.academic_year_id,
            e.semester_id,
            e.enrollment_status,

            s.course_id,
            c.course_code,
            c.course_name

        FROM enrollments e

        INNER JOIN students s
            ON s.student_id = e.student_id

        LEFT JOIN courses c
            ON c.course_id = s.course_id

        WHERE e.enrollment_id = ?

        LIMIT 1
        `,
      [enrollmentId],
    );

    // =================================================
    // CHECK ENROLLMENT
    // =================================================

    if (enrollmentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // ONLY APPROVED ENROLLMENTS
    // =================================================

    if (enrollment.enrollment_status !== "Approved") {
      return res.status(400).json({
        success: false,
        message: "Subjects can only be added to approved enrollments.",
      });
    }

    // =================================================
    // GET AVAILABLE SUBJECTS
    //
    // We use section_subjects because this tells us
    // which subjects are actually being offered
    // to sections for the current AY and semester.
    // =================================================

    const [rows] = await connection.execute(
      `
        SELECT DISTINCT

            ss.subject_id,

            s.subject_code,
            s.subject_name,
            s.units,

            ss.academic_year_id,
            ss.semester_id,

            ss.section_subject_id,
            ss.section_id,

            sec.section_name,

            ss.status AS section_subject_status,

            so.offering_id,
            so.faculty_id,
            so.room_id,
            so.schedule_days,
            so.schedule_time,

            COALESCE(
                so.max_students,
                ss.max_students,
                0
            ) AS max_students,

            (
                SELECT COUNT(*)

                FROM enrollment_subjects es2

                WHERE es2.section_subject_id =
                      ss.section_subject_id

                  AND es2.status = 'Enrolled'

            ) AS enrolled_count

        FROM section_subjects ss

        INNER JOIN subjects s
            ON s.subject_id = ss.subject_id

        INNER JOIN sections sec
            ON sec.section_id = ss.section_id

        INNER JOIN subject_offerings so
            ON so.section_subject_id =
               ss.section_subject_id

        WHERE ss.academic_year_id = ?

          AND ss.semester_id = ?

          AND ss.status = 'Open'

          AND so.academic_year_id = ?

          AND so.semester_id = ?

          AND NOT EXISTS (

              SELECT 1

              FROM enrollment_subjects es

              WHERE es.enrollment_id = ?

                AND es.subject_id = ss.subject_id

                AND es.status = 'Enrolled'

          )

        ORDER BY
            s.subject_code ASC,
            sec.section_name ASC
        `,
      [
        enrollment.academic_year_id,
        enrollment.semester_id,

        enrollment.academic_year_id,
        enrollment.semester_id,

        enrollmentId,
      ],
    );

    // =================================================
    // GROUP SUBJECTS
    //
    // One subject can have multiple sections.
    // We return one subject with its available
    // sections.
    // =================================================

    const subjectMap = new Map();

    for (const row of rows) {
      const subjectId = Number(row.subject_id);

      const enrolledCount = Number(row.enrolled_count || 0);

      const maxStudents = Number(row.max_students || 0);

      // ===============================================
      // CHECK CAPACITY
      // ===============================================

      if (maxStudents > 0 && enrolledCount >= maxStudents) {
        continue;
      }

      // ===============================================
      // CREATE SUBJECT
      // ===============================================

      if (!subjectMap.has(subjectId)) {
        subjectMap.set(subjectId, {
          subject_id: subjectId,

          subject_code: row.subject_code,

          subject_name: row.subject_name,

          units: row.units,

          academic_year_id: row.academic_year_id,

          semester_id: row.semester_id,

          available_sections: [],
        });
      }

      // ===============================================
      // ADD SECTION
      // ===============================================

      subjectMap.get(subjectId).available_sections.push({
        section_subject_id: row.section_subject_id,

        offering_id: row.offering_id,

        section_id: row.section_id,

        section_name: row.section_name,

        faculty_id: row.faculty_id,

        room_id: row.room_id,

        schedule_days: row.schedule_days,

        schedule_time: row.schedule_time,

        enrolled_count: enrolledCount,

        max_students: maxStudents,

        status: row.section_subject_status,
      });
    }

    // =================================================
    // CONVERT MAP TO ARRAY
    // =================================================

    const availableSubjects = Array.from(subjectMap.values());

    // =================================================
    // SUCCESS RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      enrollment: {
        enrollment_id: enrollment.enrollment_id,

        student_id: enrollment.student_id,

        course_id: enrollment.course_id,

        course_code: enrollment.course_code,

        course_name: enrollment.course_name,

        academic_year_id: enrollment.academic_year_id,

        semester_id: enrollment.semester_id,

        enrollment_status: enrollment.enrollment_status,
      },

      totalSubjects: availableSubjects.length,

      subjects: availableSubjects,
    });
  } catch (error) {
    // =================================================
    // ERROR
    // =================================================

    console.error("GET AVAILABLE SUBJECTS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve available subjects.",
      error: error.message,
    });
  } finally {
    // =================================================
    // RELEASE CONNECTION
    // =================================================

    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// REPLACE SUBJECT IN APPROVED ENROLLMENT
//
// PUT /api/registrar/enrollments/:id/subjects/:enrollment_subject_id/replace
//
// Example:
// PUT /api/registrar/enrollments/1/subjects/3/replace
//
// Body:
// {
//   "offering_id": 2,
//   "section_subject_id": 3,
//   "section_id": 1,
//   "reason": "Student was assigned to the wrong subject."
// }
//
// Purpose:
// - Replace an existing enrolled subject
// - Only works on Approved enrollments
// - Verify old subject belongs to enrollment
// - Verify new offering is valid
// - Verify new offering belongs to same academic period
// - Verify new subject is not already enrolled
// - Verify new offering has available capacity
// - Require replacement reason
// - Remove old subject
// - Add new subject
// - Everything happens inside ONE transaction
// =====================================================

router.put("/:id/subjects/:enrollment_subject_id/replace", async (req, res) => {
  let connection;

  try {
    // =================================================
    // GET IDS
    // =================================================

    const { id, enrollment_subject_id } = req.params;

    const enrollmentId = Number(id);
    const enrollmentSubjectId = Number(enrollment_subject_id);

    // =================================================
    // VALIDATE ENROLLMENT ID
    // =================================================

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // VALIDATE ENROLLMENT SUBJECT ID
    // =================================================

    if (!Number.isInteger(enrollmentSubjectId) || enrollmentSubjectId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment subject ID.",
      });
    }

    // =================================================
    // GET REQUEST DATA
    // =================================================

    const { offering_id, section_subject_id, section_id, reason } = req.body;

    const offeringId = Number(offering_id);
    const sectionSubjectId = Number(section_subject_id);
    const sectionId = Number(section_id);

    // =================================================
    // VALIDATE OFFERING ID
    // =================================================

    if (!Number.isInteger(offeringId) || offeringId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid replacement offering ID.",
      });
    }

    // =================================================
    // VALIDATE SECTION SUBJECT ID
    // =================================================

    if (!Number.isInteger(sectionSubjectId) || sectionSubjectId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid replacement section subject ID.",
      });
    }

    // =================================================
    // VALIDATE SECTION ID
    // =================================================

    if (!Number.isInteger(sectionId) || sectionId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid replacement section ID.",
      });
    }

    // =================================================
    // VALIDATE REASON
    // =================================================

    if (typeof reason !== "string" || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Replacement reason is required.",
      });
    }

    const replacementReason = reason.trim();

    // =================================================
    // GET DATABASE CONNECTION
    // =================================================

    connection = await db.getConnection();

    // =================================================
    // START TRANSACTION
    // =================================================

    await connection.beginTransaction();

    // =================================================
    // GET ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
        SELECT
            e.enrollment_id,
            e.student_id,
            e.academic_year_id,
            e.semester_id,
            e.enrollment_status

        FROM enrollments e

        WHERE e.enrollment_id = ?

        LIMIT 1

        FOR UPDATE
        `,
      [enrollmentId],
    );

    // =================================================
    // CHECK ENROLLMENT
    // =================================================

    if (enrollmentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // ONLY APPROVED ENROLLMENTS
    // =================================================

    if (enrollment.enrollment_status !== "Approved") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Only approved enrollments can have subjects replaced.",
      });
    }

    // =================================================
    // GET OLD ENROLLMENT SUBJECT
    //
    // Get it BEFORE deleting it.
    // =================================================

    const [oldSubjectRows] = await connection.execute(
      `
        SELECT
            es.enrollment_subject_id,
            es.enrollment_id,
            es.subject_id,
            es.offering_id,
            es.section_id,
            es.section_subject_id,
            es.status,

            s.subject_code,
            s.subject_name,
            s.units,

            sec.section_name

        FROM enrollment_subjects es

        INNER JOIN subjects s
            ON s.subject_id = es.subject_id

        LEFT JOIN sections sec
            ON sec.section_id = es.section_id

        WHERE es.enrollment_subject_id = ?
          AND es.enrollment_id = ?

        LIMIT 1

        FOR UPDATE
        `,
      [enrollmentSubjectId, enrollmentId],
    );

    // =================================================
    // CHECK OLD SUBJECT
    // =================================================

    if (oldSubjectRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment subject not found for this enrollment.",
      });
    }

    const oldSubject = oldSubjectRows[0];

    // =================================================
    // CHECK OLD SUBJECT STATUS
    // =================================================

    if (oldSubject.status !== "Enrolled") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: `Subject cannot be replaced because its current status is '${oldSubject.status}'.`,
      });
    }

    // =================================================
    // GET NEW OFFERING
    // =================================================

    const [offeringRows] = await connection.execute(
      `
        SELECT
            so.offering_id,
            so.subject_id,
            so.section_id,
            so.section_subject_id,
            so.academic_year_id,
            so.semester_id,
            so.max_students,

            s.subject_code,
            s.subject_name,
            s.units,

            sec.section_name,

            ss.status AS section_subject_status

        FROM subject_offerings so

        INNER JOIN subjects s
            ON s.subject_id = so.subject_id

        INNER JOIN sections sec
            ON sec.section_id = so.section_id

        INNER JOIN section_subjects ss
            ON ss.section_subject_id = so.section_subject_id

        WHERE so.offering_id = ?
          AND so.section_subject_id = ?
          AND so.section_id = ?

        LIMIT 1

        FOR UPDATE
        `,
      [offeringId, sectionSubjectId, sectionId],
    );

    // =================================================
    // CHECK NEW OFFERING
    // =================================================

    if (offeringRows.length === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Invalid replacement offering, section subject, or section.",
      });
    }

    const newOffering = offeringRows[0];

    // =================================================
    // CHECK ACADEMIC PERIOD
    // =================================================

    if (
      Number(newOffering.academic_year_id) !==
        Number(enrollment.academic_year_id) ||
      Number(newOffering.semester_id) !== Number(enrollment.semester_id)
    ) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Replacement offering does not belong to the enrollment's academic period.",
      });
    }

    // =================================================
    // CHECK OFFERING STATUS
    // =================================================

    if (newOffering.section_subject_status !== "Open") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "The replacement subject offering is not open.",
      });
    }

    // =================================================
    // CHECK IF SAME SUBJECT
    // =================================================

    if (Number(newOffering.subject_id) === Number(oldSubject.subject_id)) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message:
          "The replacement subject must be different from the current subject.",
      });
    }

    // =================================================
    // CHECK DUPLICATE SUBJECT
    //
    // Make sure the student is not already enrolled
    // in the replacement subject.
    //
    // Exclude the old enrollment_subject record.
    // =================================================

    const [duplicateRows] = await connection.execute(
      `
        SELECT
            enrollment_subject_id

        FROM enrollment_subjects

        WHERE enrollment_id = ?
          AND subject_id = ?
          AND enrollment_subject_id <> ?

        LIMIT 1
        `,
      [enrollmentId, newOffering.subject_id, enrollmentSubjectId],
    );

    if (duplicateRows.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "Student is already enrolled in the replacement subject.",
      });
    }

    // =================================================
    // CHECK CAPACITY
    // =================================================

    const [countRows] = await connection.execute(
      `
        SELECT
            COUNT(*) AS enrolled_count

        FROM enrollment_subjects es

        INNER JOIN enrollments e
            ON e.enrollment_id = es.enrollment_id

        WHERE es.offering_id = ?
          AND es.status = 'Enrolled'
          AND e.enrollment_status = 'Approved'
          AND es.enrollment_subject_id <> ?
        `,
      [offeringId, enrollmentSubjectId],
    );

    const enrolledCount = Number(countRows[0].enrolled_count);

    if (
      newOffering.max_students !== null &&
      enrolledCount >= Number(newOffering.max_students)
    ) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "The replacement subject offering is already full.",
      });
    }

    // =================================================
    // DELETE OLD SUBJECT
    // =================================================

    const [deleteResult] = await connection.execute(
      `
        DELETE FROM enrollment_subjects

        WHERE enrollment_subject_id = ?
          AND enrollment_id = ?
        `,
      [enrollmentSubjectId, enrollmentId],
    );

    // =================================================
    // VERIFY DELETE
    // =================================================

    if (deleteResult.affectedRows === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "The original enrollment subject could not be removed.",
      });
    }

    // =================================================
    // INSERT NEW SUBJECT
    // =================================================

    const [insertResult] = await connection.execute(
      `
        INSERT INTO enrollment_subjects (
            enrollment_id,
            subject_id,
            offering_id,
            status,
            section_id,
            section_subject_id
        )
        VALUES (?, ?, ?, 'Enrolled', ?, ?)
        `,
      [
        enrollmentId,
        newOffering.subject_id,
        offeringId,
        sectionId,
        sectionSubjectId,
      ],
    );

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // SUCCESS RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,
      message: "Enrollment subject replaced successfully.",

      enrollment: {
        enrollment_id: enrollment.enrollment_id,
        student_id: enrollment.student_id,
        academic_year_id: enrollment.academic_year_id,
        semester_id: enrollment.semester_id,
        enrollment_status: enrollment.enrollment_status,
      },

      old_subject: {
        enrollment_subject_id: oldSubject.enrollment_subject_id,

        subject_id: oldSubject.subject_id,

        subject_code: oldSubject.subject_code,

        subject_name: oldSubject.subject_name,

        units: oldSubject.units,

        offering_id: oldSubject.offering_id,

        section_id: oldSubject.section_id,

        section_subject_id: oldSubject.section_subject_id,

        section_name: oldSubject.section_name,
      },

      new_subject: {
        enrollment_subject_id: insertResult.insertId,

        subject_id: newOffering.subject_id,

        subject_code: newOffering.subject_code,

        subject_name: newOffering.subject_name,

        units: newOffering.units,

        offering_id: newOffering.offering_id,

        section_id: newOffering.section_id,

        section_subject_id: newOffering.section_subject_id,

        section_name: newOffering.section_name,

        status: "Enrolled",
      },

      history: {
        change_type: "REPLACE",

        old_offering_id: oldSubject.offering_id,

        old_section_id: oldSubject.section_id,

        old_section_subject_id: oldSubject.section_subject_id,

        new_offering_id: newOffering.offering_id,

        new_section_id: newOffering.section_id,

        new_section_subject_id: newOffering.section_subject_id,

        reason: replacementReason,
      },
    });
  } catch (error) {
    // =================================================
    // ROLLBACK
    // =================================================

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("REPLACE SUBJECT ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("REPLACE SUBJECT ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to replace enrollment subject.",
      error: error.message,
    });
  } finally {
    // =================================================
    // RELEASE CONNECTION
    // =================================================

    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// CHANGE SUBJECT SECTION
//
// PUT /api/registrar/enrollments/:id/subjects/:enrollment_subject_id/section
//
// Example:
// PUT /api/registrar/enrollments/1/subjects/3/section
//
// Body:
// {
//   "offering_id": 4,
//   "section_subject_id": 5,
//   "section_id": 2,
//   "reason": "Student requested transfer to another section."
// }
//
// Purpose:
// - Move an enrolled subject to another section
// - Keep the same subject
// - Change offering / section / section_subject
// - Validate capacity
// - Require a reason
// =====================================================

router.put("/:id/subjects/:enrollment_subject_id/section", async (req, res) => {
  let connection;

  try {
    // =================================================
    // GET IDS
    // =================================================

    const { id, enrollment_subject_id } = req.params;

    const enrollmentId = Number(id);
    const enrollmentSubjectId = Number(enrollment_subject_id);

    // =================================================
    // VALIDATE ENROLLMENT ID
    // =================================================

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // VALIDATE ENROLLMENT SUBJECT ID
    // =================================================

    if (!Number.isInteger(enrollmentSubjectId) || enrollmentSubjectId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment subject ID.",
      });
    }

    // =================================================
    // GET REQUEST DATA
    // =================================================

    const { offering_id, section_subject_id, section_id, reason } = req.body;

    const offeringId = Number(offering_id);
    const sectionSubjectId = Number(section_subject_id);
    const sectionId = Number(section_id);

    // =================================================
    // VALIDATE OFFERING
    // =================================================

    if (!Number.isInteger(offeringId) || offeringId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid offering ID.",
      });
    }

    // =================================================
    // VALIDATE SECTION SUBJECT
    // =================================================

    if (!Number.isInteger(sectionSubjectId) || sectionSubjectId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid section subject ID.",
      });
    }

    // =================================================
    // VALIDATE SECTION
    // =================================================

    if (!Number.isInteger(sectionId) || sectionId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid section ID.",
      });
    }

    // =================================================
    // VALIDATE REASON
    // =================================================

    if (typeof reason !== "string" || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Reason is required when changing a subject section.",
      });
    }

    const changeReason = reason.trim();

    // =================================================
    // GET DATABASE CONNECTION
    // =================================================

    connection = await db.getConnection();

    // =================================================
    // START TRANSACTION
    // =================================================

    await connection.beginTransaction();

    // =================================================
    // GET ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
        SELECT
            e.enrollment_id,
            e.student_id,
            e.academic_year_id,
            e.semester_id,
            e.enrollment_status

        FROM enrollments e

        WHERE e.enrollment_id = ?

        LIMIT 1

        FOR UPDATE
        `,
      [enrollmentId],
    );

    // =================================================
    // CHECK ENROLLMENT
    // =================================================

    if (enrollmentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // ONLY APPROVED ENROLLMENTS
    // =================================================

    if (enrollment.enrollment_status !== "Approved") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Only approved enrollments can have subject sections changed.",
      });
    }

    // =================================================
    // GET CURRENT ENROLLMENT SUBJECT
    // =================================================

    const [subjectRows] = await connection.execute(
      `
        SELECT
            es.enrollment_subject_id,
            es.enrollment_id,
            es.subject_id,
            es.offering_id,
            es.section_id,
            es.section_subject_id,
            es.status,

            s.subject_code,
            s.subject_name,
            s.units,

            sec.section_name

        FROM enrollment_subjects es

        INNER JOIN subjects s
            ON s.subject_id = es.subject_id

        LEFT JOIN sections sec
            ON sec.section_id = es.section_id

        WHERE es.enrollment_subject_id = ?
          AND es.enrollment_id = ?

        LIMIT 1

        FOR UPDATE
        `,
      [enrollmentSubjectId, enrollmentId],
    );

    // =================================================
    // CHECK CURRENT SUBJECT
    // =================================================

    if (subjectRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment subject not found for this enrollment.",
      });
    }

    const currentSubject = subjectRows[0];

    // =================================================
    // CHECK CURRENT STATUS
    // =================================================

    if (currentSubject.status !== "Enrolled") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: `Subject cannot be moved because its current status is '${currentSubject.status}'.`,
      });
    }

    // =================================================
    // PREVENT SAME SECTION
    // =================================================

    if (
      Number(currentSubject.offering_id) === offeringId &&
      Number(currentSubject.section_id) === sectionId &&
      Number(currentSubject.section_subject_id) === sectionSubjectId
    ) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "The subject is already enrolled in this section.",
      });
    }

    // =================================================
    // GET NEW OFFERING
    // =================================================

    const [offeringRows] = await connection.execute(
      `
        SELECT
            so.offering_id,
            so.subject_id,
            so.section_id,
            so.section_subject_id,
            so.academic_year_id,
            so.semester_id,
            so.max_students,

            ss.status AS section_subject_status,

            sec.section_name

        FROM subject_offerings so

        INNER JOIN section_subjects ss
            ON ss.section_subject_id = so.section_subject_id

        INNER JOIN sections sec
            ON sec.section_id = so.section_id

        WHERE so.offering_id = ?
          AND so.section_subject_id = ?
          AND so.section_id = ?

        LIMIT 1

        FOR UPDATE
        `,
      [offeringId, sectionSubjectId, sectionId],
    );

    // =================================================
    // CHECK OFFERING
    // =================================================

    if (offeringRows.length === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Invalid offering, section subject, or section.",
      });
    }

    const newOffering = offeringRows[0];

    // =================================================
    // SAME SUBJECT CHECK
    // =================================================

    if (Number(newOffering.subject_id) !== Number(currentSubject.subject_id)) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "The new section must offer the same subject.",
      });
    }

    // =================================================
    // SAME ACADEMIC PERIOD CHECK
    // =================================================

    if (
      Number(newOffering.academic_year_id) !==
        Number(enrollment.academic_year_id) ||
      Number(newOffering.semester_id) !== Number(enrollment.semester_id)
    ) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message:
          "The new section does not belong to the enrollment's academic period.",
      });
    }

    // =================================================
    // CHECK SECTION SUBJECT STATUS
    // =================================================

    if (newOffering.section_subject_status !== "Open") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "The new subject section is not open.",
      });
    }

    // =================================================
    // CHECK CAPACITY
    //
    // Exclude the student's CURRENT enrollment subject
    // because it is the record being moved.
    // =================================================

    const [countRows] = await connection.execute(
      `
        SELECT
            COUNT(*) AS enrolled_count

        FROM enrollment_subjects es

        INNER JOIN enrollments e
            ON e.enrollment_id = es.enrollment_id

        WHERE es.offering_id = ?
          AND es.status = 'Enrolled'
          AND e.enrollment_status = 'Approved'
          AND es.enrollment_subject_id != ?
        `,
      [offeringId, enrollmentSubjectId],
    );

    const enrolledCount = Number(countRows[0].enrolled_count);

    // =================================================
    // CAPACITY CHECK
    // =================================================

    if (
      newOffering.max_students !== null &&
      enrolledCount >= Number(newOffering.max_students)
    ) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "The new section is already full.",
      });
    }

    // =================================================
    // CHECK DUPLICATE SUBJECT
    //
    // This prevents the student from having another
    // enrollment_subject record for the same subject.
    // =================================================

    const [duplicateRows] = await connection.execute(
      `
        SELECT
            enrollment_subject_id

        FROM enrollment_subjects

        WHERE enrollment_id = ?
          AND subject_id = ?
          AND enrollment_subject_id != ?

        LIMIT 1
        `,
      [enrollmentId, currentSubject.subject_id, enrollmentSubjectId],
    );

    if (duplicateRows.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Student already has another enrollment record for this subject.",
      });
    }

    // =================================================
    // UPDATE ENROLLMENT SUBJECT
    // =================================================

    await connection.execute(
      `
        UPDATE enrollment_subjects

        SET
            offering_id = ?,
            section_id = ?,
            section_subject_id = ?

        WHERE enrollment_subject_id = ?
          AND enrollment_id = ?
        `,
      [
        offeringId,
        sectionId,
        sectionSubjectId,
        enrollmentSubjectId,
        enrollmentId,
      ],
    );

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // SUCCESS RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,
      message: "Subject section changed successfully.",

      enrollment_subject: {
        enrollment_subject_id: currentSubject.enrollment_subject_id,

        enrollment_id: currentSubject.enrollment_id,

        subject_id: currentSubject.subject_id,

        subject_code: currentSubject.subject_code,

        subject_name: currentSubject.subject_name,

        units: currentSubject.units,

        old_offering_id: currentSubject.offering_id,

        old_section_id: currentSubject.section_id,

        old_section_subject_id: currentSubject.section_subject_id,

        old_section_name: currentSubject.section_name,

        new_offering_id: newOffering.offering_id,

        new_section_id: newOffering.section_id,

        new_section_subject_id: newOffering.section_subject_id,

        new_section_name: newOffering.section_name,

        status: currentSubject.status,
      },

      history: {
        change_type: "CHANGE_SECTION",
        reason: changeReason,
      },
    });
  } catch (error) {
    // =================================================
    // ROLLBACK
    // =================================================

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("CHANGE SECTION ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("CHANGE SUBJECT SECTION ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to change subject section.",
      error: error.message,
    });
  } finally {
    // =================================================
    // RELEASE CONNECTION
    // =================================================

    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// TRANSFER SUBJECT TO ANOTHER SECTION/OFFERING
//
// PUT /api/registrar/enrollments/:id/subjects/:enrollment_subject_id/transfer
//
// Example:
// PUT /api/registrar/enrollments/1/subjects/1/transfer
//
// Body:
// {
//   "target_section_subject_id": 3,
//   "reason": "Student requested transfer to another section."
// }
//
// Purpose:
// - Transfer an enrolled subject to another section
// - Verify enrollment exists
// - Verify enrollment is Approved
// - Verify current subject exists
// - Verify target section-subject exists
// - Verify target is the same subject
// - Verify target offering is Open
// - Verify academic year and semester match
// - Check target section capacity
// - Update offering/section information
// =====================================================

router.put(
  "/:id/subjects/:enrollment_subject_id/transfer",
  async (req, res) => {
    let connection;

    try {
      // =================================================
      // GET PARAMETERS
      // =================================================

      const { id, enrollment_subject_id } = req.params;

      const enrollmentId = Number(id);
      const enrollmentSubjectId = Number(enrollment_subject_id);

      // =================================================
      // GET BODY
      // =================================================

      const { target_section_subject_id, reason } = req.body;

      const targetSectionSubjectId = Number(target_section_subject_id);

      // =================================================
      // VALIDATE ENROLLMENT ID
      // =================================================

      if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid enrollment ID.",
        });
      }

      // =================================================
      // VALIDATE ENROLLMENT SUBJECT ID
      // =================================================

      if (!Number.isInteger(enrollmentSubjectId) || enrollmentSubjectId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid enrollment subject ID.",
        });
      }

      // =================================================
      // VALIDATE TARGET SECTION SUBJECT
      // =================================================

      if (
        !Number.isInteger(targetSectionSubjectId) ||
        targetSectionSubjectId <= 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid target section subject ID.",
        });
      }

      // =================================================
      // VALIDATE REASON
      // =================================================

      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "Reason is required when transferring a subject.",
        });
      }

      connection = await db.getConnection();

      // =================================================
      // START TRANSACTION
      // =================================================

      await connection.beginTransaction();

      // =================================================
      // GET ENROLLMENT
      // =================================================

      const [enrollmentRows] = await connection.execute(
        `
        SELECT
            e.enrollment_id,
            e.student_id,
            e.academic_year_id,
            e.semester_id,
            e.enrollment_status

        FROM enrollments e

        WHERE e.enrollment_id = ?

        LIMIT 1

        FOR UPDATE
        `,
        [enrollmentId],
      );

      // =================================================
      // CHECK ENROLLMENT
      // =================================================

      if (enrollmentRows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message: "Enrollment not found.",
        });
      }

      const enrollment = enrollmentRows[0];

      // =================================================
      // ONLY APPROVED ENROLLMENTS
      // =================================================

      if (enrollment.enrollment_status !== "Approved") {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Only approved enrollments can have subjects transferred.",
        });
      }

      // =================================================
      // GET CURRENT ENROLLMENT SUBJECT
      // =================================================

      const [currentSubjectRows] = await connection.execute(
        `
        SELECT
            es.enrollment_subject_id,
            es.enrollment_id,
            es.subject_id,
            es.offering_id,
            es.section_id,
            es.section_subject_id,
            es.status,

            s.subject_code,
            s.subject_name,
            s.units,

            sec.section_name

        FROM enrollment_subjects es

        INNER JOIN subjects s
            ON s.subject_id = es.subject_id

        LEFT JOIN sections sec
            ON sec.section_id = es.section_id

        WHERE es.enrollment_subject_id = ?
          AND es.enrollment_id = ?

        LIMIT 1

        FOR UPDATE
        `,
        [enrollmentSubjectId, enrollmentId],
      );

      // =================================================
      // CHECK CURRENT SUBJECT
      // =================================================

      if (currentSubjectRows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message: "Enrollment subject not found for this enrollment.",
        });
      }

      const currentSubject = currentSubjectRows[0];

      // =================================================
      // CHECK CURRENT STATUS
      // =================================================

      if (currentSubject.status !== "Enrolled") {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: `Subject cannot be transferred because its current status is '${currentSubject.status}'.`,
        });
      }

      // =================================================
      // PREVENT SAME SECTION-SUBJECT
      // =================================================

      if (
        Number(currentSubject.section_subject_id) === targetSectionSubjectId
      ) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "The subject is already assigned to this section.",
        });
      }

      // =================================================
      // GET TARGET SECTION SUBJECT
      // =================================================

      const [targetRows] = await connection.execute(
        `
        SELECT
            ss.section_subject_id,
            ss.subject_id,
            ss.section_id,
            ss.academic_year_id,
            ss.semester_id,
            ss.status AS section_subject_status,

            so.offering_id,
            so.max_students,
            so.status AS offering_status,

            s.subject_code,
            s.subject_name,
            s.units,

            sec.section_name

        FROM section_subjects ss

        INNER JOIN subject_offerings so
            ON so.offering_id = ss.offering_id

        INNER JOIN subjects s
            ON s.subject_id = ss.subject_id

        INNER JOIN sections sec
            ON sec.section_id = ss.section_id

        WHERE ss.section_subject_id = ?

        LIMIT 1

        FOR UPDATE
        `,
        [targetSectionSubjectId],
      );

      // =================================================
      // CHECK TARGET
      // =================================================

      if (targetRows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message: "Target section subject not found.",
        });
      }

      const target = targetRows[0];

      // =================================================
      // VERIFY SAME SUBJECT
      // =================================================

      if (Number(target.subject_id) !== Number(currentSubject.subject_id)) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "The target section does not offer the same subject.",
        });
      }

      // =================================================
      // VERIFY ACADEMIC YEAR
      // =================================================

      if (
        Number(target.academic_year_id) !== Number(enrollment.academic_year_id)
      ) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Target section belongs to a different academic year.",
        });
      }

      // =================================================
      // VERIFY SEMESTER
      // =================================================

      if (Number(target.semester_id) !== Number(enrollment.semester_id)) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Target section belongs to a different semester.",
        });
      }

      // =================================================
      // VERIFY SECTION SUBJECT STATUS
      // =================================================

      if (target.section_subject_status !== "Open") {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Target section subject is not open.",
        });
      }

      // =================================================
      // VERIFY OFFERING STATUS
      // =================================================

      if (target.offering_status !== "Open") {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Target subject offering is not open.",
        });
      }

      // =================================================
      // CHECK CAPACITY
      // =================================================

      const [capacityRows] = await connection.execute(
        `
        SELECT
            COUNT(*) AS enrolled_count

        FROM enrollment_subjects es

        WHERE es.section_subject_id = ?
          AND es.status = 'Enrolled'
        `,
        [targetSectionSubjectId],
      );

      const enrolledCount = Number(capacityRows[0].enrolled_count);

      const maxStudents = Number(target.max_students);

      // =================================================
      // CHECK FULL SECTION
      // =================================================

      if (Number.isFinite(maxStudents) && enrolledCount >= maxStudents) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Target section is already full.",
          capacity: {
            enrolled: enrolledCount,
            max_students: maxStudents,
          },
        });
      }

      // =================================================
      // UPDATE ENROLLMENT SUBJECT
      // =================================================

      const [updateResult] = await connection.execute(
        `
        UPDATE enrollment_subjects

        SET
            offering_id = ?,
            section_id = ?,
            section_subject_id = ?

        WHERE enrollment_subject_id = ?
          AND enrollment_id = ?
        `,
        [
          target.offering_id,
          target.section_id,
          target.section_subject_id,
          enrollmentSubjectId,
          enrollmentId,
        ],
      );

      // =================================================
      // VERIFY UPDATE
      // =================================================

      if (updateResult.affectedRows === 0) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Subject could not be transferred.",
        });
      }

      // =================================================
      // COMMIT
      // =================================================

      await connection.commit();

      // =================================================
      // SUCCESS
      // =================================================

      return res.status(200).json({
        success: true,

        message: "Subject transferred to the new section successfully.",

        transferred_subject: {
          enrollment_subject_id: currentSubject.enrollment_subject_id,

          enrollment_id: currentSubject.enrollment_id,

          subject_id: currentSubject.subject_id,

          subject_code: currentSubject.subject_code,

          subject_name: currentSubject.subject_name,

          units: currentSubject.units,

          old_offering_id: currentSubject.offering_id,

          old_section_id: currentSubject.section_id,

          old_section_subject_id: currentSubject.section_subject_id,

          old_section_name: currentSubject.section_name,

          new_offering_id: target.offering_id,

          new_section_id: target.section_id,

          new_section_subject_id: target.section_subject_id,

          new_section_name: target.section_name,

          status: currentSubject.status,
        },

        history: {
          change_type: "TRANSFER",
          reason: reason.trim(),
        },
      });
    } catch (error) {
      // =================================================
      // ROLLBACK
      // =================================================

      if (connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("TRANSFER SUBJECT ROLLBACK ERROR:", rollbackError);
        }
      }

      console.error("TRANSFER SUBJECT ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to transfer subject.",
        error: error.message,
      });
    } finally {
      // =================================================
      // RELEASE CONNECTION
      // =================================================

      if (connection) {
        connection.release();
      }
    }
  },
);
// =====================================================
// GET ENROLLMENT CHANGE HISTORY
//
// GET /api/registrar/enrollments/:id/history
//
// Purpose:
// - View all Registrar corrections made to an enrollment
// - Shows ADD / REMOVE / CHANGE operations
// - Shows old and new section/offering
// - Shows reason
// - Shows the Registrar who made the change
// =====================================================

router.get("/:id/history", async (req, res) => {
  try {
    const { id } = req.params;

    // =================================================
    // VALIDATE ENROLLMENT ID
    // =================================================

    const enrollmentId = Number(id);

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // CHECK ENROLLMENT
    // =================================================

    const [enrollmentRows] = await db.execute(
      `
      SELECT
          e.enrollment_id,
          e.student_id,
          e.enrollment_status,

          s.student_number,
          s.first_name,
          s.middle_name,
          s.last_name,

          c.course_code

      FROM enrollments e

      INNER JOIN students s
          ON s.student_id = e.student_id

      LEFT JOIN courses c
          ON c.course_id = s.course_id

      WHERE e.enrollment_id = ?
      `,
      [enrollmentId],
    );

    // =================================================
    // ENROLLMENT NOT FOUND
    // =================================================

    if (enrollmentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // GET CHANGE HISTORY
    // =================================================

    const [historyRows] = await db.execute(
      `
      SELECT

          h.change_id,

          h.enrollment_id,

          h.enrollment_subject_id,

          h.subject_id,

          -- Change type
          h.change_type,

          -- Old assignment
          h.old_offering_id,
          h.old_section_id,
          h.old_section_subject_id,

          -- New assignment
          h.new_offering_id,
          h.new_section_id,
          h.new_section_subject_id,

          -- Reason
          h.reason,

          -- Registrar
          h.changed_by,

          u.username AS changed_by_username,

          -- Subject
          sub.subject_code,
          sub.subject_name,

          -- Old section
          old_sec.section_name AS old_section_name,

          -- New section
          new_sec.section_name AS new_section_name,

          -- Old offering schedule
          old_off.schedule_days AS old_schedule_days,
          old_off.schedule_time AS old_schedule_time,

          -- New offering schedule
          new_off.schedule_days AS new_schedule_days,
          new_off.schedule_time AS new_schedule_time,

          h.created_at

      FROM enrollment_subject_changes h

      LEFT JOIN users u
          ON u.user_id = h.changed_by

      LEFT JOIN subjects sub
          ON sub.subject_id = h.subject_id

      LEFT JOIN sections old_sec
          ON old_sec.section_id = h.old_section_id

      LEFT JOIN sections new_sec
          ON new_sec.section_id = h.new_section_id

      LEFT JOIN subject_offerings old_off
          ON old_off.offering_id = h.old_offering_id

      LEFT JOIN subject_offerings new_off
          ON new_off.offering_id = h.new_offering_id

      WHERE h.enrollment_id = ?

      ORDER BY
          h.created_at DESC,
          h.change_id DESC
      `,
      [enrollmentId],
    );

    // =================================================
    // RESPONSE
    // =================================================

    return res.json({
      success: true,

      enrollment: {
        enrollment_id: enrollment.enrollment_id,

        student_id: enrollment.student_id,

        student_number: enrollment.student_number,

        student_name: [
          enrollment.first_name,
          enrollment.middle_name,
          enrollment.last_name,
        ]
          .filter(Boolean)
          .join(" "),

        course_code: enrollment.course_code,

        enrollment_status: enrollment.enrollment_status,
      },

      count: historyRows.length,

      history: historyRows,
    });
  } catch (error) {
    console.error("GET ENROLLMENT HISTORY ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch enrollment change history.",
    });
  }
});
export default router;
