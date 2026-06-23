export const PERMISSIONS = [
  "ORDERS",
  "CATALOG",
  "CUSTOMERS",
  "COUPONS",
  "REPORTS",
  "FINANCE",
  "CASH_MANAGE",
  "CASH_REOPEN",
  "ACCOUNTS_MANAGE",
  "FINANCE_REPORTS",
  "AUDIT_VIEW",
  "SETTINGS",
  "USERS",
  "STORE_PAUSE"
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const DEFAULT_STAFF_ROLES = [
  {
    name: "Funcionario",
    permissions: ["ORDERS", "CUSTOMERS"] satisfies Permission[]
  },
  {
    name: "Gerente",
    permissions: [
      "ORDERS",
      "CATALOG",
      "CUSTOMERS",
      "COUPONS",
      "REPORTS",
      "FINANCE",
      "CASH_MANAGE",
      "CASH_REOPEN",
      "ACCOUNTS_MANAGE",
      "FINANCE_REPORTS",
      "AUDIT_VIEW",
      "STORE_PAUSE"
    ] satisfies Permission[]
  },
  {
    name: "Operador de caixa",
    permissions: ["ORDERS", "CUSTOMERS", "CASH_MANAGE"] satisfies Permission[]
  },
  {
    name: "Financeiro",
    permissions: ["FINANCE", "ACCOUNTS_MANAGE", "FINANCE_REPORTS", "AUDIT_VIEW"] satisfies Permission[]
  }
];
