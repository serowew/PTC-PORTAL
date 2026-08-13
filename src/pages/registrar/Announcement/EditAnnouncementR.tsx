import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/announcementeditR.css";

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

export default function AnnouncementEditR() {
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

  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!session || session.role !== "Registrar") {
      navigate("/login");

      return;
    }

    loadRoles();

    loadAnnouncement();
  }, []);

  async function loadRoles() {
    try {
      const response = await fetch(ROLE_API_URL);

      const data = await response.json();

      setRoles(data);
    } catch (error) {
      console.error(error);

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
    } catch (error) {
      console.error(error);

      alert("Unable to load announcement.");

      navigate("/registrar/announcement/listR");
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

    try {
      setSaving(true);

      const attachmentIds = attachments.map((file) => file.file_id);

      if (selectedFile) {
        const uploaded = await uploadFile();

        if (uploaded) {
          attachmentIds.push(uploaded.file_id);
        }
      }

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

          updated_by: session?.user_id,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed updating announcement.");
      }

      alert("Announcement updated successfully.");

      navigate("/registrar/announcement/listR");
    } catch (error) {
      console.error(error);

      if (error instanceof Error) {
        alert(error.message);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!session || session.role !== "Registrar") {
    return null;
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div>Loading announcement...</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="registrar-announcement-editR">
        <h1>Edit Announcement</h1>

        <form onSubmit={handleSubmit} className="announcement-formR">
          <label>Title</label>

          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <label>Content</label>

          <textarea
            rows={8}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />

          <label>Recipients</label>

          <div className="recipient-list">
            {roles.map((role) => (
              <label key={role.role_id}>
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

          <label>Add Attachment</label>

          <input
            type="file"
            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
          />

          <label>Status</label>

          <select
            value={isActive ? "true" : "false"}
            onChange={(e) => setIsActive(e.target.value === "true")}
          >
            <option value="true">Active</option>

            <option value="false">Inactive</option>
          </select>

          <label>Publish Date</label>

          <input
            type="date"
            value={publishDate}
            onChange={(e) => setPublishDate(e.target.value)}
          />

          <label>Expiry Date</label>

          <input
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
          />

          <button disabled={saving} className="save-btn">
            {saving ? "Updating..." : "Update Announcement"}
          </button>
        </form>
      </div>
    </DashboardLayout>
  );
}
