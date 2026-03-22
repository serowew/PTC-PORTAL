export default function Footer() {
  return (
    <footer className="bg-dark text-light mt-auto">
      <div className="container-fluid py-1">
        <div className="row text-center">
          <div className="col-12 col-md-4">
            <small>PTC Portal - Online Admission & Student System</small>
          </div>
          <div className="col-12 col-md-4">
            <small>Quick Links: Dashboard | Admin | Support</small>
          </div>
          <div className="col-12 col-md-4">
            <small>Contact: support@ptcportal.com | +63 912 345 6789</small>
          </div>
        </div>
        <div className="text-center small mt-1">
          © {new Date().getFullYear()} PTC Portal. All rights reserved.
        </div>
      </div>
    </footer>
  )
}