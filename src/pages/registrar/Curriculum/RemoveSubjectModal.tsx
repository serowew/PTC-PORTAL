import { useEffect, useState } from "react";
import { AlertTriangle, LoaderCircle, Trash2, X } from "lucide-react";

import { authService } from "../../../services/auth.service";
import "../../../styles/RemoveSubjectModal.css";

interface CurriculumSubject {
  curriculum_subject_id: number;
  curriculum_id: number;
  subject_code: string;
  subject_name: string;
  units: number;
}

interface RemoveSubjectModalProps {
  isOpen: boolean;
  curriculumId: number;
  subject: CurriculumSubject | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface RemoveSubjectResponse {
  success: boolean;
  message?: string;
  error?: string;
  removed?: unknown;
}

const API_BASE_URL = "http://localhost:3000/api/registrar/curriculums";

export default function RemoveSubjectModal({
  isOpen,
  curriculumId,
  subject,
  onClose,
  onSuccess,
}: RemoveSubjectModalProps) {
  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;

    setError("");

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !removing) onClose();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, removing, onClose, subject?.curriculum_subject_id]);

  if (!isOpen || !subject) return null;

  const handleRemove = async () => {
    setError("");

    if (!authenticated || userRole !== "Registrar") {
      setError(
        "Your session has expired or you are not authorized to manage curriculum subjects.",
      );
      return;
    }

    const parsedCurriculumId = Number(curriculumId);

    if (!Number.isInteger(parsedCurriculumId) || parsedCurriculumId <= 0) {
      setError("Invalid curriculum ID.");
      return;
    }

    const curriculumSubjectId = Number(subject.curriculum_subject_id);

    if (!Number.isInteger(curriculumSubjectId) || curriculumSubjectId <= 0) {
      setError("Invalid curriculum subject ID.");
      return;
    }

    try {
      setRemoving(true);
      setError("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${parsedCurriculumId}/subjects/${curriculumSubjectId}`,
        {
          method: "DELETE",
          headers: { Accept: "application/json" },
        },
      );

      const contentType = response.headers.get("content-type") || "";
      let data: RemoveSubjectResponse | null = null;

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
            "You are not authorized to remove subjects from this curriculum.",
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to remove subject (${response.status}).`,
        );
      }

      if (!data?.success) {
        throw new Error(data?.message || "Failed to remove subject.");
      }

      onSuccess();
    } catch (err) {
      console.error("REMOVE CURRICULUM SUBJECT ERROR:", err);

      if (err instanceof TypeError) {
        setError(
          "Unable to connect to the curriculum server. Make sure the backend is running on port 3000.",
        );
        return;
      }

      setError(
        err instanceof Error ? err.message : "Failed to remove subject.",
      );
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div
      className="registrar-remove-curriculum-subject__overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !removing) onClose();
      }}
    >
      <div
        className="registrar-remove-curriculum-subject"
        role="dialog"
        aria-modal="true"
        aria-labelledby="registrar-remove-curriculum-subject-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="registrar-remove-curriculum-subject__close"
          onClick={onClose}
          disabled={removing}
          aria-label="Close remove subject dialog"
        >
          <X size={18} />
        </button>

        <div className="registrar-remove-curriculum-subject__icon">
          <Trash2 size={22} />
        </div>

        <span className="registrar-remove-curriculum-subject__eyebrow">
          Curriculum mapping
        </span>
        <h2 id="registrar-remove-curriculum-subject-title">Remove Subject?</h2>
        <p className="registrar-remove-curriculum-subject__description">
          This will remove the subject from this curriculum plan. Review the
          selected subject before continuing.
        </p>

        <div className="registrar-remove-curriculum-subject__subject-card">
          <div>
            <strong>{subject.subject_code}</strong>
            <span>{subject.subject_name}</span>
          </div>
          <small>
            {subject.units} {subject.units === 1 ? "unit" : "units"}
          </small>
        </div>

        <div className="registrar-remove-curriculum-subject__warning">
          <AlertTriangle size={17} />
          <div>
            <strong>The master subject will remain in the system.</strong>
            <span>
              Only this curriculum mapping is removed. This action does not
              delete the subject from Subject Management.
            </span>
          </div>
        </div>

        {error && (
          <div className="registrar-remove-curriculum-subject__error">
            {error}
          </div>
        )}

        <div className="registrar-remove-curriculum-subject__actions">
          <button
            type="button"
            className="registrar-remove-curriculum-subject__button registrar-remove-curriculum-subject__button--secondary"
            onClick={onClose}
            disabled={removing}
          >
            Cancel
          </button>
          <button
            type="button"
            className="registrar-remove-curriculum-subject__button registrar-remove-curriculum-subject__button--danger"
            onClick={handleRemove}
            disabled={removing || !authenticated || userRole !== "Registrar"}
          >
            {removing ? (
              <LoaderCircle size={16} className="is-spinning" />
            ) : (
              <Trash2 size={16} />
            )}
            {removing ? "Removing…" : "Remove Subject"}
          </button>
        </div>
      </div>
    </div>
  );
}
