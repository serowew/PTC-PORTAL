import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  LockKeyhole,
  RotateCcw,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { authService } from "../../../services/auth.service";
import { api } from "../../../services/api";
import "../../../styles/CombinedSubmissionPeriods.css";

type PeriodAction = "OPEN" | "CLOSE" | "REOPEN" | "CHANGE_DEADLINE";

type SemesterPeriod = {
  period_id: number;
  department_id: number;
  academic_year_id: number;
  semester_id: number;
  period_status: "OPEN" | "CLOSED";
  reopen_count: number;
  record_version: number;
  opened_at: string | null;
  closed_at: string | null;
  submission_deadline_at: string | null;
  database_now: string;
  deadline_passed: boolean;
  can_submit_within_window: boolean;
  grading_scope: "FULL_SEMESTER";
};

type ClassPeriod = {
  academic_period: {
    academic_year_id: number;
    academic_year: string;
    semester_id: number;
    semester_name: string;
  };
};

type SemesterScope = {
  key: string;
  academic_year_id: number;
  academic_year: string;
  semester_id: number;
  semester_name: string;
};

type PeriodListResult = {
  success: boolean;
  periods?: SemesterPeriod[];
  code?: string;
  message?: string;
};

type ClassesResult = {
  success: boolean;
  classes?: ClassPeriod[];
  code?: string;
  message?: string;
};

type PeriodWriteResult = {
  success: boolean;
  period?: SemesterPeriod;
  audit_event?: string;
  code?: string;
  message?: string;
};

async function readPeriodResponse<T>(response: Response): Promise<T> {
  const type = response.headers.get("content-type") ?? "";

  if (!type.includes("application/json")) {
    throw new Error(`Unexpected server response (${response.status}).`);
  }

  return response.json() as Promise<T>;
}

function toDatabaseDeadline(value: string): string | null {
  const trimmed = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return null;
  }

  const [date, time] = trimmed.split("T");
  const normalized = `${date} ${time}:00`;
  const parsed = new Date(`${trimmed}:00`);

  if (Number.isNaN(parsed.valueOf())) return null;

  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(3, 5));

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() + 1 !== month ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute
  ) {
    return null;
  }

  return normalized;
}

