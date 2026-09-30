import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpenCheck,
  CircleAlert,
  GraduationCap,
  LoaderCircle,
  RefreshCw,
  School,
  ShieldCheck,
  UserCog,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import "../../../styles/AdminUserRoles.css";

const USERS_API_URL = apiUrl("/api/users");

type RoleName = "Admin" | "Registrar" | "Program Head" | "Faculty" | "Student";

type UserRecord = {
  user_id: number;
  username: string;
  email: string;
  role: string;
  is_active: boolean;
};

interface UserListResponse {
  success?: boolean;
  data?: UserRecord[];
  users?: UserRecord[];
  message?: string;
  error?: string;
}

type RoleDefinition = {
  id: number;
  name: RoleName;
  description: string;
  permissions: string[];
  icon: typeof ShieldCheck;
};

const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    id: 1,
    name: "Admin",
    description:
      "Full access to system settings, users, reports, and configurations.",
    permissions: [
      "Manage Users",
      "Manage Roles",
      "View Reports",
      "System Settings",
    ],
    icon: ShieldCheck,
  },
  {
    id: 2,
    name: "Registrar",
    description:
      "Handles student records, enrollment, admission, and academic information.",
    permissions: [
      "Manage Student Records",
      "Enrollment Processing",
      "Generate Reports",
    ],
    icon: BookOpenCheck,
  },
  {
    id: 3,
    name: "Program Head",
    description:
      "Supervises programs, faculty assignments, and academic reports.",
    permissions: ["Approve Grades", "Manage Faculty", "View Program Reports"],
    icon: School,
  },
  {
    id: 4,
    name: "Faculty",
    description: "Manages classes, grades, schedules, and student performance.",
    permissions: ["View Students", "Submit Grades", "Manage Classes"],
    icon: GraduationCap,
  },
  {
    id: 5,
    name: "Student",
    description: "Accesses academic records, enrollment, and student services.",
    permissions: ["View Grades", "View Schedule", "Submit Requests"],
    icon: UserRoundCheck,
  },
];

