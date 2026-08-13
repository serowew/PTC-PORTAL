import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import "../../../styles/activitylogger.css";

type ActivityLog = {
  activity_id: number;
  user_id: number;
  username: string;
  role: string;
  activity_type: string;
  module_name: string;
  description: string;
  created_at: string;
};
const API_BASE_URL = "http://localhost:3000/api/activity-logs";

export default function UserActivity() {
  const navigate = useNavigate();
  const session = authService.getSession();

  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!session || session.role !== "Admin") {
      navigate("/login");
      return;
    }

    loadLogs();
  }, []);

  async function loadLogs() {
    try {
      setLoading(true);

      const response = await fetch(API_BASE_URL);

      if (!response.ok) {
        throw new Error("Unable to load activity logs.");
      }

      const data = await response.json();

      setLogs(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const filteredLogs = logs.filter((log) => {
    const q = search.toLowerCase();

    return (
      log.username.toLowerCase().includes(q) ||
      log.role.toLowerCase().includes(q) ||
      log.activity_type.toLowerCase().includes(q) ||
      log.module_name.toLowerCase().includes(q) ||
      log.description.toLowerCase().includes(q)
    );
  });

  return (
    <DashboardLayout>
      <div className="admin-activity">
        <div className="admin-activity-header">
          <h1>User Activity Logs</h1>
        </div>

        <input
          type="text"
          placeholder="Search activity..."
          className="activity-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="activity-table-wrapper">
          <table className="activity-table">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>User</th>
                <th>Role</th>
                <th>Activity</th>
                <th>Module</th>
                <th>Description</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center" }}>
                    Loading activity logs...
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center" }}>
                    No activity found.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.activity_id}>
                    <td>{new Date(log.created_at).toLocaleString()}</td>

                    <td>{log.username}</td>

                    <td>{log.role}</td>

                    <td>
                      <span
                        className={`activity-badge ${log.activity_type
                          .toLowerCase()
                          .replace(/\s+/g, "-")}`}
                      >
                        {log.activity_type}
                      </span>
                    </td>

                    <td>{log.module_name}</td>

                    <td>{log.description}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
