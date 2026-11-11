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

export default router;
