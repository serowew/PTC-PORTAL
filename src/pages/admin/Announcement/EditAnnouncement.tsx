import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  CircleAlert,
  FilePlus2,
  FileText,
  LoaderCircle,
  Megaphone,
  Paperclip,
  Save,
  ShieldCheck,
  Trash2,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import "../../../styles/AdminAnnouncementEdit.css";

const API_BASE_URL = apiUrl("/api/announcement-management");
const ROLE_API_URL = apiUrl("/api/roles");
const FILE_UPLOAD_URL = apiUrl("/api/files/upload");
const FILE_BASE_URL = "API_BASE_URL";

type Role = {
  role_id: number;
  role_name: string;
};

type Attachment = {
  file_id: number;
  original_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
};

type Announcement = {
  announcement_id: number;
  title: string;
  content: string;
  publish_date: string;
  expiry_date: string | null;
  is_active: number;
  recipients: Role[];
  attachments: Attachment[];
};

interface AnnouncementResponse {
  success?: boolean;
  announcement?: Announcement;
  data?: Announcement;
  message?: string;
  error?: string;
}

interface RoleResponse {
  success?: boolean;
  roles?: Role[];
  data?: Role[];
  message?: string;
  error?: string;
}

interface UploadResponse {
  success?: boolean;
  file_id?: number;
  file_name?: string;
  file?: {
    file_id?: number;
    original_name?: string;
    file_name?: string;
  };
  data?: {
    file_id?: number;
    original_name?: string;
    file_name?: string;
  };
  message?: string;
  error?: string;
}

interface UpdateResponse {
  success?: boolean;
  message?: string;
  error?: string;
}

function buildAttachmentUrl(filePath: string) {
  const normalizedPath = String(filePath || "").replace(/\\/g, "/");

  return `${FILE_BASE_URL}/${normalizedPath.replace(/^\/+/, "")}`;
}

