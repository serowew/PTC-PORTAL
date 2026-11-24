import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CalendarDays, Plus, CheckCircle2 } from "lucide-react";
import { apiUrl } from "../../../services/api";
import { authService } from "../../../services/auth.service";

type Year = {
  academic_year_id: number;
  academic_year: string;
  is_current: boolean;
};

type Period = {
  admissionPeriodId: number;
  title: string;
  academicYear: string;
  startsAt: string;
  endsAt: string;
  status: "Draft" | "Published";
  isOpen: boolean | number;
};

const PERIODS_API = apiUrl("/api/admission-periods");
const YEARS_API = apiUrl("/api/registrar/academic-years");

function manilaDateTime(minutesFromNow: number) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(Date.now() + minutesFromNow * 60_000));

  const get = (name: string) =>
    parts.find((item) => item.type === name)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

async function request<T>(
  url: string,
  method = "GET",
  body?: object,
): Promise<T> {
  const response = await authService.authFetch(url, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data = (await response.json()) as {
    success?: boolean;
    message?: string;
  };

  if (!response.ok || data.success === false) {
    throw new Error(data.message || `Request failed (${response.status}).`);
  }

  return data as unknown as T;
}

export default function AdmissionPeriodsPanel() {
  const [years, setYears] = useState<Year[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [form, setForm] = useState({
    academicYearId: "",
    title: "QA Admission - One Student",
    startsAt: manilaDateTime(-5),
    endsAt: manilaDateTime(7 * 24 * 60),
  });

  const reload = useCallback(async () => {
    setLoading(true);

    try {
      const [periodResult, yearResult] = await Promise.all([
        request<{ periods: Period[] }>(PERIODS_API),
        request<{ academic_years: Year[] }>(YEARS_API),
      ]);

      const options = yearResult.academic_years ?? [];

      setYears(options);
      setPeriods(periodResult.periods ?? []);

      setForm((previous) => ({
        ...previous,
        academicYearId:
          previous.academicYearId ||
          String(
            options.find((year) => year.is_current)?.academic_year_id ??
              options[0]?.academic_year_id ??
              "",
          ),
      }));

      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load admission periods.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setNotice("");
    setError("");

    if (
      !form.academicYearId ||
      !form.title.trim() ||
      !form.startsAt ||
      form.endsAt <= form.startsAt
    ) {
      setError(
        "Select an academic year and enter a title and valid start/deadline.",
      );
      return;
    }

    setBusy(true);

    try {
      await request(PERIODS_API, "POST", {
        academicYearId: Number(form.academicYearId),
        title: form.title.trim(),
        startsAt: form.startsAt,
        endsAt: form.endsAt,
      });

      await reload();

      setNotice(
        "Admission period created as Draft. Publish it below to open applications.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not create admission period.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function publish(period: Period) {
    if (
      busy ||
      !window.confirm(`Publish "${period.title}" for public applicants?`)
    ) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      await request(
        `${PERIODS_API}/${period.admissionPeriodId}/publish`,
        "POST",
      );

      await reload();

      setNotice(
        "Admission period published. Public registration follows its start and end dates.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not publish admission period.",
      );
    } finally {
      setBusy(false);
    }
  }

  function state(period: Period) {
    if (period.status === "Draft") return "Draft";
    if (period.isOpen) return "Open";

    return period.startsAt > manilaDateTime(0) ? "Scheduled" : "Closed";
  }

  return (
    <section className="registrar-student-list__panel registrar-admission-periods">
      <div className="registrar-student-list__panel-heading">
        <div>
          <h2>
            <CalendarDays size={19} aria-hidden="true" /> Admission Periods
          </h2>
          <p>
            Create a period, then publish it so students can use Online
            Admission.
          </p>
        </div>
      </div>

      <div className="registrar-admission-periods__layout">
        <form
          className="registrar-admission-periods__form"
          onSubmit={(event) => void createDraft(event)}
        >
          <h3>Create Admission Period</h3>

          <label>
            Academic Year
            <select
              required
              disabled={loading || busy}
              value={form.academicYearId}
              onChange={(event) =>
                setForm((old) => ({
                  ...old,
                  academicYearId: event.target.value,
                }))
              }
            >
              <option value="">Select academic year</option>
              {years.map((year) => (
                <option
                  key={year.academic_year_id}
                  value={year.academic_year_id}
                >
                  {year.academic_year}
                  {year.is_current ? " (Current)" : ""}
                </option>
              ))}
            </select>
          </label>

          <label>
            Period Title
            <input
              required
              maxLength={120}
              disabled={loading || busy}
              value={form.title}
              onChange={(event) =>
                setForm((old) => ({
                  ...old,
                  title: event.target.value,
                }))
              }
            />
          </label>

          <div className="registrar-admission-periods__dates">
            <label>
              Start (Manila time)
              <input
                required
                type="datetime-local"
                disabled={loading || busy}
                value={form.startsAt}
                onChange={(event) =>
                  setForm((old) => ({
                    ...old,
                    startsAt: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              Deadline (Manila time)
              <input
                required
                type="datetime-local"
                disabled={loading || busy}
                value={form.endsAt}
                onChange={(event) =>
                  setForm((old) => ({
                    ...old,
                    endsAt: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={loading || busy || !years.length}
            className="registrar-student-list__action registrar-student-list__action--primary"
          >
            <Plus size={16} />
            {busy ? "Saving..." : "Create Draft"}
          </button>
        </form>

        <div className="registrar-admission-periods__existing">
          <h3>Existing Admission Periods</h3>

          {loading && <p>Loading periods...</p>}

          {!loading && !periods.length && <p>No admission periods yet.</p>}

          {!loading &&
            periods.map((period) => (
              <article
                key={period.admissionPeriodId}
                className="registrar-admission-periods__item"
              >
                <div>
                  <strong>{period.title}</strong>

                  <small>
                    {period.academicYear} · {period.startsAt.replace("T", " ")}{" "}
                    – {period.endsAt.replace("T", " ")}
                  </small>

                  <span
                    className={`registrar-admission-periods__status registrar-admission-periods__status--${state(period).toLowerCase()}`}
                  >
                    {state(period)}
                  </span>
                </div>

                {period.status === "Draft" &&
                  period.endsAt > manilaDateTime(0) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void publish(period)}
                      className="registrar-student-list__action registrar-student-list__action--primary"
                    >
                      <CheckCircle2 size={16} />
                      Publish
                    </button>
                  )}
              </article>
            ))}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="registrar-admission-periods__message registrar-admission-periods__message--error"
        >
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className="registrar-admission-periods__message">
          {notice}
        </p>
      )}
    </section>
  );
}
