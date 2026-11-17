import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { returnSpecialOutcomeSubmission } from "../services/gradebookSpecialOutcomeReturn.service.js";
import { resubmitSpecialOutcome } from "../services/gradebookSpecialOutcomeResubmission.service.js";
import { validateResubmittedSpecialApproval } from "../services/gradebookSpecialResubmissionApproval.service.js";
import { assertQaGradingDatabase } from "../services/gradebookQaWriteGuard.service.js";

// In-memory SQL adapter exercises the REAL service functions without writing
// fictional grades or attendance into the user's QA database.
const copy = structuredClone;
const reviewRemarks =
  "Return for stronger documentation of the recorded absences";
const reviewEvidence =
  "Clarify the academic attendance evidence and its supporting documentation";
const originalReason =
  "Verified absence evidence supporting the proposed unofficial drop";
const revisedReason =
  "Revised absence documentation for the proposed unofficial drop";
const originalEvidence =
  "Original instructor notes and documented meeting attendance records";
const revisedEvidence =
  "Revised instructor notes with an expanded review of attendance records";

function fixture() {
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
      recorded_at: "2026-11-01T15:00:00.000Z",
    },
  ];
  const snapshot = {
    policy: "TWO_TERM_50_50",
    grading_scope: "FULL_SEMESTER",
    offering_id: 187,
    config_id: 10,
    enrollment_subject_id: 341,
    grade_id: 700,
    student: { student_id: 265 },
    classification: "WITH_LABORATORY",
    term_weights: { MIDTERM: 50, FINAL_TERM: 50 },
    calculated_terms: {
      MIDTERM: { state: "NO_ASSESSMENTS" },
      FINAL_TERM: { state: "PENDING_SCORES" },
    },
    calculated_semester: { state: "PENDING" },
    grading_outcome: "UNOFFICIAL_DROP",
    special_outcome_id: 20,
    special_outcome: {
      outcome_type: "UNOFFICIAL_DROP",
      outcome_reason: originalReason,
      evidence_summary: originalEvidence,
      missing_requirements: null,
      pending_assessments: pending,
      attendance_entries: attendance,
      absent_meetings: 1,
    },
    official_result: {
      midterm_grade: null,
      final_grade: null,
      overall_percentage: null,
      final_rating: "6.00",
    },
  };
  const state = {
    target: {
      submission_id: 10,
      grade_id: 700,
      sheet_id: 800,
      period_id: 1,
      enrollment_subject_id: 341,
      offering_id: 187,
      config_id: 10,
    },
    offering: {
      offering_id: 187,
      offering_status: "Open",
      status: "Open",
      faculty_id: 6,
      academic_year_id: 6,
      semester_id: 1,
      department_id: 5,
      instructor_user_id: 32,
      is_active: 1,
      is_archived: 0,
      role_name: "Faculty",
    },
    config: {
      config_id: 10,
      offering_id: 187,
      midterm_percent: "50.00",
      final_term_percent: "50.00",
    },
    enrollment: {
      enrollment_subject_id: 341,
      offering_id: 187,
      subject_status: "Enrolled",
      enrollment_status: "Approved",
    },
    period: {
      period_id: 1,
      department_id: 5,
      academic_year_id: 6,
      semester_id: 1,
      period_status: "OPEN",
      submission_deadline_at: null,
    },
    grade: {
      grade_id: 700,
      enrollment_subject_id: 341,
      faculty_id: 6,
      grade_status: "Submitted",
      grading_policy: "TWO_TERM_50_50",
      grading_outcome: "UNOFFICIAL_DROP",
      outcome_reason: originalReason,
      final_rating: "6.00",
      remarks: "Unofficial Drop",
      midterm_grade: null,
      final_grade: null,
      overall_percentage: null,
      reviewed_by: null,
      reviewed_at: null,
      review_remarks: null,
    },
    sheet: {
      sheet_id: 800,
      config_id: 10,
      sheet_status: "IN_PROGRESS",
      original_official_submitted_on: null,
      official_date_verified_at: null,
    },
    attempts: [
      {
        submission_id: 10,
        sheet_id: 800,
        period_id: 1,
        grade_id: 700,
        special_outcome_id: 20,
        attempt_number: 1,
        submission_batch_ref: "00000000-0000-0000-0000-000000000001",
        grading_scope: "FULL_SEMESTER",
        grading_outcome_snapshot: "UNOFFICIAL_DROP",
        midterm_percentage_snapshot: null,
        final_term_percentage_snapshot: null,
        overall_percentage_snapshot: null,
        final_rating_snapshot: "6.00",
        special_outcome_reason_snapshot: originalReason,
        submission_status: "SUBMITTED",
        submitted_by_user_id: 32,
        record_version: 1,
        calculation_snapshot_json: copy(snapshot),
        midterm_exact_numerator: null,
        midterm_exact_denominator: null,
        final_term_exact_numerator: null,
        final_term_exact_denominator: null,
        overall_exact_numerator: null,
        overall_exact_denominator: null,
        returned_edit_scope: null,
        reviewed_by_user_id: null,
        reviewed_at: null,
        review_remarks: null,
      },
    ],
    outcome: {
      special_outcome_id: 20,
      grade_id: 700,
      outcome_type: "UNOFFICIAL_DROP",
      outcome_reason: originalReason,
      evidence_summary: originalEvidence,
      missing_requirements: null,
      record_status: "ACTIVE",
      record_version: 1,
      created_by_user_id: 32,
      updated_by_user_id: null,
    },
    events: [
      {
        event_id: 1,
        special_outcome_id: 20,
        event_type: "CREATED",
        previous_record_status: null,
        new_record_status: "ACTIVE",
        previous_outcome_type: null,
        new_outcome_type: "UNOFFICIAL_DROP",
        previous_outcome_reason: null,
        new_outcome_reason: originalReason,
        previous_missing_requirements: null,
        new_missing_requirements: null,
        previous_evidence_summary: null,
        new_evidence_summary: originalEvidence,
        event_reason: null,
        performed_by_user_id: 32,
        record_version_after: 1,
      },
    ],
    reviews: [],
    pending,
    attendance,
  };
  return state;
}

