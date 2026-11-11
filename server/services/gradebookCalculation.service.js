/**
 * PTC V1 gradebook calculator.
 *
 * Pure computation only: no database writes, no role checks, no publication.
 * The caller must load the official offering classification from the database.
 *
 * Input:
 * {
 *   grading_classification: 'PURE_LECTURE' | 'WITH_LABORATORY',
 *   terms: {
 *     MIDTERM: {
 *       assessments: [{ category_code, maximum_score, score_status,
 *                       earned_score, na_reason, record_status }],
 *       attendance: [{ meeting_status, attendance_status, na_reason }]
 *     },
 *     FINAL_TERM: { assessments: [...], attendance: [...] }
 *   }
 * }
 *
 * All score inputs have at most two decimal places. All percentage outputs
 * are strings with 12 decimal places; ratings use exact rational values
 * before formatting, so 74.9996 never becomes a passing 75.00.
 */

export const GRADEBOOK_POLICY = "TWO_TERM_50_50";
export const GRADEBOOK_POLICY_VERSION = "V1";

export const OFFICIAL_CATEGORY_WEIGHTS = Object.freeze({
  PURE_LECTURE: Object.freeze({
    MAJOR_EXAM: 30,
    QUIZ_SEATWORK_PROJECTS: 25,
    ASSIGNMENTS: 15,
    CLASS_PARTICIPATION: 15,
    ATTENDANCE: 15,
  }),
  WITH_LABORATORY: Object.freeze({
    MAJOR_EXAM: 30,
    LAB_EXAM: 20,
    LAB_ACTIVITIES: 15,
    QUIZ: 15,
    LECTURE_ACTIVITIES: 10,
    CLASS_PARTICIPATION: 5,
    ATTENDANCE: 5,
  }),
});

const TERMS = ["MIDTERM", "FINAL_TERM"];

const ATTENDANCE_STATUSES = new Set([
  "PENDING",
  "PRESENT",
  "LATE",
  "ABSENT",
  "EXCUSED",
  "NOT_APPLICABLE",
]);

const GRADE_BANDS = [
  [97, 1.0],
  [94, 1.25],
  [91, 1.5],
  [88, 1.75],
  [85, 2.0],
  [82, 2.25],
  [79, 2.5],
  [76, 2.75],
  [75, 3.0],
  [0, 5.0],
];

const OUTPUT_SCALE = 10n ** 12n;

function gcd(a, b) {
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }

  return a;
}

function fraction(numerator, denominator = 1n) {
  if (denominator <= 0n) {
    throw new Error("Invalid calculation denominator.");
  }

  const divisor = gcd(numerator, denominator);

  return {
    n: numerator / divisor,
    d: denominator / divisor,
  };
}

function add(a, b) {
  return fraction(a.n * b.d + b.n * a.d, a.d * b.d);
}

function multiply(a, numerator, denominator = 1n) {
  return fraction(a.n * numerator, a.d * denominator);
}

function toFixed12(value) {
  // Format only after the calculation is complete.
  const scaled = (value.n * OUTPUT_SCALE) / value.d;

  return (
    `${scaled / OUTPUT_SCALE}.` +
    String(scaled % OUTPUT_SCALE).padStart(12, "0")
  );
}

