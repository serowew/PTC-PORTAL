import { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";

import DashboardLayout from "../../../components/Layout/DashboardLayout";

import DeleteAnnouncementModal from "./DaleteAnnouncementModal";

import { authService } from "../../../services/auth.service";

import "../../../styles/announcementlist.css";

type Announcement = {
  announcement_id: number;

  title: string;

  content: string;

  created_by: string;

  publish_date: string;

  expiry_date: string | null;

  is_active: number;

  created_at: string;

  recipients: string | null;
};

interface AnnouncementListResponse {
  success?: boolean;

  data?: Announcement[];

  announcements?: Announcement[];

  message?: string;

  error?: string;
}

interface DeleteResponse {
  success?: boolean;

  message?: string;

  error?: string;
}

const API_BASE_URL = "http://localhost:3000/api/announcement-management";

export default function AnnouncementList() {
  const navigate = useNavigate();

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

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");

  const [error, setError] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);

  const [deleting, setDeleting] = useState(false);

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
  // LOAD ANNOUNCEMENTS
  // =====================================================

  useEffect(() => {
    if (!authenticated || userRole !== "Admin") {
      return;
    }

    const controller = new AbortController();

    const loadAnnouncements = async () => {
      try {
        setLoading(true);

        setError("");

        const response = await authService.authFetch(API_BASE_URL, {
          method: "GET",

          signal: controller.signal,

          headers: {
            Accept: "application/json",
          },
        });

        const contentType = response.headers.get("content-type") || "";

        let data: Announcement[] | AnnouncementListResponse | null = null;

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
              "You are not authorized to manage announcements.",
          );
        }

        if (!response.ok) {
          const responseObject = !Array.isArray(data) ? data : null;

          throw new Error(
            responseObject?.message ||
              responseObject?.error ||
              `Unable to load announcements (${response.status}).`,
          );
        }

        let loadedAnnouncements: Announcement[] = [];

        if (Array.isArray(data)) {
          loadedAnnouncements = data;
        } else if (data && Array.isArray(data.announcements)) {
          loadedAnnouncements = data.announcements;
        } else if (data && Array.isArray(data.data)) {
          loadedAnnouncements = data.data;
        }

        setAnnouncements(loadedAnnouncements);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        console.error("LOAD ANNOUNCEMENTS ERROR:", err);

        setAnnouncements([]);

        setError(
          err instanceof Error ? err.message : "Unable to load announcements.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadAnnouncements();

    return () => {
      controller.abort();
    };
  }, [authenticated, userRole, navigate]);

  // =====================================================
  // OPEN DELETE MODAL
  // =====================================================

  const openDeleteModal = (announcement: Announcement) => {
    setError("");

    setDeleteTarget(announcement);
  };

  // =====================================================
  // CLOSE DELETE MODAL
  // =====================================================

  const closeDeleteModal = () => {
    if (deleting) {
      return;
    }

    setDeleteTarget(null);
  };

  // =====================================================
  // DELETE ANNOUNCEMENT
  // =====================================================

  const deleteAnnouncement = async () => {
    if (!deleteTarget) {
      return;
    }

    if (!authenticated || userRole !== "Admin") {
      setError(
        "Your session has expired or you are not authorized to delete announcements.",
      );

      return;
    }

    const announcementId = Number(deleteTarget.announcement_id);

    if (!Number.isInteger(announcementId) || announcementId <= 0) {
      setError("Invalid announcement ID.");

      return;
    }

    try {
      setDeleting(true);

      setError("");

      const response = await authService.authFetch(
        `${API_BASE_URL}/${announcementId}`,
        {
          method: "DELETE",

          headers: {
            Accept: "application/json",
          },
        },
      );

      const contentType = response.headers.get("content-type") || "";

      let data: DeleteResponse | null = null;

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

      // ===============================================
      // 401
      // ===============================================

      if (response.status === 401) {
        authService.logout();

        navigate("/login", {
          replace: true,
        });

        return;
      }

      // ===============================================
      // 403
      // ===============================================

      if (response.status === 403) {
        throw new Error(
          data?.message ||
            data?.error ||
            "You are not authorized to delete announcements.",
        );
      }

      // ===============================================
      // ERROR
      // ===============================================

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to delete announcement (${response.status}).`,
        );
      }

      // ===============================================
      // REMOVE FROM TABLE
      // ===============================================

      setAnnouncements((current) =>
        current.filter(
          (announcement) => announcement.announcement_id !== announcementId,
        ),
      );

      // ===============================================
      // CLOSE MODAL
      // ===============================================

      setDeleteTarget(null);
    } catch (err) {
      console.error("DELETE ANNOUNCEMENT ERROR:", err);

      setError(
        err instanceof Error ? err.message : "Unable to delete announcement.",
      );
    } finally {
      setDeleting(false);
    }
  };

  // =====================================================
  // FILTER
  // =====================================================

  const filteredAnnouncements = announcements.filter((announcement) => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return true;
    }

    return (
      String(announcement.title || "")
        .toLowerCase()
        .includes(query) ||
      String(announcement.content || "")
        .toLowerCase()
        .includes(query) ||
      String(announcement.recipients || "")
        .toLowerCase()
        .includes(query) ||
      String(announcement.created_by || "")
        .toLowerCase()
        .includes(query)
    );
  });

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
      <div className="admin-announcement-list">
        {/* HEADER */}

        <div className="announcement-header">
          <div>
            <h1>Announcement Management</h1>

            <p>Manage portal announcements.</p>
          </div>
        </div>

        {/* ERROR */}

        {error && <p className="error-message">{error}</p>}

        {/* SEARCH */}

        <div className="announcement-toolbar">
          <input
            type="text"
            className="announcement-search"
            placeholder="Search announcements..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        {/* TABLE */}

        <div className="announcement-table-container">
          <table className="announcement-table">
            <thead>
              <tr>
                <th>Title</th>

                <th>Audience</th>

                <th>Posted By</th>

                <th>Publish Date</th>

                <th>Expiry Date</th>

                <th>Status</th>

                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="coming-soon">
                    Loading announcements...
                  </td>
                </tr>
              ) : filteredAnnouncements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="coming-soon">
                    No announcements found.
                  </td>
                </tr>
              ) : (
                filteredAnnouncements.map((announcement) => (
                  <tr key={announcement.announcement_id}>
                    <td>{announcement.title}</td>

                    <td>{announcement.recipients || "None"}</td>

                    <td>{announcement.created_by || "Unknown"}</td>

                    <td>
                      {announcement.publish_date
                        ? new Date(
                            announcement.publish_date,
                          ).toLocaleDateString()
                        : "-"}
                    </td>

                    <td>
                      {announcement.expiry_date
                        ? new Date(
                            announcement.expiry_date,
                          ).toLocaleDateString()
                        : "-"}
                    </td>

                    <td>
                      <span
                        className={`status ${
                          Number(announcement.is_active) === 1
                            ? "published"
                            : "expired"
                        }`}
                      >
                        {Number(announcement.is_active) === 1
                          ? "Active"
                          : "Inactive"}
                      </span>
                    </td>

                    <td>
                      {/* VIEW */}

                      <button
                        type="button"
                        className="action-btn view"
                        onClick={() =>
                          navigate(
                            `/admin/announcement/details/${announcement.announcement_id}`,
                          )
                        }
                      >
                        View
                      </button>

                      {/* EDIT */}

                      <button
                        type="button"
                        className="action-btn edit"
                        onClick={() =>
                          navigate(
                            `/admin/announcement/edit/${announcement.announcement_id}`,
                          )
                        }
                      >
                        Edit
                      </button>

                      {/* DELETE */}

                      <button
                        type="button"
                        className="action-btn delete"
                        onClick={() => openDeleteModal(announcement)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* =================================================
            DELETE MODAL
        ================================================= */}

        <DeleteAnnouncementModal
          isOpen={Boolean(deleteTarget)}
          announcementTitle={deleteTarget?.title}
          isDeleting={deleting}
          onCancel={closeDeleteModal}
          onConfirm={() => void deleteAnnouncement()}
        />
      </div>
    </DashboardLayout>
  );
}
