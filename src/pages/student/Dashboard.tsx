import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileText,
  GraduationCap,
  History,
  IdCard,
  Megaphone,
  RefreshCw,
  UserRound,
} from "lucide-react";

import DashboardLayout from "../../components/Layout/DashboardLayout";
import { authService } from "../../services/auth.service";
import "../styles/student-dashboard.css";

const API_BASE_URL = "http://localhost:3000";
const PROFILE_API_URL = `${API_BASE_URL}/api/student/profile`;
const CURRENT_ENROLLMENT_API_URL = `${API_BASE_URL}/api/student/enrollments/current`;
const ANNOUNCEMENTS_API_URL = `${API_BASE_URL}/api/announcements`;

interface StudentProfileData {
  photo?: string | null;
  full_name: string;
  first_name?: string;
  middle_name?: string | null;
  last_name?: string;
  student_number: string;
  email?: string | null;
  course: {
    course_id: number | null;
    course_code: string | null;
    course_name: string | null;
  };
  year_level: number | null;
  section: {
    section_id: number | null;
    section_name: string | null;
  };
  academic_year: {
    academic_year_id: number | null;
    academic_year: string | null;
  };
  semester: {
    semester_id: number | null;
    semester_name: string | null;
  };
  enrollment_status: string | null;
  student_status: string | null;
}

interface StudentProfileResponse {
  success?: boolean;
  profile?: StudentProfileData;
  message?: string;
  error?: string;
}

interface CurrentEnrollmentSubject {
  enrollment_subject_id: number;
  enrollment_id?: number;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  units?: number;
  subject_status: string | null;
  section_id: number | null;
  section_name: string | null;
  section_year_level?: number | null;
  section_subject_id?: number | null;
  section_subject_status?: string | null;
  offering_id: number | null;
  offering_status: string | null;
  faculty_id: number | null;
  faculty_name: string | null;
  room_id?: number | null;
  room_name?: string | null;
  schedule_days: string | null;
  schedule_time: string | null;
  max_students?: number | null;
  placement_complete?: boolean;
}

interface CurrentEnrollmentResponse {
  success: boolean;
  message?: string;
  error?: string;
  enrollment: {
    enrollment_id: number;
    academic_year_id: number;
    academic_year: string;
    semester_id: number;
    semester_name: string;
    enrollment_status: string;
    approved_at: string | null;
  } | null;
  subjects: CurrentEnrollmentSubject[];
}

interface AnnouncementRecipient {
  role_id?: number;
  role_name?: string;
}

interface Announcement {
  announcement_id: number;
  title: string;
  content: string;
  created_by: string | null;
  publish_date: string;
  expiry_date: string | null;
  is_active: number;
  created_at: string;
  recipients?: string | string[] | AnnouncementRecipient[] | null;
  attachments?: string | null;
}

type AnnouncementListResponse =
  | Announcement[]
  | {
      success?: boolean;
      announcements?: Announcement[];
      data?: Announcement[];
      message?: string;
      error?: string;
    };

interface TodayClass {
  enrollment_subject_id: number;
  subject_code: string;
  subject_name: string;
  section_name: string | null;
  faculty_name: string | null;
  start_minutes: number;
  start_label: string;
  end_label: string;
  duration_label: string;
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const quickActions = [
  {
    title: "Enrollment",
    description: "Review your current enrollment and subject load.",
    path: "/student/enrollment/main",
    icon: BookOpenCheck,
  },
  {
    title: "Class Schedule",
    description: "Open your full weekly academic schedule.",
    path: "/student/schedule",
    icon: CalendarDays,
  },
  {
    title: "Grades",
    description: "Review your available academic grades and records.",
    path: "/student/records",
    icon: FileText,
  },
  {
    title: "Announcements",
    description: "Read active notices intended for students.",
    path: "/student/announcement",
    icon: Megaphone,
  },
];

const secondaryActions = [
  {
    title: "My Profile",
    path: "/student/profile",
    icon: UserRound,
  },
  {
    title: "Academic History",
    path: "/student/course-history",
    icon: History,
  },
  {
    title: "Request Document",
    path: "/student/document/request",
    icon: IdCard,
  },
];

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

function normalizeDay(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\./g, "");

  const aliases: Record<string, string> = {
    sun: "sunday",
    sunday: "sunday",
    mon: "monday",
    monday: "monday",
    tue: "tuesday",
    tues: "tuesday",
    tuesday: "tuesday",
    wed: "wednesday",
    wednesday: "wednesday",
    thu: "thursday",
    thur: "thursday",
    thurs: "thursday",
    thursday: "thursday",
    fri: "friday",
    friday: "friday",
    sat: "saturday",
    saturday: "saturday",
  };

