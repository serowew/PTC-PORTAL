// routes/students.routes.js

import express from "express";
import bcrypt from "bcrypt";
import fs from "fs/promises";
import path from "path";
import multer from "multer";
import db from "../db.js";

const router = express.Router();

const studentPhotoStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const studentId = req.params.studentId || "unknown";
    const uploadDir = path.join(process.cwd(), "uploads", "students", studentId);

    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error, "");
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({
  storage: studentPhotoStorage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/i;
    if (!allowedTypes.test(file.mimetype)) {
      return cb(new Error("Only JPG, JPEG, PNG, and WEBP images are allowed."));
    }

    cb(null, true);
  },
});

const resolveStudentId = async (studentIdentifier) => {
  const normalized = String(studentIdentifier ?? "").trim();

  if (!normalized) {
    return null;
  }

  const numericIdentifier = Number(normalized);

  const [rows] = await db.execute(
    `
      SELECT student_id AS studentId
      FROM students
      WHERE student_id = ?
         OR student_number = ?
         OR user_id = ?
      LIMIT 1
    `,
    [normalized, normalized, Number.isNaN(numericIdentifier) ? null : numericIdentifier],
  );

  return rows[0]?.studentId ?? null;
};

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
// STUDENT PROFILE PHOTO
// =====================================================

router.post("/:studentId/photo", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file was uploaded.",
      });
    }

    const studentId = req.params.studentId;
    const uploadDir = path.join(process.cwd(), "uploads", "students", studentId);
    const existingFiles = await fs.readdir(uploadDir).catch(() => []);

    await Promise.all(
      existingFiles.map((fileName) =>
        fs.unlink(path.join(uploadDir, fileName)).catch(() => undefined),
      ),
    );

    const photoUrl = `${req.protocol}://${req.get("host")}/uploads/students/${studentId}/${req.file.filename}`;
    const resolvedStudentId = await resolveStudentId(studentId);

    if (resolvedStudentId) {
      const [profileRows] = await db.execute(
        `SELECT profile_id AS profileId FROM student_profiles WHERE student_id = ? LIMIT 1`,
        [resolvedStudentId],
      );

      if (profileRows.length) {
        await db.execute(
          `UPDATE student_profiles SET photo = ?, updated_at = CURRENT_TIMESTAMP WHERE profile_id = ?`,
          [photoUrl, profileRows[0].profileId],
        );
      } else {
        await db.execute(
          `INSERT INTO student_profiles (student_id, photo, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [resolvedStudentId, photoUrl],
        );
      }
    }

    res.json({
      success: true,
      message: "Profile picture uploaded successfully.",
      url: photoUrl,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to upload profile picture.",
    });
  }
});

router.delete("/:studentId/photo", async (req, res) => {
  try {
    const studentId = req.params.studentId;
    const uploadDir = path.join(process.cwd(), "uploads", "students", studentId);

    const existingFiles = await fs.readdir(uploadDir).catch(() => []);

    await Promise.all(
      existingFiles.map((fileName) =>
        fs.unlink(path.join(uploadDir, fileName)).catch(() => undefined),
      ),
    );

    const resolvedStudentId = await resolveStudentId(studentId);

    if (resolvedStudentId) {
      const [profileRows] = await db.execute(
        `SELECT profile_id AS profileId FROM student_profiles WHERE student_id = ? LIMIT 1`,
        [resolvedStudentId],
      );

      if (profileRows.length) {
        await db.execute(
          `UPDATE student_profiles SET photo = NULL, updated_at = CURRENT_TIMESTAMP WHERE profile_id = ?`,
          [profileRows[0].profileId],
        );
      }
    }

    res.json({
      success: true,
      message: "Profile picture removed successfully.",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to remove profile picture.",
    });
  }
});

// =====================================================
// GET ALL STUDENTS
// =====================================================

router.get("/", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `${STUDENT_SELECT}

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

export default router;
