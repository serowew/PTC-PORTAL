import express from "express";
import { randomUUID } from "node:crypto";
import db from "../db.js";
import { loadGradebookOfferingConfig } from "../services/gradebookOfferingConfig.service.js";

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
async function calculateGradePreview(
  connection,
  offeringId,
  enrollmentSubjectId,
  actorUserId,
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
  if (
    student.enrollment_status !== "Approved" ||
    student.status !== "Enrolled"
  ) {
    previewFail(
      "GRADEBOOK_STUDENT_NOT_ELIGIBLE",
      "Only currently approved and enrolled students can receive a numeric grade preview.",
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
      const [databaseRows] = await connection.execute(
        "SELECT DATABASE() AS database_name",
      );
      if (databaseRows[0]?.database_name !== TERM_SUBMISSION_TEST_DB) {
        previewFail(
          "TEST_DATABASE_ONLY",
          "Term submission testing is permitted only in databaseforptc1_admission_test.",
          403,
        );
      }

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

export default router;
