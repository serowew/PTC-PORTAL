import db from "../db.js";

class GradesModel {
  static async getStudentGrades(studentId, academicYear, semester) {
    const sql = `
      SELECT
        s.student_number,

        CONCAT(
          s.first_name,
          ' ',
          COALESCE(CONCAT(s.middle_name, ' '), ''),
          s.last_name
        ) AS student_name,

        c.course_name,
        sec.section_name,
        s.year_level,

        ay.academic_year,
        sem.semester_name,

        sub.subject_code,
        sub.subject_name,
        sub.units,

        g.midterm_grade,
        g.final_grade,
        g.final_rating,
        g.remarks,
        g.approval_status

      FROM grades g

      INNER JOIN students s
        ON s.student_id = g.student_id

      INNER JOIN subject_offerings so
        ON so.offering_id = g.offering_id

      INNER JOIN subjects sub
        ON sub.subject_id = so.subject_id

      INNER JOIN sections sec
        ON sec.section_id = s.section_id

      INNER JOIN courses c
        ON c.course_id = s.course_id

      INNER JOIN academic_years ay
        ON ay.academic_year_id = so.academic_year_id

      INNER JOIN semesters sem
        ON sem.semester_id = so.semester_id

      WHERE
        s.student_id = ?
        AND ay.academic_year = ?
        AND sem.semester_name = ?
        AND g.approval_status = 'Published'

      ORDER BY sub.subject_code;
    `;

    const [rows] = await db.execute(sql, [
      studentId,
      academicYear,
      semester,
    ]);

    return rows;
  }
}

export default GradesModel;