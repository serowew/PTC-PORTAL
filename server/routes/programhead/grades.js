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

router.patch("/:gradeId/approve", async (req, res) => {
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

            ay.academic_year_id,
            ay.academic_year,

            sem.semester_id,
            sem.semester_name,

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
        INNER JOIN academic_years ay
            ON ay.academic_year_id =
               so.academic_year_id
        INNER JOIN semesters sem
            ON sem.semester_id =
               so.semester_id
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
        message: `Only Submitted grades may be approved. Current status: ${grade.grade_status}.`,
      });
    }

    if (grade.enrollment_status !== "Approved") {
      return res.status(409).json({
        success: false,
        message: "This student's enrollment is no longer approved.",
      });
    }

    if (grade.enrollment_subject_status !== "Enrolled") {
      return res.status(409).json({
        success: false,
        message: "This subject is no longer actively enrolled.",
      });
    }

    if (grade.offering_status === "Cancelled") {
      return res.status(409).json({
        success: false,
        message: "A grade from a cancelled class cannot be approved.",
      });
    }

    if (!grade.remarks) {
      return res.status(409).json({
        success: false,
        message: "Grade remarks are missing.",
      });
    }

    if (
      ["Passed", "Failed"].includes(grade.remarks) &&
      grade.final_rating === null
    ) {
      return res.status(409).json({
        success: false,
        message:
          "A final rating is required before this grade can be approved.",
      });
    }
    const [updateResult] = await db.execute(
      `
  UPDATE grades
  SET
      grade_status = 'Approved',
      reviewed_by = ?,
      reviewed_at = CURRENT_TIMESTAMP,
      review_remarks = NULL
  WHERE grade_id = ?
    AND grade_status = 'Submitted'
  `,
      [programHead.user_id, grade.grade_id],
    );

    if (updateResult.affectedRows !== 1) {
      return res.status(409).json({
        success: false,
        message:
          "The grade is no longer available for return. Refresh and try again.",
      });
    }

    const [approvedRows] = await db.execute(
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
              g.created_at,
              g.updated_at,
              es.status
                  AS enrollment_subject_status
          FROM grades g
          INNER JOIN enrollment_subjects es
              ON es.enrollment_subject_id =
                 g.enrollment_subject_id
          WHERE g.grade_id = ?
          LIMIT 1
          `,
      [grade.grade_id],
    );

    const approved = approvedRows[0];

    return res.status(200).json({
      success: true,
      message: "Grade approved successfully.",

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
        enrollment_subject_id: grade.enrollment_subject_id,

        enrollment_id: grade.enrollment_id,
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

        academic_period: {
          academic_year_id: grade.academic_year_id,

          academic_year: grade.academic_year,

          semester_id: grade.semester_id,

          semester_name: grade.semester_name,
        },
      },

      grade: {
        grade_id: approved.grade_id,

        enrollment_subject_id: approved.enrollment_subject_id,

        faculty_id: approved.faculty_id,

        midterm_grade:
          approved.midterm_grade !== null
            ? Number(approved.midterm_grade)
            : null,

        final_grade:
          approved.final_grade !== null ? Number(approved.final_grade) : null,

        ...gradePolicyFields(approved),

        final_rating:
          approved.final_rating !== null ? Number(approved.final_rating) : null,

        remarks: approved.remarks,

        grade_status: approved.grade_status,

        submitted_at: approved.submitted_at,

        reviewed_by: approved.reviewed_by,

        reviewed_at: approved.reviewed_at,

        review_remarks: approved.review_remarks,

        enrollment_subject_status: approved.enrollment_subject_status,

        created_at: approved.created_at,
        updated_at: approved.updated_at,
      },
    });
  } catch (error) {
    console.error(
      "PATCH /api/program-head/grades/:gradeId/approve error:",
      error,
    );

    if (error?.errno === 1644 || error?.sqlState === "45000") {
      return res.status(409).json({
        success: false,

        message:
          error.sqlMessage ||
          error.message ||
          "Grade approval was rejected by the database.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to approve grade.",
    });
  }
});

export default router;
