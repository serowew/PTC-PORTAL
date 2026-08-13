import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/RegistrarAcademicRecord.css";

// =====================================================
// API
// =====================================================

const API_BASE_URL = "http://localhost:3000/api/registrar/students";

// =====================================================
// TYPES
// =====================================================

interface Student {
  student_id: number;
  student_number: string;

  first_name: string;
  middle_name: string | null;
  last_name: string;

  course_code: string;

  year_level: number;

  section_name: string;

  semester_name: string;

  status: string;
}

interface AcademicRecord {
  enrollment_id: number;

  academic_year: string;

  semester_id: number;
  semester_name: string;

  enrollment_status: string;

  subject_id: number;

  subject_code: string;
  subject_name: string;

  units: number;

  subject_status: string;

  prelim_grade: number | null;
  midterm_grade: number | null;
  final_grade: number | null;

  remarks: string | null;
}

interface AcademicResponse {
  success: boolean;

  message?: string;

  student: Student;

  totalSubjects: number;

  records: AcademicRecord[];
}

// =====================================================
// COMPONENT
// =====================================================

export default function AcademicRecordsR() {
  const navigate = useNavigate();

  const { id } = useParams();

  const user = authService.getSession();

  // =====================================================
  // STATES
  // =====================================================

  const [student, setStudent] = useState<Student | null>(null);

  const [records, setRecords] = useState<AcademicRecord[]>([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  // =====================================================
  // FETCH RECORDS
  // =====================================================

  const fetchAcademicRecords = async () => {
    try {
      setLoading(true);

      setError("");

      const response = await fetch(`${API_BASE_URL}/${id}/academic-records`);

      const data: AcademicResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to load academic records.");
      }

      setStudent(data.student);

      setRecords(data.records);
    } catch (err) {
      console.error(err);

      setError("Unable to load academic records.");
    } finally {
      setLoading(false);
    }
  };

  // =====================================================
  // LOAD DATA
  // =====================================================

  useEffect(() => {
    if (id) {
      fetchAcademicRecords();
    }
  }, [id]);

  // =====================================================
  // COMPUTE TOTAL UNITS
  // =====================================================

  const totalUnits = useMemo(() => {
    return records.reduce((total, subject) => total + Number(subject.units), 0);
  }, [records]);

  // =====================================================
  // AUTH
  // =====================================================

  useEffect(() => {
    if (!user || user.role !== "Registrar") {
      navigate("/login");
    }
  }, [navigate, user]);

  if (!user || user.role !== "Registrar") {
    return null;
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <DashboardLayout>
      <div className="registrar-acadRecR-container">
        {/* ===================================================== */}
        {/* HEADER */}
        {/* ===================================================== */}

        <div className="registrar-acadRecR-header">
          <div>
            <h1>Academic Records</h1>

            <p>
              View the complete academic history and enrolled subjects of the
              selected student.
            </p>
          </div>
        </div>

        {/* ===================================================== */}
        {/* LOADING */}
        {/* ===================================================== */}

        {loading && (
          <div className="details-message">Loading academic records...</div>
        )}

        {/* ===================================================== */}
        {/* ERROR */}
        {/* ===================================================== */}

        {!loading && error && (
          <div className="details-message error">{error}</div>
        )}

        {/* ===================================================== */}
        {/* CONTENT */}
        {/* ===================================================== */}

        {!loading && !error && student && (
          <>
            {/* STUDENT SUMMARY */}

            <div className="student-summary-card">
              <div className="student-summary-left">
                <div className="student-avatar">
                  {student.first_name.charAt(0)}
                </div>

                <div>
                  <h2>
                    {student.first_name}{" "}
                    {student.middle_name
                      ? `${student.middle_name.charAt(0)}. `
                      : ""}
                    {student.last_name}
                  </h2>

                  <p>{student.student_number}</p>

                  <span
                    className={`status ${student.status
                      .toLowerCase()
                      .replace(/\s+/g, "-")}`}
                  >
                    {student.status}
                  </span>
                </div>
              </div>

              <div className="student-summary-right">
                <div className="summary-item">
                  <span>Course</span>
                  <strong>{student.course_code}</strong>
                </div>

                <div className="summary-item">
                  <span>Year Level</span>
                  <strong>Year {student.year_level}</strong>
                </div>

                <div className="summary-item">
                  <span>Section</span>
                  <strong>{student.section_name}</strong>
                </div>

                <div className="summary-item">
                  <span>Semester</span>
                  <strong>{student.semester_name}</strong>
                </div>
              </div>
            </div>

            {/* STATISTICS */}

            <div className="academic-statistics">
              <div className="academic-card">
                <span>Total Subjects</span>
                <h2>{records.length}</h2>
              </div>

              <div className="academic-card">
                <span>Total Units</span>
                <h2>{totalUnits}</h2>
              </div>

              <div className="academic-card">
                <span>Current Status</span>
                <h2>{student.status}</h2>
              </div>
            </div>

            {/* TABLE */}

            <div className="records-card">
              <h3>Academic History</h3>

              <div className="records-table-wrapper">
                <table className="records-table">
                  <thead>
                    <tr>
                      <th>Academic Year</th>
                      <th>Semester</th>
                      <th>Subject Code</th>
                      <th>Subject Name</th>
                      <th>Units</th>
                      <th>Enrollment</th>
                      <th>Subject Status</th>
                      <th>Prelim</th>
                      <th>Midterm</th>
                      <th>Final</th>
                      <th>Remarks</th>
                    </tr>
                  </thead>

                  <tbody>
                    {records.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="table-message">
                          No academic records found.
                        </td>
                      </tr>
                    ) : (
                      records.map((record, index) => (
                        <tr
                          key={`${record.enrollment_id}-${record.subject_id}-${index}`}
                        >
                          <td>{record.academic_year}</td>
                          <td>{record.semester_name}</td>
                          <td>{record.subject_code}</td>
                          <td>{record.subject_name}</td>
                          <td>{record.units}</td>

                          <td>
                            <span
                              className={`status ${record.enrollment_status
                                .toLowerCase()
                                .replace(/\s+/g, "-")}`}
                            >
                              {record.enrollment_status}
                            </span>
                          </td>

                          <td>
                            <span
                              className={`status ${record.subject_status
                                .toLowerCase()
                                .replace(/\s+/g, "-")}`}
                            >
                              {record.subject_status}
                            </span>
                          </td>

                          <td>{record.prelim_grade ?? "-"}</td>
                          <td>{record.midterm_grade ?? "-"}</td>
                          <td>{record.final_grade ?? "-"}</td>
                          <td>{record.remarks ?? "-"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ACTION BUTTONS */}

            <div className="records-actions">
              <button
                className="back-btn"
                onClick={() =>
                  navigate(`/registrar/student/DetailsR/${student.student_id}`)
                }
              >
                Go to Student Profile
              </button>

              <button
                className="transcript-btn"
                onClick={() =>
                  navigate(
                    `/registrar/student/${student.student_id}/transcriptR`,
                  )
                }
              >
                View Transcript
              </button>

              <button
                className="document-btn"
                onClick={() =>
                  navigate(
                    `/registrar/student/${student.student_id}/DocumentsR`,
                  )
                }
              >
                Go to Student Documents
              </button>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
