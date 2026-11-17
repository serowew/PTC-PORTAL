import express from "express";
import { randomUUID } from "node:crypto";
import db from "../db.js";
import { loadGradebookOfferingConfig } from "../services/gradebookOfferingConfig.service.js";
import {
  modernIncReadiness,
  createModernIncClaim,
  previewModernIncCompletion,
  submitModernIncCompletion,
} from "../services/gradebookModernIncSource.service.js";
import { submitModernScoreCorrection } from "../services/gradebookModernScoreCorrections.service.js";
import { assertQaGradingDatabase } from "../services/gradebookQaWriteGuard.service.js";

const router = express.Router();

function positiveId(value) {
  const text = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

function fail(code, message, status = 409) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function sendError(res, error) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
  if (status === 500) console.error("GRADEBOOK ROSTER ERROR:", error);
  return res.status(status).json({
    success: false,
    code:
      status === 500
        ? "GRADEBOOK_INTERNAL_ERROR"
        : (error.code ?? "GRADEBOOK_REQUEST_FAILED"),
    message:
      status === 500
        ? "Could not retrieve the gradebook roster."
        : error.message,
  });
}

function scoreCents(value, label) {
  const str = String(value ?? "").trim();
  if (!/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(str)) {
    fail("GRADEBOOK_SCORE_DATA_INVALID", `${label} is not a valid score.`);
  }
  const [whole, fraction = ""] = str.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function emptyScore(assessmentId) {
  return {
    assessment_id: assessmentId,
    score_id: null,
    score_status: "PENDING",
    earned_score: null,
    not_applicable_reason: null,
    record_version: null,
    updated_at: null,
    saved: false,
  };
}

// GET /api/gradebook/:offeringId/roster
// Read-only: approved offering assignments plus students with existing score history.
// Registration in server.js must apply authenticate + Faculty/Program Head role checks.
router.get("/:offeringId/roster", async (req, res) => {
  const offeringId = positiveId(req.params.offeringId);
  if (!offeringId) {
    return res.status(400).json({
      success: false,
      code: "INVALID_OFFERING_ID",
      message: "offeringId must be a positive integer.",
    });
  }
  if (Object.keys(req.query).length) {
    return res.status(400).json({
      success: false,
      code: "UNSUPPORTED_ROSTER_QUERY",
      message: "This roster endpoint does not accept query parameters.",
    });
  }

  let connection;
  let transactionStarted = false;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    // Check ownership before returning any student or score information.
    const [ownership] = await connection.execute(
      `SELECT so.offering_id, f.user_id AS assigned_user_id
         FROM subject_offerings so
         LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
        WHERE so.offering_id = ?`,
      [offeringId],
    );
    if (ownership.length !== 1) {
      fail("OFFERING_NOT_FOUND", "Subject offering was not found.", 404);
    }
    if (Number(ownership[0].assigned_user_id) !== Number(req.user?.user_id)) {
      fail(
        "GRADEBOOK_INSTRUCTOR_REQUIRED",
        "Only the assigned instructor may view this gradebook roster.",
        403,
      );
    }

    const config = await loadGradebookOfferingConfig(connection, offeringId);
    if (!config.is_initialized) {
      fail(
        "GRADEBOOK_NOT_INITIALIZED",
        "This offering has no initialized gradebook.",
      );
    }

    // Retrieve only ACTIVE assessment columns; archived columns remain in the DB.
    const [assessmentRows] = await connection.execute(
      `SELECT a.assessment_id, a.grading_term, a.offering_category_id,
              a.header_name, a.maximum_score, a.display_order, a.record_version,
              oc.category_code
         FROM gradebook_assessments a
         JOIN gradebook_offering_categories oc
           ON oc.offering_category_id = a.offering_category_id
        WHERE oc.config_id = ? AND a.record_status = 'ACTIVE'
        ORDER BY CASE a.grading_term WHEN 'MIDTERM' THEN 0 ELSE 1 END,
                 oc.display_order, a.display_order, a.assessment_id`,
      [config.config_id],
    );

    const makeCategories = () =>
      config.categories.map((category) => ({
        category_code: category.category_code,
        category_name: category.category_name,
        category_percent: category.category_percent,
        display_order: category.display_order,
        assessments: [],
      }));
    const terms = {
      MIDTERM: { categories: makeCategories() },
      FINAL_TERM: { categories: makeCategories() },
    };
    const assessmentById = new Map();

    for (const assessment of assessmentRows) {
      const term = terms[assessment.grading_term];
      const category = term?.categories.find(
        (item) => item.category_code === assessment.category_code,
      );
      if (!category || assessment.category_code === "ATTENDANCE") {
        fail(
          "GRADEBOOK_ASSESSMENT_DATA_INVALID",
          "An active assessment references an invalid term or category.",
        );
      }
      const assessmentId = Number(assessment.assessment_id);
      if (!positiveId(assessmentId) || assessmentById.has(assessmentId)) {
        fail(
          "GRADEBOOK_ASSESSMENT_DATA_INVALID",
          "Invalid or duplicate assessment ID.",
        );
      }
      const maximumScore = String(assessment.maximum_score);
      if (scoreCents(maximumScore, "Assessment maximum score") <= 0n) {
        fail(
          "GRADEBOOK_ASSESSMENT_DATA_INVALID",
          "Maximum score must exceed zero.",
        );
      }
      assessmentById.set(assessmentId, {
        assessment_id: assessmentId,
        maximum_score: maximumScore,
      });
      category.assessments.push({
        assessment_id: assessmentId,
        offering_category_id: Number(assessment.offering_category_id),
        header_name: assessment.header_name,
        maximum_score: maximumScore,
        display_order: Number(assessment.display_order),
        record_version: Number(assessment.record_version),
      });
    }

    // Approved enrollment subjects are the current authorized roster.
    // Also retain historical students if they have score records for this
    // offering, even if their enrollment was subsequently changed or rejected.
    const [rosterRows] = await connection.execute(
      `SELECT es.enrollment_subject_id, es.enrollment_id,
              es.offering_id AS current_offering_id,
              es.status AS enrollment_subject_status, es.enrollment_type,
              e.enrollment_status,
              s.student_id, s.student_number,
              s.first_name, s.middle_name, s.last_name,
              sec.section_name
         FROM enrollment_subjects es
         JOIN enrollments e ON e.enrollment_id = es.enrollment_id
         JOIN students s ON s.student_id = e.student_id
         LEFT JOIN sections sec ON sec.section_id = es.section_id
        WHERE (es.offering_id = ? AND e.enrollment_status = 'Approved')
           OR EXISTS (
             SELECT 1 FROM gradebook_scores historical_score
             JOIN gradebook_assessments historical_assessment
               ON historical_assessment.assessment_id = historical_score.assessment_id
             JOIN gradebook_offering_categories historical_category
               ON historical_category.offering_category_id = historical_assessment.offering_category_id
             WHERE historical_score.enrollment_subject_id = es.enrollment_subject_id
               AND historical_category.config_id = ?
           )
        ORDER BY s.last_name, s.first_name, s.student_number,
                 es.enrollment_subject_id`,
      [offeringId, config.config_id],
    );

    const students = [];
    const studentByEnrollmentSubject = new Map();
    let currentRosterCount = 0;
    let historicalRosterCount = 0;

    for (const row of rosterRows) {
      const enrollmentSubjectId = Number(row.enrollment_subject_id);
      if (
        !positiveId(enrollmentSubjectId) ||
        studentByEnrollmentSubject.has(enrollmentSubjectId)
      ) {
        fail(
          "GRADEBOOK_ROSTER_DATA_INVALID",
          "Invalid or duplicated enrollment-subject row.",
        );
      }
      const isCurrentApprovedAssignment =
        Number(row.current_offering_id) === offeringId &&
        row.enrollment_status === "Approved";
      const isCurrentEnrolled =
        isCurrentApprovedAssignment &&
        row.enrollment_subject_status === "Enrolled";
      if (isCurrentApprovedAssignment) currentRosterCount += 1;
      else historicalRosterCount += 1;

      const name = [row.first_name, row.middle_name, row.last_name]
        .map((part) => String(part ?? "").trim())
        .filter(Boolean)
        .join(" ");
      const scores = {};
      for (const assessmentId of assessmentById.keys()) {
        scores[String(assessmentId)] = emptyScore(assessmentId);
      }
      const student = {
        enrollment_subject_id: enrollmentSubjectId,
        enrollment_id: Number(row.enrollment_id),
        student_id: Number(row.student_id),
        student_number: row.student_number,
        first_name: row.first_name,
        middle_name: row.middle_name,
        last_name: row.last_name,
        student_name: name,
        section_name: row.section_name,
        enrollment_type: row.enrollment_type,
        enrollment_status: row.enrollment_status,
        enrollment_subject_status: row.enrollment_subject_status,
        is_current_approved_assignment: isCurrentApprovedAssignment,
        is_current_enrolled: isCurrentEnrolled,
        scores_by_assessment_id: scores,
      };
      students.push(student);
      studentByEnrollmentSubject.set(enrollmentSubjectId, student);
    }

    // Existing scores are retrieved without creating any missing PENDING rows.
    const [scoreRows] = await connection.execute(
      `SELECT sc.score_id, sc.assessment_id, sc.enrollment_subject_id,
              sc.score_status, sc.earned_score, sc.not_applicable_reason,
              sc.record_version, sc.updated_at
         FROM gradebook_scores sc
         JOIN gradebook_assessments a ON a.assessment_id = sc.assessment_id
         JOIN gradebook_offering_categories oc
           ON oc.offering_category_id = a.offering_category_id
        WHERE oc.config_id = ? AND a.record_status = 'ACTIVE'
        ORDER BY sc.enrollment_subject_id, sc.assessment_id, sc.score_id`,
      [config.config_id],
    );
    const seenScores = new Set();
    for (const score of scoreRows) {
      const assessmentId = Number(score.assessment_id);
      const enrollmentSubjectId = Number(score.enrollment_subject_id);
      const key = `${enrollmentSubjectId}:${assessmentId}`;
      const student = studentByEnrollmentSubject.get(enrollmentSubjectId);
      const assessment = assessmentById.get(assessmentId);
      if (!student || !assessment || seenScores.has(key)) {
        fail(
          "GRADEBOOK_SCORE_DATA_INVALID",
          "Gradebook contains a duplicate or unauthorized score association.",
        );
      }
      seenScores.add(key);

      const status = score.score_status;
      const earned =
        score.earned_score === null ? null : String(score.earned_score);
      const reason = score.not_applicable_reason;
      if (
        (status === "SCORED" &&
          (earned === null ||
            scoreCents(earned, "Earned score") >
              scoreCents(assessment.maximum_score, "Maximum score"))) ||
        (status === "PENDING" && earned !== null) ||
        (status === "NOT_APPLICABLE" &&
          (earned !== null || !String(reason ?? "").trim())) ||
        !["PENDING", "SCORED", "NOT_APPLICABLE"].includes(status)
      ) {
        fail(
          "GRADEBOOK_SCORE_DATA_INVALID",
          "Gradebook score contains an invalid status, value, or N/A reason.",
        );
      }
      student.scores_by_assessment_id[String(assessmentId)] = {
        assessment_id: assessmentId,
        score_id: Number(score.score_id),
        score_status: status,
        earned_score: earned,
        not_applicable_reason: reason,
        record_version: Number(score.record_version),
        updated_at: score.updated_at,
        saved: true,
      };
    }

    await connection.commit();
    transactionStarted = false;
    return res.json({
      success: true,
      offering_id: offeringId,
      config_id: config.config_id,
      subject_code: config.subject_code,
      subject_name: config.subject_name,
      grading_classification: config.grading_classification,
      grading_policy: config.grading_policy,
      policy_version: config.policy_version,
      offering_status: config.offering_status,
      active_assessment_count: assessmentById.size,
      roster_count: students.length,
      current_approved_assignment_count: currentRosterCount,
      historical_only_count: historicalRosterCount,
      saved_score_count: scoreRows.length,
      terms,
      students,
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("GRADEBOOK ROSTER ROLLBACK ERROR:", rollbackError);
      }
    }
    return sendError(res, error);
  } finally {
    connection?.release();
  }
});

// Grade previews use exact rational arithmetic. Display rounding never decides pass/fail.
function previewFail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function previewPositiveId(value) {
  const raw = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

function scaledHundredths(value, label) {
  const raw = String(value ?? "").trim();
  if (!/^(0|[1-9]\d*)(?:\.\d{1,2})?$/.test(raw)) {
    previewFail(
      "GRADEBOOK_CALCULATION_DATA_INVALID",
      `${label} is not a valid decimal value.`,
    );
  }
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function absBigInt(n) {
  return n < 0n ? -n : n;
}
function gcdBigInt(a, b) {
  a = absBigInt(a);
  b = absBigInt(b);
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1n;
}
function fraction(numerator, denominator = 1n) {
  if (denominator <= 0n) {
    previewFail(
      "GRADEBOOK_CALCULATION_DATA_INVALID",
      "A calculation denominator must be positive.",
    );
  }
  const divisor = gcdBigInt(numerator, denominator);
  return { n: numerator / divisor, d: denominator / divisor };
}
function fractionAdd(a, b) {
  return fraction(a.n * b.d + b.n * a.d, a.d * b.d);
}
function fractionTimes(a, numerator, denominator = 1n) {
  return fraction(a.n * numerator, a.d * denominator);
}
function fractionAtLeast(a, integerValue) {
  return a.n >= BigInt(integerValue) * a.d;
}
function fixedFromFraction(a, digits) {
  const places = 10n ** BigInt(digits);
  // All percentages are nonnegative. Half-up is used strictly for display.
  const units = (a.n * places * 2n + a.d) / (a.d * 2n);
  const whole = units / places;
  if (digits === 0) return whole.toString();
  const remainder = (units % places).toString().padStart(digits, "0");
  return `${whole}.${remainder}`;
}
function exposePercent(a) {
  if (a === null) return null;
  return {
    // Exact fraction remains available so clients never infer pass/fail from rounded UI.
    exact_numerator: a.n.toString(),
    exact_denominator: a.d.toString(),
    decimal_preview: fixedFromFraction(a, 12),
    display: fixedFromFraction(a, 2),
  };
}
function equivalentFor(semesterPercent) {
  if (fractionAtLeast(semesterPercent, 97)) return "1.00";
  if (fractionAtLeast(semesterPercent, 94)) return "1.25";
  if (fractionAtLeast(semesterPercent, 91)) return "1.50";
  if (fractionAtLeast(semesterPercent, 88)) return "1.75";
  if (fractionAtLeast(semesterPercent, 85)) return "2.00";
  if (fractionAtLeast(semesterPercent, 82)) return "2.25";
  if (fractionAtLeast(semesterPercent, 79)) return "2.50";
  if (fractionAtLeast(semesterPercent, 76)) return "2.75";
  if (fractionAtLeast(semesterPercent, 75)) return "3.00";
  return "5.00";
}

function summarizeAssessmentCategory(
  category,
  assessments,
  scoreByAssessmentId,
) {
  let earned = 0n;
  let possible = 0n;
  let scored = 0;
  let notApplicable = 0;
  let pending = 0;
  const assessmentDetails = [];

  for (const assessment of assessments) {
    const maximum = scaledHundredths(
      assessment.maximum_score,
      "assessment maximum_score",
    );
    if (maximum <= 0n) {
      previewFail(
        "GRADEBOOK_CALCULATION_DATA_INVALID",
        "An active assessment has an invalid maximum score.",
      );
    }
    const score = scoreByAssessmentId.get(Number(assessment.assessment_id));
    const status = score?.score_status ?? "PENDING";
    const reason = String(score?.not_applicable_reason ?? "").trim();
    let earnedScore = null;

    if (status === "SCORED") {
      if (score.earned_score === null || score.earned_score === undefined) {
        previewFail(
          "GRADEBOOK_CALCULATION_DATA_INVALID",
          "A scored assessment is missing its earned score.",
        );
      }
      const points = scaledHundredths(score.earned_score, "earned_score");
      if (points > maximum) {
        previewFail(
          "GRADEBOOK_CALCULATION_DATA_INVALID",
          "An assessment score exceeds its maximum.",
        );
      }
      earned += points;
      possible += maximum;
      scored += 1;
      earnedScore = String(score.earned_score);
    } else if (status === "NOT_APPLICABLE") {
      if (
        !reason ||
        (score.earned_score !== null && score.earned_score !== undefined)
      ) {
        previewFail(
          "GRADEBOOK_CALCULATION_DATA_INVALID",
          "An N/A assessment must have a reason and no earned score.",
        );
      }
      notApplicable += 1;
    } else if (status === "PENDING") {
      if (
        score &&
        score.earned_score !== null &&
        score.earned_score !== undefined
      ) {
        previewFail(
          "GRADEBOOK_CALCULATION_DATA_INVALID",
          "Pending assessment cannot contain earned points.",
        );
      }
      pending += 1;
    } else {
      previewFail(
        "GRADEBOOK_CALCULATION_DATA_INVALID",
        "Unsupported gradebook score status.",
      );
    }
    assessmentDetails.push({
      assessment_id: Number(assessment.assessment_id),
      header_name: assessment.header_name,
      maximum_score: String(assessment.maximum_score),
      score_status: status,
      earned_score: earnedScore,
      not_applicable_reason: status === "NOT_APPLICABLE" ? reason : null,
    });
  }

  let state = "READY";
  if (assessments.length === 0) state = "NO_ASSESSMENTS";
  else if (pending > 0) state = "PENDING_SCORES";
  else if (scored === 0 || possible === 0n) state = "NO_SCORED_BASIS";
  const weight = scaledHundredths(
    category.category_percent,
    "category_percent",
  );
  const percentage = possible > 0n ? fraction(earned * 100n, possible) : null;
  const contribution =
    state === "READY" ? fraction(earned * weight, possible * 100n) : null;
  return {
    category_code: category.category_code,
    category_name: category.category_name,
    category_weight_percent: String(category.category_percent),
    state,
    assessment_count: assessments.length,
    scored_count: scored,
    not_applicable_count: notApplicable,
    pending_count: pending,
    earned_points:
      (earned / 100n).toString() +
      "." +
      (earned % 100n).toString().padStart(2, "0"),
    possible_points:
      (possible / 100n).toString() +
      "." +
      (possible % 100n).toString().padStart(2, "0"),
    category_percentage: exposePercent(percentage),
    contribution_percent_points: exposePercent(contribution),
    assessments: assessmentDetails,
    _contribution: contribution,
  };
}

function summarizeAttendanceCategory(category, meetings) {
  const sessions = [];
  let eligible = 0;
  let credited = 0;
  let excused = 0;
  let notApplicable = 0;
  let pending = 0;
  let heldCount = 0;

  for (const meeting of meetings) {
    // SCHEDULED does not count yet; CANCELLED is excluded entirely.
    if (
      meeting.meeting_status === "CANCELLED" ||
      meeting.meeting_status === "SCHEDULED"
    )
      continue;
    if (meeting.meeting_status !== "HELD") {
      previewFail(
        "GRADEBOOK_CALCULATION_DATA_INVALID",
        "Unsupported attendance meeting status.",
      );
    }
    heldCount += 1;
    const status = meeting.attendance_status ?? "PENDING";
    const reason = String(meeting.status_reason ?? "").trim();
    const beforeEnrollment = Number(meeting.before_enrollment) === 1;
    if (
      beforeEnrollment &&
      status !== "NOT_APPLICABLE" &&
      status !== "PENDING"
    ) {
      previewFail(
        "GRADEBOOK_CALCULATION_DATA_INVALID",
        "Attendance before enrollment must be marked N/A with a reason, not present or absent.",
      );
    }
    if (status === "PRESENT" || status === "LATE") {
      eligible += 1;
      credited += 1;
    } else if (status === "ABSENT") {
      eligible += 1;
    } else if (status === "EXCUSED") {
      excused += 1;
    } else if (status === "NOT_APPLICABLE") {
      if (!reason) {
        previewFail(
          "GRADEBOOK_CALCULATION_DATA_INVALID",
          "An N/A attendance entry requires a reason.",
        );
      }
      notApplicable += 1;
    } else if (status === "PENDING") {
      pending += 1;
    } else {
      previewFail(
        "GRADEBOOK_CALCULATION_DATA_INVALID",
        "Unsupported attendance entry status.",
      );
    }
    sessions.push({
      meeting_id: Number(meeting.meeting_id),
      meeting_date: meeting.meeting_date,
      attendance_status: status,
      before_enrollment: beforeEnrollment,
      requires_documented_na: beforeEnrollment && status === "PENDING",
      status_reason:
        status === "NOT_APPLICABLE" || status === "EXCUSED"
          ? reason || null
          : null,
    });
  }
  let state = "READY";
  if (heldCount === 0) state = "NO_HELD_SESSIONS";
  else if (pending > 0) state = "PENDING_ATTENDANCE";
  else if (eligible === 0) state = "NO_COUNTABLE_SESSIONS";
  const percent =
    eligible > 0 ? fraction(BigInt(credited) * 100n, BigInt(eligible)) : null;
  const weight = scaledHundredths(
    category.category_percent,
    "attendance category_percent",
  );
  const contribution =
    state === "READY"
      ? fraction(BigInt(credited) * weight, BigInt(eligible) * 100n)
      : null;
  return {
    category_code: category.category_code,
    category_name: category.category_name,
    category_weight_percent: String(category.category_percent),
    state,
    held_session_count: heldCount,
    present_or_late_count: credited,
    absent_count: eligible - credited,
    excused_count: excused,
    not_applicable_count: notApplicable,
    pending_count: pending,
    counted_session_count: eligible,
    category_percentage: exposePercent(percent),
    contribution_percent_points: exposePercent(contribution),
    sessions,
    _contribution: contribution,
  };
}

function validatePreviewIdentifiers(req, res) {
  const offeringId = previewPositiveId(req.params.offeringId);
  const enrollmentSubjectId = previewPositiveId(req.params.enrollmentSubjectId);
  if (!offeringId || !enrollmentSubjectId) {
    res.status(400).json({
      success: false,
      code: "INVALID_GRADE_PREVIEW_REFERENCE",
      message: "Offering and enrollment-subject IDs must be positive integers.",
    });
    return null;
  }
  const actorUserId = previewPositiveId(req.user?.user_id);
  if (!actorUserId) {
    res.status(401).json({
      success: false,
      code: "AUTHENTICATION_REQUIRED",
      message: "Instructor authentication is required.",
    });
    return null;
  }
  return { offeringId, enrollmentSubjectId, actorUserId };
}

// Shared by both preview and readiness, so term eligibility uses the same arithmetic.
export async function calculateGradePreview(
  connection,
  offeringId,
  enrollmentSubjectId,
  actorUserId,
  {
    allowVerifiedIncCompletion = false,
    allowApprovedNumericCorrection = false,
  } = {},
) {
  // Recheck assigned-instructor ownership, even if route-level role checks run.
  const [owners] = await connection.execute(
    `SELECT so.offering_id, f.user_id AS assigned_user_id,
              u.is_active, u.is_archived, r.role_name
         FROM subject_offerings so
         LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
         LEFT JOIN users u ON u.user_id = f.user_id
         LEFT JOIN roles r ON r.role_id = u.role_id
        WHERE so.offering_id = ?`,
    [offeringId],
  );
  if (owners.length !== 1) {
    previewFail("OFFERING_NOT_FOUND", "Subject offering does not exist.", 404);
  }
  const owner = owners[0];
  if (
    Number(owner.assigned_user_id) !== actorUserId ||
    Number(owner.is_active) !== 1 ||
    Number(owner.is_archived) !== 0 ||
    !["Faculty", "Program Head"].includes(owner.role_name)
  ) {
    previewFail(
      "GRADEBOOK_INSTRUCTOR_REQUIRED",
      "Only the active assigned instructor can calculate this gradebook.",
      403,
    );
  }

  const config = await loadGradebookOfferingConfig(connection, offeringId);
  if (!config.is_initialized || !previewPositiveId(config.config_id)) {
    previewFail("GRADEBOOK_NOT_INITIALIZED", "Gradebook is not initialized.");
  }
  const configId = Number(config.config_id);
  const [configRows] = await connection.execute(
    `SELECT grading_classification, midterm_percent, final_term_percent
         FROM gradebook_offering_config WHERE config_id = ? AND offering_id = ?`,
    [configId, offeringId],
  );
  if (configRows.length !== 1) {
    previewFail(
      "GRADEBOOK_CONFIG_INVALID",
      "Gradebook configuration is missing.",
    );
  }
  const grading = configRows[0];
  const midtermWeight = scaledHundredths(
    grading.midterm_percent,
    "midterm_percent",
  );
  const finalWeight = scaledHundredths(
    grading.final_term_percent,
    "final_term_percent",
  );
  if (
    midtermWeight !== 5000n ||
    finalWeight !== 5000n ||
    !["PURE_LECTURE", "WITH_LABORATORY"].includes(
      grading.grading_classification,
    )
  ) {
    previewFail(
      "GRADEBOOK_CONFIG_INVALID",
      "The gradebook must use the official two-term 50/50 grading policy.",
    );
  }

  const [students] = await connection.execute(
    `SELECT es.enrollment_subject_id, es.offering_id, es.status,
              e.enrollment_status, e.approved_at,
              s.student_id, s.student_number, s.first_name, s.middle_name, s.last_name
         FROM enrollment_subjects es
         JOIN enrollments e ON e.enrollment_id = es.enrollment_id
         JOIN students s ON s.student_id = e.student_id
        WHERE es.enrollment_subject_id = ? AND es.offering_id = ?`,
    [enrollmentSubjectId, offeringId],
  );
  if (students.length !== 1) {
    previewFail(
      "GRADEBOOK_STUDENT_NOT_FOUND",
      "This enrollment subject is not assigned to the offering.",
      404,
    );
  }
  const student = students[0];

  const eligibleStudentStatus = allowVerifiedIncCompletion
    ? student.status === "Incomplete"
    : allowApprovedNumericCorrection
      ? ["Completed", "Failed"].includes(student.status)
      : student.status === "Enrolled";

  if (student.enrollment_status !== "Approved" || !eligibleStudentStatus) {
    previewFail(
      "GRADEBOOK_STUDENT_NOT_ELIGIBLE",
      "This student is not eligible for the requested grade calculation.",
    );
  }

  const categories = config.categories;
  if (
    !Array.isArray(categories) ||
    categories.length === 0 ||
    categories.filter((category) => category.category_code === "ATTENDANCE")
      .length !== 1
  ) {
    previewFail(
      "GRADEBOOK_CONFIG_INVALID",
      "Official assessment categories are incomplete.",
    );
  }
  const weightTotal = categories.reduce(
    (sum, category) =>
      sum + scaledHundredths(category.category_percent, "category_percent"),
    0n,
  );
  if (weightTotal !== 10000n) {
    previewFail(
      "GRADEBOOK_CONFIG_INVALID",
      "The official category weights must total 100 percent.",
    );
  }
  const categoryIds = new Set(
    categories.map((category) => String(category.category_code)),
  );

  const [assessments] = await connection.execute(
    `SELECT a.assessment_id, a.offering_category_id, a.grading_term,
              a.header_name, a.maximum_score, oc.category_code
         FROM gradebook_assessments a
         JOIN gradebook_offering_categories oc
           ON oc.offering_category_id = a.offering_category_id
        WHERE oc.config_id = ? AND a.record_status = 'ACTIVE'
        ORDER BY a.grading_term, oc.display_order, a.display_order, a.assessment_id`,
    [configId],
  );
  const activeAssessmentIds = new Set();
  for (const item of assessments) {
    const id = Number(item.assessment_id);
    if (
      !previewPositiveId(id) ||
      activeAssessmentIds.has(id) ||
      !["MIDTERM", "FINAL_TERM"].includes(item.grading_term) ||
      !categoryIds.has(item.category_code) ||
      item.category_code === "ATTENDANCE"
    ) {
      previewFail(
        "GRADEBOOK_CALCULATION_DATA_INVALID",
        "Invalid or duplicate active assessment.",
      );
    }
    activeAssessmentIds.add(id);
  }

  const [scores] = await connection.execute(
    `SELECT sc.score_id, sc.assessment_id, sc.score_status,
              sc.earned_score, sc.not_applicable_reason
         FROM gradebook_scores sc
         JOIN gradebook_assessments a ON a.assessment_id = sc.assessment_id
         JOIN gradebook_offering_categories oc
           ON oc.offering_category_id = a.offering_category_id
        WHERE oc.config_id = ? AND a.record_status = 'ACTIVE'
          AND sc.enrollment_subject_id = ?`,
    [configId, enrollmentSubjectId],
  );
  const scoreByAssessmentId = new Map();
  for (const score of scores) {
    const id = Number(score.assessment_id);
    if (!activeAssessmentIds.has(id) || scoreByAssessmentId.has(id)) {
      previewFail(
        "GRADEBOOK_CALCULATION_DATA_INVALID",
        "Duplicate or unauthorized saved score.",
      );
    }
    scoreByAssessmentId.set(id, score);
  }

  const [meetings] = await connection.execute(
    `SELECT m.meeting_id, m.grading_term, m.meeting_status,
              DATE_FORMAT(m.meeting_date, '%Y-%m-%d') AS meeting_date,
              CASE WHEN e.approved_at IS NOT NULL
                        AND TIMESTAMP(m.meeting_date, m.start_time) < e.approved_at
                   THEN 1 ELSE 0 END AS before_enrollment,
              ae.attendance_id, ae.attendance_status, ae.status_reason
         FROM gradebook_attendance_meetings m
         JOIN enrollment_subjects es ON es.enrollment_subject_id = ?
         JOIN enrollments e ON e.enrollment_id = es.enrollment_id
         LEFT JOIN gradebook_attendance_entries ae
           ON ae.meeting_id = m.meeting_id AND ae.enrollment_subject_id = ?
        WHERE m.config_id = ?
        ORDER BY m.meeting_date, m.start_time, m.meeting_id`,
    [enrollmentSubjectId, enrollmentSubjectId, configId],
  );
  const seenMeetings = new Set();
  for (const meeting of meetings) {
    const id = Number(meeting.meeting_id);
    if (
      !previewPositiveId(id) ||
      seenMeetings.has(id) ||
      !["MIDTERM", "FINAL_TERM"].includes(meeting.grading_term) ||
      !["SCHEDULED", "HELD", "CANCELLED"].includes(meeting.meeting_status)
    ) {
      previewFail(
        "GRADEBOOK_CALCULATION_DATA_INVALID",
        "Invalid or duplicated attendance meeting.",
      );
    }
    seenMeetings.add(id);
  }

  const terms = {};
  const termFractions = {};
  for (const term of ["MIDTERM", "FINAL_TERM"]) {
    const categoryResults = [];
    let provisional = fraction(0n);
    let complete = true;
    for (const category of categories) {
      let result;
      if (category.category_code === "ATTENDANCE") {
        result = summarizeAttendanceCategory(
          category,
          meetings.filter((meeting) => meeting.grading_term === term),
        );
      } else {
        result = summarizeAssessmentCategory(
          category,
          assessments.filter(
            (item) =>
              item.grading_term === term &&
              item.category_code === category.category_code,
          ),
          scoreByAssessmentId,
        );
      }
      if (result.state !== "READY") complete = false;
      if (result._contribution !== null) {
        provisional = fractionAdd(provisional, result._contribution);
      }
      delete result._contribution;
      categoryResults.push(result);
    }
    termFractions[term] = complete ? provisional : null;
    terms[term] = {
      state: complete ? "READY" : "INCOMPLETE",
      term_percentage: exposePercent(termFractions[term]),
      // Informational only: cannot be treated as the official term result.
      provisional_contribution_sum: exposePercent(provisional),
      incomplete_category_codes: categoryResults
        .filter((category) => category.state !== "READY")
        .map((category) => category.category_code),
      categories: categoryResults,
    };
  }

  const bothReady =
    termFractions.MIDTERM !== null && termFractions.FINAL_TERM !== null;
  const semesterFraction = bothReady
    ? fractionAdd(
        fractionTimes(termFractions.MIDTERM, midtermWeight, 10000n),
        fractionTimes(termFractions.FINAL_TERM, finalWeight, 10000n),
      )
    : null;

  return {
    success: true,
    read_only: true,
    offering_id: offeringId,
    config_id: configId,
    grading_classification: grading.grading_classification,
    grading_policy: "TWO_TERM_50_50",
    term_weights: {
      MIDTERM: String(grading.midterm_percent),
      FINAL_TERM: String(grading.final_term_percent),
    },
    student: {
      enrollment_subject_id: enrollmentSubjectId,
      student_id: Number(student.student_id),
      student_number: student.student_number,
      student_name: [student.first_name, student.middle_name, student.last_name]
        .map((part) => String(part ?? "").trim())
        .filter(Boolean)
        .join(" "),
    },
    terms,
    semester: {
      state: bothReady ? "READY" : "INCOMPLETE",
      semester_percentage: exposePercent(semesterFraction),
      numeric_equivalent: bothReady ? equivalentFor(semesterFraction) : null,
      pass_fail: bothReady
        ? fractionAtLeast(semesterFraction, 75)
          ? "PASS"
          : "FAIL"
        : null,
    },
    note: "Preview only. INC, UD, term approvals and official publication are handled separately.",
  };
}

// GET /api/gradebook/:offeringId/students/:enrollmentSubjectId/grade-preview
// Read-only. Returns exactly the previously implemented grade calculation response.
router.get(
  "/:offeringId/students/:enrollmentSubjectId/grade-preview",
  async (req, res) => {
    const ids = validatePreviewIdentifiers(req, res);
    if (!ids) return;
    if (Object.keys(req.query).length !== 0) {
      return res.status(400).json({
        success: false,
        code: "UNSUPPORTED_GRADE_PREVIEW_QUERY",
        message:
          "The grade calculation preview does not accept query parameters.",
      });
    }

    let connection;
    let transactionStarted = false;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;
      const result = await calculateGradePreview(
        connection,
        ids.offeringId,
        ids.enrollmentSubjectId,
        ids.actorUserId,
      );
      await connection.commit();
      transactionStarted = false;
      return res.json(result);
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("GRADE PREVIEW ROLLBACK ERROR:", rollbackError);
        }
      }
      return sendError(res, error);
    } finally {
      connection?.release();
    }
  },
);

