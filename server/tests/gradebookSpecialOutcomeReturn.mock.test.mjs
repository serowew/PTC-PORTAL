// Project path: server/tests/gradebookSpecialOutcomeReturn.mock.test.mjs
// A synthetic in-memory test. No MySQL connection or official records are used.
import test from "node:test";
import assert from "node:assert/strict";
import { returnSpecialOutcomeSubmission } from "../services/gradebookSpecialOutcomeReturn.service.js";

test("unapproved UD can be returned while its original evidence and sheet stay untouched", async () => {
  const reason = "Documented prolonged absence and reviewed circumstances";
  const evidence =
    "Verified QA fixture: attendance evidence and case documents are present";
  const submissionId = 500;
  const gradeId = 600;
  const outcomeId = 900;
  const audit = [];
  const snapshot = {
    policy: "TWO_TERM_50_50",
    grading_scope: "FULL_SEMESTER",
    offering_id: 187,
    config_id: 10,
    enrollment_subject_id: 800,
    grade_id: gradeId,
    grading_outcome: "UNOFFICIAL_DROP",
    special_outcome_id: outcomeId,
    special_outcome: {
      outcome_reason: reason,
      evidence_summary: evidence,
      missing_requirements: null,
    },
  };

  const responses = [
    [
      {
        submission_id: submissionId,
        grade_id: gradeId,
        sheet_id: 700,
        period_id: 1,
        enrollment_subject_id: 800,
        offering_id: 187,
        config_id: 10,
      },
    ],
    [
      {
        offering_id: 187,
        offering_status: "Open",
        faculty_id: 6,
        academic_year_id: 6,
        semester_id: 1,
        department_id: 5,
        instructor_user_id: 32,
      },
    ],
    [{ config_id: 10, midterm_percent: "50.00", final_term_percent: "50.00" }],
    [
      {
        enrollment_subject_id: 800,
        offering_id: 187,
        subject_status: "Enrolled",
        enrollment_status: "Approved",
      },
    ],
    [{ period_id: 1, department_id: 5, academic_year_id: 6, semester_id: 1 }],
    [
      {
        grade_id: gradeId,
        enrollment_subject_id: 800,
        faculty_id: 6,
        grade_status: "Submitted",
        grading_policy: "TWO_TERM_50_50",
        grading_outcome: "UNOFFICIAL_DROP",
        outcome_reason: reason,
        final_rating: "6.00",
        remarks: "Unofficial Drop",
        midterm_grade: null,
        final_grade: null,
        overall_percentage: null,
      },
    ],
    [
      {
        sheet_id: 700,
        config_id: 10,
        sheet_status: "IN_PROGRESS",
        original_official_submitted_on: null,
        official_date_verified_at: null,
      },
    ],
    [], // no published grade
    [], // no legacy term submissions
    [{ first_submission_id: submissionId }],
    [
      {
        submission_id: submissionId,
        grade_id: gradeId,
        sheet_id: 700,
        period_id: 1,
        record_version: 1,
        submission_status: "SUBMITTED",
        grading_scope: "FULL_SEMESTER",
        returned_edit_scope: null,
        reviewed_by_user_id: null,
        reviewed_at: null,
        grading_outcome_snapshot: "UNOFFICIAL_DROP",
        final_rating_snapshot: "6.00",
        special_outcome_id: outcomeId,
        special_outcome_reason_snapshot: reason,
        submitted_by_user_id: 32,
        calculation_snapshot_json: JSON.stringify(snapshot),
      },
    ],
    [
      {
        special_outcome_id: outcomeId,
        grade_id: gradeId,
        outcome_type: "UNOFFICIAL_DROP",
        record_status: "ACTIVE",
        created_by_user_id: 32,
        outcome_reason: reason,
        evidence_summary: evidence,
        missing_requirements: null,
        record_version: 1,
      },
    ],
    [
      {
        event_type: "CREATED",
        new_record_status: "ACTIVE",
        new_outcome_type: "UNOFFICIAL_DROP",
        new_outcome_reason: reason,
        new_missing_requirements: null,
        new_evidence_summary: evidence,
        record_version_after: 1,
      },
    ],
    [], // no existing review
    { affectedRows: 1 }, // submission status update
    { affectedRows: 1 }, // grade status update
    { affectedRows: 1, insertId: 1234 }, // append review record
  ];

  let index = 0;
  const connection = {
    async execute(sql, params) {
      assert.ok(
        index < responses.length,
        `Unexpected SQL at call ${index}: ${sql}`,
      );
      audit.push({ sql: sql.trim(), params });
      return [responses[index++]];
    },
  };
  const result = await returnSpecialOutcomeSubmission(connection, {
    submissionId,
    expectedGradeId: gradeId,
    expectedVersion: 1,
    scope: "BOTH",
    reviewRemarks: "Return for documented special-outcome evidence review",
    evidenceNotes:
      "Provide an updated evidence summary with checked supporting documents",
    actorUserId: 31,
    actorDepartmentId: 5,
  });
  assert.equal(index, responses.length);
  assert.equal(result.success, true);
  assert.equal(result.submission_status, "RETURNED");
  assert.equal(result.grade_status, "Returned");
  assert.equal(result.record_version, 2);
  assert.equal(result.dry_run, true);
  assert.equal(result.persisted, false);
  assert.equal(result.original_special_evidence_unchanged, true);
  assert.equal(result.original_sheet_unchanged, true);
  const writes = audit.filter((item) =>
    /^\s*(UPDATE|INSERT|DELETE)\b/i.test(item.sql),
  );
  assert.equal(writes.length, 3);
  assert.ok(writes[0].sql.includes("gradebook_grade_submission_attempts"));
  assert.ok(writes[1].sql.includes("UPDATE grades"));
  assert.ok(writes[2].sql.includes("gradebook_grade_submission_reviews"));
  assert.ok(
    !writes.some((w) =>
      /gradebook_special_outcomes|gradebook_official_sheets/i.test(w.sql),
    ),
  );
});
