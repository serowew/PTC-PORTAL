import { assertQaGradingDatabase } from "./gradebookQaWriteGuard.service.js";
const sameId = (a, b) =>
  a !== null &&
  b !== null &&
  a !== undefined &&
  b !== undefined &&
  String(a) === String(b);
function correctionFail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}
function jsonValue(raw) {
  try {
    if (Buffer.isBuffer(raw)) raw = raw.toString("utf8");
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}
function cents(value) {
  const raw = String(value ?? "").trim();
  if (!/^(0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
function decimal(c) {
  return `${c / 100n}.${String(c % 100n).padStart(2, "0")}`;
}
function numericEq(a, b, digits = 12) {
  return (
    a !== null &&
    a !== undefined &&
    b !== null &&
    b !== undefined &&
    Number.isFinite(Number(a)) &&
    Number.isFinite(Number(b)) &&
    Number(a).toFixed(digits) === Number(b).toFixed(digits)
  );
}
const textOk = (v, min, max) =>
  typeof v === "string" &&
  v.trim().length >= min &&
  v.trim().length <= max &&
  !/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(v);

export async function submitModernScoreCorrection(connection, ids, body) {
  const fields = [
    "expected_grade_id",
    "expected_assessment_id",
    "expected_score_id",
    "expected_score_version",
    "expected_combined_submission_id",
    "proposed_earned_score",
    "correction_reason",
    "evidence_summary",
    "dry_run",
  ];
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== fields.length ||
    Object.keys(body).some((key) => !fields.includes(key)) ||
    ![
      "expected_grade_id",
      "expected_assessment_id",
      "expected_score_id",
      "expected_score_version",
    ].every((key) => Number.isSafeInteger(body[key]) && body[key] > 0) ||
    typeof body.expected_combined_submission_id !== "string" ||
    !/^[1-9]\d{0,19}$/.test(body.expected_combined_submission_id) ||
    BigInt(body.expected_combined_submission_id) > 18446744073709551615n ||
    cents(body.proposed_earned_score) === null ||
    !textOk(body.correction_reason, 20, 1000) ||
    !textOk(body.evidence_summary, 20, 2000) ||
    typeof body.dry_run !== "boolean"
  ) {
    correctionFail(
      "MODERN_CORRECTION_BODY_INVALID",
      "Provide exact grade/assessment/score IDs, current score version, combined submission ID, proposed score, reason, evidence and dry_run.",
      400,
    );
  }

  const { offeringId, enrollmentSubjectId, actorUserId } = ids;
  if (
    ![offeringId, enrollmentSubjectId, actorUserId].every(
      (v) => Number.isSafeInteger(v) && v > 0,
    )
  )
    correctionFail(
      "MODERN_CORRECTION_ID_INVALID",
      "Positive identifiers are required.",
      400,
    );
  const [[database]] = await connection.execute("SELECT DATABASE() AS db_name");
  if (database?.db_name !== "databaseforptc1_admission_test")
    correctionFail(
      "MODERN_CORRECTION_QA_DATABASE_ONLY",
      "Correction pilot is limited to the admission-test database.",
      403,
    );
  if (
    offeringId !== 127 ||
    enrollmentSubjectId !== 274 ||
    actorUserId !== 32 ||
    body.expected_grade_id !== 123 ||
    body.expected_assessment_id !== 18 ||
    body.expected_score_id !== 27
  )
    correctionFail(
      "MODERN_CORRECTION_QA_SCOPE_ONLY",
      "Pilot is limited to Offering #127, ES #274, Grade #123, Final Major Exam #18 / Score #27.",
      403,
    );

  const [offerings] = await connection.execute(
    `SELECT so.offering_id, so.faculty_id, so.academic_year_id, so.semester_id, f.user_id,
            u.is_active, u.is_archived, r.role_name, co.department_id
       FROM subject_offerings so
       JOIN faculty f ON f.faculty_id = so.faculty_id
       JOIN users u ON u.user_id = f.user_id
       JOIN roles r ON r.role_id = u.role_id
       JOIN sections sec ON sec.section_id = so.section_id
       JOIN courses co ON co.course_id = sec.course_id
      WHERE so.offering_id = ? FOR UPDATE`,
    [offeringId],
  );
  const offering = offerings[0];
  if (
    offerings.length !== 1 ||
    !sameId(offering.user_id, actorUserId) ||
    Number(offering.is_active) !== 1 ||
    Number(offering.is_archived) !== 0 ||
    !["Faculty", "Program Head"].includes(offering.role_name)
  )
    correctionFail(
      "MODERN_CORRECTION_INSTRUCTOR_FORBIDDEN",
      "Only the active assigned instructor may request the correction.",
      403,
    );

  const [configs] = await connection.execute(
    `SELECT config_id, midterm_percent, final_term_percent
       FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE`,
    [offeringId],
  );
  const config = configs[0];
  if (
    configs.length !== 1 ||
    Number(config.midterm_percent) !== 50 ||
    Number(config.final_term_percent) !== 50
  )
    correctionFail(
      "MODERN_CORRECTION_CONFIG_INVALID",
      "The official 50/50 gradebook configuration is unavailable.",
    );

  const [enrollments] = await connection.execute(
    `SELECT es.enrollment_subject_id, es.status AS subject_status, e.student_id,
            e.enrollment_status, e.academic_year_id, e.semester_id
       FROM enrollment_subjects es JOIN enrollments e ON e.enrollment_id = es.enrollment_id
      WHERE es.enrollment_subject_id = ? AND es.offering_id = ? FOR UPDATE`,
    [enrollmentSubjectId, offeringId],
  );
  const enrollment = enrollments[0];
  if (
    enrollments.length !== 1 ||
    enrollment.enrollment_status !== "Approved" ||
    !["Completed", "Failed"].includes(enrollment.subject_status) ||
    !sameId(enrollment.academic_year_id, offering.academic_year_id) ||
    !sameId(enrollment.semester_id, offering.semester_id)
  )
    correctionFail(
      "MODERN_CORRECTION_ENROLLMENT_INVALID",
      "The approved enrollment source is inconsistent.",
    );

  const [grades] = await connection.execute(
    `SELECT grade_id, faculty_id, grade_status, grading_policy, grading_outcome,
            midterm_grade, final_grade, overall_percentage, final_rating, remarks,
            outcome_reason, reviewed_by, reviewed_at, submitted_at
       FROM grades WHERE enrollment_subject_id = ? FOR UPDATE`,
    [enrollmentSubjectId],
  );
  const grade = grades[0];
  if (
    grades.length !== 1 ||
    !sameId(grade.grade_id, body.expected_grade_id) ||
    !sameId(grade.faculty_id, offering.faculty_id) ||
    grade.grade_status !== "Approved" ||
    grade.grading_policy !== "TWO_TERM_50_50" ||
    grade.grading_outcome !== "NUMERIC" ||
    !grade.reviewed_at ||
    !grade.submitted_at ||
    !["Passed", "Failed"].includes(grade.remarks) ||
    ![
      grade.midterm_grade,
      grade.final_grade,
      grade.overall_percentage,
      grade.final_rating,
    ].every((value) => value !== null) ||
    grade.outcome_reason !== null ||
    (grade.remarks === "Passed"
      ? enrollment.subject_status !== "Completed"
      : enrollment.subject_status !== "Failed")
  )
    correctionFail(
      "MODERN_CORRECTION_OFFICIAL_GRADE_INVALID",
      "An unchanged approved numeric grade is required.",
    );

  const [sheets] = await connection.execute(
    `SELECT sheet_id, sheet_status, record_version, finalized_at, finalized_by_user_id,
            DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_official_submitted_on,
            official_date_verified_at, official_date_verified_by_user_id
       FROM gradebook_official_sheets WHERE config_id = ? FOR UPDATE`,
    [config.config_id],
  );
  const sheet = sheets[0];
  if (
    sheets.length !== 1 ||
    sheet.sheet_status !== "FINALIZED" ||
    !sheet.finalized_at ||
    !sheet.finalized_by_user_id ||
    !sheet.original_official_submitted_on ||
    !sheet.official_date_verified_at ||
    !sheet.official_date_verified_by_user_id
  )
    correctionFail(
      "MODERN_CORRECTION_SHEET_INVALID",
      "The finalized and date-verified official sheet is required.",
    );

  const [publications] = await connection.execute(
    `SELECT * FROM gradebook_official_grade_publications
      WHERE grade_id = ? FOR UPDATE`,
    [grade.grade_id],
  );
  const pub = publications[0];
  if (
    publications.length !== 1 ||
    pub.publication_source !== "COMBINED_SEMESTER" ||
    pub.grading_outcome_snapshot !== "NUMERIC" ||
    !sameId(pub.config_id, config.config_id) ||
    !sameId(pub.enrollment_subject_id, enrollmentSubjectId) ||
    !sameId(pub.grade_id, grade.grade_id) ||
    !sameId(pub.combined_submission_id, body.expected_combined_submission_id) ||
    !pub.published_at ||
    !pub.published_by_user_id ||
    [pub.midterm_submission_id, pub.final_term_submission_id].some(
      (x) => x !== null,
    )
  )
    correctionFail(
      "MODERN_CORRECTION_PUBLICATION_INVALID",
      "The published combined-semester source changed or is missing.",
    );

  const [attempts] = await connection.execute(
    `SELECT * FROM gradebook_grade_submission_attempts
      WHERE grade_id = ? ORDER BY attempt_number, submission_id FOR UPDATE`,
    [grade.grade_id],
  );
  const attempt = attempts.at(-1);
  if (
    !attempt ||
    !sameId(attempt.submission_id, pub.combined_submission_id) ||
    !sameId(attempt.sheet_id, sheet.sheet_id) ||
    attempt.grading_scope !== "FULL_SEMESTER" ||
    attempt.grading_outcome_snapshot !== "NUMERIC" ||
    attempt.submission_status !== "APPROVED" ||
    attempt.special_outcome_id !== null ||
    !sameId(attempt.submitted_by_user_id, actorUserId) ||
    !sameId(attempt.reviewed_by_user_id, pub.published_by_user_id) ||
    !attempt.reviewed_at ||
    Number(attempt.record_version) < 2 ||
    !numericEq(attempt.midterm_percentage_snapshot, grade.midterm_grade) ||
    !numericEq(attempt.final_term_percentage_snapshot, grade.final_grade) ||
    !numericEq(attempt.overall_percentage_snapshot, grade.overall_percentage) ||
    !numericEq(attempt.final_rating_snapshot, grade.final_rating, 2)
  )
    correctionFail(
      "MODERN_CORRECTION_SUBMISSION_INVALID",
      "The final approved combined submission does not match the current official grade.",
    );

  const [reviews] = await connection.execute(
    `SELECT review_id, review_decision, grading_outcome_snapshot, reviewed_by_user_id,
            submission_version_after, reviewed_at
       FROM gradebook_grade_submission_reviews WHERE submission_id = ? FOR UPDATE`,
    [attempt.submission_id],
  );
  const review = reviews[0];
  if (
    reviews.length !== 1 ||
    review.review_decision !== "APPROVED" ||
    review.grading_outcome_snapshot !== "NUMERIC" ||
    !sameId(review.reviewed_by_user_id, attempt.reviewed_by_user_id) ||
    Number(review.submission_version_after) !==
      Number(attempt.record_version) ||
    !review.reviewed_at
  )
    correctionFail(
      "MODERN_CORRECTION_REVIEW_INVALID",
      "Program Head approval evidence is inconsistent.",
    );

  const approvedSnapshot = jsonValue(attempt.calculation_snapshot_json);
  if (
    !approvedSnapshot ||
    approvedSnapshot.policy !== "TWO_TERM_50_50" ||
    approvedSnapshot.grading_scope !== "FULL_SEMESTER" ||
    !sameId(approvedSnapshot.config_id, config.config_id) ||
    !sameId(approvedSnapshot.offering_id, offeringId) ||
    !sameId(approvedSnapshot.grade_id, grade.grade_id) ||
    !sameId(approvedSnapshot.enrollment_subject_id, enrollmentSubjectId) ||
    approvedSnapshot.calculated_terms?.MIDTERM?.state !== "READY" ||
    approvedSnapshot.calculated_terms?.FINAL_TERM?.state !== "READY" ||
    approvedSnapshot.calculated_semester?.state !== "READY"
  )
    correctionFail(
      "MODERN_CORRECTION_CALCULATION_SNAPSHOT_INVALID",
      "The approved full-semester calculation snapshot is invalid.",
    );

  const [rosters] = await connection.execute(
    `SELECT roster_snapshot_id, grade_id, student_id, enrollment_subject_id,
            roster_disposition, grade_status_snapshot, grading_outcome_snapshot,
            midterm_grade_snapshot, final_grade_snapshot, overall_percentage_snapshot,
            final_rating_snapshot, grade_remarks_snapshot, enrollment_subject_status_snapshot
       FROM gradebook_finalized_roster
      WHERE sheet_id = ? AND enrollment_subject_id = ? FOR UPDATE`,
    [sheet.sheet_id, enrollmentSubjectId],
  );
  const roster = rosters[0];
  if (
    rosters.length !== 1 ||
    !sameId(roster.grade_id, grade.grade_id) ||
    !sameId(roster.student_id, enrollment.student_id) ||
    roster.roster_disposition !== "APPROVED_GRADE" ||
    roster.grade_status_snapshot !== "Approved" ||
    roster.grading_outcome_snapshot !== "NUMERIC" ||
    !numericEq(roster.midterm_grade_snapshot, grade.midterm_grade) ||
    !numericEq(roster.final_grade_snapshot, grade.final_grade) ||
    !numericEq(roster.overall_percentage_snapshot, grade.overall_percentage) ||
    !numericEq(roster.final_rating_snapshot, grade.final_rating, 2) ||
    roster.grade_remarks_snapshot !== grade.remarks ||
    roster.enrollment_subject_status_snapshot !== enrollment.subject_status
  )
    correctionFail(
      "MODERN_CORRECTION_ROSTER_INVALID",
      "The original finalized roster differs from the current approved grade.",
    );

  const [scoreRows] = await connection.execute(
    `SELECT sc.score_id, sc.assessment_id, sc.enrollment_subject_id, sc.score_status,
            sc.earned_score, sc.record_version AS score_version, sc.not_applicable_reason,
            a.grading_term, a.header_name, a.maximum_score, a.record_status,
            oc.config_id
       FROM gradebook_scores sc
       JOIN gradebook_assessments a ON a.assessment_id = sc.assessment_id
       JOIN gradebook_offering_categories oc ON oc.offering_category_id = a.offering_category_id
      WHERE sc.score_id = ? AND sc.enrollment_subject_id = ? FOR UPDATE`,
    [body.expected_score_id, enrollmentSubjectId],
  );
  const score = scoreRows[0];
  if (
    scoreRows.length !== 1 ||
    !sameId(score.assessment_id, body.expected_assessment_id) ||
    !sameId(score.config_id, config.config_id) ||
    score.record_status !== "ACTIVE" ||
    score.score_status !== "SCORED" ||
    score.not_applicable_reason !== null ||
    Number(score.score_version) !== body.expected_score_version ||
    cents(score.earned_score) === null ||
    cents(score.maximum_score) === null
  )
    correctionFail(
      "MODERN_CORRECTION_SCORE_STALE",
      "The assessment score changed; reload current score and version.",
    );
  const original = cents(score.earned_score);
  const proposed = cents(body.proposed_earned_score);
  const maximum = cents(score.maximum_score);
  if (original > maximum || proposed > maximum || original === proposed)
    correctionFail(
      "MODERN_CORRECTION_PROPOSAL_INVALID",
      "Proposed score must differ and stay within the assessment maximum.",
      400,
    );

  const approvedAssessments = (
    approvedSnapshot.calculated_terms?.[score.grading_term]?.categories ?? []
  )
    .flatMap((category) => category.assessments ?? [])
    .filter((assessment) =>
      sameId(assessment.assessment_id, score.assessment_id),
    );
  if (
    approvedAssessments.length !== 1 ||
    approvedAssessments[0].score_status !== "SCORED" ||
    cents(approvedAssessments[0].earned_score) !== original ||
    cents(approvedAssessments[0].maximum_score) !== maximum
  )
    correctionFail(
      "MODERN_CORRECTION_SCORE_SNAPSHOT_INVALID",
      "The score is not identical to its originally approved assessment snapshot.",
    );

  const [scoreEvents] = await connection.execute(
    `SELECT event_type, new_score_status, new_earned_score, score_version_after
       FROM gradebook_score_events WHERE score_id = ?
       ORDER BY score_version_after, event_id FOR UPDATE`,
    [score.score_id],
  );
  if (
    scoreEvents.length !== Number(score.score_version) ||
    scoreEvents.some(
      (event, index) => Number(event.score_version_after) !== index + 1,
    ) ||
    scoreEvents.at(-1)?.new_score_status !== "SCORED" ||
    cents(scoreEvents.at(-1)?.new_earned_score) !== original
  )
    correctionFail(
      "MODERN_CORRECTION_SCORE_AUDIT_INVALID",
      "The score audit history is inconsistent.",
    );

  const [older] = await connection.execute(
    `SELECT correction_id FROM gradebook_correction_requests
      WHERE grade_id = ? AND request_status IN ('SUBMITTED','RETURNED','APPROVED') FOR UPDATE`,
    [grade.grade_id],
  );
  const [changes] = await connection.execute(
    `SELECT grade_change_request_id FROM grade_change_requests
      WHERE grade_id = ? AND status IN ('Pending Program Head','For Registrar Processing','Returned') FOR UPDATE`,
    [grade.grade_id],
  );
  const [existing] = await connection.execute(
    `SELECT correction_id FROM gradebook_modern_score_corrections
      WHERE grade_id = ? FOR UPDATE`,
    [grade.grade_id],
  );
  const [amendments] = await connection.execute(
    `SELECT amendment_id FROM gradebook_sheet_amendments
      WHERE roster_snapshot_id = ? AND amendment_type IN ('GRADE_CORRECTION','INC_COMPLETION','INC_EXPIRY') FOR UPDATE`,
    [roster.roster_snapshot_id],
  );
  if (older.length || changes.length || existing.length || amendments.length)
    correctionFail(
      "MODERN_CORRECTION_REQUEST_CONFLICT",
      "A previous or active grade correction/amendment requires reconciliation.",
    );

  const proposalSnapshot = {
    correction_context: "MODERN_COMBINED_NUMERIC_SCORE_CORRECTION",
    offering_id: offeringId,
    config_id: Number(config.config_id),
    grade_id: Number(grade.grade_id),
    enrollment_subject_id: enrollmentSubjectId,
    student_id: Number(enrollment.student_id),
    source: {
      publication_id: String(pub.publication_id),
      combined_submission_id: String(attempt.submission_id),
      reviewed_by_user_id: Number(review.reviewed_by_user_id),
      sheet_id: String(sheet.sheet_id),
      sheet_record_version: Number(sheet.record_version),
      roster_snapshot_id: String(roster.roster_snapshot_id),
    },
    original_official_grade: {
      grade_status: grade.grade_status,
      grading_outcome: grade.grading_outcome,
      midterm_grade: String(grade.midterm_grade),
      final_grade: String(grade.final_grade),
      overall_percentage: String(grade.overall_percentage),
      final_rating: String(grade.final_rating),
      remarks: grade.remarks,
    },
    score: {
      assessment_id: Number(score.assessment_id),
      grading_term: score.grading_term,
      assessment_name: score.header_name,
      score_id: Number(score.score_id),
      score_version: Number(score.score_version),
      original_earned_score: decimal(original),
      proposed_earned_score: decimal(proposed),
      maximum_score: decimal(maximum),
    },
    correction_reason: body.correction_reason.trim(),
    evidence_summary: body.evidence_summary.trim(),
    approved_calculation_snapshot: approvedSnapshot,
  };
  const saved = JSON.stringify(proposalSnapshot);
  const [insert] = await connection.execute(
    `INSERT INTO gradebook_modern_score_corrections
       (grade_id,config_id,enrollment_subject_id,publication_id,combined_submission_id,
        sheet_id,roster_snapshot_id,assessment_id,score_id,score_version_at_request,
        original_earned_score,proposed_earned_score,maximum_score_snapshot,
        original_source_snapshot_json,correction_reason,evidence_summary,
        request_status,record_version,submitted_by_user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'SUBMITTED',1,?)`,
    [
      grade.grade_id,
      config.config_id,
      enrollmentSubjectId,
      pub.publication_id,
      attempt.submission_id,
      sheet.sheet_id,
      roster.roster_snapshot_id,
      score.assessment_id,
      score.score_id,
      score.score_version,
      decimal(original),
      decimal(proposed),
      decimal(maximum),
      saved,
      body.correction_reason.trim(),
      body.evidence_summary.trim(),
      actorUserId,
    ],
  );
  if (Number(insert.affectedRows) !== 1)
    throw new Error("Modern correction request was not inserted.");
  const [event] = await connection.execute(
    `INSERT INTO gradebook_modern_score_correction_events
      (correction_id,event_type,previous_status,new_status,proposal_snapshot_json,
       event_reason,performed_by_user_id,request_version_after)
     VALUES (?,'SUBMITTED',NULL,'SUBMITTED',?,?,?,1)`,
    [
      String(insert.insertId),
      saved,
      body.correction_reason.trim(),
      actorUserId,
    ],
  );
  if (Number(event.affectedRows) !== 1)
    throw new Error("Modern correction submission audit failed.");

  return {
    success: true,
    dry_run: body.dry_run,
    persisted: !body.dry_run,
    correction_context: proposalSnapshot.correction_context,
    offering_id: offeringId,
    enrollment_subject_id: enrollmentSubjectId,
    grade_id: Number(grade.grade_id),
    correction_id: body.dry_run ? null : String(insert.insertId),
    request_status: "SUBMITTED",
    record_version: 1,
    source: proposalSnapshot.source,
    score: proposalSnapshot.score,
    audit_event: "SUBMITTED",
    audit_event_id: body.dry_run ? null : String(event.insertId),
    official_grade_unchanged: true,
    assessment_score_unchanged: true,
    original_snapshot_unchanged: true,
    amendment_created: false,
    next_step:
      "Program Head review of the source-linked combined-semester correction request.",
  };
}

export async function reviewModernScoreCorrection(
  connection,
  actor,
  correctionId,
  body,
) {
  const fields = [
    "action",
    "expected_record_version",
    "expected_grade_id",
    "expected_score_version",
    "expected_sheet_version",
    "review_remarks",
    "confirm_review",
    "dry_run",
  ];
  const remarks =
    typeof body?.review_remarks === "string" ? body.review_remarks.trim() : "";
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== fields.length ||
    Object.keys(body).some((key) => !fields.includes(key)) ||
    !["APPROVE", "RETURN", "REJECT"].includes(body.action) ||
    ![
      "expected_record_version",
      "expected_grade_id",
      "expected_score_version",
      "expected_sheet_version",
    ].every(
      (key) =>
        Number.isSafeInteger(body[key]) &&
        body[key] > 0 &&
        body[key] < 4294967295,
    ) ||
    !textOk(remarks, 20, 1000) ||
    body.confirm_review !== true ||
    typeof body.dry_run !== "boolean"
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_BODY_INVALID",
      "Provide APPROVE/RETURN/REJECT, current request/grade/score/sheet versions, review notes, confirmation and dry_run.",
      400,
    );
  }
  if (
    typeof correctionId !== "string" ||
    !/^[1-9]\d{0,19}$/.test(correctionId) ||
    BigInt(correctionId) > 18446744073709551615n
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_ID_INVALID",
      "A positive correction ID is required.",
      400,
    );
  }
  const [[dbRow]] = await connection.execute("SELECT DATABASE() AS db_name");
  if (dbRow?.db_name !== "databaseforptc1_admission_test") {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_QA_DATABASE_ONLY",
      "Only the admission-test database is authorized.",
      403,
    );
  }
  // QA scope. Generalize after the combined-submission workflows are fully tested.
  if (
    Number(actor?.userId) !== 31 ||
    Number(actor?.departmentId) !== 5 ||
    body.expected_grade_id !== 123
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_FORBIDDEN",
      "The assigned QA Program Head is required.",
      403,
    );
  }

  // Read the immutable request locator before taking domain locks, then revalidate it under locks.
  const [pointers] = await connection.execute(
    `SELECT correction_id, grade_id, config_id, enrollment_subject_id, publication_id,
            combined_submission_id, sheet_id, roster_snapshot_id, score_id, assessment_id,
            submitted_by_user_id FROM gradebook_modern_score_corrections WHERE correction_id = ?`,
    [correctionId],
  );
  if (pointers.length !== 1) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_NOT_FOUND",
      "No modern correction request was found.",
      404,
    );
  }
  const pointer = pointers[0];
  if (
    !sameId(pointer.grade_id, 123) ||
    !sameId(pointer.enrollment_subject_id, 274)
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_QA_SCOPE_ONLY",
      "Request is outside the authorized pilot.",
      403,
    );
  }

  const [offerings] = await connection.execute(
    `SELECT so.offering_id, so.faculty_id, f.user_id AS instructor_user_id,
            u.is_active AS instructor_active, u.is_archived AS instructor_archived,
            cr.department_id
       FROM subject_offerings so
       JOIN faculty f ON f.faculty_id = so.faculty_id
       JOIN users u ON u.user_id = f.user_id
       JOIN sections sec ON sec.section_id = so.section_id
       JOIN courses cr ON cr.course_id = sec.course_id
      WHERE so.offering_id = 127 FOR UPDATE`,
  );
  const offering = offerings[0];
  if (
    offerings.length !== 1 ||
    !sameId(offering.department_id, actor.departmentId) ||
    !sameId(offering.instructor_user_id, pointer.submitted_by_user_id) ||
    Number(offering.instructor_active) !== 1 ||
    Number(offering.instructor_archived) !== 0
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_DEPARTMENT_INVALID",
      "The instructor or Program Head department no longer matches.",
      403,
    );
  }
  const [heads] = await connection.execute(
    `SELECT ph.program_head_id FROM program_heads ph
       JOIN faculty f ON f.faculty_id = ph.faculty_id
       JOIN users u ON u.user_id = f.user_id
       JOIN roles r ON r.role_id = u.role_id
      WHERE f.user_id = ? AND ph.department_id = ? AND ph.is_active = 1
        AND (ph.start_date IS NULL OR ph.start_date <= CURDATE())
        AND (ph.end_date IS NULL OR ph.end_date >= CURDATE())
        AND u.is_active = 1 AND u.is_archived = 0 AND r.role_name = 'Program Head'
      FOR UPDATE`,
    [actor.userId, actor.departmentId],
  );
  if (!heads.length)
    correctionFail(
      "MODERN_CORRECTION_REVIEW_HEAD_INACTIVE",
      "An active Program Head assignment is required.",
      403,
    );

  const [configs] = await connection.execute(
    `SELECT config_id, midterm_percent, final_term_percent
       FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE`,
    [offering.offering_id],
  );
  const config = configs[0];
  if (
    configs.length !== 1 ||
    !sameId(config.config_id, pointer.config_id) ||
    Number(config.midterm_percent) !== 50 ||
    Number(config.final_term_percent) !== 50
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_CONFIG_CHANGED",
      "The official grading configuration changed.",
    );
  }
  const [enrollments] = await connection.execute(
    `SELECT es.enrollment_subject_id, es.status AS subject_status, e.student_id,
            e.enrollment_status, e.academic_year_id, e.semester_id,
            so.academic_year_id AS offering_year_id, so.semester_id AS offering_semester_id
       FROM enrollment_subjects es
       JOIN enrollments e ON e.enrollment_id = es.enrollment_id
       JOIN subject_offerings so ON so.offering_id = es.offering_id
      WHERE es.enrollment_subject_id = ? AND es.offering_id = ? FOR UPDATE`,
    [pointer.enrollment_subject_id, offering.offering_id],
  );
  const enrollment = enrollments[0];
  if (
    enrollments.length !== 1 ||
    enrollment.enrollment_status !== "Approved" ||
    !["Completed", "Failed"].includes(enrollment.subject_status) ||
    !sameId(enrollment.academic_year_id, enrollment.offering_year_id) ||
    !sameId(enrollment.semester_id, enrollment.offering_semester_id)
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_ENROLLMENT_CHANGED",
      "The approved enrollment source changed.",
    );
  }
  const [grades] = await connection.execute(
    `SELECT grade_id, faculty_id, grade_status, grading_policy, grading_outcome,
            midterm_grade, final_grade, overall_percentage, final_rating,
            remarks, outcome_reason, reviewed_at, submitted_at
       FROM grades WHERE enrollment_subject_id = ? FOR UPDATE`,
    [pointer.enrollment_subject_id],
  );
  const grade = grades[0];
  if (
    grades.length !== 1 ||
    !sameId(grade.grade_id, body.expected_grade_id) ||
    !sameId(grade.faculty_id, offering.faculty_id) ||
    grade.grade_status !== "Approved" ||
    grade.grading_outcome !== "NUMERIC" ||
    grade.grading_policy !== "TWO_TERM_50_50" ||
    !grade.reviewed_at ||
    !grade.submitted_at ||
    grade.outcome_reason !== null
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_GRADE_CHANGED",
      "The approved official numeric grade is no longer a valid source.",
    );
  }
  const [sheets] = await connection.execute(
    `SELECT sheet_id, sheet_status, record_version, finalized_at,
            official_date_verified_at, official_date_verified_by_user_id
       FROM gradebook_official_sheets WHERE config_id = ? FOR UPDATE`,
    [config.config_id],
  );
  const sheet = sheets[0];
  if (
    sheets.length !== 1 ||
    !sameId(sheet.sheet_id, pointer.sheet_id) ||
    sheet.sheet_status !== "FINALIZED" ||
    !sheet.finalized_at ||
    !sheet.official_date_verified_at ||
    !sheet.official_date_verified_by_user_id ||
    Number(sheet.record_version) !== body.expected_sheet_version
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_SHEET_CHANGED",
      "The finalized official sheet or version changed.",
    );
  }
  const [publications] = await connection.execute(
    `SELECT publication_id, grade_id, config_id, enrollment_subject_id, publication_source,
            grading_outcome_snapshot, combined_submission_id, midterm_submission_id,
            final_term_submission_id, published_at, published_by_user_id
       FROM gradebook_official_grade_publications WHERE grade_id = ? FOR UPDATE`,
    [grade.grade_id],
  );
  const pub = publications[0];
  if (
    publications.length !== 1 ||
    !sameId(pub.publication_id, pointer.publication_id) ||
    !sameId(pub.config_id, config.config_id) ||
    !sameId(pub.enrollment_subject_id, pointer.enrollment_subject_id) ||
    pub.publication_source !== "COMBINED_SEMESTER" ||
    pub.grading_outcome_snapshot !== "NUMERIC" ||
    !sameId(pub.combined_submission_id, pointer.combined_submission_id) ||
    pub.midterm_submission_id !== null ||
    pub.final_term_submission_id !== null ||
    !pub.published_at
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_PUBLICATION_CHANGED",
      "The original combined official publication changed.",
    );
  }
  const [attempts] = await connection.execute(
    `SELECT submission_id, sheet_id, grade_id, grading_scope, grading_outcome_snapshot,
            submission_status, special_outcome_id, record_version,
            midterm_percentage_snapshot, final_term_percentage_snapshot,
            overall_percentage_snapshot, final_rating_snapshot,
            submitted_by_user_id, reviewed_by_user_id, reviewed_at, calculation_snapshot_json
       FROM gradebook_grade_submission_attempts WHERE grade_id = ?
       ORDER BY attempt_number, submission_id FOR UPDATE`,
    [grade.grade_id],
  );
  const attempt = attempts.at(-1);
  if (
    !attempt ||
    !sameId(attempt.submission_id, pointer.combined_submission_id) ||
    !sameId(attempt.sheet_id, sheet.sheet_id) ||
    attempt.grading_scope !== "FULL_SEMESTER" ||
    attempt.grading_outcome_snapshot !== "NUMERIC" ||
    attempt.submission_status !== "APPROVED" ||
    attempt.special_outcome_id !== null ||
    !attempt.reviewed_at ||
    Number(attempt.record_version) < 2 ||
    !sameId(attempt.submitted_by_user_id, pointer.submitted_by_user_id) ||
    !sameId(attempt.reviewed_by_user_id, pub.published_by_user_id) ||
    !numericEq(attempt.midterm_percentage_snapshot, grade.midterm_grade) ||
    !numericEq(attempt.final_term_percentage_snapshot, grade.final_grade) ||
    !numericEq(attempt.overall_percentage_snapshot, grade.overall_percentage) ||
    !numericEq(attempt.final_rating_snapshot, grade.final_rating, 2)
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_APPROVAL_CHANGED",
      "The combined semester approval source changed.",
    );
  }
  const [reviews] = await connection.execute(
    `SELECT review_id, review_decision, reviewed_by_user_id, grading_outcome_snapshot,
            submission_version_after, reviewed_at FROM gradebook_grade_submission_reviews
       WHERE submission_id = ? FOR UPDATE`,
    [attempt.submission_id],
  );
  if (
    reviews.length !== 1 ||
    reviews[0].review_decision !== "APPROVED" ||
    reviews[0].grading_outcome_snapshot !== "NUMERIC" ||
    !sameId(reviews[0].reviewed_by_user_id, attempt.reviewed_by_user_id) ||
    Number(reviews[0].submission_version_after) !==
      Number(attempt.record_version) ||
    !reviews[0].reviewed_at
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_APPROVAL_AUDIT_CHANGED",
      "The original Program Head approval source is inconsistent.",
    );
  }
  const [rosters] = await connection.execute(
    `SELECT roster_snapshot_id, grade_id, student_id, enrollment_subject_id,
            roster_disposition, grade_status_snapshot, grading_outcome_snapshot,
            midterm_grade_snapshot, final_grade_snapshot, overall_percentage_snapshot,
            final_rating_snapshot, grade_remarks_snapshot, enrollment_subject_status_snapshot
       FROM gradebook_finalized_roster
      WHERE sheet_id = ? AND enrollment_subject_id = ? FOR UPDATE`,
    [sheet.sheet_id, pointer.enrollment_subject_id],
  );
  const roster = rosters[0];
  if (
    rosters.length !== 1 ||
    !sameId(roster.roster_snapshot_id, pointer.roster_snapshot_id) ||
    !sameId(roster.grade_id, grade.grade_id) ||
    !sameId(roster.student_id, enrollment.student_id) ||
    roster.roster_disposition !== "APPROVED_GRADE" ||
    roster.grade_status_snapshot !== "Approved" ||
    roster.grading_outcome_snapshot !== "NUMERIC" ||
    !numericEq(roster.midterm_grade_snapshot, grade.midterm_grade) ||
    !numericEq(roster.final_grade_snapshot, grade.final_grade) ||
    !numericEq(roster.overall_percentage_snapshot, grade.overall_percentage) ||
    !numericEq(roster.final_rating_snapshot, grade.final_rating, 2) ||
    roster.grade_remarks_snapshot !== grade.remarks ||
    roster.enrollment_subject_status_snapshot !== enrollment.subject_status
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_ORIGINAL_ROSTER_CHANGED",
      "The immutable finalized roster is inconsistent with the official grade.",
    );
  }
  const [scoreRows] = await connection.execute(
    `SELECT sc.score_id, sc.assessment_id, sc.enrollment_subject_id, sc.score_status,
            sc.earned_score, sc.record_version, sc.not_applicable_reason,
            a.maximum_score, a.record_status, a.grading_term, a.header_name, oc.config_id
       FROM gradebook_scores sc
       JOIN gradebook_assessments a ON a.assessment_id = sc.assessment_id
       JOIN gradebook_offering_categories oc ON oc.offering_category_id = a.offering_category_id
      WHERE sc.score_id = ? AND sc.enrollment_subject_id = ? FOR UPDATE`,
    [pointer.score_id, pointer.enrollment_subject_id],
  );
  const score = scoreRows[0];
  if (
    scoreRows.length !== 1 ||
    !sameId(score.config_id, config.config_id) ||
    !sameId(score.assessment_id, pointer.assessment_id) ||
    score.record_status !== "ACTIVE" ||
    score.score_status !== "SCORED" ||
    score.not_applicable_reason !== null ||
    Number(score.record_version) !== body.expected_score_version ||
    cents(score.earned_score) === null ||
    cents(score.maximum_score) === null
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_SCORE_STALE",
      "The original score is no longer unchanged.",
    );
  }
  const [scoreEvents] = await connection.execute(
    `SELECT event_type, new_score_status, new_earned_score, score_version_after
       FROM gradebook_score_events WHERE score_id = ?
       ORDER BY score_version_after, event_id FOR UPDATE`,
    [score.score_id],
  );
  if (
    scoreEvents.length !== Number(score.record_version) ||
    scoreEvents.some(
      (event, i) => Number(event.score_version_after) !== i + 1,
    ) ||
    scoreEvents.at(-1)?.new_score_status !== "SCORED" ||
    cents(scoreEvents.at(-1)?.new_earned_score) !== cents(score.earned_score)
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_SCORE_AUDIT_INVALID",
      "The score audit history is inconsistent.",
    );
  }

  const [requests] = await connection.execute(
    `SELECT * FROM gradebook_modern_score_corrections
      WHERE correction_id = ? FOR UPDATE`,
    [correctionId],
  );
  const request = requests[0];
  if (
    requests.length !== 1 ||
    !sameId(request.grade_id, grade.grade_id) ||
    !sameId(request.config_id, config.config_id) ||
    !sameId(request.enrollment_subject_id, pointer.enrollment_subject_id) ||
    !sameId(request.publication_id, pub.publication_id) ||
    !sameId(request.combined_submission_id, attempt.submission_id) ||
    !sameId(request.sheet_id, sheet.sheet_id) ||
    !sameId(request.roster_snapshot_id, roster.roster_snapshot_id) ||
    !sameId(request.assessment_id, score.assessment_id) ||
    !sameId(request.score_id, score.score_id) ||
    !sameId(request.submitted_by_user_id, offering.instructor_user_id) ||
    !request.submitted_at ||
    request.request_status !== "SUBMITTED" ||
    Number(request.record_version) !== body.expected_record_version ||
    Number(request.score_version_at_request) !== Number(score.record_version) ||
    request.reviewed_by_user_id !== null ||
    request.reviewed_at !== null ||
    request.review_remarks !== null ||
    request.applied_by_user_id !== null ||
    request.applied_at !== null ||
    !textOk(request.correction_reason, 20, 1000) ||
    !textOk(request.evidence_summary, 20, 2000) ||
    cents(request.original_earned_score) !== cents(score.earned_score) ||
    cents(request.maximum_score_snapshot) !== cents(score.maximum_score) ||
    cents(request.proposed_earned_score) === null ||
    cents(request.proposed_earned_score) === cents(score.earned_score) ||
    cents(request.proposed_earned_score) > cents(score.maximum_score)
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_REQUEST_STALE",
      "The submitted correction, score, or approval changed.",
    );
  }
  const saved = jsonValue(request.original_source_snapshot_json);
  const approvedSnapshot = jsonValue(attempt.calculation_snapshot_json);
  const stable = (value) =>
    JSON.stringify(value, (_key, item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, item[key]]),
          )
        : item,
    );
  if (
    !saved ||
    saved.correction_context !== "MODERN_COMBINED_NUMERIC_SCORE_CORRECTION" ||
    !sameId(saved.grade_id, grade.grade_id) ||
    !sameId(saved.enrollment_subject_id, pointer.enrollment_subject_id) ||
    !sameId(saved.student_id, enrollment.student_id) ||
    !sameId(saved.config_id, config.config_id) ||
    !sameId(saved.offering_id, offering.offering_id) ||
    !sameId(saved.source?.publication_id, pub.publication_id) ||
    !sameId(saved.source?.combined_submission_id, attempt.submission_id) ||
    !sameId(saved.source?.roster_snapshot_id, roster.roster_snapshot_id) ||
    !sameId(saved.source?.sheet_id, sheet.sheet_id) ||
    Number(saved.source?.sheet_record_version) !==
      Number(sheet.record_version) ||
    !sameId(
      saved.source?.reviewed_by_user_id,
      reviews[0].reviewed_by_user_id,
    ) ||
    !sameId(saved.score?.assessment_id, score.assessment_id) ||
    !sameId(saved.score?.score_id, score.score_id) ||
    Number(saved.score?.score_version) !== Number(score.record_version) ||
    saved.score?.grading_term !== score.grading_term ||
    saved.score?.assessment_name !== score.header_name ||
    cents(saved.score?.original_earned_score) !== cents(score.earned_score) ||
    cents(saved.score?.proposed_earned_score) !==
      cents(request.proposed_earned_score) ||
    cents(saved.score?.maximum_score) !== cents(score.maximum_score) ||
    !numericEq(
      saved.original_official_grade?.midterm_grade,
      grade.midterm_grade,
    ) ||
    !numericEq(saved.original_official_grade?.final_grade, grade.final_grade) ||
    !numericEq(
      saved.original_official_grade?.overall_percentage,
      grade.overall_percentage,
    ) ||
    !numericEq(
      saved.original_official_grade?.final_rating,
      grade.final_rating,
      2,
    ) ||
    saved.original_official_grade?.grade_status !== "Approved" ||
    saved.original_official_grade?.grading_outcome !== "NUMERIC" ||
    saved.original_official_grade?.remarks !== grade.remarks ||
    saved.correction_reason !== request.correction_reason ||
    saved.evidence_summary !== request.evidence_summary ||
    !approvedSnapshot ||
    stable(saved.approved_calculation_snapshot) !== stable(approvedSnapshot)
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_SNAPSHOT_CHANGED",
      "Submitted evidence differs from approved calculation provenance.",
    );
  }
  const approvedAssessments = (
    approvedSnapshot.calculated_terms?.[score.grading_term]?.categories ?? []
  )
    .flatMap((category) => category.assessments ?? [])
    .filter((item) => sameId(item.assessment_id, score.assessment_id));
  if (
    approvedAssessments.length !== 1 ||
    approvedAssessments[0].score_status !== "SCORED" ||
    cents(approvedAssessments[0].earned_score) !== cents(score.earned_score) ||
    cents(approvedAssessments[0].maximum_score) !== cents(score.maximum_score)
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_ASSESSMENT_CHANGED",
      "The original approved assessment does not match its evidence.",
    );
  }
  const [events] = await connection.execute(
    `SELECT event_id, event_type, previous_status, new_status,
            proposal_snapshot_json, event_reason, performed_by_user_id, request_version_after
       FROM gradebook_modern_score_correction_events
      WHERE correction_id = ? ORDER BY request_version_after, event_id FOR UPDATE`,
    [correctionId],
  );
  if (
    events.length !== 1 ||
    events[0].event_type !== "SUBMITTED" ||
    events[0].previous_status !== null ||
    events[0].new_status !== "SUBMITTED" ||
    Number(events[0].request_version_after) !== 1 ||
    !sameId(events[0].performed_by_user_id, request.submitted_by_user_id) ||
    events[0].event_reason !== request.correction_reason ||
    stable(jsonValue(events[0].proposal_snapshot_json)) !== stable(saved)
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_AUDIT_INVALID",
      "Original Faculty request audit is incomplete.",
    );
  }
  const [otherCorrections] = await connection.execute(
    `SELECT correction_id FROM gradebook_modern_score_corrections
       WHERE grade_id = ? AND correction_id <> ?
         AND request_status IN ('SUBMITTED','RETURNED','APPROVED') FOR UPDATE`,
    [grade.grade_id, correctionId],
  );
  const [legacyCorrections] = await connection.execute(
    `SELECT correction_id FROM gradebook_correction_requests
       WHERE grade_id = ? AND request_status IN ('SUBMITTED','RETURNED','APPROVED') FOR UPDATE`,
    [grade.grade_id],
  );
  const [gradeChanges] = await connection.execute(
    `SELECT grade_change_request_id FROM grade_change_requests
       WHERE grade_id = ? AND status IN ('Pending Program Head','For Registrar Processing','Returned') FOR UPDATE`,
    [grade.grade_id],
  );
  const [amendments] = await connection.execute(
    `SELECT amendment_id FROM gradebook_sheet_amendments WHERE roster_snapshot_id = ?
       AND amendment_type IN ('GRADE_CORRECTION','INC_COMPLETION','INC_EXPIRY') FOR UPDATE`,
    [roster.roster_snapshot_id],
  );
  if (
    otherCorrections.length ||
    legacyCorrections.length ||
    gradeChanges.length ||
    amendments.length
  ) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_CONFLICT",
      "Another correction or amendment requires reconciliation.",
    );
  }
  const newStatus =
    body.action === "APPROVE"
      ? "APPROVED"
      : body.action === "RETURN"
        ? "RETURNED"
        : "REJECTED";
  const [updated] = await connection.execute(
    `UPDATE gradebook_modern_score_corrections
       SET request_status = ?, reviewed_by_user_id = ?, reviewed_at = NOW(6),
           review_remarks = ?, record_version = record_version + 1
     WHERE correction_id = ? AND request_status = 'SUBMITTED' AND record_version = ?`,
    [
      newStatus,
      actor.userId,
      remarks,
      correctionId,
      body.expected_record_version,
    ],
  );
  if (Number(updated.affectedRows) !== 1) {
    correctionFail(
      "MODERN_CORRECTION_REVIEW_VERSION_CONFLICT",
      "The correction was already reviewed or changed.",
    );
  }
  const nextVersion = body.expected_record_version + 1;
  const [audit] = await connection.execute(
    `INSERT INTO gradebook_modern_score_correction_events
       (correction_id,event_type,previous_status,new_status,proposal_snapshot_json,
        event_reason,performed_by_user_id,request_version_after)
     VALUES (?,?,'SUBMITTED',?,?,?,?,?)`,
    [
      correctionId,
      newStatus,
      newStatus,
      JSON.stringify(saved),
      remarks,
      actor.userId,
      nextVersion,
    ],
  );
  if (Number(audit.affectedRows) !== 1)
    throw new Error("Program Head modern correction audit could not be saved.");
  return {
    success: true,
    dry_run: body.dry_run,
    persisted: !body.dry_run,
    action: body.action,
    correction_context: saved.correction_context,
    correction_id: correctionId,
    grade_id: Number(grade.grade_id),
    offering_id: Number(offering.offering_id),
    enrollment_subject_id: Number(pointer.enrollment_subject_id),
    request_status: newStatus,
    record_version: nextVersion,
    reviewed_by_user_id: Number(actor.userId),
    score: saved.score,
    source: saved.source,
    audit_event: newStatus,
    audit_event_id: body.dry_run ? null : String(audit.insertId),
    assessment_score_unchanged: true,
    official_grade_unchanged: true,
    original_snapshot_unchanged: true,
    amendment_created: false,
    registrar_processing_enabled: false,
    next_step:
      body.action === "APPROVE"
        ? "Authorized for Registrar review; score and official grade remain unchanged."
        : body.action === "RETURN"
          ? "Faculty must revise and resubmit through a separate controlled action."
          : "Correction rejected; no grade changes permitted.",
  };
}

