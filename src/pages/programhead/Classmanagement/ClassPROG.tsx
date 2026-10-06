import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/ClassPROG.css";

const API_BASE_URL = "http://localhost:3000/api/program-head/classes";

type GradeRemark = "Passed" | "Failed" | "Incomplete";

interface GradeComputation {
  complete: boolean;
  rawAverage: number | null;
  finalRating: number | null;
  finalRatingText: string;
  remarks: GradeRemark | null;
}

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

interface FacultyInfo {
  faculty_id: number;
  employee_number: string;
  first_name?: string;
  middle_name?: string | null;
  last_name?: string;
  faculty_name: string;
  email: string | null;
}

interface RoomInfo {
  room_id: number;
  room_code: string | null;
  room_name: string | null;
}

interface ClassItem {
  offering_id: number;
  section_subject_id: number;

  offering_status: string;
  section_subject_status: string;

  grading_ready: boolean;
  grading_block_reason: string | null;

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

  faculty: FacultyInfo | null;

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

  room: RoomInfo | null;

  capacity: {
    max_students: number;
    official_students: number;
  };

  grades: {
    draft: number;
    submitted: number;
    returned: number;
    approved: number;
    total_with_grade: number;
    without_grade: number;
  };

  created_at: string | null;
}

interface ClassesResponse {
  success: boolean;

  program_head?: ProgramHeadInfo;

  classes?: ClassItem[];

  message?: string;
  error?: string;
}

interface GradeInfo {
  grade_id: number;
  faculty_id: number | null;

  prelim_grade: number | null;
  midterm_grade: number | null;
  final_grade: number | null;
  final_rating: number | null;

  remarks: string | null;
  grade_status: string;

  submitted_at: string | null;

  review: {
    reviewed_by: number | null;
    reviewed_by_username: string | null;
    reviewed_at: string | null;
    review_remarks: string | null;
  };

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

  grade: GradeInfo | null;
}

interface GradebookResponse {
  success: boolean;

  summary?: {
    total_students: number;
    without_grade: number;
    draft: number;
    submitted: number;
    returned: number;
    approved: number;
  };

  students?: GradebookStudent[];

  message?: string;
  error?: string;
}

interface DirectGradeResponse {
  success: boolean;

  message?: string;
  error?: string;

  grade?: {
    grade_id: number;
    enrollment_subject_id: number;
    faculty_id: number;

    prelim_grade: number | null;
    midterm_grade: number | null;
    final_grade: number | null;
    final_rating: number | null;

    remarks: string;
    grade_status: string;

    submitted_at: string | null;

    reviewed_by: number | null;
    reviewed_by_username?: string | null;
    reviewed_at: string | null;
    review_remarks: string | null;

    subject_status?: string;
  };
}

interface DirectGradeForm {
  prelim_grade: string;
  midterm_grade: string;
  final_grade: string;
}

interface Notice {
  type: "success" | "error";
  message: string;
}

const GRADE_OPTIONS = [
  "1.00",
  "1.25",
  "1.50",
  "1.75",
  "2.00",
  "2.25",
  "2.50",
  "2.75",
  "3.00",
  "4.00",
  "5.00",
];

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

function formatGrade(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }

  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric.toFixed(2) : "—";
}

function getRoomLabel(room: RoomInfo | null): string {
  if (!room) {
    return "No room assigned";
  }

  return room.room_code || room.room_name || `Room ${room.room_id}`;
}

function getGradeStatusClass(status: string | null | undefined): string {
  if (!status) {
    return "none";
  }

  return status.toLowerCase().replace(/\s+/g, "-");
}

function getSubjectStatusClass(status: string): string {
  return status.toLowerCase().replace(/\s+/g, "-");
}

function nullableGrade(value: string): number | null {
  const clean = value.trim();

  if (!clean) {
    return null;
  }

  const numeric = Number(clean);

  return Number.isFinite(numeric) ? numeric : null;
}

