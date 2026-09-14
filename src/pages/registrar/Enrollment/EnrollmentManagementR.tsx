import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Eye,
  Filter,
  GraduationCap,
  MapPin,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/EnrollmentManagementR.css";

const API_BASE_URL = "http://localhost:3000/api/registrar/enrollments";
const COURSES_API_URL = "http://localhost:3000/api/registrar/courses";
const ENROLLMENT_PERIOD_API_URL = `${API_BASE_URL}/period`;
const PAGE_SIZE = 10;

type EnrollmentStatus =
  | "Draft"
  | "Pending"
  | "Approved"
  | "Rejected"
  | "Cancelled"
  | string;

interface Enrollment {
  enrollment_id: number;
  student: {
    student_id: number;
    student_number: string;
    student_name: string;
    first_name: string;
    middle_name: string | null;
    last_name: string;
    username: string | null;
    year_level: number | null;
  };
  course: {
    course_id: number | null;
    course_code: string;
    course_name: string;
  };
  section: {
    section_id: number | null;
    section_name: string | null;
    year_level: number | null;
  };
  placement: {
    assigned_section_count: number;
    section_ids: number[];
    section_names: string[];
    placed_subjects: number;
    unplaced_subjects: number;
    placement_complete: boolean;
  };
  academic_period: {
    academic_year_id: number;
    academic_year: string;
    semester_id: number;
    semester_name: string;
  };
  enrollment_status: EnrollmentStatus;
  remarks: string | null;
  approval: {
    approved_by: number | null;
    approved_by_username: string | null;
    approved_at: string | null;
  };
  total_subjects: number;
  total_units: number;
  created_at: string;
}

