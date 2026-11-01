import bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import db from "../db.js";
import {
  selectAvailableSection,
  SectionAssignmentError,
} from "./sectionAllocator.js";
import { sendStudentAccountInvitation } from "./studentAccountInvitationService.js";
/* Import Errors */

export class AdmissionImportError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "AdmissionImportError";
    this.code = code;
    this.status = status;
  }
}

function requiredId(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new AdmissionImportError(
      "INVALID_IMPORT_INPUT",
      `A valid ${label} is required.`,
      400,
    );
  }
  return number;
}

function normalizedText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value) {
  const text = normalizedText(value);
  return text || null;
}

/* Official Student Number */

async function nextStudentNumber(connection, prefix) {
  const [existing] = await connection.execute(
    `SELECT COALESCE(MAX(sequence_number), 0) AS last_sequence
     FROM (
       SELECT CAST(SUBSTRING(username, CHAR_LENGTH(?) + 1) AS UNSIGNED)
         AS sequence_number
       FROM users
       WHERE LEFT(username, CHAR_LENGTH(?)) = ?
         AND SUBSTRING(username, CHAR_LENGTH(?) + 1) REGEXP '^[0-9]+$'
       UNION ALL
       SELECT CAST(SUBSTRING(student_number, CHAR_LENGTH(?) + 1) AS UNSIGNED)
         AS sequence_number
       FROM students
       WHERE LEFT(student_number, CHAR_LENGTH(?)) = ?
         AND SUBSTRING(student_number, CHAR_LENGTH(?) + 1) REGEXP '^[0-9]+$'
     ) existing_numbers`,
    Array(8).fill(prefix),
  );

  const highest = Number(existing[0]?.last_sequence);
  if (!Number.isSafeInteger(highest) || highest < 0) {
    throw new AdmissionImportError(
      "NUMBER_SEQUENCE_ERROR",
      "Unable to read the official student-number sequence.",
      500,
    );
  }

  await connection.execute(
    `INSERT INTO student_number_counters (number_prefix, last_sequence)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE
       last_sequence = GREATEST(last_sequence, VALUES(last_sequence))`,
    [prefix, highest],
  );

  await connection.execute(
    `UPDATE student_number_counters
     SET last_sequence = LAST_INSERT_ID(last_sequence + 1)
     WHERE number_prefix = ?`,
    [prefix],
  );

  const [sequences] = await connection.execute(
    "SELECT LAST_INSERT_ID() AS sequence_number",
  );
  const sequence = Number(sequences[0]?.sequence_number);
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new AdmissionImportError(
      "NUMBER_SEQUENCE_ERROR",
      "Unable to allocate a safe student number.",
      500,
    );
  }

  return `${prefix}${String(sequence).padStart(4, "0")}`;
}

/* Duplicate Protection */

async function checkExistingIdentity(connection, applicant) {
  const email = normalizedText(applicant.email).toLowerCase();
  const firstName = normalizedText(applicant.firstName).toLowerCase();
  const lastName = normalizedText(applicant.lastName).toLowerCase();

  const [accounts] = await connection.execute(
    `SELECT user_id
     FROM users
     WHERE LOWER(TRIM(CONVERT(email USING utf8mb4)))
       COLLATE utf8mb4_general_ci =
       CONVERT(? USING utf8mb4) COLLATE utf8mb4_general_ci
     LIMIT 1
     FOR UPDATE`,
    [email],
  );
  if (accounts.length > 0) {
    throw new AdmissionImportError(
      "EXISTING_ACCOUNT",
      "A user account with this email already exists. Review the duplicate before importing.",
    );
  }

  const [students] = await connection.execute(
    `SELECT student_id
     FROM students
     WHERE birth_date = ?
       AND LOWER(TRIM(CONVERT(first_name USING utf8mb4)))
         COLLATE utf8mb4_general_ci =
         CONVERT(? USING utf8mb4) COLLATE utf8mb4_general_ci
       AND LOWER(TRIM(CONVERT(last_name USING utf8mb4)))
         COLLATE utf8mb4_general_ci =
         CONVERT(? USING utf8mb4) COLLATE utf8mb4_general_ci
     LIMIT 1
     FOR UPDATE`,
    [applicant.birthDate, firstName, lastName],
  );
  if (students.length > 0) {
    throw new AdmissionImportError(
      "POSSIBLE_DUPLICATE_STUDENT",
      "An existing student has the same name and birth date. Staff review is required.",
    );
  }
}

