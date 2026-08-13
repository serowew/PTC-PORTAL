// registrarNav.ts

export const registrarSoloLinks = [
  {
    label: "Dashboard",
    path: "/registrar/dashboard",
    icon: "🏠",
  },
  {
    label: "Announcement",
    path: "/registrar/announcement/listR",
    icon: "🏠",
  },
];

export const registrarNavGroups = [
  {
    id: "students",
    label: "Student Records",
    icon: "👨‍🎓",
    children: [
      {
        label: "Student List",
        path: "/registrar/student/listR",
      },
    ],
  },

  {
    id: "enrollment",
    label: "Enrollment",
    icon: "📝",
    children: [
      {
        label: "New Enrollment",
        path: "/registrar/enrollment/new",
      },
      {
        label: "My Requests",
        path: "/registrar/enrollment/requests",
      },
    ],
  },
];