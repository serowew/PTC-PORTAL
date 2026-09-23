import { useEffect, useState } from "react";

import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";

import type { OfferingTableSubject } from "./components/OfferingTable";

// =====================================================
// API
// =====================================================

const API_BASE_URL = apiUrl("/api/registrar/offerings");

// =====================================================
// TYPES
// =====================================================

type SectionSubjectStatus = "Open" | "Closed" | "Cancelled";

// =====================================================
// RESPONSE
// =====================================================

interface UpdateSectionSubjectStatusResponse {
  success: boolean;

  message?: string;

  error?: string;

  changed?: boolean;

  reason?: string;

  required_action?: string;

  enrollment_counts?: {
    pending?: number;

    approved?: number;

    active?: number;
  };

  offering?: {
    offering_id?: number;

    status?: "Open" | "Closed" | "Cancelled" | null;
  };

  section_subject?: {
    section_subject_id?: number;

    status?: SectionSubjectStatus;

    previous_status?: SectionSubjectStatus;

    linked_offering?: {
      offering_id?: number | null;

      status?: "Open" | "Closed" | "Cancelled" | null;
    };

    enrollment_counts?: {
      pending?: number;

      approved?: number;

      active?: number;
    };

    [key: string]: unknown;
  } | null;
}

// =====================================================
// BACKEND BLOCK DETAILS
// =====================================================

interface SectionSubjectBlockDetails {
  pendingAssignments: number | null;

  approvedAssignments: number | null;

  activeAssignments: number | null;

  requiredAction: string | null;

  linkedOffering: {
    offeringId: number | null;

    status: string | null;
  } | null;
}

function emptyBlockDetails(): SectionSubjectBlockDetails {
  return {
    pendingAssignments: null,

    approvedAssignments: null,

    activeAssignments: null,

    requiredAction: null,

    linkedOffering: null,
  };
}

// =====================================================
// PROPS
// =====================================================

interface SectionSubjectStatusModalProps {
  open: boolean;

