import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventClickArg, EventInput } from "@fullcalendar/core";

import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  GraduationCap,
  Info,
  LoaderCircle,
  RefreshCw,
  UserRound,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/StudentSchedule.css";

const SCHEDULE_API_URL =
  "http://localhost:3000/api/student/enrollments/schedule";

interface Holiday {
  date: string;
  localName: string;
  name: string;
}

interface ScheduleSubject {
  enrollment_subject_id: number;
  enrollment_id: number;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  units: number;
  enrollment_type: string;
  status: string;
  section: {
    section_id: number | null;
    section_name: string | null;
  };
  section_subject_id: number | null;
  offering: {
    offering_id: number | null;
    status: string | null;
    schedule_days: string | null;
    schedule_time: string | null;
  };
  faculty: {
    faculty_id: number | null;
    faculty_name: string | null;
  };
  schedule_ready: boolean;
}

interface ScheduleResponse {
  success: boolean;
  message?: string;
  student?: {
    student_id: number;
    student_number: string;
    student_name: string;
    course: {
      course_id: number;
      course_code: string;
      course_name: string;
    };
  };
  enrollment: {
    enrollment_id: number;
    academic_year_id: number;
    academic_year: string;
    semester_id: number;
    semester_name: string;
    enrollment_status: string;
    approved_at: string | null;
  } | null;
  subjects: ScheduleSubject[];
  summary?: {
    total_enrolled_subjects: number;
    scheduled_subjects: number;
    unscheduled_subjects: number;
  };
}

interface ApiErrorResponse {
  success?: boolean;
  message?: string;
  error?: string;
}

type ViewMode = "week" | "month";

interface WeeklyMeeting {
  key: string;
  dayNumber: number;
  dayName: string;
  startMinutes: number;
  endMinutes: number;
  subject: ScheduleSubject;
  color: string;
}

const SUBJECT_COLORS = [
  "#0f7a45",
  "#2563eb",
  "#7c3aed",
  "#0f766e",
  "#c2410c",
  "#a16207",
  "#be185d",
  "#0369a1",
];

const DAY_ALIASES: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const DAY_NAMES: Record<number, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

function parseScheduleDays(value: string | null): number[] {
  if (!value) {
    return [];
  }

  return [
    ...new Set(
      value
        .split(/[,/&;]+/)
        .map((part) => part.trim().toLowerCase().replace(/\./g, ""))
        .map((part) => DAY_ALIASES[part])
        .filter((day): day is number => Number.isInteger(day)),
    ),
  ];
}

function parseClockTime(value: string): number | null {
  const text = value.trim().toUpperCase().replace(/\s+/g, " ");

  let match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);

  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const meridiem = match[3];

    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
      return null;
    }

    if (meridiem === "AM") {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }

    return hour * 60 + minute;
  }

  match = text.match(/^(\d{1,2}):(\d{2})$/);

  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }

    return hour * 60 + minute;
  }

  match = text.match(/^(\d{1,2})$/);

  if (match) {
    const hour = Number(match[1]);

    if (hour < 0 || hour > 23) {
      return null;
    }

    return hour * 60;
  }

  return null;
}

