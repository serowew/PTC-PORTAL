// server/routes/finance/tickets.js

import express from "express";
import db from "../../db.js";

const router = express.Router();

const ALLOWED_PAYMENT_METHODS = new Set(["Cash", "GCash", "Bank", "Online"]);

// ============================================================
// HELPERS
// ============================================================

function getFinanceUserId(req, res) {
  if (!req.user || req.user.role_name !== "Finance") {
    res.status(403).json({
      success: false,
      code: "FINANCE_ACCESS_REQUIRED",
      message: "Finance access is required.",
    });

    return null;
  }

  const userId = Number(req.user.user_id);

  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(401).json({
      success: false,
      code: "INVALID_AUTHENTICATED_USER",
      message: "Authenticated Finance user ID is invalid.",
    });

    return null;
  }

  return userId;
}

function cleanTicketNumber(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function cleanRequiredText(value, maxLength) {
  const cleaned = String(value || "").trim();

  if (!cleaned) {
    return null;
  }

  return cleaned.slice(0, maxLength);
}

function cleanOptionalText(value, maxLength) {
  if (value === undefined || value === null) {
    return null;
  }

  const cleaned = String(value).trim();

  if (!cleaned) {
    return null;
  }

  return cleaned.slice(0, maxLength);
}

function toMoney(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return null;
  }

  return Number(amount.toFixed(2));
}

function moneyEquals(first, second) {
  return Math.abs(Number(first) - Number(second)) < 0.005;
}

// ============================================================
// SEARCH / LIST FINANCE TICKETS
//
// GET /api/finance/tickets
// GET /api/finance/tickets?q=FIN-COR-2026-000003
//
// Search supports:
// - Finance ticket number
// - Student document request number
// - Student number
// - Student name
// - Transaction code
// - Transaction name
//
// IMPORTANT:
// This route MUST be declared before "/:ticketNumber".
// ============================================================

router.get("/", async (req, res) => {
  const financeUserId = getFinanceUserId(req, res);

  if (!financeUserId) {
    return;
  }

  const query = typeof req.query?.q === "string" ? req.query.q.trim() : "";

  const likeQuery = `%${query}%`;

  try {
    const params = [];

    let searchWhere = "";

    if (query) {
      searchWhere = `
        WHERE (
          ft.ticket_number LIKE ?
          OR sdr.request_number LIKE ?
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
      `;

      params.push(
        likeQuery,
        likeQuery,
        likeQuery,
        likeQuery,
        likeQuery,
        likeQuery,
      );
    }

    const [rows] = await db.execute(
      `
        SELECT
          ft.ticket_id,
          ft.ticket_number,

          ft.student_id,
          s.student_number,

          CONCAT_WS(
            ' ',
            s.first_name,
            NULLIF(s.middle_name, ''),
            s.last_name
          ) AS student_name,

          ftt.transaction_type_id,
          ftt.transaction_code,
          ftt.transaction_name,

          ft.document_request_id,

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
          sdr.cancelled_at,
          sdr.cancellation_reason,

          ft.grade_id,

          ft.amount_due,
          ft.amount_paid,
          ft.payment_method,
          ft.receipt_number,
          ft.payment_status,
          ft.registrar_status,
          ft.finance_remarks,
          ft.registrar_remarks,
          ft.paid_by,
          ft.paid_at,
          ft.registrar_processed_by,
          ft.registrar_started_at,
          ft.registrar_completed_at,
          ft.created_at,
          ft.updated_at

        FROM finance_tickets ft

        INNER JOIN students s
          ON s.student_id = ft.student_id

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

        ${searchWhere}

        ORDER BY ft.ticket_id DESC
        LIMIT 50
      `,
      params,
    );

    const tickets = rows.map((ticket) => ({
      ticket_id: Number(ticket.ticket_id),
      ticket_number: ticket.ticket_number,

      student: {
        student_id: Number(ticket.student_id),
        student_number: ticket.student_number,
        student_name: ticket.student_name,
      },

      transaction: {
        transaction_type_id: Number(ticket.transaction_type_id),
        transaction_code: ticket.transaction_code,
        transaction_name: ticket.transaction_name,
      },

      document_request:
        ticket.document_request_id !== null
          ? {
              request_id: Number(ticket.document_request_id),
              request_number: ticket.request_number,
              document_type: ticket.document_type,

              enrollment_id:
                ticket.enrollment_id === null ||
                ticket.enrollment_id === undefined
                  ? null
                  : Number(ticket.enrollment_id),

              academic_period:
                ticket.enrollment_id === null ||
                ticket.enrollment_id === undefined
                  ? null
                  : {
                      academic_year_id:
                        ticket.academic_year_id === null ||
                        ticket.academic_year_id === undefined
                          ? null
                          : Number(ticket.academic_year_id),

                      academic_year: ticket.academic_year || null,

                      semester_id:
                        ticket.semester_id === null ||
                        ticket.semester_id === undefined
                          ? null
                          : Number(ticket.semester_id),

                      semester_name: ticket.semester_name || null,

                      enrollment_status: ticket.enrollment_status || null,
                    },

              purpose: ticket.purpose,
              copies: Number(ticket.copies ?? 1),
              requested_at: ticket.requested_at,
              cancelled_at: ticket.cancelled_at,
              cancellation_reason: ticket.cancellation_reason,
            }
          : null,

      grade_id:
        ticket.grade_id === null || ticket.grade_id === undefined
          ? null
          : Number(ticket.grade_id),

      payment: {
        amount_due:
          ticket.amount_due === null ? null : Number(ticket.amount_due),

        amount_paid: Number(ticket.amount_paid ?? 0),
        payment_method: ticket.payment_method,
        receipt_number: ticket.receipt_number,
        payment_status: ticket.payment_status,
        finance_remarks: ticket.finance_remarks,

        paid_by:
          ticket.paid_by === null || ticket.paid_by === undefined
            ? null
            : Number(ticket.paid_by),

        paid_at: ticket.paid_at,
      },

      registrar: {
        status: ticket.registrar_status,
        remarks: ticket.registrar_remarks,

        processed_by:
          ticket.registrar_processed_by === null ||
          ticket.registrar_processed_by === undefined
            ? null
            : Number(ticket.registrar_processed_by),

        started_at: ticket.registrar_started_at,
        completed_at: ticket.registrar_completed_at,
      },

      created_at: ticket.created_at,
      updated_at: ticket.updated_at,
    }));

    return res.status(200).json({
      success: true,
      code: "FINANCE_TICKETS_RETRIEVED",
      query: query || null,
      count: tickets.length,
      tickets,
    });
  } catch (error) {
    console.error("GET FINANCE TICKETS ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "FINANCE_TICKETS_LOAD_FAILED",
      message: "Failed to load Finance tickets.",
    });
  }
});

