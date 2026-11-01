import { NavLink, useNavigate } from "react-router-dom";
import logo from "../../assets/ptclogo.jpg";

export default function Navbar() {
  const navigate = useNavigate();

  const handleLogin = (): void => {
    navigate("/login");
  };

  return (
    <header className="header">
      {/* LOGO */}
      <div className="logo">
        <div className="logoMark">
          <img src={logo} alt="PTC Logo" />
        </div>

        <span className="logoText">PTC PORTAL</span>
      </div>

      {/* NAVIGATION */}
      <nav className="nav">
        <NavLink
          to="/"
          className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}
        >
          Home
        </NavLink>

        <NavLink
          to="/about"
          className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}
        >
          About
        </NavLink>

        <NavLink
          to="/programs"
          className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}
        >
          Programs
        </NavLink>

        <NavLink
          to="/contact"
          className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}
        >
          Contact
        </NavLink>
        <NavLink
          to="/admission"
          className={({ isActive }) => `navLink ${isActive ? "active" : ""}`}
        >
          Admission
        </NavLink>
      </nav>

      {/* LOGIN */}
      <div className="ctaGroup">
        <button type="button" className="btnLogin" onClick={handleLogin}>
          Log In
        </button>
      </div>
    </header>
  );
}
