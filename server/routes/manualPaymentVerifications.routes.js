import express from "express";
import db from "../db.js";

const router = express.Router();

const role = (req, res, expected) => {
  if (req.user?.role_name !== expected) {
    res
      .status(403)
      .json({
        success: false,
        code: `${expected.toUpperCase()}_ACCESS_REQUIRED`,
        message: `${expected} access is required.`,
      });
    return false;
  }
  return true;
};

const selectSql = `
  SELECT mv.verification_id, mv.ticket_id, mv.student_id,
    mv.verification_status, mv.verified_by, mv.verified_at,
    mv.verification_remarks, mv.created_at, mv.updated_at,
    ft.ticket_number, ft.amount_due, ft.amount_paid, ft.payment_status,
    ft.payment_method, ft.receipt_number, ft.paid_at,
    s.student_number,
    TRIM(CONCAT_WS(' ', s.first_name, NULLIF(s.middle_name, ''), s.last_name)) AS student_name,
    ftt.transaction_code, ftt.transaction_name
  FROM manual_payment_verifications mv
  JOIN finance_tickets ft ON ft.ticket_id = mv.ticket_id
  JOIN students s ON s.student_id = mv.student_id
  JOIN finance_transaction_types ftt ON ftt.transaction_type_id = ft.transaction_type_id`;

