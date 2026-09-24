import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  Clock3,
  FilePenLine,
  Filter,
  GraduationCap,
  MapPin,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";

import "../../../styles/EnterGrades.css";

const API_BASE_URL = apiUrl("/api/faculty/classes");

type GradeStatus = "Draft" | "Submitted" | "Returned" | "Approved";

type GradeRemark = "Passed" | "Failed" | "Incomplete" | "Unofficial Drop";

type GradeOutcome = "NUMERIC" | "INCOMPLETE" | "UNOFFICIAL_DROP";

interface FacultyInfo {
  faculty_id: number;
  employee_number: string;
  faculty_name: string;
}

interface FacultyClass {
  offering_id: number;
  section_subject_id: number;

  offering_status: string;
  section_subject_status: string;

  subject: {
    subject_id: number;
    subject_code: string;
    subject_name: string;
    units: number;
    lecture_hours: number;
    laboratory_hours: number;
  };

  section: {
    section_id: number;
    section_name: string;
    year_level: number;

    course: {
      course_id: number;
      course_code: string;
      course_name: string;
    };
  };

  academic_period: {
    academic_year_id: number;
    academic_year: string;
    is_current_academic_year: boolean;

    semester_id: number;
    semester_name: string;
  };

  schedule: {
    days: string | null;
    time: string | null;
  };

  room: {
    room_id: number;
    room_code?: string | null;
    room_name?: string | null;
  } | null;

  capacity?: {
    max_students: number;
    official_students: number;
  };

  created_at?: string;
}

interface FacultyClassesResponse {
  success: boolean;

  faculty?: FacultyInfo;

  summary?: {
    total_classes: number;
    open_classes: number;
    closed_classes: number;
    total_official_students: number;
  };

  classes?: FacultyClass[];

  message?: string;
  error?: string;
}

interface GradeReview {
  reviewed_by: number | null;
  reviewed_by_username: string | null;
  reviewed_at: string | null;
  review_remarks: string | null;
}

interface FacultyGrade {
  grade_id: number;
  faculty_id: number | null;

  midterm_grade: number | null;
  final_grade: number | null;
  overall_percentage: number | null;
  final_rating: number | null;

  grading_policy?: string;
  grading_outcome?: string;
  outcome_reason?: string | null;

  remarks: GradeRemark | null;

  grade_status: GradeStatus;

  submitted_at: string | null;

  review: GradeReview;

  created_at: string | null;
  updated_at: string | null;
}

interface GradebookStudent {
  enrollment_subject_id: number;
  enrollment_id: number;
  student_id: number;

  student_number: string;

  first_name: string;
  middle_name: string | null;
  last_name: string;

  full_name: string;
  email: string | null;

  enrollment_status: string;
  subject_status: string;

  grade: FacultyGrade | null;
}

interface GradebookSummary {
  total_students: number;
  without_grade: number;
  draft: number;
  submitted: number;
  returned: number;
  approved: number;
}

interface GradebookResponse {
  success: boolean;

  faculty?: FacultyInfo;
  class?: FacultyClass;

  summary?: GradebookSummary;
  students?: GradebookStudent[];

  message?: string;
  error?: string;
}

interface GradeMutationResponse {
  success: boolean;

  message?: string;
  error?: string;

  missing_fields?: string[];

  grade?: {
    grade_id: number;
    enrollment_subject_id: number;

    midterm_grade: number | null;
    final_grade: number | null;
    overall_percentage?: number | null;
    final_rating: number | null;

    grading_policy?: string;
    grading_outcome?: string;
    outcome_reason?: string | null;

    remarks: GradeRemark | null;

    grade_status: GradeStatus;
  };
}

interface GradeForm {
  gradingOutcome: GradeOutcome;
  outcomeReason: string;
  midtermGrade: string;
  finalGrade: string;
}

interface GradePreview {
  complete: boolean;
  overallPercentage: number | null;
  finalRating: number | null;
  remarks: GradeRemark | null;
}

