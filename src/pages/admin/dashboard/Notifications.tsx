import { useState } from "react";
import {
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  Megaphone,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import {
  adminDashboardService,
  type AdminNotification,
} from "../../../services/adminDashboard.service";

// =====================================================
// PROPS
// =====================================================

interface DashboardNotificationsProps {
  notifications: AdminNotification[];

  onMarkedRead: (
    notificationId: number,
  ) => void;
}

// =====================================================
// DATE FORMATTER
// =====================================================

function formatNotificationDate(
  value: string,
) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(
    "en-PH",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
  ).format(date);
}

// =====================================================
// NOTIFICATION ICON
// =====================================================

function getNotificationIcon(
  type: AdminNotification["notification_type"],
) {
  switch (type) {
    case "Grades":
      return BookOpen;

    case "Finance":
      return WalletCards;

    case "Announcement":
      return Megaphone;

    case "System":
    default:
      return ShieldCheck;
  }
}

// =====================================================
// NOTIFICATION TONE
// =====================================================

function getNotificationTone(
  type: AdminNotification["notification_type"],
) {
  switch (type) {
    case "Grades":
      return "grades";

    case "Finance":
      return "finance";

    case "Announcement":
      return "announcement";

    case "System":
    default:
      return "system";
  }
}

// =====================================================
// DASHBOARD NOTIFICATIONS
// =====================================================

export default function Notifications({
  notifications,
  onMarkedRead,
}: DashboardNotificationsProps) {
  const [
    markingReadId,
    setMarkingReadId,
  ] = useState<number | null>(null);

  const [
    actionError,
    setActionError,
  ] = useState("");

  const unreadCount =
    notifications.filter(
      (notification) =>
        !notification.is_read,
    ).length;

  // ===================================================
  // MARK AS READ
  // ===================================================

  const handleMarkAsRead = async (
    notificationId: number,
  ) => {
    try {
      setMarkingReadId(
        notificationId,
      );

      setActionError("");

      await adminDashboardService.markNotificationAsRead(
        notificationId,
      );

      onMarkedRead(
        notificationId,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to mark notification as read.";

      setActionError(message);
    } finally {
      setMarkingReadId(null);
    }
  };

  // ===================================================
  // UI
  // ===================================================

  return (
    <div className="dashboard-card notifications-card">

      {/* HEADER */}

      <div className="card-header">
        <div>
          <div className="notification-heading">
            <h3>
              Notifications
            </h3>

            {unreadCount > 0 ? (
              <span className="unread-badge">
                {unreadCount}
              </span>
            ) : null}
          </div>

          <p className="card-subtitle">
            Your latest Admin account
            notifications.
          </p>
        </div>

        <Bell size={18} />
      </div>

      {/* ACTION ERROR */}

      {actionError ? (
        <div className="notification-action-error">
          {actionError}
        </div>
      ) : null}

      {/* EMPTY STATE */}

      {notifications.length === 0 ? (
        <div className="dashboard-empty-state">

          <div className="dashboard-empty-icon">
            <Bell size={22} />
          </div>

          <strong>
            You're all caught up
          </strong>

          <p>
            There are currently no
            Admin notifications to
            display.
          </p>

        </div>
      ) : (

        /* NOTIFICATION LIST */

        <ul className="notification-list">

          {notifications.map(
            (notification) => {
              const Icon =
                getNotificationIcon(
                  notification.notification_type,
                );

              const tone =
                getNotificationTone(
                  notification.notification_type,
                );

              const isRead =
                Boolean(
                  notification.is_read,
                );

              const isMarking =
                markingReadId ===
                notification.notification_id;

              return (
                <li
                  key={
                    notification.notification_id
                  }
                  className={
                    isRead
                      ? "notification-item read"
                      : "notification-item unread"
                  }
                >
                  <div
                    className={`notification-type-icon ${tone}`}
                  >
                    <Icon size={17} />
                  </div>

                  <div className="notification-content">

                    <div className="notification-title-row">

                      <strong>
                        {notification.title ||
                          "Notification"}
                      </strong>

                      <span
                        className={`notification-type-badge ${tone}`}
                      >
                        {
                          notification.notification_type
                        }
                      </span>

                    </div>

                    {notification.message ? (
                      <p>
                        {
                          notification.message
                        }
                      </p>
                    ) : null}

                    <div className="notification-footer">

                      <small>
                        {formatNotificationDate(
                          notification.created_at,
                        )}
                      </small>

                      {!isRead ? (
                        <button
                          type="button"
                          className="mark-read-btn"
                          disabled={
                            isMarking
                          }
                          onClick={() =>
                            void handleMarkAsRead(
                              notification.notification_id,
                            )
                          }
                        >
                          <Check size={13} />

                          <span>
                            {isMarking
                              ? "Updating..."
                              : "Mark as Read"}
                          </span>
                        </button>
                      ) : (
                        <span className="notification-read-label">
                          <CheckCircle2
                            size={13}
                          />

                          Read
                        </span>
                      )}

                    </div>

                  </div>
                </li>
              );
            },
          )}

        </ul>
      )}

    </div>
  );
}