// ============================================================
// GET FINANCE TRANSACTION TYPES / DEFAULT AMOUNTS
// GET /api/finance/tickets/transaction-types
// ============================================================

router.get("/transaction-types", async (req, res) => {
  const financeUserId = getFinanceUserId(req, res);

  if (!financeUserId) {
    return;
  }

  try {
    const [rows] = await db.execute(
      `
      SELECT
  transaction_type_id,
  transaction_code,
  transaction_name,
  description,
  requires_grade_reference,

  workflow_type,
  allow_manual_creation,
  allow_amount_override,

  default_amount,
  is_active,
  created_at,
  updated_at

FROM finance_transaction_types

ORDER BY transaction_type_id ASC
      `,
    );

    const transactionTypes = rows.map((row) => ({
      transaction_type_id: Number(row.transaction_type_id),

      transaction_code: row.transaction_code,

      transaction_name: row.transaction_name,

      description: row.description,

      requires_grade_reference: Boolean(row.requires_grade_reference),

      workflow_type: row.workflow_type,

      allow_manual_creation: Boolean(row.allow_manual_creation),

      allow_amount_override: Boolean(row.allow_amount_override),

      default_amount:
        row.default_amount === null || row.default_amount === undefined
          ? null
          : Number(row.default_amount),

      is_active: Boolean(row.is_active),

      created_at: row.created_at,

      updated_at: row.updated_at,
    }));

    return res.status(200).json({
      success: true,

      code: "FINANCE_TRANSACTION_TYPES_RETRIEVED",

      transaction_types: transactionTypes,
    });
  } catch (error) {
    console.error("GET FINANCE TRANSACTION TYPES ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "FINANCE_TRANSACTION_TYPES_LOAD_FAILED",

      message: "Failed to load Finance transaction amount settings.",
    });
  }
});
// ============================================================
// CREATE NEW FINANCE TRANSACTION TYPE
//
// POST /api/finance/tickets/transaction-types
//
// Finance-created transaction types are FINANCE_ONLY.
// ============================================================

router.post("/transaction-types", async (req, res) => {
  const financeUserId = getFinanceUserId(req, res);

  if (!financeUserId) {
    return;
  }

  const transactionCode = cleanRequiredText(req.body?.transaction_code, 50);

  const transactionName = cleanRequiredText(req.body?.transaction_name, 150);

  const description = cleanOptionalText(req.body?.description, 255);

  if (!transactionCode) {
    return res.status(400).json({
      success: false,
      code: "TRANSACTION_CODE_REQUIRED",
      message: "Transaction code is required.",
    });
  }

  if (!transactionName) {
    return res.status(400).json({
      success: false,
      code: "TRANSACTION_NAME_REQUIRED",
      message: "Transaction name is required.",
    });
  }

  const normalizedCode = transactionCode
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalizedCode) {
    return res.status(400).json({
      success: false,
      code: "INVALID_TRANSACTION_CODE",
      message: "Transaction code is invalid.",
    });
  }

  const defaultAmount =
    req.body?.default_amount === undefined ||
    req.body?.default_amount === null ||
    req.body?.default_amount === ""
      ? null
      : toMoney(req.body.default_amount);

  if (
    req.body?.default_amount !== undefined &&
    req.body?.default_amount !== null &&
    req.body?.default_amount !== "" &&
    (defaultAmount === null || defaultAmount <= 0)
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_DEFAULT_AMOUNT",
      message: "Default amount must be greater than zero.",
    });
  }

  const allowAmountOverride =
    req.body?.allow_amount_override === undefined
      ? true
      : Boolean(req.body.allow_amount_override);

  try {
    const [existingRows] = await db.execute(
      `
        SELECT
          transaction_type_id

        FROM finance_transaction_types

        WHERE transaction_code = ?

        LIMIT 1
      `,
      [normalizedCode],
    );

    if (existingRows.length > 0) {
      return res.status(409).json({
        success: false,
        code: "TRANSACTION_CODE_EXISTS",
        message: "A Finance transaction type with that code already exists.",
      });
    }

    const [result] = await db.execute(
      `
        INSERT INTO finance_transaction_types
        (
          transaction_code,
          transaction_name,
          description,

          requires_grade_reference,

          workflow_type,
          allow_manual_creation,
          allow_amount_override,

          default_amount,
          is_active
        )

        VALUES (
          ?,
          ?,
          ?,

          0,

          'FINANCE_ONLY',
          1,
          ?,

          ?,
          1
        )
      `,
      [
        normalizedCode,
        transactionName,
        description,
        allowAmountOverride ? 1 : 0,
        defaultAmount,
      ],
    );

    return res.status(201).json({
      success: true,

      code: "FINANCE_TRANSACTION_TYPE_CREATED",

      message: "Finance transaction type created successfully.",

      transaction_type: {
        transaction_type_id: Number(result.insertId),

        transaction_code: normalizedCode,

        transaction_name: transactionName,

        description,

        requires_grade_reference: false,

        workflow_type: "FINANCE_ONLY",

        allow_manual_creation: true,

        allow_amount_override: allowAmountOverride,

        default_amount: defaultAmount,

        is_active: true,
      },
    });
  } catch (error) {
    console.error("CREATE FINANCE TRANSACTION TYPE ERROR:", error);

    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,

        code: "TRANSACTION_CODE_EXISTS",

        message: "A Finance transaction type with that code already exists.",
      });
    }

    return res.status(500).json({
      success: false,

      code: "FINANCE_TRANSACTION_TYPE_CREATE_FAILED",

      message: "Failed to create the Finance transaction type.",
    });
  }
});
// ============================================================
// UPDATE DEFAULT TRANSACTION AMOUNT
//
// PATCH
// /api/finance/tickets/transaction-types/:transactionCode/amount
//
// Example body:
// {
//   "default_amount": 100
// }
// ============================================================

