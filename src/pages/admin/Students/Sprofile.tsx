import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  CircleAlert,
  GraduationCap,
  LoaderCircle,
  Mail,
  MapPin,
  Pencil,
  Phone,
  UserRound,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import "../../../styles/AdminStudentProfile.css";

const API_BASE_URL = apiUrl("/api/students");

interface Student {
  studentId: number;
  id: string;

  firstName: string;
  middleName?: string;
  lastName: string;

  email: string;
  gender?: string;
  birthDate?: string;
  contactNumber?: string;

  course: string;
  yearLevel: string;
  section: string;

  semester?: string;

  houseNo?: string;
  street?: string;
  barangay?: string;
  city?: string;
  province?: string;
  zipCode?: string;
}

interface StudentResponse {
  success?: boolean;
  data?: Student;
  student?: Student;
  message?: string;
  error?: string;
}

export default function Sprofile() {
  const navigate = useNavigate();

  const { id } = useParams<{
    id: string;
  }>();

  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [student, setStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

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

  useEffect(() => {
    if (!authenticated || userRole !== "Admin") {
      return;
    }

    if (!id) {
      setErrorMessage("Student ID is missing.");
      setLoading(false);
      return;
    }

    const studentNumber = id.trim();

    if (!studentNumber) {
      setErrorMessage("Invalid student ID.");
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    const fetchStudent = async () => {
      try {
        setLoading(true);
        setErrorMessage("");

        const response = await authService.authFetch(
          `${API_BASE_URL}/${encodeURIComponent(studentNumber)}`,
          {
            method: "GET",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          },
        );

        const contentType = response.headers.get("content-type") || "";

        let data: Student | StudentResponse | null = null;

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

          navigate("/login", {
            replace: true,
          });

          return;
        }

        if (response.status === 403) {
          const responseObject = data && !("studentId" in data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              "You are not authorized to view this student.",
          );
        }

        if (!response.ok) {
          const responseObject = data && !("studentId" in data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              `Failed to load student (${response.status}).`,
          );
        }

        let loadedStudent: Student | null = null;

        if (data && "studentId" in data) {
          loadedStudent = data as Student;
        } else if (data && data.student) {
          loadedStudent = data.student;
        } else if (data && data.data) {
          loadedStudent = data.data;
        }

        if (!loadedStudent) {
          throw new Error("Student data was not returned by the server.");
        }

        setStudent(loadedStudent);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        console.error("LOAD ADMIN STUDENT PROFILE ERROR:", error);

        setStudent(null);

        if (error instanceof TypeError) {
          setErrorMessage(
            "Unable to connect to the student server. Make sure the backend is running on port 3000.",
          );

          return;
        }

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to load student profile.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void fetchStudent();

    return () => {
      controller.abort();
    };
  }, [id, authenticated, userRole, navigate]);

  if (!authenticated || !user || userRole !== "Admin") {
    return null;
  }

  if (loading) {
    return (
      <DashboardLayout>
        <main className="admin-student-profile">
          <section className="admin-student-profile__state">
            <span className="admin-student-profile__state-icon">
              <LoaderCircle
                size={25}
                className="admin-student-profile__spinner"
                aria-hidden="true"
              />
            </span>

            <strong>Loading student profile...</strong>
            <p>Please wait while the student record is retrieved.</p>
          </section>
        </main>
      </DashboardLayout>
    );
  }

  if (errorMessage || !student) {
    return (
      <DashboardLayout>
        <main className="admin-student-profile">
          <section className="admin-student-profile__state admin-student-profile__state--error">
            <span className="admin-student-profile__state-icon">
              <CircleAlert size={25} aria-hidden="true" />
            </span>

            <strong>Unable to open student profile</strong>
            <p>{errorMessage || "Student not found."}</p>

            <button
              type="button"
              className="admin-student-profile__back"
              onClick={() => navigate(-1)}
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Back to Student List
            </button>
          </section>
        </main>
      </DashboardLayout>
    );
  }

  const fullName = [student.firstName, student.middleName, student.lastName]
    .filter(Boolean)
    .join(" ");

  const birthDate = student.birthDate
    ? new Date(student.birthDate).toLocaleDateString()
    : "Not provided";

  const address = [
    student.houseNo,
    student.street,
    student.barangay,
    student.city,
    student.province,
    student.zipCode,
  ]
    .filter(Boolean)
    .join(", ");

  const initials = `${student.firstName?.charAt(0) || ""}${
    student.lastName?.charAt(0) || ""
  }`.toUpperCase();

  return (
    <DashboardLayout>
      <main className="admin-student-profile">
        <div className="admin-student-profile__toolbar">
          <button
            type="button"
            className="admin-student-profile__back"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to Student List
          </button>

          <button
            type="button"
            className="admin-student-profile__edit"
            onClick={() =>
              navigate(`/admin/students/editstudents/${student.id}`)
            }
          >
            <Pencil size={15} aria-hidden="true" />
            Edit Student
          </button>
        </div>

        <section className="admin-student-profile__hero">
          <div className="admin-student-profile__identity">
            <div className="admin-student-profile__avatar" aria-hidden="true">
              {initials || "ST"}
            </div>

            <div className="admin-student-profile__identity-copy">
              <span className="admin-student-profile__eyebrow">
                <UsersRound size={15} aria-hidden="true" />
                Admin · Student Record
              </span>

              <h1>{fullName || "Student Profile"}</h1>

              <p>Student ID: {student.id}</p>
            </div>
          </div>

          <div className="admin-student-profile__hero-meta">
            <div>
              <span>Course</span>
              <strong>{student.course || "Not provided"}</strong>
            </div>

            <div>
              <span>Year Level</span>
              <strong>{student.yearLevel || "Not provided"}</strong>
            </div>

            <div>
              <span>Section</span>
              <strong>{student.section || "Not provided"}</strong>
            </div>
          </div>
        </section>

        <section className="admin-student-profile__quick-info">
          <article>
            <span>
              <Mail size={17} aria-hidden="true" />
            </span>
            <div>
              <small>Email Address</small>
              <strong>{student.email || "Not provided"}</strong>
            </div>
          </article>

          <article>
            <span>
              <Phone size={17} aria-hidden="true" />
            </span>
            <div>
              <small>Contact Number</small>
              <strong>{student.contactNumber || "Not provided"}</strong>
            </div>
          </article>

          <article>
            <span>
              <CalendarDays size={17} aria-hidden="true" />
            </span>
            <div>
              <small>Semester</small>
              <strong>{student.semester || "Not provided"}</strong>
            </div>
          </article>
        </section>

        <div className="admin-student-profile__content-grid">
          <section className="admin-student-profile__card">
            <div className="admin-student-profile__card-header">
              <span className="admin-student-profile__section-icon">
                <UserRound size={17} aria-hidden="true" />
              </span>

              <div>
                <span>Student Details</span>
                <h2>Personal Information</h2>
              </div>
            </div>

            <div className="admin-student-profile__fields">
              <div className="admin-student-profile__field">
                <span>First Name</span>
                <strong>{student.firstName || "Not provided"}</strong>
              </div>

              <div className="admin-student-profile__field">
                <span>Middle Name</span>
                <strong>{student.middleName || "Not provided"}</strong>
              </div>

              <div className="admin-student-profile__field">
                <span>Last Name</span>
                <strong>{student.lastName || "Not provided"}</strong>
              </div>

              <div className="admin-student-profile__field">
                <span>Gender</span>
                <strong>{student.gender || "Not provided"}</strong>
              </div>

              <div className="admin-student-profile__field">
                <span>Birth Date</span>
                <strong>{birthDate}</strong>
              </div>

              <div className="admin-student-profile__field">
                <span>Contact Number</span>
                <strong>{student.contactNumber || "Not provided"}</strong>
              </div>

              <div className="admin-student-profile__field admin-student-profile__field--wide">
                <span>Email</span>
                <strong>{student.email || "Not provided"}</strong>
              </div>
            </div>
          </section>

          <section className="admin-student-profile__card">
            <div className="admin-student-profile__card-header">
              <span className="admin-student-profile__section-icon">
                <MapPin size={17} aria-hidden="true" />
              </span>

              <div>
                <span>Location</span>
                <h2>Address</h2>
              </div>
            </div>

            <div className="admin-student-profile__fields">
              <div className="admin-student-profile__field">
                <span>House No.</span>
                <strong>{student.houseNo || "Not provided"}</strong>
              </div>

              <div className="admin-student-profile__field">
                <span>Street</span>
                <strong>{student.street || "Not provided"}</strong>
              </div>

              <div className="admin-student-profile__field">
                <span>Barangay</span>
                <strong>{student.barangay || "Not provided"}</strong>
              </div>

              <div className="admin-student-profile__field">
                <span>City</span>
                <strong>{student.city || "Not provided"}</strong>
              </div>

              <div className="admin-student-profile__field">
                <span>Province</span>
                <strong>{student.province || "Not provided"}</strong>
              </div>

              <div className="admin-student-profile__field">
                <span>ZIP Code</span>
                <strong>{student.zipCode || "Not provided"}</strong>
              </div>

              <div className="admin-student-profile__field admin-student-profile__field--wide">
                <span>Complete Address</span>
                <strong>{address || "Not provided"}</strong>
              </div>
            </div>
          </section>

          <section className="admin-student-profile__card admin-student-profile__card--wide">
            <div className="admin-student-profile__card-header">
              <span className="admin-student-profile__section-icon">
                <GraduationCap size={18} aria-hidden="true" />
              </span>

              <div>
                <span>Academic Record</span>
                <h2>Academic Information</h2>
              </div>
            </div>

            <div className="admin-student-profile__academic-grid">
              <div className="admin-student-profile__academic-item">
                <span className="admin-student-profile__academic-icon">
                  <UserRound size={16} aria-hidden="true" />
                </span>
                <div>
                  <small>Student Number</small>
                  <strong>{student.id}</strong>
                </div>
              </div>

              <div className="admin-student-profile__academic-item">
                <span className="admin-student-profile__academic-icon">
                  <BookOpen size={16} aria-hidden="true" />
                </span>
                <div>
                  <small>Course</small>
                  <strong>{student.course || "Not provided"}</strong>
                </div>
              </div>

              <div className="admin-student-profile__academic-item">
                <span className="admin-student-profile__academic-icon">
                  <GraduationCap size={16} aria-hidden="true" />
                </span>
                <div>
                  <small>Year Level</small>
                  <strong>{student.yearLevel || "Not provided"}</strong>
                </div>
              </div>

              <div className="admin-student-profile__academic-item">
                <span className="admin-student-profile__academic-icon">
                  <UsersRound size={16} aria-hidden="true" />
                </span>
                <div>
                  <small>Section</small>
                  <strong>{student.section || "Not provided"}</strong>
                </div>
              </div>

              <div className="admin-student-profile__academic-item">
                <span className="admin-student-profile__academic-icon">
                  <CalendarDays size={16} aria-hidden="true" />
                </span>
                <div>
                  <small>Semester</small>
                  <strong>{student.semester || "Not provided"}</strong>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </DashboardLayout>
  );
}
