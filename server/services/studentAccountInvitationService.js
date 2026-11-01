import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import { createHash, randomBytes } from "node:crypto";
import db from "../db.js";

/* Invitation Configuration */

const INVITATION_HOURS = 24;
const RESEND_COOLDOWN_SECONDS = 60;
const STUDENT_ROLE_ID = 5;

export class StudentInvitationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "StudentInvitationError";
    this.code = code;
    this.status = status;
  }
}

function positiveId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new StudentInvitationError(
      "INVALID_USER",
      "A valid student user ID is required.",
    );
  }
  return id;
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function validToken(token) {
  return typeof token === "string" && /^[A-Za-z0-9_-]{40,128}$/.test(token);
}

function publicPortalUrl() {
  const configured = (process.env.PTC_PORTAL_PUBLIC_URL || "").trim();
  if (!configured) {
    throw new StudentInvitationError(
      "PORTAL_URL_NOT_CONFIGURED",
      "PTC_PORTAL_PUBLIC_URL must be configured before sending invitations.",
      503,
    );
  }
  let url;
  try {
    url = new URL(configured);
  } catch {
    throw new StudentInvitationError(
      "INVALID_PORTAL_URL",
      "The configured public portal URL is invalid.",
      503,
    );
  }
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (process.env.NODE_ENV === "production" &&
      (url.protocol !== "https:" || localHost)) ||
    (url.protocol === "http:" && !localHost)
  ) {
    throw new StudentInvitationError(
      "INVALID_PORTAL_URL",
      "Use an HTTPS portal URL; HTTP is permitted only for local development.",
      503,
    );
  }
  return url.origin;
}

