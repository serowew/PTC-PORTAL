import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Eye,
  RefreshCw,
  Send,
  UsersRound,
  X,
} from "lucide-react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import "../../../styles/OfferingBatchesR.css";

const BATCH_API = apiUrl("/api/registrar/offering-batches");
const SETUP_API = apiUrl("/api/registrar/offerings/setup-data");

interface ApiResponse {
  success: boolean;
  message?: string;
  error?: string;
}

interface AcademicYearOption {
  academic_year_id: number;
  academic_year: string;
  is_current?: boolean | number;
}

interface OpenPeriod {
  enrollment_period_id: number;
  academic_year_id: number;
  semester_id: number;
  academic_year: string;
  semester_name: string;
  status: string;
}

interface CourseOption {
  course_id: number;
  course_code: string;
  course_name: string;
  total_years?: number;
}

interface CurriculumOption {
  curriculum_id: number;
  course_id: number;
  curriculum_name: string;
  effective_year: number;
  is_active?: boolean | number;
}

interface SectionOption {
  section_id: number;
  section_name: string;
  course_id: number;
  academic_year_id: number;
  year_level: number;
  max_students: number;
}

interface ProgramHeadOption {
  user_id: number;
  faculty_id: number;
  program_head_name: string;
  username: string;
  department_id?: number;
}

interface BatchOffering {
  offering_id: number;
  subject_code: string;
  subject_name: string;
  units: number;
  section_name: string;
  faculty_name: string | null;
  schedule_days: string | null;
  schedule_time: string | null;
  offering_status: string;
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
  offering_count: number;
  scheduled_count: number;
  submitted_at?: string;
  returned_at?: string | null;
  published_at?: string | null;
}

interface BatchDetail extends BatchListItem {
  section_ids?: number[];
  program_head_user_id?: number;
  submitted_by?: number;
  returned_by?: number | null;
  published_by?: number | null;
  offerings: BatchOffering[];
}

interface SetupResponse extends ApiResponse {
  academic_years?: AcademicYearOption[];
  courses?: CourseOption[];
  curricula?: CurriculumOption[];
}

interface OpenPeriodsResponse extends ApiResponse {
  open_periods?: OpenPeriod[];
}

interface SectionsResponse extends ApiResponse {
  sections?: SectionOption[];
  required_subject_count?: number;
}

interface ProgramHeadsResponse extends ApiResponse {
  program_heads?: ProgramHeadOption[];
}

interface BatchListResponse extends ApiResponse {
  batches?: BatchListItem[];
}

interface BatchDetailResponse extends ApiResponse {
  batch?: BatchDetail;
}

interface CreateBatchResponse extends ApiResponse {
  batch?: {
    batch_id: number;
    offering_count: number;
    batch_status: string;
  };
}

interface PublishResponse extends ApiResponse {
  batch_id?: number;
  published_offering_count?: number;
}

async function readResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(
      "Server returned a non-JSON response (" +
        response.status +
        "): " +
        text.slice(0, 180),
    );
  }
  return response.json() as Promise<T>;
}

