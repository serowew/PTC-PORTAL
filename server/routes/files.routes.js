import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import db from "../db.js";

const router = express.Router();

const uploadFolder = path.join(process.cwd(), "uploads/files");

// Create folder automatically
if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder, {
    recursive: true,
  });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadFolder);
  },

  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;

    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,

  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

// ==========================================
// UPLOAD FILE
// POST /api/files/upload
// ==========================================

router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "No file uploaded.",
      });
    }

    const { originalname, filename, size, mimetype } = req.file;

    const uploaded_by = req.body.uploaded_by;

    const filePath = `uploads/files/${filename}`;

    const [result] = await db.execute(
      `

INSERT INTO files

(
uploaded_by,
file_name,
original_name,
file_path,
file_size,
mime_type
)

VALUES(?,?,?,?,?,?)

`,

      [uploaded_by, filename, originalname, filePath, size, mimetype],
    );

    res.status(201).json({
      message: "File uploaded successfully.",

      file_id: result.insertId,

      file_name: originalname,

      file_path: filePath,
    });
  } catch (err) {
    console.error("UPLOAD FILE ERROR:", err);

    res.status(500).json({
      error: "Failed to upload file.",
    });
  }
});

export default router;
