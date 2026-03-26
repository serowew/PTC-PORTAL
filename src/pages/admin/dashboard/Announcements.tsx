import { Megaphone } from "lucide-react";

export default function DashboardAnnouncements() {
  const announcements = [
    { id: 1, title: "Semester Break Extended", date: "2026-03-18" },
    { id: 2, title: "Admission Portal Open", date: "2026-03-15" },
    { id: 3, title: "New Exam Center Added", date: "2026-03-10" },
  ];

  return (
    <div className="dashboard-card announcements-card">
      <div className="card-header">
        <h3>Announcements</h3>
        <Megaphone size={16} />
      </div>
      <ul>
        {announcements.map((item) => (
          <li key={item.id}>
            <strong>{item.title}</strong>
            <small>{item.date}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
