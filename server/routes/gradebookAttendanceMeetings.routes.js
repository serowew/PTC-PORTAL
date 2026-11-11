import express from "express";
import db from "../db.js";
import { loadGradebookOfferingConfig } from "../services/gradebookOfferingConfig.service.js";

const router = express.Router();
const TEST_DATABASE = "databaseforptc1_admission_test";
const TEST_OFFERING_ID = 131;

function fail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function positiveId(value) {
  const raw = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

function sendError(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
  if (status === 500) {
    console.error("GRADEBOOK ATTENDANCE MEETING ERROR:", error);
  }
  return res.status(status).json({
    success: false,
    code:
      status === 500
        ? "GRADEBOOK_INTERNAL_ERROR"
        : error.code || "GRADEBOOK_REQUEST_FAILED",
    message:
      status === 500
        ? "Could not process the gradebook attendance meeting."
        : error.message,
  });
}

function cleanOptionalText(value, name, maxLength) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    fail("INVALID_MEETING_TEXT", `${name} must be text.`, 400);
  }
  const cleaned = value.trim();
  if (!cleaned) return null;
  if (
    cleaned.length > maxLength ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(cleaned)
  ) {
    fail(
      "INVALID_MEETING_TEXT",
      `${name} must be at most ${maxLength} printable characters.`,
      400,
    );
  }
  return cleaned;
}

function meetingDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(
      "INVALID_MEETING_DATE",
      "meeting_date must be a valid YYYY-MM-DD date.",
      400,
    );
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    fail(
      "INVALID_MEETING_DATE",
      "meeting_date must be a real calendar date.",
      400,
    );
  }
  return value;
}

function meetingTime(value, name) {
  if (
    typeof value !== "string" ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)
  ) {
    fail(
      "INVALID_MEETING_TIME",
      `${name} must use 24-hour HH:MM or HH:MM:SS.`,
      400,
    );
  }
  return value.length === 5 ? `${value}:00` : value;
}

// Published academic dates are enforced only after the Registrar publishes a calendar.
// Draft or absent calendars do not restrict existing QA workflows.
async function checkPublishedCalendarMeetingDate(connection, offering, input) {
  const academicYearId = positiveId(offering.academic_year_id);
  const semesterId = positiveId(offering.semester_id);
  if (!academicYearId || !semesterId) {
    fail(
      "OFFERING_ACADEMIC_TERM_MISSING",
      "The offering must have a valid academic year and semester before attendance meetings can be created.",
    );
  }

  // Read after acquiring the offering lock. Publication also locks all offerings
  // for the academic term before committing, preventing a concurrent bypass.
  const [calendars] = await connection.execute(
    `SELECT calendar_id,
            DATE_FORMAT(midterm_start_date, '%Y-%m-%d') AS midterm_start_date,
            DATE_FORMAT(midterm_end_date, '%Y-%m-%d') AS midterm_end_date,
            DATE_FORMAT(final_start_date, '%Y-%m-%d') AS final_start_date,
            DATE_FORMAT(final_end_date, '%Y-%m-%d') AS final_end_date
       FROM academic_term_calendars
      WHERE academic_year_id = ?
        AND semester_id = ?
        AND calendar_status = 'PUBLISHED'
      LIMIT 1`,
    [academicYearId, semesterId],
  );
  if (calendars.length === 0) return;

  const calendar = calendars[0];
  const isMidterm = input.gradingTerm === "MIDTERM";
  const startDate = isMidterm
    ? calendar.midterm_start_date
    : calendar.final_start_date;
  const endDate = isMidterm
    ? calendar.midterm_end_date
    : calendar.final_end_date;

  if (input.meetingDate < startDate || input.meetingDate > endDate) {
    fail(
      "ATTENDANCE_DATE_OUTSIDE_PUBLISHED_CALENDAR",
      `${input.gradingTerm} attendance meetings must be dated between ${startDate} and ${endDate} (inclusive), per published Academic Calendar #${calendar.calendar_id}.`,
      422,
    );
  }
}

function validateCreateBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("INVALID_MEETING_INPUT", "A JSON request object is required.", 400);
  }
  const allowed = new Set([
    "grading_term",
    "meeting_date",
    "session_type",
    "start_time",
    "end_time",
    "meeting_notes",
    "dry_run",
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    fail(
      "UNSUPPORTED_MEETING_FIELD",
      "Meeting creation allows only term, date, session type, time, notes, and dry_run. Use dedicated actions for cancellation or rescheduling.",
      400,
    );
  }
  if (!["MIDTERM", "FINAL_TERM"].includes(body.grading_term)) {
    fail(
      "INVALID_GRADING_TERM",
      "grading_term must be MIDTERM or FINAL_TERM.",
      400,
    );
  }
  if (!["LECTURE", "LABORATORY", "COMBINED"].includes(body.session_type)) {
    fail(
      "INVALID_SESSION_TYPE",
      "session_type must be LECTURE, LABORATORY, or COMBINED.",
      400,
    );
  }
  if (typeof body.dry_run !== "boolean") {
    fail(
      "DRY_RUN_REQUIRED",
      "Specify dry_run: true to test, or false to save.",
      400,
    );
  }
  const startTime = meetingTime(body.start_time, "start_time");
  const endTime = meetingTime(body.end_time, "end_time");
  if (endTime <= startTime) {
    fail(
      "INVALID_MEETING_TIME_RANGE",
      "end_time must be later than start_time on the same day.",
      400,
    );
  }
  return {
    gradingTerm: body.grading_term,
    meetingDate: meetingDate(body.meeting_date),
    sessionType: body.session_type,
    startTime,
    endTime,
    meetingNotes: cleanOptionalText(body.meeting_notes, "meeting_notes", 2000),
    dryRun: body.dry_run,
  };
}

// After a term's first submission, its shared meeting structure stays locked.
// The legacy combined-submission lock still blocks both grading terms.
// Caller must already hold the offering and gradebook configuration row locks.
async function assertMeetingTermStructureEditable(
  connection,
  configId,
  offeringId,
  gradingTerm,
) {
  if (!["MIDTERM", "FINAL_TERM"].includes(gradingTerm)) {
    fail(
      "INVALID_GRADING_TERM",
      "The meeting has an invalid grading term.",
      409,
    );
  }

  const [legacyLocks] = await connection.execute(
    "SELECT 1 FROM gradebook_structure_locks WHERE config_id = ? LIMIT 1",
    [configId],
  );
  if (legacyLocks.length) {
    fail(
      "GRADEBOOK_STRUCTURE_LOCKED",
      "Attendance meeting structure is locked after a legacy grade submission.",
    );
  }
  const [legacyAttempts] = await connection.execute(
    `SELECT 1
       FROM gradebook_grade_submission_attempts sa
       JOIN grades g ON g.grade_id = sa.grade_id
       JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
      WHERE es.offering_id = ? LIMIT 1`,
    [offeringId],
  );
  if (legacyAttempts.length) {
    fail(
      "GRADEBOOK_SUBMISSION_ALREADY_STARTED",
      "Legacy submission history exists; attendance meeting structure cannot change.",
    );
  }

  const [termLocks] = await connection.execute(
    `SELECT 1 FROM gradebook_term_structure_locks
      WHERE config_id = ? AND grading_term = ? LIMIT 1`,
    [configId, gradingTerm],
  );
  if (termLocks.length) {
    fail(
      "GRADEBOOK_TERM_STRUCTURE_LOCKED",
      `${gradingTerm} attendance meeting structure is locked after the first term submission.`,
    );
  }

  // A submission also blocks structure edits if its lock row is missing.
  const [termAttempts] = await connection.execute(
    `SELECT 1 FROM gradebook_term_submission_attempts
      WHERE config_id = ? AND grading_term = ? LIMIT 1`,
    [configId, gradingTerm],
  );
  if (termAttempts.length) {
    fail(
      "GRADEBOOK_TERM_SUBMISSION_ALREADY_STARTED",
      `${gradingTerm} submission history exists; attendance meeting structure cannot change.`,
    );
  }
}

