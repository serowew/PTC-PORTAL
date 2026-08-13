import express from "express";
import bcrypt from "bcrypt";
import db from "../db.js";

const router = express.Router();

console.log("✅ enrollment.routes.js loaded");

router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Enrollment router is working!"
  });
});


router.get("/preview", async (req, res) => {
  try {
    const { academicYear, courseId } = req.query;

    if (!academicYear || !courseId) {
      return res.status(400).json({
        success: false,
        message: "Academic Year and Course ID are required."
      });
    }

    // Get course code
    const [courseRows] = await db.query(
      `
      SELECT course_code
      FROM courses
      WHERE course_id = ?
      `,
      [courseId]
    );

    if (courseRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Course not found."
      });
    }

    const courseCode = courseRows[0].course_code;

    // Example:
    // 2026-2027 + BSIT
    // becomes:
    // 26BSIT-0000

    const yearPrefix = academicYear.substring(2, 4);

    const studentNumberPreview =
      `${yearPrefix}${courseCode}-0000`;

    return res.json({
      success: true,
      studentId: studentNumberPreview
    });

  } catch (err) {
    console.error("Preview student ID error:", err);

    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  }
});



router.post("/request", async (req, res) => {
  try {

    console.log("Request Body:", req.body);


    const {
      student_id_preview,
      sequence_preview,
      first_name,
      middle_name,
      last_name,
      suffix,
      birth_date,
      sex,
      contact_number,
      address,
      course_id,
      year_level,
      section_id,
      academic_year_id,
      enrollment_type,
      cor_number,
      cor_json,
      submitted_by
    } = req.body;



    const requiredFields = {
      student_id_preview,
      first_name,
      last_name,
      sex,
      course_id,
      academic_year_id,
      submitted_by
    };

    const missingFields = Object.entries(requiredFields)
      .filter(([_, value]) => value === undefined || value === null || value === "")
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields.",
        missingFields
      });
    }


    const connection = await db.getConnection();

    let result;

    try {

      await connection.beginTransaction();



      [result] = await connection.query(
        `
        INSERT INTO enrollment_requests
        (
          student_id_preview,
          sequence_preview,
          first_name,
          middle_name,
          last_name,
          suffix,
          birth_date,
          sex,
          contact_number,
          address,
          course_id,
          year_level,
          academic_year_id,
          enrollment_type,
          cor_number,
          cor_json,
          status,
          submitted_by,
          submitted_at
        )
        VALUES
        (
          ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW()
        )
        `,
        [
          student_id_preview,
          sequence_preview,
          first_name,
          middle_name,
          last_name,
          suffix,
          birth_date,
          sex,
          contact_number,
          address,
          course_id,
          year_level,
          academic_year_id,
          enrollment_type,
          cor_number,
          JSON.stringify(cor_json ?? {}),
          "Pending",
          submitted_by
        ]
      );



      await connection.commit();

    } catch (err) {

      await connection.rollback();
      throw err;

    } finally {

      connection.release();

    }

    return res.status(201).json({
      success: true,
      message: "Enrollment request submitted successfully.",
      requestId: result.insertId
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });

  }

});


