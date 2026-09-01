import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  FileText,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Send,
  UserRound,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/TransferEvaluationR.css";

const API_BASE_URL = "http://localhost:3000/api/registrar/transfer-evaluations";

type EvaluationStatus =
  | "Draft"
  | "Submitted"
  | "Returned"
  | "Completed"
  | "Cancelled"
  | string;

type CreditStatus = "Pending" | "Credited" | "Not Credited" | string;

interface StudentCourse {
  course_id: number;
  course_code: string | null;
  course_name: string | null;
  total_years?: number | null;
  department_id?: number | null;
  department_code?: string | null;
  department_name?: string | null;
}

interface ContextStudent {
  student_id: number;
  student_number: string;
  student_name: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  year_level: number | null;
  status: string | null;
  course: StudentCourse;
}

interface ContextCurriculum {
  student_curriculum_id: number;
  curriculum_id: number;
  curriculum_name: string;
  effective_year: number | null;
  total_units: number | null;
  assignment_status: string;
  assigned_date: string | null;
  assignment_remarks: string | null;
  is_active: boolean;

  course: {
    course_id: number;
    course_code: string;
    course_name: string;
  };
}

interface CurriculumSubject {
  curriculum_subject_id: number;
  curriculum_id: number;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  units: number;
  lecture_hours: number | null;
  laboratory_hours: number | null;
  description: string | null;
  year_level: number | null;
  semester_id: number | null;
  semester_name: string | null;
  is_required: boolean | null;
  display_order: number | null;
  is_active: boolean;
}

interface TransferContextResponse {
  success: boolean;
  code?: string;
  message?: string;
  error?: string;

  student?: ContextStudent;
  curriculum?: ContextCurriculum | null;
  curriculum_subjects?: CurriculumSubject[];

  curriculum_issue?: string | null;
  can_create_evaluation?: boolean;

  summary?: {
    total_curriculum_subjects: number;
    total_curriculum_units: number;
  };
}

interface EvaluationListItem {
  transfer_evaluation_id: number;
  evaluation_status: EvaluationStatus;

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
      department_id: number | null;
      department_code: string | null;
      department_name: string | null;
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
    status: string;
    editable: boolean;
    can_submit: boolean;
    awaiting_program_head_review: boolean;
    returned_for_correction: boolean;
    completed: boolean;
    read_only: boolean;

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

  summary: {
    total_subjects: number;
    mapped_subjects: number;
    unmapped_subjects: number;
    pending_subjects: number;
    credited_subjects: number;
    not_credited_subjects: number;
  };

  remarks: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface EvaluationListResponse {
  success: boolean;
  code?: string;
  message?: string;
  error?: string;

  summary?: {
    total_evaluations: number;
    draft: number;
    submitted: number;
    returned: number;
    completed: number;
    cancelled: number;
  };

  evaluations?: EvaluationListItem[];
}

interface ProposedMapping {
  subject_id: number;
  subject_code: string | null;
  subject_name: string | null;
  units: number | null;
  lecture_hours: number | null;
  laboratory_hours: number | null;
  description: string | null;
  currently_active: boolean | null;

  curriculum_subject: {
    curriculum_subject_id: number;
    year_level: number | null;
    semester_id: number | null;
    semester_name: string | null;
    is_required: boolean | null;
    display_order: number | null;
  } | null;
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

  proposed_ptc_mapping: ProposedMapping | null;

  decision: {
    credit_status: CreditStatus;
    credited_units: number | null;
    decision_reason: string | null;
    reviewed_by: number | null;
    reviewed_by_username: string | null;
    reviewed_at: string | null;
  };

  editable: boolean;
  created_at: string | null;
  updated_at: string | null;
}

interface EvaluationDetail {
  transfer_evaluation_id: number;
  evaluation_status: EvaluationStatus;

  student: {
    student_id: number;
    student_number: string;
    student_name: string;
    current_year_level: number | null;
    current_course_id: number | null;
  };

  curriculum: {
    curriculum_id: number;
    curriculum_name: string;
    effective_year: number | null;
    total_units: number | null;
    currently_active: boolean;

    course: {
      course_id: number;
      course_code: string;
      course_name: string;
      total_years: number | null;
      department_id: number | null;
      department_code: string | null;
      department_name: string | null;
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
      file_path: string | null;
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
    status: string;
    editable: boolean;
    can_submit: boolean;
    awaiting_program_head_review: boolean;
    returned_for_correction: boolean;
    completed: boolean;
    read_only: boolean;

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

  evaluation?: EvaluationDetail;
  subjects?: TransferSubject[];

  summary?: {
    total_subjects: number;
    mapped_subjects: number;
    unmapped_subjects: number;
    pending_subjects: number;
    credited_subjects: number;
    not_credited_subjects: number;
    duplicate_mapped_ptc_subject_ids: number[];
    already_reviewed_subjects: number;
  };
}

interface CreateEvaluationResponse {
  success: boolean;
  code?: string;
  message?: string;
  error?: string;

  evaluation?: {
    transfer_evaluation_id: number;
    evaluation_status: string;
  };

  existing_evaluation?: {
    transfer_evaluation_id: number;
    evaluation_status: string;
    source_school: string;
    created_at: string | null;
    updated_at: string | null;
  };
}

interface AddTransferSubjectResponse {
  success: boolean;
  code?: string;
  message?: string;
  error?: string;

  transfer_subject?: {
    transfer_subject_id: number;
    transfer_evaluation_id: number;
  };
}

interface MapTransferSubjectResponse {
  success: boolean;
  code?: string;
  message?: string;
  error?: string;

  existing_mapping?: {
    transfer_subject_id: number;
    source_subject_code: string | null;
    source_subject_name: string;
    source_grade: string | null;
    credit_status: string;
  };
}

interface SubmitTransferEvaluationResponse {
  success: boolean;
  code?: string;
  message?: string;
  error?: string;

  evaluation?: {
    transfer_evaluation_id: number;
    evaluation_status: string;

    workflow?: {
      previous_status?: string;
      current_status?: string;
      submitted_by?: number | null;
      submitted_at?: string | null;
    };
  };

  subjects?: unknown[];
  duplicates?: unknown[];
}

interface CreateEvaluationForm {
  source_school: string;
  source_course: string;
  source_student_number: string;
  transcript_reference: string;
  entry_year_level: string;
  entry_semester_id: string;
  remarks: string;
}

interface AddSubjectForm {
  source_subject_code: string;
  source_subject_name: string;
  source_units: string;
  source_grade: string;
  source_remarks: string;
  source_academic_year: string;
  source_year_level: string;
  source_semester: string;
}

const EMPTY_CREATE_FORM: CreateEvaluationForm = {
  source_school: "",
  source_course: "",
  source_student_number: "",
  transcript_reference: "",
  entry_year_level: "",
  entry_semester_id: "",
  remarks: "",
};

const EMPTY_ADD_SUBJECT_FORM: AddSubjectForm = {
  source_subject_code: "",
  source_subject_name: "",
  source_units: "",
  source_grade: "",
  source_remarks: "",
  source_academic_year: "",
  source_year_level: "",
  source_semester: "",
};

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
  if (!value) {
    return "—";
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

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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

function getInitials(name: string | null | undefined): string {
  if (!name) {
    return "ST";
  }

  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "ST";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function displayValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "—";
  }

  return String(value);
}

export default function TransferEvaluationR() {
  const navigate = useNavigate();

  const { id } = useParams<{ id: string }>();

  const user = authService.getSession();

  const token = authService.getToken();

  const userRole = user?.role;

  const authenticated = Boolean(user && token);

  const [student, setStudent] = useState<ContextStudent | null>(null);

  const [curriculum, setCurriculum] = useState<ContextCurriculum | null>(null);

  const [curriculumSubjects, setCurriculumSubjects] = useState<
    CurriculumSubject[]
  >([]);

  const [canCreateEvaluation, setCanCreateEvaluation] = useState(false);

  const [evaluations, setEvaluations] = useState<EvaluationListItem[]>([]);

  const [evaluationSummary, setEvaluationSummary] = useState({
    total_evaluations: 0,
    draft: 0,
    submitted: 0,
    returned: 0,
    completed: 0,
    cancelled: 0,
  });

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
    duplicate_mapped_ptc_subject_ids: [] as number[],
    already_reviewed_subjects: 0,
  });