// GET /api/gradebook/:offeringId/attendance/meetings
// Read-only schedule, including meetings with no student attendance entries yet.
router.get("/:offeringId/attendance/meetings", async (req, res) => {
  const offeringId = positiveId(req.params.offeringId);
  if (!offeringId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_OFFERING_ID",
      message: "offeringId must be a positive integer.",
    });
  }
  const actorUserId = positiveId(req.user?.user_id);
  if (!actorUserId) {
    return res.status(401).json({
      success: false,
      code: "AUTHENTICATION_REQUIRED",
      message: "An authenticated instructor is required.",
    });
  }

  try {
    const [offerings] = await db.execute(
      `SELECT so.offering_id, f.user_id AS assigned_user_id,
              u.is_active, u.is_archived, r.role_name
         FROM subject_offerings so
         LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
         LEFT JOIN users u ON u.user_id = f.user_id
         LEFT JOIN roles r ON r.role_id = u.role_id
        WHERE so.offering_id = ?`,
      [offeringId],
    );
    if (offerings.length !== 1) {
      fail("OFFERING_NOT_FOUND", "Subject offering was not found.", 404);
    }
    const offering = offerings[0];
    if (
      Number(offering.assigned_user_id) !== actorUserId ||
      Number(offering.is_active) !== 1 ||
      Number(offering.is_archived) !== 0 ||
      !["Faculty", "Program Head"].includes(offering.role_name)
    ) {
      fail(
        "GRADEBOOK_INSTRUCTOR_REQUIRED",
        "Only the active assigned instructor can view attendance meetings.",
        403,
      );
    }

    const config = await loadGradebookOfferingConfig(db, offeringId);
    if (!config.is_initialized) {
      fail(
        "GRADEBOOK_NOT_INITIALIZED",
        "This offering has no initialized gradebook.",
      );
    }

    const [legacyLocks] = await db.execute(
      "SELECT 1 FROM gradebook_structure_locks WHERE config_id = ? LIMIT 1",
      [config.config_id],
    );
    const [legacyAttempts] = await db.execute(
      `SELECT 1
         FROM gradebook_grade_submission_attempts sa
         JOIN grades g ON g.grade_id = sa.grade_id
         JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
        WHERE es.offering_id = ? LIMIT 1`,
      [offeringId],
    );
    const legacyLocked = legacyLocks.length > 0 || legacyAttempts.length > 0;

    const [termLocks] = await db.execute(
      "SELECT grading_term FROM gradebook_term_structure_locks WHERE config_id = ?",
      [config.config_id],
    );
    const [termAttempts] = await db.execute(
      "SELECT DISTINCT grading_term FROM gradebook_term_submission_attempts WHERE config_id = ?",
      [config.config_id],
    );
    const lockedTermSet = new Set([
      ...termLocks.map((lock) => lock.grading_term),
      ...termAttempts.map((attempt) => attempt.grading_term),
    ]);
    const termStructureLocked = {
      MIDTERM: legacyLocked || lockedTermSet.has("MIDTERM"),
      FINAL_TERM: legacyLocked || lockedTermSet.has("FINAL_TERM"),
    };
    const structureLocked =
      termStructureLocked.MIDTERM || termStructureLocked.FINAL_TERM;

    const [meetings] = await db.execute(
      `SELECT m.meeting_id, m.config_id, m.grading_term,
              DATE_FORMAT(m.meeting_date, '%Y-%m-%d') AS meeting_date,
              m.session_type,
              TIME_FORMAT(m.start_time, '%H:%i:%s') AS start_time,
              TIME_FORMAT(m.end_time, '%H:%i:%s') AS end_time,
              m.meeting_status, m.replacement_for_meeting_id,
              m.cancellation_reason, m.meeting_notes,
              m.record_version, m.created_by_user_id, m.updated_by_user_id,
              m.created_at, m.updated_at,
              (SELECT COUNT(*) FROM gradebook_attendance_entries ae
                WHERE ae.meeting_id = m.meeting_id) AS attendance_entry_count
         FROM gradebook_attendance_meetings m
        WHERE m.config_id = ?
        ORDER BY CASE m.grading_term WHEN 'MIDTERM' THEN 0 ELSE 1 END,
                 m.meeting_date, m.start_time, m.meeting_id`,
      [config.config_id],
    );

    const terms = {
      MIDTERM: {
        meetings: [],
        structure_locked: termStructureLocked.MIDTERM,
        can_edit_structure:
          !termStructureLocked.MIDTERM && config.offering_status === "Open",
      },
      FINAL_TERM: {
        meetings: [],
        structure_locked: termStructureLocked.FINAL_TERM,
        can_edit_structure:
          !termStructureLocked.FINAL_TERM && config.offering_status === "Open",
      },
    };
    for (const meeting of meetings) {
      if (!terms[meeting.grading_term]) {
        fail(
          "INVALID_MEETING_DATA",
          "Unknown grading term in meeting records.",
        );
      }
      terms[meeting.grading_term].meetings.push({
        meeting_id: Number(meeting.meeting_id),
        config_id: Number(meeting.config_id),
        meeting_date: meeting.meeting_date,
        session_type: meeting.session_type,
        start_time: meeting.start_time,
        end_time: meeting.end_time,
        meeting_status: meeting.meeting_status,
        replacement_for_meeting_id:
          meeting.replacement_for_meeting_id === null
            ? null
            : Number(meeting.replacement_for_meeting_id),
        cancellation_reason: meeting.cancellation_reason,
        meeting_notes: meeting.meeting_notes,
        record_version: Number(meeting.record_version),
        created_by_user_id:
          meeting.created_by_user_id === null
            ? null
            : Number(meeting.created_by_user_id),
        updated_by_user_id:
          meeting.updated_by_user_id === null
            ? null
            : Number(meeting.updated_by_user_id),
        created_at: meeting.created_at,
        updated_at: meeting.updated_at,
        attendance_entry_count: Number(meeting.attendance_entry_count),
      });
    }
    return res.json({
      success: true,
      offering_id: offeringId,
      config_id: Number(config.config_id),
      subject_code: config.subject_code,
      subject_name: config.subject_name,
      grading_classification: config.grading_classification,
      grading_policy: config.grading_policy,
      policy_version: config.policy_version,
      offering_status: config.offering_status,
      // Kept for existing clients; use term_structure_locked for per-term controls.
      structure_locked: structureLocked,
      term_structure_locked: termStructureLocked,
      meeting_count: meetings.length,
      terms,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

// POST /api/gradebook/:offeringId/attendance/meetings
// Create one SCHEDULED meeting with a CREATED audit event in a single transaction.
router.post("/:offeringId/attendance/meetings", async (req, res) => {
  const offeringId = positiveId(req.params.offeringId);
  if (!offeringId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_OFFERING_ID",
      message: "offeringId must be a positive integer.",
    });
  }

  let input;
  try {
    input = validateCreateBody(req.body);
  } catch (error) {
    return sendError(res, error);
  }
  const actorUserId = positiveId(req.user?.user_id);
  if (!actorUserId) {
    return res.status(401).json({
      success: false,
      code: "AUTHENTICATION_REQUIRED",
      message: "An authenticated instructor is required.",
    });
  }
  // First rollout is deliberately isolated to the verified admission-test offering.
  if (offeringId !== TEST_OFFERING_ID) {
    return res.status(403).json({
      success: false,
      code: "TEST_OFFERING_ONLY",
      message:
        "Attendance meeting creation is currently limited to Offering #131.",
    });
  }

  let connection;
  let transactionStarted = false;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const [databaseRows] = await connection.execute(
      "SELECT DATABASE() AS database_name",
    );
    if (databaseRows[0]?.database_name !== TEST_DATABASE) {
      fail(
        "TEST_DATABASE_ONLY",
        "Attendance meeting creation is disabled outside the admission-test database.",
        403,
      );
    }

    // Lock the offering first, matching gradebook assessment and score writes.
    const [offerings] = await connection.execute(
      `SELECT so.offering_id, so.status, so.academic_year_id, so.semester_id,
              f.user_id AS assigned_user_id,
              u.is_active, u.is_archived, r.role_name
         FROM subject_offerings so
         LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
         LEFT JOIN users u ON u.user_id = f.user_id
         LEFT JOIN roles r ON r.role_id = u.role_id
        WHERE so.offering_id = ? FOR UPDATE`,
      [offeringId],
    );
    if (offerings.length !== 1) {
      fail("OFFERING_NOT_FOUND", "Subject offering was not found.", 404);
    }
    const offering = offerings[0];
    if (
      Number(offering.assigned_user_id) !== actorUserId ||
      Number(offering.is_active) !== 1 ||
      Number(offering.is_archived) !== 0 ||
      !["Faculty", "Program Head"].includes(offering.role_name)
    ) {
      fail(
        "GRADEBOOK_INSTRUCTOR_REQUIRED",
        "Only the active assigned instructor can create attendance meetings.",
        403,
      );
    }
    if (offering.status !== "Open") {
      fail(
        "OFFERING_NOT_OPEN",
        "Attendance meeting creation requires an Open offering.",
      );
    }

    const [configRows] = await connection.execute(
      "SELECT config_id FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE",
      [offeringId],
    );
    if (configRows.length !== 1) {
      fail(
        "GRADEBOOK_NOT_INITIALIZED",
        "This offering has no initialized gradebook.",
      );
    }
    const configId = Number(configRows[0].config_id);
    const config = await loadGradebookOfferingConfig(connection, offeringId);
    if (!config.is_initialized || Number(config.config_id) !== configId) {
      fail(
        "GRADEBOOK_CONFIG_INVALID",
        "The official gradebook configuration failed validation.",
      );
    }
    if (
      config.grading_classification === "PURE_LECTURE" &&
      input.sessionType !== "LECTURE"
    ) {
      fail(
        "SESSION_TYPE_NOT_ALLOWED",
        "Pure Lecture subjects accept LECTURE attendance sessions only.",
        422,
      );
    }

    // Enforce an official Registrar calendar only when it is PUBLISHED.
    // The offering lock stays held through this check and the INSERT/commit.
    await checkPublishedCalendarMeetingDate(connection, offering, input);

    await assertMeetingTermStructureEditable(
      connection,
      configId,
      offeringId,
      input.gradingTerm,
    );

    // Prevent duplicate or overlapping active meetings for the same offering and day.
    // The offering row lock serializes concurrent meeting creation calls.
    const [conflicts] = await connection.execute(
      `SELECT meeting_id
         FROM gradebook_attendance_meetings
        WHERE config_id = ? AND meeting_date = ?
          AND meeting_status <> 'CANCELLED'
          AND start_time < ? AND end_time > ?
        LIMIT 1`,
      [configId, input.meetingDate, input.endTime, input.startTime],
    );
    if (conflicts.length) {
      fail(
        "ATTENDANCE_MEETING_TIME_CONFLICT",
        "A non-cancelled meeting already overlaps this time in the offering.",
      );
    }

    const [insert] = await connection.execute(
      `INSERT INTO gradebook_attendance_meetings
         (config_id, grading_term, meeting_date, session_type,
          start_time, end_time, meeting_status,
          replacement_for_meeting_id, cancellation_reason, meeting_notes,
          record_version, created_by_user_id, updated_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, 'SCHEDULED', NULL, NULL, ?, 1, ?, ?)`,
      [
        configId,
        input.gradingTerm,
        input.meetingDate,
        input.sessionType,
        input.startTime,
        input.endTime,
        input.meetingNotes,
        actorUserId,
        actorUserId,
      ],
    );
    const meetingId = Number(insert.insertId);
    if (!positiveId(meetingId)) {
      throw new Error("Attendance meeting INSERT returned no valid ID.");
    }

    // Previous-state audit fields stay NULL for a CREATED event.
    const [audit] = await connection.execute(
      `INSERT INTO gradebook_attendance_meeting_events
         (meeting_id, event_type, change_context,
          new_grading_term, new_meeting_date, new_session_type,
          new_start_time, new_end_time, new_meeting_status,
          new_replacement_for_meeting_id, new_cancellation_reason,
          new_meeting_notes, change_reason, changed_by_user_id,
          meeting_version_after)
       VALUES (?, 'CREATED', 'DRAFT_STRUCTURE',
               ?, ?, ?, ?, ?, 'SCHEDULED',
               NULL, NULL, ?, NULL, ?, 1)`,
      [
        meetingId,
        input.gradingTerm,
        input.meetingDate,
        input.sessionType,
        input.startTime,
        input.endTime,
        input.meetingNotes,
        actorUserId,
      ],
    );
    if (Number(audit.affectedRows) !== 1) {
      throw new Error("Attendance meeting audit event was not saved.");
    }

    const response = {
      success: true,
      offering_id: offeringId,
      config_id: configId,
      meeting: {
        meeting_id: meetingId,
        grading_term: input.gradingTerm,
        meeting_date: input.meetingDate,
        session_type: input.sessionType,
        start_time: input.startTime,
        end_time: input.endTime,
        meeting_status: "SCHEDULED",
        replacement_for_meeting_id: null,
        cancellation_reason: null,
        meeting_notes: input.meetingNotes,
        record_version: 1,
      },
      audit_event: "CREATED",
      dry_run: input.dryRun,
      persisted: !input.dryRun,
    };

    if (input.dryRun) {
      await connection.rollback();
    } else {
      await connection.commit();
    }
    transactionStarted = false;
    return res.status(input.dryRun ? 200 : 201).json(response);
  } catch (error) {
    if (transactionStarted && connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "GRADEBOOK ATTENDANCE MEETING ROLLBACK ERROR:",
          rollbackError,
        );
      }
    }
    return sendError(res, error);
  } finally {
    connection?.release();
  }
});

