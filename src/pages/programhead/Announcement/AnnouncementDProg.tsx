import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  BookOpenCheck,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  ExternalLink,
  FileText,
  GraduationCap,
  Megaphone,
  Paperclip,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";

import { authService } from "../../../services/auth.service";
import { API_BASE_URL } from "../../../services/api";

import "../../../styles/announcementStudent.css";

// =====================================================
// FILE BASE URL
// =====================================================

const FILE_BASE_URL = API_BASE_URL;

// =====================================================
// TYPES
// =====================================================

interface Attachment {
  file_id: number;
  original_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
}

interface Announcement {
  announcement_id: number;
  title: string;
  content: string;
  created_by: string;
  publish_date: string;
  expiry_date: string | null;
  attachments: Attachment[];
}

type AnnouncementCategory =
  | "Grades"
  | "Faculty"
  | "Enrollment"
  | "Academic"
  | "General";

function getAnnouncementCategory(
  announcement: Announcement,
): AnnouncementCategory {
  const value =
    `${announcement.title} ${announcement.content}`.toLowerCase();

  if (
    value.includes("grade") ||
    value.includes("grading") ||
    value.includes("prelim") ||
    value.includes("midterm") ||
    value.includes("final rating")
  ) {
    return "Grades";
  }

  if (
    value.includes("faculty") ||
    value.includes("instructor") ||
    value.includes("evaluation")
  ) {
    return "Faculty";
  }

  if (
    value.includes("enrollment") ||
    value.includes("registration") ||
    value.includes("admission")
  ) {
    return "Enrollment";
  }

  if (
    value.includes("academic") ||
    value.includes("semester") ||
    value.includes("curriculum") ||
    value.includes("schedule") ||
    value.includes("subject") ||
    value.includes("section") ||
    value.includes("class")
  ) {
    return "Academic";
  }

  return "General";
}

function isExpiringSoon(
  announcement: Announcement,
) {
  if (!announcement.expiry_date) {
    return false;
  }

  const date = new Date(
    announcement.expiry_date,
  );

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const difference =
    date.getTime() - Date.now();

  return (
    difference >= 0 &&
    difference <=
      7 * 24 * 60 * 60 * 1000
  );
}

function needsAttention(
  announcement: Announcement,
) {
  const value =
    `${announcement.title} ${announcement.content}`.toLowerCase();

  const keywords = [
    "urgent",
    "important",
    "deadline",
    "required",
    "submit",
    "submission",
    "approval",
    "grade",
    "faculty",
    "evaluation",
    "meeting",
    "enrollment",
    "registration",
    "reminder",
    "action required",
  ];

  return (
    isExpiringSoon(announcement) ||
    keywords.some((keyword) =>
      value.includes(keyword),
    )
  );
}

function getRecommendedAction(
  announcement: Announcement,
) {
  const category =
    getAnnouncementCategory(
      announcement,
    );

  if (isExpiringSoon(announcement)) {
    return "Review this notice promptly because its expiration date is approaching.";
  }

  switch (category) {
    case "Grades":
      return "Check pending faculty grade submissions and verify that department grade reviews are completed before the stated deadline.";

    case "Faculty":
      return "Review the notice and coordinate with affected faculty members under your department.";

    case "Enrollment":
      return "Check whether this notice affects student enrollment, sections, subject assignments, or department-level enrollment decisions.";

    case "Academic":
      return "Review possible effects on subjects, sections, schedules, curriculum, and other academic operations.";

    default:
      return "Review the announcement and determine whether department-level follow-up is required.";
  }
}

