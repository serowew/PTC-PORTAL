// registrarNav.ts

export const registrarSoloLinks = [
  {
    label: "Dashboard",
    path: "/registrar/dashboard",
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
        label: "Records",
        path: "/registrar/student/records",
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