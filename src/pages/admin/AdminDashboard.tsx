import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  BellRing,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Database,
  GraduationCap,
  Megaphone,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserCog,
  UserPlus,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../components/Layout/DashboardLayout";
import { authService } from "../../services/auth.service";
import "../styles/dashboard.css";

const API_BASE_URL = "http://localhost:3000";

type DataSource = "users" | "students" | "activity" | "announcements";

interface PortalUser {
  user_id: number;
  username: string;
  email: string;
  role: string;
  is_active: boolean | number;
}

interface StudentRecord {
  student_id?: number;
  user_id?: number;
  student_number?: string;
  username?: string;
  status?: string;
}

interface ActivityLog {
  activity_id: number;
  user_id: number;
  username: string;
  role: string;
  activity_type: string;
  module_name: string;
  description: string;
  created_at: string;
}

interface Announcement {
  announcement_id: number;
  title: string;
  content: string;
  created_by: string;
  publish_date: string;
  expiry_date: string | null;
  is_active: number | boolean;
  created_at: string;
  recipients: string | null;
}

type SourceErrors = Partial<Record<DataSource, string>>;

const ROLE_ORDER = ["Admin", "Registrar", "Program Head", "Faculty", "Student"];

function getResponseMessage(payload: unknown, fallback: string) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return fallback;
  }

  const object = payload as Record<string, unknown>;
  const message = object.message;
  const error = object.error;

  if (typeof message === "string" && message.trim()) return message;
  if (typeof error === "string" && error.trim()) return error;

  return fallback;
}

function extractCollection<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];

  if (!payload || typeof payload !== "object") return [];

  const object = payload as Record<string, unknown>;

  for (const key of keys) {
    const candidate = object[key];

    if (Array.isArray(candidate)) {
      return candidate as T[];
    }
  }

  return [];
}

async function fetchCollection<T>(
  url: string,
  keys: string[],
  signal: AbortSignal,
): Promise<T[]> {
  const response = await authService.authFetch(url, {
    method: "GET",
    signal,
    headers: {
      Accept: "application/json",
    },
  });

  const contentType = response.headers.get("content-type") || "";
  let payload: unknown = null;

  if (contentType.includes("application/json")) {
    payload = await response.json();
  } else {
    const text = await response.text();

    throw new Error(
      `Server returned a non-JSON response (${response.status}): ${text.slice(
        0,
        160,
      )}`,
    );
  }

  if (response.status === 401) {
    throw new Error("__ADMIN_SESSION_EXPIRED__");
  }

  if (response.status === 403) {
    throw new Error(
      getResponseMessage(
        payload,
        "You are not authorized to load this dashboard information.",
      ),
    );
  }

  if (!response.ok) {
    throw new Error(
      getResponseMessage(
        payload,
        `Dashboard request failed (${response.status}).`,
      ),
    );
  }

  return extractCollection<T>(payload, keys);
}

function isActiveUser(user: PortalUser) {
  return user.is_active === true || Number(user.is_active) === 1;
}

function isActiveAnnouncement(announcement: Announcement) {
  return (
    announcement.is_active === true || Number(announcement.is_active) === 1
  );
}

