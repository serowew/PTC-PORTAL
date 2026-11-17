import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateModernIncExpiryEligibility as evaluate,
  oneYearIncDeadline,
} from "../services/gradebookModernIncExpiryPolicy.service.js";

const base = {
  sheet: {
    sheet_status: "FINALIZED",
    original_official_submitted_on: "2025-11-16",
    official_date_verified_by_user_id: 31,
  },
  grade: {
    grade_status: "Approved",
    grading_outcome: "INCOMPLETE",
    final_rating: "4.00",
  },
  enrollmentSubjectStatus: "Incomplete",
  today: "2026-11-17",
};
const check = (override = {}) => evaluate({ ...base, ...override });

const scenarios = [
  [
    "expiry after one year with no claim",
    {},
    true,
    "INC_EXPIRY_READY_FOR_REGISTRAR_REVIEW",
  ],
  [
    "retain on deadline day",
    { today: "2026-11-16" },
    false,
    "INC_EXPIRY_DEADLINE_NOT_PASSED",
  ],
  [
    "retain before deadline",
    { today: "2026-11-15" },
    false,
    "INC_EXPIRY_DEADLINE_NOT_PASSED",
  ],
  [
    "block pending verification",
    { claim: { verification_status: "PENDING_VERIFICATION" } },
    false,
    "INC_EXPIRY_CLAIM_PENDING",
  ],
  [
    "protect timely claim",
    {
      claim: {
        verification_status: "VERIFIED_TIMELY",
        verified_completed_on: "2026-11-15",
      },
    },
    false,
    "INC_EXPIRY_TIMELY_CLAIM_PROTECTED",
  ],
  [
    "allow verified late claim",
    {
      claim: {
        verification_status: "VERIFIED_LATE",
        verified_completed_on: "2026-11-17",
      },
    },
    true,
    "INC_EXPIRY_READY_FOR_REGISTRAR_REVIEW",
  ],
  [
    "block inconsistent late claim",
    {
      claim: {
        verification_status: "VERIFIED_LATE",
        verified_completed_on: "2026-11-15",
      },
    },
    false,
    "INC_EXPIRY_LATE_CLAIM_INCONSISTENT",
  ],
  [
    "allow rejected claim",
    { claim: { verification_status: "REJECTED" } },
    true,
    "INC_EXPIRY_READY_FOR_REGISTRAR_REVIEW",
  ],
  [
    "block unverified sheet",
    { sheet: { ...base.sheet, official_date_verified_by_user_id: null } },
    false,
    "INC_EXPIRY_OFFICIAL_SHEET_UNVERIFIED",
  ],
  [
    "block already converted 1.50",
    {
      grade: {
        ...base.grade,
        grading_outcome: "NUMERIC",
        final_rating: "1.50",
      },
      enrollmentSubjectStatus: "Completed",
    },
    false,
    "INC_EXPIRY_NOT_ACTIVE_INC",
  ],
  [
    "block modern submission pending reconciliation",
    {
      modernCompletionSubmission: {
        submission_id: "1",
        submission_status: "SUBMITTED",
      },
    },
    false,
    "INC_EXPIRY_COMPLETION_SUBMISSION_EXISTS",
  ],
  [
    "block unresolved correction",
    { hasUnresolvedCorrection: true },
    false,
    "INC_EXPIRY_CORRECTION_UNRESOLVED",
  ],
  [
    "block duplicate expiry",
    { hasExistingExpiryAction: true },
    false,
    "INC_EXPIRY_ALREADY_PROCESSED",
  ],
  [
    "block invalid date",
    { today: "2026-02-30" },
    false,
    "INC_EXPIRY_REFERENCE_DATE_INVALID",
  ],
];

for (const [name, overrides, expected, code] of scenarios) {
  test(name, () => {
    const result = check(overrides);
    assert.equal(result.eligible_for_registrar_expiry_review, expected);
    assert.equal(result.code, code);
    assert.equal(result.read_only, true);
    assert.equal(result.grade_conversion_performed, false);
  });
}

test("leap-year anniversary uses February 28 in nonleap year", () => {
  assert.equal(oneYearIncDeadline("2024-02-29"), "2025-02-28");
});
