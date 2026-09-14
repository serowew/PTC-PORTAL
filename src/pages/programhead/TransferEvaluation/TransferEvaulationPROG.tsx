import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/TransferEvaluationPROG.css";

const API_BASE_URL =
  "http://localhost:3000/api/program-head/transfer-evaluations";

type MappingFilter = "All" | "Fully Mapped" | "Has Unmapped";
type DecisionStatus = "" | "Credited" | "Not Credited";

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

interface SubmittedEvaluation {
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

    transcript_document: {
      document_id: number;
      document_type: string | null;
      file_name: string | null;
      verification_status: string | null;
    } | null;
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

interface SubmittedEvaluationsResponse {
  success: boolean;
  code?: string;
  message?: string;
  error?: string;
  program_head?: ProgramHeadInfo;
  evaluations?: SubmittedEvaluation[];
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
    subject_code: string | null;
    subject_name: string | null;
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
    credit_status: string;
    credited_units: number | null;
    decision_reason: string | null;
    reviewed_by: number | null;
    reviewed_by_username: string | null;
    reviewed_at: string | null;
  };

  created_at: string | null;
  updated_at: string | null;
}

interface EvaluationDetail {
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

interface EvaluationDetailResponse {
  success: boolean;
  code?: string;
  message?: string;
  error?: string;

