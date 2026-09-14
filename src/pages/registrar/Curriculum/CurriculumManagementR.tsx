import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpenCheck,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  FilterX,
  GraduationCap,
  Layers3,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import AddCurriculumModal from "./AddCurriculumModal";
import "../../../styles/CurriculumManagementR.css";

const API_BASE_URL = "http://localhost:3000/api/registrar/curriculums";
const COURSES_API_URL = `${API_BASE_URL}/courses`;
const PAGE_SIZE = 10;

interface Curriculum {
  curriculum_id: number;
  course_id: number;
  course_code: string;
  course_name: string;
  curriculum_name: string;
  effective_year: number;
  total_units: number;
  is_active: number;
  subject_count: number;
}

interface CurriculumResponse {
  success: boolean;
  data: Curriculum[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  message?: string;
  error?: string;
}

interface Course {
  course_id: number;
  course_code: string;
  course_name: string;
}

interface CourseResponse {
  success: boolean;
  data?: Course[];
  courses?: Course[];
  message?: string;
  error?: string;
}

type PaginationItem = number | "ellipsis-left" | "ellipsis-right";

const getPaginationItems = (
  currentPage: number,
  totalPages: number,
): PaginationItem[] => {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis-right", totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [
      1,
      "ellipsis-left",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  }

  return [
    1,
    "ellipsis-left",
    currentPage - 1,
    currentPage,
    currentPage + 1,
    "ellipsis-right",
    totalPages,
  ];
};

const formatUnits = (value: number) => {
  const units = Number(value || 0);
  return Number.isInteger(units) ? String(units) : units.toFixed(1);
};

