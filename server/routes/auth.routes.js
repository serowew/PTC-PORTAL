import express from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";
import authenticate from "../middleware/authenticate.js";

import db from "../db.js";
import { logActivity } from "../utils/activityLogger.js";

const router = express.Router();

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

// =======================
// LOGIN ATTEMPT SECURITY
// =======================

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_COOLDOWN_MS = 2 * 60 * 1000;

// Stores failed attempts while the Node server is running.
const loginAttempts = new Map();

function getLoginAttemptKey(req) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";

  // IMPORTANT:
  // The cooldown is intentionally NOT tied to a username.
  // After 5 failed normal-login attempts from this client/IP,
  // every username is blocked for 2 minutes.
  return String(ip);
}

function formatCooldown(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function checkLoginCooldown(req) {
  const key = getLoginAttemptKey(req);

  const entry = loginAttempts.get(key);

  if (!entry) {
    return {
      locked: false,
      retryAfter: 0,
    };
  }

  if (entry.lockedUntil) {
    const remainingMs = entry.lockedUntil - Date.now();

    if (remainingMs > 0) {
      return {
        locked: true,

        retryAfter: Math.max(1, Math.ceil(remainingMs / 1000)),
      };
    }

    // Cooldown finished.
    loginAttempts.delete(key);

    return {
      locked: false,
      retryAfter: 0,
    };
  }

  return {
    locked: false,
    retryAfter: 0,
  };
}

function registerFailedLogin(req) {
  const key = getLoginAttemptKey(req);

  const existing = loginAttempts.get(key) || {
    attempts: 0,
    lockedUntil: null,
  };

  const attempts = existing.attempts + 1;

  // =============================
  // FIFTH FAILED ATTEMPT
  // =============================

  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    const lockedUntil = Date.now() + LOGIN_COOLDOWN_MS;

    loginAttempts.set(key, {
      attempts: MAX_LOGIN_ATTEMPTS,
      lockedUntil,
    });

    return {
      locked: true,
      retryAfter: Math.ceil(LOGIN_COOLDOWN_MS / 1000),
      attemptsRemaining: 0,
    };
  }

  // =============================
  // ATTEMPTS 1 - 4
  // =============================

  loginAttempts.set(key, {
    attempts,
    lockedUntil: null,
  });

  return {
    locked: false,
    retryAfter: 0,

    attemptsRemaining: MAX_LOGIN_ATTEMPTS - attempts,
  };
}

function clearFailedLogins(req) {
  const key = getLoginAttemptKey(req);

  loginAttempts.delete(key);
}

console.log("✅ AUTH ROUTER LOADED - RESEND OTP ENABLED");

// =======================
// Nodemailer
// =======================
const transporter = nodemailer.createTransport({
  host: "smtp.ethereal.email",
  port: 587,
  secure: false,
  auth: {
    user: process.env.ETHEREAL_USER,
    pass: process.env.ETHEREAL_PASS,
  },
});

// =======================
// FORGOT PASSWORD HELPERS
// =======================
const PASSWORD_RESET_OTP_MIN = 100000;
const PASSWORD_RESET_OTP_MAX = 1000000;
const PASSWORD_RESET_OTP_TTL_MS = 5 * 60 * 1000;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_RESEND_COOLDOWN_MS = 60 * 1000;

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];

  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim().slice(0, 45);
  }

  return String(req.ip || req.socket?.remoteAddress || "unknown").slice(0, 45);
}

function getUserAgent(req) {
  return String(req.get("user-agent") || "unknown").slice(0, 255);
}

function createPasswordResetOtp() {
  return crypto
    .randomInt(PASSWORD_RESET_OTP_MIN, PASSWORD_RESET_OTP_MAX)
    .toString();
}

