import express from "express";
import { randomBytes, createHash } from "node:crypto";
import db from "../db.js";
import {
  StudentInvitationError,
  inspectStudentAccountInvitation,
  activateStudentAccount,
} from "../services/studentAccountInvitationService.js";
import {
  InputError,
  MANILA_NOW_SQL,
  bearerSecret,
  basicLimiter,
  emailField,
  respondError,
  secretMatches,
  textField,
  validIsoDate,
} from "../utils/admissionPhase1.js";

const router = express.Router();
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const fields = {
  firstName: ["first_name", 100],
  middleName: ["middle_name", 100],
  lastName: ["last_name", 100],
  suffix: ["suffix", 30],
  contactNumber: ["contact_number", 20],
  houseNo: ["house_no", 50],
  street: ["street", 100],
  barangay: ["barangay", 100],
  city: ["city", 100],
  province: ["province", 100],
  zipCode: ["zip_code", 10],
  previousSchool: ["previous_school", 200],
};

async function openPeriod(connection = db) {
  const [rows] = await connection.execute(`
    SELECT admission_period_id AS admissionPeriodId, title, academic_year_id AS academicYearId,
      DATE_FORMAT(starts_at, '%Y-%m-%dT%H:%i') AS startsAt,
      DATE_FORMAT(ends_at, '%Y-%m-%dT%H:%i') AS endsAt
    FROM admission_periods
    WHERE status = 'Published' AND starts_at <= ${MANILA_NOW_SQL}
      AND ends_at >= ${MANILA_NOW_SQL}
    ORDER BY starts_at DESC LIMIT 1
  `);
  return rows[0] || null;
}

function validatePatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new InputError("Provide application fields.");
  }
  const updates = {};
  for (const [incoming, [column, max]] of Object.entries(fields)) {
    if (Object.hasOwn(body, incoming)) {
      updates[column] = textField(body[incoming], max, {
        required: incoming === "firstName" || incoming === "lastName",
      });
    }
  }
  if (Object.hasOwn(body, "email")) updates.email = emailField(body.email);
  if (Object.hasOwn(body, "birthDate"))
    updates.birth_date = validIsoDate(body.birthDate);
  if (Object.hasOwn(body, "gender")) {
    if (!["Male", "Female", null].includes(body.gender))
      throw new InputError("Invalid gender option.");
    updates.gender = body.gender;
  }
  if (Object.hasOwn(body, "applicantType")) {
    if (!["New", "Transferee", "Returnee", null].includes(body.applicantType)) {
      throw new InputError("Invalid applicant type.");
    }
    updates.applicant_type = body.applicantType;
  }
  if (Object.hasOwn(body, "preferredCourseId")) {
    const course = body.preferredCourseId;
    if (
      course !== null &&
      (!Number.isInteger(Number(course)) || Number(course) < 1)
    ) {
      throw new InputError("Select a valid course.");
    }
    updates.preferred_course_id = course === null ? null : Number(course);
  }
  if (Object.hasOwn(body, "privacyAccepted")) {
    if (typeof body.privacyAccepted !== "boolean")
      throw new InputError("Invalid privacy acknowledgement.");
    updates.privacy_accepted_at = body.privacyAccepted
      ? "__NOW_MANILA__"
      : null;
  }
  return updates;
}

function publicApplication(row) {
  return {
    applicationReference: row.application_reference,
    admissionPeriodId: row.admission_period_id,
    applicationStatus: row.application_status,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    suffix: row.suffix,
    birthDate: row.birth_date ? String(row.birth_date).slice(0, 10) : null,
    gender: row.gender,
    contactNumber: row.contact_number,
    email: row.email,
    houseNo: row.house_no,
    street: row.street,
    barangay: row.barangay,
    city: row.city,
    province: row.province,
    zipCode: row.zip_code,
    previousSchool: row.previous_school,
    applicantType: row.applicant_type,
    preferredCourseId: row.preferred_course_id,
    privacyAccepted: !!row.privacy_accepted_at,
    submittedAt: row.submitted_at,
    version: row.version,
  };
}

async function getAuthorizedApplication(connection, req) {
  const token = bearerSecret(req);
  if (!token) throw new InputError("Applicant recovery key is required.", 401);
  const ref = req.params.reference;
  if (typeof ref !== "string" || !/^ADM-\d{4}-[A-F0-9]{18}$/.test(ref)) {
    throw new InputError("Application not found or invalid recovery key.", 404);
  }
  const [rows] = await connection.execute(
    `
    SELECT a.*, DATE_FORMAT(a.birth_date, '%Y-%m-%d') AS birth_date_text
    FROM admission_applications a WHERE a.application_reference = ? LIMIT 1
  `,
    [ref],
  );
  if (!rows.length || !secretMatches(token, rows[0].resume_token_hash)) {
    throw new InputError("Application not found or invalid recovery key.", 404);
  }
  return rows[0];
}

