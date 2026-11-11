import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Layers3,
  Save,
  Send,
} from "lucide-react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { api } from "../../../services/api";
import { authService } from "../../../services/auth.service";
import "../../../styles/ProgramHeadOfferingBatches.css";

const BATCH_API = api.url("/api/program-head/offering-batches");

const WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

type WeekDay = (typeof WEEK_DAYS)[number];

interface ApiResponse {
  success: boolean;
  message?: string;
  error?: string;
}

interface ScheduleConflict {
  offering_id?: number;
  subject_code?: string;
  subject_name?: string;
  section_name?: string;
  faculty_name?: string;
  schedule_days?: string | null;
  schedule_time?: string | null;
  conflict_type?: string;
  common_days?: string[];
}

interface BatchListItem {
  batch_id: number;
  academic_year_id: number;
  academic_year: string;
  semester_id: number;
  semester_name: string;
  course_id: number;
  course_code: string;
  course_name: string;
  curriculum_id: number;
  curriculum_name: string;
  year_level: number;
  batch_status: string;
  submitted_at?: string | null;
  returned_at?: string | null;
  published_at?: string | null;
  offering_count: number;
  scheduled_count: number;
}

interface BatchOffering {
  offering_id: number;
  batch_id: number;
  section_subject_id: number;
  subject_id: number;
  section_id: number;
  faculty_id: number | null;
  academic_year_id: number;
  semester_id: number;
  schedule_days: string | null;
  schedule_time: string | null;
  schedule_start_time: string | null;
  schedule_end_time: string | null;
  max_students: number;
  offering_status: string;
  subject_code: string;
  subject_name: string;
  units: number;
  section_name: string;
  faculty_name: string | null;
}

interface FacultyOption {
  faculty_id: number;
  employee_number: string;
  faculty_name: string;
  role_name: string;
}

interface BatchDetail extends BatchListItem {
  department_id: number;
  department_name: string;
  offerings: BatchOffering[];
  faculty_options: FacultyOption[];
}

interface OfferingDraft {
  faculty_id: string;
  schedule_days: WeekDay[];
  start_time: string;
  end_time: string;
}

interface BatchListResponse extends ApiResponse {
  batches?: BatchListItem[];
}

interface BatchDetailResponse extends ApiResponse {
  batch?: BatchDetail;
}

interface SaveOfferingResponse extends ApiResponse {
  offering?: {
    offering_id: number;
    batch_id: number;
    faculty_id: number;
    faculty_name: string;
    schedule_days: string;
    schedule_time: string;
    schedule_start_time: string;
    schedule_end_time: string;
    status: string;
  };
}

interface ReturnBatchResponse extends ApiResponse {
  batch_id?: number;
  batch_status?: string;
}

class RequestError extends Error {
  conflicts?: ScheduleConflict[];
  incompleteOfferingIds?: number[];

  constructor(
    message: string,
    details?: {
      conflicts?: ScheduleConflict[];
      incomplete_offering_ids?: number[];
    },
  ) {
    super(message);
    this.name = "RequestError";
    this.conflicts = details?.conflicts;
    this.incompleteOfferingIds = details?.incomplete_offering_ids;
  }
}

function getMessage(data: ApiResponse, fallback: string) {
  return data.message || data.error || fallback;
}

