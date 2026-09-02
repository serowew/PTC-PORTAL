import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Award,
  BookCheck,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileCheck2,
  FileText,
  FilterX,
  GraduationCap,
  History,
  LibraryBig,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/RegistrarAcademicRecord.css";

const API_BASE_URL = "http://localhost:3000/api/registrar/students";

type AcademicClassification =
  | "Passed"
  | "Incomplete"
  | "Failed"
  | "Credited"
  | "Unknown";

type AcademicRecordType = "PTC_GRADE" | "TRANSFER_CREDIT";

interface Student {
  student_id: number;
  student_number: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender?: string | null;
  birth_date?: string | null;
  contact_number?: string | null;
  email?: string | null;
  course_id?: number | null;
  course_code: string;
  course_name?: string | null;
  year_level: number;
  status: string;
  section_id?: number | null;
  section_name?: string | null;
  semester_id?: number | null;
  semester_name?: string | null;
  house_no?: string | null;
  street?: string | null;
  barangay?: string | null;
  city?: string | null;
  province?: string | null;
  zip_code?: string | null;
}

interface FacultyInfo {
  faculty_id: number;
  employee_number?: string | null;
  faculty_name?: string | null;
}

interface ApprovalInfo {
  reviewed_by: number | null;
  reviewed_by_username: string | null;
  reviewed_at: string | null;
  review_remarks?: string | null;
}

interface TransferSource {
  school: string;
  course: string | null;
  student_number: string | null;
  subject_code: string | null;
  subject_name: string;
  units: number | null;
  grade: string | null;
  remarks: string | null;
  academic_year: string | null;
  year_level: number | null;
  semester: string | null;
}

interface CurriculumMapping {
  curriculum_id: number | null;
  curriculum_name: string | null;
  curriculum_subject_id: number | null;
  year_level: number | null;
  semester_id: number | null;
  semester_name: string | null;
  is_required: boolean | null;
}

interface TransferCompletion {
  evaluation_status: string;
  completed_by: number | null;
  completed_by_username: string | null;
  completed_at: string | null;
  completion_remarks: string | null;
}

interface AcademicRecord {
  record_type: AcademicRecordType;
  academic_source: string;
  official_record: boolean;
  grade_id: number | null;
  enrollment_subject_id: number | null;
  enrollment_id: number | null;
  transfer_evaluation_id: number | null;
  transfer_subject_id: number | null;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  units: number;
  lecture_hours?: number | null;
  laboratory_hours?: number | null;
  academic_year_id: number | null;
  academic_year: string | null;
  semester_id: number | null;
  semester_name: string | null;
  enrollment_status: string | null;
  subject_status: string;
  offering_id?: number | null;
  section_id?: number | null;
  section_subject_id?: number | null;
  section_name?: string | null;
  faculty_id?: number | null;
  faculty?: FacultyInfo | null;
  prelim_grade: number | null;
  midterm_grade: number | null;
  final_grade: number | null;
  final_rating: number | null;
  source_grade: string | null;
  academic_result?: AcademicClassification | null;
  classification?: AcademicClassification | null;
  result_code?: string | null;
  remarks: string | null;
  grade_status: "Draft" | "Submitted" | "Returned" | "Approved" | null;
  passed?: boolean;
  retake?: boolean;
  valid_result?: boolean;
  curriculum_satisfied?: boolean;
  submitted_at?: string | null;
  approval?: ApprovalInfo | null;
  reviewed_by?: number | null;
  reviewed_by_username?: string | null;
  reviewed_at?: string | null;
  review_remarks?: string | null;
  transfer_source?: TransferSource | null;
  curriculum_mapping?: CurriculumMapping | null;
  transfer_completion?: TransferCompletion | null;
  grade_created_at?: string | null;
  grade_updated_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface AcademicSummary {
  total_official_records?: number;
  total_recorded_units?: number;
  earned_units?: number;
  unique_satisfied_subjects?: number;
  total_approved_subjects?: number;
  ptc_grade_records?: number;
  ptc_recorded_units?: number;
  ptc_earned_units?: number;
  passed_subjects?: number;
  incomplete_subjects?: number;
  failed_subjects?: number;
  retake_subjects?: number;
  official_transfer_credit_records?: number;
  unique_transfer_credit_subjects?: number;
  transfer_credited_units?: number;
}

interface AcademicResponse {
  success: boolean;
  code?: string;
  student?: Student;
  totalSubjects?: number;
  records?: AcademicRecord[];
  summary?: AcademicSummary;
  ptc_grade_records?: AcademicRecord[];
  transfer_credit_records?: AcademicRecord[];
  academic_rule?: {
    official_ptc_grade?: string;
    official_transfer_credit?: string;
    transfer_grade_stored_as_ptc_grade?: boolean;
    earned_units_deduplicated_by_ptc_subject?: boolean;
  };
  message?: string;
  error?: string;
}

interface SemesterGroup {
  key: string;
  semesterName: string;
  sortOrder: number;
  records: AcademicRecord[];
}

interface AcademicYearGroup {
  key: string;
  academicYear: string;
  sortOrder: number;
  semesters: SemesterGroup[];
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

function isTransferCredit(record: AcademicRecord): boolean {
  return record.record_type === "TRANSFER_CREDIT";
}

function isPtcGrade(record: AcademicRecord): boolean {
  return record.record_type === "PTC_GRADE";
}

function formatGrade(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) return String(value);

