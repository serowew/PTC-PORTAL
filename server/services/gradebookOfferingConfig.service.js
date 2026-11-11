/**
 * Read-only offering configuration and PTC V1 policy validation.
 *
 * This module never creates gradebook rows or modifies historical grades.
 * Call with the project's mysql2/promise pool or transaction connection:
 *   await loadGradebookOfferingConfig(db, offeringId);
 */
import {
  GRADEBOOK_POLICY,
  GRADEBOOK_POLICY_VERSION,
  OFFICIAL_CATEGORY_WEIGHTS,
} from "./gradebookCalculation.service.js";

function fail(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function parseWholeNumber(value, name, { allowZero = false } = {}) {
  const text = String(value ?? "");

  if (!/^(0|[1-9]\d*)$/.test(text)) {
    fail("INVALID_GRADEBOOK_DATA", `${name} must be a nonnegative integer.`);
  }

  const result = Number(text);

  if (!Number.isSafeInteger(result) || (!allowZero && result === 0)) {
    fail("INVALID_GRADEBOOK_DATA", `${name} is out of range.`);
  }

  return result;
}

// Compare decimal percentages without floating-point rounding.
function hundredths(value, name) {
  const text = String(value ?? "").trim();

  if (!/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.test(text)) {
    fail(
      "INVALID_GRADEBOOK_POLICY",
      `${name} is not a valid decimal percentage.`,
    );
  }

  const [whole, fraction = ""] = text.split(".");

  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));

  if (result > 10000n) {
    fail("INVALID_GRADEBOOK_POLICY", `${name} cannot exceed 100%.`);
  }

  return result;
}

// Check every category against the fixed PTC V1 weights.
function verifyCategories(rows, classification, label) {
  const fixed = OFFICIAL_CATEGORY_WEIGHTS[classification];
  const expectedCodes = Object.keys(fixed);

  if (!Array.isArray(rows) || rows.length !== expectedCodes.length) {
    fail(
      "GRADEBOOK_POLICY_MISMATCH",
      `${label} does not contain every official category.`,
    );
  }

  const seen = new Set();
  let total = 0n;

  for (const row of rows) {
    const code = row.category_code;

    if (!Object.hasOwn(fixed, code) || seen.has(code)) {
      fail(
        "GRADEBOOK_POLICY_MISMATCH",
        `${label} has an unknown or duplicate category.`,
      );
    }

    seen.add(code);

    const amount = hundredths(row.category_percent, `${label} ${code}`);

    if (amount !== BigInt(fixed[code]) * 100n) {
      fail(
        "GRADEBOOK_POLICY_MISMATCH",
        `${label} ${code} does not match PTC V1.`,
      );
    }

    total += amount;
  }

  if (total !== 10000n || seen.size !== expectedCodes.length) {
    fail("GRADEBOOK_POLICY_MISMATCH", `${label} does not total exactly 100%.`);
  }
}

/**
 * Load and validate one offering's official grading configuration.
 *
 * When uninitialized, return expected categories without writing data.
 *
 * Existing configurations must match the original laboratory-hours
 * snapshot and all frozen category weights.
 *
 * @param {object} db mysql2 pool or transaction connection
 * @param {number|string} offeringId positive integer offering ID
 */
