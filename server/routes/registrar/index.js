import express from "express";
import db from "../../db.js";
// Academic Calendar options for the whole system here!! below
import studentRecordsRoutes from "./studentrecords.js";
import corRoutes from "./cor.js";
import enrollmentRoutes from "./enrollments.js";
import curriculumRoutes from "./curriculums.js";
import subjectRoutes from "./subjects.js";
import courseRoutes from "./courses.js";
import departmentRoutes from "./departments.js";
import offeringsRoutes from "./offerings.js";
import offeringBatchesRoutes from "./offeringBatches.js";
import transferevaluationRoutes from "./transferEvaluations.js";
import documentRequestsRoutes from "./documentRequests.js";
import gradeChangeRequestRoutes from "./gradeChangeRequests.js";
import financeHistoryRoutes from "./financehistory.js";
import academicYearsRoutes from "./academicYears.js";
import incCompletionConversionReadinessRouter from "./incCompletionConversionReadiness.routes.js";
import { assertQaGradingDatabase } from "../../services/gradebookQaWriteGuard.service.js";
import { validateOfficialSheetSpecialEvidence } from "../../services/gradebookOfficialSheetSpecialEvidence.service.js";

const router = express.Router();

router.use("/students", corRoutes);
router.use("/students", studentRecordsRoutes);
router.use("/enrollments", enrollmentRoutes);
router.use("/curriculums", curriculumRoutes);
router.use("/subjects", subjectRoutes);
router.use("/courses", courseRoutes);
router.use("/departments", departmentRoutes);
router.use("/offerings", offeringsRoutes);
router.use("/offering-batches", offeringBatchesRoutes);
router.use("/transfer-evaluations", transferevaluationRoutes);
router.use("/document-requests", documentRequestsRoutes);
router.use("/grade-change-requests", gradeChangeRequestRoutes);
router.use("/finance-history", financeHistoryRoutes);
router.use("/academic-years", academicYearsRoutes);
router.use(
  "/gradebook/inc-completion-conversions",
  incCompletionConversionReadinessRouter,
);

// Academic Calendar options
router.get("/academic-calendar/options", async (_req, res) => {
  try {
    const [[academicYearRows], [semesterRows]] = await Promise.all([
      db.execute(`
        SELECT academic_year_id, academic_year, is_current
        FROM academic_years
        ORDER BY academic_year DESC, academic_year_id DESC
      `),
      db.execute(`
        SELECT semester_id, semester_name
        FROM semesters
        ORDER BY semester_id ASC
      `),
    ]);

    return res.status(200).json({
      success: true,
      academic_years: academicYearRows.map((row) => ({
        academic_year_id: Number(row.academic_year_id),
        academic_year: row.academic_year,
        is_current: Number(row.is_current) === 1,
      })),
      semesters: semesterRows.map((row) => ({
        semester_id: Number(row.semester_id),
        semester_name: row.semester_name,
      })),
    });
  } catch (error) {
    console.error("REGISTRAR ACADEMIC CALENDAR OPTIONS ERROR:", error);
    return res.status(500).json({
      success: false,
      code: "ACADEMIC_CALENDAR_READ_FAILED",
      message: "Failed to load academic calendar options.",
    });
  }
});

// Read-only calendar listing
router.get("/academic-calendar", async (req, res) => {
  function readId(value) {
    if (value === undefined) return null;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
      return false;
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : false;
  }

  const academicYearId = readId(req.query.academic_year_id);
  const semesterId = readId(req.query.semester_id);

  if (academicYearId === false || semesterId === false) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_FILTER",
      message: "academic_year_id and semester_id must be positive integers.",
    });
  }

  try {
    const conditions = [];
    const params = [];

    if (academicYearId !== null) {
      conditions.push("c.academic_year_id = ?");
      params.push(academicYearId);
    }

    if (semesterId !== null) {
      conditions.push("c.semester_id = ?");
      params.push(semesterId);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const [rows] = await db.execute(
      `
      SELECT
        c.calendar_id,
        c.academic_year_id,
        ay.academic_year,
        c.semester_id,
        s.semester_name,
        DATE_FORMAT(c.midterm_start_date, '%Y-%m-%d') AS midterm_start_date,
        DATE_FORMAT(c.midterm_end_date, '%Y-%m-%d') AS midterm_end_date,
        DATE_FORMAT(c.final_start_date, '%Y-%m-%d') AS final_start_date,
        DATE_FORMAT(c.final_end_date, '%Y-%m-%d') AS final_end_date,
        c.calendar_status,
        c.record_version,
        c.created_by_user_id,
        c.updated_by_user_id,
        c.published_by_user_id,
        c.published_at,
        c.created_at,
        c.updated_at
      FROM academic_term_calendars c
      INNER JOIN academic_years ay
        ON ay.academic_year_id = c.academic_year_id
      INNER JOIN semesters s
        ON s.semester_id = c.semester_id
      ${whereClause}
      ORDER BY ay.academic_year DESC, s.semester_id ASC
    `,
      params,
    );

    return res.status(200).json({
      success: true,
      count: rows.length,
      calendars: rows.map((row) => ({
        ...row,
        calendar_id: Number(row.calendar_id),
        academic_year_id: Number(row.academic_year_id),
        semester_id: Number(row.semester_id),
        record_version: Number(row.record_version),
        created_by_user_id: Number(row.created_by_user_id),
        updated_by_user_id:
          row.updated_by_user_id == null
            ? null
            : Number(row.updated_by_user_id),
        published_by_user_id:
          row.published_by_user_id == null
            ? null
            : Number(row.published_by_user_id),
      })),
    });
  } catch (error) {
    console.error("REGISTRAR ACADEMIC CALENDAR LIST ERROR:", error);
    return res.status(500).json({
      success: false,
      code: "ACADEMIC_CALENDAR_READ_FAILED",
      message: "Failed to load academic calendars.",
    });
  }
});

// Create a Draft Academic Calendar
function readCalendarId(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const numberValue = Number(value);
    return Number.isSafeInteger(numberValue) ? numberValue : null;
  }

  return null;
}

function readCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > 2199) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value ? value : null;
}

router.post("/academic-calendar", async (req, res) => {
  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({
      success: false,
      code: "INVALID_CALENDAR_BODY",
      message: "Send a JSON object containing the academic calendar dates.",
    });
  }

  const actorId = readCalendarId(req.user?.user_id);
  if (!actorId) {
    return res.status(401).json({
      success: false,
      code: "ACADEMIC_CALENDAR_ACTOR_REQUIRED",
      message: "An authenticated Registrar is required.",
    });
  }

  const academicYearId = readCalendarId(body.academic_year_id);
  const semesterId = readCalendarId(body.semester_id);
  if (!academicYearId || !semesterId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_REFERENCE",
      message: "academic_year_id and semester_id must be positive integers.",
    });
  }

  const midtermStartDate = readCalendarDate(body.midterm_start_date);
  const midtermEndDate = readCalendarDate(body.midterm_end_date);
  const finalStartDate = readCalendarDate(body.final_start_date);
  const finalEndDate = readCalendarDate(body.final_end_date);

  if (
    !midtermStartDate ||
    !midtermEndDate ||
    !finalStartDate ||
    !finalEndDate
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_DATE",
      message: "All four calendar dates must be valid YYYY-MM-DD dates.",
    });
  }

  if (
    !(
      midtermStartDate <= midtermEndDate &&
      midtermEndDate < finalStartDate &&
      finalStartDate <= finalEndDate
    )
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_DATE_ORDER",
      message:
        "Midterm must start before it ends, and Final Term must start after Midterm ends and finish on or after its start date.",
    });
  }

  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_DRY_RUN",
      message: "dry_run must be true or false.",
    });
  }

  if (body.change_reason != null && typeof body.change_reason !== "string") {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_REASON",
      message: "change_reason must be a string when provided.",
    });
  }

  const changeReason =
    body.change_reason?.trim() || "Created an academic calendar draft.";
  if (changeReason.length > 500) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_REASON",
      message: "change_reason must not exceed 500 characters.",
    });
  }

  const dryRun = body.dry_run === true;
  let connection;
  let inTransaction = false;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    inTransaction = true;

    const [[academicYear], [semester]] = await Promise.all([
      connection.execute(
        "SELECT academic_year_id, academic_year FROM academic_years WHERE academic_year_id = ? LIMIT 1",
        [academicYearId],
      ),
      connection.execute(
        "SELECT semester_id, semester_name FROM semesters WHERE semester_id = ? LIMIT 1",
        [semesterId],
      ),
    ]);

    if (academicYear.length === 0 || semester.length === 0) {
      await connection.rollback();
      inTransaction = false;
      return res.status(404).json({
        success: false,
        code: "ACADEMIC_CALENDAR_REFERENCE_NOT_FOUND",
        message: "The selected academic year or semester does not exist.",
      });
    }

    const [existingRows] = await connection.execute(
      `SELECT calendar_id
       FROM academic_term_calendars
       WHERE academic_year_id = ? AND semester_id = ?
       LIMIT 1 FOR UPDATE`,
      [academicYearId, semesterId],
    );

    if (existingRows.length > 0) {
      await connection.rollback();
      inTransaction = false;
      return res.status(409).json({
        success: false,
        code: "ACADEMIC_CALENDAR_ALREADY_EXISTS",
        message:
          "An academic calendar already exists for this academic year and semester.",
        calendar_id: Number(existingRows[0].calendar_id),
      });
    }

    const [insertResult] = await connection.execute(
      `INSERT INTO academic_term_calendars (
        academic_year_id, semester_id,
        midterm_start_date, midterm_end_date,
        final_start_date, final_end_date,
        calendar_status, record_version, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', 1, ?)`,
      [
        academicYearId,
        semesterId,
        midtermStartDate,
        midtermEndDate,
        finalStartDate,
        finalEndDate,
        actorId,
      ],
    );

    const calendarId = Number(insertResult.insertId);

    const [eventResult] = await connection.execute(
      `INSERT INTO academic_term_calendar_events (
        calendar_id, event_type,
        new_midterm_start_date, new_midterm_end_date,
        new_final_start_date, new_final_end_date,
        new_calendar_status, calendar_version_after,
        change_reason, changed_by_user_id
      ) VALUES (?, 'CREATED', ?, ?, ?, ?, 'DRAFT', 1, ?, ?)`,
      [
        calendarId,
        midtermStartDate,
        midtermEndDate,
        finalStartDate,
        finalEndDate,
        changeReason,
        actorId,
      ],
    );

    if (dryRun) {
      await connection.rollback();
    } else {
      await connection.commit();
    }
    inTransaction = false;

    return res.status(dryRun ? 200 : 201).json({
      success: true,
      calendar: {
        calendar_id: calendarId,
        academic_year_id: academicYearId,
        academic_year: academicYear[0].academic_year,
        semester_id: semesterId,
        semester_name: semester[0].semester_name,
        midterm_start_date: midtermStartDate,
        midterm_end_date: midtermEndDate,
        final_start_date: finalStartDate,
        final_end_date: finalEndDate,
        calendar_status: "DRAFT",
        record_version: 1,
        created_by_user_id: actorId,
        published_at: null,
      },
      audit_event: "CREATED",
      audit_event_id: Number(eventResult.insertId),
      dry_run: dryRun,
      persisted: !dryRun,
    });
  } catch (error) {
    if (connection && inTransaction) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("ACADEMIC CALENDAR ROLLBACK ERROR:", rollbackError);
      }
    }

    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        code: "ACADEMIC_CALENDAR_ALREADY_EXISTS",
        message:
          "An academic calendar already exists for this academic year and semester.",
      });
    }

    if (error?.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(404).json({
        success: false,
        code: "ACADEMIC_CALENDAR_REFERENCE_NOT_FOUND",
        message: "The selected academic year or semester no longer exists.",
      });
    }

    if (error?.code === "ER_CHECK_CONSTRAINT_VIOLATED") {
      return res.status(400).json({
        success: false,
        code: "INVALID_ACADEMIC_CALENDAR_DATE_ORDER",
        message: "Calendar date order violates the database constraint.",
      });
    }

    console.error("REGISTRAR CREATE ACADEMIC CALENDAR ERROR:", error);
    return res.status(500).json({
      success: false,
      code: "ACADEMIC_CALENDAR_CREATE_FAILED",
      message: "Failed to create academic calendar draft.",
    });
  } finally {
    if (connection) connection.release();
  }
});

// Edit an unpublished Academic Calendar
router.patch("/academic-calendar/:calendarId", async (req, res) => {
  const calendarId = readCalendarId(req.params.calendarId);
  if (!calendarId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_ID",
      message: "calendarId must be a positive integer.",
    });
  }

  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({
      success: false,
      code: "INVALID_CALENDAR_BODY",
      message: "Send a JSON object with calendar changes.",
    });
  }

  const actorId = readCalendarId(req.user?.user_id);
  if (!actorId) {
    return res.status(401).json({
      success: false,
      code: "ACADEMIC_CALENDAR_ACTOR_REQUIRED",
      message: "An authenticated Registrar is required.",
    });
  }

  const allowedFields = new Set([
    "record_version",
    "change_reason",
    "dry_run",
    "midterm_start_date",
    "midterm_end_date",
    "final_start_date",
    "final_end_date",
  ]);
  const unexpectedFields = Object.keys(body).filter(
    (field) => !allowedFields.has(field),
  );
  if (unexpectedFields.length > 0) {
    return res.status(400).json({
      success: false,
      code: "ACADEMIC_CALENDAR_FIELDS_NOT_EDITABLE",
      message: "Only the four term dates may be changed on a Draft calendar.",
      unexpected_fields: unexpectedFields,
    });
  }

  const expectedVersion = readCalendarId(body.record_version);
  if (!expectedVersion) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_VERSION",
      message: "record_version must be the current positive integer version.",
    });
  }

  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_DRY_RUN",
      message: "dry_run must be true or false.",
    });
  }

  if (
    typeof body.change_reason !== "string" ||
    !body.change_reason.trim() ||
    body.change_reason.trim().length > 500
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_REASON",
      message: "change_reason is required (1 to 500 characters).",
    });
  }
  const changeReason = body.change_reason.trim();

  const dateFields = [
    "midterm_start_date",
    "midterm_end_date",
    "final_start_date",
    "final_end_date",
  ];
  const suppliedDateFields = dateFields.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  );
  if (suppliedDateFields.length === 0) {
    return res.status(400).json({
      success: false,
      code: "ACADEMIC_CALENDAR_NO_DATE_FIELDS",
      message: "Provide at least one calendar date to edit.",
    });
  }

  const proposedDates = {};
  for (const field of suppliedDateFields) {
    const dateValue = readCalendarDate(body[field]);
    if (!dateValue) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ACADEMIC_CALENDAR_DATE",
        message: `${field} must be a valid YYYY-MM-DD date.`,
      });
    }
    proposedDates[field] = dateValue;
  }

  const dryRun = body.dry_run === true;
  let connection;
  let inTransaction = false;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    inTransaction = true;

    // The lock serializes edits and ensures the version check is authoritative.
    const [rows] = await connection.execute(
      `
      SELECT
        calendar_id, academic_year_id, semester_id,
        DATE_FORMAT(midterm_start_date, '%Y-%m-%d') AS midterm_start_date,
        DATE_FORMAT(midterm_end_date, '%Y-%m-%d') AS midterm_end_date,
        DATE_FORMAT(final_start_date, '%Y-%m-%d') AS final_start_date,
        DATE_FORMAT(final_end_date, '%Y-%m-%d') AS final_end_date,
        calendar_status, record_version, published_at
      FROM academic_term_calendars
      WHERE calendar_id = ? FOR UPDATE
    `,
      [calendarId],
    );

    if (rows.length === 0) {
      await connection.rollback();
      inTransaction = false;
      return res.status(404).json({
        success: false,
        code: "ACADEMIC_CALENDAR_NOT_FOUND",
        message: "Academic Calendar not found.",
      });
    }

    const current = rows[0];
    const currentVersion = Number(current.record_version);
    if (current.calendar_status !== "DRAFT") {
      await connection.rollback();
      inTransaction = false;
      return res.status(409).json({
        success: false,
        code: "ACADEMIC_CALENDAR_DRAFT_ONLY",
        message: "Published calendars require the separate revision workflow.",
      });
    }

    if (currentVersion !== expectedVersion) {
      await connection.rollback();
      inTransaction = false;
      return res.status(409).json({
        success: false,
        code: "ACADEMIC_CALENDAR_VERSION_CONFLICT",
        message: "This calendar was changed. Reload it before editing again.",
        current_record_version: currentVersion,
      });
    }

    const nextDates = Object.fromEntries(
      dateFields.map((field) => [
        field,
        proposedDates[field] ?? current[field],
      ]),
    );
    if (
      !(
        nextDates.midterm_start_date <= nextDates.midterm_end_date &&
        nextDates.midterm_end_date < nextDates.final_start_date &&
        nextDates.final_start_date <= nextDates.final_end_date
      )
    ) {
      await connection.rollback();
      inTransaction = false;
      return res.status(400).json({
        success: false,
        code: "INVALID_ACADEMIC_CALENDAR_DATE_ORDER",
        message:
          "Midterm dates must be ordered, and Final Term must begin after Midterm ends.",
      });
    }

    if (!dateFields.some((field) => current[field] !== nextDates[field])) {
      await connection.rollback();
      inTransaction = false;
      return res.status(400).json({
        success: false,
        code: "ACADEMIC_CALENDAR_NO_CHANGES",
        message: "The supplied dates match the saved calendar.",
      });
    }

    const [updateResult] = await connection.execute(
      `
      UPDATE academic_term_calendars
      SET midterm_start_date = ?, midterm_end_date = ?,
          final_start_date = ?, final_end_date = ?,
          updated_by_user_id = ?, record_version = record_version + 1
      WHERE calendar_id = ? AND record_version = ? AND calendar_status = 'DRAFT'
    `,
      [
        nextDates.midterm_start_date,
        nextDates.midterm_end_date,
        nextDates.final_start_date,
        nextDates.final_end_date,
        actorId,
        calendarId,
        expectedVersion,
      ],
    );

    if (updateResult.affectedRows !== 1) {
      await connection.rollback();
      inTransaction = false;
      return res.status(409).json({
        success: false,
        code: "ACADEMIC_CALENDAR_VERSION_CONFLICT",
        message: "Calendar changed while saving. Reload and try again.",
      });
    }

    const newVersion = currentVersion + 1;
    const [eventResult] = await connection.execute(
      `
      INSERT INTO academic_term_calendar_events (
        calendar_id, event_type,
        previous_midterm_start_date, previous_midterm_end_date,
        new_midterm_start_date, new_midterm_end_date,
        previous_final_start_date, previous_final_end_date,
        new_final_start_date, new_final_end_date,
        previous_calendar_status, new_calendar_status,
        previous_published_at, new_published_at,
        calendar_version_after, change_reason, changed_by_user_id
      ) VALUES (
        ?, 'UPDATED', ?, ?, ?, ?, ?, ?, ?, ?,
        'DRAFT', 'DRAFT', ?, ?, ?, ?, ?
      )
    `,
      [
        calendarId,
        current.midterm_start_date,
        current.midterm_end_date,
        nextDates.midterm_start_date,
        nextDates.midterm_end_date,
        current.final_start_date,
        current.final_end_date,
        nextDates.final_start_date,
        nextDates.final_end_date,
        current.published_at,
        current.published_at,
        newVersion,
        changeReason,
        actorId,
      ],
    );

    if (dryRun) {
      await connection.rollback();
    } else {
      await connection.commit();
    }
    inTransaction = false;

    return res.status(200).json({
      success: true,
      calendar: {
        calendar_id: calendarId,
        academic_year_id: Number(current.academic_year_id),
        semester_id: Number(current.semester_id),
        ...nextDates,
        calendar_status: "DRAFT",
        record_version: newVersion,
        updated_by_user_id: actorId,
      },
      audit_event: "UPDATED",
      audit_event_id: Number(eventResult.insertId),
      dry_run: dryRun,
      persisted: !dryRun,
    });
  } catch (error) {
    if (connection && inTransaction) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("ACADEMIC CALENDAR EDIT ROLLBACK ERROR:", rollbackError);
      }
    }

    if (error?.code === "ER_CHECK_CONSTRAINT_VIOLATED") {
      return res.status(400).json({
        success: false,
        code: "INVALID_ACADEMIC_CALENDAR_DATE_ORDER",
        message: "Calendar date order violates the database constraint.",
      });
    }

    console.error("REGISTRAR EDIT ACADEMIC CALENDAR ERROR:", error);
    return res.status(500).json({
      success: false,
      code: "ACADEMIC_CALENDAR_UPDATE_FAILED",
      message: "Failed to update academic calendar draft.",
    });
  } finally {
    if (connection) connection.release();
  }
});

