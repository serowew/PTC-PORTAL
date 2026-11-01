import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { apiUrl } from "../../services/api";
import "../../styles/PublicAdmission.css";

type ActivationState = "checking" | "ready" | "invalid" | "saving" | "complete";

type ActivationResponse = {
  success: boolean;
  valid?: boolean;
  username?: string;
  message?: string;
  code?: string;
};

const ACTIVATION_URL = apiUrl("/api/admissions/account-activation");

function readInvitationToken(): string {
  if (typeof window === "undefined") return "";
  return (
    new URLSearchParams(window.location.hash.slice(1)).get("token")?.trim() ||
    ""
  );
}

async function postActivation(
  endpoint: "inspect" | "activate",
  payload: { token: string; password?: string },
  signal?: AbortSignal,
): Promise<ActivationResponse> {
  const response = await fetch(`${ACTIVATION_URL}/${endpoint}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal,
  });

  const result = (await response
    .json()
    .catch(() => null)) as ActivationResponse | null;
  if (!response.ok || !result || result.success === false) {
    throw new Error(
      result?.message || "Unable to process your activation request.",
    );
  }
  return result;
}

export default function ActivateStudentAccount() {
  const [token, setToken] = useState(readInvitationToken);
  const [state, setState] = useState<ActivationState>(
    token ? "checking" : "invalid",
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(
    token
      ? ""
      : "An activation link is required. Please open the link from your PTC email.",
  );

  useEffect(() => {
    if (!token) return;

    // Keep the token in component memory, not in the browser's address bar or storage.
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );

    const controller = new AbortController();
    void postActivation("inspect", { token }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.valid || !result.username) {
          setError(
            "This activation link is invalid or has expired. Contact the Registrar for a new invitation.",
          );
          setState("invalid");
          return;
        }
        setUsername(result.username);
        setState("ready");
      })
      .catch((problem: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          problem instanceof Error
            ? problem.message
            : "Unable to validate the invitation.",
        );
        setState("invalid");
      });

    return () => controller.abort();
  }, [token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state !== "ready" || !token) return;

    if (
      password.length < 12 ||
      new TextEncoder().encode(password).length > 72
    ) {
      setError(
        "Use a password with at least 12 characters and no more than 72 UTF-8 bytes.",
      );
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }

    setError("");
    setState("saving");
    try {
      const result = await postActivation("activate", { token, password });
      if (result.username) setUsername(result.username);
      setPassword("");
      setConfirmation("");
      setToken("");
      setState("complete");
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Unable to activate your account.",
      );
      setState("ready");
    }
  }

  return (
    <main className="ptc-admission-public">
      <div className="ptc-admission-shell" style={{ maxWidth: 820 }}>
        {/* Header */}
        <section className="ptc-admission-hero">
          <div className="ptc-admission-hero-top">
            <ShieldCheck size={18} /> Pateros Technological College
          </div>
          <h1>Student Account Activation</h1>
          <p>
            Set up your PTC Portal password to access your new student account.
          </p>
          <div className="ptc-admission-policy">
            <LockKeyhole size={17} /> Your password is saved securely and is
            never sent by email.
          </div>
        </section>

        {/* Activation */}
        <section className="ptc-admission-panel" aria-live="polite">
          {state === "checking" && (
            <div className="ptc-admission-complete" role="status">
              <Loader2 size={32} aria-hidden={true} />
              <h2>Checking your activation link</h2>
              <p>
                Please keep this page open while we validate your invitation.
              </p>
            </div>
          )}

          {state === "invalid" && (
            <div className="ptc-admission-complete" role="alert">
              <AlertCircle size={32} aria-hidden={true} />
              <h2>Unable to activate your account</h2>
              <p>{error}</p>
              <p>
                Contact the PTC Registrar's Office to request a new activation
                invitation.
              </p>
              <Link
                className="ptc-admission-btn ptc-admission-btn--outline"
                to="/"
                style={{ textDecoration: "none", marginTop: 18 }}
              >
                Return to Home
              </Link>
            </div>
          )}

          {(state === "ready" || state === "saving") && (
            <>
              <div className="ptc-admission-heading">
                <h2>Create your password</h2>
                <p>
                  Your account has been imported successfully. Activate it
                  before signing in.
                </p>
              </div>

              <div className="ptc-admission-message ptc-admission-message--success">
                <KeyRound size={19} aria-hidden={true} />
                <span>
                  Student number / username: <strong>{username}</strong>
                </span>
              </div>

              {error && (
                <div
                  className="ptc-admission-message ptc-admission-message--error"
                  role="alert"
                >
                  <AlertCircle size={19} aria-hidden={true} />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={(event) => void handleSubmit(event)}>
                <div className="ptc-admission-grid">
                  <label className="ptc-admission-field">
                    <span>New password</span>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="new-password"
                      minLength={12}
                      required
                      disabled={state === "saving"}
                      placeholder="At least 12 characters"
                    />
                  </label>
                  <label className="ptc-admission-field">
                    <span>Confirm new password</span>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      autoComplete="new-password"
                      minLength={12}
                      required
                      disabled={state === "saving"}
                      placeholder="Re-enter your password"
                    />
                  </label>
                </div>

                <label className="ptc-admission-checkbox">
                  <input
                    type="checkbox"
                    checked={showPassword}
                    onChange={(event) => setShowPassword(event.target.checked)}
                    disabled={state === "saving"}
                  />
                  {showPassword ? (
                    <EyeOff size={17} aria-hidden={true} />
                  ) : (
                    <Eye size={17} aria-hidden={true} />
                  )}
                  <span>Show passwords while typing</span>
                </label>
                <p className="ptc-admission-help">
                  Use a unique password with at least 12 characters. Do not
                  share it with anyone.
                </p>

                <div className="ptc-admission-actions">
                  <button
                    className="ptc-admission-btn ptc-admission-btn--primary"
                    type="submit"
                    disabled={state === "saving"}
                  >
                    {state === "saving" ? (
                      <Loader2 size={17} />
                    ) : (
                      <LockKeyhole size={17} />
                    )}
                    {state === "saving"
                      ? "Activating account..."
                      : "Activate My Account"}
                  </button>
                </div>
              </form>
            </>
          )}

          {state === "complete" && (
            <div className="ptc-admission-complete" role="status">
              <CheckCircle2 size={42} aria-hidden={true} />
              <h2>Your PTC Portal account is activated</h2>
              <p>
                Username: <strong>{username}</strong>
              </p>
              <p>
                You can now sign in with your student number and new password.
                Official enrollment is a separate step.
              </p>
              <Link
                className="ptc-admission-btn ptc-admission-btn--primary"
                to="/login"
                style={{ textDecoration: "none", marginTop: 18 }}
              >
                Go to Login
              </Link>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
