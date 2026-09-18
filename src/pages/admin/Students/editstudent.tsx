import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { useNavigate, useParams } from "react-router-dom";

import "../../../styles/addeditdrop.css";

// =====================================================
// API
// =====================================================

const API_BASE_URL = "http://localhost:3000/api/students";

// =====================================================
// OPTIONS
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

  // ADDRESS
  houseNo?: string;
  street?: string;
  barangay?: string;
  city?: string;
  province?: string;
  zipCode?: string;

  // COURSE
  courseId?: number;
  course?: string;
  courseName?: string;

  // CURRICULUM
  studentCurriculumId?: number;

  curriculumId?: number | string | null;

  curriculumName?: string | null;

  curriculumStatus?: string | null;

  curriculumAssignedDate?: string | null;

  curriculumEffectiveYear?: number | null;

  curriculumTotalUnits?: number | null;

  curriculumIsActive?: boolean | number | null;

  // ACADEMIC
  yearLevel?: string;

  sectionId?: number;

  section?: string;

  semesterId?: number | string;

  semester?: string;

  academicYearId?: number;

  academicYear?: string;

  success?: boolean;

  message?: string;

  error?: string;

  data?: StudentResponse;

  student?: StudentResponse;
}

interface CurriculumOption {
  curriculum_id: number;

  curriculum_name: string;

  effective_year: number | null;

  total_units: number | null;

  is_active: boolean;
}

interface CurriculumResponse {
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
}

interface UpdateStudentResponse {
  success?: boolean;

  message?: string;

  error?: string;

  student?: {
    student_id?: number;

    student_number?: string;

    curriculum?: {
      student_curriculum_id?: number;

      curriculum_id?: number;

      curriculum_name?: string;

      effective_year?: number | null;

      status?: string;

      changed?: boolean;
    };
  };
}

// =====================================================
// HELPERS
// =====================================================

const yearLevelToDigit = (yearLevel: string): string => {
  const match = yearLevel.match(/^(\d+)/);

  return match ? match[1] : "";
};

// =====================================================
// GENERATE SECTION OPTIONS
//
// Example:
//
// BSIT + 1st Year
//
// BSIT-1A
// BSIT-1B
// ...
// BSIT-1Z
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
// EMPTY FORM
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