  subject: OfferingTableSubject | null;

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

export default function SectionSubjectStatusModal({
  open,

  subject,

  onClose,

  onSuccess,

  onUnauthorized,
}: SectionSubjectStatusModalProps) {
  // =====================================================
  // CURRENT SECTION SUBJECT
  // =====================================================

  const sectionSubject = subject?.section_subject || null;

  const sectionSubjectId = sectionSubject?.section_subject_id;

  const currentStatus: SectionSubjectStatus =
    sectionSubject?.status === "Open" ||
    sectionSubject?.status === "Closed" ||
    sectionSubject?.status === "Cancelled"
      ? sectionSubject.status
      : "Closed";

  const isCancelled = currentStatus === "Cancelled";

  const linkedOffering = subject?.offering || null;

  const linkedOfferingOpen = linkedOffering?.status === "Open";

  // =====================================================
  // NORMAL LIFECYCLE
  //
  // Open   -> Closed
  // Closed -> Open
  // Cancelled -> no normal action in this UI
  // =====================================================

  const normalTargetStatus: SectionSubjectStatus | null =
    currentStatus === "Open"
      ? "Closed"
      : currentStatus === "Closed"
        ? "Open"
        : null;

  // =====================================================
  // UI STATE
  // =====================================================

  const [cancelMode, setCancelMode] = useState(false);

  const [reason, setReason] = useState("");

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [backendDetails, setBackendDetails] =
    useState<SectionSubjectBlockDetails>(emptyBlockDetails);

  // =====================================================
  // RESET
  // =====================================================

  useEffect(() => {
    if (!open || !sectionSubjectId) {
      return;
    }

    setCancelMode(false);

    setReason("");

    setLoading(false);

    setError("");

    setBackendDetails(emptyBlockDetails());
  }, [open, sectionSubjectId]);

  // =====================================================
  // DISPLAY
  // =====================================================

  const modalTitle = cancelMode
    ? "Cancel Section Subject"
    : currentStatus === "Open"
      ? "Close Section Subject"
      : currentStatus === "Closed"
        ? "Open Section Subject"
        : "Cancelled Section Subject";

  const modalDescription = cancelMode
    ? "Confirm permanent cancellation of this section subject."
    : currentStatus === "Open"
      ? "Close this subject for the selected section and academic term."
      : currentStatus === "Closed"
        ? "Open this subject for the selected section and academic term."
        : "This section subject is currently Cancelled.";

  const normalButtonText =
    normalTargetStatus === "Open"
      ? "Open Section Subject"
      : normalTargetStatus === "Closed"
        ? "Close Section Subject"
        : "";

  // =====================================================
  // CLEAR FEEDBACK
  // =====================================================

  const clearFeedback = () => {
    setError("");

    setBackendDetails(emptyBlockDetails());
  };

  // =====================================================
  // CLOSE
  // =====================================================

  const handleClose = () => {
    if (loading) {
      return;
    }

    clearFeedback();

    setCancelMode(false);

    setReason("");

    onClose();
  };

  // =====================================================
  // CANCELLATION MODE
  // =====================================================

  const beginCancellation = () => {
    if (loading || isCancelled) {
      return;
    }

    clearFeedback();

    setReason("");

    setCancelMode(true);
  };

  const leaveCancellation = () => {
    if (loading) {
      return;
    }

    clearFeedback();

    setReason("");

    setCancelMode(false);
  };

  // =====================================================
  // CAPTURE BACKEND DETAILS
  // =====================================================

  const captureBackendDetails = (data: UpdateSectionSubjectStatusResponse) => {
    const counts = data.enrollment_counts;

    const offering = data.offering;

    setBackendDetails({
      pendingAssignments:
        typeof counts?.pending === "number" ? counts.pending : null,

      approvedAssignments:
        typeof counts?.approved === "number" ? counts.approved : null,

      activeAssignments:
        typeof counts?.active === "number" ? counts.active : null,

      requiredAction:
        typeof data.required_action === "string" && data.required_action.trim()
          ? data.required_action.trim()
          : null,

      linkedOffering: offering
        ? {
            offeringId:
              typeof offering.offering_id === "number"
                ? offering.offering_id
                : null,

            status:
              typeof offering.status === "string" ? offering.status : null,
          }
        : null,
    });
  };

  // =====================================================
  // UPDATE STATUS
  //
  // Backend is authoritative for protection rules.
  //
  // Contract confirmed at runtime:
  // Cancelled requires a non-empty reason.
  // =====================================================

  const updateStatus = async (targetStatus: SectionSubjectStatus) => {
    if (!subject || !sectionSubject || !sectionSubjectId) {
      setError("A valid section subject is required.");

      return;
    }

    if (loading) {
      return;
    }

    if (currentStatus === "Cancelled") {
      setError(
        "This section subject is Cancelled and cannot return to Open or Closed.",
      );

      return;
    }

    if (
      (targetStatus === "Closed" || targetStatus === "Cancelled") &&
      linkedOfferingOpen
    ) {
      setError(
        targetStatus === "Closed"
          ? "Close the linked subject offering before closing this section subject."
          : "Close or cancel the linked subject offering before cancelling this section subject.",
      );

      return;
    }

    if (targetStatus === currentStatus) {
      setError(`The section subject is already ${currentStatus}.`);

      return;
    }

    if (targetStatus === "Cancelled" && reason.trim().length === 0) {
      setError("A reason is required when cancelling a section subject.");

      return;
    }

    try {
      setLoading(true);

      clearFeedback();

      const payload: {
        status: SectionSubjectStatus;

        reason?: string;
      } = {
        status: targetStatus,
      };

      if (targetStatus === "Cancelled") {
        payload.reason = reason.trim();
      }

      console.log("UPDATE SECTION SUBJECT STATUS:", {
        section_subject_id: sectionSubjectId,

        current_status: currentStatus,

        target_status: targetStatus,

        payload,
      });

      const response = await authService.authFetch(
        `${API_BASE_URL}/section-subjects/${sectionSubjectId}/status`,
        {
          method: "PATCH",

          headers: {
            Accept: "application/json",

            "Content-Type": "application/json",
          },

          body: JSON.stringify(payload),
        },
      );

      const data =
        await readJsonResponse<UpdateSectionSubjectStatusResponse>(response);

      // ===============================================
      // 401
      // ===============================================

      if (response.status === 401) {
        onUnauthorized();

        return;
      }

      // ===============================================
      // 403
      // ===============================================

      if (response.status === 403) {
        setError(
          data.message ||
            data.error ||
            "You are not authorized to change section subject status.",
        );

        return;
      }

      // ===============================================
      // 404
      // ===============================================

      if (response.status === 404) {
        setError(
          data.message ||
            data.error ||
            "The section subject could not be found.",
        );

        return;
      }

      // ===============================================
      // BUSINESS-RULE / VALIDATION BLOCK
      //
      // The exact protection logic belongs to backend.
      // Display the backend's authoritative explanation.
      // ===============================================

      if (response.status === 400 || response.status === 409) {
        captureBackendDetails(data);

        setError(
          data.message ||
            data.error ||
            "The section subject status could not be changed.",
        );

        console.log("SECTION SUBJECT STATUS BLOCKED:", data);

        return;
      }

      // ===============================================
      // GENERAL ERROR
      // ===============================================

      if (!response.ok || !data.success) {
        captureBackendDetails(data);

        setError(
          data.message ||
            data.error ||
            "Failed to update section subject status.",
        );

        return;
      }

      // ===============================================
      // SUCCESS
      // ===============================================

      console.log("UPDATE SECTION SUBJECT STATUS SUCCESS:", data);

      onSuccess();

      onClose();
    } catch (requestError) {
      console.error("UPDATE SECTION SUBJECT STATUS ERROR:", requestError);

      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to update section subject status.",
      );
    } finally {
      setLoading(false);
    }
  };

