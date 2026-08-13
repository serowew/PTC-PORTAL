// routes/student/enrollments.js

import express from "express";
import db from "../../db.js";

const router = express.Router();

// =====================================================
// STUDENT ENROLLMENT ROUTES
// =====================================================
//
// Mounted in server.js as:
//
// /api/student/enrollments
//
// Example:
//
// POST
// /api/student/enrollments/1/submit
//
// =====================================================

// =====================================================
// GET ENROLLMENT
//
// GET /api/student/enrollments/:id
//
// Purpose:
// - Get student's enrollment
// - Get enrollment subjects
// - Used by Student Enrollment page
// =====================================================

router.get("/:id", async (req, res) => {
  let connection;

  try {
    const enrollmentId = Number(req.params.id);

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    connection = await db.getConnection();

    // =================================================
    // GET ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
      SELECT
          e.enrollment_id,
          e.student_id,
          e.academic_year_id,
          e.semester_id,
          e.enrollment_status,
          e.remarks,
          e.created_at,

          s.student_number,
          s.first_name,
          s.middle_name,
          s.last_name,

          c.course_id,
          c.course_code,
          c.course_name

      FROM enrollments e

      INNER JOIN students s
          ON s.student_id = e.student_id

      LEFT JOIN courses c
          ON c.course_id = s.course_id

      WHERE e.enrollment_id = ?

      LIMIT 1
      `,
      [enrollmentId],
    );

    if (enrollmentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // GET ENROLLMENT SUBJECTS
    // =================================================

    const [subjectRows] = await connection.execute(
      `
      SELECT

          es.enrollment_subject_id,

          es.subject_id,

          es.offering_id,

          es.section_id,

          es.section_subject_id,

          es.status,

          sub.subject_code,
          sub.subject_name,
          sub.units,

          sec.section_name,

          so.schedule_days,
          so.schedule_time,

          so.faculty_id,
          so.room_id

      FROM enrollment_subjects es

      INNER JOIN subjects sub
          ON sub.subject_id = es.subject_id

      LEFT JOIN sections sec
          ON sec.section_id = es.section_id

      LEFT JOIN subject_offerings so
          ON so.offering_id = es.offering_id

      WHERE es.enrollment_id = ?

      ORDER BY
          sub.subject_code ASC
      `,
      [enrollmentId],
    );

    // =================================================
    // CALCULATE UNITS
    // =================================================

    const totalUnits = subjectRows.reduce((total, subject) => {
      if (subject.status === "Enrolled") {
        return total + Number(subject.units || 0);
      }

      return total;
    }, 0);

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      enrollment: {
        enrollment_id: enrollment.enrollment_id,

        student_id: enrollment.student_id,

        student_number: enrollment.student_number,

        student_name: [
          enrollment.first_name,
          enrollment.middle_name,
          enrollment.last_name,
        ]
          .filter(Boolean)
          .join(" "),

        course_id: enrollment.course_id,

        course_code: enrollment.course_code,

        course_name: enrollment.course_name,

        academic_year_id: enrollment.academic_year_id,

        semester_id: enrollment.semester_id,

        enrollment_status: enrollment.enrollment_status,

        remarks: enrollment.remarks,

        created_at: enrollment.created_at,
      },

      totalSubjects: subjectRows.length,

      totalUnits,

      subjects: subjectRows,
    });
  } catch (error) {
    console.error("GET STUDENT ENROLLMENT ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load enrollment.",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// SUBMIT ENROLLMENT
//
// POST /api/student/enrollments/:id/submit
//
// Body:
//
// {
//   "retakes": [
//     {
//       "subject_id": 2,
//       "offering_id": 2
//     }
//   ]
// }
//
// =====================================================

router.post("/:id/submit", async (req, res) => {
  let connection;

  try {
    const enrollmentId = Number(req.params.id);

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    const retakes = Array.isArray(req.body.retakes) ? req.body.retakes : [];

    connection = await db.getConnection();

    await connection.beginTransaction();

    // =================================================
    // GET ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
      SELECT

          e.enrollment_id,
          e.student_id,
          e.academic_year_id,
          e.semester_id,
          e.enrollment_status,

          s.course_id,

          c.course_code,
          c.course_name

      FROM enrollments e

      INNER JOIN students s
          ON s.student_id = e.student_id

      LEFT JOIN courses c
          ON c.course_id = s.course_id

      WHERE e.enrollment_id = ?

      LIMIT 1

      FOR UPDATE
      `,
      [enrollmentId],
    );

    if (enrollmentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // ONLY PENDING
    // =================================================

    if (enrollment.enrollment_status !== "Pending") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: `Enrollment cannot be submitted because its current status is '${enrollment.enrollment_status}'.`,
      });
    }

    // =================================================
    // GET CURRENT SUBJECTS
    // =================================================

    const [subjectRows] = await connection.execute(
      `
      SELECT

          es.enrollment_subject_id,
          es.subject_id,
          es.offering_id,
          es.section_id,
          es.section_subject_id,
          es.status,

          s.subject_code,
          s.subject_name,
          s.units

      FROM enrollment_subjects es

      INNER JOIN subjects s
          ON s.subject_id = es.subject_id

      WHERE es.enrollment_id = ?

        AND es.status = 'Enrolled'

      ORDER BY es.enrollment_subject_id ASC

      FOR UPDATE
      `,
      [enrollmentId],
    );

    // =================================================
    // MUST HAVE SUBJECT
    // =================================================

    if (subjectRows.length === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message:
          "Enrollment cannot be submitted because no subjects have been selected.",
      });
    }

    // =================================================
    // 1. PREREQUISITE VALIDATION
    // =================================================

    const prerequisiteErrors = [];

    for (const enrolledSubject of subjectRows) {
      const [prerequisites] = await connection.execute(
        `
        SELECT

            sp.prerequisite_id,

            sp.subject_id,

            sp.prerequisite_subject_id,

            ps.subject_code AS prerequisite_code,

            ps.subject_name AS prerequisite_name

        FROM subject_prerequisites sp

        INNER JOIN subjects ps
            ON ps.subject_id =
               sp.prerequisite_subject_id

        WHERE sp.subject_id = ?
        `,
        [enrolledSubject.subject_id],
      );

      for (const prerequisite of prerequisites) {
        // ---------------------------------------------
        // CHECK PASSED GRADE
        // ---------------------------------------------

        const [gradeRows] = await connection.execute(
          `
          SELECT
              grade_id,
              remarks

          FROM grades

          WHERE student_id = ?

            AND subject_id = ?

            AND remarks = 'Passed'

          ORDER BY grade_id DESC

          LIMIT 1
          `,
          [enrollment.student_id, prerequisite.prerequisite_subject_id],
        );

        const prerequisitePassed = gradeRows.length > 0;

        // ---------------------------------------------
        // CHECK CURRENT ENROLLMENT
        // ---------------------------------------------

        const currentlyEnrolled = subjectRows.some(
          (currentSubject) =>
            Number(currentSubject.subject_id) ===
            Number(prerequisite.prerequisite_subject_id),
        );

        if (!prerequisitePassed && !currentlyEnrolled) {
          prerequisiteErrors.push({
            subject_id: enrolledSubject.subject_id,

            subject_code: enrolledSubject.subject_code,

            subject_name: enrolledSubject.subject_name,

            prerequisite_subject_id: prerequisite.prerequisite_subject_id,

            prerequisite_code: prerequisite.prerequisite_code,

            prerequisite_name: prerequisite.prerequisite_name,

            message:
              `${enrolledSubject.subject_code} requires ` +
              `${prerequisite.prerequisite_code} ` +
              `(${prerequisite.prerequisite_name}) first.`,
          });
        }
      }
    }

    // =================================================
    // STOP IF PREREQUISITE FAILED
    // =================================================

    if (prerequisiteErrors.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message: "Prerequisite requirements are not satisfied.",

        validation_stage: "PREREQUISITES",

        errors: prerequisiteErrors,
      });
    }

    // =================================================
    // 2. FAILED / INCOMPLETE SUBJECTS
    // =================================================

    const [problemRows] = await connection.execute(
      `
      SELECT

          g.grade_id,
          g.subject_id,
          g.remarks,

          s.subject_code,
          s.subject_name

      FROM grades g

      INNER JOIN subjects s
          ON s.subject_id = g.subject_id

      WHERE g.student_id = ?

        AND g.remarks IN (
            'Failed',
            'Incomplete'
        )

      ORDER BY
          g.grade_id DESC
      `,
      [enrollment.student_id],
    );

    // =================================================
    // KEEP LATEST GRADE PER SUBJECT
    // =================================================

    const latestProblemGrades = new Map();

    for (const grade of problemRows) {
      if (!latestProblemGrades.has(Number(grade.subject_id))) {
        latestProblemGrades.set(Number(grade.subject_id), grade);
      }
    }

    // =================================================
    // VALIDATE RETAKES
    // =================================================

    const retakeErrors = [];

    for (const grade of latestProblemGrades.values()) {
      const selectedRetake = retakes.find(
        (retake) => Number(retake.subject_id) === Number(grade.subject_id),
      );

      const alreadySelected = subjectRows.some(
        (subject) => Number(subject.subject_id) === Number(grade.subject_id),
      );

      if (!selectedRetake && !alreadySelected) {
        retakeErrors.push({
          subject_id: grade.subject_id,

          subject_code: grade.subject_code,

          subject_name: grade.subject_name,

          previous_result: grade.remarks,

          message:
            `${grade.subject_code} has a ` +
            `${grade.remarks.toLowerCase()} result ` +
            `and requires a retake selection.`,
        });
      }
    }

    // =================================================
    // STOP IF RETAKE MISSING
    // =================================================

    if (retakeErrors.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message: "Failed or incomplete subjects must have a retake selection.",

        validation_stage: "RETAKES",

        errors: retakeErrors,
      });
    }

    // =================================================
    // 3. VALIDATE RETAKE OFFERINGS
    // =================================================

    const validatedRetakes = [];

    for (const retake of retakes) {
      const subjectId = Number(retake.subject_id);

      const offeringId = Number(retake.offering_id);

      if (
        !Number.isInteger(subjectId) ||
        subjectId <= 0 ||
        !Number.isInteger(offeringId) ||
        offeringId <= 0
      ) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Invalid retake subject or offering.",
        });
      }

      // ---------------------------------------------
      // OFFERING
      // ---------------------------------------------

      const [offeringRows] = await connection.execute(
        `
          SELECT

              so.offering_id,
              so.section_subject_id,
              so.subject_id,
              so.section_id,

              so.academic_year_id,
              so.semester_id,

              so.faculty_id,
              so.room_id,

              so.schedule_days,
              so.schedule_time,

              so.max_students,

              ss.status AS section_subject_status,

              s.subject_code,
              s.subject_name,
              s.units,

              sec.section_name

          FROM subject_offerings so

          INNER JOIN section_subjects ss
              ON ss.section_subject_id =
                 so.section_subject_id

          INNER JOIN subjects s
              ON s.subject_id =
                 so.subject_id

          INNER JOIN sections sec
              ON sec.section_id =
                 so.section_id

          WHERE so.offering_id = ?

          LIMIT 1

          FOR UPDATE
          `,
        [offeringId],
      );

      if (offeringRows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,

          message: `Offering ${offeringId} was not found.`,
        });
      }

      const offering = offeringRows[0];

      // ---------------------------------------------
      // OFFERING MUST MATCH SUBJECT
      // ---------------------------------------------

      if (Number(offering.subject_id) !== Number(subjectId)) {
        await connection.rollback();

        return res.status(409).json({
          success: false,

          message:
            "Selected offering does not belong to the selected retake subject.",
        });
      }

      // ---------------------------------------------
      // ACADEMIC YEAR
      // ---------------------------------------------

      if (
        Number(offering.academic_year_id) !==
        Number(enrollment.academic_year_id)
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,

          message: "Retake offering does not belong to this academic year.",
        });
      }

      // ---------------------------------------------
      // SEMESTER
      // ---------------------------------------------

      if (Number(offering.semester_id) !== Number(enrollment.semester_id)) {
        await connection.rollback();

        return res.status(409).json({
          success: false,

          message: "Retake offering does not belong to this semester.",
        });
      }

      // ---------------------------------------------
      // STATUS
      // ---------------------------------------------

      if (offering.section_subject_status !== "Open") {
        await connection.rollback();

        return res.status(409).json({
          success: false,

          message: `Retake offering is ${String(
            offering.section_subject_status,
          ).toLowerCase()}.`,
        });
      }

      // ---------------------------------------------
      // CAPACITY
      // ---------------------------------------------

      const [capacityRows] = await connection.execute(
        `
          SELECT
              COUNT(*) AS enrolled_count

          FROM enrollment_subjects es

          INNER JOIN enrollments e
              ON e.enrollment_id =
                 es.enrollment_id

          WHERE es.offering_id = ?

            AND es.status = 'Enrolled'

            AND e.enrollment_status IN (
                'Pending',
                'Approved'
            )
          `,
        [offeringId],
      );

      const enrolledCount = Number(capacityRows[0]?.enrolled_count || 0);

      const maxStudents = Number(offering.max_students || 0);

      if (maxStudents > 0 && enrolledCount >= maxStudents) {
        await connection.rollback();

        return res.status(409).json({
          success: false,

          message: "Selected retake section is full.",

          capacity: {
            max_students: maxStudents,

            enrolled_count: enrolledCount,

            available_slots: 0,
          },
        });
      }

      validatedRetakes.push({
        subject_id: subjectId,

        offering_id: offering.offering_id,

        section_id: offering.section_id,

        section_subject_id: offering.section_subject_id,

        subject_code: offering.subject_code,

        subject_name: offering.subject_name,

        section_name: offering.section_name,
      });
    }

    // =================================================
    // 4. ADD RETAKES
    // =================================================

    for (const retake of validatedRetakes) {
      await connection.execute(
        `
        INSERT INTO enrollment_subjects (

            enrollment_id,
            subject_id,
            offering_id,
            status,
            section_id,
            section_subject_id

        )
        VALUES (
            ?,
            ?,
            ?,
            'Enrolled',
            ?,
            ?
        )
        `,
        [
          enrollmentId,

          retake.subject_id,

          retake.offering_id,

          retake.section_id,

          retake.section_subject_id,
        ],
      );
    }

    // =================================================
    // 5. FINAL CHECK
    // =================================================

    const [finalRows] = await connection.execute(
      `
        SELECT
            COUNT(*) AS total_subjects

        FROM enrollment_subjects

        WHERE enrollment_id = ?

          AND status = 'Enrolled'
        `,
      [enrollmentId],
    );

    const totalSubjects = Number(finalRows[0]?.total_subjects || 0);

    if (totalSubjects === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Enrollment must contain at least one subject.",
      });
    }

    // =================================================
    // KEEP STATUS PENDING
    //
    // Registrar will approve later.
    // =================================================

    await connection.execute(
      `
      UPDATE enrollments

      SET
          remarks = 'Submitted by student'

      WHERE enrollment_id = ?

        AND enrollment_status = 'Pending'
      `,
      [enrollmentId],
    );

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // SUCCESS
    // =================================================

    return res.status(200).json({
      success: true,

      message:
        "Enrollment submitted successfully and is awaiting Registrar approval.",

      enrollment: {
        enrollment_id: enrollment.enrollment_id,

        student_id: enrollment.student_id,

        course_id: enrollment.course_id,

        course_code: enrollment.course_code,

        course_name: enrollment.course_name,

        academic_year_id: enrollment.academic_year_id,

        semester_id: enrollment.semester_id,

        enrollment_status: "Pending",
      },

      total_subjects: totalSubjects,

      retakes_added: validatedRetakes,
    });
  } catch (error) {
    // =================================================
    // ROLLBACK
    // =================================================

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("SUBMIT ENROLLMENT ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("SUBMIT ENROLLMENT ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to submit enrollment.",

      error: error.message,
    });
  } finally {
    // =================================================
    // RELEASE
    // =================================================

    if (connection) {
      connection.release();
    }
  }
});

export default router;
