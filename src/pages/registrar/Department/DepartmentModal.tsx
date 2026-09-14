import React, { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Hash,
  Save,
  X,
} from "lucide-react";

import { authService } from "../../../services/auth.service";
import "../../../styles/DepartmentModal.css";

export interface Department {
  department_id: number;
  department_code: string;
  department_name: string;
  created_at?: string;
}

interface DepartmentModalProps {
  isOpen: boolean;
  department?: Department | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface DepartmentSaveResponse {
  success: boolean;
  message?: string;
  error?: string;
  department?: Department;
}

const API_BASE_URL = "http://localhost:3000/api/registrar/departments";

export default function DepartmentModal({
  isOpen,
  department,
  onClose,
  onSuccess,
}: DepartmentModalProps) {
  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  const [departmentCode, setDepartmentCode] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isEditMode = Boolean(department);

  useEffect(() => {
    if (!isOpen) return;

    setError("");

    if (department) {
      setDepartmentCode(department.department_code || "");
      setDepartmentName(department.department_name || "");
    } else {
      setDepartmentCode("");
      setDepartmentName("");
    }
  }, [isOpen, department]);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, saving, onClose]);

  const cleanCode = departmentCode.trim();
  const cleanName = departmentName.trim();

  const hasChanges = useMemo(() => {
    if (!isEditMode || !department) return true;

    return (
      cleanCode.toUpperCase() !==
        (department.department_code || "").trim().toUpperCase() ||
      cleanName !== (department.department_name || "").trim()
    );
  }, [cleanCode, cleanName, department, isEditMode]);

  const formReady =
    cleanCode.length > 0 &&
    cleanCode.length <= 20 &&
    cleanName.length > 0 &&
    cleanName.length <= 150 &&
    (!isEditMode || hasChanges);

  const handleClose = () => {
    if (saving) return;

    setDepartmentCode("");
    setDepartmentName("");
    setError("");
    onClose();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!authenticated || userRole !== "Registrar") {
      setError(
        "Your session has expired or you are not authorized to manage departments.",
      );
      return;
    }

    if (!cleanCode) {
      setError("Department code is required.");
      return;
    }

    if (!cleanName) {
      setError("Department name is required.");
      return;
    }

    if (cleanCode.length > 20) {
      setError("Department code cannot exceed 20 characters.");
      return;
    }

    if (cleanName.length > 150) {
      setError("Department name cannot exceed 150 characters.");
      return;
    }

    if (isEditMode && !department?.department_id) {
      setError("Invalid department selected for editing.");
      return;
    }

    if (isEditMode && !hasChanges) return;

    try {
      setSaving(true);

      const url = isEditMode
        ? `${API_BASE_URL}/${department!.department_id}`
        : API_BASE_URL;
      const method = isEditMode ? "PUT" : "POST";

      const payload = {
        department_code: cleanCode.toUpperCase(),
        department_name: cleanName,
      };

      const response = await authService.authFetch(url, {
        method,
        body: JSON.stringify(payload),
      });

      const contentType = response.headers.get("content-type") || "";
      let data: DepartmentSaveResponse | null = null;

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
            "You are not authorized to manage departments.",
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            (isEditMode
              ? `Failed to update department (${response.status}).`
              : `Failed to create department (${response.status}).`),
        );
      }

      if (!data?.success) {
        throw new Error(
          data?.message ||
            (isEditMode
              ? "Failed to update department."
              : "Failed to create department."),
        );
      }

      setDepartmentCode("");
      setDepartmentName("");
      setError("");
      onSuccess();
    } catch (err) {
      console.error("SAVE DEPARTMENT ERROR:", err);

      if (err instanceof TypeError) {
        setError(
          "Unable to connect to the department server. Make sure the backend is running on port 3000.",
        );
        return;
      }

      setError(
        err instanceof Error ? err.message : "Failed to save department.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="registrar-department-modal__overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          handleClose();
        }
      }}
    >
      <div
        className="registrar-department-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="registrar-department-modal-title"
        aria-describedby="registrar-department-modal-description"
      >
        <div className="registrar-department-modal__header">
          <div className="registrar-department-modal__header-icon">
            <Building2 size={21} aria-hidden="true" />
          </div>

          <div className="registrar-department-modal__header-copy">
            <span>{isEditMode ? "Update record" : "New record"}</span>
            <h2 id="registrar-department-modal-title">
              {isEditMode ? "Edit Department" : "Add Department"}
            </h2>
            <p id="registrar-department-modal-description">
              {isEditMode
                ? "Update the official code or name for this academic department."
                : "Create an academic department that can be referenced by courses and other portal records."}
            </p>
          </div>

          <button
            type="button"
            className="registrar-department-modal__close"
            onClick={handleClose}
            disabled={saving}
            aria-label="Close department dialog"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form className="registrar-department-modal__form" onSubmit={handleSubmit}>
          {error && (
            <div className="registrar-department-modal__message registrar-department-modal__message--error" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <div>
                <strong>Department could not be saved</strong>
                <span>{error}</span>
              </div>
            </div>
          )}

          <div className="registrar-department-modal__context">
            <CheckCircle2 size={17} aria-hidden="true" />
            <p>
              Keep department information concise and official. The same record
              may appear in Courses, user assignments, and other academic areas.
            </p>
          </div>

          <div className="registrar-department-modal__fields">
            <div className="registrar-department-modal__field">
              <div className="registrar-department-modal__label-row">
                <label htmlFor="registrar-department-code">
                  Department Code <span aria-hidden="true">*</span>
                </label>
                <small>{departmentCode.length}/20</small>
              </div>

              <div className="registrar-department-modal__input-wrap registrar-department-modal__input-wrap--code">
                <Hash size={16} aria-hidden="true" />
                <input
                  id="registrar-department-code"
                  type="text"
                  value={departmentCode}
                  onChange={(event) =>
                    setDepartmentCode(event.target.value.toUpperCase())
                  }
                  placeholder="e.g. CCIS"
                  maxLength={20}
                  disabled={saving}
                  autoComplete="off"
                  autoFocus
                  required
                />
              </div>
              <small className="registrar-department-modal__help">
                Use the official short code. It will be saved in uppercase.
              </small>
            </div>

            <div className="registrar-department-modal__field">
              <div className="registrar-department-modal__label-row">
                <label htmlFor="registrar-department-name">
                  Department Name <span aria-hidden="true">*</span>
                </label>
                <small>{departmentName.length}/150</small>
              </div>

              <div className="registrar-department-modal__input-wrap">
                <Building2 size={16} aria-hidden="true" />
                <input
                  id="registrar-department-name"
                  type="text"
                  value={departmentName}
                  onChange={(event) => setDepartmentName(event.target.value)}
                  placeholder="e.g. College of Computer Studies"
                  maxLength={150}
                  disabled={saving}
                  autoComplete="off"
                  required
                />
              </div>
              <small className="registrar-department-modal__help">
                Enter the complete official department or college name.
              </small>
            </div>
          </div>

          {isEditMode && !hasChanges && (
            <div className="registrar-department-modal__unchanged-note">
              No changes have been made to this department yet.
            </div>
          )}

          <div className="registrar-department-modal__actions">
            <button
              type="button"
              className="registrar-department-modal__button registrar-department-modal__button--secondary"
              onClick={handleClose}
              disabled={saving}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="registrar-department-modal__button registrar-department-modal__button--primary"
              disabled={
                saving ||
                !authenticated ||
                userRole !== "Registrar" ||
                !formReady
              }
            >
              <Save size={16} aria-hidden="true" />
              {saving
                ? "Saving..."
                : isEditMode
                  ? "Save Changes"
                  : "Add Department"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