// Read-only INC completion preview. This does not reopen attendance meetings,
// modify historic term submissions, or publish a numeric replacement grade.
// Keep the normal grade-preview route restricted to currently Enrolled students.
const INC_PREVIEW_QA_DATABASE = "databaseforptc1_admission_test";
const INC_PREVIEW_QA_OFFERING = 131;

async function assertIncCompletionPreviewScope(connection, ids) {
  if (ids.offeringId !== INC_PREVIEW_QA_OFFERING) {
    previewFail(
      "INC_PREVIEW_QA_OFFERING_ONLY",
      "INC completion preview is restricted to QA Offering #131.",
      403,
    );
  }
  const [[database]] = await connection.execute(
    "SELECT DATABASE() AS database_name",
  );
  if (database?.database_name !== INC_PREVIEW_QA_DATABASE) {
    previewFail(
      "INC_PREVIEW_QA_DATABASE_ONLY",
      "INC completion preview is restricted to the admission-test database.",
      403,
    );
  }

  // Ensure only the active assigned instructor can see an individual student's
  // protected claim, attendance records and provisional numeric calculation.
  const [owners] = await connection.execute(
    `SELECT f.user_id AS assigned_user_id, so.faculty_id,
            u.is_active, u.is_archived, r.role_name
       FROM subject_offerings so
       JOIN faculty f ON f.faculty_id = so.faculty_id
       JOIN users u ON u.user_id = f.user_id
       JOIN roles r ON r.role_id = u.role_id
      WHERE so.offering_id = ?`,
    [ids.offeringId],
  );
  const owner = owners[0];
  if (
    owners.length !== 1 ||
    Number(owner.assigned_user_id) !== ids.actorUserId ||
    Number(owner.is_active) !== 1 ||
    Number(owner.is_archived) !== 0 ||
    !["Faculty", "Program Head"].includes(owner.role_name)
  ) {
    previewFail(
      "INC_PREVIEW_INSTRUCTOR_REQUIRED",
      "Only the active assigned instructor may preview this student's INC completion.",
      403,
    );
  }

  const [rows] = await connection.execute(
    `SELECT g.grade_id, g.grade_status, g.grading_policy, g.grading_outcome,
            g.final_rating, g.remarks, g.faculty_id AS grade_faculty_id,
            es.status AS subject_status, e.enrollment_status,
            cfg.config_id
       FROM enrollment_subjects es
       JOIN enrollments e ON e.enrollment_id = es.enrollment_id
       JOIN grades g ON g.enrollment_subject_id = es.enrollment_subject_id
       JOIN gradebook_offering_config cfg ON cfg.offering_id = es.offering_id
      WHERE es.enrollment_subject_id = ? AND es.offering_id = ?`,
    [ids.enrollmentSubjectId, ids.offeringId],
  );
  const grade = rows[0];
  if (
    rows.length !== 1 ||
    grade.grade_status !== "Approved" ||
    grade.grading_policy !== "TWO_TERM_50_50" ||
    grade.grading_outcome !== "INCOMPLETE" ||
    Number(grade.final_rating) !== 4 ||
    grade.remarks !== "Incomplete" ||
    grade.subject_status !== "Incomplete" ||
    grade.enrollment_status !== "Approved" ||
    Number(grade.grade_faculty_id) !== Number(owner.faculty_id)
  ) {
    previewFail(
      "INC_PREVIEW_OFFICIAL_GRADE_INELIGIBLE",
      "The original official grade must remain Approved INC 4.00 with an Incomplete subject.",
    );
  }
  const configId = Number(grade.config_id);
  const gradeId = Number(grade.grade_id);

  const [outcomes] = await connection.execute(
    `SELECT inc_request_id FROM gradebook_inc_outcome_requests
      WHERE config_id = ? AND enrollment_subject_id = ? AND request_status = 'APPROVED'`,
    [configId, ids.enrollmentSubjectId],
  );
  if (outcomes.length !== 1) {
    previewFail(
      "INC_PREVIEW_ORIGINAL_OUTCOME_REQUIRED",
      "The original Program Head-approved INC outcome must remain valid.",
    );
  }

  const [sheets] = await connection.execute(
    `SELECT sheet_id, sheet_status,
            DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_date,
            official_submission_reference, official_date_verified_by_user_id,
            official_date_verified_at,
            DATE_FORMAT(DATE_ADD(original_official_submitted_on, INTERVAL 1 YEAR), '%Y-%m-%d') AS deadline_on
       FROM gradebook_official_sheets WHERE config_id = ?`,
    [configId],
  );
  const sheet = sheets[0];
  if (
    sheets.length !== 1 ||
    !sheet.original_date ||
    !sheet.deadline_on ||
    !String(sheet.official_submission_reference ?? "").trim() ||
    !sheet.official_date_verified_by_user_id ||
    !sheet.official_date_verified_at
  ) {
    previewFail(
      "INC_PREVIEW_VERIFIED_SHEET_REQUIRED",
      "A Registrar-verified original grading-sheet submission date is required.",
    );
  }
  const [sheetEvents] = await connection.execute(
    `SELECT event_type, performed_by_user_id,
            DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS official_date,
            official_submission_reference, record_version_after
       FROM gradebook_official_sheet_submission_events
      WHERE sheet_id = ? ORDER BY record_version_after`,
    [String(sheet.sheet_id)],
  );
  if (
    sheetEvents.length !== 2 ||
    sheetEvents[0].event_type !== "RECORDED" ||
    Number(sheetEvents[0].record_version_after) !== 1 ||
    sheetEvents[1].event_type !== "VERIFIED" ||
    Number(sheetEvents[1].record_version_after) !== 2 ||
    sheetEvents.some(
      (event) =>
        event.official_date !== sheet.original_date ||
        event.official_submission_reference !==
          sheet.official_submission_reference,
    ) ||
    Number(sheetEvents[1].performed_by_user_id) !==
      Number(sheet.official_date_verified_by_user_id)
  ) {
    previewFail(
      "INC_PREVIEW_SHEET_AUDIT_INVALID",
      "Original sheet verification does not match its audit events.",
    );
  }

  const [claims] = await connection.execute(
    `SELECT claim_id, grade_id, verification_status, grade_change_request_id,
            DATE_FORMAT(verified_completed_on, '%Y-%m-%d') AS verified_completed_on,
            verified_at, verified_by_user_id, submitted_by_user_id,
            evidence_summary, verification_remarks, record_version
       FROM gradebook_inc_completion_claims WHERE grade_id = ?`,
    [gradeId],
  );
  const claim = claims[0];
  if (
    claims.length !== 1 ||
    Number(claim.grade_id) !== gradeId ||
    claim.verification_status !== "VERIFIED_TIMELY" ||
    !claim.verified_completed_on ||
    !claim.verified_at ||
    !claim.verified_by_user_id ||
    Number(claim.submitted_by_user_id) !== ids.actorUserId ||
    !String(claim.evidence_summary ?? "").trim() ||
    !String(claim.verification_remarks ?? "").trim() ||
    claim.verified_completed_on > sheet.deadline_on
  ) {
    previewFail(
      "INC_PREVIEW_TIMELY_CLAIM_REQUIRED",
      "A documented, timely, Program Head-verified INC completion claim is required.",
    );
  }
  const [claimEvents] = await connection.execute(
    `SELECT event_type, new_status, performed_by_user_id, claim_version_after,
            DATE_FORMAT(new_verified_completed_on, '%Y-%m-%d') AS completed_on
       FROM gradebook_inc_completion_claim_events
      WHERE claim_id = ? ORDER BY claim_version_after`,
    [String(claim.claim_id)],
  );
  const lastEvent = claimEvents.at(-1);
  if (
    claimEvents[0]?.event_type !== "CREATED" ||
    claimEvents.length !== Number(claim.record_version) ||
    !claimEvents.every(
      (event, i) => Number(event.claim_version_after) === i + 1,
    ) ||
    lastEvent?.event_type !== "VERIFIED" ||
    lastEvent.new_status !== "VERIFIED_TIMELY" ||
    lastEvent.completed_on !== claim.verified_completed_on ||
    Number(lastEvent.performed_by_user_id) !== Number(claim.verified_by_user_id)
  ) {
    previewFail(
      "INC_PREVIEW_CLAIM_AUDIT_INVALID",
      "The completion claim audit does not match the current verification decision.",
    );
  }

  const [midtermRows] = await connection.execute(
    `SELECT term_submission_id, submission_status,
            term_percentage_exact_numerator, term_percentage_exact_denominator
       FROM gradebook_term_submission_attempts
      WHERE config_id = ? AND enrollment_subject_id = ? AND grading_term = 'MIDTERM'
      ORDER BY attempt_number DESC, term_submission_id DESC LIMIT 1`,
    [configId, ids.enrollmentSubjectId],
  );
  if (
    midtermRows.length !== 1 ||
    midtermRows[0].submission_status !== "APPROVED"
  ) {
    previewFail(
      "INC_PREVIEW_MIDTERM_NOT_APPROVED",
      "The original Midterm grade must remain approved and locked.",
    );
  }

  const [finalRows] = await connection.execute(
    `SELECT term_submission_id, submission_status, attempt_number
       FROM gradebook_term_submission_attempts
      WHERE config_id = ? AND enrollment_subject_id = ? AND grading_term = 'FINAL_TERM'
      ORDER BY attempt_number DESC, term_submission_id DESC LIMIT 1`,
    [configId, ids.enrollmentSubjectId],
  );
  const finalAttempt = finalRows[0] ?? null;
  if (
    finalAttempt &&
    !["SUBMITTED", "APPROVED", "RETURNED"].includes(
      finalAttempt.submission_status,
    )
  ) {
    previewFail(
      "INC_PREVIEW_FINAL_TERM_HISTORY_INVALID",
      "The Final Term submission has an unsupported status.",
    );
  }

  return {
    gradeId,
    configId,
    claim,
    sheet,
    midterm: midtermRows[0],
    finalAttempt,
  };
}

// GET /api/gradebook/:offeringId/students/:enrollmentSubjectId/inc-completion-grade-preview
// Uses exactly the same points and attendance calculation as normal grade previews.
// It cannot turn a numeric preview into an official published grade.
router.get(
  "/:offeringId/students/:enrollmentSubjectId/inc-completion-grade-preview",
  async (req, res) => {
    const ids = validatePreviewIdentifiers(req, res);
    if (!ids) return;
    if (Object.keys(req.query).length !== 0) {
      return res.status(400).json({
        success: false,
        code: "INC_PREVIEW_QUERY_UNSUPPORTED",
        message: "This preview does not accept query parameters.",
      });
    }
    let connection;
    let transactionStarted = false;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;
      // Modern combined INC preview
      if (ids.offeringId === 130) {
        const result = await previewModernIncCompletion(
          connection,
          ids,
          calculateGradePreview,
        );

        await connection.rollback();
        transactionStarted = false;

        return res.json(result);
      }

      // Legacy INC preview
      const state = await assertIncCompletionPreviewScope(connection, ids);
      const calculated = await calculateGradePreview(
        connection,
        ids.offeringId,
        ids.enrollmentSubjectId,
        ids.actorUserId,
        { allowVerifiedIncCompletion: true },
      );
      // The original approved Midterm score must be preserved exactly. A
      // changed Midterm calculation requires a separate correction workflow.
      const actualMidterm = calculated.terms.MIDTERM.term_percentage;
      const approvedMidterm = state.midterm;
      if (!actualMidterm) {
        previewFail(
          "INC_PREVIEW_MIDTERM_CALCULATION_MISSING",
          "The originally approved Midterm calculation is no longer complete.",
        );
      }
      let historicalNumerator, historicalDenominator;
      try {
        historicalNumerator = BigInt(
          approvedMidterm.term_percentage_exact_numerator,
        );
        historicalDenominator = BigInt(
          approvedMidterm.term_percentage_exact_denominator,
        );
      } catch {
        previewFail(
          "INC_PREVIEW_MIDTERM_SNAPSHOT_INVALID",
          "The approved Midterm exact calculation snapshot is invalid.",
        );
      }
      if (
        historicalDenominator <= 0n ||
        historicalNumerator * BigInt(actualMidterm.exact_denominator) !==
          BigInt(actualMidterm.exact_numerator) * historicalDenominator
      ) {
        previewFail(
          "INC_PREVIEW_MIDTERM_CHANGED",
          "The current Midterm no longer matches its original approved exact score.",
        );
      }
      await connection.commit();
      transactionStarted = false;
      return res.json({
        success: true,
        read_only: true,
        preview_scope: "INC_COMPLETION_FINAL_TERM",
        offering_id: ids.offeringId,
        config_id: state.configId,
        protected_official_grade: {
          grade_id: state.gradeId,
          grade_status: "Approved",
          grading_outcome: "INCOMPLETE",
          final_rating: "4.00",
          unchanged: true,
        },
        verified_claim: {
          claim_id: String(state.claim.claim_id),
          verification_status: "VERIFIED_TIMELY",
          verified_completed_on: state.claim.verified_completed_on,
          record_version: Number(state.claim.record_version),
        },
        official_sheet: {
          sheet_id: String(state.sheet.sheet_id),
          original_official_submitted_on: state.sheet.original_date,
          inc_completion_deadline_on: state.sheet.deadline_on,
          verified: true,
        },
        midterm_approval: {
          term_submission_id: Number(state.midterm.term_submission_id),
          matched_approved_snapshot: true,
        },
        final_term_submission: state.finalAttempt
          ? {
              term_submission_id: Number(state.finalAttempt.term_submission_id),
              submission_status: state.finalAttempt.submission_status,
              attempt_number: Number(state.finalAttempt.attempt_number),
            }
          : null,
        student: calculated.student,
        grading_policy: calculated.grading_policy,
        grading_classification: calculated.grading_classification,
        term_weights: calculated.term_weights,
        terms: calculated.terms,
        semester: calculated.semester,
        numeric_preview_only: true,
        inc_completion_submission_enabled: false,
        official_grade_publication_enabled: false,
        next_step:
          calculated.semester.state === "READY"
            ? "An authorized INC-specific Final Term submission and approval workflow is required before Registrar conversion."
            : "Complete required assessment scores and resolve documented existing attendance gaps before an INC-specific submission.",
        note: "Existing attendance history is read-only in this preview. No grades, attendance entries, submissions or amendments were changed.",
      });
    } catch (error) {
      if (transactionStarted && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error(
            "INC COMPLETION PREVIEW ROLLBACK ERROR:",
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

// GET /api/gradebook/:offeringId/students/:enrollmentSubjectId/term-submission-readiness?grading_term=MIDTERM
// Read-only assessment of normal submission or returned-grade resubmission.
// This is an advisory preview. The future POST must recheck every rule in a transaction.
router.get(
  "/:offeringId/students/:enrollmentSubjectId/term-submission-readiness",
  async (req, res) => {
    const ids = validatePreviewIdentifiers(req, res);
    if (!ids) return;
    const term = req.query?.grading_term;
    if (
      Object.keys(req.query).length !== 1 ||
      typeof term !== "string" ||
      !["MIDTERM", "FINAL_TERM"].includes(term)
    ) {
      return res.status(400).json({
        success: false,
        code: "INVALID_GRADING_TERM",
        message: "Use exactly one grading_term: MIDTERM or FINAL_TERM.",
      });
    }

    let connection;
    let transactionStarted = false;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;

      // The shared preview verifies instructor ownership, enrollment and score integrity.
      const preview = await calculateGradePreview(
        connection,
        ids.offeringId,
        ids.enrollmentSubjectId,
        ids.actorUserId,
      );
      const selectedTerm = preview.terms[term];
      const blockers = [];
      const addBlocker = (code, message) => blockers.push({ code, message });

      // Department comes from the section's course, not from a Faculty member's
      // home department: instructors may teach across departments.
      const [offeringRows] = await connection.execute(
        `SELECT so.offering_id, so.status, so.academic_year_id, so.semester_id,
              sec.course_id, cr.department_id
         FROM subject_offerings so
         LEFT JOIN sections sec ON sec.section_id = so.section_id
         LEFT JOIN courses cr ON cr.course_id = sec.course_id
        WHERE so.offering_id = ?`,
        [ids.offeringId],
      );
      if (offeringRows.length !== 1) {
        previewFail(
          "OFFERING_NOT_FOUND",
          "Subject offering does not exist.",
          404,
        );
      }
      const offering = offeringRows[0];
      const departmentId = previewPositiveId(offering.department_id);
      const academicYearId = previewPositiveId(offering.academic_year_id);
      const semesterId = previewPositiveId(offering.semester_id);

      let period = null;
      let isDeadlinePassed = false;
      if (!departmentId || !academicYearId || !semesterId) {
        addBlocker(
          "GRADEBOOK_DEPARTMENT_SCOPE_MISSING",
          "The offering does not have a valid academic-year, semester, and course department.",
        );
      } else {
        const [periodRows] = await connection.execute(
          `SELECT p.period_id, p.period_status, p.record_version,
                DATE_FORMAT(p.opened_at, '%Y-%m-%d %H:%i:%s') AS opened_at,
                DATE_FORMAT(p.submission_deadline_at, '%Y-%m-%d %H:%i:%s') AS submission_deadline_at,
                DATE_FORMAT(p.closed_at, '%Y-%m-%d %H:%i:%s') AS closed_at,
                CASE WHEN p.submission_deadline_at IS NOT NULL
                          AND NOW() > p.submission_deadline_at THEN 1 ELSE 0 END AS deadline_passed
           FROM gradebook_term_submission_periods p
          WHERE p.department_id = ? AND p.academic_year_id = ?
            AND p.semester_id = ? AND p.grading_term = ?`,
          [departmentId, academicYearId, semesterId, term],
        );
        if (periodRows.length > 1) {
          previewFail(
            "TERM_SUBMISSION_PERIOD_DATA_INVALID",
            "Duplicate term submission windows were found.",
          );
        }
        if (periodRows.length === 1) {
          const row = periodRows[0];
          isDeadlinePassed = Number(row.deadline_passed) === 1;
          period = {
            period_id: Number(row.period_id),
            period_status: row.period_status,
            record_version: Number(row.record_version),
            opened_at: row.opened_at,
            submission_deadline_at: row.submission_deadline_at,
            closed_at: row.closed_at,
            deadline_passed: isDeadlinePassed,
          };
        }
      }

      const [attemptRows] = await connection.execute(
        `SELECT term_submission_id, attempt_number, submission_status,
              submission_batch_ref, submitted_at, reviewed_at, review_remarks,
              record_version
         FROM gradebook_term_submission_attempts
        WHERE config_id = ? AND enrollment_subject_id = ? AND grading_term = ?
        ORDER BY attempt_number DESC, term_submission_id DESC
        LIMIT 1`,
        [preview.config_id, ids.enrollmentSubjectId, term],
      );
      const latestAttempt = attemptRows.length
        ? {
            term_submission_id: String(attemptRows[0].term_submission_id),
            attempt_number: Number(attemptRows[0].attempt_number),
            submission_status: attemptRows[0].submission_status,
            submission_batch_ref: attemptRows[0].submission_batch_ref,
            submitted_at: attemptRows[0].submitted_at,
            reviewed_at: attemptRows[0].reviewed_at,
            review_remarks: attemptRows[0].review_remarks,
            record_version: Number(attemptRows[0].record_version),
          }
        : null;
      const returnedException = latestAttempt?.submission_status === "RETURNED";

      const [lockRows] = await connection.execute(
        `SELECT first_submission_id, locked_by_user_id, locked_at, lock_reason
         FROM gradebook_term_structure_locks
        WHERE config_id = ? AND grading_term = ?`,
        [preview.config_id, term],
      );
      if (lockRows.length > 1) {
        previewFail(
          "TERM_STRUCTURE_LOCK_DATA_INVALID",
          "Duplicate structure locks exist.",
        );
      }
      const structureLock = lockRows.length
        ? {
            locked: true,
            first_submission_id: String(lockRows[0].first_submission_id),
            locked_by_user_id: Number(lockRows[0].locked_by_user_id),
            locked_at: lockRows[0].locked_at,
            lock_reason: lockRows[0].lock_reason,
          }
        : { locked: false };

      // The structure lock does not prohibit submissions by other Draft students.
      if (
        selectedTerm.state !== "READY" ||
        selectedTerm.term_percentage === null
      ) {
        addBlocker(
          "TERM_GRADE_INCOMPLETE",
          "All official categories must be complete before this term can be submitted.",
        );
      }
      if (latestAttempt?.submission_status === "SUBMITTED") {
        addBlocker(
          "TERM_SUBMISSION_ALREADY_PENDING",
          "This student already has a submitted term awaiting review.",
        );
      } else if (latestAttempt?.submission_status === "APPROVED") {
        addBlocker(
          "TERM_ALREADY_APPROVED",
          "This term is approved; corrections require the formal correction workflow.",
        );
      }

      // This additive INC table exists only in the isolated QA database until
      // rollout. Do not break the original development database's read API.
      const [readinessDatabase] = await connection.execute(
        "SELECT DATABASE() AS database_name",
      );
      if (readinessDatabase[0]?.database_name === TERM_SUBMISSION_TEST_DB) {
        const [activeIncRequests] = await connection.execute(
          `SELECT inc_request_id FROM gradebook_inc_outcome_requests
           WHERE config_id = ? AND enrollment_subject_id = ?
             AND request_status IN ('SUBMITTED','APPROVED') LIMIT 1`,
          [preview.config_id, ids.enrollmentSubjectId],
        );
        if (activeIncRequests.length) {
          addBlocker(
            "INC_OUTCOME_REQUEST_ACTIVE",
            "An INC outcome request is pending or approved; numeric term submission is blocked.",
          );
        }
        const [activeUdRequests] = await connection.execute(
          `SELECT ud_request_id FROM gradebook_ud_outcome_requests
           WHERE config_id = ? AND enrollment_subject_id = ?
             AND request_status IN ('SUBMITTED','APPROVED') LIMIT 1`,
          [preview.config_id, ids.enrollmentSubjectId],
        );
        if (activeUdRequests.length) {
          addBlocker(
            "UD_OUTCOME_REQUEST_ACTIVE",
            "A UD request is pending or approved; numeric term submission is blocked.",
          );
        }
      }

      // Returned-grade resubmissions remain an authorized exception after closure.
      // The future write endpoint must also verify return permissions and revalidate locks.
      if (!returnedException) {
        if (!period) {
          addBlocker(
            "TERM_SUBMISSION_PERIOD_NOT_CONFIGURED",
            "A Program Head must create a submission window for this term.",
          );
        } else if (period.period_status !== "OPEN") {
          addBlocker(
            "TERM_SUBMISSION_PERIOD_CLOSED",
            "The Program Head has not opened submission for this term.",
          );
        } else if (isDeadlinePassed) {
          addBlocker(
            "TERM_SUBMISSION_DEADLINE_PASSED",
            "The term submission deadline has passed.",
          );
        }
      }
      // Even a returned-grade correction must have a real period to reference.
      if (returnedException && !period) {
        addBlocker(
          "TERM_SUBMISSION_PERIOD_NOT_CONFIGURED",
          "The original term submission window is no longer available.",
        );
      }

      // These guards also run in the POST transaction; the preview must not
      // advertise eligibility for a structurally unfinished term.
      if (offering.status !== "Open") {
        addBlocker(
          "OFFERING_NOT_OPEN",
          "Term submission requires an Open subject offering.",
        );
      }
      const [scheduledMeetings] = await connection.execute(
        `SELECT COUNT(*) AS pending_meetings FROM gradebook_attendance_meetings
        WHERE config_id = ? AND grading_term = ? AND meeting_status = 'SCHEDULED'`,
        [preview.config_id, term],
      );
      if (Number(scheduledMeetings[0]?.pending_meetings) > 0) {
        addBlocker(
          "TERM_HAS_SCHEDULED_MEETINGS",
          "Complete or cancel all scheduled meetings before first term submission.",
        );
      }
      const [existingGrades] = await connection.execute(
        "SELECT 1 FROM grades WHERE enrollment_subject_id = ? LIMIT 1",
        [ids.enrollmentSubjectId],
      );
      if (existingGrades.length) {
        addBlocker(
          "OFFICIAL_GRADE_REQUIRES_RECONCILIATION",
          "A previous grade record must be reconciled with the new term submission workflow.",
        );
      }
      const [legacyLocks] = await connection.execute(
        "SELECT 1 FROM gradebook_structure_locks WHERE config_id = ? LIMIT 1",
        [preview.config_id],
      );
      const [legacyAttempts] = await connection.execute(
        `SELECT 1 FROM gradebook_grade_submission_attempts sa
        JOIN grades g ON g.grade_id = sa.grade_id
        JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
       WHERE es.offering_id = ? LIMIT 1`,
        [ids.offeringId],
      );
      if (legacyLocks.length || legacyAttempts.length) {
        addBlocker(
          "GRADEBOOK_LEGACY_SUBMISSION_LOCKED",
          "Legacy combined-semester submission history requires reconciliation.",
        );
      }

      await connection.commit();
      transactionStarted = false;
      return res.json({
        success: true,
        read_only: true,
        offering_id: ids.offeringId,
        config_id: preview.config_id,
        student: preview.student,
        grading_term: term,
        academic_scope: {
          academic_year_id: academicYearId,
          semester_id: semesterId,
          department_id: departmentId,
        },
        term_state: selectedTerm.state,
        term_percentage: selectedTerm.term_percentage,
        provisional_contribution_sum: selectedTerm.provisional_contribution_sum,
        incomplete_categories: selectedTerm.categories
          .filter((category) => category.state !== "READY")
          .map((category) => ({
            category_code: category.category_code,
            state: category.state,
            pending_count: category.pending_count ?? 0,
          })),
        submission_period: period,
        latest_submission: latestAttempt,
        structure_lock: structureLock,
        returned_resubmission_exception: returnedException && !!period,
        can_submit: blockers.length === 0,
        blockers,
        note: "Read-only readiness preview. Submission must independently revalidate all rules in one transaction.",
      });
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("TERM READINESS ROLLBACK ERROR:", rollbackError);
        }
      }
      return sendError(res, error);
    } finally {
      connection?.release();
    }
  },
);

// STEP 2.8.6.4 — Per-student term submission (test DB pilot)
// Keep all score, attendance, assessment, review and submission writes serialized
// by locking the offering and gradebook configuration rows in that order.
const TERM_SUBMISSION_TEST_DB = "databaseforptc1_admission_test";
const TERM_SUBMISSION_TEST_OFFERING = 131;

function submissionBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    previewFail(
      "INVALID_TERM_SUBMISSION_BODY",
      "A JSON object is required.",
      400,
    );
  }
  const permitted = new Set([
    "grading_term",
    "expected_latest_submission_id",
    "expected_latest_submission_record_version",
    "change_reason",
    "dry_run",
  ]);
  if (Object.keys(body).some((field) => !permitted.has(field))) {
    previewFail(
      "UNSUPPORTED_TERM_SUBMISSION_FIELD",
      "Only grading_term, expected latest submission identity/version, change_reason, and dry_run are allowed.",
      400,
    );
  }
  const term = body.grading_term;
  if (!["MIDTERM", "FINAL_TERM"].includes(term)) {
    previewFail(
      "INVALID_GRADING_TERM",
      "grading_term must be MIDTERM or FINAL_TERM.",
      400,
    );
  }
  if (typeof body.dry_run !== "boolean") {
    previewFail("DRY_RUN_REQUIRED", "Specify dry_run: true or false.", 400);
  }
  if (
    !Object.hasOwn(body, "expected_latest_submission_id") ||
    !Object.hasOwn(body, "expected_latest_submission_record_version")
  ) {
    previewFail(
      "LATEST_SUBMISSION_IDENTITY_REQUIRED",
      "Send expected_latest_submission_id and expected_latest_submission_record_version (both null for first submission).",
      400,
    );
  }
  const expectedId = body.expected_latest_submission_id;
  const expectedVersion = body.expected_latest_submission_record_version;
  const firstAttempt = expectedId === null && expectedVersion === null;
  const validExisting =
    typeof expectedId === "string" &&
    /^[1-9]\d{0,19}$/.test(expectedId) &&
    BigInt(expectedId) <= 18446744073709551615n &&
    previewPositiveId(expectedVersion) !== null &&
    typeof expectedVersion !== "boolean";
  if (!firstAttempt && !validExisting) {
    previewFail(
      "INVALID_LATEST_SUBMISSION_IDENTITY",
      "Use both null for first submission, or the latest submission ID string and positive record version for resubmission.",
      400,
    );
  }
  let reason = null;
  if (body.change_reason !== undefined && body.change_reason !== null) {
    if (typeof body.change_reason !== "string") {
      previewFail(
        "INVALID_SUBMISSION_REASON",
        "change_reason must be text.",
        400,
      );
    }
    reason = body.change_reason.trim();
    if (
      reason.length > 1000 ||
      /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(reason)
    ) {
      previewFail(
        "INVALID_SUBMISSION_REASON",
        "change_reason must be at most 1000 printable characters.",
        400,
      );
    }
    reason = reason || null;
  }
  return {
    term,
    dryRun: body.dry_run,
    expectedId: firstAttempt ? null : expectedId,
    expectedVersion: firstAttempt ? null : previewPositiveId(expectedVersion),
    reason,
  };
}