  // =====================================================
  // ACTIONS
  // =====================================================

  const handleNormalStatusChange = () => {
    if (!normalTargetStatus) {
      return;
    }

    void updateStatus(normalTargetStatus);
  };

  const handleCancellation = () => {
    void updateStatus("Cancelled");
  };

  // =====================================================
  // BACKEND DETAIL ROWS
  // =====================================================

  const hasBackendDetails =
    backendDetails.pendingAssignments !== null ||
    backendDetails.approvedAssignments !== null ||
    backendDetails.activeAssignments !== null ||
    backendDetails.requiredAction !== null ||
    backendDetails.linkedOffering !== null;

  const closeBlockedByOpenOffering =
    normalTargetStatus === "Closed" && linkedOfferingOpen;

  const cancellationBlockedByOpenOffering = cancelMode && linkedOfferingOpen;

  // =====================================================
  // DO NOT RENDER
  // =====================================================

  if (!open || !subject || !sectionSubject) {
    return null;
  }

  // =====================================================
  // RENDER
  //
  // Reuse the already-proven modal scroll behavior.
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
        className="class-offering-modal class-offering-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="section-subject-status-title"
      >
        {/* ================================================= */}
        {/* HEADER */}
        {/* ================================================= */}

        <div className="class-offering-modal-header">
          <div>
            <h2 id="section-subject-status-title">{modalTitle}</h2>

            <p>{modalDescription}</p>
          </div>

          <button
            type="button"
            aria-label="Close section subject status modal"
            disabled={loading}
            onClick={handleClose}
          >
            ×
          </button>
        </div>

        {/* ================================================= */}
        {/* SUBJECT */}
        {/* ================================================= */}

        <div className="class-offering-modal-subject">
          <div>
            <strong>{subject.subject.subject_code}</strong>

            <span>
              {" — "}
              {subject.subject.subject_name}
            </span>
          </div>

          <small>
            Section Subject #{sectionSubject.section_subject_id} ·{" "}
            {currentStatus}
          </small>
        </div>

        {/* ================================================= */}
        {/* ERROR */}
        {/* ================================================= */}

        {error && <div className="class-offering-error">{error}</div>}

        {/* ================================================= */}
        {/* BODY */}
        {/* ================================================= */}

        <div className="class-offering-modal-body">
          {/* =============================================== */}
          {/* CURRENT STATE */}
          {/* =============================================== */}

          <div className="class-offering-prepare-notice">
            <strong>Current section subject status: {currentStatus}</strong>

            <p>
              Section capacity: {sectionSubject.max_students ?? 0} · Offering:{" "}
              {linkedOffering
                ? `#${linkedOffering.offering_id} (${linkedOffering.status})`
                : "No offering created"}
            </p>
          </div>

          {/* =============================================== */}
          {/* BACKEND PROTECTION DETAILS */}
          {/* =============================================== */}

          {hasBackendDetails && (
            <div className="class-offering-open-requirements">
              <h3>Status Change Blocked</h3>

              <ul>
                {backendDetails.linkedOffering && (
                  <li>
                    Linked offering:{" "}
                    {backendDetails.linkedOffering.offeringId !== null
                      ? `#${backendDetails.linkedOffering.offeringId}`
                      : "Existing offering"}
                    {backendDetails.linkedOffering.status
                      ? ` (${backendDetails.linkedOffering.status})`
                      : ""}
                  </li>
                )}

                {backendDetails.pendingAssignments !== null && (
                  <li>
                    Pending assignments: {backendDetails.pendingAssignments}
                  </li>
                )}

                {backendDetails.approvedAssignments !== null && (
                  <li>
                    Approved assignments: {backendDetails.approvedAssignments}
                  </li>
                )}

                {backendDetails.activeAssignments !== null && (
                  <li>
                    Active assignments: {backendDetails.activeAssignments}
                  </li>
                )}
              </ul>

              {backendDetails.requiredAction && (
                <p>
                  <strong>Required action:</strong>{" "}
                  {backendDetails.requiredAction}
                </p>
              )}
            </div>
          )}

          {/* =============================================== */}
          {/* CANCELLED */}
          {/* =============================================== */}

          {isCancelled && (
            <div className="class-offering-open-requirements">
              <h3>Cancelled Section Subject</h3>

              <p>
                This section subject is currently Cancelled. Normal Open and
                Close actions are not shown in this UI.
              </p>
            </div>
          )}

