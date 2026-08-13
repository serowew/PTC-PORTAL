// routes/students.routes.js

import express from "express";
import bcrypt from "bcrypt";
import db from "../db.js";

const router = express.Router();

// =====================================================
// SHARED STUDENT SELECT
// =====================================================

const STUDENT_SELECT = `

SELECT

    s.student_id AS studentId,
    s.student_number AS id,

    s.first_name AS firstName,
    s.middle_name AS middleName,
    s.last_name AS lastName,

    s.gender,
    s.birth_date AS birthDate,
    s.contact_number AS contactNumber,


    u.email,


    c.course_code AS course,


    CASE s.year_level

        WHEN 1 THEN '1st Year'
        WHEN 2 THEN '2nd Year'
        WHEN 3 THEN '3rd Year'
        WHEN 4 THEN '4th Year'

        ELSE CONCAT(s.year_level,' Year')

    END AS yearLevel,


    sec.section_name AS section,


    sem.semester_id AS semesterId,
    sem.semester_name AS semester,


    -- ADDRESS

    addr.house_no AS houseNo,
    addr.street,
    addr.barangay,
    addr.city,
    addr.province,
    addr.zip_code AS zipCode


FROM students s


LEFT JOIN users u

ON u.user_id = s.user_id



LEFT JOIN courses c

ON c.course_id = s.course_id



LEFT JOIN sections sec

ON sec.section_id = s.section_id



LEFT JOIN semesters sem

ON sem.semester_id = s.semester_id



LEFT JOIN student_addresses addr

ON addr.student_id = s.student_id

`;

// =====================================================
// GET ALL STUDENTS
// =====================================================

