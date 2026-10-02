import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  CircleAlert,
  CheckCircle2,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RotateCcw,
  Search,
  ShieldCheck,
  UserCheck,
  UsersRound,
  UserX,
  X,
} from "lucide-react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import Modal from "../../../components/modal";
import { authService } from "../../../services/auth.service";
import { api } from "../../../services/api";
import "../../../styles/AdminUserList.css";

const API_BASE_URL = `${api.baseUrl}/api/users`;

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
  user?: {
    user_id: number;
    username: string;
  };
}

// =====================================================
// ROLE CLASS HELPER
// =====================================================
function normalizeRoleClass(role: string) {
  return String(role || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

// =====================================================
// COMPONENT
// =====================================================
export default function UserList() {
  const navigate = useNavigate();
  const session = authService.getSession();
  const token = authService.getToken();
  const userRole = session?.role;
  const authenticated = Boolean(session && token);

  // =====================================================
  // GENERAL STATES
  // =====================================================
  const [users, setUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [actionUserId, setActionUserId] = useState<number | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetModalError, setResetModalError] = useState("");

  // =====================================================
  // ARCHIVE STATES
  // =====================================================
  const [archiveTarget, setArchiveTarget] = useState<User | null>(null);
  const [archivingUserId, setArchivingUserId] = useState<number | null>(null);
  const [archiveCountdown, setArchiveCountdown] = useState(10);

  // =====================================================
  // ACTIVATE / DEACTIVATE MODAL STATES
  // =====================================================
  const [statusTarget, setStatusTarget] = useState<User | null>(null);
  const [pendingStatus, setPendingStatus] = useState<boolean | null>(null);
  const [statusModalError, setStatusModalError] = useState("");

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

        // =================================================
        // UNAUTHORIZED
        // =================================================
        if (response.status === 401) {
          authService.logout();
          navigate("/login", {
            replace: true,
          });
          return;
        }

        // =================================================
        // FORBIDDEN
        // =================================================
        if (response.status === 403) {
          const responseObject = !Array.isArray(data) ? data : null;
          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              "You are not authorized to manage users.",
          );
        }

        // =================================================
        // OTHER ERRORS
        // =================================================
        if (!response.ok) {
          const responseObject = !Array.isArray(data) ? data : null;
          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              `Failed to load users (${response.status}).`,
          );
        }

        // =================================================
        // NORMALIZE RESPONSE
        // =================================================
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
  // RESET PASSWORD MODAL
  // =====================================================
  const openResetPasswordModal = (targetUser: User) => {
    if (actionUserId !== null || archivingUserId !== null) return;
    setError("");
    setSuccessMessage("");
    setResetModalError("");
    setNewPassword("");
    setConfirmPassword("");
    setResetTarget(targetUser);
  };
  const closeResetPasswordModal = () => {
    if (actionUserId !== null) return;
    setResetTarget(null);
    setNewPassword("");
    setConfirmPassword("");
    setResetModalError("");
  };
  const resetPassword = async () => {
    if (!resetTarget) return;
    if (!authenticated || userRole !== "Admin") {
      setResetModalError(
        "Your session has expired or you are not authorized to reset passwords.",
      );
      return;
    }
    const userId = Number(resetTarget.user_id);
    if (!Number.isInteger(userId) || userId <= 0) {
      setResetModalError("Invalid user ID.");
      return;
    }
    const cleanPassword = newPassword.trim();
    const cleanConfirmation = confirmPassword.trim();
    if (cleanPassword.length < 8) {
      setResetModalError("Password must be at least 8 characters.");
      return;
    }
    if (cleanPassword !== cleanConfirmation) {
      setResetModalError("New password and confirm password do not match.");
      return;
    }
    try {
      setActionUserId(userId);
      setError("");
      setSuccessMessage("");
      setResetModalError("");
      const response = await authService.authFetch(
        `${API_BASE_URL}/${userId}/reset-password`,
        {
          method: "PATCH",
          body: JSON.stringify({ password: cleanPassword }),
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
      setSuccessMessage(
        data?.message ||
          `Password for ${resetTarget.username} was reset successfully.`,
      );
      setResetTarget(null);
      setNewPassword("");
      setConfirmPassword("");
      setResetModalError("");
    } catch (err) {
      console.error("RESET PASSWORD ERROR:", err);
      setResetModalError(
        err instanceof Error ? err.message : "Password reset failed.",
      );
    } finally {
      setActionUserId(null);
    }
  };

  // =====================================================
  // ACTIVATE / DEACTIVATE MODAL
  // =====================================================
  const openStatusModal = (targetUser: User) => {
    if (actionUserId !== null || archivingUserId !== null) return;
    setError("");
    setSuccessMessage("");
    setStatusModalError("");
    setStatusTarget(targetUser);
    setPendingStatus(!targetUser.is_active);
  };
  const closeStatusModal = () => {
    if (actionUserId !== null) return;
    setStatusTarget(null);
    setPendingStatus(null);
    setStatusModalError("");
  };
  const confirmUserStatusChange = async () => {
    if (!statusTarget || pendingStatus === null) return;
    if (!authenticated || userRole !== "Admin") {
      setStatusModalError(
        "Your session has expired or you are not authorized to update users.",
      );
      return;
    }
    const userId = Number(statusTarget.user_id);
    if (!Number.isInteger(userId) || userId <= 0) {
      setStatusModalError("Invalid user ID.");
      return;
    }
    try {
      setActionUserId(userId);
      setError("");
      setSuccessMessage("");
      setStatusModalError("");
      const response = await authService.authFetch(
        `${API_BASE_URL}/${userId}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ is_active: pendingStatus }),
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
            ? { ...currentUser, is_active: pendingStatus }
            : currentUser,
        ),
      );
      setSuccessMessage(
        data?.message ||
          (pendingStatus
            ? `${statusTarget.username} was activated successfully.`
            : `${statusTarget.username} was deactivated successfully.`),
      );
      setStatusTarget(null);
      setPendingStatus(null);
      setStatusModalError("");
    } catch (err) {
      console.error("UPDATE USER STATUS ERROR:", err);
      setStatusModalError(
        err instanceof Error ? err.message : "Failed to update user status.",
      );
    } finally {
      setActionUserId(null);
    }
  };

  // =====================================================
  // START ARCHIVE
  // =====================================================
  const startArchiveUser = (targetUser: User) => {
    if (archivingUserId !== null || actionUserId !== null) {
      return;
    }
    setError("");
    setArchiveTarget(targetUser);
    setArchiveCountdown(10);
  };

  // =====================================================
  // UNDO ARCHIVE
  // =====================================================
  const undoArchive = () => {
    // Cannot undo once API request has started
    if (archivingUserId !== null) {
      return;
    }
    setArchiveTarget(null);
    setArchiveCountdown(10);
  };

  // =====================================================
  // ARCHIVE USER
  // =====================================================
  const archiveUser = useCallback(async () => {
    if (!archiveTarget) {
      return;
    }
    if (archivingUserId !== null) {
      return;
    }
    if (!authenticated || userRole !== "Admin") {
      setError(
        "Your session has expired or you are not authorized to archive users.",
      );
      return;
    }
    const userId = Number(archiveTarget.user_id);
    if (!Number.isInteger(userId) || userId <= 0) {
      setError("Invalid user ID.");
      return;
    }
    try {
      setArchivingUserId(userId);
      setError("");
      const response = await authService.authFetch(
        `${API_BASE_URL}/${userId}`,
        {
          method: "DELETE",
          headers: {
            Accept: "application/json",
          },
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

      // =================================================
      // AUTH ERROR
      // =================================================
      if (response.status === 401) {
        authService.logout();
        navigate("/login", {
          replace: true,
        });
        return;
      }

      // =================================================
      // ACCESS ERROR
      // =================================================
      if (response.status === 403) {
        throw new Error(
          data?.message ||
            data?.error ||
            "You are not authorized to archive users.",
        );
      }

      // =================================================
      // ARCHIVE ERROR
      // =================================================
      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to archive user (${response.status}).`,
        );
      }

      // =================================================
      // REMOVE ARCHIVED USER FROM ACTIVE LIST
      // =================================================
      setUsers((previous) =>
        previous.filter((currentUser) => currentUser.user_id !== userId),
      );

      // =================================================
      // CLOSE MODAL
      // =================================================
      setArchiveTarget(null);
      setArchiveCountdown(10);
    } catch (err) {
      console.error("ARCHIVE USER ERROR:", err);
      if (err instanceof TypeError) {
        setError(
          "Unable to connect to the user server. Make sure the backend is running.",
        );
      } else {
        setError(
          err instanceof Error ? err.message : "Failed to archive user.",
        );
      }
      setArchiveTarget(null);
      setArchiveCountdown(10);
    } finally {
      setArchivingUserId(null);
    }
  }, [
    archiveTarget,
    archivingUserId,
    authenticated,
    userRole,
    navigate,
  ]);

  // =====================================================
  // ARCHIVE 10 SECOND COUNTDOWN
  // =====================================================
  useEffect(() => {
    if (!archiveTarget) {
      return;
    }
    if (archivingUserId !== null) {
      return;
    }
    if (archiveCountdown <= 0) {
      void archiveUser();
      return;
    }
    const timer = window.setTimeout(() => {
      setArchiveCountdown((current) => current - 1);
    }, 1000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [archiveTarget, archiveCountdown, archivingUserId, archiveUser]);

  // =====================================================
  // SUMMARY
  // =====================================================
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

  // =====================================================
  // SEARCH
  // =====================================================
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

  // =====================================================
  // AUTH GUARD
  // =====================================================
  if (!authenticated || !session || userRole !== "Admin") {
    return null;
  }

  // =====================================================
  // UI
  // =====================================================
  return (
    <DashboardLayout>
      <main className="admin-user-directory">
        {/* =================================================
            HEADER
        ================================================= */}
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
              information, reset passwords, and archive accounts that should no
              longer appear in the active directory.
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
        {/* =================================================
            SUMMARY CARDS
        ================================================= */}
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
        {/* =================================================
            ERROR MESSAGE
        ================================================= */}
        {error && (
          <div className="admin-user-directory__error" role="status">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        {successMessage && (
          <div className="admin-user-directory__success" role="status">
            <CheckCircle2 size={18} aria-hidden="true" />
            <span>{successMessage}</span>
            <button
              type="button"
              onClick={() => setSuccessMessage("")}
              aria-label="Dismiss success message"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        )}
        {/* =================================================
            USER LIST
        ================================================= */}
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
            {/* =============================================
                SEARCH
            ============================================= */}
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
          {/* ===============================================
              TABLE
          =============================================== */}
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
                {/* ===========================================
                    LOADING
                =========================================== */}
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
                  /* =========================================
                     EMPTY
                  ========================================= */
                  <tr>
                    <td colSpan={6}>
                      <div className="admin-user-directory__table-state">
                        <UsersRound size={22} aria-hidden="true" />
                        <span>No users found.</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  /* =========================================
                     USERS
                  ========================================= */
                  filteredUsers.map((currentUser) => {
                    const actionLoading = actionUserId === currentUser.user_id;
                    const archiving = archivingUserId === currentUser.user_id;
                    const roleClass = normalizeRoleClass(currentUser.role);
                    const initial =
                      currentUser.username?.trim().charAt(0).toUpperCase() ||
                      "U";
                    return (
                      <tr key={currentUser.user_id}>
                        {/* ID */}
                        <td>
                          <span className="admin-user-directory__user-id">
                            {currentUser.user_id}
                          </span>
                        </td>
                        {/* USER */}
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
                        {/* EMAIL */}
                        <td>{currentUser.email}</td>
                        {/* ROLE */}
                        <td>
                          <span
                            className={`admin-user-directory__role admin-user-directory__role--${roleClass}`}
                          >
                            {currentUser.role}
                          </span>
                        </td>
                        {/* STATUS */}
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
                        {/* ACTIONS */}
                        <td>
                          <div className="admin-user-directory__actions">
                            {/* =================================
                                  EDIT
                              ================================= */}
                            <button
                              type="button"
                              className="admin-user-directory__action admin-user-directory__action--edit"
                              onClick={() =>
                                navigate(
                                  `/admin/user/edit/${currentUser.user_id}`,
                                )
                              }
                              disabled={actionLoading || archiving}
                            >
                              <Pencil size={14} aria-hidden="true" />
                              Edit
                            </button>
                            {/* =================================
                                  RESET PASSWORD
                              ================================= */}
                            <button
                              type="button"
                              className="admin-user-directory__action admin-user-directory__action--reset"
                              onClick={() => openResetPasswordModal(currentUser)}
                              disabled={actionLoading || archiving}
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
                            {/* =================================
                                  ACTIVATE / DEACTIVATE
                              ================================= */}
                            <button
                              type="button"
                              className={
                                currentUser.is_active
                                  ? "admin-user-directory__action admin-user-directory__action--deactivate"
                                  : "admin-user-directory__action admin-user-directory__action--activate"
                              }
                              onClick={() => openStatusModal(currentUser)}
                              disabled={actionLoading || archiving}
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
                            {/* =================================
                                  ARCHIVE
                              ================================= */}
                            <button
                              type="button"
                              className="admin-user-directory__action admin-user-directory__action--archive"
                              onClick={() => startArchiveUser(currentUser)}
                              disabled={actionLoading || archiving}
                            >
                              {archiving ? (
                                <LoaderCircle
                                  size={14}
                                  className="admin-user-directory__spinner"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Archive size={14} aria-hidden="true" />
                              )}
                              {archiving ? "Archiving..." : "Archive"}
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
        {/* =================================================
            ACTIVATE / DEACTIVATE MODAL
        ================================================= */}
        {resetTarget && (
          <Modal
            isOpen={Boolean(resetTarget)}
            onClose={closeResetPasswordModal}
          >
            <form
              className="admin-user-directory__account-modal"
              onSubmit={(event) => {
                event.preventDefault();
                void resetPassword();
              }}
            >
              <div className="admin-user-directory__account-modal-heading">
                <span className="admin-user-directory__account-modal-icon admin-user-directory__account-modal-icon--reset">
                  {actionUserId === resetTarget.user_id ? (
                    <LoaderCircle
                      size={20}
                      className="admin-user-directory__spinner"
                      aria-hidden="true"
                    />
                  ) : (
                    <KeyRound size={20} aria-hidden="true" />
                  )}
                </span>
                <div>
                  <small>Account Security</small>
                  <h2>Reset Password</h2>
                  <p>Set a new password for the selected portal account.</p>
                </div>
              </div>
              <div className="admin-user-directory__modal-user">
                <span className="admin-user-directory__modal-avatar">
                  {resetTarget.username.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <strong>{resetTarget.username}</strong>
                  <span>{resetTarget.email}</span>
                  <small>
                    {resetTarget.role} ·{" "}
                    {resetTarget.is_active ? "Active" : "Inactive"}
                  </small>
                </div>
              </div>
              <div className="admin-user-directory__password-fields">
                <label>
                  <span>New Password</span>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(event) => {
                      setNewPassword(event.target.value);
                      if (resetModalError) setResetModalError("");
                    }}
                    placeholder="Enter at least 8 characters"
                    autoComplete="new-password"
                    disabled={actionUserId !== null}
                    autoFocus
                  />
                </label>
                <label>
                  <span>Confirm Password</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => {
                      setConfirmPassword(event.target.value);
                      if (resetModalError) setResetModalError("");
                    }}
                    placeholder="Re-enter the new password"
                    autoComplete="new-password"
                    disabled={actionUserId !== null}
                  />
                </label>
                <small className="admin-user-directory__password-help">
                  Password must contain at least 8 characters.
                </small>
              </div>
              {resetModalError && (
                <div className="admin-user-directory__modal-error" role="alert">
                  <CircleAlert size={15} aria-hidden="true" />
                  <span>{resetModalError}</span>
                </div>
              )}
              <div className="admin-user-directory__account-modal-actions">
                <button
                  type="button"
                  className="admin-user-directory__modal-button admin-user-directory__modal-button--cancel"
                  onClick={closeResetPasswordModal}
                  disabled={actionUserId !== null}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="admin-user-directory__modal-button admin-user-directory__modal-button--reset"
                  disabled={actionUserId !== null}
                >
                  {actionUserId === resetTarget.user_id ? (
                    <LoaderCircle
                      size={15}
                      className="admin-user-directory__spinner"
                      aria-hidden="true"
                    />
                  ) : (
                    <KeyRound size={15} aria-hidden="true" />
                  )}
                  {actionUserId === resetTarget.user_id
                    ? "Resetting..."
                    : "Reset Password"}
                </button>
              </div>
            </form>
          </Modal>
        )}
        {statusTarget && pendingStatus !== null && (
          <Modal isOpen={Boolean(statusTarget)} onClose={closeStatusModal}>
            <div className="admin-user-directory__account-modal">
              <div className="admin-user-directory__account-modal-heading">
                <span
                  className={
                    pendingStatus
                      ? "admin-user-directory__account-modal-icon admin-user-directory__account-modal-icon--activate"
                      : "admin-user-directory__account-modal-icon admin-user-directory__account-modal-icon--deactivate"
                  }
                >
                  {actionUserId === statusTarget.user_id ? (
                    <LoaderCircle
                      size={20}
                      className="admin-user-directory__spinner"
                      aria-hidden="true"
                    />
                  ) : pendingStatus ? (
                    <Power size={20} aria-hidden="true" />
                  ) : (
                    <PowerOff size={20} aria-hidden="true" />
                  )}
                </span>
                <div>
                  <small>Account Access</small>
                  <h2>{pendingStatus ? "Activate User" : "Deactivate User"}</h2>
                  <p>
                    {pendingStatus
                      ? "Restore portal access for this user account."
                      : "Confirm that you want to disable portal access for this user."}
                  </p>
                </div>
              </div>
              <div className="admin-user-directory__modal-user">
                <span className="admin-user-directory__modal-avatar">
                  {statusTarget.username.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <strong>{statusTarget.username}</strong>
                  <span>{statusTarget.email}</span>
                  <small>
                    {statusTarget.role} ·{" "}
                    {statusTarget.is_active ? "Active" : "Inactive"}
                  </small>
                </div>
              </div>
              {!pendingStatus && (
                <div className="admin-user-directory__deactivate-note">
                  <PowerOff size={15} aria-hidden="true" />
                  <p>
                    The user will no longer be able to sign in until the account
                    is activated again. The account record will not be deleted.
                  </p>
                </div>
              )}
              {statusModalError && (
                <div className="admin-user-directory__modal-error" role="alert">
                  <CircleAlert size={15} aria-hidden="true" />
                  <span>{statusModalError}</span>
                </div>
              )}
              <div className="admin-user-directory__account-modal-actions">
                <button
                  type="button"
                  className="admin-user-directory__modal-button admin-user-directory__modal-button--cancel"
                  onClick={closeStatusModal}
                  disabled={actionUserId !== null}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={
                    pendingStatus
                      ? "admin-user-directory__modal-button admin-user-directory__modal-button--activate"
                      : "admin-user-directory__modal-button admin-user-directory__modal-button--deactivate"
                  }
                  onClick={() => void confirmUserStatusChange()}
                  disabled={actionUserId !== null}
                >
                  {actionUserId === statusTarget.user_id ? (
                    <LoaderCircle
                      size={15}
                      className="admin-user-directory__spinner"
                      aria-hidden="true"
                    />
                  ) : pendingStatus ? (
                    <Power size={15} aria-hidden="true" />
                  ) : (
                    <PowerOff size={15} aria-hidden="true" />
                  )}
                  {actionUserId === statusTarget.user_id
                    ? "Processing..."
                    : pendingStatus
                      ? "Confirm Activation"
                      : "Confirm Deactivation"}
                </button>
              </div>
            </div>
          </Modal>
        )}
        {/* =================================================
            ARCHIVE UNDO MODAL
        ================================================= */}
        {archiveTarget && (
          <Modal isOpen={Boolean(archiveTarget)} onClose={undoArchive}>
            <div className="admin-user-directory__archive-modal">
              <span className="admin-user-directory__archive-modal-icon">
                {archivingUserId !== null ? (
                  <LoaderCircle
                    size={21}
                    className="admin-user-directory__spinner"
                    aria-hidden="true"
                  />
                ) : (
                  <Archive size={21} aria-hidden="true" />
                )}
              </span>
              <div>
                <h2>
                  {archivingUserId !== null
                    ? "Archiving User"
                    : "User Pending Archive"}
                </h2>
                {archivingUserId !== null ? (
                  <p>
                    Archiving <strong>{archiveTarget.username}</strong>. Please
                    do not close this window.
                  </p>
                ) : (
                  <>
                    <p>
                      <strong>{archiveTarget.username}</strong> will be archived
                      in <strong>{archiveCountdown} seconds</strong>.
                    </p>
                    <p>
                      Press Undo before the countdown reaches zero to keep this
                      user active.
                    </p>
                    <div
                      className="admin-user-directory__archive-countdown"
                      aria-label={`${archiveCountdown} seconds remaining`}
                    >
                      {archiveCountdown}
                    </div>
                  </>
                )}
              </div>
              {archivingUserId === null && (
                <div className="admin-user-directory__archive-modal-actions">
                  <button
                    type="button"
                    className="admin-user-directory__archive-modal-button"
                    onClick={undoArchive}
                  >
                    <RotateCcw size={15} aria-hidden="true" />
                    Undo Archive
                  </button>
                </div>
              )}
            </div>
          </Modal>
        )}
      </main>
    </DashboardLayout>
  );
}
