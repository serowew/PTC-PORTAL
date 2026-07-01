import Header from "./Header";
import Footer from "./Footer";
import Sidebars from "./Sidebar";

type Props = {
  children: React.ReactNode;
};

export default function DashboardLayout({ children }: Props) {
  return (
    <div className="dashboard-wrapper">
      <Sidebars />

      <div className="dashboard-main">
        <div className="header-container">
          <Header />
        </div>

        <div className="dashboard-content">{children}</div>

        <Footer />
      </div>
    </div>
  );
}