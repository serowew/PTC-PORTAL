import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { authService } from "../../services/auth.service";
import styles from "../../styles/auth.module.css";

export default function ResetPasswordForm() {
  const navigate = useNavigate();

  const [requestId, setRequestId] = useState("");
  const [resetToken, setResetToken] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] =
    useState("");

  const [showPassword, setShowPassword] =
    useState(false);

  const [showConfirmPassword, setShowConfirmPassword] =
    useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const storedRequestId =
      sessionStorage.getItem(
        "password_reset_request_id",
      ) || "";

    const storedResetToken =
      sessionStorage.getItem(
        "password_reset_token",
      ) || "";

    const verified =
      sessionStorage.getItem(
        "password_reset_verified",
      ) === "true";

    /*
      The user must have successfully completed
      OTP verification before reaching this page.
    */
    if (
      !storedRequestId ||
      !storedResetToken ||
      !verified
    ) {
      navigate("/forgot-password", {
        replace: true,
      });

      return;
    }

    setRequestId(storedRequestId);
    setResetToken(storedResetToken);
  }, [navigate]);

  function validatePassword() {
    if (!newPassword) {
      return "New password is required.";
    }

    if (newPassword.length < 8) {
      return "Password must be at least 8 characters long.";
    }

    if (confirmPassword !== newPassword) {
      return "Passwords do not match.";
    }

    return "";
  }

  async function handleSubmit(
    e: React.FormEvent<HTMLFormElement>,
  ) {
    e.preventDefault();

    if (loading || success) {
      return;
    }

    setError("");

    const validationError =
      validatePassword();

    if (validationError) {
      setError(validationError);
      return;
    }

    if (!requestId || !resetToken) {
      setError(
        "Your password reset session is no longer valid. Please start again.",
      );

      return;
    }

    setLoading(true);

    try {
      await authService.resetPassword(
        requestId,
        resetToken,
        newPassword,
      );

      /*
        The reset request is now consumed.

        Remove all temporary recovery information
        so the reset token cannot accidentally be
        reused by the frontend.
      */
      sessionStorage.removeItem(
        "password_reset_request_id",
      );

      sessionStorage.removeItem(
        "password_reset_username",
      );

      sessionStorage.removeItem(
        "password_reset_verified",
      );

      sessionStorage.removeItem(
        "password_reset_token",
      );

      setSuccess(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to reset your password.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleBackToLogin() {
    /*
      Clear recovery state before returning
      to the Login page.
    */
    sessionStorage.removeItem(
      "password_reset_request_id",
    );

    sessionStorage.removeItem(
      "password_reset_username",
    );

    sessionStorage.removeItem(
      "password_reset_verified",
    );

    sessionStorage.removeItem(
      "password_reset_token",
    );

    navigate("/login", {
      replace: true,
    });
  }

  if (!requestId || !resetToken) {
    return null;
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
              Create a new secure password for your
              account.
            </p>
          </div>
        </div>

        {/* ==========================================
            RIGHT PANEL
        ========================================== */}

        <div className={styles.authright}>
          {!success ? (
            <>
              <div className={styles.resetIcon}>
                <ShieldCheck size={30} />
              </div>

              <h2>Reset Password</h2>

              <p>
                Create a new password for your PTC
                Portal account.
              </p>

              <form onSubmit={handleSubmit}>
                {/* ==================================
                    NEW PASSWORD
                ================================== */}

                <div className={styles.inputgroup}>
                  <input
                    id="new-password"
                    type={
                      showPassword
                        ? "text"
                        : "password"
                    }
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(
                        e.target.value,
                      );

                      if (error) {
                        setError("");
                      }
                    }}
                    autoComplete="new-password"
                    disabled={loading}
                    placeholder=" "
                  />

                  <label htmlFor="new-password">
                    New Password
                  </label>

<span
  className={`${styles.inputIcon} ${styles.passwordLockIcon}`}
>
                    <LockKeyhole
                      size={18}
                      aria-hidden="true"
                    />
                  </span>

                  <button
                    type="button"
                    className={
                      styles.passwordToggle
                    }
                    onClick={() =>
                      setShowPassword(
                        (current) =>
                          !current,
                      )
                    }
                    disabled={loading}
                    aria-label={
                      showPassword
                        ? "Hide password"
                        : "Show password"
                    }
                  >
                    {showPassword ? (
                      <EyeOff
                        size={18}
                      />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>

                {/* ==================================
                    PASSWORD REQUIREMENT
                ================================== */}

                <div
                  className={
                    styles.passwordHint
                  }
                >
                  Password must contain at least
                  8 characters.
                </div>

                {/* ==================================
                    CONFIRM PASSWORD
                ================================== */}

                <div className={styles.inputgroup}>
                  <input
                    id="confirm-password"
                    type={
                      showConfirmPassword
                        ? "text"
                        : "password"
                    }
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(
                        e.target.value,
                      );

                      if (error) {
                        setError("");
                      }
                    }}
                    autoComplete="new-password"
                    disabled={loading}
                    placeholder=" "
                  />

                  <label htmlFor="confirm-password">
                    Confirm Password
                  </label>

<span
  className={`${styles.inputIcon} ${styles.passwordLockIcon}`}
>
    
                    <LockKeyhole
                      size={18}
                      aria-hidden="true"
                    />
                  </span>

                  <button
                    type="button"
                    className={
                      styles.passwordToggle
                    }
                    onClick={() =>
                      setShowConfirmPassword(
                        (current) =>
                          !current,
                      )
                    }
                    disabled={loading}
                    aria-label={
                      showConfirmPassword
                        ? "Hide password"
                        : "Show password"
                    }
                  >
                    {showConfirmPassword ? (
                      <EyeOff
                        size={18}
                      />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>

                {error && (
                  <p
                    className={
                      styles.errorMsg
                    }
                    aria-live="polite"
                  >
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={
                    loading ||
                    !newPassword ||
                    !confirmPassword
                  }
                  className={`${styles.submitBtn} ${
                    loading
                      ? styles.loading
                      : ""
                  }`}
                >
                  {loading
                    ? "Resetting Password..."
                    : "Reset Password"}
                </button>
              </form>

              <div
                className={
                  styles.authlinks
                }
              >
                <button
                  type="button"
                  onClick={
                    handleBackToLogin
                  }
                  disabled={loading}
                >
                  <ArrowLeft size={15} />
                  Back to Login
                </button>
              </div>
            </>
          ) : (
            /* ======================================
               SUCCESS STATE
            ====================================== */

            <div
              className={
                styles.resetSuccess
              }
            >
              <div
                className={
                  styles.resetSuccessIcon
                }
              >
                <ShieldCheck
                  size={36}
                />
              </div>

              <h2>
                Password Reset Successful
              </h2>

              <p>
                Your password has been changed
                successfully. You can now log in
                using your new password.
              </p>

              <button
                type="button"
                className={
                  styles.submitBtn
                }
                onClick={
                  handleBackToLogin
                }
              >
                Back to Login
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}