// routes/registrar/gradeChangeRequests.js

import express from "express";
import db from "../../db.js";

const router = express.Router();

// =====================================================
// HELPERS
// =====================================================

function toPositiveInt(value) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

// =====================================================
// GET AUTHENTICATED REGISTRAR
// =====================================================

async function getAuthenticatedRegistrar(req, res) {
  const userId = toPositiveInt(req.user?.user_id);
  const roleName = String(req.user?.role_name || "").trim();

  if (!userId) {
    res.status(401).json({
      success: false,
      message: "Unauthorized.",
    });

    return null;
  }

  if (roleName !== "Registrar") {
    res.status(403).json({
      success: false,
      message: "Registrar access is required.",
    });

    return null;
  }

  const [rows] = await db.execute(
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
    [userId],
  );

  if (rows.length === 0) {
    res.status(403).json({
      success: false,
      message: "Active Registrar account was not found.",
    });

    return null;
  }

  return {
    user_id: Number(rows[0].user_id),
    username: rows[0].username,
    role_name: rows[0].role_name,
  };
}

// =====================================================
// GET GRADE CHANGE REQUESTS
//
// GET /api/registrar/grade-change-requests
//
// Optional:
// ?status=For Registrar Processing
// ?status=Completed
// ?status=Returned
// ?status=Rejected
// =====================================================

