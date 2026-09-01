import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/RegistrarTranscriptPreview.css";

const API_BASE_URL = "http://localhost:3000/api/registrar/students";

type AcademicRecordType = "PTC_GRADE" | "TRANSFER_CREDIT";

type AcademicClassification =
  | "Passed"
  | "Incomplete"
  | "Failed"
  | "Credited"
  | "Unknown";

interface Student {
  student_id: number;
  student_number: string;

  first_name: string;
  middle_name: string | null;
  last_name: string;

  course_code: string;
  course_name?: string | null;

  year_level: number;

  section_name?: string | null;
  semester_name?: string | null;

  status: string;
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

  academic_year_id: number | null;
  academic_year: string | null;

  semester_id: number | null;
  semester_name: string | null;

  enrollment_status: string | null;

  subject_status: string;

  prelim_grade: number | null;
  midterm_grade: number | null;
  final_grade: number | null;

  final_rating: number | null;

  source_grade: string | null;

  remarks: string | null;

  grade_status: "Draft" | "Submitted" | "Returned" | "Approved" | null;

  result_code?: string | null;

  academic_result?: AcademicClassification | null;

  classification?: AcademicClassification | null;

  passed?: boolean;

  retake?: boolean;

  curriculum_satisfied?: boolean;

  transfer_source?: TransferSource | null;

  approval?: {
    reviewed_by: number | null;
    reviewed_by_username: string | null;
    reviewed_at: string | null;
    review_remarks?: string | null;
  } | null;

  transfer_completion?: {
    evaluation_status: string;

    completed_by: number | null;

    completed_by_username: string | null;

    completed_at: string | null;

    completion_remarks: string | null;
  } | null;
}

interface AcademicSummary {
  total_official_records?: number;

  total_recorded_units?: number;

  earned_units?: number;

  total_approved_subjects?: number;

  passed_subjects?: number;

  incomplete_subjects?: number;

  failed_subjects?: number;

  official_transfer_credit_records?: number;

  transfer_credited_units?: number;
}

interface AcademicResponse {
  success: boolean;

  student?: Student;

  totalSubjects?: number;

  records?: AcademicRecord[];

  summary?: AcademicSummary;

  ptc_grade_records?: AcademicRecord[];

  transfer_credit_records?: AcademicRecord[];

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

function classifyFinalRating(
  value: number | null | undefined,
): AcademicClassification {
  if (value === null || value === undefined) {
    return "Unknown";
  }

  const rating = Number(value);

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
    record.academic_result === "Failed"
  ) {
    return record.academic_result;
  }

  if (
    record.classification === "Passed" ||
    record.classification === "Incomplete" ||
    record.classification === "Failed"
  ) {
    return record.classification;
  }

  return classifyFinalRating(record.final_rating);
}

function getAcademicYearLabel(record: AcademicRecord): string {
  return (
    record.academic_year ||
    record.transfer_source?.academic_year ||
    "Transfer Credit"
  );
}

function getSemesterLabel(record: AcademicRecord): string {
  return (
    record.semester_name ||
    record.transfer_source?.semester ||
    "Transfer Credit"
  );
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
    return `es-${record.enrollment_subject_id}`;
  }

  return `${record.record_type}-${record.subject_id}`;
}

