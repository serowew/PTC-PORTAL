// server/routes/finance/index.js

import express from "express";
import db from "../../db.js";

import ticketsRouter from "./tickets.js";

const router = express.Router();

// =====================================================
// FINANCE DASHBOARD SUMMARY
//
// GET /api/finance/dashboard
//
// Returns:
// - Pending tickets waiting for payment
// - Payments completed today
// - Paid tickets forwarded to Registrar
// =====================================================

router.get("/dashboard", async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT

        -- Tickets still waiting for payment
        SUM(
          CASE
            WHEN payment_status = 'Pending Payment'
            THEN 1
            ELSE 0
          END
        ) AS pending_tickets,

        -- Payments successfully completed today
        SUM(
          CASE
            WHEN payment_status = 'Paid'
             AND DATE(paid_at) = CURDATE()
            THEN 1
            ELSE 0
          END
        ) AS completed_today,

        -- Paid tickets already forwarded to Registrar
        -- but not yet fully completed
        SUM(
          CASE
            WHEN payment_status = 'Paid'
             AND registrar_status IN (
               'Ready for Processing',
               'Processing'
             )
            THEN 1
            ELSE 0
          END
        ) AS waiting_for_registrar

      FROM finance_tickets
    `);

    const summary = rows[0] || {};

    return res.status(200).json({
      success: true,

      code: "FINANCE_DASHBOARD_RETRIEVED",

      message: "Finance workspace is ready.",

      summary: {
        pending_tickets: Number(summary.pending_tickets ?? 0),

        completed_today: Number(summary.completed_today ?? 0),

        waiting_for_registrar: Number(summary.waiting_for_registrar ?? 0),
      },
    });
  } catch (error) {
    console.error("FINANCE DASHBOARD ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "FINANCE_DASHBOARD_FAILED",

      message: "Failed to load the Finance dashboard.",
    });
  }
});

// =====================================================
// FINANCE TICKET ROUTES
//
// Base URL:
// /api/finance/tickets
// =====================================================

router.use("/tickets", ticketsRouter);

export default router;
