import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/studentsForSetup.css";

type SetupStudent = {
  studentId: number;
  id: string;
  userId: number | null;

  firstName: string;
  middleName: string | null;
  lastName: string;

  email: string;
  gender: string | null;
  birthDate: string | null;
  contactNumber: string | null;

  course: string;
  yearLevel: string;
  section: string;

  semesterId: number | null;
  semester: string | null;

  houseNo?: string;
  street?: string;
  barangay?: string;
  city?: string;
  province?: string;
  zipCode?: string;
};

type SetupSemester = {
  semester_id: number;
  semester_name: string;
};

export default function ManageStudentSetup() {
  const { studentNumber } = useParams<{
    studentNumber: string;
  }>();

  const navigate = useNavigate();

  const [student, setStudent] =
    useState<SetupStudent | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

const [semesters, setSemesters] = useState<SetupSemester[]>([]);

const [selectedSemester, setSelectedSemester] =
  useState<string>("");

const [semesterLoading, setSemesterLoading] =
  useState(false);

const [semesterSaving, setSemesterSaving] =
  useState(false);

const [semesterError, setSemesterError] =
  useState<string | null>(null);

    const [sections, setSections] = useState<
  { section_id: number; section_name: string }[]
>([]);

const [selectedSection, setSelectedSection] =
  useState("");

const [sectionLoading, setSectionLoading] =
  useState(false);

const [sectionError, setSectionError] =
  useState<string | null>(null);

    const [creatingAccount, setCreatingAccount] =
  useState(false);

const [accountMessage, setAccountMessage] =
  useState<string | null>(null);

useEffect(() => {
  const user = authService.getSession();

  if (!user || user.role !== "Admin") {
    navigate("/login");
    return;
  }

// =====================================================
// MANAGE STUDENT - INITIAL SETUP DATA LOAD
// Loads both the student information and available semesters
// Replace the existing loadStudent call in the useEffect
// =====================================================

if (!studentNumber) {
  setError("Student number is missing.");
  setLoading(false);
  return;
}

loadStudent(studentNumber);
loadSemesters(studentNumber);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [studentNumber, navigate]);

  

  async function handleCreateAccount() {
  if (!student) {
    return;
  }

  try {
    setCreatingAccount(true);
    setAccountMessage(null);
    setError(null);

    const response = await fetch(
      `http://localhost:3000/api/students/${encodeURIComponent(
        student.id
      )}/setup/account`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

    const data = await response.json();

    console.log(
      "CREATE ACCOUNT RESPONSE:",
      data
    );

    if (!response.ok) {
      throw new Error(
        data.message ||
        data.error ||
        "Failed to create student account."
      );
    }

    setAccountMessage(
      `Account created successfully. Username: ${data.account.username}`
    );

    // Reload student so userId changes from NULL
    // to the newly created user ID.
    await loadStudent(student.id);

  } catch (err) {

    console.error(
      "Create account error:",
      err
    );

    setError(
      err instanceof Error
        ? err.message
        : "Failed to create student account."
    );

  } finally {

    setCreatingAccount(false);

  }
}

async function loadStudent(studentNumber: string) {
  try {
    setLoading(true);
    setError(null);

    const response = await fetch(
      `http://localhost:3000/api/students/${encodeURIComponent(
        studentNumber
      )}`
    );

    const data = await response.json();

    console.log("MANAGE STUDENT API RESPONSE:", data);

    if (!response.ok) {
      throw new Error(
        data.error ||
          data.message ||
          "Failed to load student."
      );
    }

    // The response is the student object directly
    if (!data || !data.id) {
      throw new Error(
        "Student data is missing or invalid."
      );
    }

    setStudent(data);

    await loadSections(data.id);
  } catch (err) {
    console.error("Load student error:", err);

    setError(
      err instanceof Error
        ? err.message
        : "Failed to load student."
    );
  } finally {
    setLoading(false);
  }
}
// =====================================================
// MANAGE STUDENT - LOAD AVAILABLE SEMESTERS
// Fetches semesters from the backend for the dropdown
// Add this after the existing loadStudent function
// =====================================================
async function loadSemesters(studentNumber: string) {
  try {
    setSemesterLoading(true);
    setSemesterError(null);

    const response = await fetch(
      `http://localhost:3000/api/students/${studentNumber}/setup/semesters`
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message ||
        data.error ||
        "Failed to load semesters."
      );
    }

    setSemesters(data.semesters ?? []);
  } catch (err) {
    console.error("Load semesters error:", err);

    setSemesterError(
      err instanceof Error
        ? err.message
        : "Failed to load semesters."
    );
  } finally {
    setSemesterLoading(false);
  }
}

// =====================================================
// MANAGE STUDENT - SAVE SEMESTER
// Sends the selected semester to the backend
// Add this directly after loadSemesters()
// =====================================================

async function handleAssignSemester() {
  if (!studentNumber) {
    setSemesterError("Student number is missing.");
    return;
  }

  if (!selectedSemester) {
    setSemesterError("Please select a semester.");
    return;
  }

  try {
    setSemesterSaving(true);
    setSemesterError(null);

    const response = await fetch(
      `http://localhost:3000/api/students/${studentNumber}/setup/semester`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          semester_id: Number(selectedSemester),
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message ||
        data.error ||
        "Failed to assign semester."
      );
    }

    // Refresh student information so the new
    // semester appears immediately.
    await loadStudent(studentNumber);

    setSelectedSemester("");
  } catch (err) {
    console.error("Assign semester error:", err);

    setSemesterError(
      err instanceof Error
        ? err.message
        : "Failed to assign semester."
    );
  } finally {
    setSemesterSaving(false);
  }
}

async function loadSections(studentNumber: string) {
  try {
    setSectionLoading(true);
    setSectionError(null);

    const response = await fetch(
      `http://localhost:3000/api/students/${encodeURIComponent(
        studentNumber
      )}/setup/sections`
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message || "Failed to load sections."
      );
    }

    setSections(data.sections ?? []);
  } catch (err) {
    console.error("Load sections error:", err);

    setSectionError(
      err instanceof Error
        ? err.message
        : "Failed to load sections."
    );
  } finally {
    setSectionLoading(false);
  }
}

