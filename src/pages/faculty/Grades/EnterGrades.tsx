import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/EnterGrades.css";

const API_BASE_URL = "http://localhost:3000/api/faculty/classes";

type GradeStatus = "Draft" | "Submitted" | "Returned" | "Approved";

type GradeRemark = "" | "Passed" | "Failed" | "Incomplete";

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

  prelim_grade: number | null;
  midterm_grade: number | null;
  final_grade: number | null;
  final_rating: number | null;

  remarks: "Passed" | "Failed" | "Incomplete" | null;

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

    prelim_grade: number | null;
    midterm_grade: number | null;
    final_grade: number | null;
    final_rating: number | null;

    remarks: "Passed" | "Failed" | "Incomplete" | null;

    grade_status: GradeStatus;
  };
}

interface GradeForm {
  prelimGrade: string;
  midtermGrade: string;
  finalGrade: string;
  finalRating: string;
  remarks: GradeRemark;
}

interface GradeComputation {
  complete: boolean;
  rawAverage: number | null;
  finalRating: number | null;
  finalRatingText: string;
  remarks: GradeRemark;
}

interface RowFeedback {
  type: "success" | "error";
  message: string;
}

type EditableGradeField = "prelimGrade" | "midtermGrade" | "finalGrade";

const OFFICIAL_GRADE_SCALE = [
  1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 4, 5,
] as const;

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

function toNullableNumber(value: string): number | null {
  const clean = value.trim();

  if (!clean) {
    return null;
  }

  const parsed = Number(clean);

  return Number.isFinite(parsed) ? parsed : null;
}

function getRemarkFromFinalRating(value: number | null): GradeRemark {
  if (value === null) {
    return "";
  }

  if (value >= 1 && value <= 3) {
    return "Passed";
  }

  if (value === 4) {
    return "Incomplete";
  }

  if (value === 5) {
    return "Failed";
  }

  return "";
}

function normalizeToOfficialGradeScale(average: number): number {
  let closest: number = OFFICIAL_GRADE_SCALE[0];
  let closestDistance = Math.abs(average - closest);

  for (const grade of OFFICIAL_GRADE_SCALE) {
    const distance = Math.abs(average - grade);

    if (distance < closestDistance) {
      closest = grade;
      closestDistance = distance;
      continue;
    }

    if (distance === closestDistance && grade > closest) {
      closest = grade;
    }
  }

  return closest;
}

function calculateGrade(
  prelimGrade: string,
  midtermGrade: string,
  finalGrade: string,
): GradeComputation {
  const prelimText = prelimGrade.trim();
  const midtermText = midtermGrade.trim();
  const finalText = finalGrade.trim();

  if (!prelimText || !midtermText || !finalText) {
    return {
      complete: false,
      rawAverage: null,
      finalRating: null,
      finalRatingText: "",
      remarks: "",
    };
  }

  const prelim = Number(prelimText);
  const midterm = Number(midtermText);
  const final = Number(finalText);

  if (
    !Number.isFinite(prelim) ||
    !Number.isFinite(midterm) ||
    !Number.isFinite(final)
  ) {
    return {
      complete: false,
      rawAverage: null,
      finalRating: null,
      finalRatingText: "",
      remarks: "",
    };
  }

  const rawAverage = (prelim + midterm + final) / 3;

  const normalizedFinalRating = normalizeToOfficialGradeScale(rawAverage);

  const remarks = getRemarkFromFinalRating(normalizedFinalRating);

  return {
    complete: true,
    rawAverage,
    finalRating: normalizedFinalRating,
    finalRatingText: normalizedFinalRating.toFixed(2),
    remarks,
  };
}

