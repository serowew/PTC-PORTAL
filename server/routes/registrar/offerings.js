// routes/registrar/offerings.js
//
// Registrar Subject Offering Management
//
// Responsibility:
//
// Curriculum subject
//        ↓
// Section Subject
//        ↓
// Subject Offering
//
// This router creates/manages semester scheduling data.
//
// IMPORTANT:
// - Mounted behind authenticate + requireRole("Registrar")
// - req.user is authoritative
// - Student enrollment is NOT handled here.

import express from "express";
import db from "../../db.js";

const router = express.Router();

// =====================================================
// HELPERS
// =====================================================

function toPositiveInt(value) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0 ? number : null;
}

function getRegistrarActor(req, res) {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: "Authentication is required.",
    });

    return null;
  }

  if (req.user.role_name !== "Registrar") {
    res.status(403).json({
      success: false,
      message: "Registrar access is required.",
    });

    return null;
  }

  const userId = toPositiveInt(req.user.user_id);

  if (!userId) {
    res.status(401).json({
      success: false,
      message: "Authenticated Registrar user ID is invalid.",
    });

    return null;
  }

  return {
    user_id: userId,
    username: req.user.username || null,
  };
}
// =====================================================
// SCHEDULE CONFLICT HELPERS
// =====================================================

const DAY_ALIASES = {
  monday: "Monday",
  mon: "Monday",

  tuesday: "Tuesday",
  tue: "Tuesday",
  tues: "Tuesday",

  wednesday: "Wednesday",
  wed: "Wednesday",

  thursday: "Thursday",
  thu: "Thursday",
  thur: "Thursday",
  thurs: "Thursday",

  friday: "Friday",
  fri: "Friday",

  saturday: "Saturday",
  sat: "Saturday",

  sunday: "Sunday",
  sun: "Sunday",
};

function parseScheduleDays(value) {
  if (!value || typeof value !== "string") {
    return [];
  }

  const rawParts = value
    .split(/[,/&]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const days = [];

  for (const raw of rawParts) {
    const normalized = raw.toLowerCase().replace(/\./g, "");

    const day = DAY_ALIASES[normalized];

    if (day && !days.includes(day)) {
      days.push(day);
    }
  }

  return days;
}

function parseClockTime(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const text = value.trim().toUpperCase().replace(/\s+/g, " ");

  // 12-hour examples:
  // 8:00 AM
  // 8 AM
  // 10:30 PM

  let match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);

  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const meridiem = match[3];

    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
      return null;
    }

    if (meridiem === "AM") {
      if (hour === 12) {
        hour = 0;
      }
    } else if (hour !== 12) {
      hour += 12;
    }

    return hour * 60 + minute;
  }

  // 24-hour examples:
  // 08:00
  // 13:30

  match = text.match(/^(\d{1,2}):(\d{2})$/);

  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }

    return hour * 60 + minute;
  }

  // Legacy simple values:
  // 8
  // 10
  //
  // Allows old stored schedules such as:
  // 8-10

  match = text.match(/^(\d{1,2})$/);

  if (match) {
    const hour = Number(match[1]);

    if (hour < 0 || hour > 23) {
      return null;
    }

    return hour * 60;
  }

  return null;
}

function parseScheduleTimeRange(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/[–—]/g, "-");

  const parts = normalized.split(/\s*-\s*/);

  if (parts.length !== 2) {
    return null;
  }

  const start = parseClockTime(parts[0]);
  const end = parseClockTime(parts[1]);

  if (start === null || end === null || end <= start) {
    return null;
  }

  return {
    start,
    end,
  };
}

function schedulesOverlap(daysA, timeA, daysB, timeB) {
  const parsedDaysA = parseScheduleDays(daysA);

  const parsedDaysB = parseScheduleDays(daysB);

  const parsedTimeA = parseScheduleTimeRange(timeA);

  const parsedTimeB = parseScheduleTimeRange(timeB);

  if (
    parsedDaysA.length === 0 ||
    parsedDaysB.length === 0 ||
    !parsedTimeA ||
    !parsedTimeB
  ) {
    return {
      overlap: false,
      common_days: [],
    };
  }

  const commonDays = parsedDaysA.filter((day) => parsedDaysB.includes(day));

  if (commonDays.length === 0) {
    return {
      overlap: false,
      common_days: [],
    };
  }

  // 8:00-10:00 and 10:00-12:00
  // are NOT overlapping.

  const timeOverlap =
    parsedTimeA.start < parsedTimeB.end && parsedTimeB.start < parsedTimeA.end;

  return {
    overlap: timeOverlap,

    common_days: timeOverlap ? commonDays : [],
  };
}
async function findOfferingScheduleConflicts(
  connection,
  {
    offeringId,
    academicYearId,
    semesterId,
    sectionId,
    facultyId,
    roomId,
    scheduleDays,
    scheduleTime,
  },
) {
  const [candidateRows] = await connection.execute(
    `
      SELECT
          so.offering_id,
          so.subject_id,
          so.section_id,
          so.faculty_id,
          so.room_id,
          so.schedule_days,
          so.schedule_time,
          so.status,

          sub.subject_code,
          sub.subject_name,

          sec.section_name,

          CONCAT_WS(
            ' ',
            f.first_name,
            NULLIF(f.middle_name, ''),
            f.last_name
          ) AS faculty_name,

          r.room_code,
          r.room_name

      FROM subject_offerings so

      INNER JOIN section_subjects ss
          ON ss.section_subject_id =
             so.section_subject_id

      INNER JOIN subjects sub
          ON sub.subject_id =
             so.subject_id

      INNER JOIN sections sec
          ON sec.section_id =
             so.section_id

      LEFT JOIN faculty f
          ON f.faculty_id =
             so.faculty_id

      LEFT JOIN rooms r
          ON r.room_id =
             so.room_id

      WHERE so.offering_id <> ?

        AND so.academic_year_id = ?

        AND so.semester_id = ?

        AND so.status <> 'Cancelled'

        AND ss.status <> 'Cancelled'

        AND so.schedule_days IS NOT NULL
        AND TRIM(so.schedule_days) <> ''

        AND so.schedule_time IS NOT NULL
        AND TRIM(so.schedule_time) <> ''

        AND (
             so.section_id = ?

             OR (
               ? IS NOT NULL
               AND so.faculty_id = ?
             )

             OR (
               ? IS NOT NULL
               AND so.room_id = ?
             )
        )
      `,
    [
      offeringId,
      academicYearId,
      semesterId,
      sectionId,

      facultyId,
      facultyId,

      roomId,
      roomId,
    ],
  );

  const conflicts = [];

  for (const candidate of candidateRows) {
    const overlap = schedulesOverlap(
      scheduleDays,
      scheduleTime,
      candidate.schedule_days,
      candidate.schedule_time,
    );

    if (!overlap.overlap) {
      continue;
    }

    const conflictTypes = [];

    if (Number(candidate.section_id) === Number(sectionId)) {
      conflictTypes.push("SECTION");
    }

    if (
      facultyId !== null &&
      candidate.faculty_id !== null &&
      Number(candidate.faculty_id) === Number(facultyId)
    ) {
      conflictTypes.push("FACULTY");
    }

    if (
      roomId !== null &&
      candidate.room_id !== null &&
      Number(candidate.room_id) === Number(roomId)
    ) {
      conflictTypes.push("ROOM");
    }

    if (conflictTypes.length === 0) {
      continue;
    }

    conflicts.push({
      offering_id: Number(candidate.offering_id),

      conflict_types: conflictTypes,

      common_days: overlap.common_days,

      subject: {
        subject_id: Number(candidate.subject_id),

        subject_code: candidate.subject_code,

        subject_name: candidate.subject_name,
      },

      section: {
        section_id: Number(candidate.section_id),

        section_name: candidate.section_name,
      },

      faculty:
        candidate.faculty_id !== null
          ? {
              faculty_id: Number(candidate.faculty_id),

              faculty_name: candidate.faculty_name,
            }
          : null,

      room:
        candidate.room_id !== null
          ? {
              room_id: Number(candidate.room_id),

              room_code: candidate.room_code,

              room_name: candidate.room_name,
            }
          : null,

      schedule: {
        days: candidate.schedule_days,

        time: candidate.schedule_time,
      },

      status: candidate.status,
    });
  }

  return conflicts;
}
// =====================================================
// GET SETUP DATA
//
// GET /api/registrar/offerings/setup-data
//
// Optional query:
//
// ?academic_year_id=2
// &semester_id=2
// &course_id=1
// &year_level=2
// &curriculum_id=6
// &section_id=2
//
// PURPOSE:
//
// Supplies everything needed by the Registrar
// Subject Offering Management page:
//
// - Academic years
// - Semesters
// - Courses
// - Curricula
// - Sections
// - Curriculum subjects
// - Faculty
// - Rooms
// - Existing section subjects
// - Existing subject offerings
// =====================================================

