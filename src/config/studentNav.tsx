export const studentNavGroups = [
  {
    id: 'academic',
    label: 'Academic Records',
    icon: '📚',
    children: [
      { label: 'Grades & Results', path: '/student/records' },
      { label: 'Schedule', path: '/student/schedule' },
    ]
  },
  {
    id: 'admission',
    label: 'Admissions',
    icon: '📋',
    children: [
      { label: 'My Admission', path: '/student/admission' },
      { label: 'Status', path: '/student/admission' },
    ]
  },
  {
    id: 'announcements',
    label: 'Announcements',
    icon: '📢',
    children: [
      { label: 'View all', path: '/student/announcements' },
      { label: 'Important', path: '/student/announcements' },
    ]
  }
];

export const studentSoloLinks = [
  { label: 'Profile', path: '/student/profile', icon: '👤' },
  { label: 'Dashboard', path: '/student/dashboard', icon: '🏠' }
];
