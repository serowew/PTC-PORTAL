import { gradePolicyFields } from "../../services/gradingPolicy.service.js";
import express from "express";
import db from "../../db.js";

const router = express.Router();

async function getAuthenticatedProgramHead(req, res) {
  const userId = Number(req.user?.user_id);

  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(401).json({
      success: false,
      message: "Invalid authenticated user.",
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
        ON f.faculty_id = ph.faculty_id
    INNER JOIN users u
        ON u.user_id = f.user_id
    INNER JOIN departments d
        ON d.department_id = ph.department_id
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
      message: "No active Program Head assignment was found for this account.",
    });

    return null;
  }

  const row = rows[0];

  return {
    program_head_id: row.program_head_id,
    faculty_id: row.faculty_id,
    user_id: row.user_id,
    employee_number: row.employee_number,
    username: row.username,
    first_name: row.first_name,
    middle_name: row.middle_name,
    last_name: row.last_name,

    program_head_name: [row.first_name, row.middle_name, row.last_name]
      .filter(Boolean)
      .join(" "),

    email: row.email,
    department_id: row.department_id,
    department_code: row.department_code,
    department_name: row.department_name,
    start_date: row.start_date,
    end_date: row.end_date,
  };
}

router.get("/submitted", async (req, res) => {
  try {
    const programHead = await getAuthenticatedProgramHead(req, res);

    if (!programHead) {
      return;
    }

    const academicYearIdRaw = req.query.academic_year_id;

    const semesterIdRaw = req.query.semester_id;

    let academicYearId = null;
    let semesterId = null;

    if (academicYearIdRaw !== undefined && academicYearIdRaw !== "") {
      academicYearId = Number(academicYearIdRaw);

      if (!Number.isInteger(academicYearId) || academicYearId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid academic_year_id.",
        });
      }
    }

    if (semesterIdRaw !== undefined && semesterIdRaw !== "") {
      semesterId = Number(semesterIdRaw);

      if (!Number.isInteger(semesterId) || semesterId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid semester_id.",
        });
      }
    }

    const conditions = ["g.grade_status = 'Submitted'", "c.department_id = ?"];

    const params = [programHead.department_id];

    if (academicYearId !== null) {
      conditions.push("so.academic_year_id = ?");

      params.push(academicYearId);
    }

    if (semesterId !== null) {
      conditions.push("so.semester_id = ?");

      params.push(semesterId);
    }

    const [rows] = await db.execute(
      `
      SELECT
          g.grade_id,
          g.enrollment_subject_id,
          g.faculty_id,
          g.midterm_grade,
          g.final_grade,
          g.final_rating,
          g.grading_policy,
          g.grading_outcome,
          g.outcome_reason,
          g.overall_percentage,
          g.remarks,
          g.grade_status,
          g.submitted_at,
          g.reviewed_by,
          g.reviewed_at,
          g.review_remarks,
          g.created_at AS grade_created_at,
          g.updated_at AS grade_updated_at,

          es.enrollment_id,
          es.status AS enrollment_subject_status,

          e.student_id,
          e.enrollment_status,

          s.student_number,
          s.first_name AS student_first_name,
          s.middle_name AS student_middle_name,
          s.last_name AS student_last_name,

          so.offering_id,
          so.status AS offering_status,
          so.schedule_days,
          so.schedule_time,

          sub.subject_id,
          sub.subject_code,
          sub.subject_name,
          sub.units,

          sec.section_id,
          sec.section_name,
          sec.year_level,

          c.course_id,
          c.course_code,
          c.course_name,
          c.department_id,

          ay.academic_year_id,
          ay.academic_year,
          ay.is_current AS academic_year_is_current,

          sem.semester_id,
          sem.semester_name,

          gf.employee_number
              AS faculty_employee_number,
          gf.first_name
              AS faculty_first_name,
          gf.middle_name
              AS faculty_middle_name,
          gf.last_name
              AS faculty_last_name,
          gf.email
              AS faculty_email
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
             es.subject_id
      INNER JOIN sections sec
          ON sec.section_id =
             es.section_id
      INNER JOIN courses c
          ON c.course_id =
             sec.course_id
      INNER JOIN academic_years ay
          ON ay.academic_year_id =
             so.academic_year_id
      INNER JOIN semesters sem
          ON sem.semester_id =
             so.semester_id
      INNER JOIN faculty gf
          ON gf.faculty_id =
             g.faculty_id
      WHERE
          ${conditions.join("\n          AND ")}
      ORDER BY
          g.submitted_at ASC,
          c.course_code ASC,
          sec.year_level ASC,
          sec.section_name ASC,
          sub.subject_code ASC,
          s.last_name ASC,
          s.first_name ASC,
          g.grade_id ASC
      `,
      params,
    );

    const grades = rows.map((row) => ({
      grade_id: row.grade_id,

      enrollment_subject_id: row.enrollment_subject_id,

      grade_status: row.grade_status,

      grades: {
        midterm_grade:
          row.midterm_grade !== null ? Number(row.midterm_grade) : null,

        final_grade: row.final_grade !== null ? Number(row.final_grade) : null,

        ...gradePolicyFields(row),

        final_rating:
          row.final_rating !== null ? Number(row.final_rating) : null,

        remarks: row.remarks,
      },

      student: {
        student_id: row.student_id,
        student_number: row.student_number,
        first_name: row.student_first_name,
        middle_name: row.student_middle_name,
        last_name: row.student_last_name,

        full_name: [
          row.student_first_name,
          row.student_middle_name,
          row.student_last_name,
        ]
          .filter(Boolean)
          .join(" "),

        enrollment_id: row.enrollment_id,
        enrollment_status: row.enrollment_status,

        subject_status: row.enrollment_subject_status,
      },

      faculty: {
        faculty_id: row.faculty_id,

        employee_number: row.faculty_employee_number,

        first_name: row.faculty_first_name,

        middle_name: row.faculty_middle_name,

        last_name: row.faculty_last_name,

        faculty_name: [
          row.faculty_first_name,
          row.faculty_middle_name,
          row.faculty_last_name,
        ]
          .filter(Boolean)
          .join(" "),

        email: row.faculty_email,
      },

      class: {
        offering_id: row.offering_id,
        offering_status: row.offering_status,

        subject: {
          subject_id: row.subject_id,
          subject_code: row.subject_code,
          subject_name: row.subject_name,
          units: Number(row.units),
        },

        section: {
          section_id: row.section_id,
          section_name: row.section_name,
          year_level: row.year_level,

          course: {
            course_id: row.course_id,
            course_code: row.course_code,
            course_name: row.course_name,
          },
        },

        academic_period: {
          academic_year_id: row.academic_year_id,

          academic_year: row.academic_year,

          is_current_academic_year: Boolean(row.academic_year_is_current),

          semester_id: row.semester_id,

          semester_name: row.semester_name,
        },

        schedule: {
          days: row.schedule_days,
          time: row.schedule_time,
        },
      },

      submitted_at: row.submitted_at,

      review: {
        reviewed_by: row.reviewed_by,
        reviewed_at: row.reviewed_at,
        review_remarks: row.review_remarks,
      },

      created_at: row.grade_created_at,
      updated_at: row.grade_updated_at,
    }));

    return res.status(200).json({
      success: true,

      program_head: {
        program_head_id: programHead.program_head_id,

        faculty_id: programHead.faculty_id,

        user_id: programHead.user_id,

        employee_number: programHead.employee_number,

        username: programHead.username,

        program_head_name: programHead.program_head_name,

        department: {
          department_id: programHead.department_id,

          department_code: programHead.department_code,

          department_name: programHead.department_name,
        },
      },

      filters: {
        academic_year_id: academicYearId,
        semester_id: semesterId,
      },

      summary: {
        total_submitted: grades.length,
      },

      grades,
    });
  } catch (error) {
    console.error("GET /api/program-head/grades/submitted error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve submitted grades.",
    });
  }
});

