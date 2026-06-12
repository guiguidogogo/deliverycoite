export type Category = {
  id: string;
  name: string;
  slug: string;
};

export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  promoPrice?: number | null;
  imageUrl?: string | null;
  categoryId: string;
};

export type Settings = {
  companyName: string;
  logoUrl?: string | null;
  whatsappNumber: string;
  deliveryFee: number;
  pixKey?: string | null;
  pixQrCodeUrl?: string | null;
  darkModeEnabled: boolean;
};

export type CartItem = {
  product: Product;
  quantity: number;
};
