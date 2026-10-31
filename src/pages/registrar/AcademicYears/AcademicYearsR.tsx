import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  History,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { apiUrl } from "../../../services/api";
import { authService } from "../../../services/auth.service";
import "../../../styles/AcademicYearsR.css";

type AcademicYear = {
  academic_year_id: number;
  academic_year: string;
  is_current: boolean;
  period_count: number;
  open_period_count: number;
  closed_period_count: number;
};

type AcademicYearsResponse = {
  success?: boolean;
  message?: string;
  academic_years?: AcademicYear[];
};

type CreateAcademicYearResponse = {
  success?: boolean;
  message?: string;
  academic_year?: AcademicYear;
};

const API_URL = apiUrl("/api/registrar/academic-years");

export default function AcademicYearsR() {
  const navigate = useNavigate();
  const session = authService.getSession();
  const authenticated = Boolean(session && authService.getToken());
  const isRegistrar = session?.role === "Registrar";

  const [years, setYears] = useState<AcademicYear[]>([]);
  const [startYear, setStartYear] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const modalRef = useRef<HTMLElement>(null);
  const modalCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }
    if (!isRegistrar && session) {
      navigate(authService.getDashboardRoute(session.role), { replace: true });
    }
  }, [authenticated, isRegistrar, navigate, session]);

  const loadYears = useCallback(async (refresh = false) => {
    if (!authenticated || !isRegistrar) return;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const response = await authService.authFetch(API_URL, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const data = (await response.json()) as AcademicYearsResponse;

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return;
      }
      if (!response.ok || !data.success || !Array.isArray(data.academic_years)) {
        throw new Error(data.message || "Unable to load academic years.");
      }

      setYears(data.academic_years);
      const newestStartYear = data.academic_years.reduce((latest, item) => {
        const year = /^(\d{4})-(\d{4})$/.exec(item.academic_year);
        return year ? Math.max(latest, Number(year[1])) : latest;
      }, 0);
      setStartYear((previous) =>
        previous || String(newestStartYear ? newestStartYear + 1 : new Date().getFullYear()),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load academic years.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authenticated, isRegistrar, navigate]);

  useEffect(() => {
    void loadYears();
  }, [loadYears]);

  useEffect(() => {
    if (!confirmOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modalCloseRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        setConfirmOpen(false);
      }
      if (event.key !== "Tab" || saving || !modalRef.current) return;

      const focusable = Array.from(
        modalRef.current.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [confirmOpen, saving]);

  const start = Number(startYear);
  const validStart = /^\d{4}$/.test(startYear) && start >= 1900 && start <= 2199;
  const newYear = validStart ? `${start}-${start + 1}` : "";
  const duplicate = years.some((year) => year.academic_year === newYear);
  const canCreate = Boolean(newYear) && !duplicate && !saving && !loading && !refreshing;
  const current = years.find((year) => year.is_current);
  const filteredYears = useMemo(
    () => years.filter((year) => year.academic_year.includes(search.trim())),
    [years, search],
  );

  const createYear = async () => {
    if (!canCreate) return;
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await authService.authFetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ academic_year: newYear }),
      });
      const data = (await response.json()) as CreateAcademicYearResponse;

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return;
      }
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to create academic year.");
      }

      setConfirmOpen(false);
      setSuccess(data.message || `Academic year ${newYear} created successfully.`);
      setStartYear(String(start + 1));
      await loadYears(true);
    } catch (caught) {
      setConfirmOpen(false);
      setError(caught instanceof Error ? caught.message : "Unable to create academic year.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <main className="registrar-academic-years">
        <header className="ayr-hero">
          <div className="ayr-hero-copy">
            <div className="ayr-eyebrow">
              <CalendarDays size={15} /> Registrar · Academic Management
            </div>
            <h1>Academic Years</h1>
            <p>
              Create and review academic-year records. Opening student enrollment
              remains a separate Registrar action.
            </p>
          </div>
          <div className="ayr-hero-actions">
            <button
              type="button"
              className="ayr-hero-button"
              onClick={() => navigate("/registrar/enrollment/periodM")}
            >
              Enrollment Period <ArrowRight size={16} />
            </button>
            <button
              type="button"
              className="ayr-hero-button"
              disabled={loading || refreshing}
              onClick={() => void loadYears(true)}
            >
              <RefreshCw size={16} className={refreshing ? "ayr-spin" : ""} />
              Refresh
            </button>
          </div>
        </header>

        {error && (
          <div role="alert" className="ayr-alert ayr-alert-error">
            <AlertCircle size={19} />
            <span>{error}</span>
            <button type="button" aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={17} />
            </button>
          </div>
        )}
        {success && (
          <div role="status" className="ayr-alert ayr-alert-success">
            <CheckCircle2 size={19} />
            <span>{success}</span>
            <button type="button" aria-label="Dismiss notification" onClick={() => setSuccess("")}>
              <X size={17} />
            </button>
          </div>
        )}

        <section className="ayr-stats" aria-label="Academic year summary">
          <div className="ayr-stat ayr-stat-green">
            <CalendarDays size={22} />
            <div>
              <span>Current academic year</span>
              <strong>{loading ? "Loading…" : current?.academic_year || "Not assigned"}</strong>
            </div>
          </div>
          <div className="ayr-stat ayr-stat-blue">
            <History size={22} />
            <div>
              <span>Academic years recorded</span>
              <strong>{loading ? "—" : years.length}</strong>
            </div>
          </div>
          <div className="ayr-stat ayr-stat-gold">
            <Clock3 size={22} />
            <div>
              <span>Open enrollment periods</span>
              <strong>
                {loading ? "—" : years.reduce((sum, year) => sum + year.open_period_count, 0)}
              </strong>
            </div>
          </div>
        </section>

        <div className="ayr-content">
          <section className="ayr-panel ayr-create" aria-labelledby="ayr-create-heading">
            <div className="ayr-panel-heading">
              <div>
                <span className="ayr-section-kicker">Academic setup</span>
                <h2 id="ayr-create-heading">Add academic year</h2>
                <p>For example, entering 2027 creates AY 2027–2028.</p>
              </div>
              <span className="ayr-panel-icon"><Plus size={20} /></span>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (canCreate) setConfirmOpen(true);
              }}
            >
              <label htmlFor="ayr-start">Start year</label>
              <div className="ayr-year-inputs">
                <input
                  id="ayr-start"
                  type="number"
                  min="1900"
                  max="2199"
                  inputMode="numeric"
                  value={startYear}
                  onChange={(event) => setStartYear(event.target.value)}
                  placeholder="2027"
                  required
                />
                <span>to</span>
                <output aria-label="End year">{validStart ? start + 1 : "—"}</output>
              </div>
              <div className="ayr-preview">
                <CalendarDays size={20} />
                <div>
                  <span>New academic year</span>
                  <strong>{newYear || "Enter a valid four-digit start year"}</strong>
                </div>
              </div>
              {duplicate && (
                <p className="ayr-validation" role="alert">
                  This academic year already exists.
                </p>
              )}
              {!duplicate && startYear !== "" && !validStart && (
                <p className="ayr-validation" role="alert">
                  Enter a start year between 1900 and 2199.
                </p>
              )}
              <button type="submit" className="ayr-primary" disabled={!canCreate}>
                <Plus size={17} /> Create academic year
              </button>
            </form>
            <div className="ayr-note">
              <ShieldCheck size={18} />
              <p>
                Creating a year does not open enrollment, advance students,
                change the current year, or modify previous academic records.
              </p>
            </div>
          </section>

          <section className="ayr-panel ayr-directory" aria-labelledby="ayr-list-heading">
            <div className="ayr-panel-heading">
              <div>
                <span className="ayr-section-kicker">Year directory</span>
                <h2 id="ayr-list-heading">Academic year history</h2>
                <p>Previously created years stay available for enrollment and record review.</p>
              </div>
            </div>
            <label className="ayr-search-label" htmlFor="ayr-search">
              Search academic years
            </label>
            <input
              id="ayr-search"
              className="ayr-search"
              type="search"
              placeholder="Search, e.g. 2026-2027"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="ayr-table-scroll">
              <table className="ayr-table">
                <thead>
                  <tr>
                    <th>Academic year</th>
                    <th>Status</th>
                    <th>Periods</th>
                    <th>Enrollment</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="ayr-empty">
                        <Loader2 className="ayr-spin" size={20} /> Loading academic years…
                      </td>
                    </tr>
                  ) : filteredYears.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="ayr-empty">
                        No matching academic years found.
                      </td>
                    </tr>
                  ) : (
                    filteredYears.map((year) => (
                      <tr key={year.academic_year_id}>
                        <td>
                          <strong>{year.academic_year}</strong>
                          <small>ID #{year.academic_year_id}</small>
                        </td>
                        <td>
                          <span className={`ayr-pill ${year.is_current ? "ayr-pill-current" : ""}`}>
                            {year.is_current ? "Current" : "Historical / upcoming"}
                          </span>
                        </td>
                        <td>
                          {year.period_count} <small>recorded</small>
                        </td>
                        <td>
                          <span className={`ayr-pill ${year.open_period_count ? "ayr-pill-open" : ""}`}>
                            {year.open_period_count > 0
                              ? "Open"
                              : year.period_count > 0
                                ? "Closed"
                                : "Not started"}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="ayr-table-note">
              The Current label is assigned when the Registrar opens an enrollment
              period for that year.
            </p>
          </section>
        </div>

        {confirmOpen && (
          <div
            className="ayr-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !saving) setConfirmOpen(false);
            }}
          >
            <section
              ref={modalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="ayr-confirm-heading"
              aria-describedby="ayr-confirm-desc"
              className="ayr-modal"
            >
              <div className="ayr-modal-top">
                <span className="ayr-modal-icon"><CalendarDays size={22} /></span>
                <button
                  ref={modalCloseRef}
                  type="button"
                  aria-label="Close"
                  disabled={saving}
                  onClick={() => setConfirmOpen(false)}
                >
                  <X size={19} />
                </button>
              </div>
              <h2 id="ayr-confirm-heading">Create academic year {newYear}?</h2>
              <p id="ayr-confirm-desc">
                This adds the year to the Registrar catalog. It will not open
                enrollment, set the current academic year, or alter existing student records.
              </p>
              <div className="ayr-modal-actions">
                <button
                  type="button"
                  className="ayr-cancel"
                  disabled={saving}
                  onClick={() => setConfirmOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="ayr-primary"
                  disabled={saving}
                  onClick={() => void createYear()}
                >
                  {saving ? <Loader2 size={17} className="ayr-spin" /> : <CheckCircle2 size={17} />}
                  Confirm creation
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}