router.get("/needs-setup", async (req, res) => {
  try {
    const [rows] = await db.query(
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
        COALESCE(sec.section_name, 'Not Assigned') AS section_name,

        s.academic_year_id,
        ay.academic_year,

        s.semester_id,
        sem.semester_name,

        s.admission_date

      FROM students s

      INNER JOIN courses c
        ON c.course_id = s.course_id

      LEFT JOIN sections sec
        ON sec.section_id = s.section_id

      INNER JOIN academic_years ay
        ON ay.academic_year_id = s.academic_year_id

      LEFT JOIN semesters sem
        ON sem.semester_id = s.semester_id

      WHERE
        s.user_id IS NULL
        OR s.section_id IS NULL
        OR s.semester_id IS NULL

      ORDER BY
        c.course_code,
        s.year_level,
        s.last_name,
        s.first_name
      `
    );

    return res.json({
      success: true,
      count: rows.length,
      students: rows
    });

  } catch (err) {
    console.error("Get students needing setup error:", err);

    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  }
});


router.get("/requests", async (req, res) => {
  try {

    const [rows] = await db.query(
      `
      SELECT
          er.request_id,
          er.student_id_preview,
          er.first_name,
          er.middle_name,
          er.last_name,
          c.course_code,
          COALESCE(s.section_name, 'Not Assigned') AS section_name,
          er.year_level,
          er.status,
          er.submitted_at
      FROM enrollment_requests er

      INNER JOIN courses c
          ON c.course_id = er.course_id

      LEFT JOIN sections s
          ON s.section_id = er.section_id

      WHERE er.status = 'Pending'

      ORDER BY er.submitted_at DESC
      `
    );

    return res.json({
      success: true,
      count: rows.length,
      requests: rows
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });

  }
});



router.get("/requests/:id", async (req, res) => {
  try {

    const { id } = req.params;

    const [rows] = await db.query(
      `
      SELECT
          er.*,
          c.course_code,
          ay.academic_year,
          s.section_name
      FROM enrollment_requests er

      INNER JOIN courses c
          ON c.course_id = er.course_id

      INNER JOIN academic_years ay
          ON ay.academic_year_id = er.academic_year_id

      LEFT JOIN sections s
          ON s.section_id = er.section_id

      WHERE er.request_id = ?
      `,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Enrollment request not found."
      });
    }

    return res.json({
      success: true,
      data: rows[0]
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });

  }
});


console.log("✅ Approve route registered");

router.patch("/approve/:id", async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const requestId = Number(req.params.id);
    const approvedBy = Number(req.body.approved_by);

    if (!requestId) {
      throw new Error("Request ID is required.");
    }

    if (!approvedBy) {
      throw new Error("Approved by user ID is required.");
    }

    // =========================================================
    // 1. GET ENROLLMENT REQUEST
    // =========================================================

    const [requestRows] = await connection.query(
      `
      SELECT *
      FROM enrollment_requests
      WHERE request_id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [requestId]
    );

    if (requestRows.length === 0) {
      throw new Error("Enrollment request not found.");
    }

    const request = requestRows[0];

    console.log("Approving enrollment request:", request.request_id);

    // Only Pending requests can be approved
    if (request.status !== "Pending") {
      throw new Error(
        `This enrollment request is already ${request.status}.`
      );
    }

    // =========================================================
    // 2. GET COURSE
    // =========================================================

    const [courseRows] = await connection.query(
      `
      SELECT course_code
      FROM courses
      WHERE course_id = ?
      LIMIT 1
      `,
      [request.course_id]
    );

    if (courseRows.length === 0) {
      throw new Error("Course not found.");
    }

    const courseCode = courseRows[0].course_code;

    // =========================================================
    // 3. GET ACADEMIC YEAR
    // =========================================================

    const [yearRows] = await connection.query(
      `
      SELECT academic_year
      FROM academic_years
      WHERE academic_year_id = ?
      LIMIT 1
      `,
      [request.academic_year_id]
    );

    if (yearRows.length === 0) {
      throw new Error("Academic year not found.");
    }

    const academicYear = yearRows[0].academic_year;

    // Example:
    // 2026-2027 -> 26
    const yearPrefix = academicYear.substring(2, 4);

    // =========================================================
    // 4. GENERATE ACTUAL STUDENT NUMBER
    // =========================================================
    //
    // The preview was 26BSIT-0000.
    //
    // ONLY NOW, during approval, do we find the next number.
    //

    const likePattern = `${yearPrefix}${courseCode}-%`;

    const [studentRows] = await connection.query(
      `
      SELECT student_number
      FROM students
      WHERE student_number LIKE ?
      ORDER BY student_number DESC
      LIMIT 1
      FOR UPDATE
      `,
      [likePattern]
    );

    let sequence = 1;

    if (studentRows.length > 0) {
      const lastStudentNumber =
        studentRows[0].student_number;

      const lastSequence = parseInt(
        lastStudentNumber.split("-")[1],
        10
      );

      if (!Number.isNaN(lastSequence)) {
        sequence = lastSequence + 1;
      }
    }

    const studentNumber =
      `${yearPrefix}${courseCode}-${String(sequence).padStart(4, "0")}`;

    console.log(
      "Generated actual student number:",
      studentNumber
    );

    // =========================================================
    // 5. CHECK THAT GENERATED NUMBER DOES NOT ALREADY EXIST
    // =========================================================

    const [duplicateRows] = await connection.query(
      `
      SELECT student_id
      FROM students
      WHERE student_number = ?
      LIMIT 1
      `,
      [studentNumber]
    );

    if (duplicateRows.length > 0) {
      throw new Error(
        `Generated student number ${studentNumber} already exists.`
      );
    }

    // =========================================================
    // 6. CREATE STUDENT (with user_id, section_id, semester_id as NULL)
    // =========================================================

    const [studentResult] = await connection.query(
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
        year_level,
        admission_date
      )
      VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        null,
        studentNumber,

        request.first_name,
        request.middle_name || null,
        request.last_name,

        request.sex || null,
        request.birth_date || null,
        request.contact_number || null,

        request.course_id,
        null,

        request.academic_year_id,
        null,

        request.year_level,

        new Date()
      ]
    );

    console.log(
      "Student created:",
      studentResult.insertId
    );

    // =========================================================
    // 7. MARK REQUEST AS APPROVED
    // =========================================================

    await connection.query(
      `
      UPDATE enrollment_requests
      SET
        status = 'Approved',
        approved_by = ?,
        approved_at = NOW(),
        modified_reason = NULL
      WHERE request_id = ?
      `,
      [
        approvedBy,
        requestId
      ]
    );

    // =========================================================
    // 8. COMMIT EVERYTHING
    // =========================================================

    await connection.commit();

    return res.json({
      success: true,
      message: "Enrollment approved successfully.",

      student: {
        student_id: studentResult.insertId,
        student_number: studentNumber
      }
    });

  } catch (err) {

    await connection.rollback();

    console.error(
      "Approve enrollment error:",
      err
    );

    return res.status(500).json({
      success: false,
      message: err.message
    });

  } finally {

    connection.release();

  }
});