function map(row) {
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
    amount_due: row.amount_due == null ? null : Number(row.amount_due),
    amount_paid: Number(row.amount_paid || 0),
    payment_status: row.payment_status,
    payment_method: row.payment_method,
    receipt_number: row.receipt_number,
    paid_at: row.paid_at,
    verification_status: row.verification_status,
    verification_remarks: row.verification_remarks,
    verified_by: row.verified_by == null ? null : Number(row.verified_by),
    verified_at: row.verified_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

router.post("/", async (req, res) => {
  if (!role(req, res, "Finance")) return;
  const ticketNumber = String(
    req.body?.ticket_number ?? req.body?.ticketNumber ?? "",
  )
    .trim()
    .toUpperCase();
  if (!ticketNumber)
    return res
      .status(400)
      .json({
        success: false,
        code: "TICKET_NUMBER_REQUIRED",
        message: "Ticket number is required.",
      });
  try {
    const [tickets] = await db.execute(
      "SELECT ticket_id, student_id, payment_status, source_type, document_request_id FROM finance_tickets WHERE ticket_number = ? LIMIT 1",
      [ticketNumber],
    );
    if (!tickets.length)
      return res
        .status(404)
        .json({
          success: false,
          code: "FINANCE_TICKET_NOT_FOUND",
          message: "Finance ticket was not found.",
        });
    const ticket = tickets[0];
    if (
      ticket.source_type !== "FINANCE_MANUAL" ||
      ticket.document_request_id !== null
    )
      return res
        .status(409)
        .json({
          success: false,
          code: "MANUAL_TICKET_REQUIRED",
          message:
            "Only manual Finance tickets can be registered for verification.",
        });
    if (ticket.payment_status !== "Paid")
      return res
        .status(409)
        .json({
          success: false,
          code: "MANUAL_PAYMENT_NOT_PAID",
          message:
            "Only paid manual transactions can be registered for Registrar verification.",
          payment_status: ticket.payment_status,
        });
    const [existing] = await db.execute(
      `${selectSql} WHERE mv.ticket_id = ? LIMIT 1`,
      [ticket.ticket_id],
    );
    if (existing.length)
      return res.json({
        success: true,
        code: "MANUAL_PAYMENT_VERIFICATION_EXISTS",
        message: "This manual payment is already registered for verification.",
        verification: map(existing[0]),
      });
    const [result] = await db.execute(
      "INSERT INTO manual_payment_verifications (ticket_id, student_id, verification_status) VALUES (?, ?, 'Pending')",
      [ticket.ticket_id, ticket.student_id],
    );
    const [created] = await db.execute(
      `${selectSql} WHERE mv.verification_id = ? LIMIT 1`,
      [result.insertId],
    );
    return res
      .status(201)
      .json({
        success: true,
        code: "MANUAL_PAYMENT_VERIFICATION_CREATED",
        message: "Manual payment registered for verification.",
        verification: map(created[0]),
      });
  } catch (error) {
    console.error("CREATE MANUAL PAYMENT VERIFICATION ERROR:", error);
    return res
      .status(500)
      .json({
        success: false,
        code: "MANUAL_PAYMENT_VERIFICATION_CREATE_FAILED",
        message: "Failed to register the manual payment for verification.",
      });
  }
});

router.get("/registrar", async (req, res) => {
  if (!role(req, res, "Registrar")) return;
  try {
    const [rows] = await db.execute(
      `${selectSql} WHERE ft.source_type = 'FINANCE_MANUAL' AND ft.document_request_id IS NULL AND ft.payment_status = 'Paid' AND mv.verification_status = 'Pending' ORDER BY mv.created_at ASC`,
    );
    return res.json({
      success: true,
      code: "MANUAL_PAYMENT_VERIFICATIONS_RETRIEVED",
      verifications: rows.map(map),
    });
  } catch (error) {
    console.error("GET REGISTRAR MANUAL PAYMENT VERIFICATIONS ERROR:", error);
    return res
      .status(500)
      .json({
        success: false,
        code: "MANUAL_PAYMENT_VERIFICATIONS_LOAD_FAILED",
        message: "Failed to load manual payments for verification.",
      });
  }
});

router.patch("/:ticketNumber/verify", async (req, res) => {
  if (!role(req, res, "Registrar")) return;
  const ticketNumber = String(req.params.ticketNumber || "")
    .trim()
    .toUpperCase();
  const remarks =
    req.body?.remarks == null
      ? null
      : String(req.body.remarks).trim().slice(0, 500) || null;
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `${selectSql} WHERE ft.ticket_number = ? AND ft.source_type = 'FINANCE_MANUAL' AND ft.document_request_id IS NULL LIMIT 1 FOR UPDATE`,
      [ticketNumber],
    );
    if (!rows.length) {
      await connection.rollback();
      return res
        .status(404)
        .json({
          success: false,
          code: "MANUAL_PAYMENT_VERIFICATION_NOT_FOUND",
          message: "Manual payment verification record was not found.",
        });
    }
    const item = rows[0];
    if (item.payment_status !== "Paid") {
      await connection.rollback();
      return res
        .status(409)
        .json({
          success: false,
          code: "PAYMENT_NOT_PAID",
          message: "Only Paid manual transactions can be verified.",
          payment_status: item.payment_status,
        });
    }
    if (item.verification_status === "Verified") {
      await connection.rollback();
      return res
        .status(409)
        .json({
          success: false,
          code: "MANUAL_PAYMENT_ALREADY_VERIFIED",
          message: "This manual payment is already verified.",
        });
    }
    const userId = Number(req.user.user_id);
    await connection.execute(
      "UPDATE manual_payment_verifications SET verification_status = 'Verified', verified_by = ?, verified_at = NOW(), verification_remarks = ? WHERE verification_id = ?",
      [userId, remarks, item.verification_id],
    );
    await connection.execute(
      "UPDATE finance_tickets SET registrar_status = 'Done', registrar_remarks = ?, registrar_processed_by = ?, registrar_started_at = COALESCE(registrar_started_at, NOW()), registrar_completed_at = NOW() WHERE ticket_id = ?",
      [remarks, userId, item.ticket_id],
    );
    await connection.commit();
    return res.json({
      success: true,
      code: "MANUAL_PAYMENT_VERIFIED",
      message: "Manual payment verified successfully.",
      verification: {
        ticket_number: item.ticket_number,
        verification_status: "Verified",
        registrar_status: "Done",
        verified_by: userId,
        verification_remarks: remarks,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("VERIFY MANUAL PAYMENT ERROR:", error);
    return res
      .status(500)
      .json({
        success: false,
        code: "MANUAL_PAYMENT_VERIFICATION_FAILED",
        message: "Failed to verify the manual payment.",
      });
  } finally {
    connection?.release();
  }
});

export default router;