function createGradeForm(grade: FacultyGrade | null): GradeForm {
  const prelimGrade = gradeValueToString(grade?.prelim_grade);

  const midtermGrade = gradeValueToString(grade?.midterm_grade);

  const finalGrade = gradeValueToString(grade?.final_grade);

  if (
    grade &&
    (grade.grade_status === "Draft" || grade.grade_status === "Returned")
  ) {
    const calculated = calculateGrade(prelimGrade, midtermGrade, finalGrade);

    return {
      prelimGrade,
      midtermGrade,
      finalGrade,

      finalRating: calculated.complete ? calculated.finalRatingText : "",

      remarks: calculated.complete ? calculated.remarks : "",
    };
  }

  return {
    prelimGrade,
    midtermGrade,
    finalGrade,

    finalRating: gradeValueToString(grade?.final_rating),

    remarks: grade?.remarks || "",
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
    field: EditableGradeField,
    value: string,
  ) => {
    setForms((current) => {
      const currentForm = current[enrollmentSubjectId] || {
        prelimGrade: "",
        midtermGrade: "",
        finalGrade: "",
        finalRating: "",
        remarks: "",
      };

      const nextForm: GradeForm = {
        ...currentForm,
        [field]: value,
      };

      const calculation = calculateGrade(
        nextForm.prelimGrade,
        nextForm.midtermGrade,
        nextForm.finalGrade,
      );

      nextForm.finalRating = calculation.complete
        ? calculation.finalRatingText
        : "";

      nextForm.remarks = calculation.complete ? calculation.remarks : "";

      return {
        ...current,

        [enrollmentSubjectId]: nextForm,
      };
    });

    setRowFeedback((current) => {
      const next = {
        ...current,
      };

      delete next[enrollmentSubjectId];

      return next;
    });
  };

  const buildGradeBody = (form: GradeForm) => {
    const calculation = calculateGrade(
      form.prelimGrade,
      form.midtermGrade,
      form.finalGrade,
    );

    return {
      prelim_grade: toNullableNumber(form.prelimGrade),

      midterm_grade: toNullableNumber(form.midtermGrade),

      final_grade: toNullableNumber(form.finalGrade),

      final_rating: calculation.complete ? calculation.finalRating : null,

      remarks: calculation.complete ? calculation.remarks : null,
    };
  };

  const validateNumericFields = (form: GradeForm): string | null => {
    const fields = [
      {
        label: "Prelim grade",
        value: form.prelimGrade,
      },

      {
        label: "Midterm grade",
        value: form.midtermGrade,
      },

      {
        label: "Final grade",
        value: form.finalGrade,
      },
    ];

    for (const field of fields) {
      const clean = field.value.trim();

      if (!clean) {
        continue;
      }

      const numeric = Number(clean);

      if (!Number.isFinite(numeric)) {
        return `${field.label} must be a valid number.`;
      }

      if (numeric < 1 || numeric > 5) {
        return `${field.label} must be between 1.00 and 5.00.`;
      }
    }

    return null;
  };

  const validateForSubmit = (form: GradeForm): string | null => {
    const numericError = validateNumericFields(form);

    if (numericError) {
      return numericError;
    }

    const missing: string[] = [];

    if (!form.prelimGrade.trim()) {
      missing.push("Prelim");
    }

    if (!form.midtermGrade.trim()) {
      missing.push("Midterm");
    }

    if (!form.finalGrade.trim()) {
      missing.push("Final Grade");
    }

    if (missing.length > 0) {
      return `Complete the following before submission: ${missing.join(", ")}.`;
    }

    const calculation = calculateGrade(
      form.prelimGrade,
      form.midtermGrade,
      form.finalGrade,
    );

    if (
      !calculation.complete ||
      calculation.finalRating === null ||
      !calculation.remarks
    ) {
      return "The Final Rating could not be calculated.";
    }

    return null;
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

    const calculation = calculateGrade(
      form.prelimGrade,
      form.midtermGrade,
      form.finalGrade,
    );

    const confirmed = window.confirm(
      `Submit the grade for ${student.student_number} - ${student.full_name}?\n\nPrelim: ${form.prelimGrade}\nMidterm: ${form.midtermGrade}\nFinal: ${form.finalGrade}\nAverage: ${
        calculation.rawAverage !== null
          ? calculation.rawAverage.toFixed(2)
          : "—"
      }\nFinal Rating: ${calculation.finalRatingText || "—"}\nResult: ${
        calculation.remarks || "—"
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
          <div>
            <button
              type="button"
              className="faculty-grade-back"
              onClick={backToClasses}
            >
              ← Back to My Classes
            </button>

            <span className="faculty-grade-eyebrow">
              Faculty Grade Encoding
            </span>

            <h1>Enter Grades</h1>

            <p>
              Enter the Prelim, Midterm, and Final grades. The system
              automatically calculates the student's Final Rating and academic
              result.
            </p>
          </div>

          <div className="faculty-grade-header-actions">
            <button
              type="button"
              onClick={viewRoster}
              disabled={!selectedOfferingId}
            >
              View Roster
            </button>

            <button
              type="button"
              className="primary"
              onClick={refreshGradebook}
              disabled={gradebookLoading || !selectedOfferingId}
            >
              {gradebookLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </section>

        <section className="faculty-grade-toolbar">
          <div className="faculty-grade-faculty">
            <span>Faculty</span>

            <strong>{faculty?.faculty_name || "Faculty"}</strong>

            <small>{faculty?.employee_number || "—"}</small>
          </div>

          <div className="faculty-grade-class-select">
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
          <section className="faculty-grade-error">
            <div>
              <strong>Assigned classes could not be loaded</strong>

              <p>{classesError}</p>
            </div>
          </section>
        )}

        {selectedClass && (
          <section className="faculty-grade-class-card">
            <div className="faculty-grade-subject">
              <span>Subject</span>

              <strong>{selectedClass.subject.subject_code}</strong>

              <p>{selectedClass.subject.subject_name}</p>
            </div>

            <div className="faculty-grade-class-details">
              <div>
                <span>Section</span>

                <strong>{selectedClass.section.section_name}</strong>

                <small>
                  {selectedClass.section.course.course_code} • Year{" "}
                  {selectedClass.section.year_level}
                </small>
              </div>

              <div>
                <span>Academic Period</span>

                <strong>{selectedClass.academic_period.academic_year}</strong>

                <small>{selectedClass.academic_period.semester_name}</small>
              </div>

              <div>
                <span>Schedule</span>

                <strong>{formatDays(selectedClass.schedule.days)}</strong>

                <small>{selectedClass.schedule.time || "Not scheduled"}</small>
              </div>

              <div>
                <span>Room</span>

                <strong>{getRoomLabel(selectedClass.room)}</strong>

                <small>Room is optional</small>
              </div>

              <div>
                <span>Units</span>

                <strong>{selectedClass.subject.units}</strong>
              </div>

              <div>
                <span>Offering Status</span>

                <strong
                  className={`faculty-grade-offering-status ${selectedClass.offering_status.toLowerCase()}`}
                >
                  {selectedClass.offering_status}
                </strong>
              </div>
            </div>
          </section>
        )}

        <section className="faculty-grade-summary">
          <div>
            <span>Official Students</span>

            <strong>{summary.total_students}</strong>
          </div>

          <div>
            <span>Not Started</span>

            <strong>{summary.without_grade}</strong>
          </div>

          <div>
            <span>Draft</span>

            <strong>{summary.draft}</strong>
          </div>

          <div>
            <span>Submitted</span>

            <strong>{summary.submitted}</strong>
          </div>

          <div>
            <span>Returned</span>

            <strong>{summary.returned}</strong>
          </div>

          <div>
            <span>Approved</span>

            <strong>{summary.approved}</strong>
          </div>
        </section>

        {gradebookError && (
          <section className="faculty-grade-error">
            <div>
              <strong>Gradebook could not be loaded</strong>

              <p>{gradebookError}</p>
            </div>

            <button type="button" onClick={refreshGradebook}>
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
              <div className="faculty-gradebook-header">
                <div>
                  <h2>Class Gradebook</h2>

                  <p>
                    Enter Prelim, Midterm, and Final. Final Rating and Remarks
                    are calculated automatically. Draft and Returned grades are
                    editable. Submitted and Approved grades are locked.
                  </p>
                </div>

                <div className="faculty-gradebook-filters">
                  <input
                    type="text"
                    value={studentSearch}
                    onChange={(event) => setStudentSearch(event.target.value)}
                    placeholder="Search student..."
                  />

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
                </div>
              </div>

              {students.length === 0 ? (
                <div className="faculty-grade-empty">
                  <strong>No official students</strong>

                  <p>This class has no Approved enrollment memberships.</p>
                </div>
              ) : filteredStudents.length === 0 ? (
                <div className="faculty-grade-empty">
                  <strong>No matching students</strong>

                  <p>No gradebook row matches your current filters.</p>

                  <button
                    type="button"
                    onClick={() => {
                      setStudentSearch("");

                      setStatusFilter("All");
                    }}
                  >
                    Clear Filters
                  </button>
                </div>
              ) : (
                <div className="faculty-grade-table-wrapper">
                  <table className="faculty-grade-table">
                    <thead>
                      <tr>
                        <th>Student</th>
                        <th>Prelim</th>
                        <th>Midterm</th>
                        <th>Final</th>
                        <th>Final Rating</th>
                        <th>Remarks</th>
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

                        const calculation = calculateGrade(
                          form.prelimGrade,
                          form.midtermGrade,
                          form.finalGrade,
                        );

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
                                <strong>{student.full_name}</strong>

                                <span>{student.student_number}</span>

                                <small>
                                  ES #{student.enrollment_subject_id}
                                </small>
                              </div>
                            </td>

                            <td>
                              <input
                                className="faculty-grade-input"
                                type="number"
                                min="1"
                                max="5"
                                step="0.01"
                                value={form.prelimGrade}
                                onChange={(event) =>
                                  updateForm(
                                    id,
                                    "prelimGrade",
                                    event.target.value,
                                  )
                                }
                                disabled={!editable || busy}
                                placeholder="—"
                              />
                            </td>

                            <td>
                              <input
                                className="faculty-grade-input"
                                type="number"
                                min="1"
                                max="5"
                                step="0.01"
                                value={form.midtermGrade}
                                onChange={(event) =>
                                  updateForm(
                                    id,
                                    "midtermGrade",
                                    event.target.value,
                                  )
                                }
                                disabled={!editable || busy}
                                placeholder="—"
                              />
                            </td>

                            <td>
                              <input
                                className="faculty-grade-input"
                                type="number"
                                min="1"
                                max="5"
                                step="0.01"
                                value={form.finalGrade}
                                onChange={(event) =>
                                  updateForm(
                                    id,
                                    "finalGrade",
                                    event.target.value,
                                  )
                                }
                                disabled={!editable || busy}
                                placeholder="—"
                              />
                            </td>

                            <td>
                              <div className="faculty-grade-rating-field">
                                <input
                                  className="faculty-grade-input"
                                  type="text"
                                  value={form.finalRating}
                                  readOnly
                                  disabled
                                  placeholder="Auto"
                                />

                                {editable &&
                                  calculation.complete &&
                                  calculation.rawAverage !== null && (
                                    <small>
                                      Average:{" "}
                                      {calculation.rawAverage.toFixed(2)}
                                    </small>
                                  )}

                                {editable && !calculation.complete && (
                                  <small>Auto-calculated</small>
                                )}
                              </div>
                            </td>

                            <td>
                              <select
                                className="faculty-grade-remarks"
                                value={form.remarks}
                                disabled
                              >
                                <option value="">Pending</option>

                                <option value="Passed">Passed</option>

                                <option value="Incomplete">Incomplete</option>

                                <option value="Failed">Failed</option>
                              </select>
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
                                    {formatDateTime(student.grade.submitted_at)}
                                  </small>
                                )}
                              </div>
                            </td>

                            <td>
                              {student.grade?.review?.review_remarks ? (
                                <div className="faculty-grade-review">
                                  <strong>
                                    {student.grade.review
                                      .reviewed_by_username || "Program Head"}
                                  </strong>

                                  <p>{student.grade.review.review_remarks}</p>

                                  <small>
                                    {formatDateTime(
                                      student.grade.review.reviewed_at,
                                    )}
                                  </small>
                                </div>
                              ) : student.grade?.grade_status === "Approved" ? (
                                <div className="faculty-grade-review approved">
                                  <strong>Approved</strong>

                                  <small>
                                    {formatDateTime(
                                      student.grade.review.reviewed_at,
                                    )}
                                  </small>
                                </div>
                              ) : (
                                <span className="faculty-grade-no-review">
                                  —
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
                                      onClick={() => void submitGrade(student)}
                                      disabled={busy}
                                    >
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
              )}
            </section>
          )}

        {!classesLoading && classes.length > 0 && (
          <section className="faculty-grade-workflow">
            <div>
              <span>1</span>

              <div>
                <strong>Encode</strong>

                <p>Enter Prelim, Midterm, and Final grades.</p>
              </div>
            </div>

            <div>
              <span>2</span>

              <div>
                <strong>Calculate</strong>

                <p>
                  Final Rating and academic result are calculated automatically.
                </p>
              </div>
            </div>

            <div>
              <span>3</span>

              <div>
                <strong>Save Draft</strong>

                <p>Draft grades remain editable by Faculty.</p>
              </div>
            </div>

            <div>
              <span>4</span>

              <div>
                <strong>Submit</strong>

                <p>
                  Submitted grades are locked while awaiting Program Head
                  review.
                </p>
              </div>
            </div>
          </section>
        )}
      </main>
    </DashboardLayout>
  );
}
