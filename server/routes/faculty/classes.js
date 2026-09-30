// routes/faculty/classes.js
//
// =====================================================
// FACULTY CLASS MANAGEMENT
// =====================================================
//
// Responsibility:
//
// Authenticated Faculty
//        ↓
// Resolve faculty profile
//        ↓
// subject_offerings.faculty_id
//        ↓
// Assigned Classes
//
// IMPORTANT:
//
// - Faculty identity comes ONLY from req.user.
// - Never accept faculty_id from query/body/frontend.
// - subject_offerings is the authoritative teaching
//   assignment created by Registrar.
// - Closed offerings may still appear because Closed
//   means enrollment is no longer accepting placement.
// - Cancelled offerings are excluded from the normal
//   active class list.
// - Official student count includes APPROVED
//   enrollments only.
// =====================================================
import {
  calculateGrade,
  gradePolicyFields,
} from "../../services/gradingPolicy.service.js";

import express from "express";
import db from "../../db.js";

const router = express.Router();

// =====================================================
// HELPERS
// =====================================================

function toPositiveInt(value) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0 ? number : null;
}
// =====================================================
// CLASS SCHEDULE HELPERS
// =====================================================

const SCHEDULE_DAY_ORDER = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const SCHEDULE_DAY_ALIASES = new Map([
  ["monday", "Monday"],
  ["mon", "Monday"],

  ["tuesday", "Tuesday"],
  ["tue", "Tuesday"],
  ["tues", "Tuesday"],

  ["wednesday", "Wednesday"],
  ["wed", "Wednesday"],

  ["thursday", "Thursday"],
  ["thu", "Thursday"],
  ["thur", "Thursday"],
  ["thurs", "Thursday"],

  ["friday", "Friday"],
  ["fri", "Friday"],

  ["saturday", "Saturday"],
  ["sat", "Saturday"],

  ["sunday", "Sunday"],
  ["sun", "Sunday"],
]);

// =====================================================
// NORMALIZE SCHEDULE DAYS
//
// Accepts:
// "Monday"
// "Monday, Wednesday"
// ["Monday", "Wednesday"]
// =====================================================

function normalizeScheduleDays(value) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,/&]+/)
      : [];

  const normalized = [];

  for (const rawValue of rawValues) {
    const key = String(rawValue || "")
      .trim()
      .toLowerCase();

    if (!key) {
      continue;
    }

    const day = SCHEDULE_DAY_ALIASES.get(key);

    if (!day) {
      return {
        valid: false,
        days: [],
        invalid_value: String(rawValue),
      };
    }

    if (!normalized.includes(day)) {
      normalized.push(day);
    }
  }

  normalized.sort(
    (a, b) => SCHEDULE_DAY_ORDER.indexOf(a) - SCHEDULE_DAY_ORDER.indexOf(b),
  );

  return {
    valid: normalized.length > 0,
    days: normalized,
    invalid_value: null,
  };
}

// =====================================================
// PARSE TIME TO SECONDS
//
// Accepts:
// 08:00
// 08:00:00
// 8am
// 8:00 AM
// 5pm
// =====================================================

function parseTimeToSeconds(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();

  if (!text) {
    return null;
  }

  // -------------------------------------------------
  // 24-HOUR FORMAT
  // -------------------------------------------------

  let match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = Number(match[3] || 0);

    if (
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59 ||
      second < 0 ||
      second > 59
    ) {
      return null;
    }

    return hour * 3600 + minute * 60 + second;
  }

  // -------------------------------------------------
  // 12-HOUR FORMAT
  // -------------------------------------------------

  match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);

  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3].toLowerCase();

  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return null;
  }

  if (hour === 12) {
    hour = 0;
  }

  if (meridiem === "pm") {
    hour += 12;
  }

  return hour * 3600 + minute * 60;
}

// =====================================================
// CONVERT SECONDS TO MYSQL TIME
//
// Example:
// 28800 -> 08:00:00
// =====================================================

