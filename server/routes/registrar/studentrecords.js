// routes/registrar/studentRecords.js

import express from "express";
import db from "../../db.js";

import { getOfficialAcademicRecordForStudent } from "../../services/academicRecord.service.js";
const router = express.Router();

// =====================================================
// SHARED STUDENT SELECT
// =====================================================

const STUDENT_SELECT = `
SELECT

    s.student_id,
    s.student_number,

    s.first_name,
    s.middle_name,
    s.last_name,

    s.gender,
    s.birth_date,
    s.contact_number,

    u.email,

    c.course_id,
    c.course_code,

    s.year_level,

    st.status_name AS status,

    sec.section_id,
    sec.section_name,

    sem.semester_id,
    sem.semester_name,

    addr.house_no,
    addr.street,
    addr.barangay,
    addr.city,
    addr.province,
    addr.zip_code

FROM students s

LEFT JOIN users u
    ON u.user_id = s.user_id

LEFT JOIN courses c
    ON c.course_id = s.course_id

LEFT JOIN sections sec
    ON sec.section_id = s.section_id

LEFT JOIN semesters sem
    ON sem.semester_id = s.semester_id

LEFT JOIN student_statuses st
    ON st.status_id = s.status_id

LEFT JOIN student_addresses addr
    ON addr.student_id = s.student_id
`;

// =====================================================
// HELPER
// =====================================================

async function getStudent(studentId) {
  const [rows] = await db.execute(
    `
    ${STUDENT_SELECT}

    WHERE s.student_id = ?
    `,
    [studentId],
  );

  return rows.length > 0 ? rows[0] : null;
}
// =====================================================
// PHASE 1
// GET ALL STUDENTS
// =====================================================

router.get("/", async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const offset = (page - 1) * limit;

    const search = req.query.search?.trim() || "";
    const course = req.query.course || "";
    const year = req.query.year || "";
    const section = req.query.section || "";

    let sql = `
        ${STUDENT_SELECT}

        WHERE 1=1
    `;

    const params = [];

    // ----------------------------------------
    // SEARCH
    // ----------------------------------------

    if (search) {
      sql += `
        AND (
            s.student_number LIKE ?
            OR s.first_name LIKE ?
            OR s.middle_name LIKE ?
            OR s.last_name LIKE ?
        )
      `;

      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    // ----------------------------------------
    // COURSE
    // ----------------------------------------

    if (course) {
      sql += `
        AND c.course_code = ?
      `;

      params.push(course);
    }

    // ----------------------------------------
    // YEAR LEVEL
    // ----------------------------------------

    if (year) {
      sql += `
        AND s.year_level = ?
      `;

      params.push(year);
    }

    // ----------------------------------------
    // SECTION
    // ----------------------------------------

    if (section) {
      sql += `
        AND sec.section_name = ?
      `;

      params.push(section);
    }

    // ----------------------------------------
    // SORTING + PAGINATION
    // ----------------------------------------

    sql += `
        ORDER BY
            s.last_name ASC,
            s.first_name ASC

        LIMIT ?
        OFFSET ?
    `;

    params.push(limit);
    params.push(offset);

    const [students] = await db.execute(sql, params);

    // =====================================================
    // COUNT QUERY
    // =====================================================

    let countSql = `
      SELECT COUNT(*) AS total

      FROM students s

      LEFT JOIN courses c
        ON c.course_id = s.course_id

      LEFT JOIN sections sec
        ON sec.section_id = s.section_id

      WHERE 1=1
    `;

    const countParams = [];

    if (search) {
      countSql += `
        AND (
          s.student_number LIKE ?
          OR s.first_name LIKE ?
          OR s.middle_name LIKE ?
          OR s.last_name LIKE ?
        )
      `;

      countParams.push(
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
        `%${search}%`,
      );
    }

    if (course) {
      countSql += `
        AND c.course_code = ?
      `;

      countParams.push(course);
    }

    if (year) {
      countSql += `
        AND s.year_level = ?
      `;

      countParams.push(year);
    }

    if (section) {
      countSql += `
        AND sec.section_name = ?
      `;

      countParams.push(section);
    }

    const [countRows] = await db.execute(countSql, countParams);

    const totalStudents = countRows[0].total;
    const totalPages = Math.ceil(totalStudents / limit);

    res.json({
      success: true,
      page,
      limit,
      count: students.length,
      totalStudents,
      totalPages,
      students,
    });
  } catch (error) {
    console.error("GET STUDENTS ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch students.",
    });
  }
});
// =====================================================
// GET SINGLE STUDENT PROFILE
//
// GET /api/registrar/students/:id
// =====================================================

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const student = await getStudent(id);

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student not found.",
      });
    }

    res.json({
      success: true,
      student,
    });
  } catch (error) {
    console.error("GET STUDENT ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch student.",
    });
  }
});
// =====================================================
// GET OFFICIAL ACADEMIC RECORDS
//
// GET /api/registrar/students/:id/academic-records
//
// OFFICIAL SOURCES:
//
// 1. Approved PTC Grade
// 2. Completed + Credited Transfer Credit
//
// This endpoint is read-only.
// =====================================================

