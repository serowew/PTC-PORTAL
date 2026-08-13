import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/announcementcreateR.css";

const API_BASE_URL = "http://localhost:3000/api/admin/announcements";
const ROLE_API_URL = "http://localhost:3000/api/roles";
const FILE_UPLOAD_URL = "http://localhost:3000/api/files/upload";

type Role = {
  role_id: number;
  role_name: string;
};

export default function AnnouncementCreateR() {
  const navigate = useNavigate();

  const session = authService.getSession();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const [roles, setRoles] = useState<Role[]>([]);
  const [recipients, setRecipients] = useState<number[]>([]);

  const [publishDate, setPublishDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  const [isActive, setIsActive] = useState(true);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!session || session.role !== "Registrar") {
      navigate("/login");
      return;
    }

    loadRoles();
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

    return data.file_id;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!title.trim()) {
      alert("Title required.");
      return;
    }

    if (!content.trim()) {
      alert("Content required.");
      return;
    }

    if (!publishDate) {
      alert("Publish date required.");
      return;
    }

    if (recipients.length === 0) {
      alert("Select recipients.");
      return;
    }

    try {
      setLoading(true);

      let fileId = null;

      if (selectedFile) {
        fileId = await uploadFile();
      }

      const announcementData = {
        title: title.trim(),

        content: content.trim(),

        created_by: session?.user_id,

        role_id: session?.role_id, // <-- ADD THIS

        publish_date: `${publishDate} 00:00:00`,

        expiry_date: expiryDate ? `${expiryDate} 23:59:59` : null,

        is_active: isActive ? 1 : 0,

        recipients,

        attachments: fileId ? [fileId] : [],
      };

      const response = await fetch(API_BASE_URL, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify(announcementData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed creating announcement.");
      }

      alert("Announcement created successfully.");

      navigate("/registrar/announcement/listR");
    } catch (error) {
      console.error(error);

      if (error instanceof Error) {
        alert(error.message);
      }
    } finally {
      setLoading(false);
    }
  }

  if (!session || session.role !== "Registrar") {
    return null;
  }

  return (
    <DashboardLayout>
      <div className="registrar-announcement-createR">
        <h1>Create Announcement</h1>

        <form className="announcement-formR" onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Title</label>

            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Announcement title"
            />
          </div>

          <div className="form-group">
            <label>Content</label>

            <textarea
              rows={8}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write announcement..."
            />
          </div>

          <div className="form-group">
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
          </div>

          <div className="form-group">
            <label>Attachment</label>

            <input
              type="file"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            />

            {selectedFile && (
              <p>
                Selected:
                {selectedFile.name}
              </p>
            )}
          </div>

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

          <button className="save-btn" disabled={loading}>
            {loading ? "Creating..." : "Create Announcement"}
          </button>
        </form>
      </div>
    </DashboardLayout>
  );
}