interface RowFeedback {
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

function parsePositiveInt(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function gradeValueToString(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function createGradeForm(grade: FacultyGrade | null): GradeForm {
  const storedOutcome = grade?.grading_outcome;

  const gradingOutcome: GradeOutcome =
    storedOutcome === "INCOMPLETE" || storedOutcome === "UNOFFICIAL_DROP"
      ? storedOutcome
      : "NUMERIC";

  return {
    gradingOutcome,
    outcomeReason: grade?.outcome_reason || "",
    midtermGrade: gradeValueToString(grade?.midterm_grade),
    finalGrade: gradeValueToString(grade?.final_grade),
  };
}

function formatDays(value: string | null): string {
  if (!value) {
    return "Not scheduled";
  }

  return value
    .split(",")
    .map((item) => {
      const day = item.trim();

      if (!day) {
        return "";
      }

      return day.charAt(0).toUpperCase() + day.slice(1).toLowerCase();
    })
    .filter(Boolean)
    .join(", ");
}

function getRoomLabel(room: FacultyClass["room"]): string {
  if (!room) {
    return "—";
  }

  if (room.room_code && room.room_name) {
    return `${room.room_code} • ${room.room_name}`;
  }

  return room.room_code || room.room_name || "—";
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function getGradeStatus(
  student: GradebookStudent,
): GradeStatus | "Not Started" {
  return student.grade?.grade_status || "Not Started";
}

function isEditable(student: GradebookStudent): boolean {
  if (student.subject_status !== "Enrolled") {
    return false;
  }

  if (!student.grade) {
    return true;
  }

  return (
    student.grade.grade_status === "Draft" ||
    student.grade.grade_status === "Returned"
  );
}

const GRADE_BANDS = [
  [97, 1.0],
  [94, 1.25],
  [91, 1.5],
  [88, 1.75],
  [85, 2.0],
  [82, 2.25],
  [79, 2.5],
  [76, 2.75],
  [75, 3.0],
  [0, 5.0],
] as const;

function parsePercentageHundredths(value: string): number | null {
  const clean = value.trim();

  if (!clean || !/^\d+(?:\.\d{1,2})?$/.test(clean)) {
    return null;
  }

  const numeric = Number(clean);

  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    return null;
  }

  return Math.round(numeric * 100);
}

function calculateGradePreview(form: GradeForm): GradePreview {
  if (form.gradingOutcome === "INCOMPLETE") {
    return {
      complete: true,
      overallPercentage: null,
      finalRating: 4,
      remarks: "Incomplete",
    };
  }

  if (form.gradingOutcome === "UNOFFICIAL_DROP") {
    return {
      complete: true,
      overallPercentage: null,
      finalRating: 6,
      remarks: "Unofficial Drop",
    };
  }

  const midterm = parsePercentageHundredths(form.midtermGrade);
  const finalTerm = parsePercentageHundredths(form.finalGrade);

  if (midterm === null || finalTerm === null) {
    return {
      complete: false,
      overallPercentage: null,
      finalRating: null,
      remarks: null,
    };
  }

  // Same TWO_TERM_50_50 rule used by the backend.
  // Keep hundredths so 74.995 never rounds up to a passing 75.
  const sum = midterm + finalTerm;
  const overallPercentage = sum / 200;

  const finalRating =
    GRADE_BANDS.find(([threshold]) => sum >= threshold * 200)?.[1] ?? 5;

  const remarks: GradeRemark =
    finalRating >= 1 && finalRating <= 3 ? "Passed" : "Failed";

  return {
    complete: true,
    overallPercentage,
    finalRating,
    remarks,
  };
}

function validatePercentageField(
  value: string,
  label: string,
  required = false,
): string | null {
  const clean = value.trim();

  if (!clean) {
    return required ? `${label} is required.` : null;
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(clean)) {
    return `${label} must be a percentage from 0 to 100 with at most two decimal places.`;
  }

  const numeric = Number(clean);

  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    return `${label} must be between 0 and 100.`;
  }

  return null;
}

function emptySummary(): GradebookSummary {
  return {
    total_students: 0,
    without_grade: 0,
    draft: 0,
    submitted: 0,
    returned: 0,
    approved: 0,
  };
}

export default function EnterGrades() {
  const navigate = useNavigate();

  const session = authService.getSession();

  const token = authService.getToken();

  const userRole = session?.role;

  const authenticated = Boolean(session && token);

  const [faculty, setFaculty] = useState<FacultyInfo | null>(null);

  const [classes, setClasses] = useState<FacultyClass[]>([]);

  const [classesLoading, setClassesLoading] = useState(true);

  const [classesError, setClassesError] = useState("");

  const [selectedOfferingId, setSelectedOfferingId] = useState<number | null>(
    null,
  );

  const [gradebookClass, setGradebookClass] = useState<FacultyClass | null>(
    null,
  );

  const [students, setStudents] = useState<GradebookStudent[]>([]);

  const [summary, setSummary] = useState<GradebookSummary>(emptySummary());

  const [gradebookLoading, setGradebookLoading] = useState(false);

  const [gradebookError, setGradebookError] = useState("");

  const [gradebookRefreshKey, setGradebookRefreshKey] = useState(0);

  const [forms, setForms] = useState<Record<number, GradeForm>>({});

  const [rowFeedback, setRowFeedback] = useState<Record<number, RowFeedback>>(
    {},
  );

  const [savingId, setSavingId] = useState<number | null>(null);

  const [submittingId, setSubmittingId] = useState<number | null>(null);

  const [studentSearch, setStudentSearch] = useState("");

  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    if (userRole !== "Faculty") {
      if (session) {
        navigate(authService.getDashboardRoute(session.role), {
          replace: true,
        });
      }
    }
  }, [authenticated, userRole, session, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Faculty") {
      return;
    }

    const controller = new AbortController();

    const loadClasses = async () => {
      try {
        setClassesLoading(true);

        setClassesError("");

        const response = await authService.authFetch(API_BASE_URL, {
          method: "GET",

          signal: controller.signal,
        });

        const data = await readJsonResponse<FacultyClassesResponse>(response);

        if (response.status === 401) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

          return;
        }

        if (response.status === 403) {
          throw new Error(data.message || "Faculty access is required.");
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || data.error || "Unable to load Faculty classes.",
          );
        }

        const loadedClasses = Array.isArray(data.classes)
          ? data.classes.filter((item) => item.offering_status !== "Cancelled")
          : [];

        setFaculty(data.faculty || null);

        setClasses(loadedClasses);

        if (loadedClasses.length === 0) {
          setSelectedOfferingId(null);

          return;
        }

        setSelectedOfferingId((current) => {
          if (
            current &&
            loadedClasses.some((item) => item.offering_id === current)
          ) {
            return current;
          }

          return loadedClasses[0].offering_id;
        });
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD FACULTY CLASSES ERROR:", requestError);

        setClasses([]);
        setSelectedOfferingId(null);

        setClassesError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load Faculty classes.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setClassesLoading(false);
        }
      }
    };

    void loadClasses();

    return () => {
      controller.abort();
    };
  }, [authenticated, userRole, navigate]);

  const loadGradebook = useCallback(
    async (signal?: AbortSignal) => {
      if (!selectedOfferingId) {
        setGradebookClass(null);

        setStudents([]);
        setForms({});
        setSummary(emptySummary());

        return;
      }

      try {
        setGradebookLoading(true);

        setGradebookError("");

        const response = await authService.authFetch(
          `${API_BASE_URL}/${selectedOfferingId}/gradebook`,
          {
            method: "GET",

            signal,
          },
        );

        const data = await readJsonResponse<GradebookResponse>(response);

        if (response.status === 401) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

          return;
        }

        if (response.status === 403) {
          throw new Error(data.message || "You cannot access this class.");
        }

        if (response.status === 404) {
          throw new Error(data.message || "The selected class was not found.");
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || data.error || "Unable to load the class gradebook.",
          );
        }

        const loadedStudents = Array.isArray(data.students)
          ? data.students
          : [];

        if (data.faculty) {
          setFaculty(data.faculty);
        }

        setGradebookClass(data.class || null);

        setStudents(loadedStudents);

        setSummary({
          total_students: data.summary?.total_students ?? loadedStudents.length,

          without_grade:
            data.summary?.without_grade ??
            loadedStudents.filter((student) => student.grade === null).length,

          draft:
            data.summary?.draft ??
            loadedStudents.filter(
              (student) => student.grade?.grade_status === "Draft",
            ).length,

          submitted:
            data.summary?.submitted ??
            loadedStudents.filter(
              (student) => student.grade?.grade_status === "Submitted",
            ).length,

          returned:
            data.summary?.returned ??
            loadedStudents.filter(
              (student) => student.grade?.grade_status === "Returned",
            ).length,

          approved:
            data.summary?.approved ??
            loadedStudents.filter(
              (student) => student.grade?.grade_status === "Approved",
            ).length,
        });

        const nextForms: Record<number, GradeForm> = {};

        loadedStudents.forEach((student) => {
          nextForms[student.enrollment_subject_id] = createGradeForm(
            student.grade,
          );
        });

        setForms(nextForms);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD FACULTY GRADEBOOK ERROR:", requestError);

        setGradebookClass(null);

        setStudents([]);
        setForms({});
        setSummary(emptySummary());

        setGradebookError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load the class gradebook.",
        );
      } finally {
        if (!signal?.aborted) {
          setGradebookLoading(false);
        }
      }
    },
    [selectedOfferingId, navigate],
  );

  useEffect(() => {
    if (!authenticated || userRole !== "Faculty" || !selectedOfferingId) {
      return;
    }

    const controller = new AbortController();

    void loadGradebook(controller.signal);

    return () => {
      controller.abort();
    };
  }, [
    authenticated,
    userRole,
    selectedOfferingId,
    gradebookRefreshKey,
    loadGradebook,
  ]);

  const selectedClass = useMemo(() => {
    return (
      classes.find((item) => item.offering_id === selectedOfferingId) ||
      gradebookClass ||
      null
    );
  }, [classes, selectedOfferingId, gradebookClass]);

  const filteredStudents = useMemo(() => {
    const query = studentSearch.trim().toLowerCase();

    return students.filter((student) => {
      const matchesSearch =
        !query ||
        student.student_number.toLowerCase().includes(query) ||
        student.full_name.toLowerCase().includes(query) ||
        (student.email || "").toLowerCase().includes(query);

      const currentStatus = getGradeStatus(student);

      const matchesStatus =
        statusFilter === "All" || currentStatus === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [students, studentSearch, statusFilter]);

  const handleClassChange = (value: string) => {
    const nextId = parsePositiveInt(value);

    if (!nextId) {
      return;
    }

    if (nextId === selectedOfferingId) {
      return;
    }

    setSelectedOfferingId(nextId);

    setStudentSearch("");
    setStatusFilter("All");

    setRowFeedback({});

    setGradebookError("");
  };

  const updateForm = (
    enrollmentSubjectId: number,
    field: keyof GradeForm,
    value: string,
  ) => {
    setForms((current) => ({
      ...current,

      [enrollmentSubjectId]: {
        ...(current[enrollmentSubjectId] || {
          gradingOutcome: "NUMERIC",
          outcomeReason: "",
          midtermGrade: "",
          finalGrade: "",
        }),

        [field]: value,
      },
    }));

    setRowFeedback((current) => {
      const next = {
        ...current,
      };

      delete next[enrollmentSubjectId];

      return next;
    });
  };

  const buildGradeBody = (form: GradeForm) => {
    const specialOutcome = form.gradingOutcome !== "NUMERIC";

    return {
      midterm_grade: specialOutcome ? null : form.midtermGrade.trim() || null,
      final_grade: specialOutcome ? null : form.finalGrade.trim() || null,
      grading_outcome: form.gradingOutcome,
      outcome_reason: specialOutcome ? form.outcomeReason.trim() : null,
    };
  };

  const validateOutcomeReason = (form: GradeForm): string | null => {
    if (form.gradingOutcome === "NUMERIC") {
      return null;
    }

    const reason = form.outcomeReason.trim();

    if (!reason) {
      return "A reason is required for Incomplete or Unofficial Drop.";
    }

    if (reason.length > 500) {
      return "Outcome reason must not exceed 500 characters.";
    }

    return null;
  };

  const validateNumericFields = (form: GradeForm): string | null => {
    if (form.gradingOutcome !== "NUMERIC") {
      return validateOutcomeReason(form);
    }

    return (
      validatePercentageField(form.midtermGrade, "Midterm") ||
      validatePercentageField(form.finalGrade, "Final Term")
    );
  };

  const validateForSubmit = (form: GradeForm): string | null => {
    if (form.gradingOutcome !== "NUMERIC") {
      return validateOutcomeReason(form);
    }

    return (
      validatePercentageField(form.midtermGrade, "Midterm", true) ||
      validatePercentageField(form.finalGrade, "Final Term", true)
    );
  };

  const saveDraftRequest = async (
    student: GradebookStudent,
    showSuccess: boolean,
  ) => {
    if (!selectedOfferingId) {
      throw new Error("No class is selected.");
    }

    const id = student.enrollment_subject_id;

    const form = forms[id];

    if (!form) {
      throw new Error("Grade form is unavailable.");
    }

    const numericError = validateNumericFields(form);

    if (numericError) {
      throw new Error(numericError);
    }

    const response = await authService.authFetch(
      `${API_BASE_URL}/${selectedOfferingId}/grades/${id}/draft`,
      {
        method: "PUT",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify(buildGradeBody(form)),
      },
    );

    const data = await readJsonResponse<GradeMutationResponse>(response);

    if (response.status === 401) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      throw new Error("Your session has expired.");
    }

    if (!response.ok || !data.success) {
      throw new Error(data.message || data.error || "Unable to save grade.");
    }

    if (showSuccess) {
      setRowFeedback((current) => ({
        ...current,

        [id]: {
          type: "success",

          message: data.message || "Draft grade saved successfully.",
        },
      }));
    }

    return data;
  };

  const saveDraft = async (student: GradebookStudent) => {
    const id = student.enrollment_subject_id;

    if (!isEditable(student)) {
      return;
    }

    try {
      setSavingId(id);

      setRowFeedback((current) => {
        const next = {
          ...current,
        };

        delete next[id];

        return next;
      });

      await saveDraftRequest(student, true);

      setGradebookRefreshKey((current) => current + 1);
    } catch (requestError) {
      console.error("SAVE FACULTY DRAFT GRADE ERROR:", requestError);

      setRowFeedback((current) => ({
        ...current,

        [id]: {
          type: "error",

          message:
            requestError instanceof Error
              ? requestError.message
              : "Unable to save draft grade.",
        },
      }));
    } finally {
      setSavingId(null);
    }
  };

  const submitGrade = async (student: GradebookStudent) => {
    if (!selectedOfferingId) {
      return;
    }

    const id = student.enrollment_subject_id;

    if (!isEditable(student)) {
      return;
    }

    const form = forms[id];

    if (!form) {
      return;
    }

    const validationError = validateForSubmit(form);

    if (validationError) {
      setRowFeedback((current) => ({
        ...current,

        [id]: {
          type: "error",

          message: validationError,
        },
      }));

      return;
    }

    const preview = calculateGradePreview(form);

    const outcomeLabel =
      form.gradingOutcome === "NUMERIC"
        ? "Numeric Grade"
        : form.gradingOutcome === "INCOMPLETE"
          ? "Incomplete"
          : "Unofficial Drop";

    const confirmed = window.confirm(
      `Submit the grade for ${student.student_number} - ${student.full_name}?\n\nOutcome: ${outcomeLabel}\nFinal Rating: ${
        preview.finalRating !== null ? preview.finalRating.toFixed(2) : "—"
      }\nResult: ${preview.remarks || "—"}${
        form.gradingOutcome !== "NUMERIC"
          ? `\nReason: ${form.outcomeReason.trim()}`
          : ""
      }\n\nAfter submission, Faculty cannot edit it unless the Program Head returns it.`,
    );

    if (!confirmed) {
      return;
    }

    try {
      setSubmittingId(id);

      setRowFeedback((current) => {
        const next = {
          ...current,
        };

        delete next[id];

        return next;
      });

      await saveDraftRequest(student, false);

      const response = await authService.authFetch(
        `${API_BASE_URL}/${selectedOfferingId}/grades/${id}/submit`,
        {
          method: "PATCH",
        },
      );

      const data = await readJsonResponse<GradeMutationResponse>(response);

      if (response.status === 401) {
        authService.logout();

        navigate("/login", {
          replace: true,
        });

        return;
      }

      if (!response.ok || !data.success) {
        const missing =
          Array.isArray(data.missing_fields) && data.missing_fields.length > 0
            ? ` Missing: ${data.missing_fields.join(", ")}.`
            : "";

        throw new Error(
          `${
            data.message || data.error || "Unable to submit grade."
          }${missing}`,
        );
      }

      setRowFeedback((current) => ({
        ...current,

        [id]: {
          type: "success",

          message: data.message || "Grade submitted successfully.",
        },
      }));

      setGradebookRefreshKey((current) => current + 1);
    } catch (requestError) {
      console.error("SUBMIT FACULTY GRADE ERROR:", requestError);

      setRowFeedback((current) => ({
        ...current,

        [id]: {
          type: "error",

          message:
            requestError instanceof Error
              ? requestError.message
              : "Unable to submit grade.",
        },
      }));
    } finally {
      setSubmittingId(null);
    }
  };

  const refreshGradebook = () => {
    setGradebookRefreshKey((current) => current + 1);
  };

  const backToClasses = () => {
    navigate("/faculty/classes");
  };

  const viewRoster = () => {
    if (!selectedOfferingId) {
      return;
    }

    navigate(`/faculty/classes/students?offering_id=${selectedOfferingId}`);
  };

  if (!authenticated || userRole !== "Faculty") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="faculty-enter-grades-page">
        <section className="faculty-grade-header">
          <div className="faculty-grade-header__copy">
            <button
              type="button"
              className="faculty-grade-back"
              onClick={backToClasses}
            >
              <ArrowLeft size={15} strokeWidth={2.1} />
              My Classes
            </button>

            <div className="faculty-grade-eyebrow">
              <span className="faculty-grade-eyebrow__icon">
                <FilePenLine size={16} strokeWidth={2.2} />
              </span>
              Faculty · Grade Encoding
            </div>

            <h1>Enter Grades</h1>

            <p>
              Encode and submit grades for students with official Approved
              enrollment in your assigned classes.
            </p>
          </div>

          <div className="faculty-grade-header-actions">
            <button
              type="button"
              className="faculty-grade-header-button"
              onClick={viewRoster}
              disabled={!selectedOfferingId}
            >
              <UsersRound size={16} />
              View Roster
            </button>

            <button
              type="button"
              className="faculty-grade-header-button faculty-grade-header-button--primary"
              onClick={refreshGradebook}
              disabled={gradebookLoading || !selectedOfferingId}
            >
              <RefreshCw
                size={16}
                className={gradebookLoading ? "is-spinning" : ""}
              />
              {gradebookLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </section>

        <section className="faculty-grade-toolbar">
          <div className="faculty-grade-faculty">
            <span className="faculty-grade-faculty__icon">
              <GraduationCap size={20} />
            </span>

            <div className="faculty-grade-faculty__copy">
              <small>Faculty</small>
              <strong>{faculty?.faculty_name || "Faculty"}</strong>
              <span>
                {faculty?.employee_number || "Employee number unavailable"}
              </span>
            </div>
          </div>

          <div className="faculty-grade-class-select">
            <div className="faculty-grade-class-select__heading">
              <div>
                <small>Gradebook Context</small>
                <strong>Select Assigned Class</strong>
              </div>

              <span>
                {classes.length} class{classes.length === 1 ? "" : "es"}
              </span>
            </div>

            <label htmlFor="faculty-grade-class">Assigned Class</label>

            <select
              id="faculty-grade-class"
              value={selectedOfferingId ? String(selectedOfferingId) : ""}
              onChange={(event) => handleClassChange(event.target.value)}
              disabled={classesLoading || classes.length === 0}
            >
              {classes.length === 0 && (
                <option value="">No assigned classes</option>
              )}

              {classes.map((item) => (
                <option key={item.offering_id} value={item.offering_id}>
                  {item.subject.subject_code} — {item.section.section_name} —{" "}
                  {item.academic_period.academic_year} /{" "}
                  {item.academic_period.semester_name}
                </option>
              ))}
            </select>
          </div>
        </section>

        {classesError && (
          <section className="faculty-grade-error" role="alert">
            <span className="faculty-grade-error__icon">
              <AlertCircle size={20} />
            </span>

            <div>
              <strong>Assigned classes could not be loaded</strong>
              <p>{classesError}</p>
            </div>
          </section>
        )}

        {selectedClass && (
          <section className="faculty-grade-class-card">
            <div className="faculty-grade-subject">
              <div className="faculty-grade-subject__label">
                <span className="faculty-grade-subject__icon">
                  <BookOpenCheck size={18} />
                </span>
                Selected Subject
              </div>

              <strong>{selectedClass.subject.subject_code}</strong>
              <p>{selectedClass.subject.subject_name}</p>

              <span className="faculty-grade-subject__units">
                {selectedClass.subject.units} unit
                {selectedClass.subject.units === 1 ? "" : "s"}
              </span>
            </div>

            <div className="faculty-grade-class-details">
              <div>
                <span className="faculty-grade-detail-icon">
                  <GraduationCap size={15} />
                </span>
                <section>
                  <small>Section</small>
                  <strong>{selectedClass.section.section_name}</strong>
                  <p>
                    {selectedClass.section.course.course_code} · Year{" "}
                    {selectedClass.section.year_level}
                  </p>
                </section>
              </div>

              <div>
                <span className="faculty-grade-detail-icon">
                  <CalendarDays size={15} />
                </span>
                <section>
                  <small>Academic Period</small>
                  <strong>{selectedClass.academic_period.academic_year}</strong>
                  <p>{selectedClass.academic_period.semester_name}</p>
                </section>
              </div>

              <div>
                <span className="faculty-grade-detail-icon">
                  <Clock3 size={15} />
                </span>
                <section>
                  <small>Schedule</small>
                  <strong>{formatDays(selectedClass.schedule.days)}</strong>
                  <p>{selectedClass.schedule.time || "Not scheduled"}</p>
                </section>
              </div>

              <div>
                <span className="faculty-grade-detail-icon">
                  <MapPin size={15} />
                </span>
                <section>
                  <small>Room</small>
                  <strong>{getRoomLabel(selectedClass.room)}</strong>
                  <p>Registrar-assigned classroom</p>
                </section>
              </div>

              <div>
                <span className="faculty-grade-detail-icon">
                  <UsersRound size={15} />
                </span>
                <section>
                  <small>Official Students</small>
                  <strong>{summary.total_students}</strong>
                  <p>Approved enrollment memberships</p>
                </section>
              </div>

              <div>
                <span className="faculty-grade-detail-icon">
                  <ShieldCheck size={15} />
                </span>
                <section>
                  <small>Offering Status</small>
                  <strong
                    className={`faculty-grade-offering-status ${selectedClass.offering_status.toLowerCase()}`}
                  >
                    {selectedClass.offering_status}
                  </strong>
                  <p>Current class availability</p>
                </section>
              </div>
            </div>
          </section>
        )}

        <section
          className="faculty-grade-summary"
          aria-label="Grade status summary"
        >
          <article className="faculty-grade-summary-card faculty-grade-summary-card--total">
            <span className="faculty-grade-summary-icon">
              <UsersRound size={18} />
            </span>
            <div>
              <small>Official Students</small>
              <strong>{summary.total_students}</strong>
              <span>Students in this gradebook</span>
            </div>
          </article>

          <article className="faculty-grade-summary-card faculty-grade-summary-card--empty">
            <span className="faculty-grade-summary-icon">
              <CircleDashed size={18} />
            </span>
            <div>
              <small>Not Started</small>
              <strong>{summary.without_grade}</strong>
              <span>No grade record yet</span>
            </div>
          </article>

          <article className="faculty-grade-summary-card faculty-grade-summary-card--draft">
            <span className="faculty-grade-summary-icon">
              <FilePenLine size={18} />
            </span>
            <div>
              <small>Draft</small>
              <strong>{summary.draft}</strong>
              <span>Still editable</span>
            </div>
          </article>

          <article className="faculty-grade-summary-card faculty-grade-summary-card--submitted">
            <span className="faculty-grade-summary-icon">
              <Send size={18} />
            </span>
            <div>
              <small>Submitted</small>
              <strong>{summary.submitted}</strong>
              <span>Waiting for review</span>
            </div>
          </article>

          <article className="faculty-grade-summary-card faculty-grade-summary-card--returned">
            <span className="faculty-grade-summary-icon">
              <RotateCcw size={18} />
            </span>
            <div>
              <small>Returned</small>
              <strong>{summary.returned}</strong>
              <span>Needs correction</span>
            </div>
          </article>

          <article className="faculty-grade-summary-card faculty-grade-summary-card--approved">
            <span className="faculty-grade-summary-icon">
              <BadgeCheck size={18} />
            </span>
            <div>
              <small>Approved</small>
              <strong>{summary.approved}</strong>
              <span>Official and locked</span>
            </div>
          </article>
        </section>

        {gradebookError && (
          <section className="faculty-grade-error" role="alert">
            <span className="faculty-grade-error__icon">
              <AlertCircle size={20} />
            </span>

            <div>
              <strong>Gradebook could not be loaded</strong>
              <p>{gradebookError}</p>
            </div>

            <button type="button" onClick={refreshGradebook}>
              <RefreshCw size={14} />
              Try Again
            </button>
          </section>
        )}

        {(classesLoading || gradebookLoading) && (
          <section className="faculty-grade-loading">
            <div className="faculty-grade-spinner" />

            <div>
              <strong>Loading gradebook</strong>
              <span>Retrieving official students and grade records...</span>
            </div>
          </section>
        )}

        {!classesLoading &&
          !gradebookLoading &&
          !gradebookError &&
          gradebookClass && (
            <section className="faculty-gradebook">
              <header className="faculty-gradebook-header">
                <div className="faculty-gradebook-header__title">
                  <span className="faculty-gradebook-header__icon">
                    <BookOpenCheck size={18} />
                  </span>

                  <div>
                    <span>Official Class Record</span>
                    <h2>Class Gradebook</h2>
                    <p>
                      Draft and Returned grades are editable. Submitted and
                      Approved grades remain locked while under review or after
                      approval.
                    </p>
                  </div>
                </div>

                <div className="faculty-gradebook-tools">
                  <label className="faculty-gradebook-search">
                    <span>Search Student</span>
                    <div>
                      <Search size={15} />
                      <input
                        type="search"
                        value={studentSearch}
                        onChange={(event) =>
                          setStudentSearch(event.target.value)
                        }
                        placeholder="Name, student no., or email..."
                      />
                    </div>
                  </label>

                  <label className="faculty-gradebook-filter">
                    <span>
                      <Filter size={13} />
                      Grade Status
                    </span>
                    <select
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value)}
                    >
                      <option value="All">All Statuses</option>
                      <option value="Not Started">Not Started</option>
                      <option value="Draft">Draft</option>
                      <option value="Submitted">Submitted</option>
                      <option value="Returned">Returned</option>
                      <option value="Approved">Approved</option>
                    </select>
                  </label>
                </div>
              </header>

              {students.length === 0 ? (
                <div className="faculty-grade-empty">
                  <span className="faculty-grade-empty__icon">
                    <UsersRound size={23} />
                  </span>
                  <strong>No official students</strong>
                  <p>This class has no Approved enrollment memberships.</p>
                </div>
              ) : filteredStudents.length === 0 ? (
                <div className="faculty-grade-empty">
                  <span className="faculty-grade-empty__icon">
                    <Search size={23} />
                  </span>
                  <strong>No matching students</strong>
                  <p>No gradebook row matches your current filters.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setStudentSearch("");
                      setStatusFilter("All");
                    }}
                  >
                    <RotateCcw size={14} />
                    Clear Filters
                  </button>
                </div>
              ) : (
                <>
                  <div className="faculty-gradebook-table-meta">
                    <span>
                      Showing <strong>{filteredStudents.length}</strong> of{" "}
                      <strong>{students.length}</strong> students
                    </span>
                    <small>
                      Grade inputs remain editable only while a record is Draft
                      or Returned.
                    </small>
                  </div>

                  <div className="faculty-grade-table-wrapper">
                    <table className="faculty-grade-table">
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Outcome</th>
                          <th>Midterm %</th>
                          <th>Final Term %</th>
                          <th>Overall %</th>
                          <th>Final Rating</th>
                          <th>Result</th>
                          <th>Reason</th>
                          <th>Status</th>
                          <th>Program Head Review</th>
                          <th>Actions</th>
                        </tr>
                      </thead>

                      <tbody>
                        {filteredStudents.map((student) => {
                          const id = student.enrollment_subject_id;
                          const form =
                            forms[id] || createGradeForm(student.grade);
                          const editable = isEditable(student);
                          const isSaving = savingId === id;
                          const isSubmitting = submittingId === id;
                          const busy = isSaving || isSubmitting;
                          const status = getGradeStatus(student);
                          const feedback = rowFeedback[id];
                          const preview = calculateGradePreview(form);

                          const useStoredResult =
                            !editable && Boolean(student.grade);

                          const overallPercentage = useStoredResult
                            ? (student.grade?.overall_percentage ?? null)
                            : preview.overallPercentage;

                          const finalRating = useStoredResult
                            ? (student.grade?.final_rating ?? null)
                            : preview.finalRating;

                          const resultRemark = useStoredResult
                            ? (student.grade?.remarks ?? null)
                            : preview.remarks;

                          return (
                            <tr
                              key={id}
                              className={
                                student.grade?.grade_status === "Returned"
                                  ? "returned-row"
                                  : ""
                              }
                            >
                              <td>
                                <div className="faculty-grade-student">
                                  <span className="faculty-grade-student__avatar">
                                    <UserRound size={16} />
                                  </span>

                                  <div>
                                    <strong>{student.full_name}</strong>
                                    <span>{student.student_number}</span>
                                    <small>
                                      Enrollment Subject #
                                      {student.enrollment_subject_id}
                                    </small>
                                  </div>
                                </div>
                              </td>

                              <td>
                                <select
                                  className="faculty-grade-remarks"
                                  value={form.gradingOutcome}
                                  onChange={(event) =>
                                    updateForm(
                                      id,
                                      "gradingOutcome",
                                      event.target.value as GradeOutcome,
                                    )
                                  }
                                  disabled={!editable || busy}
                                  aria-label={`Grade outcome for ${student.full_name}`}
                                >
                                  <option value="NUMERIC">Numeric Grade</option>
                                  <option value="INCOMPLETE">Incomplete</option>
                                  <option value="UNOFFICIAL_DROP">
                                    Unofficial Drop
                                  </option>
                                </select>
                              </td>

                              <td>
                                <input
                                  className="faculty-grade-input"
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.01"
                                  value={form.midtermGrade}
                                  onChange={(event) =>
                                    updateForm(
                                      id,
                                      "midtermGrade",
                                      event.target.value,
                                    )
                                  }
                                  disabled={
                                    !editable ||
                                    busy ||
                                    form.gradingOutcome !== "NUMERIC"
                                  }
                                  placeholder={
                                    form.gradingOutcome === "NUMERIC"
                                      ? "0-100"
                                      : "—"
                                  }
                                  aria-label={`Midterm percentage for ${student.full_name}`}
                                />
                              </td>

                              <td>
                                <input
                                  className="faculty-grade-input"
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.01"
                                  value={form.finalGrade}
                                  onChange={(event) =>
                                    updateForm(
                                      id,
                                      "finalGrade",
                                      event.target.value,
                                    )
                                  }
                                  disabled={
                                    !editable ||
                                    busy ||
                                    form.gradingOutcome !== "NUMERIC"
                                  }
                                  placeholder={
                                    form.gradingOutcome === "NUMERIC"
                                      ? "0-100"
                                      : "—"
                                  }
                                  aria-label={`Final Term percentage for ${student.full_name}`}
                                />
                              </td>

                              <td>
                                <div className="faculty-grade-rating-field">
                                  <strong>
                                    {overallPercentage !== null
                                      ? overallPercentage.toFixed(3)
                                      : "—"}
                                  </strong>
                                  <small>Automatic 50/50 average</small>
                                </div>
                              </td>

                              <td>
                                <div className="faculty-grade-rating-field">
                                  <strong>
                                    {finalRating !== null
                                      ? Number(finalRating).toFixed(2)
                                      : "—"}
                                  </strong>
                                  <small>Automatic</small>
                                </div>
                              </td>

                              <td>
                                <div className="faculty-grade-rating-field">
                                  <strong>{resultRemark || "—"}</strong>
                                  <small>Calculated by policy</small>
                                </div>
                              </td>

                              <td>
                                {form.gradingOutcome === "NUMERIC" ? (
                                  <span className="faculty-grade-no-review">
                                    Not required
                                  </span>
                                ) : (
                                  <input
                                    className="faculty-grade-remarks"
                                    type="text"
                                    maxLength={500}
                                    value={form.outcomeReason}
                                    onChange={(event) =>
                                      updateForm(
                                        id,
                                        "outcomeReason",
                                        event.target.value,
                                      )
                                    }
                                    disabled={!editable || busy}
                                    placeholder={
                                      form.gradingOutcome === "INCOMPLETE"
                                        ? "Reason for incomplete..."
                                        : "Reason for unofficial drop..."
                                    }
                                    aria-label={`Outcome reason for ${student.full_name}`}
                                  />
                                )}
                              </td>

                              <td>
                                <div className="faculty-grade-status-cell">
                                  <span
                                    className={`faculty-grade-status ${status
                                      .toLowerCase()
                                      .replace(/\s+/g, "-")}`}
                                  >
                                    {status}
                                  </span>

                                  {student.grade?.submitted_at && (
                                    <small>
                                      Submitted{" "}
                                      {formatDateTime(
                                        student.grade.submitted_at,
                                      )}
                                    </small>
                                  )}
                                </div>
                              </td>

                              <td>
                                {student.grade?.review?.review_remarks ? (
                                  <div className="faculty-grade-review">
                                    <span className="faculty-grade-review__icon">
                                      <MessageSquareText size={14} />
                                    </span>

                                    <div>
                                      <strong>
                                        {student.grade.review
                                          .reviewed_by_username ||
                                          "Program Head"}
                                      </strong>
                                      <p>
                                        {student.grade.review.review_remarks}
                                      </p>
                                      <small>
                                        {formatDateTime(
                                          student.grade.review.reviewed_at,
                                        )}
                                      </small>
                                    </div>
                                  </div>
                                ) : student.grade?.grade_status ===
                                  "Approved" ? (
                                  <div className="faculty-grade-review approved">
                                    <span className="faculty-grade-review__icon">
                                      <CheckCircle2 size={14} />
                                    </span>

                                    <div>
                                      <strong>Approved</strong>
                                      <small>
                                        {formatDateTime(
                                          student.grade.review.reviewed_at,
                                        )}
                                      </small>
                                    </div>
                                  </div>
                                ) : (
                                  <span className="faculty-grade-no-review">
                                    No review yet
                                  </span>
                                )}
                              </td>

                              <td>
                                <div className="faculty-grade-actions">
                                  {editable ? (
                                    <>
                                      <button
                                        type="button"
                                        className="faculty-grade-save"
                                        onClick={() => void saveDraft(student)}
                                        disabled={busy}
                                      >
                                        <Save size={13} />
                                        {isSaving
                                          ? "Saving..."
                                          : student.grade?.grade_status ===
                                              "Returned"
                                            ? "Save Correction"
                                            : "Save Draft"}
                                      </button>

                                      <button
                                        type="button"
                                        className="faculty-grade-submit"
                                        onClick={() =>
                                          void submitGrade(student)
                                        }
                                        disabled={busy}
                                      >
                                        <Send size={13} />
                                        {isSubmitting
                                          ? "Submitting..."
                                          : student.grade?.grade_status ===
                                              "Returned"
                                            ? "Resubmit"
                                            : "Submit Grade"}
                                      </button>
                                    </>
                                  ) : (
                                    <span className="faculty-grade-locked">
                                      <ShieldCheck size={13} />
                                      {student.subject_status !== "Enrolled"
                                        ? `Academic result: ${student.subject_status}`
                                        : status === "Submitted"
                                          ? "Waiting for Program Head"
                                          : status === "Approved"
                                            ? "Official grade locked"
                                            : "Locked"}
                                    </span>
                                  )}

                                  {feedback && (
                                    <div
                                      className={`faculty-grade-feedback ${feedback.type}`}
                                    >
                                      {feedback.message}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          )}

        {!classesLoading && classes.length > 0 && (
          <section className="faculty-grade-workflow-section">
            <header>
              <div>
                <span>Grade Submission Process</span>
                <h2>Faculty Grade Workflow</h2>
                <p>
                  Follow the normal grading sequence before a grade becomes an
                  official academic result.
                </p>
              </div>
            </header>

            <div className="faculty-grade-workflow">
              <article>
                <span className="faculty-grade-workflow__number">01</span>
                <span className="faculty-grade-workflow__icon">
                  <FilePenLine size={17} />
                </span>
                <div>
                  <strong>Encode</strong>
                  <p>
                    Choose Numeric Grade for normal 0–100 Midterm and Final Term
                    encoding, or choose Incomplete / Unofficial Drop and provide
                    a required reason. Final Rating and Result are calculated
                    automatically by policy.
                  </p>
                </div>
              </article>

              <article>
                <span className="faculty-grade-workflow__number">02</span>
                <span className="faculty-grade-workflow__icon">
                  <Save size={17} />
                </span>
                <div>
                  <strong>Save Draft</strong>
                  <p>
                    Keep unfinished grade records editable before submission.
                  </p>
                </div>
              </article>

              <article>
                <span className="faculty-grade-workflow__number">03</span>
                <span className="faculty-grade-workflow__icon">
                  <Send size={17} />
                </span>
                <div>
                  <strong>Submit</strong>
                  <p>
                    Lock the grade and send it to the Program Head for review.
                  </p>
                </div>
              </article>

              <article>
                <span className="faculty-grade-workflow__number">04</span>
                <span className="faculty-grade-workflow__icon">
                  <BadgeCheck size={17} />
                </span>
                <div>
                  <strong>Review</strong>
                  <p>
                    The Program Head approves the grade or returns it for
                    correction.
                  </p>
                </div>
              </article>
            </div>
          </section>
        )}
      </main>
    </DashboardLayout>
  );
}
