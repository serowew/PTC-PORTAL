import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  FilePenLine,
  KeyRound,
  Loader2,
  RefreshCcw,
  Save,
  Send,
  ShieldCheck,
} from "lucide-react";
import { apiUrl } from "../../services/api";
import "../../styles/Publicadmission.css";

type ApplicationStatus =
  | "Draft"
  | "Submitted"
  | "Needs Correction"
  | "Verified"
  | "Rejected"
  | "Imported";

type Mode = "new" | "resume";
type Gender = "" | "Male" | "Female";
type ApplicantType = "" | "New" | "Transferee" | "Returnee";

type AdmissionForm = {
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  birthDate: string;
  gender: Gender;
  contactNumber: string;
  email: string;
  houseNo: string;
  street: string;
  barangay: string;
  city: string;
  province: string;
  zipCode: string;
  previousSchool: string;
  applicantType: ApplicantType;
  preferredCourseId: number | null;
  privacyAccepted: boolean;
};

type ApplicationResponse = Partial<AdmissionForm> & {
  applicationReference: string;
  applicationStatus: ApplicationStatus;
  version: number;
  correctionNotes?: string | null;
  reviewNotes?: string | null;
};

type AdmissionPeriod = {
  admissionPeriodId: number;
  title: string;
  startsAt: string;
  endsAt: string;
};

type AdmissionStatusResponse = {
  success: boolean;
  open: boolean;
  period?: AdmissionPeriod;
  nextPeriod?: AdmissionPeriod | null;
};

type Course = {
  courseId: number;
  courseCode: string;
  courseName: string;
};

type CreateResponse = {
  success: boolean;
  applicationReference: string;
  recoveryKey: string;
  version: number;
  applicationStatus: ApplicationStatus;
};

type SaveResponse = { success: boolean; version: number; message?: string };
type SubmitResponse = {
  success: boolean;
  applicationStatus: ApplicationStatus;
  version?: number;
  message?: string;
};

const BASE_URL = apiUrl("/api/admissions");
const EMPTY_FORM: AdmissionForm = {
  firstName: "",
  middleName: "",
  lastName: "",
  suffix: "",
  birthDate: "",
  gender: "",
  contactNumber: "",
  email: "",
  houseNo: "",
  street: "",
  barangay: "",
  city: "",
  province: "",
  zipCode: "",
  previousSchool: "",
  applicantType: "",
  preferredCourseId: null,
  privacyAccepted: false,
};

function readForm(value: ApplicationResponse): AdmissionForm {
  const text = (field: keyof AdmissionForm) => {
    const entry = value[field];
    return typeof entry === "string" ? entry : "";
  };

  return {
    firstName: text("firstName"),
    middleName: text("middleName"),
    lastName: text("lastName"),
    suffix: text("suffix"),
    birthDate: text("birthDate").slice(0, 10),
    gender: (["Male", "Female"].includes(text("gender"))
      ? text("gender")
      : "") as Gender,
    contactNumber: text("contactNumber"),
    email: text("email"),
    houseNo: text("houseNo"),
    street: text("street"),
    barangay: text("barangay"),
    city: text("city"),
    province: text("province"),
    zipCode: text("zipCode"),
    previousSchool: text("previousSchool"),
    applicantType: (["New", "Transferee", "Returnee"].includes(
      text("applicantType"),
    )
      ? text("applicantType")
      : "") as ApplicantType,
    preferredCourseId: value.preferredCourseId
      ? Number(value.preferredCourseId)
      : null,
    privacyAccepted: value.privacyAccepted === true,
  };
}

