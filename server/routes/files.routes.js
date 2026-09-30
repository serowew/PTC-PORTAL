import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

import db from "../db.js";
import authenticate from "../middleware/authenticate.js";

const router = express.Router();

// =====================================================
// UPLOAD DIRECTORY
// =====================================================

const uploadFolder = path.join(process.cwd(), "uploads", "files");

if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder, {
    recursive: true,
  });
}

// =====================================================
// ALLOWED FILE TYPES
// =====================================================

const allowedMimeTypes = new Set([
  "application/pdf",

  "image/jpeg",
  "image/png",

  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const allowedExtensions = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".doc",
  ".docx",
]);

// =====================================================
// FILE FILTER
// =====================================================

const fileFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname).toLowerCase();

  const validExtension = allowedExtensions.has(extension);

  const validMimeType = allowedMimeTypes.has(file.mimetype);

  if (!validExtension || !validMimeType) {
    return cb(
      new Error(
        "Invalid file type. Only PDF, JPG, JPEG, PNG, DOC, and DOCX files are allowed.",
      ),
    );
  }

  return cb(null, true);
};

// =====================================================
// MULTER STORAGE
// =====================================================

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadFolder);
  },

  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();

    const uniqueName = `${crypto.randomUUID()}${extension}`;

    cb(null, uniqueName);
  },
});

// =====================================================
// MULTER CONFIGURATION
// =====================================================

const upload = multer({
  storage,
  fileFilter,

  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

// =====================================================
// MULTER ERROR HANDLER
// =====================================================

const uploadSingleFile = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          success: false,
          message: "File is too large. Maximum file size is 10 MB.",
        });
      }

      return res.status(400).json({
        success: false,
        message: err.message || "File upload failed.",
      });
    }

    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || "Invalid file upload.",
      });
    }

    next();
  });
};

// =====================================================
// UPLOAD FILE
//
// POST /api/files/upload
// =====================================================

router.post("/upload", authenticate, uploadSingleFile, async (req, res) => {
  try {
    // =================================================
    // AUTHENTICATED USER
    // =================================================

    const uploadedBy = Number(req.user?.user_id);

    if (!Number.isInteger(uploadedBy) || uploadedBy <= 0) {
      if (req.file?.path) {
        fs.unlink(req.file.path, () => {});
      }

      return res.status(401).json({
        success: false,
        message: "Authenticated user could not be identified.",
      });
    }

    // =================================================
    // VALIDATE FILE
    // =================================================

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded.",
      });
    }

    const { originalname, filename, size, mimetype } = req.file;

    const filePath = `uploads/files/${filename}`;

    // =================================================
    // SAVE FILE RECORD
    // =================================================

    const [result] = await db.execute(
      `
          INSERT INTO files (
            uploaded_by,
            file_name,
            original_name,
            file_path,
            file_size,
            mime_type
          )
          VALUES (?, ?, ?, ?, ?, ?)
          `,
      [uploadedBy, filename, originalname, filePath, size, mimetype],
    );

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(201).json({
      success: true,
      message: "File uploaded successfully.",

      file_id: result.insertId,
      file_name: originalname,
      stored_name: filename,
      file_path: filePath,
      file_size: size,
      mime_type: mimetype,
    });
  } catch (error) {
    console.error("UPLOAD FILE ERROR:", error);

    // Remove physical file if DB save fails
    if (req.file?.path) {
      fs.unlink(req.file.path, (unlinkError) => {
        if (unlinkError) {
          console.error("UPLOAD CLEANUP ERROR:", unlinkError);
        }
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to upload file.",
    });
  }
});
// =====================================================
// VIEW PROTECTED FILE
//
// GET /api/files/:fileId
//
// SECURITY:
// - User must be authenticated
// - Original uploader may access the file
// - Admin / Registrar may access announcement files
// - Other roles may access only if their role is a
//   recipient of the announcement
// - Announcement must currently be active/published
// =====================================================

