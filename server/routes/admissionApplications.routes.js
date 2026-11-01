import express from "express";
import db from "../db.js";
import authenticate from "../middleware/authenticate.js";
import requireRole from "../middleware/requireRole.js";
import { InputError, respondError } from "../utils/admissionPhase1.js";

import {
  importVerifiedApplicant,
  AdmissionImportError,
} from "../services/admissionImportService.js";

import {
  sendStudentAccountInvitation as issueAdmissionActivationInvitation,
  StudentInvitationError as AdmissionActivationInvitationError,
} from "../services/studentAccountInvitationService.js";

const router = express.Router();

const allowedStatuses = new Set([
  "Submitted",
  "Needs Correction",
  "Verified",
  "Rejected",
  "Imported",
]);

const reviewTransitions = {
  Submitted: new Set(["Verified", "Needs Correction", "Rejected"]),
  "Needs Correction": new Set(["Verified", "Rejected"]),
};

/* Access Control */

router.use(authenticate, requireRole("Admin", "Registrar"));

router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

/* Helpers */

function positiveInteger(value, fallback, maximum) {
  if (value === undefined) return fallback;

  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    return null;
  }

  return parsed;
}

function escapeLike(value) {
  return value.replace(/[!%_]/g, (character) => `!${character}`);
}

function reviewFlag(body, key) {
  const value = body[key];

  if (value === undefined) return false;

  if (typeof value !== "boolean") {
    throw new InputError(`${key} must be true or false.`);
  }

  return value;
}

/* Admission Applications Queue */

router.get("/", async (req, res) => {
  try {
    const page = positiveInteger(req.query.page, 1, 100000);

    const limit = positiveInteger(req.query.limit, 20, 100);

    const periodId =
      req.query.periodId === undefined
        ? null
        : positiveInteger(req.query.periodId, null, Number.MAX_SAFE_INTEGER);

    const status =
      req.query.status === undefined ? "Submitted" : req.query.status;

    const search = req.query.search === undefined ? "" : req.query.search;

    if (
      page === null ||
      limit === null ||
      (req.query.periodId !== undefined && periodId === null)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid pagination or admission period ID.",
      });
    }

    if (typeof status !== "string" || !allowedStatuses.has(status)) {
      return res.status(400).json({
        success: false,
        message: "Select a valid application status.",
      });
    }

    if (typeof search !== "string" || search.trim().length > 100) {
      return res.status(400).json({
        success: false,
        message: "Search must contain at most 100 characters.",
      });
    }

    const conditions = ["a.application_status = ?"];

    const parameters = [status];

    if (periodId !== null) {
      conditions.push("a.admission_period_id = ?");

      parameters.push(periodId);
    }

    const trimmedSearch = search.trim();

    if (trimmedSearch) {
      const term = `%${escapeLike(trimmedSearch)}%`;

      conditions.push(`
        (
          a.application_reference LIKE ? ESCAPE '!'
          OR a.first_name LIKE ? ESCAPE '!'
          OR a.last_name LIKE ? ESCAPE '!'
          OR a.email LIKE ? ESCAPE '!'
          OR CONCAT_WS(
            ' ',
            a.first_name,
            a.middle_name,
            a.last_name
          ) LIKE ? ESCAPE '!'
        )
      `);

      parameters.push(term, term, term, term, term);
    }

    const where = conditions.join(" AND ");
    const offset = (page - 1) * limit;

    const [countRows] = await db.execute(
      `
        SELECT COUNT(*) AS total
        FROM admission_applications a
        WHERE ${where}
      `,
      parameters,
    );

    const total = Number(countRows[0]?.total ?? 0);

    const [applications] = await db.execute(
      `
        SELECT
          a.admission_application_id AS applicationId,
          a.application_reference AS applicationReference,
          a.application_status AS applicationStatus,
          a.first_name AS firstName,
          a.middle_name AS middleName,
          a.last_name AS lastName,
          a.email,
          a.contact_number AS contactNumber,
          a.applicant_type AS applicantType,
          a.preferred_course_id AS preferredCourseId,
          c.course_code AS courseCode,
          c.course_name AS courseName,
          a.admission_period_id AS admissionPeriodId,
          p.title AS periodTitle,
          DATE_FORMAT(
            a.submitted_at,
            '%Y-%m-%dT%H:%i:%s'
          ) AS submittedAt,
          a.version,
          a.student_id AS studentId,
          DATE_FORMAT(
            a.imported_at,
            '%Y-%m-%dT%H:%i:%s'
          ) AS importedAt
        FROM admission_applications a
        JOIN admission_periods p
          ON p.admission_period_id =
             a.admission_period_id
        LEFT JOIN courses c
          ON c.course_id =
             a.preferred_course_id
        WHERE ${where}
        ORDER BY
          a.submitted_at DESC,
          a.admission_application_id DESC
        LIMIT ? OFFSET ?
      `,
      [...parameters, limit, offset],
    );

    return res.json({
      success: true,
      applications,
      filters: {
        status,
        search: trimmedSearch,
        periodId,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("LIST ADMISSION APPLICATIONS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load admission applications.",
    });
  }
});

