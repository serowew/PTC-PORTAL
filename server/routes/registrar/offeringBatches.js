import express from "express";
import db from "../../db.js";
import {
  createSystemNotification,
  findScheduleConflicts,
  hasCompleteSchedule,
  toPositiveInt,
  writeOfferingAudit,
} from "../../services/offeringBatchWorkflow.js";

const router = express.Router();
const BATCH_STATUSES = [
  "Pending Program Head",
  "Ready for Registrar",
  "Published",
];

function getRegistrar(req, res) {
  const userId = toPositiveInt(req.user?.user_id);
  if (!userId || req.user?.role_name !== "Registrar") {
    res.status(userId ? 403 : 401).json({
      success: false,
      message: userId
        ? "Registrar access is required."
        : "Authentication is required.",
    });
    return null;
  }
  return { user_id: userId };
}

function getIdList(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) return null;
  const ids = raw.map(toPositiveInt);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return null;
  return ids;
}

async function loadBatch(connection, batchId) {
  const [batchRows] = await connection.execute(
    `
      SELECT
          cob.*,
          ay.academic_year,
          sem.semester_name,
          c.course_code,
          c.course_name,
          cu.curriculum_name,
          u.username AS program_head_username
      FROM class_offering_batches cob
      INNER JOIN academic_years ay ON ay.academic_year_id = cob.academic_year_id
      INNER JOIN semesters sem ON sem.semester_id = cob.semester_id
      INNER JOIN courses c ON c.course_id = cob.course_id
      INNER JOIN curriculum cu ON cu.curriculum_id = cob.curriculum_id
      LEFT JOIN users u ON u.user_id = cob.program_head_user_id
      WHERE cob.batch_id = ?
      LIMIT 1
    `,
    [batchId],
  );
  if (!batchRows.length) return null;

  const [offeringRows] = await connection.execute(
    `
      SELECT
          so.offering_id,
          so.batch_id,
          so.section_subject_id,
          so.subject_id,
          so.section_id,
          so.faculty_id,
          so.academic_year_id,
          so.semester_id,
          so.schedule_days,
          so.schedule_time,
          so.schedule_start_time,
          so.schedule_end_time,
          so.max_students,
          so.status AS offering_status,
          sub.subject_code,
          sub.subject_name,
          sub.units,
          sec.section_name,
          CONCAT_WS(' ', f.first_name, NULLIF(f.middle_name, ''), f.last_name) AS faculty_name
      FROM subject_offerings so
      INNER JOIN subjects sub ON sub.subject_id = so.subject_id
      INNER JOIN sections sec ON sec.section_id = so.section_id
      LEFT JOIN faculty f ON f.faculty_id = so.faculty_id
      WHERE so.batch_id = ?
      ORDER BY sec.section_name, sub.subject_code
    `,
    [batchId],
  );
  return { ...batchRows[0], offerings: offeringRows };
}

router.get("/open-periods", async (req, res) => {
  if (!getRegistrar(req, res)) return;
  try {
    const [rows] = await db.execute(
      `
        SELECT
            ep.enrollment_period_id,
            ep.academic_year_id,
            ep.semester_id,
            ay.academic_year,
            sem.semester_name,
            ep.status,
            ep.opened_at
        FROM enrollment_periods ep
        INNER JOIN academic_years ay ON ay.academic_year_id = ep.academic_year_id
        INNER JOIN semesters sem ON sem.semester_id = ep.semester_id
        WHERE ep.status = 'Open'
        ORDER BY ay.academic_year DESC, sem.semester_id ASC
      `,
    );
    return res.json({ success: true, open_periods: rows });
  } catch (error) {
    console.error("GET OFFERING BATCH OPEN PERIODS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load open academic periods.",
    });
  }
});

