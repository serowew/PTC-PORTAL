export const studentNavGroups = [
  {
    id: "enrollment",
    label: "Enrollment Management ",
    icon: "",
    children: [{ label: "Enrollment ", path: "/student/enrollment/main" }],
  },
  {
    id: "academic",
    label: "Academic Records",
    icon: "",
    children: [
      { label: "Schedule", path: "/student/schedule" },
      { label: "Grades", path: "/student/records" },
      { label: "Academic History", path: "/student/course-history" },
    ],
  },

  {
    id: "document",
    label: "Document",
    icon: "",
    children: [
      { label: "Request Document", path: "/student/document/request" },
      { label: "Document Release", path: "/student/document/release" },
    ],
  },
];
export const studentSoloLinks = [
  { label: "Dashboard", path: "/student/dashboard", icon: "" },
  { label: "Announcement", path: "/student/announcement", icon: "" },
  { label: "Profile", path: "/student/profile", icon: "" },
];
