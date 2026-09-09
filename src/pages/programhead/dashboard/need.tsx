import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
  Megaphone,
  Monitor,
  Route,
  ShieldCheck,
  UserCheck,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";

import "../../../styles/ProgramHeadQuickActions.css";

type ToolKey =
  | "faculty-evaluation"
  | "curriculum-management"
  | "class-monitoring"
  | "student-performance"
  | "reports";

interface ToolLink {
  label: string;
  description: string;
  path: string;
  icon: LucideIcon;
  primary?: boolean;
}

interface ToolConfig {
  title: string;
  eyebrow: string;
  description: string;
  status: string;
  icon: LucideIcon;
  overview: string;
  focus: Array<{
    title: string;
    description: string;
  }>;
  workflow: Array<{
    step: string;
    title: string;
    description: string;
  }>;
  links: ToolLink[];
}

const TOOL_CONFIG: Record<ToolKey, ToolConfig> = {
  "faculty-evaluation": {
    title: "Faculty Evaluation",
    eyebrow: "Faculty Oversight",
    description:
      "Organize faculty review work, identify the evidence that should be checked, and continue to related Program Head modules.",
    status: "Guidance workspace",
    icon: UserCheck,
    overview:
      "The current Program Head structure does not yet contain a dedicated Faculty Evaluation page. This workspace keeps the flow usable without inventing evaluation records or scores. Use it to prepare the review process and continue to the class, schedule, or grade areas that provide supporting academic evidence.",
    focus: [
      {
        title: "Evaluation coverage",
        description:
          "Confirm which faculty members, classes, and academic period are included before reviewing performance.",
      },
      {
        title: "Teaching and class evidence",
        description:
          "Use class assignments and verified schedules to understand the teaching load being reviewed.",
      },
      {
        title: "Academic responsibilities",
        description:
          "Check grade-submission responsibilities and returned or pending work that may require follow-up.",
      },
      {
        title: "Documented follow-up",
        description:
          "Record concerns, recognition, support needs, or coordination items consistently before formal action is introduced.",
      },
    ],
    workflow: [
      {
        step: "01",
        title: "Set the review scope",
        description: "Identify the faculty member, classes, and evaluation period.",
      },
      {
        step: "02",
        title: "Verify academic assignments",
        description: "Check classes and schedules before interpreting performance.",
      },
      {
        step: "03",
        title: "Review responsibilities",
        description: "Use grade and class activity as supporting operational evidence.",
      },
      {
        step: "04",
        title: "Prepare follow-up",
        description: "Document what should be discussed or acted on next.",
      },
    ],
    links: [
      {
        label: "Open Class Management",
        description: "Review Program Head classes and faculty assignments.",
        path: "/programhead/classes",
        icon: Monitor,
        primary: true,
      },
      {
        label: "Schedule Verification",
        description: "Check class schedules and possible conflicts.",
        path: "/programhead/schedule-verification",
        icon: CalendarCheck2,
      },
      {
        label: "Grade Approval",
        description: "Review faculty grade submissions awaiting Program Head action.",
        path: "/programhead/gradeapproval/pending",
        icon: ClipboardCheck,
      },
    ],
  },

  "curriculum-management": {
    title: "Curriculum Management",
    eyebrow: "Program Review",
    description:
      "Review curriculum impact from the Program Head perspective and coordinate academic concerns with the Registrar.",
    status: "Review and coordination",
    icon: BookOpen,
    overview:
      "Your current portal places curriculum configuration under Registrar. The Program Head should therefore use this area to review program structure, subject sequencing, implementation concerns, and schedule impact—not to duplicate Registrar create/edit curriculum controls.",
    focus: [
      {
        title: "Subject sequence",
        description:
          "Review whether subject order and semester placement support the intended program progression.",
      },
      {
        title: "Prerequisite impact",
        description:
          "Identify prerequisite chains that may affect progression, retakes, or future enrollment.",
      },
      {
        title: "Program delivery",
        description:
          "Check whether available sections and schedules can realistically deliver the active curriculum.",
      },
      {
        title: "Registrar coordination",
        description:
          "Document curriculum issues that require official configuration changes by the Registrar.",
      },
    ],
    workflow: [
      {
        step: "01",
        title: "Review active structure",
        description: "Examine subjects, year levels, semesters, units, and prerequisites.",
      },
      {
        step: "02",
        title: "Check delivery impact",
        description: "Compare curriculum needs with available classes and schedules.",
      },
      {
        step: "03",
        title: "Identify concerns",
        description: "Document gaps, sequencing issues, or implementation problems.",
      },
      {
        step: "04",
        title: "Coordinate changes",
        description: "Send official curriculum configuration concerns to the Registrar.",
      },
    ],
    links: [
      {
        label: "Schedule Verification",
        description: "Review how the academic structure is being scheduled.",
        path: "/programhead/schedule-verification",
        icon: CalendarCheck2,
        primary: true,
      },
      {
        label: "Class Management",
        description: "Check sections and faculty assignments supporting the program.",
        path: "/programhead/classes",
        icon: Monitor,
      },
      {
        label: "Announcements",
        description: "Review academic notices that may affect program delivery.",
        path: "/programhead/announcementprog",
        icon: Megaphone,
      },
    ],
  },

  "class-monitoring": {
    title: "Class Monitoring",
    eyebrow: "Academic Operations",
    description:
      "Monitor Program Head classes, faculty coverage, schedules, and operational issues that may need coordination.",
    status: "Connected module available",
    icon: Monitor,
    overview:
      "Class Monitoring has an existing Program Head page in your project. This workspace acts as the dashboard entry point: review what should be checked here, then open Class Management for the actual class-level records.",
    focus: [
      {
        title: "Section coverage",
        description:
          "Confirm active sections have the expected subject offerings and instructional coverage.",
      },
      {
        title: "Faculty assignments",
        description:
          "Review who is assigned to each class and identify missing or unusual assignments.",
      },
      {
        title: "Schedule conflicts",
        description:
          "Use Schedule Verification to identify overlapping or incomplete schedules.",
      },
      {
        title: "Academic follow-up",
        description:
          "Coordinate classes with pending grade responsibilities or other academic concerns.",
      },
    ],
    workflow: [
      {
        step: "01",
        title: "Open class records",
        description: "Start with the Program Head Class Management module.",
      },
      {
        step: "02",
        title: "Verify assignments",
        description: "Check section, subject, and faculty coverage.",
      },
      {
        step: "03",
        title: "Verify schedules",
        description: "Review schedule completeness and conflicts.",
      },
      {
        step: "04",
        title: "Coordinate issues",
        description: "Follow up on staffing, schedule, or grade-related concerns.",
      },
    ],
    links: [
      {
        label: "Open Class Management",
        description: "Continue to the existing ClassPROG module.",
        path: "/programhead/classes",
        icon: Monitor,
        primary: true,
      },
      {
        label: "Schedule Verification",
        description: "Verify class schedules and possible conflicts.",
        path: "/programhead/schedule-verification",
        icon: CalendarCheck2,
      },
      {
        label: "Grade Approval",
        description: "Check grade submissions connected to active classes.",
        path: "/programhead/gradeapproval/pending",
        icon: ClipboardCheck,
      },
    ],
  },

  "student-performance": {
    title: "Student Performance",
    eyebrow: "Academic Progress",
    description:
      "Use approved academic results to identify trends, concerns, and areas that may require Program Head follow-up.",
    status: "Guidance workspace",
    icon: BarChart3,
    overview:
      "The current Program Head folder does not contain a dedicated Student Performance page. This workspace therefore defines the correct review flow without displaying invented student metrics. Performance analysis should be based on real approved grades and official academic records once a dedicated endpoint or page is connected.",
    focus: [
      {
        title: "Approved results",
        description:
          "Base performance review on approved grades rather than draft or unreviewed faculty entries.",
      },
      {
        title: "At-risk outcomes",
        description:
          "Watch for failed and incomplete results that may require academic intervention or retake planning.",
      },
      {
        title: "Section patterns",
        description:
          "Look for repeated performance issues within a subject, class, or section before drawing conclusions.",
      },
      {
        title: "Coordinated support",
        description:
          "Use findings to guide faculty coordination and appropriate student academic follow-up.",
      },
    ],
    workflow: [
      {
        step: "01",
        title: "Confirm grade status",
        description: "Use Program Head-approved academic results as the reliable basis.",
      },
      {
        step: "02",
        title: "Identify patterns",
        description: "Review failed, incomplete, or unusual subject-level outcomes.",
      },
      {
        step: "03",
        title: "Check class context",
        description: "Compare findings with the relevant classes and faculty assignments.",
      },
      {
        step: "04",
        title: "Prepare intervention",
        description: "Coordinate academic support or follow-up using documented evidence.",
      },
    ],
    links: [
      {
        label: "Grade Approval",
        description: "Review and finalize submitted grades first.",
        path: "/programhead/gradeapproval/pending",
        icon: ClipboardCheck,
        primary: true,
      },
      {
        label: "Class Management",
        description: "Review the class context behind academic results.",
        path: "/programhead/classes",
        icon: Monitor,
      },
      {
        label: "Program Reports",
        description: "Continue to the existing reports area for formal output.",
        path: "/programhead/reports",
        icon: FileText,
      },
    ],
  },

  reports: {
    title: "Generate Reports",
    eyebrow: "Program Reporting",
    description:
      "Prepare Program Head reporting by confirming the scope, source records, and academic period before opening the reports module.",
    status: "Connected module available",
    icon: FileText,
    overview:
      "Your project already contains a ProgramReports/Reports.tsx page. This workspace gives the Program Head a clear pre-report checklist and then routes directly into that existing module.",
    focus: [
      {
        title: "Report purpose",
        description:
          "Identify whether the request concerns classes, grades, faculty assignments, schedules, or program activity.",
      },
      {
        title: "Academic period",
        description:
          "Confirm the academic year and semester before generating or interpreting report information.",
      },
      {
        title: "Source quality",
        description:
          "Use official or approved data whenever the report is intended for formal review.",
      },
      {
        title: "Audience and scope",
        description:
          "Limit report content to the intended department, program, class, or academic purpose.",
      },
    ],
    workflow: [
      {
        step: "01",
        title: "Choose report scope",
        description: "Define the program area and question the report should answer.",
      },
      {
        step: "02",
        title: "Confirm period",
        description: "Select the correct academic year and semester.",
      },
      {
        step: "03",
        title: "Validate sources",
        description: "Check that the underlying class or grade data is ready.",
      },
      {
        step: "04",
        title: "Open reports",
        description: "Continue to the existing Program Reports module.",
      },
    ],
    links: [
      {
        label: "Open Program Reports",
        description: "Continue to the existing Reports.tsx module.",
        path: "/programhead/reports",
        icon: FileText,
        primary: true,
      },
      {
        label: "Class Management",
        description: "Review class records before producing class-based reports.",
        path: "/programhead/classes",
        icon: Monitor,
      },
      {
        label: "Grade Approval",
        description: "Confirm grades are approved before official grade reporting.",
        path: "/programhead/gradeapproval/pending",
        icon: ClipboardCheck,
      },
    ],
  },
};

