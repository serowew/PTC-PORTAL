import { useMemo, useState } from "react";

import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";

import type { OfferingTableSubject } from "./components/OfferingTable";

// =====================================================
// API
// =====================================================

const API_BASE_URL = apiUrl("/api/registrar/offerings");

// =====================================================
// RESPONSE
// =====================================================

interface PrepareSectionSubjectsResponse {
  success: boolean;

  message?: string;

  error?: string;

  mode?: "curriculum" | "special";

  summary?: {
    requested?: number;

    created?: number;

    already_existing?: number;

    max_students?: number | null;
  };

  created?: Array<{
    section_subject_id?: number;

    section_id?: number;

    subject_id?: number;

    subject_code?: string;

    subject_name?: string;

    max_students?: number | null;

    status?: "Open" | "Closed" | "Cancelled";

    mode?: "curriculum" | "special";
  }>;

  skipped?: Array<{
    section_subject_id?: number;

    subject_id?: number;

    subject_code?: string;

    subject_name?: string;

    max_students?: number | null;

    status?: "Open" | "Closed" | "Cancelled";

    reason?: string;
  }>;
}

// =====================================================
// PROPS
// =====================================================

interface PrepareSectionSubjectsModalProps {
  open: boolean;

  academicYearId: string;

  semesterId: string;

  courseId: string;

  yearLevel: string;

  curriculumId: string;

  sectionId: string;

  academicYear: string;

  semesterName: string;

  courseCode: string;

  curriculumName: string;

  sectionName: string;

  subjects: OfferingTableSubject[];

  onClose: () => void;

  onSuccess: () => void;

  onUnauthorized: () => void;
}

// =====================================================
// SAFE JSON
// =====================================================

async function readJsonResponse<T>(response: Response): Promise<T> {
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

  return response.json() as Promise<T>;
}

// =====================================================
// COMPONENT
// =====================================================