async function sendPasswordResetOtp(email, otp) {
  return transporter.sendMail({
    from: '"PTC Portal" <noreply@ptc.edu.ph>',
    to: email,
    subject: "PTC Portal Password Reset Code",

    text:
      `Your password reset verification code is ${otp}. ` +
      `This code expires in 5 minutes. ` +
      `If you did not request a password reset, you can ignore this email.`,

    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>PTC Portal Password Reset</h2>

        <p>
          Your password reset verification code is:
        </p>

        <p
          style="
            font-size: 28px;
            font-weight: bold;
            letter-spacing: 6px;
          "
        >
          ${otp}
        </p>

        <p>
          This code expires in 5 minutes.
        </p>

        <p>
          If you did not request a password reset,
          you can ignore this email.
        </p>
      </div>
    `,
  });
}

// =====================================================
// FORGOT PASSWORD — REQUEST OTP
// POST /auth/forgot-password
// =====================================================
router.post("/forgot-password", async (req, res) => {
  const username =
    typeof req.body.username === "string" ? req.body.username.trim() : "";

  if (!username) {
    return res.status(400).json({
      success: false,
      error: "Username is required.",
    });
  }

  /*
    Generate a public request ID.

    We generate this before checking if the account exists
    so the response does not directly expose whether the
    username exists.
  */
  const publicId = crypto.randomUUID();

  try {
    // ==========================================
    // 1. Find user
    // ==========================================
    const [rows] = await db.execute(
      `
      SELECT
        u.user_id,
        u.username,
        u.email,
        u.is_active
      FROM users u
      WHERE u.username = ?
      LIMIT 1
      `,
      [username],
    );

    /*
      IMPORTANT SECURITY BEHAVIOR:

      For unknown accounts we return a generic message.

      This helps prevent username enumeration.
    */
    if (rows.length === 0) {
      return res.json({
        success: true,
        message:
          "If the account exists and is eligible for recovery, a verification code has been sent.",
        requestId: publicId,
      });
    }

    const user = rows[0];

    // ==========================================
    // 2. Account must be active
    // ==========================================
    if (!user.is_active) {
      await logActivity(
        user.user_id,
        "PASSWORD_RESET_BLOCKED",
        "Authentication",
        `${user.username} attempted a password reset while the account was inactive. Request ID: ${publicId}. IP: ${getClientIp(req)}.`,
      );

      return res.json({
        success: true,
        message:
          "If the account exists and is eligible for recovery, a verification code has been sent.",
        requestId: publicId,
      });
    }

    // ==========================================
    // 3. Make sure user has an email
    // ==========================================
    if (!user.email) {
      await logActivity(
        user.user_id,
        "PASSWORD_RESET_EMAIL_MISSING",
        "Authentication",
        `${user.username} requested a password reset but no email address is registered. Request ID: ${publicId}.`,
      );

      return res.status(400).json({
        success: false,
        error: "This account does not have a registered recovery email.",
      });
    }

    // ==========================================
    // 4. Generate recovery OTP
    // ==========================================
    const otp = createPasswordResetOtp();

    /*
      DO NOT store the OTP itself.

      bcrypt hashes the OTP before it is stored
      inside password_reset_requests.
    */
    const codeHash = await bcrypt.hash(otp, 10);

    const expiresAt = new Date(Date.now() + PASSWORD_RESET_OTP_TTL_MS);

    const requestIp = getClientIp(req);
    const userAgent = getUserAgent(req);

    // ==========================================
    // 5. Invalidate old reset requests
    // ==========================================
    await db.execute(
      `
      UPDATE password_reset_requests
      SET used_at = COALESCE(used_at, NOW())
      WHERE user_id = ?
        AND used_at IS NULL
      `,
      [user.user_id],
    );

    // ==========================================
    // 6. Create reset request
    // ==========================================
    await db.execute(
      `
      INSERT INTO password_reset_requests
      (
        public_id,
        user_id,
        method,
        code_hash,
        expires_at,
        attempt_count,
        max_attempts,
        request_ip,
        user_agent
      )
      VALUES (?, ?, 'EMAIL', ?, ?, 0, ?, ?, ?)
      `,
      [
        publicId,
        user.user_id,
        codeHash,
        expiresAt,
        PASSWORD_RESET_MAX_ATTEMPTS,
        requestIp,
        userAgent,
      ],
    );

    // ==========================================
    // 7. Activity log — request created
    // ==========================================
    await logActivity(
      user.user_id,
      "PASSWORD_RESET_REQUESTED",
      "Authentication",
      `${user.username} requested a password reset. Request ID: ${publicId}. IP: ${requestIp}.`,
    );

    // ==========================================
    // 8. Send OTP email
    // ==========================================
    try {
      const info = await sendPasswordResetOtp(user.email, otp);

      /*
        Since your project currently uses Ethereal,
        this prints the email preview link.

        Later, when you use a real email provider,
        getTestMessageUrl may return false/null.
      */
      const previewUrl = nodemailer.getTestMessageUrl(info);

      if (previewUrl) {
        console.log("Password reset preview URL:", previewUrl);
      }

      // ========================================
      // 9. Activity log — OTP sent
      // ========================================
      await logActivity(
        user.user_id,
        "PASSWORD_RESET_OTP_SENT",
        "Authentication",
        `A password reset OTP was sent for ${user.username}. Request ID: ${publicId}.`,
      );
    } catch (mailError) {
      console.error("PASSWORD RESET EMAIL ERROR:", mailError);

      /*
        If the email fails, invalidate the request
        so it cannot later be used.
      */
      await db.execute(
        `
        UPDATE password_reset_requests
        SET used_at = NOW()
        WHERE public_id = ?
        `,
        [publicId],
      );

      await logActivity(
        user.user_id,
        "PASSWORD_RESET_OTP_SEND_FAILED",
        "Authentication",
        `Password reset OTP delivery failed for ${user.username}. Request ID: ${publicId}.`,
      );

      return res.status(500).json({
        success: false,
        error: "Unable to send the password reset code. Please try again.",
      });
    }

    // ==========================================
    // 10. Success
    // ==========================================
    return res.json({
      success: true,
      message:
        "If the account exists and is eligible for recovery, a verification code has been sent.",
      requestId: publicId,
    });
  } catch (err) {
    console.error("FORGOT PASSWORD ERROR:", err);

    return res.status(500).json({
      success: false,
      error: "Unable to process the password reset request.",
    });
  }
});

// =====================================================
// FORGOT PASSWORD — VERIFY OTP
// POST /auth/forgot-password/verify
// =====================================================
router.post("/forgot-password/verify", async (req, res) => {
  const requestId =
    typeof req.body.requestId === "string" ? req.body.requestId.trim() : "";

  const otp = typeof req.body.otp === "string" ? req.body.otp.trim() : "";

  // ==========================================
  // 1. Basic validation
  // ==========================================
  if (!requestId || !otp) {
    return res.status(400).json({
      success: false,
      error: "Request ID and OTP are required.",
    });
  }

  if (!/^\d{6}$/.test(otp)) {
    return res.status(400).json({
      success: false,
      error: "OTP must be a 6-digit code.",
    });
  }

  try {
    // ========================================
    // 2. Load reset request + user
    // ========================================
    const [rows] = await db.execute(
      `
        SELECT
          pr.public_id,
          pr.user_id,
          pr.code_hash,
          pr.expires_at,
          pr.attempt_count,
          pr.max_attempts,
          pr.verified_at,
          pr.used_at,
          u.username,
          u.is_active
        FROM password_reset_requests pr
        INNER JOIN users u
          ON u.user_id = pr.user_id
        WHERE pr.public_id = ?
        LIMIT 1
        `,
      [requestId],
    );

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired password reset request.",
      });
    }

    const resetRequest = rows[0];

    // ========================================
    // 3. Account must still be active
    // ========================================
    if (!resetRequest.is_active) {
      await logActivity(
        resetRequest.user_id,
        "PASSWORD_RESET_BLOCKED",
        "Authentication",
        `${resetRequest.username} attempted OTP verification while the account was inactive. Request ID: ${requestId}.`,
      );

      return res.status(403).json({
        success: false,
        error: "This account is not available for password recovery.",
      });
    }

    // ========================================
    // 4. Request must not already be used
    // ========================================
    if (resetRequest.used_at) {
      await logActivity(
        resetRequest.user_id,
        "PASSWORD_RESET_INVALID_ATTEMPT",
        "Authentication",
        `${resetRequest.username} attempted to verify an already-used password reset request. Request ID: ${requestId}.`,
      );

      return res.status(400).json({
        success: false,
        error: "This password reset request is no longer valid.",
      });
    }

    // ========================================
    // 5. Check expiration
    // ========================================
    if (new Date() > new Date(resetRequest.expires_at)) {
      await logActivity(
        resetRequest.user_id,
        "PASSWORD_RESET_OTP_EXPIRED",
        "Authentication",
        `${resetRequest.username} attempted to use an expired password reset OTP. Request ID: ${requestId}.`,
      );

      return res.status(400).json({
        success: false,
        error: "Verification code has expired. Please request a new code.",
      });
    }

    // ========================================
    // 6. Check maximum attempts
    // ========================================
    if (
      Number(resetRequest.attempt_count) >= Number(resetRequest.max_attempts)
    ) {
      await logActivity(
        resetRequest.user_id,
        "PASSWORD_RESET_OTP_LOCKED",
        "Authentication",
        `${resetRequest.username} reached the maximum password reset OTP attempts. Request ID: ${requestId}.`,
      );

      return res.status(429).json({
        success: false,
        error:
          "Maximum verification attempts reached. Please request a new code.",
      });
    }

    // ========================================
    // 7. Compare OTP with bcrypt hash
    // ========================================
    const otpMatches = await bcrypt.compare(otp, resetRequest.code_hash);

    if (!otpMatches) {
      /*
          Increase attempt counter.
        */
      await db.execute(
        `
          UPDATE password_reset_requests
          SET attempt_count =
            attempt_count + 1
          WHERE public_id = ?
          `,
        [requestId],
      );

      const newAttemptCount = Number(resetRequest.attempt_count) + 1;

      const remainingAttempts = Math.max(
        Number(resetRequest.max_attempts) - newAttemptCount,
        0,
      );

      // ======================================
      // Activity log — wrong OTP
      // ======================================
      await logActivity(
        resetRequest.user_id,
        "PASSWORD_RESET_OTP_FAILED",
        "Authentication",
        `${resetRequest.username} entered an incorrect password reset OTP. Request ID: ${requestId}. Remaining attempts: ${remainingAttempts}.`,
      );

      return res.status(400).json({
        success: false,

        error:
          remainingAttempts > 0
            ? `Invalid verification code. ${remainingAttempts} attempt(s) remaining.`
            : "Maximum verification attempts reached. Please request a new code.",

        remainingAttempts,
      });
    }

    // ========================================
    // 8. Mark request verified
    // ========================================
    if (!resetRequest.verified_at) {
      await db.execute(
        `
          UPDATE password_reset_requests
          SET verified_at = NOW()
          WHERE public_id = ?
          `,
        [requestId],
      );

      // ======================================
      // Activity log — OTP verified
      // ======================================
      await logActivity(
        resetRequest.user_id,
        "PASSWORD_RESET_OTP_VERIFIED",
        "Authentication",
        `${resetRequest.username} successfully verified a password reset OTP. Request ID: ${requestId}.`,
      );
    }

    // ========================================
    // 9. JWT_SECRET required
    // ========================================
    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured.");

      return res.status(500).json({
        success: false,
        error: "Authentication configuration error.",
      });
    }

    /*
        IMPORTANT:

        This is NOT a normal login JWT.

        It has a special purpose:
        "password-reset"

        The frontend must send this token
        during the final password reset request.

        It expires after 10 minutes.
      */
    const resetToken = jwt.sign(
      {
        purpose: "password-reset",

        request_id: requestId,

        user_id: Number(resetRequest.user_id),
      },

      process.env.JWT_SECRET,

      {
        expiresIn: "10m",
      },
    );

    // ========================================
    // 10. Success
    // ========================================
    return res.json({
      success: true,

      message: "Verification code confirmed.",

      verified: true,

      resetToken,
    });
  } catch (err) {
    console.error("VERIFY PASSWORD RESET OTP ERROR:", err);

    return res.status(500).json({
      success: false,
      error: "Unable to verify the password reset code.",
    });
  }
});

// =====================================================
// FORGOT PASSWORD — RESEND OTP
// POST /auth/forgot-password/resend
// =====================================================
router.post("/forgot-password/resend", async (req, res) => {
  const requestId =
    typeof req.body.requestId === "string" ? req.body.requestId.trim() : "";

  if (!requestId) {
    return res.status(400).json({
      success: false,
      error: "Request ID is required.",
    });
  }

  try {
    // ========================================
    // 1. Load current request
    // ========================================
    const [rows] = await db.execute(
      `
        SELECT
          pr.public_id,
          pr.user_id,
          pr.method,
          pr.verified_at,
          pr.used_at,
          pr.created_at,
          u.username,
          u.email,
          u.is_active
        FROM password_reset_requests pr
        INNER JOIN users u
          ON u.user_id = pr.user_id
        WHERE pr.public_id = ?
        LIMIT 1
        `,
      [requestId],
    );

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid password reset request.",
      });
    }

    const resetRequest = rows[0];

    // ========================================
    // 2. Validate request
    // ========================================
    if (!resetRequest.is_active || resetRequest.used_at) {
      return res.status(400).json({
        success: false,
        error: "This password reset request is no longer valid.",
      });
    }

    if (resetRequest.verified_at) {
      return res.status(400).json({
        success: false,
        error: "This password reset request is already verified.",
      });
    }

    // ========================================
    // 3. Resend cooldown
    // ========================================
    const lastSentAt = new Date(resetRequest.created_at).getTime();

    const elapsedSinceLastSend = Date.now() - lastSentAt;

    if (
      Number.isFinite(lastSentAt) &&
      elapsedSinceLastSend < PASSWORD_RESET_RESEND_COOLDOWN_MS
    ) {
      const retryAfterSeconds = Math.ceil(
        (PASSWORD_RESET_RESEND_COOLDOWN_MS - elapsedSinceLastSend) / 1000,
      );

      await logActivity(
        resetRequest.user_id,
        "PASSWORD_RESET_OTP_RESEND_THROTTLED",
        "Authentication",
        `${resetRequest.username} attempted to resend a password reset OTP too soon. Request ID: ${requestId}.`,
      );

      return res.status(429).json({
        success: false,

        error: `Please wait ${retryAfterSeconds} second(s) before requesting another code.`,

        retryAfterSeconds,
      });
    }

    // ========================================
    // 4. Generate new request + OTP
    // ========================================
    const newRequestId = crypto.randomUUID();

    const otp = createPasswordResetOtp();

    const codeHash = await bcrypt.hash(otp, 10);

    const expiresAt = new Date(Date.now() + PASSWORD_RESET_OTP_TTL_MS);

    const requestIp = getClientIp(req);

    const userAgent = getUserAgent(req);

    /*
        IMPORTANT:

        Your Step 1 SQL table has created_at,
        but does NOT have updated_at.

        Because of that, a resend creates a
        BRAND NEW password reset request.

        The old request is invalidated only
        after the new email is successfully sent.
      */

    // ========================================
    // 5. Insert replacement request
    // ========================================
    await db.execute(
      `
        INSERT INTO password_reset_requests
        (
          public_id,
          user_id,
          method,
          code_hash,
          expires_at,
          attempt_count,
          max_attempts,
          request_ip,
          user_agent
        )
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
        `,
      [
        newRequestId,

        resetRequest.user_id,

        resetRequest.method || "EMAIL",

        codeHash,

        expiresAt,

        PASSWORD_RESET_MAX_ATTEMPTS,

        requestIp,

        userAgent,
      ],
    );

    // ========================================
    // 6. Send new OTP
    // ========================================
    try {
      const info = await sendPasswordResetOtp(resetRequest.email, otp);

      const previewUrl = nodemailer.getTestMessageUrl(info);

      if (previewUrl) {
        console.log("Password reset resend preview URL:", previewUrl);
      }
    } catch (mailError) {
      console.error("PASSWORD RESET RESEND EMAIL ERROR:", mailError);

      /*
          The replacement request cannot be used
          if sending the email failed.
        */
      await db.execute(
        `
          UPDATE password_reset_requests
          SET used_at = NOW()
          WHERE public_id = ?
          `,
        [newRequestId],
      );

      await logActivity(
        resetRequest.user_id,
        "PASSWORD_RESET_OTP_SEND_FAILED",
        "Authentication",
        `Password reset OTP resend failed for ${resetRequest.username}. Request ID: ${newRequestId}.`,
      );

      return res.status(500).json({
        success: false,

        error: "Unable to resend the verification code. Please try again.",
      });
    }

    // ========================================
    // 7. Invalidate previous request
    // ========================================
    await db.execute(
      `
        UPDATE password_reset_requests
        SET used_at = NOW()
        WHERE public_id = ?
          AND used_at IS NULL
        `,
      [requestId],
    );

    // ========================================
    // 8. Activity log
    // ========================================
    await logActivity(
      resetRequest.user_id,
      "PASSWORD_RESET_OTP_RESENT",
      "Authentication",
      `A new password reset OTP was sent for ${resetRequest.username}. Request ID: ${newRequestId}. Previous request ID: ${requestId}. IP: ${requestIp}.`,
    );

    // ========================================
    // 9. IMPORTANT:
    // frontend must save NEW requestId
    // ========================================
    return res.json({
      success: true,

      message: "A new verification code has been sent.",

      requestId: newRequestId,
    });
  } catch (err) {
    console.error("RESEND PASSWORD RESET OTP ERROR:", err);

    return res.status(500).json({
      success: false,

      error: "Unable to resend the verification code.",
    });
  }
});

// =====================================================
// FORGOT PASSWORD — SET NEW PASSWORD
// POST /auth/forgot-password/reset
// =====================================================
router.post("/forgot-password/reset", async (req, res) => {
  const requestId =
    typeof req.body.requestId === "string" ? req.body.requestId.trim() : "";

  const resetToken =
    typeof req.body.resetToken === "string" ? req.body.resetToken.trim() : "";

  const newPassword =
    typeof req.body.newPassword === "string" ? req.body.newPassword : "";

  // ==========================================
  // 1. Validate input
  // ==========================================
  if (!requestId || !resetToken || !newPassword) {
    return res.status(400).json({
      success: false,

      error: "Request ID, reset token, and new password are required.",
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      success: false,

      error: "Password must be at least 8 characters long.",
    });
  }

  /*
      bcrypt only uses the first 72 bytes.

      Rejecting longer passwords prevents
      confusing password behavior.
    */
  if (Buffer.byteLength(newPassword, "utf8") > 72) {
    return res.status(400).json({
      success: false,
      error: "Password is too long.",
    });
  }

  let connection;

  let resetRequestForLog = null;

  try {
    // ========================================
    // 2. JWT config
    // ========================================
    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured.");

      return res.status(500).json({
        success: false,

        error: "Authentication configuration error.",
      });
    }

    // ========================================
    // 3. Verify reset authorization token
    // ========================================
    let decodedResetToken;

    try {
      decodedResetToken = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch (tokenError) {
      return res.status(401).json({
        success: false,

        error: "Invalid or expired password reset authorization.",
      });
    }

    // ========================================
    // 4. Make sure token is for password reset
    // ========================================
    if (
      decodedResetToken?.purpose !== "password-reset" ||
      decodedResetToken?.request_id !== requestId
    ) {
      return res.status(401).json({
        success: false,

        error: "Invalid or expired password reset authorization.",
      });
    }

    // ========================================
    // 5. Load request + current user
    // ========================================
    const [rows] = await db.execute(
      `
        SELECT
          pr.public_id,
          pr.user_id,
          pr.expires_at,
          pr.verified_at,
          pr.used_at,

          u.username,
          u.password_hash,
          u.is_active

        FROM password_reset_requests pr

        INNER JOIN users u
          ON u.user_id = pr.user_id

        WHERE pr.public_id = ?

        LIMIT 1
        `,
      [requestId],
    );

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,

        error: "Invalid password reset request.",
      });
    }

    const resetRequest = rows[0];

    resetRequestForLog = resetRequest;

    // ========================================
    // 6. Token user must match reset user
    // ========================================
    if (Number(decodedResetToken.user_id) !== Number(resetRequest.user_id)) {
      return res.status(401).json({
        success: false,

        error: "Invalid or expired password reset authorization.",
      });
    }

    // ========================================
    // 7. User must still be active
    // ========================================
    if (!resetRequest.is_active) {
      await logActivity(
        resetRequest.user_id,
        "PASSWORD_RESET_BLOCKED",
        "Authentication",
        `${resetRequest.username} attempted to complete a password reset while the account was inactive. Request ID: ${requestId}.`,
      );

      return res.status(403).json({
        success: false,

        error: "This account is not available for password recovery.",
      });
    }

    // ========================================
    // 8. Request cannot already be used
    // ========================================
    if (resetRequest.used_at) {
      await logActivity(
        resetRequest.user_id,
        "PASSWORD_RESET_INVALID_ATTEMPT",
        "Authentication",
        `${resetRequest.username} attempted to reuse a completed password reset request. Request ID: ${requestId}.`,
      );

      return res.status(400).json({
        success: false,

        error: "This password reset request has already been used.",
      });
    }

    // ========================================
    // 9. OTP must already be verified
    // ========================================
    if (!resetRequest.verified_at) {
      await logActivity(
        resetRequest.user_id,
        "PASSWORD_RESET_NOT_VERIFIED",
        "Authentication",
        `${resetRequest.username} attempted to reset a password before OTP verification. Request ID: ${requestId}.`,
      );

      return res.status(403).json({
        success: false,

        error: "Verify the password reset code first.",
      });
    }

    // ========================================
    // 10. Check reset request expiration
    // ========================================
    if (new Date() > new Date(resetRequest.expires_at)) {
      await logActivity(
        resetRequest.user_id,
        "PASSWORD_RESET_REQUEST_EXPIRED",
        "Authentication",
        `${resetRequest.username} attempted to reset a password using an expired request. Request ID: ${requestId}.`,
      );

      return res.status(400).json({
        success: false,

        error: "Password reset request has expired. Please request a new code.",
      });
    }

    // ========================================
    // 11. New password cannot equal old password
    // ========================================
    const sameAsCurrentPassword = await bcrypt.compare(
      newPassword,
      resetRequest.password_hash,
    );

    if (sameAsCurrentPassword) {
      await logActivity(
        resetRequest.user_id,
        "PASSWORD_RESET_REJECTED",
        "Authentication",
        `${resetRequest.username} attempted to reuse the current password during Forgot Password. Request ID: ${requestId}.`,
      );

      return res.status(400).json({
        success: false,

        error: "New password must be different from the current password.",
      });
    }

    // ========================================
    // 12. Hash new password
    // ========================================
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // ========================================
    // 13. Begin database transaction
    // ========================================
    connection = await db.getConnection();

    await connection.beginTransaction();

    // ========================================
    // 14. Update users.password_hash
    // ========================================
    await connection.execute(
      `
        UPDATE users
        SET password_hash = ?
        WHERE user_id = ?
        `,
      [newPasswordHash, resetRequest.user_id],
    );

    // ========================================
    // 15. Mark recovery request used
    // ========================================
    await connection.execute(
      `
        UPDATE password_reset_requests
        SET used_at = NOW()
        WHERE public_id = ?
          AND used_at IS NULL
        `,
      [requestId],
    );
    // ========================================
    // 16. INVALIDATE LOGIN OTP
    //
    // If the user's password was reset,
    // invalidate any pending login OTP.
    // ========================================

    await connection.execute(
      `
  DELETE FROM otp_codes
  WHERE user_id = ?
  `,
      [resetRequest.user_id],
    );
    /*
        Invalidate any other password reset
        requests that may exist for this user.
      */
    // ========================================
    // 17. Invalidate other reset requests
    // ========================================
    await connection.execute(
      `
        UPDATE password_reset_requests

        SET used_at =
          COALESCE(
            used_at,
            NOW()
          )

        WHERE user_id = ?
          AND used_at IS NULL
        `,
      [resetRequest.user_id],
    );

    // ========================================
    // 18. Commit password change
    // ========================================
    await connection.commit();

    // ========================================
    // 19. Activity log — SUCCESS
    // ========================================
    await logActivity(
      resetRequest.user_id,
      "PASSWORD_RESET_SUCCESS",
      "Authentication",
      `${resetRequest.username} successfully changed the account password using Forgot Password. Request ID: ${requestId}. IP: ${getClientIp(req)}.`,
    );

    // ========================================
    // 20. Final response
    // ========================================
    return res.json({
      success: true,

      message: "Password reset successfully. You can now log in.",
    });
  } catch (err) {
    // ========================================
    // Roll back transaction if necessary
    // ========================================
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("PASSWORD RESET ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("RESET PASSWORD ERROR:", err);

    // ========================================
    // Activity log — server/database failure
    // ========================================
    if (resetRequestForLog) {
      await logActivity(
        resetRequestForLog.user_id,
        "PASSWORD_RESET_FAILED",
        "Authentication",
        `${resetRequestForLog.username} password reset failed because of a server/database error. Request ID: ${requestId}.`,
      );
    }

    return res.status(500).json({
      success: false,

      error: "Unable to reset the password.",
    });
  } finally {
    // ========================================
    // Release MySQL connection
    // ========================================
    if (connection) {
      connection.release();
    }
  }
});

// =======================
// LOGIN
// =======================
router.post("/login", async (req, res) => {
  console.log("LOGIN REQUEST FOR:", req.body.username);

  const username =
    typeof req.body.username === "string" ? req.body.username.trim() : "";

  const password =
    typeof req.body.password === "string" ? req.body.password : "";

  if (!username || !password) {
    return res.status(400).json({
      error: "Username and password are required.",
    });
  }
  // ==========================================
  // CHECK LOGIN COOLDOWN BEFORE AUTHENTICATING
  // ==========================================

  const cooldown = checkLoginCooldown(req);

  if (cooldown.locked) {
    return res.status(429).json({
      success: false,

      error:
        `Too many failed login attempts. ` +
        `Try again in ${formatCooldown(cooldown.retryAfter)}.`,

      retry_after: cooldown.retryAfter,

      locked: true,
    });
  }
  try {
    const [rows] = await db.execute(
      `
      SELECT
        u.user_id,
        u.username,
        u.email,
        u.password_hash,
        u.role_id,
        u.is_verified,
        u.is_active,
        r.role_name
      FROM users u
      INNER JOIN roles r
        ON u.role_id = r.role_id
      WHERE u.username = ?
      `,
      [username],
    );

    // Username does not exist
    if (rows.length === 0) {
      const failed = registerFailedLogin(req);

      // =============================
      // ACCOUNT NOW TEMPORARILY LOCKED
      // =============================

      if (failed.locked) {
        return res.status(429).json({
          success: false,

          error:
            `Too many failed login attempts. ` +
            `Try again in ${formatCooldown(failed.retryAfter)}.`,

          retry_after: failed.retryAfter,

          locked: true,

          attempts_remaining: 0,
        });
      }

      // =============================
      // STILL HAS ATTEMPTS
      // =============================

      return res.status(401).json({
        success: false,

        error:
          `Invalid username or password. ` +
          `${failed.attemptsRemaining} ` +
          `attempt${failed.attemptsRemaining === 1 ? "" : "s"} remaining.`,

        attempts_remaining: failed.attemptsRemaining,
      });
    }

    const user = rows[0];

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      const failed = registerFailedLogin(req);

      await logActivity(
        user.user_id,
        "FAILED LOGIN",
        "Authentication",
        `${user.username} entered an incorrect password.`,
      );

      // =============================
      // FIFTH FAILURE
      // =============================

      if (failed.locked) {
        await logActivity(
          user.user_id,
          "LOGIN COOLDOWN",
          "Authentication",
          `${user.username} reached the shared 5-attempt login limit and this client was temporarily blocked for 2 minutes.`,
        );

        return res.status(429).json({
          success: false,

          error:
            `Too many failed login attempts. ` +
            `Try again in ${formatCooldown(failed.retryAfter)}.`,

          retry_after: failed.retryAfter,

          locked: true,

          attempts_remaining: 0,
        });
      }

      // =============================
      // ATTEMPTS 1 - 4
      // =============================

      return res.status(401).json({
        success: false,

        error:
          `Invalid username or password. ` +
          `${failed.attemptsRemaining} ` +
          `attempt${failed.attemptsRemaining === 1 ? "" : "s"} remaining.`,

        attempts_remaining: failed.attemptsRemaining,
      });
    }

    // Correct password: reset previous failed attempts.
    clearFailedLogins(req);

    // Account inactive
    if (!user.is_active) {
      await logActivity(
        user.user_id,
        "LOGIN BLOCKED",
        "Authentication",
        `${user.username} attempted to login while inactive.`,
      );

      return res.status(403).json({
        error: "Your account has been deactivated.",
      });
    }
    // ==========================================
    // GENERATE LOGIN OTP
    // ==========================================

    const otp = crypto.randomInt(100000, 1000000).toString();

    // ==========================================
    // HASH OTP BEFORE DATABASE STORAGE
    // ==========================================

    const otpHash = await bcrypt.hash(otp, 10);

    // ==========================================
    // REMOVE OLD OTP
    // ==========================================

    await db.execute(
      `
  DELETE FROM otp_codes
  WHERE user_id = ?
  `,
      [user.user_id],
    );

    // ==========================================
    // OTP EXPIRATION
    // ==========================================

    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    // ==========================================
    // STORE ONLY HASH
    //
    // Never store the actual six-digit OTP.
    // ==========================================

    await db.execute(
      `
  INSERT INTO otp_codes
  (
    user_id,
    otp_hash,
    expires_at
  )
  VALUES (?, ?, ?)
  `,
      [user.user_id, otpHash, expiresAt],
    );

    const info = await transporter.sendMail({
      from: '"PTC Portal" <noreply@ptc.edu.ph>',
      to: user.email,
      subject: "PTC Portal OTP",
      text: `Your OTP is ${otp}.`,
      html: `...`,
    });

    console.log("Preview URL:", nodemailer.getTestMessageUrl(info));

    res.json({
      message: "OTP sent successfully.",
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: "Server Error",
    });
  }
});

// =======================
// RESEND OTP
// =======================
//
// This route is available only while an OTP record already
// exists for the username. It does NOT create a new login
// session by itself.
//
// Cooldown is enforced on the backend using the OTP expiry
// timestamp, so refreshing the frontend cannot bypass it.
//
router.post(["/resend-otp", "/auth/resend-otp"], async (req, res) => {
  const username =
    typeof req.body.username === "string" ? req.body.username.trim() : "";

  console.log("RESEND OTP REQUEST RECEIVED:", {
    originalUrl: req.originalUrl,
    baseUrl: req.baseUrl,
    path: req.path,
    username,
  });

  if (!username) {
    return res.status(400).json({
      success: false,
      error: "Username is required.",
    });
  }

  try {
    // ==========================================
    // 1. Find the account
    // ==========================================

    const [users] = await db.execute(
      `
      SELECT
        user_id,
        username,
        email,
        is_active
      FROM users
      WHERE username = ?
      LIMIT 1
      `,
      [username],
    );

    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Your OTP session is unavailable. Please login again.",
      });
    }

    const user = users[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        error: "Your account has been deactivated.",
      });
    }

    // ==========================================
    // 2. Existing OTP is required
    //
    // This prevents /resend-otp from being used
    // to start an OTP flow without a real login.
    // ==========================================

    const [otpRows] = await db.execute(
      `
      SELECT
        expires_at
      FROM otp_codes
      WHERE user_id = ?
      LIMIT 1
      `,
      [user.user_id],
    );

    if (otpRows.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Your OTP session has expired. Please login again.",
      });
    }

    // ==========================================
    // 3. Enforce 60-second resend cooldown
    //
    // Every OTP lives for OTP_EXPIRY_MS.
    // Therefore:
    //
    // issued_at = expires_at - OTP_EXPIRY_MS
    // ==========================================

    const expiresAtMs = new Date(otpRows[0].expires_at).getTime();

    if (!Number.isFinite(expiresAtMs)) {
      return res.status(500).json({
        success: false,
        error: "Unable to validate the OTP cooldown.",
      });
    }

    const issuedAtMs = expiresAtMs - OTP_EXPIRY_MS;
    const nextAllowedAtMs = issuedAtMs + OTP_RESEND_COOLDOWN_MS;
    const remainingMs = nextAllowedAtMs - Date.now();

    if (remainingMs > 0) {
      const retryAfter = Math.max(1, Math.ceil(remainingMs / 1000));

      return res.status(429).json({
        success: false,
        error: `Please wait ${retryAfter} second${
          retryAfter === 1 ? "" : "s"
        } before requesting another OTP.`,
        retry_after: retryAfter,
      });
    }

    // ==========================================
    // 4. Create a fresh OTP
    // ==========================================
    // ==========================================
    // CREATE NEW OTP
    // ==========================================

    const otp = crypto.randomInt(100000, 1000000).toString();

    // ==========================================
    // HASH NEW OTP
    // ==========================================

    const otpHash = await bcrypt.hash(otp, 10);

    // ==========================================
    // NEW EXPIRATION
    // ==========================================

    const newExpiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    // ==========================================
    // STORE HASH
    // ==========================================

    await db.execute(
      `
 UPDATE otp_codes
SET
  otp_hash = ?,
  expires_at = ?,
  attempt_count = 0
WHERE user_id = ?
  `,
      [otpHash, newExpiresAt, user.user_id],
    );

    // ==========================================
    // 5. Send the new OTP
    // ==========================================

    const info = await transporter.sendMail({
      from: '"PTC Portal" <noreply@ptc.edu.ph>',
      to: user.email,
      subject: "PTC Portal OTP",
      text: `Your new OTP is ${otp}.`,
      html: `...`,
    });

    console.log("RESEND OTP PREVIEW URL:", nodemailer.getTestMessageUrl(info));

    return res.json({
      success: true,
      message: "A new OTP has been sent successfully.",
      cooldown_seconds: 60,
    });
  } catch (err) {
    console.error("RESEND OTP ERROR:", err);

    return res.status(500).json({
      success: false,
      error: "Unable to resend OTP.",
    });
  }
});

router.post("/verify-otp", async (req, res) => {
  const username =
    typeof req.body.username === "string" ? req.body.username.trim() : "";

  const otp = typeof req.body.otp === "string" ? req.body.otp.trim() : "";

  if (!username || !otp) {
    return res.status(400).json({
      error: "Username and OTP are required.",
    });
  }

  try {
    // ==========================================
    // 1. Find user + current role
    // ==========================================

    const [users] = await db.execute(
      `
      SELECT
        u.user_id,
        u.username,
        u.email,
        u.role_id,
        u.is_verified,
        u.is_active,
        r.role_name
      FROM users u
      INNER JOIN roles r
        ON u.role_id = r.role_id
      WHERE u.username = ?
      LIMIT 1
      `,
      [username],
    );

    if (users.length === 0) {
      return res.status(404).json({
        error: "User not found.",
      });
    }

    const user = users[0];

    // ==========================================
    // 2. Make sure account is still active
    // ==========================================

    if (!user.is_active) {
      return res.status(403).json({
        error: "Your account has been deactivated.",
      });
    }

    // ==========================================
    // 3. Find OTP
    // ==========================================

    const [otpRows] = await db.execute(
      `
 SELECT
  otp_hash,
  expires_at,
  attempt_count
FROM otp_codes
WHERE user_id = ?
LIMIT 1
  `,
      [user.user_id],
    );

    if (otpRows.length === 0) {
      return res.status(400).json({
        error: "OTP not found.",
      });
    }

    const storedOtp = otpRows[0];
    // ==========================================
    // 4. CHECK OTP ATTEMPT LIMIT
    // ==========================================

    const MAX_OTP_ATTEMPTS = 5;

    if (Number(storedOtp.attempt_count) >= MAX_OTP_ATTEMPTS) {
      await db.execute(
        `
    DELETE FROM otp_codes
    WHERE user_id = ?
    `,
        [user.user_id],
      );

      return res.status(429).json({
        success: false,
        error: "Maximum OTP attempts reached. Please login again.",
      });
    }

    // ==========================================
    // 4. Check expiration
    // ==========================================

    if (new Date() > new Date(storedOtp.expires_at)) {
      await db.execute(
        `
        DELETE FROM otp_codes
        WHERE user_id = ?
        `,
        [user.user_id],
      );

      return res.status(400).json({
        error: "OTP has expired.",
      });
    }

    // ==========================================
    // COMPARE OTP AGAINST BCRYPT HASH
    // ==========================================

    const otpMatches = await bcrypt.compare(otp, storedOtp.otp_hash);

    if (!otpMatches) {
      // ========================================
      // INCREASE FAILED OTP ATTEMPTS
      // ========================================

      const newAttemptCount = Number(storedOtp.attempt_count) + 1;

      await db.execute(
        `
    UPDATE otp_codes
    SET attempt_count = ?
    WHERE user_id = ?
    `,
        [newAttemptCount, user.user_id],
      );

      const attemptsRemaining = Math.max(MAX_OTP_ATTEMPTS - newAttemptCount, 0);

      // ========================================
      // FIFTH FAILED ATTEMPT
      // ========================================

      if (attemptsRemaining === 0) {
        await db.execute(
          `
      DELETE FROM otp_codes
      WHERE user_id = ?
      `,
          [user.user_id],
        );

        return res.status(429).json({
          success: false,
          error: "Maximum OTP attempts reached. Please login again.",
          attempts_remaining: 0,
        });
      }

      return res.status(400).json({
        success: false,

        error:
          `Invalid OTP. ` +
          `${attemptsRemaining} attempt${
            attemptsRemaining === 1 ? "" : "s"
          } remaining.`,

        attempts_remaining: attemptsRemaining,
      });
    }

    // ==========================================
    // 6. Verify account
    // ==========================================

    if (!user.is_verified) {
      await db.execute(
        `
        UPDATE users
        SET is_verified = 1
        WHERE user_id = ?
        `,
        [user.user_id],
      );

      user.is_verified = 1;
    }

    // ==========================================
    // 7. Delete used OTP
    // ==========================================

    await db.execute(
      `
      DELETE FROM otp_codes
      WHERE user_id = ?
      `,
      [user.user_id],
    );

    // ==========================================
    // 8. Check JWT configuration
    // ==========================================

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured.");

      return res.status(500).json({
        success: false,
        error: "Authentication configuration error.",
      });
    }

    // ==========================================
    // 9. Create JWT
    // ==========================================

    const token = jwt.sign(
      {
        user_id: Number(user.user_id),
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "8h",
      },
    );

    // ==========================================
    // 10. Log successful login
    // ==========================================

    await logActivity(
      user.user_id,
      "LOGIN",
      "Authentication",
      `${user.username} logged in successfully.`,
    );

    // ==========================================
    // 11. Return authenticated session
    // ==========================================

    return res.json({
      success: true,
      message: "Login successful.",

      token,

      user: {
        user_id: Number(user.user_id),
        username: user.username,
        email: user.email,
        role_id: Number(user.role_id),

        // Frontend canonical role field
        role: user.role_name,

        // Keep DB/API field too
        role_name: user.role_name,
      },
    });
  } catch (err) {
    console.error("VERIFY OTP ERROR:", err);

    return res.status(500).json({
      success: false,
      error: "Server error.",
    });
  }
});
// =======================
// CURRENT AUTHENTICATED USER
// =======================

router.get("/me", authenticate, async (req, res) => {
  try {
    // ==========================================
    // AUTHENTICATED USER
    //
    // authenticate middleware already:
    // - verifies the JWT
    // - reloads the user from the database
    // - checks active status
    // - checks verified status
    // - attaches the trusted user to req.user
    // ==========================================

    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    // ==========================================
    // RETURN CURRENT USER
    // ==========================================

    return res.json({
      success: true,

      user: {
        user_id: Number(user.user_id),

        username: user.username,

        email: user.email,

        role_id: Number(user.role_id),

        role: user.role_name,

        role_name: user.role_name,
      },
    });
  } catch (error) {
    console.error("GET /auth/me ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to load authenticated user.",
    });
  }
});

// =======================
// DEVELOPMENT LOGIN
// =======================
//
// IMPORTANT:
// This route must NEVER be enabled in production.
//
router.post("/dev-login", async (req, res) => {
  // =====================================================
  // DEVELOPMENT LOGIN SECURITY
  //
  // Dev login is available ONLY when:
  //
  // 1. Application is NOT running in production
  // 2. ALLOW_DEV_LOGIN is explicitly set to "true"
  //
  // This prevents accidental exposure during deployment.
  // =====================================================

  const isProduction = process.env.NODE_ENV === "production";

  const devLoginEnabled = process.env.ALLOW_DEV_LOGIN === "true";

  if (isProduction || !devLoginEnabled) {
    return res.status(404).json({
      success: false,
      message: "Endpoint not found.",
    });
  }

  const { username } = req.body;

  if (!username) {
    return res.status(400).json({
      success: false,
      message: "Username is required.",
    });
  }

  try {
    const [rows] = await db.execute(
      `
      SELECT
        u.user_id,
        u.username,
        u.email,
        u.role_id,
        u.is_active,
        u.is_verified,
        r.role_name

      FROM users u

      INNER JOIN roles r
        ON r.role_id = u.role_id

      WHERE u.username = ?

      LIMIT 1
      `,
      [username],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Development user not found.",
      });
    }

    const user = rows[0];

    // =====================================================
    // ACCOUNT VALIDATION
    // =====================================================

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "Development account is inactive.",
      });
    }

    if (!user.is_verified) {
      return res.status(403).json({
        success: false,
        message: "Development account is not verified.",
      });
    }

    // =====================================================
    // JWT CONFIGURATION
    // =====================================================

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured.");

      return res.status(500).json({
        success: false,
        message: "Authentication configuration error.",
      });
    }

    // =====================================================
    // CREATE JWT
    // =====================================================

    const token = jwt.sign(
      {
        user_id: Number(user.user_id),
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "8h",
      },
    );

    // =====================================================
    // ACTIVITY LOG
    // =====================================================

    await logActivity(
      user.user_id,
      "DEV LOGIN",
      "Authentication",
      `${user.username} logged in using development access.`,
    );

    // =====================================================
    // RESPONSE
    // =====================================================

    return res.json({
      success: true,

      message: "Development login successful.",

      token,

      user: {
        user_id: Number(user.user_id),
        username: user.username,
        email: user.email,
        role_id: Number(user.role_id),

        role: user.role_name,
        role_name: user.role_name,
      },
    });
  } catch (error) {
    console.error("DEV LOGIN ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Development login failed.",
    });
  }
});

export default router;
