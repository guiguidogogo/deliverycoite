import { Router, type RequestHandler } from "express";
import { login } from "../controllers/auth-controller.js";
import { getPublicCompany } from "../controllers/company-controller.js";
import {
  createCompany,
  generateCompanySubdomain,
  getCompany,
  listCompanies,
  updateCompany,
  updateCompanyStatus
} from "../controllers/companies-controller.js";
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory
} from "../controllers/categories-controller.js";
import {
  createCoupon,
  deleteCoupon,
  listCoupons,
  validateCoupon,
  updateCoupon
} from "../controllers/coupons-controller.js";
import {
  createComplement,
  deleteComplement,
  listComplements,
  updateComplement
} from "../controllers/complements-controller.js";
import {
  registerCustomer,
  loginCustomer,
  getCustomerProfile,
  updateCustomerProfile,
  changeCustomerPassword,
  addCustomerAddress,
  updateCustomerAddress,
  deleteCustomerAddress
} from "../controllers/customer-auth-controller.js";
import {
  requestCustomerPasswordReset,
  requestStaffPasswordReset,
  resetCustomerPassword,
  resetStaffPassword
} from "../controllers/password-controller.js";
import {
  changeStaffPassword,
  createStaffRole,
  createStaffUser,
  deleteStaffRole,
  getCurrentStaff,
  listStaffRoles,
  listStaffUsers,
  updateCurrentStaff,
  updateStaffRole,
  updateStaffUser
} from "../controllers/staff-controller.js";
import { deleteCustomer, listCustomers, lookupCustomer, updateCustomer } from "../controllers/customers-controller.js";
import { getDashboard } from "../controllers/dashboard-controller.js";
import { quoteDelivery } from "../controllers/delivery-controller.js";
import {
  closeCashSession,
  createCashEntry,
  getFinanceSummary,
  listCashSessions,
  openCashSession
} from "../controllers/finance-controller.js";
import { getFutureIntegrations, testMenuiaIntegration } from "../controllers/integrations-controller.js";
import { listNewOrders } from "../controllers/notifications-controller.js";
import {
  createOrder,
  listOrders,
  markOrderViewed,
  deleteOrder,
  markOrderPaid,
  printOrderById,
  sendToDelivery,
  updateOrderStatus
} from "../controllers/orders-controller.js";
import { uploadImage } from "../controllers/upload-controller.js";
import {
  createProduct,
  deleteProduct,
  listProducts,
  toggleFavorite,
  updateProduct
} from "../controllers/products-controller.js";
import { exportOrdersExcel, exportOrdersPdf } from "../controllers/reports-controller.js";
import { listPrinters } from "../controllers/printer-controller.js";
import { getSettings, updateSettings } from "../controllers/settings-controller.js";
import { auth, requireAnyPermission, requirePermission, requireSuperAdmin } from "../middlewares/auth.js";
import { customerAuth } from "../middlewares/customer-auth.js";
import { imageUpload } from "../utils/upload.js";
import { asyncHandler } from "../utils/async-handler.js";
import { resolveCompany } from "../utils/tenant.js";

export const router = Router();
router.use(asyncHandler(resolveCompany));

const route = {
  get(path: string, ...handlers: RequestHandler[]) {
    return router.get(path, ...handlers.map(asyncHandler));
  },
  post(path: string, ...handlers: RequestHandler[]) {
    return router.post(path, ...handlers.map(asyncHandler));
  },
  patch(path: string, ...handlers: RequestHandler[]) {
    return router.patch(path, ...handlers.map(asyncHandler));
  },
  delete(path: string, ...handlers: RequestHandler[]) {
    return router.delete(path, ...handlers.map(asyncHandler));
  }
};

route.post("/auth/login", login);
route.get("/company", getPublicCompany);
route.post("/auth/password/request", requestStaffPasswordReset);
route.post("/auth/password/reset", resetStaffPassword);
// Customer auth routes
route.post("/customer/register", registerCustomer);
route.post("/customer/login", loginCustomer);
route.post("/customer/password/request", requestCustomerPasswordReset);
route.post("/customer/password/reset", resetCustomerPassword);
route.get("/customer/profile", customerAuth, getCustomerProfile);
route.patch("/customer/profile", customerAuth, updateCustomerProfile);
route.patch("/customer/password", customerAuth, changeCustomerPassword);
route.post("/customer/addresses", customerAuth, addCustomerAddress);
route.patch("/customer/addresses/:id", customerAuth, updateCustomerAddress);
route.delete("/customer/addresses/:id", customerAuth, deleteCustomerAddress);


route.get("/settings", getSettings);
route.get("/delivery/quote", quoteDelivery);
route.get("/customers/lookup", lookupCustomer);
route.get("/categories", listCategories);
route.get("/products", listProducts);
route.get("/complements", listComplements);
route.get("/coupons/validate", validateCoupon);
route.post("/favorites/toggle", toggleFavorite);
route.post("/orders", createOrder);
route.get("/integrations/future", getFutureIntegrations);

