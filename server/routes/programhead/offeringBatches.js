import express from "express";
import { createHash } from "node:crypto";
import db from "../../db.js";
import {
  createSystemNotification,
  findScheduleConflicts,
  hasCompleteSchedule,
  normalizeScheduleDays,
  secondsToDisplayTime,
  secondsToSqlTime,
  timeToSeconds,
  toPositiveInt,
  writeOfferingAudit,
} from "../../services/offeringBatchWorkflow.js";

const router = express.Router();

function getUser(req, res) {
  const userId = toPositiveInt(req.user?.user_id);

  if (!userId || req.user?.role_name !== "Program Head") {
    res.status(userId ? 403 : 401).json({
      success: false,
      message: userId
        ? "Program Head access is required."
        : "Authentication is required.",
    });
    return null;
  }

  return { user_id: userId };
}

async function getProgramHead(connection, userId) {
  const [rows] = await connection.execute(
    `
      SELECT
          ph.program_head_id,
          ph.department_id,
          f.faculty_id,
          d.department_name
      FROM program_heads ph
      INNER JOIN faculty f
        ON f.faculty_id = ph.faculty_id
      INNER JOIN departments d
        ON d.department_id = ph.department_id
      WHERE f.user_id = ?
        AND ph.is_active = 1
        AND (ph.start_date IS NULL OR ph.start_date <= CURDATE())
        AND (ph.end_date IS NULL OR ph.end_date >= CURDATE())
      ORDER BY ph.start_date DESC, ph.program_head_id DESC
      LIMIT 1
    `,
    [userId],
  );

  return rows[0] || null;
}

async function loadBatch(connection, batchId, userId) {
  const [batchRows] = await connection.execute(
    `
      SELECT
          cob.*,
          ay.academic_year,
          sem.semester_name,
          c.course_code,
          c.course_name,
          d.department_id,
          d.department_name,
          cu.curriculum_name
      FROM class_offering_batches cob
      INNER JOIN academic_years ay
        ON ay.academic_year_id = cob.academic_year_id
      INNER JOIN semesters sem
        ON sem.semester_id = cob.semester_id
      INNER JOIN courses c
        ON c.course_id = cob.course_id
      INNER JOIN departments d
        ON d.department_id = c.department_id
      INNER JOIN curriculum cu
        ON cu.curriculum_id = cob.curriculum_id
      WHERE cob.batch_id = ?
        AND cob.program_head_user_id = ?
      LIMIT 1
    `,
    [batchId, userId],
  );

  if (!batchRows.length) return null;

  const [offeringRows] = await connection.execute(
    `
      SELECT
          so.offering_id,
          so.batch_id,
          so.section_subject_id,
          so.subject_id,
          so.section_id,
          so.faculty_id,
          so.academic_year_id,
          so.semester_id,
          so.schedule_days,
          so.schedule_time,
          so.schedule_start_time,
          so.schedule_end_time,
          so.max_students,
          so.status AS offering_status,
          sub.subject_code,
          sub.subject_name,
          sub.units,
          sec.section_name,
          CONCAT_WS(
            ' ',
            f.first_name,
            NULLIF(f.middle_name, ''),
            f.last_name
          ) AS faculty_name
      FROM subject_offerings so
      INNER JOIN subjects sub
        ON sub.subject_id = so.subject_id
      INNER JOIN sections sec
        ON sec.section_id = so.section_id
      LEFT JOIN faculty f
        ON f.faculty_id = so.faculty_id
      WHERE so.batch_id = ?
      ORDER BY sec.section_name, sub.subject_code
    `,
    [batchId],
  );

  const [facultyRows] = await connection.execute(
    `
      SELECT
          f.faculty_id,
          f.employee_number,
          f.first_name,
          f.middle_name,
          f.last_name,
          CONCAT_WS(
            ' ',
            f.first_name,
            NULLIF(f.middle_name, ''),
            f.last_name
          ) AS faculty_name,
          r.role_name
      FROM faculty f
      INNER JOIN users u
        ON u.user_id = f.user_id
      INNER JOIN roles r
        ON r.role_id = u.role_id
      WHERE f.department_id = ?
        AND u.is_active = 1
        AND u.is_verified = 1
        AND u.is_archived = 0
        AND r.role_name IN ('Faculty', 'Program Head')
      ORDER BY f.last_name, f.first_name
    `,
    [Number(batchRows[0].department_id)],
  );

  const [facultyRequestRows] = await connection.execute(
    `
    SELECT
      fr.request_id,
      fr.offering_id,
      fr.proposed_faculty_id,
      fr.status,
      fr.requested_at,
      CONCAT_WS(
        ' ',
        f.first_name,
        NULLIF(f.middle_name, ''),
        f.last_name
      ) AS proposed_faculty_name
    FROM class_offering_faculty_requests fr
    INNER JOIN faculty f
      ON f.faculty_id = fr.proposed_faculty_id
    WHERE fr.batch_id = ?
      AND fr.status = 'Pending'
    ORDER BY fr.request_id DESC
  `,
    [batchId],
  );
  return {
    ...batchRows[0],
    offerings: offeringRows,
    faculty_options: facultyRows,
    faculty_requests: facultyRequestRows,
  };
}

