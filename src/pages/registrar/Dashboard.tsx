import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  RefreshCw,
  School,
  Settings2,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../components/Layout/DashboardLayout";
import { authService } from "../../services/auth.service";
import "../../styles/RegistrarDashboard.css";

const STUDENTS_API = "http://localhost:3000/api/registrar/students";
const ENROLLMENTS_API = "http://localhost:3000/api/registrar/enrollments";
const PERIOD_API = `${ENROLLMENTS_API}/period`;
const ANNOUNCEMENTS_API = "http://localhost:3000/api/announcement-management";

interface StudentResponse {
  success: boolean;
  totalStudents?: number;
  message?: string;
  error?: string;
}

interface PendingEnrollment {
  enrollment_id: number;
  student: {
    student_id: number;
    student_number: string;
    student_name: string;
    first_name?: string;
    middle_name?: string | null;
    last_name?: string;
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
  enrollment_status: string;
  total_subjects: number;
  total_units: number;
  created_at: string;
}

interface EnrollmentResponse {
  success: boolean;
  data?: PendingEnrollment[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  message?: string;
  error?: string;
}

interface AcademicYear {
  academic_year_id: number;
  academic_year: string;
  is_current?: boolean | number;
}

interface EnrollmentPeriod {
  enrollment_period_id: number;
  academic_year_id: number;
  academic_year: string;
  semester_id: number;
  semester_name: string;
  status: string;
  opened_by?: number | null;
  opened_by_username?: string | null;
  opened_at?: string | null;
  closed_by?: number | null;
  closed_by_username?: string | null;
  closed_at?: string | null;
  remarks?: string | null;
}

interface PeriodResponse {
  success: boolean;
  enrollment_period?: EnrollmentPeriod | null;
  academic_years?: AcademicYear[];
  message?: string;
  error?: string;
}

interface Announcement {
  announcement_id: number;
  title: string;
  content: string;
  created_by: string;
  publish_date: string;
  expiry_date: string | null;
  is_active: number;
  created_at: string;
  recipients: string | null;
}

interface AnnouncementResponse {
  success?: boolean;
  data?: Announcement[];
  announcements?: Announcement[];
  message?: string;
  error?: string;
}

type DashboardSource = "students" | "enrollments" | "period" | "announcements";

const formatDate = (value?: string | null) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";

  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";

  return date.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const getInitials = (name: string) => {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "S";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const getRecipientLabels = (recipients: string | null) => {
  if (!recipients?.trim()) return [];
  const value = recipients.trim();

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    // Existing endpoint may return a comma-separated string instead of JSON.
  }

  return value
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const getAnnouncementExcerpt = (content: string) => {
  const normalized = (content || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "No announcement content provided.";
  return normalized.length > 132 ? `${normalized.slice(0, 132)}…` : normalized;
};

export default function RegistrarDashboard() {
  const navigate = useNavigate();
  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [studentTotal, setStudentTotal] = useState<number | null>(null);
  const [pendingEnrollments, setPendingEnrollments] = useState<PendingEnrollment[]>([]);
  const [pendingTotal, setPendingTotal] = useState<number | null>(null);
  const [periodData, setPeriodData] = useState<PeriodResponse | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [warnings, setWarnings] = useState<DashboardSource[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") {
      navigate("/login", { replace: true });
    }
  }, [authenticated, userRole, navigate]);

  const parseJsonResponse = async <T,>(response: Response): Promise<T> => {
    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      const text = await response.text();
      throw new Error(
        `Server returned a non-JSON response (${response.status}): ${text.slice(0, 160)}`,
      );
    }

    return response.json() as Promise<T>;
  };

  const handleAuthResponse = useCallback(
    (response: Response) => {
      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return false;
      }

      if (response.status === 403) {
        return false;
      }

      return true;
    },
    [navigate],
  );

  const loadDashboard = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (!authenticated || userRole !== "Registrar") return;

      const controller = new AbortController();

