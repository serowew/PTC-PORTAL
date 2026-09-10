import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  BookOpenCheck,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Filter,
  GraduationCap,
  RefreshCw,
  RotateCcw,
  Search,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/MyClasses.css";

const API_BASE_URL = "http://localhost:3000/api/faculty/classes";

interface FacultyInfo {
  faculty_id: number;
  user_id?: number;
  employee_number: string;
  username?: string;
  first_name?: string;
  middle_name?: string | null;
  last_name?: string;
  faculty_name: string;
  email?: string | null;
  contact_number?: string | null;
  department_id?: number | null;
  employment_status?: string | null;
  hire_date?: string | null;
}

interface FacultyClass {
  offering_id: number;
  section_subject_id: number;
  offering_status: "Open" | "Closed" | "Cancelled" | string;
  section_subject_status: string;

  subject: {
    subject_id: number;
    subject_code: string;
    subject_name: string;
    units: number;
    lecture_hours: number;
    laboratory_hours: number;
  };

  section: {
    section_id: number;
    section_name: string;
    year_level: number;

    course: {
      course_id: number;
      course_code: string;
      course_name: string;
    };
  };

  academic_period: {
    academic_year_id: number;
    academic_year: string;
    is_current_academic_year: boolean;
    semester_id: number;
    semester_name: string;
  };

  schedule: {
    days: string | null;
    time: string | null;
  };

  room: {
    room_id: number;
    room_code?: string | null;
    room_name?: string | null;
  } | null;

  capacity: {
    max_students: number;
    official_students: number;
  };

  created_at: string;
}

interface FacultyClassesResponse {
  success: boolean;
  faculty?: FacultyInfo;

  filters?: {
    academic_year_id: number | null;
    semester_id: number | null;
  };

  summary?: {
    total_classes: number;
    open_classes: number;
    closed_classes: number;
    total_official_students: number;
  };

  classes?: FacultyClass[];
  message?: string;
  error?: string;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();

    throw new Error(
      `Server returned a non-JSON response (${response.status}): ${text.slice(
        0,
        200,
      )}`,
    );
  }

  return response.json() as Promise<T>;
}

function formatScheduleDays(value: string | null) {
  if (!value) {
    return "Not scheduled";
  }

  return value
    .split(",")
    .map((day) => {
      const trimmed = day.trim();

      if (!trimmed) {
        return "";
      }

      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
    })
    .filter(Boolean)
    .join(", ");
}

function getRoomLabel(room: FacultyClass["room"]) {
  if (!room) {
    return "Not assigned";
  }

  if (room.room_code && room.room_name) {
    return `${room.room_code} · ${room.room_name}`;
  }

  return room.room_code || room.room_name || "Not assigned";
}

