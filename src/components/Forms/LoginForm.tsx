import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authService } from "../../services/auth.service";
import styles from "../../styles/auth.module.css";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const user = authService.login(email, password);

    if (!user) {
      alert("Invalid credentials");
      return;
    }

    authService.saveSession(user);

    // Route each role to their own dashboard
    if (user.role === "admin") {
      navigate("/admin/dashboard");
    } else if (user.role === "faculty") {
      // ← added
      navigate("/faculty/dashboard");
    } else {
      navigate("/student/dashboard");
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
            <label>Email</label>
            <input
              type="email"
              placeholder="r@ptc.edu.ph"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className={styles.inputgroup}>
            <label>Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button type="submit">Login</button>
        </form>

        <div className={styles.authlinks}>
          <a href="/register">Create an account</a>
          <a href="#">Forgot password?</a>
        </div>
      </div>
    </div>
  );
}