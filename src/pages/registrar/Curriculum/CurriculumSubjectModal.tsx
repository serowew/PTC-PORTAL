import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  BookOpen,
  CheckCircle2,
  Clock3,
  Layers3,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";

import { authService } from "../../../services/auth.service";
import "../../../styles/CurriculumSubjectModal.css";

const API_BASE_URL = "http://localhost:3000/api/registrar/curriculums";

interface CurriculumSubject {
  curriculum_subject_id: number;
  curriculum_id: number;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  units: number;
  lecture_hours: number;
  laboratory_hours: number;
  year_level: number;
  semester_id: number;
  semester_name: string;
  is_required: number;
  display_order: number;
}

interface AvailableSubject {
  subject_id: number;
  subject_code: string;
  subject_name: string;
  units: number;
  lecture_hours: number;
  laboratory_hours: number;
}

interface CurriculumSubjectModalProps {
  isOpen: boolean;
  mode: "add" | "edit";
  curriculumId: number;
  subject?: CurriculumSubject | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface AvailableSubjectsResponse {
  success: boolean;
  subjects?: AvailableSubject[];
  message?: string;
  error?: string;
}

interface SaveSubjectResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export default function CurriculumSubjectModal({
  isOpen,
  mode,
  curriculumId,
  subject,
  onClose,
  onSuccess,
}: CurriculumSubjectModalProps) {
  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [availableSubjects, setAvailableSubjects] = useState<
    AvailableSubject[]
  >([]);
  const [subjectSearch, setSubjectSearch] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [yearLevel, setYearLevel] = useState("1");
  const [semesterId, setSemesterId] = useState("1");
  const [units, setUnits] = useState("");
  const [lectureHours, setLectureHours] = useState("");
  const [laboratoryHours, setLaboratoryHours] = useState("");
  const [isRequired, setIsRequired] = useState("1");
  const [displayOrder, setDisplayOrder] = useState("1");
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;

    setError("");
    setSubjectSearch("");

    if (mode === "edit" && subject) {
      setSubjectId(String(subject.subject_id));
      setYearLevel(String(subject.year_level));
      setSemesterId(String(subject.semester_id));
      setUnits(String(subject.units));
      setLectureHours(String(subject.lecture_hours));
      setLaboratoryHours(String(subject.laboratory_hours));
      setIsRequired(String(subject.is_required));
      setDisplayOrder(String(subject.display_order));
    } else {
      setSubjectId("");
      setYearLevel("1");
      setSemesterId("1");
      setUnits("");
      setLectureHours("");
      setLaboratoryHours("");
      setIsRequired("1");
      setDisplayOrder("1");
    }
  }, [isOpen, mode, subject]);

  useEffect(() => {
    if (!isOpen || mode !== "add") return;
    if (!authenticated || userRole !== "Registrar") return;

    const controller = new AbortController();

    const loadAvailableSubjects = async () => {
      try {
        setLoadingSubjects(true);
        setError("");

        const response = await authService.authFetch(
          `${API_BASE_URL}/${curriculumId}/available-subjects`,
          {
            method: "GET",
            signal: controller.signal,
            headers: { Accept: "application/json" },
          },
        );

        const contentType = response.headers.get("content-type") || "";
        let data: AvailableSubjectsResponse | null = null;

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
          setError("Your session has expired. Please log in again.");
          return;
        }

        if (response.status === 403) {
          throw new Error(
            data?.message ||
              data?.error ||
              "You are not authorized to manage curriculum subjects.",
          );
        }

        if (!response.ok || !data?.success) {
          throw new Error(
            data?.message ||
              data?.error ||
              "Failed to load available subjects.",
          );
        }

        setAvailableSubjects(Array.isArray(data.subjects) ? data.subjects : []);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;

        console.error("LOAD AVAILABLE SUBJECTS ERROR:", err);
        setAvailableSubjects([]);
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load available subjects.",
        );
      } finally {
        if (!controller.signal.aborted) setLoadingSubjects(false);
      }
    };

    void loadAvailableSubjects();

    return () => controller.abort();
  }, [isOpen, mode, curriculumId, authenticated, userRole]);

  useEffect(() => {
    if (mode !== "add" || !subjectId) return;

    const selected = availableSubjects.find(
      (item) => String(item.subject_id) === subjectId,
    );

    if (!selected) return;

    setUnits(String(selected.units));
    setLectureHours(String(selected.lecture_hours));
    setLaboratoryHours(String(selected.laboratory_hours));
  }, [subjectId, availableSubjects, mode]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, saving, onClose]);

  const filteredAvailableSubjects = useMemo(() => {
    const query = subjectSearch.trim().toLowerCase();
    if (!query) return availableSubjects;

    return availableSubjects.filter(
      (item) =>
        item.subject_code.toLowerCase().includes(query) ||
        item.subject_name.toLowerCase().includes(query),
    );
  }, [availableSubjects, subjectSearch]);

  const selectedAvailableSubject = useMemo(
    () =>
      availableSubjects.find(
        (item) => String(item.subject_id) === subjectId,
      ) ?? null,
    [availableSubjects, subjectId],
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    if (!authenticated || userRole !== "Registrar") {
      setError(
        "Your session has expired or you are not authorized to manage curriculum subjects.",
      );
      return;
    }

    if (mode === "edit" && !subject) {
      setError("Unable to identify the curriculum subject to update.");
      return;
    }

    if (mode === "add" && !subjectId) {
      setError("Please select a subject.");
      return;
    }

    const parsedUnits = Number(units);
    const parsedLectureHours = Number(lectureHours);
    const parsedLaboratoryHours = Number(laboratoryHours);

    if (units === "" || parsedUnits < 0) {
      setError("Please enter valid units.");
      return;
    }

    if (lectureHours === "" || parsedLectureHours < 0) {
      setError("Please enter valid lecture hours.");
      return;
    }

    if (laboratoryHours === "" || parsedLaboratoryHours < 0) {
      setError("Please enter valid laboratory hours.");
      return;
    }

    try {
      setSaving(true);

      const payload = {
        subject_id:
          mode === "add" ? Number(subjectId) : Number(subject?.subject_id),
        units: parsedUnits,
        lecture_hours: parsedLectureHours,
        laboratory_hours: parsedLaboratoryHours,
        year_level: Number(yearLevel),
        semester_id: Number(semesterId),
        is_required: Number(isRequired),
        display_order: Number(displayOrder),
      };

      const url =
        mode === "add"
          ? `${API_BASE_URL}/${curriculumId}/subjects`
          : `${API_BASE_URL}/${curriculumId}/subjects/${subject?.curriculum_subject_id}`;

      const method = mode === "add" ? "POST" : "PUT";

      const response = await authService.authFetch(url, {
        method,
        body: JSON.stringify(payload),
      });

      const contentType = response.headers.get("content-type") || "";
      let data: SaveSubjectResponse | null = null;

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
        setError("Your session has expired. Please log in again.");
        return;
      }

      if (response.status === 403) {
        throw new Error(
          data?.message ||
            data?.error ||
            "You are not authorized to manage curriculum subjects.",
        );
      }

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to ${mode === "add" ? "add" : "update"} subject.`,
        );
      }

      onSuccess();
    } catch (err) {
      console.error("SAVE CURRICULUM SUBJECT ERROR:", err);
      setError(
        err instanceof Error
          ? err.message
          : `Failed to ${mode === "add" ? "add" : "update"} subject.`,
      );
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) onClose();
  };

  if (!isOpen) return null;

  const modalSubject = mode === "edit" ? subject : selectedAvailableSubject;

  return (
    <div
      className="registrar-curriculum-subject-modal__overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        className="registrar-curriculum-subject-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="registrar-curriculum-subject-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="registrar-curriculum-subject-modal__header">
          <div className="registrar-curriculum-subject-modal__header-copy">
            <div className="registrar-curriculum-subject-modal__header-icon">
              <BookOpen size={20} />
            </div>
            <div>
              <span>Curriculum subject mapping</span>
              <h2 id="registrar-curriculum-subject-modal-title">
                {mode === "add" ? "Add Subject" : "Edit Subject"}
              </h2>
              <p>
                {mode === "add"
                  ? "Choose an existing subject and define where it belongs in this curriculum."
                  : "Update the academic placement, workload, and classification for this mapping."}
              </p>
            </div>
          </div>

          <button
            type="button"
            className="registrar-curriculum-subject-modal__close"
            onClick={handleClose}
            disabled={saving}
            aria-label="Close subject modal"
          >
            <X size={19} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="registrar-curriculum-subject-modal__body">
            {error && (
              <div className="registrar-curriculum-subject-modal__error">
                <span>!</span>
                <p>{error}</p>
              </div>
            )}

            {mode === "add" ? (
              <section className="registrar-curriculum-subject-modal__section">
                <div className="registrar-curriculum-subject-modal__section-heading">
                  <div className="registrar-curriculum-subject-modal__section-icon">
                    <Search size={16} />
                  </div>
                  <div>
                    <h3>Select Subject</h3>
                    <p>Only subjects not yet mapped to this curriculum are listed.</p>
                  </div>
                </div>

                <div className="registrar-curriculum-subject-modal__field">
                  <label htmlFor="curriculum-subject-search">Find subject</label>
                  <div className="registrar-curriculum-subject-modal__search">
                    <Search size={16} />
                    <input
                      id="curriculum-subject-search"
                      type="search"
                      value={subjectSearch}
                      onChange={(event) => setSubjectSearch(event.target.value)}
                      placeholder="Search code or subject name"
                      disabled={loadingSubjects || saving}
                    />
                    {subjectSearch && (
                      <button
                        type="button"
                        onClick={() => setSubjectSearch("")}
                        aria-label="Clear subject search"
                        disabled={saving}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="registrar-curriculum-subject-modal__field">
                  <label htmlFor="subject">
                    Subject <span>*</span>
                  </label>
                  <select
                    id="subject"
                    value={subjectId}
                    onChange={(event) => setSubjectId(event.target.value)}
                    disabled={
                      loadingSubjects ||
                      saving ||
                      availableSubjects.length === 0
                    }
                  >
                    <option value="">
                      {loadingSubjects
                        ? "Loading available subjects…"
                        : availableSubjects.length === 0
                          ? "No available subjects"
                          : filteredAvailableSubjects.length === 0
                            ? "No subjects match your search"
                            : "Select a subject"}
                    </option>
                    {filteredAvailableSubjects.map((item) => (
                      <option key={item.subject_id} value={item.subject_id}>
                        {item.subject_code} — {item.subject_name}
                      </option>
                    ))}
                  </select>
                </div>
              </section>
            ) : (
              <section className="registrar-curriculum-subject-modal__section">
                <div className="registrar-curriculum-subject-modal__section-heading">
                  <div className="registrar-curriculum-subject-modal__section-icon">
                    <BookOpen size={16} />
                  </div>
                  <div>
                    <h3>Selected Subject</h3>
                    <p>The subject itself cannot be changed while editing this mapping.</p>
                  </div>
                </div>
              </section>
            )}

            {modalSubject && (
              <div className="registrar-curriculum-subject-modal__subject-preview">
                <div>
                  <strong>{modalSubject.subject_code}</strong>
                  <span>{modalSubject.subject_name}</span>
                </div>
                <small>{modalSubject.units} units</small>
              </div>
            )}

            <section className="registrar-curriculum-subject-modal__section">
              <div className="registrar-curriculum-subject-modal__section-heading">
                <div className="registrar-curriculum-subject-modal__section-icon">
                  <Layers3 size={16} />
                </div>
                <div>
                  <h3>Academic Placement</h3>
                  <p>Set the year, semester, type, and display sequence.</p>
                </div>
              </div>

              <div className="registrar-curriculum-subject-modal__grid registrar-curriculum-subject-modal__grid--two">
                <div className="registrar-curriculum-subject-modal__field">
                  <label htmlFor="yearLevel">
                    Year Level <span>*</span>
                  </label>
                  <select
                    id="yearLevel"
                    value={yearLevel}
                    onChange={(event) => setYearLevel(event.target.value)}
                    disabled={saving}
                  >
                    <option value="1">1st Year</option>
                    <option value="2">2nd Year</option>
                    <option value="3">3rd Year</option>
                    <option value="4">4th Year</option>
                  </select>
                </div>

                <div className="registrar-curriculum-subject-modal__field">
                  <label htmlFor="semesterId">
                    Semester <span>*</span>
                  </label>
                  <select
                    id="semesterId"
                    value={semesterId}
                    onChange={(event) => setSemesterId(event.target.value)}
                    disabled={saving}
                  >
                    <option value="1">1st Semester</option>
                    <option value="2">2nd Semester</option>
                  </select>
                </div>

                <div className="registrar-curriculum-subject-modal__field">
                  <label htmlFor="isRequired">Subject Type</label>
                  <select
                    id="isRequired"
                    value={isRequired}
                    onChange={(event) => setIsRequired(event.target.value)}
                    disabled={saving}
                  >
                    <option value="1">Required</option>
                    <option value="0">Elective</option>
                  </select>
                </div>

                <div className="registrar-curriculum-subject-modal__field">
                  <label htmlFor="displayOrder">Display Order</label>
                  <input
                    id="displayOrder"
                    type="number"
                    min="1"
                    value={displayOrder}
                    onChange={(event) => setDisplayOrder(event.target.value)}
                    disabled={saving}
                  />
                  <small>Controls the subject order within its semester.</small>
                </div>
              </div>
            </section>

            <section className="registrar-curriculum-subject-modal__section">
              <div className="registrar-curriculum-subject-modal__section-heading">
                <div className="registrar-curriculum-subject-modal__section-icon">
                  <Clock3 size={16} />
                </div>
                <div>
                  <h3>Units & Contact Hours</h3>
                  <p>These values are auto-filled when adding a subject and can be adjusted for this curriculum mapping.</p>
                </div>
              </div>

              <div className="registrar-curriculum-subject-modal__grid registrar-curriculum-subject-modal__grid--three">
                <div className="registrar-curriculum-subject-modal__field">
                  <label htmlFor="units">
                    Units <span>*</span>
                  </label>
                  <input
                    id="units"
                    type="number"
                    min="0"
                    step="0.5"
                    value={units}
                    onChange={(event) => setUnits(event.target.value)}
                    disabled={saving}
                  />
                </div>

                <div className="registrar-curriculum-subject-modal__field">
                  <label htmlFor="lectureHours">
                    Lecture Hours <span>*</span>
                  </label>
                  <input
                    id="lectureHours"
                    type="number"
                    min="0"
                    step="0.5"
                    value={lectureHours}
                    onChange={(event) => setLectureHours(event.target.value)}
                    disabled={saving}
                  />
                </div>

                <div className="registrar-curriculum-subject-modal__field">
                  <label htmlFor="laboratoryHours">
                    Laboratory Hours <span>*</span>
                  </label>
                  <input
                    id="laboratoryHours"
                    type="number"
                    min="0"
                    step="0.5"
                    value={laboratoryHours}
                    onChange={(event) => setLaboratoryHours(event.target.value)}
                    disabled={saving}
                  />
                </div>
              </div>
            </section>
          </div>

          <div className="registrar-curriculum-subject-modal__footer">
            <div className="registrar-curriculum-subject-modal__footer-note">
              <CheckCircle2 size={15} />
              Changes affect this curriculum mapping only.
            </div>
            <div className="registrar-curriculum-subject-modal__footer-actions">
              <button
                type="button"
                className="registrar-curriculum-subject-modal__button registrar-curriculum-subject-modal__button--secondary"
                onClick={handleClose}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="registrar-curriculum-subject-modal__button registrar-curriculum-subject-modal__button--primary"
                disabled={
                  saving ||
                  loadingSubjects ||
                  !authenticated ||
                  userRole !== "Registrar"
                }
              >
                {saving && <LoaderCircle size={16} className="is-spinning" />}
                {saving
                  ? "Saving…"
                  : mode === "add"
                    ? "Add Subject"
                    : "Save Changes"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
