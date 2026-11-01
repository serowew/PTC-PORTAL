/**
 * Shared section allocator.
 * Run inside a transaction before inserting the student.
 */

export class SectionAssignmentError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "SectionAssignmentError";
    this.code = code;
    this.status = status;
  }
}

// Validate identifiers before running database queries
function positiveId(value, name) {
  let id;

  if (typeof value === "number") {
    id = value;
  } else if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    id = Number(value);
  } else {
    throw new SectionAssignmentError(
      "INVALID_SECTION_INPUT",
      `A valid ${name} is required.`,
      400,
    );
  }

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new SectionAssignmentError(
      "INVALID_SECTION_INPUT",
      `A valid ${name} is required.`,
      400,
    );
  }

  return id;
}

export async function selectAvailableSection(
  connection,
  { courseId, academicYearId, yearLevel },
) {
  if (!connection || typeof connection.execute !== "function") {
    throw new TypeError("An active MySQL transaction connection is required.");
  }

  const course = positiveId(courseId, "course ID");

  const academicYear = positiveId(academicYearId, "academic year ID");

  const year = positiveId(yearLevel, "year level");

  // Lock matching sections until the transaction commits
  const [sections] = await connection.execute(
    `
    SELECT
      section_id,
      section_name,
      max_students
    FROM sections
    WHERE course_id = ?
      AND academic_year_id = ?
      AND year_level = ?
    ORDER BY section_name ASC, section_id ASC
    FOR UPDATE
    `,
    [course, academicYear, year],
  );

  if (sections.length === 0) {
    throw new SectionAssignmentError(
      "NO_ELIGIBLE_SECTION",
      "No section exists for this course, academic year, and year level. Ask the Registrar to prepare one.",
    );
  }

  for (const section of sections) {
    const sectionId = positiveId(section.section_id, "section ID");

    const capacity = Number(section.max_students);

    // Allowed section capacity: 40 to 50 students
    if (!Number.isInteger(capacity) || capacity < 40 || capacity > 50) {
      throw new SectionAssignmentError(
        "INVALID_SECTION_CAPACITY",
        `Section ${section.section_name} must have a capacity between 40 and 50.`,
      );
    }

    // Count current active section members
    const [members] = await connection.execute(
      `
      SELECT student_id
      FROM students
      WHERE section_id = ?
        AND is_archived = 0
      ORDER BY student_id ASC
      FOR UPDATE
      `,
      [sectionId],
    );

    const occupied = members.length;

    if (occupied < capacity) {
      return {
        sectionId,
        sectionName: section.section_name,
        capacity,
        occupiedBeforeAssignment: occupied,
        remainingAfterAssignment: capacity - occupied - 1,
      };
    }
  }

  throw new SectionAssignmentError(
    "ALL_SECTIONS_FULL",
    "All existing sections for this course and year level are full. Ask the Registrar to prepare the next section.",
  );
}