// POST /api/gradebook/:offeringId/students/:enrollmentSubjectId/term-submissions
// This submits only the selected term. It does NOT update grades or publish a
// semester result. Program Head review is a separate, not-yet-enabled workflow.
router.post(
  "/:offeringId/students/:enrollmentSubjectId/term-submissions",
  async (req, res) => {
    const ids = validatePreviewIdentifiers(req, res);
    if (!ids) return;
    let input;
    try {
      input = submissionBody(req.body);
    } catch (error) {
      return sendError(res, error);
    }
    if (Object.keys(req.query).length !== 0) {
      return res.status(400).json({
        success: false,
        code: "UNSUPPORTED_TERM_SUBMISSION_QUERY",
        message: "Submission does not accept query parameters.",
      });
    }
    if (!input.dryRun && ids.offeringId !== TERM_SUBMISSION_TEST_OFFERING) {
      return res.status(403).json({
        success: false,
        code: "TEST_OFFERING_ONLY",
        message:
          "Committed term submissions are currently limited to QA Offering #131.",
      });
    }

    let connection;
    let transactionStarted = false;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;

      // A read/write pilot endpoint must never touch the development or production DB.
      // Combined grading writes remain QA-only.
      await assertQaGradingDatabase(connection);

      // SAME LOCK ORDER as score, assessment and attendance writers.
      const [offeringRows] = await connection.execute(
        `SELECT so.offering_id, so.status, so.academic_year_id, so.semester_id,
              cr.department_id, f.user_id AS assigned_user_id,
              u.is_active, u.is_archived, r.role_name
         FROM subject_offerings so
         LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
         LEFT JOIN users u ON u.user_id = f.user_id
         LEFT JOIN roles r ON r.role_id = u.role_id
         LEFT JOIN sections sec ON sec.section_id = so.section_id
         LEFT JOIN courses cr ON cr.course_id = sec.course_id
        WHERE so.offering_id = ? FOR UPDATE`,
        [ids.offeringId],
      );
      if (offeringRows.length !== 1) {
        previewFail(
          "OFFERING_NOT_FOUND",
          "Subject offering was not found.",
          404,
        );
      }
      const offering = offeringRows[0];
      if (
        Number(offering.assigned_user_id) !== ids.actorUserId ||
        Number(offering.is_active) !== 1 ||
        Number(offering.is_archived) !== 0 ||
        !["Faculty", "Program Head"].includes(offering.role_name)
      ) {
        previewFail(
          "GRADEBOOK_INSTRUCTOR_REQUIRED",
          "Only the active assigned instructor may submit this gradebook.",
          403,
        );
      }
      if (offering.status !== "Open") {
        previewFail(
          "OFFERING_NOT_OPEN",
          "Term submission requires an Open subject offering.",
        );
      }

      const [configRows] = await connection.execute(
        "SELECT config_id FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE",
        [ids.offeringId],
      );
      if (
        configRows.length !== 1 ||
        !previewPositiveId(configRows[0].config_id)
      ) {
        previewFail(
          "GRADEBOOK_NOT_INITIALIZED",
          "The subject offering has no initialized gradebook.",
        );
      }
      const configId = Number(configRows[0].config_id);

      // The student enrollment must still be the authorized placement for this offering.
      const [enrollments] = await connection.execute(
        `SELECT es.enrollment_subject_id, es.offering_id, es.status,
              e.enrollment_status, e.student_id
         FROM enrollment_subjects es
         JOIN enrollments e ON e.enrollment_id = es.enrollment_id
        WHERE es.enrollment_subject_id = ? FOR UPDATE`,
        [ids.enrollmentSubjectId],
      );
      if (
        enrollments.length !== 1 ||
        Number(enrollments[0].offering_id) !== ids.offeringId ||
        enrollments[0].status !== "Enrolled" ||
        enrollments[0].enrollment_status !== "Approved"
      ) {
        previewFail(
          "GRADEBOOK_STUDENT_NOT_ELIGIBLE",
          "The student must be currently approved and enrolled in this subject offering.",
        );
      }

      const departmentId = previewPositiveId(offering.department_id);
      const academicYearId = previewPositiveId(offering.academic_year_id);
      const semesterId = previewPositiveId(offering.semester_id);
      if (!departmentId || !academicYearId || !semesterId) {
        previewFail(
          "GRADEBOOK_DEPARTMENT_SCOPE_MISSING",
          "Offering academic year, semester, and course department are required.",
        );
      }

      // Submission windows are rechecked under a row lock; a simultaneous
      // Program Head CLOSE or deadline update cannot race this submission.
      const [periodRows] = await connection.execute(
        `SELECT period_id, period_status, record_version,
              CASE WHEN submission_deadline_at IS NOT NULL
                        AND NOW() > submission_deadline_at THEN 1 ELSE 0 END AS deadline_passed
         FROM gradebook_term_submission_periods
        WHERE department_id = ? AND academic_year_id = ?
          AND semester_id = ? AND grading_term = ? FOR UPDATE`,
        [departmentId, academicYearId, semesterId, input.term],
      );
      if (periodRows.length !== 1) {
        previewFail(
          "TERM_SUBMISSION_PERIOD_NOT_CONFIGURED",
          "Program Head must configure a term submission period before submission.",
        );
      }
      const period = periodRows[0];

      // Fail closed if the legacy semester workflow was previously activated.
      const [legacyLocks] = await connection.execute(
        "SELECT 1 FROM gradebook_structure_locks WHERE config_id = ? LIMIT 1",
        [configId],
      );
      const [legacySubmissions] = await connection.execute(
        `SELECT 1 FROM gradebook_grade_submission_attempts sa
         JOIN grades g ON g.grade_id = sa.grade_id
         JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
        WHERE es.offering_id = ? LIMIT 1`,
        [ids.offeringId],
      );
      if (legacyLocks.length || legacySubmissions.length) {
        previewFail(
          "GRADEBOOK_LEGACY_SUBMISSION_LOCKED",
          "Existing combined-semester history requires the legacy correction workflow.",
        );
      }

      // Never submit on top of an official/legacy grade row. A later finalizer
      // will explicitly reconcile both approved terms with the official grades table.
      const [existingGrades] = await connection.execute(
        "SELECT grade_id, grade_status, grading_policy FROM grades WHERE enrollment_subject_id = ? FOR UPDATE",
        [ids.enrollmentSubjectId],
      );
      if (existingGrades.length) {
        previewFail(
          "OFFICIAL_GRADE_REQUIRES_RECONCILIATION",
          "An existing grade record must be reconciled before using the new term-submission workflow.",
        );
      }

      const [latestRows] = await connection.execute(
        `SELECT term_submission_id, attempt_number, submission_status, record_version
         FROM gradebook_term_submission_attempts
        WHERE config_id = ? AND enrollment_subject_id = ? AND grading_term = ?
        ORDER BY attempt_number DESC, term_submission_id DESC LIMIT 1 FOR UPDATE`,
        [configId, ids.enrollmentSubjectId, input.term],
      );
      const latest = latestRows[0] ?? null;
      if (
        (latest ? String(latest.term_submission_id) : null) !==
          input.expectedId ||
        (latest ? Number(latest.record_version) : null) !==
          input.expectedVersion
      ) {
        previewFail(
          "TERM_SUBMISSION_VERSION_CONFLICT",
          "Submission status changed. Reload readiness before submitting again.",
          409,
        );
      }
      // A pending INC outcome request and a new numeric term submission must
      // never be advanced independently for the same student and offering.
      const [incConflicts] = await connection.execute(
        `SELECT inc_request_id, request_status
           FROM gradebook_inc_outcome_requests
          WHERE config_id = ? AND enrollment_subject_id = ?
            AND request_status IN ('SUBMITTED','APPROVED')
          LIMIT 1 FOR UPDATE`,
        [configId, ids.enrollmentSubjectId],
      );
      if (incConflicts.length) {
        previewFail(
          "INC_OUTCOME_REQUEST_ACTIVE",
          "This student has an active INC request. Resolve it before submitting a numeric term grade.",
        );
      }
      const [udConflicts] = await connection.execute(
        `SELECT ud_request_id FROM gradebook_ud_outcome_requests
         WHERE config_id = ? AND enrollment_subject_id = ?
           AND request_status IN ('SUBMITTED','APPROVED')
         LIMIT 1 FOR UPDATE`,
        [configId, ids.enrollmentSubjectId],
      );
      if (udConflicts.length) {
        previewFail(
          "UD_OUTCOME_REQUEST_ACTIVE",
          "Resolve the pending or approved UD request before numeric term submission.",
        );
      }

      if (latest && latest.submission_status === "SUBMITTED") {
        previewFail(
          "TERM_SUBMISSION_ALREADY_PENDING",
          "The current term submission is awaiting Program Head review.",
        );
      }
      if (latest && latest.submission_status === "APPROVED") {
        previewFail(
          "TERM_ALREADY_APPROVED",
          "The approved term requires a formal correction request.",
        );
      }
      if (latest && latest.submission_status !== "RETURNED") {
        previewFail(
          "TERM_SUBMISSION_STATE_INVALID",
          "Unsupported prior submission state.",
        );
      }
      const returnedException = latest?.submission_status === "RETURNED";
      if (returnedException && (!input.reason || input.reason.length < 5)) {
        previewFail(
          "TERM_RESUBMISSION_REASON_REQUIRED",
          "Resubmitting a returned term requires a documented change_reason.",
          400,
        );
      }
      if (
        !returnedException &&
        (period.period_status !== "OPEN" ||
          Number(period.deadline_passed) === 1)
      ) {
        previewFail(
          period.period_status !== "OPEN"
            ? "TERM_SUBMISSION_PERIOD_CLOSED"
            : "TERM_SUBMISSION_DEADLINE_PASSED",
          "Normal term submissions require an OPEN period before its deadline.",
        );
      }

      const [lockRows] = await connection.execute(
        `SELECT first_submission_id FROM gradebook_term_structure_locks
        WHERE config_id = ? AND grading_term = ?`,
        [configId, input.term],
      );
      const [submissionCountRows] = await connection.execute(
        `SELECT COUNT(*) AS total FROM gradebook_term_submission_attempts
        WHERE config_id = ? AND grading_term = ?`,
        [configId, input.term],
      );
      const priorTermCount = Number(submissionCountRows[0]?.total ?? 0);
      if (
        (priorTermCount === 0 && lockRows.length !== 0) ||
        (priorTermCount > 0 && lockRows.length !== 1)
      ) {
        previewFail(
          "TERM_STRUCTURE_LOCK_DATA_INVALID",
          "Term submission history and shared structure lock are inconsistent.",
        );
      }
      if (
        latest &&
        (!Number.isSafeInteger(Number(latest.attempt_number)) ||
          Number(latest.attempt_number) >= 4294967295)
      ) {
        previewFail(
          "TERM_SUBMISSION_ATTEMPT_OVERFLOW",
          "Term submission attempt number limit reached.",
        );
      }

      // Recalculate against the currently saved score and attendance rows INSIDE
      // this transaction. The offering/config locks serialize all supported writers.
      const preview = await calculateGradePreview(
        connection,
        ids.offeringId,
        ids.enrollmentSubjectId,
        ids.actorUserId,
      );
      if (Number(preview.config_id) !== configId) {
        previewFail(
          "GRADEBOOK_CONFIG_INVALID",
          "Gradebook configuration changed during submission.",
        );
      }
      const selected = preview.terms[input.term];
      if (
        !selected ||
        selected.state !== "READY" ||
        !selected.term_percentage
      ) {
        previewFail(
          "TERM_GRADE_INCOMPLETE",
          `The ${input.term} grade is incomplete. Complete all categories and saved attendance first.`,
          422,
        );
      }
      // Future SCHEDULED meetings cannot be marked HELD after first submission,
      // so refuse to freeze a term that still has unfinished meeting structure.
      const [scheduledRows] = await connection.execute(
        `SELECT COUNT(*) AS pending_meetings FROM gradebook_attendance_meetings
        WHERE config_id = ? AND grading_term = ? AND meeting_status = 'SCHEDULED'`,
        [configId, input.term],
      );
      if (Number(scheduledRows[0]?.pending_meetings) > 0) {
        previewFail(
          "TERM_HAS_SCHEDULED_MEETINGS",
          "Complete or cancel remaining scheduled meetings before the first term submission.",
        );
      }

      const exactN = selected.term_percentage.exact_numerator;
      const exactD = selected.term_percentage.exact_denominator;
      if (
        !/^(0|[1-9]\d*)$/.test(exactN) ||
        !/^[1-9]\d*$/.test(exactD) ||
        exactN.length > 255 ||
        exactD.length > 255
      ) {
        previewFail(
          "TERM_GRADE_EXACT_VALUE_INVALID",
          "Exact term fraction cannot be saved in the configured submission snapshot.",
        );
      }

      const attemptNumber = latest ? Number(latest.attempt_number) + 1 : 1;
      const batchRef = randomUUID();
      const savedSnapshot = JSON.stringify({
        policy: preview.grading_policy,
        classification: preview.grading_classification,
        term_weights: preview.term_weights,
        offering_id: ids.offeringId,
        config_id: configId,
        enrollment_subject_id: ids.enrollmentSubjectId,
        student_id: preview.student.student_id,
        grading_term: input.term,
        academic_year_id: academicYearId,
        semester_id: semesterId,
        department_id: departmentId,
        submission_reason: input.reason,
        calculated_term: selected,
      });

      // Recheck the deadline immediately before persisting; the window may
      // expire while a large gradebook calculation is running.
      if (!returnedException) {
        const [deadlineCheck] = await connection.execute(
          `SELECT CASE WHEN period_status = 'OPEN'
                 AND (submission_deadline_at IS NULL OR NOW() <= submission_deadline_at)
                THEN 1 ELSE 0 END AS allowed
           FROM gradebook_term_submission_periods WHERE period_id = ? FOR UPDATE`,
          [Number(period.period_id)],
        );
        if (Number(deadlineCheck[0]?.allowed) !== 1) {
          previewFail(
            "TERM_SUBMISSION_WINDOW_EXPIRED",
            "The submission window closed or expired during calculation. Reload and retry.",
          );
        }
      }

      // Recheck the deadline at the point of insert; a long calculation can cross it.
      if (!returnedException) {
        const [deadlineCheck] = await connection.execute(
          `SELECT CASE WHEN period_status = 'OPEN'
                 AND (submission_deadline_at IS NULL OR NOW() <= submission_deadline_at)
                THEN 1 ELSE 0 END AS allowed
           FROM gradebook_term_submission_periods WHERE period_id = ? FOR UPDATE`,
          [Number(period.period_id)],
        );
        if (Number(deadlineCheck[0]?.allowed) !== 1) {
          previewFail(
            "TERM_SUBMISSION_WINDOW_EXPIRED",
            "The submission window closed or expired during calculation. Reload and retry.",
          );
        }
      }

      const [insert] = await connection.execute(
        `INSERT INTO gradebook_term_submission_attempts
         (config_id, enrollment_subject_id, grading_term, period_id,
          attempt_number, submission_batch_ref,
          term_percentage_exact_numerator, term_percentage_exact_denominator,
          calculation_snapshot_json, submission_status, submitted_by_user_id,
          record_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, 1)`,
        [
          configId,
          ids.enrollmentSubjectId,
          input.term,
          Number(period.period_id),
          attemptNumber,
          batchRef,
          exactN,
          exactD,
          savedSnapshot,
          ids.actorUserId,
        ],
      );
      if (Number(insert.affectedRows) !== 1) {
        throw new Error("Term submission insert did not save exactly one row.");
      }
      const submissionId = String(insert.insertId);
      let structureLockCreated = false;
      if (priorTermCount === 0) {
        const [structureLock] = await connection.execute(
          `INSERT INTO gradebook_term_structure_locks
           (config_id, grading_term, first_submission_id, locked_by_user_id,
            lock_reason)
         VALUES (?, ?, ?, ?, 'FIRST_TERM_SUBMISSION')`,
          [configId, input.term, submissionId, ids.actorUserId],
        );
        if (Number(structureLock.affectedRows) !== 1) {
          throw new Error(
            "First term submission did not create its structure lock.",
          );
        }
        structureLockCreated = true;
      }

      const result = {
        success: true,
        offering_id: ids.offeringId,
        config_id: configId,
        enrollment_subject_id: ids.enrollmentSubjectId,
        grading_term: input.term,
        period_id: Number(period.period_id),
        submission: {
          term_submission_id: submissionId,
          attempt_number: attemptNumber,
          submission_batch_ref: batchRef,
          submission_status: "SUBMITTED",
          record_version: 1,
          term_percentage: selected.term_percentage,
          submitted_by_user_id: ids.actorUserId,
        },
        resubmitted_after_return: returnedException,
        structure_lock_created: structureLockCreated,
        other_term_structure_unchanged: true,
        dry_run: input.dryRun,
        persisted: !input.dryRun,
        note: "Term submitted for Program Head review only. No official grade was published.",
      };
      if (input.dryRun) await connection.rollback();
      else await connection.commit();
      transactionStarted = false;
      return res.status(input.dryRun ? 200 : 201).json(result);
    } catch (error) {
      if (transactionStarted && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("TERM SUBMISSION ROLLBACK ERROR:", rollbackError);
        }
      }
      if (error?.code === "ER_DUP_ENTRY") {
        return sendError(res, {
          status: 409,
          code: "TERM_SUBMISSION_VERSION_CONFLICT",
          message: "Another submission was saved. Reload and retry.",
        });
      }
      return sendError(res, error);
    } finally {
      connection?.release();
    }
  },
);

// STEP 2.8.11H1 — Faculty INC outcome request (controlled QA pilot)
// A proposed INC is not yet an official grade. Program Head review and
// publication are separate later steps; no grade or INC deadline is invented.
function incReason(value, label, maxLength) {
  if (typeof value !== "string") {
    previewFail("INC_REASON_REQUIRED", `${label} must be a string.`, 400);
  }
  const normalized = value.trim();
  if (
    normalized.length < 10 ||
    normalized.length > maxLength ||
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(normalized)
  ) {
    previewFail(
      "INC_REASON_INVALID",
      `${label} must contain 10–${maxLength} printable characters.`,
      400,
    );
  }
  return normalized;
}

function incRequestBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    previewFail("INC_BODY_INVALID", "A JSON object is required.", 400);
  }
  const allowed = ["outcome_reason", "evidence_summary", "dry_run"];
  const extras = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extras.length) {
    previewFail(
      "INC_FIELDS_UNSUPPORTED",
      `Unsupported field(s): ${extras.join(", ")}.`,
      400,
    );
  }
  if (typeof body.dry_run !== "boolean") {
    previewFail("INC_DRY_RUN_REQUIRED", "dry_run must be true or false.", 400);
  }
  return {
    reason: incReason(body.outcome_reason, "outcome_reason", 500),
    evidence: incReason(body.evidence_summary, "evidence_summary", 4000),
    dryRun: body.dry_run,
  };
}

async function incCheckTestDatabase(connection) {
  const [rows] = await connection.execute("SELECT DATABASE() AS database_name");
  if (rows[0]?.database_name !== TERM_SUBMISSION_TEST_DB) {
    previewFail(
      "INC_TEST_DATABASE_ONLY",
      "INC request pilot is limited to databaseforptc1_admission_test.",
      403,
    );
  }
}

async function incReadiness(connection, ids, lockRows) {
  const lock = lockRows ? " FOR UPDATE" : "";
  const blockers = [];
  const block = (code, message) => blockers.push({ code, message });

  // Match numeric submission lock order: offering → config → enrollment →
  // period → grades → latest term submissions → INC request.
  const [offerings] = await connection.execute(
    `SELECT so.offering_id, so.status, so.academic_year_id, so.semester_id,
            cr.department_id, f.user_id AS assigned_user_id,
            u.is_active, u.is_archived, r.role_name
       FROM subject_offerings so
       LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
       LEFT JOIN users u ON u.user_id = f.user_id
       LEFT JOIN roles r ON r.role_id = u.role_id
       LEFT JOIN sections sec ON sec.section_id = so.section_id
       LEFT JOIN courses cr ON cr.course_id = sec.course_id
      WHERE so.offering_id = ?${lock}`,
    [ids.offeringId],
  );
  if (offerings.length !== 1) {
    previewFail("OFFERING_NOT_FOUND", "Subject offering was not found.", 404);
  }
  const offering = offerings[0];
  if (
    Number(offering.assigned_user_id) !== ids.actorUserId ||
    Number(offering.is_active) !== 1 ||
    Number(offering.is_archived) !== 0 ||
    !["Faculty", "Program Head"].includes(offering.role_name)
  ) {
    previewFail(
      "GRADEBOOK_INSTRUCTOR_REQUIRED",
      "Only the active assigned instructor may file an INC request.",
      403,
    );
  }
  if (offering.status !== "Open")
    block("OFFERING_NOT_OPEN", "The subject offering must be Open.");
  const departmentId = previewPositiveId(offering.department_id);
  const academicYearId = previewPositiveId(offering.academic_year_id);
  const semesterId = previewPositiveId(offering.semester_id);
  if (!departmentId || !academicYearId || !semesterId) {
    block(
      "INC_ACADEMIC_SCOPE_MISSING",
      "Offering department and academic scope must be valid.",
    );
  }

  const [configs] = await connection.execute(
    `SELECT config_id FROM gradebook_offering_config WHERE offering_id = ?${lock}`,
    [ids.offeringId],
  );
  if (configs.length !== 1) {
    previewFail(
      "GRADEBOOK_NOT_INITIALIZED",
      "This offering has no initialized gradebook.",
    );
  }
  const configId = Number(configs[0].config_id);

  const [enrollments] = await connection.execute(
    `SELECT es.enrollment_subject_id, es.offering_id, es.status,
            e.enrollment_status, e.student_id
       FROM enrollment_subjects es
       JOIN enrollments e ON e.enrollment_id = es.enrollment_id
      WHERE es.enrollment_subject_id = ?${lock}`,
    [ids.enrollmentSubjectId],
  );
  if (
    enrollments.length !== 1 ||
    Number(enrollments[0].offering_id) !== ids.offeringId
  ) {
    previewFail(
      "GRADEBOOK_STUDENT_NOT_FOUND",
      "Student is not assigned to this offering.",
      404,
    );
  }
  if (
    enrollments[0].status !== "Enrolled" ||
    enrollments[0].enrollment_status !== "Approved"
  ) {
    block(
      "INC_STUDENT_NOT_ENROLLED",
      "Only approved and currently enrolled students can receive a new INC request.",
    );
  }

  let period = null;
  if (departmentId && academicYearId && semesterId) {
    const [periodRows] = await connection.execute(
      `SELECT period_id, period_status, submission_deadline_at,
              CASE WHEN submission_deadline_at IS NOT NULL AND NOW() > submission_deadline_at THEN 1 ELSE 0 END AS deadline_passed
         FROM gradebook_term_submission_periods
        WHERE department_id = ? AND academic_year_id = ? AND semester_id = ?
          AND grading_term = 'FINAL_TERM'${lock}`,
      [departmentId, academicYearId, semesterId],
    );
    if (periodRows.length > 1)
      previewFail(
        "INC_PERIOD_DATA_INVALID",
        "Duplicate Final Term periods exist.",
      );
    period = periodRows[0] ?? null;
  }
  if (!period)
    block(
      "INC_FINAL_TERM_PERIOD_MISSING",
      "Program Head must configure the Final Term submission period.",
    );
  else if (
    period.period_status !== "OPEN" ||
    Number(period.deadline_passed) === 1
  ) {
    block(
      "INC_FINAL_TERM_PERIOD_NOT_OPEN",
      "Final Term INC requests require an open submission period before its deadline.",
    );
  }

  const [grades] = await connection.execute(
    `SELECT grade_id, grade_status FROM grades WHERE enrollment_subject_id = ?${lock}`,
    [ids.enrollmentSubjectId],
  );
  if (grades.length)
    block(
      "OFFICIAL_GRADE_ALREADY_EXISTS",
      "An official grade already exists; use the formal correction process.",
    );

  const latest = {};
  for (const term of ["MIDTERM", "FINAL_TERM"]) {
    const [attemptRows] = await connection.execute(
      `SELECT term_submission_id, submission_status, attempt_number, record_version
         FROM gradebook_term_submission_attempts
        WHERE config_id = ? AND enrollment_subject_id = ? AND grading_term = ?
        ORDER BY attempt_number DESC, term_submission_id DESC LIMIT 1${lock}`,
      [configId, ids.enrollmentSubjectId, term],
    );
    latest[term] = attemptRows.length
      ? {
          term_submission_id: String(attemptRows[0].term_submission_id),
          submission_status: attemptRows[0].submission_status,
          attempt_number: Number(attemptRows[0].attempt_number),
          record_version: Number(attemptRows[0].record_version),
        }
      : null;
  }
  // A conservative first pilot: one approved Midterm and no Final Term
  // attempt. Never bypass an already-submitted Final Term review.
  if (latest.MIDTERM?.submission_status !== "APPROVED") {
    block(
      "INC_MIDTERM_APPROVAL_REQUIRED",
      "The controlled INC pilot requires an approved Midterm.",
    );
  }
  if (latest.FINAL_TERM) {
    block(
      "INC_FINAL_TERM_ATTEMPT_EXISTS",
      "A Final Term submission already exists; reconcile it before requesting INC.",
    );
  }

  const [requests] = await connection.execute(
    `SELECT inc_request_id, request_status, outcome_reason, evidence_summary,
            midterm_submission_id, submitted_by_user_id, record_version,
            DATE_FORMAT(submitted_at, '%Y-%m-%d %H:%i:%s.%f') AS submitted_at
       FROM gradebook_inc_outcome_requests
      WHERE config_id = ? AND enrollment_subject_id = ?${lock}`,
    [configId, ids.enrollmentSubjectId],
  );
  if (requests.length > 1)
    previewFail(
      "INC_REQUEST_DATA_INVALID",
      "Duplicate INC requests were found.",
    );
  const existing = requests[0]
    ? {
        inc_request_id: String(requests[0].inc_request_id),
        request_status: requests[0].request_status,
        outcome_reason: requests[0].outcome_reason,
        evidence_summary: requests[0].evidence_summary,
        midterm_submission_id: String(requests[0].midterm_submission_id),
        submitted_by_user_id: Number(requests[0].submitted_by_user_id),
        submitted_at: requests[0].submitted_at,
        record_version: Number(requests[0].record_version),
      }
    : null;
  if (existing)
    block(
      "INC_REQUEST_ALREADY_EXISTS",
      "This student already has an INC request. Reload its status.",
    );

  // The INC one-year deadline must never use today's date, Faculty submission,
  // Program Head approval, or grade publication as substitutes for a verified
  // original official grading-sheet submission date.
  const [sheets] = await connection.execute(
    `SELECT sheet_id, sheet_status, record_version,
            DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_official_submitted_on,
            official_submission_reference, official_date_verified_by_user_id,
            DATE_FORMAT(official_date_verified_at, '%Y-%m-%d %H:%i:%s') AS official_date_verified_at,
            CASE WHEN original_official_submitted_on IS NOT NULL
                       AND official_date_verified_at IS NOT NULL
                       AND official_date_verified_by_user_id IS NOT NULL
                 THEN DATE_FORMAT(DATE_ADD(original_official_submitted_on, INTERVAL 1 YEAR), '%Y-%m-%d')
                 ELSE NULL END AS inc_deadline_on
       FROM gradebook_official_sheets WHERE config_id = ?`,
    [configId],
  );
  if (sheets.length > 1)
    previewFail(
      "INC_SHEET_DATA_INVALID",
      "Duplicate official grading sheets were found.",
    );
  const sheet = sheets[0] ?? null;

  return {
    offering_id: ids.offeringId,
    config_id: configId,
    enrollment_subject_id: ids.enrollmentSubjectId,
    student_id: Number(enrollments[0].student_id),
    academic_scope: {
      department_id: departmentId,
      academic_year_id: academicYearId,
      semester_id: semesterId,
    },
    latest_term_submissions: latest,
    final_term_submission_period: period
      ? {
          period_id: Number(period.period_id),
          period_status: period.period_status,
          deadline_passed: Number(period.deadline_passed) === 1,
        }
      : null,
    inc_request: existing,
    official_sheet: sheet
      ? {
          sheet_id: String(sheet.sheet_id),
          sheet_status: sheet.sheet_status,
          original_official_submitted_on: sheet.original_official_submitted_on,
          official_submission_reference: sheet.official_submission_reference,
          official_date_verified_by_user_id:
            sheet.official_date_verified_by_user_id,
          official_date_verified_at: sheet.official_date_verified_at,
          inc_completion_deadline_on: sheet.inc_deadline_on,
          deadline_established: sheet.inc_deadline_on !== null,
        }
      : {
          sheet_id: null,
          inc_completion_deadline_on: null,
          deadline_established: false,
        },
    proposed_outcome: {
      grading_outcome: "INCOMPLETE",
      final_rating: "4.00",
      remarks: "Incomplete",
      official_grade_published: false,
    },
    can_request_inc: blockers.length === 0,
    blockers,
  };
}

// GET /api/gradebook/:offeringId/students/:enrollmentSubjectId/inc-outcome-readiness
router.get(
  "/:offeringId/students/:enrollmentSubjectId/inc-outcome-readiness",
  async (req, res) => {
    const ids = validatePreviewIdentifiers(req, res);
    if (!ids) return;
    if (Object.keys(req.query).length) {
      return sendError(res, {
        status: 400,
        code: "INC_QUERY_UNSUPPORTED",
        message: "This endpoint has no query parameters.",
      });
    }
    let connection;
    try {
      connection = await db.getConnection();
      await incCheckTestDatabase(connection);
      const result = await incReadiness(connection, ids, false);
      return res.json({ success: true, read_only: true, ...result });
    } catch (error) {
      return sendError(res, error);
    } finally {
      connection?.release();
    }
  },
);

// POST /api/gradebook/:offeringId/students/:enrollmentSubjectId/inc-outcome-requests
// Creates a Faculty request only; no grade, 4.00, or official deadline is
// committed here. Program Head review and official publication come later.
router.post(
  "/:offeringId/students/:enrollmentSubjectId/inc-outcome-requests",
  async (req, res) => {
    const ids = validatePreviewIdentifiers(req, res);
    if (!ids) return;
    if (Object.keys(req.query).length) {
      return sendError(res, {
        status: 400,
        code: "INC_QUERY_UNSUPPORTED",
        message: "This endpoint has no query parameters.",
      });
    }
    let input;
    try {
      input = incRequestBody(req.body);
    } catch (error) {
      return sendError(res, error);
    }
    // Modern combined INC readiness
    if (ids.offeringId === 130) {
      let modernConnection;
      let transactionOpen = false;

      try {
        modernConnection = await db.getConnection();
        await modernConnection.query("START TRANSACTION READ ONLY");
        transactionOpen = true;

        const result = await modernIncReadiness(modernConnection, ids);

        await modernConnection.rollback();
        transactionOpen = false;

        return res.json(result);
      } catch (error) {
        if (transactionOpen && modernConnection) {
          await modernConnection.rollback();
        }

        return sendError(res, error);
      } finally {
        modernConnection?.release();
      }
    }
    // Modern INC completion claim
    if (ids.offeringId === 130) {
      let connection;
      let transactionOpen = false;

      try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        transactionOpen = true;

        const result = await createModernIncClaim(connection, ids, input);

        if (input.dryRun) await connection.rollback();
        else await connection.commit();

        transactionOpen = false;

        return res.status(input.dryRun ? 200 : 201).json(result);
      } catch (error) {
        if (transactionOpen && connection) {
          try {
            await connection.rollback();
          } catch (rollbackError) {
            console.error("MODERN INC CLAIM ROLLBACK:", rollbackError);
          }
        }

        if (error?.code === "ER_DUP_ENTRY") {
          return sendError(res, {
            status: 409,
            code: "INC_COMPLETION_CLAIM_ALREADY_EXISTS",
            message: "A completion claim already exists. Reload readiness.",
          });
        }

        return sendError(res, error);
      } finally {
        connection?.release();
      }
    }
    if (ids.offeringId !== TERM_SUBMISSION_TEST_OFFERING) {
      return sendError(res, {
        status: 403,
        code: "INC_TEST_OFFERING_ONLY",
        message: "The INC request pilot is limited to QA Offering #131.",
      });
    }
    let connection;
    let transactionStarted = false;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;
      await incCheckTestDatabase(connection);
      const readiness = await incReadiness(connection, ids, true);
      if (!readiness.can_request_inc) {
        previewFail(
          "INC_REQUEST_NOT_READY",
          `INC request is blocked: ${readiness.blockers.map((b) => b.code).join(", ")}.`,
          409,
        );
      }
      const [insert] = await connection.execute(
        `INSERT INTO gradebook_inc_outcome_requests
       (config_id, enrollment_subject_id, request_status, outcome_reason,
        evidence_summary, midterm_submission_id, submitted_by_user_id, record_version)
       VALUES (?, ?, 'SUBMITTED', ?, ?, ?, ?, 1)`,
        [
          readiness.config_id,
          ids.enrollmentSubjectId,
          input.reason,
          input.evidence,
          readiness.latest_term_submissions.MIDTERM.term_submission_id,
          ids.actorUserId,
        ],
      );
      if (Number(insert.affectedRows) !== 1)
        throw new Error("INC request was not inserted.");
      const requestId = String(insert.insertId);
      const [audit] = await connection.execute(
        `INSERT INTO gradebook_inc_outcome_request_events
       (inc_request_id, event_type, previous_status, new_status,
        reason_snapshot, evidence_snapshot, performed_by_user_id, request_version_after)
       VALUES (?, 'SUBMITTED', NULL, 'SUBMITTED', ?, ?, ?, 1)`,
        [requestId, input.reason, input.evidence, ids.actorUserId],
      );
      if (Number(audit.affectedRows) !== 1)
        throw new Error("INC request audit was not inserted.");
      if (input.dryRun) await connection.rollback();
      else await connection.commit();
      transactionStarted = false;
      return res.status(input.dryRun ? 200 : 201).json({
        success: true,
        inc_request: {
          inc_request_id: input.dryRun ? null : requestId,
          config_id: readiness.config_id,
          enrollment_subject_id: ids.enrollmentSubjectId,
          request_status: "SUBMITTED",
          record_version: 1,
          outcome_reason: input.reason,
          evidence_summary: input.evidence,
          midterm_submission_id:
            readiness.latest_term_submissions.MIDTERM.term_submission_id,
          submitted_by_user_id: ids.actorUserId,
        },
        audit_event: "SUBMITTED",
        audit_event_id: input.dryRun ? null : String(audit.insertId),
        inc_completion_deadline_on:
          readiness.official_sheet.inc_completion_deadline_on,
        dry_run: input.dryRun,
        persisted: !input.dryRun,
        official_grade_published: false,
        note: input.dryRun
          ? "Dry-run INC request rolled back; no official grade was created."
          : "INC request submitted for future Program Head review; no official INC grade was published.",
      });
    } catch (error) {
      if (transactionStarted && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("INC REQUEST ROLLBACK ERROR:", rollbackError);
        }
      }
      if (error?.code === "ER_DUP_ENTRY") {
        return sendError(res, {
          status: 409,
          code: "INC_REQUEST_ALREADY_EXISTS",
          message:
            "A concurrent INC request was already saved. Reload the INC readiness endpoint.",
        });
      }
      return sendError(res, error);
    } finally {
      connection?.release();
    }
  },
);