router.patch("/:gradeId/return", async (req, res) => {
  try {
    const programHead = await getAuthenticatedProgramHead(req, res);

    if (!programHead) {
      return;
    }

    const gradeId = Number(req.params.gradeId);

    if (!Number.isInteger(gradeId) || gradeId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid grade ID.",
      });
    }

    const reviewRemarks =
      typeof req.body?.review_remarks === "string"
        ? req.body.review_remarks.trim()
        : "";

    if (!reviewRemarks) {
      return res.status(400).json({
        success: false,
        message: "A return reason is required.",
      });
    }

    if (reviewRemarks.length > 500) {
      return res.status(400).json({
        success: false,
        message: "Return reason cannot exceed 500 characters.",
      });
    }

    const [rows] = await db.execute(
      `
        SELECT
            g.grade_id,
            g.enrollment_subject_id,
            g.faculty_id,
            g.midterm_grade,
            g.final_grade,
            g.final_rating,
            g.grading_policy,
            g.grading_outcome,
            g.outcome_reason,
            g.overall_percentage,
            g.remarks,
            g.grade_status,
            g.submitted_at,

            es.enrollment_id,
            es.status AS enrollment_subject_status,

            e.student_id,
            e.enrollment_status,

            s.student_number,
            s.first_name
                AS student_first_name,
            s.middle_name
                AS student_middle_name,
            s.last_name
                AS student_last_name,

            so.offering_id,
            so.status AS offering_status,

            sub.subject_id,
            sub.subject_code,
            sub.subject_name,

            sec.section_id,
            sec.section_name,
            sec.year_level,

            c.course_id,
            c.course_code,
            c.course_name,
            c.department_id,

            f.employee_number
                AS faculty_employee_number,
            f.first_name
                AS faculty_first_name,
            f.middle_name
                AS faculty_middle_name,
            f.last_name
                AS faculty_last_name
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
               es.subject_id
        INNER JOIN sections sec
            ON sec.section_id =
               es.section_id
        INNER JOIN courses c
            ON c.course_id =
               sec.course_id
        INNER JOIN faculty f
            ON f.faculty_id =
               g.faculty_id
        WHERE
            g.grade_id = ?
            AND c.department_id = ?
        LIMIT 1
        `,
      [gradeId, programHead.department_id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "Grade was not found or is outside your Program Head department.",
      });
    }

    const grade = rows[0];

    if (grade.grade_status !== "Submitted") {
      return res.status(409).json({
        success: false,
        message: `Only Submitted grades may be returned. Current status: ${grade.grade_status}.`,
      });
    }

    const [returnResult] = await db.execute(
      `
        UPDATE grades
        SET
            grade_status = 'Returned',
            reviewed_by = ?,
            review_remarks = ?
        WHERE grade_id = ?
          AND grade_status = 'Submitted'
        `,
      [programHead.user_id, reviewRemarks, grade.grade_id],
    );

    if (returnResult.affectedRows !== 1) {
      return res.status(409).json({
        success: false,
        message:
          "The grade is no longer available for return. Refresh and try again.",
      });
    }

    const [updatedRows] = await db.execute(
      `
          SELECT
              grade_id,
              enrollment_subject_id,
              faculty_id,
              midterm_grade,
              final_grade,
              final_rating,
              grading_policy,
              grading_outcome,
              outcome_reason,
              overall_percentage,
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

    const returned = updatedRows[0];

    return res.status(200).json({
      success: true,

      message: "Grade returned to Faculty successfully.",

      program_head: {
        program_head_id: programHead.program_head_id,

        user_id: programHead.user_id,

        program_head_name: programHead.program_head_name,

        department: {
          department_id: programHead.department_id,

          department_code: programHead.department_code,

          department_name: programHead.department_name,
        },
      },

      student: {
        student_id: grade.student_id,

        student_number: grade.student_number,

        full_name: [
          grade.student_first_name,
          grade.student_middle_name,
          grade.student_last_name,
        ]
          .filter(Boolean)
          .join(" "),
      },

      faculty: {
        faculty_id: grade.faculty_id,

        employee_number: grade.faculty_employee_number,

        faculty_name: [
          grade.faculty_first_name,
          grade.faculty_middle_name,
          grade.faculty_last_name,
        ]
          .filter(Boolean)
          .join(" "),
      },

      class: {
        offering_id: grade.offering_id,

        subject: {
          subject_id: grade.subject_id,
          subject_code: grade.subject_code,
          subject_name: grade.subject_name,
        },

        section: {
          section_id: grade.section_id,
          section_name: grade.section_name,
          year_level: grade.year_level,

          course: {
            course_id: grade.course_id,
            course_code: grade.course_code,
            course_name: grade.course_name,
          },
        },
      },

      grade: {
        grade_id: returned.grade_id,

        enrollment_subject_id: returned.enrollment_subject_id,

        faculty_id: returned.faculty_id,

        midterm_grade:
          returned.midterm_grade !== null
            ? Number(returned.midterm_grade)
            : null,

        final_grade:
          returned.final_grade !== null ? Number(returned.final_grade) : null,

        ...gradePolicyFields(returned),

        final_rating:
          returned.final_rating !== null ? Number(returned.final_rating) : null,

        remarks: returned.remarks,
        grade_status: returned.grade_status,
        submitted_at: returned.submitted_at,
        reviewed_by: returned.reviewed_by,
        reviewed_at: returned.reviewed_at,

        review_remarks: returned.review_remarks,

        created_at: returned.created_at,
        updated_at: returned.updated_at,
      },
    });
  } catch (error) {
    console.error(
      "PATCH /api/program-head/grades/:gradeId/return error:",
      error,
    );

    if (error?.errno === 1644 || error?.sqlState === "45000") {
      return res.status(409).json({
        success: false,

        message:
          error.sqlMessage ||
          error.message ||
          "Grade return was rejected by the database.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to return grade.",
    });
  }
});

// Legacy direct approval is retired. New gradebook grades must use their
// audited publication flow; old unapproved grades need controlled review.
// Existing Approved grades are not modified by this endpoint.
router.patch("/:gradeId/approve", async (req, res) => {
  try {
    const programHead = await getAuthenticatedProgramHead(req, res);
    if (!programHead) return;

    const gradeIdRaw = String(req.params.gradeId ?? "");
    if (
      !/^[1-9]\d*$/.test(gradeIdRaw) ||
      !Number.isSafeInteger(Number(gradeIdRaw))
    ) {
      return res.status(400).json({
        success: false,
        code: "GRADE_ID_INVALID",
        message: "Invalid grade ID.",
      });
    }

    const [rows] = await db.execute(
      `SELECT g.grade_id, g.grade_status, g.grading_policy
         FROM grades g
         JOIN enrollment_subjects es
           ON es.enrollment_subject_id = g.enrollment_subject_id
         JOIN subject_offerings so ON so.offering_id = es.offering_id
         JOIN sections sec ON sec.section_id = so.section_id
         JOIN courses c ON c.course_id = sec.course_id
        WHERE g.grade_id = ? AND c.department_id = ? LIMIT 1`,
      [Number(gradeIdRaw), programHead.department_id],
    );
    if (rows.length !== 1) {
      return res.status(404).json({
        success: false,
        code: "GRADE_NOT_FOUND_IN_DEPARTMENT",
        message: "Grade was not found in your department.",
      });
    }

    const grade = rows[0];
    if (grade.grade_status === "Approved") {
      return res.status(409).json({
        success: false,
        code: "GRADE_ALREADY_APPROVED",
        message:
          "This grade is already approved. Its official history is preserved.",
      });
    }

    return res.status(409).json({
      success: false,
      code: "LEGACY_DIRECT_GRADE_APPROVAL_DISABLED",
      message:
        grade.grading_policy === "TWO_TERM_50_50"
          ? "Use the official gradebook review and publication workflow. Direct approval is disabled."
          : "Unapproved historical grades need controlled source review or migration; direct approval is disabled.",
      grade_status: grade.grade_status,
      grading_policy: grade.grading_policy,
      official_grade_unchanged: true,
    });
  } catch (error) {
    console.error("LEGACY PROGRAM HEAD APPROVAL GUARD:", error);
    return res.status(500).json({
      success: false,
      code: "LEGACY_APPROVAL_GUARD_ERROR",
      message: "Could not inspect this grade for approval.",
    });
  }
});

// =====================================================
// GET GRADE CHANGE REQUESTS
//
// GET
// /api/program-head/grades/grade-change-requests
//
// Supported workflows:
//
// 1. INC_COMPLETION
// 2. GRADE_CORRECTION
//
// Program Head may only see requests belonging to
// courses under their assigned department.
// =====================================================

router.get("/grade-change-requests", async (req, res) => {
  try {
    // =================================================
    // AUTHENTICATED PROGRAM HEAD
    // =================================================

    const programHead = await getAuthenticatedProgramHead(req, res);

    if (!programHead) {
      return;
    }

    // =================================================
    // STATUS FILTER
    // =================================================

    const allowedStatuses = [
      "Pending Program Head",
      "For Registrar Processing",
      "Returned",
      "Rejected",
      "Completed",
    ];

    const requestedStatus =
      typeof req.query.status === "string" ? req.query.status.trim() : "";

    const status = requestedStatus || "Pending Program Head";

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid grade change request status.",
      });
    }

    // =================================================
    // LOAD DEPARTMENT GRADE CHANGE REQUESTS
    //
    // IMPORTANT:
    //
    // Do NOT filter here by:
    //
    // g.grading_outcome = 'INCOMPLETE'
    // g.final_rating = 4
    // g.remarks = 'Incomplete'
    // es.status = 'Incomplete'
    //
    // Those are workflow-specific validations.
    //
    // This queue handles BOTH:
    //
    // INC_COMPLETION
    // GRADE_CORRECTION
    // =================================================

    const [rows] = await db.execute(
      `
      SELECT
          -- ===========================================
          -- REQUEST
          -- ===========================================

          gcr.grade_change_request_id,
          gcr.grade_id,
          gcr.request_type,

          gcr.old_midterm_grade,
          gcr.old_final_grade,
          gcr.old_overall_percentage,
          gcr.old_final_rating,
          gcr.old_remarks,
          gcr.old_grading_outcome,
          gcr.old_outcome_reason,

          gcr.new_midterm_grade,
          gcr.new_final_grade,
          gcr.new_overall_percentage,
          gcr.new_final_rating,
          gcr.new_remarks,
          gcr.new_grading_outcome,

          gcr.completion_remarks,
          gcr.correction_reason,

          gcr.requested_by,
          gcr.requested_by_role,
          gcr.requested_at,

          gcr.reviewed_by,
          gcr.reviewed_at,
          gcr.review_remarks,

          gcr.processed_by,
          gcr.processed_at,
          gcr.registrar_remarks,

          gcr.status,

          gcr.created_at,
          gcr.updated_at,

          -- ===========================================
          -- CURRENT OFFICIAL GRADE
          -- ===========================================

          g.grade_status AS current_grade_status,
          g.grading_policy AS current_grading_policy,
          g.grading_outcome AS current_grading_outcome,
          g.outcome_reason AS current_outcome_reason,

          g.midterm_grade AS current_midterm_grade,
          g.final_grade AS current_final_grade,
          g.overall_percentage AS current_overall_percentage,
          g.final_rating AS current_final_rating,
          g.remarks AS current_remarks,

          g.faculty_id,

          -- ===========================================
          -- ENROLLMENT SUBJECT
          -- ===========================================

          es.enrollment_subject_id,
          es.enrollment_id,
          es.offering_id,
          es.subject_id,
          es.section_id,

          es.status AS enrollment_subject_status,

          -- ===========================================
          -- ENROLLMENT
          -- ===========================================

          e.student_id,
          e.enrollment_status,

          -- ===========================================
          -- STUDENT
          -- ===========================================

          s.student_number,

          s.first_name AS student_first_name,
          s.middle_name AS student_middle_name,
          s.last_name AS student_last_name,

          -- ===========================================
          -- CLASS OFFERING
          -- ===========================================

          so.status AS offering_status,

          so.academic_year_id,
          so.semester_id,

          -- ===========================================
          -- SUBJECT
          -- ===========================================

          sub.subject_code,
          sub.subject_name,

          -- ===========================================
          -- SECTION / COURSE
          -- ===========================================

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

          sem.semester_name,

          -- ===========================================
          -- FACULTY
          -- ===========================================

          f.employee_number AS faculty_employee_number,

          f.first_name AS faculty_first_name,
          f.middle_name AS faculty_middle_name,
          f.last_name AS faculty_last_name,

          f.email AS faculty_email,

          -- ===========================================
          -- REQUESTER
          -- ===========================================

          requester.username AS requested_by_username,

          -- ===========================================
          -- REVIEWER
          -- ===========================================

          reviewer.username AS reviewed_by_username,

          -- ===========================================
          -- PROCESSOR
          -- ===========================================

          processor.username AS processed_by_username

      FROM grade_change_requests gcr

      INNER JOIN grades g
          ON g.grade_id =
             gcr.grade_id

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
             es.subject_id

      INNER JOIN sections sec
          ON sec.section_id =
             es.section_id

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
             g.faculty_id

      LEFT JOIN users requester
          ON requester.user_id =
             gcr.requested_by

      LEFT JOIN users reviewer
          ON reviewer.user_id =
             gcr.reviewed_by

      LEFT JOIN users processor
          ON processor.user_id =
             gcr.processed_by

      WHERE
          c.department_id = ?

          AND gcr.request_type IN (
              'INC_COMPLETION',
              'GRADE_CORRECTION'
          )

          AND gcr.status = ?

      ORDER BY
          gcr.requested_at ASC,
          gcr.grade_change_request_id ASC
      `,
      [programHead.department_id, status],
    );

    // =================================================
    // MAP RESPONSE
    // =================================================

    const requests = rows.map((row) => ({
      grade_change_request_id: Number(row.grade_change_request_id),

      grade_id: Number(row.grade_id),

      request_type: row.request_type,

      status: row.status,

      // ===============================================
      // ORIGINAL SNAPSHOT
      // ===============================================

      original_grade: {
        midterm_grade:
          row.old_midterm_grade !== null ? Number(row.old_midterm_grade) : null,

        final_grade:
          row.old_final_grade !== null ? Number(row.old_final_grade) : null,

        overall_percentage:
          row.old_overall_percentage !== null
            ? Number(row.old_overall_percentage)
            : null,

        final_rating:
          row.old_final_rating !== null ? Number(row.old_final_rating) : null,

        remarks: row.old_remarks,

        grading_outcome: row.old_grading_outcome,

        outcome_reason: row.old_outcome_reason,
      },

      // ===============================================
      // PROPOSED SNAPSHOT
      // ===============================================

      proposed_grade: {
        midterm_grade:
          row.new_midterm_grade !== null ? Number(row.new_midterm_grade) : null,

        final_grade:
          row.new_final_grade !== null ? Number(row.new_final_grade) : null,

        overall_percentage:
          row.new_overall_percentage !== null
            ? Number(row.new_overall_percentage)
            : null,

        final_rating:
          row.new_final_rating !== null ? Number(row.new_final_rating) : null,

        remarks: row.new_remarks,

        grading_outcome: row.new_grading_outcome,
      },

      // ===============================================
      // CURRENT OFFICIAL GRADE
      //
      // Useful for detecting whether the official
      // grade changed after the request was created.
      // ===============================================

      current_official_grade: {
        grade_status: row.current_grade_status,

        grading_policy: row.current_grading_policy,

        grading_outcome: row.current_grading_outcome,

        outcome_reason: row.current_outcome_reason,

        midterm_grade:
          row.current_midterm_grade !== null
            ? Number(row.current_midterm_grade)
            : null,

        final_grade:
          row.current_final_grade !== null
            ? Number(row.current_final_grade)
            : null,

        overall_percentage:
          row.current_overall_percentage !== null
            ? Number(row.current_overall_percentage)
            : null,

        final_rating:
          row.current_final_rating !== null
            ? Number(row.current_final_rating)
            : null,

        remarks: row.current_remarks,
      },

      // ===============================================
      // WORKFLOW REASONS
      // ===============================================

      completion_remarks: row.completion_remarks || null,

      correction_reason: row.correction_reason || null,

      // ===============================================
      // STUDENT
      // ===============================================

      student: {
        student_id: Number(row.student_id),

        student_number: row.student_number,

        first_name: row.student_first_name,

        middle_name: row.student_middle_name,

        last_name: row.student_last_name,

        full_name: [
          row.student_first_name,
          row.student_middle_name,
          row.student_last_name,
        ]
          .filter(Boolean)
          .join(" "),
      },

      // ===============================================
      // FACULTY
      // ===============================================

      faculty: {
        faculty_id: row.faculty_id !== null ? Number(row.faculty_id) : null,

        employee_number: row.faculty_employee_number,

        first_name: row.faculty_first_name,

        middle_name: row.faculty_middle_name,

        last_name: row.faculty_last_name,

        faculty_name: [
          row.faculty_first_name,
          row.faculty_middle_name,
          row.faculty_last_name,
        ]
          .filter(Boolean)
          .join(" "),

        email: row.faculty_email,
      },

      // ===============================================
      // CLASS
      // ===============================================

      class: {
        offering_id: Number(row.offering_id),

        enrollment_subject_id: Number(row.enrollment_subject_id),

        offering_status: row.offering_status,

        enrollment_subject_status: row.enrollment_subject_status,

        subject: {
          subject_id: Number(row.subject_id),

          subject_code: row.subject_code,

          subject_name: row.subject_name,
        },

        section: {
          section_id: Number(row.section_id),

          section_name: row.section_name,

          year_level: Number(row.year_level),

          course: {
            course_id: Number(row.course_id),

            course_code: row.course_code,

            course_name: row.course_name,
          },
        },
      },

      // ===============================================
      // PERIOD
      // ===============================================

      period: {
        academic_year_id: Number(row.academic_year_id),

        academic_year: row.academic_year,

        semester_id: Number(row.semester_id),

        semester_name: row.semester_name,
      },

      // ===============================================
      // REQUESTER
      // ===============================================

      requested_by: {
        user_id: Number(row.requested_by),

        username: row.requested_by_username,

        role: row.requested_by_role,

        requested_at: row.requested_at,
      },

      requested_at: row.requested_at,

      // ===============================================
      // PROGRAM HEAD REVIEW
      // ===============================================

      reviewed_by:
        row.reviewed_by !== null
          ? {
              user_id: Number(row.reviewed_by),

              username: row.reviewed_by_username,

              reviewed_at: row.reviewed_at,

              review_remarks: row.review_remarks,
            }
          : null,

      reviewed_at: row.reviewed_at,

      review_remarks: row.review_remarks,

      // ===============================================
      // REGISTRAR
      // ===============================================

      processed_by:
        row.processed_by !== null
          ? {
              user_id: Number(row.processed_by),

              username: row.processed_by_username,

              processed_at: row.processed_at,
            }
          : null,

      processed_at: row.processed_at,

      registrar_remarks: row.registrar_remarks,

      created_at: row.created_at,

      updated_at: row.updated_at,
    }));

    // =================================================
    // SUCCESS
    // =================================================

    return res.status(200).json({
      success: true,

      program_head: {
        program_head_id: Number(programHead.program_head_id),

        user_id: Number(programHead.user_id),

        program_head_name: programHead.program_head_name,

        department: {
          department_id: Number(programHead.department_id),

          department_code: programHead.department_code,

          department_name: programHead.department_name,
        },
      },

      filters: {
        status,
      },

      summary: {
        total_requests: requests.length,
      },

      requests,
    });
  } catch (error) {
    console.error(
      "GET /api/program-head/grades/grade-change-requests error:",
      error,
    );

    return res.status(500).json({
      success: false,

      message: "Failed to retrieve grade change requests.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// =====================================================
// APPROVE GRADE CHANGE REQUEST
//
// PATCH
// /api/program-head/grades/grade-change-requests/:requestId/approve
//
// Supported:
// - INC_COMPLETION
// - GRADE_CORRECTION
//
// Workflow:
//
// INC_COMPLETION
// Pending Program Head
//        ↓
// For Registrar Processing
//        ↓
// Registrar posts replacement grade
//
// GRADE_CORRECTION
// Pending Program Head
//        ↓
// For Registrar Processing
//        ↓
// Registrar posts corrected numeric grade
//
// IMPORTANT:
// Program Head approval NEVER modifies grades.
//
// Only the request status is changed here.
//
// Registrar is responsible for the final modification
// of the official grade.
// =====================================================

router.patch("/grade-change-requests/:requestId/approve", async (req, res) => {
  let connection;

  try {
    // =================================================
    // AUTHENTICATED PROGRAM HEAD
    // =================================================

    const programHead = await getAuthenticatedProgramHead(req, res);

    if (!programHead) {
      return;
    }

    // =================================================
    // REQUEST ID
    // =================================================

    const requestId = Number(req.params.requestId);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid grade change request ID.",
      });
    }

    // =================================================
    // REVIEW REMARKS
    // =================================================

    const reviewRemarks =
      typeof req.body?.review_remarks === "string"
        ? req.body.review_remarks.trim()
        : "";

    if (reviewRemarks.length > 1000) {
      return res.status(400).json({
        success: false,
        message: "Review remarks cannot exceed 1000 characters.",
      });
    }

    // =================================================
    // DATABASE CONNECTION
    // =================================================

    connection = await db.getConnection();

    await connection.beginTransaction();

    // =================================================
    // LOAD + LOCK REQUEST
    //
    // IMPORTANT:
    //
    // Do NOT filter request_type here.
    //
    // Both:
    //
    // INC_COMPLETION
    // GRADE_CORRECTION
    //
    // are valid Program Head requests.
    // =================================================

    const [rows] = await connection.execute(
      `
          SELECT
              -- =========================================
              -- REQUEST
              -- =========================================

              gcr.grade_change_request_id,
              gcr.grade_id,
              gcr.request_type,

              gcr.old_midterm_grade,
              gcr.old_final_grade,
              gcr.old_overall_percentage,
              gcr.old_final_rating,
              gcr.old_remarks,
              gcr.old_grading_outcome,
              gcr.old_outcome_reason,

              gcr.new_midterm_grade,
              gcr.new_final_grade,
              gcr.new_overall_percentage,
              gcr.new_final_rating,
              gcr.new_remarks,
              gcr.new_grading_outcome,

              gcr.completion_remarks,
              gcr.correction_reason,

              gcr.requested_by,
              gcr.requested_by_role,
              gcr.requested_at,

              gcr.reviewed_by,
              gcr.reviewed_at,
              gcr.review_remarks,

              gcr.processed_by,
              gcr.processed_at,
              gcr.registrar_remarks,

              gcr.status,

              gcr.created_at,
              gcr.updated_at,

              -- =========================================
              -- CURRENT OFFICIAL GRADE
              -- =========================================

              g.grade_status
                  AS current_grade_status,

              g.grading_policy
                  AS current_grading_policy,

              g.grading_outcome
                  AS current_grading_outcome,

              g.outcome_reason
                  AS current_outcome_reason,

              g.midterm_grade
                  AS current_midterm_grade,

              g.final_grade
                  AS current_final_grade,

              g.overall_percentage
                  AS current_overall_percentage,

              g.final_rating
                  AS current_final_rating,

              g.remarks
                  AS current_remarks,

              g.enrollment_subject_id,

              -- =========================================
              -- ENROLLMENT SUBJECT
              -- =========================================

              es.status
                  AS enrollment_subject_status,

              -- =========================================
              -- ENROLLMENT
              -- =========================================

              e.enrollment_status,

              e.student_id,

              -- =========================================
              -- STUDENT
              -- =========================================

              s.student_number,

              s.first_name
                  AS student_first_name,

              s.middle_name
                  AS student_middle_name,

              s.last_name
                  AS student_last_name,

              -- =========================================
              -- SUBJECT OFFERING
              -- =========================================

              so.offering_id,

              so.status
                  AS offering_status,

              -- =========================================
              -- SUBJECT
              -- =========================================

              sub.subject_id,

              sub.subject_code,

              sub.subject_name,

              -- =========================================
              -- SECTION
              -- =========================================

              sec.section_id,

              sec.section_name,

              -- =========================================
              -- DEPARTMENT
              -- =========================================

              c.department_id

          FROM grade_change_requests gcr

          INNER JOIN grades g
              ON g.grade_id =
                 gcr.grade_id

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
                 es.subject_id

          INNER JOIN sections sec
              ON sec.section_id =
                 es.section_id

          INNER JOIN courses c
              ON c.course_id =
                 sec.course_id

          WHERE
              gcr.grade_change_request_id = ?

              AND c.department_id = ?

          LIMIT 1

          FOR UPDATE
        `,
      [requestId, programHead.department_id],
    );

    // =================================================
    // REQUEST NOT FOUND
    // =================================================

    if (rows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message:
          "Grade change request was not found or is outside your department.",
      });
    }

    const request = rows[0];

    // =================================================
    // VALID REQUEST TYPE
    // =================================================

    if (
      request.request_type !== "INC_COMPLETION" &&
      request.request_type !== "GRADE_CORRECTION"
    ) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: `Unsupported grade change request type: ${request.request_type}.`,
      });
    }

    // =================================================
    // REQUEST STATUS
    // =================================================

    if (request.status !== "Pending Program Head") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          `Only Pending Program Head requests may be approved. ` +
          `Current status: ${request.status}.`,
      });
    }

    // =================================================
    // REQUEST MUST COME FROM FACULTY
    // =================================================

    if (request.requested_by_role !== "Faculty") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "This request does not require Program Head approval.",
      });
    }

    // =================================================
    // ENROLLMENT MUST STILL BE APPROVED
    // =================================================

    if (request.enrollment_status !== "Approved") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "The student's enrollment is no longer approved.",
      });
    }

    // Legacy corrections cannot alter published or finalized grades.
    if (request.request_type === "GRADE_CORRECTION") {
      const [[source]] = await connection.execute(
        `SELECT
           EXISTS (
             SELECT 1 FROM gradebook_official_grade_publications
             WHERE grade_id = ?
           ) AS has_publication,
           EXISTS (
             SELECT 1 FROM gradebook_finalized_roster
             WHERE grade_id = ?
           ) AS has_finalized_roster,
           EXISTS (
             SELECT 1 FROM grade_change_requests
             WHERE grade_id = ?
               AND request_type = 'INC_COMPLETION'
               AND status = 'Completed'
           ) AS has_inc_history`,
        [request.grade_id, request.grade_id, request.grade_id],
      );

      if (
        Number(source.has_publication) === 1 ||
        Number(source.has_finalized_roster) === 1 ||
        Number(source.has_inc_history) === 1
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          code: "GRADE_CORRECTION_SOURCE_LINK_REQUIRED",
          message:
            "This grade has official publication, finalization, or INC conversion history. " +
            "Use the source-linked correction and official-sheet amendment workflow.",
        });
      }
    }

    // =================================================
    // INC COMPLETION VALIDATION
    // =================================================

    if (request.request_type === "INC_COMPLETION") {
      // ===============================================
      // OFFICIAL GRADE MUST STILL BE APPROVED INC
      // ===============================================

      const stillIncomplete =
        String(request.current_grading_outcome || "").toUpperCase() ===
          "INCOMPLETE" ||
        String(request.current_remarks || "").toLowerCase() === "incomplete" ||
        Number(request.current_final_rating) === 4;

      if (request.current_grade_status !== "Approved" || !stillIncomplete) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "The original grade is no longer an approved INC record.",
        });
      }

      // ===============================================
      // PROPOSED COMPLETION MUST BE NUMERIC
      // ===============================================

      if (
        String(request.new_grading_outcome || "").toUpperCase() !== "NUMERIC"
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "The INC completion request must contain a NUMERIC proposed grade.",
        });
      }

      // ===============================================
      // PROPOSED MIDTERM + FINAL
      // ===============================================

      if (
        request.new_midterm_grade === null ||
        request.new_midterm_grade === undefined ||
        request.new_final_grade === null ||
        request.new_final_grade === undefined
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "The INC completion request does not contain complete proposed grades.",
        });
      }

      const proposedMidterm = Number(request.new_midterm_grade);

      const proposedFinal = Number(request.new_final_grade);

      // ===============================================
      // MIDTERM VALIDATION
      // ===============================================

      if (
        !Number.isFinite(proposedMidterm) ||
        proposedMidterm < 0 ||
        proposedMidterm > 100
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "The proposed midterm grade is invalid.",
        });
      }

      // ===============================================
      // FINAL VALIDATION
      // ===============================================

      if (
        !Number.isFinite(proposedFinal) ||
        proposedFinal < 0 ||
        proposedFinal > 100
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "The proposed final grade is invalid.",
        });
      }

      // ===============================================
      // 50/50 CALCULATION
      // ===============================================

      const expectedOverall = proposedMidterm * 0.5 + proposedFinal * 0.5;

      const proposedOverall = Number(request.new_overall_percentage);

      if (
        !Number.isFinite(proposedOverall) ||
        Math.abs(proposedOverall - expectedOverall) > 0.01
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "The proposed overall percentage does not match the 50/50 grading policy.",
        });
      }
    }
    if (
      request.request_type === "INC_COMPLETION" &&
      Number(request.offering_id) === 131
    ) {
      const [[qaDb]] = await connection.execute("SELECT DATABASE() AS name");
      const [evidenceRows] = await connection.execute(
        `SELECT cl.claim_id, cl.record_version, cl.grade_change_request_id,
                  cl.verification_status, cl.submitted_by_user_id,
                  cl.verified_by_user_id, cl.verified_at,
                  DATE_FORMAT(cl.verified_completed_on, '%Y-%m-%d') AS completed_on,
                  cfg.config_id, sh.sheet_id,
                  sh.official_date_verified_at,
                  sh.official_date_verified_by_user_id,
                  DATE_FORMAT(DATE_ADD(sh.original_official_submitted_on, INTERVAL 1 YEAR),
                              '%Y-%m-%d') AS deadline_on
             FROM grades g
             JOIN enrollment_subjects es
               ON es.enrollment_subject_id = g.enrollment_subject_id
             JOIN gradebook_offering_config cfg ON cfg.offering_id = es.offering_id
             JOIN gradebook_inc_completion_claims cl ON cl.grade_id = g.grade_id
             JOIN gradebook_official_sheets sh ON sh.config_id = cfg.config_id
            WHERE g.grade_id = ? AND es.offering_id = 131 FOR UPDATE`,
        [request.grade_id],
      );
      const evidence = evidenceRows[0];
      if (
        qaDb?.name !== "databaseforptc1_admission_test" ||
        evidenceRows.length !== 1 ||
        evidence.verification_status !== "VERIFIED_TIMELY" ||
        evidence.grade_change_request_id !== null ||
        !evidence.verified_at ||
        !evidence.completed_on ||
        !evidence.deadline_on ||
        evidence.completed_on > evidence.deadline_on ||
        !evidence.official_date_verified_at ||
        !evidence.official_date_verified_by_user_id ||
        Number(evidence.verified_by_user_id) !== Number(programHead.user_id) ||
        Number(evidence.submitted_by_user_id) !== Number(request.requested_by)
      ) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          code: "INC_REPLACEMENT_EVIDENCE_INVALID",
          message:
            "The verified claim or official-sheet evidence is missing or changed.",
        });
      }

      // This proof is written by the new assessment-based Faculty request route.
      const [proofRows] = await connection.execute(
        `SELECT new_values FROM audit_trail
            WHERE table_name = 'grade_change_requests' AND record_id = ?
              AND action = 'INSERT'
            ORDER BY audit_id DESC LIMIT 1 FOR UPDATE`,
        [requestId],
      );
      let proof = null;
      try {
        proof =
          typeof proofRows[0]?.new_values === "string"
            ? JSON.parse(proofRows[0].new_values)
            : proofRows[0]?.new_values;
      } catch {
        /* Reject missing or malformed provenance below. */
      }

      // Confirm the proposed grade matches the Faculty's original request.
      const filedGrade = proof?.proposed_grade;

      const sameGradeNumber = (stored, filed) =>
        stored !== null &&
        stored !== undefined &&
        filed !== null &&
        filed !== undefined &&
        String(stored).trim() !== "" &&
        String(filed).trim() !== "" &&
        Number.isFinite(Number(stored)) &&
        Number.isFinite(Number(filed)) &&
        Number(stored) === Number(filed);

      if (
        !filedGrade ||
        !sameGradeNumber(request.new_midterm_grade, filedGrade.midterm) ||
        !sameGradeNumber(request.new_final_grade, filedGrade.final) ||
        !sameGradeNumber(request.new_overall_percentage, filedGrade.overall) ||
        !sameGradeNumber(request.new_final_rating, filedGrade.rating) ||
        String(request.new_remarks) !== String(filedGrade.remarks) ||
        request.new_grading_outcome !== "NUMERIC" ||
        request.current_grade_status !== "Approved" ||
        request.current_grading_policy !== "TWO_TERM_50_50" ||
        request.current_grading_outcome !== "INCOMPLETE" ||
        Number(request.current_final_rating) !== 4 ||
        request.enrollment_subject_status !== "Incomplete"
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          code: "INC_REPLACEMENT_PROPOSAL_CHANGED",
          message:
            "The proposed grade no longer matches the Faculty's audited assessment-based request.",
        });
      }

      const [termRows] = await connection.execute(
        `SELECT term_submission_id, grading_term, submission_status,
                  reviewed_by_user_id, reviewed_at, submitted_by_user_id,
                  submitted_at, calculation_snapshot_json
             FROM gradebook_term_submission_attempts
            WHERE config_id = ? AND enrollment_subject_id = ?
            ORDER BY grading_term, attempt_number DESC, term_submission_id DESC
            FOR UPDATE`,
        [evidence.config_id, request.enrollment_subject_id],
      );
      const latest = {};
      for (const term of termRows) {
        if (!latest[term.grading_term]) latest[term.grading_term] = term;
      }
      const mid = latest.MIDTERM;
      const fin = latest.FINAL_TERM;
      let snapshot = null;
      try {
        const raw = fin?.calculation_snapshot_json;
        snapshot =
          typeof raw === "string"
            ? JSON.parse(raw)
            : Buffer.isBuffer(raw)
              ? JSON.parse(raw.toString("utf8"))
              : raw;
      } catch {
        /* Reject invalid calculation snapshot below. */
      }
      if (
        !mid ||
        !fin ||
        mid.submission_status !== "APPROVED" ||
        fin.submission_status !== "APPROVED" ||
        !mid.reviewed_at ||
        !fin.reviewed_at ||
        !fin.submitted_at ||
        Number(fin.reviewed_by_user_id) !== Number(programHead.user_id) ||
        Number(fin.submitted_by_user_id) !== Number(request.requested_by) ||
        !(new Date(fin.submitted_at) >= new Date(evidence.verified_at)) ||
        !(new Date(fin.reviewed_at) <= new Date(request.requested_at)) ||
        !proof ||
        proof.request_type !== "INC_COMPLETION" ||
        String(proof.grade_change_request_id) !== String(requestId) ||
        String(proof.claim_id) !== String(evidence.claim_id) ||
        Number(proof.claim_version) !== Number(evidence.record_version) ||
        String(proof.midterm_submission_id) !==
          String(mid.term_submission_id) ||
        String(proof.final_submission_id) !== String(fin.term_submission_id) ||
        snapshot?.submission_context !== "INC_COMPLETION_FINAL_TERM" ||
        snapshot.policy !== "TWO_TERM_50_50" ||
        snapshot.calculated_term?.state !== "READY" ||
        String(snapshot.inc_completion_claim_id) !==
          String(evidence.claim_id) ||
        Number(snapshot.inc_completion_claim_version) !==
          Number(evidence.record_version) ||
        Number(snapshot.original_inc_grade_id) !== Number(request.grade_id) ||
        String(snapshot.official_sheet_id) !== String(evidence.sheet_id) ||
        snapshot.verified_completed_on !== evidence.completed_on
      ) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          code: "INC_REPLACEMENT_SOURCE_UNVERIFIED",
          message:
            "The INC replacement request is not backed by approved, matching grading snapshots.",
        });
      }
    }
    // =================================================
    // GRADE CORRECTION VALIDATION
    // =================================================

    if (request.request_type === "GRADE_CORRECTION") {
      // ===============================================
      // OFFICIAL GRADE MUST STILL BE
      // APPROVED + NUMERIC
      // ===============================================

      if (
        request.current_grade_status !== "Approved" ||
        String(request.current_grading_outcome || "").toUpperCase() !==
          "NUMERIC"
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "The original grade is no longer an approved numeric grade.",
        });
      }

      // ===============================================
      // GRADING POLICY
      //
      // IMPORTANT:
      //
      // grade_change_requests DOES NOT contain:
      //
      // old_grading_policy
      // new_grading_policy
      //
      // Therefore the current official grade is
      // authoritative for the grading policy.
      // ===============================================

      if (
        String(request.current_grading_policy || "").toUpperCase() !==
        "TWO_TERM_50_50"
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "The official grade does not use the supported TWO_TERM_50_50 grading policy.",
        });
      }

      // ===============================================
      // NUMERIC COMPARISON HELPER
      // ===============================================

      const numbersMatch = (currentValue, oldValue) => {
        if (
          currentValue === null ||
          currentValue === undefined ||
          oldValue === null ||
          oldValue === undefined
        ) {
          return (
            currentValue === oldValue ||
            (currentValue == null && oldValue == null)
          );
        }

        return Number(currentValue) === Number(oldValue);
      };

      // ===============================================
      // STRING COMPARISON HELPER
      // ===============================================

      const stringsMatch = (currentValue, oldValue) => {
        return String(currentValue ?? "") === String(oldValue ?? "");
      };

      // ===============================================
      // CURRENT OFFICIAL GRADE MUST MATCH
      // ORIGINAL SNAPSHOT
      //
      // We compare ONLY fields that actually exist
      // in grade_change_requests.
      //
      // We DO NOT compare grading_policy because
      // there is no old_grading_policy column.
      // ===============================================

      const snapshotMatches =
        numbersMatch(
          request.current_midterm_grade,
          request.old_midterm_grade,
        ) &&
        numbersMatch(request.current_final_grade, request.old_final_grade) &&
        numbersMatch(
          request.current_overall_percentage,
          request.old_overall_percentage,
        ) &&
        numbersMatch(request.current_final_rating, request.old_final_rating) &&
        stringsMatch(
          request.current_grading_outcome,
          request.old_grading_outcome,
        ) &&
        stringsMatch(
          request.current_outcome_reason,
          request.old_outcome_reason,
        ) &&
        stringsMatch(request.current_remarks, request.old_remarks);

      // ===============================================
      // STALE REQUEST PROTECTION
      // ===============================================

      if (!snapshotMatches) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "The official grade has changed since this correction request was submitted. The request must be reviewed again.",
        });
      }

      // ===============================================
      // PROPOSED GRADE MUST EXIST
      // ===============================================

      if (
        request.new_midterm_grade === null ||
        request.new_midterm_grade === undefined ||
        request.new_final_grade === null ||
        request.new_final_grade === undefined
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "The grade correction request does not contain complete proposed grades.",
        });
      }

      const proposedMidterm = Number(request.new_midterm_grade);

      const proposedFinal = Number(request.new_final_grade);

      // ===============================================
      // MIDTERM VALIDATION
      // ===============================================

      if (
        !Number.isFinite(proposedMidterm) ||
        proposedMidterm < 0 ||
        proposedMidterm > 100
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "The proposed midterm grade is invalid.",
        });
      }

      // ===============================================
      // FINAL VALIDATION
      // ===============================================

      if (
        !Number.isFinite(proposedFinal) ||
        proposedFinal < 0 ||
        proposedFinal > 100
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "The proposed final grade is invalid.",
        });
      }

      // ===============================================
      // BACKEND 50/50 CALCULATION
      // ===============================================

      const expectedOverall = proposedMidterm * 0.5 + proposedFinal * 0.5;

      const proposedOverall = Number(request.new_overall_percentage);

      if (
        !Number.isFinite(proposedOverall) ||
        Math.abs(proposedOverall - expectedOverall) > 0.01
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "The proposed overall percentage does not match the 50/50 grading policy.",
        });
      }

      // ===============================================
      // PROPOSED RESULT MUST BE NUMERIC
      // ===============================================

      if (
        String(request.new_grading_outcome || "").toUpperCase() !== "NUMERIC"
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "A numeric grade correction must have NUMERIC as its grading outcome.",
        });
      }
    }

    // =================================================
    // UPDATE REQUEST ONLY
    //
    // IMPORTANT:
    //
    // The grades table is NOT modified here.
    //
    // Program Head approval only moves:
    //
    // Pending Program Head
    //        ↓
    // For Registrar Processing
    //
    // Registrar will perform the actual official
    // grade correction later.
    // =================================================

    const [updateResult] = await connection.execute(
      `
            UPDATE grade_change_requests

            SET
                status =
                    'For Registrar Processing',

                reviewed_by = ?,

                reviewed_at =
                    CURRENT_TIMESTAMP,

                review_remarks = ?

            WHERE
                grade_change_request_id = ?

                AND status =
                    'Pending Program Head'
          `,
      [programHead.user_id, reviewRemarks || null, requestId],
    );

    // =================================================
    // CONCURRENCY CHECK
    // =================================================

    if (updateResult.affectedRows !== 1) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "The request is no longer available for approval. Refresh and try again.",
      });
    }

    // =================================================
    // AUDIT TRAIL
    // =================================================

    await connection.execute(
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
              'grade_change_requests',
              ?,
              'UPDATE',
              ?,
              ?
          )
        `,
      [
        programHead.user_id,

        requestId,

        JSON.stringify({
          status: request.status,

          request_type: request.request_type,

          reviewed_by: request.reviewed_by,

          reviewed_at: request.reviewed_at,
        }),

        JSON.stringify({
          status: "For Registrar Processing",

          request_type: request.request_type,

          reviewed_by: programHead.user_id,

          review_remarks: reviewRemarks || null,
        }),
      ],
    );

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // RESPONSE MESSAGE
    // =================================================

    const responseMessage =
      request.request_type === "GRADE_CORRECTION"
        ? "Grade correction request approved and forwarded to Registrar."
        : "INC completion request approved and forwarded to Registrar.";

    // =================================================
    // SUCCESS RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      message: responseMessage,

      request: {
        grade_change_request_id: requestId,

        grade_id: Number(request.grade_id),

        request_type: request.request_type,

        status: "For Registrar Processing",

        reviewed_by: Number(programHead.user_id),

        reviewed_by_name: programHead.program_head_name,

        review_remarks: reviewRemarks || null,
      },

      student: {
        student_id: Number(request.student_id),

        student_number: request.student_number,

        full_name: [
          request.student_first_name,
          request.student_middle_name,
          request.student_last_name,
        ]
          .filter(Boolean)
          .join(" "),
      },

      class: {
        offering_id: Number(request.offering_id),

        subject: {
          subject_id: Number(request.subject_id),

          subject_code: request.subject_code,

          subject_name: request.subject_name,
        },

        section: {
          section_id: Number(request.section_id),

          section_name: request.section_name,
        },
      },

      // ===============================================
      // ORIGINAL OFFICIAL GRADE
      // ===============================================

      original_grade: {
        midterm_grade:
          request.old_midterm_grade !== null
            ? Number(request.old_midterm_grade)
            : null,

        final_grade:
          request.old_final_grade !== null
            ? Number(request.old_final_grade)
            : null,

        overall_percentage:
          request.old_overall_percentage !== null
            ? Number(request.old_overall_percentage)
            : null,

        final_rating:
          request.old_final_rating !== null
            ? Number(request.old_final_rating)
            : null,

        remarks: request.old_remarks,

        // IMPORTANT:
        // There is no old_grading_policy
        // column in grade_change_requests.
        //
        // The official/current policy is returned.
        grading_policy: request.current_grading_policy,

        grading_outcome: request.old_grading_outcome,

        outcome_reason: request.old_outcome_reason,
      },

      // ===============================================
      // PROPOSED CORRECTED GRADE
      // ===============================================

      proposed_grade: {
        midterm_grade:
          request.new_midterm_grade !== null
            ? Number(request.new_midterm_grade)
            : null,

        final_grade:
          request.new_final_grade !== null
            ? Number(request.new_final_grade)
            : null,

        overall_percentage:
          request.new_overall_percentage !== null
            ? Number(request.new_overall_percentage)
            : null,

        final_rating:
          request.new_final_rating !== null
            ? Number(request.new_final_rating)
            : null,

        remarks: request.new_remarks,

        // GRADE_CORRECTION uses the same
        // supported grading policy.
        grading_policy: "TWO_TERM_50_50",

        grading_outcome: request.new_grading_outcome,
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
        console.error("PROGRAM HEAD APPROVAL ROLLBACK ERROR:", rollbackError);
      }
    }

    // =================================================
    // SERVER LOG
    // =================================================

    console.error("PROGRAM HEAD GRADE CHANGE APPROVAL ERROR:", error);

    // =================================================
    // DATABASE BUSINESS RULE ERROR
    // =================================================

    if (error?.errno === 1644 || error?.sqlState === "45000") {
      return res.status(409).json({
        success: false,
        message:
          error.sqlMessage ||
          error.message ||
          "Grade operation was rejected by the database.",
      });
    }

    // =================================================
    // DUPLICATE ERROR
    // =================================================

    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "A duplicate grade-change request was detected.",
      });
    }

    // =================================================
    // GENERIC ERROR
    // =================================================

    return res.status(500).json({
      success: false,
      message: "Failed to approve grade change request.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
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
// RETURN INC COMPLETION REQUEST
//
// PATCH
// /api/program-head/grades/grade-change-requests/:requestId/return
// =====================================================

router.patch("/grade-change-requests/:requestId/return", async (req, res) => {
  let connection;

  try {
    const programHead = await getAuthenticatedProgramHead(req, res);

    if (!programHead) {
      return;
    }

    const requestId = Number(req.params.requestId);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid grade change request ID.",
      });
    }

    const reviewRemarks =
      typeof req.body?.review_remarks === "string"
        ? req.body.review_remarks.trim()
        : "";

    if (!reviewRemarks) {
      return res.status(400).json({
        success: false,
        message: "A return reason is required.",
      });
    }

    if (reviewRemarks.length > 1000) {
      return res.status(400).json({
        success: false,
        message: "Return reason cannot exceed 1000 characters.",
      });
    }

    connection = await db.getConnection();

    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `
          SELECT
              gcr.grade_change_request_id,
              gcr.grade_id,
              gcr.status,

              c.department_id

          FROM grade_change_requests gcr

          INNER JOIN grades g
              ON g.grade_id =
                 gcr.grade_id

          INNER JOIN enrollment_subjects es
              ON es.enrollment_subject_id =
                 g.enrollment_subject_id

          INNER JOIN sections sec
              ON sec.section_id =
                 es.section_id

          INNER JOIN courses c
              ON c.course_id =
                 sec.course_id

          WHERE
              gcr.grade_change_request_id = ?

              AND gcr.request_type =
                  'INC_COMPLETION'

              AND c.department_id = ?

          LIMIT 1

          FOR UPDATE
          `,
      [requestId, programHead.department_id],
    );

    if (rows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,

        message:
          "INC completion request was not found or is outside your department.",
      });
    }

    const request = rows[0];

    if (request.status !== "Pending Program Head") {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message: `Only Pending Program Head requests may be returned. Current status: ${request.status}.`,
      });
    }

    const [updateResult] = await connection.execute(
      `
          UPDATE grade_change_requests

          SET
              status = 'Returned',

              reviewed_by = ?,

              reviewed_at =
                  CURRENT_TIMESTAMP,

              review_remarks = ?

          WHERE
              grade_change_request_id = ?

              AND status =
                  'Pending Program Head'
          `,
      [programHead.user_id, reviewRemarks, requestId],
    );

    if (updateResult.affectedRows !== 1) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message: "The request is no longer available for return.",
      });
    }

    await connection.execute(
      `
        INSERT INTO audit_trail (
            user_id,
            table_name,
            record_id,
            action,
            old_values,
            new_values
        )

        VALUES (?, ?, ?, ?, ?, ?)
        `,
      [
        programHead.user_id,

        "grade_change_requests",

        requestId,

        "UPDATE",

        JSON.stringify({
          status: request.status,
        }),

        JSON.stringify({
          status: "Returned",

          review_remarks: reviewRemarks,
        }),
      ],
    );

    await connection.commit();

    return res.status(200).json({
      success: true,

      message: "INC completion request returned to Faculty.",

      request: {
        grade_change_request_id: requestId,

        grade_id: Number(request.grade_id),

        status: "Returned",

        review_remarks: reviewRemarks,
      },
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch {}
    }

    console.error("PROGRAM HEAD RETURN INC ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to return INC completion request.",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// REJECT INC COMPLETION REQUEST
//
// PATCH
// /api/program-head/grades/grade-change-requests/:requestId/reject
// =====================================================

router.patch("/grade-change-requests/:requestId/reject", async (req, res) => {
  let connection;

  try {
    const programHead = await getAuthenticatedProgramHead(req, res);

    if (!programHead) {
      return;
    }

    const requestId = Number(req.params.requestId);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid grade change request ID.",
      });
    }

    const reviewRemarks =
      typeof req.body?.review_remarks === "string"
        ? req.body.review_remarks.trim()
        : "";

    if (!reviewRemarks) {
      return res.status(400).json({
        success: false,

        message: "A rejection reason is required.",
      });
    }

    if (reviewRemarks.length > 1000) {
      return res.status(400).json({
        success: false,

        message: "Rejection reason cannot exceed 1000 characters.",
      });
    }

    connection = await db.getConnection();

    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `
          SELECT
              gcr.grade_change_request_id,
              gcr.grade_id,
              gcr.status,

              c.department_id

          FROM grade_change_requests gcr

          INNER JOIN grades g
              ON g.grade_id =
                 gcr.grade_id

          INNER JOIN enrollment_subjects es
              ON es.enrollment_subject_id =
                 g.enrollment_subject_id

          INNER JOIN sections sec
              ON sec.section_id =
                 es.section_id

          INNER JOIN courses c
              ON c.course_id =
                 sec.course_id

          WHERE
              gcr.grade_change_request_id = ?

              AND gcr.request_type =
                  'INC_COMPLETION'

              AND c.department_id = ?

          LIMIT 1

          FOR UPDATE
          `,
      [requestId, programHead.department_id],
    );

    if (rows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,

        message:
          "INC completion request was not found or is outside your department.",
      });
    }

    const request = rows[0];

    if (request.status !== "Pending Program Head") {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message: `Only Pending Program Head requests may be rejected. Current status: ${request.status}.`,
      });
    }

    const [updateResult] = await connection.execute(
      `
          UPDATE grade_change_requests

          SET
              status = 'Rejected',

              reviewed_by = ?,

              reviewed_at =
                  CURRENT_TIMESTAMP,

              review_remarks = ?

          WHERE
              grade_change_request_id = ?

              AND status =
                  'Pending Program Head'
          `,
      [programHead.user_id, reviewRemarks, requestId],
    );

    if (updateResult.affectedRows !== 1) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message: "The request is no longer available for rejection.",
      });
    }

    await connection.execute(
      `
        INSERT INTO audit_trail (
            user_id,
            table_name,
            record_id,
            action,
            old_values,
            new_values
        )

        VALUES (?, ?, ?, ?, ?, ?)
        `,
      [
        programHead.user_id,

        "grade_change_requests",

        requestId,

        "UPDATE",

        JSON.stringify({
          status: request.status,
        }),

        JSON.stringify({
          status: "Rejected",

          review_remarks: reviewRemarks,
        }),
      ],
    );

    await connection.commit();

    return res.status(200).json({
      success: true,

      message: "INC completion request rejected.",

      request: {
        grade_change_request_id: requestId,

        grade_id: Number(request.grade_id),

        status: "Rejected",

        review_remarks: reviewRemarks,
      },
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch {}
    }

    console.error("PROGRAM HEAD REJECT INC ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to reject INC completion request.",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

export default router;
