import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  CircleAlert,
  GraduationCap,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import Modal from "../../../components/modal";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import "../../../styles/AdminStudentManagement.css";

const API_BASE_URL = apiUrl("/api/students");

type Student = {
  id: string;
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  gender: string;
  birthDate: string;
  contactNumber: string;
  course: string;
  yearLevel: string;
  section: string;
  semesterId: string;
};

interface StudentListResponse {
  success?: boolean;
  data?: Student[];
  students?: Student[];
  message?: string;
  error?: string;
}

interface DeleteStudentResponse {
  success?: boolean;
  message?: string;
  error?: string;
}

export default function AddEditDrop() {
  const navigate = useNavigate();

  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [students, setStudents] = useState<Student[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [deletingStudentId, setDeletingStudentId] = useState<string | null>(
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

    const loadStudents = async () => {
      try {
        setIsLoading(true);
        setErrorMessage(null);

        const response = await authService.authFetch(API_BASE_URL, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });

        const contentType = response.headers.get("content-type") || "";
        let data: Student[] | StudentListResponse | null = null;

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
              "You are not authorized to manage students.",
          );
        }

        if (!response.ok) {
          const responseObject = !Array.isArray(data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              `Failed to load students (${response.status}).`,
          );
        }

        let loadedStudents: Student[] = [];

        if (Array.isArray(data)) {
          loadedStudents = data;
        } else if (data && Array.isArray(data.students)) {
          loadedStudents = data.students;
        } else if (data && Array.isArray(data.data)) {
          loadedStudents = data.data;
        }

        setStudents(loadedStudents);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        console.error("LOAD ADMIN STUDENTS ERROR:", error);
        setStudents([]);

        if (error instanceof TypeError) {
          setErrorMessage(
            "Unable to connect to the student server. Make sure the backend is running on port 3000.",
          );
          return;
        }

        setErrorMessage(
          error instanceof Error ? error.message : "Failed to load students.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void loadStudents();

    return () => {
      controller.abort();
    };
  }, [authenticated, userRole, navigate]);

  const filteredStudents = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    if (!query) {
      return students;
    }

    return students.filter((student) => {
      const values = [
        student.id,
        student.firstName,
        student.middleName,
        student.lastName,
        student.email,
        student.contactNumber,
        student.course,
        student.yearLevel,
        student.section,
      ];

      return values.some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(query),
      );
    });
  }, [students, searchTerm]);

  const summary = useMemo(() => {
    const courses = new Set<string>();
    const yearLevels = new Set<string>();
    const sections = new Set<string>();

    students.forEach((student) => {
      if (student.course) courses.add(student.course);
      if (student.yearLevel) yearLevels.add(student.yearLevel);
      if (student.section) sections.add(student.section);
    });

    return {
      courses: courses.size,
      yearLevels: yearLevels.size,
      sections: sections.size,
    };
  }, [students]);

  const goToAddStudent = () => {
    navigate("/admin/students/createstudents");
  };

  const goToEditStudent = (student: Student) => {
    navigate(`/admin/students/editstudents/${encodeURIComponent(student.id)}`);
  };

  const confirmDeleteStudent = (student: Student) => {
    setDeleteTarget(student);
    setErrorMessage(null);
  };

  const cancelDelete = () => {
    if (deletingStudentId) {
      return;
    }

    setDeleteTarget(null);
  };

  const deleteStudent = async () => {
    if (!deleteTarget) {
      return;
    }

    if (!authenticated || userRole !== "Admin") {
      setErrorMessage(
        "Your session has expired or you are not authorized to delete students.",
      );
      return;
    }

    const studentNumber = String(deleteTarget.id).trim();

    if (!studentNumber) {
      setErrorMessage("Invalid student ID.");
      return;
    }

    setErrorMessage(null);

    try {
      setDeletingStudentId(studentNumber);

      const response = await authService.authFetch(
        `${API_BASE_URL}/${encodeURIComponent(studentNumber)}`,
        {
          method: "DELETE",
          headers: {
            Accept: "application/json",
          },
        },
      );

      const contentType = response.headers.get("content-type") || "";
      let data: DeleteStudentResponse | null = null;

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
        throw new Error(
          data?.message ||
            data?.error ||
            "You are not authorized to delete students.",
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to delete student (${response.status}).`,
        );
      }

      setStudents((current) =>
        current.filter((student) => student.id !== studentNumber),
      );
      setDeleteTarget(null);
    } catch (error) {
      console.error("DELETE ADMIN STUDENT ERROR:", error);

      if (error instanceof TypeError) {
        setErrorMessage(
          "Unable to connect to the student server. Make sure the backend is running on port 3000.",
        );
        return;
      }

      setErrorMessage(
        error instanceof Error ? error.message : "Failed to delete student.",
      );
    } finally {
      setDeletingStudentId(null);
    }
  };

  if (!authenticated || !user || userRole !== "Admin") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="admin-student-management">
        <section className="admin-student-management__hero">
          <div className="admin-student-management__hero-copy">
            <div className="admin-student-management__eyebrow">
              <span>
                <UsersRound size={16} aria-hidden="true" />
              </span>
              Admin · Student Management
            </div>

            <h1>Add / Edit Students</h1>
            <p>
              Add new student records, update existing information, or remove
              records that should no longer remain in the portal.
            </p>
          </div>

          <button
            type="button"
            className="admin-student-management__add-button"
            onClick={goToAddStudent}
          >
            <Plus size={17} aria-hidden="true" />
            Add Student
          </button>
        </section>

        <section
          className="admin-student-management__summary"
          aria-label="Student management overview"
        >
          <article>
            <span className="admin-student-management__summary-icon">
              <UsersRound size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Total Students</small>
              <strong>
                {isLoading ? "…" : students.length.toLocaleString()}
              </strong>
            </div>
          </article>

          <article>
            <span className="admin-student-management__summary-icon">
              <BookOpen size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Courses</small>
              <strong>{isLoading ? "…" : summary.courses}</strong>
            </div>
          </article>

          <article>
            <span className="admin-student-management__summary-icon">
              <GraduationCap size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Year Levels</small>
              <strong>{isLoading ? "…" : summary.yearLevels}</strong>
            </div>
          </article>

          <article>
            <span className="admin-student-management__summary-icon">
              <UserRound size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Sections</small>
              <strong>{isLoading ? "…" : summary.sections}</strong>
            </div>
          </article>
        </section>

        {errorMessage && (
          <div className="admin-student-management__error" role="status">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}

        <section className="admin-student-management__workspace">
          <header className="admin-student-management__workspace-header">
            <div>
              <span className="admin-student-management__section-kicker">
                Student Records
              </span>
              <h2>Manage Students</h2>
              <p>
                {isLoading
                  ? "Loading student records…"
                  : `${filteredStudents.length.toLocaleString()} student${
                      filteredStudents.length === 1 ? "" : "s"
                    } shown`}
              </p>
            </div>

            <label className="admin-student-management__search">
              <Search size={16} aria-hidden="true" />
              <input
                type="text"
                placeholder="Search by ID, name, email, course, or section"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                aria-label="Search students"
              />
              {searchTerm && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearchTerm("")}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </label>
          </header>

          <div className="admin-student-management__table-wrap">
            <table className="admin-student-management__table">
              <thead>
                <tr>
                  <th>Student ID</th>
                  <th>Student</th>
                  <th>Email</th>
                  <th>Contact Number</th>
                  <th>Course</th>
                  <th>Year Level</th>
                  <th>Section</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="admin-student-management__table-state">
                        <LoaderCircle
                          size={21}
                          className="admin-student-management__spinner"
                          aria-hidden="true"
                        />
                        <span>Loading students...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="admin-student-management__table-state">
                        <UsersRound size={21} aria-hidden="true" />
                        <span>No students found.</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((student) => {
                    const deleting = deletingStudentId === student.id;
                    const fullName = [
                      student.firstName,
                      student.middleName,
                      student.lastName,
                    ]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <tr key={student.id}>
                        <td>
                          <span className="admin-student-management__student-id">
                            {student.id}
                          </span>
                        </td>

                        <td>
                          <div className="admin-student-management__student-cell">
                            <span className="admin-student-management__avatar">
                              {student.firstName?.charAt(0)}
                              {student.lastName?.charAt(0)}
                            </span>

                            <div>
                              <strong>{fullName || "Unnamed Student"}</strong>
                              <small>{student.gender || "Student"}</small>
                            </div>
                          </div>
                        </td>

                        <td>{student.email || "—"}</td>
                        <td>{student.contactNumber || "—"}</td>
                        <td>{student.course || "—"}</td>
                        <td>{student.yearLevel || "—"}</td>
                        <td>{student.section || "—"}</td>

                        <td>
                          <div className="admin-student-management__actions">
                            <button
                              type="button"
                              className="admin-student-management__action admin-student-management__action--edit"
                              onClick={() => goToEditStudent(student)}
                              disabled={deleting}
                            >
                              <Pencil size={14} aria-hidden="true" />
                              Edit
                            </button>

                            <button
                              type="button"
                              className="admin-student-management__action admin-student-management__action--delete"
                              onClick={() => confirmDeleteStudent(student)}
                              disabled={deleting}
                            >
                              {deleting ? (
                                <LoaderCircle
                                  size={14}
                                  className="admin-student-management__spinner"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Trash2 size={14} aria-hidden="true" />
                              )}
                              {deleting ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {deleteTarget && (
          <Modal isOpen={Boolean(deleteTarget)} onClose={cancelDelete}>
            <div className="admin-student-management__delete-dialog">
              <span className="admin-student-management__delete-icon">
                <Trash2 size={21} aria-hidden="true" />
              </span>

              <div>
                <h2>Delete Student</h2>
                <p>
                  Are you sure you want to delete{" "}
                  <strong>
                    {deleteTarget.firstName} {deleteTarget.lastName}
                  </strong>
                  ? This action cannot be undone.
                </p>
              </div>

              <div className="admin-student-management__modal-actions">
                <button
                  type="button"
                  className="admin-student-management__modal-button"
                  onClick={cancelDelete}
                  disabled={Boolean(deletingStudentId)}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="admin-student-management__modal-button admin-student-management__modal-button--danger"
                  onClick={() => void deleteStudent()}
                  disabled={Boolean(deletingStudentId)}
                >
                  {deletingStudentId ? (
                    <LoaderCircle
                      size={15}
                      className="admin-student-management__spinner"
                      aria-hidden="true"
                    />
                  ) : (
                    <Trash2 size={15} aria-hidden="true" />
                  )}
                  {deletingStudentId ? "Deleting..." : "Delete Student"}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </main>
    </DashboardLayout>
  );
}
