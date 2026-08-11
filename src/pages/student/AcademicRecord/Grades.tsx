import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/grades.css";

interface StudentGrade {
  subjectCode: string;
  subjectName: string;
  units: number;
  midterm: number | string | null;
  final: number | string | null;
  finalGrade: number | string | null;
  remarks: string;
}

interface StudentInfo {
  studentNumber: string;
  name: string;
  course: string;
  yearLevel: string;
  section: string;
  enrollmentStatus?: string;
}

interface GradesResponse {
  student: StudentInfo;
  academicYear: string;
  semester: string;
  grades: StudentGrade[];
}

const academicYearOptions = ["2025-2026", "2026-2027"];
const semesterOptions = ["First Semester", "Second Semester", "Summer"];

function formatGrade(value: number | string | null) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  const numericValue = Number(value);

  if (Number.isNaN(numericValue)) {
    return "—";
  }

  return numericValue.toFixed(2);
}

function getRemarkClass(remark: string) {
  const normalized = remark.toLowerCase();

  if (normalized.includes("passed")) return "status-pill passed";
  if (normalized.includes("failed")) return "status-pill failed";
  if (normalized.includes("incomplete")) return "status-pill incomplete";
  if (normalized.includes("drop")) return "status-pill dropped";

  return "status-pill neutral";
}

function getEnrollmentClass(status?: string) {
  const normalized = status?.toLowerCase() ?? "enrolled";

  if (normalized.includes("enroll") || normalized.includes("active")) {
    return "status-pill active";
  }

  if (normalized.includes("graduate") || normalized.includes("graduated")) {
    return "status-pill passed";
  }

  if (
    normalized.includes("suspend") ||
    normalized.includes("inactive") ||
    normalized.includes("drop")
  ) {
    return "status-pill failed";
  }

  if (normalized.includes("leave")) {
    return "status-pill incomplete";
  }

  return "status-pill neutral";
}