router.get("/", async (req, res) => {
  const actor = getUser(req, res);
  if (!actor) return;

  try {
    const [rows] = await db.execute(
      `
        SELECT
            cob.batch_id,
            cob.academic_year_id,
            ay.academic_year,
            cob.semester_id,
            sem.semester_name,
            cob.course_id,
            c.course_code,
            c.course_name,
            cob.curriculum_id,
            cu.curriculum_name,
            cob.year_level,
            cob.batch_status,
            cob.submitted_at,
            cob.returned_at,
            cob.published_at,
            (
              SELECT COUNT(*)
              FROM subject_offerings so
              WHERE so.batch_id = cob.batch_id
            ) AS offering_count,
            (
              SELECT COUNT(*)
              FROM subject_offerings so
              WHERE so.batch_id = cob.batch_id
               AND so.schedule_days IS NOT NULL
AND so.schedule_start_time IS NOT NULL
AND so.schedule_end_time IS NOT NULL
            ) AS scheduled_count
        FROM class_offering_batches cob
        INNER JOIN academic_years ay
          ON ay.academic_year_id = cob.academic_year_id
        INNER JOIN semesters sem
          ON sem.semester_id = cob.semester_id
        INNER JOIN courses c
          ON c.course_id = cob.course_id
        INNER JOIN curriculum cu
          ON cu.curriculum_id = cob.curriculum_id
        WHERE cob.program_head_user_id = ?
        ORDER BY cob.submitted_at DESC, cob.batch_id DESC
      `,
      [actor.user_id],
    );

    return res.json({ success: true, batches: rows });
  } catch (error) {
    console.error("GET PROGRAM HEAD OFFERING BATCHES ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load assigned offering batches.",
    });
  }
});

/* Automatic Section Scheduling */

const AUTO_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function scheduleOptions(body) {
  const days = normalizeScheduleDays(body?.allowed_days);
  const startSeconds = timeToSeconds(body?.day_start || "07:00");
  const endSeconds = timeToSeconds(body?.day_end || "21:00");
  const durationMode = body?.duration_mode || "units";
  const minutesPerUnit = Number(body?.minutes_per_unit ?? 60);
  const fixedMinutes = Number(body?.fixed_minutes ?? 90);
  const slotMinutes = Number(body?.slot_minutes ?? 30);

  if (
    !days.valid ||
    days.days.length > 7 ||
    startSeconds === null ||
    endSeconds === null ||
    startSeconds >= endSeconds ||
    startSeconds % 1800 !== 0 ||
    endSeconds % 1800 !== 0 ||
    !["units", "fixed"].includes(durationMode) ||
    ![30, 60].includes(slotMinutes) ||
    ![30, 60, 90].includes(minutesPerUnit) ||
    !Number.isInteger(fixedMinutes) ||
    fixedMinutes < 30 ||
    fixedMinutes > 480 ||
    fixedMinutes % 30 !== 0 ||
    (typeof body?.replace_existing !== "undefined" &&
      typeof body.replace_existing !== "boolean")
  ) {
    return null;
  }

  return {
    days: AUTO_DAYS.filter((day) => days.days.includes(day)),
    startSeconds,
    endSeconds,
    durationMode,
    minutesPerUnit,
    fixedMinutes,
    slotSeconds: slotMinutes * 60,
    replaceExisting: body?.replace_existing === true,
  };
}

function scheduleWindow(row) {
  const start = timeToSeconds(row.schedule_start_time);
  const end = timeToSeconds(row.schedule_end_time);
  const days = normalizeScheduleDays(row.schedule_days);
  return days.valid && start !== null && end !== null && start < end
    ? { days: days.days, start, end }
    : null;
}

function scheduleClashes(candidate, other) {
  const c = scheduleWindow(candidate);
  const o = scheduleWindow(other);
  if (
    !c ||
    !o ||
    !c.days.some((day) => o.days.includes(day)) ||
    c.start >= o.end ||
    o.start >= c.end
  )
    return false;
  return (
    Number(candidate.section_id) === Number(other.section_id) ||
    Boolean(
      candidate.faculty_id &&
      other.faculty_id &&
      Number(candidate.faculty_id) === Number(other.faculty_id),
    ) ||
    Boolean(
      candidate.room_id &&
      other.room_id &&
      Number(candidate.room_id) === Number(other.room_id),
    )
  );
}

