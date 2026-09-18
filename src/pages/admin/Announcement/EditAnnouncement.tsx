import { useEffect, useState } from "react";

import { useNavigate, useParams } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";

import { authService } from "../../../services/auth.service";

import "../../../styles/announcementedit.css";

// =====================================================
// API
// =====================================================

const API_BASE_URL = "http://localhost:3000/api/announcement-management";

const ROLE_API_URL = "http://localhost:3000/api/roles";

const FILE_UPLOAD_URL = "http://localhost:3000/api/files/upload";

const FILE_BASE_URL = "http://localhost:3000";

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

// =====================================================
// COMPONENT
// =====================================================

export default function AnnouncementEdit() {
  const navigate = useNavigate();

  const { id } = useParams<{
    id: string;
  }>();

  // =====================================================
  // AUTH
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

  // =====================================================
  // AUTHORIZATION
  // =====================================================

  useEffect(() => {
    if (!authenticated) {
      authService.logout();

      navigate("/login", {
        replace: true,
      });

      return;
    }

    if (userRole !== "Admin") {
      if (userRole) {
        navigate(authService.getDashboardRoute(userRole), {
          replace: true,
        });
      } else {
        navigate("/login", {
          replace: true,
        });
      }
    }
  }, [authenticated, userRole, navigate]);

  // =====================================================
  // LOAD ROLES + ANNOUNCEMENT
  // =====================================================

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

        // =================================================
        // LOAD ROLES
        // =================================================

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

          navigate("/login", {
            replace: true,
          });

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

        // =================================================
        // LOAD ANNOUNCEMENT
        // =================================================

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

          navigate("/login", {
            replace: true,
          });

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
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        console.error("LOAD ADMIN ANNOUNCEMENT EDIT ERROR:", err);

        if (err instanceof TypeError) {
          setError(
            "Unable to connect to the server. Make sure the backend is running on port 3000.",
          );

          return;
        }

        setError(
          err instanceof Error ? err.message : "Unable to load announcement.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadPageData();

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

      return current.filter((id) => id !== roleId);
    });
  };

  // =====================================================
  // REMOVE ATTACHMENT
  // =====================================================

  const removeAttachment = (fileId: number) => {
    setAttachments((current) =>
      current.filter((file) => file.file_id !== fileId),
    );
  };

  // =====================================================
  // FILE UPLOAD
  // =====================================================

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

    // No uploaded_by.
    // Backend uses req.user.user_id.

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

      navigate("/login", {
        replace: true,
      });

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

  // =====================================================
  // SUBMIT
  // =====================================================

  async function handleSubmit(event: React.FormEvent) {
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

      // =================================================
      // EXISTING ATTACHMENTS
      // =================================================

      const attachmentIds = attachments.map((file) => file.file_id);

      // =================================================
      // OPTIONAL NEW ATTACHMENT
      // =================================================

      if (selectedFile) {
        const uploaded = await uploadFile();

        if (uploaded) {
          attachmentIds.push(uploaded.file_id);
        }
      }

      // =================================================
      // UPDATE PAYLOAD
      //
      // No updated_by.
      // Backend derives actor from req.user.user_id.
      // =================================================

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

        navigate("/login", {
          replace: true,
        });

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
    } catch (err) {
      console.error("UPDATE ADMIN ANNOUNCEMENT ERROR:", err);

      if (err instanceof TypeError) {
        setError(
          "Unable to connect to the server. Make sure the backend is running on port 3000.",
        );

        return;
      }

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

  if (!authenticated || !session || userRole !== "Admin") {
    return null;
  }

  // =====================================================
  // LOADING
  // =====================================================

  if (loading) {
    return (
      <DashboardLayout>
        <div className="announcement-loading">Loading announcement...</div>
      </DashboardLayout>
    );
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <DashboardLayout>
      <div className="admin-announcement-edit">
        <div className="announcement-edit-header">
          <h1>Edit Announcement</h1>

          <p>Update announcement information.</p>
        </div>

        {error && <p className="error-message">{error}</p>}

        <form className="announcement-edit-form" onSubmit={handleSubmit}>
          {/* =================================================
              TITLE
          ================================================= */}

          <div className="form-group">
            <label htmlFor="admin-edit-announcement-title">Title</label>

            <input
              id="admin-edit-announcement-title"
              type="text"
              value={title}
              placeholder="Enter announcement title..."
              onChange={(event) => setTitle(event.target.value)}
              disabled={saving}
              required
            />
          </div>

          {/* =================================================
              CONTENT
          ================================================= */}

          <div className="form-group">
            <label htmlFor="admin-edit-announcement-content">Content</label>

            <textarea
              id="admin-edit-announcement-content"
              rows={8}
              value={content}
              placeholder="Write the announcement..."
              onChange={(event) => setContent(event.target.value)}
              disabled={saving}
              required
            />
          </div>

          {/* =================================================
              RECIPIENTS
          ================================================= */}

          <div className="form-group">
            <label>Recipients</label>

            <div className="recipient-list">
              {roles.map((role) => (
                <label key={role.role_id} className="recipient-item">
                  <input
                    type="checkbox"
                    checked={recipients.includes(role.role_id)}
                    onChange={(event) =>
                      handleRecipientChange(role.role_id, event.target.checked)
                    }
                    disabled={saving}
                  />

                  {role.role_name}
                </label>
              ))}
            </div>
          </div>

          {/* =================================================
              CURRENT ATTACHMENTS
          ================================================= */}

          <div className="form-group">
            <label>Current Attachments</label>

            {attachments.length === 0 ? (
              <p>No attachments.</p>
            ) : (
              <div className="attachment-list">
                {attachments.map((file) => {
                  const normalizedPath = String(file.file_path || "").replace(
                    /\\/g,
                    "/",
                  );

                  const fileUrl = `${FILE_BASE_URL}/${normalizedPath.replace(
                    /^\/+/,
                    "",
                  )}`;

                  return (
                    <div key={file.file_id} className="attachment-item">
                      <a href={fileUrl} target="_blank" rel="noreferrer">
                        📎 {file.original_name}
                      </a>

                      <button
                        type="button"
                        className="remove-file-btn"
                        onClick={() => removeAttachment(file.file_id)}
                        disabled={saving}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* =================================================
              ADD ATTACHMENT
          ================================================= */}

          <div className="form-group">
            <label htmlFor="admin-edit-announcement-file">Add Attachment</label>

            <input
              id="admin-edit-announcement-file"
              type="file"
              onChange={(event) =>
                setSelectedFile(event.target.files?.[0] || null)
              }
              disabled={saving}
            />

            {selectedFile && (
              <p className="selected-file">Selected: {selectedFile.name}</p>
            )}
          </div>

          {/* =================================================
              STATUS
          ================================================= */}

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="admin-edit-announcement-status">Status</label>

              <select
                id="admin-edit-announcement-status"
                value={isActive ? "true" : "false"}
                onChange={(event) => setIsActive(event.target.value === "true")}
                disabled={saving}
              >
                <option value="true">Active</option>

                <option value="false">Inactive</option>
              </select>
            </div>
          </div>

          {/* =================================================
              DATES
          ================================================= */}

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="admin-edit-announcement-publish">
                Publish Date
              </label>

              <input
                id="admin-edit-announcement-publish"
                type="date"
                value={publishDate}
                onChange={(event) => setPublishDate(event.target.value)}
                disabled={saving}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="admin-edit-announcement-expiry">
                Expiry Date
              </label>

              <input
                id="admin-edit-announcement-expiry"
                type="date"
                value={expiryDate}
                onChange={(event) => setExpiryDate(event.target.value)}
                min={publishDate || undefined}
                disabled={saving}
              />
            </div>
          </div>

          {/* =================================================
              ACTIONS
          ================================================= */}

          <div className="form-actions">
            <button
              type="button"
              className="cancel-btn"
              onClick={() => navigate("/admin/announcement/list")}
              disabled={saving}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="save-btn"
              disabled={saving || !authenticated || userRole !== "Admin"}
            >
              {saving ? "Updating..." : "Update Announcement"}
            </button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