async function readResponse<T>(response: Response): Promise<T> {
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

function parseDays(value: string | null): WeekDay[] {
  if (!value) return [];

  const aliases: Record<string, WeekDay> = {
    monday: "Monday",
    mon: "Monday",
    tuesday: "Tuesday",
    tue: "Tuesday",
    tues: "Tuesday",
    wednesday: "Wednesday",
    wed: "Wednesday",
    thursday: "Thursday",
    thu: "Thursday",
    thur: "Thursday",
    thurs: "Thursday",
    friday: "Friday",
    fri: "Friday",
    saturday: "Saturday",
    sat: "Saturday",
    sunday: "Sunday",
    sun: "Sunday",
  };

  const found = value
    .split(/[,/&;]+/)
    .map((day) => aliases[day.trim().toLowerCase()])
    .filter((day): day is WeekDay => Boolean(day));

  return WEEK_DAYS.filter((day) => found.includes(day));
}

function toTimeInput(value: string | null | undefined): string {
  if (!value) return "";

  const text = value.trim();
  const twelveHour = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

  if (twelveHour) {
    let hour = Number(twelveHour[1]) % 12;

    if (twelveHour[3].toUpperCase() === "PM") {
      hour += 12;
    }

    return `${String(hour).padStart(2, "0")}:${twelveHour[2]}`;
  }

  const twentyFourHour = text.match(/^(\d{1,2}):(\d{2})/);

  return twentyFourHour
    ? `${twentyFourHour[1].padStart(2, "0")}:${twentyFourHour[2]}`
    : "";
}

function makeDraft(offering: BatchOffering): OfferingDraft {
  const legacyTimes = (offering.schedule_time || "").split(/\s*[-–—]\s*/);

  return {
    faculty_id: offering.faculty_id ? String(offering.faculty_id) : "",
    schedule_days: parseDays(offering.schedule_days),
    start_time:
      toTimeInput(offering.schedule_start_time) || toTimeInput(legacyTimes[0]),
    end_time:
      toTimeInput(offering.schedule_end_time) || toTimeInput(legacyTimes[1]),
  };
}

function isScheduled(offering: BatchOffering): boolean {
  return Boolean(
    offering.faculty_id &&
    parseDays(offering.schedule_days).length > 0 &&
    toTimeInput(offering.schedule_start_time) &&
    toTimeInput(offering.schedule_end_time),
  );
}

function statusClass(status: string): string {
  return status.toLowerCase().replace(/\s+/g, "-");
}

export default function OfferingBatchesPH() {
  const session = authService.getSession();
  const navigate = useNavigate();

  const [batches, setBatches] = useState<BatchListItem[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<BatchDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<number, OfferingDraft>>({});
  const [conflicts, setConflicts] = useState<
    Record<number, ScheduleConflict[]>
  >({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [savingOfferingId, setSavingOfferingId] = useState<number | null>(null);
  const [returningBatch, setReturningBatch] = useState(false);

  const requestJson = useCallback(
    async <T extends ApiResponse>(url: string, options: RequestInit = {}) => {
      const headers = new Headers(options.headers || {});
      headers.set("Accept", "application/json");

      const response = await authService.authFetch(url, {
        ...options,
        headers,
      });

      const data = await readResponse<T>(response);

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        throw new Error("Your session expired. Please sign in again.");
      }

      if (!response.ok || data.success === false) {
        const details = data as T & {
          conflicts?: ScheduleConflict[];
          incomplete_offering_ids?: number[];
        };

        throw new RequestError(
          getMessage(data, "The request could not be completed."),
          {
            conflicts: details.conflicts,
            incomplete_offering_ids: details.incomplete_offering_ids,
          },
        );
      }

      return data;
    },
    [navigate],
  );

  useEffect(() => {
    if (session?.role !== "Program Head") return;

    const controller = new AbortController();
    let active = true;

    setListLoading(true);
    setListError("");

    void requestJson<BatchListResponse>(BATCH_API, {
      signal: controller.signal,
    })
      .then((data) => {
        if (active) setBatches(data.batches || []);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        if (active) {
          setListError(
            error instanceof Error
              ? error.message
              : "Could not load assigned offering batches.",
          );
        }
      })
      .finally(() => {
        if (active) setListLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [requestJson, session?.role]);

  const scheduledCount = useMemo(
    () => selectedBatch?.offerings.filter(isScheduled).length || 0,
    [selectedBatch],
  );

  const allOfferingsScheduled = Boolean(
    selectedBatch &&
    selectedBatch.offerings.length > 0 &&
    selectedBatch.offerings.every(isScheduled),
  );

  const offeringsBySection = useMemo(() => {
    const grouped = new Map<
      number,
      { section_id: number; section_name: string; offerings: BatchOffering[] }
    >();

    selectedBatch?.offerings.forEach((offering) => {
      const sectionGroup = grouped.get(offering.section_id);

      if (sectionGroup) {
        sectionGroup.offerings.push(offering);
      } else {
        grouped.set(offering.section_id, {
          section_id: offering.section_id,
          section_name: offering.section_name,
          offerings: [offering],
        });
      }
    });

    return Array.from(grouped.values())
      .map((sectionGroup) => ({
        ...sectionGroup,
        offerings: [...sectionGroup.offerings].sort((a, b) =>
          a.subject_code.localeCompare(b.subject_code),
        ),
      }))
      .sort((a, b) => a.section_name.localeCompare(b.section_name));
  }, [selectedBatch]);

  const canEdit = selectedBatch?.batch_status === "Pending Program Head";

  const openBatch = async (batchId: number) => {
    setSelectedBatch(null);
    setDetailLoading(true);
    setDetailError("");
    setActionMessage("");
    setActionError("");
    setConflicts({});
    setRowErrors({});

    try {
      const data = await requestJson<BatchDetailResponse>(
        `${BATCH_API}/${batchId}`,
      );

      if (!data.batch) {
        throw new Error("The server did not return this batch.");
      }

      setSelectedBatch(data.batch);

      const nextDrafts = data.batch.offerings.reduce<
        Record<number, OfferingDraft>
      >((result, offering) => {
        result[offering.offering_id] = makeDraft(offering);
        return result;
      }, {});

      setDrafts(nextDrafts);
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Could not load this batch.",
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const updateDraft = (
    offeringId: number,
    update: (current: OfferingDraft) => OfferingDraft,
  ) => {
    setDrafts((current) => {
      const existing = current[offeringId];

      if (!existing) return current;

      return { ...current, [offeringId]: update(existing) };
    });

    setRowErrors((current) => ({ ...current, [offeringId]: "" }));
    setConflicts((current) => ({ ...current, [offeringId]: [] }));
  };

  const toggleDay = (offeringId: number, day: WeekDay) => {
    updateDraft(offeringId, (draft) => {
      const selected = draft.schedule_days.includes(day)
        ? draft.schedule_days.filter((item) => item !== day)
        : [...draft.schedule_days, day];

      return {
        ...draft,
        schedule_days: WEEK_DAYS.filter((item) => selected.includes(item)),
      };
    });
  };

  const saveOffering = async (offering: BatchOffering) => {
    if (!selectedBatch) return;

    const draft = drafts[offering.offering_id];

    if (!draft) return;

    if (!draft.faculty_id) {
      setRowErrors((current) => ({
        ...current,
        [offering.offering_id]: "Select an instructor.",
      }));
      return;
    }

    if (!draft.schedule_days.length) {
      setRowErrors((current) => ({
        ...current,
        [offering.offering_id]: "Select at least one class day.",
      }));
      return;
    }

    if (!draft.start_time || !draft.end_time) {
      setRowErrors((current) => ({
        ...current,
        [offering.offering_id]: "Enter both the start and end times.",
      }));
      return;
    }

    if (draft.start_time >= draft.end_time) {
      setRowErrors((current) => ({
        ...current,
        [offering.offering_id]: "End time must be later than start time.",
      }));
      return;
    }

    setSavingOfferingId(offering.offering_id);
    setRowErrors((current) => ({ ...current, [offering.offering_id]: "" }));
    setConflicts((current) => ({ ...current, [offering.offering_id]: [] }));
    setActionMessage("");

    try {
      const data = await requestJson<SaveOfferingResponse>(
        `${BATCH_API}/${selectedBatch.batch_id}/offerings/${offering.offering_id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            faculty_id: Number(draft.faculty_id),
            schedule_days: draft.schedule_days.join(", "),
            schedule_start_time: `${draft.start_time}:00`,
            schedule_end_time: `${draft.end_time}:00`,
          }),
        },
      );

      const saved = data.offering;

      if (!saved) {
        throw new Error("The server did not return the saved schedule.");
      }

      setSelectedBatch((current) => {
        if (!current) return current;

        return {
          ...current,
          offerings: current.offerings.map((item) =>
            item.offering_id === offering.offering_id
              ? {
                  ...item,
                  faculty_id: saved.faculty_id,
                  faculty_name: saved.faculty_name,
                  schedule_days: saved.schedule_days,
                  schedule_time: saved.schedule_time,
                  schedule_start_time: saved.schedule_start_time,
                  schedule_end_time: saved.schedule_end_time,
                  offering_status: saved.status,
                }
              : item,
          ),
        };
      });

      setBatches((current) =>
        current.map((batch) => {
          if (batch.batch_id !== selectedBatch.batch_id) return batch;

          const wasScheduled = isScheduled(offering);

          return {
            ...batch,
            scheduled_count: Math.min(
              batch.offering_count,
              Number(batch.scheduled_count || 0) + (wasScheduled ? 0 : 1),
            ),
          };
        }),
      );

      setActionMessage(
        "Schedule saved. This offering stays closed until the Registrar publishes the batch.",
      );
    } catch (error) {
      if (error instanceof RequestError && error.conflicts?.length) {
        setConflicts((current) => ({
          ...current,
          [offering.offering_id]: error.conflicts || [],
        }));
      }

      setRowErrors((current) => ({
        ...current,
        [offering.offering_id]:
          error instanceof Error
            ? error.message
            : "Could not save this schedule.",
      }));
    } finally {
      setSavingOfferingId(null);
    }
  };

  const returnBatch = async () => {
    if (!selectedBatch || !allOfferingsScheduled) return;

    const confirmed = window.confirm(
      "Return this completed batch to the Registrar for review? You will no longer be able to edit its schedules.",
    );

    if (!confirmed) return;

    setReturningBatch(true);
    setActionError("");
    setActionMessage("");

    try {
      const data = await requestJson<ReturnBatchResponse>(
        `${BATCH_API}/${selectedBatch.batch_id}/return-to-registrar`,
        { method: "POST" },
      );

      const nextStatus = data.batch_status || "Ready for Registrar";

      setSelectedBatch((current) =>
        current ? { ...current, batch_status: nextStatus } : current,
      );

      setBatches((current) =>
        current.map((batch) =>
          batch.batch_id === selectedBatch.batch_id
            ? { ...batch, batch_status: nextStatus }
            : batch,
        ),
      );

      setActionMessage(
        data.message || "The batch was returned to the Registrar.",
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not return this batch.",
      );
    } finally {
      setReturningBatch(false);
    }
  };

  if (session?.role !== "Program Head") return null;

  return (
    <DashboardLayout>
      <main className="ph-offering-batches">
        {!selectedBatch ? (
          <>
            <header className="ph-offering-batches__page-header">
              <div>
                <div className="ph-offering-batches__eyebrow">
                  <span className="ph-offering-batches__eyebrow-icon" aria-hidden="true">
                    <Layers3 size={16} />
                  </span>
                  PROGRAM HEAD · CLASS MANAGEMENT
                </div>
                <h1>Offering Batches</h1>
                <p>
                  Assign instructors and schedules to the batches sent by the
                  Registrar.
                </p>
              </div>

            </header>

            {detailError && (
              <div
                className="ph-offering-batches__alert ph-offering-batches__alert--error"
                role="alert"
              >
                <AlertCircle size={16} />
                {detailError}
              </div>
            )}

            {listError && (
              <div
                className="ph-offering-batches__alert ph-offering-batches__alert--error"
                role="alert"
              >
                <AlertCircle size={16} />
                {listError}
              </div>
            )}

            <section className="ph-offering-batches__panel">
              <div className="ph-offering-batches__panel-heading">
                <h2>Assigned batches</h2>
                <span>{batches.length} total</span>
              </div>

              {listLoading ? (
                <div className="ph-offering-batches__empty">
                  <span className="ph-offering-batches__spinner" />
                  Loading batches…
                </div>
              ) : batches.length === 0 ? (
                <div className="ph-offering-batches__empty">
                  <ClipboardList size={24} />
                  <strong>No batches assigned yet</strong>
                  <span>Batches sent by the Registrar will appear here.</span>
                </div>
              ) : (
                <div className="ph-offering-batches__table-wrap">
                  <table className="ph-offering-batches__table">
                    <thead>
                      <tr>
                        <th>Course and year</th>
                        <th>Academic term</th>
                        <th>Scheduled</th>
                        <th>Status</th>
                        <th aria-label="Action"></th>
                      </tr>
                    </thead>

                    <tbody>
                      {batches.map((batch) => (
                        <tr key={batch.batch_id}>
                          <td>
                            <strong>
                              {batch.course_code} · Year {batch.year_level}
                            </strong>
                            <small>{batch.course_name}</small>
                          </td>

                          <td>
                            {batch.academic_year}
                            <small>{batch.semester_name}</small>
                          </td>

                          <td>
                            {batch.scheduled_count} / {batch.offering_count}
                          </td>

                          <td>
                            <span
                              className={`ph-offering-batches__status ph-offering-batches__status--${statusClass(batch.batch_status)}`}
                            >
                              {batch.batch_status}
                            </span>
                          </td>

                          <td>
                            <button
                              type="button"
                              className="ph-offering-batches__open"
                              onClick={() => void openBatch(batch.batch_id)}
                            >
                              Open
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : (
          <>
            <button
              type="button"
              className="ph-offering-batches__back"
              onClick={() => {
                setSelectedBatch(null);
                setActionMessage("");
                setActionError("");
              }}
            >
              <ArrowLeft size={15} />
              Back to batches
            </button>

            <header className="ph-offering-batches__detail-header">
              <div className="ph-offering-batches__detail-title">
                <div>
                  <div className="ph-offering-batches__eyebrow">
                    <span className="ph-offering-batches__eyebrow-icon" aria-hidden="true">
                      <Layers3 size={16} />
                    </span>
                    PROGRAM HEAD · CLASS MANAGEMENT
                  </div>
                  <h1>
                    {selectedBatch.course_code} · Year{" "}
                    {selectedBatch.year_level}
                  </h1>
                  <p>{selectedBatch.course_name}</p>
                </div>

                <span
                  className={`ph-offering-batches__status ph-offering-batches__status--${statusClass(selectedBatch.batch_status)}`}
                >
                  {selectedBatch.batch_status}
                </span>
              </div>

              <div className="ph-offering-batches__detail-meta">
                <span>
                  <CalendarDays size={15} />
                  {selectedBatch.academic_year} · {selectedBatch.semester_name}
                </span>
                <span>{selectedBatch.department_name}</span>
                <span>
                  {scheduledCount} of {selectedBatch.offerings.length} scheduled
                </span>
              </div>
            </header>

            {detailError && (
              <div
                className="ph-offering-batches__alert ph-offering-batches__alert--error"
                role="alert"
              >
                <AlertCircle size={16} />
                {detailError}
              </div>
            )}

            {actionMessage && (
              <div
                className="ph-offering-batches__alert ph-offering-batches__alert--success"
                role="status"
              >
                <CheckCircle2 size={16} />
                {actionMessage}
              </div>
            )}

            {actionError && (
              <div
                className="ph-offering-batches__alert ph-offering-batches__alert--error"
                role="alert"
              >
                <AlertCircle size={16} />
                {actionError}
              </div>
            )}

            <section className="ph-offering-batches__panel ph-offering-batches__schedule-panel">
              <div className="ph-offering-batches__panel-heading">
                <h2>Schedules by section</h2>
                <span>
                  {selectedBatch.offerings.length} subjects ·{" "}
                  {offeringsBySection.length} sections
                </span>
              </div>

              {detailLoading ? (
                <div className="ph-offering-batches__empty">
                  <span className="ph-offering-batches__spinner" />
                  Loading batch…
                </div>
              ) : selectedBatch.offerings.length === 0 ? (
                <div className="ph-offering-batches__empty">
                  This batch has no subject offerings.
                </div>
              ) : (
                <div className="ph-offering-batches__offerings">
                  {offeringsBySection.map((sectionGroup) => {
                    const sectionScheduledCount =
                      sectionGroup.offerings.filter(isScheduled).length;

                    return (
                      <section
                        className="ph-offering-section"
                        key={sectionGroup.section_id}
                      >
                        <header className="ph-offering-section__header">
                          <div>
                            <h3>{sectionGroup.section_name}</h3>
                            <span>
                              {sectionGroup.offerings.length} subjects
                            </span>
                          </div>

                          <small>
                            {sectionScheduledCount} /{" "}
                            {sectionGroup.offerings.length} scheduled
                          </small>
                        </header>

                        <div className="ph-offering-section__items">
                          {sectionGroup.offerings.map((offering) => {
                            const draft =
                              drafts[offering.offering_id] ||
                              makeDraft(offering);
                            const scheduled = isScheduled(offering);
                            const rowConflictList =
                              conflicts[offering.offering_id] || [];

                            return (
                              <article
                                className="ph-offering-item"
                                key={offering.offering_id}
                              >
                                <div className="ph-offering-item__heading">
                                  <div>
                                    <strong>{offering.subject_code}</strong>
                                    <span>{offering.subject_name}</span>
                                    <small>{offering.units} units</small>
                                  </div>

                                  <span
                                    className={`ph-offering-item__completion ${
                                      scheduled ? "is-ready" : "is-pending"
                                    }`}
                                  >
                                    {scheduled ? "Scheduled" : "Needs schedule"}
                                  </span>
                                </div>

                                <div className="ph-offering-item__fields">
                                  <label className="ph-offering-item__field">
                                    <span>Instructor</span>
                                    <select
                                      value={draft.faculty_id}
                                      onChange={(event) =>
                                        updateDraft(
                                          offering.offering_id,
                                          (current) => ({
                                            ...current,
                                            faculty_id: event.target.value,
                                          }),
                                        )
                                      }
                                      disabled={
                                        !canEdit ||
                                        savingOfferingId ===
                                          offering.offering_id
                                      }
                                    >
                                      <option value="">
                                        Select instructor
                                      </option>
                                      {selectedBatch.faculty_options.map(
                                        (faculty) => (
                                          <option
                                            key={faculty.faculty_id}
                                            value={faculty.faculty_id}
                                          >
                                            {faculty.faculty_name} (
                                            {faculty.role_name})
                                          </option>
                                        ),
                                      )}
                                    </select>
                                  </label>

                                  <fieldset
                                    className="ph-offering-item__days"
                                    disabled={
                                      !canEdit ||
                                      savingOfferingId === offering.offering_id
                                    }
                                  >
                                    <legend>Days</legend>
                                    <div>
                                      {WEEK_DAYS.map((day) => (
                                        <button
                                          type="button"
                                          key={day}
                                          aria-pressed={draft.schedule_days.includes(
                                            day,
                                          )}
                                          className={
                                            draft.schedule_days.includes(day)
                                              ? "is-selected"
                                              : ""
                                          }
                                          onClick={() =>
                                            toggleDay(offering.offering_id, day)
                                          }
                                        >
                                          {day.slice(0, 3)}
                                        </button>
                                      ))}
                                    </div>
                                  </fieldset>

                                  <label className="ph-offering-item__field">
                                    <span>Start</span>
                                    <input
                                      type="time"
                                      value={draft.start_time}
                                      onChange={(event) =>
                                        updateDraft(
                                          offering.offering_id,
                                          (current) => ({
                                            ...current,
                                            start_time: event.target.value,
                                          }),
                                        )
                                      }
                                      disabled={
                                        !canEdit ||
                                        savingOfferingId ===
                                          offering.offering_id
                                      }
                                    />
                                  </label>

                                  <label className="ph-offering-item__field">
                                    <span>End</span>
                                    <input
                                      type="time"
                                      value={draft.end_time}
                                      onChange={(event) =>
                                        updateDraft(
                                          offering.offering_id,
                                          (current) => ({
                                            ...current,
                                            end_time: event.target.value,
                                          }),
                                        )
                                      }
                                      disabled={
                                        !canEdit ||
                                        savingOfferingId ===
                                          offering.offering_id
                                      }
                                    />
                                  </label>
                                </div>

                                {rowErrors[offering.offering_id] && (
                                  <div
                                    className="ph-offering-item__error"
                                    role="alert"
                                  >
                                    <AlertCircle size={15} />
                                    {rowErrors[offering.offering_id]}
                                  </div>
                                )}

                                {rowConflictList.length > 0 && (
                                  <div
                                    className="ph-offering-item__conflicts"
                                    role="alert"
                                  >
                                    <strong>Schedule conflict</strong>
                                    {rowConflictList.map((conflict, index) => (
                                      <p
                                        key={`${
                                          conflict.offering_id || "conflict"
                                        }-${index}`}
                                      >
                                        {conflict.subject_code ||
                                          conflict.subject_name ||
                                          "Existing class"}
                                        {conflict.section_name
                                          ? ` · ${conflict.section_name}`
                                          : ""}
                                        {conflict.schedule_days
                                          ? ` · ${conflict.schedule_days}`
                                          : ""}
                                        {conflict.schedule_time
                                          ? ` · ${conflict.schedule_time}`
                                          : ""}
                                        {conflict.conflict_type
                                          ? ` · ${conflict.conflict_type} conflict`
                                          : ""}
                                      </p>
                                    ))}
                                  </div>
                                )}

                                <footer className="ph-offering-item__footer">
                                  {offering.faculty_name && scheduled && (
                                    <small>
                                      Assigned: {offering.faculty_name}
                                    </small>
                                  )}

                                  {canEdit && (
                                    <button
                                      type="button"
                                      className="ph-offering-batches__button ph-offering-batches__button--primary"
                                      onClick={() =>
                                        void saveOffering(offering)
                                      }
                                      disabled={
                                        savingOfferingId ===
                                        offering.offering_id
                                      }
                                    >
                                      <Save size={14} />
                                      {savingOfferingId === offering.offering_id
                                        ? "Saving…"
                                        : "Save"}
                                    </button>
                                  )}
                                </footer>
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </section>

            {canEdit ? (
              <footer className="ph-offering-batches__return-bar">
                <span>
                  {scheduledCount} / {selectedBatch.offerings.length} scheduled
                </span>

                <button
                  type="button"
                  className="ph-offering-batches__button ph-offering-batches__button--primary"
                  onClick={() => void returnBatch()}
                  disabled={
                    !allOfferingsScheduled ||
                    returningBatch ||
                    savingOfferingId !== null
                  }
                >
                  <Send size={15} />
                  {returningBatch ? "Returning…" : "Return to Registrar"}
                </button>
              </footer>
            ) : (
              <div className="ph-offering-batches__read-only-note">
                Scheduling is locked while this batch is{" "}
                {selectedBatch.batch_status.toLowerCase()}.
              </div>
            )}
          </>
        )}

        {detailLoading && !selectedBatch && (
          <div className="ph-offering-batches__loading-overlay" role="status">
            <span className="ph-offering-batches__spinner" />
            Opening batch…
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}
