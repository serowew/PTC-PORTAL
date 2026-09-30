// server/routes/student/transactions.js

import express from "express";
import db from "../../db.js";

const router = express.Router();

// ============================================================
// GET MY FINANCE TRANSACTIONS
//
// GET /api/student/transactions
//
// Parent route security:
//   /api/student -> authenticate -> requireRole("Student")
//
// Returns ALL Finance tickets owned by the authenticated student:
// - Student document requests (COR / COG)
// - Finance-created manual transactions
// - Later Faculty-verified Grade 4 transactions
//
// Student identity always comes from req.user.
// The frontend never supplies student_id.
// ============================================================

router.get("/", async (req, res) => {
  try {
    // ========================================================
    // 1. SECURITY
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
    // 2. RESOLVE AUTHENTICATED STUDENT
    // ========================================================

    const [studentRows] = await db.execute(
      `
        SELECT
          student_id,
          student_number,
          first_name,
          middle_name,
          last_name

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

    const student = studentRows[0];

    const studentId = Number(student.student_id);

    // ========================================================
    // 3. LOAD ALL STUDENT FINANCE TRANSACTIONS
    // ========================================================

    const [rows] = await db.execute(
      `
        SELECT
          ft.ticket_id,
          ft.ticket_number,

          ft.source_type,

          ft.document_request_id,
          ft.grade_id,

          ft.amount_due,
          ft.amount_paid,
          ft.payment_method,
          ft.receipt_number,
          ft.payment_status,
          ft.registrar_status,

          ft.finance_remarks,
          ft.registrar_remarks,

          ft.paid_at,
          ft.registrar_started_at,
          ft.registrar_completed_at,

          ft.created_at,
          ft.updated_at,

          ftt.transaction_type_id,
          ftt.transaction_code,
          ftt.transaction_name,
          ftt.description AS transaction_description,
          ftt.workflow_type,

          sdr.request_number,
          sdr.document_type,
          sdr.enrollment_id,
          sdr.purpose,
          sdr.copies,
          sdr.requested_at,
          sdr.cancelled_at,
          sdr.cancellation_reason,

          ay.academic_year,
          sem.semester_name,
          e.enrollment_status

        FROM finance_tickets ft

        INNER JOIN finance_transaction_types ftt
          ON ftt.transaction_type_id = ft.transaction_type_id

        LEFT JOIN student_document_requests sdr
          ON sdr.request_id = ft.document_request_id

        LEFT JOIN enrollments e
          ON e.enrollment_id = sdr.enrollment_id

        LEFT JOIN academic_years ay
          ON ay.academic_year_id = e.academic_year_id

        LEFT JOIN semesters sem
          ON sem.semester_id = e.semester_id

        WHERE ft.student_id = ?

        ORDER BY ft.ticket_id DESC
      `,
      [studentId],
    );

    // ========================================================
    // 4. FORMAT RESPONSE
    // ========================================================

    const transactions = rows.map((row) => ({
      ticket_id: Number(row.ticket_id),

      ticket_number: row.ticket_number,

      source_type: row.source_type,

      transaction: {
        transaction_type_id: Number(row.transaction_type_id),

        transaction_code: row.transaction_code,

        transaction_name: row.transaction_name,

        description: row.transaction_description || null,

        workflow_type: row.workflow_type,
      },

      document_request:
        row.document_request_id === null ||
        row.document_request_id === undefined
          ? null
          : {
              request_id: Number(row.document_request_id),

              request_number: row.request_number,

              document_type: row.document_type,

              enrollment_id:
                row.enrollment_id === null || row.enrollment_id === undefined
                  ? null
                  : Number(row.enrollment_id),

              academic_period:
                row.enrollment_id === null || row.enrollment_id === undefined
                  ? null
                  : {
                      academic_year: row.academic_year || null,

                      semester_name: row.semester_name || null,

                      enrollment_status: row.enrollment_status || null,
                    },

              purpose: row.purpose || null,

              copies: Number(row.copies ?? 1),

              requested_at: row.requested_at || null,

              cancelled_at: row.cancelled_at || null,

              cancellation_reason: row.cancellation_reason || null,
            },

      grade_id:
        row.grade_id === null || row.grade_id === undefined
          ? null
          : Number(row.grade_id),

      payment: {
        amount_due:
          row.amount_due === null || row.amount_due === undefined
            ? null
            : Number(row.amount_due),

        amount_paid: Number(row.amount_paid ?? 0),

        payment_method: row.payment_method || null,

        receipt_number: row.receipt_number || null,

        payment_status: row.payment_status,

        paid_at: row.paid_at || null,
      },

      registrar: {
        status: row.registrar_status,

        remarks: row.registrar_remarks || null,

        started_at: row.registrar_started_at || null,

        completed_at: row.registrar_completed_at || null,
      },

      finance_remarks: row.finance_remarks || null,

      created_at: row.created_at,

      updated_at: row.updated_at,
    }));

    // ========================================================
    // 5. SUMMARY
    // ========================================================

    const summary = {
      total: transactions.length,

      pending_payment: 0,

      paid: 0,

      cancelled: 0,

      refunded: 0,

      total_outstanding: 0,

      total_paid: 0,
    };

    for (const transaction of transactions) {
      const paymentStatus = transaction.payment.payment_status;

      if (paymentStatus === "Pending Payment") {
        summary.pending_payment += 1;

        summary.total_outstanding += Number(
          transaction.payment.amount_due ?? 0,
        );
      }

      if (paymentStatus === "Paid") {
        summary.paid += 1;

        summary.total_paid += Number(transaction.payment.amount_paid ?? 0);
      }

      if (paymentStatus === "Cancelled") {
        summary.cancelled += 1;
      }

      if (paymentStatus === "Refunded") {
        summary.refunded += 1;
      }
    }

    summary.total_outstanding = Number(summary.total_outstanding.toFixed(2));

    summary.total_paid = Number(summary.total_paid.toFixed(2));

    // ========================================================
    // 6. SUCCESS
    // ========================================================

    return res.status(200).json({
      success: true,

      code: "STUDENT_TRANSACTIONS_RETRIEVED",

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

      summary,

      transactions,
    });
  } catch (error) {
    console.error("GET STUDENT FINANCE TRANSACTIONS ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "STUDENT_TRANSACTIONS_LOAD_FAILED",

      message: "Failed to load the student's Finance transactions.",
    });
  }
});

export default router;