function buildAutomaticPlan(offerings, allTermOfferings, config) {
  const targets = offerings.filter(
    (offering) => config.replaceExisting || !hasCompleteSchedule(offering),
  );
  const targetIds = new Set(targets.map((item) => Number(item.offering_id)));
  const occupied = allTermOfferings.filter(
    (item) =>
      !targetIds.has(Number(item.offering_id)) && hasCompleteSchedule(item),
  );
  const sectionDayLoad = new Map();

  // Include existing section classes when balancing the available weekdays.
  for (const item of occupied) {
    const window = scheduleWindow(item);
    if (!window) continue;
    for (const day of window.days) {
      const key = `${item.section_id}:${day}`;
      sectionDayLoad.set(
        key,
        (sectionDayLoad.get(key) || 0) + (window.end - window.start) / 60,
      );
    }
  }

  const durationMinutes = (row) => {
    if (config.durationMode === "fixed") return config.fixedMinutes;
    const units = Number(row.units);
    if (!Number.isFinite(units) || units <= 0) return null;
    const rounded = Math.round((units * config.minutesPerUnit) / 30) * 30;
    return rounded >= 30 && rounded <= 480 ? rounded : null;
  };

  // Schedule the longest meetings first to reduce fragmentation.
  const sorted = targets
    .map((row) => ({ ...row, duration_minutes: durationMinutes(row) }))
    .sort(
      (a, b) =>
        (b.duration_minutes || 0) - (a.duration_minutes || 0) ||
        String(a.section_name).localeCompare(String(b.section_name)) ||
        Number(a.offering_id) - Number(b.offering_id),
    );

  const proposed = [];
  for (const row of sorted) {
    const duration = row.duration_minutes;
    if (
      duration === null ||
      duration * 60 > config.endSeconds - config.startSeconds
    ) {
      return {
        success: false,
        unschedulable: row,
        message: `No valid meeting duration for ${row.subject_code} (${row.section_name}). Adjust the time window or duration mode.`,
      };
    }

    const alternatives = [];
    for (const day of config.days) {
      for (
        let start = config.startSeconds;
        start + duration * 60 <= config.endSeconds;
        start += config.slotSeconds
      ) {
        const next = {
          offering_id: Number(row.offering_id),
          batch_id: Number(row.batch_id),
          section_id: Number(row.section_id),
          faculty_id: row.faculty_id || null,
          room_id: row.room_id || null,
          schedule_days: day,
          schedule_start_time: secondsToSqlTime(start),
          schedule_end_time: secondsToSqlTime(start + duration * 60),
        };
        if (
          ![...occupied, ...proposed].some((other) =>
            scheduleClashes(next, other),
          )
        ) {
          const load = sectionDayLoad.get(`${row.section_id}:${day}`) || 0;
          // Prefer a balanced week. Within a day, select the earliest free slot.
          alternatives.push({
            next,
            score: load * 100000 + start,
            dayIndex: config.days.indexOf(day),
            start,
          });
        }
      }
    }
    alternatives.sort(
      (a, b) =>
        a.score - b.score || a.dayIndex - b.dayIndex || a.start - b.start,
    );
    const chosen = alternatives[0]?.next;
    if (!chosen) {
      return {
        success: false,
        unschedulable: row,
        message: `No conflict-free ${duration}-minute slot for ${row.subject_code} (${row.section_name}) within the selected days and hours. Expand allowed days/hours or shorten the meeting duration. No changes were saved.`,
      };
    }
    proposed.push(chosen);
    const key = `${row.section_id}:${chosen.schedule_days}`;
    sectionDayLoad.set(key, (sectionDayLoad.get(key) || 0) + duration);
  }

  const entries = [...offerings]
    .sort(
      (a, b) =>
        String(a.section_name).localeCompare(String(b.section_name)) ||
        String(a.subject_code).localeCompare(String(b.subject_code)),
    )
    .map((row) => {
      const proposedRow = proposed.find(
        (p) => p.offering_id === Number(row.offering_id),
      );
      const day = proposedRow?.schedule_days ?? row.schedule_days;
      const start = proposedRow?.schedule_start_time ?? row.schedule_start_time;
      const end = proposedRow?.schedule_end_time ?? row.schedule_end_time;
      const startSecs = timeToSeconds(start);
      const endSecs = timeToSeconds(end);
      return {
        offering_id: Number(row.offering_id),
        section_id: Number(row.section_id),
        section_name: row.section_name,
        subject_code: row.subject_code,
        subject_name: row.subject_name,
        units: Number(row.units),
        faculty_id: row.faculty_id ?? null,
        schedule_days: day ?? null,
        schedule_start_time: start ?? null,
        schedule_end_time: end ?? null,
        schedule_time:
          startSecs !== null && endSecs !== null
            ? `${secondsToDisplayTime(startSecs)} - ${secondsToDisplayTime(endSecs)}`
            : null,
        generated: Boolean(proposedRow),
      };
    });
  return {
    success: true,
    entries,
    proposed,
    generated_count: proposed.length,
    preserved_count: offerings.length - proposed.length,
  };
}