/* Applicant Details */

router.get("/:id", async (req, res) => {
  try {
    const applicationId = positiveInteger(
      req.params.id,
      null,
      Number.MAX_SAFE_INTEGER,
    );

    if (applicationId === null) {
      return res.status(400).json({
        success: false,
        message: "Invalid admission application ID.",
      });
    }

    const [rows] = await db.execute(
      `
        SELECT
          a.admission_application_id AS applicationId,
          a.application_reference AS applicationReference,
          a.application_status AS applicationStatus,
          a.first_name AS firstName,
          a.middle_name AS middleName,
          a.last_name AS lastName,
          a.suffix,
          DATE_FORMAT(
            a.birth_date,
            '%Y-%m-%d'
          ) AS birthDate,
          a.gender,
          a.contact_number AS contactNumber,
          a.email,
          a.house_no AS houseNo,
          a.street,
          a.barangay,
          a.city,
          a.province,
          a.zip_code AS zipCode,
          a.previous_school AS previousSchool,
          a.applicant_type AS applicantType,
          a.preferred_course_id AS preferredCourseId,
          c.course_code AS courseCode,
          c.course_name AS courseName,
          a.admission_period_id AS admissionPeriodId,
          p.title AS periodTitle,
          ay.academic_year AS academicYear,
          CASE
            WHEN a.privacy_accepted_at IS NULL
              THEN 0
            ELSE 1
          END AS privacyAccepted,
          DATE_FORMAT(
            a.privacy_accepted_at,
            '%Y-%m-%dT%H:%i:%s'
          ) AS privacyAcceptedAt,
          DATE_FORMAT(
            a.submitted_at,
            '%Y-%m-%dT%H:%i:%s'
          ) AS submittedAt,
          a.version,
          a.student_id AS studentId,
          DATE_FORMAT(
            a.imported_at,
            '%Y-%m-%dT%H:%i:%s'
          ) AS importedAt
        FROM admission_applications a
        JOIN admission_periods p
          ON p.admission_period_id =
             a.admission_period_id
        JOIN academic_years ay
          ON ay.academic_year_id =
             p.academic_year_id
        LEFT JOIN courses c
          ON c.course_id =
             a.preferred_course_id
        WHERE a.admission_application_id = ?
          AND a.application_status IN (
            'Submitted',
            'Needs Correction',
            'Verified',
            'Rejected',
            'Imported'
          )
        LIMIT 1
      `,
      [applicationId],
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Admission application not found.",
      });
    }

    const application = rows[0];

    application.privacyAccepted = Boolean(application.privacyAccepted);

    return res.json({
      success: true,
      application,
    });
  } catch (error) {
    console.error("GET ADMISSION APPLICATION ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load admission application details.",
    });
  }
});

/* In-Person Verification */

