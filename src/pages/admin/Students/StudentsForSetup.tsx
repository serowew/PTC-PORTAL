import { useEffect, useState } from "react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/studentsForSetup.css";
import { useNavigate } from "react-router-dom";



type SetupStudent = {
  student_id: number;
  user_id: number | null;
  student_number: string;

  first_name: string;
  middle_name: string | null;
  last_name: string;

  gender: string | null;
  birth_date: string | null;
  contact_number: string | null;

  course_id: number;
  course_code: string;
  course_name: string;

  year_level: number;

  section_id: number | null;
  section_name: string;

  academic_year_id: number;
  academic_year: string;

  semester_id: number | null;
  semester_name: string | null;

  admission_date: string | null;
};

const API_URL =
  "http://localhost:3000/api/students/needs-setup";

export default function StudentsForSetup() {
  const navigate = useNavigate();
  const user = authService.getSession();

  const [students, setStudents] = useState<SetupStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

useEffect(() => {
  if (!user || user.role !== "Admin") {
    navigate("/login");
    return;
  }

  loadStudents();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

  async function loadStudents() {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(API_URL);

      if (!response.ok) {
        throw new Error("Failed to load students for setup.");
      }

      const data = await response.json();

      setStudents(data.students ?? []);
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Failed to load students for setup."
      );
    } finally {
      setLoading(false);
    }
  }

function handleManage(student: SetupStudent) {
  navigate(`/admin/students/setup/${student.student_number}`);
}

  if (!user || user.role !== "Admin") {
    return null;
  }

  return (
    <DashboardLayout>
      <div className="students-setup-page">

        <div className="students-setup-header">
          <div>
            <h1>Students for Setup</h1>

            <p>
              Newly approved students who still need
              account, email, section, and semester setup.
            </p>
          </div>

          <div className="students-setup-count">
            {students.length}
          </div>
        </div>

        {error && (
          <div className="students-setup-error">
            {error}
          </div>
        )}

        {loading ? (
          <div className="students-setup-loading">
            Loading students...
          </div>
        ) : students.length === 0 ? (
          <div className="students-setup-empty">
            <h2>No students for setup</h2>

            <p>
              All approved students have been processed.
            </p>
          </div>
        ) : (
          <div className="students-setup-table-wrapper">
            <table className="students-setup-table">

              <thead>
                <tr>
                  <th>Student ID</th>
                  <th>Name</th>
                  <th>Program</th>
                  <th>Year</th>
                  <th>Section</th>
                  <th>Account</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {students.map((student) => (
                  <tr key={student.student_id}>

                    <td>
                      <strong>
                        {student.student_number}
                      </strong>
                    </td>

                    <td>
                      {student.first_name}{" "}
                      {student.middle_name
                        ? `${student.middle_name} `
                        : ""}
                      {student.last_name}
                    </td>

                    <td>
                      <span className="program-code">
                        {student.course_code}
                      </span>

                      <small>
                        {student.course_name}
                      </small>
                    </td>

                    <td>
                      {student.year_level}
                      {student.year_level === 1
                        ? "st"
                        : student.year_level === 2
                        ? "nd"
                        : student.year_level === 3
                        ? "rd"
                        : "th"}{" "}
                      Year
                    </td>

                    <td>
                      <span className="not-assigned">
                        {student.section_name ||
                          "Not Assigned"}
                      </span>
                    </td>

                    <td>
                      <span className="setup-status">
                        Setup Required
                      </span>
                    </td>

                    <td>
                      <button
                        type="button"
                        className="setup-manage-button"
                        onClick={() =>
                          handleManage(student)
                        }
                      >
                        Manage
                      </button>
                    </td>

                  </tr>
                ))}
              </tbody>

            </table>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}