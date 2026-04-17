export const facultyNavGroups = [
  {
    id: "classes",
    label: "Manage Classes",
    icon: "",
    children: [
      { label: "My Classes", path: "/faculty/classes" },
      { label: "Class Schedule", path: "/faculty/classes/schedule" },
      { label: "Student List", path: "/faculty/classes/students" },
    ],
  },
  {
    id: "materials",
    label: "Upload Materials",
    icon: "",
    children: [
      { label: "Lecture Notes", path: "/faculty/materials/notes" },
      { label: "Syllabus", path: "/faculty/materials/syllabus" },
    ],
  },
  {
    id: "grades",
    label: "Post Grades",
    icon: "",
    children: [
      { label: "Enter Grades", path: "/faculty/grades/enter" },
      { label: "Grade Summary", path: "/faculty/grades/summary" },
      { label: "Grade History", path: "/faculty/grades/history" },
    ],
  },
  {
    id: "attendance",
    label: "Attendance",
    icon: "",
    children: [
      { label: "Take Attendance", path: "/faculty/attendance/take" },
      { label: "Attendance Records", path: "/faculty/attendance/records" },
      { label: "Attendance Reports", path: "/faculty/attendance/reports" },
    ],
  },
  {
    id: "communication",
    label: "Communication",
    icon: "",
    children: [
      { label: "Messages", path: "/faculty/communication/messages" },
      { label: "Announcements", path: "/faculty/communication/announcements" },
      { label: "Send Notice", path: "/faculty/communication/send" },
    ],
  },
];

export const facultySoloLinks = [
  { label: "Dashboard", path: "/faculty/dashboard", icon: "" },
  { label: "Profile", path: "/faculty/profile", icon: "" },
];
