import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  CalendarDays,
  ChevronRight,
  Clock3,
  Filter,
  GraduationCap,
  MapPin,
  RotateCcw,
  Search,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { api } from "../../../services/api";
import "../../../styles/ClassSchedule.css";
import "../../../styles/ProgramHeadTeachingSchedule.css";

const API_URL = api.url("/api/program-head/classes");

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

interface ProgramHeadInfo {
  faculty_id: number | null;
  program_head_name: string;
  department?: {
    department_name: string;
  } | null;
}

interface ProgramHeadClass {
  offering_id: number;
  offering_status: string;

  subject: {
    subject_code: string;
    subject_name: string;
    units: number;
  };

  section: {
    section_name: string;
    year_level: number;
    course: {
      course_code: string;
      course_name: string;
    };
  };

  faculty: {
    faculty_id: number;
    faculty_name: string;
  } | null;

  academic_period: {
    academic_year_id: number;
    academic_year: string;
    semester_id: number;
    semester_name: string;
  };

  schedule: {
    days: string | null;
    time: string | null;
  };

  room?: {
    room_code?: string | null;
    room_name?: string | null;
  } | null;

  capacity?: {
    official_students: number;
  } | null;
}

interface ProgramHeadClassesResponse {
  success: boolean;
  program_head?: ProgramHeadInfo;
  classes?: ProgramHeadClass[];
  message?: string;
  error?: string;
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
    const body = await response.text();

    throw new Error(
      `Server returned a non-JSON response (${response.status}): ${body.slice(
        0,
        200,
      )}`,
    );
  }

  return (await response.json()) as T;
}

function parseScheduleDays(value: string | null): WeekDay[] {
  if (!value) {
    return [];
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

function parseClockValue(value: string): number | null {
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
    } else if (period === "PM" && hours !== 12) {
      hours += 12;
    }

    return hours * 60 + minutes;
  }

  const twentyFourHourMatch = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);

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

function getScheduleStartMinutes(value: string | null): number {
  if (!value) {
    return Number.MAX_SAFE_INTEGER;
  }

  const normalized = value.trim().replace(/[–—]/g, "-");
  const startTime = normalized.split("-")[0]?.trim();

  if (!startTime) {
    return Number.MAX_SAFE_INTEGER;
  }

  return parseClockValue(startTime) ?? Number.MAX_SAFE_INTEGER;
}

function getRoomLabel(room: ProgramHeadClass["room"]): string {
  if (!room) {
    return "Room not assigned";
  }

  if (room.room_code && room.room_name) {
    return `${room.room_code} · ${room.room_name}`;
  }

  return room.room_code || room.room_name || "Room not assigned";
}

function getStatusClassName(status: string): string {
  return status.trim().toLowerCase().replace(/\s+/g, "-");
}

