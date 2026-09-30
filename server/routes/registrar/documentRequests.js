import express from "express";
import db from "../../db.js";

const router = express.Router();

// ============================================================
// HELPERS
// ============================================================

function cleanOptionalText(value, maxLength = 500) {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = String(value).trim();

  if (!cleaned) {
    return null;
  }

  return cleaned.slice(0, maxLength);
}

function normalizeTicketNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function mapRegistrarRequest(row) {
  return {
    ticket_id: Number(row.ticket_id),

    ticket_number: row.ticket_number,

    student: {
      student_id: Number(row.student_id),

      student_number: row.student_number,

      student_name: row.student_name,
    },

    transaction: {
      transaction_code: row.transaction_code,

      transaction_name: row.transaction_name,
    },

    document_request: {
      request_id: Number(row.request_id),

      request_number: row.request_number,

      document_type: row.document_type,

      enrollment_id:
        row.enrollment_id !== null && row.enrollment_id !== undefined
          ? Number(row.enrollment_id)
          : null,

      academic_period:
        row.enrollment_id !== null && row.enrollment_id !== undefined
          ? {
              academic_year_id:
                row.academic_year_id !== null &&
                row.academic_year_id !== undefined
                  ? Number(row.academic_year_id)
                  : null,

              academic_year: row.academic_year || null,

              semester_id:
                row.semester_id !== null && row.semester_id !== undefined
                  ? Number(row.semester_id)
                  : null,

              semester_name: row.semester_name || null,

              enrollment_status: row.enrollment_status || null,
            }
          : null,

      purpose: row.purpose || null,

      copies: Number(row.copies || 1),

      requested_at: row.requested_at || null,
    },

    payment: {
      amount_due: row.amount_due,

      amount_paid: row.amount_paid,

      payment_method: row.payment_method || null,

      receipt_number: row.receipt_number || null,

      payment_status: row.payment_status,

      paid_at: row.paid_at || null,
    },

    registrar: {
      status: row.registrar_status,

      remarks: row.registrar_remarks || null,

      processed_by:
        row.registrar_processed_by !== null &&
        row.registrar_processed_by !== undefined
          ? Number(row.registrar_processed_by)
          : null,

      started_at: row.registrar_started_at || null,

      completed_at: row.registrar_completed_at || null,
    },

    created_at: row.created_at || null,

    updated_at: row.updated_at || null,
  };
}

// ============================================================
// COMMON SELECT
// ============================================================

const DOCUMENT_REQUEST_SELECT = `
  SELECT
    ft.ticket_id,
    ft.ticket_number,

    ft.student_id,

    s.student_number,

    TRIM(
      CONCAT_WS(
        ' ',
        s.first_name,
        NULLIF(s.middle_name, ''),
        s.last_name
      )
    ) AS student_name,

    ftt.transaction_code,
    ftt.transaction_name,

    sdr.request_id,
    sdr.request_number,
    sdr.document_type,

    sdr.enrollment_id,

    e.academic_year_id,
    ay.academic_year,

    e.semester_id,
    sem.semester_name,

    e.enrollment_status,

    sdr.purpose,
    sdr.copies,
    sdr.requested_at,

    ft.amount_due,
    ft.amount_paid,

    ft.payment_method,
    ft.receipt_number,

    ft.payment_status,
    ft.paid_at,

    ft.registrar_status,
    ft.registrar_remarks,

    ft.registrar_processed_by,
    ft.registrar_started_at,
    ft.registrar_completed_at,

    ft.created_at,
    ft.updated_at

  FROM finance_tickets ft

  INNER JOIN finance_transaction_types ftt
    ON ftt.transaction_type_id =
       ft.transaction_type_id

  INNER JOIN students s
    ON s.student_id =
       ft.student_id

  INNER JOIN student_document_requests sdr
    ON sdr.request_id =
       ft.document_request_id

  LEFT JOIN enrollments e
    ON e.enrollment_id =
       sdr.enrollment_id

  LEFT JOIN academic_years ay
    ON ay.academic_year_id =
       e.academic_year_id

  LEFT JOIN semesters sem
    ON sem.semester_id =
       e.semester_id
`;

