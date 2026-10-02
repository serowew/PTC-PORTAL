import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  BookOpenCheck,
  Building2,
  CalendarDays,
  ChevronRight,
  Clock3,
  Filter,
  GraduationCap,
  MapPin,
  PencilLine,
  RefreshCw,
  Save,
  RotateCcw,
  Search,
  UsersRound,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/ClassSchedule.css";

const API_BASE_URL = "http://localhost:3000/api/faculty/classes";

const WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

type WeekDay = (typeof WEEK_DAYS)[number];

interface FacultyInfo {
  faculty_id: number;
  employee_number: string;
  faculty_name: string;
  employment_status?: string | null;
}

interface FacultyClass {
  offering_id: number;
  section_subject_id: number;
  offering_status: "Open" | "Closed" | "Cancelled" | string;

  subject: {
    subject_id: number;
    subject_code: string;
    subject_name: string;
    units: number;
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
}

interface FacultyClassesResponse {
  success: boolean;
  faculty?: FacultyInfo;
  classes?: FacultyClass[];
  message?: string;
  error?: string;
}

interface ScheduleConflict {
  offering_id: number;
  subject_code?: string;
  subject_name?: string;
  section_name?: string;
  overlapping_days?: string[];
  schedule_days?: string | null;
  schedule_time?: string | null;
  conflict_types?: string[];
}

interface UpdateScheduleResponse {
  success: boolean;
  message?: string;
  error?: string;
  conflicts?: ScheduleConflict[];
}

const DAY_ALIASES: Record<string, WeekDay> = {
  monday: "Monday",
  mon: "Monday",
  tuesday: "Tuesday",
  tue: "Tuesday",
  tues: "Tuesday",
  wednesday: "Wednesday",
  wed: "Wednesday",
  thursday: "Thursday",
  thu: "Thursday",
  thur: "Thursday",
  thurs: "Thursday",
  friday: "Friday",
  fri: "Friday",
  saturday: "Saturday",
  sat: "Saturday",
  sunday: "Sunday",
  sun: "Sunday",
};

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

function parseScheduleDays(value: string | null) {
  if (!value || typeof value !== "string") {
    return [] as WeekDay[];
  }

  const days: WeekDay[] = [];

  value
    .split(/[,/;&]+/)
    .map((part) => part.trim().toLowerCase().replace(/\./g, ""))
    .filter(Boolean)
    .forEach((part) => {
      const day = DAY_ALIASES[part];

      if (day && !days.includes(day)) {
        days.push(day);
      }
    });

  return days;
}

function parseClockValue(value: string) {
  const text = value.trim().toUpperCase().replace(/\s+/g, "");

  const twelveHourMatch = text.match(/^(\d{1,2})(?::(\d{2}))?(AM|PM)$/);

  if (twelveHourMatch) {
    let hours = Number(twelveHourMatch[1]);
    const minutes = Number(twelveHourMatch[2] || 0);
    const period = twelveHourMatch[3];

    if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) {
      return null;
    }

    if (period === "AM" && hours === 12) {
      hours = 0;
    }

    if (period === "PM" && hours !== 12) {
      hours += 12;
    }

    return hours * 60 + minutes;
  }

  const twentyFourHourMatch = text.match(/^(\d{1,2}):(\d{2})$/);

  if (twentyFourHourMatch) {
    const hours = Number(twentyFourHourMatch[1]);
    const minutes = Number(twentyFourHourMatch[2]);

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return null;
    }

    return hours * 60 + minutes;
  }

  return null;
}

function getScheduleStartMinutes(value: string | null) {
  if (!value) {
    return Number.MAX_SAFE_INTEGER;
  }

  const normalized = value.trim().replace(/[–—]/g, "-");
  const firstPart = normalized.split("-")[0]?.trim();

  if (!firstPart) {
    return Number.MAX_SAFE_INTEGER;
  }

  return parseClockValue(firstPart) ?? Number.MAX_SAFE_INTEGER;
}

