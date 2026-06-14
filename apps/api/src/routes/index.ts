import { Router, type RequestHandler } from "express";
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
  addCustomerAddress,
  updateCustomerAddress,
  deleteCustomerAddress
} from "../controllers/customer-auth-controller.js";
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
import { auth } from "../middlewares/auth.js";
import { customerAuth } from "../middlewares/customer-auth.js";
import { imageUpload } from "../utils/upload.js";
import { asyncHandler } from "../utils/async-handler.js";

export const router = Router();

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
// Customer auth routes
route.post("/customer/register", registerCustomer);
route.post("/customer/login", loginCustomer);
route.get("/customer/profile", customerAuth, getCustomerProfile);
route.patch("/customer/profile", customerAuth, updateCustomerProfile);
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

router.use(auth(["ADMIN", "ATTENDANT"]));
route.get("/admin/orders", listOrders);
route.patch("/admin/orders/:id/status", updateOrderStatus);
route.patch("/admin/orders/:id/viewed", markOrderViewed);
route.patch("/admin/orders/:id/paid", markOrderPaid);
route.delete("/admin/orders/:id", deleteOrder);
route.post("/admin/orders/:id/send-delivery", sendToDelivery);
route.post("/admin/orders/:id/print", printOrderById);
route.get("/admin/printers", listPrinters);
route.get("/admin/dashboard", getDashboard);
route.get("/admin/notifications/new-orders", listNewOrders);
route.get("/admin/reports/orders.xlsx", exportOrdersExcel);
route.get("/admin/reports/orders.pdf", exportOrdersPdf);
route.get("/admin/customers", listCustomers);
route.patch("/admin/customers/:id", updateCustomer);
route.delete("/admin/customers/:id", deleteCustomer);
route.get("/admin/finance/summary", getFinanceSummary);
route.get("/admin/finance/sessions", listCashSessions);
route.post("/admin/finance/open", openCashSession);
route.post("/admin/finance/entry", createCashEntry);
route.post("/admin/finance/close", closeCashSession);

route.get("/admin/categories", listCategories);
route.post("/admin/categories", auth(["ADMIN"]), createCategory);
route.patch("/admin/categories/:id", auth(["ADMIN"]), updateCategory);
route.delete("/admin/categories/:id", auth(["ADMIN"]), deleteCategory);

route.get("/admin/products", listProducts);
route.post("/admin/products", auth(["ADMIN"]), createProduct);
route.post("/admin/uploads/image", auth(["ADMIN"]), imageUpload.single("image"), uploadImage);
route.patch("/admin/products/:id", auth(["ADMIN"]), updateProduct);
route.delete("/admin/products/:id", auth(["ADMIN"]), deleteProduct);

route.get("/admin/complements", listComplements);
route.post("/admin/complements", auth(["ADMIN"]), createComplement);
route.patch("/admin/complements/:id", auth(["ADMIN"]), updateComplement);
route.delete("/admin/complements/:id", auth(["ADMIN"]), deleteComplement);

route.get("/admin/coupons", listCoupons);
route.post("/admin/coupons", auth(["ADMIN"]), createCoupon);
route.patch("/admin/coupons/:id", auth(["ADMIN"]), updateCoupon);
route.delete("/admin/coupons/:id", auth(["ADMIN"]), deleteCoupon);

route.patch("/admin/settings", auth(["ADMIN"]), updateSettings);
route.post("/admin/integrations/menuia/test", testMenuiaIntegration);