  program_head?: ProgramHeadInfo;
  evaluation?: EvaluationDetail;

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
}

interface MutationResponse {
  success: boolean;
  code?: string;
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
        200,
      )}`,
    );
  }

  return response.json() as Promise<T>;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";

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

function displayValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "—";
  }

  return String(value);
}

function getStatusClass(value: string | null | undefined): string {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "unknown"
  );
}

export default function TransferEvaluationPROG() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();

  const authenticated = Boolean(session && token);
  const userRole = session?.role;

  const [programHead, setProgramHead] = useState<ProgramHeadInfo | null>(null);

  const [evaluations, setEvaluations] = useState<SubmittedEvaluation[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("All");
  const [mappingFilter, setMappingFilter] = useState<MappingFilter>("All");

  const [selectedEvaluationId, setSelectedEvaluationId] = useState<
    number | null
  >(null);

  const [selectedEvaluation, setSelectedEvaluation] =
    useState<EvaluationDetail | null>(null);

  const [subjects, setSubjects] = useState<TransferSubject[]>([]);

  const [detailSummary, setDetailSummary] = useState({
    total_subjects: 0,
    mapped_subjects: 0,
    unmapped_subjects: 0,
    pending_subjects: 0,
    credited_subjects: 0,
    not_credited_subjects: 0,
    official_transfer_credits: 0,
  });

  const [reviewReadiness, setReviewReadiness] = useState({
    evaluation_status: "",
    can_review: false,
    can_make_subject_decisions: false,
    all_subjects_decided: false,
    can_complete_evaluation: false,
    note: "",
  });

  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [decisionSubject, setDecisionSubject] =
    useState<TransferSubject | null>(null);

  const [decisionStatus, setDecisionStatus] = useState<DecisionStatus>("");

  const [decisionReason, setDecisionReason] = useState("");
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [decisionError, setDecisionError] = useState("");

  const [decisionNotice, setDecisionNotice] = useState<ActionNotice | null>(
    null,
  );

  const [pageNotice, setPageNotice] = useState<ActionNotice | null>(null);

  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [returnLoading, setReturnLoading] = useState(false);
  const [returnError, setReturnError] = useState("");

  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completionRemarks, setCompletionRemarks] = useState("");
  const [completionLoading, setCompletionLoading] = useState(false);
  const [completionError, setCompletionError] = useState("");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    if (userRole !== "Program Head" && session) {
      navigate(authService.getDashboardRoute(session.role), {
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
        setLoading(true);
        setError("");

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
          await readJsonResponse<SubmittedEvaluationsResponse>(response);

        if (response.status === 401) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

          return;
        }

        if (response.status === 403) {
          throw new Error(
            data.message || "Program Head access or assignment is required.",
          );
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message ||
              data.error ||
              "Unable to load submitted transfer evaluations.",
          );
        }

        const loadedEvaluations = Array.isArray(data.evaluations)
          ? data.evaluations.filter(
              (evaluation) => evaluation.evaluation_status === "Submitted",
            )
          : [];

        setProgramHead(data.program_head || null);
        setEvaluations(loadedEvaluations);
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

        setProgramHead(null);
        setEvaluations([]);

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load submitted transfer evaluations.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadQueue();

    return () => {
      controller.abort();
    };
  }, [authenticated, userRole, navigate, refreshKey]);

  useEffect(() => {
    if (selectedEvaluationId === null) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (decisionSubject && !decisionLoading) {
        closeDecisionModal();
        return;
      }

      if (showReturnModal && !returnLoading) {
        closeReturnModal();
        return;
      }

      if (showCompleteModal && !completionLoading) {
        closeCompleteModal();
        return;
      }

      if (
        !detailLoading &&
        !decisionLoading &&
        !returnLoading &&
        !completionLoading
      ) {
        closeReview();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [
    selectedEvaluationId,
    detailLoading,
    decisionSubject,
    decisionLoading,
    showReturnModal,
    returnLoading,
    showCompleteModal,
    completionLoading,
  ]);

  const courses = useMemo(() => {
    return Array.from(
      new Map(
        evaluations.map((evaluation) => [
          evaluation.curriculum.course.course_id,
          evaluation.curriculum.course.course_code,
        ]),
      ).entries(),
    ).sort((a, b) => a[1].localeCompare(b[1]));
  }, [evaluations]);

  const filteredEvaluations = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return evaluations.filter((evaluation) => {
      const matchesSearch =
        !normalizedSearch ||
        evaluation.student.student_number
          .toLowerCase()
          .includes(normalizedSearch) ||
        evaluation.student.student_name
          .toLowerCase()
          .includes(normalizedSearch) ||
        evaluation.source.school.toLowerCase().includes(normalizedSearch) ||
        (evaluation.source.course || "")
          .toLowerCase()
          .includes(normalizedSearch) ||
        evaluation.curriculum.course.course_code
          .toLowerCase()
          .includes(normalizedSearch) ||
        evaluation.curriculum.curriculum_name
          .toLowerCase()
          .includes(normalizedSearch);

      const matchesCourse =
        courseFilter === "All" ||
        String(evaluation.curriculum.course.course_id) === courseFilter;

      const matchesMapping =
        mappingFilter === "All" ||
        (mappingFilter === "Fully Mapped" &&
          evaluation.summary.unmapped_subjects === 0) ||
        (mappingFilter === "Has Unmapped" &&
          evaluation.summary.unmapped_subjects > 0);

      return matchesSearch && matchesCourse && matchesMapping;
    });
  }, [evaluations, search, courseFilter, mappingFilter]);

  const summary = useMemo(() => {
    return filteredEvaluations.reduce(
      (result, evaluation) => {
        result.totalEvaluations += 1;
        result.totalSubjects += evaluation.summary.total_subjects;
        result.mapped += evaluation.summary.mapped_subjects;
        result.unmapped += evaluation.summary.unmapped_subjects;
        result.pending += evaluation.summary.pending_subjects;

        return result;
      },
      {
        totalEvaluations: 0,
        totalSubjects: 0,
        mapped: 0,
        unmapped: 0,
        pending: 0,
      },
    );
  }, [filteredEvaluations]);

  const canCreditDecisionSubject = useMemo(() => {
    if (!decisionSubject) return false;

    const mapping = decisionSubject.proposed_ptc_equivalency;

    if (!mapping) return false;
    if (!mapping.curriculum_subject_id) return false;
    if (!mapping.is_active) return false;

    if (
      mapping.units === null ||
      !Number.isFinite(Number(mapping.units)) ||
      Number(mapping.units) < 0
    ) {
      return false;
    }

    return true;
  }, [decisionSubject]);

  const totalCreditedUnits = useMemo(() => {
    return subjects.reduce((total, subject) => {
      if (subject.decision.credit_status !== "Credited") {
        return total;
      }

      return total + Number(subject.decision.credited_units || 0);
    }, 0);
  }, [subjects]);

  const clearFilters = () => {
    setSearch("");
    setCourseFilter("All");
    setMappingFilter("All");
  };

  const refreshQueue = () => {
    setError("");
    setPageNotice(null);
    setRefreshKey((current) => current + 1);
  };

  const resetDetailState = () => {
    setSelectedEvaluation(null);
    setSubjects([]);

    setDetailSummary({
      total_subjects: 0,
      mapped_subjects: 0,
      unmapped_subjects: 0,
      pending_subjects: 0,
      credited_subjects: 0,
      not_credited_subjects: 0,
      official_transfer_credits: 0,
    });

    setReviewReadiness({
      evaluation_status: "",
      can_review: false,
      can_make_subject_decisions: false,
      all_subjects_decided: false,
      can_complete_evaluation: false,
      note: "",
    });
  };

  const loadEvaluationDetail = async (evaluationId: number) => {
    try {
      setSelectedEvaluationId(evaluationId);
      setDetailLoading(true);
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

      const data = await readJsonResponse<EvaluationDetailResponse>(response);

      if (response.status === 401) {
        authService.logout();

        navigate("/login", {
          replace: true,
        });

        return;
      }

      if (response.status === 403) {
        throw new Error(
          data.message ||
            "You are not authorized to review this transfer evaluation.",
        );
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
            data.error ||
            "Unable to load transfer evaluation details.",
        );
      }

      if (!data.evaluation) {
        throw new Error(
          "The server did not return the transfer evaluation details.",
        );
      }

      setSelectedEvaluation(data.evaluation);

      setSubjects(Array.isArray(data.subjects) ? data.subjects : []);

      setDetailSummary({
        total_subjects: data.summary?.total_subjects ?? 0,
        mapped_subjects: data.summary?.mapped_subjects ?? 0,
        unmapped_subjects: data.summary?.unmapped_subjects ?? 0,
        pending_subjects: data.summary?.pending_subjects ?? 0,
        credited_subjects: data.summary?.credited_subjects ?? 0,
        not_credited_subjects: data.summary?.not_credited_subjects ?? 0,
        official_transfer_credits: data.summary?.official_transfer_credits ?? 0,
      });

      setReviewReadiness({
        evaluation_status: data.review_readiness?.evaluation_status || "",

        can_review: Boolean(data.review_readiness?.can_review),

        can_make_subject_decisions: Boolean(
          data.review_readiness?.can_make_subject_decisions,
        ),

        all_subjects_decided: Boolean(
          data.review_readiness?.all_subjects_decided,
        ),

        can_complete_evaluation: Boolean(
          data.review_readiness?.can_complete_evaluation,
        ),

        note: data.review_readiness?.note || "",
      });
    } catch (requestError) {
      console.error(
        "LOAD PROGRAM HEAD TRANSFER EVALUATION DETAIL ERROR:",
        requestError,
      );

      resetDetailState();

      setDetailError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load transfer evaluation details.",
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const openReview = async (evaluationId: number) => {
    setDecisionNotice(null);
    setPageNotice(null);

    await loadEvaluationDetail(evaluationId);
  };

  const closeReview = () => {
    if (
      detailLoading ||
      decisionLoading ||
      returnLoading ||
      completionLoading
    ) {
      return;
    }

    setSelectedEvaluationId(null);

    resetDetailState();

    setDetailError("");
    setDecisionNotice(null);

    setDecisionSubject(null);
    setDecisionStatus("");
    setDecisionReason("");
    setDecisionError("");

    setShowReturnModal(false);
    setReturnReason("");
    setReturnError("");

    setShowCompleteModal(false);
    setCompletionRemarks("");
    setCompletionError("");
  };

  const openDecisionModal = (subject: TransferSubject) => {
    if (!reviewReadiness.can_make_subject_decisions) {
      return;
    }

    const currentStatus = subject.decision.credit_status;

    setDecisionSubject(subject);

    setDecisionStatus(
      currentStatus === "Credited" || currentStatus === "Not Credited"
        ? currentStatus
        : "",
    );

    setDecisionReason(subject.decision.decision_reason || "");

    setDecisionError("");
    setDecisionNotice(null);
  };

  const closeDecisionModal = () => {
    if (decisionLoading) return;

    setDecisionSubject(null);
    setDecisionStatus("");
    setDecisionReason("");
    setDecisionError("");
  };

  const submitDecision = async () => {
    if (!selectedEvaluation || !decisionSubject) return;

    if (!decisionStatus) {
      setDecisionError("Select Credited or Not Credited.");
      return;
    }

    const reason = decisionReason.trim();

    if (reason.length > 500) {
      setDecisionError("Decision reason cannot exceed 500 characters.");
      return;
    }

    if (decisionStatus === "Not Credited" && !reason) {
      setDecisionError(
        "A decision reason is required when marking a subject Not Credited.",
      );
      return;
    }

    if (decisionStatus === "Credited" && !canCreditDecisionSubject) {
      setDecisionError(
        "This subject cannot be marked Credited because it does not have a valid active PTC curriculum equivalency.",
      );
      return;
    }

    const evaluationId = selectedEvaluation.transfer_evaluation_id;

    const transferSubjectId = decisionSubject.transfer_subject_id;

    try {
      setDecisionLoading(true);
      setDecisionError("");
      setDecisionNotice(null);

      const response = await authService.authFetch(
        `${API_BASE_URL}/${evaluationId}/subjects/${transferSubjectId}/decision`,
        {
          method: "PATCH",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            credit_status: decisionStatus,
            decision_reason: reason || null,
          }),
        },
      );

      const data = await readJsonResponse<MutationResponse>(response);

      if (response.status === 401) {
        authService.logout();

        navigate("/login", {
          replace: true,
        });

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
      setDecisionStatus("");
      setDecisionReason("");
      setDecisionError("");

      setDecisionNotice({
        type: "success",
        message: data.message || "Transfer-credit decision saved successfully.",
      });

      await loadEvaluationDetail(evaluationId);

      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      console.error(
        "PROGRAM HEAD TRANSFER CREDIT DECISION ERROR:",
        requestError,
      );

      setDecisionError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to record transfer-credit decision.",
      );
    } finally {
      setDecisionLoading(false);
    }
  };

  const openReturnModal = () => {
    if (
      !selectedEvaluation ||
      selectedEvaluation.evaluation_status !== "Submitted"
    ) {
      return;
    }

    setReturnReason("");
    setReturnError("");
    setDecisionNotice(null);
    setShowReturnModal(true);
  };

  const closeReturnModal = () => {
    if (returnLoading) return;

    setShowReturnModal(false);
    setReturnReason("");
    setReturnError("");
  };

  const submitReturn = async () => {
    if (!selectedEvaluation) return;

    const reason = returnReason.trim();

    if (!reason) {
      setReturnError("A return reason is required.");
      return;
    }

    if (reason.length > 500) {
      setReturnError("Return reason cannot exceed 500 characters.");
      return;
    }

    const evaluationId = selectedEvaluation.transfer_evaluation_id;

    try {
      setReturnLoading(true);
      setReturnError("");
      setPageNotice(null);

      const response = await authService.authFetch(
        `${API_BASE_URL}/${evaluationId}/return`,
        {
          method: "PATCH",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            review_remarks: reason,
          }),
        },
      );

      const data = await readJsonResponse<MutationResponse>(response);

      if (response.status === 401) {
        authService.logout();

        navigate("/login", {
          replace: true,
        });

        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Unable to return transfer evaluation.",
        );
      }

      setShowReturnModal(false);
      setReturnReason("");
      setReturnError("");

      setSelectedEvaluationId(null);
      resetDetailState();

      setPageNotice({
        type: "success",
        message:
          data.message ||
          "Transfer evaluation returned to the Registrar for correction.",
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
      setReturnLoading(false);
    }
  };

  const openCompleteModal = () => {
    if (!selectedEvaluation) return;

    if (selectedEvaluation.evaluation_status !== "Submitted") {
      return;
    }

    if (!reviewReadiness.can_complete_evaluation) {
      return;
    }

    setCompletionRemarks("");
    setCompletionError("");
    setDecisionNotice(null);
    setShowCompleteModal(true);
  };

  const closeCompleteModal = () => {
    if (completionLoading) return;

    setShowCompleteModal(false);
    setCompletionRemarks("");
    setCompletionError("");
  };

  const submitCompletion = async () => {
    if (!selectedEvaluation) return;

    if (!reviewReadiness.can_complete_evaluation) {
      setCompletionError(
        "This transfer evaluation is not ready for completion.",
      );
      return;
    }

    const remarks = completionRemarks.trim();

    if (remarks.length > 500) {
      setCompletionError("Review remarks cannot exceed 500 characters.");
      return;
    }

    const evaluationId = selectedEvaluation.transfer_evaluation_id;

    try {
      setCompletionLoading(true);
      setCompletionError("");
      setPageNotice(null);

      const response = await authService.authFetch(
        `${API_BASE_URL}/${evaluationId}/complete`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            review_remarks: remarks || null,
          }),
        },
      );

      const data = await readJsonResponse<MutationResponse>(response);

      if (response.status === 401) {
        authService.logout();

        navigate("/login", {
          replace: true,
        });

        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
            data.error ||
            "Unable to complete transfer evaluation.",
        );
      }

      setShowCompleteModal(false);
      setCompletionRemarks("");
      setCompletionError("");

      setSelectedEvaluationId(null);
      resetDetailState();

      setDecisionSubject(null);
      setDecisionStatus("");
      setDecisionReason("");
      setDecisionError("");
      setDecisionNotice(null);

      setShowReturnModal(false);
      setReturnReason("");
      setReturnError("");

      setPageNotice({
        type: "success",
        message: data.message || "Transfer evaluation completed successfully.",
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
      setCompletionLoading(false);
    }
  };

  if (!authenticated || userRole !== "Program Head") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="program-head-transfer-page">
        <section className="program-head-transfer-header">
          <div>
            <span className="program-head-transfer-eyebrow">Program Head</span>

            <h1>Transfer Evaluation Review</h1>

            <p>
              Review Registrar-submitted previous-school transcript evaluations
              and proposed PTC curriculum equivalencies within your department.
            </p>
          </div>

          <button
            type="button"
            className="program-head-transfer-refresh"
            onClick={refreshQueue}
            disabled={
              loading ||
              detailLoading ||
              decisionLoading ||
              returnLoading ||
              completionLoading
            }
          >
            {loading ? "Refreshing..." : "Refresh Queue"}
          </button>
        </section>

        {programHead && (
          <section className="program-head-transfer-profile">
            <div>
              <span>Program Head</span>
              <strong>{programHead.program_head_name}</strong>
            </div>

            <div>
              <span>Employee Number</span>
              <strong>{programHead.employee_number}</strong>
            </div>

            <div>
              <span>Department</span>
              <strong>{programHead.department.department_code}</strong>

              <small>{programHead.department.department_name}</small>
            </div>
          </section>
        )}

        {pageNotice && (
          <section
            className={`program-head-transfer-page-notice ${pageNotice.type}`}
          >
            <strong>
              {pageNotice.type === "success"
                ? "Transfer evaluation updated"
                : "Transfer evaluation action failed"}
            </strong>

            <p>{pageNotice.message}</p>
          </section>
        )}

        <section className="program-head-transfer-rule">
          <div className="program-head-transfer-rule-icon">✓</div>

          <div>
            <strong>Transfer Credit Review Rule</strong>

            <p>
              A previous-school grade is source information only and never
              becomes a PTC Final Rating. Transfer credit becomes official only
              after the complete transfer evaluation is marked Completed.
            </p>
          </div>
        </section>

        <section className="program-head-transfer-summary">
          <div>
            <span>Pending Evaluations</span>
            <strong>{summary.totalEvaluations}</strong>
          </div>

          <div>
            <span>Transcript Subjects</span>
            <strong>{summary.totalSubjects}</strong>
          </div>

          <div>
            <span>Mapped</span>
            <strong>{summary.mapped}</strong>
          </div>

          <div>
            <span>Unmapped</span>
            <strong>{summary.unmapped}</strong>
          </div>

          <div>
            <span>Pending Decisions</span>
            <strong>{summary.pending}</strong>
          </div>
        </section>

        <section className="program-head-transfer-filters">
          <div className="program-head-transfer-search">
            <label htmlFor="program-head-transfer-search">Search</label>

            <input
              id="program-head-transfer-search"
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Student, previous school, curriculum..."
            />
          </div>

          <div>
            <label>Course</label>

            <select
              value={courseFilter}
              onChange={(event) => setCourseFilter(event.target.value)}
            >
              <option value="All">All Courses</option>

              {courses.map(([courseId, courseCode]) => (
                <option key={courseId} value={courseId}>
                  {courseCode}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>Mapping Status</label>

            <select
              value={mappingFilter}
              onChange={(event) =>
                setMappingFilter(event.target.value as MappingFilter)
              }
            >
              <option value="All">All</option>
              <option value="Fully Mapped">Fully Mapped</option>
              <option value="Has Unmapped">Has Unmapped</option>
            </select>
          </div>

          <button
            type="button"
            className="program-head-transfer-clear"
            onClick={clearFilters}
          >
            Clear
          </button>
        </section>

        {error && (
          <section className="program-head-transfer-error">
            <div>
              <strong>Transfer evaluations could not be loaded</strong>

              <p>{error}</p>
            </div>

            <button type="button" onClick={refreshQueue}>
              Try Again
            </button>
          </section>
        )}

        {loading && (
          <section className="program-head-transfer-loading">
            <div className="program-head-transfer-spinner" />

            <div>
              <strong>Loading submitted transfer evaluations</strong>

              <span>
                Retrieving evaluations awaiting your department review...
              </span>
            </div>
          </section>
        )}

        {!loading && !error && filteredEvaluations.length === 0 && (
          <section className="program-head-transfer-empty">
            <strong>No submitted transfer evaluations</strong>

            <p>
              There are no Registrar-submitted transfer evaluations matching the
              current filters.
            </p>

            {evaluations.length > 0 && (
              <button type="button" onClick={clearFilters}>
                Clear Filters
              </button>
            )}
          </section>
        )}

        {!loading && !error && filteredEvaluations.length > 0 && (
          <section className="program-head-transfer-queue">
            <div className="program-head-transfer-queue-header">
              <div>
                <h2>Submitted Transfer Evaluations</h2>

                <p>
                  Open an evaluation to review its previous-school subjects and
                  proposed PTC curriculum equivalencies.
                </p>
              </div>

              <span>{filteredEvaluations.length} pending</span>
            </div>

            <div className="program-head-transfer-table-wrapper">
              <table className="program-head-transfer-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Previous School</th>
                    <th>PTC Curriculum</th>
                    <th>Entry</th>
                    <th>Subjects</th>
                    <th>Mapping</th>
                    <th>Submitted</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredEvaluations.map((evaluation) => (
                    <tr key={evaluation.transfer_evaluation_id}>
                      <td>
                        <div className="program-head-transfer-student">
                          <strong>{evaluation.student.student_name}</strong>

                          <span>{evaluation.student.student_number}</span>

                          <small>
                            Student #{evaluation.student.student_id}
                          </small>
                        </div>
                      </td>

                      <td>
                        <div className="program-head-transfer-school">
                          <strong>{evaluation.source.school}</strong>

                          <span>
                            {evaluation.source.course || "Course not recorded"}
                          </span>

                          <small>
                            Previous Student No.:{" "}
                            {evaluation.source.student_number || "—"}
                          </small>
                        </div>
                      </td>

                      <td>
                        <div className="program-head-transfer-curriculum">
                          <strong>
                            {evaluation.curriculum.course.course_code}
                          </strong>

                          <span>{evaluation.curriculum.curriculum_name}</span>

                          <small>
                            {evaluation.curriculum.effective_year
                              ? `Effective ${evaluation.curriculum.effective_year}`
                              : "Effective year —"}
                          </small>
                        </div>
                      </td>

                      <td>
                        <div className="program-head-transfer-entry">
                          <strong>
                            {evaluation.ptc_entry.year_level
                              ? `Year ${evaluation.ptc_entry.year_level}`
                              : "—"}
                          </strong>

                          <span>
                            {evaluation.ptc_entry.semester_name || "Semester —"}
                          </span>
                        </div>
                      </td>

                      <td>
                        <div className="program-head-transfer-count">
                          <strong>{evaluation.summary.total_subjects}</strong>

                          <span>
                            transcript subject
                            {evaluation.summary.total_subjects === 1 ? "" : "s"}
                          </span>
                        </div>
                      </td>

                      <td>
                        <div className="program-head-transfer-mapping-summary">
                          <span className="mapped">
                            {evaluation.summary.mapped_subjects} mapped
                          </span>

                          <span
                            className={
                              evaluation.summary.unmapped_subjects > 0
                                ? "unmapped has-unmapped"
                                : "unmapped"
                            }
                          >
                            {evaluation.summary.unmapped_subjects} unmapped
                          </span>

                          <small>
                            {evaluation.summary.pending_subjects} pending
                            decision
                          </small>
                        </div>
                      </td>

                      <td>
                        <div className="program-head-transfer-submitted">
                          <strong>Submitted</strong>

                          <span>
                            {formatDateTime(evaluation.workflow.submitted_at)}
                          </span>

                          <small>
                            by{" "}
                            {evaluation.workflow.submitted_by_username ||
                              "Registrar"}
                          </small>
                        </div>
                      </td>

                      <td>
                        <button
                          type="button"
                          className="program-head-transfer-review-button"
                          onClick={() =>
                            void openReview(evaluation.transfer_evaluation_id)
                          }
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {!loading && !error && (
          <section className="program-head-transfer-workflow">
            <div>
              <span>1</span>

              <div>
                <strong>Registrar Submits</strong>

                <p>
                  Transcript subjects and proposed mappings enter Program Head
                  review.
                </p>
              </div>
            </div>

            <div>
              <span>2</span>

              <div>
                <strong>Review Subjects</strong>

                <p>
                  Compare each previous-school subject with its proposed PTC
                  equivalent.
                </p>
              </div>
            </div>

            <div>
              <span>3</span>

              <div>
                <strong>Academic Decision</strong>

                <p>
                  Record Credited or Not Credited for every transcript subject.
                </p>
              </div>
            </div>

            <div>
              <span>4</span>

              <div>
                <strong>Complete Evaluation</strong>

                <p>Completed + Credited creates official transfer credit.</p>
              </div>
            </div>
          </section>
        )}

        {selectedEvaluationId !== null && (
          <div
            className="program-head-transfer-review-backdrop"
            onMouseDown={(event) => {
              if (
                event.target === event.currentTarget &&
                !decisionSubject &&
                !showReturnModal &&
                !showCompleteModal
              ) {
                closeReview();
              }
            }}
          >
            <section
              className="program-head-transfer-review-modal"
              role="dialog"
              aria-modal="true"
            >
              <div className="program-head-transfer-review-header">
                <div>
                  <span>Transfer Evaluation Review</span>

                  <h2>Evaluation #{selectedEvaluationId}</h2>

                  <p>
                    Review transcript information, equivalencies, and academic
                    decisions.
                  </p>
                </div>

                <button
                  type="button"
                  className="program-head-transfer-review-close"
                  onClick={closeReview}
                  disabled={
                    detailLoading ||
                    decisionLoading ||
                    returnLoading ||
                    completionLoading
                  }
                >
                  ×
                </button>
              </div>

              {detailLoading && (
                <div className="program-head-transfer-detail-loading">
                  <div className="program-head-transfer-spinner" />

                  <div>
                    <strong>Loading evaluation details</strong>

                    <span>Retrieving transcript subjects and mappings...</span>
                  </div>
                </div>
              )}

              {!detailLoading && detailError && (
                <div className="program-head-transfer-detail-error">
                  <strong>Evaluation could not be opened</strong>

                  <p>{detailError}</p>

                  <button
                    type="button"
                    onClick={() =>
                      void loadEvaluationDetail(selectedEvaluationId)
                    }
                  >
                    Try Again
                  </button>
                </div>
              )}

              {!detailLoading && !detailError && selectedEvaluation && (
                <>
                  <div className="program-head-transfer-review-statusbar">
                    <div>
                      <span>Status</span>

                      <strong className="program-head-transfer-status">
                        {selectedEvaluation.evaluation_status}
                      </strong>
                    </div>

                    <div>
                      <span>Submitted By</span>

                      <strong>
                        {displayValue(
                          selectedEvaluation.workflow.submitted_by_username,
                        )}
                      </strong>
                    </div>

                    <div>
                      <span>Submitted At</span>

                      <strong>
                        {formatDateTime(
                          selectedEvaluation.workflow.submitted_at,
                        )}
                      </strong>
                    </div>

                    <div>
                      <span>Department</span>

                      <strong>
                        {selectedEvaluation.curriculum.course.department_code}
                      </strong>
                    </div>
                  </div>

                  <div className="program-head-transfer-review-grid">
                    <div>
                      <span>Student</span>

                      <strong>{selectedEvaluation.student.student_name}</strong>

                      <small>{selectedEvaluation.student.student_number}</small>
                    </div>

                    <div>
                      <span>PTC Program</span>

                      <strong>
                        {selectedEvaluation.curriculum.course.course_code}
                      </strong>

                      <small>
                        {selectedEvaluation.curriculum.course.course_name}
                      </small>
                    </div>

                    <div>
                      <span>Previous School</span>

                      <strong>{selectedEvaluation.source.school}</strong>

                      <small>
                        {selectedEvaluation.source.course ||
                          "Previous course not recorded"}
                      </small>
                    </div>

                    <div>
                      <span>Curriculum</span>

                      <strong>
                        {selectedEvaluation.curriculum.curriculum_name}
                      </strong>

                      <small>
                        {selectedEvaluation.curriculum.effective_year
                          ? `Effective ${selectedEvaluation.curriculum.effective_year}`
                          : "Effective year —"}
                      </small>
                    </div>

                    <div>
                      <span>Transcript Reference</span>

                      <strong>
                        {displayValue(
                          selectedEvaluation.source.transcript_reference,
                        )}
                      </strong>

                      <small>
                        Previous Student No.:{" "}
                        {displayValue(selectedEvaluation.source.student_number)}
                      </small>
                    </div>

                    <div>
                      <span>PTC Entry</span>

                      <strong>
                        {selectedEvaluation.ptc_entry.year_level
                          ? `Year ${selectedEvaluation.ptc_entry.year_level}`
                          : "—"}
                      </strong>

                      <small>
                        {selectedEvaluation.ptc_entry.semester_name ||
                          "Semester —"}
                      </small>
                    </div>
                  </div>

                  <div className="program-head-transfer-detail-summary">
                    <div>
                      <span>Subjects</span>
                      <strong>{detailSummary.total_subjects}</strong>
                    </div>

                    <div>
                      <span>Mapped</span>
                      <strong>{detailSummary.mapped_subjects}</strong>
                    </div>

                    <div>
                      <span>Unmapped</span>
                      <strong>{detailSummary.unmapped_subjects}</strong>
                    </div>

                    <div>
                      <span>Pending</span>
                      <strong>{detailSummary.pending_subjects}</strong>
                    </div>

                    <div>
                      <span>Credited</span>
                      <strong>{detailSummary.credited_subjects}</strong>
                    </div>

                    <div>
                      <span>Not Credited</span>
                      <strong>{detailSummary.not_credited_subjects}</strong>
                    </div>
                  </div>

                  {decisionNotice && (
                    <div
                      className={`program-head-transfer-action-notice ${decisionNotice.type}`}
                    >
                      <strong>Academic decision updated</strong>

                      <p>{decisionNotice.message}</p>
                    </div>
                  )}

                  <div
                    className={`program-head-transfer-readiness ${
                      reviewReadiness.all_subjects_decided ? "ready" : "pending"
                    }`}
                  >
                    <strong>
                      {reviewReadiness.all_subjects_decided
                        ? "All Subjects Reviewed"
                        : "Academic Review In Progress"}
                    </strong>

                    <p>
                      {reviewReadiness.note ||
                        "Review each transcript subject."}
                    </p>
                  </div>

                  <div className="program-head-transfer-subject-section">
                    <div className="program-head-transfer-subject-header">
                      <div>
                        <span>Transcript Subjects</span>

                        <h3>Subject Equivalency Review</h3>

                        <p>
                          Source grades remain previous-school information and
                          are never converted into PTC Final Ratings.
                        </p>
                      </div>

                      <strong>
                        {subjects.length} subject
                        {subjects.length === 1 ? "" : "s"}
                      </strong>
                    </div>

                    {subjects.length === 0 ? (
                      <div className="program-head-transfer-no-subjects">
                        <strong>No transcript subjects found</strong>
                      </div>
                    ) : (
                      <div className="program-head-transfer-detail-table-wrapper">
                        <table className="program-head-transfer-detail-table program-head-transfer-detail-table--decisions">
                          <thead>
                            <tr>
                              <th>Previous-School Subject</th>

                              <th>Source Grade</th>
                              <th>Source Period</th>

                              <th>Proposed PTC Equivalent</th>

                              <th>PTC Units</th>
                              <th>Decision</th>
                              <th>Action</th>
                            </tr>
                          </thead>

                          <tbody>
                            {subjects.map((subject) => {
                              const alreadyDecided =
                                subject.decision.credit_status !== "Pending";

                              return (
                                <tr key={subject.transfer_subject_id}>
                                  <td>
                                    <div className="program-head-transfer-detail-subject">
                                      <strong>
                                        {subject.source.subject_code ||
                                          "No Code"}
                                      </strong>

                                      <span>{subject.source.subject_name}</span>

                                      <small>
                                        {subject.source.units !== null
                                          ? `${subject.source.units} source unit(s)`
                                          : "Source units —"}
                                      </small>
                                    </div>
                                  </td>

                                  <td>
                                    <span className="program-head-transfer-source-grade">
                                      {displayValue(subject.source.grade)}
                                    </span>
                                  </td>

                                  <td>
                                    <div className="program-head-transfer-source-period">
                                      <strong>
                                        {subject.source.academic_year || "AY —"}
                                      </strong>

                                      <span>
                                        {subject.source.year_level
                                          ? `Year ${subject.source.year_level}`
                                          : "Year —"}
                                      </span>

                                      <small>
                                        {subject.source.semester ||
                                          "Semester —"}
                                      </small>
                                    </div>
                                  </td>

                                  <td>
                                    {subject.proposed_ptc_equivalency ? (
                                      <div className="program-head-transfer-equivalency">
                                        <strong>
                                          {
                                            subject.proposed_ptc_equivalency
                                              .subject_code
                                          }
                                        </strong>

                                        <span>
                                          {
                                            subject.proposed_ptc_equivalency
                                              .subject_name
                                          }
                                        </span>

                                        <small>
                                          {subject.proposed_ptc_equivalency
                                            .curriculum.year_level
                                            ? `Year ${subject.proposed_ptc_equivalency.curriculum.year_level}`
                                            : "Year —"}
                                          {" • "}
                                          {subject.proposed_ptc_equivalency
                                            .curriculum.semester_name ||
                                            "Semester —"}
                                        </small>
                                      </div>
                                    ) : (
                                      <span className="program-head-transfer-not-mapped">
                                        Not Mapped
                                      </span>
                                    )}
                                  </td>

                                  <td>
                                    <strong className="program-head-transfer-ptc-units">
                                      {subject.proposed_ptc_equivalency
                                        ?.units ?? "—"}
                                    </strong>

                                    {subject.decision.credited_units !==
                                      null && (
                                      <small className="program-head-transfer-awarded-units">
                                        Awarded:{" "}
                                        {subject.decision.credited_units}
                                      </small>
                                    )}
                                  </td>

                                  <td>
                                    <span
                                      className={`program-head-transfer-decision ${getStatusClass(
                                        subject.decision.credit_status,
                                      )}`}
                                    >
                                      {subject.decision.credit_status}
                                    </span>

                                    {subject.decision.decision_reason && (
                                      <small className="program-head-transfer-decision-reason">
                                        {subject.decision.decision_reason}
                                      </small>
                                    )}
                                  </td>

                                  <td>
                                    <button
                                      type="button"
                                      className={
                                        alreadyDecided
                                          ? "program-head-transfer-change-decision-button"
                                          : "program-head-transfer-decide-button"
                                      }
                                      onClick={() => openDecisionModal(subject)}
                                      disabled={
                                        !reviewReadiness.can_make_subject_decisions ||
                                        decisionLoading ||
                                        returnLoading ||
                                        completionLoading
                                      }
                                    >
                                      {alreadyDecided
                                        ? "Change Decision"
                                        : "Decide"}
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="program-head-transfer-review-footer program-head-transfer-review-footer--actions">
                    <button
                      type="button"
                      className="program-head-transfer-return-open-button"
                      onClick={openReturnModal}
                      disabled={
                        decisionLoading ||
                        returnLoading ||
                        completionLoading ||
                        selectedEvaluation.evaluation_status !== "Submitted"
                      }
                    >
                      Return to Registrar
                    </button>

                    <div className="program-head-transfer-review-footer-right">
                      <button
                        type="button"
                        className="program-head-transfer-close-review-button"
                        onClick={closeReview}
                        disabled={
                          decisionLoading || returnLoading || completionLoading
                        }
                      >
                        Close Review
                      </button>

                      <button
                        type="button"
                        className="program-head-transfer-complete-open-button"
                        onClick={openCompleteModal}
                        disabled={
                          decisionLoading ||
                          returnLoading ||
                          completionLoading ||
                          !reviewReadiness.can_complete_evaluation
                        }
                      >
                        Complete Evaluation
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>
        )}

        {decisionSubject && selectedEvaluation && (
          <div className="program-head-transfer-decision-backdrop">
            <section
              className="program-head-transfer-decision-modal"
              role="dialog"
              aria-modal="true"
            >
              <div className="program-head-transfer-decision-modal-header">
                <div>
                  <span>Academic Decision</span>

                  <h2>
                    {decisionSubject.decision.credit_status === "Pending"
                      ? "Review Transfer Subject"
                      : "Change Transfer Decision"}
                  </h2>

                  <p>Evaluation #{selectedEvaluation.transfer_evaluation_id}</p>
                </div>

                <button
                  type="button"
                  onClick={closeDecisionModal}
                  disabled={decisionLoading}
                >
                  ×
                </button>
              </div>

              <div className="program-head-transfer-decision-subject-summary">
                <div>
                  <span>Previous-School Subject</span>

                  <strong>
                    {decisionSubject.source.subject_code || "No Code"} —{" "}
                    {decisionSubject.source.subject_name}
                  </strong>

                  <small>
                    Source Grade: {displayValue(decisionSubject.source.grade)}
                  </small>
                </div>

                <div>
                  <span>Proposed PTC Equivalent</span>

                  {decisionSubject.proposed_ptc_equivalency ? (
                    <>
                      <strong>
                        {decisionSubject.proposed_ptc_equivalency.subject_code}{" "}
                        —{" "}
                        {decisionSubject.proposed_ptc_equivalency.subject_name}
                      </strong>

                      <small>
                        {decisionSubject.proposed_ptc_equivalency.units} PTC
                        unit(s)
                      </small>
                    </>
                  ) : (
                    <>
                      <strong>Not Mapped</strong>
                      <small>Credited is unavailable.</small>
                    </>
                  )}
                </div>
              </div>

              <div className="program-head-transfer-decision-body">
                {decisionError && (
                  <div className="program-head-transfer-decision-error">
                    {decisionError}
                  </div>
                )}

                <div className="program-head-transfer-decision-field">
                  <label>Academic Decision</label>

                  <div className="program-head-transfer-decision-options">
                    <button
                      type="button"
                      className={`credited ${
                        decisionStatus === "Credited" ? "selected" : ""
                      }`}
                      onClick={() => {
                        setDecisionStatus("Credited");
                        setDecisionError("");
                      }}
                      disabled={decisionLoading || !canCreditDecisionSubject}
                    >
                      <strong>Credited</strong>

                      <span>
                        Accept the mapped PTC subject as academically
                        equivalent.
                      </span>
                    </button>

                    <button
                      type="button"
                      className={`not-credited ${
                        decisionStatus === "Not Credited" ? "selected" : ""
                      }`}
                      onClick={() => {
                        setDecisionStatus("Not Credited");

                        setDecisionError("");
                      }}
                      disabled={decisionLoading}
                    >
                      <strong>Not Credited</strong>

                      <span>
                        Do not award PTC transfer credit for this subject.
                      </span>
                    </button>
                  </div>
                </div>

                <div className="program-head-transfer-decision-field">
                  <div className="program-head-transfer-decision-label-row">
                    <label htmlFor="program-head-transfer-decision-reason">
                      Decision Reason{" "}
                      {decisionStatus === "Not Credited" && <span>*</span>}
                    </label>

                    <small>{decisionReason.length}/500</small>
                  </div>

                  <textarea
                    id="program-head-transfer-decision-reason"
                    rows={5}
                    maxLength={500}
                    value={decisionReason}
                    onChange={(event) => {
                      setDecisionReason(event.target.value);

                      setDecisionError("");
                    }}
                    disabled={decisionLoading}
                  />
                </div>

                {decisionError && (
                  <div className="program-head-transfer-decision-error">
                    {decisionError}
                  </div>
                )}
              </div>

              <div className="program-head-transfer-decision-actions">
                <button
                  type="button"
                  className="cancel"
                  onClick={closeDecisionModal}
                  disabled={decisionLoading}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="save"
                  onClick={() => void submitDecision()}
                  disabled={
                    decisionLoading ||
                    !decisionStatus ||
                    (decisionStatus === "Not Credited" &&
                      !decisionReason.trim()) ||
                    (decisionStatus === "Credited" && !canCreditDecisionSubject)
                  }
                >
                  {decisionLoading ? "Saving..." : "Save Decision"}
                </button>
              </div>
            </section>
          </div>
        )}

        {showReturnModal && selectedEvaluation && (
          <div className="program-head-transfer-return-backdrop">
            <section
              className="program-head-transfer-return-modal"
              role="dialog"
              aria-modal="true"
            >
              <div className="program-head-transfer-return-header">
                <div>
                  <span>Return Evaluation</span>
                  <h2>Return to Registrar</h2>

                  <p>
                    Send this evaluation back for transcript or equivalency
                    correction.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeReturnModal}
                  disabled={returnLoading}
                >
                  ×
                </button>
              </div>

              <div className="program-head-transfer-return-warning">
                <strong>Academic decisions will be reset</strong>

                <p>
                  All Credited and Not Credited decisions will return to
                  Pending. Raw transcript data and PTC mappings remain
                  preserved.
                </p>
              </div>

              <div className="program-head-transfer-return-field">
                <div className="program-head-transfer-return-label">
                  <label>
                    Return Reason <span>*</span>
                  </label>

                  <small>{returnReason.length}/500</small>
                </div>

                <textarea
                  value={returnReason}
                  maxLength={500}
                  rows={6}
                  disabled={returnLoading}
                  onChange={(event) => {
                    setReturnReason(event.target.value);
                    setReturnError("");
                  }}
                />

                {returnError && (
                  <div className="program-head-transfer-return-error">
                    {returnError}
                  </div>
                )}
              </div>

              <div className="program-head-transfer-return-actions">
                <button
                  type="button"
                  className="cancel"
                  onClick={closeReturnModal}
                  disabled={returnLoading}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="confirm"
                  onClick={() => void submitReturn()}
                  disabled={returnLoading || !returnReason.trim()}
                >
                  {returnLoading ? "Returning..." : "Return to Registrar"}
                </button>
              </div>
            </section>
          </div>
        )}

        {showCompleteModal && selectedEvaluation && (
          <div
            className="program-head-transfer-complete-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeCompleteModal();
              }
            }}
          >
            <section
              className="program-head-transfer-complete-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="program-head-transfer-complete-title"
            >
              <div className="program-head-transfer-complete-header">
                <div>
                  <span>Final Academic Action</span>

                  <h2 id="program-head-transfer-complete-title">
                    Complete Transfer Evaluation
                  </h2>

                  <p>
                    Confirm the final transfer-credit decisions for this
                    evaluation.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeCompleteModal}
                  disabled={completionLoading}
                >
                  ×
                </button>
              </div>

              <div className="program-head-transfer-complete-student">
                <div>
                  <span>Student</span>

                  <strong>{selectedEvaluation.student.student_name}</strong>

                  <small>{selectedEvaluation.student.student_number}</small>
                </div>

                <div>
                  <span>PTC Program</span>

                  <strong>
                    {selectedEvaluation.curriculum.course.course_code}
                  </strong>

                  <small>{selectedEvaluation.curriculum.curriculum_name}</small>
                </div>

                <div>
                  <span>Previous School</span>

                  <strong>{selectedEvaluation.source.school}</strong>

                  <small>
                    {selectedEvaluation.source.course || "Course not recorded"}
                  </small>
                </div>
              </div>

              <div className="program-head-transfer-complete-summary">
                <div>
                  <span>Total Subjects</span>
                  <strong>{detailSummary.total_subjects}</strong>
                </div>

                <div>
                  <span>Credited</span>
                  <strong>{detailSummary.credited_subjects}</strong>
                </div>

                <div>
                  <span>Not Credited</span>
                  <strong>{detailSummary.not_credited_subjects}</strong>
                </div>

                <div>
                  <span>Pending</span>
                  <strong>{detailSummary.pending_subjects}</strong>
                </div>

                <div>
                  <span>Credited Units</span>
                  <strong>{totalCreditedUnits}</strong>
                </div>
              </div>

              <div className="program-head-transfer-complete-ready">
                <div>✓</div>

                <div>
                  <strong>Ready for Completion</strong>

                  <p>
                    Every transcript subject has a final academic decision.
                    Completing this evaluation will finalize those decisions.
                  </p>
                </div>
              </div>

              <div className="program-head-transfer-complete-effect">
                <strong>Academic Effect</strong>

                <div>
                  <span>✓ Evaluation becomes Completed</span>

                  <span>
                    ✓ Credited subjects become official transfer credits
                  </span>

                  <span>
                    ✓ Credited PTC curriculum requirements become satisfied
                  </span>

                  <span>
                    ✓ Transfer credits may appear in official academic records
                  </span>

                  <span>✕ No normal PTC grade is created</span>

                  <span>
                    ✕ Previous-school grade is not converted into a PTC Final
                    Rating
                  </span>
                </div>
              </div>

              <div className="program-head-transfer-complete-warning">
                <strong>This action finalizes the evaluation</strong>

                <p>
                  After completion, subject decisions can no longer be revised
                  through the Submitted review workflow. Verify all Credited and
                  Not Credited decisions before continuing.
                </p>
              </div>

              <div className="program-head-transfer-complete-field">
                <div className="program-head-transfer-complete-label">
                  <label htmlFor="program-head-transfer-completion-remarks">
                    Final Review Remarks
                  </label>

                  <small>{completionRemarks.length}/500</small>
                </div>

                <textarea
                  id="program-head-transfer-completion-remarks"
                  value={completionRemarks}
                  maxLength={500}
                  rows={5}
                  disabled={completionLoading}
                  placeholder="Optional: Transfer-credit evaluation completed after academic review."
                  onChange={(event) => {
                    setCompletionRemarks(event.target.value);

                    setCompletionError("");
                  }}
                />

                <small>
                  Optional. These remarks will be stored with the completed
                  evaluation.
                </small>
              </div>

              {completionError && (
                <div className="program-head-transfer-complete-error">
                  {completionError}
                </div>
              )}

              <div className="program-head-transfer-complete-actions">
                <button
                  type="button"
                  className="cancel"
                  onClick={closeCompleteModal}
                  disabled={completionLoading}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="confirm"
                  onClick={() => void submitCompletion()}
                  disabled={
                    completionLoading ||
                    !reviewReadiness.can_complete_evaluation
                  }
                >
                  {completionLoading ? "Completing..." : "Complete Evaluation"}
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}
