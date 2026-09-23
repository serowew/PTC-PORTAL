import { useEffect, useState } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { authService } from "../../services/auth.service";
import styles from "../../styles/auth.module.css";

const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyResetOtpForm() {
  const navigate = useNavigate();

  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const [requestId, setRequestId] = useState(
    () =>
      sessionStorage.getItem(
        "password_reset_request_id",
      ) || "",
  );

  const username =
    sessionStorage.getItem(
      "password_reset_username",
    ) || "";

  /*
    If the user opens this page directly without
    starting Forgot Password first, send them back.
  */
  useEffect(() => {
    if (!requestId) {
      navigate("/forgot-password", {
        replace: true,
      });
    }
  }, [navigate, requestId]);

  /*
    Resend countdown.
  */
  useEffect(() => {
    if (resendCooldown <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setResendCooldown((current) =>
        current > 0 ? current - 1 : 0,
      );
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [resendCooldown]);

  function handleOtpChange(
    value: string,
  ) {
    /*
      Only allow numbers and limit to 6 digits.
    */
    const numericValue =
      value.replace(/\D/g, "").slice(0, 6);

    setOtp(numericValue);

    if (error) {
      setError("");
    }
  }

  async function handleVerify(
    e: React.FormEvent<HTMLFormElement>,
  ) {
    e.preventDefault();

    if (loading) {
      return;
    }

    setError("");

    if (!requestId) {
      setError(
        "Your password reset session is no longer available.",
      );

      return;
    }

    if (!/^\d{6}$/.test(otp)) {
      setError(
        "Please enter the 6-digit verification code.",
      );

      return;
    }

    setLoading(true);

    try {
      const response =
        await authService.verifyResetOtp(
          requestId,
          otp,
        );

      /*
        Store the temporary reset authorization.
        This is NOT the normal login token.
      */
      sessionStorage.setItem(
        "password_reset_token",
        response.resetToken,
      );

      sessionStorage.setItem(
        "password_reset_verified",
        "true",
      );

      navigate("/reset-password", {
        replace: true,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to verify the code.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (
      resending ||
      loading ||
      resendCooldown > 0 ||
      !requestId
    ) {
      return;
    }

    setError("");
    setResending(true);

    try {
      const response =
        await authService.resendResetOtp(
          requestId,
        );

      /*
        IMPORTANT:
        The backend creates a NEW request ID
        when an OTP is resent.

        Replace the old ID.
      */
      setRequestId(response.requestId);

      sessionStorage.setItem(
        "password_reset_request_id",
        response.requestId,
      );

      setOtp("");

      setResendCooldown(
        RESEND_COOLDOWN_SECONDS,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to resend the verification code.",
      );
    } finally {
      setResending(false);
    }
  }

  function handleBack() {
    /*
      Going back to Forgot Password starts a
      fresh recovery request.
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

    navigate("/forgot-password");
  }

  if (!requestId) {
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
              Verify your identity to securely
              recover your account.
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

          <h2>Verify Your Account</h2>

          <p>
            We sent a 6-digit verification code to
            your registered email address
            {username
              ? ` for ${username}`
              : ""}
            .
          </p>

          <form onSubmit={handleVerify}>
            <div className={styles.inputgroup}>
              <input
                id="password-reset-otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) =>
                  handleOtpChange(
                    e.target.value,
                  )
                }
                disabled={loading}
                maxLength={6}
                placeholder=" "
              />

              <label htmlFor="password-reset-otp">
                Verification Code
              </label>
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
                otp.length !== 6
              }
              className={`${styles.submitBtn} ${
                loading
                  ? styles.loading
                  : ""
              }`}
            >
              {loading
                ? "Verifying..."
                : "Verify Code"}
            </button>
          </form>

          <div className={styles.authlinks}>
            <button
              type="button"
              onClick={handleResend}
              disabled={
                resending ||
                loading ||
                resendCooldown > 0
              }
            >
              {resending
                ? "Sending..."
                : resendCooldown > 0
                  ? `Resend Code (${resendCooldown}s)`
                  : "Didn't receive the code? Resend"}
            </button>

            <button
              type="button"
              onClick={handleBack}
              disabled={
                loading ||
                resending
              }
            >
              <ArrowLeft size={15} />
              Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}