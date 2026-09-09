import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarCheck2,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Layers3,
  Monitor,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Users,
  UsersRound,
} from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/ProgramHeadDashboard.css";

type QuickTool =
  | "faculty-evaluation"
  | "curriculum-management"
  | "class-monitoring"
  | "student-performance"
  | "reports";

interface ToolInfoItem {
  title: string;
  description: string;
}

interface ToolWorkflowItem {
  step: string;
  title: string;
  description: string;
}

interface ToolConfig {
  title: string;
  eyebrow: string;
  description: string;
  icon: LucideIcon;
  purpose: string;
  reviewItems: ToolInfoItem[];
  workflow: ToolWorkflowItem[];
  reminder: string;
}

const TOOL_CONFIG: Record<QuickTool, ToolConfig> = {
  "faculty-evaluation": {
    title: "Faculty Evaluation",
    eyebrow: "Faculty Oversight",
    description:
      "Review faculty responsibilities, teaching assignments, academic follow-up, and areas that may require Program Head attention.",
    icon: UserCheck,
    purpose:
      "Faculty Evaluation helps the Program Head organize a fair and consistent review of faculty work. Before making conclusions, the review should consider teaching assignments, class responsibilities, grade-related duties, and documented follow-up.",
    reviewItems: [
      {
        title: "Teaching Assignment",
        description:
          "Confirm the faculty member's assigned subjects, sections, and academic period before reviewing performance.",
      },
      {
        title: "Class Delivery",
        description:
          "Review whether assigned classes are being handled consistently and whether teaching responsibilities are properly covered.",
      },
      {
        title: "Grade Responsibilities",
        description:
          "Check whether grade submissions, corrections, or returned grade work require follow-up.",
      },
      {
        title: "Professional Follow-up",
        description:
          "Document concerns, recognition, support needs, or items that should be discussed with the faculty member.",
      },
    ],
    workflow: [
      {
        step: "01",
        title: "Identify evaluation scope",
        description:
          "Determine the faculty member, assigned classes, and academic period included in the review.",
      },
      {
        step: "02",
        title: "Verify academic responsibilities",
        description:
          "Check class assignments and teaching responsibilities before evaluating performance.",
      },
      {
        step: "03",
        title: "Review supporting evidence",
        description:
          "Consider grade responsibilities, class-related concerns, and documented academic activity.",
      },
      {
        step: "04",
        title: "Prepare follow-up",
        description:
          "Record observations that can support consultation, recognition, or corrective action.",
      },
    ],
    reminder:
      "Keep faculty evaluation evidence-based. Avoid relying on a single class, complaint, or grade result when reviewing overall performance.",
  },

  "curriculum-management": {
    title: "Curriculum Management",
    eyebrow: "Program Review",
    description:
      "Review curriculum structure, subject sequencing, prerequisite impact, academic workload, and program-delivery concerns.",
    icon: BookOpen,
    purpose:
      "Curriculum Management helps the Program Head review whether the program structure supports correct academic progression. The focus is on subject sequence, prerequisite relationships, semester placement, workload, and implementation concerns.",
    reviewItems: [
      {
        title: "Subject Sequencing",
        description:
          "Check whether subjects are placed in the appropriate year level and semester for proper progression.",
      },
      {
        title: "Prerequisite Flow",
        description:
          "Review prerequisite relationships that may affect student eligibility, retakes, and future enrollment.",
      },
      {
        title: "Units and Workload",
        description:
          "Review whether the academic load is balanced across semesters and appropriate for the program.",
      },
      {
        title: "Program Delivery",
        description:
          "Identify curriculum requirements that may create section, faculty, or scheduling concerns.",
      },
    ],
    workflow: [
      {
        step: "01",
        title: "Review the active structure",
        description:
          "Check subjects, year levels, semesters, units, and prerequisite relationships.",
      },
      {
        step: "02",
        title: "Check progression",
        description:
          "Confirm that students can move through the curriculum in a logical academic sequence.",
      },
      {
        step: "03",
        title: "Identify implementation gaps",
        description:
          "Document sequencing, workload, staffing, or scheduling concerns.",
      },
      {
        step: "04",
        title: "Coordinate official changes",
        description:
          "Prepare curriculum concerns for coordination with the office responsible for official curriculum configuration.",
      },
    ],
    reminder:
      "Curriculum review should protect academic progression and prerequisite integrity. Changes should be coordinated before they affect enrollment or subject eligibility.",
  },

  "class-monitoring": {
    title: "Class Monitoring",
    eyebrow: "Academic Operations",
    description:
      "Monitor sections, faculty assignments, class coverage, schedules, and operational concerns that require coordination.",
    icon: Monitor,
    purpose:
      "Class Monitoring gives the Program Head a structured way to review whether active classes are properly covered and supported. It focuses on section coverage, faculty assignment, schedule completeness, and academic issues that may disrupt delivery.",
    reviewItems: [
      {
        title: "Section Coverage",
        description:
          "Confirm that active sections have the expected subjects and that no class is left without proper instructional coverage.",
      },
      {
        title: "Faculty Assignment",
        description:
          "Check whether each class has an assigned faculty member and whether the assignment matches the expected teaching responsibility.",
      },
      {
        title: "Schedule Completeness",
        description:
          "Review whether class schedules are complete, practical, and free from obvious conflicts.",
      },
      {
        title: "Academic Follow-up",
        description:
          "Identify classes with staffing, scheduling, grade, or operational concerns that may require Program Head action.",
      },
    ],
    workflow: [
      {
        step: "01",
        title: "Review active classes",
        description:
          "Start with the current sections and subjects handled under the program.",
      },
      {
        step: "02",
        title: "Verify faculty coverage",
        description:
          "Check whether faculty assignments are complete and appropriate.",
      },
      {
        step: "03",
        title: "Verify schedules",
        description:
          "Review schedule completeness and possible conflicts.",
      },
      {
        step: "04",
        title: "Coordinate issues",
        description:
          "Follow up on staffing, schedule, class-delivery, or grade-related concerns.",
      },
    ],
    reminder:
      "Class monitoring should focus on issues that can affect teaching continuity, student access to classes, and timely academic completion.",
  },

  "student-performance": {
    title: "Student Performance",
    eyebrow: "Academic Progress",
    description:
      "Review the academic information that can help identify student progress, at-risk outcomes, and areas needing intervention.",
    icon: BarChart3,
    purpose:
      "Student Performance review helps the Program Head recognize academic patterns and determine where support may be needed. Reliable review should be based on approved academic results and should consider subject, section, and class context.",
    reviewItems: [
      {
        title: "Approved Grade Results",
        description:
          "Use approved grades as the reliable basis for performance review instead of draft or unreviewed entries.",
      },
      {
        title: "Failed and Incomplete Outcomes",
        description:
          "Identify results that may require retake planning, academic intervention, or additional student support.",
      },
      {
        title: "Subject and Section Patterns",
        description:
          "Look for repeated performance concerns within a subject or section before making conclusions.",
      },
      {
        title: "Academic Support",
        description:
          "Use verified findings to guide faculty coordination, student consultation, or other appropriate interventions.",
      },
    ],
    workflow: [
      {
        step: "01",
        title: "Confirm grade status",
        description:
          "Make sure the academic results used for review have completed the appropriate approval process.",
      },
      {
        step: "02",
        title: "Identify concerns",
        description:
          "Review failed, incomplete, or unusual subject-level outcomes.",
      },
      {
        step: "03",
        title: "Check class context",
        description:
          "Compare results with subject, section, and faculty information before deciding on intervention.",
      },
      {
        step: "04",
        title: "Prepare support actions",
        description:
          "Document patterns that may require academic support, faculty coordination, or formal reporting.",
      },
    ],
    reminder:
      "Do not treat one grade as a complete picture of student performance. Review patterns and verified academic context before recommending intervention.",
  },

  reports: {
    title: "Generate Reports",
    eyebrow: "Program Reporting",
    description:
      "Prepare clear and reliable Program Head reports by defining the purpose, academic period, source information, and intended audience.",
    icon: FileText,
    purpose:
      "Generate Reports helps the Program Head organize information before producing formal summaries. A useful report should answer a specific question, use the correct academic period, rely on valid source records, and match the intended audience.",
    reviewItems: [
      {
        title: "Report Purpose",
        description:
          "Identify whether the report concerns grades, classes, faculty assignments, schedules, student progress, or overall program activity.",
      },
      {
        title: "Academic Period",
        description:
          "Confirm the correct academic year and semester so records from different periods are not mixed.",
      },
      {
        title: "Reliable Source Data",
        description:
          "Use approved or official records whenever the report will support formal academic decisions.",
      },
      {
        title: "Audience and Scope",
        description:
          "Limit the report to the intended program, section, class, faculty group, or academic purpose.",
      },
    ],
    workflow: [
      {
        step: "01",
        title: "Choose report purpose",
        description:
          "Define the question or academic activity the report should summarize.",
      },
      {
        step: "02",
        title: "Confirm scope and period",
        description:
          "Select the correct program scope, academic year, and semester.",
      },
      {
        step: "03",
        title: "Validate source information",
        description:
          "Check that the class, faculty, student, or grade information is ready for reporting.",
      },
      {
        step: "04",
        title: "Prepare the final report",
        description:
          "Organize the verified information into a clear report for the intended audience.",
      },
    ],
    reminder:
      "Reports used for official decisions should rely on verified data and clearly state their academic period and scope.",
  },
};