export default function TranscriptPreviewR() {
  const navigate = useNavigate();

  const { id } = useParams<{
    id: string;
  }>();

  const user = authService.getSession();

  const token = authService.getToken();

  const authenticated = Boolean(user && token);

  const userRole = user?.role;

  const [student, setStudent] = useState<Student | null>(null);

  const [records, setRecords] = useState<AcademicRecord[]>([]);

  const [apiSummary, setApiSummary] = useState<AcademicSummary | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

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

    const fetchTranscriptData = async () => {
      try {
        setLoading(true);

        setError("");

        const response = await authService.authFetch(
          `${API_BASE_URL}/${studentId}/academic-records`,
          {
            method: "GET",

            signal: controller.signal,

            headers: {
              Accept: "application/json",
            },
          },
        );

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
            data.message || data.error || "Failed to load transcript records.",
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

        console.error("TRANSCRIPT FETCH ERROR:", requestError);

        setStudent(null);

        setApiSummary(null);

        setRecords([]);

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load transcript records.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void fetchTranscriptData();

    return () => {
      controller.abort();
    };
  }, [id, authenticated, userRole, navigate]);

  const groupedRecords = useMemo<AcademicYearGroup[]>(() => {
    const yearMap = new Map<string, AcademicYearGroup>();

    records.forEach((record) => {
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
  }, [records]);

  const totalRecordedUnits = useMemo(() => {
    return (
      apiSummary?.total_recorded_units ??
      records.reduce((total, record) => total + Number(record.units || 0), 0)
    );
  }, [records, apiSummary]);

  const earnedUnits = useMemo(() => {
    if (apiSummary?.earned_units !== undefined) {
      return apiSummary.earned_units;
    }

    const subjects = new Map<number, number>();

    records.forEach((record) => {
      if (!record.curriculum_satisfied) {
        return;
      }

      if (!subjects.has(record.subject_id)) {
        subjects.set(record.subject_id, Number(record.units || 0));
      }
    });

    return Array.from(subjects.values()).reduce(
      (total, units) => total + units,
      0,
    );
  }, [records, apiSummary]);

  const transferCreditCount = useMemo(() => {
    return (
      apiSummary?.official_transfer_credit_records ??
      records.filter(isTransferCredit).length
    );
  }, [records, apiSummary]);

  const studentName = useMemo(() => {
    if (!student) {
      return "";
    }

    const givenName = [student.first_name, student.middle_name]
      .filter(Boolean)
      .join(" ");

    return `${student.last_name}, ${givenName}`;
  }, [student]);

  if (!authenticated || !user || userRole !== "Registrar") {
    return null;
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="transcript-page">
          <div className="transcript-message">Loading transcript...</div>
        </div>
      </DashboardLayout>
    );
  }

  if (error || !student) {
    return (
      <DashboardLayout>
        <div className="transcript-page">
          <div className="transcript-message error">
            {error || "Student record not found."}
          </div>

          <button
            type="button"
            className="transcript-back-btn"
            onClick={() => navigate(-1)}
          >
            Go Back
          </button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="transcript-page">
        <div className="transcript-action-bar">
          <button
            type="button"
            className="transcript-back-btn"
            onClick={() => navigate(-1)}
          >
            ← Back
          </button>

          <div className="transcript-actions">
            <button
              type="button"
              className="transcript-print-btn"
              onClick={() => window.print()}
            >
              Print
            </button>

            <button
              type="button"
              className="transcript-generate-btn"
              onClick={() => window.print()}
            >
              Generate TOR
            </button>
          </div>
        </div>

        <div className="transcript-document">
          <div className="transcript-header">
            <h1>PATEROS TECHNOLOGICAL COLLEGE</h1>

            <p>OFFICE OF THE REGISTRAR</p>

            <h2>TRANSCRIPT OF RECORDS</h2>
          </div>

          <div className="transcript-student-info">
            <div className="student-info-row">
              <div>
                <span>Student Number</span>

                <strong>{student.student_number}</strong>
              </div>

              <div>
                <span>Student Status</span>

                <strong>{student.status}</strong>
              </div>
            </div>

            <div className="student-info-row">
              <div>
                <span>Name</span>

                <strong>{studentName}</strong>
              </div>
            </div>

            <div className="student-info-row">
              <div>
                <span>Program</span>

                <strong>{student.course_code}</strong>

                {student.course_name && <small>{student.course_name}</small>}
              </div>

              <div>
                <span>Current Year Level</span>

                <strong>Year {student.year_level}</strong>
              </div>
            </div>
          </div>

          <div className="transcript-academic-history">
            {groupedRecords.length === 0 ? (
              <div className="transcript-empty">
                No official academic records found.
              </div>
            ) : (
              groupedRecords.map((year) => (
                <div className="transcript-academic-year" key={year.key}>
                  <h3>Academic Year {year.academicYear}</h3>

                  {year.semesters.map((semester) => {
                    const semesterUnits = semester.records.reduce(
                      (total, record) => total + Number(record.units || 0),
                      0,
                    );

                    const semesterEarnedUnits = semester.records
                      .filter((record) => record.curriculum_satisfied === true)
                      .reduce(
                        (total, record) => total + Number(record.units || 0),
                        0,
                      );

                    return (
                      <div className="transcript-semester" key={semester.key}>
                        <h4>{semester.semesterName}</h4>

                        <table className="transcript-table">
                          <thead>
                            <tr>
                              <th>Subject Code</th>

                              <th>Subject Description</th>

                              <th>Units</th>

                              <th>Academic Source</th>

                              <th>Official Result</th>

                              <th>Remarks</th>
                            </tr>
                          </thead>

                          <tbody>
                            {semester.records.map((record) => {
                              const transfer = isTransferCredit(record);

                              const classification = getClassification(record);

                              return (
                                <tr key={getRecordKey(record)}>
                                  <td>{record.subject_code}</td>

                                  <td>
                                    <strong>{record.subject_name}</strong>

                                    {transfer && record.transfer_source && (
                                      <>
                                        <br />

                                        <small>
                                          Previous School:{" "}
                                          {record.transfer_source.school}
                                        </small>

                                        <br />

                                        <small>
                                          Previous Subject:{" "}
                                          {record.transfer_source.subject_code
                                            ? `${record.transfer_source.subject_code} — `
                                            : ""}
                                          {record.transfer_source.subject_name}
                                        </small>
                                      </>
                                    )}
                                  </td>

                                  <td>{record.units}</td>

                                  <td>
                                    {transfer ? (
                                      <>
                                        <strong>Transfer Credit</strong>

                                        <br />

                                        <small>
                                          {record.transfer_source?.school}
                                        </small>
                                      </>
                                    ) : (
                                      "PTC Grade"
                                    )}
                                  </td>

                                  <td>
                                    {transfer ? (
                                      <strong>Credited</strong>
                                    ) : (
                                      <strong>
                                        {formatGrade(record.final_rating)}
                                      </strong>
                                    )}
                                  </td>

                                  <td>
                                    {transfer ? (
                                      <>
                                        <strong>
                                          Source Grade:{" "}
                                          {formatGrade(record.source_grade)}
                                        </strong>

                                        <br />

                                        <small>
                                          External previous-school grade — not a
                                          PTC Final Rating
                                        </small>
                                      </>
                                    ) : (
                                      classification
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>

                        <div className="semester-total">
                          <strong>Semester Recorded Units:</strong>{" "}
                          {semesterUnits}
                          {" • "}
                          <strong>Earned Units:</strong> {semesterEarnedUnits}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="transcript-summary">
            <div>
              <span>Official Records</span>

              <strong>{records.length}</strong>
            </div>

            <div>
              <span>Recorded Units</span>

              <strong>{totalRecordedUnits}</strong>
            </div>

            <div>
              <span>Earned Units</span>

              <strong>{earnedUnits}</strong>
            </div>

            <div>
              <span>Transfer Credits</span>

              <strong>{transferCreditCount}</strong>
            </div>
          </div>

          <div className="transcript-certification">
            <p>
              This transcript contains official academic records currently
              recognized by the PTC Portal. Approved PTC grades and completed
              transfer credits are maintained as separate academic sources.
              Previous-school source grades are not converted into PTC Final
              Rating values.
            </p>
          </div>

          <div className="transcript-signature">
            <div className="signature-line">
              <strong>REGISTRAR</strong>

              <span>Registrar</span>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
