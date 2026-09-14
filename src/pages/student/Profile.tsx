import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  CalendarDays,
  CircleAlert,
  GraduationCap,
  Home,
  IdCard,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../components/Layout/DashboardLayout";
import { authService } from "../../services/auth.service";
import "../../styles/StudentSelfProfile.css";

const API_BASE_URL = "http://localhost:3000";

interface StudentProfileData {
  photo: string | null;

  full_name: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;

  student_number: string;

  email: string | null;
  contact_number: string | null;
  gender: string | null;
  birth_date: string | null;
  address: string | null;

  course: {
    course_id: number | null;
    course_code: string | null;
    course_name: string | null;
  };

  year_level: number | null;

  section: {
    section_id: number | null;
    section_name: string | null;
  };

  academic_year: {
    academic_year_id: number | null;
    academic_year: string | null;
  };

  semester: {
    semester_id: number | null;
    semester_name: string | null;
  };

  enrollment_status: string | null;
  student_status: string | null;

  guardian: {
    guardian_name: string | null;
    relationship: string | null;
    contact_number: string | null;
  } | null;
}

interface StudentProfileResponse {
  success?: boolean;
  code?: string;
  message?: string;
  error?: string;
  profile?: StudentProfileData;
}

function formatValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "Not provided";
  }

  return String(value);
}

function formatYearLevel(value: number | null | undefined) {
  if (!value) return "Not provided";

  const suffix =
    value === 1 ? "st" : value === 2 ? "nd" : value === 3 ? "rd" : "th";

  return `${value}${suffix} Year`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not provided";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getInitials(fullName: string) {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "ST";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

function getStatusClass(value: string | null | undefined) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

  if (["approved", "active", "enrolled"].includes(normalized)) {
    return "positive";
  }

  if (["pending", "draft", "under-review"].includes(normalized)) {
    return "pending";
  }

  if (
    ["rejected", "dropped", "inactive", "transferred"].includes(normalized)
  ) {
    return "negative";
  }

  return "neutral";
}

function buildPhotoUrl(photo: string | null) {
  if (!photo) return "";

  const trimmed = photo.trim();

  if (!trimmed) return "";

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const normalized = trimmed.replace(/\\/g, "/").replace(/^\/+/, "");

  return `${API_BASE_URL}/${normalized}`;
}

