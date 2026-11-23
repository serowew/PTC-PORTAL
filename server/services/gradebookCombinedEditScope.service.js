function combinedEditFail(code, message) {
  const error = new Error(message);
  error.status = 409;
  error.code = code;
  throw error;
}

export async function assertCombinedSemesterCellEditable(
  connection,
  configId,
  enrollmentSubjectId,
  gradingTerm,
) {
  if (!["MIDTERM", "FINAL_TERM"].includes(gradingTerm)) {
    combinedEditFail("COMBINED_TERM_INVALID", "Invalid grading term.");
  }

  const [sheets] = await connection.execute(
    `SELECT sheet_id, sheet_status,
            original_official_submitted_on,
            official_submission_reference,
            official_date_verified_at
       FROM gradebook_official_sheets
      WHERE config_id = ?`,
    [configId],
  );

  if (sheets.length > 1) {
    combinedEditFail(
      "COMBINED_SHEET_INVALID",
      "Conflicting official sheets exist.",
    );
  }

  const sheet = sheets[0] ?? null;

  if (sheet?.sheet_status === "FINALIZED") {
    combinedEditFail(
      "COMBINED_SHEET_FINALIZED",
      "The finalized sheet cannot be edited.",
    );
  }

  // Officially submitted gradebooks require the correction workflow.
  if (
    sheet &&
    (sheet.original_official_submitted_on != null ||
      sheet.official_submission_reference != null ||
      sheet.official_date_verified_at != null)
  ) {
    combinedEditFail(
      "COMBINED_OFFICIAL_SUBMISSION_RECORDED",
      "Official submission evidence has been recorded. Use the authorized correction workflow.",
    );
  }

  const [locks] = await connection.execute(
    `SELECT first_submission_id
       FROM gradebook_structure_locks
      WHERE config_id = ?`,
    [configId],
  );

  const [attemptsExist] = sheet
    ? await connection.execute(
        `SELECT submission_id
           FROM gradebook_grade_submission_attempts
          WHERE sheet_id = ?
          LIMIT 1`,
        [sheet.sheet_id],
      )
    : [[]];

  if (
    locks.length > 1 ||
    Boolean(locks.length) !== Boolean(attemptsExist.length)
  ) {
    combinedEditFail(
      "COMBINED_LOCK_HISTORY_MISMATCH",
      "The combined submission history and structure lock are inconsistent.",
    );
  }

  // Confirm the structure lock belongs to this official sheet.
  if (locks.length === 1) {
    const [firstSubmissions] = await connection.execute(
      `SELECT submission_id
         FROM gradebook_grade_submission_attempts
        WHERE submission_id = ?
          AND sheet_id = ?
        LIMIT 1`,
      [locks[0].first_submission_id, sheet.sheet_id],
    );

    if (firstSubmissions.length !== 1) {
      combinedEditFail(
        "COMBINED_LOCK_SOURCE_INVALID",
        "The structure lock does not reference the original submission on this sheet.",
      );
    }
  }

  // Protect existing grades that have not entered the combined workflow.
  if (!attemptsExist.length) {
    const [existingGrades] = await connection.execute(
      `SELECT grade_id
       FROM grades
      WHERE enrollment_subject_id = ?
      FOR UPDATE`,
      [enrollmentSubjectId],
    );

    if (existingGrades.length > 0) {
      combinedEditFail(
        "COMBINED_PREEXISTING_GRADE_REVIEW_REQUIRED",
        "This student has an existing grade outside the combined submission workflow. Review or migrate it before entering new scores or attendance.",
      );
    }

    return;
  }

  const [grades] = await connection.execute(
    `SELECT grade_id, grade_status
       FROM grades
      WHERE enrollment_subject_id = ?
      FOR UPDATE`,
    [enrollmentSubjectId],
  );

  if (grades.length > 1) {
    combinedEditFail(
      "COMBINED_GRADE_DUPLICATE",
      "More than one grade was found.",
    );
  }

  // Another student has submitted, but this student has not.
  if (!grades.length) return;

  const grade = grades[0];

  const [submissions] = await connection.execute(
    `SELECT
       submission_id,
       attempt_number,
       submission_status,
       returned_edit_scope,
       record_version,
       reviewed_by_user_id,
       reviewed_at
     FROM gradebook_grade_submission_attempts
     WHERE grade_id = ?
       AND sheet_id = ?
     ORDER BY attempt_number DESC, submission_id DESC
     LIMIT 1
     FOR UPDATE`,
    [grade.grade_id, sheet.sheet_id],
  );

  const current = submissions[0] ?? null;

  if (!current) {
    combinedEditFail(
      "COMBINED_GRADE_WITHOUT_ATTEMPT",
      "A grade exists without a matching combined submission. Review or migrate it before editing.",
    );
  }

  if (current.submission_status !== "RETURNED") {
    combinedEditFail(
      "COMBINED_STUDENT_GRADE_LOCKED",
      "This student's combined grade is submitted or approved.",
    );
  }

  if (grade.grade_status !== "Returned") {
    combinedEditFail(
      "COMBINED_RETURN_STATE_MISMATCH",
      "Returned submission and grade status disagree.",
    );
  }

  const scope = current.returned_edit_scope;

  if (
    !["MIDTERM", "FINAL_TERM", "BOTH"].includes(scope) ||
    (scope !== "BOTH" && scope !== gradingTerm)
  ) {
    combinedEditFail(
      "COMBINED_TERM_NOT_RETURNED",
      `The Program Head did not return this student's ${gradingTerm} grade for editing.`,
    );
  }

  if (!current.reviewed_by_user_id || !current.reviewed_at) {
    combinedEditFail(
      "COMBINED_RETURN_REVIEW_MISSING",
      "The return review is incomplete.",
    );
  }

  const [reviews] = await connection.execute(
    `SELECT
       review_decision,
       returned_edit_scope,
       reviewed_by_user_id,
       submission_version_after
     FROM gradebook_grade_submission_reviews
     WHERE submission_id = ?`,
    [current.submission_id],
  );

  if (
    reviews.length !== 1 ||
    reviews[0].review_decision !== "RETURNED" ||
    reviews[0].returned_edit_scope !== scope ||
    Number(reviews[0].reviewed_by_user_id) !==
      Number(current.reviewed_by_user_id) ||
    Number(reviews[0].submission_version_after) !==
      Number(current.record_version)
  ) {
    combinedEditFail(
      "COMBINED_RETURN_AUDIT_MISMATCH",
      "Return decision and audit record disagree.",
    );
  }
}
