import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  WandSparkles,
  CheckCircle2,
  ClipboardList,
  RefreshCw,
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

interface PendingFacultyRequest {
  request_id: number;
  offering_id: number;
  proposed_faculty_id: number;
  proposed_faculty_name: string;
  status: string;
}

interface BatchDetail extends BatchListItem {
  department_id: number;
  department_name: string;
  offerings: BatchOffering[];
  faculty_options: FacultyOption[];
  faculty_requests?: PendingFacultyRequest[];
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
    faculty_id: number | null;
    faculty_name: string | null;
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

interface AutoScheduleEntry {
  offering_id: number;
  section_id: number;
  section_name: string;
  subject_code: string;
  subject_name: string;
  units: number;
  faculty_id: number | null;
  schedule_days: string | null;
  schedule_start_time: string | null;
  schedule_end_time: string | null;
  schedule_time: string | null;
  generated: boolean;
}

interface AutoScheduleResponse extends ApiResponse {
  preview_only: boolean;
  preview_signature: string;
  generated_count: number;
  preserved_count: number;
  entries: AutoScheduleEntry[];
}

type DurationMode = "units" | "fixed";

interface AutoScheduleForm {
  allowed_days: WeekDay[];
  day_start: string;
  day_end: string;
  duration_mode: DurationMode;
  minutes_per_unit: number;
  fixed_minutes: number;
  slot_minutes: number;
  replace_existing: boolean;
}

const DEFAULT_AUTO_FORM: AutoScheduleForm = {
  allowed_days: [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ],
  day_start: "07:00",
  day_end: "21:00",
  duration_mode: "units",
  minutes_per_unit: 60,
  fixed_minutes: 90,
  slot_minutes: 30,
  replace_existing: false,
};

interface FacultyRequestResponse extends ApiResponse {
  request_id?: number;
  offering_id?: number;
  request_status?: string;
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
  const [requestingFacultyId, setRequestingFacultyId] = useState<number | null>(
    null,
  );
  const [returningBatch, setReturningBatch] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [autoForm, setAutoForm] = useState<AutoScheduleForm>(DEFAULT_AUTO_FORM);
  const [autoPreview, setAutoPreview] = useState<AutoScheduleResponse | null>(
    null,
  );
  const [autoPreviewConfig, setAutoPreviewConfig] = useState("");
  const [autoLoading, setAutoLoading] = useState<"preview" | "apply" | null>(
    null,
  );
  const [autoError, setAutoError] = useState("");

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
  }, [requestJson, refreshKey, session?.role]);

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

  const canUpdateProfessor =
    selectedBatch?.batch_status === "Ready for Registrar";

  const setAutoOption = (patch: Partial<AutoScheduleForm>) => {
    setAutoForm((current) => ({ ...current, ...patch }));
    setAutoPreview(null);
    setAutoPreviewConfig("");
    setAutoError("");
  };

  const toggleAutoDay = (day: WeekDay) => {
    setAutoForm((current) => ({
      ...current,
      allowed_days: WEEK_DAYS.filter((candidate) =>
        candidate === day
          ? !current.allowed_days.includes(candidate)
          : current.allowed_days.includes(candidate),
      ),
    }));
    setAutoPreview(null);
    setAutoPreviewConfig("");
    setAutoError("");
  };

  const autoSchedule = async (mode: "preview" | "apply") => {
    if (!selectedBatch || selectedBatch.batch_status !== "Pending Program Head")
      return;
    if (
      !autoForm.allowed_days.length ||
      !autoForm.day_start ||
      !autoForm.day_end ||
      autoForm.day_start >= autoForm.day_end
    ) {
      setAutoError(
        "Select at least one allowed day and a valid daily time range.",
      );
      return;
    }
    const configKey = JSON.stringify(autoForm);
    if (mode === "apply" && (!autoPreview || configKey !== autoPreviewConfig)) {
      setAutoError(
        "Preview the current settings before applying the schedule.",
      );
      return;
    }
    if (
      mode === "apply" &&
      !window.confirm(
        `Save ${autoPreview?.generated_count ?? 0} generated class schedules for every section in this batch? ` +
          "This will not assign professors or publish classes.",
      )
    )
      return;

    setAutoError("");
    setActionError("");
    setActionMessage("");
    setAutoLoading(mode);
    try {
      const data = await requestJson<AutoScheduleResponse>(
        `${BATCH_API}/${selectedBatch.batch_id}/auto-schedule/${mode}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...autoForm,
            preview_signature:
              mode === "apply" ? autoPreview?.preview_signature : undefined,
            day_start: `${autoForm.day_start}:00`,
            day_end: `${autoForm.day_end}:00`,
          }),
        },
      );
      if (!Array.isArray(data.entries)) {
        throw new Error("The server did not return a schedule preview.");
      }
      if (mode === "preview") {
        setAutoPreview(data);
        setAutoPreviewConfig(configKey);
        return;
      }

      const byId = new Map(
        data.entries.map((entry) => [entry.offering_id, entry]),
      );
      const updatedOfferings = selectedBatch.offerings.map((offering) => {
        const next = byId.get(offering.offering_id);
        if (!next) return offering;
        return {
          ...offering,
          schedule_days: next.schedule_days,
          schedule_start_time: next.schedule_start_time,
          schedule_end_time: next.schedule_end_time,
          schedule_time: next.schedule_time,
          offering_status: next.generated ? "Closed" : offering.offering_status,
        };
      });
      setSelectedBatch((current) =>
        current
          ? {
              ...current,
              offerings: updatedOfferings,
            }
          : current,
      );
      setDrafts(
        Object.fromEntries(
          updatedOfferings.map((offering) => [
            offering.offering_id,
            makeDraft(offering),
          ]),
        ),
      );
      setBatches((current) =>
        current.map((batch) =>
          batch.batch_id === selectedBatch.batch_id
            ? {
                ...batch,
                scheduled_count: updatedOfferings.filter(isScheduled).length,
              }
            : batch,
        ),
      );
      setRowErrors({});
      setConflicts({});
      setAutoPreview(null);
      setAutoPreviewConfig("");
      setActionMessage(
        data.message ||
          "Automatic schedules saved. Review each section before returning the batch.",
      );
    } catch (error) {
      setAutoError(
        error instanceof Error ? error.message : "Automatic scheduling failed.",
      );
      if (mode === "apply") {
        setAutoPreview(null);
        setAutoPreviewConfig("");
      }
    } finally {
      setAutoLoading(null);
    }
  };

  const openBatch = async (batchId: number) => {
    setSelectedBatch(null);
    setDetailLoading(true);
    setDetailError("");
    setActionMessage("");
    setActionError("");
    setConflicts({});
    setRowErrors({});
    setAutoPreview(null);
    setAutoPreviewConfig("");
    setAutoError("");

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
    if (
      !selectedBatch ||
      !["Pending Program Head", "Ready for Registrar"].includes(
        selectedBatch.batch_status,
      )
    ) {
      return;
    }

    const draft = drafts[offering.offering_id];

    if (!draft) return;

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
            faculty_id: draft.faculty_id ? Number(draft.faculty_id) : null,
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

      setAutoPreview(null);
      setAutoPreviewConfig("");
      setActionMessage(
        data.message ||
          "Schedule saved. Professor assignment is optional; Registrar can publish without one.",
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

  const requestFacultyApproval = async (offering: BatchOffering) => {
    if (!selectedBatch || selectedBatch.batch_status !== "Published") return;
    const draft = drafts[offering.offering_id];
    const facultyId = draft?.faculty_id ? Number(draft.faculty_id) : 0;
    if (!facultyId || facultyId === Number(offering.faculty_id || 0)) {
      setRowErrors((current) => ({
        ...current,
        [offering.offering_id]:
          "Select a different professor for Registrar approval.",
      }));
      return;
    }
    if (
      selectedBatch.faculty_requests?.some(
        (request) => request.offering_id === offering.offering_id,
      )
    ) {
      setRowErrors((current) => ({
        ...current,
        [offering.offering_id]:
          "This subject already has a pending professor request.",
      }));
      return;
    }
    setRequestingFacultyId(offering.offering_id);
    setRowErrors((current) => ({ ...current, [offering.offering_id]: "" }));
    setActionError("");
    setActionMessage("");
    try {
      const data = await requestJson<FacultyRequestResponse>(
        `${BATCH_API}/${selectedBatch.batch_id}/offerings/${offering.offering_id}/request-faculty`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ faculty_id: facultyId }),
        },
      );
      const faculty = selectedBatch.faculty_options.find(
        (item) => item.faculty_id === facultyId,
      );
      setSelectedBatch((current) =>
        current
          ? {
              ...current,
              faculty_requests: [
                ...(current.faculty_requests || []),
                {
                  request_id: Number(data.request_id),
                  offering_id: offering.offering_id,
                  proposed_faculty_id: facultyId,
                  proposed_faculty_name:
                    faculty?.faculty_name || "Selected professor",
                  status: "Pending",
                },
              ],
            }
          : current,
      );
      setActionMessage(data.message || "Professor request sent to Registrar.");
    } catch (error) {
      setRowErrors((current) => ({
        ...current,
        [offering.offering_id]:
          error instanceof Error
            ? error.message
            : "Could not request professor approval.",
      }));
    } finally {
      setRequestingFacultyId(null);
    }
  };

  const returnBatch = async () => {
    if (!selectedBatch || !allOfferingsScheduled) return;

    const confirmed = window.confirm(
      "Send these class days and times to the Registrar for publication? A professor may be assigned later with a second Registrar approval.",
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
                <h1>Offering Batches</h1>
                <p>
                  Set class days and times first. Professors are optional and
                  can be proposed after publication.
                </p>
              </div>

              <button
                type="button"
                className="ph-offering-batches__button ph-offering-batches__button--light"
                onClick={() => setRefreshKey((key) => key + 1)}
                disabled={listLoading}
              >
                <RefreshCw
                  size={15}
                  className={listLoading ? "is-spinning" : ""}
                />
                Refresh
              </button>
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

            {canEdit && (
              <section className="ph-offering-batches__panel ph-offering-batches__auto-panel">
                <div className="ph-offering-batches__panel-heading">
                  <h2>
                    <WandSparkles size={17} /> Auto-Generate Class Schedules
                  </h2>
                  <span>All subjects · All sections in this batch</span>
                </div>
                <p className="ph-offering-batches__auto-help">
                  Choose the days and daily hours available for scheduling.
                  Classes in the same section will not overlap; classes in
                  different sections may run simultaneously when no professor or
                  room is shared. Professors are optional. Preview before
                  saving.
                </p>
                <div
                  className="ph-offering-batches__auto-presets"
                  aria-label="Quick allowed-day selections"
                >
                  {(
                    [
                      { label: "Monday only", days: ["Monday"] },
                      { label: "Tuesday only", days: ["Tuesday"] },
                      { label: "Wednesday only", days: ["Wednesday"] },
                      { label: "Mon–Fri", days: WEEK_DAYS.slice(0, 5) },
                      { label: "Mon–Sat", days: WEEK_DAYS.slice(0, 6) },
                    ] as { label: string; days: readonly WeekDay[] }[]
                  ).map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className="ph-offering-batches__button ph-offering-batches__button--light"
                      onClick={() =>
                        setAutoOption({ allowed_days: [...preset.days] })
                      }
                      disabled={autoLoading !== null}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <fieldset
                  className="ph-offering-batches__auto-days"
                  disabled={autoLoading !== null}
                >
                  <legend>Allowed days</legend>
                  <div>
                    {WEEK_DAYS.map((day) => (
                      <label key={day}>
                        <input
                          type="checkbox"
                          checked={autoForm.allowed_days.includes(day)}
                          onChange={() => toggleAutoDay(day)}
                        />{" "}
                        {day.slice(0, 3)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="ph-offering-batches__auto-fields">
                  <label>
                    <span>Earliest class start</span>
                    <input
                      type="time"
                      step="1800"
                      value={autoForm.day_start}
                      onChange={(event) =>
                        setAutoOption({ day_start: event.target.value })
                      }
                      disabled={autoLoading !== null}
                    />
                  </label>
                  <label>
                    <span>Latest class end</span>
                    <input
                      type="time"
                      step="1800"
                      value={autoForm.day_end}
                      onChange={(event) =>
                        setAutoOption({ day_end: event.target.value })
                      }
                      disabled={autoLoading !== null}
                    />
                  </label>
                  <label>
                    <span>Meeting duration</span>
                    <select
                      value={autoForm.duration_mode}
                      onChange={(event) =>
                        setAutoOption({
                          duration_mode: event.target.value as DurationMode,
                        })
                      }
                      disabled={autoLoading !== null}
                    >
                      <option value="units">Based on subject units</option>
                      <option value="fixed">
                        Fixed duration for all subjects
                      </option>
                    </select>
                  </label>
                  {autoForm.duration_mode === "units" ? (
                    <label>
                      <span>Minutes per unit</span>
                      <select
                        value={autoForm.minutes_per_unit}
                        onChange={(event) =>
                          setAutoOption({
                            minutes_per_unit: Number(event.target.value),
                          })
                        }
                        disabled={autoLoading !== null}
                      >
                        <option value={30}>30 minutes</option>
                        <option value={60}>60 minutes</option>
                        <option value={90}>90 minutes</option>
                      </select>
                    </label>
                  ) : (
                    <label>
                      <span>Minutes per subject</span>
                      <select
                        value={autoForm.fixed_minutes}
                        onChange={(event) =>
                          setAutoOption({
                            fixed_minutes: Number(event.target.value),
                          })
                        }
                        disabled={autoLoading !== null}
                      >
                        {[60, 90, 120, 150, 180, 210, 240].map((value) => (
                          <option key={value} value={value}>
                            {value} minutes
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    <span>Time increments</span>
                    <select
                      value={autoForm.slot_minutes}
                      onChange={(event) =>
                        setAutoOption({
                          slot_minutes: Number(event.target.value),
                        })
                      }
                      disabled={autoLoading !== null}
                    >
                      <option value={30}>Every 30 minutes</option>
                      <option value={60}>Every 60 minutes</option>
                    </select>
                  </label>
                </div>
                <label className="ph-offering-batches__auto-keep">
                  <input
                    type="checkbox"
                    checked={autoForm.replace_existing}
                    onChange={(event) =>
                      setAutoOption({ replace_existing: event.target.checked })
                    }
                    disabled={autoLoading !== null}
                  />
                  <span>
                    Replace existing schedules in this unpublished batch (off by
                    default)
                  </span>
                </label>
                <p className="ph-offering-batches__auto-help">
                  Each subject receives one meeting day per week; duration is
                  estimated from units or the fixed duration you choose. Verify
                  official lecture/laboratory contact-hour requirements before
                  Registrar approval. If the selected days cannot fit the
                  subjects, the generator will not create overlapping schedules.
                </p>
                {autoError && (
                  <div
                    className="ph-offering-batches__alert ph-offering-batches__alert--error"
                    role="alert"
                  >
                    <AlertCircle size={16} /> {autoError}
                  </div>
                )}
                <div className="ph-offering-batches__auto-actions">
                  <button
                    type="button"
                    className="ph-offering-batches__button ph-offering-batches__button--light"
                    onClick={() => void autoSchedule("preview")}
                    disabled={
                      autoLoading !== null ||
                      savingOfferingId !== null ||
                      returningBatch
                    }
                  >
                    <WandSparkles size={15} />{" "}
                    {autoLoading === "preview"
                      ? "Building preview…"
                      : "Preview schedules"}
                  </button>
                  <button
                    type="button"
                    className="ph-offering-batches__button ph-offering-batches__button--primary"
                    onClick={() => void autoSchedule("apply")}
                    disabled={
                      autoLoading !== null ||
                      !autoPreview ||
                      autoPreviewConfig !== JSON.stringify(autoForm) ||
                      savingOfferingId !== null ||
                      returningBatch
                    }
                  >
                    <Save size={15} />{" "}
                    {autoLoading === "apply"
                      ? "Saving schedules…"
                      : "Apply schedule to all sections"}
                  </button>
                </div>
                {autoPreview && (
                  <div className="ph-offering-batches__auto-preview">
                    <p>
                      <strong>Preview:</strong> {autoPreview.generated_count} to
                      generate · {autoPreview.preserved_count} unchanged.
                      Nothing saved yet.
                    </p>
                    <div className="ph-offering-batches__table-wrap">
                      <table className="ph-offering-batches__table">
                        <thead>
                          <tr>
                            <th>Section</th>
                            <th>Subject</th>
                            <th>Day</th>
                            <th>Time</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {autoPreview.entries.map((item) => (
                            <tr key={item.offering_id}>
                              <td>{item.section_name}</td>
                              <td>
                                {item.subject_code} · {item.subject_name}
                              </td>
                              <td>{item.schedule_days || "—"}</td>
                              <td>{item.schedule_time || "—"}</td>
                              <td>{item.generated ? "Generate" : "Keep"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </section>
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
                            const pendingFacultyRequest =
                              selectedBatch.faculty_requests?.find(
                                (request) =>
                                  request.offering_id === offering.offering_id,
                              );
                            const canProposeFaculty =
                              selectedBatch.batch_status === "Published" &&
                              offering.offering_status === "Open" &&
                              scheduled &&
                              !pendingFacultyRequest;
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
                                    <span>Professor (optional)</span>
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
                                        !(
                                          canEdit ||
                                          canUpdateProfessor ||
                                          canProposeFaculty
                                        ) ||
                                        savingOfferingId ===
                                          offering.offering_id ||
                                        autoLoading !== null ||
                                        requestingFacultyId ===
                                          offering.offering_id
                                      }
                                    >
                                      <option value="">
                                        Professor not assigned
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
                                  <small>
                                    {offering.faculty_name
                                      ? `Assigned: ${offering.faculty_name}`
                                      : "Professor: Not assigned"}
                                  </small>
                                  {pendingFacultyRequest && (
                                    <small>
                                      Registrar approval pending:{" "}
                                      {
                                        pendingFacultyRequest.proposed_faculty_name
                                      }
                                    </small>
                                  )}

                                  {canProposeFaculty && (
                                    <button
                                      type="button"
                                      className="ph-offering-batches__button ph-offering-batches__button--primary"
                                      onClick={() =>
                                        void requestFacultyApproval(offering)
                                      }
                                      disabled={
                                        requestingFacultyId ===
                                          offering.offering_id ||
                                        !draft.faculty_id ||
                                        Number(draft.faculty_id) ===
                                          Number(offering.faculty_id || 0)
                                      }
                                    >
                                      <Send size={14} />
                                      {requestingFacultyId ===
                                      offering.offering_id
                                        ? "Requesting…"
                                        : "Request Professor Approval"}
                                    </button>
                                  )}

                                  {(canEdit || canUpdateProfessor) && (
                                    <button
                                      type="button"
                                      className="ph-offering-batches__button ph-offering-batches__button--primary"
                                      onClick={() =>
                                        void saveOffering(offering)
                                      }
                                      disabled={
                                        savingOfferingId ===
                                          offering.offering_id ||
                                        autoLoading !== null ||
                                        (canUpdateProfessor &&
                                          Number(draft.faculty_id || 0) ===
                                            Number(offering.faculty_id || 0))
                                      }
                                    >
                                      <Save size={14} />
                                      {savingOfferingId === offering.offering_id
                                        ? "Saving…"
                                        : canUpdateProfessor
                                          ? "Update Professor"
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
                    savingOfferingId !== null ||
                    autoLoading !== null
                  }
                >
                  <Send size={15} />
                  {returningBatch ? "Returning…" : "Return to Registrar"}
                </button>
              </footer>
            ) : (
              <div className="ph-offering-batches__read-only-note">
                {selectedBatch.batch_status === "Published"
                  ? "Published schedules remain unchanged. Select a professor and request a second Registrar approval above."
                  : canUpdateProfessor
                    ? "Registrar review is pending. Days and times are locked; you may update the professor before publication."
                    : `Scheduling is locked while this batch is ${selectedBatch.batch_status.toLowerCase()}.`}
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
