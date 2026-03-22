import { Bell } from "lucide-react";
import { useState, useEffect } from "react";

export default function Notifications() {
  const [notifications, setNotifications] = useState([
    { id: 1, text: "New student registration pending approval", time: "2m ago", read: false },
    { id: 2, text: "Exam timetable updated for 2026 intake", time: "15m ago", read: false },
    { id: 3, text: "System backup completed successfully", time: "1h ago", read: true },
  ]);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulate fetching notifications from API
    const fetchNotifications = async () => {
      setLoading(true);
      // Mock API call delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      // In real app, fetch from /api/admin/notifications
      setLoading(false);
    };
    fetchNotifications();
  }, []);

  const markAsRead = (id: number) => {
    setNotifications(prev =>
      prev.map(notif => notif.id === id ? { ...notif, read: true } : notif)
    );
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  if (loading) {
    return (
      <div className="dashboard-card notifications-card">
        <div className="card-header">
          <h3>Notifications</h3>
          <Bell size={16} />
        </div>
        <p>Loading notifications...</p>
      </div>
    );
  }

  return (
    <div className="dashboard-card notifications-card">
      <div className="card-header">
        <h3>Notifications {unreadCount > 0 && <span className="unread-badge">{unreadCount}</span>}</h3>
        <Bell size={16} />
      </div>
      <ul>
        {notifications.map((item) => (
          <li key={item.id} className={item.read ? "read" : "unread"}>
            <span>{item.text}</span>
            <small>{item.time}</small>
            {!item.read && (
              <button onClick={() => markAsRead(item.id)} className="mark-read-btn">
                Mark Read
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
