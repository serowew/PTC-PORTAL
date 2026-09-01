import { useEffect, useState } from "react";

import "../../styles/herolayout.css";

import ptcBackground from "../../assets/ptcbackground.jpg";
import campusExterior from "../../assets/campus.webp";
import classroom from "../../assets/classrooms.webp";
import assembly from "../../assets/student activities.png";
import library from "../../assets/GROUP6.png";
import studentsWalking from "../../assets/BG.png";

interface GalleryImage {
  url: string;
  caption: string;
}

const IMAGES: GalleryImage[] = [
  {
    url: ptcBackground,
    caption: "Campus Life",
  },
  {
    url: campusExterior,
    caption: "Our Campus",
  },
  {
    url: classroom,
    caption: "Modern Classrooms",
  },
  {
    url: assembly,
    caption: "Student Activities",
  },
  {
    url: library,
    caption: "Research Facilities",
  },
  {
    url: studentsWalking,
    caption: "Student Community",
  },
];

export default function HomeScreen() {
  const [currentImage, setCurrentImage] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentImage((prev) => (prev + 1) % IMAGES.length);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="root">
      {/* MAIN */}
      <main className="main">
        {/* LEFT PANEL */}
        <div className="leftPanel">
          <p className="greeting">Welcome to Pateros Technological College</p>

          <h1 className="headline">
            Where great <br />
            <em className="headlineAccent">minds</em> grow.
          </h1>

          <p className="tagline">
            A place built for curiosity, driven by ambition, and defined by the
            people who walk its halls.
          </p>
        </div>

        {/* IMAGE SLIDESHOW */}
        <div className="rightPanel">
          <div className="gallery">
            {IMAGES.map((img, index) => (
              <div
                key={`${img.url}-${index}`}
                className={`galleryItem ${
                  index === currentImage ? "active" : ""
                }`}
              >
                <img src={img.url} alt={img.caption} />

                <div className="galleryCaption">{img.caption}</div>
              </div>
            ))}
          </div>

          {/* SLIDE INDICATORS */}
          <div className="galleryIndicators">
            {IMAGES.map((_, index) => (
              <button
                type="button"
                key={index}
                className={`indicator ${
                  index === currentImage ? "active" : ""
                }`}
                onClick={() => setCurrentImage(index)}
                aria-label={`Go to image ${index + 1}`}
              />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