  const [loading, setLoading] = useState(true);

  const [detailLoading, setDetailLoading] = useState(false);

  const [error, setError] = useState("");

  const [detailError, setDetailError] = useState("");

  const [refreshKey, setRefreshKey] = useState(0);

  const [showCreateModal, setShowCreateModal] = useState(false);

  const [createForm, setCreateForm] =
    useState<CreateEvaluationForm>(EMPTY_CREATE_FORM);

  const [createLoading, setCreateLoading] = useState(false);

  const [createError, setCreateError] = useState("");

  const [showAddSubjectModal, setShowAddSubjectModal] = useState(false);

  const [addSubjectForm, setAddSubjectForm] = useState<AddSubjectForm>(
    EMPTY_ADD_SUBJECT_FORM,
  );

  const [addSubjectLoading, setAddSubjectLoading] = useState(false);

  const [addSubjectError, setAddSubjectError] = useState("");

  const [showMapModal, setShowMapModal] = useState(false);

  const [mappingSubject, setMappingSubject] = useState<TransferSubject | null>(
    null,
  );

  const [mapPtcSubjectId, setMapPtcSubjectId] = useState("");

  const [mapLoading, setMapLoading] = useState(false);

  const [mapError, setMapError] = useState("");

  const [showSubmitModal, setShowSubmitModal] = useState(false);

  const [submitLoading, setSubmitLoading] = useState(false);