function minutesToInputValue(totalMinutes: number | null) {
  if (totalMinutes === null || !Number.isFinite(totalMinutes)) {
    return "";
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseScheduleRange(value: string | null) {
  if (!value) {
    return { start: "", end: "" };
  }

  const parts = value
    .trim()
    .replace(/[–—]/g, "-")
    .split(/\s*-\s*/);

  if (parts.length !== 2) {
    return { start: "", end: "" };
  }

  return {
    start: minutesToInputValue(parseClockValue(parts[0])),
    end: minutesToInputValue(parseClockValue(parts[1])),
  };
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

export default function ClassSchedule() {
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

  const [scheduleClass, setScheduleClass] = useState<FacultyClass | null>(null);
  const [scheduleDays, setScheduleDays] = useState<WeekDay[]>([]);
  const [scheduleStartTime, setScheduleStartTime] = useState("");
  const [scheduleEndTime, setScheduleEndTime] = useState("");
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleConflicts, setScheduleConflicts] = useState<
    ScheduleConflict[]
  >([]);

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
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

    const loadSchedule = async () => {
      try {
        setLoading(true);
        setError("");

        const response = await authService.authFetch(API_BASE_URL, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });

        const data = await readJsonResponse<FacultyClassesResponse>(response);

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (response.status === 403) {
          throw new Error(
            data.message ||
              data.error ||
              "You do not have permission to access the Faculty schedule.",
          );
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message ||
              data.error ||
              "Unable to load your Faculty class schedule.",
          );
        }

        setFaculty(data.faculty || null);

        const loadedClasses = Array.isArray(data.classes)
          ? data.classes.filter((item) => item.offering_status !== "Cancelled")
          : [];

        setClasses(loadedClasses);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD FACULTY CLASS SCHEDULE ERROR:", requestError);

        setClasses([]);
        setFaculty(null);

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load your Faculty class schedule.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadSchedule();

    return () => controller.abort();
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
        getRoomLabel(item.room).toLowerCase().includes(normalizedSearch);

      const matchesAcademicYear =
        academicYear === "All" ||
        String(item.academic_period.academic_year_id) === academicYear;

      const matchesSemester =
        semester === "All" ||
        String(item.academic_period.semester_id) === semester;

      const matchesSection =
        section === "All" || item.section.section_name === section;

      return (
        matchesSearch &&
        matchesAcademicYear &&
        matchesSemester &&
        matchesSection
      );
    });
  }, [classes, search, academicYear, semester, section]);

  const scheduledClasses = useMemo(() => {
    return filteredClasses.filter(
      (item) =>
        parseScheduleDays(item.schedule.days).length > 0 &&
        Boolean(item.schedule.time?.trim()),
    );
  }, [filteredClasses]);

  const unscheduledClasses = useMemo(() => {
    return filteredClasses.filter(
      (item) =>
        parseScheduleDays(item.schedule.days).length === 0 ||
        !item.schedule.time?.trim(),
    );
  }, [filteredClasses]);

  const classesByDay = useMemo(() => {
    const grouped = new Map<WeekDay, FacultyClass[]>(
      WEEK_DAYS.map((day) => [day, []]),
    );

    scheduledClasses.forEach((item) => {
      parseScheduleDays(item.schedule.days).forEach((day) => {
        grouped.get(day)?.push(item);
      });
    });

    grouped.forEach((items) => {
      items.sort((a, b) => {
        const startDifference =
          getScheduleStartMinutes(a.schedule.time) -
          getScheduleStartMinutes(b.schedule.time);

        if (startDifference !== 0) {
          return startDifference;
        }

        return a.subject.subject_code.localeCompare(b.subject.subject_code);
      });
    });

    return grouped;
  }, [scheduledClasses]);

  const teachingDays = useMemo(() => {
    const days = new Set<WeekDay>();

    scheduledClasses.forEach((item) => {
      parseScheduleDays(item.schedule.days).forEach((day) => days.add(day));
    });

    return days.size;
  }, [scheduledClasses]);

  const officialStudents = useMemo(() => {
    return filteredClasses.reduce(
      (total, item) => total + Number(item.capacity.official_students || 0),
      0,
    );
  }, [filteredClasses]);

  const hasActiveFilters =
    search.trim() !== "" ||
    academicYear !== "All" ||
    semester !== "All" ||
    section !== "All";

  const clearFilters = () => {
    setSearch("");
    setAcademicYear("All");
    setSemester("All");
    setSection("All");
  };

  const openClass = (item: FacultyClass) => {
    navigate(`/faculty/classes/students?offering_id=${item.offering_id}`);
  };

  const openScheduleEditor = (item: FacultyClass) => {
    const parsedRange = parseScheduleRange(item.schedule.time);

    setScheduleClass(item);
    setScheduleDays(parseScheduleDays(item.schedule.days));
    setScheduleStartTime(parsedRange.start);
    setScheduleEndTime(parsedRange.end);
    setScheduleError("");
    setScheduleConflicts([]);
  };

  const closeScheduleEditor = () => {
    if (scheduleSaving) {
      return;
    }

    setScheduleClass(null);
    setScheduleDays([]);
    setScheduleStartTime("");
    setScheduleEndTime("");
    setScheduleError("");
    setScheduleConflicts([]);
  };

  const toggleScheduleDay = (day: WeekDay) => {
    setScheduleDays((current) =>
      current.includes(day)
        ? current.filter((item) => item !== day)
        : WEEK_DAYS.filter((item) => item === day || current.includes(item)),
    );

    setScheduleError("");
    setScheduleConflicts([]);
  };

  const saveSchedule = async () => {
    if (!scheduleClass) {
      return;
    }

    if (scheduleDays.length === 0) {
      setScheduleError("Select at least one class day.");
      return;
    }

    if (!scheduleStartTime) {
      setScheduleError("Select a start time.");
      return;
    }

    if (!scheduleEndTime) {
      setScheduleError("Select an end time.");
      return;
    }

    if (scheduleStartTime >= scheduleEndTime) {
      setScheduleError("End time must be later than the start time.");
      return;
    }

    try {
      setScheduleSaving(true);
      setScheduleError("");
      setScheduleConflicts([]);

      const response = await authService.authFetch(
        `${API_BASE_URL}/${scheduleClass.offering_id}/schedule`,
        {
          method: "PUT",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            schedule_days: scheduleDays.join(", "),
            schedule_start_time: `${scheduleStartTime}:00`,
            schedule_end_time: `${scheduleEndTime}:00`,
          }),
        },
      );

      const data = await readJsonResponse<UpdateScheduleResponse>(response);

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return;
      }

      if (response.status === 409 && Array.isArray(data.conflicts)) {
        setScheduleConflicts(data.conflicts);
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Unable to save the class schedule.",
        );
      }

      closeScheduleEditor();
      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      console.error("SAVE FACULTY CLASS SCHEDULE ERROR:", requestError);

      setScheduleError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to save the class schedule.",
      );
    } finally {
      setScheduleSaving(false);
    }
  };

  if (!authenticated || userRole !== "Faculty") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="faculty-schedule-page">
        <section className="faculty-schedule-page__hero">
          <div className="faculty-schedule-page__hero-copy">
            <div className="faculty-schedule-page__eyebrow">
              <span>
                <CalendarDays size={16} strokeWidth={2.2} />
              </span>
              Faculty · Manage Classes
            </div>

            <h1>Class Schedule</h1>

            <p>
              Review your Registrar-assigned classes and set or update your own
              teaching day and time.
            </p>
          </div>

          <button
            type="button"
            className="faculty-schedule-page__refresh"
            onClick={() => setRefreshKey((current) => current + 1)}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? "is-spinning" : ""} />
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </section>

        {faculty && (
          <section className="faculty-schedule-page__faculty">
            <div className="faculty-schedule-page__faculty-main">
              <span className="faculty-schedule-page__faculty-icon">
                <GraduationCap size={20} />
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
          className="faculty-schedule-page__summary"
          aria-label="Schedule summary"
        >
          <article>
            <span className="faculty-schedule-page__summary-icon">
              <BookOpenCheck size={19} />
            </span>

            <div>
              <small>Scheduled Classes</small>
              <strong>{loading ? "…" : scheduledClasses.length}</strong>
              <span>Unique assigned offerings</span>
            </div>
          </article>

          <article>
            <span className="faculty-schedule-page__summary-icon">
              <CalendarDays size={19} />
            </span>

            <div>
              <small>Teaching Days</small>
              <strong>{loading ? "…" : teachingDays}</strong>
              <span>Days with scheduled classes</span>
            </div>
          </article>

          <article>
            <span className="faculty-schedule-page__summary-icon">
              <UsersRound size={19} />
            </span>

            <div>
              <small>Official Memberships</small>
              <strong>{loading ? "…" : officialStudents}</strong>
              <span>Across the filtered classes</span>
            </div>
          </article>

          <article>
            <span className="faculty-schedule-page__summary-icon">
              <Clock3 size={19} />
            </span>

            <div>
              <small>Unscheduled</small>
              <strong>{loading ? "…" : unscheduledClasses.length}</strong>
              <span>Missing day or time assignment</span>
            </div>
          </article>
        </section>

        <section className="faculty-schedule-page__filters">
          <header>
            <div>
              <span className="faculty-schedule-page__filters-icon">
                <Filter size={16} />
              </span>

              <div>
                <strong>Filter Schedule</strong>
                <p>
                  Narrow your timetable by subject, academic year, semester, or
                  section.
                </p>
              </div>
            </div>

            {hasActiveFilters && (
              <button type="button" onClick={clearFilters}>
                <RotateCcw size={14} />
                Clear Filters
              </button>
            )}
          </header>

          <div className="faculty-schedule-page__filter-grid">
            <label className="faculty-schedule-page__search">
              <span>Search</span>

              <div>
                <Search size={15} />

                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Subject, section, course, or room..."
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
          </div>
        </section>

        {error && (
          <section className="faculty-schedule-page__error" role="alert">
            <span>
              <AlertCircle size={20} />
            </span>

            <div>
              <strong>Schedule could not be loaded</strong>
              <p>{error}</p>
            </div>

            <button
              type="button"
              onClick={() => setRefreshKey((current) => current + 1)}
            >
              Try Again
            </button>
          </section>
        )}

        {loading && (
          <section className="faculty-schedule-page__loading">
            <div className="faculty-schedule-page__spinner" />

            <div>
              <strong>Loading your class schedule</strong>
              <span>Retrieving your official teaching assignments...</span>
            </div>
          </section>
        )}

        {!loading && !error && filteredClasses.length === 0 && (
          <section className="faculty-schedule-page__empty">
            <span>
              <CalendarDays size={25} />
            </span>

            <strong>No scheduled classes found</strong>

            <p>
              {classes.length === 0
                ? "No teaching assignments are currently connected to your Faculty account."
                : "No classes match the current schedule filters."}
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
          <>
            <section className="faculty-schedule-page__week">
              <header className="faculty-schedule-page__section-header">
                <div>
                  <span>Weekly Timetable</span>
                  <h2>Your Teaching Schedule</h2>
                  <p>
                    Classes are grouped by your saved teaching days and sorted
                    by starting time.
                  </p>
                </div>

                <span className="faculty-schedule-page__count">
                  {scheduledClasses.length} scheduled
                </span>
              </header>

              <div className="faculty-schedule-page__days">
                {WEEK_DAYS.map((day) => {
                  const dayClasses = classesByDay.get(day) || [];

                  return (
                    <article
                      className={`faculty-schedule-day ${
                        dayClasses.length === 0
                          ? "faculty-schedule-day--empty"
                          : ""
                      }`}
                      key={day}
                    >
                      <header className="faculty-schedule-day__header">
                        <div>
                          <span>{day.slice(0, 3)}</span>
                          <strong>{day}</strong>
                        </div>

                        <small>
                          {dayClasses.length} class
                          {dayClasses.length === 1 ? "" : "es"}
                        </small>
                      </header>

                      <div className="faculty-schedule-day__list">
                        {dayClasses.length === 0 ? (
                          <div className="faculty-schedule-day__no-class">
                            <CalendarDays size={18} />
                            <span>No classes</span>
                          </div>
                        ) : (
                          dayClasses.map((item) => (
                            <div
                              className="faculty-schedule-entry"
                              key={`${day}-${item.offering_id}`}
                            >
                              <div className="faculty-schedule-entry__time">
                                <Clock3 size={14} />
                                <strong>
                                  {item.schedule.time || "Not scheduled"}
                                </strong>
                              </div>

                              <div className="faculty-schedule-entry__main">
                                <div className="faculty-schedule-entry__subject">
                                  <span>{item.subject.subject_code}</span>
                                  <strong>{item.subject.subject_name}</strong>
                                </div>

                                <div className="faculty-schedule-entry__meta">
                                  <span>
                                    <GraduationCap size={13} />
                                    {item.section.section_name} ·{" "}
                                    {item.section.course.course_code}
                                  </span>

                                  <span>
                                    <MapPin size={13} />
                                    {getRoomLabel(item.room)}
                                  </span>

                                  <span>
                                    <UsersRound size={13} />
                                    {item.capacity.official_students} official
                                  </span>
                                </div>
                              </div>

                              <div className="faculty-schedule-entry__side">
                                <span
                                  className={`faculty-schedule-entry__status ${item.offering_status.toLowerCase()}`}
                                >
                                  {item.offering_status}
                                </span>

                                <button
                                  type="button"
                                  onClick={() => openScheduleEditor(item)}
                                >
                                  <PencilLine size={14} />
                                  Edit Schedule
                                </button>

                                <button
                                  type="button"
                                  onClick={() => openClass(item)}
                                >
                                  View Class
                                  <ChevronRight size={14} />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            {unscheduledClasses.length > 0 && (
              <section className="faculty-schedule-page__unscheduled">
                <header className="faculty-schedule-page__section-header">
                  <div>
                    <span>Needs Scheduling</span>
                    <h2>Unscheduled Classes</h2>
                    <p>
                      These Registrar-assigned classes are waiting for you to
                      enter a teaching day and time.
                    </p>
                  </div>

                  <span className="faculty-schedule-page__count">
                    {unscheduledClasses.length} pending
                  </span>
                </header>

                <div className="faculty-schedule-page__unscheduled-grid">
                  {unscheduledClasses.map((item) => (
                    <article key={item.offering_id}>
                      <div className="faculty-schedule-page__unscheduled-icon">
                        <Building2 size={18} />
                      </div>

                      <div>
                        <span>{item.subject.subject_code}</span>
                        <strong>{item.subject.subject_name}</strong>
                        <small>
                          {item.section.section_name} ·{" "}
                          {item.section.course.course_code}
                        </small>
                      </div>

                      <div className="faculty-schedule-page__unscheduled-actions">
                        <button
                          type="button"
                          onClick={() => openScheduleEditor(item)}
                        >
                          <CalendarDays size={14} />
                          Set Schedule
                        </button>

                        <button type="button" onClick={() => openClass(item)}>
                          View Class
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {scheduleClass && (
          <div
            className="faculty-schedule-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeScheduleEditor();
              }
            }}
          >
            <section
              className="faculty-schedule-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="faculty-schedule-modal-title"
            >
              <header className="faculty-schedule-modal__header">
                <div>
                  <span>Teaching Schedule</span>
                  <h2 id="faculty-schedule-modal-title">
                    {scheduleClass.schedule.days && scheduleClass.schedule.time
                      ? "Edit Class Schedule"
                      : "Set Class Schedule"}
                  </h2>
                  <p>
                    {scheduleClass.subject.subject_code} ·{" "}
                    {scheduleClass.section.section_name}
                  </p>
                </div>

                <button
                  type="button"
                  aria-label="Close schedule editor"
                  disabled={scheduleSaving}
                  onClick={closeScheduleEditor}
                >
                  <X size={18} />
                </button>
              </header>

              <div className="faculty-schedule-modal__body">
                <div className="faculty-schedule-modal__class">
                  <strong>{scheduleClass.subject.subject_name}</strong>
                  <span>
                    {scheduleClass.section.course.course_code} ·{" "}
                    {scheduleClass.academic_period.academic_year} ·{" "}
                    {scheduleClass.academic_period.semester_name}
                  </span>
                </div>

                {scheduleError && (
                  <div className="faculty-schedule-modal__error" role="alert">
                    <AlertCircle size={17} />
                    <span>{scheduleError}</span>
                  </div>
                )}

                {scheduleConflicts.length > 0 && (
                  <div className="faculty-schedule-modal__conflicts">
                    <strong>Conflicting classes</strong>

                    {scheduleConflicts.map((conflict) => (
                      <div key={conflict.offering_id}>
                        <span>
                          {conflict.subject_code || "Class"}
                          {conflict.section_name
                            ? ` · ${conflict.section_name}`
                            : ""}
                        </span>
                        <small>
                          {[
                            conflict.schedule_days,
                            conflict.schedule_time,
                            conflict.conflict_types?.join(" / "),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </div>
                    ))}
                  </div>
                )}

                <fieldset className="faculty-schedule-modal__days">
                  <legend>Class Day</legend>

                  <div>
                    {WEEK_DAYS.map((day) => (
                      <label key={day}>
                        <input
                          type="checkbox"
                          checked={scheduleDays.includes(day)}
                          disabled={scheduleSaving}
                          onChange={() => toggleScheduleDay(day)}
                        />
                        <span>{day}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="faculty-schedule-modal__time-grid">
                  <label>
                    <span>Start Time</span>
                    <input
                      type="time"
                      value={scheduleStartTime}
                      disabled={scheduleSaving}
                      onChange={(event) => {
                        setScheduleStartTime(event.target.value);
                        setScheduleError("");
                        setScheduleConflicts([]);
                      }}
                    />
                  </label>

                  <label>
                    <span>End Time</span>
                    <input
                      type="time"
                      value={scheduleEndTime}
                      disabled={scheduleSaving}
                      onChange={(event) => {
                        setScheduleEndTime(event.target.value);
                        setScheduleError("");
                        setScheduleConflicts([]);
                      }}
                    />
                  </label>
                </div>

                <p className="faculty-schedule-modal__note">
                  The system checks instructor and section conflicts before
                  saving. If the schedule passes validation, the offering
                  becomes Open.
                </p>
              </div>

              <footer className="faculty-schedule-modal__footer">
                <button
                  type="button"
                  disabled={scheduleSaving}
                  onClick={closeScheduleEditor}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={
                    scheduleSaving ||
                    scheduleDays.length === 0 ||
                    !scheduleStartTime ||
                    !scheduleEndTime
                  }
                  onClick={() => void saveSchedule()}
                >
                  <Save size={15} />
                  {scheduleSaving ? "Saving..." : "Save Schedule"}
                </button>
              </footer>
            </section>
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}