export default function ScheduleList() {
  const navigate = useNavigate();
  const session = authService.getSession();
  const token = authService.getToken();
  const userRole = session?.role;
  const authenticated = Boolean(session && token);

  const [programHead, setProgramHead] = useState<ProgramHeadInfo | null>(null);
  const [classes, setClasses] = useState<ProgramHeadClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLoading, setShowLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [search, setSearch] = useState("");
  const [academicYear, setAcademicYear] = useState("All");
  const [semester, setSemester] = useState("All");
  const [section, setSection] = useState("All");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Program Head" && session?.role) {
      navigate(authService.getDashboardRoute(session.role), {
        replace: true,
      });
    }
  }, [authenticated, userRole, session, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Program Head") {
      return;
    }

    const controller = new AbortController();

    const loadClasses = async () => {
      try {
        setLoading(true);
        setShowLoading(false);
        setError("");

        const response = await authService.authFetch(API_URL, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });

        const data =
          await readJsonResponse<ProgramHeadClassesResponse>(response);

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (response.status === 403) {
          throw new Error(
            data.message ||
              data.error ||
              "You do not have permission to view this schedule.",
          );
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message ||
              data.error ||
              "Unable to load your teaching schedule.",
          );
        }

        const currentProgramHead = data.program_head ?? null;
        setProgramHead(currentProgramHead);

        const ownFacultyId = currentProgramHead?.faculty_id ?? null;

        const ownClasses =
          Array.isArray(data.classes) && ownFacultyId !== null
            ? data.classes.filter(
                (item) =>
                  item.offering_status !== "Cancelled" &&
                  item.faculty?.faculty_id === ownFacultyId,
              )
            : [];

        setClasses(ownClasses);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD PROGRAM HEAD SCHEDULE ERROR:", requestError);

        setProgramHead(null);
        setClasses([]);
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load your teaching schedule.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setShowLoading(false);
          setLoading(false);
        }
      }
    };

    void loadClasses();

    return () => controller.abort();
  }, [authenticated, userRole, navigate, refreshKey]);

  // Skip the loading panel for fast responses; show it only for slower requests.
  useEffect(() => {
    if (!loading || !authenticated || userRole !== "Program Head") return;
    const timer = window.setTimeout(() => setShowLoading(true), 350);
    return () => window.clearTimeout(timer);
  }, [loading, authenticated, userRole]);

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

  const sections = useMemo(
    () =>
      Array.from(
        new Set(classes.map((item) => item.section.section_name)),
      ).sort(),
    [classes],
  );

  const filteredClasses = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return classes.filter((item) => {
      const searchableText = [
        item.subject.subject_code,
        item.subject.subject_name,
        item.section.section_name,
        item.section.course.course_code,
        item.section.course.course_name,
        getRoomLabel(item.room),
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        !normalizedSearch || searchableText.includes(normalizedSearch);

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

  const scheduledClasses = useMemo(
    () =>
      filteredClasses.filter(
        (item) =>
          parseScheduleDays(item.schedule.days).length > 0 &&
          Boolean(item.schedule.time?.trim()),
      ),
    [filteredClasses],
  );

  const unscheduledClasses = useMemo(
    () =>
      filteredClasses.filter(
        (item) =>
          parseScheduleDays(item.schedule.days).length === 0 ||
          !item.schedule.time?.trim(),
      ),
    [filteredClasses],
  );

  const classesByDay = useMemo(() => {
    const grouped = new Map<WeekDay, ProgramHeadClass[]>(
      WEEK_DAYS.map((day) => [day, []]),
    );

    scheduledClasses.forEach((item) => {
      parseScheduleDays(item.schedule.days).forEach((day) => {
        grouped.get(day)?.push(item);
      });
    });

    grouped.forEach((items) => {
      items.sort((a, b) => {
        const difference =
          getScheduleStartMinutes(a.schedule.time) -
          getScheduleStartMinutes(b.schedule.time);

        return (
          difference ||
          a.subject.subject_code.localeCompare(b.subject.subject_code)
        );
      });
    });

    return grouped;
  }, [scheduledClasses]);

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

  const openClassesPage = () => {
    navigate("/programhead/class/management");
  };

  const openOfferingBatches = () => {
    navigate("/programhead/class/offering-batches");
  };

  if (!authenticated || userRole !== "Program Head") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="faculty-schedule-page program-head-teaching-schedule">
        <section className="faculty-schedule-page__hero">
          <div className="faculty-schedule-page__hero-copy">
            <div className="faculty-schedule-page__eyebrow">
              <CalendarDays size={15} />
              Program Head · Teaching Schedule
            </div>

            <h1>My Teaching Schedule</h1>
            <p>Review your assigned classes and weekly timetable.</p>

            {programHead && (
              <small className="faculty-schedule-page__owner">
                {programHead.program_head_name}
                {programHead.department?.department_name
                  ? ` · ${programHead.department.department_name}`
                  : ""}
              </small>
            )}
          </div>

        </section>

        <section className="faculty-schedule-page__filters">
          <header>
            <div>
              <span className="faculty-schedule-page__filters-icon">
                <Filter size={16} />
              </span>

              <div>
                <strong>Filter Schedule</strong>
                <p>Search and filter your assigned classes.</p>
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

        <section className="faculty-schedule-page__read-only-note">
          Schedules are read only on this page. Assign or update schedules in
          Offering Batches. Offerings stay closed until the Registrar publishes
          the batch.
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

        {loading && showLoading && (
          <section className="faculty-schedule-page__loading">
            <div className="faculty-schedule-page__spinner" />
            <div>
              <strong>Loading your class schedule</strong>
              <span>Retrieving your teaching assignments...</span>
            </div>
          </section>
        )}

        {!loading && !error && filteredClasses.length === 0 && (
          <section className="faculty-schedule-page__empty">
            <span>
              <CalendarDays size={25} />
            </span>

            <strong>
              {classes.length === 0
                ? "No teaching assignments found"
                : "No classes match these filters"}
            </strong>

            <p>
              {classes.length === 0
                ? "Your assigned classes will appear here when available."
                : "Try changing your search or filter selections."}
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
            {scheduledClasses.length > 0 ? (
              <section className="faculty-schedule-page__week">
                <header className="faculty-schedule-page__section-header">
                  <div>
                    <span>Weekly Timetable</span>
                    <h2>My Classes</h2>
                    <p>Classes are grouped by day and sorted by start time.</p>
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
                                      {item.capacity?.official_students ??
                                        0}{" "}
                                      official students
                                    </span>
                                  </div>
                                </div>

                                <div className="faculty-schedule-entry__side">
                                  <span
                                    className={`faculty-schedule-entry__status ${getStatusClassName(
                                      item.offering_status,
                                    )}`}
                                  >
                                    {item.offering_status}
                                  </span>

                                  <button
                                    type="button"
                                    onClick={openClassesPage}
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
            ) : (
              <section className="faculty-schedule-page__empty">
                <span>
                  <CalendarDays size={25} />
                </span>
                <strong>No scheduled classes in this view</strong>
                <p>
                  Your filtered classes do not have saved days and times yet.
                  Check the Offering Batches page for scheduling work.
                </p>
                <button type="button" onClick={openOfferingBatches}>
                  Open Offering Batches
                  <ChevronRight size={14} />
                </button>
              </section>
            )}

            {unscheduledClasses.length > 0 && (
              <section className="faculty-schedule-page__unscheduled">
                <header className="faculty-schedule-page__section-header">
                  <div>
                    <span>Needs Scheduling</span>
                    <h2>Unscheduled Classes</h2>
                    <p>
                      Assign or update these schedules in the Offering Batches
                      page.
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
                        <CalendarDays size={18} />
                      </div>

                      <div>
                        <span>{item.subject.subject_code}</span>
                        <strong>{item.subject.subject_name}</strong>
                        <small>
                          {item.section.section_name} ·{" "}
                          {item.section.course.course_code} ·{" "}
                          {item.academic_period.academic_year} ·{" "}
                          {item.academic_period.semester_name}
                        </small>
                      </div>

                      <div className="faculty-schedule-page__unscheduled-actions">
                        <button type="button" onClick={openOfferingBatches}>
                          Open Offering Batches
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
      </main>
    </DashboardLayout>
  );
}