  const [submitError, setSubmitError] = useState("");

  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    if (userRole !== "Registrar") {
      if (user) {
        navigate(authService.getDashboardRoute(user.role), {
          replace: true,
        });
      } else {
        navigate("/login", {
          replace: true,
        });
      }
    }
  }, [authenticated, userRole, user, navigate]);

  const handleUnauthorized = useCallback(() => {
    authService.logout();

    navigate("/login", {
      replace: true,
    });
  }, [navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") {
      return;
    }

    const studentId = Number(id);

    if (!Number.isInteger(studentId) || studentId <= 0) {
      setError("Invalid student ID.");

      setLoading(false);

      return;
    }

    const controller = new AbortController();

    const loadPage = async () => {
      try {
        setLoading(true);
        setError("");

        const [contextResponse, evaluationsResponse] = await Promise.all([
          authService.authFetch(
            `${API_BASE_URL}/students/${studentId}/context`,
            {
              method: "GET",
              signal: controller.signal,
              headers: {
                Accept: "application/json",
              },
            },
          ),

          authService.authFetch(`${API_BASE_URL}?student_id=${studentId}`, {
            method: "GET",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          }),
        ]);

        const [contextData, evaluationsData] = await Promise.all([
          readJsonResponse<TransferContextResponse>(contextResponse),

          readJsonResponse<EvaluationListResponse>(evaluationsResponse),
        ]);

        if (
          contextResponse.status === 401 ||
          evaluationsResponse.status === 401
        ) {
          handleUnauthorized();

          return;
        }

        if (contextResponse.status === 403) {
          throw new Error(
            contextData.message || "Registrar access is required.",
          );
        }

        if (evaluationsResponse.status === 403) {
          throw new Error(
            evaluationsData.message || "Registrar access is required.",
          );
        }

        if (!contextResponse.ok || !contextData.success) {
          throw new Error(
            contextData.message ||
              contextData.error ||
              "Unable to load transfer evaluation context.",
          );
        }

        if (!evaluationsResponse.ok || !evaluationsData.success) {
          throw new Error(
            evaluationsData.message ||
              evaluationsData.error ||
              "Unable to load transfer evaluations.",
          );
        }

        if (!contextData.student) {
          throw new Error(
            "Student information was not returned by the server.",
          );
        }

        const loadedEvaluations = Array.isArray(evaluationsData.evaluations)
          ? evaluationsData.evaluations
          : [];

        setStudent(contextData.student);

        setCurriculum(contextData.curriculum || null);

        setCurriculumSubjects(
          Array.isArray(contextData.curriculum_subjects)
            ? contextData.curriculum_subjects
            : [],
        );

        setCanCreateEvaluation(Boolean(contextData.can_create_evaluation));

        setEvaluations(loadedEvaluations);

        setEvaluationSummary({
          total_evaluations:
            evaluationsData.summary?.total_evaluations ??
            loadedEvaluations.length,

          draft: evaluationsData.summary?.draft ?? 0,

          submitted: evaluationsData.summary?.submitted ?? 0,

          returned: evaluationsData.summary?.returned ?? 0,

          completed: evaluationsData.summary?.completed ?? 0,

          cancelled: evaluationsData.summary?.cancelled ?? 0,
        });

        setSelectedEvaluationId((currentId) => {
          if (
            currentId &&
            loadedEvaluations.some(
              (evaluation) => evaluation.transfer_evaluation_id === currentId,
            )
          ) {
            return currentId;
          }

          return loadedEvaluations[0]?.transfer_evaluation_id ?? null;
        });
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error(
          "GET REGISTRAR TRANSFER EVALUATION PAGE ERROR:",
          requestError,
        );

        setStudent(null);
        setCurriculum(null);
        setCurriculumSubjects([]);
        setEvaluations([]);
        setSelectedEvaluationId(null);
        setSelectedEvaluation(null);
        setSubjects([]);

        if (requestError instanceof TypeError) {
          setError(
            "Unable to connect to the transfer evaluation server. Make sure the backend is running on port 3000.",
          );

          return;
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load transfer evaluations.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadPage();

    return () => {
      controller.abort();
    };
  }, [id, authenticated, userRole, handleUnauthorized, refreshKey]);

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") {
      return;
    }

    if (!selectedEvaluationId) {
      setSelectedEvaluation(null);
      setSubjects([]);
      setDetailError("");
      setDetailLoading(false);

      return;
    }

    const controller = new AbortController();

    const loadEvaluationDetail = async () => {
      try {
        setDetailLoading(true);
        setDetailError("");

        const response = await authService.authFetch(
          `${API_BASE_URL}/${selectedEvaluationId}`,
          {
            method: "GET",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          },
        );

        const data = await readJsonResponse<EvaluationDetailResponse>(response);

        if (response.status === 401) {
          handleUnauthorized();

          return;
        }

        if (response.status === 403) {
          throw new Error(data.message || "Registrar access is required.");
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
            "Transfer evaluation details were not returned by the server.",
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

          duplicate_mapped_ptc_subject_ids:
            data.summary?.duplicate_mapped_ptc_subject_ids ?? [],

          already_reviewed_subjects:
            data.summary?.already_reviewed_subjects ?? 0,
        });
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error(
          "GET REGISTRAR TRANSFER EVALUATION DETAIL ERROR:",
          requestError,
        );

        setSelectedEvaluation(null);

        setSubjects([]);

        if (requestError instanceof TypeError) {
          setDetailError(
            "Unable to connect to the transfer evaluation server.",
          );

          return;
        }

        setDetailError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load transfer evaluation details.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setDetailLoading(false);
        }
      }
    };

    void loadEvaluationDetail();

    return () => {
      controller.abort();
    };
  }, [
    selectedEvaluationId,
    authenticated,
    userRole,
    handleUnauthorized,
    refreshKey,
  ]);

  const aggregateSubjects = useMemo(() => {
    return evaluations.reduce(
      (totals, evaluation) => {
        totals.total += evaluation.summary.total_subjects;

        totals.mapped += evaluation.summary.mapped_subjects;

        totals.credited += evaluation.summary.credited_subjects;

        totals.notCredited += evaluation.summary.not_credited_subjects;

        return totals;
      },
      {
        total: 0,
        mapped: 0,
        credited: 0,
        notCredited: 0,
      },
    );
  }, [evaluations]);

  const yearLevelOptions = useMemo(() => {
    const totalYears = Number(student?.course.total_years || 0);

    if (Number.isInteger(totalYears) && totalYears > 0) {
      return Array.from(
        {
          length: totalYears,
        },
        (_, index) => index + 1,
      );
    }

    return [1, 2, 3, 4];
  }, [student]);

  const usedPtcSubjectIds = useMemo(() => {
    const ids = new Set<number>();

    subjects.forEach((subject) => {
      if (
        mappingSubject &&
        subject.transfer_subject_id === mappingSubject.transfer_subject_id
      ) {
        return;
      }

      if (subject.proposed_ptc_mapping?.subject_id) {
        ids.add(Number(subject.proposed_ptc_mapping.subject_id));
      }
    });

    return ids;
  }, [subjects, mappingSubject]);

  const selectedMappingTarget = useMemo(() => {
    const targetId = Number(mapPtcSubjectId);

    if (!targetId) {
      return null;
    }

    return (
      curriculumSubjects.find(
        (subject) => Number(subject.subject_id) === targetId,
      ) || null
    );
  }, [curriculumSubjects, mapPtcSubjectId]);

  const canSubmitSelected = useMemo(() => {
    if (!selectedEvaluation) {
      return false;
    }

    if (!["Draft", "Returned"].includes(selectedEvaluation.evaluation_status)) {
      return false;
    }

    if (!selectedEvaluation.workflow.can_submit) {
      return false;
    }

    if (detailSummary.total_subjects < 1) {
      return false;
    }

    if (detailSummary.already_reviewed_subjects > 0) {
      return false;
    }

    if (detailSummary.duplicate_mapped_ptc_subject_ids.length > 0) {
      return false;
    }

    return true;
  }, [selectedEvaluation, detailSummary]);

  const refresh = () => {
    setRefreshKey((current) => current + 1);
  };

  const openCreateModal = () => {
    if (!student || !curriculum || !canCreateEvaluation) {
      return;
    }

    setCreateError("");
    setSuccessMessage("");

    setCreateForm({
      ...EMPTY_CREATE_FORM,
    });

    setShowCreateModal(true);
  };

  const closeCreateModal = () => {
    if (createLoading) {
      return;
    }

    setShowCreateModal(false);
    setCreateError("");

    setCreateForm({
      ...EMPTY_CREATE_FORM,
    });
  };

  const updateCreateField = (
    field: keyof CreateEvaluationForm,
    value: string,
  ) => {
    setCreateForm((current) => ({
      ...current,
      [field]: value,
    }));

    if (createError) {
      setCreateError("");
    }
  };

  const createEvaluation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!student || !curriculum) {
      setCreateError("Student and active curriculum information are required.");

      return;
    }

    const sourceSchool = createForm.source_school.trim();

    if (!sourceSchool) {
      setCreateError("Previous school name is required.");

      return;
    }

    try {
      setCreateLoading(true);

      setCreateError("");
      setSuccessMessage("");

      const response = await authService.authFetch(API_BASE_URL, {
        method: "POST",

        headers: {
          Accept: "application/json",

          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          student_id: student.student_id,

          curriculum_id: curriculum.curriculum_id,

          source_school: sourceSchool,

          source_course: createForm.source_course.trim() || null,

          source_student_number:
            createForm.source_student_number.trim() || null,

          transcript_document_id: null,

          transcript_reference: createForm.transcript_reference.trim() || null,

          entry_year_level: createForm.entry_year_level
            ? Number(createForm.entry_year_level)
            : null,

          entry_semester_id: createForm.entry_semester_id
            ? Number(createForm.entry_semester_id)
            : null,

          remarks: createForm.remarks.trim() || null,
        }),
      });

      const data = await readJsonResponse<CreateEvaluationResponse>(response);

      if (response.status === 401) {
        handleUnauthorized();

        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Unable to create transfer evaluation.",
        );
      }

      const newEvaluationId = data.evaluation?.transfer_evaluation_id;

      if (!newEvaluationId) {
        throw new Error("The server did not return a valid evaluation ID.");
      }

      setShowCreateModal(false);

      setCreateForm({
        ...EMPTY_CREATE_FORM,
      });

      setSelectedEvaluationId(Number(newEvaluationId));

      setSuccessMessage(
        `Transfer Evaluation #${newEvaluationId} was created successfully as Draft.`,
      );

      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      setCreateError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to create transfer evaluation.",
      );
    } finally {
      setCreateLoading(false);
    }
  };

  const openAddSubjectModal = () => {
    if (!selectedEvaluation || !selectedEvaluation.workflow.editable) {
      return;
    }

    setAddSubjectError("");
    setSuccessMessage("");

    setAddSubjectForm({
      ...EMPTY_ADD_SUBJECT_FORM,
    });

    setShowAddSubjectModal(true);
  };

  const closeAddSubjectModal = () => {
    if (addSubjectLoading) {
      return;
    }

    setShowAddSubjectModal(false);

    setAddSubjectError("");

    setAddSubjectForm({
      ...EMPTY_ADD_SUBJECT_FORM,
    });
  };

  const updateAddSubjectField = (
    field: keyof AddSubjectForm,
    value: string,
  ) => {
    setAddSubjectForm((current) => ({
      ...current,
      [field]: value,
    }));

    if (addSubjectError) {
      setAddSubjectError("");
    }
  };

  const addPreviousSchoolSubject = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    if (!selectedEvaluation) {
      setAddSubjectError("Select a transfer evaluation first.");

      return;
    }

    const subjectName = addSubjectForm.source_subject_name.trim();

    if (!subjectName) {
      setAddSubjectError("Previous-school subject name is required.");

      return;
    }

    try {
      setAddSubjectLoading(true);

      setAddSubjectError("");
      setSuccessMessage("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${selectedEvaluation.transfer_evaluation_id}/subjects`,
        {
          method: "POST",

          headers: {
            Accept: "application/json",

            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            source_subject_code:
              addSubjectForm.source_subject_code.trim() || null,

            source_subject_name: subjectName,

            source_units:
              addSubjectForm.source_units !== ""
                ? Number(addSubjectForm.source_units)
                : null,

            source_grade: addSubjectForm.source_grade.trim() || null,

            source_remarks: addSubjectForm.source_remarks.trim() || null,

            source_academic_year:
              addSubjectForm.source_academic_year.trim() || null,

            source_year_level:
              addSubjectForm.source_year_level !== ""
                ? Number(addSubjectForm.source_year_level)
                : null,

            source_semester: addSubjectForm.source_semester.trim() || null,
          }),
        },
      );

      const data = await readJsonResponse<AddTransferSubjectResponse>(response);

      if (response.status === 401) {
        handleUnauthorized();

        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
            data.error ||
            "Unable to add previous-school subject.",
        );
      }

      setShowAddSubjectModal(false);

      setAddSubjectForm({
        ...EMPTY_ADD_SUBJECT_FORM,
      });

      setSuccessMessage("Previous-school subject added successfully.");

      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      setAddSubjectError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to add previous-school subject.",
      );
    } finally {
      setAddSubjectLoading(false);
    }
  };

  const openMapModal = (subject: TransferSubject) => {
    if (
      !selectedEvaluation ||
      !selectedEvaluation.workflow.editable ||
      !subject.editable ||
      subject.decision.credit_status !== "Pending"
    ) {
      return;
    }

    setMapError("");
    setSuccessMessage("");

    setMappingSubject(subject);

    setMapPtcSubjectId(
      subject.proposed_ptc_mapping?.subject_id
        ? String(subject.proposed_ptc_mapping.subject_id)
        : "",
    );

    setShowMapModal(true);
  };

  const closeMapModal = () => {
    if (mapLoading) {
      return;
    }

    setShowMapModal(false);
    setMappingSubject(null);
    setMapPtcSubjectId("");
    setMapError("");
  };

  const mapPtcSubject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedEvaluation || !mappingSubject) {
      setMapError("Select a previous-school subject first.");

      return;
    }

    const targetId = Number(mapPtcSubjectId);

    if (!Number.isInteger(targetId) || targetId <= 0) {
      setMapError("Select a valid PTC curriculum subject.");

      return;
    }

    const target = curriculumSubjects.find(
      (subject) => Number(subject.subject_id) === targetId,
    );

    if (!target) {
      setMapError("The selected PTC subject is not part of this curriculum.");

      return;
    }

    if (usedPtcSubjectIds.has(targetId)) {
      setMapError(
        "Another previous-school subject is already mapped to this PTC subject.",
      );

      return;
    }

    try {
      setMapLoading(true);
      setMapError("");
      setSuccessMessage("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${selectedEvaluation.transfer_evaluation_id}/subjects/${mappingSubject.transfer_subject_id}/map`,
        {
          method: "PATCH",

          headers: {
            Accept: "application/json",

            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            ptc_subject_id: targetId,
          }),
        },
      );

      const data = await readJsonResponse<MapTransferSubjectResponse>(response);

      if (response.status === 401) {
        handleUnauthorized();

        return;
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Unable to map the PTC subject.",
        );
      }

      setShowMapModal(false);
      setMappingSubject(null);
      setMapPtcSubjectId("");
      setMapError("");

      setSuccessMessage(
        data.message || "PTC subject mapping saved successfully.",
      );

      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      setMapError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to map the PTC subject.",
      );
    } finally {
      setMapLoading(false);
    }
  };

  const openSubmitModal = () => {
    if (!selectedEvaluation || !canSubmitSelected) {
      return;
    }

    setSubmitError("");
    setSuccessMessage("");
    setShowSubmitModal(true);
  };

  const closeSubmitModal = () => {
    if (submitLoading) {
      return;
    }

    setShowSubmitModal(false);
    setSubmitError("");
  };

  const submitEvaluation = async () => {
    if (!selectedEvaluation) {
      setSubmitError("No transfer evaluation is selected.");

      return;
    }

    if (!canSubmitSelected) {
      setSubmitError("This transfer evaluation is not ready for submission.");

      return;
    }

    try {
      setSubmitLoading(true);
      setSubmitError("");
      setSuccessMessage("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${selectedEvaluation.transfer_evaluation_id}/submit`,
        {
          method: "POST",

          headers: {
            Accept: "application/json",
          },
        },
      );

      const data =
        await readJsonResponse<SubmitTransferEvaluationResponse>(response);

      if (response.status === 401) {
        handleUnauthorized();

        return;
      }

      if (response.status === 403) {
        throw new Error(data.message || "Registrar access is required.");
      }

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Unable to submit transfer evaluation.",
        );
      }

      setShowSubmitModal(false);

      setSubmitError("");

      setSuccessMessage(
        data.message ||
          "Transfer evaluation submitted to the Program Head successfully.",
      );

      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      console.error("SUBMIT TRANSFER EVALUATION ERROR:", requestError);

      if (requestError instanceof TypeError) {
        setSubmitError("Unable to connect to the transfer evaluation server.");

        return;
      }

      setSubmitError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to submit transfer evaluation.",
      );
    } finally {
      setSubmitLoading(false);
    }
  };

  const studentId = Number(id);

  if (!authenticated || !user || userRole !== "Registrar") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="registrar-transfer-page">
        <section className="registrar-transfer-topbar">
          <button
            type="button"
            className="registrar-transfer-back"
            onClick={() => navigate(`/registrar/student/DetailsR/${studentId}`)}
          >
            <ArrowLeft size={16} />
            Back to Student
          </button>

          <button
            type="button"
            className="registrar-transfer-refresh"
            onClick={refresh}
            disabled={
              loading ||
              detailLoading ||
              createLoading ||
              addSubjectLoading ||
              mapLoading ||
              submitLoading
            }
          >
            <RefreshCw
              size={15}
              className={loading || detailLoading ? "is-spinning" : ""}
            />
            Refresh
          </button>
        </section>

        <section className="registrar-transfer-heading">
          <div>
            <span className="registrar-transfer-eyebrow">
              Registrar • Student Records
            </span>

            <h1>Transfer Evaluation</h1>

            <p>
              Review previous-school academic records, proposed PTC curriculum
              mappings, and Program Head transfer-credit decisions.
            </p>
          </div>

          <div className="registrar-transfer-heading-mark">
            <FileText size={23} />
          </div>
        </section>

        <section className="registrar-transfer-rule">
          <div className="registrar-transfer-rule-mark">✓</div>

          <div>
            <strong>Transfer Credit Academic Rule</strong>

            <p>
              Previous-school grades remain source information. They are never
              converted into PTC Final Ratings. Only a Completed evaluation with
              a subject decision of Credited becomes an official transfer
              credit.
            </p>
          </div>
        </section>

        {successMessage && (
          <section className="registrar-transfer-success">
            <div>
              <strong>Transfer evaluation updated</strong>

              <p>{successMessage}</p>
            </div>

            <button type="button" onClick={() => setSuccessMessage("")}>
              <X size={15} />
            </button>
          </section>
        )}

        {error && (
          <section className="registrar-transfer-error">
            <div>
              <strong>Transfer evaluation could not be loaded</strong>

              <p>{error}</p>
            </div>

            <button type="button" onClick={refresh}>
              Try Again
            </button>
          </section>
        )}

        {loading && !error && (
          <section className="registrar-transfer-loading">
            <LoaderCircle size={24} className="registrar-transfer-spinner" />

            <div>
              <strong>Loading Transfer Evaluation</strong>

              <span>
                Retrieving student curriculum, evaluation history, and transfer
                records...
              </span>
            </div>
          </section>
        )}

        {!loading && !error && student && (
          <>
            <section className="registrar-transfer-identity">
              <div className="registrar-transfer-student">
                <div className="registrar-transfer-avatar">
                  {getInitials(student.student_name)}
                </div>

                <div className="registrar-transfer-student-copy">
                  <span>Student Transfer Record</span>

                  <div className="registrar-transfer-name-row">
                    <h2>{student.student_name}</h2>

                    <span
                      className={`registrar-transfer-student-status ${getStatusClass(
                        student.status,
                      )}`}
                    >
                      {student.status || "Unknown"}
                    </span>
                  </div>

                  <p>{student.student_number}</p>
                </div>
              </div>

              <div className="registrar-transfer-identity-grid">
                <div>
                  <span>Program</span>

                  <strong>{student.course.course_code || "—"}</strong>

                  <small>{student.course.course_name || "No course"}</small>
                </div>

                <div>
                  <span>Current Year</span>

                  <strong>
                    {student.year_level ? `Year ${student.year_level}` : "—"}
                  </strong>

                  <small>Student profile</small>
                </div>

                <div>
                  <span>Active Curriculum</span>

                  <strong>
                    {curriculum ? curriculum.curriculum_name : "Not assigned"}
                  </strong>

                  <small>
                    {curriculum?.effective_year
                      ? `Effective ${curriculum.effective_year}`
                      : "No effective year"}
                  </small>
                </div>

                <div>
                  <span>Curriculum Subjects</span>

                  <strong>{curriculumSubjects.length}</strong>

                  <small>Available mapping choices</small>
                </div>
              </div>
            </section>

            <section className="registrar-transfer-summary">
              <article>
                <span>Total Evaluations</span>

                <strong>{evaluationSummary.total_evaluations}</strong>

                <small>Transfer review records</small>
              </article>

              <article className="is-review">
                <span>For Review</span>

                <strong>{evaluationSummary.submitted}</strong>

                <small>Submitted to Program Head</small>
              </article>

              <article className="is-returned">
                <span>Returned</span>

                <strong>{evaluationSummary.returned}</strong>

                <small>Needs Registrar correction</small>
              </article>

              <article className="is-completed">
                <span>Completed</span>

                <strong>{evaluationSummary.completed}</strong>

                <small>Finished evaluations</small>
              </article>

              <article className="is-credited">
                <span>Credited Subjects</span>

                <strong>{aggregateSubjects.credited}</strong>

                <small>Official transfer credits</small>
              </article>
            </section>

            <section className="registrar-transfer-workspace">
              <aside className="registrar-transfer-history">
                <div className="registrar-transfer-section-heading">
                  <div>
                    <span>Evaluation History</span>

                    <h3>Transfer Evaluations</h3>
                  </div>

                  <strong>{evaluations.length}</strong>
                </div>

                <div className="registrar-transfer-readiness">
                  <span>Curriculum status</span>

                  <strong
                    className={canCreateEvaluation ? "is-ready" : "is-blocked"}
                  >
                    {canCreateEvaluation ? "Ready" : "Needs Attention"}
                  </strong>
                </div>

                <div className="registrar-transfer-create-area">
                  <button
                    type="button"
                    className="registrar-transfer-create-btn"
                    onClick={openCreateModal}
                    disabled={!canCreateEvaluation || !curriculum}
                  >
                    <Plus size={15} />
                    Create Transfer Evaluation
                  </button>
                </div>

                <div className="registrar-transfer-history-list">
                  {evaluations.map((evaluation) => (
                    <button
                      key={evaluation.transfer_evaluation_id}
                      type="button"
                      className={`registrar-transfer-history-item ${
                        selectedEvaluationId ===
                        evaluation.transfer_evaluation_id
                          ? "selected"
                          : ""
                      }`}
                      onClick={() =>
                        setSelectedEvaluationId(
                          evaluation.transfer_evaluation_id,
                        )
                      }
                    >
                      <div className="registrar-transfer-history-top">
                        <div>
                          <span>
                            Evaluation #{evaluation.transfer_evaluation_id}
                          </span>

                          <strong>{evaluation.source.school}</strong>
                        </div>

                        <span
                          className={`registrar-transfer-status ${getStatusClass(
                            evaluation.evaluation_status,
                          )}`}
                        >
                          {evaluation.evaluation_status}
                        </span>
                      </div>

                      <p>
                        {evaluation.source.course ||
                          "Previous course not recorded"}
                      </p>

                      <div className="registrar-transfer-history-meta">
                        <span>
                          {evaluation.summary.total_subjects} subjects
                        </span>

                        <span>{evaluation.summary.mapped_subjects} mapped</span>

                        <span>Updated {formatDate(evaluation.updated_at)}</span>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="registrar-transfer-history-footer">
                  <div>
                    <span>Total Subjects</span>

                    <strong>{aggregateSubjects.total}</strong>
                  </div>

                  <div>
                    <span>Mapped</span>

                    <strong>{aggregateSubjects.mapped}</strong>
                  </div>

                  <div>
                    <span>Not Credited</span>

                    <strong>{aggregateSubjects.notCredited}</strong>
                  </div>
                </div>
              </aside>

              <section className="registrar-transfer-detail">
                {!selectedEvaluationId && (
                  <div className="registrar-transfer-detail-empty">
                    <UserRound size={30} />

                    <strong>No evaluation selected</strong>
                  </div>
                )}

                {detailLoading && (
                  <div className="registrar-transfer-detail-loading">
                    <LoaderCircle
                      size={24}
                      className="registrar-transfer-spinner"
                    />

                    <div>
                      <strong>Loading evaluation</strong>

                      <span>Retrieving transcript subjects...</span>
                    </div>
                  </div>
                )}

                {!detailLoading && detailError && (
                  <div className="registrar-transfer-detail-error">
                    <strong>Evaluation details could not be loaded</strong>

                    <p>{detailError}</p>

                    <button type="button" onClick={refresh}>
                      Try Again
                    </button>
                  </div>
                )}

                {!detailLoading && !detailError && selectedEvaluation && (
                  <>
                    <div className="registrar-transfer-detail-header">
                      <div>
                        <span>Selected Evaluation</span>

                        <div className="registrar-transfer-detail-title">
                          <h3>{selectedEvaluation.source.school}</h3>

                          <span
                            className={`registrar-transfer-status ${getStatusClass(
                              selectedEvaluation.evaluation_status,
                            )}`}
                          >
                            {selectedEvaluation.evaluation_status}
                          </span>
                        </div>

                        <p>
                          Evaluation #
                          {selectedEvaluation.transfer_evaluation_id}
                        </p>
                      </div>

                      <div className="registrar-transfer-detail-id">
                        <span>Evaluation ID</span>

                        <strong>
                          #{selectedEvaluation.transfer_evaluation_id}
                        </strong>
                      </div>
                    </div>

                    <div className="registrar-transfer-source-grid">
                      <div>
                        <span>Previous School</span>

                        <strong>{selectedEvaluation.source.school}</strong>
                      </div>

                      <div>
                        <span>Previous Course</span>

                        <strong>
                          {displayValue(selectedEvaluation.source.course)}
                        </strong>
                      </div>

                      <div>
                        <span>Previous Student No.</span>

                        <strong>
                          {displayValue(
                            selectedEvaluation.source.student_number,
                          )}
                        </strong>
                      </div>

                      <div>
                        <span>Transcript Reference</span>

                        <strong>
                          {displayValue(
                            selectedEvaluation.source.transcript_reference,
                          )}
                        </strong>
                      </div>

                      <div>
                        <span>PTC Entry Year</span>

                        <strong>
                          {selectedEvaluation.ptc_entry.year_level
                            ? `Year ${selectedEvaluation.ptc_entry.year_level}`
                            : "—"}
                        </strong>
                      </div>

                      <div>
                        <span>Entry Semester</span>

                        <strong>
                          {displayValue(
                            selectedEvaluation.ptc_entry.semester_name,
                          )}
                        </strong>
                      </div>
                    </div>

                    <div className="registrar-transfer-workflow">
                      <div>
                        <span>Created By</span>

                        <strong>
                          {displayValue(
                            selectedEvaluation.workflow.created_by_username,
                          )}
                        </strong>

                        <small>
                          {formatDateTime(selectedEvaluation.created_at)}
                        </small>
                      </div>

                      <div>
                        <span>Submitted By</span>

                        <strong>
                          {displayValue(
                            selectedEvaluation.workflow.submitted_by_username,
                          )}
                        </strong>

                        <small>
                          {formatDateTime(
                            selectedEvaluation.workflow.submitted_at,
                          )}
                        </small>
                      </div>

                      <div>
                        <span>Reviewed By</span>

                        <strong>
                          {displayValue(
                            selectedEvaluation.workflow.reviewed_by_username,
                          )}
                        </strong>

                        <small>
                          {formatDateTime(
                            selectedEvaluation.workflow.reviewed_at,
                          )}
                        </small>
                      </div>

                      <div>
                        <span>Access</span>

                        <strong>
                          {selectedEvaluation.workflow.read_only
                            ? "Read Only"
                            : "Editable"}
                        </strong>

                        <small>{selectedEvaluation.workflow.status}</small>
                      </div>
                    </div>

                    <div className="registrar-transfer-detail-summary">
                      <div>
                        <span>Subjects</span>

                        <strong>{detailSummary.total_subjects}</strong>
                      </div>

                      <div>
                        <span>Mapped</span>

                        <strong>{detailSummary.mapped_subjects}</strong>
                      </div>

                      <div>
                        <span>Pending</span>

                        <strong>{detailSummary.pending_subjects}</strong>
                      </div>

                      <div className="is-credited">
                        <span>Credited</span>

                        <strong>{detailSummary.credited_subjects}</strong>
                      </div>

                      <div className="is-not-credited">
                        <span>Not Credited</span>

                        <strong>{detailSummary.not_credited_subjects}</strong>
                      </div>
                    </div>

                    {["Draft", "Returned"].includes(
                      selectedEvaluation.evaluation_status,
                    ) && (
                      <div className="registrar-transfer-submit-bar">
                        <div>
                          <span>Registrar Workflow</span>

                          <strong>
                            {canSubmitSelected
                              ? "Ready for Program Head Review"
                              : "Not Ready for Submission"}
                          </strong>

                          <p>
                            {detailSummary.total_subjects === 0
                              ? "Encode at least one previous-school subject."
                              : detailSummary.already_reviewed_subjects > 0
                                ? "Reviewed subject decisions must be reset before resubmission."
                                : detailSummary.duplicate_mapped_ptc_subject_ids
                                      .length > 0
                                  ? "Resolve duplicate PTC mappings first."
                                  : `${detailSummary.mapped_subjects} mapped and ${detailSummary.unmapped_subjects} unmapped subject(s).`}
                          </p>
                        </div>

                        <button
                          type="button"
                          className="registrar-transfer-submit-btn"
                          onClick={openSubmitModal}
                          disabled={!canSubmitSelected || submitLoading}
                        >
                          <Send size={15} />
                          Submit to Program Head
                        </button>
                      </div>
                    )}

                    <div className="registrar-transfer-subjects-heading">
                      <div>
                        <span>Transcript Evaluation</span>

                        <h4>Previous-School Subjects</h4>
                      </div>

                      <div className="registrar-transfer-subject-heading-actions">
                        <strong>{subjects.length} subject(s)</strong>

                        {selectedEvaluation.workflow.editable && (
                          <button
                            type="button"
                            className="registrar-transfer-add-subject-btn"
                            onClick={openAddSubjectModal}
                          >
                            <Plus size={14} />
                            Add Previous-School Subject
                          </button>
                        )}
                      </div>
                    </div>

                    {subjects.length === 0 ? (
                      <div className="registrar-transfer-no-subjects">
                        No transcript subjects.
                      </div>
                    ) : (
                      <div className="registrar-transfer-table-wrapper">
                        <table className="registrar-transfer-table">
                          <thead>
                            <tr>
                              <th>Previous-School Subject</th>

                              <th>Source Information</th>

                              <th>Proposed PTC Equivalent</th>

                              <th>Decision</th>

                              <th>Credited Units</th>

                              <th>Action</th>
                            </tr>
                          </thead>

                          <tbody>
                            {subjects.map((subject) => {
                              const canMap =
                                selectedEvaluation.workflow.editable &&
                                subject.editable &&
                                subject.decision.credit_status === "Pending";

                              return (
                                <tr key={subject.transfer_subject_id}>
                                  <td>
                                    <div className="registrar-transfer-source-subject">
                                      <span>
                                        {subject.source.subject_code ||
                                          "No Code"}
                                      </span>

                                      <strong>
                                        {subject.source.subject_name}
                                      </strong>

                                      <small>
                                        {displayValue(subject.source.units)}{" "}
                                        source units
                                      </small>
                                    </div>
                                  </td>

                                  <td>
                                    <div className="registrar-transfer-source-info">
                                      <div className="registrar-transfer-source-grade">
                                        <span>Source Grade</span>

                                        <strong>
                                          {displayValue(subject.source.grade)}
                                        </strong>
                                      </div>

                                      <small>
                                        {subject.source.academic_year || "AY —"}
                                      </small>

                                      <small>
                                        {subject.source.year_level
                                          ? `Year ${subject.source.year_level}`
                                          : "Year —"}
                                        {" • "}
                                        {subject.source.semester ||
                                          "Semester —"}
                                      </small>
                                    </div>
                                  </td>

                                  <td>
                                    {subject.proposed_ptc_mapping ? (
                                      <div className="registrar-transfer-mapping">
                                        <span>
                                          {
                                            subject.proposed_ptc_mapping
                                              .subject_code
                                          }
                                        </span>

                                        <strong>
                                          {
                                            subject.proposed_ptc_mapping
                                              .subject_name
                                          }
                                        </strong>

                                        <small>
                                          {displayValue(
                                            subject.proposed_ptc_mapping.units,
                                          )}{" "}
                                          PTC units
                                        </small>
                                      </div>
                                    ) : (
                                      <span className="registrar-transfer-unmapped">
                                        Not Mapped
                                      </span>
                                    )}
                                  </td>

                                  <td>
                                    <span
                                      className={`registrar-transfer-credit-status ${getStatusClass(
                                        subject.decision.credit_status,
                                      )}`}
                                    >
                                      {subject.decision.credit_status}
                                    </span>
                                  </td>

                                  <td>
                                    <strong className="registrar-transfer-credited-units">
                                      {displayValue(
                                        subject.decision.credited_units,
                                      )}
                                    </strong>
                                  </td>

                                  <td>
                                    {canMap ? (
                                      <button
                                        type="button"
                                        className="registrar-transfer-map-btn"
                                        onClick={() => openMapModal(subject)}
                                      >
                                        <Link2 size={13} />

                                        {subject.proposed_ptc_mapping
                                          ? "Change Mapping"
                                          : "Map PTC Subject"}
                                      </button>
                                    ) : (
                                      <span className="registrar-transfer-action-locked">
                                        Locked
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="registrar-transfer-source-warning">
                      <strong>Source Grade ≠ PTC Final Rating</strong>

                      <p>
                        Mapping does not grant transfer credit. Program Head
                        review is still required.
                      </p>
                    </div>
                  </>
                )}
              </section>
            </section>
          </>
        )}

        {showSubmitModal && selectedEvaluation && (
          <div className="registrar-transfer-modal-backdrop">
            <div className="registrar-transfer-modal registrar-transfer-submit-modal">
              <div className="registrar-transfer-modal-header">
                <div>
                  <span>Academic Review Submission</span>

                  <h2>Submit to Program Head?</h2>

                  <p>
                    Evaluation #{selectedEvaluation.transfer_evaluation_id}
                    {" • "}
                    {selectedEvaluation.source.school}
                  </p>
                </div>

                <button
                  type="button"
                  className="registrar-transfer-modal-close"
                  onClick={closeSubmitModal}
                  disabled={submitLoading}
                >
                  <X size={18} />
                </button>
              </div>

              <div className="registrar-transfer-submit-summary">
                <div>
                  <span>Total Subjects</span>

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
              </div>

              <div className="registrar-transfer-submit-content">
                {submitError && (
                  <div className="registrar-transfer-form-error">
                    <strong>Submission failed</strong>

                    <p>{submitError}</p>
                  </div>
                )}

                {detailSummary.unmapped_subjects > 0 && (
                  <div className="registrar-transfer-submit-warning">
                    <strong>Unmapped subjects are included</strong>

                    <p>
                      This is allowed. The Program Head may review an unmapped
                      previous-school subject and mark it Not Credited when
                      there is no valid PTC equivalent.
                    </p>
                  </div>
                )}

                <div className="registrar-transfer-submit-rule">
                  <strong>What happens next?</strong>

                  <p>
                    The evaluation becomes Submitted and all Registrar
                    editing/mapping actions become locked. The Program Head will
                    make the academic Credited or Not Credited decisions.
                  </p>
                </div>

                <div className="registrar-transfer-modal-actions">
                  <button
                    type="button"
                    className="registrar-transfer-modal-cancel"
                    onClick={closeSubmitModal}
                    disabled={submitLoading}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    className="registrar-transfer-modal-submit"
                    onClick={submitEvaluation}
                    disabled={submitLoading}
                  >
                    {submitLoading ? (
                      <>
                        <LoaderCircle
                          size={15}
                          className="registrar-transfer-spinner"
                        />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <Send size={15} />
                        Confirm Submission
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showMapModal && mappingSubject && (
          <div className="registrar-transfer-modal-backdrop">
            <div className="registrar-transfer-modal">
              <div className="registrar-transfer-modal-header">
                <div>
                  <span>PTC Equivalency</span>

                  <h2>Map PTC Subject</h2>

                  <p>
                    {mappingSubject.source.subject_code || "Previous Subject"} —{" "}
                    {mappingSubject.source.subject_name}
                  </p>
                </div>

                <button
                  type="button"
                  className="registrar-transfer-modal-close"
                  onClick={closeMapModal}
                >
                  <X size={18} />
                </button>
              </div>

              <form
                className="registrar-transfer-create-form"
                onSubmit={mapPtcSubject}
              >
                {mapError && (
                  <div className="registrar-transfer-form-error">
                    <strong>Mapping failed</strong>

                    <p>{mapError}</p>
                  </div>
                )}

                <div className="registrar-transfer-form-field">
                  <label>
                    PTC Curriculum Subject
                    <span>*</span>
                  </label>

                  <select
                    value={mapPtcSubjectId}
                    onChange={(event) => setMapPtcSubjectId(event.target.value)}
                  >
                    <option value="">Select PTC subject</option>

                    {curriculumSubjects.map((subject) => (
                      <option
                        key={subject.curriculum_subject_id}
                        value={subject.subject_id}
                        disabled={
                          usedPtcSubjectIds.has(Number(subject.subject_id)) ||
                          !subject.is_active
                        }
                      >
                        {subject.subject_code} — {subject.subject_name} •{" "}
                        {subject.units} units
                      </option>
                    ))}
                  </select>
                </div>

                {selectedMappingTarget && (
                  <div className="registrar-transfer-map-preview">
                    <span>Selected Equivalent</span>

                    <strong>
                      {selectedMappingTarget.subject_code} —{" "}
                      {selectedMappingTarget.subject_name}
                    </strong>
                  </div>
                )}

                <div className="registrar-transfer-create-note">
                  <strong>Mapping only</strong>

                  <p>Credit status remains Pending.</p>
                </div>

                <div className="registrar-transfer-modal-actions">
                  <button
                    type="button"
                    className="registrar-transfer-modal-cancel"
                    onClick={closeMapModal}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="registrar-transfer-modal-submit"
                    disabled={mapLoading || !mapPtcSubjectId}
                  >
                    Save PTC Mapping
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showAddSubjectModal && (
          <div className="registrar-transfer-modal-backdrop">
            <div className="registrar-transfer-modal">
              <div className="registrar-transfer-modal-header">
                <div>
                  <span>Raw Transcript Entry</span>

                  <h2>Add Previous-School Subject</h2>
                </div>

                <button
                  type="button"
                  className="registrar-transfer-modal-close"
                  onClick={closeAddSubjectModal}
                >
                  <X size={18} />
                </button>
              </div>

              <form
                className="registrar-transfer-create-form"
                onSubmit={addPreviousSchoolSubject}
              >
                {addSubjectError && (
                  <div className="registrar-transfer-form-error">
                    <p>{addSubjectError}</p>
                  </div>
                )}

                <div className="registrar-transfer-form-grid">
                  <div className="registrar-transfer-form-field">
                    <label>Subject Code</label>

                    <input
                      value={addSubjectForm.source_subject_code}
                      onChange={(event) =>
                        updateAddSubjectField(
                          "source_subject_code",
                          event.target.value,
                        )
                      }
                    />
                  </div>

                  <div className="registrar-transfer-form-field">
                    <label>Source Units</label>

                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={addSubjectForm.source_units}
                      onChange={(event) =>
                        updateAddSubjectField(
                          "source_units",
                          event.target.value,
                        )
                      }
                    />
                  </div>

                  <div className="registrar-transfer-form-field registrar-transfer-form-wide">
                    <label>
                      Subject Name
                      <span>*</span>
                    </label>

                    <input
                      required
                      value={addSubjectForm.source_subject_name}
                      onChange={(event) =>
                        updateAddSubjectField(
                          "source_subject_name",
                          event.target.value,
                        )
                      }
                    />
                  </div>

                  <div className="registrar-transfer-form-field">
                    <label>Source Grade</label>

                    <input
                      value={addSubjectForm.source_grade}
                      onChange={(event) =>
                        updateAddSubjectField(
                          "source_grade",
                          event.target.value,
                        )
                      }
                    />
                  </div>

                  <div className="registrar-transfer-form-field">
                    <label>Academic Year</label>

                    <input
                      value={addSubjectForm.source_academic_year}
                      onChange={(event) =>
                        updateAddSubjectField(
                          "source_academic_year",
                          event.target.value,
                        )
                      }
                    />
                  </div>

                  <div className="registrar-transfer-form-field">
                    <label>Source Year Level</label>

                    <input
                      type="number"
                      min="1"
                      value={addSubjectForm.source_year_level}
                      onChange={(event) =>
                        updateAddSubjectField(
                          "source_year_level",
                          event.target.value,
                        )
                      }
                    />
                  </div>

                  <div className="registrar-transfer-form-field">
                    <label>Source Semester</label>

                    <input
                      value={addSubjectForm.source_semester}
                      onChange={(event) =>
                        updateAddSubjectField(
                          "source_semester",
                          event.target.value,
                        )
                      }
                    />
                  </div>

                  <div className="registrar-transfer-form-field registrar-transfer-form-wide">
                    <label>Source Remarks</label>

                    <textarea
                      rows={3}
                      value={addSubjectForm.source_remarks}
                      onChange={(event) =>
                        updateAddSubjectField(
                          "source_remarks",
                          event.target.value,
                        )
                      }
                    />
                  </div>
                </div>

                <div className="registrar-transfer-modal-actions">
                  <button
                    type="button"
                    className="registrar-transfer-modal-cancel"
                    onClick={closeAddSubjectModal}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="registrar-transfer-modal-submit"
                    disabled={addSubjectLoading}
                  >
                    Add Subject
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showCreateModal && student && curriculum && (
          <div className="registrar-transfer-modal-backdrop">
            <div className="registrar-transfer-modal">
              <div className="registrar-transfer-modal-header">
                <div>
                  <span>New Transfer Record</span>

                  <h2>Create Transfer Evaluation</h2>
                </div>

                <button
                  type="button"
                  className="registrar-transfer-modal-close"
                  onClick={closeCreateModal}
                >
                  <X size={18} />
                </button>
              </div>

              <form
                className="registrar-transfer-create-form"
                onSubmit={createEvaluation}
              >
                {createError && (
                  <div className="registrar-transfer-form-error">
                    <p>{createError}</p>
                  </div>
                )}

                <div className="registrar-transfer-form-grid">
                  <div className="registrar-transfer-form-field registrar-transfer-form-wide">
                    <label>
                      Previous School
                      <span>*</span>
                    </label>

                    <input
                      required
                      value={createForm.source_school}
                      onChange={(event) =>
                        updateCreateField("source_school", event.target.value)
                      }
                    />
                  </div>

                  <div className="registrar-transfer-form-field registrar-transfer-form-wide">
                    <label>Previous Course</label>

                    <input
                      value={createForm.source_course}
                      onChange={(event) =>
                        updateCreateField("source_course", event.target.value)
                      }
                    />
                  </div>

                  <div className="registrar-transfer-form-field">
                    <label>Previous Student No.</label>

                    <input
                      value={createForm.source_student_number}
                      onChange={(event) =>
                        updateCreateField(
                          "source_student_number",
                          event.target.value,
                        )
                      }
                    />
                  </div>

                  <div className="registrar-transfer-form-field">
                    <label>Transcript Reference</label>

                    <input
                      value={createForm.transcript_reference}
                      onChange={(event) =>
                        updateCreateField(
                          "transcript_reference",
                          event.target.value,
                        )
                      }
                    />
                  </div>

                  <div className="registrar-transfer-form-field">
                    <label>PTC Entry Year</label>

                    <select
                      value={createForm.entry_year_level}
                      onChange={(event) =>
                        updateCreateField(
                          "entry_year_level",
                          event.target.value,
                        )
                      }
                    >
                      <option value="">Not specified</option>

                      {yearLevelOptions.map((year) => (
                        <option key={year} value={year}>
                          Year {year}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="registrar-transfer-form-field">
                    <label>PTC Entry Semester</label>

                    <select
                      value={createForm.entry_semester_id}
                      onChange={(event) =>
                        updateCreateField(
                          "entry_semester_id",
                          event.target.value,
                        )
                      }
                    >
                      <option value="">Not specified</option>

                      <option value="1">First Semester</option>

                      <option value="2">Second Semester</option>
                    </select>
                  </div>

                  <div className="registrar-transfer-form-field registrar-transfer-form-wide">
                    <label>Remarks</label>

                    <textarea
                      rows={4}
                      value={createForm.remarks}
                      onChange={(event) =>
                        updateCreateField("remarks", event.target.value)
                      }
                    />
                  </div>
                </div>

                <div className="registrar-transfer-modal-actions">
                  <button
                    type="button"
                    className="registrar-transfer-modal-cancel"
                    onClick={closeCreateModal}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="registrar-transfer-modal-submit"
                    disabled={createLoading}
                  >
                    Create Draft Evaluation
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}
