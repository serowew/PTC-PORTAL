import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CircleAlert,
  ContactRound,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Mail,
  ShieldCheck,
  UserPlus,
  UserRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import "../../../styles/AdminCreateUser.css";

const API_BASE_URL = apiUrl("/api/users");

interface CreateUserResponse {
  success?: boolean;
  user_id?: number;
  message?: string;
  error?: string;
}

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

const USER_ROLES = [
  "Admin",
  "Registrar",
  "Faculty",
  "Program Head",
  "Finance",
  "Student",
] as const;

const EMPLOYMENT_STATUSES = ["Regular", "Part-Time", "Contractual"] as const;

function isStaffProfileRole(role: string) {
  return role === "Faculty" || role === "Program Head";
}

export default function CreateUser() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();
  const userRole = session?.role;
  const authenticated = Boolean(session && token);

  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "",
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
  const [loadingDepartments, setLoadingDepartments] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const needsStaffProfile = isStaffProfileRole(formData.role);

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

  const handleChange = (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = event.target;

    setFormData((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!authenticated || userRole !== "Admin") {
      setError(
        "Your session has expired or you are not authorized to create users.",
      );
      return;
    }

    const username = formData.username.trim().toUpperCase();
    const email = formData.email.trim().toLowerCase();
    const password = formData.password;
    const confirmPassword = formData.confirmPassword;
    const role = formData.role.trim();

    if (!username) {
      setError("Username is required.");
      return;
    }

    if (!email) {
      setError("Email is required.");
      return;
    }

    if (!role) {
      setError("Please select a user role.");
      return;
    }

    if (!USER_ROLES.includes(role as (typeof USER_ROLES)[number])) {
      setError("Invalid user role.");
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (needsStaffProfile) {
      if (!formData.first_name.trim()) {
        setError(
          "First name is required for Faculty and Program Head accounts.",
        );
        return;
      }

      if (!formData.last_name.trim()) {
        setError(
          "Last name is required for Faculty and Program Head accounts.",
        );
        return;
      }

      if (!formData.department_id) {
        setError(
          "Please select a department for the Faculty or Program Head profile.",
        );
        return;
      }
    }

    try {
      setLoading(true);

      const payload = {
        username,
        email,
        password,
        role,
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

      const response = await authService.authFetch(API_BASE_URL, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const contentType = response.headers.get("content-type") || "";
      let data: CreateUserResponse | null = null;

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
            "You are not authorized to create users.",
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to create user (${response.status}).`,
        );
      }

      window.alert(data?.message || "User created successfully.");
      navigate("/admin/user/list");
    } catch (err) {
      console.error("CREATE USER ERROR:", err);

      if (err instanceof TypeError) {
        setError(
          "Unable to connect to the user server. Make sure the backend is running on port 3000.",
        );
        return;
      }

      setError(err instanceof Error ? err.message : "Failed to create user.");
    } finally {
      setLoading(false);
    }
  }

  if (!authenticated || !session || userRole !== "Admin") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="admin-create-user">
        <section className="admin-create-user__hero">
          <div className="admin-create-user__hero-copy">
            <div className="admin-create-user__eyebrow">
              <span>
                <UserPlus size={16} aria-hidden="true" />
              </span>
              Admin · User Management
            </div>

            <h1>Create User</h1>

            <p>
              Create a portal account and, when the role is Faculty or Program
              Head, create the linked staff profile at the same time.
            </p>
          </div>

          <button
            type="button"
            className="admin-create-user__back"
            onClick={() => navigate("/admin/user/list")}
            disabled={loading}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to User List
          </button>
        </section>

        {error && (
          <div className="admin-create-user__error" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form className="admin-create-user__form" onSubmit={handleSubmit}>
          <section className="admin-create-user__section">
            <header className="admin-create-user__section-header">
              <span className="admin-create-user__section-icon">
                <UserRound size={18} aria-hidden="true" />
              </span>

              <div>
                <span>Account Details</span>
                <h2>User Information</h2>
                <p>Enter the basic information used for the portal account.</p>
              </div>
            </header>

            <div className="admin-create-user__fields">
              <label className="admin-create-user__field">
                <span>
                  Username <em>*</em>
                </span>

                <div className="admin-create-user__input-with-icon">
                  <UserRound size={15} aria-hidden="true" />

                  <input
                    id="create-user-username"
                    type="text"
                    name="username"
                    placeholder="Enter username (e.g. FACULTY01)"
                    value={formData.username}
                    onChange={handleChange}
                    disabled={loading}
                    required
                  />
                </div>

                <small>The username will be saved in uppercase.</small>
              </label>

              <label className="admin-create-user__field">
                <span>
                  Email <em>*</em>
                </span>

                <div className="admin-create-user__input-with-icon">
                  <Mail size={15} aria-hidden="true" />

                  <input
                    id="create-user-email"
                    type="email"
                    name="email"
                    placeholder="Enter PTC email"
                    value={formData.email}
                    onChange={handleChange}
                    disabled={loading}
                    required
                  />
                </div>
              </label>

              <label className="admin-create-user__field admin-create-user__field--wide">
                <span>
                  Role <em>*</em>
                </span>

                <div className="admin-create-user__select-with-icon">
                  <ShieldCheck size={15} aria-hidden="true" />

                  <select
                    id="create-user-role"
                    name="role"
                    value={formData.role}
                    onChange={handleChange}
                    disabled={loading}
                    required
                  >
                    <option value="" disabled>
                      Select user role
                    </option>

                    {USER_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </div>

                <small>
                  Faculty and Program Head roles require a linked staff profile.
                </small>
              </label>
            </div>
          </section>

          {needsStaffProfile && (
            <section className="admin-create-user__section">
              <header className="admin-create-user__section-header">
                <span className="admin-create-user__section-icon">
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
                    This information is stored in the Faculty record and will be
                    shown in the staff member&apos;s portal profile.
                  </p>
                </div>
              </header>

              <div className="admin-create-user__fields">
                <label className="admin-create-user__field">
                  <span>
                    First Name <em>*</em>
                  </span>
                  <input
                    type="text"
                    name="first_name"
                    value={formData.first_name}
                    onChange={handleChange}
                    disabled={loading}
                    placeholder="Enter first name"
                    required
                  />
                </label>

                <label className="admin-create-user__field">
                  <span>Middle Name</span>
                  <input
                    type="text"
                    name="middle_name"
                    value={formData.middle_name}
                    onChange={handleChange}
                    disabled={loading}
                    placeholder="Enter middle name"
                  />
                </label>

                <label className="admin-create-user__field">
                  <span>
                    Last Name <em>*</em>
                  </span>
                  <input
                    type="text"
                    name="last_name"
                    value={formData.last_name}
                    onChange={handleChange}
                    disabled={loading}
                    placeholder="Enter last name"
                    required
                  />
                </label>

                <label className="admin-create-user__field">
                  <span>Gender</span>
                  <select
                    name="gender"
                    value={formData.gender}
                    onChange={handleChange}
                    disabled={loading}
                  >
                    <option value="">Not recorded</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </label>

                <label className="admin-create-user__field">
                  <span>Birth Date</span>
                  <div className="admin-create-user__input-with-icon">
                    <CalendarDays size={15} aria-hidden="true" />
                    <input
                      type="date"
                      name="birth_date"
                      value={formData.birth_date}
                      onChange={handleChange}
                      disabled={loading}
                    />
                  </div>
                </label>

                <label className="admin-create-user__field">
                  <span>Contact Number</span>
                  <input
                    type="tel"
                    name="contact_number"
                    value={formData.contact_number}
                    onChange={handleChange}
                    disabled={loading}
                    placeholder="e.g. 09XXXXXXXXX"
                  />
                </label>

                <label className="admin-create-user__field">
                  <span>
                    Department <em>*</em>
                  </span>
                  <div className="admin-create-user__select-with-icon">
                    <Building2 size={15} aria-hidden="true" />
                    <select
                      name="department_id"
                      value={formData.department_id}
                      onChange={handleChange}
                      disabled={loading || loadingDepartments}
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
                </label>

                <label className="admin-create-user__field">
                  <span>Employment Status</span>
                  <div className="admin-create-user__select-with-icon">
                    <BriefcaseBusiness size={15} aria-hidden="true" />
                    <select
                      name="employment_status"
                      value={formData.employment_status}
                      onChange={handleChange}
                      disabled={loading}
                    >
                      {EMPLOYMENT_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </div>
                </label>

                <label className="admin-create-user__field admin-create-user__field--wide">
                  <span>Hire Date</span>
                  <div className="admin-create-user__input-with-icon">
                    <CalendarDays size={15} aria-hidden="true" />
                    <input
                      type="date"
                      name="hire_date"
                      value={formData.hire_date}
                      onChange={handleChange}
                      disabled={loading}
                    />
                  </div>

                  <small>
                    Employee number is generated automatically by the system.
                  </small>
                </label>
              </div>
            </section>
          )}

          <section className="admin-create-user__section">
            <header className="admin-create-user__section-header">
              <span className="admin-create-user__section-icon">
                <KeyRound size={18} aria-hidden="true" />
              </span>

              <div>
                <span>Credentials</span>
                <h2>Temporary Password</h2>
                <p>Create the initial password for this account.</p>
              </div>
            </header>

            <div className="admin-create-user__fields">
              <label className="admin-create-user__field">
                <span>
                  Password <em>*</em>
                </span>

                <div className="admin-create-user__password">
                  <KeyRound size={15} aria-hidden="true" />

                  <input
                    id="create-user-password"
                    type={showPassword ? "text" : "password"}
                    name="password"
                    placeholder="Create a temporary password"
                    value={formData.password}
                    onChange={handleChange}
                    disabled={loading}
                    minLength={8}
                    required
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    disabled={loading}
                  >
                    {showPassword ? (
                      <EyeOff size={15} aria-hidden="true" />
                    ) : (
                      <Eye size={15} aria-hidden="true" />
                    )}
                  </button>
                </div>

                <small>Use at least 8 characters.</small>
              </label>

              <label className="admin-create-user__field">
                <span>
                  Confirm Password <em>*</em>
                </span>

                <div className="admin-create-user__password">
                  <KeyRound size={15} aria-hidden="true" />

                  <input
                    id="create-user-confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    name="confirmPassword"
                    placeholder="Re-enter the temporary password"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    disabled={loading}
                    minLength={8}
                    required
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setShowConfirmPassword((current) => !current)
                    }
                    aria-label={
                      showConfirmPassword
                        ? "Hide confirm password"
                        : "Show confirm password"
                    }
                    disabled={loading}
                  >
                    {showConfirmPassword ? (
                      <EyeOff size={15} aria-hidden="true" />
                    ) : (
                      <Eye size={15} aria-hidden="true" />
                    )}
                  </button>
                </div>
              </label>
            </div>

            <div className="admin-create-user__credential-note">
              <ShieldCheck size={17} aria-hidden="true" />
              <div>
                <strong>Temporary credential</strong>
                <p>
                  The user should change this password after their first login.
                </p>
              </div>
            </div>
          </section>

          <footer className="admin-create-user__actions">
            <button
              type="button"
              className="admin-create-user__cancel"
              onClick={() => navigate("/admin/user/list")}
              disabled={loading}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="admin-create-user__submit"
              disabled={loading || !authenticated || userRole !== "Admin"}
            >
              {loading ? (
                <LoaderCircle
                  size={16}
                  className="admin-create-user__spinner"
                  aria-hidden="true"
                />
              ) : (
                <UserPlus size={16} aria-hidden="true" />
              )}

              {loading ? "Creating..." : "Create User"}
            </button>
          </footer>
        </form>
      </main>
    </DashboardLayout>
  );
}