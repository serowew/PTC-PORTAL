import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { useNavigate } from "react-router-dom";
import { useEffect, useState, type CSSProperties, type KeyboardEvent } from "react";

import "../../../styles/Enrollmentmain.css";

const API_BASE_URL = "http://localhost:3000/api/student/enrollments";

// ============================================================
// TYPES
// ============================================================

interface Student {
  student_id: number;
  student_number: string;
  student_name: string;

  course: {
    course_id: number;
    course_code: string;
    course_name: string;
  };

  year_level: number;
}

interface Curriculum {
  student_curriculum_id: number;
  curriculum_id: number;
  curriculum_name: string;
  effective_year: number | null;
  total_units: number | null;
  status: string;
}

interface EnrollmentPeriod {
  enrollment_period_id: number;

  academic_year_id: number;
  academic_year: string;

  semester_id: number;
  semester_name: string;

  status: string;

  opened_at?: string | null;
  remarks?: string | null;
}

interface Enrollment {
  enrollment_id: number;
  student_id: number;

  enrollment_status: string;

  remarks: string | null;
  created_at: string;
}

type EnrollmentType = "Regular" | "Retake" | "Carry Over";

interface OfficialEnrollment {
  enrollment_id: number;
  student_id: number;

  academic_year_id: number;
  academic_year: string;

  semester_id: number;
  semester_name: string;

  enrollment_status: string;

  remarks: string | null;

  approved_by: number | null;
  approved_at: string | null;

  created_at: string;
}

interface OfficialEnrollmentSubject {
  enrollment_subject_id: number;
  enrollment_id: number;

  subject_id: number;
  subject_code: string;
  subject_name: string;

  units: number;
  lecture_hours: number;
  laboratory_hours: number;

  status: string;

  enrollment_type: EnrollmentType;
  is_irregular: boolean;
  irregular_reason: "RETAKE" | "CARRY_OVER" | null;

  section: {
    section_id: number | null;
    section_name: string | null;
    year_level: number | null;
    course_id: number | null;
    course_code: string | null;
    course_name: string | null;
  };

  section_subject: {
    section_subject_id: number | null;
    status: string | null;
  };

  offering: {
    offering_id: number | null;
    status: string | null;
    schedule_days: string | null;
    schedule_time: string | null;
    max_students: number | null;
    enrolled_count: number;
    available_slots: number | null;
  };

  faculty: {
    faculty_id: number | null;
    faculty_name: string | null;
  };

  room: {
    room_id: number | null;
    room_name: string | null;
  };

  assignment_complete: boolean;
}

interface CurrentEnrollmentResponse {
  success: boolean;
  message?: string;

  student: Student;

  curriculum: Curriculum | null;

  curriculum_issue?: string | null;

  enrollment_period: EnrollmentPeriod | null;

  enrollment: OfficialEnrollment | null;

  subjects: OfficialEnrollmentSubject[];

  summary: {
    total_subjects: number;
    total_units: number;
    placed_subjects: number;
    unplaced_subjects: number;
    placement_complete: boolean;
    regular_subjects: number;
    retake_subjects: number;
    carry_over_subjects: number;
    irregular_subjects: number;
    is_irregular_enrollment: boolean;
  };

  can_prepare: boolean;
}

interface Prerequisite {
  prerequisite_id: number;
  subject_id: number;
  subject_code: string;
  subject_name: string;

  passed: boolean;

  final_grade: number | null;
  academic_status: string;
}

interface RegularSubject {
  subject_id: number;

  subject_code: string;
  subject_name: string;

  units: number;

  lecture_hours: number;
  laboratory_hours: number;

  year_level: number;
  semester_id: number;

  is_required: boolean;
  display_order: number;

  curriculum_subject_id: number;

  enrollment_type: "Regular";

  academic_status: string;

  eligible: boolean;

  prerequisites: Prerequisite[];

  selected_in_draft: boolean;

  enrollment_subject_id: number | null;
  enrollment_subject_status: string | null;
}

interface CarryOverSubject {
  subject_id: number;

  subject_code: string;
  subject_name: string;

  units: number;

  lecture_hours: number;
  laboratory_hours: number;

  original_year_level: number;
  original_semester_id: number;

  curriculum_subject_id: number;

  enrollment_type: "Carry Over";

  academic_status: string;
  eligible: boolean;

  carry_over_reason: string | null;

  prerequisites: Prerequisite[];

  selected_in_draft: boolean;

  enrollment_subject_id: number | null;
  enrollment_subject_status: string | null;
}

interface RetakeCandidate {
  subject_id: number;

  subject_code: string;
  subject_name: string;

  units: number;

  lecture_hours: number;
  laboratory_hours: number;

  previous_final_grade: number | null;
  previous_status: string;

  curriculum_subject_id: number;

  original_year_level: number;
  original_semester_id: number;

  eligible_for_retake: boolean;

  selected_in_draft: boolean;

  enrollment_subject_id: number | null;
  enrollment_subject_status: string | null;
}

interface BlockedSubject {
  subject_id: number;

  subject_code: string;
  subject_name: string;

  units: number;

  year_level: number;
  semester_id: number;

  curriculum_subject_id: number;

  reason: string;

  prerequisites: Prerequisite[];
  missing_prerequisites: Prerequisite[];
}

interface CompletedSubject {
  subject_id: number;

  subject_code: string;
  subject_name: string;

  units: number;

  // Compatibility key returned by the backend.
  // The backend sources this value from grades.final_rating.
  final_grade: number | null;

  academic_status: string;
}

interface EnrollmentEligibilityResponse {
  success: boolean;

  message?: string;

  student: Student;

  curriculum: Curriculum | null;

  enrollment_period: EnrollmentPeriod | null;

  enrollment: Enrollment | null;

  regular_subjects: RegularSubject[];

  carry_over_subjects: CarryOverSubject[];

  retake_candidates: RetakeCandidate[];

  blocked_subjects: BlockedSubject[];

  completed_subjects: CompletedSubject[];

  summary: {
    regular_subjects: number;
    carry_over_subjects: number;
    retake_candidates: number;
    blocked_subjects: number;
    completed_subjects: number;
    eligible_units: number;
  };

  can_prepare: boolean;
  can_modify_draft: boolean;
  can_submit: boolean;
}

interface ActionResponse {
  success?: boolean;
  message?: string;
  error?: string;

  enrollment?: {
    enrollment_id: number;
    enrollment_status: string;
  };
}

interface ApiErrorResponse {
  success?: boolean;
  message?: string;
  error?: string;
  code?: string;
}

// ============================================================
// SAFE JSON
// ============================================================

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

// ============================================================
// COMPONENT
// ============================================================

