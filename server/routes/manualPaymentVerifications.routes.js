import express from "express";
import db from "../db.js";

const router = express.Router();

function normalizeTicketNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function cleanRemarks(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const remarks = String(value).trim();

  return remarks ? remarks.slice(0, 500) : null;
}

function requireRole(req, res, allowedRole) {
  if (!req.user || req.user.role_name !== allowedRole) {
    res.status(403).json({
      success: false,
      code: `${allowedRole.toUpperCase()}_ACCESS_REQUIRED`,
      message: `${allowedRole} access is required.`,
    });

    return false;
  }

  return true;
}

function mapVerification(row) {
  return {
    verification_id: Number(row.verification_id),
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
    amount_due: row.amount_due === null ? null : Number(row.amount_due),
    amount_paid: Number(row.amount_paid ?? 0),
    payment_status: row.payment_status,
    payment_method: row.payment_method,
    receipt_number: row.receipt_number,
    paid_at: row.paid_at,
    verification_status: row.verification_status,
    verification_remarks: row.verification_remarks,
    verified_by: row.verified_by ? Number(row.verified_by) : null,
    verified_at: row.verified_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const MANUAL_VERIFICATION_SELECT = `
  SELECT
    mv.verification_id,
    mv.ticket_id,
    mv.student_id,
    mv.verification_status,
    mv.verified_by,
    mv.verified_at,
    mv.verification_remarks,
    mv.created_at,
    mv.updated_at,

    ft.ticket_number,
    ft.amount_due,
    ft.amount_paid,
    ft.payment_status,
    ft.payment_method,
    ft.receipt_number,
    ft.paid_at,

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
    ftt.transaction_name

  FROM manual_payment_verifications mv

  INNER JOIN finance_tickets ft
    ON ft.ticket_id = mv.ticket_id

  INNER JOIN students s
    ON s.student_id = mv.student_id

  INNER JOIN finance_transaction_types ftt
    ON ftt.transaction_type_id = ft.transaction_type_id
`;

// ============================================================
// FINANCE: REGISTER A MANUAL PAYMENT FOR VERIFICATION
// POST /api/manual-payment-verifications
// ============================================================

router.post("/", async (req, res) => {
  if (!requireRole(req, res, "Finance")) {
    return;
  }

  const ticketNumber = normalizeTicketNumber(
    req.body?.ticket_number ?? req.body?.ticketNumber,
  );

  if (!ticketNumber) {
    return res.status(400).json({
      success: false,
      code: "TICKET_NUMBER_REQUIRED",
      message: "Ticket number is required.",
    });
  }

  try {
    const [ticketRows] = await db.execute(
      `
        SELECT
          ticket_id,
          student_id,
          payment_status,
          source_type,
          document_request_id
        FROM finance_tickets
        WHERE ticket_number = ?
        LIMIT 1
      `,
      [ticketNumber],
    );

    if (ticketRows.length === 0) {
      return res.status(404).json({
        success: false,
        code: "FINANCE_TICKET_NOT_FOUND",
        message: "Finance ticket was not found.",
      });
    }

    const ticket = ticketRows[0];

    if (
      ticket.source_type !== "FINANCE_MANUAL" ||
      ticket.document_request_id !== null
    ) {
      return res.status(409).json({
        success: false,
        code: "MANUAL_TICKET_REQUIRED",
        message:
          "Only manual Finance tickets can be registered for verification.",
      });
    }

    if (["Cancelled", "Refunded"].includes(ticket.payment_status)) {
      return res.status(409).json({
        success: false,
        code: "PAYMENT_NOT_AVAILABLE",
        message:
          "Cancelled or refunded payments cannot be registered for verification.",
      });
    }

    const [existingRows] = await db.execute(
      `${MANUAL_VERIFICATION_SELECT}
       WHERE mv.ticket_id = ?
       LIMIT 1`,
      [ticket.ticket_id],
    );

    if (existingRows.length > 0) {
      return res.status(200).json({
        success: true,
        code: "MANUAL_PAYMENT_VERIFICATION_EXISTS",
        message: "This manual payment is already registered for verification.",
        verification: mapVerification(existingRows[0]),
      });
    }

    const [result] = await db.execute(
      `
        INSERT INTO manual_payment_verifications
        (
          ticket_id,
          student_id,
          verification_status
        )
        VALUES (?, ?, 'Pending')
      `,
      [ticket.ticket_id, ticket.student_id],
    );

    const [verificationRows] = await db.execute(
      `${MANUAL_VERIFICATION_SELECT}
       WHERE mv.verification_id = ?
       LIMIT 1`,
      [result.insertId],
    );

    return res.status(201).json({
      success: true,
      code: "MANUAL_PAYMENT_VERIFICATION_CREATED",
      message: "Manual payment registered for verification.",
      verification: mapVerification(verificationRows[0]),
    });
  } catch (error) {
    console.error("CREATE MANUAL PAYMENT VERIFICATION ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "MANUAL_PAYMENT_VERIFICATION_CREATE_FAILED",
      message: "Failed to register the manual payment for verification.",
    });
  }
});

// ============================================================
// REGISTRAR: LIST PAID MANUAL PAYMENTS WAITING FOR VERIFICATION
// GET /api/manual-payment-verifications/registrar
// ============================================================

router.get("/registrar", async (req, res) => {
  if (!requireRole(req, res, "Registrar")) {
    return;
  }

  try {
    const [rows] = await db.execute(
      `${MANUAL_VERIFICATION_SELECT}
       WHERE ft.source_type = 'FINANCE_MANUAL'
         AND ft.document_request_id IS NULL
         AND ft.payment_status = 'Paid'
         AND mv.verification_status = 'Pending'
       ORDER BY mv.created_at ASC`,
    );

    return res.json({
      success: true,
      code: "MANUAL_PAYMENT_VERIFICATIONS_RETRIEVED",
      verifications: rows.map(mapVerification),
    });
  } catch (error) {
    console.error("GET REGISTRAR MANUAL PAYMENT VERIFICATIONS ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "MANUAL_PAYMENT_VERIFICATIONS_LOAD_FAILED",
      message: "Failed to load manual payments for verification.",
    });
  }
});

