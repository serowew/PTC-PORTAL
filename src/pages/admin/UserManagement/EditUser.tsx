import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/createuser.css";

const API_BASE_URL = "http://localhost:3000/api/users";

const DEPARTMENT_OPTIONS_URL = `${API_BASE_URL}/departments/options`;

const USER_ROLES = [
  "Admin",
  "Registrar",
  "Faculty",
  "Program Head",
  "Student",
] as const;

/*
|--------------------------------------------------------------------------
| TYPES
|--------------------------------------------------------------------------
*/

type UserForm = {
  username: string;
  email: string;

  first_name: string;
  middle_name: string;
  last_name: string;

  role: string;
  department_id: string;

  is_active: boolean;
};

interface UserResponse {
  user_id?: number;

  username?: string;
  email?: string;

  role_id?: number;
  role?: string;

  is_active?: boolean;
  is_verified?: boolean;

  faculty_id?: number | null;
  employee_number?: string | null;

  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;

  department_id?: number | null;
  department_code?: string | null;
  department_name?: string | null;

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
| COMPONENT
|--------------------------------------------------------------------------
*/

export default function EditUser() {
  const navigate = useNavigate();

  const { id } = useParams<{
    id: string;
  }>();

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
  | STATE
  |--------------------------------------------------------------------------
  */

  const [formData, setFormData] = useState<UserForm>({
    username: "",
    email: "",

    first_name: "",
    middle_name: "",
    last_name: "",

    role: "",
    department_id: "",

    is_active: true,
  });

  const [employeeNumber, setEmployeeNumber] = useState("");

  const [departments, setDepartments] = useState<Department[]>([]);

  const [loading, setLoading] = useState(true);

  const [departmentsLoading, setDepartmentsLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");

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

        setErrorMessage(
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
  | LOAD USER
  |--------------------------------------------------------------------------
  */

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

          navigate("/login", {
            replace: true,
          });

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

          first_name: String(loadedUser.first_name ?? ""),

          middle_name: String(loadedUser.middle_name ?? ""),

          last_name: String(loadedUser.last_name ?? ""),

          role: String(loadedUser.role ?? ""),

          department_id: loadedUser.department_id
            ? String(loadedUser.department_id)
            : "",

          is_active: Boolean(loadedUser.is_active),
        });

        setEmployeeNumber(String(loadedUser.employee_number ?? ""));
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

  /*
  |--------------------------------------------------------------------------
  | INPUT CHANGE
  |--------------------------------------------------------------------------
  */

  const handleChange = (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = event.target;

    if (name === "is_active") {
      setFormData((current) => ({
        ...current,
        is_active: value === "true",
      }));

      setErrorMessage("");

      return;
    }

    if (name === "role") {
      setFormData((current) => ({
        ...current,
        role: value,
      }));

      setErrorMessage("");

      return;
    }

    setFormData((current) => ({
      ...current,
      [name]: value,
    }));

    setErrorMessage("");
  };

  /*
  |--------------------------------------------------------------------------
  | SUBMIT
  |--------------------------------------------------------------------------
  */

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    setErrorMessage("");

    /*
    |--------------------------------------------------------------------------
    | AUTH
    |--------------------------------------------------------------------------
    */

    if (!authenticated || userRole !== "Admin") {
      setErrorMessage(
        "Your session has expired or you are not authorized to update users.",
      );

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | USER ID
    |--------------------------------------------------------------------------
    */

    const userId = Number(id);

    if (!Number.isInteger(userId) || userId <= 0) {
      setErrorMessage("Invalid user ID.");

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

    /*
    |--------------------------------------------------------------------------
    | BASIC VALIDATION
    |--------------------------------------------------------------------------
    */

    if (!username || !email || !role) {
      setErrorMessage("Please fill in all required fields.");

      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) {
      setErrorMessage("Please enter a valid email address.");

      return;
    }

    /*
    |--------------------------------------------------------------------------
    | FACULTY / PROGRAM HEAD VALIDATION
    |--------------------------------------------------------------------------
    */

    if (requiresFacultyProfile) {
      if (!firstName) {
        setErrorMessage("First name is required for Faculty and Program Head.");

        return;
      }

      if (!lastName) {
        setErrorMessage("Last name is required for Faculty and Program Head.");

        return;
      }

      if (!formData.department_id) {
        setErrorMessage("Please select a department.");

        return;
      }

      const departmentId = Number(formData.department_id);

      if (!Number.isInteger(departmentId) || departmentId <= 0) {
        setErrorMessage("Please select a valid department.");

        return;
      }
    }

    /*
    |--------------------------------------------------------------------------
    | SAVE
    |--------------------------------------------------------------------------
    */

    try {
      setSaving(true);

      const payload = {
        username,
        email,
        role,

        is_active: formData.is_active,

        first_name: requiresFacultyProfile ? firstName : null,

        middle_name: requiresFacultyProfile && middleName ? middleName : null,

        last_name: requiresFacultyProfile ? lastName : null,

        department_id: requiresFacultyProfile
          ? Number(formData.department_id)
          : null,
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

        navigate("/login", {
          replace: true,
        });

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
  | LOADING
  |--------------------------------------------------------------------------
  */

  if (loading) {
    return (
      <DashboardLayout>
        <div className="create-user">
          <h2>Loading user...</h2>
        </div>
      </DashboardLayout>
    );
  }

  /*
  |--------------------------------------------------------------------------
  | RENDER
  |--------------------------------------------------------------------------
  */

  return (
    <DashboardLayout>
      <div className="create-user">
        <h1>Edit User</h1>

        {errorMessage && <div className="error-message">{errorMessage}</div>}

        <form onSubmit={handleSubmit}>
          {/* USERNAME */}

          <div className="form-group">
            <label htmlFor="edit-username">Username</label>

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

          {/* EMAIL */}

          <div className="form-group">
            <label htmlFor="edit-email">Email</label>

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

          {/* ROLE */}

          <div className="form-group">
            <label htmlFor="edit-role">Role</label>

            <select
              id="edit-role"
              name="role"
              value={formData.role}
              onChange={handleChange}
              disabled={saving}
              required
            >
              <option value="">Select Role</option>

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
              {employeeNumber && (
                <div className="form-group">
                  <label>Employee Number</label>

                  <input type="text" value={employeeNumber} disabled />
                </div>
              )}

              <div className="form-group">
                <label htmlFor="edit-first-name">First Name</label>

                <input
                  id="edit-first-name"
                  type="text"
                  name="first_name"
                  placeholder="Enter first name"
                  value={formData.first_name}
                  onChange={handleChange}
                  disabled={saving}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="edit-middle-name">Middle Name</label>

                <input
                  id="edit-middle-name"
                  type="text"
                  name="middle_name"
                  placeholder="Enter middle name (optional)"
                  value={formData.middle_name}
                  onChange={handleChange}
                  disabled={saving}
                />
              </div>

              <div className="form-group">
                <label htmlFor="edit-last-name">Last Name</label>

                <input
                  id="edit-last-name"
                  type="text"
                  name="last_name"
                  placeholder="Enter last name"
                  value={formData.last_name}
                  onChange={handleChange}
                  disabled={saving}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="edit-department">Department</label>

                <select
                  id="edit-department"
                  name="department_id"
                  value={formData.department_id}
                  onChange={handleChange}
                  disabled={saving || departmentsLoading}
                  required
                >
                  <option value="">
                    {departmentsLoading
                      ? "Loading departments..."
                      : "Select Department"}
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

          {/* STATUS */}

          <div className="form-group">
            <label htmlFor="edit-status">Status</label>

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
          </div>

          {/* ACTIONS */}

          <div className="button-group">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate("/admin/user/list")}
              disabled={saving}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || departmentsLoading}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
