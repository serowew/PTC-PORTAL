import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { authService } from "../../services/auth.service";

import styles from "../../styles/auth.module.css";

export default function OtpForm() {
  // =====================================================
  // STATE
  // =====================================================

  const [otp, setOtp] = useState("");

  const [error, setError] = useState("");

  const [loading, setLoading] = useState(false);

  // =====================================================
  // ROUTER
  // =====================================================

  const navigate = useNavigate();

  // =====================================================
  // PENDING LOGIN USERNAME
  //
  // IMPORTANT:
  //
  // Take a snapshot when the OTP page first mounts.
  //
  // Do NOT do this:
  //
  // const username = authService.getPendingUsername();
  //
  // on every render.
  //
  // Why?
  //
  // verifyOtp() clears pending_username after successful
  // authentication. If React renders once more before the
  // browser redirects to the dashboard, reading directly
  // from sessionStorage would return null and the OTP guard
  // could incorrectly redirect back to /login.
  // =====================================================

  const [username] = useState<string | null>(() =>
    authService.getPendingUsername(),
  );

  // =====================================================
  // OTP PAGE GUARD
  // =====================================================

  useEffect(() => {
    if (!username) {
      navigate("/login", {
        replace: true,
      });
    }
  }, [username, navigate]);

  // =====================================================
  // NO PENDING LOGIN
  // =====================================================

  if (!username) {
    return null;
  }

  // =====================================================
  // VERIFY OTP
  // =====================================================

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // =====================================================
    // RESET ERROR
    // =====================================================

    setError("");

    // =====================================================
    // VALIDATE OTP
    // =====================================================

    const cleanOtp = otp.trim();

    if (cleanOtp.length !== 6) {
      setError("Please enter the complete 6-digit OTP.");

      return;
    }

    if (!/^\d{6}$/.test(cleanOtp)) {
      setError("OTP must contain exactly 6 digits.");

      return;
    }

    // =====================================================
    // PREVENT MULTIPLE SUBMISSIONS
    // =====================================================

    if (loading) {
      return;
    }

    setLoading(true);

    // =====================================================
    // REDIRECT FLAG
    //
    // Prevent setLoading(false) from causing another render
    // after successful authentication while the browser is
    // already navigating to the dashboard.
    // =====================================================

    let redirecting = false;

    try {
      // ===================================================
      // CONFIRM THE LOGIN FLOW STILL EXISTS
      // ===================================================

      const currentPendingUsername = authService.getPendingUsername();

      if (!currentPendingUsername) {
        throw new Error("Your login session has expired. Please login again.");
      }

      // ===================================================
      // SAFETY CHECK
      //
      // Make sure the pending username did not somehow
      // change while the OTP page was open.
      // ===================================================

      if (currentPendingUsername !== username) {
        authService.logout();

        throw new Error(
          "The login account changed during OTP verification. Please login again.",
        );
      }

      // ===================================================
      // VERIFY OTP
      //
      // authService.verifyOtp():
      //
      // POST /auth/verify-otp
      //
      // Backend returns:
      //
      // JWT
      // +
      // authenticated user
      //
      // Service then:
      //
      // - validates returned role
      // - removes old user/token
      // - saves NEW JWT
      // - saves NEW user
      // - clears pending_username
      // ===================================================

      const user = await authService.verifyOtp(username, cleanOtp);

      // ===================================================
      // VERIFY SAVED JWT
      // ===================================================

      const savedToken = authService.getToken();

      if (!savedToken) {
        authService.logout();

        throw new Error(
          "Authentication succeeded but the access token was not saved.",
        );
      }

      // ===================================================
      // VERIFY SAVED USER SESSION
      // ===================================================

      const savedSession = authService.getSession();

      if (!savedSession) {
        authService.logout();

        throw new Error(
          "Authentication succeeded but the user session was not saved.",
        );
      }

      // ===================================================
      // VERIFY USER ID
      //
      // The authenticated backend account and saved
      // frontend account must be the same.
      // ===================================================

      if (Number(savedSession.user_id) !== Number(user.user_id)) {
        authService.logout();

        throw new Error("Authentication session mismatch. Please login again.");
      }

      // ===================================================
      // VERIFY USERNAME
      // ===================================================

      if (savedSession.username !== user.username) {
        authService.logout();

        throw new Error("Authenticated username mismatch. Please login again.");
      }

      // ===================================================
      // VERIFY ROLE
      // ===================================================

      if (!user.role) {
        authService.logout();

        throw new Error(
          "Authentication succeeded but the account role was not returned.",
        );
      }

      if (savedSession.role !== user.role) {
        authService.logout();

        throw new Error("Authentication role mismatch. Please login again.");
      }

      // ===================================================
      // GET CORRECT DASHBOARD
      // ===================================================

      const destination = authService.getDashboardRoute(user.role);

      if (!destination) {
        authService.logout();

        throw new Error("No dashboard route is configured for this account.");
      }

      // ===================================================
      // SUCCESS
      // ===================================================

      console.log("=================================");
      console.log("OTP LOGIN SUCCESS");
      console.log("USER ID:", user.user_id);
      console.log("USERNAME:", user.username);
      console.log("ROLE:", user.role);
      console.log("DESTINATION:", destination);
      console.log("TOKEN SAVED:", Boolean(savedToken));
      console.log("=================================");

      // ===================================================
      // FULL PAGE REDIRECT
      //
      // We intentionally use window.location.replace()
      // instead of React Router navigate().
      //
      // This destroys any old React state belonging to a
      // previously logged-in account.
      //
      // sessionStorage remains available after the reload,
      // so the NEW user's JWT/session remains intact.
      // ===================================================

      redirecting = true;

      window.location.replace(destination);

      return;
    } catch (err) {
      console.error("OTP VERIFICATION ERROR:", err);

      setError(
        err instanceof Error
          ? err.message
          : "Invalid or expired OTP. Please try again.",
      );
    } finally {
      // ===================================================
      // DO NOT RENDER AGAIN AFTER SUCCESS
      //
      // This is important.
      //
      // Once dashboard navigation starts, we don't want:
      //
      // setLoading(false)
      //   ↓
      // render OTP component again
      //   ↓
      // guard interference
      //
      // ===================================================

      if (!redirecting) {
        setLoading(false);
      }
    }
  }

  // =====================================================
  // BACK TO LOGIN
  // =====================================================

  function handleBackToLogin() {
    if (loading) {
      return;
    }

    // =====================================================
    // CANCEL INCOMPLETE OTP FLOW
    // =====================================================

    authService.clearPendingUsername();

    navigate("/login", {
      replace: true,
    });
  }

  // =====================================================
  // OTP INPUT
  // =====================================================

  function handleOtpChange(event: React.ChangeEvent<HTMLInputElement>) {
    // Numbers only.
    const numericValue = event.target.value.replace(/\D/g, "").slice(0, 6);

    setOtp(numericValue);

    // Remove previous error while correcting OTP.
    if (error) {
      setError("");
    }
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <div className={styles.authcard}>
      {/* ========================================
          LEFT SIDE
      ======================================== */}

      <div className={styles.authleft}>
        <h2>Check Your Email</h2>

        <p>
          A 6-digit OTP has been sent to the email address associated with your
          account.
          <br />
          <strong>Username: {username}</strong>
        </p>
      </div>

      {/* ========================================
          RIGHT SIDE
      ======================================== */}

      <div className={styles.authright}>
        <h2>OTP Verification</h2>

        <form onSubmit={handleSubmit}>
          {/* ====================================
              OTP INPUT
          ==================================== */}

          <div className={styles.inputgroup}>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder=" "
              maxLength={6}
              value={otp}
              onChange={handleOtpChange}
              disabled={loading}
              required
              autoFocus
            />

            <label>Enter OTP</label>
          </div>

          {/* ====================================
              ERROR MESSAGE
          ==================================== */}

          {error && <p className={styles.errorMsg}>{error}</p>}

          {/* ====================================
              VERIFY BUTTON
          ==================================== */}

          <button
            type="submit"
            disabled={loading || otp.length !== 6}
            className={`${styles.submitBtn} ${loading ? styles.loading : ""}`}
          >
            {loading ? "Verifying..." : "Verify OTP"}
          </button>
        </form>

        {/* ======================================
            BACK TO LOGIN
        ====================================== */}

        <div className={styles.authlinks}>
          <button type="button" onClick={handleBackToLogin} disabled={loading}>
            Back to Login
          </button>
        </div>
      </div>
    </div>
  );
}
