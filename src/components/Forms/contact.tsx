import {
  BookOpenCheck,
  CircleHelp,
  GraduationCap,
  Mail,
  MapPin,
  Phone,
  School,
  ShieldCheck,
} from "lucide-react";

import campusImage from "../../assets/campus.webp";
import "../../styles/ContactPage.css";

const contactItems = [
  {
    title: "Campus",
    icon: MapPin,
    description: "Pateros Technological College",
    detail: "Pateros, Metro Manila, Philippines",
  },
  {
    title: "Email",
    icon: Mail,
    description:
      "Contact the PTC office through its official email channels for admission and student concerns.",
    detail: "Use the official PTC communication channels for assistance.",
  },
  {
    title: "Phone",
    icon: Phone,
    description:
      "Contact the PTC office during official school hours for inquiries and assistance.",
    detail: "For school-related inquiries and student support.",
  },
];

const supportAreas = [
  {
    title: "Admissions",
    icon: GraduationCap,
    description:
      "Ask about admission-related concerns and information about studying at PTC.",
  },
  {
    title: "Academic Programs",
    icon: BookOpenCheck,
    description:
      "Get guidance about the programs and academic pathways presented by PTC.",
  },
  {
    title: "Student Portal",
    icon: CircleHelp,
    description:
      "Reach out for concerns related to accessing or using the PTC student portal.",
  },
];

export default function Contact() {
  return (
    <main className="ptc-contact-page">
      <section className="ptc-contact-hero">
        <div className="ptc-contact-hero__copy">
          <div className="ptc-contact-eyebrow">
            <span>
              <Mail size={18} aria-hidden="true" />
            </span>
            Get in Touch
          </div>

          <h1>We are here to help</h1>

          <p className="ptc-contact-hero__lead">
            Have questions about admission, programs, or the student portal?
            Contact PTC through the information below.
          </p>

          <div
            className="ptc-contact-hero__topics"
            aria-label="Contact topics"
          >
            <span>
              <GraduationCap size={15} aria-hidden="true" />
              Admissions
            </span>
            <span>
              <BookOpenCheck size={15} aria-hidden="true" />
              Programs
            </span>
            <span>
              <CircleHelp size={15} aria-hidden="true" />
              Student Portal
            </span>
          </div>
        </div>

        <div className="ptc-contact-hero__visual">
          <img
            src={campusImage}
            alt="Pateros Technological College campus"
          />

          <div className="ptc-contact-hero__visual-card">
            <span>
              <School size={19} aria-hidden="true" />
            </span>

            <div>
              <small>Visit PTC</small>
              <strong>Pateros, Metro Manila, Philippines</strong>
            </div>
          </div>
        </div>
      </section>

      <section
        className="ptc-contact-details"
        aria-labelledby="ptc-contact-details-title"
      >
        <div className="ptc-contact-section-heading">
          <span className="ptc-contact-section-kicker">
            Contact information
          </span>

          <h2 id="ptc-contact-details-title">
            Connect with Pateros Technological College
          </h2>

          <p>
            Use the appropriate PTC contact channel depending on the type of
            assistance you need.
          </p>
        </div>

        <div className="ptc-contact-grid">
          {contactItems.map((item, index) => {
            const Icon = item.icon;

            return (
              <article className="ptc-contact-card" key={item.title}>
                <div className="ptc-contact-card__top">
                  <span className="ptc-contact-card__icon">
                    <Icon size={22} aria-hidden="true" />
                  </span>

                  <span className="ptc-contact-card__number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>

                <h3>{item.title}</h3>

                <p>{item.description}</p>

                <div className="ptc-contact-card__detail">
                  <ShieldCheck size={15} aria-hidden="true" />
                  <span>{item.detail}</span>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section
        className="ptc-contact-support"
        aria-labelledby="ptc-contact-support-title"
      >
        <div className="ptc-contact-support__intro">
          <span className="ptc-contact-section-kicker">
            How we can assist
          </span>

          <h2 id="ptc-contact-support-title">
            Find the right kind of support
          </h2>

          <p>
            PTC contact channels can help direct questions about admissions,
            academic programs, and student portal concerns.
          </p>
        </div>

        <div className="ptc-contact-support__list">
          {supportAreas.map((item) => {
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