const isToolKey = (value: string | undefined): value is ToolKey =>
  Boolean(value && value in TOOL_CONFIG);

export default function ProgramHeadQuickActionPage() {
  const navigate = useNavigate();
  const { tool } = useParams<{ tool: string }>();

  const [user] = useState(() => authService.getSession());

  useEffect(() => {
    if (!user || user.role !== "Program Head") {
      navigate("/login", { replace: true });
    }
  }, [navigate, user]);

  const config = useMemo(() => {
    if (!isToolKey(tool)) {
      return null;
    }

    return TOOL_CONFIG[tool];
  }, [tool]);

  if (!user || user.role !== "Program Head") {
    return null;
  }

  if (!config) {
    return (
      <DashboardLayout>
        <main className="programhead-tool-page">
          <section className="programhead-tool-page__not-found">
            <span className="programhead-tool-page__not-found-icon">
              <Route size={22} />
            </span>

            <h1>Quick Action Not Found</h1>

            <p>
              The requested Program Head dashboard action is not registered in
              this workspace.
            </p>

            <button
              type="button"
              onClick={() => navigate("/programhead/dashboard")}
            >
              <ArrowLeft size={16} />
              Back to Dashboard
            </button>
          </section>
        </main>
      </DashboardLayout>
    );
  }

  const ToolIcon = config.icon;

  return (
    <DashboardLayout>
      <main className="programhead-tool-page">
        {/* =====================================================
            HERO
        ===================================================== */}
        <header className="programhead-tool-page__hero">
          <div className="programhead-tool-page__hero-copy">
            <div className="programhead-tool-page__eyebrow">
              <span className="programhead-tool-page__eyebrow-icon">
                <ToolIcon size={16} />
              </span>

              Program Head · {config.eyebrow}
            </div>

            <h1>{config.title}</h1>

            <p>{config.description}</p>
          </div>

          <div className="programhead-tool-page__hero-actions">
            <span className="programhead-tool-page__status">
              <ShieldCheck size={15} />
              {config.status}
            </span>

            <button
              type="button"
              className="programhead-tool-page__back"
              onClick={() => navigate("/programhead/dashboard")}
            >
              <ArrowLeft size={15} />
              Dashboard
            </button>
          </div>
        </header>

        {/* =====================================================
            OVERVIEW
        ===================================================== */}
        <section className="programhead-tool-page__overview">
          <span className="programhead-tool-page__overview-icon">
            <GraduationCap size={20} />
          </span>

          <div>
            <span>How this area fits the Program Head flow</span>
            <p>{config.overview}</p>
          </div>
        </section>

        {/* =====================================================
            FOCUS AREAS
        ===================================================== */}
        <section className="programhead-tool-page__panel">
          <div className="programhead-tool-page__section-header">
            <div>
              <span className="programhead-tool-page__section-kicker">
                <LayoutDashboard size={13} />
                Review Scope
              </span>

              <h2>What to Check</h2>

              <p>
                Use these checkpoints before continuing to the related portal
                modules.
              </p>
            </div>
          </div>

          <div className="programhead-tool-page__focus-grid">
            {config.focus.map((item, index) => (
              <article
                key={item.title}
                className="programhead-tool-page__focus-item"
              >
                <span>{String(index + 1).padStart(2, "0")}</span>

                <div>
                  <strong>{item.title}</strong>
                  <p>{item.description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* =====================================================
            WORKFLOW + DESTINATIONS
        ===================================================== */}
        <div className="programhead-tool-page__lower-grid">
          <section className="programhead-tool-page__panel">
            <div className="programhead-tool-page__section-header">
              <div>
                <span className="programhead-tool-page__section-kicker">
                  <CheckCircle2 size={13} />
                  Recommended Flow
                </span>

                <h2>Suggested Review Sequence</h2>
              </div>
            </div>

            <div className="programhead-tool-page__workflow">
              {config.workflow.map((item) => (
                <article
                  key={item.step}
                  className="programhead-tool-page__workflow-item"
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

          <aside className="programhead-tool-page__destinations">
            <div className="programhead-tool-page__section-header">
              <div>
                <span className="programhead-tool-page__section-kicker">
                  <Route size={13} />
                  Navigation
                </span>

                <h2>Continue in the Portal</h2>

                <p>Open the related Program Head modules that already exist.</p>
              </div>
            </div>

            <div className="programhead-tool-page__link-list">
              {config.links.map((link) => {
                const LinkIcon = link.icon;

                return (
                  <button
                    key={link.path}
                    type="button"
                    className={`programhead-tool-page__link ${
                      link.primary ? "programhead-tool-page__link--primary" : ""
                    }`}
                    onClick={() => navigate(link.path)}
                  >
                    <span className="programhead-tool-page__link-icon">
                      <LinkIcon size={18} />
                    </span>

                    <span className="programhead-tool-page__link-copy">
                      <strong>{link.label}</strong>
                      <small>{link.description}</small>
                    </span>

                    <ArrowRight
                      size={16}
                      className="programhead-tool-page__link-arrow"
                    />
                  </button>
                );
              })}
            </div>
          </aside>
        </div>

        {/* =====================================================
            SYSTEM FLOW
        ===================================================== */}
        <section className="programhead-tool-page__flow-strip">
          <div>
            <span>
              <UsersRound size={15} />
              Faculty / Classes
            </span>
          </div>

          <ArrowRight size={15} />

          <div>
            <span>
              <ClipboardCheck size={15} />
              Grade Review
            </span>
          </div>

          <ArrowRight size={15} />

          <div>
            <span>
              <GraduationCap size={15} />
              Academic Follow-up
            </span>
          </div>

          <ArrowRight size={15} />

          <div>
            <span>
              <FileText size={15} />
              Program Reporting
            </span>
          </div>
        </section>
      </main>
    </DashboardLayout>
  );
}