function parsePoints(value, label) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${label} must be a number with at most two decimals.`);
  }

  const text = String(value).trim();

  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) {
    throw new Error(`${label} must be nonnegative with at most two decimals.`);
  }

  const [whole, decimals = ""] = text.split(".");

  return BigInt(whole) * 100n + BigInt(decimals.padEnd(2, "0"));
}

function addIssue(issues, term, categoryCode, code) {
  issues.push({
    term,
    category_code: categoryCode,
    code,
  });
}

// Assessment calculations
function calculateAssessmentCategory(rows, term, code, weight, issues) {
  const applicable = rows.filter((row) => row.record_status !== "REMOVED");

  if (applicable.length === 0) {
    addIssue(issues, term, code, "NO_ASSESSMENTS");
    return null;
  }

  let earned = 0n;
  let maximum = 0n;
  let hasPending = false;
  let scoredCount = 0;

  for (const row of applicable) {
    const max = parsePoints(row.maximum_score, `${term} ${code} maximum_score`);

    if (max === 0n) {
      throw new Error(
        `${term} ${code} maximum_score must be greater than zero.`,
      );
    }

    const status = row.score_status ?? "PENDING";

    if (status === "PENDING") {
      if (row.earned_score != null) {
        throw new Error("PENDING score cannot have earned_score.");
      }

      hasPending = true;
    } else if (status === "NOT_APPLICABLE") {
      if (row.earned_score != null || !String(row.na_reason ?? "").trim()) {
        throw new Error(
          "NOT_APPLICABLE score needs a reason and no earned_score.",
        );
      }
    } else if (status === "SCORED") {
      const points = parsePoints(
        row.earned_score,
        `${term} ${code} earned_score`,
      );

      if (points > max) {
        throw new Error(`${term} ${code} earned_score exceeds maximum_score.`);
      }

      earned += points;
      maximum += max;
      scoredCount += 1;
    } else {
      throw new Error(`Invalid score status: ${status}.`);
    }
  }

  if (scoredCount === 0) {
    addIssue(issues, term, code, "NO_SCORED_BASIS");
  }

  if (hasPending) {
    addIssue(issues, term, code, "PENDING_SCORES");
  }

  if (scoredCount === 0 || hasPending) {
    return null;
  }

  return {
    contribution: multiply(fraction(earned, maximum), BigInt(weight)),
    earned_points: toFixed12(fraction(earned, 100n)),
    maximum_points: toFixed12(fraction(maximum, 100n)),
    scored_count: scoredCount,
  };
}

// Attendance calculations
function calculateAttendance(entries, term, weight, issues) {
  let present = 0n;
  let eligible = 0n;
  let pending = false;

  for (const row of entries) {
    if (!["HELD", "SCHEDULED", "CANCELLED"].includes(row.meeting_status)) {
      throw new Error(`Invalid meeting status: ${row.meeting_status}.`);
    }

    if (row.meeting_status !== "HELD") {
      continue;
    }

    const status = row.attendance_status ?? "PENDING";

    if (!ATTENDANCE_STATUSES.has(status)) {
      throw new Error(`Invalid attendance status: ${status}.`);
    }

    if (status === "PENDING") {
      pending = true;
    } else if (status === "PRESENT" || status === "LATE") {
      present += 1n;
      eligible += 1n;
    } else if (status === "ABSENT") {
      eligible += 1n;
    } else if (
      status === "NOT_APPLICABLE" &&
      !String(row.na_reason ?? "").trim()
    ) {
      throw new Error(
        "NOT_APPLICABLE attendance requires a documented reason.",
      );
    }

    // EXCUSED and N/A are excluded.
  }

  if (eligible === 0n) {
    addIssue(issues, term, "ATTENDANCE", "NO_VALID_ATTENDANCE");
  }

  if (pending) {
    addIssue(issues, term, "ATTENDANCE", "PENDING_ATTENDANCE");
  }

  if (eligible === 0n || pending) {
    return null;
  }

  return {
    contribution: multiply(fraction(present, eligible), BigInt(weight)),
    present_or_late: Number(present),
    eligible_meetings: Number(eligible),
  };
}

// Official numerical equivalent
function ratingForExactPercentage(value) {
  return GRADE_BANDS.find(
    ([threshold]) => value.n >= BigInt(threshold) * value.d,
  )[1];
}

/**
 * Calculates one student's grade for a subject offering.
 *
 * The backend must verify offering classification,
 * assessment ownership, and roster eligibility.
 */
export function calculateGradebookStudent(
  input,
  { requireComplete = false } = {},
) {
  const classification = input?.grading_classification;

  if (!Object.hasOwn(OFFICIAL_CATEGORY_WEIGHTS, classification)) {
    throw new Error("Invalid grading classification.");
  }

  const weights = OFFICIAL_CATEGORY_WEIGHTS[classification];

  const issues = [];
  const breakdown = {};
  const exactTerms = {};

  for (const term of TERMS) {
    const source = input.terms?.[term] ?? {};

    const assessments = source.assessments ?? [];
    const attendance = source.attendance ?? [];

    if (!Array.isArray(assessments) || !Array.isArray(attendance)) {
      throw new Error(`${term} assessments and attendance must be arrays.`);
    }

    for (const row of assessments) {
      if (
        !Object.hasOwn(weights, row.category_code) ||
        row.category_code === "ATTENDANCE"
      ) {
        throw new Error(`${term} contains an invalid assessment category.`);
      }
    }

    const categories = {};
    let total = fraction(0n);
    const issueStart = issues.length;

    for (const [code, weight] of Object.entries(weights)) {
      const result =
        code === "ATTENDANCE"
          ? calculateAttendance(attendance, term, weight, issues)
          : calculateAssessmentCategory(
              assessments.filter((row) => row.category_code === code),
              term,
              code,
              weight,
              issues,
            );

      categories[code] =
        result === null
          ? null
          : {
              weight_percent: weight,

              contribution_percent: toFixed12(result.contribution),

              ...(code === "ATTENDANCE"
                ? {
                    present_or_late: result.present_or_late,

                    eligible_meetings: result.eligible_meetings,
                  }
                : {
                    earned_points: result.earned_points,

                    maximum_points: result.maximum_points,

                    scored_count: result.scored_count,
                  }),
            };

      if (result) {
        total = add(total, result.contribution);
      }
    }

    const complete = issues.length === issueStart;

    exactTerms[term] = complete ? total : null;

    breakdown[term] = {
      complete,

      percentage: complete ? toFixed12(total) : null,

      categories,
    };
  }

  const ready = exactTerms.MIDTERM !== null && exactTerms.FINAL_TERM !== null;

  if (requireComplete && !ready) {
    const error = new Error(
      "Gradebook has missing required assessment or attendance results.",
    );

    error.code = "GRADEBOOK_NOT_READY";
    error.issues = issues;

    throw error;
  }

  const overall = ready
    ? multiply(add(exactTerms.MIDTERM, exactTerms.FINAL_TERM), 1n, 2n)
    : null;

  const rating = overall === null ? null : ratingForExactPercentage(overall);

  return {
    grading_policy: GRADEBOOK_POLICY,

    policy_version: GRADEBOOK_POLICY_VERSION,

    grading_classification: classification,

    midterm_percentage: breakdown.MIDTERM.percentage,

    final_term_percentage: breakdown.FINAL_TERM.percentage,

    overall_percentage: overall === null ? null : toFixed12(overall),

    final_rating: rating,

    remarks: rating === null ? null : rating === 5 ? "Failed" : "Passed",

    can_submit: ready,

    issues,

    breakdown,
  };
}
