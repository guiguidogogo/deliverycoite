import { Router } from "express";
import { login } from "../controllers/auth-controller.js";
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
  registerCustomer,
  loginCustomer,
  getCustomerProfile,
  updateCustomerProfile,
  addCustomerAddress,
  updateCustomerAddress,
  deleteCustomerAddress
} from "../controllers/customer-auth-controller.js";
import { deleteCustomer, listCustomers, lookupCustomer, updateCustomer } from "../controllers/customers-controller.js";
import { getDashboard } from "../controllers/dashboard-controller.js";
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
import { auth } from "../middlewares/auth.js";
import { customerAuth } from "../middlewares/customer-auth.js";
import { imageUpload } from "../utils/upload.js";

export const router = Router();

router.post("/auth/login", login);
// Customer auth routes
router.post("/customer/register", registerCustomer);
router.post("/customer/login", loginCustomer);
router.get("/customer/profile", customerAuth, getCustomerProfile);
router.patch("/customer/profile", customerAuth, updateCustomerProfile);
router.post("/customer/addresses", customerAuth, addCustomerAddress);
router.patch("/customer/addresses/:id", customerAuth, updateCustomerAddress);
router.delete("/customer/addresses/:id", customerAuth, deleteCustomerAddress);


router.get("/settings", getSettings);
router.get("/customers/lookup", lookupCustomer);
router.get("/categories", listCategories);
router.get("/products", listProducts);
router.get("/coupons/validate", validateCoupon);
router.post("/favorites/toggle", toggleFavorite);
router.post("/orders", createOrder);
router.get("/integrations/future", getFutureIntegrations);

router.use(auth(["ADMIN", "ATTENDANT"]));
router.get("/admin/orders", listOrders);
router.patch("/admin/orders/:id/status", updateOrderStatus);
router.patch("/admin/orders/:id/viewed", markOrderViewed);
router.patch("/admin/orders/:id/paid", markOrderPaid);
router.delete("/admin/orders/:id", deleteOrder);
router.post("/admin/orders/:id/send-delivery", sendToDelivery);
router.post("/admin/orders/:id/print", printOrderById);
router.get("/admin/printers", listPrinters);
router.get("/admin/dashboard", getDashboard);
router.get("/admin/notifications/new-orders", listNewOrders);
router.get("/admin/reports/orders.xlsx", exportOrdersExcel);
router.get("/admin/reports/orders.pdf", exportOrdersPdf);
router.get("/admin/customers", listCustomers);
router.patch("/admin/customers/:id", updateCustomer);
router.delete("/admin/customers/:id", deleteCustomer);
router.get("/admin/finance/summary", getFinanceSummary);
router.get("/admin/finance/sessions", listCashSessions);
router.post("/admin/finance/open", openCashSession);
router.post("/admin/finance/entry", createCashEntry);
router.post("/admin/finance/close", closeCashSession);

router.get("/admin/categories", listCategories);
router.post("/admin/categories", auth(["ADMIN"]), createCategory);
router.patch("/admin/categories/:id", auth(["ADMIN"]), updateCategory);
router.delete("/admin/categories/:id", auth(["ADMIN"]), deleteCategory);

router.get("/admin/products", listProducts);
router.post("/admin/products", auth(["ADMIN"]), createProduct);
router.post("/admin/uploads/image", auth(["ADMIN"]), imageUpload.single("image"), uploadImage);
router.patch("/admin/products/:id", auth(["ADMIN"]), updateProduct);
router.delete("/admin/products/:id", auth(["ADMIN"]), deleteProduct);

router.get("/admin/coupons", listCoupons);
router.post("/admin/coupons", auth(["ADMIN"]), createCoupon);
router.patch("/admin/coupons/:id", auth(["ADMIN"]), updateCoupon);
router.delete("/admin/coupons/:id", auth(["ADMIN"]), deleteCoupon);

router.patch("/admin/settings", auth(["ADMIN"]), updateSettings);
router.post("/admin/integrations/menuia/test", testMenuiaIntegration);