/* Verified Applicant Import */

// Import one verified New applicant in one transaction. A future bulk route
// can call this function for each selected application and report per-item results.
async function importVerifiedApplicantCore({
  applicationId,
  version,
  curriculumId,
  semesterId,
}) {
  const id = requiredId(applicationId, "application ID");
  const expectedVersion = requiredId(version, "application version");
  const selectedCurriculumId = requiredId(curriculumId, "curriculum ID");
  const selectedSemesterId = requiredId(semesterId, "semester ID");

  let connection;
  let identityLock = null;
  let committed = false;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // Lock the application so two staff imports cannot process it twice.
    const [applications] = await connection.execute(
      `SELECT
         admission_application_id AS applicationId,
         admission_period_id AS admissionPeriodId,
         application_status AS applicationStatus,
         first_name AS firstName,
         middle_name AS middleName,
         last_name AS lastName,
         DATE_FORMAT(birth_date, '%Y-%m-%d') AS birthDate,
         gender,
         contact_number AS contactNumber,
         email,
         house_no AS houseNo,
         street,
         barangay,
         city,
         province,
         zip_code AS zipCode,
         applicant_type AS applicantType,
         preferred_course_id AS courseId,
         privacy_accepted_at AS privacyAcceptedAt,
         submitted_at AS submittedAt,
         version,
         student_id AS studentId,
         imported_at AS importedAt
       FROM admission_applications
       WHERE admission_application_id = ?
       LIMIT 1
       FOR UPDATE`,
      [id],
    );

    if (applications.length === 0) {
      throw new AdmissionImportError(
        "APPLICATION_NOT_FOUND",
        "Admission application not found.",
        404,
      );
    }

    const applicant = applications[0];
    if (Number(applicant.version) !== expectedVersion) {
      throw new AdmissionImportError(
        "STALE_APPLICATION",
        "Application changed. Reload its details before importing.",
      );
    }

    if (
      applicant.applicationStatus !== "Verified" ||
      applicant.studentId !== null ||
      applicant.importedAt !== null
    ) {
      throw new AdmissionImportError(
        "NOT_IMPORTABLE",
        "Only verified applicants who have not already been imported can be imported.",
      );
    }

    // Transferees and returnees require an approved year-level placement.
    if (applicant.applicantType !== "New") {
      throw new AdmissionImportError(
        "MANUAL_PLACEMENT_REQUIRED",
        "Transferee and returnee year-level placement must be reviewed before import.",
      );
    }

    if (
      !applicant.privacyAcceptedAt ||
      !applicant.submittedAt ||
      !normalizedText(applicant.firstName) ||
      !normalizedText(applicant.lastName) ||
      !normalizedText(applicant.email) ||
      !applicant.birthDate ||
      !applicant.courseId
    ) {
      throw new AdmissionImportError(
        "INCOMPLETE_APPLICATION",
        "The verified application is missing required admission details.",
      );
    }

    // A verified status must be backed by the mandatory in-person review.
    const [reviews] = await connection.execute(
      `SELECT review_id
       FROM admission_verification_reviews
       WHERE admission_application_id = ?
         AND application_version = ?
         AND decision = 'Verified'
         AND in_person_confirmed = 1
         AND identity_checked = 1
         AND original_documents_checked = 1
         AND academic_records_checked = 1
       LIMIT 1`,
      [id, expectedVersion],
    );
    if (reviews.length === 0) {
      throw new AdmissionImportError(
        "VERIFICATION_MISSING",
        "The required in-person verification review was not found.",
      );
    }

    const [periods] = await connection.execute(
      `SELECT p.academic_year_id AS academicYearId,
              p.status AS periodStatus,
              ay.academic_year AS academicYear
       FROM admission_periods p
       JOIN academic_years ay
         ON ay.academic_year_id = p.academic_year_id
       WHERE p.admission_period_id = ?
       LIMIT 1`,
      [applicant.admissionPeriodId],
    );
    if (periods.length === 0 || periods[0].periodStatus !== "Published") {
      throw new AdmissionImportError(
        "INVALID_ADMISSION_PERIOD",
        "The application does not belong to a published admission period.",
      );
    }

    const [courses] = await connection.execute(
      `SELECT course_id, course_code, total_years
       FROM courses
       WHERE course_id = ?
       LIMIT 1`,
      [applicant.courseId],
    );
    if (courses.length === 0 || Number(courses[0].total_years) < 1) {
      throw new AdmissionImportError(
        "INVALID_COURSE",
        "The preferred course is not valid for first-year assignment.",
      );
    }

    const [curricula] = await connection.execute(
      `SELECT curriculum_id
       FROM curriculum
       WHERE curriculum_id = ?
         AND course_id = ?
         AND is_active = 1
       LIMIT 1`,
      [selectedCurriculumId, applicant.courseId],
    );
    if (curricula.length === 0) {
      throw new AdmissionImportError(
        "INVALID_CURRICULUM",
        "Choose an active curriculum belonging to the applicant's course.",
        400,
      );
    }

    const [semesters] = await connection.execute(
      `SELECT semester_id
       FROM semesters
       WHERE semester_id = ?
       LIMIT 1`,
      [selectedSemesterId],
    );
    if (semesters.length === 0) {
      throw new AdmissionImportError(
        "INVALID_SEMESTER",
        "Choose an existing semester.",
        400,
      );
    }

    const yearMatch = /^(\d{4})-/.exec(String(periods[0].academicYear));
    if (!yearMatch) {
      throw new AdmissionImportError(
        "INVALID_ACADEMIC_YEAR",
        "Academic-year format must begin with YYYY-.",
      );
    }

    // Serialize simultaneous imports of the same name and birth date.
    const identity = [
      normalizedText(applicant.firstName).toLowerCase(),
      normalizedText(applicant.lastName).toLowerCase(),
      applicant.birthDate,
    ].join("|");
    identityLock = `ptc-adm-${createHash("sha256").update(identity).digest("hex").slice(0, 40)}`;
    const [lockRows] = await connection.execute(
      "SELECT GET_LOCK(?, 10) AS acquired",
      [identityLock],
    );
    if (Number(lockRows[0]?.acquired) !== 1) {
      throw new AdmissionImportError(
        "IMPORT_BUSY",
        "Another import is checking this applicant. Try again shortly.",
      );
    }

    // Recheck inside the transaction. Do not rely on the earlier preview API.
    await checkExistingIdentity(connection, applicant);

    const yearLevel = 1;
    const assignment = await selectAvailableSection(connection, {
      courseId: applicant.courseId,
      academicYearId: periods[0].academicYearId,
      yearLevel,
    });

    const prefix = `${yearMatch[1].slice(2)}${courses[0].course_code}-`;
    const studentNumber = await nextStudentNumber(connection, prefix);

    // No predictable student-number password and no password in API responses.
    // A secure credential-issuance flow must be provided before student login.
    const randomPassword = randomBytes(32).toString("hex");
    const passwordHash = await bcrypt.hash(randomPassword, 12);

    const [users] = await connection.execute(
      `INSERT INTO users
         (username, email, password_hash, role_id, is_verified, is_active)
       VALUES (?, ?, ?, 5, 0, 1)`,
      [
        studentNumber,
        normalizedText(applicant.email).toLowerCase(),
        passwordHash,
      ],
    );

    const [students] = await connection.execute(
      `INSERT INTO students (
         user_id, student_number, first_name, middle_name, last_name,
         gender, birth_date, contact_number, course_id, section_id,
         academic_year_id, semester_id, status_id, year_level, admission_date
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, CURDATE())`,
      [
        Number(users.insertId),
        studentNumber,
        normalizedText(applicant.firstName),
        nullableText(applicant.middleName),
        normalizedText(applicant.lastName),
        applicant.gender,
        applicant.birthDate,
        nullableText(applicant.contactNumber),
        Number(applicant.courseId),
        assignment.sectionId,
        Number(periods[0].academicYearId),
        selectedSemesterId,
        yearLevel,
      ],
    );
    const studentId = Number(students.insertId);

    await connection.execute(
      `INSERT INTO student_addresses
         (student_id, house_no, street, barangay, city, province, zip_code)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        studentId,
        nullableText(applicant.houseNo),
        nullableText(applicant.street),
        nullableText(applicant.barangay),
        nullableText(applicant.city),
        nullableText(applicant.province),
        nullableText(applicant.zipCode),
      ],
    );

    await connection.execute(
      `INSERT INTO student_curriculum
         (student_id, curriculum_id, assigned_date, status, remarks)
       VALUES (?, ?, CURDATE(), 'Active', ?)`,
      [
        studentId,
        selectedCurriculumId,
        "Assigned during verified Admission import.",
      ],
    );

    const [updated] = await connection.execute(
      `UPDATE admission_applications
       SET application_status = 'Imported',
           student_id = ?,
           imported_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR),
           version = version + 1
       WHERE admission_application_id = ?
         AND application_status = 'Verified'
         AND version = ?
         AND student_id IS NULL
         AND imported_at IS NULL`,
      [studentId, id, expectedVersion],
    );
    if (updated.affectedRows !== 1) {
      throw new AdmissionImportError(
        "IMPORT_CONFLICT",
        "Application changed before import completed.",
      );
    }

    await connection.commit();
    committed = true;

    return {
      applicationId: id,
      applicationStatus: "Imported",
      version: expectedVersion + 1,
      studentId,
      invitationUserId: Number(users.insertId),
      studentNumber,
      courseId: Number(applicant.courseId),
      academicYearId: Number(periods[0].academicYearId),
      curriculumId: selectedCurriculumId,
      semesterId: selectedSemesterId,
      sectionId: assignment.sectionId,
      sectionName: assignment.sectionName,
      automaticallyAssigned: true,
      enrolled: false,
      credentialsIssued: false,
    };
  } catch (error) {
    if (connection && !committed) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("ADMISSION IMPORT ROLLBACK ERROR:", rollbackError);
      }
    }
    if (error instanceof SectionAssignmentError) {
      throw new AdmissionImportError(error.code, error.message, error.status);
    }
    if (error?.code === "ER_DUP_ENTRY") {
      throw new AdmissionImportError(
        "DUPLICATE_DATABASE_RECORD",
        "A matching account or student number already exists. No records were imported.",
      );
    }
    throw error;
  } finally {
    if (connection) {
      if (identityLock) {
        try {
          await connection.execute("SELECT RELEASE_LOCK(?)", [identityLock]);
        } catch (releaseError) {
          console.error(
            "ADMISSION IMPORT IDENTITY LOCK RELEASE ERROR:",
            releaseError,
          );
        }
      }
      connection.release();
    }
  }
}

/* Post-Import Account Invitation */

export async function importVerifiedApplicant(options) {
  // Complete the database transaction and release its locks before SMTP.
  const { invitationUserId, ...imported } =
    await importVerifiedApplicantCore(options);

  if (process.env.PTC_STUDENT_INVITATIONS_ENABLED !== "true") {
    return { ...imported, activationEmailStatus: "Disabled" };
  }

  try {
    const invitation = await sendStudentAccountInvitation({
      userId: invitationUserId,
    });
    return { ...imported, activationEmailStatus: invitation.emailStatus };
  } catch (error) {
    console.error(
      "ADMISSION IMPORT INVITATION ERROR:",
      typeof error?.code === "string" ? error.code : "INVITATION_FAILED",
    );
    // The student import is already committed; do not report the import as failed.
    return { ...imported, activationEmailStatus: "Failed" };
  }
}