// Academic Calendar publication checks
// Historical meetings must match the term and dates of their assigned offering.
async function loadCalendarPublicationConflicts(
  connection,
  calendar,
  sampleLimit = 10,
) {
  const condition = `
    FROM gradebook_attendance_meetings m
    INNER JOIN gradebook_offering_config cfg ON cfg.config_id = m.config_id
    INNER JOIN subject_offerings so ON so.offering_id = cfg.offering_id
    WHERE so.academic_year_id = ?
      AND so.semester_id = ?
      AND (
        (m.grading_term = 'MIDTERM'
          AND (m.meeting_date < ? OR m.meeting_date > ?))
        OR (m.grading_term = 'FINAL_TERM'
          AND (m.meeting_date < ? OR m.meeting_date > ?))
        OR m.grading_term NOT IN ('MIDTERM', 'FINAL_TERM')
      )`;
  const params = [
    Number(calendar.academic_year_id),
    Number(calendar.semester_id),
    calendar.midterm_start_date,
    calendar.midterm_end_date,
    calendar.final_start_date,
    calendar.final_end_date,
  ];

  const [[count]] = await connection.execute(
    `SELECT COUNT(*) AS conflict_count ${condition}`,
    params,
  );
  const conflictCount = Number(count.conflict_count);
  if (conflictCount === 0) {
    return { conflict_count: 0, sample_conflicts: [] };
  }

  const [rows] = await connection.execute(
    `
    SELECT
      m.meeting_id,
      so.offering_id,
      m.grading_term,
      DATE_FORMAT(m.meeting_date, '%Y-%m-%d') AS meeting_date,
      m.meeting_status,
      CASE
        WHEN m.grading_term = 'MIDTERM' THEN 'MIDTERM_DATE_OUTSIDE_CALENDAR'
        WHEN m.grading_term = 'FINAL_TERM' THEN 'FINAL_TERM_DATE_OUTSIDE_CALENDAR'
        ELSE 'UNSUPPORTED_GRADING_TERM'
      END AS conflict_code
    ${condition}
    ORDER BY m.meeting_date, m.meeting_id
    LIMIT ${Math.max(1, Math.min(20, sampleLimit))}
  `,
    params,
  );

  return {
    conflict_count: conflictCount,
    sample_conflicts: rows.map((row) => ({
      meeting_id: Number(row.meeting_id),
      offering_id: Number(row.offering_id),
      grading_term: row.grading_term,
      meeting_date: row.meeting_date,
      meeting_status: row.meeting_status,
      conflict_code: row.conflict_code,
    })),
  };
}

const calendarPublicationSelect = `
  SELECT
    calendar_id, academic_year_id, semester_id,
    DATE_FORMAT(midterm_start_date, '%Y-%m-%d') AS midterm_start_date,
    DATE_FORMAT(midterm_end_date, '%Y-%m-%d') AS midterm_end_date,
    DATE_FORMAT(final_start_date, '%Y-%m-%d') AS final_start_date,
    DATE_FORMAT(final_end_date, '%Y-%m-%d') AS final_end_date,
    calendar_status, record_version,
    DATE_FORMAT(published_at, '%Y-%m-%d %H:%i:%s') AS published_at
  FROM academic_term_calendars
  WHERE calendar_id = ?`;

// Preview historical attendance incompatibilities before publication.
router.get(
  "/academic-calendar/:calendarId/publication-preview",
  async (req, res) => {
    const calendarId = readCalendarId(req.params.calendarId);
    if (!calendarId) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ACADEMIC_CALENDAR_ID",
        message: "calendarId must be a positive integer.",
      });
    }

    try {
      const [rows] = await db.execute(calendarPublicationSelect, [calendarId]);
      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          code: "ACADEMIC_CALENDAR_NOT_FOUND",
          message: "Academic Calendar not found.",
        });
      }

      const calendar = rows[0];
      const conflicts = await loadCalendarPublicationConflicts(db, calendar);
      return res.status(200).json({
        success: true,
        calendar_id: calendarId,
        calendar_status: calendar.calendar_status,
        record_version: Number(calendar.record_version),
        can_publish:
          calendar.calendar_status === "DRAFT" &&
          conflicts.conflict_count === 0,
        ...conflicts,
        message:
          conflicts.conflict_count > 0
            ? "Some recorded attendance meetings do not belong to the proposed term dates. Resolve the conflicts before publication."
            : calendar.calendar_status === "PUBLISHED"
              ? "This calendar has already been published."
              : "No conflicting historical attendance meetings were found.",
      });
    } catch (error) {
      console.error("ACADEMIC CALENDAR PUBLICATION PREVIEW ERROR:", error);
      return res.status(500).json({
        success: false,
        code: "ACADEMIC_CALENDAR_PUBLICATION_PREFLIGHT_FAILED",
        message:
          "Could not verify historical attendance dates. Publication is unavailable.",
      });
    }
  },
);

// Publish only a Draft, with optimistic locking and a transactional audit event.
router.post("/academic-calendar/:calendarId/publish", async (req, res) => {
  const calendarId = readCalendarId(req.params.calendarId);
  if (!calendarId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_ID",
      message: "calendarId must be a positive integer.",
    });
  }

  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({
      success: false,
      code: "INVALID_CALENDAR_BODY",
      message:
        "Send a JSON object with the current record version and publication confirmation.",
    });
  }

  const permittedFields = new Set([
    "record_version",
    "change_reason",
    "confirm_official_dates",
    "dry_run",
  ]);
  const unexpectedFields = Object.keys(body).filter(
    (key) => !permittedFields.has(key),
  );
  if (unexpectedFields.length) {
    return res.status(400).json({
      success: false,
      code: "ACADEMIC_CALENDAR_PUBLISH_FIELDS_INVALID",
      message: "Publication does not accept date or status changes.",
      unexpected_fields: unexpectedFields,
    });
  }

  const actorId = readCalendarId(req.user?.user_id);
  if (!actorId) {
    return res.status(401).json({
      success: false,
      code: "ACADEMIC_CALENDAR_ACTOR_REQUIRED",
      message: "An authenticated Registrar is required.",
    });
  }

  const expectedVersion = readCalendarId(body.record_version);
  if (!expectedVersion) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_VERSION",
      message: "record_version must be the current positive integer version.",
    });
  }
  if (
    typeof body.change_reason !== "string" ||
    !body.change_reason.trim() ||
    body.change_reason.trim().length > 500
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_REASON",
      message: "change_reason is required (1 to 500 characters).",
    });
  }
  if (body.confirm_official_dates !== true) {
    return res.status(400).json({
      success: false,
      code: "ACADEMIC_CALENDAR_OFFICIAL_DATES_NOT_CONFIRMED",
      message:
        "Confirm that the calendar contains verified official academic dates before publication.",
    });
  }
  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_DRY_RUN",
      message: "dry_run must be true or false.",
    });
  }

  const dryRun = body.dry_run === true;
  const changeReason = body.change_reason.trim();
  let connection;
  let inTransaction = false;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    inTransaction = true;

    const [rows] = await connection.execute(
      `${calendarPublicationSelect} FOR UPDATE`,
      [calendarId],
    );
    if (rows.length === 0) {
      await connection.rollback();
      inTransaction = false;
      return res.status(404).json({
        success: false,
        code: "ACADEMIC_CALENDAR_NOT_FOUND",
        message: "Academic Calendar not found.",
      });
    }

    const current = rows[0];
    const currentVersion = Number(current.record_version);
    if (current.calendar_status !== "DRAFT") {
      await connection.rollback();
      inTransaction = false;
      return res.status(409).json({
        success: false,
        code: "ACADEMIC_CALENDAR_ALREADY_PUBLISHED",
        message:
          "Only a Draft calendar can be published. Revisions use a separate workflow.",
      });
    }
    if (currentVersion !== expectedVersion) {
      await connection.rollback();
      inTransaction = false;
      return res.status(409).json({
        success: false,
        code: "ACADEMIC_CALENDAR_VERSION_CONFLICT",
        message: "The calendar was updated. Reload it before publication.",
        current_record_version: currentVersion,
      });
    }

    // Offering locks serialize publication with the existing attendance-meeting writer.
    await connection.execute(
      `
      SELECT offering_id
      FROM subject_offerings
      WHERE academic_year_id = ? AND semester_id = ?
      ORDER BY offering_id FOR UPDATE
    `,
      [Number(current.academic_year_id), Number(current.semester_id)],
    );

    const conflicts = await loadCalendarPublicationConflicts(
      connection,
      current,
    );
    if (conflicts.conflict_count > 0) {
      await connection.rollback();
      inTransaction = false;
      return res.status(409).json({
        success: false,
        code: "ACADEMIC_CALENDAR_HISTORICAL_MEETING_CONFLICT",
        message:
          "Cannot publish: existing attendance meetings fall outside their assigned grading terms.",
        calendar_id: calendarId,
        ...conflicts,
      });
    }

    const [update] = await connection.execute(
      `
      UPDATE academic_term_calendars
      SET calendar_status = 'PUBLISHED',
          record_version = record_version + 1,
          published_by_user_id = ?,
          published_at = NOW(),
          updated_by_user_id = ?
      WHERE calendar_id = ?
        AND calendar_status = 'DRAFT'
        AND record_version = ?
    `,
      [actorId, actorId, calendarId, currentVersion],
    );
    if (update.affectedRows !== 1) {
      await connection.rollback();
      inTransaction = false;
      return res.status(409).json({
        success: false,
        code: "ACADEMIC_CALENDAR_VERSION_CONFLICT",
        message: "Calendar changed during publication. Reload and try again.",
      });
    }

    const [publishedRows] = await connection.execute(
      `
      SELECT DATE_FORMAT(published_at, '%Y-%m-%d %H:%i:%s') AS published_at
      FROM academic_term_calendars WHERE calendar_id = ?
    `,
      [calendarId],
    );
    const publishedAt = publishedRows[0].published_at;
    const nextVersion = currentVersion + 1;

    const [eventResult] = await connection.execute(
      `
      INSERT INTO academic_term_calendar_events (
        calendar_id, event_type,
        previous_midterm_start_date, previous_midterm_end_date,
        new_midterm_start_date, new_midterm_end_date,
        previous_final_start_date, previous_final_end_date,
        new_final_start_date, new_final_end_date,
        previous_calendar_status, new_calendar_status,
        previous_published_at, new_published_at,
        calendar_version_after, change_reason, changed_by_user_id
      ) VALUES (
        ?, 'PUBLISHED', ?, ?, ?, ?, ?, ?, ?, ?,
        'DRAFT', 'PUBLISHED', ?, ?, ?, ?, ?
      )
    `,
      [
        calendarId,
        current.midterm_start_date,
        current.midterm_end_date,
        current.midterm_start_date,
        current.midterm_end_date,
        current.final_start_date,
        current.final_end_date,
        current.final_start_date,
        current.final_end_date,
        current.published_at,
        publishedAt,
        nextVersion,
        changeReason,
        actorId,
      ],
    );

    if (dryRun) {
      await connection.rollback();
    } else {
      await connection.commit();
    }
    inTransaction = false;

    return res.status(200).json({
      success: true,
      calendar: {
        calendar_id: calendarId,
        academic_year_id: Number(current.academic_year_id),
        semester_id: Number(current.semester_id),
        midterm_start_date: current.midterm_start_date,
        midterm_end_date: current.midterm_end_date,
        final_start_date: current.final_start_date,
        final_end_date: current.final_end_date,
        calendar_status: "PUBLISHED",
        record_version: nextVersion,
        published_by_user_id: actorId,
        published_at: publishedAt,
      },
      audit_event: "PUBLISHED",
      audit_event_id: Number(eventResult.insertId),
      dry_run: dryRun,
      persisted: !dryRun,
    });
  } catch (error) {
    if (connection && inTransaction) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "ACADEMIC CALENDAR PUBLISH ROLLBACK ERROR:",
          rollbackError,
        );
      }
    }
    console.error("REGISTRAR ACADEMIC CALENDAR PUBLISH ERROR:", error);
    return res.status(500).json({
      success: false,
      code: "ACADEMIC_CALENDAR_PUBLICATION_PREFLIGHT_FAILED",
      message:
        "Calendar publication could not be safely completed. No publication was saved.",
    });
  } finally {
    if (connection) connection.release();
  }
});

// Published Academic Calendar revision
// A reason, current version and re-check of historical meetings are mandatory.
router.patch("/academic-calendar/:calendarId/revise", async (req, res) => {
  const calendarId = readCalendarId(req.params.calendarId);
  if (!calendarId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_ID",
      message: "calendarId must be a positive integer.",
    });
  }

  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({
      success: false,
      code: "INVALID_CALENDAR_BODY",
      message:
        "Send a JSON object with the current record version, new dates and reason.",
    });
  }

  const dateFields = [
    "midterm_start_date",
    "midterm_end_date",
    "final_start_date",
    "final_end_date",
  ];
  const permitted = new Set([
    ...dateFields,
    "record_version",
    "change_reason",
    "confirm_official_dates",
    "dry_run",
  ]);
  if (Object.keys(body).some((field) => !permitted.has(field))) {
    return res.status(400).json({
      success: false,
      code: "ACADEMIC_CALENDAR_REVISION_FIELDS_INVALID",
      message:
        "Revision accepts only the four dates, record_version, change_reason, confirmation and dry_run.",
    });
  }

  const actorId = readCalendarId(req.user?.user_id);
  if (!actorId) {
    return res.status(401).json({
      success: false,
      code: "ACADEMIC_CALENDAR_ACTOR_REQUIRED",
      message: "An authenticated Registrar is required.",
    });
  }

  const expectedVersion = readCalendarId(body.record_version);
  if (!expectedVersion) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_VERSION",
      message: "record_version must be the current positive integer version.",
    });
  }

  if (
    typeof body.change_reason !== "string" ||
    body.change_reason.trim().length < 10 ||
    body.change_reason.trim().length > 500
  ) {
    return res.status(400).json({
      success: false,
      code: "ACADEMIC_CALENDAR_REVISION_REASON_REQUIRED",
      message:
        "A documented revision reason of 10 to 500 characters is required.",
    });
  }
  if (body.confirm_official_dates !== true) {
    return res.status(400).json({
      success: false,
      code: "ACADEMIC_CALENDAR_OFFICIAL_DATES_NOT_CONFIRMED",
      message: "The Registrar must confirm the revised official dates.",
    });
  }
  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_DRY_RUN",
      message: "dry_run must be true or false.",
    });
  }

  const specifiedFields = dateFields.filter(
    (field) => body[field] !== undefined,
  );
  if (specifiedFields.length === 0) {
    return res.status(400).json({
      success: false,
      code: "ACADEMIC_CALENDAR_REVISION_DATES_REQUIRED",
      message: "Supply at least one revised calendar date.",
    });
  }
  const supplied = {};
  for (const field of specifiedFields) {
    const validDate = readCalendarDate(body[field]);
    if (!validDate) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ACADEMIC_CALENDAR_DATE",
        message: `${field} must be a valid YYYY-MM-DD date.`,
      });
    }
    supplied[field] = validDate;
  }

  const dryRun = body.dry_run === true;
  const changeReason = body.change_reason.trim();
  let connection;
  let inTransaction = false;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    inTransaction = true;

    const [rows] = await connection.execute(
      `${calendarPublicationSelect} FOR UPDATE`,
      [calendarId],
    );
    if (rows.length !== 1) {
      await connection.rollback();
      inTransaction = false;
      return res.status(404).json({
        success: false,
        code: "ACADEMIC_CALENDAR_NOT_FOUND",
        message: "Academic Calendar not found.",
      });
    }

    const current = rows[0];
    const version = Number(current.record_version);
    if (current.calendar_status !== "PUBLISHED") {
      await connection.rollback();
      inTransaction = false;
      return res.status(409).json({
        success: false,
        code: "ACADEMIC_CALENDAR_PUBLISHED_ONLY",
        message:
          "Only a published calendar can be revised. Use Draft editing for unpublished calendars.",
      });
    }
    if (version !== expectedVersion) {
      await connection.rollback();
      inTransaction = false;
      return res.status(409).json({
        success: false,
        code: "ACADEMIC_CALENDAR_VERSION_CONFLICT",
        message: "The calendar changed. Reload it before revising.",
        current_record_version: version,
      });
    }

    const revised = Object.fromEntries(
      dateFields.map((field) => [field, supplied[field] ?? current[field]]),
    );
    if (
      !(
        revised.midterm_start_date <= revised.midterm_end_date &&
        revised.midterm_end_date < revised.final_start_date &&
        revised.final_start_date <= revised.final_end_date
      )
    ) {
      await connection.rollback();
      inTransaction = false;
      return res.status(400).json({
        success: false,
        code: "INVALID_ACADEMIC_CALENDAR_DATE_ORDER",
        message:
          "Midterm and Final Term dates must be in chronological order without overlap.",
      });
    }
    if (dateFields.every((field) => current[field] === revised[field])) {
      await connection.rollback();
      inTransaction = false;
      return res.status(400).json({
        success: false,
        code: "ACADEMIC_CALENDAR_NO_CHANGES",
        message: "The revised dates must differ from the published calendar.",
      });
    }

    // Match publication's lock order so new attendance meetings cannot slip past the date check.
    await connection.execute(
      `
      SELECT offering_id FROM subject_offerings
      WHERE academic_year_id = ? AND semester_id = ?
      ORDER BY offering_id FOR UPDATE
    `,
      [Number(current.academic_year_id), Number(current.semester_id)],
    );

    const conflicts = await loadCalendarPublicationConflicts(connection, {
      ...current,
      ...revised,
    });
    if (conflicts.conflict_count > 0) {
      await connection.rollback();
      inTransaction = false;
      return res.status(409).json({
        success: false,
        code: "ACADEMIC_CALENDAR_HISTORICAL_MEETING_CONFLICT",
        message:
          "Cannot revise: existing attendance meetings would fall outside the revised terms.",
        calendar_id: calendarId,
        ...conflicts,
      });
    }

    const [update] = await connection.execute(
      `
      UPDATE academic_term_calendars
      SET midterm_start_date = ?, midterm_end_date = ?,
          final_start_date = ?, final_end_date = ?,
          updated_by_user_id = ?, record_version = record_version + 1
      WHERE calendar_id = ? AND record_version = ?
        AND calendar_status = 'PUBLISHED'
    `,
      [
        revised.midterm_start_date,
        revised.midterm_end_date,
        revised.final_start_date,
        revised.final_end_date,
        actorId,
        calendarId,
        version,
      ],
    );
    if (update.affectedRows !== 1) {
      await connection.rollback();
      inTransaction = false;
      return res.status(409).json({
        success: false,
        code: "ACADEMIC_CALENDAR_VERSION_CONFLICT",
        message: "Calendar changed during revision. Reload and try again.",
      });
    }

    // The original publication timestamp/actor remain intact; revisions are audited separately.
    const newVersion = version + 1;
    const [event] = await connection.execute(
      `
      INSERT INTO academic_term_calendar_events (
        calendar_id, event_type,
        previous_midterm_start_date, previous_midterm_end_date,
        new_midterm_start_date, new_midterm_end_date,
        previous_final_start_date, previous_final_end_date,
        new_final_start_date, new_final_end_date,
        previous_calendar_status, new_calendar_status,
        previous_published_at, new_published_at,
        calendar_version_after, change_reason, changed_by_user_id
      ) VALUES (
        ?, 'REVISED', ?, ?, ?, ?, ?, ?, ?, ?,
        'PUBLISHED', 'PUBLISHED', ?, ?, ?, ?, ?
      )
    `,
      [
        calendarId,
        current.midterm_start_date,
        current.midterm_end_date,
        revised.midterm_start_date,
        revised.midterm_end_date,
        current.final_start_date,
        current.final_end_date,
        revised.final_start_date,
        revised.final_end_date,
        current.published_at,
        current.published_at,
        newVersion,
        changeReason,
        actorId,
      ],
    );
    if (Number(event.affectedRows) !== 1) {
      throw new Error("Academic Calendar revision audit event was not saved.");
    }

    if (dryRun) await connection.rollback();
    else await connection.commit();
    inTransaction = false;

    return res.status(200).json({
      success: true,
      calendar: {
        calendar_id: calendarId,
        academic_year_id: Number(current.academic_year_id),
        semester_id: Number(current.semester_id),
        ...revised,
        calendar_status: "PUBLISHED",
        record_version: newVersion,
        published_at: current.published_at,
        updated_by_user_id: actorId,
      },
      audit_event: "REVISED",
      audit_event_id: Number(event.insertId),
      dry_run: dryRun,
      persisted: !dryRun,
    });
  } catch (error) {
    if (inTransaction && connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "ACADEMIC CALENDAR REVISION ROLLBACK ERROR:",
          rollbackError,
        );
      }
    }
    if (error?.code === "ER_CHECK_CONSTRAINT_VIOLATED") {
      return res.status(400).json({
        success: false,
        code: "INVALID_ACADEMIC_CALENDAR_DATE_ORDER",
        message:
          "The revised dates violate the database date-order constraint.",
      });
    }
    console.error("REGISTRAR ACADEMIC CALENDAR REVISION ERROR:", error);
    return res.status(500).json({
      success: false,
      code: "ACADEMIC_CALENDAR_REVISION_FAILED",
      message: "Calendar revision could not be saved.",
    });
  } finally {
    connection?.release();
  }
});