export default function CombinedSubmissionPeriods() {
  const navigate = useNavigate();

  const [periods, setPeriods] = useState<SemesterPeriod[]>([]);
  const [classes, setClasses] = useState<ClassPeriod[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [deadline, setDeadline] = useState("");
  const [reason, setReason] = useState("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => {
    setReloadKey((current) => current + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError("");

    const load = async () => {
      try {
        const [periodResponse, classResponse] = await Promise.all([
          authService.authFetch(
            api.url("/api/program-head/gradebook/semester-submission-periods"),
            { signal: controller.signal },
          ),
          authService.authFetch(api.url("/api/program-head/classes"), {
            signal: controller.signal,
          }),
        ]);

        const [periodData, classData] = await Promise.all([
          readPeriodResponse<PeriodListResult>(periodResponse),
          readPeriodResponse<ClassesResult>(classResponse),
        ]);

        if (controller.signal.aborted) return;

        if (periodResponse.status === 401 || classResponse.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (
          !periodResponse.ok ||
          !periodData.success ||
          !Array.isArray(periodData.periods) ||
          !classResponse.ok ||
          !classData.success ||
          !Array.isArray(classData.classes)
        ) {
          throw new Error(
            periodData.message ||
              classData.message ||
              "Unable to load submission windows.",
          );
        }

        setPeriods(periodData.periods);
        setClasses(classData.classes);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load submission windows.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => controller.abort();
  }, [navigate, reloadKey]);

  const scopes = useMemo(() => {
    const byKey = new Map<string, SemesterScope>();

    for (const item of classes) {
      const academic = item?.academic_period;

      if (
        !academic ||
        !Number.isSafeInteger(academic.academic_year_id) ||
        !Number.isSafeInteger(academic.semester_id)
      ) {
        continue;
      }

      const key = `${academic.academic_year_id}:${academic.semester_id}`;

      byKey.set(key, {
        key,
        ...academic,
      });
    }

    for (const period of periods) {
      const key = `${period.academic_year_id}:${period.semester_id}`;

      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          academic_year_id: period.academic_year_id,
          academic_year: `Academic Year #${period.academic_year_id}`,
          semester_id: period.semester_id,
          semester_name: `Semester #${period.semester_id}`,
        });
      }
    }

    return [...byKey.values()].sort(
      (a, b) =>
        b.academic_year_id - a.academic_year_id ||
        a.semester_id - b.semester_id,
    );
  }, [classes, periods]);

  const currentScope =
    scopes.find((item) => item.key === selectedKey) ?? scopes[0];

  const currentPeriod = periods.find(
    (item) =>
      item.academic_year_id === currentScope?.academic_year_id &&
      item.semester_id === currentScope?.semester_id,
  );

  const isActive = currentPeriod?.can_submit_within_window === true;

  const isExpired = currentPeriod?.deadline_passed === true;

  const canOpen =
    !!currentPeriod &&
    currentPeriod.period_status === "CLOSED" &&
    currentPeriod.opened_at === null &&
    currentPeriod.closed_at === null;

  const canReopen =
    !!currentPeriod &&
    currentPeriod.period_status === "CLOSED" &&
    currentPeriod.opened_at !== null &&
    currentPeriod.closed_at !== null;

  const canChangeDeadline =
    !!currentPeriod && currentPeriod.period_status === "OPEN" && !isExpired;

  const deadlineValue = toDatabaseDeadline(deadline);
  const reasonValid = reason.trim().length <= 1000;

  const performAction = async (action: "CREATE" | PeriodAction) => {
    if (busy || !currentScope || !reasonValid || loading) {
      return;
    }

    if (action !== "CREATE" && !currentPeriod) return;

    if (
      ["OPEN", "REOPEN", "CHANGE_DEADLINE"].includes(action) &&
      !deadlineValue
    ) {
      setError("Choose a valid submission deadline.");
      return;
    }

    if (
      ["REOPEN", "CHANGE_DEADLINE"].includes(action) &&
      reason.trim().length < 5
    ) {
      setError("Give a reason of at least 5 characters for this change.");
      return;
    }

    const current = currentPeriod;

    const label =
      `${currentScope.academic_year} · ` + currentScope.semester_name;

    const confirmation =
      action === "CREATE"
        ? `Create a CLOSED combined grading submission window for ${label}?`
        : `${action.replaceAll("_", " ")} the submission window for ${label}?` +
          (deadlineValue && action !== "CLOSE"
            ? `\nDeadline: ${deadlineValue} (database local time)`
            : "") +
          "\nThe action is recorded in the audit history.";

    if (!window.confirm(confirmation)) return;

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const url =
        action === "CREATE"
          ? api.url("/api/program-head/gradebook/semester-submission-periods")
          : api.url(
              `/api/program-head/gradebook/semester-submission-periods/${current!.period_id}`,
            );

      const body =
        action === "CREATE"
          ? {
              academic_year_id: currentScope.academic_year_id,
              semester_id: currentScope.semester_id,
              change_reason: reason.trim(),
            }
          : {
              record_version: current!.record_version,
              action,
              ...(action !== "CLOSE"
                ? { submission_deadline_at: deadlineValue }
                : {}),
              change_reason: reason.trim(),
            };

      const response = await authService.authFetch(url, {
        method: action === "CREATE" ? "POST" : "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await readPeriodResponse<PeriodWriteResult>(response);

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return;
      }

      if (!response.ok || !data.success || !data.period?.period_id) {
        throw new Error(
          [data.code, data.message].filter(Boolean).join(": ") ||
            "Could not update the submission window.",
        );
      }

      setNotice(
        `${label}: ${
          data.audit_event?.replaceAll("_", " ") || "Updated"
        }. Submission status is now ${data.period.period_status}.`,
      );

      setReason("");
      reload();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not update submission window.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="program-head-submission-windows"
      className="program-head-grade-queue ph-combined-window"
    >
      <header className="program-head-grade-queue-header">
        <div>
          <span>Program Head · Grading Setup</span>
          <h2>Combined Semester Submission Window</h2>
          <p>
            Manage when Faculty may submit complete Midterm and Final grades for
            Program Head approval.
          </p>
        </div>

        <strong>{loading ? "Loading…" : `${periods.length} periods`}</strong>
      </header>

      <div className="ph-combined-window__body">
        {error && (
          <p
            role="alert"
            className="ph-combined-window__message ph-combined-window__message--error"
          >
            {error}
          </p>
        )}

        {notice && (
          <p
            role="status"
            className="ph-combined-window__message ph-combined-window__message--success"
          >
            {notice}
          </p>
        )}

        <div className="ph-combined-window__top">
          <label className="ph-combined-window__field">
            <span>Academic year and semester</span>

            <select
              value={currentScope?.key ?? ""}
              disabled={loading || busy || scopes.length === 0}
              onChange={(event) => {
                setSelectedKey(event.target.value);
                setDeadline("");
                setReason("");
                setError("");
                setNotice("");
              }}
            >
              {scopes.length === 0 && (
                <option value="">No class semesters found</option>
              )}

              {scopes.map((scope) => (
                <option key={scope.key} value={scope.key}>
                  {scope.academic_year} · {scope.semester_name}
                </option>
              ))}
            </select>
          </label>

          <div className="ph-combined-window__status" aria-live="polite">
            <span className="ph-combined-window__status-label">
              Window status
            </span>

            <strong
              className={`ph-combined-window__pill ${
                isActive ? "is-open" : ""
              }`}
            >
              {loading
                ? "Loading"
                : !currentPeriod
                  ? "Not configured"
                  : isActive
                    ? "Open for submissions"
                    : isExpired && currentPeriod.period_status === "OPEN"
                      ? "Deadline passed"
                      : currentPeriod.period_status === "CLOSED"
                        ? "Closed"
                        : "Unavailable"}
            </strong>
          </div>
        </div>

        {currentPeriod && (
          <div className="ph-combined-window__summary">
            <span>
              <Clock3 size={15} aria-hidden="true" />
              Deadline:{" "}
              <strong>
                {currentPeriod.submission_deadline_at ?? "Not set"}
              </strong>
            </span>

            <span>
              <CalendarClock size={15} aria-hidden="true" />
              Server time: <strong>{currentPeriod.database_now}</strong>
            </span>

            <span>
              <LockKeyhole size={15} aria-hidden="true" />
              Version: <strong>{currentPeriod.record_version}</strong>
            </span>
          </div>
        )}

        {!loading && scopes.length === 0 && (
          <p className="ph-combined-window__hint">
            No department class offerings are available to determine an academic
            period.
          </p>
        )}

        {currentScope && !loading && (
          <div className="ph-combined-window__form">
            {(canOpen || canReopen || canChangeDeadline) && (
              <label className="ph-combined-window__field">
                <span>Submission deadline (database local time)</span>

                <input
                  type="datetime-local"
                  step={60}
                  value={deadline}
                  disabled={busy}
                  onChange={(event) => setDeadline(event.target.value)}
                />

                <small>
                  Required when opening, reopening, or changing a deadline. The
                  backend checks it against its own clock.
                </small>
              </label>
            )}

            <label className="ph-combined-window__field">
              <span>Change reason {canReopen ? "(required)" : ""}</span>

              <textarea
                rows={2}
                maxLength={1000}
                placeholder="Describe why the submission window is being changed"
                value={reason}
                disabled={busy}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>

            <div className="ph-combined-window__actions">
              {!currentPeriod && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void performAction("CREATE")}
                >
                  <CalendarClock size={15} />
                  Create Closed Window
                </button>
              )}

              {canOpen && (
                <button
                  type="button"
                  disabled={busy || !deadlineValue}
                  onClick={() => void performAction("OPEN")}
                >
                  <CheckCircle2 size={15} />
                  Open Submissions
                </button>
              )}

              {currentPeriod?.period_status === "OPEN" && (
                <button
                  type="button"
                  className="ph-combined-window__secondary"
                  disabled={busy}
                  onClick={() => void performAction("CLOSE")}
                >
                  <LockKeyhole size={15} />
                  Close Submissions
                </button>
              )}

              {canReopen && (
                <button
                  type="button"
                  disabled={busy || !deadlineValue || reason.trim().length < 5}
                  onClick={() => void performAction("REOPEN")}
                >
                  <RotateCcw size={15} />
                  Reopen Submissions
                </button>
              )}

              {canChangeDeadline && (
                <button
                  type="button"
                  className="ph-combined-window__secondary"
                  disabled={busy || !deadlineValue || reason.trim().length < 5}
                  onClick={() => void performAction("CHANGE_DEADLINE")}
                >
                  <CalendarClock size={15} />
                  Change Deadline
                </button>
              )}
            </div>
          </div>
        )}

        <p className="ph-combined-window__hint">
          The window applies to the whole department, academic year, and
          semester—not one individual class. Grade approval and official-sheet
          finalization remain separate steps.
        </p>
      </div>
    </section>
  );
}