router.get("/", async (req, res) => {
  try {
    const registrar = await getAuthenticatedRegistrar(req, res);

    if (!registrar) {
      return;
    }

    const allowedStatuses = [
      "Pending Program Head",
      "For Registrar Processing",
      "Returned",
      "Rejected",
      "Completed",
    ];

    const requestedStatus =
      String(req.query.status || "").trim() || "For Registrar Processing";

    if (!allowedStatuses.includes(requestedStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid grade change request status.",
      });
    }

    const [rows] = await db.execute(
      `
      SELECT
          gcr.grade_change_request_id,
          gcr.grade_id,
          gcr.request_type,
          gcr.status,

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

          gcr.requested_by,
          gcr.requested_by_role,
          gcr.requested_at,

          gcr.reviewed_by,
          gcr.reviewed_at,
          gcr.review_remarks,

          gcr.processed_by,
          gcr.processed_at,
          gcr.registrar_remarks,

          g.midterm_grade AS current_midterm_grade,
          g.final_grade AS current_final_grade,
          g.overall_percentage AS current_overall_percentage,
          g.final_rating AS current_final_rating,
          g.grading_policy AS current_grading_policy,
          g.grading_outcome AS current_grading_outcome,
          g.outcome_reason AS current_outcome_reason,
          g.remarks AS current_remarks,
          g.grade_status AS current_grade_status,

          es.enrollment_subject_id,
          es.status AS enrollment_subject_status,

          e.enrollment_id,
          e.enrollment_status,

          s.student_id,
          s.student_number,
          s.first_name,
          s.middle_name,
          s.last_name,

          c.course_id,
          c.course_code,
          c.course_name,

          so.offering_id,

          sub.subject_id,
          sub.subject_code,
          sub.subject_name,

          sec.section_id,
          sec.section_name,

          ay.academic_year_id,
          ay.academic_year,

          sem.semester_id,
          sem.semester_name,

          requester.username AS requested_by_username,
          reviewer.username AS reviewed_by_username,
          processor.username AS processed_by_username

      FROM grade_change_requests gcr

      INNER JOIN grades g
          ON g.grade_id = gcr.grade_id

      INNER JOIN enrollment_subjects es
          ON es.enrollment_subject_id =
             g.enrollment_subject_id

      INNER JOIN enrollments e
          ON e.enrollment_id =
             es.enrollment_id

      INNER JOIN students s
          ON s.student_id =
             e.student_id

      LEFT JOIN courses c
          ON c.course_id =
             s.course_id

      LEFT JOIN subject_offerings so
          ON so.offering_id =
             es.offering_id

      LEFT JOIN subjects sub
          ON sub.subject_id =
             so.subject_id

      LEFT JOIN sections sec
          ON sec.section_id =
             so.section_id

      LEFT JOIN academic_years ay
          ON ay.academic_year_id =
             e.academic_year_id

      LEFT JOIN semesters sem
          ON sem.semester_id =
             e.semester_id

      LEFT JOIN users requester
          ON requester.user_id =
             gcr.requested_by

      LEFT JOIN users reviewer
          ON reviewer.user_id =
             gcr.reviewed_by

      LEFT JOIN users processor
          ON processor.user_id =
             gcr.processed_by

      WHERE gcr.status = ?

      ORDER BY
          gcr.requested_at ASC,
          gcr.grade_change_request_id ASC
      `,
      [requestedStatus],
    );

    const requests = rows.map((row) => ({
      grade_change_request_id: Number(row.grade_change_request_id),

      grade_id: Number(row.grade_id),

      request_type: row.request_type,
      status: row.status,

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

      current_official_grade: {
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

        grading_policy: row.current_grading_policy,

        grading_outcome: row.current_grading_outcome,

        outcome_reason: row.current_outcome_reason,

        remarks: row.current_remarks,

        grade_status: row.current_grade_status,
      },

      completion_remarks: row.completion_remarks,

      student: {
        student_id: Number(row.student_id),

        student_number: row.student_number,

        first_name: row.first_name,

        middle_name: row.middle_name,

        last_name: row.last_name,

        full_name: [row.first_name, row.middle_name, row.last_name]
          .filter(Boolean)
          .join(" "),
      },

      course: {
        course_id: row.course_id !== null ? Number(row.course_id) : null,

        course_code: row.course_code,

        course_name: row.course_name,
      },

      class: {
        offering_id: row.offering_id !== null ? Number(row.offering_id) : null,

        enrollment_subject_id: Number(row.enrollment_subject_id),

        enrollment_subject_status: row.enrollment_subject_status,

        subject: {
          subject_id: row.subject_id !== null ? Number(row.subject_id) : null,

          subject_code: row.subject_code,

          subject_name: row.subject_name,
        },

        section: {
          section_id: row.section_id !== null ? Number(row.section_id) : null,

          section_name: row.section_name,
        },
      },

      enrollment: {
        enrollment_id: Number(row.enrollment_id),

        enrollment_status: row.enrollment_status,
      },

      period: {
        academic_year_id:
          row.academic_year_id !== null ? Number(row.academic_year_id) : null,

        academic_year: row.academic_year,

        semester_id: row.semester_id !== null ? Number(row.semester_id) : null,

        semester_name: row.semester_name,
      },

      requested_by: {
        user_id: Number(row.requested_by),

        username: row.requested_by_username,

        role: row.requested_by_role,

        requested_at: row.requested_at,
      },

      reviewed_by:
        row.reviewed_by !== null
          ? {
              user_id: Number(row.reviewed_by),

              username: row.reviewed_by_username,

              reviewed_at: row.reviewed_at,

              review_remarks: row.review_remarks,
            }
          : null,

      processed_by:
        row.processed_by !== null
          ? {
              user_id: Number(row.processed_by),

              username: row.processed_by_username,

              processed_at: row.processed_at,

              registrar_remarks: row.registrar_remarks,
            }
          : null,
    }));

    return res.status(200).json({
      success: true,

      filters: {
        status: requestedStatus,
      },

      summary: {
        total_requests: requests.length,
      },

      requests,
    });
  } catch (error) {
    console.error("GET REGISTRAR GRADE CHANGE REQUESTS ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to load grade change requests.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});
router.patch("/:requestId/process", async (req, res) => {
  let connection = null;

  try {
    // =================================================
    // AUTHENTICATE REGISTRAR
    // =================================================

    const registrar = await getAuthenticatedRegistrar(req, res);

    if (!registrar) {
      return;
    }

    // =================================================
    // VALIDATE REQUEST ID
    // =================================================

    const requestId = toPositiveInt(req.params.requestId);

    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: "Invalid grade change request ID.",
      });
    }

    // =================================================
    // REGISTRAR REMARKS
    // =================================================

    const registrarRemarks =
      typeof req.body?.registrar_remarks === "string"
        ? req.body.registrar_remarks.trim()
        : "";

    // =================================================
    // GET CONNECTION
    // =================================================

    connection = await db.getConnection();

    // Defensive reset for pooled connection.
    await connection.execute("SET @allow_approved_inc_grade_change = NULL");

    await connection.execute("SET @allow_approved_grade_correction = NULL");

    await connection.beginTransaction();

    // =================================================
    // LOCK REQUEST + CURRENT OFFICIAL GRADE
    // =================================================

    const [requestRows] = await connection.execute(
      `
        SELECT
            gcr.grade_change_request_id,
            gcr.grade_id,
            gcr.request_type,
            gcr.status,

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

            gcr.requested_by,
            gcr.requested_by_role,
            gcr.requested_at,

            gcr.reviewed_by,
            gcr.reviewed_at,
            gcr.review_remarks,

            gcr.processed_by,
            gcr.processed_at,
            gcr.registrar_remarks,

            g.enrollment_subject_id,

            g.midterm_grade
                AS current_midterm_grade,

            g.final_grade
                AS current_final_grade,

            g.overall_percentage
                AS current_overall_percentage,

            g.final_rating
                AS current_final_rating,

            g.grading_policy
                AS current_grading_policy,

            g.grading_outcome
                AS current_grading_outcome,

            g.outcome_reason
                AS current_outcome_reason,

            g.remarks
                AS current_remarks,

            g.grade_status
                AS current_grade_status,

            es.status
                AS enrollment_subject_status,

            e.enrollment_id,
            e.enrollment_status,

            s.student_id,
            s.student_number,
            s.first_name,
            s.middle_name,
            s.last_name,

            so.offering_id,

            sub.subject_id,
            sub.subject_code,
            sub.subject_name,

            sec.section_id,
            sec.section_name

        FROM grade_change_requests gcr

        INNER JOIN grades g
            ON g.grade_id = gcr.grade_id

        INNER JOIN enrollment_subjects es
            ON es.enrollment_subject_id =
               g.enrollment_subject_id

        INNER JOIN enrollments e
            ON e.enrollment_id =
               es.enrollment_id

        INNER JOIN students s
            ON s.student_id =
               e.student_id

        LEFT JOIN subject_offerings so
            ON so.offering_id =
               es.offering_id

        LEFT JOIN subjects sub
            ON sub.subject_id =
               so.subject_id

        LEFT JOIN sections sec
            ON sec.section_id =
               so.section_id

        WHERE
            gcr.grade_change_request_id = ?

        FOR UPDATE
      `,
      [requestId],
    );

    if (requestRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Grade change request was not found.",
      });
    }

    const request = requestRows[0];

    // =================================================
    // VALIDATE REQUEST STATUS
    // =================================================

    if (request.status !== "For Registrar Processing") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: `Grade change request cannot be processed because its current status is '${request.status}'.`,
      });
    }

    // =================================================
    // REQUIRE PROGRAM HEAD APPROVAL
    // =================================================

    if (request.reviewed_by === null || request.reviewed_at === null) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Program Head approval is required before Registrar processing.",
      });
    }

    // =================================================
    // VALIDATE REQUESTER
    // =================================================

    if (request.requested_by_role !== "Faculty") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Only Faculty-submitted grade change requests can be processed.",
      });
    }

    // =================================================
    // VALIDATE ENROLLMENT
    // =================================================

    if (request.enrollment_status !== "Approved") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "The student's enrollment is no longer approved.",
      });
    }

    // =================================================
    // CURRENT OFFICIAL GRADE VALUES
    // =================================================

    const currentMidterm =
      request.current_midterm_grade !== null
        ? Number(request.current_midterm_grade)
        : null;

    const currentFinal =
      request.current_final_grade !== null
        ? Number(request.current_final_grade)
        : null;

    const currentOverall =
      request.current_overall_percentage !== null
        ? Number(request.current_overall_percentage)
        : null;

    const currentRating =
      request.current_final_rating !== null
        ? Number(request.current_final_rating)
        : null;

    const currentPolicy = String(request.current_grading_policy || "").trim();

    const currentOutcome = String(request.current_grading_outcome || "").trim();

    const currentRemarks = String(request.current_remarks || "").trim();

    // =================================================
    // PROPOSED GRADE VALUES
    // =================================================

    const newMidterm =
      request.new_midterm_grade !== null
        ? Number(request.new_midterm_grade)
        : null;

    const newFinal =
      request.new_final_grade !== null ? Number(request.new_final_grade) : null;

    const newOverall =
      request.new_overall_percentage !== null
        ? Number(request.new_overall_percentage)
        : null;

    const newRating =
      request.new_final_rating !== null
        ? Number(request.new_final_rating)
        : null;

    const newRemarks = String(request.new_remarks || "").trim();

    const newOutcome = String(request.new_grading_outcome || "").trim();

    // =================================================
    // VALIDATE PROPOSED NUMERIC VALUES
    // =================================================

    if (
      !Number.isFinite(newMidterm) ||
      newMidterm < 0 ||
      newMidterm > 100 ||
      !Number.isFinite(newFinal) ||
      newFinal < 0 ||
      newFinal > 100 ||
      !Number.isFinite(newOverall) ||
      newOverall < 0 ||
      newOverall > 100 ||
      !Number.isFinite(newRating)
    ) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "The proposed grade is invalid.",
      });
    }

    // =================================================
    // VALIDATE 50/50 CALCULATION
    // =================================================

    const calculatedOverall =
      Math.round((newMidterm * 0.5 + newFinal * 0.5) * 100) / 100;

    if (Math.abs(calculatedOverall - newOverall) > 0.01) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "The proposed overall percentage does not match the required 50% Midterm + 50% Final calculation.",
        calculated_overall: calculatedOverall,
        submitted_overall: newOverall,
      });
    }

    // =================================================
    // VALIDATE NUMERIC OUTCOME
    // =================================================

    if (newOutcome !== "NUMERIC") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "The proposed Registrar grade must have a NUMERIC grading outcome.",
      });
    }

    // =================================================
    // VALIDATE REMARKS / RATING
    // =================================================

    if (!["Passed", "Failed"].includes(newRemarks)) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "The proposed numeric grade must have either Passed or Failed remarks.",
      });
    }

    if (newRemarks === "Passed" && (newRating < 1 || newRating > 3)) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "A Passed grade must have a final rating from 1.00 to 3.00.",
      });
    }

    if (newRemarks === "Failed" && newRating !== 5) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "A Failed grade must have a final rating of 5.00.",
      });
    }

    // =================================================
    // REQUEST TYPE: INC COMPLETION
    // =================================================

    if (request.request_type === "INC_COMPLETION") {
      // -----------------------------------------------
      // OFFICIAL GRADE MUST STILL BE APPROVED INC
      // -----------------------------------------------

      if (
        request.current_grade_status !== "Approved" ||
        currentOutcome !== "INCOMPLETE" ||
        currentRemarks !== "Incomplete" ||
        currentRating !== 4
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "The official grade is no longer an approved INC record.",
        });
      }

      // -----------------------------------------------
      // SUBJECT MUST STILL BE INCOMPLETE
      // -----------------------------------------------

      if (request.enrollment_subject_status !== "Incomplete") {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: `INC completion cannot be processed because the enrollment subject status is '${request.enrollment_subject_status}'.`,
        });
      }

      // -----------------------------------------------
      // AUTHORIZE APPROVED INC UPDATE
      // -----------------------------------------------

      await connection.execute("SET @allow_approved_inc_grade_change = 1");

      // -----------------------------------------------
      // UPDATE OFFICIAL GRADE
      // -----------------------------------------------

      const [gradeUpdateResult] = await connection.execute(
        `
            UPDATE grades

            SET
                midterm_grade = ?,
                final_grade = ?,
                overall_percentage = ?,
                final_rating = ?,

                grading_policy =
                    'TWO_TERM_50_50',

                grading_outcome =
                    'NUMERIC',

                outcome_reason = NULL,

                remarks = ?,

                grade_status =
                    'Approved'

            WHERE grade_id = ?

              AND grade_status =
                  'Approved'
          `,
        [
          newMidterm,
          newFinal,
          newOverall,
          newRating,
          newRemarks,
          request.grade_id,
        ],
      );

      // -----------------------------------------------
      // REMOVE INC AUTHORIZATION
      // -----------------------------------------------

      await connection.execute("SET @allow_approved_inc_grade_change = NULL");

      if (gradeUpdateResult.affectedRows !== 1) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Official INC grade could not be updated. Refresh and try again.",
        });
      }

      // -----------------------------------------------
      // UPDATE SUBJECT STATUS
      // -----------------------------------------------

      const newEnrollmentSubjectStatus =
        newRemarks === "Passed" ? "Completed" : "Failed";

      const [subjectUpdateResult] = await connection.execute(
        `
            UPDATE enrollment_subjects

            SET status = ?

            WHERE enrollment_subject_id = ?

              AND status = 'Incomplete'
          `,
        [newEnrollmentSubjectStatus, request.enrollment_subject_id],
      );

      if (subjectUpdateResult.affectedRows !== 1) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "Enrollment subject status could not be updated.",
        });
      }

      // -----------------------------------------------
      // COMPLETE REQUEST
      // -----------------------------------------------

      const [requestUpdateResult] = await connection.execute(
        `
            UPDATE grade_change_requests

            SET
                status = 'Completed',
                processed_by = ?,
                processed_at = NOW(),
                registrar_remarks = ?

            WHERE grade_change_request_id = ?

              AND status =
                  'For Registrar Processing'
          `,
        [registrar.user_id, registrarRemarks || null, requestId],
      );

      if (requestUpdateResult.affectedRows !== 1) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "Grade change request could not be completed.",
        });
      }

      // -----------------------------------------------
      // AUDIT
      // -----------------------------------------------

      const auditDescription = JSON.stringify({
        grade_change_request_id: requestId,
        request_type: "INC_COMPLETION",

        student: {
          student_id: Number(request.student_id),
          student_number: request.student_number,
          full_name: [
            request.first_name,
            request.middle_name,
            request.last_name,
          ]
            .filter(Boolean)
            .join(" "),
        },

        subject: {
          subject_id:
            request.subject_id !== null ? Number(request.subject_id) : null,

          subject_code: request.subject_code,
          subject_name: request.subject_name,
        },

        old_grade: {
          midterm_grade: currentMidterm,
          final_grade: currentFinal,
          overall_percentage: currentOverall,
          final_rating: currentRating,
          grading_policy: currentPolicy,
          grading_outcome: currentOutcome,
          outcome_reason: request.current_outcome_reason,
          remarks: currentRemarks,
          grade_status: request.current_grade_status,
        },

        new_grade: {
          midterm_grade: newMidterm,
          final_grade: newFinal,
          overall_percentage: newOverall,
          final_rating: newRating,
          grading_policy: "TWO_TERM_50_50",
          grading_outcome: "NUMERIC",
          outcome_reason: null,
          remarks: newRemarks,
          grade_status: "Approved",
        },

        registrar: {
          user_id: registrar.user_id,
          username: registrar.username,
          remarks: registrarRemarks || null,
        },
      });

      await connection.execute(
        `
          INSERT INTO audit_logs
          (
              user_id,
              action,
              table_name,
              record_id,
              description,
              created_at
          )

          VALUES
          (
              ?,
              ?,
              ?,
              ?,
              ?,
              NOW()
          )
        `,
        [
          registrar.user_id,
          "INC COMPLETION PROCESSED",
          "grades",
          request.grade_id,
          auditDescription,
        ],
      );

      // -----------------------------------------------
      // STRUCTURED AUDIT TRAIL
      // -----------------------------------------------

      const oldValues = JSON.stringify({
        midterm_grade: currentMidterm,
        final_grade: currentFinal,
        overall_percentage: currentOverall,
        final_rating: currentRating,
        grading_policy: currentPolicy,
        grading_outcome: currentOutcome,
        outcome_reason: request.current_outcome_reason,
        remarks: currentRemarks,
        grade_status: request.current_grade_status,
      });

      const newValues = JSON.stringify({
        midterm_grade: newMidterm,
        final_grade: newFinal,
        overall_percentage: newOverall,
        final_rating: newRating,
        grading_policy: "TWO_TERM_50_50",
        grading_outcome: "NUMERIC",
        outcome_reason: null,
        remarks: newRemarks,
        grade_status: "Approved",
        grade_change_request_id: requestId,
      });

      await connection.execute(
        `
          INSERT INTO audit_trail
          (
              user_id,
              table_name,
              record_id,
              action,
              old_values,
              new_values,
              created_at
          )

          VALUES
          (
              ?,
              'grades',
              ?,
              'UPDATE',
              ?,
              ?,
              NOW()
          )
        `,
        [registrar.user_id, request.grade_id, oldValues, newValues],
      );

      await connection.commit();

      return res.status(200).json({
        success: true,
        message:
          "INC completion grade change was successfully posted to the official academic record.",

        request: {
          grade_change_request_id: requestId,
          grade_id: Number(request.grade_id),
          request_type: "INC_COMPLETION",
          status: "Completed",
          processed_by: registrar.user_id,
          processed_by_username: registrar.username,
          registrar_remarks: registrarRemarks || null,
        },

        student: {
          student_id: Number(request.student_id),
          student_number: request.student_number,
          full_name: [
            request.first_name,
            request.middle_name,
            request.last_name,
          ]
            .filter(Boolean)
            .join(" "),
        },

        class: {
          offering_id:
            request.offering_id !== null ? Number(request.offering_id) : null,

          subject: {
            subject_id:
              request.subject_id !== null ? Number(request.subject_id) : null,

            subject_code: request.subject_code,
            subject_name: request.subject_name,
          },

          section: {
            section_id:
              request.section_id !== null ? Number(request.section_id) : null,

            section_name: request.section_name,
          },
        },

        official_grade: {
          midterm_grade: newMidterm,
          final_grade: newFinal,
          overall_percentage: newOverall,
          final_rating: newRating,
          grading_policy: "TWO_TERM_50_50",
          grading_outcome: "NUMERIC",
          outcome_reason: null,
          remarks: newRemarks,
          grade_status: "Approved",
        },

        enrollment_subject: {
          enrollment_subject_id: Number(request.enrollment_subject_id),

          status: newRemarks === "Passed" ? "Completed" : "Failed",
        },
      });
    }

    // =================================================
    // REQUEST TYPE: GRADE CORRECTION
    // =================================================

    if (request.request_type === "GRADE_CORRECTION") {
      // -----------------------------------------------
      // OFFICIAL GRADE MUST STILL BE APPROVED NUMERIC
      // -----------------------------------------------

      if (
        request.current_grade_status !== "Approved" ||
        currentOutcome !== "NUMERIC" ||
        currentPolicy !== "TWO_TERM_50_50"
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "The official grade is no longer an approved numeric grade that can be corrected.",
        });
      }

      // -----------------------------------------------
      // VERIFY ORIGINAL SNAPSHOT
      //
      // IMPORTANT:
      // grade_change_requests does NOT contain
      // old_grading_policy/new_grading_policy.
      // -----------------------------------------------

      const snapshotMatches =
        Number(request.old_midterm_grade) === currentMidterm &&
        Number(request.old_final_grade) === currentFinal &&
        Number(request.old_overall_percentage) === currentOverall &&
        Number(request.old_final_rating) === currentRating &&
        String(request.old_grading_outcome || "").trim() === currentOutcome &&
        String(request.old_remarks || "").trim() === currentRemarks &&
        request.old_outcome_reason === request.current_outcome_reason;

      if (!snapshotMatches) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "The official grade has changed since this correction request was submitted. The request must be reviewed again.",
        });
      }

      // -----------------------------------------------
      // VALIDATE ORIGINAL VALUES
      // -----------------------------------------------

      if (
        currentMidterm === null ||
        currentFinal === null ||
        currentOverall === null ||
        currentRating === null
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "The current official grade is incomplete and cannot be processed as a numeric correction.",
        });
      }

      // -----------------------------------------------
      // AUTHORIZE CONTROLLED NUMERIC CORRECTION
      // -----------------------------------------------

      await connection.execute("SET @allow_approved_grade_correction = 1");

      // -----------------------------------------------
      // UPDATE OFFICIAL GRADE
      // -----------------------------------------------

      const [gradeUpdateResult] = await connection.execute(
        `
            UPDATE grades

            SET
                midterm_grade = ?,
                final_grade = ?,
                overall_percentage = ?,
                final_rating = ?,

                grading_policy =
                    'TWO_TERM_50_50',

                grading_outcome =
                    'NUMERIC',

                outcome_reason = NULL,

                remarks = ?,

                grade_status =
                    'Approved'

            WHERE grade_id = ?

              AND grade_status =
                  'Approved'
          `,
        [
          newMidterm,
          newFinal,
          newOverall,
          newRating,
          newRemarks,
          request.grade_id,
        ],
      );

      // -----------------------------------------------
      // REMOVE AUTHORIZATION IMMEDIATELY
      // -----------------------------------------------

      await connection.execute("SET @allow_approved_grade_correction = NULL");

      if (gradeUpdateResult.affectedRows !== 1) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Official numeric grade could not be updated. Refresh and try again.",
        });
      }

      // -----------------------------------------------
      // DO NOT CHANGE enrollment_subjects.status
      //
      // A normal numeric grade correction does not change
      // the student's enrollment subject status.
      // -----------------------------------------------

      // -----------------------------------------------
      // COMPLETE REQUEST
      // -----------------------------------------------

      const [requestUpdateResult] = await connection.execute(
        `
            UPDATE grade_change_requests

            SET
                status = 'Completed',
                processed_by = ?,
                processed_at = NOW(),
                registrar_remarks = ?

            WHERE grade_change_request_id = ?

              AND status =
                  'For Registrar Processing'
          `,
        [registrar.user_id, registrarRemarks || null, requestId],
      );

      if (requestUpdateResult.affectedRows !== 1) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "Grade correction request could not be completed.",
        });
      }

      // -----------------------------------------------
      // AUDIT LOG
      // -----------------------------------------------

      const auditDescription = JSON.stringify({
        grade_change_request_id: requestId,
        request_type: "GRADE_CORRECTION",

        student: {
          student_id: Number(request.student_id),
          student_number: request.student_number,
          full_name: [
            request.first_name,
            request.middle_name,
            request.last_name,
          ]
            .filter(Boolean)
            .join(" "),
        },

        subject: {
          subject_id:
            request.subject_id !== null ? Number(request.subject_id) : null,

          subject_code: request.subject_code,
          subject_name: request.subject_name,
        },

        old_grade: {
          midterm_grade: currentMidterm,
          final_grade: currentFinal,
          overall_percentage: currentOverall,
          final_rating: currentRating,
          grading_policy: currentPolicy,
          grading_outcome: currentOutcome,
          outcome_reason: request.current_outcome_reason,
          remarks: currentRemarks,
          grade_status: request.current_grade_status,
        },

        corrected_grade: {
          midterm_grade: newMidterm,
          final_grade: newFinal,
          overall_percentage: newOverall,
          final_rating: newRating,
          grading_policy: "TWO_TERM_50_50",
          grading_outcome: "NUMERIC",
          outcome_reason: null,
          remarks: newRemarks,
          grade_status: "Approved",
        },

        registrar: {
          user_id: registrar.user_id,
          username: registrar.username,
          remarks: registrarRemarks || null,
        },
      });

      await connection.execute(
        `
          INSERT INTO audit_logs
          (
              user_id,
              action,
              table_name,
              record_id,
              description,
              created_at
          )

          VALUES
          (
              ?,
              ?,
              ?,
              ?,
              ?,
              NOW()
          )
        `,
        [
          registrar.user_id,
          "GRADE CORRECTION PROCESSED",
          "grades",
          request.grade_id,
          auditDescription,
        ],
      );

      // -----------------------------------------------
      // STRUCTURED AUDIT TRAIL
      // -----------------------------------------------

      const oldValues = JSON.stringify({
        midterm_grade: currentMidterm,
        final_grade: currentFinal,
        overall_percentage: currentOverall,
        final_rating: currentRating,
        grading_policy: currentPolicy,
        grading_outcome: currentOutcome,
        outcome_reason: request.current_outcome_reason,
        remarks: currentRemarks,
        grade_status: request.current_grade_status,

        grade_change_request_id: requestId,
      });

      const newValues = JSON.stringify({
        midterm_grade: newMidterm,
        final_grade: newFinal,
        overall_percentage: newOverall,
        final_rating: newRating,
        grading_policy: "TWO_TERM_50_50",
        grading_outcome: "NUMERIC",
        outcome_reason: null,
        remarks: newRemarks,
        grade_status: "Approved",

        grade_change_request_id: requestId,
      });

      await connection.execute(
        `
          INSERT INTO audit_trail
          (
              user_id,
              table_name,
              record_id,
              action,
              old_values,
              new_values,
              created_at
          )

          VALUES
          (
              ?,
              'grades',
              ?,
              'UPDATE',
              ?,
              ?,
              NOW()
          )
        `,
        [registrar.user_id, request.grade_id, oldValues, newValues],
      );

      // -----------------------------------------------
      // COMMIT EVERYTHING
      // -----------------------------------------------

      await connection.commit();

      // -----------------------------------------------
      // SUCCESS RESPONSE
      // -----------------------------------------------

      return res.status(200).json({
        success: true,

        message:
          "Grade correction was successfully posted to the official academic record.",

        request: {
          grade_change_request_id: requestId,
          grade_id: Number(request.grade_id),
          request_type: "GRADE_CORRECTION",
          status: "Completed",
          processed_by: registrar.user_id,
          processed_by_username: registrar.username,
          registrar_remarks: registrarRemarks || null,
        },

        student: {
          student_id: Number(request.student_id),
          student_number: request.student_number,
          full_name: [
            request.first_name,
            request.middle_name,
            request.last_name,
          ]
            .filter(Boolean)
            .join(" "),
        },

        class: {
          offering_id:
            request.offering_id !== null ? Number(request.offering_id) : null,

          subject: {
            subject_id:
              request.subject_id !== null ? Number(request.subject_id) : null,

            subject_code: request.subject_code,
            subject_name: request.subject_name,
          },

          section: {
            section_id:
              request.section_id !== null ? Number(request.section_id) : null,

            section_name: request.section_name,
          },
        },

        original_grade: {
          midterm_grade: currentMidterm,
          final_grade: currentFinal,
          overall_percentage: currentOverall,
          final_rating: currentRating,
          grading_policy: currentPolicy,
          grading_outcome: currentOutcome,
          outcome_reason: request.current_outcome_reason,
          remarks: currentRemarks,
          grade_status: request.current_grade_status,
        },

        official_grade: {
          midterm_grade: newMidterm,
          final_grade: newFinal,
          overall_percentage: newOverall,
          final_rating: newRating,
          grading_policy: "TWO_TERM_50_50",
          grading_outcome: "NUMERIC",
          outcome_reason: null,
          remarks: newRemarks,
          grade_status: "Approved",
        },

        enrollment_subject: {
          enrollment_subject_id: Number(request.enrollment_subject_id),

          status: request.enrollment_subject_status,
        },
      });
    }

    // =================================================
    // INVALID REQUEST TYPE
    // =================================================

    await connection.rollback();

    return res.status(409).json({
      success: false,
      message: `Unsupported grade change request type '${request.request_type}'.`,
    });
  } catch (error) {
    // =================================================
    // ERROR SAFETY RESET
    // =================================================

    if (connection) {
      try {
        await connection.execute("SET @allow_approved_inc_grade_change = NULL");
      } catch (flagResetError) {
        console.error(
          "FAILED TO RESET INC GRADE AUTHORIZATION FLAG:",
          flagResetError,
        );
      }

      try {
        await connection.execute("SET @allow_approved_grade_correction = NULL");
      } catch (flagResetError) {
        console.error(
          "FAILED TO RESET GRADE CORRECTION AUTHORIZATION FLAG:",
          flagResetError,
        );
      }

      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("REGISTRAR GRADE CHANGE ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("REGISTRAR GRADE CHANGE PROCESS ERROR:", error);

    // =================================================
    // DATABASE TRIGGER / SIGNAL ERRORS
    // =================================================

    if (error?.errno === 1644 || error?.sqlState === "45000") {
      return res.status(409).json({
        success: false,
        message:
          error.sqlMessage ||
          error.message ||
          "Grade change was rejected by the database.",
      });
    }

    // =================================================
    // NORMAL SERVER ERROR
    // =================================================

    return res.status(500).json({
      success: false,
      message: "Failed to process grade change request.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    // =================================================
    // FINAL SAFETY RESET
    // =================================================

    if (connection) {
      try {
        await connection.execute("SET @allow_approved_inc_grade_change = NULL");
      } catch (flagResetError) {
        console.error("FINAL INC FLAG RESET ERROR:", flagResetError);
      }

      try {
        await connection.execute("SET @allow_approved_grade_correction = NULL");
      } catch (flagResetError) {
        console.error(
          "FINAL GRADE CORRECTION FLAG RESET ERROR:",
          flagResetError,
        );
      }

      connection.release();
    }
  }
});
export default router;
