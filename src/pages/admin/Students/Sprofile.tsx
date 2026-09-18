import { useEffect, useState } from "react";

import { useNavigate, useParams } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";

import { authService } from "../../../services/auth.service";

import "../../../styles/StudentProfile.css";

const API_BASE_URL = "http://localhost:3000/api/students";

interface Student {
  studentId: number;
  id: string;

  firstName: string;
  middleName?: string;
  lastName: string;

  email: string;
  gender?: string;
  birthDate?: string;
  contactNumber?: string;

  course: string;
  yearLevel: string;
  section: string;

  semester?: string;

  houseNo?: string;
  street?: string;
  barangay?: string;
  city?: string;
  province?: string;
  zipCode?: string;
}

interface StudentResponse {
  success?: boolean;
  data?: Student;
  student?: Student;
  message?: string;
  error?: string;
}

export default function Sprofile() {
  const navigate = useNavigate();

  const { id } = useParams<{
    id: string;
  }>();

  // =====================================================
  // AUTHENTICATION
  // =====================================================

  const user = authService.getSession();

  const token = authService.getToken();

  const userRole = user?.role;

  const authenticated = Boolean(user && token);

  // =====================================================
  // STATE
  // =====================================================

  const [student, setStudent] = useState<Student | null>(null);

  const [loading, setLoading] = useState(true);

  const [errorMessage, setErrorMessage] = useState("");

  // =====================================================
  // AUTHORIZATION
  // =====================================================

  useEffect(() => {
    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    if (userRole !== "Admin") {
      if (userRole) {
        navigate(authService.getDashboardRoute(userRole), {
          replace: true,
        });
      } else {
        navigate("/login", {
          replace: true,
        });
      }
    }
  }, [authenticated, userRole, navigate]);

  // =====================================================
  // LOAD STUDENT PROFILE
  // =====================================================

  useEffect(() => {
    if (!authenticated || userRole !== "Admin") {
      return;
    }

    if (!id) {
      setErrorMessage("Student ID is missing.");

      setLoading(false);

      return;
    }

    const studentNumber = id.trim();

    if (!studentNumber) {
      setErrorMessage("Invalid student ID.");

      setLoading(false);

      return;
    }

    const controller = new AbortController();

    const fetchStudent = async () => {
      try {
        setLoading(true);

        setErrorMessage("");

        // =================================================
        // JWT AUTHENTICATED REQUEST
        // =================================================

        const response = await authService.authFetch(
          `${API_BASE_URL}/${encodeURIComponent(studentNumber)}`,
          {
            method: "GET",

            signal: controller.signal,

            headers: {
              Accept: "application/json",
            },
          },
        );

        // =================================================
        // SAFE RESPONSE
        // =================================================

        const contentType = response.headers.get("content-type") || "";

        let data: Student | StudentResponse | null = null;

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

        // =================================================
        // 401
        // =================================================

        if (response.status === 401) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

          return;
        }

        // =================================================
        // 403
        // =================================================

        if (response.status === 403) {
          const responseObject = data && !("studentId" in data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              "You are not authorized to view this student.",
          );
        }

        // =================================================
        // HTTP ERROR
        // =================================================

        if (!response.ok) {
          const responseObject = data && !("studentId" in data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              `Failed to load student (${response.status}).`,
          );
        }

        // =================================================
        // NORMALIZE RESPONSE
        // =================================================

        let loadedStudent: Student | null = null;

        if (data && "studentId" in data) {
          loadedStudent = data as Student;
        } else if (data && data.student) {
          loadedStudent = data.student;
        } else if (data && data.data) {
          loadedStudent = data.data;
        }

        if (!loadedStudent) {
          throw new Error("Student data was not returned by the server.");
        }

        setStudent(loadedStudent);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        console.error("LOAD ADMIN STUDENT PROFILE ERROR:", error);

        setStudent(null);

        if (error instanceof TypeError) {
          setErrorMessage(
            "Unable to connect to the student server. Make sure the backend is running on port 3000.",
          );

          return;
        }

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to load student profile.",
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
  // AUTH GUARD
  // =====================================================

  if (!authenticated || !user || userRole !== "Admin") {
    return null;
  }

  // =====================================================
  // LOADING
  // =====================================================

  if (loading) {
    return (
      <DashboardLayout>
        <div className="admin-profile-students">
          <p>Loading student profile...</p>
        </div>
      </DashboardLayout>
    );
  }

  // =====================================================
  // ERROR
  // =====================================================

  if (errorMessage || !student) {
    return (
      <DashboardLayout>
        <div className="admin-profile-students">
          <button
            type="button"
            className="profile-back-button"
            onClick={() => navigate(-1)}
          >
            ← Back
          </button>

          <p className="profile-error">
            {errorMessage || "Student not found."}
          </p>
        </div>
      </DashboardLayout>
    );
  }

  // =====================================================
  // DERIVED VALUES
  // =====================================================

  const fullName = [student.firstName, student.middleName, student.lastName]
    .filter(Boolean)
    .join(" ");

  const birthDate = student.birthDate
    ? new Date(student.birthDate).toLocaleDateString()
    : "Not provided";

  const address = [
    student.houseNo,
    student.street,
    student.barangay,
    student.city,
    student.province,
    student.zipCode,
  ]
    .filter(Boolean)
    .join(", ");

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <DashboardLayout>
      <div className="admin-profile-students">
        {/* =================================================
            HEADER
        ================================================= */}

        <div className="profile-page-header">
          <button
            type="button"
            className="profile-back-button"
            onClick={() => navigate(-1)}
          >
            ← Back to Student List
          </button>

          <button
            type="button"
            className="profile-edit-button"
            onClick={() =>
              navigate(`/admin/students/editstudents/${student.id}`)
            }
          >
            Edit Student
          </button>
        </div>

        {/* =================================================
            PROFILE HEADER
        ================================================= */}

        <div className="profile-card profile-header-card">
          <div className="profile-avatar">
            {student.firstName?.charAt(0).toUpperCase()}

            {student.lastName?.charAt(0).toUpperCase()}
          </div>

          <div>
            <h1>{fullName}</h1>

            <p>Student ID: {student.id}</p>
          </div>
        </div>

        {/* =================================================
            PERSONAL INFORMATION
        ================================================= */}

        <div className="profile-card">
          <h2>Personal Information</h2>

          <div className="profile-grid">
            <div className="profile-field">
              <span>First Name</span>

              <strong>{student.firstName || "Not provided"}</strong>
            </div>

            <div className="profile-field">
              <span>Middle Name</span>

              <strong>{student.middleName || "Not provided"}</strong>
            </div>

            <div className="profile-field">
              <span>Last Name</span>

              <strong>{student.lastName || "Not provided"}</strong>
            </div>

            <div className="profile-field">
              <span>Gender</span>

              <strong>{student.gender || "Not provided"}</strong>
            </div>

            <div className="profile-field">
              <span>Birth Date</span>

              <strong>{birthDate}</strong>
            </div>

            <div className="profile-field">
              <span>Contact Number</span>

              <strong>{student.contactNumber || "Not provided"}</strong>
            </div>

            <div className="profile-field profile-full-width">
              <span>Email</span>

              <strong>{student.email || "Not provided"}</strong>
            </div>
          </div>
        </div>

        {/* =================================================
            ADDRESS
        ================================================= */}

        <div className="profile-card">
          <h2>Address</h2>

          <div className="profile-grid">
            <div className="profile-field">
              <span>House No.</span>

              <strong>{student.houseNo || "Not provided"}</strong>
            </div>

            <div className="profile-field">
              <span>Street</span>

              <strong>{student.street || "Not provided"}</strong>
            </div>

            <div className="profile-field">
              <span>Barangay</span>

              <strong>{student.barangay || "Not provided"}</strong>
            </div>

            <div className="profile-field">
              <span>City</span>

              <strong>{student.city || "Not provided"}</strong>
            </div>

            <div className="profile-field">
              <span>Province</span>

              <strong>{student.province || "Not provided"}</strong>
            </div>

            <div className="profile-field">
              <span>ZIP Code</span>

              <strong>{student.zipCode || "Not provided"}</strong>
            </div>

            <div className="profile-field profile-full-width">
              <span>Complete Address</span>

              <strong>{address || "Not provided"}</strong>
            </div>
          </div>
        </div>

        {/* =================================================
            ACADEMIC INFORMATION
        ================================================= */}

        <div className="profile-card">
          <h2>Academic Information</h2>

          <div className="profile-grid">
            <div className="profile-field">
              <span>Student Number</span>

              <strong>{student.id}</strong>
            </div>

            <div className="profile-field">
              <span>Course</span>

              <strong>{student.course || "Not provided"}</strong>
            </div>

            <div className="profile-field">
              <span>Year Level</span>

              <strong>{student.yearLevel || "Not provided"}</strong>
            </div>

            <div className="profile-field">
              <span>Section</span>

              <strong>{student.section || "Not provided"}</strong>
            </div>

            <div className="profile-field">
              <span>Semester</span>

              <strong>{student.semester || "Not provided"}</strong>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