export default function Grades() {
  const navigate = useNavigate();
  const user = authService.getSession();

  console.log("User Session:", user);

  const [academicYear, setAcademicYear] = useState("2026-2027");
  const [semester, setSemester] = useState("First Semester");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<GradesResponse | null>(null);

  useEffect(() => {
    if (!user || user.role !== "Student") {
      navigate("/login");
      return;
    }

    const loadGrades = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();

        params.set("studentId", String(user.student_id));
        params.set("academicYear", academicYear);
        params.set("semester", semester);

        console.log(user);
        console.log("student_id =", user.student_id);
        console.log("user_id =", user.user_id);

        const response = await fetch(`/api/grades${params.toString() ? `?${params.toString()}` : ""}`, {
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error("Unable to load your grade records.");
        }

        const payload = (await response.json()) as GradesResponse;
        setData(payload);
      } catch (err) {
        setData(null);
        setError(
          err instanceof Error
            ? err.message
            : "Something went wrong while loading your grades.",
        );
      } finally {
        setIsLoading(false);
      }
    };

    void loadGrades();
  }, [academicYear, navigate, semester]);

  const summary = useMemo(() => {
    if (!data?.grades?.length) {
      return {
        totalUnits: 0,
        semesterGwa: null as string | null,
        academicStatus: "No published grades",
      };
    }

    const totalUnits = data.grades.reduce((sum, grade) => sum + grade.units, 0);
    const weightedSum = data.grades.reduce(
      (sum, grade) => sum + (grade.finalGrade ?? 0) * grade.units,
      0,
    );
    const semesterGwa = totalUnits > 0 ? weightedSum / totalUnits : null;

    let academicStatus = "Good Standing";
    if (data.grades.some((grade) => grade.remarks.toLowerCase().includes("failed"))) {
      academicStatus = "Needs Improvement";
    } else if (data.grades.some((grade) => grade.remarks.toLowerCase().includes("incomplete"))) {
      academicStatus = "Incomplete Requirements";
    }

    return {
      totalUnits,
      semesterGwa: semesterGwa !== null ? semesterGwa.toFixed(2) : null,
      academicStatus,
    };
  }, [data]);

  if (!user || user.role !== "Student") return null;

  return (
    <DashboardLayout>
      <div className="grades-page">
        <div className="page-header">
          <div>
            <p className="page-eyebrow">Academic Records</p>
            <h1>Grades</h1>
            <p className="page-description">
              View your officially published grades. Only approved grades are displayed.
            </p>
          </div>
        </div>

        <section className="grades-filters">
          <div className="filter-field">
            <label htmlFor="academic-year">Academic Year</label>
            <select
              id="academic-year"
              value={academicYear}
              onChange={(event) => setAcademicYear(event.target.value)}
            >
              {academicYearOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-field">
            <label htmlFor="semester">Semester</label>
            <select
              id="semester"
              value={semester}
              onChange={(event) => setSemester(event.target.value)}
            >
              {semesterOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </section>

        {isLoading ? (
          <div className="status-card status-card--loading">
            <div className="loading-circle" aria-hidden="true" />
            <div>
              <h2>Loading your published grades...</h2>
            </div>
          </div>
        ) : error ? (
          <div className="status-card status-card--error">
            <h2>Unable to Load Grades</h2>
            <p>We couldn't retrieve your academic records.</p>
            <p>Please try again later or contact the Registrar if the issue persists.</p>
          </div>
        ) : !data || data.grades.length === 0 ? (
          <div className="status-card status-card--empty">
            <h2>No Grades Available</h2>
            <p>
              Your grades for the selected semester have not yet been published. Grades will appear
              here after they have been approved by the Program Head.
            </p>
          </div>
        ) : (
          <>
            <section className="student-card">
              <div className="card-header">
                <div>
                  <p className="section-eyebrow">Student Information</p>
                  <h2>{data.student.name}</h2>
                </div>
                <span className={getEnrollmentClass(data.student.enrollmentStatus)}>
                  {data.student.enrollmentStatus ?? "Enrolled"}
                </span>
              </div>

              <div className="student-info-grid">
                <div className="student-info-item">
                  <p>Student Number</p>
                  <strong>{data.student.studentNumber}</strong>
                </div>
                <div className="student-info-item">
                  <p>Course</p>
                  <strong>{data.student.course}</strong>
                </div>
                <div className="student-info-item">
                  <p>Year Level</p>
                  <strong>{data.student.yearLevel}</strong>
                </div>
                <div className="student-info-item">
                  <p>Section</p>
                  <strong>{data.student.section}</strong>
                </div>
                <div className="student-info-item">
                  <p>Enrollment Status</p>
                  <strong>{data.student.enrollmentStatus ?? "Enrolled"}</strong>
                </div>
              </div>
            </section>

            <section className="performance-card">
              <div className="card-header">
                <div>
                  <p className="section-eyebrow">Semester Performance</p>
                  <h2>{data.academicYear} • {data.semester}</h2>
                </div>
              </div>

              <div className="performance-grid">
                <div className="performance-item">
                  <p>Semester GWA</p>
                  <strong>{summary.semesterGwa ?? "—"}</strong>
                </div>
                <div className="performance-item">
                  <p>Total Units</p>
                  <strong>{summary.totalUnits}</strong>
                </div>
                <div className="performance-item">
                  <p>Academic Standing</p>
                  <strong>{summary.academicStatus}</strong>
                </div>
              </div>
            </section>

            <section className="grades-table-card">
              <div className="card-header">
                <div>
                  <p className="section-eyebrow">Published Grades Table</p>
                  <h2>Officially Published Grades</h2>
                </div>
              </div>

              <div className="grades-table-wrapper">
                <table className="grades-table">
                  <thead>
                    <tr>
                      <th>Subject Code</th>
                      <th>Subject Title</th>
                      <th>Units</th>
                      <th>Midterm Grade</th>
                      <th>Final Grade</th>
                      <th>Final Rating</th>
                      <th>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.grades.map((grade) => (
                      <tr key={`${grade.subjectCode}-${grade.subjectName}`}>
                        <td className="subject-code-cell">{grade.subjectCode}</td>
                        <td className="subject-title-cell">{grade.subjectName}</td>
                        <td>{grade.units}</td>
                        <td>{formatGrade(grade.midterm)}</td>
                        <td>{formatGrade(grade.final)}</td>
                        <td>
                          <strong>{formatGrade(grade.finalGrade)}</strong>
                        </td>
                        <td>
                          <span className={getRemarkClass(grade.remarks)}>{grade.remarks}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
