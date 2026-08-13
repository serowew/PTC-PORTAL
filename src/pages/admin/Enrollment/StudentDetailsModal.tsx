import "../../../styles/modal.css";

interface Student {
  student_id: number;
  student_number: string;

  first_name: string;
  middle_name?: string;
  last_name: string;

  gender: string;
  birth_date: string;
  contact_number: string;

  course_code: string;
  course_name: string;

  section_name: string;

  academic_year: string;

  year_level: number;

  admission_date: string;
}

interface Props {
  open: boolean;
  student: Student | null;

  onClose: () => void;
}

export default function StudentDetailsModal({
  open,
  student,
  onClose,
}: Props) {

  if (!open || !student) return null;

  return (
    <div className="modal-overlay">

      <div className="modal-content">

        <div className="modal-header">

          <h2>Student Information</h2>

          <button
            className="close-btn"
            onClick={onClose}
          >
            ✕
          </button>

        </div>

        <div className="modal-body">

          <table className="review-table">

            <tbody>

              <tr>
                <td>Student Number</td>
                <td>{student.student_number}</td>
              </tr>

              <tr>
                <td>Name</td>
                <td>
                  {student.first_name}{" "}
                  {student.middle_name}{" "}
                  {student.last_name}
                </td>
              </tr>

              <tr>
                <td>Course</td>
                <td>
                  {student.course_code} - {student.course_name}
                </td>
              </tr>

              <tr>
                <td>Section</td>
                <td>{student.section_name}</td>
              </tr>

              <tr>
                <td>Academic Year</td>
                <td>{student.academic_year}</td>
              </tr>

              <tr>
                <td>Year Level</td>
                <td>{student.year_level}</td>
              </tr>

              <tr>
                <td>Gender</td>
                <td>{student.gender}</td>
              </tr>

              <tr>
                <td>Birth Date</td>
                <td>{new Date(student.birth_date).toLocaleDateString()}</td>
              </tr>

              <tr>
                <td>Contact</td>
                <td>{student.contact_number}</td>
              </tr>

              <tr>
                <td>Admission Date</td>
                <td>{new Date(student.admission_date).toLocaleDateString()}</td>
              </tr>

            </tbody>

          </table>

        </div>

        <div className="modal-actions">

          <button
            className="approve-btn"
            onClick={onClose}
          >
            Close
          </button>

        </div>

      </div>

    </div>
  );
}