class SqlFixture {
  constructor(state = fixture()) {
    this.state = state;
    this.failOn = null;
    this.before = null;
  }
  async beginTransaction() {
    this.before = copy(this.state);
  }
  async rollback() {
    if (this.before) this.state = this.before;
    this.before = null;
  }
  async commit() {
    this.before = null;
  }
  async execute(sql, p = []) {
    if (this.failOn && sql.includes(this.failOn))
      throw new Error("Injected SQL write failure");
    const s = this.state;
    const trimmed = sql.replace(/\s+/g, " ").trim();
    const rows = (v) => [copy(Array.isArray(v) ? v : [v])];
    if (trimmed.startsWith("SELECT")) {
      if (trimmed.startsWith("SELECT DATABASE()")) {
        return rows({
          database_name: "databaseforptc1_admission_test",
        });
      }
      if (
        trimmed.includes("FROM gradebook_grade_submission_attempts a") &&
        trimmed.includes("JOIN grades g")
      )
        return rows(s.target);
      if (trimmed.includes("FROM subject_offerings so"))
        return rows(s.offering);
      if (trimmed.includes("FROM gradebook_offering_config"))
        return rows(s.config);
      if (
        trimmed.includes("FROM enrollment_subjects es") &&
        trimmed.includes("JOIN enrollments e")
      )
        return rows(s.enrollment);
      if (trimmed.includes("SELECT (period_status = 'OPEN'"))
        return rows({ allowed: 1 });
      if (trimmed.includes("FROM gradebook_submission_periods"))
        return rows(s.period);
      if (trimmed.includes("FROM grades")) return rows(s.grade);
      if (trimmed.includes("FROM gradebook_official_sheets"))
        return rows(s.sheet);
      if (trimmed.includes("FROM gradebook_official_grade_publications"))
        return rows([]);
      if (trimmed.includes("FROM gradebook_term_submission_attempts"))
        return rows([]);
      if (trimmed.includes("FROM gradebook_term_structure_locks"))
        return rows([]);
      if (trimmed.includes("FROM gradebook_structure_locks"))
        return rows({ first_submission_id: 10 });
      if (
        trimmed.includes("FROM gradebook_grade_submission_attempts") &&
        trimmed.includes("WHERE submission_id = ? AND sheet_id = ?")
      )
        return rows(
          s.attempts.filter(
            (x) =>
              String(x.submission_id) === String(p[0]) &&
              String(x.sheet_id) === String(p[1]),
          ),
        );
      if (
        trimmed.includes("FROM gradebook_grade_submission_attempts") &&
        trimmed.includes("ORDER BY attempt_number DESC")
      )
        return rows([s.attempts.at(-1)]);
      if (
        trimmed.includes("FROM gradebook_grade_submission_attempts") &&
        trimmed.includes("ORDER BY attempt_number, submission_id")
      )
        return rows(s.attempts);
      if (trimmed.includes("FROM gradebook_special_outcomes"))
        return rows(s.outcome);
      if (trimmed.includes("FROM gradebook_special_outcome_events"))
        return rows(s.events);
      if (trimmed.includes("FROM gradebook_grade_submission_reviews r"))
        return rows(s.reviews);
      if (trimmed.includes("FROM gradebook_grade_submission_reviews"))
        return rows(
          s.reviews.filter((x) => String(x.submission_id) === String(p[0])),
        );
      if (trimmed.includes("FROM gradebook_assessments a"))
        return rows(s.pending);
      if (trimmed.includes("FROM gradebook_attendance_meetings m"))
        return rows(s.attendance);
      throw new Error(`Unhandled select: ${trimmed.slice(0, 130)}`);
    }
    if (trimmed.startsWith("UPDATE gradebook_grade_submission_attempts")) {
      const old = s.attempts.find(
        (x) => String(x.submission_id) === String(p[3]),
      );
      if (
        !old ||
        old.submission_status !== "SUBMITTED" ||
        Number(old.record_version) !== Number(p[4])
      )
        return [{ affectedRows: 0 }];
      Object.assign(old, {
        submission_status: "RETURNED",
        returned_edit_scope: p[0],
        review_remarks: p[1],
        reviewed_by_user_id: p[2],
        reviewed_at: "2026-11-17 12:00:00",
        record_version: old.record_version + 1,
      });
      return [{ affectedRows: 1 }];
    }
    if (trimmed.startsWith("UPDATE gradebook_special_outcomes")) {
      const [reason, missing, evidence, actor, outcomeId, version] = p;
      if (
        String(s.outcome.special_outcome_id) !== String(outcomeId) ||
        s.outcome.record_version !== Number(version)
      )
        return [{ affectedRows: 0 }];
      Object.assign(s.outcome, {
        outcome_reason: reason,
        missing_requirements: missing,
        evidence_summary: evidence,
        updated_by_user_id: actor,
        record_version: version + 1,
      });
      return [{ affectedRows: 1 }];
    }
    if (trimmed.startsWith("UPDATE grades")) {
      if (trimmed.startsWith("UPDATE grades SET grade_status = 'Returned'")) {
        const [by, remarks, gradeId] = p;
        if (
          String(s.grade.grade_id) !== String(gradeId) ||
          s.grade.grade_status !== "Submitted"
        )
          return [{ affectedRows: 0 }];
        Object.assign(s.grade, {
          grade_status: "Returned",
          reviewed_by: by,
          review_remarks: remarks,
          reviewed_at: "2026-11-17 12:00:00",
        });
      } else if (trimmed.startsWith("UPDATE grades SET outcome_reason = ?")) {
        const [reason, gradeId, type] = p;
        if (
          String(s.grade.grade_id) !== String(gradeId) ||
          s.grade.grade_status !== "Returned" ||
          s.grade.grading_outcome !== type
        )
          return [{ affectedRows: 0 }];
        Object.assign(s.grade, {
          grade_status: "Submitted",
          outcome_reason: reason,
          reviewed_by: null,
          review_remarks: null,
          reviewed_at: null,
        });
      } else
        throw new Error(`Unhandled grade update: ${trimmed.slice(0, 100)}`);
      return [{ affectedRows: 1 }];
    }
    if (trimmed.startsWith("INSERT INTO gradebook_grade_submission_reviews")) {
      const [
        submissionId,
        type,
        remarks,
        scope,
        evidenceNotes,
        self,
        by,
        version,
      ] = p;
      s.reviews.push({
        review_id: 1,
        submission_id: submissionId,
        review_decision: "RETURNED",
        grading_outcome_snapshot: type,
        review_notes: remarks,
        returned_edit_scope: scope,
        evidence_review_notes: evidenceNotes,
        is_self_approval: self,
        reviewed_by_user_id: by,
        submission_version_after: version,
      });
      return [{ affectedRows: 1, insertId: 1 }];
    }
    if (trimmed.startsWith("INSERT INTO gradebook_special_outcome_events")) {
      const [
        oid,
        type1,
        type2,
        oldReason,
        nextReason,
        oldMissing,
        nextMissing,
        oldEvidence,
        nextEvidence,
        why,
        actor,
        version,
      ] = p;
      const event_id = 2;
      s.events.push({
        event_id,
        special_outcome_id: oid,
        event_type: "UPDATED",
        previous_record_status: "ACTIVE",
        new_record_status: "ACTIVE",
        previous_outcome_type: type1,
        new_outcome_type: type2,
        previous_outcome_reason: oldReason,
        new_outcome_reason: nextReason,
        previous_missing_requirements: oldMissing,
        new_missing_requirements: nextMissing,
        previous_evidence_summary: oldEvidence,
        new_evidence_summary: nextEvidence,
        event_reason: why,
        performed_by_user_id: actor,
        record_version_after: version,
      });
      return [{ affectedRows: 1, insertId: event_id }];
    }
    if (trimmed.startsWith("INSERT INTO gradebook_grade_submission_attempts")) {
      const [
        sheetId,
        periodId,
        gradeId,
        outcomeId,
        num,
        batch,
        type,
        mid,
        rating,
        reason,
        actor,
        snapshot,
        n,
        d,
      ] = p;
      const submission_id = 11;
      s.attempts.push({
        submission_id,
        sheet_id: sheetId,
        period_id: periodId,
        grade_id: gradeId,
        special_outcome_id: outcomeId,
        attempt_number: num,
        submission_batch_ref: batch,
        grading_scope: "FULL_SEMESTER",
        grading_outcome_snapshot: type,
        midterm_percentage_snapshot: mid,
        final_term_percentage_snapshot: null,
        overall_percentage_snapshot: null,
        final_rating_snapshot: rating,
        special_outcome_reason_snapshot: reason,
        submission_status: "SUBMITTED",
        submitted_by_user_id: actor,
        record_version: 1,
        calculation_snapshot_json: JSON.parse(snapshot),
        midterm_exact_numerator: n,
        midterm_exact_denominator: d,
        final_term_exact_numerator: null,
        final_term_exact_denominator: null,
        overall_exact_numerator: null,
        overall_exact_denominator: null,
        returned_edit_scope: null,
        reviewed_by_user_id: null,
        reviewed_at: null,
      });
      return [{ affectedRows: 1, insertId: submission_id }];
    }
    throw new Error(`Unhandled write: ${trimmed.slice(0, 130)}`);
  }
}
const inputs = {
  back: {
    submissionId: 10,
    expectedGradeId: 700,
    expectedVersion: 1,
    scope: "BOTH",
    reviewRemarks,
    evidenceNotes: reviewEvidence,
    actorUserId: 31,
    actorDepartmentId: 5,
    dryRun: false,
  },
  next: {
    offeringId: 187,
    enrollmentSubjectId: 341,
    submissionId: 10,
    expectedVersion: 2,
    actorUserId: 32,
    dryRun: false,
    special: {
      outcome_type: "UNOFFICIAL_DROP",
      outcome_reason: revisedReason,
      evidence_summary: revisedEvidence,
      missing_requirements: null,
    },
  },
};
const preview = (s) => async () => ({
  config_id: 10,
  terms: copy(s.attempts[0].calculation_snapshot_json.calculated_terms),
  semester: copy(s.attempts[0].calculation_snapshot_json.calculated_semester),
});
async function flow(db) {
  const before = copy(db.state);
  const back = await returnSpecialOutcomeSubmission(db, inputs.back);
  assert.equal(back.submission_status, "RETURNED");
  assert.equal(db.state.grade.grade_status, "Returned");
  const resubmitted = await resubmitSpecialOutcome(
    db,
    inputs.next,
    preview(db.state),
  );
  assert.equal(resubmitted.submission_status, "SUBMITTED");
  assert.equal(db.state.attempts.length, 2);
  assert.deepEqual(
    db.state.attempts[0].calculation_snapshot_json,
    before.attempts[0].calculation_snapshot_json,
  );
  assert.deepEqual(db.state.sheet, before.sheet);
  const target = { ...db.state.target };
  await validateResubmittedSpecialApproval(
    db,
    target,
    db.state.grade,
    db.state.attempts[1],
    db.state.attempts[1].calculation_snapshot_json,
    31,
    1,
  );
  return { back, resubmitted, target, before };
}