router.get("/sections", async (req, res) => {
  if (!getRegistrar(req, res)) return;
  const academicYearId = toPositiveInt(req.query.academic_year_id);
  const semesterId = toPositiveInt(req.query.semester_id);
  const courseId = toPositiveInt(req.query.course_id);
  const curriculumId = toPositiveInt(req.query.curriculum_id);
  const yearLevel = toPositiveInt(req.query.year_level);
  if (
    !academicYearId ||
    !semesterId ||
    !courseId ||
    !curriculumId ||
    !yearLevel
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Valid academic_year_id, semester_id, course_id, curriculum_id, and year_level are required.",
    });
  }

  try {
    const [periodRows] = await db.execute(
      `SELECT enrollment_period_id FROM enrollment_periods WHERE academic_year_id = ? AND semester_id = ? AND status = 'Open' LIMIT 1`,
      [academicYearId, semesterId],
    );
    if (!periodRows.length) {
      return res.status(409).json({
        success: false,
        message:
          "The selected academic year and semester are not open in the Registrar.",
      });
    }

    const [curriculumRows] = await db.execute(
      `SELECT curriculum_id FROM curriculum WHERE curriculum_id = ? AND course_id = ? AND is_active = 1 LIMIT 1`,
      [curriculumId, courseId],
    );
    if (!curriculumRows.length) {
      return res.status(409).json({
        success: false,
        message:
          "The active curriculum does not belong to the selected course.",
      });
    }

    const [subjectRows] = await db.execute(
      `
        SELECT COUNT(*) AS required_subject_count
        FROM curriculum_subjects cs
        INNER JOIN subjects s ON s.subject_id = cs.subject_id AND s.is_active = 1
        WHERE cs.curriculum_id = ?
          AND cs.year_level = ?
          AND cs.semester_id = ?
          AND cs.is_required = 1
      `,
      [curriculumId, yearLevel, semesterId],
    );
    const requiredSubjectCount = Number(
      subjectRows[0]?.required_subject_count || 0,
    );
    if (!requiredSubjectCount) {
      return res.status(409).json({
        success: false,
        message:
          "No required curriculum subjects are configured for this year level and semester.",
      });
    }

    const [sections] = await db.execute(
      `
        SELECT sec.section_id, sec.section_name, sec.course_id, sec.academic_year_id,
               sec.year_level, sec.max_students
        FROM sections sec
        WHERE sec.academic_year_id = ?
          AND sec.course_id = ?
          AND sec.year_level = ?
          AND NOT EXISTS (
            SELECT 1
            FROM curriculum_subjects cs
            INNER JOIN subject_offerings so
              ON so.subject_id = cs.subject_id
             AND so.section_id = sec.section_id
             AND so.academic_year_id = sec.academic_year_id
             AND so.semester_id = cs.semester_id
            WHERE cs.curriculum_id = ?
              AND cs.year_level = sec.year_level
              AND cs.semester_id = ?
              AND cs.is_required = 1
          )
          AND NOT EXISTS (
            SELECT 1
            FROM curriculum_subjects cs
            INNER JOIN section_subjects ss
              ON ss.subject_id = cs.subject_id
             AND ss.section_id = sec.section_id
             AND ss.academic_year_id = sec.academic_year_id
             AND ss.semester_id = cs.semester_id
            WHERE cs.curriculum_id = ?
              AND cs.year_level = sec.year_level
              AND cs.semester_id = ?
              AND cs.is_required = 1
              AND ss.status = 'Cancelled'
          )
        ORDER BY sec.section_name
      `,
      [
        academicYearId,
        courseId,
        yearLevel,
        curriculumId,
        semesterId,
        curriculumId,
        semesterId,
      ],
    );
    return res.json({
      success: true,
      sections,
      required_subject_count: requiredSubjectCount,
    });
  } catch (error) {
    console.error("GET OFFERING BATCH SECTIONS ERROR:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to load available sections." });
  }
});