async function handleAutoSchedule(req, res, apply) {
  const actor = getUser(req, res);
  if (!actor) return;
  const batchId = toPositiveInt(req.params.batchId);
  const config = scheduleOptions(req.body);
  if (!batchId || !config) {
    return res.status(400).json({
      success: false,
      message:
        "Provide valid allowed days, daytime start/end, meeting duration and scheduling options. Times must fall on 30-minute boundaries.",
    });
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const programHead = await getProgramHead(connection, actor.user_id);
    if (!programHead) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Active Program Head department assignment required.",
      });
    }
    const [batches] = await connection.execute(
      `SELECT cob.*, c.department_id FROM class_offering_batches cob
       INNER JOIN courses c ON c.course_id = cob.course_id
       WHERE cob.batch_id = ? AND cob.program_head_user_id = ?
       LIMIT 1 FOR UPDATE`,
      [batchId, actor.user_id],
    );
    const batch = batches[0];
    if (!batch) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Assigned offering batch not found.",
      });
    }
    if (Number(batch.department_id) !== Number(programHead.department_id)) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Batch belongs to another department.",
      });
    }

    const facultyOnlyUpdate = batch.batch_status === "Ready for Registrar";

    if (batch.batch_status !== "Pending Program Head" && !facultyOnlyUpdate) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Only pending schedules or pre-publication professor assignments can be edited.",
      });
    }

    // Serialize automatic scheduling in the same academic year and semester.
    await connection.execute(
      `SELECT academic_year_id FROM academic_years
       WHERE academic_year_id = ? FOR UPDATE`,
      [batch.academic_year_id],
    );

    const [offerings] = await connection.execute(
      `SELECT so.*, s.subject_code, s.subject_name, s.units, sec.section_name
       FROM subject_offerings so
       INNER JOIN subjects s ON s.subject_id = so.subject_id
       INNER JOIN sections sec ON sec.section_id = so.section_id
       WHERE so.batch_id = ? ORDER BY so.offering_id FOR UPDATE`,
      [batchId],
    );
    if (!offerings.length || offerings.length > 500) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: offerings.length
          ? "Maximum 500 offerings per scheduling batch."
          : "No offerings found in this batch.",
      });
    }
    const [allTermOfferings] = await connection.execute(
      `SELECT so.offering_id, so.batch_id, so.section_id, so.faculty_id,
              so.room_id, so.schedule_days, so.schedule_start_time,
              so.schedule_end_time, so.schedule_time, so.status
       FROM subject_offerings so
       WHERE so.academic_year_id = ? AND so.semester_id = ?
         AND so.status <> 'Cancelled'`,
      [batch.academic_year_id, batch.semester_id],
    );
    const plan = buildAutomaticPlan(offerings, allTermOfferings, config);
    if (!plan.success) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: plan.message,
        unschedulable_offering_id: Number(plan.unschedulable?.offering_id),
      });
    }
    const previewSignature = createHash("sha256")
      .update(
        JSON.stringify(
          plan.entries.map((row) => [
            row.offering_id,
            row.schedule_days,
            row.schedule_start_time,
            row.schedule_end_time,
            row.generated,
          ]),
        ),
      )
      .digest("hex");
    if (apply && req.body?.preview_signature !== previewSignature) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message:
          "The schedule changed since the preview. Preview again before saving.",
      });
    }
    if (apply && plan.proposed.length) {
      const ids = plan.proposed.map((row) => row.offering_id);
      const placeholders = ids.map(() => "?").join(", ");
      const [enrolled] = await connection.execute(
        `SELECT enrollment_subject_id FROM enrollment_subjects
         WHERE offering_id IN (${placeholders}) LIMIT 1`,
        ids,
      );
      if (enrolled.length) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message:
            "An affected offering has enrollment records. Automatic rescheduling is blocked.",
        });
      }
      for (const row of plan.proposed) {
        const old = offerings.find(
          (o) => Number(o.offering_id) === row.offering_id,
        );
        const start = timeToSeconds(row.schedule_start_time);
        const end = timeToSeconds(row.schedule_end_time);
        const scheduleTime = `${secondsToDisplayTime(start)} - ${secondsToDisplayTime(end)}`;
        await connection.execute(
          `UPDATE subject_offerings
           SET schedule_days = ?, schedule_start_time = ?,
               schedule_end_time = ?, schedule_time = ?, status = 'Closed'
           WHERE offering_id = ? AND batch_id = ?`,
          [
            row.schedule_days,
            row.schedule_start_time,
            row.schedule_end_time,
            scheduleTime,
            row.offering_id,
            batchId,
          ],
        );
        await writeOfferingAudit(
          connection,
          actor.user_id,
          "subject_offerings",
          row.offering_id,
          "UPDATE",
          {
            schedule_days: old.schedule_days,
            schedule_time: old.schedule_time,
            schedule_start_time: old.schedule_start_time,
            schedule_end_time: old.schedule_end_time,
            status: old.status,
          },
          {
            schedule_days: row.schedule_days,
            schedule_time: scheduleTime,
            schedule_start_time: row.schedule_start_time,
            schedule_end_time: row.schedule_end_time,
            status: "Closed",
            generated_automatically: true,
          },
        );
      }
    }
    await connection.commit();
    return res.json({
      success: true,
      message: apply
        ? `Automatic scheduling saved ${plan.generated_count} class(es); ${plan.preserved_count} kept unchanged. Review before sending to Registrar.`
        : `Preview generated ${plan.generated_count} class(es); nothing has been saved.`,
      batch_id: batchId,
      preview_only: !apply,
      preview_signature: previewSignature,
      generated_count: plan.generated_count,
      preserved_count: plan.preserved_count,
      entries: plan.entries,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("AUTO GENERATE OFFERING SCHEDULE ERROR:", error);
    return res
      .status(500)
      .json({ success: false, message: "Could not generate class schedules." });
  } finally {
    if (connection) connection.release();
  }
}

