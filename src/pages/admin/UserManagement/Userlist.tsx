import { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";

import { authService } from "../../../services/auth.service";

import "../../../styles/userlist.css";

// =====================================================
// API
// =====================================================

const API_BASE_URL = "http://localhost:3000/api/users";

// =====================================================
// TYPES
// =====================================================

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

// =====================================================
// COMPONENT
// =====================================================

export default function UserList() {
  const navigate = useNavigate();

  // =====================================================
  // AUTHENTICATION
  // =====================================================

  const session = authService.getSession();

  const token = authService.getToken();

  const userRole = session?.role;

  const authenticated = Boolean(session && token);

  // =====================================================
  // STATE
  // =====================================================

  const [users, setUsers] = useState<User[]>([]);

  const [searchTerm, setSearchTerm] = useState("");

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  const [actionUserId, setActionUserId] = useState<number | null>(null);

  // =====================================================
  // AUTHORIZATION
  // =====================================================

  useEffect(() => {
    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    if (userRole !== "Admin") {
      if (userRole) {
        navigate(authService.getDashboardRoute(userRole), {
          replace: true,
        });
      } else {
        navigate("/login", {
          replace: true,
        });
      }
    }
  }, [authenticated, userRole, navigate]);

  // =====================================================
  // LOAD USERS
  // =====================================================

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

        // ===============================================
        // 401
        // ===============================================

        if (response.status === 401) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

          return;
        }

        // ===============================================
        // 403
        // ===============================================

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

        // ===============================================
        // NORMALIZE
        // ===============================================

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

  // =====================================================
  // RESET PASSWORD
  // =====================================================

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

      // ===============================================
      // JWT AUTHENTICATED PASSWORD RESET
      // ===============================================

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

        navigate("/login", {
          replace: true,
        });

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

  // =====================================================
  // ACTIVATE / DEACTIVATE USER
  // =====================================================

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

      // ===============================================
      // JWT AUTHENTICATED STATUS UPDATE
      // ===============================================

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

        navigate("/login", {
          replace: true,
        });

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

  // =====================================================
  // FILTER USERS
  // =====================================================

  const filteredUsers = users.filter((currentUser) => {
    const query = searchTerm.trim().toLowerCase();

    if (!query) {
      return true;
    }

    return (
      String(currentUser.username || "")
        .toLowerCase()
        .includes(query) ||
      String(currentUser.email || "")
        .toLowerCase()
        .includes(query) ||
      String(currentUser.role || "")
        .toLowerCase()
        .includes(query)
    );
  });

  // =====================================================
  // AUTH GUARD
  // =====================================================

  if (!authenticated || !session || userRole !== "Admin") {
    return null;
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <DashboardLayout>
      <div className="admin-user-list">
        {/* =================================================
            HEADER
        ================================================= */}

        <div className="admin-user-list__header">
          <h1>User Management</h1>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate("/admin/user/create")}
          >
            + Create User
          </button>
        </div>

        {/* =================================================
            ERROR
        ================================================= */}

        {error && <p className="admin-manage-students__error">{error}</p>}

        {/* =================================================
            SEARCH
        ================================================= */}

        <input
          type="text"
          className="admin-user-list__search"
          placeholder="Search username, email or role..."
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
        />

        {/* =================================================
            TABLE
        ================================================= */}

        <table className="admin-user-list__table">
          <thead>
            <tr>
              <th>ID</th>

              <th>Username</th>

              <th>Email</th>

              <th>Role</th>

              <th>Status</th>

              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    textAlign: "center",
                  }}
                >
                  Loading users...
                </td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    textAlign: "center",
                  }}
                >
                  No users found.
                </td>
              </tr>
            ) : (
              filteredUsers.map((currentUser) => {
                const actionLoading = actionUserId === currentUser.user_id;

                return (
                  <tr key={currentUser.user_id}>
                    <td>{currentUser.user_id}</td>

                    <td>{currentUser.username}</td>

                    <td>{currentUser.email}</td>

                    <td>
                      <span
                        className={`role-badge role-${String(
                          currentUser.role || "",
                        )
                          .toLowerCase()
                          .replace(/\s+/g, "-")}`}
                      >
                        {currentUser.role}
                      </span>
                    </td>

                    <td>
                      {currentUser.is_active ? (
                        <span className="status-active">Active</span>
                      ) : (
                        <span className="status-inactive">Inactive</span>
                      )}
                    </td>

                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() =>
                          navigate(`/admin/user/edit/${currentUser.user_id}`)
                        }
                        disabled={actionLoading}
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        className="btn btn-warning"
                        style={{
                          marginLeft: "8px",
                        }}
                        onClick={() =>
                          void resetPassword(
                            currentUser.user_id,
                            currentUser.username,
                          )
                        }
                        disabled={actionLoading}
                      >
                        {actionLoading ? "Processing..." : "Reset Password"}
                      </button>

                      <button
                        type="button"
                        className={
                          currentUser.is_active
                            ? "btn btn-danger"
                            : "btn btn-success"
                        }
                        style={{
                          marginLeft: "8px",
                        }}
                        onClick={() =>
                          void toggleUserStatus(
                            currentUser.user_id,
                            currentUser.is_active,
                          )
                        }
                        disabled={actionLoading}
                      >
                        {actionLoading
                          ? "Processing..."
                          : currentUser.is_active
                            ? "Deactivate"
                            : "Activate"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </DashboardLayout>
  );
}