// ============================================================
// GET REGISTRAR DOCUMENT REQUEST QUEUE
//
// GET /api/registrar/document-requests
//
// Only Finance-paid document requests belong in Registrar queue.
//
// Includes:
//
// document_request.enrollment_id
//
// document_request.academic_period = {
//   academic_year_id,
//   academic_year,
//   semester_id,
//   semester_name,
//   enrollment_status
// }
// ============================================================

router.get("/", async (req, res) => {
  try {
    if (!req.user || req.user.role_name !== "Registrar") {
      return res.status(403).json({
        success: false,

        code: "REGISTRAR_ACCESS_REQUIRED",

        message: "Registrar access is required.",
      });
    }

    const [rows] = await db.execute(
      `
        ${DOCUMENT_REQUEST_SELECT}

        WHERE ft.document_request_id IS NOT NULL

          AND ft.payment_status = 'Paid'

          AND ft.registrar_status IN (
            'Ready for Processing',
            'Processing',
            'Done'
          )

        ORDER BY
          CASE ft.registrar_status
            WHEN 'Ready for Processing' THEN 1
            WHEN 'Processing' THEN 2
            WHEN 'Done' THEN 3
            ELSE 4
          END,
          ft.updated_at DESC,
          ft.ticket_id DESC
      `,
    );

    const requests = rows.map(mapRegistrarRequest);

    return res.status(200).json({
      success: true,

      code: "REGISTRAR_DOCUMENT_REQUESTS_RETRIEVED",

      requests,
    });
  } catch (error) {
    console.error("GET REGISTRAR DOCUMENT REQUESTS ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "REGISTRAR_DOCUMENT_REQUESTS_LOAD_FAILED",

      message: "Failed to load Registrar document requests.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================
// GET ONE DOCUMENT REQUEST
//
// GET /api/registrar/document-requests/:ticketNumber
// ============================================================

router.get("/:ticketNumber", async (req, res) => {
  try {
    if (!req.user || req.user.role_name !== "Registrar") {
      return res.status(403).json({
        success: false,

        code: "REGISTRAR_ACCESS_REQUIRED",

        message: "Registrar access is required.",
      });
    }

    const ticketNumber = normalizeTicketNumber(req.params.ticketNumber);

    if (!ticketNumber) {
      return res.status(400).json({
        success: false,

        code: "INVALID_TICKET_NUMBER",

        message: "Finance ticket number is required.",
      });
    }

    const [rows] = await db.execute(
      `
            ${DOCUMENT_REQUEST_SELECT}

            WHERE ft.ticket_number = ?

              AND ft.document_request_id
                  IS NOT NULL

            LIMIT 1
          `,
      [ticketNumber],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,

        code: "DOCUMENT_REQUEST_NOT_FOUND",

        message: "Document request was not found.",
      });
    }

    return res.status(200).json({
      success: true,

      code: "REGISTRAR_DOCUMENT_REQUEST_RETRIEVED",

      request: mapRegistrarRequest(rows[0]),
    });
  } catch (error) {
    console.error("GET REGISTRAR DOCUMENT REQUEST ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "REGISTRAR_DOCUMENT_REQUEST_LOAD_FAILED",

      message: "Failed to load Registrar document request.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================
// START REGISTRAR PROCESSING
//
// PATCH
// /api/registrar/document-requests/:ticketNumber/start
//
// Required state:
//
// payment_status = Paid
// registrar_status = Ready for Processing
//
// Transition:
//
// Ready for Processing
//          ↓
//      Processing
//
// IMPORTANT:
// Registrar does NOT modify payment status.
// ============================================================

router.patch("/:ticketNumber/start", async (req, res) => {
  if (!req.user || req.user.role_name !== "Registrar") {
    return res.status(403).json({
      success: false,

      code: "REGISTRAR_ACCESS_REQUIRED",

      message: "Registrar access is required.",
    });
  }

  const registrarUserId = Number(req.user.user_id);

  if (!Number.isInteger(registrarUserId) || registrarUserId <= 0) {
    return res.status(401).json({
      success: false,

      code: "INVALID_AUTHENTICATED_USER",

      message: "Authenticated Registrar user is invalid.",
    });
  }

  const ticketNumber = normalizeTicketNumber(req.params.ticketNumber);

  if (!ticketNumber) {
    return res.status(400).json({
      success: false,

      code: "INVALID_TICKET_NUMBER",

      message: "Finance ticket number is required.",
    });
  }

  const remarks = cleanOptionalText(req.body?.remarks, 500);

  let connection;

  try {
    connection = await db.getConnection();

    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `
            SELECT
              ft.ticket_id,
              ft.ticket_number,

              ft.payment_status,
              ft.registrar_status,

              ft.document_request_id,

              sdr.request_number,
              sdr.document_type,
              sdr.enrollment_id,

              s.student_number,

              TRIM(
                CONCAT_WS(
                  ' ',
                  s.first_name,
                  NULLIF(
                    s.middle_name,
                    ''
                  ),
                  s.last_name
                )
              ) AS student_name

            FROM finance_tickets ft

            INNER JOIN
              student_document_requests sdr
                ON sdr.request_id =
                   ft.document_request_id

            INNER JOIN students s
              ON s.student_id =
                 ft.student_id

            WHERE ft.ticket_number = ?

            LIMIT 1

            FOR UPDATE
          `,
      [ticketNumber],
    );

    if (rows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,

        code: "DOCUMENT_REQUEST_NOT_FOUND",

        message: "Document request was not found.",
      });
    }

    const request = rows[0];

    // ========================================================
    // PAYMENT MUST BE PAID
    // ========================================================

    if (request.payment_status !== "Paid") {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        code: "PAYMENT_NOT_COMPLETED",

        message:
          "This document request cannot be processed until Finance marks it Paid.",
      });
    }

    // ========================================================
    // MUST BE READY
    // ========================================================

    if (request.registrar_status !== "Ready for Processing") {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        code: "INVALID_REGISTRAR_STATUS",

        message: `Document request is currently ${request.registrar_status}. Only Ready for Processing requests can be started.`,

        current_status: request.registrar_status,
      });
    }

    // ========================================================
    // NEW REQUESTS MUST HAVE ACADEMIC PERIOD
    //
    // Legacy requests may still contain NULL.
    //
    // We do not block old historical records here, but the
    // frontend will treat NULL as a legacy request.
    // ========================================================

    await connection.execute(
      `
          UPDATE finance_tickets

          SET
            registrar_status =
              'Processing',

            registrar_processed_by = ?,

            registrar_started_at =
              COALESCE(
                registrar_started_at,
                NOW()
              ),

            registrar_remarks =
              CASE
                WHEN ? IS NULL
                  THEN registrar_remarks
                ELSE ?
              END

          WHERE ticket_id = ?
        `,
      [registrarUserId, remarks, remarks, Number(request.ticket_id)],
    );

    await connection.commit();

    return res.status(200).json({
      success: true,

      code: "REGISTRAR_PROCESSING_STARTED",

      message: "Registrar processing has started.",

      request: {
        ticket_id: Number(request.ticket_id),

        ticket_number: request.ticket_number,

        request_number: request.request_number,

        document_type: request.document_type,

        enrollment_id:
          request.enrollment_id !== null && request.enrollment_id !== undefined
            ? Number(request.enrollment_id)
            : null,

        student_number: request.student_number,

        student_name: request.student_name,

        payment_status: request.payment_status,

        registrar_status: "Processing",

        registrar_processed_by: registrarUserId,
      },
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("START REGISTRAR ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("START REGISTRAR DOCUMENT PROCESSING ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "REGISTRAR_PROCESSING_START_FAILED",

      message: "Failed to start Registrar processing.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// ============================================================
// COMPLETE DOCUMENT REQUEST
//
// PATCH
// /api/registrar/document-requests/:ticketNumber/complete
//
// Required state:
//
// payment_status = Paid
// registrar_status = Processing
//
// Transition:
//
// Processing
//     ↓
//    Done
//
// Registrar still does NOT modify payment status.
// ============================================================

router.patch("/:ticketNumber/complete", async (req, res) => {
  if (!req.user || req.user.role_name !== "Registrar") {
    return res.status(403).json({
      success: false,

      code: "REGISTRAR_ACCESS_REQUIRED",

      message: "Registrar access is required.",
    });
  }

  const registrarUserId = Number(req.user.user_id);

  if (!Number.isInteger(registrarUserId) || registrarUserId <= 0) {
    return res.status(401).json({
      success: false,

      code: "INVALID_AUTHENTICATED_USER",

      message: "Authenticated Registrar user is invalid.",
    });
  }

  const ticketNumber = normalizeTicketNumber(req.params.ticketNumber);

  if (!ticketNumber) {
    return res.status(400).json({
      success: false,

      code: "INVALID_TICKET_NUMBER",

      message: "Finance ticket number is required.",
    });
  }

  const remarks = cleanOptionalText(req.body?.remarks, 500);

  let connection;

  try {
    connection = await db.getConnection();

    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `
            SELECT
              ft.ticket_id,
              ft.ticket_number,

              ft.payment_status,
              ft.registrar_status,

              sdr.request_number,
              sdr.document_type,
              sdr.enrollment_id,

              s.student_number,

              TRIM(
                CONCAT_WS(
                  ' ',
                  s.first_name,
                  NULLIF(
                    s.middle_name,
                    ''
                  ),
                  s.last_name
                )
              ) AS student_name

            FROM finance_tickets ft

            INNER JOIN
              student_document_requests sdr
                ON sdr.request_id =
                   ft.document_request_id

            INNER JOIN students s
              ON s.student_id =
                 ft.student_id

            WHERE ft.ticket_number = ?

            LIMIT 1

            FOR UPDATE
          `,
      [ticketNumber],
    );

    if (rows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,

        code: "DOCUMENT_REQUEST_NOT_FOUND",

        message: "Document request was not found.",
      });
    }

    const request = rows[0];

    if (request.payment_status !== "Paid") {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        code: "PAYMENT_NOT_COMPLETED",

        message:
          "This request cannot be completed because payment is not Paid.",
      });
    }

    if (request.registrar_status !== "Processing") {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        code: "INVALID_REGISTRAR_STATUS",

        message: `Document request is currently ${request.registrar_status}. It must be Processing before it can be marked Done.`,

        current_status: request.registrar_status,
      });
    }

    await connection.execute(
      `
          UPDATE finance_tickets

          SET
            registrar_status = 'Done',

            registrar_processed_by = ?,

            registrar_completed_at =
              NOW(),

            registrar_remarks =
              CASE
                WHEN ? IS NULL
                  THEN registrar_remarks
                ELSE ?
              END

          WHERE ticket_id = ?
        `,
      [registrarUserId, remarks, remarks, Number(request.ticket_id)],
    );

    await connection.commit();

    return res.status(200).json({
      success: true,

      code: "DOCUMENT_REQUEST_COMPLETED",

      message: "Document request has been marked Done.",

      request: {
        ticket_id: Number(request.ticket_id),

        ticket_number: request.ticket_number,

        request_number: request.request_number,

        document_type: request.document_type,

        enrollment_id:
          request.enrollment_id !== null && request.enrollment_id !== undefined
            ? Number(request.enrollment_id)
            : null,

        student_number: request.student_number,

        student_name: request.student_name,

        payment_status: request.payment_status,

        registrar_status: "Done",

        registrar_processed_by: registrarUserId,
      },
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("COMPLETE REGISTRAR ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("COMPLETE REGISTRAR DOCUMENT REQUEST ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "DOCUMENT_REQUEST_COMPLETE_FAILED",

      message: "Failed to complete document request.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

export default router;
