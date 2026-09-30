import {
  useMemo,
  useState,
  useEffect,
  type ChangeEvent,
  type FormEvent,
} from "react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import { useNavigate } from "react-router-dom";

import "../../../styles/addeditdrop.css";

// =====================================================
// API
// =====================================================

const API_BASE_URL = apiUrl("/api/students");

// =====================================================
// STATIC OPTIONS
// =====================================================

const COURSES = ["BSIT", "BSCS", "BSA"] as const;

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

// =====================================================
// TYPES
// =====================================================

type CurriculumOption = {
  curriculum_id: number;
  curriculum_name: string;
  effective_year: number | null;
  total_units: number | null;
  is_active: boolean;
};

type CurriculumResponse = {
  success: boolean;

  course?: {
    course_id: number;
    course_code: string;
    course_name: string;
    total_years: number;
  };

  count?: number;

  curricula?: CurriculumOption[];

  message?: string;
  error?: string;
};

type CreateStudentResponse = {
  success?: boolean;

  message?: string;
  error?: string;

  studentId?: number;

  studentNumber?: string;

  temporaryPassword?: string;

  student?: {
    student_id: number;
    student_number: string;

    name: string;
    email: string;

    course: {
      course_id: number;
      course_code: string;
      course_name: string;
    };

    curriculum: {
      student_curriculum_id: number;
      curriculum_id: number;
      curriculum_name: string;
      effective_year: number | null;
      status: string;
    };

    academic_year: {
      academic_year_id: number;
      academic_year: string;
    };

    semester: {
      semester_id: number;
      semester_name: string;
    };

    year_level: number;

    section: {
      section_id: number;
      section_name: string;
    };
  };
};

// =====================================================
// YEAR LEVEL HELPER
// =====================================================

const yearLevelToDigit = (yearLevel: string): string => {
  const match = yearLevel.match(/^(\d+)/);

  return match ? match[1] : "";
};

// =====================================================
// SECTION OPTIONS
// =====================================================

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

// =====================================================
// FORM STATE
// =====================================================

const emptyForm = {
  firstName: "",
  middleName: "",
  lastName: "",

  email: "",

  gender: "",
  birthDate: "",
  contactNumber: "",

  // ADDRESS
  houseNo: "",
  street: "",
  barangay: "",
  city: "",
  province: "",
  zipCode: "",

  // ACADEMIC
  course: "",
  curriculumId: "",

  yearLevel: "1st Year",

  section: "",

  semesterId: "1",
};

// =====================================================
// COMPONENT
// =====================================================