function parseTime(value?: string | null) {
  if (!value) return 0;

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatDate(value?: string | null) {
  if (!value) return "Not available";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Not available";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not available";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Not available";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function truncate(value: string | null | undefined, limit: number) {
  const clean = String(value || "").trim();

  if (!clean) return "No additional details provided.";
  if (clean.length <= limit) return clean;

  return `${clean.slice(0, limit).trim()}…`;
}

export default function AdminDashboard() {
  const navigate = useNavigate();

  const user = authService.getSession();
  const token = authService.getToken();
  const authenticated = Boolean(user && token);
  const userRole = user?.role;

  const [users, setUsers] = useState<PortalUser[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  const [sourceErrors, setSourceErrors] = useState<SourceErrors>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Admin") {
      if (userRole) {
        navigate(authService.getDashboardRoute(userRole), { replace: true });
      } else {
        navigate("/login", { replace: true });
      }
    }
  }, [authenticated, userRole, navigate]);

  const loadDashboard = useCallback(
    async (initialLoad = false) => {
      if (!authenticated || userRole !== "Admin") return;

      const controller = new AbortController();

      if (initialLoad) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      const requests = [
        fetchCollection<PortalUser>(
          `${API_BASE_URL}/api/users`,
          ["users", "data"],
          controller.signal,
        ),
        fetchCollection<StudentRecord>(
          `${API_BASE_URL}/api/students`,
          ["students", "data"],
          controller.signal,
        ),
        fetchCollection<ActivityLog>(
          `${API_BASE_URL}/api/activity-logs`,
          ["logs", "data"],
          controller.signal,
        ),
        fetchCollection<Announcement>(
          `${API_BASE_URL}/api/announcement-management`,
          ["announcements", "data"],
          controller.signal,
        ),
      ] as const;

      try {
        const [userResult, studentResult, activityResult, announcementResult] =
          await Promise.allSettled(requests);

        if (controller.signal.aborted) return;

        const results = [
          userResult,
          studentResult,
          activityResult,
          announcementResult,
        ];

        const sessionExpired = results.some(
          (result) =>
            result.status === "rejected" &&
            result.reason instanceof Error &&
            result.reason.message === "__ADMIN_SESSION_EXPIRED__",
        );

        if (sessionExpired) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        const errors: SourceErrors = {};

        if (userResult.status === "fulfilled") {
          setUsers(userResult.value);
        } else {
          setUsers([]);
          errors.users =
            userResult.reason instanceof Error
              ? userResult.reason.message
              : "Unable to load user accounts.";
        }

        if (studentResult.status === "fulfilled") {
          setStudents(studentResult.value);
        } else {
          setStudents([]);
          errors.students =
            studentResult.reason instanceof Error
              ? studentResult.reason.message
              : "Unable to load student records.";
        }

        if (activityResult.status === "fulfilled") {
          setActivityLogs(activityResult.value);
        } else {
          setActivityLogs([]);
          errors.activity =
            activityResult.reason instanceof Error
              ? activityResult.reason.message
              : "Unable to load activity logs.";
        }

        if (announcementResult.status === "fulfilled") {
          setAnnouncements(announcementResult.value);
        } else {
          setAnnouncements([]);
          errors.announcements =
            announcementResult.reason instanceof Error
              ? announcementResult.reason.message
              : "Unable to load announcements.";
        }

        setSourceErrors(errors);
        setLastUpdated(new Date());
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }

      return () => controller.abort();
    },
    [authenticated, userRole, navigate],
  );

  useEffect(() => {
    if (!authenticated || userRole !== "Admin") return;

    void loadDashboard(true);
  }, [authenticated, userRole, loadDashboard]);

  const activeUsers = useMemo(
    () => users.filter(isActiveUser).length,
    [users],
  );

  const inactiveUsers = Math.max(users.length - activeUsers, 0);

  const activeAnnouncements = useMemo(
    () => announcements.filter(isActiveAnnouncement).length,
    [announcements],
  );

  const roleCounts = useMemo(() => {
    const counts = new Map<string, number>();

    users.forEach((portalUser) => {
      const role = String(portalUser.role || "Unknown").trim() || "Unknown";
      counts.set(role, (counts.get(role) || 0) + 1);
    });

    return ROLE_ORDER.map((role) => ({
      role,
      count: counts.get(role) || 0,
    }));
  }, [users]);

  const recentActivity = useMemo(
    () =>
      [...activityLogs]
        .sort((a, b) => parseTime(b.created_at) - parseTime(a.created_at))
        .slice(0, 6),
    [activityLogs],
  );

  const recentAnnouncements = useMemo(
    () =>
      [...announcements]
        .sort(
          (a, b) =>
            Math.max(parseTime(b.created_at), parseTime(b.publish_date)) -
            Math.max(parseTime(a.created_at), parseTime(a.publish_date)),
        )
        .slice(0, 3),
    [announcements],
  );

  const connectedSources = 4 - Object.keys(sourceErrors).length;
  const hasSourceErrors = Object.keys(sourceErrors).length > 0;

  const metricValue = (source: DataSource, value: number) =>
    sourceErrors[source] ? "—" : value.toLocaleString();

  const quickActions = [
    {
      label: "User Accounts",
      description: "Review portal accounts and status.",
      route: "/admin/user/list",
      icon: UsersRound,
    },
    {
      label: "Create User",
      description: "Add a new authorized portal account.",
      route: "/admin/user/create",
      icon: UserPlus,
    },
    {
      label: "Student Records",
      description: "Open the administrative student directory.",
      route: "/admin/students/manage",
      icon: GraduationCap,
    },
    {
      label: "Student Management",
      description: "Add, edit, or manage student records.",
      route: "/admin/students/addeditdrop",
      icon: UserCog,
    },
    {
      label: "Activity Logs",
      description: "Review user and system activity.",
      route: "/admin/user/activity",
      icon: Activity,
    },
    {
      label: "User Roles",
      description: "Review role assignments and access structure.",
      route: "/admin/user/roles",
      icon: ShieldCheck,
    },
    {
      label: "Announcements",
      description: "Manage portal-wide communications.",
      route: "/admin/announcement/list",
      icon: Megaphone,
    },
    {
      label: "Create Announcement",
      description: "Publish a new portal announcement.",
      route: "/admin/announcement/create",
      icon: BellRing,
    },
  ];

  const dataSources: Array<{
    key: DataSource;
    label: string;
    endpoint: string;
  }> = [
    {
      key: "users",
      label: "Users & Roles",
      endpoint: "/api/users",
    },
    {
      key: "students",
      label: "Student Records",
      endpoint: "/api/students",
    },
    {
      key: "activity",
      label: "Activity Logs",
      endpoint: "/api/activity-logs",
    },
    {
      key: "announcements",
      label: "Announcements",
      endpoint: "/api/announcement-management",
    },
  ];

  if (!authenticated || !user || userRole !== "Admin") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="admin-dashboard">
        <section className="admin-dashboard__hero">
          <div className="admin-dashboard__hero-copy">
            <div className="admin-dashboard__eyebrow">
              <span className="admin-dashboard__eyebrow-icon">
                <ShieldCheck size={16} strokeWidth={2.2} />
              </span>
              Admin · System Operations
            </div>

            <h1>Admin Dashboard</h1>
            <p>
              Monitor portal accounts, student records, system activity, and
              communications from one administrative workspace.
            </p>
          </div>

          <div className="admin-dashboard__hero-actions">
            <div className="admin-dashboard__identity">
              <span className="admin-dashboard__identity-icon">
                <UserCheck size={17} strokeWidth={2.1} />
              </span>
              <span>
                <small>Signed in as</small>
                <strong>{user.username}</strong>
              </span>
            </div>

            <button
              type="button"
              className="admin-dashboard__refresh"
              onClick={() => void loadDashboard(false)}
              disabled={loading || refreshing}
            >
              <RefreshCw
                size={16}
                className={refreshing ? "is-spinning" : ""}
                aria-hidden="true"
              />
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </section>

        {hasSourceErrors && !loading && (
          <section className="admin-dashboard__warning" role="status">
            <CircleAlert size={18} aria-hidden="true" />
            <div>
              <strong>Some dashboard information is unavailable</strong>
              <p>
                {connectedSources} of 4 data sources loaded successfully. The
                available sections remain usable.
              </p>
            </div>
          </section>
        )}

        <section
          className="admin-dashboard__stats"
          aria-label="Administrative overview"
        >
          <button
            type="button"
            className="admin-dashboard__stat-card admin-dashboard__stat-card--primary"
            onClick={() => navigate("/admin/user/list")}
          >
            <span className="admin-dashboard__stat-icon">
              <UsersRound size={20} />
            </span>
            <span className="admin-dashboard__stat-copy">
              <small>Total Accounts</small>
              <strong>{loading ? "…" : metricValue("users", users.length)}</strong>
              <span>
                {sourceErrors.users
                  ? "Account data unavailable"
                  : `${activeUsers.toLocaleString()} active portal accounts`}
              </span>
            </span>
            <ChevronRight size={16} className="admin-dashboard__stat-arrow" />
          </button>

          <button
            type="button"
            className="admin-dashboard__stat-card"
            onClick={() => navigate("/admin/user/list")}
          >
            <span className="admin-dashboard__stat-icon">
              <UserCheck size={20} />
            </span>
            <span className="admin-dashboard__stat-copy">
              <small>Active Accounts</small>
              <strong>{loading ? "…" : metricValue("users", activeUsers)}</strong>
              <span>
                {sourceErrors.users
                  ? "Account status unavailable"
                  : `${inactiveUsers.toLocaleString()} inactive`}
              </span>
            </span>
            <ChevronRight size={16} className="admin-dashboard__stat-arrow" />
          </button>

          <button
            type="button"
            className="admin-dashboard__stat-card"
            onClick={() => navigate("/admin/students/manage")}
          >
            <span className="admin-dashboard__stat-icon">
              <GraduationCap size={20} />
            </span>
            <span className="admin-dashboard__stat-copy">
              <small>Student Records</small>
              <strong>
                {loading ? "…" : metricValue("students", students.length)}
              </strong>
              <span>
                {sourceErrors.students
                  ? "Student data unavailable"
                  : "Administrative student directory"}
              </span>
            </span>
            <ChevronRight size={16} className="admin-dashboard__stat-arrow" />
          </button>

          <button
            type="button"
            className="admin-dashboard__stat-card"
            onClick={() => navigate("/admin/announcement/list")}
          >
            <span className="admin-dashboard__stat-icon">
              <Megaphone size={20} />
            </span>
            <span className="admin-dashboard__stat-copy">
              <small>Active Announcements</small>
              <strong>
                {loading
                  ? "…"
                  : metricValue("announcements", activeAnnouncements)}
              </strong>
              <span>
                {sourceErrors.announcements
                  ? "Announcement data unavailable"
                  : `${announcements.length.toLocaleString()} total announcements`}
              </span>
            </span>
            <ChevronRight size={16} className="admin-dashboard__stat-arrow" />
          </button>
        </section>

        <section className="admin-dashboard__workspace-grid">
          <article className="admin-dashboard__panel admin-dashboard__activity-panel">
            <div className="admin-dashboard__panel-header">
              <div>
                <span className="admin-dashboard__panel-kicker">
                  System Activity
                </span>
                <h2>Recent Activity</h2>
                <p>Latest recorded actions across the PTC Portal.</p>
              </div>

              <button
                type="button"
                className="admin-dashboard__panel-link"
                onClick={() => navigate("/admin/user/activity")}
              >
                View all
                <ArrowRight size={14} />
              </button>
            </div>

            <div className="admin-dashboard__activity-list">
              {loading ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <div
                    className="admin-dashboard__activity-skeleton"
                    key={index}
                  >
                    <i />
                    <span>
                      <i />
                      <i />
                    </span>
                  </div>
                ))
              ) : sourceErrors.activity ? (
                <div className="admin-dashboard__empty">
                  <CircleAlert size={22} />
                  <strong>Activity logs could not be loaded</strong>
                  <p>{sourceErrors.activity}</p>
                </div>
              ) : recentActivity.length === 0 ? (
                <div className="admin-dashboard__empty">
                  <Activity size={22} />
                  <strong>No recent activity</strong>
                  <p>Recorded portal actions will appear here.</p>
                </div>
              ) : (
                recentActivity.map((log) => (
                  <div
                    className="admin-dashboard__activity-row"
                    key={log.activity_id}
                  >
                    <span className="admin-dashboard__activity-icon">
                      <Activity size={16} />
                    </span>

                    <div className="admin-dashboard__activity-copy">
                      <div className="admin-dashboard__activity-heading">
                        <strong>
                          {log.activity_type || "Portal activity"}
                        </strong>
                        <time>{formatDateTime(log.created_at)}</time>
                      </div>

                      <p>{truncate(log.description, 150)}</p>

                      <div className="admin-dashboard__activity-meta">
                        <span>{log.username || "System"}</span>
                        <span aria-hidden="true">•</span>
                        <span>{log.role || "Unknown role"}</span>
                        <span aria-hidden="true">•</span>
                        <span>{log.module_name || "General"}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>

          <aside className="admin-dashboard__panel admin-dashboard__accounts-panel">
            <div className="admin-dashboard__panel-header admin-dashboard__panel-header--compact">
              <div>
                <span className="admin-dashboard__panel-kicker">
                  Access Overview
                </span>
                <h2>User & Role Distribution</h2>
              </div>

              <button
                type="button"
                className="admin-dashboard__icon-link"
                aria-label="Open user roles"
                onClick={() => navigate("/admin/user/roles")}
              >
                <ChevronRight size={17} />
              </button>
            </div>

            {loading ? (
              <div className="admin-dashboard__role-skeleton">
                {Array.from({ length: 5 }).map((_, index) => (
                  <i key={index} />
                ))}
              </div>
            ) : sourceErrors.users ? (
              <div className="admin-dashboard__empty admin-dashboard__empty--compact">
                <CircleAlert size={21} />
                <strong>User overview unavailable</strong>
                <p>{sourceErrors.users}</p>
              </div>
            ) : (
              <>
                <div className="admin-dashboard__account-summary">
                  <div>
                    <span>Active</span>
                    <strong>{activeUsers.toLocaleString()}</strong>
                  </div>
                  <div>
                    <span>Inactive</span>
                    <strong>{inactiveUsers.toLocaleString()}</strong>
                  </div>
                </div>

                <div className="admin-dashboard__role-list">
                  {roleCounts.map(({ role, count }) => {
                    const percent =
                      users.length > 0
                        ? Math.round((count / users.length) * 100)
                        : 0;

                    return (
                      <div className="admin-dashboard__role-row" key={role}>
                        <div>
                          <span>{role}</span>
                          <strong>{count.toLocaleString()}</strong>
                        </div>
                        <div className="admin-dashboard__role-track">
                          <span style={{ width: `${percent}%` }} />
                        </div>
                        <small>{percent}%</small>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </aside>
        </section>

        <section className="admin-dashboard__panel admin-dashboard__quick-panel">
          <div className="admin-dashboard__panel-header">
            <div>
              <span className="admin-dashboard__panel-kicker">
                Administrative Tools
              </span>
              <h2>Quick Actions</h2>
              <p>Open the tools used most often for portal administration.</p>
            </div>
          </div>

          <div className="admin-dashboard__quick-grid">
            {quickActions.map((action) => {
              const Icon = action.icon;

              return (
                <button
                  key={action.route}
                  type="button"
                  className="admin-dashboard__quick-action"
                  onClick={() => navigate(action.route)}
                >
                  <span className="admin-dashboard__quick-icon">
                    <Icon size={18} />
                  </span>

                  <span className="admin-dashboard__quick-copy">
                    <strong>{action.label}</strong>
                    <small>{action.description}</small>
                  </span>

                  <ChevronRight size={15} />
                </button>
              );
            })}
          </div>
        </section>

        <section className="admin-dashboard__lower-grid">
          <article className="admin-dashboard__panel">
            <div className="admin-dashboard__panel-header">
              <div>
                <span className="admin-dashboard__panel-kicker">
                  Communications
                </span>
                <h2>Recent Announcements</h2>
                <p>Latest portal announcements available to the administrator.</p>
              </div>

              <button
                type="button"
                className="admin-dashboard__panel-link"
                onClick={() => navigate("/admin/announcement/list")}
              >
                Manage
                <ArrowRight size={14} />
              </button>
            </div>

            <div className="admin-dashboard__announcement-list">
              {loading ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <div
                    className="admin-dashboard__announcement-skeleton"
                    key={index}
                  >
                    <i />
                    <i />
                    <i />
                  </div>
                ))
              ) : sourceErrors.announcements ? (
                <div className="admin-dashboard__empty">
                  <CircleAlert size={22} />
                  <strong>Announcements could not be loaded</strong>
                  <p>{sourceErrors.announcements}</p>
                </div>
              ) : recentAnnouncements.length === 0 ? (
                <div className="admin-dashboard__empty">
                  <Megaphone size={22} />
                  <strong>No announcements yet</strong>
                  <p>Create an announcement when portal communication is needed.</p>
                </div>
              ) : (
                recentAnnouncements.map((announcement) => (
                  <button
                    type="button"
                    className="admin-dashboard__announcement-row"
                    key={announcement.announcement_id}
                    onClick={() =>
                      navigate(
                        `/admin/announcement/details/${announcement.announcement_id}`,
                      )
                    }
                  >
                    <span className="admin-dashboard__announcement-icon">
                      <Megaphone size={15} />
                    </span>

                    <span className="admin-dashboard__announcement-copy">
                      <span className="admin-dashboard__announcement-topline">
                        <strong>{announcement.title}</strong>
                        <span
                          className={`admin-dashboard__status ${
                            isActiveAnnouncement(announcement)
                              ? "admin-dashboard__status--active"
                              : "admin-dashboard__status--inactive"
                          }`}
                        >
                          <i />
                          {isActiveAnnouncement(announcement)
                            ? "Active"
                            : "Inactive"}
                        </span>
                      </span>

                      <small>{truncate(announcement.content, 115)}</small>

                      <span className="admin-dashboard__announcement-meta">
                        {formatDate(announcement.publish_date)} ·{" "}
                        {announcement.created_by || "Unknown creator"}
                      </span>
                    </span>

                    <ChevronRight size={15} />
                  </button>
                ))
              )}
            </div>
          </article>

          <aside className="admin-dashboard__panel">
            <div className="admin-dashboard__panel-header admin-dashboard__panel-header--compact">
              <div>
                <span className="admin-dashboard__panel-kicker">
                  Dashboard Sources
                </span>
                <h2>System Data Status</h2>
                <p>
                  Availability of the existing services used by this dashboard.
                </p>
              </div>

              <span
                className={`admin-dashboard__source-count ${
                  connectedSources === 4
                    ? "admin-dashboard__source-count--healthy"
                    : ""
                }`}
              >
                {loading ? "Checking" : `${connectedSources}/4 online`}
              </span>
            </div>

            <div className="admin-dashboard__source-list">
              {dataSources.map((source) => {
                const unavailable = Boolean(sourceErrors[source.key]);

                return (
                  <div className="admin-dashboard__source-row" key={source.key}>
                    <span
                      className={`admin-dashboard__source-icon ${
                        unavailable ? "is-error" : ""
                      }`}
                    >
                      {unavailable ? (
                        <CircleAlert size={15} />
                      ) : (
                        <Database size={15} />
                      )}
                    </span>

                    <span className="admin-dashboard__source-copy">
                      <strong>{source.label}</strong>
                      <small>{source.endpoint}</small>
                    </span>

                    <span
                      className={`admin-dashboard__source-state ${
                        unavailable ? "is-error" : ""
                      }`}
                    >
                      {loading
                        ? "Checking"
                        : unavailable
                          ? "Unavailable"
                          : "Connected"}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="admin-dashboard__update-note">
              <CheckCircle2 size={15} />
              <span>
                {lastUpdated
                  ? `Last updated ${lastUpdated.toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}`
                  : "Dashboard data has not been refreshed yet."}
              </span>
            </div>
          </aside>
        </section>
      </main>
    </DashboardLayout>
  );
}