router.post("/:batchId/auto-schedule/preview", (req, res) =>
  handleAutoSchedule(req, res, false),
);
router.post("/:batchId/auto-schedule/apply", (req, res) =>
  handleAutoSchedule(req, res, true),
);

router.get("/:batchId", async (req, res) => {
  const actor = getUser(req, res);
  if (!actor) return;

  const batchId = toPositiveInt(req.params.batchId);

  if (!batchId) {
    return res.status(400).json({
      success: false,
      message: "Invalid batch ID.",
    });
  }

  try {
    const batch = await loadBatch(db, batchId, actor.user_id);

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: "Assigned offering batch not found.",
      });
    }

    return res.json({ success: true, batch });
  } catch (error) {
    console.error("GET PROGRAM HEAD OFFERING BATCH ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load the offering batch.",
    });
  }
});

router.put("/:batchId/offerings/:offeringId", async (req, res) => {
  const actor = getUser(req, res);
  if (!actor) return;

  const batchId = toPositiveInt(req.params.batchId);
  const offeringId = toPositiveInt(req.params.offeringId);
  const rawFacultyId = req.body?.faculty_id;

  const facultyId =
    rawFacultyId === null || rawFacultyId === undefined || rawFacultyId === ""
      ? null
      : toPositiveInt(rawFacultyId);

  if (
    !batchId ||
    !offeringId ||
    (rawFacultyId != null && rawFacultyId !== "" && !facultyId)
  ) {
    return res.status(400).json({
      success: false,
      message:
        "A valid batch and offering are required. Professor is optional.",
    });
  }

  const dayResult = normalizeScheduleDays(req.body?.schedule_days);

  if (!dayResult.valid) {
    return res.status(400).json({
      success: false,
      message: dayResult.invalid_value
        ? `Invalid schedule day: ${dayResult.invalid_value}.`
        : "At least one valid schedule day is required.",
    });
  }

  const startSeconds = timeToSeconds(req.body?.schedule_start_time);
  const endSeconds = timeToSeconds(req.body?.schedule_end_time);

  if (
    startSeconds === null ||
    endSeconds === null ||
    startSeconds >= endSeconds
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Provide valid start and end times; the end time must be later than the start time.",
    });
  }

  const scheduleDays = dayResult.days.join(", ");
  const scheduleStartTime = secondsToSqlTime(startSeconds);
  const scheduleEndTime = secondsToSqlTime(endSeconds);
  const scheduleTime = `${secondsToDisplayTime(startSeconds)} - ${secondsToDisplayTime(endSeconds)}`;

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const programHead = await getProgramHead(connection, actor.user_id);

    if (!programHead) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "No active Program Head department assignment was found.",
      });
    }

    const [batchRows] = await connection.execute(
      `
        SELECT *
        FROM class_offering_batches
        WHERE batch_id = ?
          AND program_head_user_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [batchId, actor.user_id],
    );

    if (!batchRows.length) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Assigned offering batch not found.",
      });
    }

    const batch = batchRows[0];

    if (batch.batch_status !== "Pending Program Head") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "Only batches pending Program Head scheduling can be edited.",
      });
    }

    /* Coordinate Manual and Automatic Scheduling */

    await connection.execute(
      `
    SELECT academic_year_id
    FROM academic_years
    WHERE academic_year_id = ?
    FOR UPDATE
  `,
      [batch.academic_year_id],
    );

    const [offeringRows] = await connection.execute(
      `
        SELECT
            so.*,
            c.department_id,
            sub.subject_code,
            sec.section_name
        FROM subject_offerings so
        INNER JOIN sections sec
          ON sec.section_id = so.section_id
        INNER JOIN courses c
          ON c.course_id = sec.course_id
        INNER JOIN subjects sub
          ON sub.subject_id = so.subject_id
        WHERE so.offering_id = ?
          AND so.batch_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [offeringId, batchId],
    );

    if (!offeringRows.length) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Offering does not belong to this batch.",
      });
    }

    const offering = offeringRows[0];

    if (Number(offering.department_id) !== Number(programHead.department_id)) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: "This batch is outside your Program Head department.",
      });
    }

    if (offering.status === "Cancelled") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "A cancelled offering cannot be scheduled.",
      });
    }

    // Professor-only update before publication

    if (facultyOnlyUpdate) {
      const currentDays = normalizeScheduleDays(offering.schedule_days);

      const sameDays =
        currentDays.valid &&
        currentDays.days.length === dayResult.days.length &&
        currentDays.days.every((day) => dayResult.days.includes(day));

      if (
        offering.status !== "Closed" ||
        !hasCompleteSchedule(offering) ||
        !sameDays ||
        timeToSeconds(offering.schedule_start_time) !== startSeconds ||
        timeToSeconds(offering.schedule_end_time) !== endSeconds
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "This batch is awaiting Registrar review. Change the professor only; class days and times are locked.",
        });
      }

      if (Number(offering.faculty_id || 0) === Number(facultyId || 0)) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "The selected professor is already assigned to this offering.",
        });
      }

      const [gradeRows] = await connection.execute(
        `
      SELECT g.grade_id
      FROM enrollment_subjects es
      INNER JOIN grades g
        ON g.enrollment_subject_id = es.enrollment_subject_id
      WHERE es.offering_id = ?
      LIMIT 1
    `,
        [offeringId],
      );

      if (gradeRows.length) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "Professor assignment cannot be changed after grades exist.",
        });
      }
    }

    let faculty = null;

    if (facultyId !== null) {
      const [facultyRows] = await connection.execute(
        `
      SELECT
        f.faculty_id,
        f.department_id,
        u.is_active,
        u.is_verified,
        u.is_archived,
        r.role_name,
        CONCAT_WS(
          ' ',
          f.first_name,
          NULLIF(f.middle_name, ''),
          f.last_name
        ) AS faculty_name
      FROM faculty f
      INNER JOIN users u
        ON u.user_id = f.user_id
      INNER JOIN roles r
        ON r.role_id = u.role_id
      WHERE f.faculty_id = ?
      LIMIT 1
      FOR UPDATE
    `,
        [facultyId],
      );

      if (!facultyRows.length) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message: "Selected professor was not found.",
        });
      }

      faculty = facultyRows[0];

      if (
        !["Faculty", "Program Head"].includes(faculty.role_name) ||
        Number(faculty.is_active) !== 1 ||
        Number(faculty.is_verified) !== 1 ||
        Number(faculty.is_archived) !== 0 ||
        Number(faculty.department_id) !== Number(programHead.department_id)
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "Select an active, verified professor from your department.",
        });
      }
    }

    const candidate = {
      academic_year_id: Number(offering.academic_year_id),
      semester_id: Number(offering.semester_id),
      section_id: Number(offering.section_id),
      faculty_id: facultyId,
      room_id: facultyOnlyUpdate ? offering.room_id : null,
      schedule_days: scheduleDays,
      schedule_time: scheduleTime,
      schedule_start_time: scheduleStartTime,
      schedule_end_time: scheduleEndTime,
    };

    const conflicts = await findScheduleConflicts(
      connection,
      candidate,
      offeringId,
    );

    if (conflicts.length) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "This schedule conflicts with an existing class.",
        conflicts,
      });
    }

    if (facultyOnlyUpdate) {
      // Preserve the submitted schedule.

      await connection.execute(
        `
      UPDATE subject_offerings
      SET faculty_id = ?
      WHERE offering_id = ?
        AND batch_id = ?
        AND status = 'Closed'
    `,
        [facultyId, offeringId, batchId],
      );
    } else {
      await connection.execute(
        `
      UPDATE subject_offerings
      SET faculty_id = ?,
          room_id = NULL,
          schedule_days = ?,
          schedule_time = ?,
          schedule_start_time = ?,
          schedule_end_time = ?,
          status = 'Closed'
      WHERE offering_id = ?
        AND batch_id = ?
    `,
        [
          facultyId,
          scheduleDays,
          scheduleTime,
          scheduleStartTime,
          scheduleEndTime,
          offeringId,
          batchId,
        ],
      );
    }

    await writeOfferingAudit(
      connection,
      actor.user_id,
      "subject_offerings",
      offeringId,
      "UPDATE",
      facultyOnlyUpdate
        ? { faculty_id: offering.faculty_id }
        : {
            faculty_id: offering.faculty_id,
            schedule_days: offering.schedule_days,
            schedule_time: offering.schedule_time,
            status: offering.status,
          },
      facultyOnlyUpdate
        ? { faculty_id: facultyId }
        : {
            faculty_id: facultyId,
            schedule_days: scheduleDays,
            schedule_time: scheduleTime,
            status: "Closed",
          },
    );

    if (facultyOnlyUpdate) {
      await createSystemNotification(
        connection,
        Number(batch.submitted_by),
        "Professor updated before publication",
        `Program Head updated the professor for offering #${offeringId} in batch #${batchId}. Review the latest assignment before publishing.`,
      );
    }

    await connection.commit();

    return res.json({
      success: true,

      message: facultyOnlyUpdate
        ? "Professor updated. Registrar will review the assignment before publication."
        : "Class schedule saved. Professor assignment is optional.",

      offering: {
        offering_id: offeringId,
        batch_id: batchId,
        faculty_id: facultyId,
        faculty_name: faculty?.faculty_name || null, //this change that faculty can be null or place empty
        schedule_days: scheduleDays,
        schedule_time: scheduleTime,
        schedule_start_time: scheduleStartTime,
        schedule_end_time: scheduleEndTime,
        status: "Closed",
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();

    console.error("SAVE PROGRAM HEAD BATCH SCHEDULE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to save the offering schedule.",
    });
  } finally {
    if (connection) connection.release();
  }
});

