import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  ChevronRight,
  CircleAlert,
  FileText,
  Folder,
  FolderOpen,
  GraduationCap,
  Layers3,
  LoaderCircle,
  Search,
  UserRound,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";

import {
  fallbackStudents,
  type StudentRecord,
} from "../../../data/studentFallbackData";

import "../../../styles/Studentlist.css";

const API_BASE_URL = apiUrl("/api/students");

type SectionMap = Record<string, StudentRecord[]>;
type CourseMap = Record<string, SectionMap>;
type FolderTree = Record<string, CourseMap>;

interface FolderSelection {
  year: string;
  course?: string;
  section?: string;
}

interface StudentListResponse {
  success?: boolean;
  data?: StudentRecord[];
  students?: StudentRecord[];
  message?: string;
  error?: string;
}

export default function StudentManagement() {
  const navigate = useNavigate();

  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const [expandedYear, setExpandedYear] = useState<string | null>(null);
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<FolderSelection | null>(
    null,
  );

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Admin") {
      if (userRole) {
        navigate(authService.getDashboardRoute(userRole), { replace: true });
      } else {
        navigate("/login", { replace: true });
      }
    }
  }, [authenticated, userRole, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Admin") {
      return;
    }

    const controller = new AbortController();

    const fetchStudents = async () => {
      try {
        setLoading(true);
        setError("");

        const response = await authService.authFetch(API_BASE_URL, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });

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

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (response.status === 403) {
          const responseObject = !Array.isArray(data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              "You are not authorized to view the student list.",
          );
        }

        if (!response.ok) {
          const responseObject = !Array.isArray(data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              `Unable to load student list (${response.status}).`,
          );
        }

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

  const directorySummary = useMemo(() => {
    const years = new Set<string>();
    const courses = new Set<string>();
    const sections = new Set<string>();

    students.forEach((student) => {
      if (student.yearLevel) years.add(student.yearLevel);
      if (student.course) courses.add(student.course);

      if (student.section) {
        sections.add(
          `${student.yearLevel || ""}|${student.course || ""}|${student.section}`,
        );
      }
    });

    return {
      years: years.size,
      courses: courses.size,
      sections: sections.size,
    };
  }, [students]);

  const toggleYear = (year: string) => {
    setExpandedYear((previous) => (previous === year ? null : year));
    setExpandedCourse(null);
  };

  const toggleCourse = (course: string) => {
    setExpandedCourse((previous) => (previous === course ? null : course));
  };

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

  const selectedFolderTitle = selectedFolder
    ? [selectedFolder.year, selectedFolder.course, selectedFolder.section]
        .filter(Boolean)
        .join(" / ")
    : "All Students";

  if (!authenticated || !user || userRole !== "Admin") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="admin-manage-students">
        <section className="admin-manage-students__hero">
          <div>
            <div className="admin-manage-students__eyebrow">
              <span>
                <UsersRound size={16} aria-hidden="true" />
              </span>
              Admin · Student Management
            </div>

            <h1>Student List</h1>

            <p className="student-subtitle">
              Manage and review the students registered in the system.
            </p>
          </div>
        </section>

        <section
          className="admin-manage-students__summary"
          aria-label="Student directory overview"
        >
          <article>
            <span className="admin-manage-students__summary-icon">
              <UsersRound size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Total Students</small>
              <strong>
                {loading ? "…" : students.length.toLocaleString()}
              </strong>
            </div>
          </article>

          <article>
            <span className="admin-manage-students__summary-icon">
              <GraduationCap size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Year Levels</small>
              <strong>{loading ? "…" : directorySummary.years}</strong>
            </div>
          </article>

          <article>
            <span className="admin-manage-students__summary-icon">
              <BookOpen size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Courses</small>
              <strong>{loading ? "…" : directorySummary.courses}</strong>
            </div>
          </article>

          <article>
            <span className="admin-manage-students__summary-icon">
              <Layers3 size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Sections</small>
              <strong>{loading ? "…" : directorySummary.sections}</strong>
            </div>
          </article>
        </section>

        <section className="file-explorer">
          <aside className="folder-tree" aria-label="Student directory folders">
            <div className="folder-tree__header">
              <span className="folder-tree__header-icon">
                <FolderOpen size={18} aria-hidden="true" />
              </span>

              <div>
                <strong>Student Directory</strong>
                <small>Year · Course · Section</small>
              </div>
            </div>

            <div className="folder-tree__body">
              {Object.keys(folderTree)
                .sort()
                .map((year) => {
                  const isYearExpanded = expandedYear === year;
                  const courses = folderTree[year];

                  return (
                    <div key={year} className="folder-group">
                      <button
                        className={`folder-row ${
                          selectedFolder?.year === year &&
                          !selectedFolder.course
                            ? "is-selected"
                            : ""
                        }`}
                        onClick={() => {
                          toggleYear(year);
                          setSelectedFolder({ year });
                        }}
                        type="button"
                      >
                        <ChevronRight
                          size={14}
                          className={`chevron ${isYearExpanded ? "open" : ""}`}
                          aria-hidden="true"
                        />

                        {isYearExpanded ? (
                          <FolderOpen size={17} aria-hidden="true" />
                        ) : (
                          <Folder size={17} aria-hidden="true" />
                        )}

                        <span className="folder-label">{year}</span>
                      </button>

                      {isYearExpanded && (
                        <div className="folder-children">
                          {Object.keys(courses)
                            .sort()
                            .map((course) => {
                              const isCourseExpanded =
                                expandedCourse === course;
                              const sections = courses[course];

                              return (
                                <div key={course} className="folder-group">
                                  <button
                                    className={`folder-row sub-row ${
                                      selectedFolder?.year === year &&
                                      selectedFolder?.course === course &&
                                      !selectedFolder.section
                                        ? "is-selected"
                                        : ""
                                    }`}
                                    onClick={() => {
                                      toggleCourse(course);
                                      setSelectedFolder({ year, course });
                                    }}
                                    type="button"
                                  >
                                    <ChevronRight
                                      size={13}
                                      className={`chevron ${
                                        isCourseExpanded ? "open" : ""
                                      }`}
                                      aria-hidden="true"
                                    />

                                    {isCourseExpanded ? (
                                      <FolderOpen
                                        size={16}
                                        aria-hidden="true"
                                      />
                                    ) : (
                                      <Folder size={16} aria-hidden="true" />
                                    )}

                                    <span className="folder-label">
                                      {course}
                                    </span>
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
                                              <FileText
                                                size={15}
                                                aria-hidden="true"
                                              />
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
          </aside>

          <div className="folder-content">
            <header className="folder-content-header">
              <div className="folder-content-heading">
                <span className="folder-content-kicker">Student Records</span>
                <h2 className="folder-content-title">{selectedFolderTitle}</h2>
                <p>
                  {loading
                    ? "Loading student records…"
                    : `${filteredStudents.length.toLocaleString()} student${
                        filteredStudents.length === 1 ? "" : "s"
                      } shown`}
                </p>
              </div>

              <label className="folder-search-wrap">
                <Search size={16} aria-hidden="true" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search student"
                  className="folder-search-input"
                  aria-label="Search student"
                />
              </label>
            </header>

            {error && (
              <div className="student-error-text" role="status">
                <CircleAlert size={17} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            {loading ? (
              <div className="student-list-state">
                <LoaderCircle
                  size={24}
                  className="student-list-state__spinner"
                  aria-hidden="true"
                />
                <strong>Loading student list...</strong>
                <span>Please wait while student records are retrieved.</span>
              </div>
            ) : students.length === 0 && !error ? (
              <div className="student-list-state">
                <UsersRound size={24} aria-hidden="true" />
                <strong>No students found.</strong>
                <span>Student records will appear here once available.</span>
              </div>
            ) : (
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
                          <td>
                            <span className="student-id-value">
                              {student.id}
                            </span>
                          </td>

                          <td>
                            <span className="student-name-cell">
                              <span className="student-name-cell__icon">
                                <UserRound size={15} aria-hidden="true" />
                              </span>
                              <strong>
                                {student.firstName} {student.lastName}
                              </strong>
                            </span>
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
                              <ChevronRight size={14} aria-hidden="true" />
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
        </section>
      </main>
    </DashboardLayout>
  );
}
