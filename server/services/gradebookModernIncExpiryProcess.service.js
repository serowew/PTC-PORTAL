import { inspectModernIncExpiryReadiness } from "./gradebookModernIncExpiryReadiness.service.js";
import { assertQaGradingDatabase } from "./gradebookQaWriteGuard.service.js";
function fail(httpStatus, code, message) {
  const error = new Error(message);
  error.httpStatus = httpStatus;
  error.code = code;
  throw error;
}

function positiveIdString(value) {
  return (
    typeof value === "string" &&
    /^[1-9]\d{0,19}$/.test(value) &&
    BigInt(value) <= 18446744073709551615n
  );
}

function validateBody(body) {
  const allowed = [
    "expected_sheet_id",
    "expected_sheet_record_version",
    "expected_roster_snapshot_id",
    "expiry_reason",
    "confirm_inc_expiry",
    "dry_run",
  ];
  const reason =
    typeof body?.expiry_reason === "string" ? body.expiry_reason.trim() : "";
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== allowed.length ||
    Object.keys(body).some((k) => !allowed.includes(k)) ||
    !positiveIdString(body.expected_sheet_id) ||
    !positiveIdString(body.expected_roster_snapshot_id) ||
    !Number.isSafeInteger(body.expected_sheet_record_version) ||
    body.expected_sheet_record_version < 1 ||
    reason.length < 20 ||
    reason.length > 380 ||
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(reason) ||
    body.confirm_inc_expiry !== true ||
    typeof body.dry_run !== "boolean"
  ) {
    fail(
      400,
      "MODERN_INC_EXPIRY_BODY_INVALID",
      "Provide exact official sheet ID/version, original roster ID, a reason (20–380 characters), confirmation, and dry_run.",
    );
  }
  return { reason, dryRun: body.dry_run };
}