// Public admission page can use this endpoint before creating a draft.
router.get("/status", basicLimiter(90, 15 * 60 * 1000), async (_req, res) => {
  try {
    const current = await openPeriod();
    if (current)
      return res.json({
        success: true,
        open: true,
        period: current,
        timezone: "Asia/Manila",
      });
    const [next] = await db.execute(`
      SELECT admission_period_id AS admissionPeriodId, title,
        DATE_FORMAT(starts_at, '%Y-%m-%dT%H:%i') AS startsAt,
        DATE_FORMAT(ends_at, '%Y-%m-%dT%H:%i') AS endsAt
      FROM admission_periods
      WHERE status = 'Published' AND starts_at > ${MANILA_NOW_SQL}
      ORDER BY starts_at ASC LIMIT 1
    `);
    return res.json({
      success: true,
      open: false,
      nextPeriod: next[0] || null,
      timezone: "Asia/Manila",
    });
  } catch (error) {
    return respondError(res, error, "ADMISSION STATUS ERROR:");
  }
});

router.get("/courses", basicLimiter(60, 15 * 60 * 1000), async (_req, res) => {
  try {
    const [courses] = await db.execute(`
      SELECT c.course_id AS courseId, c.course_code AS courseCode,
        c.course_name AS courseName
      FROM courses c JOIN departments d ON d.department_id = c.department_id
      ORDER BY c.course_code, c.course_id
    `);
    return res.json({ success: true, courses });
  } catch (error) {
    return respondError(res, error, "PUBLIC ADMISSION COURSES ERROR:");
  }
});

// POST /api/admissions/drafts | initial save, returns recovery token ONE time only
router.post("/drafts", basicLimiter(5, 60 * 60 * 1000), async (req, res) => {
  try {
    const initial = req.body || {};
    const firstName = textField(initial.firstName, 100, { required: true });
    const lastName = textField(initial.lastName, 100, { required: true });
    const email = emailField(initial.email);
    const period = await openPeriod();
    if (!period) throw new InputError("Admissions are currently closed.", 409);
    const recoveryKey = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(recoveryKey).digest("hex");
    const reference = `ADM-${new Date(Date.now() + 8 * 3600000).getUTCFullYear()}-${randomBytes(9).toString("hex").toUpperCase()}`;
    const [saved] = await db.execute(
      `
      INSERT INTO admission_applications
        (admission_period_id, application_reference, resume_token_hash,
         first_name, last_name, email)
      SELECT admission_period_id, ?, ?, ?, ?, ?
      FROM admission_periods
      WHERE admission_period_id = ? AND status = 'Published'
        AND starts_at <= ${MANILA_NOW_SQL} AND ends_at >= ${MANILA_NOW_SQL}
    `,
      [
        reference,
        tokenHash,
        firstName,
        lastName,
        email,
        period.admissionPeriodId,
      ],
    );
    if (!saved.affectedRows)
      throw new InputError(
        "The admission period just closed. Please contact PTC.",
        409,
      );
    return res.status(201).json({
      success: true,
      message:
        "Draft saved. Keep your recovery key private: it is shown only once.",
      applicationReference: reference,
      recoveryKey,
      applicationStatus: "Draft",
      version: 1,
    });
  } catch (error) {
    return respondError(res, error, "CREATE ADMISSION DRAFT ERROR:");
  }
});

router.get(
  "/drafts/:reference",
  basicLimiter(40, 15 * 60 * 1000),
  async (req, res) => {
    try {
      const row = await getAuthorizedApplication(db, req);
      const result = publicApplication(row);
      result.birthDate = row.birth_date_text;
      return res.json({ success: true, application: result });
    } catch (error) {
      return respondError(res, error, "READ ADMISSION DRAFT ERROR:");
    }
  },
);

// PATCH /api/admissions/drafts/:reference | requires last-read version to prevent overwrites
router.patch(
  "/drafts/:reference",
  basicLimiter(120, 15 * 60 * 1000),
  async (req, res) => {
    try {
      const row = await getAuthorizedApplication(db, req);
      if (row.application_status !== "Draft")
        throw new InputError("Only drafts can be edited.", 409);
      const period = await openPeriod();
      if (!period || period.admissionPeriodId !== row.admission_period_id) {
        throw new InputError("The admission submission period is closed.", 409);
      }
      const version = Number(req.body?.version);
      if (!Number.isInteger(version) || version < 1)
        throw new InputError("A valid draft version is required.");
      const updates = validatePatch(req.body);
      if (!Object.keys(updates).length)
        throw new InputError("No valid fields were supplied.");
      const assignments = [];
      const params = [];
      for (const [column, value] of Object.entries(updates)) {
        if (value === "__NOW_MANILA__")
          assignments.push(`${column} = ${MANILA_NOW_SQL}`);
        else {
          assignments.push(`${column} = ?`);
          params.push(value);
        }
      }
      const [result] = await db.execute(
        `
      UPDATE admission_applications SET ${assignments.join(", ")}, version = version + 1
      WHERE admission_application_id = ? AND version = ? AND application_status = 'Draft'
        AND EXISTS (SELECT 1 FROM admission_periods p
          WHERE p.admission_period_id = admission_applications.admission_period_id
          AND p.status = 'Published' AND p.starts_at <= ${MANILA_NOW_SQL}
          AND p.ends_at >= ${MANILA_NOW_SQL})
    `,
        [...params, row.admission_application_id, version],
      );
      if (!result.affectedRows) {
        throw new InputError(
          "Draft changed elsewhere or the admission period closed. Reload and retry.",
          409,
        );
      }
      return res.json({
        success: true,
        message: "Draft updated.",
        version: version + 1,
      });
    } catch (error) {
      return respondError(res, error, "UPDATE ADMISSION DRAFT ERROR:");
    }
  },
);