router.get("/", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `${STUDENT_SELECT}
WHERE
  s.user_id IS NOT NULL
  AND s.section_id IS NOT NULL
  AND s.semester_id IS NOT NULL      

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
// GET STUDENTS THAT NEED SETUP
// =====================================================

router.get("/needs-setup", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `
      SELECT
        s.student_id,
        s.user_id,
        s.student_number,

        s.first_name,
        s.middle_name,
        s.last_name,

        s.gender,
        s.birth_date,
        s.contact_number,

        s.course_id,
        c.course_code,
        c.course_name,

        s.year_level,

        s.section_id,
        COALESCE(
          sec.section_name,
          'Not Assigned'
        ) AS section_name,

        s.academic_year_id,
        ay.academic_year,

        s.semester_id,
        sem.semester_name,

        s.admission_date

      FROM students s

      INNER JOIN courses c
        ON c.course_id = s.course_id

      INNER JOIN academic_years ay
        ON ay.academic_year_id = s.academic_year_id

      LEFT JOIN sections sec
        ON sec.section_id = s.section_id

      LEFT JOIN semesters sem
        ON sem.semester_id = s.semester_id

      WHERE
        s.user_id IS NULL
        OR s.section_id IS NULL
        OR s.semester_id IS NULL

      ORDER BY
        s.admission_date DESC,
        s.student_id DESC
      `
    );

    return res.json({
      success: true,
      students: rows
    });

  } catch (error) {
    console.error("Get students needing setup error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch students needing setup.",
      error: error.message
    });
  }
});



// MUST COME AFTER /needs-setup
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `${STUDENT_SELECT}
      WHERE s.student_number = ?
      LIMIT 1
      `,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: "Student not found"
      });
    }

    res.json(rows[0]);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Failed to fetch student"
    });
  }
});


// =====================================================
// CREATE STUDENT ACCOUNT DURING SETUP
// =====================================================

router.patch("/:studentNumber/setup/account", async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { studentNumber } = req.params;

    // 1. Find the student
    const [studentRows] = await connection.execute(
      `
      SELECT
        student_id,
        user_id,
        student_number,
        first_name,
        last_name
      FROM students
      WHERE student_number = ?
      LIMIT 1
      FOR UPDATE
      `,
      [studentNumber]
    );

    if (studentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Student not found."
      });
    }

    const student = studentRows[0];

    // 2. Make sure an account does not already exist
    if (student.user_id !== null) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "Student account already exists.",
        userId: student.user_id
      });
    }

    // 3. Generate account information
    const username = student.student_number;

    const email =
      `${student.student_number.replace("-", "").toLowerCase()}@student.ptc.edu.ph`;

    const temporaryPassword = "PTC12345";

    const passwordHash = await bcrypt.hash(
      temporaryPassword,
      10
    );

    // 4. Student role
    // Your current enrollment approval uses role_id 5.
    const roleId = 5;

    // 5. Create user account
    const [userResult] = await connection.execute(
      `
      INSERT INTO users
      (
        username,
        email,
        password_hash,
        role_id
      )
      VALUES
      (?, ?, ?, ?)
      `,
      [
        username,
        email,
        passwordHash,
        roleId
      ]
    );

    const userId = userResult.insertId;

    // 6. Link account to student
    await connection.execute(
      `
      UPDATE students
      SET user_id = ?
      WHERE student_id = ?
      `,
      [
        userId,
        student.student_id
      ]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: "Student account created successfully.",
      account: {
        user_id: userId,
        username,
        email,
        temporary_password: temporaryPassword
      }
    });

  } catch (error) {

    await connection.rollback();

    console.error(
      "Create student account error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to create student account.",
      error: error.message
    });

  } finally {

    connection.release();

  }
});


// =====================================================
// CREATE STUDENT
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

    yearLevel,

    section,

    semesterId,
  } = req.body;

  if (!firstName || !lastName || !email || !course || !yearLevel || !section) {
    return res.status(400).json({
      error: "Missing required fields",
    });
  }

  const yearLevelNum = parseInt(yearLevel);

  let conn;

  try {
    conn = await db.getConnection();

    await conn.beginTransaction();

    // ================================
    // FIND COURSE
    // ================================

    const [courseRows] = await conn.execute(
      `

SELECT course_id

FROM courses

WHERE course_code=?

`,

      [course],
    );

    if (courseRows.length === 0) {
      await conn.rollback();

      return res.status(400).json({
        error: "Invalid course",
      });
    }

    const courseId = courseRows[0].course_id;

    // ================================
    // CURRENT ACADEMIC YEAR
    // ================================

    const [ayRows] = await conn.execute(
      `

SELECT academic_year_id

FROM academic_years

WHERE is_current=1

LIMIT 1

`,
    );

    if (ayRows.length === 0) {
      await conn.rollback();

      return res.status(400).json({
        error: "No active academic year",
      });
    }

    const academicYearId = ayRows[0].academic_year_id;

    // ================================
    // SECTION
    // ================================

    let sectionId;

    const [sectionRows] = await conn.execute(
      `

SELECT section_id

FROM sections

WHERE section_name=?

AND course_id=?

AND academic_year_id=?

`,

      [section, courseId, academicYearId],
    );

    if (sectionRows.length) {
      sectionId = sectionRows[0].section_id;
    } else {
      const [newSection] = await conn.execute(
        `

INSERT INTO sections

(

course_id,

academic_year_id,

year_level,

section_name

)

VALUES(?,?,?,?)

`,

        [courseId, academicYearId, yearLevelNum, section],
      );

      sectionId = newSection.insertId;
    }
    // =====================================================
    // STUDENT NUMBER
    // =====================================================

    const year = String(new Date().getFullYear()).slice(-2);

    const [numberRows] = await conn.execute(
      `
SELECT COUNT(*) total
FROM students
`,
    );

    const studentNumber = `${year}${course}-${String(numberRows[0].total + 1).padStart(4, "0")}`;

    // =====================================================
    // CREATE USER ACCOUNT
    // =====================================================

    const passwordHash = await bcrypt.hash(studentNumber, 10);

    const [userResult] = await conn.execute(
      `

INSERT INTO users

(
username,
email,
password_hash,
role_id,
is_verified,
is_active
)

VALUES(?,?,?,5,0,1)

`,

      [studentNumber, email, passwordHash],
    );

    const userId = userResult.insertId;

    // =====================================================
    // CREATE STUDENT
    // =====================================================

    const [studentResult] = await conn.execute(
      `

INSERT INTO students

(

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


VALUES

(?,?,?,?,?,?,?,?,?,?,?,?,1,?,CURDATE())

`,

      [
        userId,

        studentNumber,

        firstName,

        middleName || null,

        lastName,

        gender || null,

        birthDate || null,

        contactNumber || null,

        courseId,

        sectionId,

        academicYearId,

        semesterId || null,

        yearLevelNum,
      ],
    );

    // =====================================================
    // INSERT ADDRESS
    // =====================================================

    await conn.execute(
      `

INSERT INTO student_addresses

(

student_id,

house_no,

street,

barangay,

city,

province,

zip_code

)


VALUES(?,?,?,?,?,?,?)

`,

      [
        studentResult.insertId,

        houseNo || null,

        street || null,

        barangay || null,

        city || null,

        province || null,

        zipCode || null,
      ],
    );

    await conn.commit();

    res.status(201).json({
      message: "Student created successfully",

      studentId: studentResult.insertId,

      studentNumber,

      temporaryPassword: studentNumber,
    });
  } catch (error) {
    if (conn) {
      await conn.rollback();
    }

    console.error(error);

    res.status(500).json({
      error: "Failed creating student",
    });
  } finally {
    if (conn) {
      conn.release();
    }
  }
});
// =====================================================
// UPDATE STUDENT
// =====================================================

router.put("/:id", async (req, res) => {
  const { id } = req.params;

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
    yearLevel,
    section,
    semesterId,
  } = req.body;

  const yearLevelNum = parseInt(yearLevel);

  let conn;

  try {
    conn = await db.getConnection();

    await conn.beginTransaction();

    // ==============================
    // FIND STUDENT
    // ==============================

    const [studentRows] = await conn.execute(
      `
      SELECT 
      student_id,
      user_id

      FROM students

      WHERE student_number=?
      `,
      [id],
    );

    if (studentRows.length === 0) {
      await conn.rollback();

      return res.status(404).json({
        error: "Student not found",
      });
    }

    const studentId = studentRows[0].student_id;

    const userId = studentRows[0].user_id;

    // ==============================
    // UPDATE USER EMAIL
    // ==============================

    if (email && userId) {
      await conn.execute(
        `
        UPDATE users

        SET email=?

        WHERE user_id=?
        `,
        [email, userId],
      );
    }

    // ==============================
    // COURSE
    // ==============================

    let courseId = null;

    if (course) {
      const [courseRows] = await conn.execute(
        `
        SELECT course_id

        FROM courses

        WHERE course_code=?
        `,
        [course],
      );

      if (courseRows.length) {
        courseId = courseRows[0].course_id;
      }
    }

    // ==============================
    // SECTION
    // ==============================

    let sectionId = null;

    if (section && courseId) {
      const [sectionRows] = await conn.execute(
        `
        SELECT section_id

        FROM sections

        WHERE section_name=?

        AND course_id=?

        `,
        [section, courseId],
      );

      if (sectionRows.length) {
        sectionId = sectionRows[0].section_id;
      }
    }

    // ==============================
    // UPDATE STUDENT
    // ==============================

    await conn.execute(
      `
      UPDATE students

      SET

      first_name=?,

      middle_name=?,

      last_name=?,

      gender=?,

      birth_date=?,

      contact_number=?,

      course_id=COALESCE(?,course_id),

      section_id=COALESCE(?,section_id),

      semester_id=?,

      year_level=?


      WHERE student_id=?

      `,
      [
        firstName,

        middleName || null,

        lastName,

        gender || null,

        birthDate || null,

        contactNumber || null,

        courseId,

        sectionId,

        semesterId || null,

        yearLevelNum,

        studentId,
      ],
    );

    // ==============================
    // UPDATE ADDRESS
    // ==============================

    const [addressRows] = await conn.execute(
      `
      SELECT address_id

      FROM student_addresses

      WHERE student_id=?
      `,
      [studentId],
    );

    if (addressRows.length) {
      await conn.execute(
        `
        UPDATE student_addresses

        SET

        house_no=?,

        street=?,

        barangay=?,

        city=?,

        province=?,

        zip_code=?


        WHERE student_id=?

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
        INSERT INTO student_addresses

        (
        student_id,
        house_no,
        street,
        barangay,
        city,
        province,
        zip_code
        )


        VALUES(?,?,?,?,?,?,?)

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

    await conn.commit();

    res.json({
      message: "Student updated successfully",
    });
  } catch (error) {
    if (conn) {
      await conn.rollback();
    }

    console.error(error);

    res.status(500).json({
      error: "Failed updating student",
    });
  } finally {
    if (conn) {
      conn.release();
    }
  }
});
// =====================================================
// DELETE STUDENT
// =====================================================