router.get("/setup-data", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  try {
    // =================================================
    // QUERY FILTERS
    // =================================================

    const academicYearId =
      req.query.academic_year_id === undefined
        ? null
        : toPositiveInt(req.query.academic_year_id);

    const semesterId =
      req.query.semester_id === undefined
        ? null
        : toPositiveInt(req.query.semester_id);

    const courseId =
      req.query.course_id === undefined
        ? null
        : toPositiveInt(req.query.course_id);

    const yearLevel =
      req.query.year_level === undefined
        ? null
        : toPositiveInt(req.query.year_level);

    const curriculumId =
      req.query.curriculum_id === undefined
        ? null
        : toPositiveInt(req.query.curriculum_id);

    const sectionId =
      req.query.section_id === undefined
        ? null
        : toPositiveInt(req.query.section_id);

    // =================================================
    // INVALID QUERY VALUES
    // =================================================

    if (req.query.academic_year_id !== undefined && !academicYearId) {
      return res.status(400).json({
        success: false,
        message: "Invalid academic_year_id.",
      });
    }

    if (req.query.semester_id !== undefined && !semesterId) {
      return res.status(400).json({
        success: false,
        message: "Invalid semester_id.",
      });
    }

    if (req.query.course_id !== undefined && !courseId) {
      return res.status(400).json({
        success: false,
        message: "Invalid course_id.",
      });
    }

    if (req.query.year_level !== undefined && !yearLevel) {
      return res.status(400).json({
        success: false,
        message: "Invalid year_level.",
      });
    }

    if (req.query.curriculum_id !== undefined && !curriculumId) {
      return res.status(400).json({
        success: false,
        message: "Invalid curriculum_id.",
      });
    }

    if (req.query.section_id !== undefined && !sectionId) {
      return res.status(400).json({
        success: false,
        message: "Invalid section_id.",
      });
    }

    // =================================================
    // ACADEMIC YEARS
    // =================================================

    const [academicYears] = await db.execute(
      `
      SELECT
          academic_year_id,
          academic_year,
          is_current

      FROM academic_years

      ORDER BY
          is_current DESC,
          academic_year_id DESC
      `,
    );

    // =================================================
    // SEMESTERS
    // =================================================

    const [semesters] = await db.execute(
      `
      SELECT
          semester_id,
          semester_name

      FROM semesters

      ORDER BY semester_id ASC
      `,
    );

    // =================================================
    // COURSES
    // =================================================

    const [courses] = await db.execute(
      `
      SELECT
          c.course_id,
          c.department_id,
          c.course_code,
          c.course_name,
          c.total_years,

          d.department_name

      FROM courses c

      LEFT JOIN departments d
          ON d.department_id =
             c.department_id

      ORDER BY c.course_code ASC
      `,
    );

    // =================================================
    // CURRICULA
    //
    // Course-specific when course_id is selected.
    //
    // Multiple active curricula are allowed.
    // Registrar must choose explicitly.
    // =================================================

    let curricula = [];

    if (courseId) {
      const [rows] = await db.execute(
        `
        SELECT
            curriculum_id,
            course_id,
            curriculum_name,
            effective_year,
            total_units,
            is_active

        FROM curriculum

        WHERE course_id = ?
          AND is_active = 1

        ORDER BY
            effective_year DESC,
            curriculum_id DESC
        `,
        [courseId],
      );

      curricula = rows;
    }

    // =================================================
    // SECTIONS
    //
    // Filtered by:
    //
    // academic year
    // course
    // year level
    // =================================================

    let sections = [];

    if (academicYearId && courseId && yearLevel) {
      const [rows] = await db.execute(
        `
        SELECT
            section_id,
            course_id,
            academic_year_id,
            year_level,
            section_name,
            max_students

        FROM sections

        WHERE academic_year_id = ?
          AND course_id = ?
          AND year_level = ?

        ORDER BY section_name ASC
        `,
        [academicYearId, courseId, yearLevel],
      );

      sections = rows;
    }

    // =================================================
    // SELECTED CURRICULUM VALIDATION
    // =================================================

    let selectedCurriculum = null;

    if (curriculumId) {
      const [rows] = await db.execute(
        `
        SELECT
            curriculum_id,
            course_id,
            curriculum_name,
            effective_year,
            total_units,
            is_active

        FROM curriculum

        WHERE curriculum_id = ?

        LIMIT 1
        `,
        [curriculumId],
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Curriculum not found.",
        });
      }

      selectedCurriculum = rows[0];

      if (courseId && Number(selectedCurriculum.course_id) !== courseId) {
        return res.status(409).json({
          success: false,
          message:
            "Selected curriculum does not belong to the selected course.",
        });
      }

      if (Number(selectedCurriculum.is_active) !== 1) {
        return res.status(409).json({
          success: false,
          message: "Selected curriculum is not active.",
        });
      }
    }

    // =================================================
    // SELECTED SECTION VALIDATION
    // =================================================

    let selectedSection = null;

    if (sectionId) {
      const [rows] = await db.execute(
        `
        SELECT
            s.section_id,
            s.course_id,
            s.academic_year_id,
            s.year_level,
            s.section_name,
            s.max_students,

            c.course_code,
            c.course_name

        FROM sections s

        INNER JOIN courses c
            ON c.course_id =
               s.course_id

        WHERE s.section_id = ?

        LIMIT 1
        `,
        [sectionId],
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Section not found.",
        });
      }

      selectedSection = rows[0];

      if (
        academicYearId &&
        Number(selectedSection.academic_year_id) !== academicYearId
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Selected section does not belong to the selected academic year.",
        });
      }

      if (courseId && Number(selectedSection.course_id) !== courseId) {
        return res.status(409).json({
          success: false,
          message: "Selected section does not belong to the selected course.",
        });
      }

      if (yearLevel && Number(selectedSection.year_level) !== yearLevel) {
        return res.status(409).json({
          success: false,
          message:
            "Selected section does not belong to the selected year level.",
        });
      }
    }

    // =================================================
    // CURRICULUM SUBJECTS
    //
    // These are the recommended subjects that can
    // become section_subjects.
    //
    // Requires:
    //
    // curriculum
    // year level
    // semester
    // =================================================

    let curriculumSubjects = [];

    if (curriculumId && yearLevel && semesterId) {
      const [rows] = await db.execute(
        `
        SELECT
            cs.curriculum_subject_id,
            cs.curriculum_id,
            cs.subject_id,
            cs.year_level,
            cs.semester_id,
            cs.is_required,
            cs.display_order,

            s.subject_code,
            s.subject_name,
            s.units,
            s.lecture_hours,
            s.laboratory_hours

        FROM curriculum_subjects cs

        INNER JOIN subjects s
            ON s.subject_id =
               cs.subject_id

        WHERE cs.curriculum_id = ?
          AND cs.year_level = ?
          AND cs.semester_id = ?

        ORDER BY
            cs.display_order ASC,
            s.subject_code ASC
        `,
        [curriculumId, yearLevel, semesterId],
      );

      curriculumSubjects = rows.map((row) => ({
        ...row,

        curriculum_subject_id: Number(row.curriculum_subject_id),

        curriculum_id: Number(row.curriculum_id),

        subject_id: Number(row.subject_id),

        year_level: Number(row.year_level),

        semester_id: Number(row.semester_id),

        units: Number(row.units || 0),

        is_required: Number(row.is_required) === 1,
      }));
    }
    // =================================================
    // TEACHING USERS
    //
    // Both Faculty and Program Head can be assigned
    // to teach a subject offering.
    //
    // Only return:
    // - Faculty / Program Head roles
    // - active accounts
    // - verified accounts
    // - users belonging to the selected course department
    // =================================================

    let faculty = [];

    if (courseId) {
      const [rows] = await db.execute(
        `
      SELECT
          f.faculty_id,
          f.user_id,
          f.employee_number,
          f.first_name,
          f.middle_name,
          f.last_name,

          CONCAT_WS(
            ' ',
            f.first_name,
            NULLIF(f.middle_name, ''),
            f.last_name
          ) AS faculty_name,

          f.email,
          f.department_id,
          f.employment_status,

          d.department_name,

          u.username,
          u.is_active,
          u.is_verified,

          r.role_id,
          r.role_name

      FROM faculty f

      INNER JOIN users u
          ON u.user_id = f.user_id

      INNER JOIN roles r
          ON r.role_id = u.role_id

      INNER JOIN courses c
          ON c.department_id = f.department_id

      LEFT JOIN departments d
          ON d.department_id = f.department_id

      WHERE c.course_id = ?

        AND u.is_active = 1

        AND u.is_verified = 1

        AND r.role_name IN (
          'Faculty',
          'Program Head'
        )

      ORDER BY
          CASE
            WHEN r.role_name = 'Program Head'
            THEN 0
            ELSE 1
          END,

          f.last_name ASC,
          f.first_name ASC
    `,
        [courseId],
      );

      faculty = rows.map((row) => ({
        faculty_id: Number(row.faculty_id),

        user_id: Number(row.user_id),

        employee_number: row.employee_number,

        faculty_name: row.faculty_name,

        first_name: row.first_name,

        middle_name: row.middle_name,

        last_name: row.last_name,

        email: row.email,

        department_id: Number(row.department_id),

        department_name: row.department_name,

        employment_status: row.employment_status,

        username: row.username,

        role_id: Number(row.role_id),

        role_name: row.role_name,

        is_active: Number(row.is_active) === 1,

        is_verified: Number(row.is_verified) === 1,
      }));
    }
    // =================================================
    // ROOMS
    // =================================================

    const [rooms] = await db.execute(
      `
      SELECT
          r.room_id,
          r.building_id,
          r.room_code,
          r.room_name,
          r.capacity,

          b.building_name

      FROM rooms r

      LEFT JOIN buildings b
          ON b.building_id =
             r.building_id

      ORDER BY
          b.building_name ASC,
          r.room_code ASC,
          r.room_name ASC
      `,
    );

    // =================================================
    // EXISTING SECTION SUBJECTS
    //
    // Requires:
    //
    // selected section
    // AY
    // semester
    // =================================================

    let sectionSubjects = [];

    if (sectionId && academicYearId && semesterId) {
      const [rows] = await db.execute(
        `
        SELECT
            ss.section_subject_id,

            ss.section_id,
            sec.section_name,

            ss.subject_id,
            sub.subject_code,
            sub.subject_name,
            sub.units,

            ss.academic_year_id,
            ay.academic_year,

            ss.semester_id,
            sem.semester_name,

            ss.max_students,
            ss.status,

            ss.created_at,
            ss.updated_at,

            CASE
              WHEN so.offering_id IS NULL
              THEN 0
              ELSE 1
            END AS has_offering,

            so.offering_id,
            so.status AS offering_status

        FROM section_subjects ss

        INNER JOIN sections sec
            ON sec.section_id =
               ss.section_id

        INNER JOIN subjects sub
            ON sub.subject_id =
               ss.subject_id

        INNER JOIN academic_years ay
            ON ay.academic_year_id =
               ss.academic_year_id

        INNER JOIN semesters sem
            ON sem.semester_id =
               ss.semester_id

        LEFT JOIN subject_offerings so
            ON so.section_subject_id =
               ss.section_subject_id

        WHERE ss.section_id = ?
          AND ss.academic_year_id = ?
          AND ss.semester_id = ?

        ORDER BY
            sub.subject_code ASC
        `,
        [sectionId, academicYearId, semesterId],
      );

      sectionSubjects = rows.map((row) => ({
        ...row,

        section_subject_id: Number(row.section_subject_id),

        section_id: Number(row.section_id),

        subject_id: Number(row.subject_id),

        max_students:
          row.max_students !== null ? Number(row.max_students) : null,

        has_offering: Number(row.has_offering) === 1,

        offering_id: row.offering_id !== null ? Number(row.offering_id) : null,
      }));
    }

    // =================================================
    // EXISTING OFFERINGS
    // =================================================

    let offerings = [];

    if (academicYearId && semesterId) {
      const conditions = ["so.academic_year_id = ?", "so.semester_id = ?"];

      const params = [academicYearId, semesterId];

      if (sectionId) {
        conditions.push("so.section_id = ?");

        params.push(sectionId);
      }

      const [rows] = await db.execute(
        `
        SELECT
            so.offering_id,

            so.section_subject_id,

            so.subject_id,
            sub.subject_code,
            sub.subject_name,
            sub.units,

            so.section_id,
            sec.section_name,

            so.faculty_id,

            CONCAT_WS(
              ' ',
              f.first_name,
              NULLIF(f.middle_name, ''),
              f.last_name
            ) AS faculty_name,

            so.room_id,
            r.room_code,
            r.room_name,

            so.academic_year_id,
            ay.academic_year,

            so.semester_id,
            sem.semester_name,

            so.schedule_days,
            so.schedule_time,

            so.max_students,

            so.status,

            ss.status
                AS section_subject_status,

            (
              SELECT COUNT(*)

              FROM enrollment_subjects es_count

              INNER JOIN enrollments e_count
                  ON e_count.enrollment_id =
                     es_count.enrollment_id

              WHERE es_count.offering_id =
                    so.offering_id

                AND es_count.status =
                    'Enrolled'

                AND e_count.enrollment_status
                    IN (
                      'Pending',
                      'Approved'
                    )
            ) AS enrolled_count

        FROM subject_offerings so

        INNER JOIN section_subjects ss
            ON ss.section_subject_id =
               so.section_subject_id

        INNER JOIN subjects sub
            ON sub.subject_id =
               so.subject_id

        INNER JOIN sections sec
            ON sec.section_id =
               so.section_id

        INNER JOIN academic_years ay
            ON ay.academic_year_id =
               so.academic_year_id

        INNER JOIN semesters sem
            ON sem.semester_id =
               so.semester_id

        LEFT JOIN faculty f
            ON f.faculty_id =
               so.faculty_id

        LEFT JOIN rooms r
            ON r.room_id =
               so.room_id

        WHERE ${conditions.join(" AND ")}

        ORDER BY
            sec.section_name ASC,
            sub.subject_code ASC
        `,
        params,
      );

      offerings = rows.map((row) => {
        const maxStudents = Number(row.max_students || 0);

        const enrolledCount = Number(row.enrolled_count || 0);

        return {
          ...row,

          offering_id: Number(row.offering_id),

          section_subject_id: Number(row.section_subject_id),

          subject_id: Number(row.subject_id),

          section_id: Number(row.section_id),

          faculty_id: row.faculty_id !== null ? Number(row.faculty_id) : null,

          room_id: row.room_id !== null ? Number(row.room_id) : null,

          max_students: maxStudents,

          enrolled_count: enrolledCount,

          available_slots:
            maxStudents > 0 ? Math.max(0, maxStudents - enrolledCount) : null,
        };
      });
    }

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      filters: {
        academic_year_id: academicYearId,

        semester_id: semesterId,

        course_id: courseId,

        year_level: yearLevel,

        curriculum_id: curriculumId,

        section_id: sectionId,
      },

      selected: {
        curriculum: selectedCurriculum,

        section: selectedSection,
      },

      academic_years: academicYears,

      semesters,

      courses,

      curricula,

      sections,

      curriculum_subjects: curriculumSubjects,

      faculty,

      rooms,

      section_subjects: sectionSubjects,

      offerings,

      summary: {
        curriculum_subjects: curriculumSubjects.length,

        section_subjects: sectionSubjects.length,

        offerings: offerings.length,
      },

      actor,
    });
  } catch (error) {
    console.error("GET REGISTRAR OFFERING SETUP DATA ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load Registrar subject offering setup data.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// =====================================================
// CREATE SECTION SUBJECTS
//
// POST /api/registrar/offerings/section-subjects
//
// NORMAL CURRICULUM MODE:
//
// {
//   "mode": "curriculum",
//   "section_id": 2,
//   "academic_year_id": 2,
//   "semester_id": 2,
//   "curriculum_id": 6,
//   "subject_ids": [37,38,39,40,41,42,43,44,45,46],
//   "max_students": 50
// }
//
// SPECIAL MODE:
//
// {
//   "mode": "special",
//   "section_id": 2,
//   "academic_year_id": 2,
//   "semester_id": 2,
//   "subject_ids": [27],
//   "max_students": 50,
//   "reason": "CC104 opened during Second Semester for valid retake students."
// }
//
// IMPORTANT:
//
// curriculum mode:
//   Subject must belong to:
//   - selected curriculum
//   - section year level
//   - selected semester
//
// special mode:
//   Used for legitimate exceptions such as retakes.
//   Requires a reason.
//
// This route does NOT create subject_offerings yet.
// It only creates:
//
// section
//   +
// subject
//   +
// AY
//   +
// semester
//
// = section_subject
// =====================================================

router.post("/section-subjects", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  // ===================================================
  // REQUEST DATA
  // ===================================================

  const mode =
    typeof req.body?.mode === "string"
      ? req.body.mode.trim().toLowerCase()
      : "curriculum";

  const sectionId = toPositiveInt(req.body?.section_id);

  const academicYearId = toPositiveInt(req.body?.academic_year_id);

  const semesterId = toPositiveInt(req.body?.semester_id);

  const curriculumId =
    req.body?.curriculum_id === undefined || req.body?.curriculum_id === null
      ? null
      : toPositiveInt(req.body.curriculum_id);

  const rawSubjectIds = req.body?.subject_ids;

  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

  // ===================================================
  // VALIDATE BASIC IDS
  // ===================================================

  if (!sectionId) {
    return res.status(400).json({
      success: false,
      message: "A valid section_id is required.",
    });
  }

  if (!academicYearId) {
    return res.status(400).json({
      success: false,
      message: "A valid academic_year_id is required.",
    });
  }

  if (!semesterId) {
    return res.status(400).json({
      success: false,
      message: "A valid semester_id is required.",
    });
  }

  // ===================================================
  // VALIDATE MODE
  // ===================================================

  if (!["curriculum", "special"].includes(mode)) {
    return res.status(400).json({
      success: false,
      message: "Invalid section-subject creation mode.",
      allowed_modes: ["curriculum", "special"],
    });
  }

  if (mode === "curriculum" && !curriculumId) {
    return res.status(400).json({
      success: false,
      message: "curriculum_id is required in curriculum mode.",
    });
  }

  if (mode === "special" && !reason) {
    return res.status(400).json({
      success: false,
      message: "A reason is required when creating a special section subject.",
    });
  }

  // ===================================================
  // VALIDATE SUBJECT IDS
  // ===================================================

  if (!Array.isArray(rawSubjectIds) || rawSubjectIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: "subject_ids must be a non-empty array.",
    });
  }

  if (rawSubjectIds.length > 100) {
    return res.status(400).json({
      success: false,
      message: "Too many subjects were supplied.",
    });
  }

  const convertedSubjectIds = rawSubjectIds.map((value) =>
    toPositiveInt(value),
  );

  if (convertedSubjectIds.some((value) => !value)) {
    return res.status(400).json({
      success: false,
      message: "Every subject_id must be a positive integer.",
    });
  }

  // Remove duplicates from request.
  const subjectIds = [...new Set(convertedSubjectIds)];

  // ===================================================
  // MAX STUDENTS
  // ===================================================

  let requestedMaxStudents = null;

  if (
    req.body?.max_students !== undefined &&
    req.body?.max_students !== null &&
    req.body?.max_students !== ""
  ) {
    requestedMaxStudents = toPositiveInt(req.body.max_students);

    if (!requestedMaxStudents) {
      return res.status(400).json({
        success: false,
        message: "max_students must be a positive integer.",
      });
    }
  }

  let connection;

  try {
    // =================================================
    // TRANSACTION
    // =================================================

    connection = await db.getConnection();

    await connection.beginTransaction();

    // =================================================
    // VALIDATE ACADEMIC YEAR
    // =================================================

    const [academicYearRows] = await connection.execute(
      `
        SELECT
            academic_year_id,
            academic_year

        FROM academic_years

        WHERE academic_year_id = ?

        LIMIT 1
        `,
      [academicYearId],
    );

    if (academicYearRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Academic year not found.",
      });
    }

    const academicYear = academicYearRows[0];

    // =================================================
    // VALIDATE SEMESTER
    // =================================================

    const [semesterRows] = await connection.execute(
      `
        SELECT
            semester_id,
            semester_name

        FROM semesters

        WHERE semester_id = ?

        LIMIT 1
        `,
      [semesterId],
    );

    if (semesterRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Semester not found.",
      });
    }

    const semester = semesterRows[0];

    // =================================================
    // GET SECTION
    // =================================================

    const [sectionRows] = await connection.execute(
      `
        SELECT
            sec.section_id,
            sec.course_id,
            sec.academic_year_id,
            sec.year_level,
            sec.section_name,
            sec.max_students,

            c.course_code,
            c.course_name

        FROM sections sec

        INNER JOIN courses c
            ON c.course_id =
               sec.course_id

        WHERE sec.section_id = ?

        LIMIT 1

        FOR UPDATE
        `,
      [sectionId],
    );

    if (sectionRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Section not found.",
      });
    }

    const section = sectionRows[0];

    // =================================================
    // SECTION MUST BELONG TO AY
    // =================================================

    if (Number(section.academic_year_id) !== academicYearId) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "Selected section does not belong to the selected academic year.",
      });
    }

    // =================================================
    // DETERMINE CAPACITY
    // =================================================

    const defaultSectionCapacity = Number(section.max_students || 0);

    const maxStudents =
      requestedMaxStudents ||
      (defaultSectionCapacity > 0 ? defaultSectionCapacity : null);

    // =================================================
    // RESOLVE SUBJECTS
    // =================================================

    let validSubjectRows = [];

    // =================================================
    // CURRICULUM MODE
    // =================================================

    if (mode === "curriculum") {
      const [curriculumRows] = await connection.execute(
        `
          SELECT
              curriculum_id,
              course_id,
              curriculum_name,
              effective_year,
              is_active

          FROM curriculum

          WHERE curriculum_id = ?

          LIMIT 1
          `,
        [curriculumId],
      );

      if (curriculumRows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message: "Curriculum not found.",
        });
      }

      const curriculum = curriculumRows[0];

      if (Number(curriculum.course_id) !== Number(section.course_id)) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "Selected curriculum does not belong to the section course.",
        });
      }

      if (Number(curriculum.is_active) !== 1) {
        await connection.rollback();

        return res.status(409).json({
          success: false,
          message: "Selected curriculum is not active.",
        });
      }

      const placeholders = subjectIds.map(() => "?").join(",");

      const [rows] = await connection.execute(
        `
          SELECT
              cs.curriculum_subject_id,
              cs.curriculum_id,
              cs.subject_id,
              cs.year_level,
              cs.semester_id,
              cs.is_required,
              cs.display_order,

              s.subject_code,
              s.subject_name,
              s.units

          FROM curriculum_subjects cs

          INNER JOIN subjects s
              ON s.subject_id =
                 cs.subject_id

          WHERE cs.curriculum_id = ?

            AND cs.year_level = ?

            AND cs.semester_id = ?

            AND cs.subject_id
                IN (${placeholders})

          ORDER BY
              cs.display_order ASC,
              s.subject_code ASC
          `,
        [curriculumId, Number(section.year_level), semesterId, ...subjectIds],
      );

      validSubjectRows = rows;

      const validSubjectIds = new Set(
        rows.map((row) => Number(row.subject_id)),
      );

      const invalidSubjectIds = subjectIds.filter(
        (subjectId) => !validSubjectIds.has(subjectId),
      );

      if (invalidSubjectIds.length > 0) {
        await connection.rollback();

        return res.status(409).json({
          success: false,

          message:
            "One or more subjects do not belong to the selected curriculum, section year level, and semester.",

          invalid_subject_ids: invalidSubjectIds,

          expected: {
            curriculum_id: curriculumId,

            year_level: Number(section.year_level),

            semester_id: semesterId,
          },
        });
      }
    }

    // =================================================
    // SPECIAL MODE
    //
    // Used for legitimate exceptions:
    // - retakes
    // - irregular schedules
    // - approved special classes
    //
    // The reason is preserved in audit.
    // =================================================
    else {
      const placeholders = subjectIds.map(() => "?").join(",");

      const [rows] = await connection.execute(
        `
          SELECT
              subject_id,
              subject_code,
              subject_name,
              units

          FROM subjects

          WHERE subject_id
                IN (${placeholders})

          ORDER BY subject_code ASC
          `,
        subjectIds,
      );

      const foundSubjectIds = new Set(
        rows.map((row) => Number(row.subject_id)),
      );

      const missingSubjectIds = subjectIds.filter(
        (subjectId) => !foundSubjectIds.has(subjectId),
      );

      if (missingSubjectIds.length > 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,

          message: "One or more special subjects were not found.",

          missing_subject_ids: missingSubjectIds,
        });
      }

      validSubjectRows = rows;
    }

    // =================================================
    // CHECK EXISTING SECTION SUBJECTS
    // =================================================

    const placeholders = subjectIds.map(() => "?").join(",");

    const [existingRows] = await connection.execute(
      `
        SELECT
            ss.section_subject_id,
            ss.section_id,
            ss.subject_id,
            ss.academic_year_id,
            ss.semester_id,
            ss.max_students,
            ss.status,

            s.subject_code,
            s.subject_name

        FROM section_subjects ss

        INNER JOIN subjects s
            ON s.subject_id =
               ss.subject_id

        WHERE ss.section_id = ?

          AND ss.academic_year_id = ?

          AND ss.semester_id = ?

          AND ss.subject_id
              IN (${placeholders})

        FOR UPDATE
        `,
      [sectionId, academicYearId, semesterId, ...subjectIds],
    );

    const existingSubjectIds = new Set(
      existingRows.map((row) => Number(row.subject_id)),
    );

    const subjectsToCreate = validSubjectRows.filter(
      (row) => !existingSubjectIds.has(Number(row.subject_id)),
    );

    // =================================================
    // INSERT MISSING SECTION SUBJECTS
    // =================================================

    const created = [];

    for (const subject of subjectsToCreate) {
      const [insertResult] = await connection.execute(
        `
          INSERT INTO section_subjects (
              section_id,
              subject_id,
              academic_year_id,
              semester_id,
              max_students,
              status
          )

          VALUES (
              ?,
              ?,
              ?,
              ?,
              ?,
              'Open'
          )
          `,
        [
          sectionId,

          Number(subject.subject_id),

          academicYearId,

          semesterId,

          maxStudents,
        ],
      );

      const sectionSubjectId = Number(insertResult.insertId);

      // ===============================================
      // AUDIT
      // ===============================================

      await connection.execute(
        `
        INSERT INTO audit_trail (
            user_id,
            table_name,
            record_id,
            action,
            old_values,
            new_values
        )

        VALUES (
            ?,
            'section_subjects',
            ?,
            'INSERT',
            NULL,
            ?
        )
        `,
        [
          actor.user_id,

          sectionSubjectId,

          JSON.stringify({
            section_subject_id: sectionSubjectId,

            section_id: sectionId,

            subject_id: Number(subject.subject_id),

            academic_year_id: academicYearId,

            semester_id: semesterId,

            max_students: maxStudents,

            status: "Open",

            creation_mode: mode,

            curriculum_id: mode === "curriculum" ? curriculumId : null,

            reason: mode === "special" ? reason : null,
          }),
        ],
      );

      created.push({
        section_subject_id: sectionSubjectId,

        section_id: sectionId,

        section_name: section.section_name,

        subject_id: Number(subject.subject_id),

        subject_code: subject.subject_code,

        subject_name: subject.subject_name,

        academic_year_id: academicYearId,

        academic_year: academicYear.academic_year,

        semester_id: semesterId,

        semester_name: semester.semester_name,

        max_students: maxStudents,

        status: "Open",

        mode,
      });
    }

    // =================================================
    // FORMAT ALREADY EXISTING ROWS
    // =================================================

    const skipped = existingRows.map((row) => ({
      section_subject_id: Number(row.section_subject_id),

      section_id: Number(row.section_id),

      section_name: section.section_name,

      subject_id: Number(row.subject_id),

      subject_code: row.subject_code,

      subject_name: row.subject_name,

      academic_year_id: Number(row.academic_year_id),

      semester_id: Number(row.semester_id),

      max_students: row.max_students !== null ? Number(row.max_students) : null,

      status: row.status,

      reason: "Section subject already exists.",
    }));

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(created.length > 0 ? 201 : 200).json({
      success: true,

      message:
        created.length > 0
          ? `${created.length} section subject(s) created successfully.`
          : "All requested section subjects already exist.",

      mode,

      section: {
        section_id: Number(section.section_id),

        section_name: section.section_name,

        course_id: Number(section.course_id),

        course_code: section.course_code,

        course_name: section.course_name,

        year_level: Number(section.year_level),

        max_students: Number(section.max_students || 0),
      },

      academic_period: {
        academic_year_id: academicYearId,

        academic_year: academicYear.academic_year,

        semester_id: semesterId,

        semester_name: semester.semester_name,
      },

      curriculum:
        mode === "curriculum"
          ? {
              curriculum_id: curriculumId,
            }
          : null,

      special_reason: mode === "special" ? reason : null,

      summary: {
        requested: subjectIds.length,

        created: created.length,

        already_existing: skipped.length,

        max_students: maxStudents,
      },

      created,

      skipped,

      actor,
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("CREATE SECTION SUBJECTS ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("CREATE SECTION SUBJECTS ERROR:", error);

    // Duplicate protection at DB level remains authoritative.
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message:
          "One or more section subjects already exist for this section and academic period.",
      });
    }

    return res.status(500).json({
      success: false,

      message: "Failed to create section subjects.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// GET SECTION SUBJECTS
//
// GET /api/registrar/offerings/section-subjects
//
// Optional filters:
//
// ?academic_year_id=2
// &semester_id=2
// &course_id=1
// &year_level=2
// &section_id=2
// &subject_id=37
// &status=Open
//
// PURPOSE:
//
// - List subjects attached to sections
// - Show whether an offering already exists
// - Show current capacity/status
// - Show offering assignment when available
// - Used by Registrar Subject Offering Management
// =====================================================

router.get("/section-subjects", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  try {
    // =================================================
    // OPTIONAL FILTERS
    // =================================================

    const academicYearId =
      req.query.academic_year_id === undefined
        ? null
        : toPositiveInt(req.query.academic_year_id);

    const semesterId =
      req.query.semester_id === undefined
        ? null
        : toPositiveInt(req.query.semester_id);

    const courseId =
      req.query.course_id === undefined
        ? null
        : toPositiveInt(req.query.course_id);

    const yearLevel =
      req.query.year_level === undefined
        ? null
        : toPositiveInt(req.query.year_level);

    const sectionId =
      req.query.section_id === undefined
        ? null
        : toPositiveInt(req.query.section_id);

    const subjectId =
      req.query.subject_id === undefined
        ? null
        : toPositiveInt(req.query.subject_id);

    const status =
      typeof req.query.status === "string" ? req.query.status.trim() : null;

    // =================================================
    // VALIDATE FILTERS
    // =================================================

    if (req.query.academic_year_id !== undefined && !academicYearId) {
      return res.status(400).json({
        success: false,
        message: "Invalid academic_year_id.",
      });
    }

    if (req.query.semester_id !== undefined && !semesterId) {
      return res.status(400).json({
        success: false,
        message: "Invalid semester_id.",
      });
    }

    if (req.query.course_id !== undefined && !courseId) {
      return res.status(400).json({
        success: false,
        message: "Invalid course_id.",
      });
    }

    if (req.query.year_level !== undefined && !yearLevel) {
      return res.status(400).json({
        success: false,
        message: "Invalid year_level.",
      });
    }

    if (req.query.section_id !== undefined && !sectionId) {
      return res.status(400).json({
        success: false,
        message: "Invalid section_id.",
      });
    }

    if (req.query.subject_id !== undefined && !subjectId) {
      return res.status(400).json({
        success: false,
        message: "Invalid subject_id.",
      });
    }

    const allowedStatuses = ["Open", "Closed", "Cancelled"];

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid section subject status.",
        allowed_statuses: allowedStatuses,
      });
    }

    // =================================================
    // BUILD CONDITIONS
    // =================================================

    const conditions = [];
    const params = [];

    if (academicYearId) {
      conditions.push("ss.academic_year_id = ?");

      params.push(academicYearId);
    }

    if (semesterId) {
      conditions.push("ss.semester_id = ?");

      params.push(semesterId);
    }

    if (courseId) {
      conditions.push("sec.course_id = ?");

      params.push(courseId);
    }

    if (yearLevel) {
      conditions.push("sec.year_level = ?");

      params.push(yearLevel);
    }

    if (sectionId) {
      conditions.push("ss.section_id = ?");

      params.push(sectionId);
    }

    if (subjectId) {
      conditions.push("ss.subject_id = ?");

      params.push(subjectId);
    }

    if (status) {
      conditions.push("ss.status = ?");

      params.push(status);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // =================================================
    // LOAD SECTION SUBJECTS
    // =================================================

    const [rows] = await db.execute(
      `
      SELECT
          ss.section_subject_id,

          ss.section_id,
          sec.section_name,
          sec.course_id,
          sec.year_level,
          sec.max_students
              AS section_max_students,

          c.course_code,
          c.course_name,

          ss.subject_id,
          sub.subject_code,
          sub.subject_name,
          sub.units,
          sub.lecture_hours,
          sub.laboratory_hours,

          ss.academic_year_id,
          ay.academic_year,

          ss.semester_id,
          sem.semester_name,

          ss.max_students,
          ss.status,

          ss.created_at,
          ss.updated_at,

          so.offering_id,

          so.faculty_id,

          CONCAT_WS(
            ' ',
            f.first_name,
            NULLIF(f.middle_name, ''),
            f.last_name
          ) AS faculty_name,

          so.room_id,
          r.room_code,
          r.room_name,

          so.schedule_days,
          so.schedule_time,

          so.max_students
              AS offering_max_students,

          so.status
              AS offering_status,

          (
            SELECT COUNT(*)

            FROM enrollment_subjects es_count

            INNER JOIN enrollments e_count
                ON e_count.enrollment_id =
                   es_count.enrollment_id

            WHERE es_count.offering_id =
                  so.offering_id

              AND es_count.status =
                  'Enrolled'

              AND e_count.enrollment_status
                  IN (
                    'Pending',
                    'Approved'
                  )
          ) AS enrolled_count

      FROM section_subjects ss

      INNER JOIN sections sec
          ON sec.section_id =
             ss.section_id

      INNER JOIN courses c
          ON c.course_id =
             sec.course_id

      INNER JOIN subjects sub
          ON sub.subject_id =
             ss.subject_id

      INNER JOIN academic_years ay
          ON ay.academic_year_id =
             ss.academic_year_id

      INNER JOIN semesters sem
          ON sem.semester_id =
             ss.semester_id

      LEFT JOIN subject_offerings so
          ON so.section_subject_id =
             ss.section_subject_id

      LEFT JOIN faculty f
          ON f.faculty_id =
             so.faculty_id

      LEFT JOIN rooms r
          ON r.room_id =
             so.room_id

      ${whereClause}

      ORDER BY
          ay.academic_year_id DESC,
          sem.semester_id ASC,
          c.course_code ASC,
          sec.year_level ASC,
          sec.section_name ASC,
          sub.subject_code ASC
      `,
      params,
    );

    // =================================================
    // FORMAT
    // =================================================

    const sectionSubjects = rows.map((row) => {
      const sectionMaxStudents = Number(row.section_max_students || 0);

      const maxStudents =
        row.max_students !== null ? Number(row.max_students) : null;

      const offeringMaxStudents =
        row.offering_max_students !== null
          ? Number(row.offering_max_students)
          : null;

      const enrolledCount = Number(row.enrolled_count || 0);

      return {
        section_subject_id: Number(row.section_subject_id),

        section: {
          section_id: Number(row.section_id),

          section_name: row.section_name,

          course_id: Number(row.course_id),

          course_code: row.course_code,

          course_name: row.course_name,

          year_level: Number(row.year_level),

          max_students: sectionMaxStudents,
        },

        subject: {
          subject_id: Number(row.subject_id),

          subject_code: row.subject_code,

          subject_name: row.subject_name,

          units: Number(row.units || 0),

          lecture_hours: Number(row.lecture_hours || 0),

          laboratory_hours: Number(row.laboratory_hours || 0),
        },

        academic_period: {
          academic_year_id: Number(row.academic_year_id),

          academic_year: row.academic_year,

          semester_id: Number(row.semester_id),

          semester_name: row.semester_name,
        },

        max_students: maxStudents,

        status: row.status,

        created_at: row.created_at,

        updated_at: row.updated_at,

        has_offering: row.offering_id !== null,

        offering:
          row.offering_id !== null
            ? {
                offering_id: Number(row.offering_id),

                faculty_id:
                  row.faculty_id !== null ? Number(row.faculty_id) : null,

                faculty_name: row.faculty_name || null,

                room_id: row.room_id !== null ? Number(row.room_id) : null,

                room_code: row.room_code || null,

                room_name: row.room_name || null,

                schedule_days: row.schedule_days || null,

                schedule_time: row.schedule_time || null,

                max_students: offeringMaxStudents,

                enrolled_count: enrolledCount,

                available_slots:
                  offeringMaxStudents && offeringMaxStudents > 0
                    ? Math.max(0, offeringMaxStudents - enrolledCount)
                    : null,

                status: row.offering_status,
              }
            : null,
      };
    });

    // =================================================
    // SUMMARY
    // =================================================

    const withOffering = sectionSubjects.filter(
      (item) => item.has_offering,
    ).length;

    const withoutOffering = sectionSubjects.length - withOffering;

    const openCount = sectionSubjects.filter(
      (item) => item.status === "Open",
    ).length;

    const closedCount = sectionSubjects.filter(
      (item) => item.status === "Closed",
    ).length;

    const cancelledCount = sectionSubjects.filter(
      (item) => item.status === "Cancelled",
    ).length;

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      filters: {
        academic_year_id: academicYearId,

        semester_id: semesterId,

        course_id: courseId,

        year_level: yearLevel,

        section_id: sectionId,

        subject_id: subjectId,

        status: status || null,
      },

      count: sectionSubjects.length,

      summary: {
        total: sectionSubjects.length,

        open: openCount,

        closed: closedCount,

        cancelled: cancelledCount,

        with_offering: withOffering,

        without_offering: withoutOffering,
      },

      section_subjects: sectionSubjects,

      actor,
    });
  } catch (error) {
    console.error("GET SECTION SUBJECTS ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to load section subjects.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});
// =====================================================
// OFFERING SCHEDULE CONFLICT HELPERS
// =====================================================
//
// Conflict rules:
//
// 1. Same section + overlapping day/time = SECTION conflict
// 2. Same faculty + overlapping day/time = FACULTY conflict
//
// Room is NOT part of schedule conflict validation.
//
// Open and Closed offerings participate.
// Cancelled offerings are ignored.
//
// Adjacent schedules are allowed:
//
// 8:00 AM - 10:00 AM
// 10:00 AM - 12:00 PM
//
// These do NOT overlap.
// =====================================================

// =====================================================
// NORMALIZE SCHEDULE DAY
// =====================================================

function normalizeOfferingScheduleDay(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "");

  const dayMap = {
    monday: "Monday",
    mon: "Monday",

    tuesday: "Tuesday",
    tue: "Tuesday",
    tues: "Tuesday",

    wednesday: "Wednesday",
    wed: "Wednesday",

    thursday: "Thursday",
    thu: "Thursday",
    thur: "Thursday",
    thurs: "Thursday",

    friday: "Friday",
    fri: "Friday",

    saturday: "Saturday",
    sat: "Saturday",

    sunday: "Sunday",
    sun: "Sunday",
  };

  return dayMap[normalized] || null;
}

// =====================================================
// PARSE SCHEDULE DAYS
// =====================================================

function parseOfferingScheduleDays(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return [];
  }

  return String(value)
    .split(/[,/;&]+/)
    .map((day) => normalizeOfferingScheduleDay(day))
    .filter(Boolean);
}