// ============================================================
// REGISTRAR: VERIFY A MANUAL PAYMENT
// PATCH /api/manual-payment-verifications/:ticketNumber/verify
// ============================================================

router.patch("/:ticketNumber/verify", async (req, res) => {
  if (!requireRole(req, res, "Registrar")) {
    return;
  }

  const ticketNumber = normalizeTicketNumber(req.params.ticketNumber);
  const remarks = cleanRemarks(req.body?.remarks);

  if (!ticketNumber) {
    return res.status(400).json({
      success: false,
      code: "TICKET_NUMBER_REQUIRED",
      message: "Ticket number is required.",
    });
  }

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `${MANUAL_VERIFICATION_SELECT}
       WHERE ft.ticket_number = ?
         AND ft.source_type = 'FINANCE_MANUAL'
         AND ft.document_request_id IS NULL
       LIMIT 1
       FOR UPDATE`,
      [ticketNumber],
    );

    if (rows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        code: "MANUAL_PAYMENT_VERIFICATION_NOT_FOUND",
        message: "Manual payment verification record was not found.",
      });
    }

    const verification = rows[0];

    if (verification.payment_status !== "Paid") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        code: "PAYMENT_NOT_PAID",
        message: "Only Paid manual transactions can be verified.",
        payment_status: verification.payment_status,
      });
    }

    if (verification.verification_status === "Verified") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        code: "MANUAL_PAYMENT_ALREADY_VERIFIED",
        message: "This manual payment is already verified.",
      });
    }

    await connection.execute(
      `
        UPDATE manual_payment_verifications
        SET
          verification_status = 'Verified',
          verified_by = ?,
          verified_at = NOW(),
          verification_remarks = ?
        WHERE verification_id = ?
      `,
      [Number(req.user.user_id), remarks, verification.verification_id],
    );

    await connection.commit();

    return res.json({
      success: true,
      code: "MANUAL_PAYMENT_VERIFIED",
      message: "Manual payment verified successfully.",
      verification: {
        ticket_number: verification.ticket_number,
        verification_status: "Verified",
        verified_by: Number(req.user.user_id),
        verification_remarks: remarks,
      },
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("VERIFY MANUAL PAYMENT ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("VERIFY MANUAL PAYMENT ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "MANUAL_PAYMENT_VERIFICATION_FAILED",
      message: "Failed to verify the manual payment.",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// ============================================================
// STUDENT: VIEW OWN MANUAL PAYMENT VERIFICATIONS
// GET /api/manual-payment-verifications/student
// ============================================================

router.get("/student", async (req, res) => {
  if (!requireRole(req, res, "Student")) {
    return;
  }

  const userId = Number(req.user.user_id);

  try {
    const [studentRows] = await db.execute(
      `
        SELECT student_id
        FROM students
        WHERE user_id = ?
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

    const [rows] = await db.execute(
      `${MANUAL_VERIFICATION_SELECT}
       WHERE mv.student_id = ?
         AND ft.source_type = 'FINANCE_MANUAL'
         AND ft.document_request_id IS NULL
       ORDER BY mv.created_at DESC`,
      [studentRows[0].student_id],
    );

    return res.json({
      success: true,
      code: "STUDENT_MANUAL_PAYMENT_VERIFICATIONS_RETRIEVED",
      verifications: rows.map(mapVerification),
    });
  } catch (error) {
    console.error("GET STUDENT MANUAL PAYMENT VERIFICATIONS ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "STUDENT_MANUAL_PAYMENT_VERIFICATIONS_LOAD_FAILED",
      message: "Failed to load your manual payment verifications.",
    });
  }
});

export default router;
