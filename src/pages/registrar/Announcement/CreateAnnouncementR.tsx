import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleOff,
  FilePlus2,
  FileText,
  Loader2,
  Megaphone,
  Paperclip,
  Send,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/announcementCreateR.css";

const ANNOUNCEMENT_API_URL =
  "http://localhost:3000/api/announcement-management";
const FILE_UPLOAD_URL = "http://localhost:3000/api/files/upload";

// =====================================================
// TYPES
// =====================================================

type Role = {
  role_id: number;
  role_name: string;
};

interface UploadResponse {
  success?: boolean;
  file_id?: number;
  file?: {
    file_id?: number;
  };
  data?: {
    file_id?: number;
  };
  message?: string;
  error?: string;
}

interface CreateAnnouncementResponse {
  success?: boolean;
  announcement_id?: number;
  message?: string;
  error?: string;
}

// =====================================================
// EXISTING RECIPIENT ROLE IDS
// =====================================================

const RECIPIENT_ROLES: Role[] = [
  { role_id: 1, role_name: "Admin" },
  { role_id: 2, role_name: "Registrar" },
  { role_id: 3, role_name: "Student" },
  { role_id: 4, role_name: "Faculty" },
  { role_id: 5, role_name: "Program Head" },
];

// =====================================================
// COMPONENT
// =====================================================

