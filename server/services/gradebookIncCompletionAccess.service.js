const TEST_DATABASE = "databaseforptc1_admission_test";
const TEST_OFFERING_ID = 131;

function fail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

// An approved INC is official history. Only a documented, timely completion
// may reopen the affected student's Final Term score cells in the QA pilot.
// This never reopens Midterm or authorizes normal term publication.
async function requireVerifiedIncFinalTermScoreEntry(
  connection,
  {
    offeringId,
    configId,
    enrollmentSubjectId,
    actorUserId,
    facultyId,
    gradingTerm,
    changeReason,
  },
) {
  if (offeringId !== TEST_OFFERING_ID) {
    fail(
      "INC_SCORE_QA_OFFERING_ONLY",
      "INC completion score entry is limited to QA Offering #131.",
      403,
    );
  }
  const [[database]] = await connection.execute(
    "SELECT DATABASE() AS database_name",
  );
  if (database?.database_name !== TEST_DATABASE) {
    fail(
      "INC_SCORE_QA_DATABASE_ONLY",
      "INC completion score entry is limited to the admission-test database.",
      403,
    );
  }
  if (gradingTerm !== "FINAL_TERM") {
    fail(
      "INC_SCORE_FINAL_TERM_ONLY",
      "Approved INC completion may reopen only Final Term scores.",
    );
  }
  if (!changeReason || changeReason.length < 10) {
    fail(
      "INC_SCORE_REASON_REQUIRED",
      "Document why the INC completion score is being entered (at least 10 characters).",
      400,
    );
  }

  const [grades] = await connection.execute(
    `SELECT grade_id, faculty_id, grade_status, grading_policy,
            grading_outcome, final_rating, remarks
       FROM grades WHERE enrollment_subject_id = ? FOR UPDATE`,
    [enrollmentSubjectId],
  );
  if (
    grades.length !== 1 ||
    grades[0].grade_status !== "Approved" ||
    grades[0].grading_policy !== "TWO_TERM_50_50" ||
    grades[0].grading_outcome !== "INCOMPLETE" ||
    Number(grades[0].final_rating) !== 4 ||
    grades[0].remarks !== "Incomplete" ||
    Number(grades[0].faculty_id) !== Number(facultyId)
  ) {
    fail(
      "INC_SCORE_OFFICIAL_GRADE_CHANGED",
      "The student's protected Approved INC 4.00 grade is not eligible for completion scoring.",
    );
  }
  const gradeId = Number(grades[0].grade_id);
  const [outcomes] = await connection.execute(
    `SELECT inc_request_id, request_status FROM gradebook_inc_outcome_requests
      WHERE config_id = ? AND enrollment_subject_id = ? FOR UPDATE`,
    [configId, enrollmentSubjectId],
  );
  if (outcomes.length !== 1 || outcomes[0].request_status !== "APPROVED") {
    fail(
      "INC_SCORE_ORIGINAL_INC_APPROVAL_REQUIRED",
      "The approved original INC outcome request must remain valid.",
    );
  }

  const [sheets] = await connection.execute(
    `SELECT sheet_id, DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS original_date,
            official_submission_reference, official_date_verified_by_user_id,
            official_date_verified_at,
            DATE_FORMAT(DATE_ADD(original_official_submitted_on, INTERVAL 1 YEAR), '%Y-%m-%d') AS deadline_on
       FROM gradebook_official_sheets WHERE config_id = ? FOR UPDATE`,
    [configId],
  );
  if (
    sheets.length !== 1 ||
    !sheets[0].original_date ||
    !String(sheets[0].official_submission_reference ?? "").trim() ||
    !sheets[0].official_date_verified_by_user_id ||
    !sheets[0].official_date_verified_at ||
    !sheets[0].deadline_on
  ) {
    fail(
      "INC_SCORE_VERIFIED_SHEET_REQUIRED",
      "The original grading-sheet submission date must be recorded and verified by Registrar.",
    );
  }
  const sheet = sheets[0];
  const [sheetEvents] = await connection.execute(
    `SELECT event_type, performed_by_user_id,
            DATE_FORMAT(original_official_submitted_on, '%Y-%m-%d') AS official_date,
            official_submission_reference
       FROM gradebook_official_sheet_submission_events
      WHERE sheet_id = ? ORDER BY record_version_after`,
    [String(sheet.sheet_id)],
  );
  const originalDate = sheet.original_date;
  if (
    sheetEvents[0]?.event_type !== "RECORDED" ||
    !sheetEvents.some(
      (event) =>
        event.event_type === "VERIFIED" &&
        event.official_date === originalDate &&
        event.official_submission_reference ===
          sheet.official_submission_reference &&
        Number(event.performed_by_user_id) ===
          Number(sheet.official_date_verified_by_user_id),
    )
  ) {
    fail(
      "INC_SCORE_SHEET_AUDIT_INVALID",
      "The official-sheet date verification audit is missing or inconsistent.",
    );
  }

  const [claims] = await connection.execute(
    `SELECT claim_id, grade_id, grade_change_request_id, verification_status,
            DATE_FORMAT(verified_completed_on, '%Y-%m-%d') AS verified_completed_on,
            evidence_summary, verification_remarks, verified_at,
            submitted_by_user_id, verified_by_user_id, record_version
       FROM gradebook_inc_completion_claims WHERE grade_id = ? FOR UPDATE`,
    [gradeId],
  );
  if (
    claims.length !== 1 ||
    claims[0].verification_status !== "VERIFIED_TIMELY" ||
    claims[0].grade_change_request_id !== null ||
    !claims[0].verified_completed_on ||
    !claims[0].verified_at ||
    !claims[0].verified_by_user_id ||
    !String(claims[0].evidence_summary ?? "").trim() ||
    !String(claims[0].verification_remarks ?? "").trim() ||
    Number(claims[0].submitted_by_user_id) !== actorUserId ||
    claims[0].verified_completed_on > sheet.deadline_on
  ) {
    fail(
      "INC_SCORE_VERIFIED_CLAIM_REQUIRED",
      "A timely Program Head-verified claim from the assigned instructor is required.",
    );
  }
  const claim = claims[0];
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
      (event, index) => Number(event.claim_version_after) === index + 1,
    ) ||
    lastEvent?.event_type !== "VERIFIED" ||
    lastEvent.new_status !== "VERIFIED_TIMELY" ||
    lastEvent.completed_on !== claim.verified_completed_on ||
    Number(lastEvent.performed_by_user_id) !== Number(claim.verified_by_user_id)
  ) {
    fail(
      "INC_SCORE_CLAIM_AUDIT_INVALID",
      "The claim verification audit does not match its current version.",
    );
  }

  const [midtermRows] = await connection.execute(
    `SELECT submission_status FROM gradebook_term_submission_attempts
      WHERE config_id = ? AND enrollment_subject_id = ? AND grading_term = 'MIDTERM'
      ORDER BY attempt_number DESC, term_submission_id DESC LIMIT 1`,
    [configId, enrollmentSubjectId],
  );
  if (
    midtermRows.length !== 1 ||
    midtermRows[0].submission_status !== "APPROVED"
  ) {
    fail(
      "INC_SCORE_MIDTERM_APPROVAL_REQUIRED",
      "The original Midterm submission must remain approved and locked.",
    );
  }
  const [requests] = await connection.execute(
    `SELECT grade_change_request_id FROM grade_change_requests
      WHERE grade_id = ? AND request_type = 'INC_COMPLETION'
        AND status IN ('Pending Program Head', 'For Registrar Processing') LIMIT 1 FOR UPDATE`,
    [gradeId],
  );
  if (requests.length) {
    fail(
      "INC_SCORE_CHANGE_REQUEST_ACTIVE",
      "The INC conversion request has already entered review. Score edits are locked.",
    );
  }

  return {
    claim_id: String(claim.claim_id),
    grade_id: gradeId,
    verified_completed_on: claim.verified_completed_on,
  };
}

