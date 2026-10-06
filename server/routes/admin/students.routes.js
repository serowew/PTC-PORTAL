// routes/students.routes.js

import express from "express";
import bcrypt from "bcrypt";
import db from "../../db.js";

const router = express.Router();
// =====================================================
// SHARED STUDENT SELECT
//
// Used by:
//
// GET /api/students
// GET /api/students/:id
//
// Includes:
// - Student information
// - User account/email
// - Course
// - Current active curriculum
// - Year level
// - Section
// - Semester
// - Address
// =====================================================

const STUDENT_SELECT = `
SELECT

    -- =================================================
    -- STUDENT
    -- =================================================

    s.student_id AS studentId,

    s.student_number AS id,

    s.first_name AS firstName,

    s.middle_name AS middleName,

    s.last_name AS lastName,

    s.gender,

    s.birth_date AS birthDate,

    s.contact_number AS contactNumber,


    -- =================================================
    -- ACCOUNT
    -- =================================================

    u.email,


    -- =================================================
    -- COURSE
    -- =================================================

    c.course_id AS courseId,

    c.course_code AS course,

    c.course_name AS courseName,


    -- =================================================
    -- CURRICULUM
    -- =================================================

    sc.student_curriculum_id AS studentCurriculumId,

    sc.curriculum_id AS curriculumId,

    sc.status AS curriculumStatus,

    sc.assigned_date AS curriculumAssignedDate,

    sc.remarks AS curriculumRemarks,

    cur.curriculum_name AS curriculumName,

    cur.effective_year AS curriculumEffectiveYear,

    cur.total_units AS curriculumTotalUnits,

    cur.is_active AS curriculumIsActive,


    -- =================================================
    -- YEAR LEVEL
    -- =================================================

    CASE s.year_level

        WHEN 1 THEN '1st Year'

        WHEN 2 THEN '2nd Year'

        WHEN 3 THEN '3rd Year'

        WHEN 4 THEN '4th Year'

        ELSE CONCAT(
            s.year_level,
            ' Year'
        )

    END AS yearLevel,


    -- =================================================
    -- SECTION
    -- =================================================

    sec.section_id AS sectionId,

    sec.section_name AS section,


    -- =================================================
    -- SEMESTER
    -- =================================================

    sem.semester_id AS semesterId,

    sem.semester_name AS semester,


    -- =================================================
    -- ACADEMIC YEAR
    -- =================================================

    ay.academic_year_id AS academicYearId,

    ay.academic_year AS academicYear,


    -- =================================================
    -- ADDRESS
    -- =================================================

    addr.house_no AS houseNo,

    addr.street,

    addr.barangay,

    addr.city,

    addr.province,

    addr.zip_code AS zipCode


FROM students s


-- =====================================================
-- USER
-- =====================================================

LEFT JOIN users u

    ON u.user_id =
       s.user_id


-- =====================================================
-- COURSE
-- =====================================================

LEFT JOIN courses c

    ON c.course_id =
       s.course_id


-- =====================================================
-- ACTIVE STUDENT CURRICULUM
-- =====================================================

LEFT JOIN student_curriculum sc

    ON sc.student_id =
       s.student_id

    AND sc.status =
        'Active'


-- =====================================================
-- CURRICULUM DETAILS
-- =====================================================

LEFT JOIN curriculum cur

    ON cur.curriculum_id =
       sc.curriculum_id


-- =====================================================
-- SECTION
-- =====================================================

LEFT JOIN sections sec

    ON sec.section_id =
       s.section_id


-- =====================================================
-- SEMESTER
-- =====================================================

LEFT JOIN semesters sem

    ON sem.semester_id =
       s.semester_id


-- =====================================================
-- ACADEMIC YEAR
-- =====================================================

LEFT JOIN academic_years ay

    ON ay.academic_year_id =
       s.academic_year_id


-- =====================================================
-- ADDRESS
-- =====================================================

LEFT JOIN student_addresses addr

    ON addr.student_id =
       s.student_id
`;
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `${STUDENT_SELECT}

WHERE s.is_archived = 0

ORDER BY
  s.last_name,
  s.first_name`,
    );

    res.json(rows);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to fetch students",
    });
  }
});

// =====================================================
// GET ACTIVE CURRICULA BY COURSE
//
// GET /api/students/curricula?course=BSIT
//
// Purpose:
// - Used by Admin Create/Edit Student
// - Returns active curricula belonging to the
//   selected course
// - Prevents frontend from using hard-coded curriculum
// =====================================================

