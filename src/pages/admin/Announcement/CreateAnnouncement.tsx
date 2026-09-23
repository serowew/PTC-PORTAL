import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  CircleOff,
  FileUp,
  LoaderCircle,
  Megaphone,
  Paperclip,
  Send,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import "../../../styles/AdminCreateAnnouncement.css";

const ANNOUNCEMENT_API_URL = apiUrl("/api/announcement-management");
const ROLE_API_URL = apiUrl("/api/roles");
const FILE_UPLOAD_URL = apiUrl("/api/files/upload");

type Role = {
  role_id: number;
  role_name: string;
};

type RoleApiResponse =
  | Role[]
  | {
      success?: boolean;
      roles?: Role[];
      data?: Role[];
      error?: string;
      message?: string;
    };

type UploadResponse = {
  success?: boolean;
  file_id?: number | string;
  file?: {
    file_id?: number | string;
  };
  data?: {
    file_id?: number | string;
  };
  error?: string;
  message?: string;
};

type AnnouncementResponse = {
  success?: boolean;
  announcement_id?: number;
  error?: string;
  message?: string;
};

export default function CreateAnnouncement() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const userRole = String(session?.role ?? "");
  const authenticated = Boolean(session);
  const isAdmin = authenticated && userRole.toLowerCase() === "admin";

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const [roles, setRoles] = useState<Role[]>([]);
  const [recipients, setRecipients] = useState<number[]>([]);

  const [publishDate, setPublishDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  const [isActive, setIsActive] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [error, setError] = useState("");

  const TITLE_MAX_LENGTH = 150;
  const CONTENT_MAX_LENGTH = 5000;

  useEffect(() => {
    if (!isAdmin) {
      authService.logout();
      navigate("/login", { replace: true });
      return;
    }

    const controller = new AbortController();

    const loadRoles = async () => {
      try {
        setRolesLoading(true);

        const response = await authService.authFetch(ROLE_API_URL, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });

        const contentType = response.headers.get("content-type") || "";

        if (!contentType.includes("application/json")) {
          const text = await response.text();

          throw new Error(
            `Role server returned a non-JSON response (${response.status}): ${text.slice(
              0,
              200,
            )}`,
          );
        }

        const data: RoleApiResponse = await response.json();

        if (response.status === 401) {
          authService.logout();
          navigate("/login", { replace: true });
          return;
        }

        if (response.status === 403) {
          throw new Error(
            Array.isArray(data)
              ? "You are not authorized to load roles."
              : data.message ||
                  data.error ||
                  "You are not authorized to load roles.",
          );
        }

        if (!response.ok) {
          if (Array.isArray(data)) {
            throw new Error("Unable to load roles.");
          }

          throw new Error(
            data.error || data.message || "Unable to load roles.",
          );
        }

        let roleList: Role[] = [];

        if (Array.isArray(data)) {
          roleList = data;
        } else if (Array.isArray(data.roles)) {
          roleList = data.roles;
        } else if (Array.isArray(data.data)) {
          roleList = data.data;
        }

        setRoles(roleList);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        console.error("Load roles error:", err);

        setError(err instanceof Error ? err.message : "Unable to load roles.");
      } finally {
        if (!controller.signal.aborted) {
          setRolesLoading(false);
        }
      }
    };

    void loadRoles();

    return () => controller.abort();
  }, [isAdmin, navigate]);

  const selectedRecipientNames = useMemo(
    () =>
      roles
        .filter((role) => recipients.includes(role.role_id))
        .map((role) => role.role_name),
    [roles, recipients],
  );

  function handleRecipientChange(roleId: number, checked: boolean) {
    if (checked) {
      setRecipients((currentRecipients) => {
        if (currentRecipients.includes(roleId)) {
          return currentRecipients;
        }

        return [...currentRecipients, roleId];
      });

      if (error) {
        setError("");
      }

      return;
    }

    setRecipients((currentRecipients) =>
      currentRecipients.filter((id) => id !== roleId),
    );
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
  }

  async function uploadFile(): Promise<number | null> {
    if (!selectedFile) {
      return null;
    }

    if (!isAdmin) {
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
    let data: UploadResponse = {};

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

      throw new Error("Your session has expired. Please log in again.");
    }

    if (response.status === 403) {
      throw new Error(
        data.message || data.error || "You are not authorized to upload files.",
      );
    }

    if (!response.ok) {
      throw new Error(
        data.message ||
          data.error ||
          `File upload failed (${response.status}).`,
      );
    }

    const uploadedFileId = Number(
      data.file_id ?? data.file?.file_id ?? data.data?.file_id,
    );

    if (!Number.isInteger(uploadedFileId) || uploadedFileId <= 0) {
      throw new Error(
        "File uploaded, but the server did not return a valid file ID.",
      );
    }

    return uploadedFileId;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

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

    if (!isAdmin) {
      setError(
        "Your session has expired or you are not authorized to create announcements.",
      );
      return;
    }

    try {
      setLoading(true);

      let uploadedFileId: number | null = null;

      if (selectedFile) {
        uploadedFileId = await uploadFile();
      }

      const announcementData = {
        title: cleanTitle,
        content: cleanContent,
        publish_date: `${publishDate} 00:00:00`,
        expiry_date: expiryDate ? `${expiryDate} 23:59:59` : null,
        is_active: isActive ? 1 : 0,
        recipients,
        attachments: uploadedFileId ? [uploadedFileId] : [],
      };

      const response = await authService.authFetch(ANNOUNCEMENT_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(announcementData),
      });

      const contentType = response.headers.get("content-type") || "";
      let data: AnnouncementResponse = {};

      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();

        if (!response.ok) {
          throw new Error(
            `Announcement server returned a non-JSON response (${response.status}): ${text.slice(
              0,
              200,
            )}`,
          );
        }
      }

      if (response.status === 401) {
        authService.logout();
        navigate("/login", { replace: true });

        throw new Error("Your session has expired. Please log in again.");
      }

      if (response.status === 403) {
        throw new Error(
          data.message ||
            data.error ||
            "You are not authorized to create announcements.",
        );
      }

      if (!response.ok) {
        throw new Error(
          data.error || data.message || "Failed to create announcement.",
        );
      }

      window.alert("Announcement created successfully!");
      navigate("/admin/announcement/list");
    } catch (err) {
      console.error("Create announcement error:", err);

      setError(
        err instanceof Error ? err.message : "Failed to create announcement.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    navigate("/admin/announcement/list");
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="admin-create-announcement">
        <div className="admin-create-announcement__toolbar">
          <button
            type="button"
            className="admin-create-announcement__back"
            onClick={handleCancel}
            disabled={loading}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to Announcements
          </button>
        </div>

        <section className="admin-create-announcement__hero">
          <div className="admin-create-announcement__hero-copy">
            <div className="admin-create-announcement__eyebrow">
              <span>
                <Megaphone size={16} aria-hidden="true" />
              </span>
              Admin · Announcement Management
            </div>

            <h1>Create Announcement</h1>

            <p>
              Create and publish announcements for selected members of the PTC
              community.
            </p>
          </div>

          <div className="admin-create-announcement__hero-status">
            <span
              className={
                isActive
                  ? "admin-create-announcement__status admin-create-announcement__status--active"
                  : "admin-create-announcement__status admin-create-announcement__status--inactive"
              }
            >
              {isActive ? (
                <CheckCircle2 size={15} aria-hidden="true" />
              ) : (
                <CircleOff size={15} aria-hidden="true" />
              )}
              {isActive ? "Active" : "Inactive"}
            </span>
          </div>
        </section>

        {error && (
          <div className="admin-create-announcement__error" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <form
          className="admin-create-announcement__form"
          onSubmit={handleSubmit}
        >
          <div className="admin-create-announcement__form-grid">
            <div className="admin-create-announcement__main-column">
              <section className="admin-create-announcement__card">
                <header className="admin-create-announcement__card-header">
                  <span className="admin-create-announcement__card-icon">
                    <Megaphone size={18} aria-hidden="true" />
                  </span>

                  <div>
                    <span>Announcement Details</span>
                    <h2>Message Information</h2>
                    <p>Enter the title and content that recipients will see.</p>
                  </div>
                </header>

                <div className="admin-create-announcement__card-body">
                  <label className="admin-create-announcement__field">
                    <span>
                      Title <em>*</em>
                    </span>

                    <input
                      id="announcement-title"
                      type="text"
                      value={title}
                      maxLength={TITLE_MAX_LENGTH}
                      placeholder="Enter announcement title"
                      autoComplete="off"
                      disabled={loading}
                      onChange={(event) => {
                        setTitle(event.target.value);

                        if (error) {
                          setError("");
                        }
                      }}
                    />

                    <small className="admin-create-announcement__counter">
                      {title.length}/{TITLE_MAX_LENGTH}
                    </small>
                  </label>

                  <label className="admin-create-announcement__field">
                    <span>
                      Content <em>*</em>
                    </span>

                    <textarea
                      id="announcement-content"
                      rows={8}
                      value={content}
                      maxLength={CONTENT_MAX_LENGTH}
                      placeholder="Write the announcement message here..."
                      disabled={loading}
                      onChange={(event) => {
                        setContent(event.target.value);

                        if (error) {
                          setError("");
                        }
                      }}
                    />

                    <small className="admin-create-announcement__counter">
                      {content.length}/{CONTENT_MAX_LENGTH}
                    </small>
                  </label>
                </div>
              </section>

              <section className="admin-create-announcement__card">
                <header className="admin-create-announcement__card-header">
                  <span className="admin-create-announcement__card-icon">
                    <Paperclip size={18} aria-hidden="true" />
                  </span>

                  <div>
                    <span>Attachment</span>
                    <h2>Supporting File</h2>
                    <p>
                      Optionally attach a document, image, or other supporting
                      file.
                    </p>
                  </div>
                </header>

                <div className="admin-create-announcement__card-body">
                  <label className="admin-create-announcement__file-field">
                    <span className="admin-create-announcement__file-icon">
                      <FileUp size={20} aria-hidden="true" />
                    </span>

                    <span className="admin-create-announcement__file-copy">
                      <strong>
                        {selectedFile
                          ? selectedFile.name
                          : "Choose an attachment"}
                      </strong>
                      <small>
                        {selectedFile
                          ? "This file will be uploaded with the announcement."
                          : "Optional. Select one file to attach."}
                      </small>
                    </span>

                    <span className="admin-create-announcement__file-action">
                      Browse
                    </span>

                    <input
                      id="announcement-file"
                      type="file"
                      disabled={loading}
                      onChange={handleFileChange}
                    />
                  </label>
                </div>
              </section>
            </div>

            <aside className="admin-create-announcement__side-column">
              <section className="admin-create-announcement__card">
                <header className="admin-create-announcement__card-header">
                  <span className="admin-create-announcement__card-icon">
                    <UsersRound size={18} aria-hidden="true" />
                  </span>

                  <div>
                    <span>Audience</span>
                    <h2>Recipients</h2>
                    <p>Select one or more user roles.</p>
                  </div>
                </header>

                <div className="admin-create-announcement__card-body">
                  {rolesLoading ? (
                    <div className="admin-create-announcement__inline-state">
                      <LoaderCircle
                        size={18}
                        className="admin-create-announcement__spinner"
                        aria-hidden="true"
                      />
                      Loading recipient roles...
                    </div>
                  ) : roles.length > 0 ? (
                    <div className="admin-create-announcement__recipients">
                      {roles.map((role) => {
                        const checked = recipients.includes(role.role_id);

                        return (
                          <label
                            key={role.role_id}
                            className={
                              checked
                                ? "admin-create-announcement__recipient admin-create-announcement__recipient--selected"
                                : "admin-create-announcement__recipient"
                            }
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={loading}
                              onChange={(event) =>
                                handleRecipientChange(
                                  role.role_id,
                                  event.target.checked,
                                )
                              }
                            />

                            <span>{role.role_name}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="admin-create-announcement__inline-state">
                      No recipient roles available.
                    </div>
                  )}

                  <div className="admin-create-announcement__selection">
                    <span>Selected</span>
                    <strong>
                      {selectedRecipientNames.length === 0
                        ? "No recipients selected"
                        : selectedRecipientNames.join(", ")}
                    </strong>
                  </div>
                </div>
              </section>

              <section className="admin-create-announcement__card">
                <header className="admin-create-announcement__card-header">
                  <span className="admin-create-announcement__card-icon">
                    <CalendarClock size={18} aria-hidden="true" />
                  </span>

                  <div>
                    <span>Publishing</span>
                    <h2>Publish Settings</h2>
                    <p>Set status and publication dates.</p>
                  </div>
                </header>

                <div className="admin-create-announcement__card-body admin-create-announcement__settings">
                  <label className="admin-create-announcement__field">
                    <span>Status</span>

                    <select
                      id="announcement-status"
                      value={isActive ? "true" : "false"}
                      disabled={loading}
                      onChange={(event) =>
                        setIsActive(event.target.value === "true")
                      }
                    >
                      <option value="true">Active</option>
                      <option value="false">Inactive</option>
                    </select>

                    <small>
                      Active announcements can be shown to selected recipients.
                    </small>
                  </label>

                  <label className="admin-create-announcement__field">
                    <span>
                      Publish Date <em>*</em>
                    </span>

                    <div className="admin-create-announcement__input-with-icon">
                      <CalendarDays size={15} aria-hidden="true" />
                      <input
                        id="publish-date"
                        type="date"
                        value={publishDate}
                        disabled={loading}
                        onChange={(event) => {
                          const newPublishDate = event.target.value;
                          setPublishDate(newPublishDate);

                          if (
                            expiryDate &&
                            newPublishDate &&
                            expiryDate < newPublishDate
                          ) {
                            setExpiryDate("");
                          }

                          if (error) {
                            setError("");
                          }
                        }}
                      />
                    </div>

                    <small>Date when the announcement becomes available.</small>
                  </label>

                  <label className="admin-create-announcement__field">
                    <span>Expiry Date</span>

                    <div className="admin-create-announcement__input-with-icon">
                      <CalendarClock size={15} aria-hidden="true" />
                      <input
                        id="expiry-date"
                        type="date"
                        value={expiryDate}
                        min={publishDate || undefined}
                        disabled={loading}
                        onChange={(event) => setExpiryDate(event.target.value)}
                      />
                    </div>

                    <small>
                      Optional. Leave empty if the announcement should not
                      expire.
                    </small>
                  </label>
                </div>
              </section>

              <section className="admin-create-announcement__actions-card">
                <div className="admin-create-announcement__actions-copy">
                  <ShieldCheck size={18} aria-hidden="true" />
                  <div>
                    <strong>Ready to publish?</strong>
                    <span>
                      Required fields and at least one recipient must be
                      selected.
                    </span>
                  </div>
                </div>

                <div className="admin-create-announcement__actions">
                  <button
                    type="button"
                    className="admin-create-announcement__button admin-create-announcement__button--secondary"
                    disabled={loading}
                    onClick={handleCancel}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="admin-create-announcement__button admin-create-announcement__button--primary"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <LoaderCircle
                          size={16}
                          className="admin-create-announcement__spinner"
                          aria-hidden="true"
                        />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Send size={16} aria-hidden="true" />
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
