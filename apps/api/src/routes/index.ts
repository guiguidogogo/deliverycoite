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
import {
  acceptDriverRoute,
  completeDriverRoute,
  declineDriverRoute,
  driverLogin,
  getDriverProfile,
  getDriverRoute,
  listDriverRoutes,
  markDriverOrderDelivered,
  registerDriverDevice,
  updateDriverAvailability,
  updateDriverLocation
} from "../controllers/driver-app-controller.js";
import { quoteDelivery } from "../controllers/delivery-controller.js";
import {
  createDeliveryRoute,
  createDriver,
  getDeliveryRoute,
  listDeliveryRoutes,
  listDrivers,
  listReadyDeliveryOrders,
  updateDeliveryRouteStatus,
  updateDriver
} from "../controllers/delivery-routes-controller.js";
import {
  closeCashSession,
  createCashEntry,
  createPayable,
  createReceivable,
  deleteCashEntry,
  getFinanceDashboard,
  getFinanceSummary,
  listAuditLogs,
  listCashSessions,
  listPayables,
  listReceivables,
  openCashSession,
  payPayable,
  receiveReceivable,
  reopenCashSession
} from "../controllers/finance-controller.js";
import { getFutureIntegrations, testMenuiaIntegration } from "../controllers/integrations-controller.js";
import { listNewOrders } from "../controllers/notifications-controller.js";
import {
  createOrder,
  listOrders,
  markOrderViewed,
  deleteOrder,
  markOrderPaid,
  getOrderPrintData,
  printOrderById,
  sendToDelivery,
  updateOrderStatus
} from "../controllers/orders-controller.js";
import { getPersistentImage, uploadImage, uploadPersistentImage } from "../controllers/upload-controller.js";
import {
  createProduct,
  deleteProduct,
  listProducts,
  toggleFavorite,
  updateProduct
} from "../controllers/products-controller.js";
import { exportFinanceExcel, exportFinancePdf, exportOrdersExcel, exportOrdersPdf } from "../controllers/reports-controller.js";
import { listPrinters } from "../controllers/printer-controller.js";
import { getSettings, updateSettings } from "../controllers/settings-controller.js";
import { listMarketplaceCompanies, marketplaceSummary } from "../controllers/marketplace-controller.js";
import { auth, requireAnyPermission, requirePermission, requireSuperAdmin } from "../middlewares/auth.js";
import { customerAuth } from "../middlewares/customer-auth.js";
import { driverAuth } from "../middlewares/driver-auth.js";
import { imageUpload, persistentImageUpload } from "../utils/upload.js";
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
route.get("/marketplace/assets/:id", getPersistentImage);
route.get("/marketplace/companies", listMarketplaceCompanies);
route.get("/marketplace/summary", marketplaceSummary);
route.get("/company", getPublicCompany);
route.post("/driver/auth/login", driverLogin);
route.get("/driver/me", driverAuth, getDriverProfile);
route.patch("/driver/availability", driverAuth, updateDriverAvailability);
route.patch("/driver/location", driverAuth, updateDriverLocation);
route.post("/driver/device-token", driverAuth, registerDriverDevice);
route.get("/driver/routes", driverAuth, listDriverRoutes);
route.get("/driver/routes/:id", driverAuth, getDriverRoute);
route.post("/driver/routes/:id/accept", driverAuth, acceptDriverRoute);
route.post("/driver/routes/:id/decline", driverAuth, declineDriverRoute);
route.post("/driver/routes/:id/complete", driverAuth, completeDriverRoute);
route.patch("/driver/routes/:routeId/orders/:orderId/delivered", driverAuth, markDriverOrderDelivered);
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
route.post("/admin/companies/upload", requireSuperAdmin, persistentImageUpload.single("image"), uploadPersistentImage);
route.get("/admin/companies", requireSuperAdmin, listCompanies);
route.post("/admin/companies", requireSuperAdmin, createCompany);
route.get("/admin/companies/:id", requireSuperAdmin, getCompany);
route.patch("/admin/companies/:id", requireSuperAdmin, updateCompany);
route.patch("/admin/companies/:id/status", requireSuperAdmin, updateCompanyStatus);
route.get("/admin/settings", requirePermission("SETTINGS"), getSettings);
route.patch("/admin/me", updateCurrentStaff);
route.patch("/admin/password", changeStaffPassword);
route.get("/admin/orders", requirePermission("ORDERS"), listOrders);
route.patch("/admin/orders/:id/status", requirePermission("ORDERS"), updateOrderStatus);
route.patch("/admin/orders/:id/viewed", requirePermission("ORDERS"), markOrderViewed);
route.patch("/admin/orders/:id/paid", requirePermission("ORDERS"), markOrderPaid);
route.delete("/admin/orders/:id", requirePermission("ORDERS"), deleteOrder);
route.post("/admin/orders/:id/send-delivery", requirePermission("ORDERS"), sendToDelivery);
route.post("/admin/orders/:id/print", requirePermission("ORDERS"), printOrderById);
route.get("/admin/orders/:id/print-data", requirePermission("ORDERS"), getOrderPrintData);
route.get("/admin/printers", requirePermission("SETTINGS"), listPrinters);
route.get("/admin/dashboard", requirePermission("ORDERS"), getDashboard);
route.get("/admin/notifications/new-orders", requirePermission("ORDERS"), listNewOrders);
route.get("/admin/deliveries/orders", requirePermission("ORDERS"), listReadyDeliveryOrders);
route.get("/admin/deliveries/drivers", requirePermission("ORDERS"), listDrivers);
route.post("/admin/deliveries/drivers", requirePermission("ORDERS"), createDriver);
route.patch("/admin/deliveries/drivers/:id", requirePermission("ORDERS"), updateDriver);
route.get("/admin/deliveries/routes", requirePermission("ORDERS"), listDeliveryRoutes);
route.post("/admin/deliveries/routes", requirePermission("ORDERS"), createDeliveryRoute);
route.get("/admin/deliveries/routes/:id", requirePermission("ORDERS"), getDeliveryRoute);
route.patch("/admin/deliveries/routes/:id/status", requirePermission("ORDERS"), updateDeliveryRouteStatus);
route.get("/admin/reports/orders.xlsx", requirePermission("REPORTS"), exportOrdersExcel);
route.get("/admin/reports/orders.pdf", requirePermission("REPORTS"), exportOrdersPdf);
route.get("/admin/reports/finance.xlsx", requirePermission("FINANCE_REPORTS"), exportFinanceExcel);
route.get("/admin/reports/finance.pdf", requirePermission("FINANCE_REPORTS"), exportFinancePdf);
route.get("/admin/customers", requirePermission("CUSTOMERS"), listCustomers);
route.patch("/admin/customers/:id", requirePermission("CUSTOMERS"), updateCustomer);
route.delete("/admin/customers/:id", requirePermission("CUSTOMERS"), deleteCustomer);
route.get("/admin/finance/summary", requireAnyPermission(["FINANCE", "CASH_MANAGE"]), getFinanceSummary);
route.get("/admin/finance/dashboard", requirePermission("FINANCE"), getFinanceDashboard);
route.get("/admin/finance/sessions", requireAnyPermission(["FINANCE", "CASH_MANAGE"]), listCashSessions);
route.get("/admin/finance/audit", requirePermission("AUDIT_VIEW"), listAuditLogs);
route.get("/admin/finance/payables", requirePermission("FINANCE"), listPayables);
route.post("/admin/finance/payables", requirePermission("ACCOUNTS_MANAGE"), createPayable);
route.post("/admin/finance/payables/:id/pay", requirePermission("ACCOUNTS_MANAGE"), payPayable);
route.get("/admin/finance/receivables", requirePermission("FINANCE"), listReceivables);
route.post("/admin/finance/receivables", requirePermission("ACCOUNTS_MANAGE"), createReceivable);
route.post("/admin/finance/receivables/:id/receive", requirePermission("ACCOUNTS_MANAGE"), receiveReceivable);
route.post("/admin/finance/open", requirePermission("CASH_MANAGE"), openCashSession);
route.post("/admin/finance/entry", requirePermission("CASH_MANAGE"), createCashEntry);
route.delete("/admin/finance/entry/:id", requirePermission("CASH_MANAGE"), deleteCashEntry);
route.post("/admin/finance/close", requirePermission("CASH_MANAGE"), closeCashSession);
route.post("/admin/finance/sessions/:id/reopen", requirePermission("CASH_REOPEN"), reopenCashSession);

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