async function handleAssignSection() {
  if (!student || !selectedSection) {
    return;
  }

  try {
    setSectionLoading(true);
    setSectionError(null);

    const response = await fetch(
      `http://localhost:3000/api/students/${student.id}/setup/section`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          section_id: Number(selectedSection),
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message || "Failed to assign section."
      );
    }

    // Update the displayed student immediately
    setStudent((current) =>
      current
        ? {
            ...current,
            semesterId: data.section.section_id,
            section: data.section.section_name,
          }
        : current
    );

    setSelectedSection("");

  } catch (err) {
    console.error("Assign section error:", err);

    setSectionError(
      err instanceof Error
        ? err.message
        : "Failed to assign section."
    );
  } finally {
    setSectionLoading(false);
  }
}

  if (loading) {
    return (
      <DashboardLayout>
        <div className="manage-student-page">
          <div className="students-setup-loading">
            Loading student...
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (error) {
    return (
      <DashboardLayout>
        <div className="manage-student-page">
          <div className="students-setup-error">
            {error}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!student) {
    return (
      <DashboardLayout>
        <div className="manage-student-page">
          <div className="students-setup-error">
            Student information could not be loaded.
          </div>
        </div>
      </DashboardLayout>
    );


  }

  return (
  <DashboardLayout>
    <div className="manage-student-page">

      <button
        type="button"
        className="manage-student-back-button"
        onClick={() => navigate("/admin/students/setup")}
      >
        ← Back to Students for Setup
      </button>
        {/* =========================
            HEADER
        ========================== */}

        <div className="manage-student-header">

          <div className="student-identity">

            <span>MANAGE STUDENT</span>

            <h1>
              {student.firstName}{" "}
              {student.middleName
                ? `${student.middleName} `
                : ""}
              {student.lastName}
            </h1>

            <p>
              {student.id}
            </p>

          </div>

          <div className="student-summary">

            <div className="summary-item">

              <span>PROGRAM</span>

              <strong>
                {student.course || "N/A"}
              </strong>

            </div>

            <div className="summary-item">

              <span>YEAR</span>

              <strong>
                {student.yearLevel}
              </strong>

            </div>

            <div className="summary-item">

              <span>ACADEMIC YEAR</span>

              <strong>
                N/A
              </strong>

            </div>

          </div>

        </div>

        {/* =========================
            STUDENT INFORMATION
        ========================== */}

        <div className="manage-student-content">

          <h2>Student Setup</h2>

          <p>
            This student was approved but still
            needs account, section, and semester
            setup.
          </p>

          <div>
            <strong>Student ID:</strong>{" "}
            {student.id}
          </div>

          <div>
            <strong>Name:</strong>{" "}
            {student.firstName}{" "}
            {student.middleName
              ? `${student.middleName} `
              : ""}
            {student.lastName}
          </div>

          <div>
            <strong>Program:</strong>{" "}
            {student.course || "N/A"}
          </div>

          <div>
            <strong>Year:</strong>{" "}
            {student.yearLevel}
          </div>

          <div>
            <strong>Section:</strong>{" "}
            {student.section ||
              "Not Assigned"}
          </div>

          {!student.semesterId && (
  <div className="setup-section-control">

    <label htmlFor="section">
      Assign Section
    </label>

    <select
      id="section"
      value={selectedSection}
      onChange={(e) =>
        setSelectedSection(e.target.value)
      }
      disabled={sectionLoading}
    >
      <option value="">
        Select a section
      </option>

      {sections.map((section) => (
        <option
          key={section.section_id}
          value={section.section_id}
        >
          {section.section_name}
        </option>
      ))}
    </select>

    <button
      type="button"
      onClick={handleAssignSection}
      disabled={
        !selectedSection ||
        sectionLoading
      }
    >
      {sectionLoading
        ? "Assigning..."
        : "Assign Section"}
    </button>

    {sectionError && (
      <p className="students-setup-error">
        {sectionError}
      </p>
    )}

  </div>
)}

<div className="setup-card">

  <h3>Student Account</h3>
  {student.userId ? (
    <div className="setup-complete">

      <strong>Account Created</strong>

      <p>
        Username:{" "}
        {student.id}
      </p>

      <p>
        Student account is already linked.
      </p>

    </div>
    
  ) : (
    <div className="setup-required">

      <p>
        This student does not have an account yet.
      </p>

      <p>
        Username:
        <strong>
          {" "}
          {student.id}
        </strong>
      </p>

      <p>
        Temporary password:
        <strong>
          {" "}
          PTC12345
        </strong>
      </p>

      <button
        type="button"
        className="setup-action-button"
        onClick={handleCreateAccount}
        disabled={creatingAccount}
      >
        {creatingAccount
          ? "Creating Account..."
          : "Create Student Account"}
      </button>

    </div>
  )}

  {accountMessage && (
    <div className="setup-success">
      {accountMessage}
    </div>
  )}

</div>

<div className="setup-field">

  <strong>Semester:</strong>

  {student.semester ? (
    <div className="setup-current-value">
      {student.semester}
    </div>
  ) : (
    <>
      {semesterLoading ? (
        <p>Loading semesters...</p>
      ) : (
        <>
          <select
            value={selectedSemester}
            onChange={(event) =>
              setSelectedSemester(event.target.value)
            }
            disabled={semesterSaving}
          >
            <option value="">
              Select Semester
            </option>

            {semesters.map((semester) => (
              <option
                key={semester.semester_id}
                value={semester.semester_id}
              >
                {semester.semester_name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleAssignSemester}
            disabled={
              semesterSaving ||
              !selectedSemester
            }
          >
            {semesterSaving
              ? "Assigning..."
              : "Assign Semester"}
          </button>
        </>
      )}

      {semesterError && (
        <div className="students-setup-error">
          {semesterError}
        </div>
      )}
    </>
  )}

</div>

        </div>

      </div>
    </DashboardLayout>
  );
}