  return aliases[normalized] || normalized;
}

function isScheduledToday(scheduleDays: string | null, todayName: string) {
  if (!scheduleDays) {
    return false;
  }

  const targetDay = normalizeDay(todayName);

  return scheduleDays
    .split(/[,/&;]+/)
    .map((day) => normalizeDay(day))
    .includes(targetDay);
}

function parseClockTime(value: string) {
  const text = value.trim().toUpperCase().replace(/\s+/g, " ");
  let match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);

  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const meridiem = match[3];

    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
      return null;
    }

    if (meridiem === "AM" && hour === 12) {
      hour = 0;
    } else if (meridiem === "PM" && hour !== 12) {
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

  return null;
}

function parseScheduleTimeRange(value: string | null) {
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

  return { start, end };
}

function formatTime(totalMinutes: number) {
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;

  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function formatDuration(start: number, end: number) {
  const durationMinutes = end - start;
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }

  return `${minutes} min`;
}

function formatYearLevel(value: number | null | undefined) {
  if (!value) {
    return "Not recorded";
  }

  if (value === 1) return "1st Year";
  if (value === 2) return "2nd Year";
  if (value === 3) return "3rd Year";

  return `${value}th Year`;
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Date unavailable";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatToday() {
  return new Intl.DateTimeFormat("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
}

function getAnnouncementPreview(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= 120) {
    return normalized;
  }

  return `${normalized.slice(0, 120).trimEnd()}…`;
}

function isStudentAudience(recipients: Announcement["recipients"]) {
  if (typeof recipients === "string") {
    return recipients
      .split(",")
      .map((role) => role.trim().toLowerCase())
      .includes("student");
  }

  if (Array.isArray(recipients)) {
    return recipients.some((recipient) => {
      if (typeof recipient === "string") {
        return recipient.trim().toLowerCase() === "student";
      }

      return String(recipient.role_name || "")
        .trim()
        .toLowerCase() === "student";
    });
  }

  return false;
}

function isCurrentlyAvailable(announcement: Announcement) {
  if (Number(announcement.is_active) !== 1) {
    return false;
  }

  const now = Date.now();
  const publishTime = new Date(announcement.publish_date).getTime();

  if (!Number.isNaN(publishTime) && publishTime > now) {
    return false;
  }

  if (announcement.expiry_date) {
    const expiryTime = new Date(announcement.expiry_date).getTime();

    if (!Number.isNaN(expiryTime) && expiryTime < now) {
      return false;
    }
  }

  return true;
}

function getStatusClass(value: string | null | undefined) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

  if (["approved", "active", "enrolled"].includes(normalized)) {
    return "positive";
  }

  if (["draft", "pending", "submitted", "under-review"].includes(normalized)) {
    return "pending";
  }

  if (["rejected", "inactive", "dropped", "withdrawn"].includes(normalized)) {
    return "negative";
  }

  return "neutral";
}

