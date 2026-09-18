import { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";

import { authService } from "../../../services/auth.service";

import "../../../styles/announcementcreate.css";

const ANNOUNCEMENT_API_URL =
  "http://localhost:3000/api/announcement-management";

const ROLE_API_URL = "http://localhost:3000/api/roles";

const FILE_UPLOAD_URL = "http://localhost:3000/api/files/upload";

// =====================================================
// TYPES
// =====================================================

type Role = {
  role_id: number;
  role_name: string;
};

interface RoleResponse {
  success?: boolean;

  data?: Role[];

  roles?: Role[];

  message?: string;

  error?: string;
}

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
// COMPONENT
// =====================================================

export default function CreateAnnouncement() {
  const navigate = useNavigate();

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

  const [roles, setRoles] = useState<Role[]>([]);

  const [recipients, setRecipients] = useState<number[]>([]);

  const [publishDate, setPublishDate] = useState("");

  const [expiryDate, setExpiryDate] = useState("");

  const [isActive, setIsActive] = useState(true);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);

  const [rolesLoading, setRolesLoading] = useState(true);

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
  // LOAD ROLES
  // =====================================================

  useEffect(() => {
    if (!authenticated || userRole !== "Admin") {
      return;
    }

    const controller = new AbortController();

    const loadRoles = async () => {
      try {
        setRolesLoading(true);

        setError("");

        const response = await authService.authFetch(ROLE_API_URL, {
          method: "GET",

          signal: controller.signal,

          headers: {
            Accept: "application/json",
          },
        });

        const contentType = response.headers.get("content-type") || "";

        let data: Role[] | RoleResponse | null = null;

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
          const responseObject = !Array.isArray(data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              "You are not authorized to load roles.",
          );
        }

        if (!response.ok) {
          const responseObject = !Array.isArray(data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              `Unable to load roles (${response.status}).`,
          );
        }

        let loadedRoles: Role[] = [];

        if (Array.isArray(data)) {
          loadedRoles = data;
        } else if (data && Array.isArray(data.roles)) {
          loadedRoles = data.roles;
        } else if (data && Array.isArray(data.data)) {
          loadedRoles = data.data;
        }

        setRoles(loadedRoles);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        console.error("LOAD ANNOUNCEMENT ROLES ERROR:", err);

        setRoles([]);

        setError(err instanceof Error ? err.message : "Unable to load roles.");
      } finally {
        if (!controller.signal.aborted) {
          setRolesLoading(false);
        }
      }
    };

    void loadRoles();

    return () => {
      controller.abort();
    };
  }, [authenticated, userRole, navigate]);

  // =====================================================
  // FILE UPLOAD
  // =====================================================

  async function uploadFile(): Promise<number | null> {
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

    // IMPORTANT:
    // Do not send uploaded_by.
    // Backend should use req.user.user_id.

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

    const uploadedFileId = Number(
      data?.file_id ?? data?.file?.file_id ?? data?.data?.file_id,
    );

    if (!Number.isInteger(uploadedFileId) || uploadedFileId <= 0) {
      throw new Error(
        "File uploaded, but the server did not return a valid file ID.",
      );
    }

    return uploadedFileId;
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
  };

  // =====================================================
  // SUBMIT
  // =====================================================

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setError("");

    if (!authenticated || userRole !== "Admin") {
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

      // =================================================
      // OPTIONAL FILE UPLOAD
      // =================================================

      let uploadedFileId: number | null = null;

      if (selectedFile) {
        uploadedFileId = await uploadFile();
      }

      // =================================================
      // PAYLOAD
      //
      // Do NOT send:
      //
      // created_by
      // role_id
      //
      // Backend gets actor from req.user.
      // =================================================

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

        navigate("/login", {
          replace: true,
        });

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

      window.alert(data?.message || "Announcement created successfully!");

      navigate("/admin/announcement/list");
    } catch (err) {
      console.error("CREATE ADMIN ANNOUNCEMENT ERROR:", err);

      if (err instanceof TypeError) {
        setError(
          "Unable to connect to the server. Make sure the backend is running on port 3000.",
        );

        return;
      }

      setError(
        err instanceof Error ? err.message : "Failed to create announcement.",
      );
    } finally {
      setLoading(false);
    }
  }

  // =====================================================
  // AUTH GUARD
  // =====================================================

  if (!authenticated || !session || userRole !== "Admin") {
    return null;
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <DashboardLayout>
      <div className="admin-announcement-create">
        <h1>Create Announcement</h1>

        {error && <p className="error-message">{error}</p>}

        <form className="announcement-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="admin-announcement-title">Title</label>

            <input
              id="admin-announcement-title"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="admin-announcement-content">Content</label>

            <textarea
              id="admin-announcement-content"
              rows={8}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label>Recipients</label>

            {rolesLoading ? (
              <p>Loading roles...</p>
            ) : (
              <div className="recipient-list">
                {roles.map((role) => (
                  <label key={role.role_id}>
                    <input
                      type="checkbox"
                      checked={recipients.includes(role.role_id)}
                      onChange={(event) =>
                        handleRecipientChange(
                          role.role_id,
                          event.target.checked,
                        )
                      }
                      disabled={loading}
                    />

                    {role.role_name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="admin-announcement-file">Attachment</label>

            <input
              id="admin-announcement-file"
              type="file"
              onChange={(event) =>
                setSelectedFile(event.target.files?.[0] || null)
              }
              disabled={loading}
            />

            {selectedFile && <p>Selected: {selectedFile.name}</p>}
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="admin-announcement-status">Status</label>

              <select
                id="admin-announcement-status"
                value={isActive ? "true" : "false"}
                onChange={(event) => setIsActive(event.target.value === "true")}
                disabled={loading}
              >
                <option value="true">Active</option>

                <option value="false">Inactive</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="admin-announcement-publish-date">
                Publish Date
              </label>

              <input
                id="admin-announcement-publish-date"
                type="date"
                value={publishDate}
                onChange={(event) => setPublishDate(event.target.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="admin-announcement-expiry-date">
                Expiry Date
              </label>

              <input
                id="admin-announcement-expiry-date"
                type="date"
                value={expiryDate}
                onChange={(event) => setExpiryDate(event.target.value)}
                min={publishDate || undefined}
                disabled={loading}
              />
            </div>
          </div>

          <div className="button-group">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate("/admin/announcement/list")}
              disabled={loading}
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={
                loading ||
                rolesLoading ||
                !authenticated ||
                userRole !== "Admin"
              }
              className="save-btn"
            >
              {loading ? "Creating..." : "Create Announcement"}
            </button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