// POST /api/gradebook/:offeringId/attendance/meetings/:meetingId/mark-held
// Record that a completed meeting took place, without changing its schedule.
router.post(
  "/:offeringId/attendance/meetings/:meetingId/mark-held",
  async (req, res) => {
    const offeringId = positiveId(req.params.offeringId);
    const meetingId = positiveId(req.params.meetingId);
    if (!offeringId || !meetingId) {
      return res.status(400).json({
        success: false,
        code: "INVALID_MEETING_ID",
        message: "offeringId and meetingId must be positive integers.",
      });
    }

    let input;
    try {
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        fail(
          "INVALID_MEETING_INPUT",
          "A JSON request object is required.",
          400,
        );
      }
      const allowed = new Set(["record_version", "change_reason", "dry_run"]);
      if (Object.keys(body).some((key) => !allowed.has(key))) {
        fail(
          "UNSUPPORTED_MEETING_FIELD",
          "Marking a meeting HELD accepts only record_version, change_reason, and dry_run.",
          400,
        );
      }
      const recordVersion = positiveId(body.record_version);
      if (!recordVersion) {
        fail(
          "INVALID_RECORD_VERSION",
          "A positive record_version is required.",
          400,
        );
      }
      if (typeof body.dry_run !== "boolean") {
        fail(
          "DRY_RUN_REQUIRED",
          "Specify dry_run: true to test, or false to save.",
          400,
        );
      }
      const changeReason = cleanOptionalText(
        body.change_reason,
        "change_reason",
        1000,
      );
      if (!changeReason || changeReason.length < 5) {
        fail(
          "MEETING_CHANGE_REASON_REQUIRED",
          "Provide a documented change_reason of at least 5 characters.",
          400,
        );
      }
      input = { recordVersion, changeReason, dryRun: body.dry_run };
    } catch (error) {
      return sendError(res, error);
    }

    const actorUserId = positiveId(req.user?.user_id);
    if (!actorUserId) {
      return res.status(401).json({
        success: false,
        code: "AUTHENTICATION_REQUIRED",
        message: "An authenticated instructor is required.",
      });
    }
    if (offeringId !== TEST_OFFERING_ID) {
      return res.status(403).json({
        success: false,
        code: "TEST_OFFERING_ONLY",
        message:
          "Attendance meeting updates are currently limited to Offering #131.",
      });
    }

    let connection;
    let transactionStarted = false;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;

      const [databaseRows] = await connection.execute(
        "SELECT DATABASE() AS database_name",
      );
      if (databaseRows[0]?.database_name !== TEST_DATABASE) {
        fail(
          "TEST_DATABASE_ONLY",
          "Attendance meeting updates are disabled outside the admission-test database.",
          403,
        );
      }

      // Keep the offering -> config -> meeting lock order used for meeting creation.
      const [offerings] = await connection.execute(
        `SELECT so.offering_id, so.status, f.user_id AS assigned_user_id,
              u.is_active, u.is_archived, r.role_name
         FROM subject_offerings so
         LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
         LEFT JOIN users u ON u.user_id = f.user_id
         LEFT JOIN roles r ON r.role_id = u.role_id
        WHERE so.offering_id = ? FOR UPDATE`,
        [offeringId],
      );
      if (offerings.length !== 1) {
        fail("OFFERING_NOT_FOUND", "Subject offering was not found.", 404);
      }
      const offering = offerings[0];
      if (
        Number(offering.assigned_user_id) !== actorUserId ||
        Number(offering.is_active) !== 1 ||
        Number(offering.is_archived) !== 0 ||
        !["Faculty", "Program Head"].includes(offering.role_name)
      ) {
        fail(
          "GRADEBOOK_INSTRUCTOR_REQUIRED",
          "Only the active assigned instructor can mark attendance meetings held.",
          403,
        );
      }
      if (offering.status !== "Open") {
        fail(
          "OFFERING_NOT_OPEN",
          "Marking a meeting held requires an Open offering.",
        );
      }

      const [configRows] = await connection.execute(
        "SELECT config_id FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE",
        [offeringId],
      );
      if (configRows.length !== 1) {
        fail(
          "GRADEBOOK_NOT_INITIALIZED",
          "This offering has no initialized gradebook.",
        );
      }
      const configId = Number(configRows[0].config_id);
      const config = await loadGradebookOfferingConfig(connection, offeringId);
      if (!config.is_initialized || Number(config.config_id) !== configId) {
        fail(
          "GRADEBOOK_CONFIG_INVALID",
          "The official gradebook configuration failed validation.",
        );
      }

      const [meetings] = await connection.execute(
        `SELECT meeting_id, config_id, grading_term,
              DATE_FORMAT(meeting_date, '%Y-%m-%d') AS meeting_date,
              session_type,
              TIME_FORMAT(start_time, '%H:%i:%s') AS start_time,
              TIME_FORMAT(end_time, '%H:%i:%s') AS end_time,
              meeting_status, replacement_for_meeting_id,
              cancellation_reason, meeting_notes, record_version
         FROM gradebook_attendance_meetings
        WHERE meeting_id = ? AND config_id = ? FOR UPDATE`,
        [meetingId, configId],
      );
      if (meetings.length !== 1) {
        fail(
          "ATTENDANCE_MEETING_NOT_FOUND",
          "Attendance meeting does not belong to this offering.",
          404,
        );
      }
      const meeting = meetings[0];
      const currentVersion = Number(meeting.record_version);
      if (currentVersion !== input.recordVersion) {
        fail(
          "MEETING_VERSION_CONFLICT",
          "This attendance meeting has changed. Reload its latest version before saving.",
        );
      }
      if (meeting.meeting_status !== "SCHEDULED") {
        fail(
          "MEETING_NOT_SCHEDULED",
          "Only a SCHEDULED meeting can be marked HELD.",
        );
      }

      // HELD changes the term's attendance denominator and must respect its lock.
      await assertMeetingTermStructureEditable(
        connection,
        configId,
        offeringId,
        meeting.grading_term,
      );

      // Class dates/times are in Philippine local time (Asia/Manila, UTC+08:00).
      const manilaNow = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
      const localDate = manilaNow.slice(0, 10);
      const localTime = manilaNow.slice(11, 19);
      if (
        meeting.meeting_date > localDate ||
        (meeting.meeting_date === localDate && meeting.end_time > localTime)
      ) {
        fail(
          "MEETING_NOT_FINISHED",
          "A scheduled meeting cannot be marked HELD before its end time in Philippine local time.",
        );
      }

      const nextVersion = currentVersion + 1;
      const [update] = await connection.execute(
        `UPDATE gradebook_attendance_meetings
          SET meeting_status = 'HELD', record_version = ?, updated_by_user_id = ?
        WHERE meeting_id = ? AND config_id = ?
          AND meeting_status = 'SCHEDULED' AND record_version = ?`,
        [nextVersion, actorUserId, meetingId, configId, currentVersion],
      );
      if (Number(update.affectedRows) !== 1) {
        fail(
          "MEETING_VERSION_CONFLICT",
          "Attendance meeting changed during this request. Reload it before saving.",
        );
      }

      const [audit] = await connection.execute(
        `INSERT INTO gradebook_attendance_meeting_events
         (meeting_id, event_type, change_context,
          previous_grading_term, previous_meeting_date, previous_session_type,
          previous_start_time, previous_end_time, previous_meeting_status,
          previous_replacement_for_meeting_id, previous_cancellation_reason,
          previous_meeting_notes,
          new_grading_term, new_meeting_date, new_session_type,
          new_start_time, new_end_time, new_meeting_status,
          new_replacement_for_meeting_id, new_cancellation_reason,
          new_meeting_notes, change_reason, changed_by_user_id,
          meeting_version_after)
       VALUES (?, 'MARKED_HELD', 'DRAFT_STRUCTURE',
               ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, 'HELD', ?, ?, ?, ?, ?, ?)`,
        [
          meetingId,
          meeting.grading_term,
          meeting.meeting_date,
          meeting.session_type,
          meeting.start_time,
          meeting.end_time,
          meeting.meeting_status,
          meeting.replacement_for_meeting_id,
          meeting.cancellation_reason,
          meeting.meeting_notes,
          meeting.grading_term,
          meeting.meeting_date,
          meeting.session_type,
          meeting.start_time,
          meeting.end_time,
          meeting.replacement_for_meeting_id,
          meeting.cancellation_reason,
          meeting.meeting_notes,
          input.changeReason,
          actorUserId,
          nextVersion,
        ],
      );
      if (Number(audit.affectedRows) !== 1) {
        throw new Error("Attendance meeting status audit event was not saved.");
      }

      const response = {
        success: true,
        offering_id: offeringId,
        config_id: configId,
        meeting: {
          meeting_id: meetingId,
          grading_term: meeting.grading_term,
          meeting_date: meeting.meeting_date,
          session_type: meeting.session_type,
          start_time: meeting.start_time,
          end_time: meeting.end_time,
          meeting_status: "HELD",
          replacement_for_meeting_id: meeting.replacement_for_meeting_id,
          cancellation_reason: meeting.cancellation_reason,
          meeting_notes: meeting.meeting_notes,
          record_version: nextVersion,
        },
        previous: {
          meeting_status: meeting.meeting_status,
          record_version: currentVersion,
        },
        audit_event: "MARKED_HELD",
        dry_run: input.dryRun,
        persisted: !input.dryRun,
      };

      if (input.dryRun) {
        await connection.rollback();
      } else {
        await connection.commit();
      }
      transactionStarted = false;
      return res.status(200).json(response);
    } catch (error) {
      if (transactionStarted && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error(
            "GRADEBOOK ATTENDANCE MEETING ROLLBACK ERROR:",
            rollbackError,
          );
        }
      }
      return sendError(res, error);
    } finally {
      connection?.release();
    }
  },
);

export default router;
