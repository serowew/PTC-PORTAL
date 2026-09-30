import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";

import { authService } from "../../services/auth.service";

import styles from "../../styles/auth.module.css";

export default function LoginForm() {
  // =====================================================
  // STATE
  // =====================================================

  const showDevLogin = import.meta.env.DEV;

  const [username, setUsername] = useState("");

  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState("");

  const [loading, setLoading] = useState(false);

  const [cooldownSeconds, setCooldownSeconds] = useState(() => {
    return authService.getLoginCooldownRemaining();
  });

  // =====================================================
  // LIVE LOGIN COOLDOWN COUNTDOWN
  // =====================================================

  useEffect(() => {
    const syncCountdown = () => {
      setCooldownSeconds(
        authService.getLoginCooldownRemaining(),
      );
    };

    syncCountdown();

    const intervalId = window.setInterval(
      syncCountdown,
      1000,
    );

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  function formatLoginCooldown(totalSeconds: number) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  const cooldownMessage =
    cooldownSeconds > 0
      ? `Too many failed login attempts. Try again in ${formatLoginCooldown(
          cooldownSeconds,
        )}.`
      : "";

  const displayError = cooldownMessage || error;

  // =====================================================
  // ROUTER
  // =====================================================

  const navigate = useNavigate();

  // =====================================================
  // NORMAL LOGIN
  //
  // Username + Password
  //        ↓
  // Backend validates account
  //        ↓
  // Backend creates OTP
  //        ↓
  // OTP sent to email
  //        ↓
  // pending_username saved by authService.login()
  //        ↓
  // /otp
  // =====================================================

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // =====================================================
    // PREVENT DOUBLE SUBMISSION
    // =====================================================

    if (loading) {
      return;
    }

    // =====================================================
    // RESET
    // =====================================================

    setError("");

    // =====================================================
    // NORMALIZE INPUT
    // =====================================================

    const cleanUsername = username.trim();

    const remainingCooldown =
      authService.getLoginCooldownRemaining();

    if (remainingCooldown > 0) {
      setCooldownSeconds(remainingCooldown);
      setError("");
      return;
    }

    // =====================================================
    // FRONTEND VALIDATION
    // =====================================================

    if (!cleanUsername) {
      setError("Username / Student Number is required.");

      return;
    }

    if (!password) {
      setError("Password is required.");

      return;
    }

    // =====================================================
    // START LOGIN
    // =====================================================

    setLoading(true);

    try {
      // ===================================================
      // LOGIN
      //
      // Updated authService.login() does:
      //
      // 1. Clear OLD user session
      // 2. Clear OLD access token
      // 3. Clear OLD pending username
      // 4. POST /auth/login
      // 5. Backend validates username/password
      // 6. Backend generates/sends OTP
      // 7. Save NEW pending_username
      //
      // IMPORTANT:
      //
      // We DO NOT call:
      //
      // authService.savePendingUsername(...)
      //
      // here anymore.
      // ===================================================

      await authService.login(cleanUsername, password);

      // ===================================================
      // VERIFY OTP SESSION WAS CREATED
      // ===================================================

      const pendingUsername = authService.getPendingUsername();

      if (!pendingUsername) {
        throw new Error(
          "Login succeeded but the OTP session could not be created.",
        );
      }

      // ===================================================
      // ACCOUNT SAFETY CHECK
      //
      // The account waiting for OTP must be exactly the
      // account that just logged in.
      // ===================================================

      if (pendingUsername !== cleanUsername) {
        authService.clearPendingUsername();

        throw new Error("Login session mismatch. Please try again.");
      }

      // ===================================================
      // DEBUG
      // ===================================================

      console.log("=================================");

      console.log("LOGIN STEP 1 SUCCESS");

      console.log("PENDING USERNAME:", pendingUsername);

      console.log("OLD TOKEN REMOVED:", !authService.getToken());

      console.log("OLD USER SESSION REMOVED:", !authService.getSession());

      console.log("NEXT ROUTE:", "/otp");

      console.log("=================================");

      // ===================================================
      // GO TO OTP
      // ===================================================

      navigate("/otp", {
        replace: true,
      });
    } catch (err) {
  console.error("LOGIN ERROR:", err);

  // Clear the incorrect password after a failed login.
  setPassword("");
  setShowPassword(false);

  const remaining =
    authService.getLoginCooldownRemaining();

  if (remaining > 0) {
    setCooldownSeconds(remaining);
    setError("");
  } else {
    setError(
      err instanceof Error
        ? err.message
        : "Login failed.",
    );
  }
} finally {
  setLoading(false);
}
  }

  // =====================================================
  // DEVELOPMENT LOGIN
  //
  // One-click development login.
  //
  // IMPORTANT:
  //
  // This does NOT create a fake frontend session.
  //
  // POST /auth/dev-login
  //
  // Backend:
  //
  // - loads REAL user
  // - loads REAL role
  // - verifies account
  // - creates REAL JWT
  // - returns JWT + user
  //
  // authService.devLogin():
  //
  // - removes previous account
  // - stores NEW JWT
  // - stores NEW user session
  // =====================================================

  async function handleDevLogin(devUsername: string) {
    // =====================================================
    // PREVENT DOUBLE ACTION
    // =====================================================

    if (loading) {
      return;
    }

    setError("");

    setLoading(true);

    try {
      // ===================================================
      // AUTHENTICATE REAL DEVELOPMENT USER
      // ===================================================

      const user = await authService.devLogin(devUsername);

      // ===================================================
      // VERIFY TOKEN
      // ===================================================

      const token = authService.getToken();

      if (!token) {
        authService.logout();

        throw new Error(
          "Development login succeeded but the access token was not saved.",
        );
      }

      // ===================================================
      // VERIFY SESSION
      // ===================================================

      const session = authService.getSession();

      if (!session) {
        authService.logout();

        throw new Error(
          "Development login succeeded but the user session was not saved.",
        );
      }

      // ===================================================
      // USER SAFETY CHECK
      // ===================================================

      if (Number(session.user_id) !== Number(user.user_id)) {
        authService.logout();

        throw new Error("Development authentication session mismatch.");
      }

      // ===================================================
      // ROLE SAFETY CHECK
      // ===================================================

      if (!user.role || session.role !== user.role) {
        authService.logout();

        throw new Error("Development authentication role mismatch.");
      }

      // ===================================================
      // GET DASHBOARD
      // ===================================================

      const destination = authService.getDashboardRoute(user.role);

      if (!destination) {
        authService.logout();

        throw new Error("No dashboard route is configured for this account.");
      }

      // ===================================================
      // DEBUG
      // ===================================================

      console.log("=================================");

      console.log("DEVELOPMENT LOGIN SUCCESS");

      console.log("USER ID:", user.user_id);

      console.log("USERNAME:", user.username);

      console.log("ROLE:", user.role);

      console.log("DESTINATION:", destination);

      console.log("TOKEN SAVED:", Boolean(token));

      console.log("=================================");

      // ===================================================
      // FULL PAGE REDIRECT
      //
      // Use a fresh browser navigation so React state from
      // the previously logged-in account cannot remain.
      // ===================================================

      window.location.replace(destination);
    } catch (err) {
      console.error("DEVELOPMENT LOGIN ERROR:", err);

      setError(
        err instanceof Error ? err.message : "Development login failed.",
      );

      setLoading(false);
    }
  }

  // =====================================================
  // USERNAME CHANGE
  // =====================================================

  function handleUsernameChange(e: React.ChangeEvent<HTMLInputElement>) {
    // =====================================================
    // IMPORTANT
    //
    // Do NOT automatically call:
    //
    // .toUpperCase()
    //
    // Some accounts may use:
    //
    // admin
    // registrar
    // faculty
    // proghead
    //
    // while student numbers may use:
    //
    // 26BSIT-0001
    //
    // Let the backend/database determine the username.
    // =====================================================

    const nextUsername = e.target.value;

    setUsername(nextUsername);

    // IMPORTANT:
    // Changing the username does NOT remove or alter
    // the active login cooldown.
    if (error) {
      setError("");
    }
  }

  // =====================================================
  // PASSWORD CHANGE
  // =====================================================

  function handlePasswordChange(e: React.ChangeEvent<HTMLInputElement>) {
    setPassword(e.target.value);

    if (error) {
      setError("");
    }
  }

  // =====================================================
  // BACK TO HOMEPAGE
  // =====================================================

  function handleBack() {
    if (loading) {
      return;
    }

    navigate("/");
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <div className={styles.authPage}>
      <div className={`${styles.authcard} ${styles.fadeIn}`}>
        {/* ==========================================
            BACK BUTTON
        ========================================== */}

        <button
          type="button"
          className={styles.backBtn}
          onClick={handleBack}
          aria-label="Go back"
          disabled={loading}
        >
          ←
        </button>

        {/* ==========================================
            LEFT SIDE
        ========================================== */}

        <div className={styles.authleft}>
          <h2>Welcome Back</h2>

          <p>Login to access your portal dashboard.</p>
        </div>

        {/* ==========================================
            RIGHT SIDE
        ========================================== */}

        <div className={styles.authright}>
          <h2>Login</h2>

          {/* ========================================
              NORMAL LOGIN
          ======================================== */}

          <form onSubmit={handleSubmit}>
            {/* ======================================
                USERNAME
            ====================================== */}

            <div className={styles.inputgroup}>
              <input
                type="text"
                placeholder=" "
                value={username}
                onChange={handleUsernameChange}
                disabled={loading}
                required
                autoComplete="username"
              />

              <label> Student Number</label>
            </div>

            {/* ======================================
                PASSWORD
            ====================================== */}

            <div className={styles.inputgroup}>
              <input
                type={showPassword ? "text" : "password"}
                placeholder=" "
                value={password}
                onChange={handlePasswordChange}
                disabled={loading}
                required
                autoComplete="current-password"
                style={{ paddingRight: "52px" }}
              />

              <label>Password</label>

              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                disabled={loading}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                style={{
                  position: "absolute",
                  top: "50%",
                  right: "12px",
                  transform: "translateY(-50%)",
                  width: "34px",
                  height: "34px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  border: 0,
                  borderRadius: "7px",
                  background: "transparent",
                  color: "#52645a",
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.55 : 1,
                  zIndex: 2,
                }}
              >
                {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
              </button>
            </div>

            {/* ======================================
                ERROR
            ====================================== */}

            {displayError && (
              <p
                key={displayError}
                className={styles.errorMsg}
                aria-live="polite"
              >
                {displayError}
              </p>
            )}

            {/* ======================================
                LOGIN BUTTON
            ====================================== */}

            <button
              type="submit"
              disabled={
                loading ||
                cooldownSeconds > 0 ||
                !username.trim() ||
                !password
              }
              className={`${styles.submitBtn} ${loading ? styles.loading : ""}`}
            >
              {loading
                ? "Sending OTP..."
                : cooldownSeconds > 0
                  ? `Try again in ${formatLoginCooldown(
                      cooldownSeconds,
                    )}`
                  : "Login"}
            </button>
          </form>

          {/* ========================================
              FORGOT PASSWORD
          ======================================== */}

            <div className={styles.authlinks}>
              <button
                type="button"
                onClick={() => navigate("/forgot-password")}
                disabled={loading}
              >
                Forgot password?
              </button>
            </div>

        {/* ========================================
    DEVELOPMENT LOGIN
======================================== */}

{showDevLogin && (
  <div
    style={{
      marginTop: "20px",
    }}
  >
    <h4>
      For Development Access
    </h4>

    <div className={styles.devButtons}>

      {/* ADMIN */}

      <button
        type="button"
        className={styles.devBtn}
        disabled={loading}
        onClick={() =>
          handleDevLogin("admin")
        }
      >
        Login as Admin
      </button>

      {/* REGISTRAR */}

      <button
        type="button"
        className={styles.devBtn}
        disabled={loading}
        onClick={() =>
          handleDevLogin("registrar")
        }
      >
        Login as Registrar
      </button>

      {/* PROGRAM HEAD */}

      <button
        type="button"
        className={styles.devBtn}
        disabled={loading}
        onClick={() =>
          handleDevLogin("proghead")
        }
      >
        Login as Program Head
      </button>

      {/* FACULTY */}

      <button
        type="button"
        className={styles.devBtn}
        disabled={loading}
        onClick={() =>
          handleDevLogin("faculty")
        }
      >
        Login as Faculty
      </button>

      {/* STUDENT */}

      <button
        type="button"
        className={styles.devBtn}
        disabled={loading}
        onClick={() =>
          handleDevLogin(
            "26BSIT-0008",
          )
        }
      >
        Login as Student
      </button>

      {/* FINANCE */}

      <button
        type="button"
        className={styles.devBtn}
        disabled={loading}
        onClick={() =>
          handleDevLogin(
            "FINANCE CASIER",
          )
        }
      >
        Login as Finance
      </button>

    </div>
  </div>
)}
        </div>
      </div>

      {loading && (
        <div
          className={styles.loginLoadingOverlay}
          role="status"
          aria-live="polite"
          aria-label="Signing you in"
        >
          <div className={styles.loginLoadingPanel}>
            <span
              className={styles.loginLoadingSpinner}
              aria-hidden="true"
            />

            <div className={styles.loginLoadingText}>
              <strong>Signing you in</strong>
              <span>Sending your OTP. Please wait...</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
