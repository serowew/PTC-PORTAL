import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import DepartmentModal from "./DepartmentModal";
import type { Department } from "./DepartmentModal";
import "../../../styles/DepartmentManagementR.css";

const API_BASE_URL = "http://localhost:3000/api/registrar/departments";

interface DepartmentResponse {
  success: boolean;
  data?: Department[];
  departments?: Department[];
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

const getInitials = (code?: string) => {
  const value = code?.trim();
  if (!value) return "DP";
  return value.slice(0, 3).toUpperCase();
};

export default function DepartmentManagementR() {
  const navigate = useNavigate();

  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [showDepartmentModal, setShowDepartmentModal] = useState(false);
  const [selectedDepartment, setSelectedDepartment] =
    useState<Department | null>(null);

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

  const loadDepartments = async () => {
    if (!authenticated || userRole !== "Registrar") return;

    try {
      setLoading(true);
      setError("");

      const response = await authService.authFetch(API_BASE_URL, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

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
            "You are not authorized to manage departments.",
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
        setError(
          "Unable to connect to the department server. Make sure the backend is running on port 3000.",
        );
        return;
      }

      setError(
        err instanceof Error ? err.message : "Unable to load departments.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") return;
    void loadDepartments();
  }, [authenticated, userRole]);

  const filteredDepartments = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return departments;

    return departments.filter((department) => {
      const code = department.department_code?.toLowerCase() || "";
      const name = department.department_name?.toLowerCase() || "";
      return code.includes(query) || name.includes(query);
    });
  }, [departments, search]);

  const newestDepartment = useMemo(() => {
    return departments.reduce<Department | null>((latest, department) => {
      if (!department.created_at) return latest;
      if (!latest?.created_at) return department;

      const currentTime = new Date(department.created_at).getTime();
      const latestTime = new Date(latest.created_at).getTime();

      if (Number.isNaN(currentTime)) return latest;
      if (Number.isNaN(latestTime) || currentTime > latestTime) return department;
      return latest;
    }, null);
  }, [departments]);

  const handleAddDepartment = () => {
    setSelectedDepartment(null);
    setShowDepartmentModal(true);
  };

  const handleEditDepartment = (department: Department) => {
    setSelectedDepartment(department);
    setShowDepartmentModal(true);
  };

  const handleCloseDepartmentModal = () => {
    setShowDepartmentModal(false);
    setSelectedDepartment(null);
  };

  const handleDepartmentSuccess = async () => {
    setShowDepartmentModal(false);
    setSelectedDepartment(null);
    await loadDepartments();
  };

  if (!authenticated || !user || userRole !== "Registrar") {
    return null;
  }

  return (
    <DashboardLayout>
      <div className="registrar-department-management">
        <section className="registrar-department-management__hero">
          <div className="registrar-department-management__hero-copy">
            <span className="registrar-department-management__eyebrow">
              <span className="registrar-department-management__eyebrow-icon">
                <Building2 size={15} aria-hidden="true" />
              </span>
              Academic Structure
            </span>

            <h1>Department Management</h1>
            <p>
              Maintain the academic departments used to organize courses,
              curricula, faculty assignments, and other Registrar records.
            </p>
          </div>

          <div className="registrar-department-management__hero-actions">
            <button
              type="button"
              className="registrar-department-management__button registrar-department-management__button--secondary"
              onClick={() => void loadDepartments()}
              disabled={loading}
            >
              <RefreshCw
                size={16}
                className={loading ? "is-spinning" : undefined}
                aria-hidden="true"
              />
              Refresh
            </button>

            <button
              type="button"
              className="registrar-department-management__button registrar-department-management__button--primary"
              onClick={handleAddDepartment}
            >
              <Plus size={16} aria-hidden="true" />
              Add Department
            </button>
          </div>
        </section>

        <section
          className="registrar-department-management__stats"
          aria-label="Department summary"
        >
          <article className="registrar-department-management__stat-card">
            <span className="registrar-department-management__stat-icon registrar-department-management__stat-icon--primary">
              <Building2 size={19} aria-hidden="true" />
            </span>
            <div>
              <span>Total Departments</span>
              <strong>{loading ? "—" : departments.length}</strong>
              <small>Academic departments on record</small>
            </div>
          </article>

          <article className="registrar-department-management__stat-card">
            <span className="registrar-department-management__stat-icon">
              <Search size={19} aria-hidden="true" />
            </span>
            <div>
              <span>Showing</span>
              <strong>{loading ? "—" : filteredDepartments.length}</strong>
              <small>{search.trim() ? "Matching your search" : "All records visible"}</small>
            </div>
          </article>

          <article className="registrar-department-management__stat-card">
            <span className="registrar-department-management__stat-icon">
              <CalendarDays size={19} aria-hidden="true" />
            </span>
            <div>
              <span>Most Recent</span>
              <strong className="registrar-department-management__stat-text">
                {loading ? "—" : newestDepartment?.department_code || "None"}
              </strong>
              <small>
                {newestDepartment?.created_at
                  ? `Added ${formatDate(newestDepartment.created_at)}`
                  : "No creation date recorded"}
              </small>
            </div>
          </article>
        </section>

        <section className="registrar-department-management__workspace">
          <div className="registrar-department-management__workspace-header">
            <div>
              <span className="registrar-department-management__section-kicker">
                Directory
              </span>
              <h2>Academic Departments</h2>
              <p>
                Search department codes or names, then edit a record when its
                official information needs to be updated.
              </p>
            </div>

            {!loading && !error && (
              <span className="registrar-department-management__record-count">
                {filteredDepartments.length} of {departments.length} departments
              </span>
            )}
          </div>

          <div className="registrar-department-management__toolbar">
            <div className="registrar-department-management__search-wrap">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search department code or name..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search departments"
              />
              {search && (
                <button
                  type="button"
                  className="registrar-department-management__search-clear"
                  onClick={() => setSearch("")}
                  aria-label="Clear department search"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              )}
            </div>

            {search.trim() && (
              <div className="registrar-department-management__active-filter">
                <span>Search</span>
                <strong>{search.trim()}</strong>
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Remove search filter"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          {loading ? (
            <div className="registrar-department-management__table-wrap">
              <table className="registrar-department-management__table">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Official Name</th>
                    <th>Created</th>
                    <th className="registrar-department-management__actions-heading">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 5 }).map((_, index) => (
                    <tr key={`department-skeleton-${index}`}>
                      <td>
                        <div className="registrar-department-management__skeleton registrar-department-management__skeleton--code" />
                      </td>
                      <td>
                        <div className="registrar-department-management__skeleton registrar-department-management__skeleton--name" />
                      </td>
                      <td>
                        <div className="registrar-department-management__skeleton registrar-department-management__skeleton--date" />
                      </td>
                      <td>
                        <div className="registrar-department-management__skeleton registrar-department-management__skeleton--action" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : error ? (
            <div className="registrar-department-management__state registrar-department-management__state--error">
              <span className="registrar-department-management__state-icon">
                <AlertTriangle size={24} aria-hidden="true" />
              </span>
              <div>
                <h3>Departments could not be loaded</h3>
                <p>{error}</p>
              </div>
              <button
                type="button"
                className="registrar-department-management__button registrar-department-management__button--secondary"
                onClick={() => void loadDepartments()}
              >
                <RefreshCw size={15} aria-hidden="true" />
                Try Again
              </button>
            </div>
          ) : filteredDepartments.length === 0 ? (
            <div className="registrar-department-management__state">
              <span className="registrar-department-management__state-icon">
                {search.trim() ? (
                  <Search size={24} aria-hidden="true" />
                ) : (
                  <Building2 size={24} aria-hidden="true" />
                )}
              </span>
              <div>
                <h3>
                  {search.trim()
                    ? "No departments match your search"
                    : "No departments have been added yet"}
                </h3>
                <p>
                  {search.trim()
                    ? "Try a different department code or name, or clear the current search."
                    : "Create the first academic department to begin organizing courses and curricula."}
                </p>
              </div>
              {search.trim() ? (
                <button
                  type="button"
                  className="registrar-department-management__button registrar-department-management__button--secondary"
                  onClick={() => setSearch("")}
                >
                  <X size={15} aria-hidden="true" />
                  Clear Search
                </button>
              ) : (
                <button
                  type="button"
                  className="registrar-department-management__button registrar-department-management__button--primary"
                  onClick={handleAddDepartment}
                >
                  <Plus size={15} aria-hidden="true" />
                  Add Department
                </button>
              )}
            </div>
          ) : (
            <div className="registrar-department-management__table-wrap">
              <table className="registrar-department-management__table">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Official Name</th>
                    <th>Created</th>
                    <th className="registrar-department-management__actions-heading">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDepartments.map((department) => (
                    <tr key={department.department_id}>
                      <td>
                        <div className="registrar-department-management__department-cell">
                          <span className="registrar-department-management__department-mark">
                            {getInitials(department.department_code)}
                          </span>
                          <div>
                            <span className="registrar-department-management__code-badge">
                              {department.department_code || "No code"}
                            </span>
                            <small>Record #{department.department_id}</small>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="registrar-department-management__name-cell">
                          <strong>{department.department_name || "Unnamed department"}</strong>
                          <span>Academic department</span>
                        </div>
                      </td>

                      <td>
                        <div className="registrar-department-management__date-cell">
                          <CalendarDays size={15} aria-hidden="true" />
                          <span>{formatDate(department.created_at)}</span>
                        </div>
                      </td>

                      <td>
                        <div className="registrar-department-management__row-actions">
                          <button
                            type="button"
                            className="registrar-department-management__edit-button"
                            onClick={() => handleEditDepartment(department)}
                            aria-label={`Edit ${department.department_name}`}
                          >
                            <Pencil size={14} aria-hidden="true" />
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && filteredDepartments.length > 0 && (
            <div className="registrar-department-management__workspace-footer">
              <span>
                <CheckCircle2 size={14} aria-hidden="true" />
                Department records are ready for Registrar maintenance.
              </span>
              <small>
                Editing a department updates the shared department record used
                elsewhere in the portal.
              </small>
            </div>
          )}
        </section>

        <DepartmentModal
          isOpen={showDepartmentModal}
          department={selectedDepartment}
          onClose={handleCloseDepartmentModal}
          onSuccess={handleDepartmentSuccess}
        />
      </div>
    </DashboardLayout>
  );
}