export default function CreateStudent() {
  const navigate = useNavigate();

  // ===================================================
  // AUTHENTICATION
  // ===================================================

  const user = authService.getSession();

  const token = authService.getToken();

  const userRole = user?.role;

  const authenticated = Boolean(user && token);

  // ===================================================
  // FORM STATE
  // ===================================================

  const [formState, setFormState] = useState(emptyForm);

  const [isSaving, setIsSaving] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [createdStudent, setCreatedStudent] = useState<{
    studentNumber: string;
    temporaryPassword: string;
  } | null>(null);

  // ===================================================
  // CURRICULA
  // ===================================================

  const [curricula, setCurricula] = useState<CurriculumOption[]>([]);

  const [isLoadingCurricula, setIsLoadingCurricula] = useState(false);

  const [curriculumError, setCurriculumError] = useState<string | null>(null);

  // ===================================================
  // SECTION OPTIONS
  // ===================================================

  const sectionOptions = useMemo(
    () => generateSectionOptions(formState.course, formState.yearLevel),

    [formState.course, formState.yearLevel],
  );

  // ===================================================
  // AUTHORIZATION
  // ===================================================

  useEffect(() => {
    // ===============================================
    // NO SESSION OR NO JWT
    // ===============================================

    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    // ===============================================
    // LOGGED IN BUT NOT ADMIN
    // ===============================================

    if (userRole !== "Admin") {
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

  // ===================================================
  // HANDLE AUTHENTICATION RESPONSE
  // ===================================================

  const handleAuthenticationResponse = (
    response: Response,
    data: {
      message?: string;
      error?: string;
    },
  ): boolean => {
    // ===============================================
    // 401
    // Missing / expired / invalid JWT
    // ===============================================

    if (response.status === 401) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return false;
    }

    // ===============================================
    // 403
    // Authenticated but wrong role
    // ===============================================

    if (response.status === 403) {
      throw new Error(
        data.message || data.error || "Admin access is required.",
      );
    }

    return true;
  };

  // ===================================================
  // LOAD CURRICULA WHEN COURSE CHANGES
  // ===================================================

  useEffect(() => {
    // Don't call protected API
    // if user isn't authenticated Admin.

    if (!authenticated || userRole !== "Admin") {
      return;
    }

    // Clear previous course curricula.

    setCurricula([]);

    setCurriculumError(null);

    if (!formState.course) {
      return;
    }

    const controller = new AbortController();

    const loadCurricula = async () => {
      try {
        setIsLoadingCurricula(true);

        const url = `${API_BASE_URL}/curricula?course=${encodeURIComponent(
          formState.course,
        )}`;

        // ===========================================
        // AUTHENTICATED REQUEST
        //
        // authFetch automatically adds:
        //
        // Authorization: Bearer <JWT>
        // ===========================================

        const response = await authService.authFetch(url, {
          method: "GET",

          signal: controller.signal,

          headers: {
            Accept: "application/json",
          },
        });

        // ===========================================
        // RESPONSE TYPE
        // ===========================================

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

        const data: CurriculumResponse = await response.json();

        // ===========================================
        // AUTH RESPONSE
        // ===========================================

        if (!handleAuthenticationResponse(response, data)) {
          return;
        }

        // ===========================================
        // API ERROR
        // ===========================================

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || data.error || "Failed to load curricula.",
          );
        }

        // ===========================================
        // CURRICULA
        // ===========================================

        const loadedCurricula = Array.isArray(data.curricula)
          ? data.curricula
          : [];

        setCurricula(loadedCurricula);

        // ===========================================
        // AUTO SELECT IF ONLY ONE
        // ===========================================

        if (loadedCurricula.length === 1) {
          setFormState((current) => ({
            ...current,

            curriculumId: String(loadedCurricula[0].curriculum_id),
          }));
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        console.error("LOAD CURRICULA ERROR:", error);

        setCurricula([]);

        setCurriculumError(
          error instanceof Error ? error.message : "Failed to load curricula.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingCurricula(false);
        }
      }
    };

    loadCurricula();

    return () => {
      controller.abort();
    };
  }, [formState.course, authenticated, userRole]);

  // ===================================================
  // BLOCK UI FOR UNAUTHORIZED USER
  // ===================================================

  if (!authenticated || userRole !== "Admin") {
    return null;
  }

  // ===================================================
  // INPUT CHANGE
  // ===================================================

  const handleInputChange = (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = event.target;

    setFormState((current) => {
      const updated = {
        ...current,

        [name]: value,
      };

      // =============================================
      // COURSE CHANGED
      // =============================================

      if (name === "course") {
        // Curriculum belongs to course.
        updated.curriculumId = "";

        // Section belongs to course.
        updated.section = "";
      }

      // =============================================
      // YEAR LEVEL CHANGED
      // =============================================

      if (name === "yearLevel") {
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

  // ===================================================
  // SUBMIT
  // ===================================================

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // ===============================================
    // AUTH CHECK AGAIN BEFORE WRITE
    // ===============================================

    const currentToken = authService.getToken();

    const currentUser = authService.getSession();

    if (!currentToken || !currentUser) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    if (currentUser.role !== "Admin") {
      setErrorMessage("Admin access is required.");

      return;
    }

    // ===============================================
    // REQUIRED FIELDS
    // ===============================================

    if (
      !formState.firstName.trim() ||
      !formState.lastName.trim() ||
      !formState.email.trim() ||
      !formState.course.trim() ||
      !formState.curriculumId ||
      !formState.yearLevel.trim() ||
      !formState.section.trim() ||
      !formState.semesterId ||
      !formState.houseNo.trim() ||
      !formState.street.trim() ||
      !formState.barangay.trim() ||
      !formState.city.trim() ||
      !formState.province.trim()
    ) {
      setErrorMessage("Please fill in all required fields.");

      return;
    }

    // ===============================================
    // CURRICULUM LOAD ERROR
    // ===============================================

    if (curriculumError) {
      setErrorMessage(
        "Please resolve the curriculum selection before creating the student.",
      );

      return;
    }

    // ===============================================
    // VALIDATE CURRICULUM FROM CURRENT OPTIONS
    // ===============================================

    const selectedCurriculum = curricula.find(
      (curriculum) =>
        Number(curriculum.curriculum_id) === Number(formState.curriculumId),
    );

    if (!selectedCurriculum) {
      setErrorMessage(
        "Please select a valid curriculum for the selected course.",
      );

      return;
    }

    // ===============================================
    // START REQUEST
    // ===============================================

    setIsSaving(true);

    setErrorMessage(null);

    try {
      // =============================================
      // PAYLOAD
      // =============================================

      const payload = {
        ...formState,

        // Send numeric IDs cleanly.
        curriculumId: Number(formState.curriculumId),

        semesterId: Number(formState.semesterId),
      };

      // =============================================
      // AUTHENTICATED POST
      //
      // Automatically sends:
      //
      // Authorization: Bearer <JWT>
      // =============================================

      const response = await authService.authFetch(API_BASE_URL, {
        method: "POST",

        headers: {
          Accept: "application/json",

          "Content-Type": "application/json",
        },

        body: JSON.stringify(payload),
      });

      // =============================================
      // CHECK RESPONSE TYPE
      // =============================================

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

      const data: CreateStudentResponse = await response.json();

      // =============================================
      // AUTH RESPONSE
      // =============================================

      if (!handleAuthenticationResponse(response, data)) {
        return;
      }

      // =============================================
      // API ERROR
      // =============================================

      if (!response.ok) {
        throw new Error(data.message || data.error || "Failed to add student.");
      }

      // =============================================
      // VERIFY RESPONSE
      // =============================================

      if (!data.studentNumber || !data.temporaryPassword) {
        throw new Error(
          "Student was created but the server did not return the expected account credentials.",
        );
      }

      // =============================================
      // SUCCESS
      // =============================================

      setCreatedStudent({
        studentNumber: data.studentNumber,

        temporaryPassword: data.temporaryPassword,
      });

      setFormState(emptyForm);

      setCurricula([]);

      setCurriculumError(null);
    } catch (error) {
      console.error("CREATE STUDENT ERROR:", error);

      setErrorMessage(
        error instanceof Error ? error.message : "Failed to add student.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  // ===================================================
  // UI
  // ===================================================

  return (
    <DashboardLayout>
      <div className="admin-createstudents-students">
        <h1>Create Student</h1>

        {/* =================================================
            ERROR
        ================================================== */}

        {errorMessage && (
          <p className="admin-manage-students__error">{errorMessage}</p>
        )}

        {/* =================================================
            SUCCESS
        ================================================== */}

        {createdStudent && (
          <div className="admin-success-box">
            <h3>✅ Student Created Successfully</h3>

            <p>
              <strong>Student Number:</strong> {createdStudent.studentNumber}
            </p>

            <p>
              <strong>Username:</strong> {createdStudent.studentNumber}
            </p>

            <p>
              <strong>Temporary Password:</strong>{" "}
              {createdStudent.temporaryPassword}
            </p>

            <div className="admin-student-form__actions">
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  await navigator.clipboard.writeText(
                    `Username: ${createdStudent.studentNumber}
Password: ${createdStudent.temporaryPassword}`,
                  );

                  alert("Credentials copied.");
                }}
              >
                Copy Credentials
              </button>

              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate("/admin/students/addeditdrop")}
              >
                Back to Student List
              </button>
            </div>
          </div>
        )}

        {/* =================================================
            FORM
        ================================================== */}

        <form onSubmit={handleSubmit} className="admin-student-form">
          {/* =================================================
              FIRST NAME
          ================================================== */}

          <label>
            First Name
            <input
              type="text"
              name="firstName"
              value={formState.firstName}
              onChange={handleInputChange}
              required
            />
          </label>

          {/* =================================================
              MIDDLE NAME
          ================================================== */}

          <label>
            Middle Name
            <input
              type="text"
              name="middleName"
              value={formState.middleName}
              onChange={handleInputChange}
            />
          </label>

          {/* =================================================
              LAST NAME
          ================================================== */}

          <label>
            Last Name
            <input
              type="text"
              name="lastName"
              value={formState.lastName}
              onChange={handleInputChange}
              required
            />
          </label>

          {/* =================================================
              GENDER
          ================================================== */}

          <label>
            Gender
            <select
              name="gender"
              value={formState.gender}
              onChange={handleInputChange}
            >
              <option value="">Select gender</option>

              {GENDERS.map((gender) => (
                <option key={gender} value={gender}>
                  {gender}
                </option>
              ))}
            </select>
          </label>

          {/* =================================================
              BIRTH DATE
          ================================================== */}

          <label>
            Birth Date
            <input
              type="date"
              name="birthDate"
              value={formState.birthDate}
              onChange={handleInputChange}
            />
          </label>

          {/* =================================================
              CONTACT
          ================================================== */}

          <label>
            Contact Number
            <input
              type="tel"
              name="contactNumber"
              value={formState.contactNumber}
              onChange={handleInputChange}
              placeholder="e.g. 09171234567"
            />
          </label>

          {/* =================================================
              ADDRESS
          ================================================== */}

          <label>
            House No.
            <input
              type="text"
              name="houseNo"
              value={formState.houseNo}
              onChange={handleInputChange}
              required
            />
          </label>

          <label>
            Street
            <input
              type="text"
              name="street"
              value={formState.street}
              onChange={handleInputChange}
              required
            />
          </label>

          <label>
            Barangay
            <input
              type="text"
              name="barangay"
              value={formState.barangay}
              onChange={handleInputChange}
              required
            />
          </label>

          <label>
            City
            <input
              type="text"
              name="city"
              value={formState.city}
              onChange={handleInputChange}
              required
            />
          </label>

          <label>
            Province
            <input
              type="text"
              name="province"
              value={formState.province}
              onChange={handleInputChange}
              required
            />
          </label>

          <label>
            ZIP Code
            <input
              type="text"
              name="zipCode"
              value={formState.zipCode}
              onChange={handleInputChange}
            />
          </label>

          {/* =================================================
              EMAIL
          ================================================== */}

          <label>
            Email
            <input
              type="email"
              name="email"
              value={formState.email}
              onChange={handleInputChange}
              required
            />
          </label>

          {/* =================================================
              SEMESTER
          ================================================== */}

          <label>
            Semester
            <select
              name="semesterId"
              value={formState.semesterId}
              onChange={handleInputChange}
              required
            >
              {SEMESTERS.map((semester) => (
                <option key={semester.id} value={semester.id}>
                  {semester.label}
                </option>
              ))}
            </select>
          </label>

          {/* =================================================
              COURSE
          ================================================== */}

          <label>
            Course
            <select
              name="course"
              value={formState.course}
              onChange={handleInputChange}
              required
            >
              <option value="">Select course</option>

              {COURSES.map((course) => (
                <option key={course} value={course}>
                  {course}
                </option>
              ))}
            </select>
          </label>

          {/* =================================================
              CURRICULUM
          ================================================== */}

          <label>
            Curriculum
            <select
              name="curriculumId"
              value={formState.curriculumId}
              onChange={handleInputChange}
              required
              disabled={!formState.course || isLoadingCurricula}
            >
              <option value="">
                {isLoadingCurricula
                  ? "Loading curricula..."
                  : !formState.course
                    ? "Select course first"
                    : curricula.length === 0
                      ? "No curriculum available"
                      : "Select curriculum"}
              </option>

              {curricula.map((curriculum) => (
                <option
                  key={curriculum.curriculum_id}
                  value={curriculum.curriculum_id}
                >
                  {curriculum.curriculum_name}

                  {curriculum.effective_year
                    ? ` (${curriculum.effective_year})`
                    : ""}
                </option>
              ))}
            </select>
            {curriculumError && (
              <small className="admin-manage-students__error">
                {curriculumError}
              </small>
            )}
          </label>

          {/* =================================================
              YEAR LEVEL
          ================================================== */}

          <label>
            Year Level
            <select
              name="yearLevel"
              value={formState.yearLevel}
              onChange={handleInputChange}
              required
            >
              {YEAR_LEVELS.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>

          {/* =================================================
              SECTION
          ================================================== */}

          <label>
            Section
            <select
              name="section"
              value={formState.section}
              onChange={handleInputChange}
              required
              disabled={sectionOptions.length === 0}
            >
              <option value="">Select section</option>

              {sectionOptions.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
          </label>

          {/* =================================================
              ACTIONS
          ================================================== */}

          <div className="admin-student-form__actions">
            <button
              type="button"
              className="btn"
              onClick={() => navigate(-1)}
              disabled={isSaving}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                isSaving ||
                !!createdStudent ||
                isLoadingCurricula ||
                !formState.curriculumId
              }
            >
              {isSaving ? "Saving..." : "Add Student"}
            </button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
