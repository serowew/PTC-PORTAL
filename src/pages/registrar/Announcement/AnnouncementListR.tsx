import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleOff,
  Eye,
  Filter,
  Megaphone,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/announcementRegistrar.css";

const API_BASE_URL = "http://localhost:3000";

interface Announcement {
  announcement_id: number;
  title: string;
  content: string;
  created_by: string;
  publish_date: string;
  expiry_date: string | null;
  is_active: number;
  created_at: string;
  recipients: string | null;
  attachments: string | null;
}

interface AnnouncementResponse {
  success?: boolean;
  data?: Announcement[];
  announcements?: Announcement[];
  message?: string;
  error?: string;
}

type StatusFilter = "all" | "active" | "inactive";

const formatDate = (date: string | null | undefined) => {
  if (!date) return "Not set";

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) return "Not set";

  return parsedDate.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const getRecipientLabels = (recipients: string | null) => {
  if (!recipients?.trim()) return [];

  const value = recipients.trim();

  try {
    const parsed = JSON.parse(value);

    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item).trim())
        .filter(Boolean);
    }
  } catch {
    // The backend may return a normal comma-separated string.
  }

  return value
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
};

export default function AnnouncementListR() {
  const navigate = useNavigate();

  // =====================================================
  // AUTHENTICATION
  // =====================================================

  const user = authService.getSession();
  const token = authService.getToken();
  const userRole = user?.role;
  const authenticated = Boolean(user && token);

  // =====================================================
  // STATE
  // =====================================================

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [recipientFilter, setRecipientFilter] = useState("all");

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
  // LOAD ANNOUNCEMENTS
  // =====================================================

  useEffect(() => {
    if (!authenticated || userRole !== "Registrar") {
      return;
    }

    const controller = new AbortController();

    const loadAnnouncements = async () => {
      try {
        setLoading(true);
        setError("");

        // Registrar management endpoint is intentionally preserved.
        const url = `${API_BASE_URL}/api/announcement-management`;

        console.log("GET REGISTRAR ANNOUNCEMENT MANAGEMENT:", url);

        const response = await authService.authFetch(url, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });

        const contentType = response.headers.get("content-type") || "";
        let data: Announcement[] | AnnouncementResponse | null = null;

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
              `Failed to load announcements (${response.status}).`,
          );
        }

        let loadedAnnouncements: Announcement[] = [];

        if (Array.isArray(data)) {
          loadedAnnouncements = data;
        } else if (data && Array.isArray(data.data)) {
          loadedAnnouncements = data.data;
        } else if (data && Array.isArray(data.announcements)) {
          loadedAnnouncements = data.announcements;
        }

        console.log("REGISTRAR MANAGEMENT ANNOUNCEMENTS:", loadedAnnouncements);
        setAnnouncements(loadedAnnouncements);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        console.error("LOAD REGISTRAR ANNOUNCEMENTS ERROR:", err);
        setAnnouncements([]);

        if (err instanceof TypeError) {
          setError(
            "Unable to connect to the announcement server. Make sure the backend is running on port 3000.",
          );
          return;
        }

        setError(err instanceof Error ? err.message : "Something went wrong.");
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
  // FRONTEND-ONLY DIRECTORY HELPERS
  // =====================================================

  const recipientOptions = useMemo(() => {
    const recipients = new Set<string>();

    announcements.forEach((announcement) => {
      getRecipientLabels(announcement.recipients).forEach((recipient) => {
        recipients.add(recipient);
      });
    });

    return Array.from(recipients).sort((a, b) => a.localeCompare(b));
  }, [announcements]);

  const summary = useMemo(() => {
    const active = announcements.filter(
      (announcement) => Number(announcement.is_active) === 1,
    ).length;

    return {
      total: announcements.length,
      active,
      inactive: announcements.length - active,
      audiences: recipientOptions.length,
    };
  }, [announcements, recipientOptions.length]);

  const filteredAnnouncements = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return announcements.filter((announcement) => {
      const active = Number(announcement.is_active) === 1;
      const recipientLabels = getRecipientLabels(announcement.recipients);

      const matchesSearch =
        !normalizedSearch ||
        announcement.title?.toLowerCase().includes(normalizedSearch) ||
        announcement.content?.toLowerCase().includes(normalizedSearch) ||
        announcement.created_by?.toLowerCase().includes(normalizedSearch) ||
        recipientLabels.some((recipient) =>
          recipient.toLowerCase().includes(normalizedSearch),
        );

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && active) ||
        (statusFilter === "inactive" && !active);

      const matchesRecipient =
        recipientFilter === "all" || recipientLabels.includes(recipientFilter);

      return matchesSearch && matchesStatus && matchesRecipient;
    });
  }, [announcements, searchTerm, statusFilter, recipientFilter]);

  const hasFilters =
    searchTerm.trim().length > 0 ||
    statusFilter !== "all" ||
    recipientFilter !== "all";

  const clearFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setRecipientFilter("all");
  };

  // =====================================================
  // AUTH GUARD
  // =====================================================

  if (!authenticated || !user || userRole !== "Registrar") {
    return null;
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <DashboardLayout>
      <main className="registrar-announcements">
        {/* HERO */}
        <section className="registrar-announcements__hero">
          <div className="registrar-announcements__hero-copy">
            <div className="registrar-announcements__eyebrow">
              <span className="registrar-announcements__eyebrow-icon">
                <Megaphone size={16} strokeWidth={2.2} />
              </span>
              Registrar · Announcements
            </div>

            <h1>Announcement Management</h1>
            <p>
              Create, review, and manage official portal announcements from one
              organized Registrar workspace.
            </p>
          </div>

          <div className="registrar-announcements__hero-actions">
            <div className="registrar-announcements__hero-badge">
              <span className="registrar-announcements__hero-badge-icon">
                <ShieldCheck size={19} strokeWidth={2.1} />
              </span>
              <span>
                <small>Access</small>
                <strong>Registrar Manager</strong>
              </span>
            </div>

            <button
              type="button"
              className="registrar-announcements__button registrar-announcements__button--primary"
              onClick={() => navigate("/registrar/announcement/createR")}
            >
              <Plus size={17} strokeWidth={2.3} />
              Create Announcement
            </button>
          </div>
        </section>

        {/* SUMMARY */}
        {!loading && !error && (
          <section className="registrar-announcements__stats" aria-label="Announcement summary">
            <article className="registrar-announcements__stat-card">
              <span className="registrar-announcements__stat-icon registrar-announcements__stat-icon--primary">
                <Megaphone size={20} />
              </span>
              <div>
                <span>Total Announcements</span>
                <strong>{summary.total}</strong>
                <small>All management records</small>
              </div>
            </article>

            <article className="registrar-announcements__stat-card">
              <span className="registrar-announcements__stat-icon registrar-announcements__stat-icon--success">
                <CheckCircle2 size={20} />
              </span>
              <div>
                <span>Active</span>
                <strong>{summary.active}</strong>
                <small>Currently marked active</small>
              </div>
            </article>

            <article className="registrar-announcements__stat-card">
              <span className="registrar-announcements__stat-icon">
                <CircleOff size={20} />
              </span>
              <div>
                <span>Inactive</span>
                <strong>{summary.inactive}</strong>
                <small>Currently marked inactive</small>
              </div>
            </article>

            <article className="registrar-announcements__stat-card">
              <span className="registrar-announcements__stat-icon">
                <UsersRound size={20} />
              </span>
              <div>
                <span>Audience Groups</span>
                <strong>{summary.audiences}</strong>
                <small>Recipient labels in use</small>
              </div>
            </article>
          </section>
        )}

        {/* WORKSPACE */}
        <section className="registrar-announcements__workspace">
          <div className="registrar-announcements__workspace-header">
            <div>
              <span className="registrar-announcements__section-kicker">
                <Activity size={14} /> Announcement Directory
              </span>
              <h2>Manage Announcements</h2>
              <p>
                Search, filter, open, and edit announcements without leaving the
                Registrar management workspace.
              </p>
            </div>

            {!loading && !error && (
              <span className="registrar-announcements__record-count">
                {filteredAnnouncements.length} of {announcements.length} records
              </span>
            )}
          </div>

          {!loading && !error && announcements.length > 0 && (
            <>
              <div className="registrar-announcements__toolbar">
                <div className="registrar-announcements__search">
                  <Search size={17} />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search title, content, creator, or recipient..."
                    aria-label="Search announcements"
                  />

                  {searchTerm && (
                    <button
                      type="button"
                      className="registrar-announcements__search-clear"
                      onClick={() => setSearchTerm("")}
                      aria-label="Clear search"
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>

                <div className="registrar-announcements__filters">
                  <span className="registrar-announcements__filter-label">
                    <Filter size={14} /> Filters
                  </span>

                  <select
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(event.target.value as StatusFilter)
                    }
                    aria-label="Filter announcements by status"
                  >
                    <option value="all">All Statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>

                  <select
                    value={recipientFilter}
                    onChange={(event) => setRecipientFilter(event.target.value)}
                    aria-label="Filter announcements by recipient"
                  >
                    <option value="all">All Recipients</option>
                    {recipientOptions.map((recipient) => (
                      <option value={recipient} key={recipient}>
                        {recipient}
                      </option>
                    ))}
                  </select>

                  {hasFilters && (
                    <button
                      type="button"
                      className="registrar-announcements__clear-filters"
                      onClick={clearFilters}
                    >
                      <X size={14} />
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {hasFilters && (
                <div className="registrar-announcements__filter-summary">
                  <Filter size={13} />
                  <strong>Active filters</strong>
                  {searchTerm.trim() && <span>Search: {searchTerm.trim()}</span>}
                  {statusFilter !== "all" && <span>Status: {statusFilter}</span>}
                  {recipientFilter !== "all" && (
                    <span>Recipient: {recipientFilter}</span>
                  )}
                </div>
              )}
            </>
          )}

          {/* LOADING */}
          {loading && (
            <div className="registrar-announcements__card-grid registrar-announcements__card-grid--loading">
              {[1, 2, 3, 4, 5, 6].map((item) => (
                <div className="registrar-announcements__skeleton-card" key={item}>
                  <div className="registrar-announcements__skeleton-line registrar-announcements__skeleton-line--short" />
                  <div className="registrar-announcements__skeleton-line registrar-announcements__skeleton-line--title" />
                  <div className="registrar-announcements__skeleton-line" />
                  <div className="registrar-announcements__skeleton-line" />
                  <div className="registrar-announcements__skeleton-footer" />
                </div>
              ))}
            </div>
          )}

          {/* ERROR */}
          {!loading && error && (
            <div className="registrar-announcements__state registrar-announcements__state--error">
              <span className="registrar-announcements__state-icon">
                <CircleOff size={25} />
              </span>
              <h3>Announcements could not be loaded</h3>
              <p>{error}</p>
            </div>
          )}

          {/* EMPTY */}
          {!loading && !error && announcements.length === 0 && (
            <div className="registrar-announcements__state">
              <span className="registrar-announcements__state-icon">
                <Megaphone size={26} />
              </span>
              <h3>No announcements yet</h3>
              <p>
                Create the first Registrar announcement to start building the
                announcement directory.
              </p>
              <button
                type="button"
                className="registrar-announcements__button registrar-announcements__button--primary"
                onClick={() => navigate("/registrar/announcement/createR")}
              >
                <Plus size={17} />
                Create Announcement
              </button>
            </div>
          )}

          {/* FILTERED EMPTY */}
          {!loading &&
            !error &&
            announcements.length > 0 &&
            filteredAnnouncements.length === 0 && (
              <div className="registrar-announcements__state">
                <span className="registrar-announcements__state-icon">
                  <Search size={26} />
                </span>
                <h3>No matching announcements</h3>
                <p>
                  Try changing the search term or clearing one of the active
                  filters.
                </p>
                <button
                  type="button"
                  className="registrar-announcements__button registrar-announcements__button--secondary"
                  onClick={clearFilters}
                >
                  <X size={16} />
                  Clear Filters
                </button>
              </div>
            )}

          {/* ANNOUNCEMENT GRID */}
          {!loading && !error && filteredAnnouncements.length > 0 && (
            <div className="registrar-announcements__card-grid">
              {filteredAnnouncements.map((item) => {
                const active = Number(item.is_active) === 1;
                const recipientLabels = getRecipientLabels(item.recipients);
                const visibleRecipients = recipientLabels.slice(0, 3);
                const hiddenRecipientCount = Math.max(
                  recipientLabels.length - visibleRecipients.length,
                  0,
                );

                return (
                  <article
                    key={item.announcement_id}
                    className="registrar-announcements__card"
                  >
                    <div className="registrar-announcements__card-top">
                      <span className="registrar-announcements__card-icon">
                        <Megaphone size={18} />
                      </span>

                      <span
                        className={`registrar-announcements__status ${
                          active
                            ? "registrar-announcements__status--active"
                            : "registrar-announcements__status--inactive"
                        }`}
                      >
                        <span />
                        {active ? "Active" : "Inactive"}
                      </span>
                    </div>

                    <div className="registrar-announcements__card-heading">
                      <span>Announcement #{item.announcement_id}</span>
                      <h3>{item.title || "Untitled Announcement"}</h3>
                    </div>

                    <p className="registrar-announcements__preview">
                      {item.content
                        ? item.content.length > 180
                          ? `${item.content.substring(0, 180)}...`
                          : item.content
                        : "No announcement content was provided."}
                    </p>

                    <div className="registrar-announcements__meta-grid">
                      <div className="registrar-announcements__meta-item">
                        <UserRound size={15} />
                        <div>
                          <span>Created By</span>
                          <strong>{item.created_by || "Unknown"}</strong>
                        </div>
                      </div>

                      <div className="registrar-announcements__meta-item">
                        <CalendarDays size={15} />
                        <div>
                          <span>Publish Date</span>
                          <strong>{formatDate(item.publish_date)}</strong>
                        </div>
                      </div>

                      {item.expiry_date && (
                        <div className="registrar-announcements__meta-item registrar-announcements__meta-item--wide">
                          <CalendarDays size={15} />
                          <div>
                            <span>Expiry Date</span>
                            <strong>{formatDate(item.expiry_date)}</strong>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="registrar-announcements__recipients">
                      <div className="registrar-announcements__recipients-label">
                        <UsersRound size={14} />
                        <span>Recipients</span>
                      </div>

                      <div className="registrar-announcements__recipient-list">
                        {visibleRecipients.length > 0 ? (
                          <>
                            {visibleRecipients.map((recipient) => (
                              <span
                                className="registrar-announcements__recipient-chip"
                                key={`${item.announcement_id}-${recipient}`}
                              >
                                {recipient}
                              </span>
                            ))}
                            {hiddenRecipientCount > 0 && (
                              <span className="registrar-announcements__recipient-chip registrar-announcements__recipient-chip--more">
                                +{hiddenRecipientCount}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="registrar-announcements__recipient-chip registrar-announcements__recipient-chip--muted">
                            Not specified
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="registrar-announcements__card-actions">
                      <button
                        type="button"
                        className="registrar-announcements__action-button registrar-announcements__action-button--primary"
                        onClick={() =>
                          navigate(
                            `/registrar/announcement/DetailR/${item.announcement_id}`,
                          )
                        }
                      >
                        <Eye size={15} />
                        View Details
                        <ChevronRight size={14} />
                      </button>

                      <button
                        type="button"
                        className="registrar-announcements__action-button"
                        onClick={() =>
                          navigate(
                            `/registrar/announcement/editR/${item.announcement_id}`,
                          )
                        }
                      >
                        <Pencil size={15} />
                        Edit
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </DashboardLayout>
  );
}
