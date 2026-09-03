import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CircleOff,
  Clock3,
  DoorOpen,
  History,
  Info,
  Loader2,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  UnlockKeyhole,
  UserRound,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/EnrollmentPeriodMR.css";

const API_BASE_URL = "http://localhost:3000/api/registrar/enrollments/period";

interface AcademicYear {
  academic_year_id: number;
  academic_year: string;
  is_current?: boolean | number;
}

interface Semester {
  semester_id: number;
  semester_name: string;
}

interface EnrollmentPeriod {
  enrollment_period_id: number;
  academic_year_id: number;
  academic_year: string;
  semester_id: number;
  semester_name: string;
  status: string;
  opened_by?: number | null;
  opened_by_username?: string | null;
  opened_at?: string | null;
  closed_by?: number | null;
  closed_by_username?: string | null;
  closed_at?: string | null;
  remarks?: string | null;
}

interface PeriodResponse {
  success: boolean;
  message?: string;
  error?: string;
  enrollment_period?: EnrollmentPeriod | null;
  academic_years?: AcademicYear[];
  semesters?: Semester[];
}

type ConfirmationMode = "open" | "close" | null;

export default function EnrollmentPeriodMR() {
  const navigate = useNavigate();
  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [latestPeriod, setLatestPeriod] = useState<EnrollmentPeriod | null>(null);

  const [selectedAcademicYearId, setSelectedAcademicYearId] = useState(0);
  const [selectedSemesterId, setSelectedSemesterId] = useState(0);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [confirmationMode, setConfirmationMode] =
    useState<ConfirmationMode>(null);

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Registrar") {
      if (user) {
        navigate(authService.getDashboardRoute(user.role), { replace: true });
      } else {
        navigate("/login", { replace: true });
      }
    }
  }, [authenticated, userRole, user, navigate]);

  useEffect(() => {
    if (!confirmationMode) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !actionLoading) {
        setConfirmationMode(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [confirmationMode, actionLoading]);

  const readPeriodResponse = async (
    response: Response,
  ): Promise<PeriodResponse> => {
    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      const text = await response.text();
      throw new Error(
        `Server returned a non-JSON response (${response.status}): ${text.slice(0, 200)}`,
      );
    }

    return response.json();
  };

  const handleAuthenticationResponse = (
    response: Response,
    responseData: PeriodResponse,
  ) => {
    if (response.status === 401) {
      authService.logout();
      navigate("/login", { replace: true });
      return false;
    }

    if (response.status === 403) {
      throw new Error(
        responseData.message ||
          responseData.error ||
          "You are not authorized to manage the enrollment period.",
      );
    }

    return true;
  };

  const loadPeriodData = async (mode: "initial" | "refresh" = "initial") => {
    if (!authenticated || userRole !== "Registrar") return;

    try {
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      setError("");

      const response = await authService.authFetch(API_BASE_URL, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      const responseData = await readPeriodResponse(response);
      const canContinue = handleAuthenticationResponse(response, responseData);
      if (!canContinue) return;

      if (!response.ok) {
        throw new Error(
          responseData.message ||
            responseData.error ||
            `Failed to load enrollment period (${response.status}).`,
        );
      }

      if (!responseData.success) {
        throw new Error(
          responseData.message ||
            "Unable to load enrollment period information.",
        );
      }

      const years = Array.isArray(responseData.academic_years)
        ? responseData.academic_years
        : [];
      setAcademicYears(years);

      const supportedSemesters = Array.isArray(responseData.semesters)
        ? responseData.semesters.filter((semester) =>
            [1, 2].includes(Number(semester.semester_id)),
          )
        : [];
      setSemesters(supportedSemesters);

      const period = responseData.enrollment_period || null;
      setLatestPeriod(period);

      if (period) {
        setSelectedAcademicYearId(Number(period.academic_year_id));
        setSelectedSemesterId(Number(period.semester_id));
      } else {
        const currentYear = years.find(
          (year) => year.is_current === true || Number(year.is_current) === 1,
        );

        setSelectedAcademicYearId(
          Number(currentYear?.academic_year_id ?? years[0]?.academic_year_id ?? 0),
        );

        const firstSemester = supportedSemesters.find(
          (semester) => Number(semester.semester_id) === 1,
        );
        setSelectedSemesterId(
          Number(
            firstSemester?.semester_id ??
              supportedSemesters[0]?.semester_id ??
              0,
          ),
        );
      }
    } catch (err) {
      if (err instanceof TypeError) {
        setError(
          "Unable to connect to the enrollment server. Make sure the backend is running on http://localhost:3000.",
        );
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load enrollment period.",
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") return;
    void loadPeriodData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, userRole]);

  const openEnrollment = async () => {
    if (!authenticated || userRole !== "Registrar") {
      setError("Authentication is required.");
      return;
    }

    if (!selectedAcademicYearId) {
      setError("Please select an academic year.");
      return;
    }

    if (!selectedSemesterId) {
      setError("Please select a semester.");
      return;
    }

    if (![1, 2].includes(Number(selectedSemesterId))) {
      setError(
        "Only First Semester and Second Semester are supported for enrollment.",
      );
      return;
    }

    try {
      setActionLoading(true);
      setError("");
      setSuccessMessage("");

      const response = await authService.authFetch(`${API_BASE_URL}/open`, {
        method: "POST",
        body: JSON.stringify({
          academic_year_id: selectedAcademicYearId,
          semester_id: selectedSemesterId,
        }),
      });

      const responseData = await readPeriodResponse(response);
      const canContinue = handleAuthenticationResponse(response, responseData);
      if (!canContinue) return;

      if (!response.ok) {
        throw new Error(
          responseData.message ||
            responseData.error ||
            `Unable to open enrollment (${response.status}).`,
        );
      }

      if (!responseData.success) {
        throw new Error(responseData.message || "Unable to open enrollment.");
      }

      setSuccessMessage(
        responseData.message || "Enrollment period opened successfully.",
      );
      setConfirmationMode(null);
      await loadPeriodData("refresh");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to open enrollment period.",
      );
    } finally {
      setActionLoading(false);
    }
  };

  const closeEnrollment = async () => {
    if (!authenticated || userRole !== "Registrar") {
      setError("Authentication is required.");
      return;
    }

    if (!latestPeriod?.enrollment_period_id || !periodIsOpen) {
      setError("There is no active enrollment period to close.");
      return;
    }

    try {
      setActionLoading(true);
      setError("");
      setSuccessMessage("");

      const response = await authService.authFetch(`${API_BASE_URL}/close`, {
        method: "POST",
        body: JSON.stringify({
          enrollment_period_id: latestPeriod.enrollment_period_id,
        }),
      });

      const responseData = await readPeriodResponse(response);
      const canContinue = handleAuthenticationResponse(response, responseData);
      if (!canContinue) return;

      if (!response.ok) {
        throw new Error(
          responseData.message ||
            responseData.error ||
            `Unable to close enrollment (${response.status}).`,
        );
      }

      if (!responseData.success) {
        throw new Error(responseData.message || "Unable to close enrollment.");
      }

      setSuccessMessage(
        responseData.message || "Enrollment period closed successfully.",
      );
      setConfirmationMode(null);
      await loadPeriodData("refresh");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to close enrollment period.",
      );
    } finally {
      setActionLoading(false);
    }
  };

  const formatDateTime = (date: string | null | undefined) => {
    if (!date) return "Not recorded";
    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime())) return "Not recorded";

    return parsedDate.toLocaleString("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const periodIsOpen = latestPeriod?.status?.trim().toLowerCase() === "open";

  const selectedAcademicYear = useMemo(
    () =>
      academicYears.find(
        (year) =>
          Number(year.academic_year_id) === Number(selectedAcademicYearId),
      ),
    [academicYears, selectedAcademicYearId],
  );

  const selectedSemester = useMemo(
    () =>
      semesters.find(
        (semester) =>
          Number(semester.semester_id) === Number(selectedSemesterId),
      ),
    [semesters, selectedSemesterId],
  );

  const selectionComplete =
    selectedAcademicYearId > 0 && selectedSemesterId > 0;

  const selectedMatchesLatest = Boolean(
    latestPeriod &&
      Number(latestPeriod.academic_year_id) === Number(selectedAcademicYearId) &&
      Number(latestPeriod.semester_id) === Number(selectedSemesterId),
  );

  const openingLabel =
    selectedMatchesLatest && !periodIsOpen
      ? "Reopen Enrollment"
      : "Open Enrollment";

  const currentAcademicYear = academicYears.find(
    (year) => year.is_current === true || Number(year.is_current) === 1,
  );

  if (!authenticated || !user || userRole !== "Registrar") return null;

  if (loading) {
    return (
      <DashboardLayout>
        <div className="registrar-enrollment-period">
          <div className="registrar-enrollment-period__skeleton-hero">
            <div className="registrar-enrollment-period__skeleton-line registrar-enrollment-period__skeleton-line--short" />
            <div className="registrar-enrollment-period__skeleton-line registrar-enrollment-period__skeleton-line--title" />
            <div className="registrar-enrollment-period__skeleton-line" />
          </div>
          <div className="registrar-enrollment-period__skeleton-grid">
            {[1, 2, 3, 4].map((item) => (
              <div
                className="registrar-enrollment-period__skeleton-card"
                key={item}
              />
            ))}
          </div>
          <div className="registrar-enrollment-period__skeleton-panel" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="registrar-enrollment-period">
        <header className="registrar-enrollment-period__hero">
          <div className="registrar-enrollment-period__hero-copy">
            <span className="registrar-enrollment-period__eyebrow">
              <span className="registrar-enrollment-period__eyebrow-icon">
                <CalendarClock size={16} strokeWidth={2.2} />
              </span>
              Registrar · Enrollment
            </span>
            <h1>Enrollment Period</h1>
            <p>
              Control when students can submit enrollment for the active
              academic term.
            </p>
          </div>

          <div className="registrar-enrollment-period__hero-actions">
            <button
              type="button"
              className="registrar-enrollment-period__button registrar-enrollment-period__button--secondary"
              onClick={() => navigate("/registrar/enrollment/management")}
            >
              <ArrowRight size={17} />
              Student Enrollment
            </button>
            <button
              type="button"
              className="registrar-enrollment-period__button registrar-enrollment-period__button--secondary"
              onClick={() => void loadPeriodData("refresh")}
              disabled={refreshing || actionLoading}
            >
              <RefreshCw
                size={17}
                className={refreshing ? "is-spinning" : undefined}
              />
              Refresh
            </button>
          </div>
        </header>

        {error && (
          <div
            className="registrar-enrollment-period__notice registrar-enrollment-period__notice--error"
            role="alert"
          >
            <AlertCircle size={20} />
            <div>
              <strong>Enrollment period action failed</strong>
              <p>{error}</p>
            </div>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={18} />
            </button>
          </div>
        )}

        {successMessage && (
          <div
            className="registrar-enrollment-period__notice registrar-enrollment-period__notice--success"
            role="status"
          >
            <CheckCircle2 size={20} />
            <div>
              <strong>Enrollment period updated</strong>
              <p>{successMessage}</p>
            </div>
            <button
              type="button"
              aria-label="Dismiss success message"
              onClick={() => setSuccessMessage("")}
            >
              <X size={18} />
            </button>
          </div>
        )}

        <section className="registrar-enrollment-period__summary-grid">
          <article
            className={`registrar-enrollment-period__summary-card ${
              periodIsOpen
                ? "registrar-enrollment-period__summary-card--open"
                : "registrar-enrollment-period__summary-card--closed"
            }`}
          >
            <div className="registrar-enrollment-period__summary-icon">
              {periodIsOpen ? <UnlockKeyhole /> : <LockKeyhole />}
            </div>
            <div>
              <span>Enrollment Access</span>
              <strong>{periodIsOpen ? "Open" : "Closed"}</strong>
              <small>
                {periodIsOpen
                  ? "Students may submit prepared enrollment"
                  : "Student submission is currently disabled"}
              </small>
            </div>
          </article>

          <article className="registrar-enrollment-period__summary-card">
            <div className="registrar-enrollment-period__summary-icon">
              <CalendarDays />
            </div>
            <div>
              <span>Academic Year</span>
              <strong>
                {periodIsOpen
                  ? latestPeriod?.academic_year
                  : currentAcademicYear?.academic_year || "Not set"}
              </strong>
              <small>
                {periodIsOpen ? "Open enrollment period" : "Current academic year"}
              </small>
            </div>
          </article>

          <article className="registrar-enrollment-period__summary-card">
            <div className="registrar-enrollment-period__summary-icon">
              <CalendarClock />
            </div>
            <div>
              <span>Semester</span>
              <strong>
                {periodIsOpen ? latestPeriod?.semester_name : "Not open"}
              </strong>
              <small>First and Second Semester only</small>
            </div>
          </article>

          <article className="registrar-enrollment-period__summary-card">
            <div className="registrar-enrollment-period__summary-icon">
              <History />
            </div>
            <div>
              <span>Latest Period Record</span>
              <strong>
                {latestPeriod
                  ? `#${latestPeriod.enrollment_period_id}`
                  : "None yet"}
              </strong>
              <small>
                {latestPeriod
                  ? `${latestPeriod.academic_year} · ${latestPeriod.semester_name}`
                  : "No enrollment-period history returned"}
              </small>
            </div>
          </article>
        </section>

        <div className="registrar-enrollment-period__workspace-grid">
          <section className="registrar-enrollment-period__panel registrar-enrollment-period__panel--status">
            <div className="registrar-enrollment-period__panel-header">
              <div>
                <span className="registrar-enrollment-period__section-label">
                  Latest Period Record
                </span>
                <h2>
                  {latestPeriod
                    ? `${latestPeriod.academic_year} · ${latestPeriod.semester_name}`
                    : "No period record available"}
                </h2>
                <p>
                  Review the most recent enrollment-period state returned by the
                  system.
                </p>
              </div>
              <span
                className={`registrar-enrollment-period__status-pill ${
                  periodIsOpen
                    ? "registrar-enrollment-period__status-pill--open"
                    : "registrar-enrollment-period__status-pill--closed"
                }`}
              >
                <span />
                {periodIsOpen ? "Open" : "Closed"}
              </span>
            </div>

            {latestPeriod ? (
              <>
                <div className="registrar-enrollment-period__audit-grid">
                  <div className="registrar-enrollment-period__audit-item">
                    <CalendarDays size={18} />
                    <div>
                      <span>Academic Year</span>
                      <strong>{latestPeriod.academic_year}</strong>
                    </div>
                  </div>
                  <div className="registrar-enrollment-period__audit-item">
                    <CalendarClock size={18} />
                    <div>
                      <span>Semester</span>
                      <strong>{latestPeriod.semester_name}</strong>
                    </div>
                  </div>
                  <div className="registrar-enrollment-period__audit-item">
                    <UserRound size={18} />
                    <div>
                      <span>Opened By</span>
                      <strong>
                        {latestPeriod.opened_by_username ||
                          (latestPeriod.opened_by
                            ? `User #${latestPeriod.opened_by}`
                            : "Not recorded")}
                      </strong>
                    </div>
                  </div>
                  <div className="registrar-enrollment-period__audit-item">
                    <Clock3 size={18} />
                    <div>
                      <span>Opened At</span>
                      <strong>{formatDateTime(latestPeriod.opened_at)}</strong>
                    </div>
                  </div>

                  {!periodIsOpen && (
                    <>
                      <div className="registrar-enrollment-period__audit-item">
                        <UserRound size={18} />
                        <div>
                          <span>Closed By</span>
                          <strong>
                            {latestPeriod.closed_by_username ||
                              (latestPeriod.closed_by
                                ? `User #${latestPeriod.closed_by}`
                                : "Not recorded")}
                          </strong>
                        </div>
                      </div>
                      <div className="registrar-enrollment-period__audit-item">
                        <Clock3 size={18} />
                        <div>
                          <span>Closed At</span>
                          <strong>{formatDateTime(latestPeriod.closed_at)}</strong>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {latestPeriod.remarks && (
                  <div className="registrar-enrollment-period__remarks">
                    <Info size={18} />
                    <div>
                      <span>Period Remarks</span>
                      <p>{latestPeriod.remarks}</p>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="registrar-enrollment-period__empty-state">
                <div>
                  <CalendarClock size={26} />
                </div>
                <h3>No enrollment period yet</h3>
                <p>
                  Choose an academic year and semester in Period Configuration
                  to open the first supported enrollment period.
                </p>
              </div>
            )}
          </section>

          <section className="registrar-enrollment-period__panel registrar-enrollment-period__panel--configuration">
            <div className="registrar-enrollment-period__panel-header">
              <div>
                <span className="registrar-enrollment-period__section-label">
                  Period Configuration
                </span>
                <h2>{periodIsOpen ? "Enrollment is Active" : "Open Enrollment"}</h2>
                <p>
                  {periodIsOpen
                    ? "Close the active period before another academic term can be opened."
                    : "Select the academic year and semester students will enroll in."}
                </p>
              </div>
              <div className="registrar-enrollment-period__panel-icon">
                {periodIsOpen ? <DoorOpen /> : <CalendarClock />}
              </div>
            </div>

            <div className="registrar-enrollment-period__form-grid">
              <label className="registrar-enrollment-period__field">
                <span>Academic Year</span>
                <select
                  value={selectedAcademicYearId}
                  onChange={(event) => {
                    setSelectedAcademicYearId(Number(event.target.value));
                    setError("");
                    setSuccessMessage("");
                  }}
                  disabled={actionLoading || periodIsOpen}
                >
                  <option value={0}>Select Academic Year</option>
                  {academicYears.map((year) => (
                    <option
                      key={year.academic_year_id}
                      value={year.academic_year_id}
                    >
                      {year.academic_year}
                      {year.is_current === true || Number(year.is_current) === 1
                        ? " — Current"
                        : ""}
                    </option>
                  ))}
                </select>
                <small>
                  Opening a period makes its academic year the current year.
                </small>
              </label>

              <label className="registrar-enrollment-period__field">
                <span>Semester</span>
                <select
                  value={selectedSemesterId}
                  onChange={(event) => {
                    setSelectedSemesterId(Number(event.target.value));
                    setError("");
                    setSuccessMessage("");
                  }}
                  disabled={actionLoading || periodIsOpen}
                >
                  <option value={0}>Select Semester</option>
                  {semesters.map((semester) => (
                    <option
                      key={semester.semester_id}
                      value={semester.semester_id}
                    >
                      {semester.semester_name}
                    </option>
                  ))}
                </select>
                <small>Summer is intentionally excluded from enrollment.</small>
              </label>
            </div>

            {selectionComplete && (
              <div className="registrar-enrollment-period__selection-preview">
                <div>
                  <span>Selected Enrollment Period</span>
                  <strong>
                    {selectedAcademicYear?.academic_year || "—"} ·{" "}
                    {selectedSemester?.semester_name || "—"}
                  </strong>
                </div>
                {selectedMatchesLatest && !periodIsOpen && (
                  <span className="registrar-enrollment-period__reopen-badge">
                    <RotateCcw size={15} />
                    Existing closed period
                  </span>
                )}
              </div>
            )}

            <div className="registrar-enrollment-period__action-area">
              {periodIsOpen ? (
                <>
                  <div className="registrar-enrollment-period__action-copy registrar-enrollment-period__action-copy--warning">
                    <LockKeyhole size={20} />
                    <div>
                      <strong>Close student enrollment access</strong>
                      <p>
                        Students will no longer be able to submit prepared
                        enrollment after this period is closed.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="registrar-enrollment-period__button registrar-enrollment-period__button--danger"
                    onClick={() => {
                      setError("");
                      setSuccessMessage("");
                      setConfirmationMode("close");
                    }}
                    disabled={actionLoading}
                  >
                    <LockKeyhole size={17} />
                    Close Enrollment
                  </button>
                </>
              ) : (
                <>
                  <div className="registrar-enrollment-period__action-copy">
                    <UnlockKeyhole size={20} />
                    <div>
                      <strong>Enable student enrollment access</strong>
                      <p>
                        Students can submit their prepared enrollment while this
                        period remains open.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="registrar-enrollment-period__button registrar-enrollment-period__button--primary"
                    onClick={() => {
                      if (!selectionComplete) {
                        setError("Please select an academic year and semester.");
                        return;
                      }
                      setError("");
                      setSuccessMessage("");
                      setConfirmationMode("open");
                    }}
                    disabled={actionLoading || !selectionComplete}
                  >
                    {selectedMatchesLatest ? (
                      <RotateCcw size={17} />
                    ) : (
                      <UnlockKeyhole size={17} />
                    )}
                    {openingLabel}
                  </button>
                </>
              )}
            </div>
          </section>
        </div>

        <section className="registrar-enrollment-period__rules">
          <div className="registrar-enrollment-period__rules-header">
            <div className="registrar-enrollment-period__rules-icon">
              <ShieldCheck size={22} />
            </div>
            <div>
              <span className="registrar-enrollment-period__section-label">
                Enrollment Controls
              </span>
              <h2>Operational Rules</h2>
              <p>
                These rules reflect the existing enrollment-period behavior in
                the PTC Portal.
              </p>
            </div>
          </div>

          <div className="registrar-enrollment-period__rules-grid">
            <div className="registrar-enrollment-period__rule-item">
              <UnlockKeyhole size={18} />
              <div>
                <strong>Open period required</strong>
                <p>Students can submit enrollment only while access is Open.</p>
              </div>
            </div>
            <div className="registrar-enrollment-period__rule-item">
              <CalendarDays size={18} />
              <div>
                <strong>Two supported semesters</strong>
                <p>Only First Semester and Second Semester are included.</p>
              </div>
            </div>
            <div className="registrar-enrollment-period__rule-item">
              <ShieldCheck size={18} />
              <div>
                <strong>Registrar-controlled placement</strong>
                <p>Students cannot select or change their assigned sections.</p>
              </div>
            </div>
            <div className="registrar-enrollment-period__rule-item">
              <RotateCcw size={18} />
              <div>
                <strong>Safe reopening</strong>
                <p>
                  Reopening the same term updates its existing record instead of
                  creating a duplicate.
                </p>
              </div>
            </div>
          </div>
        </section>

        {confirmationMode && (
          <div
            className="registrar-enrollment-period__modal-overlay"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !actionLoading) {
                setConfirmationMode(null);
              }
            }}
          >
            <div
              className="registrar-enrollment-period__modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="enrollment-period-confirmation-title"
            >
              <button
                type="button"
                className="registrar-enrollment-period__modal-close"
                aria-label="Close confirmation"
                onClick={() => setConfirmationMode(null)}
                disabled={actionLoading}
              >
                <X size={19} />
              </button>

              <div
                className={`registrar-enrollment-period__modal-icon ${
                  confirmationMode === "close"
                    ? "registrar-enrollment-period__modal-icon--danger"
                    : ""
                }`}
              >
                {confirmationMode === "open" ? (
                  selectedMatchesLatest ? (
                    <RotateCcw size={25} />
                  ) : (
                    <UnlockKeyhole size={25} />
                  )
                ) : (
                  <LockKeyhole size={25} />
                )}
              </div>

              <span className="registrar-enrollment-period__modal-eyebrow">
                {confirmationMode === "open"
                  ? selectedMatchesLatest
                    ? "Reopen Enrollment"
                    : "Open Enrollment"
                  : "Close Enrollment"}
              </span>
              <h2 id="enrollment-period-confirmation-title">
                {confirmationMode === "open"
                  ? selectedMatchesLatest
                    ? "Reopen this enrollment period?"
                    : "Open this enrollment period?"
                  : "Close the active enrollment period?"}
              </h2>
              <p>
                {confirmationMode === "open"
                  ? "Student enrollment submission will become available for the selected academic term."
                  : "Student enrollment submission will become unavailable immediately after closing the period."}
              </p>

              <div className="registrar-enrollment-period__modal-period">
                <CalendarDays size={19} />
                <div>
                  <span>Enrollment Period</span>
                  <strong>
                    {confirmationMode === "open"
                      ? `${selectedAcademicYear?.academic_year || "—"} · ${selectedSemester?.semester_name || "—"}`
                      : `${latestPeriod?.academic_year || "—"} · ${latestPeriod?.semester_name || "—"}`}
                  </strong>
                </div>
              </div>

              {confirmationMode === "open" ? (
                <div className="registrar-enrollment-period__modal-note">
                  <Info size={17} />
                  <p>
                    The selected academic year will become the current academic
                    year. Only one supported enrollment period can be Open.
                  </p>
                </div>
              ) : (
                <div className="registrar-enrollment-period__modal-note registrar-enrollment-period__modal-note--warning">
                  <CircleOff size={17} />
                  <p>
                    Prepared enrollments already in the system remain available
                    for Registrar review, but students cannot submit while the
                    period is Closed.
                  </p>
                </div>
              )}

              <div className="registrar-enrollment-period__modal-actions">
                <button
                  type="button"
                  className="registrar-enrollment-period__button registrar-enrollment-period__button--secondary"
                  onClick={() => setConfirmationMode(null)}
                  disabled={actionLoading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`registrar-enrollment-period__button ${
                    confirmationMode === "close"
                      ? "registrar-enrollment-period__button--danger"
                      : "registrar-enrollment-period__button--primary"
                  }`}
                  onClick={() =>
                    confirmationMode === "open"
                      ? void openEnrollment()
                      : void closeEnrollment()
                  }
                  disabled={actionLoading}
                >
                  {actionLoading ? (
                    <>
                      <Loader2 size={17} className="is-spinning" />
                      Processing...
                    </>
                  ) : confirmationMode === "open" ? (
                    <>
                      {selectedMatchesLatest ? (
                        <RotateCcw size={17} />
                      ) : (
                        <UnlockKeyhole size={17} />
                      )}
                      {openingLabel}
                    </>
                  ) : (
                    <>
                      <LockKeyhole size={17} />
                      Yes, Close Enrollment
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
