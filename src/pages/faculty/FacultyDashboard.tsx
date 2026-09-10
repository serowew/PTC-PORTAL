import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileClock,
  GraduationCap,
  History,
  LayoutDashboard,
  Megaphone,
  NotebookPen,
  UserRound,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../components/Layout/DashboardLayout";
import { authService } from "../../services/auth.service";
import "../../styles/FacultyDashboard.css";

const primaryActions = [
  {
    title: "My Classes",
    description: "Open your assigned classes and manage your teaching workspace.",
    path: "/faculty/classes",
    icon: BookOpenCheck,
  },
  {
    title: "Class Schedule",
    description: "Review your teaching schedule and assigned class times.",
    path: "/faculty/classes/schedule",
    icon: CalendarDays,
  },
  {
    title: "Student List",
    description: "View the students enrolled in your assigned classes.",
    path: "/faculty/classes/students",
    icon: UsersRound,
  },
  {
    title: "Enter Grades",
    description: "Encode, review, and prepare student grades for submission.",
    path: "/faculty/grades/enter",
    icon: NotebookPen,
  },
];

const gradeActions = [
  {
    title: "Enter Grades",
    description: "Continue grade encoding for your assigned classes.",
    path: "/faculty/grades/enter",
    icon: NotebookPen,
  },
  {
    title: "Grade Summary",
    description: "Review the current grading status across your classes.",
    path: "/faculty/grades/summary",
    icon: ClipboardList,
  },
  {
    title: "Grade History",
    description: "Review previously submitted and processed grade records.",
    path: "/faculty/grades/history",
    icon: History,
  },
];

const workflowSteps = [
  {
    step: "01",
    title: "Open assigned classes",
    description: "Start from My Classes to review the subjects assigned to you.",
    icon: BookOpenCheck,
  },
  {
    step: "02",
    title: "Review class students",
    description: "Confirm the officially enrolled students in each class.",
    icon: UsersRound,
  },
  {
    step: "03",
    title: "Encode grades",
    description: "Record the required grading components for each student.",
    icon: NotebookPen,
  },
  {
    step: "04",
    title: "Review submission",
    description: "Check the grade summary before final submission and approval.",
    icon: CheckCircle2,
  },
];

