// server/routes/student/documentRequests.js

import crypto from "node:crypto";
import express from "express";
import db from "../../db.js";

const router = express.Router();

const ALLOWED_DOCUMENT_TYPES = new Set(["COR", "COG"]);

// ============================================================
// HELPERS
// ============================================================

function cleanOptionalText(value, maxLength) {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = String(value).trim();

  if (!cleaned) {
    return null;
  }

  return cleaned.slice(0, maxLength);
}

function toPositiveInt(value) {
  const numeric = Number(value);

  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }

  return numeric;
}

function temporaryRequestNumber(documentType) {
  return `TMP-${documentType}-${Date.now()}-${crypto
    .randomBytes(6)
    .toString("hex")}`;
}

function publicNumber(prefix, documentType, year, id) {
  return `${prefix}-${documentType}-${year}-${String(id).padStart(6, "0")}`;
}

// ============================================================
// GET MY DOCUMENT REQUESTS
//
// GET /api/student/document-requests
//
// Returns:
// - Student's existing document requests
// - Student's APPROVED enrollment periods available for
//   COR / COG requests
//
// Parent route:
// /api/student
//   -> authenticate
//   -> requireRole("Student")
// ============================================================

router.get("/", async (req, res) => {
  try {
    // ========================================================
    // SECURITY
    // ========================================================

    if (!req.user || req.user.role_name !== "Student") {
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

    // ========================================================
    // RESOLVE STUDENT
    // ========================================================

    const [studentRows] = await db.execute(
      `
          SELECT
            s.student_id,
            s.student_number,
            s.first_name,
            s.middle_name,
            s.last_name

          FROM students s

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

    // ========================================================
    // AVAILABLE APPROVED ENROLLMENTS
    //
    // Only official Approved enrollments can be requested
    // as COR / COG academic periods.
    // ========================================================

    const [availableEnrollmentRows] = await db.execute(
      `
          SELECT
            e.enrollment_id,

            e.academic_year_id,
            ay.academic_year,

            e.semester_id,
            sem.semester_name,

            e.enrollment_status,

            e.approved_at

          FROM enrollments e

          INNER JOIN academic_years ay
            ON ay.academic_year_id =
               e.academic_year_id

          INNER JOIN semesters sem
            ON sem.semester_id =
               e.semester_id

          WHERE e.student_id = ?
            AND e.enrollment_status = 'Approved'

          ORDER BY
            e.academic_year_id DESC,
            e.semester_id DESC,
            e.enrollment_id DESC
        `,
      [studentId],
    );

    const availableEnrollments = availableEnrollmentRows.map((row) => ({
      enrollment_id: Number(row.enrollment_id),

      academic_year_id: Number(row.academic_year_id),

      academic_year: row.academic_year,

      semester_id: Number(row.semester_id),

      semester_name: row.semester_name,

      enrollment_status: row.enrollment_status,

      approved_at: row.approved_at || null,
    }));

    // ========================================================
    // EXISTING REQUESTS
    //
    // LEFT JOIN enrollment period because legacy document
    // requests may have enrollment_id = NULL.
    // ========================================================

    const [rows] = await db.execute(
      `
          SELECT
            sdr.request_id,
            sdr.request_number,

            sdr.student_id,

            sdr.enrollment_id,

            ay.academic_year_id,
            ay.academic_year,

            sem.semester_id,
            sem.semester_name,

            e.enrollment_status,

            sdr.document_type,
            sdr.purpose,
            sdr.copies,

            sdr.requested_at,
            sdr.cancelled_at,
            sdr.cancellation_reason,

            ft.ticket_id,
            ft.ticket_number,

            ft.amount_due,
            ft.amount_paid,

            ft.payment_method,
            ft.receipt_number,

            ft.payment_status,
            ft.registrar_status,

            ft.paid_at,

            ft.registrar_started_at,
            ft.registrar_completed_at,

            ft.created_at
              AS ticket_created_at

          FROM student_document_requests sdr

          INNER JOIN finance_tickets ft
            ON ft.document_request_id =
               sdr.request_id

          LEFT JOIN enrollments e
            ON e.enrollment_id =
               sdr.enrollment_id

          LEFT JOIN academic_years ay
            ON ay.academic_year_id =
               e.academic_year_id

          LEFT JOIN semesters sem
            ON sem.semester_id =
               e.semester_id

          WHERE sdr.student_id = ?

          ORDER BY
            sdr.request_id DESC
        `,
      [studentId],
    );

    const requests = rows.map((row) => ({
      request_id: Number(row.request_id),

      request_number: row.request_number,

      student_id: Number(row.student_id),

      enrollment_id: row.enrollment_id ? Number(row.enrollment_id) : null,

      academic_period: row.enrollment_id
        ? {
            academic_year_id: row.academic_year_id
              ? Number(row.academic_year_id)
              : null,

            academic_year: row.academic_year || null,

            semester_id: row.semester_id ? Number(row.semester_id) : null,

            semester_name: row.semester_name || null,

            enrollment_status: row.enrollment_status || null,
          }
        : null,

      document_type: row.document_type,

      purpose: row.purpose || null,

      copies: Number(row.copies || 1),

      requested_at: row.requested_at,

      cancelled_at: row.cancelled_at || null,

      cancellation_reason: row.cancellation_reason || null,

      ticket_id: Number(row.ticket_id),

      ticket_number: row.ticket_number,

      amount_due: row.amount_due,

      amount_paid: row.amount_paid,

      payment_method: row.payment_method || null,

      receipt_number: row.receipt_number || null,

      payment_status: row.payment_status,

      registrar_status: row.registrar_status,

      paid_at: row.paid_at || null,

      registrar_started_at: row.registrar_started_at || null,

      registrar_completed_at: row.registrar_completed_at || null,

      ticket_created_at: row.ticket_created_at,
    }));

    // ========================================================
    // RESPONSE
    // ========================================================

    return res.status(200).json({
      success: true,

      code: "DOCUMENT_REQUESTS_RETRIEVED",

      student: {
        student_id: studentId,

        student_number: student.student_number,

        student_name: [
          student.first_name,
          student.middle_name,
          student.last_name,
        ]
          .filter(Boolean)
          .join(" "),
      },

      available_enrollments: availableEnrollments,

      requests,
    });
  } catch (error) {
    console.error("GET STUDENT DOCUMENT REQUESTS ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "DOCUMENT_REQUESTS_LOAD_FAILED",

      message: "Failed to load document requests.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================
// CREATE COR / COG REQUEST + AUTOMATIC FINANCE TICKET
//
// POST /api/student/document-requests
//
// Body:
//
// {
//   "document_type": "COR" | "COG",
//   "enrollment_id": 4,
//   "purpose": "Optional purpose",
//   "copies": 1
// }
//
// IMPORTANT:
// - Student identity comes ONLY from req.user.
// - Frontend never sends student_id / user_id.
// - enrollment_id MUST belong to authenticated Student.
// - enrollment MUST be Approved.
// - Document request + Finance ticket created atomically.
// - One request creates exactly one Finance ticket.
// ============================================================

router.post("/", async (req, res) => {
  // ==========================================================
  // SECURITY
  // ==========================================================

  if (!req.user || req.user.role_name !== "Student") {
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

  // ==========================================================
  // DOCUMENT TYPE
  // ==========================================================

  const documentType = String(req.body?.document_type || "")
    .trim()
    .toUpperCase();

  if (!ALLOWED_DOCUMENT_TYPES.has(documentType)) {
    return res.status(400).json({
      success: false,

      code: "INVALID_DOCUMENT_TYPE",

      message: "Document type must be COR or COG.",
    });
  }

  // ==========================================================
  // ENROLLMENT ID
  // ==========================================================

  const enrollmentId = toPositiveInt(req.body?.enrollment_id);

  if (!enrollmentId) {
    return res.status(400).json({
      success: false,

      code: "ENROLLMENT_REQUIRED",

      message:
        "Please select an approved academic period for this document request.",
    });
  }

  // ==========================================================
  // PURPOSE
  // ==========================================================

  const purpose = cleanOptionalText(req.body?.purpose, 255);

  // ==========================================================
  // COPIES
  // ==========================================================

  const rawCopies =
    req.body?.copies === undefined || req.body?.copies === null
      ? 1
      : Number(req.body.copies);

  if (!Number.isInteger(rawCopies) || rawCopies < 1) {
    return res.status(400).json({
      success: false,

      code: "INVALID_COPY_COUNT",

      message: "Copies must be a whole number greater than or equal to 1.",
    });
  }

  let connection;

  try {
    connection = await db.getConnection();

    await connection.beginTransaction();

    // ========================================================
    // 1. RESOLVE AUTHENTICATED STUDENT
    // ========================================================

    const [studentRows] = await connection.execute(
      `
          SELECT
            s.student_id,
            s.student_number,

            s.first_name,
            s.middle_name,
            s.last_name

          FROM students s

          WHERE s.user_id = ?

          LIMIT 1

          FOR UPDATE
        `,
      [userId],
    );

    if (studentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,

        code: "STUDENT_PROFILE_NOT_FOUND",

        message: "No Student profile is connected to this account.",
      });
    }

    const student = studentRows[0];

    const studentId = Number(student.student_id);

    // ========================================================
    // 2. VALIDATE REQUESTED ENROLLMENT
    //
    // CRITICAL:
    //
    // We do not trust enrollment_id just because it came from
    // the frontend.
    //
    // It must:
    // - exist
    // - belong to this authenticated Student
    // - be officially Approved
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
            e.approved_at

          FROM enrollments e

          INNER JOIN academic_years ay
            ON ay.academic_year_id =
               e.academic_year_id

          INNER JOIN semesters sem
            ON sem.semester_id =
               e.semester_id

          WHERE e.enrollment_id = ?
            AND e.student_id = ?

          LIMIT 1

          FOR UPDATE
        `,
      [enrollmentId, studentId],
    );

    if (enrollmentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,

        code: "ENROLLMENT_NOT_FOUND",

        message:
          "The selected enrollment does not belong to your Student account.",
      });
    }

    const enrollment = enrollmentRows[0];

    if (enrollment.enrollment_status !== "Approved") {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        code: "ENROLLMENT_NOT_APPROVED",

        message:
          "Only an approved enrollment can be used for a COR or COG request.",

        enrollment: {
          enrollment_id: Number(enrollment.enrollment_id),

          enrollment_status: enrollment.enrollment_status,
        },
      });
    }

    // ========================================================
    // 3. LOAD FINANCE TRANSACTION TYPE
    // ========================================================

    const [typeRows] = await connection.execute(
      `
          SELECT
            transaction_type_id,
            transaction_code,
            transaction_name,
            default_amount

          FROM finance_transaction_types

          WHERE transaction_code = ?
            AND is_active = 1

          LIMIT 1
        `,
      [documentType],
    );

    if (typeRows.length === 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        code: "TRANSACTION_TYPE_UNAVAILABLE",

        message: `${documentType} requests are currently unavailable.`,
      });
    }

    const transactionType = typeRows[0];

    // ========================================================
    // 4. PREVENT DUPLICATE ACTIVE REQUEST
    //
    // New behavior:
    //
    // Same Student + same document type + same enrollment
    // cannot have two active requests.
    //
    // Different approved academic periods may have separate
    // requests.
    //
    // Legacy active request with enrollment_id = NULL also
    // blocks creation because its period is unknown.
    // ========================================================

    const [activeRows] = await connection.execute(
      `
          SELECT
            sdr.request_id,
            sdr.request_number,

            sdr.enrollment_id,

            ay.academic_year,
            sem.semester_name,

            ft.ticket_number,

            ft.payment_status,
            ft.registrar_status

          FROM student_document_requests sdr

          INNER JOIN finance_tickets ft
            ON ft.document_request_id =
               sdr.request_id

          LEFT JOIN enrollments existing_enrollment
            ON existing_enrollment.enrollment_id =
               sdr.enrollment_id

          LEFT JOIN academic_years ay
            ON ay.academic_year_id =
               existing_enrollment.academic_year_id

          LEFT JOIN semesters sem
            ON sem.semester_id =
               existing_enrollment.semester_id

          WHERE sdr.student_id = ?

            AND sdr.document_type = ?

            AND (
              sdr.enrollment_id = ?
              OR sdr.enrollment_id IS NULL
            )

            AND sdr.cancelled_at IS NULL

            AND ft.payment_status NOT IN (
              'Cancelled',
              'Refunded'
            )

            AND ft.registrar_status NOT IN (
              'Done',
              'Rejected',
              'Cancelled'
            )

          ORDER BY
            sdr.request_id DESC

          LIMIT 1

          FOR UPDATE
        `,
      [studentId, documentType, enrollmentId],
    );

    if (activeRows.length > 0) {
      await connection.rollback();

      const active = activeRows[0];

      return res.status(409).json({
        success: false,

        code: "ACTIVE_DOCUMENT_REQUEST_EXISTS",

        message: active.enrollment_id
          ? `You already have an active ${documentType} request for ${active.academic_year} — ${active.semester_name}.`
          : `You already have an active ${documentType} request.`,

        request: {
          request_id: Number(active.request_id),

          request_number: active.request_number,

          enrollment_id: active.enrollment_id
            ? Number(active.enrollment_id)
            : null,

          academic_year: active.academic_year || null,

          semester_name: active.semester_name || null,

          ticket_number: active.ticket_number,

          payment_status: active.payment_status,

          registrar_status: active.registrar_status,
        },
      });
    }

    // ========================================================
    // 5. CREATE STUDENT DOCUMENT REQUEST
    //
    // request_number is NOT NULL.
    //
    // Create with unique temporary number first, then replace
    // it after insertId becomes available.
    // ========================================================

    const tempRequestNumber = temporaryRequestNumber(documentType);

    const [requestResult] = await connection.execute(
      `
          INSERT INTO student_document_requests
          (
            request_number,
            student_id,
            enrollment_id,
            document_type,
            purpose,
            copies
          )

          VALUES (?, ?, ?, ?, ?, ?)
        `,
      [
        tempRequestNumber,
        studentId,
        enrollmentId,
        documentType,
        purpose,
        rawCopies,
      ],
    );

    const requestId = Number(requestResult.insertId);

    const year = new Date().getFullYear();

    const requestNumber = publicNumber("REQ", documentType, year, requestId);

    await connection.execute(
      `
        UPDATE student_document_requests

        SET request_number = ?

        WHERE request_id = ?
      `,
      [requestNumber, requestId],
    );

    // ========================================================
    // 6. CREATE EXACTLY ONE FINANCE TICKET
    // ========================================================

    const ticketNumber = publicNumber("FIN", documentType, year, requestId);

    const amountDue =
      transactionType.default_amount === null ||
      transactionType.default_amount === undefined
        ? null
        : Number(transactionType.default_amount);

    const [ticketResult] = await connection.execute(
      `
         INSERT INTO finance_tickets
(
  ticket_number,
  student_id,

  transaction_type_id,
  document_request_id,

  grade_id,
  source_type,

  amount_due,
  amount_paid,

  payment_status,
  registrar_status,

  created_by
)

VALUES (
  ?,
  ?,
  ?,
  ?,
  NULL,
  'STUDENT_REQUEST',
  ?,
  0.00,
  'Pending Payment',
  'Pending',
  ?
)
        `,
      [
        ticketNumber,
        studentId,

        Number(transactionType.transaction_type_id),

        requestId,

        amountDue,

        userId,
      ],
    );

    const ticketId = Number(ticketResult.insertId);

    // ========================================================
    // COMMIT
    // ========================================================

    await connection.commit();

    // ========================================================
    // RESPONSE
    // ========================================================

    const studentName = [
      student.first_name,
      student.middle_name,
      student.last_name,
    ]
      .filter(Boolean)
      .join(" ");

    return res.status(201).json({
      success: true,

      code: "DOCUMENT_REQUEST_CREATED",

      message: `${documentType} request for ${enrollment.academic_year} — ${enrollment.semester_name} created successfully. Present the Finance ticket to the Cashier for payment.`,

      request: {
        request_id: requestId,

        request_number: requestNumber,

        document_type: documentType,

        enrollment_id: enrollmentId,

        academic_period: {
          academic_year_id: Number(enrollment.academic_year_id),

          academic_year: enrollment.academic_year,

          semester_id: Number(enrollment.semester_id),

          semester_name: enrollment.semester_name,

          enrollment_status: enrollment.enrollment_status,
        },

        purpose,

        copies: rawCopies,
      },

      ticket: {
        ticket_id: ticketId,

        ticket_number: ticketNumber,

        transaction_type: documentType,

        amount_due: amountDue,

        amount_paid: 0,

        payment_status: "Pending Payment",

        registrar_status: "Pending",
      },

      student: {
        student_id: studentId,

        student_number: student.student_number,

        student_name: studentName,
      },
    });
  } catch (error) {
    // ========================================================
    // ROLLBACK
    // ========================================================

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("CREATE DOCUMENT REQUEST ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("CREATE STUDENT DOCUMENT REQUEST ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "DOCUMENT_REQUEST_CREATE_FAILED",

      message: "Failed to create the document request and Finance ticket.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

export default router;