      try {
        if (mode === "initial") setLoading(true);
        if (mode === "refresh") setRefreshing(true);
        setWarnings([]);

        const requests = await Promise.allSettled([
          authService.authFetch(`${STUDENTS_API}?page=1&limit=1`, {
            method: "GET",
            signal: controller.signal,
            headers: { Accept: "application/json" },
          }),
          authService.authFetch(`${ENROLLMENTS_API}?page=1&limit=5&status=Pending`, {
            method: "GET",
            signal: controller.signal,
            headers: { Accept: "application/json" },
          }),
          authService.authFetch(PERIOD_API, {
            method: "GET",
            signal: controller.signal,
            headers: { Accept: "application/json" },
          }),
          authService.authFetch(ANNOUNCEMENTS_API, {
            method: "GET",
            signal: controller.signal,
            headers: { Accept: "application/json" },
          }),
        ]);

        const nextWarnings: DashboardSource[] = [];

        // Student records
        if (requests[0].status === "fulfilled") {
          const response = requests[0].value;
          if (!handleAuthResponse(response)) {
            if (response.status !== 401) nextWarnings.push("students");
          } else if (response.ok) {
            try {
              const data = await parseJsonResponse<StudentResponse>(response);
              if (data.success) {
                setStudentTotal(Number(data.totalStudents || 0));
              } else {
                nextWarnings.push("students");
              }
            } catch {
              nextWarnings.push("students");
            }
          } else {
            nextWarnings.push("students");
          }
        } else {
          nextWarnings.push("students");
        }

        // Pending enrollment queue
        if (requests[1].status === "fulfilled") {
          const response = requests[1].value;
          if (!handleAuthResponse(response)) {
            if (response.status !== 401) nextWarnings.push("enrollments");
          } else if (response.ok) {
            try {
              const data = await parseJsonResponse<EnrollmentResponse>(response);
              if (data.success) {
                setPendingEnrollments(Array.isArray(data.data) ? data.data : []);
                setPendingTotal(Number(data.pagination?.total || 0));
              } else {
                nextWarnings.push("enrollments");
              }
            } catch {
              nextWarnings.push("enrollments");
            }
          } else {
            nextWarnings.push("enrollments");
          }
        } else {
          nextWarnings.push("enrollments");
        }

        // Enrollment period
        if (requests[2].status === "fulfilled") {
          const response = requests[2].value;
          if (!handleAuthResponse(response)) {
            if (response.status !== 401) nextWarnings.push("period");
          } else if (response.ok) {
            try {
              const data = await parseJsonResponse<PeriodResponse>(response);
              if (data.success) {
                setPeriodData(data);
              } else {
                nextWarnings.push("period");
              }
            } catch {
              nextWarnings.push("period");
            }
          } else {
            nextWarnings.push("period");
          }
        } else {
          nextWarnings.push("period");
        }

        // Announcements
        if (requests[3].status === "fulfilled") {
          const response = requests[3].value;
          if (!handleAuthResponse(response)) {
            if (response.status !== 401) nextWarnings.push("announcements");
          } else if (response.ok) {
            try {
              const data = await parseJsonResponse<Announcement[] | AnnouncementResponse>(
                response,
              );

              const rows = Array.isArray(data)
                ? data
                : Array.isArray(data.data)
                  ? data.data
                  : Array.isArray(data.announcements)
                    ? data.announcements
                    : [];

              setAnnouncements(rows);
            } catch {
              nextWarnings.push("announcements");
            }
          } else {
            nextWarnings.push("announcements");
          }
        } else {
          nextWarnings.push("announcements");
        }

        setWarnings(Array.from(new Set(nextWarnings)));
        setLastUpdated(new Date());
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [authenticated, userRole, handleAuthResponse],
  );

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") return;
    void loadDashboard("initial");
  }, [authenticated, userRole, loadDashboard]);

  const latestPeriod = periodData?.enrollment_period || null;
  const periodIsOpen = latestPeriod?.status?.trim().toLowerCase() === "open";

  const currentAcademicYear = useMemo(
    () =>
      (periodData?.academic_years || []).find(
        (year) => year.is_current === true || Number(year.is_current) === 1,
      ),
    [periodData],
  );

  const activeAnnouncements = useMemo(
    () => announcements.filter((item) => Number(item.is_active) === 1).length,
    [announcements],
  );

  const recentAnnouncements = useMemo(
    () =>
      [...announcements]
        .sort((a, b) => {
          const aDate = new Date(a.publish_date || a.created_at).getTime();
          const bDate = new Date(b.publish_date || b.created_at).getTime();
          return (Number.isNaN(bDate) ? 0 : bDate) - (Number.isNaN(aDate) ? 0 : aDate);
        })
        .slice(0, 3),
    [announcements],
  );

  const quickActions = [
    {
      label: "Student Records",
      description: "Find students and open academic records.",
      path: "/registrar/student/listR",
      icon: UsersRound,
    },
    {
      label: "Enrollment Queue",
      description: "Review pending student enrollments.",
      path: "/registrar/enrollment/management",
      icon: ClipboardCheck,
    },
    {
      label: "Enrollment Period",
      description: "Open, close, or review enrollment access.",
      path: "/registrar/enrollment/periodM",
      icon: CalendarClock,
    },
    {
      label: "Class Offerings",
      description: "Prepare sections, faculty, rooms, and schedules.",
      path: "/registrar/offering/managementR",
      icon: School,
    },
    {
      label: "Curriculum",
      description: "Review curricula and mapped subjects.",
      path: "/registrar/curriculum/management",
      icon: GraduationCap,
    },
    {
      label: "Announcements",
      description: "Create and manage official portal notices.",
      path: "/registrar/announcement/listR",
      icon: Megaphone,
    },
  ];

  const sourceLabels: Record<DashboardSource, string> = {
    students: "student records",
    enrollments: "enrollment queue",
    period: "enrollment period",
    announcements: "announcements",
  };

  if (!authenticated || !user || userRole !== "Registrar") return null;

  return (
    <DashboardLayout>
      <main className="registrar-dashboard">
        <section className="registrar-dashboard__hero">
          <div className="registrar-dashboard__hero-copy">
            <div className="registrar-dashboard__eyebrow">
              <span className="registrar-dashboard__eyebrow-icon">
                <LayoutDashboard size={16} strokeWidth={2.2} />
              </span>
              Registrar · Operations
            </div>
            <h1>Registrar Dashboard</h1>
            <p>
              Review enrollment priorities, academic-period status, student records,
              and official announcements from one Registrar workspace.
            </p>
          </div>

          <div className="registrar-dashboard__hero-actions">
            <div className="registrar-dashboard__user-badge">
              <span className="registrar-dashboard__user-badge-icon">
                <ShieldCheck size={19} strokeWidth={2.1} />
              </span>
              <span>
                <small>Signed in as</small>
                <strong>{user.username}</strong>
              </span>
            </div>

            <button
              type="button"
              className="registrar-dashboard__button registrar-dashboard__button--secondary"
              onClick={() => void loadDashboard("refresh")}
              disabled={refreshing}
            >
              <RefreshCw
                size={16}
                className={refreshing ? "registrar-dashboard__spin" : undefined}
              />
              {refreshing ? "Refreshing" : "Refresh"}
            </button>
          </div>
        </section>

        {warnings.length > 0 && !loading && (
          <div className="registrar-dashboard__notice" role="status">
            <AlertCircle size={18} />
            <div>
              <strong>Some dashboard data could not be refreshed.</strong>
              <p>
                Unavailable: {warnings.map((item) => sourceLabels[item]).join(", ")}. You
                can still use the dashboard shortcuts normally.
              </p>
            </div>
          </div>
        )}

        <section className="registrar-dashboard__stats" aria-label="Registrar overview">
          <button
            type="button"
            className="registrar-dashboard__stat-card"
            onClick={() => navigate("/registrar/student/listR")}
          >
            <span className="registrar-dashboard__stat-icon registrar-dashboard__stat-icon--primary">
              <UsersRound size={20} />
            </span>
            <span className="registrar-dashboard__stat-copy">
              <span>Total Students</span>
              <strong>{loading || studentTotal === null ? "—" : studentTotal}</strong>
              <small>Registered student records</small>
            </span>
            <ChevronRight size={17} className="registrar-dashboard__stat-arrow" />
          </button>

          <button
            type="button"
            className="registrar-dashboard__stat-card registrar-dashboard__stat-card--attention"
            onClick={() => navigate("/registrar/enrollment/management")}
          >
            <span className="registrar-dashboard__stat-icon registrar-dashboard__stat-icon--warning">
              <ClipboardCheck size={20} />
            </span>
            <span className="registrar-dashboard__stat-copy">
              <span>Pending Enrollments</span>
              <strong>{loading || pendingTotal === null ? "—" : pendingTotal}</strong>
              <small>Waiting for Registrar review</small>
            </span>
            <ChevronRight size={17} className="registrar-dashboard__stat-arrow" />
          </button>

          <button
            type="button"
            className={`registrar-dashboard__stat-card ${
              periodIsOpen ? "registrar-dashboard__stat-card--success" : ""
            }`}
            onClick={() => navigate("/registrar/enrollment/periodM")}
          >
            <span
              className={`registrar-dashboard__stat-icon ${
                periodIsOpen ? "registrar-dashboard__stat-icon--success" : ""
              }`}
            >
              <CalendarClock size={20} />
            </span>
            <span className="registrar-dashboard__stat-copy">
              <span>Enrollment Access</span>
              <strong>{loading ? "—" : periodIsOpen ? "Open" : "Closed"}</strong>
              <small>
                {latestPeriod
                  ? `${latestPeriod.academic_year} · ${latestPeriod.semester_name}`
                  : "No period record returned"}
              </small>
            </span>
            <ChevronRight size={17} className="registrar-dashboard__stat-arrow" />
          </button>

          <button
            type="button"
            className="registrar-dashboard__stat-card"
            onClick={() => navigate("/registrar/announcement/listR")}
          >
            <span className="registrar-dashboard__stat-icon">
              <Megaphone size={20} />
            </span>
            <span className="registrar-dashboard__stat-copy">
              <span>Active Announcements</span>
              <strong>{loading ? "—" : activeAnnouncements}</strong>
              <small>{announcements.length} announcement records</small>
            </span>
            <ChevronRight size={17} className="registrar-dashboard__stat-arrow" />
          </button>
        </section>

        <section className="registrar-dashboard__priority-grid">
          <article className="registrar-dashboard__panel registrar-dashboard__panel--queue">
            <div className="registrar-dashboard__panel-header">
              <div>
                <span className="registrar-dashboard__section-kicker">
                  <ClipboardCheck size={14} /> Priority Work Queue
                </span>
                <h2>Pending Enrollment Reviews</h2>
                <p>
                  Open the students currently waiting for Registrar validation and
                  approval.
                </p>
              </div>
              <button
                type="button"
                className="registrar-dashboard__text-action"
                onClick={() => navigate("/registrar/enrollment/management")}
              >
                View queue <ArrowRight size={15} />
              </button>
            </div>

            {loading ? (
              <div className="registrar-dashboard__queue-list">
                {[1, 2, 3, 4].map((item) => (
                  <div className="registrar-dashboard__queue-skeleton" key={item}>
                    <span />
                    <div><i /><i /></div>
                    <i />
                  </div>
                ))}
              </div>
            ) : pendingEnrollments.length > 0 ? (
              <div className="registrar-dashboard__queue-list">
                {pendingEnrollments.map((enrollment) => {
                  const placementTotal =
                    enrollment.placement.placed_subjects +
                    enrollment.placement.unplaced_subjects;
                  const placementPercent =
                    placementTotal > 0
                      ? Math.round(
                          (enrollment.placement.placed_subjects / placementTotal) * 100,
                        )
                      : 0;

                  return (
                    <div
                      className="registrar-dashboard__queue-item"
                      key={enrollment.enrollment_id}
                    >
                      <span className="registrar-dashboard__student-avatar">
                        {getInitials(enrollment.student.student_name)}
                      </span>

                      <div className="registrar-dashboard__queue-student">
                        <strong>{enrollment.student.student_name}</strong>
                        <span>
                          {enrollment.student.student_number} · {enrollment.course.course_code}
                          {enrollment.student.year_level
                            ? ` · Year ${enrollment.student.year_level}`
                            : ""}
                        </span>
                      </div>

                      <div className="registrar-dashboard__queue-period">
                        <span>Academic Period</span>
                        <strong>{enrollment.academic_period.academic_year}</strong>
                        <small>{enrollment.academic_period.semester_name}</small>
                      </div>

                      <div className="registrar-dashboard__queue-load">
                        <span>Placement</span>
                        <div className="registrar-dashboard__placement-line">
                          <div>
                            <span style={{ width: `${placementPercent}%` }} />
                          </div>
                          <small>
                            {enrollment.placement.placed_subjects}/{placementTotal || 0}
                          </small>
                        </div>
                      </div>

                      <div className="registrar-dashboard__queue-units">
                        <span>Load</span>
                        <strong>{enrollment.total_units} units</strong>
                        <small>{enrollment.total_subjects} subjects</small>
                      </div>

                      <button
                        type="button"
                        className="registrar-dashboard__review-button"
                        onClick={() =>
                          navigate(`/registrar/enrollment/${enrollment.enrollment_id}`)
                        }
                      >
                        Review <ChevronRight size={15} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : warnings.includes("enrollments") ? (
              <div className="registrar-dashboard__inline-state registrar-dashboard__inline-state--warning">
                <AlertCircle size={22} />
                <div>
                  <strong>Enrollment queue unavailable</strong>
                  <p>Open Student Enrollment directly to retry the queue.</p>
                </div>
              </div>
            ) : (
              <div className="registrar-dashboard__inline-state registrar-dashboard__inline-state--success">
                <CheckCircle2 size={24} />
                <div>
                  <strong>No pending enrollment reviews</strong>
                  <p>The current Registrar enrollment queue is clear.</p>
                </div>
              </div>
            )}
          </article>

          <aside className="registrar-dashboard__panel registrar-dashboard__period-card">
            <div className="registrar-dashboard__panel-header registrar-dashboard__panel-header--compact">
              <div>
                <span className="registrar-dashboard__section-kicker">
                  <CalendarDays size={14} /> Academic Period
                </span>
                <h2>Enrollment Access</h2>
              </div>
              <span
                className={`registrar-dashboard__period-status ${
                  periodIsOpen
                    ? "registrar-dashboard__period-status--open"
                    : "registrar-dashboard__period-status--closed"
                }`}
              >
                <span />
                {loading ? "Loading" : periodIsOpen ? "Open" : "Closed"}
              </span>
            </div>

            {loading ? (
              <div className="registrar-dashboard__period-skeleton">
                <i /><i /><i /><i />
              </div>
            ) : (
              <>
                <div className="registrar-dashboard__period-focus">
                  <span className="registrar-dashboard__period-focus-icon">
                    <CalendarClock size={21} />
                  </span>
                  <div>
                    <span>Current / Latest Term</span>
                    <strong>
                      {latestPeriod?.academic_year ||
                        currentAcademicYear?.academic_year ||
                        "Not configured"}
                    </strong>
                    <small>{latestPeriod?.semester_name || "No open semester"}</small>
                  </div>
                </div>

                <div className="registrar-dashboard__period-details">
                  <div>
                    <span>Latest Record</span>
                    <strong>
                      {latestPeriod ? `#${latestPeriod.enrollment_period_id}` : "None"}
                    </strong>
                  </div>
                  <div>
                    <span>{periodIsOpen ? "Opened At" : "Last Closed"}</span>
                    <strong>
                      {periodIsOpen
                        ? formatDateTime(latestPeriod?.opened_at)
                        : formatDateTime(latestPeriod?.closed_at)}
                    </strong>
                  </div>
                  <div>
                    <span>{periodIsOpen ? "Opened By" : "Closed By"}</span>
                    <strong>
                      {periodIsOpen
                        ? latestPeriod?.opened_by_username || "Not recorded"
                        : latestPeriod?.closed_by_username || "Not recorded"}
                    </strong>
                  </div>
                </div>

                <div
                  className={`registrar-dashboard__period-note ${
                    periodIsOpen
                      ? "registrar-dashboard__period-note--open"
                      : "registrar-dashboard__period-note--closed"
                  }`}
                >
                  {periodIsOpen ? <CheckCircle2 size={17} /> : <Clock3 size={17} />}
                  <p>
                    {periodIsOpen
                      ? "Students can submit prepared enrollment for the active term."
                      : "Student enrollment submission is currently unavailable."}
                  </p>
                </div>

                <button
                  type="button"
                  className="registrar-dashboard__button registrar-dashboard__button--primary registrar-dashboard__period-button"
                  onClick={() => navigate("/registrar/enrollment/periodM")}
                >
                  <Settings2 size={16} />
                  Manage Enrollment Period
                </button>
              </>
            )}
          </aside>
        </section>

        <section className="registrar-dashboard__panel registrar-dashboard__quick-panel">
          <div className="registrar-dashboard__panel-header">
            <div>
              <span className="registrar-dashboard__section-kicker">
                <LayoutDashboard size={14} /> Registrar Workspace
              </span>
              <h2>Quick Actions</h2>
              <p>Jump directly to the Registrar tools used throughout the academic cycle.</p>
            </div>
          </div>

          <div className="registrar-dashboard__quick-grid">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  type="button"
                  className="registrar-dashboard__quick-card"
                  key={action.path}
                  onClick={() => navigate(action.path)}
                >
                  <span className="registrar-dashboard__quick-icon">
                    <Icon size={20} />
                  </span>
                  <span className="registrar-dashboard__quick-copy">
                    <strong>{action.label}</strong>
                    <small>{action.description}</small>
                  </span>
                  <ChevronRight size={17} />
                </button>
              );
            })}
          </div>
        </section>

        <section className="registrar-dashboard__panel registrar-dashboard__announcement-panel">
          <div className="registrar-dashboard__panel-header">
            <div>
              <span className="registrar-dashboard__section-kicker">
                <Megaphone size={14} /> Communications
              </span>
              <h2>Recent Announcements</h2>
              <p>Latest official portal notices available from Announcement Management.</p>
            </div>
            <button
              type="button"
              className="registrar-dashboard__text-action"
              onClick={() => navigate("/registrar/announcement/listR")}
            >
              Manage announcements <ArrowRight size={15} />
            </button>
          </div>

          {loading ? (
            <div className="registrar-dashboard__announcement-grid">
              {[1, 2, 3].map((item) => (
                <div className="registrar-dashboard__announcement-skeleton" key={item}>
                  <i /><i /><i />
                </div>
              ))}
            </div>
          ) : recentAnnouncements.length > 0 ? (
            <div className="registrar-dashboard__announcement-grid">
              {recentAnnouncements.map((announcement) => {
                const recipients = getRecipientLabels(announcement.recipients);
                const active = Number(announcement.is_active) === 1;

                return (
                  <button
                    type="button"
                    className="registrar-dashboard__announcement-card"
                    key={announcement.announcement_id}
                    onClick={() =>
                      navigate(`/registrar/announcement/DetailR/${announcement.announcement_id}`)
                    }
                  >
                    <div className="registrar-dashboard__announcement-topline">
                      <span
                        className={`registrar-dashboard__announcement-status ${
                          active
                            ? "registrar-dashboard__announcement-status--active"
                            : "registrar-dashboard__announcement-status--inactive"
                        }`}
                      >
                        <span /> {active ? "Active" : "Inactive"}
                      </span>
                      <span>{formatDate(announcement.publish_date || announcement.created_at)}</span>
                    </div>

                    <strong>{announcement.title}</strong>
                    <p>{getAnnouncementExcerpt(announcement.content)}</p>

                    <div className="registrar-dashboard__announcement-footer">
                      <span>
                        <UserRound size={13} /> {announcement.created_by || "Unknown creator"}
                      </span>
                      {recipients.length > 0 && (
                        <span>
                          <UsersRound size={13} /> {recipients.slice(0, 2).join(", ")}
                          {recipients.length > 2 ? ` +${recipients.length - 2}` : ""}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : warnings.includes("announcements") ? (
            <div className="registrar-dashboard__inline-state registrar-dashboard__inline-state--warning">
              <AlertCircle size={22} />
              <div>
                <strong>Announcements unavailable</strong>
                <p>Open Announcement Management directly to retry.</p>
              </div>
            </div>
          ) : (
            <div className="registrar-dashboard__inline-state">
              <Megaphone size={22} />
              <div>
                <strong>No announcements yet</strong>
                <p>Create an official portal announcement when needed.</p>
              </div>
            </div>
          )}
        </section>

        <div className="registrar-dashboard__footer-meta">
          <FileText size={13} />
          <span>
            Dashboard data {lastUpdated ? `updated ${lastUpdated.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}` : "is loading"}.
          </span>
        </div>
      </main>
    </DashboardLayout>
  );
}