          {/* =============================================== */}
          {/* OPEN -> CLOSED */}
          {/* =============================================== */}

          {!isCancelled && !cancelMode && normalTargetStatus === "Closed" && (
            <>
              <div className="class-offering-open-requirements">
                <h3>Before Closing</h3>

                <ul>
                  <li>
                    This subject will stop being considered Open for this
                    section and academic term.
                  </li>

                  <li>
                    A Closed section subject prevents its offering from being
                    treated as ready for normal enrollment assignment.
                  </li>

                  <li>The linked offering must not still be Open.</li>

                  <li>
                    Pending enrollment assignments must be resolved before the
                    section subject can be closed.
                  </li>

                  <li>
                    Approved students may remain when closing; closing stops
                    future readiness without deleting official enrollment.
                  </li>
                </ul>
              </div>

              {closeBlockedByOpenOffering && (
                <div className="class-offering-error">
                  Close the linked offering first. The backend does not allow
                  section_subject = Closed while its offering is still Open.
                </div>
              )}

              <div className="class-offering-prepare-notice">
                <strong>Close this section subject?</strong>

                <p>
                  Click Close Section Subject below to send the status change to
                  the backend.
                </p>
              </div>
            </>
          )}

          {/* =============================================== */}
          {/* CLOSED -> OPEN */}
          {/* =============================================== */}

          {!isCancelled && !cancelMode && normalTargetStatus === "Open" && (
            <>
              <div className="class-offering-open-requirements">
                <h3>Before Opening</h3>

                <ul>
                  <li>
                    This subject becomes Open for this section and academic
                    term.
                  </li>

                  <li>
                    Opening the section subject does not automatically open a
                    Closed subject offering.
                  </li>

                  <li>
                    Offering readiness still depends on the offering's own
                    configuration and status.
                  </li>

                  <li>
                    The backend remains authoritative for any protection rules.
                  </li>
                </ul>
              </div>

              <div className="class-offering-prepare-notice">
                <strong>Open this section subject?</strong>

                <p>
                  Click Open Section Subject below to confirm the status change.
                </p>
              </div>
            </>
          )}

          {/* =============================================== */}
          {/* CANCEL CONFIRMATION */}
          {/* =============================================== */}

          {!isCancelled && cancelMode && (
            <>
              <div className="class-offering-open-requirements">
                <h3>Cancellation Warning</h3>

                <ul>
                  <li>
                    Cancelled removes this section subject from normal active
                    use.
                  </li>

                  <li>
                    Cancellation is terminal. A Cancelled section subject is not
                    silently reopened later.
                  </li>

                  <li>
                    The linked offering must be Closed or Cancelled first; it
                    cannot remain Open.
                  </li>

                  <li>
                    No active Pending or Approved student assignments may
                    remain.
                  </li>

                  <li>
                    Use Closed instead if this subject may need to be activated
                    again later.
                  </li>
                </ul>
              </div>

              {cancellationBlockedByOpenOffering && (
                <div className="class-offering-error">
                  Close or cancel the linked offering before cancelling this
                  section subject.
                </div>
              )}

              <div className="class-offering-field">
                <label htmlFor="section-subject-cancellation-reason">
                  Cancellation Reason
                </label>

                <textarea
                  id="section-subject-cancellation-reason"
                  value={reason}
                  disabled={loading}
                  placeholder="Explain why this section subject is being cancelled."
                  onChange={(event) => {
                    setReason(event.target.value);

                    clearFeedback();
                  }}
                />

                <small>
                  Required. This reason will be sent to the backend with the
                  cancellation request.
                </small>
              </div>
            </>
          )}
        </div>

        {/* ================================================= */}
        {/* FOOTER */}
        {/* ================================================= */}

        <div className="class-offering-modal-footer">
          {isCancelled ? (
            <button type="button" disabled={loading} onClick={handleClose}>
              Close Modal
            </button>
          ) : cancelMode ? (
            <>
              <button
                type="button"
                disabled={loading}
                onClick={leaveCancellation}
              >
                Back
              </button>

              <button
                type="button"
                className="class-offering-primary-button"
                disabled={
                  loading || reason.trim().length === 0 || linkedOfferingOpen
                }
                onClick={handleCancellation}
              >
                {loading ? "Cancelling..." : "Confirm Cancellation"}
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={loading} onClick={handleClose}>
                Close Modal
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={beginCancellation}
              >
                Cancel Section Subject
              </button>

              <button
                type="button"
                className="class-offering-primary-button"
                disabled={
                  loading ||
                  !normalTargetStatus ||
                  (normalTargetStatus === "Closed" && linkedOfferingOpen)
                }
                onClick={handleNormalStatusChange}
              >
                {loading ? "Updating..." : normalButtonText}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