router.get("/curricula", async (req, res) => {
  const courseCode =
    typeof req.query.course === "string" ? req.query.course.trim() : "";

  // =====================================================
  // VALIDATE COURSE
  // =====================================================

  if (!courseCode) {
    return res.status(400).json({
      success: false,
      message: "Course is required.",
    });
  }

  try {
    // =====================================================
    // FIND COURSE
    // =====================================================

    const [courseRows] = await db.execute(
      `
      SELECT
          course_id,
          course_code,
          course_name,
          total_years

      FROM courses

      WHERE course_code = ?

      LIMIT 1
      `,
      [courseCode],
    );

    if (courseRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Course not found.",
      });
    }

    const course = courseRows[0];

    // =====================================================
    // GET ACTIVE CURRICULA
    // =====================================================

    const [curriculumRows] = await db.execute(
      `
      SELECT
          curriculum_id,
          course_id,
          curriculum_name,
          effective_year,
          total_units,
          is_active

      FROM curriculum

      WHERE course_id = ?
        AND is_active = 1

      ORDER BY
          effective_year DESC,
          curriculum_id DESC
      `,
      [course.course_id],
    );

    // =====================================================
    // RESPONSE
    // =====================================================

    return res.status(200).json({
      success: true,

      course: {
        course_id: Number(course.course_id),
        course_code: course.course_code,
        course_name: course.course_name,
        total_years: Number(course.total_years || 0),
      },

      count: curriculumRows.length,

      curricula: curriculumRows.map((curriculum) => ({
        curriculum_id: Number(curriculum.curriculum_id),

        curriculum_name: curriculum.curriculum_name,

        effective_year: curriculum.effective_year
          ? Number(curriculum.effective_year)
          : null,

        total_units:
          curriculum.total_units !== null &&
          curriculum.total_units !== undefined
            ? Number(curriculum.total_units)
            : null,

        is_active: Boolean(curriculum.is_active),
      })),
    });
  } catch (error) {
    console.error("GET CURRICULA BY COURSE ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to fetch curricula for the selected course.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});
// =====================================================
// GET SINGLE STUDENT
// =====================================================

router.get("/:id", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `${STUDENT_SELECT}

WHERE s.student_number = ?`,

      [req.params.id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: "Student not found",
      });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to fetch student",
    });
  }
});
// =====================================================
// CREATE STUDENT
//
// POST /api/students
//
// Purpose:
// - Create Student login account
// - Create Student academic profile
// - Validate Course
// - Validate Curriculum belongs to Course
// - Assign Curriculum
// - Create/assign Section
// - Save Address
//
// Everything happens inside ONE transaction.
// =====================================================

