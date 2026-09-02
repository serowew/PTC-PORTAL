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
    id: "grades",
    label: "Post Grades",
    icon: "",
    children: [
      { label: "Enter Grades", path: "/faculty/grades/enter" },
      { label: "Grade Summary", path: "/faculty/grades/summary" },
      { label: "Grade History", path: "/faculty/grades/history" },
    ],
  },
];

export const facultySoloLinks = [
  { label: "Dashboard", path: "/faculty/dashboard", icon: "" },
  { label: "Profile", path: "/faculty/profile", icon: "" },
  { label: "Announcement", path: "/faculty/announcementF", icon: "" },
];