export default function StudentProfile() {
  const navigate = useNavigate();

  const user = authService.getSession();
  const token = authService.getToken();
  const authenticated = Boolean(user && token);
  const userRole = user?.role;

  const [profile, setProfile] = useState<StudentProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [photoFailed, setPhotoFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Student") {
      if (userRole) {
        navigate(authService.getDashboardRoute(userRole), { replace: true });
      } else {
        navigate("/login", { replace: true });
      }
    }
  }, [authenticated, userRole, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Student") {
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

        const response = await authService.authFetch(
          `${API_BASE_URL}/api/student/profile`,
          {
            method: "GET",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          },
        );

        const contentType = response.headers.get("content-type") || "";
        let data: StudentProfileResponse | null = null;

        if (contentType.includes("application/json")) {
          data = (await response.json()) as StudentProfileResponse;
        } else {
          const text = await response.text();

          throw new Error(
            `Server returned a non-JSON response (${response.status}): ${text.slice(
              0,
              180,
            )}`,
          );
        }

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (response.status === 403) {
          throw new Error(
            data?.message || "Student access is required to view this profile.",
          );
        }

        if (!response.ok || !data?.success) {
          throw new Error(
            data?.message ||
              data?.error ||
              `Failed to load student profile (${response.status}).`,
          );
        }

        if (!data.profile) {
          throw new Error("Student profile data was not returned by the server.");
        }

        setProfile(data.profile);
        setPhotoFailed(false);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD STUDENT PROFILE ERROR:", requestError);
        setProfile(null);

        if (requestError instanceof TypeError) {
          setError(
            "Unable to connect to the Student profile server. Make sure the backend is running on port 3000.",
          );
          return;
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load Student profile.",
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

  const photoUrl = useMemo(
    () => buildPhotoUrl(profile?.photo || null),
    [profile?.photo],
  );

  const courseLabel = profile
    ? [profile.course.course_code, profile.course.course_name]
        .filter(Boolean)
        .join(" — ")
    : "";

  const enrollmentStatus = profile?.enrollment_status || "Not Enrolled";

  if (!authenticated || !user || userRole !== "Student") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="student-self-profile">
        <section className="student-self-profile__page-hero">
          <div>
            <div className="student-self-profile__eyebrow">
              <span className="student-self-profile__eyebrow-icon">
                <UserRound size={16} strokeWidth={2.2} />
              </span>
              Student · Profile
            </div>

            <h1>Student Profile</h1>
            <p>
              View your personal, academic, and guardian information recorded
              in the PTC Portal.
            </p>
          </div>

          <button
            type="button"
            className="student-self-profile__refresh"
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

        {loading && (
          <section
            className="student-self-profile__loading"
            aria-label="Loading student profile"
          >
            <div className="student-self-profile__skeleton student-self-profile__skeleton--header" />
            <div className="student-self-profile__skeleton-grid">
              <div className="student-self-profile__skeleton student-self-profile__skeleton--card" />
              <div className="student-self-profile__skeleton student-self-profile__skeleton--card" />
              <div className="student-self-profile__skeleton student-self-profile__skeleton--card" />
            </div>
          </section>
        )}

        {!loading && error && (
          <section className="student-self-profile__state student-self-profile__state--error">
            <span>
              <CircleAlert size={24} />
            </span>

            <div>
              <strong>Student profile could not be loaded</strong>
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

        {!loading && !error && profile && (
          <>
            <section className="student-self-profile__identity">
              <div className="student-self-profile__identity-main">
                <div className="student-self-profile__photo">
                  {photoUrl && !photoFailed ? (
                    <img
                      src={photoUrl}
                      alt={`${profile.full_name} profile`}
                      onError={() => setPhotoFailed(true)}
                    />
                  ) : (
                    <span>{getInitials(profile.full_name)}</span>
                  )}
                </div>

                <div className="student-self-profile__identity-copy">
                  <span className="student-self-profile__identity-label">
                    Student
                  </span>

                  <h2>{formatValue(profile.full_name)}</h2>

                  <div className="student-self-profile__identity-meta">
                    <span>{formatValue(profile.student_number)}</span>
                    <span aria-hidden="true">•</span>
                    <span>{formatValue(profile.course.course_code)}</span>
                    <span aria-hidden="true">•</span>
                    <span>{formatYearLevel(profile.year_level)}</span>
                  </div>

                  <p>{courseLabel || "Program information not provided"}</p>
                </div>
              </div>

              <div className="student-self-profile__identity-details">
                <div>
                  <span>Section</span>
                  <strong>
                    {formatValue(profile.section.section_name)}
                  </strong>
                </div>

                <div>
                  <span>Enrollment Status</span>
                  <strong
                    className={`student-self-profile__status student-self-profile__status--${getStatusClass(
                      enrollmentStatus,
                    )}`}
                  >
                    <i />
                    {enrollmentStatus}
                  </strong>
                </div>
              </div>
            </section>

            <section className="student-self-profile__content-grid">
              <article className="student-self-profile__card">
                <header className="student-self-profile__card-header">
                  <span className="student-self-profile__card-icon">
                    <UserRound size={18} />
                  </span>

                  <div>
                    <span>Student Details</span>
                    <h2>Personal Information</h2>
                    <p>Your personal information recorded by the college.</p>
                  </div>
                </header>

                <div className="student-self-profile__fields">
                  <div className="student-self-profile__field student-self-profile__field--wide">
                    <span className="student-self-profile__field-icon">
                      <UserRound size={15} />
                    </span>
                    <div>
                      <span>Full Name</span>
                      <strong>{formatValue(profile.full_name)}</strong>
                    </div>
                  </div>

                  <div className="student-self-profile__field">
                    <span className="student-self-profile__field-icon">
                      <IdCard size={15} />
                    </span>
                    <div>
                      <span>Student Number</span>
                      <strong>{formatValue(profile.student_number)}</strong>
                    </div>
                  </div>

                  <div className="student-self-profile__field">
                    <span className="student-self-profile__field-icon">
                      <Mail size={15} />
                    </span>
                    <div>
                      <span>Email Address</span>
                      <strong>{formatValue(profile.email)}</strong>
                    </div>
                  </div>

                  <div className="student-self-profile__field">
                    <span className="student-self-profile__field-icon">
                      <Phone size={15} />
                    </span>
                    <div>
                      <span>Contact Number</span>
                      <strong>{formatValue(profile.contact_number)}</strong>
                    </div>
                  </div>

                  <div className="student-self-profile__field">
                    <span className="student-self-profile__field-icon">
                      <UserRound size={15} />
                    </span>
                    <div>
                      <span>Gender</span>
                      <strong>{formatValue(profile.gender)}</strong>
                    </div>
                  </div>

                  <div className="student-self-profile__field">
                    <span className="student-self-profile__field-icon">
                      <CalendarDays size={15} />
                    </span>
                    <div>
                      <span>Date of Birth</span>
                      <strong>{formatDate(profile.birth_date)}</strong>
                    </div>
                  </div>

                  <div className="student-self-profile__field student-self-profile__field--wide">
                    <span className="student-self-profile__field-icon">
                      <MapPin size={15} />
                    </span>
                    <div>
                      <span>Address</span>
                      <strong>{formatValue(profile.address)}</strong>
                    </div>
                  </div>
                </div>
              </article>

              <article className="student-self-profile__card">
                <header className="student-self-profile__card-header">
                  <span className="student-self-profile__card-icon">
                    <GraduationCap size={18} />
                  </span>

                  <div>
                    <span>Current Standing</span>
                    <h2>Academic Information</h2>
                    <p>Your current program and enrollment information.</p>
                  </div>
                </header>

                <div className="student-self-profile__fields">
                  <div className="student-self-profile__field">
                    <span className="student-self-profile__field-icon">
                      <IdCard size={15} />
                    </span>
                    <div>
                      <span>Student Number</span>
                      <strong>{formatValue(profile.student_number)}</strong>
                    </div>
                  </div>

                  <div className="student-self-profile__field">
                    <span className="student-self-profile__field-icon">
                      <BookOpen size={15} />
                    </span>
                    <div>
                      <span>Course / Program</span>
                      <strong>{courseLabel || "Not provided"}</strong>
                    </div>
                  </div>

                  <div className="student-self-profile__field">
                    <span className="student-self-profile__field-icon">
                      <GraduationCap size={15} />
                    </span>
                    <div>
                      <span>Year Level</span>
                      <strong>{formatYearLevel(profile.year_level)}</strong>
                    </div>
                  </div>

                  <div className="student-self-profile__field">
                    <span className="student-self-profile__field-icon">
                      <Home size={15} />
                    </span>
                    <div>
                      <span>Section</span>
                      <strong>
                        {formatValue(profile.section.section_name)}
                      </strong>
                    </div>
                  </div>

                  <div className="student-self-profile__field">
                    <span className="student-self-profile__field-icon">
                      <CalendarDays size={15} />
                    </span>
                    <div>
                      <span>Academic Year</span>
                      <strong>
                        {formatValue(
                          profile.academic_year.academic_year,
                        )}
                      </strong>
                    </div>
                  </div>

                  <div className="student-self-profile__field">
                    <span className="student-self-profile__field-icon">
                      <CalendarDays size={15} />
                    </span>
                    <div>
                      <span>Semester</span>
                      <strong>
                        {formatValue(profile.semester.semester_name)}
                      </strong>
                    </div>
                  </div>

                  <div className="student-self-profile__field student-self-profile__field--wide">
                    <span className="student-self-profile__field-icon">
                      <ShieldCheck size={15} />
                    </span>
                    <div>
                      <span>Enrollment Status</span>
                      <strong
                        className={`student-self-profile__inline-status student-self-profile__inline-status--${getStatusClass(
                          enrollmentStatus,
                        )}`}
                      >
                        <i />
                        {enrollmentStatus}
                      </strong>
                    </div>
                  </div>
                </div>
              </article>

              <article className="student-self-profile__card student-self-profile__card--guardian">
                <header className="student-self-profile__card-header">
                  <span className="student-self-profile__card-icon">
                    <UsersRound size={18} />
                  </span>

                  <div>
                    <span>Emergency Contact</span>
                    <h2>Guardian Information</h2>
                    <p>Guardian details currently recorded for your account.</p>
                  </div>
                </header>

                <div className="student-self-profile__guardian-grid">
                  <div>
                    <span>Guardian Name</span>
                    <strong>
                      {formatValue(profile.guardian?.guardian_name)}
                    </strong>
                  </div>

                  <div>
                    <span>Relationship</span>
                    <strong>
                      {formatValue(profile.guardian?.relationship)}
                    </strong>
                  </div>

                  <div>
                    <span>Contact Number</span>
                    <strong>
                      {formatValue(profile.guardian?.contact_number)}
                    </strong>
                  </div>
                </div>
              </article>
            </section>
          </>
        )}
      </main>
    </DashboardLayout>
  );
}
