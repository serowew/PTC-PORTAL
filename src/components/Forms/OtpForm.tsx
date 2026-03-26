import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { authService } from "../../services/auth.service";
import styles from "../../styles/auth.module.css";

export default function OtpForm() {
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const email = authService.getPendingEmail();

  // Guard: redirect to login if no pending email
  useEffect(() => {
    if (!email) navigate("/login");
  }, []);

  if (!email) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const currentEmail = authService.getPendingEmail(); // ← read fresh inside the function

    if (!currentEmail) {
      navigate("/login");
      return;
    }

    const user = await authService.verifyOtp(currentEmail, otp); // ← use currentEmail, guaranteed string

    setLoading(false);

    if (!user) {
      setError("Invalid or expired OTP. Please try again.");
      return;
    }

    authService.clearPendingEmail();
    authService.saveSession(user);

    if (user.role === "admin") {
      navigate("/admin/dashboard");
    } else if (user.role === "faculty") {
      navigate("/faculty/dashboard");
    } else {
      navigate("/student/dashboard");
    }
  }

  return (
    <div className={styles.authcard}>
      <div className={styles.authleft}>
        <h2>Check Your Email</h2>
        <p>
          We sent a 6-digit OTP to <strong>{email}</strong>. It expires in 5
          minutes.
        </p>
      </div>

      <div className={styles.authright}>
        <h2>OTP Verification</h2>

        <form onSubmit={handleSubmit}>
          <div className={styles.inputgroup}>
            <label>Enter OTP</label>
            <input
              type="text"
              placeholder="000000"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              required
            />
          </div>

          {error && (
            <p style={{ color: "red", fontSize: "13px", marginBottom: "8px" }}>
              {error}
            </p>
          )}

          <button type="submit" disabled={loading}>
            {loading ? "Verifying..." : "Verify OTP"}
          </button>
        </form>

        <div className={styles.authlinks}>
          <a href="/login">Back to Login</a>
        </div>
      </div>
    </div>
  );
}