  return numeric.toFixed(2);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function classifyFinalRating(
  finalRating: number | null | undefined,
): AcademicClassification {
  if (finalRating === null || finalRating === undefined) return "Unknown";

  const rating = Number(finalRating);

  if (!Number.isFinite(rating)) return "Unknown";
  if (rating >= 1 && rating <= 3) return "Passed";
  if (rating === 4) return "Incomplete";
  if (rating === 5) return "Failed";

  return "Unknown";
}

function getClassification(record: AcademicRecord): AcademicClassification {
  if (isTransferCredit(record)) return "Credited";

  if (
    record.academic_result === "Passed" ||
    record.academic_result === "Incomplete" ||
    record.academic_result === "Failed" ||
    record.academic_result === "Credited"
  ) {
    return record.academic_result;
  }

  if (
    record.classification === "Passed" ||
    record.classification === "Incomplete" ||
    record.classification === "Failed" ||
    record.classification === "Credited"
  ) {
    return record.classification;
  }

  return classifyFinalRating(record.final_rating);
}

function requiresRetake(record: AcademicRecord): boolean {
  if (isTransferCredit(record)) return false;
  if (typeof record.retake === "boolean") return record.retake;

  const classification = getClassification(record);
  return classification === "Incomplete" || classification === "Failed";
}

function getStatusClass(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, "-") || "unknown";
}

function getSubjectStatusClass(value: string | null | undefined): string {
  if (value?.trim().toLowerCase() === "credited") return "completed";
  return getStatusClass(value);
}

function getResultClass(classification: AcademicClassification): string {
  if (classification === "Credited") return "credited";
  return classification.toLowerCase();
}

function getStudentName(student: Student): string {
  return [student.first_name, student.middle_name, student.last_name]
    .filter(Boolean)
    .join(" ");
}

function getStudentInitials(student: Student): string {
  const first = student.first_name?.trim().charAt(0) || "";
  const last = student.last_name?.trim().charAt(0) || "";
  return `${first}${last}`.toUpperCase() || "ST";
}

function getAcademicYearLabel(record: AcademicRecord): string {
  if (record.academic_year) return record.academic_year;
  if (record.transfer_source?.academic_year) {
    return record.transfer_source.academic_year;
  }
  return "Transfer Credit";
}

function getSemesterLabel(record: AcademicRecord): string {
  if (record.semester_name) return record.semester_name;
  if (record.transfer_source?.semester) return record.transfer_source.semester;
  return "Transfer Credit";
}

function getAcademicYearSortOrder(value: string): number {
  const match = value.match(/^(\d{4})/);
  if (!match) return 0;

  const year = Number(match[1]);
  return Number.isFinite(year) ? year : 0;
}

function getSemesterSortOrder(value: string): number {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("first")) return 1;
  if (normalized.includes("second")) return 2;
  if (normalized.includes("summer")) return 3;
  return 99;
}

function getRecordKey(record: AcademicRecord): string {
  if (isTransferCredit(record) && record.transfer_subject_id !== null) {
    return `transfer-${record.transfer_subject_id}`;
  }
  if (record.grade_id !== null) return `grade-${record.grade_id}`;
  if (record.enrollment_subject_id !== null) {
    return `enrollment-subject-${record.enrollment_subject_id}`;
  }
  return `${record.record_type}-${record.subject_id}`;
}

function getReviewedByUsername(record: AcademicRecord): string | null {
  return (
    record.approval?.reviewed_by_username || record.reviewed_by_username || null
  );
}

function getReviewedAt(record: AcademicRecord): string | null {
  return record.approval?.reviewed_at || record.reviewed_at || null;
}

function getReviewRemarks(record: AcademicRecord): string | null {
  return record.approval?.review_remarks || record.review_remarks || null;
}

function getFacultyLabel(record: AcademicRecord): string | null {
  if (record.faculty?.faculty_name) return record.faculty.faculty_name;
  if (record.faculty_id !== null && record.faculty_id !== undefined) {
    return `Faculty #${record.faculty_id}`;
  }
  return null;
}