// Generate Year-Level Sections
router.post("/sections/generate", async (req, res) => {
  const actor = getRegistrar(req, res);
  if (!actor) return;

  const strictId = (value) => {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && !/^[1-9]\d*$/.test(value)) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  };

  const academicYearId = strictId(req.body?.academic_year_id);
  const semesterId = strictId(req.body?.semester_id);
  const courseId = strictId(req.body?.course_id);
  const yearLevel = strictId(req.body?.year_level);
  const startLetter =
    typeof req.body?.start_letter === "string"
      ? req.body.start_letter.trim().toUpperCase()
      : "";
  const endLetter =
    typeof req.body?.end_letter === "string"
      ? req.body.end_letter.trim().toUpperCase()
      : "";
  const maxStudents = req.body?.max_students;

  if (!academicYearId || !semesterId || !courseId || !yearLevel) {
    return res.status(400).json({
      success: false,
      code: "INVALID_SECTION_SETUP",
      message: "Select a valid academic year, semester, course and year level.",
    });
  }
  if (
    !/^[A-Z]$/.test(startLetter) ||
    !/^[A-Z]$/.test(endLetter) ||
    startLetter > endLetter
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_SECTION_RANGE",
      message:
        "Select a valid section range from A through Z, in ascending order.",
    });
  }
  if (!Number.isInteger(maxStudents) || maxStudents < 40 || maxStudents > 50) {
    return res.status(400).json({
      success: false,
      code: "INVALID_SECTION_CAPACITY",
      message: "Section capacity must be a whole number from 40 to 50.",
    });
  }

  const letters = Array.from(
    { length: endLetter.charCodeAt(0) - startLetter.charCodeAt(0) + 1 },
    (_, index) => String.fromCharCode(startLetter.charCodeAt(0) + index),
  );

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // Lock the term to serialize overlapping generation requests.
    const [periodRows] = await connection.execute(
      `SELECT enrollment_period_id FROM enrollment_periods
       WHERE academic_year_id = ? AND semester_id = ? AND status = 'Open'
       LIMIT 1 FOR UPDATE`,
      [academicYearId, semesterId],
    );
    if (!periodRows.length) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        code: "ENROLLMENT_PERIOD_NOT_OPEN",
        message: "The selected enrollment period is not open.",
      });
    }

    const [courseRows] = await connection.execute(
      `SELECT course_id, course_code, total_years
       FROM courses WHERE course_id = ? LIMIT 1`,
      [courseId],
    );
    if (!courseRows.length) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        code: "COURSE_NOT_FOUND",
        message: "The selected course was not found.",
      });
    }
    const course = courseRows[0];
    const totalYears = Number(course.total_years || 4);
    const courseCode = String(course.course_code || "")
      .trim()
      .toUpperCase();
    if (yearLevel > totalYears || !/^[A-Z0-9-]{2,20}$/.test(courseCode)) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        code: "INVALID_SECTION_SETUP",
        message: "The selected course code or year level is not valid.",
      });
    }

    const names = letters.map(
      (letter) => `${courseCode}-${yearLevel}${letter}`,
    );
    const placeholders = names.map(() => "?").join(", ");
    const [existing] = await connection.execute(
      `SELECT section_id, section_name FROM sections
       WHERE academic_year_id = ? AND course_id = ? AND year_level = ?
         AND section_name IN (${placeholders})
       FOR UPDATE`,
      [academicYearId, courseId, yearLevel, ...names],
    );
    const existingNames = new Set(
      existing.map((row) => String(row.section_name).toUpperCase()),
    );

    const createdSections = [];
    const skippedSections = [];
    for (const name of names) {
      if (existingNames.has(name)) {
        skippedSections.push(name);
        continue;
      }
      const [result] = await connection.execute(
        `INSERT INTO sections
           (course_id, academic_year_id, year_level, section_name, max_students)
         VALUES (?, ?, ?, ?, ?)`,
        [courseId, academicYearId, yearLevel, name, maxStudents],
      );
      const newSection = {
        section_id: Number(result.insertId),
        section_name: name,
        course_id: courseId,
        academic_year_id: academicYearId,
        year_level: yearLevel,
        max_students: maxStudents,
      };
      await writeOfferingAudit(
        connection,
        actor.user_id,
        "sections",
        newSection.section_id,
        "INSERT",
        null,
        newSection,
      );
      createdSections.push(newSection);
    }

    await connection.commit();
    return res.status(createdSections.length ? 201 : 200).json({
      success: true,
      message: createdSections.length
        ? `${createdSections.length} section(s) created successfully.`
        : "All requested sections already exist. No duplicates were created.",
      academic_year_id: academicYearId,
      semester_id: semesterId,
      course_id: courseId,
      year_level: yearLevel,
      created_count: createdSections.length,
      skipped_count: skippedSections.length,
      created_sections: createdSections,
      skipped_sections: skippedSections,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("GENERATE CLASS OFFERING SECTIONS ERROR:", error);
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        code: "SECTION_ALREADY_EXISTS",
        message:
          "One of the requested sections already exists. No new sections were saved.",
      });
    }
    return res.status(500).json({
      success: false,
      message: "Failed to generate sections. No partial sections were saved.",
    });
  } finally {
    if (connection) connection.release();
  }
});

router.get("/program-heads", async (req, res) => {
  if (!getRegistrar(req, res)) return;

  const courseId = toPositiveInt(req.query.course_id);
  if (!courseId) {
    return res.status(400).json({
      success: false,
      message: "A valid course_id is required.",
    });
  }

  try {
    const [courseRows] = await db.execute(
      `
        SELECT
            c.course_id,
            c.course_code,
            c.course_name,
            c.department_id,
            d.department_name
        FROM courses c
        INNER JOIN departments d
          ON d.department_id = c.department_id
        WHERE c.course_id = ?
        LIMIT 1
      `,
      [courseId],
    );

    if (!courseRows.length) {
      return res.status(404).json({
        success: false,
        message: "Course not found.",
      });
    }

    const course = courseRows[0];
    const [programHeads] = await db.execute(
      `
        SELECT DISTINCT
            f.faculty_id,
            f.employee_number,
            f.first_name,
            f.middle_name,
            f.last_name,
            CONCAT_WS(
              ' ',
              f.first_name,
              NULLIF(f.middle_name, ''),
              f.last_name
            ) AS program_head_name,
            u.user_id,
            u.username,
            ph.department_id
        FROM program_heads ph
        INNER JOIN faculty f
          ON f.faculty_id = ph.faculty_id
        INNER JOIN users u
          ON u.user_id = f.user_id
        INNER JOIN roles r
          ON r.role_id = u.role_id
        WHERE ph.department_id = ?
          AND ph.is_active = 1
          AND (ph.start_date IS NULL OR ph.start_date <= CURDATE())
          AND (ph.end_date IS NULL OR ph.end_date >= CURDATE())
          AND r.role_name = 'Program Head'
          AND u.is_active = 1
          AND u.is_verified = 1
          AND u.is_archived = 0
        ORDER BY f.last_name, f.first_name, u.username
      `,
      [Number(course.department_id)],
    );

    return res.json({
      success: true,
      course,
      program_heads: programHeads,
    });
  } catch (error) {
    console.error("GET OFFERING BATCH PROGRAM HEADS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load Program Heads for the selected course.",
    });
  }
});