router.delete("/:id", async (req, res) => {
  let conn;

  try {
    conn = await db.getConnection();

    await conn.beginTransaction();

    const [studentRows] = await conn.execute(
      `

SELECT student_id,user_id

FROM students

WHERE student_number=?

`,

      [req.params.id],
    );

    if (studentRows.length === 0) {
      await conn.rollback();

      return res.status(404).json({
        error: "Student not found",
      });
    }

    const studentId = studentRows[0].student_id;

    const userId = studentRows[0].user_id;

    // delete address first because it references student

    await conn.execute(
      `

DELETE FROM student_addresses

WHERE student_id=?

`,

      [studentId],
    );

    // delete student

    await conn.execute(
      `

DELETE FROM students

WHERE student_id=?

`,

      [studentId],
    );

    // delete login account

    if (userId) {
      await conn.execute(
        `

DELETE FROM users

WHERE user_id=?

`,

        [userId],
      );
    }

    await conn.commit();

    res.json({
      success: true,
    });
  } catch (error) {
    if (conn) {
      await conn.rollback();
    }

    console.error(error);

    res.status(500).json({
      error: "Delete failed",
    });
  } finally {
    if (conn) {
      conn.release();
    }
  }
});


router.patch("/:studentNumber/setup/section", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { studentNumber } = req.params;
    const { section_id } = req.body;

    if (!section_id) {
      return res.status(400).json({
        success: false,
        message: "Section is required."
      });
    }

    await connection.beginTransaction();

    // Find student
    const [studentRows] = await connection.query(
      `
      SELECT
        student_id,
        student_number,
        course_id,
        year_level,
        academic_year_id
      FROM students
      WHERE student_number = ?
      LIMIT 1
      `,
      [studentNumber]
    );

    if (studentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Student not found."
      });
    }

    const student = studentRows[0];

    // Verify section belongs to the student's
    // course, year level, and academic year
    const [sectionRows] = await connection.query(
      `
      SELECT
        section_id,
        section_name
      FROM sections
      WHERE section_id = ?
        AND course_id = ?
        AND year_level = ?
        AND academic_year_id = ?
      LIMIT 1
      `,
      [
        section_id,
        student.course_id,
        student.year_level,
        student.academic_year_id
      ]
    );

    if (sectionRows.length === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Invalid section for this student."
      });
    }

    // Assign section
    await connection.query(
      `
      UPDATE students
      SET section_id = ?
      WHERE student_id = ?
      `,
      [section_id, student.student_id]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: "Section assigned successfully.",
      section: sectionRows[0]
    });

  } catch (err) {
    await connection.rollback();

    console.error("Assign section error:", err);

    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  } finally {
    connection.release();
  }
});

