import { useEffect, useMemo, useState } from "react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";

import { authService } from "../../../services/auth.service";

import { useNavigate } from "react-router-dom";

import {
  fallbackStudents,
  type StudentRecord,
} from "../../../data/studentFallbackData";

import "../../../styles/Studentlist.css";

const API_BASE_URL = "http://localhost:3000/api/students";

// =====================================================
// FOLDER TREE TYPES
// =====================================================

type SectionMap = Record<string, StudentRecord[]>;

type CourseMap = Record<string, SectionMap>;

type FolderTree = Record<string, CourseMap>;

interface FolderSelection {
  year: string;
  course?: string;
  section?: string;
}

// =====================================================
// API RESPONSE
// =====================================================

interface StudentListResponse {
  success?: boolean;

  data?: StudentRecord[];

  students?: StudentRecord[];

  message?: string;

  error?: string;
}

// =====================================================
// ICONS
// =====================================================

function FolderIcon({ open }: { open?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d={
          open
            ? "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3V7z M3 10h20l-2 9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2l-2-9z"
            : "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
        }
        fill="currentColor"
      />
    </svg>
  );
}

function ChevronIcon({ open }: { open?: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      className={`chevron ${open ? "open" : ""}`}
    >
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SectionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />

      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

// =====================================================
// COMPONENT
// =====================================================

export default function StudentManagement() {
  const navigate = useNavigate();

  // =====================================================
  // AUTHENTICATION
  // =====================================================

  const user = authService.getSession();

  const token = authService.getToken();

  const userRole = user?.role;

  const authenticated = Boolean(user && token);

  // =====================================================
  // STATE
  // =====================================================

  const [students, setStudents] = useState<StudentRecord[]>([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");

  // =====================================================
  // FOLDER EXPLORER STATE
  // =====================================================

  const [expandedYear, setExpandedYear] = useState<string | null>(null);

  const [expandedCourse, setExpandedCourse] = useState<string | null>(null);

  const [selectedFolder, setSelectedFolder] = useState<FolderSelection | null>(
    null,
  );

  // =====================================================
  // AUTHORIZATION
  // =====================================================

  useEffect(() => {
    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    if (userRole !== "Admin") {
      if (userRole) {
        navigate(authService.getDashboardRoute(userRole), {
          replace: true,
        });
      } else {
        navigate("/login", {
          replace: true,
        });
      }
    }
  }, [authenticated, userRole, navigate]);

  // =====================================================
  // LOAD STUDENTS
  // =====================================================

  useEffect(() => {
    if (!authenticated || userRole !== "Admin") {
      return;
    }

    const controller = new AbortController();

    const fetchStudents = async () => {
      try {
        setLoading(true);

        setError("");

        // ===============================================
        // JWT AUTHENTICATED REQUEST
        // ===============================================

        const response = await authService.authFetch(API_BASE_URL, {
          method: "GET",

          signal: controller.signal,

          headers: {
            Accept: "application/json",
          },
        });

        // ===============================================
        // SAFE RESPONSE
        // ===============================================

        const contentType = response.headers.get("content-type") || "";

        let data: StudentRecord[] | StudentListResponse | null = null;

        if (contentType.includes("application/json")) {
          data = await response.json();
        } else {
          const text = await response.text();

          throw new Error(
            `Server returned a non-JSON response (${response.status}): ${text.slice(
              0,
              200,
            )}`,
          );
        }

        // ===============================================
        // 401
        // ===============================================

        if (response.status === 401) {
          authService.logout();

          navigate("/login", {
            replace: true,
          });

          return;
        }

        // ===============================================
        // 403
        // ===============================================

        if (response.status === 403) {
          const responseObject = !Array.isArray(data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              "You are not authorized to view the student list.",
          );
        }

        // ===============================================
        // HTTP ERROR
        // ===============================================

        if (!response.ok) {
          const responseObject = !Array.isArray(data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              `Unable to load student list (${response.status}).`,
          );
        }

        // ===============================================
        // NORMALIZE RESPONSE
        //
        // Supports:
        //
        // [...]
        //
        // { students: [...] }
        //
        // { data: [...] }
        // ===============================================

        let loadedStudents: StudentRecord[] = [];

        if (Array.isArray(data)) {
          loadedStudents = data;
        } else if (data && Array.isArray(data.students)) {
          loadedStudents = data.students;
        } else if (data && Array.isArray(data.data)) {
          loadedStudents = data.data;
        }

        console.log("ADMIN STUDENTS:", loadedStudents);

        setStudents(loadedStudents);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        console.error("ADMIN STUDENT LIST ERROR:", err);

        // ===============================================
        // FALLBACK DATA
        //
        // Keep your existing fallback behavior only for
        // actual connectivity/runtime failure.
        //
        // Do NOT use fallback data to hide a 401 or 403.
        // ===============================================

        if (err instanceof TypeError) {
          setStudents(fallbackStudents);

          setError("Using saved student data while the server is unavailable.");

          return;
        }

        setStudents([]);

        setError(
          err instanceof Error ? err.message : "Unable to load student list.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void fetchStudents();

    return () => {
      controller.abort();
    };
  }, [authenticated, userRole, navigate]);

  // =====================================================
  // BUILD FOLDER TREE
  // =====================================================

  const folderTree: FolderTree = useMemo(() => {
    const tree: FolderTree = {};

    for (const student of students) {
      const year = student.yearLevel || "Unknown Year";

      const course = student.course || "Unknown Course";

      const section = student.section || "No Section";

      if (!tree[year]) {
        tree[year] = {};
      }

      if (!tree[year][course]) {
        tree[year][course] = {};
      }

      if (!tree[year][course][section]) {
        tree[year][course][section] = [];
      }

      tree[year][course][section].push(student);
    }

    return tree;
  }, [students]);

  // =====================================================
  // TOGGLE YEAR
  // =====================================================

  const toggleYear = (year: string) => {
    setExpandedYear((previous) => (previous === year ? null : year));

    setExpandedCourse(null);
  };

  // =====================================================
  // TOGGLE COURSE
  // =====================================================

  const toggleCourse = (course: string) => {
    setExpandedCourse((previous) => (previous === course ? null : course));
  };

  // =====================================================
  // FOLDER FILTER
  // =====================================================

  const folderFilteredStudents = useMemo(() => {
    if (!selectedFolder) {
      return students;
    }

    return students.filter((student) => {
      if (student.yearLevel !== selectedFolder.year) {
        return false;
      }

      if (selectedFolder.course && student.course !== selectedFolder.course) {
        return false;
      }

      if (
        selectedFolder.section &&
        student.section !== selectedFolder.section
      ) {
        return false;
      }

      return true;
    });
  }, [students, selectedFolder]);

  // =====================================================
  // SEARCH FILTER
  // =====================================================

  const filteredStudents = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    if (!term) {
      return folderFilteredStudents;
    }

    return folderFilteredStudents.filter((student) => {
      const values = [
        student.id,
        student.firstName,
        student.lastName,
        student.email,
        student.course,
        student.yearLevel,
        student.section,
      ];

      return values.some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(term),
      );
    });
  }, [searchTerm, folderFilteredStudents]);

  // =====================================================
  // AUTH GUARD
  // =====================================================

  if (!authenticated || !user || userRole !== "Admin") {
    return null;
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <DashboardLayout>
      <div className="admin-manage-students">
        <h1>Student List</h1>

        <p className="student-subtitle">
          Manage and review the students registered in the system.
        </p>

        <div className="file-explorer">
          {/* =================================================
              LEFT:
              YEAR > COURSE > SECTION
          ================================================= */}

          <div className="folder-tree">
            {Object.keys(folderTree)
              .sort()
              .map((year) => {
                const isYearExpanded = expandedYear === year;

                const courses = folderTree[year];

                return (
                  <div key={year} className="folder-group">
                    <button
                      className="folder-row"
                      onClick={() => {
                        toggleYear(year);

                        setSelectedFolder({
                          year,
                        });
                      }}
                      type="button"
                    >
                      <ChevronIcon open={isYearExpanded} />

                      <FolderIcon open={isYearExpanded} />

                      <span className="folder-label">{year}</span>
                    </button>

                    {isYearExpanded && (
                      <div className="folder-children">
                        {Object.keys(courses)
                          .sort()
                          .map((course) => {
                            const isCourseExpanded = expandedCourse === course;

                            const sections = courses[course];

                            return (
                              <div key={course} className="folder-group">
                                <button
                                  className="folder-row sub-row"
                                  onClick={() => {
                                    toggleCourse(course);

                                    setSelectedFolder({
                                      year,
                                      course,
                                    });
                                  }}
                                  type="button"
                                >
                                  <ChevronIcon open={isCourseExpanded} />

                                  <FolderIcon open={isCourseExpanded} />

                                  <span className="folder-label">{course}</span>
                                </button>

                                {isCourseExpanded && (
                                  <div className="folder-children">
                                    {Object.keys(sections)
                                      .sort()
                                      .map((section) => {
                                        const isActive =
                                          selectedFolder?.year === year &&
                                          selectedFolder?.course === course &&
                                          selectedFolder?.section === section;

                                        return (
                                          <button
                                            key={section}
                                            className={`folder-child-row ${
                                              isActive ? "active" : ""
                                            }`}
                                            onClick={() =>
                                              setSelectedFolder({
                                                year,
                                                course,
                                                section,
                                              })
                                            }
                                            type="button"
                                          >
                                            <SectionIcon />

                                            <span>{section}</span>
                                          </button>
                                        );
                                      })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>

          {/* =================================================
              RIGHT:
              SEARCH + STATS + TABLE
          ================================================= */}

          <div className="folder-content">
            <div className="folder-content-header">
              <div>
                <h2 className="folder-content-title">
                  {selectedFolder
                    ? [
                        selectedFolder.year,
                        selectedFolder.course,
                        selectedFolder.section,
                      ]
                        .filter(Boolean)
                        .join(" / ")
                    : "All Students"}
                </h2>
              </div>

              <div className="folder-search-wrap">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search student"
                  className="folder-search-input"
                />
              </div>
            </div>

            {/* =================================================
                TOTAL
            ================================================= */}

            <div className="student-total-box">
              <strong>Total students:</strong> {filteredStudents.length}
            </div>

            {/* =================================================
                LOADING
            ================================================= */}

            {loading && <p>Loading student list...</p>}

            {/* =================================================
                ERROR
            ================================================= */}

            {error && <p className="student-error-text">{error}</p>}

            {/* =================================================
                TABLE
            ================================================= */}

            {!loading && students.length === 0 && !error && (
              <p>No students found.</p>
            )}

            {!loading && students.length > 0 && (
              <div className="student-table-wrap">
                <table className="student-table">
                  <thead>
                    <tr>
                      <th>Student ID</th>

                      <th>Name</th>

                      <th>Email</th>

                      <th>Course</th>

                      <th>Year</th>

                      <th>Section</th>

                      <th>Profile</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredStudents.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="student-table-empty">
                          No students found.
                        </td>
                      </tr>
                    ) : (
                      filteredStudents.map((student) => (
                        <tr key={student.id}>
                          <td>{student.id}</td>

                          <td>
                            {student.firstName} {student.lastName}
                          </td>

                          <td>{student.email}</td>

                          <td>{student.course}</td>

                          <td>{student.yearLevel}</td>

                          <td>{student.section}</td>

                          <td>
                            <button
                              type="button"
                              className="student-profile-btn"
                              onClick={() =>
                                navigate(
                                  `/admin/students/profile/${student.id}`,
                                )
                              }
                            >
                              View Profile
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
