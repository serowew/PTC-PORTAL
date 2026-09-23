import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  BookCheck,
  BookOpenCheck,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  FileCheck2,
  FileText,
  Filter,
  GraduationCap,
  RefreshCw,
  RotateCcw,
  School,
  Search,
  ShieldCheck,
  Undo2,
  UserRound,
  X,
  XCircle,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/ProgramHeadTransferEvaluation.css";

const API_BASE_URL =
  "http://localhost:3000/api/program-head/transfer-evaluations";

type CreditStatus = "Pending" | "Credited" | "Not Credited";
type DecisionStatus = Exclude<CreditStatus, "Pending">;
type ReviewFilter = "All" | "Pending" | "Ready" | "Unmapped";

interface ProgramHeadInfo {
  program_head_id: number;
  faculty_id: number | null;
  user_id: number;
  employee_number: string;
  username: string;
  program_head_name: string;
  department: {
    department_id: number;
    department_code: string;
    department_name: string;
  };
}

interface TranscriptDocumentSummary {
  document_id: number;
  document_type: string | null;
  file_name: string | null;
  verification_status: string | null;
}

interface TransferEvaluationQueueItem {
  transfer_evaluation_id: number;
  evaluation_status: string;
  student: {
    student_id: number;
    student_number: string;
    student_name: string;
    current_year_level: number | null;
  };
  curriculum: {
    curriculum_id: number;
    curriculum_name: string;
    effective_year: number | null;
    total_units: number | null;
    course: {
      course_id: number;
      course_code: string;
      course_name: string;
      department_id: number;
      department_code: string;
      department_name: string;
    };
  };
  source: {
    school: string;
    course: string | null;
    student_number: string | null;
    transcript_reference: string | null;
    transcript_document: TranscriptDocumentSummary | null;
  };
  ptc_entry: {
    year_level: number | null;
    semester_id: number | null;
    semester_name: string | null;
  };
  workflow: {
    submitted_by: number | null;
    submitted_by_username: string | null;
    submitted_at: string | null;
    reviewed_by: number | null;
    reviewed_at: string | null;
    review_remarks: string | null;
  };
  summary: {
    total_subjects: number;
    mapped_subjects: number;
    unmapped_subjects: number;
    pending_subjects: number;
    credited_subjects: number;
    not_credited_subjects: number;
    official_transfer_credits: number;
  };
  remarks: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface TransferQueueResponse {
  success: boolean;
  program_head?: ProgramHeadInfo;
  summary?: {
    total_submitted: number;
    total_subjects: number;
    mapped_subjects: number;
    unmapped_subjects: number;
    pending_subjects: number;
    official_transfer_credits: number;
  };
  evaluations?: TransferEvaluationQueueItem[];
  message?: string;
  error?: string;
}

interface TransferSubject {
  transfer_subject_id: number;
  transfer_evaluation_id: number;
  source: {
    subject_code: string | null;
    subject_name: string;
    units: number | null;
    grade: string | null;
    remarks: string | null;
    academic_year: string | null;
    year_level: number | null;
    semester: string | null;
  };
  proposed_ptc_equivalency: {
    curriculum_subject_id: number | null;
    subject_id: number;
    subject_code: string;
    subject_name: string;
    units: number | null;
    lecture_hours: number | null;
    laboratory_hours: number | null;
    description: string | null;
    is_active: boolean;
    curriculum: {
      year_level: number | null;
      semester_id: number | null;
      semester_name: string | null;
      is_required: boolean;
      display_order: number | null;
    };
  } | null;
  decision: {
    credit_status: CreditStatus;
    credited_units: number | null;
    decision_reason: string | null;
    reviewed_by: number | null;
    reviewed_by_username: string | null;
    reviewed_at: string | null;
  };
  created_at: string | null;
  updated_at: string | null;
}

interface TransferEvaluationDetail {
  transfer_evaluation_id: number;
  evaluation_status: string;
  student: {
    student_id: number;
    student_number: string;
    student_name: string;
    current_year_level: number | null;
    stored_course_id: number | null;
  };
  curriculum: {
    curriculum_id: number;
    curriculum_name: string;
    effective_year: number | null;
    total_units: number | null;
    is_active: boolean;
    course: {
      course_id: number;
      course_code: string;
      course_name: string;
      total_years: number | null;
      department_id: number;
      department_code: string;
      department_name: string;
    };
  };
  source: {
    school: string;
    course: string | null;
    student_number: string | null;
    transcript_reference: string | null;
    transcript_document: {
      document_id: number;
      document_type: string | null;
      file_name: string | null;
      verification_status: string | null;
      remarks: string | null;
      verified_by: number | null;
      verified_at: string | null;
      uploaded_at: string | null;
    } | null;
  };
  ptc_entry: {
    year_level: number | null;
    semester_id: number | null;
    semester_name: string | null;
  };
  workflow: {
    created_by: number | null;
    created_by_username: string | null;
    submitted_by: number | null;
    submitted_by_username: string | null;
    submitted_at: string | null;
    reviewed_by: number | null;
    reviewed_by_username: string | null;
    reviewed_at: string | null;
    review_remarks: string | null;
  };
  remarks: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface ReviewDetailResponse {
  success: boolean;
  program_head?: ProgramHeadInfo;
  evaluation?: TransferEvaluationDetail;
  summary?: {
    total_subjects: number;
    mapped_subjects: number;
    unmapped_subjects: number;
    pending_subjects: number;
    credited_subjects: number;
    not_credited_subjects: number;
    official_transfer_credits: number;
  };
  review_readiness?: {
    evaluation_status: string;
    can_review: boolean;
    can_make_subject_decisions: boolean;
    all_subjects_decided: boolean;
    can_complete_evaluation: boolean;
    note: string;
  };
  subjects?: TransferSubject[];
  academic_effect?: {
    read_only: boolean;
    credit_decision_made: boolean;
    official_transfer_credit: boolean;
    satisfies_curriculum_requirements: boolean;
    changes_ptc_grades: boolean;
    changes_current_enrollment: boolean;
    reason: string;
  };
  next_action?: string;
  message?: string;
  error?: string;
}

interface MutationResponse {
  success: boolean;
  message?: string;
  error?: string;
}

interface ActionNotice {
  type: "success" | "error";
  message: string;
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

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatYearLevel(value: number | null | undefined) {
  if (!value) {
    return "Not recorded";
  }

  if (value === 1) return "1st Year";
  if (value === 2) return "2nd Year";
  if (value === 3) return "3rd Year";

  return `${value}th Year`;
}

function formatUnits(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }

