import "../../styles/herolayout.css";

export default function HomeScreen() {
  return (
    <div className="root">
      <main className="main">
        <div className="leftPanel">
          <p className="greeting">
            Welcome to Pateros Technological College
          </p>

          <h1 className="headline">
            Where great <br />
            <em className="headlineAccent">minds</em> grow.
          </h1>

          <p className="tagline">
            A place built for curiosity, driven by ambition, and defined by the
            people who walk its halls.
          </p>
        </div>
      </main>
    </div>
  );
}