export async function processModernIncExpiry(
  connection,
  registrarId,
  gradeId,
  body,
) {
  const { reason, dryRun } = validateBody(body);
  // Committed expiry processing requires explicit rollout approval.
  if (
    !dryRun &&
    process.env.GRADEBOOK_MODERN_INC_EXPIRY_WRITES_ENABLED !== "true"
  ) {
    fail(
      403,
      "MODERN_INC_EXPIRY_WRITES_DISABLED",
      "Modern INC expiry processing is not enabled on this server.",
    );
  }

  // Keep QA-only validation while committed expiry writes are disabled.
  if (process.env.GRADEBOOK_MODERN_INC_EXPIRY_WRITES_ENABLED !== "true") {
    await assertQaGradingDatabase(connection);
  }
  const [registrars] = await connection.execute(
    `SELECT u.user_id
     FROM users u
     JOIN roles r ON r.role_id = u.role_id
    WHERE u.user_id = ?
      AND r.role_name = 'Registrar'
      AND u.is_active = 1
      AND u.is_archived = 0
    LIMIT 1 FOR UPDATE`,
    [registrarId],
  );

  if (registrars.length !== 1) {
    fail(
      403,
      "MODERN_INC_EXPIRY_ACTIVE_REGISTRAR_REQUIRED",
      "An active Registrar account is required to process INC expiry.",
    );
  }

  // Expiry must be atomic across official grades, amendments, and audits.
  const transactionalTables = [
    "grades",
    "enrollment_subjects",
    "gradebook_official_sheets",
    "gradebook_finalized_roster",
    "gradebook_official_grade_publications",
    "gradebook_grade_submission_attempts",
    "gradebook_inc_completion_claims",
    "gradebook_modern_inc_submissions",
    "grade_change_requests",
    "gradebook_inc_expiry_actions",
    "gradebook_sheet_amendments",
    "audit_trail",
    "audit_logs",
  ];

  const [storageRows] = await connection.execute(
    `SELECT TABLE_NAME AS table_name, ENGINE AS engine
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${transactionalTables.map(() => "?").join(", ")})`,
    transactionalTables,
  );

  const tableEngines = new Map(
    storageRows.map((row) => [
      row.table_name,
      String(row.engine ?? "").toUpperCase(),
    ]),
  );

  if (
    transactionalTables.some((table) => tableEngines.get(table) !== "INNODB")
  ) {
    fail(
      409,
      "MODERN_INC_EXPIRY_TRANSACTION_STORAGE_UNSAFE",
      "INC expiry requires InnoDB for all official-grade, source, and audit tables.",
    );
  }

  // Resolve the source only for locking; it is fully revalidated after locks.
  const initial = await inspectModernIncExpiryReadiness(connection, gradeId);
  const sheetId = initial.source.sheet_id;
  if (!sheetId) {
    fail(
      409,
      "MODERN_INC_EXPIRY_SOURCE_MISSING",
      "No verified modern official sheet exists for this grade.",
    );
  }
  if (
    body.expected_sheet_id !== sheetId ||
    body.expected_roster_snapshot_id !==
      initial.source.original_roster_snapshot_id ||
    body.expected_sheet_record_version !==
      initial.official_sheet?.record_version
  ) {
    fail(
      409,
      "MODERN_INC_EXPIRY_SOURCE_STALE",
      "The expected original sheet, revision, or roster no longer matches.",
    );
  }

  // Serialize competing expiry/conversion operations and hold locks through commit.
  const [lockedGrade] = await connection.execute(
    "SELECT grade_id FROM grades WHERE grade_id = ? FOR UPDATE",
    [gradeId],
  );
  if (lockedGrade.length !== 1)
    fail(404, "MODERN_INC_EXPIRY_GRADE_NOT_FOUND", "Grade not found.");
  const [lockedSheet] = await connection.execute(
    "SELECT sheet_id FROM gradebook_official_sheets WHERE sheet_id = ? FOR UPDATE",
    [sheetId],
  );
  if (lockedSheet.length !== 1) {
    fail(
      409,
      "MODERN_INC_EXPIRY_SOURCE_MISSING",
      "Official sheet is no longer available.",
    );
  }
  // Lock existing child records and block concurrent creation under the grade lock.
  await connection.execute(
    "SELECT claim_id FROM gradebook_inc_completion_claims WHERE grade_id = ? FOR UPDATE",
    [gradeId],
  );
  await connection.execute(
    "SELECT submission_id FROM gradebook_modern_inc_submissions WHERE grade_id = ? FOR UPDATE",
    [gradeId],
  );
  await connection.execute(
    "SELECT grade_change_request_id FROM grade_change_requests WHERE grade_id = ? FOR UPDATE",
    [gradeId],
  );
  await connection.execute(
    "SELECT expiry_id FROM gradebook_inc_expiry_actions WHERE grade_id = ? FOR UPDATE",
    [gradeId],
  );

  const readiness = await inspectModernIncExpiryReadiness(connection, gradeId);
  if (
    !readiness.source_verified ||
    !readiness.eligible_for_registrar_expiry_review
  ) {
    fail(
      409,
      readiness.source_verified
        ? readiness.policy_decision.code
        : "MODERN_INC_EXPIRY_SOURCE_INVALID",
      readiness.source_verified
        ? readiness.policy_decision.explanation
        : `Official INC provenance is not verified: ${readiness.source_blockers.map((b) => b.code).join(", ")}`,
    );
  }
  if (
    readiness.source.sheet_id !== body.expected_sheet_id ||
    readiness.source.original_roster_snapshot_id !==
      body.expected_roster_snapshot_id ||
    readiness.official_sheet.record_version !==
      body.expected_sheet_record_version
  ) {
    fail(
      409,
      "MODERN_INC_EXPIRY_SOURCE_STALE",
      "The original official source changed before processing.",
    );
  }

  // Reject an artificial pre-academic-year submission date, even if it was stored
  // on a QA sheet. Academic years are formatted YYYY-YYYY in the PTC database.
  const [years] = await connection.execute(
    `SELECT ay.academic_year
       FROM grades g
       JOIN enrollment_subjects es ON es.enrollment_subject_id = g.enrollment_subject_id
       JOIN subject_offerings so ON so.offering_id = es.offering_id
       JOIN academic_years ay ON ay.academic_year_id = so.academic_year_id
      WHERE g.grade_id = ?`,
    [gradeId],
  );
  const academicYear = /^([0-9]{4})-([0-9]{4})$/.exec(
    years[0]?.academic_year ?? "",
  );
  if (
    years.length !== 1 ||
    !academicYear ||
    Number(academicYear[2]) !== Number(academicYear[1]) + 1 ||
    readiness.official_sheet.original_official_submitted_on <
      `${academicYear[1]}-01-01`
  ) {
    fail(
      409,
      "MODERN_INC_EXPIRY_YEAR_DATE_CONFLICT",
      "The verified official sheet date predates its actual academic year. Do not backdate a modern offering.",
    );
  }

  // Check the complete amendment history before adding a new revision.
  const [revisions] = await connection.execute(
    `SELECT sheet_revision_number
       FROM gradebook_sheet_amendments
      WHERE sheet_id = ?
      ORDER BY sheet_revision_number ASC
      FOR UPDATE`,
    [sheetId],
  );

  let revision = 1;

  for (const row of revisions) {
    const savedRevision = Number(row.sheet_revision_number);

    if (!Number.isSafeInteger(savedRevision) || savedRevision !== revision) {
      fail(
        409,
        "MODERN_INC_EXPIRY_REVISION_HISTORY_INVALID",
        "Official sheet amendment revisions are missing or inconsistent.",
      );
    }

    revision += 1;
  }

  if (revision > 4294967295) {
    fail(
      409,
      "MODERN_INC_EXPIRY_REVISION_LIMIT",
      "Official sheet revision limit reached.",
    );
  }
  const outcomeReason = `Expired INC after verified deadline ${readiness.policy_decision.deadline_on}. ${reason}`;
  if (outcomeReason.length > 500) {
    fail(
      400,
      "MODERN_INC_EXPIRY_REASON_TOO_LONG",
      "The official outcome reason exceeds 500 characters.",
    );
  }
  const [originalGradeRows] = await connection.execute(
    `SELECT grade_id, grade_status, grading_policy, grading_outcome,
            midterm_grade, final_grade, overall_percentage, final_rating,
            remarks, outcome_reason
       FROM grades WHERE grade_id = ? FOR UPDATE`,
    [gradeId],
  );
  if (originalGradeRows.length !== 1) {
    fail(
      409,
      "MODERN_INC_EXPIRY_SOURCE_STALE",
      "The official grade disappeared while processing.",
    );
  }
  const originalGrade = originalGradeRows[0];
  const before = {
    ...originalGrade,
    enrollment_subject_status: "Incomplete",
    sheet_id: sheetId,
    roster_snapshot_id: readiness.source.original_roster_snapshot_id,
    original_official_submitted_on:
      readiness.official_sheet.original_official_submitted_on,
    deadline_on: readiness.policy_decision.deadline_on,
    policy_decision: readiness.policy_decision.code,
  };
  const after = {
    ...before,
    grading_outcome: "EXPIRED_INCOMPLETE",
    final_rating: "5.00",
    overall_percentage: null,
    remarks: "Failed",
    enrollment_subject_status: "Failed",
    outcome_reason: outcomeReason,
    expiry_authority: "REGISTRAR_AUTHORIZED_MODERN_INC_EXPIRY",

    // Expiry audit references
    amendment_type: "INC_EXPIRY",
    official_publication_id: String(readiness.source.publication_id),
    sheet_revision_number: revision,
    expiry_reason: reason,
    processed_by_user_id: Number(registrarId),
  };

  // Existing DB trigger is the only authority allowed to convert an Approved INC.
  let updated;
  await connection.execute("SET @allow_approved_inc_expiry = 1");
  try {
    [updated] = await connection.execute(
      `UPDATE grades
          SET grading_outcome = 'EXPIRED_INCOMPLETE',
              outcome_reason = ?,
              grade_status = 'Approved'
        WHERE grade_id = ?
          AND enrollment_subject_id = ?
          AND grade_status = 'Approved'
          AND grading_policy = 'TWO_TERM_50_50'
          AND grading_outcome = 'INCOMPLETE'
          AND final_rating = 4.00
          AND remarks = 'Incomplete'
          AND final_grade IS NULL
          AND overall_percentage IS NULL
          AND EXISTS (
            SELECT 1
              FROM gradebook_official_grade_publications pub
              JOIN gradebook_official_sheets sh
                ON sh.config_id = pub.config_id
              JOIN gradebook_finalized_roster fr
                ON fr.sheet_id = sh.sheet_id
             WHERE pub.publication_id = ?
               AND pub.grade_id = grades.grade_id
               AND pub.enrollment_subject_id = grades.enrollment_subject_id
               AND pub.publication_source = 'COMBINED_SEMESTER'
               AND pub.grading_outcome_snapshot = 'INCOMPLETE'
               AND pub.combined_submission_id IS NOT NULL
               AND sh.sheet_id = ?
               AND sh.sheet_status = 'FINALIZED'
               AND sh.record_version = ?
               AND fr.roster_snapshot_id = ?
               AND fr.grade_id = grades.grade_id
               AND fr.enrollment_subject_id = grades.enrollment_subject_id
               AND fr.roster_disposition = 'APPROVED_GRADE'
               AND fr.grading_outcome_snapshot = 'INCOMPLETE'
               AND fr.final_rating_snapshot = 4.00
          )`,
      [
        outcomeReason,
        gradeId,
        readiness.enrollment_subject_id,
        readiness.source.publication_id,
        sheetId,
        body.expected_sheet_record_version,
        readiness.source.original_roster_snapshot_id,
      ],
    );
  } finally {
    await connection.execute("SET @allow_approved_inc_expiry = NULL");
  }
  if (Number(updated.affectedRows) !== 1) {
    fail(
      409,
      "MODERN_INC_EXPIRY_GRADE_STALE",
      "Official INC grade changed during processing.",
    );
  }
  const [[currentGrade]] = await connection.execute(
    `SELECT grade_status, grading_outcome, overall_percentage, final_rating, remarks
       FROM grades WHERE grade_id = ?`,
    [gradeId],
  );
  const [[currentSubject]] = await connection.execute(
    "SELECT status FROM enrollment_subjects WHERE enrollment_subject_id = ?",
    [readiness.enrollment_subject_id],
  );
  if (
    currentGrade?.grade_status !== "Approved" ||
    currentGrade.grading_outcome !== "EXPIRED_INCOMPLETE" ||
    Number(currentGrade.final_rating) !== 5 ||
    currentGrade.overall_percentage !== null ||
    currentGrade.remarks !== "Failed" ||
    currentSubject?.status !== "Failed"
  ) {
    fail(
      409,
      "MODERN_INC_EXPIRY_TRIGGER_MISMATCH",
      "The database trigger did not create the required nonnumeric 5.00 Failed outcome.",
    );
  }

  const [amendment] = await connection.execute(
    `INSERT INTO gradebook_sheet_amendments
      (sheet_id, sheet_revision_number, amendment_type, grade_change_request_id,
       modern_inc_submission_id, roster_snapshot_id, amendment_reason,
       previous_values_summary, new_values_summary, progression_review_required,
       requested_by_user_id, authorized_by_user_id, authorized_at,
       verified_by_user_id, verified_at, applied_by_user_id, applied_at)
     VALUES (?, ?, 'INC_EXPIRY', NULL, NULL, ?, ?, ?, ?, 1, ?, ?, NOW(), ?, NOW(), ?, NOW())`,
    [
      sheetId,
      revision,
      readiness.source.original_roster_snapshot_id,
      reason,
      JSON.stringify(before),
      JSON.stringify(after),
      registrarId,
      registrarId,
      registrarId,
      registrarId,
    ],
  );
  if (Number(amendment.affectedRows) !== 1) {
    throw new Error("Official INC expiry amendment insert failed.");
  }

  const [expiryAction] = await connection.execute(
    `INSERT INTO gradebook_inc_expiry_actions
       (grade_id, sheet_id, amendment_id, deadline_on, expiry_reason, processed_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      gradeId,
      sheetId,
      String(amendment.insertId),
      readiness.policy_decision.deadline_on,
      reason,
      registrarId,
    ],
  );
  if (Number(expiryAction.affectedRows) !== 1) {
    throw new Error("INC expiry action insert failed.");
  }
  // Verify the expiry action, amendment, roster, and original publication agree.
  const [expiryLinks] = await connection.execute(
    `SELECT ea.expiry_id
       FROM gradebook_inc_expiry_actions ea
       JOIN gradebook_sheet_amendments am
         ON am.amendment_id = ea.amendment_id
        AND am.sheet_id = ea.sheet_id
       JOIN gradebook_finalized_roster fr
         ON fr.roster_snapshot_id = am.roster_snapshot_id
        AND fr.sheet_id = ea.sheet_id
        AND fr.grade_id = ea.grade_id
       JOIN grades g
         ON g.grade_id = fr.grade_id
        AND g.enrollment_subject_id = fr.enrollment_subject_id
       JOIN gradebook_official_sheets sh
         ON sh.sheet_id = ea.sheet_id
       JOIN gradebook_official_grade_publications pub
         ON pub.grade_id = g.grade_id
        AND pub.enrollment_subject_id = g.enrollment_subject_id
        AND pub.config_id = sh.config_id
       JOIN gradebook_grade_submission_attempts originalSubmission
         ON originalSubmission.submission_id = pub.combined_submission_id
        AND originalSubmission.grade_id = g.grade_id
        AND originalSubmission.sheet_id = sh.sheet_id
      WHERE ea.expiry_id = ?
        AND ea.grade_id = ?
        AND ea.sheet_id = ?
        AND ea.amendment_id = ?
        AND am.roster_snapshot_id = ?
        AND pub.publication_id = ?
        AND ea.processed_by_user_id = ?
        AND am.applied_by_user_id = ?
        AND ea.deadline_on = ?
        AND ea.expiry_reason = ?
        AND am.amendment_reason = ?
        AND am.sheet_revision_number = ?
        AND am.amendment_type = 'INC_EXPIRY'
        AND am.grade_change_request_id IS NULL
        AND am.modern_inc_submission_id IS NULL
        AND am.modern_score_correction_id IS NULL
        AND pub.publication_source = 'COMBINED_SEMESTER'
        AND pub.grading_outcome_snapshot = 'INCOMPLETE'
        AND originalSubmission.grading_outcome_snapshot = 'INCOMPLETE'
        AND sh.sheet_status = 'FINALIZED'
        AND fr.roster_disposition = 'APPROVED_GRADE'
        AND fr.grading_outcome_snapshot = 'INCOMPLETE'
        AND g.grade_status = 'Approved'
        AND g.grading_outcome = 'EXPIRED_INCOMPLETE'`,
    [
      String(expiryAction.insertId),
      gradeId,
      sheetId,
      String(amendment.insertId),
      readiness.source.original_roster_snapshot_id,
      readiness.source.publication_id,
      registrarId,
      registrarId,
      readiness.policy_decision.deadline_on,
      reason,
      reason,
      revision,
    ],
  );

  if (expiryLinks.length !== 1) {
    fail(
      409,
      "MODERN_INC_EXPIRY_AMENDMENT_SOURCE_INVALID",
      "The expiry action does not match its original grade, amendment, roster, and official publication.",
    );
  }
  const auditAfter = {
    ...after,
    amendment_id: String(amendment.insertId),
    expiry_id: String(expiryAction.insertId),
    sheet_revision_number: revision,
  };
  const [trail] = await connection.execute(
    `INSERT INTO audit_trail
       (user_id, table_name, record_id, action, old_values, new_values, created_at)
     VALUES (?, 'grades', ?, 'UPDATE', ?, ?, NOW())`,
    [registrarId, gradeId, JSON.stringify(before), JSON.stringify(auditAfter)],
  );
  const [log] = await connection.execute(
    `INSERT INTO audit_logs
       (user_id, action, table_name, record_id, description, created_at)
     VALUES (?, 'INC EXPIRY PROCESSED', 'grades', ?, ?, NOW())`,
    [registrarId, gradeId, JSON.stringify(auditAfter)],
  );
  if (Number(trail.affectedRows) !== 1 || Number(log.affectedRows) !== 1) {
    throw new Error("INC expiry auditing failed.");
  }

  return {
    success: true,
    dry_run: dryRun,
    persisted: !dryRun,
    grade_id: Number(gradeId),
    sheet_id: sheetId,
    original_roster_snapshot_id: readiness.source.original_roster_snapshot_id,
    amendment_id: dryRun ? null : String(amendment.insertId),
    expiry_id: dryRun ? null : String(expiryAction.insertId),
    sheet_revision_number: revision,
    expired_inc_deadline_on: readiness.policy_decision.deadline_on,
    previous_official_grade: before,
    proposed_official_grade: after,
    enrollment_subject_status_after_expiry: "Failed",
    original_snapshot_unchanged: true,
    official_sheet_unchanged: true,
    progression_review_required: true,
    grade_expiry_validated: true,
    grade_conversion_performed: !dryRun,
    official_grade_unchanged: dryRun,
  };
}
