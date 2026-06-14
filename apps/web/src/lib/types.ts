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
  complements: ProductComplement[];
};

export type Complement = {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl?: string | null;
  active: boolean;
};

export type ProductComplement = {
  id: string;
  complementId: string;
  required: boolean;
  sortOrder: number;
  complement: Complement;
};

export type SelectedComplement = {
  complement: Complement;
  quantity: number;
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
  id: string;
  product: Product;
  quantity: number;
  complements: SelectedComplement[];
};
