import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  CircleAlert,
  CheckCircle2,
  GraduationCap,
  LoaderCircle,
  Mail,
  MapPin,
  Save,
  UserRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import "../../../styles/AdminEditStudent.css";

const API_BASE_URL = apiUrl("/api/students");

type CourseOption = {
  course_id: number;
  course_code: string;
  course_name: string;
  total_years: number;
};

type CoursesResponse = {
  success: boolean;
  courses?: CourseOption[];
  message?: string;
  error?: string;
};

type CurriculumOption = {
  curriculum_id: number;
  curriculum_name: string;
  effective_year: number | null;
};

type CurriculaResponse = {
  success: boolean;
  curricula?: CurriculumOption[];
  message?: string;
  error?: string;
};

const YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year"] as const;

const SEMESTERS = [
  {
    id: "1",
    label: "First Semester",
  },
  {
    id: "2",
    label: "Second Semester",
  },
  {
    id: "3",
    label: "Summer",
  },
] as const;

const GENDERS = ["Male", "Female"] as const;

interface StudentResponse {
  studentId?: number;
  id?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  email?: string;
  gender?: string;
  birthDate?: string;
  contactNumber?: string;
  houseNo?: string;
  street?: string;
  barangay?: string;
  city?: string;
  province?: string;
  zipCode?: string;
  course?: string;
  curriculumId?: number | string;
  yearLevel?: string;
  section?: string;
  semesterId?: number | string;
  semester?: string;
  success?: boolean;
  message?: string;
  error?: string;
  data?: StudentResponse;
  student?: StudentResponse;
}

interface UpdateStudentResponse {
  success?: boolean;
  message?: string;
  error?: string;
}

const yearLevelToDigit = (yearLevel: string): string => {
  const match = yearLevel.match(/^(\d+)/);

  return match ? match[1] : "";
};

const generateSectionOptions = (
  course: string,
  yearLevel: string,
): string[] => {
  const yearDigit = yearLevelToDigit(yearLevel);

  if (!course || !yearDigit) {
    return [];
  }

  return Array.from(
    {
      length: 26,
    },
    (_, index) => {
      const letter = String.fromCharCode(65 + index);

      return `${course}-${yearDigit}${letter}`;
    },
  );
};

const emptyForm = {
  firstName: "",
  middleName: "",
  lastName: "",
  email: "",
  gender: "",
  birthDate: "",
  contactNumber: "",
  houseNo: "",
  street: "",
  barangay: "",
  city: "",
  province: "",
  zipCode: "",
  course: "",
  curriculumId: "",
  yearLevel: "1st Year",
  section: "",
  semesterId: "1",
};

