import test from "node:test";
import assert from "node:assert/strict";
import { validateResubmittedSpecialApproval } from "../services/gradebookSpecialResubmissionApproval.service.js";

function fixture({ approved = false } = {}) {
  const target = {
    offering_id: 187,
    config_id: 10,
    enrollment_subject_id: 341,
    grade_id: 700,
    sheet_id: 800,
    period_id: 1,
  };
  const grade = {
    grade_id: 700,
    grading_outcome: "UNOFFICIAL_DROP",
    final_rating: "6.00",
    remarks: "Unofficial Drop",
    midterm_grade: null,
    final_grade: null,
    overall_percentage: null,
    outcome_reason: "Revised documentation explaining absence",
  };
  const pending = [
    {
      assessment_id: 1,
      grading_term: "FINAL_TERM",
      header_name: "Exam",
      category_code: "MAJOR_EXAM",
      maximum_score: "100.00",
      score_id: null,
      record_version: null,
    },
  ];
  const attendance = [
    {
      meeting_id: 10,
      grading_term: "MIDTERM",
      meeting_date: "2026-11-01",
      attendance_status: "ABSENT",
      record_version: 1,
      recorded_by_user_id: 32,
      recorded_at: "2026-11-01 23:00:00",
    },
  ];
  const basic = {
    policy: "TWO_TERM_50_50",
    grading_scope: "FULL_SEMESTER",
    offering_id: 187,
    config_id: 10,
    enrollment_subject_id: 341,
    grade_id: 700,
    term_weights: { MIDTERM: 50, FINAL_TERM: 50 },
    calculated_terms: {
      MIDTERM: { state: "NO_ASSESSMENTS" },
      FINAL_TERM: { state: "PENDING_SCORES" },
    },
    calculated_semester: { state: "PENDING" },
    grading_outcome: "UNOFFICIAL_DROP",
    special_outcome_id: 20,
    official_result: {
      midterm_grade: null,
      final_grade: null,
      overall_percentage: null,
      final_rating: "6.00",
    },
  };
  const oldEvidence = {
    outcome_type: "UNOFFICIAL_DROP",
    outcome_reason: "Original documentation explaining absence",
    missing_requirements: null,
    evidence_summary: "Original supporting absence and attendance evidence",
    pending_assessments: pending,
    attendance_entries: attendance,
    absent_meetings: 1,
  };
  const newEvidence = {
    ...oldEvidence,
    outcome_reason: "Revised documentation explaining absence",
    evidence_summary: "Revised supporting absence and attendance evidence",
  };
  const original = { ...basic, special_outcome: oldEvidence };
  const revised = {
    ...basic,
    special_outcome: newEvidence,
    preceding_submission_id: "10",
    preceding_return_scope: "BOTH",
    special_evidence_version: 2,
  };
  const attempts = [];
  const common = {
    grade_id: 700,
    sheet_id: 800,
    period_id: 1,
    special_outcome_id: 20,
    grading_scope: "FULL_SEMESTER",
    grading_outcome_snapshot: "UNOFFICIAL_DROP",
    final_rating_snapshot: "6.00",
    submitted_by_user_id: 32,
    midterm_percentage_snapshot: null,
    final_term_percentage_snapshot: null,
    overall_percentage_snapshot: null,
    midterm_exact_numerator: null,
    midterm_exact_denominator: null,
    final_term_exact_numerator: null,
    final_term_exact_denominator: null,
    overall_exact_numerator: null,
    overall_exact_denominator: null,
  };
  attempts.push({
    ...common,
    submission_id: 10,
    attempt_number: 1,
    record_version: 2,
    submission_status: "RETURNED",
    returned_edit_scope: "BOTH",
    reviewed_by_user_id: 31,
    reviewed_at: "2026-11-17 01:00:00",
    review_remarks: "Return for clearer documentation",
    special_outcome_reason_snapshot: oldEvidence.outcome_reason,
    calculation_snapshot_json: original,
  });
  attempts.push({
    ...common,
    submission_id: 11,
    attempt_number: 2,
    record_version: approved ? 2 : 1,
    submission_status: approved ? "APPROVED" : "SUBMITTED",
    returned_edit_scope: null,
    reviewed_by_user_id: approved ? 31 : null,
    reviewed_at: approved ? "2026-11-17 02:00:00" : null,
    special_outcome_reason_snapshot: newEvidence.outcome_reason,
    calculation_snapshot_json: revised,
  });
  const events = [
    {
      special_outcome_id: 20,
      event_type: "CREATED",
      previous_record_status: null,
      new_record_status: "ACTIVE",
      previous_outcome_type: null,
      new_outcome_type: "UNOFFICIAL_DROP",
      previous_outcome_reason: null,
      new_outcome_reason: oldEvidence.outcome_reason,
      previous_missing_requirements: null,
      new_missing_requirements: null,
      previous_evidence_summary: null,
      new_evidence_summary: oldEvidence.evidence_summary,
      record_version_after: 1,
      performed_by_user_id: 32,
    },
    {
      special_outcome_id: 20,
      event_type: "UPDATED",
      previous_record_status: "ACTIVE",
      new_record_status: "ACTIVE",
      previous_outcome_type: "UNOFFICIAL_DROP",
      new_outcome_type: "UNOFFICIAL_DROP",
      previous_outcome_reason: oldEvidence.outcome_reason,
      new_outcome_reason: newEvidence.outcome_reason,
      previous_missing_requirements: null,
      new_missing_requirements: null,
      previous_evidence_summary: oldEvidence.evidence_summary,
      new_evidence_summary: newEvidence.evidence_summary,
      record_version_after: 2,
      performed_by_user_id: 32,
    },
  ];
  const reviews = [
    {
      submission_id: 10,
      review_decision: "RETURNED",
      grading_outcome_snapshot: "UNOFFICIAL_DROP",
      returned_edit_scope: "BOTH",
      reviewed_by_user_id: 31,
      submission_version_after: 2,
      review_notes: "Return for clearer documentation",
      evidence_review_notes:
        "Please supply sufficient documentation for the absence evidence",
    },
  ];
  if (approved)
    reviews.push({
      submission_id: 11,
      review_decision: "APPROVED",
      grading_outcome_snapshot: "UNOFFICIAL_DROP",
      reviewed_by_user_id: 31,
      submission_version_after: 2,
    });
  const outcome = {
    special_outcome_id: 20,
    grade_id: 700,
    outcome_type: "UNOFFICIAL_DROP",
    record_status: "ACTIVE",
    record_version: 2,
    created_by_user_id: 32,
    updated_by_user_id: 32,
    outcome_reason: newEvidence.outcome_reason,
    evidence_summary: newEvidence.evidence_summary,
    missing_requirements: null,
  };
  const db = {
    async execute(sql) {
      if (sql.includes("FROM gradebook_grade_submission_attempts\n"))
        return [attempts];
      if (sql.includes("FROM gradebook_special_outcomes")) return [[outcome]];
      if (sql.includes("FROM gradebook_special_outcome_events"))
        return [events];
      if (sql.includes("FROM gradebook_grade_submission_reviews r"))
        return [reviews];
      if (sql.includes("FROM gradebook_assessments a")) return [pending];
      if (sql.includes("FROM gradebook_attendance_meetings m"))
        return [attendance];
      throw new Error("Unexpected SQL " + sql.slice(0, 100));
    },
  };
  return {
    target,
    grade,
    attempts,
    events,
    reviews,
    outcome,
    pending,
    attendance,
    db,
    revised,
  };
}

