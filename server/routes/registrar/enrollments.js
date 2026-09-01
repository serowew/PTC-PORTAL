// routes/registrar/enrollments.js

import express from "express";
import db from "../../db.js";

import {
  ELIGIBILITY_TYPE,
  evaluateSubjectEligibility,
  getCarryOverCandidates,
} from "../../services/academicEvaluation.service.js";

const router = express.Router();

// =====================================================
// HELPERS
// =====================================================

function toPositiveInt(value) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    return null;
  }

  return number;
}

// =====================================================
// GET REGISTRAR ACTOR FROM JWT
// =====================================================

function getRegistrarActor(req, res) {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: "Authentication is required.",
    });

    return null;
  }

  if (req.user.role_name !== "Registrar") {
    res.status(403).json({
      success: false,
      message: "Registrar access is required.",
    });

    return null;
  }

  const userId = toPositiveInt(req.user.user_id);

  if (!userId) {
    res.status(401).json({
      success: false,
      message: "Authenticated Registrar user ID is invalid.",
    });

    return null;
  }

  return {
    user_id: userId,
    username: req.user.username || null,
  };
}

// =====================================================
// STUDENT SCHEDULE CONFLICT HELPERS
// =====================================================
//
// These helpers intentionally follow the same schedule
// parsing rules used by Registrar Class Offerings.
//
// Adjacent schedules are allowed:
//
// 8:00 AM - 10:00 AM
// 10:00 AM - 12:00 PM
//
// These are NOT overlapping.
// =====================================================

const ENROLLMENT_DAY_ALIASES = {
  monday: "Monday",
  mon: "Monday",

  tuesday: "Tuesday",
  tue: "Tuesday",
  tues: "Tuesday",

  wednesday: "Wednesday",
  wed: "Wednesday",

  thursday: "Thursday",
  thu: "Thursday",
  thur: "Thursday",
  thurs: "Thursday",

  friday: "Friday",
  fri: "Friday",

  saturday: "Saturday",
  sat: "Saturday",

  sunday: "Sunday",
  sun: "Sunday",
};

function parseEnrollmentScheduleDays(value) {
  if (!value || typeof value !== "string") {
    return [];
  }

  const rawParts = value
    .split(/[,/;&]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const days = [];

  for (const raw of rawParts) {
    const normalized = raw.toLowerCase().replace(/\./g, "");

    const day = ENROLLMENT_DAY_ALIASES[normalized];

    if (day && !days.includes(day)) {
      days.push(day);
    }
  }

  return days;
}

function parseEnrollmentClockTime(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const text = value.trim().toUpperCase().replace(/\s+/g, " ");

  // =================================================
  // 12-HOUR
  //
  // 8 AM
  // 8:00 AM
  // 10:30 PM
  // =================================================

  let match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);

  if (match) {
    let hour = Number(match[1]);

    const minute = Number(match[2] || 0);

    const meridiem = match[3];

    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
      return null;
    }

    if (meridiem === "AM") {
      if (hour === 12) {
        hour = 0;
      }
    } else if (hour !== 12) {
      hour += 12;
    }

    return hour * 60 + minute;
  }

  // =================================================
  // 24-HOUR
  //
  // 08:00
  // 13:30
  // =================================================

  match = text.match(/^(\d{1,2}):(\d{2})$/);

  if (match) {
    const hour = Number(match[1]);

    const minute = Number(match[2]);

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }

    return hour * 60 + minute;
  }

  // =================================================
  // LEGACY SIMPLE HOUR
  //
  // 8-10
  // =================================================

  match = text.match(/^(\d{1,2})$/);

  if (match) {
    const hour = Number(match[1]);

    if (hour < 0 || hour > 23) {
      return null;
    }

    return hour * 60;
  }

  return null;
}

function parseEnrollmentScheduleTimeRange(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/[–—]/g, "-");

  const parts = normalized.split(/\s*-\s*/);

  if (parts.length !== 2) {
    return null;
  }

  const start = parseEnrollmentClockTime(parts[0]);

  const end = parseEnrollmentClockTime(parts[1]);

  if (start === null || end === null || end <= start) {
    return null;
  }

  return {
    start,
    end,
  };
}

function enrollmentSchedulesOverlap(daysA, timeA, daysB, timeB) {
  const parsedDaysA = parseEnrollmentScheduleDays(daysA);

  const parsedDaysB = parseEnrollmentScheduleDays(daysB);

  const parsedTimeA = parseEnrollmentScheduleTimeRange(timeA);

  const parsedTimeB = parseEnrollmentScheduleTimeRange(timeB);

  if (
    parsedDaysA.length === 0 ||
    parsedDaysB.length === 0 ||
    !parsedTimeA ||
    !parsedTimeB
  ) {
    return {
      overlap: false,
      common_days: [],
    };
  }

  const commonDays = parsedDaysA.filter((day) => parsedDaysB.includes(day));

  if (commonDays.length === 0) {
    return {
      overlap: false,
      common_days: [],
    };
  }

  const timeOverlap =
    parsedTimeA.start < parsedTimeB.end && parsedTimeB.start < parsedTimeA.end;

  return {
    overlap: timeOverlap,

    common_days: timeOverlap ? commonDays : [],
  };
}
// =====================================================
// ROUTE 1
// GET ENROLLMENT PERIOD MANAGEMENT DATA
//
// GET /api/registrar/enrollments/period
//
// Used by:
// Registrar Enrollment Period Management page
//
// Returns:
// - latest supported enrollment period
// - academic years
// - supported semesters
//
// SEMESTER POLICY:
// - First Semester only
// - Second Semester only
// - Summer is intentionally excluded
//
// JWT:
// - Registrar identity comes from req.user
// - No frontend user_id
// =====================================================