// =====================================================
// PARSE CLOCK TIME
//
// Supports:
// 8am
// 8:00am
// 8:00 AM
// 10pm
// 13:00
// =====================================================

function parseOfferingClockTime(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim().toUpperCase().replace(/\s+/g, "");

  // ===============================================
  // 12-HOUR FORMAT
  // ===============================================

  const twelveHourMatch = text.match(/^(\d{1,2})(?::(\d{2}))?(AM|PM)$/);

  if (twelveHourMatch) {
    let hours = Number(twelveHourMatch[1]);

    const minutes = Number(twelveHourMatch[2] || 0);

    const period = twelveHourMatch[3];

    if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) {
      return null;
    }

    if (period === "AM") {
      if (hours === 12) {
        hours = 0;
      }
    } else if (period === "PM" && hours !== 12) {
      hours += 12;
    }

    return hours * 60 + minutes;
  }

  // ===============================================
  // 24-HOUR FORMAT
  // ===============================================

  const twentyFourHourMatch = text.match(/^(\d{1,2}):(\d{2})$/);

  if (twentyFourHourMatch) {
    const hours = Number(twentyFourHourMatch[1]);

    const minutes = Number(twentyFourHourMatch[2]);

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return null;
    }

    return hours * 60 + minutes;
  }

  return null;
}

// =====================================================
// PARSE TIME RANGE
//
// Example:
//
// 8:00 AM - 10:00 AM
//
// Returns:
//
// {
//   start: 480,
//   end: 600
// }
// =====================================================

function parseOfferingScheduleTimeRange(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }

  const normalized = String(value).trim().replace(/[–—]/g, "-");

  const parts = normalized
    .split(/\s*-\s*/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (parts.length !== 2) {
    return null;
  }

  const start = parseOfferingClockTime(parts[0]);

  const end = parseOfferingClockTime(parts[1]);

  if (start === null || end === null) {
    return null;
  }

  // End must be later than start.
  if (end <= start) {
    return null;
  }

  return {
    start,
    end,
  };
}

// =====================================================
// CHECK COMMON DAY
// =====================================================

function offeringSchedulesShareDay(firstDays, secondDays) {
  const first = parseOfferingScheduleDays(firstDays);

  const second = parseOfferingScheduleDays(secondDays);

  if (first.length === 0 || second.length === 0) {
    return false;
  }

  const secondSet = new Set(second);

  return first.some((day) => secondSet.has(day));
}

// =====================================================
// CHECK TIME OVERLAP
//
// Correct overlap formula:
//
// firstStart < secondEnd
// AND
// secondStart < firstEnd
//
// Therefore:
//
// 8-10 and 10-12 = allowed
// 8-10 and 9-11  = conflict
// =====================================================

function offeringTimesOverlap(firstTime, secondTime) {
  const first = parseOfferingScheduleTimeRange(firstTime);

  const second = parseOfferingScheduleTimeRange(secondTime);

  if (!first || !second) {
    return false;
  }

  return first.start < second.end && second.start < first.end;
}

// =====================================================
// CHECK FULL SCHEDULE OVERLAP
// =====================================================

function offeringSchedulesOverlap(
  firstDays,
  firstTime,
  secondDays,
  secondTime,
) {
  return (
    offeringSchedulesShareDay(firstDays, secondDays) &&
    offeringTimesOverlap(firstTime, secondTime)
  );
}

// =====================================================
// FIND CREATE-OFFERING CONFLICTS
//
// New offering has no offering_id yet.
//
// Conflict dimensions:
//
// - SECTION
// - FACULTY
//
// Room is intentionally NOT checked.
//
// Open / Closed offerings participate.
// Cancelled offerings do not.
// =====================================================

