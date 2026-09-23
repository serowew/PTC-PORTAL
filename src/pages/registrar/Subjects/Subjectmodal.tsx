import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertCircle,
  BookOpen,
  Clock3,
  FlaskConical,
  Loader2,
  Save,
  X,
} from "lucide-react";

import { authService } from "../../../services/auth.service";
import "../../../styles/SubjectmodalR.css";

const API_BASE_URL = "http://localhost:3000/api/registrar/subjects";

export interface Subject {
  subject_id: number;
  subject_code: string;
  subject_name: string;
  units: number;
  lecture_hours: number;
  laboratory_hours: number;
  description: string | null;
  created_at: string;
}

interface SubjectModalProps {
  isOpen: boolean;
  mode: "add" | "edit";
  subject: Subject | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface SubjectSaveResponse {
  success: boolean;
  message?: string;
  error?: string;
  subject?: Subject;
}

const normalizeNumber = (value: string) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
};

export default function SubjectModal({
  isOpen,
  mode,
  subject,
  onClose,
  onSuccess,
}: SubjectModalProps) {
  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [subjectCode, setSubjectCode] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [units, setUnits] = useState("");
  const [lectureHours, setLectureHours] = useState("3");
  const [laboratoryHours, setLaboratoryHours] = useState("0");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;

    setError("");

    if (mode === "edit" && subject) {
      setSubjectCode(subject.subject_code);
      setSubjectName(subject.subject_name);
      setUnits(String(subject.units));
      setLectureHours(String(subject.lecture_hours ?? 0));
      setLaboratoryHours(String(subject.laboratory_hours ?? 0));
      setDescription(subject.description || "");
    } else {
      setSubjectCode("");
      setSubjectName("");
      setUnits("");
      setLectureHours("3");
      setLaboratoryHours("0");
      setDescription("");
    }
  }, [isOpen, mode, subject]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, saving, onClose]);

  const parsedUnits = normalizeNumber(units);
  const parsedLectureHours = normalizeNumber(lectureHours);
  const parsedLaboratoryHours = normalizeNumber(laboratoryHours);

  const formValid =
    Boolean(subjectCode.trim()) &&
    Boolean(subjectName.trim()) &&
    units !== "" &&
    Number.isFinite(parsedUnits) &&
    parsedUnits >= 0 &&
    lectureHours !== "" &&
    Number.isFinite(parsedLectureHours) &&
    parsedLectureHours >= 0 &&
    laboratoryHours !== "" &&
    Number.isFinite(parsedLaboratoryHours) &&
    parsedLaboratoryHours >= 0;

  const isDirty = useMemo(() => {
    if (mode === "add") {
      return Boolean(
        subjectCode.trim() ||
          subjectName.trim() ||
          units ||
          lectureHours !== "3" ||
          laboratoryHours !== "0" ||
          description.trim(),
      );
    }

    if (!subject) return false;

    return (
      subjectCode.trim().toUpperCase() !== subject.subject_code.trim().toUpperCase() ||
      subjectName.trim() !== subject.subject_name.trim() ||
      Number(units) !== Number(subject.units) ||
      Number(lectureHours) !== Number(subject.lecture_hours ?? 0) ||
      Number(laboratoryHours) !== Number(subject.laboratory_hours ?? 0) ||
      description.trim() !== (subject.description || "").trim()
    );
  }, [
    mode,
    subject,
    subjectCode,
    subjectName,
    units,
    lectureHours,
    laboratoryHours,
    description,
  ]);

  const handleClose = () => {
    if (!saving) onClose();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    if (!authenticated || userRole !== "Registrar") {
      setError(
        "Your session has expired or you are not authorized to manage subjects.",
      );
      return;
    }

    const cleanCode = subjectCode.trim().toUpperCase();
    const cleanName = subjectName.trim();

    if (!cleanCode) {
      setError("Subject code is required.");
      return;
    }

    if (!cleanName) {
      setError("Subject name is required.");
      return;
    }

    if (units === "" || !Number.isFinite(parsedUnits) || parsedUnits < 0) {
      setError("Please enter valid units.");
      return;
    }

    if (
      lectureHours === "" ||
      !Number.isFinite(parsedLectureHours) ||
      parsedLectureHours < 0
    ) {
      setError("Please enter valid lecture hours.");
      return;
    }

    if (
      laboratoryHours === "" ||
      !Number.isFinite(parsedLaboratoryHours) ||
      parsedLaboratoryHours < 0
    ) {
      setError("Please enter valid laboratory hours.");
      return;
    }

    if (mode === "edit" && !subject?.subject_id) {
      setError("Invalid subject selected for editing.");
      return;
    }

    try {
      setSaving(true);

      const payload = {
        subject_code: cleanCode,
        subject_name: cleanName,
        units: parsedUnits,
        lecture_hours: parsedLectureHours,
        laboratory_hours: parsedLaboratoryHours,
        description: description.trim() || null,
      };

      const url =
        mode === "add"
          ? API_BASE_URL
          : `${API_BASE_URL}/${subject!.subject_id}`;

      const response = await authService.authFetch(url, {
        method: mode === "add" ? "POST" : "PUT",
        body: JSON.stringify(payload),
      });

      const contentType = response.headers.get("content-type") || "";
      let data: SubjectSaveResponse | null = null;

      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        throw new Error(
          `Server returned a non-JSON response (${response.status}): ${text.slice(0, 200)}`,
        );
      }

      if (response.status === 401) {
        authService.logout();
        setError("Your session has expired. Please log in again.");
        return;
      }

      if (response.status === 403) {
        throw new Error(
          data?.message ||
            data?.error ||
            "You are not authorized to manage subjects.",
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to ${mode === "add" ? "add" : "update"} subject (${response.status}).`,
        );
      }

      if (!data?.success) {
        throw new Error(
          data?.message ||
            `Failed to ${mode === "add" ? "add" : "update"} subject.`,
        );
      }

      onSuccess();
    } catch (err) {
      console.error("SAVE SUBJECT ERROR:", err);

      if (err instanceof TypeError) {
        setError(
          "Unable to connect to the subject server. Make sure the backend is running on port 3000.",
        );
        return;
      }

      setError(err instanceof Error ? err.message : "Failed to save subject.");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const workloadHours =
    (Number.isFinite(parsedLectureHours) ? parsedLectureHours : 0) +
    (Number.isFinite(parsedLaboratoryHours) ? parsedLaboratoryHours : 0);

  return (
    <div
      className="registrar-subject-modal__overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <section
        className="registrar-subject-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="registrar-subject-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="registrar-subject-modal__header">
          <div className="registrar-subject-modal__identity">
            <span className="registrar-subject-modal__icon">
              <BookOpen size={20} aria-hidden="true" />
            </span>
            <div>
              <span className="registrar-subject-modal__eyebrow">
                {mode === "add" ? "New Catalog Record" : "Edit Catalog Record"}
              </span>
              <h2 id="registrar-subject-modal-title">
                {mode === "add" ? "Add Subject" : "Edit Subject"}
              </h2>
              <p>
                {mode === "add"
                  ? "Create a master subject that can be mapped into curricula and offerings."
                  : `Update ${subject?.subject_code || "this subject"} without changing existing academic records.`}
              </p>
            </div>
          </div>

          <button
            type="button"
            className="registrar-subject-modal__close"
            onClick={handleClose}
            disabled={saving}
            aria-label="Close subject dialog"
          >
            <X size={19} aria-hidden="true" />
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="registrar-subject-modal__body">
            {error && (
              <div className="registrar-subject-modal__error" role="alert">
                <AlertCircle size={17} aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <section className="registrar-subject-modal__section">
              <div className="registrar-subject-modal__section-heading">
                <span>Subject Identity</span>
                <p>Use a unique code and the official subject title.</p>
              </div>

              <div className="registrar-subject-modal__grid registrar-subject-modal__grid--identity">
                <label className="registrar-subject-modal__field">
                  <span>
                    Subject Code <b>*</b>
                  </span>
                  <input
                    type="text"
                    value={subjectCode}
                    onChange={(event) =>
                      setSubjectCode(event.target.value.toUpperCase())
                    }
                    placeholder="e.g. IT101"
                    maxLength={20}
                    disabled={saving}
                    autoFocus
                  />
                  <small>{subjectCode.length}/20 characters</small>
                </label>

                <label className="registrar-subject-modal__field">
                  <span>
                    Subject Name <b>*</b>
                  </span>
                  <input
                    type="text"
                    value={subjectName}
                    onChange={(event) => setSubjectName(event.target.value)}
                    placeholder="e.g. Introduction to Information Technology"
                    maxLength={200}
                    disabled={saving}
                  />
                  <small>{subjectName.length}/200 characters</small>
                </label>
              </div>
            </section>

            <section className="registrar-subject-modal__section">
              <div className="registrar-subject-modal__section-heading">
                <span>Units & Contact Hours</span>
                <p>Define the standard academic load for this master subject.</p>
              </div>

              <div className="registrar-subject-modal__grid registrar-subject-modal__grid--load">
                <label className="registrar-subject-modal__field">
                  <span>
                    Units <b>*</b>
                  </span>
                  <div className="registrar-subject-modal__number-input">
                    <BookOpen size={16} aria-hidden="true" />
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={units}
                      onChange={(event) => setUnits(event.target.value)}
                      disabled={saving}
                      placeholder="0"
                    />
                  </div>
                </label>

                <label className="registrar-subject-modal__field">
                  <span>Lecture Hours</span>
                  <div className="registrar-subject-modal__number-input">
                    <Clock3 size={16} aria-hidden="true" />
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={lectureHours}
                      onChange={(event) => setLectureHours(event.target.value)}
                      disabled={saving}
                    />
                  </div>
                </label>

                <label className="registrar-subject-modal__field">
                  <span>Laboratory Hours</span>
                  <div className="registrar-subject-modal__number-input">
                    <FlaskConical size={16} aria-hidden="true" />
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={laboratoryHours}
                      onChange={(event) => setLaboratoryHours(event.target.value)}
                      disabled={saving}
                    />
                  </div>
                </label>
              </div>

              <div className="registrar-subject-modal__load-preview">
                <span>
                  <strong>{Number.isFinite(parsedUnits) ? parsedUnits : 0}</strong>
                  Units
                </span>
                <span>
                  <strong>{workloadHours}</strong>
                  Total contact hours
                </span>
              </div>
            </section>

            <section className="registrar-subject-modal__section">
              <div className="registrar-subject-modal__section-heading">
                <span>Description</span>
                <p>Optional context to help identify the subject in the catalog.</p>
              </div>

              <label className="registrar-subject-modal__field">
                <span>Subject Description</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Enter a concise subject description..."
                  rows={4}
                  maxLength={1000}
                  disabled={saving}
                />
                <small>{description.length}/1000 characters</small>
              </label>
            </section>
          </div>

          <footer className="registrar-subject-modal__footer">
            <div className="registrar-subject-modal__footer-note">
              Fields marked with <b>*</b> are required.
            </div>
            <div className="registrar-subject-modal__footer-actions">
              <button
                type="button"
                className="registrar-subject-modal__button registrar-subject-modal__button--secondary"
                onClick={handleClose}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="registrar-subject-modal__button registrar-subject-modal__button--primary"
                disabled={
                  saving ||
                  !authenticated ||
                  userRole !== "Registrar" ||
                  !formValid ||
                  (mode === "edit" && !isDirty)
                }
              >
                {saving ? (
                  <>
                    <Loader2 size={16} className="is-spinning" aria-hidden="true" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save size={16} aria-hidden="true" />
                    {mode === "add" ? "Add Subject" : "Save Changes"}
                  </>
                )}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
