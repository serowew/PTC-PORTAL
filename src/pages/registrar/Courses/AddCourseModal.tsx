import React, { useState } from "react";

import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";

const API_BASE_URL = apiUrl("/api/registrar/courses");

interface Department {
  department_id: number;
  department_code: string;
  department_name: string;
}

interface AddCourseModalProps {
  departments: Department[];
  onClose: () => void;
  onSuccess: () => void;
}

interface CreateCourseResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export default function AddCourseModal({
  departments,
  onClose,
  onSuccess,
}: AddCourseModalProps) {
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

  const [departmentId, setDepartmentId] = useState("");

  const [courseCode, setCourseCode] = useState("");

  const [courseName, setCourseName] = useState("");

  const [totalYears, setTotalYears] = useState("4");

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  // =====================================================
  // CLOSE
  // =====================================================

  const handleClose = () => {
    if (loading) {
      return;
    }

    onClose();
  };

  // =====================================================
  // SUBMIT
  // =====================================================

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    setError("");

    // ===================================================
    // AUTH CHECK
    // ===================================================

    if (!authenticated || userRole !== "Registrar") {
      setError(
        "Your session has expired or you are not authorized to create courses.",
      );

      return;
    }

    // ===================================================
    // DEPARTMENT VALIDATION
    // ===================================================

    const parsedDepartmentId = Number(departmentId);

    if (!Number.isInteger(parsedDepartmentId) || parsedDepartmentId <= 0) {
      setError("Please select a valid department.");

      return;
    }

    // ===================================================
    // COURSE CODE VALIDATION
    // ===================================================

    const cleanCourseCode = courseCode.trim();

    if (!cleanCourseCode) {
      setError("Course code is required.");

      return;
    }

    if (cleanCourseCode.length > 20) {
      setError("Course code cannot exceed 20 characters.");

      return;
    }

    // ===================================================
    // COURSE NAME VALIDATION
    // ===================================================

    const cleanCourseName = courseName.trim();

    if (!cleanCourseName) {
      setError("Course name is required.");

      return;
    }

    if (cleanCourseName.length > 200) {
      setError("Course name cannot exceed 200 characters.");

      return;
    }

    // ===================================================
    // TOTAL YEARS VALIDATION
    // ===================================================

    const years = Number(totalYears);

    if (!Number.isInteger(years) || years < 1 || years > 10) {
      setError("Total years must be between 1 and 10.");

      return;
    }

    try {
      setLoading(true);

      // ===================================================
      // PAYLOAD
      // ===================================================

      const payload = {
        department_id: parsedDepartmentId,

        course_code: cleanCourseCode,

        course_name: cleanCourseName,

        total_years: years,
      };

      console.log("CREATE COURSE:", payload);

      // ===================================================
      // JWT AUTHENTICATED REQUEST
      // ===================================================

      const response = await authService.authFetch(API_BASE_URL, {
        method: "POST",

        body: JSON.stringify(payload),
      });

      // ===================================================
      // SAFE RESPONSE
      // ===================================================

      const contentType = response.headers.get("content-type") || "";

      let data: CreateCourseResponse | null = null;

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

      // ===================================================
      // 401
      // ===================================================

      if (response.status === 401) {
        authService.logout();

        setError("Your session has expired. Please log in again.");

        return;
      }

      // ===================================================
      // 403
      // ===================================================

      if (response.status === 403) {
        throw new Error(
          data?.message ||
            data?.error ||
            "You are not authorized to create courses.",
        );
      }

      // ===================================================
      // HTTP ERROR
      // ===================================================

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to create course (${response.status}).`,
        );
      }

      // ===================================================
      // API ERROR
      // ===================================================

      if (!data?.success) {
        throw new Error(data?.message || "Failed to create course.");
      }

      // ===================================================
      // SUCCESS
      // ===================================================

      onSuccess();
    } catch (err) {
      console.error("CREATE COURSE ERROR:", err);

      if (err instanceof TypeError) {
        setError(
          "Unable to connect to the course server. Make sure the backend is running on port 3000.",
        );

        return;
      }

      setError(err instanceof Error ? err.message : "Unable to create course.");
    } finally {
      setLoading(false);
    }
  };

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <div
      className="course-modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) {
          handleClose();
        }
      }}
    >
      <div
        className="course-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-course-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* =================================================
            HEADER
        ================================================= */}

        <div className="course-modal-header">
          <div>
            <h2 id="add-course-title">Add Course</h2>

            <p>Create a new academic course.</p>
          </div>

          <button
            type="button"
            className="course-modal-close"
            onClick={handleClose}
            disabled={loading}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* =================================================
            FORM
        ================================================= */}

        <form onSubmit={handleSubmit} className="course-modal-form">
          {/* DEPARTMENT */}

          <div className="course-form-group">
            <label htmlFor="course-department">Department</label>

            <select
              id="course-department"
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              disabled={loading}
              required
            >
              <option value="">Select Department</option>

              {departments.map((department) => (
                <option
                  key={department.department_id}
                  value={String(department.department_id)}
                >
                  {department.department_code} - {department.department_name}
                </option>
              ))}
            </select>
          </div>

          {/* COURSE CODE */}

          <div className="course-form-group">
            <label htmlFor="course-code">Course Code</label>

            <input
              id="course-code"
              type="text"
              placeholder="e.g. BSIT"
              value={courseCode}
              onChange={(event) =>
                setCourseCode(event.target.value.toUpperCase())
              }
              maxLength={20}
              disabled={loading}
              autoComplete="off"
              required
            />
          </div>

          {/* COURSE NAME */}

          <div className="course-form-group">
            <label htmlFor="course-name">Course Name</label>

            <input
              id="course-name"
              type="text"
              placeholder="e.g. Bachelor of Science in Information Technology"
              value={courseName}
              onChange={(event) => setCourseName(event.target.value)}
              maxLength={200}
              disabled={loading}
              autoComplete="off"
              required
            />
          </div>

          {/* TOTAL YEARS */}

          <div className="course-form-group">
            <label htmlFor="total-years">Total Years</label>

            <select
              id="total-years"
              value={totalYears}
              onChange={(event) => setTotalYears(event.target.value)}
              disabled={loading}
            >
              <option value="1">1 Year</option>

              <option value="2">2 Years</option>

              <option value="3">3 Years</option>

              <option value="4">4 Years</option>

              <option value="5">5 Years</option>

              <option value="6">6 Years</option>
            </select>
          </div>

          {/* ERROR */}

          {error && <div className="course-modal-error">{error}</div>}

          {/* ACTIONS */}

          <div className="course-modal-actions">
            <button
              type="button"
              className="course-cancel-btn"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="course-save-btn"
              disabled={loading || !authenticated || userRole !== "Registrar"}
            >
              {loading ? "Creating..." : "Create Course"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