router.post("/:id/review", async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const applicationId = positiveInteger(
      req.params.id,
      null,
      Number.MAX_SAFE_INTEGER,
    );

    if (applicationId === null) {
      throw new InputError("Invalid admission application ID.");
    }

    const body = req.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new InputError("A verification review is required.");
    }

    const version = body.version;

    if (!Number.isSafeInteger(version) || version < 1) {
      throw new InputError("Provide the current application version.");
    }

    const decision = body.decision;

    if (!["Verified", "Needs Correction", "Rejected"].includes(decision)) {
      throw new InputError("Choose a valid verification decision.");
    }

    const inPersonConfirmed = reviewFlag(body, "inPersonConfirmed");

    const identityChecked = reviewFlag(body, "identityChecked");

    const originalDocumentsChecked = reviewFlag(
      body,
      "originalDocumentsChecked",
    );

    const academicRecordsChecked = reviewFlag(body, "academicRecordsChecked");

    const reviewNotes = body.reviewNotes === undefined ? "" : body.reviewNotes;

    if (typeof reviewNotes !== "string" || reviewNotes.trim().length > 1000) {
      throw new InputError(
        "Review notes must contain at most 1000 characters.",
      );
    }

    const notes = reviewNotes.trim();

    if (
      decision === "Verified" &&
      !(
        inPersonConfirmed &&
        identityChecked &&
        originalDocumentsChecked &&
        academicRecordsChecked
      )
    ) {
      throw new InputError(
        "Verification requires an in-person visit, identity check, original documents, and academic record checks.",
      );
    }

    if (decision !== "Verified" && !notes) {
      throw new InputError(
        "Review notes are required for correction or rejection.",
      );
    }

    const reviewedBy = Number(req.user?.user_id);

    if (!Number.isSafeInteger(reviewedBy) || reviewedBy < 1) {
      throw new InputError("Authenticated staff account is required.", 403);
    }

    connection = await db.getConnection();

    await connection.beginTransaction();
    transactionStarted = true;

    const [rows] = await connection.execute(
      `
        SELECT
          application_status AS applicationStatus,
          version,
          submitted_at AS submittedAt,
          privacy_accepted_at AS privacyAcceptedAt,
          preferred_course_id AS preferredCourseId,
          student_id AS studentId,
          imported_at AS importedAt
        FROM admission_applications
        WHERE admission_application_id = ?
        LIMIT 1 FOR UPDATE
      `,
      [applicationId],
    );

    if (!rows.length) {
      throw new InputError("Admission application not found.", 404);
    }

    const application = rows[0];

    if (Number(application.version) !== version) {
      throw new InputError(
        "Application changed. Reload its details and retry.",
        409,
      );
    }

    if (!reviewTransitions[application.applicationStatus]?.has(decision)) {
      throw new InputError(
        "This application status cannot transition to the selected decision.",
        409,
      );
    }

    if (application.studentId !== null || application.importedAt !== null) {
      throw new InputError(
        "An already imported application cannot be reviewed.",
        409,
      );
    }

    if (
      decision === "Verified" &&
      (!application.submittedAt ||
        !application.privacyAcceptedAt ||
        !application.preferredCourseId)
    ) {
      throw new InputError(
        "The application is incomplete and cannot be verified.",
        409,
      );
    }

    const [updated] = await connection.execute(
      `
        UPDATE admission_applications
        SET
          application_status = ?,
          version = version + 1
        WHERE admission_application_id = ?
          AND application_status = ?
          AND version = ?
          AND student_id IS NULL
          AND imported_at IS NULL
      `,
      [decision, applicationId, application.applicationStatus, version],
    );

    if (updated.affectedRows !== 1) {
      throw new InputError(
        "Application changed. Reload its details and retry.",
        409,
      );
    }

    const newVersion = version + 1;

    const [review] = await connection.execute(
      `
        INSERT INTO admission_verification_reviews (
          admission_application_id,
          reviewed_by,
          decision,
          status_before,
          application_version,
          in_person_confirmed,
          identity_checked,
          original_documents_checked,
          academic_records_checked,
          review_notes,
          reviewed_at
        )
        VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          DATE_ADD(
            UTC_TIMESTAMP(),
            INTERVAL 8 HOUR
          )
        )
      `,
      [
        applicationId,
        reviewedBy,
        decision,
        application.applicationStatus,
        newVersion,
        Number(inPersonConfirmed),
        Number(identityChecked),
        Number(originalDocumentsChecked),
        Number(academicRecordsChecked),
        notes,
      ],
    );

    await connection.commit();
    transactionStarted = false;

    return res.json({
      success: true,
      applicationId,
      applicationStatus: decision,
      version: newVersion,
      reviewId: review.insertId,
      message:
        decision === "Verified"
          ? "In-person verification recorded. The applicant has not been enrolled or imported."
          : "Registrar review recorded.",
    });
  } catch (error) {
    if (transactionStarted && connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("ADMISSION REVIEW ROLLBACK ERROR:", rollbackError);
      }
    }

    return respondError(res, error, "REVIEW ADMISSION APPLICATION ERROR:");
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

