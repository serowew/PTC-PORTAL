import { useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/createuser.css";

const API_BASE_URL = "http://localhost:3000/api/users";

const ROLE_MAP: Record<string, number> = {
  Admin: 1,
  Faculty: 2,
  Student: 3,
  "Program Head": 4,
  Registrar: 5,
};
export default function CreateUser() {
  const navigate = useNavigate();
  const session = authService.getSession();

  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!session || session.role !== "Admin") {
    navigate("/login");
    return null;
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setError("");

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(API_BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: formData.username.trim().toUpperCase(),
          email: formData.email.trim().toLowerCase(),
          password: formData.password,
          role_id: ROLE_MAP[formData.role],
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error);
      }

      alert("User created successfully.");

      navigate("/admin/user/list");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="create-user">
        <h1>Create User</h1>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>

            <input
              type="text"
              name="username"
              placeholder="Enter username (e.g. faculty01)"
              value={formData.username}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label>Email</label>

            <input
              type="email"
              name="email"
              placeholder="Enter PTC email (e.g. faculty01@ptc.edu.ph)"
              value={formData.email}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label>Role</label>
            <select
              name="role"
              value={formData.role}
              onChange={handleChange}
              required
            >
              <option value="" disabled>
                Select user role
              </option>

              <option value="Admin">Admin</option>
              <option value="Registrar">Registrar</option>
              <option value="Faculty">Faculty</option>
              <option value="Program Head">Program Head</option>
            </select>
          </div>

          <div className="form-group">
            <label>Password</label>

            <input
              type="password"
              name="password"
              placeholder="Create a temporary password"
              value={formData.password}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label>Confirm Password</label>

            <input
              type="password"
              name="confirmPassword"
              placeholder="Re-enter the temporary password"
              value={formData.confirmPassword}
              onChange={handleChange}
              required
            />
          </div>
          <small className="form-hint">
            The user should change this password after their first login.
          </small>
          {error && <p className="error-message">{error}</p>}

          <div className="button-group">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate("/admin/user/list")}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? "Creating..." : "Create User"}
            </button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
