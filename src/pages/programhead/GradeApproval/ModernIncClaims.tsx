import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  ClipboardCheck,
} from "lucide-react";

import { authService } from "../../../services/auth.service";
import { api } from "../../../services/api";

import "../../../styles/ModernIncClaims.css";

const CLAIMS_API = api.url("/api/program-head/gradebook/inc-completion-claims");

type ReviewDecision = "verify" | "reject";

interface IncClaim {
  claim_id: string;
  grade_id: number;
  offering_id: number;
  enrollment_subject_id: number;
  student_number: string;
  student_name: string;
  claimed_completed_on: string;
  verification_status: string;
  record_version: number;
  source_workflow: string;
  review_readiness_supported: boolean;
  evidence_summary?: string;
}

interface ClaimsResponse {
  success: boolean;
  claims: IncClaim[];
  has_more?: boolean;
  message?: string;
  code?: string;
}

interface ClaimReadiness {
  success: boolean;
  source_verified: boolean;
  source_workflow: string;
  claim: IncClaim;

  initial_completion_reason: string | null;

  official_sheet: {
    sheet_id: string | null;
    original_official_submitted_on: string | null;
    inc_completion_deadline_on: string | null;
    deadline_established: boolean;
  };

  review: {
    can_review: boolean;
    can_verify: boolean;
    can_reject: boolean;
    blockers: {
      code: string;
      message: string;
    }[];
    verification_blockers: {
      code: string;
      message: string;
    }[];
  };

  message?: string;
  code?: string;
}

interface ReviewResponse {
  success: boolean;
  dry_run: boolean;
  persisted: boolean;
  decision: "VERIFY" | "REJECT";
  official_grade_unchanged: boolean;

  claim?: {
    claim_id: string;
    grade_id: number;
    verification_status: string;
    record_version: number;
  };

  message?: string;
  code?: string;
}

function validRemarks(value: string) {
  const text = value.trim();

  const invalidCharacters = Array.from(text).some((character) => {
    const code = character.charCodeAt(0);

    return (
      code <= 8 ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    );
  });

  return text.length >= 15 && text.length <= 2000 && !invalidCharacters;
}