/* Duplicate Student Screening */

router.get("/:id/duplicates", async (req, res) => {
  try {
    const applicationId = positiveInteger(
      req.params.id,
      null,
      Number.MAX_SAFE_INTEGER,
    );

    if (applicationId === null) {
      return res.status(400).json({
        success: false,
        message: "Invalid admission application ID.",
      });
    }

    const [applications] = await db.execute(
      `
        SELECT
          admission_application_id AS applicationId,
          application_status AS applicationStatus,
          first_name AS firstName,
          last_name AS lastName,
          DATE_FORMAT(
            birth_date,
            '%Y-%m-%d'
          ) AS birthDate,
          email,
          student_id AS studentId
        FROM admission_applications
        WHERE admission_application_id = ?
          AND application_status IN (
            'Submitted',
            'Needs Correction',
            'Verified'
          )
        LIMIT 1
      `,
      [applicationId],
    );

    if (!applications.length) {
      return res.status(404).json({
        success: false,
        message: "Application not found or not eligible for screening.",
      });
    }

    const applicant = applications[0];

    const email = applicant.email.trim().toLowerCase();
    const firstName = applicant.firstName.trim().toLowerCase();
    const lastName = applicant.lastName.trim().toLowerCase();
    const birthDate = applicant.birthDate;

    // Match existing students, including archived students.
    const [studentRows] = await db.execute(
      `
        SELECT
          s.student_id AS studentId,
          s.student_number AS studentNumber,
          s.first_name AS firstName,
          s.last_name AS lastName,
          DATE_FORMAT(
            s.birth_date,
            '%Y-%m-%d'
          ) AS birthDate,
          s.is_archived AS isArchived,
          u.email
        FROM students s
        LEFT JOIN users u
          ON u.user_id = s.user_id
        WHERE
          (
            LOWER(
              TRIM(CONVERT(u.email USING utf8mb4))
            ) COLLATE utf8mb4_general_ci =
            CONVERT(? USING utf8mb4)
              COLLATE utf8mb4_general_ci
          )
          OR
          (
            s.birth_date = ?
            AND LOWER(
              TRIM(CONVERT(s.first_name USING utf8mb4))
            ) COLLATE utf8mb4_general_ci =
            CONVERT(? USING utf8mb4)
              COLLATE utf8mb4_general_ci
            AND LOWER(
              TRIM(CONVERT(s.last_name USING utf8mb4))
            ) COLLATE utf8mb4_general_ci =
            CONVERT(? USING utf8mb4)
              COLLATE utf8mb4_general_ci
          )
        ORDER BY s.student_id ASC
        LIMIT 20
      `,
      [email, birthDate, firstName, lastName],
    );

    // Find matching accounts that have no student profile.
    const [accountRows] = await db.execute(
      `
        SELECT
          u.user_id AS userId,
          u.email
        FROM users u
        WHERE LOWER(
          TRIM(CONVERT(u.email USING utf8mb4))
        ) COLLATE utf8mb4_general_ci =
          CONVERT(? USING utf8mb4)
            COLLATE utf8mb4_general_ci
          AND NOT EXISTS (
            SELECT 1
            FROM students s
            WHERE s.user_id = u.user_id
          )
        ORDER BY u.user_id ASC
        LIMIT 20
      `,
      [email],
    );

    const existingStudents = studentRows.map((row) => ({
      studentId: row.studentId,
      studentNumber: row.studentNumber,
      firstName: row.firstName,
      lastName: row.lastName,
      birthDate: row.birthDate,
      email: row.email,
      isArchived: Boolean(row.isArchived),
    }));

    const existingAccounts = accountRows.map((row) => ({
      userId: row.userId,
      email: row.email,
    }));

    const hasPotentialDuplicate =
      existingStudents.length > 0 || existingAccounts.length > 0;

    return res.json({
      success: true,
      applicationId,
      applicationStatus: applicant.applicationStatus,
      hasPotentialDuplicate,
      existingStudents,
      existingAccounts,
      importEligibleStatus: applicant.applicationStatus === "Verified",
      message: hasPotentialDuplicate
        ? "Possible duplicate records found. Staff review is required before import."
        : "No potential duplicate found in the initial screening.",
      note: "This is a read-only preliminary check. The actual import must repeat duplicate checks inside its database transaction.",
    });
  } catch (error) {
    console.error("ADMISSION DUPLICATE SCREENING ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to check for existing student records.",
    });
  }
});

