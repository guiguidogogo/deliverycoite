"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Moon, Search, ShoppingCart, Sun, User } from "lucide-react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "../lib/api";
import { money } from "../lib/format";
import type { CartItem, Category, Product, Settings } from "../lib/types";

const checkoutSchema = z
  .object({
    name: z.string().min(2, "Nome obrigatorio"),
    phone: z.string().min(8, "Telefone obrigatorio"),
    fulfillmentType: z.enum(["DELIVERY", "PICKUP"]),
    address: z.string().optional(),
    number: z.string().optional(),
    district: z.string().optional(),
    complement: z.string().optional(),
    paymentMethod: z.enum(["CASH", "PIX", "CARD"]),
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
  };
  fulfillmentType: "DELIVERY" | "PICKUP";
  paymentMethod: "CASH" | "PIX" | "CARD";
  changeFor?: number;
  couponCode?: string;
  notes?: string;
  items: Array<{ productId: string; quantity: number }>;
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

  useEffect(() => {
    Promise.all([api<Category[]>("/categories"), api<Product[]>("/products"), api<Settings>("/settings")])
      .then(([c, p, s]) => {
        setCategories(c.filter((item: any) => item.active !== false));
        setProducts(
          p
            .filter((item: any) => item.active !== false && item.available !== false)
            .map((item: any) => ({ ...item, price: Number(item.price), promoPrice: item.promoPrice ? Number(item.promoPrice) : null }))
        );
        setSettings({ ...s, deliveryFee: Number((s as any).deliveryFee ?? 0) });
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "Nao foi possivel carregar o cardapio");
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

  const filtered = useMemo(() => {
    return products.filter((product) => {
      const byCategory = selectedCategory === "all" || product.categoryId === selectedCategory;
      const byText = !query || product.name.toLowerCase().includes(query.toLowerCase()) || product.description.toLowerCase().includes(query.toLowerCase());
      return byCategory && byText;
    });
  }, [products, query, selectedCategory]);

  const subtotal = cart.reduce((acc, item) => {
    const unit = item.product.promoPrice ?? item.product.price;
    return acc + unit * item.quantity;
  }, 0);
  const paymentMethod = watch("paymentMethod");
  const fulfillmentType = watch("fulfillmentType");
  const needChange = watch("needChange");
  const couponCode = watch("couponCode") || "";
  const customerPhone = watch("phone") || "";
  const customerName = watch("name") || "";
  const deliveryFee =
    cart.length === 0 || fulfillmentType === "PICKUP"
      ? 0
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

  function addToCart(product: Product) {
    setCart((prev) => {
      const found = prev.find((item) => item.product.id === product.id);
      if (found) {
        toast.success(`+1 ${product.name} adicionado!`);
        return prev.map((item) => (item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
      }
      toast.success(`${product.name} adicionado ao carrinho!`);
      return [...prev, { product, quantity: 1 }];
    });
  }

  function setItemQuantity(productId: string, quantity: number) {
    if (quantity <= 0) {
      setCart((prev) => prev.filter((item) => item.product.id !== productId));
      return;
    }
    setCart((prev) => prev.map((item) => (item.product.id === productId ? { ...item, quantity } : item)));
  }

  function selectAddress(addressId: string) {
    const addr = addresses.find((a) => a.id === addressId);
    if (addr) {
      setValue("address", addr.address);
      setValue("number", addr.number);
      setValue("district", addr.district);
      setValue("complement", addr.complement || "");
      setSelectedAddress(addressId);
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

    const payload: CheckoutPayload = {
      customer: {
        name: values.name,
        phone: values.phone,
        address: values.address || "",
        number: values.number || "",
        district: values.district || "",
        complement: values.complement || undefined
      },
      fulfillmentType: values.fulfillmentType,
      paymentMethod: values.paymentMethod,
      changeFor:
        values.paymentMethod === "CASH" && values.needChange && values.changeFor
          ? Number(values.changeFor)
          : undefined,
      couponCode: values.couponCode || undefined,
      notes: values.notes || undefined,
      items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity }))
    };

    try {
      const response = await api<{ whatsappUrl: string | null; sentByServer?: boolean; sendError?: string | null }>("/orders", {
        method: "POST",
        body: JSON.stringify(payload)
      });

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
        toast.warning(`Pedido criado, mas houve falha no envio automatico: ${response.sendError}`);
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
            <p className="font-display text-3xl tracking-wide">{settings?.companyName ?? "Lanchonete Delivery"}</p>
            <p className="text-sm opacity-70">Sabores artesanais e entrega rapida</p>
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

        <div className="mt-4 rounded-2xl bg-gradient-to-r from-ember/90 to-lime/80 p-4 text-white">
          <p className="font-display text-2xl">PROMO DA NOITE</p>
          <p>Combo burger + batata + refri com 10% OFF usando cupom PROMO10</p>
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
                  src={product.imageUrl ?? "https://images.unsplash.com/photo-1550547660-d9450f859349"}
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
                  <button className="rounded-xl bg-ink px-3 py-2 text-xs font-semibold text-white dark:bg-ember" onClick={() => addToCart(product)}>
                    Adicionar
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
              {cart.map((item) => (
                <div key={item.product.id} className="flex items-center justify-between rounded-xl border border-black/10 p-2 dark:border-white/10">
                  <div>
                    <p className="font-medium">{item.product.name}</p>
                    <p className="text-sm opacity-70">{money((item.product.promoPrice ?? item.product.price) * item.quantity)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="rounded-md bg-black/10 px-2 dark:bg-white/10" onClick={() => setItemQuantity(item.product.id, item.quantity - 1)}>
                      -
                    </button>
                    <span>{item.quantity}</span>
                    <button className="rounded-md bg-black/10 px-2 dark:bg-white/10" onClick={() => setItemQuantity(item.product.id, item.quantity + 1)}>
                      +
                    </button>
                  </div>
                </div>
              ))}
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
                  <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Endereco *" {...register("address")} />
                  <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Numero *" {...register("number")} />
                  <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Bairro *" {...register("district")} />
                  <input className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" placeholder="Complemento" {...register("complement")} />
                </>
              )}

              <select className="rounded-xl border border-black/10 bg-transparent px-3 py-2 dark:border-white/20" {...register("paymentMethod")}>
                <option value="CASH">Dinheiro</option>
                <option value="PIX">PIX</option>
                <option value="CARD">Cartao</option>
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

            <div className="mt-4 space-y-1 text-sm">
              <p>Subtotal: {money(subtotal)}</p>
              <p>{fulfillmentType === "PICKUP" ? "Retirada na loja" : `Taxa de entrega: ${money(deliveryFee)}`}</p>
              <p>Desconto: {money(discount)}</p>
              <p className="text-lg font-bold">Total: {money(total)}</p>
            </div>

            <button
              className="mt-4 w-full rounded-xl bg-ember px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
              onClick={() => void handleSubmit(finishOrder)()}
            >
              {isSubmitting ? "Enviando pedido..." : "Confirmar Pedido"}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