router.patch("/modify/:id", async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: "Reason must be at least 10 characters."
      });
    }

    const [rows] = await connection.query(
      `
      SELECT request_id
      FROM enrollment_requests
      WHERE request_id = ?
      `,
      [id]
    );

    if (rows.length === 0) {
      throw new Error("Enrollment request not found.");
    }

    await connection.query(
      `
      UPDATE enrollment_requests
      SET
          status = 'Modified',
          modified_reason = ?,
          updated_at = NOW()
      WHERE request_id = ?
      `,
      [reason, id]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: "Enrollment returned to Registrar."
    });

  } catch (err) {

    await connection.rollback();

    console.error(err);

    return res.status(500).json({
      success: false,
      message: err.message
    });

  } finally {

    connection.release();

  }
});

router.patch("/resubmit/:id", async (req, res) => {
  try {

    const { id } = req.params;

    const {
      first_name,
      middle_name,
      last_name,
    } = req.body;

    await db.query(
      `
      UPDATE enrollment_requests
      SET
          first_name = ?,
          middle_name = ?,
          last_name = ?,
          status = 'Pending',
          modified_reason = NULL,
          updated_at = NOW()
      WHERE request_id = ?
      `,
      [
        first_name,
        middle_name,
        last_name,
        id,
      ]
    );

    res.json({
      success: true,
      message: "Request resubmitted successfully.",
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success: false,
      message: err.message,
    });

  }
});



router.get("/students", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        s.student_id,
        s.student_number,
        s.first_name,
        s.middle_name,
        s.last_name,
        s.gender,
        s.birth_date,
        s.contact_number,
        s.year_level,
        s.admission_date,

        c.course_code,
        c.course_name,

        sec.section_name,

        ay.academic_year,

        s.semester_id,
        sem.semester_name

      FROM students s

      INNER JOIN courses c
        ON c.course_id = s.course_id

      INNER JOIN sections sec
        ON sec.section_id = s.section_id

      INNER JOIN academic_years ay
        ON ay.academic_year_id = s.academic_year_id

      INNER JOIN semesters sem
        ON sem.semester_id = s.semester_id

      WHERE
        s.user_id IS NOT NULL
        AND s.section_id IS NOT NULL
        AND s.semester_id IS NOT NULL

      ORDER BY
        c.course_code,
        s.year_level,
        sec.section_name,
        s.last_name,
        s.first_name
    `);

  return res.json({
  success: true,
  count: rows.length,
  students: rows
});

  } catch (err) {
    console.error("Get students error:", err);

    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  }
});



router.get("/courses", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        course_id,
        course_code,
        course_name
      FROM courses
      ORDER BY course_code
    `);

    res.json({
      success: true,
      courses: rows,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

router.get("/academic-years", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        academic_year_id,
        academic_year
      FROM academic_years
      ORDER BY academic_year DESC
    `);

    res.json({
      success: true,
      academicYears: rows,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});


router.get("/my-requests/:registrarId", async (req, res) => {
  try {
    const { registrarId } = req.params;

    const [rows] = await db.query(
      `
      SELECT
          request_id,
          student_id_preview,
          first_name,
          middle_name,
          last_name,
          status,
          modified_reason,
          submitted_at
      FROM enrollment_requests
      WHERE submitted_by = ?
      ORDER BY submitted_at DESC
      `,
      [registrarId]
    );

    return res.json({
      success: true,
      requests: rows,
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });

  }
});


router.get("/needs-setup", async (req, res) => {
  try {
    const [rows] = await db.query(`
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
        COALESCE(sec.section_name, 'Not Assigned') AS section_name,

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
        c.course_code,
        s.year_level,
        s.last_name,
        s.first_name
    `);

    return res.json({
      success: true,
      count: rows.length,
      students: rows
    });

  } catch (err) {

    console.error("Get students needing setup error:", err);

    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  }
});



export default router;