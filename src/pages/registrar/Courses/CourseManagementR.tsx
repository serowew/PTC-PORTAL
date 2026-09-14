import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BookOpen,
  Building2,
  CalendarDays,
  Plus,
  Pencil,
  GraduationCap,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import AddCourseModal from "./AddCourseModal";
import EditCourseModal from "./EditCourseModal";
import "../../../styles/CoursemanagementR.css";

const API_BASE_URL = "http://localhost:3000/api/registrar/courses";

interface Course {
  course_id: number;
  department_id: number;
  course_code: string;
  course_name: string;
  total_years: number;
  department_code: string;
  department_name: string;
  created_at?: string;
}

interface CourseResponse {
  success: boolean;
  data?: Course[];
  courses?: Course[];
  message?: string;
  error?: string;
}

interface Department {
  department_id: number;
  department_code: string;
  department_name: string;
}

interface DepartmentResponse {
  success: boolean;
  data?: Department[];
  departments?: Department[];
  message?: string;
  error?: string;
}

interface DeleteCourseResponse {
  success: boolean;
  message?: string;
  error?: string;
}

const formatDate = (value?: string) => {
  if (!value) return "Not recorded";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";

  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const formatYears = (years: number) =>
  `${years} ${years === 1 ? "Year" : "Years"}`;

export default function CoursemanagementR() {
  const navigate = useNavigate();

  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadingDepartments, setLoadingDepartments] = useState(true);
  const [departmentError, setDepartmentError] = useState("");

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("All");

  const [showAddCourse, setShowAddCourse] = useState(false);
  const [showEditCourse, setShowEditCourse] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null);
  const [deletingCourseId, setDeletingCourseId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Registrar") {
      if (userRole) {
        navigate(authService.getDashboardRoute(userRole), { replace: true });
      } else {
        navigate("/login", { replace: true });
      }
    }
  }, [authenticated, userRole, navigate]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
    }, 350);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadCourses = async () => {
    if (!authenticated || userRole !== "Registrar") return;

    try {
      setLoading(true);
      setError("");

      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (department !== "All") params.set("department", department);

      const queryString = params.toString();
      const requestUrl = queryString
        ? `${API_BASE_URL}?${queryString}`
        : API_BASE_URL;

      const response = await authService.authFetch(requestUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      const contentType = response.headers.get("content-type") || "";
      let data: CourseResponse | null = null;

      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        throw new Error(
          `Server returned a non-JSON response (${response.status}): ${text.slice(0, 200)}`,
        );
      }

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return;
      }

      if (response.status === 403) {
        throw new Error(
          data?.message ||
            data?.error ||
            "You are not authorized to manage courses.",
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to load courses (${response.status}).`,
        );
      }

      if (!data?.success) {
        throw new Error(data?.message || "Failed to load courses.");
      }

      const loadedCourses = Array.isArray(data.data)
        ? data.data
        : Array.isArray(data.courses)
          ? data.courses
          : [];

      setCourses(loadedCourses);
    } catch (err) {
      console.error("GET COURSES ERROR:", err);
      setCourses([]);

      if (err instanceof TypeError) {
        setError(
          "Unable to connect to the course server. Make sure the backend is running on port 3000.",
        );
        return;
      }

      setError(err instanceof Error ? err.message : "Unable to load courses.");
    } finally {
      setLoading(false);
    }
  };

  const loadDepartments = async () => {
    if (!authenticated || userRole !== "Registrar") return;

    try {
      setLoadingDepartments(true);
      setDepartmentError("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/departments/list`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
        },
      );

      const contentType = response.headers.get("content-type") || "";
      let data: DepartmentResponse | null = null;

      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        throw new Error(
          `Server returned a non-JSON response (${response.status}): ${text.slice(0, 200)}`,
        );
      }

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return;
      }

      if (response.status === 403) {
        throw new Error(
          data?.message ||
            data?.error ||
            "You are not authorized to load departments.",
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to load departments (${response.status}).`,
        );
      }

      if (!data?.success) {
        throw new Error(data?.message || "Failed to load departments.");
      }

      const loadedDepartments = Array.isArray(data.data)
        ? data.data
        : Array.isArray(data.departments)
          ? data.departments
          : [];

      setDepartments(loadedDepartments);
    } catch (err) {
      console.error("GET DEPARTMENTS ERROR:", err);
      setDepartments([]);

      if (err instanceof TypeError) {
        setDepartmentError("Unable to connect to the department server.");
        return;
      }

      setDepartmentError(
        err instanceof Error ? err.message : "Unable to load departments.",
      );
    } finally {
      setLoadingDepartments(false);
    }
  };

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") return;
    void loadDepartments();
  }, [authenticated, userRole]);

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") return;
    void loadCourses();
  }, [authenticated, userRole, search, department]);

  const hasActiveFilters = Boolean(search || department !== "All");

  const selectedDepartmentName = useMemo(() => {
    if (department === "All") return "All Departments";

    const match = departments.find(
      (item) => String(item.department_id) === department,
    );

    return match
      ? `${match.department_code} — ${match.department_name}`
      : "Selected Department";
  }, [department, departments]);

  const averageProgramYears = useMemo(() => {
    if (courses.length === 0) return 0;
    const total = courses.reduce((sum, course) => sum + course.total_years, 0);
    return total / courses.length;
  }, [courses]);

  const longestProgramYears = useMemo(() => {
    if (courses.length === 0) return 0;
    return Math.max(...courses.map((course) => course.total_years));
  }, [courses]);

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setDepartment("All");
  };

  const handleRefresh = () => {
    void loadDepartments();
    void loadCourses();
  };

  const handleCourseAdded = async () => {
    setShowAddCourse(false);
    await loadCourses();
  };

  const handleEdit = (course: Course) => {
    setSelectedCourse(course);
    setShowEditCourse(true);
  };

  const handleCourseUpdated = async () => {
    setShowEditCourse(false);
    setSelectedCourse(null);
    await loadCourses();
  };

  const openDeleteDialog = (course: Course) => {
    setDeleteError("");
    setDeleteTarget(course);
  };

  const closeDeleteDialog = () => {
    if (deletingCourseId !== null) return;
    setDeleteError("");
    setDeleteTarget(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    if (!authenticated || userRole !== "Registrar") {
      setDeleteError(
        "Your session has expired or you are not authorized to delete courses.",
      );
      return;
    }

    const courseId = Number(deleteTarget.course_id);

    if (!Number.isInteger(courseId) || courseId <= 0) {
      setDeleteError("Invalid course ID.");
      return;
    }

    try {
      setDeletingCourseId(courseId);
      setDeleteError("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${courseId}`,
        {
          method: "DELETE",
          headers: { Accept: "application/json" },
        },
      );

      const contentType = response.headers.get("content-type") || "";
      let data: DeleteCourseResponse | null = null;

      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        throw new Error(
          `Server returned a non-JSON response (${response.status}): ${text.slice(0, 200)}`,
        );
      }

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return;
      }

      if (response.status === 403) {
        throw new Error(
          data?.message ||
            data?.error ||
            "You are not authorized to delete courses.",
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to delete course (${response.status}).`,
        );
      }

      if (!data?.success) {
        throw new Error(data?.message || "Failed to delete course.");
      }

      setDeleteTarget(null);
      await loadCourses();
    } catch (err) {
      console.error("DELETE COURSE ERROR:", err);
      setDeleteError(
        err instanceof Error ? err.message : "Unable to delete course.",
      );
    } finally {
      setDeletingCourseId(null);
    }
  };

  if (!authenticated || !user || userRole !== "Registrar") {
    return null;
  }

  return (
    <DashboardLayout>
      <div className="registrar-course-management">
        <section className="registrar-course-management__hero">
          <div className="registrar-course-management__hero-copy">
            <div className="registrar-course-management__eyebrow">
              <span className="registrar-course-management__eyebrow-icon">
                <GraduationCap size={16} aria-hidden="true" />
              </span>
              Registrar · Academic Setup
            </div>

            <h1>Course Management</h1>
            <p>
              Maintain the academic programs offered by PTC, their department
              assignments, and standard program duration.
            </p>
          </div>

          <div className="registrar-course-management__hero-actions">
            <button
              type="button"
              className="registrar-course-management__button registrar-course-management__button--secondary"
              onClick={handleRefresh}
              disabled={loading || loadingDepartments}
            >
              <RefreshCw
                size={16}
                className={loading ? "is-spinning" : ""}
                aria-hidden="true"
              />
              Refresh
            </button>

            <button
              type="button"
              className="registrar-course-management__button registrar-course-management__button--primary"
              onClick={() => setShowAddCourse(true)}
              disabled={loadingDepartments || departments.length === 0}
              title={
                departmentError
                  ? "Departments must load before a course can be added."
                  : undefined
              }
            >
              <Plus size={17} aria-hidden="true" />
              Add Course
            </button>
          </div>
        </section>

        <section
          className="registrar-course-management__stats"
          aria-label="Course summary"
        >
          <article className="registrar-course-management__stat-card">
            <span className="registrar-course-management__stat-icon registrar-course-management__stat-icon--primary">
              <BookOpen size={19} aria-hidden="true" />
            </span>
            <div>
              <span>{hasActiveFilters ? "Matching Courses" : "Courses"}</span>
              <strong>{loading ? "—" : courses.length}</strong>
              <small>{hasActiveFilters ? "Current filtered result" : "Programs currently listed"}</small>
            </div>
          </article>

          <article className="registrar-course-management__stat-card">
            <span className="registrar-course-management__stat-icon">
              <Building2 size={19} aria-hidden="true" />
            </span>
            <div>
              <span>Departments</span>
              <strong>{loadingDepartments ? "—" : departments.length}</strong>
              <small>Available for course assignment</small>
            </div>
          </article>

          <article className="registrar-course-management__stat-card">
            <span className="registrar-course-management__stat-icon">
              <CalendarDays size={19} aria-hidden="true" />
            </span>
            <div>
              <span>Average Duration</span>
              <strong>
                {loading || courses.length === 0
                  ? "—"
                  : `${averageProgramYears.toFixed(1)} yr`}
              </strong>
              <small>Across courses shown</small>
            </div>
          </article>

          <article className="registrar-course-management__stat-card">
            <span className="registrar-course-management__stat-icon">
              <GraduationCap size={19} aria-hidden="true" />
            </span>
            <div>
              <span>Longest Program</span>
              <strong>
                {loading || longestProgramYears === 0
                  ? "—"
                  : `${longestProgramYears} yr`}
              </strong>
              <small>Maximum duration shown</small>
            </div>
          </article>
        </section>

        <section className="registrar-course-management__workspace">
          <div className="registrar-course-management__workspace-header">
            <div>
              <span className="registrar-course-management__section-kicker">
                Course Directory
              </span>
              <h2>Academic Programs</h2>
              <p>
                Search, review, add, and maintain course information from one
                workspace.
              </p>
            </div>

            <div className="registrar-course-management__result-count">
              <strong>{loading ? "—" : courses.length}</strong>
              <span>{courses.length === 1 ? "course shown" : "courses shown"}</span>
            </div>
          </div>

          <div className="registrar-course-management__toolbar">
            <label className="registrar-course-management__search">
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search by course code or course name..."
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                aria-label="Search courses"
              />
              {searchInput && (
                <button
                  type="button"
                  className="registrar-course-management__search-clear"
                  onClick={() => {
                    setSearchInput("");
                    setSearch("");
                  }}
                  aria-label="Clear course search"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              )}
            </label>

            <label className="registrar-course-management__filter">
              <span>Department</span>
              <select
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
                disabled={loadingDepartments}
              >
                <option value="All">All Departments</option>
                {departments.map((item) => (
                  <option
                    key={item.department_id}
                    value={String(item.department_id)}
                  >
                    {item.department_code} - {item.department_name}
                  </option>
                ))}
              </select>
            </label>

            {hasActiveFilters && (
              <button
                type="button"
                className="registrar-course-management__clear-filters"
                onClick={clearFilters}
              >
                <X size={15} aria-hidden="true" />
                Clear Filters
              </button>
            )}
          </div>

          {hasActiveFilters && !loading && (
            <div className="registrar-course-management__active-filters">
              <span>Viewing:</span>
              {search && <strong>Search “{search}”</strong>}
              {department !== "All" && <strong>{selectedDepartmentName}</strong>}
            </div>
          )}

          {departmentError && (
            <div className="registrar-course-management__notice registrar-course-management__notice--warning">
              <AlertTriangle size={18} aria-hidden="true" />
              <div>
                <strong>Department list unavailable</strong>
                <span>{departmentError}</span>
              </div>
              <button type="button" onClick={() => void loadDepartments()}>
                Retry
              </button>
            </div>
          )}

          {error && !loading ? (
            <div className="registrar-course-management__state registrar-course-management__state--error">
              <span className="registrar-course-management__state-icon">
                <AlertTriangle size={24} aria-hidden="true" />
              </span>
              <h3>Courses could not be loaded</h3>
              <p>{error}</p>
              <button
                type="button"
                className="registrar-course-management__button registrar-course-management__button--secondary"
                onClick={() => void loadCourses()}
              >
                <RefreshCw size={16} aria-hidden="true" />
                Try Again
              </button>
            </div>
          ) : (
            <div className="registrar-course-management__table-shell">
              <div className="registrar-course-management__table-scroll">
                <table className="registrar-course-management__table">
                  <thead>
                    <tr>
                      <th>Course</th>
                      <th>Program Name</th>
                      <th>Department</th>
                      <th>Duration</th>
                      <th>Added</th>
                      <th className="registrar-course-management__actions-heading">
                        Actions
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {loading &&
                      Array.from({ length: 5 }).map((_, index) => (
                        <tr key={`course-skeleton-${index}`}>
                          <td>
                            <span className="registrar-course-management__skeleton registrar-course-management__skeleton--code" />
                          </td>
                          <td>
                            <span className="registrar-course-management__skeleton registrar-course-management__skeleton--wide" />
                          </td>
                          <td>
                            <span className="registrar-course-management__skeleton registrar-course-management__skeleton--medium" />
                          </td>
                          <td>
                            <span className="registrar-course-management__skeleton registrar-course-management__skeleton--short" />
                          </td>
                          <td>
                            <span className="registrar-course-management__skeleton registrar-course-management__skeleton--medium" />
                          </td>
                          <td>
                            <span className="registrar-course-management__skeleton registrar-course-management__skeleton--actions" />
                          </td>
                        </tr>
                      ))}

                    {!loading && courses.length === 0 && (
                      <tr>
                        <td colSpan={6}>
                          <div className="registrar-course-management__empty-state">
                            <span className="registrar-course-management__state-icon">
                              <BookOpen size={25} aria-hidden="true" />
                            </span>
                            <h3>
                              {hasActiveFilters
                                ? "No matching courses"
                                : "No courses yet"}
                            </h3>
                            <p>
                              {hasActiveFilters
                                ? "Try adjusting your search or department filter."
                                : "Add the first academic course to begin building the course directory."}
                            </p>
                            {hasActiveFilters ? (
                              <button
                                type="button"
                                className="registrar-course-management__button registrar-course-management__button--secondary"
                                onClick={clearFilters}
                              >
                                <X size={16} aria-hidden="true" />
                                Clear Filters
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="registrar-course-management__button registrar-course-management__button--primary"
                                onClick={() => setShowAddCourse(true)}
                                disabled={departments.length === 0}
                              >
                                <Plus size={16} aria-hidden="true" />
                                Add Course
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}

                    {!loading &&
                      courses.map((course) => (
                        <tr key={course.course_id}>
                          <td>
                            <div className="registrar-course-management__course-code">
                              <span>{course.course_code}</span>
                              <small>Course #{course.course_id}</small>
                            </div>
                          </td>

                          <td>
                            <div className="registrar-course-management__course-name">
                              <strong title={course.course_name}>
                                {course.course_name}
                              </strong>
                            </div>
                          </td>

                          <td>
                            <div className="registrar-course-management__department-cell">
                              <span className="registrar-course-management__department-code">
                                {course.department_code || "—"}
                              </span>
                              <div>
                                <strong>{course.department_name || "Not assigned"}</strong>
                              </div>
                            </div>
                          </td>

                          <td>
                            <span className="registrar-course-management__duration-pill">
                              <CalendarDays size={14} aria-hidden="true" />
                              {formatYears(course.total_years)}
                            </span>
                          </td>

                          <td>
                            <span className="registrar-course-management__date">
                              {formatDate(course.created_at)}
                            </span>
                          </td>

                          <td>
                            <div className="registrar-course-management__row-actions">
                              <button
                                type="button"
                                className="registrar-course-management__icon-button registrar-course-management__icon-button--edit"
                                onClick={() => handleEdit(course)}
                                aria-label={`Edit ${course.course_code}`}
                                title="Edit course"
                              >
                                <Pencil size={16} aria-hidden="true" />
                                <span>Edit</span>
                              </button>

                              <button
                                type="button"
                                className="registrar-course-management__icon-button registrar-course-management__icon-button--delete"
                                onClick={() => openDeleteDialog(course)}
                                disabled={deletingCourseId === course.course_id}
                                aria-label={`Delete ${course.course_code}`}
                                title="Delete course"
                              >
                                <Trash2 size={16} aria-hidden="true" />
                                <span>Delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {showAddCourse && (
          <AddCourseModal
            departments={departments}
            onClose={() => setShowAddCourse(false)}
            onSuccess={handleCourseAdded}
          />
        )}

        {showEditCourse && selectedCourse && (
          <EditCourseModal
            course={selectedCourse}
            departments={departments}
            onClose={() => {
              setShowEditCourse(false);
              setSelectedCourse(null);
            }}
            onSuccess={handleCourseUpdated}
          />
        )}

        {deleteTarget && (
          <div
            className="registrar-course-management__delete-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeDeleteDialog();
            }}
          >
            <div
              className="registrar-course-management__delete-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-course-title"
            >
              <button
                type="button"
                className="registrar-course-management__dialog-close"
                onClick={closeDeleteDialog}
                disabled={deletingCourseId !== null}
                aria-label="Close delete confirmation"
              >
                <X size={18} aria-hidden="true" />
              </button>

              <span className="registrar-course-management__delete-icon">
                <AlertTriangle size={25} aria-hidden="true" />
              </span>

              <h2 id="delete-course-title">Delete this course?</h2>
              <p>
                You are about to remove <strong>{deleteTarget.course_code}</strong>
                {" — "}
                {deleteTarget.course_name}.
              </p>

              <div className="registrar-course-management__delete-warning">
                Courses already referenced by a curriculum cannot be deleted.
                If this course is in use, the server will keep it and explain why.
              </div>

              {deleteError && (
                <div className="registrar-course-management__delete-error">
                  {deleteError}
                </div>
              )}

              <div className="registrar-course-management__dialog-actions">
                <button
                  type="button"
                  className="registrar-course-management__button registrar-course-management__button--secondary"
                  onClick={closeDeleteDialog}
                  disabled={deletingCourseId !== null}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="registrar-course-management__button registrar-course-management__button--danger"
                  onClick={() => void handleDelete()}
                  disabled={deletingCourseId !== null}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {deletingCourseId !== null ? "Deleting..." : "Delete Course"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
