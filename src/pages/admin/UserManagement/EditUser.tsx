import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CircleAlert,
  ContactRound,
  IdCard,
  LoaderCircle,
  Mail,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import "../../../styles/AdminEditUser.css";

const API_BASE_URL = apiUrl("/api/users");

const USER_ROLES = [
  "Admin",
  "Registrar",
  "Faculty",
  "Program Head",
  "Finance",
  "Student",
] as const;

const EMPLOYMENT_STATUSES = ["Regular", "Part-Time", "Contractual"] as const;

type UserForm = {
  username: string;
  email: string;
  role: string;
  is_active: boolean;
  employee_number: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  gender: string;
  birth_date: string;
  contact_number: string;
  department_id: string;
  employment_status: string;
  hire_date: string;
};

interface DepartmentOption {
  department_id: number;
  department_code: string;
  department_name: string;
}

interface DepartmentsResponse {
  success?: boolean;
  departments?: DepartmentOption[];
  message?: string;
  error?: string;
}

interface UserResponse {
  user_id?: number;
  username?: string;
  email?: string;
  role?: string;
  is_active?: boolean;
  employee_number?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  gender?: string | null;
  birth_date?: string | null;
  contact_number?: string | null;
  department_id?: number | null;
  department_code?: string | null;
  department_name?: string | null;
  employment_status?: string | null;
  hire_date?: string | null;
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

function toDateInputValue(value?: string | null) {
  if (!value) {
    return "";
  }

  return String(value).slice(0, 10);
}

function isStaffProfileRole(role: string) {
  return role === "Faculty" || role === "Program Head";
}

export default function EditUser() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const session = authService.getSession();
  const token = authService.getToken();
  const userRole = session?.role;
  const authenticated = Boolean(session && token);

