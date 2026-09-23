import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CircleAlert,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
  ShieldCheck,
  UserCheck,
  UsersRound,
  UserX,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import "../../../styles/AdminUserList.css";

const API_BASE_URL = apiUrl("/api/users");

type User = {
  user_id: number;
  username: string;
  email: string;
  role: string;
  is_active: boolean;
};

interface UserListResponse {
  success?: boolean;
  data?: User[];
  users?: User[];
  message?: string;
  error?: string;
}

interface MutationResponse {
  success?: boolean;
  message?: string;
  error?: string;
}

function normalizeRoleClass(role: string) {
  return String(role || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

export default function UserList() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();
  const userRole = session?.role;
  const authenticated = Boolean(session && token);

  const [users, setUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionUserId, setActionUserId] = useState<number | null>(null);

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

  useEffect(() => {
    if (!authenticated || userRole !== "Admin") {
      return;
    }

    const controller = new AbortController();

    const loadUsers = async () => {
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

        const contentType = response.headers.get("content-type") || "";
        let data: User[] | UserListResponse | null = null;

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
              "You are not authorized to manage users.",
          );
        }

        if (!response.ok) {
          const responseObject = !Array.isArray(data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              `Failed to load users (${response.status}).`,
          );
        }

        let loadedUsers: User[] = [];

        if (Array.isArray(data)) {
          loadedUsers = data;
        } else if (data && Array.isArray(data.users)) {
          loadedUsers = data.users;
        } else if (data && Array.isArray(data.data)) {
          loadedUsers = data.data;
        }

        setUsers(loadedUsers);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        console.error("LOAD USERS ERROR:", err);
        setUsers([]);

        if (err instanceof TypeError) {
          setError(
            "Unable to connect to the user server. Make sure the backend is running on port 3000.",
          );
          return;
        }

        setError(err instanceof Error ? err.message : "Failed to load users.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadUsers();

    return () => {
      controller.abort();
    };
  }, [authenticated, userRole, navigate]);

  const resetPassword = async (userId: number, username: string) => {
    if (!authenticated || userRole !== "Admin") {
      setError(
        "Your session has expired or you are not authorized to reset passwords.",
      );
      return;
    }

    if (!Number.isInteger(userId) || userId <= 0) {
      setError("Invalid user ID.");
      return;
    }

    const newPassword = window.prompt(`Enter new password for ${username}:`);

    if (!newPassword) {
      return;
    }

    const cleanPassword = newPassword.trim();

    if (cleanPassword.length < 8) {
      window.alert("Password must be at least 8 characters.");
      return;
    }

    try {
      setActionUserId(userId);
      setError("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${userId}/reset-password`,
        {
          method: "PATCH",
          body: JSON.stringify({
            password: cleanPassword,
          }),
        },
      );

      const contentType = response.headers.get("content-type") || "";
      let data: MutationResponse | null = null;

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
        throw new Error(
          data?.message ||
            data?.error ||
            "You are not authorized to reset passwords.",
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to reset password (${response.status}).`,
        );
      }

      window.alert(data?.message || "Password reset successfully.");
    } catch (err) {
      console.error("RESET PASSWORD ERROR:", err);

      const message =
        err instanceof Error ? err.message : "Password reset failed.";

      setError(message);
      window.alert(message);
    } finally {
      setActionUserId(null);
    }
  };

  const toggleUserStatus = async (userId: number, currentStatus: boolean) => {
    if (!authenticated || userRole !== "Admin") {
      setError(
        "Your session has expired or you are not authorized to update users.",
      );
      return;
    }

    if (!Number.isInteger(userId) || userId <= 0) {
      setError("Invalid user ID.");
      return;
    }

    const action = currentStatus ? "Deactivate" : "Activate";
    const confirmAction = window.confirm(`${action} this user account?`);

    if (!confirmAction) {
      return;
    }

    try {
      setActionUserId(userId);
      setError("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${userId}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({
            is_active: !currentStatus,
          }),
        },
      );

      const contentType = response.headers.get("content-type") || "";
      let data: MutationResponse | null = null;

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
        throw new Error(
          data?.message ||
            data?.error ||
            "You are not authorized to update user status.",
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to update user status (${response.status}).`,
        );
      }

      setUsers((previous) =>
        previous.map((currentUser) =>
          currentUser.user_id === userId
            ? {
                ...currentUser,
                is_active: !currentStatus,
              }
            : currentUser,
        ),
      );
    } catch (err) {
      console.error("UPDATE USER STATUS ERROR:", err);

      const message =
        err instanceof Error ? err.message : "Failed to update user status.";

      setError(message);
      window.alert(message);
    } finally {
      setActionUserId(null);
    }
  };

  const summary = useMemo(() => {
    const active = users.filter((currentUser) =>
      Boolean(currentUser.is_active),
    ).length;
    const inactive = users.length - active;
    const roles = new Set(
      users
        .map((currentUser) => currentUser.role?.trim())
        .filter((role): role is string => Boolean(role)),
    ).size;

    return {
      active,
      inactive,
      roles,
    };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    if (!query) {
      return users;
    }

    return users.filter((currentUser) => {
      const values = [
        currentUser.user_id,
        currentUser.username,
        currentUser.email,
        currentUser.role,
        currentUser.is_active ? "active" : "inactive",
      ];

      return values.some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(query),
      );
    });
  }, [users, searchTerm]);

  if (!authenticated || !session || userRole !== "Admin") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="admin-user-directory">
        <section className="admin-user-directory__hero">
          <div className="admin-user-directory__hero-copy">
            <div className="admin-user-directory__eyebrow">
              <span>
                <ShieldCheck size={16} aria-hidden="true" />
              </span>
              Admin · User Management
            </div>

            <h1>User Management</h1>

            <p>
              Review portal accounts, manage access status, edit account
              information, and reset user passwords.
            </p>
          </div>

          <button
            type="button"
            className="admin-user-directory__create"
            onClick={() => navigate("/admin/user/create")}
          >
            <Plus size={17} aria-hidden="true" />
            Create User
          </button>
        </section>

        <section
          className="admin-user-directory__summary"
          aria-label="User account overview"
        >
          <article>
            <span className="admin-user-directory__summary-icon">
              <UsersRound size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Total Accounts</small>
              <strong>{loading ? "…" : users.length.toLocaleString()}</strong>
            </div>
          </article>

          <article>
            <span className="admin-user-directory__summary-icon">
              <UserCheck size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Active Accounts</small>
              <strong>{loading ? "…" : summary.active.toLocaleString()}</strong>
            </div>
          </article>

          <article>
            <span className="admin-user-directory__summary-icon">
              <UserX size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Inactive Accounts</small>
              <strong>
                {loading ? "…" : summary.inactive.toLocaleString()}
              </strong>
            </div>
          </article>

          <article>
            <span className="admin-user-directory__summary-icon">
              <ShieldCheck size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Roles Represented</small>
              <strong>{loading ? "…" : summary.roles}</strong>
            </div>
          </article>
        </section>

        {error && (
          <div className="admin-user-directory__error" role="status">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <section className="admin-user-directory__workspace">
          <header className="admin-user-directory__workspace-header">
            <div>
              <span className="admin-user-directory__section-kicker">
                Portal Accounts
              </span>
              <h2>User List</h2>
              <p>
                {loading
                  ? "Loading user accounts…"
                  : `${filteredUsers.length.toLocaleString()} account${
                      filteredUsers.length === 1 ? "" : "s"
                    } shown`}
              </p>
            </div>

            <label className="admin-user-directory__search">
              <Search size={16} aria-hidden="true" />

              <input
                type="text"
                placeholder="Search username, email, role, or status"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                aria-label="Search users"
              />

              {searchTerm && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearchTerm("")}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </label>
          </header>

          <div className="admin-user-directory__table-wrap">
            <table className="admin-user-directory__table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>User</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="admin-user-directory__table-state">
                        <LoaderCircle
                          size={22}
                          className="admin-user-directory__spinner"
                          aria-hidden="true"
                        />
                        <span>Loading users...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="admin-user-directory__table-state">
                        <UsersRound size={22} aria-hidden="true" />
                        <span>No users found.</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((currentUser) => {
                    const actionLoading = actionUserId === currentUser.user_id;
                    const roleClass = normalizeRoleClass(currentUser.role);
                    const initial =
                      currentUser.username?.trim().charAt(0).toUpperCase() ||
                      "U";

                    return (
                      <tr key={currentUser.user_id}>
                        <td>
                          <span className="admin-user-directory__user-id">
                            {currentUser.user_id}
                          </span>
                        </td>

                        <td>
                          <div className="admin-user-directory__user-cell">
                            <span className="admin-user-directory__avatar">
                              {initial}
                            </span>

                            <div>
                              <strong>{currentUser.username}</strong>
                              <small>Portal account</small>
                            </div>
                          </div>
                        </td>

                        <td>{currentUser.email}</td>

                        <td>
                          <span
                            className={`admin-user-directory__role admin-user-directory__role--${roleClass}`}
                          >
                            {currentUser.role}
                          </span>
                        </td>

                        <td>
                          <span
                            className={
                              currentUser.is_active
                                ? "admin-user-directory__status admin-user-directory__status--active"
                                : "admin-user-directory__status admin-user-directory__status--inactive"
                            }
                          >
                            {currentUser.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>

                        <td>
                          <div className="admin-user-directory__actions">
                            <button
                              type="button"
                              className="admin-user-directory__action admin-user-directory__action--edit"
                              onClick={() =>
                                navigate(
                                  `/admin/user/edit/${currentUser.user_id}`,
                                )
                              }
                              disabled={actionLoading}
                            >
                              <Pencil size={14} aria-hidden="true" />
                              Edit
                            </button>

                            <button
                              type="button"
                              className="admin-user-directory__action admin-user-directory__action--reset"
                              onClick={() =>
                                void resetPassword(
                                  currentUser.user_id,
                                  currentUser.username,
                                )
                              }
                              disabled={actionLoading}
                            >
                              {actionLoading ? (
                                <LoaderCircle
                                  size={14}
                                  className="admin-user-directory__spinner"
                                  aria-hidden="true"
                                />
                              ) : (
                                <KeyRound size={14} aria-hidden="true" />
                              )}
                              {actionLoading
                                ? "Processing..."
                                : "Reset Password"}
                            </button>

                            <button
                              type="button"
                              className={
                                currentUser.is_active
                                  ? "admin-user-directory__action admin-user-directory__action--deactivate"
                                  : "admin-user-directory__action admin-user-directory__action--activate"
                              }
                              onClick={() =>
                                void toggleUserStatus(
                                  currentUser.user_id,
                                  currentUser.is_active,
                                )
                              }
                              disabled={actionLoading}
                            >
                              {actionLoading ? (
                                <LoaderCircle
                                  size={14}
                                  className="admin-user-directory__spinner"
                                  aria-hidden="true"
                                />
                              ) : currentUser.is_active ? (
                                <PowerOff size={14} aria-hidden="true" />
                              ) : (
                                <Power size={14} aria-hidden="true" />
                              )}

                              {actionLoading
                                ? "Processing..."
                                : currentUser.is_active
                                  ? "Deactivate"
                                  : "Activate"}
                            </button>
                          </div>
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
