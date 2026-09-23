import { Mail, Phone } from "lucide-react";
import "../../styles/footer.css";

function FacebookIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M13.5 22v-9h3l.45-3.5H13.5V7.26c0-1.01.28-1.7 1.73-1.7H17V2.44c-.31-.04-1.37-.13-2.61-.13-2.58 0-4.35 1.58-4.35 4.47V9.5H7.12V13h2.92v9h3.46Z"
      />
    </svg>
  );
}

export default function Footer() {
  return (
    <footer className="ptc-footer" aria-label="PTC Portal footer">
      <div className="ptc-footer__inner">
        <div className="ptc-footer__main">
          <section
            className="ptc-footer__brand"
            aria-labelledby="ptc-footer-title"
          >
            <h2 id="ptc-footer-title">PTC Portal</h2>
            <p>
              Online Admission, Scheduling, and Student Information System for
              Pateros Technological College.
            </p>
          </section>

          <section
            className="ptc-footer__contact"
            aria-labelledby="ptc-footer-contact-title"
          >
            <h3 id="ptc-footer-contact-title">Contact</h3>

            <address>
              <a href="mailto:support@ptcportal.com">
                <Mail size={16} strokeWidth={1.9} aria-hidden="true" />
                <span>support@ptcportal.com</span>
              </a>

              <a href="tel:+639123456789">
                <Phone size={16} strokeWidth={1.9} aria-hidden="true" />
                <span>+63 912 345 6789</span>
              </a>
            </address>
          </section>

          <section
            className="ptc-footer__social"
            aria-labelledby="ptc-footer-social-title"
          >
            <h3 id="ptc-footer-social-title">Official Facebook</h3>

            <a
              href="https://www.facebook.com/ptc1993"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="ptc-footer__facebook-icon" aria-hidden="true">
                <FacebookIcon />
              </span>

              <span>Pateros Technological College</span>
            </a>
          </section>
        </div>

        <div className="ptc-footer__copyright">
          © 2026 PTC Portal. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
