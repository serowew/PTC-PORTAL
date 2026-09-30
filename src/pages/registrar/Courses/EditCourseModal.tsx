import React, { useState } from "react";

import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";

const API_BASE_URL = apiUrl("/api/registrar/courses");

interface Course {
  course_id: number;
  department_id: number;
  course_code: string;
  course_name: string;
  total_years: number;
}

interface Department {
  department_id: number;
  department_code: string;
  department_name: string;
}

interface EditCourseModalProps {
  course: Course;
  departments: Department[];
  onClose: () => void;
  onSuccess: () => void;
}

interface UpdateCourseResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export default function EditCourseModal({
  course,
  departments,
  onClose,
  onSuccess,
}: EditCourseModalProps) {
  // =====================================================
  // AUTHENTICATION
  // =====================================================

  const user = authService.getSession();

  const token = authService.getToken();

  const userRole = user?.role;

  const authenticated = Boolean(user && token);

  // =====================================================
  // FORM STATE
  // =====================================================

  const [departmentId, setDepartmentId] = useState(
    String(course.department_id),
  );

  const [courseCode, setCourseCode] = useState(course.course_code);

  const [courseName, setCourseName] = useState(course.course_name);

  const [totalYears, setTotalYears] = useState(String(course.total_years));

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
        "Your session has expired or you are not authorized to update courses.",
      );

      return;
    }

    // ===================================================
    // COURSE ID VALIDATION
    // ===================================================

    const courseId = Number(course.course_id);

    if (!Number.isInteger(courseId) || courseId <= 0) {
      setError("Invalid course ID.");

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

      const url = `${API_BASE_URL}/${courseId}`;

      console.log("UPDATE COURSE:", url, payload);

      // ===================================================
      // JWT AUTHENTICATED REQUEST
      // ===================================================

      const response = await authService.authFetch(url, {
        method: "PUT",

        body: JSON.stringify(payload),
      });

      // ===================================================
      // SAFE RESPONSE
      // ===================================================

      const contentType = response.headers.get("content-type") || "";

      let data: UpdateCourseResponse | null = null;

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
            "You are not authorized to update courses.",
        );
      }

      // ===================================================
      // HTTP ERROR
      // ===================================================

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to update course (${response.status}).`,
        );
      }

      // ===================================================
      // API ERROR
      // ===================================================

      if (!data?.success) {
        throw new Error(data?.message || "Failed to update course.");
      }

      // ===================================================
      // SUCCESS
      // ===================================================

      onSuccess();
    } catch (err) {
      console.error("UPDATE COURSE ERROR:", err);

      if (err instanceof TypeError) {
        setError(
          "Unable to connect to the course server. Make sure the backend is running on port 3000.",
        );

        return;
      }

      setError(err instanceof Error ? err.message : "Unable to update course.");
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
        aria-labelledby="edit-course-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* =================================================
            HEADER
        ================================================= */}

        <div className="course-modal-header">
          <div>
            <h2 id="edit-course-title">Edit Course</h2>

            <p>Update course information.</p>
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
            <label htmlFor="edit-course-department">Department</label>

            <select
              id="edit-course-department"
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
            <label htmlFor="edit-course-code">Course Code</label>

            <input
              id="edit-course-code"
              type="text"
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
            <label htmlFor="edit-course-name">Course Name</label>

            <input
              id="edit-course-name"
              type="text"
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
            <label htmlFor="edit-total-years">Total Years</label>

            <select
              id="edit-total-years"
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
              {loading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