export default function ProgramHeadDashboard() {
  const navigate = useNavigate();

  const [user] = useState(() => authService.getSession());
  const [selectedTool, setSelectedTool] = useState<QuickTool | null>(null);

  useEffect(() => {
    if (!user || user.role !== "Program Head") {
      navigate("/login", { replace: true });
    }
  }, [navigate, user]);

  const selectedConfig = useMemo(() => {
    if (!selectedTool) {
      return null;
    }

    return TOOL_CONFIG[selectedTool];
  }, [selectedTool]);

  if (!user || user.role !== "Program Head") {
    return null;
  }

  const openTool = (tool: QuickTool) => {
    setSelectedTool(tool);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const closeTool = () => {
    setSelectedTool(null);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  if (selectedConfig) {
    const ToolIcon = selectedConfig.icon;

    return (
      <DashboardLayout>
        <main className="programhead-dashboard">
          {/* =====================================================
              QUICK ACTION DETAIL PAGE
          ===================================================== */}
          <header className="programhead-dashboard__tool-hero">
            <div className="programhead-dashboard__tool-hero-copy">
              <div className="programhead-dashboard__eyebrow">
                <span className="programhead-dashboard__eyebrow-icon">
                  <ToolIcon size={16} strokeWidth={2.2} />
                </span>

                Program Head · {selectedConfig.eyebrow}
              </div>

              <h1>{selectedConfig.title}</h1>

              <p>{selectedConfig.description}</p>
            </div>

            <button
              type="button"
              className="programhead-dashboard__tool-back"
              onClick={closeTool}
            >
              <ArrowLeft size={15} />
              Back to Quick Actions
            </button>
          </header>

          {/* =====================================================
              PURPOSE
          ===================================================== */}
          <section className="programhead-dashboard__tool-purpose">
            <span className="programhead-dashboard__tool-purpose-icon">
              <ShieldCheck size={19} />
            </span>

            <div>
              <span>Purpose</span>
              <p>{selectedConfig.purpose}</p>
            </div>
          </section>

          {/* =====================================================
              RELATED INFORMATION
          ===================================================== */}
          <section className="programhead-dashboard__tool-panel">
            <div className="programhead-dashboard__tool-panel-header">
              <div>
                <span className="programhead-dashboard__section-kicker">
                  <LayoutDashboard size={13} />
                  Related Information
                </span>

                <h2>What the Program Head Should Review</h2>

                <p>
                  These checkpoints are directly related to{" "}
                  {selectedConfig.title}.
                </p>
              </div>
            </div>

            <div className="programhead-dashboard__tool-info-grid">
              {selectedConfig.reviewItems.map((item, index) => (
                <article
                  key={item.title}
                  className="programhead-dashboard__tool-info-item"
                >
                  <span className="programhead-dashboard__tool-info-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>

                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* =====================================================
              WORKFLOW
          ===================================================== */}
          <section className="programhead-dashboard__tool-panel">
            <div className="programhead-dashboard__tool-panel-header">
              <div>
                <span className="programhead-dashboard__section-kicker">
                  <CheckCircle2 size={13} />
                  Recommended Flow
                </span>

                <h2>Suggested Review Sequence</h2>

                <p>
                  A practical sequence the Program Head can follow for this
                  area.
                </p>
              </div>
            </div>

            <div className="programhead-dashboard__tool-workflow">
              {selectedConfig.workflow.map((item) => (
                <article
                  key={item.step}
                  className="programhead-dashboard__tool-workflow-item"
                >
                  <span>{item.step}</span>

                  <div>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* =====================================================
              REMINDER
          ===================================================== */}
          <section className="programhead-dashboard__tool-reminder">
            <span className="programhead-dashboard__tool-reminder-icon">
              <TrendingUp size={17} />
            </span>

            <div>
              <strong>Program Head Reminder</strong>
              <p>{selectedConfig.reminder}</p>
            </div>
          </section>

          {/* =====================================================
              PROGRAM HEAD ACADEMIC FLOW
          ===================================================== */}
          <section className="programhead-dashboard__tool-flow">
            <div>
              <UsersRound size={15} />
              <span>Faculty &amp; Classes</span>
            </div>

            <ArrowRight size={15} />

            <div>
              <ClipboardCheck size={15} />
              <span>Academic Review</span>
            </div>

            <ArrowRight size={15} />

            <div>
              <GraduationCap size={15} />
              <span>Student Follow-up</span>
            </div>

            <ArrowRight size={15} />

            <div>
              <FileText size={15} />
              <span>Program Reporting</span>
            </div>
          </section>
        </main>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <main className="programhead-dashboard">
        {/* =====================================================
            HERO
        ===================================================== */}
        <header className="programhead-dashboard__hero">
          <div className="programhead-dashboard__hero-copy">
            <div className="programhead-dashboard__eyebrow">
              <span className="programhead-dashboard__eyebrow-icon">
                <LayoutDashboard size={16} strokeWidth={2.2} />
              </span>

              Program Head · Dashboard
            </div>

            <h1>Program Head Dashboard</h1>

            <p>
              Welcome back, <strong>{user.username}</strong>. Review academic
              activity, monitor faculty and students, and manage your program
              from one workspace.
            </p>
          </div>

          <div className="programhead-dashboard__hero-badge">
            <span className="programhead-dashboard__hero-badge-icon">
              <GraduationCap size={19} />
            </span>

            <div>
              <small>Current Workspace</small>
              <strong>Program Management</strong>
            </div>
          </div>
        </header>

        {/* =====================================================
            DASHBOARD SUMMARY
        ===================================================== */}
        <section
          className="programhead-dashboard__summary"
          aria-label="Program Head overview"
        >
          <article className="programhead-dashboard__stat-card">
            <span className="programhead-dashboard__stat-icon programhead-dashboard__stat-icon--primary">
              <ClipboardCheck />
            </span>

            <div className="programhead-dashboard__stat-content">
              <span className="programhead-dashboard__stat-label">
                Pending Grade Approvals
              </span>

              <strong className="programhead-dashboard__stat-number">12</strong>

              <small>Faculty submissions awaiting approval</small>
            </div>
          </article>

          <article className="programhead-dashboard__stat-card">
            <span className="programhead-dashboard__stat-icon">
              <Users />
            </span>

            <div className="programhead-dashboard__stat-content">
              <span className="programhead-dashboard__stat-label">
                Faculty Members
              </span>

              <strong className="programhead-dashboard__stat-number">25</strong>

              <small>Assigned faculty under your department</small>
            </div>
          </article>

          <article className="programhead-dashboard__stat-card">
            <span className="programhead-dashboard__stat-icon">
              <GraduationCap />
            </span>

            <div className="programhead-dashboard__stat-content">
              <span className="programhead-dashboard__stat-label">Students</span>

              <strong className="programhead-dashboard__stat-number">842</strong>

              <small>Currently enrolled students</small>
            </div>
          </article>

          <article className="programhead-dashboard__stat-card">
            <span className="programhead-dashboard__stat-icon">
              <Layers3 />
            </span>

            <div className="programhead-dashboard__stat-content">
              <span className="programhead-dashboard__stat-label">
                Active Sections
              </span>

              <strong className="programhead-dashboard__stat-number">31</strong>

              <small>Sections handled this semester</small>
            </div>
          </article>
        </section>

        {/* =====================================================
            QUICK ACTIONS
        ===================================================== */}
        <section className="programhead-dashboard__workspace">
          <div className="programhead-dashboard__section-header">
            <div>
              <span className="programhead-dashboard__section-kicker">
                <LayoutDashboard size={14} />
                Workspace
              </span>

              <h2>Quick Actions</h2>

              <p>
                Access the most frequently used Program Head management tools.
              </p>
            </div>
          </div>

          <div className="programhead-dashboard__action-grid">
            {/* Grade Approval */}
            <button
              type="button"
              className="programhead-dashboard__action-card programhead-dashboard__action-card--featured"
              onClick={() => navigate("/programhead/gradeapproval/pending")}
            >
              <span className="programhead-dashboard__action-icon">
                <ClipboardCheck />
              </span>

              <span className="programhead-dashboard__action-copy">
                <strong>Grade Approval</strong>
                <small>Review and approve faculty grade submissions.</small>
              </span>

              <span className="programhead-dashboard__action-arrow">
                <ArrowRight size={18} />
              </span>
            </button>

            {/* Faculty Evaluation */}
            <button
              type="button"
              className="programhead-dashboard__action-card"
              onClick={() => openTool("faculty-evaluation")}
            >
              <span className="programhead-dashboard__action-icon">
                <UserCheck />
              </span>

              <span className="programhead-dashboard__action-copy">
                <strong>Faculty Evaluation</strong>
                <small>Review faculty performance and evaluation workflow.</small>
              </span>

              <span className="programhead-dashboard__action-arrow">
                <ArrowRight size={18} />
              </span>
            </button>

            {/* Curriculum Management */}
            <button
              type="button"
              className="programhead-dashboard__action-card"
              onClick={() => openTool("curriculum-management")}
            >
              <span className="programhead-dashboard__action-icon">
                <BookOpen />
              </span>

              <span className="programhead-dashboard__action-copy">
                <strong>Curriculum Management</strong>
                <small>Review program structure and curriculum coordination.</small>
              </span>

              <span className="programhead-dashboard__action-arrow">
                <ArrowRight size={18} />
              </span>
            </button>

            {/* Class Monitoring */}
            <button
              type="button"
              className="programhead-dashboard__action-card"
              onClick={() => openTool("class-monitoring")}
            >
              <span className="programhead-dashboard__action-icon">
                <Monitor />
              </span>

              <span className="programhead-dashboard__action-copy">
                <strong>Class Monitoring</strong>
                <small>Monitor sections, schedules, and faculty assignments.</small>
              </span>

              <span className="programhead-dashboard__action-arrow">
                <ArrowRight size={18} />
              </span>
            </button>

            {/* Student Performance */}
            <button
              type="button"
              className="programhead-dashboard__action-card"
              onClick={() => openTool("student-performance")}
            >
              <span className="programhead-dashboard__action-icon">
                <BarChart3 />
              </span>

              <span className="programhead-dashboard__action-copy">
                <strong>Student Performance</strong>
                <small>Review academic progress and performance follow-up.</small>
              </span>

              <span className="programhead-dashboard__action-arrow">
                <ArrowRight size={18} />
              </span>
            </button>

            {/* Reports */}
            <button
              type="button"
              className="programhead-dashboard__action-card"
              onClick={() => openTool("reports")}
            >
              <span className="programhead-dashboard__action-icon">
                <FileText />
              </span>

              <span className="programhead-dashboard__action-copy">
                <strong>Generate Reports</strong>
                <small>Prepare program, faculty, and student reports.</small>
              </span>

              <span className="programhead-dashboard__action-arrow">
                <ArrowRight size={18} />
              </span>
            </button>
          </div>
        </section>
      </main>
    </DashboardLayout>
  );
}
