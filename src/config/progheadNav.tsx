// src/config/progheadNav.tsx

export const programHeadSoloLinks = [
  {
    label: "Dashboard",
    path: "/programhead/dashboard",
    icon: "",
  },

  {
    label: "Announcement",
    path: "/programhead/announcementprog",
    icon: "",
  },
];

export const programHeadNavGroups = [
  {
    id: "class-management",
    label: "Class Management",
    icon: "📋",
    children: [
      {
        label: "My Teaching Schedule",
        path: "/programhead/class/schedule",
      },
      {
        label: "Classes",
        path: "/programhead/class/management",
      },
      {
        label: "Offering Batches",
        path: "/programhead/class/offering-batches",
      },
      {
        label: "Faculty Schedule Summary",
        path: "/programhead/class/faculty-schedule-summary",
      },
    ],
  },
  {
    id: "grade-approval",
    label: "Grade Approval",
    icon: "📋",
    children: [
      {
        label: "Pending Grades",
        path: "/programhead/gradeapproval/pending",
      },
      {
        label: "Change Grade Requests",
        path: "/programhead/grade-change-requests",
      },
      {
        label: "Transfer Evaluations",
        path: "/programhead/transfer-evaluations",
      },
    ],
  },
];
