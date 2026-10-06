import express from "express";
import db from "../../db.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const query = typeof req.query?.q === "string" ? req.query.q.trim() : "";

  const requestedPage = Number(req.query?.page);
  const page =
    Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const limit = 10;
  const offset = (page - 1) * limit;
  const like = `%${query}%`;

  try {
    const [countRows] = await db.execute(
      `
        SELECT COUNT(*) AS total_records
        FROM finance_tickets ft
        JOIN students s
          ON s.student_id = ft.student_id
        JOIN finance_transaction_types ftt
          ON ftt.transaction_type_id = ft.transaction_type_id
        WHERE LOWER(TRIM(ft.payment_status)) = 'paid'
          AND (
            ? = ''
            OR ft.ticket_number LIKE ?
            OR s.student_number LIKE ?
            OR CONCAT_WS(
              ' ',
              s.first_name,
              NULLIF(s.middle_name, ''),
              s.last_name
            ) LIKE ?
            OR ftt.transaction_code LIKE ?
            OR ftt.transaction_name LIKE ?
          )
      `,
      [query, like, like, like, like, like],
    );

    const totalRecords = Number(countRows[0]?.total_records || 0);
    const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / limit);

    const [rows] = await db.execute(
      `
        SELECT
          ft.ticket_id,
          ft.ticket_number,
          ft.amount_due,
          ft.amount_paid,
          ft.payment_method,
          ft.receipt_number,
          ft.payment_status,
          ft.paid_at,
          ft.registrar_status,
          ft.registrar_remarks,

          s.student_id,
          s.student_number,

          CONCAT_WS(
            ' ',
            s.first_name,
            NULLIF(s.middle_name, ''),
            s.last_name
          ) AS student_name,

          ftt.transaction_code,
          ftt.transaction_name,
          ftt.workflow_type

        FROM finance_tickets ft

        JOIN students s
          ON s.student_id = ft.student_id

        JOIN finance_transaction_types ftt
          ON ftt.transaction_type_id = ft.transaction_type_id

        WHERE ft.payment_status = 'Paid'
          AND (
            ? = ''
            OR ft.ticket_number LIKE ?
            OR s.student_number LIKE ?
            OR CONCAT_WS(
              ' ',
              s.first_name,
              NULLIF(s.middle_name, ''),
              s.last_name
            ) LIKE ?
            OR ftt.transaction_code LIKE ?
            OR ftt.transaction_name LIKE ?
          )

        ORDER BY
          ft.paid_at DESC,
          ft.ticket_id DESC

       LIMIT ${limit} OFFSET ${offset}
      `,
      [query, like, like, like, like, like],
    );

    return res.json({
      success: true,
      code: "REGISTRAR_FINANCE_HISTORY_RETRIEVED",
      query: query || null,
      count: rows.length,

      pagination: {
        page,
        limit,
        total_records: totalRecords,
        total_pages: totalPages,
        has_previous_page: page > 1,
        has_next_page: page < totalPages,
      },

      transactions: rows.map((row) => ({
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
          workflow_type: row.workflow_type,
        },

        payment: {
          amount_due: row.amount_due == null ? null : Number(row.amount_due),
          amount_paid: Number(row.amount_paid || 0),
          payment_method: row.payment_method,
          receipt_number: row.receipt_number,
          payment_status: row.payment_status,
          paid_at: row.paid_at,
        },

        registrar: {
          status: row.registrar_status,
          remarks: row.registrar_remarks,
        },
      })),
    });
  } catch (error) {
    console.error("REGISTRAR FINANCE HISTORY ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "REGISTRAR_FINANCE_HISTORY_FAILED",
      message: "Failed to load Finance payment history.",
    });
  }
});

export default router;