export default function MyClasses() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();
  const userRole = session?.role;
  const authenticated = Boolean(session && token);

  const [faculty, setFaculty] = useState<FacultyInfo | null>(null);
  const [classes, setClasses] = useState<FacultyClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [search, setSearch] = useState("");
  const [academicYear, setAcademicYear] = useState("All");
  const [semester, setSemester] = useState("All");
  const [section, setSection] = useState("All");
  const [status, setStatus] = useState("All");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    if (userRole !== "Faculty") {
      navigate(authService.getDashboardRoute(session!.role), {
        replace: true,
      });
    }
  }, [authenticated, userRole, session, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Faculty") {
      return;
    }

    const controller = new AbortController();

    const loadClasses = async () => {
      try {
        setLoading(true);
        setError("");

        const response = await authService.authFetch(API_BASE_URL, {
          method: "GET",
          signal: controller.signal,
        });

        const data = await readJsonResponse<FacultyClassesResponse>(response);

        if (response.status === 401) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

          return;
        }

        if (response.status === 403) {
          throw new Error(
            "You do not have permission to access Faculty classes.",
          );
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || data.error || "Unable to load Faculty classes.",
          );
        }

        setFaculty(data.faculty || null);
        setClasses(Array.isArray(data.classes) ? data.classes : []);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD FACULTY CLASSES ERROR:", requestError);

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load Faculty classes.",
        );

        setClasses([]);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadClasses();

    return () => {
      controller.abort();
    };
  }, [authenticated, userRole, navigate, refreshKey]);

  const academicYears = useMemo(() => {
    const values = new Map<number, string>();

    classes.forEach((item) => {
      values.set(
        item.academic_period.academic_year_id,
        item.academic_period.academic_year,
      );
    });

    return Array.from(values.entries()).sort((a, b) => b[0] - a[0]);
  }, [classes]);

  const semesters = useMemo(() => {
    const values = new Map<number, string>();

    classes.forEach((item) => {
      values.set(
        item.academic_period.semester_id,
        item.academic_period.semester_name,
      );
    });

    return Array.from(values.entries()).sort((a, b) => a[0] - b[0]);
  }, [classes]);

  const sections = useMemo(() => {
    return Array.from(
      new Set(classes.map((item) => item.section.section_name)),
    ).sort();
  }, [classes]);

  const filteredClasses = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return classes.filter((item) => {
      const matchesSearch =
        !normalizedSearch ||
        item.subject.subject_code.toLowerCase().includes(normalizedSearch) ||
        item.subject.subject_name.toLowerCase().includes(normalizedSearch) ||
        item.section.section_name.toLowerCase().includes(normalizedSearch) ||
        item.section.course.course_code
          .toLowerCase()
          .includes(normalizedSearch) ||
        item.section.course.course_name
          .toLowerCase()
          .includes(normalizedSearch);

      const matchesYear =
        academicYear === "All" ||
        String(item.academic_period.academic_year_id) === academicYear;

      const matchesSemester =
        semester === "All" ||
        String(item.academic_period.semester_id) === semester;

      const matchesSection =
        section === "All" || item.section.section_name === section;

      const matchesStatus = status === "All" || item.offering_status === status;

      return (
        matchesSearch &&
        matchesYear &&
        matchesSemester &&
        matchesSection &&
        matchesStatus
      );
    });
  }, [classes, search, academicYear, semester, section, status]);

  const summary = useMemo(() => {
    return {
      total: filteredClasses.length,
      open: filteredClasses.filter((item) => item.offering_status === "Open")
        .length,
      closed: filteredClasses.filter(
        (item) => item.offering_status === "Closed",
      ).length,
      officialMemberships: filteredClasses.reduce(
        (total, item) => total + Number(item.capacity.official_students || 0),
        0,
      ),
    };
  }, [filteredClasses]);

  const openClass = (item: FacultyClass) => {
    navigate(`/faculty/classes/students?offering_id=${item.offering_id}`);
  };

  const refreshClasses = () => {
    setRefreshKey((current) => current + 1);
  };

  const clearFilters = () => {
    setSearch("");
    setAcademicYear("All");
    setSemester("All");
    setSection("All");
    setStatus("All");
  };

  const hasActiveFilters =
    search.trim() !== "" ||
    academicYear !== "All" ||
    semester !== "All" ||
    section !== "All" ||
    status !== "All";

  if (!authenticated || userRole !== "Faculty") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="faculty-classes-page">
        <section className="faculty-classes-header">
          <div className="faculty-classes-header__copy">
            <div className="faculty-classes-eyebrow">
              <span>
                <BookOpenCheck size={16} strokeWidth={2.2} />
              </span>
              Faculty · Manage Classes
            </div>

            <h1>My Classes</h1>

            <p>
              Review your Registrar-assigned teaching loads, official class
              memberships, schedules, sections, and academic periods.
            </p>
          </div>

          <button
            type="button"
            className="faculty-classes-refresh"
            onClick={refreshClasses}
            disabled={loading}
          >
            <RefreshCw
              size={16}
              className={loading ? "is-spinning" : ""}
            />
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </section>

        {faculty && (
          <section className="faculty-classes-profile">
            <div className="faculty-classes-profile__identity">
              <span className="faculty-classes-profile__icon">
                <GraduationCap size={20} strokeWidth={2.1} />
              </span>

              <div>
                <small>Faculty</small>
                <strong>{faculty.faculty_name}</strong>
              </div>
            </div>

            <div>
              <small>Employee Number</small>
              <strong>{faculty.employee_number}</strong>
            </div>

            <div>
              <small>Employment</small>
              <strong>{faculty.employment_status || "Not recorded"}</strong>
            </div>
          </section>
        )}

        <section
          className="faculty-classes-summary"
          aria-label="Class summary"
        >
          <article className="faculty-class-stat">
            <span className="faculty-class-stat__icon">
              <BookOpenCheck size={19} />
            </span>

            <div>
              <small>Assigned Classes</small>
              <strong>{loading ? "…" : summary.total}</strong>
              <span>Matching the current filters</span>
            </div>
          </article>

          <article className="faculty-class-stat">
            <span className="faculty-class-stat__icon">
              <CheckCircle2 size={19} />
            </span>

            <div>
              <small>Open Classes</small>
              <strong>{loading ? "…" : summary.open}</strong>
              <span>Currently marked open</span>
            </div>
          </article>

          <article className="faculty-class-stat">
            <span className="faculty-class-stat__icon">
              <Clock3 size={19} />
            </span>

            <div>
              <small>Closed Classes</small>
              <strong>{loading ? "…" : summary.closed}</strong>
              <span>Enrollment placement closed</span>
            </div>
          </article>

          <article className="faculty-class-stat">
            <span className="faculty-class-stat__icon">
              <UsersRound size={19} />
            </span>

            <div>
              <small>Official Memberships</small>
              <strong>{loading ? "…" : summary.officialMemberships}</strong>
              <span>Approved enrolled students</span>
            </div>
          </article>
        </section>

        <section className="faculty-classes-filters">
          <header className="faculty-classes-filters__header">
            <div>
              <span className="faculty-classes-filters__icon">
                <Filter size={16} />
              </span>

              <div>
                <strong>Filter Classes</strong>
                <p>
                  Narrow the list by subject, academic period, section, or
                  offering status.
                </p>
              </div>
            </div>

            {hasActiveFilters && (
              <button
                type="button"
                className="faculty-classes-clear"
                onClick={clearFilters}
              >
                <RotateCcw size={14} />
                Clear Filters
              </button>
            )}
          </header>

          <div className="faculty-classes-filter-grid">
            <label className="faculty-classes-search">
              <span>Search</span>

              <div className="faculty-classes-search__control">
                <Search size={15} />

                <input
                  id="faculty-class-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Subject, section, or course..."
                />
              </div>
            </label>

            <label>
              <span>Academic Year</span>

              <select
                value={academicYear}
                onChange={(event) => setAcademicYear(event.target.value)}
              >
                <option value="All">All Academic Years</option>

                {academicYears.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Semester</span>

              <select
                value={semester}
                onChange={(event) => setSemester(event.target.value)}
              >
                <option value="All">All Semesters</option>

                {semesters.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Section</span>

              <select
                value={section}
                onChange={(event) => setSection(event.target.value)}
              >
                <option value="All">All Sections</option>

                {sections.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Status</span>

              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="All">All Statuses</option>
                <option value="Open">Open</option>
                <option value="Closed">Closed</option>
              </select>
            </label>
          </div>
        </section>

        {error && (
          <section className="faculty-classes-error" role="alert">
            <span className="faculty-classes-error__icon">
              <AlertCircle size={20} />
            </span>

            <div>
              <strong>Classes could not be loaded</strong>
              <p>{error}</p>
            </div>

            <button type="button" onClick={refreshClasses}>
              Try Again
            </button>
          </section>
        )}

        {loading && (
          <section className="faculty-classes-loading">
            <div className="faculty-classes-spinner" />

            <div>
              <strong>Loading your classes</strong>
              <span>Retrieving your official teaching assignments...</span>
            </div>
          </section>
        )}

        {!loading && !error && filteredClasses.length === 0 && (
          <section className="faculty-classes-empty">
            <span className="faculty-classes-empty__icon">
              <BookOpenCheck size={24} />
            </span>

            <strong>No classes found</strong>

            <p>
              {classes.length === 0
                ? "No teaching assignments are currently available for your Faculty account."
                : "No assigned classes match the current filters."}
            </p>

            {hasActiveFilters && (
              <button type="button" onClick={clearFilters}>
                <RotateCcw size={14} />
                Clear Filters
              </button>
            )}
          </section>
        )}

        {!loading && !error && filteredClasses.length > 0 && (
          <section className="faculty-classes-content">
            <header className="faculty-classes-content-header">
              <div>
                <span className="faculty-classes-content-kicker">
                  Official Teaching Assignments
                </span>

                <h2>Assigned Classes</h2>

                <p>
                  Student totals are based on approved enrollment memberships
                  assigned to each class offering.
                </p>
              </div>

              <span className="faculty-classes-result-count">
                {filteredClasses.length} class
                {filteredClasses.length === 1 ? "" : "es"}
              </span>
            </header>

            <div className="faculty-classes-table-wrapper">
              <table className="faculty-classes-table">
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Section</th>
                    <th>Academic Period</th>
                    <th>Schedule</th>
                    <th>Room</th>
                    <th>Official Students</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredClasses.map((item) => (
                    <tr key={item.offering_id}>
                      <td>
                        <div className="faculty-class-subject">
                          <strong>{item.subject.subject_code}</strong>
                          <span>{item.subject.subject_name}</span>
                          <small>
                            {item.subject.units} unit
                            {item.subject.units === 1 ? "" : "s"}
                          </small>
                        </div>
                      </td>

                      <td>
                        <div className="faculty-class-cell-stack">
                          <strong>{item.section.section_name}</strong>
                          <small>
                            {item.section.course.course_code} · Year{" "}
                            {item.section.year_level}
                          </small>
                        </div>
                      </td>

                      <td>
                        <div className="faculty-class-cell-stack">
                          <strong>{item.academic_period.academic_year}</strong>
                          <small>
                            {item.academic_period.semester_name}
                            {item.academic_period.is_current_academic_year
                              ? " · Current"
                              : ""}
                          </small>
                        </div>
                      </td>

                      <td>
                        <div className="faculty-class-cell-stack faculty-class-cell-stack--schedule">
                          <strong>
                            <CalendarDays size={13} />
                            {formatScheduleDays(item.schedule.days)}
                          </strong>

                          <small>
                            <Clock3 size={12} />
                            {item.schedule.time || "Not scheduled"}
                          </small>
                        </div>
                      </td>

                      <td>
                        <div className="faculty-class-room">
                          <Building2 size={14} />
                          <span>{getRoomLabel(item.room)}</span>
                        </div>
                      </td>

                      <td>
                        <div className="faculty-class-students">
                          <strong>{item.capacity.official_students}</strong>
                          <small>of {item.capacity.max_students}</small>
                        </div>
                      </td>

                      <td>
                        <span
                          className={`faculty-class-status ${item.offering_status.toLowerCase()}`}
                        >
                          {item.offering_status}
                        </span>
                      </td>

                      <td>
                        <button
                          type="button"
                          className="faculty-class-view"
                          onClick={() => openClass(item)}
                        >
                          View Class
                          <ChevronRight size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </DashboardLayout>
  );
}
