import DashboardLayout from "../../components/Layout/DashboardLayout";
import { authService } from "../../services/auth.service";
import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Camera, LoaderCircle, ShieldCheck, Trash2, UserRound } from "lucide-react";
import type { StudentProfile } from "../../types/studentProfile";
import "../styles/Profile.css";

type StudentStatus = "Active" | "Inactive" | "Graduated" | "Dropped" | "Suspended" | "On Leave";

type Student = {
  studentNumber: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  gender?: string;
  birthDate?: string;
  course?: string;
  yearLevel?: string;
  section?: string;
  semester?: string;
  contactNumber?: string;
  email?: string;
  houseNo?: string;
  street?: string;
  barangay?: string;
  city?: string;
  province?: string;
  zipCode?: string;
  address?: string;
  enrollmentStatus?: string;
  studentStatus?: StudentStatus;
  guardianName?: string;
  guardianRelationship?: string;
  guardianContact?: string;
  avatar?: string | null;
};

const STUDENT_STORAGE_KEY = "student_profile";
const API_BASE_URL = "http://localhost:3000";

export default function StudentProfile() {
  const navigate = useNavigate();
  const user = authService.getSession();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const safeUser = user ?? {
    user_id: 0,
    username: "Student",
    email: "",
    role: "Student" as const,
    role_id: 0,
  };

  useEffect(() => {
    if (!user || user.role !== "Student") {
      navigate("/login");
    }
  }, [navigate, user]);

  const buildFallbackStudent = (): Student => ({
    studentNumber: String(safeUser.role_id ?? "000000"),
    firstName: safeUser.username ?? "Student",
    middleName: "",
    lastName: "",
    gender: "",
    birthDate: "",
    course: "",
    yearLevel: "",
    section: "",
    semester: "",
    contactNumber: "",
    email: safeUser.email ?? "",
    houseNo: "",
    street: "",
    barangay: "",
    city: "",
    province: "",
    zipCode: "",
    address: "",
    enrollmentStatus: "Active",
    studentStatus: "Active",
    guardianName: "",
    guardianRelationship: "",
    guardianContact: "",
    avatar: null,
  });

  const loadStored = (): Student => {
    try {
      const raw = localStorage.getItem(STUDENT_STORAGE_KEY);
      if (!raw) return buildFallbackStudent();

      const parsed = JSON.parse(raw) as Partial<Student>;
      return { ...buildFallbackStudent(), ...parsed };
    } catch {
      return buildFallbackStudent();
    }
  };

  const [student, setStudent] = useState<Student>(() => loadStored());
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const mapProfileResponse = (profile: StudentProfile): Student => {
    const addressParts = [profile.address].filter(Boolean);

    return {
      studentNumber: profile.studentNumber || profile.studentId?.toString() || "",
      firstName: profile.firstName || "",
      middleName: profile.middleName || "",
      lastName: profile.lastName || "",
      gender: profile.gender || "",
      birthDate: profile.birthDate || "",
      course: profile.course || "",
      yearLevel: profile.yearLevel || "",
      section: profile.section || "",
      semester: "",
      contactNumber: profile.phoneNumber || "",
      email: profile.email || "",
      address: addressParts.join(", ") || "",
      enrollmentStatus: profile.enrollmentStatus || "",
      studentStatus: (profile.enrollmentStatus === "Active" ? "Active" : "Inactive") as StudentStatus,
      guardianName: profile.guardianName || "",
      guardianRelationship: profile.guardianRelationship || "",
      guardianContact: profile.guardianContact || "",
      avatar: profile.photo || null,
    };
  };

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) {
        return;
      }


      try {
        const response = await fetch(`${API_BASE_URL}/api/profile/${encodeURIComponent(String(user.user_id))}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.message || "Unable to load your profile.");
        }

        const profile = data?.data as StudentProfile | undefined;
        if (profile) {
          const mappedStudent = mapProfileResponse(profile);
          const mergedStudent = { ...buildFallbackStudent(), ...mappedStudent };
          setStudent(mergedStudent);
          localStorage.setItem(STUDENT_STORAGE_KEY, JSON.stringify(mergedStudent));
        }
      } catch (error) {
        setFeedback({
          type: "error",
          message: error instanceof Error ? error.message : "Unable to load your profile.",
        });
      } finally {
      }
    };

    loadProfile();
  }, [user]);

  useEffect(() => {
    if (!selectedPhoto) {
      setPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedPhoto);
    setPreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedPhoto]);

  const getStatusClass = (status?: StudentStatus) => {
    switch (status) {
      case "Active":
        return "status-pill active";
      case "Inactive":
        return "status-pill inactive";
      case "Graduated":
        return "status-pill graduated";
      case "Dropped":
        return "status-pill dropped";
      case "Suspended":
        return "status-pill suspended";
      case "On Leave":
        return "status-pill leave";
      default:
        return "status-pill active";
    }
  };

  const handlePhotoSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) return;

    const isValidType = /image\/(jpeg|jpg|png|webp)$/i.test(file.type);
    const isValidSize = file.size <= 5 * 1024 * 1024;

    if (!isValidType || !isValidSize) {
      setFeedback({
        type: "error",
        message: "Please choose a JPG, JPEG, PNG, or WEBP image under 5 MB.",
      });
      event.target.value = "";
      return;
    }

    setSelectedPhoto(file);
    setFeedback(null);
  };

  const persistStudent = (updatedStudent: Student) => {
    setStudent(updatedStudent);
    localStorage.setItem(STUDENT_STORAGE_KEY, JSON.stringify(updatedStudent));
  };

  const uploadPhoto = async () => {
    if (!selectedPhoto) return;

    setIsUploading(true);
    setFeedback(null);

    const formData = new FormData();
    formData.append("photo", selectedPhoto);

    try {
      const response = await fetch(`${API_BASE_URL}/api/students/${encodeURIComponent(student.studentNumber || String(safeUser.user_id))}/photo`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Unable to upload your profile picture.");
      }

      const updatedStudent = { ...student, avatar: data.url || null };
      persistStudent(updatedStudent);
      setSelectedPhoto(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setFeedback({ type: "success", message: "Profile picture uploaded successfully." });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Unable to upload your profile picture.",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const removePhoto = async () => {
    if (!student.avatar) return;

    const confirmed = window.confirm("Remove your current profile picture?");
    if (!confirmed) return;

    setIsDeleting(true);
    setFeedback(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/students/${encodeURIComponent(student.studentNumber || String(safeUser.user_id))}/photo`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || "Unable to remove your profile picture.");
      }

      const updatedStudent = { ...student, avatar: null };
      persistStudent(updatedStudent);
      setSelectedPhoto(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setFeedback({ type: "success", message: "Profile picture removed successfully." });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Unable to remove your profile picture.",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="profile-page">
        <div className="profile-hero">
          <div>
            <p className="profile-eyebrow">Student Account</p>
            <h1>My Profile</h1>
            <p>
              This page displays your official student record as maintained by the Administration Office.
            </p>
          </div>
          <div className="profile-badges">
            <span className="profile-badge">
              <ShieldCheck size={16} /> Verified Account
            </span>
            <span className="profile-badge subtle">{student.course || "Course pending"}</span>
          </div>
        </div>

        <div className="profile-card">
          <div className="profile-left">
            <div className="avatar-card">
              <div className="avatar-preview">
                {previewUrl || student.avatar ? (
                  <img src={previewUrl || student.avatar || ""} alt={`${student.firstName} ${student.lastName} profile`} />
                ) : (
                  <div className="avatar-placeholder">
                    <UserRound size={36} />
                    <span>No Photo</span>
                  </div>
                )}
              </div>

              <div className="avatar-actions">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp"
                  onChange={handlePhotoSelection}
                  style={{ display: "none" }}
                />
                <button type="button" className="btn small" onClick={() => fileInputRef.current?.click()} disabled={isUploading || isDeleting}>
                  {isUploading ? (
                    <>
                      <LoaderCircle size={14} className="button-spinner" /> Uploading...
                    </>
                  ) : (
                    <>
                      <Camera size={14} /> Upload Photo
                    </>
                  )}
                </button>
                {student.avatar ? (
                  <button type="button" className="btn small danger" onClick={removePhoto} disabled={isUploading || isDeleting}>
                    {isDeleting ? (
                      <>
                        <LoaderCircle size={14} className="button-spinner" /> Deleting...
                      </>
                    ) : (
                      <>
                        <Trash2 size={14} /> Remove Photo
                      </>
                    )}
                  </button>
                ) : null}
              </div>

              {selectedPhoto && !isUploading ? (
                <div className="avatar-preview-actions">
                  <button type="button" className="btn primary small" onClick={uploadPhoto}>
                    Save Photo
                  </button>
                  <button type="button" className="btn small" onClick={() => setSelectedPhoto(null)}>
                    Cancel
                  </button>
                </div>
              ) : null}

              {feedback ? <div className={`avatar-feedback ${feedback.type}`}>{feedback.message}</div> : null}

              <div className="avatar-meta">
                <div className="meta-row">
                  <strong>
                    {student.firstName} {student.lastName}
                  </strong>
                </div>
                <div className="meta-row muted">Student</div>
              </div>
            </div>

            <div className="profile-summary">
              <h3>Account Overview</h3>
              <div className="summary-item">
                <span>Student No.</span>
                <strong>{student.studentNumber || "â€”"}</strong>
              </div>
              <div className="summary-item">
                <span>Course</span>
                <strong>{student.course || "â€”"}</strong>
              </div>
              <div className="summary-item">
                <span>Year Level</span>
                <strong>{student.yearLevel || "â€”"}</strong>
              </div>
              <div className="summary-item">
                <span>Section</span>
                <strong>{student.section || "â€”"}</strong>
              </div>
            </div>
          </div>

          <div className="profile-right">
            <div className="profile-form">
              <div className="section-header">
                <h2>Personal Information</h2>
                <small>These details are displayed for reference and remain part of your official student record.</small>
              </div>

              <div className="info-grid">
                <div className="info-card">
                  <span className="info-label">Student ID</span>
                  <strong>{student.studentNumber || "Not provided"}</strong>
                </div>
                <div className="info-card">
                  <span className="info-label">Full Name</span>
                  <strong>
                    {[student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ") || "Not provided"}
                  </strong>
                </div>
                <div className="info-card">
                  <span className="info-label">Email</span>
                  <strong>{student.email || "Not provided"}</strong>
                </div>
                <div className="info-card">
                  <span className="info-label">Phone Number</span>
                  <strong>{student.contactNumber || "Not provided"}</strong>
                </div>
                <div className="info-card">
                  <span className="info-label">Gender</span>
                  <strong>{student.gender || "Not provided"}</strong>
                </div>
                <div className="info-card">
                  <span className="info-label">Birth Date</span>
                  <strong>{student.birthDate || "Not provided"}</strong>
                </div>
                <div className="info-card">
                  <span className="info-label">Address</span>
                  <strong>{student.address || "Not provided"}</strong>
                </div>
              </div>

              <div className="section-header">
                <h2>Academic Information</h2>
                <small>Enrollment details are maintained as part of the student record.</small>
              </div>

              <div className="info-grid">
                <div className="info-card">
                  <span className="info-label">Course</span>
                  <strong>{student.course || "Not provided"}</strong>
                </div>
                <div className="info-card">
                  <span className="info-label">Year Level</span>
                  <strong>{student.yearLevel || "Not provided"}</strong>
                </div>
                <div className="info-card">
                  <span className="info-label">Section</span>
                  <strong>{student.section || "Not provided"}</strong>
                </div>
                <div className="info-card">
                  <span className="info-label">Enrollment Status</span>
                  <strong>{student.enrollmentStatus || "Not provided"}</strong>
                </div>
              </div>

              <div className="section-header">
                <h2>Guardian Information</h2>
                <small>Emergency and family contact details are stored separately for privacy and clarity.</small>
              </div>

              <div className="info-grid">
                <div className="info-card">
                  <span className="info-label">Guardian Name</span>
                  <strong>{student.guardianName || "Not provided"}</strong>
                </div>
                <div className="info-card">
                  <span className="info-label">Guardian Relationship</span>
                  <strong>{student.guardianRelationship || "Not provided"}</strong>
                </div>
                <div className="info-card">
                  <span className="info-label">Guardian Contact</span>
                  <strong>{student.guardianContact || "Not provided"}</strong>
                </div>
              </div>

              <div className="section-header">
                <h2>Contact & Address Information</h2>
                <small>These records are view-only and are maintained by the Administration Office.</small>
              </div>

              <div className="info-grid">
                <div className="info-card">
                  <span className="info-label">Mobile Number</span>
                  <strong>{student.contactNumber || "Not provided"}</strong>
                </div>
                <div className="info-card">
                  <span className="info-label">Email Address</span>
                  <strong>{student.email || "Not provided"}</strong>
                </div>
                <div className="info-card">
                  <span className="info-label">House No.</span>
                  <strong>{student.houseNo || "Not provided"}</strong>
                </div>
                <div className="info-card">
                  <span className="info-label">Street</span>
                  <strong>{student.street || "Not provided"}</strong>
                </div>
                <div className="info-card">
                  <span className="info-label">Barangay</span>
                  <strong>{student.barangay || "Not provided"}</strong>
                </div>
                <div className="info-card">
                  <span className="info-label">City</span>
                  <strong>{student.city || "Not provided"}</strong>
                </div>
                <div className="info-card">
                  <span className="info-label">Province</span>
                  <strong>{student.province || "Not provided"}</strong>
                </div>
              </div>

              <div className="section-header">
                <h2>Student Status</h2>
                <small>Only the Administrator can manage this official school record.</small>
              </div>

              <div className="status-card">
                <span className={getStatusClass(student.studentStatus)}>{student.studentStatus || "Active"}</span>
                <p className="status-help">This status is read-only and cannot be changed from this page.</p>
              </div>

              <div className="official-note">
                <p>
                  Your personal information, contact details, address, and student status are official school records maintained by the Administration Office. Students cannot edit these records. If any information is incorrect, please contact the administrator. Only your profile picture can be updated from this page.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