function getErrorMessage(data: ApiResponse, fallback: string): string {
  return data.message || data.error || fallback;
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusClass(status: string): string {
  return status.toLowerCase().replace(/\s+/g, "-");
}

export default function ClassOfferingManagementR() {
  const session = authService.getSession();
  const userRole = session?.role;
  const [periods, setPeriods] = useState<OpenPeriod[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [curricula, setCurricula] = useState<CurriculumOption[]>([]);
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [programHeads, setProgramHeads] = useState<ProgramHeadOption[]>([]);

  const [academicYearId, setAcademicYearId] = useState("");
  const [semesterId, setSemesterId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [yearLevel, setYearLevel] = useState("");
  const [curriculumId, setCurriculumId] = useState("");
  const [programHeadUserId, setProgramHeadUserId] = useState("");
  const [selectedSectionIds, setSelectedSectionIds] = useState<number[]>([]);

  const [requiredSubjectCount, setRequiredSubjectCount] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [curriculaLoading, setCurriculaLoading] = useState(false);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [hasLoadedSections, setHasLoadedSections] = useState(false);
  const [programHeadsLoading, setProgramHeadsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [publishingBatchId, setPublishingBatchId] = useState<number | null>(
    null,
  );

  const [batches, setBatches] = useState<BatchListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedBatch, setSelectedBatch] = useState<BatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [initialError, setInitialError] = useState("");
  const [formError, setFormError] = useState("");
  const [queueError, setQueueError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const handleUnauthorized = useCallback(() => {
    authService.logout();
    window.location.assign("/login");
  }, []);

  const requestJson = useCallback(
    async <T extends ApiResponse>(
      url: string,
      options: RequestInit = {},
    ): Promise<T> => {
      const headers = new Headers(options.headers || {});
      headers.set("Accept", "application/json");
      const response = await authService.authFetch(url, {
        ...options,
        headers,
      });

      const data = await readResponse<T>(response);
      if (response.status === 401) {
        handleUnauthorized();
        throw new Error("Your session expired. Please sign in again.");
      }
      if (!response.ok || data.success === false) {
        throw new Error(
          getErrorMessage(data, "The request could not be completed."),
        );
      }
      return data;
    },
    [handleUnauthorized],
  );

  useEffect(() => {
    if (userRole !== "Registrar") return;
    const controller = new AbortController();
    let active = true;

    const loadInitialData = async () => {
      setInitialLoading(true);
      setInitialError("");
      try {
        const [periodData, setupData] = await Promise.all([
          requestJson<OpenPeriodsResponse>(BATCH_API + "/open-periods", {
            signal: controller.signal,
          }),
          requestJson<SetupResponse>(SETUP_API, {
            signal: controller.signal,
          }),
        ]);
        if (!active) return;
        setPeriods(periodData.open_periods || []);
        setCourses(setupData.courses || []);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (!active) return;
        setInitialError(
          error instanceof Error
            ? error.message
            : "Could not load Registrar setup data.",
        );
      } finally {
        if (active) setInitialLoading(false);
      }
    };

    void loadInitialData();
    return () => {
      active = false;
      controller.abort();
    };
  }, [userRole, requestJson, refreshKey]);

  const academicYears = useMemo(() => {
    const unique = new Map<number, AcademicYearOption>();
    periods.forEach((period) => {
      unique.set(period.academic_year_id, {
        academic_year_id: period.academic_year_id,
        academic_year: period.academic_year,
      });
    });
    return Array.from(unique.values());
  }, [periods]);

  const semestersForYear = useMemo(
    () =>
      periods.filter(
        (period) => String(period.academic_year_id) === academicYearId,
      ),
    [periods, academicYearId],
  );

  const selectedCourse = useMemo(
    () => courses.find((course) => String(course.course_id) === courseId),
    [courses, courseId],
  );

  const yearLevels = useMemo(() => {
    const totalYears = Number(selectedCourse?.total_years || 4);
    return Array.from(
      { length: Math.max(1, Math.min(totalYears, 8)) },
      (_, index) => index + 1,
    );
  }, [selectedCourse]);

  const selectedPeriod = useMemo(
    () =>
      periods.find(
        (period) =>
          String(period.academic_year_id) === academicYearId &&
          String(period.semester_id) === semesterId,
      ),
    [periods, academicYearId, semesterId],
  );

  useEffect(() => {
    if (!courseId) {
      setCurricula([]);
      setCurriculumId("");
      return;
    }
    const controller = new AbortController();
    let active = true;
    setCurriculaLoading(true);
    setCurricula([]);
    setCurriculumId("");

    requestJson<SetupResponse>(
      SETUP_API + "?course_id=" + encodeURIComponent(courseId),
      {
        signal: controller.signal,
      },
    )
      .then((data) => {
        if (active) setCurricula(data.curricula || []);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (active)
          setFormError(
            error instanceof Error
              ? error.message
              : "Could not load curricula.",
          );
      })
      .finally(() => {
        if (active) setCurriculaLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [courseId, requestJson]);

  useEffect(() => {
    if (!courseId) {
      setProgramHeads([]);
      setProgramHeadUserId("");
      return;
    }
    const controller = new AbortController();
    let active = true;
    setProgramHeadsLoading(true);
    setProgramHeads([]);
    setProgramHeadUserId("");

    requestJson<ProgramHeadsResponse>(
      BATCH_API + "/program-heads?course_id=" + encodeURIComponent(courseId),
      { signal: controller.signal },
    )
      .then((data) => {
        if (active) setProgramHeads(data.program_heads || []);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (active)
          setFormError(
            error instanceof Error
              ? error.message
              : "Could not load Program Heads.",
          );
      })
      .finally(() => {
        if (active) setProgramHeadsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [courseId, requestJson]);

  useEffect(() => {
    if (
      !academicYearId ||
      !semesterId ||
      !courseId ||
      !yearLevel ||
      !curriculumId
    ) {
      setSections([]);
      setSelectedSectionIds([]);
      setRequiredSubjectCount(0);
      setHasLoadedSections(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    const params = new URLSearchParams({
      academic_year_id: academicYearId,
      semester_id: semesterId,
      course_id: courseId,
      curriculum_id: curriculumId,
      year_level: yearLevel,
    });
    setSectionsLoading(true);
    setSections([]);
    setSelectedSectionIds([]);
    setFormError("");

    requestJson<SectionsResponse>(
      BATCH_API + "/sections?" + params.toString(),
      {
        signal: controller.signal,
      },
    )
      .then((data) => {
        if (!active) return;
        setSections(data.sections || []);
        setRequiredSubjectCount(Number(data.required_subject_count || 0));
        setHasLoadedSections(true);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        if (active)
          setFormError(
            error instanceof Error
              ? error.message
              : "Could not load matching sections.",
          );
      })
      .finally(() => {
        if (active) setSectionsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    academicYearId,
    semesterId,
    courseId,
    yearLevel,
    curriculumId,
    requestJson,
  ]);

  const loadBatches = useCallback(async () => {
    setQueueLoading(true);
    setQueueError("");
    try {
      const data = await requestJson<BatchListResponse>(BATCH_API);
      setBatches(data.batches || []);
    } catch (error) {
      setQueueError(
        error instanceof Error
          ? error.message
          : "Could not load offering batches.",
      );
    } finally {
      setQueueLoading(false);
    }
  }, [requestJson]);

  useEffect(() => {
    if (userRole === "Registrar") void loadBatches();
  }, [userRole, loadBatches, refreshKey]);

  const visibleBatches = useMemo(
    () =>
      statusFilter === "All"
        ? batches
        : batches.filter((batch) => batch.batch_status === statusFilter),
    [batches, statusFilter],
  );

  const statusCounts = useMemo(
    () => ({
      pending: batches.filter(
        (batch) => batch.batch_status === "Pending Program Head",
      ).length,
      ready: batches.filter(
        (batch) => batch.batch_status === "Ready for Registrar",
      ).length,
      published: batches.filter((batch) => batch.batch_status === "Published")
        .length,
    }),
    [batches],
  );

  const toggleSection = (sectionId: number) => {
    setSelectedSectionIds((current) =>
      current.includes(sectionId)
        ? current.filter((id) => id !== sectionId)
        : [...current, sectionId],
    );
  };

  const selectAllSections = () => {
    setSelectedSectionIds((current) =>
      current.length === sections.length
        ? []
        : sections.map((section) => section.section_id),
    );
  };

  const handleAcademicYearChange = (value: string) => {
    setAcademicYearId(value);
    setSemesterId("");
    setSelectedSectionIds([]);
  };

  const handleCourseChange = (value: string) => {
    setCourseId(value);
    setYearLevel("");
    setCurriculumId("");
    setSelectedSectionIds([]);
    setFormError("");
  };

  const handleCreateBatch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError("");
    setNotice("");

    if (!selectedPeriod) {
      setFormError("Select an academic year and an open semester.");
      return;
    }
    if (!courseId || !curriculumId || !yearLevel) {
      setFormError("Select the course, curriculum, and year level.");
      return;
    }
    if (selectedSectionIds.length === 0) {
      setFormError("Select at least one section to send.");
      return;
    }
    if (!programHeadUserId) {
      setFormError("Choose the Program Head who will receive this batch.");
      return;
    }

    setSubmitting(true);
    try {
      const data = await requestJson<CreateBatchResponse>(BATCH_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          academic_year_id: Number(academicYearId),
          semester_id: Number(semesterId),
          course_id: Number(courseId),
          curriculum_id: Number(curriculumId),
          year_level: Number(yearLevel),
          section_ids: selectedSectionIds,
          program_head_user_id: Number(programHeadUserId),
        }),
      });
      const createdCount = Number(data.batch?.offering_count || 0);
      setNotice(
        (data.message || "Offering batch sent to the Program Head.") +
          (createdCount
            ? " " + createdCount + " unassigned offerings were created."
            : ""),
      );
      setSelectedSectionIds([]);
      await loadBatches();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Could not create the offering batch.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const openBatchDetail = async (batchId: number) => {
    setSelectedBatch(null);
    setDetailLoading(true);
    setQueueError("");
    try {
      const data = await requestJson<BatchDetailResponse>(
        BATCH_API + "/" + batchId,
      );
      setSelectedBatch(data.batch || null);
    } catch (error) {
      setQueueError(
        error instanceof Error
          ? error.message
          : "Could not load batch details.",
      );
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (!detailLoading && !selectedBatch) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !detailLoading && publishingBatchId === null) {
        setSelectedBatch(null);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [detailLoading, selectedBatch, publishingBatchId]);

  const publishBatch = async (batch: BatchDetail) => {
    if (batch.batch_status !== "Ready for Registrar") return;
    const confirmed = window.confirm(
      "Publish batch #" +
        batch.batch_id +
        "? Its offerings will become Open and available for enrollment.",
    );
    if (!confirmed) return;

    setPublishingBatchId(batch.batch_id);
    setQueueError("");
    setNotice("");
    try {
      const data = await requestJson<PublishResponse>(
        BATCH_API + "/" + batch.batch_id + "/publish",
        {
          method: "POST",
        },
      );
      setNotice(
        (data.message || "The schedule was published.") +
          (data.published_offering_count
            ? " " + data.published_offering_count + " offerings are now open."
            : ""),
      );
      await loadBatches();
      const refreshed = await requestJson<BatchDetailResponse>(
        BATCH_API + "/" + batch.batch_id,
      );
      setSelectedBatch(refreshed.batch || null);
    } catch (error) {
      setQueueError(
        error instanceof Error
          ? error.message
          : "Could not publish this batch.",
      );
    } finally {
      setPublishingBatchId(null);
    }
  };

  const modalHost = typeof document !== "undefined"
    ? document.querySelector(".dashboard-wrapper")
    : null;

  if (userRole !== "Registrar") return null;

  return (
    <DashboardLayout>
      <main className="offering-batches-page">
        <header className="offering-batches-hero">
          <div>
            <span className="offering-batches-eyebrow">
              <BookOpenCheck size={16} /> Registrar · Enrollment
            </span>
            <h1>Class Offerings</h1>
            <p>
              Choose an open academic period, select sections, and send the
              unassigned offerings to a Program Head for scheduling.
            </p>
          </div>
          <button
            type="button"
            className="offering-batches-button offering-batches-button--secondary"
            onClick={() => setRefreshKey((value) => value + 1)}
            disabled={initialLoading || queueLoading}
          >
            <RefreshCw size={16} /> Refresh
          </button>
        </header>

        <section
          className="offering-batches-stats"
          aria-label="Batch status summary"
        >
          <article>
            <span>Pending Program Head</span>
            <strong>{statusCounts.pending}</strong>
          </article>
          <article>
            <span>Ready for Registrar</span>
            <strong>{statusCounts.ready}</strong>
          </article>
          <article>
            <span>Published</span>
            <strong>{statusCounts.published}</strong>
          </article>
        </section>

        {initialError && (
          <div className="offering-batches-alert offering-batches-alert--error">
            <AlertCircle size={18} />
            {initialError}
          </div>
        )}
        {notice && (
          <div className="offering-batches-alert offering-batches-alert--success">
            <CheckCircle2 size={18} />
            {notice}
          </div>
        )}

        <section className="offering-batches-panel">
          <div className="offering-batches-panel-heading">
            <div className="offering-batches-step">1</div>
            <div>
              <h2>Prepare and send a batch</h2>
              <p>
                The backend creates closed, unpublished offerings for each
                selected section.
              </p>
            </div>
          </div>

          {formError && (
            <div className="offering-batches-alert offering-batches-alert--error">
              <AlertCircle size={18} />
              {formError}
            </div>
          )}

          <form onSubmit={handleCreateBatch}>
            <div className="offering-batches-form-grid">
              <label>
                <span>Academic year</span>
                <select
                  value={academicYearId}
                  onChange={(event) =>
                    handleAcademicYearChange(event.target.value)
                  }
                  disabled={initialLoading}
                >
                  <option value="">Select academic year</option>
                  {academicYears.map((year) => (
                    <option
                      key={year.academic_year_id}
                      value={String(year.academic_year_id)}
                    >
                      {year.academic_year}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Open semester</span>
                <select
                  value={semesterId}
                  onChange={(event) => setSemesterId(event.target.value)}
                  disabled={!academicYearId}
                >
                  <option value="">Select open semester</option>
                  {semestersForYear.map((period) => (
                    <option
                      key={period.enrollment_period_id}
                      value={String(period.semester_id)}
                    >
                      {period.semester_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Course / program</span>
                <select
                  value={courseId}
                  onChange={(event) => handleCourseChange(event.target.value)}
                  disabled={!semesterId}
                >
                  <option value="">Select course</option>
                  {courses.map((course) => (
                    <option
                      key={course.course_id}
                      value={String(course.course_id)}
                    >
                      {course.course_code} — {course.course_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Year level</span>
                <select
                  value={yearLevel}
                  onChange={(event) => {
                    setYearLevel(event.target.value);
                    setSelectedSectionIds([]);
                  }}
                  disabled={!courseId}
                >
                  <option value="">Select year level</option>
                  {yearLevels.map((level) => (
                    <option key={level} value={String(level)}>
                      Year {level}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Curriculum</span>
                <select
                  value={curriculumId}
                  onChange={(event) => {
                    setCurriculumId(event.target.value);
                    setSelectedSectionIds([]);
                  }}
                  disabled={!yearLevel || curriculaLoading}
                >
                  <option value="">
                    {curriculaLoading
                      ? "Loading curricula…"
                      : "Select active curriculum"}
                  </option>
                  {curricula.map((curriculum) => (
                    <option
                      key={curriculum.curriculum_id}
                      value={String(curriculum.curriculum_id)}
                    >
                      {curriculum.curriculum_name} ({curriculum.effective_year})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Program Head recipient</span>
                <select
                  value={programHeadUserId}
                  onChange={(event) => setProgramHeadUserId(event.target.value)}
                  disabled={!courseId || programHeadsLoading}
                >
                  <option value="">
                    {programHeadsLoading
                      ? "Loading Program Heads…"
                      : "Choose a Program Head"}
                  </option>
                  {programHeads.map((head) => (
                    <option key={head.user_id} value={String(head.user_id)}>
                      {head.program_head_name} ({head.username})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="offering-batches-section-picker">
              <div className="offering-batches-section-heading">
                <div>
                  <h3>
                    <UsersRound size={18} /> Matching sections
                  </h3>
                  <p>
                    {sectionsLoading
                      ? "Loading sections for the selected setup…"
                      : sections.length
                        ? "Select one or more sections to include in this batch."
                        : hasLoadedSections
                          ? "No matching sections were found for this setup."
                          : "Select the open term, course, year level, and curriculum to load sections."}
                  </p>
                </div>
                {sections.length > 0 && (
                  <button
                    type="button"
                    className="offering-batches-link-button"
                    onClick={selectAllSections}
                  >
                    {selectedSectionIds.length === sections.length
                      ? "Clear selection"
                      : "Select all"}
                  </button>
                )}
              </div>

              {sections.length > 0 && (
                <>
                  <div className="offering-batches-section-list">
                    {sections.map((section) => {
                      const checked = selectedSectionIds.includes(
                        section.section_id,
                      );
                      return (
                        <label
                          className={
                            "offering-batches-section-option" +
                            (checked ? " is-selected" : "")
                          }
                          key={section.section_id}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSection(section.section_id)}
                          />
                          <span
                            className="offering-batches-section-check"
                            aria-hidden="true"
                          />
                          <span className="offering-batches-section-copy">
                            <strong>{section.section_name}</strong>
                            <small>
                              Year {section.year_level} · Capacity{" "}
                              {section.max_students}
                            </small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="offering-batches-selection-summary">
                    <ClipboardList size={17} />
                    <span>{selectedSectionIds.length} section(s) selected</span>
                    <span>
                      {requiredSubjectCount} required subject(s) per section
                    </span>
                    <strong>
                      {selectedSectionIds.length * requiredSubjectCount}{" "}
                      offering row(s) to create
                    </strong>
                  </div>
                </>
              )}
            </div>

            <div className="offering-batches-form-footer">
              <span>
                {selectedPeriod
                  ? selectedPeriod.academic_year +
                    " · " +
                    selectedPeriod.semester_name
                  : "Only Registrar-open semesters can be selected."}
              </span>
              <button
                type="submit"
                className="offering-batches-button offering-batches-button--primary"
                disabled={
                  submitting ||
                  initialLoading ||
                  !selectedPeriod ||
                  !courseId ||
                  !curriculumId ||
                  !yearLevel ||
                  !selectedSectionIds.length ||
                  !programHeadUserId
                }
              >
                <Send size={16} />{" "}
                {submitting ? "Sending batch…" : "Create and send batch"}
              </button>
            </div>
          </form>
        </section>

        <section className="offering-batches-panel offering-batches-queue">
          <div className="offering-batches-panel-heading offering-batches-panel-heading--queue">
            <div className="offering-batches-step">2</div>
            <div>
              <h2>Batch review and publication</h2>
              <p>
                Review the schedule returned by the Program Head, then publish
                the valid batch.
              </p>
            </div>
            <label className="offering-batches-filter">
              <span>Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option>All</option>
                <option>Pending Program Head</option>
                <option>Ready for Registrar</option>
                <option>Published</option>
              </select>
            </label>
          </div>
          {queueError && (
            <div className="offering-batches-alert offering-batches-alert--error">
              <AlertCircle size={18} />
              {queueError}
            </div>
          )}
          {queueLoading ? (
            <div className="offering-batches-empty">
              <RefreshCw size={18} className="offering-batches-spin" /> Loading
              batches…
            </div>
          ) : visibleBatches.length === 0 ? (
            <div className="offering-batches-empty">
              No batches match this status.
            </div>
          ) : (
            <div className="offering-batches-list">
              {visibleBatches.map((batch) => (
                <article className="offering-batches-card" key={batch.batch_id}>
                  <div className="offering-batches-card-main">
                    <div className="offering-batches-card-title">
                      <strong>
                        {batch.course_code} · Year {batch.year_level}
                      </strong>
                      <span
                        className={
                          "offering-batches-status offering-batches-status--" +
                          statusClass(batch.batch_status)
                        }
                      >
                        {batch.batch_status}
                      </span>
                    </div>
                    <p>
                      {batch.academic_year} · {batch.semester_name} ·{" "}
                      {batch.curriculum_name}
                    </p>
                    <small>
                      {batch.offering_count} offerings ·{" "}
                      {batch.scheduled_count || 0} scheduled · Submitted{" "}
                      {formatDate(batch.submitted_at)}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="offering-batches-button offering-batches-button--secondary"
                    onClick={() => void openBatchDetail(batch.batch_id)}
                  >
                    <Eye size={16} /> Review
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        {(detailLoading || selectedBatch) && modalHost && createPortal(
          <div
            className="offering-batches-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !detailLoading && publishingBatchId === null)
                setSelectedBatch(null);
            }}
          >
            <section
              className="offering-batches-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="offering-batches-modal-title"
            >
              <header className="offering-batches-modal-header">
                <div>
                  <span className="offering-batches-eyebrow">
                    <ClipboardList size={15} /> Registrar batch review
                  </span>
                  <h2 id="offering-batches-modal-title">
                    {selectedBatch
                      ? "Batch #" + selectedBatch.batch_id
                      : "Loading batch…"}
                  </h2>
                </div>
                <button
                  type="button"
                  className="offering-batches-icon-button"
                  aria-label="Close"
                  onClick={() => setSelectedBatch(null)}
                  disabled={detailLoading || publishingBatchId !== null}
                >
                  <X size={20} />
                </button>
              </header>
              {detailLoading ? (
                <div className="offering-batches-empty">
                  <RefreshCw size={18} className="offering-batches-spin" />{" "}
                  Loading batch details…
                </div>
              ) : selectedBatch ? (
                <>
                  <div className="offering-batches-detail-meta">
                    <span>
                      {selectedBatch.course_code} · Year{" "}
                      {selectedBatch.year_level}
                    </span>
                    <span>
                      {selectedBatch.academic_year} ·{" "}
                      {selectedBatch.semester_name}
                    </span>
                    <span>{selectedBatch.curriculum_name}</span>
                    <span
                      className={
                        "offering-batches-status offering-batches-status--" +
                        statusClass(selectedBatch.batch_status)
                      }
                    >
                      {selectedBatch.batch_status}
                    </span>
                  </div>
                  <div className="offering-batches-table-wrap">
                    <table className="offering-batches-table">
                      <thead>
                        <tr>
                          <th>Subject</th>
                          <th>Section</th>
                          <th>Faculty</th>
                          <th>Days</th>
                          <th>Time</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedBatch.offerings || []).map((offering) => (
                          <tr key={offering.offering_id}>
                            <td>
                              <strong>{offering.subject_code}</strong>
                              <small>
                                {offering.subject_name} · {offering.units} units
                              </small>
                            </td>
                            <td>{offering.section_name}</td>
                            <td>{offering.faculty_name || "Unassigned"}</td>
                            <td>{offering.schedule_days || "—"}</td>
                            <td>{offering.schedule_time || "—"}</td>
                            <td>{offering.offering_status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <footer className="offering-batches-modal-footer">
                    <span>
                      <CalendarDays size={16} /> Returned{" "}
                      {formatDate(selectedBatch.returned_at)}
                    </span>
                    {selectedBatch.batch_status === "Ready for Registrar" && (
                      <button
                        type="button"
                        className="offering-batches-button offering-batches-button--primary"
                        onClick={() => void publishBatch(selectedBatch)}
                        disabled={publishingBatchId === selectedBatch.batch_id}
                      >
                        <CheckCircle2 size={16} />{" "}
                        {publishingBatchId === selectedBatch.batch_id
                          ? "Publishing…"
                          : "Publish schedule"}
                      </button>
                    )}
                    {selectedBatch.batch_status === "Published" && (
                      <span className="offering-batches-published-note">
                        <CheckCircle2 size={16} /> Published{" "}
                        {formatDate(selectedBatch.published_at)}
                      </span>
                    )}
                  </footer>
                </>
              ) : null}
            </section>
          </div>,
          modalHost,
        )}
      </main>
    </DashboardLayout>
  );
}