router.patch("/transaction-types/:transactionCode/amount", async (req, res) => {
  const financeUserId = getFinanceUserId(req, res);

  if (!financeUserId) {
    return;
  }

  const transactionCode = String(req.params.transactionCode || "")
    .trim()
    .toUpperCase();

  if (!transactionCode) {
    return res.status(400).json({
      success: false,

      code: "TRANSACTION_CODE_REQUIRED",

      message: "Transaction code is required.",
    });
  }

  const defaultAmount = toMoney(req.body?.default_amount);

  if (defaultAmount === null || defaultAmount <= 0) {
    return res.status(400).json({
      success: false,

      code: "INVALID_DEFAULT_AMOUNT",

      message: "Default amount must be greater than zero.",
    });
  }

  try {
    const [rows] = await db.execute(
      `
          SELECT
            transaction_type_id,
            transaction_code,
            transaction_name,
            is_active

          FROM finance_transaction_types

          WHERE transaction_code = ?

          LIMIT 1
        `,
      [transactionCode],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,

        code: "FINANCE_TRANSACTION_TYPE_NOT_FOUND",

        message: "Finance transaction type was not found.",
      });
    }

    const transactionType = rows[0];

    if (!Boolean(transactionType.is_active)) {
      return res.status(409).json({
        success: false,

        code: "FINANCE_TRANSACTION_TYPE_INACTIVE",

        message: "Inactive transaction types cannot be updated.",
      });
    }

    await db.execute(
      `
          UPDATE finance_transaction_types

          SET default_amount = ?

          WHERE transaction_type_id = ?
        `,
      [defaultAmount, Number(transactionType.transaction_type_id)],
    );

    return res.status(200).json({
      success: true,

      code: "FINANCE_DEFAULT_AMOUNT_UPDATED",

      message: `${transactionType.transaction_name} default amount updated successfully.`,

      transaction_type: {
        transaction_type_id: Number(transactionType.transaction_type_id),

        transaction_code: transactionType.transaction_code,

        transaction_name: transactionType.transaction_name,

        default_amount: defaultAmount,
      },
    });
  } catch (error) {
    console.error("UPDATE FINANCE DEFAULT AMOUNT ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "FINANCE_DEFAULT_AMOUNT_UPDATE_FAILED",

      message: "Failed to update the Finance default amount.",
    });
  }
});

// ============================================================
// SEARCH STUDENTS FOR FINANCE
//
// GET /api/finance/tickets/students?q=christine
// GET /api/finance/tickets/students?q=26BSIT
//
// Used by Finance when assigning a manual student transaction.
// ============================================================

router.get("/students", async (req, res) => {
  const financeUserId = getFinanceUserId(req, res);

  if (!financeUserId) {
    return;
  }

  const query = typeof req.query?.q === "string" ? req.query.q.trim() : "";

  if (query.length < 2) {
    return res.status(200).json({
      success: true,
      code: "FINANCE_STUDENT_SEARCH_RESULTS",
      query: query || null,
      count: 0,
      students: [],
    });
  }

  const likeQuery = `%${query}%`;

  try {
    const [rows] = await db.execute(
      `
        SELECT
          student_id,
          student_number,
          first_name,
          middle_name,
          last_name

        FROM students

        WHERE
          student_number LIKE ?

          OR CONCAT_WS(
            ' ',
            first_name,
            NULLIF(middle_name, ''),
            last_name
          ) LIKE ?

          OR first_name LIKE ?

          OR middle_name LIKE ?

          OR last_name LIKE ?

        ORDER BY
          student_number ASC,
          last_name ASC,
          first_name ASC

        LIMIT 20
      `,
      [likeQuery, likeQuery, likeQuery, likeQuery, likeQuery],
    );

    const students = rows.map((student) => ({
      student_id: Number(student.student_id),

      student_number: student.student_number,

      student_name: [student.first_name, student.middle_name, student.last_name]
        .filter(Boolean)
        .join(" "),
    }));

    return res.status(200).json({
      success: true,

      code: "FINANCE_STUDENT_SEARCH_RESULTS",

      query,

      count: students.length,

      students,
    });
  } catch (error) {
    console.error("FINANCE STUDENT SEARCH ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "FINANCE_STUDENT_SEARCH_FAILED",

      message: "Failed to search students.",
    });
  }
});

// ============================================================
// FINANCE REPORT SUMMARY
//
// GET /api/finance/tickets/reports/summary
//
// Provides aggregate Finance information without relying on
// the 50-ticket limit used by the normal transaction queue.
// ============================================================