  const [formData, setFormData] = useState<UserForm>({
    username: "",
    email: "",
    role: "",
    is_active: true,
    employee_number: "",
    first_name: "",
    middle_name: "",
    last_name: "",
    gender: "",
    birth_date: "",
    contact_number: "",
    department_id: "",
    employment_status: "Regular",
    hire_date: "",
  });

  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDepartments, setLoadingDepartments] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const needsStaffProfile = isStaffProfileRole(formData.role);

  const selectedDepartment = useMemo(
    () =>
      departments.find(
        (department) =>
          String(department.department_id) === formData.department_id,
      ) ?? null,
    [departments, formData.department_id],
  );

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

    const loadDepartments = async () => {
      try {
        setLoadingDepartments(true);

        const response = await authService.authFetch(
          `${API_BASE_URL}/departments/options`,
          {
            method: "GET",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          },
        );

        const data = (await response.json()) as DepartmentsResponse;

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || data.error || "Unable to load departments.",
          );
        }

        setDepartments(Array.isArray(data.departments) ? data.departments : []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        console.error("LOAD DEPARTMENTS ERROR:", err);
        setDepartments([]);
      } finally {
        if (!controller.signal.aborted) {
          setLoadingDepartments(false);
        }
      }
    };

    void loadDepartments();

    return () => controller.abort();
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
          employee_number: String(loadedUser.employee_number ?? ""),
          first_name: String(loadedUser.first_name ?? ""),
          middle_name: String(loadedUser.middle_name ?? ""),
          last_name: String(loadedUser.last_name ?? ""),
          gender: String(loadedUser.gender ?? ""),
          birth_date: toDateInputValue(loadedUser.birth_date),
          contact_number: String(loadedUser.contact_number ?? ""),
          department_id:
            loadedUser.department_id === null ||
            loadedUser.department_id === undefined
              ? ""
              : String(loadedUser.department_id),
          employment_status: String(
            loadedUser.employment_status || "Regular",
          ),
          hire_date: toDateInputValue(loadedUser.hire_date),
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

    return () => controller.abort();
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
      setErrorMessage("Please fill in all required account fields.");
      return;
    }

    if (needsStaffProfile) {
      if (!formData.first_name.trim()) {
        setErrorMessage(
          "First name is required for Faculty and Program Head accounts.",
        );
        return;
      }

      if (!formData.last_name.trim()) {
        setErrorMessage(
          "Last name is required for Faculty and Program Head accounts.",
        );
        return;
      }

      if (!formData.department_id) {
        setErrorMessage(
          "Please select a department for the Faculty or Program Head profile.",
        );
        return;
      }
    }

    try {
      setSaving(true);

      const payload = {
        username,
        email,
        role,
        is_active: formData.is_active,
        ...(needsStaffProfile
          ? {
              first_name: formData.first_name.trim(),
              middle_name: formData.middle_name.trim(),
              last_name: formData.last_name.trim(),
              gender: formData.gender || null,
              birth_date: formData.birth_date || null,
              contact_number: formData.contact_number.trim() || null,
              department_id: Number(formData.department_id),
              employment_status: formData.employment_status || "Regular",
              hire_date: formData.hire_date || null,
            }
          : {}),
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
              Update portal access and, for Faculty or Program Head accounts,
              maintain the staff profile information shown throughout PTC Portal.
            </p>
          </div>

          <div className="admin-edit-user__hero-actions">
            <div className="admin-edit-user__identity">
              <span className="admin-edit-user__identity-icon">
                <UserRound size={18} aria-hidden="true" />
              </span>

              <div>
                <small>User ID</small>
                <strong>{displayUserId}</strong>
              </div>
            </div>

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
                <p>Manage the user&apos;s portal account and assigned role.</p>
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

            {needsStaffProfile && (
              <>
                <header className="admin-edit-user__form-header admin-edit-user__form-header--profile">
                  <span className="admin-edit-user__form-icon">
                    <ContactRound size={18} aria-hidden="true" />
                  </span>

                  <div>
                    <span>
                      {formData.role === "Program Head"
                        ? "Program Head Profile"
                        : "Faculty Profile"}
                    </span>
                    <h2>Staff Information</h2>
                    <p>
                      These fields are stored in the Faculty record and are
                      displayed in the user&apos;s profile.
                    </p>
                  </div>
                </header>

                <div className="admin-edit-user__fields">
                  <label className="admin-edit-user__field">
                    <span>Employee Number</span>

                    <div className="admin-edit-user__input-with-icon">
                      <IdCard size={15} aria-hidden="true" />
                      <input
                        type="text"
                        value={formData.employee_number || "Generated by system"}
                        disabled
                        readOnly
                      />
                    </div>

                    <small>
                      Employee numbers are system-managed and are not edited
                      manually.
                    </small>
                  </label>

                  <label className="admin-edit-user__field">
                    <span>
                      Department <em>*</em>
                    </span>

                    <div className="admin-edit-user__select-with-icon">
                      <Building2 size={15} aria-hidden="true" />
                      <select
                        name="department_id"
                        value={formData.department_id}
                        onChange={handleChange}
                        disabled={saving || loadingDepartments}
                        required
                      >
                        <option value="">
                          {loadingDepartments
                            ? "Loading departments..."
                            : "Select department"}
                        </option>

                        {departments.map((department) => (
                          <option
                            key={department.department_id}
                            value={department.department_id}
                          >
                            {department.department_code} ·{" "}
                            {department.department_name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {selectedDepartment && (
                      <small>
                        Assigned to {selectedDepartment.department_name}.
                      </small>
                    )}
                  </label>

                  <label className="admin-edit-user__field">
                    <span>
                      First Name <em>*</em>
                    </span>
                    <input
                      type="text"
                      name="first_name"
                      value={formData.first_name}
                      onChange={handleChange}
                      disabled={saving}
                      placeholder="Enter first name"
                      required
                    />
                  </label>

                  <label className="admin-edit-user__field">
                    <span>Middle Name</span>
                    <input
                      type="text"
                      name="middle_name"
                      value={formData.middle_name}
                      onChange={handleChange}
                      disabled={saving}
                      placeholder="Enter middle name"
                    />
                  </label>

                  <label className="admin-edit-user__field">
                    <span>
                      Last Name <em>*</em>
                    </span>
                    <input
                      type="text"
                      name="last_name"
                      value={formData.last_name}
                      onChange={handleChange}
                      disabled={saving}
                      placeholder="Enter last name"
                      required
                    />
                  </label>

                  <label className="admin-edit-user__field">
                    <span>Gender</span>
                    <select
                      name="gender"
                      value={formData.gender}
                      onChange={handleChange}
                      disabled={saving}
                    >
                      <option value="">Not recorded</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                  </label>

                  <label className="admin-edit-user__field">
                    <span>Birth Date</span>
                    <div className="admin-edit-user__input-with-icon">
                      <CalendarDays size={15} aria-hidden="true" />
                      <input
                        type="date"
                        name="birth_date"
                        value={formData.birth_date}
                        onChange={handleChange}
                        disabled={saving}
                      />
                    </div>
                  </label>

                  <label className="admin-edit-user__field">
                    <span>Contact Number</span>
                    <input
                      type="tel"
                      name="contact_number"
                      value={formData.contact_number}
                      onChange={handleChange}
                      disabled={saving}
                      placeholder="e.g. 09XXXXXXXXX"
                    />
                  </label>

                  <label className="admin-edit-user__field">
                    <span>Employment Status</span>
                    <div className="admin-edit-user__select-with-icon">
                      <BriefcaseBusiness size={15} aria-hidden="true" />
                      <select
                        name="employment_status"
                        value={formData.employment_status}
                        onChange={handleChange}
                        disabled={saving}
                      >
                        {EMPLOYMENT_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>

                  <label className="admin-edit-user__field">
                    <span>Hire Date</span>
                    <div className="admin-edit-user__input-with-icon">
                      <CalendarDays size={15} aria-hidden="true" />
                      <input
                        type="date"
                        name="hire_date"
                        value={formData.hire_date}
                        onChange={handleChange}
                        disabled={saving}
                      />
                    </div>
                  </label>
                </div>

                <div className="admin-edit-user__profile-note">
                  <Building2 size={17} aria-hidden="true" />
                  <div>
                    <strong>
                      {formData.role === "Program Head"
                        ? "Program Head profile source"
                        : "Faculty profile source"}
                    </strong>
                    <p>
                      Saving this form updates the linked Faculty record. Program
                      Head department changes are also synchronized with the
                      active Program Head assignment.
                    </p>
                  </div>
                </div>
              </>
            )}

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