function normalizeRoleName(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export default function UserRoles() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();
  const userRole = session?.role;
  const authenticated = Boolean(session && token);

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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

  const loadUsers = useCallback(
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

        const response = await authService.authFetch(USERS_API_URL, {
          method: "GET",
          signal,
          headers: {
            Accept: "application/json",
          },
        });

        const contentType = response.headers.get("content-type") || "";
        let data: UserRecord[] | UserListResponse | null = null;

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
              "You are not authorized to view user role information.",
          );
        }

        if (!response.ok) {
          const responseObject = !Array.isArray(data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              `Unable to load user accounts (${response.status}).`,
          );
        }

        let loadedUsers: UserRecord[] = [];

        if (Array.isArray(data)) {
          loadedUsers = data;
        } else if (data && Array.isArray(data.users)) {
          loadedUsers = data.users;
        } else if (data && Array.isArray(data.data)) {
          loadedUsers = data.data;
        }

        setUsers(loadedUsers);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD USER ROLE COUNTS ERROR:", requestError);
        setUsers([]);

        if (requestError instanceof TypeError) {
          setError(
            "Unable to connect to the user server. Role information is still available, but account counts could not be loaded.",
          );
          return;
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load user account counts.",
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
    void loadUsers(false, controller.signal);

    return () => controller.abort();
  }, [authenticated, userRole, loadUsers]);

  const roleCounts = useMemo(() => {
    const counts = new Map<string, number>();

    users.forEach((user) => {
      const key = normalizeRoleName(user.role);
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    return counts;
  }, [users]);

  const activeUsers = useMemo(
    () => users.filter((user) => Boolean(user.is_active)).length,
    [users],
  );

  const representedRoles = useMemo(
    () =>
      new Set(users.map((user) => normalizeRoleName(user.role)).filter(Boolean))
        .size,
    [users],
  );

  if (!authenticated || !session || userRole !== "Admin") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="admin-user-roles">
        <section className="admin-user-roles__hero">
          <div className="admin-user-roles__hero-copy">
            <div className="admin-user-roles__eyebrow">
              <span>
                <ShieldCheck size={16} aria-hidden="true" />
              </span>
              Admin · User Management
            </div>

            <h1>User Roles</h1>

            <p>
              Review the portal&apos;s role structure, account distribution, and
              the access responsibilities associated with each user type.
            </p>
          </div>

          <button
            type="button"
            className="admin-user-roles__refresh"
            onClick={() => void loadUsers(true)}
            disabled={loading || refreshing}
          >
            <RefreshCw
              size={16}
              className={refreshing ? "admin-user-roles__spinner" : ""}
              aria-hidden="true"
            />
            {refreshing ? "Refreshing..." : "Refresh Counts"}
          </button>
        </section>

        <section
          className="admin-user-roles__summary"
          aria-label="User roles overview"
        >
          <article>
            <span className="admin-user-roles__summary-icon">
              <ShieldCheck size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Portal Roles</small>
              <strong>{ROLE_DEFINITIONS.length}</strong>
            </div>
          </article>

          <article>
            <span className="admin-user-roles__summary-icon">
              <UsersRound size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Total Accounts</small>
              <strong>
                {loading || error ? "—" : users.length.toLocaleString()}
              </strong>
            </div>
          </article>

          <article>
            <span className="admin-user-roles__summary-icon">
              <UserRoundCheck size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Active Accounts</small>
              <strong>
                {loading || error ? "—" : activeUsers.toLocaleString()}
              </strong>
            </div>
          </article>

          <article>
            <span className="admin-user-roles__summary-icon">
              <UserCog size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Roles Represented</small>
              <strong>{loading || error ? "—" : representedRoles}</strong>
            </div>
          </article>
        </section>

        {error && (
          <div className="admin-user-roles__warning" role="status">
            <CircleAlert size={18} aria-hidden="true" />
            <div>
              <strong>Account counts are unavailable</strong>
              <span>{error}</span>
            </div>
          </div>
        )}

        <section className="admin-user-roles__workspace">
          <header className="admin-user-roles__workspace-header">
            <div>
              <span className="admin-user-roles__section-kicker">
                Access Structure
              </span>
              <h2>Portal Role Directory</h2>
              <p>
                Permissions shown below preserve the role descriptions already
                defined by the portal.
              </p>
            </div>

            {loading && (
              <div className="admin-user-roles__loading">
                <LoaderCircle
                  size={16}
                  className="admin-user-roles__spinner"
                  aria-hidden="true"
                />
                Loading account counts...
              </div>
            )}
          </header>

          <div className="admin-user-roles__grid">
            {ROLE_DEFINITIONS.map((role) => {
              const RoleIcon = role.icon;
              const count = roleCounts.get(normalizeRoleName(role.name)) || 0;

              return (
                <article className="admin-user-roles__card" key={role.id}>
                  <div className="admin-user-roles__card-header">
                    <span className="admin-user-roles__role-icon">
                      <RoleIcon size={19} aria-hidden="true" />
                    </span>

                    <div className="admin-user-roles__role-title">
                      <small>Role {role.id}</small>
                      <h3>{role.name}</h3>
                    </div>

                    <span className="admin-user-roles__count">
                      {loading || error
                        ? "Count unavailable"
                        : `${count.toLocaleString()} ${
                            count === 1 ? "account" : "accounts"
                          }`}
                    </span>
                  </div>

                  <p className="admin-user-roles__description">
                    {role.description}
                  </p>

                  <div className="admin-user-roles__permissions">
                    <div className="admin-user-roles__permissions-heading">
                      <ShieldCheck size={15} aria-hidden="true" />
                      <span>Permissions</span>
                    </div>

                    <ul>
                      {role.permissions.map((permission) => (
                        <li key={permission}>
                          <span aria-hidden="true" />
                          {permission}
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </DashboardLayout>
  );
}