router.get("/reports/summary", async (req, res) => {
  const financeUserId = getFinanceUserId(req, res);

  if (!financeUserId) {
    return;
  }

  try {
    // --------------------------------------------------------
    // 1. Overall Finance summary
    // --------------------------------------------------------

    const [summaryRows] = await db.execute(`
      SELECT
        COUNT(*) AS total_tickets,

        SUM(
          CASE
            WHEN payment_status = 'Pending Payment'
            THEN 1
            ELSE 0
          END
        ) AS pending_tickets,

        SUM(
          CASE
            WHEN payment_status = 'Paid'
            THEN 1
            ELSE 0
          END
        ) AS paid_tickets,

        SUM(
          CASE
            WHEN payment_status = 'Cancelled'
            THEN 1
            ELSE 0
          END
        ) AS cancelled_tickets,

        SUM(
          CASE
            WHEN payment_status = 'Refunded'
            THEN 1
            ELSE 0
          END
        ) AS refunded_tickets,

        COALESCE(
          SUM(
            CASE
              WHEN payment_status = 'Paid'
              THEN amount_paid
              ELSE 0
            END
          ),
          0
        ) AS total_collected,

        COALESCE(
          SUM(
            CASE
              WHEN payment_status = 'Paid'
               AND DATE(paid_at) = CURDATE()
              THEN amount_paid
              ELSE 0
            END
          ),
          0
        ) AS collected_today,

        COALESCE(
          SUM(
            CASE
              WHEN payment_status = 'Paid'
               AND YEAR(paid_at) = YEAR(CURDATE())
               AND MONTH(paid_at) = MONTH(CURDATE())
              THEN amount_paid
              ELSE 0
            END
          ),
          0
        ) AS collected_this_month

      FROM finance_tickets
    `);

    const rawSummary = summaryRows[0];

    // --------------------------------------------------------
    // 2. Breakdown by transaction type
    // --------------------------------------------------------

    const [transactionRows] = await db.execute(`
      SELECT
        ftt.transaction_type_id,
        ftt.transaction_code,
        ftt.transaction_name,
        ftt.workflow_type,

        COUNT(ft.ticket_id) AS total_tickets,

        SUM(
          CASE
            WHEN ft.payment_status = 'Paid'
            THEN 1
            ELSE 0
          END
        ) AS paid_tickets,

        SUM(
          CASE
            WHEN ft.payment_status = 'Pending Payment'
            THEN 1
            ELSE 0
          END
        ) AS pending_tickets,

        COALESCE(
          SUM(
            CASE
              WHEN ft.payment_status = 'Paid'
              THEN ft.amount_paid
              ELSE 0
            END
          ),
          0
        ) AS total_collected

      FROM finance_transaction_types ftt

      LEFT JOIN finance_tickets ft
        ON ft.transaction_type_id =
           ftt.transaction_type_id

      GROUP BY
        ftt.transaction_type_id,
        ftt.transaction_code,
        ftt.transaction_name,
        ftt.workflow_type

      ORDER BY
        total_collected DESC,
        ftt.transaction_name ASC
    `);

    // --------------------------------------------------------
    // 3. Breakdown by payment method
    // --------------------------------------------------------

    const [paymentMethodRows] = await db.execute(`
      SELECT
        payment_method,

        COUNT(*) AS payment_count,

        COALESCE(
          SUM(amount_paid),
          0
        ) AS total_collected

      FROM finance_tickets

      WHERE payment_status = 'Paid'
        AND payment_method IS NOT NULL

      GROUP BY payment_method

      ORDER BY total_collected DESC
    `);

    // --------------------------------------------------------
    // 4. Collections for the latest 30 calendar days
    // --------------------------------------------------------

    const [dailyRows] = await db.execute(`
      SELECT
        DATE(paid_at) AS payment_date,

        COUNT(*) AS payment_count,

        COALESCE(
          SUM(amount_paid),
          0
        ) AS total_collected

      FROM finance_tickets

      WHERE payment_status = 'Paid'
        AND paid_at IS NOT NULL
        AND paid_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)

      GROUP BY DATE(paid_at)

      ORDER BY payment_date ASC
    `);

    const summary = {
      total_tickets: Number(rawSummary?.total_tickets ?? 0),

      pending_tickets: Number(rawSummary?.pending_tickets ?? 0),

      paid_tickets: Number(rawSummary?.paid_tickets ?? 0),

      cancelled_tickets: Number(rawSummary?.cancelled_tickets ?? 0),

      refunded_tickets: Number(rawSummary?.refunded_tickets ?? 0),

      total_collected: Number(rawSummary?.total_collected ?? 0),

      collected_today: Number(rawSummary?.collected_today ?? 0),

      collected_this_month: Number(rawSummary?.collected_this_month ?? 0),
    };

    const byTransaction = transactionRows.map((row) => ({
      transaction_type_id: Number(row.transaction_type_id),

      transaction_code: row.transaction_code,

      transaction_name: row.transaction_name,

      workflow_type: row.workflow_type,

      total_tickets: Number(row.total_tickets ?? 0),

      paid_tickets: Number(row.paid_tickets ?? 0),

      pending_tickets: Number(row.pending_tickets ?? 0),

      total_collected: Number(row.total_collected ?? 0),
    }));

    const byPaymentMethod = paymentMethodRows.map((row) => ({
      payment_method: row.payment_method,

      payment_count: Number(row.payment_count ?? 0),

      total_collected: Number(row.total_collected ?? 0),
    }));

    const dailyCollections = dailyRows.map((row) => ({
      payment_date: row.payment_date,

      payment_count: Number(row.payment_count ?? 0),

      total_collected: Number(row.total_collected ?? 0),
    }));

    return res.status(200).json({
      success: true,

      code: "FINANCE_REPORT_SUMMARY_RETRIEVED",

      generated_at: new Date().toISOString(),

      summary,

      by_transaction: byTransaction,

      by_payment_method: byPaymentMethod,

      daily_collections: dailyCollections,
    });
  } catch (error) {
    console.error("FINANCE REPORT SUMMARY ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "FINANCE_REPORT_SUMMARY_FAILED",

      message: "Failed to generate the Finance report summary.",
    });
  }
});

// ============================================================
// FINANCE PAYMENT HISTORY
//
// GET /api/finance/tickets/payment-history
//
// Examples:
//
// /payment-history
// /payment-history?page=1&limit=25
// /payment-history?q=christine
// /payment-history?payment_method=Cash
// /payment-history?transaction_code=COR
//
// IMPORTANT:
// - Returns only PAID Finance tickets.
// - Does not use the Transaction Queue LIMIT 50.
// - Supports pagination for long-term payment history.
// ============================================================

