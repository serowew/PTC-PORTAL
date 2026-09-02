import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

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
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return String(value);
  }

  return numeric.toFixed(2);
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

function classifyFinalRating(
  finalRating: number | null | undefined,
): AcademicClassification {
  if (finalRating === null || finalRating === undefined) {
    return "Unknown";
  }

  const rating = Number(finalRating);

  if (!Number.isFinite(rating)) {
    return "Unknown";
  }

  if (rating >= 1 && rating <= 3) {
    return "Passed";
  }

  if (rating === 4) {
    return "Incomplete";
  }

  if (rating === 5) {
    return "Failed";
  }

  return "Unknown";
}

function getClassification(record: AcademicRecord): AcademicClassification {
  if (isTransferCredit(record)) {
    return "Credited";
  }

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
  if (isTransferCredit(record)) {
    return false;
  }

  if (typeof record.retake === "boolean") {
    return record.retake;
  }

  const classification = getClassification(record);

  return classification === "Incomplete" || classification === "Failed";
}

function getStatusClass(value: string | null | undefined): string {
  return value?.trim().toLowerCase().replace(/\s+/g, "-") || "unknown";
}

function getSubjectStatusClass(value: string | null | undefined): string {
  if (value?.trim().toLowerCase() === "credited") {
    return "completed";
  }

  return getStatusClass(value);
}

function getResultClass(classification: AcademicClassification): string {
  if (classification === "Credited") {
    return "passed";
  }

  return classification.toLowerCase();
}

function getStudentName(student: Student): string {
  return [student.first_name, student.middle_name, student.last_name]
    .filter(Boolean)
    .join(" ");
}

function getAcademicYearLabel(record: AcademicRecord): string {
  if (record.academic_year) {
    return record.academic_year;
  }

  if (record.transfer_source?.academic_year) {
    return record.transfer_source.academic_year;
  }

  return "Transfer Credit";
}

function getSemesterLabel(record: AcademicRecord): string {
  if (record.semester_name) {
    return record.semester_name;
  }

  if (record.transfer_source?.semester) {
    return record.transfer_source.semester;
  }

  return "Transfer Credit";
}

function getAcademicYearSortOrder(value: string): number {
  const match = value.match(/^(\d{4})/);

  if (!match) {
    return 0;
  }

  const year = Number(match[1]);

  return Number.isFinite(year) ? year : 0;
}

function getSemesterSortOrder(value: string): number {
  const normalized = value.trim().toLowerCase();

  if (normalized.includes("first")) {
    return 1;
  }

  if (normalized.includes("second")) {
    return 2;
  }

  if (normalized.includes("summer")) {
    return 3;
  }

  return 99;
}

function getRecordKey(record: AcademicRecord): string {
  if (isTransferCredit(record) && record.transfer_subject_id !== null) {
    return `transfer-${record.transfer_subject_id}`;
  }

  if (record.grade_id !== null) {
    return `grade-${record.grade_id}`;
  }

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
  if (record.faculty?.faculty_name) {
    return record.faculty.faculty_name;
  }

  if (record.faculty_id !== null && record.faculty_id !== undefined) {
    return `Faculty #${record.faculty_id}`;
  }

  return null;
}

