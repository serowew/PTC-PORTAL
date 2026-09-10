import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  AtSign,
  BadgeCheck,
  Building2,
  CalendarDays,
  ContactRound,
  Hash,
  IdCard,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import DashboardLayout from "../../components/Layout/DashboardLayout";
import { authService } from "../../services/auth.service";
import "../../styles/FacultyProfile.css";

const API_BASE_URL = "http://localhost:3000/api/faculty/classes";

interface FacultyInfo {
  faculty_id: number;
  user_id?: number;
  employee_number: string;
  username?: string;
  first_name?: string;
  middle_name?: string | null;
  last_name?: string;
  faculty_name: string;
  email?: string | null;
  contact_number?: string | null;
  department_id?: number | null;
  employment_status?: string | null;
  hire_date?: string | null;
}

interface FacultyClassesResponse {
  success: boolean;
  faculty?: FacultyInfo;
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

function getInitials(faculty: FacultyInfo | null, fallback: string) {
  if (faculty) {
    const initials = [faculty.first_name, faculty.last_name]
      .filter(Boolean)
      .map((value) => value!.trim().charAt(0).toUpperCase())
      .join("");

    if (initials) {
      return initials.slice(0, 2);
    }

    const nameInitials = faculty.faculty_name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");

    if (nameInitials) {
      return nameInitials;
    }
  }

  return fallback.trim().slice(0, 2).toUpperCase() || "FA";
}

function displayValue(value?: string | number | null) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "Not recorded";
  }

  return String(value);
}

