/**
 * Initializes a V1 gradebook in one database transaction.
 *
 * The offering, subject and its enrollment-subject rows are locked before
 * checking grade history or writing configuration snapshots. The foreign keys
 * from enrollment_subjects to subject_offerings and from grades to
 * enrollment_subjects are required for the lock coordination described here.
 *
 * Only gradebook_offering_config and gradebook_offering_categories are written.
 */
import { loadGradebookOfferingConfig } from "./gradebookOfferingConfig.service.js";
import { GRADEBOOK_POLICY_VERSION } from "./gradebookCalculation.service.js";

function fail(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, details);
  throw error;
}

function positiveId(value, label) {
  const text = String(value ?? "").trim();

  if (!/^[1-9]\d*$/.test(text)) {
    fail(
      "INVALID_GRADEBOOK_INPUT",
      `${label} must be a positive integer.`,
      400,
    );
  }

  const number = Number(text);

  if (!Number.isSafeInteger(number)) {
    fail("INVALID_GRADEBOOK_INPUT", `${label} is out of range.`, 400);
  }

  return number;
}

export async function initializeGradebookOffering(
  pool,
  offeringId,
  actorUserId,
  { dryRun = false } = {},
) {
  if (!pool || typeof pool.getConnection !== "function") {
    fail("INVALID_DATABASE_POOL", "A mysql2 connection pool is required.", 500);
  }

  if (typeof dryRun !== "boolean") {
    fail("INVALID_GRADEBOOK_INPUT", "dryRun must be a boolean.", 400);
  }

  const id = positiveId(offeringId, "offeringId");
  const actorId = positiveId(actorUserId, "actorUserId");

  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    // Lock the offering during initialization.
    const [offerings] = await connection.execute(
      `SELECT
         offering_id,
         subject_id,
         faculty_id,
         status
       FROM subject_offerings
       WHERE offering_id = ?
       FOR UPDATE`,
      [id],
    );

    if (offerings.length !== 1) {
      fail("OFFERING_NOT_FOUND", "Subject offering was not found.", 404);
    }

    const offering = offerings[0];

    // Keep laboratory hours stable while taking the policy snapshot.
    const [subjects] = await connection.execute(
      `SELECT subject_id
       FROM subjects
       WHERE subject_id = ?
       FOR UPDATE`,
      [offering.subject_id],
    );

    if (subjects.length !== 1) {
      fail("SUBJECT_NOT_FOUND", "Offering subject was not found.", 404);
    }

    // Only the active assigned instructor may initialize.
    const [instructors] = await connection.execute(
      `SELECT
         f.user_id,
         u.is_active,
         u.is_archived,
         r.role_name
       FROM faculty f
       JOIN users u
         ON u.user_id = f.user_id
       JOIN roles r
         ON r.role_id = u.role_id
       WHERE f.faculty_id = ?`,
      [offering.faculty_id ?? 0],
    );

    const instructor = instructors[0];

    if (
      !instructor ||
      Number(instructor.user_id) !== actorId ||
      Number(instructor.is_active) !== 1 ||
      Number(instructor.is_archived) !== 0 ||
      !["Faculty", "Program Head"].includes(instructor.role_name)
    ) {
      fail(
        "GRADEBOOK_INSTRUCTOR_REQUIRED",
        "Only the active assigned instructor can initialize this gradebook.",
        403,
      );
    }

    // Validate the official policy and any existing configuration.
    const current = await loadGradebookOfferingConfig(connection, id);

    // An initialized gradebook is an idempotent no-op.
    // Grades may legitimately exist after initial configuration.
    if (current.is_initialized) {
      if (dryRun) {
        await connection.rollback();
      } else {
        await connection.commit();
      }

      transactionStarted = false;

      return {
        ...current,
        created: false,
        dry_run: dryRun,
        persisted: true,
      };
    }

    if (offering.status !== "Open") {
      fail("OFFERING_NOT_OPEN", "Only Open offerings can be initialized.");
    }

    // Lock current enrollment-subject rows for this offering.
    // Grade inserts reference these rows through a foreign key.
    const [assigned] = await connection.execute(
      `SELECT enrollment_subject_id
       FROM enrollment_subjects
       WHERE offering_id = ?
       ORDER BY enrollment_subject_id
       FOR UPDATE`,
      [id],
    );

    // Authoritative history check inside the same transaction.
    // This is a locking read, not a separate preflight query.
    const [existingGrades] = await connection.execute(
      `SELECT g.grade_id
       FROM grades g
       JOIN enrollment_subjects es
         ON es.enrollment_subject_id = g.enrollment_subject_id
       WHERE es.offering_id = ?
       ORDER BY g.grade_id
       FOR UPDATE`,
      [id],
    );

    if (existingGrades.length > 0) {
      fail(
        "HISTORICAL_GRADES_EXIST",
        `Offering ${id} already contains ${existingGrades.length} grade record(s).`,
        409,
        {
          existing_grade_count: existingGrades.length,
        },
      );
    }

    // Create the official offering configuration.
    const [insert] = await connection.execute(
      `INSERT INTO gradebook_offering_config (
         offering_id,
         grading_classification,
         laboratory_hours_snapshot,
         midterm_percent,
         final_term_percent,
         created_by_user_id
       )
       VALUES (?, ?, ?, '50.00', '50.00', ?)`,
      [id, current.grading_classification, current.laboratory_hours, actorId],
    );

    const configId = Number(insert.insertId);

    if (!Number.isSafeInteger(configId) || configId <= 0) {
      fail("GRADEBOOK_INIT_FAILED", "Configuration ID was not created.", 500);
    }

    // Freeze official V1 categories for this offering.
    const [categories] = await connection.execute(
      `INSERT INTO gradebook_offering_categories (
         config_id,
         source_category_rule_id,
         category_code,
         category_name,
         category_percent,
         display_order
       )
       SELECT
         ?,
         category_rule_id,
         category_code,
         category_name,
         category_percent,
         display_order
       FROM gradebook_policy_categories
       WHERE policy_version = ?
         AND grading_classification = ?
       ORDER BY display_order, category_code`,
      [configId, GRADEBOOK_POLICY_VERSION, current.grading_classification],
    );

    if (Number(categories.affectedRows) !== current.categories.length) {
      fail("GRADEBOOK_INIT_FAILED", "Category snapshot count mismatch.", 500);
    }

    // Verify all inserted records before committing.
    const verified = await loadGradebookOfferingConfig(connection, id);

    if (!verified.is_initialized || verified.config_id !== configId) {
      fail(
        "GRADEBOOK_INIT_FAILED",
        "Initialized configuration failed validation.",
        500,
      );
    }

    if (dryRun) {
      await connection.rollback();
    } else {
      await connection.commit();
    }

    transactionStarted = false;

    return {
      ...verified,
      created: true,
      dry_run: dryRun,
      persisted: !dryRun,
      enrollment_subject_count_at_init: assigned.length,
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        error.rollback_error = rollbackError.message;
      }
    }

    throw error;
  } finally {
    connection.release();
  }
}