function secondsToSqlTime(seconds) {
  const hour = Math.floor(seconds / 3600);

  const minute = Math.floor((seconds % 3600) / 60);

  const second = seconds % 60;

  return [hour, minute, second]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

// =====================================================
// DISPLAY TIME
//
// Example:
// 08:00:00 -> 8:00 AM
// =====================================================

function secondsToDisplayTime(seconds) {
  const totalMinutes = Math.floor(seconds / 60);

  const hour24 = Math.floor(totalMinutes / 60);

  const minute = totalMinutes % 60;

  const meridiem = hour24 >= 12 ? "PM" : "AM";

  const hour12 = hour24 % 12 || 12;

  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

// =====================================================
// READ EXISTING SCHEDULE RANGE
//
// Supports new structured fields:
//
// schedule_start_time
// schedule_end_time
//
// Also supports old schedule_time values:
//
// 8am-10am
// 8:00 AM - 10:00 AM
// =====================================================

function parseStoredTimeRange(row) {
  const structuredStart = parseTimeToSeconds(row.schedule_start_time);

  const structuredEnd = parseTimeToSeconds(row.schedule_end_time);

  if (
    structuredStart !== null &&
    structuredEnd !== null &&
    structuredStart < structuredEnd
  ) {
    return {
      start: structuredStart,
      end: structuredEnd,
    };
  }

  const legacy = String(row.schedule_time || "").trim();

  if (!legacy) {
    return null;
  }

  const parts = legacy.split(/\s*-\s*/);

  if (parts.length !== 2) {
    return null;
  }

  const start = parseTimeToSeconds(parts[0]);

  const end = parseTimeToSeconds(parts[1]);

  if (start === null || end === null || start >= end) {
    return null;
  }

  return {
    start,
    end,
  };
}

// =====================================================
// TIME OVERLAP CHECK
//
// Existing:
// 08:00 - 10:00
//
// New:
// 09:00 - 11:00
//
// => conflict
//
// Existing:
// 08:00 - 10:00
//
// New:
// 10:00 - 12:00
//
// => allowed
// =====================================================

function schedulesOverlap(firstStart, firstEnd, secondStart, secondEnd) {
  return firstStart < secondEnd && firstEnd > secondStart;
}
// =====================================================
// GET AUTHENTICATED FACULTY
// =====================================================

async function getAuthenticatedFaculty(req, res) {
  // -------------------------------------------------
  // AUTHENTICATION
  // -------------------------------------------------

  if (!req.user) {
    res.status(401).json({
      success: false,
      message: "Authentication is required.",
    });

    return null;
  }

  // -------------------------------------------------
  // ROLE
  // -------------------------------------------------

  if (req.user.role_name !== "Faculty") {
    res.status(403).json({
      success: false,
      message: "Faculty access is required.",
    });

    return null;
  }

  // -------------------------------------------------
  // AUTHENTICATED USER ID
  // -------------------------------------------------

  const userId = toPositiveInt(req.user.user_id);

  if (!userId) {
    res.status(401).json({
      success: false,
      message: "Authenticated Faculty user ID is invalid.",
    });

    return null;
  }

  // -------------------------------------------------
  // FACULTY PROFILE
  //
  // IMPORTANT:
  // faculty_id is resolved from the authenticated
  // user account.
  //
  // We never trust a faculty_id sent by the client.
  // -------------------------------------------------

  const [facultyRows] = await db.execute(
    `
    SELECT
        f.faculty_id,
        f.user_id,
        f.employee_number,

        f.first_name,
        f.middle_name,
        f.last_name,

        f.email,
        f.contact_number,

        f.department_id,
        f.employment_status,
        f.hire_date,

        u.username

    FROM faculty f

    INNER JOIN users u
        ON u.user_id = f.user_id

    WHERE f.user_id = ?

    LIMIT 1
    `,
    [userId],
  );

  if (facultyRows.length === 0) {
    res.status(404).json({
      success: false,
      message: "No Faculty profile is connected to this account.",
    });

    return null;
  }

  const row = facultyRows[0];

  return {
    faculty_id: Number(row.faculty_id),
    user_id: Number(row.user_id),

    employee_number: row.employee_number,

    username: row.username,

    first_name: row.first_name,
    middle_name: row.middle_name,
    last_name: row.last_name,

    faculty_name: [row.first_name, row.middle_name, row.last_name]
      .filter(Boolean)
      .join(" "),

    email: row.email || null,
    contact_number: row.contact_number || null,

    department_id:
      row.department_id !== null && row.department_id !== undefined
        ? Number(row.department_id)
        : null,

    employment_status: row.employment_status || null,

    hire_date: row.hire_date || null,
  };
}

// =====================================================
// UPDATE MY CLASS SCHEDULE
//
// PUT /api/faculty/classes/:offeringId/schedule
//
// Faculty can only schedule classes assigned to them.
//
// Request body:
// {
//   "schedule_days": "Monday",
//   "schedule_start_time": "08:00:00",
//   "schedule_end_time": "10:00:00"
// }
//
// IMPORTANT:
// faculty_id is NEVER accepted from the frontend.
// It is resolved from the authenticated user.
// =====================================================

router.put("/:offeringId/schedule", async (req, res) => {
  let connection;

  try {
    // =================================================
    // AUTHENTICATED FACULTY
    // =================================================

    const faculty = await getAuthenticatedFaculty(req, res);

    if (!faculty) {
      return;
    }

    // =================================================
    // OFFERING ID
    // =================================================

    const offeringId = toPositiveInt(req.params.offeringId);

    if (!offeringId) {
      return res.status(400).json({
        success: false,
        message: "Invalid offering ID.",
      });
    }

    // =================================================
    // VALIDATE SCHEDULE DAYS
    // =================================================

    const dayResult = normalizeScheduleDays(req.body?.schedule_days);

    if (!dayResult.valid) {
      return res.status(400).json({
        success: false,

        message: dayResult.invalid_value
          ? `Invalid schedule day: ${dayResult.invalid_value}.`
          : "At least one valid schedule day is required.",
      });
    }

    // =================================================
    // VALIDATE START TIME
    // =================================================

    const startSeconds = parseTimeToSeconds(req.body?.schedule_start_time);

    if (startSeconds === null) {
      return res.status(400).json({
        success: false,
        message: "A valid schedule_start_time is required.",
      });
    }

    // =================================================
    // VALIDATE END TIME
    // =================================================

    const endSeconds = parseTimeToSeconds(req.body?.schedule_end_time);

    if (endSeconds === null) {
      return res.status(400).json({
        success: false,
        message: "A valid schedule_end_time is required.",
      });
    }

    if (startSeconds >= endSeconds) {
      return res.status(400).json({
        success: false,
        message: "Schedule end time must be later than the start time.",
      });
    }

    // =================================================
    // NORMALIZE SCHEDULE
    // =================================================

    const scheduleDays = dayResult.days.join(", ");

    const scheduleStartTime = secondsToSqlTime(startSeconds);

    const scheduleEndTime = secondsToSqlTime(endSeconds);

    const scheduleTime = `${secondsToDisplayTime(
      startSeconds,
    )} - ${secondsToDisplayTime(endSeconds)}`;

    // =================================================
    // START TRANSACTION
    // =================================================

    connection = await db.getConnection();

    await connection.beginTransaction();

    // =================================================
    // LOAD OFFERING
    //
    // Lock the offering while schedule is being updated.
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
            so.schedule_start_time,
            so.schedule_end_time,

            so.max_students,
            so.status,

            ss.status
                AS section_subject_status,

            sub.subject_code,
            sub.subject_name,
            sub.units,

            sec.section_name,
            sec.year_level,
            sec.course_id,

            c.course_code,
            c.course_name,

            ay.academic_year,

            sem.semester_name

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

        INNER JOIN courses c
            ON c.course_id =
               sec.course_id

        INNER JOIN academic_years ay
            ON ay.academic_year_id =
               so.academic_year_id

        INNER JOIN semesters sem
            ON sem.semester_id =
               so.semester_id

        WHERE so.offering_id = ?

        LIMIT 1

        FOR UPDATE
        `,
      [offeringId],
    );

    if (offeringRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Subject offering not found.",
      });
    }

    const offering = offeringRows[0];

    // =================================================
    // OWNERSHIP CHECK
    //
    // Authenticated Faculty must be the instructor
    // assigned in subject_offerings.faculty_id.
    // =================================================

    if (Number(offering.faculty_id) !== faculty.faculty_id) {
      await connection.rollback();

      return res.status(403).json({
        success: false,

        message: "You are not assigned to teach this subject offering.",
      });
    }

    // =================================================
    // OFFERING STATUS VALIDATION
    // =================================================

    if (offering.status === "Cancelled") {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message: "A cancelled subject offering cannot be scheduled.",
      });
    }

    // =================================================
    // SECTION SUBJECT VALIDATION
    // =================================================

    if (offering.section_subject_status === "Cancelled") {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message: "This section subject is cancelled and cannot be scheduled.",
      });
    }

    if (offering.section_subject_status !== "Open") {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message:
          "The section subject must be Open before its class schedule can be activated.",
      });
    }

    // =================================================
    // FIND POSSIBLE CONFLICTS
    //
    // Check:
    //
    // 1. Same Faculty
    // 2. Same Section
    //
    // Within the same:
    //
    // - Academic Year
    // - Semester
    // =================================================

    const [possibleConflicts] = await connection.execute(
      `
        SELECT
            so.offering_id,
            so.subject_id,
            so.section_id,
            so.faculty_id,

            so.schedule_days,
            so.schedule_time,
            so.schedule_start_time,
            so.schedule_end_time,

            so.status,

            sub.subject_code,
            sub.subject_name,

            sec.section_name

        FROM subject_offerings so

        INNER JOIN subjects sub
            ON sub.subject_id =
               so.subject_id

        INNER JOIN sections sec
            ON sec.section_id =
               so.section_id

        WHERE so.offering_id <> ?

          AND so.academic_year_id = ?

          AND so.semester_id = ?

          AND so.status <> 'Cancelled'

          AND (
                so.faculty_id = ?

                OR

                so.section_id = ?
              )

          AND so.schedule_days
              IS NOT NULL

          AND TRIM(
                so.schedule_days
              ) <> ''
        `,
      [
        offeringId,

        Number(offering.academic_year_id),

        Number(offering.semester_id),

        faculty.faculty_id,

        Number(offering.section_id),
      ],
    );

    // =================================================
    // CHECK ACTUAL DAY + TIME OVERLAPS
    // =================================================

    const conflicts = [];

    const requestedDays = new Set(dayResult.days);

    for (const row of possibleConflicts) {
      const existingDayResult = normalizeScheduleDays(row.schedule_days);

      if (!existingDayResult.valid) {
        continue;
      }

      // ---------------------------------------------
      // SAME DAY?
      // ---------------------------------------------

      const overlappingDays = existingDayResult.days.filter((day) =>
        requestedDays.has(day),
      );

      if (overlappingDays.length === 0) {
        continue;
      }

      // ---------------------------------------------
      // GET EXISTING TIME RANGE
      //
      // Supports:
      //
      // structured TIME fields
      //
      // and old values like:
      //
      // 8am-10am
      // 8:00 AM - 10:00 AM
      // ---------------------------------------------

      const existingRange = parseStoredTimeRange(row);

      if (!existingRange) {
        continue;
      }

      // ---------------------------------------------
      // TIME OVERLAP?
      // ---------------------------------------------

      if (
        !schedulesOverlap(
          startSeconds,
          endSeconds,
          existingRange.start,
          existingRange.end,
        )
      ) {
        continue;
      }

      // ---------------------------------------------
      // TYPE OF CONFLICT
      // ---------------------------------------------

      const sameInstructor = Number(row.faculty_id) === faculty.faculty_id;

      const sameSection =
        Number(row.section_id) === Number(offering.section_id);

      conflicts.push({
        offering_id: Number(row.offering_id),

        subject_id: Number(row.subject_id),

        subject_code: row.subject_code,

        subject_name: row.subject_name,

        section_id: Number(row.section_id),

        section_name: row.section_name,

        overlapping_days: overlappingDays,

        schedule_days: row.schedule_days,

        schedule_time: row.schedule_time,

        schedule_start_time: row.schedule_start_time,

        schedule_end_time: row.schedule_end_time,

        conflict_types: [
          ...(sameInstructor ? ["Instructor"] : []),

          ...(sameSection ? ["Section"] : []),
        ],
      });
    }

    // =================================================
    // REJECT CONFLICT
    // =================================================

    if (conflicts.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message:
          "The requested class schedule conflicts with an existing class.",

        conflicts,
      });
    }

    // =================================================
    // OLD VALUES FOR AUDIT
    // =================================================

    const oldValues = {
      offering_id: offeringId,

      faculty_id: faculty.faculty_id,

      schedule_days: offering.schedule_days,

      schedule_time: offering.schedule_time,

      schedule_start_time: offering.schedule_start_time,

      schedule_end_time: offering.schedule_end_time,

      status: offering.status,
    };

    // =================================================
    // SAVE SCHEDULE
    //
    // A successfully scheduled offering becomes Open.
    // =================================================

    const [updateResult] = await connection.execute(
      `
        UPDATE subject_offerings

        SET
            schedule_days = ?,

            schedule_time = ?,

            schedule_start_time = ?,

            schedule_end_time = ?,

            status = 'Open'

        WHERE offering_id = ?

          AND faculty_id = ?
        `,
      [
        scheduleDays,

        scheduleTime,

        scheduleStartTime,

        scheduleEndTime,

        offeringId,

        faculty.faculty_id,
      ],
    );

    // =================================================
    // EXTRA OWNERSHIP SAFETY
    // =================================================

    if (updateResult.affectedRows === 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message:
          "The schedule could not be updated because the instructor assignment changed.",
      });
    }

    // =================================================
    // NEW VALUES FOR AUDIT
    // =================================================

    const newValues = {
      offering_id: offeringId,

      faculty_id: faculty.faculty_id,

      schedule_days: scheduleDays,

      schedule_time: scheduleTime,

      schedule_start_time: scheduleStartTime,

      schedule_end_time: scheduleEndTime,

      status: "Open",

      configuration_complete: true,

      ready_for_enrollment: true,
    };

    // =================================================
    // AUDIT TRAIL
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
            'subject_offerings',
            ?,
            'UPDATE',
            ?,
            ?
        )
      `,
      [
        faculty.user_id,

        offeringId,

        JSON.stringify(oldValues),

        JSON.stringify(newValues),
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

      message: "Class schedule saved successfully.",

      offering: {
        offering_id: offeringId,

        section_subject_id: Number(offering.section_subject_id),

        // =============================================
        // SUBJECT
        // =============================================

        subject: {
          subject_id: Number(offering.subject_id),

          subject_code: offering.subject_code,

          subject_name: offering.subject_name,

          units: Number(offering.units || 0),
        },

        // =============================================
        // SECTION
        // =============================================

        section: {
          section_id: Number(offering.section_id),

          section_name: offering.section_name,

          course_id: Number(offering.course_id),

          course_code: offering.course_code,

          course_name: offering.course_name,

          year_level: Number(offering.year_level),
        },

        // =============================================
        // ACADEMIC PERIOD
        // =============================================

        academic_period: {
          academic_year_id: Number(offering.academic_year_id),

          academic_year: offering.academic_year,

          semester_id: Number(offering.semester_id),

          semester_name: offering.semester_name,
        },

        // =============================================
        // AUTHENTICATED INSTRUCTOR
        // =============================================

        faculty: {
          faculty_id: faculty.faculty_id,

          user_id: faculty.user_id,

          employee_number: faculty.employee_number,

          faculty_name: faculty.faculty_name,

          username: faculty.username,
        },

        // =============================================
        // ROOM
        //
        // Registrar is no longer assigning a room
        // during offering creation.
        // =============================================

        room_id:
          offering.room_id !== null && offering.room_id !== undefined
            ? Number(offering.room_id)
            : null,

        // =============================================
        // NEW SCHEDULE
        // =============================================

        schedule_days: scheduleDays,

        schedule_time: scheduleTime,

        schedule_start_time: scheduleStartTime,

        schedule_end_time: scheduleEndTime,

        // =============================================
        // CAPACITY
        // =============================================

        max_students: Number(offering.max_students || 0),

        // =============================================
        // STATUS
        // =============================================

        status: "Open",

        configuration_complete: true,

        ready_for_enrollment: true,

        schedule_status: "Scheduled",
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
        console.error(
          "UPDATE FACULTY CLASS SCHEDULE ROLLBACK ERROR:",
          rollbackError,
        );
      }
    }

    console.error("UPDATE FACULTY CLASS SCHEDULE ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to update class schedule.",

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
// GET MY CLASSES
//
// GET /api/faculty/classes
//
// Optional query:
//
// ?academic_year_id=2
// ?semester_id=2
//
// or:
//
// ?academic_year_id=2&semester_id=2
//
// RULES:
//
// 1. Faculty comes from JWT.
// 2. Only subject_offerings assigned to that Faculty.
// 3. Cancelled offerings are excluded.
// 4. Open AND Closed offerings may appear.
// 5. Student count is based ONLY on:
//
//      enrollment_status = Approved
//      enrollment_subject status = Enrolled
//
// Pending students must NOT appear in Faculty counts.
// =====================================================

router.get("/", async (req, res) => {
  try {
    // =================================================
    // 1. AUTHENTICATED FACULTY
    // =================================================

    const faculty = await getAuthenticatedFaculty(req, res);

    if (!faculty) {
      return;
    }

    const facultyId = faculty.faculty_id;

    // =================================================
    // 2. OPTIONAL FILTERS
    // =================================================

    const rawAcademicYearId = req.query.academic_year_id;

    const rawSemesterId = req.query.semester_id;

    let academicYearId = null;
    let semesterId = null;

    // -------------------------------------------------
    // ACADEMIC YEAR
    // -------------------------------------------------

    if (
      rawAcademicYearId !== undefined &&
      rawAcademicYearId !== null &&
      String(rawAcademicYearId).trim() !== ""
    ) {
      academicYearId = toPositiveInt(rawAcademicYearId);

      if (!academicYearId) {
        return res.status(400).json({
          success: false,
          message: "Invalid academic year ID.",
        });
      }
    }

    // -------------------------------------------------
    // SEMESTER
    // -------------------------------------------------

    if (
      rawSemesterId !== undefined &&
      rawSemesterId !== null &&
      String(rawSemesterId).trim() !== ""
    ) {
      semesterId = toPositiveInt(rawSemesterId);

      if (!semesterId) {
        return res.status(400).json({
          success: false,
          message: "Invalid semester ID.",
        });
      }
    }

    // =================================================
    // 3. BUILD FILTER
    // =================================================

    const conditions = ["so.faculty_id = ?", "so.status <> 'Cancelled'"];

    const params = [facultyId];

    if (academicYearId) {
      conditions.push("so.academic_year_id = ?");

      params.push(academicYearId);
    }

    if (semesterId) {
      conditions.push("so.semester_id = ?");

      params.push(semesterId);
    }

    // =================================================
    // 4. GET ASSIGNED CLASSES
    //
    // IMPORTANT:
    //
    // This query intentionally does NOT require:
    //
    //     so.status = 'Open'
    //
    // because a Closed offering may still be an actual
    // class that Faculty needs for roster/grade work.
    //
    // Only Cancelled offerings are excluded from this
    // normal active list.
    // =================================================

    const [classRows] = await db.execute(
      `
  SELECT
      so.offering_id,
      so.section_subject_id,

      so.status AS offering_status,

      so.schedule_days,
      so.schedule_time,
      so.max_students,
      so.created_at,

      sub.subject_id,
      sub.subject_code,
      sub.subject_name,
      sub.units,
      sub.lecture_hours,
      sub.laboratory_hours,

      ss.status AS section_subject_status,

      sec.section_id,
      sec.section_name,
      sec.year_level,

      c.course_id,
      c.course_code,
      c.course_name,

      ay.academic_year_id,
      ay.academic_year,
      ay.is_current AS academic_year_is_current,

      sem.semester_id,
      sem.semester_name,

      r.room_id,
      r.room_code,
      r.room_name,

      (
          SELECT COUNT(*)

          FROM enrollment_subjects es_count

          INNER JOIN enrollments e_count
              ON e_count.enrollment_id = es_count.enrollment_id

          WHERE es_count.offering_id = so.offering_id

            AND es_count.status = 'Enrolled'

            AND e_count.enrollment_status = 'Approved'
      ) AS official_student_count

  FROM subject_offerings so

  INNER JOIN section_subjects ss
      ON ss.section_subject_id = so.section_subject_id

  INNER JOIN subjects sub
      ON sub.subject_id = so.subject_id

  INNER JOIN sections sec
      ON sec.section_id = so.section_id

  INNER JOIN courses c
      ON c.course_id = sec.course_id

  INNER JOIN academic_years ay
      ON ay.academic_year_id = so.academic_year_id

  INNER JOIN semesters sem
      ON sem.semester_id = so.semester_id

  LEFT JOIN rooms r
      ON r.room_id = so.room_id

  WHERE
      ${conditions.join("\n      AND ")}

  ORDER BY
      ay.is_current DESC,
      so.academic_year_id DESC,
      so.semester_id DESC,
      c.course_code ASC,
      sec.year_level ASC,
      sec.section_name ASC,
      sub.subject_code ASC,
      so.offering_id ASC
  `,
      params,
    );

    // =================================================
    // 5. FORMAT CLASSES
    // =================================================

    const classes = classRows.map((row) => {
      const officialStudentCount = Number(row.official_student_count || 0);

      const maxStudents = Number(row.max_students || 0);

      return {
        offering_id: Number(row.offering_id),

        section_subject_id: Number(row.section_subject_id),

        offering_status: row.offering_status,

        section_subject_status: row.section_subject_status,

        subject: {
          subject_id: Number(row.subject_id),

          subject_code: row.subject_code,

          subject_name: row.subject_name,

          units: Number(row.units || 0),

          lecture_hours: Number(row.lecture_hours || 0),

          laboratory_hours: Number(row.laboratory_hours || 0),
        },

        section: {
          section_id: Number(row.section_id),

          section_name: row.section_name,

          year_level: Number(row.year_level || 0),

          course: {
            course_id: Number(row.course_id),

            course_code: row.course_code,

            course_name: row.course_name,
          },
        },

        academic_period: {
          academic_year_id: Number(row.academic_year_id),

          academic_year: row.academic_year,

          is_current_academic_year: Boolean(
            Number(row.academic_year_is_current),
          ),

          semester_id: Number(row.semester_id),

          semester_name: row.semester_name,
        },

        schedule: {
          days: row.schedule_days || null,

          time: row.schedule_time || null,
        },

        room: row.room_id
          ? {
              room_id: Number(row.room_id),

              room_code: row.room_code || null,

              room_name: row.room_name || null,
            }
          : null,

        capacity: {
          max_students: maxStudents,

          official_students: officialStudentCount,
        },

        created_at: row.created_at,
      };
    });

    // =================================================
    // 6. SUMMARY
    // =================================================

    const totalOfficialStudents = classes.reduce(
      (total, item) => total + item.capacity.official_students,
      0,
    );

    const openClasses = classes.filter(
      (item) => item.offering_status === "Open",
    ).length;

    const closedClasses = classes.filter(
      (item) => item.offering_status === "Closed",
    ).length;

    // =================================================
    // 7. SUCCESS
    // =================================================

    return res.status(200).json({
      success: true,

      faculty,

      filters: {
        academic_year_id: academicYearId,

        semester_id: semesterId,
      },

      summary: {
        total_classes: classes.length,

        open_classes: openClasses,

        closed_classes: closedClasses,

        total_official_students: totalOfficialStudents,
      },

      classes,
    });
  } catch (error) {
    console.error("GET FACULTY CLASSES ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to load Faculty classes.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// =====================================================
// GET FACULTY CLASS STUDENTS
// =====================================================
//
// GET /api/faculty/classes/:offeringId/students
//
// Purpose:
// Returns the official student roster for one class
// assigned to the authenticated Faculty.
//
// IMPORTANT RULES:
//
// 1. Faculty identity comes from JWT.
// 2. Faculty cannot provide faculty_id manually.
// 3. Faculty can only access their own offering.
// 4. Open and Closed offerings are accessible.
// 5. Cancelled offerings are not part of the active
//    Faculty teaching workflow.
// 6. Only APPROVED enrollments appear.
// 7. Only enrollment_subjects with status Enrolled appear.
// 8. Pending students MUST NOT appear.
//
// =====================================================

router.get("/:offeringId/students", async (req, res) => {
  try {
    // =================================================
    // AUTHENTICATED FACULTY
    // =================================================

    const faculty = await getAuthenticatedFaculty(req, res);

    if (!faculty) {
      return;
    }

    // =================================================
    // VALIDATE OFFERING ID
    // =================================================

    const offeringId = Number(req.params.offeringId);

    if (!Number.isInteger(offeringId) || offeringId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid offering ID.",
      });
    }

    // =================================================
    // FIND CLASS + VERIFY OWNERSHIP
    // =================================================
    //
    // We deliberately do NOT filter only status = Open.
    //
    // A Closed offering may still be an active Faculty
    // class. Closed only means Registrar enrollment
    // placement is closed.
    //
    // =================================================

    const [offeringRows] = await db.execute(
      `
      SELECT
          so.offering_id,
          so.section_subject_id,
          so.subject_id,
          so.section_id,
          so.faculty_id,
          so.academic_year_id,
          so.semester_id,

          so.schedule_days,
          so.schedule_time,
          so.max_students,

          so.status AS offering_status,
          so.created_at,

          ss.status AS section_subject_status,

          sub.subject_code,
          sub.subject_name,
          sub.units,
          sub.lecture_hours,
          sub.laboratory_hours,

          sec.section_name,
          sec.year_level,

          c.course_id,
          c.course_code,
          c.course_name,

          ay.academic_year,
          ay.is_current AS academic_year_is_current,

          sem.semester_name,

          r.room_id,
          r.room_code,
          r.room_name

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

      INNER JOIN courses c
          ON c.course_id =
             sec.course_id

      INNER JOIN academic_years ay
          ON ay.academic_year_id =
             so.academic_year_id

      INNER JOIN semesters sem
          ON sem.semester_id =
             so.semester_id

      LEFT JOIN rooms r
          ON r.room_id =
             so.room_id

      WHERE
          so.offering_id = ?
          AND so.faculty_id = ?

      LIMIT 1
      `,
      [offeringId, faculty.faculty_id],
    );

    // =================================================
    // OFFERING NOT FOUND / NOT OWNED
    // =================================================
    //
    // We intentionally use the same response when the
    // offering does not exist OR belongs to another
    // Faculty.
    //
    // This prevents Faculty users from discovering
    // another Faculty's class information.
    //
    // =================================================

    if (offeringRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Class not found or is not assigned to you.",
      });
    }

    const offering = offeringRows[0];

    // =================================================
    // CANCELLED OFFERING
    // =================================================

    if (offering.offering_status === "Cancelled") {
      return res.status(409).json({
        success: false,
        message: "This class offering has been cancelled.",
      });
    }

    // =================================================
    // GET OFFICIAL STUDENT ROSTER
    // =================================================
    //
    // enrollment_subjects = exact class placement
    //
    // enrollments = official enrollment approval
    //
    // We DO NOT use students.section_id to determine
    // membership in this class.
    //
    // =================================================

    const [studentRows] = await db.execute(
      `
      SELECT
          es.enrollment_subject_id,
          es.enrollment_id,

          es.status
              AS enrollment_subject_status,

          e.student_id,
          e.enrollment_status,

          s.student_number,
          s.first_name,
          s.middle_name,
          s.last_name,

          u.email

      FROM enrollment_subjects es

      INNER JOIN enrollments e
          ON e.enrollment_id =
             es.enrollment_id

      INNER JOIN students s
          ON s.student_id =
             e.student_id

      LEFT JOIN users u
          ON u.user_id =
             s.user_id

      WHERE
          es.offering_id = ?

          AND es.subject_id = ?

          AND es.section_id = ?

          AND es.status = 'Enrolled'

          AND e.enrollment_status = 'Approved'

          AND e.academic_year_id = ?

          AND e.semester_id = ?

      ORDER BY
          s.last_name ASC,
          s.first_name ASC,
          s.middle_name ASC,
          s.student_number ASC
      `,
      [
        offering.offering_id,
        offering.subject_id,
        offering.section_id,
        offering.academic_year_id,
        offering.semester_id,
      ],
    );

    // =================================================
    // FORMAT STUDENTS
    // =================================================

    const students = studentRows.map((student) => ({
      enrollment_subject_id: student.enrollment_subject_id,

      enrollment_id: student.enrollment_id,

      student_id: student.student_id,

      student_number: student.student_number,

      first_name: student.first_name,

      middle_name: student.middle_name,

      last_name: student.last_name,

      full_name: [student.first_name, student.middle_name, student.last_name]
        .filter(Boolean)
        .join(" "),

      email: student.email,

      enrollment_status: student.enrollment_status,

      subject_status: student.enrollment_subject_status,
    }));

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      faculty: {
        faculty_id: faculty.faculty_id,

        employee_number: faculty.employee_number,

        faculty_name: faculty.faculty_name,
      },

      class: {
        offering_id: offering.offering_id,

        section_subject_id: offering.section_subject_id,

        offering_status: offering.offering_status,

        section_subject_status: offering.section_subject_status,

        subject: {
          subject_id: offering.subject_id,

          subject_code: offering.subject_code,

          subject_name: offering.subject_name,

          units: Number(offering.units),

          lecture_hours: Number(offering.lecture_hours),

          laboratory_hours: Number(offering.laboratory_hours),
        },

        section: {
          section_id: offering.section_id,

          section_name: offering.section_name,

          year_level: offering.year_level,

          course: {
            course_id: offering.course_id,

            course_code: offering.course_code,

            course_name: offering.course_name,
          },
        },

        academic_period: {
          academic_year_id: offering.academic_year_id,

          academic_year: offering.academic_year,

          is_current_academic_year: Boolean(offering.academic_year_is_current),

          semester_id: offering.semester_id,

          semester_name: offering.semester_name,
        },

        schedule: {
          days: offering.schedule_days,

          time: offering.schedule_time,
        },

        room: offering.room_id
          ? {
              room_id: offering.room_id,

              room_code: offering.room_code,

              room_name: offering.room_name,
            }
          : null,

        capacity: {
          max_students: Number(offering.max_students),

          official_students: students.length,
        },
      },

      summary: {
        official_students: students.length,
      },

      students,
    });
  } catch (error) {
    console.error(
      "GET /api/faculty/classes/:offeringId/students error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve class students.",
    });
  }
});
// =====================================================
// GET FACULTY CLASS GRADEBOOK
// =====================================================
//
// GET /api/faculty/classes/:offeringId/gradebook
//
// Purpose:
// Returns the official students of one Faculty class
// together with their current grade record.
//
// IMPORTANT:
//
// - Faculty identity comes from JWT.
// - Faculty can only access their own offering.
// - Open and Closed offerings are accessible.
// - Cancelled offerings are rejected.
// - Enrollment must be Approved.
// - Grade is linked through enrollment_subject_id.
// - A missing grade row is returned as grade: null.
// - We do NOT create grade rows during GET.
//
// INC COMPLETION:
//
// - If an Approved INC already has an active
//   grade-change request, return that request status.
// - Active statuses:
//     Pending Program Head
//     For Registrar Processing
//
// - Returned, Rejected, and Completed requests are
//   NOT treated as active here.
//
// =====================================================
router.get("/:offeringId/gradebook", async (req, res) => {
  try {
    // =================================================
    // AUTHENTICATED FACULTY
    // =================================================

    const faculty = await getAuthenticatedFaculty(req, res);

    if (!faculty) {
      return;
    }

    // =================================================
    // VALIDATE OFFERING ID
    // =================================================

    const offeringId = Number(req.params.offeringId);

    if (!Number.isInteger(offeringId) || offeringId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid offering ID.",
      });
    }

    // =================================================
    // GET CLASS + VERIFY FACULTY OWNERSHIP
    // =================================================

    const [offeringRows] = await db.execute(
      `
      SELECT
          so.offering_id,
          so.section_subject_id,
          so.subject_id,
          so.section_id,
          so.faculty_id,
          so.academic_year_id,
          so.semester_id,

          so.schedule_days,
          so.schedule_time,
          so.max_students,

          so.status AS offering_status,
          so.created_at,

          ss.status AS section_subject_status,

          sub.subject_code,
          sub.subject_name,
          sub.units,
          sub.lecture_hours,
          sub.laboratory_hours,

          sec.section_name,
          sec.year_level,

          c.course_id,
          c.course_code,
          c.course_name,

          ay.academic_year,
          ay.is_current AS academic_year_is_current,

          sem.semester_name,

          r.room_id,
          r.room_code,
          r.room_name

      FROM subject_offerings so

      INNER JOIN section_subjects ss
          ON ss.section_subject_id = so.section_subject_id

      INNER JOIN subjects sub
          ON sub.subject_id = so.subject_id

      INNER JOIN sections sec
          ON sec.section_id = so.section_id

      INNER JOIN courses c
          ON c.course_id = sec.course_id

      INNER JOIN academic_years ay
          ON ay.academic_year_id = so.academic_year_id

      INNER JOIN semesters sem
          ON sem.semester_id = so.semester_id

      LEFT JOIN rooms r
          ON r.room_id = so.room_id

      WHERE
          so.offering_id = ?
          AND so.faculty_id = ?

      LIMIT 1
      `,
      [offeringId, faculty.faculty_id],
    );

    // =================================================
    // CLASS NOT FOUND / NOT OWNED
    // =================================================

    if (offeringRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Class not found or is not assigned to you.",
      });
    }

    const offering = offeringRows[0];

    // =================================================
    // CANCELLED OFFERING
    // =================================================

    if (offering.offering_status === "Cancelled") {
      return res.status(409).json({
        success: false,
        message: "This class offering has been cancelled.",
      });
    }

    // =================================================
    // GET OFFICIAL STUDENTS + GRADES
    // =================================================
    //
    // Also return the latest ACTIVE INC completion
    // request for the grade.
    //
    // Active:
    //
    // Pending Program Head
    // For Registrar Processing
    //
    // =================================================

    const [rows] = await db.execute(
      `
      SELECT
          es.enrollment_subject_id,
          es.enrollment_id,
          es.status AS enrollment_subject_status,

          e.student_id,
          e.enrollment_status,

          s.student_number,
          s.first_name,
          s.middle_name,
          s.last_name,

          u.email,

          -- =============================================
          -- OFFICIAL GRADE
          -- =============================================

          g.grade_id,
          g.faculty_id AS grade_faculty_id,

          g.midterm_grade,
          g.final_grade,
          g.final_rating,

          g.grading_policy,
          g.grading_outcome,
          g.outcome_reason,
          g.overall_percentage,

          g.remarks,
          g.grade_status,

          g.submitted_at,

          g.reviewed_by,
          reviewer.username AS reviewed_by_username,
          g.reviewed_at,
          g.review_remarks,

          g.created_at AS grade_created_at,
          g.updated_at AS grade_updated_at,

          -- =============================================
          -- ACTIVE INC COMPLETION REQUEST
          -- =============================================

          gcr.grade_change_request_id AS inc_request_id,
          gcr.status AS inc_request_status,
          gcr.requested_at AS inc_request_requested_at,
          gcr.reviewed_at AS inc_request_reviewed_at,
          gcr.review_remarks AS inc_request_review_remarks

      FROM enrollment_subjects es

      INNER JOIN enrollments e
          ON e.enrollment_id = es.enrollment_id

      INNER JOIN students s
          ON s.student_id = e.student_id

      LEFT JOIN users u
          ON u.user_id = s.user_id

      LEFT JOIN grades g
          ON g.enrollment_subject_id = es.enrollment_subject_id

      LEFT JOIN users reviewer
          ON reviewer.user_id = g.reviewed_by

      -- =============================================
      -- LATEST ACTIVE INC COMPLETION REQUEST
      -- =============================================

      LEFT JOIN grade_change_requests gcr
          ON gcr.grade_change_request_id = (
              SELECT
                  gcr_latest.grade_change_request_id

              FROM grade_change_requests gcr_latest

              WHERE
                  gcr_latest.grade_id = g.grade_id

                  AND gcr_latest.request_type = 'INC_COMPLETION'

                  AND gcr_latest.status IN (
                      'Pending Program Head',
                      'For Registrar Processing'
                  )

              ORDER BY
                  gcr_latest.requested_at DESC,
                  gcr_latest.grade_change_request_id DESC

              LIMIT 1
          )

      WHERE
          es.offering_id = ?

          AND es.subject_id = ?

          AND es.section_id = ?

          AND e.academic_year_id = ?

          AND e.semester_id = ?

          AND e.enrollment_status = 'Approved'

          AND es.status IN (
              'Enrolled',
              'Completed',
              'Failed',
              'Incomplete',
              'Unofficial Drop'
          )

      ORDER BY
          s.last_name ASC,
          s.first_name ASC,
          s.middle_name ASC,
          s.student_number ASC
      `,
      [
        offering.offering_id,
        offering.subject_id,
        offering.section_id,
        offering.academic_year_id,
        offering.semester_id,
      ],
    );

    // =================================================
    // FORMAT STUDENTS
    // =================================================

    const students = rows.map((row) => {
      const hasGrade = row.grade_id !== null;

      return {
        enrollment_subject_id: row.enrollment_subject_id,

        enrollment_id: row.enrollment_id,

        student_id: row.student_id,

        student_number: row.student_number,

        first_name: row.first_name,

        middle_name: row.middle_name,

        last_name: row.last_name,

        full_name: [row.first_name, row.middle_name, row.last_name]
          .filter(Boolean)
          .join(" "),

        email: row.email,

        enrollment_status: row.enrollment_status,

        subject_status: row.enrollment_subject_status,

        // =============================================
        // ACTIVE INC COMPLETION REQUEST
        // =============================================
        //
        // null:
        // Faculty may submit Complete INC if this is an
        // Approved INC.
        //
        // Pending Program Head:
        // Faculty waits for Program Head.
        //
        // For Registrar Processing:
        // Faculty waits for Registrar.
        //
        // =============================================

        inc_completion_request:
          row.inc_request_id !== null
            ? {
                grade_change_request_id: Number(row.inc_request_id),

                status: row.inc_request_status,

                requested_at: row.inc_request_requested_at,

                reviewed_at: row.inc_request_reviewed_at,

                review_remarks: row.inc_request_review_remarks,
              }
            : null,

        // =============================================
        // OFFICIAL GRADE
        // =============================================

        grade: hasGrade
          ? {
              grade_id: row.grade_id,

              faculty_id: row.grade_faculty_id,

              midterm_grade:
                row.midterm_grade !== null ? Number(row.midterm_grade) : null,

              final_grade:
                row.final_grade !== null ? Number(row.final_grade) : null,

              ...gradePolicyFields(row),

              final_rating:
                row.final_rating !== null ? Number(row.final_rating) : null,

              remarks: row.remarks,

              grade_status: row.grade_status,

              submitted_at: row.submitted_at,

              review: {
                reviewed_by: row.reviewed_by,

                reviewed_by_username: row.reviewed_by_username,

                reviewed_at: row.reviewed_at,

                review_remarks: row.review_remarks,
              },

              created_at: row.grade_created_at,

              updated_at: row.grade_updated_at,
            }
          : null,
      };
    });

    // =================================================
    // SUMMARY
    // =================================================

    const summary = {
      total_students: students.length,

      without_grade: students.filter((student) => student.grade === null)
        .length,

      draft: students.filter(
        (student) => student.grade?.grade_status === "Draft",
      ).length,

      submitted: students.filter(
        (student) => student.grade?.grade_status === "Submitted",
      ).length,

      returned: students.filter(
        (student) => student.grade?.grade_status === "Returned",
      ).length,

      approved: students.filter(
        (student) => student.grade?.grade_status === "Approved",
      ).length,
    };

    // =================================================
    // SUCCESS RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      // ===============================================
      // FACULTY
      // ===============================================

      faculty: {
        faculty_id: faculty.faculty_id,

        employee_number: faculty.employee_number,

        faculty_name: faculty.faculty_name,
      },

      // ===============================================
      // CLASS
      // ===============================================

      class: {
        offering_id: offering.offering_id,

        section_subject_id: offering.section_subject_id,

        offering_status: offering.offering_status,

        section_subject_status: offering.section_subject_status,

        // =============================================
        // SUBJECT
        // =============================================

        subject: {
          subject_id: offering.subject_id,

          subject_code: offering.subject_code,

          subject_name: offering.subject_name,

          units: Number(offering.units),

          lecture_hours: Number(offering.lecture_hours),

          laboratory_hours: Number(offering.laboratory_hours),
        },

        // =============================================
        // SECTION
        // =============================================

        section: {
          section_id: offering.section_id,

          section_name: offering.section_name,

          year_level: offering.year_level,

          course: {
            course_id: offering.course_id,

            course_code: offering.course_code,

            course_name: offering.course_name,
          },
        },

        // =============================================
        // ACADEMIC PERIOD
        // =============================================

        academic_period: {
          academic_year_id: offering.academic_year_id,

          academic_year: offering.academic_year,

          is_current_academic_year: Boolean(offering.academic_year_is_current),

          semester_id: offering.semester_id,

          semester_name: offering.semester_name,
        },

        // =============================================
        // SCHEDULE
        // =============================================

        schedule: {
          days: offering.schedule_days,

          time: offering.schedule_time,
        },

        // =============================================
        // ROOM
        // =============================================

        room: offering.room_id
          ? {
              room_id: offering.room_id,

              room_code: offering.room_code,

              room_name: offering.room_name,
            }
          : null,
      },

      // ===============================================
      // SUMMARY
      // ===============================================

      summary,

      // ===============================================
      // STUDENTS
      // ===============================================

      students,
    });
  } catch (error) {
    console.error(
      "GET /api/faculty/classes/:offeringId/gradebook error:",
      error,
    );

    return res.status(500).json({
      success: false,

      message: "Failed to retrieve class gradebook.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// =====================================================
// SUBMIT INC COMPLETION REQUEST
//
// POST
// /api/faculty/classes/:offeringId/grades/:enrollmentSubjectId/inc-completion
//
// Purpose:
//
// Approved INC
//      ↓
// Student completes missing requirement manually
//      ↓
// Faculty verifies requirement
//      ↓
// Faculty enters completed Midterm + Final
//      ↓
// Backend recalculates official proposed grade
//      ↓
// grade_change_requests
//      ↓
// Pending Program Head
//
// IMPORTANT:
//
// - Original approved grade is NOT changed here.
// - Faculty identity comes from JWT.
// - Faculty must own the subject offering.
// - Existing grade must be Approved.
// - Existing grade must be Incomplete.
// - Only one active INC completion request is allowed.
// - final_rating is NEVER trusted from frontend.
// - Backend gradingPolicy.service calculates the result.
// =====================================================

router.post(
  "/:offeringId/grades/:enrollmentSubjectId/inc-completion",
  async (req, res) => {
    let connection;

    try {
      // =================================================
      // AUTHENTICATED FACULTY
      // =================================================

      const faculty = await getAuthenticatedFaculty(req, res);

      if (!faculty) {
        return;
      }

      // =================================================
      // PARAMETERS
      // =================================================

      const offeringId = toPositiveInt(req.params.offeringId);

      const enrollmentSubjectId = toPositiveInt(req.params.enrollmentSubjectId);

      if (!offeringId) {
        return res.status(400).json({
          success: false,
          message: "Invalid offering ID.",
        });
      }

      if (!enrollmentSubjectId) {
        return res.status(400).json({
          success: false,
          message: "Invalid enrollment subject ID.",
        });
      }

      // =================================================
      // COMPLETION REMARKS
      // =================================================

      const completionRemarks =
        typeof req.body?.completion_remarks === "string"
          ? req.body.completion_remarks.trim()
          : "";

      if (!completionRemarks) {
        return res.status(400).json({
          success: false,
          message:
            "Completion remarks are required. Describe the requirement completed by the student.",
        });
      }

      if (completionRemarks.length > 2000) {
        return res.status(400).json({
          success: false,
          message: "Completion remarks must not exceed 2000 characters.",
        });
      }

      // =================================================
      // CALCULATE PROPOSED COMPLETED GRADE
      //
      // INC completion must become a normal numeric grade.
      //
      // We do NOT accept:
      //
      // - final_rating
      // - overall_percentage
      // - remarks
      //
      // from the frontend.
      //
      // Those values are calculated by the backend.
      // =================================================

      let calculated;

      try {
        calculated = calculateGrade(
          {
            grading_outcome: "NUMERIC",

            midterm_grade: req.body?.midterm_grade,

            final_grade: req.body?.final_grade,
          },
          {
            requireComplete: true,
          },
        );
      } catch (error) {
        return res.status(400).json({
          success: false,
          message:
            error.message ||
            "Valid Midterm and Final Term grades are required.",
        });
      }

      // =================================================
      // EXTRA SAFETY
      // =================================================

      if (
        calculated.grading_outcome !== "NUMERIC" ||
        calculated.final_rating === null ||
        calculated.final_rating === undefined
      ) {
        return res.status(400).json({
          success: false,
          message: "INC completion must result in a complete numeric grade.",
        });
      }

      // =================================================
      // DATABASE TRANSACTION
      // =================================================

      connection = await db.getConnection();

      await connection.beginTransaction();

      // =================================================
      // LOAD ORIGINAL APPROVED INC
      //
      // FOR UPDATE prevents two requests being created
      // simultaneously for the same grade.
      // =================================================

      const [gradeRows] = await connection.execute(
        `
        SELECT
            g.grade_id,
            g.enrollment_subject_id,
            g.faculty_id,

            g.midterm_grade,
            g.final_grade,
            g.overall_percentage,
            g.final_rating,

            g.grading_policy,
            g.grading_outcome,
            g.outcome_reason,

            g.remarks,
            g.grade_status,

            g.submitted_at,
            g.reviewed_by,
            g.reviewed_at,
            g.review_remarks,

            es.enrollment_id,
            es.offering_id,
            es.subject_id,
            es.section_id,
            es.status
                AS enrollment_subject_status,

            e.student_id,
            e.enrollment_status,

            s.student_number,
            s.first_name,
            s.middle_name,
            s.last_name,

            so.faculty_id
                AS offering_faculty_id,

            so.status
                AS offering_status,

            sub.subject_code,
            sub.subject_name,

            sec.section_name

        FROM grades g

        INNER JOIN enrollment_subjects es
            ON es.enrollment_subject_id =
               g.enrollment_subject_id

        INNER JOIN enrollments e
            ON e.enrollment_id =
               es.enrollment_id

        INNER JOIN students s
            ON s.student_id =
               e.student_id

        INNER JOIN subject_offerings so
            ON so.offering_id =
               es.offering_id

        INNER JOIN subjects sub
            ON sub.subject_id =
               es.subject_id

        INNER JOIN sections sec
            ON sec.section_id =
               es.section_id

        WHERE
            g.enrollment_subject_id = ?

            AND es.offering_id = ?

            AND so.faculty_id = ?

        LIMIT 1

        FOR UPDATE
        `,
        [enrollmentSubjectId, offeringId, faculty.faculty_id],
      );

      // =================================================
      // GRADE / OWNERSHIP NOT FOUND
      // =================================================

      if (gradeRows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "Approved INC grade was not found or this class is not assigned to you.",
        });
      }

      const grade = gradeRows[0];

      // =================================================
      // VERIFY FACULTY OWNERSHIP
      // =================================================

      if (Number(grade.offering_faculty_id) !== Number(faculty.faculty_id)) {
        await connection.rollback();

        return res.status(403).json({
          success: false,
          message: "You are not assigned to this subject offering.",
        });
      }

      if (
        grade.faculty_id !== null &&
        Number(grade.faculty_id) !== Number(faculty.faculty_id)
      ) {
        await connection.rollback();

        return res.status(403).json({
          success: false,
          message: "This grade belongs to another Faculty assignment.",
        });
      }

      // =================================================
      // OFFERING VALIDATION
      // =================================================

      if (grade.offering_status === "Cancelled") {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "An INC completion cannot be submitted for a cancelled class.",
        });
      }

      // =================================================
      // ENROLLMENT MUST STILL BE OFFICIAL
      // =================================================

      if (grade.enrollment_status !== "Approved") {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "INC completion is only allowed for an approved enrollment.",
        });
      }

      // =================================================
      // ORIGINAL GRADE MUST ALREADY BE APPROVED
      // =================================================

      if (grade.grade_status !== "Approved") {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Only an approved INC grade can enter the completion process.",
        });
      }

      // =================================================
      // MUST ACTUALLY BE INCOMPLETE
      //
      // We check both modern grading_outcome and remarks
      // so older INC records can still work.
      // =================================================

      const isIncomplete =
        String(grade.grading_outcome || "").toUpperCase() === "INCOMPLETE" ||
        String(grade.remarks || "").toLowerCase() === "incomplete" ||
        Number(grade.final_rating) === 4;

      if (!isIncomplete) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "This grade is not an Incomplete grade and cannot use the INC completion workflow.",
        });
      }

      // =================================================
      // SUBJECT STATUS
      //
      // Approved INC grades normally change the
      // enrollment_subject status to Incomplete.
      // =================================================

      if (
        !["Incomplete", "Enrolled"].includes(grade.enrollment_subject_status)
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "This subject is no longer eligible for INC completion.",
        });
      }

      // =================================================
      // PREVENT DUPLICATE ACTIVE REQUEST
      // =================================================

      const [existingRequestRows] = await connection.execute(
        `
          SELECT
              grade_change_request_id,
              status,
              requested_at

          FROM grade_change_requests

          WHERE grade_id = ?

            AND request_type =
                'INC_COMPLETION'

            AND status IN (
                'Pending Program Head',
                'For Registrar Processing'
            )

          LIMIT 1

          FOR UPDATE
          `,
        [grade.grade_id],
      );

      if (existingRequestRows.length > 0) {
        const existingRequest = existingRequestRows[0];

        await connection.rollback();

        return res.status(409).json({
          success: false,

          message:
            "An active INC completion request already exists for this grade.",

          request: {
            grade_change_request_id: Number(
              existingRequest.grade_change_request_id,
            ),

            status: existingRequest.status,

            requested_at: existingRequest.requested_at,
          },
        });
      }

      // =================================================
      // INSERT GRADE CHANGE REQUEST
      //
      // Original approved grade remains untouched.
      // =================================================

      const [insertResult] = await connection.execute(
        `
          INSERT INTO grade_change_requests (
              grade_id,
              request_type,

              old_midterm_grade,
              old_final_grade,
              old_overall_percentage,
              old_final_rating,
              old_remarks,
              old_grading_outcome,
              old_outcome_reason,

              new_midterm_grade,
              new_final_grade,
              new_overall_percentage,
              new_final_rating,
              new_remarks,
              new_grading_outcome,

              completion_remarks,

              requested_by,
              requested_by_role,

              status
          )

          VALUES (
              ?,
              'INC_COMPLETION',

              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,

              ?,
              ?,
              ?,
              ?,
              ?,
              ?,

              ?,

              ?,
              'Faculty',

              'Pending Program Head'
          )
          `,
        [
          // -----------------------------------------
          // ORIGINAL GRADE
          // -----------------------------------------

          grade.grade_id,

          grade.midterm_grade,
          grade.final_grade,
          grade.overall_percentage,
          grade.final_rating,
          grade.remarks,
          grade.grading_outcome,
          grade.outcome_reason,

          // -----------------------------------------
          // PROPOSED COMPLETED GRADE
          // -----------------------------------------

          calculated.midterm_grade,
          calculated.final_grade,
          calculated.overall_percentage,
          calculated.final_rating,
          calculated.remarks,
          calculated.grading_outcome,

          // -----------------------------------------
          // REASON / EVIDENCE DESCRIPTION
          // -----------------------------------------

          completionRemarks,

          // -----------------------------------------
          // AUTHENTICATED FACULTY USER
          // -----------------------------------------

          faculty.user_id,
        ],
      );

      const gradeChangeRequestId = Number(insertResult.insertId);

      // =================================================
      // AUDIT TRAIL
      // =================================================

      const oldValues = {
        grade_id: Number(grade.grade_id),

        grading_outcome: grade.grading_outcome,

        midterm_grade:
          grade.midterm_grade !== null ? Number(grade.midterm_grade) : null,

        final_grade:
          grade.final_grade !== null ? Number(grade.final_grade) : null,

        overall_percentage:
          grade.overall_percentage !== null
            ? Number(grade.overall_percentage)
            : null,

        final_rating:
          grade.final_rating !== null ? Number(grade.final_rating) : null,

        remarks: grade.remarks,

        outcome_reason: grade.outcome_reason,
      };

      const newValues = {
        grade_change_request_id: gradeChangeRequestId,

        request_type: "INC_COMPLETION",

        grading_outcome: calculated.grading_outcome,

        midterm_grade: calculated.midterm_grade,

        final_grade: calculated.final_grade,

        overall_percentage: calculated.overall_percentage,

        final_rating: calculated.final_rating,

        remarks: calculated.remarks,

        completion_remarks: completionRemarks,

        status: "Pending Program Head",
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
            'grade_change_requests',
            ?,
            'INSERT',
            ?,
            ?
        )
        `,
        [
          faculty.user_id,

          gradeChangeRequestId,

          JSON.stringify(oldValues),

          JSON.stringify(newValues),
        ],
      );

      // =================================================
      // LOAD CREATED REQUEST
      // =================================================

      const [requestRows] = await connection.execute(
        `
          SELECT
              grade_change_request_id,
              grade_id,
              request_type,

              old_midterm_grade,
              old_final_grade,
              old_overall_percentage,
              old_final_rating,
              old_remarks,
              old_grading_outcome,
              old_outcome_reason,

              new_midterm_grade,
              new_final_grade,
              new_overall_percentage,
              new_final_rating,
              new_remarks,
              new_grading_outcome,

              completion_remarks,

              requested_by,
              requested_by_role,
              requested_at,

              reviewed_by,
              reviewed_at,
              review_remarks,

              processed_by,
              processed_at,
              registrar_remarks,

              status,

              created_at,
              updated_at

          FROM grade_change_requests

          WHERE grade_change_request_id = ?

          LIMIT 1
          `,
        [gradeChangeRequestId],
      );

      const createdRequest = requestRows[0];

      // =================================================
      // COMMIT
      // =================================================

      await connection.commit();

      // =================================================
      // SUCCESS RESPONSE
      // =================================================

      return res.status(201).json({
        success: true,

        message: "INC completion request submitted for Program Head review.",

        student: {
          student_id: Number(grade.student_id),

          student_number: grade.student_number,

          full_name: [grade.first_name, grade.middle_name, grade.last_name]
            .filter(Boolean)
            .join(" "),
        },

        class: {
          offering_id: Number(grade.offering_id),

          subject: {
            subject_id: Number(grade.subject_id),

            subject_code: grade.subject_code,

            subject_name: grade.subject_name,
          },

          section: {
            section_id: Number(grade.section_id),

            section_name: grade.section_name,
          },
        },

        original_grade: {
          grade_id: Number(grade.grade_id),

          midterm_grade:
            grade.midterm_grade !== null ? Number(grade.midterm_grade) : null,

          final_grade:
            grade.final_grade !== null ? Number(grade.final_grade) : null,

          overall_percentage:
            grade.overall_percentage !== null
              ? Number(grade.overall_percentage)
              : null,

          final_rating:
            grade.final_rating !== null ? Number(grade.final_rating) : null,

          grading_outcome: grade.grading_outcome,

          outcome_reason: grade.outcome_reason,

          remarks: grade.remarks,

          grade_status: grade.grade_status,
        },

        proposed_grade: {
          midterm_grade: calculated.midterm_grade,

          final_grade: calculated.final_grade,

          overall_percentage: calculated.overall_percentage,

          final_rating: calculated.final_rating,

          grading_policy: calculated.grading_policy,

          grading_outcome: calculated.grading_outcome,

          remarks: calculated.remarks,
        },

        request: {
          grade_change_request_id: Number(
            createdRequest.grade_change_request_id,
          ),

          grade_id: Number(createdRequest.grade_id),

          request_type: createdRequest.request_type,

          completion_remarks: createdRequest.completion_remarks,

          requested_by: Number(createdRequest.requested_by),

          requested_by_role: createdRequest.requested_by_role,

          requested_at: createdRequest.requested_at,

          status: createdRequest.status,
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
          console.error("INC COMPLETION ROLLBACK ERROR:", rollbackError);
        }
      }

      console.error(
        "POST /api/faculty/classes/:offeringId/grades/:enrollmentSubjectId/inc-completion error:",
        error,
      );

      // =================================================
      // DATABASE BUSINESS RULE
      // =================================================

      if (error?.errno === 1644 || error?.sqlState === "45000") {
        return res.status(409).json({
          success: false,

          message:
            error.sqlMessage ||
            error.message ||
            "INC completion request was rejected by the database.",
        });
      }

      // =================================================
      // FOREIGN KEY
      // =================================================

      if (error?.code === "ER_NO_REFERENCED_ROW_2") {
        return res.status(409).json({
          success: false,

          message:
            "The INC completion request references an invalid academic record.",
        });
      }

      return res.status(500).json({
        success: false,

        message: "Failed to submit INC completion request.",

        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  },
);

router.put(
  "/:offeringId/grades/:enrollmentSubjectId/draft",
  async (req, res) => {
    try {
      const faculty = await getAuthenticatedFaculty(req, res);

      if (!faculty) {
        return;
      }

      const offeringId = Number(req.params.offeringId);
      const enrollmentSubjectId = Number(req.params.enrollmentSubjectId);

      if (!Number.isInteger(offeringId) || offeringId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid offering ID.",
        });
      }

      if (!Number.isInteger(enrollmentSubjectId) || enrollmentSubjectId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid enrollment subject ID.",
        });
      }

      let calculated;

      try {
        calculated = calculateGrade(req.body ?? {}, {
          requireComplete: false,
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      const [membershipRows] = await db.execute(
        `
        SELECT
            so.offering_id,
            so.faculty_id,
            so.status AS offering_status,

            sub.subject_id,
            sub.subject_code,
            sub.subject_name,

            sec.section_id,
            sec.section_name,

            es.enrollment_subject_id,
            es.enrollment_id,
            es.status AS enrollment_subject_status,

            e.student_id,
            e.enrollment_status,

            s.student_number,
            s.first_name,
            s.middle_name,
            s.last_name

        FROM subject_offerings so

        INNER JOIN subjects sub
            ON sub.subject_id = so.subject_id

        INNER JOIN sections sec
            ON sec.section_id = so.section_id

        INNER JOIN enrollment_subjects es
            ON es.offering_id = so.offering_id
            AND es.subject_id = so.subject_id
            AND es.section_id = so.section_id

        INNER JOIN enrollments e
            ON e.enrollment_id = es.enrollment_id

        INNER JOIN students s
            ON s.student_id = e.student_id

        WHERE
            so.offering_id = ?
            AND so.faculty_id = ?
            AND es.enrollment_subject_id = ?

        LIMIT 1
        `,
        [offeringId, faculty.faculty_id, enrollmentSubjectId],
      );

      if (membershipRows.length === 0) {
        return res.status(404).json({
          success: false,
          message:
            "Student class enrollment was not found or is not assigned to you.",
        });
      }

      const membership = membershipRows[0];

      if (membership.offering_status === "Cancelled") {
        return res.status(409).json({
          success: false,
          message: "Grades cannot be saved for a cancelled class.",
        });
      }

      if (membership.enrollment_status !== "Approved") {
        return res.status(409).json({
          success: false,
          message: "Grades can only be saved for an approved enrollment.",
        });
      }

      if (membership.enrollment_subject_status !== "Enrolled") {
        return res.status(409).json({
          success: false,
          message:
            "This subject is no longer actively enrolled and cannot be edited.",
        });
      }

      const [existingRows] = await db.execute(
        `
        SELECT
            grade_id,
            enrollment_subject_id,
            faculty_id,

            midterm_grade,
            final_grade,
            final_rating,

            grading_policy,
            grading_outcome,
            outcome_reason,
            overall_percentage,

            remarks,
            grade_status,

            submitted_at,
            reviewed_by,
            reviewed_at,
            review_remarks,

            created_at,
            updated_at

        FROM grades

        WHERE enrollment_subject_id = ?

        LIMIT 1
        `,
        [enrollmentSubjectId],
      );

      const existingGrade = existingRows.length > 0 ? existingRows[0] : null;

      let gradeId;
      let resultingStatus;

      if (existingGrade) {
        if (
          existingGrade.faculty_id !== null &&
          Number(existingGrade.faculty_id) !== Number(faculty.faculty_id)
        ) {
          return res.status(403).json({
            success: false,
            message: "This grade belongs to another Faculty assignment.",
          });
        }

        if (existingGrade.grade_status === "Approved") {
          return res.status(409).json({
            success: false,
            message: "This grade has already been approved and is locked.",
          });
        }

        if (existingGrade.grade_status === "Submitted") {
          return res.status(409).json({
            success: false,
            message:
              "This grade has already been submitted and cannot be edited unless it is returned by the Program Head.",
          });
        }
      }

      if (!existingGrade) {
        const [insertResult] = await db.execute(
          `
          INSERT INTO grades (
              enrollment_subject_id,
              faculty_id,

              grading_policy,
              grading_outcome,
              outcome_reason,

              midterm_grade,
              final_grade,
              overall_percentage,
              final_rating,
              remarks,

              grade_status
          )

          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft')
          `,
          [
            enrollmentSubjectId,
            faculty.faculty_id,

            calculated.grading_policy,
            calculated.grading_outcome,
            calculated.outcome_reason,

            calculated.midterm_grade,
            calculated.final_grade,
            calculated.overall_percentage,
            calculated.final_rating,
            calculated.remarks,
          ],
        );

        gradeId = insertResult.insertId;
        resultingStatus = "Draft";
      } else {
        resultingStatus = existingGrade.grade_status;

        const [draftUpdate] = await db.execute(
          `
          UPDATE grades

          SET
              faculty_id = ?,

              grading_policy = ?,
              grading_outcome = ?,
              outcome_reason = ?,

              midterm_grade = ?,
              final_grade = ?,
              overall_percentage = ?,
              final_rating = ?,
              remarks = ?,

              grade_status = ?

          WHERE
              grade_id = ?
              AND grade_status IN ('Draft', 'Returned')
          `,
          [
            faculty.faculty_id,

            calculated.grading_policy,
            calculated.grading_outcome,
            calculated.outcome_reason,

            calculated.midterm_grade,
            calculated.final_grade,
            calculated.overall_percentage,
            calculated.final_rating,
            calculated.remarks,

            resultingStatus,

            existingGrade.grade_id,
          ],
        );

        if (draftUpdate.affectedRows !== 1) {
          return res.status(409).json({
            success: false,
            message: "Grade changed while saving. Refresh and try again.",
          });
        }

        gradeId = existingGrade.grade_id;
      }

      const [savedRows] = await db.execute(
        `
        SELECT
            grade_id,
            enrollment_subject_id,
            faculty_id,

            midterm_grade,
            final_grade,

            grading_policy,
            grading_outcome,
            outcome_reason,
            overall_percentage,

            remarks,
            grade_status,

            submitted_at,
            reviewed_by,
            reviewed_at,
            review_remarks,

            created_at,
            updated_at

        FROM grades

        WHERE grade_id = ?

        LIMIT 1
        `,
        [gradeId],
      );

      const saved = savedRows[0];

      return res.status(200).json({
        success: true,

        message:
          resultingStatus === "Returned"
            ? "Returned grade corrections saved."
            : "Draft grade saved successfully.",

        student: {
          enrollment_subject_id: membership.enrollment_subject_id,
          enrollment_id: membership.enrollment_id,
          student_id: membership.student_id,
          student_number: membership.student_number,

          full_name: [
            membership.first_name,
            membership.middle_name,
            membership.last_name,
          ]
            .filter(Boolean)
            .join(" "),
        },

        class: {
          offering_id: membership.offering_id,

          subject: {
            subject_id: membership.subject_id,
            subject_code: membership.subject_code,
            subject_name: membership.subject_name,
          },

          section: {
            section_id: membership.section_id,
            section_name: membership.section_name,
          },
        },

        grade: {
          grade_id: saved.grade_id,
          enrollment_subject_id: saved.enrollment_subject_id,
          faculty_id: saved.faculty_id,

          midterm_grade:
            saved.midterm_grade !== null ? Number(saved.midterm_grade) : null,

          final_grade:
            saved.final_grade !== null ? Number(saved.final_grade) : null,

          ...gradePolicyFields(saved),

          final_rating:
            saved.final_rating !== null ? Number(saved.final_rating) : null,

          remarks: saved.remarks,
          grade_status: saved.grade_status,

          submitted_at: saved.submitted_at,
          reviewed_by: saved.reviewed_by,
          reviewed_at: saved.reviewed_at,
          review_remarks: saved.review_remarks,

          created_at: saved.created_at,
          updated_at: saved.updated_at,
        },
      });
    } catch (error) {
      console.error(
        "PUT /api/faculty/classes/:offeringId/grades/:enrollmentSubjectId/draft error:",
        error,
      );

      if (error?.errno === 1644 || error?.sqlState === "45000") {
        return res.status(409).json({
          success: false,
          message:
            error.sqlMessage ||
            error.message ||
            "Grade operation was rejected by the database.",
        });
      }

      if (error?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          success: false,
          message: "A grade record already exists for this enrollment subject.",
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to save draft grade.",
      });
    }
  },
);

router.patch(
  "/:offeringId/grades/:enrollmentSubjectId/submit",
  async (req, res) => {
    try {
      const faculty = await getAuthenticatedFaculty(req, res);

      if (!faculty) {
        return;
      }

      const offeringId = Number(req.params.offeringId);
      const enrollmentSubjectId = Number(req.params.enrollmentSubjectId);

      if (!Number.isInteger(offeringId) || offeringId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid offering ID.",
        });
      }

      if (!Number.isInteger(enrollmentSubjectId) || enrollmentSubjectId <= 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid enrollment subject ID.",
        });
      }

      const [rows] = await db.execute(
        `
        SELECT
            g.grade_id,
            g.enrollment_subject_id,
            g.faculty_id,
            g.midterm_grade,
            g.final_grade,
            g.final_rating,
            g.grading_policy,
            g.grading_outcome,
            g.outcome_reason,
            g.overall_percentage,
            g.remarks,
            g.grade_status,
            g.submitted_at,
            g.reviewed_by,
            g.reviewed_at,
            g.review_remarks,

            es.enrollment_id,
            es.status AS enrollment_subject_status,

            e.student_id,
            e.enrollment_status,

            s.student_number,
            s.first_name,
            s.middle_name,
            s.last_name,

            so.offering_id,
            so.faculty_id AS offering_faculty_id,
            so.status AS offering_status,

            sub.subject_id,
            sub.subject_code,
            sub.subject_name,

            sec.section_id,
            sec.section_name

        FROM grades g

        INNER JOIN enrollment_subjects es
            ON es.enrollment_subject_id = g.enrollment_subject_id

        INNER JOIN enrollments e
            ON e.enrollment_id = es.enrollment_id

        INNER JOIN students s
            ON s.student_id = e.student_id

        INNER JOIN subject_offerings so
            ON so.offering_id = es.offering_id

        INNER JOIN subjects sub
            ON sub.subject_id = so.subject_id

        INNER JOIN sections sec
            ON sec.section_id = so.section_id

        WHERE
            g.enrollment_subject_id = ?
            AND es.offering_id = ?
            AND so.faculty_id = ?

        LIMIT 1
        `,
        [enrollmentSubjectId, offeringId, faculty.faculty_id],
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message:
            "Draft grade was not found or this class is not assigned to you.",
        });
      }

      const grade = rows[0];

      if (grade.offering_status === "Cancelled") {
        return res.status(409).json({
          success: false,
          message: "Grades cannot be submitted for a cancelled class.",
        });
      }

      if (grade.enrollment_status !== "Approved") {
        return res.status(409).json({
          success: false,
          message: "Only grades from approved enrollments may be submitted.",
        });
      }

      if (Number(grade.faculty_id) !== Number(faculty.faculty_id)) {
        return res.status(403).json({
          success: false,
          message: "This grade belongs to another Faculty assignment.",
        });
      }

      if (grade.grade_status === "Submitted") {
        return res.status(409).json({
          success: false,
          message: "This grade has already been submitted.",
        });
      }

      if (grade.grade_status === "Approved") {
        return res.status(409).json({
          success: false,
          message: "This grade has already been approved and is locked.",
        });
      }

      if (!["Draft", "Returned"].includes(grade.grade_status)) {
        return res.status(409).json({
          success: false,
          message: `Grade status ${grade.grade_status} cannot be submitted.`,
        });
      }

      if (grade.enrollment_subject_status !== "Enrolled") {
        return res.status(409).json({
          success: false,
          message: "This subject is no longer actively enrolled.",
        });
      }

      if (grade.grading_policy !== "TWO_TERM_50_50") {
        return res.status(409).json({
          success: false,
          message:
            "Re-enter and save Midterm and Final Term percentages before submitting this legacy draft.",
        });
      }

      try {
        calculateGrade(grade, {
          requireComplete: true,
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      const [submitResult] = await db.execute(
        `
        UPDATE grades
        SET
            grade_status = 'Submitted',
            submitted_at = CURRENT_TIMESTAMP,
            reviewed_by = NULL,
            reviewed_at = NULL,
            review_remarks = NULL

        WHERE grade_id = ?
          AND grade_status IN ('Draft', 'Returned')
        `,
        [grade.grade_id],
      );

      if (submitResult.affectedRows !== 1) {
        return res.status(409).json({
          success: false,
          message: "Grade changed while submitting. Refresh and try again.",
        });
      }

      const [updatedRows] = await db.execute(
        `
        SELECT
            grade_id,
            enrollment_subject_id,
            faculty_id,
            midterm_grade,
            final_grade,
            final_rating,
            grading_policy,
            grading_outcome,
            outcome_reason,
            overall_percentage,
            remarks,
            grade_status,
            submitted_at,
            reviewed_by,
            reviewed_at,
            review_remarks,
            created_at,
            updated_at

        FROM grades

        WHERE grade_id = ?

        LIMIT 1
        `,
        [grade.grade_id],
      );

      const submitted = updatedRows[0];

      return res.status(200).json({
        success: true,

        message:
          grade.grade_status === "Returned"
            ? "Corrected grade resubmitted successfully."
            : "Grade submitted successfully.",

        student: {
          enrollment_subject_id: grade.enrollment_subject_id,
          enrollment_id: grade.enrollment_id,
          student_id: grade.student_id,
          student_number: grade.student_number,

          full_name: [grade.first_name, grade.middle_name, grade.last_name]
            .filter(Boolean)
            .join(" "),
        },

        class: {
          offering_id: grade.offering_id,

          subject: {
            subject_id: grade.subject_id,
            subject_code: grade.subject_code,
            subject_name: grade.subject_name,
          },

          section: {
            section_id: grade.section_id,
            section_name: grade.section_name,
          },
        },

        grade: {
          grade_id: submitted.grade_id,
          enrollment_subject_id: submitted.enrollment_subject_id,
          faculty_id: submitted.faculty_id,

          midterm_grade:
            submitted.midterm_grade !== null
              ? Number(submitted.midterm_grade)
              : null,

          final_grade:
            submitted.final_grade !== null
              ? Number(submitted.final_grade)
              : null,

          ...gradePolicyFields(submitted),

          final_rating:
            submitted.final_rating !== null
              ? Number(submitted.final_rating)
              : null,

          remarks: submitted.remarks,
          grade_status: submitted.grade_status,
          submitted_at: submitted.submitted_at,
          reviewed_by: submitted.reviewed_by,
          reviewed_at: submitted.reviewed_at,
          review_remarks: submitted.review_remarks,
          created_at: submitted.created_at,
          updated_at: submitted.updated_at,
        },
      });
    } catch (error) {
      console.error(
        "PATCH /api/faculty/classes/:offeringId/grades/:enrollmentSubjectId/submit error:",
        error,
      );

      if (error?.errno === 1644 || error?.sqlState === "45000") {
        return res.status(409).json({
          success: false,
          message:
            error.sqlMessage ||
            error.message ||
            "Grade submission was rejected by the database.",
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to submit grade.",
      });
    }
  },
);

// =====================================================
// SUBMIT APPROVED NUMERIC GRADE CORRECTION REQUEST
//
// POST
// /api/faculty/classes/:offeringId/grades/:enrollmentSubjectId/correction
//
// Purpose:
//
// Approved numeric grade
//      ↓
// Faculty discovers encoding / computation error
//      ↓
// Faculty proposes corrected Midterm + Final
//      ↓
// Backend recalculates result
//      ↓
// grade_change_requests
//      ↓
// Pending Program Head
//
// IMPORTANT:
//
// - Official approved grade is NOT modified here.
// - Only TWO_TERM_50_50 numeric grades are supported.
// - INC uses the separate INC_COMPLETION workflow.
// - Unofficial Drop is not handled here.
// - final_rating / overall_percentage / remarks are
//   NEVER trusted from the frontend.
// =====================================================

router.post(
  "/:offeringId/grades/:enrollmentSubjectId/correction",
  async (req, res) => {
    let connection;

    try {
      // =================================================
      // AUTHENTICATED FACULTY
      // =================================================

      const faculty = await getAuthenticatedFaculty(req, res);

      if (!faculty) {
        return;
      }

      // =================================================
      // PARAMETERS
      // =================================================

      const offeringId = toPositiveInt(req.params.offeringId);

      const enrollmentSubjectId = toPositiveInt(req.params.enrollmentSubjectId);

      if (!offeringId) {
        return res.status(400).json({
          success: false,
          message: "Invalid offering ID.",
        });
      }

      if (!enrollmentSubjectId) {
        return res.status(400).json({
          success: false,
          message: "Invalid enrollment subject ID.",
        });
      }

      // =================================================
      // CORRECTION REASON
      // =================================================

      const correctionReason =
        typeof req.body?.correction_reason === "string"
          ? req.body.correction_reason.trim()
          : "";

      if (!correctionReason) {
        return res.status(400).json({
          success: false,
          message:
            "Correction reason is required. Explain why the approved grade must be corrected.",
        });
      }

      if (correctionReason.length > 2000) {
        return res.status(400).json({
          success: false,
          message: "Correction reason must not exceed 2000 characters.",
        });
      }

      // =================================================
      // CALCULATE PROPOSED NUMERIC GRADE
      // =================================================

      let calculated;

      try {
        calculated = calculateGrade(
          {
            grading_outcome: "NUMERIC",

            midterm_grade: req.body?.midterm_grade,

            final_grade: req.body?.final_grade,
          },
          {
            requireComplete: true,
          },
        );
      } catch (error) {
        return res.status(400).json({
          success: false,

          message:
            error.message ||
            "Valid Midterm and Final Term grades are required.",
        });
      }

      // =================================================
      // PROPOSED RESULT MUST BE NUMERIC
      // =================================================

      if (
        calculated.grading_outcome !== "NUMERIC" ||
        calculated.final_rating === null ||
        calculated.final_rating === undefined
      ) {
        return res.status(400).json({
          success: false,
          message: "Grade correction must result in a complete numeric grade.",
        });
      }

      // =================================================
      // DATABASE TRANSACTION
      // =================================================

      connection = await db.getConnection();

      await connection.beginTransaction();

      // =================================================
      // LOAD OFFICIAL APPROVED GRADE
      // =================================================

      const [gradeRows] = await connection.execute(
        `
        SELECT
            g.grade_id,
            g.enrollment_subject_id,
            g.faculty_id,

            g.midterm_grade,
            g.final_grade,
            g.overall_percentage,
            g.final_rating,

            g.grading_policy,
            g.grading_outcome,
            g.outcome_reason,

            g.remarks,
            g.grade_status,

            g.submitted_at,
            g.reviewed_by,
            g.reviewed_at,
            g.review_remarks,

            es.enrollment_id,
            es.offering_id,
            es.subject_id,
            es.section_id,
            es.status AS enrollment_subject_status,

            e.student_id,
            e.enrollment_status,

            s.student_number,
            s.first_name,
            s.middle_name,
            s.last_name,

            so.faculty_id AS offering_faculty_id,
            so.status AS offering_status,

            sub.subject_code,
            sub.subject_name,

            sec.section_name

        FROM grades g

        INNER JOIN enrollment_subjects es
            ON es.enrollment_subject_id =
               g.enrollment_subject_id

        INNER JOIN enrollments e
            ON e.enrollment_id =
               es.enrollment_id

        INNER JOIN students s
            ON s.student_id =
               e.student_id

        INNER JOIN subject_offerings so
            ON so.offering_id =
               es.offering_id

        INNER JOIN subjects sub
            ON sub.subject_id =
               es.subject_id

        INNER JOIN sections sec
            ON sec.section_id =
               es.section_id

        WHERE
            g.enrollment_subject_id = ?

            AND es.offering_id = ?

            AND so.faculty_id = ?

        LIMIT 1

        FOR UPDATE
        `,
        [enrollmentSubjectId, offeringId, faculty.faculty_id],
      );

      // =================================================
      // RECORD NOT FOUND
      // =================================================

      if (gradeRows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            "Approved grade was not found or this class is not assigned to you.",
        });
      }

      const grade = gradeRows[0];

      // =================================================
      // VERIFY FACULTY OWNERSHIP
      // =================================================

      if (Number(grade.offering_faculty_id) !== Number(faculty.faculty_id)) {
        await connection.rollback();

        return res.status(403).json({
          success: false,
          message: "You are not assigned to this subject offering.",
        });
      }

      if (
        grade.faculty_id !== null &&
        Number(grade.faculty_id) !== Number(faculty.faculty_id)
      ) {
        await connection.rollback();

        return res.status(403).json({
          success: false,
          message: "This grade belongs to another Faculty assignment.",
        });
      }

      // =================================================
      // OFFERING VALIDATION
      // =================================================

      if (grade.offering_status === "Cancelled") {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "A grade correction cannot be submitted for a cancelled class.",
        });
      }

      // =================================================
      // ENROLLMENT VALIDATION
      // =================================================

      if (grade.enrollment_status !== "Approved") {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Grade correction is only allowed for an approved enrollment.",
        });
      }

      // =================================================
      // GRADE MUST ALREADY BE APPROVED
      // =================================================

      if (grade.grade_status !== "Approved") {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Only an approved grade can enter the grade correction workflow.",
        });
      }

      // =================================================
      // MODERN POLICY ONLY
      // =================================================

      if (grade.grading_policy !== "TWO_TERM_50_50") {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Legacy grades cannot use the approved numeric grade correction workflow.",
        });
      }

      // =================================================
      // MUST BE NUMERIC
      // =================================================

      if (String(grade.grading_outcome || "").toUpperCase() !== "NUMERIC") {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Only an approved numeric grade can use this correction workflow.",
        });
      }

      // =================================================
      // VALID CURRENT NUMERIC RATING
      //
      // Allowed:
      //
      // Passed: 1.00 - 3.00
      // Failed: 5.00
      //
      // 4.00 = INC
      // 6.00 = Unofficial Drop
      // =================================================

      const currentRating = Number(grade.final_rating);

      const isApprovedNumeric =
        (currentRating >= 1 && currentRating <= 3) || currentRating === 5;

      if (!isApprovedNumeric) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "The current approved grade is not eligible for numeric correction.",
        });
      }

      // =================================================
      // SUBJECT STATUS MUST MATCH CURRENT OFFICIAL GRADE
      // =================================================

      const validSubjectStatus =
        (currentRating >= 1 &&
          currentRating <= 3 &&
          grade.enrollment_subject_status === "Completed") ||
        (currentRating === 5 && grade.enrollment_subject_status === "Failed");

      if (!validSubjectStatus) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "The enrollment subject status does not match the current approved grade.",
        });
      }

      // =================================================
      // NEW GRADE MUST ACTUALLY BE DIFFERENT
      // =================================================

      const oldMidterm =
        grade.midterm_grade !== null ? Number(grade.midterm_grade) : null;

      const oldFinal =
        grade.final_grade !== null ? Number(grade.final_grade) : null;

      const oldOverall =
        grade.overall_percentage !== null
          ? Number(grade.overall_percentage)
          : null;

      const oldRating =
        grade.final_rating !== null ? Number(grade.final_rating) : null;

      const sameGrade =
        oldMidterm === calculated.midterm_grade &&
        oldFinal === calculated.final_grade &&
        oldOverall === calculated.overall_percentage &&
        oldRating === calculated.final_rating &&
        String(grade.remarks || "") === String(calculated.remarks || "");

      if (sameGrade) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            "The proposed grade is identical to the current official grade.",
        });
      }

      // =================================================
      // PREVENT DUPLICATE ACTIVE CORRECTION
      // =================================================

      const [existingRequestRows] = await connection.execute(
        `
          SELECT
              grade_change_request_id,
              status,
              requested_at

          FROM grade_change_requests

          WHERE grade_id = ?

            AND request_type =
                'GRADE_CORRECTION'

            AND status IN (
                'Pending Program Head',
                'For Registrar Processing'
            )

          ORDER BY
              grade_change_request_id DESC

          LIMIT 1

          FOR UPDATE
          `,
        [grade.grade_id],
      );

      if (existingRequestRows.length > 0) {
        const existingRequest = existingRequestRows[0];

        await connection.rollback();

        return res.status(409).json({
          success: false,

          message:
            "An active grade correction request already exists for this grade.",

          request: {
            grade_change_request_id: Number(
              existingRequest.grade_change_request_id,
            ),

            status: existingRequest.status,

            requested_at: existingRequest.requested_at,
          },
        });
      }

      // =================================================
      // CREATE CORRECTION REQUEST
      //
      // IMPORTANT:
      // Official grades row remains unchanged.
      // =================================================

      const [insertResult] = await connection.execute(
        `
          INSERT INTO grade_change_requests (
              grade_id,
              request_type,

              old_midterm_grade,
              old_final_grade,
              old_overall_percentage,
              old_final_rating,
              old_remarks,
              old_grading_outcome,
              old_outcome_reason,

              new_midterm_grade,
              new_final_grade,
              new_overall_percentage,
              new_final_rating,
              new_remarks,
              new_grading_outcome,

              completion_remarks,
              correction_reason,

              requested_by,
              requested_by_role,

              status
          )

          VALUES (
              ?,
              'GRADE_CORRECTION',

              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,

              ?,
              ?,
              ?,
              ?,
              ?,
              ?,

              NULL,
              ?,

              ?,
              'Faculty',

              'Pending Program Head'
          )
          `,
        [
          // -----------------------------------------
          // GRADE ID
          // -----------------------------------------

          grade.grade_id,

          // -----------------------------------------
          // CURRENT OFFICIAL GRADE
          // -----------------------------------------

          grade.midterm_grade,
          grade.final_grade,
          grade.overall_percentage,
          grade.final_rating,
          grade.remarks,
          grade.grading_outcome,
          grade.outcome_reason,

          // -----------------------------------------
          // PROPOSED CORRECTED GRADE
          // -----------------------------------------

          calculated.midterm_grade,
          calculated.final_grade,
          calculated.overall_percentage,
          calculated.final_rating,
          calculated.remarks,
          calculated.grading_outcome,

          // -----------------------------------------
          // CORRECTION REASON
          // -----------------------------------------

          correctionReason,

          // -----------------------------------------
          // AUTHENTICATED FACULTY USER
          // -----------------------------------------

          faculty.user_id,
        ],
      );

      const gradeChangeRequestId = Number(insertResult.insertId);

      // =================================================
      // AUDIT TRAIL
      // =================================================

      const oldValues = {
        grade_id: Number(grade.grade_id),

        grading_policy: grade.grading_policy,

        grading_outcome: grade.grading_outcome,

        midterm_grade: oldMidterm,

        final_grade: oldFinal,

        overall_percentage: oldOverall,

        final_rating: oldRating,

        remarks: grade.remarks,

        outcome_reason: grade.outcome_reason,
      };

      const newValues = {
        grade_change_request_id: gradeChangeRequestId,

        request_type: "GRADE_CORRECTION",

        grading_outcome: calculated.grading_outcome,

        midterm_grade: calculated.midterm_grade,

        final_grade: calculated.final_grade,

        overall_percentage: calculated.overall_percentage,

        final_rating: calculated.final_rating,

        remarks: calculated.remarks,

        correction_reason: correctionReason,

        status: "Pending Program Head",
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
            'grade_change_requests',
            ?,
            'INSERT',
            ?,
            ?
        )
        `,
        [
          faculty.user_id,

          gradeChangeRequestId,

          JSON.stringify(oldValues),

          JSON.stringify(newValues),
        ],
      );

      // =================================================
      // LOAD CREATED REQUEST
      // =================================================

      const [requestRows] = await connection.execute(
        `
          SELECT
              grade_change_request_id,
              grade_id,
              request_type,

              old_midterm_grade,
              old_final_grade,
              old_overall_percentage,
              old_final_rating,
              old_remarks,
              old_grading_outcome,
              old_outcome_reason,

              new_midterm_grade,
              new_final_grade,
              new_overall_percentage,
              new_final_rating,
              new_remarks,
              new_grading_outcome,

              completion_remarks,
              correction_reason,

              requested_by,
              requested_by_role,
              requested_at,

              reviewed_by,
              reviewed_at,
              review_remarks,

              processed_by,
              processed_at,
              registrar_remarks,

              status,

              created_at,
              updated_at

          FROM grade_change_requests

          WHERE grade_change_request_id = ?

          LIMIT 1
          `,
        [gradeChangeRequestId],
      );

      const createdRequest = requestRows[0];

      // =================================================
      // COMMIT
      // =================================================

      await connection.commit();

      // =================================================
      // RESPONSE
      // =================================================

      return res.status(201).json({
        success: true,

        message: "Grade correction request submitted for Program Head review.",

        student: {
          student_id: Number(grade.student_id),

          student_number: grade.student_number,

          full_name: [grade.first_name, grade.middle_name, grade.last_name]
            .filter(Boolean)
            .join(" "),
        },

        class: {
          offering_id: Number(grade.offering_id),

          subject: {
            subject_id: Number(grade.subject_id),

            subject_code: grade.subject_code,

            subject_name: grade.subject_name,
          },

          section: {
            section_id: Number(grade.section_id),

            section_name: grade.section_name,
          },
        },

        original_grade: {
          grade_id: Number(grade.grade_id),

          midterm_grade: oldMidterm,

          final_grade: oldFinal,

          overall_percentage: oldOverall,

          final_rating: oldRating,

          grading_policy: grade.grading_policy,

          grading_outcome: grade.grading_outcome,

          outcome_reason: grade.outcome_reason,

          remarks: grade.remarks,

          grade_status: grade.grade_status,
        },

        proposed_grade: {
          midterm_grade: calculated.midterm_grade,

          final_grade: calculated.final_grade,

          overall_percentage: calculated.overall_percentage,

          final_rating: calculated.final_rating,

          grading_policy: calculated.grading_policy,

          grading_outcome: calculated.grading_outcome,

          remarks: calculated.remarks,
        },

        request: {
          grade_change_request_id: Number(
            createdRequest.grade_change_request_id,
          ),

          grade_id: Number(createdRequest.grade_id),

          request_type: createdRequest.request_type,

          correction_reason: createdRequest.correction_reason,

          requested_by: Number(createdRequest.requested_by),

          requested_by_role: createdRequest.requested_by_role,

          requested_at: createdRequest.requested_at,

          status: createdRequest.status,
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
          console.error("GRADE CORRECTION ROLLBACK ERROR:", rollbackError);
        }
      }

      console.error(
        "POST /api/faculty/classes/:offeringId/grades/:enrollmentSubjectId/correction error:",
        error,
      );

      // =================================================
      // DATABASE BUSINESS RULE
      // =================================================

      if (error?.errno === 1644 || error?.sqlState === "45000") {
        return res.status(409).json({
          success: false,

          message:
            error.sqlMessage ||
            error.message ||
            "Grade correction request was rejected by the database.",
        });
      }

      // =================================================
      // FOREIGN KEY
      // =================================================

      if (error?.code === "ER_NO_REFERENCED_ROW_2") {
        return res.status(409).json({
          success: false,

          message:
            "The grade correction request references an invalid academic record.",
        });
      }

      return res.status(500).json({
        success: false,

        message: "Failed to submit grade correction request.",

        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  },
);

export default router;