export async function processModernScoreCorrection(
  connection,
  registrarId,
  correctionId,
  body,
  calculateGradePreview,
) {
  const expectedKeys = [
    "expected_record_version",
    "expected_grade_id",
    "expected_score_version",
    "expected_sheet_version",
    "registrar_remarks",
    "confirm_correction",
    "dry_run",
  ];
  const remarks =
    typeof body?.registrar_remarks === "string"
      ? body.registrar_remarks.trim()
      : "";
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== expectedKeys.length ||
    Object.keys(body).some((k) => !expectedKeys.includes(k)) ||
    ![
      "expected_record_version",
      "expected_grade_id",
      "expected_score_version",
      "expected_sheet_version",
    ].every(
      (k) =>
        Number.isSafeInteger(body[k]) && body[k] > 0 && body[k] < 4294967295,
    ) ||
    !textOk(remarks, 20, 1000) ||
    body.confirm_correction !== true ||
    typeof body.dry_run !== "boolean"
  ) {
    correctionFail(
      "MODERN_CORRECTION_PROCESS_BODY_INVALID",
      "Expected current request/grade/score/sheet versions, remarks, confirmation and dry_run.",
      400,
    );
  }
  if (
    typeof correctionId !== "string" ||
    !/^[1-9]\d{0,19}$/.test(correctionId) ||
    BigInt(correctionId) > 18446744073709551615n
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_ID_INVALID",
      "Invalid modern correction ID.",
      400,
    );
  // Block writes outside QA and in production mode.
  await assertQaGradingDatabase(connection);

  if (registrarId !== 30) {
    correctionFail(
      "MODERN_CORRECTION_PROCESS_QA_ONLY",
      "Only authorized QA Registrar #30 is permitted.",
      403,
    );
  }
  const [registrars] = await connection.execute(
    `SELECT u.user_id FROM users u JOIN roles r ON r.role_id = u.role_id
      WHERE u.user_id = ? AND r.role_name = 'Registrar'
        AND u.is_active = 1 AND u.is_archived = 0 FOR UPDATE`,
    [registrarId],
  );
  if (registrars.length !== 1)
    correctionFail(
      "MODERN_CORRECTION_PROCESS_REGISTRAR_REQUIRED",
      "Active Registrar is required.",
      403,
    );

  // Discover immutable locator, then lock in offering -> config -> enrollment -> grade -> sheet -> score -> request order.
  const [locators] = await connection.execute(
    `SELECT correction_id, grade_id, config_id, enrollment_subject_id, publication_id,
       combined_submission_id, sheet_id, roster_snapshot_id, assessment_id, score_id
     FROM gradebook_modern_score_corrections WHERE correction_id = ?`,
    [correctionId],
  );
  if (locators.length !== 1)
    correctionFail(
      "MODERN_CORRECTION_PROCESS_NOT_FOUND",
      "No correction was found.",
      404,
    );
  const locator = locators[0];
  if (
    !sameId(locator.grade_id, 123) ||
    !sameId(locator.enrollment_subject_id, 274) ||
    !sameId(locator.assessment_id, 18) ||
    !sameId(locator.score_id, 27)
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_QA_SCOPE",
      "Outside the isolated correction pilot.",
      403,
    );

  const [offerings] = await connection.execute(
    `SELECT so.offering_id, so.faculty_id, so.academic_year_id, so.semester_id,
            f.user_id AS instructor_user_id, u.is_active, u.is_archived, r.role_name,
            co.department_id
       FROM subject_offerings so JOIN faculty f ON f.faculty_id = so.faculty_id
       JOIN users u ON u.user_id = f.user_id JOIN roles r ON r.role_id = u.role_id
       JOIN sections sec ON sec.section_id = so.section_id
       JOIN courses co ON co.course_id = sec.course_id
      WHERE so.offering_id = 127 FOR UPDATE`,
  );
  const offering = offerings[0];
  if (
    offerings.length !== 1 ||
    !sameId(offering.instructor_user_id, 32) ||
    !sameId(offering.department_id, 5) ||
    Number(offering.is_active) !== 1 ||
    Number(offering.is_archived) !== 0 ||
    !["Faculty", "Program Head"].includes(offering.role_name)
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_INSTRUCTOR_INVALID",
      "Original instructor or department is invalid.",
    );
  const [heads] = await connection.execute(
    `SELECT ph.program_head_id FROM program_heads ph JOIN faculty f ON f.faculty_id = ph.faculty_id
       JOIN users u ON u.user_id = f.user_id JOIN roles r ON r.role_id = u.role_id
      WHERE f.user_id = 31 AND ph.department_id = ? AND ph.is_active = 1
        AND (ph.start_date IS NULL OR ph.start_date <= CURDATE())
        AND (ph.end_date IS NULL OR ph.end_date >= CURDATE())
        AND u.is_active = 1 AND u.is_archived = 0 AND r.role_name = 'Program Head' FOR UPDATE`,
    [offering.department_id],
  );
  if (!heads.length)
    correctionFail(
      "MODERN_CORRECTION_PROCESS_REVIEWER_INVALID",
      "Approving Program Head assignment is inactive.",
    );
  const [configs] = await connection.execute(
    `SELECT config_id, midterm_percent, final_term_percent
       FROM gradebook_offering_config WHERE offering_id = ? FOR UPDATE`,
    [offering.offering_id],
  );
  const config = configs[0];
  if (
    configs.length !== 1 ||
    !sameId(config.config_id, locator.config_id) ||
    Number(config.midterm_percent) !== 50 ||
    Number(config.final_term_percent) !== 50
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_CONFIG_CHANGED",
      "Combined gradebook config changed.",
    );
  const [enrollments] = await connection.execute(
    `SELECT es.enrollment_subject_id, es.status AS subject_status, e.student_id,
            e.enrollment_status, e.academic_year_id, e.semester_id
       FROM enrollment_subjects es JOIN enrollments e ON e.enrollment_id = es.enrollment_id
      WHERE es.enrollment_subject_id = ? AND es.offering_id = ? FOR UPDATE`,
    [locator.enrollment_subject_id, offering.offering_id],
  );
  const enrollment = enrollments[0];
  if (
    enrollments.length !== 1 ||
    enrollment.enrollment_status !== "Approved" ||
    !["Completed", "Failed"].includes(enrollment.subject_status) ||
    !sameId(enrollment.academic_year_id, offering.academic_year_id) ||
    !sameId(enrollment.semester_id, offering.semester_id)
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_ENROLLMENT_CHANGED",
      "Original approved enrollment changed.",
    );
  const [grades] = await connection.execute(
    `SELECT * FROM grades WHERE enrollment_subject_id = ? FOR UPDATE`,
    [locator.enrollment_subject_id],
  );
  const grade = grades[0];
  if (
    grades.length !== 1 ||
    !sameId(grade.grade_id, locator.grade_id) ||
    !sameId(grade.grade_id, body.expected_grade_id) ||
    !sameId(grade.faculty_id, offering.faculty_id) ||
    grade.grade_status !== "Approved" ||
    grade.grading_policy !== "TWO_TERM_50_50" ||
    grade.grading_outcome !== "NUMERIC" ||
    grade.outcome_reason !== null ||
    !["Passed", "Failed"].includes(grade.remarks) ||
    !grade.reviewed_by ||
    !grade.reviewed_at ||
    !grade.submitted_at ||
    [
      grade.midterm_grade,
      grade.final_grade,
      grade.overall_percentage,
      grade.final_rating,
    ].some((v) => v === null) ||
    (grade.remarks === "Passed"
      ? enrollment.subject_status !== "Completed"
      : enrollment.subject_status !== "Failed")
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_GRADE_CHANGED",
      "An unchanged Approved numeric grade is required.",
    );
  const [sheets] = await connection.execute(
    `SELECT sheet_id, sheet_status, record_version, finalized_at, finalized_by_user_id,
       DATE_FORMAT(original_official_submitted_on,'%Y-%m-%d') AS original_date,
       official_date_verified_at, official_date_verified_by_user_id
      FROM gradebook_official_sheets WHERE config_id = ? FOR UPDATE`,
    [config.config_id],
  );
  const sheet = sheets[0];
  if (
    sheets.length !== 1 ||
    !sameId(sheet.sheet_id, locator.sheet_id) ||
    Number(sheet.record_version) !== body.expected_sheet_version ||
    sheet.sheet_status !== "FINALIZED" ||
    !sheet.finalized_at ||
    !sheet.finalized_by_user_id ||
    !sheet.original_date ||
    !sheet.official_date_verified_at ||
    !sheet.official_date_verified_by_user_id
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_SHEET_CHANGED",
      "Original finalized sheet changed.",
    );
  const [publications] = await connection.execute(
    `SELECT * FROM gradebook_official_grade_publications WHERE grade_id = ? FOR UPDATE`,
    [grade.grade_id],
  );
  const pub = publications[0];
  if (
    publications.length !== 1 ||
    !sameId(pub.publication_id, locator.publication_id) ||
    !sameId(pub.config_id, config.config_id) ||
    !sameId(pub.enrollment_subject_id, enrollment.enrollment_subject_id) ||
    pub.publication_source !== "COMBINED_SEMESTER" ||
    pub.grading_outcome_snapshot !== "NUMERIC" ||
    pub.midterm_submission_id !== null ||
    pub.final_term_submission_id !== null ||
    !sameId(pub.combined_submission_id, locator.combined_submission_id) ||
    !sameId(pub.published_by_user_id, 31) ||
    !pub.published_at
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_PUBLICATION_INVALID",
      "Published combined grade source is invalid.",
    );
  const [attempts] = await connection.execute(
    `SELECT * FROM gradebook_grade_submission_attempts WHERE grade_id = ?
      ORDER BY attempt_number, submission_id FOR UPDATE`,
    [grade.grade_id],
  );
  const attempt = attempts.at(-1);
  if (
    !attempt ||
    !sameId(attempt.submission_id, pub.combined_submission_id) ||
    !sameId(attempt.sheet_id, sheet.sheet_id) ||
    attempt.submission_status !== "APPROVED" ||
    attempt.grading_scope !== "FULL_SEMESTER" ||
    attempt.grading_outcome_snapshot !== "NUMERIC" ||
    attempt.special_outcome_id !== null ||
    attempt.returned_edit_scope !== null ||
    !sameId(attempt.submitted_by_user_id, 32) ||
    !sameId(attempt.reviewed_by_user_id, 31) ||
    !attempt.reviewed_at ||
    Number(attempt.record_version) < 2 ||
    !numericEq(attempt.midterm_percentage_snapshot, grade.midterm_grade) ||
    !numericEq(attempt.final_term_percentage_snapshot, grade.final_grade) ||
    !numericEq(attempt.overall_percentage_snapshot, grade.overall_percentage) ||
    !numericEq(attempt.final_rating_snapshot, grade.final_rating, 2)
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_SUBMISSION_CHANGED",
      "Original combined approval changed.",
    );
  const [reviews] = await connection.execute(
    `SELECT review_id, review_decision, grading_outcome_snapshot, reviewed_by_user_id,
       submission_version_after, reviewed_at FROM gradebook_grade_submission_reviews
       WHERE submission_id = ? FOR UPDATE`,
    [attempt.submission_id],
  );
  const review = reviews[0];
  if (
    reviews.length !== 1 ||
    review.review_decision !== "APPROVED" ||
    review.grading_outcome_snapshot !== "NUMERIC" ||
    !sameId(review.reviewed_by_user_id, 31) ||
    Number(review.submission_version_after) !==
      Number(attempt.record_version) ||
    !review.reviewed_at
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_SOURCE_REVIEW_INVALID",
      "Original Program Head grade review is invalid.",
    );
  const [rosters] = await connection.execute(
    `SELECT * FROM gradebook_finalized_roster
      WHERE sheet_id = ? AND enrollment_subject_id = ? FOR UPDATE`,
    [sheet.sheet_id, enrollment.enrollment_subject_id],
  );
  const roster = rosters[0];
  if (
    rosters.length !== 1 ||
    !sameId(roster.roster_snapshot_id, locator.roster_snapshot_id) ||
    !sameId(roster.grade_id, grade.grade_id) ||
    !sameId(roster.student_id, enrollment.student_id) ||
    roster.roster_disposition !== "APPROVED_GRADE" ||
    roster.grade_status_snapshot !== "Approved" ||
    roster.grading_outcome_snapshot !== "NUMERIC" ||
    !numericEq(roster.midterm_grade_snapshot, grade.midterm_grade) ||
    !numericEq(roster.final_grade_snapshot, grade.final_grade) ||
    !numericEq(roster.overall_percentage_snapshot, grade.overall_percentage) ||
    !numericEq(roster.final_rating_snapshot, grade.final_rating, 2) ||
    roster.grade_remarks_snapshot !== grade.remarks ||
    roster.enrollment_subject_status_snapshot !== enrollment.subject_status
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_ROSTER_INVALID",
      "Original finalized roster was changed.",
    );

  const [scores] = await connection.execute(
    `SELECT sc.score_id,sc.assessment_id,sc.enrollment_subject_id,sc.score_status,
       sc.earned_score,sc.record_version,sc.not_applicable_reason,
       a.maximum_score,a.record_status,a.grading_term,a.header_name,oc.config_id
       FROM gradebook_scores sc JOIN gradebook_assessments a ON a.assessment_id = sc.assessment_id
       JOIN gradebook_offering_categories oc ON oc.offering_category_id = a.offering_category_id
      WHERE sc.score_id = ? AND sc.enrollment_subject_id = ? FOR UPDATE`,
    [locator.score_id, locator.enrollment_subject_id],
  );
  const score = scores[0];
  if (
    scores.length !== 1 ||
    !sameId(score.config_id, config.config_id) ||
    !sameId(score.assessment_id, locator.assessment_id) ||
    score.record_status !== "ACTIVE" ||
    score.grading_term !== "FINAL_TERM" ||
    score.score_status !== "SCORED" ||
    score.not_applicable_reason !== null ||
    Number(score.record_version) !== body.expected_score_version ||
    cents(score.earned_score) === null ||
    cents(score.maximum_score) === null
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_SCORE_STALE",
      "Assessment score changed after approval.",
    );
  const [scoreEvents] = await connection.execute(
    `SELECT event_id,event_type,change_context,new_score_status,new_earned_score,score_version_after
       FROM gradebook_score_events WHERE score_id = ? ORDER BY score_version_after,event_id FOR UPDATE`,
    [score.score_id],
  );
  if (
    scoreEvents.length !== Number(score.record_version) ||
    scoreEvents.some((e, i) => Number(e.score_version_after) !== i + 1) ||
    scoreEvents.at(-1)?.new_score_status !== "SCORED" ||
    cents(scoreEvents.at(-1)?.new_earned_score) !== cents(score.earned_score)
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_SCORE_AUDIT_INVALID",
      "Original score audit is inconsistent.",
    );
  const [requests] = await connection.execute(
    `SELECT * FROM gradebook_modern_score_corrections WHERE correction_id = ? FOR UPDATE`,
    [correctionId],
  );
  const request = requests[0];
  if (
    requests.length !== 1 ||
    !sameId(request.grade_id, grade.grade_id) ||
    !sameId(request.config_id, config.config_id) ||
    !sameId(request.enrollment_subject_id, enrollment.enrollment_subject_id) ||
    !sameId(request.publication_id, pub.publication_id) ||
    !sameId(request.combined_submission_id, attempt.submission_id) ||
    !sameId(request.sheet_id, sheet.sheet_id) ||
    !sameId(request.roster_snapshot_id, roster.roster_snapshot_id) ||
    !sameId(request.assessment_id, score.assessment_id) ||
    !sameId(request.score_id, score.score_id) ||
    request.request_status !== "APPROVED" ||
    Number(request.record_version) !== body.expected_record_version ||
    Number(request.score_version_at_request) !== body.expected_score_version ||
    !sameId(request.submitted_by_user_id, offering.instructor_user_id) ||
    !sameId(request.reviewed_by_user_id, 31) ||
    !request.submitted_at ||
    !request.reviewed_at ||
    !textOk(request.review_remarks, 20, 1000) ||
    !textOk(request.correction_reason, 20, 1000) ||
    !textOk(request.evidence_summary, 20, 2000) ||
    request.applied_by_user_id !== null ||
    request.applied_at !== null ||
    cents(request.original_earned_score) !== cents(score.earned_score) ||
    cents(request.maximum_score_snapshot) !== cents(score.maximum_score) ||
    cents(request.proposed_earned_score) === null ||
    cents(request.proposed_earned_score) === cents(score.earned_score) ||
    cents(request.proposed_earned_score) > cents(score.maximum_score)
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_APPROVAL_CHANGED",
      "Program Head-approved correction is stale or invalid.",
    );
  const saved = jsonValue(request.original_source_snapshot_json);
  const originalCalculated = jsonValue(attempt.calculation_snapshot_json);
  const canonical = (v) =>
    JSON.stringify(v, (_key, item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((k) => [k, item[k]]),
          )
        : item,
    );
  if (
    !saved ||
    saved.correction_context !== "MODERN_COMBINED_NUMERIC_SCORE_CORRECTION" ||
    !sameId(saved.grade_id, grade.grade_id) ||
    !sameId(saved.config_id, config.config_id) ||
    !sameId(saved.offering_id, offering.offering_id) ||
    !sameId(saved.enrollment_subject_id, enrollment.enrollment_subject_id) ||
    !sameId(saved.student_id, enrollment.student_id) ||
    !sameId(saved.source?.publication_id, pub.publication_id) ||
    !sameId(saved.source?.combined_submission_id, attempt.submission_id) ||
    !sameId(saved.source?.sheet_id, sheet.sheet_id) ||
    Number(saved.source?.sheet_record_version) !==
      Number(sheet.record_version) ||
    !sameId(saved.source?.roster_snapshot_id, roster.roster_snapshot_id) ||
    !sameId(saved.source?.reviewed_by_user_id, 31) ||
    !sameId(saved.score?.assessment_id, score.assessment_id) ||
    !sameId(saved.score?.score_id, score.score_id) ||
    Number(saved.score?.score_version) !== Number(score.record_version) ||
    saved.score?.grading_term !== score.grading_term ||
    saved.score?.assessment_name !== score.header_name ||
    cents(saved.score?.original_earned_score) !== cents(score.earned_score) ||
    cents(saved.score?.proposed_earned_score) !==
      cents(request.proposed_earned_score) ||
    cents(saved.score?.maximum_score) !== cents(score.maximum_score) ||
    saved.correction_reason !== request.correction_reason ||
    saved.evidence_summary !== request.evidence_summary ||
    saved.original_official_grade?.grade_status !== "Approved" ||
    saved.original_official_grade?.grading_outcome !== "NUMERIC" ||
    saved.original_official_grade?.remarks !== grade.remarks ||
    !numericEq(
      saved.original_official_grade?.midterm_grade,
      grade.midterm_grade,
    ) ||
    !numericEq(saved.original_official_grade?.final_grade, grade.final_grade) ||
    !numericEq(
      saved.original_official_grade?.overall_percentage,
      grade.overall_percentage,
    ) ||
    !numericEq(
      saved.original_official_grade?.final_rating,
      grade.final_rating,
      2,
    ) ||
    !originalCalculated ||
    canonical(saved.approved_calculation_snapshot) !==
      canonical(originalCalculated)
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_SOURCE_SNAPSHOT_CHANGED",
      "Original submitted evidence changed.",
    );
  const approvedAssessment = (
    originalCalculated.calculated_terms?.[score.grading_term]?.categories ?? []
  )
    .flatMap((c) => c.assessments ?? [])
    .filter((a) => sameId(a.assessment_id, score.assessment_id));
  if (
    approvedAssessment.length !== 1 ||
    approvedAssessment[0].score_status !== "SCORED" ||
    cents(approvedAssessment[0].earned_score) !== cents(score.earned_score) ||
    cents(approvedAssessment[0].maximum_score) !== cents(score.maximum_score)
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_ORIGINAL_ASSESSMENT_CHANGED",
      "Original approved assessment is inconsistent.",
    );
  const [events] = await connection.execute(
    `SELECT * FROM gradebook_modern_score_correction_events WHERE correction_id = ?
      ORDER BY request_version_after,event_id FOR UPDATE`,
    [correctionId],
  );
  if (
    events.length !== 2 ||
    events[0].event_type !== "SUBMITTED" ||
    events[0].previous_status !== null ||
    events[0].new_status !== "SUBMITTED" ||
    Number(events[0].request_version_after) !== 1 ||
    !sameId(events[0].performed_by_user_id, request.submitted_by_user_id) ||
    events[0].event_reason !== request.correction_reason ||
    events[1].event_type !== "APPROVED" ||
    events[1].previous_status !== "SUBMITTED" ||
    events[1].new_status !== "APPROVED" ||
    Number(events[1].request_version_after) !== 2 ||
    !sameId(events[1].performed_by_user_id, request.reviewed_by_user_id) ||
    events[1].event_reason !== request.review_remarks ||
    events.some(
      (e) =>
        canonical(jsonValue(e.proposal_snapshot_json)) !== canonical(saved),
    )
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_AUDIT_INVALID",
      "Faculty and Program Head audit trail is invalid.",
    );
  const [legacyCorrections] = await connection.execute(
    `SELECT correction_id FROM gradebook_correction_requests
      WHERE grade_id = ? AND request_status IN ('SUBMITTED','RETURNED','APPROVED') FOR UPDATE`,
    [grade.grade_id],
  );
  const [legacyChanges] = await connection.execute(
    `SELECT grade_change_request_id FROM grade_change_requests
      WHERE grade_id = ? AND status IN ('Pending Program Head','For Registrar Processing','Returned') FOR UPDATE`,
    [grade.grade_id],
  );
  const [otherModern] = await connection.execute(
    `SELECT correction_id FROM gradebook_modern_score_corrections
      WHERE grade_id = ? AND correction_id <> ?
        AND request_status IN ('SUBMITTED','RETURNED','APPROVED') FOR UPDATE`,
    [grade.grade_id, correctionId],
  );
  const [modernInc] = await connection.execute(
    `SELECT submission_id FROM gradebook_modern_inc_submissions WHERE grade_id = ? FOR UPDATE`,
    [grade.grade_id],
  );
  if (
    legacyCorrections.length ||
    legacyChanges.length ||
    otherModern.length ||
    modernInc.length
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_CONFLICT",
      "Another grade change requires reconciliation.",
    );
  const [amendments] = await connection.execute(
    `SELECT amendment_id,sheet_revision_number,roster_snapshot_id,modern_score_correction_id
       FROM gradebook_sheet_amendments
      WHERE sheet_id = ? OR modern_score_correction_id = ? FOR UPDATE`,
    [sheet.sheet_id, correctionId],
  );
  if (
    amendments.some(
      (a) =>
        sameId(a.roster_snapshot_id, roster.roster_snapshot_id) ||
        sameId(a.modern_score_correction_id, correctionId),
    )
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_ALREADY_AMENDED",
      "This original roster or correction was already amended.",
    );
  const nextRevision =
    Math.max(0, ...amendments.map((a) => Number(a.sheet_revision_number))) + 1;
  if (!Number.isSafeInteger(nextRevision) || nextRevision > 4294967295)
    correctionFail(
      "MODERN_CORRECTION_PROCESS_REVISION_INVALID",
      "Invalid official-sheet amendment revision.",
    );

  // Re-run the shared calculation before and after the one approved score change.
  // The calculator's explicit option is added in Step 3.5G.4A; normal previews remain unchanged.
  const baseline = await calculateGradePreview(connection, 127, 274, 32, {
    allowApprovedNumericCorrection: true,
  });
  if (
    baseline.config_id !== Number(config.config_id) ||
    baseline.terms?.MIDTERM?.state !== "READY" ||
    baseline.terms?.FINAL_TERM?.state !== "READY" ||
    baseline.semester?.state !== "READY" ||
    canonical(baseline.terms.MIDTERM) !==
      canonical(originalCalculated.calculated_terms?.MIDTERM) ||
    canonical(baseline.terms.FINAL_TERM) !==
      canonical(originalCalculated.calculated_terms?.FINAL_TERM) ||
    !numericEq(
      baseline.semester.semester_percentage?.decimal_preview,
      grade.overall_percentage,
    ) ||
    String(baseline.semester.numeric_equivalent) !==
      Number(grade.final_rating).toFixed(2)
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_CALCULATION_DRIFT",
      "Current assessment/attendance differs from original approved calculation.",
    );
  const originalScore = decimal(cents(score.earned_score));
  const proposedScore = decimal(cents(request.proposed_earned_score));
  const [updatedScore] = await connection.execute(
    `UPDATE gradebook_scores SET earned_score = ?, updated_by_user_id = ?,
       record_version = record_version + 1
      WHERE score_id = ? AND enrollment_subject_id = ? AND score_status = 'SCORED'
        AND earned_score = ? AND record_version = ?`,
    [
      proposedScore,
      registrarId,
      score.score_id,
      enrollment.enrollment_subject_id,
      originalScore,
      body.expected_score_version,
    ],
  );
  if (Number(updatedScore.affectedRows) !== 1)
    correctionFail(
      "MODERN_CORRECTION_PROCESS_SCORE_CONFLICT",
      "Score changed before correction was applied.",
    );
  const [scoreEvent] = await connection.execute(
    `INSERT INTO gradebook_score_events
       (score_id,event_type,change_context,previous_score_status,new_score_status,
        previous_earned_score,new_earned_score,previous_na_reason,new_na_reason,
        change_reason,changed_by_user_id,score_version_after)
      VALUES (?,'UPDATED','AUTHORIZED_AMENDMENT','SCORED','SCORED',?,?,NULL,NULL,?,?,?)`,
    [
      score.score_id,
      originalScore,
      proposedScore,
      `MODERN_SCORE_CORRECTION_${correctionId}: ${remarks}`,
      registrarId,
      body.expected_score_version + 1,
    ],
  );
  if (Number(scoreEvent.affectedRows) !== 1)
    throw new Error("Authorized score audit event was not saved.");
  const revised = await calculateGradePreview(connection, 127, 274, 32, {
    allowApprovedNumericCorrection: true,
  });
  if (
    revised.config_id !== Number(config.config_id) ||
    revised.terms?.MIDTERM?.state !== "READY" ||
    revised.terms?.FINAL_TERM?.state !== "READY" ||
    revised.semester?.state !== "READY" ||
    !["PASS", "FAIL"].includes(revised.semester.pass_fail) ||
    canonical(revised.terms.MIDTERM) !== canonical(baseline.terms.MIDTERM)
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_RECALCULATION_INVALID",
      "Corrected grade is not ready or Midterm changed.",
    );
  const mid = revised.terms.MIDTERM.term_percentage;
  const fin = revised.terms.FINAL_TERM.term_percentage;
  const semester = revised.semester.semester_percentage;
  const newRating = String(revised.semester.numeric_equivalent);
  const newRemarks =
    revised.semester.pass_fail === "PASS" ? "Passed" : "Failed";
  if (
    ![mid, fin, semester].every(
      (v) => v && typeof v.decimal_preview === "string",
    ) ||
    !numericEq(mid.decimal_preview, grade.midterm_grade) ||
    !/^(?:[1-3]\.\d{2}|5\.00)$/.test(newRating)
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_NUMERIC_INVALID",
      "Shared calculator returned an invalid numeric result.",
    );
  const previous = {
    grade_id: Number(grade.grade_id),
    grade_status: grade.grade_status,
    grading_policy: grade.grading_policy,
    grading_outcome: grade.grading_outcome,
    midterm_grade: String(grade.midterm_grade),
    final_grade: String(grade.final_grade),
    overall_percentage: String(grade.overall_percentage),
    final_rating: String(grade.final_rating),
    remarks: grade.remarks,
    enrollment_subject_status: enrollment.subject_status,
  };
  const proposed = {
    grade_id: Number(grade.grade_id),
    grade_status: "Approved",
    grading_policy: "TWO_TERM_50_50",
    grading_outcome: "NUMERIC",
    midterm_grade: mid.decimal_preview,
    final_grade: fin.decimal_preview,
    overall_percentage: semester.decimal_preview,
    final_rating: newRating,
    remarks: newRemarks,
    enrollment_subject_status: newRemarks === "Passed" ? "Completed" : "Failed",
  };
  await connection.execute("SET @allow_approved_grade_correction = 1");
  let updatedGrade;
  try {
    [updatedGrade] = await connection.execute(
      `UPDATE grades SET midterm_grade = ?, final_grade = ?, overall_percentage = ?,
         final_rating = ?, remarks = ?
       WHERE grade_id = ? AND grade_status = 'Approved' AND grading_policy = 'TWO_TERM_50_50'
         AND grading_outcome = 'NUMERIC' AND final_rating = ?`,
      [
        proposed.midterm_grade,
        proposed.final_grade,
        proposed.overall_percentage,
        proposed.final_rating,
        proposed.remarks,
        grade.grade_id,
        grade.final_rating,
      ],
    );
  } finally {
    await connection.execute("SET @allow_approved_grade_correction = NULL");
  }
  if (Number(updatedGrade.affectedRows) !== 1)
    correctionFail(
      "MODERN_CORRECTION_PROCESS_GRADE_CONFLICT",
      "Protected official grade was not updated.",
    );
  const [after] = await connection.execute(
    `SELECT g.grade_status,g.grading_policy,g.grading_outcome,g.midterm_grade,g.final_grade,
         g.overall_percentage,g.final_rating,g.remarks,g.outcome_reason,es.status AS subject_status
       FROM grades g JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
      WHERE g.grade_id = ?`,
    [grade.grade_id],
  );
  const actual = after[0];
  if (
    after.length !== 1 ||
    actual.grade_status !== "Approved" ||
    actual.grading_policy !== "TWO_TERM_50_50" ||
    actual.grading_outcome !== "NUMERIC" ||
    actual.outcome_reason !== null ||
    actual.remarks !== newRemarks ||
    actual.subject_status !== proposed.enrollment_subject_status ||
    !numericEq(actual.midterm_grade, proposed.midterm_grade) ||
    !numericEq(actual.final_grade, proposed.final_grade) ||
    !numericEq(actual.overall_percentage, proposed.overall_percentage) ||
    !numericEq(actual.final_rating, proposed.final_rating, 2)
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_GRADE_TRIGGER_MISMATCH",
      "Official grade or enrollment status differs from corrected calculation.",
    );
  const [rosterAfter] = await connection.execute(
    `SELECT * FROM gradebook_finalized_roster WHERE roster_snapshot_id = ?`,
    [roster.roster_snapshot_id],
  );
  const [sheetAfter] = await connection.execute(
    `SELECT sheet_status,record_version,DATE_FORMAT(original_official_submitted_on,'%Y-%m-%d') AS original_date
       FROM gradebook_official_sheets WHERE sheet_id = ?`,
    [sheet.sheet_id],
  );
  if (
    rosterAfter.length !== 1 ||
    canonical(rosterAfter[0]) !== canonical(roster) ||
    sheetAfter.length !== 1 ||
    sheetAfter[0].sheet_status !== "FINALIZED" ||
    Number(sheetAfter[0].record_version) !== Number(sheet.record_version) ||
    sheetAfter[0].original_date !== sheet.original_date
  )
    correctionFail(
      "MODERN_CORRECTION_PROCESS_HISTORY_CHANGED",
      "Original finalized source was modified.",
    );

  const next = {
    ...proposed,
    source: saved.source,
    correction_id: correctionId,
    previous_score: originalScore,
    corrected_score: proposedScore,
    score_event_id: String(scoreEvent.insertId),
    requested_by_user_id: request.submitted_by_user_id,
    authorized_by_user_id: request.reviewed_by_user_id,
    progression_review_required: true,
    calculated_midterm: mid,
    calculated_final_term: fin,
    calculated_semester: semester,
  };
  const [amendment] = await connection.execute(
    `INSERT INTO gradebook_sheet_amendments
       (sheet_id,sheet_revision_number,amendment_type,grade_change_request_id,
        modern_inc_submission_id,modern_score_correction_id,roster_snapshot_id,
        amendment_reason,previous_values_summary,new_values_summary,progression_review_required,
        requested_by_user_id,authorized_by_user_id,authorized_at,verified_by_user_id,
        verified_at,applied_by_user_id,applied_at)
     VALUES (?,?,'GRADE_CORRECTION',NULL,NULL,?,?,?,?,?,1,?,?,?, ?,NOW(),?,NOW())`,
    [
      sheet.sheet_id,
      nextRevision,
      correctionId,
      roster.roster_snapshot_id,
      remarks,
      JSON.stringify(previous),
      JSON.stringify(next),
      request.submitted_by_user_id,
      request.reviewed_by_user_id,
      request.reviewed_at,
      registrarId,
      registrarId,
    ],
  );
  if (Number(amendment.affectedRows) !== 1)
    throw new Error("Modern score correction amendment was not created.");
  const [marked] = await connection.execute(
    `UPDATE gradebook_modern_score_corrections SET request_status = 'APPLIED',
        applied_by_user_id = ?, applied_at = NOW(6), record_version = record_version + 1
      WHERE correction_id = ? AND request_status = 'APPROVED' AND record_version = ?`,
    [registrarId, correctionId, body.expected_record_version],
  );
  if (Number(marked.affectedRows) !== 1)
    correctionFail(
      "MODERN_CORRECTION_PROCESS_REQUEST_CONFLICT",
      "Correction was processed concurrently.",
    );
  const trailSnapshot = {
    ...next,
    amendment_id: String(amendment.insertId),
    sheet_revision_number: nextRevision,
  };
  const [event] = await connection.execute(
    `INSERT INTO gradebook_modern_score_correction_events
       (correction_id,event_type,previous_status,new_status,proposal_snapshot_json,
        event_reason,performed_by_user_id,request_version_after)
      VALUES (?,'APPLIED','APPROVED','APPLIED',?,?,?,?)`,
    [
      correctionId,
      JSON.stringify(saved),
      remarks,
      registrarId,
      body.expected_record_version + 1,
    ],
  );
  const [trail] = await connection.execute(
    `INSERT INTO audit_trail (user_id,table_name,record_id,action,old_values,new_values,created_at)
       VALUES (?,'grades',?,'UPDATE',?,?,NOW())`,
    [
      registrarId,
      grade.grade_id,
      JSON.stringify(previous),
      JSON.stringify(trailSnapshot),
    ],
  );
  const [log] = await connection.execute(
    `INSERT INTO audit_logs (user_id,action,table_name,record_id,description,created_at)
       VALUES (?,'MODERN SCORE CORRECTION APPLIED','grades',?,?,NOW())`,
    [registrarId, grade.grade_id, JSON.stringify(trailSnapshot)],
  );
  if (
    Number(event.affectedRows) !== 1 ||
    Number(trail.affectedRows) !== 1 ||
    Number(log.affectedRows) !== 1
  )
    throw new Error("Modern score correction audit trail could not be saved.");
  return {
    success: true,
    dry_run: body.dry_run,
    persisted: !body.dry_run,
    correction_context: saved.correction_context,
    correction_id: correctionId,
    grade_id: Number(grade.grade_id),
    offering_id: Number(offering.offering_id),
    enrollment_subject_id: Number(enrollment.enrollment_subject_id),
    sheet_id: String(sheet.sheet_id),
    roster_snapshot_id: String(roster.roster_snapshot_id),
    amendment_id: body.dry_run ? null : String(amendment.insertId),
    sheet_revision_number: nextRevision,
    request_status: "APPLIED",
    record_version: body.expected_record_version + 1,
    previous_score: originalScore,
    proposed_score: proposedScore,
    score_version_after: body.expected_score_version + 1,
    previous_official_grade: previous,
    proposed_official_grade: proposed,
    enrollment_subject_status_after_correction:
      proposed.enrollment_subject_status,
    original_snapshot_unchanged: true,
    official_sheet_unchanged: true,
    correction_validated: true,
    score_change_performed: !body.dry_run,
    official_grade_unchanged: body.dry_run,
    progression_review_required: true,
    audit_event: "APPLIED",
    audit_event_id: body.dry_run ? null : String(event.insertId),
  };
}