/* Verified Applicant Import */

router.post("/:id/import", async (req, res) => {
  const applicationId = positiveInteger(
    req.params.id,
    null,
    Number.MAX_SAFE_INTEGER,
  );

  if (applicationId === null) {
    return res.status(400).json({
      success: false,
      message: "Invalid admission application ID.",
    });
  }

  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({
      success: false,
      message: "A JSON request body is required.",
    });
  }

  const { version, curriculumId, semesterId } = body;

  if (
    !Number.isSafeInteger(version) ||
    version <= 0 ||
    !Number.isSafeInteger(curriculumId) ||
    curriculumId <= 0 ||
    !Number.isSafeInteger(semesterId) ||
    semesterId <= 0
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Valid numeric version, curriculumId and semesterId are required.",
    });
  }

  try {
    const result = await importVerifiedApplicant({
      applicationId,
      version,
      curriculumId,
      semesterId,
    });

    return res.status(201).json({
      success: true,
      message:
        "Verified applicant imported successfully. No enrollment was created.",
      ...result,
    });
  } catch (error) {
    if (error instanceof AdmissionImportError) {
      return res.status(error.status).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }

    console.error("ADMISSION IMPORT ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to import the verified applicant.",
    });
  }
});

/* Verified Applicant Bulk Import */

router.post("/bulk-import", async (req, res) => {
  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({
      success: false,
      message: "A JSON request body is required.",
    });
  }

  if (body.confirm !== true) {
    return res.status(400).json({
      success: false,
      message: "Explicit import confirmation is required.",
    });
  }

  const { items } = body;

  if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
    return res.status(400).json({
      success: false,
      message: "Select between 1 and 20 verified applications per batch.",
    });
  }

  const seen = new Set();

  for (const item of items) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      !Number.isSafeInteger(item.applicationId) ||
      item.applicationId <= 0 ||
      !Number.isSafeInteger(item.version) ||
      item.version <= 0 ||
      !Number.isSafeInteger(item.curriculumId) ||
      item.curriculumId <= 0 ||
      !Number.isSafeInteger(item.semesterId) ||
      item.semesterId <= 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Each item requires positive numeric applicationId, version, curriculumId and semesterId.",
      });
    }

    if (seen.has(item.applicationId)) {
      return res.status(400).json({
        success: false,
        message:
          "The same admission application cannot appear twice in one batch.",
      });
    }

    seen.add(item.applicationId);
  }

  const results = [];
  let imported = 0;

  // Each applicant is imported in its own transaction.
  for (const item of items) {
    try {
      const result = await importVerifiedApplicant({
        applicationId: item.applicationId,
        version: item.version,
        curriculumId: item.curriculumId,
        semesterId: item.semesterId,
      });

      imported += 1;
      results.push({ success: true, ...result });
    } catch (error) {
      if (error instanceof AdmissionImportError) {
        results.push({
          success: false,
          applicationId: item.applicationId,
          code: error.code,
          message: error.message,
        });
      } else {
        console.error("BULK ADMISSION IMPORT ITEM ERROR:", error);
        results.push({
          success: false,
          applicationId: item.applicationId,
          code: "IMPORT_FAILED",
          message:
            "This applicant could not be imported. Check the server logs.",
        });
      }
    }
  }

  return res.status(200).json({
    success: true,
    allImported: imported === items.length,
    message:
      imported === items.length
        ? "All selected verified applicants were imported. No enrollments were created."
        : "Batch processed. Review the per-applicant results before retrying failed items.",
    summary: {
      requested: items.length,
      imported,
      failed: items.length - imported,
    },
    results,
  });
});

