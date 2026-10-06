export const facultyNavGroups = [
  {
    id: "classes",
    label: "Manage Classes",
    icon: "",
    children: [
      { label: "My Classes", path: "/faculty/classes" },
      { label: "Teaching Schedule ", path: "/faculty/classes/schedule" },
      { label: "Pending Grades", path: "/faculty/grades/summary" },
      { label: "Grading History ", path: "/faculty/grades/history" },
    ],
  },
];

export const facultySoloLinks = [
  { label: "Dashboard", path: "/faculty/dashboard", icon: "" },
  { label: "Profile", path: "/faculty/profile", icon: "" },
  { label: "Announcement", path: "/faculty/announcementF", icon: "" },
];