  return `${Number(value)} ${Number(value) === 1 ? "unit" : "units"}`;
}

function getStatusClass(status: CreditStatus) {
  if (status === "Credited") {
    return "credited";
  }

  if (status === "Not Credited") {
    return "not-credited";
  }

  return "pending";
}

function getReviewProgress(item: TransferEvaluationQueueItem) {
  if (item.summary.total_subjects <= 0) {
    return 0;
  }

  const decided =
    item.summary.total_subjects - item.summary.pending_subjects;

  return Math.max(
    0,
    Math.min(
      100,
      Math.round((decided / item.summary.total_subjects) * 100),
    ),
  );
}

export default function TransferEvaluationReview() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();
  const authenticated = Boolean(session && token);
  const userRole = session?.role;

  const [programHead, setProgramHead] =
    useState<ProgramHeadInfo | null>(null);
  const [evaluations, setEvaluations] = useState<
    TransferEvaluationQueueItem[]
  >([]);
  const [queueSummary, setQueueSummary] =
    useState<TransferQueueResponse["summary"]>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [queueError, setQueueError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("All");
  const [semesterFilter, setSemesterFilter] = useState("All");
  const [reviewFilter, setReviewFilter] =
    useState<ReviewFilter>("All");

  const [selectedEvaluationId, setSelectedEvaluationId] =
    useState<number | null>(null);
  const [detail, setDetail] =
    useState<ReviewDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [decisionSubject, setDecisionSubject] =
    useState<TransferSubject | null>(null);
  const [decisionStatus, setDecisionStatus] =
    useState<DecisionStatus>("Credited");
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionError, setDecisionError] = useState("");

  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [returnError, setReturnError] = useState("");

  const [completeModalOpen, setCompleteModalOpen] =
    useState(false);
  const [completionRemarks, setCompletionRemarks] = useState("");
  const [completionError, setCompletionError] = useState("");

  const [busyAction, setBusyAction] = useState<
    "decision" | "return" | "complete" | null
  >(null);
  const [actionNotice, setActionNotice] =
    useState<ActionNotice | null>(null);

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

    const loadQueue = async () => {
      try {
        if (refreshKey === 0) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }

        setQueueError("");

        const response = await authService.authFetch(
          `${API_BASE_URL}/submitted`,
          {
            method: "GET",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          },
        );

        const data =
          await readJsonResponse<TransferQueueResponse>(response);

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (response.status === 403) {
          throw new Error(
            data.message ||
              "Program Head access is required for transfer evaluation review.",
          );
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message ||
              data.error ||
              "Unable to load submitted transfer evaluations.",
          );
        }

        setProgramHead(data.program_head || null);
        setQueueSummary(data.summary);
        setEvaluations(
          Array.isArray(data.evaluations) ? data.evaluations : [],
        );
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error(
          "LOAD PROGRAM HEAD TRANSFER EVALUATIONS ERROR:",
          requestError,
        );

        setEvaluations([]);
        setQueueSummary(undefined);
        setQueueError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load transfer evaluations.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void loadQueue();

