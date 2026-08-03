import db from "../db.js";

const normalizeIdentifier = (identifier) => {
  if (identifier === undefined || identifier === null) return null;
  const value = String(identifier).trim();
  return value.length > 0 ? value : null;
};

export const studentProfileModel = {
  async getByIdentifier(identifier) {
    const normalized = normalizeIdentifier(identifier);

    if (!normalized) {
      return null;
    }

    const numericIdentifier = Number(normalized);

    const [rows] = await db.execute(
      `
        SELECT
          sp.profile_id AS profileId,
          sp.student_id AS studentId,
          sp.photo AS photo,
          sp.address AS address,
          sp.guardian_name AS guardianName,
          sp.guardian_relationship AS guardianRelationship,
          sp.guardian_contact AS guardianContact,
          sp.created_at AS createdAt,
          sp.updated_at AS updatedAt,
          s.student_number AS studentNumber,
          s.first_name AS firstName,
          s.middle_name AS middleName,
          s.last_name AS lastName,
          s.gender,
          s.birth_date AS birthDate,
          s.contact_number AS contactNumber,
          s.course,
          s.year_level AS yearLevel,
          s.section,
          s.enrollment_status AS enrollmentStatus,
          u.email
        FROM student_profiles sp
        INNER JOIN students s ON s.student_id = sp.student_id
        LEFT JOIN users u ON u.user_id = s.user_id
        WHERE s.student_id = ?
           OR s.student_number = ?
           OR s.user_id = ?
        LIMIT 1
      `,
      [normalized, normalized, Number.isNaN(numericIdentifier) ? null : numericIdentifier],
    );

    return rows[0] ?? null;
  },

  async updateOrCreateByIdentifier(identifier, payload) {
    const normalized = normalizeIdentifier(identifier);

    if (!normalized) {
      throw new Error("A student identifier is required.");
    }

    const numericIdentifier = Number(normalized);
    const [studentRows] = await db.execute(
      `
        SELECT student_id AS studentId
        FROM students
        WHERE student_id = ?
           OR student_number = ?
           OR user_id = ?
        LIMIT 1
      `,
      [normalized, normalized, Number.isNaN(numericIdentifier) ? null : numericIdentifier],
    );

    if (!studentRows.length) {
      throw new Error("Student not found.");
    }

    const studentId = studentRows[0].studentId;

    const [profileRows] = await db.execute(
      `
        SELECT profile_id AS profileId
        FROM student_profiles
        WHERE student_id = ?
        LIMIT 1
      `,
      [studentId],
    );

    if (!profileRows.length) {
      await db.execute(
        `
          INSERT INTO student_profiles (
            student_id,
            photo,
            address,
            guardian_name,
            guardian_relationship,
            guardian_contact,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        [
          studentId,
          payload.photo ?? null,
          payload.address ?? null,
          payload.guardianName ?? null,
          payload.guardianRelationship ?? null,
          payload.guardianContact ?? null,
        ],
      );

      return this.getByIdentifier(studentId);
    }

    const profileId = profileRows[0].profileId;
    const updateFields = ["updated_at = CURRENT_TIMESTAMP"];
    const values = [];

    if (payload.photo !== undefined) {
      updateFields.push("photo = ?");
      values.push(payload.photo);
    }

    if (payload.address !== undefined) {
      updateFields.push("address = ?");
      values.push(payload.address);
    }

    if (payload.guardianName !== undefined) {
      updateFields.push("guardian_name = ?");
      values.push(payload.guardianName);
    }

    if (payload.guardianRelationship !== undefined) {
      updateFields.push("guardian_relationship = ?");
      values.push(payload.guardianRelationship);
    }

    if (payload.guardianContact !== undefined) {
      updateFields.push("guardian_contact = ?");
      values.push(payload.guardianContact);
    }

    values.push(profileId);

    await db.execute(
      `UPDATE student_profiles SET ${updateFields.join(", ")} WHERE profile_id = ?`,
      values,
    );

    return this.getByIdentifier(studentId);
  },
};