test("RETURN → evidence revision → RESUBMIT → Program Head approval readiness preserves original history", async () => {
  const db = new SqlFixture();
  const { target, before } = await flow(db);
  const latest = db.state.attempts[1];
  latest.submission_status = "APPROVED";
  latest.record_version = 2;
  latest.reviewed_by_user_id = 31;
  latest.reviewed_at = "2026-11-17 13:00:00";
  latest.review_remarks = "Evidence reviewed and approved";
  db.state.reviews.push({
    review_id: 2,
    submission_id: 11,
    review_decision: "APPROVED",
    grading_outcome_snapshot: "UNOFFICIAL_DROP",
    reviewed_by_user_id: 31,
    submission_version_after: 2,
  });
  await validateResubmittedSpecialApproval(
    db,
    target,
    db.state.grade,
    latest,
    latest.calculation_snapshot_json,
    31,
    2,
  );
  assert.equal(db.state.events.length, 2);
  assert.equal(db.state.reviews.length, 2);
  assert.equal(db.state.grade.outcome_reason, revisedReason);
  assert.equal(db.state.attempts[0].submission_status, "RETURNED");
  assert.equal(db.state.attempts[1].submission_status, "APPROVED");
  assert.deepEqual(db.state.sheet, before.sheet);
});

test("finalized grade cannot be returned or mutated", async () => {
  const db = new SqlFixture();
  db.state.sheet.sheet_status = "FINALIZED";
  db.state.grade.grade_status = "Approved";
  const old = copy(db.state);
  await assert.rejects(
    returnSpecialOutcomeSubmission(db, inputs.back),
    (e) => e.code === "SPECIAL_RETURN_FINALIZED_GRADE_PROTECTED",
  );
  assert.deepEqual(db.state, old);
});

