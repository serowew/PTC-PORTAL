import { authService } from "../../services/auth.service";
import { useNavigate } from "react-router-dom";

export default function Header() {
  const user = authService.getSession();
  const navigate = useNavigate();

  function handleLogout() {
    authService.logout();
    navigate("/login");
  }

  return (
    <header className="app-header">
      <div className="header-left">
        <h2 className="logo"></h2>
      </div>

      <div className="header-right">
        <div className="user-info">
          <span className="user-name">{user?.username}</span>
          <span className="user-role">{user?.role}</span>
        </div>

        <button className="logout-btn" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </header>
  );
}
