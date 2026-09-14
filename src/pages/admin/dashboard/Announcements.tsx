import {
  ChevronRight,
  Megaphone,
} from "lucide-react";

import { useNavigate } from "react-router-dom";

import type {
  AdminRecentAnnouncement,
  AnnouncementStatus,
} from "../../../services/adminDashboard.service";

// =====================================================
// PROPS
// =====================================================

interface DashboardAnnouncementsProps {
  announcements: AdminRecentAnnouncement[];
}

// =====================================================
// DATE FORMATTER
// =====================================================

function formatAnnouncementDate(
  value: string | null,
) {
  if (!value) {
    return "No date";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat(
    "en-PH",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    },
  ).format(date);
}

// =====================================================
// STATUS CLASS
// =====================================================

function getStatusClass(
  status: AnnouncementStatus,
) {
  switch (status) {
    case "Active":
      return "active";

    case "Scheduled":
      return "scheduled";

    case "Expired":
      return "expired";

    case "Inactive":
      return "inactive";

    default:
      return "inactive";
  }
}

// =====================================================
// DASHBOARD ANNOUNCEMENTS
// =====================================================

export default function DashboardAnnouncements({
  announcements,
}: DashboardAnnouncementsProps) {
  const navigate = useNavigate();

  return (
    <div className="dashboard-card announcements-card">

      {/* HEADER */}

      <div className="card-header">
        <div>
          <h3>
            Latest Announcements
          </h3>

          <p className="card-subtitle">
            Recently created announcements
            across the portal.
          </p>
        </div>

        <button
          type="button"
          className="dashboard-text-button"
          onClick={() =>
            navigate(
              "/admin/announcement/list",
            )
          }
        >
          <span>
            View All
          </span>

          <ChevronRight
            size={15}
          />
        </button>
      </div>

      {/* EMPTY STATE */}

      {announcements.length === 0 ? (
        <div className="dashboard-empty-state">

          <div className="dashboard-empty-icon">
            <Megaphone
              size={22}
            />
          </div>

          <strong>
            No announcements yet
          </strong>

          <p>
            There are currently no
            announcements available to
            display.
          </p>

          <button
            type="button"
            className="action-btn"
            onClick={() =>
              navigate(
                "/admin/announcement/create",
              )
            }
          >
            <Megaphone
              size={15}
            />

            <span>
              Create Announcement
            </span>
          </button>

        </div>
      ) : (

        /* ANNOUNCEMENT LIST */

        <ul className="announcement-list">
          {announcements.map(
            (announcement) => (
              <li
                key={
                  announcement.announcement_id
                }
                className="announcement-item"
              >
                <button
                  type="button"
                  className="announcement-item-button"
                  onClick={() =>
                    navigate(
                      `/admin/announcement/details/${announcement.announcement_id}`,
                    )
                  }
                >
                  <div className="announcement-main">

                    <div className="announcement-title-row">

                      <strong className="announcement-title">
                        {
                          announcement.title
                        }
                      </strong>

                      <span
                        className={`announcement-status ${getStatusClass(
                          announcement.status,
                        )}`}
                      >
                        {
                          announcement.status
                        }
                      </span>

                    </div>

                    <p className="announcement-preview">
                      {
                        announcement.content
                      }
                    </p>

                    <div className="announcement-meta">

                      <span>
                        By{" "}
                        <strong>
                          {announcement.created_by ||
                            "Unknown user"}
                        </strong>
                      </span>

                      <span>
                        Published{" "}
                        {formatAnnouncementDate(
                          announcement.publish_date,
                        )}
                      </span>

                      {announcement.expiry_date ? (
                        <span>
                          Expires{" "}
                          {formatAnnouncementDate(
                            announcement.expiry_date,
                          )}
                        </span>
                      ) : (
                        <span>
                          No expiry
                        </span>
                      )}

                    </div>

                  </div>

                  <ChevronRight
                    className="announcement-chevron"
                    size={18}
                  />
                </button>
              </li>
            ),
          )}
        </ul>
      )}

    </div>
  );
}