test("unauthorized fixture cannot use the committed return operation", async () => {
  const db = new SqlFixture();
  const old = copy(db.state);
  await assert.rejects(
    returnSpecialOutcomeSubmission(db, { ...inputs.back, actorUserId: 999 }),
    (e) => e.code === "SPECIAL_RETURN_QA_FIXTURE_ONLY",
  );
  assert.deepEqual(db.state, old);
});

test("resubmission on failed INSERT rolls back all intermediate writes", async () => {
  const db = new SqlFixture();
  await returnSpecialOutcomeSubmission(db, inputs.back);
  await db.beginTransaction();
  const before = copy(db.state);
  db.failOn = "INSERT INTO gradebook_grade_submission_attempts";
  try {
    await resubmitSpecialOutcome(db, inputs.next, preview(db.state));
    assert.fail("Expected injected failure");
  } catch (e) {
    assert.match(e.message, /Injected SQL write failure/);
    await db.rollback();
  }
  assert.deepEqual(db.state, before);
});

test("tampering with a returned review blocks next-attempt approval", async () => {
  const db = new SqlFixture();
  const { target } = await flow(db);
  db.state.reviews[0].evidence_review_notes = "tampered";
  await assert.rejects(
    validateResubmittedSpecialApproval(
      db,
      target,
      db.state.grade,
      db.state.attempts[1],
      db.state.attempts[1].calculation_snapshot_json,
      31,
      1,
    ),
    (e) => e.code === "SPECIAL_APPROVAL_RETURN_AUDIT_INVALID",
  );
});

