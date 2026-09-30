import {
  ClipboardList,
  CreditCard,
  FileText,
  History,
  LayoutDashboard,
  ReceiptText,
  WalletCards,
} from "lucide-react";

export const financeSoloLinks = [
  {
    label: "Dashboard",
    path: "/finance/dashboard",
    icon: <LayoutDashboard size={18} strokeWidth={2} />,
  },
];

export const financeNavGroups = [
  {
    id: "finance-transactions",
    label: "Transaction Management",
    icon: <WalletCards size={18} strokeWidth={2} />,

    children: [
      {
        id: "finance-requests",
        label: "Requests",
        path: "/finance/tickets",
        icon: <ClipboardList size={17} strokeWidth={2} />,
      },

      {
        id: "finance-transactions-create",
        label: "Transactions",
        path: "/finance/transactions/create",
        icon: <CreditCard size={17} strokeWidth={2} />,
      },

      {
        id: "finance-transaction-types",
        label: "Transaction Type",
        path: "/finance/transaction-types",
        icon: <ReceiptText size={17} strokeWidth={2} />,
      },
    ],
  },

  {
    id: "finance-records",
    label: "Finance Records",
    icon: <FileText size={18} strokeWidth={2} />,

    children: [
      {
        id: "finance-reports",
        label: "Reports",
        path: "/finance/reports",
        icon: <FileText size={17} strokeWidth={2} />,
      },

      {
        id: "finance-payment-history",
        label: "Payment History",
        path: "/finance/payment-history",
        icon: <History size={17} strokeWidth={2} />,
      },
    ],
  },
];