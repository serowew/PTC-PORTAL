import { useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Loader2,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";

import { authService } from "../../../services/auth.service";
import type { Subject } from "./Subjectmodal";
import "../../../styles/DeleteSubjectModalR.css";

interface DeleteSubjectModalProps {
  isOpen: boolean;
  subject: Subject | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface DeleteSubjectResponse {
  success: boolean;
  message?: string;
  error?: string;
}

const API_BASE_URL = "http://localhost:3000/api/registrar/subjects";

export default function DeleteSubjectModal({
  isOpen,
  subject,
  onClose,
  onSuccess,
}: DeleteSubjectModalProps) {
  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setError("");
  }, [isOpen, subject?.subject_id]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, deleting, onClose]);

  if (!isOpen || !subject) return null;

  const handleDelete = async () => {
    setError("");

    if (!authenticated || userRole !== "Registrar") {
      setError(
        "Your session has expired or you are not authorized to delete subjects.",
      );
      return;
    }

    const subjectId = Number(subject.subject_id);

    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      setError("Invalid subject ID.");
      return;
    }

    try {
      setDeleting(true);

      const response = await authService.authFetch(
        `${API_BASE_URL}/${subjectId}`,
        {
          method: "DELETE",
          headers: { Accept: "application/json" },
        },
      );

      const contentType = response.headers.get("content-type") || "";
      let data: DeleteSubjectResponse | null = null;

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
            "You are not authorized to delete subjects.",
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to delete subject (${response.status}).`,
        );
      }

      if (!data?.success) {
        throw new Error(data?.message || "Failed to delete subject.");
      }

      onSuccess();
    } catch (err) {
      console.error("DELETE SUBJECT ERROR:", err);

      if (err instanceof TypeError) {
        setError(
          "Unable to connect to the subject server. Make sure the backend is running on port 3000.",
        );
        return;
      }

      setError(err instanceof Error ? err.message : "Failed to delete subject.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="registrar-delete-subject__overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) onClose();
      }}
    >
      <section
        className="registrar-delete-subject"
        role="dialog"
        aria-modal="true"
        aria-labelledby="registrar-delete-subject-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="registrar-delete-subject__header">
          <span className="registrar-delete-subject__header-icon">
            <Trash2 size={19} aria-hidden="true" />
          </span>
          <div>
            <span>Permanent Action</span>
            <h2 id="registrar-delete-subject-title">Delete Subject?</h2>
          </div>
          <button
            type="button"
            className="registrar-delete-subject__close"
            onClick={onClose}
            disabled={deleting}
            aria-label="Close delete subject dialog"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="registrar-delete-subject__body">
          <p className="registrar-delete-subject__intro">
            Confirm that you want to permanently remove this master subject from
            the system.
          </p>

          <div className="registrar-delete-subject__subject-card">
            <span className="registrar-delete-subject__subject-icon">
              <BookOpen size={20} aria-hidden="true" />
            </span>
            <div>
              <strong>{subject.subject_code}</strong>
              <span>{subject.subject_name}</span>
            </div>
            <div className="registrar-delete-subject__units">
              <strong>{subject.units}</strong>
              <span>{Number(subject.units) === 1 ? "unit" : "units"}</span>
            </div>
          </div>

          <div className="registrar-delete-subject__protection">
            <ShieldAlert size={19} aria-hidden="true" />
            <div>
              <strong>Referenced subjects are protected</strong>
              <p>
                If this subject is already used by a curriculum, enrollment,
                prerequisite, class offering, or another academic record, the
                backend will block deletion and keep the subject intact.
              </p>
            </div>
          </div>

          <div className="registrar-delete-subject__warning">
            <AlertTriangle size={18} aria-hidden="true" />
            <p>
              If the subject is unused, deletion is permanent and cannot be
              undone from this page.
            </p>
          </div>

          {error && (
            <div className="registrar-delete-subject__error" role="alert">
              <AlertCircle size={17} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <footer className="registrar-delete-subject__footer">
          <button
            type="button"
            className="registrar-delete-subject__button registrar-delete-subject__button--secondary"
            onClick={onClose}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="registrar-delete-subject__button registrar-delete-subject__button--danger"
            onClick={() => void handleDelete()}
            disabled={deleting || !authenticated || userRole !== "Registrar"}
          >
            {deleting ? (
              <>
                <Loader2 size={16} className="is-spinning" aria-hidden="true" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 size={16} aria-hidden="true" />
                Delete Subject
              </>
            )}
          </button>
        </footer>
      </section>
    </div>
  );
}
