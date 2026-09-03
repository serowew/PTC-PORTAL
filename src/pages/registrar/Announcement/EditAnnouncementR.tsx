import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/announcementEditR.css";

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

type Attachment = {
  file_id: number;
  original_name: string;
  file_path?: string;
  file_size?: number;
  mime_type?: string;
};

interface AnnouncementResponse {
  announcement_id?: number;
  title?: string;
  content?: string;
  publish_date?: string;
  expiry_date?: string | null;
  is_active?: number;
  recipients?: Role[];
  attachments?: Attachment[];
  data?: {
    announcement_id?: number;
    title?: string;
    content?: string;
    publish_date?: string;
    expiry_date?: string | null;
    is_active?: number;
    recipients?: Role[];
    attachments?: Attachment[];
  };
  announcement?: {
    announcement_id?: number;
    title?: string;
    content?: string;
    publish_date?: string;
    expiry_date?: string | null;
    is_active?: number;
    recipients?: Role[];
    attachments?: Attachment[];
  };
  message?: string;
  error?: string;
}

interface UploadResponse {
  success?: boolean;
  file_id?: number;
  file_name?: string;
  original_name?: string;
  file?: {
    file_id?: number;
    original_name?: string;
  };
  data?: {
    file_id?: number;
    original_name?: string;
  };
  message?: string;
  error?: string;
}

interface UpdateResponse {
  success?: boolean;
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

export default function AnnouncementEditR() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  // =====================================================
  // AUTHENTICATION
  // =====================================================

  const session = authService.getSession();
  const token = authService.getToken();
  const userRole = session?.role;
  const authenticated = Boolean(session && token);

  // =====================================================
  // STATE
  // =====================================================

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [recipients, setRecipients] = useState<number[]>([]);
  const [publishDate, setPublishDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
  // LOAD ANNOUNCEMENT
  // =====================================================

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") {
      return;
    }

    const announcementId = Number(id);

