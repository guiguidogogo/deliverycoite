"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bike, Clock, Flame, Heart, Instagram, MapPin, MessageCircle, Minus, Moon, Plus, Search, ShoppingCart, Sparkles, Star, Store, Sun, Tag, User, X } from "lucide-react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, resolveAssetUrl } from "../lib/api";
import { money } from "../lib/format";
import type { CartItem, Category, Product, PublicCompany, SelectedComplement, Settings } from "../lib/types";
import { LocationPicker } from "./location-picker";
import { findAddressCoordinates, findAddressFromCoordinates } from "../lib/geocoding";

const checkoutSchema = z
  .object({
    name: z.string().min(2, "Nome obrigatorio"),
    phone: z.string().min(8, "Telefone obrigatorio"),
    email: z.string().email("Email invalido").optional().or(z.literal("")),
    fulfillmentType: z.enum(["DELIVERY", "PICKUP"]),
    address: z.string().optional(),
    number: z.string().optional(),
    district: z.string().optional(),
    complement: z.string().optional(),
    paymentMethod: z.enum(["CASH", "PIX", "CARD", "MERCADO_PAGO_PIX", "MERCADO_PAGO_CARD"]),
    needChange: z.boolean().optional(),
    changeFor: z.string().optional(),
    couponCode: z.string().optional(),
    notes: z.string().optional()
  })
  .superRefine((values, ctx) => {
    if (values.fulfillmentType === "DELIVERY") {
      if (!values.address || values.address.length < 3) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["address"], message: "Endereco obrigatorio" });
      }
      if (!values.number) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["number"], message: "Numero obrigatorio" });
      }
      if (!values.district || values.district.length < 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["district"], message: "Bairro obrigatorio" });
      }
    }
    if (values.paymentMethod === "CASH" && values.needChange && !values.changeFor) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["changeFor"], message: "Informe o troco" });
    }
    if (values.paymentMethod === "CASH" && values.needChange && values.changeFor && Number.isNaN(Number(values.changeFor))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["changeFor"], message: "Troco invalido" });
    }
  });

type CheckoutForm = z.infer<typeof checkoutSchema>;

type CheckoutPayload = {
  customer: {
    name: string;
    phone: string;
    email?: string;
    address: string;
    number: string;
    district: string;
    complement?: string;
    latitude?: number;
    longitude?: number;
  };
  fulfillmentType: "DELIVERY" | "PICKUP";
  source?: "DELIVERY" | "TABLE" | "TABLE_QR" | "COUNTER" | "WAITER";
  tableId?: string;
  tableSessionToken?: string;
  paymentMethod: "CASH" | "PIX" | "CARD" | "MERCADO_PAGO";
  changeFor?: number;
  couponCode?: string;
  notes?: string;
  items: Array<{
    productId: string;
    quantity: number;
    complements: Array<{ complementId: string; quantity: number }>;
  }>;
};

const initialForm: CheckoutForm = {
  name: "",
  phone: "",
  email: "",
  fulfillmentType: "DELIVERY",
  address: "",
  number: "",
  district: "",
  complement: "",
  paymentMethod: "PIX",
  needChange: false,
  changeFor: "",
  couponCode: "",
  notes: ""
};

function cartStorageKey(company?: PublicCompany | null) {
  return `delivery:cart:${company?.subdomain || "default"}`;
}

function clearStoredCart(company?: PublicCompany | null) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(cartStorageKey(company));
}

