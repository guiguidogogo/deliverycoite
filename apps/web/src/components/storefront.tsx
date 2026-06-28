"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Moon, Search, ShoppingCart, Sun, User } from "lucide-react";
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
    address: string;
    number: string;
    district: string;
    complement?: string;
    latitude?: number;
    longitude?: number;
  };
  fulfillmentType: "DELIVERY" | "PICKUP";
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

export function Storefront() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [company, setCompany] = useState<PublicCompany | null>(null);
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
  const [deliveryLocation, setDeliveryLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [quotedDeliveryFee, setQuotedDeliveryFee] = useState<number | null>(null);
  const [deliveryDistanceKm, setDeliveryDistanceKm] = useState<number | null>(null);
  const [deliveryQuoteError, setDeliveryQuoteError] = useState("");
  const [addressMode, setAddressMode] = useState<"MANUAL" | "LOCATION">("MANUAL");
  const [locatingAddress, setLocatingAddress] = useState(false);
  const [updatingAddressFromMap, setUpdatingAddressFromMap] = useState(false);
  const [mercadoPagoPix, setMercadoPagoPix] = useState<{
    orderId: string;
    qrCode: string | null;
    qrCodeBase64: string | null;
    ticketUrl: string | null;
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

  useEffect(() => {
    api<PublicCompany>("/company")
      .then((tenantCompany) => {
        setCompany(tenantCompany);
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
      })
      .catch(() => setCompany(null));

    api<Category[]>("/categories")
      .then((c) => {
        setCategories(c.filter((item: any) => item.active !== false));
      })
      .catch(() => {
        setCategories([]);
      });

    api<Product[]>("/products")
      .then((p) => {
        setProducts(
          p
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
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "Nao foi possivel carregar o cardapio");
      });

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
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

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
    return products.filter((product) => {
      const byCategory = selectedCategory === "all" || product.categoryId === selectedCategory;
      const byText = !query || product.name.toLowerCase().includes(query.toLowerCase()) || product.description.toLowerCase().includes(query.toLowerCase());
      return byCategory && byText;
    });
  }, [products, query, selectedCategory]);

  const subtotal = cart.reduce((acc, item) => {
    const extras = item.complements.reduce(
      (sum, selected) => sum + selected.complement.price * selected.quantity,
      0
    );
    const unit = (item.product.promoPrice ?? item.product.price) + extras;
    return acc + unit * item.quantity;
  }, 0);
  const deliveryFee =
    cart.length === 0 || fulfillmentType === "PICKUP"
      ? 0
      : settings?.deliveryFeeTiers?.length
        ? (quotedDeliveryFee ?? 0)
        : (settings?.deliveryFee ?? 0);
  const discount = couponDiscount;
  const total = subtotal + deliveryFee - discount;

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

  function addConfiguredToCart(product: Product, complements: SelectedComplement[]) {
    const selectionKey = complements
      .map((item) => `${item.complement.id}:${item.quantity}`)
      .sort()
      .join("|");
    const itemId = `${product.id}:${selectionKey}`;

    setCart((prev) => {
      const found = prev.find((item) => item.id === itemId);
      if (found) {
        toast.success(`+1 ${product.name} adicionado!`);
        return prev.map((item) => (item.id === itemId ? { ...item, quantity: item.quantity + 1 } : item));
      }
      toast.success(`${product.name} adicionado ao carrinho!`);
      return [...prev, { id: itemId, product, quantity: 1, complements }];
    });
  }

  function beginProductConfiguration(product: Product) {
    const activeLinks = (product.complements ?? []).filter((link) => link.complement.active);
    if (!activeLinks.length) {
      addConfiguredToCart(product, []);
      return;
    }

    setComplementQuantities(
      Object.fromEntries(
        activeLinks
          .filter((link) => link.required)
          .map((link) => [link.complementId, 1])
      )
    );
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
    addConfiguredToCart(configuringProduct, selected);
    setConfiguringProduct(null);
    setComplementQuantities({});
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

  async function finishOrder(values: CheckoutForm) {
    if (!settings) return;
    if (!cart.length) {
      toast.error("Adicione itens antes de confirmar");
      return;
    }
    if (
      values.fulfillmentType === "DELIVERY" &&
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
        address: values.address || "",
        number: values.number || "",
        district: values.district || "",
        complement: values.complement || undefined,
        latitude: deliveryLocation?.latitude,
        longitude: deliveryLocation?.longitude
      },
      fulfillmentType: values.fulfillmentType,
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

      if (values.paymentMethod === "MERCADO_PAGO_PIX") {
        const pix = await api<{
          qrCode: string | null;
          qrCodeBase64: string | null;
          ticketUrl: string | null;
        }>(`/orders/${response.orderId}/mercadopago/pix`, { method: "POST" });
        setMercadoPagoPix({
          orderId: response.orderId,
          qrCode: pix.qrCode,
          qrCodeBase64: pix.qrCodeBase64,
          ticketUrl: pix.ticketUrl
        });
        setCart([]);
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
      setCouponDiscount(0);
      setCouponMessage("");
      reset({
        ...initialForm,
        name: values.name,
        phone: values.phone,
        address: values.address || "",
        number: values.number || "",
        district: values.district || "",
        complement: values.complement || ""
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

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-4 md:px-8">
      <section className="reveal card-surface overflow-hidden p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              {company?.logoUrl && (
                <Image
                  src={resolveAssetUrl(company.logoUrl)}
                  alt={`Logo ${company.tradeName}`}
                  width={56}
                  height={56}
                  className="h-14 w-14 rounded-xl object-contain"
                  unoptimized
                />
              )}
              <div>
                <p className="font-display text-3xl tracking-wide">
                  {company?.tradeName ?? settings?.companyName ?? "Lanchonete Delivery"}
                </p>
                <p className="text-sm opacity-70">Sabores artesanais e entrega rapida</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {customer ? (
              <a
                href="/profile"
                className="flex items-center gap-2 rounded-full border border-black/10 px-3 py-2 text-sm dark:border-white/20"
                title="Meu perfil"
              >
                <User size={18} />
                <span className="hidden sm:inline">{customer.name.split(" ")[0]}</span>
              </a>
            ) : (
              <a
                href="/account"
                className="rounded-full border border-black/10 px-3 py-2 text-sm dark:border-white/20"
              >
                <User size={18} className="inline sm:hidden" />
                <span className="hidden sm:inline">Entrar</span>
              </a>
            )}
            <button
              className="rounded-full border border-black/10 p-2 dark:border-white/20"
              onClick={() => setDark((v) => !v)}
              aria-label="Alternar tema"
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </div>
        {settings?.ordersPaused && (
          <div className="mt-4 rounded-xl bg-red-600 p-3 text-center font-semibold text-white">
            {settings.ordersPausedReason || "Loja temporariamente pausada para novos pedidos"}
          </div>
        )}

        <div
          className="relative mt-4 overflow-hidden rounded-2xl p-4 text-white"
          style={
            settings?.promoBannerImageUrl
              ? {
                  backgroundImage: `linear-gradient(90deg, rgba(15,23,42,.82), rgba(15,23,42,.28)), url("${resolveAssetUrl(settings.promoBannerImageUrl)}")`,
                  backgroundPosition: "center",
                  backgroundSize: "cover"
                }
              : {
                  backgroundImage: "linear-gradient(90deg, var(--tenant-primary), var(--tenant-secondary))"
                }
          }
        >
          <p className="font-display text-2xl">{settings?.promoBannerTitle || "PROMO DA NOITE"}</p>
          <p>{settings?.promoBannerText || "Confira nossos cupons e promocoes"}</p>
        </div>
      </section>

      <section className="mt-4 flex gap-2 overflow-x-auto pb-1">
        <button
          className={`rounded-full px-4 py-2 text-sm ${selectedCategory === "all" ? "bg-ink text-white dark:bg-ember" : "card-surface"}`}
          onClick={() => setSelectedCategory("all")}
        >
          Todos
        </button>
        {categories.map((category) => (
          <button
            key={category.id}
            className={`rounded-full px-4 py-2 text-sm ${selectedCategory === category.id ? "bg-ink text-white dark:bg-ember" : "card-surface"}`}
            onClick={() => setSelectedCategory(category.id)}
          >
            {category.name}
          </button>
        ))}
      </section>

      <section className="mt-4 card-surface flex items-center gap-2 px-3 py-2">
        <Search size={16} className="opacity-60" />
        <input
          className="w-full bg-transparent text-sm outline-none"
          placeholder="Busque hamburguer, pizza, bebida..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </section>

      <section className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {filtered.map((product, index) => {
          const unit = product.promoPrice ?? product.price;
          return (
            <article key={product.id} className="card-surface reveal overflow-hidden" style={{ animationDelay: `${index * 60}ms` }}>
              <div className="relative h-36 w-full bg-slate-200/40">
                <Image
                  src={resolveAssetUrl(product.imageUrl) || "https://images.unsplash.com/photo-1550547660-d9450f859349"}
                  alt={product.name}
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 33vw"
                  unoptimized
                />
              </div>
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-lg font-semibold leading-tight">{product.name}</h3>
                  <button
                    onClick={() => {
                      setFavorites((prev) =>
                        prev.includes(product.id) ? prev.filter((id) => id !== product.id) : [...prev, product.id]
                      );
                      void api("/favorites/toggle", {
                        method: "POST",
                        body: JSON.stringify({ phone: customerPhone || "guest", productId: product.id })
                      }).catch(() => undefined);
                    }}
                    className={`rounded-full px-2 py-1 text-xs ${favorites.includes(product.id) ? "bg-ember text-white" : "bg-black/5 dark:bg-white/10"}`}
                  >
                    Favorito
                  </button>
                </div>
                <p className="mt-1 text-sm opacity-70">{product.description}</p>
                <div className="mt-3 flex items-center justify-between">
                  <p className="font-semibold text-ember">{money(unit)}</p>
                  <button className="rounded-xl bg-ink px-3 py-2 text-xs font-semibold text-white dark:bg-ember" onClick={() => beginProductConfiguration(product)}>
                    {product.complements?.length ? "Montar" : "Adicionar"}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>

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
          <div className="card-surface mx-auto mt-8 max-h-[90vh] w-full max-w-xl overflow-y-auto p-4" onClick={(event) => event.stopPropagation()}>
            <h2 className="font-display text-3xl">Seu Pedido</h2>

            <div className="mt-3 space-y-2">
              {cart.map((item) => {
                const extras = item.complements.reduce(
                  (sum, selected) => sum + selected.complement.price * selected.quantity,
                  0
                );
                return (
                <div key={item.id} className="flex items-center justify-between rounded-xl border border-black/10 p-2 dark:border-white/10">
                  <div>
                    <p className="font-medium">{item.product.name}</p>
                    {item.complements.map((selected) => (
                      <p key={selected.complement.id} className="text-xs opacity-65">
                        + {selected.quantity}x {selected.complement.name}
                      </p>
                    ))}
                    <p className="text-sm opacity-70">{money(((item.product.promoPrice ?? item.product.price) + extras) * item.quantity)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="rounded-md bg-black/10 px-2 dark:bg-white/10" onClick={() => setItemQuantity(item.id, item.quantity - 1)}>
                      -
                    </button>
                    <span>{item.quantity}</span>
                    <button className="rounded-md bg-black/10 px-2 dark:bg-white/10" onClick={() => setItemQuantity(item.id, item.quantity + 1)}>
                      +
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

              <label className="md:col-span-2">
                <span className="mb-1 block text-xs font-semibold">Como deseja receber?</span>
                <select className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" {...register("fulfillmentType")}>
                  <option value="DELIVERY">Entrega no endereco</option>
                  <option value="PICKUP">Retirada na loja (sem frete)</option>
                </select>
              </label>

              {fulfillmentType === "DELIVERY" && (
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

            <div className="mt-4 space-y-1 text-sm">
              <p>Subtotal: {money(subtotal)}</p>
              <p>{fulfillmentType === "PICKUP" ? "Retirada na loja" : `Taxa de entrega: ${money(deliveryFee)}`}</p>
              <p>Desconto: {money(discount)}</p>
              <p className="text-lg font-bold">Total: {money(total)}</p>
            </div>

            <button
              className="mt-4 w-full rounded-xl bg-ember px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
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
              <h2 className="mt-1 text-2xl font-black">Pague com Pix</h2>
              <p className="mt-1 text-sm opacity-95">Escaneie o QR Code ou copie o codigo Pix abaixo.</p>
            </div>

            {mercadoPagoPix.qrCodeBase64 ? (
              <img
                className="mx-auto mt-4 h-56 w-56 rounded-2xl border object-contain p-2"
                src={`data:image/png;base64,${mercadoPagoPix.qrCodeBase64}`}
                alt="QR Code Pix Mercado Pago"
              />
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed p-5 text-center text-sm text-slate-500">
                QR Code indisponivel. Use o copia-e-cola abaixo.
              </div>
            )}

            {mercadoPagoPix.qrCode && (
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

            {mercadoPagoPix.ticketUrl && (
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
        <section className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-3" onClick={() => setConfiguringProduct(null)}>
          <div className="card-surface max-h-[90vh] w-full max-w-xl overflow-y-auto p-4" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-3xl">Monte seu {configuringProduct.name}</h2>
                <p className="text-sm opacity-70">Escolha os complementos e quantidades.</p>
              </div>
              <button className="rounded-lg border px-3 py-1" onClick={() => setConfiguringProduct(null)}>Fechar</button>
            </div>

            <div className="mt-4 space-y-3">
              {configuringProduct.complements
                .filter((link) => link.complement.active)
                .map((link) => {
                  const quantity = complementQuantities[link.complementId] ?? 0;
                  return (
                    <article key={link.id} className={`flex gap-3 rounded-xl border p-3 ${quantity > 0 ? "border-ember" : "border-black/10 dark:border-white/10"}`}>
                      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-black/5">
                        {link.complement.imageUrl ? (
                          <Image src={resolveAssetUrl(link.complement.imageUrl)} alt={link.complement.name} fill unoptimized className="object-cover" />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold">{link.complement.name}</p>
                            <p className="text-xs opacity-65">{link.complement.description}</p>
                            <p className="text-sm text-ember">
                              {link.complement.price > 0 ? `+ ${money(link.complement.price)}` : "Sem adicional"}
                            </p>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-xs ${link.required ? "bg-red-100 text-red-700" : "bg-black/5 dark:bg-white/10"}`}>
                            {link.required ? "Obrigatorio" : "Opcional"}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            className="rounded-lg bg-black/10 px-3 py-1 dark:bg-white/10 disabled:opacity-40"
                            disabled={link.required && quantity <= 1}
                            onClick={() => setComplementQuantities((current) => ({
                              ...current,
                              [link.complementId]: Math.max(link.required ? 1 : 0, quantity - 1)
                            }))}
                          >
                            -
                          </button>
                          <span className="min-w-6 text-center">{quantity}</span>
                          <button
                            className="rounded-lg bg-black/10 px-3 py-1 dark:bg-white/10"
                            onClick={() => setComplementQuantities((current) => ({
                              ...current,
                              [link.complementId]: quantity + 1
                            }))}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
            </div>

            <button className="mt-4 w-full rounded-xl bg-ember px-4 py-3 font-semibold text-white" onClick={confirmProductConfiguration}>
              Adicionar ao carrinho
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
