import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authService } from "../../services/auth.service";
import styles from "../../styles/auth.module.css";

export default function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setError("");
    setLoading(true);

    try {
      await authService.login(username, password);

      authService.savePendingUsername(username);
      navigate("/otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.authcard}>
      <div className={styles.authleft}>
        <h2>Welcome Back</h2>
        <p>Login to access your portal dashboard.</p>
      </div>

      <div className={styles.authright}>
        <h2>Login</h2>

        <form onSubmit={handleSubmit}>
          <div className={styles.inputgroup}>
            <label>Student Number / Username</label>

            <input
              type="text"
              placeholder="26BSIT-0001"
              value={username}
              onChange={(e) => setUsername(e.target.value.toUpperCase())}
              required
            />
          </div>

          <div className={styles.inputgroup}>
            <label>Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p style={{ color: "red", fontSize: "13px", marginBottom: "8px" }}>
              {error}
            </p>
          )}

          <button type="submit" disabled={loading}>
            {loading ? "Verifying..." : "Login"}
          </button>
        </form>

        <div className={styles.authlinks}>
          <a href="/register">Create an account</a>
          <a href="#">Forgot password?</a>
        </div>
        <div style={{ marginTop: "20px" }}>
          <h4>Development Access</h4>

          {/* ADMIN */}
          <button
            type="button"
            onClick={() => {
              authService.saveSession({
                user_id: 1,
                username: "admin",
                email: "admin@ptc.edu.ph",
                role: "Admin",
                role_id: 1,
              });

              navigate("/admin/dashboard");
            }}
          >
            Login as Admin
          </button>

          {/* REGISTRAR */}
          <button
            type="button"
            onClick={() => {
              authService.saveSession({
                user_id: 2,
                username: "registrar",
                email: "registrar@ptc.edu.ph",
                role: "Registrar",
                role_id: 2,
              });

              navigate("/registrar/dashboard");
            }}
            style={{ marginLeft: "10px" }}
          >
            Login as Registrar
          </button>

          {/* PROGRAM HEAD */}
          <button
            type="button"
            onClick={() => {
              authService.saveSession({
                user_id: 3,
                username: "proghead",
                email: "proghead@ptc.edu.ph",
                role: "Program Head",
                role_id: 3,
              });

              navigate("/programhead/dashboard");
            }}
            style={{ marginLeft: "10px" }}
          >
            Login as Program Head
          </button>

          {/* FACULTY */}
          <button
            type="button"
            onClick={() => {
              authService.saveSession({
                user_id: 4,
                username: "faculty",
                email: "faculty@ptc.edu.ph",
                role: "Faculty",
                role_id: 4,
              });

              navigate("/faculty/dashboard");
            }}
            style={{ marginLeft: "10px" }}
          >
            Login as Faculty
          </button>

          {/* STUDENT */}
          <button
            type="button"
            onClick={() => {
              authService.saveSession({
                user_id: 5,
                username: "student",
                email: "student@ptc.edu.ph",
                role: "Student",
                role_id: 5,
              });

              navigate("/student/dashboard");
            }}
            style={{ marginLeft: "10px" }}
          >
            Login as Student
          </button>
        </div>
      </div>
    </div>
  );
}
