import DashboardLayout from "../../components/Layout/DashboardLayout";
import { authService } from "../../services/auth.service";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import Modal from "../../components/modal";
import "../../styles/modal.css"; // Styles for gallery

export default function StudentRecord() {
  const navigate = useNavigate();
  const user = authService.getSession();
  const [selected, setSelected] = useState<string | null>(null);

  // Redirect if not student
  useEffect(() => {
    if (!user || user.role !== "student") {
      navigate("/login");
    }
  }, [user, navigate]);

  if (!user || user.role !== "student") return null;

  // Define student data
  const students: Record<string, { name: string; img: string; text: string; link: string }> = {
    A: {
      name: "Curriculum",
      img: "https://support.quickschools.com/hc/article_attachments/360055665872/6-Student_Info.png",
      text: "",
      link: ""
    },
    B: {
      name: "COR",
      img: "https://support.quickschools.com/hc/article_attachments/360055665872/6-Student_Info.png",
      text: "",
      link: ""
    },
    C: {
      name: "COG",
      img: "https://support.quickschools.com/hc/article_attachments/360055665872/6-Student_Info.png",
      text: "",
      link: ""
    },
    D: {
      name: "Student D",
      img: "https://static.wixstatic.com/media/7265fc_03b89e9804db4586a2ad6184bf88a1c3~mv2.png/v1/fill/w_980,h_560,al_c,q_90,usm_0.66_1.00_0.01,enc_avif,quality_auto/7265fc_03b89e9804db4586a2ad6184bf88a1c3~mv2.png",
      text: "",
      link: ""
    },
    E: {
      name: "Student E",
      img: "https://www.constructionsafety.ca/wp-content/uploads/2021/09/CORlogo-web.jpg",
      text: "",
      link: ""
    }
  };

  return (
    <DashboardLayout>
      <div className="studentrecords">
        <p style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "50px" }}>This is your student records.</p>

        {/* Gallery */}
        <div className="gallery2" style={{ display: "flex", gap: "99px" }}>
          {Object.keys(students).map((key) => (
            <div key={key} style={{ position: "relative", cursor: "pointer" }} onClick={() => setSelected(key)}>
              <img
                src={students[key].img}
                alt={students[key].name}
              />
              <p style={{ position: "absolute", bottom: "0", left: "0", right: "0", margin: "0", padding: "8px", background: "rgba(0,0,0,0.7)", color: "white", fontSize: "14px", fontWeight: "bold", textAlign: "center" }}>{students[key].name}</p>
            </div>
          ))}
        </div>

        {/* Modal with Bootstrap Card */}
        <Modal isOpen={selected !== null} onClose={() => setSelected(null)}>
          {selected && (
            <div className="card" style={{ width: "98%",height: "100%"}}>
              <img src={students[selected].img} className="card-img-top" alt={students[selected].name} />
              <div className="card-body">
                <h5 className="card-title">{students[selected].name}</h5>
                <p className="card-text">{students[selected].text}</p>
                <a href={students[selected].link} className="btn btn-primary">
                  Go somewhere
                </a>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </DashboardLayout>
  );
}