// STEP 2.8.11K3B1 — Faculty INC completion-claim readiness (QA, read-only)
// This checks an existing official INC grade; it never creates a claim,
// changes a grade, or establishes an official submission date.
router.get(
  "/:offeringId/students/:enrollmentSubjectId/inc-completion-readiness",
  async (req, res) => {
    const ids = validatePreviewIdentifiers(req, res);
    if (!ids) return;
    if (Object.keys(req.query).length) {
      return sendError(res, {
        status: 400,
        code: "INC_COMPLETION_QUERY_UNSUPPORTED",
        message: "This endpoint does not accept query parameters.",
      });
    }
    // Modern combined INC readiness
    if (ids.offeringId === 130) {
      let modernConnection;
      let transactionOpen = false;
      try {
        modernConnection = await db.getConnection();
        await modernConnection.query("START TRANSACTION READ ONLY");
        transactionOpen = true;
        const result = await modernIncReadiness(modernConnection, ids);
        await modernConnection.rollback();
        transactionOpen = false;
        return res.json(result);
      } catch (error) {
        if (transactionOpen && modernConnection) {
          try {
            await modernConnection.rollback();
          } catch (rollbackError) {
            console.error("MODERN INC READINESS ROLLBACK:", rollbackError);
            modernConnection.destroy();
            modernConnection = null;
          }
        }
        return sendError(res, error);
      } finally {
        modernConnection?.release();
      }
    }

    if (ids.offeringId !== TERM_SUBMISSION_TEST_OFFERING) {
      return sendError(res, {
        status: 403,
        code: "INC_COMPLETION_TEST_OFFERING_ONLY",
        message: "INC completion readiness is limited to QA Offering #131.",
      });
    }

    let connection;
    try {
      connection = await db.getConnection();
      await incCheckTestDatabase(connection);
      const blockers = [];
      const warnings = [];
      const block = (code, message) => blockers.push({ code, message });

      // Confirm this account still actively owns the offering.
      const [offerings] = await connection.execute(
        `SELECT so.offering_id, so.faculty_id, f.user_id AS assigned_user_id,
                u.is_active, u.is_archived, r.role_name,
                so.academic_year_id, so.semester_id, cr.department_id
           FROM subject_offerings so
           LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
           LEFT JOIN users u ON u.user_id = f.user_id
           LEFT JOIN roles r ON r.role_id = u.role_id
           LEFT JOIN sections sec ON sec.section_id = so.section_id
           LEFT JOIN courses cr ON cr.course_id = sec.course_id
          WHERE so.offering_id = ?`,
        [ids.offeringId],
      );
      if (offerings.length !== 1) {
        previewFail(
          "OFFERING_NOT_FOUND",
          "Subject offering was not found.",
          404,
        );
      }
      const offering = offerings[0];
      if (
        Number(offering.assigned_user_id) !== ids.actorUserId ||
        Number(offering.is_active) !== 1 ||
        Number(offering.is_archived) !== 0 ||
        !["Faculty", "Program Head"].includes(offering.role_name)
      ) {
        previewFail(
          "GRADEBOOK_INSTRUCTOR_REQUIRED",
          "Only the active assigned instructor may view INC completion readiness.",
          403,
        );
      }

      const [configs] = await connection.execute(
        "SELECT config_id FROM gradebook_offering_config WHERE offering_id = ?",
        [ids.offeringId],
      );
      if (configs.length !== 1) {
        previewFail(
          "GRADEBOOK_NOT_INITIALIZED",
          "The offering must have exactly one initialized gradebook.",
        );
      }
      const configId = Number(configs[0].config_id);

      const [students] = await connection.execute(
        `SELECT es.enrollment_subject_id, es.status AS enrollment_subject_status,
                e.enrollment_status, e.student_id,
                g.grade_id, g.grade_status, g.grading_policy, g.grading_outcome,
                g.final_rating, g.midterm_grade, g.final_grade, g.overall_percentage,
                g.faculty_id AS grade_faculty_id
           FROM enrollment_subjects es
           JOIN enrollments e ON e.enrollment_id = es.enrollment_id
           LEFT JOIN grades g ON g.enrollment_subject_id = es.enrollment_subject_id
          WHERE es.enrollment_subject_id = ? AND es.offering_id = ?`,
        [ids.enrollmentSubjectId, ids.offeringId],
      );
      if (!students.length) {
        previewFail(
          "GRADEBOOK_STUDENT_NOT_FOUND",
          "Student is not assigned to this offering.",
          404,
        );
      }
      if (students.length !== 1) {
        previewFail(
          "INC_COMPLETION_GRADE_DATA_INVALID",
          "Multiple official grade records were found for the student.",
        );
      }
      const student = students[0];
      if (
        student.enrollment_status !== "Approved" ||
        student.enrollment_subject_status !== "Incomplete"
      ) {
        block(
          "INC_COMPLETION_SUBJECT_NOT_ELIGIBLE",
          "The student must have an approved enrollment and an Incomplete subject status.",
        );
      }
      if (!student.grade_id) {
        block(
          "INC_COMPLETION_OFFICIAL_GRADE_MISSING",
          "No official INC grade is available for this student.",
        );
      } else if (
        student.grade_status !== "Approved" ||
        student.grading_policy !== "TWO_TERM_50_50" ||
        student.grading_outcome !== "INCOMPLETE" ||
        Number(student.final_rating) !== 4 ||
        Number(student.grade_faculty_id) !== Number(offering.faculty_id)
      ) {
        block(
          "INC_COMPLETION_NOT_APPROVED_INC",
          "This is not an approved, correctly linked official INC 4.00 grade.",
        );
      }

      const [incRequests] = await connection.execute(
        `SELECT inc_request_id, request_status, record_version
           FROM gradebook_inc_outcome_requests
          WHERE config_id = ? AND enrollment_subject_id = ?`,
        [configId, ids.enrollmentSubjectId],
      );
      if (
        incRequests.length !== 1 ||
        incRequests[0].request_status !== "APPROVED"
      ) {
        block(
          "INC_COMPLETION_APPROVED_OUTCOME_REQUEST_REQUIRED",
          "A reviewed and approved INC outcome request is required for this QA workflow.",
        );
      }

      const [sheets] = await connection.execute(
        `SELECT sheet_id, sheet_status, record_version,
                DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_official_submitted_on,
                official_date_verified_by_user_id, official_date_verified_at,
                CASE WHEN original_official_submitted_on IS NOT NULL
                           AND official_date_verified_by_user_id IS NOT NULL
                           AND official_date_verified_at IS NOT NULL
                     THEN DATE_FORMAT(DATE_ADD(original_official_submitted_on, INTERVAL 1 YEAR), '%Y-%m-%d')
                     ELSE NULL END AS inc_completion_deadline_on
           FROM gradebook_official_sheets WHERE config_id = ?`,
        [configId],
      );
      if (sheets.length > 1) {
        previewFail(
          "INC_COMPLETION_SHEET_DATA_INVALID",
          "Duplicate official sheets were found.",
        );
      }
      const sheet = sheets[0] ?? null;
      if (!sheet?.inc_completion_deadline_on) {
        warnings.push({
          code: "INC_COMPLETION_DEADLINE_UNVERIFIED",
          message:
            "The Registrar has not verified the original official-sheet date. A claim can only be recorded as pending; timeliness cannot yet be verified.",
        });
      }

      let claims = [];
      let legacyRequests = [];
      if (student.grade_id) {
        [claims] = await connection.execute(
          `SELECT claim_id, grade_change_request_id, verification_status,
                  DATE_FORMAT(claimed_completed_on, '%Y-%m-%d') AS claimed_completed_on,
                  DATE_FORMAT(verified_completed_on, '%Y-%m-%d') AS verified_completed_on,
                  submitted_by_user_id, record_version
             FROM gradebook_inc_completion_claims
            WHERE grade_id = ? ORDER BY claim_id DESC LIMIT 10`,
          [student.grade_id],
        );
        if (claims.length) {
          block(
            "INC_COMPLETION_CLAIM_ALREADY_EXISTS",
            "An INC completion claim already exists for this official grade. Reload its status before proceeding.",
          );
        }
        [legacyRequests] = await connection.execute(
          `SELECT grade_change_request_id, status
             FROM grade_change_requests
            WHERE grade_id = ? AND request_type = 'INC_COMPLETION'
              AND status IN ('Pending Program Head', 'For Registrar Processing')
            ORDER BY grade_change_request_id DESC LIMIT 10`,
          [student.grade_id],
        );
        if (legacyRequests.length) {
          block(
            "INC_COMPLETION_LEGACY_REQUEST_PENDING",
            "An older INC completion grade-change request is pending and requires reconciliation.",
          );
        }
      }

      return res.json({
        success: true,
        read_only: true,
        offering_id: ids.offeringId,
        config_id: configId,
        enrollment_subject_id: ids.enrollmentSubjectId,
        student_id: Number(student.student_id),
        instructor_user_id: ids.actorUserId,
        official_grade: student.grade_id
          ? {
              grade_id: Number(student.grade_id),
              grade_status: student.grade_status,
              grading_outcome: student.grading_outcome,
              final_rating: String(student.final_rating),
              midterm_grade:
                student.midterm_grade === null
                  ? null
                  : String(student.midterm_grade),
              final_grade:
                student.final_grade === null
                  ? null
                  : String(student.final_grade),
            }
          : null,
        official_sheet: {
          sheet_id: sheet ? String(sheet.sheet_id) : null,
          deadline_established: Boolean(sheet?.inc_completion_deadline_on),
          inc_completion_deadline_on: sheet?.inc_completion_deadline_on ?? null,
        },
        existing_claims: claims.map((claim) => ({
          claim_id: String(claim.claim_id),
          verification_status: claim.verification_status,
          record_version: Number(claim.record_version),
          claimed_completed_on: claim.claimed_completed_on,
          verified_completed_on: claim.verified_completed_on,
          grade_change_request_id: claim.grade_change_request_id,
        })),
        legacy_pending_request_count: legacyRequests.length,
        can_file_completion_claim: blockers.length === 0,
        blockers,
        warnings,
        note: "Readiness only. No completion claim, numeric grade change, or official deadline was saved.",
      });
    } catch (error) {
      return sendError(res, error);
    } finally {
      connection?.release();
    }
  },
);
// Step 2.8.11K3B2 — Faculty INC completion claim (QA pilot)
// This creates a pending claim and its audit event, never a grade conversion.
function completionClaimBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    previewFail(
      "INC_COMPLETION_BODY_INVALID",
      "A JSON object is required.",
      400,
    );
  }

  const permitted = new Set([
    "expected_grade_id",
    "claimed_completed_on",
    "completion_reason",
    "evidence_summary",
    "dry_run",
  ]);
  const extras = Object.keys(body).filter((field) => !permitted.has(field));
  if (extras.length) {
    previewFail(
      "INC_COMPLETION_FIELDS_UNSUPPORTED",
      `Unsupported field(s): ${extras.join(", ")}.`,
      400,
    );
  }
  const expectedGradeId = previewPositiveId(body.expected_grade_id);
  if (!expectedGradeId) {
    previewFail(
      "INC_COMPLETION_EXPECTED_GRADE_REQUIRED",
      "expected_grade_id must be the official grade ID returned by readiness.",
      400,
    );
  }
  if (typeof body.dry_run !== "boolean") {
    previewFail(
      "INC_COMPLETION_DRY_RUN_REQUIRED",
      "dry_run must be true or false.",
      400,
    );
  }

  const claimedDate = body.claimed_completed_on;
  if (
    typeof claimedDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(claimedDate)
  ) {
    previewFail(
      "INC_COMPLETION_DATE_INVALID",
      "claimed_completed_on must be a real date in YYYY-MM-DD format.",
      400,
    );
  }
  const [year, month, day] = claimedDate.split("-").map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isFinite(parsedDate.getTime()) ||
    year < 1000 ||
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    previewFail(
      "INC_COMPLETION_DATE_INVALID",
      "claimed_completed_on is not a valid calendar date.",
      400,
    );
  }
  return {
    expectedGradeId,
    claimedDate,
    reason: incReason(body.completion_reason, "completion_reason", 500),
    evidence: incReason(body.evidence_summary, "evidence_summary", 4000),
    dryRun: body.dry_run,
  };
}

// POST /api/gradebook/:offeringId/students/:enrollmentSubjectId/inc-completion-claims
router.post(
  "/:offeringId/students/:enrollmentSubjectId/inc-completion-claims",
  async (req, res) => {
    const ids = validatePreviewIdentifiers(req, res);
    if (!ids) return;
    if (Object.keys(req.query).length) {
      return sendError(res, {
        status: 400,
        code: "INC_COMPLETION_QUERY_UNSUPPORTED",
        message: "This endpoint does not accept query parameters.",
      });
    }
    let input;
    try {
      input = completionClaimBody(req.body);
    } catch (error) {
      return sendError(res, error);
    }
    // Modern INC completion claim
    if (ids.offeringId === 130) {
      let connection;
      let transactionOpen = false;

      try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        transactionOpen = true;

        const result = await createModernIncClaim(connection, ids, input);

        if (input.dryRun) {
          await connection.rollback();
        } else {
          await connection.commit();
        }

        transactionOpen = false;

        return res.status(input.dryRun ? 200 : 201).json(result);
      } catch (error) {
        if (transactionOpen && connection) {
          try {
            await connection.rollback();
          } catch (rollbackError) {
            console.error("MODERN INC CLAIM ROLLBACK:", rollbackError);
          }
        }

        if (error?.code === "ER_DUP_ENTRY") {
          return sendError(res, {
            status: 409,
            code: "INC_COMPLETION_CLAIM_ALREADY_EXISTS",
            message: "A completion claim already exists. Reload readiness.",
          });
        }

        return sendError(res, error);
      } finally {
        connection?.release();
      }
    }

    // Legacy INC completion claim
    if (ids.offeringId !== TERM_SUBMISSION_TEST_OFFERING) {
      return sendError(res, {
        status: 403,
        code: "INC_COMPLETION_TEST_OFFERING_ONLY",
        message: "INC completion claims are limited to QA Offering #131.",
      });
    }

    let connection;
    let transactionOpen = false;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionOpen = true;
      await incCheckTestDatabase(connection);

      // Serialize claim creation through the offering, config, student and
      // official grade. This prevents two requests from filing concurrently.
      const [offerings] = await connection.execute(
        `SELECT so.offering_id, so.faculty_id, f.user_id AS assigned_user_id,
                u.is_active, u.is_archived, r.role_name
           FROM subject_offerings so
           LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
           LEFT JOIN users u ON u.user_id = f.user_id
           LEFT JOIN roles r ON r.role_id = u.role_id
          WHERE so.offering_id = ? FOR UPDATE`,
        [ids.offeringId],
      );
      if (offerings.length !== 1) {
        previewFail(
          "OFFERING_NOT_FOUND",
          "Subject offering was not found.",
          404,
        );
      }
      const offering = offerings[0];
      if (
        Number(offering.assigned_user_id) !== ids.actorUserId ||
        Number(offering.is_active) !== 1 ||
        Number(offering.is_archived) !== 0 ||
        !["Faculty", "Program Head"].includes(offering.role_name)
      ) {
        previewFail(
          "GRADEBOOK_INSTRUCTOR_REQUIRED",
          "Only the active assigned instructor may file an INC completion claim.",
          403,
        );
      }

      const [configs] = await connection.execute(
        "SELECT config_id FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE",
        [ids.offeringId],
      );
      if (configs.length !== 1) {
        previewFail(
          "GRADEBOOK_NOT_INITIALIZED",
          "The offering must have one initialized gradebook.",
        );
      }
      const configId = Number(configs[0].config_id);
      const [students] = await connection.execute(
        `SELECT es.enrollment_subject_id, es.offering_id,
                es.status AS subject_status, e.enrollment_status, e.student_id
           FROM enrollment_subjects es
           JOIN enrollments e ON e.enrollment_id = es.enrollment_id
          WHERE es.enrollment_subject_id = ? FOR UPDATE`,
        [ids.enrollmentSubjectId],
      );
      if (
        students.length !== 1 ||
        Number(students[0].offering_id) !== ids.offeringId
      ) {
        previewFail(
          "GRADEBOOK_STUDENT_NOT_FOUND",
          "Student is not assigned to this offering.",
          404,
        );
      }
      const student = students[0];
      if (
        student.enrollment_status !== "Approved" ||
        student.subject_status !== "Incomplete"
      ) {
        previewFail(
          "INC_COMPLETION_SUBJECT_NOT_ELIGIBLE",
          "An approved enrollment with an Incomplete subject is required.",
        );
      }

      const [grades] = await connection.execute(
        `SELECT grade_id, grade_status, grading_policy, grading_outcome,
                final_rating, faculty_id
           FROM grades WHERE enrollment_subject_id = ? FOR UPDATE`,
        [ids.enrollmentSubjectId],
      );
      if (grades.length !== 1) {
        previewFail(
          "INC_COMPLETION_OFFICIAL_GRADE_INVALID",
          "Exactly one official grade must exist for this enrollment subject.",
        );
      }
      const grade = grades[0];
      if (Number(grade.grade_id) !== input.expectedGradeId) {
        previewFail(
          "INC_COMPLETION_STALE_GRADE",
          "The official grade changed since readiness was checked. Reload readiness.",
        );
      }
      if (
        grade.grade_status !== "Approved" ||
        grade.grading_policy !== "TWO_TERM_50_50" ||
        grade.grading_outcome !== "INCOMPLETE" ||
        Number(grade.final_rating) !== 4 ||
        Number(grade.faculty_id) !== Number(offering.faculty_id)
      ) {
        previewFail(
          "INC_COMPLETION_NOT_APPROVED_INC",
          "Only the assigned instructor's Approved official INC 4.00 grade is eligible.",
        );
      }

      const [outcomes] = await connection.execute(
        `SELECT inc_request_id, request_status
           FROM gradebook_inc_outcome_requests
          WHERE config_id = ? AND enrollment_subject_id = ? FOR UPDATE`,
        [configId, ids.enrollmentSubjectId],
      );
      if (outcomes.length !== 1 || outcomes[0].request_status !== "APPROVED") {
        previewFail(
          "INC_COMPLETION_APPROVED_OUTCOME_REQUEST_REQUIRED",
          "An approved INC outcome request is required before claiming completion.",
        );
      }

      // The official-sheet date is a separate Registrar-verified fact.
      // Never derive it from the claim, current date, or grade publication.
      const [sheets] = await connection.execute(
        `SELECT sheet_id, original_official_submitted_on,
                official_date_verified_by_user_id, official_date_verified_at,
                CASE WHEN original_official_submitted_on IS NOT NULL
                       AND official_date_verified_by_user_id IS NOT NULL
                       AND official_date_verified_at IS NOT NULL
                     THEN DATE_FORMAT(
                       DATE_ADD(original_official_submitted_on, INTERVAL 1 YEAR), '%Y-%m-%d'
                     ) ELSE NULL END AS inc_deadline_on
           FROM gradebook_official_sheets
          WHERE config_id = ? FOR UPDATE`,
        [configId],
      );
      if (sheets.length > 1) {
        previewFail(
          "INC_COMPLETION_SHEET_DATA_INVALID",
          "Duplicate official grading sheets were found.",
        );
      }
      const deadline = sheets[0]?.inc_deadline_on ?? null;

      const [claims] = await connection.execute(
        `SELECT claim_id, verification_status
           FROM gradebook_inc_completion_claims
          WHERE grade_id = ? FOR UPDATE`,
        [input.expectedGradeId],
      );
      if (claims.length) {
        previewFail(
          "INC_COMPLETION_CLAIM_ALREADY_EXISTS",
          "A completion claim already exists for this grade. Reload readiness.",
        );
      }
      const [legacy] = await connection.execute(
        `SELECT grade_change_request_id
           FROM grade_change_requests
          WHERE grade_id = ? AND request_type = 'INC_COMPLETION'
            AND status IN ('Pending Program Head', 'For Registrar Processing') FOR UPDATE`,
        [input.expectedGradeId],
      );
      if (legacy.length) {
        previewFail(
          "INC_COMPLETION_LEGACY_REQUEST_PENDING",
          "A previous INC completion grade-change request needs reconciliation.",
        );
      }

      const [[clock]] = await connection.execute(
        "SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS database_today",
      );
      if (input.claimedDate > clock.database_today) {
        previewFail(
          "INC_COMPLETION_FUTURE_DATE",
          "The claimed completion date cannot be in the future.",
          400,
        );
      }

      const [insert] = await connection.execute(
        `INSERT INTO gradebook_inc_completion_claims
           (grade_id, grade_change_request_id, claimed_completed_on,
            evidence_summary, verification_status, submitted_by_user_id, record_version)
         VALUES (?, NULL, ?, ?, 'PENDING_VERIFICATION', ?, 1)`,
        [
          input.expectedGradeId,
          input.claimedDate,
          input.evidence,
          ids.actorUserId,
        ],
      );
      if (Number(insert.affectedRows) !== 1) {
        throw new Error("INC completion claim was not inserted.");
      }
      const claimId = String(insert.insertId);
      const [event] = await connection.execute(
        `INSERT INTO gradebook_inc_completion_claim_events
           (claim_id, event_type, previous_status, new_status,
            new_claimed_completed_on, new_evidence_summary,
            event_reason, performed_by_user_id, claim_version_after)
         VALUES (?, 'CREATED', NULL, 'PENDING_VERIFICATION', ?, ?, ?, ?, 1)`,
        [
          claimId,
          input.claimedDate,
          input.evidence,
          input.reason,
          ids.actorUserId,
        ],
      );
      if (Number(event.affectedRows) !== 1) {
        throw new Error("INC completion claim audit event was not inserted.");
      }

      if (input.dryRun) await connection.rollback();
      else await connection.commit();
      transactionOpen = false;

      return res.status(input.dryRun ? 200 : 201).json({
        success: true,
        dry_run: input.dryRun,
        persisted: !input.dryRun,
        offering_id: ids.offeringId,
        config_id: configId,
        enrollment_subject_id: ids.enrollmentSubjectId,
        student_id: Number(student.student_id),
        claim: {
          claim_id: input.dryRun ? null : claimId,
          grade_id: input.expectedGradeId,
          claimed_completed_on: input.claimedDate,
          completion_reason: input.reason,
          evidence_summary: input.evidence,
          verification_status: "PENDING_VERIFICATION",
          record_version: 1,
          submitted_by_user_id: ids.actorUserId,
        },
        audit_event: "CREATED",
        audit_event_id: input.dryRun ? null : String(event.insertId),
        official_sheet: {
          sheet_id: sheets[0] ? String(sheets[0].sheet_id) : null,
          deadline_established: deadline !== null,
          inc_completion_deadline_on: deadline,
        },
        timeliness_verified: false,
        official_grade_unchanged: true,
        grade_conversion_performed: false,
        note: input.dryRun
          ? "Claim and audit creation were rolled back. No grade or deadline changed."
          : "Claim saved pending verification. Grade remains Approved INC 4.00; no conversion or deadline change occurred.",
      });
    } catch (error) {
      if (transactionOpen && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("INC COMPLETION CLAIM ROLLBACK ERROR:", rollbackError);
        }
      }
      if (error?.code === "ER_DUP_ENTRY") {
        return sendError(res, {
          status: 409,
          code: "INC_COMPLETION_CONFLICT",
          message:
            "A conflicting INC completion claim was saved. Reload readiness.",
        });
      }
      return sendError(res, error);
    } finally {
      connection?.release();
    }
  },
);

