import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  BookOpenCheck,
  Building2,
  CalendarDays,
  Clock3,
  Filter,
  GraduationCap,
  MapPin,
  RefreshCw,
  RotateCcw,
  Search,
  UserRound,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import "../../../styles/RegistrarTeachingSchedules.css";

const API_BASE_URL = apiUrl("/api/registrar/offerings/teaching-schedules");

const WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

type WeekDay = (typeof WEEK_DAYS)[number];

interface TeachingUser {
  faculty_id: number;
  user_id: number;
  employee_number: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  name: string;
  email: string | null;
  username: string | null;
  department_id: number | null;
  employment_status: string | null;
  role_id: number;
  role_name: "Faculty" | "Program Head";
  is_active: boolean;
  is_verified: boolean;

  department?: {
    department_id: number | null;
    department_code: string | null;
    department_name: string | null;
  };

  total_classes?: number;
  scheduled_classes?: number;
  unscheduled_classes?: number;
}

interface TeachingUserAlias {
  faculty_id: number;
  user_id: number;
  employee_number: string;
  faculty_name: string;
  email: string | null;
  department_id: number | null;
  employment_status: string | null;
  username: string | null;
  role_id: number;
  role_name: "Faculty" | "Program Head";
}

interface RegistrarOffering {
  offering_id: number;
  section_subject_id: number;
  section_subject_status: string;
  status: string;
  created_at: string | null;
  updated_at?: string | null;

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
    max_students: number;

    course: {
      course_id: number;
      course_code: string;
      course_name: string;
    };
  };

  department?: {
    department_id: number | null;
    department_code: string | null;
    department_name: string | null;
  };

  academic_period: {
    academic_year_id: number;
    academic_year: string;
    semester_id: number;
    semester_name: string;
  };

  teaching_user: TeachingUser;
  faculty: TeachingUserAlias;

  room: {
    room_id: number;
    room_code: string | null;
    room_name: string | null;
    building_name: string | null;
    capacity: number | null;
  } | null;

  schedule?: {
    days: string | null;
    time: string | null;
    start_time: string | null;
    end_time: string | null;
    status: string;
  };

  schedule_days: string | null;
  schedule_time: string | null;
  schedule_start_time: string | null;
  schedule_end_time: string | null;
  schedule_status: string | null;

  max_students: number;
  enrolled_count: number;
  available_slots: number | null;
}

interface RegistrarTeachingSchedulesResponse {
  success: boolean;
  role_filter?: string | null;
  allowed_roles?: string[];

  summary?: {
    total_teaching_users: number;
    faculty_users: number;
    program_head_users: number;
    total_offerings: number;
    faculty_offerings: number;
    program_head_offerings: number;
    scheduled: number;
    unscheduled: number;
  };

  teaching_users?: TeachingUser[];
  count?: number;
  offerings?: RegistrarOffering[];

  message?: string;
  error?: string;
}