interface EnrollmentResponse {
  success: boolean;
  data: Enrollment[];
  pagination: {
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

interface CourseOption {
  course_id: number;
  course_code: string;
  course_name?: string;
}

interface CourseResponse {
  success: boolean;
  data?: CourseOption[];
  courses?: CourseOption[];
  message?: string;
  error?: string;
}

interface AcademicYearOption {
  academic_year_id: number;
  academic_year: string;
  is_current?: boolean;
}

interface SemesterOption {
  semester_id: number;
  semester_name: string;
}

interface PeriodResponse {
  success: boolean;
  academic_years?: AcademicYearOption[];
  semesters?: SemesterOption[];
  message?: string;
  error?: string;
}

const formatDate = (value?: string | null) => {
  if (!value) return "Not recorded";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";

  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const getStudentInitials = (enrollment: Enrollment) => {
  const first = enrollment.student.first_name?.trim()?.charAt(0) || "";
  const last = enrollment.student.last_name?.trim()?.charAt(0) || "";
  return `${first}${last}`.toUpperCase() || "ST";
};

const getStudentName = (enrollment: Enrollment) => {
  const { first_name, middle_name, last_name, student_name } = enrollment.student;
  const name = [first_name, middle_name, last_name].filter(Boolean).join(" ").trim();
  return name || student_name || "Unnamed Student";
};

const getStatusTone = (status: string) => {
  switch (status.toLowerCase()) {
    case "pending":
      return "pending";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "cancelled":
      return "cancelled";
    case "draft":
      return "draft";
    default:
      return "default";
  }
};

const buildPagination = (currentPage: number, totalPages: number) => {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages: Array<number | "ellipsis-left" | "ellipsis-right"> = [1];

  if (currentPage > 4) pages.push("ellipsis-left");

  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }

  if (currentPage < totalPages - 3) pages.push("ellipsis-right");

  pages.push(totalPages);
  return pages;
};

export default function EnrollmentManagementR() {
  const navigate = useNavigate();

  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Pending");
  const [course, setCourse] = useState("All");
  const [year, setYear] = useState("All");
  const [section, setSection] = useState("All");
  const [academicYear, setAcademicYear] = useState("All");
  const [semester, setSemester] = useState("All");

  const [courseCatalog, setCourseCatalog] = useState<CourseOption[]>([]);
  const [academicYearCatalog, setAcademicYearCatalog] = useState<AcademicYearOption[]>([]);
  const [semesterCatalog, setSemesterCatalog] = useState<SemesterOption[]>([]);

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalEnrollments, setTotalEnrollments] = useState(0);

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

    const loadFilterMetadata = async () => {
      try {
        const [courseResult, periodResult] = await Promise.allSettled([
          authService.authFetch(COURSES_API_URL, {
            method: "GET",
            signal: controller.signal,
            headers: { Accept: "application/json" },
          }),
          authService.authFetch(ENROLLMENT_PERIOD_API_URL, {
            method: "GET",
            signal: controller.signal,
            headers: { Accept: "application/json" },
          }),
        ]);

        if (courseResult.status === "fulfilled" && courseResult.value.ok) {
          const courseData = (await courseResult.value.json()) as CourseResponse;
          if (courseData.success) {
            const items = Array.isArray(courseData.data)
              ? courseData.data
              : Array.isArray(courseData.courses)
                ? courseData.courses
                : [];
            setCourseCatalog(items);
          }
        }

        if (periodResult.status === "fulfilled" && periodResult.value.ok) {
          const periodData = (await periodResult.value.json()) as PeriodResponse;
          if (periodData.success) {
            setAcademicYearCatalog(
              Array.isArray(periodData.academic_years) ? periodData.academic_years : [],
            );
            setSemesterCatalog(
              Array.isArray(periodData.semesters)
                ? periodData.semesters.filter((item) => [1, 2].includes(Number(item.semester_id)))
                : [],
            );
          }
        }
      } catch (metadataError) {
        if (!(metadataError instanceof DOMException && metadataError.name === "AbortError")) {
          console.warn("Enrollment filter metadata could not be loaded:", metadataError);
        }
      }
    };

    void loadFilterMetadata();

    return () => controller.abort();
  }, [authenticated, userRole]);

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") return;

    const controller = new AbortController();

    const loadEnrollments = async () => {
      try {
        setLoading(true);
        setError("");

        const params = new URLSearchParams();
        params.set("page", String(currentPage));
        params.set("limit", String(PAGE_SIZE));

        if (search) params.set("search", search);
        if (status !== "All") params.set("status", status);
        if (course !== "All") params.set("course", course);
        if (year !== "All") params.set("year", year);
        if (section !== "All") params.set("section", section);
        if (academicYear !== "All") params.set("academic_year", academicYear);

        if (semester !== "All" && [1, 2].includes(Number(semester))) {
          params.set("semester", semester);
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
        let data: EnrollmentResponse | null = null;

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
              "You are not authorized to access Registrar enrollments.",
          );
        }

        if (!response.ok || !data?.success) {
          throw new Error(
            data?.message || data?.error || "Failed to load enrollments.",
          );
        }

        const rows = Array.isArray(data.data) ? data.data : [];
        setEnrollments(rows);
        setTotalPages(Math.max(Number(data.pagination?.totalPages || 0), 1));
        setTotalEnrollments(Number(data.pagination?.total || 0));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;

        console.error("FETCH ENROLLMENTS ERROR:", err);
        setEnrollments([]);
        setTotalEnrollments(0);
        setTotalPages(1);

        if (err instanceof TypeError) {
          setError(
            "Unable to connect to the enrollment server. Make sure the backend server is running on port 3000.",
          );
        } else {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load enrollment records.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadEnrollments();
    return () => controller.abort();
  }, [
    authenticated,
    userRole,
    currentPage,
    search,
    status,
    course,
    year,
    section,
    academicYear,
    semester,
    refreshKey,
    navigate,
  ]);

  const courseOptions = useMemo(() => {
    if (courseCatalog.length > 0) {
      return [...courseCatalog]
        .filter((item) => item.course_id && item.course_code)
        .sort((a, b) => a.course_code.localeCompare(b.course_code));
    }

    const map = new Map<number, CourseOption>();
    enrollments.forEach((item) => {
      if (item.course.course_id && item.course.course_code) {
        map.set(item.course.course_id, {
          course_id: item.course.course_id,
          course_code: item.course.course_code,
          course_name: item.course.course_name,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) =>
      a.course_code.localeCompare(b.course_code),
    );
  }, [courseCatalog, enrollments]);

  const yearOptions = useMemo(() => {
    return Array.from(
      new Set(
        enrollments
          .map((item) => item.student.year_level)
          .filter((value): value is number => value !== null && value !== undefined),
      ),
    )
      .sort((a, b) => a - b)
      .map(String);
  }, [enrollments]);

  const sectionOptions = useMemo(() => {
    const map = new Map<number, string>();

    enrollments.forEach((item) => {
      if (
        item.section.section_id &&
        item.section.section_name &&
        item.placement.assigned_section_count === 1
      ) {
        map.set(item.section.section_id, item.section.section_name);
      }
    });

    return Array.from(map.entries())
      .map(([id, label]) => ({ id: String(id), label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [enrollments]);

  const academicYearOptions = useMemo(() => {
    if (academicYearCatalog.length > 0) {
      return [...academicYearCatalog].sort((a, b) =>
        b.academic_year.localeCompare(a.academic_year),
      );
    }

    const map = new Map<number, AcademicYearOption>();
    enrollments.forEach((item) => {
      map.set(item.academic_period.academic_year_id, {
        academic_year_id: item.academic_period.academic_year_id,
        academic_year: item.academic_period.academic_year,
      });
    });
    return Array.from(map.values()).sort((a, b) =>
      b.academic_year.localeCompare(a.academic_year),
    );
  }, [academicYearCatalog, enrollments]);

  const semesterOptions = useMemo(() => {
    if (semesterCatalog.length > 0) {
      return [...semesterCatalog].sort(
        (a, b) => Number(a.semester_id) - Number(b.semester_id),
      );
    }

    const map = new Map<number, SemesterOption>();
    enrollments.forEach((item) => {
      const id = Number(item.academic_period.semester_id);
      if ([1, 2].includes(id)) {
        map.set(id, {
          semester_id: id,
          semester_name: item.academic_period.semester_name,
        });
      }
    });
    return Array.from(map.values()).sort(
      (a, b) => Number(a.semester_id) - Number(b.semester_id),
    );
  }, [semesterCatalog, enrollments]);

  const pageSubjectCount = useMemo(
    () =>
      enrollments.reduce(
        (total, enrollment) => total + Number(enrollment.total_subjects || 0),
        0,
      ),
    [enrollments],
  );

  const pageUnitCount = useMemo(
    () =>
      enrollments.reduce(
        (total, enrollment) => total + Number(enrollment.total_units || 0),
        0,
      ),
    [enrollments],
  );

  const placementCompleteCount = useMemo(
    () => enrollments.filter((item) => item.placement.placement_complete).length,
    [enrollments],
  );

  const needsPlacementCount = useMemo(
    () =>
      enrollments.filter(
        (item) => !item.placement.placement_complete && item.total_subjects > 0,
      ).length,
    [enrollments],
  );

  const activeFilters = useMemo(() => {
    const filters: Array<{ key: string; label: string }> = [];

    if (search) filters.push({ key: "search", label: `Search: “${search}”` });
    if (status !== "All") filters.push({ key: "status", label: `Status: ${status}` });

    if (course !== "All") {
      const selected = courseOptions.find((item) => String(item.course_id) === course);
      filters.push({
        key: "course",
        label: `Course: ${selected?.course_code || course}`,
      });
    }

    if (year !== "All") filters.push({ key: "year", label: `Year ${year}` });

    if (section !== "All") {
      const selected = sectionOptions.find((item) => item.id === section);
      filters.push({
        key: "section",
        label: `Section: ${selected?.label || section}`,
      });
    }

    if (academicYear !== "All") {
      const selected = academicYearOptions.find(
        (item) => String(item.academic_year_id) === academicYear,
      );
      filters.push({
        key: "academicYear",
        label: `A.Y. ${selected?.academic_year || academicYear}`,
      });
    }

    if (semester !== "All") {
      const selected = semesterOptions.find(
        (item) => String(item.semester_id) === semester,
      );
      filters.push({
        key: "semester",
        label: selected?.semester_name || `Semester ${semester}`,
      });
    }

    return filters;
  }, [
    search,
    status,
    course,
    year,
    section,
    academicYear,
    semester,
    courseOptions,
    sectionOptions,
    academicYearOptions,
    semesterOptions,
  ]);

  const handleFilterChange = (
    setter: React.Dispatch<React.SetStateAction<string>>,
    value: string,
  ) => {
    setter(value);
    setCurrentPage(1);
  };

  const clearFilter = (key: string) => {
    switch (key) {
      case "search":
        setSearchInput("");
        setSearch("");
        break;
      case "status":
        setStatus("All");
        break;
      case "course":
        setCourse("All");
        break;
      case "year":
        setYear("All");
        break;
      case "section":
        setSection("All");
        break;
      case "academicYear":
        setAcademicYear("All");
        break;
      case "semester":
        setSemester("All");
        break;
      default:
        break;
    }
    setCurrentPage(1);
  };

  const clearAllFilters = () => {
    setSearchInput("");
    setSearch("");
    setStatus("All");
    setCourse("All");
    setYear("All");
    setSection("All");
    setAcademicYear("All");
    setSemester("All");
    setCurrentPage(1);
  };

  const showPendingQueue = () => {
    setStatus("Pending");
    setCurrentPage(1);
  };

  const paginationItems = useMemo(
    () => buildPagination(currentPage, totalPages),
    [currentPage, totalPages],
  );

  const rangeStart = totalEnrollments === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, totalEnrollments);

  if (!authenticated || !user || userRole !== "Registrar") return null;

  return (
    <DashboardLayout>
      <main className="registrar-enrollment-management">
        <section className="registrar-enrollment-management__hero">
          <div className="registrar-enrollment-management__hero-copy">
            <div className="registrar-enrollment-management__eyebrow">
              <span className="registrar-enrollment-management__eyebrow-icon">
                <ClipboardCheck size={16} aria-hidden="true" />
              </span>
              Registrar · Enrollment
            </div>
            <h1>Student Enrollment</h1>
            <p>
              Review student enrollment submissions, monitor subject placement,
              and open each record for Registrar validation and approval.
            </p>
          </div>

          <div className="registrar-enrollment-management__hero-actions">
            {status !== "Pending" && (
              <button
                type="button"
                className="registrar-enrollment-management__button registrar-enrollment-management__button--secondary"
                onClick={showPendingQueue}
              >
                <ClipboardCheck size={16} aria-hidden="true" />
                Pending Queue
              </button>
            )}

            <button
              type="button"
              className="registrar-enrollment-management__button registrar-enrollment-management__button--primary"
              onClick={() => setRefreshKey((value) => value + 1)}
              disabled={loading}
            >
              <RefreshCw
                size={16}
                className={loading ? "registrar-enrollment-management__spin" : ""}
                aria-hidden="true"
              />
              Refresh
            </button>
          </div>
        </section>

        <section
          className="registrar-enrollment-management__stats"
          aria-label="Enrollment summary"
        >
          <article className="registrar-enrollment-management__stat-card">
            <span className="registrar-enrollment-management__stat-icon">
              <Users size={19} aria-hidden="true" />
            </span>
            <div>
              <p>Matching Enrollments</p>
              <strong>{loading ? "—" : totalEnrollments.toLocaleString()}</strong>
              <small>Across the current filters</small>
            </div>
          </article>

          <article className="registrar-enrollment-management__stat-card">
            <span className="registrar-enrollment-management__stat-icon">
              <BookOpen size={19} aria-hidden="true" />
            </span>
            <div>
              <p>On This Page</p>
              <strong>{loading ? "—" : enrollments.length}</strong>
              <small>
                {loading ? "Loading enrollment load" : `${pageSubjectCount} subjects · ${pageUnitCount} units`}
              </small>
            </div>
          </article>

          <article className="registrar-enrollment-management__stat-card">
            <span className="registrar-enrollment-management__stat-icon registrar-enrollment-management__stat-icon--success">
              <CheckCircle2 size={19} aria-hidden="true" />
            </span>
            <div>
              <p>Placement Complete</p>
              <strong>{loading ? "—" : placementCompleteCount}</strong>
              <small>On this result page</small>
            </div>
          </article>

          <article className="registrar-enrollment-management__stat-card">
            <span className="registrar-enrollment-management__stat-icon registrar-enrollment-management__stat-icon--warning">
              <AlertCircle size={19} aria-hidden="true" />
            </span>
            <div>
              <p>Needs Placement</p>
              <strong>{loading ? "—" : needsPlacementCount}</strong>
              <small>Has subjects not fully placed</small>
            </div>
          </article>
        </section>

        <section className="registrar-enrollment-management__workspace">
          <div className="registrar-enrollment-management__workspace-header">
            <div>
              <div className="registrar-enrollment-management__section-kicker">
                <GraduationCap size={16} aria-hidden="true" />
                Enrollment Directory
              </div>
              <h2>Enrollment Review Queue</h2>
              <p>
                Pending enrollments are shown by default. Use the filters to review
                historical or already processed records.
              </p>
            </div>

            <div className="registrar-enrollment-management__result-meta">
              <span>{totalEnrollments.toLocaleString()} results</span>
              <span aria-hidden="true">•</span>
              <span>Page {currentPage} of {totalPages}</span>
            </div>
          </div>

          <div className="registrar-enrollment-management__toolbar">
            <label className="registrar-enrollment-management__search">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search student number, name, or username..."
                aria-label="Search enrollments"
              />
              {searchInput && (
                <button
                  type="button"
                  className="registrar-enrollment-management__search-clear"
                  onClick={() => {
                    setSearchInput("");
                    setSearch("");
                    setCurrentPage(1);
                  }}
                  aria-label="Clear enrollment search"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              )}
            </label>

            <div className="registrar-enrollment-management__filter-title">
              <SlidersHorizontal size={16} aria-hidden="true" />
              Filters
            </div>
          </div>

          <div className="registrar-enrollment-management__filters">
            <label>
              <span>Status</span>
              <select
                value={status}
                onChange={(event) => handleFilterChange(setStatus, event.target.value)}
              >
                <option value="All">All Statuses</option>
                <option value="Draft">Draft</option>
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </label>

            <label>
              <span>Course</span>
              <select
                value={course}
                onChange={(event) => handleFilterChange(setCourse, event.target.value)}
              >
                <option value="All">All Courses</option>
                {courseOptions.map((item) => (
                  <option key={item.course_id} value={String(item.course_id)}>
                    {item.course_code}
                    {item.course_name ? ` — ${item.course_name}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Year Level</span>
              <select
                value={year}
                onChange={(event) => handleFilterChange(setYear, event.target.value)}
              >
                <option value="All">All Years</option>
                {yearOptions.map((item) => (
                  <option key={item} value={item}>Year {item}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Section</span>
              <select
                value={section}
                onChange={(event) => handleFilterChange(setSection, event.target.value)}
              >
                <option value="All">All Sections</option>
                {sectionOptions.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Academic Year</span>
              <select
                value={academicYear}
                onChange={(event) => handleFilterChange(setAcademicYear, event.target.value)}
              >
                <option value="All">All Academic Years</option>
                {academicYearOptions.map((item) => (
                  <option
                    key={item.academic_year_id}
                    value={String(item.academic_year_id)}
                  >
                    {item.academic_year}{item.is_current ? " (Current)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Semester</span>
              <select
                value={semester}
                onChange={(event) => {
                  const value = event.target.value;
                  handleFilterChange(
                    setSemester,
                    value === "All" || [1, 2].includes(Number(value)) ? value : "All",
                  );
                }}
              >
                <option value="All">All Semesters</option>
                {semesterOptions.map((item) => (
                  <option key={item.semester_id} value={String(item.semester_id)}>
                    {item.semester_name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="registrar-enrollment-management__filter-summary">
            <div className="registrar-enrollment-management__active-filters">
              <Filter size={15} aria-hidden="true" />
              {activeFilters.length === 0 ? (
                <span>No filters applied</span>
              ) : (
                activeFilters.map((item) => (
                  <button
                    type="button"
                    key={item.key}
                    className="registrar-enrollment-management__filter-chip"
                    onClick={() => clearFilter(item.key)}
                    title={`Remove ${item.label}`}
                  >
                    {item.label}
                    <X size={13} aria-hidden="true" />
                  </button>
                ))
              )}
            </div>

            {activeFilters.length > 0 && (
              <button
                type="button"
                className="registrar-enrollment-management__clear-filters"
                onClick={clearAllFilters}
              >
                Clear Filters
              </button>
            )}
          </div>

          <div className="registrar-enrollment-management__table-wrap">
            <table className="registrar-enrollment-management__table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Program / Level</th>
                  <th>Enrollment Period</th>
                  <th>Placement</th>
                  <th>Academic Load</th>
                  <th>Status</th>
                  <th className="registrar-enrollment-management__actions-heading">Review</th>
                </tr>
              </thead>

              <tbody>
                {loading &&
                  Array.from({ length: 6 }).map((_, index) => (
                    <tr key={`skeleton-${index}`} className="registrar-enrollment-management__skeleton-row">
                      {Array.from({ length: 7 }).map((__, cellIndex) => (
                        <td key={cellIndex}>
                          <span className="registrar-enrollment-management__skeleton" />
                        </td>
                      ))}
                    </tr>
                  ))}

                {!loading && !error && enrollments.map((enrollment) => {
                  const placementTotal = Number(enrollment.total_subjects || 0);
                  const placed = Number(enrollment.placement.placed_subjects || 0);
                  const progress = placementTotal > 0
                    ? Math.min(100, Math.round((placed / placementTotal) * 100))
                    : 0;
                  const statusTone = getStatusTone(enrollment.enrollment_status);

                  return (
                    <tr key={enrollment.enrollment_id}>
                      <td>
                        <div className="registrar-enrollment-management__student">
                          <span className="registrar-enrollment-management__avatar">
                            {getStudentInitials(enrollment)}
                          </span>
                          <div className="registrar-enrollment-management__student-copy">
                            <strong title={getStudentName(enrollment)}>
                              {getStudentName(enrollment)}
                            </strong>
                            <span>{enrollment.student.student_number}</span>
                            <small>
                              Enrollment #{enrollment.enrollment_id}
                              {enrollment.student.username ? ` · @${enrollment.student.username}` : ""}
                            </small>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="registrar-enrollment-management__program">
                          <span className="registrar-enrollment-management__course-code">
                            {enrollment.course.course_code || "No Course"}
                          </span>
                          <strong title={enrollment.course.course_name || ""}>
                            {enrollment.course.course_name || "Course not assigned"}
                          </strong>
                          <small>
                            {enrollment.student.year_level
                              ? `Year ${enrollment.student.year_level}`
                              : "Year level not assigned"}
                          </small>
                        </div>
                      </td>

                      <td>
                        <div className="registrar-enrollment-management__period">
                          <span className="registrar-enrollment-management__cell-icon">
                            <CalendarDays size={15} aria-hidden="true" />
                          </span>
                          <div>
                            <strong>{enrollment.academic_period.academic_year}</strong>
                            <span>{enrollment.academic_period.semester_name}</span>
                            <small>Submitted {formatDate(enrollment.created_at)}</small>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="registrar-enrollment-management__placement">
                          <div className="registrar-enrollment-management__placement-topline">
                            <span className="registrar-enrollment-management__cell-icon">
                              <MapPin size={15} aria-hidden="true" />
                            </span>
                            <strong title={enrollment.placement.section_names.join(", ")}>
                              {enrollment.section.section_name || "Not Assigned"}
                            </strong>
                          </div>

                          <div className="registrar-enrollment-management__progress" aria-hidden="true">
                            <span style={{ width: `${progress}%` }} />
                          </div>

                          <div className="registrar-enrollment-management__placement-meta">
                            <span>{placed}/{placementTotal} subjects placed</span>
                            <span
                              className={`registrar-enrollment-management__placement-status ${
                                enrollment.placement.placement_complete
                                  ? "registrar-enrollment-management__placement-status--complete"
                                  : "registrar-enrollment-management__placement-status--needs"
                              }`}
                            >
                              {enrollment.placement.placement_complete
                                ? "Complete"
                                : enrollment.placement.unplaced_subjects > 0
                                  ? `${enrollment.placement.unplaced_subjects} unplaced`
                                  : "Not placed"}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="registrar-enrollment-management__load">
                          <div>
                            <strong>{enrollment.total_subjects}</strong>
                            <span>Subjects</span>
                          </div>
                          <div>
                            <strong>{Number(enrollment.total_units || 0)}</strong>
                            <span>Units</span>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="registrar-enrollment-management__status-cell">
                          <span
                            className={`registrar-enrollment-management__status registrar-enrollment-management__status--${statusTone}`}
                          >
                            {enrollment.enrollment_status}
                          </span>

                          {enrollment.approval.approved_by_username && (
                            <small>
                              By @{enrollment.approval.approved_by_username}
                              {enrollment.approval.approved_at
                                ? ` · ${formatDate(enrollment.approval.approved_at)}`
                                : ""}
                            </small>
                          )}

                          {!enrollment.approval.approved_by_username && enrollment.remarks && (
                            <small title={enrollment.remarks}>{enrollment.remarks}</small>
                          )}
                        </div>
                      </td>

                      <td>
                        <div className="registrar-enrollment-management__row-actions">
                          <button
                            type="button"
                            className="registrar-enrollment-management__review-button"
                            onClick={() =>
                              navigate(`/registrar/enrollment/${enrollment.enrollment_id}`)
                            }
                            aria-label={`Review enrollment for ${getStudentName(enrollment)}`}
                          >
                            <Eye size={15} aria-hidden="true" />
                            Review
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {!loading && error && (
              <div className="registrar-enrollment-management__state registrar-enrollment-management__state--error">
                <span className="registrar-enrollment-management__state-icon">
                  <AlertCircle size={24} aria-hidden="true" />
                </span>
                <div>
                  <h3>Enrollment records could not be loaded</h3>
                  <p>{error}</p>
                </div>
                <button
                  type="button"
                  className="registrar-enrollment-management__button registrar-enrollment-management__button--secondary"
                  onClick={() => setRefreshKey((value) => value + 1)}
                >
                  <RefreshCw size={15} aria-hidden="true" />
                  Try Again
                </button>
              </div>
            )}

            {!loading && !error && enrollments.length === 0 && (
              <div className="registrar-enrollment-management__state">
                <span className="registrar-enrollment-management__state-icon">
                  <GraduationCap size={25} aria-hidden="true" />
                </span>
                <div>
                  <h3>No enrollment records found</h3>
                  <p>
                    {activeFilters.length > 0
                      ? "No enrollments match the current search and filters."
                      : "There are no student enrollment records to review yet."}
                  </p>
                </div>
                {activeFilters.length > 0 && (
                  <button
                    type="button"
                    className="registrar-enrollment-management__button registrar-enrollment-management__button--secondary"
                    onClick={clearAllFilters}
                  >
                    <X size={15} aria-hidden="true" />
                    Clear Filters
                  </button>
                )}
              </div>
            )}
          </div>

          {!loading && !error && totalEnrollments > 0 && (
            <div className="registrar-enrollment-management__pagination">
              <p>
                Showing <strong>{rangeStart}–{rangeEnd}</strong> of{" "}
                <strong>{totalEnrollments.toLocaleString()}</strong> enrollments
              </p>

              <div className="registrar-enrollment-management__pagination-controls">
                <button
                  type="button"
                  className="registrar-enrollment-management__page-button registrar-enrollment-management__page-button--wide"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                >
                  <ChevronLeft size={15} aria-hidden="true" />
                  Previous
                </button>

                <div className="registrar-enrollment-management__page-numbers">
                  {paginationItems.map((item) => {
                    if (typeof item !== "number") {
                      return (
                        <span
                          key={item}
                          className="registrar-enrollment-management__ellipsis"
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
                        className={`registrar-enrollment-management__page-button ${
                          currentPage === item
                            ? "registrar-enrollment-management__page-button--active"
                            : ""
                        }`}
                        onClick={() => setCurrentPage(item)}
                        aria-current={currentPage === item ? "page" : undefined}
                      >
                        {item}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="registrar-enrollment-management__page-button registrar-enrollment-management__page-button--wide"
                  disabled={currentPage >= totalPages}
                  onClick={() =>
                    setCurrentPage((page) => Math.min(totalPages, page + 1))
                  }
                >
                  Next
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </DashboardLayout>
  );
}
