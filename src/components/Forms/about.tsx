import {
  BookOpenCheck,
  Building2,
  Eye,
  GraduationCap,
  HeartHandshake,
  Target,
  UsersRound,
} from "lucide-react";

import campusImage from "../../assets/campus.webp";
import classroomImage from "../../assets/classrooms.webp";
import studentCommunityImage from "../../assets/BG.png";

import "../../styles/AboutPage.css";

export default function About() {
  return (
    <main className="ptc-about-page">
      <section className="ptc-about-hero">
        <div className="ptc-about-hero__copy">
          <div className="ptc-about-eyebrow">
            <span>
              <Building2 size={17} aria-hidden="true" />
            </span>
            About PTC
          </div>

          <h1>Pateros Technological College</h1>

          <p className="ptc-about-hero__lead">
            Pateros Technological College is committed to providing
            accessible, quality, and practical education that helps students
            prepare for their future careers and become productive members of
            society.
          </p>

          <div className="ptc-about-hero__principles" aria-label="PTC focus areas">
            <span>
              <BookOpenCheck size={15} aria-hidden="true" />
              Quality Education
            </span>
            <span>
              <GraduationCap size={15} aria-hidden="true" />
              Practical Learning
            </span>
            <span>
              <UsersRound size={15} aria-hidden="true" />
              Student Growth
            </span>
          </div>
        </div>

        <div className="ptc-about-hero__visual" aria-label="Pateros Technological College campus">
          <img
            src={campusImage}
            alt="Pateros Technological College campus"
          />

          <div className="ptc-about-hero__visual-card">
            <span>
              <GraduationCap size={18} aria-hidden="true" />
            </span>
            <div>
              <small>Our commitment</small>
              <strong>Education with purpose</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="ptc-about-intro" aria-labelledby="ptc-about-guides-title">
        <div className="ptc-about-section-heading">
          <span className="ptc-about-section-kicker">What guides us</span>
          <h2 id="ptc-about-guides-title">
            Focused on learning, growth, and community
          </h2>
          <p>
            Our mission, vision, and student-centered approach shape the
            learning experience we aim to provide.
          </p>
        </div>

        <div className="ptc-about-values">
          <article className="ptc-about-value-card">
            <div className="ptc-about-value-card__icon">
              <Target size={22} aria-hidden="true" />
            </div>

            <div>
              <span>01</span>
              <h3>Our Mission</h3>
              <p>
                To provide students with relevant knowledge, skills, and
                values through quality and accessible education.
              </p>
            </div>
          </article>

          <article className="ptc-about-value-card">
            <div className="ptc-about-value-card__icon">
              <Eye size={22} aria-hidden="true" />
            </div>

            <div>
              <span>02</span>
              <h3>Our Vision</h3>
              <p>
                To develop competent, responsible, and innovative graduates
                who can contribute positively to their community.
              </p>
            </div>
          </article>

          <article className="ptc-about-value-card">
            <div className="ptc-about-value-card__icon">
              <HeartHandshake size={22} aria-hidden="true" />
            </div>

            <div>
              <span>03</span>
              <h3>Student Focused</h3>
              <p>
                We aim to create a learning environment where students can
                grow, explore their interests, and prepare for real-world
                opportunities.
              </p>
            </div>
          </article>
        </div>
      </section>

      <section className="ptc-about-experience" aria-labelledby="ptc-about-experience-title">
        <div className="ptc-about-experience__gallery">
          <figure className="ptc-about-experience__image ptc-about-experience__image--large">
            <img src={classroomImage} alt="PTC classroom learning environment" />
          </figure>

          <figure className="ptc-about-experience__image ptc-about-experience__image--small">
            <img
              src={studentCommunityImage}
              alt="PTC student community"
            />
          </figure>
        </div>

        <div className="ptc-about-experience__copy">
          <span className="ptc-about-section-kicker">Student experience</span>
          <h2 id="ptc-about-experience-title">
            A learning environment built around students
          </h2>
          <p>
            PTC aims to give students space to learn, develop useful skills,
            explore their interests, and prepare for opportunities beyond the
            classroom.
          </p>

          <div className="ptc-about-experience__points">
            <div>
              <span>
                <BookOpenCheck size={18} aria-hidden="true" />
              </span>
              <div>
                <strong>Relevant learning</strong>
                <p>
                  Knowledge and skills are centered on helping students prepare
                  for future careers.
                </p>
              </div>
            </div>

            <div>
              <span>
                <UsersRound size={18} aria-hidden="true" />
              </span>
              <div>
                <strong>Student development</strong>
                <p>
                  The learning environment supports growth, responsibility,
                  and participation in the community.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