// Academic Calendar change history
// Registrar-only access is enforced by the parent Registrar router.
router.get("/academic-calendar/:calendarId/history", async (req, res) => {
  const calendarId = readCalendarId(req.params.calendarId);
  if (!calendarId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_ID",
      message: "calendarId must be a positive integer.",
    });
  }

  const allowedQueryFields = new Set(["page", "page_size"]);
  if (Object.keys(req.query).some((field) => !allowedQueryFields.has(field))) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_HISTORY_FILTER",
      message: "Only page and page_size are supported.",
    });
  }

  function readPositiveQueryInteger(value, fallback) {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  const page = readPositiveQueryInteger(req.query.page, 1);
  const pageSize = readPositiveQueryInteger(req.query.page_size, 50);
  if (!page || !pageSize || pageSize > 100) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_HISTORY_PAGE",
      message:
        "page must be a positive integer; page_size must be between 1 and 100.",
    });
  }

  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) {
    return res.status(400).json({
      success: false,
      code: "INVALID_ACADEMIC_CALENDAR_HISTORY_PAGE",
      message: "The requested history page is too large.",
    });
  }

  try {
    const [calendarRows] = await db.execute(
      `
      SELECT c.calendar_id, c.academic_year_id, ay.academic_year,
             c.semester_id, s.semester_name, c.calendar_status,
             c.record_version, c.published_at
      FROM academic_term_calendars c
      INNER JOIN academic_years ay ON ay.academic_year_id = c.academic_year_id
      INNER JOIN semesters s ON s.semester_id = c.semester_id
      WHERE c.calendar_id = ?
      LIMIT 1
    `,
      [calendarId],
    );

    if (calendarRows.length === 0) {
      return res.status(404).json({
        success: false,
        code: "ACADEMIC_CALENDAR_NOT_FOUND",
        message: "Academic Calendar not found.",
      });
    }

    const [[{ total_events: totalEventsRaw }]] = await db.execute(
      `
      SELECT COUNT(*) AS total_events
      FROM academic_term_calendar_events
      WHERE calendar_id = ?
    `,
      [calendarId],
    );
    const totalEvents = Number(totalEventsRaw);

    // Pagination values are strictly validated numbers; no SQL input is interpolated.
    const [eventRows] = await db.execute(
      `
      SELECT event_id, calendar_id, event_type,
             DATE_FORMAT(previous_midterm_start_date, '%Y-%m-%d') AS previous_midterm_start_date,
             DATE_FORMAT(previous_midterm_end_date, '%Y-%m-%d') AS previous_midterm_end_date,
             DATE_FORMAT(new_midterm_start_date, '%Y-%m-%d') AS new_midterm_start_date,
             DATE_FORMAT(new_midterm_end_date, '%Y-%m-%d') AS new_midterm_end_date,
             DATE_FORMAT(previous_final_start_date, '%Y-%m-%d') AS previous_final_start_date,
             DATE_FORMAT(previous_final_end_date, '%Y-%m-%d') AS previous_final_end_date,
             DATE_FORMAT(new_final_start_date, '%Y-%m-%d') AS new_final_start_date,
             DATE_FORMAT(new_final_end_date, '%Y-%m-%d') AS new_final_end_date,
             previous_calendar_status, new_calendar_status,
             previous_published_at, new_published_at,
             calendar_version_after, change_reason,
             changed_by_user_id, event_at
      FROM academic_term_calendar_events
      WHERE calendar_id = ?
      ORDER BY event_id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `,
      [calendarId],
    );

    const calendar = calendarRows[0];
    return res.status(200).json({
      success: true,
      calendar: {
        calendar_id: Number(calendar.calendar_id),
        academic_year_id: Number(calendar.academic_year_id),
        academic_year: calendar.academic_year,
        semester_id: Number(calendar.semester_id),
        semester_name: calendar.semester_name,
        calendar_status: calendar.calendar_status,
        record_version: Number(calendar.record_version),
        published_at: calendar.published_at,
      },
      total_events: totalEvents,
      history: eventRows.map((event) => ({
        ...event,
        event_id: Number(event.event_id),
        calendar_id: Number(event.calendar_id),
        calendar_version_after: Number(event.calendar_version_after),
        changed_by_user_id: Number(event.changed_by_user_id),
      })),
      pagination: {
        page,
        page_size: pageSize,
        total_pages: Math.ceil(totalEvents / pageSize),
        has_more: offset + eventRows.length < totalEvents,
      },
    });
  } catch (error) {
    console.error("REGISTRAR ACADEMIC CALENDAR HISTORY ERROR:", error);
    return res.status(500).json({
      success: false,
      code: "ACADEMIC_CALENDAR_HISTORY_READ_FAILED",
      message: "Failed to load Academic Calendar history.",
    });
  }
});

// Step 2.8.11J1 — Official grading-sheet original submission date, QA pilot.
// The Registrar records the evidence and original submission date only.
// Program Head verifies the date and finalizes the sheet.
// Later corrections belong to the formal gradebook_sheet_amendments workflow.

const officialSheetPilotDb = "databaseforptc1_admission_test";

function officialSheetFail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function officialSheetError(res, error) {
  if (error?.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      success: false,
      code: "OFFICIAL_SHEET_CONFLICT",
      message:
        "A grading-sheet record or its audit event already exists. Reload before retrying.",
    });
  }
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
  if (status === 500) console.error("REGISTRAR OFFICIAL SHEET ERROR:", error);
  return res.status(status).json({
    success: false,
    code:
      status === 500
        ? "OFFICIAL_SHEET_INTERNAL_ERROR"
        : (error.code ?? "OFFICIAL_SHEET_REQUEST_FAILED"),
    message:
      status === 500
        ? "Could not process the official grading-sheet submission record."
        : error.message,
  });
}

function officialSheetBody(body, permitted) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    officialSheetFail(
      "OFFICIAL_SHEET_BODY_INVALID",
      "A JSON object is required.",
      400,
    );
  }
  const extra = Object.keys(body).filter((key) => !permitted.includes(key));
  if (extra.length) {
    officialSheetFail(
      "OFFICIAL_SHEET_FIELDS_UNSUPPORTED",
      `Unsupported field(s): ${extra.join(", ")}.`,
      400,
    );
  }
  if (typeof body.dry_run !== "boolean") {
    officialSheetFail(
      "OFFICIAL_SHEET_DRY_RUN_REQUIRED",
      "Send dry_run as true or false.",
      400,
    );
  }
}

function officialSheetDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    officialSheetFail(
      "OFFICIAL_SHEET_DATE_INVALID",
      "original_official_submitted_on must use YYYY-MM-DD.",
      400,
    );
  }
  const [year, month, day] = value.split("-").map(Number);
  if (year < 2000 || year > 2199) {
    officialSheetFail(
      "OFFICIAL_SHEET_DATE_INVALID",
      "The original submission date is outside the allowed year range.",
      400,
    );
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    officialSheetFail(
      "OFFICIAL_SHEET_DATE_INVALID",
      "Provide a real calendar date.",
      400,
    );
  }
  return value;
}

async function officialSheetAssertDatabase(connection) {
  const [[row]] = await connection.execute(
    "SELECT DATABASE() AS database_name",
  );
  if (row?.database_name !== officialSheetPilotDb) {
    officialSheetFail(
      "OFFICIAL_SHEET_TEST_DATABASE_ONLY",
      "Official grading-sheet pilot is limited to databaseforptc1_admission_test.",
      403,
    );
  }
}

async function officialSheetRegistrar(connection, req) {
  const userId = readCalendarId(req.user?.user_id);
  if (!userId)
    officialSheetFail(
      "OFFICIAL_SHEET_AUTH_REQUIRED",
      "Registrar authentication is required.",
      401,
    );
  const [rows] = await connection.execute(
    `SELECT u.user_id, u.is_active, u.is_archived, r.role_name
       FROM users u JOIN roles r ON r.role_id = u.role_id
      WHERE u.user_id = ?`,
    [userId],
  );
  if (
    rows.length !== 1 ||
    Number(rows[0].is_active) !== 1 ||
    Number(rows[0].is_archived) !== 0 ||
    rows[0].role_name !== "Registrar"
  ) {
    officialSheetFail(
      "OFFICIAL_SHEET_REGISTRAR_REQUIRED",
      "Only an active Registrar may manage official sheet submission dates.",
      403,
    );
  }
  return userId;
}

async function officialSheetScope(connection, offeringId, lock = false) {
  // Keep the same offering → config lock order as score and submission writers.
  const [offeringRows] = await connection.execute(
    `SELECT so.offering_id, so.academic_year_id, so.semester_id,
            so.status, cr.department_id
       FROM subject_offerings so
       JOIN sections sec ON sec.section_id = so.section_id
       JOIN courses cr ON cr.course_id = sec.course_id
      WHERE so.offering_id = ?
       ${lock ? "FOR UPDATE" : ""}`,

    [offeringId],
  );
  if (offeringRows.length !== 1) {
    officialSheetFail(
      "OFFICIAL_SHEET_OFFERING_NOT_FOUND",
      "The subject offering was not found.",
      404,
    );
  }
  const [configRows] = await connection.execute(
    `SELECT config_id FROM gradebook_offering_config WHERE offering_id = ?
     ${lock ? "FOR UPDATE" : ""}`,
    [offeringId],
  );
  if (configRows.length !== 1) {
    officialSheetFail(
      "OFFICIAL_SHEET_CONFIG_MISSING",
      "The offering has no unique gradebook configuration.",
      404,
    );
  }

  return {
    configId: Number(configRows[0].config_id),
    academicYearId: Number(offeringRows[0].academic_year_id),
    semesterId: Number(offeringRows[0].semester_id),
    offeringStatus: offeringRows[0].status,
    departmentId: Number(offeringRows[0].department_id),
  };
}

const officialSheetSelect = `
  SELECT sheet_id, config_id, sheet_status,
         DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_official_submitted_on,
         official_submission_reference, official_date_verified_by_user_id,
         DATE_FORMAT(official_date_verified_at, '%Y-%m-%d %H:%i:%s') AS official_date_verified_at,
         finalized_roster_count, finalized_by_user_id,
         DATE_FORMAT(finalized_at, '%Y-%m-%d %H:%i:%s') AS finalized_at,
         finalization_remarks, record_version, created_by_user_id, updated_by_user_id,
         CASE WHEN original_official_submitted_on IS NOT NULL
                    AND official_date_verified_by_user_id IS NOT NULL
                    AND official_date_verified_at IS NOT NULL
              THEN DATE_FORMAT(DATE_ADD(original_official_submitted_on, INTERVAL 1 YEAR), '%Y-%m-%d')
              ELSE NULL END AS inc_completion_deadline_on
    FROM gradebook_official_sheets WHERE config_id = ?`;

function officialSheetFormat(row) {
  if (!row) return null;
  return {
    sheet_id: String(row.sheet_id),
    config_id: Number(row.config_id),
    sheet_status: row.sheet_status,
    original_official_submitted_on: row.original_official_submitted_on,
    official_submission_reference: row.official_submission_reference,
    official_date_verified_by_user_id:
      row.official_date_verified_by_user_id === null
        ? null
        : Number(row.official_date_verified_by_user_id),
    official_date_verified_at: row.official_date_verified_at,
    finalized_roster_count:
      row.finalized_roster_count === null
        ? null
        : Number(row.finalized_roster_count),
    finalized_by_user_id:
      row.finalized_by_user_id === null
        ? null
        : Number(row.finalized_by_user_id),
    finalized_at: row.finalized_at,
    finalization_remarks: row.finalization_remarks,
    record_version: Number(row.record_version),
    created_by_user_id:
      row.created_by_user_id === null ? null : Number(row.created_by_user_id),
    updated_by_user_id:
      row.updated_by_user_id === null ? null : Number(row.updated_by_user_id),
    inc_completion_deadline_on: row.inc_completion_deadline_on,
    deadline_established: row.inc_completion_deadline_on !== null,
  };
}

async function officialSheetCountInc(connection, configId, offeringId) {
  const [[row]] = await connection.execute(
    `SELECT COUNT(*) AS official_inc_grade_count
       FROM grades g
       JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
       JOIN gradebook_inc_outcome_requests ir
         ON ir.enrollment_subject_id = es.enrollment_subject_id AND ir.config_id = ?
      WHERE es.offering_id = ? AND ir.request_status = 'APPROVED'
        AND g.grade_status = 'Approved' AND g.grading_policy = 'TWO_TERM_50_50'
        AND g.grading_outcome = 'INCOMPLETE' AND g.final_rating = 4.00`,
    [configId, offeringId],
  );
  return Number(row?.official_inc_grade_count ?? 0);
}

