import { createHash, timingSafeEqual } from "node:crypto";

// All admission period dates are local to Asia/Manila; do not use NOW() for window checks.
export const MANILA_NOW_SQL = "DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR)";

export function parseManilaDateTime(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
  ) {
    return null;
  }
  const instant = Date.parse(`${value}:00+08:00`);
  if (!Number.isFinite(instant)) return null;
  const reconstructed = new Date(instant + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
  if (reconstructed !== value) return null;
  return { mysql: `${value.slice(0, 10)} ${value.slice(11)}:00`, instant };
}

export function textField(value, max, { required = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) throw new InputError("A required field is missing.");
    return null;
  }
  if (typeof value !== "string") throw new InputError("Invalid text field.");
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) throw new InputError("A required field is missing.");
    return null;
  }
  if (trimmed.length > max || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new InputError("Invalid text length or characters.");
  }
  return trimmed;
}

export function emailField(value) {
  const email = textField(value, 254, { required: true });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new InputError("Enter a valid email address.");
  }
  return email.toLowerCase();
}

export function validIsoDate(value) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InputError("Birth date must be YYYY-MM-DD.");
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new InputError("Invalid birth date.");
  }
  return value;
}

export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function respondError(res, error, label) {
  if (error instanceof InputError) {
    return res
      .status(error.status)
      .json({ success: false, message: error.message });
  }
  console.error(
    label,
    error?.code || error?.name || "Error",
    error?.message || "Unknown error",
  );
  return res
    .status(500)
    .json({ success: false, message: "An unexpected server error occurred." });
}

export function secretMatches(raw, storedHash) {
  if (
    typeof raw !== "string" ||
    raw.length < 40 ||
    raw.length > 128 ||
    !storedHash
  )
    return false;
  const calculated = createHash("sha256").update(raw).digest();
  const expected = Buffer.from(storedHash, "hex");
  return (
    calculated.length === expected.length &&
    timingSafeEqual(calculated, expected)
  );
}

export function bearerSecret(req) {
  const auth = req.get("authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_-]{40,128})$/.exec(auth);
  return match ? match[1] : null;
}

// Single-process development protection; production needs shared rate limits and a reverse proxy.
const windows = new Map();

export function basicLimiter(limit, windowMs) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.baseUrl}:${limit}`;
    const now = Date.now();
    let bucket = windows.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      windows.set(key, bucket);
    }

    bucket.count += 1;

    if (windows.size > 10000) {
      for (const [k, value] of windows) {
        if (value.resetAt <= now) windows.delete(k);
      }
    }

    if (bucket.count > limit) {
      res.set("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({
        success: false,
        message: "Too many requests. Try again later.",
      });
    }

    return next();
  };
}