router.post("/", async (req, res) => {
  const {
    firstName,
    middleName,
    lastName,

    email,

    gender,
    birthDate,
    contactNumber,

    // ADDRESS
    houseNo,
    street,
    barangay,
    city,
    province,
    zipCode,

    // SCHOOL
    course,

    // NEW
    curriculumId,

    yearLevel,
    section,
    semesterId,
  } = req.body;

  // =====================================================
  // REQUIRED FIELDS
  // =====================================================

  if (
    !firstName ||
    !lastName ||
    !email ||
    !course ||
    !curriculumId ||
    !yearLevel ||
    !section ||
    !semesterId
  ) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields",
      message:
        "First name, last name, email, course, curriculum, year level, section, and semester are required.",
    });
  }

  // =====================================================
  // NORMALIZE VALUES
  // =====================================================

  const yearLevelNum = parseInt(yearLevel);

  const curriculumIdNum = Number(curriculumId);

  const semesterIdNum = Number(semesterId);

  // =====================================================
  // VALIDATE YEAR LEVEL
  // =====================================================

  if (
    !Number.isInteger(yearLevelNum) ||
    yearLevelNum <= 0 ||
    yearLevelNum > 10
  ) {
    return res.status(400).json({
      success: false,
      error: "Invalid year level",
    });
  }

  // =====================================================
  // VALIDATE CURRICULUM ID
  // =====================================================

  if (!Number.isInteger(curriculumIdNum) || curriculumIdNum <= 0) {
    return res.status(400).json({
      success: false,
      error: "Invalid curriculum",
      message: "A valid curriculum must be selected.",
    });
  }

  // =====================================================
  // VALIDATE SEMESTER
  // =====================================================

  if (!Number.isInteger(semesterIdNum) || semesterIdNum <= 0) {
    return res.status(400).json({
      success: false,
      error: "Invalid semester",
    });
  }

  let conn;

  try {
    conn = await db.getConnection();

    await conn.beginTransaction();

    // =====================================================
    // CHECK DUPLICATE EMAIL
    // =====================================================

    const [emailRows] = await conn.execute(
      `
      SELECT
          user_id,
          email

      FROM users

      WHERE email = ?

      LIMIT 1
      `,
      [email.trim()],
    );

    if (emailRows.length > 0) {
      await conn.rollback();

      return res.status(409).json({
        success: false,
        error: "Email already exists",
        message: "A user account with this email already exists.",
      });
    }

    // =====================================================
    // FIND COURSE
    // =====================================================

    const [courseRows] = await conn.execute(
      `
      SELECT
          course_id,
          course_code,
          course_name,
          total_years

      FROM courses

      WHERE course_code = ?

      LIMIT 1
      `,
      [course],
    );

    if (courseRows.length === 0) {
      await conn.rollback();

      return res.status(400).json({
        success: false,
        error: "Invalid course",
        message: "Selected course does not exist.",
      });
    }

    const selectedCourse = courseRows[0];

    const courseId = Number(selectedCourse.course_id);

    // =====================================================
    // VALIDATE YEAR LEVEL AGAINST COURSE
    // =====================================================

    const courseTotalYears = Number(selectedCourse.total_years || 0);

    if (courseTotalYears > 0 && yearLevelNum > courseTotalYears) {
      await conn.rollback();

      return res.status(400).json({
        success: false,
        error: "Invalid year level",
        message: `${selectedCourse.course_code} only supports up to year level ${courseTotalYears}.`,
      });
    }

    // =====================================================
    // VALIDATE CURRICULUM
    //
    // CRITICAL:
    // Curriculum MUST:
    // - Exist
    // - Be active
    // - Belong to selected Course
    //
    // Example prevented:
    //
    // Course = BSA
    // Curriculum = BSIT Curriculum 2026
    // =====================================================

    const [curriculumRows] = await conn.execute(
      `
      SELECT
          curriculum_id,
          course_id,
          curriculum_name,
          effective_year,
          total_units,
          is_active

      FROM curriculum

      WHERE curriculum_id = ?
        AND course_id = ?
        AND is_active = 1

      LIMIT 1
      `,
      [curriculumIdNum, courseId],
    );

    if (curriculumRows.length === 0) {
      await conn.rollback();

      return res.status(400).json({
        success: false,
        error: "Invalid curriculum",
        message:
          "Selected curriculum is inactive or does not belong to the selected course.",
      });
    }

    const selectedCurriculum = curriculumRows[0];

    // =====================================================
    // VALIDATE SEMESTER EXISTS
    // =====================================================

    const [semesterRows] = await conn.execute(
      `
      SELECT
          semester_id,
          semester_name

      FROM semesters

      WHERE semester_id = ?

      LIMIT 1
      `,
      [semesterIdNum],
    );

    if (semesterRows.length === 0) {
      await conn.rollback();

      return res.status(400).json({
        success: false,
        error: "Invalid semester",
        message: "Selected semester does not exist.",
      });
    }

    const selectedSemester = semesterRows[0];

    // =====================================================
    // CURRENT ACADEMIC YEAR
    // =====================================================

    const [ayRows] = await conn.execute(
      `
      SELECT
          academic_year_id,
          academic_year

      FROM academic_years

      WHERE is_current = 1

      LIMIT 1
      `,
    );

    if (ayRows.length === 0) {
      await conn.rollback();

      return res.status(400).json({
        success: false,
        error: "No active academic year",
      });
    }

    const academicYearId = Number(ayRows[0].academic_year_id);

    const academicYear = ayRows[0].academic_year;

    // =====================================================
    // FIND OR CREATE SECTION
    //
    // Section must belong to:
    // - selected course
    // - current academic year
    // - selected year level
    // =====================================================

    let sectionId;

    const [sectionRows] = await conn.execute(
      `
      SELECT
          section_id,
          course_id,
          academic_year_id,
          year_level,
          section_name,
          max_students

      FROM sections

      WHERE section_name = ?
        AND course_id = ?
        AND academic_year_id = ?

      LIMIT 1
      `,
      [section, courseId, academicYearId],
    );

    if (sectionRows.length > 0) {
      const existingSection = sectionRows[0];

      // ===================================================
      // CHECK YEAR LEVEL MATCH
      // ===================================================

      if (Number(existingSection.year_level) !== yearLevelNum) {
        await conn.rollback();

        return res.status(409).json({
          success: false,
          error: "Section year level mismatch",

          message: `Section '${section}' belongs to year level ${existingSection.year_level}, not year level ${yearLevelNum}.`,
        });
      }

      sectionId = Number(existingSection.section_id);
    } else {
      // ===================================================
      // CREATE SECTION
      // ===================================================

      const [newSection] = await conn.execute(
        `
        INSERT INTO sections (
            course_id,
            academic_year_id,
            year_level,
            section_name
        )

        VALUES (?, ?, ?, ?)
        `,
        [courseId, academicYearId, yearLevelNum, section],
      );

      sectionId = Number(newSection.insertId);
    }

    // =====================================================
    // STUDENT NUMBER
    //
    // Current numbering behavior preserved.
    // =====================================================

    const year = String(new Date().getFullYear()).slice(-2);

    const [numberRows] = await conn.execute(
      `
      SELECT
          COUNT(*) AS total

      FROM students
      `,
    );

    const sequence = String(Number(numberRows[0].total) + 1).padStart(4, "0");

    const studentNumber = `${year}${course}-${sequence}`;

    // =====================================================
    // CREATE USER ACCOUNT
    // =====================================================

    const passwordHash = await bcrypt.hash(studentNumber, 10);

    const [userResult] = await conn.execute(
      `
      INSERT INTO users (
          username,
          email,
          password_hash,
          role_id,
          is_verified,
          is_active
      )

      VALUES (
          ?,
          ?,
          ?,
          5,
          0,
          1
      )
      `,
      [studentNumber, email.trim(), passwordHash],
    );

    const userId = Number(userResult.insertId);

    // =====================================================
    // CREATE STUDENT
    // =====================================================

    const [studentResult] = await conn.execute(
      `
      INSERT INTO students (
          user_id,
          student_number,

          first_name,
          middle_name,
          last_name,

          gender,
          birth_date,
          contact_number,

          course_id,
          section_id,

          academic_year_id,
          semester_id,

          status_id,
          year_level,

          admission_date
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
          ?,

          ?,
          ?,

          1,
          ?,

          CURDATE()
      )
      `,
      [
        userId,
        studentNumber,

        firstName.trim(),
        middleName ? middleName.trim() : null,
        lastName.trim(),

        gender || null,
        birthDate || null,
        contactNumber ? contactNumber.trim() : null,

        courseId,
        sectionId,

        academicYearId,
        semesterIdNum,

        yearLevelNum,
      ],
    );

    const studentId = Number(studentResult.insertId);

    // =====================================================
    // INSERT ADDRESS
    // =====================================================

    await conn.execute(
      `
      INSERT INTO student_addresses (
          student_id,

          house_no,
          street,
          barangay,
          city,
          province,
          zip_code
      )

      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        studentId,

        houseNo || null,
        street || null,
        barangay || null,
        city || null,
        province || null,
        zipCode || null,
      ],
    );

    // =====================================================
    // ASSIGN CURRICULUM
    //
    // THIS IS THE MISSING PART FROM YOUR OLD ROUTE.
    // =====================================================

    const [studentCurriculumResult] = await conn.execute(
      `
        INSERT INTO student_curriculum (
            student_id,
            curriculum_id,
            assigned_date,
            status,
            remarks
        )

        VALUES (
            ?,
            ?,
            CURDATE(),
            'Active',
            ?
        )
        `,
      [
        studentId,
        curriculumIdNum,
        "Curriculum assigned during student account creation.",
      ],
    );

    const studentCurriculumId = Number(studentCurriculumResult.insertId);

    // =====================================================
    // COMMIT
    // =====================================================

    await conn.commit();

    // =====================================================
    // SUCCESS
    // =====================================================

    return res.status(201).json({
      success: true,

      message: "Student created successfully",

      studentId,

      studentNumber,

      temporaryPassword: studentNumber,

      student: {
        student_id: studentId,

        student_number: studentNumber,

        name: [firstName, middleName, lastName].filter(Boolean).join(" "),

        email: email.trim(),

        course: {
          course_id: courseId,

          course_code: selectedCourse.course_code,

          course_name: selectedCourse.course_name,
        },

        curriculum: {
          student_curriculum_id: studentCurriculumId,

          curriculum_id: Number(selectedCurriculum.curriculum_id),

          curriculum_name: selectedCurriculum.curriculum_name,

          effective_year: selectedCurriculum.effective_year
            ? Number(selectedCurriculum.effective_year)
            : null,

          status: "Active",
        },

        academic_year: {
          academic_year_id: academicYearId,

          academic_year: academicYear,
        },

        semester: {
          semester_id: semesterIdNum,

          semester_name: selectedSemester.semester_name,
        },

        year_level: yearLevelNum,

        section: {
          section_id: sectionId,

          section_name: section,
        },
      },
    });
  } catch (error) {
    // =====================================================
    // ROLLBACK
    // =====================================================

    if (conn) {
      try {
        await conn.rollback();
      } catch (rollbackError) {
        console.error("CREATE STUDENT ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("CREATE STUDENT ERROR:", error);

    // =====================================================
    // DUPLICATE DATABASE CONSTRAINT
    // =====================================================

    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,

        error: "Duplicate student information",

        message:
          "A student or user with the same unique information already exists.",
      });
    }

    return res.status(500).json({
      success: false,

      error: "Failed creating student",

      message:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (conn) {
      conn.release();
    }
  }
});
// =====================================================
// UPDATE STUDENT
//
// PUT /api/students/:id
//
// :id = student_number
//
// Purpose:
// - Update personal information
// - Update email
// - Update Course
// - Validate and update Curriculum
// - Update Year Level
// - Update Section
// - Update Semester
// - Update Address
//
// Important:
// Course + Curriculum must always match.
// =====================================================

router.put("/:id", async (req, res) => {
  // =====================================================
  // AUTHENTICATION / AUTHORIZATION
  // =====================================================

  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication is required.",
    });
  }

  if (req.user.role_name !== "Admin") {
    return res.status(403).json({
      success: false,
      message: "Admin access is required.",
    });
  }

  const actorUserId = Number(req.user.user_id);

  if (!Number.isInteger(actorUserId) || actorUserId <= 0) {
    return res.status(401).json({
      success: false,
      message: "Authenticated Admin user ID is invalid.",
    });
  }

  // =====================================================
  // STUDENT NUMBER
  // =====================================================

  const studentNumber =
    typeof req.params.id === "string" ? req.params.id.trim() : "";

  if (!studentNumber) {
    return res.status(400).json({
      success: false,
      message: "Student number is required.",
    });
  }

  // =====================================================
  // BODY
  // =====================================================

  const {
    firstName,
    middleName,
    lastName,

    email,

    gender,
    birthDate,
    contactNumber,

    // ADDRESS
    houseNo,
    street,
    barangay,
    city,
    province,
    zipCode,

    // ACADEMIC
    course,
    curriculumId,
    yearLevel,
    section,
    semesterId,
  } = req.body;

  // =====================================================
  // REQUIRED FIELDS
  // =====================================================

  if (
    !firstName ||
    !lastName ||
    !email ||
    !course ||
    !curriculumId ||
    !yearLevel ||
    !section ||
    !semesterId
  ) {
    return res.status(400).json({
      success: false,

      message:
        "First name, last name, email, course, curriculum, year level, section, and semester are required.",
    });
  }

  // =====================================================
  // NORMALIZE IDS
  // =====================================================

  const yearLevelNum = parseInt(yearLevel);

  const curriculumIdNum = Number(curriculumId);

  const semesterIdNum = Number(semesterId);

  if (!Number.isInteger(yearLevelNum) || yearLevelNum <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid year level.",
    });
  }

  if (!Number.isInteger(curriculumIdNum) || curriculumIdNum <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid curriculum ID.",
    });
  }

  if (!Number.isInteger(semesterIdNum) || semesterIdNum <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid semester ID.",
    });
  }

  let conn;

  try {
    conn = await db.getConnection();

    await conn.beginTransaction();

    // =====================================================
    // FIND + LOCK STUDENT
    // =====================================================

    const [studentRows] = await conn.execute(
      `
        SELECT
            student_id,
            user_id,
            student_number,

            course_id,
            section_id,

            academic_year_id,
            semester_id,

            year_level

        FROM students

        WHERE student_number = ?

        LIMIT 1

        FOR UPDATE
        `,
      [studentNumber],
    );

    if (studentRows.length === 0) {
      await conn.rollback();

      return res.status(404).json({
        success: false,
        message: "Student not found.",
      });
    }

    const currentStudent = studentRows[0];

    const studentId = Number(currentStudent.student_id);

    const userId = Number(currentStudent.user_id);

    const academicYearId = Number(currentStudent.academic_year_id);

    // =====================================================
    // EMAIL DUPLICATE CHECK
    //
    // Allow same student's own email.
    // Block email owned by another account.
    // =====================================================

    const [emailRows] = await conn.execute(
      `
        SELECT
            user_id

        FROM users

        WHERE email = ?
          AND user_id <> ?

        LIMIT 1
        `,
      [email.trim(), userId],
    );

    if (emailRows.length > 0) {
      await conn.rollback();

      return res.status(409).json({
        success: false,

        message: "Another user account already uses this email address.",
      });
    }

    // =====================================================
    // FIND COURSE
    // =====================================================

    const [courseRows] = await conn.execute(
      `
        SELECT
            course_id,
            course_code,
            course_name,
            total_years

        FROM courses

        WHERE course_code = ?

        LIMIT 1
        `,
      [course],
    );

    if (courseRows.length === 0) {
      await conn.rollback();

      return res.status(400).json({
        success: false,
        message: "Selected course does not exist.",
      });
    }

    const selectedCourse = courseRows[0];

    const courseId = Number(selectedCourse.course_id);

    // =====================================================
    // YEAR LEVEL MUST FIT COURSE
    // =====================================================

    const totalYears = Number(selectedCourse.total_years || 0);

    if (totalYears > 0 && yearLevelNum > totalYears) {
      await conn.rollback();

      return res.status(400).json({
        success: false,

        message: `${selectedCourse.course_code} only supports up to year level ${totalYears}.`,
      });
    }

    // =====================================================
    // VALIDATE CURRICULUM
    //
    // MUST:
    // - exist
    // - be active
    // - belong to selected course
    // =====================================================

    const [curriculumRows] = await conn.execute(
      `
        SELECT
            curriculum_id,
            course_id,
            curriculum_name,
            effective_year,
            total_units,
            is_active

        FROM curriculum

        WHERE curriculum_id = ?
          AND course_id = ?
          AND is_active = 1

        LIMIT 1
        `,
      [curriculumIdNum, courseId],
    );

    if (curriculumRows.length === 0) {
      await conn.rollback();

      return res.status(400).json({
        success: false,

        message:
          "Selected curriculum is inactive or does not belong to the selected course.",
      });
    }

    const selectedCurriculum = curriculumRows[0];

    // =====================================================
    // VALIDATE SEMESTER
    // =====================================================

    const [semesterRows] = await conn.execute(
      `
        SELECT
            semester_id,
            semester_name

        FROM semesters

        WHERE semester_id = ?

        LIMIT 1
        `,
      [semesterIdNum],
    );

    if (semesterRows.length === 0) {
      await conn.rollback();

      return res.status(400).json({
        success: false,
        message: "Selected semester does not exist.",
      });
    }

    const selectedSemester = semesterRows[0];

    // =====================================================
    // FIND / CREATE SECTION
    //
    // Section must match:
    // course
    // academic year
    // year level
    // =====================================================

    let sectionId;

    const [sectionRows] = await conn.execute(
      `
        SELECT
            section_id,
            course_id,
            academic_year_id,
            year_level,
            section_name

        FROM sections

        WHERE section_name = ?
          AND course_id = ?
          AND academic_year_id = ?

        LIMIT 1
        `,
      [section, courseId, academicYearId],
    );

    if (sectionRows.length > 0) {
      const selectedSection = sectionRows[0];

      if (Number(selectedSection.year_level) !== yearLevelNum) {
        await conn.rollback();

        return res.status(409).json({
          success: false,

          message: `Section '${section}' belongs to year level ${selectedSection.year_level}, not year level ${yearLevelNum}.`,
        });
      }

      sectionId = Number(selectedSection.section_id);
    } else {
      // ===================================================
      // CREATE NEW SECTION
      // ===================================================

      const [newSectionResult] = await conn.execute(
        `
          INSERT INTO sections (
              course_id,
              academic_year_id,
              year_level,
              section_name
          )

          VALUES (
              ?,
              ?,
              ?,
              ?
          )
          `,
        [courseId, academicYearId, yearLevelNum, section],
      );

      sectionId = Number(newSectionResult.insertId);
    }

    // =====================================================
    // CURRENT CURRICULUM
    // =====================================================

    const [studentCurriculumRows] = await conn.execute(
      `
        SELECT
            student_curriculum_id,
            student_id,
            curriculum_id,
            assigned_date,
            status,
            remarks

        FROM student_curriculum

        WHERE student_id = ?

        LIMIT 1

        FOR UPDATE
        `,
      [studentId],
    );

    const currentStudentCurriculum = studentCurriculumRows.length
      ? studentCurriculumRows[0]
      : null;

    const oldCurriculumId = currentStudentCurriculum
      ? Number(currentStudentCurriculum.curriculum_id)
      : null;

    // =====================================================
    // UPDATE USER EMAIL
    // =====================================================

    await conn.execute(
      `
      UPDATE users

      SET email = ?

      WHERE user_id = ?
      `,
      [email.trim(), userId],
    );

    // =====================================================
    // UPDATE STUDENT
    // =====================================================

    await conn.execute(
      `
      UPDATE students

      SET
          first_name = ?,
          middle_name = ?,
          last_name = ?,

          gender = ?,
          birth_date = ?,
          contact_number = ?,

          course_id = ?,
          section_id = ?,

          semester_id = ?,
          year_level = ?

      WHERE student_id = ?
      `,
      [
        firstName.trim(),

        middleName ? middleName.trim() : null,

        lastName.trim(),

        gender || null,

        birthDate || null,

        contactNumber ? contactNumber.trim() : null,

        courseId,

        sectionId,

        semesterIdNum,

        yearLevelNum,

        studentId,
      ],
    );

    // =====================================================
    // UPDATE OR CREATE STUDENT CURRICULUM
    // =====================================================

    let studentCurriculumId;

    if (currentStudentCurriculum) {
      studentCurriculumId = Number(
        currentStudentCurriculum.student_curriculum_id,
      );

      const curriculumChanged = oldCurriculumId !== curriculumIdNum;

      await conn.execute(
        `
        UPDATE student_curriculum

        SET
            curriculum_id = ?,

            assigned_date =
                CASE
                    WHEN curriculum_id <> ?
                    THEN CURDATE()
                    ELSE assigned_date
                END,

            status = 'Active',

            remarks = ?

        WHERE student_curriculum_id = ?
        `,
        [
          curriculumIdNum,

          curriculumIdNum,

          curriculumChanged
            ? "Curriculum changed by Admin during student profile update."
            : currentStudentCurriculum.remarks,

          studentCurriculumId,
        ],
      );
    } else {
      // ===================================================
      // OLD STUDENT WITH NO CURRICULUM
      //
      // Creates the missing relationship.
      // ===================================================

      const [insertCurriculumResult] = await conn.execute(
        `
          INSERT INTO student_curriculum (
              student_id,
              curriculum_id,
              assigned_date,
              status,
              remarks
          )

          VALUES (
              ?,
              ?,
              CURDATE(),
              'Active',
              ?
          )
          `,
        [
          studentId,
          curriculumIdNum,

          "Curriculum assigned by Admin during student profile update.",
        ],
      );

      studentCurriculumId = Number(insertCurriculumResult.insertId);
    }

    // =====================================================
    // ADDRESS
    // =====================================================

    const [addressRows] = await conn.execute(
      `
        SELECT
            address_id

        FROM student_addresses

        WHERE student_id = ?

        LIMIT 1
        `,
      [studentId],
    );

    if (addressRows.length > 0) {
      await conn.execute(
        `
        UPDATE student_addresses

        SET
            house_no = ?,
            street = ?,
            barangay = ?,
            city = ?,
            province = ?,
            zip_code = ?

        WHERE student_id = ?
        `,
        [
          houseNo || null,
          street || null,
          barangay || null,
          city || null,
          province || null,
          zipCode || null,

          studentId,
        ],
      );
    } else {
      await conn.execute(
        `
        INSERT INTO student_addresses (
            student_id,
            house_no,
            street,
            barangay,
            city,
            province,
            zip_code
        )

        VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
            ,?
        )
        `,
        [
          studentId,

          houseNo || null,
          street || null,
          barangay || null,
          city || null,
          province || null,
          zipCode || null,
        ],
      );
    }

    // =====================================================
    // AUDIT STUDENT UPDATE
    // =====================================================

    await conn.execute(
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
          'students',
          ?,
          'UPDATE',
          ?,
          ?
      )
      `,
      [
        actorUserId,

        studentId,

        JSON.stringify({
          course_id: Number(currentStudent.course_id),

          section_id: currentStudent.section_id
            ? Number(currentStudent.section_id)
            : null,

          semester_id: currentStudent.semester_id
            ? Number(currentStudent.semester_id)
            : null,

          year_level: Number(currentStudent.year_level),

          curriculum_id: oldCurriculumId,
        }),

        JSON.stringify({
          course_id: courseId,

          section_id: sectionId,

          semester_id: semesterIdNum,

          year_level: yearLevelNum,

          curriculum_id: curriculumIdNum,
        }),
      ],
    );

    // =====================================================
    // AUDIT CURRICULUM
    // =====================================================

    if (oldCurriculumId !== curriculumIdNum) {
      await conn.execute(
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
            'student_curriculum',
            ?,
            ?,
            ?,
            ?
        )
        `,
        [
          actorUserId,

          studentCurriculumId,

          oldCurriculumId === null ? "INSERT" : "UPDATE",

          JSON.stringify(
            oldCurriculumId === null
              ? null
              : {
                  student_id: studentId,

                  curriculum_id: oldCurriculumId,
                },
          ),

          JSON.stringify({
            student_id: studentId,

            curriculum_id: curriculumIdNum,

            status: "Active",
          }),
        ],
      );
    }

    // =====================================================
    // COMMIT
    // =====================================================

    await conn.commit();

    // =====================================================
    // SUCCESS
    // =====================================================

    return res.status(200).json({
      success: true,

      message: "Student updated successfully.",

      student: {
        student_id: studentId,

        student_number: studentNumber,

        name: [firstName, middleName, lastName].filter(Boolean).join(" "),

        email: email.trim(),

        course: {
          course_id: courseId,

          course_code: selectedCourse.course_code,

          course_name: selectedCourse.course_name,
        },

        curriculum: {
          student_curriculum_id: studentCurriculumId,

          curriculum_id: curriculumIdNum,

          curriculum_name: selectedCurriculum.curriculum_name,

          effective_year: selectedCurriculum.effective_year
            ? Number(selectedCurriculum.effective_year)
            : null,

          status: "Active",

          changed: oldCurriculumId !== curriculumIdNum,
        },

        semester: {
          semester_id: semesterIdNum,

          semester_name: selectedSemester.semester_name,
        },

        year_level: yearLevelNum,

        section: {
          section_id: sectionId,

          section_name: section,
        },
      },

      actor: {
        user_id: actorUserId,

        username: req.user.username || null,
      },
    });
  } catch (error) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (rollbackError) {
        console.error("UPDATE STUDENT ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("UPDATE STUDENT ERROR:", error);

    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,

        message: "The update conflicts with an existing unique record.",
      });
    }

    return res.status(500).json({
      success: false,

      message: "Failed updating student.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (conn) {
      conn.release();
    }
  }
});
// =====================================================
// ARCHIVE STUDENT
// =====================================================

router.delete("/:id", async (req, res) => {
  let conn;

  try {
    conn = await db.getConnection();

    await conn.beginTransaction();

    const [studentRows] = await conn.execute(
      `
      SELECT
        student_id,
        user_id,
        student_number,
        is_archived
      FROM students
      WHERE student_number = ?
      LIMIT 1
      FOR UPDATE
      `,
      [req.params.id],
    );

    if (studentRows.length === 0) {
      await conn.rollback();

      return res.status(404).json({
        success: false,
        message: "Student not found.",
      });
    }

    const student = studentRows[0];

    const studentId = Number(student.student_id);
    const userId = student.user_id ? Number(student.user_id) : null;

    // Prevent archiving the same student twice
    if (Number(student.is_archived) === 1) {
      await conn.rollback();

      return res.status(409).json({
        success: false,
        message: "Student is already archived.",
      });
    }

    // =====================================================
    // ARCHIVE STUDENT
    // =====================================================

    await conn.execute(
      `
      UPDATE students
      SET
        is_archived = 1,
        archived_at = NOW(),
        scheduled_deletion_at = DATE_ADD(NOW(), INTERVAL 3 YEAR)
      WHERE student_id = ?
      `,
      [studentId],
    );

    // =====================================================
    // DISABLE STUDENT LOGIN ACCOUNT
    // =====================================================

    if (userId) {
      await conn.execute(
        `
        UPDATE users
        SET is_active = 0
        WHERE user_id = ?
        `,
        [userId],
      );

      // Close active user sessions
      await conn.execute(
        `
        UPDATE user_sessions
        SET is_active = 0
        WHERE user_id = ?
        `,
        [userId],
      );

      // Close active login sessions
      await conn.execute(
        `
        UPDATE login_sessions
        SET
          is_active = 0,
          logout_time = NOW()
        WHERE user_id = ?
          AND is_active = 1
        `,
        [userId],
      );
    }

    await conn.commit();

    return res.status(200).json({
      success: true,
      message: "Student archived successfully.",
      student: {
        student_id: studentId,
        student_number: student.student_number,
      },
    });
  } catch (error) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (rollbackError) {
        console.error("ARCHIVE STUDENT ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("ARCHIVE STUDENT ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to archive student.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (conn) {
      conn.release();
    }
  }
});
export default router;
