import GradesModel from "../models/grades.model.js";

class GradesController {
  static async getStudentGrades(req, res) {
    try {
      const { studentId, academicYear, semester } = req.query;

      if (!studentId || !academicYear || !semester) {
        return res.status(400).json({
          success: false,
          message: "Missing required parameters.",
        });
      }

      const rows = await GradesModel.getStudentGrades(
        Number(studentId),
        academicYear,
        semester
      );

      if (rows.length === 0) {
        return res.json({
          success: true,
          student: null,
          academicYear,
          semester,
          grades: [],
        });
      }

      const first = rows[0];

      const response = {
        success: true,

        student: {
          studentNumber: first.student_number,
          name: first.student_name,
          course: first.course_name,
          yearLevel: first.year_level,
          section: first.section_name,
          enrollmentStatus: "Enrolled",
        },

        academicYear: first.academic_year,
        semester: first.semester_name,

        grades: rows.map((row) => ({
          subjectCode: row.subject_code,
          subjectName: row.subject_name,
          units: row.units,
          prelim: row.prelim_grade,
          midterm: row.midterm_grade,
          final: row.final_grade,
          finalGrade: row.final_rating,
          remarks: row.remarks,
        })),
      };

      return res.json(response);
    } catch (error) {
      console.error("Grades Controller Error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to load grades.",
      });
    }
  }
}

export default GradesController;