    if (!Number.isInteger(announcementId) || announcementId <= 0) {
      setError("Invalid announcement ID.");
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    const loadAnnouncement = async () => {
      try {
        setLoading(true);
        setError("");

        const response = await authService.authFetch(
          `${ANNOUNCEMENT_API_URL}/${announcementId}`,
          {
            method: "GET",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          },
        );

        const contentType = response.headers.get("content-type") || "";
        let data: AnnouncementResponse | null = null;

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
              "You are not authorized to edit announcements.",
          );
        }

        if (!response.ok) {
          throw new Error(
            data?.message ||
              data?.error ||
              `Unable to load announcement (${response.status}).`,
          );
        }

        const announcement = data?.announcement ?? data?.data ?? data;

        if (!announcement) {
          throw new Error("Announcement data was not returned by the server.");
        }

        setTitle(String(announcement.title ?? ""));
        setContent(String(announcement.content ?? ""));
        setPublishDate(
          announcement.publish_date
            ? String(announcement.publish_date).split("T")[0]
            : "",
        );
        setExpiryDate(
          announcement.expiry_date
            ? String(announcement.expiry_date).split("T")[0]
            : "",
        );
        setIsActive(Number(announcement.is_active) === 1);
        setRecipients(
          Array.isArray(announcement.recipients)
            ? announcement.recipients
                .map((role) => Number(role.role_id))
                .filter((roleId) => Number.isInteger(roleId) && roleId > 0)
            : [],
        );
        setAttachments(
          Array.isArray(announcement.attachments)
            ? announcement.attachments
            : [],
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        console.error("LOAD ANNOUNCEMENT ERROR:", err);
        setError(
          err instanceof Error ? err.message : "Unable to load announcement.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadAnnouncement();

    return () => {
      controller.abort();
    };
  }, [id, authenticated, userRole, navigate]);

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

      return current.filter((currentRoleId) => currentRoleId !== roleId);
    });
  };

  // =====================================================
  // REMOVE EXISTING ATTACHMENT
  // =====================================================

  const handleRemoveAttachment = (fileId: number) => {
    if (saving) {
      return;
    }

    setAttachments((current) =>
      current.filter((file) => file.file_id !== fileId),
    );
  };

  // =====================================================
  // FILE UPLOAD
  // =====================================================

  async function uploadFile(): Promise<Attachment | null> {
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

    return {
      file_id: fileId,
      original_name:
        data?.original_name ??
        data?.file_name ??
        data?.file?.original_name ??
        data?.data?.original_name ??
        selectedFile.name,
    };
  }

  // =====================================================
  // SUBMIT
  // =====================================================

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    if (!authenticated || userRole !== "Registrar") {
      setError(
        "Your session has expired or you are not authorized to update announcements.",
      );
      return;
    }

    const announcementId = Number(id);

    if (!Number.isInteger(announcementId) || announcementId <= 0) {
      setError("Invalid announcement ID.");
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
      setSaving(true);

      const attachmentIds = attachments
        .map((file) => Number(file.file_id))
        .filter((fileId) => Number.isInteger(fileId) && fileId > 0);

      if (selectedFile) {
        const uploaded = await uploadFile();

        if (uploaded && !attachmentIds.includes(uploaded.file_id)) {
          attachmentIds.push(uploaded.file_id);
        }
      }

      const payload = {
        title: cleanTitle,
        content: cleanContent,
        publish_date: `${publishDate} 00:00:00`,
        expiry_date: expiryDate ? `${expiryDate} 23:59:59` : null,
        is_active: isActive ? 1 : 0,
        recipients,
        attachments: attachmentIds,
      };

      const response = await authService.authFetch(
        `${ANNOUNCEMENT_API_URL}/${announcementId}`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
        },
      );

      const contentType = response.headers.get("content-type") || "";
      let data: UpdateResponse | null = null;

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
            "You are not authorized to update announcements.",
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to update announcement (${response.status}).`,
        );
      }

      window.alert(data?.message || "Announcement updated successfully.");
      navigate("/registrar/announcement/listR");
    } catch (err) {
      console.error("UPDATE ANNOUNCEMENT ERROR:", err);
      setError(
        err instanceof Error ? err.message : "Unable to update announcement.",
      );
    } finally {
      setSaving(false);
    }
  }

  // =====================================================
  // AUTH GUARD
  // =====================================================

  if (!authenticated || !session || userRole !== "Registrar") {
    return null;
  }

  const announcementId = Number(id);

  return (
    <DashboardLayout>
      <main className="registrar-announcement-edit">
        <header className="registrar-announcement-edit__hero">
          <div className="registrar-announcement-edit__hero-copy">
            <div className="registrar-announcement-edit__eyebrow">
              <span className="registrar-announcement-edit__eyebrow-icon">
                <Megaphone size={16} strokeWidth={2.2} />
              </span>
              Registrar · Announcements
            </div>
            <h1>Edit Announcement</h1>
            <p>
              Update the message, audience, publication dates, status, and files
              while preserving the existing announcement record.
            </p>
          </div>

          <div className="registrar-announcement-edit__hero-actions">
            <button
              type="button"
              className="registrar-announcement-edit__button registrar-announcement-edit__button--secondary"
              onClick={() =>
                Number.isInteger(announcementId) && announcementId > 0
                  ? navigate(`/registrar/announcement/DetailR/${announcementId}`)
                  : navigate("/registrar/announcement/listR")
              }
              disabled={saving}
            >
              <ArrowLeft size={17} />
              Back
            </button>
          </div>
        </header>

        {loading ? (
          <div className="registrar-announcement-edit__loading" aria-live="polite">
            <div className="registrar-announcement-edit__skeleton registrar-announcement-edit__skeleton--main" />
            <div className="registrar-announcement-edit__skeleton registrar-announcement-edit__skeleton--side" />
          </div>
        ) : (
          <>
            {error && (
              <div className="registrar-announcement-edit__notice" role="alert">
                <AlertCircle size={20} />
                <div>
                  <strong>Unable to save announcement</strong>
                  <p>{error}</p>
                </div>
                <button
                  type="button"
                  aria-label="Dismiss error"
                  onClick={() => setError("")}
                  disabled={saving}
                >
                  <X size={17} />
                </button>
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              className="registrar-announcement-edit__form"
            >
              <div className="registrar-announcement-edit__form-grid">
                <div className="registrar-announcement-edit__main-column">
                  <section className="registrar-announcement-edit__panel">
                    <div className="registrar-announcement-edit__panel-header">
                      <span className="registrar-announcement-edit__panel-icon">
                        <FileText size={19} />
                      </span>
                      <div>
                        <span className="registrar-announcement-edit__section-kicker">
                          Message
                        </span>
                        <h2>Announcement Content</h2>
                        <p>Edit the title and message recipients will read.</p>
                      </div>
                    </div>

                    <div className="registrar-announcement-edit__fields">
                      <label className="registrar-announcement-edit__field">
                        <span>
                          Title <em>*</em>
                        </span>
                        <input
                          id="announcement-edit-title"
                          type="text"
                          value={title}
                          onChange={(event) => setTitle(event.target.value)}
                          disabled={saving}
                          maxLength={255}
                          required
                        />
                        <small>{title.length}/255 characters</small>
                      </label>

                      <label className="registrar-announcement-edit__field">
                        <span>
                          Content <em>*</em>
                        </span>
                        <textarea
                          id="announcement-edit-content"
                          rows={10}
                          value={content}
                          onChange={(event) => setContent(event.target.value)}
                          disabled={saving}
                          required
                        />
                        <small>{content.length.toLocaleString()} characters</small>
                      </label>
                    </div>
                  </section>

                  <section className="registrar-announcement-edit__panel">
                    <div className="registrar-announcement-edit__panel-header">
                      <span className="registrar-announcement-edit__panel-icon">
                        <UsersRound size={19} />
                      </span>
                      <div>
                        <span className="registrar-announcement-edit__section-kicker">
                          Audience
                        </span>
                        <h2>Recipients</h2>
                        <p>Select every portal role that should receive this announcement.</p>
                      </div>
                    </div>

                    <div className="registrar-announcement-edit__recipient-grid">
                      {RECIPIENT_ROLES.map((role) => {
                        const selected = recipients.includes(role.role_id);

                        return (
                          <label
                            key={role.role_id}
                            className={`registrar-announcement-edit__recipient-option ${
                              selected
                                ? "registrar-announcement-edit__recipient-option--selected"
                                : ""
                            }`}
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
                              disabled={saving}
                            />
                            <span className="registrar-announcement-edit__recipient-check">
                              {selected ? <Check size={14} /> : <UserRound size={14} />}
                            </span>
                            <span>
                              <strong>{role.role_name}</strong>
                              <small>Portal recipient group</small>
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    <div className="registrar-announcement-edit__selection-meta">
                      <UsersRound size={15} />
                      {recipients.length} recipient group(s) selected
                    </div>
                  </section>

                  <section className="registrar-announcement-edit__panel">
                    <div className="registrar-announcement-edit__panel-header">
                      <span className="registrar-announcement-edit__panel-icon">
                        <Paperclip size={19} />
                      </span>
                      <div>
                        <span className="registrar-announcement-edit__section-kicker">
                          Files
                        </span>
                        <h2>Attachments</h2>
                        <p>Keep or remove existing files and optionally add one new file.</p>
                      </div>
                    </div>

                    {attachments.length > 0 ? (
                      <div className="registrar-announcement-edit__attachment-list">
                        {attachments.map((file) => (
                          <div
                            key={file.file_id}
                            className="registrar-announcement-edit__attachment-item"
                          >
                            <span className="registrar-announcement-edit__attachment-icon">
                              <FileText size={17} />
                            </span>
                            <span>
                              <strong>{file.original_name}</strong>
                              <small>Existing attachment · File #{file.file_id}</small>
                            </span>
                            <button
                              type="button"
                              className="registrar-announcement-edit__remove-button"
                              onClick={() => handleRemoveAttachment(file.file_id)}
                              disabled={saving}
                            >
                              <Trash2 size={15} />
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="registrar-announcement-edit__empty-files">
                        <Paperclip size={19} />
                        No existing attachments.
                      </div>
                    )}

                    <div className="registrar-announcement-edit__upload-box">
                      <div className="registrar-announcement-edit__upload-heading">
                        <span>
                          <FilePlus2 size={18} />
                        </span>
                        <div>
                          <strong>Add Attachment</strong>
                          <small>Select one file to upload with this update.</small>
                        </div>
                      </div>

                      <input
                        id="announcement-edit-file"
                        type="file"
                        onChange={(event) =>
                          setSelectedFile(event.target.files?.[0] || null)
                        }
                        disabled={saving}
                      />

                      {selectedFile && (
                        <div className="registrar-announcement-edit__selected-file">
                          <FileText size={16} />
                          <span>{selectedFile.name}</span>
                          <button
                            type="button"
                            aria-label="Clear selected attachment"
                            onClick={() => setSelectedFile(null)}
                            disabled={saving}
                          >
                            <X size={15} />
                          </button>
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                <aside className="registrar-announcement-edit__side-column">
                  <section className="registrar-announcement-edit__panel registrar-announcement-edit__panel--compact">
                    <div className="registrar-announcement-edit__panel-header">
                      <span className="registrar-announcement-edit__panel-icon">
                        <ShieldCheck size={19} />
                      </span>
                      <div>
                        <span className="registrar-announcement-edit__section-kicker">
                          Publication
                        </span>
                        <h2>Status & Schedule</h2>
                        <p>Control availability and publication dates.</p>
                      </div>
                    </div>

                    <div className="registrar-announcement-edit__fields">
                      <label className="registrar-announcement-edit__field">
                        <span>Status</span>
                        <select
                          id="announcement-edit-status"
                          value={isActive ? "true" : "false"}
                          onChange={(event) =>
                            setIsActive(event.target.value === "true")
                          }
                          disabled={saving}
                        >
                          <option value="true">Active</option>
                          <option value="false">Inactive</option>
                        </select>
                      </label>

                      <div
                        className={`registrar-announcement-edit__status-preview ${
                          isActive
                            ? "registrar-announcement-edit__status-preview--active"
                            : "registrar-announcement-edit__status-preview--inactive"
                        }`}
                      >
                        {isActive ? <CheckCircle2 size={18} /> : <CircleOff size={18} />}
                        <div>
                          <strong>{isActive ? "Active" : "Inactive"}</strong>
                          <p>
                            {isActive
                              ? "The announcement is enabled for its configured audience."
                              : "The announcement is disabled for recipients."}
                          </p>
                        </div>
                      </div>

                      <label className="registrar-announcement-edit__field">
                        <span>
                          <CalendarDays size={14} /> Publish Date <em>*</em>
                        </span>
                        <input
                          id="announcement-edit-publish-date"
                          type="date"
                          value={publishDate}
                          onChange={(event) => setPublishDate(event.target.value)}
                          disabled={saving}
                          required
                        />
                      </label>

                      <label className="registrar-announcement-edit__field">
                        <span>
                          <CalendarClock size={14} /> Expiry Date
                        </span>
                        <input
                          id="announcement-edit-expiry-date"
                          type="date"
                          value={expiryDate}
                          onChange={(event) => setExpiryDate(event.target.value)}
                          min={publishDate || undefined}
                          disabled={saving}
                        />
                        <small>Optional. Leave empty for no configured expiry.</small>
                      </label>
                    </div>
                  </section>

                  <section className="registrar-announcement-edit__save-panel">
                    <div className="registrar-announcement-edit__save-summary">
                      <span className="registrar-announcement-edit__save-icon">
                        <Save size={19} />
                      </span>
                      <div>
                        <strong>Save Changes</strong>
                        <p>
                          This updates announcement #{Number.isInteger(announcementId) ? announcementId : "—"} using the existing management API.
                        </p>
                      </div>
                    </div>

                    <div className="registrar-announcement-edit__save-actions">
                      <button
                        type="button"
                        className="registrar-announcement-edit__button registrar-announcement-edit__button--secondary"
                        onClick={() => navigate("/registrar/announcement/listR")}
                        disabled={saving}
                      >
                        Cancel
                      </button>

                      <button
                        type="submit"
                        disabled={saving || !authenticated || userRole !== "Registrar"}
                        className="registrar-announcement-edit__button registrar-announcement-edit__button--primary"
                      >
                        {saving ? (
                          <>
                            <Loader2 size={17} className="registrar-announcement-edit__spin" />
                            Updating...
                          </>
                        ) : (
                          <>
                            <Save size={17} />
                            Update Announcement
                          </>
                        )}
                      </button>
                    </div>
                  </section>
                </aside>
              </div>
            </form>
          </>
        )}
      </main>
    </DashboardLayout>
  );
}