function getRemarkFromFinalRating(
  finalRating: number | null,
): GradeRemark | null {
  if (finalRating === null) {
    return null;
  }

  if (finalRating >= 1 && finalRating <= 3) {
    return "Passed";
  }

  if (finalRating === 4) {
    return "Incomplete";
  }

  if (finalRating === 5) {
    return "Failed";
  }

  return null;
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
      remarks: null,
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
      remarks: null,
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

export default function ClassPROG() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();

  const authenticated = Boolean(session && token);
  const userRole = session?.role;

  const [programHead, setProgramHead] = useState<ProgramHeadInfo | null>(null);

  const [classes, setClasses] = useState<ClassItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [search, setSearch] = useState("");
  const [academicYearFilter, setAcademicYearFilter] = useState("All");
  const [semesterFilter, setSemesterFilter] = useState("All");
  const [courseFilter, setCourseFilter] = useState("All");
  const [facultyFilter, setFacultyFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [gradingFilter, setGradingFilter] = useState("All");

  const [selectedClass, setSelectedClass] = useState<ClassItem | null>(null);

  const [gradebook, setGradebook] = useState<GradebookResponse | null>(null);

  const [gradebookLoading, setGradebookLoading] = useState(false);
  const [gradebookError, setGradebookError] = useState("");

  const [gradebookNotice, setGradebookNotice] = useState<Notice | null>(null);

  const [directStudent, setDirectStudent] = useState<GradebookStudent | null>(
    null,
  );

  const [directForm, setDirectForm] = useState<DirectGradeForm>({
    prelim_grade: "",
    midterm_grade: "",
    final_grade: "",
  });

  const [directError, setDirectError] = useState("");

  const [directSubmitting, setDirectSubmitting] = useState(false);

  const [confirmDirectGrade, setConfirmDirectGrade] = useState(false);

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

    const loadClasses = async () => {
      try {
        setLoading(true);
        setError("");

        const response = await authService.authFetch(API_BASE_URL, {
          method: "GET",
          signal: controller.signal,
        });

        const data = await readJsonResponse<ClassesResponse>(response);

        if (response.status === 401) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

          return;
        }

        if (response.status === 403) {
          throw new Error(data.message || "Program Head access is required.");
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message ||
              data.error ||
              "Unable to load Program Head classes.",
          );
        }

        const loadedClasses = Array.isArray(data.classes)
          ? data.classes.filter((item) =>
              [1, 2].includes(Number(item.academic_period.semester_id)),
            )
          : [];

        setProgramHead(data.program_head || null);
        setClasses(loadedClasses);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD PROGRAM HEAD CLASSES ERROR:", requestError);

        setProgramHead(null);
        setClasses([]);

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load Program Head classes.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadClasses();

    return () => {
      controller.abort();
    };
  }, [authenticated, userRole, navigate, refreshKey]);

  const academicYears = useMemo(() => {
    const values = new Map<number, string>();

    classes.forEach((item) => {
      values.set(
        item.academic_period.academic_year_id,
        item.academic_period.academic_year,
      );
    });

    return Array.from(values.entries()).sort((a, b) => b[0] - a[0]);
  }, [classes]);

  const semesters = useMemo(() => {
    const values = new Map<number, string>();

    classes.forEach((item) => {
      const semesterId = Number(item.academic_period.semester_id);

      if (![1, 2].includes(semesterId)) {
        return;
      }

      values.set(semesterId, item.academic_period.semester_name);
    });

    return Array.from(values.entries()).sort((a, b) => a[0] - b[0]);
  }, [classes]);

  const courses = useMemo(() => {
    return Array.from(
      new Map(
        classes.map((item) => [
          item.section.course.course_id,
          item.section.course.course_code,
        ]),
      ).entries(),
    ).sort((a, b) => a[1].localeCompare(b[1]));
  }, [classes]);

  const faculties = useMemo(() => {
    return Array.from(
      new Map(
        classes
          .filter((item) => item.faculty !== null)
          .map((item) => [
            item.faculty!.faculty_id,
            item.faculty!.faculty_name,
          ]),
      ).entries(),
    ).sort((a, b) => a[1].localeCompare(b[1]));
  }, [classes]);

  const filteredClasses = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return classes.filter((item) => {
      const facultyName = item.faculty?.faculty_name || "";
      const employeeNumber = item.faculty?.employee_number || "";

      const matchesSearch =
        !normalizedSearch ||
        item.subject.subject_code.toLowerCase().includes(normalizedSearch) ||
        item.subject.subject_name.toLowerCase().includes(normalizedSearch) ||
        item.section.section_name.toLowerCase().includes(normalizedSearch) ||
        item.section.course.course_code
          .toLowerCase()
          .includes(normalizedSearch) ||
        item.section.course.course_name
          .toLowerCase()
          .includes(normalizedSearch) ||
        facultyName.toLowerCase().includes(normalizedSearch) ||
        employeeNumber.toLowerCase().includes(normalizedSearch);

      const matchesAcademicYear =
        academicYearFilter === "All" ||
        String(item.academic_period.academic_year_id) === academicYearFilter;

      const matchesSemester =
        semesterFilter === "All" ||
        String(item.academic_period.semester_id) === semesterFilter;

      const matchesCourse =
        courseFilter === "All" ||
        String(item.section.course.course_id) === courseFilter;

      const matchesFaculty =
        facultyFilter === "All" ||
        (facultyFilter === "Unassigned"
          ? item.faculty === null
          : String(item.faculty?.faculty_id) === facultyFilter);

      const matchesStatus =
        statusFilter === "All" || item.offering_status === statusFilter;

      const matchesGrading =
        gradingFilter === "All" ||
        (gradingFilter === "Ready"
          ? item.grading_ready
          : gradingFilter === "Blocked"
            ? !item.grading_ready
            : true);

      return (
        matchesSearch &&
        matchesAcademicYear &&
        matchesSemester &&
        matchesCourse &&
        matchesFaculty &&
        matchesStatus &&
        matchesGrading
      );
    });
  }, [
    classes,
    search,
    academicYearFilter,
    semesterFilter,
    courseFilter,
    facultyFilter,
    statusFilter,
    gradingFilter,
  ]);

  const summary = useMemo(() => {
    return {
      totalClasses: filteredClasses.length,

      gradingReady: filteredClasses.filter((item) => item.grading_ready).length,

      withoutFaculty: filteredClasses.filter((item) => !item.faculty).length,

      officialStudents: filteredClasses.reduce(
        (total, item) => total + item.capacity.official_students,
        0,
      ),

      submittedGrades: filteredClasses.reduce(
        (total, item) => total + item.grades.submitted,
        0,
      ),

      approvedGrades: filteredClasses.reduce(
        (total, item) => total + item.grades.approved,
        0,
      ),
    };
  }, [filteredClasses]);

  const directGradeResult = useMemo(
    () =>
      calculateGrade(
        directForm.prelim_grade,
        directForm.midterm_grade,
        directForm.final_grade,
      ),
    [directForm.prelim_grade, directForm.midterm_grade, directForm.final_grade],
  );

  const clearFilters = () => {
    setSearch("");
    setAcademicYearFilter("All");
    setSemesterFilter("All");
    setCourseFilter("All");
    setFacultyFilter("All");
    setStatusFilter("All");
    setGradingFilter("All");
  };

  const refreshClasses = () => {
    setRefreshKey((current) => current + 1);
  };

  const loadGradebook = async (item: ClassItem) => {
    try {
      setGradebookLoading(true);
      setGradebookError("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${item.offering_id}/gradebook`,
        {
          method: "GET",
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

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Unable to load class gradebook.",
        );
      }

      setGradebook(data);
    } catch (requestError) {
      console.error("LOAD PROGRAM HEAD CLASS GRADEBOOK ERROR:", requestError);

      setGradebook(null);

      setGradebookError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load class gradebook.",
      );
    } finally {
      setGradebookLoading(false);
    }
  };

  const openClass = async (item: ClassItem) => {
    setSelectedClass(item);

    setGradebook(null);
    setGradebookError("");
    setGradebookNotice(null);

    await loadGradebook(item);
  };

  const closeClass = () => {
    if (gradebookLoading || directSubmitting) {
      return;
    }

    setConfirmDirectGrade(false);

    setSelectedClass(null);

    setGradebook(null);
    setGradebookError("");
    setGradebookNotice(null);

    setDirectStudent(null);

    setDirectForm({
      prelim_grade: "",
      midterm_grade: "",
      final_grade: "",
    });

    setDirectError("");
  };

  const openDirectGrade = (student: GradebookStudent) => {
    if (!selectedClass) {
      return;
    }

    if (!selectedClass.grading_ready || !selectedClass.faculty) {
      setGradebookNotice({
        type: "error",

        message:
          selectedClass.grading_block_reason ||
          "Direct grade encoding is unavailable for this class.",
      });

      return;
    }

    if (student.grade) {
      setGradebookNotice({
        type: "error",

        message:
          "A grade already exists for this student. Existing grade work cannot be overwritten.",
      });

      return;
    }

    if (student.subject_status !== "Enrolled") {
      setGradebookNotice({
        type: "error",

        message:
          "Direct grade encoding is only available for actively enrolled subjects without an existing grade.",
      });

      return;
    }

    setConfirmDirectGrade(false);

    setDirectStudent(student);

    setDirectForm({
      prelim_grade: "",
      midterm_grade: "",
      final_grade: "",
    });

    setDirectError("");
  };

  const closeDirectGrade = () => {
    if (directSubmitting) {
      return;
    }

    setConfirmDirectGrade(false);

    setDirectStudent(null);

    setDirectForm({
      prelim_grade: "",
      midterm_grade: "",
      final_grade: "",
    });

    setDirectError("");
  };

  const submitDirectGrade = () => {
    if (!selectedClass || !directStudent) {
      return;
    }

    setDirectError("");

    if (!selectedClass.grading_ready || !selectedClass.faculty) {
      setDirectError(
        selectedClass.grading_block_reason ||
          "Direct grade encoding is unavailable for this offering.",
      );

      return;
    }

    if (directStudent.grade) {
      setDirectError(
        "A grade already exists for this student and cannot be overwritten.",
      );

      return;
    }

    if (directStudent.subject_status !== "Enrolled") {
      setDirectError(
        "This student subject is no longer actively enrolled and cannot receive a new direct grade.",
      );

      return;
    }

    const missing: string[] = [];

    if (!directForm.prelim_grade.trim()) {
      missing.push("Prelim");
    }

    if (!directForm.midterm_grade.trim()) {
      missing.push("Midterm");
    }

    if (!directForm.final_grade.trim()) {
      missing.push("Final");
    }

    if (missing.length > 0) {
      setDirectError(
        `Complete the following before submission: ${missing.join(", ")}.`,
      );

      return;
    }

    const componentValues = [
      {
        label: "Prelim",
        value: directForm.prelim_grade,
      },
      {
        label: "Midterm",
        value: directForm.midterm_grade,
      },
      {
        label: "Final",
        value: directForm.final_grade,
      },
    ];

    for (const field of componentValues) {
      const value = Number(field.value);

      if (!Number.isFinite(value) || value < 1 || value > 5) {
        setDirectError(`${field.label} grade must be between 1.00 and 5.00.`);

        return;
      }
    }

    if (
      !directGradeResult.complete ||
      directGradeResult.finalRating === null ||
      !directGradeResult.remarks
    ) {
      setDirectError("The Final Rating could not be calculated.");

      return;
    }

    setConfirmDirectGrade(true);
  };

  const confirmAndApproveDirectGrade = async () => {
    if (!selectedClass || !directStudent) {
      return;
    }

    const gradeResult = calculateGrade(
      directForm.prelim_grade,
      directForm.midterm_grade,
      directForm.final_grade,
    );

    if (
      !gradeResult.complete ||
      gradeResult.finalRating === null ||
      !gradeResult.remarks
    ) {
      setConfirmDirectGrade(false);

      setDirectError("The Final Rating could not be calculated.");

      return;
    }

    try {
      setDirectSubmitting(true);

      setDirectError("");
      setGradebookNotice(null);

      const response = await authService.authFetch(
        `${API_BASE_URL}/${selectedClass.offering_id}/grades/${directStudent.enrollment_subject_id}/direct-approve`,
        {
          method: "PUT",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            prelim_grade: nullableGrade(directForm.prelim_grade),

            midterm_grade: nullableGrade(directForm.midterm_grade),

            final_grade: nullableGrade(directForm.final_grade),

            final_rating: gradeResult.finalRating,

            remarks: gradeResult.remarks,
          }),
        },
      );

      const data = await readJsonResponse<DirectGradeResponse>(response);

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
            "Unable to directly encode and approve grade.",
        );
      }

      setConfirmDirectGrade(false);

      setGradebookNotice({
        type: "success",

        message:
          data.message ||
          "Grade encoded and approved successfully by Program Head.",
      });

      setDirectStudent(null);

      setDirectForm({
        prelim_grade: "",
        midterm_grade: "",
        final_grade: "",
      });

      await loadGradebook(selectedClass);

      setRefreshKey((current) => current + 1);
    } catch (requestError) {
      console.error("PROGRAM HEAD DIRECT GRADE ERROR:", requestError);

      setConfirmDirectGrade(false);

      setDirectError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to directly encode and approve grade.",
      );
    } finally {
      setDirectSubmitting(false);
    }
  };

  useEffect(() => {
    if (!selectedClass) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (confirmDirectGrade) {
        if (!directSubmitting) {
          setConfirmDirectGrade(false);
        }

        return;
      }

      if (directStudent) {
        if (!directSubmitting) {
          setDirectStudent(null);

          setDirectForm({
            prelim_grade: "",
            midterm_grade: "",
            final_grade: "",
          });

          setDirectError("");
        }

        return;
      }

      if (!gradebookLoading) {
        setSelectedClass(null);

        setGradebook(null);
        setGradebookError("");
        setGradebookNotice(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    const originalOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);

      document.body.style.overflow = originalOverflow;
    };
  }, [
    selectedClass,
    directStudent,
    directSubmitting,
    gradebookLoading,
    confirmDirectGrade,
  ]);

  if (!authenticated || userRole !== "Program Head") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="programhead-class-management">
        <section className="programhead-class-header">
          <div>
            <span className="programhead-class-eyebrow">Program Head</span>

            <h1>Class Management</h1>

            <p>
              Monitor department classes, Faculty assignments, official
              students, schedules, grade progress, and authorized direct grade
              encoding.
            </p>
          </div>

          <button
            type="button"
            className="programhead-class-refresh"
            onClick={refreshClasses}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh Classes"}
          </button>
        </section>

        {programHead && (
          <section className="programhead-class-profile">
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

            <div>
              <span>Department Classes</span>

              <strong>{classes.length}</strong>
            </div>
          </section>
        )}

        <section className="programhead-class-summary">
          <article>
            <span>Total Classes</span>

            <strong>{summary.totalClasses}</strong>

            <small>Current filtered result</small>
          </article>

          <article>
            <span>Grading Ready</span>

            <strong>{summary.gradingReady}</strong>

            <small>Faculty assigned</small>
          </article>

          <article>
            <span>Without Faculty</span>

            <strong>{summary.withoutFaculty}</strong>

            <small>Requires assignment</small>
          </article>

          <article>
            <span>Official Students</span>

            <strong>{summary.officialStudents}</strong>

            <small>Approved enrollment</small>
          </article>

          <article>
            <span>Submitted Grades</span>

            <strong>{summary.submittedGrades}</strong>

            <small>Waiting for review</small>
          </article>

          <article>
            <span>Approved Grades</span>

            <strong>{summary.approvedGrades}</strong>

            <small>Official results</small>
          </article>
        </section>

        <section className="programhead-class-filter-panel">
          <div className="programhead-class-filter-title">
            <div>
              <span>Class Directory</span>

              <h2>Department Classes</h2>
            </div>

            <p>
              {filteredClasses.length} of {classes.length} classes shown
            </p>
          </div>

          <div className="programhead-class-filters">
            <div className="programhead-class-search">
              <label htmlFor="programhead-class-search">Search</label>

              <input
                id="programhead-class-search"
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Subject, section, course, faculty..."
              />
            </div>

            <div>
              <label>Academic Year</label>

              <select
                value={academicYearFilter}
                onChange={(event) => setAcademicYearFilter(event.target.value)}
              >
                <option value="All">All</option>

                {academicYears.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label>Semester</label>

              <select
                value={semesterFilter}
                onChange={(event) => setSemesterFilter(event.target.value)}
              >
                <option value="All">All</option>

                {semesters.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label>Course</label>

              <select
                value={courseFilter}
                onChange={(event) => setCourseFilter(event.target.value)}
              >
                <option value="All">All</option>

                {courses.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label>Faculty</label>

              <select
                value={facultyFilter}
                onChange={(event) => setFacultyFilter(event.target.value)}
              >
                <option value="All">All</option>

                <option value="Unassigned">Unassigned</option>

                {faculties.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label>Class Status</label>

              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="All">All</option>

                <option value="Open">Open</option>

                <option value="Closed">Closed</option>
              </select>
            </div>

            <div>
              <label>Grading</label>

              <select
                value={gradingFilter}
                onChange={(event) => setGradingFilter(event.target.value)}
              >
                <option value="All">All</option>

                <option value="Ready">Ready</option>

                <option value="Blocked">Blocked</option>
              </select>
            </div>

            <button
              type="button"
              className="programhead-class-clear"
              onClick={clearFilters}
            >
              Clear Filters
            </button>
          </div>
        </section>

        {error && (
          <section className="programhead-class-error">
            <div>
              <strong>Classes could not be loaded</strong>

              <p>{error}</p>
            </div>

            <button type="button" onClick={refreshClasses}>
              Try Again
            </button>
          </section>
        )}

        {!error && (
          <section className="programhead-class-table-card">
            {loading ? (
              <div className="programhead-class-state">
                <div className="programhead-class-spinner" />

                <strong>Loading department classes</strong>

                <p>
                  Retrieving class offerings, Faculty assignments, and grade
                  progress.
                </p>
              </div>
            ) : filteredClasses.length === 0 ? (
              <div className="programhead-class-state">
                <div className="programhead-class-state-icon">0</div>

                <strong>No classes found</strong>

                <p>No department classes match the selected filters.</p>

                <button type="button" onClick={clearFilters}>
                  Clear Filters
                </button>
              </div>
            ) : (
              <div className="programhead-class-table-scroll">
                <table className="programhead-class-table">
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th>Section</th>
                      <th>Faculty</th>
                      <th>Academic Period</th>
                      <th>Schedule</th>
                      <th>Students</th>
                      <th>Grade Progress</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredClasses.map((item) => {
                      const totalStudents = item.capacity.official_students;

                      const approvedPercent =
                        totalStudents > 0
                          ? Math.min(
                              100,
                              Math.round(
                                (item.grades.approved / totalStudents) * 100,
                              ),
                            )
                          : 0;

                      return (
                        <tr key={item.offering_id}>
                          <td>
                            <div className="programhead-class-subject">
                              <div className="programhead-class-subject-code">
                                {item.subject.subject_code}
                              </div>

                              <div>
                                <strong>{item.subject.subject_name}</strong>

                                <span>
                                  {item.subject.units} unit
                                  {item.subject.units === 1 ? "" : "s"}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td>
                            <div className="programhead-class-section">
                              <strong>{item.section.section_name}</strong>

                              <span>
                                {item.section.course.course_code} · Year{" "}
                                {item.section.year_level}
                              </span>
                            </div>
                          </td>

                          <td>
                            {item.faculty ? (
                              <div className="programhead-class-faculty">
                                <strong>{item.faculty.faculty_name}</strong>

                                <span>{item.faculty.employee_number}</span>
                              </div>
                            ) : (
                              <span className="programhead-class-unassigned">
                                No Faculty
                              </span>
                            )}
                          </td>

                          <td>
                            <div className="programhead-class-period">
                              <strong>
                                {item.academic_period.academic_year}
                              </strong>

                              <span>{item.academic_period.semester_name}</span>

                              {item.academic_period
                                .is_current_academic_year && (
                                <small>Current AY</small>
                              )}
                            </div>
                          </td>

                          <td>
                            <div className="programhead-class-schedule">
                              <strong>{formatDays(item.schedule.days)}</strong>

                              <span>
                                {item.schedule.time || "No time assigned"}
                              </span>

                              <small>{getRoomLabel(item.room)}</small>
                            </div>
                          </td>

                          <td>
                            <div className="programhead-class-capacity">
                              <strong>{item.capacity.official_students}</strong>

                              <span>/ {item.capacity.max_students || "—"}</span>
                            </div>
                          </td>

                          <td>
                            <div className="programhead-class-grade-progress">
                              <div className="programhead-class-grade-line">
                                <span>
                                  Approved {item.grades.approved}/
                                  {totalStudents}
                                </span>

                                <strong>{approvedPercent}%</strong>
                              </div>

                              <div className="programhead-class-progress-track">
                                <div
                                  className="programhead-class-progress-value"
                                  style={{
                                    width: `${approvedPercent}%`,
                                  }}
                                />
                              </div>

                              <div className="programhead-class-grade-counts">
                                {item.grades.submitted > 0 && (
                                  <span className="submitted">
                                    {item.grades.submitted} submitted
                                  </span>
                                )}

                                {item.grades.returned > 0 && (
                                  <span className="returned">
                                    {item.grades.returned} returned
                                  </span>
                                )}

                                {item.grades.draft > 0 && (
                                  <span className="draft">
                                    {item.grades.draft} draft
                                  </span>
                                )}

                                {item.grades.without_grade > 0 && (
                                  <span className="none">
                                    {item.grades.without_grade} no grade
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>

                          <td>
                            <div className="programhead-class-status-stack">
                              <span
                                className={`programhead-class-status ${item.offering_status.toLowerCase()}`}
                              >
                                {item.offering_status}
                              </span>

                              <span
                                className={`programhead-class-grading-status ${
                                  item.grading_ready ? "ready" : "blocked"
                                }`}
                              >
                                {item.grading_ready
                                  ? "Grading Ready"
                                  : "Grading Blocked"}
                              </span>
                            </div>
                          </td>

                          <td>
                            <button
                              type="button"
                              className="programhead-class-manage"
                              onClick={() => void openClass(item)}
                            >
                              Manage
                            </button>
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

        {selectedClass && (
          <div
            className="programhead-gradebook-backdrop"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target && !directStudent) {
                closeClass();
              }
            }}
          >
            <section className="programhead-gradebook-modal">
              <header className="programhead-gradebook-header">
                <div>
                  <span>Class Management</span>

                  <h2>
                    {selectedClass.subject.subject_code} ·{" "}
                    {selectedClass.section.section_name}
                  </h2>

                  <p>{selectedClass.subject.subject_name}</p>
                </div>

                <button
                  type="button"
                  className="programhead-gradebook-close"
                  onClick={closeClass}
                  disabled={gradebookLoading || directSubmitting}
                >
                  ×
                </button>
              </header>

              <div className="programhead-gradebook-meta">
                <div>
                  <span>Faculty</span>

                  <strong>
                    {selectedClass.faculty?.faculty_name ||
                      "No Faculty assigned"}
                  </strong>
                </div>

                <div>
                  <span>Academic Period</span>

                  <strong>{selectedClass.academic_period.academic_year}</strong>

                  <small>{selectedClass.academic_period.semester_name}</small>
                </div>

                <div>
                  <span>Schedule</span>

                  <strong>{formatDays(selectedClass.schedule.days)}</strong>

                  <small>
                    {selectedClass.schedule.time || "No time assigned"}
                  </small>
                </div>

                <div>
                  <span>Room</span>

                  <strong>{getRoomLabel(selectedClass.room)}</strong>
                </div>
              </div>

              {gradebookNotice && (
                <div
                  className={`programhead-gradebook-notice ${gradebookNotice.type}`}
                >
                  <strong>
                    {gradebookNotice.type === "success"
                      ? "Class record updated"
                      : "Action could not be completed"}
                  </strong>

                  <p>{gradebookNotice.message}</p>
                </div>
              )}

              {gradebookLoading && (
                <div className="programhead-gradebook-loading">
                  <div className="programhead-class-spinner" />

                  <strong>Loading class gradebook</strong>

                  <p>Retrieving officially enrolled students and grades.</p>
                </div>
              )}

              {gradebookError && !gradebookLoading && (
                <div className="programhead-gradebook-error">
                  <strong>Class gradebook could not be loaded</strong>

                  <p>{gradebookError}</p>

                  <button
                    type="button"
                    onClick={() => void loadGradebook(selectedClass)}
                  >
                    Try Again
                  </button>
                </div>
              )}

              {!gradebookLoading && !gradebookError && gradebook?.summary && (
                <>
                  <div className="programhead-gradebook-summary">
                    <div>
                      <span>Students</span>

                      <strong>{gradebook.summary.total_students}</strong>
                    </div>

                    <div>
                      <span>No Grade</span>

                      <strong>{gradebook.summary.without_grade}</strong>
                    </div>

                    <div>
                      <span>Draft</span>

                      <strong>{gradebook.summary.draft}</strong>
                    </div>

                    <div>
                      <span>Submitted</span>

                      <strong>{gradebook.summary.submitted}</strong>
                    </div>

                    <div>
                      <span>Returned</span>

                      <strong>{gradebook.summary.returned}</strong>
                    </div>

                    <div>
                      <span>Approved</span>

                      <strong>{gradebook.summary.approved}</strong>
                    </div>
                  </div>

                  {!selectedClass.grading_ready && (
                    <div className="programhead-direct-blocked-notice">
                      <strong>Direct grade encoding unavailable</strong>

                      <p>
                        {selectedClass.grading_block_reason ||
                          "A Faculty assignment is required before this class can receive grades."}
                      </p>
                    </div>
                  )}

                  <div className="programhead-gradebook-body">
                    {!gradebook.students || gradebook.students.length === 0 ? (
                      <div className="programhead-gradebook-empty">
                        <strong>No official students</strong>

                        <p>
                          No approved-enrollment students are currently attached
                          to this offering.
                        </p>
                      </div>
                    ) : (
                      <div className="programhead-gradebook-table-scroll">
                        <table className="programhead-gradebook-table">
                          <thead>
                            <tr>
                              <th>Student</th>
                              <th>Subject Status</th>
                              <th>Prelim</th>
                              <th>Midterm</th>
                              <th>Final</th>
                              <th>Rating</th>
                              <th>Remarks</th>
                              <th>Grade Status</th>
                              <th>Action</th>
                            </tr>
                          </thead>

                          <tbody>
                            {gradebook.students.map((student) => {
                              const canDirectEncode =
                                selectedClass.grading_ready &&
                                selectedClass.faculty !== null &&
                                student.grade === null &&
                                student.subject_status === "Enrolled";

                              return (
                                <tr key={student.enrollment_subject_id}>
                                  <td>
                                    <div className="programhead-gradebook-student">
                                      <strong>{student.full_name}</strong>

                                      <span>{student.student_number}</span>
                                    </div>
                                  </td>

                                  <td>
                                    <span
                                      className={`programhead-subject-status ${getSubjectStatusClass(
                                        student.subject_status,
                                      )}`}
                                    >
                                      {student.subject_status}
                                    </span>
                                  </td>

                                  <td>
                                    {formatGrade(student.grade?.prelim_grade)}
                                  </td>

                                  <td>
                                    {formatGrade(student.grade?.midterm_grade)}
                                  </td>

                                  <td>
                                    {formatGrade(student.grade?.final_grade)}
                                  </td>

                                  <td>
                                    <strong>
                                      {formatGrade(student.grade?.final_rating)}
                                    </strong>
                                  </td>

                                  <td>
                                    {student.grade?.remarks ? (
                                      <span
                                        className={`programhead-grade-remark ${student.grade.remarks.toLowerCase()}`}
                                      >
                                        {student.grade.remarks}
                                      </span>
                                    ) : (
                                      <span className="programhead-grade-muted">
                                        —
                                      </span>
                                    )}
                                  </td>

                                  <td>
                                    {student.grade ? (
                                      <span
                                        className={`programhead-grade-status ${getGradeStatusClass(
                                          student.grade.grade_status,
                                        )}`}
                                      >
                                        {student.grade.grade_status}
                                      </span>
                                    ) : (
                                      <span className="programhead-grade-status none">
                                        No Grade
                                      </span>
                                    )}
                                  </td>

                                  <td>
                                    {canDirectEncode ? (
                                      <button
                                        type="button"
                                        className="programhead-direct-grade-button"
                                        onClick={() => openDirectGrade(student)}
                                      >
                                        Encode Grade
                                      </button>
                                    ) : student.grade ? (
                                      <span className="programhead-grade-action-label locked">
                                        Existing Grade
                                      </span>
                                    ) : (
                                      <span className="programhead-grade-action-label blocked">
                                        Unavailable
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
                  </div>
                </>
              )}
            </section>
          </div>
        )}

        {selectedClass && directStudent && (
          <div
            className="programhead-direct-grade-backdrop"
            onMouseDown={(event) => {
              if (event.currentTarget !== event.target || directSubmitting) {
                return;
              }

              if (confirmDirectGrade) {
                setConfirmDirectGrade(false);

                return;
              }

              closeDirectGrade();
            }}
          >
            {!confirmDirectGrade ? (
              <section className="programhead-direct-grade-modal">
                <header className="programhead-direct-grade-header">
                  <div>
                    <span>Program Head Direct Encoding</span>

                    <h2>Encode Student Grade</h2>

                    <p>
                      Enter Prelim, Midterm, and Final. Final Rating and
                      academic result are calculated automatically.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={closeDirectGrade}
                    disabled={directSubmitting}
                    aria-label="Close grade encoding"
                  >
                    ×
                  </button>
                </header>

                <div className="programhead-direct-grade-student">
                  <div>
                    <span>Student</span>

                    <strong>{directStudent.full_name}</strong>

                    <small>{directStudent.student_number}</small>
                  </div>

                  <div>
                    <span>Subject</span>

                    <strong>{selectedClass.subject.subject_code}</strong>

                    <small>{selectedClass.subject.subject_name}</small>
                  </div>

                  <div>
                    <span>Section</span>

                    <strong>{selectedClass.section.section_name}</strong>

                    <small>
                      {selectedClass.section.course.course_code} · Year{" "}
                      {selectedClass.section.year_level}
                    </small>
                  </div>

                  <div>
                    <span>Assigned Faculty</span>

                    <strong>
                      {selectedClass.faculty?.faculty_name || "—"}
                    </strong>

                    <small>
                      {selectedClass.faculty?.employee_number || "—"}
                    </small>
                  </div>
                </div>

                <div className="programhead-direct-grade-warning">
                  <div>!</div>

                  <p>
                    <strong>Final Rating is calculated automatically.</strong>{" "}
                    The system calculates the average of Prelim, Midterm, and
                    Final, then normalizes it to the official grading scale.
                  </p>
                </div>

                <div className="programhead-direct-grade-form">
                  <div>
                    <label>Prelim Grade</label>

                    <select
                      value={directForm.prelim_grade}
                      onChange={(event) =>
                        setDirectForm((current) => ({
                          ...current,

                          prelim_grade: event.target.value,
                        }))
                      }
                      disabled={directSubmitting}
                    >
                      <option value="">Select grade</option>

                      {GRADE_OPTIONS.map((grade) => (
                        <option key={grade} value={grade}>
                          {grade}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label>Midterm Grade</label>

                    <select
                      value={directForm.midterm_grade}
                      onChange={(event) =>
                        setDirectForm((current) => ({
                          ...current,

                          midterm_grade: event.target.value,
                        }))
                      }
                      disabled={directSubmitting}
                    >
                      <option value="">Select grade</option>

                      {GRADE_OPTIONS.map((grade) => (
                        <option key={grade} value={grade}>
                          {grade}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label>Final Grade</label>

                    <select
                      value={directForm.final_grade}
                      onChange={(event) =>
                        setDirectForm((current) => ({
                          ...current,

                          final_grade: event.target.value,
                        }))
                      }
                      disabled={directSubmitting}
                    >
                      <option value="">Select grade</option>

                      {GRADE_OPTIONS.map((grade) => (
                        <option key={grade} value={grade}>
                          {grade}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label>Final Rating</label>

                    <select value={directGradeResult.finalRatingText} disabled>
                      <option value="">Auto-calculated</option>

                      {GRADE_OPTIONS.map((grade) => (
                        <option key={grade} value={grade}>
                          {grade}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="programhead-direct-grade-result">
                  <span>Calculated Academic Result</span>

                  {!directGradeResult.complete ? (
                    <strong className="none">Complete All Three Grades</strong>
                  ) : directGradeResult.remarks ? (
                    <strong className={directGradeResult.remarks.toLowerCase()}>
                      {directGradeResult.remarks}
                    </strong>
                  ) : (
                    <strong className="none">Unable to Calculate</strong>
                  )}

                  {directGradeResult.rawAverage !== null ? (
                    <small>
                      Average: {directGradeResult.rawAverage.toFixed(2)} · Final
                      Rating: {directGradeResult.finalRatingText}
                    </small>
                  ) : (
                    <small>
                      Final Rating = normalized average of Prelim + Midterm +
                      Final
                    </small>
                  )}
                </div>

                {directGradeResult.remarks === "Incomplete" && (
                  <div className="programhead-direct-incomplete-note">
                    The calculated Final Rating is 4.00. This academic result
                    will be recorded as Incomplete.
                  </div>
                )}

                {directGradeResult.remarks === "Failed" && (
                  <div className="programhead-direct-incomplete-note">
                    The calculated Final Rating is 5.00. This academic result
                    will be recorded as Failed.
                  </div>
                )}

                {directError && (
                  <div className="programhead-direct-grade-error">
                    <strong>Grade could not be reviewed</strong>

                    <p>{directError}</p>
                  </div>
                )}

                <footer className="programhead-direct-grade-actions">
                  <button
                    type="button"
                    className="programhead-direct-cancel"
                    onClick={closeDirectGrade}
                    disabled={directSubmitting}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    className="programhead-direct-submit"
                    onClick={submitDirectGrade}
                    disabled={directSubmitting || !directGradeResult.complete}
                  >
                    Review & Submit
                  </button>
                </footer>
              </section>
            ) : (
              <section className="programhead-direct-grade-modal programhead-confirm-grade-modal">
                <header className="programhead-direct-grade-header">
                  <div>
                    <span>Final Grade Review</span>

                    <h2>Submit & Approve Grade?</h2>

                    <p>
                      Verify the calculated grade before making it an official
                      academic result.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setConfirmDirectGrade(false)}
                    disabled={directSubmitting}
                    aria-label="Close confirmation"
                  >
                    ×
                  </button>
                </header>

                <div className="programhead-confirm-grade-student">
                  <div>
                    <span>Student</span>

                    <strong>{directStudent.full_name}</strong>

                    <small>{directStudent.student_number}</small>
                  </div>

                  <div>
                    <span>Subject</span>

                    <strong>{selectedClass.subject.subject_code}</strong>

                    <small>{selectedClass.subject.subject_name}</small>
                  </div>

                  <div>
                    <span>Section</span>

                    <strong>{selectedClass.section.section_name}</strong>

                    <small>
                      {selectedClass.section.course.course_code} · Year{" "}
                      {selectedClass.section.year_level}
                    </small>
                  </div>
                </div>

                <div className="programhead-confirm-grade-review">
                  <div>
                    <span>Prelim</span>

                    <strong>{directForm.prelim_grade || "—"}</strong>
                  </div>

                  <div>
                    <span>Midterm</span>

                    <strong>{directForm.midterm_grade || "—"}</strong>
                  </div>

                  <div>
                    <span>Final</span>

                    <strong>{directForm.final_grade || "—"}</strong>
                  </div>

                  <div className="final-rating">
                    <span>Final Rating</span>

                    <strong>{directGradeResult.finalRatingText || "—"}</strong>
                  </div>
                </div>

                <div className="programhead-confirm-grade-result">
                  <span>Academic Result</span>

                  {directGradeResult.remarks ? (
                    <strong className={directGradeResult.remarks.toLowerCase()}>
                      {directGradeResult.remarks}
                    </strong>
                  ) : (
                    <strong>Invalid</strong>
                  )}
                </div>

                <div className="programhead-confirm-grade-warning">
                  <div>!</div>

                  <div>
                    <strong>This will become an official grade.</strong>

                    <p>
                      Raw Average{" "}
                      <b>
                        {directGradeResult.rawAverage !== null
                          ? directGradeResult.rawAverage.toFixed(2)
                          : "—"}
                      </b>{" "}
                      is normalized to Final Rating{" "}
                      <b>{directGradeResult.finalRatingText || "—"}</b> and
                      recorded as{" "}
                      <b>{directGradeResult.remarks || "Invalid"}</b>.
                      Confirming this action processes the grade through Draft →
                      Submitted → Approved.
                    </p>
                  </div>
                </div>

                <div className="programhead-confirm-grade-record">
                  <div>
                    <span>Assigned Faculty</span>

                    <strong>
                      {selectedClass.faculty?.faculty_name || "—"}
                    </strong>
                  </div>

                  <div>
                    <span>Approved By</span>

                    <strong>
                      {programHead?.program_head_name || "Program Head"}
                    </strong>
                  </div>
                </div>

                {directError && (
                  <div className="programhead-direct-grade-error">
                    <strong>Grade could not be approved</strong>

                    <p>{directError}</p>
                  </div>
                )}

                <footer className="programhead-direct-grade-actions">
                  <button
                    type="button"
                    className="programhead-direct-cancel"
                    onClick={() => setConfirmDirectGrade(false)}
                    disabled={directSubmitting}
                  >
                    Back to Edit
                  </button>

                  <button
                    type="button"
                    className="programhead-direct-submit"
                    onClick={() => void confirmAndApproveDirectGrade()}
                    disabled={directSubmitting || !directGradeResult.complete}
                  >
                    {directSubmitting
                      ? "Approving Grade..."
                      : "Confirm & Approve"}
                  </button>
                </footer>
              </section>
            )}
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}
