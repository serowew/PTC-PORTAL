import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarClock,
  CircleAlert,
  Eye,
  LoaderCircle,
  Megaphone,
  Pencil,
  Plus,
  Search,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import DeleteAnnouncementModal from "./DaleteAnnouncementModal";
import { authService } from "../../../services/auth.service";
import { apiUrl } from "../../../services/api";
import "../../../styles/AdminAnnouncementList.css";

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

const API_BASE_URL = apiUrl("/api/announcement-management");

type StatusFilter = "All" | "Active" | "Inactive";

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AnnouncementList() {
  const navigate = useNavigate();

  const session = authService.getSession();
  const token = authService.getToken();
  const userRole = session?.role;
  const authenticated = Boolean(session && token);

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const summary = useMemo(() => {
    const active = announcements.filter(
      (announcement) => Number(announcement.is_active) === 1,
    ).length;

    const inactive = announcements.length - active;

    const audiences = new Set(
      announcements
        .map((announcement) => String(announcement.recipients || "").trim())
        .filter(Boolean),
    ).size;

    return {
      active,
      inactive,
      audiences,
    };
  }, [announcements]);

  const filteredAnnouncements = useMemo(() => {
    const query = search.trim().toLowerCase();

    return announcements.filter((announcement) => {
      const isActive = Number(announcement.is_active) === 1;

      const matchesStatus =
        statusFilter === "All" ||
        (statusFilter === "Active" && isActive) ||
        (statusFilter === "Inactive" && !isActive);

      if (!matchesStatus) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [
        announcement.title,
        announcement.content,
        announcement.recipients,
        announcement.created_by,
      ].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(query),
      );
    });
  }, [announcements, search, statusFilter]);

  const openDeleteModal = (announcement: Announcement) => {
    setError("");
    setDeleteTarget(announcement);
  };

  const closeDeleteModal = () => {
    if (deleting) {
      return;
    }

    setDeleteTarget(null);
  };

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
            "You are not authorized to delete announcements.",
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            `Failed to delete announcement (${response.status}).`,
        );
      }

      setAnnouncements((current) =>
        current.filter(
          (announcement) => announcement.announcement_id !== announcementId,
        ),
      );

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

  const hasFilters = Boolean(search.trim()) || statusFilter !== "All";

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("All");
  };

  if (!authenticated || !session || userRole !== "Admin") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="admin-announcement-directory">
        <section className="admin-announcement-directory__hero">
          <div className="admin-announcement-directory__hero-copy">
            <div className="admin-announcement-directory__eyebrow">
              <span>
                <Megaphone size={16} aria-hidden="true" />
              </span>
              Admin · Announcement Management
            </div>

            <h1>Announcement Management</h1>

            <p>
              Review, create, edit, and remove portal announcements from one
              administrative workspace.
            </p>
          </div>

          <button
            type="button"
            className="admin-announcement-directory__create"
            onClick={() => navigate("/admin/announcement/create")}
          >
            <Plus size={17} aria-hidden="true" />
            Create Announcement
          </button>
        </section>

        <section
          className="admin-announcement-directory__summary"
          aria-label="Announcement overview"
        >
          <article>
            <span className="admin-announcement-directory__summary-icon">
              <Megaphone size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Total Announcements</small>
              <strong>
                {loading ? "…" : announcements.length.toLocaleString()}
              </strong>
            </div>
          </article>

          <article>
            <span className="admin-announcement-directory__summary-icon">
              <CalendarClock size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Active</small>
              <strong>{loading ? "…" : summary.active.toLocaleString()}</strong>
            </div>
          </article>

          <article>
            <span className="admin-announcement-directory__summary-icon">
              <CircleAlert size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Inactive</small>
              <strong>
                {loading ? "…" : summary.inactive.toLocaleString()}
              </strong>
            </div>
          </article>

          <article>
            <span className="admin-announcement-directory__summary-icon">
              <UsersRound size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Audience Groups</small>
              <strong>
                {loading ? "…" : summary.audiences.toLocaleString()}
              </strong>
            </div>
          </article>
        </section>

        {error && (
          <div className="admin-announcement-directory__error" role="status">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <section className="admin-announcement-directory__workspace">
          <header className="admin-announcement-directory__workspace-header">
            <div>
              <span className="admin-announcement-directory__section-kicker">
                Portal Communications
              </span>
              <h2>Announcement List</h2>
              <p>
                {loading
                  ? "Loading announcements…"
                  : `${filteredAnnouncements.length.toLocaleString()} of ${announcements.length.toLocaleString()} announcement${
                      announcements.length === 1 ? "" : "s"
                    } shown`}
              </p>
            </div>

            <div className="admin-announcement-directory__filters">
              <label className="admin-announcement-directory__search">
                <Search size={16} aria-hidden="true" />

                <input
                  type="text"
                  placeholder="Search title, content, audience, or author"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="Search announcements"
                />

                {search && (
                  <button
                    type="button"
                    aria-label="Clear announcement search"
                    onClick={() => setSearch("")}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </label>

              <select
                className="admin-announcement-directory__status-filter"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
                aria-label="Filter announcements by status"
              >
                <option value="All">All statuses</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>

              {hasFilters && (
                <button
                  type="button"
                  className="admin-announcement-directory__clear"
                  onClick={clearFilters}
                >
                  Clear
                </button>
              )}
            </div>
          </header>

          <div className="admin-announcement-directory__table-wrap">
            <table className="admin-announcement-directory__table">
              <thead>
                <tr>
                  <th>Announcement</th>
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
                    <td colSpan={7}>
                      <div className="admin-announcement-directory__table-state">
                        <LoaderCircle
                          size={22}
                          className="admin-announcement-directory__spinner"
                          aria-hidden="true"
                        />
                        <span>Loading announcements...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredAnnouncements.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="admin-announcement-directory__table-state">
                        <Megaphone size={22} aria-hidden="true" />
                        <strong>No announcements found</strong>
                        <span>
                          {hasFilters
                            ? "Try changing or clearing your filters."
                            : "Created announcements will appear here."}
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredAnnouncements.map((announcement) => {
                    const isActive = Number(announcement.is_active) === 1;

                    return (
                      <tr key={announcement.announcement_id}>
                        <td>
                          <div className="admin-announcement-directory__title-cell">
                            <span className="admin-announcement-directory__announcement-icon">
                              <Megaphone size={15} aria-hidden="true" />
                            </span>

                            <div>
                              <strong>{announcement.title}</strong>
                              <small>
                                Announcement #{announcement.announcement_id}
                              </small>
                            </div>
                          </div>
                        </td>

                        <td>
                          <span className="admin-announcement-directory__audience">
                            {announcement.recipients || "None"}
                          </span>
                        </td>

                        <td>{announcement.created_by || "Unknown"}</td>

                        <td>{formatDate(announcement.publish_date)}</td>

                        <td>{formatDate(announcement.expiry_date)}</td>

                        <td>
                          <span
                            className={
                              isActive
                                ? "admin-announcement-directory__status admin-announcement-directory__status--active"
                                : "admin-announcement-directory__status admin-announcement-directory__status--inactive"
                            }
                          >
                            {isActive ? "Active" : "Inactive"}
                          </span>
                        </td>

                        <td>
                          <div className="admin-announcement-directory__actions">
                            <button
                              type="button"
                              className="admin-announcement-directory__action admin-announcement-directory__action--view"
                              onClick={() =>
                                navigate(
                                  `/admin/announcement/details/${announcement.announcement_id}`,
                                )
                              }
                            >
                              <Eye size={14} aria-hidden="true" />
                              View
                            </button>

                            <button
                              type="button"
                              className="admin-announcement-directory__action admin-announcement-directory__action--edit"
                              onClick={() =>
                                navigate(
                                  `/admin/announcement/edit/${announcement.announcement_id}`,
                                )
                              }
                            >
                              <Pencil size={14} aria-hidden="true" />
                              Edit
                            </button>

                            <button
                              type="button"
                              className="admin-announcement-directory__action admin-announcement-directory__action--delete"
                              onClick={() => openDeleteModal(announcement)}
                            >
                              <Trash2 size={14} aria-hidden="true" />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <DeleteAnnouncementModal
          isOpen={Boolean(deleteTarget)}
          announcementTitle={deleteTarget?.title}
          isDeleting={deleting}
          onCancel={closeDeleteModal}
          onConfirm={() => void deleteAnnouncement()}
        />
      </main>
    </DashboardLayout>
  );
}
