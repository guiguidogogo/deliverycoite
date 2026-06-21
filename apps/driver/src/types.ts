export type Driver = {
  id: string;
  name: string;
  phone: string;
  vehicle: string;
  licensePlate?: string | null;
  available: boolean;
  company: {
    tradeName: string;
    subdomain: string;
  };
};

export type RouteStatus = "CREATED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED";

export type DeliveryRoute = {
  id: string;
  status: RouteStatus;
  googleMapsUrl: string;
  navigationUrl?: string;
  routePlanUrl?: string;
  androidNavigationIntent?: string;
  createdAt: string;
  offerExpiresAt?: string | null;
  company: { tradeName: string; subdomain: string };
  orders: Array<{
    id: string;
    sequence: number;
    address: string;
    latitude?: number | null;
    longitude?: number | null;
    order: {
      id: string;
      orderNumber: number;
      status: string;
      customerNotes?: string | null;
      total: string | number;
      customer: {
        name: string;
        phone: string;
        address: string;
        number: string;
        district: string;
        complement?: string | null;
      };
      items: Array<{
        id: string;
        quantity: number;
        product: { name: string };
        complements: Array<{ id: string; name: string; quantity: number }>;
      }>;
    };
  }>;
};
