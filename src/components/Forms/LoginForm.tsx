import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authService } from "../../services/auth.service";
import styles from "../../styles/auth.module.css";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await authService.login(email, password);

    setLoading(false);

    if (!result) {
      setError("Invalid email or password.");
      return;
    }

    authService.savePendingEmail(email);
    navigate("/otp");
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
            <label>Email</label>
            <input
              type="email"
              placeholder="r@ptc.edu.ph"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
      </div>
    </div>
  );
}