async function publicRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH";
    body?: unknown;
    recoveryKey?: string;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.recoveryKey)
    headers.Authorization = `Bearer ${options.recoveryKey}`;

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    cache: "no-store",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Unexpected server response (${response.status}).`);
  }

  const result: unknown = await response.json();
  if (!result || typeof result !== "object") {
    throw new Error("Invalid server response.");
  }

  const payload = result as { success?: boolean; message?: string };
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || `Request failed (${response.status}).`);
  }
  return result as T;
}

function TextField({
  label,
  value,
  onChange,
  required = false,
  disabled = false,
  type = "text",
  maxLength,
  placeholder,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  type?: string;
  maxLength?: number;
  placeholder?: string;
  max?: string;
}) {
  return (
    <label className="ptc-admission-field">
      <span>
        {label}
        {required && <em> *</em>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={maxLength}
        max={max}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
      />
    </label>
  );
}

export default function PublicAdmission() {
  const [mode, setMode] = useState<Mode>("new");
  const [admission, setAdmission] = useState<AdmissionStatusResponse | null>(
    null,
  );
  const [courses, setCourses] = useState<Course[]>([]);
  const [loadingPage, setLoadingPage] = useState(true);
  const [screenError, setScreenError] = useState("");
  const [notice, setNotice] = useState("");

  const [form, setForm] = useState<AdmissionForm>({ ...EMPTY_FORM });
  const [reference, setReference] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [resumeReference, setResumeReference] = useState("");
  const [resumeKey, setResumeKey] = useState("");
  const [applicationStatus, setApplicationStatus] =
    useState<ApplicationStatus | null>(null);
  const [correctionNotes, setCorrectionNotes] = useState("");
  const [version, setVersion] = useState(1);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [newKeyVisible, setNewKeyVisible] = useState(false);

  const formRef = useRef(form);
  const editNumberRef = useRef(0);
  const dirtyRef = useRef(false);
  const versionRef = useRef(1);
  const savingRef = useRef<Promise<void> | null>(null);
  const conflictRef = useRef(false);

  const editable =
    applicationStatus === "Draft" || applicationStatus === "Needs Correction";
  const todayManila = new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  useEffect(() => {
    let live = true;
    Promise.all([
      publicRequest<AdmissionStatusResponse>("/status"),
      publicRequest<{ success: boolean; courses: Course[] }>("/courses"),
    ])
      .then(([period, courseResponse]) => {
        if (!live) return;
        setAdmission(period);
        setCourses(
          Array.isArray(courseResponse.courses) ? courseResponse.courses : [],
        );
      })
      .catch((error: unknown) => {
        if (live)
          setScreenError(
            error instanceof Error
              ? error.message
              : "Admission services are unavailable.",
          );
      })
      .finally(() => {
        if (live) setLoadingPage(false);
      });
    return () => {
      live = false;
    };
  }, []);

  function updateField<K extends keyof AdmissionForm>(
    name: K,
    value: AdmissionForm[K],
  ) {
    setForm((previous) => {
      const next = { ...previous, [name]: value };
      formRef.current = next;
      return next;
    });
    editNumberRef.current += 1;
    dirtyRef.current = true;
    setDirty(true);
    setScreenError("");
  }

  function loadApplication(
    application: ApplicationResponse,
    key: string,
    revealKey = false,
  ) {
    const nextForm = readForm(application);
    setForm(nextForm);
    formRef.current = nextForm;
    setReference(application.applicationReference);
    setRecoveryKey(key);
    setApplicationStatus(application.applicationStatus);
    setCorrectionNotes(
      application.correctionNotes || application.reviewNotes || "",
    );
    setVersion(application.version);
    versionRef.current = application.version;
    dirtyRef.current = false;
    editNumberRef.current = 0;
    conflictRef.current = false;
    setDirty(false);
    setConflict(false);
    setNewKeyVisible(revealKey);
    setScreenError("");
  }

  const saveChanges = useCallback(async () => {
    if (!editable || !reference || !recoveryKey || conflictRef.current) return;
    if (savingRef.current) return savingRef.current;
    if (!dirtyRef.current) return;

    const task = (async () => {
      setSaving(true);
      setScreenError("");
      try {
        // Serialize edits: never submit two PATCH requests with the same version.
        while (dirtyRef.current && !conflictRef.current) {
          const snapshot = { ...formRef.current };
          const editNumber = editNumberRef.current;
          const response = await publicRequest<SaveResponse>(
            `/drafts/${encodeURIComponent(reference)}`,
            {
              method: "PATCH",
              recoveryKey,
              body: { ...snapshot, version: versionRef.current },
            },
          );
          versionRef.current = response.version;
          setVersion(response.version);
          if (editNumber === editNumberRef.current) {
            dirtyRef.current = false;
            setDirty(false);
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to save changes.";
        if (
          /changed|version|reload|no longer editable|only drafts/i.test(message)
        ) {
          conflictRef.current = true;
          setConflict(true);
        }
        setScreenError(message);
        throw error;
      } finally {
        setSaving(false);
      }
    })();

    savingRef.current = task;
    try {
      await task;
    } finally {
      savingRef.current = null;
    }
  }, [editable, reference, recoveryKey]);

  useEffect(() => {
    if (!dirty || !editable || !reference || !recoveryKey || conflict || busy)
      return;
    const timeout = window.setTimeout(() => {
      void saveChanges().catch(() => undefined);
    }, 1400);
    return () => window.clearTimeout(timeout);
  }, [
    dirty,
    form,
    editable,
    reference,
    recoveryKey,
    conflict,
    busy,
    saveChanges,
  ]);

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!admission?.open || busy) return;
    setBusy(true);
    setScreenError("");
    try {
      const result = await publicRequest<CreateResponse>("/drafts", {
        method: "POST",
        body: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
        },
      });
      loadApplication(
        {
          ...EMPTY_FORM,
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          applicationReference: result.applicationReference,
          applicationStatus: "Draft",
          version: result.version,
        },
        result.recoveryKey,
        true,
      );
      setNotice(
        "Draft created. Copy and securely keep the recovery key shown below. It will not be shown again.",
      );
    } catch (error) {
      setScreenError(
        error instanceof Error
          ? error.message
          : "Could not create an application.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function resumeApplication(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const nextReference = resumeReference.trim().toUpperCase();
    const nextKey = resumeKey.trim();
    if (!nextReference || !nextKey || busy) return;
    setBusy(true);
    setNotice("");
    setScreenError("");
    try {
      const response = await publicRequest<{
        success: boolean;
        application: ApplicationResponse;
      }>(`/drafts/${encodeURIComponent(nextReference)}`, {
        recoveryKey: nextKey,
      });
      loadApplication(response.application, nextKey);
      setResumeKey("");
      setNotice(
        "Application loaded securely. Keep your recovery key for future access.",
      );
    } catch (error) {
      setScreenError(
        error instanceof Error
          ? error.message
          : "Unable to resume the application.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function reloadApplication() {
    if (!reference || !recoveryKey || busy || saving) return;
    setBusy(true);
    try {
      const response = await publicRequest<{
        success: boolean;
        application: ApplicationResponse;
      }>(`/drafts/${encodeURIComponent(reference)}`, { recoveryKey });
      loadApplication(response.application, recoveryKey);
      setNotice(
        "Latest saved application reloaded. Any unsaved local edits were discarded.",
      );
    } catch (error) {
      setScreenError(
        error instanceof Error
          ? error.message
          : "Unable to reload the application.",
      );
    } finally {
      setBusy(false);
    }
  }

  function requiredFieldsComplete() {
    const item = formRef.current;
    return Boolean(
      item.firstName.trim() &&
      item.lastName.trim() &&
      item.birthDate &&
      item.gender &&
      item.contactNumber.trim() &&
      item.email.trim() &&
      item.street.trim() &&
      item.barangay.trim() &&
      item.city.trim() &&
      item.province.trim() &&
      item.previousSchool.trim() &&
      item.applicantType &&
      item.preferredCourseId &&
      item.privacyAccepted,
    );
  }

  async function submitApplication() {
    if (!editable || !reference || !recoveryKey || busy || saving || conflict)
      return;
    if (!requiredFieldsComplete()) {
      setScreenError(
        "Complete all required fields and accept the privacy acknowledgement before submission.",
      );
      return;
    }
    if (
      !window.confirm(
        "Submit your application to PTC? After submission, you cannot edit it unless the Registrar requests corrections.",
      )
    )
      return;
    setBusy(true);
    setScreenError("");
    try {
      await saveChanges();
      if (dirtyRef.current || conflictRef.current)
        throw new Error("Save the latest changes before submitting.");
      const result = await publicRequest<SubmitResponse>(
        `/drafts/${encodeURIComponent(reference)}/submit`,
        { method: "POST", recoveryKey, body: { version: versionRef.current } },
      );
      setApplicationStatus(result.applicationStatus);
      setVersion(result.version ?? versionRef.current + 1);
      versionRef.current = result.version ?? versionRef.current + 1;
      setNotice(
        result.message ||
          "Application submitted successfully. Visit PTC for document verification.",
      );
    } catch (error) {
      setScreenError(
        error instanceof Error
          ? error.message
          : "Unable to submit the application.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Copied. Keep your recovery key private.");
    } catch {
      setNotice(
        "Copy the reference and recovery key manually. Do not share the key publicly.",
      );
    }
  }

  const field = <K extends keyof AdmissionForm>(
    name: K,
    value: AdmissionForm[K],
  ) => updateField(name, value);
  const locked = !editable || busy || conflict;
  const displayStatus =
    applicationStatus === "Needs Correction"
      ? "Needs Correction"
      : applicationStatus;

  return (
    <main className="ptc-admission-public">
      <div className="ptc-admission-shell">
        <header className="ptc-admission-hero">
          <div className="ptc-admission-hero-top">
            <img
              className="ptc-admission-logo"
              src="/ptclogo.png"
              alt="Pateros Technological College seal"
              width={48}
              height={48}
            />
            <div className="ptc-admission-hero-brand">
              <span>Pateros Technological College</span>
              <small><ClipboardCheck size={13} aria-hidden="true" /> Official online admission</small>
            </div>
          </div>
          <h1>Online Admission</h1>
          <p>
            Apply, save your progress, or return to complete corrections
            requested by the Registrar.
          </p>
          <div className="ptc-admission-policy">
            <ShieldCheck size={17} /> Submission is pre-registration only.
            In-person verification at PTC is required.
          </div>
        </header>

        {loadingPage && (
          <section className="ptc-admission-panel" role="status">
            <Loader2 size={20} /> Loading admission information...
          </section>
        )}
        {!loadingPage && admission && !reference && (
          <section className="ptc-admission-period ptc-admission-panel">
            <div>
              <strong>
                {admission.open
                  ? admission.period?.title || "Admission is open"
                  : "Admission applications are currently closed"}
              </strong>
              <p>
                {admission.open
                  ? "New drafts can be created during the current admission window."
                  : "You may still retrieve an existing application with its reference and recovery key."}
              </p>
            </div>
            <BookOpen size={24} />
          </section>
        )}
        {notice && (
          <div
            className="ptc-admission-message ptc-admission-message--success"
            role="status"
          >
            <CheckCircle2 size={18} />
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice("")}
              aria-label="Dismiss notice"
            >
              ×
            </button>
          </div>
        )}
        {screenError && (
          <div
            className="ptc-admission-message ptc-admission-message--error"
            role="alert"
          >
            <AlertCircle size={18} />
            <span>{screenError}</span>
            <button
              type="button"
              onClick={() => setScreenError("")}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        {!reference && !loadingPage && (
          <section className="ptc-admission-panel">
            <div
              className="ptc-admission-tabs"
              role="tablist"
              aria-label="Admission access"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === "new"}
                className={mode === "new" ? "is-active" : ""}
                onClick={() => setMode("new")}
              >
                New Application
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "resume"}
                className={mode === "resume" ? "is-active" : ""}
                onClick={() => setMode("resume")}
              >
                Resume / Make Corrections
              </button>
            </div>
            {mode === "new" ? (
              <form onSubmit={createDraft} className="ptc-admission-content">
                <h2>Create an Application Draft</h2>
                <p>
                  Enter your name and email. You'll receive an application
                  reference and a private recovery key.
                </p>
                <div className="ptc-admission-grid">
                  <TextField
                    label="First name"
                    required
                    maxLength={100}
                    value={form.firstName}
                    onChange={(value) => field("firstName", value)}
                    disabled={busy || !admission?.open}
                  />
                  <TextField
                    label="Last name"
                    required
                    maxLength={100}
                    value={form.lastName}
                    onChange={(value) => field("lastName", value)}
                    disabled={busy || !admission?.open}
                  />
                  <TextField
                    label="Email address"
                    type="email"
                    required
                    maxLength={254}
                    value={form.email}
                    onChange={(value) => field("email", value)}
                    disabled={busy || !admission?.open}
                  />
                </div>
                <button
                  className="ptc-admission-btn ptc-admission-btn--primary"
                  type="submit"
                  disabled={busy || !admission?.open}
                >
                  {busy ? <Loader2 size={17} /> : <FilePenLine size={17} />}{" "}
                  Create Draft
                </button>
              </form>
            ) : (
              <form
                onSubmit={resumeApplication}
                className="ptc-admission-content"
              >
                <h2>Resume Your Application</h2>
                <p>
                  Use the exact reference and recovery key issued when you first
                  saved your application.
                </p>
                <div className="ptc-admission-grid">
                  <TextField
                    label="Application reference"
                    required
                    value={resumeReference}
                    onChange={setResumeReference}
                    placeholder="ADM-2026-..."
                    disabled={busy}
                  />
                  <TextField
                    label="Recovery key"
                    type="password"
                    required
                    value={resumeKey}
                    onChange={setResumeKey}
                    placeholder="Your private recovery key"
                    disabled={busy}
                  />
                </div>
                <p className="ptc-admission-help">
                  The recovery key is never sent to the Registrar or displayed
                  in the application URL. Keep it private.
                </p>
                <button
                  className="ptc-admission-btn ptc-admission-btn--primary"
                  type="submit"
                  disabled={
                    busy || !resumeReference.trim() || !resumeKey.trim()
                  }
                >
                  {busy ? <Loader2 size={17} /> : <KeyRound size={17} />} Resume
                  Application
                </button>
              </form>
            )}
          </section>
        )}

        {reference && (
          <>
            <section className="ptc-admission-panel ptc-admission-application-head">
              <div>
                <p className="ptc-admission-overline">Your application</p>
                <h2>{reference}</h2>
                <span
                  className={`ptc-admission-status ptc-admission-status--${(applicationStatus || "Draft").toLowerCase().replace(/\s+/g, "-")}`}
                >
                  {displayStatus}
                </span>
              </div>
              <div className="ptc-admission-version">
                <span>Version {version}</span>
                <button
                  type="button"
                  className="ptc-admission-btn ptc-admission-btn--outline"
                  onClick={() => void reloadApplication()}
                  disabled={busy || saving}
                >
                  <RefreshCcw size={16} /> Reload
                </button>
              </div>
            </section>

            {newKeyVisible && (
              <section className="ptc-admission-panel ptc-admission-key">
                <div className="ptc-admission-key-header">
                  <KeyRound size={20} />
                  <strong>Save Your Recovery Key Now</strong>
                </div>
                <p>
                  This key is shown only once after draft creation. Store it
                  somewhere safe; you will need it to resume your application.
                </p>
                <div className="ptc-admission-secret">
                  <code>{recoveryKey}</code>
                  <button
                    type="button"
                    onClick={() => void copyText(recoveryKey)}
                    aria-label="Copy recovery key"
                  >
                    <Copy size={17} />
                  </button>
                </div>
                <button
                  type="button"
                  className="ptc-admission-btn ptc-admission-btn--outline"
                  onClick={() => setNewKeyVisible(false)}
                >
                  I've Saved My Recovery Key
                </button>
              </section>
            )}

            {applicationStatus === "Needs Correction" && (
              <section className="ptc-admission-panel ptc-admission-correction">
                <h3>
                  <AlertCircle size={20} /> Registrar Requested Corrections
                </h3>
                <p>
                  {correctionNotes ||
                    "Your application needs changes. Contact the PTC Registrar for the specific items to correct if no instructions are shown."}
                </p>
                <p className="ptc-admission-help">
                  Make the requested changes below, save them, then resubmit for
                  verification.
                </p>
              </section>
            )}

            {!editable ? (
              <section className="ptc-admission-panel ptc-admission-complete">
                <CheckCircle2 size={29} />
                <h2>
                  {applicationStatus === "Submitted"
                    ? "Application Submitted"
                    : `Application ${applicationStatus}`}
                </h2>
                <p>
                  {applicationStatus === "Submitted"
                    ? "Your application is awaiting PTC's in-person verification. Bring your original documents to the Registrar."
                    : applicationStatus === "Verified"
                      ? "Your application has been verified. Account import is handled separately by PTC staff."
                      : applicationStatus === "Imported"
                        ? "Your application has been imported into the Student Portal. Enrollment is a separate process."
                        : "Please contact the Registrar for information about your application."}
                </p>
              </section>
            ) : (
              <section className="ptc-admission-panel ptc-admission-content">
                <div className="ptc-admission-heading">
                  <h2>Applicant Information</h2>
                  <p>
                    Fields marked * are required. Changes are automatically
                    saved while this page remains open.
                  </p>
                </div>
                <h3>Personal Details</h3>
                <div className="ptc-admission-grid">
                  <TextField
                    label="First name"
                    required
                    maxLength={100}
                    value={form.firstName}
                    onChange={(v) => field("firstName", v)}
                    disabled={locked}
                  />
                  <TextField
                    label="Middle name"
                    maxLength={100}
                    value={form.middleName}
                    onChange={(v) => field("middleName", v)}
                    disabled={locked}
                  />
                  <TextField
                    label="Last name"
                    required
                    maxLength={100}
                    value={form.lastName}
                    onChange={(v) => field("lastName", v)}
                    disabled={locked}
                  />
                  <TextField
                    label="Suffix"
                    maxLength={30}
                    value={form.suffix}
                    onChange={(v) => field("suffix", v)}
                    disabled={locked}
                  />
                  <TextField
                    label="Birth date"
                    type="date"
                    max={todayManila}
                    required
                    value={form.birthDate}
                    onChange={(v) => field("birthDate", v)}
                    disabled={locked}
                  />
                  <label className="ptc-admission-field">
                    <span>
                      Gender <em>*</em>
                    </span>
                    <select
                      required
                      value={form.gender}
                      onChange={(e) =>
                        field("gender", e.target.value as Gender)
                      }
                      disabled={locked}
                    >
                      <option value="">Choose gender</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                  </label>
                  <TextField
                    label="Contact number"
                    required
                    maxLength={20}
                    value={form.contactNumber}
                    onChange={(v) => field("contactNumber", v)}
                    disabled={locked}
                  />
                  <TextField
                    label="Email address"
                    type="email"
                    required
                    maxLength={254}
                    value={form.email}
                    onChange={(v) => field("email", v)}
                    disabled={locked}
                  />
                </div>
                <h3>Home Address</h3>
                <div className="ptc-admission-grid">
                  <TextField
                    label="House / unit no."
                    maxLength={50}
                    value={form.houseNo}
                    onChange={(v) => field("houseNo", v)}
                    disabled={locked}
                  />
                  <TextField
                    label="Street"
                    required
                    maxLength={100}
                    value={form.street}
                    onChange={(v) => field("street", v)}
                    disabled={locked}
                  />
                  <TextField
                    label="Barangay"
                    required
                    maxLength={100}
                    value={form.barangay}
                    onChange={(v) => field("barangay", v)}
                    disabled={locked}
                  />
                  <TextField
                    label="City / municipality"
                    required
                    maxLength={100}
                    value={form.city}
                    onChange={(v) => field("city", v)}
                    disabled={locked}
                  />
                  <TextField
                    label="Province"
                    required
                    maxLength={100}
                    value={form.province}
                    onChange={(v) => field("province", v)}
                    disabled={locked}
                  />
                  <TextField
                    label="ZIP code"
                    maxLength={10}
                    value={form.zipCode}
                    onChange={(v) => field("zipCode", v)}
                    disabled={locked}
                  />
                </div>
                <h3>Academic Details</h3>
                <div className="ptc-admission-grid">
                  <TextField
                    label="Previous school"
                    required
                    maxLength={200}
                    value={form.previousSchool}
                    onChange={(v) => field("previousSchool", v)}
                    disabled={locked}
                  />
                  <label className="ptc-admission-field">
                    <span>
                      Applicant type <em>*</em>
                    </span>
                    <select
                      required
                      value={form.applicantType}
                      onChange={(e) =>
                        field("applicantType", e.target.value as ApplicantType)
                      }
                      disabled={locked}
                    >
                      <option value="">Choose applicant type</option>
                      <option value="New">New student</option>
                      <option value="Transferee">Transferee</option>
                      <option value="Returnee">Returnee</option>
                    </select>
                  </label>
                  <label className="ptc-admission-field ptc-admission-field--wide">
                    <span>
                      Preferred course <em>*</em>
                    </span>
                    <select
                      required
                      value={form.preferredCourseId || ""}
                      onChange={(e) =>
                        field(
                          "preferredCourseId",
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                      disabled={locked}
                    >
                      <option value="">Select a course</option>
                      {courses.map((course) => (
                        <option key={course.courseId} value={course.courseId}>
                          {course.courseCode} — {course.courseName}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="ptc-admission-checkbox">
                  <input
                    type="checkbox"
                    checked={form.privacyAccepted}
                    onChange={(e) => field("privacyAccepted", e.target.checked)}
                    disabled={locked}
                  />
                  <span>
                    I consent to PTC processing the information I provided for
                    admission evaluation and verification. <strong>*</strong>
                  </span>
                </label>
                <div className="ptc-admission-actions">
                  <span className="ptc-admission-save-state" role="status">
                    {saving
                      ? "Saving..."
                      : conflict
                        ? "Save blocked — reload required"
                        : dirty
                          ? "Unsaved changes"
                          : "All changes saved"}
                  </span>
                  <button
                    className="ptc-admission-btn ptc-admission-btn--outline"
                    type="button"
                    onClick={() => void saveChanges().catch(() => undefined)}
                    disabled={busy || saving || !dirty || conflict}
                  >
                    <Save size={16} /> Save Changes
                  </button>
                  <button
                    className="ptc-admission-btn ptc-admission-btn--primary"
                    type="button"
                    onClick={() => void submitApplication()}
                    disabled={
                      busy || saving || conflict || !requiredFieldsComplete()
                    }
                  >
                    {busy ? <Loader2 size={16} /> : <Send size={16} />}{" "}
                    {applicationStatus === "Needs Correction"
                      ? "Resubmit Corrections"
                      : "Submit Application"}
                  </button>
                </div>
                {conflict && (
                  <p className="ptc-admission-help ptc-admission-conflict">
                    <AlertCircle size={16} /> Your application changed elsewhere
                    or cannot be edited. Reload the saved version before
                    continuing.
                  </p>
                )}
              </section>
            )}
            <div className="ptc-admission-footer-note">
              <ArrowLeft size={16} /> Keep your application reference and
              recovery key for future access. Never share the recovery key
              publicly.
            </div>
          </>
        )}
        {!reference && !loadingPage && (
          <div className="ptc-admission-footer-note">
            <ShieldCheck size={16} /> Applications are reviewed by PTC staff.
            Submission does not guarantee acceptance or enrollment.
          </div>
        )}
      </div>
    </main>
  );
}
