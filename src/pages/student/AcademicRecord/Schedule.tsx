import DashboardLayout from "../../../components/Layout/DashboardLayout";
import { authService } from "../../../services/auth.service";
import { useNavigate } from "react-router-dom";
import { useRef, useState, useEffect } from "react";
import "../../../styles/StudentSchedule.css";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";

interface Holiday {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
  fixed: boolean;
  global: boolean;
  counties: string[] | null;
  launchYear: number | null;
  types: string[];
}

interface ScheduleEvent {
  title: string;
  start: string;
  color?: string;
  className?: string;
}

export default function StudentSchedule() {
  const navigate = useNavigate();
  const user = authService.getSession();

  const calendarRef = useRef<FullCalendar | null>(null);

  const [currentMonth, setCurrentMonth] = useState("");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [holidays, setHolidays] = useState<Holiday[]>([]);

  // Temporary subject events
  // You can later replace these with events from your database.
  const events: ScheduleEvent[] = [
    {
      title: "Capstone",
      start: "2026-08-10",
      color: "#2563eb",
    },
    {
      title: "Networking",
      start: "2026-08-13",
      color: "#cadd1b",
    },
    {
      title: "Database",
      start: "2026-08-18",
      color: "#46e21f",
    },
  ];

  // Redirect non-students to login
  useEffect(() => {
    if (!user || user.role !== "Student") {
      navigate("/login");
    }
  }, [user, navigate]);

  // Fetch Philippine public holidays
  useEffect(() => {
    fetch("https://date.nager.at/api/v3/PublicHolidays/2026/PH")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to fetch holidays");
        }

        return response.json();
      })
      .then((data: Holiday[]) => {
        setHolidays(data);
      })
      .catch((error: unknown) => {
        console.error("Error fetching holidays:", error);
      });
  }, []);

  // Get holidays for currently displayed month
  const currentMonthHolidays = holidays.filter((holiday) => {
    const holidayDate = new Date(holiday.date);

    return (
      holidayDate.getMonth() === currentDate.getMonth() &&
      holidayDate.getFullYear() === currentDate.getFullYear()
    );
  });

  // Convert holidays into FullCalendar events
  const holidayEvents: ScheduleEvent[] = holidays.map((holiday) => ({
    title: holiday.localName,
    start: holiday.date,
    className: "holiday-event",
  }));

  // Go to previous month
  const handlePreviousMonth = () => {
    const calendarApi = calendarRef.current?.getApi();

    if (!calendarApi) return;

    calendarApi.prev();

    setCurrentMonth(calendarApi.view.title);
    setCurrentDate(calendarApi.getDate());
  };

  // Go to today
  const handleToday = () => {
    const calendarApi = calendarRef.current?.getApi();

    if (!calendarApi) return;

    calendarApi.today();

    setCurrentMonth(calendarApi.view.title);
    setCurrentDate(calendarApi.getDate());
  };

  // Go to next month
  const handleNextMonth = () => {
    const calendarApi = calendarRef.current?.getApi();

    if (!calendarApi) return;

    calendarApi.next();

    setCurrentMonth(calendarApi.view.title);
    setCurrentDate(calendarApi.getDate());
  };

  // Don't render dashboard if user isn't logged in
  if (!user || user.role !== "Student") {
    return null;
  }

  return (
    <DashboardLayout>
      <div className="student-schedule-page">
        {/* Page Header */}
        <div className="schedule-header">
          <div>
            <h1>Student Schedule</h1>
            <h2>{currentMonth}</h2>
          </div>

          <div className="month-navigation">
            <button
              type="button"
              onClick={handlePreviousMonth}
              aria-label="Previous month"
            >
              &lt;
            </button>

            <button type="button" onClick={handleToday}>
              Today
            </button>

            <button
              type="button"
              onClick={handleNextMonth}
              aria-label="Next month"
            >
              &gt;
            </button>
          </div>
        </div>

        {/* Calendar */}
        <div className="calendar-container">
          <h3>Monthly Calendar</h3>

          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            headerToolbar={false}
            height="auto"
            events={[...events, ...holidayEvents]}
            datesSet={(info) => {
              setCurrentMonth(info.view.title);
              setCurrentDate(info.view.currentStart);
            }}
          />
        </div>

        {/* Holidays */}
        <div className="holiday-container">
          <h3>HOLIDAYS THIS MONTH</h3>

          {holidays.length === 0 ? (
            <p>Loading holidays...</p>
          ) : currentMonthHolidays.length === 0 ? (
            <p>No holidays this month.</p>
          ) : (
            <ul>
              {currentMonthHolidays.map((holiday) => (
                <li key={holiday.date}>
                  <strong>
                    {new Date(holiday.date).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                    })}
                  </strong>

                  {" — "}

                  {holiday.localName}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Subject Legend */}
        <div className="legend-container">
          <h3>Subject Legend</h3>

          <div className="legend-item">
            <span
              className="legend-color"
              style={{ backgroundColor: "#2563eb" }}
            ></span>

            <span>Capstone</span>
          </div>

          <div className="legend-item">
            <span
              className="legend-color"
              style={{ backgroundColor: "#cadd1b" }}
            ></span>

            <span>Networking</span>
          </div>

          <div className="legend-item">
            <span
              className="legend-color"
              style={{ backgroundColor: "#46e21f" }}
            ></span>

            <span>Database</span>
          </div>

          <div className="legend-item">
            <span className="legend-color holiday-legend-color"></span>

            <span>Holiday</span>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