router.get("/payment-history", async (req, res) => {
  const financeUserId = getFinanceUserId(req, res);

  if (!financeUserId) {
    return;
  }

  // ==========================================================
  // 1. PAGINATION
  // ==========================================================

  const requestedPage = Number(req.query?.page);
  const requestedLimit = Number(req.query?.limit);

  const page =
    Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const limit =
    Number.isInteger(requestedLimit) &&
    requestedLimit > 0 &&
    requestedLimit <= 100
      ? requestedLimit
      : 25;

  const offset = (page - 1) * limit;

  // ==========================================================
  // 2. FILTERS
  // ==========================================================

  const query = typeof req.query?.q === "string" ? req.query.q.trim() : "";

  const paymentMethod =
    typeof req.query?.payment_method === "string"
      ? req.query.payment_method.trim()
      : "";

  const transactionCode =
    typeof req.query?.transaction_code === "string"
      ? req.query.transaction_code.trim().toUpperCase()
      : "";

  if (paymentMethod && !ALLOWED_PAYMENT_METHODS.has(paymentMethod)) {
    return res.status(400).json({
      success: false,

      code: "INVALID_PAYMENT_METHOD_FILTER",

      message: "Payment method filter must be Cash, GCash, Bank, or Online.",
    });
  }

  try {
    // ========================================================
    // 3. BUILD WHERE CLAUSE
    // ========================================================

    const whereParts = ["ft.payment_status = 'Paid'"];

    const params = [];

    if (query) {
      const likeQuery = `%${query}%`;

      whereParts.push(`
        (
          ft.ticket_number LIKE ?
          OR ft.receipt_number LIKE ?
          OR sdr.request_number LIKE ?
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
      `);

      params.push(
        likeQuery,
        likeQuery,
        likeQuery,
        likeQuery,
        likeQuery,
        likeQuery,
        likeQuery,
      );
    }

    if (paymentMethod) {
      whereParts.push("ft.payment_method = ?");

      params.push(paymentMethod);
    }

    if (transactionCode) {
      whereParts.push("ftt.transaction_code = ?");

      params.push(transactionCode);
    }

    const whereClause = `WHERE ${whereParts.join(" AND ")}`;

    // ========================================================
    // 4. COUNT ALL MATCHING PAID TICKETS
    //
    // This is separate from pagination so Finance knows the
    // true number of payment-history records.
    // ========================================================

    const [countRows] = await db.execute(
      `
        SELECT
          COUNT(*) AS total_records

        FROM finance_tickets ft

        INNER JOIN students s
          ON s.student_id = ft.student_id

        INNER JOIN finance_transaction_types ftt
          ON ftt.transaction_type_id =
             ft.transaction_type_id

        LEFT JOIN student_document_requests sdr
          ON sdr.request_id =
             ft.document_request_id

        ${whereClause}
      `,
      params,
    );

    const totalRecords = Number(countRows[0]?.total_records ?? 0);

    const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / limit);

    // ========================================================
    // 5. LOAD CURRENT PAGE
    // ========================================================

    const [rows] = await db.execute(
      `
        SELECT
          ft.ticket_id,
          ft.ticket_number,

          ft.student_id,
          s.student_number,

          CONCAT_WS(
            ' ',
            s.first_name,
            NULLIF(s.middle_name, ''),
            s.last_name
          ) AS student_name,

          ftt.transaction_type_id,
          ftt.transaction_code,
          ftt.transaction_name,
          ftt.workflow_type,

          ft.source_type,

          ft.document_request_id,

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
          sdr.cancelled_at,
          sdr.cancellation_reason,

          ft.grade_id,

          ft.amount_due,
          ft.amount_paid,

          ft.payment_method,
          ft.receipt_number,
          ft.payment_status,

          ft.finance_remarks,

          ft.paid_by,
          ft.paid_at,

          ft.registrar_status,
          ft.registrar_remarks,
          ft.registrar_processed_by,
          ft.registrar_started_at,
          ft.registrar_completed_at,

          ft.created_at,
          ft.updated_at

        FROM finance_tickets ft

        INNER JOIN students s
          ON s.student_id =
             ft.student_id

        INNER JOIN finance_transaction_types ftt
          ON ftt.transaction_type_id =
             ft.transaction_type_id

        LEFT JOIN student_document_requests sdr
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

        ${whereClause}

        ORDER BY
          ft.paid_at DESC,
          ft.ticket_id DESC

        LIMIT ${limit}
        OFFSET ${offset}
      `,
      params,
    );

    // ========================================================
    // 6. MAP RESPONSE
    // ========================================================

    const tickets = rows.map((ticket) => ({
      ticket_id: Number(ticket.ticket_id),

      ticket_number: ticket.ticket_number,

      source_type: ticket.source_type,

      student: {
        student_id: Number(ticket.student_id),

        student_number: ticket.student_number,

        student_name: ticket.student_name,
      },

      transaction: {
        transaction_type_id: Number(ticket.transaction_type_id),

        transaction_code: ticket.transaction_code,

        transaction_name: ticket.transaction_name,

        workflow_type: ticket.workflow_type,
      },

      document_request:
        ticket.document_request_id !== null
          ? {
              request_id: Number(ticket.document_request_id),

              request_number: ticket.request_number,

              document_type: ticket.document_type,

              enrollment_id:
                ticket.enrollment_id === null ||
                ticket.enrollment_id === undefined
                  ? null
                  : Number(ticket.enrollment_id),

              academic_period:
                ticket.enrollment_id === null ||
                ticket.enrollment_id === undefined
                  ? null
                  : {
                      academic_year_id:
                        ticket.academic_year_id === null ||
                        ticket.academic_year_id === undefined
                          ? null
                          : Number(ticket.academic_year_id),

                      academic_year: ticket.academic_year || null,

                      semester_id:
                        ticket.semester_id === null ||
                        ticket.semester_id === undefined
                          ? null
                          : Number(ticket.semester_id),

                      semester_name: ticket.semester_name || null,

                      enrollment_status: ticket.enrollment_status || null,
                    },

              purpose: ticket.purpose,

              copies: Number(ticket.copies ?? 1),

              requested_at: ticket.requested_at,

              cancelled_at: ticket.cancelled_at,

              cancellation_reason: ticket.cancellation_reason,
            }
          : null,

      grade_id:
        ticket.grade_id === null || ticket.grade_id === undefined
          ? null
          : Number(ticket.grade_id),

      payment: {
        amount_due:
          ticket.amount_due === null ? null : Number(ticket.amount_due),

        amount_paid: Number(ticket.amount_paid ?? 0),

        payment_method: ticket.payment_method,

        receipt_number: ticket.receipt_number,

        payment_status: ticket.payment_status,

        finance_remarks: ticket.finance_remarks,

        paid_by:
          ticket.paid_by === null || ticket.paid_by === undefined
            ? null
            : Number(ticket.paid_by),

        paid_at: ticket.paid_at,
      },

      registrar: {
        status: ticket.registrar_status,

        remarks: ticket.registrar_remarks,

        processed_by:
          ticket.registrar_processed_by === null ||
          ticket.registrar_processed_by === undefined
            ? null
            : Number(ticket.registrar_processed_by),

        started_at: ticket.registrar_started_at,

        completed_at: ticket.registrar_completed_at,
      },

      created_at: ticket.created_at,

      updated_at: ticket.updated_at,
    }));

    // ========================================================
    // 7. RESPONSE
    // ========================================================

    return res.status(200).json({
      success: true,

      code: "FINANCE_PAYMENT_HISTORY_RETRIEVED",

      query: query || null,

      filters: {
        payment_method: paymentMethod || null,

        transaction_code: transactionCode || null,
      },

      pagination: {
        page,

        limit,

        total_records: totalRecords,

        total_pages: totalPages,

        has_previous_page: page > 1,

        has_next_page: page < totalPages,
      },

      count: tickets.length,

      tickets,
    });
  } catch (error) {
    console.error("FINANCE PAYMENT HISTORY ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "FINANCE_PAYMENT_HISTORY_FAILED",

      message: "Failed to load Finance payment history.",
    });
  }
});