// K3B4.3C — Separate Final Term submission for a verified INC completion.
// Add above `export default router;` in gradebookRoster.routes.js.
router.post(
  "/:offeringId/students/:enrollmentSubjectId/inc-completion-term-submissions",
  async (req, res) => {
    const ids = validatePreviewIdentifiers(req, res);
    if (!ids) return;

    let connection;
    let transactionStarted = false;
    try {
      const body = req.body;
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(req.query).length !== 0
      ) {
        previewFail(
          "INC_SUBMISSION_INVALID_REQUEST",
          "Send a JSON body without query parameters.",
          400,
        );
      }
      const allowed = new Set([
        "expected_grade_id",
        "expected_claim_id",
        "expected_claim_version",
        "expected_latest_submission_id",
        "expected_latest_submission_record_version",
        "change_reason",
        "dry_run",
      ]);
      if (Object.keys(body).some((key) => !allowed.has(key))) {
        previewFail(
          "INC_SUBMISSION_UNSUPPORTED_FIELD",
          "Unsupported INC submission field.",
          400,
        );
      }
      const gradeId = previewPositiveId(body.expected_grade_id);
      const claimId = String(body.expected_claim_id ?? "");
      const claimVersion = previewPositiveId(body.expected_claim_version);
      const expectedId = body.expected_latest_submission_id;
      const expectedVersion = body.expected_latest_submission_record_version;
      const firstAttempt = expectedId === null && expectedVersion === null;
      const priorAttempt =
        typeof expectedId === "string" &&
        /^[1-9]\d{0,19}$/.test(expectedId) &&
        BigInt(expectedId) <= 18446744073709551615n &&
        previewPositiveId(expectedVersion) !== null;
      const reason =
        typeof body.change_reason === "string" ? body.change_reason.trim() : "";
      if (
        !gradeId ||
        !/^[1-9]\d{0,19}$/.test(claimId) ||
        BigInt(claimId) > 18446744073709551615n ||
        !claimVersion ||
        (!firstAttempt && !priorAttempt) ||
        reason.length < 10 ||
        reason.length > 1000 ||
        /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(reason) ||
        typeof body.dry_run !== "boolean"
      ) {
        previewFail(
          "INC_SUBMISSION_BODY_INVALID",
          "Invalid expected IDs, versions, reason, or dry_run.",
          400,
        );
      }
      if (ids.offeringId !== TERM_SUBMISSION_TEST_OFFERING) {
        previewFail(
          "INC_SUBMISSION_QA_OFFERING_ONLY",
          "INC submissions are limited to QA Offering #131.",
          403,
        );
      }

      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;
      const [[database]] = await connection.execute(
        "SELECT DATABASE() AS database_name",
      );
      if (database?.database_name !== TERM_SUBMISSION_TEST_DB) {
        previewFail(
          "INC_SUBMISSION_QA_DB_ONLY",
          "Only the admission-test database is authorized.",
          403,
        );
      }

      // Lock the same shared parents as the score/attendance and term writers.
      const [offerings] = await connection.execute(
        `SELECT so.offering_id, so.academic_year_id, so.semester_id,
                cr.department_id
           FROM subject_offerings so
           LEFT JOIN sections sec ON sec.section_id = so.section_id
           LEFT JOIN courses cr ON cr.course_id = sec.course_id
          WHERE so.offering_id = ? FOR UPDATE`,
        [ids.offeringId],
      );
      if (offerings.length !== 1)
        previewFail("OFFERING_NOT_FOUND", "Offering not found.", 404);
      const [configs] = await connection.execute(
        "SELECT config_id FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE",
        [ids.offeringId],
      );
      if (configs.length !== 1)
        previewFail(
          "INC_SUBMISSION_CONFIG_INVALID",
          "Gradebook configuration missing.",
        );
      const configId = Number(configs[0].config_id);

      // Historical combined-semester grading cannot mix with the new term workflow.
      const [legacyLocks] = await connection.execute(
        "SELECT 1 FROM gradebook_structure_locks WHERE config_id = ? LIMIT 1",
        [configId],
      );
      const [legacySubmissions] = await connection.execute(
        `SELECT 1 FROM gradebook_grade_submission_attempts sa
           JOIN grades g ON g.grade_id = sa.grade_id
           JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
          WHERE es.offering_id = ? LIMIT 1`,
        [ids.offeringId],
      );
      if (legacyLocks.length || legacySubmissions.length) {
        previewFail(
          "INC_SUBMISSION_LEGACY_GRADING_CONFLICT",
          "Legacy grading history requires Registrar reconciliation.",
        );
      }
      const [enrollments] = await connection.execute(
        `SELECT es.enrollment_subject_id FROM enrollment_subjects es
           JOIN enrollments e ON e.enrollment_id = es.enrollment_id
          WHERE es.enrollment_subject_id = ? AND es.offering_id = ?
            AND es.status = 'Incomplete' AND e.enrollment_status = 'Approved'
          FOR UPDATE`,
        [ids.enrollmentSubjectId, ids.offeringId],
      );
      if (enrollments.length !== 1)
        previewFail(
          "INC_SUBMISSION_ENROLLMENT_CHANGED",
          "Original INC enrollment is not eligible.",
        );

      // Historical INC completion may be submitted after the normal window closes.
      // Its original FINAL_TERM period is retained for the submission FK.
      const offering = offerings[0];
      if (
        !previewPositiveId(offering.department_id) ||
        !previewPositiveId(offering.academic_year_id) ||
        !previewPositiveId(offering.semester_id)
      ) {
        previewFail(
          "INC_SUBMISSION_DEPARTMENT_SCOPE_MISSING",
          "Academic period or department is missing.",
        );
      }
      const [periods] = await connection.execute(
        `SELECT period_id FROM gradebook_term_submission_periods
          WHERE department_id = ? AND academic_year_id = ?
            AND semester_id = ? AND grading_term = 'FINAL_TERM' FOR UPDATE`,
        [
          offering.department_id,
          offering.academic_year_id,
          offering.semester_id,
        ],
      );
      if (periods.length !== 1)
        previewFail(
          "INC_SUBMISSION_PERIOD_MISSING",
          "Original Final Term submission period is required.",
        );

      const [grades] = await connection.execute(
        "SELECT grade_id FROM grades WHERE enrollment_subject_id = ? FOR UPDATE",
        [ids.enrollmentSubjectId],
      );
      if (grades.length !== 1 || Number(grades[0].grade_id) !== gradeId) {
        previewFail(
          "INC_SUBMISSION_GRADE_CHANGED",
          "Official grade identity changed.",
        );
      }
      const [sheets] = await connection.execute(
        "SELECT sheet_id FROM gradebook_official_sheets WHERE config_id = ? FOR UPDATE",
        [configId],
      );
      const [claims] = await connection.execute(
        "SELECT claim_id FROM gradebook_inc_completion_claims WHERE grade_id = ? FOR UPDATE",
        [gradeId],
      );
      if (
        sheets.length !== 1 ||
        claims.length !== 1 ||
        String(claims[0].claim_id) !== claimId
      ) {
        previewFail(
          "INC_SUBMISSION_EVIDENCE_CHANGED",
          "Verified claim or official sheet changed.",
        );
      }

      // Revalidate evidence, instructor ownership, original INC and audit chains.
      const state = await assertIncCompletionPreviewScope(connection, ids);
      if (
        state.configId !== configId ||
        state.gradeId !== gradeId ||
        String(state.claim.claim_id) !== claimId ||
        Number(state.claim.record_version) !== claimVersion ||
        String(state.sheet.sheet_id) !== String(sheets[0].sheet_id) ||
        state.claim.grade_change_request_id !== null
      ) {
        previewFail(
          "INC_SUBMISSION_VERSION_CONFLICT",
          "Claim or evidence changed. Reload the preview.",
        );
      }
      const [requests] = await connection.execute(
        `SELECT grade_change_request_id FROM grade_change_requests
          WHERE grade_id = ? AND request_type = 'INC_COMPLETION'
            AND status IN ('Pending Program Head', 'For Registrar Processing')
          LIMIT 1 FOR UPDATE`,
        [gradeId],
      );
      if (requests.length)
        previewFail(
          "INC_SUBMISSION_REVIEW_ALREADY_STARTED",
          "Grade-change review is already active.",
        );

      const [latestRows] = await connection.execute(
        `SELECT term_submission_id, attempt_number, record_version,
                submission_status, calculation_snapshot_json
           FROM gradebook_term_submission_attempts
          WHERE config_id = ? AND enrollment_subject_id = ?
            AND grading_term = 'FINAL_TERM'
          ORDER BY attempt_number DESC, term_submission_id DESC
          LIMIT 1 FOR UPDATE`,
        [configId, ids.enrollmentSubjectId],
      );
      const latest = latestRows[0] ?? null;
      if (
        (latest ? String(latest.term_submission_id) : null) !==
          (firstAttempt ? null : expectedId) ||
        (latest ? Number(latest.record_version) : null) !==
          (firstAttempt ? null : Number(expectedVersion))
      ) {
        previewFail(
          "INC_SUBMISSION_VERSION_CONFLICT",
          "Latest Final Term submission changed. Reload preview.",
        );
      }
      if (latest && latest.submission_status !== "RETURNED") {
        previewFail(
          "INC_SUBMISSION_ALREADY_SUBMITTED",
          "The latest Final Term is submitted or approved.",
        );
      }
      if (latest) {
        let previous;
        try {
          previous =
            typeof latest.calculation_snapshot_json === "string"
              ? JSON.parse(latest.calculation_snapshot_json)
              : latest.calculation_snapshot_json;
        } catch {
          previous = null;
        }
        if (
          previous?.submission_context !== "INC_COMPLETION_FINAL_TERM" ||
          String(previous.inc_completion_claim_id) !== claimId
        ) {
          previewFail(
            "INC_SUBMISSION_PRIOR_ATTEMPT_CONFLICT",
            "Previous Final Term history requires reconciliation.",
          );
        }
      }

      const [structure] = await connection.execute(
        `SELECT first_submission_id FROM gradebook_term_structure_locks
          WHERE config_id = ? AND grading_term = 'FINAL_TERM' FOR UPDATE`,
        [configId],
      );
      const [[count]] = await connection.execute(
        `SELECT COUNT(*) AS total FROM gradebook_term_submission_attempts
          WHERE config_id = ? AND grading_term = 'FINAL_TERM'`,
        [configId],
      );
      const priorCount = Number(count.total);
      if (
        (priorCount === 0 && structure.length !== 0) ||
        (priorCount > 0 && structure.length !== 1)
      ) {
        previewFail(
          "INC_SUBMISSION_STRUCTURE_CONFLICT",
          "Final Term structure lock does not match its submission history.",
        );
      }
      if (latest && Number(latest.attempt_number) >= 4294967295) {
        previewFail(
          "INC_SUBMISSION_ATTEMPT_OVERFLOW",
          "Final Term submission attempt limit reached.",
        );
      }
      const [[scheduled]] = await connection.execute(
        `SELECT COUNT(*) AS total FROM gradebook_attendance_meetings
          WHERE config_id = ? AND grading_term = 'FINAL_TERM' AND meeting_status = 'SCHEDULED'`,
        [configId],
      );
      if (Number(scheduled.total) !== 0) {
        previewFail(
          "INC_SUBMISSION_MEETINGS_UNFINISHED",
          "Scheduled Final Term meetings must be resolved first.",
        );
      }

      const calculated = await calculateGradePreview(
        connection,
        ids.offeringId,
        ids.enrollmentSubjectId,
        ids.actorUserId,
        { allowVerifiedIncCompletion: true },
      );
      const mid = calculated.terms.MIDTERM.term_percentage;
      const fin = calculated.terms.FINAL_TERM.term_percentage;
      if (
        calculated.semester.state !== "READY" ||
        !mid ||
        !fin ||
        calculated.config_id !== configId
      ) {
        previewFail(
          "INC_SUBMISSION_GRADE_INCOMPLETE",
          "Scores and attendance must be complete before submission.",
          422,
        );
      }
      const midN = String(state.midterm.term_percentage_exact_numerator);
      const midD = String(state.midterm.term_percentage_exact_denominator);
      const finN = String(fin.exact_numerator);
      const finD = String(fin.exact_denominator);
      if (
        !/^(0|[1-9]\d*)$/.test(midN) ||
        !/^[1-9]\d*$/.test(midD) ||
        !/^(0|[1-9]\d*)$/.test(finN) ||
        !/^[1-9]\d*$/.test(finD) ||
        finN.length > 255 ||
        finD.length > 255 ||
        BigInt(midN) * BigInt(mid.exact_denominator) !==
          BigInt(mid.exact_numerator) * BigInt(midD) ||
        BigInt(finN) > 100n * BigInt(finD)
      ) {
        previewFail(
          "INC_SUBMISSION_CALCULATION_MISMATCH",
          "Approved Midterm or completed Final Term calculation is inconsistent.",
        );
      }

      const attemptNumber = latest ? Number(latest.attempt_number) + 1 : 1;
      const snapshot = JSON.stringify({
        submission_context: "INC_COMPLETION_FINAL_TERM",
        inc_completion_claim_id: claimId,
        inc_completion_claim_version: claimVersion,
        original_inc_grade_id: gradeId,
        official_sheet_id: String(state.sheet.sheet_id),
        verified_completed_on: state.claim.verified_completed_on,
        policy: calculated.grading_policy,
        classification: calculated.grading_classification,
        term_weights: calculated.term_weights,
        offering_id: ids.offeringId,
        config_id: configId,
        enrollment_subject_id: ids.enrollmentSubjectId,
        student_id: calculated.student.student_id,
        grading_term: "FINAL_TERM",
        academic_year_id: Number(offering.academic_year_id),
        semester_id: Number(offering.semester_id),
        department_id: Number(offering.department_id),
        submission_reason: reason,
        calculated_term: calculated.terms.FINAL_TERM,
      });
      const [insert] = await connection.execute(
        `INSERT INTO gradebook_term_submission_attempts
          (config_id, enrollment_subject_id, grading_term, period_id,
           attempt_number, submission_batch_ref, term_percentage_exact_numerator,
           term_percentage_exact_denominator, calculation_snapshot_json,
           submission_status, submitted_by_user_id, record_version)
         VALUES (?, ?, 'FINAL_TERM', ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, 1)`,
        [
          configId,
          ids.enrollmentSubjectId,
          Number(periods[0].period_id),
          attemptNumber,
          randomUUID(),
          finN,
          finD,
          snapshot,
          ids.actorUserId,
        ],
      );
      if (Number(insert.affectedRows) !== 1)
        throw new Error("INC Final Term insert failed.");
      if (priorCount === 0) {
        const [lock] = await connection.execute(
          `INSERT INTO gradebook_term_structure_locks
            (config_id, grading_term, first_submission_id, locked_by_user_id, lock_reason)
           VALUES (?, 'FINAL_TERM', ?, ?, 'FIRST_TERM_SUBMISSION')`,
          [configId, String(insert.insertId), ids.actorUserId],
        );
        if (Number(lock.affectedRows) !== 1)
          throw new Error("Final Term structure lock insert failed.");
      }

      if (body.dry_run) await connection.rollback();
      else await connection.commit();
      transactionStarted = false;
      return res.status(body.dry_run ? 200 : 201).json({
        success: true,
        dry_run: body.dry_run,
        persisted: !body.dry_run,
        submission_context: "INC_COMPLETION_FINAL_TERM",
        term_submission_id: body.dry_run ? null : String(insert.insertId),
        attempt_number: attemptNumber,
        submission_status: "SUBMITTED",
        claim_id: claimId,
        original_inc_grade_id: gradeId,
        final_term_percentage: fin,
        official_grade_unchanged: true,
        official_grade_publication_enabled: false,
        next_step: "Program Head INC-specific Final Term approval (K3B4.3D).",
      });
    } catch (error) {
      if (transactionStarted && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("INC TERM SUBMISSION ROLLBACK ERROR:", rollbackError);
        }
      }
      if (error?.code === "ER_DUP_ENTRY") {
        return sendError(res, {
          status: 409,
          code: "INC_SUBMISSION_CONFLICT",
          message: "Another submission was saved. Reload preview.",
        });
      }
      return sendError(res, error);
    } finally {
      connection?.release();
    }
  },
);

// K3B4.3E — Faculty request for an approved INC replacement grade.
// Add ABOVE `export default router;` in server/routes/gradebookRoster.routes.js.
// Uses existing preview/fraction helpers. No client-supplied grades and no publication.
router.post(
  "/:offeringId/students/:enrollmentSubjectId/inc-completion-grade-change-request",
  async (req, res) => {
    const ids = validatePreviewIdentifiers(req, res);
    if (!ids) return;
    let connection;
    let transactionOpen = false;
    try {
      const body = req.body;
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(req.query ?? {}).length
      ) {
        previewFail(
          "INC_REPLACEMENT_INVALID_REQUEST",
          "Provide a JSON body without query parameters.",
          400,
        );
      }
      const allowed = new Set([
        "expected_grade_id",
        "expected_claim_id",
        "expected_claim_version",
        "expected_final_submission_id",
        "expected_final_submission_version",
        "completion_remarks",
        "dry_run",
      ]);
      if (Object.keys(body).some((key) => !allowed.has(key))) {
        previewFail(
          "INC_REPLACEMENT_FIELDS_UNSUPPORTED",
          "Grade values must come from approved gradebook records, not the request body.",
          400,
        );
      }
      const gradeId = previewPositiveId(body.expected_grade_id);
      const claimId = String(body.expected_claim_id ?? "");
      const claimVersion = previewPositiveId(body.expected_claim_version);
      const finalId = String(body.expected_final_submission_id ?? "");
      const finalVersion = previewPositiveId(
        body.expected_final_submission_version,
      );
      const remarks =
        typeof body.completion_remarks === "string"
          ? body.completion_remarks.trim()
          : "";
      if (
        !gradeId ||
        !/^[1-9]\d{0,19}$/.test(claimId) ||
        BigInt(claimId) > 18446744073709551615n ||
        !/^[1-9]\d{0,19}$/.test(finalId) ||
        BigInt(finalId) > 18446744073709551615n ||
        !claimVersion ||
        !finalVersion ||
        remarks.length < 15 ||
        remarks.length > 2000 ||
        /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(remarks) ||
        typeof body.dry_run !== "boolean"
      ) {
        previewFail(
          "INC_REPLACEMENT_INPUT_INVALID",
          "Provide valid expected IDs/versions, 15–2000 character remarks and boolean dry_run.",
          400,
        );
      }
      if (ids.offeringId !== TERM_SUBMISSION_TEST_OFFERING) {
        previewFail(
          "INC_REPLACEMENT_QA_OFFERING_ONLY",
          "This request is limited to QA Offering #131.",
          403,
        );
      }

      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionOpen = true;
      const [[database]] = await connection.execute(
        "SELECT DATABASE() AS database_name",
      );
      if (database?.database_name !== TERM_SUBMISSION_TEST_DB) {
        previewFail(
          "INC_REPLACEMENT_QA_DATABASE_ONLY",
          "This request is limited to the admission-test database.",
          403,
        );
      }

      // Match the score/submission writers' parent lock order.
      const [offerings] = await connection.execute(
        "SELECT offering_id FROM subject_offerings WHERE offering_id = ? FOR UPDATE",
        [ids.offeringId],
      );
      if (offerings.length !== 1)
        previewFail(
          "INC_REPLACEMENT_OFFERING_MISSING",
          "Offering not found.",
          404,
        );
      const [configs] = await connection.execute(
        "SELECT config_id FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE",
        [ids.offeringId],
      );
      if (configs.length !== 1)
        previewFail(
          "INC_REPLACEMENT_CONFIG_MISSING",
          "Gradebook configuration changed.",
        );
      const configId = Number(configs[0].config_id);
      const [subjects] = await connection.execute(
        `SELECT es.enrollment_subject_id FROM enrollment_subjects es
           JOIN enrollments e ON e.enrollment_id = es.enrollment_id
          WHERE es.enrollment_subject_id = ? AND es.offering_id = ?
            AND es.status = 'Incomplete' AND e.enrollment_status = 'Approved' FOR UPDATE`,
        [ids.enrollmentSubjectId, ids.offeringId],
      );
      if (subjects.length !== 1)
        previewFail(
          "INC_REPLACEMENT_SUBJECT_CHANGED",
          "Incomplete enrollment is no longer eligible.",
        );
      const [grades] = await connection.execute(
        `SELECT grade_id, enrollment_subject_id, faculty_id, grade_status,
                grading_policy, grading_outcome, midterm_grade, final_grade,
                overall_percentage, final_rating, remarks, outcome_reason
           FROM grades WHERE enrollment_subject_id = ? FOR UPDATE`,
        [ids.enrollmentSubjectId],
      );
      const original = grades[0];
      if (
        grades.length !== 1 ||
        Number(original.grade_id) !== gradeId ||
        original.grade_status !== "Approved" ||
        original.grading_policy !== "TWO_TERM_50_50" ||
        original.grading_outcome !== "INCOMPLETE" ||
        Number(original.final_rating) !== 4 ||
        original.remarks !== "Incomplete"
      ) {
        previewFail(
          "INC_REPLACEMENT_OFFICIAL_GRADE_CHANGED",
          "The original approved INC 4.00 grade changed.",
        );
      }
      const [sheets] = await connection.execute(
        "SELECT sheet_id FROM gradebook_official_sheets WHERE config_id = ? FOR UPDATE",
        [configId],
      );
      const [claims] = await connection.execute(
        "SELECT claim_id FROM gradebook_inc_completion_claims WHERE grade_id = ? FOR UPDATE",
        [gradeId],
      );
      if (
        sheets.length !== 1 ||
        claims.length !== 1 ||
        String(claims[0].claim_id) !== claimId
      ) {
        previewFail(
          "INC_REPLACEMENT_EVIDENCE_CHANGED",
          "Completion claim or official sheet changed.",
        );
      }
      // Existing shared helper validates instructor ownership, verified sheet/date,
      // timely claim, approved Midterm, and complete claim/sheet event chains.
      const state = await assertIncCompletionPreviewScope(connection, ids);
      if (
        state.configId !== configId ||
        state.gradeId !== gradeId ||
        String(state.claim.claim_id) !== claimId ||
        Number(state.claim.record_version) !== claimVersion ||
        String(state.sheet.sheet_id) !== String(sheets[0].sheet_id) ||
        state.claim.grade_change_request_id !== null
      ) {
        previewFail(
          "INC_REPLACEMENT_CLAIM_VERSION_CONFLICT",
          "Verified claim changed. Reload readiness.",
        );
      }
      const [existing] = await connection.execute(
        `SELECT grade_change_request_id FROM grade_change_requests
          WHERE grade_id = ? AND request_type = 'INC_COMPLETION'
            AND status IN ('Pending Program Head', 'For Registrar Processing') FOR UPDATE`,
        [gradeId],
      );
      if (existing.length)
        previewFail(
          "INC_REPLACEMENT_ACTIVE_REQUEST_EXISTS",
          "A pending INC conversion request already exists.",
        );

      const [midRows] = await connection.execute(
        `SELECT term_submission_id, config_id, enrollment_subject_id, grading_term,
                submission_status, submitted_by_user_id, reviewed_by_user_id,
                submitted_at, reviewed_at, term_percentage_exact_numerator,
                term_percentage_exact_denominator, calculation_snapshot_json
           FROM gradebook_term_submission_attempts
          WHERE config_id = ? AND enrollment_subject_id = ? AND grading_term = 'MIDTERM'
          ORDER BY attempt_number DESC, term_submission_id DESC LIMIT 1 FOR UPDATE`,
        [configId, ids.enrollmentSubjectId],
      );
      const [finalRows] = await connection.execute(
        `SELECT term_submission_id, config_id, enrollment_subject_id, grading_term,
                submission_status, record_version, submitted_by_user_id,
                reviewed_by_user_id, submitted_at, reviewed_at,
                term_percentage_exact_numerator, term_percentage_exact_denominator,
                calculation_snapshot_json
           FROM gradebook_term_submission_attempts
          WHERE config_id = ? AND enrollment_subject_id = ? AND grading_term = 'FINAL_TERM'
          ORDER BY attempt_number DESC, term_submission_id DESC LIMIT 1 FOR UPDATE`,
        [configId, ids.enrollmentSubjectId],
      );
      const mid = midRows[0];
      const fin = finalRows[0];
      if (
        !mid ||
        !fin ||
        [mid, fin].some(
          (term) =>
            term.submission_status !== "APPROVED" ||
            !term.reviewed_by_user_id ||
            !term.reviewed_at ||
            Number(term.submitted_by_user_id) !== ids.actorUserId,
        ) ||
        String(mid.term_submission_id) !==
          String(state.midterm.term_submission_id) ||
        String(fin.term_submission_id) !== finalId ||
        Number(fin.record_version) !== finalVersion ||
        Number(fin.reviewed_by_user_id) !==
          Number(state.claim.verified_by_user_id) ||
        !(new Date(fin.submitted_at) >= new Date(state.claim.verified_at)) ||
        !(new Date(fin.reviewed_at) >= new Date(fin.submitted_at))
      ) {
        previewFail(
          "INC_REPLACEMENT_APPROVED_TERMS_REQUIRED",
          "The original Midterm and verified-completion Final Term must be approved and unchanged.",
        );
      }
      function approvedFraction(term, expectedTerm) {
        const numerator = String(term.term_percentage_exact_numerator ?? "");
        const denominator = String(
          term.term_percentage_exact_denominator ?? "",
        );
        if (
          !/^(0|[1-9]\d*)$/.test(numerator) ||
          !/^[1-9]\d*$/.test(denominator) ||
          numerator.length > 255 ||
          denominator.length > 255 ||
          BigInt(numerator) > 100n * BigInt(denominator)
        ) {
          previewFail(
            "INC_REPLACEMENT_TERM_RATIO_INVALID",
            "An approved term percentage is invalid.",
          );
        }
        let snapshot;
        try {
          const raw = term.calculation_snapshot_json;
          snapshot =
            typeof raw === "string"
              ? JSON.parse(raw)
              : Buffer.isBuffer(raw)
                ? JSON.parse(raw.toString("utf8"))
                : raw;
        } catch {
          snapshot = null;
        }
        if (
          !snapshot ||
          snapshot.grading_term !== expectedTerm ||
          snapshot.policy !== "TWO_TERM_50_50" ||
          Number(snapshot.config_id) !== configId ||
          Number(snapshot.enrollment_subject_id) !== ids.enrollmentSubjectId ||
          Number(snapshot.term_weights?.MIDTERM) !== 50 ||
          Number(snapshot.term_weights?.FINAL_TERM) !== 50 ||
          snapshot.calculated_term?.state !== "READY" ||
          String(snapshot.calculated_term?.term_percentage?.exact_numerator) !==
            numerator ||
          String(
            snapshot.calculated_term?.term_percentage?.exact_denominator,
          ) !== denominator
        ) {
          previewFail(
            "INC_REPLACEMENT_SNAPSHOT_INVALID",
            "Approved grading snapshot does not match the official term record.",
          );
        }
        return {
          value: fraction(BigInt(numerator), BigInt(denominator)),
          snapshot,
        };
      }
      const m = approvedFraction(mid, "MIDTERM");
      const f = approvedFraction(fin, "FINAL_TERM");
      if (
        f.snapshot.submission_context !== "INC_COMPLETION_FINAL_TERM" ||
        String(f.snapshot.inc_completion_claim_id) !== claimId ||
        Number(f.snapshot.inc_completion_claim_version) !== claimVersion ||
        Number(f.snapshot.original_inc_grade_id) !== gradeId ||
        String(f.snapshot.official_sheet_id) !== String(state.sheet.sheet_id) ||
        f.snapshot.verified_completed_on !== state.claim.verified_completed_on
      ) {
        previewFail(
          "INC_REPLACEMENT_FINAL_SOURCE_INVALID",
          "Final Term snapshot is not linked to the verified INC completion.",
        );
      }
      const overall = fractionTimes(fractionAdd(m.value, f.value), 1n, 2n);
      const proposed = {
        midterm: fixedFromFraction(m.value, 2),
        final: fixedFromFraction(f.value, 2),
        overall: fixedFromFraction(overall, 2),
        rating: equivalentFor(overall),
        remarks: fractionAtLeast(overall, 75) ? "Passed" : "Failed",
      };
      const [insert] = await connection.execute(
        `INSERT INTO grade_change_requests
           (grade_id, request_type, old_midterm_grade, old_final_grade,
            old_overall_percentage, old_final_rating, old_remarks,
            old_grading_outcome, old_outcome_reason,
            new_midterm_grade, new_final_grade, new_overall_percentage,
            new_final_rating, new_remarks, new_grading_outcome,
            completion_remarks, requested_by, requested_by_role, status)
         VALUES (?, 'INC_COMPLETION', ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, 'NUMERIC', ?, ?, 'Faculty', 'Pending Program Head')`,
        [
          gradeId,
          original.midterm_grade,
          original.final_grade,
          original.overall_percentage,
          original.final_rating,
          original.remarks,
          original.grading_outcome,
          original.outcome_reason,
          proposed.midterm,
          proposed.final,
          proposed.overall,
          proposed.rating,
          proposed.remarks,
          remarks,
          ids.actorUserId,
        ],
      );
      if (Number(insert.affectedRows) !== 1)
        throw new Error("INC replacement request was not inserted.");
      const requestId = Number(insert.insertId);
      const [audit] = await connection.execute(
        `INSERT INTO audit_trail (user_id, table_name, record_id, action, old_values, new_values)
         VALUES (?, 'grade_change_requests', ?, 'INSERT', ?, ?)`,
        [
          ids.actorUserId,
          requestId,
          JSON.stringify({
            grade_id: gradeId,
            original_status: original.grade_status,
            original_outcome: original.grading_outcome,
            original_rating: String(original.final_rating),
          }),
          JSON.stringify({
            grade_change_request_id: requestId,
            request_type: "INC_COMPLETION",
            claim_id: claimId,
            claim_version: claimVersion,
            official_sheet_id: String(state.sheet.sheet_id),
            midterm_submission_id: String(mid.term_submission_id),
            final_submission_id: finalId,
            final_submission_version: finalVersion,
            overall_exact_numerator: overall.n.toString(),
            overall_exact_denominator: overall.d.toString(),
            proposed_grade: proposed,
            status: "Pending Program Head",
          }),
        ],
      );
      if (Number(audit.affectedRows) !== 1)
        throw new Error("INC replacement request audit was not inserted.");
      if (body.dry_run) await connection.rollback();
      else await connection.commit();
      transactionOpen = false;
      return res.status(body.dry_run ? 200 : 201).json({
        success: true,
        dry_run: body.dry_run,
        persisted: !body.dry_run,
        grade_change_request_id: body.dry_run ? null : requestId,
        request_type: "INC_COMPLETION",
        request_status: "Pending Program Head",
        claim_id: claimId,
        original_inc_grade_id: gradeId,
        approved_midterm_submission_id: String(mid.term_submission_id),
        approved_final_submission_id: finalId,
        proposed_grade: proposed,
        original_official_grade_unchanged: true,
        official_grade_published: false,
        next_step:
          "Program Head reviews the replacement-grade request; then Registrar performs authorized conversion.",
      });
    } catch (error) {
      if (transactionOpen && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error(
            "INC REPLACEMENT REQUEST ROLLBACK ERROR:",
            rollbackError,
          );
        }
      }
      if (error?.code === "ER_DUP_ENTRY") {
        return sendError(res, {
          status: 409,
          code: "INC_REPLACEMENT_CONFLICT",
          message: "A conflicting request was saved. Reload the INC preview.",
        });
      }
      return sendError(res, error);
    } finally {
      connection?.release();
    }
  },
);

