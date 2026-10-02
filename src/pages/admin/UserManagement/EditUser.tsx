import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CircleAlert,
  LoaderCircle,
  Mail,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/AdminEditUser.css";

const API_BASE_URL = "http://localhost:3000/api/users";

const USER_ROLES = [
  "Admin",
  "Registrar",
  "Faculty",
  "Program Head",
  "Finance",
  "Student",
] as const;

type UserForm = {
  username: string;
  email: string;
  role: string;
  is_active: boolean;
};

interface UserResponse {
  user_id?: number;
  username?: string;
  email?: string;
  role?: string;
  is_active?: boolean;
  success?: boolean;
  data?: UserResponse;
  user?: UserResponse;
  message?: string;
  error?: string;
}

interface UpdateResponse {
  success?: boolean;
  message?: string;
  error?: string;
}

export default function EditUser() {
  const navigate = useNavigate();

  const { id } = useParams<{
    id: string;
  }>();

  const session = authService.getSession();
  const token = authService.getToken();
  const userRole = session?.role;
  const authenticated = Boolean(session && token);

  const [formData, setFormData] = useState<UserForm>({
    username: "",
    email: "",
    role: "",
    is_active: true,
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

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

    const userId = Number(id);

    if (!Number.isInteger(userId) || userId <= 0) {
      setErrorMessage("Invalid user ID.");
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    const loadUser = async () => {
      try {
        setLoading(true);
        setErrorMessage("");

        const response = await authService.authFetch(
          `${API_BASE_URL}/${userId}`,
          {
            method: "GET",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          },
        );

        const contentType = response.headers.get("content-type") || "";
        let data: UserResponse | null = null;

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
              "You are not authorized to view this user.",
          );
        }

        if (!response.ok) {
          throw new Error(
            data?.message ||
              data?.error ||
              `Unable to load user (${response.status}).`,
          );
        }

        const loadedUser = data?.user ?? data?.data ?? data;

        if (!loadedUser) {
          throw new Error("User data was not returned by the server.");
        }

        setFormData({
          username: String(loadedUser.username ?? ""),
          email: String(loadedUser.email ?? ""),
          role: String(loadedUser.role ?? ""),
          is_active: Boolean(loadedUser.is_active),
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        console.error("LOAD USER ERROR:", err);

        if (err instanceof TypeError) {
          setErrorMessage(
            "Unable to connect to the user server. Make sure the backend is running on port 3000.",
          );
          return;
        }

        setErrorMessage(
          err instanceof Error ? err.message : "Failed to load user.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadUser();

    return () => {
      controller.abort();
    };
  }, [id, authenticated, userRole, navigate]);

  const handleChange = (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = event.target;

    if (name === "is_active") {
      setFormData((current) => ({
        ...current,
        is_active: value === "true",
      }));
      return;
    }

    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    if (!authenticated || userRole !== "Admin") {
      setErrorMessage(
        "Your session has expired or you are not authorized to update users.",
      );
      return;
    }

    const userId = Number(id);

    if (!Number.isInteger(userId) || userId <= 0) {
      setErrorMessage("Invalid user ID.");
      return;
    }

    const username = formData.username.trim();
    const email = formData.email.trim();
    const role = formData.role.trim();

    if (!username || !email || !role) {
      setErrorMessage("Please fill in all required fields.");
      return;
    }

    try {
      setSaving(true);

      const payload = {
        username,
        email,
        role,
        is_active: formData.is_active,
      };

      const response = await authService.authFetch(
        `${API_BASE_URL}/${userId}`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
        },
      );

      const contentType = response.headers.get("content-type") || "";
      let data: UpdateResponse | null = null;

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
            "You are not authorized to update users.",
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to update user (${response.status}).`,
        );
      }

      window.alert(data?.message || "User updated successfully.");
      navigate("/admin/user/list");
    } catch (err) {
      console.error("UPDATE USER ERROR:", err);

      if (err instanceof TypeError) {
        setErrorMessage(
          "Unable to connect to the user server. Make sure the backend is running on port 3000.",
        );
        return;
      }

      setErrorMessage(
        err instanceof Error ? err.message : "Failed to update user.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!authenticated || !session || userRole !== "Admin") {
    return null;
  }

  const userId = Number(id);
  const displayUserId =
    Number.isInteger(userId) && userId > 0 ? String(userId) : "Invalid";

  return (
    <DashboardLayout>
      <main className="admin-edit-user">
        <div className="admin-edit-user__toolbar">
          <button
            type="button"
            className="admin-edit-user__back"
            onClick={() => navigate("/admin/user/list")}
            disabled={saving}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to User List
          </button>
        </div>

        <section className="admin-edit-user__hero">
          <div className="admin-edit-user__hero-copy">
            <div className="admin-edit-user__eyebrow">
              <span>
                <ShieldCheck size={16} aria-hidden="true" />
              </span>
              Admin · User Management
            </div>

            <h1>Edit User</h1>

            <p>
              Update account information, role assignment, and account status
              while preserving the user&apos;s existing portal access record.
            </p>
          </div>

          <div className="admin-edit-user__identity">
            <span className="admin-edit-user__identity-icon">
              <UserRound size={18} aria-hidden="true" />
            </span>

            <div>
              <small>User ID</small>
              <strong>{displayUserId}</strong>
            </div>
          </div>
        </section>

        {errorMessage && (
          <div className="admin-edit-user__error" role="status">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}

        {loading ? (
          <section className="admin-edit-user__state">
            <span className="admin-edit-user__state-icon">
              <LoaderCircle
                size={24}
                className="admin-edit-user__spinner"
                aria-hidden="true"
              />
            </span>

            <strong>Loading user...</strong>
            <p>Please wait while the account information is retrieved.</p>
          </section>
        ) : (
          <form className="admin-edit-user__form" onSubmit={handleSubmit}>
            <header className="admin-edit-user__form-header">
              <span className="admin-edit-user__form-icon">
                <UserRound size={18} aria-hidden="true" />
              </span>

              <div>
                <span>Account Details</span>
                <h2>User Information</h2>
                <p>Edit the account fields below, then save your changes.</p>
              </div>
            </header>

            <div className="admin-edit-user__fields">
              <label className="admin-edit-user__field">
                <span>
                  Username <em>*</em>
                </span>

                <div className="admin-edit-user__input-with-icon">
                  <UserRound size={15} aria-hidden="true" />
                  <input
                    id="edit-username"
                    type="text"
                    name="username"
                    placeholder="Enter username"
                    value={formData.username}
                    onChange={handleChange}
                    disabled={saving}
                    required
                  />
                </div>
              </label>

              <label className="admin-edit-user__field">
                <span>
                  Email <em>*</em>
                </span>

                <div className="admin-edit-user__input-with-icon">
                  <Mail size={15} aria-hidden="true" />
                  <input
                    id="edit-email"
                    type="email"
                    name="email"
                    placeholder="Enter PTC email"
                    value={formData.email}
                    onChange={handleChange}
                    disabled={saving}
                    required
                  />
                </div>
              </label>

              <label className="admin-edit-user__field">
                <span>
                  Role <em>*</em>
                </span>

                <div className="admin-edit-user__select-with-icon">
                  <ShieldCheck size={15} aria-hidden="true" />
                  <select
                    id="edit-role"
                    name="role"
                    value={formData.role}
                    onChange={handleChange}
                    disabled={saving}
                    required
                  >
                    <option value="">Select Role</option>

                    {USER_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="admin-edit-user__field">
                <span>Status</span>

                <select
                  id="edit-status"
                  name="is_active"
                  value={formData.is_active ? "true" : "false"}
                  onChange={handleChange}
                  disabled={saving}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </label>
            </div>

            <div className="admin-edit-user__status-preview">
              <span
                className={
                  formData.is_active
                    ? "admin-edit-user__status admin-edit-user__status--active"
                    : "admin-edit-user__status admin-edit-user__status--inactive"
                }
              >
                {formData.is_active ? "Active Account" : "Inactive Account"}
              </span>

              <p>
                {formData.is_active
                  ? "This account is currently allowed to sign in according to its assigned role."
                  : "This account is currently marked inactive."}
              </p>
            </div>

            <footer className="admin-edit-user__actions">
              <button
                type="button"
                className="admin-edit-user__cancel"
                onClick={() => navigate("/admin/user/list")}
                disabled={saving}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="admin-edit-user__save"
                disabled={saving}
              >
                {saving ? (
                  <LoaderCircle
                    size={16}
                    className="admin-edit-user__spinner"
                    aria-hidden="true"
                  />
                ) : (
                  <Save size={16} aria-hidden="true" />
                )}

                {saving ? "Saving..." : "Save Changes"}
              </button>
            </footer>
          </form>
        )}
      </main>
    </DashboardLayout>
  );
}