router.post("/:batchId/return-to-registrar", async (req, res) => {
  const actor = getUser(req, res);
  if (!actor) return;

  const batchId = toPositiveInt(req.params.batchId);

  if (!batchId) {
    return res.status(400).json({
      success: false,
      message: "Invalid batch ID.",
    });
  }

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [batchRows] = await connection.execute(
      `
        SELECT *
        FROM class_offering_batches
        WHERE batch_id = ?
          AND program_head_user_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [batchId, actor.user_id],
    );

    if (!batchRows.length) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Assigned offering batch not found.",
      });
    }

    const batch = batchRows[0];

    if (batch.batch_status !== "Pending Program Head") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Only a batch pending scheduling can be returned to the Registrar.",
      });
    }

    const [offeringRows] = await connection.execute(
      `
        SELECT *
        FROM subject_offerings
        WHERE batch_id = ?
        ORDER BY offering_id
        FOR UPDATE
      `,
      [batchId],
    );

    if (!offeringRows.length) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "This batch has no subject offerings.",
      });
    }

    const incomplete = offeringRows.filter((row) => !hasCompleteSchedule(row));

    if (incomplete.length) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Every offering must have valid class days and start/end times before submission.",
        incomplete_offering_ids: incomplete.map((row) =>
          Number(row.offering_id),
        ),
      });
    }

    for (const offering of offeringRows) {
      const conflicts = await findScheduleConflicts(
        connection,
        offering,
        Number(offering.offering_id),
      );

      if (conflicts.length) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "Resolve all schedule conflicts before returning this batch.",
          offering_id: Number(offering.offering_id),
          conflicts,
        });
      }
    }

    await connection.execute(
      `
        UPDATE class_offering_batches
        SET batch_status = 'Ready for Registrar',
            returned_by = ?,
            returned_at = NOW()
        WHERE batch_id = ?
      `,
      [actor.user_id, batchId],
    );

    await writeOfferingAudit(
      connection,
      actor.user_id,
      "class_offering_batches",
      batchId,
      "UPDATE",
      { batch_status: batch.batch_status },
      { batch_status: "Ready for Registrar" },
    );

    await createSystemNotification(
      connection,
      Number(batch.submitted_by),
      "Class offering batch ready for publication",
      `The Program Head completed and returned offering batch #${batchId}. Review it before publishing.`,
    );

    await connection.commit();

    return res.json({
      success: true,
      message: "The completed batch was returned to the Registrar for review.",
      batch_id: batchId,
      batch_status: "Ready for Registrar",
    });
  } catch (error) {
    if (connection) await connection.rollback();

    console.error("RETURN OFFERING BATCH TO REGISTRAR ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to return the offering batch to the Registrar.",
    });
  } finally {
    if (connection) connection.release();
  }
});