// K3B6.1 — Faculty UD evidence request (QA pilot, Offering #131).
// Add immediately ABOVE `export default router;` in server/routes/gradebookRoster.routes.js.
// Existing imports/helpers are reused. This route never creates a grade or assigns 6.00.
router.post(
  "/:offeringId/students/:enrollmentSubjectId/ud-outcome-requests",
  async (req, res) => {
    const ids = validatePreviewIdentifiers(req, res);
    if (!ids) return;
    let connection;
    let transactionOpen = false;
    try {
      if (Object.keys(req.query ?? {}).length !== 0) {
        previewFail(
          "UD_QUERY_UNSUPPORTED",
          "Query parameters are not accepted.",
          400,
        );
      }
      if (
        !req.body ||
        typeof req.body !== "object" ||
        Array.isArray(req.body)
      ) {
        previewFail("UD_BODY_INVALID", "A JSON object is required.", 400);
      }
      const allowed = new Set([
        "outcome_reason",
        "evidence_summary",
        "confirm_ud_evidence",
        "expected_request_version",
        "dry_run",
      ]);
      if (Object.keys(req.body).some((key) => !allowed.has(key))) {
        previewFail(
          "UD_FIELDS_UNSUPPORTED",
          "Unsupported UD request fields.",
          400,
        );
      }
      const reason =
        typeof req.body.outcome_reason === "string"
          ? req.body.outcome_reason.trim()
          : "";
      const evidence =
        typeof req.body.evidence_summary === "string"
          ? req.body.evidence_summary.trim()
          : "";
      if (
        reason.length < 10 ||
        reason.length > 500 ||
        evidence.length < 20 ||
        evidence.length > 4000 ||
        /[\x00-\x08\x0B\x0E-\x1F\x7F]/.test(reason + evidence) ||
        req.body.confirm_ud_evidence !== true ||
        typeof req.body.dry_run !== "boolean"
      ) {
        previewFail(
          "UD_EVIDENCE_REQUIRED",
          "Provide a documented reason (10–500 characters), evidence (20–4000), explicit confirmation, and boolean dry_run.",
          400,
        );
      }
      const expectedVersion =
        req.body.expected_request_version == null
          ? null
          : previewPositiveId(req.body.expected_request_version);
      if (req.body.expected_request_version != null && !expectedVersion) {
        previewFail(
          "UD_VERSION_INVALID",
          "expected_request_version is invalid.",
          400,
        );
      }

      connection = await db.getConnection();
      // Combined grading writes remain QA-only.
      await assertQaGradingDatabase(connection);
      await connection.beginTransaction();
      transactionOpen = true;

      const [owners] = await connection.execute(
        `SELECT so.offering_id, so.status, f.user_id AS instructor_user_id,
                u.is_active, u.is_archived, r.role_name
           FROM subject_offerings so
           JOIN faculty f ON f.faculty_id = so.faculty_id
           JOIN users u ON u.user_id = f.user_id
           JOIN roles r ON r.role_id = u.role_id
          WHERE so.offering_id = ? FOR UPDATE`,
        [ids.offeringId],
      );
      if (owners.length !== 1)
        previewFail("UD_OFFERING_NOT_FOUND", "Offering not found.", 404);
      if (
        Number(owners[0].instructor_user_id) !== ids.actorUserId ||
        Number(owners[0].is_active) !== 1 ||
        Number(owners[0].is_archived) !== 0 ||
        !["Faculty", "Program Head"].includes(owners[0].role_name)
      ) {
        previewFail(
          "UD_INSTRUCTOR_REQUIRED",
          "Only the active assigned instructor may submit UD evidence.",
          403,
        );
      }
      if (owners[0].status === "Cancelled") {
        previewFail(
          "UD_OFFERING_CANCELLED",
          "Cancelled offerings cannot accept UD requests.",
        );
      }
      const [configs] = await connection.execute(
        `SELECT config_id FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE`,
        [ids.offeringId],
      );
      if (configs.length !== 1)
        previewFail("UD_GRADEBOOK_REQUIRED", "Gradebook is not initialized.");
      const configId = Number(configs[0].config_id);

      const [students] = await connection.execute(
        `SELECT es.enrollment_subject_id, es.offering_id, es.status AS subject_status,
                e.enrollment_status
           FROM enrollment_subjects es
           JOIN enrollments e ON e.enrollment_id = es.enrollment_id
          WHERE es.enrollment_subject_id = ? FOR UPDATE`,
        [ids.enrollmentSubjectId],
      );
      if (
        students.length !== 1 ||
        Number(students[0].offering_id) !== ids.offeringId
      ) {
        previewFail(
          "UD_STUDENT_NOT_FOUND",
          "Student is not placed in this offering.",
          404,
        );
      }
      if (
        students[0].subject_status !== "Enrolled" ||
        students[0].enrollment_status !== "Approved"
      ) {
        previewFail(
          "UD_ENROLLMENT_INELIGIBLE",
          "Only currently Enrolled students in Approved enrollments can be reviewed.",
        );
      }
      const [grades] = await connection.execute(
        `SELECT grade_id FROM grades WHERE enrollment_subject_id = ? FOR UPDATE`,
        [ids.enrollmentSubjectId],
      );
      if (grades.length) {
        previewFail(
          "UD_EXISTING_GRADE",
          "An existing grade requires an authorized grade-change workflow.",
        );
      }
      const [incRequests] = await connection.execute(
        `SELECT inc_request_id FROM gradebook_inc_outcome_requests
          WHERE config_id = ? AND enrollment_subject_id = ?
            AND request_status IN ('SUBMITTED','RETURNED','APPROVED') FOR UPDATE`,
        [configId, ids.enrollmentSubjectId],
      );
      if (incRequests.length)
        previewFail(
          "UD_INC_CONFLICT",
          "An INC outcome request must be resolved first.",
        );
      const [finalAttempts] = await connection.execute(
        `SELECT term_submission_id FROM gradebook_term_submission_attempts
          WHERE config_id = ? AND enrollment_subject_id = ?
            AND grading_term = 'FINAL_TERM' LIMIT 1 FOR UPDATE`,
        [configId, ids.enrollmentSubjectId],
      );
      if (finalAttempts.length) {
        previewFail(
          "UD_FINAL_TERM_CONFLICT",
          "Existing Final Term submissions require review before a UD request.",
        );
      }
      const [requests] = await connection.execute(
        `SELECT ud_request_id, request_status, record_version
           FROM gradebook_ud_outcome_requests
          WHERE config_id = ? AND enrollment_subject_id = ? FOR UPDATE`,
        [configId, ids.enrollmentSubjectId],
      );
      if (requests.length > 1)
        previewFail(
          "UD_DUPLICATE_REQUESTS",
          "Conflicting UD requests require reconciliation.",
        );
      const previous = requests[0] ?? null;
      if (previous && previous.request_status !== "RETURNED") {
        previewFail(
          "UD_REQUEST_ALREADY_FILED",
          "A UD request already exists and is not returned for correction.",
        );
      }
      if (
        (previous && Number(previous.record_version) !== expectedVersion) ||
        (!previous && expectedVersion !== null)
      ) {
        previewFail(
          "UD_VERSION_CONFLICT",
          "The UD request version changed. Reload before resubmitting.",
        );
      }
      if (previous && Number(previous.record_version) >= 4294967295) {
        previewFail(
          "UD_VERSION_LIMIT",
          "The UD request record version has reached its limit.",
        );
      }

      // Cancelled sessions and excused/N/A attendance never count as absences.
      const [attendance] = await connection.execute(
        `SELECT m.meeting_id, m.grading_term,
                DATE_FORMAT(m.meeting_date, '%Y-%m-%d') AS meeting_date,
                COALESCE(a.attendance_status, 'PENDING') AS attendance_status,
                a.record_version, a.recorded_by_user_id, a.recorded_at
           FROM gradebook_attendance_meetings m
           LEFT JOIN gradebook_attendance_entries a
             ON a.meeting_id = m.meeting_id AND a.enrollment_subject_id = ?
          WHERE m.config_id = ? AND m.meeting_status = 'HELD'
            AND m.meeting_date <= CURDATE()
          ORDER BY m.meeting_date, m.meeting_id FOR UPDATE`,
        [ids.enrollmentSubjectId, configId],
      );
      const absenceRows = attendance.filter(
        (row) =>
          row.attendance_status === "ABSENT" &&
          row.recorded_at !== null &&
          row.recorded_by_user_id !== null &&
          previewPositiveId(row.record_version),
      );
      if (!absenceRows.length) {
        previewFail(
          "UD_RECORDED_ABSENCE_REQUIRED",
          "UD reporting requires at least one saved absence from a held meeting plus documented supporting evidence. Attendance count alone never establishes UD.",
        );
      }
      const snapshot = {
        config_id: configId,
        offering_id: ids.offeringId,
        enrollment_subject_id: ids.enrollmentSubjectId,
        held_meetings: attendance.length,
        absent_meetings: absenceRows.length,
        present_meetings: attendance.filter(
          (x) => x.attendance_status === "PRESENT",
        ).length,
        late_meetings: attendance.filter((x) => x.attendance_status === "LATE")
          .length,
        excluded_excused: attendance.filter(
          (x) => x.attendance_status === "EXCUSED",
        ).length,
        excluded_not_applicable: attendance.filter(
          (x) => x.attendance_status === "NOT_APPLICABLE",
        ).length,
        pending_meetings: attendance.filter(
          (x) => x.attendance_status === "PENDING",
        ).length,
        absences: absenceRows.map((x) => ({
          meeting_id: Number(x.meeting_id),
          date: x.meeting_date,
          term: x.grading_term,
          attendance_version: Number(x.record_version),
        })),
      };
      const snapshotJson = JSON.stringify(snapshot);
      let requestId;
      let newVersion;
      if (!previous) {
        const [inserted] = await connection.execute(
          `INSERT INTO gradebook_ud_outcome_requests
             (config_id, enrollment_subject_id, outcome_reason, evidence_summary,
              attendance_snapshot_json, submitted_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            configId,
            ids.enrollmentSubjectId,
            reason,
            evidence,
            snapshotJson,
            ids.actorUserId,
          ],
        );
        if (Number(inserted.affectedRows) !== 1)
          throw new Error("UD request did not save.");
        requestId = String(inserted.insertId);
        newVersion = 1;
      } else {
        const [updated] = await connection.execute(
          `UPDATE gradebook_ud_outcome_requests
              SET request_status = 'SUBMITTED', outcome_reason = ?, evidence_summary = ?,
                  attendance_snapshot_json = ?, submitted_by_user_id = ?, submitted_at = NOW(6),
                  reviewed_by_user_id = NULL, reviewed_at = NULL, review_remarks = NULL,
                  record_version = record_version + 1
            WHERE ud_request_id = ? AND request_status = 'RETURNED' AND record_version = ?`,
          [
            reason,
            evidence,
            snapshotJson,
            ids.actorUserId,
            String(previous.ud_request_id),
            expectedVersion,
          ],
        );
        if (Number(updated.affectedRows) !== 1) {
          previewFail(
            "UD_VERSION_CONFLICT",
            "UD request changed during resubmission.",
          );
        }
        requestId = String(previous.ud_request_id);
        newVersion = expectedVersion + 1;
      }
      const [audit] = await connection.execute(
        `INSERT INTO gradebook_ud_outcome_request_events
           (ud_request_id, event_type, previous_status, new_status,
            reason_snapshot, evidence_snapshot, attendance_snapshot_json,
            performed_by_user_id, request_version_after)
         VALUES (?, ?, ?, 'SUBMITTED', ?, ?, ?, ?, ?)`,
        [
          requestId,
          previous ? "RESUBMITTED" : "SUBMITTED",
          previous ? "RETURNED" : null,
          reason,
          evidence,
          snapshotJson,
          ids.actorUserId,
          newVersion,
        ],
      );
      if (Number(audit.affectedRows) !== 1)
        throw new Error("UD request audit event did not save.");
      if (req.body.dry_run) await connection.rollback();
      else await connection.commit();
      transactionOpen = false;
      return res.status(req.body.dry_run ? 200 : previous ? 200 : 201).json({
        success: true,
        dry_run: req.body.dry_run,
        persisted: !req.body.dry_run,
        ud_request_id: req.body.dry_run ? null : requestId,
        request_status: "SUBMITTED",
        record_version: newVersion,
        attendance_evidence: snapshot,
        official_grade_created: false,
        ud_6_00_published: false,
        next_step:
          "Program Head must review the Faculty evidence. Five absences alone never approve UD.",
      });
    } catch (error) {
      if (transactionOpen && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("UD REQUEST ROLLBACK:", rollbackError);
        }
      }
      return sendError(res, error);
    } finally {
      connection?.release();
    }
  },
);

// K3B7 - Faculty correction routes, deduplicated and self-contained.
// Source: uploaded Pasted text(20261112-115926).txt.
// Path: server/routes/gradebookRoster.routes.js
// ADD ONLY to the existing complete gradebook file, before export default router.
// Do not replace the complete gradebook with this snippet.
// If gbCorrectionId or these correction routes are already installed, remove
// the old incomplete/duplicate copy first. Keep unrelated gradebook routes.

function gbCorrectionRespondError(res, error) {
  if (error?.code === "ER_DUP_ENTRY") {
    return res.status(409).json({
      success: false,
      code: "CORRECTION_DUPLICATE_REQUEST",
      message: "An overlapping correction request already exists.",
    });
  }
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
      ? error.status
      : 500;
  if (status === 500) console.error("GRADEBOOK CORRECTION ERROR:", error);
  return res.status(status).json({
    success: false,
    code:
      status === 500
        ? "CORRECTION_INTERNAL_ERROR"
        : error.code || "CORRECTION_REQUEST_FAILED",
    message:
      status === 500
        ? "Could not process the correction request."
        : error.message,
  });
}

function gbCorrectionId(value) {
  if (!/^[1-9]\d*$/.test(String(value ?? ""))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function gbCorrectionFail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function gbCorrectionCents(value, field) {
  const text = String(value ?? "").trim();
  if (!/^(0|[1-9]\d{0,7})(?:\.(\d{1,2}))?$/.test(text)) {
    gbCorrectionFail(
      "CORRECTION_SCORE_INVALID",
      `${field} must be a valid nonnegative 2-decimal score.`,
      400,
    );
  }
  const [whole, dec = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt(dec.padEnd(2, "0"));
}

function gbCorrectionScoreText(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

function gbCorrectionSourceSnapshot(raw, term, ids, original, maximum) {
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    parsed = null;
  }
  if (
    !parsed ||
    parsed.policy !== "TWO_TERM_50_50" ||
    parsed.grading_term !== term ||
    Number(parsed.config_id) !== ids.configId ||
    Number(parsed.enrollment_subject_id) !== ids.enrollmentSubjectId ||
    parsed.calculated_term?.state !== "READY"
  ) {
    gbCorrectionFail(
      "CORRECTION_APPROVED_SOURCE_INVALID",
      "Approved term snapshot does not match this student and offering.",
    );
  }
  const matches = (parsed.calculated_term.categories ?? [])
    .flatMap((category) => category.assessments ?? [])
    .filter((row) => Number(row.assessment_id) === ids.assessmentId);
  if (
    matches.length !== 1 ||
    matches[0].score_status !== "SCORED" ||
    gbCorrectionCents(matches[0].earned_score, "published earned score") !==
      original ||
    gbCorrectionCents(matches[0].maximum_score, "published maximum score") !==
      maximum
  ) {
    gbCorrectionFail(
      "CORRECTION_SOURCE_SCORE_MISMATCH",
      "The score no longer matches its approved term snapshot. Registrar reconciliation is required.",
    );
  }
}

router.post(
  "/:offeringId/students/:enrollmentSubjectId/score-correction-requests",
  async (req, res) => {
    let connection;
    let inTransaction = false;
    try {
      const offeringId = gbCorrectionId(req.params.offeringId);
      const enrollmentSubjectId = gbCorrectionId(
        req.params.enrollmentSubjectId,
      );
      const actor = gbCorrectionId(req.user?.user_id);
      if (!offeringId || !enrollmentSubjectId || !actor) {
        gbCorrectionFail(
          "CORRECTION_IDS_INVALID",
          "Valid offering, student and authenticated user are required.",
          400,
        );
      }
      if (Object.keys(req.query ?? {}).length) {
        gbCorrectionFail(
          "CORRECTION_QUERY_UNSUPPORTED",
          "Query parameters are not accepted.",
          400,
        );
      }
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        gbCorrectionFail(
          "CORRECTION_BODY_INVALID",
          "A JSON object is required.",
          400,
        );
      }
      const allowed = new Set([
        "assessment_id",
        "expected_score_version",
        "proposed_earned_score",
        "correction_reason",
        "evidence_summary",
        "confirm_correction",
        "dry_run",
      ]);
      if (Object.keys(body).some((key) => !allowed.has(key))) {
        gbCorrectionFail(
          "CORRECTION_FIELDS_UNSUPPORTED",
          "Unsupported correction request fields.",
          400,
        );
      }
      const assessmentId = gbCorrectionId(body.assessment_id);
      const scoreVersion = gbCorrectionId(body.expected_score_version);
      const reason =
        typeof body.correction_reason === "string"
          ? body.correction_reason.trim()
          : "";
      const evidence =
        typeof body.evidence_summary === "string"
          ? body.evidence_summary.trim()
          : "";
      if (
        !assessmentId ||
        !scoreVersion ||
        reason.length < 10 ||
        reason.length > 1000 ||
        evidence.length < 20 ||
        evidence.length > 4000 ||
        /[\x00-\x08\x0B\x0E-\x1F\x7F]/.test(reason + evidence) ||
        body.confirm_correction !== true ||
        typeof body.dry_run !== "boolean"
      ) {
        gbCorrectionFail(
          "CORRECTION_EVIDENCE_INVALID",
          "Provide assessment_id, current score version, documented reason (10–1000), evidence (20–4000), confirmation and boolean dry_run.",
          400,
        );
      }
      const proposedCents = gbCorrectionCents(
        body.proposed_earned_score,
        "proposed_earned_score",
      );

      connection = await db.getConnection();
      // Combined grading writes remain QA-only.
      await assertQaGradingDatabase(connection);
      await connection.beginTransaction();
      inTransaction = true;

      const [offerings] = await connection.execute(
        `SELECT so.offering_id, so.status, so.faculty_id,
                f.user_id AS instructor_user_id, u.is_active, u.is_archived, r.role_name
           FROM subject_offerings so
           JOIN faculty f ON f.faculty_id = so.faculty_id
           JOIN users u ON u.user_id = f.user_id
           JOIN roles r ON r.role_id = u.role_id
          WHERE so.offering_id = ? FOR UPDATE`,
        [offeringId],
      );
      if (offerings.length !== 1 || offerings[0].status === "Cancelled") {
        gbCorrectionFail(
          "CORRECTION_OFFERING_UNAVAILABLE",
          "Offering is missing or cancelled.",
        );
      }
      if (
        Number(offerings[0].instructor_user_id) !== actor ||
        Number(offerings[0].is_active) !== 1 ||
        Number(offerings[0].is_archived) !== 0 ||
        !["Faculty", "Program Head"].includes(offerings[0].role_name)
      ) {
        gbCorrectionFail(
          "CORRECTION_INSTRUCTOR_ONLY",
          "Only the active assigned instructor can request this gradebook correction.",
          403,
        );
      }
      const [configs] = await connection.execute(
        `SELECT config_id, midterm_percent, final_term_percent
           FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE`,
        [offeringId],
      );
      if (
        configs.length !== 1 ||
        Number(configs[0].midterm_percent) !== 50 ||
        Number(configs[0].final_term_percent) !== 50
      )
        gbCorrectionFail(
          "CORRECTION_POLICY_INVALID",
          "A valid official 50/50 gradebook is required.",
        );
      const configId = Number(configs[0].config_id);

      const [students] = await connection.execute(
        `SELECT es.enrollment_subject_id, es.offering_id, es.status AS subject_status,
                e.enrollment_status
           FROM enrollment_subjects es JOIN enrollments e ON e.enrollment_id = es.enrollment_id
          WHERE es.enrollment_subject_id = ? FOR UPDATE`,
        [enrollmentSubjectId],
      );
      if (
        students.length !== 1 ||
        Number(students[0].offering_id) !== offeringId ||
        students[0].enrollment_status !== "Approved" ||
        !["Completed", "Failed"].includes(students[0].subject_status)
      )
        gbCorrectionFail(
          "CORRECTION_ENROLLMENT_INELIGIBLE",
          "Only Approved enrollment with a published numeric result may be corrected.",
        );

      const [grades] = await connection.execute(
        `SELECT grade_id, grade_status, grading_policy, grading_outcome,
                midterm_grade, final_grade, overall_percentage, final_rating,
                remarks, faculty_id
           FROM grades WHERE enrollment_subject_id = ? FOR UPDATE`,
        [enrollmentSubjectId],
      );
      if (
        grades.length !== 1 ||
        grades[0].grade_status !== "Approved" ||
        grades[0].grading_policy !== "TWO_TERM_50_50" ||
        grades[0].grading_outcome !== "NUMERIC" ||
        Number(grades[0].faculty_id) !== Number(offerings[0].faculty_id)
      )
        gbCorrectionFail(
          "CORRECTION_GRADE_INELIGIBLE",
          "An Approved gradebook NUMERIC grade from the assigned instructor is required.",
        );
      const grade = grades[0];
      const gradeId = Number(grade.grade_id);

      const [pubRows] = await connection.execute(
        `SELECT publication_id, config_id, enrollment_subject_id,
                midterm_submission_id, final_term_submission_id,
                overall_exact_numerator, overall_exact_denominator
           FROM gradebook_official_grade_publications WHERE grade_id = ? FOR UPDATE`,
        [gradeId],
      );
      if (
        pubRows.length !== 1 ||
        Number(pubRows[0].config_id) !== configId ||
        Number(pubRows[0].enrollment_subject_id) !== enrollmentSubjectId
      )
        gbCorrectionFail(
          "CORRECTION_PUBLICATION_REQUIRED",
          "A single traceable official gradebook publication is required.",
        );
      const pub = pubRows[0];
      const [attempts] = await connection.execute(
        `SELECT term_submission_id, config_id, enrollment_subject_id, grading_term,
                submission_status, calculation_snapshot_json,
                term_percentage_exact_numerator, term_percentage_exact_denominator
           FROM gradebook_term_submission_attempts
          WHERE term_submission_id IN (?, ?) FOR UPDATE`,
        [
          String(pub.midterm_submission_id),
          String(pub.final_term_submission_id),
        ],
      );
      if (
        attempts.length !== 2 ||
        attempts.some(
          (a) =>
            a.submission_status !== "APPROVED" ||
            Number(a.config_id) !== configId ||
            Number(a.enrollment_subject_id) !== enrollmentSubjectId,
        ) ||
        new Set(attempts.map((a) => a.grading_term)).size !== 2
      )
        gbCorrectionFail(
          "CORRECTION_APPROVED_TERMS_REQUIRED",
          "Both approved official term snapshots must match the publication.",
        );
      const termByName = Object.fromEntries(
        attempts.map((a) => [a.grading_term, a]),
      );
      const digits = (x) =>
        /^(0|[1-9]\d*)$/.test(String(x ?? "")) && String(x).length <= 255;
      const m = termByName.MIDTERM;
      const f = termByName.FINAL_TERM;
      if (
        !m ||
        !f ||
        ![
          m.term_percentage_exact_numerator,
          m.term_percentage_exact_denominator,
          f.term_percentage_exact_numerator,
          f.term_percentage_exact_denominator,
          pub.overall_exact_numerator,
          pub.overall_exact_denominator,
        ].every(digits)
      ) {
        gbCorrectionFail(
          "CORRECTION_PUBLICATION_RATIO_INVALID",
          "Official term fraction provenance is missing or inconsistent.",
        );
      }
      const mn = BigInt(m.term_percentage_exact_numerator),
        md = BigInt(m.term_percentage_exact_denominator);
      const fn = BigInt(f.term_percentage_exact_numerator),
        fd = BigInt(f.term_percentage_exact_denominator);
      const pn = BigInt(pub.overall_exact_numerator),
        pd = BigInt(pub.overall_exact_denominator);
      if (
        md === 0n ||
        fd === 0n ||
        pd === 0n ||
        (mn * fd + fn * md) * pd !== 2n * md * fd * pn
      ) {
        gbCorrectionFail(
          "CORRECTION_PUBLICATION_RATIO_MISMATCH",
          "Published grade does not match approved exact term sources.",
        );
      }

      const [scoreRows] = await connection.execute(
        `SELECT s.score_id, s.score_status, s.earned_score, s.record_version,
                a.assessment_id, a.maximum_score, a.record_status, a.grading_term,
                oc.config_id
           FROM gradebook_scores s
           JOIN gradebook_assessments a ON a.assessment_id = s.assessment_id
           JOIN gradebook_offering_categories oc ON oc.offering_category_id = a.offering_category_id
          WHERE s.enrollment_subject_id = ? AND s.assessment_id = ? FOR UPDATE`,
        [enrollmentSubjectId, assessmentId],
      );
      if (
        scoreRows.length !== 1 ||
        Number(scoreRows[0].config_id) !== configId ||
        scoreRows[0].record_status !== "ACTIVE" ||
        scoreRows[0].score_status !== "SCORED" ||
        Number(scoreRows[0].record_version) !== scoreVersion
      )
        gbCorrectionFail(
          "CORRECTION_SCORE_STALE",
          "The saved score is missing, no longer active, or has a different version.",
        );
      const score = scoreRows[0];
      const originalCents = gbCorrectionCents(
        score.earned_score,
        "original earned score",
      );
      const maxCents = gbCorrectionCents(score.maximum_score, "maximum score");
      if (proposedCents > maxCents || originalCents === proposedCents) {
        gbCorrectionFail(
          "CORRECTION_SCORE_NOT_CHANGED",
          "Proposed score must differ from the original and be within the assessment maximum.",
          400,
        );
      }
      const term = termByName[score.grading_term];
      if (!term)
        gbCorrectionFail(
          "CORRECTION_TERM_MISSING",
          "Assessment term is not one of the approved published terms.",
        );
      gbCorrectionSourceSnapshot(
        term.calculation_snapshot_json,
        score.grading_term,
        { configId, enrollmentSubjectId, assessmentId },
        originalCents,
        maxCents,
      );

      const [activeRequests] = await connection.execute(
        `SELECT correction_id FROM gradebook_correction_requests
          WHERE grade_id = ? AND request_status IN ('SUBMITTED','RETURNED','APPROVED') FOR UPDATE`,
        [gradeId],
      );
      if (activeRequests.length) {
        gbCorrectionFail(
          "CORRECTION_ALREADY_ACTIVE",
          "Resolve the existing active correction request for this grade first.",
        );
      }
      const [legacyRequests] = await connection.execute(
        `SELECT grade_change_request_id FROM grade_change_requests
          WHERE grade_id = ? AND status IN ('Pending Program Head','For Registrar Processing') FOR UPDATE`,
        [gradeId],
      );
      if (legacyRequests.length)
        gbCorrectionFail(
          "CORRECTION_LEGACY_REQUEST_ACTIVE",
          "An older active grade-change request needs reconciliation first.",
        );

      const original = {
        grade_id: gradeId,
        grade_status: grade.grade_status,
        grading_policy: grade.grading_policy,
        grading_outcome: grade.grading_outcome,
        midterm_grade: grade.midterm_grade,
        final_grade: grade.final_grade,
        overall_percentage: grade.overall_percentage,
        final_rating: grade.final_rating,
        remarks: grade.remarks,
        publication_id: String(pub.publication_id),
        midterm_submission_id: String(pub.midterm_submission_id),
        final_term_submission_id: String(pub.final_term_submission_id),
        official_overall_exact_numerator: pub.overall_exact_numerator,
        official_overall_exact_denominator: pub.overall_exact_denominator,
      };
      const proposal = {
        correction_scope: "ONE_ASSESSMENT_SCORE",
        grade_id: gradeId,
        config_id: configId,
        offering_id: offeringId,
        enrollment_subject_id: enrollmentSubjectId,
        term: score.grading_term,
        term_submission_id: String(term.term_submission_id),
        assessment_id: assessmentId,
        score_id: Number(score.score_id),
        score_version_at_request: scoreVersion,
        original_earned_score: gbCorrectionScoreText(originalCents),
        proposed_earned_score: gbCorrectionScoreText(proposedCents),
        maximum_score_snapshot: gbCorrectionScoreText(maxCents),
        correction_reason: reason,
        evidence_summary: evidence,
        original_official_grade: original,
      };
      const [inserted] = await connection.execute(
        `INSERT INTO gradebook_correction_requests
           (grade_id, config_id, enrollment_subject_id, publication_id, term_submission_id,
            assessment_id, score_id, score_version_at_request, original_earned_score,
            proposed_earned_score, maximum_score_snapshot, original_grade_snapshot_json,
            correction_reason, evidence_summary, submitted_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          gradeId,
          configId,
          enrollmentSubjectId,
          String(pub.publication_id),
          String(term.term_submission_id),
          assessmentId,
          Number(score.score_id),
          scoreVersion,
          proposal.original_earned_score,
          proposal.proposed_earned_score,
          proposal.maximum_score_snapshot,
          JSON.stringify(original),
          reason,
          evidence,
          actor,
        ],
      );
      if (Number(inserted.affectedRows) !== 1)
        throw new Error("Correction request was not saved.");
      const correctionId = String(inserted.insertId);
      const [audit] = await connection.execute(
        `INSERT INTO gradebook_correction_request_events
           (correction_id, event_type, previous_status, new_status,
            proposal_snapshot_json, event_reason, performed_by_user_id, request_version_after)
         VALUES (?, 'SUBMITTED', NULL, 'SUBMITTED', ?, ?, ?, 1)`,
        [correctionId, JSON.stringify(proposal), reason, actor],
      );
      if (Number(audit.affectedRows) !== 1)
        throw new Error("Correction request audit was not saved.");
      if (body.dry_run) await connection.rollback();
      else await connection.commit();
      inTransaction = false;
      return res.status(body.dry_run ? 200 : 201).json({
        success: true,
        persisted: !body.dry_run,
        dry_run: body.dry_run,
        correction_id: body.dry_run ? null : correctionId,
        status: "SUBMITTED",
        record_version: 1,
        proposed_change: {
          assessment_id: assessmentId,
          grading_term: score.grading_term,
          old_score: proposal.original_earned_score,
          proposed_score: proposal.proposed_earned_score,
        },
        official_grade_unchanged: true,
        next_step:
          "Program Head review, then Registrar source-backed recalculation and official-sheet amendment.",
      });
    } catch (error) {
      if (inTransaction && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("GRADEBOOK CORRECTION ROLLBACK:", rollbackError);
        }
      }
      return gbCorrectionRespondError(res, error);
    } finally {
      connection?.release();
    }
  },
);