// Authorize only a verified historical INC on its original finalized sheet.
export async function requireVerifiedHistoricalIncFinalTermEntry(
  connection,
  {
    offeringId,
    configId,
    enrollmentSubjectId,
    studentId,
    actorUserId,
    facultyId,
    gradingTerm,
    changeReason,
  },
) {
  const incCompletion = await requireVerifiedIncFinalTermScoreEntry(
    connection,
    {
      offeringId,
      configId,
      enrollmentSubjectId,
      actorUserId,
      facultyId,
      gradingTerm,
      changeReason,
    },
  );

  // Protect the original finalized INC snapshot.
  const [incSnapshots] = await connection.execute(
    `SELECT fr.roster_snapshot_id, sh.sheet_id
       FROM gradebook_finalized_roster fr
       JOIN gradebook_official_sheets sh
         ON sh.sheet_id = fr.sheet_id
      WHERE sh.config_id = ?
        AND sh.sheet_status = 'FINALIZED'
        AND fr.enrollment_subject_id = ?
        AND fr.student_id = ?
        AND fr.grade_id = ?
        AND fr.grade_status_snapshot = 'Approved'
        AND fr.grading_outcome_snapshot = 'INCOMPLETE'
        AND fr.final_rating_snapshot = 4.00
        AND NOT EXISTS (
          SELECT 1
            FROM gradebook_grade_submission_attempts a
            JOIN grades g ON g.grade_id = a.grade_id
           WHERE g.enrollment_subject_id =
                 fr.enrollment_subject_id
        )
        AND NOT EXISTS (
          SELECT 1
            FROM gradebook_official_grade_publications p
           WHERE p.grade_id = fr.grade_id
              OR p.enrollment_subject_id =
                 fr.enrollment_subject_id
        )
      FOR UPDATE`,
    [configId, enrollmentSubjectId, studentId, incCompletion.grade_id],
  );

  if (incSnapshots.length !== 1) {
    fail(
      "INC_SCORE_FINALIZED_SOURCE_INVALID",
      "A valid original finalized INC snapshot is required for historical completion scoring.",
      409,
    );
  }

  return incCompletion;
}