router.get("/:id/academic-records", async (req, res) => {
  try {
    // =================================================
    // STUDENT ID
    // =================================================

    const studentId = Number(req.params.id);

    if (!Number.isInteger(studentId) || studentId <= 0) {
      return res.status(400).json({
        success: false,
        code: "INVALID_STUDENT_ID",
        message: "Invalid student ID.",
      });
    }

    // =================================================
    // STUDENT PROFILE
    // =================================================

    const student = await getStudent(studentId);

    if (!student) {
      return res.status(404).json({
        success: false,
        code: "STUDENT_NOT_FOUND",
        message: "Student not found.",
      });
    }

    // =================================================
    // AUTHORITATIVE OFFICIAL ACADEMIC RECORD
    // =================================================

    const academicRecord = await getOfficialAcademicRecordForStudent(
      studentId,
      {
        executor: db,
      },
    );

    // =================================================
    // REGISTRAR RESPONSE ADAPTER
    //
    // Preserve old flat fields where useful while
    // keeping the richer shared-service fields.
    // =================================================

    const records = academicRecord.records.map((record) => ({
      ...record,

      // Existing Registrar-style alias.
      academic_result: record.classification,

      // Existing flat faculty alias.
      faculty_id: record.faculty?.faculty_id ?? null,

      // Existing flat review aliases.
      reviewed_by: record.approval?.reviewed_by ?? null,

      reviewed_by_username: record.approval?.reviewed_by_username ?? null,

      reviewed_at: record.approval?.reviewed_at ?? null,

      review_remarks: record.approval?.review_remarks ?? null,

      // Existing grade timestamp aliases.
      // Transfer-credit rows have no PTC grade.
      grade_created_at:
        record.record_type === "PTC_GRADE" ? record.created_at : null,

      grade_updated_at:
        record.record_type === "PTC_GRADE" ? record.updated_at : null,
    }));

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      code: "REGISTRAR_OFFICIAL_ACADEMIC_RECORD_RETRIEVED",

      message: "Official academic record retrieved successfully.",

      student,

      // Keep old response field for compatibility.
      totalSubjects: records.length,

      // Combined official academic history.
      records,

      // Combined summary.
      summary: academicRecord.summary,

      // Explicit source collections.
      ptc_grade_records: academicRecord.ptc_grade_records,

      transfer_credit_records: academicRecord.transfer_credit_records,

      academic_rule: academicRecord.academic_rule,

      academic_effect: {
        read_only: true,

        combines_official_ptc_grades: true,

        combines_official_transfer_credits: true,

        changes_ptc_grades: false,

        changes_transfer_evaluations: false,

        changes_current_enrollment: false,

        reason:
          "Registrar academic records combine official PTC grades and official transfer credits without converting external grades into PTC grades.",
      },
    });
  } catch (error) {
    console.error("GET REGISTRAR ACADEMIC RECORDS ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "REGISTRAR_ACADEMIC_RECORD_RETRIEVAL_FAILED",

      message: "Failed to fetch academic records.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});
// =====================================================
// VERIFY STUDENT DOCUMENT
//
// PUT /api/registrar/students/documents/:documentId/verify
// =====================================================

router.put("/documents/:documentId/verify", async (req, res) => {
  let conn;

  try {
    const { documentId } = req.params;
    const { verification_status, remarks } = req.body;

    const verified_by = req.user.user_id;

    // =====================================================
    // VALIDATION
    // =====================================================

    const allowedStatuses = ["Verified", "Rejected"];

    if (!allowedStatuses.includes(verification_status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification status.",
      });
    }

    if (verification_status === "Rejected" && (!remarks || !remarks.trim())) {
      return res.status(400).json({
        success: false,
        message: "Remarks are required when rejecting a document.",
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();

    // =====================================================
    // CHECK DOCUMENT
    // =====================================================

    const [documentRows] = await conn.execute(
      `
      SELECT
          document_id,
          student_id,
          document_type,
          verification_status
      FROM student_documents
      WHERE document_id = ?
      `,
      [documentId],
    );

    if (documentRows.length === 0) {
      await conn.rollback();

      return res.status(404).json({
        success: false,
        message: "Document not found.",
      });
    }

    const document = documentRows[0];

    // =====================================================
    // PREVENT DOUBLE VERIFICATION
    // =====================================================

    if (
      document.verification_status === "Verified" ||
      document.verification_status === "Rejected"
    ) {
      await conn.rollback();

      return res.status(409).json({
        success: false,
        message: `Document has already been ${document.verification_status.toLowerCase()}.`,
      });
    }

    // =====================================================
    // UPDATE DOCUMENT
    // =====================================================

    await conn.execute(
      `
      UPDATE student_documents
      SET
          verification_status = ?,
          remarks = ?,
          verified_by = ?,
          verified_at = NOW()
      WHERE document_id = ?
      `,
      [verification_status, remarks || null, verified_by, documentId],
    );

    // =====================================================
    // ACTIVITY LOG
    // =====================================================

    const ipAddress =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      null;

    await conn.execute(
      `
      INSERT INTO activity_logs
      (
          user_id,
          activity_type,
          module_name,
          description,
          ip_address
      )
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        verified_by,
        "Document Verification",
        "Student Records",
        `${verification_status} ${document.document_type} document (ID: ${documentId})`,
        ipAddress,
      ],
    );

    // =====================================================
    // RETURN UPDATED DOCUMENT
    // =====================================================

    const [updatedRows] = await conn.execute(
      `
      SELECT
          sd.document_id,
          sd.student_id,
          sd.document_type,
          sd.file_name,
          sd.file_path,
          sd.verification_status,
          sd.remarks,
          sd.verified_by,
          u.username AS verified_by_username,
          sd.verified_at,
          sd.uploaded_at

      FROM student_documents sd

      LEFT JOIN users u
          ON u.user_id = sd.verified_by

      WHERE sd.document_id = ?
      `,
      [documentId],
    );

    await conn.commit();

    res.json({
      success: true,
      message: `Document ${verification_status.toLowerCase()} successfully.`,
      document: updatedRows[0],
    });
  } catch (error) {
    if (conn) {
      await conn.rollback();
    }

    console.error("DOCUMENT VERIFICATION ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Failed to verify document.",
    });
  } finally {
    if (conn) {
      conn.release();
    }
  }
});
export default router;