export default function AnnouncementCreateR() {
  const navigate = useNavigate();

  // =====================================================
  // AUTHENTICATION
  // =====================================================

  const session = authService.getSession();
  const token = authService.getToken();
  const userRole = session?.role;
  const authenticated = Boolean(session && token);

  // =====================================================
  // FORM STATE
  // =====================================================

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [recipients, setRecipients] = useState<number[]>([]);
  const [publishDate, setPublishDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // =====================================================
  // AUTHORIZATION
  // =====================================================

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Registrar") {
      if (userRole) {
        navigate(authService.getDashboardRoute(userRole), { replace: true });
      } else {
        navigate("/login", { replace: true });
      }
    }
  }, [authenticated, userRole, navigate]);

  // =====================================================
  // FILE UPLOAD
  // =====================================================

  async function uploadFile(): Promise<number | null> {
    if (!selectedFile) {
      return null;
    }

    if (!authenticated || userRole !== "Registrar") {
      throw new Error(
        "Your session has expired or you are not authorized to upload files.",
      );
    }

    const formData = new FormData();
    formData.append("file", selectedFile);

    const response = await authService.authFetch(FILE_UPLOAD_URL, {
      method: "POST",
      body: formData,
    });

    const contentType = response.headers.get("content-type") || "";
    let data: UploadResponse | null = null;

    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      const text = await response.text();

      throw new Error(
        `File server returned a non-JSON response (${response.status}): ${text.slice(
          0,
          200,
        )}`,
      );
    }

    if (response.status === 401) {
      authService.logout();
      throw new Error("Your session has expired. Please log in again.");
    }

    if (response.status === 403) {
      throw new Error(
        data?.message ||
          data?.error ||
          "You are not authorized to upload files.",
      );
    }

    if (!response.ok) {
      throw new Error(
        data?.message ||
          data?.error ||
          `File upload failed (${response.status}).`,
      );
    }

    const fileId = Number(
      data?.file_id ?? data?.file?.file_id ?? data?.data?.file_id,
    );

    if (!Number.isInteger(fileId) || fileId <= 0) {
      throw new Error(
        "File uploaded, but the server did not return a valid file ID.",
      );
    }

    return fileId;
  }

  // =====================================================
  // RECIPIENT CHANGE
  // =====================================================

  const handleRecipientChange = (roleId: number, checked: boolean) => {
    setRecipients((current) => {
      if (checked) {
        if (current.includes(roleId)) {
          return current;
        }

        return [...current, roleId];
      }

      return current.filter((id) => id !== roleId);
    });

    setError("");
  };

  // =====================================================
  // SUBMIT
  // =====================================================

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    if (!authenticated || userRole !== "Registrar") {
      setError(
        "Your session has expired or you are not authorized to create announcements.",
      );
      return;
    }

    const cleanTitle = title.trim();
    const cleanContent = content.trim();

    if (!cleanTitle) {
      setError("Title is required.");
      return;
    }

    if (!cleanContent) {
      setError("Content is required.");
      return;
    }

    if (!publishDate) {
      setError("Publish date is required.");
      return;
    }

    if (recipients.length === 0) {
      setError("Select at least one recipient.");
      return;
    }

    if (expiryDate && expiryDate < publishDate) {
      setError("Expiry date cannot be earlier than the publish date.");
      return;
    }

    try {
      setLoading(true);

      let fileId: number | null = null;

      if (selectedFile) {
        fileId = await uploadFile();
      }

      const announcementData = {
        title: cleanTitle,
        content: cleanContent,
        publish_date: `${publishDate} 00:00:00`,
        expiry_date: expiryDate ? `${expiryDate} 23:59:59` : null,
        is_active: isActive ? 1 : 0,
        recipients,
        attachments: fileId ? [fileId] : [],
      };

      console.log("CREATE REGISTRAR ANNOUNCEMENT:", announcementData);

      const response = await authService.authFetch(ANNOUNCEMENT_API_URL, {
        method: "POST",
        body: JSON.stringify(announcementData),
      });

      const contentType = response.headers.get("content-type") || "";
      let data: CreateAnnouncementResponse | null = null;

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
        navigate("/login", { replace: true });
        return;
      }

      if (response.status === 403) {
        throw new Error(
          data?.message ||
            data?.error ||
            "You are not authorized to create announcements.",
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to create announcement (${response.status}).`,
        );
      }

      window.alert(data?.message || "Announcement created successfully.");
      navigate("/registrar/announcement/listR");
    } catch (err) {
      console.error("CREATE ANNOUNCEMENT ERROR:", err);

      if (err instanceof TypeError) {
        setError(
          "Unable to connect to the server. Make sure the backend is running on port 3000.",
        );
        return;
      }

      setError(
        err instanceof Error ? err.message : "Unable to create announcement.",
      );
    } finally {
      setLoading(false);
    }
  }

  // =====================================================
  // AUTH GUARD
  // =====================================================

  if (!authenticated || !session || userRole !== "Registrar") {
    return null;
  }

  const titleLength = title.length;
  const contentLength = content.length;
  const selectedRecipientNames = RECIPIENT_ROLES.filter((role) =>
    recipients.includes(role.role_id),
  ).map((role) => role.role_name);

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <DashboardLayout>
      <main className="registrar-announcement-create">
        <header className="registrar-announcement-create__hero">
          <div className="registrar-announcement-create__hero-copy">
            <div className="registrar-announcement-create__eyebrow">
              <span className="registrar-announcement-create__eyebrow-icon">
                <Megaphone size={16} strokeWidth={2.2} />
              </span>
              Registrar · Announcements
            </div>
            <h1>Create Announcement</h1>
            <p>
              Prepare and publish an official portal announcement for the selected
              PTC audiences.
            </p>
          </div>

          <div className="registrar-announcement-create__hero-actions">
            <button
              type="button"
              className="registrar-announcement-create__button registrar-announcement-create__button--secondary"
              onClick={() => navigate("/registrar/announcement/listR")}
              disabled={loading}
            >
              <ArrowLeft size={17} />
              Announcements
            </button>
          </div>
        </header>

        {error && (
          <div className="registrar-announcement-create__notice" role="alert">
            <AlertCircle size={19} />
            <div>
              <strong>Unable to create announcement</strong>
              <p>{error}</p>
            </div>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={17} />
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="registrar-announcement-create__form-grid">
            <div className="registrar-announcement-create__main-column">
              <section className="registrar-announcement-create__panel">
                <div className="registrar-announcement-create__panel-header">
                  <span className="registrar-announcement-create__panel-icon">
                    <FileText size={19} />
                  </span>
                  <div>
                    <span className="registrar-announcement-create__section-kicker">
                      Announcement Content
                    </span>
                    <h2>Write the announcement</h2>
                    <p>
                      Keep the title clear and use the content area for the complete
                      message students and staff should receive.
                    </p>
                  </div>
                </div>

                <div className="registrar-announcement-create__fields">
                  <label className="registrar-announcement-create__field">
                    <span>
                      Title <em>*</em>
                    </span>
                    <input
                      id="announcement-title"
                      type="text"
                      value={title}
                      onChange={(event) => {
                        setTitle(event.target.value);
                        setError("");
                      }}
                      placeholder="Enter a clear announcement title"
                      disabled={loading}
                      maxLength={255}
                      required
                    />
                    <small>{titleLength}/255 characters</small>
                  </label>

                  <label className="registrar-announcement-create__field">
                    <span>
                      Content <em>*</em>
                    </span>
                    <textarea
                      id="announcement-content"
                      rows={10}
                      value={content}
                      onChange={(event) => {
                        setContent(event.target.value);
                        setError("");
                      }}
                      placeholder="Write the full announcement message..."
                      disabled={loading}
                      required
                    />
                    <small>{contentLength.toLocaleString()} characters</small>
                  </label>
                </div>
              </section>

              <section className="registrar-announcement-create__panel">
                <div className="registrar-announcement-create__panel-header registrar-announcement-create__panel-header--split">
                  <div className="registrar-announcement-create__panel-heading-group">
                    <span className="registrar-announcement-create__panel-icon">
                      <UsersRound size={19} />
                    </span>
                    <div>
                      <span className="registrar-announcement-create__section-kicker">
                        Audience
                      </span>
                      <h2>Select recipients</h2>
                      <p>
                        Choose every portal role that should receive this
                        announcement.
                      </p>
                    </div>
                  </div>

                  <span className="registrar-announcement-create__count-badge">
                    {recipients.length} selected
                  </span>
                </div>

                <div className="registrar-announcement-create__recipient-grid">
                  {RECIPIENT_ROLES.map((role) => {
                    const selected = recipients.includes(role.role_id);

                    return (
                      <label
                        className={`registrar-announcement-create__recipient-card ${
                          selected
                            ? "registrar-announcement-create__recipient-card--selected"
                            : ""
                        }`}
                        key={role.role_id}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(event) =>
                            handleRecipientChange(
                              role.role_id,
                              event.target.checked,
                            )
                          }
                          disabled={loading}
                        />
                        <span className="registrar-announcement-create__recipient-check">
                          {selected && <Check size={14} strokeWidth={2.5} />}
                        </span>
                        <span className="registrar-announcement-create__recipient-name">
                          {role.role_name}
                        </span>
                      </label>
                    );
                  })}
                </div>

                {selectedRecipientNames.length > 0 && (
                  <div className="registrar-announcement-create__audience-summary">
                    <UsersRound size={16} />
                    <span>Audience:</span>
                    <strong>{selectedRecipientNames.join(", ")}</strong>
                  </div>
                )}
              </section>

              <section className="registrar-announcement-create__panel">
                <div className="registrar-announcement-create__panel-header">
                  <span className="registrar-announcement-create__panel-icon">
                    <Paperclip size={19} />
                  </span>
                  <div>
                    <span className="registrar-announcement-create__section-kicker">
                      Attachment
                    </span>
                    <h2>Add an optional file</h2>
                    <p>
                      The selected file will be uploaded first and attached to the
                      announcement when it is created.
                    </p>
                  </div>
                </div>

                <div className="registrar-announcement-create__upload-box">
                  <span className="registrar-announcement-create__upload-icon">
                    <FilePlus2 size={22} />
                  </span>
                  <div className="registrar-announcement-create__upload-copy">
                    <strong>Choose attachment</strong>
                    <p>Select one file to include with this announcement.</p>
                  </div>
                  <input
                    id="announcement-file"
                    type="file"
                    onChange={(event) => {
                      setSelectedFile(event.target.files?.[0] || null);
                      setError("");
                    }}
                    disabled={loading}
                  />
                </div>

                {selectedFile && (
                  <div className="registrar-announcement-create__selected-file">
                    <span className="registrar-announcement-create__selected-file-icon">
                      <FileText size={18} />
                    </span>
                    <div>
                      <strong>{selectedFile.name}</strong>
                      <span>
                        {(selectedFile.size / 1024).toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                        })} KB selected
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedFile(null)}
                      disabled={loading}
                      aria-label="Remove selected attachment"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
              </section>
            </div>

            <aside className="registrar-announcement-create__side-column">
              <section className="registrar-announcement-create__panel registrar-announcement-create__panel--compact">
                <div className="registrar-announcement-create__panel-header">
                  <span className="registrar-announcement-create__panel-icon">
                    <CalendarClock size={19} />
                  </span>
                  <div>
                    <span className="registrar-announcement-create__section-kicker">
                      Publication
                    </span>
                    <h2>Publishing settings</h2>
                    <p>Set availability and the announcement date range.</p>
                  </div>
                </div>

                <div className="registrar-announcement-create__fields">
                  <label className="registrar-announcement-create__field">
                    <span>Status</span>
                    <select
                      id="announcement-status"
                      value={isActive ? "true" : "false"}
                      onChange={(event) => {
                        setIsActive(event.target.value === "true");
                        setError("");
                      }}
                      disabled={loading}
                    >
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>
                  </label>

                  <div
                    className={`registrar-announcement-create__status-preview ${
                      isActive
                        ? "registrar-announcement-create__status-preview--active"
                        : "registrar-announcement-create__status-preview--inactive"
                    }`}
                  >
                    {isActive ? (
                      <CheckCircle2 size={18} />
                    ) : (
                      <CircleOff size={18} />
                    )}
                    <div>
                      <strong>{isActive ? "Active announcement" : "Inactive announcement"}</strong>
                      <p>
                        {isActive
                          ? "The announcement is enabled according to its publication dates."
                          : "The announcement will be saved in an inactive state."}
                      </p>
                    </div>
                  </div>

                  <label className="registrar-announcement-create__field">
                    <span>
                      <CalendarDays size={14} /> Publish Date <em>*</em>
                    </span>
                    <input
                      id="announcement-publish-date"
                      type="date"
                      value={publishDate}
                      onChange={(event) => {
                        setPublishDate(event.target.value);
                        setError("");
                      }}
                      disabled={loading}
                      required
                    />
                  </label>

                  <label className="registrar-announcement-create__field">
                    <span>
                      <CalendarDays size={14} /> Expiry Date
                    </span>
                    <input
                      id="announcement-expiry-date"
                      type="date"
                      value={expiryDate}
                      onChange={(event) => {
                        setExpiryDate(event.target.value);
                        setError("");
                      }}
                      min={publishDate || undefined}
                      disabled={loading}
                    />
                    <small className="registrar-announcement-create__field-note">
                      Optional. Leave blank if the announcement should not have an
                      expiry date.
                    </small>
                  </label>
                </div>
              </section>

              <section className="registrar-announcement-create__checklist-panel">
                <div className="registrar-announcement-create__checklist-header">
                  <span>
                    <ShieldCheck size={18} />
                  </span>
                  <div>
                    <strong>Publication checklist</strong>
                    <p>Required information before creation.</p>
                  </div>
                </div>

                <div className="registrar-announcement-create__checklist">
                  <div className={title.trim() ? "is-complete" : ""}>
                    <span>{title.trim() ? <Check size={13} /> : "1"}</span>
                    <p>Announcement title</p>
                  </div>
                  <div className={content.trim() ? "is-complete" : ""}>
                    <span>{content.trim() ? <Check size={13} /> : "2"}</span>
                    <p>Announcement content</p>
                  </div>
                  <div className={recipients.length > 0 ? "is-complete" : ""}>
                    <span>{recipients.length > 0 ? <Check size={13} /> : "3"}</span>
                    <p>At least one recipient</p>
                  </div>
                  <div className={publishDate ? "is-complete" : ""}>
                    <span>{publishDate ? <Check size={13} /> : "4"}</span>
                    <p>Publish date</p>
                  </div>
                </div>
              </section>

              <section className="registrar-announcement-create__save-panel">
                <div className="registrar-announcement-create__save-icon">
                  <Send size={20} />
                </div>
                <div>
                  <span className="registrar-announcement-create__section-kicker">
                    Create Record
                  </span>
                  <h2>Ready to publish?</h2>
                  <p>
                    Review the content, audience, and publication settings before
                    creating the announcement.
                  </p>
                </div>

                <div className="registrar-announcement-create__save-actions">
                  <button
                    type="button"
                    className="registrar-announcement-create__button registrar-announcement-create__button--secondary"
                    onClick={() => navigate("/registrar/announcement/listR")}
                    disabled={loading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="registrar-announcement-create__button registrar-announcement-create__button--primary"
                    disabled={
                      loading || !authenticated || userRole !== "Registrar"
                    }
                  >
                    {loading ? (
                      <>
                        <Loader2
                          size={17}
                          className="registrar-announcement-create__spin"
                        />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Megaphone size={17} />
                        Create Announcement
                      </>
                    )}
                  </button>
                </div>
              </section>
            </aside>
          </div>
        </form>
      </main>
    </DashboardLayout>
  );
}
