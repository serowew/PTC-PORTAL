import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/RegistrarStudentDetails.css";

// =====================================================
// API
// =====================================================

const API_BASE_URL = "http://localhost:3000/api/registrar/students";

// =====================================================
// TYPES
// ============================/=========================

interface Student {
  student_id: number;
  student_number: string;

  first_name: string;
  middle_name: string | null;
  last_name: string;

  gender: string;
  birth_date: string;

  contact_number: string;

  email: string;

  course_id: number;
  course_code: string;

  year_level: number;

  section_id: number;
  section_name: string;

  semester_id: number;
  semester_name: string;

  status: string;

  house_no: string | null;
  street: string | null;
  barangay: string | null;
  city: string | null;
  province: string | null;
  zip_code: string | null;
}

interface StudentResponse {
  success: boolean;
  message?: string;
  student: Student;
}

// =====================================================
// COMPONENT
// =====================================================

export default function StudentDetailsR() {
  const navigate = useNavigate();
  const { id } = useParams();

  const user = authService.getSession();

  // =====================================================
  // STATES
  // =====================================================

  const [student, setStudent] = useState<Student | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  // =====================================================
  // FETCH STUDENT
  // =====================================================

  const fetchStudent = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(`${API_BASE_URL}/${id}`, {
        method: "GET",
      });

      const data: StudentResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to load student.");
      }

      setStudent(data.student);
    } catch (err) {
      console.error(err);

      setError("Unable to load student information.");
    } finally {
      setLoading(false);
    }
  };

  // =====================================================
  // LOAD STUDENT
  // =====================================================

  useEffect(() => {
    if (id) {
      fetchStudent();
    }
  }, [id]);

  // =====================================================
  // AUTHENTICATION
  // =====================================================

  useEffect(() => {
    if (!user || user.role !== "Registrar") {
      navigate("/login");
    }
  }, [user, navigate]);

  if (!user || user.role !== "Registrar") {
    return null;
  }

  // =====================================================
  // HELPER
  // =====================================================

  const fullName = student
    ? `${student.first_name} ${
        student.middle_name ? `${student.middle_name.charAt(0)}. ` : ""
      }${student.last_name}`
    : "";

  const fullAddress = student
    ? [
        student.house_no,
        student.street,
        student.barangay,
        student.city,
        student.province,
        student.zip_code,
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <DashboardLayout>
      <div className="registrar-detailsR-container">
        {/* ===================================================== */}
        {/* HEADER */}
        {/* ===================================================== */}

        <div className="registrar-detailsR-header">
          <div>
            <h1>Student Profile</h1>

            <p>View complete student information and academic details.</p>
          </div>

          <button
            className="back-btn"
            onClick={() => navigate("/registrar/student/listR")}
          >
            ← Back to Student List
          </button>
        </div>

        {/* ===================================================== */}
        {/* LOADING */}
        {/* ===================================================== */}

        {loading && (
          <div className="details-message">Loading student information...</div>
        )}

        {/* ===================================================== */}
        {/* ERROR */}
        {/* ===================================================== */}

        {!loading && error && (
          <div className="details-message error">{error}</div>
        )}

        {/* ===================================================== */}
        {/* STUDENT DETAILS */}
        {/* ===================================================== */}

        {!loading && !error && student && (
          <>
            {/* ================================================ */}
            {/* PROFILE CARD */}
            {/* ================================================ */}

            <div className="student-profile-card">
              <div className="student-profile-left">
                <div className="student-profile-avatar">
                  {student.first_name.charAt(0)}
                </div>

                <div className="student-profile-info">
                  <h2>{fullName}</h2>

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

              <div className="student-profile-right">
                <div className="profile-item">
                  <span>Course</span>

                  <strong>{student.course_code}</strong>
                </div>

                <div className="profile-item">
                  <span>Year Level</span>

                  <strong>Year {student.year_level}</strong>
                </div>

                <div className="profile-item">
                  <span>Section</span>

                  <strong>{student.section_name}</strong>
                </div>

                <div className="profile-item">
                  <span>Semester</span>

                  <strong>{student.semester_name}</strong>
                </div>
              </div>
            </div>

            {/* ================================================ */}
            {/* PERSONAL INFORMATION */}
            {/* ================================================ */}

            <div className="details-card">
              <h3>Personal Information</h3>

              <div className="details-grid">
                <div className="details-item">
                  <label>First Name</label>

                  <p>{student.first_name}</p>
                </div>

                <div className="details-item">
                  <label>Middle Name</label>

                  <p>{student.middle_name || "-"}</p>
                </div>

                <div className="details-item">
                  <label>Last Name</label>

                  <p>{student.last_name}</p>
                </div>

                <div className="details-item">
                  <label>Gender</label>

                  <p>{student.gender}</p>
                </div>

                <div className="details-item">
                  <label>Birth Date</label>

                  <p>{new Date(student.birth_date).toLocaleDateString()}</p>
                </div>

                <div className="details-item">
                  <label>Contact Number</label>

                  <p>{student.contact_number}</p>
                </div>

                <div className="details-item">
                  <label>Email Address</label>

                  <p>{student.email}</p>
                </div>
              </div>
            </div>
            {/* ================================================ */}
            {/* ACADEMIC INFORMATION */}
            {/* ================================================ */}

            <div className="details-card">
              <h3>Academic Information</h3>

              <div className="details-grid">
                <div className="details-item">
                  <label>Student Number</label>

                  <p>{student.student_number}</p>
                </div>

                <div className="details-item">
                  <label>Course</label>

                  <p>{student.course_code}</p>
                </div>

                <div className="details-item">
                  <label>Year Level</label>

                  <p>Year {student.year_level}</p>
                </div>

                <div className="details-item">
                  <label>Section</label>

                  <p>{student.section_name}</p>
                </div>

                <div className="details-item">
                  <label>Semester</label>

                  <p>{student.semester_name}</p>
                </div>

                <div className="details-item">
                  <label>Status</label>

                  <p>{student.status}</p>
                </div>
              </div>
            </div>

            {/* ================================================ */}
            {/* ADDRESS INFORMATION */}
            {/* ================================================ */}

            <div className="details-card">
              <h3>Address Information</h3>

              <div className="details-grid">
                <div className="details-item">
                  <label>House No.</label>

                  <p>{student.house_no || "-"}</p>
                </div>

                <div className="details-item">
                  <label>Street</label>

                  <p>{student.street || "-"}</p>
                </div>

                <div className="details-item">
                  <label>Barangay</label>

                  <p>{student.barangay || "-"}</p>
                </div>

                <div className="details-item">
                  <label>City</label>

                  <p>{student.city || "-"}</p>
                </div>

                <div className="details-item">
                  <label>Province</label>

                  <p>{student.province || "-"}</p>
                </div>

                <div className="details-item">
                  <label>ZIP Code</label>

                  <p>{student.zip_code || "-"}</p>
                </div>

                <div className="details-item full-width">
                  <label>Complete Address</label>

                  <p>{fullAddress || "-"}</p>
                </div>
              </div>
            </div>

            {/* ================================================ */}
            {/* ACTION BUTTONS */}
            {/* ================================================ */}

            <div className="details-actions">
              <button
                className="record-btn"
                onClick={() =>
                  navigate(`/registrar/student/${student.student_id}/AcadRecR`)
                }
              >
                Go to Academic Records
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