/* Imported Student Activation Invitation */

router.post("/:id/activation-invitation", async (req, res) => {
  const applicationId = positiveInteger(
    req.params.id,
    null,
    Number.MAX_SAFE_INTEGER,
  );

  if (applicationId === null) {
    return res.status(400).json({
      success: false,
      code: "INVALID_APPLICATION_ID",
      message: "A valid admission application ID is required.",
    });
  }

  const body = req.body === undefined ? {} : req.body;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    (body.forceResend !== undefined && typeof body.forceResend !== "boolean")
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_INVITATION_INPUT",
      message: "Use an optional boolean forceResend in the JSON body.",
    });
  }

  if (process.env.PTC_STUDENT_INVITATIONS_ENABLED !== "true") {
    return res.status(503).json({
      success: false,
      code: "INVITATIONS_DISABLED",
      message: "Student account invitations are currently disabled.",
    });
  }

  try {
    const [rows] = await db.execute(
      `SELECT u.user_id AS userId
       FROM admission_applications a
       JOIN students s ON s.student_id = a.student_id
       JOIN users u ON u.user_id = s.user_id
       WHERE a.admission_application_id = ?
         AND a.application_status = 'Imported'
         AND a.imported_at IS NOT NULL
         AND u.role_id = 5
         AND u.is_active = 1
         AND u.is_archived = 0
       LIMIT 1`,
      [applicationId],
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        code: "IMPORTED_STUDENT_NOT_FOUND",
        message: "No eligible imported student account was found for this application.",
      });
    }

    const invitation = await issueAdmissionActivationInvitation({
      userId: Number(rows[0].userId),
      forceResend: body.forceResend === true,
    });

    if (invitation.emailStatus === "Failed") {
      return res.status(502).json({
        success: false,
        code: "INVITATION_DELIVERY_FAILED",
        applicationId,
        studentNumber: invitation.username,
        activationEmailStatus: "Failed",
        message: "Account preserved, but the email could not be sent. Check SMTP and retry after the cooldown.",
      });
    }

    return res.status(200).json({
      success: true,
      applicationId,
      studentNumber: invitation.username,
      activationEmailStatus: invitation.emailStatus,
      message: invitation.emailStatus === "Sent"
        ? "The activation invitation was accepted by the SMTP server."
        : invitation.emailStatus === "AlreadySent"
          ? "A valid activation invitation was already sent. Use resend only if a new link is needed."
          : "The student's account is already activated; no email was sent.",
    });
  } catch (error) {
    if (error instanceof AdmissionActivationInvitationError) {
      return res.status(error.status).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }

    console.error(
      "REGISTRAR STUDENT INVITATION ERROR:",
      typeof error?.code === "string" ? error.code : "UNEXPECTED_ERROR",
    );
    return res.status(500).json({
      success: false,
      code: "INVITATION_UNAVAILABLE",
      message: "Unable to issue the student activation invitation.",
    });
  }
});

export default router;