function parseScheduleTimeRange(
  value: string | null,
): {
  startTime: string;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
} | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().replace(/[–—]/g, "-");
  const parts = normalized.split(/\s*-\s*/);

  if (parts.length !== 2) {
    return null;
  }

  const start = parseClockTime(parts[0]);
  const end = parseClockTime(parts[1]);

  if (start === null || end === null || end <= start) {
    return null;
  }

  const formatCalendarTime = (minutes: number) => {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;

    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(
      2,
      "0",
    )}:00`;
  };

  return {
    startTime: formatCalendarTime(start),
    endTime: formatCalendarTime(end),
    startMinutes: start,
    endMinutes: end,
  };
}

function formatMinutesForDisplay(totalMinutes: number): string {
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;

  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function formatHolidayDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();

    throw new Error(
      `Server returned a non-JSON response (${response.status}): ${text.slice(
        0,
        180,
      )}`,
    );
  }

  return response.json() as Promise<T>;
}

export default function StudentSchedule() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();
  const isStudent = session?.role === "Student";
  const authenticated = Boolean(session && token);

  const calendarRef = useRef<FullCalendar | null>(null);

  const [scheduleData, setScheduleData] = useState<ScheduleResponse | null>(
    null,
  );
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scheduleError, setScheduleError] = useState("");

  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [selectedSubject, setSelectedSubject] =
    useState<ScheduleSubject | null>(null);

  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentMonth, setCurrentMonth] = useState(() =>
    new Date().toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    }),
  );

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidayLoading, setHolidayLoading] = useState(true);
  const [holidayError, setHolidayError] = useState("");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (!isStudent) {
      if (session?.role) {
        navigate(authService.getDashboardRoute(session.role), {
          replace: true,
        });
      } else {
        navigate("/login", { replace: true });
      }
    }
  }, [authenticated, isStudent, navigate, session?.role]);

  const loadSchedule = useCallback(
    async (isRefresh = false, signal?: AbortSignal) => {
      if (!authenticated || !isStudent) {
        return;
      }

      try {
        if (isRefresh) {
          setRefreshing(true);
        } else {
          setScheduleLoading(true);
        }

        setScheduleError("");

        const response = await authService.authFetch(SCHEDULE_API_URL, {
          method: "GET",
          signal,
          headers: {
            Accept: "application/json",
          },
        });

        const data = await readJsonResponse<ScheduleResponse | ApiErrorResponse>(
          response,
        );

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (response.status === 403) {
          throw new Error(
            data.message ||
              ("error" in data ? data.error : undefined) ||
              "You are not authorized to view the Student schedule.",
          );
        }

        if (!response.ok) {
          throw new Error(
            data.message ||
              ("error" in data ? data.error : undefined) ||
              `Schedule request failed (${response.status}).`,
          );
        }

        const schedule = data as ScheduleResponse;

        if (!schedule.success || !Array.isArray(schedule.subjects)) {
          throw new Error(
            schedule.message || "Invalid Student schedule response.",
          );
        }

        setScheduleData(schedule);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        console.error("LOAD STUDENT SCHEDULE ERROR:", error);

        setScheduleError(
          error instanceof Error
            ? error.message
            : "Unable to load the official Student schedule.",
        );
      } finally {
        if (!signal?.aborted) {
          setScheduleLoading(false);
          setRefreshing(false);
        }
      }
    },
    [authenticated, isStudent, navigate],
  );

  useEffect(() => {
    if (!authenticated || !isStudent) {
      return;
    }

    const controller = new AbortController();
    void loadSchedule(false, controller.signal);

    return () => controller.abort();
  }, [authenticated, isStudent, loadSchedule]);

  const holidayYear = currentDate.getFullYear();

  useEffect(() => {
    const controller = new AbortController();

    const loadHolidays = async () => {
      try {
        setHolidayLoading(true);
        setHolidayError("");

        const response = await fetch(
          `https://date.nager.at/api/v3/PublicHolidays/${holidayYear}/PH`,
          {
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error("Holiday calendar is temporarily unavailable.");
        }

        const data = (await response.json()) as Holiday[];
        setHolidays(Array.isArray(data) ? data : []);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        console.error("LOAD PH HOLIDAYS ERROR:", error);
        setHolidays([]);
        setHolidayError(
          error instanceof Error
            ? error.message
            : "Holiday calendar is temporarily unavailable.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setHolidayLoading(false);
        }
      }
    };

    void loadHolidays();

    return () => controller.abort();
  }, [holidayYear]);

  useEffect(() => {
    if (!selectedSubject) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedSubject(null);
      }
    };

    document.body.classList.add("student-schedule-modal-open");
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.classList.remove("student-schedule-modal-open");
      window.removeEventListener("keydown", handleEscape);
    };
  }, [selectedSubject]);

  const scheduledSubjects = useMemo(
    () =>
      (scheduleData?.subjects || []).filter(
        (subject) =>
          subject.schedule_ready &&
          subject.status === "Enrolled" &&
          subject.offering.status !== "Cancelled" &&
          Boolean(subject.offering.schedule_days?.trim()) &&
          Boolean(subject.offering.schedule_time?.trim()),
      ),
    [scheduleData],
  );

  const unscheduledSubjects = useMemo(
    () =>
      (scheduleData?.subjects || []).filter(
        (subject) =>
          subject.status === "Enrolled" &&
          subject.offering.status !== "Cancelled" &&
          !subject.schedule_ready,
      ),
    [scheduleData],
  );

  const subjectColorMap = useMemo(() => {
    const map = new Map<number, string>();

    scheduledSubjects.forEach((subject) => {
      if (!map.has(subject.subject_id)) {
        map.set(
          subject.subject_id,
          SUBJECT_COLORS[map.size % SUBJECT_COLORS.length],
        );
      }
    });

    return map;
  }, [scheduledSubjects]);

  const weeklyMeetings = useMemo<WeeklyMeeting[]>(() => {
    const meetings: WeeklyMeeting[] = [];

    scheduledSubjects.forEach((subject) => {
      const days = parseScheduleDays(subject.offering.schedule_days);
      const time = parseScheduleTimeRange(subject.offering.schedule_time);

      if (days.length === 0 || !time) {
        return;
      }

      const color =
        subjectColorMap.get(subject.subject_id) || SUBJECT_COLORS[0];

      days.forEach((dayNumber) => {
        meetings.push({
          key: `${subject.enrollment_subject_id}-${dayNumber}`,
          dayNumber,
          dayName: DAY_NAMES[dayNumber],
          startMinutes: time.startMinutes,
          endMinutes: time.endMinutes,
          subject,
          color,
        });
      });
    });

    return meetings.sort((a, b) => {
      const aDay = a.dayNumber === 0 ? 7 : a.dayNumber;
      const bDay = b.dayNumber === 0 ? 7 : b.dayNumber;

      if (aDay !== bDay) {
        return aDay - bDay;
      }

      return a.startMinutes - b.startMinutes;
    });
  }, [scheduledSubjects, subjectColorMap]);

  const weeklyDays = useMemo(() => {
    const usedDays = new Set(weeklyMeetings.map((meeting) => meeting.dayNumber));
    const orderedDays = [1, 2, 3, 4, 5, 6, 0];

    if (usedDays.size === 0) {
      return [1, 2, 3, 4, 5, 6];
    }

    return orderedDays.filter((day) => usedDays.has(day));
  }, [weeklyMeetings]);

  const scheduleEvents = useMemo<EventInput[]>(() => {
    const events: EventInput[] = [];

    scheduledSubjects.forEach((subject) => {
      const daysOfWeek = parseScheduleDays(subject.offering.schedule_days);
      const time = parseScheduleTimeRange(subject.offering.schedule_time);

      if (daysOfWeek.length === 0 || !time) {
        return;
      }

      const color =
        subjectColorMap.get(subject.subject_id) || SUBJECT_COLORS[0];

      events.push({
        id: `subject-${subject.enrollment_subject_id}`,
        title: `${subject.subject_code} · ${subject.subject_name}`,
        daysOfWeek,
        startTime: time.startTime,
        endTime: time.endTime,
        backgroundColor: color,
        borderColor: color,
        classNames: ["student-schedule__calendar-class"],
        extendedProps: {
          kind: "subject",
          enrollment_subject_id: subject.enrollment_subject_id,
        },
      });
    });

    return events;
  }, [scheduledSubjects, subjectColorMap]);

  const holidayEvents = useMemo<EventInput[]>(
    () =>
      holidays.map((holiday) => ({
        title: holiday.localName || holiday.name,
        start: holiday.date,
        allDay: true,
        classNames: ["student-schedule__holiday-event"],
        extendedProps: {
          kind: "holiday",
        },
      })),
    [holidays],
  );

  const calendarEvents = useMemo(
    () => [...scheduleEvents, ...holidayEvents],
    [scheduleEvents, holidayEvents],
  );

  const currentMonthHolidays = useMemo(
    () =>
      holidays.filter((holiday) => {
        const date = new Date(`${holiday.date}T00:00:00`);

        return (
          date.getMonth() === currentDate.getMonth() &&
          date.getFullYear() === currentDate.getFullYear()
        );
      }),
    [holidays, currentDate],
  );

  const sectionNames = useMemo(
    () =>
      Array.from(
        new Set(
          scheduledSubjects
            .map((subject) => subject.section.section_name?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ),
    [scheduledSubjects],
  );

  const activeSection =
    sectionNames.length === 0
      ? "Not assigned"
      : sectionNames.length === 1
        ? sectionNames[0]
        : `${sectionNames.length} sections`;

  const totalWeeklyMeetings = weeklyMeetings.length;

  const handlePreviousMonth = () => {
    const api = calendarRef.current?.getApi();
    if (!api) return;

    api.prev();
    setCurrentMonth(api.view.title);
    setCurrentDate(api.getDate());
  };

  const handleToday = () => {
    const api = calendarRef.current?.getApi();
    if (!api) return;

    api.today();
    setCurrentMonth(api.view.title);
    setCurrentDate(api.getDate());
  };

  const handleNextMonth = () => {
    const api = calendarRef.current?.getApi();
    if (!api) return;

    api.next();
    setCurrentMonth(api.view.title);
    setCurrentDate(api.getDate());
  };

  const handleDatesSet = useCallback(
    (info: {
      view: {
        title: string;
        currentStart: Date;
      };
    }) => {
      setCurrentMonth(info.view.title);
      setCurrentDate(info.view.currentStart);
    },
    [],
  );

  const handleCalendarEventClick = useCallback(
    (info: EventClickArg) => {
      if (info.event.extendedProps.kind !== "subject") {
        return;
      }

      const enrollmentSubjectId = Number(
        info.event.extendedProps.enrollment_subject_id,
      );

      const subject = scheduledSubjects.find(
        (item) => item.enrollment_subject_id === enrollmentSubjectId,
      );

      if (subject) {
        setSelectedSubject(subject);
      }
    },
    [scheduledSubjects],
  );

  if (!authenticated || !session || !isStudent) {
    return null;
  }

  const totalEnrolled =
    scheduleData?.summary?.total_enrolled_subjects ??
    scheduleData?.subjects.length ??
    0;
  const scheduledCount =
    scheduleData?.summary?.scheduled_subjects ?? scheduledSubjects.length;

  return (
    <DashboardLayout>
      <main className="student-schedule">
        <section className="student-schedule__hero">
          <div className="student-schedule__hero-copy">
            <div className="student-schedule__eyebrow">
              <span>
                <CalendarDays size={16} aria-hidden="true" />
              </span>
              Student · Academic Records
            </div>

            <h1>Class Schedule</h1>

            <p>
              View the official classes connected to your latest approved
              enrollment.
            </p>

            {scheduleData?.student && (
              <div className="student-schedule__student-line">
                <strong>{scheduleData.student.student_name}</strong>
                <span>{scheduleData.student.student_number}</span>
                <span>{scheduleData.student.course.course_code}</span>
              </div>
            )}
          </div>

          <div className="student-schedule__hero-actions">
            {scheduleData?.enrollment && (
              <div className="student-schedule__term-card">
                <small>Current official term</small>
                <strong>{scheduleData.enrollment.academic_year}</strong>
                <span>{scheduleData.enrollment.semester_name}</span>
              </div>
            )}

            <button
              type="button"
              className="student-schedule__refresh"
              onClick={() => void loadSchedule(true)}
              disabled={scheduleLoading || refreshing}
            >
              <RefreshCw
                size={16}
                className={refreshing ? "student-schedule__spinner" : ""}
                aria-hidden="true"
              />
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </section>

        {scheduleError && (
          <div className="student-schedule__error" role="status">
            <CircleAlertIcon />
            <div>
              <strong>Schedule could not be loaded</strong>
              <span>{scheduleError}</span>
            </div>
          </div>
        )}

        <section
          className="student-schedule__summary"
          aria-label="Schedule overview"
        >
          <article>
            <span className="student-schedule__summary-icon">
              <BookOpen size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Enrolled Subjects</small>
              <strong>{scheduleLoading ? "…" : totalEnrolled}</strong>
            </div>
          </article>

          <article>
            <span className="student-schedule__summary-icon">
              <CheckCircle2 size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Scheduled Subjects</small>
              <strong>{scheduleLoading ? "…" : scheduledCount}</strong>
            </div>
          </article>

          <article>
            <span className="student-schedule__summary-icon">
              <Clock3 size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Weekly Meetings</small>
              <strong>{scheduleLoading ? "…" : totalWeeklyMeetings}</strong>
            </div>
          </article>

          <article>
            <span className="student-schedule__summary-icon">
              <GraduationCap size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Section</small>
              <strong>{scheduleLoading ? "…" : activeSection}</strong>
            </div>
          </article>
        </section>

        <section className="student-schedule__workspace">
          <header className="student-schedule__workspace-header">
            <div>
              <span className="student-schedule__section-kicker">
                Official Schedule
              </span>
              <h2>
                {viewMode === "week" ? "Weekly Classes" : currentMonth}
              </h2>
              <p>
                {scheduleData?.enrollment
                  ? `${scheduleData.enrollment.academic_year} · ${scheduleData.enrollment.semester_name} · ${scheduleData.enrollment.enrollment_status}`
                  : "Your official schedule appears after enrollment approval."}
              </p>
            </div>

            <div className="student-schedule__toolbar">
              {viewMode === "month" && (
                <div className="student-schedule__month-nav">
                  <button
                    type="button"
                    onClick={handlePreviousMonth}
                    aria-label="Previous month"
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                  </button>

                  <button type="button" onClick={handleToday}>
                    Today
                  </button>

                  <button
                    type="button"
                    onClick={handleNextMonth}
                    aria-label="Next month"
                  >
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>
              )}

              <div className="student-schedule__view-switch" role="tablist">
                <button
                  type="button"
                  className={viewMode === "week" ? "is-active" : ""}
                  onClick={() => setViewMode("week")}
                  role="tab"
                  aria-selected={viewMode === "week"}
                >
                  <Clock3 size={15} aria-hidden="true" />
                  Week
                </button>

                <button
                  type="button"
                  className={viewMode === "month" ? "is-active" : ""}
                  onClick={() => setViewMode("month")}
                  role="tab"
                  aria-selected={viewMode === "month"}
                >
                  <CalendarDays size={15} aria-hidden="true" />
                  Month
                </button>
              </div>
            </div>
          </header>

          {scheduleLoading && !scheduleData ? (
            <div className="student-schedule__state">
              <LoaderCircle
                size={25}
                className="student-schedule__spinner"
                aria-hidden="true"
              />
              <strong>Loading official class schedule...</strong>
              <span>Please wait while your approved enrollment is checked.</span>
            </div>
          ) : !scheduleError && !scheduleData?.enrollment ? (
            <div className="student-schedule__state">
              <Info size={25} aria-hidden="true" />
              <strong>No approved enrollment yet</strong>
              <span>
                Your official class schedule will appear after Registrar
                approval.
              </span>
            </div>
          ) : !scheduleError && scheduledSubjects.length === 0 ? (
            <div className="student-schedule__state">
              <CalendarDays size={25} aria-hidden="true" />
              <strong>No official schedule assigned yet</strong>
              <span>
                Your enrollment is approved, but class days and times have not
                been completely assigned.
              </span>
            </div>
          ) : !scheduleError ? (
            <>
              {unscheduledSubjects.length > 0 && (
                <div className="student-schedule__warning">
                  <AlertTriangle size={17} aria-hidden="true" />
                  <div>
                    <strong>
                      {unscheduledSubjects.length} enrolled{" "}
                      {unscheduledSubjects.length === 1
                        ? "subject is"
                        : "subjects are"}{" "}
                      still waiting for a complete schedule.
                    </strong>
                    <span>
                      They remain part of your approved enrollment and will
                      appear here once class days and times are assigned.
                    </span>
                  </div>
                </div>
              )}

              {viewMode === "week" ? (
                <div className="student-schedule__weekly-wrap">
                  <div
                    className="student-schedule__weekly-grid"
                    style={{
                      gridTemplateColumns: `repeat(${Math.max(
                        weeklyDays.length,
                        1,
                      )}, minmax(210px, 1fr))`,
                    }}
                  >
                    {weeklyDays.map((dayNumber) => {
                      const dayMeetings = weeklyMeetings.filter(
                        (meeting) => meeting.dayNumber === dayNumber,
                      );

                      return (
                        <section
                          className="student-schedule__day"
                          key={dayNumber}
                        >
                          <header className="student-schedule__day-header">
                            <div>
                              <strong>{DAY_NAMES[dayNumber]}</strong>
                              <span>
                                {dayMeetings.length}{" "}
                                {dayMeetings.length === 1 ? "class" : "classes"}
                              </span>
                            </div>
                          </header>

                          <div className="student-schedule__day-list">
                            {dayMeetings.length === 0 ? (
                              <div className="student-schedule__day-empty">
                                No classes
                              </div>
                            ) : (
                              dayMeetings.map((meeting) => (
                                <button
                                  type="button"
                                  className="student-schedule__class-card"
                                  key={meeting.key}
                                  onClick={() =>
                                    setSelectedSubject(meeting.subject)
                                  }
                                  style={{
                                    borderLeftColor: meeting.color,
                                  }}
                                >
                                  <span className="student-schedule__class-time">
                                    {formatMinutesForDisplay(
                                      meeting.startMinutes,
                                    )}{" "}
                                    –{" "}
                                    {formatMinutesForDisplay(
                                      meeting.endMinutes,
                                    )}
                                  </span>

                                  <strong>
                                    {meeting.subject.subject_code}
                                  </strong>

                                  <span className="student-schedule__class-name">
                                    {meeting.subject.subject_name}
                                  </span>

                                  <span className="student-schedule__class-meta">
                                    {meeting.subject.section.section_name ||
                                      "Section not assigned"}
                                  </span>

                                  <span className="student-schedule__class-faculty">
                                    {meeting.subject.faculty.faculty_name ||
                                      "Faculty not assigned"}
                                  </span>
                                </button>
                              ))
                            )}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="student-schedule__calendar-wrap">
                  <FullCalendar
                    ref={calendarRef}
                    plugins={[dayGridPlugin, interactionPlugin]}
                    initialView="dayGridMonth"
                    headerToolbar={false}
                    height="auto"
                    events={calendarEvents}
                    displayEventTime
                    eventTimeFormat={{
                      hour: "numeric",
                      minute: "2-digit",
                      meridiem: "short",
                    }}
                    dayMaxEvents={3}
                    fixedWeekCount={false}
                    eventClick={handleCalendarEventClick}
                    eventDidMount={(info) => {
                      if (info.event.extendedProps.kind === "subject") {
                        info.el.title = "Click to view class details";
                      }
                    }}
                    datesSet={handleDatesSet}
                  />
                </div>
              )}
            </>
          ) : null}
        </section>

        <div className="student-schedule__lower-grid">
          <section className="student-schedule__panel">
            <header className="student-schedule__panel-header">
              <div>
                <span className="student-schedule__section-kicker">
                  Subject Guide
                </span>
                <h2>Scheduled Subjects</h2>
              </div>

              <span className="student-schedule__count">
                {scheduledSubjects.length}
              </span>
            </header>

            <div className="student-schedule__legend">
              {scheduledSubjects.length === 0 ? (
                <p className="student-schedule__panel-empty">
                  No scheduled subjects to display.
                </p>
              ) : (
                scheduledSubjects.map((subject) => (
                  <button
                    type="button"
                    className="student-schedule__legend-item"
                    key={subject.enrollment_subject_id}
                    onClick={() => setSelectedSubject(subject)}
                  >
                    <span
                      className="student-schedule__legend-color"
                      style={{
                        backgroundColor:
                          subjectColorMap.get(subject.subject_id) ||
                          SUBJECT_COLORS[0],
                      }}
                    />

                    <span>
                      <strong>{subject.subject_code}</strong>
                      <small>{subject.subject_name}</small>
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="student-schedule__panel">
            <header className="student-schedule__panel-header">
              <div>
                <span className="student-schedule__section-kicker">
                  Calendar Notice
                </span>
                <h2>Holidays This Month</h2>
              </div>

              <span className="student-schedule__count">
                {holidayLoading ? "…" : currentMonthHolidays.length}
              </span>
            </header>

            {holidayLoading ? (
              <div className="student-schedule__panel-loading">
                <LoaderCircle
                  size={17}
                  className="student-schedule__spinner"
                  aria-hidden="true"
                />
                Loading holidays...
              </div>
            ) : holidayError ? (
              <p className="student-schedule__panel-empty">
                Holiday information is unavailable right now.
              </p>
            ) : currentMonthHolidays.length === 0 ? (
              <p className="student-schedule__panel-empty">
                No listed Philippine holidays this month.
              </p>
            ) : (
              <div className="student-schedule__holidays">
                {currentMonthHolidays.map((holiday) => (
                  <div
                    className="student-schedule__holiday"
                    key={holiday.date}
                  >
                    <span>{formatHolidayDate(holiday.date)}</span>
                    <div>
                      <strong>{holiday.localName || holiday.name}</strong>
                      {holiday.localName !== holiday.name && holiday.name && (
                        <small>{holiday.name}</small>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {unscheduledSubjects.length > 0 && (
          <section className="student-schedule__unscheduled">
            <header className="student-schedule__panel-header">
              <div>
                <span className="student-schedule__section-kicker">
                  Pending Schedule
                </span>
                <h2>Enrolled Subjects Without Complete Schedule</h2>
              </div>

              <span className="student-schedule__count">
                {unscheduledSubjects.length}
              </span>
            </header>

            <div className="student-schedule__unscheduled-list">
              {unscheduledSubjects.map((subject) => (
                <article
                  className="student-schedule__unscheduled-item"
                  key={subject.enrollment_subject_id}
                >
                  <span className="student-schedule__unscheduled-icon">
                    <Clock3 size={16} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>{subject.subject_code}</strong>
                    <span>{subject.subject_name}</span>
                  </div>
                  <small>
                    {subject.section.section_name || "Section not assigned"}
                  </small>
                </article>
              ))}
            </div>
          </section>
        )}

        {selectedSubject && (
          <div
            className="student-schedule__modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) {
                setSelectedSubject(null);
              }
            }}
          >
            <div
              className="student-schedule__modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="student-schedule-modal-title"
            >
              <header className="student-schedule__modal-header">
                <div>
                  <span className="student-schedule__section-kicker">
                    Official Class
                  </span>
                  <h2 id="student-schedule-modal-title">
                    {selectedSubject.subject_code}
                  </h2>
                  <p>{selectedSubject.subject_name}</p>
                </div>

                <button
                  type="button"
                  className="student-schedule__modal-close"
                  onClick={() => setSelectedSubject(null)}
                  aria-label="Close class details"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </header>

              <div className="student-schedule__modal-body">
                <div className="student-schedule__detail">
                  <span className="student-schedule__detail-icon">
                    <CalendarDays size={17} aria-hidden="true" />
                  </span>
                  <div>
                    <small>Class Schedule</small>
                    <strong>
                      {selectedSubject.offering.schedule_days || "Not assigned"}
                    </strong>
                    <span>
                      {selectedSubject.offering.schedule_time || "Not assigned"}
                    </span>
                  </div>
                </div>

                <div className="student-schedule__detail">
                  <span className="student-schedule__detail-icon">
                    <GraduationCap size={17} aria-hidden="true" />
                  </span>
                  <div>
                    <small>Section</small>
                    <strong>
                      {selectedSubject.section.section_name || "Not assigned"}
                    </strong>
                  </div>
                </div>

                <div className="student-schedule__detail">
                  <span className="student-schedule__detail-icon">
                    <UserRound size={17} aria-hidden="true" />
                  </span>
                  <div>
                    <small>Faculty</small>
                    <strong>
                      {selectedSubject.faculty.faculty_name || "Not assigned"}
                    </strong>
                  </div>
                </div>

                <div className="student-schedule__detail">
                  <span className="student-schedule__detail-icon">
                    <BookOpen size={17} aria-hidden="true" />
                  </span>
                  <div>
                    <small>Enrollment</small>
                    <strong>{selectedSubject.enrollment_type}</strong>
                    <span>
                      {selectedSubject.units}{" "}
                      {selectedSubject.units === 1 ? "unit" : "units"}
                    </span>
                  </div>
                </div>
              </div>

              <footer className="student-schedule__modal-footer">
                <span>
                  This schedule comes from your latest approved official
                  enrollment.
                </span>

                <button
                  type="button"
                  onClick={() => setSelectedSubject(null)}
                >
                  Close
                </button>
              </footer>
            </div>
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}

function CircleAlertIcon() {
  return <Info size={18} aria-hidden="true" />;
}