export default function Enrollmentmain() {
  const navigate = useNavigate();

  // ============================================================
  // AUTH
  // ============================================================

  const authSession = authService.getSession();
  const token = authService.getToken();

  const userRole = authSession?.role;

  const authenticated = Boolean(authSession && token);

  // ============================================================
  // DATA
  // ============================================================

  const [data, setData] = useState<EnrollmentEligibilityResponse | null>(null);

  const [officialData, setOfficialData] =
    useState<CurrentEnrollmentResponse | null>(null);

  // ============================================================
  // RETAKE SELECTION
  // ============================================================

  const [selectedRetakeSubjectIds, setSelectedRetakeSubjectIds] = useState<
    number[]
  >([]);

  // ============================================================
  // UI STATES
  // ============================================================

  const [loading, setLoading] = useState(true);

  const [preparing, setPreparing] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const [error, setError] = useState("");

  const [successMessage, setSuccessMessage] = useState("");

  // ============================================================
  // OFFICIAL SUBJECT ACCORDION
  //
  // Only one official subject can be open at a time.
  // Clicking the open subject closes it.
  // Clicking another subject closes the previous one automatically.
  // ============================================================

  const [expandedOfficialSubjectId, setExpandedOfficialSubjectId] = useState<
    number | null
  >(null);

  const toggleOfficialSubject = (enrollmentSubjectId: number) => {
    setExpandedOfficialSubjectId((currentId) =>
      currentId === enrollmentSubjectId ? null : enrollmentSubjectId,
    );
  };

  // ============================================================
  // MAIN ENROLLMENT SECTION ACCORDION
  //
  // Controls these 5 large sections only:
  // 1. Your Official Classes / Registrar Placement
  // 2. Regular Subjects
  // 3. Valid Retake Subjects
  // 4. Blocked Subjects
  // 5. Completed Subjects
  //
  // Only one large section can be open at a time.
  // ============================================================

  type EnrollmentSectionKey =
    | "official"
    | "regular"
    | "retake"
    | "blocked"
    | "completed";

  const [expandedSection, setExpandedSection] =
    useState<EnrollmentSectionKey | null>(null);

  const toggleEnrollmentSection = (section: EnrollmentSectionKey) => {
    setExpandedSection((currentSection) =>
      currentSection === section ? null : section,
    );

    // When switching large sections, close an opened official subject detail.
    setExpandedOfficialSubjectId(null);
  };

  const handleSectionKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    section: EnrollmentSectionKey,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleEnrollmentSection(section);
    }
  };

  const sectionArrowStyle = (isOpen: boolean): CSSProperties => ({
    width: "30px",
    height: "30px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    border: "1px solid #63c77c",
    borderRadius: "8px",
    background: isOpen ? "#dcfce7" : "#f0fdf4",
    color: "#15803d",
    fontSize: "16px",
    fontWeight: 900,
    lineHeight: 1,
    transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
    transition: "transform 0.2s ease, background 0.2s ease",
    pointerEvents: "none",
  });

  // ============================================================
  // AUTHORIZATION
  // ============================================================

  useEffect(() => {
    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    if (userRole !== "Student") {
      if (userRole) {
        navigate(authService.getDashboardRoute(userRole), {
          replace: true,
        });
      } else {
        navigate("/login", {
          replace: true,
        });
      }

      return;
    }
  }, [authenticated, userRole, authSession, navigate]);

  // ============================================================
  // AUTH RESPONSE
  // ============================================================

  const handleAuthenticationResponse = (
    response: Response,
    responseData: ApiErrorResponse,
  ) => {
    if (response.status === 401) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return false;
    }

    if (response.status === 403) {
      throw new Error(
        responseData.message ||
          responseData.error ||
          "You are not authorized to access Student enrollment.",
      );
    }

    return true;
  };

  // ============================================================
  // APPLY ELIGIBILITY RESPONSE
  // ============================================================

  const applyEnrollmentData = (responseData: EnrollmentEligibilityResponse) => {
    setData(responseData);

    const draftRetakeIds = (responseData.retake_candidates || [])
      .filter((subject) => subject.selected_in_draft)
      .map((subject) => Number(subject.subject_id));

    // Existing Draft:
    // restore the retakes that actually belong to the Draft.
    //
    // No active enrollment:
    // start with no optional retakes selected.
    setSelectedRetakeSubjectIds(
      responseData.enrollment?.enrollment_status === "Draft"
        ? draftRetakeIds
        : [],
    );
  };

  // ============================================================
  // LOAD ELIGIBILITY
  //
  // GET /api/student/enrollments/subjects
  //
  // No user_id.
  // Student identity comes from req.user.user_id.
  // ============================================================

  const loadEnrollment = async (signal?: AbortSignal) => {
    if (!authenticated || userRole !== "Student") {
      return;
    }

    const response = await authService.authFetch(`${API_BASE_URL}/subjects`, {
      method: "GET",

      signal,

      headers: {
        Accept: "application/json",
      },
    });

    const responseData = await readJsonResponse<
      EnrollmentEligibilityResponse | ApiErrorResponse
    >(response);

    const canContinue = handleAuthenticationResponse(
      response,
      responseData as ApiErrorResponse,
    );

    if (!canContinue) {
      return;
    }

    if (!response.ok) {
      const apiError = responseData as ApiErrorResponse;

      throw new Error(
        apiError.message ||
          apiError.error ||
          `Enrollment request failed (${response.status}).`,
      );
    }

    if (!("student" in responseData)) {
      throw new Error(
        responseData.message || "Invalid Student enrollment response.",
      );
    }

    if (!responseData.success) {
      throw new Error(
        responseData.message || "Failed to load Student enrollment.",
      );
    }

    applyEnrollmentData(responseData);

    // ======================================================
    // LOAD OFFICIAL / CURRENT ENROLLMENT
    //
    // This endpoint is authoritative for the actual
    // enrollment_subject rows and Registrar placement.
    //
    // It gives us:
    // - official total units
    // - section
    // - offering
    // - faculty
    // - optional room
    // - schedule
    //
    // No user_id or student_id is sent.
    // JWT identity is resolved by the backend through req.user.
    // ======================================================

    const currentResponse = await authService.authFetch(
      `${API_BASE_URL}/current`,
      {
        method: "GET",

        signal,

        headers: {
          Accept: "application/json",
        },
      },
    );

    const currentData = await readJsonResponse<
      CurrentEnrollmentResponse | ApiErrorResponse
    >(currentResponse);

    const canContinueCurrent = handleAuthenticationResponse(
      currentResponse,
      currentData as ApiErrorResponse,
    );

    if (!canContinueCurrent) {
      return;
    }

    if (!currentResponse.ok) {
      const apiError = currentData as ApiErrorResponse;

      throw new Error(
        apiError.message ||
          apiError.error ||
          `Current enrollment request failed (${currentResponse.status}).`,
      );
    }

    if (!("subjects" in currentData)) {
      throw new Error(
        currentData.message || "Invalid current enrollment response.",
      );
    }

    if (!currentData.success) {
      throw new Error(
        currentData.message || "Failed to load current enrollment.",
      );
    }

    setOfficialData(currentData);
  };

  // ============================================================
  // INITIAL LOAD
  // ============================================================

  useEffect(() => {
    if (!authenticated || userRole !== "Student") {
      return;
    }

    const controller = new AbortController();

    const run = async () => {
      try {
        setLoading(true);

        setError("");

        await loadEnrollment(controller.signal);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        console.error("LOAD STUDENT ENROLLMENT ERROR:", err);

        if (err instanceof TypeError) {
          setError(
            "Unable to connect to the enrollment server. Make sure the backend is running on http://localhost:3000.",
          );

          return;
        }

        setError(
          err instanceof Error ? err.message : "Unable to load enrollment.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      controller.abort();
    };
  }, [authenticated, userRole]);

  // ============================================================
  // RELOAD
  // ============================================================

  const reloadEnrollment = async () => {
    try {
      setLoading(true);

      setError("");

      await loadEnrollment();
    } catch (err) {
      console.error("RELOAD STUDENT ENROLLMENT ERROR:", err);

      setError(
        err instanceof Error ? err.message : "Unable to load enrollment.",
      );
    } finally {
      setLoading(false);
    }
  };

  // ============================================================
  // FORMAT DATE
  // ============================================================

  const formatDate = (date: string | null | undefined) => {
    if (!date) {
      return "—";
    }

    const parsedDate = new Date(date);

    if (Number.isNaN(parsedDate.getTime())) {
      return "—";
    }

    return parsedDate.toLocaleDateString("en-PH", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  // ============================================================
  // YEAR LABEL
  // ============================================================

  const getYearLabel = (year: number) => {
    if (year === 1) {
      return "1st Year";
    }

    if (year === 2) {
      return "2nd Year";
    }

    if (year === 3) {
      return "3rd Year";
    }

    if (year === 4) {
      return "4th Year";
    }

    return `${year}th Year`;
  };

  // ============================================================
  // STATUS CLASS
  // ============================================================

  const getStatusClass = (status: string | null | undefined) => {
    return status?.trim().toLowerCase().replace(/\s+/g, "-") || "unknown";
  };

  // ============================================================
  // RETAKE TOGGLE
  //
  // Student can select ONLY backend-approved retake candidates.
  // Student never selects section/offering/faculty/room/schedule.
  // ============================================================
  const toggleRetakeSubject = (subjectId: number) => {
    if (!data) {
      return;
    }

    const canEditRetakes = data.can_prepare || data.can_modify_draft;

    if (!canEditRetakes) {
      return;
    }

    setSelectedRetakeSubjectIds((current) => {
      if (current.includes(subjectId)) {
        return current.filter((id) => id !== subjectId);
      }

      return [...current, subjectId];
    });

    setError("");
    setSuccessMessage("");
  };
  // ============================================================
  // PREPARE DRAFT
  //
  // POST /api/student/enrollments/prepare
  //
  // Regular eligible subjects are automatic.
  // Student sends ONLY selected valid retake subject IDs.
  // Placement remains NULL.
  // ============================================================

  const prepareEnrollment = async () => {
    if (!authenticated || userRole !== "Student") {
      setError(
        "Your session has expired or you are not authorized to prepare enrollment.",
      );

      return;
    }

    if (!data) {
      setError("Enrollment information is not available.");

      return;
    }

    if (!data.enrollment_period) {
      setError("Enrollment is currently closed.");

      return;
    }

    if (data.enrollment_period.status.trim().toLowerCase() !== "open") {
      setError("The enrollment period is no longer open.");

      return;
    }

    if (![1, 2].includes(Number(data.enrollment_period.semester_id))) {
      setError(
        "Only First Semester and Second Semester are supported for enrollment.",
      );

      return;
    }

    const canSaveDraft = data.can_prepare || data.can_modify_draft;

    if (!canSaveDraft) {
      setError(
        data.enrollment
          ? `This ${data.enrollment.enrollment_status} enrollment can no longer be modified.`
          : "This enrollment cannot currently be prepared.",
      );

      return;
    }

    const validRetakeIds = new Set(
      data.retake_candidates
        .filter((subject) => subject.eligible_for_retake)
        .map((subject) => Number(subject.subject_id)),
    );

    const invalidSelectedRetakes = selectedRetakeSubjectIds.filter(
      (subjectId) => !validRetakeIds.has(Number(subjectId)),
    );

    if (invalidSelectedRetakes.length > 0) {
      setError(
        "One or more selected retakes are no longer academically eligible. Reload the page and try again.",
      );

      return;
    }

    const totalSubjectsToPrepare =
      data.regular_subjects.length +
      (data.carry_over_subjects?.length || 0) +
      selectedRetakeSubjectIds.length;

    if (totalSubjectsToPrepare === 0) {
      setError(
        "There are no eligible Regular, Carry Over, or selected Retake subjects to prepare.",
      );

      return;
    }

    try {
      setPreparing(true);

      setError("");
      setSuccessMessage("");

      const response = await authService.authFetch(`${API_BASE_URL}/prepare`, {
        method: "POST",

        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          selected_retake_subject_ids: selectedRetakeSubjectIds,
        }),
      });

      const responseData = await readJsonResponse<ActionResponse>(response);

      const canContinue = handleAuthenticationResponse(response, responseData);

      if (!canContinue) {
        return;
      }

      if (!response.ok || responseData.success === false) {
        throw new Error(
          responseData.message ||
            responseData.error ||
            `Unable to prepare enrollment (${response.status}).`,
        );
      }

      setSuccessMessage(
        responseData.message ||
          (data.can_modify_draft
            ? "Draft enrollment updated successfully."
            : enrollmentIsRejected
              ? "New Draft enrollment prepared successfully."
              : "Draft enrollment prepared successfully."),
      );
      await reloadEnrollment();
    } catch (err) {
      console.error("PREPARE STUDENT ENROLLMENT ERROR:", err);

      setError(
        err instanceof Error ? err.message : "Unable to prepare enrollment.",
      );
    } finally {
      setPreparing(false);
    }
  };

  // ============================================================
  // SUBMIT DRAFT
  //
  // POST /api/student/enrollments/:id/submit
  //
  // No user_id body.
  // Backend gets Student identity from req.user.user_id.
  //
  // Draft -> Pending
  //
  // Registrar assigns section/offering AFTER submission.
  // ============================================================

  const submitEnrollment = async () => {
    if (!authenticated || userRole !== "Student") {
      setError(
        "Your session has expired or you are not authorized to submit enrollment.",
      );

      return;
    }

    if (!data?.enrollment?.enrollment_id) {
      setError("No Draft enrollment is available for submission.");

      return;
    }

    if (!data.enrollment_period) {
      setError("Enrollment is currently closed.");

      return;
    }

    if (data.enrollment_period.status.trim().toLowerCase() !== "open") {
      setError("The enrollment period is no longer open.");

      return;
    }

    if (![1, 2].includes(Number(data.enrollment_period.semester_id))) {
      setError(
        "Only First Semester and Second Semester are supported for enrollment.",
      );

      return;
    }

    if (
      data.enrollment.enrollment_status.trim().toLowerCase() !== "draft" ||
      !data.can_submit
    ) {
      setError(
        `This enrollment cannot be submitted because its current status is "${data.enrollment.enrollment_status}".`,
      );

      return;
    }

    const preparedRegularSubjects = data.regular_subjects.filter(
      (subject) => subject.selected_in_draft,
    );

    const preparedCarryOverSubjects = (data.carry_over_subjects || []).filter(
      (subject) => subject.selected_in_draft,
    );

    const preparedRetakeSubjects = data.retake_candidates.filter(
      (subject) => subject.selected_in_draft,
    );

    if (
      preparedRegularSubjects.length +
        preparedCarryOverSubjects.length +
        preparedRetakeSubjects.length ===
      0
    ) {
      setError("There are no prepared subjects to submit.");

      return;
    }

    try {
      setSubmitting(true);

      setError("");
      setSuccessMessage("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${data.enrollment.enrollment_id}/submit`,
        {
          method: "POST",

          headers: {
            Accept: "application/json",
          },
        },
      );

      const responseData = await readJsonResponse<ActionResponse>(response);

      const canContinue = handleAuthenticationResponse(response, responseData);

      if (!canContinue) {
        return;
      }

      if (!response.ok || responseData.success === false) {
        throw new Error(
          responseData.message ||
            responseData.error ||
            `Enrollment submission failed (${response.status}).`,
        );
      }

      setSuccessMessage(
        responseData.message ||
          "Your enrollment has been submitted and is now pending Registrar review.",
      );

      await reloadEnrollment();
    } catch (err) {
      console.error("SUBMIT STUDENT ENROLLMENT ERROR:", err);

      setError(
        err instanceof Error ? err.message : "Unable to submit enrollment.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================
  // AUTH RENDER GUARD
  // ============================================================

  if (!authenticated || !authSession || userRole !== "Student") {
    return null;
  }

  // ============================================================
  // LOADING
  // ============================================================

  if (loading) {
    return (
      <DashboardLayout>
        <div className="enrollment-main">
          <div className="enrollment-loading">
            <div className="enrollment-spinner"></div>

            <p>Loading your enrollment...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // ============================================================
  // ERROR PAGE
  // ============================================================

  if (error && !data) {
    return (
      <DashboardLayout>
        <div className="enrollment-main">
          <div className="enrollment-error-page">
            <div className="enrollment-error-icon">!</div>

            <h2>Unable to Load Enrollment</h2>

            <p>{error}</p>

            <button
              type="button"
              className="enrollment-btn primary"
              onClick={() => void reloadEnrollment()}
            >
              Try Again
            </button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // ============================================================
  // NO DATA
  // ============================================================

  if (!data) {
    return (
      <DashboardLayout>
        <div className="enrollment-main">
          <div className="enrollment-error-page">
            <div className="enrollment-error-icon">!</div>

            <h2>No Enrollment Data</h2>

            <p>Unable to retrieve your enrollment information.</p>

            <button
              type="button"
              className="enrollment-btn primary"
              onClick={() => void reloadEnrollment()}
            >
              Try Again
            </button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // ============================================================
  // DATA
  // ============================================================

  const {
    student,
    curriculum,
    enrollment_period,
    enrollment,
    regular_subjects,
    carry_over_subjects = [],
    retake_candidates,
    blocked_subjects,
    completed_subjects,
    summary,
  } = data;

  // ============================================================
  // CURRENT STATUS
  // ============================================================

  const enrollmentStatus =
    enrollment?.enrollment_status?.trim().toLowerCase() || "";

  const enrollmentIsDraft = enrollmentStatus === "draft";

  const enrollmentIsPending = enrollmentStatus === "pending";

  const enrollmentIsApproved = enrollmentStatus === "approved";

  const enrollmentIsRejected = enrollmentStatus === "rejected";

  const enrollmentPeriodIsOpen =
    enrollment_period?.status?.trim().toLowerCase() === "open";

  const semesterIsSupported =
    !enrollment_period ||
    [1, 2].includes(Number(enrollment_period.semester_id));

  // ============================================================
  // DRAFT SUBJECTS
  // ============================================================

  const draftRegularSubjects = regular_subjects.filter(
    (subject) => subject.selected_in_draft,
  );

  const draftCarryOverSubjects = carry_over_subjects.filter(
    (subject) => subject.selected_in_draft,
  );

  const draftRetakeSubjects = retake_candidates.filter(
    (subject) => subject.selected_in_draft,
  );

  const draftSubjectsCount =
    draftRegularSubjects.length +
    draftCarryOverSubjects.length +
    draftRetakeSubjects.length;

  const draftUnits = [
    ...draftRegularSubjects,
    ...draftCarryOverSubjects,
    ...draftRetakeSubjects,
  ].reduce((total, subject) => total + Number(subject.units || 0), 0);

  // ============================================================
  // PLANNED PREPARE SUMMARY
  // ============================================================

  const selectedRetakeSubjects = retake_candidates.filter((subject) =>
    selectedRetakeSubjectIds.includes(Number(subject.subject_id)),
  );

  const regularEligibleUnits = regular_subjects.reduce(
    (total, subject) => total + Number(subject.units || 0),
    0,
  );

  const carryOverUnits = carry_over_subjects.reduce(
    (total, subject) => total + Number(subject.units || 0),
    0,
  );

  const selectedRetakeUnits = selectedRetakeSubjects.reduce(
    (total, subject) => total + Number(subject.units || 0),
    0,
  );

  const plannedSubjectCount =
    regular_subjects.length +
    carry_over_subjects.length +
    selectedRetakeSubjects.length;

  const plannedUnits =
    regularEligibleUnits + carryOverUnits + selectedRetakeUnits;

  // ============================================================
  // OFFICIAL ENROLLMENT SUMMARY
  //
  // Once an enrollment exists, the official/current endpoint is
  // the source for the real subject load. This prevents an
  // Approved retake from being omitted from the unit total.
  // ============================================================

  const officialSubjects = officialData?.subjects || [];

  const officialSummary = officialData?.summary;

  const officialUnits = officialSummary?.total_units ?? 0;

  const displayedUnits =
    enrollmentIsDraft || enrollmentIsPending || enrollmentIsApproved
      ? officialUnits
      : plannedUnits;

  const displayedUnitsLabel = enrollmentIsApproved
    ? "Official Units"
    : enrollmentIsPending
      ? "Submitted Units"
      : enrollmentIsDraft
        ? "Draft Units"
        : "Planned Units";

  const canPrepareEnrollment =
    Boolean(enrollment_period) &&
    enrollmentPeriodIsOpen &&
    semesterIsSupported &&
    (data.can_prepare || data.can_modify_draft) &&
    (!enrollment || enrollmentIsDraft || enrollmentIsRejected) &&
    plannedSubjectCount > 0;

  const canSubmitEnrollment =
    Boolean(enrollment?.enrollment_id) &&
    Boolean(enrollment_period) &&
    enrollmentPeriodIsOpen &&
    semesterIsSupported &&
    enrollmentIsDraft &&
    data.can_submit &&
    draftSubjectsCount > 0;

  // ============================================================
  // RENDER OFFICIAL ENROLLMENT SUBJECT
  //
  // Placement shown here comes from enrollment_subjects and the
  // Registrar-selected offering. Student cannot modify it.
  // ============================================================

  const renderOfficialSubject = (subject: OfficialEnrollmentSubject) => {
    const enrollmentType = subject.enrollment_type;

    const isRetake = enrollmentType === "Retake";
    const isCarryOver = enrollmentType === "Carry Over";
    const isIrregular = isRetake || isCarryOver;

    const subjectMarker = isRetake ? "R" : isCarryOver ? "C" : "✓";

    // Accordion rule:
    // null = all subjects closed.
    // one enrollment_subject_id = only that subject is open.
    const isExpanded =
      expandedOfficialSubjectId === subject.enrollment_subject_id;

    const handleSubjectAccordion = () => {
      toggleOfficialSubject(subject.enrollment_subject_id);
    };

    return (
      <div
        key={subject.enrollment_subject_id}
        className={`subject-card ${isIrregular ? "retake-subject" : ""}`}
        style={{
          borderColor: isIrregular
            ? isExpanded
              ? "#dc2626"
              : undefined
            : isExpanded
              ? "#15803d"
              : "#63c77c",
          boxShadow: isExpanded
            ? "0 7px 20px rgba(21, 128, 61, 0.10)"
            : undefined,
        }}
      >
        {/* ====================================================
            CLICKABLE SUBJECT HEADER

            The subject summary is always visible.
            Clicking anywhere on this header opens/closes the
            placement details below it.
        ==================================================== */}

        <div
          className="subject-header"
          role="button"
          tabIndex={0}
          aria-expanded={isExpanded}
          aria-controls={`official-subject-details-${subject.enrollment_subject_id}`}
          onClick={handleSubjectAccordion}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleSubjectAccordion();
            }
          }}
          style={{
            cursor: "pointer",
            userSelect: "none",
            background: isExpanded ? "#f4fbf6" : undefined,
          }}
        >
          <div className="subject-number">{subjectMarker}</div>

          <div className="subject-main">
            <div className="subject-code-row">
              <span className="subject-code">{subject.subject_code}</span>

              <span
                className={`subject-badge ${isIrregular ? "retake" : "regular"}`}
              >
                {enrollmentType}
              </span>
            </div>

            <h3>{subject.subject_name}</h3>

            <div className="subject-details">
              <span>{subject.units} Units</span>

              <span>Lecture: {subject.lecture_hours}h</span>

              <span>Laboratory: {subject.laboratory_hours}h</span>
            </div>
          </div>

          <div className="academic-status">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: "9px",
              }}
            >
              <span
                className={`status-badge ${
                  subject.assignment_complete ? "approved" : "pending"
                }`}
              >
                {subject.status}
              </span>

              {/* Accordion arrow — not a separate View Details button. */}
              <span
                aria-hidden="true"
                style={{
                  width: "26px",
                  height: "26px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  border: "1px solid #63c77c",
                  borderRadius: "7px",
                  background: "#f0fdf4",
                  color: "#15803d",
                  fontSize: "15px",
                  fontWeight: 900,
                  lineHeight: 1,
                  transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s ease",
                }}
              >
                ▾
              </span>
            </div>

            <small
              style={{
                color: subject.assignment_complete ? "#15803d" : "#c2410c",
                fontWeight: 700,
              }}
            >
              {subject.assignment_complete
                ? "Official placement assigned"
                : "Awaiting Registrar placement"}
            </small>
          </div>
        </div>

        {/* ====================================================
            ACCORDION CONTENT

            Completely hidden while closed.
            Only the subject whose ID matches
            expandedOfficialSubjectId is rendered here.
        ==================================================== */}

        {isExpanded && (
          <div
            id={`official-subject-details-${subject.enrollment_subject_id}`}
            className="section-area"
            style={{
              borderTop: "1px solid #4caf68",
              background: "#fbfefc",
            }}
          >
            <div
              className="section-area-header"
              style={{
                paddingBottom: "12px",
                borderBottom: "1px solid #8fd39f",
              }}
            >
              <div>
                <strong>Official Class Placement</strong>

                <span>
                  {subject.assignment_complete
                    ? "Assigned by Registrar"
                    : "Placement is still pending"}
                </span>
              </div>

              {subject.offering.offering_id !== null && (
                <span className="section-count">
                  Offering #{subject.offering.offering_id}
                </span>
              )}
            </div>

            {subject.assignment_complete ? (
              <div
                className="assigned-section-card"
                style={{ borderColor: "#63c77c" }}
              >
                <div className="assigned-section-main">
                  <span className="section-radio" aria-label="Assigned section">
                    ✓
                  </span>

                  <div className="section-information">
                    <strong>
                      {subject.section.section_name || "Assigned Section"}
                    </strong>

                    <small>
                      {subject.section.course_code || "Course unavailable"}
                      {subject.section.year_level !== null
                        ? ` • Year ${subject.section.year_level}`
                        : ""}
                    </small>

                    <small>
                      {subject.offering.schedule_days ||
                        "Schedule day unavailable"}
                      {" • "}
                      {subject.offering.schedule_time ||
                        "Schedule time unavailable"}
                    </small>

                    <small>
                      Faculty: {subject.faculty.faculty_name || "Not assigned"}
                    </small>

                    <small>
                      Room:{" "}
                      {subject.room.room_name ||
                        "No room assigned / not required"}
                    </small>
                  </div>
                </div>

                <div className="section-capacity">
                  <strong>{subject.offering.max_students ?? "—"}</strong>

                  <small>Capacity</small>
                </div>

                <span
                  className={`section-status ${
                    subject.offering.status?.toLowerCase() === "open"
                      ? "open"
                      : ""
                  }`}
                  style={{
                    borderColor:
                      subject.offering.status?.toLowerCase() === "open"
                        ? "#63c77c"
                        : undefined,
                  }}
                >
                  {subject.offering.status || "Assigned"}
                </span>
              </div>
            ) : (
              <div
                className="no-sections"
                style={{ borderColor: "#8fd39f" }}
              >
                <span className="no-section-icon">—</span>

                <div>
                  <strong>Awaiting Registrar placement</strong>

                  <p>
                    This {enrollmentType} subject is part of your enrollment, but
                    its official section/offering has not been assigned yet.
                  </p>

                  <small>
                    Students cannot select or change section, offering, faculty,
                    room, or schedule.
                  </small>
                </div>
              </div>
            )}

            <div
              className="selected-section-message"
              style={{ borderColor: "#8fd39f" }}
            >
              <span>{subject.assignment_complete ? "✓" : "i"}</span>

              <p>
                <strong>
                  {subject.assignment_complete
                    ? "Registrar-controlled placement."
                    : "Placement pending."}
                </strong>
                <br />
                <small>
                  Enrollment type: {enrollmentType}. This value comes from the
                  persisted enrollment subject record. Room may be blank because
                  room assignment is optional.
                </small>
              </p>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ============================================================
  // RENDER REGULAR SUBJECT
  // ============================================================

  const renderRegularSubject = (subject: RegularSubject) => {
    const isPrepared = Boolean(subject.selected_in_draft);

    return (
      <div key={subject.subject_id} className="subject-card">
        <div className="subject-header">
          <div className="subject-number">{subject.display_order || "—"}</div>

          <div className="subject-main">
            <div className="subject-code-row">
              <span className="subject-code">{subject.subject_code}</span>

              <span className="subject-badge regular">Regular</span>
            </div>

            <h3>{subject.subject_name}</h3>

            <div className="subject-details">
              <span>{subject.units} Units</span>

              <span>Lecture: {subject.lecture_hours}h</span>

              <span>Laboratory: {subject.laboratory_hours}h</span>
            </div>
          </div>

          <div className="academic-status">
            <span className="status-badge approved">Eligible</span>

            {isPrepared && (
              <small>
                {subject.enrollment_subject_status || "Included in Draft"}
              </small>
            )}
          </div>
        </div>

        <div className="section-area">
          <div className="selected-section-message">
            <span>✓</span>

            <p>
              <strong>Automatically included.</strong> This is a valid Regular
              subject for the current curriculum term.
              <br />
              <small>
                You do not choose a section, faculty, room, schedule, or class
                offering. Registrar placement happens after submission.
              </small>
            </p>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // RENDER CARRY OVER SUBJECT
  // ============================================================

  const renderCarryOverSubject = (subject: CarryOverSubject) => {
    const isPrepared = Boolean(subject.selected_in_draft);

    return (
      <div key={subject.subject_id} className="subject-card retake-subject">
        <div className="subject-header">
          <div className="subject-number">C</div>

          <div className="subject-main">
            <div className="subject-code-row">
              <span className="subject-code">{subject.subject_code}</span>

              <span className="subject-badge retake">Carry Over</span>
            </div>

            <h3>{subject.subject_name}</h3>

            <div className="subject-details">
              <span>{subject.units} Units</span>
              <span>Lecture: {subject.lecture_hours}h</span>
              <span>Laboratory: {subject.laboratory_hours}h</span>
            </div>
          </div>

          <div className="academic-status">
            <span className="status-badge approved">Eligible</span>

            {isPrepared && (
              <small>
                {subject.enrollment_subject_status || "Included in Draft"}
              </small>
            )}
          </div>
        </div>

        <div className="section-area">
          <div className="selected-section-message">
            <span>✓</span>

            <p>
              <strong>Automatically included Carry Over.</strong> This is an
              eligible required subject from an earlier curriculum term.
              <br />
              <small>
                Original curriculum term: Year {subject.original_year_level} •
                Semester {subject.original_semester_id}. Registrar placement
                happens after submission.
              </small>
            </p>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // RENDER RETAKE CANDIDATE
  // ============================================================

  const renderRetakeCandidate = (subject: RetakeCandidate) => {
    const selectedBeforePrepare = selectedRetakeSubjectIds.includes(
      Number(subject.subject_id),
    );

    const selectedInDraft = Boolean(subject.selected_in_draft);

    const selectable =
      data.can_prepare || (data.can_modify_draft && enrollmentIsDraft);

    return (
      <div key={subject.subject_id} className="subject-card retake-subject">
        <div className="subject-header">
          <div className="subject-number">R</div>

          <div className="subject-main">
            <div className="subject-code-row">
              <span className="subject-code">{subject.subject_code}</span>

              <span className="subject-badge retake">Retake</span>
            </div>

            <h3>{subject.subject_name}</h3>

            <div className="subject-details">
              <span>{subject.units} Units</span>

              <span>Lecture: {subject.lecture_hours}h</span>

              <span>Laboratory: {subject.laboratory_hours}h</span>
            </div>
          </div>

          <div className="academic-status">
            <span className="status-badge failed">
              Previous Grade: {subject.previous_final_grade ?? "—"}
            </span>

            <small>{subject.previous_status}</small>
          </div>
        </div>

        <div className="section-area">
          {selectable ? (
            <label
              className="selected-section-message"
              style={{
                cursor: "pointer",
                alignItems: "flex-start",
              }}
            >
              <input
                type="checkbox"
                checked={selectedBeforePrepare}
                onChange={() => toggleRetakeSubject(subject.subject_id)}
                disabled={preparing || submitting}
                style={{
                  marginTop: "4px",
                }}
              />

              <p>
                <strong>
                  {selectedBeforePrepare
                    ? "Selected for this enrollment"
                    : "Optional valid retake"}
                </strong>
                <br />
                <small>
                  Select this subject if you want to include this valid retake
                  in your Draft enrollment.
                </small>
              </p>
            </label>
          ) : selectedInDraft ? (
            <div className="selected-section-message">
              <span>✓</span>

              <p>
                <strong>Included in Draft.</strong>
                <br />
                <small>
                  Registrar will assign the official section/offering after
                  submission.
                </small>
              </p>
            </div>
          ) : (
            <div className="selected-section-message">
              <span>i</span>

              <p>
                <strong>Valid retake candidate.</strong>
                <br />
                <small>
                  Retake selection is locked because this enrollment is already{" "}
                  {enrollment?.enrollment_status || "active"}.
                </small>
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ============================================================
  // RENDER BLOCKED SUBJECT
  // ============================================================

  const renderBlockedSubject = (subject: BlockedSubject) => {
    return (
      <div key={subject.subject_id} className="subject-card">
        <div className="subject-header">
          <div className="subject-number">!</div>

          <div className="subject-main">
            <div className="subject-code-row">
              <span className="subject-code">{subject.subject_code}</span>

              <span className="subject-badge retake">Blocked</span>
            </div>

            <h3>{subject.subject_name}</h3>

            <div className="subject-details">
              <span>{subject.units} Units</span>
            </div>
          </div>

          <div className="academic-status">
            <span className="status-badge failed">Not Eligible</span>
          </div>
        </div>

        <div className="section-area">
          <div className="no-sections">
            <span className="no-section-icon">!</span>

            <div>
              <strong>
                {subject.reason === "PREREQUISITE_NOT_PASSED"
                  ? "Prerequisite not yet passed"
                  : "Academic result requires review"}
              </strong>

              {subject.missing_prerequisites.length > 0 ? (
                <>
                  <p>This subject is blocked by:</p>

                  <small>
                    {subject.missing_prerequisites
                      .map(
                        (prerequisite) =>
                          `${prerequisite.subject_code} — ${
                            prerequisite.academic_status || "NOT_TAKEN"
                          }`,
                      )
                      .join(", ")}
                  </small>
                </>
              ) : (
                <small>
                  This subject is not currently eligible for enrollment.
                </small>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // RENDER COMPLETED SUBJECT
  // ============================================================

  const renderCompletedSubject = (subject: CompletedSubject) => {
    return (
      <div key={subject.subject_id} className="subject-card">
        <div className="subject-header">
          <div className="subject-number">✓</div>

          <div className="subject-main">
            <div className="subject-code-row">
              <span className="subject-code">{subject.subject_code}</span>

              <span className="subject-badge regular">Completed</span>
            </div>

            <h3>{subject.subject_name}</h3>

            <div className="subject-details">
              <span>{subject.units} Units</span>
            </div>
          </div>

          <div className="academic-status">
            <span className="status-badge approved">
              Final Rating: {subject.final_grade ?? "—"}
            </span>

            <small>{subject.academic_status}</small>
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // PAGE
  // ============================================================

  return (
    <DashboardLayout>
      <div className="enrollment-main">
        {/* ====================================================
            HEADER
        ==================================================== */}

        <div className="enrollment-header">
          <div>
            <span className="enrollment-eyebrow">Student Enrollment</span>

            <h1>Enrollment</h1>

            <p>
              Review your eligible curriculum subjects, select valid retakes,
              prepare your Draft, and submit it for Registrar placement and
              approval.
            </p>
          </div>

          <div className="enrollment-period-badge">
            <span className="period-dot"></span>

            {enrollment_period?.status || "Closed"}
          </div>
        </div>

        {/* ====================================================
            ERROR
        ==================================================== */}

        {error && (
          <div className="enrollment-alert error">
            <span className="alert-icon">!</span>

            <div>
              <strong>Action Required</strong>

              <p>{error}</p>
            </div>

            <button
              type="button"
              onClick={() => setError("")}
              className="alert-close"
              aria-label="Close error"
            >
              ×
            </button>
          </div>
        )}

        {/* ====================================================
            SUCCESS
        ==================================================== */}

        {successMessage && (
          <div className="enrollment-alert success">
            <span className="alert-icon">✓</span>

            <div>
              <strong>Enrollment</strong>

              <p>{successMessage}</p>
            </div>

            <button
              type="button"
              onClick={() => setSuccessMessage("")}
              className="alert-close"
              aria-label="Close success message"
            >
              ×
            </button>
          </div>
        )}

        {/* ====================================================
            UNSUPPORTED SEMESTER DEFENSE
        ==================================================== */}

        {enrollment_period && !semesterIsSupported && (
          <div className="enrollment-alert error">
            <span className="alert-icon">!</span>

            <div>
              <strong>Unsupported Enrollment Period</strong>

              <p>
                Only First Semester and Second Semester are supported. Summer is
                not part of the PTC Portal enrollment cycle.
              </p>
            </div>
          </div>
        )}

        {/* ====================================================
            STUDENT INFORMATION
        ==================================================== */}

        <div className="enrollment-info-grid">
          <div className="enrollment-info-card">
            <span className="info-label">Student</span>

            <strong>{student.student_name}</strong>

            <small>{student.student_number}</small>
          </div>

          <div className="enrollment-info-card">
            <span className="info-label">Course</span>

            <strong>{student.course.course_code}</strong>

            <small>{student.course.course_name}</small>
          </div>

          <div className="enrollment-info-card">
            <span className="info-label">Year Level</span>

            <strong>{getYearLabel(student.year_level)}</strong>

            <small>
              {enrollment
                ? enrollment.enrollment_status
                : "No Active Enrollment"}
            </small>
          </div>

          <div className="enrollment-info-card">
            <span className="info-label">Academic Period</span>

            <strong>{enrollment_period?.academic_year || "—"}</strong>

            <small>{enrollment_period?.semester_name || "—"}</small>
          </div>
        </div>

        {/* ====================================================
            ELIGIBILITY SUMMARY
        ==================================================== */}

        <div className="enrollment-summary">
          <div className="summary-item">
            <span className="summary-number">{summary.regular_subjects}</span>

            <span className="summary-label">Regular Eligible</span>
          </div>

          <div className="summary-item retake">
            <span className="summary-number">{summary.retake_candidates}</span>

            <span className="summary-label">Retake Candidates</span>
          </div>

          <div className="summary-item retake">
            <span className="summary-number">
              {summary.carry_over_subjects ?? carry_over_subjects.length}
            </span>

            <span className="summary-label">Carry Over</span>
          </div>

          <div className="summary-item">
            <span className="summary-number">{summary.blocked_subjects}</span>

            <span className="summary-label">Blocked</span>
          </div>

          <div className="summary-item">
            <span className="summary-number">{summary.completed_subjects}</span>

            <span className="summary-label">Completed</span>
          </div>

          <div className="summary-item type">
            <span className="summary-number">{displayedUnits}</span>

            <span className="summary-label">{displayedUnitsLabel}</span>
          </div>
        </div>

        {/* ====================================================
            ENROLLMENT STATUS
        ==================================================== */}

        <div className="enrollment-status-card">
          <div className="status-left">
            <span className="status-label">Enrollment Status</span>

            <strong
              className={`status-badge ${getStatusClass(
                enrollment?.enrollment_status,
              )}`}
            >
              {enrollment?.enrollment_status || "Not Prepared"}
            </strong>

            {enrollment?.remarks && <p>{enrollment.remarks}</p>}
          </div>

          <div className="status-right">
            <span>Created</span>

            <strong>{formatDate(enrollment?.created_at)}</strong>
          </div>
        </div>

        {/* ====================================================
            CLOSED
        ==================================================== */}

        {!enrollment_period && (
          <div className="enrollment-instruction">
            <div className="instruction-icon">i</div>

            <div>
              <strong>Enrollment is currently closed</strong>

              <p>
                There is currently no open enrollment period. You can review
                this page again when the Registrar opens enrollment.
              </p>
            </div>
          </div>
        )}

        {/* ====================================================
            READY TO PREPARE
        ==================================================== */}

        {enrollment_period && !enrollment && data.can_prepare && (
          <div className="enrollment-instruction">
            <div className="instruction-icon">i</div>

            <div>
              <strong>Prepare your enrollment</strong>

              <p>
                Regular eligible subjects are included automatically. You may
                also choose any valid retake subjects shown below.
              </p>

              <small>
                You do not select a section, faculty, room, schedule, or class
                offering. Those are assigned by the Registrar after you submit
                your Draft.
              </small>
            </div>
          </div>
        )}

        {/* ====================================================
            DRAFT
        ==================================================== */}

        {enrollmentIsDraft && (
          <div className="enrollment-instruction">
            <div className="instruction-icon">i</div>

            <div>
              <strong>Your Draft enrollment is ready</strong>

              <p>
                Review the Regular subjects and selected Retakes included in
                your Draft, then submit it for Registrar review.
              </p>

              <small>
                Placement is intentionally not assigned yet. Section, offering,
                faculty, room, and schedule are Registrar-controlled.
              </small>
            </div>
          </div>
        )}

        {/* ====================================================
            PENDING
        ==================================================== */}

        {enrollmentIsPending && (
          <div className="enrollment-instruction">
            <div className="instruction-icon">✓</div>

            <div>
              <strong>Enrollment submitted successfully</strong>

              <p>
                Your Draft has been submitted and is now pending Registrar
                review and official class placement.
              </p>

              <small>
                You cannot change subjects, retakes, sections, offerings,
                faculty, rooms, or schedules while the enrollment is Pending.
              </small>
            </div>
          </div>
        )}

        {/* ====================================================
            APPROVED
        ==================================================== */}

        {enrollmentIsApproved && (
          <div className="enrollment-instruction">
            <div className="instruction-icon">✓</div>

            <div>
              <strong>Your enrollment has been approved</strong>

              <p>
                The Registrar approved your enrollment. It is now the official
                source of your current-semester class membership.
              </p>

              <small>
                Your official section, offering, schedule, faculty, and optional
                room assignment are shown below from the Registrar-controlled
                enrollment record.
              </small>
            </div>
          </div>
        )}

        {/* ====================================================
            REJECTED
        ==================================================== */}

        {enrollmentIsRejected && (
          <div className="enrollment-instruction">
            <div className="instruction-icon">!</div>

            <div>
              <strong>Your previous enrollment application was rejected</strong>

              <p>
                Review the Registrar remarks below. The rejected application is
                kept as history and will not be overwritten.
              </p>

              {enrollment?.remarks && (
                <small>Registrar remarks: {enrollment.remarks}</small>
              )}

              {enrollment_period &&
                enrollmentPeriodIsOpen &&
                data.can_prepare && (
                  <small>
                    You may prepare a new enrollment application for this same
                    enrollment period. Eligibility will be evaluated again
                    before the new Draft is created.
                  </small>
                )}
            </div>
          </div>
        )}

        {/* ====================================================
            OFFICIAL / SUBMITTED ENROLLMENT
        ==================================================== */}

        {enrollment &&
          (enrollmentIsPending || enrollmentIsApproved) &&
          officialData && (
            <div className="subjects-container">
              <div
                className="subjects-header"
                role="button"
                tabIndex={0}
                aria-expanded={expandedSection === "official"}
                onClick={() => toggleEnrollmentSection("official")}
                onKeyDown={(event) => handleSectionKeyDown(event, "official")}
                style={{ cursor: "pointer", userSelect: "none" }}
              >
                <div>
                  <span className="enrollment-eyebrow">
                    {enrollmentIsApproved
                      ? "Official Enrollment"
                      : "Submitted Enrollment"}
                  </span>

                  <h2>
                    {enrollmentIsApproved
                      ? "Your Official Classes"
                      : "Registrar Placement"}
                  </h2>

                  <p>
                    {enrollmentIsApproved
                      ? "These are the subjects and Registrar-assigned class placements that make up your official current-semester enrollment."
                      : "These subjects were submitted for Registrar review. Placement appears here as the Registrar assigns each class."}
                  </p>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    flexShrink: 0,
                  }}
                >
                  <div className="selection-counter">
                    {officialSummary?.total_subjects ?? 0} subjects •{" "}
                    {officialUnits} units
                  </div>

                  <span
                    aria-hidden="true"
                    style={sectionArrowStyle(expandedSection === "official")}
                  >
                    ▾
                  </span>
                </div>
              </div>

              {expandedSection === "official" && (
                <>
                  {officialSummary && (
                    <div className="selected-section-message">
                      <span>
                        {officialSummary.placement_complete ? "✓" : "i"}
                      </span>

                      <p>
                        <strong>
                          {officialSummary.placement_complete
                            ? "Placement complete."
                            : "Placement still in progress."}
                        </strong>{" "}
                        {officialSummary.placed_subjects} of{" "}
                        {officialSummary.total_subjects} subject
                        {officialSummary.total_subjects !== 1 ? "s" : ""} placed.
                        <br />
                        <small>
                          Official load: {officialSummary.total_units} units.
                        </small>
                      </p>
                    </div>
                  )}

                  {officialSubjects.length === 0 ? (
                    <div className="no-sections">
                      <span className="no-section-icon">—</span>

                      <div>
                        <strong>No enrolled subjects found</strong>

                        <p>
                          The enrollment exists, but no active enrollment subjects
                          were returned.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="subject-list">
                      {officialSubjects.map((subject) =>
                        renderOfficialSubject(subject),
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

        {/* ====================================================
            REGULAR SUBJECTS
        ==================================================== */}

        <div className="subjects-container">
          <div
            className="subjects-header"
            role="button"
            tabIndex={0}
            aria-expanded={expandedSection === "regular"}
            onClick={() => toggleEnrollmentSection("regular")}
            onKeyDown={(event) => handleSectionKeyDown(event, "regular")}
            style={{ cursor: "pointer", userSelect: "none" }}
          >
            <div>
              <span className="enrollment-eyebrow">Academic Eligibility</span>

              <h2>Regular Subjects</h2>

              <p>
                These are the curriculum subjects you are academically eligible
                to take in the current term.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                flexShrink: 0,
              }}
            >
              <div className="selection-counter">
                {regular_subjects.length} eligible
              </div>

              <span
                aria-hidden="true"
                style={sectionArrowStyle(expandedSection === "regular")}
              >
                ▾
              </span>
            </div>
          </div>

          {expandedSection === "regular" && (
            <>
              {regular_subjects.length === 0 ? (
                <div className="no-sections">
                  <span className="no-section-icon">—</span>

                  <div>
                    <strong>No Regular subjects available</strong>

                    <p>
                      There are no Regular curriculum subjects currently eligible
                      for this term.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="subject-list">
                  {[...regular_subjects]
                    .sort(
                      (a, b) =>
                        Number(a.display_order || 999999) -
                        Number(b.display_order || 999999),
                    )
                    .map((subject) => renderRegularSubject(subject))}
                </div>
              )}
            </>
          )}
        </div>

        {/* ====================================================
            CARRY OVER SUBJECTS
        ==================================================== */}

        {carry_over_subjects.length > 0 && (
          <div className="subjects-container">
            <div className="subjects-header">
              <div>
                <span className="enrollment-eyebrow">
                  Earlier Curriculum Term
                </span>

                <h2>Carry Over Subjects</h2>

                <p>
                  Eligible required subjects from an earlier curriculum term are
                  included automatically. These are not Retakes because they do
                  not have an Approved 4.00 or 5.00 result.
                </p>
              </div>

              <div className="selection-counter">
                {carry_over_subjects.length} eligible
              </div>
            </div>

            <div className="subject-list">
              {carry_over_subjects.map((subject) =>
                renderCarryOverSubject(subject),
              )}
            </div>
          </div>
        )}

        {/* ====================================================
            RETAKE CANDIDATES
        ==================================================== */}

        <div className="subjects-container">
          <div
            className="subjects-header"
            role="button"
            tabIndex={0}
            aria-expanded={expandedSection === "retake"}
            onClick={() => toggleEnrollmentSection("retake")}
            onKeyDown={(event) => handleSectionKeyDown(event, "retake")}
            style={{ cursor: "pointer", userSelect: "none" }}
          >
            <div>
              <span className="enrollment-eyebrow">Retake Eligibility</span>

              <h2>Valid Retake Subjects</h2>

              <p>
                Failed or Incomplete subjects with an Approved academic result
                may be selected for retake.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                flexShrink: 0,
              }}
            >
              <div className="selection-counter">
                {data.can_prepare || data.can_modify_draft
                  ? `${selectedRetakeSubjectIds.length} / ${retake_candidates.length} selected`
                  : `${retake_candidates.length} eligible`}
              </div>

              <span
                aria-hidden="true"
                style={sectionArrowStyle(expandedSection === "retake")}
              >
                ▾
              </span>
            </div>
          </div>

          {expandedSection === "retake" && (
            <>
              {retake_candidates.length === 0 ? (
                <div className="no-sections">
                  <span className="no-section-icon">✓</span>

                  <div>
                    <strong>No retakes required</strong>

                    <p>
                      You currently have no valid Failed or Incomplete subjects
                      available for retake.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="subject-list">
                  {retake_candidates.map((subject) =>
                    renderRetakeCandidate(subject),
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ====================================================
            BLOCKED SUBJECTS
        ==================================================== */}

        {blocked_subjects.length > 0 && (
          <div className="subjects-container">
            <div
              className="subjects-header"
              role="button"
              tabIndex={0}
              aria-expanded={expandedSection === "blocked"}
              onClick={() => toggleEnrollmentSection("blocked")}
              onKeyDown={(event) => handleSectionKeyDown(event, "blocked")}
              style={{ cursor: "pointer", userSelect: "none" }}
            >
              <div>
                <span className="enrollment-eyebrow">Not Yet Eligible</span>

                <h2>Blocked Subjects</h2>

                <p>
                  These subjects are not included because prerequisite or
                  academic requirements are not yet satisfied.
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  flexShrink: 0,
                }}
              >
                <div className="selection-counter">
                  {blocked_subjects.length} blocked
                </div>

                <span
                  aria-hidden="true"
                  style={sectionArrowStyle(expandedSection === "blocked")}
                >
                  ▾
                </span>
              </div>
            </div>

            {expandedSection === "blocked" && (
              <div className="subject-list">
                {blocked_subjects.map((subject) =>
                  renderBlockedSubject(subject),
                )}
              </div>
            )}
          </div>
        )}

        {/* ====================================================
            COMPLETED SUBJECTS
        ==================================================== */}

        {completed_subjects.length > 0 && (
          <div className="subjects-container">
            <div
              className="subjects-header"
              role="button"
              tabIndex={0}
              aria-expanded={expandedSection === "completed"}
              onClick={() => toggleEnrollmentSection("completed")}
              onKeyDown={(event) => handleSectionKeyDown(event, "completed")}
              style={{ cursor: "pointer", userSelect: "none" }}
            >
              <div>
                <span className="enrollment-eyebrow">Academic Record</span>

                <h2>Completed Subjects</h2>

                <p>
                  These subjects already have an Approved passing result and are
                  not offered again as Regular enrollment subjects.
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  flexShrink: 0,
                }}
              >
                <div className="selection-counter">
                  {completed_subjects.length} completed
                </div>

                <span
                  aria-hidden="true"
                  style={sectionArrowStyle(expandedSection === "completed")}
                >
                  ▾
                </span>
              </div>
            </div>

            {expandedSection === "completed" && (
              <div className="subject-list">
                {completed_subjects.map((subject) =>
                  renderCompletedSubject(subject),
                )}
              </div>
            )}
          </div>
        )}

        {/* ====================================================
            CURRICULUM
        ==================================================== */}

        {curriculum && (
          <div className="curriculum-card">
            <div>
              <span className="info-label">Curriculum</span>

              <strong>{curriculum.curriculum_name}</strong>
            </div>

            <div>
              <span className="info-label">Effective Year</span>

              <strong>{curriculum.effective_year ?? "—"}</strong>
            </div>

            <div>
              <span className="info-label">Curriculum Units</span>

              <strong>{curriculum.total_units ?? "—"}</strong>
            </div>
          </div>
        )}
        {/* ====================================================
    PREPARE / UPDATE DRAFT ACTION
==================================================== */}

        {enrollment_period &&
          (data.can_prepare || data.can_modify_draft) &&
          (!enrollment || enrollmentIsDraft || enrollmentIsRejected) && (
            <div className="enrollment-submit-card">
              <div className="enrollment-submit-content">
                <div>
                  <span className="enrollment-eyebrow">
                    {enrollmentIsDraft
                      ? "Draft Enrollment"
                      : enrollmentIsRejected
                        ? "New Enrollment Application"
                        : "Enrollment Preparation"}
                  </span>

                  <h2>
                    {enrollmentIsDraft
                      ? "Update Draft Enrollment"
                      : enrollmentIsRejected
                        ? "Prepare New Enrollment"
                        : "Prepare Draft Enrollment"}
                  </h2>

                  <p>
                    {regular_subjects.length} Regular subject
                    {regular_subjects.length !== 1 ? "s" : ""}{" "}
                    {regular_subjects.length !== 1 ? "are" : "is"} included
                    automatically
                    {carry_over_subjects.length > 0
                      ? `, together with ${carry_over_subjects.length} automatic Carry Over subject${
                          carry_over_subjects.length !== 1 ? "s" : ""
                        }`
                      : ""}
                    {selectedRetakeSubjectIds.length > 0
                      ? ` and ${selectedRetakeSubjectIds.length} selected Retake subject${
                          selectedRetakeSubjectIds.length !== 1 ? "s" : ""
                        }`
                      : ""}
                    .
                  </p>

                  <small>
                    {enrollmentIsDraft
                      ? "You may still change your Retake selections while this enrollment remains Draft."
                      : enrollmentIsRejected
                        ? "This creates a brand-new Draft. Your rejected application remains unchanged in enrollment history."
                        : "Review your eligible subjects and choose any valid Retakes before preparing your Draft."}
                  </small>

                  <small>
                    Planned total: {plannedSubjectCount} subject
                    {plannedSubjectCount !== 1 ? "s" : ""} • {plannedUnits}{" "}
                    units.
                  </small>
                </div>

                <button
                  type="button"
                  className="enrollment-btn primary enrollment-submit-btn"
                  onClick={() => void prepareEnrollment()}
                  disabled={!canPrepareEnrollment || preparing || submitting}
                >
                  {preparing ? (
                    <>
                      <span className="button-spinner"></span>

                      {enrollmentIsDraft
                        ? "Updating..."
                        : enrollmentIsRejected
                          ? "Preparing New Enrollment..."
                          : "Preparing..."}
                    </>
                  ) : enrollmentIsDraft ? (
                    "Update Draft Enrollment"
                  ) : enrollmentIsRejected ? (
                    "Prepare New Enrollment"
                  ) : (
                    "Prepare Enrollment"
                  )}
                </button>
              </div>
            </div>
          )}
        {/* ====================================================
            DRAFT REVIEW
        ==================================================== */}

        {enrollmentIsDraft && (
          <div className="subjects-container">
            <div className="subjects-header">
              <div>
                <span className="enrollment-eyebrow">Draft Enrollment</span>

                <h2>Subjects Included in Draft</h2>

                <p>
                  This is the exact subject set that will be submitted for
                  Registrar review.
                </p>
              </div>

              <div className="selection-counter">
                {draftSubjectsCount} subjects • {draftUnits} units
              </div>
            </div>

            <div className="subject-list">
              {[...draftRegularSubjects]
                .sort(
                  (a, b) =>
                    Number(a.display_order || 999999) -
                    Number(b.display_order || 999999),
                )
                .map((subject) => renderRegularSubject(subject))}

              {draftCarryOverSubjects.map((subject) =>
                renderCarryOverSubject(subject),
              )}

              {draftRetakeSubjects.map((subject) =>
                renderRetakeCandidate(subject),
              )}
            </div>
          </div>
        )}

        {/* ====================================================
            SUBMIT ACTION
        ==================================================== */}

        {enrollmentIsDraft && (
          <div className="enrollment-submit-card">
            <div className="enrollment-submit-content">
              <div>
                <span className="enrollment-eyebrow">Ready for Submission</span>

                <h2>Submit Draft Enrollment</h2>

                <p>
                  Submit this Draft to the Registrar. After submission, the
                  Registrar assigns the official section and class offering for
                  each subject.
                </p>

                <small>
                  Student placement fields remain read-only and Registrar-owned.
                </small>
              </div>

              <button
                type="button"
                className="enrollment-btn primary enrollment-submit-btn"
                onClick={() => void submitEnrollment()}
                disabled={!canSubmitEnrollment || submitting || preparing}
              >
                {submitting ? (
                  <>
                    <span className="button-spinner"></span>
                    Submitting...
                  </>
                ) : (
                  "Submit Enrollment"
                )}
              </button>
            </div>
          </div>
        )}

        {/* ====================================================
            PENDING / APPROVED LOCKED STATE
        ==================================================== */}

        {enrollmentIsPending && (
          <div className="enrollment-submit-card">
            <div className="enrollment-submit-content">
              <div>
                <span className="enrollment-eyebrow">Submission Complete</span>

                <h2>Enrollment Awaiting Registrar Review</h2>

                <p>
                  Your enrollment is Pending. No further Student submission or
                  subject selection is allowed.
                </p>
              </div>

              <div className="status-badge pending">
                Pending Registrar Review
              </div>
            </div>
          </div>
        )}

        {enrollmentIsApproved && (
          <div className="enrollment-submit-card">
            <div className="enrollment-submit-content">
              <div>
                <span className="enrollment-eyebrow">Enrollment Complete</span>

                <h2>Enrollment Approved</h2>

                <p>
                  Your enrollment has been reviewed and approved by the
                  Registrar.
                </p>
              </div>

              <div className="status-badge approved">Approved</div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
