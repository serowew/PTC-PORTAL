import { useState } from "react";
import { ArrowLeft, Mail, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { authService } from "../../services/auth.service";

import styles from "../../styles/auth.module.css";

export default function ForgotPasswordForm() {
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(
    e: React.FormEvent<HTMLFormElement>,
  ) {
    e.preventDefault();

    if (loading) {
      return;
    }

    setError("");

    const cleanUsername = username.trim();

    if (!cleanUsername) {
      setError(
        "Username / Student Number is required.",
      );

      return;
    }

    setLoading(true);

    try {
      const response =
        await authService.forgotPassword(
          cleanUsername,
        );

      /*
        Save the request ID temporarily.

        This is NOT an authenticated session.
        It only belongs to the password recovery flow.
      */
      sessionStorage.setItem(
        "password_reset_request_id",
        response.requestId,
      );

      /*
        Save the username only for the recovery UI.
      */
      sessionStorage.setItem(
        "password_reset_username",
        cleanUsername,
      );

      navigate("/forgot-password/verify", {
        replace: true,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to send the verification code.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.authPage}>
      <div
        className={`${styles.authcard} ${styles.fadeIn}`}
      >
        {/* ==========================================
            LEFT PANEL
        ========================================== */}

        <div className={styles.authleft}>
          <div>
            <h2>PTC Portal</h2>

            <p>
              Recover your account securely and
              create a new password.
            </p>
          </div>
        </div>

        {/* ==========================================
            RIGHT PANEL
        ========================================== */}

        <div className={styles.authright}>
          <div className={styles.resetIcon}>
            <ShieldCheck size={30} />
          </div>

          <h2>Forgot Password?</h2>

          <p>
            Enter your username or student number.
            We will send a verification code to your
            registered email address.
          </p>

          <form onSubmit={handleSubmit}>
            <div className={styles.inputgroup}>
              <input
                id="forgot-password-username"
                type="text"
                value={username}
                onChange={(e) =>
                  setUsername(e.target.value)
                }
                autoComplete="username"
                disabled={loading}
                placeholder=" "
              />

              <label htmlFor="forgot-password-username">
                Username / Student Number
              </label>

              <span className={styles.inputIcon}>
                <Mail size={18} aria-hidden="true" />
              </span>
            </div>

            {error && (
              <p
                className={styles.errorMsg}
                aria-live="polite"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={
                loading ||
                !username.trim()
              }
              className={`${styles.submitBtn} ${
                loading
                  ? styles.loading
                  : ""
              }`}
            >
              {loading
                ? "Sending Code..."
                : "Send Verification Code"}
            </button>
          </form>

          <div className={styles.authlinks}>
            <button
              type="button"
              onClick={() => navigate("/login")}
              disabled={loading}
            >
              <ArrowLeft size={15} />
              Back to Login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}