// POST /api/admissions/drafts/:reference/submit | DOES NOT create a student account
router.post(
  "/drafts/:reference/submit",
  basicLimiter(20, 15 * 60 * 1000),
  async (req, res) => {
    let conn;
    try {
      conn = await db.getConnection();
      await conn.beginTransaction();
      const row = await getAuthorizedApplication(conn, req);
      // Lock application during submission: two simultaneous submit calls cannot both succeed.
      const [lockedRows] = await conn.execute(
        `
      SELECT *, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birth_date_text
      FROM admission_applications WHERE admission_application_id = ? FOR UPDATE
    `,
        [row.admission_application_id],
      );
      const application = lockedRows[0];
      if (application.application_status !== "Draft") {
        throw new InputError(
          "Application already submitted or no longer editable.",
          409,
        );
      }
      const period = await openPeriod(conn);
      if (
        !period ||
        period.admissionPeriodId !== application.admission_period_id
      ) {
        throw new InputError("The admission deadline has passed.", 409);
      }
      const required = [
        "first_name",
        "last_name",
        "birth_date",
        "gender",
        "contact_number",
        "email",
        "street",
        "barangay",
        "city",
        "province",
        "previous_school",
        "applicant_type",
        "preferred_course_id",
        "privacy_accepted_at",
      ];
      const missing = required.filter(
        (column) => application[column] === null || application[column] === "",
      );
      if (missing.length) {
        throw new InputError(
          `Complete required fields before submitting: ${missing.join(", ")}.`,
        );
      }
      const todayManila = new Date(Date.now() + 8 * 3600000)
        .toISOString()
        .slice(0, 10);
      const birthDate = application.birth_date_text;
      if (birthDate > todayManila)
        throw new InputError("Birth date cannot be in the future.");
      const [course] = await conn.execute(
        "SELECT course_id FROM courses WHERE course_id = ? LIMIT 1",
        [application.preferred_course_id],
      );
      if (!course.length)
        throw new InputError("Selected course is no longer available.");
      await conn.execute(
        `
      UPDATE admission_applications
      SET application_status = 'Submitted', submitted_at = ${MANILA_NOW_SQL}, version = version + 1
      WHERE admission_application_id = ? AND application_status = 'Draft'
    `,
        [application.admission_application_id],
      );
      await conn.commit();
      return res.json({
        success: true,
        applicationReference: application.application_reference,
        applicationStatus: "Submitted",
        message:
          "Application submitted. Visit PTC in person with original documents for verification. You are not enrolled yet.",
      });
    } catch (error) {
      if (conn) await conn.rollback();
      return respondError(res, error, "SUBMIT ADMISSION ERROR:");
    } finally {
      if (conn) conn.release();
    }
  },
);

/* Student Account Activation */

function respondInvitationError(res, error) {
  if (error instanceof StudentInvitationError) {
    return res.status(error.status).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }

  console.error(
    "STUDENT ACCOUNT ACTIVATION ERROR:",
    error?.code || "UNEXPECTED_ERROR",
  );
  return res.status(500).json({
    success: false,
    code: "ACTIVATION_UNAVAILABLE",
    message: "Unable to process the account activation request.",
  });
}

// Public, token-protected: POST /api/admissions/account-activation/inspect
// The token is sent in the JSON body, never in a query string or server URL.
router.post(
  "/account-activation/inspect",
  basicLimiter(30, 15 * 60 * 1000),
  async (req, res) => {
    try {
      if (
        !req.body ||
        typeof req.body !== "object" ||
        Array.isArray(req.body)
      ) {
        throw new StudentInvitationError(
          "INVALID_INVITATION",
          "Invalid or expired activation link.",
          400,
        );
      }

      const result = await inspectStudentAccountInvitation(req.body.token);
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      return respondInvitationError(res, error);
    }
  },
);

// Public, one-time token: POST /api/admissions/account-activation/activate
// Passwords are only received in the HTTPS JSON request body and stored hashed.
router.post(
  "/account-activation/activate",
  basicLimiter(10, 15 * 60 * 1000),
  async (req, res) => {
    try {
      if (
        !req.body ||
        typeof req.body !== "object" ||
        Array.isArray(req.body)
      ) {
        return res.status(400).json({
          success: false,
          code: "INVALID_ACTIVATION_INPUT",
          message: "An activation token and password are required.",
        });
      }

      const result = await activateStudentAccount({
        token: req.body.token,
        password: req.body.password,
      });
      return res.status(200).json(result);
    } catch (error) {
      return respondInvitationError(res, error);
    }
  },
);

export default router;