// Professor Assignment Request

router.post(
  "/:batchId/offerings/:offeringId/request-faculty",
  async (req, res) => {
    const actor = getUser(req, res);
    if (!actor) return;

    const batchId = toPositiveInt(req.params.batchId);
    const offeringId = toPositiveInt(req.params.offeringId);
    const facultyId = toPositiveInt(req.body?.faculty_id);

    if (!batchId || !offeringId || !facultyId) {
      return res.status(400).json({
        success: false,
        message: "Valid batch, offering, and professor IDs are required.",
      });
    }

    let connection;

    try {
      connection = await db.getConnection();
      await connection.beginTransaction();

      const programHead = await getProgramHead(connection, actor.user_id);

      if (!programHead) {
        await connection.rollback();

        return res.status(403).json({
          success: false,
          message: "Active Program Head assignment required.",
        });
      }

      const [batchRows] = await connection.execute(
        `
          SELECT cob.*, c.department_id
          FROM class_offering_batches cob
          INNER JOIN courses c
            ON c.course_id = cob.course_id
          WHERE cob.batch_id = ?
            AND cob.program_head_user_id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [batchId, actor.user_id],
      );

      const batch = batchRows[0];

      if (!batch) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message: "Assigned batch not found.",
        });
      }

      if (Number(batch.department_id) !== Number(programHead.department_id)) {
        await connection.rollback();

        return res.status(403).json({
          success: false,
          message: "This batch is outside your department.",
        });
      }

      if (batch.batch_status !== "Published") {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "Late professor assignments require a published batch.",
        });
      }

      const [offeringRows] = await connection.execute(
        `
          SELECT *
          FROM subject_offerings
          WHERE offering_id = ?
            AND batch_id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [offeringId, batchId],
      );

      const offering = offeringRows[0];

      if (
        !offering ||
        offering.status !== "Open" ||
        !hasCompleteSchedule(offering)
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "An Open offering with a valid schedule is required.",
        });
      }

      if (Number(offering.faculty_id || 0) === facultyId) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "This professor is already assigned.",
        });
      }

      const [facultyRows] = await connection.execute(
        `
          SELECT
            f.faculty_id,
            f.department_id,
            u.is_active,
            u.is_verified,
            u.is_archived,
            r.role_name
          FROM faculty f
          INNER JOIN users u
            ON u.user_id = f.user_id
          INNER JOIN roles r
            ON r.role_id = u.role_id
          WHERE f.faculty_id = ?
          LIMIT 1
        `,
        [facultyId],
      );

      const faculty = facultyRows[0];

      if (
        !faculty ||
        !["Faculty", "Program Head"].includes(faculty.role_name) ||
        Number(faculty.is_active) !== 1 ||
        Number(faculty.is_verified) !== 1 ||
        Number(faculty.is_archived) !== 0 ||
        Number(faculty.department_id) !== Number(programHead.department_id)
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "Select an active, verified professor from your department.",
        });
      }

      // Protect existing grade records.

      const [existingGrades] = await connection.execute(
        `
          SELECT g.grade_id
          FROM enrollment_subjects es
          INNER JOIN grades g
            ON g.enrollment_subject_id =
               es.enrollment_subject_id
          WHERE es.offering_id = ?
          LIMIT 1
        `,
        [offeringId],
      );

      if (existingGrades.length) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "Professor assignment is locked because grades exist.",
        });
      }

      // Check the proposed professor's schedule.

      const conflicts = await findScheduleConflicts(
        connection,
        {
          ...offering,
          faculty_id: facultyId,
        },
        offeringId,
      );

      if (conflicts.length) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "Professor has a schedule conflict.",
          conflicts,
        });
      }

      // Prevent multiple pending requests.

      const [pendingRows] = await connection.execute(
        `
          SELECT request_id
          FROM class_offering_faculty_requests
          WHERE offering_id = ?
            AND status = 'Pending'
          LIMIT 1
          FOR UPDATE
        `,
        [offeringId],
      );

      if (pendingRows.length) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "A professor request is already awaiting Registrar review.",
        });
      }

      // Create a request without modifying the published offering.

      const [inserted] = await connection.execute(
        `
          INSERT INTO class_offering_faculty_requests (
            batch_id,
            offering_id,
            proposed_faculty_id,
            original_faculty_id,
            original_schedule_days,
            original_start_time,
            original_end_time,
            status,
            requested_by
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?)
        `,
        [
          batchId,
          offeringId,
          facultyId,
          offering.faculty_id,
          offering.schedule_days,
          offering.schedule_start_time,
          offering.schedule_end_time,
          actor.user_id,
        ],
      );

      const requestId = Number(inserted.insertId);

      await writeOfferingAudit(
        connection,
        actor.user_id,
        "class_offering_faculty_requests",
        requestId,
        "INSERT",
        null,
        {
          batch_id: batchId,
          offering_id: offeringId,
          proposed_faculty_id: facultyId,
          status: "Pending",
        },
      );

      await createSystemNotification(
        connection,
        Number(batch.submitted_by),
        "Professor assignment awaiting approval",
        `Program Head proposed a professor for offering #${offeringId} in batch #${batchId}.`,
      );

      await connection.commit();

      return res.status(201).json({
        success: true,
        message:
          "Professor assignment sent to Registrar for approval. Published schedule remains unchanged.",
        request_id: requestId,
        batch_id: batchId,
        offering_id: offeringId,
        request_status: "Pending",
      });
    } catch (error) {
      if (connection) await connection.rollback();

      if (error?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          success: false,
          message: "A pending professor request already exists.",
        });
      }

      console.error("REQUEST PUBLISHED OFFERING FACULTY ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Could not submit the professor assignment.",
      });
    } finally {
      if (connection) connection.release();
    }
  },
);

export default router;