function ModernIncClaims() {
  const navigate = useNavigate();

  const [claims, setClaims] = useState<IncClaim[]>([]);
  const [readiness, setReadiness] = useState<ClaimReadiness | null>(null);

  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [hasMore, setHasMore] = useState(false);

  const [decision, setDecision] = useState<ReviewDecision>("verify");

  const [verifiedDate, setVerifiedDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [confirmedEvidence, setConfirmedEvidence] = useState(false);

  const [validatedFingerprint, setValidatedFingerprint] = useState<
    string | null
  >(null);

  const detailRequest = useRef<AbortController | null>(null);
  const savingRef = useRef(false);

  const requestJson = useCallback(
    async <T,>(url: string, options?: RequestInit): Promise<T> => {
      const response = await authService.authFetch(url, options);

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });

        throw new Error("Your session has expired.");
      }

      const data = await response.json();

      if (!response.ok || data.success !== true) {
        throw new Error(
          data.message || data.code || "Unable to process the INC request.",
        );
      }

      return data as T;
    },
    [navigate],
  );

  const loadClaims = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");

      try {
        const data = await requestJson<ClaimsResponse>(
          `${CLAIMS_API}?verification_status=PENDING_VERIFICATION`,
          { signal },
        );

        if (signal?.aborted) return;

        if (!Array.isArray(data.claims)) {
          throw new Error("Invalid completion claim response.");
        }

        setClaims(
          data.claims.filter(
            (claim) =>
              claim.source_workflow === "MODERN_COMBINED_INC" &&
              claim.review_readiness_supported,
          ),
        );

        setHasMore(data.has_more === true);
      } catch (caught) {
        if (!signal?.aborted) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load completion claims.",
          );
        }
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [requestJson],
  );

  useEffect(() => {
    const controller = new AbortController();

    void loadClaims(controller.signal);

    return () => {
      controller.abort();
      detailRequest.current?.abort();
    };
  }, [loadClaims]);

  function resetReview() {
    setReadiness(null);
    setDecision("verify");
    setVerifiedDate("");
    setRemarks("");
    setConfirmedEvidence(false);
    setValidatedFingerprint(null);
  }

  async function openClaim(claim: IncClaim) {
    if (savingRef.current) return;

    detailRequest.current?.abort();

    const controller = new AbortController();
    detailRequest.current = controller;

    resetReview();
    setError("");
    setSuccess("");
    setDetailLoading(true);

    try {
      const data = await requestJson<ClaimReadiness>(
        `${CLAIMS_API}/${claim.claim_id}/review-readiness`,
        { signal: controller.signal },
      );

      if (controller.signal.aborted) return;

      if (
        data.claim?.claim_id !== claim.claim_id ||
        Number(data.claim.grade_id) !== Number(claim.grade_id) ||
        data.source_workflow !== "MODERN_COMBINED_INC" ||
        data.source_verified !== true
      ) {
        throw new Error(
          "The original official INC record could not be verified.",
        );
      }

      setReadiness(data);
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load claim details.",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setDetailLoading(false);
      }
    }
  }

  const fingerprint = JSON.stringify({
    claimId: readiness?.claim.claim_id,
    version: readiness?.claim.record_version,
    decision,
    date: decision === "verify" ? verifiedDate : null,
    remarks: remarks.trim(),
    confirmedEvidence: decision === "verify" ? confirmedEvidence : false,
  });

  const canValidate =
    readiness !== null &&
    readiness.source_verified &&
    !busy &&
    !loading &&
    !detailLoading &&
    readiness.claim.verification_status === "PENDING_VERIFICATION" &&
    validRemarks(remarks) &&
    (decision === "verify"
      ? readiness.review.can_verify &&
        /^\d{4}-\d{2}-\d{2}$/.test(verifiedDate) &&
        confirmedEvidence
      : readiness.review.can_reject);

  const canSubmit = canValidate && validatedFingerprint === fingerprint;

  async function processReview(dryRun: boolean) {
    if (!readiness || savingRef.current) return;

    if (dryRun ? !canValidate : !canSubmit) return;

    savingRef.current = true;

    setBusy(true);
    setError("");
    setSuccess("");
    setValidatedFingerprint(null);

    const selectedClaim = readiness.claim;

    try {
      const body = {
        expected_grade_id: selectedClaim.grade_id,
        expected_record_version: selectedClaim.record_version,
        verification_remarks: remarks.trim(),
        dry_run: dryRun,

        ...(decision === "verify"
          ? {
              verified_completed_on: verifiedDate,
              confirm_verified_completion_evidence: confirmedEvidence,
            }
          : {}),
      };

      const result = await requestJson<ReviewResponse>(
        `${CLAIMS_API}/${selectedClaim.claim_id}/${decision}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );

      const expectedStatus =
        decision === "reject"
          ? ["REJECTED"]
          : ["VERIFIED_TIMELY", "VERIFIED_LATE"];

      if (
        result.dry_run !== dryRun ||
        result.persisted !== !dryRun ||
        result.decision !== (decision === "verify" ? "VERIFY" : "REJECT") ||
        result.official_grade_unchanged !== true ||
        result.claim?.claim_id !== selectedClaim.claim_id ||
        Number(result.claim?.grade_id) !== Number(selectedClaim.grade_id) ||
        Number(result.claim?.record_version) !==
          Number(selectedClaim.record_version) + 1 ||
        !expectedStatus.includes(result.claim?.verification_status ?? "")
      ) {
        throw new Error(
          "The server did not confirm the expected review result.",
        );
      }

      if (dryRun) {
        setValidatedFingerprint(fingerprint);
        return;
      }

      const status = result.claim.verification_status;

      setSuccess(
        status === "VERIFIED_TIMELY"
          ? "Completion claim verified as timely."
          : status === "VERIFIED_LATE"
            ? "Completion claim verified as late."
            : "Completion claim rejected.",
      );

      setClaims((current) =>
        current.filter((claim) => claim.claim_id !== selectedClaim.claim_id),
      );

      resetReview();

      await loadClaims();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to complete the claim review.",
      );
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="ph-modern-inc">
      <div className="ph-modern-inc-heading">
        <span className="ph-modern-inc-icon">
          <ClipboardCheck size={21} />
        </span>

        <div>
          <h2>INC Completion Claims</h2>

          <p>Verify documented completion requirements submitted by Faculty.</p>
        </div>

        <span className="ph-modern-inc-count">{claims.length} Pending</span>
      </div>

      {error && (
        <div className="ph-modern-inc-error" role="alert">
          {error}
        </div>
      )}

      {success && (
        <div className="ph-modern-inc-success" role="status">
          <CheckCircle2 size={16} />
          {success}
        </div>
      )}

      {loading ? (
        <p>Loading completion claims...</p>
      ) : claims.length === 0 ? (
        <p>No pending modern INC completion claims.</p>
      ) : (
        <div className="ph-modern-inc-table-wrap">
          <table className="ph-modern-inc-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Claimed Completion</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {claims.map((claim) => (
                <tr key={claim.claim_id}>
                  <td>
                    <strong>{claim.student_name}</strong>
                    <small>{claim.student_number}</small>
                  </td>

                  <td>{claim.claimed_completed_on}</td>

                  <td>
                    <span className="ph-modern-inc-pending">
                      Pending Verification
                    </span>
                  </td>

                  <td>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void openClaim(claim)}
                    >
                      <ShieldCheck size={14} />
                      Review Claim
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {hasMore && (
            <small>
              The server result limit has been reached. Additional claims may be
              available.
            </small>
          )}
        </div>
      )}

      {detailLoading && <p>Checking official INC evidence...</p>}

      {readiness && (
        <div className="ph-modern-inc-review">
          <div className="ph-modern-inc-review-heading">
            <div>
              <h3>{readiness.claim.student_name}</h3>
              <small>{readiness.claim.student_number}</small>
            </div>

            <button type="button" disabled={busy} onClick={resetReview}>
              Close Review
            </button>
          </div>

          <div className="ph-modern-inc-details">
            <div>
              <small>Claimed Completion Date</small>
              <strong>{readiness.claim.claimed_completed_on}</strong>
            </div>

            <div>
              <small>Official Submission Date</small>
              <strong>
                {readiness.official_sheet.original_official_submitted_on ??
                  "Unavailable"}
              </strong>
            </div>

            <div>
              <small>Completion Deadline</small>
              <strong>
                {readiness.official_sheet.inc_completion_deadline_on ??
                  "Unavailable"}
              </strong>
            </div>
          </div>

          <div className="ph-modern-inc-evidence">
            <strong>Completion Reason</strong>
            <p>
              {readiness.initial_completion_reason ?? "No reason available."}
            </p>

            <strong>Supporting Evidence</strong>
            <p>
              {readiness.claim.evidence_summary ?? "No evidence available."}
            </p>
          </div>

          <fieldset disabled={busy}>
            <label>
              Review Decision
              <select
                value={decision}
                onChange={(event) => {
                  setDecision(event.target.value as ReviewDecision);

                  setValidatedFingerprint(null);
                  setConfirmedEvidence(false);
                }}
              >
                <option value="verify">Verify Completion</option>
                <option value="reject">Reject Claim</option>
              </select>
            </label>

            {decision === "verify" && (
              <>
                <label>
                  Verified Completion Date
                  <input
                    type="date"
                    value={verifiedDate}
                    onChange={(event) => {
                      setVerifiedDate(event.target.value);
                      setValidatedFingerprint(null);
                    }}
                  />
                </label>

                <label className="ph-modern-inc-checkbox">
                  <input
                    type="checkbox"
                    checked={confirmedEvidence}
                    onChange={(event) => {
                      setConfirmedEvidence(event.target.checked);
                      setValidatedFingerprint(null);
                    }}
                  />
                  I have reviewed the actual supporting evidence and verified
                  the student's completion date.
                </label>
              </>
            )}

            <label>
              Verification Remarks
              <textarea
                value={remarks}
                rows={4}
                maxLength={2000}
                placeholder="Document the evidence reviewed and the reason for your decision."
                onChange={(event) => {
                  setRemarks(event.target.value);
                  setValidatedFingerprint(null);
                }}
              />
            </label>

            <small>
              {remarks.trim().length}/2000 characters · Minimum 15 characters
            </small>

            <div className="ph-modern-inc-actions">
              <button
                type="button"
                disabled={!canValidate}
                onClick={() => void processReview(true)}
              >
                <ShieldCheck size={15} />
                Validate Review
              </button>

              <button
                type="button"
                className={
                  decision === "reject"
                    ? "ph-modern-inc-reject"
                    : "ph-modern-inc-confirm"
                }
                disabled={!canSubmit}
                onClick={() => void processReview(false)}
              >
                {decision === "verify" ? (
                  <CheckCircle2 size={15} />
                ) : (
                  <XCircle size={15} />
                )}

                {busy
                  ? "Processing..."
                  : decision === "verify"
                    ? "Verify Completion"
                    : "Reject Claim"}
              </button>
            </div>
          </fieldset>

          {validatedFingerprint === fingerprint && (
            <p className="ph-modern-inc-success" role="status">
              Review validation passed. You may submit your decision.
            </p>
          )}

          {[
            ...readiness.review.blockers,
            ...(decision === "verify"
              ? readiness.review.verification_blockers
              : []),
          ].map((blocker, index) => (
            <p className="ph-modern-inc-error" key={`${blocker.code}-${index}`}>
              {blocker.message}
            </p>
          ))}

          <small>
            Verification does not replace or modify the student's official INC
            grade.
          </small>
        </div>
      )}
    </section>
  );
}
const REPLACEMENTS_API = api.url(
  "/api/program-head/gradebook/modern-inc-completion-submissions",
);

interface ReplacementPercent {
  exact_numerator: string;
  exact_denominator: string;
  display: string;
}

interface ReplacementSemester {
  state: string;
  semester_percentage: ReplacementPercent | null;
  numeric_equivalent: string | null;
  pass_fail: string | null;
}

interface ReplacementRow {
  submission_id: string;
  claim_id: string;
  grade_id: number;
  record_version: number;
  submission_status: string;
  offering_id: number;
  enrollment_subject_id: number;
  student_number: string;
  student_name: string;
  subject_code: string;
  subject_name: string;
  section_name: string;
  submitted_at: string;
  submission_reason: string;
  verified_completed_on: string | null;
  official_rating: string;
  calculated_midterm: ReplacementPercent | null;
  calculated_final_term: ReplacementPercent | null;
  proposed_semester: ReplacementSemester | null;

  completion_scores: {
    assessment_id: number;
    score_id: number;
    earned_score: string;
    record_version: number;
    claim_audit_verified: boolean;
  }[];

  can_validate_approval: boolean;
}

function sameReplacementSemester(
  a: ReplacementSemester | null | undefined,
  b: ReplacementSemester | null | undefined,
) {
  const x = a?.semester_percentage;
  const y = b?.semester_percentage;

  return (
    a?.state === "READY" &&
    b?.state === "READY" &&
    !!x &&
    !!y &&
    typeof x.exact_numerator === "string" &&
    typeof x.exact_denominator === "string" &&
    x.exact_numerator === y.exact_numerator &&
    x.exact_denominator === y.exact_denominator &&
    a.numeric_equivalent === b.numeric_equivalent &&
    a.pass_fail === b.pass_fail
  );
}

function ModernIncReplacementApprovals() {
  const navigate = useNavigate();

  const [rows, setRows] = useState<ReplacementRow[]>([]);

  const [selected, setSelected] =
    useState<ReplacementRow | null>(null);

  const [cursor, setCursor] =
    useState<string | null>(null);

  const [nextCursor, setNextCursor] =
    useState<string | null>(null);

  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [remarks, setRemarks] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const [validated, setValidated] =
    useState<string | null>(null);

  const [commitUncertain, setCommitUncertain] =
    useState(false);

  const saving = useRef(false);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError("");
    setNextCursor(null);

    void (async () => {
      try {
        const response = await authService.authFetch(
          `${REPLACEMENTS_API}${
            cursor
              ? `?after=${encodeURIComponent(cursor)}`
              : ""
          }`,
          {
            signal: controller.signal,
          },
        );

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        const data = await response.json();

        if (controller.signal.aborted) return;

        if (
          !response.ok ||
          data.success !== true ||
          data.read_only !== true ||
          !Array.isArray(data.submissions) ||
          (
            data.next_cursor !== null &&
            !/^[1-9]\d*$/.test(String(data.next_cursor))
          )
        ) {
          throw new Error(
            data.message ||
              data.code ||
              "Unable to load replacement grades.",
          );
        }

        setRows(data.submissions as ReplacementRow[]);
        setNextCursor(data.next_cursor);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load replacement grades.",
          );

          setRows([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();

    return () => controller.abort();
  }, [cursor, reload, navigate]);

  function resetReview() {
    setSelected(null);
    setRemarks("");
    setConfirmed(false);
    setValidated(null);
    setCommitUncertain(false);
  }

  const text = remarks.trim();

  const fingerprint = JSON.stringify([
    selected?.submission_id,
    selected?.record_version,
    text,
    confirmed,
  ]);

  const canValidate =
    !!selected &&
    selected.can_validate_approval === true &&
    selected.submission_status === "SUBMITTED" &&
    selected.record_version === 1 &&
    sameReplacementSemester(
      selected.proposed_semester,
      selected.proposed_semester,
    ) &&
    !loading &&
    !busy &&
    !commitUncertain &&
    confirmed &&
    validRemarks(text) &&
    text.length >= 20 &&
    text.length <= 1000;

  const canApprove =
    canValidate && validated === fingerprint;

  async function approve(dryRun: boolean) {
    if (
      !selected ||
      saving.current ||
      (dryRun ? !canValidate : !canApprove)
    ) {
      return;
    }

    const target = selected;

    saving.current = true;

    setBusy(true);
    setError("");
    setNotice("");
    setValidated(null);

    if (!dryRun) {
      setCommitUncertain(true);
    }

    try {
      const response = await authService.authFetch(
        `${REPLACEMENTS_API}/${encodeURIComponent(
          target.submission_id,
        )}/approve`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            expected_record_version:
              target.record_version,

            confirm_approval: true,

            review_remarks: text,

            dry_run: dryRun,
          }),
        },
      );

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });
        return;
      }

      const result = await response.json();

      if (!response.ok || result.success !== true) {
        throw new Error(
          result.message ||
            result.code ||
            "Approval failed.",
        );
      }

      if (
        result.dry_run !== dryRun ||
        result.persisted !== !dryRun ||
        result.action !== "APPROVE" ||
        result.publication_source !== "COMBINED_SEMESTER" ||
        result.submission_id !== target.submission_id ||
        result.claim_id !== target.claim_id ||
        result.original_inc_grade_id !== target.grade_id ||
        result.offering_id !== target.offering_id ||
        result.enrollment_subject_id !==
          target.enrollment_subject_id ||
        result.submission_status !== "APPROVED" ||
        result.record_version !== 2 ||
        result.audit_event !== "APPROVED" ||
        (
          dryRun
            ? result.audit_event_id !== null
            : !/^[1-9]\d*$/.test(result.audit_event_id ?? "")
        ) ||
        result.official_grade_unchanged !== true ||
        result.original_snapshot_unchanged !== true ||
        result.grade_conversion_performed !== false ||
        !sameReplacementSemester(
          result.proposed_semester,
          target.proposed_semester,
        )
      ) {
        throw new Error(
          "The server did not confirm the expected replacement approval.",
        );
      }

      if (dryRun) {
        setValidated(fingerprint);
      } else {
        setRows((current) =>
          current.filter(
            (row) =>
              row.submission_id !== target.submission_id,
          ),
        );

        resetReview();

        setNotice(
          "Replacement approved. Official INC remains unchanged pending Registrar conversion.",
        );

        setReload((current) => current + 1);
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to approve replacement.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="ph-modern-inc">
      <div className="ph-modern-inc-heading">
        <span className="ph-modern-inc-icon">
          <ClipboardCheck size={21} />
        </span>

        <div>
          <h2>INC Replacement Grade Approvals</h2>

          <p>
            Review submitted replacement grades before
            Registrar conversion.
          </p>
        </div>

        <span className="ph-modern-inc-count">
          {rows.length} on this page
        </span>
      </div>

      {error && (
        <p className="ph-modern-inc-error" role="alert">
          {error}
        </p>
      )}

      {notice && (
        <p className="ph-modern-inc-success" role="status">
          {notice}
        </p>
      )}

      {loading ? (
        <p>Loading replacement grades...</p>
      ) : rows.length === 0 ? (
        <p>No pending replacements on this page.</p>
      ) : (
        <div className="ph-modern-inc-table-wrap">
          <table className="ph-modern-inc-table">
            <thead>
              <tr>
                <th>Student / Subject</th>
                <th>Official</th>
                <th>Replacement</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => (
                <tr key={row.submission_id}>
                  <td>
                    <strong>{row.student_name}</strong>

                    <small>
                      {row.student_number}
                      {" · "}
                      {row.subject_code}
                      {" · "}
                      {row.section_name}
                    </small>
                  </td>

                  <td>{row.official_rating}</td>

                  <td>
                    {row.proposed_semester
                      ?.numeric_equivalent ?? "Unavailable"}
                  </td>

                  <td>
                    <button
                      type="button"
                      disabled={busy || commitUncertain}
                      onClick={() => {
                        resetReview();
                        setSelected(row);
                        setError("");
                        setNotice("");
                      }}
                    >
                      Review Replacement
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="ph-modern-inc-actions">
        {cursor && (
          <button
            type="button"
            disabled={loading || busy || commitUncertain}
            onClick={() => {
              resetReview();
              setCursor(null);
            }}
          >
            First Page
          </button>
        )}

        {nextCursor && (
          <button
            type="button"
            disabled={loading || busy || commitUncertain}
            onClick={() => {
              resetReview();
              setCursor(nextCursor);
            }}
          >
            Next Page
          </button>
        )}

        {(commitUncertain || (error && !selected)) && (
          <button
            type="button"
            disabled={loading || busy}
            onClick={() => {
              resetReview();
              setCursor(null);
              setReload((n) => n + 1);
            }}
          >
            Check Submission Status
          </button>
        )}
      </div>

      {selected && (
        <div className="ph-modern-inc-review">
          <div className="ph-modern-inc-review-heading">
            <div>
              <h3>{selected.student_name}</h3>

              <small>
                {selected.subject_code}
                {" — "}
                {selected.subject_name}
              </small>
            </div>

            <button
              type="button"
              disabled={busy || commitUncertain}
              onClick={resetReview}
            >
              Close Review
            </button>
          </div>

          <div className="ph-modern-inc-details">
            <div>
              <small>Midterm</small>

              <strong>
                {selected.calculated_midterm?.display ?? "—"}%
              </strong>
            </div>

            <div>
              <small>Final Term</small>

              <strong>
                {selected.calculated_final_term?.display ?? "—"}%
              </strong>
            </div>

            <div>
              <small>Semester</small>

              <strong>
                {selected.proposed_semester
                  ?.semester_percentage?.display ?? "—"}%
              </strong>
            </div>

            <div>
              <small>Numeric Equivalent</small>

              <strong>
                {selected.proposed_semester
                  ?.numeric_equivalent ?? "—"}
              </strong>
            </div>
          </div>

          <div className="ph-modern-inc-evidence">
            <strong>Faculty Submission Reason</strong>

            <p>{selected.submission_reason}</p>

            <strong>Verified Completion Date</strong>

            <p>
              {selected.verified_completed_on ?? "Unavailable"}
            </p>

            <strong>Completion Scores</strong>

            {selected.completion_scores.map((score) => (
              <p key={score.assessment_id}>
                Assessment #{score.assessment_id}:{" "}
                {score.earned_score}
                {" · "}
                {score.claim_audit_verified
                  ? "Audit verified in snapshot"
                  : "Audit unavailable"}
              </p>
            ))}
          </div>

          {!selected.can_validate_approval && (
            <p className="ph-modern-inc-error">
              This submission is not eligible for approval
              validation.
            </p>
          )}

          <fieldset
            disabled={
              busy ||
              commitUncertain ||
              !selected.can_validate_approval
            }
          >
            <label>
              Review Remarks

              <textarea
                rows={3}
                maxLength={1000}
                value={remarks}
                onChange={(event) => {
                  setRemarks(event.target.value);
                  setValidated(null);
                }}
              />
            </label>

            <small>
              {text.length}/1000 characters · Minimum 20
            </small>

            <label className="ph-modern-inc-checkbox">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => {
                  setConfirmed(event.target.checked);
                  setValidated(null);
                }}
              />

              I have reviewed the completion evidence and
              replacement grade.
            </label>

            <div className="ph-modern-inc-actions">
              <button
                type="button"
                disabled={!canValidate}
                onClick={() => void approve(true)}
              >
                <ShieldCheck size={14} />
                Validate Approval
              </button>

              <button
                type="button"
                className="ph-modern-inc-confirm"
                disabled={!canApprove}
                onClick={() => void approve(false)}
              >
                <CheckCircle2 size={14} />

                {busy
                  ? "Processing..."
                  : "Approve Replacement"}
              </button>
            </div>
          </fieldset>

          {canApprove && (
            <p className="ph-modern-inc-success" role="status">
              Validation passed. You may approve the
              replacement.
            </p>
          )}

          {commitUncertain && (
            <p role="alert">
              Check the saved submission status before
              attempting another approval.
            </p>
          )}

          <small>
            Approval does not convert or publish the official
            INC grade.
          </small>
        </div>
      )}
    </section>
  );
}
export default function ModernIncRequests() {
  return (
    <>
      <ModernIncClaims />

      <ModernIncReplacementApprovals />
    </>
  );
}