export default function CurriculumManagementR() {
  const navigate = useNavigate();

  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [curriculums, setCurriculums] = useState<Curriculum[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [courses, setCourses] = useState<Course[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [courseError, setCourseError] = useState("");

  const [showAddCurriculum, setShowAddCurriculum] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [course, setCourse] = useState("All");
  const [effectiveYear, setEffectiveYear] = useState("");
  const [activeStatus, setActiveStatus] = useState("All");

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCurriculums, setTotalCurriculums] = useState(0);

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
      setCurrentPage(1);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") return;

    const controller = new AbortController();

    const loadCourseOptions = async () => {
      try {
        setLoadingCourses(true);
        setCourseError("");

        const response = await authService.authFetch(COURSES_API_URL, {
          method: "GET",
          signal: controller.signal,
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
              "You are not authorized to load curriculum courses.",
          );
        }

        if (!response.ok || !data?.success) {
          throw new Error(
            data?.message || data?.error || "Failed to load course options.",
          );
        }

        const loadedCourses = Array.isArray(data.courses)
          ? data.courses
          : Array.isArray(data.data)
            ? data.data
            : [];

        setCourses(loadedCourses);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;

        console.error("GET CURRICULUM COURSE OPTIONS ERROR:", err);
        setCourses([]);
        setCourseError(
          err instanceof Error ? err.message : "Unable to load course options.",
        );
      } finally {
        if (!controller.signal.aborted) setLoadingCourses(false);
      }
    };

    void loadCourseOptions();

    return () => controller.abort();
  }, [authenticated, userRole, navigate, refreshKey]);

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") return;

    const controller = new AbortController();

    const loadCurriculums = async () => {
      try {
        setLoading(true);
        setError("");

        const params = new URLSearchParams();
        params.set("page", String(currentPage));
        params.set("limit", String(PAGE_SIZE));

        if (search) params.set("search", search);
        if (course !== "All") params.set("course", course);
        if (effectiveYear.trim()) {
          params.set("effective_year", effectiveYear.trim());
        }
        if (activeStatus !== "All") {
          params.set("is_active", activeStatus);
        }

        const response = await authService.authFetch(
          `${API_BASE_URL}?${params.toString()}`,
          {
            method: "GET",
            signal: controller.signal,
            headers: { Accept: "application/json" },
          },
        );

        const contentType = response.headers.get("content-type") || "";
        let data: CurriculumResponse | null = null;

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
              "You are not authorized to manage curricula.",
          );
        }

        if (!response.ok) {
          throw new Error(
            data?.message ||
              data?.error ||
              `Failed to load curricula (${response.status}).`,
          );
        }

        if (!data?.success) {
          throw new Error(data?.message || "Failed to load curricula.");
        }

        const loadedCurriculums = Array.isArray(data.data) ? data.data : [];
        const nextTotalPages = Math.max(
          1,
          Number(data.pagination?.totalPages || 1),
        );

        setCurriculums(loadedCurriculums);
        setTotalPages(nextTotalPages);
        setTotalCurriculums(
          Number(data.pagination?.total || loadedCurriculums.length),
        );

        if (currentPage > nextTotalPages) {
          setCurrentPage(nextTotalPages);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;

        console.error("GET CURRICULUMS ERROR:", err);
        setCurriculums([]);

        if (err instanceof TypeError) {
          setError(
            "Unable to connect to the curriculum server. Make sure the backend is running on port 3000.",
          );
          return;
        }

        setError(
          err instanceof Error ? err.message : "Unable to load curricula.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadCurriculums();

    return () => controller.abort();
  }, [
    authenticated,
    userRole,
    currentPage,
    search,
    course,
    effectiveYear,
    activeStatus,
    refreshKey,
    navigate,
  ]);

  const pageStats = useMemo(() => {
    const active = curriculums.filter((item) => item.is_active === 1).length;
    const mappedSubjects = curriculums.reduce(
      (sum, item) => sum + Number(item.subject_count || 0),
      0,
    );
    const representedCourses = new Set(
      curriculums.map((item) => item.course_id),
    ).size;

    return { active, mappedSubjects, representedCourses };
  }, [curriculums]);

  const selectedCourse = useMemo(
    () => courses.find((item) => String(item.course_id) === course),
    [courses, course],
  );

  const activeFilterCount = useMemo(() => {
    return [search, course !== "All", Boolean(effectiveYear), activeStatus !== "All"].filter(
      Boolean,
    ).length;
  }, [search, course, effectiveYear, activeStatus]);

  const paginationItems = useMemo(
    () => getPaginationItems(currentPage, totalPages),
    [currentPage, totalPages],
  );

  const startRecord =
    totalCurriculums === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const endRecord = Math.min(currentPage * PAGE_SIZE, totalCurriculums);

  const handleFilterChange = (
    setter: React.Dispatch<React.SetStateAction<string>>,
    value: string,
  ) => {
    setter(value);
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setCourse("All");
    setEffectiveYear("");
    setActiveStatus("All");
    setCurrentPage(1);
  };

  const handleRefresh = () => {
    setRefreshKey((value) => value + 1);
  };

  const handleCurriculumCreated = () => {
    setShowAddCurriculum(false);
    setCurrentPage(1);
    setRefreshKey((value) => value + 1);
  };

  if (!authenticated || !user || userRole !== "Registrar") return null;

  return (
    <DashboardLayout>
      <main className="registrar-curriculum-management">
        <section className="registrar-curriculum-management__hero">
          <div className="registrar-curriculum-management__hero-copy">
            <span className="registrar-curriculum-management__eyebrow">
              <span className="registrar-curriculum-management__eyebrow-icon">
                <Layers3 size={16} aria-hidden="true" />
              </span>
              Academic Structure
            </span>

            <h1>Curriculum Management</h1>
            <p>
              Organize program curricula, review their effective years, and open
              each curriculum to manage its subject mappings.
            </p>
          </div>

          <div className="registrar-curriculum-management__hero-actions">
            <button
              type="button"
              className="registrar-curriculum-management__button registrar-curriculum-management__button--secondary"
              onClick={handleRefresh}
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
              className="registrar-curriculum-management__button registrar-curriculum-management__button--primary"
              onClick={() => setShowAddCurriculum(true)}
            >
              <Plus size={17} aria-hidden="true" />
              Add Curriculum
            </button>
          </div>
        </section>

        <section
          className="registrar-curriculum-management__stats"
          aria-label="Curriculum summary"
        >
          <article className="registrar-curriculum-management__stat-card">
            <span className="registrar-curriculum-management__stat-icon registrar-curriculum-management__stat-icon--primary">
              <BookOpenCheck size={20} aria-hidden="true" />
            </span>
            <div>
              <span>Total Results</span>
              <strong>{totalCurriculums}</strong>
              <small>Across the current filters</small>
            </div>
          </article>

          <article className="registrar-curriculum-management__stat-card">
            <span className="registrar-curriculum-management__stat-icon">
              <CheckCircle2 size={20} aria-hidden="true" />
            </span>
            <div>
              <span>Active Curricula</span>
              <strong>{pageStats.active}</strong>
              <small>On this result page</small>
            </div>
          </article>

          <article className="registrar-curriculum-management__stat-card">
            <span className="registrar-curriculum-management__stat-icon">
              <GraduationCap size={20} aria-hidden="true" />
            </span>
            <div>
              <span>Courses Represented</span>
              <strong>{pageStats.representedCourses}</strong>
              <small>On this result page</small>
            </div>
          </article>

          <article className="registrar-curriculum-management__stat-card">
            <span className="registrar-curriculum-management__stat-icon">
              <Layers3 size={20} aria-hidden="true" />
            </span>
            <div>
              <span>Mapped Subjects</span>
              <strong>{pageStats.mappedSubjects}</strong>
              <small>Across curricula on this page</small>
            </div>
          </article>
        </section>

        <section className="registrar-curriculum-management__workspace">
          <div className="registrar-curriculum-management__workspace-header">
            <div>
              <span className="registrar-curriculum-management__section-kicker">
                Curriculum Directory
              </span>
              <h2>Program Curricula</h2>
              <p>
                Search and filter curricula, then open a record to manage its
                detailed subject structure.
              </p>
            </div>

            <div className="registrar-curriculum-management__result-count">
              <strong>{totalCurriculums}</strong>
              <span>{totalCurriculums === 1 ? "result" : "results"}</span>
            </div>
          </div>

          <div className="registrar-curriculum-management__toolbar">
            <div className="registrar-curriculum-management__search-wrap">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search curriculum, course code, or course name..."
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                aria-label="Search curricula"
              />
              {searchInput && (
                <button
                  type="button"
                  className="registrar-curriculum-management__search-clear"
                  onClick={() => setSearchInput("")}
                  aria-label="Clear search"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              )}
            </div>

            <div className="registrar-curriculum-management__filters">
              <div className="registrar-curriculum-management__filter-control">
                <span className="registrar-curriculum-management__filter-icon">
                  <GraduationCap size={15} aria-hidden="true" />
                </span>
                <select
                  value={course}
                  onChange={(event) =>
                    handleFilterChange(setCourse, event.target.value)
                  }
                  disabled={loadingCourses}
                  aria-label="Filter by course"
                >
                  <option value="All">
                    {loadingCourses ? "Loading courses..." : "All Courses"}
                  </option>
                  {courses.map((item) => (
                    <option key={item.course_id} value={item.course_id}>
                      {item.course_code} — {item.course_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="registrar-curriculum-management__filter-control registrar-curriculum-management__filter-control--year">
                <span className="registrar-curriculum-management__filter-icon">
                  <CalendarRange size={15} aria-hidden="true" />
                </span>
                <input
                  type="number"
                  min="1900"
                  max="2100"
                  inputMode="numeric"
                  placeholder="Effective year"
                  value={effectiveYear}
                  onChange={(event) =>
                    handleFilterChange(setEffectiveYear, event.target.value)
                  }
                  aria-label="Filter by effective year"
                />
              </div>

              <div className="registrar-curriculum-management__filter-control">
                <span className="registrar-curriculum-management__filter-icon">
                  <SlidersHorizontal size={15} aria-hidden="true" />
                </span>
                <select
                  value={activeStatus}
                  onChange={(event) =>
                    handleFilterChange(setActiveStatus, event.target.value)
                  }
                  aria-label="Filter by curriculum status"
                >
                  <option value="All">All Statuses</option>
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                </select>
              </div>

              {activeFilterCount > 0 && (
                <button
                  type="button"
                  className="registrar-curriculum-management__clear-filters"
                  onClick={clearFilters}
                >
                  <FilterX size={15} aria-hidden="true" />
                  Clear Filters
                </button>
              )}
            </div>
          </div>

          {(activeFilterCount > 0 || courseError) && (
            <div className="registrar-curriculum-management__filter-meta">
              <div className="registrar-curriculum-management__active-filters">
                {search && (
                  <span className="registrar-curriculum-management__filter-chip">
                    Search: “{search}”
                  </span>
                )}
                {course !== "All" && (
                  <span className="registrar-curriculum-management__filter-chip">
                    Course: {selectedCourse?.course_code || `#${course}`}
                  </span>
                )}
                {effectiveYear && (
                  <span className="registrar-curriculum-management__filter-chip">
                    Effective Year: {effectiveYear}
                  </span>
                )}
                {activeStatus !== "All" && (
                  <span className="registrar-curriculum-management__filter-chip">
                    Status: {activeStatus === "1" ? "Active" : "Inactive"}
                  </span>
                )}
              </div>

              {courseError && (
                <span className="registrar-curriculum-management__course-warning">
                  Course filter unavailable: {courseError}
                </span>
              )}
            </div>
          )}

          {loading ? (
            <div className="registrar-curriculum-management__table-wrap">
              <table className="registrar-curriculum-management__table">
                <thead>
                  <tr>
                    <th>Course</th>
                    <th>Curriculum</th>
                    <th>Effective Year</th>
                    <th>Units</th>
                    <th>Subjects</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 6 }, (_, index) => (
                    <tr key={index} className="registrar-curriculum-management__skeleton-row">
                      <td><span className="registrar-curriculum-management__skeleton registrar-curriculum-management__skeleton--wide" /></td>
                      <td><span className="registrar-curriculum-management__skeleton registrar-curriculum-management__skeleton--long" /></td>
                      <td><span className="registrar-curriculum-management__skeleton registrar-curriculum-management__skeleton--short" /></td>
                      <td><span className="registrar-curriculum-management__skeleton registrar-curriculum-management__skeleton--short" /></td>
                      <td><span className="registrar-curriculum-management__skeleton registrar-curriculum-management__skeleton--short" /></td>
                      <td><span className="registrar-curriculum-management__skeleton registrar-curriculum-management__skeleton--status" /></td>
                      <td><span className="registrar-curriculum-management__skeleton registrar-curriculum-management__skeleton--button" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : error ? (
            <div className="registrar-curriculum-management__state registrar-curriculum-management__state--error">
              <span className="registrar-curriculum-management__state-icon">
                <CircleOff size={25} aria-hidden="true" />
              </span>
              <h3>Curricula could not be loaded</h3>
              <p>{error}</p>
              <button
                type="button"
                className="registrar-curriculum-management__button registrar-curriculum-management__button--secondary"
                onClick={handleRefresh}
              >
                <RefreshCw size={16} aria-hidden="true" />
                Try Again
              </button>
            </div>
          ) : curriculums.length === 0 ? (
            <div className="registrar-curriculum-management__state">
              <span className="registrar-curriculum-management__state-icon">
                <BookOpenCheck size={26} aria-hidden="true" />
              </span>
              <h3>No curricula found</h3>
              <p>
                {activeFilterCount > 0
                  ? "No curriculum matches the current search and filters."
                  : "There are no curriculum records yet. Create the first curriculum to get started."}
              </p>
              {activeFilterCount > 0 ? (
                <button
                  type="button"
                  className="registrar-curriculum-management__button registrar-curriculum-management__button--secondary"
                  onClick={clearFilters}
                >
                  <FilterX size={16} aria-hidden="true" />
                  Clear Filters
                </button>
              ) : (
                <button
                  type="button"
                  className="registrar-curriculum-management__button registrar-curriculum-management__button--primary"
                  onClick={() => setShowAddCurriculum(true)}
                >
                  <Plus size={16} aria-hidden="true" />
                  Add Curriculum
                </button>
              )}
            </div>
          ) : (
            <div className="registrar-curriculum-management__table-wrap">
              <table className="registrar-curriculum-management__table">
                <thead>
                  <tr>
                    <th>Course</th>
                    <th>Curriculum</th>
                    <th>Effective Year</th>
                    <th>Units</th>
                    <th>Subjects</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {curriculums.map((curriculum) => (
                    <tr key={curriculum.curriculum_id}>
                      <td>
                        <div className="registrar-curriculum-management__course-cell">
                          <span className="registrar-curriculum-management__course-code">
                            {curriculum.course_code}
                          </span>
                          <div>
                            <strong>{curriculum.course_name}</strong>
                            <small>Course #{curriculum.course_id}</small>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="registrar-curriculum-management__curriculum-cell">
                          <strong>{curriculum.curriculum_name}</strong>
                          <small>Curriculum #{curriculum.curriculum_id}</small>
                        </div>
                      </td>

                      <td>
                        <span className="registrar-curriculum-management__year-badge">
                          <CalendarRange size={14} aria-hidden="true" />
                          {curriculum.effective_year}
                        </span>
                      </td>

                      <td>
                        <div className="registrar-curriculum-management__metric-cell">
                          <strong>{formatUnits(curriculum.total_units)}</strong>
                          <small>units</small>
                        </div>
                      </td>

                      <td>
                        <div className="registrar-curriculum-management__metric-cell">
                          <strong>{Number(curriculum.subject_count || 0)}</strong>
                          <small>
                            {Number(curriculum.subject_count || 0) === 1
                              ? "subject"
                              : "subjects"}
                          </small>
                        </div>
                      </td>

                      <td>
                        <span
                          className={`registrar-curriculum-management__status ${
                            curriculum.is_active === 1
                              ? "registrar-curriculum-management__status--active"
                              : "registrar-curriculum-management__status--inactive"
                          }`}
                        >
                          {curriculum.is_active === 1 ? (
                            <CheckCircle2 size={13} aria-hidden="true" />
                          ) : (
                            <CircleOff size={13} aria-hidden="true" />
                          )}
                          {curriculum.is_active === 1 ? "Active" : "Inactive"}
                        </span>
                      </td>

                      <td>
                        <div className="registrar-curriculum-management__row-actions">
                          <button
                            type="button"
                            className="registrar-curriculum-management__view-button"
                            onClick={() =>
                              navigate(
                                `/registrar/curriculum/${curriculum.curriculum_id}`,
                              )
                            }
                          >
                            Open Curriculum
                            <ChevronRight size={15} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && totalCurriculums > 0 && (
            <div className="registrar-curriculum-management__pagination-bar">
              <p>
                Showing <strong>{startRecord}</strong>–<strong>{endRecord}</strong> of{" "}
                <strong>{totalCurriculums}</strong> curricula
              </p>

              <nav
                className="registrar-curriculum-management__pagination"
                aria-label="Curriculum pagination"
              >
                <button
                  type="button"
                  className="registrar-curriculum-management__page-button registrar-curriculum-management__page-button--nav"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                  <span>Previous</span>
                </button>

                <div className="registrar-curriculum-management__page-numbers">
                  {paginationItems.map((item) => {
                    if (typeof item !== "number") {
                      return (
                        <span
                          key={item}
                          className="registrar-curriculum-management__page-ellipsis"
                          aria-hidden="true"
                        >
                          …
                        </span>
                      );
                    }

                    return (
                      <button
                        type="button"
                        key={item}
                        className={`registrar-curriculum-management__page-button ${
                          currentPage === item
                            ? "registrar-curriculum-management__page-button--active"
                            : ""
                        }`}
                        onClick={() => setCurrentPage(item)}
                        aria-label={`Go to page ${item}`}
                        aria-current={currentPage === item ? "page" : undefined}
                      >
                        {item}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="registrar-curriculum-management__page-button registrar-curriculum-management__page-button--nav"
                  disabled={currentPage === totalPages}
                  onClick={() =>
                    setCurrentPage((page) => Math.min(totalPages, page + 1))
                  }
                  aria-label="Next page"
                >
                  <span>Next</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </nav>
            </div>
          )}
        </section>

        {showAddCurriculum && (
          <AddCurriculumModal
            onClose={() => setShowAddCurriculum(false)}
            onSuccess={handleCurriculumCreated}
          />
        )}
      </main>
    </DashboardLayout>
  );
}