export async function loadGradebookOfferingConfig(db, offeringId) {
  if (!db || typeof db.execute !== "function") {
    fail(
      "INVALID_DATABASE_CONNECTION",
      "A mysql2 database connection is required.",
      500,
    );
  }

  const id = parseWholeNumber(offeringId, "offeringId");

  // Get the official subject classification.
  const [offerings] = await db.execute(
    `
      SELECT
        so.offering_id,
        so.subject_id,
        so.status AS offering_status,
        sub.subject_code,
        sub.subject_name,
        sub.laboratory_hours
      FROM subject_offerings so
      INNER JOIN subjects sub
        ON sub.subject_id = so.subject_id
      WHERE so.offering_id = ?
    `,
    [id],
  );

  if (offerings.length !== 1) {
    fail("OFFERING_NOT_FOUND", "Subject offering was not found.", 404);
  }

  const offering = offerings[0];

  const labHours = parseWholeNumber(
    offering.laboratory_hours,
    "subjects.laboratory_hours",
    { allowZero: true },
  );

  const classification = labHours > 0 ? "WITH_LABORATORY" : "PURE_LECTURE";

  // Read the official fixed category policy.
  const [policies] = await db.execute(
    `
      SELECT
        category_rule_id,
        category_code,
        category_name,
        category_percent,
        display_order
      FROM gradebook_policy_categories
      WHERE policy_version = ?
        AND grading_classification = ?
      ORDER BY display_order, category_code
    `,
    [GRADEBOOK_POLICY_VERSION, classification],
  );

  verifyCategories(policies, classification, "Official grading policy");

  // Check whether this offering already has a frozen configuration.
  const [configs] = await db.execute(
    `
      SELECT
        config_id,
        offering_id,
        grading_classification,
        laboratory_hours_snapshot,
        midterm_percent,
        final_term_percent
      FROM gradebook_offering_config
      WHERE offering_id = ?
    `,
    [id],
  );

  if (configs.length > 1) {
    fail(
      "GRADEBOOK_CONFIG_CONFLICT",
      "Multiple configs exist for this offering.",
    );
  }

  const expectedCategories = policies.map((row) => ({
    category_code: row.category_code,
    category_name: row.category_name,
    category_percent: String(row.category_percent),
    display_order: Number(row.display_order),
  }));

  const result = {
    offering_id: id,
    subject_id: Number(offering.subject_id),
    subject_code: offering.subject_code,
    subject_name: offering.subject_name,
    offering_status: offering.offering_status,

    laboratory_hours: labHours,
    grading_classification: classification,

    grading_policy: GRADEBOOK_POLICY,
    policy_version: GRADEBOOK_POLICY_VERSION,

    midterm_percent: "50.00",
    final_term_percent: "50.00",

    categories: expectedCategories,
  };

  // No configuration exists yet. Do not create one here.
  if (configs.length === 0) {
    return {
      ...result,
      is_initialized: false,
      config_id: null,
    };
  }

  const config = configs[0];

  const storedHours = parseWholeNumber(
    config.laboratory_hours_snapshot,
    "config.laboratory_hours_snapshot",
    { allowZero: true },
  );

  // Prevent silent changes to frozen subject classification.
  if (
    config.grading_classification !== classification ||
    storedHours !== labHours
  ) {
    fail(
      "GRADEBOOK_CLASSIFICATION_CHANGED",
      "The subject laboratory hours differ from the frozen gradebook classification.",
    );
  }

  // Midterm and Final Term must remain 50/50.
  if (
    hundredths(config.midterm_percent, "midterm_percent") !== 5000n ||
    hundredths(config.final_term_percent, "final_term_percent") !== 5000n
  ) {
    fail(
      "GRADEBOOK_TERM_WEIGHT_MISMATCH",
      "Official Midterm and Final Term must each be 50%.",
    );
  }

  const configId = parseWholeNumber(config.config_id, "config_id");

  // Validate the offering's frozen categories.
  const [snapshots] = await db.execute(
    `
      SELECT *
      FROM gradebook_offering_categories
      WHERE config_id = ?
    `,
    [configId],
  );

  verifyCategories(snapshots, classification, "Offering category snapshot");

  // Each frozen category must reference its original V1 rule.
  const officialRules = new Map(
    policies.map((row) => [row.category_code, Number(row.category_rule_id)]),
  );

  for (const row of snapshots) {
    if (
      Number(row.source_category_rule_id) !==
      officialRules.get(row.category_code)
    ) {
      fail(
        "GRADEBOOK_POLICY_MISMATCH",
        `Offering category ${row.category_code} does not reference its official V1 policy rule.`,
      );
    }
  }

  return {
    ...result,
    is_initialized: true,
    config_id: configId,
  };
}