function formatDateTime(
  value: string | null,
) {
  if (!value) {
    return "Not specified";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not specified";
  }

  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size)) {
    return "";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(
      1,
    )} KB`;
  }

  return `${(
    size /
    (1024 * 1024)
  ).toFixed(1)} MB`;
}

function getCategoryIcon(
  category: AnnouncementCategory,
) {
  switch (category) {
    case "Grades":
      return <ClipboardCheck size={18} />;

    case "Faculty":
      return <UsersRound size={18} />;

    case "Enrollment":
      return <GraduationCap size={18} />;

    case "Academic":
      return <BookOpenCheck size={18} />;

    default:
      return <Megaphone size={18} />;
  }
}

export default function AnnouncementProgD() {
  const navigate = useNavigate();

  const { id } = useParams<{
    id: string;
  }>();

  const [user] = useState(() =>
    authService.getSession(),
  );

  const [token] = useState(() =>
    authService.getToken(),
  );

  const [
    announcement,
    setAnnouncement,
  ] = useState<Announcement | null>(
    null,
  );

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  // =====================================================
  // LOAD DETAIL
  // =====================================================

  // =====================================================
  // LOAD ANNOUNCEMENT
  // =====================================================

  useEffect(() => {
    const controller =
      new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");

        if (!user || !token) {
          authService.logout();
          navigate("/login", {
            replace: true,
          });
          return;
        }

        if (
          user.role !== "Program Head"
        ) {
          navigate("/login", {
            replace: true,
          });

          return;
        }

        if (!id) {
          throw new Error(
            "Announcement ID is missing.",
          );
        }

        const response = await authService.authFetch(
          `${API_BASE_URL}/api/announcements/${encodeURIComponent(
            id,
          )}`,
          {
            method: "GET",
            signal: controller.signal,
            headers: {
              Accept:
                "application/json",
            },
          },
        );

        const contentType =
          response.headers.get(
            "content-type",
          ) || "";

        if (
          !contentType.includes(
            "application/json",
          )
        ) {
          const text =
            await response.text();

          throw new Error(
            `Server returned a non-JSON response (${response.status}): ${text.slice(
              0,
              200,
            )}`,
          );
        }

        const data =
          await response.json();

        console.log(
          "PROGRAM HEAD DETAIL:",
          data,
        );

        if (response.status === 401) {
          authService.logout();
          navigate("/login", {
            replace: true,
          });
          return;
        }

        if (response.status === 403) {
          throw new Error(
            data.message ||
              data.error ||
              "This announcement is not available to your Program Head account.",
          );
        }

        if (!response.ok) {
          throw new Error(
            data.message ||
              data.error ||
              "Announcement not found.",
          );
        }

        const loadedAnnouncement =
          data.announcement ||
          data.data ||
          data;

        setAnnouncement({
          ...loadedAnnouncement,

          attachments: Array.isArray(
            loadedAnnouncement.attachments,
          )
            ? loadedAnnouncement.attachments
            : [],
        });
      } catch (err) {
        if (
          err instanceof DOMException &&
          err.name === "AbortError"
        ) {
          return;
        }

        console.error(
          "PROGRAM HEAD ANNOUNCEMENT DETAIL ERROR:",
          err,
        );

        setAnnouncement(null);

        setError(
          err instanceof Error
            ? err.message
            : "Something went wrong.",
        );
      } finally {
        if (
          !controller.signal.aborted
        ) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      controller.abort();
    };
  }, [id, user, token, navigate]);

  const category = useMemo(
    () =>
      announcement
        ? getAnnouncementCategory(
            announcement,
          )
        : "General",
    [announcement],
  );

  const attention = announcement
    ? needsAttention(announcement)
    : false;

  if (
    !user ||
    !token ||
    user.role !== "Program Head"
  ) {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="announcementD-student">
        {/* ===============================================
            HERO
        =============================================== */}

        <header className="programhead-detail-hero">
          <div>
            <div className="programhead-announcement-eyebrow">
              <span>
                <Megaphone size={16} />
              </span>

              Program Head · Announcements
            </div>

            <h1>
              Announcement Details
            </h1>

            {/* ======================================= */}
            {/* CREATED BY */}
            {/* ======================================= */}

            <p>
              Review the full notice,
              attachments, important dates,
              and recommended Program Head
              follow-up.
            </p>
          </div>

          <button
            type="button"
            className="back-button"
            onClick={() =>
              navigate(-1)
            }
          >
            <ArrowLeft size={15} />
            Announcements
          </button>
        </header>

        {/* ===============================================
            LOADING
        =============================================== */}

        {loading && (
          <section className="programhead-announcement-loading">
            <div className="programhead-announcement-spinner" />

            <div>
              <strong>
                Loading announcement
              </strong>

              <span>
                Retrieving announcement
                details...
              </span>
            </div>
          </section>
        )}

        {/* ===============================================
            ERROR
        =============================================== */}

        {!loading && error && (
          <section className="programhead-announcement-error">
            <AlertTriangle
              size={20}
            />

            <div>
              <strong>
                Announcement unavailable
              </strong>

              <p>{error}</p>
            </div>

            <button
              type="button"
              onClick={() =>
                navigate(-1)
              }
            >
              Go Back
            </button>
          </section>
        )}

        {/* ===============================================
            DETAILS — TWO CARDS ONLY
        =============================================== */}

        {!loading &&
          !error &&
          announcement && (
            <div className="programhead-announcement-detail-grid">
              {/* =========================================
                  CARD 1 — CONTENT
              ========================================= */}

              <article className="announcement-details-card">
                <div className="programhead-detail-heading">
                  <span
                    className={`programhead-detail-category category-${category.toLowerCase()}`}
                  >
                    {getCategoryIcon(
                      category,
                    )}

                    {category}
                  </span>

                  {attention && (
                    <span className="programhead-detail-attention">
                      <BellRing
                        size={12}
                      />

                      Needs Attention
                    </span>
                  )}
                </div>

                <h1>
                  {announcement.title}
                </h1>

                <div className="announcement-meta">
                  <span>
                    <UserRound
                      size={14}
                    />

                    Posted by{" "}
                    <strong>
                      {announcement.created_by ||
                        "PTC Administration"}
                    </strong>
                  </span>

                  <span>
                    <CalendarDays
                      size={14}
                    />

                    Published{" "}
                    {formatDateTime(
                      announcement.publish_date,
                    )}
                  </span>
                </div>

                <div className="announcement-content">
                  {announcement.content}
                </div>

                {announcement.attachments
                  ?.length > 0 && (
                  <section className="programhead-detail-attachments">
                    <div className="programhead-detail-section-title">
                      <Paperclip
                        size={16}
                      />

                      <div>
                        <h3>
                          Attachments
                        </h3>

                        <p>
                          {
                            announcement
                              .attachments
                              .length
                          }{" "}
                          file
                          {announcement
                            .attachments
                            .length === 1
                            ? ""
                            : "s"}{" "}
                          included
                        </p>
                      </div>
                    </div>

                    <div className="attachment-list">
                      {announcement.attachments.map(
                        (file) => {
                          const normalizedPath =
                            file.file_path.replace(
                              /\\/g,
                              "/",
                            );

                          const attachmentUrl = `${FILE_BASE_URL}/${normalizedPath.replace(
                            /^\/+/,
                            "",
                          )}`;

                          return (
                            <a
                              key={
                                file.file_id
                              }
                              href={
                                attachmentUrl
                              }
                              target="_blank"
                              rel="noreferrer"
                              className="attachment-item"
                            >
                              <span className="attachment-file-icon">
                                <FileText
                                  size={
                                    17
                                  }
                                />
                              </span>

                              <div>
                                <strong>
                                  {
                                    file.original_name
                                  }
                                </strong>

                                <small>
                                  {formatFileSize(
                                    file.file_size,
                                  )}

                                  {file.mime_type
                                    ? ` · ${file.mime_type}`
                                    : ""}
                                </small>
                              </div>

                              <ExternalLink
                                size={14}
                              />
                            </a>
                          );
                        },
                      )}
                    </div>
                  </section>
                )}
              </article>

              {/* =========================================
                  CARD 2 — PROGRAM HEAD ACTION
              ========================================= */}

              <aside className="programhead-action-card">
                <div className="programhead-action-card-header">
                  <span>
                    <ShieldCheck
                      size={18}
                    />
                  </span>

                  <div>
                    <small>
                      Program Head
                    </small>

                    <h2>
                      Review Guidance
                    </h2>
                  </div>
                </div>

                <div
                  className={`programhead-action-status ${
                    attention
                      ? "attention"
                      : "normal"
                  }`}
                >
                  {attention ? (
                    <BellRing
                      size={16}
                    />
                  ) : (
                    <ShieldCheck
                      size={16}
                    />
                  )}

                  <div>
                    <strong>
                      {attention
                        ? "Follow-up recommended"
                        : "For your information"}
                    </strong>

                    <span>
                      {attention
                        ? "This notice may require department-level action."
                        : "No immediate Program Head action was detected."}
                    </span>
                  </div>
                </div>

                <section className="programhead-recommended-action">
                  <span>
                    Recommended Review
                  </span>

                  <p>
                    {getRecommendedAction(
                      announcement,
                    )}
                  </p>
                </section>

                <dl className="programhead-announcement-info">
                  <div>
                    <dt>
                      Category
                    </dt>

                    <dd>
                      {category}
                    </dd>
                  </div>

                  <div>
                    <dt>
                      Published
                    </dt>

                    <dd>
                      {formatDateTime(
                        announcement.publish_date,
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt>
                      Expires
                    </dt>

                    <dd>
                      {formatDateTime(
                        announcement.expiry_date,
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt>
                      Attachments
                    </dt>

                    <dd>
                      {
                        announcement
                          .attachments
                          .length
                      }
                    </dd>
                  </div>
                </dl>

                {isExpiringSoon(
                  announcement,
                ) && (
                  <div className="programhead-expiry-warning">
                    <CalendarClock
                      size={16}
                    />

                    <div>
                      <strong>
                        Expiring Soon
                      </strong>

                      <span>
                        This announcement
                        expires on{" "}
                        {formatDateTime(
                          announcement.expiry_date,
                        )}
                        .
                      </span>
                    </div>
                  </div>
                )}
              </aside>
            </div>
          )}
      </main>
    </DashboardLayout>
  );
}