export function Storefront() {
  const pathname = usePathname();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [tableContext, setTableContext] = useState<{ id: string; number: number; name?: string | null; area?: { name: string } | null } | null>(null);
  const [tableSession, setTableSession] = useState<any>(null);
  const [tableSessionCode, setTableSessionCode] = useState("");
  const [tableSessionVerified, setTableSessionVerified] = useState(false);
  const [tableRequestName, setTableRequestName] = useState("");
  const [tableRequestPhone, setTableRequestPhone] = useState("");
  const [tableRequestEmail, setTableRequestEmail] = useState("");
  const [tableRequestPendingUrl, setTableRequestPendingUrl] = useState("");
  const [requestingTableSession, setRequestingTableSession] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [openCart, setOpenCart] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [dark, setDark] = useState(false);
  const [customer, setCustomer] = useState<any>(null);
  const [addresses, setAddresses] = useState<any[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string>("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponMessage, setCouponMessage] = useState("");
  const [configuringProduct, setConfiguringProduct] = useState<Product | null>(null);
  const [complementQuantities, setComplementQuantities] = useState<Record<string, number>>({});
  const [configuringQuantity, setConfiguringQuantity] = useState(1);
  const [deliveryLocation, setDeliveryLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [quotedDeliveryFee, setQuotedDeliveryFee] = useState<number | null>(null);
  const [deliveryDistanceKm, setDeliveryDistanceKm] = useState<number | null>(null);
  const [deliveryQuoteError, setDeliveryQuoteError] = useState("");
  const [addressMode, setAddressMode] = useState<"MANUAL" | "LOCATION">("MANUAL");
  const [locatingAddress, setLocatingAddress] = useState(false);
  const [updatingAddressFromMap, setUpdatingAddressFromMap] = useState(false);
  const cartLoadedRef = useRef(false);
  const tableAccountRef = useRef<HTMLElement | null>(null);
  const [mercadoPagoPix, setMercadoPagoPix] = useState<{
    orderId: string;
    qrCode: string | null;
    qrCodeBase64: string | null;
    ticketUrl: string | null;
    paid?: boolean;
    status?: string | null;
  } | null>(null);
  const skipNextManualSearchRef = useRef(false);
  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    formState: { errors, isSubmitting }
  } = useForm<CheckoutForm>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: initialForm
  });
  const paymentMethod = watch("paymentMethod");
  const fulfillmentType = watch("fulfillmentType");
  const needChange = watch("needChange");
  const couponCode = watch("couponCode") || "";
  const customerPhone = watch("phone") || "";
  const customerName = watch("name") || "";
  const typedAddress = watch("address") || "";
  const typedNumber = watch("number") || "";
  const typedDistrict = watch("district") || "";
  const tableNumber = useMemo(() => {
    const match = pathname?.match(/^\/mesa\/(\d+)/);
    return match ? Number(match[1]) : null;
  }, [pathname]);
  const tableSessionToken = useMemo(() => {
    const match = pathname?.match(/^\/mesa\/sessao\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [pathname]);
  const isTableMode = Boolean(tableSessionToken || tableContext);
  const tableOrderingBlocked = Boolean(tableSession && tableSession.status !== "OPEN");
  const tableSessionPending = tableSession?.status === "PENDING_CONFIRMATION";
  const tableAccountTotal = Number(tableSession?.account?.total ?? tableSession?.total ?? 0);
  const tableOrdersCount = Number(tableSession?.orders?.length ?? 0);

  useEffect(() => {
    let canceled = false;

    async function loadStorefront() {
      try {
        const tenantCompany = await api<PublicCompany>("/company");
        if (canceled) return;
        setCompany(tenantCompany);
        if (tableSessionToken) {
          const session = await api<any>(`/table-sessions/${tableSessionToken}`);
          if (canceled) return;
          setTableSession(session);
          setTableContext(session?.table ?? null);
          setTableSessionVerified(localStorage.getItem(`hubregional:table-session:${tableSessionToken}`) === "verified");
          const storedTableCustomer = localStorage.getItem(`hubregional:table-customer:${tableSessionToken}`);
          if (storedTableCustomer) {
            try {
              const parsed = JSON.parse(storedTableCustomer) as { name?: string; phone?: string; email?: string };
              if (parsed.name) setValue("name", parsed.name);
              if (parsed.phone) setValue("phone", parsed.phone);
              if (parsed.email) setValue("email", parsed.email);
            } catch {
              localStorage.removeItem(`hubregional:table-customer:${tableSessionToken}`);
            }
          }
          setValue("fulfillmentType", "PICKUP");
        } else if (tableNumber) {
          const table = await api<{ id: string; number: number; name?: string | null; area?: { name: string } | null }>(`/tables/${tableNumber}`);
          if (canceled) return;
          setTableContext(table);
          setValue("fulfillmentType", "PICKUP");
        } else {
          setTableContext(null);
          setTableSession(null);
        }
        document.documentElement.style.setProperty("--tenant-primary", tenantCompany.primaryColor);
        document.documentElement.style.setProperty("--tenant-secondary", tenantCompany.secondaryColor);
        if (tenantCompany.faviconUrl) {
          let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
          if (!favicon) {
            favicon = document.createElement("link");
            favicon.rel = "icon";
            document.head.appendChild(favicon);
          }
          favicon.href = resolveAssetUrl(tenantCompany.faviconUrl);
        }
        document.title = tenantCompany.tradeName;
      } catch {
        if (!canceled) setCompany(null);
      }

      try {
        const [categoryList, productList] = await Promise.all([
          api<Category[]>("/categories"),
          api<Product[]>("/products")
        ]);
        if (canceled) return;
        setCategories(categoryList.filter((item: any) => item.active !== false));
        setProducts(
          productList
            .filter((item: any) => item.active !== false && item.available !== false)
            .map((item: any) => ({
              ...item,
              price: Number(item.price),
              promoPrice: item.promoPrice ? Number(item.promoPrice) : null,
              complements: (item.complements ?? []).map((link: any) => ({
                ...link,
                complement: { ...link.complement, price: Number(link.complement.price) }
              }))
            }))
        );
      } catch (error) {
        if (canceled) return;
        setCategories([]);
        setProducts([]);
        toast.error(error instanceof Error ? error.message : "Nao foi possivel carregar o cardapio");
      }
    }

    void loadStorefront();

    return () => {
      canceled = true;
    };
  }, [setValue, tableNumber, tableSessionToken]);

  useEffect(() => {
    if (!tableSessionToken) return;
    const refresh = () => {
      void api<any>(`/table-sessions/${tableSessionToken}`)
        .then((session) => {
          setTableSession(session);
          setTableContext(session?.table ?? null);
        })
        .catch(() => undefined);
    };
    const timer = window.setInterval(refresh, 5000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [tableSessionToken]);

  useEffect(() => {

    api<Settings>("/settings")
      .then((s) => {
        setSettings({
          ...s,
          deliveryFee: Number((s as any).deliveryFee ?? 0),
          deliveryFeeTiers: ((s as any).deliveryFeeTiers ?? []).map((tier: any) => ({
            ...tier,
            fee: Number(tier.fee),
            maxDistanceKm: Number(tier.maxDistanceKm)
          }))
        });
      })
      .catch(() => {
        setSettings(null);
      });

    const stored = localStorage.getItem("delivery:favorites");
    if (stored) {
      setFavorites(JSON.parse(stored));
    }

    // Carregar dados do cliente se estiver logado
    const storedCustomer = localStorage.getItem("delivery:customer");
    const token = localStorage.getItem("delivery:customer-token");
    
    if (storedCustomer) {
      setCustomer(JSON.parse(storedCustomer));
    }

    if (token) {
      // Carregar endereços do cliente
      api<any>("/customer/profile", {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then((profile) => {
          setCustomer(profile);
          setAddresses(profile.addresses || []);
          
          // Preencher form com dados do cliente
          setValue("name", profile.name);
          setValue("phone", profile.phone);
          
          // Se tiver endereço padrão, preencher
          const defaultAddr = profile.addresses?.find((a: any) => a.isDefault);
          if (defaultAddr) {
            setValue("address", defaultAddr.address);
            setValue("number", defaultAddr.number);
            setValue("district", defaultAddr.district);
            setValue("complement", defaultAddr.complement || "");
            setSelectedAddress(defaultAddr.id);
            if (defaultAddr.latitude != null && defaultAddr.longitude != null) {
              setDeliveryLocation({
                latitude: defaultAddr.latitude,
                longitude: defaultAddr.longitude
              });
            }
          }
        })
        .catch(() => {
          // Token inválido, limpar
          localStorage.removeItem("delivery:customer-token");
          localStorage.removeItem("delivery:customer");
        });
    }
  }, [setValue]);

  useEffect(() => {
    localStorage.setItem("delivery:favorites", JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    if (!company || cartLoadedRef.current) return;
    cartLoadedRef.current = true;
    const stored = localStorage.getItem(cartStorageKey(company));
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setCart(parsed);
      }
    } catch {
      clearStoredCart(company);
    }
  }, [company]);

  useEffect(() => {
    if (!company || !cartLoadedRef.current) return;
    if (cart.length) {
      localStorage.setItem(cartStorageKey(company), JSON.stringify(cart));
    } else {
      clearStoredCart(company);
    }
  }, [cart, company]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    if (!company || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const mpStatus = params.get("mp_status");
    const orderId = params.get("order");
    if (!mpStatus || !orderId) return;

    let canceled = false;
    const cleanUrl = () => {
      const next = new URL(window.location.href);
      next.searchParams.delete("mp_status");
      next.searchParams.delete("order");
      window.history.replaceState({}, "", `${next.pathname}${next.search}${next.hash}`);
    };

    api<{
      paid: boolean;
      orderStatus: string;
      mercadoPagoStatus: string | null;
      mercadoPagoStatusDetail: string | null;
    }>(`/orders/${orderId}/mercadopago/status`)
      .then((status) => {
        if (canceled) return;
        if (status.paid) {
          setCart([]);
          clearStoredCart(company);
          setOpenCart(false);
          toast.success("Pagamento confirmado! Seu pedido foi recebido e esta indo para preparo.");
        } else if (mpStatus === "failure") {
          toast.error("Pagamento nao aprovado. Seu carrinho foi mantido para tentar novamente.");
        } else {
          toast.warning("Pagamento ainda nao confirmado. Aguarde alguns instantes ou consulte a loja.");
        }
      })
      .catch((error) => {
        if (!canceled) {
          toast.error(error instanceof Error ? error.message : "Nao foi possivel confirmar o pagamento");
        }
      })
      .finally(() => {
        if (!canceled) cleanUrl();
      });

    return () => {
      canceled = true;
    };
  }, [company]);

  useEffect(() => {
    if (!mercadoPagoPix || mercadoPagoPix.paid) return;

    const checkPayment = async () => {
      try {
        const status = await api<{
          paid: boolean;
          orderStatus: string;
          mercadoPagoStatus: string | null;
        }>(`/orders/${mercadoPagoPix.orderId}/mercadopago/status`);

        setMercadoPagoPix((current) =>
          current && current.orderId === mercadoPagoPix.orderId
            ? { ...current, paid: status.paid, status: status.mercadoPagoStatus }
            : current
        );

        if (status.paid) {
          toast.success("Pagamento confirmado! Seu pedido foi recebido pela loja.");
          setTimeout(() => {
            setMercadoPagoPix(null);
            setOpenCart(false);
            setCart([]);
            clearStoredCart(company);
            reset(initialForm);
          }, 1800);
        }
      } catch {
        // Mantem o QR Code aberto; a proxima consulta tenta novamente.
      }
    };

    void checkPayment();
    const timer = window.setInterval(() => void checkPayment(), 4000);
    return () => window.clearInterval(timer);
  }, [mercadoPagoPix?.orderId, mercadoPagoPix?.paid, company, reset]);

  useEffect(() => {
    if (fulfillmentType !== "DELIVERY" || !deliveryLocation) {
      setQuotedDeliveryFee(null);
      setDeliveryDistanceKm(null);
      setDeliveryQuoteError("");
      return;
    }

    const timer = window.setTimeout(() => {
      api<{ fee: number; distanceKm: number | null }>(
        `/delivery/quote?latitude=${deliveryLocation.latitude}&longitude=${deliveryLocation.longitude}`
      )
        .then((quote) => {
          setQuotedDeliveryFee(Number(quote.fee));
          setDeliveryDistanceKm(quote.distanceKm);
          setDeliveryQuoteError("");
        })
        .catch((error) => {
          setQuotedDeliveryFee(null);
          setDeliveryDistanceKm(null);
          setDeliveryQuoteError(error instanceof Error ? error.message : "Nao foi possivel calcular o frete");
        });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [deliveryLocation, fulfillmentType]);

  useEffect(() => {
    if (
      addressMode !== "MANUAL" ||
      typedAddress.trim().length < 3 ||
      !typedNumber.trim() ||
      typedDistrict.trim().length < 2
    ) {
      return;
    }
    if (skipNextManualSearchRef.current) {
      skipNextManualSearchRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      void findAddressCoordinates(typedAddress, typedNumber, typedDistrict)
        .then((location) => {
          setDeliveryLocation(location);
          setSelectedAddress("");
          setDeliveryQuoteError("");
        })
        .catch(() => {
          setDeliveryLocation(null);
          setDeliveryDistanceKm(null);
          setQuotedDeliveryFee(null);
        });
    }, 900);

    return () => window.clearTimeout(timer);
  }, [addressMode, typedAddress, typedNumber, typedDistrict]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return products.filter((product) => {
      const byCategory = selectedCategory === "all" || product.categoryId === selectedCategory;
      const categoryName = categories.find((category) => category.id === product.categoryId)?.name ?? "";
      const complementText = (product.complements ?? [])
        .map((link) => `${link.complement.name} ${link.complement.description}`)
        .join(" ");
      const promoText = product.promoPrice ? "promocao oferta desconto barato" : "";
      const byText = !term || [
        product.name,
        product.description,
        categoryName,
        complementText,
        promoText
      ].some((value) => value.toLowerCase().includes(term));
      return byCategory && byText;
    });
  }, [categories, products, query, selectedCategory]);

  const subtotal = cart.reduce((acc, item) => {
    const extras = item.complements.reduce(
      (sum, selected) => sum + selected.complement.price * selected.quantity,
      0
    );
    const unit = (item.product.promoPrice ?? item.product.price) + extras;
    return acc + unit * item.quantity;
  }, 0);
  const deliveryFee =
    cart.length === 0 || fulfillmentType === "PICKUP" || tableContext
      ? 0
      : settings?.deliveryFeeTiers?.length
        ? (quotedDeliveryFee ?? 0)
        : (settings?.deliveryFee ?? 0);
  const discount = couponDiscount;
  const total = subtotal + deliveryFee - discount;
  const promoProducts = useMemo(
    () => products.filter((product) => product.promoPrice && product.promoPrice < product.price).slice(0, 8),
    [products]
  );
  const bestSellers = useMemo(
    () => [...products].sort((a, b) => (b.complements?.length ?? 0) - (a.complements?.length ?? 0)).slice(0, 6),
    [products]
  );
  const newestProducts = useMemo(() => [...products].slice(0, 6), [products]);
  const selectedCategoryName = selectedCategory === "all"
    ? "Todos os produtos"
    : categories.find((category) => category.id === selectedCategory)?.name ?? "Categoria";
  const storeOpen = Boolean(company?.isOpen) && !settings?.ordersPaused;
  const productModalExtras = configuringProduct
    ? configuringProduct.complements
        .filter((link) => (complementQuantities[link.complementId] ?? 0) > 0)
        .reduce((sum, link) => sum + link.complement.price * (complementQuantities[link.complementId] ?? 0), 0)
    : 0;
  const productModalUnit = configuringProduct
    ? (configuringProduct.promoPrice ?? configuringProduct.price) + productModalExtras
    : 0;
  const productModalTotal = productModalUnit * configuringQuantity;

  async function applyCoupon() {
    if (!couponCode.trim()) {
      setCouponDiscount(0);
      setCouponMessage("");
      return;
    }

    try {
      const coupon = await api<{ discount: number; code: string }>(
        `/coupons/validate?code=${encodeURIComponent(couponCode)}&subtotal=${subtotal}&phone=${encodeURIComponent(customerPhone)}`
      );
      setCouponDiscount(Number(coupon.discount ?? 0));
      setCouponMessage(`Cupom ${coupon.code} aplicado`);
      toast.success("Cupom aplicado");
    } catch (error) {
      setCouponDiscount(0);
      setCouponMessage("");
      toast.error(error instanceof Error ? error.message : "Cupom invalido");
    }
  }

  function addConfiguredToCart(product: Product, complements: SelectedComplement[], quantity = 1) {
    const selectionKey = complements
      .map((item) => `${item.complement.id}:${item.quantity}`)
      .sort()
      .join("|");
    const itemId = `${product.id}:${selectionKey}`;

    setCart((prev) => {
      const found = prev.find((item) => item.id === itemId);
      if (found) {
        toast.success(`+${quantity} ${product.name} adicionado!`);
        return prev.map((item) => (item.id === itemId ? { ...item, quantity: item.quantity + quantity } : item));
      }
      toast.success(`${product.name} adicionado ao carrinho!`);
      return [...prev, { id: itemId, product, quantity, complements }];
    });
  }

  function beginProductConfiguration(product: Product) {
    const activeLinks = (product.complements ?? []).filter((link) => link.complement.active);
    setComplementQuantities(
      Object.fromEntries(
        activeLinks
          .filter((link) => link.required)
          .map((link) => [link.complementId, 1])
      )
    );
    setConfiguringQuantity(1);
    setConfiguringProduct(product);
  }

  function confirmProductConfiguration() {
    if (!configuringProduct) return;
    const selected = configuringProduct.complements
      .filter((link) => (complementQuantities[link.complementId] ?? 0) > 0)
      .map((link) => ({
        complement: link.complement,
        quantity: complementQuantities[link.complementId]
      }));
    const missing = configuringProduct.complements.find(
      (link) => link.required && !selected.some((item) => item.complement.id === link.complementId)
    );
    if (missing) {
      toast.error(`${missing.complement.name} e obrigatorio`);
      return;
    }
    addConfiguredToCart(configuringProduct, selected, configuringQuantity);
    setConfiguringProduct(null);
    setComplementQuantities({});
    setConfiguringQuantity(1);
  }

  function setItemQuantity(itemId: string, quantity: number) {
    if (quantity <= 0) {
      setCart((prev) => prev.filter((item) => item.id !== itemId));
      return;
    }
    setCart((prev) => prev.map((item) => (item.id === itemId ? { ...item, quantity } : item)));
  }

  function selectAddress(addressId: string) {
    const addr = addresses.find((a) => a.id === addressId);
    if (addr) {
      setValue("address", addr.address);
      setValue("number", addr.number);
      setValue("district", addr.district);
      setValue("complement", addr.complement || "");
      setSelectedAddress(addressId);
      setDeliveryLocation(
        addr.latitude != null && addr.longitude != null
          ? { latitude: addr.latitude, longitude: addr.longitude }
          : null
      );
    }
  }

  function locateDeliveryAddress() {
    if (!navigator.geolocation) {
      toast.error("Geolocalização não suportada");
      return;
    }

    toast.info("Obtendo sua localizacao...");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };
        setDeliveryLocation(location);
        setSelectedAddress("");

        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${location.latitude}&lon=${location.longitude}`
          );
          const data = await response.json();
          if (data.address) {
            setValue("address", data.address.road || data.address.pedestrian || "");
            setValue("number", data.address.house_number || "");
            setValue("district", data.address.suburb || data.address.neighbourhood || "");
          }
        } catch {
          // O mapa continua utilizável mesmo se o endereço textual não for encontrado.
        }
        toast.success("Confira o ponto no mapa");
      },
      () => toast.error("Nao foi possivel obter sua localizacao"),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  async function calculateManualAddress() {
    if (!typedAddress.trim() || !typedNumber.trim() || !typedDistrict.trim()) {
      toast.error("Preencha rua, numero e bairro");
      return;
    }

    setLocatingAddress(true);
    try {
      const location = await findAddressCoordinates(
        typedAddress,
        typedNumber,
        typedDistrict
      );
      setDeliveryLocation(location);
      setSelectedAddress("");
      toast.success("Endereco localizado. Confira o ponto no mapa.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Endereço não encontrado");
    } finally {
      setLocatingAddress(false);
    }
  }

  async function updateLocationAndAddress(location: { latitude: number; longitude: number }) {
    setDeliveryLocation(location);
    setSelectedAddress("");
    setUpdatingAddressFromMap(true);
    try {
      const located = await findAddressFromCoordinates(
        location.latitude,
        location.longitude
      );
      skipNextManualSearchRef.current = true;
      if (located.address) setValue("address", located.address, { shouldValidate: true });
      if (located.number) setValue("number", located.number, { shouldValidate: true });
      if (located.district) setValue("district", located.district, { shouldValidate: true });
    } catch {
      toast.warning("Ponto alterado. Confira o endereco digitado.");
    } finally {
      setUpdatingAddressFromMap(false);
    }
  }

  async function fillCustomerNameByPhone() {
    if (customer || customerName.trim() || customerPhone.replace(/\D/g, "").length < 8) return;

    try {
      const found = await api<{ name: string } | null>(
        `/customers/lookup?phone=${encodeURIComponent(customerPhone)}`
      );
      if (found?.name) {
        setValue("name", found.name, { shouldValidate: true });
      }
    } catch {
      // A consulta e apenas uma conveniencia; o checkout continua normalmente.
    }
  }

  async function callWaiter() {
    if (!tableContext) return;
    try {
      const response = await api<{ message: string }>(
        tableSessionToken ? `/table-sessions/${tableSessionToken}/call-waiter` : `/tables/${tableContext.number}/call-waiter`,
        { method: "POST" }
      );
      toast.success(response.message || "Garcom chamado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel chamar o garcom");
    }
  }

  async function requestBill() {
    if (!tableContext) return;
    try {
      const response = await api<{ message: string }>(
        tableSessionToken ? `/table-sessions/${tableSessionToken}/request-bill` : `/tables/${tableContext.number}/request-bill`,
        { method: "POST" }
      );
      if (tableSessionToken) {
        const refreshed = await api<any>(`/table-sessions/${tableSessionToken}`);
        setTableSession(refreshed);
      }
      toast.success(response.message || "Conta solicitada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel solicitar a conta");
    }
  }

  async function requestTableOpening() {
    if (!tableNumber || requestingTableSession) return;
    const cleanPhone = tableRequestPhone.replace(/\D/g, "");
    if (!tableRequestName.trim() || cleanPhone.length < 8 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tableRequestEmail.trim())) {
      toast.error("Informe nome, telefone e e-mail para solicitar a mesa");
      return;
    }
    setRequestingTableSession(true);
    try {
      const response = await api<{ status: string; sessionUrl: string; message?: string }>(`/tables/${tableNumber}/session-request`, {
        method: "POST",
        body: JSON.stringify({
          name: tableRequestName.trim(),
          phone: tableRequestPhone.trim(),
          email: tableRequestEmail.trim()
        })
      });
      setTableRequestPendingUrl(response.sessionUrl);
      toast.success(response.message || "Solicitacao enviada. Aguarde o garcom confirmar.");
      if (response.status === "OPEN" || response.status === "CLOSING_REQUESTED") {
        window.location.href = response.sessionUrl;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nao foi possivel solicitar a abertura da mesa");
    } finally {
      setRequestingTableSession(false);
    }
  }

  async function finishOrder(values: CheckoutForm) {
    if (!settings) return;
    if (!cart.length) {
      toast.error("Adicione itens antes de confirmar");
      return;
    }
    if (tableSessionToken && !tableSessionVerified) {
      toast.error("Confirme o codigo da mesa antes de pedir");
      return;
    }
    if (tableSessionToken) {
      const cleanPhone = values.phone.replace(/\D/g, "");
      const email = values.email?.trim() ?? "";
      if (!values.name.trim() || cleanPhone.length < 8 || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        toast.error("Informe nome, telefone e e-mail para acompanhar sua conta da mesa");
        return;
      }
    }
    if (tableOrderingBlocked) {
      toast.error(tableSession?.status === "CLOSING_REQUESTED" ? "Conta solicitada. Chame o garcom para incluir itens." : "Atendimento encerrado");
      return;
    }
    if (
      values.fulfillmentType === "DELIVERY" &&
      !tableContext &&
      settings.deliveryFeeTiers?.length &&
      (!deliveryLocation || quotedDeliveryFee === null)
    ) {
      toast.error(deliveryQuoteError || "Confirme sua localizacao para calcular o frete");
      return;
    }

    const payload: CheckoutPayload = {
      customer: {
        name: values.name,
        phone: values.phone,
        email: values.email || undefined,
        address: values.address || "",
        number: values.number || "",
        district: values.district || "",
        complement: values.complement || undefined,
        latitude: deliveryLocation?.latitude,
        longitude: deliveryLocation?.longitude
      },
      fulfillmentType: tableContext ? "PICKUP" : values.fulfillmentType,
      source: tableSessionToken ? "TABLE_QR" : tableContext ? "TABLE" : "DELIVERY",
      tableId: tableContext?.id,
      tableSessionToken: tableSessionToken ?? undefined,
      paymentMethod: values.paymentMethod === "MERCADO_PAGO_PIX" || values.paymentMethod === "MERCADO_PAGO_CARD" ? "MERCADO_PAGO" : values.paymentMethod,
      changeFor:
        values.paymentMethod === "CASH" && values.needChange && values.changeFor
          ? Number(values.changeFor)
          : undefined,
      couponCode: values.couponCode || undefined,
      notes: values.notes || undefined,
      items: cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        complements: item.complements.map((selected) => ({
          complementId: selected.complement.id,
          quantity: selected.quantity
        }))
      }))
    };

    try {
      const response = await api<{
        orderId: string;
        whatsappUrl: string | null;
        sentByServer?: boolean;
        sendError?: string | null;
      }>("/orders", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      if (tableSessionToken) {
        localStorage.setItem(
          `hubregional:table-customer:${tableSessionToken}`,
          JSON.stringify({ name: values.name, phone: values.phone, email: values.email || "" })
        );
      }

      if (values.paymentMethod === "MERCADO_PAGO_PIX") {
        const pix = await api<{
          qrCode: string | null;
          qrCodeBase64: string | null;
          ticketUrl: string | null;
          status: string | null;
        }>(`/orders/${response.orderId}/mercadopago/pix`, { method: "POST" });
        setMercadoPagoPix({
          orderId: response.orderId,
          qrCode: pix.qrCode,
          qrCodeBase64: pix.qrCodeBase64,
          ticketUrl: pix.ticketUrl,
          paid: false,
          status: pix.status ?? null
        });
        setCouponDiscount(0);
        setCouponMessage("");
        toast.success("Pedido criado. Pague o Pix para confirmar.");
        return;
      }

      if (values.paymentMethod === "MERCADO_PAGO_CARD") {
        const preference = await api<{ initPoint: string | null; sandboxInitPoint: string | null }>(
          `/orders/${response.orderId}/mercadopago/preference`,
          { method: "POST" }
        );
        const paymentUrl = preference.initPoint ?? preference.sandboxInitPoint;
        if (!paymentUrl) throw new Error("Mercado Pago nao retornou link de pagamento");
        toast.success("Pedido criado. Abrindo Mercado Pago...");
        window.location.href = paymentUrl;
        return;
      }

      setOpenCart(false);
      setCart([]);
      clearStoredCart(company);
      if (tableSessionToken) {
        const refreshed = await api<any>(`/table-sessions/${tableSessionToken}`);
        setTableSession(refreshed);
      }
      setCouponDiscount(0);
      setCouponMessage("");
      reset({
        ...initialForm,
        name: values.name,
        phone: values.phone,
        address: values.address || "",
        number: values.number || "",
        district: values.district || "",
        complement: values.complement || "",
        email: values.email || ""
      });
      toast.success("Pedido enviado com sucesso");

      if (response.whatsappUrl) {
        window.location.href = response.whatsappUrl;
      }

      if (response.sendError) {
        toast.warning(`Pedido criado, mas houve falha no envio automático: ${response.sendError}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao finalizar pedido");
    }
  }

  if (tableNumber && !tableSessionToken) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-4 py-8">
        <section className="overflow-hidden rounded-[2rem] border bg-white shadow-2xl shadow-orange-950/10 dark:border-white/10 dark:bg-slate-950">
          <div
            className="p-6 text-white"
            style={{ backgroundImage: "linear-gradient(135deg, var(--tenant-primary), #111827 72%)" }}
          >
            <div className="flex items-center gap-3">
              <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white shadow-xl">
                {company?.logoUrl ? (
                  <Image src={resolveAssetUrl(company.logoUrl)} alt={`Logo ${company.tradeName}`} width={56} height={56} className="h-full w-full object-contain p-1" unoptimized />
                ) : (
                  <Store className="text-slate-900" size={28} />
                )}
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-white/70">Mesa segura</p>
                <h1 className="font-display text-4xl leading-none">Mesa {tableNumber}</h1>
                <p className="mt-1 text-sm text-white/80">{company?.tradeName ?? settings?.companyName ?? "HubRegional"}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4 p-5">
            {tableRequestPendingUrl ? (
              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                <p className="text-xs font-black uppercase tracking-[0.2em]">Aguardando confirmacao</p>
                <h2 className="mt-1 text-2xl font-black">O garcom precisa liberar sua mesa</h2>
                <p className="mt-2 text-sm">
                  Sua solicitacao foi enviada. Quando o PDV confirmar, use o botao abaixo para acessar o cardapio seguro desta sessao.
                </p>
                <a className="mt-4 inline-flex w-full justify-center rounded-2xl bg-amber-500 px-4 py-3 font-black text-amber-950" href={tableRequestPendingUrl}>
                  Acompanhar liberacao da mesa
                </a>
              </div>
            ) : (
              <>
                <div className="rounded-3xl border border-red-100 bg-red-50 p-4 text-red-950">
                  <p className="font-black">Este QR fixo nao libera pedidos automaticamente.</p>
                  <p className="mt-1 text-sm">Para sua seguranca, a mesa so abre depois que o garcom/PDV confirmar que voce esta no restaurante.</p>
                </div>
                <div className="grid gap-2">
                  <input className="rounded-2xl border px-4 py-3 dark:bg-transparent" placeholder="Seu nome *" value={tableRequestName} onChange={(event) => setTableRequestName(event.target.value)} />
                  <input className="rounded-2xl border px-4 py-3 dark:bg-transparent" placeholder="Telefone/WhatsApp *" value={tableRequestPhone} onChange={(event) => setTableRequestPhone(event.target.value)} />
                  <input className="rounded-2xl border px-4 py-3 dark:bg-transparent" placeholder="E-mail *" value={tableRequestEmail} onChange={(event) => setTableRequestEmail(event.target.value)} />
                  <button className="rounded-2xl bg-emerald-600 px-4 py-4 font-black text-white disabled:opacity-60" disabled={requestingTableSession} onClick={() => void requestTableOpening()}>
                    {requestingTableSession ? "Enviando..." : "Solicitar abertura da mesa"}
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      </main>
    );
  }

  if (tableSessionPending) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-4 py-8">
        <section className="rounded-[2rem] border bg-white p-6 text-center shadow-2xl shadow-orange-950/10 dark:border-white/10 dark:bg-slate-950">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-600">Mesa {tableContext?.number ?? ""}</p>
          <h1 className="mt-2 font-display text-4xl leading-none">Aguardando liberacao</h1>
          <p className="mt-3 text-sm opacity-75">
            Sua solicitacao chegou no PDV. O cardapio sera liberado automaticamente quando o garcom confirmar a abertura da mesa.
          </p>
          <div className="mt-5 rounded-3xl bg-amber-50 p-4 text-left text-sm text-amber-950">
            <p><strong>Status:</strong> aguardando confirmacao</p>
            <p className="mt-1">Mantenha esta tela aberta. Ela atualiza sozinha.</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={`mx-auto w-full max-w-6xl px-3 pt-3 md:px-8 md:pt-6 ${isTableMode ? "pb-44" : "pb-28"}`}>
      <section className="reveal overflow-hidden rounded-[2rem] border border-white/60 bg-white/85 shadow-2xl shadow-orange-950/10 backdrop-blur dark:border-white/10 dark:bg-slate-950/80">
        <div
          className="relative min-h-[260px] overflow-hidden p-4 text-white md:p-7"
          style={
            settings?.promoBannerImageUrl
              ? {
                  backgroundImage: `linear-gradient(135deg, rgba(15,23,42,.92), rgba(15,23,42,.55)), url("${resolveAssetUrl(settings.promoBannerImageUrl)}")`,
                  backgroundPosition: "center",
                  backgroundSize: "cover"
                }
              : {
                  backgroundImage: "radial-gradient(circle at top right, var(--tenant-secondary), transparent 34%), linear-gradient(135deg, var(--tenant-primary), #111827 72%)"
                }
          }
        >
          <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
          <div className="relative z-10 flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white shadow-xl shadow-black/20">
                {company?.logoUrl ? (
                  <Image src={resolveAssetUrl(company.logoUrl)} alt={`Logo ${company.tradeName}`} width={64} height={64} className="h-full w-full object-contain p-1" unoptimized />
                ) : (
                  <Store className="text-slate-900" size={30} />
                )}
              </div>
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${storeOpen ? "bg-emerald-400 text-emerald-950" : "bg-red-400 text-red-950"}`}>
                    {storeOpen ? "Aberto agora" : "Fechado"}
                  </span>
                  {company?.category && <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold">{company.category}</span>}
                </div>
                <h1 className="font-display text-4xl leading-none tracking-wide md:text-6xl">
                  {isTableMode && tableContext ? `Mesa ${tableContext.number}` : company?.tradeName ?? settings?.companyName ?? "HubRegional"}
                </h1>
                <p className="mt-2 max-w-xl text-sm text-white/85 md:text-base">
                  {isTableMode
                    ? "Cardapio presencial: faca seus pedidos pelo celular e acompanhe sua conta em tempo real, sem chamar o garcom."
                    : settings?.promoBannerText || "Pe?a seus favoritos com uma experi?ncia r?pida, bonita e feita para delivery regional."}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {customer ? (
                <a href="/profile" className="rounded-full bg-white/15 px-3 py-2 text-sm font-bold backdrop-blur" title="Meu perfil">
                  <User size={18} className="inline sm:hidden" />
                  <span className="hidden sm:inline">Ol?, {customer.name.split(" ")[0]}</span>
                </a>
              ) : (
                <a href="/account" className="rounded-full bg-white px-3 py-2 text-sm font-black text-slate-900 shadow-lg">
                  Entrar
                </a>
              )}
              <button className="rounded-full bg-white/15 p-2 backdrop-blur" onClick={() => setDark((v) => !v)} aria-label="Alternar tema">
                {dark ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            </div>
          </div>

          {isTableMode ? (
            <div className="relative z-10 mt-6 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              <div className="rounded-2xl bg-white/14 p-3 backdrop-blur">
                <Store size={18} />
                <p className="mt-1 font-black">{tableContext ? `Mesa ${tableContext.number}` : "Mesa"}</p>
                <p className="text-xs text-white/75">atendimento</p>
              </div>
              <div className="rounded-2xl bg-white/14 p-3 backdrop-blur">
                <ShoppingCart size={18} />
                <p className="mt-1 font-black">{money(tableAccountTotal)}</p>
                <p className="text-xs text-white/75">conta atual</p>
              </div>
              <div className="rounded-2xl bg-white/14 p-3 backdrop-blur">
                <Clock size={18} />
                <p className="mt-1 font-black">{tableSession?.status === "CLOSING_REQUESTED" ? "Conta" : tableSession?.status === "CLOSED" ? "Encerrado" : "Aberto"}</p>
                <p className="text-xs text-white/75">status</p>
              </div>
              <div className="rounded-2xl bg-white/14 p-3 backdrop-blur">
                <User size={18} />
                <p className="mt-1 truncate font-black">{customerName || "Identifique-se"}</p>
                <p className="text-xs text-white/75">cliente</p>
              </div>
            </div>
          ) : (
            <div className="relative z-10 mt-6 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              <div className="rounded-2xl bg-white/14 p-3 backdrop-blur">
                <Clock size={18} />
                <p className="mt-1 font-black">{company?.deliveryTimeMin ?? 35} min</p>
                <p className="text-xs text-white/75">tempo m?dio</p>
              </div>
              <div className="rounded-2xl bg-white/14 p-3 backdrop-blur">
                <Bike size={18} />
                <p className="mt-1 font-black">{money(Number(company?.deliveryFee ?? settings?.deliveryFee ?? 0))}</p>
                <p className="text-xs text-white/75">taxa base</p>
              </div>
              <div className="rounded-2xl bg-white/14 p-3 backdrop-blur">
                <Star size={18} />
                <p className="mt-1 font-black">{Number(company?.rating ?? 5).toFixed(1)}</p>
                <p className="text-xs text-white/75">avalia??o</p>
              </div>
              <div className="rounded-2xl bg-white/14 p-3 backdrop-blur">
                <MapPin size={18} />
                <p className="mt-1 truncate font-black">{company?.city || "Sua cidade"}</p>
                <p className="text-xs text-white/75">atendimento local</p>
              </div>
            </div>
          )}

          <div className="relative z-10 mt-5 flex flex-wrap gap-2 text-sm">
            {!isTableMode && company?.whatsapp && (
              <a className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 font-black text-slate-900" href={`https://wa.me/55${company.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                <MessageCircle size={16} /> WhatsApp
              </a>
            )}
            {!isTableMode && company?.instagram && (
              <a className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 font-bold backdrop-blur" href={`https://instagram.com/${company.instagram.replace("@", "")}`} target="_blank" rel="noreferrer">
                <Instagram size={16} /> Instagram
              </a>
            )}
          </div>
        </div>

        {settings?.ordersPaused && (
          <div className="bg-red-600 p-3 text-center font-semibold text-white">
            {settings.ordersPausedReason || "Loja temporariamente pausada para novos pedidos"}
          </div>
        )}
        {tableContext && (
          <div className={`${tableOrderingBlocked ? "bg-amber-600" : "bg-emerald-600"} p-3 text-white`}>
            <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 text-center font-black sm:flex-row sm:text-left">
              <span>
                Atendimento na mesa {tableContext.number}
                {tableContext.name ? ` - ${tableContext.name}` : ""}
                {tableContext.area?.name ? ` (${tableContext.area.name})` : ""}
              </span>
              <div className="flex flex-wrap justify-center gap-2">
                {tableSession && (
                  <button
                    className="rounded-full bg-slate-950 px-4 py-2 text-sm font-black text-white"
                    onClick={() => tableAccountRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  >
                    Ver pedidos / conta
                  </button>
                )}
                <button className="rounded-full bg-white px-4 py-2 text-sm font-black text-emerald-700" onClick={() => void callWaiter()}>
                  Chamar garçom
                </button>
                <button className="rounded-full bg-amber-400 px-4 py-2 text-sm font-black text-amber-950" onClick={() => void requestBill()}>
                  Solicitar conta
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {tableSessionToken && tableSession && !tableSessionVerified && tableSession.status === "OPEN" && (
        <section className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-[2rem] bg-white p-6 text-slate-950 shadow-2xl">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-ember">Mesa segura</p>
            <h2 className="mt-1 font-display text-4xl">Confirme o codigo</h2>
            <p className="mt-2 text-sm opacity-75">
              Informe o codigo de 6 caracteres mostrado pelo garcom para liberar pedidos nesta mesa.
            </p>
            <input
              className="mt-4 w-full rounded-2xl border px-4 py-3 text-center text-2xl font-black uppercase tracking-[0.25em]"
              placeholder="A7K9P2"
              maxLength={6}
              value={tableSessionCode}
              onChange={(event) => setTableSessionCode(event.target.value.toUpperCase())}
            />
            <button
              className="mt-3 w-full rounded-2xl bg-emerald-600 px-4 py-3 font-black text-white"
              onClick={async () => {
                try {
                  await api(`/table-sessions/${tableSessionToken}/verify`, {
                    method: "POST",
                    body: JSON.stringify({ code: tableSessionCode })
                  });
                  localStorage.setItem(`hubregional:table-session:${tableSessionToken}`, "verified");
                  setTableSessionVerified(true);
                  toast.success("Mesa confirmada");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Codigo invalido");
                }
              }}
            >
              Liberar cardapio
            </button>
          </div>
        </section>
      )}

      {tableSession && (
        <section ref={tableAccountRef} id="conta-da-mesa" className="scroll-mt-24 mt-4 rounded-3xl border bg-white/85 p-4 shadow-lg shadow-orange-950/5 dark:bg-slate-950/80">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-ember">Conta da mesa</p>
              <h2 className="font-display text-3xl">Atendimento #{tableSession.id?.slice(-6)}</h2>
              <p className="text-sm opacity-70">
                {tableSession.status === "OPEN"
                  ? "Aberto para novos pedidos"
                  : tableSession.status === "CLOSING_REQUESTED"
                    ? "Fechamento solicitado"
                    : "Atendimento encerrado"}
              </p>
            </div>
            <strong className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">{money(tableAccountTotal)}</strong>
          </div>
          {tableSession.status !== "OPEN" && (
            <p className="mt-3 rounded-2xl bg-amber-100 p-3 text-sm font-bold text-amber-900">
              {tableSession.status === "CLOSING_REQUESTED"
                ? "Voce ainda pode visualizar a conta, mas novos pedidos estao bloqueados."
                : "Este QR Code foi encerrado. Peça ao garcom um novo atendimento."}
            </p>
          )}
          <div className="mt-3 space-y-2">
            {(tableSession.orders ?? []).length ? tableSession.orders.map((order: any) => (
              <div key={order.id} className="rounded-2xl bg-slate-50 p-3 dark:bg-white/5">
                <div className="flex justify-between gap-3">
                  <p className="font-black">Pedido #{String(order.orderNumber).padStart(5, "0")}</p>
                  <p className="font-black text-ember">{money(Number(order.total))}</p>
                </div>
                {(order.items ?? []).map((item: any) => (
                  <div key={item.id} className="mt-2 text-sm">
                    <p><strong>{item.quantity}x</strong> {item.product.name}</p>
                    {(item.complements ?? []).map((complement: any) => (
                      <p key={complement.id} className="ml-4 text-xs opacity-65">+ {complement.quantity}x {complement.name}</p>
                    ))}
                  </div>
                ))}
              </div>
            )) : (
              <p className="rounded-2xl border border-dashed p-4 text-sm opacity-70">Nenhum pedido enviado ainda.</p>
            )}
          </div>
          {tableSession.account && (
            <div className="mt-3 space-y-1 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-950">
              <div className="flex justify-between"><span>Subtotal</span><strong>{money(Number(tableSession.account.subtotal ?? 0))}</strong></div>
              <div className="flex justify-between"><span>Taxa de serviço</span><strong>{money(Number(tableSession.account.serviceFee ?? 0))}</strong></div>
              <div className="flex justify-between"><span>Desconto</span><strong>{money(Number(tableSession.account.discount ?? 0))}</strong></div>
              <div className="flex justify-between border-t border-emerald-200 pt-2 text-base"><span>Total</span><strong>{money(Number(tableSession.account.total ?? tableSession.total ?? 0))}</strong></div>
              <p className="text-xs opacity-70">Atualiza automaticamente a cada poucos segundos.</p>
            </div>
          )}
        </section>
      )}

      <section className="sticky top-0 z-30 -mx-3 mt-3 bg-[#fff7ed]/85 px-3 py-3 backdrop-blur dark:bg-slate-950/85 md:static md:mx-0 md:bg-transparent md:px-0 md:backdrop-blur-0">
        <div className="card-surface flex items-center gap-2 rounded-2xl px-4 py-3 shadow-lg shadow-orange-950/5">
          <Search size={18} className="opacity-60" />
          <input
            className="w-full bg-transparent text-sm outline-none"
            placeholder="Buscar produto, categoria, complemento ou promo??o..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          <button className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${selectedCategory === "all" ? "bg-ink text-white dark:bg-ember" : "card-surface"}`} onClick={() => setSelectedCategory("all")}>
            Todos
          </button>
          {categories.map((category) => (
            <button key={category.id} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${selectedCategory === category.id ? "bg-ink text-white dark:bg-ember" : "card-surface"}`} onClick={() => setSelectedCategory(category.id)}>
              {category.name}
            </button>
          ))}
        </div>
      </section>

      {!isTableMode && promoProducts.length > 0 && selectedCategory === "all" && !query && (
        <section className="mt-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-ember">Ofertas</p>
              <h2 className="font-display text-3xl">Promo??es do dia</h2>
            </div>
            <Tag className="text-ember" />
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {promoProducts.map((product) => (
              <button key={product.id} className="group w-64 shrink-0 overflow-hidden rounded-3xl bg-white text-left shadow-xl shadow-orange-950/10 transition hover:-translate-y-1 dark:bg-slate-900" onClick={() => beginProductConfiguration(product)}>
                <div className="relative h-36 bg-slate-200/40">
                  <Image src={resolveAssetUrl(product.imageUrl) || "https://images.unsplash.com/photo-1550547660-d9450f859349"} alt={product.name} fill className="object-cover" unoptimized />
                  <span className="absolute left-3 top-3 rounded-full bg-ember px-3 py-1 text-xs font-black text-white">Oferta</span>
                </div>
                <div className="p-4">
                  <h3 className="line-clamp-1 font-black">{product.name}</h3>
                  <p className="mt-1 line-clamp-2 text-sm opacity-65">{product.description}</p>
                  <div className="mt-3 flex items-end gap-2">
                    <strong className="text-xl text-ember">{money(product.promoPrice ?? product.price)}</strong>
                    <span className="text-xs opacity-50 line-through">{money(product.price)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {!isTableMode && bestSellers.length > 0 && selectedCategory === "all" && !query && (
        <section className="mt-5">
          <div className="mb-3 flex items-center gap-2">
            <Flame className="text-ember" />
            <h2 className="font-display text-3xl">Mais vendidos</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {bestSellers.slice(0, 3).map((product, index) => (
              <button key={product.id} className="card-surface flex items-center gap-3 p-3 text-left transition hover:-translate-y-0.5" onClick={() => beginProductConfiguration(product)}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ember font-black text-white">{index + 1}</span>
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-black/5">
                  <Image src={resolveAssetUrl(product.imageUrl) || "https://images.unsplash.com/photo-1550547660-d9450f859349"} alt={product.name} fill className="object-cover" unoptimized />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-black">{product.name}</p>
                  <p className="text-sm text-ember">{money(product.promoPrice ?? product.price)}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {!isTableMode && newestProducts.length > 0 && selectedCategory === "all" && !query && (
        <section className="mt-5">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="text-emerald-600" />
            <h2 className="font-display text-3xl">Novidades</h2>
          </div>
          <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
            {newestProducts.map((product) => (
              <button
                key={product.id}
                className="card-surface w-64 shrink-0 overflow-hidden text-left transition hover:-translate-y-0.5"
                onClick={() => beginProductConfiguration(product)}
              >
                <div className="relative h-28 bg-black/5">
                  <Image
                    src={resolveAssetUrl(product.imageUrl) || "https://images.unsplash.com/photo-1550547660-d9450f859349"}
                    alt={product.name}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                  <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2 py-1 text-[11px] font-black text-slate-900 shadow">
                    Novo
                  </span>
                </div>
                <div className="p-3">
                  <p className="line-clamp-1 font-black">{product.name}</p>
                  <p className="mt-1 line-clamp-2 text-xs opacity-65">{product.description}</p>
                  <p className="mt-2 font-black text-ember">{money(product.promoPrice ?? product.price)}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="mt-4">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] opacity-60">Card?pio</p>
            <h2 className="font-display text-3xl">{selectedCategoryName}</h2>
          </div>
          <span className="rounded-full bg-black/5 px-3 py-1 text-sm font-bold dark:bg-white/10">{filtered.length} itens</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((product, index) => {
            const unit = product.promoPrice ?? product.price;
            const hasPromo = Boolean(product.promoPrice && product.promoPrice < product.price);
            return (
              <article key={product.id} className="card-surface reveal group overflow-hidden transition duration-200 hover:-translate-y-1 hover:shadow-2xl" style={{ animationDelay: `${index * 45}ms` }}>
                <button className="block w-full text-left" onClick={() => beginProductConfiguration(product)}>
                  <div className="relative h-44 w-full bg-slate-200/40">
                    <Image src={resolveAssetUrl(product.imageUrl) || "https://images.unsplash.com/photo-1550547660-d9450f859349"} alt={product.name} fill className="object-cover transition duration-300 group-hover:scale-105" sizes="(max-width: 768px) 100vw, 33vw" unoptimized />
                    {hasPromo && <span className="absolute left-3 top-3 rounded-full bg-ember px-3 py-1 text-xs font-black text-white">Promo</span>}
                  </div>
                </button>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <button className="min-w-0 text-left" onClick={() => beginProductConfiguration(product)}>
                      <h3 className="line-clamp-1 text-lg font-black leading-tight">{product.name}</h3>
                      <p className="mt-1 line-clamp-2 text-sm opacity-70">{product.description}</p>
                    </button>
                    <button
                      onClick={() => {
                        setFavorites((prev) => prev.includes(product.id) ? prev.filter((id) => id !== product.id) : [...prev, product.id]);
                        void api("/favorites/toggle", { method: "POST", body: JSON.stringify({ phone: customerPhone || "guest", productId: product.id }) }).catch(() => undefined);
                      }}
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${favorites.includes(product.id) ? "bg-ember text-white" : "bg-black/5 dark:bg-white/10"}`}
                      aria-label="Favoritar"
                    >
                      <Heart size={16} fill={favorites.includes(product.id) ? "currentColor" : "none"} />
                    </button>
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      {hasPromo && <p className="text-xs opacity-50 line-through">{money(product.price)}</p>}
                      <p className="text-xl font-black text-ember">{money(unit)}</p>
                    </div>
                    <button className="inline-flex items-center gap-1 rounded-2xl bg-ink px-4 py-2 text-sm font-black text-white dark:bg-ember" onClick={() => beginProductConfiguration(product)}>
                      <Plus size={16} /> {product.complements?.length ? "Montar" : "Adicionar"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {!filtered.length && (
          <div className="card-surface mt-4 p-8 text-center">
            <p className="font-display text-3xl">Nada encontrado</p>
            <p className="mt-1 text-sm opacity-70">Tente buscar por outro produto, categoria ou promo??o.</p>
          </div>
        )}
      </section>

      {!isTableMode && (
        <section className="mt-6 grid gap-3 md:grid-cols-3">
          <div className="card-surface p-4">
            <p className="text-xs font-black uppercase tracking-wide text-ember">CRM futuro</p>
            <h3 className="mt-1 font-black">Clientes e fidelidade</h3>
            <p className="mt-1 text-sm opacity-70">Estrutura visual preparada para hist?rico, frequ?ncia, cupons e campanhas.</p>
          </div>
          <div className="card-surface p-4">
            <p className="text-xs font-black uppercase tracking-wide text-emerald-600">Compras</p>
            <h3 className="mt-1 font-black">?ltima compra e total gasto</h3>
            <p className="mt-1 text-sm opacity-70">Base para relacionamento por loja sem misturar clientes entre empresas.</p>
          </div>
          <div className="card-surface p-4">
            <p className="text-xs font-black uppercase tracking-wide text-blue-600">Marketing</p>
            <h3 className="mt-1 font-black">Recupera??o e campanhas</h3>
            <p className="mt-1 text-sm opacity-70">Pronto para segmentar clientes inativos e ofertas regionais.</p>
          </div>
        </section>
      )}

      {isTableMode && tableSession && (
        <button
          className="fixed bottom-20 left-1/2 z-20 flex w-[calc(100%-1rem)] max-w-xl -translate-x-1/2 items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-left shadow-2xl shadow-emerald-950/15 dark:border-emerald-500/30 dark:bg-slate-950"
          onClick={() => tableAccountRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          <span className="min-w-0">
            <span className="block text-xs font-black uppercase tracking-[0.18em] text-emerald-600">Conta atual</span>
            <span className="block truncate text-sm font-bold opacity-70">
              {tableOrdersCount ? `${tableOrdersCount} pedido(s) na mesa` : "Nenhum pedido enviado ainda"}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <strong className="block text-lg text-ember">{money(tableAccountTotal)}</strong>
            <span className="text-xs font-black text-ink dark:text-white">Ver pedidos</span>
          </span>
        </button>
      )}

      <button
        className="fixed bottom-4 left-1/2 z-20 flex w-[calc(100%-1rem)] max-w-xl -translate-x-1/2 flex-wrap items-center justify-between gap-2 rounded-2xl bg-ink px-4 py-3 text-white shadow-2xl dark:bg-ember"
        onClick={() => setOpenCart((v) => !v)}
      >
        <span className="flex min-w-0 items-center gap-2 text-sm sm:text-base">
          <ShoppingCart size={18} />
          <span className="truncate">{cart.length} item(ns)</span>
        </span>
        <strong className="text-sm sm:text-base">{money(total)}</strong>
      </button>

      {openCart && (
        <section className="fixed inset-0 z-50 bg-black/45 p-3 md:flex md:items-center md:justify-center" onClick={() => setOpenCart(false)}>
          <div className="card-surface mx-auto mt-8 max-h-[90vh] w-full max-w-xl overflow-y-auto p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-ember">Sacola</p>
                <h2 className="font-display text-4xl leading-none">Seu pedido</h2>
                <p className="mt-1 text-sm opacity-65">Confira os itens, endereço, cupom e pagamento antes de finalizar.</p>
              </div>
              <button
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/5 dark:bg-white/10"
                onClick={() => setOpenCart(false)}
                aria-label="Fechar sacola"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-3 space-y-2">
              {!cart.length && (
                <div className="rounded-2xl border border-dashed border-black/10 p-6 text-center dark:border-white/10">
                  <ShoppingCart className="mx-auto opacity-35" size={34} />
                  <p className="mt-2 font-black">Sua sacola está vazia</p>
                  <p className="mt-1 text-sm opacity-65">Escolha um produto do cardápio para começar.</p>
                </div>
              )}
              {cart.map((item) => {
                const extras = item.complements.reduce(
                  (sum, selected) => sum + selected.complement.price * selected.quantity,
                  0
                );
                return (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white/70 p-3 shadow-sm dark:border-white/10 dark:bg-white/5">
                  <div className="min-w-0">
                    <p className="line-clamp-1 font-black">{item.product.name}</p>
                    {item.complements.map((selected) => (
                      <p key={selected.complement.id} className="text-xs opacity-65">
                        + {selected.quantity}x {selected.complement.name}
                      </p>
                    ))}
                    <p className="mt-1 text-sm font-bold text-ember">{money(((item.product.promoPrice ?? item.product.price) + extras) * item.quantity)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 rounded-full bg-black/5 p-1 dark:bg-white/10">
                    <button className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm dark:bg-slate-900" onClick={() => setItemQuantity(item.id, item.quantity - 1)}>
                      <Minus size={14} />
                    </button>
                    <span className="min-w-6 text-center font-black">{item.quantity}</span>
                    <button className="grid h-8 w-8 place-items-center rounded-full bg-ink text-white dark:bg-ember" onClick={() => setItemQuantity(item.id, item.quantity + 1)}>
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              )})}
            </div>

            {fulfillmentType === "DELIVERY" && addresses.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-sm font-semibold">Meus Endereços:</p>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {addresses.map((addr: any) => (
                    <button
                      key={addr.id}
                      type="button"
                      onClick={() => selectAddress(addr.id)}
                      className={`rounded-xl border p-2 text-left text-xs ${
                        selectedAddress === addr.id
                          ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20"
                          : "border-black/10 dark:border-white/10"
                      }`}
                    >
                      <p className="font-semibold">{addr.label}</p>
                      <p className="opacity-70">
                        {addr.address}, {addr.number} - {addr.district}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
              <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Nome completo *" {...register("name")} />
              <input
                className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20"
                placeholder="Telefone *"
                {...register("phone", { onBlur: () => void fillCustomerNameByPhone() })}
              />
              <input
                className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20 md:col-span-2"
                placeholder={tableContext ? "E-mail para acompanhar sua conta *" : "E-mail (opcional)"}
                {...register("email")}
              />

              {tableContext ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3 font-bold text-emerald-800 md:col-span-2">
                  Pedido para consumo na mesa {tableContext.number}. Seus dados ficam salvos neste celular para acompanhar a conta e pedir mais itens.
                </div>
              ) : (
                <label className="md:col-span-2">
                  <span className="mb-1 block text-xs font-semibold">Como deseja receber?</span>
                  <select className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" {...register("fulfillmentType")}>
                    <option value="DELIVERY">Entrega no endereco</option>
                    <option value="PICKUP">Retirada na loja (sem frete)</option>
                  </select>
                </label>
              )}

              {fulfillmentType === "DELIVERY" && !tableContext && (
                <>
                  <div className="grid grid-cols-2 gap-2 md:col-span-2">
                    <button
                      type="button"
                      className={`rounded-xl px-3 py-2 font-semibold ${
                        addressMode === "MANUAL"
                          ? "bg-ink text-white dark:bg-ember"
                          : "border border-black/10 dark:border-white/20"
                      }`}
                      onClick={() => setAddressMode("MANUAL")}
                    >
                      Digitar endereco
                    </button>
                    <button
                      type="button"
                      className={`rounded-xl px-3 py-2 font-semibold ${
                        addressMode === "LOCATION"
                          ? "bg-ink text-white dark:bg-ember"
                          : "border border-black/10 dark:border-white/20"
                      }`}
                      onClick={() => {
                        setAddressMode("LOCATION");
                        locateDeliveryAddress();
                      }}
                    >
                      Usar localizacao
                    </button>
                  </div>
                  <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Endereco *" {...register("address")} />
                  <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Numero *" {...register("number")} />
                  <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Bairro *" {...register("district")} />
                  <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Complemento" {...register("complement")} />
                  <div className="md:col-span-2">
                    {addressMode === "MANUAL" && (
                      <button
                        type="button"
                        className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-white disabled:opacity-60"
                        onClick={() => void calculateManualAddress()}
                        disabled={locatingAddress}
                      >
                        <MapPin size={16} />
                        {locatingAddress ? "Localizando..." : "Calcular frete deste endereco"}
                      </button>
                    )}
                    {deliveryLocation && (
                      <LocationPicker
                        value={deliveryLocation}
                        onChange={(location) => void updateLocationAndAddress(location)}
                      />
                    )}
                    {updatingAddressFromMap && (
                      <p className="mt-1 text-xs opacity-65">Atualizando endereco pelo mapa...</p>
                    )}
                    {deliveryDistanceKm !== null && !deliveryQuoteError && (
                      <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                        Distancia aproximada: {deliveryDistanceKm.toFixed(2)} km
                      </p>
                    )}
                    {deliveryQuoteError && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {deliveryQuoteError}
                      </p>
                    )}
                  </div>
                </>
              )}

              <select
                className={`rounded-xl border px-3 py-2 font-semibold dark:border-white/20 ${
                  paymentMethod === "MERCADO_PAGO_PIX" || paymentMethod === "MERCADO_PAGO_CARD"
                    ? "border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-200"
                    : "border-black/10 bg-transparent"
                }`}
                {...register("paymentMethod")}
              >
                <option value="CASH">Dinheiro</option>
                <option value="PIX">PIX</option>
                <option value="CARD">Cartao</option>
                {settings?.mercadoPagoEnabled && settings.mercadoPagoPublicKey && (
                  <>
                    <option className="font-bold text-blue-700" value="MERCADO_PAGO_PIX">Pix Mercado Pago</option>
                    <option className="font-bold text-blue-700" value="MERCADO_PAGO_CARD">Cartao Mercado Pago</option>
                  </>
                )}
              </select>

              {paymentMethod === "CASH" ? (
                <label className="flex items-center gap-2 rounded-xl border border-black/10 px-3 py-2 dark:border-white/20">
                  <input type="checkbox" {...register("needChange")} />
                  Precisa de troco?
                </label>
              ) : (
                <div />
              )}

              {paymentMethod === "CASH" && needChange ? (
                <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Troco para quanto?" {...register("changeFor")} />
              ) : (
                <div />
              )}

              <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Cupom" {...register("couponCode")} />
              <button type="button" className="rounded-xl bg-ink px-3 py-2 text-white" onClick={() => void applyCoupon()}>
                Validar cupom
              </button>
              <textarea className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20 md:col-span-2" placeholder="Observacao do pedido (ex: sem salada, com maionese)" {...register("notes")} />
            </div>

            {couponMessage && <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{couponMessage}</p>}

            {!!Object.keys(errors).length && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">Preencha corretamente os campos obrigatorios.</p>
            )}

            {paymentMethod === "PIX" && settings?.pixQrCodeUrl && (
              <div className="mt-4 rounded-xl border border-dashed border-emerald-500/60 p-3 text-sm">
                <p className="font-semibold">Pague com PIX</p>
                <p>Chave: {settings.pixKey || "Configure no painel"}</p>
                <a className="underline" href={settings.pixQrCodeUrl} target="_blank" rel="noreferrer">
                  Abrir QR Code
                </a>
              </div>
            )}

            {(paymentMethod === "MERCADO_PAGO_PIX" || paymentMethod === "MERCADO_PAGO_CARD") && (
              <div className="mt-4 rounded-2xl border-2 border-blue-500 bg-blue-600 p-4 text-sm text-white shadow-lg shadow-blue-500/20">
                <p className="text-base font-black">
                  {paymentMethod === "MERCADO_PAGO_PIX" ? "Pix Mercado Pago" : "Cartao Mercado Pago"}
                </p>
                {paymentMethod === "MERCADO_PAGO_PIX" ? (
                  <>
                    <p className="mt-1 opacity-95">Ao confirmar, o QR Code e o copia-e-cola Pix aparecem aqui mesmo na loja.</p>
                    <p className="mt-2 rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold">Pague o Pix para a loja confirmar seu pedido mais rapido.</p>
                  </>
                ) : (
                  <>
                    <p className="mt-1 opacity-95">Nesta primeira etapa, o cartao ainda abre a tela segura do Mercado Pago.</p>
                    <p className="mt-2 rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold">Na proxima etapa vamos colocar o formulario de cartao dentro da loja com tokenizacao segura.</p>
                  </>
                )}
              </div>
            )}

            <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm dark:bg-white/5">
              <div className="mb-3 flex items-center gap-2">
                <Tag size={16} className="text-ember" />
                <p className="font-black">Resumo do pedido</p>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between gap-3">
                  <span className="opacity-70">Subtotal</span>
                  <strong>{money(subtotal)}</strong>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="opacity-70">{tableContext ? `Mesa ${tableContext.number}` : fulfillmentType === "PICKUP" ? "Retirada" : "Taxa de entrega"}</span>
                  <strong>{tableContext || fulfillmentType === "PICKUP" ? "Grátis" : money(deliveryFee)}</strong>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="opacity-70">Desconto</span>
                  <strong className={discount > 0 ? "text-emerald-600" : ""}>{money(discount)}</strong>
                </div>
                <div className="border-t border-black/10 pt-3 dark:border-white/10">
                  <div className="flex items-end justify-between gap-3">
                    <span className="font-black">Total</span>
                    <strong className="text-2xl text-ember">{money(total)}</strong>
                  </div>
                </div>
              </div>
            </div>

            <button
              className="mt-4 w-full rounded-2xl bg-ember px-4 py-4 text-lg font-black text-white shadow-xl shadow-orange-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting || settings?.ordersPaused}
              onClick={() => void handleSubmit(finishOrder)()}
            >
              {settings?.ordersPaused ? "Loja pausada" : isSubmitting ? "Enviando pedido..." : "Confirmar Pedido"}
            </button>
          </div>
        </section>
      )}

      {mercadoPagoPix && (
        <section className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 text-slate-900 shadow-2xl">
            <div className="rounded-2xl bg-blue-600 p-4 text-white">
              <p className="text-sm font-bold uppercase tracking-wide opacity-90">Mercado Pago</p>
              <h2 className="mt-1 text-2xl font-black">
                {mercadoPagoPix.paid ? "Pagamento confirmado" : "Pague com Pix"}
              </h2>
              <p className="mt-1 text-sm opacity-95">
                {mercadoPagoPix.paid
                  ? "Recebemos a confirmacao. Acompanhe o preparo do seu pedido."
                  : "Escaneie o QR Code ou copie o codigo Pix abaixo. A confirmacao atualiza automaticamente."}
              </p>
            </div>

            {!mercadoPagoPix.paid && (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-semibold text-amber-800">
                Aguardando pagamento... Nao feche esta tela ate confirmar.
              </div>
            )}

            {mercadoPagoPix.paid && (
              <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm font-bold text-emerald-700">
                Pago! Seu pedido foi enviado para a loja.
              </div>
            )}

            {!mercadoPagoPix.paid && mercadoPagoPix.qrCodeBase64 ? (
              <img
                className="mx-auto mt-4 h-56 w-56 rounded-2xl border object-contain p-2"
                src={`data:image/png;base64,${mercadoPagoPix.qrCodeBase64}`}
                alt="QR Code Pix Mercado Pago"
              />
            ) : !mercadoPagoPix.paid ? (
              <div className="mt-4 rounded-2xl border border-dashed p-5 text-center text-sm text-slate-500">
                QR Code indisponivel. Use o copia-e-cola abaixo.
              </div>
            ) : null}

            {!mercadoPagoPix.paid && mercadoPagoPix.qrCode && (
              <div className="mt-4">
                <p className="mb-1 text-xs font-bold uppercase text-slate-500">Pix copia e cola</p>
                <textarea
                  className="h-24 w-full rounded-2xl border bg-slate-50 p-3 text-xs"
                  readOnly
                  value={mercadoPagoPix.qrCode}
                />
                <button
                  type="button"
                  className="mt-2 w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white"
                  onClick={() => {
                    void navigator.clipboard.writeText(mercadoPagoPix.qrCode ?? "");
                    toast.success("Codigo Pix copiado");
                  }}
                >
                  Copiar codigo Pix
                </button>
              </div>
            )}

            {!mercadoPagoPix.paid && mercadoPagoPix.ticketUrl && (
              <a
                className="mt-2 block rounded-xl border border-blue-200 px-4 py-3 text-center font-semibold text-blue-700"
                href={mercadoPagoPix.ticketUrl}
                target="_blank"
                rel="noreferrer"
              >
                Abrir no Mercado Pago
              </a>
            )}

            <button
              type="button"
              className="mt-3 w-full rounded-xl border px-4 py-3 font-semibold"
              onClick={() => {
                setMercadoPagoPix(null);
                setOpenCart(false);
              }}
            >
              Fechar
            </button>
          </div>
        </section>
      )}

      {configuringProduct && (
        <section className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 md:items-center md:p-4" onClick={() => setConfiguringProduct(null)}>
          <div className="relative max-h-[94vh] w-full max-w-2xl overflow-hidden rounded-t-[2rem] bg-white text-slate-950 shadow-2xl dark:bg-slate-950 dark:text-white md:rounded-[2rem]" onClick={(event) => event.stopPropagation()}>
            <div className="relative h-64 bg-slate-200 md:h-72">
              <Image
                src={resolveAssetUrl(configuringProduct.imageUrl) || "https://images.unsplash.com/photo-1550547660-d9450f859349"}
                alt={configuringProduct.name}
                fill
                unoptimized
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-black/25" />
              <button className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/90 text-slate-900 shadow-lg" onClick={() => setConfiguringProduct(null)} aria-label="Fechar produto">
                <X size={18} />
              </button>
              {configuringProduct.promoPrice && configuringProduct.promoPrice < configuringProduct.price && (
                <span className="absolute left-4 top-4 rounded-full bg-ember px-3 py-1 text-xs font-black text-white shadow-lg">Promo??o</span>
              )}
              <div className="absolute bottom-4 left-4 right-4 text-white">
                <h2 className="font-display text-4xl leading-none">{configuringProduct.name}</h2>
                <p className="mt-1 line-clamp-2 text-sm text-white/85">{configuringProduct.description}</p>
              </div>
            </div>

            <div className="max-h-[calc(94vh-16rem)] overflow-y-auto p-4 pb-28 md:max-h-[54vh] md:p-5 md:pb-28">
              <div className="flex items-end justify-between gap-3 rounded-2xl bg-orange-50 p-4 dark:bg-white/5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide opacity-60">Pre?o do item</p>
                  {configuringProduct.promoPrice && configuringProduct.promoPrice < configuringProduct.price && (
                    <p className="text-sm opacity-50 line-through">{money(configuringProduct.price)}</p>
                  )}
                  <p className="text-3xl font-black text-ember">{money(configuringProduct.promoPrice ?? configuringProduct.price)}</p>
                </div>
                <div className="flex items-center gap-2 rounded-full bg-white p-1 shadow-sm dark:bg-slate-900">
                  <button className="grid h-10 w-10 place-items-center rounded-full bg-black/5 disabled:opacity-40 dark:bg-white/10" disabled={configuringQuantity <= 1} onClick={() => setConfiguringQuantity((value) => Math.max(1, value - 1))}>
                    <Minus size={16} />
                  </button>
                  <strong className="min-w-8 text-center">{configuringQuantity}</strong>
                  <button className="grid h-10 w-10 place-items-center rounded-full bg-ink text-white dark:bg-ember" onClick={() => setConfiguringQuantity((value) => value + 1)}>
                    <Plus size={16} />
                  </button>
                </div>
              </div>

              {configuringProduct.complements.filter((link) => link.complement.active).length > 0 ? (
                <div className="mt-5 space-y-4">
                  {configuringProduct.complements
                    .filter((link) => link.complement.active)
                    .map((link) => {
                      const quantity = complementQuantities[link.complementId] ?? 0;
                      return (
                        <article key={link.id} className={`overflow-hidden rounded-2xl border ${quantity > 0 ? "border-ember bg-orange-50/70 dark:bg-orange-950/20" : "border-black/10 dark:border-white/10"}`}>
                          <div className="flex gap-3 p-3">
                            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-black/5 dark:bg-white/10">
                              {link.complement.imageUrl ? (
                                <Image src={resolveAssetUrl(link.complement.imageUrl)} alt={link.complement.name} fill unoptimized className="object-cover" />
                              ) : (
                                <div className="grid h-full w-full place-items-center text-xs opacity-50">Extra</div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="font-black">{link.complement.name}</p>
                                  <p className="mt-0.5 line-clamp-2 text-xs opacity-65">{link.complement.description}</p>
                                  <p className="mt-1 text-sm font-bold text-ember">
                                    {link.complement.price > 0 ? `+ ${money(link.complement.price)}` : "Sem adicional"}
                                  </p>
                                </div>
                                <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-black ${link.required ? "bg-red-100 text-red-700" : "bg-black/5 dark:bg-white/10"}`}>
                                  {link.required ? "Obrigat?rio" : "Opcional"}
                                </span>
                              </div>
                              <div className="mt-3 flex items-center justify-end gap-2">
                                <button className="grid h-9 w-9 place-items-center rounded-full bg-black/10 disabled:opacity-40 dark:bg-white/10" disabled={link.required && quantity <= 1} onClick={() => setComplementQuantities((current) => ({ ...current, [link.complementId]: Math.max(link.required ? 1 : 0, quantity - 1) }))}>
                                  <Minus size={15} />
                                </button>
                                <span className="min-w-7 text-center font-black">{quantity}</span>
                                <button className="grid h-9 w-9 place-items-center rounded-full bg-ink text-white dark:bg-ember" onClick={() => setComplementQuantities((current) => ({ ...current, [link.complementId]: quantity + 1 }))}>
                                  <Plus size={15} />
                                </button>
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-dashed border-black/10 p-4 text-sm opacity-70 dark:border-white/10">
                  Este item n?o possui complementos. Escolha a quantidade e adicione ? sacola.
                </div>
              )}
            </div>

            <div className="fixed bottom-0 left-0 right-0 z-[61] border-t border-black/10 bg-white/95 p-3 backdrop-blur dark:border-white/10 dark:bg-slate-950/95 md:absolute md:left-auto md:right-auto md:w-full md:max-w-2xl md:rounded-b-[2rem]">
              <div className="mx-auto flex max-w-2xl items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase opacity-55">Total</p>
                  <p className="text-2xl font-black text-ember">{money(productModalTotal)}</p>
                </div>
                <button className="rounded-2xl bg-ember px-5 py-4 font-black text-white shadow-xl shadow-orange-500/25" onClick={confirmProductConfiguration}>
                  Adicionar ? sacola
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
