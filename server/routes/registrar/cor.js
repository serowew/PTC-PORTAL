import express from "express";
import db from "../../db.js";

const router = express.Router();

// ============================================================
// HELPERS
// ============================================================

function toPositiveInt(value) {
  const numeric = Number(value);

  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }

  return numeric;
}

function toMoney(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : null;
}

// ============================================================
// GET STUDENT CERTIFICATE OF REGISTRATION
//
// GET
// /api/registrar/students/:studentId/cor
//
// Optional:
//
// ?enrollment_id=123
//
// If enrollment_id is not supplied, the latest Approved
// enrollment is selected automatically.
//
// IMPORTANT:
// - Registrar only.
// - Parent /api/registrar route already handles authentication.
// - COR is generated from official enrollment records.
// - COR does NOT duplicate enrollment data into another table.
// - Only Approved enrollments can generate an official COR.
// ============================================================

router.get("/:studentId/cor", async (req, res) => {
  const studentId = toPositiveInt(req.params.studentId);

  if (!studentId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_STUDENT_ID",
      message: "Invalid student ID.",
    });
  }

  // ==========================================================
  // OPTIONAL ENROLLMENT
  // ==========================================================

  let requestedEnrollmentId = null;

  if (
    req.query.enrollment_id !== undefined &&
    String(req.query.enrollment_id).trim() !== ""
  ) {
    requestedEnrollmentId = toPositiveInt(req.query.enrollment_id);

    if (!requestedEnrollmentId) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ENROLLMENT_ID",
        message: "Invalid enrollment ID.",
      });
    }
  }

  let connection;

  try {
    connection = await db.getConnection();

    // ========================================================
    // 1. STUDENT
    //
    // Includes:
    // - student identity
    // - program
    // - status
    // - current academic information
    // - permanent/current recorded address
    // ========================================================

    const [studentRows] = await connection.execute(
      `
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

          s.course_id,

          c.course_code,
          c.course_name,

          st.status_name AS student_status,

          s.section_id AS current_section_id,
          current_section.section_name
            AS current_section_name,

          s.semester_id AS current_semester_id,
          current_semester.semester_name
            AS current_semester_name,

          u.email,

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

        LEFT JOIN student_statuses st
          ON st.status_id = s.status_id

        LEFT JOIN sections current_section
          ON current_section.section_id =
             s.section_id

        LEFT JOIN semesters current_semester
          ON current_semester.semester_id =
             s.semester_id

        LEFT JOIN student_addresses addr
          ON addr.student_id =
             s.student_id

        WHERE s.student_id = ?

        LIMIT 1
      `,
      [studentId],
    );

    if (studentRows.length === 0) {
      return res.status(404).json({
        success: false,
        code: "STUDENT_NOT_FOUND",
        message: "Student was not found.",
      });
    }

    const studentRow = studentRows[0];

    // ========================================================
    // BUILD ADDRESS
    // ========================================================

    const addressParts = [
      studentRow.house_no,
      studentRow.street,
      studentRow.barangay,
      studentRow.city,
      studentRow.province,
      studentRow.zip_code,
    ]
      .map((value) =>
        value === null || value === undefined ? "" : String(value).trim(),
      )
      .filter(Boolean);

    const completeAddress =
      addressParts.length > 0 ? addressParts.join(", ") : null;

    // ========================================================
    // 2. AVAILABLE APPROVED ENROLLMENTS
    //
    // These become the selectable COR periods.
    //
    // Draft / Pending / Rejected / Cancelled enrollment
    // cannot be used as an official COR.
    // ========================================================

    const [enrollmentRows] = await connection.execute(
      `
          SELECT
            e.enrollment_id,
            e.student_id,

            e.academic_year_id,
            ay.academic_year,

            e.semester_id,
            sem.semester_name,

            e.enrollment_status,

            e.approved_by,
            approver.username
              AS approved_by_username,

            e.approved_at,
            e.created_at

          FROM enrollments e

          INNER JOIN academic_years ay
            ON ay.academic_year_id =
               e.academic_year_id

          INNER JOIN semesters sem
            ON sem.semester_id =
               e.semester_id

          LEFT JOIN users approver
            ON approver.user_id =
               e.approved_by

          WHERE e.student_id = ?
            AND e.enrollment_status = 'Approved'

          ORDER BY
            e.academic_year_id DESC,
            e.semester_id DESC,
            e.enrollment_id DESC
        `,
      [studentId],
    );

    // ========================================================
    // NO APPROVED ENROLLMENT
    // ========================================================

    if (enrollmentRows.length === 0) {
      return res.status(200).json({
        success: true,
        code: "NO_APPROVED_ENROLLMENT_FOR_COR",

        message:
          "This student does not have an approved enrollment available for a Certificate of Registration.",

        student: {
          student_id: Number(studentRow.student_id),

          student_number: studentRow.student_number,

          first_name: studentRow.first_name,

          middle_name: studentRow.middle_name || null,

          last_name: studentRow.last_name,

          student_name: [
            studentRow.first_name,
            studentRow.middle_name,
            studentRow.last_name,
          ]
            .filter(Boolean)
            .join(" "),

          email: studentRow.email || null,

          course: {
            course_id: studentRow.course_id
              ? Number(studentRow.course_id)
              : null,

            course_code: studentRow.course_code || null,

            course_name: studentRow.course_name || null,
          },

          current_year_level:
            studentRow.year_level !== null &&
            studentRow.year_level !== undefined
              ? Number(studentRow.year_level)
              : null,

          status: studentRow.student_status || null,

          address: {
            house_no: studentRow.house_no || null,

            street: studentRow.street || null,

            barangay: studentRow.barangay || null,

            city: studentRow.city || null,

            province: studentRow.province || null,

            zip_code: studentRow.zip_code || null,

            complete_address: completeAddress,
          },
        },

        available_enrollments: [],

        cor: null,
      });
    }

    // ========================================================
    // 3. CHOOSE ENROLLMENT
    // ========================================================

    let selectedEnrollmentRow = null;

    if (requestedEnrollmentId) {
      selectedEnrollmentRow = enrollmentRows.find(
        (row) => Number(row.enrollment_id) === requestedEnrollmentId,
      );

      if (!selectedEnrollmentRow) {
        return res.status(404).json({
          success: false,

          code: "APPROVED_ENROLLMENT_NOT_FOUND",

          message:
            "The selected approved enrollment does not belong to this student.",
        });
      }
    } else {
      selectedEnrollmentRow = enrollmentRows[0];
    }

    const enrollmentId = Number(selectedEnrollmentRow.enrollment_id);

    const academicYearId = Number(selectedEnrollmentRow.academic_year_id);

    const semesterId = Number(selectedEnrollmentRow.semester_id);

    // ========================================================
    // 4. ENROLLED SUBJECTS
    //
    // COR must come from actual enrollment_subjects.
    //
    // Dropped and Withdrawn subjects are excluded from the
    // printable registration list.
    // ========================================================

    const [subjectRows] = await connection.execute(
      `
          SELECT
            es.enrollment_subject_id,
            es.subject_id,
            es.status
              AS enrollment_subject_status,

            sub.subject_code,
            sub.subject_name,
            sub.units,
            sub.lecture_hours,
            sub.laboratory_hours,

            es.section_id,

            sec.section_name,
            sec.year_level
              AS section_year_level,

            es.section_subject_id,

            es.offering_id,

            so.schedule_days,
            so.schedule_time,
            so.faculty_id,
            so.room_id,

            TRIM(
              CONCAT_WS(
                ' ',
                f.first_name,
                NULLIF(
                  f.middle_name,
                  ''
                ),
                f.last_name
              )
            ) AS faculty_name,

            r.room_name

          FROM enrollment_subjects es

          INNER JOIN subjects sub
            ON sub.subject_id =
               es.subject_id

          LEFT JOIN sections sec
            ON sec.section_id =
               es.section_id

          LEFT JOIN subject_offerings so
            ON so.offering_id =
               es.offering_id

          LEFT JOIN faculty f
            ON f.faculty_id =
               so.faculty_id

          LEFT JOIN rooms r
            ON r.room_id =
               so.room_id

          WHERE es.enrollment_id = ?

            AND es.status NOT IN (
              'Dropped',
              'Withdrawn'
            )

          ORDER BY
            sub.subject_code ASC,
            es.enrollment_subject_id ASC
        `,
      [enrollmentId],
    );

    // ========================================================
    // FORMAT SUBJECTS
    // ========================================================

    const subjects = subjectRows.map((row) => ({
      enrollment_subject_id: Number(row.enrollment_subject_id),

      subject_id: Number(row.subject_id),

      subject_code: row.subject_code,

      subject_title: row.subject_name,

      units: Number(row.units || 0),

      lecture_hours:
        row.lecture_hours === null || row.lecture_hours === undefined
          ? null
          : Number(row.lecture_hours),

      laboratory_hours:
        row.laboratory_hours === null || row.laboratory_hours === undefined
          ? null
          : Number(row.laboratory_hours),

      /*
       * Physical COR sample contains a
       * "Comp" column.
       *
       * Current subjects schema has no
       * computer_hours field.
       *
       * Do NOT fabricate an academic value.
       */
      computer_hours: null,

      enrollment_subject_status: row.enrollment_subject_status,

      section: {
        section_id: row.section_id ? Number(row.section_id) : null,

        section_name: row.section_name || null,

        year_level:
          row.section_year_level !== null &&
          row.section_year_level !== undefined
            ? Number(row.section_year_level)
            : null,
      },

      schedule: {
        days: row.schedule_days || null,

        time: row.schedule_time || null,
      },

      faculty: {
        faculty_id: row.faculty_id ? Number(row.faculty_id) : null,

        faculty_name: row.faculty_name || null,
      },

      room: {
        room_id: row.room_id ? Number(row.room_id) : null,

        room_name: row.room_name || null,
      },
    }));

    // ========================================================
    // 5. DERIVE COR SECTION / YEAR LEVEL
    //
    // Historical COR should prefer the section attached to the
    // actual enrollment subjects, not the student's current
    // section.
    // ========================================================

    const sectionNames = [
      ...new Set(
        subjects.map((subject) => subject.section.section_name).filter(Boolean),
      ),
    ];

    const sectionYearLevels = [
      ...new Set(
        subjects
          .map((subject) => subject.section.year_level)
          .filter((value) => value !== null && value !== undefined),
      ),
    ];

    const corSectionName =
      sectionNames.length === 0
        ? studentRow.current_section_name || null
        : sectionNames.length === 1
          ? sectionNames[0]
          : "Multiple Sections";

    const corYearLevel =
      sectionYearLevels.length === 1
        ? Number(sectionYearLevels[0])
        : studentRow.year_level !== null && studentRow.year_level !== undefined
          ? Number(studentRow.year_level)
          : null;

    // ========================================================
    // 6. SUBJECT TOTALS
    // ========================================================

    const totalUnits = subjects.reduce(
      (total, subject) => total + Number(subject.units || 0),
      0,
    );

    const totalLectureHours = subjects.reduce(
      (total, subject) => total + Number(subject.lecture_hours || 0),
      0,
    );

    const totalLaboratoryHours = subjects.reduce(
      (total, subject) => total + Number(subject.laboratory_hours || 0),
      0,
    );

    // ========================================================
    // 7. OFFICIAL STUDENT BILLING
    //
    // This is the student's enrollment/tuition assessment.
    //
    // It is NOT the COR-request Finance ticket.
    // ========================================================

    const [billingRows] = await connection.execute(
      `
          SELECT
            billing_id,
            student_id,
            academic_year_id,
            semester_id,

            total_fees,
            scholarship_amount,
            discount_amount,
            total_due,

            billing_date,
            billing_status

          FROM student_billing

          WHERE student_id = ?
            AND academic_year_id = ?
            AND semester_id = ?

          ORDER BY billing_id DESC

          LIMIT 1
        `,
      [studentId, academicYearId, semesterId],
    );

    const billingRow = billingRows.length > 0 ? billingRows[0] : null;

    // ========================================================
    // 8. PAYMENT HISTORY
    // ========================================================

    let payments = [];

    if (billingRow) {
      const [paymentRows] = await connection.execute(
        `
            SELECT
              p.payment_id,
              p.billing_id,

              p.receipt_number,
              p.amount_paid,
              p.payment_method,
              p.payment_date,

              p.received_by,

              receiver.username
                AS received_by_username,

              p.remarks

            FROM payments p

            LEFT JOIN users receiver
              ON receiver.user_id =
                 p.received_by

            WHERE p.billing_id = ?

            ORDER BY
              p.payment_date ASC,
              p.payment_id ASC
          `,
        [Number(billingRow.billing_id)],
      );

      payments = paymentRows.map((row) => ({
        payment_id: Number(row.payment_id),

        receipt_number: row.receipt_number || null,

        amount_paid: Number(row.amount_paid || 0),

        payment_method: row.payment_method || null,

        payment_date: row.payment_date || null,

        received_by: row.received_by ? Number(row.received_by) : null,

        received_by_username: row.received_by_username || null,

        remarks: row.remarks || null,
      }));
    }

    const totalPaid = payments.reduce(
      (total, payment) => total + Number(payment.amount_paid || 0),
      0,
    );

    // ========================================================
    // 9. CONFIGURED FEE BREAKDOWN
    //
    // Current DB does not contain a billing-line-item table.
    //
    // Therefore:
    // - official total comes from student_billing
    // - fee_items show matching configured fees for this term,
    //   course, and year level
    //
    // This avoids inventing hard-coded COR fees.
    // ========================================================

    const [feeRows] = await connection.execute(
      `
          SELECT
            f.fee_id,
            f.category_id,

            fc.category_name,

            f.course_id,
            f.year_level,

            f.fee_name,
            f.amount,

            f.is_active

          FROM fees f

          INNER JOIN fee_categories fc
            ON fc.category_id =
               f.category_id

          WHERE f.academic_year_id = ?
            AND f.semester_id = ?
            AND f.is_active = 1

            AND (
              f.course_id IS NULL
              OR f.course_id = ?
            )

            AND (
              f.year_level IS NULL
              OR f.year_level = ?
            )

          ORDER BY
            f.category_id ASC,
            f.fee_id ASC
        `,
      [academicYearId, semesterId, studentRow.course_id, corYearLevel],
    );

    const configuredFees = feeRows.map((row) => ({
      fee_id: Number(row.fee_id),

      category_id: Number(row.category_id),

      category_name: row.category_name,

      fee_name: row.fee_name || row.category_name,

      amount: Number(row.amount || 0),

      course_id: row.course_id ? Number(row.course_id) : null,

      year_level:
        row.year_level !== null && row.year_level !== undefined
          ? Number(row.year_level)
          : null,
    }));

    const configuredFeeTotal = configuredFees.reduce(
      (total, fee) => total + Number(fee.amount || 0),
      0,
    );

    // ========================================================
    // BILLING SUMMARY
    // ========================================================

    const totalDue = billingRow ? toMoney(billingRow.total_due) : null;

    const balance =
      totalDue === null ? null : Math.max(totalDue - totalPaid, 0);

    const billing = billingRow
      ? {
          billing_id: Number(billingRow.billing_id),

          total_fees: toMoney(billingRow.total_fees),

          scholarship_amount: toMoney(billingRow.scholarship_amount) ?? 0,

          discount_amount: toMoney(billingRow.discount_amount) ?? 0,

          total_due: totalDue,

          total_paid: totalPaid,

          balance,

          billing_date: billingRow.billing_date || null,

          billing_status: billingRow.billing_status,

          /*
           * Existing schema does not identify
           * payments as Prelim / Midterm /
           * Finals installments.
           *
           * We must not invent installment
           * classifications.
           */
          installment_breakdown: null,
        }
      : null;

    // ========================================================
    // 10. AVAILABLE COR PERIODS
    // ========================================================

    const availableEnrollments = enrollmentRows.map((row) => ({
      enrollment_id: Number(row.enrollment_id),

      academic_year_id: Number(row.academic_year_id),

      academic_year: row.academic_year,

      semester_id: Number(row.semester_id),

      semester_name: row.semester_name,

      enrollment_status: row.enrollment_status,

      approved_at: row.approved_at || null,
    }));

    // ========================================================
    // 11. FINAL COR RESPONSE
    // ========================================================

    return res.status(200).json({
      success: true,

      code: "REGISTRAR_COR_RETRIEVED",

      message: "Certificate of Registration data retrieved successfully.",

      student: {
        student_id: Number(studentRow.student_id),

        student_number: studentRow.student_number,

        first_name: studentRow.first_name,

        middle_name: studentRow.middle_name || null,

        last_name: studentRow.last_name,

        student_name: [
          studentRow.first_name,
          studentRow.middle_name,
          studentRow.last_name,
        ]
          .filter(Boolean)
          .join(" "),

        email: studentRow.email || null,

        contact_number: studentRow.contact_number || null,

        course: {
          course_id: studentRow.course_id ? Number(studentRow.course_id) : null,

          course_code: studentRow.course_code || null,

          course_name: studentRow.course_name || null,
        },

        status: studentRow.student_status || null,

        address: {
          house_no: studentRow.house_no || null,

          street: studentRow.street || null,

          barangay: studentRow.barangay || null,

          city: studentRow.city || null,

          province: studentRow.province || null,

          zip_code: studentRow.zip_code || null,

          complete_address: completeAddress,
        },
      },

      available_enrollments: availableEnrollments,

      cor: {
        enrollment_id: enrollmentId,

        enrollment_status: selectedEnrollmentRow.enrollment_status,

        academic_period: {
          academic_year_id: academicYearId,

          academic_year: selectedEnrollmentRow.academic_year,

          semester_id: semesterId,

          semester_name: selectedEnrollmentRow.semester_name,
        },

        program: {
          course_id: studentRow.course_id ? Number(studentRow.course_id) : null,

          course_code: studentRow.course_code || null,

          course_name: studentRow.course_name || null,
        },

        year_level: corYearLevel,

        section_name: corSectionName,

        subjects,

        subject_summary: {
          total_subjects: subjects.length,

          total_units: totalUnits,

          total_lecture_hours: totalLectureHours,

          total_laboratory_hours: totalLaboratoryHours,

          /*
           * Not available in current
           * subject schema.
           */
          total_computer_hours: null,
        },

        assessment: {
          billing,

          configured_fee_items: configuredFees,

          configured_fee_total: configuredFeeTotal,

          payments,
        },

        certification: {
          approved_by: selectedEnrollmentRow.approved_by
            ? Number(selectedEnrollmentRow.approved_by)
            : null,

          approved_by_username:
            selectedEnrollmentRow.approved_by_username || null,

          approved_at: selectedEnrollmentRow.approved_at || null,
        },

        generated_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("GET REGISTRAR COR ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "REGISTRAR_COR_RETRIEVAL_FAILED",

      message: "Failed to retrieve Certificate of Registration data.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

export default router;