export default function StudentDashboard() {
  const navigate = useNavigate();
  const user = authService.getSession();
  const token = authService.getToken();
  const authenticated = Boolean(user && token);
  const userRole = user?.role;

  const [profile, setProfile] = useState<StudentProfileData | null>(null);
  const [scheduleData, setScheduleData] =
    useState<CurrentEnrollmentResponse | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const [announcementError, setAnnouncementError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Student") {
      navigate(authService.getDashboardRoute(user!.role), { replace: true });
    }
  }, [authenticated, userRole, user, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Student") {
      return;
    }

    const controller = new AbortController();

    const handleUnauthorized = () => {
      authService.logout();
      navigate("/login", { replace: true });
      controller.abort();
    };

    const loadProfile = async () => {
      try {
        const response = await authService.authFetch(PROFILE_API_URL, {
          method: "GET",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        if (response.status === 401) {
          handleUnauthorized();
          return;
        }

        const data = await readJsonResponse<StudentProfileResponse>(response);

        if (!response.ok || !data.success || !data.profile) {
          throw new Error(
            data.message || data.error || "Unable to load your Student profile.",
          );
        }

        setProfile(data.profile);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("LOAD STUDENT DASHBOARD PROFILE ERROR:", error);
        setProfileError(
          error instanceof Error ? error.message : "Unable to load profile information.",
        );
      }
    };

    const loadSchedule = async () => {
      try {
        const response = await authService.authFetch(
          CURRENT_ENROLLMENT_API_URL,
          {
            method: "GET",
            signal: controller.signal,
            headers: { Accept: "application/json" },
          },
        );

        if (response.status === 401) {
          handleUnauthorized();
          return;
        }

        const data = await readJsonResponse<CurrentEnrollmentResponse>(response);

        if (!response.ok || !data.success || !Array.isArray(data.subjects)) {
          throw new Error(
            data.message ||
              data.error ||
              "Unable to load your current enrollment schedule.",
          );
        }

        setScheduleData(data);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("LOAD STUDENT DASHBOARD SCHEDULE ERROR:", error);
        setScheduleError(
          error instanceof Error ? error.message : "Unable to load current enrollment schedule information.",
        );
      }
    };

    const loadAnnouncements = async () => {
      try {
        const response = await authService.authFetch(ANNOUNCEMENTS_API_URL, {
          method: "GET",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        if (response.status === 401) {
          handleUnauthorized();
          return;
        }

        const data = await readJsonResponse<AnnouncementListResponse>(response);

        if (!response.ok) {
          const message =
            !Array.isArray(data) && data
              ? data.message || data.error
              : undefined;

          throw new Error(message || "Unable to load Student announcements.");
        }

        let rows: Announcement[] = [];

        if (Array.isArray(data)) {
          rows = data;
        } else if (Array.isArray(data.announcements)) {
          rows = data.announcements;
        } else if (Array.isArray(data.data)) {
          rows = data.data;
        }

        const visibleAnnouncements = rows
          .filter(
            (announcement) =>
              isStudentAudience(announcement.recipients) &&
              isCurrentlyAvailable(announcement),
          )
          .sort(
            (a, b) =>
              new Date(b.publish_date).getTime() -
              new Date(a.publish_date).getTime(),
          );

        setAnnouncements(visibleAnnouncements);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("LOAD STUDENT DASHBOARD ANNOUNCEMENTS ERROR:", error);
        setAnnouncementError(
          error instanceof Error
            ? error.message
            : "Unable to load announcement information.",
        );
      }
    };

    const loadDashboard = async () => {
      try {
        if (refreshKey === 0) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }

        setProfileError("");
        setScheduleError("");
        setAnnouncementError("");

        await Promise.all([loadProfile(), loadSchedule(), loadAnnouncements()]);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void loadDashboard();

    return () => controller.abort();
  }, [authenticated, userRole, navigate, refreshKey]);

  const todayClasses = useMemo<TodayClass[]>(() => {
    if (
      !scheduleData?.enrollment ||
      scheduleData.enrollment.enrollment_status !== "Approved"
    ) {
      return [];
    }

    const todayName = DAY_NAMES[new Date().getDay()];

    return scheduleData.subjects
      .filter(
        (subject) =>
          subject.subject_status === "Enrolled" &&
          subject.offering_status !== "Cancelled" &&
          isScheduledToday(subject.schedule_days, todayName),
      )
      .map((subject) => {
        const range = parseScheduleTimeRange(subject.schedule_time);

        if (!range) {
          return null;
        }

        return {
          enrollment_subject_id: subject.enrollment_subject_id,
          subject_code: subject.subject_code,
          subject_name: subject.subject_name,
          section_name: subject.section_name,
          faculty_name: subject.faculty_name,
          start_minutes: range.start,
          start_label: formatTime(range.start),
          end_label: formatTime(range.end),
          duration_label: formatDuration(range.start, range.end),
        };
      })
      .filter((subject): subject is TodayClass => subject !== null)
      .sort((a, b) => a.start_minutes - b.start_minutes);
  }, [scheduleData]);

  const displayName = profile?.full_name?.trim() || user?.username || "Student";
  const studentNumber = profile?.student_number || "Student account";
  const enrollmentStatus =
    profile?.enrollment_status ||
    scheduleData?.enrollment?.enrollment_status ||
    "Not available";

  const currentPeriod =
    [
      profile?.academic_year?.academic_year || scheduleData?.enrollment?.academic_year,
      profile?.semester?.semester_name || scheduleData?.enrollment?.semester_name,
    ]
      .filter(Boolean)
      .join(" · ") || "Not recorded";

  const academicIdentity = [
    profile?.course?.course_code,
    formatYearLevel(profile?.year_level),
    profile?.section?.section_name,
  ].filter((value) => value && value !== "Not recorded");

  const latestAnnouncements = announcements.slice(0, 3);
  const hasPartialError = Boolean(profileError || scheduleError || announcementError);

  if (!authenticated || !user || userRole !== "Student") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="student-dashboard">
        <section className="student-dashboard__hero">
          <div className="student-dashboard__hero-copy">
            <div className="student-dashboard__eyebrow">
              <span>
                <GraduationCap size={16} strokeWidth={2.2} />
              </span>
              Student · Dashboard
            </div>

            <h1>Welcome back, {displayName}</h1>

            <p>
              Review your enrollment, class schedule, academic records, and
              Student announcements from one organized workspace.
            </p>

            <div className="student-dashboard__identity-line">
              <span>{studentNumber}</span>
              {academicIdentity.length > 0 && <i />}
              {academicIdentity.length > 0 && (
                <span>{academicIdentity.join(" · ")}</span>
              )}
            </div>
          </div>

          <button
            type="button"
            className="student-dashboard__refresh"
            onClick={() => setRefreshKey((current) => current + 1)}
            disabled={loading || refreshing}
          >
            <RefreshCw
              size={16}
              className={refreshing ? "is-spinning" : ""}
            />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </section>

        {hasPartialError && !loading && (
          <section className="student-dashboard__notice" role="status">
            <CircleAlert size={18} />
            <div>
              <strong>Some dashboard information is unavailable</strong>
              <p>
                The rest of your Student dashboard is still available. Use the
                Refresh button to try loading the missing information again.
              </p>
            </div>
          </section>
        )}

        <section className="student-dashboard__overview" aria-label="Student overview">
          <article className="student-dashboard__stat student-dashboard__stat--primary">
            <span className="student-dashboard__stat-icon">
              <CheckCircle2 size={19} />
            </span>
            <div>
              <small>Enrollment Status</small>
              <strong className={`student-dashboard__status ${getStatusClass(enrollmentStatus)}`}>
                {loading ? "…" : enrollmentStatus}
              </strong>
              <span>Your current enrollment state</span>
            </div>
          </article>

          <article className="student-dashboard__stat">
            <span className="student-dashboard__stat-icon">
              <CalendarDays size={19} />
            </span>
            <div>
              <small>Current Period</small>
              <strong className="student-dashboard__stat-text">
                {loading ? "…" : currentPeriod}
              </strong>
              <span>Academic year and semester</span>
            </div>
          </article>

          <article className="student-dashboard__stat">
            <span className="student-dashboard__stat-icon">
              <Clock3 size={19} />
            </span>
            <div>
              <small>Today's Classes</small>
              <strong>{loading ? "…" : todayClasses.length}</strong>
              <span>{formatToday()}</span>
            </div>
          </article>

          <article className="student-dashboard__stat">
            <span className="student-dashboard__stat-icon">
              <Megaphone size={19} />
            </span>
            <div>
              <small>Announcements</small>
              <strong>{loading ? "…" : announcements.length}</strong>
              <span>Active notices for Students</span>
            </div>
          </article>
        </section>

        <section className="student-dashboard__quick-access">
          <header className="student-dashboard__section-heading">
            <div>
              <span>Student Services</span>
              <h2>Quick Access</h2>
              <p>Open the Student tools you use most often.</p>
            </div>
          </header>

          <div className="student-dashboard__quick-grid">
            {quickActions.map((action) => {
              const Icon = action.icon;

              return (
                <button
                  key={action.path}
                  type="button"
                  className="student-dashboard__quick-card"
                  onClick={() => navigate(action.path)}
                >
                  <span className="student-dashboard__quick-icon">
                    <Icon size={20} strokeWidth={2.05} />
                  </span>

                  <span className="student-dashboard__quick-copy">
                    <strong>{action.title}</strong>
                    <small>{action.description}</small>
                  </span>

                  <ArrowRight size={16} className="student-dashboard__quick-arrow" />
                </button>
              );
            })}
          </div>
        </section>

        <div className="student-dashboard__main-grid">
          <section className="student-dashboard__panel">
            <header className="student-dashboard__section-heading student-dashboard__section-heading--row">
              <div>
                <span>Today</span>
                <h2>Today's Schedule</h2>
                <p>{formatToday()}</p>
              </div>

              <button type="button" onClick={() => navigate("/student/schedule")}>
                Full Schedule
                <ArrowRight size={14} />
              </button>
            </header>

            <div className="student-dashboard__schedule-list">
              {loading ? (
                [1, 2, 3].map((item) => (
                  <div className="student-dashboard__schedule-skeleton" key={item}>
                    <i />
                    <span>
                      <i />
                      <i />
                    </span>
                    <i />
                  </div>
                ))
              ) : scheduleError ? (
                <div className="student-dashboard__empty">
                  <CircleAlert size={22} />
                  <strong>Schedule unavailable</strong>
                  <p>{scheduleError}</p>
                </div>
              ) : !scheduleData?.enrollment ? (
                <div className="student-dashboard__empty">
                  <CalendarDays size={22} />
                  <strong>No official schedule yet</strong>
                  <p>
                    Your class schedule will appear after an approved enrollment
                    is available.
                  </p>
                </div>
              ) : todayClasses.length === 0 ? (
                <div className="student-dashboard__empty">
                  <CalendarDays size={22} />
                  <strong>No classes scheduled for today</strong>
                  <p>Open the full schedule to review the rest of your week.</p>
                </div>
              ) : (
                todayClasses.map((subject) => (
                  <article
                    className="student-dashboard__schedule-item"
                    key={subject.enrollment_subject_id}
                  >
                    <div className="student-dashboard__schedule-time">
                      <Clock3 size={14} />
                      <strong>{subject.start_label}</strong>
                      <small>{subject.end_label}</small>
                    </div>

                    <div className="student-dashboard__schedule-copy">
                      <span>{subject.subject_code}</span>
                      <strong>{subject.subject_name}</strong>
                      <small>
                        {[subject.section_name, subject.faculty_name]
                          .filter(Boolean)
                          .join(" · ") || "Official class"}
                      </small>
                    </div>

                    <span className="student-dashboard__duration">
                      {subject.duration_label}
                    </span>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="student-dashboard__panel">
            <header className="student-dashboard__section-heading student-dashboard__section-heading--row">
              <div>
                <span>Student Notices</span>
                <h2>Latest Announcements</h2>
                <p>Active and published notices for your Student role.</p>
              </div>

              <button type="button" onClick={() => navigate("/student/announcement")}>
                View All
                <ArrowRight size={14} />
              </button>
            </header>

            <div className="student-dashboard__announcement-list">
              {loading ? (
                [1, 2, 3].map((item) => (
                  <div className="student-dashboard__announcement-skeleton" key={item}>
                    <i />
                    <span>
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                ))
              ) : announcementError ? (
                <div className="student-dashboard__empty">
                  <CircleAlert size={22} />
                  <strong>Announcements unavailable</strong>
                  <p>{announcementError}</p>
                </div>
              ) : latestAnnouncements.length === 0 ? (
                <div className="student-dashboard__empty">
                  <Megaphone size={22} />
                  <strong>No announcements available</strong>
                  <p>There are currently no active notices for Students.</p>
                </div>
              ) : (
                latestAnnouncements.map((announcement) => (
                  <button
                    type="button"
                    className="student-dashboard__announcement-item"
                    key={announcement.announcement_id}
                    onClick={() =>
                      navigate(`/student/announcementD/${announcement.announcement_id}`)
                    }
                  >
                    <span className="student-dashboard__announcement-icon">
                      <Megaphone size={16} />
                    </span>

                    <span className="student-dashboard__announcement-copy">
                      <small>{formatDate(announcement.publish_date)}</small>
                      <strong>{announcement.title}</strong>
                      <span>{getAnnouncementPreview(announcement.content)}</span>
                    </span>

                    <ArrowRight size={15} />
                  </button>
                ))
              )}
            </div>
          </section>
        </div>

        <section className="student-dashboard__academic">
          <header className="student-dashboard__section-heading">
            <div>
              <span>Student Record</span>
              <h2>Academic Information</h2>
              <p>Quick reference information from your Student profile.</p>
            </div>
          </header>

          <div className="student-dashboard__academic-grid">
            <div>
              <small>Program</small>
              <strong>
                {loading
                  ? "…"
                  : profile?.course?.course_code ||
                    profile?.course?.course_name ||
                    "Not recorded"}
              </strong>
            </div>

            <div>
              <small>Year Level</small>
              <strong>{loading ? "…" : formatYearLevel(profile?.year_level)}</strong>
            </div>

            <div>
              <small>Section</small>
              <strong>{loading ? "…" : profile?.section?.section_name || "Not recorded"}</strong>
            </div>

            <div>
              <small>Student Status</small>
              <strong>{loading ? "…" : profile?.student_status || "Not recorded"}</strong>
            </div>
          </div>

          <div className="student-dashboard__secondary-actions">
            {secondaryActions.map((action) => {
              const Icon = action.icon;

              return (
                <button
                  key={action.path}
                  type="button"
                  onClick={() => navigate(action.path)}
                >
                  <span>
                    <Icon size={16} />
                  </span>
                  <strong>{action.title}</strong>
                  <ArrowRight size={14} />
                </button>
              );
            })}
          </div>
        </section>
      </main>
    </DashboardLayout>
  );
}