test("a returned submission cannot be resubmitted twice", async () => {
  const db = new SqlFixture();
  await flow(db);
  await assert.rejects(
    resubmitSpecialOutcome(db, inputs.next, preview(db.state)),
    (e) => e.code === "SPECIAL_RESUBMIT_NOT_RETURNED",
  );
  assert.equal(db.state.attempts.length, 2);
});

test("publication source keeps first-attempt validation and uses audited version-2 resubmission validation", () => {
  const source = readFileSync(
    new URL("../routes/programhead/index.js", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    '"/gradebook/semester-submissions/:submissionId/publish"',
  );
  assert.ok(start >= 0, "Combined official publication route was not found");
  const tail = source.slice(start);
  assert.match(tail, /if\s*\(Number\(submission\.attempt_number\)\s*>\s*1\)/);
  assert.match(
    tail,
    /await\s+validateResubmittedSpecialApproval\(\s*connection,\s*target,\s*grade,\s*submission,\s*snapshot,\s*userId,\s*2,?\s*\)/,
  );
  assert.match(tail, /else\s*\{\s*await\s+combinedApprovalSpecialEvidence\(/);
  assert.match(tail, /submission\.submission_status\s*!==\s*"APPROVED"/);
  assert.match(tail, /sheet\.sheet_status\s*!==\s*"IN_PROGRESS"/);
});
test("Non-QA databases cannot execute special-outcome writes", async () => {
  const connection = {
    execute: async () => [[{ database_name: "production_ptc" }]],
  };

  await assert.rejects(
    assertQaGradingDatabase(connection),
    (error) =>
      error.code === "GRADEBOOK_QA_DATABASE_ONLY" && error.status === 403,
  );
});