export default function FacultyProfile() {
  const navigate = useNavigate();
  const session = authService.getSession();
  const token = authService.getToken();
  const authenticated = Boolean(session && token);
  const userRole = session?.role;

  const [faculty, setFaculty] = useState<FacultyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Faculty") {
      navigate(authService.getDashboardRoute(session!.role), {
        replace: true,
      });
    }
  }, [authenticated, userRole, session, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Faculty") {
      return;
    }

    const controller = new AbortController();

    const loadProfile = async () => {
      try {
        if (refreshKey === 0) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }

        setError("");

        const response = await authService.authFetch(API_BASE_URL, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });

        const data = await readJsonResponse<FacultyClassesResponse>(response);

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (response.status === 403) {
          throw new Error(
            data.message || data.error || "Faculty access is required.",
          );
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || data.error || "Unable to load Faculty profile.",
          );
        }

        if (!data.faculty) {
          throw new Error("No Faculty profile is connected to this account.");
        }

        setFaculty(data.faculty);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD FACULTY PROFILE ERROR:", requestError);
        setFaculty(null);

        if (requestError instanceof TypeError) {
          setError(
            "Unable to connect to the Faculty profile service. Make sure the backend is running.",
          );
          return;
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load Faculty profile.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void loadProfile();

    return () => controller.abort();
  }, [authenticated, userRole, navigate, refreshKey]);

  const fullName = useMemo(() => {
    if (faculty?.faculty_name?.trim()) {
      return faculty.faculty_name.trim();
    }

    return session?.username || "Faculty";
  }, [faculty, session]);

  const initials = useMemo(
    () => getInitials(faculty, session?.username || "Faculty"),
    [faculty, session],
  );

  const employmentStatus = faculty?.employment_status?.trim() || "Not recorded";
  const isActiveStatus = employmentStatus.toLowerCase() === "active";

  if (!authenticated || !session || userRole !== "Faculty") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="faculty-profile-page">
        <section className="faculty-profile-page__hero">
          <div className="faculty-profile-page__hero-main">
            <button
              type="button"
              className="faculty-profile-page__back"
              onClick={() => navigate("/faculty/dashboard")}
            >
              <ArrowLeft size={16} strokeWidth={2.1} />
              Dashboard
            </button>

            <div className="faculty-profile-page__identity">
              <div
                className="faculty-profile-page__avatar"
                aria-label={`${fullName} initials`}
              >
                {initials}
              </div>

              <div className="faculty-profile-page__identity-copy">
                <div className="faculty-profile-page__eyebrow">
                  <span>
                    <UserRound size={15} strokeWidth={2.2} />
                  </span>
                  Faculty · Profile
                </div>

                <h1>{loading ? "Loading profile..." : fullName}</h1>

                <div className="faculty-profile-page__identity-meta">
                  <span>
                    <IdCard size={14} />
                    {loading
                      ? "Loading employee number..."
                      : displayValue(faculty?.employee_number)}
                  </span>

                  {!loading && faculty && (
                    <span
                      className={`faculty-profile-page__status ${
                        isActiveStatus
                          ? "faculty-profile-page__status--active"
                          : ""
                      }`}
                    >
                      <BadgeCheck size={14} />
                      {employmentStatus}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="faculty-profile-page__refresh"
            onClick={() => setRefreshKey((current) => current + 1)}
            disabled={loading || refreshing}
          >
            <RefreshCw
              size={16}
              className={refreshing ? "is-spinning" : ""}
            />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </section>

        {error && (
          <section className="faculty-profile-page__error" role="alert">
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
            className="faculty-profile-page__loading"
            aria-label="Loading Faculty profile"
          >
            <div className="faculty-profile-page__loading-card">
              <span />
              <span />
              <span />
              <span />
            </div>

            <div className="faculty-profile-page__loading-card">
              <span />
              <span />
              <span />
              <span />
            </div>
          </section>
        )}

        {!error && !loading && faculty && (
          <>
            <section className="faculty-profile-page__summary">
              <article>
                <span className="faculty-profile-page__summary-icon">
                  <Hash size={18} />
                </span>
                <div>
                  <small>Employee Number</small>
                  <strong>{displayValue(faculty.employee_number)}</strong>
                </div>
              </article>

              <article>
                <span className="faculty-profile-page__summary-icon">
                  <Building2 size={18} />
                </span>
                <div>
                  <small>Department</small>
                  <strong>
                    {faculty.department_id
                      ? `Department ${faculty.department_id}`
                      : "Not recorded"}
                  </strong>
                </div>
              </article>

              <article>
                <span className="faculty-profile-page__summary-icon">
                  <ShieldCheck size={18} />
                </span>
                <div>
                  <small>Employment</small>
                  <strong>{employmentStatus}</strong>
                </div>
              </article>

              <article>
                <span className="faculty-profile-page__summary-icon">
                  <CalendarDays size={18} />
                </span>
                <div>
                  <small>Hire Date</small>
                  <strong>{formatDate(faculty.hire_date)}</strong>
                </div>
              </article>
            </section>

            <div className="faculty-profile-page__content-grid">
              <section className="faculty-profile-page__card">
                <header className="faculty-profile-page__card-header">
                  <span className="faculty-profile-page__card-icon">
                    <ContactRound size={18} />
                  </span>

                  <div>
                    <span>Personal information</span>
                    <h2>Faculty Details</h2>
                    <p>
                      Basic identity and contact information connected to your
                      Faculty account.
                    </p>
                  </div>
                </header>

                <div className="faculty-profile-page__field-grid">
                  <div className="faculty-profile-page__field">
                    <span>First Name</span>
                    <strong>{displayValue(faculty.first_name)}</strong>
                  </div>

                  <div className="faculty-profile-page__field">
                    <span>Middle Name</span>
                    <strong>{displayValue(faculty.middle_name)}</strong>
                  </div>

                  <div className="faculty-profile-page__field">
                    <span>Last Name</span>
                    <strong>{displayValue(faculty.last_name)}</strong>
                  </div>

                  <div className="faculty-profile-page__field">
                    <span>Employee Number</span>
                    <strong>{displayValue(faculty.employee_number)}</strong>
                  </div>

                  <div className="faculty-profile-page__field faculty-profile-page__field--wide">
                    <span>Email Address</span>
                    <strong>
                      <Mail size={14} />
                      {displayValue(faculty.email)}
                    </strong>
                  </div>

                  <div className="faculty-profile-page__field faculty-profile-page__field--wide">
                    <span>Contact Number</span>
                    <strong>
                      <Phone size={14} />
                      {displayValue(faculty.contact_number)}
                    </strong>
                  </div>
                </div>
              </section>

              <section className="faculty-profile-page__card">
                <header className="faculty-profile-page__card-header">
                  <span className="faculty-profile-page__card-icon">
                    <IdCard size={18} />
                  </span>

                  <div>
                    <span>Account & employment</span>
                    <h2>Faculty Record</h2>
                    <p>
                      Portal account details and employment information assigned
                      to your Faculty record.
                    </p>
                  </div>
                </header>

                <div className="faculty-profile-page__field-grid">
                  <div className="faculty-profile-page__field faculty-profile-page__field--wide">
                    <span>Username</span>
                    <strong>
                      <AtSign size={14} />
                      {displayValue(faculty.username || session.username)}
                    </strong>
                  </div>

                  <div className="faculty-profile-page__field">
                    <span>Faculty ID</span>
                    <strong>{displayValue(faculty.faculty_id)}</strong>
                  </div>

                  <div className="faculty-profile-page__field">
                    <span>Department ID</span>
                    <strong>{displayValue(faculty.department_id)}</strong>
                  </div>

                  <div className="faculty-profile-page__field">
                    <span>Employment Status</span>
                    <strong>{employmentStatus}</strong>
                  </div>

                  <div className="faculty-profile-page__field">
                    <span>Hire Date</span>
                    <strong>{formatDate(faculty.hire_date)}</strong>
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
