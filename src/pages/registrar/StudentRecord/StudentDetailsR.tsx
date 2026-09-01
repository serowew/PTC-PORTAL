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
// =====================================================

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
  error?: string;
  student: Student;
}

// =====================================================
// COMPONENT
// =====================================================

export default function StudentDetailsR() {
  const navigate = useNavigate();

  const { id } = useParams<{ id: string }>();

  // =====================================================
  // AUTHENTICATION
  // =====================================================

  const user = authService.getSession();

  const token = authService.getToken();

  const userRole = user?.role;

  const authenticated = Boolean(user && token);

  // =====================================================
  // STATES
  // =====================================================

  const [student, setStudent] = useState<Student | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  // =====================================================
  // AUTHORIZATION
  // =====================================================

  useEffect(() => {
    // No local session or no JWT
    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    // Logged in but wrong role
    if (userRole !== "Registrar") {
      if (user) {
        navigate(authService.getDashboardRoute(user.role), {
          replace: true,
        });
      } else {
        navigate("/login", {
          replace: true,
        });
      }
    }
  }, [authenticated, userRole, user, navigate]);

  // =====================================================
  // FETCH STUDENT
  // =====================================================

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") {
      return;
    }

    if (!id) {
      setError("Invalid student ID.");

      setLoading(false);

      return;
    }

    const studentId = Number(id);

    if (!Number.isInteger(studentId) || studentId <= 0) {
      setError("Invalid student ID.");

      setLoading(false);

      return;
    }

    const controller = new AbortController();

    const fetchStudent = async () => {
      try {
        setLoading(true);

        setError("");

        const requestUrl = `${API_BASE_URL}/${studentId}`;

        console.log("GET REGISTRAR STUDENT DETAILS:", requestUrl);

        // =============================================
        // JWT AUTHENTICATED REQUEST
        //
        // authFetch automatically adds:
        //
        // Authorization: Bearer <JWT>
        // =============================================

        const response = await authService.authFetch(requestUrl, {
          method: "GET",

          signal: controller.signal,

          headers: {
            Accept: "application/json",
          },
        });

        // =============================================
        // SAFE RESPONSE READ
        // =============================================

        const contentType = response.headers.get("content-type") || "";

        let data: StudentResponse | null = null;

        if (contentType.includes("application/json")) {
          data = await response.json();
        } else {
          const text = await response.text();

          throw new Error(
            `Server returned a non-JSON response (${response.status}): ${text.slice(
              0,
              200,
            )}`,
          );
        }

        // =============================================
        // 401
        // Missing / expired / invalid JWT
        // =============================================

        if (response.status === 401) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

          return;
        }

        // =============================================
        // 403
        // JWT valid, but role is not Registrar
        // =============================================

        if (response.status === 403) {
          throw new Error(
            data?.message || "You are not authorized to view this student.",
          );
        }

        // =============================================
        // HTTP ERROR
        // =============================================

        if (!response.ok) {
          throw new Error(
            data?.message ||
              data?.error ||
              `Unable to load student (${response.status}).`,
          );
        }

        // =============================================
        // API ERROR
        // =============================================

        if (!data?.success) {
          throw new Error(data?.message || "Failed to load student.");
        }

        // =============================================
        // SUCCESS
        // =============================================

        setStudent(data.student);
      } catch (err) {
        // Ignore aborted request
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        console.error("GET STUDENT DETAILS ERROR:", err);

        setStudent(null);

        if (err instanceof TypeError) {
          setError(
            "Unable to connect to the student records server. Make sure the backend is running on port 3000.",
          );

          return;
        }

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load student information.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void fetchStudent();

    return () => {
      controller.abort();
    };
  }, [id, authenticated, userRole, navigate]);

  // =====================================================
  // AUTH RENDER GUARD
  // =====================================================

  if (!authenticated || !user || userRole !== "Registrar") {
    return null;
  }

  // =====================================================
  // HELPERS
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
        {/* =====================================================
            HEADER
        ===================================================== */}

        <div className="registrar-detailsR-header">
          <div>
            <h1>Student Profile</h1>

            <p>View complete student information and academic details.</p>
          </div>

          <button
            type="button"
            className="back-btn"
            onClick={() => navigate("/registrar/student/listR")}
          >
            ← Back to Student List
          </button>
        </div>

        {/* =====================================================
            LOADING
        ===================================================== */}

        {loading && (
          <div className="details-message">Loading student information...</div>
        )}

        {/* =====================================================
            ERROR
        ===================================================== */}

        {!loading && error && (
          <div className="details-message error">{error}</div>
        )}

        {/* =====================================================
            STUDENT DETAILS
        ===================================================== */}

        {!loading && !error && student && (
          <>
            {/* ================================================
                  PROFILE CARD
              ================================================ */}

            <div className="student-profile-card">
              <div className="student-profile-left">
                <div className="student-profile-avatar">
                  {student.first_name?.charAt(0).toUpperCase() || "S"}
                </div>

                <div className="student-profile-info">
                  <h2>{fullName}</h2>

                  <p>{student.student_number}</p>

                  <span
                    className={`status ${(student.status || "")
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

                  <strong>{student.section_name || "Not Assigned"}</strong>
                </div>

                <div className="profile-item">
                  <span>Semester</span>

                  <strong>{student.semester_name || "—"}</strong>
                </div>
              </div>
            </div>

            {/* ================================================
                  PERSONAL INFORMATION
              ================================================ */}

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

                  <p>{student.gender || "-"}</p>
                </div>

                <div className="details-item">
                  <label>Birth Date</label>

                  <p>
                    {student.birth_date
                      ? new Date(student.birth_date).toLocaleDateString("en-PH")
                      : "-"}
                  </p>
                </div>

                <div className="details-item">
                  <label>Contact Number</label>

                  <p>{student.contact_number || "-"}</p>
                </div>

                <div className="details-item">
                  <label>Email Address</label>

                  <p>{student.email || "-"}</p>
                </div>
              </div>
            </div>

            {/* ================================================
                  ACADEMIC INFORMATION
              ================================================ */}

            <div className="details-card">
              <h3>Academic Information</h3>

              <div className="details-grid">
                <div className="details-item">
                  <label>Student Number</label>

                  <p>{student.student_number}</p>
                </div>

                <div className="details-item">
                  <label>Course</label>

                  <p>{student.course_code || "-"}</p>
                </div>

                <div className="details-item">
                  <label>Year Level</label>

                  <p>Year {student.year_level}</p>
                </div>

                <div className="details-item">
                  <label>Section</label>

                  <p>{student.section_name || "Not Assigned"}</p>
                </div>

                <div className="details-item">
                  <label>Semester</label>

                  <p>{student.semester_name || "-"}</p>
                </div>

                <div className="details-item">
                  <label>Status</label>

                  <p>{student.status}</p>
                </div>
              </div>
            </div>

            {/* ================================================
                  ADDRESS INFORMATION
              ================================================ */}

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

            {/* ================================================
                  ACTION BUTTONS
              ================================================ */}
            <div className="details-actions">
              <button
                type="button"
                className="record-btn"
                onClick={() =>
                  navigate(`/registrar/student/${student.student_id}/AcadRecR`)
                }
              >
                Go to Academic Records
              </button>

              <button
                type="button"
                className="document-btn"
                onClick={() =>
                  navigate(
                    `/registrar/student/${student.student_id}/DocumentsR`,
                  )
                }
              >
                Go to Student COG
              </button>

              <button
                type="button"
                className="record-btn"
                onClick={() =>
                  navigate(
                    `/registrar/student/${student.student_id}/TransferEvaluationR`,
                  )
                }
              >
                Transfer Evaluation
              </button>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