export default function EditStudent() {
  const navigate = useNavigate();

  const { id } = useParams<{
    id: string;
  }>();

  // =====================================================
  // AUTHENTICATION
  // =====================================================

  const user = authService.getSession();

  const token = authService.getToken();

  const userRole = user?.role;

  const authenticated = Boolean(user && token);

  // =====================================================
  // STUDENT STATE
  // =====================================================

  const [formState, setFormState] = useState(emptyForm);

  const [isLoading, setIsLoading] = useState(true);

  const [isSaving, setIsSaving] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // =====================================================
  // CURRICULUM STATE
  // =====================================================

  const [curricula, setCurricula] = useState<CurriculumOption[]>([]);

  const [isLoadingCurricula, setIsLoadingCurricula] = useState(false);

  const [curriculumError, setCurriculumError] = useState<string | null>(null);

  // =====================================================
  // SECTION OPTIONS
  // =====================================================

  const sectionOptions = useMemo(
    () => generateSectionOptions(formState.course, formState.yearLevel),

    [formState.course, formState.yearLevel],
  );

  // =====================================================
  // AUTHORIZATION
  // =====================================================

  useEffect(() => {
    // No session / JWT.

    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    // Authenticated but not Admin.

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
  // AUTH RESPONSE HELPER
  // =====================================================

  const handleAuthenticationResponse = (
    response: Response,

    data: {
      message?: string;

      error?: string;
    },
  ): boolean => {
    // JWT invalid / missing / expired.

    if (response.status === 401) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return false;
    }

    // Authenticated but not Admin.

    if (response.status === 403) {
      throw new Error(
        data.message || data.error || "Admin access is required.",
      );
    }

    return true;
  };

  // =====================================================
  // LOAD STUDENT
  // =====================================================

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

        // =================================================
        // AUTHENTICATED GET
        // =================================================

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

        // =================================================
        // SAFE RESPONSE
        // =================================================

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

        const data: StudentResponse = await response.json();

        // =================================================
        // AUTH
        // =================================================

        if (!handleAuthenticationResponse(response, data)) {
          return;
        }

        // =================================================
        // HTTP ERROR
        // =================================================

        if (!response.ok) {
          throw new Error(
            data.message ||
              data.error ||
              `Failed to load student (${response.status}).`,
          );
        }

        // =================================================
        // NORMALIZE RESPONSE
        //
        // Supports:
        //
        // { ...student }
        //
        // OR
        //
        // { student: {...} }
        //
        // OR
        //
        // { data: {...} }
        // =================================================

        const student = data.student ?? data.data ?? data;

        if (!student) {
          throw new Error("Student data was not returned by the server.");
        }

        // =================================================
        // POPULATE FORM
        // =================================================

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

          // ADDRESS

          houseNo: student.houseNo || "",

          street: student.street || "",

          barangay: student.barangay || "",

          city: student.city || "",

          province: student.province || "",

          zipCode: student.zipCode || "",

          // ACADEMIC

          course: student.course || "",

          // =============================================
          // CURRENT CURRICULUM FROM STEP 4
          // =============================================

          curriculumId:
            student.curriculumId !== null && student.curriculumId !== undefined
              ? String(student.curriculumId)
              : "",

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

  // =====================================================
  // LOAD CURRICULA WHEN COURSE CHANGES
  // =====================================================

  useEffect(() => {
    if (!authenticated || userRole !== "Admin") {
      return;
    }

    setCurriculumError(null);

    // No course yet.
    if (!formState.course) {
      setCurricula([]);

      return;
    }

    const selectedCourse = formState.course;

    const controller = new AbortController();

    const loadCurricula = async () => {
      try {
        setIsLoadingCurricula(true);

        setCurriculumError(null);

        const response = await authService.authFetch(
          `${API_BASE_URL}/curricula?course=${encodeURIComponent(
            selectedCourse,
          )}`,
          {
            method: "GET",

            signal: controller.signal,

            headers: {
              Accept: "application/json",
            },
          },
        );

        // =================================================
        // SAFE RESPONSE
        // =================================================

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

        // =================================================
        // AUTH RESPONSE
        // =================================================

        if (!handleAuthenticationResponse(response, data)) {
          return;
        }

        // =================================================
        // API ERROR
        // =================================================

        if (!response.ok || !data.success) {
          throw new Error(
            data.message || data.error || "Failed to load curricula.",
          );
        }

        // =================================================
        // OPTIONS
        // =================================================

        const loadedCurricula = Array.isArray(data.curricula)
          ? data.curricula
          : [];

        setCurricula(loadedCurricula);

        // =================================================
        // KEEP CURRENT CURRICULUM IF VALID
        //
        // This is important when initially opening
        // Edit Student.
        // =================================================

        setFormState((current) => {
          // User changed course while request was running.
          if (current.course !== selectedCourse) {
            return current;
          }

          const currentCurriculumStillValid = loadedCurricula.some(
            (curriculum) =>
              String(curriculum.curriculum_id) === String(current.curriculumId),
          );

          // Keep current assignment.
          if (currentCurriculumStillValid) {
            return current;
          }

          // If exactly one active curriculum exists,
          // auto-select it.
          if (loadedCurricula.length === 1) {
            return {
              ...current,

              curriculumId: String(loadedCurricula[0].curriculum_id),
            };
          }

          // Otherwise Admin must choose.
          return {
            ...current,

            curriculumId: "",
          };
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        console.error("LOAD EDIT STUDENT CURRICULA ERROR:", error);

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

    void loadCurricula();

    return () => {
      controller.abort();
    };
  }, [formState.course, authenticated, userRole]);

  // =====================================================
  // INPUT CHANGE
  // =====================================================

  const handleInputChange = (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = event.target;

    setFormState((current) => {
      const updated = {
        ...current,

        [name]: value,
      };

      // =================================================
      // COURSE CHANGED
      //
      // Curriculum MUST be selected again because it
      // belongs to the selected course.
      //
      // Section also belongs to the course.
      // =================================================

      if (name === "course") {
        updated.curriculumId = "";

        updated.section = "";
      }

      // =================================================
      // YEAR LEVEL CHANGED
      //
      // Existing section may not match new year level.
      // =================================================

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

  // =====================================================
  // SUBMIT
  // =====================================================

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setErrorMessage(null);

    // =================================================
    // AUTH CHECK
    // =================================================

    const currentUser = authService.getSession();

    const currentToken = authService.getToken();

    if (!currentUser || !currentToken) {
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

    // =================================================
    // STUDENT NUMBER
    // =================================================

    if (!id) {
      setErrorMessage("Student ID is missing.");

      return;
    }

    const studentNumber = id.trim();

    if (!studentNumber) {
      setErrorMessage("Invalid student ID.");

      return;
    }

    // =================================================
    // REQUIRED FIELDS
    // =================================================

    if (
      !formState.firstName.trim() ||
      !formState.lastName.trim() ||
      !formState.email.trim() ||
      !formState.course.trim() ||
      !formState.curriculumId ||
      !formState.yearLevel.trim() ||
      !formState.section.trim() ||
      !formState.semesterId
    ) {
      setErrorMessage(
        "Please fill in all required academic and personal fields.",
      );

      return;
    }

    // =================================================
    // CURRICULUM LOADING ERROR
    // =================================================

    if (curriculumError) {
      setErrorMessage("Please resolve the curriculum selection before saving.");

      return;
    }

    // =================================================
    // EMAIL
    // =================================================

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(formState.email.trim())) {
      setErrorMessage("Please enter a valid email address.");

      return;
    }

    // =================================================
    // YEAR LEVEL
    // =================================================

    const yearLevelNumber = Number(yearLevelToDigit(formState.yearLevel));

    if (!Number.isInteger(yearLevelNumber) || yearLevelNumber <= 0) {
      setErrorMessage("Invalid year level.");

      return;
    }

    // =================================================
    // CURRICULUM VALIDATION
    // =================================================

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

    // =================================================
    // SECTION
    // =================================================

    if (!sectionOptions.includes(formState.section)) {
      setErrorMessage("Please select a valid section.");

      return;
    }

    try {
      setIsSaving(true);

      // =================================================
      // PAYLOAD
      //
      // Actor/Admin user_id is NOT sent.
      //
      // Backend gets actor from req.user.
      // =================================================

      const payload = {
        firstName: formState.firstName.trim(),

        middleName: formState.middleName.trim(),

        lastName: formState.lastName.trim(),

        email: formState.email.trim(),

        gender: formState.gender || null,

        birthDate: formState.birthDate || null,

        contactNumber: formState.contactNumber.trim(),

        // ADDRESS

        houseNo: formState.houseNo.trim(),

        street: formState.street.trim(),

        barangay: formState.barangay.trim(),

        city: formState.city.trim(),

        province: formState.province.trim(),

        zipCode: formState.zipCode.trim(),

        // ACADEMIC

        course: formState.course,

        curriculumId: Number(formState.curriculumId),

        yearLevel: formState.yearLevel,

        section: formState.section,

        semesterId: Number(formState.semesterId),
      };

      console.log("UPDATE ADMIN STUDENT:", studentNumber, payload);

      // =================================================
      // AUTHENTICATED PUT
      // =================================================

      const response = await authService.authFetch(
        `${API_BASE_URL}/${encodeURIComponent(studentNumber)}`,
        {
          method: "PUT",

          headers: {
            Accept: "application/json",

            "Content-Type": "application/json",
          },

          body: JSON.stringify(payload),
        },
      );

      // =================================================
      // SAFE RESPONSE
      // =================================================

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

      const data: UpdateStudentResponse = await response.json();

      // =================================================
      // AUTH
      // =================================================

      if (!handleAuthenticationResponse(response, data)) {
        return;
      }

      // =================================================
      // ERROR
      // =================================================

      if (!response.ok || data.success === false) {
        throw new Error(
          data.message ||
            data.error ||
            `Failed to update student (${response.status}).`,
        );
      }

      // =================================================
      // SUCCESS
      // =================================================

      window.alert(data.message || "Student updated successfully.");

      navigate(`/admin/students/profile/${encodeURIComponent(studentNumber)}`);
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
      <div className="admin-editstudents-students-table">
        <h1>Edit Student</h1>

        {/* =================================================
            ERROR
        ================================================= */}

        {errorMessage && (
          <p className="admin-manage-students__error">{errorMessage}</p>
        )}

        {/* =================================================
            LOADING
        ================================================= */}

        {isLoading ? (
          <p>Loading student…</p>
        ) : (
          <form onSubmit={handleSubmit} className="admin-student-form">
            {/* =================================================
                PERSONAL INFORMATION
            ================================================= */}

            <label>
              First Name
              <input
                type="text"
                name="firstName"
                value={formState.firstName}
                onChange={handleInputChange}
                disabled={isSaving}
                required
              />
            </label>

            <label>
              Middle Name
              <input
                type="text"
                name="middleName"
                value={formState.middleName}
                onChange={handleInputChange}
                disabled={isSaving}
              />
            </label>

            <label>
              Last Name
              <input
                type="text"
                name="lastName"
                value={formState.lastName}
                onChange={handleInputChange}
                disabled={isSaving}
                required
              />
            </label>

            <label>
              Gender
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

            <label>
              Birth Date
              <input
                type="date"
                name="birthDate"
                value={formState.birthDate}
                onChange={handleInputChange}
                disabled={isSaving}
              />
            </label>

            <label>
              Contact Number
              <input
                type="tel"
                name="contactNumber"
                value={formState.contactNumber}
                onChange={handleInputChange}
                placeholder="e.g. 09171234567"
                disabled={isSaving}
              />
            </label>

            {/* =================================================
                ADDRESS
            ================================================= */}

            <label>
              House No.
              <input
                type="text"
                name="houseNo"
                value={formState.houseNo}
                onChange={handleInputChange}
                disabled={isSaving}
              />
            </label>

            <label>
              Street
              <input
                type="text"
                name="street"
                value={formState.street}
                onChange={handleInputChange}
                disabled={isSaving}
              />
            </label>

            <label>
              Barangay
              <input
                type="text"
                name="barangay"
                value={formState.barangay}
                onChange={handleInputChange}
                disabled={isSaving}
              />
            </label>

            <label>
              City
              <input
                type="text"
                name="city"
                value={formState.city}
                onChange={handleInputChange}
                disabled={isSaving}
              />
            </label>

            <label>
              Province
              <input
                type="text"
                name="province"
                value={formState.province}
                onChange={handleInputChange}
                disabled={isSaving}
              />
            </label>

            <label>
              ZIP Code
              <input
                type="text"
                name="zipCode"
                value={formState.zipCode}
                onChange={handleInputChange}
                disabled={isSaving}
              />
            </label>

            <label>
              Email
              <input
                type="email"
                name="email"
                value={formState.email}
                onChange={handleInputChange}
                disabled={isSaving}
                required
              />
            </label>

            {/* =================================================
                ACADEMIC INFORMATION
            ================================================= */}

            <label>
              Semester
              <select
                name="semesterId"
                value={formState.semesterId}
                onChange={handleInputChange}
                disabled={isSaving}
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
            ================================================= */}

            <label>
              Course
              <select
                name="course"
                value={formState.course}
                onChange={handleInputChange}
                disabled={isSaving}
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
            ================================================= */}

            <label>
              Curriculum
              <select
                name="curriculumId"
                value={formState.curriculumId}
                onChange={handleInputChange}
                required
                disabled={isSaving || isLoadingCurricula || !formState.course}
              >
                <option value="">
                  {isLoadingCurricula
                    ? "Loading curricula..."
                    : !formState.course
                      ? "Select course first"
                      : curricula.length === 0
                        ? "No active curriculum available"
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
            ================================================= */}

            <label>
              Year Level
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
            </label>

            {/* =================================================
                SECTION
            ================================================= */}

            <label>
              Section
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

            {/* =================================================
                ACTIONS
            ================================================= */}

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
                  isLoadingCurricula ||
                  !authenticated ||
                  userRole !== "Admin" ||
                  !formState.curriculumId
                }
              >
                {isSaving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </form>
        )}
      </div>
    </DashboardLayout>
  );
}