interface TeachingUserOption {
  faculty_id: number;
  employee_number: string;
  faculty_name: string;
  email: string | null;
  username: string | null;
  employment_status: string | null;
  department_id: number | null;
  role_name: "Faculty" | "Program Head";
  total_classes: number;
  scheduled_classes: number;
  unscheduled_classes: number;
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

function getScheduleStartMinutes(item: RegistrarOffering) {
  if (item.schedule_start_time) {
    const structured = parseClockValue(item.schedule_start_time);

    if (structured !== null) {
      return structured;
    }
  }

  if (!item.schedule_time) {
    return Number.MAX_SAFE_INTEGER;
  }

  const normalized = item.schedule_time.trim().replace(/[–—]/g, "-");
  const firstPart = normalized.split("-")[0]?.trim();

  if (!firstPart) {
    return Number.MAX_SAFE_INTEGER;
  }

  return parseClockValue(firstPart) ?? Number.MAX_SAFE_INTEGER;
}

function getRoomLabel(room: RegistrarOffering["room"]) {
  if (!room) {
    return "Not assigned";
  }

  const roomLabel =
    room.room_code && room.room_name
      ? `${room.room_code} · ${room.room_name}`
      : room.room_code || room.room_name || "Not assigned";

  if (room.building_name && roomLabel !== "Not assigned") {
    return `${roomLabel} · ${room.building_name}`;
  }

  return roomLabel;
}

function hasCompleteSchedule(item: RegistrarOffering) {
  return (
    parseScheduleDays(item.schedule_days).length > 0 &&
    Boolean(item.schedule_time?.trim())
  );
}

export default function FacultySchedulesR() {
  const navigate = useNavigate();
  const session = authService.getSession();
  const token = authService.getToken();

  const userRole = session?.role;
  const authenticated = Boolean(session && token);

  const [offerings, setOfferings] = useState<RegistrarOffering[]>([]);
  const [teachingUsers, setTeachingUsers] = useState<TeachingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [teachingRole, setTeachingRole] = useState<
    "All" | "Faculty" | "Program Head"
  >("All");

  const [selectedTeachingUserId, setSelectedTeachingUserId] = useState("");

  const [search, setSearch] = useState("");
  const [academicYear, setAcademicYear] = useState("All");
  const [semester, setSemester] = useState("All");
  const [section, setSection] = useState("All");

  // =====================================================
  // AUTHORIZATION
  // =====================================================

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Registrar") {
      navigate(authService.getDashboardRoute(session!.role), {
        replace: true,
      });
    }
  }, [authenticated, userRole, session, navigate]);

  // =====================================================
  // LOAD REGISTRAR TEACHING SCHEDULES
  // =====================================================

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") {
      return;
    }

    const controller = new AbortController();

    const loadTeachingSchedules = async () => {
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

        const data =
          await readJsonResponse<RegistrarTeachingSchedulesResponse>(response);

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (response.status === 403) {
          throw new Error(
            data.message ||
              data.error ||
              "You do not have permission to view teaching schedules.",
          );
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || data.error || "Unable to load teaching schedules.",
          );
        }

        const teachingOfferings = Array.isArray(data.offerings)
          ? data.offerings.filter(
              (item) =>
                item.status !== "Cancelled" &&
                (item.teaching_user?.role_name === "Faculty" ||
                  item.teaching_user?.role_name === "Program Head"),
            )
          : [];

        const backendTeachingUsers = Array.isArray(data.teaching_users)
          ? data.teaching_users.filter(
              (item) =>
                item.role_name === "Faculty" ||
                item.role_name === "Program Head",
            )
          : [];

        setOfferings(teachingOfferings);
        setTeachingUsers(backendTeachingUsers);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD REGISTRAR TEACHING SCHEDULES ERROR:", requestError);

        setOfferings([]);
        setTeachingUsers([]);

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load teaching schedules.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadTeachingSchedules();

    return () => controller.abort();
  }, [authenticated, userRole, navigate, refreshKey]);

  // =====================================================
  // TEACHING USER LIST
  // =====================================================

  const teachingUserOptions = useMemo<TeachingUserOption[]>(() => {
    return teachingUsers
      .filter(
        (item) => teachingRole === "All" || item.role_name === teachingRole,
      )
      .map((item) => ({
        faculty_id: item.faculty_id,
        employee_number: item.employee_number,
        faculty_name: item.name,
        email: item.email,
        username: item.username,
        employment_status: item.employment_status,
        department_id: item.department_id,
        role_name: item.role_name,
        total_classes: Number(item.total_classes || 0),
        scheduled_classes: Number(item.scheduled_classes || 0),
        unscheduled_classes: Number(item.unscheduled_classes || 0),
      }))
      .sort((a, b) => {
        if (a.role_name !== b.role_name) {
          return a.role_name.localeCompare(b.role_name);
        }

        return a.faculty_name.localeCompare(b.faculty_name);
      });
  }, [teachingUsers, teachingRole]);

  useEffect(() => {
    if (teachingUserOptions.length === 0) {
      setSelectedTeachingUserId("");
      return;
    }

    const selectedStillExists = teachingUserOptions.some(
      (item) => String(item.faculty_id) === selectedTeachingUserId,
    );

    if (!selectedStillExists) {
      setSelectedTeachingUserId(String(teachingUserOptions[0].faculty_id));
    }
  }, [teachingUserOptions, selectedTeachingUserId]);

  const selectedTeachingUser = useMemo(() => {
    return (
      teachingUserOptions.find(
        (item) => String(item.faculty_id) === selectedTeachingUserId,
      ) || null
    );
  }, [teachingUserOptions, selectedTeachingUserId]);

  const selectedTeachingUserClasses = useMemo(() => {
    if (!selectedTeachingUserId) {
      return [];
    }

    return offerings.filter(
      (item) =>
        String(item.teaching_user?.faculty_id || "") === selectedTeachingUserId,
    );
  }, [offerings, selectedTeachingUserId]);

  // =====================================================
  // FILTER OPTIONS
  // =====================================================

  const academicYears = useMemo(() => {
    const values = new Map<number, string>();

    selectedTeachingUserClasses.forEach((item) => {
      values.set(
        item.academic_period.academic_year_id,
        item.academic_period.academic_year,
      );
    });

    return Array.from(values.entries()).sort((a, b) => b[0] - a[0]);
  }, [selectedTeachingUserClasses]);

  const semesters = useMemo(() => {
    const values = new Map<number, string>();

    selectedTeachingUserClasses.forEach((item) => {
      values.set(
        item.academic_period.semester_id,
        item.academic_period.semester_name,
      );
    });

    return Array.from(values.entries()).sort((a, b) => a[0] - b[0]);
  }, [selectedTeachingUserClasses]);

  const sections = useMemo(() => {
    return Array.from(
      new Set(
        selectedTeachingUserClasses.map((item) => item.section.section_name),
      ),
    ).sort();
  }, [selectedTeachingUserClasses]);

  useEffect(() => {
    setSearch("");
    setAcademicYear("All");
    setSemester("All");
    setSection("All");
  }, [selectedTeachingUserId, teachingRole]);

  // =====================================================
  // FILTERED CLASSES
  // =====================================================

  const filteredClasses = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return selectedTeachingUserClasses.filter((item) => {
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
  }, [selectedTeachingUserClasses, search, academicYear, semester, section]);

  const scheduledClasses = useMemo(() => {
    return filteredClasses.filter(hasCompleteSchedule);
  }, [filteredClasses]);

  const unscheduledClasses = useMemo(() => {
    return filteredClasses.filter((item) => !hasCompleteSchedule(item));
  }, [filteredClasses]);

  // =====================================================
  // WEEKLY GROUPING
  // =====================================================

  const classesByDay = useMemo(() => {
    const grouped = new Map<WeekDay, RegistrarOffering[]>(
      WEEK_DAYS.map((day) => [day, []]),
    );

    scheduledClasses.forEach((item) => {
      parseScheduleDays(item.schedule_days).forEach((day) => {
        grouped.get(day)?.push(item);
      });
    });

    grouped.forEach((items) => {
      items.sort((a, b) => {
        const startDifference =
          getScheduleStartMinutes(a) - getScheduleStartMinutes(b);

        if (startDifference !== 0) {
          return startDifference;
        }

        return a.subject.subject_code.localeCompare(b.subject.subject_code);
      });
    });

    return grouped;
  }, [scheduledClasses]);

  // =====================================================
  // SUMMARY
  // =====================================================

  const teachingDays = useMemo(() => {
    const days = new Set<WeekDay>();

    scheduledClasses.forEach((item) => {
      parseScheduleDays(item.schedule_days).forEach((day) => days.add(day));
    });

    return days.size;
  }, [scheduledClasses]);

  const enrolledStudents = useMemo(() => {
    return filteredClasses.reduce(
      (total, item) => total + Number(item.enrolled_count || 0),
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

  if (!authenticated || userRole !== "Registrar") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="registrar-teaching-schedule">
        {/* =================================================
            HERO
            ================================================= */}

        <section className="registrar-teaching-schedule__hero">
          <div className="registrar-teaching-schedule__hero-copy">
            <div className="registrar-teaching-schedule__eyebrow">
              <span>
                <CalendarDays size={16} strokeWidth={2.2} />
              </span>
              Registrar · Teaching Schedule Monitoring
            </div>

            <h1>Teaching Schedules</h1>

            <p>
              Review the teaching schedules of both Faculty and Program Head
              teaching users across class offerings. This page is view-only.
            </p>
          </div>

          <button
            type="button"
            className="registrar-teaching-schedule__refresh"
            onClick={() => setRefreshKey((current) => current + 1)}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? "is-spinning" : ""} />
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </section>
        {/* =================================================
            TEACHING USER SELECTOR
            ================================================= */}

        <section className="registrar-teaching-schedule__faculty">
          <div className="registrar-teaching-schedule__faculty-main">
            <span className="registrar-teaching-schedule__faculty-icon">
              <UserRound size={20} />
            </span>

            <div>
              <small>Teaching Role</small>

              <select
                value={teachingRole}
                onChange={(event) =>
                  setTeachingRole(
                    event.target.value as "All" | "Faculty" | "Program Head",
                  )
                }
                aria-label="Select teaching role"
              >
                <option value="All">Faculty & Program Head</option>
                <option value="Faculty">Faculty</option>
                <option value="Program Head">Program Head</option>
              </select>
            </div>
          </div>

          <div>
            <small>Teaching User</small>

            {teachingUserOptions.length > 0 ? (
              <select
                value={selectedTeachingUserId}
                onChange={(event) =>
                  setSelectedTeachingUserId(event.target.value)
                }
                aria-label="Select teaching user"
              >
                {teachingUserOptions.map((item) => (
                  <option key={item.faculty_id} value={item.faculty_id}>
                    {item.faculty_name} · {item.role_name}
                  </option>
                ))}
              </select>
            ) : (
              <strong>No teaching assignments</strong>
            )}
          </div>

          <div>
            <small>Role / Employee Number</small>

            <strong>
              {selectedTeachingUser
                ? `${selectedTeachingUser.role_name} · ${selectedTeachingUser.employee_number}`
                : "—"}
            </strong>
          </div>
        </section>

        {/* =================================================
            SUMMARY
            ================================================= */}

        <section
          className="registrar-teaching-schedule__summary"
          aria-label="Teaching schedule summary"
        >
          <article>
            <span className="registrar-teaching-schedule__summary-icon">
              <BookOpenCheck size={19} />
            </span>

            <div>
              <small>Scheduled Classes</small>
              <strong>{loading ? "…" : scheduledClasses.length}</strong>
              <span>For the selected teaching user</span>
            </div>
          </article>

          <article>
            <span className="registrar-teaching-schedule__summary-icon">
              <CalendarDays size={19} />
            </span>

            <div>
              <small>Teaching Days</small>
              <strong>{loading ? "…" : teachingDays}</strong>
              <span>Days with scheduled classes</span>
            </div>
          </article>

          <article>
            <span className="registrar-teaching-schedule__summary-icon">
              <UsersRound size={19} />
            </span>

            <div>
              <small>Enrolled Students</small>
              <strong>{loading ? "…" : enrolledStudents}</strong>
              <span>Across the filtered offerings</span>
            </div>
          </article>

          <article>
            <span className="registrar-teaching-schedule__summary-icon">
              <Clock3 size={19} />
            </span>

            <div>
              <small>Unscheduled</small>
              <strong>{loading ? "…" : unscheduledClasses.length}</strong>
              <span>Missing day or time assignment</span>
            </div>
          </article>
        </section>

        {/* =================================================
            FILTERS
            ================================================= */}

        <section className="registrar-teaching-schedule__filters">
          <header>
            <div>
              <span className="registrar-teaching-schedule__filters-icon">
                <Filter size={16} />
              </span>

              <div>
                <strong>Filter Schedule</strong>

                <p>
                  Narrow the selected teaching-user timetable by subject,
                  academic year, semester, or section.
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

          <div className="registrar-teaching-schedule__filter-grid">
            <label className="registrar-teaching-schedule__search">
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

        {/* =================================================
            ERROR
            ================================================= */}

        {error && (
          <section className="registrar-teaching-schedule__error" role="alert">
            <span>
              <AlertCircle size={20} />
            </span>

            <div>
              <strong>Teaching schedules could not be loaded</strong>
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

        {/* =================================================
            LOADING
            ================================================= */}

        {loading && (
          <section className="registrar-teaching-schedule__loading">
            <div className="registrar-teaching-schedule__spinner" />

            <div>
              <strong>Loading teaching schedules</strong>
              <span>Retrieving Registrar class offerings...</span>
            </div>
          </section>
        )}

        {/* =================================================
            NO FACULTY
            ================================================= */}

        {!loading && !error && teachingUserOptions.length === 0 && (
          <section className="registrar-teaching-schedule__empty">
            <span>
              <UserRound size={25} />
            </span>

            <strong>No teaching assignments found</strong>

            <p>
              There are currently no class offerings assigned to a Faculty or
              Program Head teaching user.
            </p>
          </section>
        )}

        {/* =================================================
            NO FILTER RESULTS
            ================================================= */}

        {!loading &&
          !error &&
          teachingUserOptions.length > 0 &&
          filteredClasses.length === 0 && (
            <section className="registrar-teaching-schedule__empty">
              <span>
                <CalendarDays size={25} />
              </span>

              <strong>No classes found</strong>

              <p>
                {selectedTeachingUserClasses.length === 0
                  ? "The selected teaching user has no assigned classes."
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

        {/* =================================================
            WEEKLY SCHEDULE
            ================================================= */}

        {!loading && !error && filteredClasses.length > 0 && (
          <>
            <section className="registrar-teaching-schedule__week">
              <header className="registrar-teaching-schedule__section-header">
                <div>
                  <span>Weekly Timetable</span>

                  <h2>
                    {selectedTeachingUser?.faculty_name || "Teaching User"}{" "}
                    Schedule
                  </h2>

                  <p>
                    Classes are grouped by saved teaching days and sorted by
                    starting time.
                  </p>
                </div>

                <span className="registrar-teaching-schedule__count">
                  {scheduledClasses.length} scheduled
                </span>
              </header>

              <div className="registrar-teaching-schedule__days">
                {WEEK_DAYS.map((day) => {
                  const dayClasses = classesByDay.get(day) || [];

                  return (
                    <article
                      className={`registrar-teaching-day ${
                        dayClasses.length === 0
                          ? "registrar-teaching-day--empty"
                          : ""
                      }`}
                      key={day}
                    >
                      <header className="registrar-teaching-day__header">
                        <div>
                          <span>{day.slice(0, 3)}</span>
                          <strong>{day}</strong>
                        </div>

                        <small>
                          {dayClasses.length} class
                          {dayClasses.length === 1 ? "" : "es"}
                        </small>
                      </header>

                      <div className="registrar-teaching-day__list">
                        {dayClasses.length === 0 ? (
                          <div className="registrar-teaching-day__no-class">
                            <CalendarDays size={18} />
                            <span>No classes</span>
                          </div>
                        ) : (
                          dayClasses.map((item) => (
                            <div
                              className="registrar-teaching-entry"
                              key={`${day}-${item.offering_id}`}
                            >
                              <div className="registrar-teaching-entry__time">
                                <Clock3 size={14} />

                                <strong>
                                  {item.schedule_time || "Not scheduled"}
                                </strong>
                              </div>

                              <div className="registrar-teaching-entry__main">
                                <div className="registrar-teaching-entry__subject">
                                  <span>{item.subject.subject_code}</span>
                                  <strong>{item.subject.subject_name}</strong>
                                </div>

                                <div className="registrar-teaching-entry__meta">
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
                                    {item.enrolled_count} enrolled
                                  </span>
                                </div>
                              </div>

                              <div className="registrar-teaching-entry__side">
                                <span
                                  className={`registrar-teaching-entry__status ${item.status.toLowerCase()}`}
                                >
                                  {item.status}
                                </span>
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

            {/* =============================================
                UNSCHEDULED CLASSES
                ============================================= */}

            {unscheduledClasses.length > 0 && (
              <section className="registrar-teaching-schedule__unscheduled">
                <header className="registrar-teaching-schedule__section-header">
                  <div>
                    <span>Needs Scheduling</span>

                    <h2>Unscheduled Classes</h2>

                    <p>
                      These offerings are assigned to the selected Faculty
                      member but do not yet have a complete teaching schedule.
                    </p>
                  </div>

                  <span className="registrar-teaching-schedule__count">
                    {unscheduledClasses.length} pending
                  </span>
                </header>

                <div className="registrar-teaching-schedule__unscheduled-grid">
                  {unscheduledClasses.map((item) => (
                    <article key={item.offering_id}>
                      <div className="registrar-teaching-schedule__unscheduled-icon">
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

                      <div className="registrar-teaching-schedule__unscheduled-actions">
                        <span>Pending Instructor Schedule</span>
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
