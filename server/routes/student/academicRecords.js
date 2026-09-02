// server/routes/student/academicRecords.js

import express from "express";
import db from "../../db.js";

import { getOfficialAcademicRecordForStudent } from "../../services/academicRecord.service.js";

const router = express.Router();

// =====================================================
// GET STUDENT OFFICIAL ACADEMIC RECORD
// =====================================================
//
// GET /api/student/academic-records
//
// SECURITY:
//
// - Student JWT required.
// - Student identity comes ONLY from req.user.
// - No student_id query parameter.
// - No student_id request body.
// - Student can only retrieve their own record.
//
// OFFICIAL ACADEMIC SOURCES:
//
// 1. PTC Grade
//
//    Approved enrollment
//    + Approved grade
//
// 2. Transfer Credit
//
//    Completed transfer evaluation
//    + Credited transfer subject
//
// IMPORTANT:
//
// Previous-school grades remain external source grades.
// They are NEVER converted into PTC final_rating values.
//
// =====================================================

router.get("/", async (req, res) => {
  try {
    // =================================================
    // 1. AUTHENTICATION
    // =================================================

    if (!req.user) {
      return res.status(401).json({
        success: false,
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication is required.",
      });
    }

    const userId = Number(req.user.user_id);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({
        success: false,
        code: "INVALID_AUTHENTICATED_USER",
        message: "Authenticated user ID is invalid.",
      });
    }

    // =================================================
    // 2. STUDENT ROLE
    // =================================================

    if (req.user.role_name !== "Student") {
      return res.status(403).json({
        success: false,
        code: "STUDENT_ACCESS_REQUIRED",
        message: "Student access is required.",
      });
    }

    // =================================================
    // 3. AUTHENTICATED STUDENT PROFILE
    //
    // Student identity comes from JWT.
    // Never accept student_id from the frontend.
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

            u.email,

            s.course_id,

            c.course_code,
            c.course_name,

            s.year_level,

            s.status_id,

            student_status.status_name
                AS student_status

        FROM students s

        INNER JOIN users u
            ON u.user_id =
               s.user_id

        INNER JOIN courses c
            ON c.course_id =
               s.course_id

        LEFT JOIN student_statuses student_status
            ON student_status.status_id =
               s.status_id

        WHERE
            s.user_id = ?

        LIMIT 1
      `,
      [userId],
    );

    if (studentRows.length === 0) {
      return res.status(404).json({
        success: false,
        code: "STUDENT_PROFILE_NOT_FOUND",
        message: "No Student profile is connected to this account.",
      });
    }

    const student = studentRows[0];

    const studentId = Number(student.student_id);

    const courseId = Number(student.course_id);

    // =================================================
    // 4. ACTIVE CURRICULUM
    //
    // Curriculum is current profile/context information.
    //
    // IMPORTANT:
    //
    // It is NOT used to erase/filter historical official
    // academic records.
    // =================================================

    const [curriculumRows] = await db.execute(
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

        WHERE
            sc.student_id = ?

            AND sc.status =
                'Active'

            AND cur.is_active = 1

            AND cur.course_id = ?

        ORDER BY
            sc.student_curriculum_id DESC

        LIMIT 1
      `,
      [studentId, courseId],
    );

    let curriculum = null;

    if (curriculumRows.length > 0) {
      const row = curriculumRows[0];

      curriculum = {
        student_curriculum_id: Number(row.student_curriculum_id),

        curriculum_id: Number(row.curriculum_id),

        curriculum_name: row.curriculum_name,

        effective_year:
          row.effective_year !== null && row.effective_year !== undefined
            ? Number(row.effective_year)
            : null,

        total_units:
          row.total_units !== null && row.total_units !== undefined
            ? Number(row.total_units)
            : null,

        status: row.assignment_status,

        assigned_date: row.assigned_date || null,
      };
    }

    // =================================================
    // 5. AUTHORITATIVE OFFICIAL ACADEMIC RECORD
    //
    // This service combines:
    //
    // - Approved PTC grades
    // - Completed + Credited transfer credits
    //
    // It keeps the two academic sources separate.
    // =================================================

    const academicRecord = await getOfficialAcademicRecordForStudent(
      studentId,
      {
        executor: db,
      },
    );

    // =================================================
    // 6. STUDENT RESPONSE
    // =================================================

    const studentResponse = {
      student_id: studentId,

      student_number: student.student_number,

      first_name: student.first_name,

      middle_name: student.middle_name || null,

      last_name: student.last_name,

      student_name: [student.first_name, student.middle_name, student.last_name]
        .filter(Boolean)
        .join(" "),

      email: student.email || null,

      year_level:
        student.year_level !== null && student.year_level !== undefined
          ? Number(student.year_level)
          : 0,

      status: student.student_status || "Unknown",

      course: {
        course_id: courseId,

        course_code: student.course_code,

        course_name: student.course_name,
      },

      curriculum,
    };

    // =================================================
    // 7. SUCCESS RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      code: "OFFICIAL_ACADEMIC_RECORD_RETRIEVED",

      message: "Official academic record retrieved successfully.",

      student: studentResponse,

      // ===============================================
      // COMBINED SUMMARY
      // ===============================================

      summary: academicRecord.summary,

      // ===============================================
      // COMBINED OFFICIAL RECORDS
      //
      // Contains both:
      //
      // PTC_GRADE
      // TRANSFER_CREDIT
      // ===============================================

      records: academicRecord.records,

      // ===============================================
      // SOURCE-SPECIFIC RECORDS
      // ===============================================

      ptc_grade_records: academicRecord.ptc_grade_records,

      transfer_credit_records: academicRecord.transfer_credit_records,

      // ===============================================
      // AUTHORITATIVE RULE
      // ===============================================

      academic_rule: academicRecord.academic_rule,

      // ===============================================
      // READ-ONLY ACADEMIC EFFECT
      // ===============================================

      academic_effect: {
        read_only: true,

        combines_official_ptc_grades: true,

        combines_official_transfer_credits: true,

        changes_ptc_grades: false,

        changes_transfer_evaluations: false,

        changes_current_enrollment: false,

        reason:
          "This endpoint reads official PTC grades and official transfer credits as separate academic sources in one combined academic record.",
      },
    });
  } catch (error) {
    console.error("GET /api/student/academic-records ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "ACADEMIC_RECORD_RETRIEVAL_FAILED",

      message: "Failed to retrieve Student academic record.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export default router;