async function findCreateOfferingScheduleConflicts(
  connection,
  {
    academicYearId,
    semesterId,
    sectionId,
    facultyId,
    scheduleDays,
    scheduleTime,
  },
) {
  // ===================================================
  // NO COMPLETE SCHEDULE = NOTHING TO CHECK
  // ===================================================

  if (!scheduleDays || !scheduleTime) {
    return [];
  }

  // ===================================================
  // LOAD EXISTING PLANNED OFFERINGS
  // ===================================================

  const [rows] = await connection.execute(
    `
        SELECT
            so.offering_id,

            so.section_subject_id,

            so.subject_id,

            sub.subject_code,
            sub.subject_name,

            so.section_id,

            sec.section_name,

            so.faculty_id,

            CONCAT_WS(
              ' ',
              f.first_name,
              NULLIF(
                f.middle_name,
                ''
              ),
              f.last_name
            ) AS faculty_name,

            so.schedule_days,
            so.schedule_time,

            so.status

        FROM subject_offerings so

        INNER JOIN subjects sub
            ON sub.subject_id =
               so.subject_id

        INNER JOIN sections sec
            ON sec.section_id =
               so.section_id

        LEFT JOIN faculty f
            ON f.faculty_id =
               so.faculty_id

        WHERE so.academic_year_id = ?

          AND so.semester_id = ?

          AND so.status
              IN (
                'Open',
                'Closed'
              )

          AND so.schedule_days
              IS NOT NULL

          AND TRIM(
                so.schedule_days
              ) <> ''

          AND so.schedule_time
              IS NOT NULL

          AND TRIM(
                so.schedule_time
              ) <> ''

        ORDER BY
            so.offering_id ASC
      `,
    [academicYearId, semesterId],
  );

  const conflicts = [];

  // ===================================================
  // CHECK EACH EXISTING OFFERING
  // ===================================================

  for (const existing of rows) {
    // ===============================================
    // MUST OVERLAP DAY + TIME
    // ===============================================

    const overlaps = offeringSchedulesOverlap(
      scheduleDays,
      scheduleTime,

      existing.schedule_days,
      existing.schedule_time,
    );

    if (!overlaps) {
      continue;
    }

    // ===============================================
    // COMMON CONFLICT DATA
    // ===============================================

    const conflictOffering = {
      offering_id: Number(existing.offering_id),

      section_subject_id: Number(existing.section_subject_id),

      subject: {
        subject_id: Number(existing.subject_id),

        subject_code: existing.subject_code,

        subject_name: existing.subject_name,
      },

      section: {
        section_id: Number(existing.section_id),

        section_name: existing.section_name,
      },

      faculty:
        existing.faculty_id !== null
          ? {
              faculty_id: Number(existing.faculty_id),

              faculty_name: existing.faculty_name,
            }
          : null,

      schedule: {
        days: existing.schedule_days,

        time: existing.schedule_time,
      },

      status: existing.status,
    };

    // ===============================================
    // SECTION CONFLICT
    //
    // Students in the same section cannot have
    // two subjects at overlapping times.
    // ===============================================

    if (Number(existing.section_id) === Number(sectionId)) {
      conflicts.push({
        type: "SECTION",

        message: `${existing.section_name} already has ${existing.subject_code} scheduled at this time.`,

        conflicting_offering: conflictOffering,
      });
    }

    // ===============================================
    // FACULTY CONFLICT
    //
    // One faculty member cannot teach two
    // offerings at the same time.
    // ===============================================

    if (
      facultyId &&
      existing.faculty_id !== null &&
      Number(existing.faculty_id) === Number(facultyId)
    ) {
      conflicts.push({
        type: "FACULTY",

        message: `${
          existing.faculty_name || "The selected faculty"
        } is already assigned to another class at this time.`,

        conflicting_offering: conflictOffering,
      });
    }
  }

  return conflicts;
}