const call = (f, version = 1) =>
  validateResubmittedSpecialApproval(
    f.db,
    f.target,
    f.grade,
    f.attempts[1],
    f.revised,
    31,
    version,
  );
test("approved validator accepts a valid resubmitted UD as version 1", async () =>
  assert.equal(await call(fixture()), undefined));
test("same evidence chain passes publication-stage version 2", async () =>
  assert.equal(await call(fixture({ approved: true }), 2), undefined));
test("rejects tampered evidence history", async () => {
  const f = fixture();
  f.events[1].previous_outcome_reason = "tampered";
  await assert.rejects(
    call(f),
    (e) => e.code === "SPECIAL_APPROVAL_REVISION_CHAIN_INVALID",
  );
});
test("rejects missing returned review", async () => {
  const f = fixture();
  f.reviews.length = 0;
  await assert.rejects(
    call(f),
    (e) => e.code === "SPECIAL_APPROVAL_REVIEW_HISTORY_INVALID",
  );
});
test("rejects modified current snapshot", async () => {
  const f = fixture();
  f.revised.preceding_submission_id = "999";
  await assert.rejects(
    call(f),
    (e) => e.code === "SPECIAL_APPROVAL_REVISION_CHAIN_INVALID",
  );
});
test("rejects offering that disagrees with submitted snapshot", async () => {
  const f = fixture();
  f.target.offering_id = 999;
  await assert.rejects(
    call(f),
    (e) => e.code === "SPECIAL_APPROVAL_SCOPE_INVALID",
  );
});
test("rejects absent attendance evidence", async () => {
  const f = fixture();
  f.attendance.length = 0;
  await assert.rejects(
    call(f),
    (e) => e.code === "SPECIAL_APPROVAL_LIVE_EVIDENCE_CHANGED",
  );
});

function incFixture() {
  const f = fixture();
  f.grade.grading_outcome = "INCOMPLETE";
  f.grade.final_rating = "4.00";
  f.grade.remarks = "Incomplete";
  f.grade.midterm_grade = "95.000000000000";
  f.outcome.outcome_type = "INCOMPLETE";
  f.outcome.missing_requirements = "Final exam and lab report still missing";
  for (const a of f.attempts) {
    a.grading_outcome_snapshot = "INCOMPLETE";
    a.final_rating_snapshot = "4.00";
    a.midterm_percentage_snapshot = "95.000000000000";
    a.midterm_exact_numerator = "95";
    a.midterm_exact_denominator = "1";
    const s = a.calculation_snapshot_json;
    s.grading_outcome = "INCOMPLETE";
    s.official_result.final_rating = "4.00";
    s.official_result.midterm_grade = "95.000000000000";
    s.calculated_terms.MIDTERM = {
      state: "READY",
      term_percentage: { exact_numerator: "95", exact_denominator: "1" },
    };
    s.special_outcome.outcome_type = "INCOMPLETE";
    s.special_outcome.missing_requirements =
      "Final exam and lab report still missing";
  }
  for (const e of f.events) {
    e.new_outcome_type = "INCOMPLETE";
    e.new_missing_requirements = "Final exam and lab report still missing";
    if (e.previous_outcome_type) e.previous_outcome_type = "INCOMPLETE";
    if (e.event_type === "UPDATED")
      e.previous_missing_requirements =
        "Final exam and lab report still missing";
  }
  for (const r of f.reviews) r.grading_outcome_snapshot = "INCOMPLETE";
  return f;
}
test("accepts INC resubmission with protected exact Midterm 95%", async () =>
  assert.equal(await call(incFixture()), undefined));
test("rejects tampered INC Midterm exact fraction", async () => {
  const f = incFixture();
  f.attempts[1].midterm_exact_numerator = "94";
  await assert.rejects(
    call(f),
    (e) => e.code === "SPECIAL_APPROVAL_MIDTERM_SOURCE_INVALID",
  );
});