router.get("/:studentNumber/setup/sections", async (req, res) => {
  try {
    const { studentNumber } = req.params;

    const [rows] = await db.query(
      `
      SELECT
        sec.section_id,
        sec.section_name
      FROM students s

      INNER JOIN sections sec
        ON sec.course_id = s.course_id
        AND sec.year_level = s.year_level
        AND sec.academic_year_id = s.academic_year_id

      WHERE s.student_number = ?

      ORDER BY sec.section_name
      `,
      [studentNumber]
    );

    return res.json({
      success: true,
      sections: rows
    });

  } catch (err) {
    console.error("Get setup sections error:", err);

    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  }
});
// =====================================================
// GET AVAILABLE SEMESTERS FOR STUDENT SETUP
// =====================================================
router.get("/:studentNumber/setup/semesters", async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT
        semester_id,
        semester_name
      FROM semesters
      ORDER BY semester_id
      `
    );

    return res.json({
      success: true,
      semesters: rows,
    });
  } catch (err) {
    console.error("Get setup semesters error:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch semesters.",
      error: err.message,
    });
  }
});
// =====================================================
// ASSIGN SEMESTER DURING STUDENT SETUP
// =====================================================
router.patch("/:studentNumber/setup/semester", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { studentNumber } = req.params;
    const { semester_id } = req.body;

    if (!semester_id) {
      return res.status(400).json({
        success: false,
        message: "Semester is required.",
      });
    }

    await connection.beginTransaction();

    // Find student
    const [studentRows] = await connection.query(
      `
      SELECT
        student_id,
        student_number
      FROM students
      WHERE student_number = ?
      LIMIT 1
      `,
      [studentNumber]
    );

    if (studentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Student not found.",
      });
    }

    const student = studentRows[0];

    // Verify semester exists
    const [semesterRows] = await connection.query(
      `
      SELECT
        semester_id,
        semester_name
      FROM semesters
      WHERE semester_id = ?
      LIMIT 1
      `,
      [semester_id]
    );

    if (semesterRows.length === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Invalid semester.",
      });
    }

    // Assign semester
    await connection.query(
      `
      UPDATE students
      SET semester_id = ?
      WHERE student_id = ?
      `,
      [semester_id, student.student_id]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: "Semester assigned successfully.",
      semester: semesterRows[0],
    });
  } catch (err) {
    await connection.rollback();

    console.error("Assign semester error:", err);

    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message,
    });
  } finally {
    connection.release();
  }
});

// =====================================================
// STUDENT SETUP - ASSIGN SEMESTER
// PATCH endpoint used by ManageStudentSetup.tsx
// Place this immediately after the GET semesters route
// =====================================================

router.patch("/:studentNumber/setup/semester", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const { studentNumber } = req.params;
    const { semester_id } = req.body;

    // -------------------------------------------------
    // Validate semester selection
    // -------------------------------------------------

    if (!semester_id) {
      return res.status(400).json({
        success: false,
        message: "Semester is required.",
      });
    }

    await connection.beginTransaction();

    // -------------------------------------------------
    // Find the student
    // -------------------------------------------------

    const [studentRows] = await connection.query(
      `
      SELECT
        student_id,
        student_number
      FROM students
      WHERE student_number = ?
      LIMIT 1
      `,
      [studentNumber]
    );

    if (studentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Student not found.",
      });
    }

    const student = studentRows[0];

    // -------------------------------------------------
    // Verify that the semester exists
    // -------------------------------------------------

    const [semesterRows] = await connection.query(
      `
      SELECT
        semester_id,
        semester_name
      FROM semesters
      WHERE semester_id = ?
      LIMIT 1
      `,
      [semester_id]
    );

    if (semesterRows.length === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Invalid semester.",
      });
    }

    // -------------------------------------------------
    // Assign semester to the student
    // -------------------------------------------------

    await connection.query(
      `
      UPDATE students
      SET semester_id = ?
      WHERE student_id = ?
      `,
      [semester_id, student.student_id]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: "Semester assigned successfully.",
      semester: semesterRows[0],
    });
  } catch (err) {
    await connection.rollback();

    console.error("Assign semester error:", err);

    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message,
    });
  } finally {
    connection.release();
  }
});

export default router;