export default function AnnouncementEdit() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const session = authService.getSession();
  const token = authService.getToken();
  const userRole = session?.role;
  const authenticated = Boolean(session && token);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [recipients, setRecipients] = useState<number[]>([]);
  const [publishDate, setPublishDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authenticated) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    if (userRole !== "Admin") {
      if (userRole) {
        navigate(authService.getDashboardRoute(userRole), { replace: true });
      } else {
        navigate("/login", { replace: true });
      }
    }
  }, [authenticated, userRole, navigate]);

  useEffect(() => {
    if (!authenticated || userRole !== "Admin") {
      return;
    }

    const announcementId = Number(id);

    if (!Number.isInteger(announcementId) || announcementId <= 0) {
      setError("Invalid announcement ID.");
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    const loadPageData = async () => {
      try {
        setLoading(true);
        setError("");

        const rolesResponse = await authService.authFetch(ROLE_API_URL, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });

        const rolesContentType =
          rolesResponse.headers.get("content-type") || "";
        let rolesData: Role[] | RoleResponse | null = null;

        if (rolesContentType.includes("application/json")) {
          rolesData = await rolesResponse.json();
        } else {
          const text = await rolesResponse.text();

          throw new Error(
            `Role server returned a non-JSON response (${rolesResponse.status}): ${text.slice(
              0,
              200,
            )}`,
          );
        }

        if (rolesResponse.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (rolesResponse.status === 403) {
          const responseObject = !Array.isArray(rolesData) ? rolesData : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              "You are not authorized to load roles.",
          );
        }

        if (!rolesResponse.ok) {
          const responseObject = !Array.isArray(rolesData) ? rolesData : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              `Unable to load roles (${rolesResponse.status}).`,
          );
        }

        let loadedRoles: Role[] = [];

        if (Array.isArray(rolesData)) {
          loadedRoles = rolesData;
        } else if (rolesData && Array.isArray(rolesData.roles)) {
          loadedRoles = rolesData.roles;
        } else if (rolesData && Array.isArray(rolesData.data)) {
          loadedRoles = rolesData.data;
        }

        setRoles(loadedRoles);

        const announcementResponse = await authService.authFetch(
          `${API_BASE_URL}/${announcementId}`,
          {
            method: "GET",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          },
        );

        const announcementContentType =
          announcementResponse.headers.get("content-type") || "";
        let announcementData: Announcement | AnnouncementResponse | null = null;

        if (announcementContentType.includes("application/json")) {
          announcementData = await announcementResponse.json();
        } else {
          const text = await announcementResponse.text();

          throw new Error(
            `Announcement server returned a non-JSON response (${announcementResponse.status}): ${text.slice(
              0,
              200,
            )}`,
          );
        }

        if (announcementResponse.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (announcementResponse.status === 403) {
          const responseObject =
            announcementData && !("announcement_id" in announcementData)
              ? announcementData
              : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              "You are not authorized to edit this announcement.",
          );
        }

        if (!announcementResponse.ok) {
          const responseObject =
            announcementData && !("announcement_id" in announcementData)
              ? announcementData
              : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              `Unable to load announcement (${announcementResponse.status}).`,
          );
        }

        let loadedAnnouncement: Announcement | null = null;

        if (announcementData && "announcement_id" in announcementData) {
          loadedAnnouncement = announcementData;
        } else if (announcementData && announcementData.announcement) {
          loadedAnnouncement = announcementData.announcement;
        } else if (announcementData && announcementData.data) {
          loadedAnnouncement = announcementData.data;
        }

        if (!loadedAnnouncement) {
          throw new Error("Announcement data was not returned by the server.");
        }

        setTitle(loadedAnnouncement.title || "");
        setContent(loadedAnnouncement.content || "");
        setPublishDate(
          loadedAnnouncement.publish_date
            ? String(loadedAnnouncement.publish_date).slice(0, 10)
            : "",
        );
        setExpiryDate(
          loadedAnnouncement.expiry_date
            ? String(loadedAnnouncement.expiry_date).slice(0, 10)
            : "",
        );
        setIsActive(Number(loadedAnnouncement.is_active) === 1);
        setRecipients(
          Array.isArray(loadedAnnouncement.recipients)
            ? loadedAnnouncement.recipients
                .map((role) => Number(role.role_id))
                .filter((roleId) => Number.isInteger(roleId) && roleId > 0)
            : [],
        );
        setAttachments(
          Array.isArray(loadedAnnouncement.attachments)
            ? loadedAnnouncement.attachments
            : [],
        );
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        console.error("LOAD ADMIN ANNOUNCEMENT EDIT ERROR:", requestError);

        if (requestError instanceof TypeError) {
          setError(
            "Unable to connect to the server. Make sure the backend is running on port 3000.",
          );
          return;
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load announcement.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadPageData();

    return () => controller.abort();
  }, [id, authenticated, userRole, navigate]);

  const handleRecipientChange = (roleId: number, checked: boolean) => {
    setRecipients((current) => {
      if (checked) {
        return current.includes(roleId) ? current : [...current, roleId];
      }

      return current.filter((recipientId) => recipientId !== roleId);
    });
  };

  const removeAttachment = (fileId: number) => {
    setAttachments((current) =>
      current.filter((file) => file.file_id !== fileId),
    );
  };

  async function uploadFile(): Promise<{
    file_id: number;
    original_name: string;
  } | null> {
    if (!selectedFile) {
      return null;
    }

    if (!authenticated || userRole !== "Admin") {
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
      navigate("/login", { replace: true });
      throw new Error("Your session has expired.");
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

    const originalName = String(
      data?.file?.original_name ??
        data?.file?.file_name ??
        data?.data?.original_name ??
        data?.data?.file_name ??
        data?.file_name ??
        selectedFile.name,
    );

    return {
      file_id: fileId,
      original_name: originalName,
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!authenticated || userRole !== "Admin") {
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
      setError("Please select at least one recipient.");
      return;
    }

    if (expiryDate && expiryDate < publishDate) {
      setError("Expiry date cannot be earlier than the publish date.");
      return;
    }

    try {
      setSaving(true);

      const attachmentIds = attachments.map((file) => file.file_id);

      if (selectedFile) {
        const uploaded = await uploadFile();

        if (uploaded) {
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
        `${API_BASE_URL}/${announcementId}`,
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
      navigate("/admin/announcement/list");
    } catch (requestError) {
      console.error("UPDATE ADMIN ANNOUNCEMENT ERROR:", requestError);

      if (requestError instanceof TypeError) {
        setError(
          "Unable to connect to the server. Make sure the backend is running on port 3000.",
        );
        return;
      }

      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to update announcement.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!authenticated || !session || userRole !== "Admin") {
    return null;
  }

  if (loading) {
    return (
      <DashboardLayout>
        <main className="admin-announcement-editor">
          <section className="admin-announcement-editor__state">
            <span className="admin-announcement-editor__state-icon">
              <LoaderCircle
                size={24}
                className="admin-announcement-editor__spinner"
                aria-hidden="true"
              />
            </span>
            <strong>Loading announcement...</strong>
            <p>Please wait while the announcement and role information load.</p>
          </section>
        </main>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <main className="admin-announcement-editor">
        <div className="admin-announcement-editor__toolbar">
          <button
            type="button"
            className="admin-announcement-editor__back"
            onClick={() => navigate("/admin/announcement/list")}
            disabled={saving}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to Announcements
          </button>
        </div>

        <section className="admin-announcement-editor__hero">
          <div className="admin-announcement-editor__hero-copy">
            <div className="admin-announcement-editor__eyebrow">
              <span>
                <Megaphone size={16} aria-hidden="true" />
              </span>
              Admin · Announcement Management
            </div>

            <h1>Edit Announcement</h1>

            <p>
              Update announcement content, recipients, publication dates,
              attachments, and visibility status.
            </p>
          </div>

          <div className="admin-announcement-editor__record">
            <small>Announcement ID</small>
            <strong>{id || "Invalid"}</strong>
          </div>
        </section>

        {error && (
          <div className="admin-announcement-editor__error" role="status">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form
          className="admin-announcement-editor__form"
          onSubmit={handleSubmit}
        >
          <section className="admin-announcement-editor__section admin-announcement-editor__section--wide">
            <header className="admin-announcement-editor__section-header">
              <span className="admin-announcement-editor__section-icon">
                <FileText size={18} aria-hidden="true" />
              </span>
              <div>
                <span>Announcement Details</span>
                <h2>Content</h2>
                <p>Edit the title and message shown to recipients.</p>
              </div>
            </header>

            <div className="admin-announcement-editor__fields">
              <label className="admin-announcement-editor__field admin-announcement-editor__field--wide">
                <span>
                  Title <em>*</em>
                </span>
                <input
                  id="admin-edit-announcement-title"
                  type="text"
                  value={title}
                  placeholder="Enter announcement title..."
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={saving}
                  required
                />
              </label>

              <label className="admin-announcement-editor__field admin-announcement-editor__field--wide">
                <span>
                  Content <em>*</em>
                </span>
                <textarea
                  id="admin-edit-announcement-content"
                  rows={8}
                  value={content}
                  placeholder="Write the announcement..."
                  onChange={(event) => setContent(event.target.value)}
                  disabled={saving}
                  required
                />
              </label>
            </div>
          </section>

          <section className="admin-announcement-editor__section">
            <header className="admin-announcement-editor__section-header">
              <span className="admin-announcement-editor__section-icon">
                <UsersRound size={18} aria-hidden="true" />
              </span>
              <div>
                <span>Audience</span>
                <h2>Recipients</h2>
                <p>Select at least one portal role.</p>
              </div>
            </header>

            <div className="admin-announcement-editor__recipients">
              {roles.length === 0 ? (
                <div className="admin-announcement-editor__empty">
                  No roles available.
                </div>
              ) : (
                roles.map((role) => {
                  const selected = recipients.includes(role.role_id);

                  return (
                    <label
                      key={role.role_id}
                      className={
                        selected
                          ? "admin-announcement-editor__recipient is-selected"
                          : "admin-announcement-editor__recipient"
                      }
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

                      <span className="admin-announcement-editor__recipient-icon">
                        <ShieldCheck size={15} aria-hidden="true" />
                      </span>

                      <span>{role.role_name}</span>
                    </label>
                  );
                })
              )}
            </div>
          </section>

          <section className="admin-announcement-editor__section">
            <header className="admin-announcement-editor__section-header">
              <span className="admin-announcement-editor__section-icon">
                <CalendarDays size={18} aria-hidden="true" />
              </span>
              <div>
                <span>Publishing</span>
                <h2>Status &amp; Dates</h2>
                <p>Control visibility and publication period.</p>
              </div>
            </header>

            <div className="admin-announcement-editor__fields">
              <label className="admin-announcement-editor__field">
                <span>Status</span>
                <select
                  id="admin-edit-announcement-status"
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

              <label className="admin-announcement-editor__field">
                <span>
                  Publish Date <em>*</em>
                </span>
                <input
                  id="admin-edit-announcement-publish"
                  type="date"
                  value={publishDate}
                  onChange={(event) => setPublishDate(event.target.value)}
                  disabled={saving}
                  required
                />
              </label>

              <label className="admin-announcement-editor__field admin-announcement-editor__field--wide">
                <span>Expiry Date</span>
                <input
                  id="admin-edit-announcement-expiry"
                  type="date"
                  value={expiryDate}
                  onChange={(event) => setExpiryDate(event.target.value)}
                  min={publishDate || undefined}
                  disabled={saving}
                />
              </label>
            </div>
          </section>

          <section className="admin-announcement-editor__section admin-announcement-editor__section--wide">
            <header className="admin-announcement-editor__section-header">
              <span className="admin-announcement-editor__section-icon">
                <Paperclip size={18} aria-hidden="true" />
              </span>
              <div>
                <span>Files</span>
                <h2>Attachments</h2>
                <p>
                  Keep or remove existing files and optionally add a new one.
                </p>
              </div>
            </header>

            <div className="admin-announcement-editor__attachment-area">
              <div className="admin-announcement-editor__existing-files">
                <h3>Current Attachments</h3>

                {attachments.length === 0 ? (
                  <div className="admin-announcement-editor__empty">
                    <Paperclip size={17} aria-hidden="true" />
                    No attachments.
                  </div>
                ) : (
                  <div className="admin-announcement-editor__attachment-list">
                    {attachments.map((file) => (
                      <div
                        key={file.file_id}
                        className="admin-announcement-editor__attachment"
                      >
                        <a
                          href={buildAttachmentUrl(file.file_path)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span className="admin-announcement-editor__file-icon">
                            <FileText size={16} aria-hidden="true" />
                          </span>
                          <span>{file.original_name}</span>
                        </a>

                        <button
                          type="button"
                          className="admin-announcement-editor__remove"
                          onClick={() => removeAttachment(file.file_id)}
                          disabled={saving}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="admin-announcement-editor__new-file">
                <h3>Add Attachment</h3>

                <label className="admin-announcement-editor__file-picker">
                  <FilePlus2 size={19} aria-hidden="true" />
                  <span>
                    <strong>Choose a file</strong>
                    <small>
                      {selectedFile
                        ? selectedFile.name
                        : "No new attachment selected"}
                    </small>
                  </span>

                  <input
                    id="admin-edit-announcement-file"
                    type="file"
                    onChange={(event) =>
                      setSelectedFile(event.target.files?.[0] || null)
                    }
                    disabled={saving}
                  />
                </label>

                {selectedFile && (
                  <button
                    type="button"
                    className="admin-announcement-editor__clear-file"
                    onClick={() => setSelectedFile(null)}
                    disabled={saving}
                  >
                    Clear selected file
                  </button>
                )}
              </div>
            </div>
          </section>

          <footer className="admin-announcement-editor__actions">
            <button
              type="button"
              className="admin-announcement-editor__cancel"
              onClick={() => navigate("/admin/announcement/list")}
              disabled={saving}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="admin-announcement-editor__save"
              disabled={saving || !authenticated || userRole !== "Admin"}
            >
              {saving ? (
                <LoaderCircle
                  size={16}
                  className="admin-announcement-editor__spinner"
                  aria-hidden="true"
                />
              ) : (
                <Save size={16} aria-hidden="true" />
              )}
              {saving ? "Updating..." : "Update Announcement"}
            </button>
          </footer>
        </form>
      </main>
    </DashboardLayout>
  );
}
