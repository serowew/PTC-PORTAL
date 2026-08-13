import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/announcementedit.css";

const API_BASE_URL = "http://localhost:3000/api/admin/announcements";
const ROLE_API_URL = "http://localhost:3000/api/roles";
const FILE_UPLOAD_URL = "http://localhost:3000/api/files/upload";

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

export default function AnnouncementEdit() {
  const navigate = useNavigate();
  const { id } = useParams();

  const session = authService.getSession();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const [roles, setRoles] = useState<Role[]>([]);
  const [recipients, setRecipients] = useState<number[]>([]);

  const [publishDate, setPublishDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  const [isActive, setIsActive] = useState(true);

  // Attachment states
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!session || session.role !== "Admin") {
      navigate("/login");
      return;
    }

    loadRoles();
    loadAnnouncement();
  }, []);

  async function loadRoles() {
    try {
      const response = await fetch(ROLE_API_URL);

      if (!response.ok) {
        throw new Error("Unable to load roles.");
      }

      const data = await response.json();

      setRoles(data);
    } catch (err) {
      console.error(err);
      alert("Unable to load roles.");
    }
  }

  async function loadAnnouncement() {
    try {
      const response = await fetch(`${API_BASE_URL}/${id}`);

      if (!response.ok) {
        throw new Error("Unable to load announcement.");
      }

      const data = await response.json();

      setTitle(data.title);
      setContent(data.content);

      setPublishDate(data.publish_date?.split("T")[0] || "");

      setExpiryDate(data.expiry_date ? data.expiry_date.split("T")[0] : "");

      setIsActive(data.is_active === 1);

      setRecipients(data.recipients.map((role: Role) => role.role_id));

      setAttachments(data.attachments || []);
    } catch (err) {
      console.error(err);

      alert("Unable to load announcement.");

      navigate("/admin/announcement/list");
    } finally {
      setLoading(false);
    }
  }

  async function uploadFile() {
    if (!selectedFile) {
      return null;
    }

    const formData = new FormData();

    formData.append("file", selectedFile);

    formData.append("uploaded_by", String(session?.user_id));

    const response = await fetch(FILE_UPLOAD_URL, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "File upload failed.");
    }

    return {
      file_id: data.file_id,
      original_name: data.file_name,
    };
  }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!title.trim()) {
      alert("Title is required.");
      return;
    }

    if (!content.trim()) {
      alert("Content is required.");
      return;
    }

    if (!publishDate) {
      alert("Publish date is required.");
      return;
    }

    if (recipients.length === 0) {
      alert("Please select at least one recipient.");
      return;
    }

    try {
      setSaving(true);

      // ====================================
      // Existing attachment IDs
      // ====================================

      const attachmentIds = attachments.map((file) => file.file_id);

      // ====================================
      // Upload newly selected file
      // ====================================

      if (selectedFile) {
        const uploaded = await uploadFile();

        if (uploaded) {
          attachmentIds.push(uploaded.file_id);

          setAttachments([
            ...attachments,
            {
              file_id: uploaded.file_id,
              original_name: uploaded.original_name,
              file_path: "",
              file_size: 0,
              mime_type: "",
            },
          ]);
        }
      }

      // ====================================
      // Update announcement
      // ====================================

      const response = await fetch(`${API_BASE_URL}/${id}`, {
        method: "PUT",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          title: title.trim(),

          content: content.trim(),

          publish_date: `${publishDate} 00:00:00`,

          expiry_date: expiryDate ? `${expiryDate} 23:59:59` : null,

          is_active: isActive ? 1 : 0,

          recipients,

          attachments: attachmentIds,

          updated_by: session!.user_id,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update announcement.");
      }

      alert("Announcement updated successfully.");

      navigate("/admin/announcement/list");
    } catch (err) {
      console.error(err);

      if (err instanceof Error) {
        alert(err.message);
      } else {
        alert("Unable to update announcement.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (!session || session.role !== "Admin") {
    return null;
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="announcement-loading">Loading announcement...</div>
      </DashboardLayout>
    );
  }
  return (
    <DashboardLayout>
      <div className="admin-announcement-edit">
        <div className="announcement-edit-header">
          <h1>Edit Announcement</h1>
          <p>Update announcement information.</p>
        </div>

        <form className="announcement-edit-form" onSubmit={handleSubmit}>
          {/* Title */}
          <div className="form-group">
            <label>Title</label>

            <input
              type="text"
              value={title}
              placeholder="Enter announcement title..."
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Content */}
          <div className="form-group">
            <label>Content</label>

            <textarea
              rows={8}
              value={content}
              placeholder="Write the announcement..."
              onChange={(e) => setContent(e.target.value)}
            />
          </div>

          {/* Recipients */}
          <div className="form-group">
            <label>Recipients</label>

            <div className="recipient-list">
              {roles.map((role) => (
                <label key={role.role_id} className="recipient-item">
                  <input
                    type="checkbox"
                    checked={recipients.includes(role.role_id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setRecipients([...recipients, role.role_id]);
                      } else {
                        setRecipients(
                          recipients.filter((id) => id !== role.role_id),
                        );
                      }
                    }}
                  />

                  {role.role_name}
                </label>
              ))}
            </div>
          </div>

          {/* Existing Attachments */}
          <div className="form-group">
            <label>Current Attachments</label>

            {attachments.length === 0 ? (
              <p>No attachments.</p>
            ) : (
              <div className="attachment-list">
                {attachments.map((file) => (
                  <div key={file.file_id} className="attachment-item">
                    <a
                      href={`http://localhost:3000/${file.file_path.replace(
                        /\\/g,
                        "/",
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      📎 {file.original_name}
                    </a>

                    <button
                      type="button"
                      className="remove-file-btn"
                      onClick={() =>
                        setAttachments(
                          attachments.filter((f) => f.file_id !== file.file_id),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upload New File */}
          <div className="form-group">
            <label>Add Attachment</label>

            <input
              type="file"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            />

            {selectedFile && (
              <p className="selected-file">Selected: {selectedFile.name}</p>
            )}
          </div>

          {/* Status */}
          <div className="form-row">
            <div className="form-group">
              <label>Status</label>

              <select
                value={isActive ? "true" : "false"}
                onChange={(e) => setIsActive(e.target.value === "true")}
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
          </div>

          {/* Dates */}
          <div className="form-row">
            <div className="form-group">
              <label>Publish Date</label>

              <input
                type="date"
                value={publishDate}
                onChange={(e) => setPublishDate(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Expiry Date</label>

              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </div>
          </div>

          {/* Buttons */}
          <div className="form-actions">
            <button
              type="button"
              className="cancel-btn"
              onClick={() => navigate("/admin/announcement/list")}
            >
              Cancel
            </button>

            <button type="submit" className="save-btn" disabled={saving}>
              {saving ? "Updating..." : "Update Announcement"}
            </button>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
