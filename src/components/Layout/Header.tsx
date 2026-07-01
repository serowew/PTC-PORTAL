import { authService } from "../../services/auth.service";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";

export default function Header() {
  const user = authService.getSession();
  const navigate = useNavigate();

  const [visible, setVisible] = useState(true);

  function handleLogout() {
    authService.logout();
    navigate("/login");
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const handleMove = (e: MouseEvent) => {
      if (e.clientY <= 10) {
        clearTimeout(timer);
        setVisible(true);
      } else {
        clearTimeout(timer);

        timer = setTimeout(() => {
          setVisible(false);
        }, 1500);
      }
    };

    window.addEventListener("mousemove", handleMove);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", handleMove);
    };
  }, []);

  return (
    <header className={`app-header ${visible ? "show" : "hide"}`}>
      <div className="header-left">
        <h2 className="header-logo">PTC Portal</h2>
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