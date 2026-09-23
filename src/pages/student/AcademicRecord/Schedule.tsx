import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../../../styles/StudentSchedule.css";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventClickArg, EventInput } from "@fullcalendar/core";

import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  GraduationCap,
  UserRound,
  X,
} from "lucide-react";

const SCHEDULE_API_URL = apiUrl("/api/student/enrollments/schedule");

interface Holiday {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
  fixed: boolean;
  global: boolean;
  counties: string[] | null;
  launchYear: number | null;
  types: string[];
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

type ViewMode = "month" | "week";

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
  "#15803d",
  "#2563eb",
  "#7c3aed",
  "#0f766e",
  "#c2410c",
  "#a16207",
  "#be185d",
  "#0369a1",
];

function getSubjectColorClass(color: string): string {
  const index = SUBJECT_COLORS.indexOf(color);

  return `schedule-subject-color-${index >= 0 ? index : 0}`;
}

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
        .split(/[,/&]+/)
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
      if (hour === 12) {
        hour = 0;
      }
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

function formatMinutesAsTime(totalMinutes: number): string {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(
    2,
    "0",
  )}:00`;
}

function formatMinutesForDisplay(totalMinutes: number): string {
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;

  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function parseScheduleTimeRange(value: string | null): {
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

  return {
    startTime: formatMinutesAsTime(start),
    endTime: formatMinutesAsTime(end),
    startMinutes: start,
    endMinutes: end,
  };
}

export default function StudentSchedule() {
  const navigate = useNavigate();
  const user = authService.getSession();
  const isStudent = user?.role === "Student";

  const calendarRef = useRef<FullCalendar | null>(null);

  const [currentMonth, setCurrentMonth] = useState(() =>
    new Date().toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    }),
  );

  const [currentDate, setCurrentDate] = useState(new Date());

  const [holidays, setHolidays] = useState<Holiday[]>([]);

  const [scheduleData, setScheduleData] = useState<ScheduleResponse | null>(
    null,
  );

  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleError, setScheduleError] = useState("");

  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [selectedSubject, setSelectedSubject] =
    useState<ScheduleSubject | null>(null);

  useEffect(() => {
    if (!isStudent) {
      navigate("/login");
    }
  }, [isStudent, navigate]);

  useEffect(() => {
    if (!isStudent) {
      return;
    }

    const controller = new AbortController();

    const loadSchedule = async () => {
      try {
        setScheduleLoading(true);
        setScheduleError("");

        const response = await authService.authFetch(SCHEDULE_API_URL, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });

        const responseData = (await response.json()) as
          | ScheduleResponse
          | ApiErrorResponse;

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (response.status === 403) {
          throw new Error(
            responseData.message ||
              ("error" in responseData ? responseData.error : undefined) ||
              "You are not authorized to view the Student schedule.",
          );
        }

        if (!response.ok) {
          throw new Error(
            responseData.message ||
              ("error" in responseData ? responseData.error : undefined) ||
              `Schedule request failed (${response.status}).`,
          );
        }

        const data = responseData as ScheduleResponse;

        if (!data.success || !Array.isArray(data.subjects)) {
          throw new Error(data.message || "Invalid Student schedule response.");
        }

        setScheduleData(data);
      } catch (error: unknown) {
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
        if (!controller.signal.aborted) {
          setScheduleLoading(false);
        }
      }
    };

    void loadSchedule();

    return () => {
      controller.abort();
    };
  }, [isStudent, navigate]);

  useEffect(() => {
    fetch("https://date.nager.at/api/v3/PublicHolidays/2026/PH")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to fetch holidays");
        }

        return response.json();
      })
      .then((data: Holiday[]) => {
        setHolidays(data);
      })
      .catch((error: unknown) => {
        console.error("Error fetching holidays:", error);
      });
  }, []);

  useEffect(() => {
    if (!selectedSubject) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedSubject(null);
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
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
      const parsedTime = parseScheduleTimeRange(subject.offering.schedule_time);

      if (!parsedTime) {
        return;
      }

      const color =
        subjectColorMap.get(subject.subject_id) || SUBJECT_COLORS[0];

      days.forEach((dayNumber) => {
        meetings.push({
          key: `${subject.enrollment_subject_id}-${dayNumber}`,
          dayNumber,
          dayName: DAY_NAMES[dayNumber],
          startMinutes: parsedTime.startMinutes,
          endMinutes: parsedTime.endMinutes,
          subject,
          color,
        });
      });
    });

    return meetings.sort((a, b) => {
      if (a.dayNumber !== b.dayNumber) {
        const aSort = a.dayNumber === 0 ? 7 : a.dayNumber;
        const bSort = b.dayNumber === 0 ? 7 : b.dayNumber;

        return aSort - bSort;
      }

      return a.startMinutes - b.startMinutes;
    });
  }, [scheduledSubjects, subjectColorMap]);

  const weeklyDays = useMemo(() => {
    const baseDays = [1, 2, 3, 4, 5, 6];

    if (weeklyMeetings.some((meeting) => meeting.dayNumber === 0)) {
      baseDays.push(0);
    }

    return baseDays;
  }, [weeklyMeetings]);

  const scheduleEvents = useMemo<EventInput[]>(() => {
    const generatedEvents: EventInput[] = [];

    scheduledSubjects.forEach((subject) => {
      const daysOfWeek = parseScheduleDays(subject.offering.schedule_days);
      const parsedTime = parseScheduleTimeRange(subject.offering.schedule_time);

      if (daysOfWeek.length === 0 || !parsedTime) {
        return;
      }

      const color =
        subjectColorMap.get(subject.subject_id) || SUBJECT_COLORS[0];

      generatedEvents.push({
        id: `subject-${subject.enrollment_subject_id}`,
        title: `${subject.subject_code} - ${subject.subject_name}`,
        daysOfWeek,
        startTime: parsedTime.startTime,
        endTime: parsedTime.endTime,
        backgroundColor: color,
        borderColor: color,
        classNames: ["official-class-event"],
        extendedProps: {
          kind: "subject",
          enrollment_subject_id: subject.enrollment_subject_id,
        },
      });
    });

    return generatedEvents;
  }, [scheduledSubjects, subjectColorMap]);

  const currentMonthHolidays = holidays.filter((holiday) => {
    const holidayDate = new Date(`${holiday.date}T00:00:00`);

    return (
      holidayDate.getMonth() === currentDate.getMonth() &&
      holidayDate.getFullYear() === currentDate.getFullYear()
    );
  });

  const holidayEvents = useMemo<EventInput[]>(
    () =>
      holidays.map((holiday) => ({
        title: holiday.localName,
        start: holiday.date,
        allDay: true,
        className: "holiday-event",
        extendedProps: {
          kind: "holiday",
        },
      })),
    [holidays],
  );

  const calendarEvents = useMemo<EventInput[]>(
    () => [...scheduleEvents, ...holidayEvents],
    [scheduleEvents, holidayEvents],
  );

  const totalWeeklyMeetings = weeklyMeetings.length;
  const activeSection =
    scheduledSubjects.find((subject) => subject.section.section_name)?.section
      .section_name || "Not assigned";

  const handlePreviousMonth = () => {
    const calendarApi = calendarRef.current?.getApi();

    if (!calendarApi) return;

    calendarApi.prev();

    setCurrentMonth(calendarApi.view.title);
    setCurrentDate(calendarApi.getDate());
  };

  const handleToday = () => {
    const calendarApi = calendarRef.current?.getApi();

    if (!calendarApi) return;

    calendarApi.today();

    setCurrentMonth(calendarApi.view.title);
    setCurrentDate(calendarApi.getDate());
  };

  const handleNextMonth = () => {
    const calendarApi = calendarRef.current?.getApi();

    if (!calendarApi) return;

    calendarApi.next();

    setCurrentMonth(calendarApi.view.title);
    setCurrentDate(calendarApi.getDate());
  };

  const handleDatesSet = useCallback(
    (info: {
      view: {
        title: string;
        currentStart: Date;
      };
    }) => {
      setCurrentMonth((previous) =>
        previous === info.view.title ? previous : info.view.title,
      );

      const nextDate = info.view.currentStart;

      setCurrentDate((previous) =>
        previous.getTime() === nextDate.getTime() ? previous : nextDate,
      );
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

  if (!isStudent) {
    return null;
  }

  return (
    <DashboardLayout>
      <div className="student-schedule-page">
        <section className="schedule-header">
          <div className="schedule-heading">
            <span className="schedule-eyebrow">
              <CalendarDays size={15} />
              STUDENT · ACADEMIC RECORDS
            </span>

            <h1>Student Schedule</h1>

            <div className="schedule-subtitle-row">
              <span>{currentMonth || "Official Class Schedule"}</span>

              {scheduleData?.enrollment && (
                <>
                  <span className="schedule-dot" aria-hidden="true">
                    •
                  </span>

                  <span>
                    {scheduleData.enrollment.academic_year} ·{" "}
                    {scheduleData.enrollment.semester_name}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="schedule-header-actions">
            {viewMode === "month" && (
              <div className="month-navigation">
                <button
                  type="button"
                  onClick={handlePreviousMonth}
                  aria-label="Previous month"
                >
                  &lt;
                </button>

                <button type="button" onClick={handleToday}>
                  Today
                </button>

                <button
                  type="button"
                  onClick={handleNextMonth}
                  aria-label="Next month"
                >
                  &gt;
                </button>
              </div>
            )}

            <div className="schedule-header-icon" aria-hidden="true">
              <CalendarDays size={28} strokeWidth={1.9} />
            </div>
          </div>
        </section>

        <section
          className="schedule-summary-grid"
          aria-label="Schedule summary"
        >
          <div className="schedule-summary-card">
            <span className="schedule-summary-icon">
              <BookOpen size={19} />
            </span>

            <div>
              <small>Scheduled Subjects</small>
              <strong>{scheduledSubjects.length}</strong>
            </div>
          </div>

          <div className="schedule-summary-card">
            <span className="schedule-summary-icon">
              <Clock3 size={19} />
            </span>

            <div>
              <small>Weekly Meetings</small>
              <strong>{totalWeeklyMeetings}</strong>
            </div>
          </div>

          <div className="schedule-summary-card">
            <span className="schedule-summary-icon">
              <GraduationCap size={19} />
            </span>

            <div>
              <small>Section</small>
              <strong>{activeSection}</strong>
            </div>
          </div>

          <div className="schedule-summary-card">
            <span className="schedule-summary-icon">
              <CheckCircle2 size={19} />
            </span>

            <div>
              <small>Enrollment</small>
              <strong>
                {scheduleData?.enrollment?.enrollment_status || "Not available"}
              </strong>
            </div>
          </div>
        </section>

        <section className="schedule-main-card">
          <div className="schedule-card-toolbar">
            <div>
              <span className="schedule-section-kicker">OFFICIAL CLASSES</span>
              <h2>
                {viewMode === "month" ? "Monthly Calendar" : "Weekly Schedule"}
              </h2>
            </div>

            <div className="schedule-view-switch" role="tablist">
              <button
                type="button"
                className={viewMode === "week" ? "active" : ""}
                onClick={() => setViewMode("week")}
                role="tab"
                aria-selected={viewMode === "week"}
              >
                <Clock3 size={16} />
                Weekly
              </button>

              <button
                type="button"
                className={viewMode === "month" ? "active" : ""}
                onClick={() => setViewMode("month")}
                role="tab"
                aria-selected={viewMode === "month"}
              >
                <CalendarDays size={16} />
                Monthly
              </button>
            </div>
          </div>

          {scheduleLoading && !scheduleData && (
            <div className="schedule-state schedule-state-loading">
              <span className="schedule-state-spinner" />
              <div>
                <strong>Loading official class schedule</strong>
                <p>Please wait while your approved enrollment is checked.</p>
              </div>
            </div>
          )}

          {!scheduleLoading && scheduleError && (
            <div className="schedule-state schedule-state-error">
              <strong>Schedule could not be loaded</strong>
              <p>{scheduleError}</p>
            </div>
          )}

          {!scheduleLoading && !scheduleError && !scheduleData?.enrollment && (
            <div className="schedule-state">
              <strong>No approved enrollment yet</strong>
              <p>
                Your official class schedule will appear after Registrar
                approval.
              </p>
            </div>
          )}

          {!scheduleLoading &&
            !scheduleError &&
            scheduleData?.enrollment &&
            scheduledSubjects.length === 0 && (
              <div className="schedule-state">
                <strong>No official schedule assigned yet</strong>
                <p>
                  Your enrollment is approved, but your class schedule has not
                  been completely assigned.
                </p>
              </div>
            )}

          {!scheduleLoading &&
            !scheduleError &&
            Number(scheduleData?.summary?.unscheduled_subjects || 0) > 0 && (
              <div className="schedule-warning">
                <Clock3 size={17} />
                <span>
                  {scheduleData?.summary?.unscheduled_subjects} enrolled
                  subject(s) do not have a complete schedule yet.
                </span>
              </div>
            )}

          {viewMode === "month" ? (
            <div className="schedule-calendar-wrap">
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
          ) : (
            <div className="weekly-schedule-wrap">
              <div className="weekly-schedule-grid">
                {weeklyDays.map((dayNumber) => {
                  const dayMeetings = weeklyMeetings.filter(
                    (meeting) => meeting.dayNumber === dayNumber,
                  );

                  return (
                    <div className="weekly-day-column" key={dayNumber}>
                      <div className="weekly-day-header">
                        <span>{DAY_NAMES[dayNumber]}</span>
                        <small>
                          {dayMeetings.length}{" "}
                          {dayMeetings.length === 1 ? "class" : "classes"}
                        </small>
                      </div>

                      <div className="weekly-day-list">
                        {dayMeetings.length === 0 ? (
                          <div className="weekly-empty">
                            No classes scheduled
                          </div>
                        ) : (
                          dayMeetings.map((meeting) => (
                            <button
                              type="button"
                              className={`weekly-class-card ${getSubjectColorClass(
                                meeting.color,
                              )}`}
                              key={meeting.key}
                              onClick={() =>
                                setSelectedSubject(meeting.subject)
                              }
                            >
                              <span className="weekly-class-time">
                                {formatMinutesForDisplay(meeting.startMinutes)}{" "}
                                – {formatMinutesForDisplay(meeting.endMinutes)}
                              </span>

                              <strong>{meeting.subject.subject_code}</strong>

                              <span className="weekly-class-name">
                                {meeting.subject.subject_name}
                              </span>

                              <span className="weekly-class-meta">
                                {meeting.subject.section.section_name ||
                                  "Section not assigned"}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="holiday-container">
          <div className="section-heading-row">
            <div>
              <span className="schedule-section-kicker holiday-kicker">
                CALENDAR NOTICE
              </span>
              <h3>Holidays This Month</h3>
            </div>

            <span className="section-count">{currentMonthHolidays.length}</span>
          </div>

          {holidays.length === 0 ? (
            <p>Loading holidays...</p>
          ) : currentMonthHolidays.length === 0 ? (
            <p>No holidays this month.</p>
          ) : (
            <ul>
              {currentMonthHolidays.map((holiday) => (
                <li key={holiday.date}>
                  <strong>
                    {new Date(`${holiday.date}T00:00:00`).toLocaleDateString(
                      "en-US",
                      {
                        month: "long",
                        day: "numeric",
                      },
                    )}
                  </strong>

                  {" — "}

                  {holiday.localName}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="legend-container">
          <div className="section-heading-row">
            <div>
              <span className="schedule-section-kicker">COLOR GUIDE</span>
              <h3>Subject Legend</h3>
            </div>

            <span className="section-count">{scheduledSubjects.length}</span>
          </div>

          <div className="legend-items">
            {scheduledSubjects.length === 0 ? (
              <p>No scheduled subjects to display.</p>
            ) : (
              scheduledSubjects.map((subject) => (
                <button
                  type="button"
                  className="legend-item"
                  key={subject.enrollment_subject_id}
                  onClick={() => setSelectedSubject(subject)}
                >
                  <span
                    className={`legend-color ${getSubjectColorClass(
                      subjectColorMap.get(subject.subject_id) ||
                        SUBJECT_COLORS[0],
                    )}`}
                  />

                  <span>
                    <strong>{subject.subject_code}</strong>
                    {" · "}
                    {subject.subject_name}
                  </span>
                </button>
              ))
            )}

            <div className="legend-item legend-item-static">
              <span className="legend-color holiday-legend-color" />
              <span>Holiday</span>
            </div>
          </div>
        </section>

        {selectedSubject && (
          <div
            className="schedule-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) {
                setSelectedSubject(null);
              }
            }}
          >
            <div
              className="schedule-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="schedule-modal-title"
            >
              <div className="schedule-modal-header">
                <div>
                  <span className="schedule-section-kicker">
                    OFFICIAL CLASS
                  </span>
                  <h3 id="schedule-modal-title">
                    {selectedSubject.subject_code}
                  </h3>
                  <p>{selectedSubject.subject_name}</p>
                </div>

                <button
                  type="button"
                  className="schedule-modal-close"
                  onClick={() => setSelectedSubject(null)}
                  aria-label="Close class details"
                >
                  <X size={19} />
                </button>
              </div>

              <div className="schedule-modal-body">
                <div className="schedule-detail-row">
                  <span className="schedule-detail-icon">
                    <CalendarDays size={18} />
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

                <div className="schedule-detail-row">
                  <span className="schedule-detail-icon">
                    <GraduationCap size={18} />
                  </span>
                  <div>
                    <small>Section</small>
                    <strong>
                      {selectedSubject.section.section_name || "Not assigned"}
                    </strong>
                  </div>
                </div>

                <div className="schedule-detail-row">
                  <span className="schedule-detail-icon">
                    <UserRound size={18} />
                  </span>
                  <div>
                    <small>Faculty</small>
                    <strong>
                      {selectedSubject.faculty.faculty_name || "Not assigned"}
                    </strong>
                  </div>
                </div>

                <div className="schedule-detail-row">
                  <span className="schedule-detail-icon">
                    <BookOpen size={18} />
                  </span>
                  <div>
                    <small>Enrollment Type</small>
                    <strong>{selectedSubject.enrollment_type}</strong>
                    <span>
                      {selectedSubject.units}{" "}
                      {selectedSubject.units === 1 ? "unit" : "units"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="schedule-modal-footer">
                <span>
                  This schedule comes from your approved official enrollment.
                </span>

                <button type="button" onClick={() => setSelectedSubject(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
