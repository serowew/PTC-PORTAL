import {
  ArrowRight,
  BriefcaseBusiness,
  Code2,
  GraduationCap,
  Lightbulb,
  MonitorCog,
  School,
  UsersRound,
} from "lucide-react";

import classroomImage from "../../assets/classrooms.webp";
import "../../styles/ProgramsPage.css";

const programs = [
  {
    title: "Bachelor of Science in Information Technology",
    description:
      "A technology-focused program covering programming, databases, networking, web development, and information systems.",
    shortLabel: "Information Technology",
    icon: Code2,
  },
  {
    title: "Bachelor of Science in Business Administration",
    description:
      "A business program that develops knowledge and skills in management, marketing, finance, and entrepreneurship.",
    shortLabel: "Business Administration",
    icon: BriefcaseBusiness,
  },
  {
    title: "Teacher Education Programs",
    description:
      "Programs designed to develop future educators through professional knowledge, teaching skills, and practical experience.",
    shortLabel: "Teacher Education",
    icon: School,
  },
];

const focusAreas = [
  {
    title: "Practical Learning",
    description: "Build knowledge and skills through career-focused academic programs.",
    icon: Lightbulb,
  },
  {
    title: "Technology Ready",
    description: "Develop capabilities that support learning in modern academic and work environments.",
    icon: MonitorCog,
  },
  {
    title: "Student Development",
    description: "Grow through an academic environment centered on learning and preparation.",
    icon: UsersRound,
  },
];

export default function Programs() {
  return (
    <main className="ptc-programs-page">
      <section className="ptc-programs-hero">
        <div className="ptc-programs-hero__copy">
          <div className="ptc-programs-eyebrow">
            <span>
              <GraduationCap size={18} aria-hidden="true" />
            </span>
            Academic Programs
          </div>

          <h1>Choose a path for your future</h1>

          <p>
            Explore the programs offered through PTC and find an area that
            matches your interests, skills, and career goals.
          </p>

          <div className="ptc-programs-hero__meta" aria-label="Program page highlights">
            <span>
              <School size={15} aria-hidden="true" />
              PTC Academic Programs
            </span>
            <span>
              <Lightbulb size={15} aria-hidden="true" />
              Career-Focused Learning
            </span>
          </div>
        </div>

        <div className="ptc-programs-hero__visual">
          <img
            src={classroomImage}
            alt="PTC classroom learning environment"
          />

          <div className="ptc-programs-hero__visual-card">
            <span>
              <GraduationCap size={19} aria-hidden="true" />
            </span>
            <div>
              <small>Explore your options</small>
              <strong>Find the program that fits your goals</strong>
            </div>
          </div>
        </div>
      </section>

      <section
        className="ptc-programs-catalog"
        aria-labelledby="ptc-programs-catalog-title"
      >
        <div className="ptc-programs-section-heading">
          <span className="ptc-programs-section-kicker">Programs offered</span>
          <h2 id="ptc-programs-catalog-title">Academic pathways at PTC</h2>
          <p>
            Review the available program areas and choose the path that best
            supports your academic interests and future plans.
          </p>
        </div>

        <div className="ptc-programs-grid">
          {programs.map((program, index) => {
            const Icon = program.icon;

            return (
              <article className="ptc-program-card" key={program.title}>
                <div className="ptc-program-card__top">
                  <span className="ptc-program-card__icon">
                    <Icon size={23} aria-hidden="true" />
                  </span>

                  <span className="ptc-program-card__number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>

                <span className="ptc-program-card__label">
                  {program.shortLabel}
                </span>

                <h3>{program.title}</h3>

                <p>{program.description}</p>

                <div className="ptc-program-card__footer">
                  <button type="button">
                    Apply Now
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section
        className="ptc-programs-focus"
        aria-labelledby="ptc-programs-focus-title"
      >
        <div className="ptc-programs-focus__intro">
          <span className="ptc-programs-section-kicker">Learning at PTC</span>
          <h2 id="ptc-programs-focus-title">
            Preparing students for what comes next
          </h2>
          <p>
            PTC programs are presented around practical learning, student
            development, and preparation for future opportunities.
          </p>
        </div>

        <div className="ptc-programs-focus__list">
          {focusAreas.map((item) => {
            const Icon = item.icon;

            return (
              <article key={item.title}>
                <span>
                  <Icon size={20} aria-hidden="true" />
                </span>

                <div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