router.post(
  "/:offeringId/students/:enrollmentSubjectId/score-correction-requests/:correctionId/resubmit",
  async (req, res) => {
    let connection;
    let inTransaction = false;
    try {
      const offeringId = gbCorrectionId(req.params.offeringId);
      const enrollmentSubjectId = gbCorrectionId(
        req.params.enrollmentSubjectId,
      );
      const correctionId = gbCorrectionId(req.params.correctionId);
      const actor = gbCorrectionId(req.user?.user_id);
      if (!offeringId || !enrollmentSubjectId || !correctionId || !actor) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_IDS_INVALID",
          "Valid offering, subject, request and user IDs are required.",
          400,
        );
      }
      if (Object.keys(req.query ?? {}).length !== 0) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_QUERY_UNSUPPORTED",
          "Query parameters are not accepted.",
          400,
        );
      }
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_BODY_INVALID",
          "A JSON object is required.",
          400,
        );
      }
      const allowed = new Set([
        "expected_request_version",
        "expected_score_version",
        "proposed_earned_score",
        "correction_reason",
        "evidence_summary",
        "confirm_resubmission",
        "dry_run",
      ]);
      if (Object.keys(body).some((field) => !allowed.has(field))) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_FIELDS_UNSUPPORTED",
          "Unsupported fields were provided.",
          400,
        );
      }
      const expectedVersion = gbCorrectionId(body.expected_request_version);
      const expectedScoreVersion = gbCorrectionId(body.expected_score_version);
      const reason =
        typeof body.correction_reason === "string"
          ? body.correction_reason.trim()
          : "";
      const evidence =
        typeof body.evidence_summary === "string"
          ? body.evidence_summary.trim()
          : "";
      if (
        !expectedVersion ||
        expectedVersion >= 4294967295 ||
        !expectedScoreVersion ||
        reason.length < 10 ||
        reason.length > 1000 ||
        evidence.length < 20 ||
        evidence.length > 4000 ||
        /[\x00-\x08\x0B\x0E-\x1F\x7F]/.test(reason + evidence) ||
        body.confirm_resubmission !== true ||
        typeof body.dry_run !== "boolean"
      ) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_INPUT_INVALID",
          "Provide current request/score versions, a documented reason (10–1000), evidence (20–4000), confirmation and boolean dry_run.",
          400,
        );
      }
      const proposedCents = gbCorrectionCents(
        body.proposed_earned_score,
        "proposed_earned_score",
      );

      connection = await db.getConnection();
      // Combined grading writes remain QA-only.
      await assertQaGradingDatabase(connection);
      await connection.beginTransaction();
      inTransaction = true;

      // Same lock order as K3B7.2A/B: offering, config, subject, grade,
      // publication, approved terms, score, request, then request events.
      const [offerings] = await connection.execute(
        `SELECT so.offering_id, so.status, so.faculty_id,
                f.user_id AS instructor_user_id, u.is_active, u.is_archived, r.role_name
           FROM subject_offerings so
           JOIN faculty f ON f.faculty_id = so.faculty_id
           JOIN users u ON u.user_id = f.user_id
           JOIN roles r ON r.role_id = u.role_id
          WHERE so.offering_id = ? FOR UPDATE`,
        [offeringId],
      );
      if (offerings.length !== 1 || offerings[0].status === "Cancelled") {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_OFFERING_UNAVAILABLE",
          "Offering is missing or cancelled.",
        );
      }
      const offering = offerings[0];
      if (
        Number(offering.instructor_user_id) !== actor ||
        Number(offering.is_active) !== 1 ||
        Number(offering.is_archived) !== 0 ||
        !["Faculty", "Program Head"].includes(offering.role_name)
      ) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_INSTRUCTOR_ONLY",
          "Only the active assigned instructor can resubmit.",
          403,
        );
      }
      const [configs] = await connection.execute(
        `SELECT config_id, midterm_percent, final_term_percent
           FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE`,
        [offeringId],
      );
      if (
        configs.length !== 1 ||
        Number(configs[0].midterm_percent) !== 50 ||
        Number(configs[0].final_term_percent) !== 50
      ) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_POLICY_CHANGED",
          "The official 50/50 gradebook configuration changed.",
        );
      }
      const configId = Number(configs[0].config_id);
      const [subjects] = await connection.execute(
        `SELECT es.enrollment_subject_id, es.offering_id, es.status AS subject_status,
                e.enrollment_status
           FROM enrollment_subjects es JOIN enrollments e ON e.enrollment_id = es.enrollment_id
          WHERE es.enrollment_subject_id = ? FOR UPDATE`,
        [enrollmentSubjectId],
      );
      if (
        subjects.length !== 1 ||
        Number(subjects[0].offering_id) !== offeringId ||
        subjects[0].enrollment_status !== "Approved" ||
        !["Completed", "Failed"].includes(subjects[0].subject_status)
      ) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_ENROLLMENT_CHANGED",
          "Approved numeric subject status is no longer eligible.",
        );
      }
      const [grades] = await connection.execute(
        `SELECT grade_id, grade_status, grading_policy, grading_outcome,
                midterm_grade, final_grade, overall_percentage, final_rating,
                remarks, faculty_id
           FROM grades WHERE enrollment_subject_id = ? FOR UPDATE`,
        [enrollmentSubjectId],
      );
      if (
        grades.length !== 1 ||
        grades[0].grade_status !== "Approved" ||
        grades[0].grading_policy !== "TWO_TERM_50_50" ||
        grades[0].grading_outcome !== "NUMERIC" ||
        Number(grades[0].faculty_id) !== Number(offering.faculty_id)
      ) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_GRADE_CHANGED",
          "The approved numeric source grade has changed.",
        );
      }
      const grade = grades[0];
      const [publications] = await connection.execute(
        `SELECT publication_id, grade_id, config_id, enrollment_subject_id,
                midterm_submission_id, final_term_submission_id
           FROM gradebook_official_grade_publications WHERE grade_id = ? FOR UPDATE`,
        [grade.grade_id],
      );
      if (
        publications.length !== 1 ||
        Number(publications[0].config_id) !== configId ||
        Number(publications[0].enrollment_subject_id) !== enrollmentSubjectId
      ) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_PUBLICATION_CHANGED",
          "Official publication is no longer traceable.",
        );
      }
      const publication = publications[0];
      const [attempts] = await connection.execute(
        `SELECT term_submission_id, config_id, enrollment_subject_id, grading_term,
                submission_status, calculation_snapshot_json
           FROM gradebook_term_submission_attempts
          WHERE term_submission_id IN (?, ?) FOR UPDATE`,
        [
          String(publication.midterm_submission_id),
          String(publication.final_term_submission_id),
        ],
      );
      if (
        attempts.length !== 2 ||
        new Set(attempts.map((a) => a.grading_term)).size !== 2 ||
        attempts.some(
          (a) =>
            a.submission_status !== "APPROVED" ||
            Number(a.config_id) !== configId ||
            Number(a.enrollment_subject_id) !== enrollmentSubjectId,
        )
      ) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_TERMS_CHANGED",
          "Approved term provenance is missing or inconsistent.",
        );
      }

      // A pointer read is rechecked under the locked request below.
      const [pointers] = await connection.execute(
        `SELECT score_id FROM gradebook_correction_requests
          WHERE correction_id = ? AND config_id = ? AND enrollment_subject_id = ?`,
        [correctionId, configId, enrollmentSubjectId],
      );
      if (pointers.length !== 1) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_REQUEST_NOT_FOUND",
          "Correction request is not in this student and offering.",
          404,
        );
      }
      const scoreId = Number(pointers[0].score_id);
      const [scores] = await connection.execute(
        `SELECT sc.score_id, sc.score_status, sc.earned_score, sc.record_version,
                a.assessment_id, a.grading_term, a.maximum_score, a.record_status,
                oc.config_id
           FROM gradebook_scores sc
           JOIN gradebook_assessments a ON a.assessment_id = sc.assessment_id
           JOIN gradebook_offering_categories oc ON oc.offering_category_id = a.offering_category_id
          WHERE sc.score_id = ? AND sc.enrollment_subject_id = ? FOR UPDATE`,
        [scoreId, enrollmentSubjectId],
      );
      const [requests] = await connection.execute(
        `SELECT * FROM gradebook_correction_requests
          WHERE correction_id = ? AND config_id = ? AND enrollment_subject_id = ? FOR UPDATE`,
        [correctionId, configId, enrollmentSubjectId],
      );
      if (
        requests.length !== 1 ||
        requests[0].request_status !== "RETURNED" ||
        Number(requests[0].record_version) !== expectedVersion ||
        Number(requests[0].score_id) !== scoreId ||
        Number(requests[0].grade_id) !== Number(grade.grade_id) ||
        Number(requests[0].publication_id) !==
          Number(publication.publication_id) ||
        Number(requests[0].submitted_by_user_id) !== actor
      ) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_VERSION_CONFLICT",
          "Only an unchanged returned request from the original instructor may be resubmitted.",
        );
      }
      const request = requests[0];
      if (
        !request.reviewed_by_user_id ||
        !request.reviewed_at ||
        !String(request.review_remarks ?? "").trim()
      ) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_REVIEW_MISSING",
          "The Program Head's return decision is incomplete.",
        );
      }
      if (
        scores.length !== 1 ||
        scores[0].record_status !== "ACTIVE" ||
        scores[0].score_status !== "SCORED" ||
        Number(scores[0].config_id) !== configId ||
        Number(scores[0].assessment_id) !== Number(request.assessment_id) ||
        Number(scores[0].record_version) !==
          Number(request.score_version_at_request) ||
        Number(scores[0].record_version) !== expectedScoreVersion
      ) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_SCORE_STALE",
          "The score source/version changed; do not overwrite approved history.",
        );
      }
      const score = scores[0];
      const originalCents = gbCorrectionCents(
        request.original_earned_score,
        "original_earned_score",
      );
      const savedCents = gbCorrectionCents(
        score.earned_score,
        "saved earned score",
      );
      const maxCents = gbCorrectionCents(
        request.maximum_score_snapshot,
        "original maximum score",
      );
      const currentMax = gbCorrectionCents(
        score.maximum_score,
        "current maximum score",
      );
      if (
        savedCents !== originalCents ||
        currentMax !== maxCents ||
        proposedCents > maxCents ||
        proposedCents === originalCents
      ) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_SCORE_MISMATCH",
          "Revised score must be valid against the unchanged original assessment.",
        );
      }
      const term = attempts.find((a) => a.grading_term === score.grading_term);
      if (
        !term ||
        String(term.term_submission_id) !== String(request.term_submission_id)
      ) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_TERM_MISMATCH",
          "Correction does not match the originally approved term.",
        );
      }
      gbCorrectionSourceSnapshot(
        term.calculation_snapshot_json,
        score.grading_term,
        {
          configId,
          enrollmentSubjectId,
          assessmentId: Number(request.assessment_id),
        },
        originalCents,
        maxCents,
      );

      let priorGrade;
      try {
        priorGrade =
          typeof request.original_grade_snapshot_json === "string"
            ? JSON.parse(request.original_grade_snapshot_json)
            : request.original_grade_snapshot_json;
      } catch {
        priorGrade = null;
      }
      const same = (a, b) =>
        a == null ? b == null : b != null && String(a) === String(b);
      if (
        !priorGrade ||
        Number(priorGrade.grade_id) !== Number(grade.grade_id) ||
        String(priorGrade.publication_id) !==
          String(publication.publication_id) ||
        String(priorGrade.midterm_submission_id) !==
          String(publication.midterm_submission_id) ||
        String(priorGrade.final_term_submission_id) !==
          String(publication.final_term_submission_id) ||
        ![
          "grade_status",
          "grading_policy",
          "grading_outcome",
          "midterm_grade",
          "final_grade",
          "overall_percentage",
          "final_rating",
          "remarks",
        ].every((name) => same(priorGrade[name], grade[name]))
      ) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_OFFICIAL_GRADE_STALE",
          "The official grade no longer matches the original request snapshot.",
        );
      }
      const [legacy] = await connection.execute(
        `SELECT grade_change_request_id FROM grade_change_requests
          WHERE grade_id = ? AND status IN ('Pending Program Head','For Registrar Processing') FOR UPDATE`,
        [grade.grade_id],
      );
      if (legacy.length) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_LEGACY_CONFLICT",
          "An overlapping legacy grade-change request requires reconciliation.",
        );
      }

      const [events] = await connection.execute(
        `SELECT event_id, event_type, previous_status, new_status,
                proposal_snapshot_json, event_reason, performed_by_user_id, request_version_after
           FROM gradebook_correction_request_events
          WHERE correction_id = ? ORDER BY request_version_after, event_id FOR UPDATE`,
        [correctionId],
      );
      const first = events[0];
      const last = events.at(-1);
      const historyValid = Boolean(
        first?.event_type === "SUBMITTED" &&
        first.previous_status === null &&
        first.new_status === "SUBMITTED" &&
        Number(first.performed_by_user_id) === actor &&
        events.length === expectedVersion &&
        events.every(
          (event, index) =>
            Number(event.request_version_after) === index + 1 &&
            (index === 0 ||
              event.previous_status === events[index - 1].new_status) &&
            (index === 0 ||
              (event.event_type === "RETURNED" &&
                event.previous_status === "SUBMITTED" &&
                event.new_status === "RETURNED") ||
              (event.event_type === "RESUBMITTED" &&
                event.previous_status === "RETURNED" &&
                event.new_status === "SUBMITTED" &&
                Number(event.performed_by_user_id) === actor)),
        ) &&
        last.event_type === "RETURNED" &&
        last.new_status === "RETURNED" &&
        Number(last.performed_by_user_id) ===
          Number(request.reviewed_by_user_id) &&
        String(last.event_reason ?? "") ===
          String(request.review_remarks ?? ""),
      );
      if (!historyValid) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_AUDIT_INVALID",
          "Request history does not match the Program Head's return decision.",
        );
      }
      let priorProposal;
      try {
        priorProposal =
          typeof last.proposal_snapshot_json === "string"
            ? JSON.parse(last.proposal_snapshot_json)
            : last.proposal_snapshot_json;
      } catch {
        priorProposal = null;
      }
      if (
        !priorProposal ||
        priorProposal.correction_scope !== "ONE_ASSESSMENT_SCORE" ||
        Number(priorProposal.grade_id) !== Number(request.grade_id) ||
        Number(priorProposal.assessment_id) !== Number(request.assessment_id) ||
        Number(priorProposal.score_id) !== scoreId ||
        Number(priorProposal.config_id) !== configId ||
        Number(priorProposal.offering_id) !== offeringId ||
        Number(priorProposal.enrollment_subject_id) !== enrollmentSubjectId ||
        String(priorProposal.term_submission_id) !==
          String(term.term_submission_id) ||
        priorProposal.term !== score.grading_term ||
        Number(priorProposal.score_version_at_request) !==
          expectedScoreVersion ||
        gbCorrectionCents(
          priorProposal.maximum_score_snapshot,
          "previous maximum score",
        ) !== maxCents ||
        gbCorrectionCents(
          priorProposal.original_earned_score,
          "previous original score",
        ) !== originalCents ||
        gbCorrectionCents(
          priorProposal.proposed_earned_score,
          "previous proposed score",
        ) !==
          gbCorrectionCents(
            request.proposed_earned_score,
            "recorded proposed score",
          ) ||
        priorProposal.correction_reason !== request.correction_reason ||
        priorProposal.evidence_summary !== request.evidence_summary
      ) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_PREVIOUS_PROPOSAL_INVALID",
          "Current request and last audited proposal do not match.",
        );
      }
      if (
        proposedCents ===
          gbCorrectionCents(
            request.proposed_earned_score,
            "previous proposed score",
          ) &&
        reason === request.correction_reason &&
        evidence === request.evidence_summary
      ) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_NO_REVISION",
          "Change the proposed score, reason or evidence before resubmitting.",
          400,
        );
      }
      const proposal = {
        ...priorProposal,
        proposed_earned_score: gbCorrectionScoreText(proposedCents),
        correction_reason: reason,
        evidence_summary: evidence,
      };
      const nextVersion = expectedVersion + 1;
      const [updated] = await connection.execute(
        `UPDATE gradebook_correction_requests
            SET proposed_earned_score = ?, correction_reason = ?, evidence_summary = ?,
                request_status = 'SUBMITTED', submitted_at = NOW(6),
                reviewed_by_user_id = NULL, reviewed_at = NULL, review_remarks = NULL,
                record_version = record_version + 1
          WHERE correction_id = ? AND request_status = 'RETURNED' AND record_version = ?`,
        [
          proposal.proposed_earned_score,
          reason,
          evidence,
          correctionId,
          expectedVersion,
        ],
      );
      if (Number(updated.affectedRows) !== 1) {
        gbCorrectionFail(
          "CORRECTION_RESUBMIT_CONFLICT",
          "The returned request was changed during resubmission.",
        );
      }
      const [audit] = await connection.execute(
        `INSERT INTO gradebook_correction_request_events
           (correction_id, event_type, previous_status, new_status,
            proposal_snapshot_json, event_reason, performed_by_user_id, request_version_after)
         VALUES (?, 'RESUBMITTED', 'RETURNED', 'SUBMITTED', ?, ?, ?, ?)`,
        [correctionId, JSON.stringify(proposal), reason, actor, nextVersion],
      );
      if (Number(audit.affectedRows) !== 1)
        throw new Error("Correction resubmission audit was not saved.");
      if (body.dry_run) await connection.rollback();
      else await connection.commit();
      inTransaction = false;
      return res.json({
        success: true,
        dry_run: body.dry_run,
        persisted: !body.dry_run,
        correction_id: String(correctionId),
        request_status: "SUBMITTED",
        record_version: nextVersion,
        audit_event_id: body.dry_run ? null : String(audit.insertId),
        old_score: gbCorrectionScoreText(originalCents),
        proposed_score: proposal.proposed_earned_score,
        official_grade_unchanged: true,
        assessment_score_unchanged: true,
        next_step:
          "Program Head reviews the revised source-linked request; Registrar processes only an approved request.",
      });
    } catch (error) {
      if (inTransaction && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("CORRECTION RESUBMISSION ROLLBACK:", rollbackError);
        }
      }
      return gbCorrectionRespondError(res, error);
    } finally {
      connection?.release();
    }
  },
);

/* Combined Semester Submission */

router.post(
  "/:offeringId/students/:enrollmentSubjectId/semester-submissions",
  async (req, res) => {
    const ids = validatePreviewIdentifiers(req, res);
    if (!ids) return;

    if (Object.keys(req.query ?? {}).length) {
      return res.status(400).json({
        success: false,
        code: "COMBINED_QUERY_UNSUPPORTED",
        message: "Query parameters are not accepted.",
      });
    }

    const body = req.body;
    const allowed = new Set([
      "expected_latest_submission_id",
      "expected_latest_submission_record_version",
      "dry_run",
      "special_outcome",
    ]);

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.has(key)) ||
      body.expected_latest_submission_id !== null ||
      body.expected_latest_submission_record_version !== null ||
      typeof body.dry_run !== "boolean"
    ) {
      return res.status(400).json({
        success: false,
        code: "COMBINED_FIRST_SUBMISSION_BODY_INVALID",
        message:
          "First submission requires both expected latest submission values to be null and dry_run to be boolean. Grade values cannot be supplied.",
      });
    }

    const requestedSpecial = body.special_outcome;
    let special = null;
    if (requestedSpecial !== undefined) {
      const allowedSpecial = new Set([
        "outcome_type",
        "outcome_reason",
        "missing_requirements",
        "evidence_summary",
      ]);
      const textValid = (v, min, max) =>
        typeof v === "string" &&
        v.trim().length >= min &&
        v.trim().length <= max &&
        !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(v);
      if (
        !requestedSpecial ||
        typeof requestedSpecial !== "object" ||
        Array.isArray(requestedSpecial) ||
        Object.keys(requestedSpecial).some((k) => !allowedSpecial.has(k)) ||
        !["INCOMPLETE", "UNOFFICIAL_DROP"].includes(
          requestedSpecial.outcome_type,
        ) ||
        !textValid(requestedSpecial.outcome_reason, 10, 500) ||
        !textValid(requestedSpecial.evidence_summary, 20, 2000) ||
        (requestedSpecial.outcome_type === "INCOMPLETE"
          ? !textValid(requestedSpecial.missing_requirements, 10, 2000)
          : requestedSpecial.missing_requirements != null)
      ) {
        return res.status(400).json({
          success: false,
          code: "COMBINED_SPECIAL_INPUT_INVALID",
          message:
            "Provide a valid INC or UD outcome, documented reason and evidence; INC also requires missing requirements.",
        });
      }
      special = {
        outcome_type: requestedSpecial.outcome_type,
        outcome_reason: requestedSpecial.outcome_reason.trim(),
        missing_requirements:
          requestedSpecial.missing_requirements?.trim() ?? null,
        evidence_summary: requestedSpecial.evidence_summary.trim(),
      };
      // Special-outcome QA scope
      if (
        ids.offeringId !== 130 ||
        ids.actorUserId !== 32 ||
        ![277, 334].includes(ids.enrollmentSubjectId)
      ) {
        return res.status(403).json({
          success: false,
          code: "COMBINED_SPECIAL_QA_ONLY",
          message:
            "Special-outcome submissions are restricted to the authorized Offering #130 QA students.",
        });
      }
    }

    let connection;
    let transactionOpen = false;

    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionOpen = true;

      // Combined grading writes remain QA-only.
      await assertQaGradingDatabase(connection);

      // Offering and instructor
      const [offeringRows] = await connection.execute(
        `SELECT
           so.offering_id,
           so.status,
           so.faculty_id,
           so.academic_year_id,
           so.semester_id,
           cr.department_id,
           f.user_id AS instructor_user_id,
           u.is_active,
           u.is_archived,
           r.role_name
         FROM subject_offerings so
         LEFT JOIN faculty f
           ON f.faculty_id = so.faculty_id
         LEFT JOIN users u
           ON u.user_id = f.user_id
         LEFT JOIN roles r
           ON r.role_id = u.role_id
         LEFT JOIN sections sec
           ON sec.section_id = so.section_id
         LEFT JOIN courses cr
           ON cr.course_id = sec.course_id
         WHERE so.offering_id = ?
         FOR UPDATE`,
        [ids.offeringId],
      );

      if (offeringRows.length !== 1) {
        previewFail("COMBINED_OFFERING_NOT_FOUND", "Offering not found.", 404);
      }

      const offering = offeringRows[0];

      if (
        Number(offering.instructor_user_id) !== ids.actorUserId ||
        Number(offering.is_active) !== 1 ||
        Number(offering.is_archived) !== 0 ||
        !["Faculty", "Program Head"].includes(offering.role_name)
      ) {
        previewFail(
          "COMBINED_INSTRUCTOR_REQUIRED",
          "Only the active assigned instructor may submit.",
          403,
        );
      }

      if (offering.status !== "Open") {
        previewFail("COMBINED_OFFERING_NOT_OPEN", "The offering must be Open.");
      }

      const departmentId = positiveId(offering.department_id);
      const yearId = positiveId(offering.academic_year_id);
      const semesterId = positiveId(offering.semester_id);
      const facultyId = positiveId(offering.faculty_id);

      if (!departmentId || !yearId || !semesterId || !facultyId) {
        previewFail(
          "COMBINED_SCOPE_INVALID",
          "Offering academic scope or instructor is missing.",
        );
      }

      // Gradebook configuration
      const [configs] = await connection.execute(
        `SELECT
           config_id,
           midterm_percent,
           final_term_percent
         FROM gradebook_offering_config
         WHERE offering_id = ?
         FOR UPDATE`,
        [ids.offeringId],
      );

      if (
        configs.length !== 1 ||
        Number(configs[0].midterm_percent) !== 50 ||
        Number(configs[0].final_term_percent) !== 50
      ) {
        previewFail(
          "COMBINED_CONFIG_INVALID",
          "An initialized 50/50 gradebook is required.",
        );
      }

      const configId = Number(configs[0].config_id);

      // Student enrollment
      const [enrollments] = await connection.execute(
        `SELECT
           es.enrollment_subject_id,
           es.offering_id,
           es.status AS subject_status,
           e.enrollment_status
         FROM enrollment_subjects es
         JOIN enrollments e
           ON e.enrollment_id = es.enrollment_id
         WHERE es.enrollment_subject_id = ?
         FOR UPDATE`,
        [ids.enrollmentSubjectId],
      );

      if (
        enrollments.length !== 1 ||
        Number(enrollments[0].offering_id) !== ids.offeringId ||
        enrollments[0].subject_status !== "Enrolled" ||
        enrollments[0].enrollment_status !== "Approved"
      ) {
        previewFail(
          "COMBINED_ENROLLMENT_INELIGIBLE",
          "An approved active enrollment is required.",
        );
      }

      // Combined semester period
      const [periods] = await connection.execute(
        `SELECT
           period_id,
           period_status,
           record_version
         FROM gradebook_submission_periods
         WHERE department_id = ?
           AND academic_year_id = ?
           AND semester_id = ?
         FOR UPDATE`,
        [departmentId, yearId, semesterId],
      );

      if (periods.length !== 1) {
        previewFail(
          "COMBINED_PERIOD_NOT_CONFIGURED",
          "Program Head must configure the combined submission window.",
        );
      }

      const period = periods[0];

      if (period.period_status !== "OPEN") {
        previewFail(
          "COMBINED_PERIOD_CLOSED",
          "The combined semester submission window is closed.",
        );
      }

      // Preserve earlier term-based submissions
      const [termHistory] = await connection.execute(
        `SELECT 1
         FROM gradebook_term_submission_attempts
         WHERE config_id = ?
         LIMIT 1`,
        [configId],
      );

      const [termLocks] = await connection.execute(
        `SELECT 1
         FROM gradebook_term_structure_locks
         WHERE config_id = ?
         LIMIT 1`,
        [configId],
      );

      if (termHistory.length || termLocks.length) {
        previewFail(
          "COMBINED_LEGACY_OFFERING",
          "This offering has previous term-based submissions and requires historical reconciliation.",
        );
      }

      // First-submission-only protection
      const [grades] = await connection.execute(
        `SELECT grade_id, grade_status
         FROM grades
         WHERE enrollment_subject_id = ?
         FOR UPDATE`,
        [ids.enrollmentSubjectId],
      );

      if (grades.length) {
        previewFail(
          "COMBINED_GRADE_ALREADY_EXISTS",
          "This student already has a grade. Use an authorized reconciliation or resubmission workflow.",
        );
      }

      // Special-outcome conflicts
      const [incRequests] = await connection.execute(
        `SELECT 1
         FROM gradebook_inc_outcome_requests
         WHERE config_id = ?
           AND enrollment_subject_id = ?
           AND request_status IN ('SUBMITTED', 'APPROVED')
         LIMIT 1`,
        [configId, ids.enrollmentSubjectId],
      );

      const [udRequests] = await connection.execute(
        `SELECT 1
         FROM gradebook_ud_outcome_requests
         WHERE config_id = ?
           AND enrollment_subject_id = ?
           AND request_status IN ('SUBMITTED', 'APPROVED')
         LIMIT 1`,
        [configId, ids.enrollmentSubjectId],
      );

      if (incRequests.length || udRequests.length) {
        previewFail(
          "COMBINED_SPECIAL_OUTCOME_PENDING",
          "Resolve the active INC or UD request before submitting a numeric result.",
        );
      }

      // Attendance structure
      const [scheduled] = await connection.execute(
        `SELECT COUNT(*) AS pending
         FROM gradebook_attendance_meetings
         WHERE config_id = ?
           AND meeting_status = 'SCHEDULED'`,
        [configId],
      );

      if (Number(scheduled[0]?.pending) !== 0) {
        previewFail(
          "COMBINED_SCHEDULED_MEETINGS",
          "Complete or cancel remaining scheduled meetings before submission.",
        );
      }

      // Calculate both terms from saved gradebook records
      const preview = await calculateGradePreview(
        connection,
        ids.offeringId,
        ids.enrollmentSubjectId,
        ids.actorUserId,
      );

      if (Number(preview.config_id) !== configId) {
        previewFail(
          "COMBINED_CONFIG_MISMATCH",
          "Grade preview configuration changed.",
        );
      }
      let mid = preview.terms.MIDTERM?.term_percentage ?? null;
      let fin = preview.terms.FINAL_TERM?.term_percentage ?? null;
      let overall = preview.semester?.semester_percentage ?? null;
      let rating = preview.semester?.numeric_equivalent ?? null;
      const outcome = special?.outcome_type ?? "NUMERIC";
      const validFraction = (value, maxDigits) =>
        value &&
        /^(0|[1-9]\d*)$/.test(value.exact_numerator) &&
        /^[1-9]\d*$/.test(value.exact_denominator) &&
        value.exact_numerator.length <= maxDigits &&
        value.exact_denominator.length <= maxDigits;
      let specialEvidence = null;

      if (!special) {
        if (
          preview.terms.MIDTERM?.state !== "READY" ||
          preview.terms.FINAL_TERM?.state !== "READY" ||
          preview.semester?.state !== "READY"
        ) {
          previewFail(
            "COMBINED_GRADE_INCOMPLETE",
            "Both terms and all required assessment and attendance categories must be ready.",
            422,
          );
        }

        if (
          !validFraction(mid, 255) ||
          !validFraction(fin, 255) ||
          !validFraction(overall, 1200)
        ) {
          previewFail(
            "COMBINED_EXACT_FRACTION_INVALID",
            "Exact calculation cannot fit the submission columns.",
          );
        }

        const calculated = fractionAdd(
          fractionTimes(
            fraction(
              BigInt(mid.exact_numerator),
              BigInt(mid.exact_denominator),
            ),
            1n,
            2n,
          ),
          fractionTimes(
            fraction(
              BigInt(fin.exact_numerator),
              BigInt(fin.exact_denominator),
            ),
            1n,
            2n,
          ),
        );

        if (
          calculated.n.toString() !== overall.exact_numerator ||
          calculated.d.toString() !== overall.exact_denominator
        ) {
          previewFail(
            "COMBINED_CALCULATION_INCONSISTENT",
            "Exact Midterm and Final Term calculations do not match the semester result.",
          );
        }
      } else {
        // Evidence is read from the saved gradebook, not supplied as scores by the client.
        const [pending] = await connection.execute(
          `SELECT a.assessment_id, a.grading_term, a.header_name, oc.category_code,
                  a.maximum_score, sc.score_id, sc.record_version
             FROM gradebook_assessments a
             JOIN gradebook_offering_categories oc
               ON oc.offering_category_id = a.offering_category_id
             LEFT JOIN gradebook_scores sc
               ON sc.assessment_id = a.assessment_id AND sc.enrollment_subject_id = ?
            WHERE oc.config_id = ? AND a.record_status = 'ACTIVE'
              AND COALESCE(sc.score_status, 'PENDING') = 'PENDING'
            ORDER BY a.grading_term, a.assessment_id FOR UPDATE`,
          [ids.enrollmentSubjectId, configId],
        );
        const [attendance] = await connection.execute(
          `SELECT m.meeting_id, m.grading_term,
                  DATE_FORMAT(m.meeting_date, '%Y-%m-%d') AS meeting_date,
                  COALESCE(a.attendance_status, 'PENDING') AS attendance_status,
                  a.record_version, a.recorded_by_user_id, a.recorded_at
             FROM gradebook_attendance_meetings m
             LEFT JOIN gradebook_attendance_entries a
               ON a.meeting_id = m.meeting_id AND a.enrollment_subject_id = ?
            WHERE m.config_id = ? AND m.meeting_status = 'HELD'
              AND m.meeting_date <= CURDATE()
            ORDER BY m.meeting_date, m.meeting_id FOR UPDATE`,
          [ids.enrollmentSubjectId, configId],
        );
        if (
          !attendance.length ||
          attendance.some((a) => a.attendance_status === "PENDING")
        ) {
          previewFail(
            "COMBINED_SPECIAL_ATTENDANCE_PENDING",
            "Resolve held attendance entries before special-outcome submission.",
            422,
          );
        }
        const absences = attendance.filter(
          (a) =>
            a.attendance_status === "ABSENT" &&
            a.recorded_by_user_id != null &&
            a.recorded_at != null &&
            Number(a.record_version) > 0,
        );
        if (outcome === "INCOMPLETE") {
          // Initial pilot covers completed Midterm with documented missing Final requirements.
          if (
            preview.terms.MIDTERM?.state !== "READY" ||
            !validFraction(mid, 255) ||
            preview.terms.FINAL_TERM?.state === "READY" ||
            !pending.some((a) => a.grading_term === "FINAL_TERM")
          ) {
            previewFail(
              "COMBINED_INC_REQUIREMENTS_INVALID",
              "This INC pilot requires a calculated Midterm and genuinely pending Final Term assessments.",
              422,
            );
          }
          rating = "4.00";
        } else {
          if (!absences.length) {
            previewFail(
              "COMBINED_UD_ATTENDANCE_EVIDENCE_REQUIRED",
              "Documented absence evidence is required; absences alone do not authorize UD.",
              422,
            );
          }
          mid = null;
          rating = "6.00";
        }
        fin = null;
        overall = null;
        specialEvidence = {
          ...special,
          pending_assessments: pending,
          attendance_entries: attendance,
          absent_meetings: absences.length,
        };
      }

      // In-progress official sheet
      const [sheets] = await connection.execute(
        `SELECT
           sheet_id,
           sheet_status,
           original_official_submitted_on,
           official_date_verified_at
         FROM gradebook_official_sheets
         WHERE config_id = ?
         FOR UPDATE`,
        [configId],
      );

      if (
        sheets.length > 1 ||
        sheets[0]?.sheet_status === "FINALIZED" ||
        sheets[0]?.original_official_submitted_on != null ||
        sheets[0]?.official_date_verified_at != null
      ) {
        previewFail(
          "COMBINED_SHEET_NOT_EDITABLE",
          "The official sheet is finalized or already has an original submission record.",
        );
      }

      let sheetId = sheets[0] ? String(sheets[0].sheet_id) : null;

      if (!sheetId) {
        const [sheetInsert] = await connection.execute(
          `INSERT INTO gradebook_official_sheets
             (config_id, sheet_status, created_by_user_id)
           VALUES (?, 'IN_PROGRESS', ?)`,
          [configId, ids.actorUserId],
        );

        if (Number(sheetInsert.affectedRows) !== 1) {
          throw new Error("Could not create the in-progress official sheet.");
        }

        sheetId = String(sheetInsert.insertId);
      }

      // Existing combined-submission history
      const [priorCombined] = await connection.execute(
        `SELECT sa.submission_id
         FROM gradebook_grade_submission_attempts sa
         JOIN grades g ON g.grade_id = sa.grade_id
         WHERE g.enrollment_subject_id = ?
         LIMIT 1
         FOR UPDATE`,
        [ids.enrollmentSubjectId],
      );

      if (priorCombined.length) {
        previewFail(
          "COMBINED_ALREADY_SUBMITTED",
          "A combined submission already exists for this student.",
        );
      }

      const [allCombined] = await connection.execute(
        `SELECT COUNT(*) AS total
         FROM gradebook_grade_submission_attempts
         WHERE sheet_id = ?`,
        [sheetId],
      );

      const [locks] = await connection.execute(
        `SELECT first_submission_id
         FROM gradebook_structure_locks
         WHERE config_id = ?
         FOR UPDATE`,
        [configId],
      );

      const priorCount = Number(allCombined[0]?.total);

      if (
        !Number.isSafeInteger(priorCount) ||
        (priorCount === 0 && locks.length !== 0) ||
        (priorCount > 0 && locks.length !== 1)
      ) {
        previewFail(
          "COMBINED_STRUCTURE_LOCK_INVALID",
          "Combined submission history and structure-lock records are inconsistent.",
        );
      }

      // Deadline check immediately before writing
      const [[deadline]] = await connection.execute(
        `SELECT CASE
            WHEN period_status = 'OPEN'
             AND (
               submission_deadline_at IS NULL
               OR NOW() <= submission_deadline_at
             )
            THEN 1 ELSE 0
          END AS allowed
         FROM gradebook_submission_periods
         WHERE period_id = ?
         FOR UPDATE`,
        [period.period_id],
      );

      if (Number(deadline?.allowed) !== 1) {
        previewFail(
          "COMBINED_WINDOW_EXPIRED",
          "The combined submission window has closed or expired.",
        );
      }

      // Create Draft first, as required by the grade trigger
      const [gradeInsert] = await connection.execute(
        `INSERT INTO grades
           (
             enrollment_subject_id,
             faculty_id,
             grade_status,
             grading_policy,
             grading_outcome,
             outcome_reason
           )
         VALUES (
           ?, ?, 'Draft',
           'TWO_TERM_50_50', ?, ?
         )`,
        [
          ids.enrollmentSubjectId,
          facultyId,
          outcome,
          special?.outcome_reason ?? null,
        ],
      );

      if (Number(gradeInsert.affectedRows) !== 1) {
        throw new Error("Could not create the grade record.");
      }

      const gradeId = Number(gradeInsert.insertId);

      let specialOutcomeId = null;
      if (special) {
        const [outcomeInsert] = await connection.execute(
          `INSERT INTO gradebook_special_outcomes
             (grade_id, outcome_type, outcome_reason, missing_requirements,
              evidence_summary, record_status, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`,
          [
            gradeId,
            outcome,
            special.outcome_reason,
            special.missing_requirements,
            special.evidence_summary,
            ids.actorUserId,
          ],
        );
        if (
          Number(outcomeInsert.affectedRows) !== 1 ||
          !positiveId(outcomeInsert.insertId)
        ) {
          throw new Error("Special outcome insert failed.");
        }
        specialOutcomeId = Number(outcomeInsert.insertId);
        const [event] = await connection.execute(
          `INSERT INTO gradebook_special_outcome_events
             (special_outcome_id, event_type, previous_record_status, new_record_status,
              previous_outcome_type, new_outcome_type, previous_outcome_reason, new_outcome_reason,
              previous_missing_requirements, new_missing_requirements,
              previous_evidence_summary, new_evidence_summary, event_reason,
              performed_by_user_id, record_version_after)
           VALUES (?, 'CREATED', NULL, 'ACTIVE', NULL, ?, NULL, ?, NULL, ?, NULL, ?, ?, ?, 1)`,
          [
            specialOutcomeId,
            outcome,
            special.outcome_reason,
            special.missing_requirements,
            special.evidence_summary,
            "Combined semester special outcome submission",
            ids.actorUserId,
          ],
        );
        if (Number(event.affectedRows) !== 1)
          throw new Error("Special outcome audit insert failed.");
      }

      // Save the computed values and submit
      const [gradeUpdate] = await connection.execute(
        `UPDATE grades
         SET
           midterm_grade = ?,
           final_grade = ?,
           grade_status = 'Submitted',
           submitted_at = NOW(),
           reviewed_by = NULL,
           reviewed_at = NULL,
           review_remarks = NULL
         WHERE grade_id = ?
           AND grade_status = 'Draft'`,
        [mid?.decimal_preview ?? null, fin?.decimal_preview ?? null, gradeId],
      );

      if (Number(gradeUpdate.affectedRows) !== 1) {
        throw new Error("Could not submit the grade record.");
      }

      // Reject any difference between exact gradebook
      // grading and the database trigger equivalent.
      const [[savedGrade]] = await connection.execute(
        `SELECT
           grade_status,
           grading_policy,
           grading_outcome,
           final_rating, midterm_grade, final_grade, overall_percentage, remarks, outcome_reason
         FROM grades
         WHERE grade_id = ?
         FOR UPDATE`,
        [gradeId],
      );

      if (
        savedGrade?.grade_status !== "Submitted" ||
        savedGrade.grading_policy !== "TWO_TERM_50_50" ||
        savedGrade.grading_outcome !== outcome ||
        Number(savedGrade.final_rating) !== Number(rating) ||
        (special &&
          (savedGrade.final_grade !== null ||
            savedGrade.overall_percentage !== null ||
            (outcome === "INCOMPLETE"
              ? savedGrade.midterm_grade === null ||
                Number(savedGrade.midterm_grade) !== Number(mid.decimal_preview)
              : savedGrade.midterm_grade !== null) ||
            savedGrade.remarks !==
              (outcome === "INCOMPLETE" ? "Incomplete" : "Unofficial Drop") ||
            savedGrade.outcome_reason !== special.outcome_reason))
      ) {
        previewFail(
          "COMBINED_TRIGGER_PRECISION_CONFLICT",
          "Database grading and exact gradebook calculation disagree. The transaction will be rolled back.",
        );
      }

      // Save the source-backed semester snapshot
      const snapshot = JSON.stringify({
        policy: "TWO_TERM_50_50",
        grading_scope: "FULL_SEMESTER",
        offering_id: ids.offeringId,
        config_id: configId,
        enrollment_subject_id: ids.enrollmentSubjectId,
        grade_id: gradeId,
        student: preview.student,
        classification: preview.grading_classification,
        term_weights: preview.term_weights,
        calculated_terms: {
          MIDTERM: preview.terms.MIDTERM,
          FINAL_TERM: preview.terms.FINAL_TERM,
        },
        calculated_semester: preview.semester,
        ...(special
          ? {
              grading_outcome: outcome,
              special_outcome_id: specialOutcomeId,
              special_outcome: specialEvidence,
              official_result: {
                midterm_grade: mid?.decimal_preview ?? null,
                final_grade: null,
                overall_percentage: null,
                final_rating: rating,
              },
            }
          : {}),
      });

      const [inserted] = await connection.execute(
        `INSERT INTO gradebook_grade_submission_attempts
         (
           sheet_id,
           period_id,
           grade_id,
           special_outcome_id,
           attempt_number,
           submission_batch_ref,
           grading_scope,
           grading_outcome_snapshot,
           midterm_percentage_snapshot,
           final_term_percentage_snapshot,
           overall_percentage_snapshot,
           final_rating_snapshot,
           special_outcome_reason_snapshot,
           submission_status,
           submitted_by_user_id,
           record_version,
           calculation_snapshot_json,
           midterm_exact_numerator,
           midterm_exact_denominator,
           final_term_exact_numerator,
           final_term_exact_denominator,
           overall_exact_numerator,
           overall_exact_denominator
         )
         VALUES (
           ?, ?, ?, ?, 1, ?,
           'FULL_SEMESTER', ?,
           ?, ?, ?, ?, ?,
           'SUBMITTED', ?, 1,
           ?, ?, ?, ?, ?, ?, ?
         )`,
        [
          sheetId,
          period.period_id,
          gradeId,
          specialOutcomeId,
          randomUUID(),
          outcome,
          mid?.decimal_preview ?? null,
          fin?.decimal_preview ?? null,
          overall?.decimal_preview ?? null,
          rating,
          special?.outcome_reason ?? null,
          ids.actorUserId,
          snapshot,
          mid?.exact_numerator ?? null,
          mid?.exact_denominator ?? null,
          fin?.exact_numerator ?? null,
          fin?.exact_denominator ?? null,
          overall?.exact_numerator ?? null,
          overall?.exact_denominator ?? null,
        ],
      );

      if (Number(inserted.affectedRows) !== 1) {
        throw new Error("Combined submission insert failed.");
      }

      const submissionId = String(inserted.insertId);

      // Lock shared gradebook structure on first submission
      if (priorCount === 0) {
        const [locked] = await connection.execute(
          `INSERT INTO gradebook_structure_locks
           (
             config_id,
             first_submission_id,
             locked_by_user_id,
             lock_reason
           )
           VALUES (
             ?, ?, ?,
             'FIRST_COMBINED_SUBMISSION'
           )`,
          [configId, submissionId, ids.actorUserId],
        );

        if (Number(locked.affectedRows) !== 1) {
          throw new Error("Could not create the shared structure lock.");
        }
      }

      if (body.dry_run) {
        await connection.rollback();
      } else {
        await connection.commit();
      }

      transactionOpen = false;

      return res.status(body.dry_run ? 200 : 201).json({
        success: true,
        dry_run: body.dry_run,
        persisted: !body.dry_run,
        offering_id: ids.offeringId,
        enrollment_subject_id: ids.enrollmentSubjectId,
        grade_id: body.dry_run ? null : gradeId,
        submission_id: body.dry_run ? null : submissionId,
        sheet_id: body.dry_run ? null : sheetId,
        period_id: period.period_id,
        status: "SUBMITTED",
        grade_status: "Submitted",
        overall_percentage: overall?.display ?? null,
        numeric_equivalent: rating,
        ...(special
          ? {
              grading_outcome: outcome,
              special_outcome_id: body.dry_run ? null : specialOutcomeId,
              midterm_percentage: mid?.display ?? null,
              final_term_percentage: fin?.display ?? null,
              pending_assessment_count:
                specialEvidence.pending_assessments.length,
              absent_meetings: specialEvidence.absent_meetings,
            }
          : {}),
        first_shared_lock_created: priorCount === 0,
        official_grade_published: false,
        note: body.dry_run
          ? "All submission writes rolled back. No official grade has been published."
          : "Awaiting Program Head review. No official grade has been published.",
      });
    } catch (error) {
      if (transactionOpen && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("COMBINED SUBMISSION ROLLBACK:", rollbackError);
        }
      }

      if (error?.code === "ER_DUP_ENTRY") {
        return sendError(res, {
          status: 409,
          code: "COMBINED_SUBMISSION_CONFLICT",
          message:
            "Another grade or submission was saved. Reload the gradebook.",
        });
      }

      return sendError(res, error);
    } finally {
      connection?.release();
    }
  },
);