// List initialized gradebooks for original sheet-date recording.
router.get("/gradebook/official-sheets", async (req, res) => {
  try {
    if (Object.keys(req.query ?? {}).length !== 0) {
      officialSheetFail(
        "OFFICIAL_SHEET_LIST_QUERY_UNSUPPORTED",
        "The official-sheet list does not accept query parameters.",
        400,
      );
    }

    await officialSheetRegistrar(db, req);

    const [rows] = await db.execute(
      `SELECT
          so.offering_id,
          so.status AS offering_status,
          sub.subject_code,
          sub.subject_name,
          sec.section_name,
          ay.academic_year,
          sem.semester_name,
          sh.sheet_id,
          sh.sheet_status,
          sh.record_version,
          DATE_FORMAT(sh.original_official_submitted_on, '%Y-%m-%d')
            AS original_official_submitted_on,
          sh.official_submission_reference,
          sh.official_date_verified_by_user_id,

DATE_FORMAT(
  sh.official_date_verified_at,
  '%Y-%m-%d %H:%i:%s'
) AS official_date_verified_at,

CASE
  WHEN sh.original_official_submitted_on IS NOT NULL
   AND sh.official_date_verified_by_user_id IS NOT NULL
   AND sh.official_date_verified_at IS NOT NULL
  THEN DATE_FORMAT(
    DATE_ADD(
      sh.original_official_submitted_on,
      INTERVAL 1 YEAR
    ),
    '%Y-%m-%d'
  )
  ELSE NULL
END AS inc_completion_deadline_on,
          (SELECT COUNT(*)
             FROM gradebook_official_sheet_submission_events ev
            WHERE ev.sheet_id = sh.sheet_id) AS audit_event_count
       FROM gradebook_offering_config cfg
       JOIN subject_offerings so ON so.offering_id = cfg.offering_id
       JOIN subjects sub ON sub.subject_id = so.subject_id
       JOIN sections sec ON sec.section_id = so.section_id
       JOIN academic_years ay ON ay.academic_year_id = so.academic_year_id
       JOIN semesters sem ON sem.semester_id = so.semester_id
       LEFT JOIN gradebook_official_sheets sh ON sh.config_id = cfg.config_id
       ORDER BY so.academic_year_id DESC,
                so.semester_id DESC, so.offering_id DESC`,
    );

    res.set("Cache-Control", "no-store");

    return res.json({
      success: true,
      read_only: true,
      offerings: rows.map((row) => {
        const sheetExists = row.sheet_id != null;

        const canRecord =
          row.offering_status !== "Cancelled" &&
          (!sheetExists ||
            (row.sheet_status === "IN_PROGRESS" &&
              Number(row.record_version) === 1 &&
              row.original_official_submitted_on == null &&
              row.official_submission_reference == null &&
              row.official_date_verified_by_user_id == null &&
              row.official_date_verified_at == null &&
              Number(row.audit_event_count) === 0));

        return {
          offering_id: Number(row.offering_id),
          offering_status: row.offering_status,
          subject_code: row.subject_code,
          subject_name: row.subject_name,
          section_name: row.section_name,
          academic_year: row.academic_year,
          semester_name: row.semester_name,
          sheet_id: sheetExists ? String(row.sheet_id) : null,
          sheet_status: row.sheet_status ?? "NOT_RECORDED",
          sheet_record_version: sheetExists ? Number(row.record_version) : null,
          original_official_submitted_on: row.original_official_submitted_on,
          official_submission_reference: row.official_submission_reference,
          original_date_verified:
            row.official_date_verified_by_user_id != null &&
            row.official_date_verified_at != null,

          official_date_verified_at: row.official_date_verified_at,

          inc_completion_deadline_on: row.inc_completion_deadline_on,

          can_record_original_date: canRecord,
        };
      }),
    });
  } catch (error) {
    return officialSheetError(res, error);
  }
});

// GET /api/registrar/gradebook/official-sheets/:offeringId
// No writes. Includes initial-date audit events, but never implies the sheet is finalized.
router.get("/gradebook/official-sheets/:offeringId", async (req, res) => {
  try {
    if (Object.keys(req.query).length !== 0) {
      officialSheetFail(
        "OFFICIAL_SHEET_QUERY_UNSUPPORTED",
        "This endpoint does not accept query parameters.",
        400,
      );
    }
    const offeringId = readCalendarId(req.params.offeringId);
    if (!offeringId)
      officialSheetFail(
        "OFFICIAL_SHEET_OFFERING_INVALID",
        "offeringId must be a positive integer.",
        400,
      );

    const registrarUserId = await officialSheetRegistrar(db, req);
    const scope = await officialSheetScope(db, offeringId);
    const [sheetRows] = await db.execute(officialSheetSelect, [scope.configId]);
    if (sheetRows.length > 1)
      officialSheetFail(
        "OFFICIAL_SHEET_DUPLICATE",
        "Multiple official sheets exist for this gradebook.",
      );
    const sheet = officialSheetFormat(sheetRows[0]);
    const [events] = sheet
      ? await db.execute(
          `SELECT event_id, event_type, previous_record_version, record_version_after,
                  DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_official_submitted_on,
                  official_submission_reference, performed_by_user_id,
                  DATE_FORMAT(event_at, '%Y-%m-%d %H:%i:%s.%f') AS event_at
             FROM gradebook_official_sheet_submission_events
            WHERE sheet_id = ? ORDER BY event_id`,
          [sheet.sheet_id],
        )
      : [[]];
    const incGradeCount = await officialSheetCountInc(
      db,
      scope.configId,
      offeringId,
    );
    return res.json({
      success: true,
      read_only: true,
      registrar_user_id: registrarUserId,
      offering_id: offeringId,
      config_id: scope.configId,
      academic_year_id: scope.academicYearId,
      semester_id: scope.semesterId,
      official_inc_grade_count: incGradeCount,
      official_sheet: sheet,
      submission_events: events.map((event) => ({
        ...event,
        event_id: String(event.event_id),
        sheet_id: sheet.sheet_id,
        previous_record_version:
          event.previous_record_version === null
            ? null
            : Number(event.previous_record_version),
        record_version_after: Number(event.record_version_after),
        performed_by_user_id: Number(event.performed_by_user_id),
      })),
      note: sheet
        ? "The verified original date establishes the INC deadline; sheet finalization is separate."
        : "No official grading-sheet record exists. An INC deadline cannot yet be established.",
    });
  } catch (error) {
    return officialSheetError(res, error);
  }
});

// POST /api/registrar/gradebook/official-sheets/:offeringId/record-submission
// Record the submitted original date and its source reference, but DO NOT verify it yet.
router.post(
  "/gradebook/official-sheets/:offeringId/record-submission",
  async (req, res) => {
    let connection;
    let inTransaction = false;
    try {
      if (Object.keys(req.query).length !== 0) {
        officialSheetFail(
          "OFFICIAL_SHEET_QUERY_UNSUPPORTED",
          "This endpoint does not accept query parameters.",
          400,
        );
      }
      const offeringId = readCalendarId(req.params.offeringId);
      if (!offeringId)
        officialSheetFail(
          "OFFICIAL_SHEET_OFFERING_INVALID",
          "offeringId must be a positive integer.",
          400,
        );
      officialSheetBody(req.body, [
        "original_official_submitted_on",
        "official_submission_reference",
        "confirm_original_submission_evidence",
        "dry_run",
      ]);
      const originalDate = officialSheetDate(
        req.body.original_official_submitted_on,
      );
      const reference =
        typeof req.body.official_submission_reference === "string"
          ? req.body.official_submission_reference.trim()
          : "";
      if (
        reference.length < 8 ||
        reference.length > 255 ||
        /[\x00-\x1F\x7F]/.test(reference)
      ) {
        officialSheetFail(
          "OFFICIAL_SHEET_REFERENCE_INVALID",
          "Provide an 8–255 character source reference without control characters.",
          400,
        );
      }
      if (req.body.confirm_original_submission_evidence !== true) {
        officialSheetFail(
          "OFFICIAL_SHEET_EVIDENCE_CONFIRMATION_REQUIRED",
          "The Registrar must confirm the original submission reference was checked.",
          400,
        );
      }
      connection = await db.getConnection();
      await connection.beginTransaction();
      inTransaction = true;

      // Official-sheet writes remain QA-only.

      const actor = await officialSheetRegistrar(connection, req);

      // Keep committed recording disabled until the official-sheet rollout.
      const recordWritesEnabled =
        process.env.GRADEBOOK_OFFICIAL_SHEET_RECORD_WRITES_ENABLED === "true";

      if (!req.body.dry_run && !recordWritesEnabled) {
        officialSheetFail(
          "OFFICIAL_SHEET_RECORD_WRITES_DISABLED",
          "Recording original official-sheet dates is not enabled on this server.",
          403,
        );
      }

      // While disabled, dry-run recording remains limited to the QA database.
      if (!recordWritesEnabled) {
        await assertQaGradingDatabase(connection);
        await officialSheetAssertDatabase(connection);
      }

      const scope = await officialSheetScope(connection, offeringId, true);

      if (scope.offeringStatus === "Cancelled") {
        officialSheetFail(
          "OFFICIAL_SHEET_OFFERING_CANCELLED",
          "Cannot record an original submission date for a cancelled offering.",
        );
      }
      const [[databaseDate]] = await connection.execute(
        "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today",
      );
      if (originalDate > databaseDate.today) {
        officialSheetFail(
          "OFFICIAL_SHEET_DATE_IN_FUTURE",
          "The original sheet submission date cannot be in the future.",
          422,
        );
      }

      // Find the official sheet for this gradebook.
      const [existing] = await connection.execute(
        `SELECT sheet_id, sheet_status, record_version,
                original_official_submitted_on,
                official_submission_reference,
                official_date_verified_by_user_id,
                official_date_verified_at
           FROM gradebook_official_sheets
          WHERE config_id = ?
          FOR UPDATE`,
        [scope.configId],
      );

      if (existing.length > 1) {
        officialSheetFail(
          "OFFICIAL_SHEET_DUPLICATE",
          "Multiple official sheets exist for this gradebook.",
        );
      }

      let sheetId;

      if (existing.length === 0) {
        // Older workflow: create a sheet when none exists.
        const [insert] = await connection.execute(
          `INSERT INTO gradebook_official_sheets
           (
             config_id,
             sheet_status,
             original_official_submitted_on,
             official_submission_reference,
             record_version,
             created_by_user_id,
             updated_by_user_id
           )
           VALUES (?, 'IN_PROGRESS', ?, ?, 1, ?, ?)`,
          [scope.configId, originalDate, reference, actor, actor],
        );

        if (Number(insert.affectedRows) !== 1) {
          throw new Error("Could not create the official sheet.");
        }

        sheetId = String(insert.insertId);
      } else {
        // Combined workflow: use the existing blank draft.
        const sheet = existing[0];
        sheetId = String(sheet.sheet_id);

        if (
          sheet.sheet_status !== "IN_PROGRESS" ||
          Number(sheet.record_version) !== 1 ||
          sheet.original_official_submitted_on != null ||
          sheet.official_submission_reference != null ||
          sheet.official_date_verified_by_user_id != null ||
          sheet.official_date_verified_at != null
        ) {
          officialSheetFail(
            "OFFICIAL_SHEET_ALREADY_RECORDED",
            "The original submission evidence has already been recorded or verified.",
          );
        }

        const [events] = await connection.execute(
          `SELECT event_id
             FROM gradebook_official_sheet_submission_events
            WHERE sheet_id = ?
            FOR UPDATE`,
          [sheetId],
        );

        if (events.length !== 0) {
          officialSheetFail(
            "OFFICIAL_SHEET_AUDIT_ALREADY_EXISTS",
            "This sheet already contains submission audit events.",
          );
        }

        const [updated] = await connection.execute(
          `UPDATE gradebook_official_sheets
              SET original_official_submitted_on = ?,
                  official_submission_reference = ?,
                  updated_by_user_id = ?
            WHERE sheet_id = ?
              AND sheet_status = 'IN_PROGRESS'
              AND record_version = 1
              AND original_official_submitted_on IS NULL
              AND official_submission_reference IS NULL
              AND official_date_verified_by_user_id IS NULL
              AND official_date_verified_at IS NULL`,
          [originalDate, reference, actor, sheetId],
        );

        if (Number(updated.affectedRows) !== 1) {
          officialSheetFail(
            "OFFICIAL_SHEET_RECORD_CONFLICT",
            "The sheet changed while recording its submission evidence.",
          );
        }
      }

      // Preserve the existing original-date audit format.
      const [audit] = await connection.execute(
        `INSERT INTO gradebook_official_sheet_submission_events
         (
           sheet_id,
           event_type,
           previous_record_version,
           record_version_after,
           original_official_submitted_on,
           official_submission_reference,
           performed_by_user_id
         )
         VALUES (?, 'RECORDED', NULL, 1, ?, ?, ?)`,
        [sheetId, originalDate, reference, actor],
      );

      if (Number(audit.affectedRows) !== 1) {
        throw new Error("Original submission audit was not saved.");
      }

      if (req.body.dry_run) await connection.rollback();
      else await connection.commit();
      inTransaction = false;
      return res.status(req.body.dry_run ? 200 : 201).json({
        success: true,
        action: "RECORDED",
        official_sheet: {
          sheet_id: req.body.dry_run ? null : sheetId,
          config_id: scope.configId,
          sheet_status: "IN_PROGRESS",
          record_version: 1,
          original_official_submitted_on: originalDate,
          official_submission_reference: reference,
          official_date_verified_by_user_id: null,
          official_date_verified_at: null,
          inc_completion_deadline_on: null,
          deadline_established: false,
        },
        audit_event: "RECORDED",
        audit_event_id: req.body.dry_run ? null : String(audit.insertId),
        dry_run: req.body.dry_run,
        persisted: !req.body.dry_run,
        note: "The original submission date is recorded but not verified. The one-year INC deadline remains unset.",
      });
    } catch (error) {
      if (inTransaction && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("OFFICIAL SHEET RECORD ROLLBACK:", rollbackError);
        }
      }
      return officialSheetError(res, error);
    } finally {
      connection?.release();
    }
  },
);

// The Program Head verifies the original submission date.
// Keep this legacy Registrar endpoint read-only to prevent bypassing that approval.
router.post(
  "/gradebook/official-sheets/:offeringId/verify-submission",
  (_req, res) => {
    return res.status(403).json({
      success: false,
      code: "OFFICIAL_SHEET_PROGRAM_HEAD_VERIFICATION_REQUIRED",
      message:
        "Only the Program Head may verify the original grading-sheet submission date. " +
        "Use the Program Head verification endpoint.",
    });
  },
);

const regCorrQAOffering = 131;
const regCorrQADatabase = "databaseforptc1_admission_test";