router.get("/:fileId", authenticate, async (req, res) => {
  try {
    const fileId = Number(req.params.fileId);

    const currentUserId = Number(req.user?.user_id);

    const currentRoleId = Number(req.user?.role_id);

    const currentRoleName = String(req.user?.role_name || "").trim();

    // =================================================
    // VALIDATE FILE ID
    // =================================================

    if (!Number.isInteger(fileId) || fileId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid file ID.",
      });
    }

    // =================================================
    // VALIDATE AUTHENTICATED USER
    // =================================================

    if (
      !Number.isInteger(currentUserId) ||
      currentUserId <= 0 ||
      !Number.isInteger(currentRoleId) ||
      currentRoleId <= 0
    ) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user could not be identified.",
      });
    }

    // =================================================
    // LOAD FILE RECORD
    // =================================================

    const [fileRows] = await db.execute(
      `
          SELECT
            file_id,
            uploaded_by,
            file_name,
            original_name,
            file_path,
            file_size,
            mime_type
          FROM files
          WHERE file_id = ?
          LIMIT 1
          `,
      [fileId],
    );

    if (fileRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "File not found.",
      });
    }

    const file = fileRows[0];

    // =================================================
    // FILE AUTHORIZATION
    // =================================================

    let hasFileAccess = false;

    // -------------------------------------------------
    // RULE 1:
    // Original uploader always has access.
    // -------------------------------------------------

    if (Number(file.uploaded_by) === currentUserId) {
      hasFileAccess = true;
    }

    // -------------------------------------------------
    // RULE 2:
    // Check whether this file belongs to an
    // announcement.
    // -------------------------------------------------

    const [announcementRows] = await db.execute(
      `
          SELECT DISTINCT
            a.announcement_id,
            a.created_by,
            a.is_active,
            a.publish_date,
            a.expiry_date
          FROM announcement_attachments aa

          INNER JOIN announcements a
            ON a.announcement_id =
               aa.announcement_id

          WHERE aa.file_id = ?
          `,
      [fileId],
    );

    const isAnnouncementFile = announcementRows.length > 0;

    // -------------------------------------------------
    // RULE 3:
    // Admin and Registrar may manage/view
    // announcement attachments.
    // -------------------------------------------------

    if (
      !hasFileAccess &&
      isAnnouncementFile &&
      (currentRoleName === "Admin" || currentRoleName === "Registrar")
    ) {
      hasFileAccess = true;
    }

    // -------------------------------------------------
    // RULE 4:
    // Program Head / Faculty / Student / other
    // recipient roles must actually be included
    // in announcement_recipients.
    //
    // Announcement must also:
    // - be active
    // - already be published
    // - not be expired
    // -------------------------------------------------

    if (!hasFileAccess && isAnnouncementFile) {
      const [recipientRows] = await db.execute(
        `
            SELECT
              ar.recipient_id
            FROM announcement_attachments aa

            INNER JOIN announcements a
              ON a.announcement_id =
                 aa.announcement_id

            INNER JOIN announcement_recipients ar
              ON ar.announcement_id =
                 a.announcement_id

            WHERE
              aa.file_id = ?

              AND ar.role_id = ?

              AND a.is_active = 1

              AND (
                a.publish_date IS NULL
                OR a.publish_date <= NOW()
              )

              AND (
                a.expiry_date IS NULL
                OR a.expiry_date >= NOW()
              )

            LIMIT 1
            `,
        [fileId, currentRoleId],
      );

      if (recipientRows.length > 0) {
        hasFileAccess = true;
      }
    }

    // -------------------------------------------------
    // DENY ACCESS
    // -------------------------------------------------

    if (!hasFileAccess) {
      console.warn("FILE ACCESS DENIED:", {
        file_id: fileId,
        user_id: currentUserId,
        role_id: currentRoleId,
        role_name: currentRoleName,
      });

      return res.status(403).json({
        success: false,
        message: "You are not authorized to access this file.",
      });
    }

    // =================================================
    // SAFE FILE PATH
    // =================================================

    const uploadsRoot = path.resolve(process.cwd(), "uploads");

    const absolutePath = path.resolve(process.cwd(), file.file_path);

    const relativePath = path.relative(uploadsRoot, absolutePath);

    // =================================================
    // PATH TRAVERSAL PROTECTION
    // =================================================

    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      console.error("INVALID FILE PATH:", file.file_path);

      return res.status(403).json({
        success: false,
        message: "File access denied.",
      });
    }

    // =================================================
    // CHECK PHYSICAL FILE
    // =================================================

    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({
        success: false,
        message: "Physical file could not be found.",
      });
    }

    // =================================================
    // SECURITY HEADERS
    // =================================================

    res.setHeader("X-Content-Type-Options", "nosniff");

    res.setHeader("Cache-Control", "private, no-store");

    res.setHeader("Content-Type", file.mime_type || "application/octet-stream");

    const safeOriginalName = encodeURIComponent(
      file.original_name || file.file_name || "file",
    );

    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${safeOriginalName}`,
    );

    // =================================================
    // SEND FILE
    // =================================================

    return res.sendFile(absolutePath);
  } catch (error) {
    console.error("PROTECTED FILE ACCESS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve file.",
    });
  }
});

export default router;
