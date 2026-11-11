import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  AtSign,
  Building2,
  ContactRound,
  IdCard,
  Mail,
  Phone,
  UserRound,
  Users,
  CalendarDays,
  Clock3,
  BriefcaseBusiness,
  BadgeCheck,
  ShieldCheck,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import "../../../styles/ProgramHeadProfile.css";

const PROFILE_API_URL = apiUrl("/api/program-head/profile");

interface ProgramHeadProfileInfo {
  program_head_id: number;
  faculty_id: number;
  user_id: number;
  employee_number: string;
  username?: string;
  first_name?: string;
  middle_name?: string | null;
  last_name?: string;
  program_head_name: string;
  gender?: string | null;
  birth_date?: string | null;
  contact_number?: string | null;
  email?: string | null;
  department_id: number;
  department_code?: string | null;
  department_name?: string | null;
  employment_status?: string | null;
  hire_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  assignment_is_active: boolean;
  account_is_active: boolean;
  is_verified: boolean;
  last_login?: string | null;
  account_created_at?: string | null;
  role: string;
}

interface ProgramHeadProfileResponse {
  success: boolean;
  profile?: ProgramHeadProfileInfo;
  message?: string;
  error?: string;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();

    throw new Error(
      `Server returned a non-JSON response (${response.status}): ${text.slice(
        0,
        180,
      )}`,
    );
  }

  return response.json() as Promise<T>;
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function displayValue(value?: string | number | null) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "Not recorded";
  }

  return String(value);
}

function getInitials(profile: ProgramHeadProfileInfo | null, fallback: string) {
  if (profile) {
    const initials = [profile.first_name, profile.last_name]
      .filter(Boolean)
      .map((value) => value!.trim().charAt(0).toUpperCase())
      .join("");

    if (initials) {
      return initials.slice(0, 2);
    }

    const nameInitials = profile.program_head_name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");

    if (nameInitials) {
      return nameInitials;
    }
  }

  return fallback.trim().slice(0, 2).toUpperCase() || "PH";
}