// ============================================================
// CREATE MANUAL STUDENT FINANCE TRANSACTION
//
// POST /api/finance/tickets/manual
//
// Only FINANCE_ONLY transaction types with
// allow_manual_creation = 1 can be used here.
//
// Example body:
// {
//   "student_id": 126,
//   "transaction_code": "PROCESS_FEE",
//   "remarks": "General processing fee"
// }
//
// amount_due is optional.
// If omitted, the transaction type default_amount is used.
// ============================================================

router.post("/manual", async (req, res) => {
  const financeUserId = getFinanceUserId(req, res);

  if (!financeUserId) {
    return;
  }

  const studentId = Number(req.body?.student_id);

  if (!Number.isInteger(studentId) || studentId <= 0) {
    return res.status(400).json({
      success: false,
      code: "INVALID_STUDENT_ID",
      message: "A valid student ID is required.",
    });
  }

  const transactionCode = String(req.body?.transaction_code || "")
    .trim()
    .toUpperCase();

  if (!transactionCode) {
    return res.status(400).json({
      success: false,
      code: "TRANSACTION_CODE_REQUIRED",
      message: "Transaction code is required.",
    });
  }

  const requestedAmount =
    req.body?.amount_due === undefined ||
    req.body?.amount_due === null ||
    req.body?.amount_due === ""
      ? null
      : toMoney(req.body.amount_due);

  if (
    req.body?.amount_due !== undefined &&
    req.body?.amount_due !== null &&
    req.body?.amount_due !== "" &&
    (requestedAmount === null || requestedAmount <= 0)
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_AMOUNT_DUE",
      message: "Amount due must be greater than zero.",
    });
  }

  const financeRemarks = cleanOptionalText(req.body?.remarks, 500);

  let connection;
  let transactionActive = false;

  try {
    connection = await db.getConnection();

    await connection.beginTransaction();
    transactionActive = true;

    // --------------------------------------------------------
    // 1. Verify student
    // --------------------------------------------------------

    const [studentRows] = await connection.execute(
      `
        SELECT
          student_id,
          student_number,
          first_name,
          middle_name,
          last_name

        FROM students

        WHERE student_id = ?

        LIMIT 1
      `,
      [studentId],
    );

    if (studentRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(404).json({
        success: false,
        code: "STUDENT_NOT_FOUND",
        message: "Student was not found.",
      });
    }

    const student = studentRows[0];

    // --------------------------------------------------------
    // 2. Verify transaction type
    // --------------------------------------------------------

    const [typeRows] = await connection.execute(
      `
        SELECT
          transaction_type_id,
          transaction_code,
          transaction_name,
          description,

          workflow_type,
          allow_manual_creation,
          allow_amount_override,

          default_amount,
          is_active

        FROM finance_transaction_types

        WHERE transaction_code = ?

        LIMIT 1
      `,
      [transactionCode],
    );

    if (typeRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(404).json({
        success: false,
        code: "FINANCE_TRANSACTION_TYPE_NOT_FOUND",
        message: "Finance transaction type was not found.",
      });
    }

    const transactionType = typeRows[0];

    if (!Boolean(transactionType.is_active)) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,
        code: "FINANCE_TRANSACTION_TYPE_INACTIVE",
        message: "This Finance transaction type is inactive.",
      });
    }

    if (
      transactionType.workflow_type !== "FINANCE_ONLY" ||
      !Boolean(transactionType.allow_manual_creation)
    ) {
      await connection.rollback();
      transactionActive = false;

      return res.status(403).json({
        success: false,
        code: "MANUAL_TRANSACTION_NOT_ALLOWED",
        message:
          "This transaction type cannot be manually assigned by Finance.",
      });
    }

    // --------------------------------------------------------
    // 3. Determine amount due
    // --------------------------------------------------------

    const defaultAmount =
      transactionType.default_amount === null
        ? null
        : Number(transactionType.default_amount);

    let finalAmountDue = defaultAmount;

    if (requestedAmount !== null) {
      if (!Boolean(transactionType.allow_amount_override)) {
        if (
          defaultAmount !== null &&
          !moneyEquals(defaultAmount, requestedAmount)
        ) {
          await connection.rollback();
          transactionActive = false;

          return res.status(409).json({
            success: false,
            code: "AMOUNT_OVERRIDE_NOT_ALLOWED",
            message:
              "This transaction uses its configured default amount and cannot be overridden.",
            default_amount: defaultAmount,
          });
        }
      } else {
        finalAmountDue = requestedAmount;
      }
    }

    if (finalAmountDue === null || finalAmountDue <= 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(400).json({
        success: false,
        code: "AMOUNT_DUE_REQUIRED",
        message:
          "This transaction type has no default amount. Finance must provide an amount due.",
      });
    }

    // --------------------------------------------------------
    // 4. Create ticket
    //
    // Temporary ticket number is used because ticket_number
    // is NOT NULL + UNIQUE before insertId is available.
    // --------------------------------------------------------

    const [insertResult] = await connection.execute(
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

          finance_remarks,

          created_by
        )

        VALUES (
          CONCAT('TMP-', UUID()),

          ?,
          ?,

          NULL,
          NULL,

          'FINANCE_MANUAL',

          ?,
          0.00,

          'Pending Payment',
          'Not Applicable',

          ?,

          ?
        )
      `,
      [
        studentId,
        Number(transactionType.transaction_type_id),
        finalAmountDue,
        financeRemarks,
        financeUserId,
      ],
    );

    const ticketId = Number(insertResult.insertId);

    const year = new Date().getFullYear();

    const ticketNumber = `FIN-${transactionType.transaction_code}-${year}-${String(
      ticketId,
    ).padStart(6, "0")}`;

    await connection.execute(
      `
        UPDATE finance_tickets

        SET ticket_number = ?

        WHERE ticket_id = ?
      `,
      [ticketNumber, ticketId],
    );

    await connection.commit();
    transactionActive = false;

    const studentName = [
      student.first_name,
      student.middle_name,
      student.last_name,
    ]
      .filter(Boolean)
      .join(" ");

    return res.status(201).json({
      success: true,

      code: "FINANCE_MANUAL_TRANSACTION_CREATED",

      message: "Student Finance transaction created successfully.",

      ticket: {
        ticket_id: ticketId,

        ticket_number: ticketNumber,

        source_type: "FINANCE_MANUAL",

        student: {
          student_id: Number(student.student_id),
          student_number: student.student_number,
          student_name: studentName,
        },

        transaction: {
          transaction_type_id: Number(transactionType.transaction_type_id),

          transaction_code: transactionType.transaction_code,

          transaction_name: transactionType.transaction_name,

          workflow_type: transactionType.workflow_type,
        },

        payment: {
          amount_due: finalAmountDue,
          amount_paid: 0,
          payment_status: "Pending Payment",
        },

        registrar: {
          status: "Not Applicable",
        },

        remarks: financeRemarks,
      },
    });
  } catch (error) {
    if (connection && transactionActive) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "MANUAL FINANCE TRANSACTION ROLLBACK ERROR:",
          rollbackError,
        );
      }
    }

    console.error("CREATE MANUAL FINANCE TRANSACTION ERROR:", error);

    return res.status(500).json({
      success: false,
      code: "FINANCE_MANUAL_TRANSACTION_CREATE_FAILED",
      message: "Failed to create the student Finance transaction.",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});
router.patch("/:ticketNumber/pay", async (req, res) => {
  const financeUserId = getFinanceUserId(req, res);

  if (!financeUserId) {
    return;
  }

  const ticketNumber = cleanTicketNumber(req.params.ticketNumber);

  if (!ticketNumber) {
    return res.status(400).json({
      success: false,
      code: "TICKET_NUMBER_REQUIRED",
      message: "Ticket number is required.",
    });
  }

  // ==========================================================
  // PAYMENT METHOD
  // ==========================================================

  const paymentMethod = cleanRequiredText(req.body?.payment_method, 30);

  if (!paymentMethod || !ALLOWED_PAYMENT_METHODS.has(paymentMethod)) {
    return res.status(400).json({
      success: false,
      code: "INVALID_PAYMENT_METHOD",
      message: "Payment method must be Cash, GCash, Bank, or Online.",
    });
  }

  // ==========================================================
  // RECEIPT NUMBER
  // ==========================================================

  const receiptNumber = cleanRequiredText(req.body?.receipt_number, 50);

  if (!receiptNumber) {
    return res.status(400).json({
      success: false,
      code: "RECEIPT_NUMBER_REQUIRED",
      message: "Receipt number is required.",
    });
  }

  // ==========================================================
  // AMOUNT PAID
  // ==========================================================

  const amountPaid = toMoney(req.body?.amount_paid);

  if (amountPaid === null || amountPaid <= 0) {
    return res.status(400).json({
      success: false,
      code: "INVALID_AMOUNT_PAID",
      message: "Amount paid must be greater than zero.",
    });
  }

  // ==========================================================
  // OPTIONAL AMOUNT DUE
  // ==========================================================

  const requestedAmountDue =
    req.body?.amount_due === undefined ? null : toMoney(req.body.amount_due);

  if (
    req.body?.amount_due !== undefined &&
    (requestedAmountDue === null || requestedAmountDue <= 0)
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_AMOUNT_DUE",
      message: "Amount due must be greater than zero.",
    });
  }

  const financeRemarks = cleanOptionalText(req.body?.remarks, 500);

  let connection;
  let transactionActive = false;

  try {
    // ========================================================
    // 1. START DATABASE TRANSACTION
    // ========================================================

    connection = await db.getConnection();

    await connection.beginTransaction();

    transactionActive = true;

    // ========================================================
    // 2. LOCK TICKET
    // ========================================================

    const [ticketRows] = await connection.execute(
      `
          SELECT
            ft.ticket_id,
            ft.ticket_number,

            ft.student_id,

            ft.transaction_type_id,

            ftt.transaction_code,
            ftt.transaction_name,
            ftt.workflow_type,

            ft.source_type,

            ft.document_request_id,
            ft.grade_id,

            ft.amount_due,
            ft.amount_paid,

            ft.payment_method,
            ft.receipt_number,

            ft.payment_status,
            ft.registrar_status,

            s.student_number,

            CONCAT_WS(
              ' ',
              s.first_name,
              NULLIF(s.middle_name, ''),
              s.last_name
            ) AS student_name,

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
            sdr.cancelled_at

          FROM finance_tickets ft

          INNER JOIN students s
            ON s.student_id =
               ft.student_id

          INNER JOIN finance_transaction_types ftt
            ON ftt.transaction_type_id =
               ft.transaction_type_id

          LEFT JOIN student_document_requests sdr
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

          WHERE ft.ticket_number = ?

          LIMIT 1

          FOR UPDATE
        `,
      [ticketNumber],
    );

    if (ticketRows.length === 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(404).json({
        success: false,
        code: "FINANCE_TICKET_NOT_FOUND",
        message: "Finance ticket was not found.",
      });
    }

    const ticket = ticketRows[0];

    // ========================================================
    // 3. CHECK DOCUMENT REQUEST CANCELLATION
    // ========================================================

    if (ticket.document_request_id !== null && ticket.cancelled_at !== null) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,
        code: "DOCUMENT_REQUEST_CANCELLED",
        message:
          "Payment cannot be accepted because this document request has been cancelled.",
      });
    }

    // ========================================================
    // 4. CHECK PAYMENT STATUS
    // ========================================================

    if (ticket.payment_status === "Paid") {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,
        code: "TICKET_ALREADY_PAID",
        message: "This Finance ticket has already been paid.",

        ticket: {
          ticket_number: ticket.ticket_number,

          payment_status: ticket.payment_status,

          registrar_status: ticket.registrar_status,

          amount_due:
            ticket.amount_due === null ? null : Number(ticket.amount_due),

          amount_paid: Number(ticket.amount_paid ?? 0),

          receipt_number: ticket.receipt_number,
        },
      });
    }

    if (
      ticket.payment_status === "Cancelled" ||
      ticket.payment_status === "Refunded"
    ) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,
        code: "TICKET_NOT_PAYABLE",
        message: `This ticket cannot be paid because its payment status is ${ticket.payment_status}.`,
      });
    }

    if (ticket.payment_status !== "Pending Payment") {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,
        code: "INVALID_PAYMENT_STATUS",
        message: "This ticket is not currently waiting for payment.",
      });
    }

    // ========================================================
    // 5. VALIDATE WORKFLOW STATUS
    // ========================================================

    if (ticket.workflow_type === "FINANCE_ONLY") {
      if (ticket.registrar_status !== "Not Applicable") {
        await connection.rollback();

        transactionActive = false;

        return res.status(409).json({
          success: false,
          code: "INVALID_REGISTRAR_STATUS",
          message:
            "Finance-only transactions must have Registrar status Not Applicable.",
        });
      }
    } else {
      if (ticket.registrar_status !== "Pending") {
        await connection.rollback();

        transactionActive = false;

        return res.status(409).json({
          success: false,
          code: "INVALID_REGISTRAR_STATUS",
          message: "The Registrar status is not valid for a new payment.",
        });
      }
    }

    // ========================================================
    // 6. DETERMINE AMOUNT DUE
    // ========================================================

    const currentAmountDue =
      ticket.amount_due === null ? null : Number(ticket.amount_due);

    let finalAmountDue = currentAmountDue;

    if (finalAmountDue === null) {
      if (requestedAmountDue === null || requestedAmountDue <= 0) {
        await connection.rollback();

        transactionActive = false;

        return res.status(400).json({
          success: false,
          code: "AMOUNT_DUE_REQUIRED",
          message:
            "This ticket does not have an amount due yet. Finance must provide amount_due before completing payment.",
        });
      }

      finalAmountDue = requestedAmountDue;
    }

    // ========================================================
    // 7. DO NOT CHANGE EXISTING AMOUNT DUE
    // ========================================================

    if (
      currentAmountDue !== null &&
      requestedAmountDue !== null &&
      !moneyEquals(currentAmountDue, requestedAmountDue)
    ) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,
        code: "AMOUNT_DUE_MISMATCH",
        message:
          "The submitted amount_due does not match the amount already assigned to this ticket.",

        amount_due: currentAmountDue,
      });
    }

    // ========================================================
    // 8. FULL PAYMENT REQUIRED
    // ========================================================

    if (!moneyEquals(amountPaid, finalAmountDue)) {
      await connection.rollback();

      transactionActive = false;

      return res.status(400).json({
        success: false,
        code: "FULL_PAYMENT_REQUIRED",
        message:
          "Amount paid must exactly match the amount due before the ticket can be marked Paid.",

        amount_due: finalAmountDue,

        amount_paid: amountPaid,
      });
    }

    // ========================================================
    // 9. DETERMINE NEXT REGISTRAR STATUS
    // ========================================================

    const nextRegistrarStatus =
      ticket.workflow_type === "FINANCE_ONLY"
        ? "Not Applicable"
        : "Ready for Processing";

    // ========================================================
    // 10. MARK PAYMENT AS PAID
    // ========================================================

    await connection.execute(
      `
        UPDATE finance_tickets

        SET
          amount_due = ?,
          amount_paid = ?,

          payment_method = ?,
          receipt_number = ?,

          payment_status = 'Paid',

          registrar_status = ?,

          finance_remarks = ?,

          paid_by = ?,
          paid_at = NOW()

        WHERE ticket_id = ?
      `,
      [
        finalAmountDue,
        amountPaid,
        paymentMethod,
        receiptNumber,
        nextRegistrarStatus,
        financeRemarks,
        financeUserId,
        Number(ticket.ticket_id),
      ],
    );

    // ========================================================
    // 11. COMMIT
    // ========================================================

    await connection.commit();

    transactionActive = false;

    // ========================================================
    // 12. SUCCESS RESPONSE
    // ========================================================

    return res.status(200).json({
      success: true,

      code: "FINANCE_TICKET_PAID",

      message:
        ticket.workflow_type === "FINANCE_ONLY"
          ? "Payment completed successfully."
          : "Payment completed successfully. The request is now ready for Registrar processing.",

      ticket: {
        ticket_id: Number(ticket.ticket_id),

        ticket_number: ticket.ticket_number,

        source_type: ticket.source_type,

        student: {
          student_id: Number(ticket.student_id),

          student_number: ticket.student_number,

          student_name: ticket.student_name,
        },

        transaction: {
          transaction_code: ticket.transaction_code,

          transaction_name: ticket.transaction_name,

          workflow_type: ticket.workflow_type,
        },

        document_request:
          ticket.document_request_id !== null
            ? {
                request_id: Number(ticket.document_request_id),

                request_number: ticket.request_number,

                document_type: ticket.document_type,

                enrollment_id:
                  ticket.enrollment_id === null ||
                  ticket.enrollment_id === undefined
                    ? null
                    : Number(ticket.enrollment_id),

                academic_period:
                  ticket.enrollment_id === null ||
                  ticket.enrollment_id === undefined
                    ? null
                    : {
                        academic_year_id:
                          ticket.academic_year_id === null ||
                          ticket.academic_year_id === undefined
                            ? null
                            : Number(ticket.academic_year_id),

                        academic_year: ticket.academic_year || null,

                        semester_id:
                          ticket.semester_id === null ||
                          ticket.semester_id === undefined
                            ? null
                            : Number(ticket.semester_id),

                        semester_name: ticket.semester_name || null,

                        enrollment_status: ticket.enrollment_status || null,
                      },

                purpose: ticket.purpose,

                copies: Number(ticket.copies ?? 1),

                requested_at: ticket.requested_at,
              }
            : null,

        payment: {
          amount_due: finalAmountDue,

          amount_paid: amountPaid,

          payment_method: paymentMethod,

          receipt_number: receiptNumber,

          payment_status: "Paid",

          paid_by: financeUserId,
        },

        registrar: {
          status: nextRegistrarStatus,
        },
      },
    });
  } catch (error) {
    if (connection && transactionActive) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("FINANCE PAYMENT ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("FINANCE PAYMENT ERROR:", error);

    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,

        code: "DUPLICATE_RECEIPT_NUMBER",

        message:
          "That receipt number is already connected to another Finance transaction.",
      });
    }

    return res.status(500).json({
      success: false,

      code: "FINANCE_PAYMENT_FAILED",

      message: "Failed to complete the Finance payment.",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

export default router;
