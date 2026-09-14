import { useCallback, useEffect, useMemo, useState } from "react";

import { useNavigate } from "react-router-dom";

import {
  AlertCircle,
  BookOpenCheck,
  CalendarDays,
  GraduationCap,
  Layers3,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  Sparkles,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";

import { authService } from "../../../services/auth.service";

import "../../../styles/ClassOfferingManagementR.css";

import OfferingSetupFilters, {
  type AcademicYearOption,
  type SemesterOption,
  type CourseOption,
  type CurriculumOption,
  type SectionOption,
} from "./components/OfferingSetupFilters";

import OfferingReadiness, {
  type OfferingReadinessSummary,
} from "./components/OfferingReadiness";

import OfferingTable, {
  type OfferingTableSubject,
} from "./components/OfferingTable";

import AddOfferingModal from "./components/AddOfferingModal";

import EditOfferingModal from "./EditOfferingModal";

import OfferingStatusModal from "./OfferingStatusModal";

import SectionSubjectStatusModal from "./SectionSubjectStatusModal";

import AddSpecialOfferingModal from "./AddSpecialOfferingModal";

import PrepareSectionSubjectsModal from "./PrepareSectionSubjectsModal";

// =====================================================
// API
// =====================================================

const API_BASE_URL = "http://localhost:3000/api/registrar/offerings";

// =====================================================
// SAFE JSON
// =====================================================

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

// =====================================================
// SETUP TYPES
// =====================================================

interface FacultyOption {
  faculty_id: number;

  employee_number?: string;

  faculty_name?: string;

  first_name?: string;

  middle_name?: string | null;

  last_name?: string;

  department_id?: number | null;
}

interface RoomOption {
  room_id: number;

  room_name: string;

  room_code?: string;

  capacity?: number;
}

// =====================================================
// SETUP SECTION SUBJECT SHAPE
//
// setup-data may expose section-subject fields either
// flat or nested depending on the backend formatter.
// We support both so Special / Retake rows can be
// normalized to OfferingTableSubject safely.
// =====================================================

interface SetupSectionSubjectRow {
  section_subject_id?: number;

  subject_id?: number;

  section_subject_status?: "Open" | "Closed" | "Cancelled" | string;

  status?: "Open" | "Closed" | "Cancelled" | string;

  max_students?: number;

  subject?: {
    subject_id?: number;
  } | null;

  section_subject?: {
    section_subject_id?: number;

    status?: "Open" | "Closed" | "Cancelled" | string;

    max_students?: number;
  } | null;
}

// =====================================================
// SETUP OFFERING SHAPE
//
// setup-data / special readiness rows may expose offering
// fields either flat or nested.  We normalize both forms.
// =====================================================

interface SetupOfferingRow {
  offering_id?: number;

  section_subject_id?: number;

  subject_id?: number;

  section_id?: number;

  faculty_id?: number | null;

  room_id?: number | null;

  academic_year_id?: number;

  semester_id?: number;

  schedule_days?: string | null;

  schedule_time?: string | null;

  max_students?: number;

  offering_max_students?: number;

  enrolled_count?: number;

  available_slots?: number;

  status?: "Open" | "Closed" | "Cancelled" | string;

  offering_status?: "Open" | "Closed" | "Cancelled" | string;

  faculty_name?: string | null;

  room_name?: string | null;

  faculty?: {
    faculty_id?: number;

    faculty_name?: string;
  } | null;

  room?: {
    room_id?: number;

    room_name?: string;
  } | null;

  schedule?: {
    days?: string | null;

    time?: string | null;
  } | null;

  capacity?: {
    max_students?: number;

    enrolled_count?: number;

    available_slots?: number;

    is_full?: boolean;
  } | null;

  offering?: {
    offering_id?: number;

    section_subject_id?: number;

    status?: "Open" | "Closed" | "Cancelled" | string;

    faculty?: {
      faculty_id?: number;

      faculty_name?: string;
    } | null;

    room?: {
      room_id?: number;

      room_name?: string;
    } | null;

    schedule?: {
      days?: string | null;

      time?: string | null;
    } | null;

    capacity?: {
      max_students?: number;

      enrolled_count?: number;

      available_slots?: number;

      is_full?: boolean;
    } | null;

    schedule_days?: string | null;

    schedule_time?: string | null;

    max_students?: number;

    enrolled_count?: number;
  } | null;
}

// =====================================================
// SETUP RESPONSE
// =====================================================

interface SetupDataResponse {
  success: boolean;

  message?: string;

  error?: string;

  academic_years?: AcademicYearOption[];

  semesters?: SemesterOption[];

  courses?: CourseOption[];

  year_levels?: number[];

  curricula?: CurriculumOption[];

  sections?: SectionOption[];

  faculty?: FacultyOption[];

  rooms?: RoomOption[];

  curriculum_subjects?: unknown[];

  section_subjects?: SetupSectionSubjectRow[];

  offerings?: SetupOfferingRow[];

  // Legacy compatibility only; current backend setup-data returns `offerings`.
  subject_offerings?: SetupOfferingRow[];

  counts?: Record<string, number>;

  actor?: {
    user_id: number;

    username: string;
  };
}

// =====================================================
// READINESS RESPONSE
// =====================================================

interface ReadinessResponse {
  success: boolean;

  message?: string;

  error?: string;

  ready: boolean;

  academic_period: {
    academic_year_id: number;

    academic_year: string;

    semester_id: number;

    semester_name: string;
  };

  course: {
    course_id: number;

    course_code: string;

    course_name: string;
  };

  curriculum: {
    curriculum_id: number;

    curriculum_name: string;

    effective_year: number;

    is_active: boolean;
  };

  section: {
    section_id: number;

    section_name: string;

    year_level: number;

    max_students: number;
  };

  summary: OfferingReadinessSummary;

  subjects: OfferingTableSubject[];

  extra_section_subjects: OfferingTableSubject[];

  actor?: {
    user_id: number;

    username: string;
  };
}

// =====================================================
// COMPONENT
// =====================================================

export default function ClassOfferingManagementR() {
  const navigate = useNavigate();

  // =====================================================
  // AUTH
  // =====================================================

  const user = authService.getSession();

  const userRole = user?.role;

  // =====================================================
  // ACADEMIC SETUP
  // =====================================================

  const [academicYearId, setAcademicYearId] = useState("");

  const [semesterId, setSemesterId] = useState("");

  const [courseId, setCourseId] = useState("");

  const [yearLevel, setYearLevel] = useState("");

  const [curriculumId, setCurriculumId] = useState("");

  const [sectionId, setSectionId] = useState("");

  // =====================================================
  // SETUP DATA
  // =====================================================

  const [setupData, setSetupData] = useState<SetupDataResponse | null>(null);

  const [setupLoading, setSetupLoading] = useState(true);

  const [setupError, setSetupError] = useState("");

  // =====================================================
  // READINESS
  // =====================================================

  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);

  const [readinessLoading, setReadinessLoading] = useState(false);

  const [readinessError, setReadinessError] = useState("");

  // =====================================================
  // SELECTED SUBJECT
  // =====================================================

  const [selectedSubject, setSelectedSubject] =
    useState<OfferingTableSubject | null>(null);

  // =====================================================
  // MODALS
  // =====================================================

  const [showPrepareSectionSubjects, setShowPrepareSectionSubjects] =
    useState(false);

  const [showAddOffering, setShowAddOffering] = useState(false);

  const [showEditOffering, setShowEditOffering] = useState(false);

  const [showOfferingStatus, setShowOfferingStatus] = useState(false);

  const [showSectionSubjectStatus, setShowSectionSubjectStatus] =
    useState(false);

  const [showAddSpecialOffering, setShowAddSpecialOffering] = useState(false);

  // =====================================================
  // REFRESH
  // =====================================================

  const [refreshKey, setRefreshKey] = useState(0);

  // =====================================================
  // ROLE GUARD
  // =====================================================

  useEffect(() => {
    if (userRole !== "Registrar") {
      navigate("/login", {
        replace: true,
      });
    }
  }, [userRole, navigate]);

  // =====================================================
  // UNAUTHORIZED
  // =====================================================

  const handleUnauthorized = useCallback(() => {
    authService.logout();

    navigate("/login", {
      replace: true,
    });
  }, [navigate]);

  // =====================================================
  // SETUP QUERY
  // =====================================================

  const setupQueryString = useMemo(() => {
    const params = new URLSearchParams();

    if (academicYearId) {
      params.set("academic_year_id", academicYearId);
    }

    const semesterIsSupported = [1, 2].includes(Number(semesterId));

    if (semesterIsSupported) {
      params.set("semester_id", semesterId);
    }

    if (courseId) {
      params.set("course_id", courseId);
    }

    if (yearLevel) {
      params.set("year_level", yearLevel);
    }

    if (curriculumId) {
      params.set("curriculum_id", curriculumId);
    }

    if (sectionId) {
      params.set("section_id", sectionId);
    }

    return params.toString();
  }, [
    academicYearId,
    semesterId,
    courseId,
    yearLevel,
    curriculumId,
    sectionId,
  ]);

  // =====================================================
  // LOAD SETUP DATA
  // =====================================================

  useEffect(() => {
    if (userRole !== "Registrar") {
      return;
    }

    const controller = new AbortController();

    const loadSetupData = async () => {
      try {
        setSetupLoading(true);

        setSetupError("");

        const url = setupQueryString
          ? `${API_BASE_URL}/setup-data?${setupQueryString}`
          : `${API_BASE_URL}/setup-data`;

        console.log("GET REGISTRAR OFFERING SETUP:", url);

        const response = await authService.authFetch(url, {
          method: "GET",

          signal: controller.signal,

          headers: {
            Accept: "application/json",
          },
        });

        const data = await readJsonResponse<SetupDataResponse>(response);

        // ===============================================
        // 401
        // ===============================================

        if (response.status === 401) {
          handleUnauthorized();

          return;
        }

        // ===============================================
        // 403
        // ===============================================

        if (response.status === 403) {
          throw new Error(
            data.message ||
              data.error ||
              "You are not authorized to manage class offerings.",
          );
        }

        // ===============================================
        // API ERROR
        // ===============================================

        if (!response.ok || !data.success) {
          throw new Error(
            data.message ||
              data.error ||
              "Failed to load class offering setup data.",
          );
        }

        // ===============================================
        // SUCCESS
        //
        // PTC Portal supports only:
        // 1 = First Semester
        // 2 = Second Semester
        //
        // Summer is intentionally excluded.
        // Backend remains authoritative, but the parent
        // sanitizes setup data before it reaches children.
        // ===============================================

        const supportedSemesters = (data.semesters || []).filter((semester) =>
          [1, 2].includes(Number(semester.semester_id)),
        );

        setSetupData({
          ...data,
          semesters: supportedSemesters,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        console.error("LOAD OFFERING SETUP ERROR:", error);

        setSetupData(null);

        setSetupError(
          error instanceof Error
            ? error.message
            : "Unable to load class offering setup.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setSetupLoading(false);
        }
      }
    };

    loadSetupData();

    return () => {
      controller.abort();
    };
  }, [userRole, setupQueryString, refreshKey, handleUnauthorized]);

  // =====================================================
  // AUTO SELECT CURRENT ACADEMIC YEAR
  // =====================================================

  useEffect(() => {
    if (academicYearId || !setupData?.academic_years?.length) {
      return;
    }

    const currentAcademicYear = setupData.academic_years.find(
      (item) => item.is_current,
    );

    if (currentAcademicYear) {
      setAcademicYearId(String(currentAcademicYear.academic_year_id));
    }
  }, [setupData?.academic_years, academicYearId]);

  // =====================================================
  // SELECTION COMPLETE
  // =====================================================

  const semesterIsSupported = [1, 2].includes(Number(semesterId));

  const selectionComplete =
    Boolean(academicYearId) &&
    semesterIsSupported &&
    Boolean(courseId) &&
    Boolean(yearLevel) &&
    Boolean(curriculumId) &&
    Boolean(sectionId);

  // =====================================================
  // READINESS QUERY
  // =====================================================

  const readinessQueryString = useMemo(() => {
    if (!selectionComplete) {
      return "";
    }

    const params = new URLSearchParams();

    params.set("academic_year_id", academicYearId);

    params.set("semester_id", semesterId);

    params.set("course_id", courseId);

    params.set("year_level", yearLevel);

    params.set("curriculum_id", curriculumId);

    params.set("section_id", sectionId);

    return params.toString();
  }, [
    selectionComplete,
    academicYearId,
    semesterId,
    courseId,
    yearLevel,
    curriculumId,
    sectionId,
  ]);

  // =====================================================
  // LOAD READINESS
  // =====================================================

  useEffect(() => {
    if (
      userRole !== "Registrar" ||
      !selectionComplete ||
      !readinessQueryString
    ) {
      setReadiness(null);

      setReadinessError("");

      return;
    }

    const controller = new AbortController();

    const loadReadiness = async () => {
      try {
        setReadinessLoading(true);

        setReadinessError("");

        const url = `${API_BASE_URL}/readiness?${readinessQueryString}`;

        console.log("GET REGISTRAR OFFERING READINESS:", url);

        const response = await authService.authFetch(url, {
          method: "GET",

          signal: controller.signal,

          headers: {
            Accept: "application/json",
          },
        });

        const data = await readJsonResponse<ReadinessResponse>(response);

        // ===============================================
        // 401
        // ===============================================

        if (response.status === 401) {
          handleUnauthorized();

          return;
        }

        // ===============================================
        // 403
        // ===============================================

        if (response.status === 403) {
          throw new Error(
            data.message ||
              data.error ||
              "You are not authorized to view offering readiness.",
          );
        }

        // ===============================================
        // API ERROR
        // ===============================================

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || data.error || "Failed to load offering readiness.",
          );
        }

        // ===============================================
        // SUCCESS
        // ===============================================

        setReadiness(data);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        console.error("LOAD OFFERING READINESS ERROR:", error);

        setReadiness(null);

        setReadinessError(
          error instanceof Error
            ? error.message
            : "Unable to load offering readiness.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setReadinessLoading(false);
        }
      }
    };

    loadReadiness();

    return () => {
      controller.abort();
    };
  }, [
    userRole,
    selectionComplete,
    readinessQueryString,
    refreshKey,
    handleUnauthorized,
  ]);

  // =====================================================
  // OPTION ARRAYS
  // =====================================================

  const academicYears = setupData?.academic_years || [];

  const semesters = (setupData?.semesters || []).filter((semester) =>
    [1, 2].includes(Number(semester.semester_id)),
  );

  const courses = setupData?.courses || [];

  const curricula = setupData?.curricula || [];

  const sections = setupData?.sections || [];

  const faculty = setupData?.faculty || [];

  const rooms = setupData?.rooms || [];

  // =====================================================
  // SELECTED SETUP OBJECTS
  // =====================================================

  const selectedAcademicYear = academicYears.find(
    (item) => String(item.academic_year_id) === academicYearId,
  );

  const selectedSemester = semesterIsSupported
    ? semesters.find((item) => String(item.semester_id) === semesterId)
    : undefined;

  const selectedCourse = courses.find(
    (item) => String(item.course_id) === courseId,
  );

  const selectedCurriculum = curricula.find(
    (item) => String(item.curriculum_id) === curriculumId,
  );

  const selectedSection = sections.find(
    (item) => String(item.section_id) === sectionId,
  );

  // =====================================================
  // NORMALIZE SPECIAL / RETAKE SUBJECTS
  //
  // Special / retake readiness rows must behave exactly
  // like normal OfferingTableSubject rows.
  //
  // We therefore resolve BOTH layers:
  //
  //   section_subject
  //   subject_offering
  //
  // Primary relationship:
  //   subject_offerings.section_subject_id
  //       =
  //   section_subjects.section_subject_id
  //
  // This prevents a real existing offering from being
  // rendered as "NO OFFERING".
  // =====================================================

  const normalizedSpecialSubjects = useMemo<OfferingTableSubject[]>(() => {
    const extraSubjects = readiness?.extra_section_subjects || [];

    const setupSectionSubjects = setupData?.section_subjects || [];

    const setupOfferings =
      setupData?.offerings || setupData?.subject_offerings || [];

    const getFacultyNameById = (facultyId: number | null) => {
      if (!facultyId) {
        return null;
      }

      const match = faculty.find(
        (item) => Number(item.faculty_id) === facultyId,
      );

      if (!match) {
        return `Faculty #${facultyId}`;
      }

      if (match.faculty_name) {
        return match.faculty_name;
      }

      const name = [match.first_name, match.middle_name, match.last_name]
        .filter(Boolean)
        .join(" ");

      return name || `Faculty #${facultyId}`;
    };

    const getRoomNameById = (roomId: number | null) => {
      if (!roomId) {
        return null;
      }

      const match = rooms.find((item) => Number(item.room_id) === roomId);

      return match?.room_name || `Room #${roomId}`;
    };

    return extraSubjects.map((item) => {
      // -------------------------------------------------
      // RAW SPECIAL ROW
      // -------------------------------------------------

      const rawItem = item as OfferingTableSubject &
        SetupSectionSubjectRow &
        SetupOfferingRow;

      // -------------------------------------------------
      // RESOLVE SECTION SUBJECT
      // -------------------------------------------------

      const setupSectionMatch = setupSectionSubjects.find((row) => {
        const rowSectionSubjectId = Number(
          row.section_subject?.section_subject_id ??
            row.section_subject_id ??
            0,
        );

        const itemSectionSubjectId = Number(
          item.section_subject?.section_subject_id ??
            rawItem.section_subject_id ??
            0,
        );

        if (rowSectionSubjectId > 0 && itemSectionSubjectId > 0) {
          return rowSectionSubjectId === itemSectionSubjectId;
        }

        const rowSubjectId = Number(
          row.subject?.subject_id ?? row.subject_id ?? 0,
        );

        return rowSubjectId === Number(item.subject.subject_id);
      });

      const sectionSubjectId = Number(
        item.section_subject?.section_subject_id ??
          rawItem.section_subject_id ??
          setupSectionMatch?.section_subject?.section_subject_id ??
          setupSectionMatch?.section_subject_id ??
          0,
      );

      const rawSectionStatus =
        item.section_subject?.status ??
        rawItem.section_subject_status ??
        setupSectionMatch?.section_subject?.status ??
        setupSectionMatch?.status;

      const sectionSubjectStatus: "Open" | "Closed" | "Cancelled" =
        rawSectionStatus === "Closed" || rawSectionStatus === "Cancelled"
          ? rawSectionStatus
          : "Open";

      const sectionSubjectCapacity = Number(
        item.section_subject?.max_students ??
          setupSectionMatch?.section_subject?.max_students ??
          setupSectionMatch?.max_students ??
          selectedSection?.max_students ??
          50,
      );

      const canonicalSectionSubject =
        Number.isInteger(sectionSubjectId) && sectionSubjectId > 0
          ? {
              section_subject_id: sectionSubjectId,

              status: sectionSubjectStatus,

              max_students:
                Number.isFinite(sectionSubjectCapacity) &&
                sectionSubjectCapacity > 0
                  ? sectionSubjectCapacity
                  : 50,
            }
          : null;

      // -------------------------------------------------
      // RESOLVE EXISTING OFFERING
      //
      // IMPORTANT:
      // readiness.extra_section_subjects is intentionally
      // sparse. It may contain only offering_id + status.
      // setup-data.offerings contains the complete offering
      // configuration (faculty, room, schedule, capacity).
      //
      // Therefore prefer the full setup-data offering matched
      // by section_subject_id before using the sparse readiness
      // row.
      // -------------------------------------------------

      const setupOfferingMatch =
        sectionSubjectId > 0
          ? setupOfferings.find((row) => {
              const nestedSectionSubjectId = Number(
                row.offering?.section_subject_id ?? 0,
              );

              const flatSectionSubjectId = Number(row.section_subject_id ?? 0);

              return (
                nestedSectionSubjectId === sectionSubjectId ||
                flatSectionSubjectId === sectionSubjectId
              );
            })
          : undefined;

      const rawOfferingSource: SetupOfferingRow | null =
        setupOfferingMatch ||
        (item.offering
          ? ({
              offering: item.offering,
            } as SetupOfferingRow)
          : Number(rawItem.offering_id ?? 0) > 0
            ? rawItem
            : null);

      let canonicalOffering: OfferingTableSubject["offering"] = null;

      if (rawOfferingSource) {
        const nested = rawOfferingSource.offering || null;

        const offeringId = Number(
          nested?.offering_id ?? rawOfferingSource.offering_id ?? 0,
        );

        if (Number.isInteger(offeringId) && offeringId > 0) {
          const rawOfferingStatus =
            nested?.status ??
            rawOfferingSource.offering_status ??
            rawOfferingSource.status;

          const offeringStatus: "Open" | "Closed" | "Cancelled" =
            rawOfferingStatus === "Open" || rawOfferingStatus === "Cancelled"
              ? rawOfferingStatus
              : "Closed";

          const facultyIdValue = Number(
            nested?.faculty?.faculty_id ??
              rawOfferingSource.faculty?.faculty_id ??
              rawOfferingSource.faculty_id ??
              0,
          );

          const facultyId =
            Number.isInteger(facultyIdValue) && facultyIdValue > 0
              ? facultyIdValue
              : null;

          const facultyName =
            nested?.faculty?.faculty_name ??
            rawOfferingSource.faculty?.faculty_name ??
            rawOfferingSource.faculty_name ??
            getFacultyNameById(facultyId);

          const roomIdValue = Number(
            nested?.room?.room_id ??
              rawOfferingSource.room?.room_id ??
              rawOfferingSource.room_id ??
              0,
          );

          const roomId =
            Number.isInteger(roomIdValue) && roomIdValue > 0
              ? roomIdValue
              : null;

          const roomName =
            nested?.room?.room_name ??
            rawOfferingSource.room?.room_name ??
            rawOfferingSource.room_name ??
            getRoomNameById(roomId);

          const scheduleDays =
            nested?.schedule?.days ??
            nested?.schedule_days ??
            rawOfferingSource.schedule?.days ??
            rawOfferingSource.schedule_days ??
            null;

          const scheduleTime =
            nested?.schedule?.time ??
            nested?.schedule_time ??
            rawOfferingSource.schedule?.time ??
            rawOfferingSource.schedule_time ??
            null;

          const offeringMaxStudents = Number(
            nested?.capacity?.max_students ??
              nested?.max_students ??
              rawOfferingSource.capacity?.max_students ??
              rawOfferingSource.offering_max_students ??
              rawOfferingSource.max_students ??
              canonicalSectionSubject?.max_students ??
              50,
          );

          const enrolledCount = Number(
            nested?.capacity?.enrolled_count ??
              nested?.enrolled_count ??
              rawOfferingSource.capacity?.enrolled_count ??
              rawOfferingSource.enrolled_count ??
              0,
          );

          const explicitAvailableSlots =
            nested?.capacity?.available_slots ??
            rawOfferingSource.capacity?.available_slots ??
            rawOfferingSource.available_slots;

          const maxStudents =
            Number.isFinite(offeringMaxStudents) && offeringMaxStudents > 0
              ? offeringMaxStudents
              : canonicalSectionSubject?.max_students || 50;

          const safeEnrolledCount =
            Number.isFinite(enrolledCount) && enrolledCount >= 0
              ? enrolledCount
              : 0;

          const availableSlots =
            explicitAvailableSlots !== undefined &&
            explicitAvailableSlots !== null &&
            Number.isFinite(Number(explicitAvailableSlots))
              ? Math.max(0, Number(explicitAvailableSlots))
              : Math.max(0, maxStudents - safeEnrolledCount);

          const explicitIsFull =
            nested?.capacity?.is_full ?? rawOfferingSource.capacity?.is_full;

          canonicalOffering = {
            offering_id: offeringId,

            status: offeringStatus,

            faculty:
              facultyId && facultyName
                ? {
                    faculty_id: facultyId,

                    faculty_name: facultyName,
                  }
                : null,

            room:
              roomId && roomName
                ? {
                    room_id: roomId,

                    room_name: roomName,
                  }
                : null,

            schedule: {
              days: scheduleDays || null,

              time: scheduleTime || null,
            },

            capacity: {
              max_students: maxStudents,

              enrolled_count: safeEnrolledCount,

              available_slots: availableSlots,

              is_full:
                typeof explicitIsFull === "boolean"
                  ? explicitIsFull
                  : maxStudents > 0 && safeEnrolledCount >= maxStudents,
            },
          };
        }
      }

      // -------------------------------------------------
      // READINESS FLAGS
      //
      // Keep Special / Retake rows aligned with the exact
      // readiness contract returned by GET /readiness.
      // -------------------------------------------------

      const hasSectionSubject = Boolean(canonicalSectionSubject);

      const hasOffering = Boolean(canonicalOffering);

      const configurationComplete = Boolean(
        canonicalOffering &&
        canonicalOffering.faculty &&
        canonicalOffering.schedule.days &&
        canonicalOffering.schedule.time &&
        canonicalOffering.capacity.max_students > 0,
      );

      // Match backend GET /readiness exactly.
      // Capacity fullness is handled by enrollment placement;
      // it does not make the offering configuration incomplete.
      const readyForEnrollment = Boolean(
        configurationComplete &&
        canonicalSectionSubject?.status === "Open" &&
        canonicalOffering?.status === "Open",
      );

      const missingConfiguration: string[] = [];

      // -------------------------------------------------
      // SECTION SUBJECT
      // -------------------------------------------------

      if (!hasSectionSubject) {
        missingConfiguration.push("section_subject");
      } else if (canonicalSectionSubject?.status !== "Open") {
        missingConfiguration.push("section_subject_open");
      }

      // -------------------------------------------------
      // SUBJECT OFFERING
      // -------------------------------------------------

      if (!hasOffering) {
        missingConfiguration.push("offering");
      } else {
        if (!canonicalOffering?.faculty) {
          missingConfiguration.push("faculty_id");
        }

        if (!canonicalOffering?.schedule.days) {
          missingConfiguration.push("schedule_days");
        }

        if (!canonicalOffering?.schedule.time) {
          missingConfiguration.push("schedule_time");
        }

        if (Number(canonicalOffering?.capacity.max_students || 0) <= 0) {
          missingConfiguration.push("max_students");
        }

        if (canonicalOffering?.status !== "Open") {
          missingConfiguration.push("offering_open");
        }
      }

      if (!hasSectionSubject) {
        console.warn(
          "SPECIAL SUBJECT COULD NOT RESOLVE SECTION SUBJECT:",
          item,
        );
      }

      if (hasSectionSubject && !hasOffering && setupOfferings.length > 0) {
        console.warn("SPECIAL SUBJECT HAS NO RESOLVED OFFERING:", {
          section_subject_id: sectionSubjectId,

          subject_id: item.subject.subject_id,

          setup_offerings: setupOfferings,
        });
      }

      return {
        ...item,

        section_subject: canonicalSectionSubject,

        offering: canonicalOffering,

        has_section_subject: hasSectionSubject,

        has_offering: hasOffering,

        configuration_complete: configurationComplete,

        ready_for_enrollment: readyForEnrollment,

        missing_configuration: missingConfiguration,
      };
    });
  }, [
    readiness?.extra_section_subjects,
    setupData?.section_subjects,
    setupData?.offerings,
    setupData?.subject_offerings,
    selectedSection?.max_students,
    faculty,
    rooms,
  ]);

  // =====================================================
  // YEAR LEVELS
  // =====================================================

  const yearLevels = useMemo(() => {
    if (setupData?.year_levels && setupData.year_levels.length > 0) {
      return setupData.year_levels;
    }

    const selectedCourseOption = courses.find(
      (course) => String(course.course_id) === courseId,
    );

    const totalYears = Number(selectedCourseOption?.total_years || 0);

    if (totalYears > 0) {
      return Array.from(
        {
          length: totalYears,
        },
        (_, index) => index + 1,
      );
    }

    return [1, 2, 3, 4];
  }, [setupData?.year_levels, courses, courseId]);

  // =====================================================
  // RESET MODALS / SUBJECT
  // =====================================================

  const resetOfferingUi = () => {
    setReadiness(null);

    setSelectedSubject(null);

    setShowPrepareSectionSubjects(false);

    setShowAddOffering(false);

    setShowEditOffering(false);

    setShowOfferingStatus(false);

    setShowSectionSubjectStatus(false);

    setShowAddSpecialOffering(false);
  };

  // =====================================================
  // ACADEMIC YEAR CHANGE
  // =====================================================

  const handleAcademicYearChange = (value: string) => {
    setAcademicYearId(value);

    setSemesterId("");

    setCourseId("");

    setYearLevel("");

    setCurriculumId("");

    setSectionId("");

    resetOfferingUi();
  };

  // =====================================================
  // SEMESTER CHANGE
  // =====================================================

  const handleSemesterChange = (value: string) => {
    const normalizedSemesterId = [1, 2].includes(Number(value)) ? value : "";

    setSemesterId(normalizedSemesterId);

    setCourseId("");

    setYearLevel("");

    setCurriculumId("");

    setSectionId("");

    resetOfferingUi();
  };

  // =====================================================
  // COURSE CHANGE
  // =====================================================

  const handleCourseChange = (value: string) => {
    setCourseId(value);

    setYearLevel("");

    setCurriculumId("");

    setSectionId("");

    resetOfferingUi();
  };

  // =====================================================
  // YEAR LEVEL CHANGE
  // =====================================================

  const handleYearLevelChange = (value: string) => {
    setYearLevel(value);

    setCurriculumId("");

    setSectionId("");

    resetOfferingUi();
  };

  // =====================================================
  // CURRICULUM CHANGE
  // =====================================================

  const handleCurriculumChange = (value: string) => {
    setCurriculumId(value);

    setSectionId("");

    resetOfferingUi();
  };

  // =====================================================
  // SECTION CHANGE
  // =====================================================

  const handleSectionChange = (value: string) => {
    setSectionId(value);

    resetOfferingUi();
  };

  // =====================================================
  // REFRESH
  // =====================================================

  const refreshOfferingData = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);

  // =====================================================
  // PREPARE SECTION SUBJECTS
  // =====================================================

  const openPrepareSectionSubjects = () => {
    if (!selectionComplete) {
      return;
    }

    setShowPrepareSectionSubjects(true);
  };

  const closePrepareSectionSubjects = () => {
    setShowPrepareSectionSubjects(false);
  };

  const handlePrepareSectionSubjectsSuccess = () => {
    setShowPrepareSectionSubjects(false);

    refreshOfferingData();
  };

  // =====================================================
  // CREATE OFFERING
  // =====================================================

  const openAddOffering = (subject: OfferingTableSubject) => {
    setSelectedSubject(subject);

    setShowAddOffering(true);
  };

  const closeAddOfferingModal = () => {
    setShowAddOffering(false);

    setSelectedSubject(null);
  };

  const handleAddOfferingSuccess = () => {
    refreshOfferingData();
  };

  // =====================================================
  // EDIT OFFERING
  // =====================================================

  const openEditOffering = (subject: OfferingTableSubject) => {
    setSelectedSubject(subject);

    setShowEditOffering(true);
  };

  const closeEditOfferingModal = () => {
    setShowEditOffering(false);

    setSelectedSubject(null);
  };

  const handleEditOfferingSuccess = () => {
    refreshOfferingData();
  };

  // =====================================================
  // OFFERING STATUS
  // =====================================================

  const openOfferingStatus = (subject: OfferingTableSubject) => {
    setSelectedSubject(subject);

    setShowOfferingStatus(true);
  };

  const closeOfferingStatusModal = () => {
    setShowOfferingStatus(false);

    setSelectedSubject(null);
  };

  const handleOfferingStatusSuccess = () => {
    setShowOfferingStatus(false);

    setSelectedSubject(null);

    refreshOfferingData();
  };

  // =====================================================
  // SECTION SUBJECT STATUS
  // =====================================================

  const openSectionSubjectStatus = (subject: OfferingTableSubject) => {
    setSelectedSubject(subject);

    setShowSectionSubjectStatus(true);
  };

  const closeSectionSubjectStatusModal = () => {
    setShowSectionSubjectStatus(false);

    setSelectedSubject(null);
  };

  const handleSectionSubjectStatusSuccess = () => {
    setShowSectionSubjectStatus(false);

    setSelectedSubject(null);

    refreshOfferingData();
  };

  // =====================================================
  // SPECIAL / RETAKE OFFERING
  // =====================================================

  const openAddSpecialOffering = () => {
    if (!selectionComplete) {
      return;
    }

    // Special / Retake creation is its own workflow.
    // Clear any subject previously selected by Edit / Status
    // so stale row state cannot leak into this modal.
    setSelectedSubject(null);

    setShowAddSpecialOffering(true);
  };

  const closeAddSpecialOfferingModal = () => {
    setShowAddSpecialOffering(false);

    setSelectedSubject(null);
  };

  const handleAddSpecialOfferingSuccess = () => {
    // The updated AddSpecialOfferingModal creates:
    //
    //   1. special section_subject
    //   2. linked blank subject_offering
    //
    // The blank subject_offering is intentionally Closed and
    // configuration-incomplete until Registrar edits faculty /
    // schedule / optional room.
    setShowAddSpecialOffering(false);

    setSelectedSubject(null);

    // refreshKey is consumed by BOTH setup-data and readiness,
    // so the newly created offering is available to the special
    // row normalizer immediately after the mutation.
    refreshOfferingData();
  };

  // =====================================================
  // RESET CURRENT SETUP SELECTION
  //
  // Keep the selected/current academic year in place and
  // clear the remaining cascade. This is frontend-only and
  // does not mutate offering data.
  // =====================================================

  const resetSetupSelection = () => {
    setSemesterId("");

    setCourseId("");

    setYearLevel("");

    setCurriculumId("");

    setSectionId("");

    resetOfferingUi();
  };

  const hasSetupSelection = Boolean(
    semesterId || courseId || yearLevel || curriculumId || sectionId,
  );

  // =====================================================
  // AUTH GUARD
  // =====================================================

  if (!user || userRole !== "Registrar") {
    return null;
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <DashboardLayout>
      <main className="registrar-class-offering">
        <section className="registrar-class-offering__hero">
          <div className="registrar-class-offering__hero-copy">
            <div className="registrar-class-offering__eyebrow">
              <span className="registrar-class-offering__eyebrow-icon">
                <BookOpenCheck size={16} aria-hidden="true" />
              </span>
              Registrar · Academic Setup
            </div>

            <h1>Class Offerings</h1>

            <p>
              Prepare section subjects and configure faculty, schedules, rooms,
              capacity, and enrollment availability for each class offering.
            </p>
          </div>

          <div className="registrar-class-offering__hero-actions">
            {hasSetupSelection && (
              <button
                type="button"
                className="registrar-class-offering__button registrar-class-offering__button--secondary"
                onClick={resetSetupSelection}
              >
                <RotateCcw size={16} aria-hidden="true" />
                Reset Setup
              </button>
            )}

            <button
              type="button"
              className="registrar-class-offering__button registrar-class-offering__button--primary"
              onClick={refreshOfferingData}
              disabled={setupLoading || readinessLoading}
            >
              <RefreshCw
                size={16}
                className={
                  setupLoading || readinessLoading
                    ? "registrar-class-offering__spin"
                    : undefined
                }
                aria-hidden="true"
              />
              Refresh
            </button>
          </div>
        </section>

        <section
          className="registrar-class-offering__overview"
          aria-label="Selected class offering setup"
        >
          <article className="registrar-class-offering__overview-card">
            <span className="registrar-class-offering__overview-icon">
              <CalendarDays size={18} aria-hidden="true" />
            </span>
            <div>
              <span>Academic Period</span>
              <strong>{selectedAcademicYear?.academic_year || "Select year"}</strong>
              <small>{selectedSemester?.semester_name || "Semester not selected"}</small>
            </div>
          </article>

          <article className="registrar-class-offering__overview-card">
            <span className="registrar-class-offering__overview-icon">
              <GraduationCap size={18} aria-hidden="true" />
            </span>
            <div>
              <span>Program</span>
              <strong>{selectedCourse?.course_code || "Select course"}</strong>
              <small>
                {yearLevel
                  ? `Year ${yearLevel}`
                  : selectedCourse?.course_name || "Year level not selected"}
              </small>
            </div>
          </article>

          <article className="registrar-class-offering__overview-card">
            <span className="registrar-class-offering__overview-icon">
              <UsersRound size={18} aria-hidden="true" />
            </span>
            <div>
              <span>Section</span>
              <strong>{selectedSection?.section_name || "Select section"}</strong>
              <small>
                {selectedSection?.max_students
                  ? `Capacity ${selectedSection.max_students}`
                  : selectedCurriculum?.curriculum_name ||
                    "Curriculum and section not selected"}
              </small>
            </div>
          </article>

          <article
            className={`registrar-class-offering__overview-card ${
              readiness?.ready
                ? "registrar-class-offering__overview-card--ready"
                : ""
            }`}
          >
            <span className="registrar-class-offering__overview-icon">
              <Layers3 size={18} aria-hidden="true" />
            </span>
            <div>
              <span>Enrollment Readiness</span>
              <strong>
                {!selectionComplete
                  ? "Awaiting setup"
                  : readinessLoading
                    ? "Checking…"
                    : readiness?.ready
                      ? "Ready"
                      : readiness
                        ? "Needs setup"
                        : "Not checked"}
              </strong>
              <small>
                {readiness
                  ? `${readiness.summary.ready_for_enrollment}/${readiness.summary.curriculum_subjects} curriculum offerings ready`
                  : "Complete the setup filters to check readiness"}
              </small>
            </div>
          </article>
        </section>

        {setupError && (
          <div className="class-offering-error" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <div>
              <strong>Unable to load offering setup</strong>
              <span>{setupError}</span>
            </div>
            <button type="button" onClick={refreshOfferingData}>
              Try Again
            </button>
          </div>
        )}

        <OfferingSetupFilters
          academicYears={academicYears}
          semesters={semesters}
          courses={courses}
          yearLevels={yearLevels}
          curricula={curricula}
          sections={sections}
          academicYearId={academicYearId}
          semesterId={semesterId}
          courseId={courseId}
          yearLevel={yearLevel}
          curriculumId={curriculumId}
          sectionId={sectionId}
          loading={setupLoading}
          onAcademicYearChange={handleAcademicYearChange}
          onSemesterChange={handleSemesterChange}
          onCourseChange={handleCourseChange}
          onYearLevelChange={handleYearLevelChange}
          onCurriculumChange={handleCurriculumChange}
          onSectionChange={handleSectionChange}
        />

        {!selectionComplete && (
          <section className="class-offering-section">
            <div className="class-offering-empty class-offering-empty--setup">
              <span className="class-offering-empty-icon">
                <Settings2 size={24} aria-hidden="true" />
              </span>
              <h3>Select an Academic Setup</h3>
              <p>
                Complete Academic Year, Semester, Course, Year Level,
                Curriculum, and Section to review and configure class offerings.
              </p>
            </div>
          </section>
        )}

        {selectionComplete && readinessError && (
          <div className="class-offering-error" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <div>
              <strong>Unable to check offering readiness</strong>
              <span>{readinessError}</span>
            </div>
            <button type="button" onClick={refreshOfferingData}>
              Try Again
            </button>
          </div>
        )}

        {selectionComplete && readinessLoading && (
          <section className="class-offering-section">
            <div className="class-offering-loading">
              <RefreshCw
                size={18}
                className="registrar-class-offering__spin"
                aria-hidden="true"
              />
              Checking class offering readiness…
            </div>
          </section>
        )}

        {selectionComplete && !readinessLoading && readiness && (
          <>
            <OfferingReadiness
              ready={readiness.ready}
              courseCode={readiness.course.course_code}
              sectionName={readiness.section.section_name}
              academicYear={readiness.academic_period.academic_year}
              semesterName={readiness.academic_period.semester_name}
              summary={readiness.summary}
            />

            {readiness.summary.missing_section_subjects > 0 && (
              <section className="class-offering-prepare-section">
                <div className="class-offering-prepare-section-content">
                  <div className="class-offering-prepare-icon">
                    <AlertCircle size={20} aria-hidden="true" />
                  </div>

                  <div className="class-offering-prepare-section-text">
                    <h3>Section Setup Required</h3>

                    <p>
                      <strong>{readiness.section.section_name}</strong> has{" "}
                      <strong>{readiness.summary.missing_section_subjects}</strong>{" "}
                      curriculum subject
                      {readiness.summary.missing_section_subjects !== 1
                        ? "s"
                        : ""}{" "}
                      that still need to be prepared before their class offerings
                      can be configured.
                    </p>
                  </div>
                </div>

                <button type="button" onClick={openPrepareSectionSubjects}>
                  <Layers3 size={16} aria-hidden="true" />
                  Prepare {readiness.summary.missing_section_subjects} Section
                  Subject
                  {readiness.summary.missing_section_subjects !== 1 ? "s" : ""}
                </button>
              </section>
            )}

            <OfferingTable
              subjects={readiness.subjects}
              onCreateOffering={openAddOffering}
              onEditOffering={openEditOffering}
              onOfferingStatus={openOfferingStatus}
              onSectionSubjectStatus={openSectionSubjectStatus}
            />

            <section className="class-offering-section">
              <div className="class-offering-section-header">
                <div>
                  <div className="class-offering-section-kicker">
                    <Sparkles size={14} aria-hidden="true" />
                    Exceptions
                  </div>
                  <h2>Special / Retake Offerings</h2>

                  <p>
                    Manage exception and retake classes outside the normal
                    curriculum subjects for this term. New special offerings
                    start Closed and remain incomplete until faculty and schedule
                    are configured.
                  </p>
                </div>

                <button
                  type="button"
                  className="class-offering-section-action"
                  onClick={openAddSpecialOffering}
                >
                  <Plus size={16} aria-hidden="true" />
                  Add Special Offering
                </button>
              </div>

              {normalizedSpecialSubjects.length > 0 ? (
                <OfferingTable
                  subjects={normalizedSpecialSubjects}
                  onCreateOffering={openAddOffering}
                  onEditOffering={openEditOffering}
                  onOfferingStatus={openOfferingStatus}
                  onSectionSubjectStatus={openSectionSubjectStatus}
                />
              ) : (
                <div className="class-offering-empty">
                  <span className="class-offering-empty-icon">
                    <Sparkles size={22} aria-hidden="true" />
                  </span>
                  <h3>No Special Offerings</h3>
                  <p>
                    No special or retake offerings have been created for this
                    academic setup.
                  </p>
                </div>
              )}
            </section>
          </>
        )}

        <PrepareSectionSubjectsModal
          open={showPrepareSectionSubjects}
          academicYearId={academicYearId}
          semesterId={semesterId}
          courseId={courseId}
          yearLevel={yearLevel}
          curriculumId={curriculumId}
          sectionId={sectionId}
          academicYear={
            selectedAcademicYear?.academic_year ||
            readiness?.academic_period.academic_year ||
            ""
          }
          semesterName={
            selectedSemester?.semester_name ||
            readiness?.academic_period.semester_name ||
            ""
          }
          courseCode={
            selectedCourse?.course_code || readiness?.course.course_code || ""
          }
          curriculumName={
            selectedCurriculum?.curriculum_name ||
            readiness?.curriculum.curriculum_name ||
            ""
          }
          sectionName={
            selectedSection?.section_name ||
            readiness?.section.section_name ||
            ""
          }
          subjects={readiness?.subjects || []}
          onClose={closePrepareSectionSubjects}
          onSuccess={handlePrepareSectionSubjectsSuccess}
          onUnauthorized={handleUnauthorized}
        />

        <AddOfferingModal
          open={showAddOffering}
          subject={selectedSubject}
          faculty={faculty}
          rooms={rooms}
          onClose={closeAddOfferingModal}
          onSuccess={handleAddOfferingSuccess}
          onUnauthorized={handleUnauthorized}
        />

        <EditOfferingModal
          open={showEditOffering}
          subject={selectedSubject}
          faculty={faculty}
          rooms={rooms}
          onClose={closeEditOfferingModal}
          onSuccess={handleEditOfferingSuccess}
          onUnauthorized={handleUnauthorized}
        />

        <OfferingStatusModal
          open={showOfferingStatus}
          subject={selectedSubject}
          onClose={closeOfferingStatusModal}
          onSuccess={handleOfferingStatusSuccess}
          onUnauthorized={handleUnauthorized}
        />

        <SectionSubjectStatusModal
          open={showSectionSubjectStatus}
          subject={selectedSubject}
          onClose={closeSectionSubjectStatusModal}
          onSuccess={handleSectionSubjectStatusSuccess}
          onUnauthorized={handleUnauthorized}
        />

        <AddSpecialOfferingModal
          open={showAddSpecialOffering}
          academicYearId={academicYearId}
          semesterId={semesterId}
          courseId={courseId}
          yearLevel={yearLevel}
          curriculumId={curriculumId}
          sectionId={sectionId}
          academicYear={
            selectedAcademicYear?.academic_year ||
            readiness?.academic_period.academic_year ||
            ""
          }
          semesterName={
            selectedSemester?.semester_name ||
            readiness?.academic_period.semester_name ||
            ""
          }
          courseCode={
            selectedCourse?.course_code || readiness?.course.course_code || ""
          }
          sectionName={
            selectedSection?.section_name ||
            readiness?.section.section_name ||
            ""
          }
          defaultCapacity={
            Number(
              selectedSection?.max_students ??
                readiness?.section.max_students ??
                50,
            ) || 50
          }
          existingSubjectIds={[
            ...(readiness?.subjects || []).map(
              (item) => item.subject.subject_id,
            ),
            ...normalizedSpecialSubjects
              .filter((item) => item.has_offering)
              .map((item) => item.subject.subject_id),
          ]}
          onClose={closeAddSpecialOfferingModal}
          onSuccess={handleAddSpecialOfferingSuccess}
          onUnauthorized={handleUnauthorized}
        />
      </main>
    </DashboardLayout>
  );
}
