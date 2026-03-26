export default function Footer() {
  return (
    <footer className="bg-dark text-light mt-auto footer">
      <div className="container py-3">
        <div className="row gy-1">
          {/* Portal Info */}
          <div className="col-md-4">
            <h5 className="footer-title">PTC Portal</h5>
            <p className="footer-text">
              Online Admission, Scheduling, and Student Information System for
              Pateros Technological College.
            </p>
          </div>

          {/* Quick Links */}
          <div className="col-md-4">
            <h6 className="footer-subtitle">Quick Links</h6>
            <ul className="footer-links">
              <li>
                <a href="/dashboard">Student Dashboard</a>
              </li>
              <li>
                <a href="/admin">Admin Panel</a>
              </li>
              <li>
                <a href="/support">Contact Support</a>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div className="col-md-4">
            <h6 className="footer-subtitle">Contact</h6>
            <p className="footer-text">
              support@ptcportal.com <br />
              +63 912 345 6789
            </p>
          </div>
        </div>

        <hr />

        <div className="text-center footer-bottom">
          © {new Date().getFullYear()} PTC Portal. All rights reserved.
        </div>
      </div>
    </footer>
  );
}