function mailTransport() {
  const host = (process.env.SMTP_HOST || "").trim();
  const from = (process.env.SMTP_FROM || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  const user = process.env.SMTP_USER || process.env.ETHEREAL_USER;
  const pass = process.env.SMTP_PASS || process.env.ETHEREAL_PASS;

  if (
    !host ||
    !from ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    Boolean(user) !== Boolean(pass)
  ) {
    throw new StudentInvitationError(
      "SMTP_NOT_CONFIGURED",
      "Set SMTP_HOST, SMTP_PORT, SMTP_FROM, and both SMTP_USER/SMTP_PASS if authentication is required.",
      503,
    );
  }

  return {
    from,
    transport: nodemailer.createTransport({
      host,
      port,
      secure,
      requireTLS: !secure && Boolean(user),
      ...(user ? { auth: { user, pass } } : {}),
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    }),
  };
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function buildActivationLink(token) {
  const url = new URL("/activate-account", publicPortalUrl());
  // The fragment is not sent to the web server in HTTP requests.
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

function invitationEmail({ username, link }) {
  const safeUsername = escapeHtml(username);
  const safeLink = escapeHtml(link);
  return {
    subject: "PTC Portal — Your Student Account Is Ready",
    text: [
      "Pateros Technological College",
      "",
      "Your verified admission application has been imported into the PTC Portal.",
      `Student number / username: ${username}`,
      "",
      "Set your password using this secure, single-use link:",
      link,
      "",
      `The link expires in ${INVITATION_HOURS} hours. If it expires, contact the Registrar to request another invitation.`,
      "",
      "Account creation does not mean you are officially enrolled.",
      "Please finish the enrollment process after activating your account.",
      "",
      "If you did not apply to PTC, contact the Registrar's Office.",
      "PTC Admissions Office",
    ].join("\n"),
    html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#20312d;line-height:1.6">
      <h2 style="color:#166534">Pateros Technological College</h2>
      <p>Your verified admission application has been imported into the PTC Portal.</p>
      <p><strong>Student number / username:</strong> ${safeUsername}</p>
      <p>Set your password using the secure, single-use link below:</p>
      <p><a href="${safeLink}" style="background:#166534;color:#fff;padding:11px 18px;text-decoration:none;border-radius:6px">Set up my PTC Portal account</a></p>
      <p>This link expires in ${INVITATION_HOURS} hours. If it expires, contact the Registrar to request another invitation.</p>
      <p><strong>Account creation does not mean enrollment.</strong> Finish your enrollment after activation.</p>
      <p>If you did not apply to PTC, contact the Registrar's Office.</p>
      <p>PTC Admissions Office</p>
    </div>`,
  };
}

/* Create and Send Invitation */

export async function sendStudentAccountInvitation({
  userId,
  forceResend = false,
}) {
  const id = positiveId(userId);
  let connection;
  let invitationId;
  let recipientEmail;
  let username;
  let plainToken;
  let tokenHash;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [users] = await connection.execute(
      `SELECT u.user_id AS userId, u.username, u.email, u.is_verified AS isVerified
       FROM users u
       JOIN students s ON s.user_id = u.user_id
       JOIN admission_applications a
         ON a.student_id = s.student_id AND a.application_status = 'Imported'
       WHERE u.user_id = ? AND u.role_id = ?
         AND u.is_active = 1 AND u.is_archived = 0
       LIMIT 1 FOR UPDATE`,
      [id, STUDENT_ROLE_ID],
    );

    if (!users.length) {
      throw new StudentInvitationError(
        "NOT_IMPORTED_STUDENT",
        "Only active student accounts created by a successful admission import can be invited.",
        409,
      );
    }

    const user = users[0];
    if (Number(user.isVerified) === 1) {
      await connection.commit();
      return {
        userId: id,
        username: user.username,
        emailStatus: "AlreadyActivated",
      };
    }

    const [existingRows] = await connection.execute(
      `SELECT invitation_id AS invitationId, email_status AS emailStatus,
              used_at AS usedAt, revoked_at AS revokedAt,
              expires_at > UTC_TIMESTAMP() AS isUnexpired,
              TIMESTAMPDIFF(SECOND, last_attempt_at, UTC_TIMESTAMP()) AS secondsSinceAttempt
       FROM student_account_invitations
       WHERE user_id = ? LIMIT 1 FOR UPDATE`,
      [id],
    );
    const existing = existingRows[0];

    if (existing?.usedAt) {
      throw new StudentInvitationError(
        "INVITATION_ALREADY_USED",
        "This student has already used their activation invitation.",
        409,
      );
    }
    if (
      existing?.emailStatus === "Sent" &&
      Number(existing.isUnexpired) === 1 &&
      !existing.revokedAt &&
      !forceResend
    ) {
      await connection.commit();
      return {
        userId: id,
        username: user.username,
        emailStatus: "AlreadySent",
      };
    }
    if (
      existing &&
      existing.secondsSinceAttempt !== null &&
      Number(existing.secondsSinceAttempt) < RESEND_COOLDOWN_SECONDS
    ) {
      throw new StudentInvitationError(
        "INVITATION_COOLDOWN",
        `Wait at least ${RESEND_COOLDOWN_SECONDS} seconds between invitation attempts.`,
        429,
      );
    }

    plainToken = randomBytes(32).toString("base64url");
    tokenHash = hashToken(plainToken);
    recipientEmail = String(user.email || "").trim();
    username = String(user.username || "").trim();
    if (!recipientEmail || !username) {
      throw new StudentInvitationError(
        "MISSING_ACCOUNT_DETAILS",
        "Student email or username is missing.",
        409,
      );
    }

    if (existing) {
      invitationId = Number(existing.invitationId);
      await connection.execute(
        `UPDATE student_account_invitations
         SET recipient_email = ?, token_hash = ?,
             expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 24 HOUR),
             used_at = NULL, revoked_at = NULL,
             email_status = 'Pending', email_attempts = email_attempts + 1,
             last_attempt_at = UTC_TIMESTAMP(), sent_at = NULL, last_error = NULL
         WHERE invitation_id = ?`,
        [recipientEmail, tokenHash, invitationId],
      );
    } else {
      const [created] = await connection.execute(
        `INSERT INTO student_account_invitations
         (user_id, recipient_email, token_hash, expires_at,
          email_status, email_attempts, last_attempt_at)
         VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 24 HOUR),
                 'Pending', 1, UTC_TIMESTAMP())`,
        [id, recipientEmail, tokenHash],
      );
      invitationId = Number(created.insertId);
    }

    await connection.commit();
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch {
        /* Transaction already closed. */
      }
    }
    throw error;
  } finally {
    if (connection) connection.release();
  }

  // Email is intentionally sent only AFTER the invitation transaction commits.
  // An SMTP failure must never undo a successfully imported student.
  try {
    const { from, transport } = mailTransport();
    const link = buildActivationLink(plainToken);
    const content = invitationEmail({ username, link });
    const info = await transport.sendMail({
      from,
      to: recipientEmail,
      ...content,
    });

    if (
      !Array.isArray(info.accepted) ||
      !info.accepted.some(
        (recipient) => recipient.toLowerCase() === recipientEmail.toLowerCase(),
      )
    ) {
      throw new Error("SMTP did not accept the target recipient.");
    }

    await db.execute(
      `UPDATE student_account_invitations
       SET email_status = 'Sent', sent_at = UTC_TIMESTAMP(), last_error = NULL
       WHERE invitation_id = ? AND token_hash = ? AND used_at IS NULL`,
      [invitationId, tokenHash],
    );
    return { userId: id, username, emailStatus: "Sent", invitationId };
  } catch (error) {
    // Preserve only a generic error in the database. Do not log email links or tokens.
    try {
      await db.execute(
        `UPDATE student_account_invitations
         SET email_status = 'Failed', last_error = ?
         WHERE invitation_id = ? AND token_hash = ? AND used_at IS NULL`,
        [
          "SMTP delivery attempt failed or is not configured.",
          invitationId,
          tokenHash,
        ],
      );
    } catch {
      console.error("STUDENT INVITATION: Could not record delivery failure.");
    }
    console.error("STUDENT INVITATION: Email delivery failed.");
    return {
      userId: id,
      username,
      emailStatus: "Failed",
      invitationId,
      message:
        error instanceof StudentInvitationError
          ? error.message
          : "Email could not be sent; retry later.",
    };
  }
}

/* Validate Activation Link */

export async function inspectStudentAccountInvitation(token) {
  if (!validToken(token)) {
    throw new StudentInvitationError(
      "INVALID_INVITATION",
      "Invalid or expired activation link.",
      400,
    );
  }
  const [rows] = await db.execute(
    `SELECT u.username,
            DATE_FORMAT(i.expires_at, '%Y-%m-%dT%H:%i:%sZ') AS expiresAt
     FROM student_account_invitations i
     JOIN users u ON u.user_id = i.user_id
     WHERE i.token_hash = ? AND i.used_at IS NULL AND i.revoked_at IS NULL
       AND i.expires_at > UTC_TIMESTAMP()
       AND u.role_id = ? AND u.is_active = 1 AND u.is_archived = 0
       AND u.is_verified = 0
     LIMIT 1`,
    [hashToken(token), STUDENT_ROLE_ID],
  );
  if (!rows.length) {
    throw new StudentInvitationError(
      "INVALID_INVITATION",
      "Invalid or expired activation link.",
      400,
    );
  }
  return {
    valid: true,
    username: rows[0].username,
    expiresAt: rows[0].expiresAt,
  };
}

/* Activate Student Account */

export async function activateStudentAccount({ token, password }) {
  if (!validToken(token)) {
    throw new StudentInvitationError(
      "INVALID_INVITATION",
      "Invalid or expired activation link.",
      400,
    );
  }
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    throw new StudentInvitationError(
      "INVALID_PASSWORD",
      "Choose a password with at least 12 characters and at most 72 UTF-8 bytes.",
      400,
    );
  }

  const tokenHash = hashToken(token);
  // Hash before opening the transaction to keep locks short.
  const passwordHash = await bcrypt.hash(password, 12);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [invitations] = await connection.execute(
      `SELECT i.invitation_id AS invitationId, i.user_id AS userId, u.username
       FROM student_account_invitations i
       JOIN users u ON u.user_id = i.user_id
       WHERE i.token_hash = ? AND i.used_at IS NULL AND i.revoked_at IS NULL
         AND i.expires_at > UTC_TIMESTAMP()
         AND u.role_id = ? AND u.is_active = 1 AND u.is_archived = 0
         AND u.is_verified = 0
       LIMIT 1 FOR UPDATE`,
      [tokenHash, STUDENT_ROLE_ID],
    );
    if (!invitations.length) {
      throw new StudentInvitationError(
        "INVALID_INVITATION",
        "Invalid or expired activation link.",
        400,
      );
    }
    const invitation = invitations[0];
    const [updated] = await connection.execute(
      `UPDATE users SET password_hash = ?, is_verified = 1
       WHERE user_id = ? AND role_id = ? AND is_verified = 0
         AND is_active = 1 AND is_archived = 0`,
      [passwordHash, invitation.userId, STUDENT_ROLE_ID],
    );
    if (updated.affectedRows !== 1) {
      throw new StudentInvitationError(
        "ACCOUNT_NOT_AVAILABLE",
        "This account cannot be activated.",
        409,
      );
    }
    await connection.execute(
      `UPDATE student_account_invitations
       SET used_at = UTC_TIMESTAMP()
       WHERE invitation_id = ? AND token_hash = ? AND used_at IS NULL`,
      [invitation.invitationId, tokenHash],
    );
    await connection.commit();
    return {
      success: true,
      username: invitation.username,
      message:
        "Account activated. Log in using your student number and chosen password.",
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      /* Transaction already closed. */
    }
    throw error;
  } finally {
    connection.release();
  }
}
