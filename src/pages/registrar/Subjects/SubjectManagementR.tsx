import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  Clock3,
  FileText,
  FlaskConical,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import SubjectModal, { type Subject } from "./Subjectmodal";
import DeleteSubjectModal from "./DeleteSubjectmodal";
import "../../../styles/SubjectManagementR2.css";

const API_BASE_URL = "http://localhost:3000/api/registrar/subjects";

interface SubjectsResponse {
  success: boolean;
  subjects: Subject[];
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
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

const formatNumber = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

export default function SubjectManagementR() {
  const navigate = useNavigate();

  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [page, setPage] = useState(1);
  const limit = 10;
  const [totalSubjects, setTotalSubjects] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);

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
      setDebouncedSearch(search.trim());
    }, 350);

    return () => window.clearTimeout(timer);
  }, [search]);

  const loadSubjects = useCallback(async () => {
    if (!authenticated || userRole !== "Registrar") return;

    try {
      setLoading(true);
      setError("");

      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });

      if (debouncedSearch) {
        params.set("search", debouncedSearch);
      }

      const response = await authService.authFetch(
        `${API_BASE_URL}?${params.toString()}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
        },
      );

      const contentType = response.headers.get("content-type") || "";
      let data: SubjectsResponse | null = null;

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
            "You are not authorized to manage subjects.",
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to load subjects (${response.status}).`,
        );
      }

      if (!data?.success) {
        throw new Error(data?.message || "Failed to load subjects.");
      }

      const loadedSubjects = Array.isArray(data.subjects) ? data.subjects : [];
      const total = Number(data.total ?? loadedSubjects.length);
      const computedPages =
        data.totalPages !== undefined
          ? Number(data.totalPages)
          : Math.ceil(total / limit);

      setSubjects(loadedSubjects);
      setTotalSubjects(total);
      setTotalPages(computedPages);
    } catch (err) {
      console.error("LOAD SUBJECTS ERROR:", err);
      setSubjects([]);
      setTotalSubjects(0);
      setTotalPages(0);

      if (err instanceof TypeError) {
        setError(
          "Unable to connect to the subjects server. Make sure the backend is running on port 3000.",
        );
        return;
      }

      setError(err instanceof Error ? err.message : "Failed to load subjects.");
    } finally {
      setLoading(false);
    }
  }, [authenticated, userRole, navigate, page, debouncedSearch]);

  useEffect(() => {
    void loadSubjects();
  }, [loadSubjects]);

  const pageSummary = useMemo(() => {
    return subjects.reduce(
      (summary, subject) => ({
        units: summary.units + Number(subject.units || 0),
        lecture: summary.lecture + Number(subject.lecture_hours || 0),
        laboratory:
          summary.laboratory + Number(subject.laboratory_hours || 0),
      }),
      { units: 0, lecture: 0, laboratory: 0 },
    );
  }, [subjects]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const clearSearch = () => {
    setSearch("");
    setDebouncedSearch("");
    setPage(1);
  };

  const handleAdd = () => {
    setModalMode("add");
    setSelectedSubject(null);
    setModalOpen(true);
  };

  const handleEdit = (subject: Subject) => {
    setModalMode("edit");
    setSelectedSubject(subject);
    setModalOpen(true);
  };

  const handleDelete = (subject: Subject) => {
    setSelectedSubject(subject);
    setDeleteModalOpen(true);
  };

  const handleCloseDeleteModal = () => {
    setDeleteModalOpen(false);
    setSelectedSubject(null);
  };

  const handleDeleteSuccess = () => {
    setDeleteModalOpen(false);
    setSelectedSubject(null);

    if (subjects.length === 1 && page > 1) {
      setPage((currentPage) => currentPage - 1);
      return;
    }

    void loadSubjects();
  };

  const handleModalSuccess = () => {
    setModalOpen(false);
    setSelectedSubject(null);
    void loadSubjects();
  };

  const goToPage = (newPage: number) => {
    if (newPage < 1) return;
    if (totalPages > 0 && newPage > totalPages) return;
    setPage(newPage);
  };

  const getPaginationPages = () => {
    const pages: (number | "ellipsis")[] = [];

    if (totalPages <= 7) {
      for (let current = 1; current <= totalPages; current += 1) {
        pages.push(current);
      }
      return pages;
    }

    pages.push(1);

    if (page > 4) pages.push("ellipsis");

    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);

    for (let current = start; current <= end; current += 1) {
      pages.push(current);
    }

    if (page < totalPages - 3) pages.push("ellipsis");

    pages.push(totalPages);
    return pages;
  };

  const startItem = totalSubjects === 0 ? 0 : (page - 1) * limit + 1;
  const endItem = Math.min(page * limit, totalSubjects);

  if (!authenticated || !user || userRole !== "Registrar") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="registrar-subject-management">
        <section className="registrar-subject-management__hero">
          <div className="registrar-subject-management__hero-copy">
            <span className="registrar-subject-management__eyebrow">
              <span className="registrar-subject-management__eyebrow-icon">
                <BookOpen size={16} aria-hidden="true" />
              </span>
              Academic Setup
            </span>
            <h1>Subject Management</h1>
            <p>
              Maintain the master subject catalog used by curricula, class
              offerings, enrollment, and academic records.
            </p>
          </div>

          <div className="registrar-subject-management__hero-actions">
            <button
              type="button"
              className="registrar-subject-management__button registrar-subject-management__button--secondary"
              onClick={() => void loadSubjects()}
              disabled={loading}
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
              className="registrar-subject-management__button registrar-subject-management__button--primary"
              onClick={handleAdd}
            >
              <Plus size={17} aria-hidden="true" />
              Add Subject
            </button>
          </div>
        </section>

        <section
          className="registrar-subject-management__stats"
          aria-label="Subject summary"
        >
          <article className="registrar-subject-management__stat-card">
            <span className="registrar-subject-management__stat-icon">
              <BookOpen size={19} aria-hidden="true" />
            </span>
            <div>
              <span className="registrar-subject-management__stat-label">
                Total Subjects
              </span>
              <strong>{totalSubjects}</strong>
              <small>Matching the current search</small>
            </div>
          </article>

          <article className="registrar-subject-management__stat-card">
            <span className="registrar-subject-management__stat-icon">
              <FileText size={19} aria-hidden="true" />
            </span>
            <div>
              <span className="registrar-subject-management__stat-label">
                Units
              </span>
              <strong>{formatNumber(pageSummary.units)}</strong>
              <small>On this result page</small>
            </div>
          </article>

          <article className="registrar-subject-management__stat-card">
            <span className="registrar-subject-management__stat-icon">
              <Clock3 size={19} aria-hidden="true" />
            </span>
            <div>
              <span className="registrar-subject-management__stat-label">
                Lecture Hours
              </span>
              <strong>{formatNumber(pageSummary.lecture)}</strong>
              <small>On this result page</small>
            </div>
          </article>

          <article className="registrar-subject-management__stat-card">
            <span className="registrar-subject-management__stat-icon">
              <FlaskConical size={19} aria-hidden="true" />
            </span>
            <div>
              <span className="registrar-subject-management__stat-label">
                Laboratory Hours
              </span>
              <strong>{formatNumber(pageSummary.laboratory)}</strong>
              <small>On this result page</small>
            </div>
          </article>
        </section>

        <section className="registrar-subject-management__workspace">
          <header className="registrar-subject-management__workspace-header">
            <div>
              <span className="registrar-subject-management__section-kicker">
                Master Catalog
              </span>
              <h2>Subject Directory</h2>
              <p>
                Search, review, and maintain subjects available throughout the
                academic system.
              </p>
            </div>

            <div className="registrar-subject-management__result-count">
              <strong>{totalSubjects}</strong>
              <span>{totalSubjects === 1 ? "subject" : "subjects"}</span>
            </div>
          </header>

          <div className="registrar-subject-management__toolbar">
            <div className="registrar-subject-management__search-wrap">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(event) => handleSearchChange(event.target.value)}
                placeholder="Search subject code, name, or description..."
                aria-label="Search subjects"
              />
              {search && (
                <button
                  type="button"
                  className="registrar-subject-management__search-clear"
                  onClick={clearSearch}
                  aria-label="Clear subject search"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              )}
            </div>

            {debouncedSearch && (
              <div className="registrar-subject-management__active-filter">
                <Search size={14} aria-hidden="true" />
                Search: <strong>{debouncedSearch}</strong>
                <button type="button" onClick={clearSearch} aria-label="Clear search">
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          {error && !loading ? (
            <div className="registrar-subject-management__state registrar-subject-management__state--error">
              <span className="registrar-subject-management__state-icon">
                <AlertTriangle size={24} aria-hidden="true" />
              </span>
              <div>
                <h3>Subjects could not be loaded</h3>
                <p>{error}</p>
              </div>
              <button
                type="button"
                className="registrar-subject-management__button registrar-subject-management__button--secondary"
                onClick={() => void loadSubjects()}
              >
                <RefreshCw size={16} aria-hidden="true" />
                Try Again
              </button>
            </div>
          ) : loading ? (
            <div className="registrar-subject-management__table-wrap" aria-busy="true">
              <table className="registrar-subject-management__table">
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Units</th>
                    <th>Contact Hours</th>
                    <th>Description</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 6 }).map((_, index) => (
                    <tr key={`subject-skeleton-${index}`}>
                      <td><span className="registrar-subject-management__skeleton registrar-subject-management__skeleton--subject" /></td>
                      <td><span className="registrar-subject-management__skeleton registrar-subject-management__skeleton--short" /></td>
                      <td><span className="registrar-subject-management__skeleton registrar-subject-management__skeleton--medium" /></td>
                      <td><span className="registrar-subject-management__skeleton registrar-subject-management__skeleton--wide" /></td>
                      <td><span className="registrar-subject-management__skeleton registrar-subject-management__skeleton--medium" /></td>
                      <td><span className="registrar-subject-management__skeleton registrar-subject-management__skeleton--actions" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : subjects.length === 0 ? (
            <div className="registrar-subject-management__state registrar-subject-management__state--empty">
              <span className="registrar-subject-management__state-icon">
                <BookOpen size={25} aria-hidden="true" />
              </span>
              <div>
                <h3>{debouncedSearch ? "No matching subjects" : "No subjects yet"}</h3>
                <p>
                  {debouncedSearch
                    ? "No subject matches the current search. Clear it or try another code, name, or description."
                    : "Create the first subject to begin building the academic subject catalog."}
                </p>
              </div>
              {debouncedSearch ? (
                <button
                  type="button"
                  className="registrar-subject-management__button registrar-subject-management__button--secondary"
                  onClick={clearSearch}
                >
                  <X size={16} aria-hidden="true" />
                  Clear Search
                </button>
              ) : (
                <button
                  type="button"
                  className="registrar-subject-management__button registrar-subject-management__button--primary"
                  onClick={handleAdd}
                >
                  <Plus size={17} aria-hidden="true" />
                  Add First Subject
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="registrar-subject-management__table-wrap">
                <table className="registrar-subject-management__table">
                  <thead>
                    <tr>
                      <th>Subject</th>
                      <th>Units</th>
                      <th>Contact Hours</th>
                      <th>Description</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subjects.map((subject) => (
                      <tr key={subject.subject_id}>
                        <td>
                          <div className="registrar-subject-management__subject-cell">
                            <span className="registrar-subject-management__code-badge">
                              {subject.subject_code}
                            </span>
                            <div>
                              <strong>{subject.subject_name}</strong>
                              <small>Record #{subject.subject_id}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="registrar-subject-management__units-badge">
                            {formatNumber(Number(subject.units || 0))}
                            <small>{Number(subject.units) === 1 ? " unit" : " units"}</small>
                          </span>
                        </td>
                        <td>
                          <div className="registrar-subject-management__hours">
                            <span>
                              <Clock3 size={14} aria-hidden="true" />
                              <strong>{formatNumber(Number(subject.lecture_hours || 0))}</strong>
                              Lecture
                            </span>
                            <span>
                              <FlaskConical size={14} aria-hidden="true" />
                              <strong>{formatNumber(Number(subject.laboratory_hours || 0))}</strong>
                              Laboratory
                            </span>
                          </div>
                        </td>
                        <td>
                          <p
                            className={`registrar-subject-management__description ${
                              subject.description ? "" : "is-empty"
                            }`}
                          >
                            {subject.description || "No description provided"}
                          </p>
                        </td>
                        <td>
                          <span className="registrar-subject-management__date">
                            <CalendarDays size={14} aria-hidden="true" />
                            {formatDate(subject.created_at)}
                          </span>
                        </td>
                        <td>
                          <div className="registrar-subject-management__actions">
                            <button
                              type="button"
                              className="registrar-subject-management__action registrar-subject-management__action--edit"
                              onClick={() => handleEdit(subject)}
                            >
                              <Pencil size={14} aria-hidden="true" />
                              Edit
                            </button>
                            <button
                              type="button"
                              className="registrar-subject-management__action registrar-subject-management__action--delete"
                              onClick={() => handleDelete(subject)}
                            >
                              <Trash2 size={14} aria-hidden="true" />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 0 && (
                <footer className="registrar-subject-management__pagination">
                  <p>
                    Showing <strong>{startItem}–{endItem}</strong> of{" "}
                    <strong>{totalSubjects}</strong> subjects
                  </p>

                  <div className="registrar-subject-management__pagination-controls">
                    <button
                      type="button"
                      onClick={() => goToPage(page - 1)}
                      disabled={page === 1 || loading}
                    >
                      Previous
                    </button>

                    <div className="registrar-subject-management__pagination-pages">
                      {getPaginationPages().map((item, index) =>
                        item === "ellipsis" ? (
                          <span key={`ellipsis-${index}`}>…</span>
                        ) : (
                          <button
                            key={item}
                            type="button"
                            className={page === item ? "is-active" : ""}
                            onClick={() => goToPage(item)}
                            aria-current={page === item ? "page" : undefined}
                          >
                            {item}
                          </button>
                        ),
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => goToPage(page + 1)}
                      disabled={page === totalPages || totalPages === 0 || loading}
                    >
                      Next
                    </button>
                  </div>
                </footer>
              )}
            </>
          )}
        </section>
      </main>

      <SubjectModal
        isOpen={modalOpen}
        mode={modalMode}
        subject={selectedSubject}
        onClose={() => {
          setModalOpen(false);
          setSelectedSubject(null);
        }}
        onSuccess={handleModalSuccess}
      />

      <DeleteSubjectModal
        isOpen={deleteModalOpen}
        subject={selectedSubject}
        onClose={handleCloseDeleteModal}
        onSuccess={handleDeleteSuccess}
      />
    </DashboardLayout>
  );
}
