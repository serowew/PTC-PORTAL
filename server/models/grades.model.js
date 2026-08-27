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

        g.prelim_grade,
        g.midterm_grade,
        g.final_grade,
        g.remarks

      FROM grades g

      INNER JOIN students s
        ON s.student_id = g.student_id

      INNER JOIN subjects sub
        ON sub.subject_id = g.subject_id

      INNER JOIN enrollments e
        ON e.enrollment_id = g.enrollment_id

      INNER JOIN academic_years ay
        ON ay.academic_year_id = e.academic_year_id

      INNER JOIN semesters sem
        ON sem.semester_id = e.semester_id

      INNER JOIN sections sec
        ON sec.section_id = s.section_id

      INNER JOIN courses c
        ON c.course_id = s.course_id

      WHERE
        s.student_id = ?
        AND ay.academic_year = ?
        AND sem.semester_name = ?

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