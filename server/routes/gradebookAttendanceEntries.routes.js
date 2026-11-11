import express from "express";
import db from "../db.js";
import { loadGradebookOfferingConfig } from "../services/gradebookOfferingConfig.service.js";

const router = express.Router();
const TEST_DATABASE = "databaseforptc1_admission_test";
const TEST_OFFERING_ID = 131;

const ATTENDANCE_STATUSES = new Set([
  "PENDING",
  "PRESENT",
  "LATE",
  "ABSENT",
  "EXCUSED",
  "NOT_APPLICABLE",
]);

function positiveId(value) {
  const raw = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function fail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function sendError(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
  if (status === 500) console.error("GRADEBOOK ATTENDANCE ENTRY ERROR:", error);
  return res.status(status).json({
    success: false,
    code:
      status === 500
        ? "GRADEBOOK_INTERNAL_ERROR"
        : error.code || "GRADEBOOK_REQUEST_FAILED",
    message:
      status === 500
        ? "Could not process the attendance register."
        : error.message,
  });
}

function emptyEntry(meetingId) {
  // A missing row is pending, not absent. Do not persist placeholders on GET.
  return {
    meeting_id: meetingId,
    attendance_id: null,
    attendance_status: "PENDING",
    status_reason: null,
    record_version: null,
    recorded_at: null,
    updated_at: null,
    saved: false,
  };
}

// GET /api/gradebook/:offeringId/attendance/meetings/:meetingId/entries
// Read-only first step. Does not insert attendance rows or count blanks as absences.
router.get(
  "/:offeringId/attendance/meetings/:meetingId/entries",
  async (req, res) => {
    const offeringId = positiveId(req.params.offeringId);
    const meetingId = positiveId(req.params.meetingId);
    if (!offeringId || !meetingId) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ATTENDANCE_REFERENCE",
        message: "offeringId and meetingId must be positive integers.",
      });
    }
    if (Object.keys(req.query).length > 0) {
      return res.status(400).json({
        success: false,
        code: "UNSUPPORTED_ATTENDANCE_QUERY",
        message: "This attendance register does not accept query parameters.",
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

    let connection;
    let transactionStarted = false;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;

      // Ownership is checked before any student data is read.
      const [offeringRows] = await connection.execute(
        `SELECT so.offering_id, f.user_id AS assigned_user_id,
              u.is_active, u.is_archived, r.role_name
         FROM subject_offerings so
         LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
         LEFT JOIN users u ON u.user_id = f.user_id
         LEFT JOIN roles r ON r.role_id = u.role_id
        WHERE so.offering_id = ?`,
        [offeringId],
      );
      if (offeringRows.length !== 1) {
        fail("OFFERING_NOT_FOUND", "Subject offering was not found.", 404);
      }
      const offering = offeringRows[0];
      if (
        Number(offering.assigned_user_id) !== actorUserId ||
        Number(offering.is_active) !== 1 ||
        Number(offering.is_archived) !== 0 ||
        !["Faculty", "Program Head"].includes(offering.role_name)
      ) {
        fail(
          "GRADEBOOK_INSTRUCTOR_REQUIRED",
          "Only the active assigned instructor may view this attendance register.",
          403,
        );
      }

      const config = await loadGradebookOfferingConfig(connection, offeringId);
      if (!config.is_initialized || !positiveId(config.config_id)) {
        fail(
          "GRADEBOOK_NOT_INITIALIZED",
          "This offering has no initialized gradebook.",
          409,
        );
      }
      const configId = Number(config.config_id);

      const [meetings] = await connection.execute(
        `SELECT meeting_id, config_id, grading_term,
              DATE_FORMAT(meeting_date, '%Y-%m-%d') AS meeting_date,
              session_type,
              TIME_FORMAT(start_time, '%H:%i:%s') AS start_time,
              TIME_FORMAT(end_time, '%H:%i:%s') AS end_time,
              meeting_status, replacement_for_meeting_id,
              cancellation_reason, meeting_notes, record_version
         FROM gradebook_attendance_meetings
        WHERE meeting_id = ? AND config_id = ?`,
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
      if (
        !["MIDTERM", "FINAL_TERM"].includes(meeting.grading_term) ||
        !["SCHEDULED", "HELD", "CANCELLED"].includes(meeting.meeting_status)
      ) {
        fail(
          "ATTENDANCE_MEETING_DATA_INVALID",
          "Meeting contains an unsupported term or status.",
          409,
        );
      }

      const [rosterRows] = await connection.execute(
        `SELECT es.enrollment_subject_id, es.enrollment_id,
              es.offering_id AS current_offering_id,
              es.status AS enrollment_subject_status,
              es.enrollment_type,
              e.enrollment_status,
              s.student_id, s.student_number,
              s.first_name, s.middle_name, s.last_name,
              sec.section_name
         FROM enrollment_subjects es
         JOIN enrollments e ON e.enrollment_id = es.enrollment_id
         JOIN students s ON s.student_id = e.student_id
         LEFT JOIN sections sec ON sec.section_id = es.section_id
        WHERE (es.offering_id = ?
               AND e.enrollment_status = 'Approved'
               AND es.status = 'Enrolled')
           OR EXISTS (
             SELECT 1
               FROM gradebook_attendance_entries ae
              WHERE ae.meeting_id = ?
                AND ae.enrollment_subject_id = es.enrollment_subject_id
           )
        ORDER BY s.last_name, s.first_name, s.student_number,
                 es.enrollment_subject_id`,
        [offeringId, meetingId],
      );

      const students = [];
      const byEnrollmentSubjectId = new Map();
      let currentEligibleCount = 0;
      let historicalOnlyCount = 0;
      for (const row of rosterRows) {
        const enrollmentSubjectId = Number(row.enrollment_subject_id);
        if (
          !positiveId(enrollmentSubjectId) ||
          byEnrollmentSubjectId.has(enrollmentSubjectId)
        ) {
          fail(
            "GRADEBOOK_ROSTER_DATA_INVALID",
            "Duplicate or invalid enrollment-subject record found.",
          );
        }
        const isCurrentEligible =
          Number(row.current_offering_id) === offeringId &&
          row.enrollment_status === "Approved" &&
          row.enrollment_subject_status === "Enrolled";
        if (isCurrentEligible) currentEligibleCount += 1;
        else historicalOnlyCount += 1;

        const student = {
          enrollment_subject_id: enrollmentSubjectId,
          enrollment_id: Number(row.enrollment_id),
          student_id: Number(row.student_id),
          student_number: row.student_number,
          first_name: row.first_name,
          middle_name: row.middle_name,
          last_name: row.last_name,
          student_name: [row.first_name, row.middle_name, row.last_name]
            .map((part) => String(part ?? "").trim())
            .filter(Boolean)
            .join(" "),
          section_name: row.section_name,
          enrollment_type: row.enrollment_type,
          enrollment_status: row.enrollment_status,
          enrollment_subject_status: row.enrollment_subject_status,
          is_current_enrolled: isCurrentEligible,
          is_historical_only: !isCurrentEligible,
          attendance: emptyEntry(meetingId),
        };
        students.push(student);
        byEnrollmentSubjectId.set(enrollmentSubjectId, student);
      }

      // Fetch only existing rows; missing cells remain unsaved PENDING in the UI.
      const [attendanceRows] = await connection.execute(
        `SELECT attendance_id, meeting_id, enrollment_subject_id,
              attendance_status, status_reason, record_version,
              recorded_at, updated_at
         FROM gradebook_attendance_entries
        WHERE meeting_id = ?
        ORDER BY enrollment_subject_id, attendance_id`,
        [meetingId],
      );
      const seen = new Set();
      for (const entry of attendanceRows) {
        const enrollmentSubjectId = Number(entry.enrollment_subject_id);
        const student = byEnrollmentSubjectId.get(enrollmentSubjectId);
        if (
          !student ||
          seen.has(enrollmentSubjectId) ||
          !positiveId(entry.attendance_id) ||
          !positiveId(entry.record_version)
        ) {
          fail(
            "ATTENDANCE_ENTRY_DATA_INVALID",
            "Attendance contains an invalid, duplicate, or unassociated entry.",
          );
        }
        seen.add(enrollmentSubjectId);
        student.attendance = {
          meeting_id: meetingId,
          attendance_id: Number(entry.attendance_id),
          attendance_status: entry.attendance_status,
          status_reason: entry.status_reason,
          record_version: Number(entry.record_version),
          recorded_at: entry.recorded_at,
          updated_at: entry.updated_at,
          saved: true,
        };
      }

      // Legacy FULL_SEMESTER history is not migrated. It still blocks encoding
      // for the whole offering; new term-specific history is checked per student.
      const [legacyLockRows] = await connection.execute(
        "SELECT 1 FROM gradebook_structure_locks WHERE config_id = ? LIMIT 1",
        [configId],
      );
      const [legacySubmissionRows] = await connection.execute(
        `SELECT 1
         FROM gradebook_grade_submission_attempts sa
         JOIN grades g ON g.grade_id = sa.grade_id
         JOIN enrollment_subjects es
           ON es.enrollment_subject_id = g.enrollment_subject_id
        WHERE es.offering_id = ? LIMIT 1`,
        [offeringId],
      );
      const legacySubmissionLocked =
        legacyLockRows.length > 0 || legacySubmissionRows.length > 0;

      // A shared term structure lock forbids changing meeting definitions; it
      // does NOT prevent attendance entries for other Draft students.
      const [termLockRows] = await connection.execute(
        `SELECT 1
         FROM gradebook_term_structure_locks
        WHERE config_id = ? AND grading_term = ? LIMIT 1`,
        [configId, meeting.grading_term],
      );
      const [termSubmissionRows] = await connection.execute(
        `SELECT enrollment_subject_id, term_submission_id,
              attempt_number, submission_status
         FROM gradebook_term_submission_attempts
        WHERE config_id = ? AND grading_term = ?
        ORDER BY enrollment_subject_id,
                 attempt_number DESC, term_submission_id DESC`,
        [configId, meeting.grading_term],
      );
      const latestByStudent = new Map();
      for (const attempt of termSubmissionRows) {
        const enrollmentSubjectId = Number(attempt.enrollment_subject_id);
        if (
          !byEnrollmentSubjectId.has(enrollmentSubjectId) ||
          latestByStudent.has(enrollmentSubjectId)
        )
          continue;
        if (
          !["SUBMITTED", "APPROVED", "RETURNED"].includes(
            attempt.submission_status,
          )
        ) {
          fail(
            "GRADEBOOK_TERM_SUBMISSION_DATA_INVALID",
            "A student has an unsupported term submission status.",
          );
        }
        latestByStudent.set(enrollmentSubjectId, attempt);
      }

      let editableStudentCount = 0;
      let lockedStudentCount = 0;
      for (const student of students) {
        const latest =
          latestByStudent.get(student.enrollment_subject_id) ?? null;
        const latestStatus = latest?.submission_status ?? null;
        let lockReason = null;
        if (!student.is_current_enrolled) lockReason = "NOT_CURRENTLY_ENROLLED";
        else if (legacySubmissionLocked)
          lockReason = "LEGACY_SUBMISSION_LOCKED";
        else if (latestStatus === "SUBMITTED")
          lockReason = "TERM_AWAITING_REVIEW";
        else if (latestStatus === "APPROVED")
          lockReason = "TERM_APPROVED_LOCKED";
        else if (meeting.meeting_status !== "HELD")
          lockReason = "MEETING_NOT_HELD";
        else if (offeringId !== TEST_OFFERING_ID)
          lockReason = "TEST_OFFERING_ONLY";
        student.latest_term_submission = latest
          ? {
              term_submission_id: Number(latest.term_submission_id),
              attempt_number: Number(latest.attempt_number),
              submission_status: latestStatus,
            }
          : null;
        student.attendance_editable = lockReason === null;
        student.attendance_lock_reason = lockReason;
        if (student.attendance_editable) editableStudentCount += 1;
        else lockedStudentCount += 1;
      }
      const termStructureLocked =
        termLockRows.length > 0 || termSubmissionRows.length > 0;

      await connection.commit();
      transactionStarted = false;
      return res.json({
        success: true,
        offering_id: offeringId,
        config_id: configId,
        subject_code: config.subject_code,
        subject_name: config.subject_name,
        grading_classification: config.grading_classification,
        grading_policy: config.grading_policy,
        policy_version: config.policy_version,
        meeting: {
          meeting_id: meetingId,
          grading_term: meeting.grading_term,
          meeting_date: meeting.meeting_date,
          session_type: meeting.session_type,
          start_time: meeting.start_time,
          end_time: meeting.end_time,
          meeting_status: meeting.meeting_status,
          record_version: Number(meeting.record_version),
          cancellation_reason: meeting.cancellation_reason,
          replacement_for_meeting_id:
            meeting.replacement_for_meeting_id === null
              ? null
              : Number(meeting.replacement_for_meeting_id),
          meeting_notes: meeting.meeting_notes,
        },
        // Backward-compatible overall flag describes STRUCTURE only.
        // UI should use attendance_editable on each student for score-cell controls.
        structure_locked: legacySubmissionLocked || termStructureLocked,
        term_structure_locked: termStructureLocked,
        legacy_submission_locked: legacySubmissionLocked,
        recording_supported: editableStudentCount > 0,
        editable_student_count: editableStudentCount,
        locked_student_count: lockedStudentCount,
        roster_count: students.length,
        current_eligible_count: currentEligibleCount,
        historical_only_count: historicalOnlyCount,
        saved_attendance_count: attendanceRows.length,
        students,
      });
    } catch (error) {
      if (transactionStarted && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error(
            "GRADEBOOK ATTENDANCE ROSTER ROLLBACK ERROR:",
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

function normalizeReason(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    fail("INVALID_CHANGE_REASON", "change_reason must be text.", 400);
  }
  const reason = value.trim();
  if (!reason) return null;
  if (reason.length > 1000 || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(reason)) {
    fail(
      "INVALID_CHANGE_REASON",
      "change_reason must contain at most 1000 printable characters.",
      400,
    );
  }
  return reason;
}

function normalizeStatusReason(value, attendanceStatus) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    fail("INVALID_STATUS_REASON", "status_reason must be text or null.", 400);
  }
  const reason = typeof value === "string" ? value.trim() : null;
  if (
    reason &&
    (reason.length > 1000 || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(reason))
  ) {
    fail(
      "INVALID_STATUS_REASON",
      "status_reason must contain at most 1000 printable characters.",
      400,
    );
  }

  // Excused and N/A must be documented. Missing attendance is PENDING,
  // never an automatic ABSENT. LATE counts as present when calculating grades.
  if (attendanceStatus === "NOT_APPLICABLE" && !reason) {
    fail(
      "ATTENDANCE_NA_REASON_REQUIRED",
      "A documented status_reason is required for NOT_APPLICABLE attendance.",
      400,
    );
  }
  if (attendanceStatus === "EXCUSED" && !reason) {
    fail(
      "ATTENDANCE_EXCUSED_REASON_REQUIRED",
      "A documented status_reason is required for EXCUSED attendance.",
      400,
    );
  }
  if (
    !["NOT_APPLICABLE", "EXCUSED"].includes(attendanceStatus) &&
    reason !== null
  ) {
    fail(
      "UNEXPECTED_STATUS_REASON",
      "status_reason is supported only for EXCUSED or NOT_APPLICABLE attendance.",
      400,
    );
  }
  return reason;
}

function validateSaveBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("INVALID_ATTENDANCE_INPUT", "A JSON object is required.", 400);
  }
  const allowed = new Set([
    "enrollment_subject_id",
    "attendance_status",
    "status_reason",
    "record_version",
    "change_reason",
    "dry_run",
  ]);
  if (Object.keys(body).some((field) => !allowed.has(field))) {
    fail(
      "UNSUPPORTED_ATTENDANCE_FIELD",
      "Only enrollment_subject_id, attendance_status, status_reason, record_version, change_reason and dry_run are allowed.",
      400,
    );
  }
  const enrollmentSubjectId = positiveId(body.enrollment_subject_id);
  if (!enrollmentSubjectId) {
    fail(
      "INVALID_ENROLLMENT_SUBJECT_ID",
      "A valid enrollment_subject_id is required.",
      400,
    );
  }
  if (!ATTENDANCE_STATUSES.has(body.attendance_status)) {
    fail(
      "INVALID_ATTENDANCE_STATUS",
      "attendance_status must be PENDING, PRESENT, LATE, ABSENT, EXCUSED or NOT_APPLICABLE.",
      400,
    );
  }
  const statusReason = normalizeStatusReason(
    body.status_reason,
    body.attendance_status,
  );
  if (
    !Object.hasOwn(body, "record_version") ||
    !(
      body.record_version === null || positiveId(body.record_version) !== null
    ) ||
    typeof body.record_version === "boolean"
  ) {
    fail(
      "RECORD_VERSION_REQUIRED",
      "Use record_version: null for a new attendance entry, or its latest positive version when updating.",
      400,
    );
  }
  if (typeof body.dry_run !== "boolean") {
    fail(
      "DRY_RUN_REQUIRED",
      "Specify dry_run: true to test or false to save.",
      400,
    );
  }
  return {
    enrollmentSubjectId,
    attendanceStatus: body.attendance_status,
    statusReason,
    expectedVersion:
      body.record_version === null ? null : positiveId(body.record_version),
    changeReason: normalizeReason(body.change_reason),
    dryRun: body.dry_run,
  };
}

// POST /api/gradebook/:offeringId/attendance/meetings/:meetingId/entries
// Attendance status writes; all changes use record_version, a matching audit event,
// and a single transaction. Dry-runs roll back both the entry and its event.
router.post(
  "/:offeringId/attendance/meetings/:meetingId/entries",
  async (req, res) => {
    let input;
    try {
      input = validateSaveBody(req.body);
    } catch (error) {
      return sendError(res, error);
    }
    const offeringId = positiveId(req.params.offeringId);
    const meetingId = positiveId(req.params.meetingId);
    if (!offeringId || !meetingId) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ATTENDANCE_REFERENCE",
        message: "offeringId and meetingId must be positive integers.",
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
    if (offeringId !== TEST_OFFERING_ID) {
      return res.status(403).json({
        success: false,
        code: "TEST_OFFERING_ONLY",
        message: "Attendance saves are currently limited to Offering #131.",
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
          "Attendance saves are disabled outside the admission-test database.",
          403,
        );
      }

      // Match the offering -> gradebook config -> meeting -> student lock order.
      const [offeringRows] = await connection.execute(
        `SELECT so.offering_id, so.status, f.user_id AS assigned_user_id,
              u.is_active, u.is_archived, r.role_name
         FROM subject_offerings so
         LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
         LEFT JOIN users u ON u.user_id = f.user_id
         LEFT JOIN roles r ON r.role_id = u.role_id
        WHERE so.offering_id = ? FOR UPDATE`,
        [offeringId],
      );
      if (offeringRows.length !== 1) {
        fail("OFFERING_NOT_FOUND", "Subject offering was not found.", 404);
      }
      const offering = offeringRows[0];
      if (
        Number(offering.assigned_user_id) !== actorUserId ||
        Number(offering.is_active) !== 1 ||
        Number(offering.is_archived) !== 0 ||
        !["Faculty", "Program Head"].includes(offering.role_name)
      ) {
        fail(
          "GRADEBOOK_INSTRUCTOR_REQUIRED",
          "Only the active assigned instructor may record attendance.",
          403,
        );
      }
      if (offering.status !== "Open") {
        fail(
          "OFFERING_NOT_OPEN",
          "Attendance encoding requires an Open offering.",
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
          "The official gradebook policy failed validation.",
        );
      }

      const [meetingRows] = await connection.execute(
        `SELECT meeting_id, config_id, grading_term,
              DATE_FORMAT(meeting_date, '%Y-%m-%d') AS meeting_date,
              TIME_FORMAT(start_time, '%H:%i:%s') AS start_time,
              meeting_status, record_version
         FROM gradebook_attendance_meetings
        WHERE meeting_id = ? AND config_id = ? FOR UPDATE`,
        [meetingId, configId],
      );
      if (meetingRows.length !== 1) {
        fail(
          "ATTENDANCE_MEETING_NOT_FOUND",
          "Attendance meeting does not belong to this offering.",
          404,
        );
      }
      const meeting = meetingRows[0];
      if (meeting.meeting_status !== "HELD") {
        fail(
          "ATTENDANCE_MEETING_NOT_HELD",
          "Attendance can be recorded only for a HELD meeting.",
        );
      }
      if (!["MIDTERM", "FINAL_TERM"].includes(meeting.grading_term)) {
        fail(
          "ATTENDANCE_MEETING_DATA_INVALID",
          "Meeting has an unsupported grading term.",
        );
      }

      // Historical combined-semester submissions remain protected.
      // New term structure locks apply to meeting definitions, NOT to other
      // Draft students' attendance entries in this same class and term.
      const [legacyLocks] = await connection.execute(
        "SELECT 1 FROM gradebook_structure_locks WHERE config_id = ? LIMIT 1",
        [configId],
      );
      const [legacySubmissions] = await connection.execute(
        `SELECT 1
         FROM gradebook_grade_submission_attempts sa
         JOIN grades g ON g.grade_id = sa.grade_id
         JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
        WHERE es.offering_id = ? LIMIT 1`,
        [offeringId],
      );
      if (legacyLocks.length || legacySubmissions.length) {
        fail(
          "GRADEBOOK_LEGACY_SUBMISSION_LOCKED",
          "Legacy full-semester submission history requires the authorized correction workflow.",
        );
      }

      const [enrollmentRows] = await connection.execute(
        `SELECT es.enrollment_subject_id, es.offering_id,
              es.status AS enrollment_subject_status,
              e.enrollment_status, e.student_id,
              UNIX_TIMESTAMP(es.created_at) AS assignment_unix_seconds,
              UNIX_TIMESTAMP(e.approved_at) AS approved_unix_seconds
         FROM enrollment_subjects es
         JOIN enrollments e ON e.enrollment_id = es.enrollment_id
        WHERE es.enrollment_subject_id = ? FOR UPDATE`,
        [input.enrollmentSubjectId],
      );
      if (enrollmentRows.length !== 1) {
        fail(
          "ENROLLMENT_SUBJECT_NOT_FOUND",
          "Enrollment subject was not found.",
          404,
        );
      }
      const enrollment = enrollmentRows[0];
      if (
        Number(enrollment.offering_id) !== offeringId ||
        enrollment.enrollment_status !== "Approved" ||
        enrollment.enrollment_subject_status !== "Enrolled"
      ) {
        fail(
          "GRADEBOOK_STUDENT_NOT_ELIGIBLE",
          "This student is not currently enrolled and approved for this offering.",
        );
      }

      // Only this student's latest attempt for the meeting's grading term
      // controls attendance-cell editing. Submitted/approved terms are locked;
      // RETURNED explicitly permits student-specific correction. MIDTERM never
      // locks the same student's independent FINAL_TERM entries.
      //
      // The future term-submission and review endpoints MUST lock the same
      // subject_offerings + gradebook_offering_config rows FOR UPDATE before
      // changing submission state, to serialize against this attendance write.
      const [termAttempts] = await connection.execute(
        `SELECT term_submission_id, attempt_number, submission_status
         FROM gradebook_term_submission_attempts
        WHERE config_id = ? AND enrollment_subject_id = ?
          AND grading_term = ?
        ORDER BY attempt_number DESC, term_submission_id DESC
        LIMIT 1`,
        [configId, input.enrollmentSubjectId, meeting.grading_term],
      );
      const latestTermSubmission = termAttempts[0] ?? null;
      if (
        latestTermSubmission &&
        !["SUBMITTED", "APPROVED", "RETURNED"].includes(
          latestTermSubmission.submission_status,
        )
      ) {
        fail(
          "GRADEBOOK_TERM_SUBMISSION_DATA_INVALID",
          "This student's grading term has an unsupported submission status.",
        );
      }
      if (latestTermSubmission?.submission_status === "SUBMITTED") {
        fail(
          "GRADEBOOK_TERM_AWAITING_REVIEW",
          `This student's ${meeting.grading_term} attendance is locked until Program Head review.`,
        );
      }
      if (latestTermSubmission?.submission_status === "APPROVED") {
        fail(
          "GRADEBOOK_TERM_APPROVED_LOCKED",
          `This student's approved ${meeting.grading_term} attendance requires the formal correction workflow.`,
        );
      }

      // Meeting dates/times are recorded in Philippine local time (UTC+08:00).
      // Enrollment TIMESTAMP fields are converted to Unix seconds by MySQL,
      // avoiding differences in connection/session time zones.
      const meetingStartMs = Date.parse(
        `${meeting.meeting_date}T${meeting.start_time}+08:00`,
      );
      const assignmentSeconds = Number(enrollment.assignment_unix_seconds);
      const approvalSeconds = Number(enrollment.approved_unix_seconds);
      if (
        !Number.isFinite(meetingStartMs) ||
        !Number.isFinite(assignmentSeconds) ||
        assignmentSeconds <= 0 ||
        !Number.isFinite(approvalSeconds) ||
        approvalSeconds <= 0
      ) {
        fail(
          "ENROLLMENT_ELIGIBILITY_TIMESTAMP_INVALID",
          "Official enrollment timestamps are missing or invalid. Attendance cannot be recorded.",
        );
      }
      const eligibleFromMs =
        Math.max(assignmentSeconds, approvalSeconds) * 1000;

      // A student may not be marked as attending, absent, late, or excused
      // before both the subject assignment and enrollment approval were effective.
      // The comparison includes the time of day, even on the same date.
      if (
        meetingStartMs < eligibleFromMs &&
        !["PENDING", "NOT_APPLICABLE"].includes(input.attendanceStatus)
      ) {
        fail(
          "ATTENDANCE_BEFORE_ENROLLMENT",
          "A meeting before official enrollment must be PENDING or documented NOT_APPLICABLE.",
          409,
        );
      }

      const [existingRows] = await connection.execute(
        `SELECT attendance_id, attendance_status, status_reason,
              record_version,
              DATE_FORMAT(recorded_at, '%Y-%m-%d %H:%i:%s') AS recorded_at
         FROM gradebook_attendance_entries
        WHERE meeting_id = ? AND enrollment_subject_id = ? FOR UPDATE`,
        [meetingId, input.enrollmentSubjectId],
      );
      if (existingRows.length > 1) {
        fail(
          "ATTENDANCE_ENTRY_DATA_INVALID",
          "Duplicate attendance entries were detected.",
        );
      }
      const previous = existingRows[0] ?? null;
      if (
        (previous &&
          Number(previous.record_version) !== input.expectedVersion) ||
        (!previous && input.expectedVersion !== null)
      ) {
        fail(
          "ATTENDANCE_VERSION_CONFLICT",
          "This attendance entry changed. Reload the latest value before saving.",
        );
      }
      if (previous && Number(previous.record_version) >= 4294967295) {
        fail(
          "ATTENDANCE_VERSION_OVERFLOW",
          "Attendance record version cannot increase further.",
        );
      }

      if (
        previous &&
        previous.attendance_status === input.attendanceStatus &&
        (previous.status_reason ?? null) === input.statusReason
      ) {
        await connection.rollback();
        transactionStarted = false;
        return res.json({
          success: true,
          offering_id: offeringId,
          config_id: configId,
          meeting_id: meetingId,
          enrollment_subject_id: input.enrollmentSubjectId,
          attendance: {
            attendance_id: Number(previous.attendance_id),
            attendance_status: input.attendanceStatus,
            status_reason: input.statusReason,
            record_version: Number(previous.record_version),
            recorded_at: previous.recorded_at,
          },
          unchanged: true,
          dry_run: input.dryRun,
          persisted: !input.dryRun,
        });
      }

      let attendanceId;
      let version;
      let eventType;
      if (!previous) {
        const [insert] = await connection.execute(
          `INSERT INTO gradebook_attendance_entries
           (meeting_id, enrollment_subject_id, attendance_status,
            status_reason, record_version, recorded_by_user_id,
            updated_by_user_id, recorded_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, NOW())`,
          [
            meetingId,
            input.enrollmentSubjectId,
            input.attendanceStatus,
            input.statusReason,
            actorUserId,
            actorUserId,
          ],
        );
        attendanceId = Number(insert.insertId);
        version = 1;
        eventType = "CREATED";
      } else {
        attendanceId = Number(previous.attendance_id);
        version = Number(previous.record_version) + 1;
        const [update] = await connection.execute(
          `UPDATE gradebook_attendance_entries
            SET attendance_status = ?, status_reason = ?,
                record_version = ?, updated_by_user_id = ?, recorded_at = NOW()
          WHERE attendance_id = ? AND record_version = ?`,
          [
            input.attendanceStatus,
            input.statusReason,
            version,
            actorUserId,
            attendanceId,
            input.expectedVersion,
          ],
        );
        if (Number(update.affectedRows) !== 1) {
          fail(
            "ATTENDANCE_VERSION_CONFLICT",
            "Attendance was changed concurrently. Reload before saving.",
          );
        }
        eventType = "UPDATED";
      }
      if (!positiveId(attendanceId)) {
        throw new Error("Attendance write returned an invalid attendance ID.");
      }

      // Reuse the saved database timestamp as the audit event's new value.
      const [savedRows] = await connection.execute(
        `SELECT DATE_FORMAT(recorded_at, '%Y-%m-%d %H:%i:%s') AS recorded_at
         FROM gradebook_attendance_entries WHERE attendance_id = ?`,
        [attendanceId],
      );
      if (savedRows.length !== 1 || !savedRows[0].recorded_at) {
        throw new Error("Attendance timestamp was not available for audit.");
      }
      const recordedAt = savedRows[0].recorded_at;
      const [audit] = await connection.execute(
        `INSERT INTO gradebook_attendance_entry_events
         (attendance_id, event_type, change_context,
          previous_attendance_status, new_attendance_status,
          previous_status_reason, new_status_reason,
          previous_recorded_at, new_recorded_at,
          change_reason, changed_by_user_id, attendance_version_after)
       VALUES (?, ?, 'DRAFT_ENTRY',
               ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          attendanceId,
          eventType,
          previous?.attendance_status ?? null,
          input.attendanceStatus,
          previous?.status_reason ?? null,
          input.statusReason,
          previous?.recorded_at ?? null,
          recordedAt,
          input.changeReason,
          actorUserId,
          version,
        ],
      );
      if (Number(audit.affectedRows) !== 1) {
        throw new Error("Attendance audit event was not saved.");
      }

      const result = {
        success: true,
        offering_id: offeringId,
        config_id: configId,
        meeting_id: meetingId,
        student_id: Number(enrollment.student_id),
        enrollment_subject_id: input.enrollmentSubjectId,
        grading_term: meeting.grading_term,
        latest_term_submission_status:
          latestTermSubmission?.submission_status ?? null,
        attendance: {
          attendance_id: attendanceId,
          attendance_status: input.attendanceStatus,
          status_reason: input.statusReason,
          recorded_at: recordedAt,
          record_version: version,
        },
        previous: previous
          ? {
              attendance_status: previous.attendance_status,
              status_reason: previous.status_reason,
              recorded_at: previous.recorded_at,
              record_version: Number(previous.record_version),
            }
          : null,
        audit_event: eventType,
        unchanged: false,
        dry_run: input.dryRun,
        persisted: !input.dryRun,
      };
      if (input.dryRun) {
        await connection.rollback();
      } else {
        await connection.commit();
      }
      transactionStarted = false;
      return res.status(!input.dryRun && !previous ? 201 : 200).json(result);
    } catch (error) {
      if (transactionStarted && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error(
            "GRADEBOOK ATTENDANCE SAVE ROLLBACK ERROR:",
            rollbackError,
          );
        }
      }
      if (error?.code === "ER_DUP_ENTRY") {
        return sendError(res, {
          status: 409,
          code: "ATTENDANCE_VERSION_CONFLICT",
          message:
            "Attendance was created or updated concurrently. Reload and retry.",
        });
      }
      return sendError(res, error);
    } finally {
      connection?.release();
    }
  },
);

export default router;