export default function EditStudent() {
  const navigate = useNavigate();

  const { id } = useParams<{
    id: string;
  }>();

  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [formState, setFormState] = useState(emptyForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);
  const [courseError, setCourseError] = useState<string | null>(null);
  const [curricula, setCurricula] = useState<CurriculumOption[]>([]);
  const [isLoadingCurricula, setIsLoadingCurricula] = useState(false);
  const [curriculumError, setCurriculumError] = useState<string | null>(null);

  const sectionOptions = useMemo(
    () => generateSectionOptions(formState.course, formState.yearLevel),
    [formState.course, formState.yearLevel],
  );

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

  // Registrar-managed course options for Admin Edit Student.
  useEffect(() => {
    if (!authenticated || userRole !== "Admin") return;

    const controller = new AbortController();

    const loadCourses = async () => {
      setIsLoadingCourses(true);
      setCourseError(null);

      try {
        const response = await authService.authFetch(
          `${API_BASE_URL}/courses`,
          {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: controller.signal,
          },
        );

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        const data: CoursesResponse = await response.json();

        if (!response.ok || !data.success || !Array.isArray(data.courses)) {
          throw new Error(
            data.error || data.message || "Failed to load courses.",
          );
        }

        if (!controller.signal.aborted) setCourses(data.courses);
      } catch (error) {
        if (controller.signal.aborted) return;
        setCourses([]);
        setCourseError(
          error instanceof Error ? error.message : "Failed to load courses.",
        );
      } finally {
        if (!controller.signal.aborted) setIsLoadingCourses(false);
      }
    };

    void loadCourses();
    return () => controller.abort();
  }, [authenticated, userRole, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Admin") {
      return;
    }

    if (!id) {
      setErrorMessage("Student ID is missing.");
      setIsLoading(false);
      return;
    }

    const studentNumber = id.trim();

    if (!studentNumber) {
      setErrorMessage("Invalid student ID.");
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();

    const loadStudent = async () => {
      try {
        setIsLoading(true);
        setErrorMessage(null);

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

        let data: StudentResponse | null = null;

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
          throw new Error(
            data?.message ||
              data?.error ||
              "You are not authorized to edit students.",
          );
        }

        if (!response.ok) {
          throw new Error(
            data?.message ||
              data?.error ||
              `Failed to load student (${response.status}).`,
          );
        }

        const student = data?.student ?? data?.data ?? data;

        if (!student) {
          throw new Error("Student data was not returned by the server.");
        }

        setFormState({
          firstName: student.firstName || "",
          middleName: student.middleName || "",
          lastName: student.lastName || "",
          email: student.email || "",
          gender: student.gender || "",
          birthDate: student.birthDate
            ? String(student.birthDate).slice(0, 10)
            : "",
          contactNumber: student.contactNumber || "",
          houseNo: student.houseNo || "",
          street: student.street || "",
          barangay: student.barangay || "",
          city: student.city || "",
          province: student.province || "",
          zipCode: student.zipCode || "",
          course: student.course || "",
          curriculumId: String(student.curriculumId ?? ""),
          yearLevel: student.yearLevel || "1st Year",
          section: student.section || "",
          semesterId: student.semesterId ? String(student.semesterId) : "1",
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        console.error("LOAD ADMIN STUDENT ERROR:", error);

        if (error instanceof TypeError) {
          setErrorMessage(
            "Unable to connect to the student server. Make sure the backend is running on port 3000.",
          );

          return;
        }

        setErrorMessage(
          error instanceof Error ? error.message : "Failed to load student.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void loadStudent();

    return () => {
      controller.abort();
    };
  }, [id, authenticated, userRole, navigate]);

  // Active curricula belong to the selected Registrar-managed course.
  useEffect(() => {
    if (!authenticated || userRole !== "Admin") return;

    if (!formState.course) {
      setCurricula([]);
      setCurriculumError(null);
      setIsLoadingCurricula(false);
      return;
    }

    const controller = new AbortController();
    setCurricula([]);
    setCurriculumError(null);

    const loadCurricula = async () => {
      setIsLoadingCurricula(true);
      try {
        const url = `${API_BASE_URL}/curricula?course=${encodeURIComponent(formState.course)}`;
        const response = await authService.authFetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        const data: CurriculaResponse = await response.json();
        if (!response.ok || !data.success || !Array.isArray(data.curricula)) {
          throw new Error(
            data.error || data.message || "Failed to load curricula.",
          );
        }
        if (!controller.signal.aborted) setCurricula(data.curricula);
      } catch (error) {
        if (controller.signal.aborted) return;
        setCurricula([]);
        setCurriculumError(
          error instanceof Error ? error.message : "Failed to load curricula.",
        );
      } finally {
        if (!controller.signal.aborted) setIsLoadingCurricula(false);
      }
    };

    void loadCurricula();
    return () => controller.abort();
  }, [formState.course, authenticated, userRole, navigate]);

  const handleInputChange = (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = event.target;

    setFormState((current) => {
      const updated = {
        ...current,
        [name]: value,
      };

      if (name === "course") {
        updated.curriculumId = "";
        updated.section = "";
      }

      if (name === "course" || name === "yearLevel") {
        const validSections = generateSectionOptions(
          updated.course,
          updated.yearLevel,
        );

        if (!validSections.includes(updated.section)) {
          updated.section = "";
        }
      }

      return updated;
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setErrorMessage(null);

    if (!authenticated || userRole !== "Admin") {
      setErrorMessage(
        "Your session has expired or you are not authorized to edit students.",
      );

      return;
    }

    if (!id) {
      setErrorMessage("Student ID is missing.");
      return;
    }

    const studentNumber = id.trim();

    if (!studentNumber) {
      setErrorMessage("Invalid student ID.");
      return;
    }

    if (
      !formState.firstName.trim() ||
      !formState.lastName.trim() ||
      !formState.email.trim() ||
      !formState.course.trim() ||
      !formState.yearLevel.trim() ||
      !formState.section.trim()
    ) {
      setErrorMessage("Please fill in all required fields.");
      return;
    }

    if (
      isLoadingCourses ||
      courseError ||
      !courses.some((course) => course.course_code === formState.course)
    ) {
      setErrorMessage(
        "Select a course available in Registrar Course Management.",
      );
      return;
    }

    if (
      isLoadingCurricula ||
      curriculumError ||
      !curricula.some(
        (curriculum) =>
          String(curriculum.curriculum_id) === formState.curriculumId,
      )
    ) {
      setErrorMessage("Select an active curriculum for the chosen course.");
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(formState.email.trim())) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    const yearLevelNumber = Number(yearLevelToDigit(formState.yearLevel));

    if (!Number.isInteger(yearLevelNumber) || yearLevelNumber <= 0) {
      setErrorMessage("Invalid year level.");
      return;
    }

    if (!sectionOptions.includes(formState.section)) {
      setErrorMessage("Please select a valid section.");
      return;
    }

    try {
      setIsSaving(true);

      const payload = {
        firstName: formState.firstName.trim(),
        middleName: formState.middleName.trim(),
        lastName: formState.lastName.trim(),
        email: formState.email.trim(),
        gender: formState.gender || null,
        birthDate: formState.birthDate || null,
        contactNumber: formState.contactNumber.trim(),
        houseNo: formState.houseNo.trim(),
        street: formState.street.trim(),
        barangay: formState.barangay.trim(),
        city: formState.city.trim(),
        province: formState.province.trim(),
        zipCode: formState.zipCode.trim(),
        course: formState.course,
        curriculumId: Number(formState.curriculumId),
        yearLevel: formState.yearLevel,
        section: formState.section,
        semesterId: Number(formState.semesterId),
      };

      const response = await authService.authFetch(
        `${API_BASE_URL}/${encodeURIComponent(studentNumber)}`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
        },
      );

      const contentType = response.headers.get("content-type") || "";

      let data: UpdateStudentResponse | null = null;

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
        throw new Error(
          data?.message ||
            data?.error ||
            "You are not authorized to update students.",
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to update student (${response.status}).`,
        );
      }

      // Show portal-styled confirmation instead of the browser's "localhost says" alert.
      setShowSuccessDialog(true);
    } catch (error) {
      console.error("UPDATE ADMIN STUDENT ERROR:", error);

      if (error instanceof TypeError) {
        setErrorMessage(
          "Unable to connect to the student server. Make sure the backend is running on port 3000.",
        );

        return;
      }

      setErrorMessage(
        error instanceof Error ? error.message : "Failed to update student.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (!authenticated || !user || userRole !== "Admin") {
    return null;
  }

  const studentNumber = id?.trim() || "Unknown";

  return (
    <DashboardLayout>
      <main className="admin-edit-student">
        <section className="admin-edit-student__hero">
          <div className="admin-edit-student__hero-copy">
            <div className="admin-edit-student__eyebrow">
              <span>
                <UserRound size={16} aria-hidden="true" />
              </span>
              Admin · Student Management
            </div>

            <h1>Edit Student</h1>

            <p>
              Update personal, contact, address, and academic information for
              this student record.
            </p>
          </div>

          <div className="admin-edit-student__header-actions">
            <div className="admin-edit-student__toolbar">
              <button
                type="button"
                className="admin-edit-student__back"
                onClick={() => navigate(-1)}
                disabled={isSaving}
              >
                <ArrowLeft size={16} aria-hidden="true" />
                Back
              </button>
            </div>
            <div className="admin-edit-student__student-number">
              <small>Student ID</small>
              <strong>{studentNumber}</strong>
            </div>
          </div>
        </section>

        {errorMessage && (
          <div className="admin-edit-student__error" role="status">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}

        {isLoading ? (
          <section className="admin-edit-student__state">
            <LoaderCircle
              size={25}
              className="admin-edit-student__spinner"
              aria-hidden="true"
            />
            <strong>Loading student record...</strong>
            <span>Please wait while the information is retrieved.</span>
          </section>
        ) : (
          <form className="admin-edit-student__form" onSubmit={handleSubmit}>
            <section className="admin-edit-student__section">
              <header className="admin-edit-student__section-header">
                <span className="admin-edit-student__section-icon">
                  <UserRound size={18} aria-hidden="true" />
                </span>

                <div>
                  <span>Student Details</span>
                  <h2>Personal Information</h2>
                  <p>Basic identity and contact information.</p>
                </div>
              </header>

              <div className="admin-edit-student__fields">
                <label className="admin-edit-student__field">
                  <span>
                    First Name <em>*</em>
                  </span>
                  <input
                    type="text"
                    name="firstName"
                    value={formState.firstName}
                    onChange={handleInputChange}
                    disabled={isSaving}
                    required
                  />
                </label>

                <label className="admin-edit-student__field">
                  <span>Middle Name</span>
                  <input
                    type="text"
                    name="middleName"
                    value={formState.middleName}
                    onChange={handleInputChange}
                    disabled={isSaving}
                  />
                </label>

                <label className="admin-edit-student__field">
                  <span>
                    Last Name <em>*</em>
                  </span>
                  <input
                    type="text"
                    name="lastName"
                    value={formState.lastName}
                    onChange={handleInputChange}
                    disabled={isSaving}
                    required
                  />
                </label>

                <label className="admin-edit-student__field">
                  <span>Gender</span>
                  <select
                    name="gender"
                    value={formState.gender}
                    onChange={handleInputChange}
                    disabled={isSaving}
                  >
                    <option value="">Select gender</option>

                    {GENDERS.map((gender) => (
                      <option key={gender} value={gender}>
                        {gender}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="admin-edit-student__field">
                  <span>Birth Date</span>
                  <input
                    type="date"
                    name="birthDate"
                    value={formState.birthDate}
                    onChange={handleInputChange}
                    disabled={isSaving}
                  />
                </label>

                <label className="admin-edit-student__field">
                  <span>Contact Number</span>
                  <div className="admin-edit-student__input-with-icon">
                    <UserRound size={15} aria-hidden="true" />
                    <input
                      type="tel"
                      name="contactNumber"
                      value={formState.contactNumber}
                      onChange={handleInputChange}
                      placeholder="e.g. 09171234567"
                      disabled={isSaving}
                    />
                  </div>
                </label>

                <label className="admin-edit-student__field admin-edit-student__field--wide">
                  <span>
                    Email Address <em>*</em>
                  </span>
                  <div className="admin-edit-student__input-with-icon">
                    <Mail size={15} aria-hidden="true" />
                    <input
                      type="email"
                      name="email"
                      value={formState.email}
                      onChange={handleInputChange}
                      disabled={isSaving}
                      required
                    />
                  </div>
                </label>
              </div>
            </section>

            <section className="admin-edit-student__section">
              <header className="admin-edit-student__section-header">
                <span className="admin-edit-student__section-icon">
                  <MapPin size={18} aria-hidden="true" />
                </span>

                <div>
                  <span>Location</span>
                  <h2>Address</h2>
                  <p>Current residential address information.</p>
                </div>
              </header>

              <div className="admin-edit-student__fields">
                <label className="admin-edit-student__field">
                  <span>House No.</span>
                  <input
                    type="text"
                    name="houseNo"
                    value={formState.houseNo}
                    onChange={handleInputChange}
                    disabled={isSaving}
                  />
                </label>

                <label className="admin-edit-student__field">
                  <span>Street</span>
                  <input
                    type="text"
                    name="street"
                    value={formState.street}
                    onChange={handleInputChange}
                    disabled={isSaving}
                  />
                </label>

                <label className="admin-edit-student__field">
                  <span>Barangay</span>
                  <input
                    type="text"
                    name="barangay"
                    value={formState.barangay}
                    onChange={handleInputChange}
                    disabled={isSaving}
                  />
                </label>

                <label className="admin-edit-student__field">
                  <span>City</span>
                  <input
                    type="text"
                    name="city"
                    value={formState.city}
                    onChange={handleInputChange}
                    disabled={isSaving}
                  />
                </label>

                <label className="admin-edit-student__field">
                  <span>Province</span>
                  <input
                    type="text"
                    name="province"
                    value={formState.province}
                    onChange={handleInputChange}
                    disabled={isSaving}
                  />
                </label>

                <label className="admin-edit-student__field">
                  <span>ZIP Code</span>
                  <input
                    type="text"
                    name="zipCode"
                    value={formState.zipCode}
                    onChange={handleInputChange}
                    disabled={isSaving}
                  />
                </label>
              </div>
            </section>

            <section className="admin-edit-student__section admin-edit-student__section--wide">
              <header className="admin-edit-student__section-header">
                <span className="admin-edit-student__section-icon">
                  <GraduationCap size={18} aria-hidden="true" />
                </span>

                <div>
                  <span>Enrollment Details</span>
                  <h2>Academic Information</h2>
                  <p>Course, year level, section, and semester assignment.</p>
                </div>
              </header>

              <div className="admin-edit-student__academic-fields">
                <label className="admin-edit-student__field">
                  <span>Semester</span>
                  <div className="admin-edit-student__select-with-icon">
                    <CalendarDays size={15} aria-hidden="true" />
                    <select
                      name="semesterId"
                      value={formState.semesterId}
                      onChange={handleInputChange}
                      disabled={isSaving}
                    >
                      {SEMESTERS.map((semester) => (
                        <option key={semester.id} value={semester.id}>
                          {semester.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </label>

                <label className="admin-edit-student__field">
                  <span>
                    Course <em>*</em>
                  </span>
                  <div className="admin-edit-student__select-with-icon">
                    <BookOpen size={15} aria-hidden="true" />
                    <select
                      name="course"
                      value={formState.course}
                      onChange={handleInputChange}
                      disabled={
                        isSaving ||
                        isLoadingCourses ||
                        Boolean(courseError) ||
                        courses.length === 0
                      }
                      required
                    >
                      <option value="">
                        {isLoadingCourses
                          ? "Loading courses..."
                          : courseError
                            ? "Unable to load courses"
                            : courses.length === 0
                              ? "No courses available"
                              : "Select course"}
                      </option>
                      {!isLoadingCourses &&
                        formState.course &&
                        !courses.some(
                          (course) => course.course_code === formState.course,
                        ) && (
                          <option value={formState.course} disabled>
                            {formState.course} (not available in Registrar
                            courses)
                          </option>
                        )}
                      {courses.map((course) => (
                        <option
                          key={course.course_id}
                          value={course.course_code}
                        >
                          {course.course_code} — {course.course_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </label>

                <label className="admin-edit-student__field">
                  <span>
                    Curriculum <em>*</em>
                  </span>
                  <div className="admin-edit-student__select-with-icon">
                    <BookOpen size={15} aria-hidden="true" />
                    <select
                      name="curriculumId"
                      value={formState.curriculumId}
                      onChange={handleInputChange}
                      disabled={
                        isSaving ||
                        isLoadingCurricula ||
                        Boolean(curriculumError) ||
                        !formState.course ||
                        curricula.length === 0
                      }
                      required
                    >
                      <option value="">
                        {isLoadingCurricula
                          ? "Loading curricula..."
                          : curriculumError
                            ? "Unable to load curricula"
                            : !formState.course
                              ? "Select course first"
                              : curricula.length === 0
                                ? "No active curricula"
                                : "Select curriculum"}
                      </option>
                      {!isLoadingCurricula &&
                        formState.curriculumId &&
                        !curricula.some(
                          (curriculum) =>
                            String(curriculum.curriculum_id) ===
                            formState.curriculumId,
                        ) && (
                          <option value={formState.curriculumId} disabled>
                            Previously assigned curriculum (no longer active)
                          </option>
                        )}
                      {curricula.map((curriculum) => (
                        <option
                          key={curriculum.curriculum_id}
                          value={curriculum.curriculum_id}
                        >
                          {curriculum.curriculum_name}
                        </option>
                      ))}
                    </select>
                  </div>
                </label>

                <label className="admin-edit-student__field">
                  <span>
                    Year Level <em>*</em>
                  </span>
                  <div className="admin-edit-student__select-with-icon">
                    <GraduationCap size={15} aria-hidden="true" />
                    <select
                      name="yearLevel"
                      value={formState.yearLevel}
                      onChange={handleInputChange}
                      disabled={isSaving}
                      required
                    >
                      {YEAR_LEVELS.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </div>
                </label>

                <label className="admin-edit-student__field">
                  <span>
                    Section <em>*</em>
                  </span>
                  <select
                    name="section"
                    value={formState.section}
                    onChange={handleInputChange}
                    required
                    disabled={isSaving || sectionOptions.length === 0}
                  >
                    <option value="">Select section</option>

                    {sectionOptions.map((section) => (
                      <option key={section} value={section}>
                        {section}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <footer className="admin-edit-student__actions">
              <button
                type="button"
                className="admin-edit-student__cancel"
                onClick={() => navigate(-1)}
                disabled={isSaving}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="admin-edit-student__save"
                disabled={isSaving || !authenticated || userRole !== "Admin"}
              >
                {isSaving ? (
                  <LoaderCircle
                    size={16}
                    className="admin-edit-student__spinner"
                    aria-hidden="true"
                  />
                ) : (
                  <Save size={16} aria-hidden="true" />
                )}

                {isSaving ? "Saving…" : "Save Changes"}
              </button>
            </footer>
          </form>
        )}

        {showSuccessDialog && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 2000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px",
              background: "rgba(10, 28, 17, 0.58)",
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-student-success-title"
              aria-describedby="edit-student-success-description"
              style={{
                width: "min(420px, 100%)",
                padding: "30px 26px 26px",
                borderRadius: "18px",
                border: "1px solid var(--aes-border, #dfe8e2)",
                background: "var(--aes-surface, #ffffff)",
                color: "var(--aes-text-950, #17201b)",
                textAlign: "center",
                boxShadow: "0 20px 65px rgba(0, 0, 0, 0.22)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "64px",
                  height: "64px",
                  margin: "0 auto 16px",
                  borderRadius: "50%",
                  background: "var(--aes-green-100, #dcf5e6)",
                  color: "var(--aes-green-700, #0f7a45)",
                }}
              >
                <CheckCircle2 size={36} aria-hidden="true" />
              </div>

              <h2
                id="edit-student-success-title"
                style={{
                  margin: "0 0 8px",
                  fontSize: "21px",
                  fontWeight: 750,
                }}
              >
                Student Updated Successfully!
              </h2>
              <p
                id="edit-student-success-description"
                style={{
                  margin: "0 0 22px",
                  fontSize: "13px",
                  lineHeight: 1.6,
                  color: "var(--aes-text-600, #5e6b63)",
                }}
              >
                The student information has been saved successfully. You can now
                view the updated profile.
              </p>

              <button
                type="button"
                autoFocus
                className="admin-edit-student__save"
                style={{ width: "100%", minHeight: "43px", fontSize: "13px" }}
                onClick={() =>
                  navigate(
                    `/admin/students/profile/${encodeURIComponent(studentNumber)}`,
                  )
                }
              >
                View Student Profile
              </button>
            </div>
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}
