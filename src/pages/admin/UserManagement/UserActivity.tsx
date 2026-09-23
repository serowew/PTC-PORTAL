import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  CircleAlert,
  Clock3,
  Filter,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import "../../../styles/AdminUserActivity.css";

const API_BASE_URL = apiUrl("/api/activity-logs");

type ActivityLog = {
  activity_id: number;
  user_id: number;
  username: string;
  role: string;
  activity_type: string;
  module_name: string;
  description: string;
  created_at: string;
};

interface ActivityLogResponse {
  success?: boolean;
  data?: ActivityLog[];
  logs?: ActivityLog[];
  message?: string;
  error?: string;
}

function normalizeBadgeClass(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatActivityTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return {
      date: "Unknown date",
      time: "",
    };
  }

  return {
    date: date.toLocaleDateString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    time: date.toLocaleTimeString("en-PH", {
      hour: "numeric",
      minute: "2-digit",
    }),
  };
}

export default function UserActivity() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();
  const userRole = session?.role;
  const authenticated = Boolean(session && token);

  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [activityFilter, setActivityFilter] = useState("All");
  const [error, setError] = useState("");

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

  const loadLogs = useCallback(
    async (isRefresh = false, signal?: AbortSignal) => {
      if (!authenticated || userRole !== "Admin") {
        return;
      }

      try {
        if (isRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError("");

        const response = await authService.authFetch(API_BASE_URL, {
          method: "GET",
          signal,
          headers: {
            Accept: "application/json",
          },
        });

        const contentType = response.headers.get("content-type") || "";
        let data: ActivityLog[] | ActivityLogResponse | null = null;

        if (contentType.includes("application/json")) {
          data = await response.json();
        } else {
          const text = await response.text();

          throw new Error(
            `Server returned a non-JSON response (${response.status}): ${text.slice(
              0,
              200,
            )}`,
          );
        }

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (response.status === 403) {
          const responseObject = !Array.isArray(data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              "You are not authorized to view activity logs.",
          );
        }

        if (!response.ok) {
          const responseObject = !Array.isArray(data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              `Unable to load activity logs (${response.status}).`,
          );
        }

        let loadedLogs: ActivityLog[] = [];

        if (Array.isArray(data)) {
          loadedLogs = data;
        } else if (data && Array.isArray(data.logs)) {
          loadedLogs = data.logs;
        } else if (data && Array.isArray(data.data)) {
          loadedLogs = data.data;
        }

        setLogs(loadedLogs);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        console.error("LOAD ACTIVITY LOGS ERROR:", err);
        setLogs([]);

        if (err instanceof TypeError) {
          setError(
            "Unable to connect to the activity log server. Make sure the backend is running on port 3000.",
          );
          return;
        }

        setError(
          err instanceof Error ? err.message : "Unable to load activity logs.",
        );
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [authenticated, userRole, navigate],
  );

  useEffect(() => {
    if (!authenticated || userRole !== "Admin") {
      return;
    }

    const controller = new AbortController();
    void loadLogs(false, controller.signal);

    return () => controller.abort();
  }, [authenticated, userRole, loadLogs]);

  const roles = useMemo(
    () =>
      Array.from(
        new Set(
          logs.map((log) => String(log.role || "").trim()).filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [logs],
  );

  const activityTypes = useMemo(
    () =>
      Array.from(
        new Set(
          logs
            .map((log) => String(log.activity_type || "").trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [logs],
  );

  const filteredLogs = useMemo(() => {
    const query = search.trim().toLowerCase();

    return logs.filter((log) => {
      const matchesSearch =
        !query ||
        [
          log.username,
          log.role,
          log.activity_type,
          log.module_name,
          log.description,
        ].some((value) =>
          String(value ?? "")
            .toLowerCase()
            .includes(query),
        );

      const matchesRole = roleFilter === "All" || log.role === roleFilter;
      const matchesActivity =
        activityFilter === "All" || log.activity_type === activityFilter;

      return matchesSearch && matchesRole && matchesActivity;
    });
  }, [logs, search, roleFilter, activityFilter]);

  const uniqueUsers = useMemo(
    () => new Set(logs.map((log) => log.user_id)).size,
    [logs],
  );

  const modules = useMemo(
    () =>
      new Set(
        logs.map((log) => String(log.module_name || "").trim()).filter(Boolean),
      ).size,
    [logs],
  );

  const latestActivity = useMemo(() => {
    if (logs.length === 0) {
      return null;
    }

    const latest = [...logs].sort((a, b) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();

      if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
      if (Number.isNaN(aTime)) return 1;
      if (Number.isNaN(bTime)) return -1;

      return bTime - aTime;
    })[0];

    return formatActivityTime(latest.created_at);
  }, [logs]);

  const hasActiveFilters =
    Boolean(search.trim()) || roleFilter !== "All" || activityFilter !== "All";

  const clearFilters = () => {
    setSearch("");
    setRoleFilter("All");
    setActivityFilter("All");
  };

  if (!authenticated || !session || userRole !== "Admin") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="admin-user-activity">
        <section className="admin-user-activity__hero">
          <div className="admin-user-activity__hero-copy">
            <div className="admin-user-activity__eyebrow">
              <span>
                <Activity size={16} aria-hidden="true" />
              </span>
              Admin · User Management
            </div>

            <h1>User Activity</h1>

            <p>
              Review account actions and system activity recorded across the PTC
              Portal.
            </p>
          </div>

          <button
            type="button"
            className="admin-user-activity__refresh"
            onClick={() => void loadLogs(true)}
            disabled={loading || refreshing}
          >
            <RefreshCw
              size={16}
              className={refreshing ? "admin-user-activity__spinner" : ""}
              aria-hidden="true"
            />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </section>

        <section
          className="admin-user-activity__summary"
          aria-label="Activity log overview"
        >
          <article>
            <span className="admin-user-activity__summary-icon">
              <Activity size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Loaded Logs</small>
              <strong>{loading ? "…" : logs.length.toLocaleString()}</strong>
            </div>
          </article>

          <article>
            <span className="admin-user-activity__summary-icon">
              <UsersRound size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Users in Activity</small>
              <strong>{loading ? "…" : uniqueUsers.toLocaleString()}</strong>
            </div>
          </article>

          <article>
            <span className="admin-user-activity__summary-icon">
              <ShieldCheck size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Modules Recorded</small>
              <strong>{loading ? "…" : modules.toLocaleString()}</strong>
            </div>
          </article>

          <article>
            <span className="admin-user-activity__summary-icon">
              <Clock3 size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Latest Record</small>
              <strong className="admin-user-activity__latest">
                {loading
                  ? "…"
                  : latestActivity
                    ? `${latestActivity.date} · ${latestActivity.time}`
                    : "No activity yet"}
              </strong>
            </div>
          </article>
        </section>

        {error && (
          <div className="admin-user-activity__error" role="status">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <section className="admin-user-activity__workspace">
          <header className="admin-user-activity__workspace-header">
            <div>
              <span className="admin-user-activity__section-kicker">
                Audit Trail
              </span>
              <h2>Activity Logs</h2>
              <p>
                {loading
                  ? "Loading activity records…"
                  : `${filteredLogs.length.toLocaleString()} of ${logs.length.toLocaleString()} loaded record${
                      logs.length === 1 ? "" : "s"
                    } shown`}
              </p>
            </div>

            <div className="admin-user-activity__filters">
              <label className="admin-user-activity__search">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Search activity logs"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="Search activity logs"
                />

                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    aria-label="Clear search"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </label>

              <label className="admin-user-activity__select">
                <Filter size={15} aria-hidden="true" />
                <select
                  value={roleFilter}
                  onChange={(event) => setRoleFilter(event.target.value)}
                  aria-label="Filter by role"
                >
                  <option value="All">All roles</option>
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>

              <label className="admin-user-activity__select">
                <Activity size={15} aria-hidden="true" />
                <select
                  value={activityFilter}
                  onChange={(event) => setActivityFilter(event.target.value)}
                  aria-label="Filter by activity"
                >
                  <option value="All">All activities</option>
                  {activityTypes.map((activityType) => (
                    <option key={activityType} value={activityType}>
                      {activityType}
                    </option>
                  ))}
                </select>
              </label>

              {hasActiveFilters && (
                <button
                  type="button"
                  className="admin-user-activity__clear"
                  onClick={clearFilters}
                >
                  Clear
                </button>
              )}
            </div>
          </header>

          <div className="admin-user-activity__table-wrap">
            <table className="admin-user-activity__table">
              <thead>
                <tr>
                  <th>Date &amp; Time</th>
                  <th>User</th>
                  <th>Role</th>
                  <th>Activity</th>
                  <th>Module</th>
                  <th>Description</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="admin-user-activity__table-state">
                        <LoaderCircle
                          size={22}
                          className="admin-user-activity__spinner"
                          aria-hidden="true"
                        />
                        <span>Loading activity logs...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="admin-user-activity__table-state">
                        <Activity size={22} aria-hidden="true" />
                        <strong>No activity found</strong>
                        <span>
                          {hasActiveFilters
                            ? "Try changing or clearing your filters."
                            : "Activity records will appear here when available."}
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => {
                    const timestamp = formatActivityTime(log.created_at);
                    const initial =
                      String(log.username || "U")
                        .trim()
                        .charAt(0)
                        .toUpperCase() || "U";
                    const roleClass = normalizeBadgeClass(
                      log.role || "unknown",
                    );
                    const activityClass = normalizeBadgeClass(
                      log.activity_type || "activity",
                    );

                    return (
                      <tr key={log.activity_id}>
                        <td>
                          <div className="admin-user-activity__date">
                            <strong>{timestamp.date}</strong>
                            <span>{timestamp.time || "—"}</span>
                          </div>
                        </td>

                        <td>
                          <div className="admin-user-activity__user">
                            <span className="admin-user-activity__avatar">
                              {initial}
                            </span>
                            <div>
                              <strong>{log.username || "Unknown user"}</strong>
                              <small>User ID {log.user_id}</small>
                            </div>
                          </div>
                        </td>

                        <td>
                          <span
                            className={`admin-user-activity__role admin-user-activity__role--${roleClass}`}
                          >
                            {log.role || "Unknown"}
                          </span>
                        </td>

                        <td>
                          <span
                            className={`admin-user-activity__badge admin-user-activity__badge--${activityClass}`}
                          >
                            {log.activity_type || "Activity"}
                          </span>
                        </td>

                        <td>
                          <span className="admin-user-activity__module">
                            {log.module_name || "—"}
                          </span>
                        </td>

                        <td className="admin-user-activity__description">
                          {log.description || "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </DashboardLayout>
  );
}