/* Combined Semester Resubmission */

router.post(
  "/:offeringId/students/:enrollmentSubjectId/semester-submissions/:submissionId/resubmit",
  async (req, res) => {
    const ids = validatePreviewIdentifiers(req, res);
    if (!ids) return;

    const oldSubmissionId = positiveId(req.params.submissionId);
    const body = req.body;

    const allowed = new Set([
      "expected_record_version",
      "confirm_resubmission",
      "dry_run",
    ]);

    const version = positiveId(body?.expected_record_version);

    if (
      !oldSubmissionId ||
      Object.keys(req.query ?? {}).length !== 0 ||
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !allowed.has(key)) ||
      !version ||
      version >= 4294967295 ||
      body.confirm_resubmission !== true ||
      typeof body.dry_run !== "boolean"
    ) {
      return res.status(400).json({
        success: false,
        code: "COMBINED_RESUBMIT_INPUT_INVALID",
        message:
          "Provide the returned submission ID, its current record version, confirmation, and boolean dry_run. Grade values are calculated by the server.",
      });
    }

    let connection;
    let transactionOpen = false;

    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionOpen = true;

      // Combined grading writes remain QA-only.
      await assertQaGradingDatabase(connection);

      // Offering
      const [offerings] = await connection.execute(
        `SELECT so.offering_id, so.status, so.faculty_id,
                so.academic_year_id, so.semester_id,
                cr.department_id,
                f.user_id AS instructor_user_id,
                u.is_active, u.is_archived, r.role_name
         FROM subject_offerings so
         JOIN faculty f ON f.faculty_id = so.faculty_id
         JOIN users u ON u.user_id = f.user_id
         JOIN roles r ON r.role_id = u.role_id
         JOIN sections sec ON sec.section_id = so.section_id
         JOIN courses cr ON cr.course_id = sec.course_id
         WHERE so.offering_id = ?
         FOR UPDATE`,
        [ids.offeringId],
      );

      const offering = offerings[0];

      if (offerings.length !== 1 || offering.status !== "Open") {
        previewFail(
          "COMBINED_RESUBMIT_OFFERING_CLOSED",
          "The class offering must be Open.",
        );
      }

      if (
        Number(offering.instructor_user_id) !== ids.actorUserId ||
        Number(offering.is_active) !== 1 ||
        Number(offering.is_archived) !== 0 ||
        !["Faculty", "Program Head"].includes(offering.role_name)
      ) {
        previewFail(
          "COMBINED_RESUBMIT_INSTRUCTOR_ONLY",
          "Only the active assigned instructor may resubmit.",
          403,
        );
      }

      // Gradebook configuration
      const [configs] = await connection.execute(
        `SELECT config_id, midterm_percent, final_term_percent
         FROM gradebook_offering_config
         WHERE offering_id = ?
         FOR UPDATE`,
        [ids.offeringId],
      );

      if (
        configs.length !== 1 ||
        Number(configs[0].midterm_percent) !== 50 ||
        Number(configs[0].final_term_percent) !== 50
      ) {
        previewFail(
          "COMBINED_RESUBMIT_CONFIG_INVALID",
          "An official 50/50 gradebook is required.",
        );
      }

      const configId = Number(configs[0].config_id);

      // Student enrollment
      const [subjects] = await connection.execute(
        `SELECT es.enrollment_subject_id, es.offering_id,
                es.status AS subject_status,
                e.enrollment_status
         FROM enrollment_subjects es
         JOIN enrollments e
           ON e.enrollment_id = es.enrollment_id
         WHERE es.enrollment_subject_id = ?
         FOR UPDATE`,
        [ids.enrollmentSubjectId],
      );

      if (
        subjects.length !== 1 ||
        Number(subjects[0].offering_id) !== ids.offeringId ||
        subjects[0].subject_status !== "Enrolled" ||
        subjects[0].enrollment_status !== "Approved"
      ) {
        previewFail(
          "COMBINED_RESUBMIT_ENROLLMENT_INVALID",
          "Approved active enrollment is required.",
        );
      }

      // Combined submission period
      const [periods] = await connection.execute(
        `SELECT period_id, department_id,
                academic_year_id, semester_id,
                period_status, submission_deadline_at
         FROM gradebook_submission_periods
         WHERE department_id = ?
           AND academic_year_id = ?
           AND semester_id = ?
         FOR UPDATE`,
        [
          offering.department_id,
          offering.academic_year_id,
          offering.semester_id,
        ],
      );

      if (periods.length !== 1 || periods[0].period_status !== "OPEN") {
        previewFail(
          "COMBINED_RESUBMIT_PERIOD_CLOSED",
          "The Program Head must open the combined semester submission window.",
        );
      }

      const period = periods[0];

      const [[window]] = await connection.execute(
        `SELECT
           (
             period_status = 'OPEN'
             AND (
               submission_deadline_at IS NULL
               OR NOW() <= submission_deadline_at
             )
           ) AS allowed
         FROM gradebook_submission_periods
         WHERE period_id = ?
         FOR UPDATE`,
        [period.period_id],
      );

      if (Number(window?.allowed) !== 1) {
        previewFail(
          "COMBINED_RESUBMIT_DEADLINE",
          "The combined semester submission deadline has passed.",
        );
      }

      // Existing returned grade
      const [grades] = await connection.execute(
        `SELECT grade_id, faculty_id, grade_status,
                grading_policy, grading_outcome,
                midterm_grade, final_grade,
                overall_percentage, final_rating,
                reviewed_by, review_remarks
         FROM grades
         WHERE enrollment_subject_id = ?
         FOR UPDATE`,
        [ids.enrollmentSubjectId],
      );

      const grade = grades[0];

      if (
        grades.length !== 1 ||
        grade.grade_status !== "Returned" ||
        grade.grading_policy !== "TWO_TERM_50_50" ||
        grade.grading_outcome !== "NUMERIC" ||
        Number(grade.faculty_id) !== Number(offering.faculty_id)
      ) {
        previewFail(
          "COMBINED_RESUBMIT_GRADE_INVALID",
          "An unchanged returned numeric grade is required.",
        );
      }

      // Official sheet
      const [sheets] = await connection.execute(
        `SELECT sheet_id, sheet_status,
                original_official_submitted_on,
                official_date_verified_at
         FROM gradebook_official_sheets
         WHERE config_id = ?
         FOR UPDATE`,
        [configId],
      );

      const sheet = sheets[0];

      if (
        sheets.length !== 1 ||
        sheet.sheet_status !== "IN_PROGRESS" ||
        sheet.original_official_submitted_on != null ||
        sheet.official_date_verified_at != null
      ) {
        previewFail(
          "COMBINED_RESUBMIT_SHEET_LOCKED",
          "The official sheet is no longer editable.",
        );
      }

      // Published grades require amendments
      const [publications] = await connection.execute(
        `SELECT publication_id
         FROM gradebook_official_grade_publications
         WHERE grade_id = ?
         FOR UPDATE`,
        [grade.grade_id],
      );

      if (publications.length) {
        previewFail(
          "COMBINED_RESUBMIT_PUBLISHED",
          "Published grades require an audited amendment.",
        );
      }

      // Preserve historical term submissions
      const [oldTerms] = await connection.execute(
        `SELECT term_submission_id
         FROM gradebook_term_submission_attempts
         WHERE config_id = ?
         LIMIT 1`,
        [configId],
      );

      const [oldLocks] = await connection.execute(
        `SELECT first_submission_id
         FROM gradebook_term_structure_locks
         WHERE config_id = ?
         LIMIT 1`,
        [configId],
      );

      if (oldTerms.length || oldLocks.length) {
        previewFail(
          "COMBINED_RESUBMIT_LEGACY_HISTORY",
          "Historical term submissions cannot be mixed with combined submissions.",
        );
      }

      // Shared assessment structure lock
      const [locks] = await connection.execute(
        `SELECT first_submission_id
         FROM gradebook_structure_locks
         WHERE config_id = ?
         FOR UPDATE`,
        [configId],
      );

      if (locks.length !== 1) {
        previewFail(
          "COMBINED_RESUBMIT_STRUCTURE_LOCK",
          "The original combined structure lock is missing.",
        );
      }

      const [first] = await connection.execute(
        `SELECT submission_id
         FROM gradebook_grade_submission_attempts
         WHERE submission_id = ?
           AND sheet_id = ?`,
        [locks[0].first_submission_id, sheet.sheet_id],
      );

      if (first.length !== 1) {
        previewFail(
          "COMBINED_RESUBMIT_STRUCTURE_HISTORY",
          "The original structure lock does not match this official sheet.",
        );
      }

      // Latest returned submission
      const [attempts] = await connection.execute(
        `SELECT *
         FROM gradebook_grade_submission_attempts
         WHERE grade_id = ?
         ORDER BY attempt_number DESC, submission_id DESC
         LIMIT 1
         FOR UPDATE`,
        [grade.grade_id],
      );

      const previous = attempts[0];

      if (
        attempts.length !== 1 ||
        String(previous.submission_id) !== String(oldSubmissionId) ||
        Number(previous.record_version) !== version ||
        previous.submission_status !== "RETURNED" ||
        previous.grading_scope !== "FULL_SEMESTER" ||
        previous.grading_outcome_snapshot !== "NUMERIC" ||
        previous.special_outcome_id != null ||
        Number(previous.period_id) !== Number(period.period_id) ||
        Number(previous.sheet_id) !== Number(sheet.sheet_id) ||
        Number(previous.submitted_by_user_id) !== ids.actorUserId ||
        !["MIDTERM", "FINAL_TERM", "BOTH"].includes(
          previous.returned_edit_scope,
        ) ||
        !previous.reviewed_by_user_id ||
        !previous.reviewed_at ||
        Number(grade.reviewed_by) !== Number(previous.reviewed_by_user_id) ||
        String(grade.review_remarks ?? "") !==
          String(previous.review_remarks ?? "")
      ) {
        previewFail(
          "COMBINED_RESUBMIT_STALE",
          "The latest returned submission or version does not match.",
        );
      }

      if (
        !Number.isSafeInteger(Number(previous.attempt_number)) ||
        Number(previous.attempt_number) < 1 ||
        Number(previous.attempt_number) >= 4294967295
      ) {
        previewFail(
          "COMBINED_RESUBMIT_ATTEMPT_INVALID",
          "The submission attempt number is invalid.",
        );
      }

      // Program Head return audit
      const [reviews] = await connection.execute(
        `SELECT review_decision, grading_outcome_snapshot,
                returned_edit_scope, reviewed_by_user_id,
                submission_version_after, review_notes
         FROM gradebook_grade_submission_reviews
         WHERE submission_id = ?
         FOR UPDATE`,
        [oldSubmissionId],
      );

      const review = reviews[0];

      if (
        reviews.length !== 1 ||
        review.review_decision !== "RETURNED" ||
        review.grading_outcome_snapshot !== "NUMERIC" ||
        review.returned_edit_scope !== previous.returned_edit_scope ||
        Number(review.reviewed_by_user_id) !==
          Number(previous.reviewed_by_user_id) ||
        Number(review.submission_version_after) !== version ||
        String(review.review_notes ?? "") !==
          String(previous.review_remarks ?? "")
      ) {
        previewFail(
          "COMBINED_RESUBMIT_AUDIT_MISMATCH",
          "The Program Head return and its audit record disagree.",
        );
      }

      // Previous calculation evidence
      let original;

      try {
        original =
          typeof previous.calculation_snapshot_json === "string"
            ? JSON.parse(previous.calculation_snapshot_json)
            : previous.calculation_snapshot_json;
      } catch {
        original = null;
      }

      const sameNum = (a, b) =>
        a != null && b != null && Number(a) === Number(b);

      if (
        !original ||
        original.policy !== "TWO_TERM_50_50" ||
        original.grading_scope !== "FULL_SEMESTER" ||
        Number(original.offering_id) !== ids.offeringId ||
        Number(original.config_id) !== configId ||
        Number(original.grade_id) !== Number(grade.grade_id) ||
        Number(original.enrollment_subject_id) !== ids.enrollmentSubjectId ||
        original.calculated_terms?.MIDTERM?.state !== "READY" ||
        original.calculated_terms?.FINAL_TERM?.state !== "READY" ||
        original.calculated_semester?.state !== "READY" ||
        !sameNum(grade.midterm_grade, previous.midterm_percentage_snapshot) ||
        !sameNum(grade.final_grade, previous.final_term_percentage_snapshot) ||
        !sameNum(
          grade.overall_percentage,
          previous.overall_percentage_snapshot,
        ) ||
        !sameNum(grade.final_rating, previous.final_rating_snapshot)
      ) {
        previewFail(
          "COMBINED_RESUBMIT_SOURCE_STALE",
          "The returned grade or original calculation evidence has changed.",
        );
      }

      const oldRatios = [
        [
          previous.midterm_exact_numerator,
          previous.midterm_exact_denominator,
          original.calculated_terms.MIDTERM.term_percentage,
        ],
        [
          previous.final_term_exact_numerator,
          previous.final_term_exact_denominator,
          original.calculated_terms.FINAL_TERM.term_percentage,
        ],
        [
          previous.overall_exact_numerator,
          previous.overall_exact_denominator,
          original.calculated_semester.semester_percentage,
        ],
      ];

      for (const [n, d, source] of oldRatios) {
        if (
          !/^(0|[1-9]\d*)$/.test(String(n ?? "")) ||
          !/^[1-9]\d*$/.test(String(d ?? "")) ||
          String(n) !== String(source?.exact_numerator) ||
          String(d) !== String(source?.exact_denominator)
        ) {
          previewFail(
            "COMBINED_RESUBMIT_ORIGINAL_RATIO_INVALID",
            "Original exact calculation evidence is inconsistent.",
          );
        }
      }

      // Recalculate both terms from current gradebook records
      const current = await calculateGradePreview(
        connection,
        ids.offeringId,
        ids.enrollmentSubjectId,
        ids.actorUserId,
      );

      if (
        Number(current.config_id) !== configId ||
        current.terms?.MIDTERM?.state !== "READY" ||
        current.terms?.FINAL_TERM?.state !== "READY" ||
        current.semester?.state !== "READY"
      ) {
        previewFail(
          "COMBINED_RESUBMIT_NOT_READY",
          "Both terms must be complete before resubmission.",
          422,
        );
      }

      // Prevent changes outside the returned scope
      const scope = previous.returned_edit_scope;

      const protectedTerms =
        scope === "MIDTERM"
          ? ["FINAL_TERM"]
          : scope === "FINAL_TERM"
            ? ["MIDTERM"]
            : [];

      for (const term of protectedTerms) {
        if (
          JSON.stringify(original.calculated_terms[term]) !==
          JSON.stringify(current.terms[term])
        ) {
          previewFail(
            "COMBINED_RESUBMIT_UNRETURNED_TERM_CHANGED",
            `The ${term} gradebook changed outside the return scope.`,
          );
        }
      }

      if (
        ["MIDTERM", "FINAL_TERM"].every(
          (term) =>
            JSON.stringify(original.calculated_terms[term]) ===
            JSON.stringify(current.terms[term]),
        )
      ) {
        previewFail(
          "COMBINED_RESUBMIT_NO_CHANGES",
          "No gradebook changes were detected after the return.",
        );
      }

      // Verify exact percentage calculations
      const mid = current.terms.MIDTERM.term_percentage;
      const fin = current.terms.FINAL_TERM.term_percentage;
      const overall = current.semester.semester_percentage;

      const validFraction = (value, maxLength) =>
        value &&
        /^(0|[1-9]\d*)$/.test(String(value.exact_numerator)) &&
        /^[1-9]\d*$/.test(String(value.exact_denominator)) &&
        String(value.exact_numerator).length <= maxLength &&
        String(value.exact_denominator).length <= maxLength;

      if (
        !validFraction(mid, 255) ||
        !validFraction(fin, 255) ||
        !validFraction(overall, 1200)
      ) {
        previewFail(
          "COMBINED_RESUBMIT_FRACTION_INVALID",
          "Calculated fractions are invalid.",
        );
      }

      const recomputed = fractionAdd(
        fractionTimes(
          fraction(BigInt(mid.exact_numerator), BigInt(mid.exact_denominator)),
          1n,
          2n,
        ),
        fractionTimes(
          fraction(BigInt(fin.exact_numerator), BigInt(fin.exact_denominator)),
          1n,
          2n,
        ),
      );

      if (
        recomputed.n.toString() !== overall.exact_numerator ||
        recomputed.d.toString() !== overall.exact_denominator
      ) {
        previewFail(
          "COMBINED_RESUBMIT_ARITHMETIC_MISMATCH",
          "The semester fraction is inconsistent with its terms.",
        );
      }

      // Return the existing grade to Submitted
      const [updated] = await connection.execute(
        `UPDATE grades
         SET midterm_grade = ?,
             final_grade = ?,
             grade_status = 'Submitted'
         WHERE grade_id = ?
           AND grade_status = 'Returned'
           AND grading_policy = 'TWO_TERM_50_50'
           AND grading_outcome = 'NUMERIC'`,
        [mid.decimal_preview, fin.decimal_preview, grade.grade_id],
      );

      if (Number(updated.affectedRows) !== 1) {
        previewFail(
          "COMBINED_RESUBMIT_GRADE_CONFLICT",
          "The returned grade was changed during resubmission.",
        );
      }

      // Verify the database trigger result
      const [[saved]] = await connection.execute(
        `SELECT grade_status, grading_policy, grading_outcome,
                midterm_grade, final_grade,
                overall_percentage, final_rating
         FROM grades
         WHERE grade_id = ?
         FOR UPDATE`,
        [grade.grade_id],
      );

      if (
        saved?.grade_status !== "Submitted" ||
        saved.grading_policy !== "TWO_TERM_50_50" ||
        saved.grading_outcome !== "NUMERIC" ||
        !sameNum(saved.midterm_grade, mid.decimal_preview) ||
        !sameNum(saved.final_grade, fin.decimal_preview) ||
        !sameNum(saved.overall_percentage, overall.decimal_preview) ||
        !sameNum(saved.final_rating, current.semester.numeric_equivalent)
      ) {
        previewFail(
          "COMBINED_RESUBMIT_TRIGGER_MISMATCH",
          "The database grade does not match the exact gradebook result.",
        );
      }

      // New immutable calculation snapshot
      const snapshot = JSON.stringify({
        policy: "TWO_TERM_50_50",
        grading_scope: "FULL_SEMESTER",
        offering_id: ids.offeringId,
        config_id: configId,
        enrollment_subject_id: ids.enrollmentSubjectId,
        grade_id: Number(grade.grade_id),
        student: current.student,
        classification: current.grading_classification,
        term_weights: current.term_weights,
        calculated_terms: {
          MIDTERM: current.terms.MIDTERM,
          FINAL_TERM: current.terms.FINAL_TERM,
        },
        calculated_semester: current.semester,
        preceding_submission_id: String(oldSubmissionId),
        preceding_return_scope: scope,
      });

      // New submission attempt; preserve the returned one
      const [inserted] = await connection.execute(
        `INSERT INTO gradebook_grade_submission_attempts
         (
           sheet_id,
           period_id,
           grade_id,
           attempt_number,
           submission_batch_ref,
           grading_scope,
           grading_outcome_snapshot,
           midterm_percentage_snapshot,
           final_term_percentage_snapshot,
           overall_percentage_snapshot,
           final_rating_snapshot,
           submission_status,
           submitted_by_user_id,
           record_version,
           calculation_snapshot_json,
           midterm_exact_numerator,
           midterm_exact_denominator,
           final_term_exact_numerator,
           final_term_exact_denominator,
           overall_exact_numerator,
           overall_exact_denominator
         )
         VALUES (
           ?, ?, ?, ?, ?,
           'FULL_SEMESTER',
           'NUMERIC',
           ?, ?, ?, ?,
           'SUBMITTED',
           ?, 1,
           ?, ?, ?, ?, ?, ?, ?
         )`,
        [
          sheet.sheet_id,
          period.period_id,
          grade.grade_id,
          Number(previous.attempt_number) + 1,
          randomUUID(),
          mid.decimal_preview,
          fin.decimal_preview,
          overall.decimal_preview,
          current.semester.numeric_equivalent,
          ids.actorUserId,
          snapshot,
          mid.exact_numerator,
          mid.exact_denominator,
          fin.exact_numerator,
          fin.exact_denominator,
          overall.exact_numerator,
          overall.exact_denominator,
        ],
      );

      if (Number(inserted.affectedRows) !== 1) {
        throw new Error("Combined semester resubmission was not saved.");
      }

      if (body.dry_run) {
        await connection.rollback();
      } else {
        await connection.commit();
      }

      transactionOpen = false;

      return res.status(body.dry_run ? 200 : 201).json({
        success: true,
        dry_run: body.dry_run,
        persisted: !body.dry_run,
        grade_id: Number(grade.grade_id),
        previous_submission_id: String(oldSubmissionId),
        submission_id: body.dry_run ? null : String(inserted.insertId),
        attempt_number: Number(previous.attempt_number) + 1,
        record_version: 1,
        status: "SUBMITTED",
        returned_scope: scope,
        official_grade_published: false,
        note: "Previous returned attempt and its review remain preserved. Awaiting Program Head review.",
      });
    } catch (error) {
      if (transactionOpen && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("COMBINED RESUBMIT ROLLBACK:", rollbackError);
        }
      }

      if (error?.code === "ER_DUP_ENTRY") {
        return sendError(res, {
          status: 409,
          code: "COMBINED_RESUBMIT_CONFLICT",
          message: "Another attempt was created. Reload the submission.",
        });
      }

      return sendError(res, error);
    } finally {
      connection?.release();
    }
  },
);
// Modern INC replacement-grade submission
router.post(
  "/:offeringId/students/:enrollmentSubjectId/modern-inc-completion-submissions",
  async (req, res) => {
    const ids = validatePreviewIdentifiers(req, res);
    if (!ids) return;
    if (Object.keys(req.query).length) {
      return sendError(res, {
        status: 400,
        code: "MODERN_INC_SUBMISSION_QUERY_UNSUPPORTED",
        message: "This endpoint does not accept query parameters.",
      });
    }
    let connection;
    let transactionOpen = false;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionOpen = true;
      const result = await submitModernIncCompletion(
        connection,
        ids,
        req.body,
        calculateGradePreview,
      );
      if (req.body.dry_run) await connection.rollback();
      else await connection.commit();
      transactionOpen = false;
      return res.status(req.body.dry_run ? 200 : 201).json(result);
    } catch (error) {
      if (transactionOpen && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("MODERN INC SUBMISSION ROLLBACK:", rollbackError);
        }
      }
      if (
        ["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(
          error?.code,
        )
      ) {
        return sendError(res, {
          status: 409,
          code: "MODERN_INC_SUBMISSION_CONFLICT",
          message: "Concurrent submission detected. Reload preview.",
        });
      }
      return sendError(res, error);
    } finally {
      connection?.release();
    }
  },
);
// Faculty: submit a proposed correction to an already approved combined semester grade.
router.post(
  "/:offeringId/students/:enrollmentSubjectId/modern-score-correction-requests",
  async (req, res) => {
    const ids = validatePreviewIdentifiers(req, res);
    if (!ids) return;
    if (Object.keys(req.query ?? {}).length) {
      return res.status(400).json({
        success: false,
        code: "MODERN_CORRECTION_QUERY_UNSUPPORTED",
        message: "Query parameters are not supported.",
      });
    }
    let connection = null;
    let transactionOpen = false;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionOpen = true;
      const result = await submitModernScoreCorrection(
        connection,
        ids,
        req.body,
      );
      if (req.body.dry_run) await connection.rollback();
      else await connection.commit();
      transactionOpen = false;
      return res.status(req.body.dry_run ? 200 : 201).json(result);
    } catch (error) {
      if (transactionOpen && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("MODERN SCORE CORRECTION ROLLBACK:", rollbackError);
          connection.destroy();
          connection = null;
        }
      }
      if (
        ["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(
          error?.code,
        )
      ) {
        return res.status(409).json({
          success: false,
          code: "MODERN_CORRECTION_CONCURRENT_CONFLICT",
          message: "Concurrent correction detected. Reload the approved score.",
        });
      }
      return sendError(res, error);
    } finally {
      if (connection) connection.release();
    }
  },
);
// Keep the existing numeric semester-submissions/:submissionId/resubmit route.
router.post(
  "/:offeringId/students/:enrollmentSubjectId/special-outcome-submissions/:submissionId/resubmit",
  async (req, res) => {
    const ids = validatePreviewIdentifiers(req, res);
    if (!ids) return;

    const submissionId = positiveId(req.params.submissionId);
    const body = req.body;
    if (
      !submissionId ||
      Object.keys(req.query ?? {}).length !== 0 ||
      !validateSpecialResubmissionBody(body)
    ) {
      return res.status(400).json({
        success: false,
        code: "SPECIAL_RESUBMIT_INPUT_INVALID",
        message:
          "Provide the latest returned submission ID/version, confirmed special-outcome evidence revision and boolean dry_run.",
      });
    }

    let connection;
    let transactionOpen = false;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionOpen = true;

      // Combined grading writes remain QA-only.
      await assertQaGradingDatabase(connection);

      const result = await resubmitSpecialOutcome(
        connection,
        {
          offeringId: ids.offeringId,
          enrollmentSubjectId: ids.enrollmentSubjectId,
          actorUserId: ids.actorUserId,
          submissionId,
          expectedVersion: Number(body.expected_record_version),
          special: body.special_outcome,
          dryRun: body.dry_run,
        },
        calculateGradePreview,
      );

      if (body.dry_run) await connection.rollback();
      else await connection.commit();
      transactionOpen = false;
      return res.status(body.dry_run ? 200 : 201).json(result);
    } catch (error) {
      if (transactionOpen && connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error("SPECIAL RESUBMIT ROLLBACK:", rollbackError);
        }
      }
      if (
        ["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(
          error?.code,
        )
      ) {
        return res.status(409).json({
          success: false,
          code: "SPECIAL_RESUBMIT_CONFLICT",
          message:
            "Concurrent changes detected. Reload the returned submission and evidence.",
        });
      }
      return sendError(res, error);
    } finally {
      connection?.release();
    }
  },
);
export default router;