router.get("/", async (req, res) => {
  if (!getRegistrar(req, res)) return;
  const requestedStatus =
    typeof req.query.status === "string" ? req.query.status.trim() : "";
  if (requestedStatus && !BATCH_STATUSES.includes(requestedStatus)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid batch status." });
  }
  try {
    const values = [];
    let statusFilter = "";
    if (requestedStatus) {
      statusFilter = "WHERE cob.batch_status = ?";
      values.push(requestedStatus);
    }
    const [rows] = await db.execute(
      `
        SELECT
            cob.batch_id,
            cob.academic_year_id,
            ay.academic_year,
            cob.semester_id,
            sem.semester_name,
            cob.course_id,
            c.course_code,
            c.course_name,
            cob.curriculum_id,
            cu.curriculum_name,
            cob.year_level,
            cob.program_head_user_id,
            ph.username AS program_head_username,
            cob.batch_status,
            cob.submitted_by,
            cob.submitted_at,
            cob.returned_at,
            cob.published_at,
            (SELECT COUNT(*) FROM subject_offerings so WHERE so.batch_id = cob.batch_id) AS offering_count,
           (SELECT COUNT(*) FROM subject_offerings so
 WHERE so.batch_id = cob.batch_id
   AND so.schedule_days IS NOT NULL
   AND so.schedule_start_time IS NOT NULL
   AND so.schedule_end_time IS NOT NULL) AS scheduled_count
        FROM class_offering_batches cob
        INNER JOIN academic_years ay ON ay.academic_year_id = cob.academic_year_id
        INNER JOIN semesters sem ON sem.semester_id = cob.semester_id
        INNER JOIN courses c ON c.course_id = cob.course_id
        INNER JOIN curriculum cu ON cu.curriculum_id = cob.curriculum_id
        LEFT JOIN users ph ON ph.user_id = cob.program_head_user_id
        ${statusFilter}
        ORDER BY cob.submitted_at DESC, cob.batch_id DESC
      `,
      values,
    );
    return res.json({ success: true, batches: rows });
  } catch (error) {
    console.error("GET REGISTRAR OFFERING BATCHES ERROR:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to load offering batches." });
  }
});