function regCorrFail(code, message, status = 409) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function regCorrId(value) {
  if (!/^[1-9]\d*$/.test(String(value ?? ""))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function regCorrJson(value) {
  try {
    const object = typeof value === "string" ? JSON.parse(value) : value;
    return object && typeof object === "object" && !Array.isArray(object)
      ? object
      : null;
  } catch {
    return null;
  }
}

function regCorrGcd(a, b) {
  while (b !== 0n) [a, b] = [b, a % b];
  return a || 1n;
}

function regCorrFrac(n, d) {
  if (d <= 0n || n < 0n)
    regCorrFail(
      "CORRECTION_FRACTION_INVALID",
      "An official grade fraction is invalid.",
    );
  const g = regCorrGcd(n, d);
  return { n: n / g, d: d / g };
}

function regCorrPlus(a, b) {
  return regCorrFrac(a.n * b.d + b.n * a.d, a.d * b.d);
}
function regCorrHalf(a) {
  return regCorrFrac(a.n, a.d * 2n);
}
function regCorrEqual(a, b) {
  return a.n * b.d === b.n * a.d;
}

function regCorrStoredFrac(n, d, label) {
  const nText = String(n ?? ""),
    dText = String(d ?? "");
  if (
    !/^(0|[1-9]\d*)$/.test(nText) ||
    !/^[1-9]\d*$/.test(dText) ||
    nText.length > 255 ||
    dText.length > 255
  ) {
    regCorrFail(
      "CORRECTION_SOURCE_FRACTION_INVALID",
      `${label} exact fraction is invalid.`,
    );
  }
  return regCorrFrac(BigInt(nText), BigInt(dText));
}

function regCorrMoney(value, label) {
  const text = String(value ?? "").trim();
  if (!/^(0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(text)) {
    regCorrFail(
      "CORRECTION_SOURCE_AMOUNT_INVALID",
      `${label} is not a valid two-decimal value.`,
    );
  }
  const [whole, decimal = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt(decimal.padEnd(2, "0"));
}

function regCorrDecimal(value, places) {
  const text = String(value ?? "").trim();
  if (!/^(0|[1-9]\d{0,2})(?:\.\d{1,12})?$/.test(text)) return null;
  const [whole, fractional = ""] = text.split(".");
  if (fractional.length > places) return null;
  return (
    BigInt(whole) * 10n ** BigInt(places) +
    BigInt(fractional.padEnd(places, "0"))
  );
}

function regCorrFormat(ratio, places = 12) {
  const factor = 10n ** BigInt(places);
  const scaled = (2n * ratio.n * factor + ratio.d) / (2n * ratio.d);
  return `${scaled / factor}.${String(scaled % factor).padStart(places, "0")}`;
}

function regCorrRating(ratio) {
  const thresholds = [
    [97, "1.00"],
    [94, "1.25"],
    [91, "1.50"],
    [88, "1.75"],
    [85, "2.00"],
    [82, "2.25"],
    [79, "2.50"],
    [76, "2.75"],
    [75, "3.00"],
  ];
  for (const [limit, rating] of thresholds) {
    if (ratio.n >= BigInt(limit) * ratio.d) return rating;
  }
  return "5.00";
}

function regCorrSame(a, b) {
  if (a == null || b == null) return a == null && b == null;
  const x = regCorrDecimal(a, 12),
    y = regCorrDecimal(b, 12);
  return x !== null && y !== null ? x === y : String(a) === String(b);
}

// Compute from the immutable, Program Head-approved snapshot; do NOT replace it.
// The original calculation must independently match its stored exact term ratio.
function regCorrCalculateTerm(raw, term, ids, overlay = null) {
  const data = regCorrJson(raw);
  const result = data?.calculated_term;
  if (
    !data ||
    !result ||
    result.state !== "READY" ||
    data.policy !== "TWO_TERM_50_50" ||
    data.grading_term !== term ||
    Number(data.config_id) !== ids.configId ||
    Number(data.enrollment_subject_id) !== ids.enrollmentSubjectId ||
    Number(data.offering_id) !== regCorrQAOffering ||
    Number(data.term_weights?.MIDTERM) !== 50 ||
    Number(data.term_weights?.FINAL_TERM) !== 50 ||
    !Array.isArray(result.categories) ||
    result.categories.length < 2 ||
    (result.incomplete_category_codes ?? []).length !== 0
  ) {
    regCorrFail(
      "CORRECTION_SNAPSHOT_UNVERIFIED",
      "Approved term calculation snapshot is incomplete or inconsistent.",
    );
  }
  let totalWeight = 0n;
  let originalTerm = regCorrFrac(0n, 1n);
  let correctedTerm = regCorrFrac(0n, 1n);
  let matchCount = 0;
  const codes = new Set();
  const assessmentIds = new Set();
  for (const category of result.categories) {
    if (
      !category ||
      category.state !== "READY" ||
      !category.category_code ||
      codes.has(category.category_code)
    ) {
      regCorrFail(
        "CORRECTION_CATEGORY_INVALID",
        "Original category layout is invalid.",
      );
    }
    codes.add(category.category_code);
    const weight = regCorrMoney(
      category.category_weight_percent,
      "category weight",
    );
    if (weight === 0n || weight > 10000n)
      regCorrFail(
        "CORRECTION_WEIGHT_INVALID",
        "Original category weight is invalid.",
      );
    totalWeight += weight;
    let contribution;
    let proposedContribution;
    if (category.category_code === "ATTENDANCE") {
      // Preserve the originally approved per-meeting attendance result.
      const pct = regCorrStoredFrac(
        category.category_percentage?.exact_numerator,
        category.category_percentage?.exact_denominator,
        "attendance percentage",
      );
      contribution = regCorrStoredFrac(
        category.contribution_percent_points?.exact_numerator,
        category.contribution_percent_points?.exact_denominator,
        "attendance contribution",
      );
      if (
        pct.n > pct.d * 100n ||
        !regCorrEqual(contribution, regCorrFrac(pct.n * weight, pct.d * 10000n))
      ) {
        regCorrFail(
          "CORRECTION_ATTENDANCE_SOURCE_INVALID",
          "Approved attendance contribution is inconsistent.",
        );
      }
      proposedContribution = contribution;
    } else {
      if (
        !Array.isArray(category.assessments) ||
        !category.assessments.length
      ) {
        regCorrFail(
          "CORRECTION_CATEGORY_EMPTY",
          "Approved category has no assessment basis.",
        );
      }
      let earned = 0n,
        maximum = 0n,
        correctedEarned = 0n;
      for (const item of category.assessments) {
        const itemId = regCorrId(item.assessment_id);
        if (!itemId || assessmentIds.has(itemId)) {
          regCorrFail(
            "CORRECTION_ASSESSMENT_INVALID",
            "Duplicate or invalid assessment in approved snapshot.",
          );
        }
        assessmentIds.add(itemId);
        if (item.score_status === "NOT_APPLICABLE") continue;
        if (item.score_status !== "SCORED") {
          regCorrFail(
            "CORRECTION_UNSAVED_ASSESSMENT",
            "Approved category contains an unsaved assessment.",
          );
        }
        const got = regCorrMoney(item.earned_score, "approved score");
        const max = regCorrMoney(item.maximum_score, "assessment maximum");
        if (max <= 0n || got > max)
          regCorrFail(
            "CORRECTION_ASSESSMENT_BOUNDS",
            "Invalid published assessment bounds.",
          );
        earned += got;
        maximum += max;
        if (
          overlay &&
          itemId === overlay.assessmentId &&
          term === overlay.term
        ) {
          if (got !== overlay.original || max !== overlay.maximum) {
            regCorrFail(
              "CORRECTION_SCORE_SNAPSHOT_STALE",
              "Published assessment does not match authorized correction source.",
            );
          }
          correctedEarned += overlay.proposed;
          matchCount += 1;
        } else correctedEarned += got;
      }
      if (
        maximum === 0n ||
        regCorrMoney(category.earned_points, "category earned points") !==
          earned ||
        regCorrMoney(category.possible_points, "category possible points") !==
          maximum
      ) {
        regCorrFail(
          "CORRECTION_CATEGORY_BASIS_INVALID",
          "Original category points do not match its approved assessment rows.",
        );
      }
      const categoryPct = regCorrStoredFrac(
        category.category_percentage?.exact_numerator,
        category.category_percentage?.exact_denominator,
        "category percentage",
      );
      contribution = regCorrStoredFrac(
        category.contribution_percent_points?.exact_numerator,
        category.contribution_percent_points?.exact_denominator,
        "category contribution",
      );
      if (
        !regCorrEqual(categoryPct, regCorrFrac(earned * 100n, maximum)) ||
        !regCorrEqual(
          contribution,
          regCorrFrac(weight * earned, maximum * 100n),
        )
      ) {
        regCorrFail(
          "CORRECTION_CATEGORY_MATH_INVALID",
          "Original weighted category calculation does not match its snapshot.",
        );
      }
      proposedContribution = regCorrFrac(
        weight * correctedEarned,
        maximum * 100n,
      );
    }
    originalTerm = regCorrPlus(originalTerm, contribution);
    correctedTerm = regCorrPlus(correctedTerm, proposedContribution);
  }
  if (totalWeight !== 10000n)
    regCorrFail(
      "CORRECTION_TOTAL_WEIGHT_INVALID",
      "Official category weights must total 100%. ",
    );
  const sourcePct = regCorrStoredFrac(
    result.term_percentage?.exact_numerator,
    result.term_percentage?.exact_denominator,
    "term percentage",
  );
  if (!regCorrEqual(sourcePct, originalTerm)) {
    regCorrFail(
      "CORRECTION_TERM_MATH_INVALID",
      "Original term percentage does not match its assessment and attendance categories.",
    );
  }
  return {
    original: originalTerm,
    revised: correctedTerm,
    matched: matchCount,
  };
}

// POST /api/registrar/gradebook/score-correction-requests/:correctionId/apply
router.post(
  "/gradebook/score-correction-requests/:correctionId/apply",
  async (req, res) => {
    let connection;
    let inTransaction = false;
    let gradeGuard = false;
    try {
      if (Object.keys(req.query ?? {}).length) {
        regCorrFail(
          "CORRECTION_QUERY_UNSUPPORTED",
          "Query parameters are not accepted.",
          400,
        );
      }
      const correctionId = regCorrId(req.params.correctionId);
      const body = req.body;
      const userId = regCorrId(req.user?.user_id);
      if (
        !correctionId ||
        !userId ||
        !body ||
        typeof body !== "object" ||
        Array.isArray(body)
      ) {
        regCorrFail(
          "CORRECTION_INPUT_INVALID",
          "Valid correction ID, authenticated user, and JSON are required.",
          400,
        );
      }
      const allowed = new Set([
        "expected_request_version",
        "expected_score_version",
        "registrar_remarks",
        "confirm_application",
        "dry_run",
      ]);
      if (Object.keys(body).some((field) => !allowed.has(field))) {
        regCorrFail(
          "CORRECTION_FIELDS_UNSUPPORTED",
          "Unsupported fields supplied.",
          400,
        );
      }
      const expectedVersion = regCorrId(body.expected_request_version);
      const expectedScoreVersion = regCorrId(body.expected_score_version);
      const remarks =
        typeof body.registrar_remarks === "string"
          ? body.registrar_remarks.trim()
          : "";
      if (
        !expectedVersion ||
        expectedVersion >= 4294967295 ||
        !expectedScoreVersion ||
        remarks.length < 15 ||
        remarks.length > 1000 ||
        /[\x00-\x08\x0B\x0E-\x1F\x7F]/.test(remarks) ||
        body.confirm_application !== true ||
        typeof body.dry_run !== "boolean"
      ) {
        regCorrFail(
          "CORRECTION_BODY_INVALID",
          "Current request/score versions, documented registrar_remarks (15–1000), confirmation, and dry_run boolean are required.",
          400,
        );
      }

      connection = await db.getConnection();
      const [[database]] = await connection.execute(
        "SELECT DATABASE() AS database_name",
      );
      if (database?.database_name !== regCorrQADatabase) {
        regCorrFail(
          "CORRECTION_TEST_DB_ONLY",
          "Correction application is restricted to the admission-test database.",
          403,
        );
      }
      const [registrars] = await connection.execute(
        `SELECT u.user_id FROM users u JOIN roles r ON r.role_id = u.role_id
        WHERE u.user_id = ? AND u.is_active = 1 AND u.is_archived = 0
          AND r.role_name = 'Registrar'`,
        [userId],
      );
      if (registrars.length !== 1)
        regCorrFail(
          "CORRECTION_REGISTRAR_ONLY",
          "Active Registrar access is required.",
          403,
        );
      // Pooled connection bypass flags must never leak into this transaction.
      await connection.execute("SET @allow_approved_inc_grade_change = NULL");
      await connection.execute("SET @allow_approved_inc_expiry = NULL");
      await connection.execute("SET @allow_approved_grade_correction = NULL");
      await connection.beginTransaction();
      inTransaction = true;

      // Approved-grade corrections remain QA-only.
      await assertQaGradingDatabase(connection);

      const [targets] = await connection.execute(
        `SELECT r.grade_id, r.config_id, r.enrollment_subject_id, r.score_id,
              cfg.offering_id
         FROM gradebook_correction_requests r
         JOIN gradebook_offering_config cfg ON cfg.config_id = r.config_id
        WHERE r.correction_id = ?`,
        [String(correctionId)],
      );
      if (
        targets.length !== 1 ||
        Number(targets[0].offering_id) !== regCorrQAOffering
      ) {
        regCorrFail(
          "CORRECTION_NOT_FOUND",
          "Correction request is outside QA Offering #131.",
          404,
        );
      }
      const target = targets[0];
      const gradeId = Number(target.grade_id);
      const configId = Number(target.config_id);
      const enrollmentSubjectId = Number(target.enrollment_subject_id);
      const scoreId = Number(target.score_id);

      // Lock order matches Faculty and Program Head workflows.
      const [offerings] = await connection.execute(
        `SELECT so.offering_id, so.faculty_id, so.status,
              cr.department_id, f.user_id AS instructor_user_id
         FROM subject_offerings so
         JOIN sections sec ON sec.section_id = so.section_id
         JOIN courses cr ON cr.course_id = sec.course_id
         JOIN faculty f ON f.faculty_id = so.faculty_id
        WHERE so.offering_id = ? FOR UPDATE`,
        [regCorrQAOffering],
      );
      if (offerings.length !== 1 || offerings[0].status === "Cancelled") {
        regCorrFail(
          "CORRECTION_OFFERING_CHANGED",
          "The original offering is unavailable.",
        );
      }
      const [configs] = await connection.execute(
        `SELECT config_id, grading_classification, midterm_percent, final_term_percent
         FROM gradebook_offering_config WHERE config_id = ? AND offering_id = ? FOR UPDATE`,
        [configId, regCorrQAOffering],
      );
      if (
        configs.length !== 1 ||
        Number(configs[0].midterm_percent) !== 50 ||
        Number(configs[0].final_term_percent) !== 50
      ) {
        regCorrFail(
          "CORRECTION_CONFIG_INVALID",
          "The 50/50 gradebook configuration has changed.",
        );
      }
      const [subjects] = await connection.execute(
        `SELECT es.status, es.offering_id, e.enrollment_status
         FROM enrollment_subjects es JOIN enrollments e ON e.enrollment_id = es.enrollment_id
        WHERE es.enrollment_subject_id = ? FOR UPDATE`,
        [enrollmentSubjectId],
      );
      if (
        subjects.length !== 1 ||
        Number(subjects[0].offering_id) !== regCorrQAOffering ||
        subjects[0].enrollment_status !== "Approved" ||
        !["Completed", "Failed"].includes(subjects[0].status)
      ) {
        regCorrFail(
          "CORRECTION_ENROLLMENT_CHANGED",
          "Approved enrollment and completed/failed subject are required.",
        );
      }
      const [grades] = await connection.execute(
        `SELECT grade_id, enrollment_subject_id, faculty_id, grade_status,
              grading_policy, grading_outcome, midterm_grade, final_grade,
              overall_percentage, final_rating, remarks, outcome_reason
         FROM grades WHERE grade_id = ? FOR UPDATE`,
        [gradeId],
      );
      if (
        grades.length !== 1 ||
        Number(grades[0].enrollment_subject_id) !== enrollmentSubjectId ||
        grades[0].grade_status !== "Approved" ||
        grades[0].grading_policy !== "TWO_TERM_50_50" ||
        grades[0].grading_outcome !== "NUMERIC" ||
        Number(grades[0].faculty_id) !== Number(offerings[0].faculty_id)
      ) {
        regCorrFail(
          "CORRECTION_GRADE_STALE",
          "The protected published numeric grade is no longer eligible.",
        );
      }
      const grade = grades[0];
      const [publications] = await connection.execute(
        `SELECT publication_id, grade_id, config_id, enrollment_subject_id,
              midterm_submission_id, final_term_submission_id,
              overall_exact_numerator, overall_exact_denominator
         FROM gradebook_official_grade_publications WHERE grade_id = ? FOR UPDATE`,
        [gradeId],
      );
      if (
        publications.length !== 1 ||
        Number(publications[0].config_id) !== configId ||
        Number(publications[0].enrollment_subject_id) !== enrollmentSubjectId
      ) {
        regCorrFail(
          "CORRECTION_PUBLICATION_MISSING",
          "Official grade publication provenance is missing.",
        );
      }
      const pub = publications[0];
      const [attempts] = await connection.execute(
        `SELECT term_submission_id, config_id, enrollment_subject_id, grading_term,
              submission_status, term_percentage_exact_numerator,
              term_percentage_exact_denominator, calculation_snapshot_json
         FROM gradebook_term_submission_attempts
        WHERE term_submission_id IN (?, ?) FOR UPDATE`,
        [
          String(pub.midterm_submission_id),
          String(pub.final_term_submission_id),
        ],
      );
      const terms = Object.fromEntries(
        attempts.map((term) => [term.grading_term, term]),
      );
      if (
        attempts.length !== 2 ||
        !terms.MIDTERM ||
        !terms.FINAL_TERM ||
        attempts.some(
          (row) =>
            row.submission_status !== "APPROVED" ||
            Number(row.config_id) !== configId ||
            Number(row.enrollment_subject_id) !== enrollmentSubjectId,
        )
      ) {
        regCorrFail(
          "CORRECTION_APPROVED_TERMS_MISSING",
          "Both original approved term submissions are required.",
        );
      }
      const [scores] = await connection.execute(
        `SELECT sc.score_id, sc.assessment_id, sc.score_status, sc.earned_score, sc.record_version,
              sc.not_applicable_reason, a.grading_term, a.maximum_score, a.record_status,
              oc.config_id
         FROM gradebook_scores sc
         JOIN gradebook_assessments a ON a.assessment_id = sc.assessment_id
         JOIN gradebook_offering_categories oc ON oc.offering_category_id = a.offering_category_id
        WHERE sc.score_id = ? AND sc.enrollment_subject_id = ? FOR UPDATE`,
        [scoreId, enrollmentSubjectId],
      );
      if (
        scores.length !== 1 ||
        Number(scores[0].config_id) !== configId ||
        scores[0].record_status !== "ACTIVE" ||
        scores[0].score_status !== "SCORED" ||
        Number(scores[0].record_version) !== expectedScoreVersion
      ) {
        regCorrFail(
          "CORRECTION_SCORE_STALE",
          "The approved assessment score is stale or has changed.",
        );
      }
      const score = scores[0];
      const [requests] = await connection.execute(
        `SELECT * FROM gradebook_correction_requests WHERE correction_id = ? FOR UPDATE`,
        [String(correctionId)],
      );
      if (
        requests.length !== 1 ||
        requests[0].request_status !== "APPROVED" ||
        Number(requests[0].record_version) !== expectedVersion ||
        Number(requests[0].grade_id) !== gradeId ||
        Number(requests[0].config_id) !== configId ||
        Number(requests[0].enrollment_subject_id) !== enrollmentSubjectId ||
        Number(requests[0].score_id) !== scoreId ||
        Number(requests[0].score_version_at_request) !== expectedScoreVersion ||
        Number(requests[0].publication_id) !== Number(pub.publication_id) ||
        Number(requests[0].assessment_id) !== Number(score.assessment_id) ||
        String(requests[0].term_submission_id) !==
          String(terms[score.grading_term]?.term_submission_id)
      ) {
        regCorrFail(
          "CORRECTION_APPROVAL_STALE",
          "An unchanged Program Head-approved correction request is required.",
        );
      }
      const request = requests[0];
      const originalScore = regCorrMoney(
        request.original_earned_score,
        "original score",
      );
      const revisedScore = regCorrMoney(
        request.proposed_earned_score,
        "proposed score",
      );
      const maximum = regCorrMoney(
        request.maximum_score_snapshot,
        "maximum score",
      );
      if (
        originalScore !== regCorrMoney(score.earned_score, "saved score") ||
        maximum !== regCorrMoney(score.maximum_score, "assessment maximum") ||
        revisedScore === originalScore ||
        revisedScore > maximum ||
        Number(request.submitted_by_user_id) !==
          Number(offerings[0].instructor_user_id) ||
        !String(request.correction_reason ?? "").trim() ||
        !String(request.evidence_summary ?? "").trim()
      ) {
        regCorrFail(
          "CORRECTION_SCORE_SOURCE_INVALID",
          "Approved source score or Faculty evidence changed.",
        );
      }
      const [conflictingRequests] = await connection.execute(
        `SELECT grade_change_request_id FROM grade_change_requests
        WHERE grade_id = ? AND status IN ('Pending Program Head','For Registrar Processing') FOR UPDATE`,
        [gradeId],
      );
      if (conflictingRequests.length)
        regCorrFail(
          "CORRECTION_LEGACY_CONFLICT",
          "An older active grade-change request must be reconciled first.",
        );
      const [previouslyApplied] = await connection.execute(
        `SELECT correction_id FROM gradebook_correction_requests
        WHERE grade_id = ? AND request_status = 'APPLIED' FOR UPDATE`,
        [gradeId],
      );
      if (previouslyApplied.length)
        regCorrFail(
          "CORRECTION_PRIOR_AMENDMENT_REVIEW",
          "Additional corrections require a controlled multi-amendment workflow.",
        );
      const [heads] = await connection.execute(
        `SELECT ph.department_id FROM users u
         JOIN roles r ON r.role_id = u.role_id
         JOIN faculty f ON f.user_id = u.user_id
         JOIN program_heads ph ON ph.faculty_id = f.faculty_id
        WHERE u.user_id = ? AND u.is_active = 1 AND u.is_archived = 0
          AND r.role_name = 'Program Head' AND ph.is_active = 1
          AND (ph.start_date IS NULL OR ph.start_date <= CURDATE())
          AND (ph.end_date IS NULL OR ph.end_date >= CURDATE())`,
        [request.reviewed_by_user_id],
      );
      if (
        !heads.some(
          (head) =>
            Number(head.department_id) === Number(offerings[0].department_id),
        ) ||
        !request.reviewed_at ||
        !String(request.review_remarks ?? "").trim()
      ) {
        regCorrFail(
          "CORRECTION_REVIEWER_INVALID",
          "The approving Program Head is no longer authorized for this offering.",
        );
      }
      const [events] = await connection.execute(
        `SELECT event_type, previous_status, new_status, proposal_snapshot_json,
              performed_by_user_id, request_version_after
         FROM gradebook_correction_request_events
        WHERE correction_id = ? ORDER BY request_version_after, event_id FOR UPDATE`,
        [String(correctionId)],
      );
      const validChain =
        events.length === expectedVersion &&
        events.every((event, index) => {
          if (Number(event.request_version_after) !== index + 1) return false;
          if (index === 0)
            return (
              event.event_type === "SUBMITTED" &&
              event.previous_status === null &&
              event.new_status === "SUBMITTED" &&
              Number(event.performed_by_user_id) ===
                Number(request.submitted_by_user_id)
            );
          if (event.previous_status !== events[index - 1].new_status)
            return false;
          return (
            (event.event_type === "RETURNED" &&
              event.previous_status === "SUBMITTED" &&
              event.new_status === "RETURNED") ||
            (event.event_type === "RESUBMITTED" &&
              event.previous_status === "RETURNED" &&
              event.new_status === "SUBMITTED" &&
              Number(event.performed_by_user_id) ===
                Number(request.submitted_by_user_id)) ||
            (event.event_type === "APPROVED" &&
              event.previous_status === "SUBMITTED" &&
              event.new_status === "APPROVED" &&
              Number(event.performed_by_user_id) ===
                Number(request.reviewed_by_user_id))
          );
        });
      const latest = events.at(-1);
      const proposal = regCorrJson(latest?.proposal_snapshot_json);
      if (
        !validChain ||
        latest?.event_type !== "APPROVED" ||
        latest.new_status !== "APPROVED" ||
        !proposal ||
        proposal.correction_scope !== "ONE_ASSESSMENT_SCORE" ||
        Number(proposal.grade_id) !== gradeId ||
        Number(proposal.assessment_id) !== Number(request.assessment_id) ||
        Number(proposal.score_id) !== scoreId ||
        Number(proposal.score_version_at_request) !== expectedScoreVersion ||
        regCorrMoney(proposal.original_earned_score, "audit original score") !==
          originalScore ||
        regCorrMoney(proposal.proposed_earned_score, "audit proposed score") !==
          revisedScore ||
        regCorrMoney(proposal.maximum_score_snapshot, "audit maximum") !==
          maximum ||
        proposal.correction_reason !== request.correction_reason ||
        proposal.evidence_summary !== request.evidence_summary
      ) {
        regCorrFail(
          "CORRECTION_AUDIT_INVALID",
          "Program Head approval does not match its complete audit history.",
        );
      }
      const original = regCorrJson(request.original_grade_snapshot_json);
      if (
        !original ||
        Number(original.grade_id) !== gradeId ||
        String(original.publication_id) !== String(pub.publication_id) ||
        String(original.midterm_submission_id) !==
          String(pub.midterm_submission_id) ||
        String(original.final_term_submission_id) !==
          String(pub.final_term_submission_id) ||
        original.grade_status !== "Approved" ||
        original.grading_outcome !== "NUMERIC" ||
        ![
          "midterm_grade",
          "final_grade",
          "overall_percentage",
          "final_rating",
          "remarks",
        ].every((key) => regCorrSame(original[key], grade[key]))
      ) {
        regCorrFail(
          "CORRECTION_ORIGINAL_GRADE_CHANGED",
          "Official grade no longer matches Faculty's original snapshot.",
        );
      }
      const [scoreEvents] = await connection.execute(
        `SELECT event_type, new_score_status, new_earned_score, score_version_after
         FROM gradebook_score_events WHERE score_id = ? ORDER BY score_version_after, event_id FOR UPDATE`,
        [scoreId],
      );
      const lastScoreEvent = scoreEvents.at(-1);
      if (
        scoreEvents.length !== expectedScoreVersion ||
        !scoreEvents.every(
          (ev, i) => Number(ev.score_version_after) === i + 1,
        ) ||
        !lastScoreEvent ||
        lastScoreEvent.new_score_status !== "SCORED" ||
        regCorrMoney(lastScoreEvent.new_earned_score, "last score audit") !==
          originalScore
      ) {
        regCorrFail(
          "CORRECTION_SCORE_AUDIT_INVALID",
          "Original score does not match its append-only history.",
        );
      }
      const overlay = {
        term: score.grading_term,
        assessmentId: Number(score.assessment_id),
        original: originalScore,
        maximum,
        proposed: revisedScore,
      };
      const ids = { configId, enrollmentSubjectId };
      const mid = regCorrCalculateTerm(
        terms.MIDTERM.calculation_snapshot_json,
        "MIDTERM",
        ids,
        overlay,
      );
      const fin = regCorrCalculateTerm(
        terms.FINAL_TERM.calculation_snapshot_json,
        "FINAL_TERM",
        ids,
        overlay,
      );
      if (
        mid.matched + fin.matched !== 1 ||
        !regCorrEqual(
          mid.original,
          regCorrStoredFrac(
            terms.MIDTERM.term_percentage_exact_numerator,
            terms.MIDTERM.term_percentage_exact_denominator,
            "approved Midterm",
          ),
        ) ||
        !regCorrEqual(
          fin.original,
          regCorrStoredFrac(
            terms.FINAL_TERM.term_percentage_exact_numerator,
            terms.FINAL_TERM.term_percentage_exact_denominator,
            "approved Final Term",
          ),
        )
      ) {
        regCorrFail(
          "CORRECTION_TERM_SOURCE_INVALID",
          "Proposed assessment is not uniquely linked to the approved term math.",
        );
      }
      const originalOverall = regCorrHalf(
        regCorrPlus(mid.original, fin.original),
      );
      const correctedOverall = regCorrHalf(
        regCorrPlus(mid.revised, fin.revised),
      );
      if (
        !regCorrEqual(
          originalOverall,
          regCorrStoredFrac(
            pub.overall_exact_numerator,
            pub.overall_exact_denominator,
            "publication overall",
          ),
        ) ||
        regCorrDecimal(grade.midterm_grade, 12) !==
          regCorrDecimal(regCorrFormat(mid.original), 12) ||
        regCorrDecimal(grade.final_grade, 12) !==
          regCorrDecimal(regCorrFormat(fin.original), 12) ||
        regCorrDecimal(grade.overall_percentage, 12) !==
          regCorrDecimal(regCorrFormat(originalOverall), 12) ||
        regCorrRating(originalOverall) !== Number(grade.final_rating).toFixed(2)
      ) {
        regCorrFail(
          "CORRECTION_PUBLICATION_MATH_INVALID",
          "Current official grade does not match its immutable published source.",
        );
      }
      const revisedMid = regCorrFormat(mid.revised);
      const revisedFinal = regCorrFormat(fin.revised);
      const revisedRating = regCorrRating(correctedOverall);
      const revisedRemarks =
        correctedOverall.n >= 75n * correctedOverall.d ? "Passed" : "Failed";
      // Trigger derives overall/rating from stored DECIMAL(15,12), not full rational.
      // Reject threshold-edge cases where storage rounding could change the result.
      const storedOverallScaled =
        (regCorrDecimal(revisedMid, 12) +
          regCorrDecimal(revisedFinal, 12) +
          1n) /
        2n;
      const storedOverall = regCorrFrac(storedOverallScaled, 10n ** 12n);
      if (
        regCorrRating(storedOverall) !== revisedRating ||
        storedOverall.n >= 75n * storedOverall.d !==
          correctedOverall.n >= 75n * correctedOverall.d
      ) {
        regCorrFail(
          "CORRECTION_BOUNDARY_RECONCILIATION",
          "Corrected exact grade is on a storage-rounding threshold; manual reconciliation required.",
        );
      }

      const [sheets] = await connection.execute(
        `SELECT sheet_id, sheet_status, record_version, original_official_submitted_on,
              official_submission_reference, official_date_verified_by_user_id,
              official_date_verified_at, finalized_by_user_id, finalized_at
         FROM gradebook_official_sheets WHERE config_id = ? FOR UPDATE`,
        [configId],
      );
      if (
        sheets.length !== 1 ||
        sheets[0].sheet_status !== "FINALIZED" ||
        !sheets[0].original_official_submitted_on ||
        !String(sheets[0].official_submission_reference ?? "").trim() ||
        !sheets[0].official_date_verified_by_user_id ||
        !sheets[0].official_date_verified_at ||
        !sheets[0].finalized_by_user_id ||
        !sheets[0].finalized_at
      ) {
        regCorrFail(
          "CORRECTION_SHEET_NOT_FINALIZED",
          "A finalized, Registrar-verified original official grading sheet is required before amendment.",
        );
      }
      const sheet = sheets[0];
      const [sheetEvents] = await connection.execute(
        `SELECT event_type, original_official_submitted_on, official_submission_reference,
              performed_by_user_id, record_version_after
         FROM gradebook_official_sheet_submission_events WHERE sheet_id = ?
         ORDER BY record_version_after FOR UPDATE`,
        [String(sheet.sheet_id)],
      );
      if (
        sheetEvents[0]?.event_type !== "RECORDED" ||
        !sheetEvents.some(
          (event) =>
            event.event_type === "VERIFIED" &&
            String(event.official_submission_reference) ===
              String(sheet.official_submission_reference) &&
            Number(event.performed_by_user_id) ===
              Number(sheet.official_date_verified_by_user_id),
        )
      ) {
        regCorrFail(
          "CORRECTION_SHEET_AUDIT_MISSING",
          "Official grading-sheet date verification audit is incomplete.",
        );
      }
      const [revisions] = await connection.execute(
        `SELECT sheet_revision_number FROM gradebook_sheet_amendments
        WHERE sheet_id = ? ORDER BY sheet_revision_number DESC LIMIT 1 FOR UPDATE`,
        [String(sheet.sheet_id)],
      );
      const revision = revisions.length
        ? Number(revisions[0].sheet_revision_number) + 1
        : 1;
      if (!Number.isSafeInteger(revision) || revision >= 4294967295) {
        regCorrFail(
          "CORRECTION_REVISION_LIMIT",
          "Official-sheet amendment revision limit reached.",
        );
      }
      const previous = {
        correction_id: String(correctionId),
        publication_id: String(pub.publication_id),
        grade_id: gradeId,
        enrollment_subject_id: enrollmentSubjectId,
        original_score: String(request.original_earned_score),
        original_score_version: expectedScoreVersion,
        original_grade: {
          grading_policy: grade.grading_policy,
          grading_outcome: grade.grading_outcome,
          grade_status: grade.grade_status,
          midterm_grade: grade.midterm_grade,
          final_grade: grade.final_grade,
          overall_percentage: grade.overall_percentage,
          final_rating: grade.final_rating,
          remarks: grade.remarks,
        },
      };
      const next = {
        correction_id: String(correctionId),
        change_scope: "ONE_ASSESSMENT_SCORE",
        assessment_id: Number(score.assessment_id),
        score_id: scoreId,
        previous_score_version: expectedScoreVersion,
        new_score_version: expectedScoreVersion + 1,
        original_score: String(request.original_earned_score),
        corrected_score: String(request.proposed_earned_score),
        original_term_snapshot_ids: {
          MIDTERM: String(pub.midterm_submission_id),
          FINAL_TERM: String(pub.final_term_submission_id),
        },
        original_publication_id: String(pub.publication_id),
        corrected_term_exact: {
          MIDTERM: {
            numerator: String(mid.revised.n),
            denominator: String(mid.revised.d),
          },
          FINAL_TERM: {
            numerator: String(fin.revised.n),
            denominator: String(fin.revised.d),
          },
        },
        corrected_overall_exact: {
          numerator: String(correctedOverall.n),
          denominator: String(correctedOverall.d),
        },
        corrected_midterm_grade: revisedMid,
        corrected_final_grade: revisedFinal,
        corrected_overall_percentage: regCorrFormat(correctedOverall),
        corrected_final_rating: revisedRating,
        corrected_remarks: revisedRemarks,
        review_required_for_progression: true,
      };

      const [scoreUpdate] = await connection.execute(
        `UPDATE gradebook_scores
          SET earned_score = ?, updated_by_user_id = ?, record_version = record_version + 1
        WHERE score_id = ? AND record_version = ? AND score_status = 'SCORED'
          AND earned_score = ?`,
        [
          String(request.proposed_earned_score),
          userId,
          scoreId,
          expectedScoreVersion,
          String(request.original_earned_score),
        ],
      );
      if (Number(scoreUpdate.affectedRows) !== 1)
        regCorrFail(
          "CORRECTION_SCORE_WRITE_CONFLICT",
          "Approved score changed during Registrar processing.",
        );
      const [scoreEvent] = await connection.execute(
        `INSERT INTO gradebook_score_events
        (score_id, event_type, change_context, previous_score_status, new_score_status,
         previous_earned_score, new_earned_score, previous_na_reason, new_na_reason,
         change_reason, changed_by_user_id, score_version_after)
       VALUES (?, 'UPDATED', 'AUTHORIZED_AMENDMENT', 'SCORED', 'SCORED', ?, ?, NULL, NULL, ?, ?, ?)`,
        [
          scoreId,
          String(request.original_earned_score),
          String(request.proposed_earned_score),
          `${request.correction_reason} | Registrar: ${remarks}`,
          userId,
          expectedScoreVersion + 1,
        ],
      );
      if (Number(scoreEvent.affectedRows) !== 1)
        throw new Error("Authorized score history could not be recorded.");

      await connection.execute("SET @allow_approved_grade_correction = 1");
      gradeGuard = true;
      let gradeUpdate;
      try {
        [gradeUpdate] = await connection.execute(
          `UPDATE grades
            SET midterm_grade = ?, final_grade = ?, overall_percentage = ?,
                grading_outcome = 'NUMERIC', grade_status = 'Approved', outcome_reason = NULL
          WHERE grade_id = ? AND grade_status = 'Approved'
            AND grading_policy = 'TWO_TERM_50_50' AND grading_outcome = 'NUMERIC'`,
          [revisedMid, revisedFinal, regCorrFormat(correctedOverall), gradeId],
        );
      } finally {
        await connection.execute("SET @allow_approved_grade_correction = NULL");
        gradeGuard = false;
      }
      if (Number(gradeUpdate.affectedRows) !== 1)
        regCorrFail(
          "CORRECTION_GRADE_WRITE_CONFLICT",
          "Official grade changed before correction application.",
        );
      const [[after]] = await connection.execute(
        `SELECT midterm_grade, final_grade, overall_percentage, final_rating, remarks,
              grading_outcome, grade_status FROM grades WHERE grade_id = ?`,
        [gradeId],
      );
      if (
        !after ||
        after.grade_status !== "Approved" ||
        after.grading_outcome !== "NUMERIC" ||
        regCorrDecimal(after.midterm_grade, 12) !==
          regCorrDecimal(revisedMid, 12) ||
        regCorrDecimal(after.final_grade, 12) !==
          regCorrDecimal(revisedFinal, 12) ||
        regCorrDecimal(after.overall_percentage, 12) !==
          regCorrDecimal(regCorrFormat(storedOverall), 12) ||
        Number(after.final_rating).toFixed(2) !== revisedRating ||
        after.remarks !== revisedRemarks
      ) {
        regCorrFail(
          "CORRECTION_GRADE_TRIGGER_CONFLICT",
          "Database grade trigger calculated a different official grade.",
        );
      }
      const [[subjectAfter]] = await connection.execute(
        `SELECT status FROM enrollment_subjects WHERE enrollment_subject_id = ?`,
        [enrollmentSubjectId],
      );
      const expectedStatus =
        revisedRemarks === "Passed" ? "Completed" : "Failed";
      if (!subjectAfter || subjectAfter.status !== expectedStatus) {
        regCorrFail(
          "CORRECTION_SUBJECT_TRIGGER_CONFLICT",
          "Enrollment-subject status does not match corrected official grade.",
        );
      }

      const [amendment] = await connection.execute(
        `INSERT INTO gradebook_sheet_amendments
        (sheet_id, sheet_revision_number, amendment_type, grade_change_request_id,
         roster_snapshot_id, amendment_reason, previous_values_summary, new_values_summary,
         progression_review_required, requested_by_user_id, authorized_by_user_id,
         authorized_at, verified_by_user_id, verified_at, applied_by_user_id, applied_at)
       VALUES (?, ?, 'GRADE_CORRECTION', NULL, NULL, ?, ?, ?, 1, ?, ?, ?, ?, NOW(), ?, NOW())`,
        [
          String(sheet.sheet_id),
          revision,
          remarks,
          JSON.stringify(previous),
          JSON.stringify(next),
          Number(request.submitted_by_user_id),
          Number(request.reviewed_by_user_id),
          request.reviewed_at,
          userId,
          userId,
        ],
      );
      if (Number(amendment.affectedRows) !== 1)
        throw new Error("Official-sheet amendment could not be saved.");
      const [marked] = await connection.execute(
        `UPDATE gradebook_correction_requests
          SET request_status = 'APPLIED', applied_by_user_id = ?, applied_at = NOW(6),
              record_version = record_version + 1
        WHERE correction_id = ? AND request_status = 'APPROVED' AND record_version = ?`,
        [userId, String(correctionId), expectedVersion],
      );
      if (Number(marked.affectedRows) !== 1)
        regCorrFail(
          "CORRECTION_REQUEST_WRITE_CONFLICT",
          "Approved correction request changed before application.",
        );
      const [event] = await connection.execute(
        `INSERT INTO gradebook_correction_request_events
        (correction_id, event_type, previous_status, new_status,
         proposal_snapshot_json, event_reason, performed_by_user_id, request_version_after)
       VALUES (?, 'APPLIED', 'APPROVED', 'APPLIED', ?, ?, ?, ?)`,
        [
          String(correctionId),
          JSON.stringify({
            ...proposal,
            official_sheet_id: String(sheet.sheet_id),
            sheet_revision_number: revision,
            amendment_id: String(amendment.insertId),
            new_official_grade: next,
          }),
          remarks,
          userId,
          expectedVersion + 1,
        ],
      );
      if (Number(event.affectedRows) !== 1)
        throw new Error("Correction application audit event was not saved.");
      const [trail] = await connection.execute(
        `INSERT INTO audit_trail (user_id, table_name, record_id, action,
          old_values, new_values, created_at)
       VALUES (?, 'grades', ?, 'UPDATE', ?, ?, NOW())`,
        [userId, gradeId, JSON.stringify(previous), JSON.stringify(next)],
      );
      if (Number(trail.affectedRows) !== 1)
        throw new Error("Official-grade audit trail was not saved.");
      const [log] = await connection.execute(
        `INSERT INTO audit_logs (user_id, action, table_name, record_id, description, created_at)
       VALUES (?, 'SOURCE-LINKED GRADE CORRECTION APPLIED', 'grades', ?, ?, NOW())`,
        [
          userId,
          gradeId,
          JSON.stringify({
            correction_id: String(correctionId),
            amendment_id: String(amendment.insertId),
            revision,
            progression_review_required: true,
            previous,
            next,
          }),
        ],
      );
      if (Number(log.affectedRows) !== 1)
        throw new Error("Registrar correction audit log was not saved.");

      if (body.dry_run) await connection.rollback();
      else await connection.commit();
      inTransaction = false;
      return res.json({
        success: true,
        dry_run: body.dry_run,
        persisted: !body.dry_run,
        correction_id: String(correctionId),
        grade_id: gradeId,
        publication_id: String(pub.publication_id),
        official_sheet_id: String(sheet.sheet_id),
        amendment_id: body.dry_run ? null : String(amendment.insertId),
        sheet_revision_number: revision,
        previous_grade: previous.original_grade,
        corrected_grade: {
          midterm_grade: after.midterm_grade,
          final_grade: after.final_grade,
          overall_percentage: after.overall_percentage,
          final_rating: after.final_rating,
          remarks: after.remarks,
        },
        status: body.dry_run ? "APPROVED (unchanged)" : "APPLIED",
        assessment_history_preserved: true,
        approved_term_snapshots_unchanged: true,
        academic_progression_review_required: true,
        approved_enrollments_unchanged: true,
      });
    } catch (error) {
      if (inTransaction && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("REGISTRAR CORRECTION ROLLBACK:", rollbackError);
        }
      }
      const status =
        Number.isInteger(error?.status) &&
        error.status >= 400 &&
        error.status < 500
          ? error.status
          : 500;
      if (status === 500) console.error("REGISTRAR CORRECTION ERROR:", error);
      return res.status(status).json({
        success: false,
        code: status === 500 ? "CORRECTION_APPLY_ERROR" : error.code,
        message:
          status === 500
            ? "Could not process the official score correction."
            : error.message,
      });
    } finally {
      if (connection) {
        try {
          await connection.execute(
            "SET @allow_approved_grade_correction = NULL",
          );
          await connection.execute(
            "SET @allow_approved_inc_grade_change = NULL",
          );
          await connection.execute("SET @allow_approved_inc_expiry = NULL");
        } catch (cleanupError) {
          console.error(
            "REGISTRAR CORRECTION CONNECTION CLEANUP:",
            cleanupError,
          );
          // Do not put a possibly tainted pooled session back into circulation.
          try {
            await connection.destroy();
          } catch {
            /* connection already closed */
          }
          connection = null;
        }
        connection?.release();
      }
    }
  },
);

router.get(
  "/gradebook/official-sheets/:offeringId/finalization-readiness",
  async (req, res) => {
    try {
      if (Object.keys(req.query ?? {}).length !== 0) {
        officialSheetFail(
          "SHEET_FINALIZATION_QUERY_UNSUPPORTED",
          "This endpoint does not accept query parameters.",
          400,
        );
      }
      const offeringId = readCalendarId(req.params.offeringId);
      if (!offeringId) {
        officialSheetFail(
          "SHEET_FINALIZATION_OFFERING_INVALID",
          "A positive offering ID is required.",
          400,
        );
      }
      // Allow authorized Registrars to inspect finalization readiness.
      await officialSheetRegistrar(db, req);
      const scope = await officialSheetScope(db, offeringId);
      const blockers = [];

      const [sheetRows] = await db.execute(officialSheetSelect, [
        scope.configId,
      ]);
      const sheet = sheetRows[0] ?? null;
      if (sheetRows.length !== 1) {
        blockers.push({
          code: "SHEET_NOT_RECORDED",
          message:
            "A unique official sheet with an actual original submission reference is required.",
        });
      } else if (sheet.sheet_status === "FINALIZED") {
        blockers.push({
          code: "SHEET_ALREADY_FINALIZED",
          message:
            "This sheet is already finalized; changes require an authorized amendment.",
        });
      } else {
        if (
          !sheet.original_official_submitted_on ||
          !String(sheet.official_submission_reference ?? "").trim() ||
          !sheet.official_date_verified_by_user_id ||
          !sheet.official_date_verified_at
        ) {
          blockers.push({
            code: "ORIGINAL_DATE_NOT_VERIFIED",
            message:
              "Registrar must verify the genuine original submission date and reference.",
          });
        }
        const [events] = await db.execute(
          `SELECT event_type, previous_record_version, record_version_after,
                  DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_date,
                  official_submission_reference, performed_by_user_id
             FROM gradebook_official_sheet_submission_events
            WHERE sheet_id = ? ORDER BY record_version_after, event_id`,
          [String(sheet.sheet_id)],
        );
        const first = events.find((event) => event.event_type === "RECORDED");
        const verified = events.find(
          (event) => event.event_type === "VERIFIED",
        );

        // Verify the original date was approved by a Program Head.
        const [[verifier]] = await db.execute(
          `SELECT r.role_name
             FROM users u
             JOIN roles r ON r.role_id = u.role_id
            WHERE u.user_id = ?`,
          [sheet.official_date_verified_by_user_id],
        );

        const validAudit =
          events.length === 2 &&
          first?.previous_record_version == null &&
          Number(first?.record_version_after) === 1 &&
          Number(verified?.previous_record_version) === 1 &&
          Number(verified?.record_version_after) === 2 &&
          Number(first.performed_by_user_id) > 0 &&
          Number(verified?.performed_by_user_id) ===
            Number(sheet.official_date_verified_by_user_id) &&
          first?.original_date === sheet.original_official_submitted_on &&
          verified?.original_date === sheet.original_official_submitted_on &&
          first?.official_submission_reference ===
            sheet.official_submission_reference &&
          verified?.official_submission_reference ===
            sheet.official_submission_reference &&
          Number(sheet.record_version) === 2 &&
          verifier?.role_name === "Program Head";
        if (!validAudit) {
          blockers.push({
            code: "SUBMISSION_AUDIT_NOT_VERIFIED",
            message:
              "Original submission and Registrar verification audit must match the sheet.",
          });
        }
      }

      const [roster] = await db.execute(
        `SELECT es.enrollment_subject_id, es.status AS subject_status,
                es.enrollment_type, e.enrollment_status,
                e.academic_year_id, e.semester_id, s.student_id,
                s.student_number, g.grade_id, g.grade_status, g.grading_policy,
                g.grading_outcome, g.final_rating, g.remarks,
                
                (SELECT COUNT(*)
                   FROM gradebook_official_grade_publications p
                  WHERE p.grade_id = g.grade_id
                    AND p.config_id = ?
                    AND p.enrollment_subject_id = es.enrollment_subject_id
                    AND p.grading_outcome_snapshot = 'NUMERIC'
                    AND (
                      (p.publication_source = 'TERM_PAIR'
                       AND p.combined_submission_id IS NULL
                       AND EXISTS (
                         SELECT 1
                           FROM gradebook_term_submission_attempts mt
                           JOIN gradebook_term_submission_attempts ft
                             ON ft.term_submission_id = p.final_term_submission_id
                          WHERE mt.term_submission_id = p.midterm_submission_id
                            AND mt.submission_status = 'APPROVED'
                            AND mt.grading_term = 'MIDTERM'
                            AND ft.submission_status = 'APPROVED'
                            AND ft.grading_term = 'FINAL_TERM'
                            AND mt.config_id = p.config_id
                            AND ft.config_id = p.config_id
                            AND mt.enrollment_subject_id = es.enrollment_subject_id
                            AND ft.enrollment_subject_id = es.enrollment_subject_id
                       ))
                      OR
                      (p.publication_source = 'COMBINED_SEMESTER'
                       AND p.midterm_submission_id IS NULL
                       AND p.final_term_submission_id IS NULL
                       AND EXISTS (
                         SELECT 1
                           FROM gradebook_grade_submission_attempts a
                           JOIN gradebook_official_sheets sh
                             ON sh.sheet_id = a.sheet_id
                            AND sh.config_id = p.config_id
                           JOIN gradebook_grade_submission_reviews rv
                             ON rv.submission_id = a.submission_id
                          WHERE a.submission_id = p.combined_submission_id
                            AND a.grade_id = p.grade_id
                            AND a.grading_scope = 'FULL_SEMESTER'
                            AND a.grading_outcome_snapshot = 'NUMERIC'
                            AND a.submission_status = 'APPROVED'
                            AND a.record_version = 2
                            AND rv.review_decision = 'APPROVED'
                            AND rv.grading_outcome_snapshot = 'NUMERIC'
                            AND rv.submission_version_after = a.record_version
                            AND rv.reviewed_by_user_id = a.reviewed_by_user_id
                            AND p.published_by_user_id = a.reviewed_by_user_id
                            AND a.overall_exact_numerator = p.overall_exact_numerator
                            AND a.overall_exact_denominator = p.overall_exact_denominator
                       ))
                    )) AS publication_count,

                                    (SELECT COUNT(*)
                   FROM gradebook_official_grade_publications p
                   JOIN gradebook_grade_submission_attempts a
                     ON a.submission_id = p.combined_submission_id
                    AND a.grade_id = p.grade_id
                   JOIN gradebook_grade_submission_reviews rv
                     ON rv.submission_id = a.submission_id
                  WHERE p.grade_id = g.grade_id
                    AND p.config_id = ?
                    AND p.enrollment_subject_id = es.enrollment_subject_id
                    AND p.publication_source = 'COMBINED_SEMESTER'
                    AND p.grading_outcome_snapshot = g.grading_outcome
                    AND p.grading_outcome_snapshot IN
                        ('INCOMPLETE', 'UNOFFICIAL_DROP')
                    AND p.midterm_submission_id IS NULL
                    AND p.final_term_submission_id IS NULL
                    AND a.sheet_id = ?
                    AND a.grading_scope = 'FULL_SEMESTER'
                    AND a.grading_outcome_snapshot = p.grading_outcome_snapshot
                    AND a.submission_status = 'APPROVED'
                    AND a.special_outcome_id IS NOT NULL
                    AND rv.review_decision = 'APPROVED'
                    AND rv.grading_outcome_snapshot = p.grading_outcome_snapshot
                    AND rv.submission_version_after = a.record_version
                    AND rv.reviewed_by_user_id = a.reviewed_by_user_id
                    AND p.published_by_user_id = a.reviewed_by_user_id
                ) AS modern_special_approved_count,

                (SELECT COUNT(*)
                   FROM gradebook_official_grade_publications p
                  WHERE p.grade_id = g.grade_id
                ) AS any_publication_count,

                (SELECT COUNT(*)
                   FROM gradebook_grade_submission_attempts a
                  WHERE a.grade_id = g.grade_id
                ) AS combined_attempt_count,

                (SELECT COUNT(*) FROM gradebook_special_outcomes o
                  WHERE o.grade_id = g.grade_id AND o.record_status = 'ACTIVE'
                    AND o.outcome_type = CASE
                      WHEN g.grading_outcome = 'INCOMPLETE' THEN 'INCOMPLETE'
                      WHEN g.grading_outcome = 'UNOFFICIAL_DROP' THEN 'UNOFFICIAL_DROP'
                      ELSE NULL END) AS special_outcome_count,
                (SELECT COUNT(*) FROM gradebook_inc_outcome_requests ir
                  WHERE ir.config_id = ?
                    AND ir.enrollment_subject_id = es.enrollment_subject_id
                    AND ir.request_status = 'APPROVED') AS inc_approved_count,
                (SELECT COUNT(*) FROM gradebook_ud_outcome_requests ur
                  WHERE ur.config_id = ?
                    AND ur.enrollment_subject_id = es.enrollment_subject_id
                    AND ur.request_status = 'APPROVED') AS ud_approved_count
           FROM enrollment_subjects es
           JOIN enrollments e ON e.enrollment_id = es.enrollment_id
           JOIN students s ON s.student_id = e.student_id
           LEFT JOIN grades g ON g.enrollment_subject_id = es.enrollment_subject_id
        
          WHERE es.offering_id = ?
            AND NOT (
              COALESCE(e.enrollment_status, '') = 'Rejected'
              AND COALESCE(es.status, '') = 'Enrolled'
              AND g.grade_id IS NULL
            )
          ORDER BY s.student_number, es.enrollment_subject_id
`,
        [
          scope.configId,
          scope.configId,
          sheet?.sheet_id ?? "0",
          scope.configId,
          scope.configId,
          offeringId,
        ],
      );
      if (roster.length === 0) {
        blockers.push({
          code: "ROSTER_EMPTY",
          message:
            "Cannot finalize a grading sheet without an enrolled roster.",
        });
      }
      const studentIds = new Set();
      const rowProblems = [];
      for (const row of roster) {
        const problems = [];
        if (studentIds.has(Number(row.student_id))) {
          problems.push("DUPLICATE_STUDENT_IN_OFFERING");
        }
        studentIds.add(Number(row.student_id));
        if (
          row.enrollment_status !== "Approved" ||
          Number(row.academic_year_id) !== scope.academicYearId ||
          Number(row.semester_id) !== scope.semesterId
        ) {
          problems.push("ENROLLMENT_NOT_APPROVED_OR_TERM_MISMATCH");
        }
        if (!["Dropped", "Withdrawn"].includes(row.subject_status)) {
          if (
            row.grade_status !== "Approved" ||
            row.grading_policy !== "TWO_TERM_50_50"
          ) {
            problems.push("OFFICIAL_GRADE_NOT_APPROVED");
          } else if (row.grading_outcome === "NUMERIC") {
            if (
              !["Completed", "Failed"].includes(row.subject_status) ||
              Number(row.publication_count) !== 1 ||
              !["Passed", "Failed"].includes(row.remarks) ||
              row.final_rating == null
            ) {
              problems.push("NUMERIC_GRADE_PUBLICATION_INVALID");
            }
          } else if (
            ["INCOMPLETE", "UNOFFICIAL_DROP"].includes(row.grading_outcome)
          ) {
            const modernSourcePresent =
              Number(row.any_publication_count) > 0 ||
              Number(row.combined_attempt_count) > 0;

            if (modernSourcePresent) {
              const isInc = row.grading_outcome === "INCOMPLETE";

              const sourcePrecheckValid =
                Number(row.any_publication_count) === 1 &&
                Number(row.modern_special_approved_count) === 1 &&
                Number(row.special_outcome_count) === 1 &&
                Number(row.inc_approved_count) === 0 &&
                Number(row.ud_approved_count) === 0 &&
                row.subject_status ===
                  (isInc ? "Incomplete" : "Unofficial Drop") &&
                Number(row.final_rating) === (isInc ? 4 : 6);

              if (!sourcePrecheckValid || !sheet?.sheet_id) {
                problems.push("MODERN_SPECIAL_PUBLICATION_INVALID");
              } else {
                // Read the approved combined submission and its grade.
                const [sources] = await db.execute(
                  `SELECT a.*,
                          g.grading_outcome AS current_outcome,
                          g.outcome_reason AS current_reason,
                          g.remarks AS current_remarks,
                          g.midterm_grade AS current_midterm,
                          g.final_grade AS current_final,
                          g.overall_percentage AS current_overall,
                          g.final_rating AS current_rating
                     FROM gradebook_official_grade_publications p
                     JOIN gradebook_grade_submission_attempts a
                       ON a.submission_id = p.combined_submission_id
                      AND a.grade_id = p.grade_id
                     JOIN grades g
                       ON g.grade_id = p.grade_id
                     JOIN gradebook_official_sheets sh
                       ON sh.sheet_id = a.sheet_id
                      AND sh.config_id = p.config_id
                     JOIN gradebook_submission_periods sp
                       ON sp.period_id = a.period_id
                    WHERE p.grade_id = ?
                      AND p.enrollment_subject_id = ?
                      AND p.config_id = ?
                      AND p.publication_source = 'COMBINED_SEMESTER'
                      AND sh.sheet_id = ?
                      AND sh.sheet_status = 'IN_PROGRESS'
                    
                    AND sp.department_id = ?
                    AND sp.academic_year_id = ?
                    AND sp.semester_id = ?

                    -- The publication must use the approved submission.
                    AND a.submission_status = 'APPROVED'
                    AND a.record_version = 2
                    AND a.grading_scope = 'FULL_SEMESTER'
                    AND a.grading_outcome_snapshot = p.grading_outcome_snapshot
                    AND a.special_outcome_id IS NOT NULL
                    AND a.returned_edit_scope IS NULL
                    AND a.submitted_at IS NOT NULL
                    AND a.reviewed_at IS NOT NULL
                    AND p.published_at IS NOT NULL
                    AND p.published_by_user_id = a.reviewed_by_user_id
                    AND p.midterm_submission_id IS NULL
                    AND p.final_term_submission_id IS NULL
                    AND p.overall_exact_numerator IS NULL
                    AND p.overall_exact_denominator IS NULL


                    -- Require the combined-semester structure lock.
                    AND EXISTS (
                      SELECT 1
                        FROM gradebook_structure_locks sl
                        JOIN gradebook_grade_submission_attempts first_a
                          ON first_a.submission_id = sl.first_submission_id
                       WHERE sl.config_id = p.config_id
                         AND first_a.sheet_id = a.sheet_id
                    )

                    -- Reject conflicting legacy term locks.
                    AND NOT EXISTS (
                      SELECT 1
                        FROM gradebook_term_structure_locks tl
                       WHERE tl.config_id = p.config_id
                    )

                    -- Reject mixed legacy and combined submissions.
                    AND NOT EXISTS (
                      SELECT 1
                        FROM gradebook_term_submission_attempts t
                       WHERE t.config_id = p.config_id
                    )

                    -- Reject conflicting legacy INC requests.
                    AND NOT EXISTS (
                      SELECT 1
                        FROM gradebook_inc_outcome_requests ir
                       WHERE ir.config_id = p.config_id
                         AND ir.enrollment_subject_id =
                             p.enrollment_subject_id
                         AND ir.request_status IN ('SUBMITTED', 'APPROVED')
                    )

                    -- Reject conflicting legacy UD requests.
                    AND NOT EXISTS (
                      SELECT 1
                        FROM gradebook_ud_outcome_requests ur
                       WHERE ur.config_id = p.config_id
                         AND ur.enrollment_subject_id =
                             p.enrollment_subject_id
                         AND ur.request_status IN ('SUBMITTED', 'APPROVED')
                    )

                    -- Modern grades cannot use historical reconciliation.
                    AND NOT EXISTS (
                      SELECT 1
                        FROM gradebook_historical_grade_source_reviews h
                       WHERE h.grade_id = p.grade_id
                    )


                    -- A newer submission must not exist.
                    AND NOT EXISTS (
                      SELECT 1
                        FROM gradebook_grade_submission_attempts newer
                       WHERE newer.grade_id = a.grade_id
                         AND newer.attempt_number > a.attempt_number
                    )

                    -- Verify the linked Program Head approval.
                    AND EXISTS (
                      SELECT 1
                        FROM gradebook_grade_submission_reviews rv
                       WHERE rv.submission_id = a.submission_id
                         AND rv.review_decision = 'APPROVED'
                         AND rv.grading_outcome_snapshot =
                             a.grading_outcome_snapshot
                         AND rv.submission_version_after = a.record_version
                         AND rv.reviewed_by_user_id = a.reviewed_by_user_id
                         AND rv.review_notes <=> a.review_remarks
                         AND rv.returned_edit_scope IS NULL
                         AND rv.review_batch_ref IS NULL
                         AND CHAR_LENGTH(TRIM(rv.evidence_review_notes))
                             BETWEEN 20 AND 1000
                         AND rv.is_self_approval =
                             (a.submitted_by_user_id = a.reviewed_by_user_id)
                    )

                    -- Reviewer must be an active Program Head
                    -- assigned to the appropriate department.
                    AND EXISTS (
                      SELECT 1
                        FROM users reviewer
                        JOIN roles role
                          ON role.role_id = reviewer.role_id
                       WHERE reviewer.user_id = a.reviewed_by_user_id
                         AND reviewer.is_active = 1
                         AND reviewer.is_archived = 0
                         AND role.role_name = 'Program Head'
                         AND EXISTS (
                           SELECT 1
                             FROM program_heads ph
                             JOIN faculty pf
                               ON pf.faculty_id = ph.faculty_id
                            WHERE pf.user_id = reviewer.user_id
                              AND ph.department_id = sp.department_id
                              AND ph.is_active = 1
                         )
                    )

                    -- The submitting instructor must match the offering.
                    AND EXISTS (
                      SELECT 1
                        FROM gradebook_offering_config cfg
                        JOIN subject_offerings so
                          ON so.offering_id = cfg.offering_id
                        JOIN faculty instructor
                          ON instructor.faculty_id = so.faculty_id
                       WHERE cfg.config_id = p.config_id
                         AND instructor.faculty_id = g.faculty_id
                         AND instructor.user_id = a.submitted_by_user_id
                    )`,

                  [
                    row.grade_id,
                    row.enrollment_subject_id,
                    scope.configId,
                    String(sheet.sheet_id),
                    scope.departmentId,
                    scope.academicYearId,
                    scope.semesterId,
                  ],
                );

                const source = sources.length === 1 ? sources[0] : null;

                let snapshot = null;

                try {
                  snapshot = source
                    ? typeof source.calculation_snapshot_json === "string"
                      ? JSON.parse(source.calculation_snapshot_json)
                      : source.calculation_snapshot_json
                    : null;
                } catch {
                  // Unreadable snapshots cannot be accepted as evidence.
                }

                if (
                  !source ||
                  !snapshot ||
                  typeof snapshot !== "object" ||
                  Array.isArray(snapshot)
                ) {
                  problems.push("MODERN_SPECIAL_EVIDENCE_INVALID");
                } else {
                  const grade = {
                    grade_id: row.grade_id,
                    grading_outcome: source.current_outcome,
                    outcome_reason: source.current_reason,
                    remarks: source.current_remarks,
                    midterm_grade: source.current_midterm,
                    final_grade: source.current_final,
                    overall_percentage: source.current_overall,
                    final_rating: source.current_rating,
                  };

                  const target = {
                    offering_id: offeringId,
                    config_id: scope.configId,
                    enrollment_subject_id: row.enrollment_subject_id,
                    grade_id: row.grade_id,
                    sheet_id: source.sheet_id,
                    period_id: source.period_id,
                  };

                  try {
                    await validateOfficialSheetSpecialEvidence(
                      db,
                      target,
                      grade,
                      source,
                      snapshot,
                      Number(source.reviewed_by_user_id),
                      {
                        expectedSubmissionVersion: 2,
                        lock: false,
                      },
                    );

                    // Evidence passed, but full publication-source
                    // validation is still required before finalization.
                    problems.push(
                      "MODERN_SPECIAL_REQUIRES_PROGRAM_HEAD_SOURCE_VALIDATION",
                    );
                  } catch (error) {
                    if (
                      error?.code ===
                        "COMBINED_APPROVAL_SPECIAL_EVIDENCE_INVALID" ||
                      error?.code ===
                        "COMBINED_APPROVAL_EXACT_SOURCE_INVALID" ||
                      error?.code === "COMBINED_APPROVAL_PERCENT_INVALID" ||
                      (typeof error?.code === "string" &&
                        error.code.startsWith("SPECIAL_APPROVAL_"))
                    ) {
                      problems.push("MODERN_SPECIAL_EVIDENCE_INVALID");
                    } else {
                      throw error;
                    }
                  }
                }
              }
            } else if (row.grading_outcome === "INCOMPLETE") {
              if (
                row.subject_status !== "Incomplete" ||
                Number(row.final_rating) !== 4 ||
                Number(row.special_outcome_count) !== 1 ||
                Number(row.inc_approved_count) !== 1
              ) {
                problems.push("INCOMPLETE_GRADE_EVIDENCE_INVALID");
              }
            } else if (
              row.subject_status !== "Unofficial Drop" ||
              Number(row.final_rating) !== 6 ||
              Number(row.special_outcome_count) !== 1 ||
              Number(row.ud_approved_count) !== 1
            ) {
              problems.push("UD_GRADE_EVIDENCE_INVALID");
            }
          } else {
            problems.push("UNSUPPORTED_OFFICIAL_OUTCOME");
          }
        } else if (row.grade_id != null && row.grade_status === "Approved") {
          problems.push("DROPPED_OR_WITHDRAWN_HAS_APPROVED_GRADE");
        }
        if (problems.length) {
          rowProblems.push({
            enrollment_subject_id: Number(row.enrollment_subject_id),
            student_number: row.student_number,
            problems,
          });
        }
      }
      if (rowProblems.length > 0) {
        blockers.push({
          code: "ROSTER_NOT_FINALIZABLE",
          message:
            "Some students still have incomplete or inconsistent official results.",
          affected_rows: rowProblems.length,
        });
      }
      if (sheet) {
        const [[snapshot]] = await db.execute(
          `SELECT COUNT(*) AS row_count FROM gradebook_finalized_roster WHERE sheet_id = ?`,
          [String(sheet.sheet_id)],
        );
        if (
          Number(snapshot.row_count) !== 0 &&
          sheet.sheet_status !== "FINALIZED"
        ) {
          blockers.push({
            code: "PARTIAL_ROSTER_SNAPSHOT_EXISTS",
            message:
              "Unexpected previous roster snapshots require Registrar reconciliation.",
          });
        }
      }
      return res.json({
        success: true,
        read_only: true,
        offering_id: offeringId,
        config_id: scope.configId,
        sheet_id: sheet ? String(sheet.sheet_id) : null,
        sheet_status: sheet?.sheet_status ?? "NOT_RECORDED",
        sheet_record_version: sheet ? Number(sheet.record_version) : null,
        official_date_verified: Boolean(
          sheet?.official_date_verified_by_user_id &&
          sheet?.official_date_verified_at,
        ),
        roster_count: roster.length,
        problematic_roster_count: rowProblems.length,
        roster_problems: rowProblems.slice(0, 25),
        blockers,
        can_finalize: blockers.length === 0,
        grades_modified: false,
        note: "Readiness is informational, not a locked authorization. Finalization must revalidate everything in one transaction.",
      });
    } catch (error) {
      return officialSheetError(res, error);
    }
  },
);

function historicalSourcePositiveId(value) {
  const text = String(value ?? "");
  if (!/^[1-9]\d*$/.test(text)) return null;
  const valueNumber = Number(text);
  return Number.isSafeInteger(valueNumber) ? valueNumber : null;
}

function historicalSourceFail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function historicalSourceSendError(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
  if (status === 500) console.error("HISTORICAL GRADE SOURCE ERROR:", error);
  return res.status(status).json({
    success: false,
    code: status === 500 ? "HISTORICAL_SOURCE_INTERNAL_ERROR" : error.code,
    message:
      status === 500
        ? "Could not register the historical grade evidence."
        : error.message,
  });
}

// POST /api/registrar/gradebook/historical-grades/:gradeId/register-source
router.post(
  "/gradebook/historical-grades/:gradeId/register-source",
  async (req, res) => {
    let connection;
    let inTransaction = false;
    try {
      const gradeId = historicalSourcePositiveId(req.params.gradeId);
      const actorId = historicalSourcePositiveId(req.user?.user_id);
      if (!gradeId || !actorId) {
        historicalSourceFail(
          "HISTORICAL_SOURCE_IDS_INVALID",
          "Valid grade and authenticated Registrar are required.",
          400,
        );
      }
      if (Object.keys(req.query ?? {}).length !== 0) {
        historicalSourceFail(
          "HISTORICAL_SOURCE_QUERY_UNSUPPORTED",
          "Query parameters are not accepted.",
          400,
        );
      }
      const body = req.body;
      const allowed = new Set([
        "source_reference",
        "evidence_summary",
        "confirm_original_approved_grade",
        "dry_run",
      ]);
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).some((field) => !allowed.has(field))
      ) {
        historicalSourceFail(
          "HISTORICAL_SOURCE_BODY_INVALID",
          "Invalid or unsupported JSON body.",
          400,
        );
      }
      const sourceReference =
        typeof body.source_reference === "string"
          ? body.source_reference.trim()
          : "";
      const evidenceSummary =
        typeof body.evidence_summary === "string"
          ? body.evidence_summary.trim()
          : "";
      if (
        sourceReference.length < 8 ||
        sourceReference.length > 255 ||
        evidenceSummary.length < 30 ||
        evidenceSummary.length > 4000 ||
        /[\x00-\x08\x0B\x0E-\x1F\x7F]/.test(
          sourceReference + evidenceSummary,
        ) ||
        body.confirm_original_approved_grade !== true ||
        typeof body.dry_run !== "boolean"
      ) {
        historicalSourceFail(
          "HISTORICAL_SOURCE_EVIDENCE_INVALID",
          "A real source reference (8–255 chars), evidence (30–4000 chars), confirmation and boolean dry_run are required.",
          400,
        );
      }

      connection = await db.getConnection();
      const [[database]] = await connection.execute(
        "SELECT DATABASE() AS database_name",
      );
      if (database?.database_name !== "databaseforptc1_admission_test") {
        historicalSourceFail(
          "HISTORICAL_SOURCE_QA_ONLY",
          "Source reconciliation is currently limited to the admission-test database.",
          403,
        );
      }
      const [users] = await connection.execute(
        `SELECT r.role_name, u.is_active, u.is_archived
         FROM users u JOIN roles r ON r.role_id = u.role_id
        WHERE u.user_id = ?`,
        [actorId],
      );
      if (
        users.length !== 1 ||
        users[0].role_name !== "Registrar" ||
        Number(users[0].is_active) !== 1 ||
        Number(users[0].is_archived) !== 0
      ) {
        historicalSourceFail(
          "HISTORICAL_SOURCE_REGISTRAR_REQUIRED",
          "Only an active Registrar can register historical source evidence.",
          403,
        );
      }

      await connection.beginTransaction();
      inTransaction = true;

      // Resolve the offering, then acquire its lock before touching grade rows.
      const [pointers] = await connection.execute(
        `SELECT es.offering_id FROM grades g
       JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
       WHERE g.grade_id = ?`,
        [gradeId],
      );
      if (
        pointers.length !== 1 ||
        !historicalSourcePositiveId(pointers[0].offering_id)
      ) {
        historicalSourceFail(
          "HISTORICAL_SOURCE_GRADE_NOT_FOUND",
          "Grade has no traceable subject offering.",
          404,
        );
      }
      const offeringId = Number(pointers[0].offering_id);
      const [offerings] = await connection.execute(
        `SELECT offering_id, academic_year_id, semester_id, status
         FROM subject_offerings WHERE offering_id = ? FOR UPDATE`,
        [offeringId],
      );
      if (offerings.length !== 1 || offerings[0].status === "Cancelled") {
        historicalSourceFail(
          "HISTORICAL_SOURCE_OFFERING_INVALID",
          "Offering is missing or cancelled.",
        );
      }

      const [rows] = await connection.execute(
        `SELECT g.grade_id, g.enrollment_subject_id, g.faculty_id,
              g.grade_status, g.grading_policy, g.grading_outcome,
              g.midterm_grade, g.final_grade, g.overall_percentage,
              g.final_rating, g.remarks, g.submitted_at, g.reviewed_by, g.reviewed_at,
              es.offering_id, es.status AS subject_status, es.enrollment_type,
              e.enrollment_status, e.academic_year_id, e.semester_id, e.student_id,
              s.student_number
         FROM grades g
         JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
         JOIN enrollments e ON e.enrollment_id = es.enrollment_id
         JOIN students s ON s.student_id = e.student_id
        WHERE g.grade_id = ? FOR UPDATE`,
        [gradeId],
      );
      if (rows.length !== 1 || Number(rows[0].offering_id) !== offeringId) {
        historicalSourceFail(
          "HISTORICAL_SOURCE_GRADE_MOVED",
          "Grade or its offering changed during review.",
        );
      }
      const grade = rows[0];
      if (
        grade.grade_status !== "Approved" ||
        grade.grading_outcome !== "NUMERIC" ||
        !["LEGACY", "TWO_TERM_50_50"].includes(grade.grading_policy) ||
        grade.final_rating == null ||
        !["Passed", "Failed"].includes(grade.remarks) ||
        grade.subject_status !==
          (grade.remarks === "Passed" ? "Completed" : "Failed") ||
        grade.enrollment_status !== "Approved" ||
        !grade.student_number ||
        Number(grade.academic_year_id) !==
          Number(offerings[0].academic_year_id) ||
        Number(grade.semester_id) !== Number(offerings[0].semester_id)
      ) {
        historicalSourceFail(
          "HISTORICAL_SOURCE_NOT_ELIGIBLE",
          "Only an unchanged, approved historical numeric grade with consistent enrollment status can be registered.",
        );
      }
      if (!grade.reviewed_by || !grade.reviewed_at) {
        historicalSourceFail(
          "HISTORICAL_SOURCE_APPROVAL_MISSING",
          "Existing approval reviewer and date are required; resolve unsupported historical records separately.",
        );
      }
      const [publications] = await connection.execute(
        `SELECT publication_id FROM gradebook_official_grade_publications
        WHERE grade_id = ? FOR UPDATE`,
        [gradeId],
      );
      if (publications.length !== 0) {
        historicalSourceFail(
          "HISTORICAL_SOURCE_NEW_PUBLICATION_EXISTS",
          "This grade has a new gradebook publication; use its approved source, not historical reconciliation.",
        );
      }
      // A partial or missing publication for a modern term submission is a
      // provenance problem, not evidence that a grade should be treated as old.
      const [modernAttempts] = await connection.execute(
        `SELECT t.term_submission_id
         FROM gradebook_term_submission_attempts t
         JOIN gradebook_offering_config cfg ON cfg.config_id = t.config_id
        WHERE cfg.offering_id = ? AND t.enrollment_subject_id = ?
        LIMIT 1 FOR UPDATE`,
        [offeringId, Number(grade.enrollment_subject_id)],
      );
      if (modernAttempts.length) {
        historicalSourceFail(
          "HISTORICAL_SOURCE_NEW_TERM_ATTEMPT_EXISTS",
          "This grade has modern term-submission history; missing publication evidence must be reconciled instead.",
        );
      }
      const [snapshots] = await connection.execute(
        `SELECT roster_snapshot_id FROM gradebook_finalized_roster
        WHERE grade_id = ? FOR UPDATE`,
        [gradeId],
      );
      if (snapshots.length !== 0) {
        historicalSourceFail(
          "HISTORICAL_SOURCE_ALREADY_FINALIZED",
          "This grade already belongs to a finalized roster; use a formal amendment.",
        );
      }
      const [sheetRows] = await connection.execute(
        `SELECT sh.sheet_id, sh.sheet_status FROM gradebook_official_sheets sh
       JOIN gradebook_offering_config cfg ON cfg.config_id = sh.config_id
       WHERE cfg.offering_id = ? FOR UPDATE`,
        [offeringId],
      );
      if (sheetRows.some((row) => row.sheet_status === "FINALIZED")) {
        historicalSourceFail(
          "HISTORICAL_SOURCE_SHEET_FINALIZED",
          "This official sheet is already finalized; historical review cannot bypass amendments.",
        );
      }
      const [previous] = await connection.execute(
        `SELECT historical_review_id FROM gradebook_historical_grade_source_reviews
       WHERE grade_id = ? OR enrollment_subject_id = ? FOR UPDATE`,
        [gradeId, Number(grade.enrollment_subject_id)],
      );
      if (previous.length) {
        historicalSourceFail(
          "HISTORICAL_SOURCE_ALREADY_REGISTERED",
          "The historical source already has a registered review. No duplicate review was created.",
        );
      }

      const sourceClassification =
        grade.grading_policy === "LEGACY"
          ? "LEGACY_POLICY"
          : "APPROVED_WITHOUT_PUBLICATION";
      const snapshot = {
        grade_id: gradeId,
        enrollment_subject_id: Number(grade.enrollment_subject_id),
        offering_id: offeringId,
        student_id: Number(grade.student_id),
        student_number: grade.student_number,
        faculty_id: grade.faculty_id,
        grade_status: grade.grade_status,
        grading_policy: grade.grading_policy,
        grading_outcome: grade.grading_outcome,
        midterm_grade: grade.midterm_grade,
        final_grade: grade.final_grade,
        overall_percentage: grade.overall_percentage,
        final_rating: grade.final_rating,
        remarks: grade.remarks,
        reviewed_by: grade.reviewed_by,
        reviewed_at: grade.reviewed_at,
        submitted_at: grade.submitted_at,
        subject_status: grade.subject_status,
        enrollment_status: grade.enrollment_status,
        enrollment_type: grade.enrollment_type,
        academic_year_id: grade.academic_year_id,
        semester_id: grade.semester_id,
        source_classification: sourceClassification,
        source_reference: sourceReference,
        evidence_summary: evidenceSummary,
      };
      const snapshotJson = JSON.stringify(snapshot);
      const [inserted] = await connection.execute(
        `INSERT INTO gradebook_historical_grade_source_reviews
       (grade_id, enrollment_subject_id, offering_id, source_classification,
        source_reference, evidence_summary, original_grade_snapshot_json,
        recorded_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          gradeId,
          Number(grade.enrollment_subject_id),
          offeringId,
          sourceClassification,
          sourceReference,
          evidenceSummary,
          snapshotJson,
          actorId,
        ],
      );
      if (Number(inserted.affectedRows) !== 1)
        throw new Error("Historical grade source insert failed.");
      const reviewId = String(inserted.insertId);
      const [event] = await connection.execute(
        `INSERT INTO gradebook_historical_grade_source_review_events
       (historical_review_id, event_type, previous_status, new_status,
        source_snapshot_json, event_reason, performed_by_user_id, review_version_after)
       VALUES (?, 'RECORDED', NULL, 'PENDING_PH_REVIEW', ?, ?, ?, 1)`,
        [reviewId, snapshotJson, evidenceSummary, actorId],
      );
      if (Number(event.affectedRows) !== 1)
        throw new Error("Historical source audit insert failed.");

      if (body.dry_run) await connection.rollback();
      else await connection.commit();
      inTransaction = false;
      return res.status(body.dry_run ? 200 : 201).json({
        success: true,
        dry_run: body.dry_run,
        persisted: !body.dry_run,
        historical_review_id: body.dry_run ? null : reviewId,
        grade_id: gradeId,
        offering_id: offeringId,
        source_classification: sourceClassification,
        review_status: "PENDING_PH_REVIEW",
        record_version: 1,
        approval_unchanged: true,
        official_grade_unchanged: true,
        official_sheet_unchanged: true,
        next_step:
          "Program Head independently verifies the documented historical source; this action does not authorize finalization.",
      });
    } catch (error) {
      if (inTransaction && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("HISTORICAL SOURCE ROLLBACK:", rollbackError);
        }
      }
      if (error?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          success: false,
          code: "HISTORICAL_SOURCE_ALREADY_REGISTERED",
          message:
            "A historical review already exists; reload the existing record.",
        });
      }
      return historicalSourceSendError(res, error);
    } finally {
      connection?.release();
    }
  },
);

export default router;