router.use(auth());
route.get("/admin/me", getCurrentStaff);
route.get("/admin/companies/subdomain", requireSuperAdmin, generateCompanySubdomain);
route.get("/admin/companies", requireSuperAdmin, listCompanies);
route.post("/admin/companies", requireSuperAdmin, createCompany);
route.get("/admin/companies/:id", requireSuperAdmin, getCompany);
route.patch("/admin/companies/:id", requireSuperAdmin, updateCompany);
route.patch("/admin/companies/:id/status", requireSuperAdmin, updateCompanyStatus);
route.patch("/admin/me", updateCurrentStaff);
route.patch("/admin/password", changeStaffPassword);
route.get("/admin/orders", requirePermission("ORDERS"), listOrders);
route.patch("/admin/orders/:id/status", requirePermission("ORDERS"), updateOrderStatus);
route.patch("/admin/orders/:id/viewed", requirePermission("ORDERS"), markOrderViewed);
route.patch("/admin/orders/:id/paid", requirePermission("ORDERS"), markOrderPaid);
route.delete("/admin/orders/:id", requirePermission("ORDERS"), deleteOrder);
route.post("/admin/orders/:id/send-delivery", requirePermission("ORDERS"), sendToDelivery);
route.post("/admin/orders/:id/print", requirePermission("ORDERS"), printOrderById);
route.get("/admin/printers", requirePermission("SETTINGS"), listPrinters);
route.get("/admin/dashboard", requirePermission("ORDERS"), getDashboard);
route.get("/admin/notifications/new-orders", requirePermission("ORDERS"), listNewOrders);
route.get("/admin/reports/orders.xlsx", requirePermission("REPORTS"), exportOrdersExcel);
route.get("/admin/reports/orders.pdf", requirePermission("REPORTS"), exportOrdersPdf);
route.get("/admin/customers", requirePermission("CUSTOMERS"), listCustomers);
route.patch("/admin/customers/:id", requirePermission("CUSTOMERS"), updateCustomer);
route.delete("/admin/customers/:id", requirePermission("CUSTOMERS"), deleteCustomer);
route.get("/admin/finance/summary", requirePermission("FINANCE"), getFinanceSummary);
route.get("/admin/finance/sessions", requirePermission("FINANCE"), listCashSessions);
route.post("/admin/finance/open", requirePermission("CASH_MANAGE"), openCashSession);
route.post("/admin/finance/entry", requirePermission("CASH_MANAGE"), createCashEntry);
route.post("/admin/finance/close", requirePermission("CASH_MANAGE"), closeCashSession);

route.get("/admin/categories", requirePermission("CATALOG"), listCategories);
route.post("/admin/categories", requirePermission("CATALOG"), createCategory);
route.patch("/admin/categories/:id", requirePermission("CATALOG"), updateCategory);
route.delete("/admin/categories/:id", requirePermission("CATALOG"), deleteCategory);

route.get("/admin/products", requirePermission("CATALOG"), listProducts);
route.post("/admin/products", requirePermission("CATALOG"), createProduct);
route.post("/admin/uploads/image", requireAnyPermission(["CATALOG", "COUPONS", "SETTINGS"]), imageUpload.single("image"), uploadImage);
route.patch("/admin/products/:id", requirePermission("CATALOG"), updateProduct);
route.delete("/admin/products/:id", requirePermission("CATALOG"), deleteProduct);

route.get("/admin/complements", requirePermission("CATALOG"), listComplements);
route.post("/admin/complements", requirePermission("CATALOG"), createComplement);
route.patch("/admin/complements/:id", requirePermission("CATALOG"), updateComplement);
route.delete("/admin/complements/:id", requirePermission("CATALOG"), deleteComplement);

route.get("/admin/coupons", requirePermission("COUPONS"), listCoupons);
route.post("/admin/coupons", requirePermission("COUPONS"), createCoupon);
route.patch("/admin/coupons/:id", requirePermission("COUPONS"), updateCoupon);
route.delete("/admin/coupons/:id", requirePermission("COUPONS"), deleteCoupon);

route.patch("/admin/settings", requirePermission("SETTINGS"), updateSettings);
route.patch("/admin/store/pause", requirePermission("STORE_PAUSE"), updateSettings);
route.post("/admin/integrations/menuia/test", requirePermission("SETTINGS"), testMenuiaIntegration);
route.get("/admin/staff/roles", requirePermission("USERS"), listStaffRoles);
route.post("/admin/staff/roles", requirePermission("USERS"), createStaffRole);
route.patch("/admin/staff/roles/:id", requirePermission("USERS"), updateStaffRole);
route.delete("/admin/staff/roles/:id", requirePermission("USERS"), deleteStaffRole);
route.get("/admin/staff/users", requirePermission("USERS"), listStaffUsers);
route.post("/admin/staff/users", requirePermission("USERS"), createStaffUser);
route.patch("/admin/staff/users/:id", requirePermission("USERS"), updateStaffUser);