router.post("/", async (req, res) => {
  const actor = getRegistrar(req, res);
  if (!actor) return;

  const academicYearId = toPositiveInt(req.body?.academic_year_id);
  const semesterId = toPositiveInt(req.body?.semester_id);
  const courseId = toPositiveInt(req.body?.course_id);
  const curriculumId = toPositiveInt(req.body?.curriculum_id);
  const yearLevel = toPositiveInt(req.body?.year_level);
  const programHeadUserId = toPositiveInt(req.body?.program_head_user_id);
  const sectionIds = getIdList(req.body?.section_ids);

  if (
    !academicYearId ||
    !semesterId ||
    !courseId ||
    !curriculumId ||
    !yearLevel ||
    !programHeadUserId ||
    !sectionIds
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Provide valid academic_year_id, semester_id, course_id, curriculum_id, year_level, program_head_user_id, and a unique non-empty section_ids array (maximum 100).",
    });
  }

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [periodRows] = await connection.execute(
      `SELECT enrollment_period_id FROM enrollment_periods WHERE academic_year_id = ? AND semester_id = ? AND status = 'Open' LIMIT 1 FOR UPDATE`,
      [academicYearId, semesterId],
    );
    if (!periodRows.length) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message:
          "The selected academic year and semester are not open in the Registrar.",
      });
    }

    const [courseRows] = await connection.execute(
      `
        SELECT c.course_id, c.course_code, c.course_name, c.department_id, cu.curriculum_name
        FROM courses c
        INNER JOIN curriculum cu ON cu.course_id = c.course_id
        WHERE c.course_id = ? AND cu.curriculum_id = ? AND cu.is_active = 1
        LIMIT 1 FOR UPDATE
      `,
      [courseId, curriculumId],
    );
    if (!courseRows.length) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message:
          "The selected active curriculum does not belong to the selected course.",
      });
    }
    const course = courseRows[0];

    const [programHeadRows] = await connection.execute(
      `
        SELECT u.user_id, u.username
        FROM program_heads ph
        INNER JOIN faculty f ON f.faculty_id = ph.faculty_id
        INNER JOIN users u ON u.user_id = f.user_id
        INNER JOIN roles r ON r.role_id = u.role_id
        WHERE ph.department_id = ?
          AND u.user_id = ?
          AND ph.is_active = 1
          AND (ph.start_date IS NULL OR ph.start_date <= CURDATE())
          AND (ph.end_date IS NULL OR ph.end_date >= CURDATE())
          AND r.role_name = 'Program Head'
          AND u.is_active = 1
          AND u.is_verified = 1
          AND u.is_archived = 0
        ORDER BY ph.start_date DESC, ph.program_head_id DESC
        LIMIT 1
        FOR UPDATE
      `,
      [Number(course.department_id), programHeadUserId],
    );
    if (!programHeadRows.length) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message:
          "The selected Program Head is not active and assigned to this course department.",
      });
    }
    const programHead = programHeadRows[0];

    const [subjectRows] = await connection.execute(
      `
        SELECT s.subject_id, s.subject_code, s.subject_name, s.units
        FROM curriculum_subjects cs
        INNER JOIN subjects s ON s.subject_id = cs.subject_id
        WHERE cs.curriculum_id = ?
          AND cs.year_level = ?
          AND cs.semester_id = ?
          AND cs.is_required = 1
          AND s.is_active = 1
        ORDER BY cs.display_order, s.subject_code
        FOR UPDATE
      `,
      [curriculumId, yearLevel, semesterId],
    );
    if (!subjectRows.length) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message:
          "The selected curriculum has no required subjects for this year level and semester.",
      });
    }

    const sectionPlaceholders = sectionIds.map(() => "?").join(",");
    const [sectionRows] = await connection.execute(
      `
        SELECT section_id, section_name, course_id, academic_year_id, year_level, max_students
        FROM sections
        WHERE section_id IN (${sectionPlaceholders})
          AND course_id = ?
          AND academic_year_id = ?
          AND year_level = ?
        FOR UPDATE
      `,
      [...sectionIds, courseId, academicYearId, yearLevel],
    );
    if (sectionRows.length !== sectionIds.length) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message:
          "One or more selected sections do not match the academic year, course, and year level.",
      });
    }

    const subjectIds = subjectRows.map((row) => Number(row.subject_id));
    const subjectPlaceholders = subjectIds.map(() => "?").join(",");
    const [existingRows] = await connection.execute(
      `
        SELECT ss.section_subject_id, ss.section_id, ss.subject_id, ss.status AS section_subject_status,
               so.offering_id, so.batch_id
        FROM section_subjects ss
        LEFT JOIN subject_offerings so ON so.section_subject_id = ss.section_subject_id
        WHERE ss.section_id IN (${sectionPlaceholders})
          AND ss.academic_year_id = ?
          AND ss.semester_id = ?
          AND ss.subject_id IN (${subjectPlaceholders})
        FOR UPDATE
      `,
      [...sectionIds, academicYearId, semesterId, ...subjectIds],
    );
    const canceledSectionSubject = existingRows.find(
      (row) => row.section_subject_status === "Cancelled",
    );
    if (canceledSectionSubject) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message:
          "A selected section already has a cancelled subject row required by this curriculum.",
        section_subject_id: Number(canceledSectionSubject.section_subject_id),
      });
    }
    const duplicateOffering = existingRows.find(
      (row) => row.offering_id !== null,
    );
    if (duplicateOffering) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message:
          "At least one selected section already has an offering for this subject and term. No batch was created.",
        existing_offering_id: Number(duplicateOffering.offering_id),
        existing_section_id: Number(duplicateOffering.section_id),
        existing_subject_id: Number(duplicateOffering.subject_id),
        existing_batch_id: duplicateOffering.batch_id
          ? Number(duplicateOffering.batch_id)
          : null,
      });
    }

    const [batchResult] = await connection.execute(
      `
        INSERT INTO class_offering_batches
          (academic_year_id, semester_id, course_id, curriculum_id, year_level,
           program_head_user_id, batch_status, submitted_by)
        VALUES (?, ?, ?, ?, ?, ?, 'Pending Program Head', ?)
      `,
      [
        academicYearId,
        semesterId,
        courseId,
        curriculumId,
        yearLevel,
        Number(programHead.user_id),
        actor.user_id,
      ],
    );
    const batchId = Number(batchResult.insertId);
    const existingSectionSubjects = new Map(
      existingRows.map((row) => [`${row.section_id}:${row.subject_id}`, row]),
    );
    let createdOfferingCount = 0;

    for (const section of sectionRows) {
      for (const subject of subjectRows) {
        const key = `${section.section_id}:${subject.subject_id}`;
        const existing = existingSectionSubjects.get(key);
        let sectionSubjectId;
        let maxStudents =
          Number(section.max_students) > 0 ? Number(section.max_students) : 50;

        if (existing) {
          sectionSubjectId = Number(existing.section_subject_id);
          await connection.execute(
            `UPDATE section_subjects SET status = 'Closed' WHERE section_subject_id = ?`,
            [sectionSubjectId],
          );
        } else {
          const [sectionSubjectResult] = await connection.execute(
            `
              INSERT INTO section_subjects
                (section_id, subject_id, academic_year_id, semester_id, max_students, status)
              VALUES (?, ?, ?, ?, ?, 'Closed')
            `,
            [
              Number(section.section_id),
              Number(subject.subject_id),
              academicYearId,
              semesterId,
              maxStudents,
            ],
          );
          sectionSubjectId = Number(sectionSubjectResult.insertId);
        }

        const [offeringResult] = await connection.execute(
          `
            INSERT INTO subject_offerings
              (section_subject_id, batch_id, subject_id, section_id, faculty_id, room_id,
               academic_year_id, semester_id, schedule_days, schedule_time,
               schedule_start_time, schedule_end_time, max_students, status)
            VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, NULL, NULL, ?, 'Closed')
          `,
          [
            sectionSubjectId,
            batchId,
            Number(subject.subject_id),
            Number(section.section_id),
            academicYearId,
            semesterId,
            maxStudents,
          ],
        );
        createdOfferingCount += 1;
        await writeOfferingAudit(
          connection,
          actor.user_id,
          "subject_offerings",
          Number(offeringResult.insertId),
          "INSERT",
          null,
          {
            offering_id: Number(offeringResult.insertId),
            batch_id: batchId,
            section_subject_id: sectionSubjectId,
            section_id: Number(section.section_id),
            subject_id: Number(subject.subject_id),
            faculty_id: null,
            schedule_days: null,
            schedule_time: null,
            status: "Closed",
          },
        );
      }
    }

    await writeOfferingAudit(
      connection,
      actor.user_id,
      "class_offering_batches",
      batchId,
      "INSERT",
      null,
      {
        batch_id: batchId,
        academic_year_id: academicYearId,
        semester_id: semesterId,
        course_id: courseId,
        curriculum_id: curriculumId,
        year_level: yearLevel,
        section_ids: sectionIds,
        program_head_user_id: Number(programHead.user_id),
        batch_status: "Pending Program Head",
      },
    );
    await createSystemNotification(
      connection,
      Number(programHead.user_id),
      "Class offering batch ready for scheduling",
      `${course.course_code} Year ${yearLevel} has ${createdOfferingCount} unassigned subject offerings to schedule. Batch #${batchId}.`,
    );
    await connection.commit();
    return res.status(201).json({
      success: true,
      message:
        "Unassigned subject offerings were created and sent to the Program Head.",
      batch: {
        batch_id: batchId,
        academic_year_id: academicYearId,
        semester_id: semesterId,
        course_id: courseId,
        curriculum_id: curriculumId,
        year_level: yearLevel,
        section_ids: sectionIds,
        program_head_user_id: Number(programHead.user_id),
        program_head_username: programHead.username,
        batch_status: "Pending Program Head",
        offering_count: createdOfferingCount,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("CREATE OFFERING BATCH ERROR:", error);
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message:
          "An offering already exists for one of the selected section-subject-term combinations.",
      });
    }
    return res.status(500).json({
      success: false,
      message: "Failed to create and submit the class offering batch.",
    });
  } finally {
    if (connection) connection.release();
  }
});