    return () => controller.abort();
  }, [authenticated, userRole, navigate, refreshKey]);

  useEffect(() => {
    const hasOverlay =
      selectedEvaluationId !== null ||
      decisionSubject !== null ||
      returnModalOpen ||
      completeModalOpen;

    if (!hasOverlay) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [
    selectedEvaluationId,
    decisionSubject,
    returnModalOpen,
    completeModalOpen,
  ]);

  const courses = useMemo(() => {
    return Array.from(
      new Map(
        evaluations.map((item) => [
          item.curriculum.course.course_id,
          item.curriculum.course.course_code,
        ]),
      ).entries(),
    ).sort((a, b) => a[1].localeCompare(b[1]));
  }, [evaluations]);

  const semesters = useMemo(() => {
    return Array.from(
      new Map(
        evaluations
          .filter((item) => item.ptc_entry.semester_id)
          .map((item) => [
            Number(item.ptc_entry.semester_id),
            item.ptc_entry.semester_name || "Semester",
          ]),
      ).entries(),
    ).sort((a, b) => a[0] - b[0]);
  }, [evaluations]);

  const filteredEvaluations = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return evaluations.filter((item) => {
      const matchesSearch =
        !normalizedSearch ||
        item.student.student_number
          .toLowerCase()
          .includes(normalizedSearch) ||
        item.student.student_name
          .toLowerCase()
          .includes(normalizedSearch) ||
        item.source.school
          .toLowerCase()
          .includes(normalizedSearch) ||
        String(item.source.course || "")
          .toLowerCase()
          .includes(normalizedSearch) ||
        item.curriculum.curriculum_name
          .toLowerCase()
          .includes(normalizedSearch) ||
        item.curriculum.course.course_code
          .toLowerCase()
          .includes(normalizedSearch) ||
        String(item.source.transcript_reference || "")
          .toLowerCase()
          .includes(normalizedSearch);

      const matchesCourse =
        courseFilter === "All" ||
        String(item.curriculum.course.course_id) === courseFilter;

      const matchesSemester =
        semesterFilter === "All" ||
        String(item.ptc_entry.semester_id) === semesterFilter;

      const matchesReview =
        reviewFilter === "All" ||
        (reviewFilter === "Pending" &&
          item.summary.pending_subjects > 0) ||
        (reviewFilter === "Ready" &&
          item.summary.total_subjects > 0 &&
          item.summary.pending_subjects === 0) ||
        (reviewFilter === "Unmapped" &&
          item.summary.unmapped_subjects > 0);

      return (
        matchesSearch &&
        matchesCourse &&
        matchesSemester &&
        matchesReview
      );
    });
  }, [
    evaluations,
    search,
    courseFilter,
    semesterFilter,
    reviewFilter,
  ]);

  const hasActiveFilters =
    search.trim() !== "" ||
    courseFilter !== "All" ||
    semesterFilter !== "All" ||
    reviewFilter !== "All";

  const clearFilters = () => {
    setSearch("");
    setCourseFilter("All");
    setSemesterFilter("All");
    setReviewFilter("All");
  };

  const refreshQueue = () => {
    setActionNotice(null);
    setRefreshKey((current) => current + 1);
  };

  const loadEvaluationDetail = async (
    evaluationId: number,
    showLoading = true,
  ) => {
    try {
      if (showLoading) {
        setDetailLoading(true);
      }

      setDetailError("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${evaluationId}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
      );

      const data =
        await readJsonResponse<ReviewDetailResponse>(response);

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return null;
      }

      if (!response.ok || !data.success || !data.evaluation) {
        throw new Error(
          data.message ||
            data.error ||
            "Unable to load transfer evaluation review details.",
        );
      }

      setDetail(data);

      if (data.program_head) {
        setProgramHead(data.program_head);
      }

      return data;
    } catch (requestError) {
      console.error(
        "LOAD PROGRAM HEAD TRANSFER EVALUATION DETAIL ERROR:",
        requestError,
      );

      setDetailError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load transfer evaluation details.",
      );

      return null;
    } finally {
      setDetailLoading(false);
    }
  };

  const openReview = async (evaluationId: number) => {
    setSelectedEvaluationId(evaluationId);
    setDetail(null);
    setActionNotice(null);

    await loadEvaluationDetail(evaluationId);
  };

  const closeReview = () => {
    if (busyAction) {
      return;
    }

    setSelectedEvaluationId(null);
    setDetail(null);
    setDetailError("");
    setDecisionSubject(null);
    setReturnModalOpen(false);
    setCompleteModalOpen(false);
  };

  const openDecisionModal = (
    subject: TransferSubject,
    status: DecisionStatus,
  ) => {
    if (status === "Credited" && !subject.proposed_ptc_equivalency) {
      setActionNotice({
        type: "error",
        message:
          "A previous-school subject cannot be credited until the Registrar has proposed a valid PTC subject equivalency.",
      });
      return;
    }

    setDecisionSubject(subject);
    setDecisionStatus(status);
    setDecisionReason(subject.decision.decision_reason || "");
    setDecisionError("");
  };

  const closeDecisionModal = () => {
    if (busyAction === "decision") {
      return;
    }

    setDecisionSubject(null);
    setDecisionReason("");
    setDecisionError("");
  };

  const saveDecision = async () => {
    if (!decisionSubject || !selectedEvaluationId) {
      return;
    }

    const reason = decisionReason.trim();

    if (decisionStatus === "Not Credited" && !reason) {
      setDecisionError(
        "A decision reason is required when marking a subject Not Credited.",
      );
      return;
    }

    if (reason.length > 500) {
      setDecisionError(
        "Decision reason cannot exceed 500 characters.",
      );
      return;
    }

    try {
      setBusyAction("decision");
      setDecisionError("");
      setActionNotice(null);

      const response = await authService.authFetch(
        `${API_BASE_URL}/${selectedEvaluationId}/subjects/${decisionSubject.transfer_subject_id}/decision`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            credit_status: decisionStatus,
            decision_reason: reason || null,
          }),
        },
      );

      const data =
        await readJsonResponse<MutationResponse>(response);

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
            data.error ||
            "Unable to record transfer-credit decision.",
        );
      }

      setDecisionSubject(null);
      setDecisionReason("");

      setActionNotice({
        type: "success",
        message:
          data.message ||
          `${decisionSubject.source.subject_name} was marked ${decisionStatus}.`,
      });

      await loadEvaluationDetail(selectedEvaluationId, false);
      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      console.error(
        "PROGRAM HEAD TRANSFER SUBJECT DECISION ERROR:",
        requestError,
      );

      setDecisionError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to save the academic decision.",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const openReturnModal = () => {
    setReturnReason("");
    setReturnError("");
    setReturnModalOpen(true);
  };

  const closeReturnModal = () => {
    if (busyAction === "return") {
      return;
    }

    setReturnModalOpen(false);
    setReturnReason("");
    setReturnError("");
  };

  const returnEvaluation = async () => {
    if (!selectedEvaluationId) {
      return;
    }

    const reason = returnReason.trim();

    if (!reason) {
      setReturnError("A return reason is required.");
      return;
    }

    if (reason.length > 500) {
      setReturnError("Return reason cannot exceed 500 characters.");
      return;
    }

    try {
      setBusyAction("return");
      setReturnError("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${selectedEvaluationId}/return`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            review_remarks: reason,
          }),
        },
      );

      const data =
        await readJsonResponse<MutationResponse>(response);

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
            data.error ||
            "Unable to return transfer evaluation.",
        );
      }

      setReturnModalOpen(false);
      setSelectedEvaluationId(null);
      setDetail(null);
      setActionNotice({
        type: "success",
        message:
          data.message ||
          "Transfer evaluation returned to the Registrar.",
      });
      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      console.error(
        "PROGRAM HEAD RETURN TRANSFER EVALUATION ERROR:",
        requestError,
      );

      setReturnError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to return transfer evaluation.",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const openCompleteModal = () => {
    setCompletionRemarks("");
    setCompletionError("");
    setCompleteModalOpen(true);
  };

  const closeCompleteModal = () => {
    if (busyAction === "complete") {
      return;
    }

    setCompleteModalOpen(false);
    setCompletionRemarks("");
    setCompletionError("");
  };

  const completeEvaluation = async () => {
    if (!selectedEvaluationId || !detail?.review_readiness) {
      return;
    }

    if (!detail.review_readiness.can_complete_evaluation) {
      setCompletionError(
        detail.review_readiness.note ||
          "All transfer subjects must have a final academic decision before completion.",
      );
      return;
    }

    const remarks = completionRemarks.trim();

    if (remarks.length > 500) {
      setCompletionError(
        "Review remarks cannot exceed 500 characters.",
      );
      return;
    }

    try {
      setBusyAction("complete");
      setCompletionError("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${selectedEvaluationId}/complete`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            review_remarks: remarks || null,
          }),
        },
      );

      const data =
        await readJsonResponse<MutationResponse>(response);

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
            data.error ||
            "Unable to complete transfer evaluation.",
        );
      }

      setCompleteModalOpen(false);
      setSelectedEvaluationId(null);
      setDetail(null);
      setActionNotice({
        type: "success",
        message:
          data.message ||
          "Transfer evaluation completed successfully.",
      });
      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      console.error(
        "PROGRAM HEAD COMPLETE TRANSFER EVALUATION ERROR:",
        requestError,
      );

      setCompletionError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to complete transfer evaluation.",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const detailSummary = detail?.summary;
  const reviewReadiness = detail?.review_readiness;
  const detailEvaluation = detail?.evaluation;
  const subjects = detail?.subjects || [];

  if (
    !authenticated ||
    !session ||
    userRole !== "Program Head"
  ) {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="program-head-transfer-review">
        <section className="program-head-transfer-review__hero">
          <div className="program-head-transfer-review__hero-copy">
            <div className="program-head-transfer-review__eyebrow">
              <span>
                <FileCheck2 size={16} strokeWidth={2.2} />
              </span>
              Program Head · Transfer Credit
            </div>

            <h1>Transfer Evaluation Review</h1>

            <p>
              Review Registrar-submitted transferee evaluations,
              verify proposed PTC equivalencies, and record the
              academic credit decision for each previous-school subject.
            </p>

            {programHead && (
              <div className="program-head-transfer-review__context">
                <span>
                  <Building2 size={14} />
                  {programHead.department.department_name}
                </span>

                <i />

                <span>
                  <UserRound size={14} />
                  {programHead.program_head_name}
                </span>
              </div>
            )}
          </div>

          <div className="program-head-transfer-review__hero-actions">
            <button
              type="button"
              className="program-head-transfer-review__back"
              onClick={() => navigate("/programhead/dashboard")}
            >
              <ArrowLeft size={15} />
              Dashboard
            </button>

            <button
              type="button"
              className="program-head-transfer-review__refresh"
              onClick={refreshQueue}
              disabled={loading || refreshing || busyAction !== null}
            >
              <RefreshCw
                size={15}
                className={
                  refreshing
                    ? "program-head-transfer-review__spin"
                    : ""
                }
              />
              {refreshing ? "Refreshing..." : "Refresh Queue"}
            </button>
          </div>
        </section>

        {actionNotice && (
          <section
            className={`program-head-transfer-review__notice ${actionNotice.type}`}
            role="status"
          >
            <span>
              {actionNotice.type === "success" ? (
                <CheckCircle2 size={19} />
              ) : (
                <AlertCircle size={19} />
              )}
            </span>

            <div>
              <strong>
                {actionNotice.type === "success"
                  ? "Transfer review updated"
                  : "Transfer review needs attention"}
              </strong>
              <p>{actionNotice.message}</p>
            </div>
          </section>
        )}

        <section
          className="program-head-transfer-review__summary"
          aria-label="Transfer evaluation summary"
        >
          <article className="program-head-transfer-review__stat program-head-transfer-review__stat--primary">
            <span>
              <FileCheck2 size={19} />
            </span>

            <div>
              <small>Submitted Evaluations</small>
              <strong>
                {loading
                  ? "…"
                  : queueSummary?.total_submitted ??
                    evaluations.length}
              </strong>
              <p>Waiting for Program Head review</p>
            </div>
          </article>

          <article className="program-head-transfer-review__stat">
            <span>
              <BookOpenCheck size={19} />
            </span>

            <div>
              <small>Transfer Subjects</small>
              <strong>
                {loading ? "…" : queueSummary?.total_subjects ?? 0}
              </strong>
              <p>Previous-school subjects submitted</p>
            </div>
          </article>

          <article className="program-head-transfer-review__stat">
            <span className="is-warning">
              <Clock3 size={19} />
            </span>

            <div>
              <small>Pending Decisions</small>
              <strong>
                {loading ? "…" : queueSummary?.pending_subjects ?? 0}
              </strong>
              <p>Still require academic decisions</p>
            </div>
          </article>

          <article className="program-head-transfer-review__stat">
            <span className="is-neutral">
              <CircleDot size={19} />
            </span>

            <div>
              <small>Unmapped Subjects</small>
              <strong>
                {loading ? "…" : queueSummary?.unmapped_subjects ?? 0}
              </strong>
              <p>No proposed PTC equivalency yet</p>
            </div>
          </article>
        </section>

        <section className="program-head-transfer-review__filters">
          <header>
            <div>
              <span>
                <Filter size={16} />
              </span>

              <div>
                <strong>Review Queue Filters</strong>
                <p>
                  Search transferees and narrow the queue by
                  course, entry semester, or review readiness.
                </p>
              </div>
            </div>

            {hasActiveFilters && (
              <button type="button" onClick={clearFilters}>
                <RotateCcw size={14} />
                Clear Filters
              </button>
            )}
          </header>

          <div className="program-head-transfer-review__filter-grid">
            <label className="program-head-transfer-review__search">
              <span>Search</span>

              <div>
                <Search size={15} />

                <input
                  type="search"
                  value={search}
                  onChange={(event) =>
                    setSearch(event.target.value)
                  }
                  placeholder="Student, school, curriculum, transcript..."
                />
              </div>
            </label>

            <label>
              <span>PTC Course</span>
              <select
                value={courseFilter}
                onChange={(event) =>
                  setCourseFilter(event.target.value)
                }
              >
                <option value="All">All Courses</option>

                {courses.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Entry Semester</span>
              <select
                value={semesterFilter}
                onChange={(event) =>
                  setSemesterFilter(event.target.value)
                }
              >
                <option value="All">All Semesters</option>

                {semesters.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Review State</span>
              <select
                value={reviewFilter}
                onChange={(event) =>
                  setReviewFilter(
                    event.target.value as ReviewFilter,
                  )
                }
              >
                <option value="All">All Submitted</option>
                <option value="Pending">Has Pending Decisions</option>
                <option value="Ready">Ready to Complete</option>
                <option value="Unmapped">Has Unmapped Subjects</option>
              </select>
            </label>
          </div>
        </section>

        {queueError && !loading && (
          <section
            className="program-head-transfer-review__error"
            role="alert"
          >
            <span>
              <AlertCircle size={20} />
            </span>

            <div>
              <strong>
                Transfer evaluation queue could not be loaded
              </strong>
              <p>{queueError}</p>
            </div>

            <button type="button" onClick={refreshQueue}>
              Try Again
            </button>
          </section>
        )}

        {loading && (
          <section className="program-head-transfer-review__panel">
            <header className="program-head-transfer-review__panel-header">
              <div>
                <span>Academic Review Queue</span>
                <h2>Submitted Transfer Evaluations</h2>
                <p>
                  Retrieving evaluations assigned to your department.
                </p>
              </div>
            </header>

            <div className="program-head-transfer-review__skeletons">
              {[1, 2, 3].map((item) => (
                <div key={item}>
                  <i />
                  <span>
                    <i />
                    <i />
                  </span>
                  <span>
                    <i />
                    <i />
                  </span>
                  <i />
                </div>
              ))}
            </div>
          </section>
        )}

        {!loading &&
          !queueError &&
          filteredEvaluations.length === 0 && (
            <section className="program-head-transfer-review__empty">
              <span>
                <CheckCircle2 size={24} />
              </span>

              <strong>
                {evaluations.length === 0
                  ? "No submitted transfer evaluations"
                  : "No evaluations match the current filters"}
              </strong>

              <p>
                {evaluations.length === 0
                  ? "There are currently no transferee evaluations waiting for Program Head academic review in your department."
                  : "Adjust or clear the current filters to view other submitted transfer evaluations."}
              </p>

              {hasActiveFilters && (
                <button type="button" onClick={clearFilters}>
                  <RotateCcw size={14} />
                  Clear Filters
                </button>
              )}
            </section>
          )}

        {!loading &&
          !queueError &&
          filteredEvaluations.length > 0 && (
            <section className="program-head-transfer-review__panel">
              <header className="program-head-transfer-review__panel-header">
                <div>
                  <span>Academic Review Queue</span>
                  <h2>Submitted Transfer Evaluations</h2>
                  <p>
                    Review Registrar-submitted evaluations and
                    record academic decisions for each subject.
                  </p>
                </div>

                <strong>
                  {filteredEvaluations.length}{" "}
                  {filteredEvaluations.length === 1
                    ? "evaluation"
                    : "evaluations"}
                </strong>
              </header>

              <div className="program-head-transfer-review__table-wrap">
                <table className="program-head-transfer-review__table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Previous School</th>
                      <th>PTC Curriculum</th>
                      <th>PTC Entry</th>
                      <th>Subject Review</th>
                      <th>Submitted</th>
                      <th>Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredEvaluations.map((item) => {
                      const progress = getReviewProgress(item);

                      return (
                        <tr key={item.transfer_evaluation_id}>
                          <td>
                            <div className="program-head-transfer-review__student">
                              <span>
                                <GraduationCap size={16} />
                              </span>

                              <div>
                                <strong>
                                  {item.student.student_name}
                                </strong>
                                <small>
                                  {item.student.student_number}
                                </small>
                                <em>
                                  {formatYearLevel(
                                    item.student.current_year_level,
                                  )}
                                </em>
                              </div>
                            </div>
                          </td>

                          <td>
                            <div className="program-head-transfer-review__school">
                              <strong>{item.source.school}</strong>
                              <span>
                                {item.source.course ||
                                  "Source course not recorded"}
                              </span>
                              <small>
                                {item.source.transcript_reference
                                  ? `TOR: ${item.source.transcript_reference}`
                                  : "No transcript reference"}
                              </small>
                            </div>
                          </td>

                          <td>
                            <div className="program-head-transfer-review__curriculum">
                              <strong>
                                {item.curriculum.course.course_code}
                              </strong>
                              <span>
                                {item.curriculum.curriculum_name}
                              </span>
                              <small>
                                {item.curriculum.effective_year
                                  ? `Effective ${item.curriculum.effective_year}`
                                  : item.curriculum.course.course_name}
                              </small>
                            </div>
                          </td>

                          <td>
                            <div className="program-head-transfer-review__entry">
                              <strong>
                                {formatYearLevel(
                                  item.ptc_entry.year_level,
                                )}
                              </strong>
                              <small>
                                {item.ptc_entry.semester_name ||
                                  "Semester not recorded"}
                              </small>
                            </div>
                          </td>

                          <td>
                            <div className="program-head-transfer-review__progress-block">
                              <div>
                                <strong>{progress}% reviewed</strong>
                                <span>
                                  {item.summary.pending_subjects} pending
                                </span>
                              </div>

                              <div className="program-head-transfer-review__progress">
                                <span
                                  style={{
                                    width: `${progress}%`,
                                  }}
                                />
                              </div>

                              <small>
                                {item.summary.mapped_subjects} mapped ·{" "}
                                {item.summary.unmapped_subjects} unmapped
                              </small>
                            </div>
                          </td>

                          <td>
                            <div className="program-head-transfer-review__submitted">
                              <CalendarDays size={13} />
                              <span>
                                {formatDateTime(
                                  item.workflow.submitted_at,
                                )}
                              </span>
                              <small>
                                by{" "}
                                {item.workflow
                                  .submitted_by_username ||
                                  "Registrar"}
                              </small>
                            </div>
                          </td>

                          <td>
                            <button
                              type="button"
                              className="program-head-transfer-review__review-btn"
                              onClick={() =>
                                void openReview(
                                  item.transfer_evaluation_id,
                                )
                              }
                            >
                              Review
                              <ChevronRight size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

        <section className="program-head-transfer-review__academic-note">
          <ShieldCheck size={18} />
          <div>
            <strong>Academic effect is controlled by completion</strong>
            <p>
              A subject-level Credited decision is not official by itself.
              Transfer credit satisfies a PTC curriculum requirement only
              after the whole evaluation is marked Completed. This workflow
              does not create or change normal PTC grades.
            </p>
          </div>
        </section>

        {selectedEvaluationId !== null && (
          <div
            className="program-head-transfer-detail__backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeReview();
              }
            }}
          >
            <section
              className="program-head-transfer-detail"
              role="dialog"
              aria-modal="true"
              aria-labelledby="program-head-transfer-detail-title"
            >
              <header className="program-head-transfer-detail__header">
                <div>
                  <span className="program-head-transfer-detail__icon">
                    <FileCheck2 size={19} />
                  </span>

                  <div>
                    <small>Program Head Academic Review</small>
                    <h2 id="program-head-transfer-detail-title">
                      Transfer Evaluation Review
                    </h2>

                    <p>
                      {detailEvaluation
                        ? `${detailEvaluation.student.student_number} · ${detailEvaluation.student.student_name}`
                        : `Evaluation #${selectedEvaluationId}`}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeReview}
                  disabled={busyAction !== null}
                  aria-label="Close transfer evaluation review"
                >
                  <X size={18} />
                </button>
              </header>

              {detailLoading && (
                <div className="program-head-transfer-detail__loading">
                  <RefreshCw
                    size={24}
                    className="program-head-transfer-review__spin"
                  />
                  <strong>Loading review details</strong>
                  <p>
                    Retrieving transcript subjects and proposed
                    PTC equivalencies.
                  </p>
                </div>
              )}

              {!detailLoading && detailError && (
                <div className="program-head-transfer-detail__error">
                  <AlertCircle size={23} />
                  <strong>Review details could not be loaded</strong>
                  <p>{detailError}</p>

                  <button
                    type="button"
                    onClick={() =>
                      void loadEvaluationDetail(
                        selectedEvaluationId,
                      )
                    }
                  >
                    Try Again
                  </button>
                </div>
              )}

              {!detailLoading &&
                !detailError &&
                detailEvaluation && (
                  <>
                    <div className="program-head-transfer-detail__body">
                      <section className="program-head-transfer-detail__info-grid">
                        <article>
                          <span>
                            <GraduationCap size={18} />
                          </span>

                          <div>
                            <small>Student</small>
                            <strong>
                              {detailEvaluation.student.student_name}
                            </strong>
                            <p>
                              {detailEvaluation.student.student_number} ·{" "}
                              {formatYearLevel(
                                detailEvaluation.student.current_year_level,
                              )}
                            </p>
                          </div>
                        </article>

                        <article>
                          <span>
                            <School size={18} />
                          </span>

                          <div>
                            <small>Previous School</small>
                            <strong>
                              {detailEvaluation.source.school}
                            </strong>
                            <p>
                              {detailEvaluation.source.course ||
                                "Source course not recorded"}
                            </p>
                          </div>
                        </article>

                        <article>
                          <span>
                            <BookCheck size={18} />
                          </span>

                          <div>
                            <small>PTC Curriculum</small>
                            <strong>
                              {
                                detailEvaluation.curriculum.course
                                  .course_code
                              }{" "}
                              ·{" "}
                              {detailEvaluation.curriculum.curriculum_name}
                            </strong>
                            <p>
                              {detailEvaluation.curriculum.effective_year
                                ? `Effective ${detailEvaluation.curriculum.effective_year}`
                                : detailEvaluation.curriculum.course
                                    .course_name}
                            </p>
                          </div>
                        </article>

                        <article>
                          <span>
                            <FileText size={18} />
                          </span>

                          <div>
                            <small>Transcript</small>
                            <strong>
                              {detailEvaluation.source.transcript_reference ||
                                "No reference"}
                            </strong>
                            <p>
                              {detailEvaluation.source.transcript_document
                                ? `${
                                    detailEvaluation.source
                                      .transcript_document
                                      .verification_status || "Unverified"
                                  } · ${
                                    detailEvaluation.source
                                      .transcript_document.file_name ||
                                    "Document on file"
                                  }`
                                : "No transcript document linked"}
                            </p>
                          </div>
                        </article>
                      </section>

                      <section className="program-head-transfer-detail__review-status">
                        <div>
                          <span>
                            <ShieldCheck size={17} />
                          </span>

                          <div>
                            <strong>
                              {reviewReadiness?.all_subjects_decided
                                ? "All subject decisions recorded"
                                : "Academic review in progress"}
                            </strong>
                            <p>
                              {reviewReadiness?.note ||
                                "Review each previous-school subject before completing the evaluation."}
                            </p>
                          </div>
                        </div>

                        <div className="program-head-transfer-detail__review-counts">
                          <span>
                            <small>Total</small>
                            <strong>
                              {detailSummary?.total_subjects ?? 0}
                            </strong>
                          </span>

                          <span>
                            <small>Pending</small>
                            <strong>
                              {detailSummary?.pending_subjects ?? 0}
                            </strong>
                          </span>

                          <span>
                            <small>Credited</small>
                            <strong>
                              {detailSummary?.credited_subjects ?? 0}
                            </strong>
                          </span>

                          <span>
                            <small>Not Credited</small>
                            <strong>
                              {detailSummary?.not_credited_subjects ?? 0}
                            </strong>
                          </span>
                        </div>
                      </section>

                      <section className="program-head-transfer-detail__context-grid">
                        <div>
                          <small>PTC Entry Point</small>
                          <strong>
                            {formatYearLevel(
                              detailEvaluation.ptc_entry.year_level,
                            )}
                          </strong>
                          <span>
                            {detailEvaluation.ptc_entry.semester_name ||
                              "Semester not recorded"}
                          </span>
                        </div>

                        <div>
                          <small>Submitted By</small>
                          <strong>
                            {detailEvaluation.workflow
                              .submitted_by_username || "Registrar"}
                          </strong>
                          <span>
                            {formatDateTime(
                              detailEvaluation.workflow.submitted_at,
                            )}
                          </span>
                        </div>

                        <div>
                          <small>Evaluation Status</small>
                          <strong>
                            {detailEvaluation.evaluation_status}
                          </strong>
                          <span>
                            Evaluation #
                            {detailEvaluation.transfer_evaluation_id}
                          </span>
                        </div>

                        <div>
                          <small>Source Student No.</small>
                          <strong>
                            {detailEvaluation.source.student_number ||
                              "Not recorded"}
                          </strong>
                          <span>
                            {detailEvaluation.remarks ||
                              "No evaluation remarks"}
                          </span>
                        </div>
                      </section>

                      <section className="program-head-transfer-detail__subjects">
                        <header>
                          <div>
                            <span>Transcript Subject Review</span>
                            <h3>Academic Credit Decisions</h3>
                            <p>
                              Compare each previous-school subject
                              with the Registrar-proposed PTC
                              equivalency before recording a decision.
                            </p>
                          </div>

                          <strong>
                            {subjects.length}{" "}
                            {subjects.length === 1
                              ? "subject"
                              : "subjects"}
                          </strong>
                        </header>

                        {subjects.length === 0 ? (
                          <div className="program-head-transfer-detail__subjects-empty">
                            <AlertCircle size={22} />
                            <strong>
                              No transfer subjects available
                            </strong>
                            <p>
                              This evaluation cannot be completed
                              until transcript subjects exist.
                            </p>
                          </div>
                        ) : (
                          <div className="program-head-transfer-detail__table-wrap">
                            <table className="program-head-transfer-detail__table">
                              <thead>
                                <tr>
                                  <th>Previous-School Subject</th>
                                  <th>Source Record</th>
                                  <th>Proposed PTC Equivalency</th>
                                  <th>PTC Placement</th>
                                  <th>Decision</th>
                                  <th>Reason / Review</th>
                                  <th>Action</th>
                                </tr>
                              </thead>

                              <tbody>
                                {subjects.map((subject) => {
                                  const mapping =
                                    subject.proposed_ptc_equivalency;

                                  return (
                                    <tr
                                      key={subject.transfer_subject_id}
                                    >
                                      <td>
                                        <div className="program-head-transfer-detail__source-subject">
                                          <strong>
                                            {subject.source.subject_code ||
                                              "No code"}
                                          </strong>
                                          <span>
                                            {subject.source.subject_name}
                                          </span>
                                          <small>
                                            {formatUnits(
                                              subject.source.units,
                                            )}
                                          </small>
                                        </div>
                                      </td>

                                      <td>
                                        <div className="program-head-transfer-detail__source-record">
                                          <strong>
                                            Grade:{" "}
                                            {subject.source.grade || "—"}
                                          </strong>
                                          <span>
                                            {subject.source
                                              .academic_year ||
                                              "Academic year not recorded"}
                                          </span>
                                          <small>
                                            {subject.source.semester ||
                                              "Semester not recorded"}{" "}
                                            ·{" "}
                                            {formatYearLevel(
                                              subject.source.year_level,
                                            )}
                                          </small>
                                        </div>
                                      </td>

                                      <td>
                                        {mapping ? (
                                          <div className="program-head-transfer-detail__mapping">
                                            <span>
                                              <CheckCircle2 size={13} />
                                              Mapped
                                            </span>
                                            <strong>
                                              {mapping.subject_code}
                                            </strong>
                                            <small>
                                              {mapping.subject_name} ·{" "}
                                              {formatUnits(mapping.units)}
                                            </small>
                                          </div>
                                        ) : (
                                          <div className="program-head-transfer-detail__unmapped">
                                            <AlertCircle size={14} />
                                            <strong>
                                              No PTC mapping
                                            </strong>
                                            <small>
                                              Cannot be marked Credited
                                            </small>
                                          </div>
                                        )}
                                      </td>

                                      <td>
                                        {mapping ? (
                                          <div className="program-head-transfer-detail__placement">
                                            <strong>
                                              {formatYearLevel(
                                                mapping.curriculum
                                                  .year_level,
                                              )}
                                            </strong>
                                            <span>
                                              {mapping.curriculum
                                                .semester_name ||
                                                "Semester not recorded"}
                                            </span>
                                            <small>
                                              {mapping.curriculum.is_required
                                                ? "Required subject"
                                                : "Elective subject"}
                                            </small>
                                          </div>
                                        ) : (
                                          "—"
                                        )}
                                      </td>

                                      <td>
                                        <span
                                          className={`program-head-transfer-detail__decision ${getStatusClass(
                                            subject.decision.credit_status,
                                          )}`}
                                        >
                                          {subject.decision.credit_status ===
                                          "Credited" ? (
                                            <Check size={12} />
                                          ) : subject.decision
                                              .credit_status ===
                                            "Not Credited" ? (
                                            <XCircle size={12} />
                                          ) : (
                                            <Clock3 size={12} />
                                          )}

                                          {subject.decision.credit_status}
                                        </span>

                                        {subject.decision.credited_units !==
                                          null && (
                                          <small className="program-head-transfer-detail__credited-units">
                                            {formatUnits(
                                              subject.decision
                                                .credited_units,
                                            )}{" "}
                                            credited
                                          </small>
                                        )}
                                      </td>

                                      <td>
                                        <div className="program-head-transfer-detail__reason">
                                          <span>
                                            {subject.decision
                                              .decision_reason ||
                                              "No decision reason"}
                                          </span>

                                          <small>
                                            {subject.decision.reviewed_at
                                              ? `Reviewed ${formatDateTime(
                                                  subject.decision
                                                    .reviewed_at,
                                                )}`
                                              : "Not yet reviewed"}
                                          </small>
                                        </div>
                                      </td>

                                      <td>
                                        <div className="program-head-transfer-detail__actions">
                                          <button
                                            type="button"
                                            className="credit"
                                            onClick={() =>
                                              openDecisionModal(
                                                subject,
                                                "Credited",
                                              )
                                            }
                                            disabled={
                                              !reviewReadiness?.can_make_subject_decisions ||
                                              !mapping ||
                                              busyAction !== null
                                            }
                                            title={
                                              mapping
                                                ? "Mark this subject Credited"
                                                : "A PTC equivalency is required before crediting"
                                            }
                                          >
                                            <Check size={13} />
                                            Credited
                                          </button>

                                          <button
                                            type="button"
                                            className="not-credit"
                                            onClick={() =>
                                              openDecisionModal(
                                                subject,
                                                "Not Credited",
                                              )
                                            }
                                            disabled={
                                              !reviewReadiness?.can_make_subject_decisions ||
                                              busyAction !== null
                                            }
                                          >
                                            <X size={13} />
                                            Not Credited
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </section>

                      <section className="program-head-transfer-detail__effect-note">
                        <ShieldCheck size={17} />
                        <div>
                          <strong>
                            Subject decisions are provisional until
                            completion
                          </strong>
                          <p>
                            {detail.academic_effect?.reason ||
                              "Viewing and reviewing a submitted evaluation does not yet create official transfer credit."}
                          </p>
                        </div>
                      </section>
                    </div>

                    <footer className="program-head-transfer-detail__footer">
                      <div>
                        <strong>
                          {reviewReadiness?.can_complete_evaluation
                            ? "Ready to complete"
                            : "Review not complete"}
                        </strong>
                        <span>
                          {reviewReadiness?.note ||
                            "Every subject requires an academic decision."}
                        </span>
                      </div>

                      <div>
                        <button
                          type="button"
                          className="program-head-transfer-detail__return"
                          onClick={openReturnModal}
                          disabled={busyAction !== null}
                        >
                          <Undo2 size={14} />
                          Return to Registrar
                        </button>

                        <button
                          type="button"
                          className="program-head-transfer-detail__complete"
                          onClick={openCompleteModal}
                          disabled={
                            !reviewReadiness?.can_complete_evaluation ||
                            busyAction !== null
                          }
                        >
                          <CheckCircle2 size={14} />
                          Complete Evaluation
                        </button>
                      </div>
                    </footer>
                  </>
                )}
            </section>
          </div>
        )}

        {decisionSubject && selectedEvaluationId && (
          <div className="program-head-transfer-action-modal__backdrop">
            <section
              className="program-head-transfer-action-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="transfer-decision-title"
            >
              <header>
                <div>
                  <span
                    className={
                      decisionStatus === "Credited"
                        ? "credit"
                        : "not-credit"
                    }
                  >
                    {decisionStatus === "Credited" ? (
                      <Check size={18} />
                    ) : (
                      <X size={18} />
                    )}
                  </span>

                  <div>
                    <small>Academic Decision</small>
                    <h3 id="transfer-decision-title">
                      Mark Subject {decisionStatus}
                    </h3>
                    <p>
                      {decisionSubject.source.subject_code ||
                        "Previous-school subject"}{" "}
                      · {decisionSubject.source.subject_name}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeDecisionModal}
                  disabled={busyAction === "decision"}
                  aria-label="Close decision modal"
                >
                  <X size={17} />
                </button>
              </header>

              <div className="program-head-transfer-action-modal__body">
                <div className="program-head-transfer-action-modal__comparison">
                  <div>
                    <small>Previous School</small>
                    <strong>
                      {decisionSubject.source.subject_code ||
                        "No code"}
                    </strong>
                    <span>
                      {decisionSubject.source.subject_name}
                    </span>
                    <em>
                      {formatUnits(decisionSubject.source.units)}
                    </em>
                  </div>

                  <ChevronRight size={18} />

                  <div>
                    <small>Proposed PTC Equivalent</small>
                    <strong>
                      {decisionSubject.proposed_ptc_equivalency
                        ?.subject_code || "No mapping"}
                    </strong>
                    <span>
                      {decisionSubject.proposed_ptc_equivalency
                        ?.subject_name ||
                        "No PTC equivalency proposed"}
                    </span>
                    <em>
                      {formatUnits(
                        decisionSubject.proposed_ptc_equivalency
                          ?.units,
                      )}
                    </em>
                  </div>
                </div>

                <label>
                  <span>
                    Decision Reason{" "}
                    {decisionStatus === "Not Credited" && (
                      <strong>Required</strong>
                    )}
                  </span>

                  <textarea
                    value={decisionReason}
                    onChange={(event) => {
                      const value = event.target.value;

                      if (value.length <= 500) {
                        setDecisionReason(value);
                        setDecisionError("");
                      }
                    }}
                    maxLength={500}
                    rows={5}
                    disabled={busyAction === "decision"}
                    placeholder={
                      decisionStatus === "Credited"
                        ? "Optional: Explain why the subjects are academically equivalent."
                        : "Explain why this previous-school subject does not satisfy the proposed PTC requirement."
                    }
                    autoFocus
                  />

                  <small>
                    {decisionReason.length}/500 characters
                  </small>
                </label>

                {decisionStatus === "Credited" && (
                  <div className="program-head-transfer-action-modal__info">
                    <ShieldCheck size={15} />
                    <p>
                      Credited units are determined by the backend
                      from the official PTC subject units. They are
                      not entered manually here.
                    </p>
                  </div>
                )}

                {decisionError && (
                  <div className="program-head-transfer-action-modal__error">
                    <AlertCircle size={14} />
                    {decisionError}
                  </div>
                )}
              </div>

              <footer>
                <button
                  type="button"
                  className="secondary"
                  onClick={closeDecisionModal}
                  disabled={busyAction === "decision"}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className={
                    decisionStatus === "Credited"
                      ? "primary"
                      : "danger"
                  }
                  onClick={() => void saveDecision()}
                  disabled={busyAction === "decision"}
                >
                  {decisionStatus === "Credited" ? (
                    <Check size={14} />
                  ) : (
                    <X size={14} />
                  )}

                  {busyAction === "decision"
                    ? "Saving..."
                    : `Mark ${decisionStatus}`}
                </button>
              </footer>
            </section>
          </div>
        )}

        {returnModalOpen && detailEvaluation && (
          <div className="program-head-transfer-action-modal__backdrop">
            <section
              className="program-head-transfer-action-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="transfer-return-title"
            >
              <header>
                <div>
                  <span className="return">
                    <Undo2 size={18} />
                  </span>

                  <div>
                    <small>Correction Required</small>
                    <h3 id="transfer-return-title">
                      Return Evaluation to Registrar
                    </h3>
                    <p>
                      {detailEvaluation.student.student_number} ·{" "}
                      {detailEvaluation.student.student_name}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeReturnModal}
                  disabled={busyAction === "return"}
                  aria-label="Close return modal"
                >
                  <X size={17} />
                </button>
              </header>

              <div className="program-head-transfer-action-modal__body">
                <div className="program-head-transfer-action-modal__warning">
                  <AlertCircle size={16} />
                  <p>
                    Returning the evaluation preserves the raw
                    transcript and proposed PTC mappings, but resets
                    all subject credit decisions to Pending so the
                    Registrar can correct and resubmit the evaluation.
                  </p>
                </div>

                <label>
                  <span>
                    Return Reason <strong>Required</strong>
                  </span>

                  <textarea
                    value={returnReason}
                    onChange={(event) => {
                      const value = event.target.value;

                      if (value.length <= 500) {
                        setReturnReason(value);
                        setReturnError("");
                      }
                    }}
                    maxLength={500}
                    rows={5}
                    disabled={busyAction === "return"}
                    placeholder="Example: Please verify the transcript information and proposed PTC equivalency."
                    autoFocus
                  />

                  <small>
                    {returnReason.length}/500 characters
                  </small>
                </label>

                {returnError && (
                  <div className="program-head-transfer-action-modal__error">
                    <AlertCircle size={14} />
                    {returnError}
                  </div>
                )}
              </div>

              <footer>
                <button
                  type="button"
                  className="secondary"
                  onClick={closeReturnModal}
                  disabled={busyAction === "return"}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="return"
                  onClick={() => void returnEvaluation()}
                  disabled={
                    busyAction === "return" ||
                    !returnReason.trim()
                  }
                >
                  <Undo2 size={14} />
                  {busyAction === "return"
                    ? "Returning..."
                    : "Return to Registrar"}
                </button>
              </footer>
            </section>
          </div>
        )}

        {completeModalOpen && detailEvaluation && (
          <div className="program-head-transfer-action-modal__backdrop">
            <section
              className="program-head-transfer-action-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="transfer-complete-title"
            >
              <header>
                <div>
                  <span className="credit">
                    <CheckCircle2 size={18} />
                  </span>

                  <div>
                    <small>Final Academic Decision</small>
                    <h3 id="transfer-complete-title">
                      Complete Transfer Evaluation
                    </h3>
                    <p>
                      {detailEvaluation.student.student_number} ·{" "}
                      {detailEvaluation.student.student_name}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={closeCompleteModal}
                  disabled={busyAction === "complete"}
                  aria-label="Close completion modal"
                >
                  <X size={17} />
                </button>
              </header>

              <div className="program-head-transfer-action-modal__body">
                <div className="program-head-transfer-action-modal__success">
                  <CheckCircle2 size={16} />
                  <p>
                    Completion finalizes this academic review.
                    Subjects marked Credited become official transfer
                    credits that satisfy their mapped PTC curriculum
                    requirements. This does not create normal PTC grades.
                  </p>
                </div>

                <div className="program-head-transfer-action-modal__completion-summary">
                  <div>
                    <small>Credited</small>
                    <strong>
                      {detailSummary?.credited_subjects ?? 0}
                    </strong>
                  </div>

                  <div>
                    <small>Not Credited</small>
                    <strong>
                      {detailSummary?.not_credited_subjects ?? 0}
                    </strong>
                  </div>

                  <div>
                    <small>Pending</small>
                    <strong>
                      {detailSummary?.pending_subjects ?? 0}
                    </strong>
                  </div>
                </div>

                <label>
                  <span>Completion Remarks</span>

                  <textarea
                    value={completionRemarks}
                    onChange={(event) => {
                      const value = event.target.value;

                      if (value.length <= 500) {
                        setCompletionRemarks(value);
                        setCompletionError("");
                      }
                    }}
                    maxLength={500}
                    rows={4}
                    disabled={busyAction === "complete"}
                    placeholder="Optional: Add a final Program Head review note."
                  />

                  <small>
                    {completionRemarks.length}/500 characters ·
                    optional
                  </small>
                </label>

                {completionError && (
                  <div className="program-head-transfer-action-modal__error">
                    <AlertCircle size={14} />
                    {completionError}
                  </div>
                )}
              </div>

              <footer>
                <button
                  type="button"
                  className="secondary"
                  onClick={closeCompleteModal}
                  disabled={busyAction === "complete"}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="primary"
                  onClick={() => void completeEvaluation()}
                  disabled={
                    busyAction === "complete" ||
                    !reviewReadiness?.can_complete_evaluation
                  }
                >
                  <CheckCircle2 size={14} />
                  {busyAction === "complete"
                    ? "Completing..."
                    : "Complete Evaluation"}
                </button>
              </footer>
            </section>
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}
