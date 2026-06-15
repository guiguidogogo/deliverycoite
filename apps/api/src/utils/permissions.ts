export const PERMISSIONS = [
  "ORDERS",
  "CATALOG",
  "CUSTOMERS",
  "COUPONS",
  "REPORTS",
  "FINANCE",
  "CASH_MANAGE",
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
      "STORE_PAUSE"
    ] satisfies Permission[]
  }
];