/* Professor Assignment Requests */

router.get("/faculty-requests", async (req, res) => {
  if (!getRegistrar(req, res)) return;

  try {
    const [requests] = await db.execute(
      `
        SELECT
          fr.request_id,
          fr.batch_id,
          fr.offering_id,
          fr.proposed_faculty_id,
          fr.original_faculty_id,
          fr.requested_at,
          fr.status,
          cob.batch_status,
          ay.academic_year,
          sem.semester_name,
          c.course_code,
          c.course_name,
          cob.year_level,
          sec.section_name,
          sub.subject_code,
          sub.subject_name,
          so.faculty_id AS current_faculty_id,
          so.schedule_days,
          so.schedule_time,
          so.status AS offering_status,
          CONCAT_WS(
            ' ',
            f.first_name,
            NULLIF(f.middle_name, ''),
            f.last_name
          ) AS proposed_faculty_name
        FROM class_offering_faculty_requests fr
        INNER JOIN class_offering_batches cob
          ON cob.batch_id = fr.batch_id
        INNER JOIN subject_offerings so
          ON so.offering_id = fr.offering_id
        INNER JOIN academic_years ay
          ON ay.academic_year_id = cob.academic_year_id
        INNER JOIN semesters sem
          ON sem.semester_id = cob.semester_id
        INNER JOIN courses c
          ON c.course_id = cob.course_id
        INNER JOIN sections sec
          ON sec.section_id = so.section_id
        INNER JOIN subjects sub
          ON sub.subject_id = so.subject_id
        INNER JOIN faculty f
          ON f.faculty_id = fr.proposed_faculty_id
        WHERE fr.status = 'Pending'
        ORDER BY
          fr.requested_at ASC,
          fr.request_id ASC
      `,
    );

    return res.json({
      success: true,
      requests,
    });
  } catch (error) {
    console.error("GET CLASS OFFERING FACULTY REQUESTS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Could not load pending professor assignments.",
    });
  }
});

/* Review Professor Assignment */