export default function ProgramHeadProfile() {
  const navigate = useNavigate();
  const session = authService.getSession();
  const token = authService.getToken();
  const authenticated = Boolean(session && token);
  const userRole = session?.role;

  const [profile, setProfile] = useState<ProgramHeadProfileInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Program Head") {
      navigate(authService.getDashboardRoute(session!.role), {
        replace: true,
      });
    }
  }, [authenticated, userRole, session, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Program Head") {
      return;
    }

    const controller = new AbortController();

    const loadProfile = async () => {
      try {
        setLoading(true);

        setError("");

        const response = await authService.authFetch(PROFILE_API_URL, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });

        const data = await readJsonResponse<ProgramHeadProfileResponse>(response);

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (response.status === 403) {
          throw new Error(
            data.message || data.error || "Program Head access is required.",
          );
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || data.error || "Unable to load Program Head profile.",
          );
        }

        if (!data.profile) {
          throw new Error(
            "No active Program Head profile is connected to this account.",
          );
        }

        setProfile(data.profile);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD PROGRAM HEAD PROFILE ERROR:", requestError);
        setProfile(null);

        if (requestError instanceof TypeError) {
          setError(
            "Unable to connect to the Program Head profile service. Make sure the backend is running.",
          );
          return;
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load Program Head profile.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadProfile();

    return () => controller.abort();
  }, [authenticated, userRole, navigate, refreshKey]);

  const fullName = useMemo(() => {
    if (profile?.program_head_name?.trim()) {
      return profile.program_head_name.trim();
    }

    return session?.username || "Program Head";
  }, [profile, session]);

  const initials = useMemo(
    () => getInitials(profile, session?.username || "Program Head"),
    [profile, session],
  );

  const assignmentStatus = profile?.assignment_is_active ? "Active" : "Inactive";
  const accountStatus = profile?.account_is_active ? "Active" : "Inactive";
  const verificationStatus = profile?.is_verified ? "Verified" : "Not Verified";
  const departmentLabel = profile
    ? [profile.department_code, profile.department_name]
        .filter(Boolean)
        .join(" · ") || "Not recorded"
    : "Not recorded";

  if (!authenticated || !session || userRole !== "Program Head") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="program-head-profile-page">
        <section className="program-head-profile-page__hero">
          <div className="program-head-profile-page__hero-main">
            <div className="program-head-profile-page__eyebrow">
              <span>
                <UserRound size={15} strokeWidth={2.2} />
              </span>
              Program Head · Profile
            </div>
            <h1>My Profile</h1>
            <p className="program-head-profile-page__description">
              View your personal and institutional profile information recorded in the PTC Portal.
            </p>
          </div>
        </section>

        <section className="program-head-profile-page__identity" aria-label="Program Head identity">
          <div className="program-head-profile-page__identity-main">
            <div className="program-head-profile-page__avatar" aria-label={`${fullName} initials`}>
              {initials}
            </div>
            <div className="program-head-profile-page__identity-copy">
              <span className="program-head-profile-page__identity-label">Program Head</span>
              <h2>{loading ? "Loading profile..." : fullName}</h2>
              <div className="program-head-profile-page__identity-meta">
                <span>
                  <IdCard size={14} />
                  {loading ? "Loading employee number..." : displayValue(profile?.employee_number)}
                </span>
              </div>
            </div>
          </div>
          <div className="program-head-profile-page__identity-details">
            <div>
              <small>Department</small>
              <strong>{loading ? "Loading..." : departmentLabel}</strong>
            </div>
            <div>
              <small>Assignment Status</small>
              <strong className={`program-head-profile-page__status ${profile?.assignment_is_active ? "program-head-profile-page__status--active" : ""}`}>
                {loading ? "Loading..." : assignmentStatus}
              </strong>
            </div>
          </div>
        </section>

        {error && (
          <section className="program-head-profile-page__error" role="alert">
            <span>
              <AlertCircle size={20} />
            </span>

            <div>
              <strong>Profile could not be loaded</strong>
              <p>{error}</p>
            </div>

            <button
              type="button"
              onClick={() => setRefreshKey((current) => current + 1)}
            >
              Try Again
            </button>
          </section>
        )}

        {!error && loading && (
          <section
            className="program-head-profile-page__loading"
            aria-label="Loading Program Head profile"
          >
            <div className="program-head-profile-page__loading-card">
              <span />
              <span />
              <span />
              <span />
            </div>

            <div className="program-head-profile-page__loading-card">
              <span />
              <span />
              <span />
              <span />
            </div>
          </section>
        )}

        {!error && !loading && profile && (
          <>
            <div className="program-head-profile-page__content-grid">
              <section className="program-head-profile-page__card">
                <header className="program-head-profile-page__card-header">
                  <span className="program-head-profile-page__card-icon">
                    <ContactRound size={18} />
                  </span>

                  <div>
                    <span>Personal information</span>
                    <h2>Program Head Details</h2>
                    <p>
                      Identity and contact information connected to your Program
                      Head account.
                    </p>
                  </div>
                </header>

                <div className="program-head-profile-page__field-grid">
                  <div className="program-head-profile-page__field">
                    <span className="program-head-profile-page__field-icon" aria-hidden="true"><UserRound size={17} /></span>
                    <div className="program-head-profile-page__field-copy">
                      <span>First Name</span>
                                        <strong>{displayValue(profile.first_name)}</strong>
                    </div>
                  </div>

                  <div className="program-head-profile-page__field">
                    <span className="program-head-profile-page__field-icon" aria-hidden="true"><UserRound size={17} /></span>
                    <div className="program-head-profile-page__field-copy">
                      <span>Middle Name</span>
                                        <strong>{displayValue(profile.middle_name)}</strong>
                    </div>
                  </div>

                  <div className="program-head-profile-page__field">
                    <span className="program-head-profile-page__field-icon" aria-hidden="true"><UserRound size={17} /></span>
                    <div className="program-head-profile-page__field-copy">
                      <span>Last Name</span>
                                        <strong>{displayValue(profile.last_name)}</strong>
                    </div>
                  </div>

                  <div className="program-head-profile-page__field">
                    <span className="program-head-profile-page__field-icon" aria-hidden="true"><Users size={17} /></span>
                    <div className="program-head-profile-page__field-copy">
                      <span>Gender</span>
                                        <strong>{displayValue(profile.gender)}</strong>
                    </div>
                  </div>

                  <div className="program-head-profile-page__field">
                    <span className="program-head-profile-page__field-icon" aria-hidden="true"><CalendarDays size={17} /></span>
                    <div className="program-head-profile-page__field-copy">
                      <span>Birth Date</span>
                                        <strong>{formatDate(profile.birth_date)}</strong>
                    </div>
                  </div>

                  <div className="program-head-profile-page__field">
                    <span className="program-head-profile-page__field-icon" aria-hidden="true"><Phone size={17} /></span>
                    <div className="program-head-profile-page__field-copy">
                      <span>Contact Number</span>
                                        <strong>
                                          {displayValue(profile.contact_number)}
                                        </strong>
                    </div>
                  </div>

                  <div className="program-head-profile-page__field program-head-profile-page__field--wide">
                    <span className="program-head-profile-page__field-icon" aria-hidden="true"><Mail size={17} /></span>
                    <div className="program-head-profile-page__field-copy">
                      <span>Email Address</span>
                                        <strong>
                                          {displayValue(profile.email)}
                                        </strong>
                    </div>
                  </div>
                </div>
              </section>

              <section className="program-head-profile-page__card">
                <header className="program-head-profile-page__card-header">
                  <span className="program-head-profile-page__card-icon">
                    <IdCard size={18} />
                  </span>

                  <div>
                    <span>Account & assignment</span>
                    <h2>Institutional Record</h2>
                    <p>
                      Portal, employment, department, and Program Head assignment
                      information.
                    </p>
                  </div>
                </header>

                <div className="program-head-profile-page__field-grid">
                  <div className="program-head-profile-page__field program-head-profile-page__field--wide">
                    <span className="program-head-profile-page__field-icon" aria-hidden="true"><AtSign size={17} /></span>
                    <div className="program-head-profile-page__field-copy">
                      <span>Username</span>
                                        <strong>
                                          {displayValue(profile.username || session.username)}
                                        </strong>
                    </div>
                  </div>

                  <div className="program-head-profile-page__field">
                    <span className="program-head-profile-page__field-icon" aria-hidden="true"><ShieldCheck size={17} /></span>
                    <div className="program-head-profile-page__field-copy">
                      <span>Role</span>
                                        <strong>{displayValue(profile.role)}</strong>
                    </div>
                  </div>

                  <div className="program-head-profile-page__field">
                    <span className="program-head-profile-page__field-icon" aria-hidden="true"><IdCard size={17} /></span>
                    <div className="program-head-profile-page__field-copy">
                      <span>Employee Number</span>
                                        <strong>{displayValue(profile.employee_number)}</strong>
                    </div>
                  </div>

                  <div className="program-head-profile-page__field program-head-profile-page__field--wide">
                    <span className="program-head-profile-page__field-icon" aria-hidden="true"><Building2 size={17} /></span>
                    <div className="program-head-profile-page__field-copy">
                      <span>Department</span>
                                        <strong>
                                          {departmentLabel}
                                        </strong>
                    </div>
                  </div>

                  <div className="program-head-profile-page__field">
                    <span className="program-head-profile-page__field-icon" aria-hidden="true"><BriefcaseBusiness size={17} /></span>
                    <div className="program-head-profile-page__field-copy">
                      <span>Employment Status</span>
                                        <strong>{displayValue(profile.employment_status)}</strong>
                    </div>
                  </div>

                  <div className="program-head-profile-page__field">
                    <span className="program-head-profile-page__field-icon" aria-hidden="true"><CalendarDays size={17} /></span>
                    <div className="program-head-profile-page__field-copy">
                      <span>Hire Date</span>
                                        <strong>{formatDate(profile.hire_date)}</strong>
                    </div>
                  </div>

                  <div className="program-head-profile-page__field">
                    <span className="program-head-profile-page__field-icon" aria-hidden="true"><CalendarDays size={17} /></span>
                    <div className="program-head-profile-page__field-copy">
                      <span>Program Head Since</span>
                                        <strong>{formatDate(profile.start_date)}</strong>
                    </div>
                  </div>

                  <div className="program-head-profile-page__field">
                    <span className="program-head-profile-page__field-icon" aria-hidden="true"><BadgeCheck size={17} /></span>
                    <div className="program-head-profile-page__field-copy">
                      <span>Assignment Status</span>
                                        <strong>{assignmentStatus}</strong>
                    </div>
                  </div>

                  <div className="program-head-profile-page__field">
                    <span className="program-head-profile-page__field-icon" aria-hidden="true"><ShieldCheck size={17} /></span>
                    <div className="program-head-profile-page__field-copy">
                      <span>Account Status</span>
                                        <strong>{accountStatus}</strong>
                    </div>
                  </div>

                  <div className="program-head-profile-page__field">
                    <span className="program-head-profile-page__field-icon" aria-hidden="true"><BadgeCheck size={17} /></span>
                    <div className="program-head-profile-page__field-copy">
                      <span>Verification</span>
                                        <strong>{verificationStatus}</strong>
                    </div>
                  </div>

                  <div className="program-head-profile-page__field program-head-profile-page__field--wide">
                    <span className="program-head-profile-page__field-icon" aria-hidden="true"><Clock3 size={17} /></span>
                    <div className="program-head-profile-page__field-copy">
                      <span>Last Login</span>
                                        <strong>{formatDateTime(profile.last_login)}</strong>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </>
        )}
      </main>
    </DashboardLayout>
  );
}