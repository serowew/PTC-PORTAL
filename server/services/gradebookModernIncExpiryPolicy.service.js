const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function checkedDate(value) {
  if (typeof value !== "string") return null;
  const parts = DATE_PATTERN.exec(value);
  if (!parts) return null;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  if (year < 1900 || year > 9998 || month < 1 || month > 12) return null;
  const max = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > max) return null;
  return { year, month, day, iso: value };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

export function oneYearIncDeadline(verifiedOfficialDate) {
  const date = checkedDate(verifiedOfficialDate);
  if (!date) return null;
  const year = date.year + 1;
  const lastDay = new Date(Date.UTC(year, date.month, 0)).getUTCDate();
  const day = Math.min(date.day, lastDay);
  return `${year}-${pad(date.month)}-${pad(day)}`;
}

// Call this in the real endpoint; never take "as_of_date" from req.body/query.
export function ptcToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function decision(eligible, code, explanation, deadline, today) {
  return {
    eligible_for_registrar_expiry_review: eligible,
    code,
    explanation,
    deadline_on: deadline,
    evaluated_on: today,
    read_only: true,
    grade_conversion_performed: false,
  };
}

// This checks business eligibility, not database provenance or authorization.
// The caller must independently validate finalized roster, official-date audit,
// original publication and approval, claim-event audit, actor role, and locks.
export function evaluateModernIncExpiryEligibility({
  sheet,
  grade,
  enrollmentSubjectStatus,
  claim = null,
  modernCompletionSubmission = null,
  hasUnresolvedCorrection = false,
  hasExistingExpiryAction = false,
  today,
} = {}) {
  if (!checkedDate(today)) {
    return decision(
      false,
      "INC_EXPIRY_REFERENCE_DATE_INVALID",
      "The current Manila calendar date could not be verified.",
      null,
      today ?? null,
    );
  }

  if (
    sheet?.sheet_status !== "FINALIZED" ||
    !Number.isSafeInteger(Number(sheet?.official_date_verified_by_user_id)) ||
    Number(sheet?.official_date_verified_by_user_id) <= 0
  ) {
    return decision(
      false,
      "INC_EXPIRY_OFFICIAL_SHEET_UNVERIFIED",
      "A finalized sheet and official-date verification are required.",
      null,
      today,
    );
  }

  const officialDate = sheet?.original_official_submitted_on;
  const deadline = oneYearIncDeadline(officialDate);
  if (!deadline || officialDate > today) {
    return decision(
      false,
      "INC_EXPIRY_OFFICIAL_DATE_INVALID",
      "The official sheet date is missing, invalid, or in the future.",
      deadline,
      today,
    );
  }

  if (
    grade?.grade_status !== "Approved" ||
    grade?.grading_outcome !== "INCOMPLETE" ||
    Number(grade?.final_rating) !== 4 ||
    enrollmentSubjectStatus !== "Incomplete"
  ) {
    return decision(
      false,
      "INC_EXPIRY_NOT_ACTIVE_INC",
      "Only a current Approved INC 4.00 with Incomplete subject status can expire.",
      deadline,
      today,
    );
  }

  if (hasExistingExpiryAction) {
    return decision(
      false,
      "INC_EXPIRY_ALREADY_PROCESSED",
      "An existing expiry action prevents replay.",
      deadline,
      today,
    );
  }

  if (today <= deadline) {
    return decision(
      false,
      "INC_EXPIRY_DEADLINE_NOT_PASSED",
      "INC remains valid through its one-year deadline.",
      deadline,
      today,
    );
  }

  if (hasUnresolvedCorrection) {
    return decision(
      false,
      "INC_EXPIRY_CORRECTION_UNRESOLVED",
      "An unresolved correction must be reconciled before expiry.",
      deadline,
      today,
    );
  }

  if (modernCompletionSubmission) {
    return decision(
      false,
      "INC_EXPIRY_COMPLETION_SUBMISSION_EXISTS",
      "A modern completion submission requires reconciliation before expiry.",
      deadline,
      today,
    );
  }

  if (claim) {
    if (claim.verification_status === "PENDING_VERIFICATION") {
      return decision(
        false,
        "INC_EXPIRY_CLAIM_PENDING",
        "A pending completion claim must be reviewed first.",
        deadline,
        today,
      );
    }
    if (claim.verification_status === "VERIFIED_TIMELY") {
      return decision(
        false,
        "INC_EXPIRY_TIMELY_CLAIM_PROTECTED",
        "A verified timely completion stays protected even after the deadline.",
        deadline,
        today,
      );
    }
    if (claim.verification_status === "VERIFIED_LATE") {
      const completed = checkedDate(claim.verified_completed_on);
      if (!completed || completed.iso <= deadline) {
        return decision(
          false,
          "INC_EXPIRY_LATE_CLAIM_INCONSISTENT",
          "Late classification and verified completion date require review.",
          deadline,
          today,
        );
      }
    } else if (claim.verification_status !== "REJECTED") {
      return decision(
        false,
        "INC_EXPIRY_CLAIM_STATUS_UNRECOGNIZED",
        "Unknown completion claim status cannot authorize expiry.",
        deadline,
        today,
      );
    }
  }

  return decision(
    true,
    "INC_EXPIRY_READY_FOR_REGISTRAR_REVIEW",
    "Deadline passed without a protected or unresolved completion claim.",
    deadline,
    today,
  );
}