router.post("/faculty-requests/:requestId/review", async (req, res) => {
  const actor = getRegistrar(req, res);
  if (!actor) return;

  const requestId = toPositiveInt(req.params.requestId);
  const decision = req.body?.decision;

  const reviewRemarks =
    typeof req.body?.review_remarks === "string"
      ? req.body.review_remarks.trim()
      : "";

  if (
    !requestId ||
    !["Approved", "Rejected"].includes(decision) ||
    reviewRemarks.length > 500 ||
    (decision === "Rejected" && !reviewRemarks)
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Valid request ID and decision are required; rejection needs a reason (max 500 characters).",
    });
  }

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    const [idRows] = await connection.execute(
      `
          SELECT batch_id, offering_id
          FROM class_offering_faculty_requests
          WHERE request_id = ?
          LIMIT 1
        `,
      [requestId],
    );

    if (!idRows.length) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Instructor request not found.",
      });
    }

    const batchId = Number(idRows[0].batch_id);
    const offeringId = Number(idRows[0].offering_id);

    // Lock batch, offering and request in order.

    const [batchRows] = await connection.execute(
      `
          SELECT cob.*, c.department_id
          FROM class_offering_batches cob
          INNER JOIN courses c
            ON c.course_id = cob.course_id
          WHERE cob.batch_id = ?
          LIMIT 1
          FOR UPDATE
        `,
      [batchId],
    );

    const [offeringRows] = await connection.execute(
      `
          SELECT *
          FROM subject_offerings
          WHERE offering_id = ?
            AND batch_id = ?
          LIMIT 1
          FOR UPDATE
        `,
      [offeringId, batchId],
    );

    const [requestRows] = await connection.execute(
      `
          SELECT *
          FROM class_offering_faculty_requests
          WHERE request_id = ?
          LIMIT 1
          FOR UPDATE
        `,
      [requestId],
    );

    const batch = batchRows[0];
    const offering = offeringRows[0];
    const request = requestRows[0];

    if (
      !batch ||
      !offering ||
      !request ||
      Number(request.batch_id) !== batchId ||
      Number(request.offering_id) !== offeringId
    ) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "Request and offering are inconsistent.",
      });
    }

    if (request.status !== "Pending") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "This professor request has already been reviewed.",
      });
    }

    if (batch.batch_status !== "Published" || offering.status !== "Open") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "Only an Open offering in a Published batch can be reviewed.",
      });
    }

    if (decision === "Approved") {
      // Reject stale assignment requests.

      if (
        !hasCompleteSchedule(offering) ||
        String(offering.schedule_days) !==
          String(request.original_schedule_days) ||
        String(offering.schedule_start_time) !==
          String(request.original_start_time) ||
        String(offering.schedule_end_time) !==
          String(request.original_end_time) ||
        Number(offering.faculty_id || 0) !==
          Number(request.original_faculty_id || 0)
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "The published offering changed since the request; it must be re-evaluated.",
        });
      }

      // Validate the proposed professor.

      const [facultyRows] = await connection.execute(
        `
            SELECT
              f.faculty_id,
              f.department_id,
              u.is_active,
              u.is_verified,
              u.is_archived,
              r.role_name
            FROM faculty f
            INNER JOIN users u
              ON u.user_id = f.user_id
            INNER JOIN roles r
              ON r.role_id = u.role_id
            WHERE f.faculty_id = ?
            LIMIT 1
            FOR UPDATE
          `,
        [request.proposed_faculty_id],
      );

      const faculty = facultyRows[0];

      if (
        !faculty ||
        !["Faculty", "Program Head"].includes(faculty.role_name) ||
        Number(faculty.is_active) !== 1 ||
        Number(faculty.is_verified) !== 1 ||
        Number(faculty.is_archived) !== 0 ||
        Number(faculty.department_id) !== Number(batch.department_id)
      ) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message:
            "The proposed professor is no longer eligible for this course.",
        });
      }

      // Do not change professors after grades exist.

      const [existingGrades] = await connection.execute(
        `
            SELECT g.grade_id
            FROM enrollment_subjects es
            INNER JOIN grades g
              ON g.enrollment_subject_id =
                 es.enrollment_subject_id
            WHERE es.offering_id = ?
            LIMIT 1
          `,
        [offeringId],
      );

      if (existingGrades.length) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "Cannot change professor after grades are recorded.",
        });
      }

      // Revalidate professor schedule conflicts.

      const conflicts = await findScheduleConflicts(
        connection,
        {
          ...offering,
          faculty_id: Number(request.proposed_faculty_id),
        },
        offeringId,
      );

      if (conflicts.length) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "Professor schedule conflicts must be resolved.",
          conflicts,
        });
      }

      // Apply the approved professor assignment.

      await connection.execute(
        `
            UPDATE subject_offerings
            SET faculty_id = ?
            WHERE offering_id = ?
              AND batch_id = ?
              AND status = 'Open'
          `,
        [request.proposed_faculty_id, offeringId, batchId],
      );

      await writeOfferingAudit(
        connection,
        actor.user_id,
        "subject_offerings",
        offeringId,
        "UPDATE",
        { faculty_id: offering.faculty_id },
        {
          faculty_id: request.proposed_faculty_id,
        },
      );
    }

    // Record Registrar decision.

    await connection.execute(
      `
          UPDATE class_offering_faculty_requests
          SET
            status = ?,
            reviewed_by = ?,
            reviewed_at = NOW(),
            review_remarks = ?
          WHERE request_id = ?
            AND status = 'Pending'
        `,
      [decision, actor.user_id, reviewRemarks || null, requestId],
    );

    await writeOfferingAudit(
      connection,
      actor.user_id,
      "class_offering_faculty_requests",
      requestId,
      "UPDATE",
      { status: "Pending" },
      {
        status: decision,
        reviewed_by: actor.user_id,
        review_remarks: reviewRemarks || null,
      },
    );

    await createSystemNotification(
      connection,
      Number(request.requested_by),
      `Professor assignment ${decision.toLowerCase()}`,
      `Registrar ${decision.toLowerCase()} professor assignment request #${requestId} for offering #${offeringId}.`,
    );

    await connection.commit();

    return res.json({
      success: true,
      request_id: requestId,
      request_status: decision,
      batch_id: batchId,
      offering_id: offeringId,
      offering_status: "Open",
      message:
        decision === "Approved"
          ? "Professor assigned. Published offering stays Open and needs no republishing."
          : "Professor request rejected. Published offering remains unchanged.",
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    console.error("REVIEW CLASS OFFERING FACULTY REQUEST ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Could not review professor assignment.",
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

router.get("/:batchId", async (req, res) => {
  if (!getRegistrar(req, res)) return;
  const batchId = toPositiveInt(req.params.batchId);
  if (!batchId)
    return res
      .status(400)
      .json({ success: false, message: "Invalid batch ID." });
  try {
    const batch = await loadBatch(db, batchId);
    if (!batch)
      return res
        .status(404)
        .json({ success: false, message: "Offering batch not found." });
    return res.json({ success: true, batch });
  } catch (error) {
    console.error("GET REGISTRAR OFFERING BATCH ERROR:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to load the offering batch." });
  }
});

router.post("/:batchId/publish", async (req, res) => {
  const actor = getRegistrar(req, res);
  if (!actor) return;
  const batchId = toPositiveInt(req.params.batchId);
  if (!batchId)
    return res
      .status(400)
      .json({ success: false, message: "Invalid batch ID." });

  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [batchRows] = await connection.execute(
      `SELECT * FROM class_offering_batches WHERE batch_id = ? LIMIT 1 FOR UPDATE`,
      [batchId],
    );
    if (!batchRows.length) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Offering batch not found." });
    }
    const batch = batchRows[0];
    if (batch.batch_status !== "Ready for Registrar") {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "Only a batch returned by the Program Head can be published.",
      });
    }

    const [offeringRows] = await connection.execute(
      `SELECT * FROM subject_offerings WHERE batch_id = ? ORDER BY offering_id FOR UPDATE`,
      [batchId],
    );
    if (!offeringRows.length) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "This batch has no subject offerings.",
      });
    }

    const incomplete = offeringRows.filter((row) => !hasCompleteSchedule(row));
    if (incomplete.length) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message:
          "Every offering must have valid class days and start/end times before publication.",
        incomplete_offering_ids: incomplete.map((row) =>
          Number(row.offering_id),
        ),
      });
    }

    for (const offering of offeringRows) {
      const conflicts = await findScheduleConflicts(
        connection,
        offering,
        Number(offering.offering_id),
      );
      if (conflicts.length) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: "Schedule conflicts must be resolved before publication.",
          offering_id: Number(offering.offering_id),
          conflicts,
        });
      }
    }

    await connection.execute(
      `UPDATE subject_offerings SET status = 'Open' WHERE batch_id = ?`,
      [batchId],
    );
    await connection.execute(
      `
        UPDATE section_subjects ss
        INNER JOIN subject_offerings so ON so.section_subject_id = ss.section_subject_id
        SET ss.status = 'Open'
        WHERE so.batch_id = ?
      `,
      [batchId],
    );
    await connection.execute(
      `UPDATE class_offering_batches SET batch_status = 'Published', published_by = ?, published_at = NOW() WHERE batch_id = ?`,
      [actor.user_id, batchId],
    );
    await writeOfferingAudit(
      connection,
      actor.user_id,
      "class_offering_batches",
      batchId,
      "UPDATE",
      { batch_status: batch.batch_status },
      { batch_status: "Published" },
    );
    if (batch.program_head_user_id) {
      await createSystemNotification(
        connection,
        Number(batch.program_head_user_id),
        "Class schedule published",
        `Offering batch #${batchId} was published by the Registrar.`,
      );
    }
    await connection.commit();
    return res.json({
      success: true,
      message: "The valid class schedule was published.",
      batch_id: batchId,
      published_offering_count: offeringRows.length,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("PUBLISH OFFERING BATCH ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to publish the offering batch.",
    });
  } finally {
    if (connection) connection.release();
  }
});

export default router;