// =====================================================
// CREATE SUBJECT OFFERING
//
// POST /api/registrar/offerings/subject-offerings
//
// IMPORTANT:
//
// The backend determines the initial offering status.
//
// COMPLETE + VALID + NO CONFLICT
//     → Open
//     → ready_for_enrollment = true
//
// INCOMPLETE
//     → Closed
//     → ready_for_enrollment = false
//
// CONFLICT
//     → 409
//     → no record created
//
// Cancelled offerings are NOT created directly.
// Cancellation belongs to the status-management route.
//
// section_subject is authoritative for:
// - subject
// - section
// - academic year
// - semester
//
// Client does not separately supply those IDs.
// =====================================================
router.post("/subject-offerings", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  // Registrar only selects the section subject and assigns the teaching user.
  // Scheduling belongs to the assigned Faculty / Program Head.
  const sectionSubjectId = toPositiveInt(req.body?.section_subject_id);
  const facultyId = toPositiveInt(req.body?.faculty_id);

  if (!sectionSubjectId) {
    return res.status(400).json({
      success: false,
      message: "A valid section_subject_id is required.",
    });
  }

  if (!facultyId) {
    return res.status(400).json({
      success: false,
      message: "A valid faculty_id is required.",
    });
  }

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // =================================================
    // GET SECTION SUBJECT
    // =================================================

    const [sectionSubjectRows] = await connection.execute(
      `
        SELECT
            ss.section_subject_id,
            ss.section_id,
            ss.subject_id,
            ss.academic_year_id,
            ss.semester_id,
            ss.max_students,
            ss.status AS section_subject_status,

            sec.section_name,
            sec.course_id,
            sec.year_level,
            sec.max_students AS section_max_students,

            c.course_code,
            c.course_name,
            c.department_id,

            sub.subject_code,
            sub.subject_name,
            sub.units,

            ay.academic_year,
            sem.semester_name

        FROM section_subjects ss

        INNER JOIN sections sec
            ON sec.section_id = ss.section_id

        INNER JOIN courses c
            ON c.course_id = sec.course_id

        INNER JOIN subjects sub
            ON sub.subject_id = ss.subject_id

        INNER JOIN academic_years ay
            ON ay.academic_year_id = ss.academic_year_id

        INNER JOIN semesters sem
            ON sem.semester_id = ss.semester_id

        WHERE ss.section_subject_id = ?

        LIMIT 1
        FOR UPDATE
      `,
      [sectionSubjectId],
    );

    if (sectionSubjectRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Section subject not found.",
      });
    }

    const sectionSubject = sectionSubjectRows[0];

    // =================================================
    // CANCELLED SECTION SUBJECT
    // =================================================

    if (sectionSubject.section_subject_status === "Cancelled") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "Cannot create an offering for a cancelled section subject.",
      });
    }

    // =================================================
    // CHECK EXISTING OFFERING
    //
    // One normal offering per:
    // subject + section + AY + semester
    // =================================================

    const [existingRows] = await connection.execute(
      `
        SELECT
            offering_id,
            status

        FROM subject_offerings

        WHERE subject_id = ?
          AND section_id = ?
          AND academic_year_id = ?
          AND semester_id = ?

        LIMIT 1
        FOR UPDATE
      `,
      [
        Number(sectionSubject.subject_id),
        Number(sectionSubject.section_id),
        Number(sectionSubject.academic_year_id),
        Number(sectionSubject.semester_id),
      ],
    );

    if (existingRows.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "A subject offering already exists for this section subject.",
        existing_offering: {
          offering_id: Number(existingRows[0].offering_id),
          status: existingRows[0].status,
        },
      });
    }

    // =================================================
    // VALIDATE ASSIGNED INSTRUCTOR
    //
    // Faculty and Program Head both have faculty records.
    // faculty_id remains the teaching assignment.
    // =================================================

    const [facultyRows] = await connection.execute(
      `
        SELECT
            f.faculty_id,
            f.user_id,
            f.employee_number,
            f.first_name,
            f.middle_name,
            f.last_name,

            CONCAT_WS(
              ' ',
              f.first_name,
              NULLIF(f.middle_name, ''),
              f.last_name
            ) AS faculty_name,

            f.department_id,
            f.employment_status,

            u.username,
            u.is_verified,
            u.is_active,

            r.role_name

        FROM faculty f

        INNER JOIN users u
            ON u.user_id = f.user_id

        INNER JOIN roles r
            ON r.role_id = u.role_id

        WHERE f.faculty_id = ?

        LIMIT 1
      `,
      [facultyId],
    );

    if (facultyRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Faculty record not found.",
      });
    }

    const faculty = facultyRows[0];

    // =================================================
    // ROLE VALIDATION
    // =================================================

    if (!["Faculty", "Program Head"].includes(faculty.role_name)) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "The selected user is not a Faculty or Program Head account.",
      });
    }

    // =================================================
    // ACCOUNT STATUS VALIDATION
    // =================================================

    if (Number(faculty.is_active) !== 1) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "The selected teaching account is inactive.",
      });
    }

    if (Number(faculty.is_verified) !== 1) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "The selected teaching account is not verified.",
      });
    }

    // =================================================
    // DEPARTMENT VALIDATION
    //
    // Prevent Registrar from assigning an instructor
    // belonging to another department.
    // =================================================

    if (
      Number(faculty.department_id) !== Number(sectionSubject.department_id)
    ) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "The selected instructor does not belong to this course department.",
      });
    }

    // =================================================
    // DETERMINE CAPACITY
    //
    // Registrar no longer manually enters max_students.
    //
    // Priority:
    // 1. section_subject capacity
    // 2. section capacity
    // 3. fallback 50
    // =================================================

    const sectionSubjectCapacity = Number(sectionSubject.max_students || 0);

    const sectionCapacity = Number(sectionSubject.section_max_students || 0);
    const finalMaxStudents =
      sectionSubjectCapacity > 0
        ? sectionSubjectCapacity
        : sectionCapacity > 0
          ? sectionCapacity
          : 50;

    // =================================================
    // CREATE OFFERING
    //
    // Registrar only assigns the instructor.
    // Scheduling will be completed later by the
    // assigned Faculty / Program Head.
    // =================================================

    const [insertResult] = await connection.execute(
      `
        INSERT INTO subject_offerings (
            section_subject_id,
            subject_id,
            section_id,
            faculty_id,
            room_id,
            academic_year_id,
            semester_id,
            schedule_days,
            schedule_time,
            schedule_start_time,
            schedule_end_time,
            max_students,
            status
        )

        VALUES (
            ?,
            ?,
            ?,
            ?,
            NULL,
            ?,
            ?,
            NULL,
            NULL,
            NULL,
            NULL,
            ?,
            'Closed'
        )
      `,
      [
        sectionSubjectId,
        Number(sectionSubject.subject_id),
        Number(sectionSubject.section_id),
        facultyId,
        Number(sectionSubject.academic_year_id),
        Number(sectionSubject.semester_id),
        finalMaxStudents,
      ],
    );

    const offeringId = Number(insertResult.insertId);

    // =================================================
    // AUDIT TRAIL
    // =================================================

    await connection.execute(
      `
        INSERT INTO audit_trail (
            user_id,
            table_name,
            record_id,
            action,
            old_values,
            new_values
        )

        VALUES (
            ?,
            'subject_offerings',
            ?,
            'INSERT',
            NULL,
            ?
        )
      `,
      [
        actor.user_id,
        offeringId,

        JSON.stringify({
          offering_id: offeringId,

          section_subject_id: sectionSubjectId,

          subject_id: Number(sectionSubject.subject_id),

          section_id: Number(sectionSubject.section_id),

          faculty_id: facultyId,

          room_id: null,

          academic_year_id: Number(sectionSubject.academic_year_id),

          semester_id: Number(sectionSubject.semester_id),

          schedule_days: null,

          schedule_time: null,

          schedule_start_time: null,

          schedule_end_time: null,

          max_students: finalMaxStudents,

          status: "Closed",

          configuration_complete: false,

          ready_for_enrollment: false,
        }),
      ],
    );

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // SUCCESS RESPONSE
    // =================================================

    return res.status(201).json({
      success: true,

      message:
        "Instructor assigned successfully. The assigned Faculty or Program Head must set the class schedule before the offering can open.",

      offering: {
        offering_id: offeringId,

        section_subject_id: sectionSubjectId,

        // =============================================
        // SUBJECT
        // =============================================

        subject: {
          subject_id: Number(sectionSubject.subject_id),

          subject_code: sectionSubject.subject_code,

          subject_name: sectionSubject.subject_name,

          units: Number(sectionSubject.units || 0),
        },

        // =============================================
        // SECTION
        // =============================================

        section: {
          section_id: Number(sectionSubject.section_id),

          section_name: sectionSubject.section_name,

          course_id: Number(sectionSubject.course_id),

          course_code: sectionSubject.course_code,

          course_name: sectionSubject.course_name,

          year_level: Number(sectionSubject.year_level),
        },

        // =============================================
        // ACADEMIC PERIOD
        // =============================================

        academic_period: {
          academic_year_id: Number(sectionSubject.academic_year_id),

          academic_year: sectionSubject.academic_year,

          semester_id: Number(sectionSubject.semester_id),

          semester_name: sectionSubject.semester_name,
        },

        // =============================================
        // ASSIGNED TEACHING USER
        // =============================================

        faculty: {
          faculty_id: Number(faculty.faculty_id),

          user_id: Number(faculty.user_id),

          employee_number: faculty.employee_number,

          faculty_name: faculty.faculty_name,

          employment_status: faculty.employment_status,

          role_name: faculty.role_name,
        },

        // =============================================
        // SCHEDULE
        // =============================================

        room: null,

        schedule_days: null,

        schedule_time: null,

        schedule_start_time: null,

        schedule_end_time: null,

        // =============================================
        // CAPACITY
        // =============================================

        max_students: finalMaxStudents,

        enrolled_count: 0,

        available_slots: finalMaxStudents,

        // =============================================
        // STATUS
        // =============================================

        status: "Closed",

        configuration_complete: false,

        ready_for_enrollment: false,

        schedule_status: "Pending instructor schedule",
      },

      actor,
    });
  } catch (error) {
    // =================================================
    // ROLLBACK
    // =================================================

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("CREATE SUBJECT OFFERING ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("CREATE SUBJECT OFFERING ERROR:", error);

    // =================================================
    // DUPLICATE OFFERING
    // =================================================

    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,

        message:
          "A subject offering already exists for this subject, section, and academic period.",
      });
    }

    // =================================================
    // SERVER ERROR
    // =================================================

    return res.status(500).json({
      success: false,

      message: "Failed to create subject offering.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    // =================================================
    // RELEASE CONNECTION
    // =================================================

    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// REASSIGN SUBJECT OFFERING INSTRUCTOR
//
// PUT
// /api/registrar/offerings/subject-offerings/:id
//
// Registrar responsibility:
// - Assign / reassign Faculty or Program Head only.
//
// Registrar may NOT change:
// - schedule day
// - schedule time
// - start/end time
// - capacity
//
// When instructor changes:
// - existing schedule is cleared
// - offering becomes Closed
// - new instructor must submit a new schedule
//
// Grade safety:
// - offerings with existing grade records cannot
//   be reassigned.
// =====================================================

router.put("/subject-offerings/:id", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  const offeringId = toPositiveInt(req.params.id);

  const facultyId = toPositiveInt(req.body?.faculty_id);

  if (!offeringId) {
    return res.status(400).json({
      success: false,
      message: "Invalid subject offering ID.",
    });
  }

  if (!facultyId) {
    return res.status(400).json({
      success: false,
      message: "A valid faculty_id is required.",
    });
  }

  let connection;

  try {
    connection = await db.getConnection();

    await connection.beginTransaction();

    // =================================================
    // LOAD CURRENT OFFERING
    // =================================================

    const [currentRows] = await connection.execute(
      `
          SELECT
              so.offering_id,
              so.section_subject_id,
              so.subject_id,
              so.section_id,
              so.faculty_id,
              so.room_id,
              so.academic_year_id,
              so.semester_id,

              so.schedule_days,
              so.schedule_time,
              so.schedule_start_time,
              so.schedule_end_time,

              so.max_students,
              so.status,

              ss.status
                  AS section_subject_status,

              sub.subject_code,
              sub.subject_name,
              sub.units,

              sec.section_name,
              sec.year_level,
              sec.course_id,

              c.course_code,
              c.course_name,
              c.department_id,

              ay.academic_year,

              sem.semester_name,

              r.room_code,
              r.room_name

          FROM subject_offerings so

          INNER JOIN section_subjects ss
              ON ss.section_subject_id =
                 so.section_subject_id

          INNER JOIN subjects sub
              ON sub.subject_id =
                 so.subject_id

          INNER JOIN sections sec
              ON sec.section_id =
                 so.section_id

          INNER JOIN courses c
              ON c.course_id =
                 sec.course_id

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 so.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 so.semester_id

          LEFT JOIN rooms r
              ON r.room_id =
                 so.room_id

          WHERE so.offering_id = ?

          LIMIT 1

          FOR UPDATE
        `,
      [offeringId],
    );

    if (currentRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Subject offering not found.",
      });
    }

    const current = currentRows[0];

    // =================================================
    // CANCELLED OFFERING
    // =================================================

    if (current.status === "Cancelled") {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "A cancelled subject offering cannot be reassigned.",
      });
    }

    // =================================================
    // LOAD NEW TEACHING USER
    //
    // Program Head also has a faculty record,
    // therefore faculty_id remains authoritative.
    // =================================================

    const [facultyRows] = await connection.execute(
      `
          SELECT
              f.faculty_id,
              f.user_id,
              f.employee_number,
              f.first_name,
              f.middle_name,
              f.last_name,

              CONCAT_WS(
                ' ',
                f.first_name,
                NULLIF(
                  f.middle_name,
                  ''
                ),
                f.last_name
              ) AS faculty_name,

              f.department_id,

              f.employment_status,

              u.username,
              u.is_active,
              u.is_verified,

              roles.role_id,
              roles.role_name

          FROM faculty f

          INNER JOIN users u
              ON u.user_id =
                 f.user_id

          INNER JOIN roles
              ON roles.role_id =
                 u.role_id

          WHERE f.faculty_id = ?

          LIMIT 1
        `,
      [facultyId],
    );

    if (facultyRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Faculty record not found.",
      });
    }

    const faculty = facultyRows[0];

    // =================================================
    // ROLE VALIDATION
    // =================================================

    if (!["Faculty", "Program Head"].includes(faculty.role_name)) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message: "The selected user is not a Faculty or Program Head account.",
      });
    }

    // =================================================
    // ACCOUNT VALIDATION
    // =================================================

    if (Number(faculty.is_active) !== 1) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message: "The selected teaching account is inactive.",
      });
    }

    if (Number(faculty.is_verified) !== 1) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message: "The selected teaching account is not verified.",
      });
    }

    // =================================================
    // DEPARTMENT VALIDATION
    // =================================================

    if (Number(faculty.department_id) !== Number(current.department_id)) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message:
          "The selected instructor does not belong to this course department.",
      });
    }

    // =================================================
    // CURRENT INSTRUCTOR
    // =================================================

    const currentFacultyId =
      current.faculty_id !== null ? Number(current.faculty_id) : null;

    // =================================================
    // SAME INSTRUCTOR
    // =================================================

    if (currentFacultyId === facultyId) {
      await connection.rollback();

      return res.status(200).json({
        success: true,

        message: "This instructor is already assigned to the offering.",

        changed: false,

        changed_fields: [],

        offering: {
          offering_id: offeringId,

          faculty_id: currentFacultyId,

          status: current.status,
        },

        actor,
      });
    }

    // =================================================
    // GRADE SAFETY
    //
    // grades.faculty_id must match
    // subject_offerings.faculty_id.
    //
    // Therefore we do NOT allow Registrar to
    // reassign an offering once grade records exist.
    // =================================================

    const [gradeRows] = await connection.execute(
      `
          SELECT
              COUNT(*) AS grade_count

          FROM grades g

          INNER JOIN enrollment_subjects es
              ON es.enrollment_subject_id =
                 g.enrollment_subject_id

          WHERE es.offering_id = ?
        `,
      [offeringId],
    );

    const gradeCount = Number(gradeRows[0]?.grade_count || 0);

    if (gradeCount > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message:
          "This offering cannot be reassigned because grade records already exist.",

        grade_count: gradeCount,
      });
    }
    // =================================================
    // CAPTURE OLD VALUES FOR AUDIT
    // =================================================

    const oldValues = {
      offering_id: offeringId,

      faculty_id: currentFacultyId,

      room_id: current.room_id !== null ? Number(current.room_id) : null,

      schedule_days: current.schedule_days,

      schedule_time: current.schedule_time,

      schedule_start_time: current.schedule_start_time,

      schedule_end_time: current.schedule_end_time,

      max_students: Number(current.max_students || 0),

      status: current.status,
    };

    // =================================================
    // REASSIGN INSTRUCTOR
    //
    // IMPORTANT:
    //
    // The old instructor's schedule must NOT follow
    // the offering to the new instructor.
    //
    // Therefore:
    // - faculty_id changes
    // - room is cleared
    // - all schedule fields are cleared
    // - offering becomes Closed
    //
    // The new Faculty / Program Head must create
    // their own schedule.
    // =================================================

    await connection.execute(
      `
        UPDATE subject_offerings

        SET
            faculty_id = ?,

            room_id = NULL,

            schedule_days = NULL,

            schedule_time = NULL,

            schedule_start_time = NULL,

            schedule_end_time = NULL,

            status = 'Closed'

        WHERE offering_id = ?
      `,
      [facultyId, offeringId],
    );

    // =================================================
    // NEW VALUES FOR AUDIT
    // =================================================

    const newValues = {
      offering_id: offeringId,

      faculty_id: facultyId,

      room_id: null,

      schedule_days: null,

      schedule_time: null,

      schedule_start_time: null,

      schedule_end_time: null,

      max_students: Number(current.max_students || 0),

      status: "Closed",

      configuration_complete: false,

      ready_for_enrollment: false,

      schedule_status: "Pending instructor schedule",
    };

    // =================================================
    // AUDIT TRAIL
    // =================================================

    await connection.execute(
      `
        INSERT INTO audit_trail (
            user_id,
            table_name,
            record_id,
            action,
            old_values,
            new_values
        )

        VALUES (
            ?,
            'subject_offerings',
            ?,
            'UPDATE',
            ?,
            ?
        )
      `,
      [
        actor.user_id,

        offeringId,

        JSON.stringify(oldValues),

        JSON.stringify(newValues),
      ],
    );

    // =================================================
    // COMMIT
    // =================================================

    await connection.commit();

    // =================================================
    // SUCCESS RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      message:
        "Instructor reassigned successfully. The previous schedule was cleared, and the new instructor must set the class schedule before the offering can open.",

      changed: true,

      changed_fields: [
        "faculty_id",
        "room_id",
        "schedule_days",
        "schedule_time",
        "schedule_start_time",
        "schedule_end_time",
        "status",
      ],

      offering: {
        offering_id: offeringId,

        section_subject_id: Number(current.section_subject_id),

        // =============================================
        // SUBJECT
        // =============================================

        subject: {
          subject_id: Number(current.subject_id),

          subject_code: current.subject_code,

          subject_name: current.subject_name,

          units: Number(current.units || 0),
        },

        // =============================================
        // SECTION
        // =============================================

        section: {
          section_id: Number(current.section_id),

          section_name: current.section_name,

          course_id: Number(current.course_id),

          course_code: current.course_code,

          course_name: current.course_name,

          year_level: Number(current.year_level),
        },

        // =============================================
        // ACADEMIC PERIOD
        // =============================================

        academic_period: {
          academic_year_id: Number(current.academic_year_id),

          academic_year: current.academic_year,

          semester_id: Number(current.semester_id),

          semester_name: current.semester_name,
        },

        // =============================================
        // NEW ASSIGNED INSTRUCTOR
        // =============================================

        faculty: {
          faculty_id: Number(faculty.faculty_id),

          user_id: Number(faculty.user_id),

          employee_number: faculty.employee_number,

          faculty_name: faculty.faculty_name,

          employment_status: faculty.employment_status,

          role_id: Number(faculty.role_id),

          role_name: faculty.role_name,

          username: faculty.username,
        },

        // =============================================
        // CLEARED SCHEDULE
        // =============================================

        room: null,

        schedule_days: null,

        schedule_time: null,

        schedule_start_time: null,

        schedule_end_time: null,

        // =============================================
        // CAPACITY
        // =============================================

        max_students: Number(current.max_students || 0),

        // =============================================
        // STATUS
        // =============================================

        status: "Closed",

        configuration_complete: false,

        ready_for_enrollment: false,

        schedule_status: "Pending instructor schedule",
      },

      actor,
    });
  } catch (error) {
    // =================================================
    // ROLLBACK
    // =================================================

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "REASSIGN SUBJECT OFFERING ROLLBACK ERROR:",
          rollbackError,
        );
      }
    }

    console.error("REASSIGN SUBJECT OFFERING ERROR:", error);

    // =================================================
    // SERVER ERROR
    // =================================================

    return res.status(500).json({
      success: false,

      message: "Failed to reassign subject offering instructor.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    // =================================================
    // RELEASE CONNECTION
    // =================================================

    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// UPDATE SUBJECT OFFERING STATUS
//
// PATCH
// /api/registrar/offerings/subject-offerings/:id/status
//
// Body:
//
// {
//   "status": "Open",
//   "reason": "Ready for enrollment."
// }
//
// STATUSES:
//
// Open
// Closed
// Cancelled
//
// RULES:
//
// OPEN
// - section_subject must be Open
// - faculty required
// - schedule_days required
// - schedule_time required
// - max_students > 0
// - schedule must be valid
// - NO faculty/section/room schedule conflicts
//
// CLOSED
// - blocks new enrollment assignment
// - cannot close while Pending students are assigned
// - Approved students may remain
//
// CANCELLED
// - terminal
// - reason required
// - cannot cancel while Pending/Approved students
//   are actively assigned
//
// room_id remains optional.
// =====================================================

router.patch("/subject-offerings/:id/status", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  const offeringId = toPositiveInt(req.params.id);

  if (!offeringId) {
    return res.status(400).json({
      success: false,
      message: "Invalid subject offering ID.",
    });
  }

  const requestedStatus =
    typeof req.body?.status === "string" ? req.body.status.trim() : "";

  const allowedStatuses = ["Open", "Closed", "Cancelled"];

  if (!allowedStatuses.includes(requestedStatus)) {
    return res.status(400).json({
      success: false,

      message: "Invalid subject offering status.",

      allowed_statuses: allowedStatuses,
    });
  }

  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

  if (requestedStatus === "Cancelled" && !reason) {
    return res.status(400).json({
      success: false,

      message: "A reason is required when cancelling a subject offering.",
    });
  }

  let connection;

  try {
    connection = await db.getConnection();

    await connection.beginTransaction();

    // =================================================
    // LOAD CURRENT OFFERING
    // =================================================

    const [rows] = await connection.execute(
      `
          SELECT
              so.offering_id,
              so.section_subject_id,
              so.subject_id,
              so.section_id,
              so.faculty_id,
              so.room_id,
              so.academic_year_id,
              so.semester_id,
              so.schedule_days,
              so.schedule_time,
              so.max_students,
              so.status,

              ss.status
                  AS section_subject_status,

              sub.subject_code,
              sub.subject_name,
              sub.units,

              sec.section_name,
              sec.year_level,
              sec.course_id,

              c.course_code,
              c.course_name,

              ay.academic_year,

              sem.semester_name,

              CONCAT_WS(
                ' ',
                f.first_name,
                NULLIF(f.middle_name, ''),
                f.last_name
              ) AS faculty_name,

              r.room_code,
              r.room_name,
              r.capacity
                  AS room_capacity

          FROM subject_offerings so

          INNER JOIN section_subjects ss
              ON ss.section_subject_id =
                 so.section_subject_id

          INNER JOIN subjects sub
              ON sub.subject_id =
                 so.subject_id

          INNER JOIN sections sec
              ON sec.section_id =
                 so.section_id

          INNER JOIN courses c
              ON c.course_id =
                 sec.course_id

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 so.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 so.semester_id

          LEFT JOIN faculty f
              ON f.faculty_id =
                 so.faculty_id

          LEFT JOIN rooms r
              ON r.room_id =
                 so.room_id

          WHERE so.offering_id = ?

          LIMIT 1

          FOR UPDATE
          `,
      [offeringId],
    );

    if (rows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Subject offering not found.",
      });
    }

    const current = rows[0];

    // =================================================
    // SAME STATUS = SAFE NO-OP
    // =================================================

    if (current.status === requestedStatus) {
      await connection.rollback();

      return res.status(200).json({
        success: true,

        message: `Subject offering is already ${requestedStatus}.`,

        changed: false,

        offering: {
          offering_id: offeringId,

          status: current.status,

          subject: {
            subject_id: Number(current.subject_id),

            subject_code: current.subject_code,

            subject_name: current.subject_name,
          },

          section: {
            section_id: Number(current.section_id),

            section_name: current.section_name,
          },
        },

        actor,
      });
    }

    // =================================================
    // CANCELLED = TERMINAL
    // =================================================

    if (current.status === "Cancelled") {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message: "A cancelled subject offering cannot be reopened or closed.",
      });
    }

    // =================================================
    // ACTIVE ENROLLMENT COUNTS
    // =================================================

    const [countRows] = await connection.execute(
      `
          SELECT
              SUM(
                CASE
                  WHEN e.enrollment_status =
                       'Pending'
                  THEN 1
                  ELSE 0
                END
              ) AS pending_count,

              SUM(
                CASE
                  WHEN e.enrollment_status =
                       'Approved'
                  THEN 1
                  ELSE 0
                END
              ) AS approved_count,

              COUNT(*) AS active_count

          FROM enrollment_subjects es

          INNER JOIN enrollments e
              ON e.enrollment_id =
                 es.enrollment_id

          WHERE es.offering_id = ?

            AND es.status = 'Enrolled'

            AND e.enrollment_status
                IN (
                  'Pending',
                  'Approved'
                )
          `,
      [offeringId],
    );

    const pendingCount = Number(countRows[0]?.pending_count || 0);

    const approvedCount = Number(countRows[0]?.approved_count || 0);

    const activeCount = Number(countRows[0]?.active_count || 0);

    // =================================================
    // OPEN VALIDATION
    // =================================================

    if (requestedStatus === "Open") {
      const missingConfiguration = [];

      if (current.section_subject_status !== "Open") {
        missingConfiguration.push("section_subject_open");
      }

      if (!current.faculty_id) {
        missingConfiguration.push("faculty_id");
      }

      if (!current.schedule_days || !String(current.schedule_days).trim()) {
        missingConfiguration.push("schedule_days");
      }

      if (!current.schedule_time || !String(current.schedule_time).trim()) {
        missingConfiguration.push("schedule_time");
      }

      if (Number(current.max_students || 0) <= 0) {
        missingConfiguration.push("max_students");
      }

      if (missingConfiguration.length > 0) {
        await connection.rollback();

        return res.status(409).json({
          success: false,

          message: "Subject offering is not ready to be opened.",

          missing_configuration: missingConfiguration,

          offering: {
            offering_id: offeringId,

            current_status: current.status,

            subject: {
              subject_id: Number(current.subject_id),

              subject_code: current.subject_code,

              subject_name: current.subject_name,
            },

            section: {
              section_id: Number(current.section_id),

              section_name: current.section_name,
            },

            section_subject_status: current.section_subject_status,

            faculty_id:
              current.faculty_id !== null ? Number(current.faculty_id) : null,

            room_id: current.room_id !== null ? Number(current.room_id) : null,

            schedule_days: current.schedule_days,

            schedule_time: current.schedule_time,

            max_students: Number(current.max_students || 0),
          },
        });
      }

      // ===============================================
      // VALIDATE DAYS FORMAT
      // ===============================================

      const parsedDays = parseScheduleDays(current.schedule_days);

      if (parsedDays.length === 0) {
        await connection.rollback();

        return res.status(400).json({
          success: false,

          message:
            "Subject offering has invalid schedule_days and cannot be opened.",

          schedule_days: current.schedule_days,
        });
      }

      // ===============================================
      // VALIDATE TIME FORMAT
      // ===============================================

      const parsedTime = parseScheduleTimeRange(current.schedule_time);

      if (!parsedTime) {
        await connection.rollback();

        return res.status(400).json({
          success: false,

          message:
            "Subject offering has an invalid schedule_time and cannot be opened.",

          schedule_time: current.schedule_time,
        });
      }

      // ===============================================
      // ROOM CAPACITY
      //
      // Room remains optional.
      // But when assigned, it must support capacity.
      // ===============================================

      if (current.room_id !== null) {
        const roomCapacity = Number(current.room_capacity || 0);

        const offeringCapacity = Number(current.max_students || 0);

        if (roomCapacity > 0 && offeringCapacity > roomCapacity) {
          await connection.rollback();

          return res.status(409).json({
            success: false,

            message:
              "Subject offering capacity exceeds the assigned room capacity.",

            offering_capacity: offeringCapacity,

            room: {
              room_id: Number(current.room_id),

              room_code: current.room_code,

              room_name: current.room_name,

              capacity: roomCapacity,
            },
          });
        }
      }

      // ===============================================
      // AUTHORITATIVE SCHEDULE CONFLICT CHECK
      //
      // This prevents a conflicting Closed offering
      // from being opened even if it somehow bypassed
      // the PUT conflict validation.
      // ===============================================

      const scheduleConflicts = await findOfferingScheduleConflicts(
        connection,
        {
          offeringId,

          academicYearId: Number(current.academic_year_id),

          semesterId: Number(current.semester_id),

          sectionId: Number(current.section_id),

          facultyId:
            current.faculty_id !== null ? Number(current.faculty_id) : null,

          roomId: current.room_id !== null ? Number(current.room_id) : null,

          scheduleDays: current.schedule_days,

          scheduleTime: current.schedule_time,
        },
      );

      if (scheduleConflicts.length > 0) {
        const facultyConflicts = scheduleConflicts.filter((conflict) =>
          conflict.conflict_types.includes("FACULTY"),
        ).length;

        const sectionConflicts = scheduleConflicts.filter((conflict) =>
          conflict.conflict_types.includes("SECTION"),
        ).length;

        const roomConflicts = scheduleConflicts.filter((conflict) =>
          conflict.conflict_types.includes("ROOM"),
        ).length;

        await connection.rollback();

        return res.status(409).json({
          success: false,

          message:
            "Subject offering cannot be opened because its schedule conflicts with an existing offering.",

          conflict: true,

          summary: {
            total_conflicts: scheduleConflicts.length,

            faculty_conflicts: facultyConflicts,

            section_conflicts: sectionConflicts,

            room_conflicts: roomConflicts,
          },

          conflicts: scheduleConflicts,
        });
      }

      // ===============================================
      // CAPACITY / FULL CHECK
      // ===============================================

      const maxStudents = Number(current.max_students || 0);

      if (activeCount >= maxStudents) {
        await connection.rollback();

        return res.status(409).json({
          success: false,

          message:
            "Subject offering cannot be opened because it has no available capacity.",

          capacity: {
            max_students: maxStudents,

            enrolled_count: activeCount,

            available_slots: Math.max(0, maxStudents - activeCount),
          },
        });
      }
    }

    // =================================================
    // CLOSE VALIDATION
    //
    // Pending enrollment processing must be resolved.
    //
    // Approved students may remain because closing
    // prevents future placement but does not erase
    // official enrollment membership.
    // =================================================

    if (requestedStatus === "Closed") {
      if (pendingCount > 0) {
        await connection.rollback();

        return res.status(409).json({
          success: false,

          message:
            "Cannot close this subject offering while Pending enrollments are assigned to it.",

          enrollment_counts: {
            pending: pendingCount,

            approved: approvedCount,

            active: activeCount,
          },

          required_action:
            "Resolve or transfer the Pending enrollment assignments first.",
        });
      }
    }

    // =================================================
    // CANCEL VALIDATION
    //
    // No active Pending/Approved enrollment membership
    // may remain.
    // =================================================

    if (requestedStatus === "Cancelled") {
      if (activeCount > 0) {
        await connection.rollback();

        return res.status(409).json({
          success: false,

          message:
            "Cannot cancel this subject offering while students are assigned to it.",

          enrollment_counts: {
            pending: pendingCount,

            approved: approvedCount,

            active: activeCount,
          },

          required_action: "Transfer or remove all assigned students first.",
        });
      }
    }

    // =================================================
    // FINAL REASON
    // =================================================

    const finalReason =
      reason ||
      (requestedStatus === "Open"
        ? "Registrar opened subject offering."
        : requestedStatus === "Closed"
          ? "Registrar closed subject offering."
          : "Registrar cancelled subject offering.");

    // =================================================
    // UPDATE STATUS
    // =================================================

    await connection.execute(
      `
        UPDATE subject_offerings

        SET status = ?

        WHERE offering_id = ?
        `,
      [requestedStatus, offeringId],
    );

    // =================================================
    // AUDIT
    // =================================================

    await connection.execute(
      `
        INSERT INTO audit_trail (
            user_id,
            table_name,
            record_id,
            action,
            old_values,
            new_values
        )

        VALUES (
            ?,
            'subject_offerings',
            ?,
            'UPDATE',
            ?,
            ?
        )
        `,
      [
        actor.user_id,

        offeringId,

        JSON.stringify({
          status: current.status,
        }),

        JSON.stringify({
          status: requestedStatus,

          reason: finalReason,

          changed_by: actor.user_id,
        }),
      ],
    );

    await connection.commit();

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      message: `Subject offering changed from ${current.status} to ${requestedStatus}.`,

      changed: true,

      reason: finalReason,

      offering: {
        offering_id: offeringId,

        section_subject_id: Number(current.section_subject_id),

        subject: {
          subject_id: Number(current.subject_id),

          subject_code: current.subject_code,

          subject_name: current.subject_name,

          units: Number(current.units || 0),
        },

        section: {
          section_id: Number(current.section_id),

          section_name: current.section_name,

          course_id: Number(current.course_id),

          course_code: current.course_code,

          course_name: current.course_name,

          year_level: Number(current.year_level),
        },

        academic_period: {
          academic_year_id: Number(current.academic_year_id),

          academic_year: current.academic_year,

          semester_id: Number(current.semester_id),

          semester_name: current.semester_name,
        },

        faculty:
          current.faculty_id !== null
            ? {
                faculty_id: Number(current.faculty_id),

                faculty_name: current.faculty_name,
              }
            : null,

        room:
          current.room_id !== null
            ? {
                room_id: Number(current.room_id),

                room_code: current.room_code,

                room_name: current.room_name,
              }
            : null,

        schedule: {
          days: current.schedule_days,

          time: current.schedule_time,
        },

        max_students: Number(current.max_students || 0),

        previous_status: current.status,

        status: requestedStatus,

        section_subject_status: current.section_subject_status,

        enrollment_counts: {
          pending: pendingCount,

          approved: approvedCount,

          active: activeCount,
        },
      },

      actor,
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("OFFERING STATUS ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("UPDATE SUBJECT OFFERING STATUS ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to update subject offering status.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// GET OFFERING READINESS
//
// GET /api/registrar/offerings/readiness
//
// Required filters:
//
// academic_year_id
// semester_id
// course_id
// year_level
// curriculum_id
// section_id
//
// PURPOSE:
//
// Determine whether a selected section is completely
// prepared for enrollment for the selected curriculum
// and academic period.
//
// READY means:
//
// - curriculum subject exists
// - section_subject exists
// - section_subject is Open
// - subject_offering exists
// - faculty is assigned
// - schedule_days exists
// - schedule_time exists
// - max_students > 0
// - offering is Open
//
// room_id remains optional.
// =====================================================

router.get("/readiness", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  // ===================================================
  // FILTERS
  // ===================================================

  const academicYearId = toPositiveInt(req.query.academic_year_id);

  const semesterId = toPositiveInt(req.query.semester_id);

  const courseId = toPositiveInt(req.query.course_id);

  const yearLevel = toPositiveInt(req.query.year_level);

  const curriculumId = toPositiveInt(req.query.curriculum_id);

  const sectionId = toPositiveInt(req.query.section_id);

  const missingFilters = [];

  if (!academicYearId) {
    missingFilters.push("academic_year_id");
  }

  if (!semesterId) {
    missingFilters.push("semester_id");
  }

  if (!courseId) {
    missingFilters.push("course_id");
  }

  if (!yearLevel) {
    missingFilters.push("year_level");
  }

  if (!curriculumId) {
    missingFilters.push("curriculum_id");
  }

  if (!sectionId) {
    missingFilters.push("section_id");
  }

  if (missingFilters.length > 0) {
    return res.status(400).json({
      success: false,

      message:
        "Complete academic period, curriculum, and section filters are required.",

      missing_or_invalid_filters: missingFilters,
    });
  }

  let connection;

  try {
    connection = await db.getConnection();

    // =================================================
    // VALIDATE ACADEMIC YEAR
    // =================================================

    const [academicYearRows] = await connection.execute(
      `
        SELECT
            academic_year_id,
            academic_year,
            is_current

        FROM academic_years

        WHERE academic_year_id = ?

        LIMIT 1
        `,
      [academicYearId],
    );

    if (academicYearRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Academic year not found.",
      });
    }

    const academicYear = academicYearRows[0];

    // =================================================
    // VALIDATE SEMESTER
    // =================================================

    const [semesterRows] = await connection.execute(
      `
        SELECT
            semester_id,
            semester_name

        FROM semesters

        WHERE semester_id = ?

        LIMIT 1
        `,
      [semesterId],
    );

    if (semesterRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Semester not found.",
      });
    }

    const semester = semesterRows[0];

    // =================================================
    // VALIDATE COURSE
    // =================================================

    const [courseRows] = await connection.execute(
      `
        SELECT
            course_id,
            course_code,
            course_name,
            department_id

        FROM courses

        WHERE course_id = ?

        LIMIT 1
        `,
      [courseId],
    );

    if (courseRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Course not found.",
      });
    }

    const course = courseRows[0];

    // =================================================
    // VALIDATE CURRICULUM
    // =================================================

    const [curriculumRows] = await connection.execute(
      `
        SELECT
            curriculum_id,
            course_id,
            curriculum_name,
            effective_year,
            total_units,
            is_active

        FROM curriculum

        WHERE curriculum_id = ?

        LIMIT 1
        `,
      [curriculumId],
    );

    if (curriculumRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Curriculum not found.",
      });
    }

    const curriculum = curriculumRows[0];

    if (Number(curriculum.course_id) !== courseId) {
      return res.status(409).json({
        success: false,

        message: "Selected curriculum does not belong to the selected course.",
      });
    }

    if (Number(curriculum.is_active) !== 1) {
      return res.status(409).json({
        success: false,

        message: "Selected curriculum is not active.",
      });
    }

    // =================================================
    // VALIDATE SECTION
    // =================================================

    const [sectionRows] = await connection.execute(
      `
        SELECT
            section_id,
            course_id,
            academic_year_id,
            year_level,
            section_name,
            max_students

        FROM sections

        WHERE section_id = ?

        LIMIT 1
        `,
      [sectionId],
    );

    if (sectionRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Section not found.",
      });
    }

    const section = sectionRows[0];

    if (Number(section.course_id) !== courseId) {
      return res.status(409).json({
        success: false,

        message: "Selected section does not belong to the selected course.",
      });
    }

    if (Number(section.academic_year_id) !== academicYearId) {
      return res.status(409).json({
        success: false,

        message:
          "Selected section does not belong to the selected academic year.",
      });
    }

    if (Number(section.year_level) !== yearLevel) {
      return res.status(409).json({
        success: false,

        message: "Selected section does not match the selected year level.",
      });
    }

    // =================================================
    // LOAD EXPECTED CURRICULUM SUBJECTS
    //
    // Each curriculum subject is checked against:
    //
    // curriculum_subject
    //      ↓
    // section_subject
    //      ↓
    // subject_offering
    // =================================================

    const [rows] = await connection.execute(
      `
        SELECT
            cs.curriculum_subject_id,
            cs.display_order,
            cs.is_required,

            sub.subject_id,
            sub.subject_code,
            sub.subject_name,
            sub.units,
            sub.lecture_hours,
            sub.laboratory_hours,

            ss.section_subject_id,
            ss.max_students
                AS section_subject_max_students,
            ss.status
                AS section_subject_status,

            so.offering_id,
            so.faculty_id,
            so.room_id,
            so.schedule_days,
            so.schedule_time,
            so.max_students
                AS offering_max_students,
            so.status
                AS offering_status,

            CONCAT_WS(
              ' ',
              f.first_name,
              NULLIF(f.middle_name, ''),
              f.last_name
            ) AS faculty_name,

            r.room_code,
            r.room_name,

            (
              SELECT COUNT(*)

              FROM enrollment_subjects es_count

              INNER JOIN enrollments e_count
                  ON e_count.enrollment_id =
                     es_count.enrollment_id

              WHERE es_count.offering_id =
                    so.offering_id

                AND es_count.status =
                    'Enrolled'

                AND e_count.enrollment_status
                    IN (
                      'Pending',
                      'Approved'
                    )
            ) AS enrolled_count

        FROM curriculum_subjects cs

        INNER JOIN subjects sub
            ON sub.subject_id =
               cs.subject_id

        LEFT JOIN section_subjects ss
            ON ss.section_id = ?

           AND ss.subject_id =
               cs.subject_id

           AND ss.academic_year_id = ?

           AND ss.semester_id = ?

        LEFT JOIN subject_offerings so
            ON so.section_subject_id =
               ss.section_subject_id

        LEFT JOIN faculty f
            ON f.faculty_id =
               so.faculty_id

        LEFT JOIN rooms r
            ON r.room_id =
               so.room_id

        WHERE cs.curriculum_id = ?

          AND cs.year_level = ?

          AND cs.semester_id = ?

        ORDER BY
            COALESCE(
              cs.display_order,
              999999
            ) ASC,
            sub.subject_code ASC
        `,
      [
        sectionId,
        academicYearId,
        semesterId,

        curriculumId,
        yearLevel,
        semesterId,
      ],
    );

    // =================================================
    // FORMAT SUBJECT READINESS
    // =================================================

    const subjects = rows.map((row) => {
      const hasSectionSubject = row.section_subject_id !== null;

      const hasOffering = row.offering_id !== null;

      const missingConfiguration = [];

      // =============================================
      // SECTION SUBJECT
      // =============================================

      if (!hasSectionSubject) {
        missingConfiguration.push("section_subject");
      } else if (row.section_subject_status !== "Open") {
        missingConfiguration.push("section_subject_open");
      }

      // =============================================
      // OFFERING
      // =============================================

      if (!hasOffering) {
        missingConfiguration.push("offering");
      } else {
        if (!row.faculty_id) {
          missingConfiguration.push("faculty_id");
        }

        if (!row.schedule_days || !String(row.schedule_days).trim()) {
          missingConfiguration.push("schedule_days");
        }

        if (!row.schedule_time || !String(row.schedule_time).trim()) {
          missingConfiguration.push("schedule_time");
        }

        const maxStudents = Number(row.offering_max_students || 0);

        if (maxStudents <= 0) {
          missingConfiguration.push("max_students");
        }

        if (row.offering_status !== "Open") {
          missingConfiguration.push("offering_open");
        }
      }

      const configurationComplete =
        hasSectionSubject &&
        hasOffering &&
        Boolean(row.faculty_id) &&
        Boolean(row.schedule_days && String(row.schedule_days).trim()) &&
        Boolean(row.schedule_time && String(row.schedule_time).trim()) &&
        Number(row.offering_max_students || 0) > 0;

      const readyForEnrollment =
        configurationComplete &&
        row.section_subject_status === "Open" &&
        row.offering_status === "Open";

      const enrolledCount = Number(row.enrolled_count || 0);

      const maxStudents =
        row.offering_id !== null
          ? Number(row.offering_max_students || 0)
          : null;

      const availableSlots =
        maxStudents !== null && maxStudents > 0
          ? Math.max(0, maxStudents - enrolledCount)
          : null;

      return {
        curriculum_subject_id: Number(row.curriculum_subject_id),

        subject: {
          subject_id: Number(row.subject_id),

          subject_code: row.subject_code,

          subject_name: row.subject_name,

          units: Number(row.units || 0),

          lecture_hours: Number(row.lecture_hours || 0),

          laboratory_hours: Number(row.laboratory_hours || 0),

          is_required: Number(row.is_required || 0) === 1,

          display_order:
            row.display_order !== null ? Number(row.display_order) : null,
        },

        section_subject: hasSectionSubject
          ? {
              section_subject_id: Number(row.section_subject_id),

              status: row.section_subject_status,

              max_students:
                row.section_subject_max_students !== null
                  ? Number(row.section_subject_max_students)
                  : null,
            }
          : null,

        offering: hasOffering
          ? {
              offering_id: Number(row.offering_id),

              status: row.offering_status,

              faculty:
                row.faculty_id !== null
                  ? {
                      faculty_id: Number(row.faculty_id),

                      faculty_name: row.faculty_name,
                    }
                  : null,

              room:
                row.room_id !== null
                  ? {
                      room_id: Number(row.room_id),

                      room_code: row.room_code,

                      room_name: row.room_name,
                    }
                  : null,

              schedule: {
                days: row.schedule_days || null,

                time: row.schedule_time || null,
              },

              capacity: {
                max_students: maxStudents,

                enrolled_count: enrolledCount,

                available_slots: availableSlots,

                is_full:
                  maxStudents !== null ? enrolledCount >= maxStudents : false,
              },
            }
          : null,

        has_section_subject: hasSectionSubject,

        has_offering: hasOffering,

        configuration_complete: configurationComplete,

        ready_for_enrollment: readyForEnrollment,

        missing_configuration: missingConfiguration,
      };
    });

    // =================================================
    // SUMMARY COUNTERS
    // =================================================

    const curriculumSubjectCount = subjects.length;

    const sectionSubjectCount = subjects.filter(
      (item) => item.has_section_subject,
    ).length;

    const offeringCount = subjects.filter((item) => item.has_offering).length;

    const missingSectionSubjectCount = subjects.filter(
      (item) => !item.has_section_subject,
    ).length;

    const missingOfferingCount = subjects.filter(
      (item) => item.has_section_subject && !item.has_offering,
    ).length;

    const openOfferingCount = subjects.filter(
      (item) => item.offering?.status === "Open",
    ).length;

    const closedOfferingCount = subjects.filter(
      (item) => item.offering?.status === "Closed",
    ).length;

    const cancelledOfferingCount = subjects.filter(
      (item) => item.offering?.status === "Cancelled",
    ).length;

    const completeConfigurationCount = subjects.filter(
      (item) => item.configuration_complete,
    ).length;

    const incompleteConfigurationCount = subjects.filter(
      (item) => item.has_offering && !item.configuration_complete,
    ).length;

    const readyCount = subjects.filter(
      (item) => item.ready_for_enrollment,
    ).length;

    const notReadyCount = curriculumSubjectCount - readyCount;

    // =================================================
    // OVERALL READINESS
    // =================================================

    const ready =
      curriculumSubjectCount > 0 && readyCount === curriculumSubjectCount;

    // =================================================
    // LOAD EXTRA SECTION SUBJECTS
    //
    // These are section subjects in this academic
    // period that are NOT part of the selected
    // curriculum/year/semester.
    //
    // This is useful for explicit retake/special
    // offerings such as CC104 in another semester.
    // =================================================

    const [extraRows] = await connection.execute(
      `
        SELECT
            ss.section_subject_id,
            ss.subject_id,
            sub.subject_code,
            sub.subject_name,
            sub.units,
            ss.max_students,
            ss.status,

            so.offering_id,
            so.status
                AS offering_status

        FROM section_subjects ss

        INNER JOIN subjects sub
            ON sub.subject_id =
               ss.subject_id

        LEFT JOIN subject_offerings so
            ON so.section_subject_id =
               ss.section_subject_id

        LEFT JOIN curriculum_subjects cs
            ON cs.curriculum_id = ?

           AND cs.subject_id =
               ss.subject_id

           AND cs.year_level = ?

           AND cs.semester_id = ?

        WHERE ss.section_id = ?

          AND ss.academic_year_id = ?

          AND ss.semester_id = ?

          AND cs.curriculum_subject_id
              IS NULL

        ORDER BY
            sub.subject_code ASC
        `,
      [
        curriculumId,
        yearLevel,
        semesterId,

        sectionId,
        academicYearId,
        semesterId,
      ],
    );

    const extraSectionSubjects = extraRows.map((row) => ({
      section_subject_id: Number(row.section_subject_id),

      subject: {
        subject_id: Number(row.subject_id),

        subject_code: row.subject_code,

        subject_name: row.subject_name,

        units: Number(row.units || 0),
      },

      max_students: row.max_students !== null ? Number(row.max_students) : null,

      section_subject_status: row.status,

      offering_id: row.offering_id !== null ? Number(row.offering_id) : null,

      offering_status: row.offering_status || null,

      classification: "EXTRA_OR_SPECIAL",
    }));

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      ready,

      academic_period: {
        academic_year_id: academicYearId,

        academic_year: academicYear.academic_year,

        semester_id: semesterId,

        semester_name: semester.semester_name,
      },

      course: {
        course_id: courseId,

        course_code: course.course_code,

        course_name: course.course_name,
      },

      curriculum: {
        curriculum_id: curriculumId,

        curriculum_name: curriculum.curriculum_name,

        effective_year: curriculum.effective_year,

        is_active: Number(curriculum.is_active) === 1,
      },

      section: {
        section_id: sectionId,

        section_name: section.section_name,

        year_level: Number(section.year_level),

        max_students: Number(section.max_students || 0),
      },

      summary: {
        curriculum_subjects: curriculumSubjectCount,

        section_subjects: sectionSubjectCount,

        missing_section_subjects: missingSectionSubjectCount,

        offerings: offeringCount,

        missing_offerings: missingOfferingCount,

        open_offerings: openOfferingCount,

        closed_offerings: closedOfferingCount,

        cancelled_offerings: cancelledOfferingCount,

        configuration_complete: completeConfigurationCount,

        configuration_incomplete: incompleteConfigurationCount,

        ready_for_enrollment: readyCount,

        not_ready: notReadyCount,

        extra_or_special_section_subjects: extraSectionSubjects.length,
      },

      subjects,

      extra_section_subjects: extraSectionSubjects,

      actor,
    });
  } catch (error) {
    console.error("GET OFFERING READINESS ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to evaluate offering readiness.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// UPDATE SECTION SUBJECT STATUS
//
// PATCH
// /api/registrar/offerings/section-subjects/:id/status
//
// Body:
//
// {
//   "status": "Closed",
//   "reason": "Temporarily unavailable."
// }
//
// RULES:
//
// Open
// - section subject becomes schedulable/usable again
//
// Closed
// - no new enrollment placement should use it
// - linked Open offering must be closed first
// - Pending students must be resolved first
// - Approved students may remain
//
// Cancelled
// - terminal state
// - linked Open offering must be closed/cancelled first
// - no Pending/Approved students may remain
//
// Cancelled section subjects are not silently revived.
// =====================================================

router.patch("/section-subjects/:id/status", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  const sectionSubjectId = toPositiveInt(req.params.id);

  if (!sectionSubjectId) {
    return res.status(400).json({
      success: false,
      message: "Invalid section subject ID.",
    });
  }

  const requestedStatus =
    typeof req.body?.status === "string" ? req.body.status.trim() : "";

  const allowedStatuses = ["Open", "Closed", "Cancelled"];

  if (!allowedStatuses.includes(requestedStatus)) {
    return res.status(400).json({
      success: false,

      message: "Invalid section subject status.",

      allowed_statuses: allowedStatuses,
    });
  }

  const reason =
    typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

  if (requestedStatus === "Cancelled" && !reason) {
    return res.status(400).json({
      success: false,

      message: "A reason is required when cancelling a section subject.",
    });
  }

  let connection;

  try {
    connection = await db.getConnection();

    await connection.beginTransaction();

    // =================================================
    // LOAD SECTION SUBJECT
    // =================================================

    const [rows] = await connection.execute(
      `
          SELECT
              ss.section_subject_id,
              ss.section_id,
              ss.subject_id,
              ss.academic_year_id,
              ss.semester_id,
              ss.max_students,
              ss.status,

              sec.section_name,
              sec.course_id,
              sec.year_level,

              c.course_code,
              c.course_name,

              sub.subject_code,
              sub.subject_name,
              sub.units,

              ay.academic_year,

              sem.semester_name,

              so.offering_id,
              so.status
                  AS offering_status

          FROM section_subjects ss

          INNER JOIN sections sec
              ON sec.section_id =
                 ss.section_id

          INNER JOIN courses c
              ON c.course_id =
                 sec.course_id

          INNER JOIN subjects sub
              ON sub.subject_id =
                 ss.subject_id

          INNER JOIN academic_years ay
              ON ay.academic_year_id =
                 ss.academic_year_id

          INNER JOIN semesters sem
              ON sem.semester_id =
                 ss.semester_id

          LEFT JOIN subject_offerings so
              ON so.section_subject_id =
                 ss.section_subject_id

          WHERE ss.section_subject_id = ?

          LIMIT 1

          FOR UPDATE
          `,
      [sectionSubjectId],
    );

    if (rows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Section subject not found.",
      });
    }

    const current = rows[0];

    // =================================================
    // ENROLLMENT COUNTS
    // =================================================

    const [countRows] = await connection.execute(
      `
          SELECT
              SUM(
                CASE
                  WHEN e.enrollment_status =
                       'Pending'
                  THEN 1
                  ELSE 0
                END
              ) AS pending_count,

              SUM(
                CASE
                  WHEN e.enrollment_status =
                       'Approved'
                  THEN 1
                  ELSE 0
                END
              ) AS approved_count,

              COUNT(*) AS active_count

          FROM enrollment_subjects es

          INNER JOIN enrollments e
              ON e.enrollment_id =
                 es.enrollment_id

          WHERE es.section_subject_id = ?

            AND es.status = 'Enrolled'

            AND e.enrollment_status
                IN (
                  'Pending',
                  'Approved'
                )
          `,
      [sectionSubjectId],
    );

    const pendingCount = Number(countRows[0]?.pending_count || 0);

    const approvedCount = Number(countRows[0]?.approved_count || 0);

    const activeCount = Number(countRows[0]?.active_count || 0);

    // =================================================
    // SAME STATUS
    // =================================================

    if (current.status === requestedStatus) {
      await connection.rollback();

      return res.status(200).json({
        success: true,

        message: `Section subject is already ${requestedStatus}.`,

        changed: false,

        section_subject: {
          section_subject_id: sectionSubjectId,

          status: current.status,

          offering_id:
            current.offering_id !== null ? Number(current.offering_id) : null,

          offering_status: current.offering_status || null,

          pending_count: pendingCount,

          approved_count: approvedCount,

          active_count: activeCount,
        },

        actor,
      });
    }

    // =================================================
    // CANCELLED = TERMINAL
    // =================================================

    if (current.status === "Cancelled") {
      await connection.rollback();

      return res.status(409).json({
        success: false,

        message: "A cancelled section subject cannot be reopened or closed.",
      });
    }

    // =================================================
    // CLOSE
    // =================================================

    if (requestedStatus === "Closed") {
      // Do not create:
      //
      // section_subject = Closed
      // offering        = Open
      //
      // Close the offering first.
      if (current.offering_status === "Open") {
        await connection.rollback();

        return res.status(409).json({
          success: false,

          message:
            "Cannot close the section subject while its offering is Open.",

          required_action: "Close the subject offering first.",

          offering: {
            offering_id: Number(current.offering_id),

            status: current.offering_status,
          },
        });
      }

      // Pending students are still being processed.
      if (pendingCount > 0) {
        await connection.rollback();

        return res.status(409).json({
          success: false,

          message:
            "Cannot close this section subject while Pending enrollments are assigned to it.",

          enrollment_counts: {
            pending: pendingCount,

            approved: approvedCount,

            active: activeCount,
          },

          required_action: "Resolve the Pending enrollments first.",
        });
      }
    }

    // =================================================
    // CANCEL
    // =================================================

    if (requestedStatus === "Cancelled") {
      if (current.offering_status === "Open") {
        await connection.rollback();

        return res.status(409).json({
          success: false,

          message:
            "Cannot cancel the section subject while its offering is Open.",

          required_action: "Close or cancel the subject offering first.",

          offering: {
            offering_id: Number(current.offering_id),

            status: current.offering_status,
          },
        });
      }

      if (activeCount > 0) {
        await connection.rollback();

        return res.status(409).json({
          success: false,

          message:
            "Cannot cancel this section subject while students are assigned to it.",

          enrollment_counts: {
            pending: pendingCount,

            approved: approvedCount,

            active: activeCount,
          },

          required_action: "Transfer or remove all assigned students first.",
        });
      }
    }

    // =================================================
    // REASON
    // =================================================

    const finalReason =
      reason ||
      (requestedStatus === "Open"
        ? "Registrar opened section subject."
        : requestedStatus === "Closed"
          ? "Registrar closed section subject."
          : "Registrar cancelled section subject.");

    // =================================================
    // UPDATE
    // =================================================

    await connection.execute(
      `
        UPDATE section_subjects

        SET status = ?

        WHERE section_subject_id = ?
        `,
      [requestedStatus, sectionSubjectId],
    );

    // =================================================
    // AUDIT
    // =================================================

    await connection.execute(
      `
        INSERT INTO audit_trail (
            user_id,
            table_name,
            record_id,
            action,
            old_values,
            new_values
        )

        VALUES (
            ?,
            'section_subjects',
            ?,
            'UPDATE',
            ?,
            ?
        )
        `,
      [
        actor.user_id,

        sectionSubjectId,

        JSON.stringify({
          status: current.status,
        }),

        JSON.stringify({
          status: requestedStatus,

          reason: finalReason,

          changed_by: actor.user_id,
        }),
      ],
    );

    await connection.commit();

    return res.status(200).json({
      success: true,

      message: `Section subject changed from ${current.status} to ${requestedStatus}.`,

      changed: true,

      reason: finalReason,

      section_subject: {
        section_subject_id: sectionSubjectId,

        subject: {
          subject_id: Number(current.subject_id),

          subject_code: current.subject_code,

          subject_name: current.subject_name,

          units: Number(current.units || 0),
        },

        section: {
          section_id: Number(current.section_id),

          section_name: current.section_name,

          course_id: Number(current.course_id),

          course_code: current.course_code,

          course_name: current.course_name,

          year_level: Number(current.year_level),
        },

        academic_period: {
          academic_year_id: Number(current.academic_year_id),

          academic_year: current.academic_year,

          semester_id: Number(current.semester_id),

          semester_name: current.semester_name,
        },

        max_students:
          current.max_students !== null ? Number(current.max_students) : null,

        previous_status: current.status,

        status: requestedStatus,

        linked_offering: {
          offering_id:
            current.offering_id !== null ? Number(current.offering_id) : null,

          status: current.offering_status || null,
        },

        enrollment_counts: {
          pending: pendingCount,

          approved: approvedCount,

          active: activeCount,
        },
      },

      actor,
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("SECTION SUBJECT STATUS ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("UPDATE SECTION SUBJECT STATUS ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to update section subject status.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// =====================================================
// GET SUBJECT OFFERINGS
//
// GET /api/registrar/offerings/subject-offerings
//
// Optional filters:
//
// ?academic_year_id=2
// &semester_id=2
// &course_id=1
// &year_level=2
// &section_id=2
// &subject_id=37
// &faculty_id=5
// &room_id=3
// &status=Closed
//
// PURPOSE:
//
// - Registrar management list
// - Shows Open / Closed / Cancelled offerings
// - Shows section
// - Shows subject
// - Shows assigned teaching user
// - Identifies Faculty vs Program Head
// - Shows room
// - Shows schedule
// - Shows structured start/end time
// - Shows capacity
// - Shows enrolled count
// - Shows remaining slots
// - Shows readiness for enrollment
//
// IMPORTANT:
//
// This route includes both:
// - Faculty teaching assignments
// - Program Head teaching assignments
//
// The frontend can separate them using:
//
// faculty.role_name === "Faculty"
// faculty.role_name === "Program Head"
//
// Unlike the Student-placement available-offerings route,
// this management route includes Closed offerings.
// =====================================================

router.get("/subject-offerings", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  try {
    // =================================================
    // OPTIONAL FILTERS
    // =================================================

    const academicYearId =
      req.query.academic_year_id === undefined
        ? null
        : toPositiveInt(req.query.academic_year_id);

    const semesterId =
      req.query.semester_id === undefined
        ? null
        : toPositiveInt(req.query.semester_id);

    const courseId =
      req.query.course_id === undefined
        ? null
        : toPositiveInt(req.query.course_id);

    const yearLevel =
      req.query.year_level === undefined
        ? null
        : toPositiveInt(req.query.year_level);

    const sectionId =
      req.query.section_id === undefined
        ? null
        : toPositiveInt(req.query.section_id);

    const subjectId =
      req.query.subject_id === undefined
        ? null
        : toPositiveInt(req.query.subject_id);

    const facultyId =
      req.query.faculty_id === undefined
        ? null
        : toPositiveInt(req.query.faculty_id);

    const roomId =
      req.query.room_id === undefined ? null : toPositiveInt(req.query.room_id);

    const status =
      typeof req.query.status === "string" ? req.query.status.trim() : null;

    // =================================================
    // VALIDATE NUMERIC FILTERS
    // =================================================

    if (req.query.academic_year_id !== undefined && !academicYearId) {
      return res.status(400).json({
        success: false,
        message: "Invalid academic_year_id.",
      });
    }

    if (req.query.semester_id !== undefined && !semesterId) {
      return res.status(400).json({
        success: false,
        message: "Invalid semester_id.",
      });
    }

    if (req.query.course_id !== undefined && !courseId) {
      return res.status(400).json({
        success: false,
        message: "Invalid course_id.",
      });
    }

    if (req.query.year_level !== undefined && !yearLevel) {
      return res.status(400).json({
        success: false,
        message: "Invalid year_level.",
      });
    }

    if (req.query.section_id !== undefined && !sectionId) {
      return res.status(400).json({
        success: false,
        message: "Invalid section_id.",
      });
    }

    if (req.query.subject_id !== undefined && !subjectId) {
      return res.status(400).json({
        success: false,
        message: "Invalid subject_id.",
      });
    }

    if (req.query.faculty_id !== undefined && !facultyId) {
      return res.status(400).json({
        success: false,
        message: "Invalid faculty_id.",
      });
    }

    if (req.query.room_id !== undefined && !roomId) {
      return res.status(400).json({
        success: false,
        message: "Invalid room_id.",
      });
    }

    // =================================================
    // STATUS VALIDATION
    // =================================================

    const allowedStatuses = ["Open", "Closed", "Cancelled"];

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,

        message: "Invalid subject offering status.",

        allowed_statuses: allowedStatuses,
      });
    }

    // =================================================
    // BUILD CONDITIONS
    // =================================================

    const conditions = [];
    const params = [];

    if (academicYearId) {
      conditions.push("so.academic_year_id = ?");

      params.push(academicYearId);
    }

    if (semesterId) {
      conditions.push("so.semester_id = ?");

      params.push(semesterId);
    }

    if (courseId) {
      conditions.push("sec.course_id = ?");

      params.push(courseId);
    }

    if (yearLevel) {
      conditions.push("sec.year_level = ?");

      params.push(yearLevel);
    }

    if (sectionId) {
      conditions.push("so.section_id = ?");

      params.push(sectionId);
    }

    if (subjectId) {
      conditions.push("so.subject_id = ?");

      params.push(subjectId);
    }

    if (facultyId) {
      conditions.push("so.faculty_id = ?");

      params.push(facultyId);
    }

    if (roomId) {
      conditions.push("so.room_id = ?");

      params.push(roomId);
    }

    if (status) {
      conditions.push("so.status = ?");

      params.push(status);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // =================================================
    // LOAD OFFERINGS
    // =================================================

    const [rows] = await db.execute(
      `
        SELECT
            so.offering_id,

            so.section_subject_id,

            ss.status
                AS section_subject_status,

            -- =========================================
            -- SUBJECT
            -- =========================================

            so.subject_id,

            sub.subject_code,
            sub.subject_name,
            sub.units,
            sub.lecture_hours,
            sub.laboratory_hours,

            -- =========================================
            -- SECTION
            -- =========================================

            so.section_id,

            sec.section_name,
            sec.course_id,
            sec.year_level,

            sec.max_students
                AS section_max_students,

            c.course_code,
            c.course_name,

            -- =========================================
            -- ASSIGNED TEACHING USER
            -- =========================================

            so.faculty_id,

            f.user_id
                AS faculty_user_id,

            f.employee_number,

            CONCAT_WS(
              ' ',
              f.first_name,
              NULLIF(
                f.middle_name,
                ''
              ),
              f.last_name
            ) AS faculty_name,

            f.email
                AS faculty_email,

            f.department_id
                AS faculty_department_id,

            f.employment_status,

            u.username
                AS faculty_username,

            rl.role_id
                AS faculty_role_id,

            rl.role_name
                AS faculty_role_name,

            -- =========================================
            -- ROOM
            -- =========================================

            so.room_id,

            r.room_code,
            r.room_name,

            r.capacity
                AS room_capacity,

            b.building_name,

            -- =========================================
            -- ACADEMIC PERIOD
            -- =========================================

            so.academic_year_id,

            ay.academic_year,

            so.semester_id,

            sem.semester_name,

            -- =========================================
            -- SCHEDULE
            -- =========================================

            so.schedule_days,
            so.schedule_time,

            so.schedule_start_time,
            so.schedule_end_time,

            -- =========================================
            -- OFFERING
            -- =========================================

            so.max_students,
            so.status,
            so.created_at,

            -- =========================================
            -- OFFICIAL / ACTIVE ENROLLMENT COUNT
            -- =========================================

            (
              SELECT COUNT(*)

              FROM enrollment_subjects es_count

              INNER JOIN enrollments e_count
                  ON e_count.enrollment_id =
                     es_count.enrollment_id

              WHERE es_count.offering_id =
                    so.offering_id

                AND es_count.status =
                    'Enrolled'

                AND e_count.enrollment_status
                    IN (
                      'Pending',
                      'Approved'
                    )
            ) AS enrolled_count

        FROM subject_offerings so

        INNER JOIN section_subjects ss
            ON ss.section_subject_id =
               so.section_subject_id

        INNER JOIN subjects sub
            ON sub.subject_id =
               so.subject_id

        INNER JOIN sections sec
            ON sec.section_id =
               so.section_id

        INNER JOIN courses c
            ON c.course_id =
               sec.course_id

        INNER JOIN academic_years ay
            ON ay.academic_year_id =
               so.academic_year_id

        INNER JOIN semesters sem
            ON sem.semester_id =
               so.semester_id

        -- ===========================================
        -- ASSIGNED FACULTY RECORD
        -- ===========================================

        LEFT JOIN faculty f
            ON f.faculty_id =
               so.faculty_id

        -- ===========================================
        -- USER ACCOUNT OF TEACHING USER
        -- ===========================================

        LEFT JOIN users u
            ON u.user_id =
               f.user_id

        -- ===========================================
        -- ROLE
        --
        -- Allows Registrar frontend to distinguish:
        --
        -- Faculty
        -- Program Head
        -- ===========================================

        LEFT JOIN roles rl
            ON rl.role_id =
               u.role_id

        -- ===========================================
        -- ROOM
        -- ===========================================

        LEFT JOIN rooms r
            ON r.room_id =
               so.room_id

        LEFT JOIN buildings b
            ON b.building_id =
               r.building_id

        ${whereClause}

        ORDER BY
            ay.academic_year_id DESC,
            sem.semester_id ASC,
            c.course_code ASC,
            sec.year_level ASC,
            sec.section_name ASC,
            sub.subject_code ASC
        `,
      params,
    );

    // =================================================
    // FORMAT RESPONSE
    // =================================================

    const offerings = rows.map((row) => {
      const maxStudents = Number(row.max_students || 0);

      const enrolledCount = Number(row.enrolled_count || 0);

      const availableSlots =
        maxStudents > 0 ? Math.max(0, maxStudents - enrolledCount) : null;

      // =============================================
      // READINESS
      //
      // Offering must have:
      //
      // - assigned teaching user
      // - schedule day
      // - schedule time
      // - Open section subject
      // =============================================

      const missingFields = [];

      if (!row.faculty_id) {
        missingFields.push("faculty_id");
      }

      if (!row.schedule_days || !String(row.schedule_days).trim()) {
        missingFields.push("schedule_days");
      }

      if (!row.schedule_time || !String(row.schedule_time).trim()) {
        missingFields.push("schedule_time");
      }

      if (row.section_subject_status !== "Open") {
        missingFields.push("section_subject_open");
      }

      const configurationComplete = missingFields.length === 0;

      const readyForEnrollment =
        row.status === "Open" &&
        configurationComplete &&
        (availableSlots === null || availableSlots > 0);

      // =============================================
      // SCHEDULE STATUS
      // =============================================

      const hasSchedule =
        Boolean(row.schedule_days && String(row.schedule_days).trim()) &&
        Boolean(row.schedule_time && String(row.schedule_time).trim());

      // =============================================
      // RESPONSE OBJECT
      // =============================================

      return {
        offering_id: Number(row.offering_id),

        section_subject_id: Number(row.section_subject_id),

        section_subject_status: row.section_subject_status,

        // ===========================================
        // SUBJECT
        // ===========================================

        subject: {
          subject_id: Number(row.subject_id),

          subject_code: row.subject_code,

          subject_name: row.subject_name,

          units: Number(row.units || 0),

          lecture_hours: Number(row.lecture_hours || 0),

          laboratory_hours: Number(row.laboratory_hours || 0),
        },

        // ===========================================
        // SECTION
        // ===========================================

        section: {
          section_id: Number(row.section_id),

          section_name: row.section_name,

          course_id: Number(row.course_id),

          course_code: row.course_code,

          course_name: row.course_name,

          year_level: Number(row.year_level),

          max_students: Number(row.section_max_students || 0),
        },

        // ===========================================
        // ACADEMIC PERIOD
        // ===========================================

        academic_period: {
          academic_year_id: Number(row.academic_year_id),

          academic_year: row.academic_year,

          semester_id: Number(row.semester_id),

          semester_name: row.semester_name,
        },

        // ===========================================
        // ASSIGNED TEACHING USER
        //
        // IMPORTANT:
        //
        // role_name tells Registrar whether this is:
        //
        // Faculty
        // Program Head
        // ===========================================

        faculty:
          row.faculty_id !== null
            ? {
                faculty_id: Number(row.faculty_id),

                user_id:
                  row.faculty_user_id !== null
                    ? Number(row.faculty_user_id)
                    : null,

                employee_number: row.employee_number,

                faculty_name: row.faculty_name,

                email: row.faculty_email,

                department_id:
                  row.faculty_department_id !== null
                    ? Number(row.faculty_department_id)
                    : null,

                employment_status: row.employment_status,

                username: row.faculty_username,

                role_id:
                  row.faculty_role_id !== null
                    ? Number(row.faculty_role_id)
                    : null,

                role_name: row.faculty_role_name,
              }
            : null,

        // ===========================================
        // ROOM
        // ===========================================

        room:
          row.room_id !== null
            ? {
                room_id: Number(row.room_id),

                room_code: row.room_code,

                room_name: row.room_name,

                building_name: row.building_name,

                capacity:
                  row.room_capacity !== null ? Number(row.room_capacity) : null,
              }
            : null,

        // ===========================================
        // SCHEDULE
        //
        // Keep existing top-level properties so
        // current Registrar frontend does not break.
        // ===========================================

        schedule_days: row.schedule_days || null,

        schedule_time: row.schedule_time || null,

        schedule_start_time: row.schedule_start_time || null,

        schedule_end_time: row.schedule_end_time || null,

        schedule_status: hasSchedule
          ? "Scheduled"
          : "Pending Instructor Schedule",

        // ===========================================
        // CAPACITY
        // ===========================================

        max_students: maxStudents,

        enrolled_count: enrolledCount,

        available_slots: availableSlots,

        // ===========================================
        // OFFERING STATUS
        // ===========================================

        status: row.status,

        configuration_complete: configurationComplete,

        missing_configuration: missingFields,

        ready_for_enrollment: readyForEnrollment,

        created_at: row.created_at,
      };
    });

    // =================================================
    // SUMMARY
    // =================================================

    const openCount = offerings.filter(
      (offering) => offering.status === "Open",
    ).length;

    const closedCount = offerings.filter(
      (offering) => offering.status === "Closed",
    ).length;

    const cancelledCount = offerings.filter(
      (offering) => offering.status === "Cancelled",
    ).length;

    const completeCount = offerings.filter(
      (offering) => offering.configuration_complete,
    ).length;

    const incompleteCount = offerings.length - completeCount;

    const readyCount = offerings.filter(
      (offering) => offering.ready_for_enrollment,
    ).length;

    // =================================================
    // ROLE SUMMARY
    //
    // Helpful for Registrar schedule pages.
    // =================================================

    const facultyOfferingCount = offerings.filter(
      (offering) => offering.faculty?.role_name === "Faculty",
    ).length;

    const programHeadOfferingCount = offerings.filter(
      (offering) => offering.faculty?.role_name === "Program Head",
    ).length;

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      filters: {
        academic_year_id: academicYearId,

        semester_id: semesterId,

        course_id: courseId,

        year_level: yearLevel,

        section_id: sectionId,

        subject_id: subjectId,

        faculty_id: facultyId,

        room_id: roomId,

        status: status || null,
      },

      count: offerings.length,

      summary: {
        total: offerings.length,

        open: openCount,

        closed: closedCount,

        cancelled: cancelledCount,

        configuration_complete: completeCount,

        configuration_incomplete: incompleteCount,

        ready_for_enrollment: readyCount,

        faculty_offerings: facultyOfferingCount,

        program_head_offerings: programHeadOfferingCount,
      },

      offerings,

      actor,
    });
  } catch (error) {
    console.error("GET SUBJECT OFFERINGS ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to load subject offerings.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// =====================================================
// GET TEACHING SCHEDULES
//
// GET /api/registrar/offerings/teaching-schedules
//
// Optional:
//
// ?role=Faculty
// ?role=Program Head
//
// PURPOSE:
//
// Registrar can view teaching schedules for:
//
// - Faculty
// - Program Head
//
// This route is VIEW ONLY.
// Registrar does not modify schedules here.
// =====================================================

router.get("/teaching-schedules", async (req, res) => {
  const actor = getRegistrarActor(req, res);

  if (!actor) {
    return;
  }

  try {
    // =================================================
    // OPTIONAL ROLE FILTER
    // =================================================

    const requestedRole =
      typeof req.query.role === "string" ? req.query.role.trim() : null;

    const allowedRoles = ["Faculty", "Program Head"];

    if (requestedRole && !allowedRoles.includes(requestedRole)) {
      return res.status(400).json({
        success: false,

        message: "Invalid teaching role.",

        allowed_roles: allowedRoles,
      });
    }

    // =================================================
    // CONDITIONS
    // =================================================

    const conditions = [
      "so.status <> 'Cancelled'",
      "rl.role_name IN ('Faculty', 'Program Head')",
    ];

    const params = [];

    if (requestedRole) {
      conditions.push("rl.role_name = ?");

      params.push(requestedRole);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    // =================================================
    // LOAD TEACHING SCHEDULES
    // =================================================

    const [rows] = await db.execute(
      `
        SELECT
            -- =========================================
            -- OFFERING
            -- =========================================

            so.offering_id,
            so.section_subject_id,
            so.subject_id,
            so.section_id,
            so.faculty_id,
            so.room_id,

            so.academic_year_id,
            so.semester_id,

            so.schedule_days,
            so.schedule_time,
            so.schedule_start_time,
            so.schedule_end_time,

            so.max_students,
            so.status,

            so.created_at,
            so.updated_at,

            -- =========================================
            -- SECTION SUBJECT
            -- =========================================

            ss.status
                AS section_subject_status,

            -- =========================================
            -- SUBJECT
            -- =========================================

            sub.subject_code,
            sub.subject_name,
            sub.units,
            sub.lecture_hours,
            sub.laboratory_hours,

            -- =========================================
            -- SECTION
            -- =========================================

            sec.section_name,
            sec.year_level,
            sec.course_id,

            sec.max_students
                AS section_max_students,

            -- =========================================
            -- COURSE
            -- =========================================

            c.course_code,
            c.course_name,
            c.department_id
                AS course_department_id,

            -- =========================================
            -- DEPARTMENT
            -- =========================================

            d.department_code,
            d.department_name,

            -- =========================================
            -- ACADEMIC PERIOD
            -- =========================================

            ay.academic_year,

            sem.semester_name,

            -- =========================================
            -- TEACHING USER
            -- =========================================

            f.user_id
                AS teaching_user_id,

            f.employee_number,

            f.first_name,
            f.middle_name,
            f.last_name,

            CONCAT_WS(
              ' ',
              f.first_name,
              NULLIF(
                f.middle_name,
                ''
              ),
              f.last_name
            ) AS teaching_user_name,

            f.email
                AS teaching_user_email,

            f.department_id
                AS teaching_department_id,

            f.employment_status,

            -- =========================================
            -- USER ACCOUNT
            -- =========================================

            u.username
                AS teaching_username,

            u.is_active
                AS teaching_user_active,

            u.is_verified
                AS teaching_user_verified,

            -- =========================================
            -- ROLE
            -- =========================================

            rl.role_id
                AS teaching_role_id,

            rl.role_name
                AS teaching_role_name,

            -- =========================================
            -- ROOM
            -- =========================================

            r.room_code,
            r.room_name,

            r.capacity
                AS room_capacity,

            b.building_name,

            -- =========================================
            -- ENROLLED STUDENTS
            -- =========================================

            (
              SELECT COUNT(*)

              FROM enrollment_subjects es_count

              INNER JOIN enrollments e_count
                  ON e_count.enrollment_id =
                     es_count.enrollment_id

              WHERE es_count.offering_id =
                    so.offering_id

                AND es_count.status =
                    'Enrolled'

                AND e_count.enrollment_status
                    IN (
                      'Pending',
                      'Approved'
                    )
            ) AS enrolled_count

        FROM subject_offerings so

        INNER JOIN section_subjects ss
            ON ss.section_subject_id =
               so.section_subject_id

        INNER JOIN subjects sub
            ON sub.subject_id =
               so.subject_id

        INNER JOIN sections sec
            ON sec.section_id =
               so.section_id

        INNER JOIN courses c
            ON c.course_id =
               sec.course_id

        LEFT JOIN departments d
            ON d.department_id =
               c.department_id

        INNER JOIN academic_years ay
            ON ay.academic_year_id =
               so.academic_year_id

        INNER JOIN semesters sem
            ON sem.semester_id =
               so.semester_id

        -- ===========================================
        -- FACULTY PROFILE
        --
        -- Program Head also has a faculty profile.
        -- ===========================================

        INNER JOIN faculty f
            ON f.faculty_id =
               so.faculty_id

        -- ===========================================
        -- USER ACCOUNT
        -- ===========================================

        INNER JOIN users u
            ON u.user_id =
               f.user_id

        -- ===========================================
        -- ROLE
        --
        -- Faculty      = role 4
        -- Program Head = role 3
        -- ===========================================

        INNER JOIN roles rl
            ON rl.role_id =
               u.role_id

        -- ===========================================
        -- ROOM
        -- ===========================================

        LEFT JOIN rooms r
            ON r.room_id =
               so.room_id

        LEFT JOIN buildings b
            ON b.building_id =
               r.building_id

        ${whereClause}

        ORDER BY
            rl.role_name ASC,

            f.last_name ASC,
            f.first_name ASC,

            ay.academic_year_id DESC,
            sem.semester_id ASC,

            sec.section_name ASC,

            sub.subject_code ASC
        `,
      params,
    );

    // =================================================
    // FORMAT OFFERINGS
    // =================================================

    const offerings = rows.map((row) => {
      const maxStudents = Number(row.max_students || 0);

      const enrolledCount = Number(row.enrolled_count || 0);

      const availableSlots =
        maxStudents > 0 ? Math.max(0, maxStudents - enrolledCount) : null;

      const hasDays = Boolean(
        row.schedule_days && String(row.schedule_days).trim(),
      );

      const hasTime = Boolean(
        row.schedule_time && String(row.schedule_time).trim(),
      );

      const hasSchedule = hasDays && hasTime;

      return {
        // ===========================================
        // OFFERING
        // ===========================================

        offering_id: Number(row.offering_id),

        section_subject_id: Number(row.section_subject_id),

        section_subject_status: row.section_subject_status,

        status: row.status,

        created_at: row.created_at,

        updated_at: row.updated_at,

        // ===========================================
        // SUBJECT
        // ===========================================

        subject: {
          subject_id: Number(row.subject_id),

          subject_code: row.subject_code,

          subject_name: row.subject_name,

          units: Number(row.units || 0),

          lecture_hours: Number(row.lecture_hours || 0),

          laboratory_hours: Number(row.laboratory_hours || 0),
        },

        // ===========================================
        // SECTION
        // ===========================================

        section: {
          section_id: Number(row.section_id),

          section_name: row.section_name,

          year_level: Number(row.year_level),

          max_students: Number(row.section_max_students || 0),

          course: {
            course_id: Number(row.course_id),

            course_code: row.course_code,

            course_name: row.course_name,
          },
        },

        // ===========================================
        // DEPARTMENT
        // ===========================================

        department: {
          department_id:
            row.course_department_id !== null
              ? Number(row.course_department_id)
              : null,

          department_code: row.department_code,

          department_name: row.department_name,
        },

        // ===========================================
        // ACADEMIC PERIOD
        // ===========================================

        academic_period: {
          academic_year_id: Number(row.academic_year_id),

          academic_year: row.academic_year,

          semester_id: Number(row.semester_id),

          semester_name: row.semester_name,
        },

        // ===========================================
        // TEACHING USER
        //
        // Can be:
        //
        // Faculty
        // Program Head
        // ===========================================

        teaching_user: {
          faculty_id: Number(row.faculty_id),

          user_id: Number(row.teaching_user_id),

          employee_number: row.employee_number,

          first_name: row.first_name,

          middle_name: row.middle_name,

          last_name: row.last_name,

          name: row.teaching_user_name,

          email: row.teaching_user_email,

          username: row.teaching_username,

          department_id:
            row.teaching_department_id !== null
              ? Number(row.teaching_department_id)
              : null,

          employment_status: row.employment_status,

          role_id: Number(row.teaching_role_id),

          role_name: row.teaching_role_name,

          is_active: Number(row.teaching_user_active) === 1,

          is_verified: Number(row.teaching_user_verified) === 1,
        },

        // ===========================================
        // KEEP FACULTY ALIAS
        //
        // This allows our existing frontend shape
        // to continue working while we migrate.
        // ===========================================

        faculty: {
          faculty_id: Number(row.faculty_id),

          user_id: Number(row.teaching_user_id),

          employee_number: row.employee_number,

          faculty_name: row.teaching_user_name,

          email: row.teaching_user_email,

          department_id:
            row.teaching_department_id !== null
              ? Number(row.teaching_department_id)
              : null,

          employment_status: row.employment_status,

          username: row.teaching_username,

          role_id: Number(row.teaching_role_id),

          role_name: row.teaching_role_name,
        },

        // ===========================================
        // SCHEDULE
        // ===========================================

        schedule: {
          days: row.schedule_days || null,

          time: row.schedule_time || null,

          start_time: row.schedule_start_time || null,

          end_time: row.schedule_end_time || null,

          status: hasSchedule ? "Scheduled" : "Pending Instructor Schedule",
        },

        // ===========================================
        // TOP LEVEL SCHEDULE FIELDS
        //
        // Keep compatibility with existing frontend.
        // ===========================================

        schedule_days: row.schedule_days || null,

        schedule_time: row.schedule_time || null,

        schedule_start_time: row.schedule_start_time || null,

        schedule_end_time: row.schedule_end_time || null,

        schedule_status: hasSchedule
          ? "Scheduled"
          : "Pending Instructor Schedule",

        // ===========================================
        // ROOM
        // ===========================================

        room:
          row.room_id !== null
            ? {
                room_id: Number(row.room_id),

                room_code: row.room_code,

                room_name: row.room_name,

                building_name: row.building_name,

                capacity:
                  row.room_capacity !== null ? Number(row.room_capacity) : null,
              }
            : null,

        // ===========================================
        // CAPACITY
        // ===========================================

        capacity: {
          max_students: maxStudents,

          enrolled_students: enrolledCount,

          available_slots: availableSlots,
        },

        max_students: maxStudents,

        enrolled_count: enrolledCount,

        available_slots: availableSlots,
      };
    });

    // =================================================
    // TEACHING USERS
    //
    // Unique Faculty / Program Head users.
    // =================================================

    const teachingUsersMap = new Map();

    for (const offering of offerings) {
      const user = offering.teaching_user;

      if (!teachingUsersMap.has(user.faculty_id)) {
        teachingUsersMap.set(user.faculty_id, {
          ...user,

          department: offering.department,

          total_classes: 0,

          scheduled_classes: 0,

          unscheduled_classes: 0,
        });
      }

      const summary = teachingUsersMap.get(user.faculty_id);

      summary.total_classes += 1;

      if (offering.schedule_status === "Scheduled") {
        summary.scheduled_classes += 1;
      } else {
        summary.unscheduled_classes += 1;
      }
    }

    const teachingUsers = Array.from(teachingUsersMap.values()).sort((a, b) => {
      if (a.role_name !== b.role_name) {
        return String(a.role_name).localeCompare(String(b.role_name));
      }

      return String(a.name).localeCompare(String(b.name));
    });

    // =================================================
    // SUMMARY
    // =================================================

    const facultyOfferings = offerings.filter(
      (item) => item.teaching_user.role_name === "Faculty",
    );

    const programHeadOfferings = offerings.filter(
      (item) => item.teaching_user.role_name === "Program Head",
    );

    const facultyUsers = teachingUsers.filter(
      (item) => item.role_name === "Faculty",
    );

    const programHeadUsers = teachingUsers.filter(
      (item) => item.role_name === "Program Head",
    );

    const scheduledCount = offerings.filter(
      (item) => item.schedule_status === "Scheduled",
    ).length;

    const unscheduledCount = offerings.length - scheduledCount;

    // =================================================
    // RESPONSE
    // =================================================

    return res.status(200).json({
      success: true,

      role_filter: requestedRole || null,

      allowed_roles: allowedRoles,

      summary: {
        total_teaching_users: teachingUsers.length,

        faculty_users: facultyUsers.length,

        program_head_users: programHeadUsers.length,

        total_offerings: offerings.length,

        faculty_offerings: facultyOfferings.length,

        program_head_offerings: programHeadOfferings.length,

        scheduled: scheduledCount,

        unscheduled: unscheduledCount,
      },

      teaching_users: teachingUsers,

      count: offerings.length,

      offerings,

      actor,
    });
  } catch (error) {
    console.error("GET REGISTRAR TEACHING SCHEDULES ERROR:", error);

    return res.status(500).json({
      success: false,

      message: "Failed to load teaching schedules.",

      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});
export default router;
