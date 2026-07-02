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
  "STORE_PAUSE",
  "PDV_OPEN",
  "PDV_MANAGE",
  "PDV_CLOSE",
  "PDV_HISTORY"
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const DEFAULT_STAFF_ROLES = [
  {
    name: "Funcionario",
    permissions: ["ORDERS", "CUSTOMERS", "PDV_OPEN"] satisfies Permission[]
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
      "STORE_PAUSE",
      "PDV_OPEN",
      "PDV_MANAGE",
      "PDV_CLOSE",
      "PDV_HISTORY"
    ] satisfies Permission[]
  },
  {
    name: "Operador de caixa",
    permissions: ["ORDERS", "CUSTOMERS", "CASH_MANAGE", "PDV_OPEN", "PDV_CLOSE", "PDV_HISTORY"] satisfies Permission[]
  },
  {
    name: "Financeiro",
    permissions: ["FINANCE", "ACCOUNTS_MANAGE", "FINANCE_REPORTS", "AUDIT_VIEW", "PDV_HISTORY"] satisfies Permission[]
  }
];
