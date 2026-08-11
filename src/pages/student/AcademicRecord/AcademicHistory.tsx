import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/grades.css";

interface AcademicHistoryRecord {
  academicYear: string;
  semester: string;
  subjectsTaken: string;
  units: number;
  finalGrades: string;
  remarks: string;
  semesterGwa: string;
}

interface AcademicHistoryResponse {
  student: {
    studentNumber: string;
    name: string;
    course: string;
    yearLevel: string;
    section: string;
  };
  records: AcademicHistoryRecord[];
}

export function AcademicHistoryContent() {
  const navigate = useNavigate();
  const user = authService.getSession();
  const [data, setData] = useState<AcademicHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || user.role !== "Student") {
      navigate("/login");
      return;
    }

    void loadAcademicHistory();
  }, [navigate, user]);

  const loadAcademicHistory = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/academic-history", {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error("Unable to load academic history records.");
      }

      const payload = (await response.json()) as AcademicHistoryResponse;
      setData(payload);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while loading academic history.",
      );
      setData(null);
    } finally {
      setIsLoading(false);
    }
  };

  const orderedRecords = useMemo(() => {
    return [...(data?.records ?? [])].sort((a, b) => {
      const yearCompare = Number(b.academicYear.split("-")[0]) - Number(a.academicYear.split("-")[0]);
      if (yearCompare !== 0) return yearCompare;
      return b.semester.localeCompare(a.semester);
    });
  }, [data]);

  if (!user || user.role !== "Student") return null;

  return (
    <>
      {isLoading ? (
          <div className="alert-card centered-card">
            <div className="loading-circle" aria-hidden="true" />
            <p>Loading academic history...</p>
          </div>
        ) : error ? (
          <div className="alert-card">
            <h2>Unable to load academic history</h2>
            <p>{error}</p>
          </div>
        ) : !data ? (
          <div className="alert-card">
            <h2>No academic history available</h2>
            <p>Academic history will appear here once the backend data is available.</p>
          </div>
        ) : (
          <>
            <section className="profile-card">
              <div className="section-header">
                <div>
                  <p className="profile-eyebrow">Student Information</p>
                  <h2>{data.student.name}</h2>
                </div>
              </div>

              <div className="info-grid">
                <div className="info-card">
                  <p className="info-label">Student Number</p>
                  <strong>{data.student.studentNumber}</strong>
                </div>
                <div className="info-card">
                  <p className="info-label">Course</p>
                  <strong>{data.student.course}</strong>
                </div>
                <div className="info-card">
                  <p className="info-label">Year Level</p>
                  <strong>{data.student.yearLevel}</strong>
                </div>
                <div className="info-card">
                  <p className="info-label">Section</p>
                  <strong>{data.student.section}</strong>
                </div>
              </div>
            </section>

            <section className="profile-card">
              <div className="section-header">
                <div>
                  <p className="profile-eyebrow">Academic History</p>
                  <h2>Chronological record of completed terms</h2>
                </div>
              </div>

              <div className="student-table-wrap">
                <table className="student-table">
                  <thead>
                    <tr>
                      <th>Academic Year</th>
                      <th>Semester</th>
                      <th>Subjects Taken</th>
                      <th>Units</th>
                      <th>Final Grades</th>
                      <th>Remarks</th>
                      <th>Semester GWA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderedRecords.map((record, index) => (
                      <tr key={`${record.academicYear}-${record.semester}-${index}`}>
                        <td>{record.academicYear}</td>
                        <td>{record.semester}</td>
                        <td>{record.subjectsTaken}</td>
                        <td>{record.units}</td>
                        <td>{record.finalGrades}</td>
                        <td>{record.remarks}</td>
                        <td>{record.semesterGwa}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
    </>
  );
}

export default function AcademicHistory() {
  return (
    <DashboardLayout>
      <AcademicHistoryContent />
    </DashboardLayout>
  );
}