router.get("/period", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  let connection;

  try {
    connection = await db.getConnection();

    // ===============================================
    // GET LATEST SUPPORTED ENROLLMENT PERIOD
    //
    // Summer / semester_id = 3 is intentionally
    // excluded from the normal enrollment lifecycle.
    // ===============================================

    const [periodRows] = await connection.execute(
      `
        SELECT
            ep.enrollment_period_id,

            ep.academic_year_id,
            ay.academic_year,

            ep.semester_id,
            sem.semester_name,

            ep.status,

            ep.opened_by,
            opener.username AS opened_by_username,

            ep.opened_at,

            ep.closed_by,
            closer.username AS closed_by_username,

            ep.closed_at,

            ep.remarks,
            ep.created_at,
            ep.updated_at

        FROM enrollment_periods ep

        INNER JOIN academic_years ay
            ON ay.academic_year_id =
               ep.academic_year_id

        INNER JOIN semesters sem
            ON sem.semester_id =
               ep.semester_id

        LEFT JOIN users opener
            ON opener.user_id =
               ep.opened_by

        LEFT JOIN users closer
            ON closer.user_id =
               ep.closed_by

        WHERE ep.semester_id IN (1, 2)

        ORDER BY
            ep.updated_at DESC,
            ep.opened_at DESC,
            ep.enrollment_period_id DESC

        LIMIT 1
      `,
    );

    // ===============================================
    // GET ACADEMIC YEARS
    // ===============================================

    const [academicYearRows] = await connection.execute(
      `
        SELECT
            academic_year_id,
            academic_year,
            is_current

        FROM academic_years

        ORDER BY
            academic_year DESC
      `,
    );

    // ===============================================
    // GET SUPPORTED SEMESTERS
    //
    // IMPORTANT:
    // Summer exists in the database for compatibility
    // / possible historical references, but it is NOT
    // part of this portal's enrollment progression.
    // ===============================================

    const [semesterRows] = await connection.execute(
      `
        SELECT
            semester_id,
            semester_name

        FROM semesters

        WHERE semester_id IN (1, 2)

        ORDER BY
            semester_id ASC
      `,
    );

    // ===============================================
    // FORMAT CURRENT/LATEST PERIOD
    // ===============================================

    let enrollmentPeriod = null;

    if (periodRows.length > 0) {
      const period = periodRows[0];

      enrollmentPeriod = {
        enrollment_period_id: Number(period.enrollment_period_id),

        academic_year_id: Number(period.academic_year_id),

        academic_year: period.academic_year,

        semester_id: Number(period.semester_id),

        semester_name: period.semester_name,

        status: period.status,

        opened_by: period.opened_by ? Number(period.opened_by) : null,

        opened_by_username: period.opened_by_username || null,

        opened_at: period.opened_at || null,

        closed_by: period.closed_by ? Number(period.closed_by) : null,

        closed_by_username: period.closed_by_username || null,

        closed_at: period.closed_at || null,

        remarks: period.remarks || null,

        created_at: period.created_at,

        updated_at: period.updated_at,
      };
    }

    // ===============================================
    // FORMAT ACADEMIC YEARS
    // ===============================================

    const academicYears = academicYearRows.map((row) => ({
      academic_year_id: Number(row.academic_year_id),

      academic_year: row.academic_year,

      is_current: Number(row.is_current) === 1,
    }));

    // ===============================================
    // FORMAT SUPPORTED SEMESTERS
    // ===============================================

    const semesters = semesterRows.map((row) => ({
      semester_id: Number(row.semester_id),

      semester_name: row.semester_name,
    }));

    // ===============================================
    // SUCCESS
    // ===============================================

    return res.status(200).json({
      success: true,

      enrollment_period: enrollmentPeriod,

      academic_years: academicYears,

      semesters,

      authenticated_registrar: {
        user_id: actor.user_id,
        username: actor.username,
      },
    });
  } catch (error) {
    console.error("GET ENROLLMENT PERIOD ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to load enrollment period management data.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});
// =====================================================
// ROUTE 2
// OPEN ENROLLMENT PERIOD
//
// POST /api/registrar/enrollments/period/open
//
// Body:
// {
//   "academic_year_id": 3,
//   "semester_id": 1,
//   "remarks": "Enrollment for 2027-2028 First Semester"
// }
//
// SEMESTER POLICY:
// - 1 = First Semester
// - 2 = Second Semester
// - Summer is NOT supported
//
// IMPORTANT:
// - Registrar identity comes from JWT.
// - Do NOT accept user_id from frontend.
// - Only one enrollment period may be Open.
// - If the same AY + semester already exists as Closed,
//   reopen it instead of creating a duplicate.
// - Opening a period makes its academic year current.
// - Academic-year rollover happens in the same
//   database transaction.
// =====================================================

router.post("/period/open", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  // =================================================
  // REQUEST BODY
  // =================================================

  const { academic_year_id, semester_id, remarks } = req.body;

  const academicYearId = toPositiveInt(academic_year_id);

  const semesterId = toPositiveInt(semester_id);

  const cleanRemarks =
    typeof remarks === "string" && remarks.trim() ? remarks.trim() : null;

  // =================================================
  // VALIDATE ACADEMIC YEAR
  // =================================================

  if (!academicYearId) {
    return res.status(400).json({
      success: false,
      message: "A valid academic_year_id is required.",
    });
  }

  // =================================================
  // VALIDATE SEMESTER ID
  // =================================================

  if (!semesterId) {
    return res.status(400).json({
      success: false,
      message: "A valid semester_id is required.",
    });
  }

  // =================================================
  // ENROLLMENT SEMESTER POLICY
  //
  // PTC Portal normal enrollment progression is:
  //
  // First Semester
  //      ↓
  // Second Semester
  //      ↓
  // Next AY First Semester
  //
  // Summer is intentionally excluded.
  //
  // IMPORTANT:
  // This check happens BEFORE opening a DB transaction,
  // so semester_id = 3 can never reach enrollment-period
  // creation/reopening logic.
  // =================================================

  const allowedSemesterIds = [1, 2];

  if (!allowedSemesterIds.includes(semesterId)) {
    return res.status(400).json({
      success: false,

      code: "UNSUPPORTED_ENROLLMENT_SEMESTER",

      message:
        "Only First Semester and Second Semester are supported for enrollment.",

      allowed_semester_ids: allowedSemesterIds,
    });
  }

  let connection;

  try {
    connection = await db.getConnection();

    // =================================================
    // START TRANSACTION
    // =================================================

    await connection.beginTransaction();

    // =================================================
    // VERIFY ACADEMIC YEAR
    // =================================================

    const [academicYearRows] = await connection.execute(
      `
          SELECT
              academic_year_id,
              academic_year,
              is_current

          FROM academic_years

          WHERE academic_year_id = ?

          LIMIT 1

          FOR UPDATE
        `,
      [academicYearId],
    );

    if (academicYearRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,

        message: "Academic year not found.",

        academic_year_id: academicYearId,
      });
    }

    // =================================================
    // VERIFY SUPPORTED SEMESTER
    //
    // Although the policy guard above already accepts
    // only 1 and 2, verify the row still exists.
    // =================================================

    const [semesterRows] = await connection.execute(
      `
          SELECT
              semester_id,
              semester_name

          FROM semesters

          WHERE semester_id = ?
            AND semester_id IN (1, 2)

          LIMIT 1
        `,
      [semesterId],
    );

    if (semesterRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,

        message: "Supported semester was not found.",

        semester_id: semesterId,
      });
    }

    const semester = semesterRows[0];

    // =================================================
    // CHECK FOR ANOTHER OPEN PERIOD
    //
    // Only one normal enrollment period may be Open.
    // =================================================

    const [openPeriodRows] = await connection.execute(
      `
          SELECT
              ep.enrollment_period_id,

              ep.academic_year_id,
              ay.academic_year,

              ep.semester_id,
              sem.semester_name,

              ep.status,

              ep.opened_by,
              ep.opened_at,

              ep.remarks

          FROM enrollment_periods ep

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 ep.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 ep.semester_id

          WHERE ep.status = 'Open'
            AND ep.semester_id IN (1, 2)

          LIMIT 1

          FOR UPDATE
        `,
    );

    if (openPeriodRows.length > 0) {
      const openPeriod = openPeriodRows[0];

      await connection.rollback();

      return res.status(409).json({
        success: false,

        message:
          "Another enrollment period is already open. Close it before opening another enrollment period.",

        enrollment_period: {
          enrollment_period_id: Number(openPeriod.enrollment_period_id),

          academic_year_id: Number(openPeriod.academic_year_id),

          academic_year: openPeriod.academic_year,

          semester_id: Number(openPeriod.semester_id),

          semester_name: openPeriod.semester_name,

          status: openPeriod.status,

          opened_by: openPeriod.opened_by ? Number(openPeriod.opened_by) : null,

          opened_at: openPeriod.opened_at,

          remarks: openPeriod.remarks || null,
        },
      });
    }

    // =================================================
    // CHECK EXISTING AY + SEMESTER PERIOD
    // =================================================

    const [existingRows] = await connection.execute(
      `
          SELECT
              enrollment_period_id,
              academic_year_id,
              semester_id,
              status,

              opened_by,
              opened_at,

              closed_by,
              closed_at,

              remarks

          FROM enrollment_periods

          WHERE academic_year_id = ?
            AND semester_id = ?
            AND semester_id IN (1, 2)

          LIMIT 1

          FOR UPDATE
        `,
      [academicYearId, semesterId],
    );

    let enrollmentPeriodId;

    let reopened = false;

    // =================================================
    // REOPEN EXISTING PERIOD
    // =================================================

    if (existingRows.length > 0) {
      const existingPeriod = existingRows[0];

      if (existingPeriod.status === "Open") {
        await connection.rollback();

        return res.status(409).json({
          success: false,

          message: "This enrollment period is already open.",
        });
      }

      enrollmentPeriodId = Number(existingPeriod.enrollment_period_id);

      reopened = true;

      const [updateResult] = await connection.execute(
        `
            UPDATE enrollment_periods

            SET
                status = 'Open',

                opened_by = ?,
                opened_at = NOW(),

                closed_by = NULL,
                closed_at = NULL,

                remarks =
                  COALESCE(
                    ?,
                    remarks
                  )

            WHERE enrollment_period_id = ?
          `,
        [actor.user_id, cleanRemarks, enrollmentPeriodId],
      );

      if (updateResult.affectedRows === 0) {
        await connection.rollback();

        return res.status(500).json({
          success: false,

          message: "Enrollment period could not be reopened.",
        });
      }
    } else {
      // =================================================
      // CREATE NEW PERIOD
      // =================================================

      const [insertResult] = await connection.execute(
        `
            INSERT INTO enrollment_periods (
                academic_year_id,
                semester_id,
                status,

                opened_by,
                opened_at,

                closed_by,
                closed_at,

                remarks
            )

            VALUES (
                ?,
                ?,
                'Open',

                ?,
                NOW(),

                NULL,
                NULL,

                ?
            )
          `,
        [academicYearId, semesterId, actor.user_id, cleanRemarks],
      );

      enrollmentPeriodId = Number(insertResult.insertId);
    }

    // =================================================
    // CURRENT ACADEMIC YEAR ROLLOVER
    //
    // The AY containing the newly opened enrollment
    // period becomes the single current AY.
    // =================================================

    await connection.execute(
      `
        UPDATE academic_years

        SET is_current =
          CASE
            WHEN academic_year_id = ?
              THEN 1
            ELSE 0
          END
      `,
      [academicYearId],
    );

    // =================================================
    // GET FINAL PERIOD
    // =================================================

    const [finalRows] = await connection.execute(
      `
          SELECT
              ep.enrollment_period_id,

              ep.academic_year_id,
              ay.academic_year,
              ay.is_current
                AS academic_year_is_current,

              ep.semester_id,
              sem.semester_name,

              ep.status,

              ep.opened_by,
              opener.username
                AS opened_by_username,

              ep.opened_at,

              ep.closed_by,
              ep.closed_at,

              ep.remarks,
              ep.created_at,
              ep.updated_at

          FROM enrollment_periods ep

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 ep.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 ep.semester_id

          LEFT JOIN users opener
              ON opener.user_id =
                 ep.opened_by

          WHERE ep.enrollment_period_id = ?

          LIMIT 1
        `,
      [enrollmentPeriodId],
    );

    if (finalRows.length === 0) {
      await connection.rollback();

      return res.status(500).json({
        success: false,

        message: "Enrollment period was opened but could not be retrieved.",
      });
    }

    const period = finalRows[0];

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // SUCCESS
    // =================================================

    return res.status(reopened ? 200 : 201).json({
      success: true,

      message: reopened
        ? "Enrollment period reopened successfully."
        : "Enrollment period opened successfully.",

      reopened,

      enrollment_period: {
        enrollment_period_id: Number(period.enrollment_period_id),

        academic_year_id: Number(period.academic_year_id),

        academic_year: period.academic_year,

        academic_year_is_current: Number(period.academic_year_is_current) === 1,

        semester_id: Number(period.semester_id),

        semester_name: period.semester_name,

        status: period.status,

        opened_by: Number(period.opened_by),

        opened_by_username: period.opened_by_username || actor.username,

        opened_at: period.opened_at,

        closed_by: null,

        closed_at: null,

        remarks: period.remarks || null,

        created_at: period.created_at,

        updated_at: period.updated_at,
      },

      actor: {
        user_id: actor.user_id,
        username: actor.username,
      },
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("OPEN ENROLLMENT PERIOD ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("OPEN ENROLLMENT PERIOD ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to open enrollment period.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// ROUTE 3
// CLOSE ENROLLMENT PERIOD
//
// POST /api/registrar/enrollments/period/close
//
// Body:
// {
//   "enrollment_period_id": 8,
//   "remarks": "Enrollment period closed."
// }
//
// IMPORTANT:
// - Registrar identity comes from JWT.
// - No user_id / closed_by from frontend.
// - Period must exist.
// - Period must currently be Open.
// =====================================================

router.post("/period/close", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  // =================================================
  // REQUEST BODY
  // =================================================

  const { enrollment_period_id, remarks } = req.body;

  const enrollmentPeriodId = toPositiveInt(enrollment_period_id);

  const cleanRemarks =
    typeof remarks === "string" && remarks.trim() ? remarks.trim() : null;

  // =================================================
  // VALIDATE PERIOD ID
  // =================================================

  if (!enrollmentPeriodId) {
    return res.status(400).json({
      success: false,

      message: "A valid enrollment_period_id is required.",
    });
  }

  let connection;

  try {
    // =================================================
    // DATABASE CONNECTION
    // =================================================

    connection = await db.getConnection();

    // =================================================
    // START TRANSACTION
    // =================================================

    await connection.beginTransaction();

    // =================================================
    // GET ENROLLMENT PERIOD
    // =================================================

    const [periodRows] = await connection.execute(
      `
          SELECT
              ep.enrollment_period_id,

              ep.academic_year_id,
              ay.academic_year,

              ep.semester_id,
              sem.semester_name,

              ep.status,

              ep.opened_by,
              ep.opened_at,

              ep.closed_by,
              ep.closed_at,

              ep.remarks,

              ep.created_at,
              ep.updated_at

          FROM enrollment_periods ep

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 ep.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 ep.semester_id

          WHERE ep.enrollment_period_id = ?

          LIMIT 1

          FOR UPDATE
          `,
      [enrollmentPeriodId],
    );

    // =================================================
    // PERIOD NOT FOUND
    // =================================================

    if (periodRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,

        message: "Enrollment period not found.",
      });
    }

    const period = periodRows[0];

    // =================================================
    // MUST CURRENTLY BE OPEN
    // =================================================

    if (period.status !== "Open") {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message: `Enrollment period cannot be closed because its current status is '${period.status}'.`,

        enrollment_period: {
          enrollment_period_id: Number(period.enrollment_period_id),

          academic_year_id: Number(period.academic_year_id),

          academic_year: period.academic_year,

          semester_id: Number(period.semester_id),

          semester_name: period.semester_name,

          status: period.status,
        },
      });
    }

    // =================================================
    // CLOSE PERIOD
    //
    // closed_by comes ONLY from authenticated JWT.
    // =================================================

    const [updateResult] = await connection.execute(
      `
          UPDATE enrollment_periods

          SET
              status = 'Closed',

              closed_by = ?,
              closed_at = NOW(),

              remarks =
                COALESCE(
                  ?,
                  remarks
                )

          WHERE enrollment_period_id = ?
            AND status = 'Open'
          `,
      [actor.user_id, cleanRemarks, enrollmentPeriodId],
    );

    // =================================================
    // VERIFY UPDATE
    // =================================================

    if (updateResult.affectedRows === 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message: "Enrollment period could not be closed.",
      });
    }

    // =================================================
    // GET UPDATED PERIOD
    // =================================================

    const [updatedRows] = await connection.execute(
      `
          SELECT
              ep.enrollment_period_id,

              ep.academic_year_id,
              ay.academic_year,

              ep.semester_id,
              sem.semester_name,

              ep.status,

              ep.opened_by,
              opener.username
                  AS opened_by_username,

              ep.opened_at,

              ep.closed_by,
              closer.username
                  AS closed_by_username,

              ep.closed_at,

              ep.remarks,

              ep.created_at,
              ep.updated_at

          FROM enrollment_periods ep

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 ep.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 ep.semester_id

          LEFT JOIN users opener
              ON opener.user_id =
                 ep.opened_by

          LEFT JOIN users closer
              ON closer.user_id =
                 ep.closed_by

          WHERE ep.enrollment_period_id = ?

          LIMIT 1
          `,
      [enrollmentPeriodId],
    );

    if (updatedRows.length === 0) {
      await connection.rollback();

      return res.status(500).json({
        success: false,

        message: "Enrollment period was closed but could not be retrieved.",
      });
    }

    const updatedPeriod = updatedRows[0];

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // SUCCESS
    // =================================================

    return res.status(200).json({
      success: true,

      message: "Enrollment period closed successfully.",

      enrollment_period: {
        enrollment_period_id: Number(updatedPeriod.enrollment_period_id),

        academic_year_id: Number(updatedPeriod.academic_year_id),

        academic_year: updatedPeriod.academic_year,

        semester_id: Number(updatedPeriod.semester_id),

        semester_name: updatedPeriod.semester_name,

        status: updatedPeriod.status,

        opened_by: updatedPeriod.opened_by
          ? Number(updatedPeriod.opened_by)
          : null,

        opened_by_username: updatedPeriod.opened_by_username || null,

        opened_at: updatedPeriod.opened_at,

        closed_by: updatedPeriod.closed_by
          ? Number(updatedPeriod.closed_by)
          : null,

        closed_by_username: updatedPeriod.closed_by_username || actor.username,

        closed_at: updatedPeriod.closed_at,

        remarks: updatedPeriod.remarks || null,

        created_at: updatedPeriod.created_at,

        updated_at: updatedPeriod.updated_at,
      },

      actor: {
        user_id: actor.user_id,

        username: actor.username,
      },
    });
  } catch (error) {
    // =================================================
    // ROLLBACK
    // =================================================

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("CLOSE ENROLLMENT PERIOD ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("CLOSE ENROLLMENT PERIOD ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to close enrollment period.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    // =================================================
    // RELEASE CONNECTION
    // =================================================

    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// ROUTE 4
// GET PENDING ENROLLMENTS
//
// GET /api/registrar/enrollments/pending
//
// Purpose:
// - Registrar sees enrollments submitted by Students
// - Only returns enrollment_status = 'Pending'
// - Includes Student, Course, Academic Year, Semester
// - Includes active subject count and total units
//
// JWT:
// - Registrar must be authenticated
// - No user_id from frontend
// =====================================================

router.get("/pending", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  let connection;

  try {
    // =================================================
    // DATABASE CONNECTION
    // =================================================

    connection = await db.getConnection();

    // =================================================
    // GET PENDING ENROLLMENTS
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
          SELECT
              e.enrollment_id,
              e.student_id,

              -- =========================================
              -- STUDENT
              -- =========================================

              s.student_number,
              s.first_name,
              s.middle_name,
              s.last_name,
              s.year_level,

              -- =========================================
              -- COURSE
              -- =========================================

              c.course_id,
              c.course_code,
              c.course_name,

              -- =========================================
              -- STUDENT'S CURRENT SECTION
              --
              -- This is informational only.
              -- It does NOT mean the Student selects
              -- subject sections during enrollment.
              -- =========================================

              s.section_id
                  AS student_section_id,

              student_sec.section_name
                  AS student_section_name,

              -- =========================================
              -- ACADEMIC PERIOD
              -- =========================================

              e.academic_year_id,
              ay.academic_year,

              e.semester_id,
              sem.semester_name,

              -- =========================================
              -- ENROLLMENT
              -- =========================================

              e.enrollment_status,
              e.remarks,
              e.created_at,

              -- =========================================
              -- ACTIVE SUBJECT COUNT
              -- =========================================

              (
                  SELECT COUNT(*)

                  FROM enrollment_subjects es_count

                  WHERE es_count.enrollment_id =
                        e.enrollment_id

                    AND es_count.status <> 'Dropped'
              ) AS total_subjects,

              -- =========================================
              -- TOTAL ACTIVE UNITS
              -- =========================================

              (
                  SELECT
                      COALESCE(
                          SUM(sub_units.units),
                          0
                      )

                  FROM enrollment_subjects es_units

                  INNER JOIN subjects sub_units
                      ON sub_units.subject_id =
                         es_units.subject_id

                  WHERE es_units.enrollment_id =
                        e.enrollment_id

                    AND es_units.status <> 'Dropped'
              ) AS total_units

          FROM enrollments e

          INNER JOIN students s
              ON s.student_id =
                 e.student_id

          LEFT JOIN courses c
              ON c.course_id =
                 s.course_id

          LEFT JOIN sections student_sec
              ON student_sec.section_id =
                 s.section_id

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 e.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 e.semester_id

          WHERE e.enrollment_status = 'Pending'

          ORDER BY
              e.created_at ASC,
              s.last_name ASC,
              s.first_name ASC
          `,
    );

    // =================================================
    // FORMAT RESPONSE
    // =================================================

    const enrollments = enrollmentRows.map((row) => ({
      enrollment_id: Number(row.enrollment_id),

      student_id: Number(row.student_id),

      student_number: row.student_number,

      first_name: row.first_name,

      middle_name: row.middle_name || null,

      last_name: row.last_name,

      student_name: [row.first_name, row.middle_name, row.last_name]
        .filter(Boolean)
        .join(" "),

      year_level:
        row.year_level !== null && row.year_level !== undefined
          ? Number(row.year_level)
          : null,

      course_id: row.course_id ? Number(row.course_id) : null,

      course_code: row.course_code || null,

      course_name: row.course_name || null,

      student_section_id: row.student_section_id
        ? Number(row.student_section_id)
        : null,

      student_section_name: row.student_section_name || null,

      academic_year_id: Number(row.academic_year_id),

      academic_year: row.academic_year,

      semester_id: Number(row.semester_id),

      semester_name: row.semester_name,

      enrollment_status: row.enrollment_status,

      remarks: row.remarks || null,

      total_subjects: Number(row.total_subjects || 0),

      total_units: Number(row.total_units || 0),

      created_at: row.created_at,
    }));

    // =================================================
    // SUCCESS
    // =================================================

    return res.status(200).json({
      success: true,

      count: enrollments.length,

      enrollments,

      actor: {
        user_id: actor.user_id,

        username: actor.username,
      },
    });
  } catch (error) {
    console.error("GET PENDING ENROLLMENTS ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to fetch pending enrollments.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    // =================================================
    // RELEASE CONNECTION
    // =================================================

    if (connection) {
      connection.release();
    }
  }
});
// =====================================================
// GET REGISTRAR ENROLLMENTS
//
// GET /api/registrar/enrollments
//
// Query:
// ?page=1
// ?limit=10
// ?search=...
// ?status=Pending
// ?course=1
// ?year=4
// ?section=18
// ?academic_year=3
// ?semester=1
//
// IMPORTANT:
// - JWT / Registrar RBAC required.
// - No frontend user_id.
// - Enrollment placement comes from enrollment_subjects.
// - students.section_id is NOT enrollment placement.
// - Summer is excluded.
// =====================================================

router.get("/", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  const {
    page = "1",
    limit = "10",
    search = "",
    status = "",
    course = "",
    year = "",
    section = "",
    academic_year = "",
    semester = "",
  } = req.query;

  // =================================================
  // PAGINATION
  // =================================================

  let currentPage = Number(page);
  let perPage = Number(limit);

  if (!Number.isInteger(currentPage) || currentPage <= 0) {
    currentPage = 1;
  }

  if (!Number.isInteger(perPage) || perPage <= 0) {
    perPage = 10;
  }

  if (perPage > 100) {
    perPage = 100;
  }

  const offset = (currentPage - 1) * perPage;

  // =================================================
  // CONDITIONS
  // =================================================

  const conditions = [
    // PTC enrollment uses only First and Second Semester.
    "e.semester_id IN (1, 2)",
  ];

  const params = [];

  // =================================================
  // SEARCH
  // =================================================

  const cleanSearch = String(search).trim();

  if (cleanSearch) {
    const searchValue = `%${cleanSearch}%`;

    conditions.push(`
      (
        s.student_number LIKE ?
        OR s.first_name LIKE ?
        OR s.middle_name LIKE ?
        OR s.last_name LIKE ?
        OR u.username LIKE ?
      )
    `);

    params.push(
      searchValue,
      searchValue,
      searchValue,
      searchValue,
      searchValue,
    );
  }

  // =================================================
  // STATUS
  // =================================================

  const cleanStatus = String(status).trim();

  const allowedStatuses = [
    "Draft",
    "Pending",
    "Approved",
    "Rejected",
    "Cancelled",
  ];

  if (cleanStatus) {
    if (!allowedStatuses.includes(cleanStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment status.",
        allowed_statuses: allowedStatuses,
      });
    }

    conditions.push("e.enrollment_status = ?");
    params.push(cleanStatus);
  }

  // =================================================
  // COURSE
  // =================================================

  if (String(course).trim()) {
    const courseId = toPositiveInt(course);

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "Invalid course filter.",
      });
    }

    conditions.push("s.course_id = ?");
    params.push(courseId);
  }

  // =================================================
  // YEAR LEVEL
  //
  // Student year level is separate from section
  // placement and semester progression.
  // =================================================

  if (String(year).trim()) {
    const yearLevel = toPositiveInt(year);

    if (!yearLevel) {
      return res.status(400).json({
        success: false,
        message: "Invalid year level filter.",
      });
    }

    conditions.push("s.year_level = ?");
    params.push(yearLevel);
  }

  // =================================================
  // OFFICIAL ENROLLMENT SECTION
  //
  // Do NOT filter using students.section_id.
  // =================================================

  if (String(section).trim()) {
    const sectionId = toPositiveInt(section);

    if (!sectionId) {
      return res.status(400).json({
        success: false,
        message: "Invalid section filter.",
      });
    }

    conditions.push(`
      EXISTS (
        SELECT 1
        FROM enrollment_subjects es_filter
        WHERE es_filter.enrollment_id = e.enrollment_id
          AND es_filter.section_id = ?
          AND es_filter.status IN (
            'Enrolled',
            'Completed',
            'Failed',
            'Incomplete'
          )
      )
    `);

    params.push(sectionId);
  }

  // =================================================
  // ACADEMIC YEAR
  // =================================================

  if (String(academic_year).trim()) {
    const academicYearId = toPositiveInt(academic_year);

    if (!academicYearId) {
      return res.status(400).json({
        success: false,
        message: "Invalid academic year filter.",
      });
    }

    conditions.push("e.academic_year_id = ?");
    params.push(academicYearId);
  }

  // =================================================
  // SEMESTER
  //
  // Summer is explicitly unsupported.
  // =================================================

  if (String(semester).trim()) {
    const semesterId = toPositiveInt(semester);

    if (!semesterId) {
      return res.status(400).json({
        success: false,
        message: "Invalid semester filter.",
      });
    }

    if (![1, 2].includes(semesterId)) {
      return res.status(400).json({
        success: false,
        code: "UNSUPPORTED_ENROLLMENT_SEMESTER",
        message:
          "Only First Semester and Second Semester are supported for enrollment.",
        allowed_semester_ids: [1, 2],
      });
    }

    conditions.push("e.semester_id = ?");
    params.push(semesterId);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  let connection;

  try {
    connection = await db.getConnection();

    // =================================================
    // TOTAL
    // =================================================

    const [countRows] = await connection.execute(
      `
        SELECT
            COUNT(DISTINCT e.enrollment_id) AS total

        FROM enrollments e

        INNER JOIN students s
            ON s.student_id = e.student_id

        LEFT JOIN users u
            ON u.user_id = s.user_id

        ${whereClause}
      `,
      params,
    );

    const total = Number(countRows[0]?.total || 0);

    // =================================================
    // ENROLLMENT LIST
    //
    // enrollment_subjects is authoritative for:
    // - enrolled subjects
    // - section
    // - placement
    // - units
    // =================================================

    const queryParams = [...params, perPage, offset];

    const [enrollmentRows] = await connection.execute(
      `
    SELECT
        -- =========================================
        -- ENROLLMENT
        -- =========================================

        e.enrollment_id,
        e.student_id,

        e.academic_year_id,
        e.semester_id,

        e.enrollment_status,
        e.remarks,

        e.approved_by,

        approver.username
            AS approved_by_username,

        e.approved_at,
        e.created_at,

        -- =========================================
        -- STUDENT
        -- =========================================

        s.student_number,

        s.first_name,
        s.middle_name,
        s.last_name,

        s.year_level
            AS student_year_level,

        u.username,

        -- =========================================
        -- COURSE
        -- =========================================

        c.course_id,
        c.course_code,
        c.course_name,

        -- =========================================
        -- PERIOD
        -- =========================================

        ay.academic_year,
        sem.semester_name,

        -- =========================================
        -- SUBJECT COUNT
        --
        -- Keep Completed / Failed / Incomplete
        -- attempts visible in historical enrollments.
        -- =========================================

        COUNT(
          DISTINCT
          CASE
            WHEN es.status IN (
              'Enrolled',
              'Completed',
              'Failed',
              'Incomplete'
            )
            THEN es.enrollment_subject_id
          END
        ) AS total_subjects,

        -- =========================================
        -- TOTAL UNITS
        -- =========================================

        COALESCE(
          SUM(
            CASE
              WHEN es.status IN (
                'Enrolled',
                'Completed',
                'Failed',
                'Incomplete'
              )
              THEN sub.units
              ELSE 0
            END
          ),
          0
        ) AS total_units,

        -- =========================================
        -- ACTUAL ENROLLMENT SECTIONS
        -- =========================================

        COUNT(
          DISTINCT
          CASE
            WHEN es.status IN (
              'Enrolled',
              'Completed',
              'Failed',
              'Incomplete'
            )
            AND es.section_id IS NOT NULL
            THEN es.section_id
          END
        ) AS assigned_section_count,

        MIN(
          CASE
            WHEN es.status IN (
              'Enrolled',
              'Completed',
              'Failed',
              'Incomplete'
            )
            THEN es.section_id
          END
        ) AS representative_section_id,

        GROUP_CONCAT(
          DISTINCT
          CASE
            WHEN es.status IN (
              'Enrolled',
              'Completed',
              'Failed',
              'Incomplete'
            )
            THEN assigned_sec.section_name
          END
          ORDER BY assigned_sec.section_name
          SEPARATOR '|||'
        ) AS assigned_section_names,

        -- =========================================
        -- PLACEMENT COUNT
        --
        -- Room is NOT required.
        -- =========================================

        COUNT(
          DISTINCT
          CASE
            WHEN es.status IN (
              'Enrolled',
              'Completed',
              'Failed',
              'Incomplete'
            )
            AND es.section_id IS NOT NULL
            AND es.section_subject_id IS NOT NULL
            AND es.offering_id IS NOT NULL
            THEN es.enrollment_subject_id
          END
        ) AS placed_subjects

    FROM enrollments e

    INNER JOIN students s
        ON s.student_id = e.student_id

    LEFT JOIN users u
        ON u.user_id = s.user_id

    LEFT JOIN courses c
        ON c.course_id = s.course_id

    INNER JOIN academic_years ay
        ON ay.academic_year_id =
           e.academic_year_id

    INNER JOIN semesters sem
        ON sem.semester_id =
           e.semester_id

    LEFT JOIN users approver
        ON approver.user_id =
           e.approved_by

    LEFT JOIN enrollment_subjects es
        ON es.enrollment_id =
           e.enrollment_id

    LEFT JOIN subjects sub
        ON sub.subject_id =
           es.subject_id

    LEFT JOIN sections assigned_sec
        ON assigned_sec.section_id =
           es.section_id

    ${whereClause}

    GROUP BY
        e.enrollment_id,
        e.student_id,

        e.academic_year_id,
        e.semester_id,

        e.enrollment_status,
        e.remarks,

        e.approved_by,
        approver.username,

        e.approved_at,
        e.created_at,

        s.student_number,
        s.first_name,
        s.middle_name,
        s.last_name,
        s.year_level,

        u.username,

        c.course_id,
        c.course_code,
        c.course_name,

        ay.academic_year,
        sem.semester_name

    ORDER BY
        e.created_at DESC,
        e.enrollment_id DESC

    LIMIT ?
    OFFSET ?
  `,
      queryParams,
    );

    // =================================================
    // FORMAT
    // =================================================

    const enrollments = enrollmentRows.map((row) => {
      const totalSubjects = Number(row.total_subjects || 0);

      const placedSubjects = Number(row.placed_subjects || 0);

      const assignedSectionCount = Number(row.assigned_section_count || 0);

      const sectionNames = row.assigned_section_names
        ? String(row.assigned_section_names).split("|||").filter(Boolean)
        : [];

      const singleSectionId =
        assignedSectionCount === 1 && row.representative_section_id !== null
          ? Number(row.representative_section_id)
          : null;

      const sectionName =
        assignedSectionCount === 1
          ? sectionNames[0] || null
          : assignedSectionCount > 1
            ? "Multiple Sections"
            : null;

      const placementComplete =
        totalSubjects > 0 && placedSubjects === totalSubjects;

      return {
        enrollment_id: Number(row.enrollment_id),

        student: {
          student_id: Number(row.student_id),

          student_number: row.student_number,

          student_name: [row.first_name, row.middle_name, row.last_name]
            .filter(Boolean)
            .join(" "),

          first_name: row.first_name,

          middle_name: row.middle_name || null,

          last_name: row.last_name,

          username: row.username || null,

          year_level:
            row.student_year_level !== null
              ? Number(row.student_year_level)
              : null,
        },

        course: {
          course_id: row.course_id ? Number(row.course_id) : null,

          course_code: row.course_code || null,

          course_name: row.course_name || null,
        },

        // =============================================
        // OFFICIAL PLACEMENT SUMMARY
        //
        // Never sourced from students.section_id.
        // =============================================

        section: {
          section_id: singleSectionId,

          section_name: sectionName,

          year_level:
            row.student_year_level !== null
              ? Number(row.student_year_level)
              : null,
        },

        placement: {
          assigned_section_count: assignedSectionCount,

          section_ids: singleSectionId !== null ? [singleSectionId] : [],

          section_names: sectionNames,

          placed_subjects: placedSubjects,

          unplaced_subjects: Math.max(totalSubjects - placedSubjects, 0),

          placement_complete: placementComplete,
        },

        academic_period: {
          academic_year_id: Number(row.academic_year_id),

          academic_year: row.academic_year,

          semester_id: Number(row.semester_id),

          semester_name: row.semester_name,
        },

        enrollment_status: row.enrollment_status,

        remarks: row.remarks || null,

        approval: {
          approved_by: row.approved_by ? Number(row.approved_by) : null,

          approved_by_username: row.approved_by_username || null,

          approved_at: row.approved_at || null,
        },

        total_subjects: totalSubjects,

        total_units: Number(row.total_units || 0),

        created_at: row.created_at,
      };
    });

    const totalPages = total > 0 ? Math.ceil(total / perPage) : 0;

    return res.status(200).json({
      success: true,

      data: enrollments,

      pagination: {
        page: currentPage,

        limit: perPage,

        total,

        totalPages,

        hasNextPage: currentPage < totalPages,

        hasPreviousPage: currentPage > 1,
      },

      actor: {
        user_id: actor.user_id,

        username: actor.username,
      },
    });
  } catch (error) {
    console.error("GET REGISTRAR ENROLLMENTS ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to load enrollments.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// ROUTE 6
// GET SINGLE ENROLLMENT DETAILS
//
// GET /api/registrar/enrollments/:id
//
// Example:
// GET /api/registrar/enrollments/3
//
// Purpose:
// - Registrar opens one enrollment
// - View Student information
// - View Course
// - View Academic Year / Semester
// - View enrollment status
// - View enrolled subjects
// - View section/offering assignment
// - View Faculty / Room / Schedule
//
// IMPORTANT:
// - Registrar authenticated through JWT
// - No user_id from frontend
// - Keep this route AFTER /pending and /period routes
// =====================================================

router.get("/:id", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  // =================================================
  // ENROLLMENT ID
  // =================================================

  const enrollmentId = toPositiveInt(req.params.id);

  if (!enrollmentId) {
    return res.status(400).json({
      success: false,
      message: "Invalid enrollment ID.",
    });
  }

  let connection;

  try {
    connection = await db.getConnection();

    // =================================================
    // GET ENROLLMENT HEADER
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
          SELECT
              -- =========================================
              -- ENROLLMENT
              -- =========================================

              e.enrollment_id,
              e.student_id,

              e.academic_year_id,
              e.semester_id,

              e.enrollment_status,
              e.remarks,

              e.approved_by,
              approver.username
                  AS approved_by_username,

              e.approved_at,
              e.created_at,

              -- =========================================
              -- STUDENT
              -- =========================================

              s.student_number,
              s.first_name,
              s.middle_name,
              s.last_name,

              s.gender,
              s.birth_date,
              s.contact_number,
              s.year_level,

              s.user_id,

              -- =========================================
              -- USER
              -- =========================================

              student_user.username,
              student_user.email,

              -- =========================================
              -- COURSE
              -- =========================================

              c.course_id,
              c.course_code,
              c.course_name,

              -- =========================================
              -- STUDENT CURRENT SECTION
              -- Informational only
              -- Student does not choose subject sections
              -- =========================================

              student_sec.section_id
                  AS student_section_id,
              student_sec.section_name
                  AS student_section_name,

              student_sec.year_level
                  AS student_section_year_level,

              -- =========================================
              -- ACADEMIC YEAR
              -- =========================================

              ay.academic_year,

              -- =========================================
              -- SEMESTER
              -- =========================================

              sem.semester_name

          FROM enrollments e

          INNER JOIN students s
              ON s.student_id =
                 e.student_id

          LEFT JOIN users student_user
              ON student_user.user_id =
                 s.user_id

          LEFT JOIN courses c
              ON c.course_id =
                 s.course_id

          LEFT JOIN sections student_sec
              ON student_sec.section_id =
                 s.section_id

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 e.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 e.semester_id

          LEFT JOIN users approver
              ON approver.user_id =
                 e.approved_by

          WHERE e.enrollment_id = ?

          LIMIT 1
          `,
      [enrollmentId],
    );

    // =================================================
    // ENROLLMENT NOT FOUND
    // =================================================

    if (enrollmentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const row = enrollmentRows[0];

    // =================================================
    // GET ENROLLMENT SUBJECTS
    // =================================================

    const [subjectRows] = await connection.execute(
      `
          SELECT
              -- =========================================
              -- ENROLLMENT SUBJECT
              -- =========================================

              es.enrollment_subject_id,
es.enrollment_id,

es.subject_id,
es.enrollment_type,

es.status
    AS enrollment_subject_status,

              -- =========================================
              -- SUBJECT
              -- =========================================

              sub.subject_code,
              sub.subject_name,
              sub.units,

              sub.lecture_hours,
              sub.laboratory_hours,

              -- =========================================
              -- ASSIGNED SECTION
              -- =========================================

              es.section_id,

              assigned_sec.section_name
                  AS section_name,

              assigned_sec.year_level
                  AS section_year_level,

              -- =========================================
              -- SECTION SUBJECT
              -- =========================================

              es.section_subject_id,

              ss.status
                  AS section_subject_status,

              -- =========================================
              -- OFFERING
              -- =========================================

              es.offering_id,

              so.status
                  AS offering_status,

              so.schedule_days,
              so.schedule_time,

              so.max_students
                  AS offering_max_students,

              -- =========================================
              -- FACULTY
              -- =========================================

              so.faculty_id,

              faculty_user.username
                  AS faculty_username,

              -- =========================================
              -- ROOM
              -- =========================================

              so.room_id,

              r.room_name,

              -- =========================================
              -- CURRENT OFFERING ENROLLMENT COUNT
              -- =========================================

              CASE
                WHEN es.offering_id IS NULL
                THEN 0
                ELSE (
                    SELECT COUNT(*)

                    FROM enrollment_subjects es_count

                    INNER JOIN enrollments e_count
                        ON e_count.enrollment_id =
                           es_count.enrollment_id

                    WHERE es_count.offering_id =
                          es.offering_id

                      AND es_count.status =
                          'Enrolled'

                      AND e_count.enrollment_status IN (
                          'Pending',
                          'Approved'
                      )
                )
              END AS enrolled_count

          FROM enrollment_subjects es

          INNER JOIN subjects sub
              ON sub.subject_id =
                 es.subject_id

          LEFT JOIN sections assigned_sec
              ON assigned_sec.section_id =
                 es.section_id

          LEFT JOIN section_subjects ss
              ON ss.section_subject_id =
                 es.section_subject_id

          LEFT JOIN subject_offerings so
              ON so.offering_id =
                 es.offering_id

          LEFT JOIN rooms r
              ON r.room_id =
                 so.room_id

          LEFT JOIN faculty f
              ON f.faculty_id =
                 so.faculty_id

          LEFT JOIN users faculty_user
              ON faculty_user.user_id =
                 f.user_id

          WHERE es.enrollment_id = ?

          ORDER BY
              sub.subject_code ASC,
              es.enrollment_subject_id ASC
          `,
      [enrollmentId],
    );

    // =================================================
    // FORMAT SUBJECTS
    // =================================================

    const subjects = subjectRows.map((subject) => {
      const enrollmentType = String(subject.enrollment_type || "Regular");

      const studentHomeSectionId =
        row.student_section_id !== null && row.student_section_id !== undefined
          ? Number(row.student_section_id)
          : null;

      const assignedSectionId =
        subject.section_id !== null && subject.section_id !== undefined
          ? Number(subject.section_id)
          : null;

      let isIrregular = false;
      let irregularReason = null;

      if (enrollmentType === "Retake") {
        isIrregular = true;
        irregularReason = "RETAKE";
      } else if (enrollmentType === "Carry Over") {
        isIrregular = true;
        irregularReason = "CARRY_OVER";
      } else if (
        enrollmentType === "Regular" &&
        studentHomeSectionId !== null &&
        assignedSectionId !== null &&
        assignedSectionId !== studentHomeSectionId
      ) {
        isIrregular = true;
        irregularReason = "CROSS_SECTION_PLACEMENT";
      }
      const maxStudents =
        subject.offering_max_students !== null &&
        subject.offering_max_students !== undefined
          ? Number(subject.offering_max_students)
          : null;

      const enrolledCount = Number(subject.enrolled_count || 0);

      return {
        enrollment_subject_id: Number(subject.enrollment_subject_id),

        enrollment_id: Number(subject.enrollment_id),

        subject_id: Number(subject.subject_id),

        enrollment_type: enrollmentType,

        is_irregular: isIrregular,

        irregular_reason: irregularReason,

        subject_code: subject.subject_code,

        subject_name: subject.subject_name,

        units: Number(subject.units || 0),

        lecture_hours:
          subject.lecture_hours !== null && subject.lecture_hours !== undefined
            ? Number(subject.lecture_hours)
            : null,

        laboratory_hours:
          subject.laboratory_hours !== null &&
          subject.laboratory_hours !== undefined
            ? Number(subject.laboratory_hours)
            : null,

        status: subject.enrollment_subject_status,

        // =========================================
        // SECTION ASSIGNMENT
        // =========================================

        section: {
          section_id: subject.section_id ? Number(subject.section_id) : null,

          section_name: subject.section_name || null,

          year_level:
            subject.section_year_level !== null &&
            subject.section_year_level !== undefined
              ? Number(subject.section_year_level)
              : null,
        },

        // =========================================
        // SECTION SUBJECT
        // =========================================

        section_subject: {
          section_subject_id: subject.section_subject_id
            ? Number(subject.section_subject_id)
            : null,

          status: subject.section_subject_status || null,
        },

        // =========================================
        // OFFERING
        // =========================================

        offering: {
          offering_id: subject.offering_id ? Number(subject.offering_id) : null,

          status: subject.offering_status || null,

          schedule_days: subject.schedule_days || null,

          schedule_time: subject.schedule_time || null,

          max_students: maxStudents,

          enrolled_count: enrolledCount,

          available_slots:
            maxStudents !== null
              ? Math.max(maxStudents - enrolledCount, 0)
              : null,
        },

        // =========================================
        // FACULTY
        // =========================================

        faculty: {
          faculty_id: subject.faculty_id ? Number(subject.faculty_id) : null,

          username: subject.faculty_username || null,
        },

        // =========================================
        // ROOM
        // =========================================

        room: {
          room_id: subject.room_id ? Number(subject.room_id) : null,

          room_name: subject.room_name || null,
        },

        // =========================================
        // ASSIGNMENT STATE
        //
        // Useful later for Registrar UI.
        // =========================================

        assignment_complete: Boolean(
          subject.offering_id &&
          subject.section_id &&
          subject.section_subject_id,
        ),
      };
    });

    // =================================================
    // TOTAL SUBJECTS
    // =================================================

    const activeSubjects = subjects.filter(
      (subject) => subject.status === "Enrolled",
    );

    const totalUnits = activeSubjects.reduce(
      (total, subject) => total + Number(subject.units || 0),
      0,
    );

    const assignedSubjects = activeSubjects.filter(
      (subject) => subject.assignment_complete,
    );

    const unassignedSubjects = activeSubjects.filter(
      (subject) => !subject.assignment_complete,
    );
    const regularSubjects = activeSubjects.filter(
      (subject) => subject.enrollment_type === "Regular",
    );

    const retakeSubjects = activeSubjects.filter(
      (subject) => subject.enrollment_type === "Retake",
    );

    const carryOverSubjects = activeSubjects.filter(
      (subject) => subject.enrollment_type === "Carry Over",
    );

    const irregularSubjects = activeSubjects.filter(
      (subject) => subject.is_irregular === true,
    );
    // =================================================
    // FORMAT ENROLLMENT
    // =================================================

    const enrollment = {
      enrollment_id: Number(row.enrollment_id),

      student: {
        student_id: Number(row.student_id),

        user_id: row.user_id ? Number(row.user_id) : null,

        student_number: row.student_number,

        first_name: row.first_name,

        middle_name: row.middle_name || null,

        last_name: row.last_name,

        student_name: [row.first_name, row.middle_name, row.last_name]
          .filter(Boolean)
          .join(" "),

        username: row.username || null,

        email: row.email || null,

        gender: row.gender || null,

        birth_date: row.birth_date || null,

        contact_number: row.contact_number || null,

        year_level:
          row.year_level !== null && row.year_level !== undefined
            ? Number(row.year_level)
            : null,
      },

      course: {
        course_id: row.course_id ? Number(row.course_id) : null,

        course_code: row.course_code || null,

        course_name: row.course_name || null,
      },

      student_section: {
        section_id: row.student_section_id
          ? Number(row.student_section_id)
          : null,

        section_name: row.student_section_name || null,

        year_level:
          row.student_section_year_level !== null &&
          row.student_section_year_level !== undefined
            ? Number(row.student_section_year_level)
            : null,
      },

      academic_period: {
        academic_year_id: Number(row.academic_year_id),

        academic_year: row.academic_year,

        semester_id: Number(row.semester_id),

        semester_name: row.semester_name,
      },

      enrollment_status: row.enrollment_status,

      remarks: row.remarks || null,

      approval: {
        approved_by: row.approved_by ? Number(row.approved_by) : null,

        approved_by_username: row.approved_by_username || null,

        approved_at: row.approved_at || null,
      },

      created_at: row.created_at,
    };

    // =================================================
    // SUCCESS
    // =================================================

    return res.status(200).json({
      success: true,

      enrollment,

      subjects,

      summary: {
        total_subjects: activeSubjects.length,

        total_units: totalUnits,

        regular_subjects: regularSubjects.length,

        retake_subjects: retakeSubjects.length,

        carry_over_subjects: carryOverSubjects.length,

        irregular_subjects: irregularSubjects.length,

        is_irregular_enrollment: irregularSubjects.length > 0,

        assigned_subjects: assignedSubjects.length,

        unassigned_subjects: unassignedSubjects.length,

        all_subjects_assigned:
          activeSubjects.length > 0 && unassignedSubjects.length === 0,
      },

      actor: {
        user_id: actor.user_id,

        username: actor.username,
      },
    });
  } catch (error) {
    console.error("GET SINGLE ENROLLMENT ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to fetch enrollment details.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
}); // =====================================================
// ROUTE 7
// GET AVAILABLE SUBJECT OFFERINGS
//
// GET /api/registrar/enrollments/:id/available-offerings
//
// Optional:
// ?subject_id=1
//
// Purpose:
// - Registrar chooses section/offering
// - Student does NOT choose section
// - Only Pending / Approved enrollment
// - Same academic year
// - Same semester
// - Same student course
// - Only subjects already inside enrollment
// - Only active Enrolled subjects
// - Only Open section subjects
// - Only Open subject offerings
// - Shows capacity
//
// JWT:
// - Registrar comes from req.user
// =====================================================

router.get("/:id/available-offerings", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  // =================================================
  // ENROLLMENT ID
  // =================================================

  const enrollmentId = toPositiveInt(req.params.id);

  if (!enrollmentId) {
    return res.status(400).json({
      success: false,
      message: "Invalid enrollment ID.",
    });
  }

  // =================================================
  // OPTIONAL SUBJECT ID
  // =================================================

  let subjectId = null;

  if (
    req.query.subject_id !== undefined &&
    String(req.query.subject_id).trim() !== ""
  ) {
    subjectId = toPositiveInt(req.query.subject_id);

    if (!subjectId) {
      return res.status(400).json({
        success: false,
        message: "Invalid subject ID.",
      });
    }
  }

  let connection;

  try {
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

            s.student_number,

            s.first_name,
            s.middle_name,
            s.last_name,

            s.course_id,
s.year_level,

s.section_id
    AS student_section_id,

            c.course_code,
            c.course_name,

            ay.academic_year,
            sem.semester_name

        FROM enrollments e

        INNER JOIN students s
            ON s.student_id =
               e.student_id

        LEFT JOIN courses c
            ON c.course_id =
               s.course_id

        INNER JOIN academic_years ay
            ON ay.academic_year_id =
               e.academic_year_id

        INNER JOIN semesters sem
            ON sem.semester_id =
               e.semester_id

        WHERE e.enrollment_id = ?

        LIMIT 1
      `,
      [enrollmentId],
    );

    // =================================================
    // NOT FOUND
    // =================================================

    if (enrollmentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // ENROLLMENT STATUS
    //
    // Pending:
    // Registrar may assign offering.
    //
    // Approved:
    // Registrar may view offerings for corrections.
    // =================================================

    if (!["Pending", "Approved"].includes(enrollment.enrollment_status)) {
      return res.status(409).json({
        success: false,

        message:
          "Available offerings can only be viewed for Pending or Approved enrollments.",

        enrollment_status: enrollment.enrollment_status,
      });
    }

    // =================================================
    // SUMMER EXCLUSION
    //
    // 1 = First Semester
    // 2 = Second Semester
    // =================================================

    const semesterId = Number(enrollment.semester_id);

    if (![1, 2].includes(semesterId)) {
      return res.status(409).json({
        success: false,

        code: "UNSUPPORTED_ENROLLMENT_SEMESTER",

        message:
          "Only First Semester and Second Semester are supported for enrollment.",
      });
    }

    // =================================================
    // COURSE REQUIRED
    // =================================================

    const courseId = toPositiveInt(enrollment.course_id);

    const yearLevel = toPositiveInt(enrollment.year_level);

    if (!courseId) {
      return res.status(409).json({
        success: false,

        message: "Student does not have a valid course assignment.",
      });
    }
    if (!yearLevel) {
      return res.status(409).json({
        success: false,
        message: "Student does not have a valid year level.",
      });
    }
    // =================================================
    // SUBJECT FILTER EXISTS
    //
    // Verify that the requested subject is actually
    // an ACTIVE Enrolled subject in this enrollment.
    //
    // IMPORTANT:
    // Earlier route used:
    //
    //   es.status <> 'Dropped'
    //
    // Finalized rule:
    //
    //   es.status = 'Enrolled'
    // =================================================

    if (subjectId) {
      const [enrollmentSubjectRows] = await connection.execute(
        `
            SELECT
                es.enrollment_subject_id,
                es.subject_id,
                es.status,

                sub.subject_code,
                sub.subject_name

            FROM enrollment_subjects es

            INNER JOIN subjects sub
                ON sub.subject_id =
                   es.subject_id

            WHERE es.enrollment_id = ?

              AND es.subject_id = ?

              AND es.status = 'Enrolled'

            LIMIT 1
          `,
        [enrollmentId, subjectId],
      );

      if (enrollmentSubjectRows.length === 0) {
        return res.status(404).json({
          success: false,

          message:
            "The requested subject is not an active Enrolled subject in this enrollment.",

          subject_id: subjectId,
        });
      }
    }

    // =================================================
    // SUBJECT FILTER
    // =================================================

    const subjectCondition = subjectId
      ? `
          AND so.subject_id = ?
        `
      : "";

    // =================================================
    // PARAMETERS
    // =================================================

    const queryParams = [
      enrollmentId,

      enrollment.academic_year_id,
      enrollment.semester_id,

      courseId,
      yearLevel,
    ];

    if (subjectId) {
      queryParams.push(subjectId);
    }

    // =================================================
    // GET AVAILABLE OFFERINGS
    //
    // Only READY offerings are returned.
    //
    // IMPORTANT:
    // The subject must already exist as an active
    // Enrolled subject inside this enrollment.
    // =================================================

    const [offeringRows] = await connection.execute(
      `
          SELECT
              -- =========================================
              -- OFFERING
              -- =========================================

              so.offering_id,
              so.subject_id,

              current_es.enrollment_subject_id,
current_es.enrollment_type,

              so.section_id,
              so.section_subject_id,

              so.faculty_id,
              so.room_id,

              so.academic_year_id,
              so.semester_id,

              so.schedule_days,
              so.schedule_time,

              so.max_students,

              so.status
                  AS offering_status,

              -- =========================================
              -- SUBJECT
              -- =========================================

              sub.subject_code,
              sub.subject_name,
              sub.units,

              sub.lecture_hours,
              sub.laboratory_hours,

              -- =========================================
              -- SECTION SUBJECT
              -- =========================================

              ss.status
                  AS section_subject_status,

              -- =========================================
              -- SECTION
              -- =========================================

              sec.section_name,
              sec.year_level,

              sec.course_id
                  AS section_course_id,

              -- =========================================
              -- COURSE
              -- =========================================

              section_course.course_code
                  AS section_course_code,

              section_course.course_name
                  AS section_course_name,

              -- =========================================
              -- FACULTY
              -- =========================================

              f.faculty_id,

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

              -- =========================================
              -- ROOM
              -- =========================================

              r.room_id,
              r.room_name,

              -- =========================================
              -- CURRENT ENROLLED COUNT
              -- =========================================

              (
                SELECT
                    COUNT(*)

                FROM enrollment_subjects es_count

                INNER JOIN enrollments e_count
                    ON e_count.enrollment_id =
                       es_count.enrollment_id

                WHERE es_count.offering_id =
                      so.offering_id

                  AND es_count.status =
                      'Enrolled'

                  AND e_count.enrollment_status
                      IN (
                        'Pending',
                        'Approved'
                      )
              ) AS enrolled_count

          FROM subject_offerings so

          INNER JOIN enrollment_subjects current_es
    ON current_es.enrollment_id = ?

   AND current_es.subject_id =
       so.subject_id

   AND current_es.status =
       'Enrolled'

          INNER JOIN section_subjects ss
              ON ss.section_subject_id =
                 so.section_subject_id

          INNER JOIN subjects sub
              ON sub.subject_id =
                 so.subject_id

          INNER JOIN sections sec
              ON sec.section_id =
                 so.section_id

          LEFT JOIN courses section_course
              ON section_course.course_id =
                 sec.course_id

          LEFT JOIN faculty f
              ON f.faculty_id =
                 so.faculty_id

          LEFT JOIN rooms r
              ON r.room_id =
                 so.room_id

          WHERE so.academic_year_id = ?

            AND so.semester_id = ?

            AND (
  -- =========================================
  -- REGULAR
  --
  -- Normal placement stays inside the
  -- Student's course and current year level.
  -- =========================================

  (
    current_es.enrollment_type = 'Regular'

    AND sec.course_id = ?

    AND sec.year_level = ?
  )

  OR

  -- =========================================
  -- IRREGULAR
  --
  -- Retake / Carry Over may use another
  -- section or another course.
  --
  -- Exact subject_id is still guaranteed by:
  --
  -- current_es.subject_id = so.subject_id
  -- =========================================

  current_es.enrollment_type IN (
    'Retake',
    'Carry Over'
  )
)


            -- =========================================
            -- SECTION SUBJECT MUST MATCH OFFERING
            -- =========================================

            AND ss.subject_id =
                so.subject_id

            AND ss.section_id =
                so.section_id

            AND ss.academic_year_id =
                so.academic_year_id

            AND ss.semester_id =
                so.semester_id

            -- =========================================
            -- OPEN ONLY
            -- =========================================

            AND ss.status = 'Open'

            AND so.status = 'Open'

            -- =========================================
            -- READY CONFIGURATION
            --
            -- Room is OPTIONAL.
            -- =========================================

            AND so.faculty_id IS NOT NULL

            AND so.schedule_days IS NOT NULL

            AND TRIM(
              so.schedule_days
            ) <> ''

            AND so.schedule_time IS NOT NULL

            AND TRIM(
              so.schedule_time
            ) <> ''

            AND so.max_students > 0

            ${subjectCondition}

          ORDER BY
              sub.subject_code ASC,
              sec.section_name ASC,
              so.schedule_days ASC,
              so.schedule_time ASC
        `,
      queryParams,
    );
    // =================================================
    // CURRENT STUDENT SCHEDULE
    //
    // Used only to remove offerings that would create
    // a schedule conflict for this student.
    // =================================================

    const [assignedScheduleRows] = await connection.execute(
      `
      SELECT
          es.enrollment_subject_id,
          es.subject_id,
          es.enrollment_type,

          es.offering_id,
          es.section_id,

          sub.subject_code,
          sub.subject_name,

          sec.section_name,

          so.schedule_days,
          so.schedule_time

      FROM enrollment_subjects es

      INNER JOIN subjects sub
          ON sub.subject_id =
             es.subject_id

      INNER JOIN subject_offerings so
          ON so.offering_id =
             es.offering_id

      INNER JOIN section_subjects ss
          ON ss.section_subject_id =
             es.section_subject_id

      INNER JOIN sections sec
          ON sec.section_id =
             es.section_id

      WHERE es.enrollment_id = ?

        AND es.status = 'Enrolled'

        AND es.offering_id IS NOT NULL

        AND so.status <> 'Cancelled'

        AND ss.status <> 'Cancelled'

      ORDER BY
          sub.subject_code ASC,
          es.enrollment_subject_id ASC
    `,
      [enrollmentId],
    );
    // =================================================
    // FORMAT AVAILABLE OFFERINGS
    // =================================================

    const offerings = offeringRows
      .map((row) => {
        const maxStudents = Number(row.max_students || 0);

        const enrolledCount = Number(row.enrolled_count || 0);

        const availableSlots = Math.max(maxStudents - enrolledCount, 0);

        const enrollmentType = String(row.enrollment_type || "").trim();

        const offeringSectionId = Number(row.section_id);

        const offeringCourseId =
          row.section_course_id !== null && row.section_course_id !== undefined
            ? Number(row.section_course_id)
            : null;

        const studentHomeSectionId =
          enrollment.student_section_id !== null &&
          enrollment.student_section_id !== undefined
            ? Number(enrollment.student_section_id)
            : null;

        const isCrossSection =
          studentHomeSectionId !== null &&
          offeringSectionId !== studentHomeSectionId;

        const isCrossCourse =
          offeringCourseId !== null && offeringCourseId !== courseId;

        const isIrregularPlacement =
          enrollmentType === "Retake" ||
          enrollmentType === "Carry Over" ||
          isCrossSection ||
          isCrossCourse;

        const studentScheduleConflicts = [];

        for (const existingSubject of assignedScheduleRows) {
          // Do not compare the enrollment subject
          // against its own current offering.
          if (
            Number(existingSubject.enrollment_subject_id) ===
            Number(row.enrollment_subject_id)
          ) {
            continue;
          }

          const overlap = enrollmentSchedulesOverlap(
            row.schedule_days,
            row.schedule_time,
            existingSubject.schedule_days,
            existingSubject.schedule_time,
          );

          if (!overlap.overlap) {
            continue;
          }

          studentScheduleConflicts.push({
            enrollment_subject_id: Number(
              existingSubject.enrollment_subject_id,
            ),

            subject_id: Number(existingSubject.subject_id),

            subject_code: existingSubject.subject_code,

            subject_name: existingSubject.subject_name,

            enrollment_type: existingSubject.enrollment_type,

            offering_id:
              existingSubject.offering_id !== null
                ? Number(existingSubject.offering_id)
                : null,

            section_id:
              existingSubject.section_id !== null
                ? Number(existingSubject.section_id)
                : null,

            section_name: existingSubject.section_name || null,

            schedule: {
              days: existingSubject.schedule_days,

              time: existingSubject.schedule_time,
            },

            common_days: overlap.common_days,
          });
        }

        const hasStudentScheduleConflict = studentScheduleConflicts.length > 0;
        return {
          // =============================================
          // OFFERING
          // =============================================

          offering_id: Number(row.offering_id),

          offering_status: row.offering_status,

          enrollment_subject_id: Number(row.enrollment_subject_id),

          enrollment_type: enrollmentType,

          is_irregular_placement: isIrregularPlacement,

          placement_flags: {
            cross_section: isCrossSection,

            cross_course: isCrossCourse,
          },

          has_student_schedule_conflict: hasStudentScheduleConflict,

          student_schedule_conflicts: studentScheduleConflicts,

          academic_year_id: Number(row.academic_year_id),

          semester_id: Number(row.semester_id),

          // =============================================
          // SUBJECT
          // =============================================

          subject: {
            subject_id: Number(row.subject_id),

            subject_code: row.subject_code,

            subject_name: row.subject_name,

            units: Number(row.units || 0),

            lecture_hours:
              row.lecture_hours !== null && row.lecture_hours !== undefined
                ? Number(row.lecture_hours)
                : null,

            laboratory_hours:
              row.laboratory_hours !== null &&
              row.laboratory_hours !== undefined
                ? Number(row.laboratory_hours)
                : null,
          },

          // =============================================
          // SECTION
          // =============================================

          section: {
            section_id: Number(row.section_id),

            section_name: row.section_name,

            year_level:
              row.year_level !== null && row.year_level !== undefined
                ? Number(row.year_level)
                : null,

            course_id: row.section_course_id
              ? Number(row.section_course_id)
              : null,

            course_code: row.section_course_code || null,

            course_name: row.section_course_name || null,
          },

          // =============================================
          // SECTION SUBJECT
          // =============================================

          section_subject: {
            section_subject_id: Number(row.section_subject_id),

            status: row.section_subject_status,
          },

          // =============================================
          // FACULTY
          // =============================================

          faculty: {
            faculty_id: row.faculty_id ? Number(row.faculty_id) : null,

            faculty_name: row.faculty_name || null,
          },

          // =============================================
          // ROOM
          //
          // Room is optional.
          // =============================================

          room: {
            room_id: row.room_id ? Number(row.room_id) : null,

            room_name: row.room_name || null,
          },

          // =============================================
          // SCHEDULE
          // =============================================

          schedule: {
            days: row.schedule_days || null,

            time: row.schedule_time || null,
          },

          // =============================================
          // CAPACITY
          // =============================================

          capacity: {
            max_students: maxStudents,

            enrolled_count: enrolledCount,

            available_slots: availableSlots,

            is_full: availableSlots <= 0,
          },
        };
      })

      // =================================================
      // REMOVE FULL OFFERINGS
      // =================================================

      .filter(
        (offering) =>
          offering.capacity.available_slots > 0 &&
          !offering.has_student_schedule_conflict,
      );

    // =================================================
    // SUCCESS RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      enrollment: {
        enrollment_id: Number(enrollment.enrollment_id),

        student_id: Number(enrollment.student_id),

        student_number: enrollment.student_number,

        student_name: [
          enrollment.first_name,
          enrollment.middle_name,
          enrollment.last_name,
        ]
          .filter(Boolean)
          .join(" "),

        course_id: courseId,

        course_code: enrollment.course_code,

        course_name: enrollment.course_name,

        academic_year_id: Number(enrollment.academic_year_id),

        academic_year: enrollment.academic_year,

        semester_id: Number(enrollment.semester_id),

        semester_name: enrollment.semester_name,

        enrollment_status: enrollment.enrollment_status,
      },

      subject_filter: subjectId,

      subject_enrollment_type:
        offerings.length > 0 ? offerings[0].enrollment_type : null,

      count: offerings.length,

      offerings,

      actor: {
        user_id: actor.user_id,

        username: actor.username,
      },
    });
  } catch (error) {
    console.error("GET AVAILABLE OFFERINGS ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to fetch available subject offerings.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// BULK ASSIGN REGULAR SUBJECTS TO ONE SECTION
//
// POST
// /api/registrar/enrollments/:id/assign-section
//
// Body:
// {
//   "section_id": 19,
//   "reason": "Assigned regular subjects to BSIT-1C."
// }
//
// Purpose:
// - Registrar chooses ONE section.
// - System maps the student's regular Enrolled subjects
//   to that section's READY offerings.
// - Retake / special subjects are NOT bulk-assigned.
// - Already-correct assignments are skipped.
// - Entire operation is transactional.
// - Pending enrollment only.
// - Room remains optional.
// =====================================================

router.post("/:id/assign-section", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  // =================================================
  // IDS
  // =================================================

  const enrollmentId = toPositiveInt(req.params.id);

  const sectionId = toPositiveInt(req.body?.section_id);

  if (!enrollmentId) {
    return res.status(400).json({
      success: false,
      message: "Invalid enrollment ID.",
    });
  }

  if (!sectionId) {
    return res.status(400).json({
      success: false,
      message: "A valid section_id is required.",
    });
  }

  // =================================================
  // REASON
  // =================================================

  const reason =
    typeof req.body?.reason === "string" && req.body.reason.trim()
      ? req.body.reason.trim()
      : "Registrar bulk assigned regular subjects to section.";

  if (reason.length > 255) {
    return res.status(400).json({
      success: false,
      message: "Assignment reason must not exceed 255 characters.",
    });
  }

  let connection;

  try {
    connection = await db.getConnection();

    // =================================================
    // TRANSACTION
    // =================================================

    await connection.beginTransaction();

    // =================================================
    // GET + LOCK ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
          SELECT
              e.enrollment_id,
              e.student_id,
              e.academic_year_id,
              e.semester_id,
              e.enrollment_status,

              s.student_number,
              s.first_name,
              s.middle_name,
              s.last_name,

              s.course_id,
              s.year_level,

              c.course_code,
              c.course_name,

              ay.academic_year,
              sem.semester_name

          FROM enrollments e

          INNER JOIN students s
              ON s.student_id =
                 e.student_id

          LEFT JOIN courses c
              ON c.course_id =
                 s.course_id

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 e.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 e.semester_id

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
    // BULK PLACEMENT IS PENDING ONLY
    //
    // Approved enrollment corrections continue to use
    // the individual subject assignment/change route.
    // =================================================

    if (enrollment.enrollment_status !== "Pending") {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        code: "BULK_PLACEMENT_REQUIRES_PENDING",

        message:
          "Bulk section placement is only allowed for Pending enrollments.",

        enrollment_status: enrollment.enrollment_status,
      });
    }

    // =================================================
    // DEFENSIVE SUMMER EXCLUSION
    //
    // 1 = First Semester
    // 2 = Second Semester
    // =================================================

    const semesterId = Number(enrollment.semester_id);

    if (![1, 2].includes(semesterId)) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        code: "UNSUPPORTED_ENROLLMENT_SEMESTER",

        message:
          "Bulk section placement supports only First Semester and Second Semester.",
      });
    }

    // =================================================
    // STUDENT COURSE / YEAR
    // =================================================

    const courseId = toPositiveInt(enrollment.course_id);

    const yearLevel = toPositiveInt(enrollment.year_level);

    if (!courseId) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message: "Student does not have a valid course assignment.",
      });
    }

    if (!yearLevel) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message: "Student does not have a valid year level.",
      });
    }

    const academicYearId = Number(enrollment.academic_year_id);

    // =================================================
    // GET + LOCK TARGET SECTION
    // =================================================

    const [sectionRows] = await connection.execute(
      `
          SELECT
              section_id,
              course_id,
              academic_year_id,
              year_level,
              section_name,
              max_students

          FROM sections

          WHERE section_id = ?

          LIMIT 1

          FOR UPDATE
        `,
      [sectionId],
    );

    if (sectionRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Target section not found.",
      });
    }

    const section = sectionRows[0];

    // =================================================
    // SAME COURSE
    // =================================================

    if (Number(section.course_id) !== courseId) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        code: "SECTION_COURSE_MISMATCH",

        message:
          "The selected section does not belong to the student's course.",

        student_course_id: courseId,

        section_course_id: Number(section.course_id),
      });
    }

    // =================================================
    // SAME ACADEMIC YEAR
    // =================================================

    if (Number(section.academic_year_id) !== academicYearId) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        code: "SECTION_ACADEMIC_YEAR_MISMATCH",

        message:
          "The selected section does not belong to the enrollment academic year.",
      });
    }

    // =================================================
    // SAME YEAR LEVEL
    //
    // Bulk placement is for the student's NORMAL
    // section at the current year level.
    // Retake placement remains individual.
    // =================================================

    if (Number(section.year_level) !== yearLevel) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        code: "SECTION_YEAR_LEVEL_MISMATCH",

        message:
          "The selected section does not match the student's current year level.",

        student_year_level: yearLevel,

        section_year_level: Number(section.year_level),
      });
    }

    // =================================================
    // GET ACTIVE STUDENT CURRICULUM
    //
    // Bulk placement uses curriculum membership only
    // to determine which subjects are NORMAL subjects
    // for this student's current year + semester.
    //
    // This does NOT rerun Grade V2 eligibility.
    // =================================================

    const [curriculumRows] = await connection.execute(
      `
          SELECT
              sc.student_curriculum_id,
              sc.curriculum_id,
              sc.status
                  AS assignment_status,

              cur.curriculum_name,
              cur.course_id,
              cur.is_active

          FROM student_curriculum sc

          INNER JOIN curriculum cur
              ON cur.curriculum_id =
                 sc.curriculum_id

          WHERE sc.student_id = ?

            AND sc.status = 'Active'

            AND cur.is_active = 1

            AND cur.course_id = ?

          LIMIT 1

          FOR UPDATE
        `,
      [enrollment.student_id, courseId],
    );

    if (curriculumRows.length === 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        code: "VALID_ACTIVE_CURRICULUM_REQUIRED",

        message:
          "Bulk section placement requires a valid active curriculum assigned to the student.",
      });
    }

    const curriculum = curriculumRows[0];

    const curriculumId = Number(curriculum.curriculum_id);

    // =================================================
    // GET + LOCK ALL ACTIVE ENROLLMENT SUBJECTS
    //
    // IMPORTANT:
    // We lock every Enrolled row first because this
    // transaction may update several of them.
    // =================================================

    const [subjectRows] = await connection.execute(
      `
          SELECT
              es.enrollment_subject_id,
              es.enrollment_id,
              es.subject_id,
                es.enrollment_type,

              es.offering_id,
              es.section_id,
              es.section_subject_id,

              es.status,

              sub.subject_code,
              sub.subject_name,
              sub.units,
              sub.lecture_hours,
              sub.laboratory_hours

          FROM enrollment_subjects es

          INNER JOIN subjects sub
              ON sub.subject_id =
                 es.subject_id

          WHERE es.enrollment_id = ?

            AND es.status = 'Enrolled'

          ORDER BY
              sub.subject_code ASC,
              es.enrollment_subject_id ASC

          FOR UPDATE
        `,
      [enrollmentId],
    );

    if (subjectRows.length === 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        code: "NO_ACTIVE_ENROLLMENT_SUBJECTS",

        message:
          "This enrollment does not contain any active Enrolled subjects.",
      });
    }

    // =================================================
    // GET NORMAL CURRICULUM SUBJECTS FOR CURRENT TERM
    //
    // Regular bulk placement requires:
    //
    // active curriculum
    // +
    // current student year level
    // +
    // current enrollment semester
    //
    // This matches the curriculum structure already
    // used by the Student enrollment workflow.
    // =================================================

    const [currentCurriculumRows] = await connection.execute(
      `
          SELECT
              cs.curriculum_subject_id,
              cs.curriculum_id,
              cs.subject_id,
              cs.year_level,
              cs.semester_id,
              cs.is_required,
              cs.display_order,

              sub.subject_code,
              sub.subject_name,
              sub.units

          FROM curriculum_subjects cs

          INNER JOIN subjects sub
              ON sub.subject_id =
                 cs.subject_id

          WHERE cs.curriculum_id = ?

            AND cs.year_level = ?

            AND cs.semester_id = ?

          ORDER BY
              cs.display_order ASC,
              sub.subject_code ASC
        `,
      [curriculumId, yearLevel, semesterId],
    );

    const currentCurriculumMap = new Map();

    for (const row of currentCurriculumRows) {
      currentCurriculumMap.set(Number(row.subject_id), row);
    }

    // =================================================
    // CLASSIFY ACTIVE ENROLLMENT SUBJECTS
    //
    // REGULAR:
    //
    // 1. Current curriculum subject
    // 2. Correct current year level
    // 3. Correct current semester
    // 4. No previous Approved academic attempt
    //
    // MANUAL:
    //
    // - Retakes
    // - Old curriculum subjects
    // - Special subjects
    // - Subjects with a previous Approved attempt
    //
    // Manual subjects remain available through the
    // individual Assign Offering action.
    // =================================================

    const regularSubjects = [];

    const manualSubjects = [];

    for (const subject of subjectRows) {
      const subjectId = Number(subject.subject_id);

      const enrollmentType = String(subject.enrollment_type || "").trim();

      const curriculumSubject = currentCurriculumMap.get(subjectId);

      // =================================================
      // REGULAR
      //
      // Bulk placement is STRICTLY for subjects whose
      // persisted enrollment type is Regular.
      // =================================================

      if (enrollmentType === "Regular") {
        if (!curriculumSubject) {
          manualSubjects.push({
            enrollment_subject_id: Number(subject.enrollment_subject_id),

            subject_id: subjectId,

            subject_code: subject.subject_code,

            subject_name: subject.subject_name,

            enrollment_type: enrollmentType,

            current_offering_id:
              subject.offering_id !== null ? Number(subject.offering_id) : null,

            current_section_id:
              subject.section_id !== null ? Number(subject.section_id) : null,

            classification: "REGULAR_OUTSIDE_CURRENT_CURRICULUM_TERM",
          });

          continue;
        }

        regularSubjects.push({
          ...subject,

          enrollment_type: enrollmentType,

          curriculum_subject_id: Number(
            curriculumSubject.curriculum_subject_id,
          ),

          classification: "REGULAR",
        });

        continue;
      }

      // =================================================
      // RETAKE / CARRY OVER
      //
      // Irregular subjects are intentionally excluded
      // from normal bulk section placement.
      //
      // They will use individual Registrar placement.
      // =================================================

      if (enrollmentType === "Retake" || enrollmentType === "Carry Over") {
        manualSubjects.push({
          enrollment_subject_id: Number(subject.enrollment_subject_id),

          subject_id: subjectId,

          subject_code: subject.subject_code,

          subject_name: subject.subject_name,

          enrollment_type: enrollmentType,

          current_offering_id:
            subject.offering_id !== null ? Number(subject.offering_id) : null,

          current_section_id:
            subject.section_id !== null ? Number(subject.section_id) : null,

          classification: enrollmentType === "Retake" ? "RETAKE" : "CARRY_OVER",
        });

        continue;
      }

      // =================================================
      // INVALID STORED TYPE
      // =================================================

      manualSubjects.push({
        enrollment_subject_id: Number(subject.enrollment_subject_id),

        subject_id: subjectId,

        subject_code: subject.subject_code,

        subject_name: subject.subject_name,

        enrollment_type: enrollmentType || null,

        current_offering_id:
          subject.offering_id !== null ? Number(subject.offering_id) : null,

        current_section_id:
          subject.section_id !== null ? Number(subject.section_id) : null,

        classification: "INVALID_ENROLLMENT_TYPE",
      });
    }

    // =================================================
    // NOTHING REGULAR TO BULK PLACE
    // =================================================

    if (regularSubjects.length === 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        code: "NO_REGULAR_SUBJECTS_FOR_BULK_PLACEMENT",

        message:
          "No regular current-term subjects are available for bulk section placement.",

        manual_subjects: manualSubjects,
      });
    }

    // =================================================
    // REGULAR SUBJECT IDS
    // =================================================

    const regularSubjectIds = regularSubjects.map((subject) =>
      Number(subject.subject_id),
    );

    // =================================================
    // GET READY OFFERINGS IN TARGET SECTION
    // =================================================

    const placeholders = regularSubjectIds.map(() => "?").join(",");

    const [offeringRows] = await connection.execute(
      `
          SELECT
              so.offering_id,
              so.subject_id,
              so.section_id,
              so.section_subject_id,

              so.faculty_id,
              so.room_id,

              so.academic_year_id,
              so.semester_id,

              so.schedule_days,
              so.schedule_time,

              so.max_students,

              so.status
                  AS offering_status,

              ss.subject_id
                  AS section_subject_subject_id,

              ss.section_id
                  AS section_subject_section_id,

              ss.academic_year_id
                  AS section_subject_academic_year_id,

              ss.semester_id
                  AS section_subject_semester_id,

              ss.status
                  AS section_subject_status,

              sub.subject_code,
              sub.subject_name,
              sub.units,

              sec.section_name,
              sec.year_level,

              sec.course_id
                  AS section_course_id,

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

              r.room_name,

              (
                SELECT
                    COUNT(*)

                FROM enrollment_subjects es_count

                INNER JOIN enrollments e_count
                    ON e_count.enrollment_id =
                       es_count.enrollment_id

                WHERE es_count.offering_id =
                      so.offering_id

                  AND es_count.status =
                      'Enrolled'

                  AND e_count.enrollment_status
                      IN (
                        'Pending',
                        'Approved'
                      )
              ) AS enrolled_count

          FROM subject_offerings so

          INNER JOIN section_subjects ss
              ON ss.section_subject_id =
                 so.section_subject_id

          INNER JOIN subjects sub
              ON sub.subject_id =
                 so.subject_id

          INNER JOIN sections sec
              ON sec.section_id =
                 so.section_id

          LEFT JOIN faculty f
              ON f.faculty_id =
                 so.faculty_id

          LEFT JOIN rooms r
              ON r.room_id =
                 so.room_id

          WHERE so.subject_id
                IN (${placeholders})

            AND so.section_id = ?

            AND so.academic_year_id = ?

            AND so.semester_id = ?

            AND ss.section_id = ?

            AND ss.academic_year_id = ?

            AND ss.semester_id = ?

            AND sec.course_id = ?

            AND sec.year_level = ?

            AND so.status = 'Open'

            AND ss.status = 'Open'

            AND so.faculty_id IS NOT NULL

            AND so.schedule_days IS NOT NULL

            AND TRIM(
              so.schedule_days
            ) <> ''

            AND so.schedule_time IS NOT NULL

            AND TRIM(
              so.schedule_time
            ) <> ''

            AND so.max_students > 0

          ORDER BY
              sub.subject_code ASC,
              so.offering_id ASC

          FOR UPDATE
        `,
      [
        ...regularSubjectIds,

        sectionId,

        academicYearId,
        semesterId,

        sectionId,

        academicYearId,
        semesterId,

        courseId,
        yearLevel,
      ],
    );

    // =================================================
    // GROUP OFFERINGS BY SUBJECT
    // =================================================

    const offeringsBySubject = new Map();

    for (const row of offeringRows) {
      const subjectId = Number(row.subject_id);

      // ===============================================
      // DEFENSIVE RELATIONSHIP CHECK
      // ===============================================

      const relationshipValid =
        Number(row.section_subject_subject_id) === subjectId &&
        Number(row.section_subject_section_id) === sectionId &&
        Number(row.section_subject_academic_year_id) === academicYearId &&
        Number(row.section_subject_semester_id) === semesterId;

      if (!relationshipValid) {
        continue;
      }

      // ===============================================
      // ROOM IS OPTIONAL
      //
      // Do NOT reject when:
      //
      // room_id   = null
      // room_name = null
      // ===============================================

      const maxStudents = Number(row.max_students || 0);

      const enrolledCount = Number(row.enrolled_count || 0);

      const normalized = {
        offering_id: Number(row.offering_id),

        subject_id: subjectId,

        section_id: Number(row.section_id),

        section_subject_id: Number(row.section_subject_id),

        faculty_id: row.faculty_id !== null ? Number(row.faculty_id) : null,

        faculty_name: row.faculty_name || null,

        room_id: row.room_id !== null ? Number(row.room_id) : null,

        room_name: row.room_name || null,

        schedule_days: row.schedule_days,

        schedule_time: row.schedule_time,

        max_students: maxStudents,

        enrolled_count: enrolledCount,

        offering_status: row.offering_status,

        section_subject_status: row.section_subject_status,

        section_name: row.section_name,

        year_level: Number(row.year_level),

        course_id: Number(row.section_course_id),
      };

      if (!offeringsBySubject.has(subjectId)) {
        offeringsBySubject.set(subjectId, []);
      }

      offeringsBySubject.get(subjectId).push(normalized);
    }

    // =================================================
    // BUILD BULK PLACEMENT PLAN
    //
    // Nothing is written yet.
    // =================================================

    const placementPlan = [];

    const placementErrors = [];

    const skippedSubjects = [];

    for (const subject of regularSubjects) {
      const subjectId = Number(subject.subject_id);

      const enrollmentSubjectId = Number(subject.enrollment_subject_id);

      const candidates = offeringsBySubject.get(subjectId) || [];

      // ===============================================
      // NO READY OFFERING
      // ===============================================

      if (candidates.length === 0) {
        placementErrors.push({
          enrollment_subject_id: enrollmentSubjectId,

          subject_id: subjectId,

          subject_code: subject.subject_code,

          subject_name: subject.subject_name,

          code: "READY_OFFERING_NOT_FOUND",

          message: `No READY / Open offering was found for ${subject.subject_code} in ${section.section_name}.`,
        });

        continue;
      }

      // ===============================================
      // MORE THAN ONE READY OFFERING
      //
      // Bulk placement must be deterministic.
      // Registrar should not have to guess.
      // ===============================================

      if (candidates.length > 1) {
        placementErrors.push({
          enrollment_subject_id: enrollmentSubjectId,

          subject_id: subjectId,

          subject_code: subject.subject_code,

          subject_name: subject.subject_name,

          code: "MULTIPLE_READY_OFFERINGS",

          message: `More than one READY offering exists for ${subject.subject_code} in ${section.section_name}. Resolve the duplicate offerings first.`,

          offering_ids: candidates.map((item) => item.offering_id),
        });

        continue;
      }

      const offering = candidates[0];

      // ===============================================
      // ALREADY CORRECTLY ASSIGNED
      //
      // Example:
      // CC101 was manually assigned before bulk action.
      //
      // Do not write it again.
      // Do not create duplicate history.
      // ===============================================

      const alreadyCorrect =
        subject.offering_id !== null &&
        subject.section_id !== null &&
        subject.section_subject_id !== null &&
        Number(subject.offering_id) === offering.offering_id &&
        Number(subject.section_id) === sectionId &&
        Number(subject.section_subject_id) === offering.section_subject_id;

      if (alreadyCorrect) {
        skippedSubjects.push({
          enrollment_subject_id: enrollmentSubjectId,

          subject_id: subjectId,

          subject_code: subject.subject_code,

          subject_name: subject.subject_name,

          offering_id: offering.offering_id,

          section_id: sectionId,

          section_subject_id: offering.section_subject_id,

          reason: "Already assigned to the correct READY offering.",
        });

        continue;
      }

      // ===============================================
      // CAPACITY
      //
      // Current subject is NOT counted against the
      // target offering unless it already belongs there.
      //
      // If it already belongs there, it would have been
      // caught by alreadyCorrect above.
      // ===============================================

      if (offering.enrolled_count >= offering.max_students) {
        placementErrors.push({
          enrollment_subject_id: enrollmentSubjectId,

          subject_id: subjectId,

          subject_code: subject.subject_code,

          subject_name: subject.subject_name,

          code: "OFFERING_FULL",

          message: `The READY offering for ${subject.subject_code} is already full.`,

          offering_id: offering.offering_id,

          capacity: {
            enrolled_count: offering.enrolled_count,

            max_students: offering.max_students,

            available_slots: 0,
          },
        });

        continue;
      }

      // ===============================================
      // PREPARE OLD VALUES
      // ===============================================

      const oldValues = {
        offering_id:
          subject.offering_id !== null ? Number(subject.offering_id) : null,

        section_id:
          subject.section_id !== null ? Number(subject.section_id) : null,

        section_subject_id:
          subject.section_subject_id !== null
            ? Number(subject.section_subject_id)
            : null,

        status: subject.status,
      };

      // ===============================================
      // PREPARE NEW VALUES
      // ===============================================

      const newValues = {
        offering_id: offering.offering_id,

        section_id: sectionId,

        section_subject_id: offering.section_subject_id,

        status: subject.status,
      };

      placementPlan.push({
        enrollment_subject_id: enrollmentSubjectId,

        subject_id: subjectId,

        subject_code: subject.subject_code,

        subject_name: subject.subject_name,

        units: Number(subject.units || 0),

        old_values: oldValues,

        new_values: newValues,

        offering: {
          offering_id: offering.offering_id,

          faculty_id: offering.faculty_id,

          faculty_name: offering.faculty_name,

          room_id: offering.room_id,

          room_name: offering.room_name,

          schedule_days: offering.schedule_days,

          schedule_time: offering.schedule_time,

          max_students: offering.max_students,

          enrolled_count: offering.enrolled_count,
        },
      });
    }

    // =================================================
    // ABORT BEFORE WRITING IF ANY REGULAR SUBJECT
    // CANNOT BE SAFELY PLACED
    //
    // This gives us ALL-OR-NOTHING placement.
    // =================================================

    if (placementErrors.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        code: "BULK_PLACEMENT_NOT_READY",

        message:
          "Bulk section placement could not continue because one or more regular subjects do not have exactly one available READY offering.",

        section: {
          section_id: sectionId,

          section_name: section.section_name,
        },

        summary: {
          regular_subjects: regularSubjects.length,

          ready_to_assign: placementPlan.length,

          already_correct: skippedSubjects.length,

          errors: placementErrors.length,

          manual_subjects: manualSubjects.length,
        },

        errors: placementErrors,

        already_correct: skippedSubjects,

        manual_subjects: manualSubjects,
      });
    }

    // =================================================
    // NOTHING NEEDS TO CHANGE
    //
    // All regular subjects may already be correctly
    // assigned to this section.
    // =================================================

    if (placementPlan.length === 0) {
      await connection.rollback();

      return res.status(200).json({
        success: true,

        message:
          "All regular subjects are already assigned to the selected section.",

        section: {
          section_id: sectionId,

          section_name: section.section_name,
        },

        summary: {
          regular_subjects: regularSubjects.length,

          assigned: 0,

          already_correct: skippedSubjects.length,

          manual_subjects: manualSubjects.length,
        },

        already_correct: skippedSubjects,

        manual_subjects: manualSubjects,

        actor: {
          user_id: actor.user_id,

          username: actor.username,
        },
      });
    }

    // =================================================
    // APPLY BULK PLACEMENT
    //
    // We reached this point only after ALL Regular
    // subjects passed the readiness checks.
    // =================================================

    const assignedSubjects = [];

    for (const item of placementPlan) {
      // ===============================================
      // UPDATE ENROLLMENT SUBJECT
      // ===============================================

      const [updateResult] = await connection.execute(
        `
            UPDATE enrollment_subjects

            SET
                offering_id = ?,
                section_id = ?,
                section_subject_id = ?

            WHERE enrollment_subject_id = ?

              AND enrollment_id = ?

              AND status = 'Enrolled'
          `,
        [
          item.new_values.offering_id,
          item.new_values.section_id,
          item.new_values.section_subject_id,

          item.enrollment_subject_id,
          enrollmentId,
        ],
      );

      // ===============================================
      // VERIFY UPDATE
      // ===============================================

      if (updateResult.affectedRows === 0) {
        throw new Error(
          `Bulk placement failed while updating ${item.subject_code}.`,
        );
      }

      // ===============================================
      // SUBJECT CHANGE HISTORY
      //
      // Existing enum supports:
      //
      // ADD
      // DROP
      // REMOVE
      // CHANGE
      //
      // Bulk assignment therefore uses CHANGE.
      // ===============================================

      await connection.execute(
        `
          INSERT INTO enrollment_subject_changes (
              enrollment_id,
              enrollment_subject_id,
              subject_id,

              change_type,

              old_offering_id,
              old_section_id,
              old_section_subject_id,

              new_offering_id,
              new_section_id,
              new_section_subject_id,

              reason,
              changed_by
          )

          VALUES (
              ?,
              ?,
              ?,

              'CHANGE',

              ?,
              ?,
              ?,

              ?,
              ?,
              ?,

              ?,
              ?
          )
        `,
        [
          enrollmentId,
          item.enrollment_subject_id,
          item.subject_id,

          item.old_values.offering_id,
          item.old_values.section_id,
          item.old_values.section_subject_id,

          item.new_values.offering_id,
          item.new_values.section_id,
          item.new_values.section_subject_id,

          reason,
          actor.user_id,
        ],
      );

      // ===============================================
      // AUDIT TRAIL
      // ===============================================

      await connection.execute(
        `
          INSERT INTO audit_trail (
              user_id,
              table_name,
              record_id,
              action,
              old_values,
              new_values
          )

          VALUES (
              ?,
              'enrollment_subjects',
              ?,
              'UPDATE',
              ?,
              ?
          )
        `,
        [
          actor.user_id,

          item.enrollment_subject_id,

          JSON.stringify({
            ...item.old_values,

            bulk_section_assignment: false,
          }),

          JSON.stringify({
            ...item.new_values,

            bulk_section_assignment: true,

            target_section_name: section.section_name,
          }),
        ],
      );

      // ===============================================
      // RESPONSE ITEM
      // ===============================================

      assignedSubjects.push({
        enrollment_subject_id: item.enrollment_subject_id,

        subject_id: item.subject_id,

        subject_code: item.subject_code,

        subject_name: item.subject_name,

        units: item.units,

        classification: "REGULAR",

        placement: {
          offering_id: item.new_values.offering_id,

          section_id: item.new_values.section_id,

          section_name: section.section_name,

          section_subject_id: item.new_values.section_subject_id,
        },

        faculty: {
          faculty_id: item.offering.faculty_id,

          faculty_name: item.offering.faculty_name,
        },

        room: {
          room_id: item.offering.room_id,

          room_name: item.offering.room_name,
        },

        schedule: {
          days: item.offering.schedule_days,

          time: item.offering.schedule_time,
        },

        capacity: {
          max_students: item.offering.max_students,

          enrolled_count_after_assignment: item.offering.enrolled_count + 1,

          available_slots_after_assignment: Math.max(
            item.offering.max_students - (item.offering.enrolled_count + 1),
            0,
          ),
        },
      });
    }

    // =================================================
    // AUDIT THE BULK ENROLLMENT ACTION ITSELF
    //
    // Subject-level audit entries already exist above.
    // This enrollment-level record makes it obvious that
    // Registrar performed one bulk placement operation.
    // =================================================

    await connection.execute(
      `
        INSERT INTO audit_trail (
            user_id,
            table_name,
            record_id,
            action,
            old_values,
            new_values
        )

        VALUES (
            ?,
            'enrollments',
            ?,
            'UPDATE',
            ?,
            ?
        )
      `,
      [
        actor.user_id,

        enrollmentId,

        JSON.stringify({
          bulk_section_assignment: false,
        }),

        JSON.stringify({
          bulk_section_assignment: true,

          section_id: sectionId,

          section_name: section.section_name,

          subjects_assigned: assignedSubjects.length,

          subjects_already_correct: skippedSubjects.length,

          manual_subjects: manualSubjects.length,
        }),
      ],
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

      message: `Regular subjects were successfully assigned to ${section.section_name}.`,

      enrollment: {
        enrollment_id: enrollmentId,

        enrollment_status: enrollment.enrollment_status,

        student_id: Number(enrollment.student_id),

        student_number: enrollment.student_number,

        student_name: [
          enrollment.first_name,
          enrollment.middle_name,
          enrollment.last_name,
        ]
          .filter(Boolean)
          .join(" "),

        course: {
          course_id: courseId,

          course_code: enrollment.course_code,

          course_name: enrollment.course_name,
        },

        year_level: yearLevel,

        academic_period: {
          academic_year_id: academicYearId,

          academic_year: enrollment.academic_year,

          semester_id: semesterId,

          semester_name: enrollment.semester_name,
        },
      },

      section: {
        section_id: sectionId,

        section_name: section.section_name,

        course_id: Number(section.course_id),

        academic_year_id: Number(section.academic_year_id),

        year_level: Number(section.year_level),

        max_students:
          section.max_students !== null ? Number(section.max_students) : null,
      },

      summary: {
        total_active_subjects: subjectRows.length,

        regular_subjects: regularSubjects.length,

        assigned: assignedSubjects.length,

        already_correct: skippedSubjects.length,

        manual_subjects: manualSubjects.length,

        errors: 0,
      },

      assigned_subjects: assignedSubjects,

      already_correct: skippedSubjects,

      manual_subjects: manualSubjects,

      actor: {
        user_id: actor.user_id,

        username: actor.username,
      },
    });
  } catch (error) {
    // =================================================
    // ROLLBACK
    //
    // If ONE subject fails, NONE of the bulk
    // assignments are committed.
    // =================================================

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("BULK SECTION PLACEMENT ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("BULK SECTION PLACEMENT ERROR:", error);

    return res.status(500).json({
      success: false,

      code: "BULK_SECTION_PLACEMENT_FAILED",

      message: "Failed to bulk assign the enrollment to the selected section.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// ASSIGN / CHANGE SUBJECT OFFERING
//
// PUT /api/registrar/enrollments/:id/subjects/:enrollmentSubjectId
//
// BODY:
//
// {
//   "offering_id": 15,
//   "reason": "Registrar assigned student to this class."
// }
//
// PURPOSE:
//
// - Assign an offering to an unassigned Pending subject
// - Change an existing offering when correction is allowed
// - Supports Pending and Approved enrollments
// - Student never chooses the offering
// - Subject itself cannot be changed by this route
//
// IMPORTANT:
//
// Pending + unassigned:
//   Normal Registrar placement.
//
// Pending + already assigned:
//   Registrar placement correction.
//
// Approved:
//   Official correction.
//   Any existing Grade V2 row permanently locks placement
//   from ordinary correction.
//
// ACADEMIC RULES:
//
// - Subject must still be academically eligible.
// - Subject must belong to active Student curriculum.
// - Regular subject must belong to current curriculum term.
// - Regular subject must use matching year-level section.
// - Retake may use another compatible section.
// - Offering must be same subject/course/AY/semester.
// - Offering + section subject must both be Open.
// - Capacity enforced.
// - Room remains optional.
// - Every successful assignment/change is audited.
// =====================================================

router.put("/:id/subjects/:enrollmentSubjectId", async (req, res) => {
  let connection;
  let transactionActive = false;

  try {
    // =================================================
    // 1. AUTHENTICATED REGISTRAR
    // =================================================

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
    }

    if (req.user.role_name !== "Registrar") {
      return res.status(403).json({
        success: false,
        message: "Registrar access is required.",
      });
    }

    const changedBy = Number(req.user.user_id);

    if (!Number.isInteger(changedBy) || changedBy <= 0) {
      return res.status(401).json({
        success: false,
        message: "Authenticated Registrar user ID is invalid.",
      });
    }

    // =================================================
    // 2. IDS
    // =================================================

    const enrollmentId = Number(req.params.id);

    const enrollmentSubjectId = Number(req.params.enrollmentSubjectId);

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    if (!Number.isInteger(enrollmentSubjectId) || enrollmentSubjectId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment subject ID.",
      });
    }

    // =================================================
    // 3. REQUEST BODY
    //
    // Only offering_id is trusted for placement.
    // =================================================

    const offeringId = Number(req.body?.offering_id);

    if (!Number.isInteger(offeringId) || offeringId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid offering ID.",
      });
    }

    const providedReason =
      typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

    if (providedReason.length > 500) {
      return res.status(400).json({
        success: false,
        message: "Reason must not exceed 500 characters.",
      });
    }

    // =================================================
    // 4. CONNECTION + TRANSACTION
    // =================================================

    connection = await db.getConnection();

    await connection.beginTransaction();

    transactionActive = true;

    // =================================================
    // 5. GET ENROLLMENT + STUDENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
            SELECT
                e.enrollment_id,
                e.student_id,
                e.academic_year_id,
                e.semester_id,
                e.enrollment_status,

                s.student_number,
                s.first_name,
                s.middle_name,
                s.last_name,

                s.course_id,
                s.year_level,

                c.course_code,
                c.course_name

            FROM enrollments e

            INNER JOIN students s
                ON s.student_id =
                   e.student_id

            INNER JOIN courses c
                ON c.course_id =
                   s.course_id

            WHERE e.enrollment_id = ?

            LIMIT 1

            FOR UPDATE
          `,
      [enrollmentId],
    );

    if (enrollmentRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    const studentId = Number(enrollment.student_id);

    const courseId = Number(enrollment.course_id);

    const yearLevel = Number(enrollment.year_level);

    const academicYearId = Number(enrollment.academic_year_id);

    const semesterId = Number(enrollment.semester_id);

    const enrollmentStatus = String(enrollment.enrollment_status);

    // =================================================
    // 6. ENROLLMENT STATUS
    // =================================================

    if (!["Pending", "Approved"].includes(enrollmentStatus)) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        message: `Subject placement cannot be changed because enrollment status is "${enrollmentStatus}".`,
      });
    }

    // =================================================
    // 7. GET CURRENT ENROLLMENT SUBJECT
    // =================================================

    const [subjectRows] = await connection.execute(
      `
            SELECT
                es.enrollment_subject_id,
                es.enrollment_id,
                es.subject_id,
                es.enrollment_type,

                es.offering_id,
                es.section_id,
                es.section_subject_id,
                

                es.status,

                sub.subject_code,
                sub.subject_name,
                sub.units,
                sub.is_active
                    AS subject_is_active,

                sec.section_name
                    AS current_section_name

            FROM enrollment_subjects es

            INNER JOIN subjects sub
                ON sub.subject_id =
                   es.subject_id

            LEFT JOIN sections sec
                ON sec.section_id =
                   es.section_id

            WHERE es.enrollment_subject_id = ?

              AND es.enrollment_id = ?

            LIMIT 1

            FOR UPDATE
          `,
      [enrollmentSubjectId, enrollmentId],
    );

    if (subjectRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(404).json({
        success: false,
        message: "Enrollment subject not found.",
      });
    }

    const currentSubject = subjectRows[0];

    const subjectId = Number(currentSubject.subject_id);

    const enrollmentType = String(currentSubject.enrollment_type || "").trim();

    const allowedEnrollmentTypes = ["Regular", "Retake", "Carry Over"];

    if (!allowedEnrollmentTypes.includes(enrollmentType)) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "INVALID_ENROLLMENT_TYPE",

        message: "The enrollment subject has an invalid enrollment type.",

        enrollment_subject_id: enrollmentSubjectId,

        enrollment_type: enrollmentType || null,

        allowed_enrollment_types: allowedEnrollmentTypes,
      });
    }

    // =================================================
    // 8. SUBJECT STATUS
    // =================================================

    if (currentSubject.status !== "Enrolled") {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "ENROLLMENT_SUBJECT_NOT_EDITABLE",

        message: `Subject placement cannot be changed because its status is "${currentSubject.status}".`,
      });
    }

    if (Number(currentSubject.subject_is_active) !== 1) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,
        message: "The enrollment subject is inactive.",
      });
    }

    // =================================================
    // 9. DETERMINE INITIAL ASSIGNMENT OR CORRECTION
    // =================================================

    const oldOfferingId =
      currentSubject.offering_id !== null
        ? Number(currentSubject.offering_id)
        : null;

    const oldSectionId =
      currentSubject.section_id !== null
        ? Number(currentSubject.section_id)
        : null;

    const oldSectionSubjectId =
      currentSubject.section_subject_id !== null
        ? Number(currentSubject.section_subject_id)
        : null;

    const isInitialAssignment =
      oldOfferingId === null &&
      oldSectionId === null &&
      oldSectionSubjectId === null;

    // =================================================
    // 10. REASON
    //
    // Initial Pending placement may use standard audit
    // text.
    //
    // Corrections / Approved changes need explicit
    // Registrar reason.
    // =================================================

    if (
      (!isInitialAssignment || enrollmentStatus === "Approved") &&
      !providedReason
    ) {
      await connection.rollback();
      transactionActive = false;

      return res.status(400).json({
        success: false,

        code: "CORRECTION_REASON_REQUIRED",

        message:
          "A reason is required for this Registrar placement correction.",
      });
    }

    const auditReason =
      providedReason || "Registrar assigned subject offering.";

    // =================================================
    // 11. SAME OFFERING
    // =================================================

    if (oldOfferingId !== null && oldOfferingId === offeringId) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,
        code: "OFFERING_ALREADY_ASSIGNED",
        message: "The selected offering is already assigned to this subject.",
      });
    }

    // =================================================
    // 12. GRADE LOCK
    //
    // Approved enrollment correction becomes unsafe
    // once ANY Grade V2 record exists:
    //
    // Draft
    // Submitted
    // Returned
    // Approved
    //
    // Normal correction must not silently move the
    // student after grading has started.
    // =================================================

    if (enrollmentStatus === "Approved") {
      const [gradeRows] = await connection.execute(
        `
              SELECT
                  grade_id,
                  grade_status,
                  final_rating

              FROM grades

              WHERE enrollment_subject_id = ?

              LIMIT 1

              FOR UPDATE
            `,
        [enrollmentSubjectId],
      );

      if (gradeRows.length > 0) {
        await connection.rollback();
        transactionActive = false;

        return res.status(409).json({
          success: false,

          code: "SUBJECT_GRADE_LOCKED",

          message:
            "This subject placement cannot be changed because grading has already started.",

          grade: {
            grade_id: Number(gradeRows[0].grade_id),

            grade_status: gradeRows[0].grade_status,

            final_rating:
              gradeRows[0].final_rating !== null
                ? Number(gradeRows[0].final_rating)
                : null,
          },
        });
      }
    }

    // =================================================
    // 13. ACTIVE ASSIGNED CURRICULUM
    // =================================================

    const [curriculumRows] = await connection.execute(
      `
            SELECT
                sc.student_curriculum_id,
                sc.curriculum_id,

                cur.curriculum_name

            FROM student_curriculum sc

            INNER JOIN curriculum cur
                ON cur.curriculum_id =
                   sc.curriculum_id

            WHERE sc.student_id = ?

              AND sc.status = 'Active'

              AND cur.is_active = 1

              AND cur.course_id = ?

            ORDER BY
                sc.assigned_date DESC,
                sc.student_curriculum_id DESC

            LIMIT 1
          `,
      [studentId, courseId],
    );

    if (curriculumRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "VALID_ACTIVE_CURRICULUM_REQUIRED",

        message: "The Student does not have a valid active curriculum.",
      });
    }

    const curriculum = curriculumRows[0];

    const curriculumId = Number(curriculum.curriculum_id);

    // =================================================
    // 14. SUBJECT MUST BELONG TO CURRICULUM
    // =================================================

    const [curriculumSubjectRows] = await connection.execute(
      `
            SELECT
                curriculum_subject_id,
                curriculum_id,
                subject_id,
                year_level,
                semester_id,
                is_required,
                display_order

            FROM curriculum_subjects

            WHERE curriculum_id = ?

              AND subject_id = ?

            LIMIT 1
          `,
      [curriculumId, subjectId],
    );

    if (curriculumSubjectRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "SUBJECT_NOT_IN_ASSIGNED_CURRICULUM",

        message:
          "The enrollment subject does not belong to the Student's active curriculum.",
      });
    }

    const curriculumSubject = curriculumSubjectRows[0];

    // =================================================
    // 15. REVALIDATE GRADE V2 ELIGIBILITY
    //
    // Important if an official grade changed between
    // Student submission and Registrar placement.
    // =================================================

    const academicEligibility = await evaluateSubjectEligibility(
      studentId,
      subjectId,
      connection,
    );

    if (!academicEligibility.eligible) {
      await connection.rollback();
      transactionActive = false;

      let code = "SUBJECT_NOT_ACADEMICALLY_ELIGIBLE";

      if (
        academicEligibility.eligibility_type === ELIGIBILITY_TYPE.ALREADY_PASSED
      ) {
        code = "SUBJECT_ALREADY_PASSED";
      } else if (
        academicEligibility.eligibility_type ===
        ELIGIBILITY_TYPE.BLOCKED_PREREQUISITE
      ) {
        code = "PREREQUISITE_NOT_PASSED";
      } else if (
        academicEligibility.eligibility_type === ELIGIBILITY_TYPE.UNRESOLVED
      ) {
        code = "ACADEMIC_RESULT_UNRESOLVED";
      }

      return res.status(409).json({
        success: false,

        code,

        message:
          academicEligibility.reason ||
          "The Student is no longer academically eligible for this subject.",

        academic_eligibility: academicEligibility,
      });
    }
    // =================================================
    // STORED ENROLLMENT TYPE CONTRACT
    //
    // enrollment_subjects.enrollment_type is the
    // permanent classification of this enrollment
    // attempt.
    //
    // We revalidate it against current academic truth.
    // =================================================

    let enrollmentTypeMatchesAcademicTruth = false;

    let evaluatedEnrollmentType = academicEligibility.eligibility_type || null;

    let carryOverEligibility = null;

    // =================================================
    // REGULAR
    // =================================================

    if (enrollmentType === "Regular") {
      enrollmentTypeMatchesAcademicTruth =
        academicEligibility.eligibility_type === ELIGIBILITY_TYPE.REGULAR;
    }

    // =================================================
    // RETAKE
    // =================================================
    else if (enrollmentType === "Retake") {
      enrollmentTypeMatchesAcademicTruth =
        academicEligibility.eligibility_type === ELIGIBILITY_TYPE.RETAKE;
    }
    // =================================================
    // CARRY OVER
    //
    // A persisted Carry Over row represents an
    // enrollment classification that was already
    // resolved when the subject was added.
    //
    // Generic academic eligibility can legitimately
    // return REGULAR for an untaken earlier-term
    // subject.
    //
    // getCarryOverCandidates() may also stop returning
    // the subject once that Carry Over row already
    // exists in the current enrollment.
    //
    // Therefore accept Carry Over when either:
    //
    // 1. The dedicated carry-over evaluator still
    //    returns the subject; OR
    //
    // 2. The subject is academically eligible as
    //    REGULAR and belongs to an earlier curriculum
    //    term than the Student's current term.
    // =================================================
    else if (enrollmentType === "Carry Over") {
      const carryOverEvaluation = await getCarryOverCandidates(
        studentId,
        curriculumId,
        yearLevel,
        semesterId,
        connection,
      );

      carryOverEligibility =
        carryOverEvaluation.eligible.find(
          (item) => Number(item.subject_id) === subjectId,
        ) || null;

      const curriculumYearLevel = Number(curriculumSubject.year_level);

      const curriculumSemesterId = Number(curriculumSubject.semester_id);

      const isEarlierCurriculumTerm =
        curriculumYearLevel < yearLevel ||
        (curriculumYearLevel === yearLevel &&
          curriculumSemesterId < semesterId);

      const persistedCarryOverStillValid =
        academicEligibility.eligible &&
        academicEligibility.eligibility_type === ELIGIBILITY_TYPE.REGULAR &&
        isEarlierCurriculumTerm;

      enrollmentTypeMatchesAcademicTruth =
        Boolean(carryOverEligibility) || persistedCarryOverStillValid;

      if (enrollmentTypeMatchesAcademicTruth) {
        evaluatedEnrollmentType = ELIGIBILITY_TYPE.CARRY_OVER;
      }
    }
    // =================================================
    // REJECT STORED TYPE / ACADEMIC TYPE MISMATCH
    // =================================================

    if (!enrollmentTypeMatchesAcademicTruth) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "ENROLLMENT_TYPE_ACADEMIC_MISMATCH",

        message:
          "The stored enrollment type no longer matches the Student's current academic eligibility.",

        enrollment_subject_id: enrollmentSubjectId,

        subject_id: subjectId,

        subject_code: currentSubject.subject_code,

        stored_enrollment_type: enrollmentType,

        evaluated_enrollment_type: evaluatedEnrollmentType,

        academic_eligibility: academicEligibility,

        carry_over_eligibility: carryOverEligibility,
      });
    }
    // =================================================
    // 16. REGULAR TERM VALIDATION
    //
    // Retake may originate from an earlier term.
    // =================================================

    if (enrollmentType === "Regular") {
      if (
        Number(curriculumSubject.year_level) !== yearLevel ||
        Number(curriculumSubject.semester_id) !== semesterId
      ) {
        await connection.rollback();
        transactionActive = false;

        return res.status(409).json({
          success: false,

          code: "REGULAR_SUBJECT_OUTSIDE_CURRENT_TERM",

          message:
            "This Regular subject does not belong to the Student's current curriculum term.",
        });
      }
    }

    // =================================================
    // 17. GET AUTHORITATIVE OFFERING
    // =================================================

    const [offeringRows] = await connection.execute(
      `
            SELECT
                so.offering_id,
                so.section_subject_id,
                so.subject_id,
                so.section_id,

                so.faculty_id,
                so.room_id,

                so.academic_year_id,
                so.semester_id,

                so.schedule_days,
                so.schedule_time,

                so.max_students,

                so.status
                    AS offering_status,

                ss.subject_id
                    AS section_subject_subject_id,

                ss.section_id
                    AS section_subject_section_id,

                ss.academic_year_id
                    AS section_subject_academic_year_id,

                ss.semester_id
                    AS section_subject_semester_id,

                ss.status
                    AS section_subject_status,

                sec.section_name,

                sec.course_id
                    AS section_course_id,

                sec.year_level
                    AS section_year_level,

                sub.subject_code,
                sub.subject_name,
                sub.units,

                sub.is_active
                    AS offering_subject_is_active,

                r.capacity
                    AS room_capacity

            FROM subject_offerings so

            INNER JOIN section_subjects ss
                ON ss.section_subject_id =
                   so.section_subject_id

            INNER JOIN sections sec
                ON sec.section_id =
                   so.section_id

            INNER JOIN subjects sub
                ON sub.subject_id =
                   so.subject_id

            LEFT JOIN rooms r
                ON r.room_id =
                   so.room_id

            WHERE so.offering_id = ?

            LIMIT 1

            FOR UPDATE
          `,
      [offeringId],
    );

    if (offeringRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(404).json({
        success: false,
        message: "Subject offering not found.",
      });
    }

    const offering = offeringRows[0];

    // =================================================
    // 18. OFFERING MUST BE SAME SUBJECT
    // =================================================

    if (Number(offering.subject_id) !== subjectId) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_SUBJECT_MISMATCH",

        message: "The selected offering belongs to a different subject.",
      });
    }

    // =================================================
    // 19. RELATIONSHIP INTEGRITY
    // =================================================

    if (
      Number(offering.section_subject_subject_id) !== subjectId ||
      Number(offering.section_subject_section_id) !==
        Number(offering.section_id)
    ) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "INVALID_OFFERING_RELATIONSHIP",

        message:
          "The selected offering has an invalid section-subject relationship.",
      });
    }

    // =================================================
    // 20. ACTIVE SUBJECT
    // =================================================

    if (Number(offering.offering_subject_is_active) !== 1) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,
        message: "The offering subject is inactive.",
      });
    }

    // =================================================
    // 21. COURSE
    // =================================================

    if (
      enrollmentType === "Regular" &&
      Number(offering.section_course_id) !== courseId
    ) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_COURSE_MISMATCH",

        message:
          "A Regular subject must be assigned to an offering within the Student's course.",

        student_course_id: courseId,

        offering_course_id: Number(offering.section_course_id),
      });
    }

    // =================================================
    // 22. ACADEMIC YEAR
    // =================================================

    if (
      Number(offering.academic_year_id) !== academicYearId ||
      Number(offering.section_subject_academic_year_id) !== academicYearId
    ) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_ACADEMIC_YEAR_MISMATCH",

        message: "The selected offering belongs to a different academic year.",
      });
    }

    // =================================================
    // 23. SEMESTER
    // =================================================

    if (
      Number(offering.semester_id) !== semesterId ||
      Number(offering.section_subject_semester_id) !== semesterId
    ) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_SEMESTER_MISMATCH",

        message: "The selected offering belongs to a different semester.",
      });
    }

    // =================================================
    // 24. OPEN STATUS
    //
    // Both layers must be Open.
    // =================================================

    if (offering.offering_status !== "Open") {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_NOT_OPEN",

        message: `The selected offering is currently "${offering.offering_status}".`,
      });
    }

    if (offering.section_subject_status !== "Open") {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "SECTION_SUBJECT_NOT_OPEN",

        message: `The selected section subject is currently "${offering.section_subject_status}".`,
      });
    }

    // =================================================
    // 25. REGULAR SECTION YEAR LEVEL
    //
    // Retakes may use a compatible lower/higher
    // section when necessary.
    // =================================================

    if (
      enrollmentType === "Regular" &&
      Number(offering.section_year_level) !== yearLevel
    ) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "REGULAR_SECTION_YEAR_LEVEL_MISMATCH",

        message:
          "A Regular subject must be assigned to a section matching the Student's current year level.",

        student_year_level: yearLevel,

        section_year_level: Number(offering.section_year_level),
      });
    }

    // =================================================
    // 26. OFFERING READINESS
    //
    // Room remains OPTIONAL.
    // =================================================

    const maxStudents = Number(offering.max_students || 0);

    const missingConfiguration = [];

    if (!offering.faculty_id) {
      missingConfiguration.push("faculty");
    }

    if (!offering.schedule_days || !String(offering.schedule_days).trim()) {
      missingConfiguration.push("schedule_days");
    }

    if (!offering.schedule_time || !String(offering.schedule_time).trim()) {
      missingConfiguration.push("schedule_time");
    }

    if (!Number.isInteger(maxStudents) || maxStudents <= 0) {
      missingConfiguration.push("capacity");
    }

    if (missingConfiguration.length > 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_NOT_READY",

        message: "The selected offering is not fully configured.",

        missing_configuration: missingConfiguration,
      });
    }
    // =================================================
    // STUDENT'S OTHER ASSIGNED CLASSES
    //
    // Used for student schedule-conflict validation.
    //
    // IMPORTANT:
    // - Same enrollment only.
    // - Exclude the subject currently being assigned.
    // - Only active Enrolled memberships.
    // - Only classes with an actual offering.
    // - Cancelled offerings / section-subjects do not
    //   participate.
    // =================================================

    const [otherAssignedSubjectRows] = await connection.execute(
      `
      SELECT
          es.enrollment_subject_id,
          es.subject_id,
          es.enrollment_type,

          es.offering_id,
          es.section_id,
          es.section_subject_id,

          sub.subject_code,
          sub.subject_name,

          so.schedule_days,
          so.schedule_time,

          so.status
              AS offering_status,

          ss.status
              AS section_subject_status,

          sec.section_name

      FROM enrollment_subjects es

      INNER JOIN subjects sub
          ON sub.subject_id =
             es.subject_id

      INNER JOIN subject_offerings so
          ON so.offering_id =
             es.offering_id

      INNER JOIN section_subjects ss
          ON ss.section_subject_id =
             es.section_subject_id

      INNER JOIN sections sec
          ON sec.section_id =
             es.section_id

      WHERE es.enrollment_id = ?

        AND es.enrollment_subject_id <> ?

        AND es.status = 'Enrolled'

        AND es.offering_id IS NOT NULL

        AND so.status <> 'Cancelled'

        AND ss.status <> 'Cancelled'

      ORDER BY
          sub.subject_code ASC,
          es.enrollment_subject_id ASC
    `,
      [enrollmentId, enrollmentSubjectId],
    );

    // =================================================
    // STUDENT SCHEDULE CONFLICT VALIDATION
    //
    // Candidate offering must not overlap any other
    // active assigned subject in this enrollment.
    // =================================================

    const studentScheduleConflicts = [];

    for (const existingSubject of otherAssignedSubjectRows) {
      const overlap = enrollmentSchedulesOverlap(
        offering.schedule_days,
        offering.schedule_time,
        existingSubject.schedule_days,
        existingSubject.schedule_time,
      );

      if (!overlap.overlap) {
        continue;
      }

      studentScheduleConflicts.push({
        enrollment_subject_id: Number(existingSubject.enrollment_subject_id),

        subject_id: Number(existingSubject.subject_id),

        subject_code: existingSubject.subject_code,

        subject_name: existingSubject.subject_name,

        enrollment_type: existingSubject.enrollment_type,

        offering_id:
          existingSubject.offering_id !== null
            ? Number(existingSubject.offering_id)
            : null,

        section_id:
          existingSubject.section_id !== null
            ? Number(existingSubject.section_id)
            : null,

        section_name: existingSubject.section_name || null,

        schedule: {
          days: existingSubject.schedule_days,

          time: existingSubject.schedule_time,
        },

        common_days: overlap.common_days,
      });
    }

    if (studentScheduleConflicts.length > 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "STUDENT_SCHEDULE_CONFLICT",

        message:
          "The selected offering conflicts with one or more of the Student's currently assigned classes.",

        enrollment_subject: {
          enrollment_subject_id: enrollmentSubjectId,

          subject_id: subjectId,

          subject_code: currentSubject.subject_code,

          enrollment_type: enrollmentType,
        },

        selected_offering: {
          offering_id: Number(offering.offering_id),

          section_id: Number(offering.section_id),

          section_name: offering.section_name || null,

          schedule: {
            days: offering.schedule_days,

            time: offering.schedule_time,
          },
        },

        conflict_count: studentScheduleConflicts.length,

        conflicts: studentScheduleConflicts,
      });
    }
    // =================================================
    // 27. ROOM CAPACITY
    //
    // Only enforce when a room exists.
    // =================================================

    if (
      offering.room_capacity !== null &&
      Number(offering.room_capacity) > 0 &&
      maxStudents > Number(offering.room_capacity)
    ) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_EXCEEDS_ROOM_CAPACITY",

        message: "The offering capacity exceeds the assigned room capacity.",
      });
    }

    // =================================================
    // 28. CAPACITY
    //
    // Exclude this enrollment_subject because this
    // route may move an already assigned student.
    // =================================================

    const [capacityRows] = await connection.execute(
      `
            SELECT
                COUNT(*) AS enrolled_count

            FROM enrollment_subjects es

            INNER JOIN enrollments e
                ON e.enrollment_id =
                   es.enrollment_id

            WHERE es.offering_id = ?

              AND es.enrollment_subject_id <> ?

              AND es.status IN (
                  'Enrolled',
                  'Completed',
                  'Failed',
                  'Incomplete'
              )

              AND e.enrollment_status IN (
                  'Pending',
                  'Approved'
              )
          `,
      [offeringId, enrollmentSubjectId],
    );

    const enrolledCount = Number(capacityRows[0]?.enrolled_count || 0);

    if (enrolledCount >= maxStudents) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_FULL",

        message: "The selected offering is already full.",

        capacity: {
          max_students: maxStudents,

          enrolled_count: enrolledCount,

          available_slots: 0,
        },
      });
    }

    // =================================================
    // 29. UPDATE PLACEMENT
    // =================================================

    const [updateResult] = await connection.execute(
      `
            UPDATE enrollment_subjects

            SET
                offering_id = ?,
                section_id = ?,
                section_subject_id = ?

            WHERE enrollment_subject_id = ?

              AND enrollment_id = ?

              AND status = 'Enrolled'
          `,
      [
        Number(offering.offering_id),

        Number(offering.section_id),

        Number(offering.section_subject_id),

        enrollmentSubjectId,
        enrollmentId,
      ],
    );

    if (updateResult.affectedRows !== 1) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        message:
          "Subject placement could not be updated because the enrollment subject changed.",
      });
    }

    // =================================================
    // 30. AUDIT HISTORY
    // =================================================

    await connection.execute(
      `
          INSERT INTO enrollment_subject_changes (
              enrollment_id,
              enrollment_subject_id,
              subject_id,

              change_type,

              old_offering_id,
              old_section_id,
              old_section_subject_id,

              new_offering_id,
              new_section_id,
              new_section_subject_id,

              reason,
              changed_by
          )

          VALUES (
              ?,
              ?,
              ?,

              'CHANGE',

              ?,
              ?,
              ?,

              ?,
              ?,
              ?,

              ?,
              ?
          )
        `,
      [
        enrollmentId,
        enrollmentSubjectId,
        subjectId,

        oldOfferingId,
        oldSectionId,
        oldSectionSubjectId,

        Number(offering.offering_id),

        Number(offering.section_id),

        Number(offering.section_subject_id),

        auditReason,
        changedBy,
      ],
    );

    // =================================================
    // 31. COMMIT
    // =================================================

    await connection.commit();

    transactionActive = false;

    // =================================================
    // 32. RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      message: isInitialAssignment
        ? "Subject offering assigned successfully."
        : "Subject offering changed successfully.",

      assignment_type: isInitialAssignment
        ? "INITIAL_ASSIGNMENT"
        : "CORRECTION",

      enrollment: {
        enrollment_id: enrollmentId,

        enrollment_status: enrollmentStatus,

        student_id: studentId,

        student_number: enrollment.student_number,
      },

      enrollment_subject: {
        enrollment_subject_id: enrollmentSubjectId,

        enrollment_id: enrollmentId,

        subject_id: subjectId,

        subject_code: offering.subject_code,

        subject_name: offering.subject_name,

        units: Number(offering.units || 0),

        status: currentSubject.status,

        offering_id: Number(offering.offering_id),

        section_id: Number(offering.section_id),

        section_subject_id: Number(offering.section_subject_id),

        section_name: offering.section_name,

        section_year_level: Number(offering.section_year_level),

        faculty_id: Number(offering.faculty_id),

        room_id: offering.room_id !== null ? Number(offering.room_id) : null,

        schedule_days: offering.schedule_days,

        schedule_time: offering.schedule_time,
      },

      academic_eligibility: {
        eligible: academicEligibility.eligible,

        eligibility_type: academicEligibility.eligibility_type,

        reason: academicEligibility.reason,

        latest_approved_grade: academicEligibility.latest_approved_grade,

        prerequisites: academicEligibility.prerequisites,
      },

      history: {
        change_type: "CHANGE",

        old_offering_id: oldOfferingId,

        old_section_id: oldSectionId,

        old_section_subject_id: oldSectionSubjectId,

        new_offering_id: Number(offering.offering_id),

        new_section_id: Number(offering.section_id),

        new_section_subject_id: Number(offering.section_subject_id),

        reason: auditReason,

        changed_by: changedBy,
      },
    });
  } catch (error) {
    if (connection && transactionActive) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "REGISTRAR ASSIGN OFFERING ROLLBACK ERROR:",
          rollbackError,
        );
      }
    }

    console.error("REGISTRAR ASSIGN OFFERING ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to assign subject offering.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// ROUTE 9
// GET ENROLLMENT CORRECTION / CHANGE HISTORY
//
// GET
// /api/registrar/enrollments/:id/corrections
//
// Purpose:
// - Show Registrar changes made to enrollment subjects
// - ADD
// - DROP
// - REMOVE
// - CHANGE
//
// Includes:
// - Subject
// - Old offering / section
// - New offering / section
// - Reason
// - Registrar who made the change
// - Date/time
//
// JWT:
// - Registrar authenticated through req.user
// =====================================================

router.get("/:id/corrections", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  // =================================================
  // ENROLLMENT ID
  // =================================================

  const enrollmentId = toPositiveInt(req.params.id);

  if (!enrollmentId) {
    return res.status(400).json({
      success: false,
      message: "Invalid enrollment ID.",
    });
  }

  let connection;

  try {
    connection = await db.getConnection();

    // =================================================
    // VERIFY ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
          SELECT
              e.enrollment_id,
              e.student_id,

              e.academic_year_id,
              e.semester_id,

              e.enrollment_status,

              s.student_number,
              s.first_name,
              s.middle_name,
              s.last_name,

              c.course_id,
              c.course_code,
              c.course_name,

              ay.academic_year,
              sem.semester_name

          FROM enrollments e

          INNER JOIN students s
              ON s.student_id =
                 e.student_id

          LEFT JOIN courses c
              ON c.course_id =
                 s.course_id

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 e.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 e.semester_id

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
    // GET CHANGE HISTORY
    // =================================================

    const [historyRows] = await connection.execute(
      `
          SELECT
              esc.change_id,
              esc.enrollment_id,
              esc.enrollment_subject_id,
              esc.subject_id,

              esc.change_type,

              -- =========================================
              -- SUBJECT
              -- =========================================

              sub.subject_code,
              sub.subject_name,
              sub.units,

              -- =========================================
              -- OLD ASSIGNMENT
              -- =========================================

              esc.old_offering_id,
              esc.old_section_id,
              esc.old_section_subject_id,

              old_sec.section_name
                  AS old_section_name,

              old_so.schedule_days
                  AS old_schedule_days,

              old_so.schedule_time
                  AS old_schedule_time,

              old_so.status
                  AS old_offering_status,

              -- =========================================
              -- NEW ASSIGNMENT
              -- =========================================

              esc.new_offering_id,
              esc.new_section_id,
              esc.new_section_subject_id,

              new_sec.section_name
                  AS new_section_name,

              new_so.schedule_days
                  AS new_schedule_days,

              new_so.schedule_time
                  AS new_schedule_time,

              new_so.status
                  AS new_offering_status,

              -- =========================================
              -- REASON / ACTOR
              -- =========================================

              esc.reason,
              esc.changed_by,

              changer.username
                  AS changed_by_username,

              esc.created_at

          FROM enrollment_subject_changes esc

          LEFT JOIN subjects sub
              ON sub.subject_id =
                 esc.subject_id

          -- =============================================
          -- OLD OFFERING / SECTION
          -- =============================================

          LEFT JOIN subject_offerings old_so
              ON old_so.offering_id =
                 esc.old_offering_id

          LEFT JOIN sections old_sec
              ON old_sec.section_id =
                 esc.old_section_id

          -- =============================================
          -- NEW OFFERING / SECTION
          -- =============================================

          LEFT JOIN subject_offerings new_so
              ON new_so.offering_id =
                 esc.new_offering_id

          LEFT JOIN sections new_sec
              ON new_sec.section_id =
                 esc.new_section_id

          -- =============================================
          -- REGISTRAR
          -- =============================================

          LEFT JOIN users changer
              ON changer.user_id =
                 esc.changed_by

          WHERE esc.enrollment_id = ?

          ORDER BY
              esc.created_at DESC,
              esc.change_id DESC
          `,
      [enrollmentId],
    );

    // =================================================
    // FORMAT HISTORY
    // =================================================

    const history = historyRows.map((row) => ({
      change_id: Number(row.change_id),

      enrollment_id: Number(row.enrollment_id),

      enrollment_subject_id: row.enrollment_subject_id
        ? Number(row.enrollment_subject_id)
        : null,

      subject: {
        subject_id: row.subject_id ? Number(row.subject_id) : null,

        subject_code: row.subject_code || null,

        subject_name: row.subject_name || null,

        units:
          row.units !== null && row.units !== undefined
            ? Number(row.units)
            : null,
      },

      change_type: row.change_type,

      // ===========================================
      // OLD
      // ===========================================

      old: {
        offering_id: row.old_offering_id ? Number(row.old_offering_id) : null,

        section_id: row.old_section_id ? Number(row.old_section_id) : null,

        section_name: row.old_section_name || null,

        section_subject_id: row.old_section_subject_id
          ? Number(row.old_section_subject_id)
          : null,

        schedule_days: row.old_schedule_days || null,

        schedule_time: row.old_schedule_time || null,

        offering_status: row.old_offering_status || null,
      },

      // ===========================================
      // NEW
      // ===========================================

      new: {
        offering_id: row.new_offering_id ? Number(row.new_offering_id) : null,

        section_id: row.new_section_id ? Number(row.new_section_id) : null,

        section_name: row.new_section_name || null,

        section_subject_id: row.new_section_subject_id
          ? Number(row.new_section_subject_id)
          : null,

        schedule_days: row.new_schedule_days || null,

        schedule_time: row.new_schedule_time || null,

        offering_status: row.new_offering_status || null,
      },

      reason: row.reason || null,

      changed_by: {
        user_id: row.changed_by ? Number(row.changed_by) : null,

        username: row.changed_by_username || null,
      },

      created_at: row.created_at,
    }));

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      enrollment: {
        enrollment_id: Number(enrollment.enrollment_id),

        student_id: Number(enrollment.student_id),

        student_number: enrollment.student_number,

        student_name: [
          enrollment.first_name,
          enrollment.middle_name,
          enrollment.last_name,
        ]
          .filter(Boolean)
          .join(" "),

        course: {
          course_id: enrollment.course_id ? Number(enrollment.course_id) : null,

          course_code: enrollment.course_code || null,

          course_name: enrollment.course_name || null,
        },

        academic_period: {
          academic_year_id: Number(enrollment.academic_year_id),

          academic_year: enrollment.academic_year,

          semester_id: Number(enrollment.semester_id),

          semester_name: enrollment.semester_name,
        },

        enrollment_status: enrollment.enrollment_status,
      },

      count: history.length,

      history,

      actor: {
        user_id: actor.user_id,

        username: actor.username,
      },
    });
  } catch (error) {
    console.error("GET ENROLLMENT CORRECTION HISTORY ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to load enrollment correction history.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});
// =====================================================
// ADD SUBJECT TO ENROLLMENT
//
// POST /api/registrar/enrollments/:id/subjects
//
// BODY:
//
// {
//   "offering_id": 123,
//   "reason": "Registrar added subject."
// }
//
// ALLOWED:
//
// Pending enrollment
// Approved enrollment correction
//
// ACADEMIC RULES:
//
// REGULAR:
// - Must belong to Student's active curriculum
// - Must belong to Student's current year level
// - Must belong to enrollment semester
// - Must satisfy prerequisites
// - Must not already be passed
//
// RETAKE:
// - Must belong to Student's active curriculum
// - Latest official Approved rating must be 4.00 or 5.00
// - Must still satisfy prerequisites
//
// CARRY OVER:
// - Must belong to Student's active curriculum
// - Must come from an earlier required curriculum term
// - Must never have a resolved official attempt
// - Must still satisfy prerequisites
//
// IRREGULAR PLACEMENT:
// - Retake / Carry Over may use another section/year/course
// - The offering must still use the exact same subject_id
// - Same academic year and semester remain mandatory
//
// IMPORTANT:
//
// - Registrar chooses the offering.
// - Subject is derived from the offering.
// - Frontend cannot inject subject_id / section_id.
// - Grade V2 academic evaluation is authoritative.
// - Every change is audited.
// =====================================================

router.post("/:id/subjects", async (req, res) => {
  let connection;
  let transactionActive = false;

  try {
    // =================================================
    // 1. AUTHENTICATED REGISTRAR
    // =================================================

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
    }

    if (req.user.role_name !== "Registrar") {
      return res.status(403).json({
        success: false,
        message: "Registrar access is required.",
      });
    }

    const changedBy = Number(req.user.user_id);

    if (!Number.isInteger(changedBy) || changedBy <= 0) {
      return res.status(401).json({
        success: false,
        message: "Authenticated Registrar user ID is invalid.",
      });
    }

    // =================================================
    // 2. ENROLLMENT ID
    // =================================================

    const enrollmentId = Number(req.params.id);

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // 3. REQUEST BODY
    //
    // Registrar sends ONLY offering_id.
    //
    // section_id / subject_id / section_subject_id
    // are derived from the authoritative offering.
    // =================================================

    const offeringId = Number(req.body?.offering_id);

    if (!Number.isInteger(offeringId) || offeringId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid offering ID.",
      });
    }

    const reason =
      typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: "Reason is required when the Registrar adds a subject.",
      });
    }

    if (reason.length > 500) {
      return res.status(400).json({
        success: false,
        message: "Reason must not exceed 500 characters.",
      });
    }

    // =================================================
    // 4. CONNECTION + TRANSACTION
    // =================================================

    connection = await db.getConnection();

    await connection.beginTransaction();

    transactionActive = true;

    // =================================================
    // 5. GET ENROLLMENT + STUDENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
          SELECT
              e.enrollment_id,
              e.student_id,
              e.academic_year_id,
              e.semester_id,
              e.enrollment_status,

              s.student_number,
              s.first_name,
              s.middle_name,
              s.last_name,
              s.course_id,
              s.section_id AS student_section_id,
              s.year_level,

              c.course_code,
              c.course_name

          FROM enrollments e

          INNER JOIN students s
              ON s.student_id =
                 e.student_id

          INNER JOIN courses c
              ON c.course_id =
                 s.course_id

          WHERE e.enrollment_id = ?

          LIMIT 1

          FOR UPDATE
        `,
      [enrollmentId],
    );

    if (enrollmentRows.length === 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    const studentId = Number(enrollment.student_id);

    const studentCourseId = Number(enrollment.course_id);

    const studentHomeSectionId =
      enrollment.student_section_id !== null
        ? Number(enrollment.student_section_id)
        : null;

    const studentYearLevel = Number(enrollment.year_level);

    // =================================================
    // 6. ENROLLMENT STATUS
    //
    // Pending:
    // Registrar is still preparing official placement.
    //
    // Approved:
    // Registrar correction; must be audited.
    // =================================================

    const enrollmentStatus = String(enrollment.enrollment_status);

    if (!["Pending", "Approved"].includes(enrollmentStatus)) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        message: `Subject cannot be added because enrollment status is "${enrollmentStatus}".`,
      });
    }

    // =================================================
    // 7. ACTIVE ASSIGNED CURRICULUM
    // =================================================

    const [curriculumRows] = await connection.execute(
      `
          SELECT
              sc.student_curriculum_id,
              sc.curriculum_id,
              sc.status AS assignment_status,

              cur.curriculum_name,
              cur.course_id,
              cur.is_active

          FROM student_curriculum sc

          INNER JOIN curriculum cur
              ON cur.curriculum_id =
                 sc.curriculum_id

          WHERE sc.student_id = ?

            AND sc.status = 'Active'

            AND cur.is_active = 1

            AND cur.course_id = ?

          ORDER BY
              sc.assigned_date DESC,
              sc.student_curriculum_id DESC

          LIMIT 1
        `,
      [studentId, studentCourseId],
    );

    if (curriculumRows.length === 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "VALID_ACTIVE_CURRICULUM_REQUIRED",

        message:
          "The Student does not have a valid active curriculum for this enrollment.",
      });
    }

    const curriculum = curriculumRows[0];

    const curriculumId = Number(curriculum.curriculum_id);

    // =================================================
    // 8. GET AUTHORITATIVE OFFERING
    //
    // We derive:
    //
    // subject
    // section
    // section_subject
    // faculty
    // room
    // schedule
    //
    // from offering_id.
    // =================================================

    const [offeringRows] = await connection.execute(
      `
          SELECT
              so.offering_id,
              so.section_subject_id,
              so.subject_id,
              so.section_id,

              so.faculty_id,
              so.room_id,

              so.academic_year_id,
              so.semester_id,

              so.schedule_days,
              so.schedule_time,

              so.max_students,

              so.status
                  AS offering_status,

              ss.subject_id
                  AS section_subject_subject_id,

              ss.section_id
                  AS section_subject_section_id,

              ss.academic_year_id
                  AS section_subject_academic_year_id,

              ss.semester_id
                  AS section_subject_semester_id,

              ss.status
                  AS section_subject_status,

              sec.course_id
                  AS section_course_id,

              sec.year_level
                  AS section_year_level,

              sec.section_name,

              sub.subject_code,
              sub.subject_name,
              sub.units,
              sub.is_active
                  AS subject_is_active,

              r.capacity
                  AS room_capacity

          FROM subject_offerings so

          INNER JOIN section_subjects ss
              ON ss.section_subject_id =
                 so.section_subject_id

          INNER JOIN sections sec
              ON sec.section_id =
                 so.section_id

          INNER JOIN subjects sub
              ON sub.subject_id =
                 so.subject_id

          LEFT JOIN rooms r
              ON r.room_id =
                 so.room_id

          WHERE so.offering_id = ?

          LIMIT 1

          FOR UPDATE
        `,
      [offeringId],
    );

    if (offeringRows.length === 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(404).json({
        success: false,
        message: "Subject offering not found.",
      });
    }

    const offering = offeringRows[0];

    const subjectId = Number(offering.subject_id);

    // =================================================
    // 9. OFFERING RELATIONSHIP INTEGRITY
    // =================================================

    if (
      Number(offering.section_subject_subject_id) !== subjectId ||
      Number(offering.section_subject_section_id) !==
        Number(offering.section_id)
    ) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "INVALID_OFFERING_RELATIONSHIP",

        message:
          "The subject offering has an invalid section-subject relationship.",
      });
    }

    // =================================================
    // 10. ACTIVE SUBJECT
    // =================================================

    if (Number(offering.subject_is_active) !== 1) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        message: "The subject connected to this offering is inactive.",
      });
    }

    // =================================================
    // 11. COURSE PLACEMENT POLICY IS VALIDATED LATER
    //
    // The enrollment type must be resolved first.
    // Regular subjects remain same-course/same-year.
    // Retake / Carry Over may use another valid
    // section/course when the offering uses the exact
    // same subject_id.
    // =================================================

    // =================================================
    // 12. ACADEMIC YEAR
    // =================================================

    if (
      Number(offering.academic_year_id) !==
        Number(enrollment.academic_year_id) ||
      Number(offering.section_subject_academic_year_id) !==
        Number(enrollment.academic_year_id)
    ) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_ACADEMIC_YEAR_MISMATCH",

        message:
          "The selected offering does not belong to the enrollment academic year.",
      });
    }

    // =================================================
    // 13. SEMESTER
    // =================================================

    if (
      Number(offering.semester_id) !== Number(enrollment.semester_id) ||
      Number(offering.section_subject_semester_id) !==
        Number(enrollment.semester_id)
    ) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_SEMESTER_MISMATCH",

        message:
          "The selected offering does not belong to the enrollment semester.",
      });
    }

    // =================================================
    // 14. OFFERING + SECTION SUBJECT MUST BE OPEN
    // =================================================

    if (offering.offering_status !== "Open") {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_NOT_OPEN",

        message: `The selected offering is currently "${offering.offering_status}".`,
      });
    }

    if (offering.section_subject_status !== "Open") {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "SECTION_SUBJECT_NOT_OPEN",

        message: `The section subject is currently "${offering.section_subject_status}".`,
      });
    }

    // =================================================
    // 15. OFFERING READINESS
    //
    // Open offerings should already be configured,
    // but re-check here for defense in depth.
    // =================================================

    const maxStudents = Number(offering.max_students || 0);

    const configurationMissing = [];

    if (!offering.faculty_id) {
      configurationMissing.push("faculty");
    }

    if (!offering.schedule_days || !String(offering.schedule_days).trim()) {
      configurationMissing.push("schedule_days");
    }

    if (!offering.schedule_time || !String(offering.schedule_time).trim()) {
      configurationMissing.push("schedule_time");
    }

    if (!Number.isInteger(maxStudents) || maxStudents <= 0) {
      configurationMissing.push("capacity");
    }

    if (configurationMissing.length > 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_NOT_READY",

        message: "The selected offering is not fully configured.",

        missing_configuration: configurationMissing,
      });
    }

    // =================================================
    // 16. ROOM CAPACITY
    // =================================================

    if (
      offering.room_capacity !== null &&
      Number(offering.room_capacity) > 0 &&
      maxStudents > Number(offering.room_capacity)
    ) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_EXCEEDS_ROOM_CAPACITY",

        message: "The offering capacity exceeds the assigned room capacity.",
      });
    }

    // =================================================
    // 17. SUBJECT MUST BELONG TO ACTIVE CURRICULUM
    //
    // Normal Registrar additions are curriculum-bound.
    //
    // Special non-curriculum exceptions should use a
    // separate explicit audited workflow later.
    // =================================================

    const [curriculumSubjectRows] = await connection.execute(
      `
          SELECT
              cs.curriculum_subject_id,
              cs.curriculum_id,
              cs.subject_id,
              cs.year_level,
              cs.semester_id,
              cs.is_required,
              cs.display_order

          FROM curriculum_subjects cs

          WHERE cs.curriculum_id = ?

            AND cs.subject_id = ?

          LIMIT 1
        `,
      [curriculumId, subjectId],
    );

    if (curriculumSubjectRows.length === 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "SUBJECT_NOT_IN_ASSIGNED_CURRICULUM",

        message:
          "The selected subject does not belong to the Student's active curriculum.",
      });
    }

    const curriculumSubject = curriculumSubjectRows[0];

    // =================================================
    // 18. GRADE V2 ACADEMIC ELIGIBILITY
    //
    // Shared service checks:
    //
    // Approved enrollment
    // + Approved grade
    // + final_rating
    // + prerequisites
    //
    // This replaces old duplicated Grade V1 logic.
    // =================================================

    const academicEligibility = await evaluateSubjectEligibility(
      studentId,
      subjectId,
      connection,
    );

    if (!academicEligibility.eligible) {
      await connection.rollback();

      transactionActive = false;

      let code = "SUBJECT_NOT_ACADEMICALLY_ELIGIBLE";

      if (
        academicEligibility.eligibility_type === ELIGIBILITY_TYPE.ALREADY_PASSED
      ) {
        code = "SUBJECT_ALREADY_PASSED";
      } else if (
        academicEligibility.eligibility_type ===
        ELIGIBILITY_TYPE.BLOCKED_PREREQUISITE
      ) {
        code = "PREREQUISITE_NOT_PASSED";
      } else if (
        academicEligibility.eligibility_type === ELIGIBILITY_TYPE.UNRESOLVED
      ) {
        code = "ACADEMIC_RESULT_UNRESOLVED";
      }

      return res.status(409).json({
        success: false,

        code,

        message:
          academicEligibility.reason ||
          "The Student is not academically eligible for this subject.",

        academic_eligibility: academicEligibility,
      });
    }

    // =================================================
    // 19. AUTHORITATIVE ENROLLMENT TYPE
    //
    // Retake:
    //   Approved failed/incomplete prior result.
    //
    // Regular:
    //   Current curriculum year + semester.
    //
    // Carry Over:
    //   Earlier required subject never officially taken
    //   and still academically eligible.
    // =================================================

    let resolvedEnrollmentType = null;

    if (academicEligibility.eligibility_type === ELIGIBILITY_TYPE.RETAKE) {
      resolvedEnrollmentType = "Retake";
    } else if (
      academicEligibility.eligibility_type === ELIGIBILITY_TYPE.REGULAR
    ) {
      const isCurrentCurriculumTerm =
        Number(curriculumSubject.year_level) === studentYearLevel &&
        Number(curriculumSubject.semester_id) ===
          Number(enrollment.semester_id);

      if (isCurrentCurriculumTerm) {
        resolvedEnrollmentType = "Regular";
      } else {
        const carryOverEvaluation = await getCarryOverCandidates(
          studentId,
          curriculumId,
          studentYearLevel,
          Number(enrollment.semester_id),
          connection,
        );

        const carryOverSubject = carryOverEvaluation.eligible.find(
          (item) => Number(item.subject_id) === subjectId,
        );

        if (carryOverSubject) {
          resolvedEnrollmentType = "Carry Over";
        }
      }
    }

    if (!resolvedEnrollmentType) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "ENROLLMENT_TYPE_COULD_NOT_BE_RESOLVED",

        message:
          "The subject is academically eligible but could not be classified as Regular, Retake, or Carry Over.",

        subject: {
          subject_id: subjectId,

          subject_code: offering.subject_code || null,
        },

        academic_eligibility_type: academicEligibility.eligibility_type || null,
      });
    }

    // =================================================
    // TYPE-AWARE OFFERING PLACEMENT
    //
    // Regular:
    // - current curriculum term
    // - same course
    // - same year-level section
    //
    // Retake / Carry Over:
    // - exact subject_id is already authoritative
    // - same AY / semester is already enforced above
    // - cross-course / cross-year placement is allowed
    // =================================================

    if (resolvedEnrollmentType === "Regular") {
      if (Number(offering.section_course_id) !== studentCourseId) {
        await connection.rollback();

        transactionActive = false;

        return res.status(409).json({
          success: false,

          code: "OFFERING_COURSE_MISMATCH",

          message:
            "A Regular subject must be assigned to an offering within the Student's course.",

          student_course_id: studentCourseId,

          offering_course_id: Number(offering.section_course_id),
        });
      }

      if (Number(offering.section_year_level) !== studentYearLevel) {
        await connection.rollback();

        transactionActive = false;

        return res.status(409).json({
          success: false,

          code: "REGULAR_SECTION_YEAR_LEVEL_MISMATCH",

          message:
            "A Regular subject must use a section matching the Student's current year level.",

          student_year_level: studentYearLevel,

          section_year_level: Number(offering.section_year_level),
        });
      }
    }
    // =================================================
    // 20. DUPLICATE / PREVIOUS MEMBERSHIP
    // =================================================

    const [existingRows] = await connection.execute(
      `
          SELECT
              enrollment_subject_id,
              subject_id,
              enrollment_type,
              offering_id,
              section_id,
              section_subject_id,
              status

          FROM enrollment_subjects

          WHERE enrollment_id = ?

            AND subject_id = ?

          ORDER BY
              enrollment_subject_id DESC

          FOR UPDATE
        `,
      [enrollmentId, subjectId],
    );

    const activeExisting = existingRows.find(
      (row) => !["Dropped", "Withdrawn"].includes(String(row.status)),
    );

    if (activeExisting) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "SUBJECT_ALREADY_IN_ENROLLMENT",

        message: "This subject is already part of the enrollment.",

        enrollment_subject_id: Number(activeExisting.enrollment_subject_id),

        status: activeExisting.status,
      });
    }

    // =================================================
    // 21. STUDENT SCHEDULE CONFLICT
    //
    // The new offering must not overlap another active
    // assigned subject in this enrollment.
    // =================================================

    const [assignedScheduleRows] = await connection.execute(
      `
          SELECT
              es.enrollment_subject_id,
              es.subject_id,
              es.enrollment_type,
              es.offering_id,
              es.section_id,

              sub.subject_code,
              sub.subject_name,

              sec.section_name,

              so.schedule_days,
              so.schedule_time

          FROM enrollment_subjects es

          INNER JOIN subjects sub
              ON sub.subject_id =
                 es.subject_id

          INNER JOIN subject_offerings so
              ON so.offering_id =
                 es.offering_id

          INNER JOIN section_subjects ss
              ON ss.section_subject_id =
                 es.section_subject_id

          INNER JOIN sections sec
              ON sec.section_id =
                 es.section_id

          WHERE es.enrollment_id = ?

         AND es.status IN (
    'Enrolled',
    'Completed',
    'Failed',
    'Incomplete'
)

            AND es.offering_id IS NOT NULL

            AND so.status <> 'Cancelled'

            AND ss.status <> 'Cancelled'

          ORDER BY
              es.enrollment_subject_id ASC
        `,
      [enrollmentId],
    );

    const studentScheduleConflicts = [];

    for (const existingSubject of assignedScheduleRows) {
      const overlap = enrollmentSchedulesOverlap(
        offering.schedule_days,
        offering.schedule_time,
        existingSubject.schedule_days,
        existingSubject.schedule_time,
      );

      if (!overlap.overlap) {
        continue;
      }

      studentScheduleConflicts.push({
        enrollment_subject_id: Number(existingSubject.enrollment_subject_id),

        subject_id: Number(existingSubject.subject_id),

        subject_code: existingSubject.subject_code,

        subject_name: existingSubject.subject_name,

        enrollment_type: existingSubject.enrollment_type,

        offering_id:
          existingSubject.offering_id !== null
            ? Number(existingSubject.offering_id)
            : null,

        section_id:
          existingSubject.section_id !== null
            ? Number(existingSubject.section_id)
            : null,

        section_name: existingSubject.section_name || null,

        schedule: {
          days: existingSubject.schedule_days,

          time: existingSubject.schedule_time,
        },

        common_days: overlap.common_days,
      });
    }

    if (studentScheduleConflicts.length > 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "STUDENT_SCHEDULE_CONFLICT",

        message:
          "The selected offering conflicts with one or more of the Student's currently assigned classes.",

        enrollment_type: resolvedEnrollmentType,

        selected_offering: {
          offering_id: Number(offering.offering_id),

          section_id: Number(offering.section_id),

          section_name: offering.section_name || null,

          schedule: {
            days: offering.schedule_days,

            time: offering.schedule_time,
          },
        },

        conflict_count: studentScheduleConflicts.length,

        conflicts: studentScheduleConflicts,
      });
    }

    // =================================================
    // 22. CAPACITY
    //
    // Count all official/current assigned membership,
    // not only freshly Enrolled rows.
    // =================================================

    const [capacityRows] = await connection.execute(
      `
          SELECT
              COUNT(*) AS enrolled_count

          FROM enrollment_subjects es

          INNER JOIN enrollments e
              ON e.enrollment_id =
                 es.enrollment_id

          WHERE es.offering_id = ?

            AND es.status IN (
                'Enrolled',
                'Completed',
                'Failed',
                'Incomplete'
            )

            AND e.enrollment_status IN (
                'Pending',
                'Approved'
            )
        `,
      [offeringId],
    );

    const enrolledCount = Number(capacityRows[0]?.enrolled_count || 0);

    if (enrolledCount >= maxStudents) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_FULL",

        message: "The selected subject offering is already full.",

        capacity: {
          max_students: maxStudents,

          enrolled_count: enrolledCount,

          available_slots: 0,
        },
      });
    }

    // =================================================
    // 23. RESTORE DROPPED/WITHDRAWN ROW OR INSERT NEW
    // =================================================

    const restorable = existingRows.find((row) =>
      ["Dropped", "Withdrawn"].includes(String(row.status)),
    );

    let enrollmentSubjectId;

    let restored = false;

    if (restorable) {
      // ===============================================
      // GRADE LOCK
      //
      // Never reuse/change a historical
      // enrollment_subject once any grade row exists.
      // ===============================================

      const [gradeRows] = await connection.execute(
        `
            SELECT
                grade_id,
                grade_status

            FROM grades

            WHERE enrollment_subject_id = ?

            LIMIT 1

            FOR UPDATE
          `,
        [Number(restorable.enrollment_subject_id)],
      );

      if (gradeRows.length > 0) {
        await connection.rollback();

        transactionActive = false;

        return res.status(409).json({
          success: false,

          code: "SUBJECT_GRADE_LOCKED",

          message:
            "This previous subject record cannot be restored because a grade record already exists for it.",

          grade: {
            grade_id: Number(gradeRows[0].grade_id),

            grade_status: gradeRows[0].grade_status,
          },
        });
      }

      enrollmentSubjectId = Number(restorable.enrollment_subject_id);

      const [restoreResult] = await connection.execute(
        `
            UPDATE enrollment_subjects

            SET
                enrollment_type = ?,
                offering_id = ?,
                section_id = ?,
                section_subject_id = ?,
                status = 'Enrolled'

            WHERE enrollment_subject_id = ?

              AND enrollment_id = ?

              AND status IN (
                  'Dropped',
                  'Withdrawn'
              )
          `,
        [
          resolvedEnrollmentType,

          Number(offering.offering_id),

          Number(offering.section_id),

          Number(offering.section_subject_id),

          enrollmentSubjectId,

          enrollmentId,
        ],
      );

      if (restoreResult.affectedRows !== 1) {
        await connection.rollback();

        transactionActive = false;

        return res.status(409).json({
          success: false,

          message:
            "The previous subject record could not be restored because its status changed.",
        });
      }

      restored = true;

      // ===============================================
      // AUDIT RESTORATION AS ADD
      // ===============================================

      await connection.execute(
        `
          INSERT INTO enrollment_subject_changes (
              enrollment_id,
              enrollment_subject_id,
              subject_id,

              change_type,

              old_offering_id,
              old_section_id,
              old_section_subject_id,

              new_offering_id,
              new_section_id,
              new_section_subject_id,

              reason,
              changed_by
          )

          VALUES (
              ?,
              ?,
              ?,

              'ADD',

              ?,
              ?,
              ?,

              ?,
              ?,
              ?,

              ?,
              ?
          )
        `,
        [
          enrollmentId,

          enrollmentSubjectId,

          subjectId,

          restorable.offering_id,

          restorable.section_id,

          restorable.section_subject_id,

          Number(offering.offering_id),

          Number(offering.section_id),

          Number(offering.section_subject_id),

          reason,

          changedBy,
        ],
      );
    } else {
      // ===============================================
      // INSERT NEW MEMBERSHIP
      // ===============================================

      const [insertResult] = await connection.execute(
        `
            INSERT INTO enrollment_subjects (
                enrollment_id,
                subject_id,
                enrollment_type,
                offering_id,
                section_id,
                section_subject_id,
                status
            )

            VALUES (
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                'Enrolled'
            )
          `,
        [
          enrollmentId,

          subjectId,

          resolvedEnrollmentType,

          Number(offering.offering_id),

          Number(offering.section_id),

          Number(offering.section_subject_id),
        ],
      );

      if (insertResult.affectedRows !== 1) {
        await connection.rollback();

        transactionActive = false;

        return res.status(500).json({
          success: false,

          message: "Subject could not be added to the enrollment.",
        });
      }

      enrollmentSubjectId = Number(insertResult.insertId);

      // ===============================================
      // AUDIT NEW ADDITION
      //
      // Correct change_type = ADD
      // ===============================================

      await connection.execute(
        `
          INSERT INTO enrollment_subject_changes (
              enrollment_id,
              enrollment_subject_id,
              subject_id,

              change_type,

              old_offering_id,
              old_section_id,
              old_section_subject_id,

              new_offering_id,
              new_section_id,
              new_section_subject_id,

              reason,
              changed_by
          )

          VALUES (
              ?,
              ?,
              ?,

              'ADD',

              NULL,
              NULL,
              NULL,

              ?,
              ?,
              ?,

              ?,
              ?
          )
        `,
        [
          enrollmentId,

          enrollmentSubjectId,

          subjectId,

          Number(offering.offering_id),

          Number(offering.section_id),

          Number(offering.section_subject_id),

          reason,

          changedBy,
        ],
      );
    }

    // =================================================
    // 24. COMMIT
    // =================================================

    await connection.commit();

    transactionActive = false;

    // =================================================
    // 25. RESPONSE
    // =================================================

    return res.status(restored ? 200 : 201).json({
      success: true,

      message: restored
        ? "Previously dropped subject restored successfully."
        : "Subject added to enrollment successfully.",

      restored,

      enrollment: {
        enrollment_id: enrollmentId,

        enrollment_status: enrollmentStatus,

        student_id: studentId,

        student_number: enrollment.student_number,
      },

      enrollment_subject: {
        enrollment_subject_id: enrollmentSubjectId,

        enrollment_id: enrollmentId,

        subject_id: subjectId,

        subject_code: offering.subject_code,

        subject_name: offering.subject_name,

        enrollment_type: resolvedEnrollmentType,

        is_irregular:
          resolvedEnrollmentType === "Retake" ||
          resolvedEnrollmentType === "Carry Over" ||
          (studentHomeSectionId !== null &&
            Number(offering.section_id) !== studentHomeSectionId) ||
          Number(offering.section_course_id) !== studentCourseId ||
          Number(offering.section_year_level) !== studentYearLevel,

        home_section_id: studentHomeSectionId,

        placement_flags: {
          cross_section:
            studentHomeSectionId !== null &&
            Number(offering.section_id) !== studentHomeSectionId,

          cross_course: Number(offering.section_course_id) !== studentCourseId,

          cross_year: Number(offering.section_year_level) !== studentYearLevel,
        },

        units: Number(offering.units || 0),

        offering_id: Number(offering.offering_id),

        section_id: Number(offering.section_id),

        section_subject_id: Number(offering.section_subject_id),

        section_name: offering.section_name,

        faculty_id: Number(offering.faculty_id),

        room_id: offering.room_id !== null ? Number(offering.room_id) : null,

        schedule_days: offering.schedule_days,

        schedule_time: offering.schedule_time,

        status: "Enrolled",
      },

      academic_eligibility: {
        eligible: academicEligibility.eligible,

        eligibility_type: academicEligibility.eligibility_type,

        resolved_enrollment_type: resolvedEnrollmentType,

        reason: academicEligibility.reason,

        latest_approved_grade: academicEligibility.latest_approved_grade,

        prerequisites: academicEligibility.prerequisites,
      },

      history: {
        change_type: "ADD",

        reason,

        changed_by: changedBy,
      },
    });
  } catch (error) {
    if (connection && transactionActive) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("REGISTRAR ADD SUBJECT ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("REGISTRAR ADD SUBJECT ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to add subject to enrollment.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});
// =====================================================
// GET SUBJECTS AVAILABLE FOR ADDITION
//
// GET /api/registrar/enrollments/:id/available-subjects
//
// PURPOSE:
//
// Return only subjects that Registrar may legitimately
// add to this enrollment.
//
// SUPPORTED TYPES:
//
// Regular
// - Current curriculum year + semester
// - Same student course
// - Same student year-level section
//
// Retake
// - Latest official Approved result is 4.00 / 5.00
// - Exact same subject
// - Cross-section / cross-year / cross-course allowed
//
// Carry Over
// - Earlier required curriculum subject
// - Never officially resolved
// - Prerequisites currently satisfied
// - Exact same subject
// - Cross-section / cross-year / cross-course allowed
//
// COMMON OFFERING RULES:
//
// - Same enrollment AY
// - Same enrollment semester
// - Offering Open
// - Section Subject Open
// - Faculty assigned
// - Schedule configured
// - Capacity available
// - Optional room capacity respected
// - Student schedule conflicts excluded
// =====================================================

router.get("/:id/available-subjects", async (req, res) => {
  let connection;

  try {
    // =================================================
    // 1. AUTHENTICATION
    // =================================================

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
    }

    if (req.user.role_name !== "Registrar") {
      return res.status(403).json({
        success: false,
        message: "Registrar access is required.",
      });
    }

    // =================================================
    // 2. ENROLLMENT ID
    // =================================================

    const enrollmentId = Number(req.params.id);

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    connection = await db.getConnection();

    // =================================================
    // 3. ENROLLMENT + STUDENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
        SELECT
            e.enrollment_id,
            e.student_id,
            e.academic_year_id,
            e.semester_id,
            e.enrollment_status,

            s.student_number,
            s.first_name,
            s.middle_name,
            s.last_name,
            s.course_id,
            s.year_level,

            c.course_code,
            c.course_name,

            ay.academic_year,
            sem.semester_name

        FROM enrollments e

        INNER JOIN students s
            ON s.student_id = e.student_id

        INNER JOIN courses c
            ON c.course_id = s.course_id

        INNER JOIN academic_years ay
            ON ay.academic_year_id = e.academic_year_id

        INNER JOIN semesters sem
            ON sem.semester_id = e.semester_id

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

    const studentId = Number(enrollment.student_id);
    const studentCourseId = Number(enrollment.course_id);
    const studentYearLevel = Number(enrollment.year_level);

    const academicYearId = Number(enrollment.academic_year_id);
    const semesterId = Number(enrollment.semester_id);

    const enrollmentStatus = String(enrollment.enrollment_status);

    // =================================================
    // 4. EDITABLE STATUS
    // =================================================

    if (!["Pending", "Approved"].includes(enrollmentStatus)) {
      return res.status(409).json({
        success: false,
        code: "ENROLLMENT_NOT_EDITABLE",
        message: `Subjects cannot be added because enrollment status is "${enrollmentStatus}".`,
        enrollment_status: enrollmentStatus,
      });
    }

    // =================================================
    // 5. ACTIVE STUDENT CURRICULUM
    // =================================================

    const [curriculumRows] = await connection.execute(
      `
        SELECT
            sc.student_curriculum_id,
            sc.curriculum_id,
            sc.status AS assignment_status,

            cur.curriculum_name,
            cur.course_id,
            cur.is_active

        FROM student_curriculum sc

        INNER JOIN curriculum cur
            ON cur.curriculum_id = sc.curriculum_id

        WHERE sc.student_id = ?
          AND sc.status = 'Active'
          AND cur.is_active = 1
          AND cur.course_id = ?

        ORDER BY
            sc.assigned_date DESC,
            sc.student_curriculum_id DESC

        LIMIT 1
      `,
      [studentId, studentCourseId],
    );

    if (curriculumRows.length === 0) {
      return res.status(409).json({
        success: false,
        code: "VALID_ACTIVE_CURRICULUM_REQUIRED",
        message: "The Student does not have a valid active curriculum.",
      });
    }

    const curriculum = curriculumRows[0];
    const curriculumId = Number(curriculum.curriculum_id);

    // =================================================
    // 6. ALL ACTIVE CURRICULUM SUBJECTS
    //
    // We need every term because Retake / Carry Over
    // may originate from an earlier curriculum term.
    // =================================================

    const [curriculumSubjectRows] = await connection.execute(
      `
        SELECT
            cs.curriculum_subject_id,
            cs.curriculum_id,
            cs.subject_id,
            cs.year_level,
            cs.semester_id,
            cs.is_required,
            cs.display_order,

            sub.subject_code,
            sub.subject_name,
            sub.units,
            sub.lecture_hours,
            sub.laboratory_hours,
            sub.is_active

        FROM curriculum_subjects cs

        INNER JOIN subjects sub
            ON sub.subject_id = cs.subject_id

        WHERE cs.curriculum_id = ?
          AND sub.is_active = 1

        ORDER BY
            cs.year_level ASC,
            cs.semester_id ASC,
            cs.display_order ASC,
            sub.subject_code ASC
      `,
      [curriculumId],
    );

    // =================================================
    // 7. SUBJECTS ALREADY ACTIVE IN THIS ENROLLMENT
    //
    // Dropped / Withdrawn rows do not block restoration
    // or a legitimate later add.
    // =================================================

    const [existingRows] = await connection.execute(
      `
        SELECT
            enrollment_subject_id,
            subject_id,
            enrollment_type,
            status

        FROM enrollment_subjects

        WHERE enrollment_id = ?
      `,
      [enrollmentId],
    );

    const activeSubjectIds = new Set(
      existingRows
        .filter(
          (row) =>
            !["Dropped", "Withdrawn"].includes(String(row.status || "").trim()),
        )
        .map((row) => Number(row.subject_id)),
    );

    // =================================================
    // 8. CARRY OVER EVALUATION
    //
    // evaluateSubjectEligibility() by itself may classify
    // a never-taken earlier subject as Regular.
    //
    // getCarryOverCandidates() is authoritative for
    // deciding whether that earlier subject is Carry Over.
    // =================================================

    const carryOverEvaluation = await getCarryOverCandidates(
      studentId,
      curriculumId,
      studentYearLevel,
      semesterId,
      connection,
    );

    const carryOverMap = new Map();

    for (const item of carryOverEvaluation.eligible || []) {
      carryOverMap.set(Number(item.subject_id), item);
    }

    // =================================================
    // 9. RESOLVE ADDABLE SUBJECT TYPES
    // =================================================

    const eligibleSubjectMap = new Map();

    for (const curriculumSubject of curriculumSubjectRows) {
      const subjectId = Number(curriculumSubject.subject_id);

      // Already active in current enrollment.
      if (activeSubjectIds.has(subjectId)) {
        continue;
      }

      const academicEligibility = await evaluateSubjectEligibility(
        studentId,
        subjectId,
        connection,
      );

      if (!academicEligibility.eligible) {
        continue;
      }

      let resolvedEnrollmentType = null;
      let resolvedReason = academicEligibility.reason || null;

      // ===============================================
      // RETAKE
      // ===============================================

      if (academicEligibility.eligibility_type === ELIGIBILITY_TYPE.RETAKE) {
        resolvedEnrollmentType = "Retake";
      }

      // ===============================================
      // REGULAR OR CARRY OVER
      // ===============================================
      else if (
        academicEligibility.eligibility_type === ELIGIBILITY_TYPE.REGULAR
      ) {
        const isCurrentCurriculumTerm =
          Number(curriculumSubject.year_level) === studentYearLevel &&
          Number(curriculumSubject.semester_id) === semesterId;

        if (isCurrentCurriculumTerm) {
          resolvedEnrollmentType = "Regular";
        } else {
          const carryOverSubject = carryOverMap.get(subjectId);

          if (carryOverSubject) {
            resolvedEnrollmentType = "Carry Over";
            resolvedReason =
              carryOverSubject.reason ||
              "Required subject from an earlier curriculum term is academically eligible.";
          }
        }
      }

      if (!resolvedEnrollmentType) {
        continue;
      }

      eligibleSubjectMap.set(subjectId, {
        curriculum_subject: curriculumSubject,
        academic_eligibility: academicEligibility,
        carry_over_eligibility: carryOverMap.get(subjectId) || null,
        enrollment_type: resolvedEnrollmentType,
        reason: resolvedReason,
      });
    }

    // =================================================
    // 10. NO ACADEMIC CANDIDATES
    // =================================================

    if (eligibleSubjectMap.size === 0) {
      return res.status(200).json({
        success: true,

        enrollment: {
          enrollment_id: enrollmentId,
          student_id: studentId,
          student_number: enrollment.student_number,

          student_name: [
            enrollment.first_name,
            enrollment.middle_name,
            enrollment.last_name,
          ]
            .filter(Boolean)
            .join(" "),

          course_id: studentCourseId,
          course_code: enrollment.course_code,
          course_name: enrollment.course_name,

          year_level: studentYearLevel,

          academic_year_id: academicYearId,
          academic_year: enrollment.academic_year,

          semester_id: semesterId,
          semester_name: enrollment.semester_name,

          enrollment_status: enrollmentStatus,
        },

        curriculum: {
          curriculum_id: curriculumId,
          curriculum_name: curriculum.curriculum_name,
        },

        totalSubjects: 0,
        subjects: [],
      });
    }

    const eligibleSubjectIds = Array.from(eligibleSubjectMap.keys());

    const placeholders = eligibleSubjectIds.map(() => "?").join(",");

    // =================================================
    // 11. OFFERINGS
    //
    // IMPORTANT:
    //
    // DO NOT filter sec.course_id here.
    //
    // Regular restrictions are applied below.
    // Retake / Carry Over may legitimately be placed
    // across course/year while keeping exact subject_id.
    // =================================================

    const [offeringRows] = await connection.execute(
      `
        SELECT
            so.offering_id,
            so.section_subject_id,
            so.subject_id,
            so.section_id,

            so.faculty_id,
            so.room_id,

            so.academic_year_id,
            so.semester_id,

            so.schedule_days,
            so.schedule_time,

            so.max_students,

            so.status AS offering_status,

            ss.status AS section_subject_status,
            ss.subject_id AS section_subject_subject_id,
            ss.section_id AS section_subject_section_id,
            ss.academic_year_id AS section_subject_academic_year_id,
            ss.semester_id AS section_subject_semester_id,

            sec.section_name,
            sec.course_id AS section_course_id,
            sec.year_level AS section_year_level,

            course.course_code AS section_course_code,
            course.course_name AS section_course_name,

            sub.subject_code,
            sub.subject_name,
            sub.units,
            sub.lecture_hours,
            sub.laboratory_hours,

            TRIM(
              CONCAT_WS(
                ' ',
                f.first_name,
                NULLIF(f.middle_name, ''),
                f.last_name
              )
            ) AS faculty_name,

            r.room_name,
            r.capacity AS room_capacity,

            (
              SELECT COUNT(*)

              FROM enrollment_subjects es_count

              INNER JOIN enrollments e_count
                  ON e_count.enrollment_id =
                     es_count.enrollment_id

              WHERE es_count.offering_id =
                    so.offering_id

                AND es_count.status IN (
                    'Enrolled',
                    'Completed',
                    'Failed',
                    'Incomplete'
                )

                AND e_count.enrollment_status IN (
                    'Pending',
                    'Approved'
                )
            ) AS enrolled_count

        FROM subject_offerings so

        INNER JOIN section_subjects ss
            ON ss.section_subject_id =
               so.section_subject_id

        INNER JOIN sections sec
            ON sec.section_id =
               so.section_id

        INNER JOIN courses course
            ON course.course_id =
               sec.course_id

        INNER JOIN subjects sub
            ON sub.subject_id =
               so.subject_id

        LEFT JOIN faculty f
            ON f.faculty_id =
               so.faculty_id

        LEFT JOIN rooms r
            ON r.room_id =
               so.room_id

        WHERE so.subject_id IN (${placeholders})

          AND so.academic_year_id = ?
          AND so.semester_id = ?

          AND ss.academic_year_id = ?
          AND ss.semester_id = ?

          AND so.status = 'Open'
          AND ss.status = 'Open'

        ORDER BY
            sub.subject_code ASC,
            sec.section_name ASC,
            so.offering_id ASC
      `,
      [
        ...eligibleSubjectIds,

        academicYearId,
        semesterId,

        academicYearId,
        semesterId,
      ],
    );

    // =================================================
    // 12. CURRENT STUDENT SCHEDULE
    //
    // Discovery should not advertise an offering that
    // the Add Subject mutation will immediately reject.
    // =================================================

    const [assignedScheduleRows] = await connection.execute(
      `
        SELECT
            es.enrollment_subject_id,
            es.subject_id,
            es.enrollment_type,

            es.offering_id,
            es.section_id,

            sub.subject_code,
            sub.subject_name,

            sec.section_name,

            so.schedule_days,
            so.schedule_time

        FROM enrollment_subjects es

        INNER JOIN subjects sub
            ON sub.subject_id =
               es.subject_id

        INNER JOIN subject_offerings so
            ON so.offering_id =
               es.offering_id

        INNER JOIN section_subjects ss
            ON ss.section_subject_id =
               es.section_subject_id

        INNER JOIN sections sec
            ON sec.section_id =
               es.section_id

        WHERE es.enrollment_id = ?

          AND es.status = 'Enrolled'

          AND es.offering_id IS NOT NULL

          AND so.status <> 'Cancelled'
          AND ss.status <> 'Cancelled'

        ORDER BY
            es.enrollment_subject_id ASC
      `,
      [enrollmentId],
    );

    // =================================================
    // 13. BUILD SUBJECT / OFFERING RESPONSE
    // =================================================

    const subjectMap = new Map();

    for (const row of offeringRows) {
      const subjectId = Number(row.subject_id);

      const academicData = eligibleSubjectMap.get(subjectId);

      if (!academicData) {
        continue;
      }

      const resolvedEnrollmentType = academicData.enrollment_type;

      // ===============================================
      // RELATIONSHIP INTEGRITY
      // ===============================================

      const relationshipValid =
        Number(row.section_subject_subject_id) === subjectId &&
        Number(row.section_subject_section_id) === Number(row.section_id) &&
        Number(row.section_subject_academic_year_id) === academicYearId &&
        Number(row.section_subject_semester_id) === semesterId;

      if (!relationshipValid) {
        continue;
      }

      // ===============================================
      // TYPE-AWARE PLACEMENT
      //
      // Regular:
      //   same course + same year
      //
      // Retake / Carry Over:
      //   exact subject only
      //   cross-course/year allowed
      // ===============================================

      if (resolvedEnrollmentType === "Regular") {
        if (Number(row.section_course_id) !== studentCourseId) {
          continue;
        }

        if (Number(row.section_year_level) !== studentYearLevel) {
          continue;
        }
      }

      // ===============================================
      // READY CONFIGURATION
      // ===============================================

      const maxStudents = Number(row.max_students || 0);
      const enrolledCount = Number(row.enrolled_count || 0);

      if (!row.faculty_id) {
        continue;
      }

      if (!row.schedule_days || !String(row.schedule_days).trim()) {
        continue;
      }

      if (!row.schedule_time || !String(row.schedule_time).trim()) {
        continue;
      }

      if (!Number.isInteger(maxStudents) || maxStudents <= 0) {
        continue;
      }

      // Optional room.
      // If a room exists and has a capacity, the offering
      // cannot exceed that room capacity.

      if (
        row.room_capacity !== null &&
        Number(row.room_capacity) > 0 &&
        maxStudents > Number(row.room_capacity)
      ) {
        continue;
      }

      // ===============================================
      // CAPACITY
      // ===============================================

      if (enrolledCount >= maxStudents) {
        continue;
      }

      // ===============================================
      // STUDENT SCHEDULE CONFLICT
      // ===============================================

      const scheduleConflicts = [];

      for (const existingSubject of assignedScheduleRows) {
        const overlap = enrollmentSchedulesOverlap(
          row.schedule_days,
          row.schedule_time,
          existingSubject.schedule_days,
          existingSubject.schedule_time,
        );

        if (!overlap.overlap) {
          continue;
        }

        scheduleConflicts.push({
          enrollment_subject_id: Number(existingSubject.enrollment_subject_id),

          subject_id: Number(existingSubject.subject_id),

          subject_code: existingSubject.subject_code,

          subject_name: existingSubject.subject_name,

          enrollment_type: existingSubject.enrollment_type,

          offering_id:
            existingSubject.offering_id !== null
              ? Number(existingSubject.offering_id)
              : null,

          section_id:
            existingSubject.section_id !== null
              ? Number(existingSubject.section_id)
              : null,

          section_name: existingSubject.section_name || null,

          schedule: {
            days: existingSubject.schedule_days,

            time: existingSubject.schedule_time,
          },

          common_days: overlap.common_days,
        });
      }

      // Do not advertise an offering that POST /subjects
      // will reject for schedule conflict.

      if (scheduleConflicts.length > 0) {
        continue;
      }

      // ===============================================
      // PLACEMENT FLAGS
      // ===============================================

      const crossCourse = Number(row.section_course_id) !== studentCourseId;

      const crossYear = Number(row.section_year_level) !== studentYearLevel;

      const isIrregularPlacement =
        resolvedEnrollmentType === "Retake" ||
        resolvedEnrollmentType === "Carry Over" ||
        crossCourse ||
        crossYear;

      // ===============================================
      // CREATE SUBJECT GROUP
      // ===============================================

      if (!subjectMap.has(subjectId)) {
        const curriculumSubject = academicData.curriculum_subject;

        const academicEligibility = academicData.academic_eligibility;

        subjectMap.set(subjectId, {
          subject_id: subjectId,

          subject_code: curriculumSubject.subject_code,

          subject_name: curriculumSubject.subject_name,

          units: Number(curriculumSubject.units || 0),

          lecture_hours:
            curriculumSubject.lecture_hours !== null
              ? Number(curriculumSubject.lecture_hours)
              : null,

          laboratory_hours:
            curriculumSubject.laboratory_hours !== null
              ? Number(curriculumSubject.laboratory_hours)
              : null,

          curriculum_subject_id: Number(
            curriculumSubject.curriculum_subject_id,
          ),

          curriculum_year_level: Number(curriculumSubject.year_level),

          curriculum_semester_id: Number(curriculumSubject.semester_id),

          enrollment_type: resolvedEnrollmentType,

          is_irregular: resolvedEnrollmentType !== "Regular",

          academic_eligibility: {
            eligible: true,

            eligibility_type:
              resolvedEnrollmentType === "Carry Over"
                ? ELIGIBILITY_TYPE.CARRY_OVER
                : academicEligibility.eligibility_type,

            resolved_enrollment_type: resolvedEnrollmentType,

            reason: academicData.reason,

            latest_approved_grade: academicEligibility.latest_approved_grade,

            prerequisites: academicEligibility.prerequisites,
          },

          offering_count: 0,
          available_offerings: [],
        });
      }

      // ===============================================
      // ADD OFFERING
      // ===============================================

      subjectMap.get(subjectId).available_offerings.push({
        offering_id: Number(row.offering_id),

        offering_status: row.offering_status,

        academic_year_id: Number(row.academic_year_id),

        semester_id: Number(row.semester_id),

        section: {
          section_id: Number(row.section_id),

          section_name: row.section_name,

          year_level:
            row.section_year_level !== null
              ? Number(row.section_year_level)
              : null,

          course_id:
            row.section_course_id !== null
              ? Number(row.section_course_id)
              : null,

          course_code: row.section_course_code || null,

          course_name: row.section_course_name || null,
        },

        section_subject: {
          section_subject_id: Number(row.section_subject_id),

          status: row.section_subject_status,
        },

        faculty: {
          faculty_id: row.faculty_id !== null ? Number(row.faculty_id) : null,

          faculty_name: row.faculty_name || null,
        },

        room: {
          room_id: row.room_id !== null ? Number(row.room_id) : null,

          room_name: row.room_name || null,
        },

        schedule: {
          days: row.schedule_days,

          time: row.schedule_time,
        },

        capacity: {
          max_students: maxStudents,

          enrolled_count: enrolledCount,

          available_slots: Math.max(maxStudents - enrolledCount, 0),

          is_full: enrolledCount >= maxStudents,
        },

        placement_flags: {
          cross_section: false,

          cross_course: crossCourse,

          cross_year: crossYear,
        },

        is_irregular_placement: isIrregularPlacement,

        has_student_schedule_conflict: false,

        student_schedule_conflicts: [],
      });
    }

    // =================================================
    // 14. FINALIZE COUNTS
    // =================================================

    const availableSubjects = Array.from(subjectMap.values())
      .map((subject) => ({
        ...subject,

        offering_count: subject.available_offerings.length,
      }))
      .filter((subject) => subject.available_offerings.length > 0)
      .sort((a, b) =>
        String(a.subject_code).localeCompare(String(b.subject_code)),
      );

    // =================================================
    // 15. RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      enrollment: {
        enrollment_id: enrollmentId,

        student_id: studentId,

        student_number: enrollment.student_number,

        student_name: [
          enrollment.first_name,
          enrollment.middle_name,
          enrollment.last_name,
        ]
          .filter(Boolean)
          .join(" "),

        course_id: studentCourseId,

        course_code: enrollment.course_code,

        course_name: enrollment.course_name,

        year_level: studentYearLevel,

        academic_year_id: academicYearId,

        academic_year: enrollment.academic_year,

        semester_id: semesterId,

        semester_name: enrollment.semester_name,

        enrollment_status: enrollmentStatus,
      },

      curriculum: {
        curriculum_id: curriculumId,

        curriculum_name: curriculum.curriculum_name,
      },

      totalSubjects: availableSubjects.length,

      subjects: availableSubjects,

      actor: {
        user_id: Number(req.user.user_id),

        username: req.user.username || null,
      },
    });
  } catch (error) {
    console.error("GET REGISTRAR AVAILABLE SUBJECTS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve subjects available for addition.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});
// =====================================================
// ROUTE 12
// REMOVE / DEFER / DROP SUBJECT FROM ENROLLMENT
//
// PATCH
// /api/registrar/enrollments/:id/subjects/:enrollmentSubjectId/drop
//
// BODY:
//
// {
//   "reason": "Subject is not offered this semester."
// }
//
// PURPOSE:
//
// PENDING enrollment:
// - Remove/defer a subject from the CURRENT semester.
// - The subject is NOT deleted.
// - The curriculum requirement is NOT deleted.
// - The subject may remain academically outstanding and
//   may appear again later as Carry Over.
//
// APPROVED enrollment:
// - Controlled Registrar post-approval correction.
// - Existing grade relationship prevents dropping.
// - Approved enrollment may not become empty.
//
// IMPORTANT:
//
// - Registrar identity comes from req.user / JWT.
// - Never trust frontend user_id.
// - Never DELETE enrollment_subjects.
// - Subject must currently be Enrolled.
// - ANY grade row locks the subject.
// - Existing placement IDs remain physically stored.
// - enrollment_subject_changes records DROP.
// - audit_trail records the mutation.
// - Everything happens inside one transaction.
// =====================================================

router.patch("/:id/subjects/:enrollmentSubjectId/drop", async (req, res) => {
  // =================================================
  // AUTHENTICATED REGISTRAR
  // =================================================

  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  // =================================================
  // 1. IDS
  // =================================================

  const enrollmentId = toPositiveInt(req.params.id);

  const enrollmentSubjectId = toPositiveInt(req.params.enrollmentSubjectId);

  if (!enrollmentId) {
    return res.status(400).json({
      success: false,

      code: "INVALID_ENROLLMENT_ID",

      message: "Invalid enrollment ID.",
    });
  }

  if (!enrollmentSubjectId) {
    return res.status(400).json({
      success: false,

      code: "INVALID_ENROLLMENT_SUBJECT_ID",

      message: "Invalid enrollment subject ID.",
    });
  }

  // =================================================
  // 2. REASON
  //
  // Every official Registrar correction must explain
  // why the subject was removed/deferred.
  // =================================================

  const dropReason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

  if (!dropReason) {
    return res.status(400).json({
      success: false,

      code: "DROP_REASON_REQUIRED",

      message:
        "A reason is required when removing or dropping an enrollment subject.",
    });
  }

  if (dropReason.length > 500) {
    return res.status(400).json({
      success: false,

      code: "DROP_REASON_TOO_LONG",

      message: "Drop/defer reason must not exceed 500 characters.",
    });
  }

  let connection;

  let transactionActive = false;

  try {
    // =================================================
    // 3. START TRANSACTION
    // =================================================

    connection = await db.getConnection();

    await connection.beginTransaction();

    transactionActive = true;

    // =================================================
    // 4. LOCK ENROLLMENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
            SELECT
                e.enrollment_id,
                e.student_id,

                e.academic_year_id,
                e.semester_id,

                e.enrollment_status,

                s.student_number,
                s.first_name,
                s.middle_name,
                s.last_name,

                s.course_id,

                c.course_code,
                c.course_name,

                ay.academic_year,
                sem.semester_name

            FROM enrollments e

            INNER JOIN students s
                ON s.student_id =
                   e.student_id

            LEFT JOIN courses c
                ON c.course_id =
                   s.course_id

            INNER JOIN academic_years ay
                ON ay.academic_year_id =
                   e.academic_year_id

            INNER JOIN semesters sem
                ON sem.semester_id =
                   e.semester_id

            WHERE e.enrollment_id = ?

            LIMIT 1

            FOR UPDATE
          `,
      [enrollmentId],
    );

    if (enrollmentRows.length === 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(404).json({
        success: false,

        code: "ENROLLMENT_NOT_FOUND",

        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // 5. ENROLLMENT STATUS
    //
    // Pending:
    //   Pre-approval removal/defer.
    //
    // Approved:
    //   Controlled post-approval correction.
    //
    // Other statuses:
    //   Not editable.
    // =================================================

    const enrollmentStatus = String(enrollment.enrollment_status || "").trim();

    const isPending = enrollmentStatus === "Pending";

    const isApproved = enrollmentStatus === "Approved";

    if (!isPending && !isApproved) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "ENROLLMENT_NOT_EDITABLE",

        message: `Subject cannot be removed because enrollment status is "${enrollmentStatus}".`,

        enrollment_status: enrollmentStatus,
      });
    }

    // =================================================
    // CORRECTION MODE
    //
    // This is deliberately explicit so downstream
    // frontend/audit consumers know what the DROP means.
    // =================================================

    const correctionMode = isPending
      ? "DEFER_FROM_CURRENT_ENROLLMENT"
      : "POST_APPROVAL_DROP";

    // =================================================
    // 6. LOCK ENROLLMENT SUBJECT
    //
    // IMPORTANT:
    // Include enrollment_type so we preserve whether
    // this is:
    //
    // - Regular
    // - Retake
    // - Carry Over
    // =================================================

    const [subjectRows] = await connection.execute(
      `
            SELECT
                es.enrollment_subject_id,
                es.enrollment_id,

                es.subject_id,

                es.enrollment_type,

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
                ON sub.subject_id =
                   es.subject_id

            LEFT JOIN sections sec
                ON sec.section_id =
                   es.section_id

            LEFT JOIN subject_offerings so
                ON so.offering_id =
                   es.offering_id

            WHERE es.enrollment_subject_id = ?

              AND es.enrollment_id = ?

            LIMIT 1

            FOR UPDATE
          `,
      [enrollmentSubjectId, enrollmentId],
    );

    if (subjectRows.length === 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(404).json({
        success: false,

        code: "ENROLLMENT_SUBJECT_NOT_FOUND",

        message: "Enrollment subject not found.",
      });
    }

    const subject = subjectRows[0];

    // =================================================
    // 7. MUST CURRENTLY BE ENROLLED
    // =================================================

    if (String(subject.status) !== "Enrolled") {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "ENROLLMENT_SUBJECT_NOT_EDITABLE",

        message: `Subject cannot be removed because its current status is "${subject.status}".`,

        enrollment_subject: {
          enrollment_subject_id: enrollmentSubjectId,

          status: subject.status,
        },
      });
    }

    // =================================================
    // 8. GRADE LOCK
    //
    // ANY grade row means grading has started.
    //
    // Draft     -> LOCKED
    // Submitted -> LOCKED
    // Returned  -> LOCKED
    // Approved  -> LOCKED
    //
    // The enrollment_subject_id is part of the grade
    // relationship. Ordinary Registrar correction may
    // never invalidate that relationship.
    // =================================================

    const [gradeRows] = await connection.execute(
      `
            SELECT
                grade_id,
                enrollment_subject_id,
                faculty_id,
                final_rating,
                grade_status

            FROM grades

            WHERE enrollment_subject_id = ?

            LIMIT 1

            FOR UPDATE
          `,
      [enrollmentSubjectId],
    );

    if (gradeRows.length > 0) {
      const grade = gradeRows[0];

      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "SUBJECT_GRADE_LOCKED",

        message:
          "This subject cannot be removed from the enrollment because grading has already started.",

        enrollment_subject: {
          enrollment_subject_id: enrollmentSubjectId,

          subject_id: Number(subject.subject_id),

          subject_code: subject.subject_code,

          enrollment_type: subject.enrollment_type || null,
        },

        grade: {
          grade_id: Number(grade.grade_id),

          grade_status: grade.grade_status,

          final_rating:
            grade.final_rating !== null ? Number(grade.final_rating) : null,
        },
      });
    }

    // =================================================
    // 9. COUNT OTHER ACTIVE SUBJECTS
    //
    // We lock other active membership rows to avoid
    // concurrent Registrar corrections producing an
    // inconsistent subject count.
    //
    // Active:
    // - Enrolled
    // - Completed
    // - Failed
    // - Incomplete
    //
    // Inactive:
    // - Dropped
    // - Withdrawn
    // =================================================

    const [remainingRows] = await connection.execute(
      `
            SELECT
                enrollment_subject_id,
                subject_id,
                status

            FROM enrollment_subjects

            WHERE enrollment_id = ?

              AND enrollment_subject_id <> ?

              AND status IN (
                  'Enrolled',
                  'Completed',
                  'Failed',
                  'Incomplete'
              )

            FOR UPDATE
          `,
      [enrollmentId, enrollmentSubjectId],
    );

    const remainingActiveSubjects = remainingRows.length;

    // =================================================
    // APPROVED ENROLLMENT MUST NOT BECOME EMPTY
    //
    // Pending may temporarily become empty because
    // Registrar can still correct it or add the proper
    // subject before approval.
    // =================================================

    if (isApproved && remainingActiveSubjects === 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "APPROVED_ENROLLMENT_CANNOT_BE_EMPTY",

        message:
          "The final active subject cannot be dropped from an Approved enrollment.",

        enrollment: {
          enrollment_id: enrollmentId,

          enrollment_status: enrollmentStatus,

          active_subjects_after_drop: 0,
        },
      });
    }

    // =================================================
    // 10. OLD VALUES
    //
    // These are the actual values before the mutation.
    // =================================================

    const oldValues = {
      enrollment_id: enrollmentId,

      enrollment_subject_id: enrollmentSubjectId,

      subject_id: Number(subject.subject_id),

      enrollment_type: subject.enrollment_type || null,

      offering_id:
        subject.offering_id !== null ? Number(subject.offering_id) : null,

      section_id:
        subject.section_id !== null ? Number(subject.section_id) : null,

      section_subject_id:
        subject.section_subject_id !== null
          ? Number(subject.section_subject_id)
          : null,

      status: subject.status,

      active_in_current_enrollment: true,
    };

    // =================================================
    // 11. NEW VALUES
    //
    // IMPORTANT:
    //
    // Physical placement IDs remain stored on the
    // enrollment_subject row.
    //
    // Only status changes to Dropped.
    //
    // curriculum_requirement_modified = false is audit
    // metadata. No curriculum table is modified here.
    // =================================================

    const newValues = {
      enrollment_id: enrollmentId,

      enrollment_subject_id: enrollmentSubjectId,

      subject_id: Number(subject.subject_id),

      enrollment_type: subject.enrollment_type || null,

      offering_id: oldValues.offering_id,

      section_id: oldValues.section_id,

      section_subject_id: oldValues.section_subject_id,

      status: "Dropped",

      active_in_current_enrollment: false,

      correction_mode: correctionMode,

      curriculum_requirement_modified: false,

      reason: dropReason,
    };

    // =================================================
    // 12. UPDATE ENROLLMENT SUBJECT
    //
    // NEVER DELETE.
    //
    // NEVER clear historical placement IDs.
    // =================================================

    const [updateResult] = await connection.execute(
      `
            UPDATE enrollment_subjects

            SET
                status = 'Dropped'

            WHERE enrollment_subject_id = ?

              AND enrollment_id = ?

              AND status = 'Enrolled'
          `,
      [enrollmentSubjectId, enrollmentId],
    );

    if (updateResult.affectedRows !== 1) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "ENROLLMENT_SUBJECT_CHANGED",

        message:
          "Enrollment subject could not be removed because its status changed during the correction.",
      });
    }

    // =================================================
    // 13. ENROLLMENT SUBJECT CHANGE HISTORY
    //
    // The historical enrollment_subject keeps its old
    // placement IDs.
    //
    // The CHANGE record uses new placement = NULL
    // because it has no ACTIVE placement after DROP.
    // =================================================

    await connection.execute(
      `
          INSERT INTO enrollment_subject_changes (
              enrollment_id,
              enrollment_subject_id,
              subject_id,

              change_type,

              old_offering_id,
              old_section_id,
              old_section_subject_id,

              new_offering_id,
              new_section_id,
              new_section_subject_id,

              reason,
              changed_by
          )

          VALUES (
              ?,
              ?,
              ?,

              'DROP',

              ?,
              ?,
              ?,

              NULL,
              NULL,
              NULL,

              ?,
              ?
          )
        `,
      [
        enrollmentId,

        enrollmentSubjectId,

        Number(subject.subject_id),

        oldValues.offering_id,

        oldValues.section_id,

        oldValues.section_subject_id,

        dropReason,

        Number(actor.user_id),
      ],
    );

    // =================================================
    // 14. GENERIC AUDIT TRAIL
    //
    // This provides the complete before/after meaning:
    //
    // Pending:
    // DEFER_FROM_CURRENT_ENROLLMENT
    //
    // Approved:
    // POST_APPROVAL_DROP
    // =================================================

    await connection.execute(
      `
          INSERT INTO audit_trail (
              user_id,
              table_name,
              record_id,
              action,
              old_values,
              new_values
          )

          VALUES (
              ?,
              'enrollment_subjects',
              ?,
              'UPDATE',
              ?,
              ?
          )
        `,
      [
        Number(actor.user_id),

        enrollmentSubjectId,

        JSON.stringify(oldValues),

        JSON.stringify(newValues),
      ],
    );

    // =================================================
    // 15. COMMIT
    // =================================================

    await connection.commit();

    transactionActive = false;

    // =================================================
    // 16. SUCCESS
    // =================================================

    const deferredFromCurrentEnrollment = isPending;

    return res.status(200).json({
      success: true,

      code: deferredFromCurrentEnrollment
        ? "SUBJECT_DEFERRED"
        : "SUBJECT_DROPPED",

      message: deferredFromCurrentEnrollment
        ? `${subject.subject_code} was removed from the current semester enrollment. The curriculum requirement itself was not modified.`
        : `${subject.subject_code} was dropped through an Approved enrollment correction.`,

      correction_mode: correctionMode,

      deferred_from_current_enrollment: deferredFromCurrentEnrollment,

      curriculum_requirement_modified: false,

      // ===============================================
      // ENROLLMENT
      // ===============================================

      enrollment: {
        enrollment_id: Number(enrollment.enrollment_id),

        enrollment_status: enrollmentStatus,

        student_id: Number(enrollment.student_id),

        student_number: enrollment.student_number,

        student_name: [
          enrollment.first_name,
          enrollment.middle_name,
          enrollment.last_name,
        ]
          .filter(Boolean)
          .join(" "),

        course: {
          course_id:
            enrollment.course_id !== null ? Number(enrollment.course_id) : null,

          course_code: enrollment.course_code || null,

          course_name: enrollment.course_name || null,
        },

        academic_period: {
          academic_year_id: Number(enrollment.academic_year_id),

          academic_year: enrollment.academic_year,

          semester_id: Number(enrollment.semester_id),

          semester_name: enrollment.semester_name,
        },

        remaining_active_subjects: remainingActiveSubjects,
      },

      // ===============================================
      // SUBJECT
      // ===============================================

      enrollment_subject: {
        enrollment_subject_id: Number(subject.enrollment_subject_id),

        enrollment_id: Number(subject.enrollment_id),

        subject_id: Number(subject.subject_id),

        subject_code: subject.subject_code,

        subject_name: subject.subject_name,

        units: Number(subject.units || 0),

        enrollment_type: subject.enrollment_type || null,

        previous_status: subject.status,

        status: "Dropped",

        active_in_current_enrollment: false,

        // =============================================
        // HISTORICAL PLACEMENT
        //
        // These remain on enrollment_subjects.
        // =============================================

        offering_id: oldValues.offering_id,

        section_id: oldValues.section_id,

        section_name: subject.section_name || null,

        section_subject_id: oldValues.section_subject_id,

        schedule_days: subject.schedule_days || null,

        schedule_time: subject.schedule_time || null,

        faculty_id:
          subject.faculty_id !== null ? Number(subject.faculty_id) : null,

        room_id: subject.room_id !== null ? Number(subject.room_id) : null,
      },

      // ===============================================
      // ACADEMIC EFFECT
      //
      // This is the important distinction for:
      //
      // Carry Over
      // Transferee
      // Missing offering
      // Incorrect enrollment subject
      //
      // We remove the CURRENT enrollment membership.
      // We do NOT satisfy the curriculum requirement.
      // ===============================================
      academic_effect: {
        removed_from_current_enrollment: true,
        marked_completed: false,
        marked_passed: false,
        grade_created: false,
        curriculum_requirement_modified: false,
        may_remain_outstanding: true,
        may_appear_in_future_enrollment: true,
      },
      // ===============================================
      // CORRECTION HISTORY
      // ===============================================

      history: {
        change_type: "DROP",

        correction_mode: correctionMode,

        old: {
          offering_id: oldValues.offering_id,

          section_id: oldValues.section_id,

          section_subject_id: oldValues.section_subject_id,
        },

        // Logical active placement after DROP.
        // Historical placement remains physically
        // stored on enrollment_subjects.
        new: {
          offering_id: null,

          section_id: null,

          section_subject_id: null,
        },

        reason: dropReason,

        changed_by: Number(actor.user_id),
      },

      // ===============================================
      // AUTHENTICATED ACTOR
      // ===============================================

      actor: {
        user_id: Number(actor.user_id),

        username: actor.username,
      },
    });
  } catch (error) {
    // =================================================
    // ROLLBACK
    // =================================================

    if (connection && transactionActive) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("DROP / DEFER SUBJECT ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("DROP / DEFER SUBJECT ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to remove/drop the subject from enrollment.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// VALIDATE ENROLLMENT BEFORE APPROVAL
//
// GET /api/registrar/enrollments/:id/validate
//
// PURPOSE:
//
// Perform the complete final validation required before
// Registrar may approve a Pending enrollment.
//
// IMPORTANT:
//
// This route DOES NOT approve anything.
// It only reports:
//
// valid
// can_approve
// errors
// warnings
//
// RULES:
//
// - Authenticated Registrar only
// - Enrollment must be Pending
// - Student must have active curriculum
// - Must contain at least one active subject
// - No duplicate active subjects
// - Every active subject must:
//      * belong to active curriculum
//      * remain academically eligible
//      * satisfy prerequisite rules
//      * have complete Registrar placement
//      * point to the same subject
//      * point to the same section
//      * use same AY / semester
//      * use same course
//      * use Open offering
//      * use Open section_subject
//      * use correct year-level section for Regular
//      * have faculty / schedule / capacity
//      * not exceed room capacity when room exists
//      * not exceed offering capacity
//
// Room assignment remains optional.
// =====================================================

router.get("/:id/validate", async (req, res) => {
  let connection;

  try {
    // =================================================
    // 1. AUTHENTICATION
    // =================================================

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
    }

    if (req.user.role_name !== "Registrar") {
      return res.status(403).json({
        success: false,
        message: "Registrar access is required.",
      });
    }

    // =================================================
    // 2. ENROLLMENT ID
    // =================================================

    const enrollmentId = Number(req.params.id);

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // 3. DATABASE CONNECTION
    // =================================================

    connection = await db.getConnection();

    // =================================================
    // 4. GET ENROLLMENT + STUDENT
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

              s.student_number,
              s.first_name,
              s.middle_name,
              s.last_name,

              s.course_id,
              s.year_level,

              c.course_code,
              c.course_name,

              ay.academic_year,
              sem.semester_name

          FROM enrollments e

          INNER JOIN students s
              ON s.student_id =
                 e.student_id

          INNER JOIN courses c
              ON c.course_id =
                 s.course_id

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 e.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 e.semester_id

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

    const studentId = Number(enrollment.student_id);

    const courseId = Number(enrollment.course_id);

    const yearLevel = Number(enrollment.year_level);

    const academicYearId = Number(enrollment.academic_year_id);

    const semesterId = Number(enrollment.semester_id);

    // =================================================
    // 5. COLLECT VALIDATION RESULTS
    // =================================================

    const errors = [];
    const warnings = [];
    // =================================================
    // 6. ENROLLMENT STATUS
    //
    // Pending:
    // - Validation determines whether Registrar may approve.
    //
    // Approved:
    // - Enrollment is already official.
    // - Do NOT treat Approved as a validation error.
    // - can_approve will remain false because no second
    //   approval is allowed.
    //
    // Rejected / Cancelled / Draft / other:
    // - Not eligible for approval.
    // =================================================

    const enrollmentStatus = String(enrollment.enrollment_status || "").trim();

    const isPending = enrollmentStatus === "Pending";

    const isApproved = enrollmentStatus === "Approved";

    if (!isPending && !isApproved) {
      errors.push({
        code: "ENROLLMENT_STATUS_NOT_APPROVABLE",

        message: `Enrollment cannot be approved while its current status is "${enrollmentStatus}".`,
      });
    }

    // =================================================
    // 7. ACTIVE CURRICULUM
    // =================================================

    const [curriculumRows] = await connection.execute(
      `
          SELECT
              sc.student_curriculum_id,
              sc.curriculum_id,
              sc.status
                  AS assignment_status,

              cur.curriculum_name,
              cur.course_id,
              cur.is_active

          FROM student_curriculum sc

          INNER JOIN curriculum cur
              ON cur.curriculum_id =
                 sc.curriculum_id

          WHERE sc.student_id = ?

            AND sc.status = 'Active'

            AND cur.is_active = 1

            AND cur.course_id = ?

          ORDER BY
              sc.assigned_date DESC,
              sc.student_curriculum_id DESC

          LIMIT 1
        `,
      [studentId, courseId],
    );

    let curriculum = null;
    let curriculumId = null;

    if (curriculumRows.length === 0) {
      errors.push({
        code: "VALID_ACTIVE_CURRICULUM_REQUIRED",

        message: "The Student does not have a valid active curriculum.",
      });
    } else {
      curriculum = curriculumRows[0];

      curriculumId = Number(curriculum.curriculum_id);
    }

    // =================================================
    // 8. GET ENROLLMENT SUBJECTS
    // =================================================

    const [subjectRows] = await connection.execute(
      `
          SELECT
              es.enrollment_subject_id,
              es.enrollment_id,
              es.subject_id,
              es.enrollment_type,

              es.offering_id,
              es.section_id,
              es.section_subject_id,

              es.status,

              sub.subject_code,
              sub.subject_name,
              sub.units,
              sub.is_active
                  AS subject_is_active

          FROM enrollment_subjects es

          INNER JOIN subjects sub
              ON sub.subject_id =
                 es.subject_id

          WHERE es.enrollment_id = ?

          ORDER BY
              es.enrollment_subject_id ASC
        `,
      [enrollmentId],
    );

    // =================================================
    // 9. ACTIVE SUBJECTS
    // =================================================

    const activeSubjects = subjectRows.filter(
      (subject) => !["Dropped", "Withdrawn"].includes(String(subject.status)),
    );

    if (activeSubjects.length === 0) {
      errors.push({
        code: "NO_ACTIVE_SUBJECTS",

        message:
          "Enrollment must contain at least one active subject before approval.",
      });
    }

    // =================================================
    // CARRY OVER VALIDATION MAP
    //
    // Carry Over cannot be validated only through
    // evaluateSubjectEligibility(), because a valid
    // never-taken earlier subject may appear there as
    // academically Regular.
    //
    // Evaluate Carry Over once for the whole enrollment.
    // =================================================

    const carryOverValidationMap = new Map();

    const hasCarryOverSubjects = activeSubjects.some(
      (subject) =>
        String(subject.enrollment_type || "").trim() === "Carry Over",
    );

    if (hasCarryOverSubjects && curriculumId !== null) {
      const carryOverEvaluation = await getCarryOverCandidates(
        studentId,
        curriculumId,
        yearLevel,
        semesterId,
        connection,
      );

      for (const item of carryOverEvaluation.eligible) {
        carryOverValidationMap.set(Number(item.subject_id), item);
      }
    }

    const [assignedScheduleRows] = await connection.execute(
      `
      SELECT
          es.enrollment_subject_id,
          es.subject_id,
          es.enrollment_type,
          es.offering_id,

          sub.subject_code,
          sub.subject_name,

          sec.section_id,
          sec.section_name,

          so.schedule_days,
          so.schedule_time

      FROM enrollment_subjects es

      INNER JOIN subjects sub
          ON sub.subject_id =
             es.subject_id

      INNER JOIN subject_offerings so
          ON so.offering_id =
             es.offering_id

      INNER JOIN section_subjects ss
          ON ss.section_subject_id =
             es.section_subject_id

      INNER JOIN sections sec
          ON sec.section_id =
             es.section_id

      WHERE es.enrollment_id = ?

        AND es.status = 'Enrolled'

        AND es.offering_id IS NOT NULL

        AND so.status <> 'Cancelled'

        AND ss.status <> 'Cancelled'

      ORDER BY
          es.enrollment_subject_id ASC
    `,
      [enrollmentId],
    );
    // =================================================
    // 10. DUPLICATE ACTIVE SUBJECTS
    // =================================================

    const subjectFrequency = new Map();

    for (const subject of activeSubjects) {
      const subjectId = Number(subject.subject_id);

      subjectFrequency.set(
        subjectId,
        (subjectFrequency.get(subjectId) || 0) + 1,
      );
    }

    for (const [subjectId, count] of subjectFrequency.entries()) {
      if (count > 1) {
        const matchingSubject = activeSubjects.find(
          (subject) => Number(subject.subject_id) === subjectId,
        );

        errors.push({
          code: "DUPLICATE_ACTIVE_SUBJECT",

          message: `Subject "${matchingSubject?.subject_code || subjectId}" appears more than once in the active enrollment.`,

          subject_id: subjectId,

          count,
        });
      }
    }

    // =================================================
    // 11. VALIDATE EVERY ACTIVE SUBJECT
    // =================================================

    const validatedSubjects = [];

    for (const subject of activeSubjects) {
      const enrollmentSubjectId = Number(subject.enrollment_subject_id);

      const subjectId = Number(subject.subject_id);

      const enrollmentType = String(subject.enrollment_type || "").trim();

      const allowedEnrollmentTypes = ["Regular", "Retake", "Carry Over"];

      const subjectErrors = [];
      const subjectWarnings = [];

      if (!allowedEnrollmentTypes.includes(enrollmentType)) {
        subjectErrors.push({
          code: "INVALID_ENROLLMENT_TYPE",

          message:
            "Enrollment subject has an invalid persisted enrollment type.",

          enrollment_type: enrollmentType || null,
        });
      }

      let curriculumSubject = null;
      let academicEligibility = null;
      let offering = null;
      // ===============================================
      // SUBJECT STATUS
      //
      // Pending enrollment:
      // - Every active subject must still be Enrolled.
      //
      // Approved enrollment:
      // - Enrolled is valid for an officially added/current row.
      // - Completed / Failed / Incomplete are legitimate
      //   historical academic lifecycle states.
      // - They must NOT be treated as pre-approval errors.
      // ===============================================

      const subjectStatus = String(subject.status || "").trim();

      const allowedApprovedSubjectStatuses = [
        "Enrolled",
        "Completed",
        "Failed",
        "Incomplete",
      ];

      const isApprovedHistoricalSubject =
        isApproved &&
        ["Completed", "Failed", "Incomplete"].includes(subjectStatus);

      if (isPending && subjectStatus !== "Enrolled") {
        subjectErrors.push({
          code: "INVALID_PRE_APPROVAL_SUBJECT_STATUS",

          message: `Subject status must be "Enrolled" before enrollment approval. Current status is "${subjectStatus}".`,
        });
      }

      if (
        isApproved &&
        !allowedApprovedSubjectStatuses.includes(subjectStatus)
      ) {
        subjectErrors.push({
          code: "INVALID_APPROVED_SUBJECT_STATUS",

          message: `Approved enrollment contains an invalid active subject status "${subjectStatus}".`,
        });
      }

      // ===============================================
      // ACTIVE SUBJECT MASTER RECORD
      // ===============================================

      if (Number(subject.subject_is_active) !== 1) {
        subjectErrors.push({
          code: "SUBJECT_INACTIVE",

          message: "The subject is inactive.",
        });
      }

      // ===============================================
      // CURRICULUM MEMBERSHIP
      // ===============================================

      if (curriculumId !== null) {
        const [curriculumSubjectRows] = await connection.execute(
          `
              SELECT
                  curriculum_subject_id,
                  curriculum_id,
                  subject_id,
                  year_level,
                  semester_id,
                  is_required,
                  display_order

              FROM curriculum_subjects

              WHERE curriculum_id = ?

                AND subject_id = ?

              LIMIT 1
            `,
          [curriculumId, subjectId],
        );

        if (curriculumSubjectRows.length === 0) {
          subjectErrors.push({
            code: "SUBJECT_NOT_IN_ASSIGNED_CURRICULUM",

            message:
              "Subject does not belong to the Student's active curriculum.",
          });
        } else {
          curriculumSubject = curriculumSubjectRows[0];
        }
      }
      // ===============================================
      // ACADEMIC ELIGIBILITY
      //
      // IMPORTANT LIFECYCLE RULE:
      //
      // Pending / Approved-Enrolled:
      //   Validate the Student's CURRENT academic
      //   eligibility because the subject is still a
      //   current enrollment membership.
      //
      // Approved historical result:
      //   Completed / Failed / Incomplete already
      //   represents an academic outcome.
      //
      //   Do NOT re-evaluate that historical row using
      //   today's eligibility.
      //
      //   Example:
      //
      //   Regular + Completed + passing grade
      //   naturally evaluates TODAY as Already Passed.
      //
      //   Regular + Failed
      //   naturally evaluates TODAY as Retake.
      //
      //   Neither means the original persisted
      //   enrollment type was wrong.
      // ===============================================

      if (curriculumSubject !== null && !isApprovedHistoricalSubject) {
        academicEligibility = await evaluateSubjectEligibility(
          studentId,
          subjectId,
          connection,
        );

        // =============================================
        // CURRENT ACADEMIC ELIGIBILITY
        // =============================================

        if (!academicEligibility.eligible) {
          let code = "SUBJECT_NOT_ACADEMICALLY_ELIGIBLE";

          if (
            academicEligibility.eligibility_type ===
            ELIGIBILITY_TYPE.ALREADY_PASSED
          ) {
            code = "SUBJECT_ALREADY_PASSED";
          } else if (
            academicEligibility.eligibility_type ===
            ELIGIBILITY_TYPE.BLOCKED_PREREQUISITE
          ) {
            code = "PREREQUISITE_NOT_PASSED";
          } else if (
            academicEligibility.eligibility_type === ELIGIBILITY_TYPE.UNRESOLVED
          ) {
            code = "ACADEMIC_RESULT_UNRESOLVED";
          }

          subjectErrors.push({
            code,

            message:
              academicEligibility.reason ||
              "Subject is not academically eligible.",
          });
        }

        // =============================================
        // PERSISTED ENROLLMENT TYPE VS ACADEMIC TRUTH
        // =============================================

        if (
          academicEligibility !== null &&
          allowedEnrollmentTypes.includes(enrollmentType)
        ) {
          let typeMatches = false;

          let evaluatedEnrollmentType =
            academicEligibility.eligibility_type || null;

          const curriculumYearLevel = Number(curriculumSubject.year_level);

          const curriculumSemesterId = Number(curriculumSubject.semester_id);

          const isCurrentCurriculumTerm =
            curriculumYearLevel === yearLevel &&
            curriculumSemesterId === semesterId;

          const isEarlierCurriculumTerm =
            curriculumYearLevel < yearLevel ||
            (curriculumYearLevel === yearLevel &&
              curriculumSemesterId < semesterId);

          // ===========================================
          // REGULAR
          // ===========================================

          if (enrollmentType === "Regular") {
            typeMatches =
              academicEligibility.eligible &&
              academicEligibility.eligibility_type === ELIGIBILITY_TYPE.REGULAR;
          }

          // ===========================================
          // RETAKE
          // ===========================================
          else if (enrollmentType === "Retake") {
            typeMatches =
              academicEligibility.eligible &&
              academicEligibility.eligibility_type === ELIGIBILITY_TYPE.RETAKE;
          }

          // ===========================================
          // CARRY OVER
          //
          // Pending:
          //   getCarryOverCandidates() remains the
          //   authoritative classification.
          //
          // Approved + Enrolled:
          //   After Registrar officially adds a Carry
          //   Over subject, that same Approved row can
          //   cause it to disappear from the future
          //   Carry Over candidate list.
          //
          //   Therefore preserve persisted Carry Over
          //   when:
          //
          //   - enrollment is Approved
          //   - row is still Enrolled
          //   - raw academic eligibility is REGULAR
          //   - curriculum term is earlier than the
          //     Student's current enrollment term
          //
          // This mirrors the authoritative resolution
          // used when Add Subject accepted the row.
          // ===========================================
          else if (enrollmentType === "Carry Over") {
            const carryOverSubject = carryOverValidationMap.get(subjectId);

            const approvedPersistedCarryOver =
              isApproved &&
              subjectStatus === "Enrolled" &&
              academicEligibility.eligible &&
              academicEligibility.eligibility_type ===
                ELIGIBILITY_TYPE.REGULAR &&
              isEarlierCurriculumTerm;

            typeMatches =
              Boolean(carryOverSubject) || approvedPersistedCarryOver;

            if (typeMatches) {
              evaluatedEnrollmentType = ELIGIBILITY_TYPE.CARRY_OVER;
            }
          }

          if (!typeMatches) {
            subjectErrors.push({
              code: "ENROLLMENT_TYPE_ACADEMIC_MISMATCH",

              message:
                "The persisted enrollment type no longer matches the Student's current academic eligibility.",

              stored_enrollment_type: enrollmentType,

              evaluated_enrollment_type: evaluatedEnrollmentType,
            });
          }

          // ===========================================
          // REGULAR MUST BELONG TO CURRENT TERM
          // ===========================================

          if (
            academicEligibility.eligible &&
            enrollmentType === "Regular" &&
            !isCurrentCurriculumTerm
          ) {
            subjectErrors.push({
              code: "REGULAR_SUBJECT_OUTSIDE_CURRENT_TERM",

              message:
                "Regular subject does not belong to the Student's current year level and semester.",
            });
          }
        }
      }
      // ===============================================
      // COMPLETE REGISTRAR PLACEMENT
      // ===============================================

      const offeringId =
        subject.offering_id !== null ? Number(subject.offering_id) : null;

      const sectionId =
        subject.section_id !== null ? Number(subject.section_id) : null;

      const sectionSubjectId =
        subject.section_subject_id !== null
          ? Number(subject.section_subject_id)
          : null;

      if (!offeringId || !sectionId || !sectionSubjectId) {
        subjectErrors.push({
          code: "SUBJECT_PLACEMENT_INCOMPLETE",

          message:
            "Registrar placement is incomplete. Offering, section, and section subject are required before approval.",
        });
      }

      // ===============================================
      // VALIDATE AUTHORITATIVE OFFERING
      // ===============================================

      if (offeringId && sectionId && sectionSubjectId) {
        const [offeringRows] = await connection.execute(
          `
              SELECT
                  so.offering_id,
                  so.subject_id,
                  so.section_id,
                  so.section_subject_id,

                  so.faculty_id,
                  so.room_id,

                  so.academic_year_id,
                  so.semester_id,

                  so.schedule_days,
                  so.schedule_time,

                  so.max_students,

                  so.status
                      AS offering_status,

                  ss.subject_id
                      AS section_subject_subject_id,

                  ss.section_id
                      AS section_subject_section_id,

                  ss.academic_year_id
                      AS section_subject_academic_year_id,

                  ss.semester_id
                      AS section_subject_semester_id,

                  ss.status
                      AS section_subject_status,

                  sec.section_name,

                  sec.course_id
                      AS section_course_id,

                  sec.year_level
                      AS section_year_level,

                  r.capacity
                      AS room_capacity

              FROM subject_offerings so

              INNER JOIN section_subjects ss
                  ON ss.section_subject_id =
                     so.section_subject_id

              INNER JOIN sections sec
                  ON sec.section_id =
                     so.section_id

              LEFT JOIN rooms r
                  ON r.room_id =
                     so.room_id

              WHERE so.offering_id = ?

              LIMIT 1
            `,
          [offeringId],
        );

        if (offeringRows.length === 0) {
          subjectErrors.push({
            code: "OFFERING_NOT_FOUND",

            message: "The assigned offering no longer exists.",
          });
        } else {
          offering = offeringRows[0];

          // ===========================================
          // STORED PLACEMENT MUST MATCH OFFERING
          // ===========================================

          if (
            Number(offering.section_id) !== sectionId ||
            Number(offering.section_subject_id) !== sectionSubjectId
          ) {
            subjectErrors.push({
              code: "PLACEMENT_RELATIONSHIP_MISMATCH",

              message:
                "Stored section placement does not match the assigned offering.",
            });
          }

          // ===========================================
          // SAME SUBJECT
          // ===========================================

          if (Number(offering.subject_id) !== subjectId) {
            subjectErrors.push({
              code: "OFFERING_SUBJECT_MISMATCH",

              message: "The assigned offering belongs to a different subject.",
            });
          }

          // ===========================================
          // SECTION SUBJECT RELATIONSHIP
          // ===========================================

          if (
            Number(offering.section_subject_subject_id) !== subjectId ||
            Number(offering.section_subject_section_id) !== sectionId
          ) {
            subjectErrors.push({
              code: "INVALID_SECTION_SUBJECT_RELATIONSHIP",

              message: "The assigned section-subject relationship is invalid.",
            });
          }

          // ===========================================
          // COURSE
          // ===========================================

          if (
            enrollmentType === "Regular" &&
            Number(offering.section_course_id) !== courseId
          ) {
            subjectErrors.push({
              code: "OFFERING_COURSE_MISMATCH",

              message:
                "A Regular subject must be assigned to an offering within the Student's course.",

              student_course_id: courseId,

              offering_course_id: Number(offering.section_course_id),
            });
          }

          // ===========================================
          // ACADEMIC YEAR
          // ===========================================

          if (
            Number(offering.academic_year_id) !== academicYearId ||
            Number(offering.section_subject_academic_year_id) !== academicYearId
          ) {
            subjectErrors.push({
              code: "OFFERING_ACADEMIC_YEAR_MISMATCH",

              message:
                "The assigned offering does not belong to the enrollment academic year.",
            });
          }

          // ===========================================
          // SEMESTER
          // ===========================================

          if (
            Number(offering.semester_id) !== semesterId ||
            Number(offering.section_subject_semester_id) !== semesterId
          ) {
            subjectErrors.push({
              code: "OFFERING_SEMESTER_MISMATCH",

              message:
                "The assigned offering does not belong to the enrollment semester.",
            });
          }

          // ===========================================
          // OPEN STATUS
          // ===========================================

          if (offering.offering_status !== "Open") {
            subjectErrors.push({
              code: "OFFERING_NOT_OPEN",

              message: `Assigned offering is "${offering.offering_status}" instead of Open.`,
            });
          }

          if (offering.section_subject_status !== "Open") {
            subjectErrors.push({
              code: "SECTION_SUBJECT_NOT_OPEN",

              message: `Assigned section subject is "${offering.section_subject_status}" instead of Open.`,
            });
          }

          // ===========================================
          // REGULAR YEAR-LEVEL SECTION
          // ===========================================

          if (
            enrollmentType === "Regular" &&
            Number(offering.section_year_level) !== yearLevel
          ) {
            subjectErrors.push({
              code: "REGULAR_SECTION_YEAR_LEVEL_MISMATCH",

              message:
                "Regular subject is assigned to a section that does not match the Student's current year level.",
            });
          }

          // ===========================================
          // READINESS
          //
          // Room remains optional.
          // ===========================================

          const maxStudents = Number(offering.max_students || 0);

          if (!offering.faculty_id) {
            subjectErrors.push({
              code: "OFFERING_FACULTY_MISSING",

              message: "Assigned offering has no faculty.",
            });
          }

          if (
            !offering.schedule_days ||
            !String(offering.schedule_days).trim()
          ) {
            subjectErrors.push({
              code: "OFFERING_SCHEDULE_DAYS_MISSING",

              message: "Assigned offering has no schedule days.",
            });
          }

          if (
            !offering.schedule_time ||
            !String(offering.schedule_time).trim()
          ) {
            subjectErrors.push({
              code: "OFFERING_SCHEDULE_TIME_MISSING",

              message: "Assigned offering has no schedule time.",
            });
          }

          if (!Number.isInteger(maxStudents) || maxStudents <= 0) {
            subjectErrors.push({
              code: "OFFERING_CAPACITY_INVALID",

              message:
                "Assigned offering does not have a valid positive capacity.",
            });
          }

          // ===========================================
          // ROOM CAPACITY
          // ===========================================

          if (
            maxStudents > 0 &&
            offering.room_capacity !== null &&
            Number(offering.room_capacity) > 0 &&
            maxStudents > Number(offering.room_capacity)
          ) {
            subjectErrors.push({
              code: "OFFERING_EXCEEDS_ROOM_CAPACITY",

              message: "Offering capacity exceeds the assigned room capacity.",
            });
          }

          // ===========================================
          // CURRENT OFFERING OCCUPANCY
          //
          // Current student is included.
          // Therefore invalid only when count > max.
          // ===========================================

          if (maxStudents > 0) {
            const [capacityRows] = await connection.execute(
              `
                  SELECT
                      COUNT(*) AS enrolled_count

                  FROM enrollment_subjects es

                  INNER JOIN enrollments e
                      ON e.enrollment_id =
                         es.enrollment_id

                  WHERE es.offering_id = ?

                    AND es.status IN (
                        'Enrolled',
                        'Completed',
                        'Failed',
                        'Incomplete'
                    )

                    AND e.enrollment_status IN (
                        'Pending',
                        'Approved'
                    )
                `,
              [offeringId],
            );

            const enrolledCount = Number(capacityRows[0]?.enrolled_count || 0);

            if (enrolledCount > maxStudents) {
              subjectErrors.push({
                code: "OFFERING_OVER_CAPACITY",

                message:
                  "Assigned offering currently exceeds its maximum capacity.",

                max_students: maxStudents,

                enrolled_count: enrolledCount,
              });
            }
          }
        }
      }

      // ===============================================
      // STORE SUBJECT RESULT
      // ===============================================

      const subjectValid = subjectErrors.length === 0;

      validatedSubjects.push({
        enrollment_subject_id: enrollmentSubjectId,

        subject_id: subjectId,

        subject_code: subject.subject_code,

        subject_name: subject.subject_name,

        units: Number(subject.units || 0),

        status: subject.status,

        valid: subjectValid,

        enrollment_type: enrollmentType,

        placement: {
          offering_id: offeringId,

          section_id: sectionId,

          section_subject_id: sectionSubjectId,

          section_name: offering?.section_name || null,
        },

        errors: subjectErrors,

        warnings: subjectWarnings,
      });

      // ===============================================
      // ADD SUBJECT ERRORS TO GLOBAL ERRORS
      // ===============================================

      for (const subjectError of subjectErrors) {
        errors.push({
          ...subjectError,

          enrollment_subject_id: enrollmentSubjectId,

          subject_id: subjectId,

          subject_code: subject.subject_code,
        });
      }

      // End per-subject validation
      for (const subjectWarning of subjectWarnings) {
        warnings.push({
          ...subjectWarning,

          enrollment_subject_id: enrollmentSubjectId,

          subject_id: subjectId,

          subject_code: subject.subject_code,
        });
      }

      // closes activeSubjects loop
    }

    // =================================================
    // STUDENT SCHEDULE CONFLICT VALIDATION
    // =================================================

    const scheduleConflictKeys = new Set();

    const studentScheduleConflicts = [];

    for (let i = 0; i < assignedScheduleRows.length; i += 1) {
      const first = assignedScheduleRows[i];

      for (let j = i + 1; j < assignedScheduleRows.length; j += 1) {
        const second = assignedScheduleRows[j];

        const overlap = enrollmentSchedulesOverlap(
          first.schedule_days,
          first.schedule_time,
          second.schedule_days,
          second.schedule_time,
        );

        if (!overlap.overlap) {
          continue;
        }

        const firstId = Number(first.enrollment_subject_id);

        const secondId = Number(second.enrollment_subject_id);

        const conflictKey =
          `${Math.min(firstId, secondId)}:` + `${Math.max(firstId, secondId)}`;

        if (scheduleConflictKeys.has(conflictKey)) {
          continue;
        }

        scheduleConflictKeys.add(conflictKey);

        studentScheduleConflicts.push({
          common_days: overlap.common_days,

          first_subject: {
            enrollment_subject_id: firstId,

            subject_id: Number(first.subject_id),

            subject_code: first.subject_code,

            subject_name: first.subject_name,

            enrollment_type: first.enrollment_type,

            offering_id: Number(first.offering_id),

            section_id: Number(first.section_id),

            section_name: first.section_name,

            schedule: {
              days: first.schedule_days,

              time: first.schedule_time,
            },
          },

          second_subject: {
            enrollment_subject_id: secondId,

            subject_id: Number(second.subject_id),

            subject_code: second.subject_code,

            subject_name: second.subject_name,

            enrollment_type: second.enrollment_type,

            offering_id: Number(second.offering_id),

            section_id: Number(second.section_id),

            section_name: second.section_name,

            schedule: {
              days: second.schedule_days,

              time: second.schedule_time,
            },
          },
        });
      }
    }

    if (studentScheduleConflicts.length > 0) {
      errors.push({
        code: "STUDENT_SCHEDULE_CONFLICT",

        message:
          "One or more assigned classes overlap in the Student's schedule.",

        conflict_count: studentScheduleConflicts.length,

        conflicts: studentScheduleConflicts,
      });
    }

    // =================================================
    // 12. TOTAL UNITS
    // =================================================

    const totalUnits = activeSubjects.reduce(
      (total, subject) => total + Number(subject.units || 0),
      0,
    );
    // =================================================
    // 13. FINAL RESULT
    // =================================================

    const valid = errors.length === 0;

    const alreadyApproved = enrollmentStatus === "Approved";

    const canApprove = valid && enrollmentStatus === "Pending";

    let validationState = "NOT_READY";

    let validationMessage =
      "Enrollment has validation errors that must be resolved.";

    if (alreadyApproved) {
      validationState = "ALREADY_APPROVED";

      validationMessage =
        "Enrollment is already approved. No additional approval action is required.";
    } else if (canApprove) {
      validationState = "READY_FOR_APPROVAL";

      validationMessage =
        "Enrollment passed validation and is ready for approval.";
    } else if (enrollmentStatus !== "Pending") {
      validationState = "NOT_APPROVABLE";
    }

    return res.status(200).json({
      success: true,

      valid,

      can_approve: canApprove,

      already_approved: alreadyApproved,

      validation_state: validationState,

      message: validationMessage,

      enrollment: {
        enrollment_id: enrollmentId,

        student_id: studentId,

        student_number: enrollment.student_number,

        student_name: [
          enrollment.first_name,
          enrollment.middle_name,
          enrollment.last_name,
        ]
          .filter(Boolean)
          .join(" "),

        course_id: courseId,

        course_code: enrollment.course_code,

        course_name: enrollment.course_name,

        year_level: yearLevel,

        academic_year_id: academicYearId,

        academic_year: enrollment.academic_year,

        semester_id: semesterId,

        semester_name: enrollment.semester_name,

        enrollment_status: enrollment.enrollment_status,
      },

      curriculum: curriculum
        ? {
            curriculum_id: curriculumId,

            curriculum_name: curriculum.curriculum_name,
          }
        : null,

      summary: {
        total_records: subjectRows.length,

        active_subjects: activeSubjects.length,

        total_units: totalUnits,

        valid_subjects: validatedSubjects.filter((subject) => subject.valid)
          .length,

        invalid_subjects: validatedSubjects.filter((subject) => !subject.valid)
          .length,

        validation_errors: errors.length,

        validation_warnings: warnings.length,
      },

      subjects: validatedSubjects,

      errors,

      warnings,
    });
  } catch (error) {
    console.error("VALIDATE REGISTRAR ENROLLMENT ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to validate enrollment.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});
// =====================================================
// APPROVE ENROLLMENT
//
// POST /api/registrar/enrollments/:id/approve
//
// OPTIONAL BODY:
//
// {
//   "remarks": "Enrollment verified and approved."
// }
//
// IMPORTANT:
//
// - Registrar identity comes ONLY from req.user.
// - Frontend does NOT send approved_by.
// - Enrollment must be Pending.
// - Final validation is repeated INSIDE the transaction.
// - Preview /validate can never replace final validation.
// - Only after all checks pass:
//       Pending -> Approved
//
// Approved enrollment becomes the authoritative source
// of current-semester class membership.
// =====================================================

router.post("/:id/approve", async (req, res) => {
  let connection;
  let transactionActive = false;

  try {
    // =================================================
    // 1. AUTHENTICATED REGISTRAR
    // =================================================

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication is required.",
      });
    }

    if (req.user.role_name !== "Registrar") {
      return res.status(403).json({
        success: false,
        message: "Registrar access is required.",
      });
    }

    const approvedBy = Number(req.user.user_id);

    if (!Number.isInteger(approvedBy) || approvedBy <= 0) {
      return res.status(401).json({
        success: false,
        message: "Authenticated Registrar user ID is invalid.",
      });
    }

    // =================================================
    // 2. ENROLLMENT ID
    // =================================================

    const enrollmentId = Number(req.params.id);

    if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid enrollment ID.",
      });
    }

    // =================================================
    // 3. OPTIONAL REMARKS
    // =================================================

    let approvalRemarks = null;

    if (typeof req.body?.remarks === "string") {
      const trimmed = req.body.remarks.trim();

      if (trimmed.length > 255) {
        return res.status(400).json({
          success: false,
          message: "Approval remarks must not exceed 255 characters.",
        });
      }

      if (trimmed) {
        approvalRemarks = trimmed;
      }
    }

    // =================================================
    // 4. TRANSACTION
    // =================================================

    connection = await db.getConnection();

    await connection.beginTransaction();

    transactionActive = true;

    // =================================================
    // 5. LOCK ENROLLMENT + STUDENT
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

              e.approved_by,
              e.approved_at,

              e.created_at,

              s.student_number,
              s.first_name,
              s.middle_name,
              s.last_name,

              s.course_id,
              s.year_level,

              c.course_code,
              c.course_name,

              ay.academic_year,
              sem.semester_name

          FROM enrollments e

          INNER JOIN students s
              ON s.student_id =
                 e.student_id

          INNER JOIN courses c
              ON c.course_id =
                 s.course_id

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 e.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 e.semester_id

          WHERE e.enrollment_id = ?

          LIMIT 1

          FOR UPDATE
        `,
      [enrollmentId],
    );

    if (enrollmentRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // 6. MUST STILL BE PENDING
    // =================================================

    if (enrollment.enrollment_status !== "Pending") {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "ENROLLMENT_NOT_PENDING",

        message: `Enrollment cannot be approved because its current status is "${enrollment.enrollment_status}".`,

        enrollment_status: enrollment.enrollment_status,
      });
    }

    const studentId = Number(enrollment.student_id);

    const courseId = Number(enrollment.course_id);

    const yearLevel = Number(enrollment.year_level);

    const academicYearId = Number(enrollment.academic_year_id);

    const semesterId = Number(enrollment.semester_id);

    // =================================================
    // 7. VALID ACTIVE CURRICULUM
    // =================================================

    const [curriculumRows] = await connection.execute(
      `
          SELECT
              sc.student_curriculum_id,
              sc.curriculum_id,

              cur.curriculum_name,
              cur.course_id,
              cur.is_active

          FROM student_curriculum sc

          INNER JOIN curriculum cur
              ON cur.curriculum_id =
                 sc.curriculum_id

          WHERE sc.student_id = ?

            AND sc.status = 'Active'

            AND cur.is_active = 1

            AND cur.course_id = ?

          ORDER BY
              sc.assigned_date DESC,
              sc.student_curriculum_id DESC

          LIMIT 1

          FOR UPDATE
        `,
      [studentId, courseId],
    );

    if (curriculumRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "VALID_ACTIVE_CURRICULUM_REQUIRED",

        message:
          "Enrollment cannot be approved because the Student does not have a valid active curriculum.",
      });
    }

    const curriculum = curriculumRows[0];

    const curriculumId = Number(curriculum.curriculum_id);

    // =================================================
    // 8. LOCK ALL ENROLLMENT SUBJECTS
    // =================================================

    const [allSubjectRows] = await connection.execute(
      `
          SELECT
              es.enrollment_subject_id,
              es.enrollment_id,

              es.subject_id,
               es.enrollment_type,

              es.offering_id,
              es.section_id,
              es.section_subject_id,

              es.status,

              sub.subject_code,
              sub.subject_name,
              sub.units,
              sub.is_active
                  AS subject_is_active

          FROM enrollment_subjects es

          INNER JOIN subjects sub
              ON sub.subject_id =
                 es.subject_id

          WHERE es.enrollment_id = ?

          ORDER BY
              es.enrollment_subject_id ASC

          FOR UPDATE
        `,
      [enrollmentId],
    );

    // =================================================
    // 9. ACTIVE SUBJECTS
    // =================================================

    const subjectRows = allSubjectRows.filter(
      (subject) => !["Dropped", "Withdrawn"].includes(String(subject.status)),
    );

    if (subjectRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "NO_ACTIVE_SUBJECTS",

        message:
          "Enrollment cannot be approved because it has no active subjects.",
      });
    }

    // =================================================
    // 10. VALIDATION ERRORS
    // =================================================

    const validationErrors = [];
    const approvalScheduleRows = [];
    // =================================================
    // CARRY OVER VALIDATION MAP
    // =================================================

    const carryOverValidationMap = new Map();

    const hasCarryOverSubjects = subjectRows.some(
      (subject) =>
        String(subject.enrollment_type || "").trim() === "Carry Over",
    );

    if (hasCarryOverSubjects) {
      const carryOverEvaluation = await getCarryOverCandidates(
        studentId,
        curriculumId,
        yearLevel,
        semesterId,
        connection,
      );

      for (const item of carryOverEvaluation.eligible) {
        carryOverValidationMap.set(Number(item.subject_id), item);
      }
    }

    // =================================================
    // ASSIGNED STUDENT SCHEDULES
    // =================================================

    const [assignedScheduleRows] = await connection.execute(
      `
      SELECT
          es.enrollment_subject_id,
          es.subject_id,
          es.enrollment_type,
          es.offering_id,

          sub.subject_code,
          sub.subject_name,

          sec.section_id,
          sec.section_name,

          so.schedule_days,
          so.schedule_time

      FROM enrollment_subjects es

      INNER JOIN subjects sub
          ON sub.subject_id = es.subject_id

      INNER JOIN subject_offerings so
          ON so.offering_id = es.offering_id

      INNER JOIN section_subjects ss
          ON ss.section_subject_id =
             es.section_subject_id

      INNER JOIN sections sec
          ON sec.section_id = es.section_id

      WHERE es.enrollment_id = ?

        AND es.status = 'Enrolled'

        AND es.offering_id IS NOT NULL

        AND so.status <> 'Cancelled'

        AND ss.status <> 'Cancelled'

      ORDER BY
          es.enrollment_subject_id ASC
    `,
      [enrollmentId],
    );
    // =================================================
    // 11. DUPLICATE ACTIVE SUBJECTS
    // =================================================

    const subjectCounts = new Map();

    for (const subject of subjectRows) {
      const subjectId = Number(subject.subject_id);

      subjectCounts.set(subjectId, (subjectCounts.get(subjectId) || 0) + 1);
    }

    for (const [subjectId, count] of subjectCounts.entries()) {
      if (count > 1) {
        const duplicate = subjectRows.find(
          (subject) => Number(subject.subject_id) === subjectId,
        );

        validationErrors.push({
          code: "DUPLICATE_ACTIVE_SUBJECT",

          message: `Subject "${duplicate?.subject_code || subjectId}" appears more than once in the active enrollment.`,

          subject_id: subjectId,

          count,
        });
      }
    }
    // =================================================
    // 12. VALIDATE EACH SUBJECT
    // =================================================

    for (const subject of subjectRows) {
      const enrollmentSubjectId = Number(subject.enrollment_subject_id);

      const subjectId = Number(subject.subject_id);

      const enrollmentType = String(subject.enrollment_type || "").trim();

      const allowedEnrollmentTypes = ["Regular", "Retake", "Carry Over"];

      const addError = (code, message, extra = {}) => {
        validationErrors.push({
          code,
          message,

          enrollment_subject_id: enrollmentSubjectId,

          subject_id: subjectId,

          subject_code: subject.subject_code,

          ...extra,
        });
      };
      if (!allowedEnrollmentTypes.includes(enrollmentType)) {
        addError(
          "INVALID_ENROLLMENT_TYPE",
          "Enrollment subject has an invalid persisted enrollment type.",
          {
            enrollment_type: enrollmentType || null,

            allowed_enrollment_types: allowedEnrollmentTypes,
          },
        );
      }
      // ===============================================
      // SUBJECT MUST STILL BE ENROLLED
      // ===============================================

      if (subject.status !== "Enrolled") {
        addError(
          "INVALID_PRE_APPROVAL_SUBJECT_STATUS",
          `Subject status must be "Enrolled" before enrollment approval. Current status is "${subject.status}".`,
        );
      }

      // ===============================================
      // SUBJECT MASTER MUST BE ACTIVE
      // ===============================================

      if (Number(subject.subject_is_active) !== 1) {
        addError("SUBJECT_INACTIVE", "Subject is inactive.");
      }

      // ===============================================
      // CURRICULUM MEMBERSHIP
      // ===============================================

      const [curriculumSubjectRows] = await connection.execute(
        `
            SELECT
                curriculum_subject_id,
                curriculum_id,
                subject_id,
                year_level,
                semester_id,
                is_required,
                display_order

            FROM curriculum_subjects

            WHERE curriculum_id = ?

              AND subject_id = ?

            LIMIT 1
          `,
        [curriculumId, subjectId],
      );

      if (curriculumSubjectRows.length === 0) {
        addError(
          "SUBJECT_NOT_IN_ASSIGNED_CURRICULUM",
          "Subject does not belong to the Student's active curriculum.",
        );

        continue;
      }

      const curriculumSubject = curriculumSubjectRows[0];

      // ===============================================
      // FINAL GRADE V2 ACADEMIC CHECK
      // ===============================================

      const academicEligibility = await evaluateSubjectEligibility(
        studentId,
        subjectId,
        connection,
      );

      if (!academicEligibility.eligible) {
        let code = "SUBJECT_NOT_ACADEMICALLY_ELIGIBLE";
        // ===============================================
        // PERSISTED ENROLLMENT TYPE VS ACADEMIC TRUTH
        // ===============================================

        if (allowedEnrollmentTypes.includes(enrollmentType)) {
          let typeMatches = false;

          let evaluatedEnrollmentType =
            academicEligibility.eligibility_type || null;

          if (enrollmentType === "Regular") {
            typeMatches =
              academicEligibility.eligible &&
              academicEligibility.eligibility_type === ELIGIBILITY_TYPE.REGULAR;
          } else if (enrollmentType === "Retake") {
            typeMatches =
              academicEligibility.eligible &&
              academicEligibility.eligibility_type === ELIGIBILITY_TYPE.RETAKE;
          } else if (enrollmentType === "Carry Over") {
            const carryOverSubject = carryOverValidationMap.get(subjectId);

            typeMatches = Boolean(carryOverSubject);

            if (carryOverSubject) {
              evaluatedEnrollmentType = ELIGIBILITY_TYPE.CARRY_OVER;
            }
          }

          if (!typeMatches) {
            addError(
              "ENROLLMENT_TYPE_ACADEMIC_MISMATCH",
              "The persisted enrollment type no longer matches the Student's current academic eligibility.",
              {
                stored_enrollment_type: enrollmentType,

                evaluated_enrollment_type: evaluatedEnrollmentType,
              },
            );
          }
        }

        if (
          academicEligibility.eligibility_type ===
          ELIGIBILITY_TYPE.ALREADY_PASSED
        ) {
          code = "SUBJECT_ALREADY_PASSED";
        } else if (
          academicEligibility.eligibility_type ===
          ELIGIBILITY_TYPE.BLOCKED_PREREQUISITE
        ) {
          code = "PREREQUISITE_NOT_PASSED";
        } else if (
          academicEligibility.eligibility_type === ELIGIBILITY_TYPE.UNRESOLVED
        ) {
          code = "ACADEMIC_RESULT_UNRESOLVED";
        }

        addError(
          code,

          academicEligibility.reason ||
            "Student is no longer academically eligible for this subject.",

          {
            eligibility_type: academicEligibility.eligibility_type,

            latest_approved_grade: academicEligibility.latest_approved_grade,

            prerequisites: academicEligibility.prerequisites,
          },
        );
      }

      // ===============================================
      // REGULAR SUBJECT CURRENT TERM
      // ===============================================

      if (academicEligibility.eligible && enrollmentType === "Regular") {
        if (
          Number(curriculumSubject.year_level) !== yearLevel ||
          Number(curriculumSubject.semester_id) !== semesterId
        ) {
          addError(
            "REGULAR_SUBJECT_OUTSIDE_CURRENT_TERM",
            "Regular subject does not belong to the Student's current curriculum year and semester.",
          );
        }
      }

      // ===============================================
      // COMPLETE PLACEMENT
      // ===============================================

      const offeringId =
        subject.offering_id !== null ? Number(subject.offering_id) : null;

      const sectionId =
        subject.section_id !== null ? Number(subject.section_id) : null;

      const sectionSubjectId =
        subject.section_subject_id !== null
          ? Number(subject.section_subject_id)
          : null;

      if (!offeringId) {
        addError(
          "OFFERING_NOT_ASSIGNED",
          "Subject does not have an offering assignment.",
        );
      }

      if (!sectionId) {
        addError(
          "SECTION_NOT_ASSIGNED",
          "Subject does not have a section assignment.",
        );
      }

      if (!sectionSubjectId) {
        addError(
          "SECTION_SUBJECT_NOT_ASSIGNED",
          "Subject does not have a section-subject assignment.",
        );
      }

      if (!offeringId || !sectionId || !sectionSubjectId) {
        continue;
      }

      // ===============================================
      // AUTHORITATIVE OFFERING
      // ===============================================

      const [offeringRows] = await connection.execute(
        `
            SELECT
                so.offering_id,
                so.subject_id,
                so.section_id,
                so.section_subject_id,

                so.faculty_id,
                so.room_id,

                so.academic_year_id,
                so.semester_id,

                so.schedule_days,
                so.schedule_time,

                so.max_students,

                so.status
                    AS offering_status,

                ss.subject_id
                    AS section_subject_subject_id,

                ss.section_id
                    AS section_subject_section_id,

                ss.academic_year_id
                    AS section_subject_academic_year_id,

                ss.semester_id
                    AS section_subject_semester_id,

                ss.status
                    AS section_subject_status,

                sec.section_name,

                sec.course_id
                    AS section_course_id,

                sec.year_level
                    AS section_year_level,

                r.capacity
                    AS room_capacity

            FROM subject_offerings so

            INNER JOIN section_subjects ss
                ON ss.section_subject_id =
                   so.section_subject_id

            INNER JOIN sections sec
                ON sec.section_id =
                   so.section_id

            LEFT JOIN rooms r
                ON r.room_id =
                   so.room_id

            WHERE so.offering_id = ?

            LIMIT 1

            FOR UPDATE
          `,
        [offeringId],
      );

      if (offeringRows.length === 0) {
        addError("OFFERING_NOT_FOUND", "Assigned offering no longer exists.");

        continue;
      }

      const offering = offeringRows[0];

      approvalScheduleRows.push({
        enrollment_subject_id: enrollmentSubjectId,

        subject_id: subjectId,

        enrollment_type: enrollmentType,

        subject_code: subject.subject_code,

        subject_name: subject.subject_name,

        offering_id: Number(offering.offering_id),

        section_id: Number(offering.section_id),

        section_name: offering.section_name || null,

        schedule_days: offering.schedule_days,

        schedule_time: offering.schedule_time,
      });
      // ===============================================
      // STORED PLACEMENT MUST MATCH OFFERING
      // ===============================================

      if (Number(offering.section_id) !== sectionId) {
        addError(
          "OFFERING_SECTION_MISMATCH",
          "Assigned offering belongs to a different section.",
        );
      }

      if (Number(offering.section_subject_id) !== sectionSubjectId) {
        addError(
          "OFFERING_SECTION_SUBJECT_MISMATCH",
          "Assigned offering belongs to a different section-subject record.",
        );
      }

      // ===============================================
      // SAME SUBJECT
      // ===============================================

      if (Number(offering.subject_id) !== subjectId) {
        addError(
          "OFFERING_SUBJECT_MISMATCH",
          "Assigned offering belongs to a different subject.",
        );
      }

      // ===============================================
      // SECTION SUBJECT INTEGRITY
      // ===============================================

      if (Number(offering.section_subject_subject_id) !== subjectId) {
        addError(
          "SECTION_SUBJECT_WRONG_SUBJECT",
          "Assigned section-subject belongs to a different subject.",
        );
      }

      if (Number(offering.section_subject_section_id) !== sectionId) {
        addError(
          "SECTION_SUBJECT_WRONG_SECTION",
          "Assigned section-subject belongs to a different section.",
        );
      }

      // ===============================================
      // COURSE
      // ===============================================

      if (
        enrollmentType === "Regular" &&
        Number(offering.section_course_id) !== courseId
      ) {
        addError(
          "SECTION_COURSE_MISMATCH",
          "A Regular subject must be assigned to a section within the Student's course.",
          {
            student_course_id: courseId,
            offering_course_id: Number(offering.section_course_id),
          },
        );
      }

      // ===============================================
      // ACADEMIC YEAR
      // ===============================================

      if (
        Number(offering.academic_year_id) !== academicYearId ||
        Number(offering.section_subject_academic_year_id) !== academicYearId
      ) {
        addError(
          "OFFERING_ACADEMIC_YEAR_MISMATCH",
          "Assigned offering/section-subject belongs to a different academic year.",
        );
      }

      // ===============================================
      // SEMESTER
      // ===============================================

      if (
        Number(offering.semester_id) !== semesterId ||
        Number(offering.section_subject_semester_id) !== semesterId
      ) {
        addError(
          "OFFERING_SEMESTER_MISMATCH",
          "Assigned offering/section-subject belongs to a different semester.",
        );
      }

      // ===============================================
      // OPEN STATUS
      // ===============================================

      if (offering.offering_status !== "Open") {
        addError(
          "OFFERING_NOT_OPEN",
          `Offering status is "${offering.offering_status}".`,
        );
      }

      if (offering.section_subject_status !== "Open") {
        addError(
          "SECTION_SUBJECT_NOT_OPEN",
          `Section-subject status is "${offering.section_subject_status}".`,
        );
      }

      // ===============================================
      // REGULAR -> SAME YEAR LEVEL SECTION
      // ===============================================

      if (
        academicEligibility.eligible &&
        academicEligibility.eligibility_type === ELIGIBILITY_TYPE.REGULAR &&
        Number(offering.section_year_level) !== yearLevel
      ) {
        addError(
          "REGULAR_SECTION_YEAR_LEVEL_MISMATCH",
          "Regular subject is assigned to a section that does not match the Student's current year level.",
        );
      }

      // ===============================================
      // READINESS
      //
      // Room remains optional.
      // ===============================================

      const maxStudents = Number(offering.max_students || 0);

      const missingConfiguration = [];

      if (!offering.faculty_id) {
        missingConfiguration.push("faculty");
      }

      if (!offering.schedule_days || !String(offering.schedule_days).trim()) {
        missingConfiguration.push("schedule_days");
      }

      if (!offering.schedule_time || !String(offering.schedule_time).trim()) {
        missingConfiguration.push("schedule_time");
      }

      if (!Number.isInteger(maxStudents) || maxStudents <= 0) {
        missingConfiguration.push("capacity");
      }

      if (missingConfiguration.length > 0) {
        addError(
          "OFFERING_NOT_READY",
          "Assigned offering is not completely configured.",
          {
            missing_configuration: missingConfiguration,
          },
        );
      }

      // ===============================================
      // ROOM CAPACITY
      //
      // Only applies when room exists.
      // ===============================================

      if (
        offering.room_capacity !== null &&
        Number(offering.room_capacity) > 0 &&
        maxStudents > Number(offering.room_capacity)
      ) {
        addError(
          "OFFERING_EXCEEDS_ROOM_CAPACITY",
          "Offering capacity exceeds the assigned room capacity.",
        );
      }

      // ===============================================
      // CAPACITY
      //
      // This Pending Student is ALREADY included.
      //
      // enrolled_count == max → still valid
      // enrolled_count > max  → invalid
      // ===============================================

      if (maxStudents > 0) {
        const [capacityRows] = await connection.execute(
          `
              SELECT
                  COUNT(*) AS enrolled_count

              FROM enrollment_subjects es

              INNER JOIN enrollments e
                  ON e.enrollment_id =
                     es.enrollment_id

              WHERE es.offering_id = ?

                AND es.status IN (
                    'Enrolled',
                    'Completed',
                    'Failed',
                    'Incomplete'
                )

                AND e.enrollment_status IN (
                    'Pending',
                    'Approved'
                )
            `,
          [offeringId],
        );

        const enrolledCount = Number(capacityRows[0]?.enrolled_count || 0);

        if (enrolledCount > maxStudents) {
          addError(
            "OFFERING_OVER_CAPACITY",
            "Offering currently exceeds its maximum student capacity.",
            {
              max_students: maxStudents,

              enrolled_count: enrolledCount,
            },
          );
        }
      }
    }
    // =================================================
    // STUDENT SCHEDULE CONFLICT VALIDATION
    // =================================================

    const approvalScheduleConflictKeys = new Set();

    const approvalScheduleConflicts = [];

    for (let i = 0; i < approvalScheduleRows.length; i += 1) {
      const first = approvalScheduleRows[i];

      for (let j = i + 1; j < approvalScheduleRows.length; j += 1) {
        const second = approvalScheduleRows[j];

        const overlap = enrollmentSchedulesOverlap(
          first.schedule_days,
          first.schedule_time,
          second.schedule_days,
          second.schedule_time,
        );

        if (!overlap.overlap) {
          continue;
        }

        const firstId = Number(first.enrollment_subject_id);

        const secondId = Number(second.enrollment_subject_id);

        const conflictKey =
          `${Math.min(firstId, secondId)}:` + `${Math.max(firstId, secondId)}`;

        if (approvalScheduleConflictKeys.has(conflictKey)) {
          continue;
        }

        approvalScheduleConflictKeys.add(conflictKey);

        approvalScheduleConflicts.push({
          common_days: overlap.common_days,

          first_subject: {
            enrollment_subject_id: firstId,

            subject_id: Number(first.subject_id),

            subject_code: first.subject_code,

            subject_name: first.subject_name,

            enrollment_type: first.enrollment_type,

            offering_id: Number(first.offering_id),

            section_id: Number(first.section_id),

            section_name: first.section_name,

            schedule: {
              days: first.schedule_days,

              time: first.schedule_time,
            },
          },

          second_subject: {
            enrollment_subject_id: secondId,

            subject_id: Number(second.subject_id),

            subject_code: second.subject_code,

            subject_name: second.subject_name,

            enrollment_type: second.enrollment_type,

            offering_id: Number(second.offering_id),

            section_id: Number(second.section_id),

            section_name: second.section_name,

            schedule: {
              days: second.schedule_days,

              time: second.schedule_time,
            },
          },
        });
      }
    }

    if (approvalScheduleConflicts.length > 0) {
      validationErrors.push({
        code: "STUDENT_SCHEDULE_CONFLICT",

        message:
          "One or more assigned classes overlap in the Student's schedule.",

        conflict_count: approvalScheduleConflicts.length,

        conflicts: approvalScheduleConflicts,
      });
    }

    // =================================================
    // STUDENT SCHEDULE CONFLICT VALIDATION
    // =================================================

    const scheduleConflictKeys = new Set();

    const studentScheduleConflicts = [];

    for (let i = 0; i < assignedScheduleRows.length; i += 1) {
      const first = assignedScheduleRows[i];

      for (let j = i + 1; j < assignedScheduleRows.length; j += 1) {
        const second = assignedScheduleRows[j];

        const overlap = enrollmentSchedulesOverlap(
          first.schedule_days,
          first.schedule_time,
          second.schedule_days,
          second.schedule_time,
        );

        if (!overlap.overlap) {
          continue;
        }

        const firstId = Number(first.enrollment_subject_id);

        const secondId = Number(second.enrollment_subject_id);

        const conflictKey =
          `${Math.min(firstId, secondId)}:` + `${Math.max(firstId, secondId)}`;

        if (scheduleConflictKeys.has(conflictKey)) {
          continue;
        }

        scheduleConflictKeys.add(conflictKey);

        studentScheduleConflicts.push({
          common_days: overlap.common_days,

          first_subject: {
            enrollment_subject_id: firstId,

            subject_id: Number(first.subject_id),

            subject_code: first.subject_code,

            subject_name: first.subject_name,

            enrollment_type: first.enrollment_type,

            offering_id: Number(first.offering_id),

            section_id: Number(first.section_id),

            section_name: first.section_name,

            schedule: {
              days: first.schedule_days,

              time: first.schedule_time,
            },
          },

          second_subject: {
            enrollment_subject_id: secondId,

            subject_id: Number(second.subject_id),

            subject_code: second.subject_code,

            subject_name: second.subject_name,

            enrollment_type: second.enrollment_type,

            offering_id: Number(second.offering_id),

            section_id: Number(second.section_id),

            section_name: second.section_name,

            schedule: {
              days: second.schedule_days,

              time: second.schedule_time,
            },
          },
        });
      }
    }

    if (studentScheduleConflicts.length > 0) {
      validationErrors.push({
        code: "STUDENT_SCHEDULE_CONFLICT",

        message:
          "One or more assigned classes overlap in the Student's schedule.",

        conflict_count: studentScheduleConflicts.length,

        conflicts: studentScheduleConflicts,
      });
    }
    // =================================================
    // 13. BLOCK IF ANY FINAL VALIDATION FAILED
    // =================================================

    if (validationErrors.length > 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "ENROLLMENT_APPROVAL_VALIDATION_FAILED",

        message: "Enrollment failed final approval validation.",

        can_approve: false,

        validation_errors: validationErrors,
      });
    }

    // =================================================
    // 14. TOTAL UNITS
    // =================================================

    const totalUnits = subjectRows.reduce(
      (total, subject) => total + Number(subject.units || 0),
      0,
    );

    // =================================================
    // 15. OLD AUDIT VALUES
    // =================================================

    const oldValues = {
      enrollment_status: enrollment.enrollment_status,

      remarks: enrollment.remarks || null,

      approved_by:
        enrollment.approved_by !== null ? Number(enrollment.approved_by) : null,

      approved_at: enrollment.approved_at || null,
    };

    // =================================================
    // 16. APPROVE
    //
    // IMPORTANT:
    // approved_by comes ONLY from JWT.
    // =================================================

    const [updateResult] = await connection.execute(
      `
          UPDATE enrollments

          SET
              enrollment_status =
                  'Approved',

              approved_by = ?,

              approved_at =
                  CURRENT_TIMESTAMP,

              remarks =
                  COALESCE(
                    ?,
                    remarks
                  )

          WHERE enrollment_id = ?

            AND enrollment_status =
                'Pending'
        `,
      [approvedBy, approvalRemarks, enrollmentId],
    );

    // =================================================
    // 17. CONCURRENCY PROTECTION
    // =================================================

    if (updateResult.affectedRows !== 1) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        message:
          "Enrollment could not be approved because its status changed before approval.",
      });
    }

    // =================================================
    // 18. GET APPROVED RECORD
    // =================================================

    const [approvedRows] = await connection.execute(
      `
          SELECT
              enrollment_id,
              student_id,

              academic_year_id,
              semester_id,

              enrollment_status,
              remarks,

              approved_by,
              approved_at,

              created_at

          FROM enrollments

          WHERE enrollment_id = ?

          LIMIT 1
        `,
      [enrollmentId],
    );

    const approvedEnrollment = approvedRows[0];

    // =================================================
    // 19. NEW AUDIT VALUES
    // =================================================

    const newValues = {
      enrollment_status: approvedEnrollment.enrollment_status,

      remarks: approvedEnrollment.remarks || null,

      approved_by:
        approvedEnrollment.approved_by !== null
          ? Number(approvedEnrollment.approved_by)
          : null,

      approved_at: approvedEnrollment.approved_at || null,
    };

    // =================================================
    // 20. AUDIT TRAIL
    // =================================================

    await connection.execute(
      `
        INSERT INTO audit_trail (
            user_id,
            table_name,
            record_id,
            action,
            old_values,
            new_values
        )

        VALUES (
            ?,
            'enrollments',
            ?,
            'UPDATE',
            ?,
            ?
        )
      `,
      [
        approvedBy,
        enrollmentId,

        JSON.stringify(oldValues),

        JSON.stringify(newValues),
      ],
    );

    // =================================================
    // 21. COMMIT
    // =================================================

    await connection.commit();

    transactionActive = false;

    // =================================================
    // 22. SUCCESS
    // =================================================

    return res.status(200).json({
      success: true,

      message: "Enrollment approved successfully.",

      enrollment: {
        enrollment_id: enrollmentId,

        student_id: studentId,

        student_number: enrollment.student_number,

        student_name: [
          enrollment.first_name,
          enrollment.middle_name,
          enrollment.last_name,
        ]
          .filter(Boolean)
          .join(" "),

        course_id: courseId,

        course_code: enrollment.course_code,

        course_name: enrollment.course_name,

        year_level: yearLevel,

        academic_year_id: academicYearId,

        academic_year: enrollment.academic_year,

        semester_id: semesterId,

        semester_name: enrollment.semester_name,

        enrollment_status: "Approved",

        remarks: approvedEnrollment.remarks || null,

        approved_by: {
          user_id: approvedBy,

          username: req.user.username || null,
        },

        approved_at: approvedEnrollment.approved_at,

        created_at: approvedEnrollment.created_at,
      },

      summary: {
        total_subjects: subjectRows.length,

        total_units: totalUnits,
      },
    });
  } catch (error) {
    if (connection && transactionActive) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("APPROVE ENROLLMENT ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("APPROVE ENROLLMENT ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to approve enrollment.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// ROUTE 15
// REJECT ENROLLMENT
//
// POST
// /api/registrar/enrollments/:id/reject
//
// Body:
// {
//   "remarks": "Incomplete enrollment requirements."
// }
//
// Rules:
// - Only Pending enrollment can be rejected
// - Rejection reason is required
// - Registrar comes ONLY from req.user
// - Frontend does NOT send rejected_by
// - approved_by / approved_at are cleared
// - Rejection actor/time is preserved in audit_trail
//
// Enrollment remains in the database.
// Subjects are NOT deleted.
// =====================================================

router.post("/:id/reject", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  // =================================================
  // ENROLLMENT ID
  // =================================================

  const enrollmentId = toPositiveInt(req.params.id);

  if (!enrollmentId) {
    return res.status(400).json({
      success: false,
      message: "Invalid enrollment ID.",
    });
  }

  // =================================================
  // REJECTION REASON
  // =================================================

  const rejectionReason =
    typeof req.body?.remarks === "string" ? req.body.remarks.trim() : "";

  if (!rejectionReason) {
    return res.status(400).json({
      success: false,
      message: "Rejection reason is required.",
    });
  }

  // Optional safety limit because remarks
  // column is VARCHAR(255).
  if (rejectionReason.length > 255) {
    return res.status(400).json({
      success: false,
      message: "Rejection reason must not exceed 255 characters.",
    });
  }

  let connection;

  try {
    connection = await db.getConnection();

    // =================================================
    // START TRANSACTION
    // =================================================

    await connection.beginTransaction();

    // =================================================
    // GET + LOCK ENROLLMENT
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

              e.approved_by,
              e.approved_at,

              e.created_at,

              s.student_number,
              s.first_name,
              s.middle_name,
              s.last_name,

              s.course_id,
              s.year_level,

              c.course_code,
              c.course_name,

              ay.academic_year,
              sem.semester_name

          FROM enrollments e

          INNER JOIN students s
              ON s.student_id =
                 e.student_id

          LEFT JOIN courses c
              ON c.course_id =
                 s.course_id

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 e.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 e.semester_id

          WHERE e.enrollment_id = ?

          LIMIT 1

          FOR UPDATE
          `,
      [enrollmentId],
    );

    // =================================================
    // NOT FOUND
    // =================================================

    if (enrollmentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // ONLY PENDING CAN BE REJECTED
    // =================================================

    if (enrollment.enrollment_status !== "Pending") {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message: `Enrollment cannot be rejected because its current status is '${enrollment.enrollment_status}'.`,

        enrollment_status: enrollment.enrollment_status,
      });
    }

    // =================================================
    // COUNT SUBJECTS
    //
    // Rejection does NOT modify subjects.
    // =================================================

    const [subjectCountRows] = await connection.execute(
      `
          SELECT
              COUNT(*) AS total_subjects,

              SUM(
                CASE
                  WHEN status = 'Enrolled'
                  THEN 1
                  ELSE 0
                END
              ) AS active_subjects,

              SUM(
                CASE
                  WHEN status = 'Dropped'
                  THEN 1
                  ELSE 0
                END
              ) AS dropped_subjects

          FROM enrollment_subjects

          WHERE enrollment_id = ?
          `,
      [enrollmentId],
    );

    const totalSubjects = Number(subjectCountRows[0]?.total_subjects || 0);

    const activeSubjects = Number(subjectCountRows[0]?.active_subjects || 0);

    const droppedSubjects = Number(subjectCountRows[0]?.dropped_subjects || 0);

    // =================================================
    // OLD VALUES FOR AUDIT
    // =================================================

    const oldValues = {
      enrollment_status: enrollment.enrollment_status,

      remarks: enrollment.remarks || null,

      approved_by: enrollment.approved_by
        ? Number(enrollment.approved_by)
        : null,

      approved_at: enrollment.approved_at || null,
    };

    // =================================================
    // REJECT
    //
    // IMPORTANT:
    // We intentionally clear approval metadata.
    //
    // Rejection actor is stored in audit_trail,
    // not in approved_by.
    // =================================================

    const [updateResult] = await connection.execute(
      `
          UPDATE enrollments

          SET
              enrollment_status =
                  'Rejected',

              remarks = ?,

              approved_by = NULL,

              approved_at = NULL

          WHERE enrollment_id = ?

            AND enrollment_status =
                'Pending'
          `,
      [rejectionReason, enrollmentId],
    );

    // =================================================
    // CONCURRENCY SAFETY
    // =================================================

    if (updateResult.affectedRows !== 1) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message:
          "Enrollment could not be rejected because its status changed before rejection.",
      });
    }

    // =================================================
    // NEW VALUES
    // =================================================

    const newValues = {
      enrollment_status: "Rejected",

      remarks: rejectionReason,

      approved_by: null,

      approved_at: null,

      rejected_by: actor.user_id,
    };

    // =================================================
    // AUDIT TRAIL
    //
    // audit_trail.created_at records rejection time.
    // =================================================

    await connection.execute(
      `
        INSERT INTO audit_trail (
            user_id,
            table_name,
            record_id,
            action,
            old_values,
            new_values
        )

        VALUES (
            ?,
            'enrollments',
            ?,
            'UPDATE',
            ?,
            ?
        )
        `,
      [
        actor.user_id,

        enrollmentId,

        JSON.stringify(oldValues),

        JSON.stringify(newValues),
      ],
    );

    // =================================================
    // GET FINAL ENROLLMENT
    // =================================================

    const [rejectedRows] = await connection.execute(
      `
          SELECT
              enrollment_id,
              student_id,

              academic_year_id,
              semester_id,

              enrollment_status,
              remarks,

              approved_by,
              approved_at,

              created_at

          FROM enrollments

          WHERE enrollment_id = ?

          LIMIT 1
          `,
      [enrollmentId],
    );

    const rejectedEnrollment = rejectedRows[0];

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // SUCCESS
    // =================================================

    return res.status(200).json({
      success: true,

      message: "Enrollment rejected successfully.",

      enrollment: {
        enrollment_id: Number(rejectedEnrollment.enrollment_id),

        student: {
          student_id: Number(enrollment.student_id),

          student_number: enrollment.student_number,

          student_name: [
            enrollment.first_name,
            enrollment.middle_name,
            enrollment.last_name,
          ]
            .filter(Boolean)
            .join(" "),

          year_level:
            enrollment.year_level !== null &&
            enrollment.year_level !== undefined
              ? Number(enrollment.year_level)
              : null,
        },

        course: {
          course_id: enrollment.course_id ? Number(enrollment.course_id) : null,

          course_code: enrollment.course_code || null,

          course_name: enrollment.course_name || null,
        },

        academic_period: {
          academic_year_id: Number(enrollment.academic_year_id),

          academic_year: enrollment.academic_year,

          semester_id: Number(enrollment.semester_id),

          semester_name: enrollment.semester_name,
        },

        enrollment_status: rejectedEnrollment.enrollment_status,

        rejection_reason: rejectedEnrollment.remarks,

        rejected_by: {
          user_id: actor.user_id,

          username: actor.username,
        },

        approval: {
          approved_by: null,
          approved_at: null,
        },

        created_at: rejectedEnrollment.created_at,
      },

      subjects: {
        total: totalSubjects,

        active: activeSubjects,

        dropped: droppedSubjects,
      },

      actor: {
        user_id: actor.user_id,

        username: actor.username,
      },
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("REJECT ENROLLMENT ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("REJECT ENROLLMENT ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to reject enrollment.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// ROUTE 16
// GET COMPLETE ENROLLMENT HISTORY / TIMELINE
//
// GET
// /api/registrar/enrollments/:id/history
//
// Purpose:
// - Read-only enrollment lifecycle history
// - Enrollment creation
// - Pending / Approved / Rejected updates from audit trail
// - Subject ADD / DROP / REMOVE / CHANGE
// - Old and new offering / section information
//
// Does NOT modify anything.
// =====================================================

router.get("/:id/history", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  // =================================================
  // ENROLLMENT ID
  // =================================================

  const enrollmentId = toPositiveInt(req.params.id);

  if (!enrollmentId) {
    return res.status(400).json({
      success: false,
      message: "Invalid enrollment ID.",
    });
  }

  let connection;

  try {
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

              e.approved_by,
              e.approved_at,

              e.created_at,

              s.student_number,
              s.first_name,
              s.middle_name,
              s.last_name,

              s.course_id,
              s.year_level,

              c.course_code,
              c.course_name,

              ay.academic_year,
              sem.semester_name,

              approver.username
                  AS approved_by_username

          FROM enrollments e

          INNER JOIN students s
              ON s.student_id =
                 e.student_id

          LEFT JOIN courses c
              ON c.course_id =
                 s.course_id

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 e.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 e.semester_id

          LEFT JOIN users approver
              ON approver.user_id =
                 e.approved_by

          WHERE e.enrollment_id = ?

          LIMIT 1
          `,
      [enrollmentId],
    );

    // =================================================
    // NOT FOUND
    // =================================================

    if (enrollmentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // SUBJECT CHANGE HISTORY
    // =================================================

    const [subjectChangeRows] = await connection.execute(
      `
          SELECT
              esc.change_id,

              esc.enrollment_id,
              esc.enrollment_subject_id,
              esc.subject_id,

              esc.change_type,

              esc.old_offering_id,
              esc.old_section_id,
              esc.old_section_subject_id,

              esc.new_offering_id,
              esc.new_section_id,
              esc.new_section_subject_id,

              esc.reason,

              esc.changed_by,

              changer.username
                  AS changed_by_username,

              sub.subject_code,
              sub.subject_name,
              sub.units,

              old_sec.section_name
                  AS old_section_name,

              new_sec.section_name
                  AS new_section_name,

              old_off.schedule_days
                  AS old_schedule_days,

              old_off.schedule_time
                  AS old_schedule_time,

              new_off.schedule_days
                  AS new_schedule_days,

              new_off.schedule_time
                  AS new_schedule_time,

              old_off.status
                  AS old_offering_status,

              new_off.status
                  AS new_offering_status,

              esc.created_at

          FROM enrollment_subject_changes esc

          LEFT JOIN users changer
              ON changer.user_id =
                 esc.changed_by

          LEFT JOIN subjects sub
              ON sub.subject_id =
                 esc.subject_id

          LEFT JOIN sections old_sec
              ON old_sec.section_id =
                 esc.old_section_id

          LEFT JOIN sections new_sec
              ON new_sec.section_id =
                 esc.new_section_id

          LEFT JOIN subject_offerings old_off
              ON old_off.offering_id =
                 esc.old_offering_id

          LEFT JOIN subject_offerings new_off
              ON new_off.offering_id =
                 esc.new_offering_id

          WHERE esc.enrollment_id = ?

          ORDER BY
              esc.created_at ASC,
              esc.change_id ASC
          `,
      [enrollmentId],
    );

    // =================================================
    // ENROLLMENT AUDIT HISTORY
    //
    // We only read audit records for the enrollment
    // itself here.
    //
    // Subject changes are already represented through
    // enrollment_subject_changes, avoiding duplicate
    // timeline events.
    // =================================================

    const [enrollmentAuditRows] = await connection.execute(
      `
          SELECT
              at.user_id,

              at.table_name,
              at.record_id,

              at.action,

              at.old_values,
              at.new_values,

              at.created_at,

              u.username
                  AS actor_username

          FROM audit_trail at

          LEFT JOIN users u
              ON u.user_id =
                 at.user_id

          WHERE at.table_name =
                'enrollments'

            AND at.record_id = ?

          ORDER BY
              at.created_at ASC
          `,
      [enrollmentId],
    );

    // =================================================
    // SAFE JSON PARSER
    //
    // mysql2 may return JSON columns as:
    // - object
    // - string
    // - Buffer
    // - null
    // =================================================

    const parseAuditJson = (value) => {
      if (value === null || value === undefined) {
        return null;
      }

      if (typeof value === "object") {
        if (Buffer.isBuffer(value)) {
          try {
            return JSON.parse(value.toString("utf8"));
          } catch {
            return value.toString("utf8");
          }
        }

        return value;
      }

      if (typeof value === "string") {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }

      return value;
    };

    // =================================================
    // TIMELINE
    // =================================================

    const timeline = [];

    // =================================================
    // ENROLLMENT CREATED EVENT
    //
    // enrollments.created_at is authoritative for
    // creation even if older records do not have an
    // audit INSERT entry.
    // =================================================

    timeline.push({
      event_type: "ENROLLMENT_CREATED",

      category: "ENROLLMENT",

      title: "Enrollment created",

      description: `Enrollment record created with status '${enrollment.enrollment_status === "Draft" ? "Draft" : "Initial"}'.`,

      enrollment_id: enrollmentId,

      subject: null,

      old: null,

      new: {
        enrollment_id: enrollmentId,

        student_id: Number(enrollment.student_id),

        academic_year_id: Number(enrollment.academic_year_id),

        semester_id: Number(enrollment.semester_id),
      },

      reason: null,

      actor: {
        user_id: null,
        username: null,
      },

      created_at: enrollment.created_at,
    });

    // =================================================
    // ENROLLMENT AUDIT EVENTS
    // =================================================

    for (const audit of enrollmentAuditRows) {
      const oldValues = parseAuditJson(audit.old_values);

      const newValues = parseAuditJson(audit.new_values);

      const oldStatus =
        oldValues && typeof oldValues === "object"
          ? oldValues.enrollment_status || null
          : null;

      const newStatus =
        newValues && typeof newValues === "object"
          ? newValues.enrollment_status || null
          : null;

      let eventType = "ENROLLMENT_UPDATE";

      let title = "Enrollment updated";

      let description = "Enrollment information was updated.";

      // ===============================================
      // STATUS CHANGE
      // ===============================================

      if (oldStatus && newStatus && oldStatus !== newStatus) {
        eventType = "ENROLLMENT_STATUS_CHANGE";

        title = `${oldStatus} → ${newStatus}`;

        description = `Enrollment status changed from '${oldStatus}' to '${newStatus}'.`;
      }

      // ===============================================
      // APPROVED
      // ===============================================

      if (newStatus === "Approved") {
        eventType = "ENROLLMENT_APPROVED";

        title = "Enrollment approved";

        description = "Enrollment was approved by the Registrar.";
      }

      // ===============================================
      // REJECTED
      // ===============================================

      if (newStatus === "Rejected") {
        eventType = "ENROLLMENT_REJECTED";

        title = "Enrollment rejected";

        description = newValues?.remarks
          ? `Enrollment was rejected: ${newValues.remarks}`
          : "Enrollment was rejected by the Registrar.";
      }

      timeline.push({
        event_type: eventType,

        category: "ENROLLMENT",

        title,

        description,

        enrollment_id: enrollmentId,

        subject: null,

        action: audit.action,

        old: oldValues,

        new: newValues,

        reason:
          newValues && typeof newValues === "object"
            ? newValues.remarks || null
            : null,

        actor: {
          user_id: audit.user_id ? Number(audit.user_id) : null,

          username: audit.actor_username || null,
        },

        created_at: audit.created_at,
      });
    }

    // =================================================
    // SUBJECT CHANGE EVENTS
    // =================================================

    for (const change of subjectChangeRows) {
      let title = "Subject changed";

      let description = "Enrollment subject was changed.";

      // ===============================================
      // ADD
      // ===============================================

      if (change.change_type === "ADD") {
        title = "Subject added";

        description = `${change.subject_code || "Subject"} was added to the enrollment.`;
      }

      // ===============================================
      // DROP
      // ===============================================

      if (change.change_type === "DROP") {
        title = "Subject dropped";

        description = `${change.subject_code || "Subject"} was dropped from the enrollment.`;
      }

      // ===============================================
      // REMOVE
      // ===============================================

      if (change.change_type === "REMOVE") {
        title = "Subject removed";

        description = `${change.subject_code || "Subject"} was removed from the enrollment.`;
      }

      // ===============================================
      // CHANGE
      // ===============================================

      if (change.change_type === "CHANGE") {
        title = "Subject assignment changed";

        description = `${change.subject_code || "Subject"} section/offering assignment was changed.`;
      }

      timeline.push({
        event_type: `SUBJECT_${change.change_type}`,

        category: "SUBJECT",

        title,

        description,

        change_id: Number(change.change_id),

        enrollment_id: enrollmentId,

        enrollment_subject_id: change.enrollment_subject_id
          ? Number(change.enrollment_subject_id)
          : null,

        subject: {
          subject_id: change.subject_id ? Number(change.subject_id) : null,

          subject_code: change.subject_code || null,

          subject_name: change.subject_name || null,

          units:
            change.units !== null && change.units !== undefined
              ? Number(change.units)
              : null,
        },

        change_type: change.change_type,

        old: {
          offering_id: change.old_offering_id
            ? Number(change.old_offering_id)
            : null,

          section_id: change.old_section_id
            ? Number(change.old_section_id)
            : null,

          section_name: change.old_section_name || null,

          section_subject_id: change.old_section_subject_id
            ? Number(change.old_section_subject_id)
            : null,

          schedule_days: change.old_schedule_days || null,

          schedule_time: change.old_schedule_time || null,

          offering_status: change.old_offering_status || null,
        },

        new: {
          offering_id: change.new_offering_id
            ? Number(change.new_offering_id)
            : null,

          section_id: change.new_section_id
            ? Number(change.new_section_id)
            : null,

          section_name: change.new_section_name || null,

          section_subject_id: change.new_section_subject_id
            ? Number(change.new_section_subject_id)
            : null,

          schedule_days: change.new_schedule_days || null,

          schedule_time: change.new_schedule_time || null,

          offering_status: change.new_offering_status || null,
        },

        reason: change.reason || null,

        actor: {
          user_id: change.changed_by ? Number(change.changed_by) : null,

          username: change.changed_by_username || null,
        },

        created_at: change.created_at,
      });
    }

    // =================================================
    // SORT COMPLETE TIMELINE
    //
    // Newest event first.
    // =================================================

    timeline.sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;

      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;

      return bTime - aTime;
    });

    // =================================================
    // SUMMARY COUNTS
    // =================================================

    const subjectChangeCounts = {
      ADD: 0,
      DROP: 0,
      REMOVE: 0,
      CHANGE: 0,
    };

    for (const change of subjectChangeRows) {
      if (
        Object.prototype.hasOwnProperty.call(
          subjectChangeCounts,
          change.change_type,
        )
      ) {
        subjectChangeCounts[change.change_type] += 1;
      }
    }

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      enrollment: {
        enrollment_id: Number(enrollment.enrollment_id),

        student: {
          student_id: Number(enrollment.student_id),

          student_number: enrollment.student_number,

          student_name: [
            enrollment.first_name,
            enrollment.middle_name,
            enrollment.last_name,
          ]
            .filter(Boolean)
            .join(" "),

          year_level:
            enrollment.year_level !== null &&
            enrollment.year_level !== undefined
              ? Number(enrollment.year_level)
              : null,
        },

        course: {
          course_id: enrollment.course_id ? Number(enrollment.course_id) : null,

          course_code: enrollment.course_code || null,

          course_name: enrollment.course_name || null,
        },

        academic_period: {
          academic_year_id: Number(enrollment.academic_year_id),

          academic_year: enrollment.academic_year,

          semester_id: Number(enrollment.semester_id),

          semester_name: enrollment.semester_name,
        },

        enrollment_status: enrollment.enrollment_status,

        remarks: enrollment.remarks || null,

        approval: {
          approved_by: enrollment.approved_by
            ? Number(enrollment.approved_by)
            : null,

          approved_by_username: enrollment.approved_by_username || null,

          approved_at: enrollment.approved_at || null,
        },

        created_at: enrollment.created_at,
      },

      summary: {
        total_events: timeline.length,

        enrollment_audit_events: enrollmentAuditRows.length,

        subject_change_events: subjectChangeRows.length,

        subject_changes: {
          added: subjectChangeCounts.ADD,

          dropped: subjectChangeCounts.DROP,

          removed: subjectChangeCounts.REMOVE,

          changed: subjectChangeCounts.CHANGE,
        },
      },

      timeline,

      actor: {
        user_id: actor.user_id,

        username: actor.username,
      },
    });
  } catch (error) {
    console.error("GET ENROLLMENT HISTORY ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to fetch enrollment history.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// ROUTE 17
// ATOMICALLY REPLACE AN ENROLLMENT SUBJECT
//
// PUT
// /api/registrar/enrollments/:id/subjects/:enrollmentSubjectId/replace
//
// BODY:
//
// {
//   "offering_id": 25,
//   "reason": "Incorrect subject was assigned."
// }
//
// PURPOSE:
//
// Replace one subject with a DIFFERENT subject.
//
// IMPORTANT:
//
// - Registrar actor comes from req.user.
// - Frontend sends offering_id only.
// - Backend derives subject / section / section_subject.
// - Pending and Approved enrollments are supported.
// - Any Grade V2 row on the OLD subject blocks replacement.
// - Replacement subject must be academically eligible.
// - Regular subject must belong to the student's current term.
// - Valid Retake may come from an earlier curriculum term.
// - Old subject is NOT deleted.
// - Old subject becomes Dropped.
// - New subject gets a new enrollment_subject row.
// - History is REMOVE + ADD.
// - Everything happens inside one transaction.
//
// SAME SUBJECT / DIFFERENT OFFERING:
// Use the normal assignment/change route instead.
// =====================================================

router.put("/:id/subjects/:enrollmentSubjectId/replace", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  // =================================================
  // 1. IDS
  // =================================================

  const enrollmentId = toPositiveInt(req.params.id);

  const enrollmentSubjectId = toPositiveInt(req.params.enrollmentSubjectId);

  if (!enrollmentId) {
    return res.status(400).json({
      success: false,
      message: "Invalid enrollment ID.",
    });
  }

  if (!enrollmentSubjectId) {
    return res.status(400).json({
      success: false,
      message: "Invalid enrollment subject ID.",
    });
  }

  // =================================================
  // 2. REQUEST BODY
  // =================================================

  const offeringId = toPositiveInt(req.body?.offering_id);

  if (!offeringId) {
    return res.status(400).json({
      success: false,
      message: "A valid offering_id is required.",
    });
  }

  const replacementReason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

  if (!replacementReason) {
    return res.status(400).json({
      success: false,

      code: "REPLACEMENT_REASON_REQUIRED",

      message: "Replacement reason is required.",
    });
  }

  if (replacementReason.length > 500) {
    return res.status(400).json({
      success: false,

      message: "Replacement reason must not exceed 500 characters.",
    });
  }

  let connection;
  let transactionActive = false;

  try {
    // =================================================
    // 3. TRANSACTION
    // =================================================

    connection = await db.getConnection();

    await connection.beginTransaction();

    transactionActive = true;

    // =================================================
    // 4. LOCK ENROLLMENT + STUDENT
    // =================================================

    const [enrollmentRows] = await connection.execute(
      `
            SELECT
                e.enrollment_id,
                e.student_id,

                e.academic_year_id,
                e.semester_id,

                e.enrollment_status,

                s.student_number,
                s.first_name,
                s.middle_name,
                s.last_name,

                s.course_id,
                s.year_level,

                c.course_code,
                c.course_name,

                ay.academic_year,
                sem.semester_name

            FROM enrollments e

            INNER JOIN students s
                ON s.student_id =
                   e.student_id

            LEFT JOIN courses c
                ON c.course_id =
                   s.course_id

            INNER JOIN academic_years ay
                ON ay.academic_year_id =
                   e.academic_year_id

            INNER JOIN semesters sem
                ON sem.semester_id =
                   e.semester_id

            WHERE e.enrollment_id = ?

            LIMIT 1

            FOR UPDATE
          `,
      [enrollmentId],
    );

    if (enrollmentRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(404).json({
        success: false,
        message: "Enrollment not found.",
      });
    }

    const enrollment = enrollmentRows[0];

    // =================================================
    // 5. EDITABLE ENROLLMENT STATUS
    // =================================================

    if (!["Pending", "Approved"].includes(enrollment.enrollment_status)) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "ENROLLMENT_NOT_EDITABLE",

        message: `Subject cannot be replaced because enrollment status is "${enrollment.enrollment_status}".`,

        enrollment_status: enrollment.enrollment_status,
      });
    }

    // =================================================
    // 6. STUDENT COURSE / YEAR
    // =================================================

    const studentId = Number(enrollment.student_id);

    const studentCourseId = toPositiveInt(enrollment.course_id);

    const studentYearLevel = toPositiveInt(enrollment.year_level);

    const academicYearId = Number(enrollment.academic_year_id);

    const semesterId = Number(enrollment.semester_id);

    if (!studentCourseId) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        message: "Student does not have a valid course assignment.",
      });
    }

    if (!studentYearLevel) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        message: "Student does not have a valid year level.",
      });
    }

    // =================================================
    // 7. ACTIVE CURRICULUM
    // =================================================

    const [curriculumRows] = await connection.execute(
      `
            SELECT
                sc.student_curriculum_id,
                sc.curriculum_id,

                cur.curriculum_name,
                cur.course_id,
                cur.is_active

            FROM student_curriculum sc

            INNER JOIN curriculum cur
                ON cur.curriculum_id =
                   sc.curriculum_id

            WHERE sc.student_id = ?

              AND sc.status = 'Active'

              AND cur.is_active = 1

              AND cur.course_id = ?

            ORDER BY
                sc.assigned_date DESC,
                sc.student_curriculum_id DESC

            LIMIT 1

            FOR UPDATE
          `,
      [studentId, studentCourseId],
    );

    if (curriculumRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "VALID_ACTIVE_CURRICULUM_REQUIRED",

        message: "Student does not have a valid active curriculum.",
      });
    }

    const curriculum = curriculumRows[0];

    const curriculumId = Number(curriculum.curriculum_id);

    // =================================================
    // 8. LOCK OLD ENROLLMENT SUBJECT
    // =================================================

    const [oldSubjectRows] = await connection.execute(
      `
            SELECT
                es.enrollment_subject_id,
                es.enrollment_id,

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
                so.schedule_time

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

            WHERE es.enrollment_subject_id = ?

              AND es.enrollment_id = ?

            LIMIT 1

            FOR UPDATE
          `,
      [enrollmentSubjectId, enrollmentId],
    );

    if (oldSubjectRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(404).json({
        success: false,

        message: "Enrollment subject not found.",
      });
    }

    const oldSubject = oldSubjectRows[0];

    // =================================================
    // 9. OLD SUBJECT MUST BE ENROLLED
    // =================================================

    if (oldSubject.status !== "Enrolled") {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "ENROLLMENT_SUBJECT_NOT_EDITABLE",

        message: `Subject cannot be replaced because its current status is "${oldSubject.status}".`,
      });
    }

    // =================================================
    // 10. GRADE V2 LOCK
    //
    // ANY grade row means grading has started.
    //
    // Draft
    // Submitted
    // Returned
    // Approved
    //
    // All lock replacement.
    // =================================================

    const [gradeRows] = await connection.execute(
      `
            SELECT
                grade_id,
                enrollment_subject_id,
                faculty_id,

                final_rating,
                remarks,
                grade_status

            FROM grades

            WHERE enrollment_subject_id = ?

            LIMIT 1

            FOR UPDATE
          `,
      [enrollmentSubjectId],
    );

    if (gradeRows.length > 0) {
      const grade = gradeRows[0];

      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "SUBJECT_GRADE_LOCKED",

        message:
          "This subject cannot be replaced because grading has already started.",

        grade: {
          grade_id: Number(grade.grade_id),

          grade_status: grade.grade_status,

          final_rating:
            grade.final_rating !== null ? Number(grade.final_rating) : null,

          remarks: grade.remarks || null,
        },
      });
    }

    // =================================================
    // 11. LOCK TARGET OFFERING
    // =================================================

    const [offeringRows] = await connection.execute(
      `
            SELECT
                so.offering_id,

                so.subject_id,
                so.section_id,
                so.section_subject_id,

                so.faculty_id,
                so.room_id,

                so.academic_year_id,
                so.semester_id,

                so.schedule_days,
                so.schedule_time,

                so.max_students,

                so.status
                    AS offering_status,

                sub.subject_code,
                sub.subject_name,
                sub.units,

                sub.lecture_hours,
                sub.laboratory_hours,

                sub.is_active
                    AS subject_is_active,

                ss.status
                    AS section_subject_status,

                ss.subject_id
                    AS ss_subject_id,

                ss.section_id
                    AS ss_section_id,

                ss.academic_year_id
                    AS ss_academic_year_id,

                ss.semester_id
                    AS ss_semester_id,

                sec.section_name,
                sec.year_level,

                sec.course_id
                    AS section_course_id,

                course.course_code
                    AS section_course_code,

                course.course_name
                    AS section_course_name,

                r.room_name,
                r.capacity
                    AS room_capacity

            FROM subject_offerings so

            INNER JOIN subjects sub
                ON sub.subject_id =
                   so.subject_id

            INNER JOIN section_subjects ss
                ON ss.section_subject_id =
                   so.section_subject_id

            INNER JOIN sections sec
                ON sec.section_id =
                   so.section_id

            LEFT JOIN courses course
                ON course.course_id =
                   sec.course_id

            LEFT JOIN rooms r
                ON r.room_id =
                   so.room_id

            WHERE so.offering_id = ?

            LIMIT 1

            FOR UPDATE
          `,
      [offeringId],
    );

    if (offeringRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(404).json({
        success: false,

        message: "Replacement subject offering not found.",
      });
    }

    const newOffering = offeringRows[0];

    // =================================================
    // 12. MUST BE A DIFFERENT SUBJECT
    //
    // Same subject:
    // use assignment/change offering route.
    // =================================================

    if (Number(newOffering.subject_id) === Number(oldSubject.subject_id)) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "SAME_SUBJECT_USE_CHANGE_OFFERING",

        message:
          "Replacement offering belongs to the same subject. Use the subject assignment/change route instead.",

        current_subject_id: Number(oldSubject.subject_id),

        replacement_subject_id: Number(newOffering.subject_id),
      });
    }

    // =================================================
    // 13. TARGET SUBJECT ACTIVE
    // =================================================

    if (Number(newOffering.subject_is_active) !== 1) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "SUBJECT_INACTIVE",

        message: "Replacement subject is inactive.",
      });
    }

    // =================================================
    // 14. OFFERING ACADEMIC PERIOD
    // =================================================

    if (Number(newOffering.academic_year_id) !== academicYearId) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_ACADEMIC_YEAR_MISMATCH",

        message:
          "Replacement offering does not belong to the enrollment academic year.",
      });
    }

    if (Number(newOffering.semester_id) !== semesterId) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_SEMESTER_MISMATCH",

        message:
          "Replacement offering does not belong to the enrollment semester.",
      });
    }

    // =================================================
    // 16. SECTION-SUBJECT RELATIONSHIP
    // =================================================

    if (
      Number(newOffering.ss_subject_id) !== Number(newOffering.subject_id) ||
      Number(newOffering.ss_section_id) !== Number(newOffering.section_id) ||
      Number(newOffering.ss_academic_year_id) !==
        Number(newOffering.academic_year_id) ||
      Number(newOffering.ss_semester_id) !== Number(newOffering.semester_id)
    ) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "INVALID_SECTION_SUBJECT_RELATIONSHIP",

        message:
          "Replacement offering has an invalid section-subject relationship.",
      });
    }

    // =================================================
    // 17. OPEN STATUS
    // =================================================

    if (newOffering.offering_status !== "Open") {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_NOT_OPEN",

        message: `Replacement offering is "${newOffering.offering_status}".`,
      });
    }

    if (newOffering.section_subject_status !== "Open") {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "SECTION_SUBJECT_NOT_OPEN",

        message: `Replacement section-subject is "${newOffering.section_subject_status}".`,
      });
    }

    // =================================================
    // 18. READINESS
    //
    // Room remains OPTIONAL.
    // =================================================

    const maxStudents = Number(newOffering.max_students || 0);

    const missingConfiguration = [];

    if (!newOffering.faculty_id) {
      missingConfiguration.push("faculty");
    }

    if (
      !newOffering.schedule_days ||
      !String(newOffering.schedule_days).trim()
    ) {
      missingConfiguration.push("schedule_days");
    }

    if (
      !newOffering.schedule_time ||
      !String(newOffering.schedule_time).trim()
    ) {
      missingConfiguration.push("schedule_time");
    }

    if (!Number.isInteger(maxStudents) || maxStudents <= 0) {
      missingConfiguration.push("capacity");
    }

    if (missingConfiguration.length > 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_INCOMPLETE",

        message:
          "Replacement offering is incomplete and is not ready for enrollment.",

        missing_configuration: missingConfiguration,
      });
    }

    // =================================================
    // 19. OPTIONAL ROOM CAPACITY
    // =================================================

    if (
      newOffering.room_capacity !== null &&
      Number(newOffering.room_capacity) > 0 &&
      maxStudents > Number(newOffering.room_capacity)
    ) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_EXCEEDS_ROOM_CAPACITY",

        message:
          "Replacement offering capacity exceeds the assigned room capacity.",

        room: {
          room_id:
            newOffering.room_id !== null ? Number(newOffering.room_id) : null,

          room_name: newOffering.room_name || null,

          room_capacity: Number(newOffering.room_capacity),
        },

        offering_capacity: maxStudents,
      });
    }

    // =================================================
    // 20. TARGET SUBJECT MUST BELONG TO
    //     ACTIVE STUDENT CURRICULUM
    // =================================================

    const [curriculumSubjectRows] = await connection.execute(
      `
            SELECT
                curriculum_subject_id,
                curriculum_id,
                subject_id,

                year_level,
                semester_id,

                is_required,
                display_order

            FROM curriculum_subjects

            WHERE curriculum_id = ?

              AND subject_id = ?

            LIMIT 1
          `,
      [curriculumId, Number(newOffering.subject_id)],
    );

    if (curriculumSubjectRows.length === 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "SUBJECT_NOT_IN_ASSIGNED_CURRICULUM",

        message:
          "Replacement subject does not belong to the Student's active curriculum.",
      });
    }

    const curriculumSubject = curriculumSubjectRows[0];

    const replacementSubjectId = Number(newOffering.subject_id);

    // =================================================
    // 21. SHARED GRADE V2 ACADEMIC ELIGIBILITY
    // =================================================

    const academicEligibility = await evaluateSubjectEligibility(
      studentId,
      replacementSubjectId,
      connection,
    );

    if (!academicEligibility.eligible) {
      let code = "SUBJECT_ACADEMICALLY_INELIGIBLE";

      if (
        academicEligibility.eligibility_type === ELIGIBILITY_TYPE.ALREADY_PASSED
      ) {
        code = "SUBJECT_ALREADY_PASSED";
      } else if (
        academicEligibility.eligibility_type ===
        ELIGIBILITY_TYPE.BLOCKED_PREREQUISITE
      ) {
        code = "PREREQUISITE_NOT_PASSED";
      } else if (
        academicEligibility.eligibility_type === ELIGIBILITY_TYPE.UNRESOLVED
      ) {
        code = "ACADEMIC_RESULT_UNRESOLVED";
      }

      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code,

        message:
          academicEligibility.reason ||
          `Student is not academically eligible to take replacement subject ${newOffering.subject_code}.`,

        academic_eligibility: academicEligibility,
      });
    }

    // =================================================
    // 22. AUTHORITATIVE REPLACEMENT ENROLLMENT TYPE
    //
    // Retake:
    //   Approved failed/incomplete prior result.
    //
    // Regular:
    //   Current curriculum year + semester.
    //
    // Carry Over:
    //   Earlier required subject never officially taken
    //   and still academically eligible.
    // =================================================

    let resolvedEnrollmentType = null;

    // ===============================================
    // RETAKE
    // ===============================================

    if (academicEligibility.eligibility_type === ELIGIBILITY_TYPE.RETAKE) {
      resolvedEnrollmentType = "Retake";
    }

    // ===============================================
    // REGULAR OR CARRY OVER
    // ===============================================
    else if (
      academicEligibility.eligibility_type === ELIGIBILITY_TYPE.REGULAR
    ) {
      const isCurrentCurriculumTerm =
        Number(curriculumSubject.year_level) === studentYearLevel &&
        Number(curriculumSubject.semester_id) === semesterId;

      if (isCurrentCurriculumTerm) {
        resolvedEnrollmentType = "Regular";
      } else {
        const carryOverEvaluation = await getCarryOverCandidates(
          studentId,
          curriculumId,
          studentYearLevel,
          semesterId,
          connection,
        );

        const carryOverSubject = carryOverEvaluation.eligible.find(
          (item) => Number(item.subject_id) === replacementSubjectId,
        );

        if (carryOverSubject) {
          resolvedEnrollmentType = "Carry Over";
        }
      }
    }

    // ===============================================
    // TYPE MUST BE RESOLVED
    // ===============================================

    if (!resolvedEnrollmentType) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "ENROLLMENT_TYPE_COULD_NOT_BE_RESOLVED",

        message:
          "The replacement subject is academically eligible but could not be classified as Regular, Retake, or Carry Over.",

        subject: {
          subject_id: replacementSubjectId,

          subject_code: newOffering.subject_code || null,
        },

        academic_eligibility_type: academicEligibility.eligibility_type || null,
      });
    }

    // =================================================
    // TYPE-AWARE REPLACEMENT PLACEMENT
    //
    // Regular:
    //   same course
    //   same year level
    //
    // Retake / Carry Over:
    //   cross-section allowed
    //   cross-year allowed
    //   cross-course allowed
    //
    // Same AY / semester were already validated.
    // =================================================

    if (resolvedEnrollmentType === "Regular") {
      // ===============================================
      // REGULAR -> SAME COURSE
      // ===============================================

      if (Number(newOffering.section_course_id) !== studentCourseId) {
        await connection.rollback();

        transactionActive = false;

        return res.status(409).json({
          success: false,

          code: "OFFERING_COURSE_MISMATCH",

          message:
            "A Regular replacement subject must use an offering within the Student's course.",

          student_course: {
            course_id: studentCourseId,

            course_code: enrollment.course_code,
          },

          replacement_course: {
            course_id:
              newOffering.section_course_id !== null
                ? Number(newOffering.section_course_id)
                : null,

            course_code: newOffering.section_course_code || null,
          },
        });
      }

      // ===============================================
      // REGULAR -> SAME YEAR LEVEL
      // ===============================================

      if (Number(newOffering.year_level) !== studentYearLevel) {
        await connection.rollback();

        transactionActive = false;

        return res.status(409).json({
          success: false,

          code: "REGULAR_SECTION_YEAR_LEVEL_MISMATCH",

          message:
            "A Regular replacement subject must use a section matching the Student's current year level.",

          student_year_level: studentYearLevel,

          section_year_level: Number(newOffering.year_level),
        });
      }
    }
    // =================================================
    // 23. DUPLICATE TARGET SUBJECT
    //
    // Do not create another active attempt in this
    // same enrollment.
    // =================================================

    const [duplicateRows] = await connection.execute(
      `
            SELECT
                enrollment_subject_id,
                status

            FROM enrollment_subjects

            WHERE enrollment_id = ?

              AND subject_id = ?

              AND enrollment_subject_id <> ?

              AND status IN (
                  'Enrolled',
                  'Completed',
                  'Failed',
                  'Incomplete'
              )

            LIMIT 1

            FOR UPDATE
          `,
      [enrollmentId, Number(newOffering.subject_id), enrollmentSubjectId],
    );

    if (duplicateRows.length > 0) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "DUPLICATE_ACTIVE_SUBJECT",

        message: "Replacement subject is already part of this enrollment.",

        existing_subject: {
          enrollment_subject_id: Number(duplicateRows[0].enrollment_subject_id),

          status: duplicateRows[0].status,
        },
      });
    }

    // =================================================
    // REPLACEMENT STUDENT SCHEDULE CONFLICT
    //
    // The old enrollment subject being replaced is
    // excluded because it will become Dropped.
    // =================================================

    const [otherAssignedSubjectRows] = await connection.execute(
      `
      SELECT
          es.enrollment_subject_id,
          es.subject_id,
          es.enrollment_type,

          es.offering_id,
          es.section_id,

          sub.subject_code,
          sub.subject_name,

          sec.section_name,

          so.schedule_days,
          so.schedule_time

      FROM enrollment_subjects es

      INNER JOIN subjects sub
          ON sub.subject_id =
             es.subject_id

      INNER JOIN subject_offerings so
          ON so.offering_id =
             es.offering_id

      INNER JOIN section_subjects ss
          ON ss.section_subject_id =
             es.section_subject_id

      INNER JOIN sections sec
          ON sec.section_id =
             es.section_id

      WHERE es.enrollment_id = ?

        AND es.enrollment_subject_id <> ?

        AND es.status = 'Enrolled'

        AND es.offering_id IS NOT NULL

        AND so.status <> 'Cancelled'

        AND ss.status <> 'Cancelled'

      ORDER BY
          es.enrollment_subject_id ASC
    `,
      [enrollmentId, enrollmentSubjectId],
    );

    const replacementScheduleConflicts = [];

    for (const existingSubject of otherAssignedSubjectRows) {
      const overlap = enrollmentSchedulesOverlap(
        newOffering.schedule_days,
        newOffering.schedule_time,
        existingSubject.schedule_days,
        existingSubject.schedule_time,
      );

      if (!overlap.overlap) {
        continue;
      }

      replacementScheduleConflicts.push({
        enrollment_subject_id: Number(existingSubject.enrollment_subject_id),

        subject_id: Number(existingSubject.subject_id),

        subject_code: existingSubject.subject_code,

        subject_name: existingSubject.subject_name,

        enrollment_type: existingSubject.enrollment_type,

        offering_id:
          existingSubject.offering_id !== null
            ? Number(existingSubject.offering_id)
            : null,

        section_id:
          existingSubject.section_id !== null
            ? Number(existingSubject.section_id)
            : null,

        section_name: existingSubject.section_name || null,

        schedule: {
          days: existingSubject.schedule_days,

          time: existingSubject.schedule_time,
        },

        common_days: overlap.common_days,
      });
    }

    if (replacementScheduleConflicts.length > 0) {
      await connection.rollback();

      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "STUDENT_SCHEDULE_CONFLICT",

        message:
          "The replacement offering conflicts with one or more of the Student's currently assigned classes.",

        replacement_subject: {
          subject_id: replacementSubjectId,

          subject_code: newOffering.subject_code,

          enrollment_type: resolvedEnrollmentType,
        },

        selected_offering: {
          offering_id: Number(newOffering.offering_id),

          section_id: Number(newOffering.section_id),

          section_name: newOffering.section_name || null,

          schedule: {
            days: newOffering.schedule_days,

            time: newOffering.schedule_time,
          },
        },

        conflict_count: replacementScheduleConflicts.length,

        conflicts: replacementScheduleConflicts,
      });
    }

    // =================================================
    // 24. TARGET OFFERING CAPACITY
    //
    // New subject is not inserted yet.
    // Therefore enrolled_count >= max means FULL.
    // =================================================

    const [capacityRows] = await connection.execute(
      `
            SELECT
                COUNT(*) AS enrolled_count

            FROM enrollment_subjects es

            INNER JOIN enrollments e
                ON e.enrollment_id =
                   es.enrollment_id

            WHERE es.offering_id = ?

              AND es.status IN (
                  'Enrolled',
                  'Completed',
                  'Failed',
                  'Incomplete'
              )

              AND e.enrollment_status IN (
                  'Pending',
                  'Approved'
              )

              AND es.enrollment_subject_id <> ?
          `,
      [offeringId, enrollmentSubjectId],
    );

    const enrolledCount = Number(capacityRows[0]?.enrolled_count || 0);

    if (enrolledCount >= maxStudents) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        code: "OFFERING_FULL",

        message: "Replacement subject offering is already full.",

        capacity: {
          max_students: maxStudents,

          enrolled_count: enrolledCount,

          available_slots: 0,
        },
      });
    }

    // =================================================
    // 25. OLD VALUES
    // =================================================

    const oldValues = {
      enrollment_id: enrollmentId,

      enrollment_subject_id: enrollmentSubjectId,

      subject_id: Number(oldSubject.subject_id),

      offering_id:
        oldSubject.offering_id !== null ? Number(oldSubject.offering_id) : null,

      section_id:
        oldSubject.section_id !== null ? Number(oldSubject.section_id) : null,

      section_subject_id:
        oldSubject.section_subject_id !== null
          ? Number(oldSubject.section_subject_id)
          : null,

      status: oldSubject.status,
    };

    // =================================================
    // 26. MARK OLD SUBJECT DROPPED
    //
    // Never hard-delete academic enrollment history.
    // =================================================

    const [oldUpdateResult] = await connection.execute(
      `
            UPDATE enrollment_subjects

            SET status = 'Dropped'

            WHERE enrollment_subject_id = ?

              AND enrollment_id = ?

              AND status = 'Enrolled'
          `,
      [enrollmentSubjectId, enrollmentId],
    );

    if (oldUpdateResult.affectedRows !== 1) {
      await connection.rollback();
      transactionActive = false;

      return res.status(409).json({
        success: false,

        message:
          "Original subject could not be replaced because its status changed.",
      });
    }

    const [insertResult] = await connection.execute(
      `
    INSERT INTO enrollment_subjects (
        enrollment_id,
        subject_id,
        enrollment_type,

        offering_id,
        section_id,
        section_subject_id,

        status
    )

    VALUES (
        ?,
        ?,
        ?,

        ?,
        ?,
        ?,

        'Enrolled'
    )
  `,
      [
        enrollmentId,

        replacementSubjectId,

        resolvedEnrollmentType,

        Number(newOffering.offering_id),

        Number(newOffering.section_id),

        Number(newOffering.section_subject_id),
      ],
    );

    const newEnrollmentSubjectId = Number(insertResult.insertId);

    // =================================================
    // 28. OLD SUBJECT HISTORY -> REMOVE
    //
    // DB enum:
    // ADD / DROP / REMOVE / CHANGE
    //
    // There is intentionally no REPLACE enum.
    // =================================================

    await connection.execute(
      `
          INSERT INTO enrollment_subject_changes (
              enrollment_id,
              enrollment_subject_id,
              subject_id,

              change_type,

              old_offering_id,
              old_section_id,
              old_section_subject_id,

              new_offering_id,
              new_section_id,
              new_section_subject_id,

              reason,
              changed_by
          )

          VALUES (
              ?,
              ?,
              ?,

              'REMOVE',

              ?,
              ?,
              ?,

              NULL,
              NULL,
              NULL,

              ?,
              ?
          )
        `,
      [
        enrollmentId,
        enrollmentSubjectId,
        Number(oldSubject.subject_id),

        oldValues.offering_id,
        oldValues.section_id,
        oldValues.section_subject_id,

        replacementReason,
        Number(actor.user_id),
      ],
    );

    // =================================================
    // 29. NEW SUBJECT HISTORY -> ADD
    // =================================================

    await connection.execute(
      `
          INSERT INTO enrollment_subject_changes (
              enrollment_id,
              enrollment_subject_id,
              subject_id,

              change_type,

              old_offering_id,
              old_section_id,
              old_section_subject_id,

              new_offering_id,
              new_section_id,
              new_section_subject_id,

              reason,
              changed_by
          )

          VALUES (
              ?,
              ?,
              ?,

              'ADD',

              NULL,
              NULL,
              NULL,

              ?,
              ?,
              ?,

              ?,
              ?
          )
        `,
      [
        enrollmentId,
        newEnrollmentSubjectId,
        Number(newOffering.subject_id),

        Number(newOffering.offering_id),

        Number(newOffering.section_id),

        Number(newOffering.section_subject_id),

        replacementReason,
        Number(actor.user_id),
      ],
    );

    // =================================================
    // 30. AUDIT OLD SUBJECT
    // =================================================

    const oldSubjectNewValues = {
      ...oldValues,
      status: "Dropped",
    };

    await connection.execute(
      `
          INSERT INTO audit_trail (
              user_id,
              table_name,
              record_id,
              action,
              old_values,
              new_values
          )

          VALUES (
              ?,
              'enrollment_subjects',
              ?,
              'UPDATE',
              ?,
              ?
          )
        `,
      [
        Number(actor.user_id),

        enrollmentSubjectId,

        JSON.stringify(oldValues),

        JSON.stringify(oldSubjectNewValues),
      ],
    );

    // =================================================
    // 31. AUDIT NEW SUBJECT
    // =================================================
    const newValues = {
      enrollment_id: enrollmentId,

      enrollment_subject_id: newEnrollmentSubjectId,

      subject_id: replacementSubjectId,

      enrollment_type: resolvedEnrollmentType,

      offering_id: Number(newOffering.offering_id),

      section_id: Number(newOffering.section_id),

      section_subject_id: Number(newOffering.section_subject_id),

      status: "Enrolled",

      academic_eligibility: {
        eligible: true,

        eligibility_type: academicEligibility.eligibility_type,

        resolved_enrollment_type: resolvedEnrollmentType,

        reason: academicEligibility.reason,

        latest_approved_grade: academicEligibility.latest_approved_grade,

        prerequisites: academicEligibility.prerequisites,
      },
    };

    await connection.execute(
      `
          INSERT INTO audit_trail (
              user_id,
              table_name,
              record_id,
              action,
              old_values,
              new_values
          )

          VALUES (
              ?,
              'enrollment_subjects',
              ?,
              'INSERT',
              ?,
              ?
          )
        `,
      [
        Number(actor.user_id),

        newEnrollmentSubjectId,

        JSON.stringify(null),

        JSON.stringify(newValues),
      ],
    );

    // =================================================
    // 32. COMMIT
    // =================================================

    await connection.commit();

    transactionActive = false;

    // =================================================
    // 33. RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      message: "Enrollment subject replaced successfully.",

      enrollment: {
        enrollment_id: enrollmentId,

        enrollment_status: enrollment.enrollment_status,

        student_id: studentId,

        student_number: enrollment.student_number,

        student_name: [
          enrollment.first_name,
          enrollment.middle_name,
          enrollment.last_name,
        ]
          .filter(Boolean)
          .join(" "),

        course: {
          course_id: studentCourseId,

          course_code: enrollment.course_code,

          course_name: enrollment.course_name,
        },

        academic_period: {
          academic_year_id: academicYearId,

          academic_year: enrollment.academic_year,

          semester_id: semesterId,

          semester_name: enrollment.semester_name,
        },

        curriculum: {
          curriculum_id: curriculumId,

          curriculum_name: curriculum.curriculum_name,
        },
      },

      replaced_subject: {
        enrollment_subject_id: enrollmentSubjectId,

        subject_id: Number(oldSubject.subject_id),

        subject_code: oldSubject.subject_code,

        subject_name: oldSubject.subject_name,

        units: Number(oldSubject.units || 0),

        offering_id: oldValues.offering_id,

        section_id: oldValues.section_id,

        section_name: oldSubject.section_name || null,

        section_subject_id: oldValues.section_subject_id,

        previous_status: "Enrolled",

        status: "Dropped",
      },

      new_subject: {
        enrollment_subject_id: newEnrollmentSubjectId,

        subject_id: replacementSubjectId,

        subject_code: newOffering.subject_code,

        subject_name: newOffering.subject_name,

        units: Number(newOffering.units || 0),

        enrollment_type: resolvedEnrollmentType,

        is_irregular:
          resolvedEnrollmentType === "Retake" ||
          resolvedEnrollmentType === "Carry Over",

        academic_eligibility: academicEligibility,

        status: "Enrolled",

        offering: {
          offering_id: Number(newOffering.offering_id),

          status: newOffering.offering_status,

          schedule_days: newOffering.schedule_days || null,

          schedule_time: newOffering.schedule_time || null,

          faculty_id:
            newOffering.faculty_id !== null
              ? Number(newOffering.faculty_id)
              : null,
        },

        section: {
          section_id: Number(newOffering.section_id),

          section_name: newOffering.section_name,

          year_level:
            newOffering.year_level !== null &&
            newOffering.year_level !== undefined
              ? Number(newOffering.year_level)
              : null,
        },

        section_subject: {
          section_subject_id: Number(newOffering.section_subject_id),

          status: newOffering.section_subject_status,
        },

        room: {
          room_id:
            newOffering.room_id !== null ? Number(newOffering.room_id) : null,

          room_name: newOffering.room_name || null,
        },
      },

      capacity: {
        max_students: maxStudents,

        enrolled_count_after_replace: enrolledCount + 1,

        available_slots_after_replace: Math.max(
          maxStudents - (enrolledCount + 1),
          0,
        ),
      },

      history: {
        operations: [
          {
            change_type: "REMOVE",

            enrollment_subject_id: enrollmentSubjectId,

            subject_id: Number(oldSubject.subject_id),
          },

          {
            change_type: "ADD",

            enrollment_subject_id: newEnrollmentSubjectId,

            subject_id: Number(newOffering.subject_id),
          },
        ],

        reason: replacementReason,

        changed_by: Number(actor.user_id),
      },

      actor: {
        user_id: Number(actor.user_id),

        username: actor.username,
      },
    });
  } catch (error) {
    if (connection && transactionActive) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("REPLACE SUBJECT ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("REPLACE SUBJECT ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to replace enrollment subject.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// EXPORT
// =====================================================

export default router;