export default function PrepareSectionSubjectsModal({
  open,

  academicYearId,

  semesterId,

  curriculumId,

  sectionId,

  academicYear,

  semesterName,

  courseCode,

  curriculumName,

  sectionName,

  subjects,

  onClose,

  onSuccess,

  onUnauthorized,
}: PrepareSectionSubjectsModalProps) {
  // =====================================================
  // STATE
  // =====================================================

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  // =====================================================
  // MISSING SECTION SUBJECTS
  // =====================================================

  const missingSubjects = useMemo(
    () => subjects.filter((item) => !item.has_section_subject),
    [subjects],
  );

  // =====================================================
  // SUBJECT IDS
  //
  // IMPORTANT:
  // Backend expects:
  //
  // subject_ids: [1, 2, 3, ...]
  //
  // These are SUBJECT IDs, not curriculum_subject_id.
  // =====================================================

  const subjectIds = useMemo(() => {
    const ids = missingSubjects
      .map((item) => Number(item.subject.subject_id))
      .filter((subjectId) => Number.isInteger(subjectId) && subjectId > 0);

    return [...new Set(ids)];
  }, [missingSubjects]);

  // =====================================================
  // VALID CONTEXT
  //
  // Curriculum-mode backend contract requires:
  // - academic_year_id
  // - semester_id
  // - curriculum_id
  // - section_id
  // - subject_ids
  //
  // course_id and year_level are deliberately NOT sent.
  // The backend derives those constraints from the selected
  // section and validates the curriculum subjects against
  // section.year_level + selected semester.
  // =====================================================

  const hasValidContext = useMemo(() => {
    const ids = [academicYearId, semesterId, curriculumId, sectionId].map(
      Number,
    );

    return ids.every((value) => Number.isInteger(value) && value > 0);
  }, [academicYearId, semesterId, curriculumId, sectionId]);

  // =====================================================
  // CLOSE
  // =====================================================

  const handleClose = () => {
    if (loading) {
      return;
    }

    setError("");

    onClose();
  };

  // =====================================================
  // PREPARE
  // =====================================================

  const handlePrepare = async () => {
    // =================================================
    // VALIDATE ACADEMIC CONTEXT
    // =================================================

    if (!hasValidContext) {
      setError("Academic setup is incomplete.");

      return;
    }

    // =================================================
    // VALIDATE MISSING SUBJECTS
    // =================================================

    if (missingSubjects.length === 0) {
      setError("There are no missing section subjects to prepare.");

      return;
    }

    // =================================================
    // VALIDATE SUBJECT IDS
    // =================================================

    if (subjectIds.length === 0) {
      setError(
        "No valid subject IDs were found for the missing curriculum subjects.",
      );

      return;
    }

    try {
      setLoading(true);

      setError("");

      // =================================================
      // PAYLOAD
      // =================================================

      const payload = {
        mode: "curriculum" as const,

        academic_year_id: Number(academicYearId),

        semester_id: Number(semesterId),

        curriculum_id: Number(curriculumId),

        section_id: Number(sectionId),

        // ===============================================
        // REQUIRED BY BACKEND
        // ===============================================

        subject_ids: subjectIds,
      };

      // =================================================
      // REQUEST
      // =================================================

      const response = await authService.authFetch(
        `${API_BASE_URL}/section-subjects`,
        {
          method: "POST",

          headers: {
            Accept: "application/json",

            "Content-Type": "application/json",
          },

          body: JSON.stringify(payload),
        },
      );

      const data =
        await readJsonResponse<PrepareSectionSubjectsResponse>(response);

      // =================================================
      // UNAUTHORIZED
      // =================================================

      if (response.status === 401) {
        onUnauthorized();

        return;
      }

      // =================================================
      // FORBIDDEN
      // =================================================

      if (response.status === 403) {
        throw new Error(
          data.message ||
            data.error ||
            "You are not authorized to prepare section subjects.",
        );
      }

      // =================================================
      // VALIDATION
      // =================================================

      if (response.status === 400) {
        throw new Error(
          data.message ||
            data.error ||
            "The curriculum section-subject request is invalid.",
        );
      }

      // =================================================
      // NOT FOUND
      // =================================================

      if (response.status === 404) {
        throw new Error(
          data.message ||
            data.error ||
            "The academic period, curriculum, section, or subject could not be found.",
        );
      }

      // =================================================
      // CONFLICT
      // =================================================

      if (response.status === 409) {
        throw new Error(
          data.message ||
            data.error ||
            "One or more section subjects could not be prepared because they conflict with existing records.",
        );
      }

      // =================================================
      // API ERROR
      // =================================================

      if (!response.ok || !data.success) {
        throw new Error(
          data.message || data.error || "Failed to prepare section subjects.",
        );
      }

      // =================================================
      // SUCCESS
      // =================================================

      // The backend may create some rows and skip rows that
      // already exist. Refresh from readiness/setup-data so
      // the table reflects the authoritative result.
      onSuccess();

      onClose();
    } catch (error) {
      console.error("PREPARE SECTION SUBJECTS ERROR:", error);

      setError(
        error instanceof Error
          ? error.message
          : "Unable to prepare section subjects.",
      );
    } finally {
      setLoading(false);
    }
  };

  // =====================================================
  // DO NOT RENDER
  // =====================================================

  if (!open) {
    return null;
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <div
      className="class-offering-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) {
          handleClose();
        }
      }}
    >
      <div
        className="class-offering-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prepare-section-subjects-title"
      >
        {/* ================================================= */}
        {/* HEADER */}
        {/* ================================================= */}

        <div className="class-offering-modal-header">
          <div>
            <h2 id="prepare-section-subjects-title">
              Prepare Section Subjects
            </h2>

            <p>
              Add the normal curriculum subjects for this section and academic
              term.
            </p>
          </div>

          <button
            type="button"
            aria-label="Close"
            disabled={loading}
            onClick={handleClose}
          >
            ×
          </button>
        </div>

        {/* ================================================= */}
        {/* BODY */}
        {/* ================================================= */}

        <div className="class-offering-modal-body">
          {/* =============================================== */}
          {/* CONTEXT */}
          {/* =============================================== */}

          <div className="class-offering-prepare-context">
            <div>
              <span>Section</span>

              <strong>{sectionName}</strong>
            </div>

            <div>
              <span>Course</span>

              <strong>{courseCode}</strong>
            </div>

            <div>
              <span>Academic Year</span>

              <strong>{academicYear}</strong>
            </div>

            <div>
              <span>Semester</span>

              <strong>{semesterName}</strong>
            </div>

            <div className="class-offering-prepare-context-wide">
              <span>Curriculum</span>

              <strong>{curriculumName}</strong>
            </div>
          </div>

          {/* =============================================== */}
          {/* ERROR */}
          {/* =============================================== */}

          {error && <div className="class-offering-error">{error}</div>}

          {/* =============================================== */}
          {/* NOTICE */}
          {/* =============================================== */}

          <div className="class-offering-prepare-notice">
            <strong>
              {missingSubjects.length} curriculum subject
              {missingSubjects.length !== 1 ? "s" : ""} will be prepared.
            </strong>

            <p>
              This creates the missing normal curriculum section-subject records
              as Open. It does not create subject offerings yet; faculty,
              schedule, optional room, and offering capacity are configured
              afterwards.
            </p>
          </div>

          {/* =============================================== */}
          {/* SUBJECT LIST */}
          {/* =============================================== */}

          <div className="class-offering-prepare-subjects">
            <div className="class-offering-prepare-subjects-header">
              <span>Curriculum Subjects</span>

              <strong>{missingSubjects.length}</strong>
            </div>

            {missingSubjects.length > 0 ? (
              <div className="class-offering-prepare-subject-list">
                {missingSubjects.map((item) => (
                  <div
                    className="class-offering-prepare-subject-item"
                    key={item.curriculum_subject_id ?? item.subject.subject_id}
                  >
                    {/* =================================== */}
                    {/* CHECK */}
                    {/* =================================== */}

                    <div className="class-offering-prepare-check">✓</div>

                    {/* =================================== */}
                    {/* SUBJECT */}
                    {/* =================================== */}

                    <div className="class-offering-prepare-subject-info">
                      <strong>{item.subject.subject_code}</strong>

                      <span>{item.subject.subject_name}</span>
                    </div>

                    {/* =================================== */}
                    {/* UNITS */}
                    {/* =================================== */}

                    <small>
                      {item.subject.units} unit
                      {item.subject.units !== 1 ? "s" : ""}
                    </small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="class-offering-empty">
                <p>
                  All curriculum subjects have already been prepared for this
                  section.
                </p>
              </div>
            )}
          </div>

          {/* =============================================== */}
          {/* DEVELOPMENT INFORMATION */}
          {/* =============================================== */}

          {subjectIds.length > 0 && (
            <div className="class-offering-prepare-next">
              <strong>
                Subjects ready for preparation: {subjectIds.length}
              </strong>

              <p>
                After preparation, these records will become section subjects
                and the next action will be creating their class offerings.
              </p>
            </div>
          )}

          {/* =============================================== */}
          {/* NEXT STEP */}
          {/* =============================================== */}

          <div className="class-offering-prepare-next">
            <strong>What happens next?</strong>

            <p>
              After preparation, these subjects change from{" "}
              <b>NO SECTION SUBJECT</b> to <b>NO OFFERING</b>. The Registrar can
              then create each class offering with faculty, schedule, optional
              room, and capacity configuration.
            </p>
          </div>
        </div>

        {/* ================================================= */}
        {/* FOOTER */}
        {/* ================================================= */}

        <div className="class-offering-modal-footer">
          <button type="button" disabled={loading} onClick={handleClose}>
            Cancel
          </button>

          <button
            type="button"
            className="class-offering-primary-button"
            disabled={
              loading ||
              missingSubjects.length === 0 ||
              subjectIds.length === 0 ||
              !hasValidContext
            }
            onClick={handlePrepare}
          >
            {loading
              ? "Preparing..."
              : `Prepare ${missingSubjects.length} Subject${
                  missingSubjects.length !== 1 ? "s" : ""
                }`}
          </button>
        </div>
      </div>
    </div>
  );
}