export default function AcademicRecordsR() {
  const navigate = useNavigate();

  const { id } = useParams<{
    id: string;
  }>();

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

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") {
      return;
    }

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

          headers: {
            Accept: "application/json",
          },
        });

        const data = await readJsonResponse<AcademicResponse>(response);

        if (response.status === 401) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

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
          throw new Error(
            "Student information was not returned by the server.",
          );
        }

        const officialRecords = Array.isArray(data.records)
          ? data.records.filter((record) => {
              if (record.official_record !== true) {
                return false;
              }

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
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadAcademicRecords();

    return () => {
      controller.abort();
    };
  }, [id, authenticated, userRole, navigate, refreshKey]);

  const academicYears = useMemo(() => {
    const values = new Set<string>();

    records.forEach((record) => {
      values.add(getAcademicYearLabel(record));
    });

    return Array.from(values).sort(
      (a, b) => getAcademicYearSortOrder(b) - getAcademicYearSortOrder(a),
    );
  }, [records]);

  const semesters = useMemo(() => {
    const values = new Set<string>();

    records.forEach((record) => {
      values.add(getSemesterLabel(record));
    });

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

    groups.forEach((year) => {
      year.semesters.sort((a, b) => a.sortOrder - b.sortOrder);
    });

    return groups;
  }, [filteredRecords]);

  const clearFilters = () => {
    setSearch("");

    setAcademicYearFilter("All");

    setSemesterFilter("All");

    setResultFilter("All");
  };

  const refresh = () => {
    setRefreshKey((current) => current + 1);
  };

  if (!authenticated || !user || userRole !== "Registrar") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="registrar-academic-record-page">
        <section className="registrar-record-header">
          <div>
            <span className="registrar-record-eyebrow">
              Registrar • Student Records
            </span>

            <h1>Official Academic Record</h1>

            <p>
              Review the student's official academic history from approved PTC
              grades and officially credited previous-school subjects.
            </p>
          </div>

          <div className="registrar-record-header-actions">
            <button
              type="button"
              className="registrar-record-back"
              onClick={() => navigate(-1)}
            >
              Back
            </button>

            <button
              type="button"
              className="registrar-record-refresh"
              onClick={refresh}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh Record"}
            </button>
          </div>
        </section>

        <section className="registrar-record-official-notice">
          <div className="registrar-record-official-icon">✓</div>

          <div>
            <strong>Official Academic Sources</strong>

            <p>
              This record combines Program Head-approved PTC grades and
              completed, officially credited transfer subjects. Previous-school
              source grades remain external and are never converted into PTC
              Final Rating values.
            </p>
          </div>
        </section>

        {error && (
          <section className="registrar-record-error">
            <div>
              <strong>Academic record could not be loaded</strong>

              <p>{error}</p>
            </div>

            <button type="button" onClick={refresh}>
              Try Again
            </button>
          </section>
        )}

        {loading && (
          <section className="registrar-record-loading">
            <div className="registrar-record-spinner" />

            <div>
              <strong>Loading official academic record</strong>

              <span>
                Retrieving approved PTC grades and official transfer credits...
              </span>
            </div>
          </section>
        )}

        {!loading && !error && student && (
          <>
            <section className="registrar-record-student-card">
              <div className="registrar-record-student-primary">
                <div className="registrar-record-avatar">
                  {student.first_name?.charAt(0).toUpperCase() || "S"}
                </div>

                <div>
                  <span>Student</span>

                  <h2>{getStudentName(student)}</h2>

                  <p>{student.student_number}</p>
                </div>
              </div>

              <div className="registrar-record-student-data">
                <div>
                  <span>Program</span>

                  <strong>{student.course_code}</strong>

                  {student.course_name && <small>{student.course_name}</small>}
                </div>

                <div>
                  <span>Current Year Level</span>

                  <strong>Year {student.year_level}</strong>
                </div>

                <div>
                  <span>Student Status</span>

                  <strong
                    className={`registrar-record-student-status ${getStatusClass(
                      student.status,
                    )}`}
                  >
                    {student.status}
                  </strong>
                </div>

                <div>
                  <span>Current Section</span>

                  <strong>{student.section_name || "Not Assigned"}</strong>

                  <small>{student.semester_name || "—"}</small>
                </div>
              </div>
            </section>

            <section className="registrar-record-summary">
              <div>
                <span>Official Records</span>

                <strong>{summary.total}</strong>
              </div>

              <div>
                <span>Earned Units</span>

                <strong>{summary.earnedUnits}</strong>
              </div>

              <div>
                <span>PTC Passed</span>

                <strong>{summary.passed}</strong>
              </div>

              <div>
                <span>Transfer Credits</span>

                <strong>{summary.transferCredits}</strong>
              </div>

              <div>
                <span>Incomplete</span>

                <strong>{summary.incomplete}</strong>
              </div>

              <div>
                <span>Failed</span>

                <strong>{summary.failed}</strong>
              </div>

              <div>
                <span>Retake Required</span>

                <strong>{summary.retakes}</strong>
              </div>
            </section>

            <section className="registrar-record-filters">
              <div className="registrar-record-search">
                <label htmlFor="registrar-academic-search">Search</label>

                <input
                  id="registrar-academic-search"
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="PTC subject, previous subject, school, section, faculty..."
                />
              </div>

              <div>
                <label>Academic Year</label>

                <select
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

              <div>
                <label>Semester</label>

                <select
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

              <div>
                <label>Result</label>

                <select
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
                className="registrar-record-clear"
                onClick={clearFilters}
              >
                Clear
              </button>
            </section>

            {records.length === 0 && (
              <section className="registrar-record-empty">
                <div className="registrar-record-empty-icon">✓</div>

                <strong>No official academic records yet</strong>

                <p>
                  Approved PTC grades and completed transfer credits will appear
                  here when they become official.
                </p>
              </section>
            )}

            {records.length > 0 && filteredRecords.length === 0 && (
              <section className="registrar-record-empty">
                <strong>No matching academic records</strong>

                <p>
                  No official PTC grade or transfer-credit records match the
                  selected filters.
                </p>

                <button type="button" onClick={clearFilters}>
                  Clear Filters
                </button>
              </section>
            )}

            {groupedRecords.length > 0 && (
              <section className="registrar-record-history">
                <div className="registrar-record-history-heading">
                  <div>
                    <h2>Academic History</h2>

                    <p>
                      Official PTC grades and credited previous-school subjects
                      grouped by academic year and semester.
                    </p>
                  </div>

                  <span>
                    {filteredRecords.length} record
                    {filteredRecords.length === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="registrar-record-year-list">
                  {groupedRecords.map((year) => (
                    <article key={year.key} className="registrar-record-year">
                      <header className="registrar-record-year-header">
                        <div>
                          <span>Academic Year</span>

                          <h3>{year.academicYear}</h3>
                        </div>

                        <strong>
                          {year.semesters.reduce(
                            (total, semester) =>
                              total + semester.records.length,
                            0,
                          )}{" "}
                          record
                          {year.semesters.reduce(
                            (total, semester) =>
                              total + semester.records.length,
                            0,
                          ) === 1
                            ? ""
                            : "s"}
                        </strong>
                      </header>

                      {year.semesters.map((semester) => {
                        const semesterUnits = semester.records.reduce(
                          (total, record) => total + Number(record.units || 0),
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
                            className="registrar-record-semester"
                          >
                            <div className="registrar-record-semester-header">
                              <div>
                                <h4>{semester.semesterName}</h4>

                                <span>
                                  {semester.records.length} record
                                  {semester.records.length === 1 ? "" : "s"}
                                </span>
                              </div>

                              <div className="registrar-record-semester-stats">
                                <span>
                                  Recorded Units{" "}
                                  <strong>{semesterUnits}</strong>
                                </span>

                                <span>
                                  Earned Units <strong>{earnedUnits}</strong>
                                </span>
                              </div>
                            </div>

                            <div className="registrar-record-table-wrapper">
                              <table className="registrar-record-table">
                                <thead>
                                  <tr>
                                    <th>Subject</th>

                                    <th>Academic Source</th>

                                    <th>Section</th>

                                    <th>Units</th>

                                    <th>Prelim</th>

                                    <th>Midterm</th>

                                    <th>Final</th>

                                    <th>Rating / Source Grade</th>

                                    <th>Result</th>

                                    <th>Academic Status</th>

                                    <th>Faculty</th>

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
                                          <div className="registrar-record-subject">
                                            <strong>
                                              {record.subject_code}
                                            </strong>

                                            <span>{record.subject_name}</span>

                                            {transfer ? (
                                              <small>
                                                PTC equivalent • TS #
                                                {record.transfer_subject_id}
                                              </small>
                                            ) : (
                                              <small>
                                                ES #
                                                {record.enrollment_subject_id}
                                                {" • "}
                                                Grade #{record.grade_id}
                                              </small>
                                            )}
                                          </div>
                                        </td>

                                        <td>
                                          {transfer ? (
                                            <div className="registrar-record-subject">
                                              <strong>Transfer Credit</strong>

                                              <span>
                                                {record.transfer_source
                                                  ?.school || "Previous School"}
                                              </span>

                                              <small>
                                                {record.transfer_source
                                                  ?.subject_code
                                                  ? `${record.transfer_source.subject_code} — `
                                                  : ""}
                                                {record.transfer_source
                                                  ?.subject_name ||
                                                  "Previous subject"}
                                              </small>
                                            </div>
                                          ) : (
                                            <div className="registrar-record-subject">
                                              <strong>PTC Grade</strong>

                                              <small>
                                                Official PTC academic grade
                                              </small>
                                            </div>
                                          )}
                                        </td>

                                        <td>
                                          <span className="registrar-record-section">
                                            {transfer
                                              ? "—"
                                              : record.section_name || "—"}
                                          </span>
                                        </td>

                                        <td>
                                          <strong className="registrar-record-units">
                                            {record.units}
                                          </strong>
                                        </td>

                                        <td>
                                          {transfer
                                            ? "—"
                                            : formatGrade(record.prelim_grade)}
                                        </td>

                                        <td>
                                          {transfer
                                            ? "—"
                                            : formatGrade(record.midterm_grade)}
                                        </td>

                                        <td>
                                          {transfer
                                            ? "—"
                                            : formatGrade(record.final_grade)}
                                        </td>

                                        <td>
                                          {transfer ? (
                                            <div className="registrar-record-subject">
                                              <strong className="registrar-record-final-rating">
                                                {formatGrade(
                                                  record.source_grade,
                                                )}
                                              </strong>

                                              <small>
                                                External source grade
                                              </small>
                                            </div>
                                          ) : (
                                            <strong className="registrar-record-final-rating">
                                              {formatGrade(record.final_rating)}
                                            </strong>
                                          )}
                                        </td>

                                        <td>
                                          <div className="registrar-record-result-cell">
                                            <span
                                              className={`registrar-record-result ${getResultClass(
                                                classification,
                                              )}`}
                                            >
                                              {classification}
                                            </span>

                                            {requiresRetake(record) && (
                                              <small className="registrar-record-retake">
                                                Retake required
                                              </small>
                                            )}
                                          </div>
                                        </td>

                                        <td>
                                          <span
                                            className={`registrar-record-subject-status ${getSubjectStatusClass(
                                              record.subject_status,
                                            )}`}
                                          >
                                            {record.subject_status}
                                          </span>
                                        </td>

                                        <td>
                                          <div className="registrar-record-faculty">
                                            {transfer ? (
                                              <>
                                                <strong>External Credit</strong>

                                                <small>
                                                  {record.transfer_source
                                                    ?.school ||
                                                    "Previous School"}
                                                </small>
                                              </>
                                            ) : facultyLabel ? (
                                              <>
                                                <strong>{facultyLabel}</strong>

                                                <small>Assigned Faculty</small>
                                              </>
                                            ) : (
                                              <span>—</span>
                                            )}
                                          </div>
                                        </td>

                                        <td>
                                          <div className="registrar-record-approval">
                                            <span className="registrar-record-approved">
                                              {transfer
                                                ? "Credited"
                                                : "Approved"}
                                            </span>

                                            {reviewedByUsername && (
                                              <small>
                                                By {reviewedByUsername}
                                              </small>
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
                                                  Completed{" "}
                                                  {formatDateTime(
                                                    record.transfer_completion
                                                      .completed_at,
                                                  )}
                                                </small>
                                              )}

                                            {reviewRemarks && (
                                              <small className="registrar-record-review-note">
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
                  ))}
                </div>
              </section>
            )}

            <section className="registrar-record-guide">
              <div className="registrar-record-guide-heading">
                <span>Official Result Guide</span>

                <strong>Academic Sources</strong>
              </div>

              <div className="registrar-record-guide-items">
                <div>
                  <span className="registrar-record-guide-rating passed">
                    1.00–3.00
                  </span>

                  <div>
                    <strong>PTC Passed</strong>

                    <p>
                      Approved PTC Final Rating successfully completes the
                      subject and earns its units.
                    </p>
                  </div>
                </div>

                <div>
                  <span className="registrar-record-guide-rating passed">
                    Credit
                  </span>

                  <div>
                    <strong>Transfer Credit</strong>

                    <p>
                      A Completed transfer evaluation with a Credited mapped
                      subject satisfies the PTC curriculum requirement.
                    </p>
                  </div>
                </div>

                <div>
                  <span className="registrar-record-guide-rating incomplete">
                    4.00
                  </span>

                  <div>
                    <strong>Incomplete</strong>

                    <p>Subject remains an academic retake candidate.</p>
                  </div>
                </div>

                <div>
                  <span className="registrar-record-guide-rating failed">
                    5.00
                  </span>

                  <div>
                    <strong>Failed</strong>

                    <p>
                      Subject must be retaken according to enrollment and
                      prerequisite rules.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className="registrar-record-footer">
              <div>
                <strong>Official Academic Record</strong>

                <p>
                  This page combines official PTC grades and official transfer
                  credits. Previous-school grades remain external source grades
                  and are not stored as PTC Final Ratings. Official results are
                  used for curriculum completion, prerequisites, retake
                  detection, and future enrollment eligibility.
                </p>
              </div>

              <div className="registrar-record-footer-units">
                <span>Recorded Units</span>

                <strong>{summary.totalRecordedUnits}</strong>

                {summary.transferCreditedUnits > 0 && (
                  <small>
                    {summary.transferCreditedUnits} transfer-credit unit
                    {summary.transferCreditedUnits === 1 ? "" : "s"}
                  </small>
                )}
              </div>

              <div className="registrar-record-actions">
                <button
                  type="button"
                  className="registrar-record-profile-button"
                  onClick={() =>
                    navigate(
                      `/registrar/student/DetailsR/${student.student_id}`,
                    )
                  }
                >
                  Student Profile
                </button>

                <button
                  type="button"
                  className="registrar-record-transcript-button"
                  onClick={() =>
                    navigate(
                      `/registrar/student/${student.student_id}/transcriptR`,
                    )
                  }
                >
                  View Transcript
                </button>

                <button
                  type="button"
                  className="registrar-record-documents-button"
                  onClick={() =>
                    navigate(
                      `/registrar/student/${student.student_id}/DocumentsR`,
                    )
                  }
                >
                  Certificate Of Registration
                </button>
              </div>
            </section>
          </>
        )}
      </main>
    </DashboardLayout>
  );
}
