// server/routes/student/profile.js

import express from "express";
import db from "../../db.js";

const router = express.Router();

// =====================================================
// GET AUTHENTICATED STUDENT PROFILE
//
// GET /api/student/profile
//
// Security:
// - Student JWT/session is required by the parent router.
// - Student identity comes ONLY from req.user.
// - No student_id is accepted from the frontend.
// - Student can retrieve only their own profile.
//
// Response intentionally excludes:
// - Department
// - Curriculum
// =====================================================

router.get("/", async (req, res) => {
  try {
    // =================================================
    // AUTHENTICATED STUDENT
    // =================================================

    if (!req.user) {
      return res.status(401).json({
        success: false,
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication is required.",
      });
    }

    if (req.user.role_name !== "Student") {
      return res.status(403).json({
        success: false,
        code: "STUDENT_ACCESS_REQUIRED",
        message: "Student access is required.",
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
    // PROFILE / PERSONAL / ACADEMIC INFORMATION
    //
    // IMPORTANT:
    // Department and Curriculum are intentionally not
    // selected or returned.
    // =================================================

    const [studentRows] = await db.execute(
      `
        SELECT
            s.student_id,
            s.student_number,

            s.first_name,
            s.middle_name,
            s.last_name,

            u.email,

            s.contact_number,
            s.gender,
            s.birth_date,

            s.course_id,
            c.course_code,
            c.course_name,

            s.year_level,

            s.section_id,
            sec.section_name,

            s.academic_year_id,
            ay.academic_year,

            s.semester_id,
            sem.semester_name,

            s.status_id,
            student_status.status_name AS student_status,

            addr.house_no,
            addr.street,
            addr.barangay,
            addr.city,
            addr.province,
            addr.zip_code,

            profile.photo,
            profile.address AS profile_address

        FROM students s

        INNER JOIN users u
            ON u.user_id = s.user_id

        LEFT JOIN courses c
            ON c.course_id = s.course_id

        LEFT JOIN sections sec
            ON sec.section_id = s.section_id

        LEFT JOIN academic_years ay
            ON ay.academic_year_id = s.academic_year_id

        LEFT JOIN semesters sem
            ON sem.semester_id = s.semester_id

        LEFT JOIN student_statuses student_status
            ON student_status.status_id = s.status_id

        LEFT JOIN student_addresses addr
            ON addr.student_id = s.student_id

        LEFT JOIN student_profiles profile
            ON profile.student_id = s.student_id

        WHERE s.user_id = ?

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

    // =================================================
    // GUARDIAN
    //
    // Student Profile shows one primary guardian.
    // Use the earliest guardian record if multiple exist.
    // =================================================

    const [guardianRows] = await db.execute(
      `
        SELECT
            guardian_id,
            guardian_name,
            relationship,
            contact_number

        FROM guardians

        WHERE student_id = ?

        ORDER BY guardian_id ASC

        LIMIT 1
      `,
      [studentId],
    );

    const guardian = guardianRows.length > 0 ? guardianRows[0] : null;

    // =================================================
    // CURRENT ENROLLMENT STATUS
    //
    // Prefer the Student profile's current academic year
    // and semester. If no matching enrollment exists,
    // return no enrollment status rather than invent one.
    // =================================================

    let enrollmentStatus = null;

    if (
      student.academic_year_id !== null &&
      student.academic_year_id !== undefined &&
      student.semester_id !== null &&
      student.semester_id !== undefined
    ) {
      const [enrollmentRows] = await db.execute(
        `
          SELECT
              enrollment_status

          FROM enrollments

          WHERE student_id = ?
            AND academic_year_id = ?
            AND semester_id = ?

          ORDER BY enrollment_id DESC

          LIMIT 1
        `,
        [
          studentId,
          Number(student.academic_year_id),
          Number(student.semester_id),
        ],
      );

      if (enrollmentRows.length > 0) {
        enrollmentStatus = enrollmentRows[0].enrollment_status || null;
      }
    }

    // =================================================
    // ADDRESS
    //
    // Prefer the structured student_addresses record.
    // Fall back to student_profiles.address when needed.
    // =================================================

    const structuredAddress = [
      student.house_no,
      student.street,
      student.barangay,
      student.city,
      student.province,
      student.zip_code,
    ]
      .map((value) => (value === null || value === undefined ? "" : String(value).trim()))
      .filter(Boolean)
      .join(", ");

    const address =
      structuredAddress ||
      (student.profile_address
        ? String(student.profile_address).trim()
        : "") ||
      null;

    const fullName = [
      student.first_name,
      student.middle_name,
      student.last_name,
    ]
      .filter(Boolean)
      .join(" ");

    // =================================================
    // RESPONSE
    //
    // Only fields approved for the Student Profile UI.
    // No Department. No Curriculum.
    // =================================================

    return res.status(200).json({
      success: true,
      code: "STUDENT_PROFILE_RETRIEVED",
      message: "Student profile retrieved successfully.",

      profile: {
        photo: student.photo || null,

        full_name: fullName,
        first_name: student.first_name,
        middle_name: student.middle_name || null,
        last_name: student.last_name,

        student_number: student.student_number,

        email: student.email || null,
        contact_number: student.contact_number || null,
        gender: student.gender || null,
        birth_date: student.birth_date || null,
        address,

        course: {
          course_id:
            student.course_id !== null && student.course_id !== undefined
              ? Number(student.course_id)
              : null,
          course_code: student.course_code || null,
          course_name: student.course_name || null,
        },

        year_level:
          student.year_level !== null && student.year_level !== undefined
            ? Number(student.year_level)
            : null,

        section: {
          section_id:
            student.section_id !== null && student.section_id !== undefined
              ? Number(student.section_id)
              : null,
          section_name: student.section_name || null,
        },

        academic_year: {
          academic_year_id:
            student.academic_year_id !== null &&
            student.academic_year_id !== undefined
              ? Number(student.academic_year_id)
              : null,
          academic_year: student.academic_year || null,
        },

        semester: {
          semester_id:
            student.semester_id !== null && student.semester_id !== undefined
              ? Number(student.semester_id)
              : null,
          semester_name: student.semester_name || null,
        },

        enrollment_status: enrollmentStatus,
        student_status: student.student_status || null,

        guardian: guardian
          ? {
              guardian_name: guardian.guardian_name || null,
              relationship: guardian.relationship || null,
              contact_number: guardian.contact_number || null,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("GET /api/student/profile ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "STUDENT_PROFILE_RETRIEVAL_FAILED",
      message: "Failed to retrieve Student profile.",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export default router;