export default function AcademicRecordsR() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [student, setStudent] = useState<Student | null>(null);
  const [records, setRecords] = useState<AcademicRecord[]>([]);
  const [apiSummary, setApiSummary] = useState<AcademicSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState("");
  const [academicYearFilter, setAcademicYearFilter] = useState("All");
  const [semesterFilter, setSemesterFilter] = useState("All");
  const [resultFilter, setResultFilter] = useState("All");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Registrar") {
      if (user) {
        navigate(authService.getDashboardRoute(user.role), { replace: true });
      } else {
        navigate("/login", { replace: true });
      }
    }
  }, [authenticated, userRole, user, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") return;

    if (!id) {
      setError("Invalid student ID.");
      setLoading(false);
      return;
    }

    const studentId = Number(id);

    if (!Number.isInteger(studentId) || studentId <= 0) {
      setError("Invalid student ID.");
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    const loadAcademicRecords = async () => {
      try {
        setLoading(true);
        setError("");

        const requestUrl = `${API_BASE_URL}/${studentId}/academic-records`;

        const response = await authService.authFetch(requestUrl, {
          method: "GET",
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        const data = await readJsonResponse<AcademicResponse>(response);

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (response.status === 403) {
          throw new Error(data.message || "Registrar access is required.");
        }

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || data.error || "Unable to load academic records.",
          );
        }

        if (!data.student) {
          throw new Error("Student information was not returned by the server.");
        }

        const officialRecords = Array.isArray(data.records)
          ? data.records.filter((record) => {
              if (record.official_record !== true) return false;

              if (isTransferCredit(record)) {
                return (
                  record.subject_status === "Credited" &&
                  record.transfer_evaluation_id !== null &&
                  record.transfer_subject_id !== null
                );
              }

              return (
                record.enrollment_status === "Approved" &&
                record.grade_status === "Approved" &&
                record.final_rating !== null &&
                [1, 2].includes(Number(record.semester_id))
              );
            })
          : [];

        setStudent(data.student);
        setApiSummary(data.summary || null);
        setRecords(officialRecords);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("GET REGISTRAR ACADEMIC RECORD ERROR:", requestError);
        setStudent(null);
        setApiSummary(null);
        setRecords([]);

        if (requestError instanceof TypeError) {
          setError(
            "Unable to connect to the academic records server. Make sure the backend is running on port 3000.",
          );
          return;
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load academic records.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadAcademicRecords();

    return () => controller.abort();
  }, [id, authenticated, userRole, navigate, refreshKey]);

  const academicYears = useMemo(() => {
    const values = new Set<string>();
    records.forEach((record) => values.add(getAcademicYearLabel(record)));

    return Array.from(values).sort(
      (a, b) => getAcademicYearSortOrder(b) - getAcademicYearSortOrder(a),
    );
  }, [records]);

  const semesters = useMemo(() => {
    const values = new Set<string>();
    records.forEach((record) => values.add(getSemesterLabel(record)));

    return Array.from(values).sort(
      (a, b) => getSemesterSortOrder(a) - getSemesterSortOrder(b),
    );
  }, [records]);

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase();

    return records.filter((record) => {
      const classification = getClassification(record);
      const transferSource = record.transfer_source;

      const matchesSearch =
        !query ||
        record.subject_code.toLowerCase().includes(query) ||
        record.subject_name.toLowerCase().includes(query) ||
        record.academic_source.toLowerCase().includes(query) ||
        (record.section_name || "").toLowerCase().includes(query) ||
        (getFacultyLabel(record) || "").toLowerCase().includes(query) ||
        (transferSource?.school || "").toLowerCase().includes(query) ||
        (transferSource?.subject_code || "").toLowerCase().includes(query) ||
        (transferSource?.subject_name || "").toLowerCase().includes(query);

      const matchesAY =
        academicYearFilter === "All" ||
        getAcademicYearLabel(record) === academicYearFilter;

      const matchesSemester =
        semesterFilter === "All" || getSemesterLabel(record) === semesterFilter;

      const matchesResult =
        resultFilter === "All" || classification === resultFilter;

      return matchesSearch && matchesAY && matchesSemester && matchesResult;
    });
  }, [records, search, academicYearFilter, semesterFilter, resultFilter]);

  const summary = useMemo(() => {
    const ptcRecords = records.filter(isPtcGrade);
    const transferRecords = records.filter(isTransferCredit);
    const passed = ptcRecords.filter(
      (record) => getClassification(record) === "Passed",
    );
    const incomplete = ptcRecords.filter(
      (record) => getClassification(record) === "Incomplete",
    );
    const failed = ptcRecords.filter(
      (record) => getClassification(record) === "Failed",
    );
    const retakes = ptcRecords.filter(requiresRetake);
    const satisfiedSubjects = new Map<number, number>();

    passed.forEach((record) => {
      if (!satisfiedSubjects.has(record.subject_id)) {
        satisfiedSubjects.set(record.subject_id, Number(record.units || 0));
      }
    });

    transferRecords.forEach((record) => {
      if (!satisfiedSubjects.has(record.subject_id)) {
        satisfiedSubjects.set(record.subject_id, Number(record.units || 0));
      }
    });

    const fallbackEarnedUnits = Array.from(satisfiedSubjects.values()).reduce(
      (total, units) => total + units,
      0,
    );
    const fallbackRecordedUnits = records.reduce(
      (total, record) => total + Number(record.units || 0),
      0,
    );
    const fallbackTransferUnits = transferRecords.reduce(
      (total, record) => total + Number(record.units || 0),
      0,
    );

    return {
      total: apiSummary?.total_official_records ?? records.length,
      earnedUnits: apiSummary?.earned_units ?? fallbackEarnedUnits,
      passed: apiSummary?.passed_subjects ?? passed.length,
      transferCredits:
        apiSummary?.official_transfer_credit_records ?? transferRecords.length,
      incomplete: apiSummary?.incomplete_subjects ?? incomplete.length,
      failed: apiSummary?.failed_subjects ?? failed.length,
      retakes: apiSummary?.retake_subjects ?? retakes.length,
      totalRecordedUnits:
        apiSummary?.total_recorded_units ?? fallbackRecordedUnits,
      transferCreditedUnits:
        apiSummary?.transfer_credited_units ?? fallbackTransferUnits,
    };
  }, [records, apiSummary]);

  const groupedRecords = useMemo<AcademicYearGroup[]>(() => {
    const yearMap = new Map<string, AcademicYearGroup>();

    filteredRecords.forEach((record) => {
      const academicYear = getAcademicYearLabel(record);
      let yearGroup = yearMap.get(academicYear);

      if (!yearGroup) {
        yearGroup = {
          key: academicYear,
          academicYear,
          sortOrder: getAcademicYearSortOrder(academicYear),
          semesters: [],
        };
        yearMap.set(academicYear, yearGroup);
      }

      const semesterName = getSemesterLabel(record);
      const semesterKey = `${academicYear}-${semesterName}`;
      let semesterGroup = yearGroup.semesters.find(
        (semester) => semester.key === semesterKey,
      );

      if (!semesterGroup) {
        semesterGroup = {
          key: semesterKey,
          semesterName,
          sortOrder: getSemesterSortOrder(semesterName),
          records: [],
        };
        yearGroup.semesters.push(semesterGroup);
      }

      semesterGroup.records.push(record);
    });

    const groups = Array.from(yearMap.values());
    groups.sort((a, b) => b.sortOrder - a.sortOrder);
    groups.forEach((year) =>
      year.semesters.sort((a, b) => a.sortOrder - b.sortOrder),
    );

    return groups;
  }, [filteredRecords]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search.trim()) count += 1;
    if (academicYearFilter !== "All") count += 1;
    if (semesterFilter !== "All") count += 1;
    if (resultFilter !== "All") count += 1;
    return count;
  }, [search, academicYearFilter, semesterFilter, resultFilter]);

  const clearFilters = () => {
    setSearch("");
    setAcademicYearFilter("All");
    setSemesterFilter("All");
    setResultFilter("All");
  };

  const refresh = () => setRefreshKey((current) => current + 1);

  if (!authenticated || !user || userRole !== "Registrar") return null;

  return (
    <DashboardLayout>
      <main className="registrar-academic-record">
        <section className="registrar-academic-record__hero">
          <div className="registrar-academic-record__hero-copy">
            <span className="registrar-academic-record__eyebrow">
              <span className="registrar-academic-record__eyebrow-icon">
                <LibraryBig size={15} strokeWidth={2.2} />
              </span>
              Registrar · Student Records
            </span>

            <h1>Academic Records</h1>
            <p>
              Review the student&apos;s official academic history, including
              approved PTC grades and completed transfer credits.
            </p>
          </div>

          <div className="registrar-academic-record__hero-actions">
            <button
              type="button"
              className="registrar-academic-record__button registrar-academic-record__button--secondary"
              onClick={() => navigate(-1)}
            >
              <ArrowLeft size={15} />
              Back
            </button>

            <button
              type="button"
              className="registrar-academic-record__button registrar-academic-record__button--primary"
              onClick={refresh}
              disabled={loading}
            >
              <RefreshCw
                size={15}
                className={loading ? "registrar-academic-record__spin" : ""}
              />
              {loading ? "Refreshing" : "Refresh"}
            </button>
          </div>
        </section>

        <section className="registrar-academic-record__notice">
          <div className="registrar-academic-record__notice-icon">
            <ShieldCheck size={18} />
          </div>
          <div>
            <strong>Official academic sources only</strong>
            <p>
              This view includes Program Head-approved PTC grades and completed
              transfer credits. Previous-school grades remain external source
              grades and are not converted into PTC final ratings.
            </p>
          </div>
        </section>

        {error && (
          <section className="registrar-academic-record__error" role="alert">
            <div className="registrar-academic-record__error-icon">
              <CircleAlert size={19} />
            </div>
            <div className="registrar-academic-record__error-copy">
              <strong>Academic record could not be loaded</strong>
              <p>{error}</p>
            </div>
            <button type="button" onClick={refresh}>
              <RefreshCw size={14} />
              Try Again
            </button>
          </section>
        )}

        {loading && (
          <section className="registrar-academic-record__loading">
            <div className="registrar-academic-record__loading-top">
              <div className="registrar-academic-record__skeleton registrar-academic-record__skeleton--avatar" />
              <div className="registrar-academic-record__loading-copy">
                <div className="registrar-academic-record__skeleton registrar-academic-record__skeleton--title" />
                <div className="registrar-academic-record__skeleton registrar-academic-record__skeleton--text" />
              </div>
            </div>
            <div className="registrar-academic-record__loading-grid">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="registrar-academic-record__skeleton registrar-academic-record__skeleton--card"
                />
              ))}
            </div>
          </section>
        )}

        {!loading && !error && student && (
          <>
            <section className="registrar-academic-record__student-card">
              <div className="registrar-academic-record__identity">
                <div className="registrar-academic-record__avatar">
                  {getStudentInitials(student)}
                </div>

                <div className="registrar-academic-record__identity-copy">
                  <div className="registrar-academic-record__identity-heading">
                    <div>
                      <span>Official record for</span>
                      <h2>{getStudentName(student)}</h2>
                    </div>
                    <span
                      className={`registrar-academic-record__student-status registrar-academic-record__student-status--${getStatusClass(
                        student.status,
                      )}`}
                    >
                      <span />
                      {student.status || "Unknown"}
                    </span>
                  </div>

                  <div className="registrar-academic-record__student-meta">
                    <span>{student.student_number}</span>
                    <span aria-hidden="true">•</span>
                    <span>{student.course_code}</span>
                    <span aria-hidden="true">•</span>
                    <span>Year {student.year_level}</span>
                  </div>

                  {student.course_name && (
                    <p className="registrar-academic-record__course-name">
                      {student.course_name}
                    </p>
                  )}
                </div>
              </div>

              <div className="registrar-academic-record__current-info">
                <div>
                  <span>Current Section</span>
                  <strong>{student.section_name || "Not assigned"}</strong>
                </div>
                <div>
                  <span>Current Semester</span>
                  <strong>{student.semester_name || "Not assigned"}</strong>
                </div>
              </div>
            </section>

            <section className="registrar-academic-record__summary-grid">
              <article className="registrar-academic-record__summary-card registrar-academic-record__summary-card--primary">
                <span className="registrar-academic-record__summary-icon">
                  <FileCheck2 size={18} />
                </span>
                <div>
                  <span>Official Records</span>
                  <strong>{summary.total}</strong>
                  <small>Approved and credited</small>
                </div>
              </article>

              <article className="registrar-academic-record__summary-card">
                <span className="registrar-academic-record__summary-icon">
                  <GraduationCap size={18} />
                </span>
                <div>
                  <span>Earned Units</span>
                  <strong>{summary.earnedUnits}</strong>
                  <small>Curriculum-satisfied units</small>
                </div>
              </article>

              <article className="registrar-academic-record__summary-card">
                <span className="registrar-academic-record__summary-icon">
                  <CheckCircle2 size={18} />
                </span>
                <div>
                  <span>PTC Passed</span>
                  <strong>{summary.passed}</strong>
                  <small>Approved passing grades</small>
                </div>
              </article>

              <article className="registrar-academic-record__summary-card">
                <span className="registrar-academic-record__summary-icon">
                  <Award size={18} />
                </span>
                <div>
                  <span>Transfer Credits</span>
                  <strong>{summary.transferCredits}</strong>
                  <small>{summary.transferCreditedUnits} credited units</small>
                </div>
              </article>
            </section>

            {(summary.incomplete > 0 ||
              summary.failed > 0 ||
              summary.retakes > 0) && (
              <section className="registrar-academic-record__attention">
                <div className="registrar-academic-record__attention-heading">
                  <CircleAlert size={17} />
                  <div>
                    <strong>Academic attention</strong>
                    <span>Records that may affect future enrollment</span>
                  </div>
                </div>

                <div className="registrar-academic-record__attention-items">
                  <span>
                    Incomplete <strong>{summary.incomplete}</strong>
                  </span>
                  <span>
                    Failed <strong>{summary.failed}</strong>
                  </span>
                  <span>
                    Retake Required <strong>{summary.retakes}</strong>
                  </span>
                </div>
              </section>
            )}

            <section className="registrar-academic-record__directory">
              <div className="registrar-academic-record__directory-heading">
                <div>
                  <span className="registrar-academic-record__section-kicker">
                    <History size={14} />
                    Official History
                  </span>
                  <h2>Academic History</h2>
                  <p>
                    Search and filter approved grades and transfer credits by
                    academic year, semester, or result.
                  </p>
                </div>

                <div className="registrar-academic-record__record-count">
                  <strong>{filteredRecords.length}</strong>
                  <span>
                    record{filteredRecords.length === 1 ? "" : "s"} shown
                  </span>
                </div>
              </div>

              <div className="registrar-academic-record__filters">
                <div className="registrar-academic-record__search-field">
                  <label htmlFor="registrar-academic-search">Search records</label>
                  <div className="registrar-academic-record__input-shell">
                    <Search size={15} />
                    <input
                      id="registrar-academic-search"
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Subject, school, section, faculty..."
                    />
                    {search && (
                      <button
                        type="button"
                        onClick={() => setSearch("")}
                        aria-label="Clear search"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>

                <div className="registrar-academic-record__filter-field">
                  <label htmlFor="registrar-academic-year">Academic Year</label>
                  <select
                    id="registrar-academic-year"
                    value={academicYearFilter}
                    onChange={(event) =>
                      setAcademicYearFilter(event.target.value)
                    }
                  >
                    <option value="All">All Academic Years</option>
                    {academicYears.map((label) => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="registrar-academic-record__filter-field">
                  <label htmlFor="registrar-academic-semester">Semester</label>
                  <select
                    id="registrar-academic-semester"
                    value={semesterFilter}
                    onChange={(event) => setSemesterFilter(event.target.value)}
                  >
                    <option value="All">All Semesters</option>
                    {semesters.map((label) => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="registrar-academic-record__filter-field">
                  <label htmlFor="registrar-academic-result">Result</label>
                  <select
                    id="registrar-academic-result"
                    value={resultFilter}
                    onChange={(event) => setResultFilter(event.target.value)}
                  >
                    <option value="All">All Results</option>
                    <option value="Passed">Passed</option>
                    <option value="Credited">Credited</option>
                    <option value="Incomplete">Incomplete</option>
                    <option value="Failed">Failed</option>
                  </select>
                </div>

                <button
                  type="button"
                  className="registrar-academic-record__clear-button"
                  onClick={clearFilters}
                  disabled={activeFilterCount === 0}
                >
                  <FilterX size={15} />
                  Clear
                  {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
                </button>
              </div>

              {activeFilterCount > 0 && (
                <div className="registrar-academic-record__filter-summary">
                  <span>Active filters:</span>
                  {search.trim() && <strong>Search “{search.trim()}”</strong>}
                  {academicYearFilter !== "All" && (
                    <strong>{academicYearFilter}</strong>
                  )}
                  {semesterFilter !== "All" && <strong>{semesterFilter}</strong>}
                  {resultFilter !== "All" && <strong>{resultFilter}</strong>}
                </div>
              )}

              {records.length === 0 && (
                <div className="registrar-academic-record__empty">
                  <span className="registrar-academic-record__empty-icon">
                    <BookOpen size={22} />
                  </span>
                  <strong>No official academic records yet</strong>
                  <p>
                    Approved PTC grades and completed transfer credits will
                    appear here after they become official.
                  </p>
                </div>
              )}

              {records.length > 0 && filteredRecords.length === 0 && (
                <div className="registrar-academic-record__empty">
                  <span className="registrar-academic-record__empty-icon">
                    <Search size={22} />
                  </span>
                  <strong>No matching academic records</strong>
                  <p>
                    Try changing the search text or clearing one of the active
                    filters.
                  </p>
                  <button type="button" onClick={clearFilters}>
                    <FilterX size={14} />
                    Clear Filters
                  </button>
                </div>
              )}

              {groupedRecords.length > 0 && (
                <div className="registrar-academic-record__year-list">
                  {groupedRecords.map((year) => {
                    const yearRecordCount = year.semesters.reduce(
                      (total, semester) => total + semester.records.length,
                      0,
                    );

                    return (
                      <article
                        key={year.key}
                        className="registrar-academic-record__year"
                      >
                        <header className="registrar-academic-record__year-header">
                          <div>
                            <span>Academic Year</span>
                            <h3>{year.academicYear}</h3>
                          </div>
                          <span className="registrar-academic-record__year-count">
                            {yearRecordCount} record
                            {yearRecordCount === 1 ? "" : "s"}
                          </span>
                        </header>

                        {year.semesters.map((semester) => {
                          const semesterUnits = semester.records.reduce(
                            (total, record) =>
                              total + Number(record.units || 0),
                            0,
                          );

                          const earnedUnits = semester.records
                            .filter(
                              (record) =>
                                record.curriculum_satisfied === true ||
                                getClassification(record) === "Passed" ||
                                getClassification(record) === "Credited",
                            )
                            .reduce(
                              (total, record) =>
                                total + Number(record.units || 0),
                              0,
                            );

                          return (
                            <section
                              key={semester.key}
                              className="registrar-academic-record__semester"
                            >
                              <div className="registrar-academic-record__semester-header">
                                <div>
                                  <span className="registrar-academic-record__semester-icon">
                                    <BookCheck size={15} />
                                  </span>
                                  <div>
                                    <h4>{semester.semesterName}</h4>
                                    <span>
                                      {semester.records.length} subject
                                      {semester.records.length === 1 ? "" : "s"}
                                    </span>
                                  </div>
                                </div>

                                <div className="registrar-academic-record__semester-stats">
                                  <span>
                                    Recorded <strong>{semesterUnits}</strong> units
                                  </span>
                                  <span>
                                    Earned <strong>{earnedUnits}</strong> units
                                  </span>
                                </div>
                              </div>

                              <div className="registrar-academic-record__table-wrap">
                                <table className="registrar-academic-record__table">
                                  <thead>
                                    <tr>
                                      <th>Subject</th>
                                      <th>Academic Source</th>
                                      <th>Class / Faculty</th>
                                      <th>Units</th>
                                      <th>Term Grades</th>
                                      <th>Final / Source Grade</th>
                                      <th>Result</th>
                                      <th>Review</th>
                                    </tr>
                                  </thead>

                                  <tbody>
                                    {semester.records.map((record) => {
                                      const classification =
                                        getClassification(record);
                                      const transfer = isTransferCredit(record);
                                      const reviewedByUsername =
                                        getReviewedByUsername(record);
                                      const reviewedAt = getReviewedAt(record);
                                      const reviewRemarks =
                                        getReviewRemarks(record);
                                      const facultyLabel =
                                        getFacultyLabel(record);

                                      return (
                                        <tr key={getRecordKey(record)}>
                                          <td>
                                            <div className="registrar-academic-record__subject-cell">
                                              <strong>{record.subject_code}</strong>
                                              <span>{record.subject_name}</span>
                                              <small>
                                                {transfer
                                                  ? `PTC equivalent · TS #${record.transfer_subject_id}`
                                                  : `ES #${record.enrollment_subject_id} · Grade #${record.grade_id}`}
                                              </small>
                                            </div>
                                          </td>

                                          <td>
                                            <div className="registrar-academic-record__source-cell">
                                              <span
                                                className={`registrar-academic-record__source-badge registrar-academic-record__source-badge--${
                                                  transfer ? "transfer" : "ptc"
                                                }`}
                                              >
                                                {transfer
                                                  ? "Transfer Credit"
                                                  : "PTC Grade"}
                                              </span>

                                              {transfer ? (
                                                <>
                                                  <strong>
                                                    {record.transfer_source
                                                      ?.school ||
                                                      "Previous School"}
                                                  </strong>
                                                  <small>
                                                    {record.transfer_source
                                                      ?.subject_code
                                                      ? `${record.transfer_source.subject_code} · `
                                                      : ""}
                                                    {record.transfer_source
                                                      ?.subject_name ||
                                                      "Previous subject"}
                                                  </small>
                                                </>
                                              ) : (
                                                <small>
                                                  Official PTC academic grade
                                                </small>
                                              )}
                                            </div>
                                          </td>

                                          <td>
                                            <div className="registrar-academic-record__class-cell">
                                              <strong>
                                                {transfer
                                                  ? "External Credit"
                                                  : record.section_name ||
                                                    "No section"}
                                              </strong>
                                              <span>
                                                {transfer
                                                  ? record.transfer_source
                                                      ?.school ||
                                                    "Previous School"
                                                  : facultyLabel ||
                                                    "Faculty not assigned"}
                                              </span>
                                            </div>
                                          </td>

                                          <td>
                                            <strong className="registrar-academic-record__units">
                                              {record.units}
                                            </strong>
                                          </td>

                                          <td>
                                            {transfer ? (
                                              <span className="registrar-academic-record__muted">
                                                Not applicable
                                              </span>
                                            ) : (
                                              <div className="registrar-academic-record__term-grades">
                                                <span>
                                                  <small>Prelim</small>
                                                  <strong>
                                                    {formatGrade(
                                                      record.prelim_grade,
                                                    )}
                                                  </strong>
                                                </span>
                                                <span>
                                                  <small>Midterm</small>
                                                  <strong>
                                                    {formatGrade(
                                                      record.midterm_grade,
                                                    )}
                                                  </strong>
                                                </span>
                                                <span>
                                                  <small>Final</small>
                                                  <strong>
                                                    {formatGrade(
                                                      record.final_grade,
                                                    )}
                                                  </strong>
                                                </span>
                                              </div>
                                            )}
                                          </td>

                                          <td>
                                            <div className="registrar-academic-record__rating-cell">
                                              <strong>
                                                {transfer
                                                  ? formatGrade(
                                                      record.source_grade,
                                                    )
                                                  : formatGrade(
                                                      record.final_rating,
                                                    )}
                                              </strong>
                                              <small>
                                                {transfer
                                                  ? "External source grade"
                                                  : "PTC final rating"}
                                              </small>
                                            </div>
                                          </td>

                                          <td>
                                            <div className="registrar-academic-record__result-cell">
                                              <span
                                                className={`registrar-academic-record__result registrar-academic-record__result--${getResultClass(
                                                  classification,
                                                )}`}
                                              >
                                                {classification}
                                              </span>
                                              <span
                                                className={`registrar-academic-record__subject-status registrar-academic-record__subject-status--${getSubjectStatusClass(
                                                  record.subject_status,
                                                )}`}
                                              >
                                                {record.subject_status}
                                              </span>
                                              {requiresRetake(record) && (
                                                <small>
                                                  <RotateCcw size={11} />
                                                  Retake required
                                                </small>
                                              )}
                                            </div>
                                          </td>

                                          <td>
                                            <div className="registrar-academic-record__review-cell">
                                              <span className="registrar-academic-record__review-status">
                                                <CheckCircle2 size={12} />
                                                {transfer
                                                  ? "Credited"
                                                  : "Approved"}
                                              </span>
                                              {reviewedByUsername && (
                                                <span>
                                                  By {reviewedByUsername}
                                                </span>
                                              )}
                                              {reviewedAt && (
                                                <small>
                                                  {formatDateTime(reviewedAt)}
                                                </small>
                                              )}
                                              {transfer &&
                                                record.transfer_completion
                                                  ?.completed_at && (
                                                  <small>
                                                    Transfer completed {" "}
                                                    {formatDateTime(
                                                      record.transfer_completion
                                                        .completed_at,
                                                    )}
                                                  </small>
                                                )}
                                              {reviewRemarks && (
                                                <small className="registrar-academic-record__review-note">
                                                  {reviewRemarks}
                                                </small>
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </section>
                          );
                        })}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="registrar-academic-record__guide">
              <div className="registrar-academic-record__guide-heading">
                <span className="registrar-academic-record__guide-icon">
                  <Sparkles size={17} />
                </span>
                <div>
                  <span>Quick Reference</span>
                  <h2>Official Result Guide</h2>
                </div>
              </div>

              <div className="registrar-academic-record__guide-grid">
                <article>
                  <span className="registrar-academic-record__guide-rating registrar-academic-record__guide-rating--passed">
                    1.00–3.00
                  </span>
                  <div>
                    <strong>PTC Passed</strong>
                    <p>
                      Approved PTC final rating completes the subject and earns
                      its units.
                    </p>
                  </div>
                </article>

                <article>
                  <span className="registrar-academic-record__guide-rating registrar-academic-record__guide-rating--credited">
                    Credit
                  </span>
                  <div>
                    <strong>Transfer Credit</strong>
                    <p>
                      A completed transfer evaluation with a credited mapped
                      subject satisfies the curriculum requirement.
                    </p>
                  </div>
                </article>

                <article>
                  <span className="registrar-academic-record__guide-rating registrar-academic-record__guide-rating--incomplete">
                    4.00
                  </span>
                  <div>
                    <strong>Incomplete</strong>
                    <p>The subject remains an academic retake candidate.</p>
                  </div>
                </article>

                <article>
                  <span className="registrar-academic-record__guide-rating registrar-academic-record__guide-rating--failed">
                    5.00
                  </span>
                  <div>
                    <strong>Failed</strong>
                    <p>
                      The subject must be retaken according to enrollment and
                      prerequisite rules.
                    </p>
                  </div>
                </article>
              </div>
            </section>

            <section className="registrar-academic-record__footer-card">
              <div className="registrar-academic-record__footer-copy">
                <span className="registrar-academic-record__footer-icon">
                  <FileText size={18} />
                </span>
                <div>
                  <strong>Official Academic Record</strong>
                  <p>
                    PTC grades and transfer credits shown here are official
                    records used for curriculum completion, prerequisites,
                    retake detection, and future enrollment eligibility.
                  </p>
                </div>
              </div>

              <div className="registrar-academic-record__footer-units">
                <span>Recorded Units</span>
                <strong>{summary.totalRecordedUnits}</strong>
                {summary.transferCreditedUnits > 0 && (
                  <small>
                    {summary.transferCreditedUnits} transfer-credit unit
                    {summary.transferCreditedUnits === 1 ? "" : "s"}
                  </small>
                )}
              </div>

              <div className="registrar-academic-record__actions">
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/registrar/student/DetailsR/${student.student_id}`,
                    )
                  }
                >
                  <UserRound size={15} />
                  Student Profile
                  <ChevronRight size={14} />
                </button>

                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/registrar/student/${student.student_id}/transcriptR`,
                    )
                  }
                >
                  <FileText size={15} />
                  View Transcript
                  <ChevronRight size={14} />
                </button>

                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/registrar/student/${student.student_id}/DocumentsR`,
                    )
                  }
                >
                  <FileCheck2 size={15} />
                  Certificate of Registration
                  <ChevronRight size={14} />
                </button>
              </div>
            </section>
          </>
        )}
      </main>
    </DashboardLayout>
  );
}
