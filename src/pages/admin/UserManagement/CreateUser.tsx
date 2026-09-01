import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/createuser.css";

const API_BASE_URL = "http://localhost:3000/api/users";

const DEPARTMENT_OPTIONS_URL = `${API_BASE_URL}/departments/options`;

/*
|--------------------------------------------------------------------------
| TYPES
|--------------------------------------------------------------------------
*/

interface CreateUserResponse {
  success?: boolean;
  user_id?: number;
  faculty_id?: number | null;
  employee_number?: string | null;
  message?: string;
  error?: string;
}

interface Department {
  department_id: number;
  department_code: string;
  department_name: string;
}

interface DepartmentResponse {
  success?: boolean;
  departments?: Department[];
  message?: string;
  error?: string;
}

/*
|--------------------------------------------------------------------------
| ROLES
|--------------------------------------------------------------------------
*/

const USER_ROLES = [
  "Admin",
  "Registrar",
  "Faculty",
  "Program Head",
  "Student",
] as const;

type UserRoleOption = (typeof USER_ROLES)[number];

/*
|--------------------------------------------------------------------------
| COMPONENT
|--------------------------------------------------------------------------
*/

export default function CreateUser() {
  const navigate = useNavigate();

  /*
  |--------------------------------------------------------------------------
  | AUTH
  |--------------------------------------------------------------------------
  */

  const session = authService.getSession();
  const token = authService.getToken();

  const userRole = session?.role;
  const authenticated = Boolean(session && token);

  /*
  |--------------------------------------------------------------------------
  | FORM STATE
  |--------------------------------------------------------------------------
  */

  const [formData, setFormData] = useState({
    username: "",
    email: "",

    first_name: "",
    middle_name: "",
    last_name: "",

    role: "",
    department_id: "",

    password: "",
    confirmPassword: "",
  });

  const [departments, setDepartments] = useState<Department[]>([]);

  const [loading, setLoading] = useState(false);

  const [departmentsLoading, setDepartmentsLoading] = useState(false);

  const [error, setError] = useState("");

  /*
  |--------------------------------------------------------------------------
  | DERIVED
  |--------------------------------------------------------------------------
  */

  const requiresFacultyProfile =
    formData.role === "Faculty" || formData.role === "Program Head";

  /*
  |--------------------------------------------------------------------------
  | AUTHORIZATION
  |--------------------------------------------------------------------------
  */

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

  /*
  |--------------------------------------------------------------------------
  | LOAD DEPARTMENTS
  |--------------------------------------------------------------------------
  */

  useEffect(() => {
    if (!authenticated || userRole !== "Admin") {
      return;
    }

    const controller = new AbortController();

    const loadDepartments = async () => {
      try {
        setDepartmentsLoading(true);

        const response = await authService.authFetch(DEPARTMENT_OPTIONS_URL, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });

        const contentType = response.headers.get("content-type") || "";

        let data: DepartmentResponse | null = null;

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
              "You are not authorized to load departments.",
          );
        }

        if (!response.ok) {
          throw new Error(
            data?.message ||
              data?.error ||
              `Failed to load departments (${response.status}).`,
          );
        }

        setDepartments(
          Array.isArray(data?.departments) ? data.departments : [],
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        console.error("LOAD DEPARTMENTS ERROR:", err);

        setError(
          err instanceof Error ? err.message : "Failed to load departments.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setDepartmentsLoading(false);
        }
      }
    };

    void loadDepartments();

    return () => {
      controller.abort();
    };
  }, [authenticated, userRole, navigate]);

  /*
  |--------------------------------------------------------------------------
  | INPUT CHANGE
  |--------------------------------------------------------------------------
  */

  const handleChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = event.target;

    /*
    |--------------------------------------------------------------------------
    | ROLE CHANGE
    |--------------------------------------------------------------------------
    |
    | If Admin selects a role that does not use a
    | faculty profile, remove department/person fields.
    |
    */

    if (name === "role") {
      const newRole = value;

      const needsFacultyProfile =
        newRole === "Faculty" || newRole === "Program Head";

      setFormData((previous) => ({
        ...previous,
        role: newRole,

        ...(needsFacultyProfile
          ? {}
          : {
              first_name: "",
              middle_name: "",
              last_name: "",
              department_id: "",
            }),
      }));

      setError("");

      return;
    }

    setFormData((previous) => ({
      ...previous,
      [name]: value,
    }));

    setError("");
  };

  /*
  |--------------------------------------------------------------------------
  | SUBMIT
  |--------------------------------------------------------------------------
  */

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setError("");

    /*
    |--------------------------------------------------------------------------
    | AUTH
    |--------------------------------------------------------------------------
    */

    if (!authenticated || userRole !== "Admin") {
      setError(
        "Your session has expired or you are not authorized to create users.",
      );

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | CLEAN VALUES
    |--------------------------------------------------------------------------
    */

    const username = formData.username.trim().toUpperCase();

    const email = formData.email.trim().toLowerCase();

    const role = formData.role.trim();

    const firstName = formData.first_name.trim();

    const middleName = formData.middle_name.trim();

    const lastName = formData.last_name.trim();

    const password = formData.password;

    const confirmPassword = formData.confirmPassword;

    /*
    |--------------------------------------------------------------------------
    | VALIDATION
    |--------------------------------------------------------------------------
    */

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

    if (!USER_ROLES.includes(role as UserRoleOption)) {
      setError("Invalid user role.");
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) {
      setError("Please enter a valid email address.");

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | FACULTY / PROGRAM HEAD VALIDATION
    |--------------------------------------------------------------------------
    */

    if (requiresFacultyProfile) {
      if (!firstName) {
        setError("First name is required for Faculty and Program Head.");

        return;
      }

      if (!lastName) {
        setError("Last name is required for Faculty and Program Head.");

        return;
      }

      if (!formData.department_id) {
        setError("Please select a department.");

        return;
      }

      const departmentId = Number(formData.department_id);

      if (!Number.isInteger(departmentId) || departmentId <= 0) {
        setError("Please select a valid department.");

        return;
      }
    }

    /*
    |--------------------------------------------------------------------------
    | PASSWORD
    |--------------------------------------------------------------------------
    */

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");

      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");

      return;
    }

    try {
      setLoading(true);

      /*
      |--------------------------------------------------------------------------
      | PAYLOAD
      |--------------------------------------------------------------------------
      |
      | Do NOT send role_id.
      |
      | Backend resolves role_id using role name.
      |
      */

      const payload = {
        username,
        email,
        password,
        role,

        first_name: requiresFacultyProfile ? firstName : null,

        middle_name: requiresFacultyProfile && middleName ? middleName : null,

        last_name: requiresFacultyProfile ? lastName : null,

        department_id: requiresFacultyProfile
          ? Number(formData.department_id)
          : null,
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

      /*
      |--------------------------------------------------------------------------
      | AUTH ERRORS
      |--------------------------------------------------------------------------
      */

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
            "You are not authorized to create users.",
        );
      }

      /*
      |--------------------------------------------------------------------------
      | HTTP ERROR
      |--------------------------------------------------------------------------
      */

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to create user (${response.status}).`,
        );
      }

      /*
      |--------------------------------------------------------------------------
      | SUCCESS
      |--------------------------------------------------------------------------
      */

      let successMessage = data?.message || "User created successfully.";

      if (data?.employee_number) {
        successMessage += `\nEmployee Number: ${data.employee_number}`;
      }

      window.alert(successMessage);

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

  /*
  |--------------------------------------------------------------------------
  | AUTH GUARD
  |--------------------------------------------------------------------------
  */

  if (!authenticated || !session || userRole !== "Admin") {
    return null;
  }

  /*
  |--------------------------------------------------------------------------
  | RENDER
  |--------------------------------------------------------------------------
  */

  return (
    <DashboardLayout>
      <div className="create-user">
        <h1>Create User</h1>

        <form onSubmit={handleSubmit}>
          {/* USERNAME */}

          <div className="form-group">
            <label htmlFor="create-user-username">Username</label>

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

          {/* EMAIL */}

          <div className="form-group">
            <label htmlFor="create-user-email">Email</label>

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

          {/* ROLE */}

          <div className="form-group">
            <label htmlFor="create-user-role">Role</label>

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

              {USER_ROLES.map((roleOption) => (
                <option key={roleOption} value={roleOption}>
                  {roleOption}
                </option>
              ))}
            </select>
          </div>

          {/* FACULTY / PROGRAM HEAD INFORMATION */}

          {requiresFacultyProfile && (
            <>
              <div className="form-group">
                <label htmlFor="create-user-first-name">First Name</label>

                <input
                  id="create-user-first-name"
                  type="text"
                  name="first_name"
                  placeholder="Enter first name"
                  value={formData.first_name}
                  onChange={handleChange}
                  disabled={loading}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="create-user-middle-name">Middle Name</label>

                <input
                  id="create-user-middle-name"
                  type="text"
                  name="middle_name"
                  placeholder="Enter middle name (optional)"
                  value={formData.middle_name}
                  onChange={handleChange}
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label htmlFor="create-user-last-name">Last Name</label>

                <input
                  id="create-user-last-name"
                  type="text"
                  name="last_name"
                  placeholder="Enter last name"
                  value={formData.last_name}
                  onChange={handleChange}
                  disabled={loading}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="create-user-department">Department</label>

                <select
                  id="create-user-department"
                  name="department_id"
                  value={formData.department_id}
                  onChange={handleChange}
                  disabled={loading || departmentsLoading}
                  required
                >
                  <option value="" disabled>
                    {departmentsLoading
                      ? "Loading departments..."
                      : "Select department"}
                  </option>

                  {departments.map((department) => (
                    <option
                      key={department.department_id}
                      value={department.department_id}
                    >
                      {department.department_code} -{" "}
                      {department.department_name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* PASSWORD */}

          <div className="form-group">
            <label htmlFor="create-user-password">Password</label>

            <input
              id="create-user-password"
              type="password"
              name="password"
              placeholder="Create a temporary password"
              value={formData.password}
              onChange={handleChange}
              disabled={loading}
              minLength={8}
              required
            />
          </div>

          {/* CONFIRM PASSWORD */}

          <div className="form-group">
            <label htmlFor="create-user-confirm-password">
              Confirm Password
            </label>

            <input
              id="create-user-confirm-password"
              type="password"
              name="confirmPassword"
              placeholder="Re-enter the temporary password"
              value={formData.confirmPassword}
              onChange={handleChange}
              disabled={loading}
              minLength={8}
              required
            />
          </div>

          <small className="form-hint">
            The user should change this password after their first login.
          </small>

          {/* ERROR */}

          {error && <p className="error-message">{error}</p>}

          {/* ACTIONS */}

          <div className="button-group">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate("/admin/user/list")}
              disabled={loading}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                loading ||
                departmentsLoading ||
                !authenticated ||
                userRole !== "Admin"
              }
            >
              {loading ? "Creating..." : "Create User"}
            </button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