export default function FacultyDashboard() {
  const navigate = useNavigate();
  const user = authService.getSession();

  useEffect(() => {
    if (!user || user.role !== "Faculty") {
      navigate("/login", { replace: true });
    }
  }, [navigate, user]);

  if (!user || user.role !== "Faculty") {
    return null;
  }

  return (
    <DashboardLayout>
      <main className="faculty-dashboard">
        <section className="faculty-dashboard__hero">
          <div className="faculty-dashboard__hero-copy">
            <div className="faculty-dashboard__eyebrow">
              <span className="faculty-dashboard__eyebrow-icon">
                <LayoutDashboard size={16} strokeWidth={2.2} />
              </span>
              Faculty · Dashboard
            </div>

            <h1>Welcome back, {user.username}</h1>
            <p>
              Manage your assigned classes, review student lists, and continue
              your grading workflow from one organized workspace.
            </p>
          </div>

          <div className="faculty-dashboard__identity">
            <span className="faculty-dashboard__identity-icon">
              <GraduationCap size={21} strokeWidth={2.1} />
            </span>

            <span className="faculty-dashboard__identity-copy">
              <small>Current workspace</small>
              <strong>Faculty</strong>
              <span>{user.username}</span>
            </span>
          </div>
        </section>

        <section
          className="faculty-dashboard__quick-grid"
          aria-label="Faculty quick access"
        >
          {primaryActions.map((action) => {
            const Icon = action.icon;

            return (
              <button
                key={action.path}
                type="button"
                className="faculty-dashboard__quick-card"
                onClick={() => navigate(action.path)}
              >
                <span className="faculty-dashboard__quick-icon">
                  <Icon size={20} strokeWidth={2.05} />
                </span>

                <span className="faculty-dashboard__quick-copy">
                  <strong>{action.title}</strong>
                  <small>{action.description}</small>
                </span>

                <ArrowRight
                  className="faculty-dashboard__quick-arrow"
                  size={17}
                  strokeWidth={2}
                />
              </button>
            );
          })}
        </section>

        <div className="faculty-dashboard__main-grid">
          <section className="faculty-dashboard__panel">
            <div className="faculty-dashboard__panel-header">
              <div>
                <span className="faculty-dashboard__section-kicker">
                  Teaching workflow
                </span>
                <h2>Class to grade submission</h2>
                <p>
                  Follow the normal Faculty workflow from assigned classes to
                  grade review.
                </p>
              </div>

              <button
                type="button"
                className="faculty-dashboard__text-action"
                onClick={() => navigate("/faculty/classes")}
              >
                Open classes
                <ArrowRight size={15} />
              </button>
            </div>

            <div className="faculty-dashboard__workflow">
              {workflowSteps.map((item) => {
                const Icon = item.icon;

                return (
                  <article
                    className="faculty-dashboard__workflow-item"
                    key={item.step}
                  >
                    <span className="faculty-dashboard__workflow-number">
                      {item.step}
                    </span>

                    <span className="faculty-dashboard__workflow-icon">
                      <Icon size={18} strokeWidth={2.05} />
                    </span>

                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <aside className="faculty-dashboard__panel faculty-dashboard__panel--compact">
            <div className="faculty-dashboard__panel-header">
              <div>
                <span className="faculty-dashboard__section-kicker">
                  Workspace
                </span>
                <h2>Faculty tools</h2>
                <p>Open your profile or read faculty announcements.</p>
              </div>
            </div>

            <div className="faculty-dashboard__workspace-actions">
              <button
                type="button"
                onClick={() => navigate("/faculty/profile")}
              >
                <span>
                  <UserRound size={18} strokeWidth={2.05} />
                </span>
                <div>
                  <strong>Faculty Profile</strong>
                  <small>Review your account and faculty information.</small>
                </div>
                <ArrowRight size={16} />
              </button>

              <button
                type="button"
                onClick={() => navigate("/faculty/announcementF")}
              >
                <span>
                  <Megaphone size={18} strokeWidth={2.05} />
                </span>
                <div>
                  <strong>Announcements</strong>
                  <small>Read active notices intended for faculty.</small>
                </div>
                <ArrowRight size={16} />
              </button>
            </div>

            <div className="faculty-dashboard__reminder">
              <span className="faculty-dashboard__reminder-icon">
                <FileClock size={18} strokeWidth={2.05} />
              </span>
              <div>
                <strong>Keep grade records current</strong>
                <p>
                  Review encoded grades before submission and use Grade Summary
                  to check their current status.
                </p>
              </div>
            </div>
          </aside>
        </div>

        <section className="faculty-dashboard__grades">
          <div className="faculty-dashboard__grades-header">
            <div>
              <span className="faculty-dashboard__section-kicker">
                Grade management
              </span>
              <h2>Continue your grading workflow</h2>
            </div>
          </div>

          <div className="faculty-dashboard__grade-grid">
            {gradeActions.map((action) => {
              const Icon = action.icon;

              return (
                <button
                  key={action.path}
                  type="button"
                  className="faculty-dashboard__grade-card"
                  onClick={() => navigate(action.path)}
                >
                  <span className="faculty-dashboard__grade-icon">
                    <Icon size={20} strokeWidth={2.05} />
                  </span>

                  <span className="faculty-dashboard__grade-copy">
                    <strong>{action.title}</strong>
                    <small>{action.description}</small>
                  </span>

                  <ArrowRight size={16} />
                </button>
              );
            })}
          </div>
        </section>
      </main>
    </DashboardLayout>
  );
}
