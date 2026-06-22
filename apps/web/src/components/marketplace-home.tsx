"use client";

import {
  Apple,
  ArrowRight,
  Bike,
  Building2,
  ChevronRight,
  Clock3,
  HeartHandshake,
  MapPin,
  Menu,
  PackageCheck,
  Percent,
  Pizza,
  Search,
  ShieldCheck,
  ShoppingBasket,
  Sparkles,
  Star,
  Store,
  UtensilsCrossed,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { API_URL } from "../lib/api";
import { money } from "../lib/format";

type MarketplaceCompany = {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  primaryColor: string;
  secondaryColor: string;
  category: string;
  city: string;
  isOpen: boolean;
  deliveryFee: number;
  deliveryTime: number;
  rating: number;
  featured: boolean;
  orderCount: number;
  promotionCount: number;
  publicUrl: string;
  promoBannerImageUrl?: string | null;
  promoBannerTitle?: string | null;
};

const categories = [
  { name: "Lanches", icon: UtensilsCrossed, color: "bg-orange-100 text-orange-700" },
  { name: "Pizzaria", icon: Pizza, color: "bg-red-100 text-red-700" },
  { name: "Açaí", icon: Apple, color: "bg-purple-100 text-purple-700" },
  { name: "Marmitas", icon: PackageCheck, color: "bg-amber-100 text-amber-700" },
  { name: "Sushi", icon: Sparkles, color: "bg-rose-100 text-rose-700" },
  { name: "Conveniência", icon: Store, color: "bg-blue-100 text-blue-700" },
  { name: "Farmácia", icon: HeartHandshake, color: "bg-emerald-100 text-emerald-700" },
  { name: "Mercado", icon: ShoppingBasket, color: "bg-lime-100 text-lime-700" }
];

function storeUrl(company: MarketplaceCompany) {
  if (typeof window === "undefined") return company.publicUrl;
  const host = window.location.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".onrender.com")) {
    return `/?subdomain=${encodeURIComponent(company.slug)}`;
  }
  return company.publicUrl;
}

function CompanyCard({ company, compact = false }: { company: MarketplaceCompany; compact?: boolean }) {
  return (
    <a
      href={storeUrl(company)}
      className="group overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_12px_40px_rgba(15,23,42,0.06)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_20px_55px_rgba(15,23,42,0.12)]"
    >
      <div
        className={`relative flex items-center justify-center overflow-hidden ${compact ? "h-32" : "h-44"}`}
        style={{ background: `linear-gradient(135deg, ${company.primaryColor}22, ${company.secondaryColor}55)` }}
      >
        <div className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/30" />
        <div className="absolute -bottom-14 -left-8 h-32 w-32 rounded-full bg-white/25" />
        {company.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={company.logo} alt={`Logo ${company.name}`} className="relative h-24 w-24 rounded-3xl object-cover shadow-lg ring-4 ring-white/80" />
        ) : (
          <div className="relative grid h-24 w-24 place-items-center rounded-3xl bg-white text-3xl font-black text-slate-800 shadow-lg">
            {company.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <span className={`absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-bold ${company.isOpen ? "bg-emerald-500 text-white" : "bg-slate-700 text-white"}`}>
          {company.isOpen ? "Aberto agora" : "Fechado"}
        </span>
        {company.promotionCount > 0 && (
          <span className="absolute right-4 top-4 flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-bold text-red-600 shadow">
            <Percent size={13} /> Promo
          </span>
        )}
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-900 transition group-hover:text-[#ff5a36]">{company.name}</h3>
            <p className="mt-1 text-sm text-slate-500">{company.category} • {company.city}</p>
          </div>
          <span className="flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-sm font-bold text-amber-700">
            <Star size={14} fill="currentColor" /> {company.rating.toFixed(1)}
          </span>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-sm text-slate-600">
          <span className="flex items-center gap-1.5"><Clock3 size={15} /> {company.deliveryTime} min</span>
          <span className="flex items-center gap-1.5">
            <Bike size={16} />
            {company.deliveryFee === 0 ? <strong className="text-emerald-600">Grátis</strong> : money(company.deliveryFee)}
          </span>
          <ChevronRight className="text-slate-300 transition group-hover:translate-x-1 group-hover:text-[#ff5a36]" size={18} />
        </div>
      </div>
    </a>
  );
}

function SectionTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.24em] text-[#ff5a36]">{eyebrow}</p>
        <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">{title}</h2>
        {description && <p className="mt-2 max-w-2xl text-slate-500">{description}</p>}
      </div>
    </div>
  );
}

export function MarketplaceHome() {
  const [companies, setCompanies] = useState<MarketplaceCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (activeCategory) params.set("category", activeCategory);
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetch(`${API_URL}/marketplace/companies?${params}`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("Falha ao carregar empresas")))
        .then(setCompanies)
        .catch(() => setCompanies([]))
        .finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [activeCategory, search]);

  const featured = useMemo(() => {
    const selected = companies.filter((company) => company.featured);
    return (selected.length ? selected : companies).slice(0, 6);
  }, [companies]);
  const bestSellers = useMemo(
    () => [...companies].sort((a, b) => b.orderCount - a.orderCount || b.rating - a.rating).slice(0, 4),
    [companies]
  );
  const promotions = useMemo(
    () => companies.filter((company) => company.promotionCount > 0).slice(0, 4),
    [companies]
  );
  const nearby = useMemo(() => companies.slice(0, 4), [companies]);

  return (
    <main className="min-h-screen bg-[#fffaf6] text-slate-950">
      <header className="sticky top-0 z-50 border-b border-orange-100/80 bg-[#fffaf6]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 md:px-8">
          <a href="/" className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#ff5a36] text-white shadow-lg shadow-orange-200">
              <MapPin size={23} fill="currentColor" />
            </span>
            <span>
              <strong className="block text-xl font-black leading-none">HubRegional</strong>
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Tudo perto de você</span>
            </span>
          </a>
          <nav className="hidden items-center gap-7 text-sm font-bold text-slate-600 md:flex">
            <a href="#empresas" className="hover:text-[#ff5a36]">Peça agora</a>
            <a href="#como-funciona" className="hover:text-[#ff5a36]">Como funciona</a>
            <a href="#parceiros" className="hover:text-[#ff5a36]">Para parceiros</a>
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            <a href="/admin/login" className="rounded-xl px-4 py-2 text-sm font-bold text-slate-700 hover:bg-orange-50">Entrar</a>
            <a href="#cadastro" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-[#ff5a36]">Cadastrar empresa</a>
          </div>
          <button className="rounded-xl p-2 md:hidden" onClick={() => setMobileMenu((value) => !value)} aria-label="Abrir menu">
            {mobileMenu ? <X /> : <Menu />}
          </button>
        </div>
        {mobileMenu && (
          <nav className="grid gap-2 border-t border-orange-100 bg-white px-4 py-4 text-sm font-bold md:hidden">
            <a href="#empresas">Peça agora</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#parceiros">Para parceiros</a>
            <a href="/admin/login">Entrar</a>
          </nav>
        )}
      </header>

      <section className="relative overflow-hidden px-4 pb-16 pt-14 md:px-8 md:pb-24 md:pt-20">
        <div className="absolute left-[-8rem] top-10 h-80 w-80 rounded-full bg-orange-200/40 blur-3xl" />
        <div className="absolute right-[-6rem] top-[-3rem] h-96 w-96 rounded-full bg-lime-200/35 blur-3xl" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.08fr_.92fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white px-4 py-2 text-sm font-bold text-[#df4324] shadow-sm">
              <Sparkles size={16} /> O melhor da sua região, em um só lugar
            </span>
            <h1 className="mt-7 max-w-3xl text-5xl font-black leading-[0.98] tracking-[-0.05em] text-slate-950 sm:text-6xl md:text-7xl">
              Sua cidade.<br />
              <span className="text-[#ff5a36]">Suas escolhas.</span><br />
              Seu delivery.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
              Encontre restaurantes, mercados, farmácias e serviços locais. Peça fácil, fortaleça quem é da região.
            </p>
            <div className="mt-8 flex max-w-2xl items-center rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_50px_rgba(15,23,42,0.12)]">
              <Search className="ml-3 shrink-0 text-[#ff5a36]" size={22} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Busque por empresa, comida ou categoria"
                className="min-w-0 flex-1 bg-transparent px-4 py-3 outline-none placeholder:text-slate-400"
              />
              <a href="#empresas" className="hidden rounded-xl bg-[#ff5a36] px-6 py-3 font-bold text-white sm:block">Buscar</a>
            </div>
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
              <span className="flex items-center gap-2"><ShieldCheck size={17} className="text-emerald-600" /> Negócios verificados</span>
              <span className="flex items-center gap-2"><Bike size={17} className="text-[#ff5a36]" /> Entrega local</span>
              <span className="flex items-center gap-2"><HeartHandshake size={17} className="text-purple-600" /> Fortalece a região</span>
            </div>
          </div>

          <div className="relative hidden min-h-[520px] lg:block">
            <div className="absolute inset-8 rotate-3 rounded-[54px] bg-gradient-to-br from-[#ff6b45] to-[#ff9d55] shadow-[0_35px_80px_rgba(255,90,54,0.28)]" />
            <div className="absolute inset-x-16 inset-y-12 -rotate-3 rounded-[46px] border border-white/50 bg-white/95 p-7 shadow-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Entregando agora</p>
                  <p className="mt-1 text-2xl font-black">Perto de você</p>
                </div>
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-orange-100 text-[#ff5a36]"><MapPin /></span>
              </div>
              <div className="relative mt-7 h-64 overflow-hidden rounded-[32px] bg-[#f0eadf]">
                <div className="absolute inset-0 opacity-35" style={{ backgroundImage: "linear-gradient(#94a3b8 1px, transparent 1px), linear-gradient(90deg, #94a3b8 1px, transparent 1px)", backgroundSize: "42px 42px" }} />
                <div className="absolute left-10 top-12 h-3 w-48 rotate-12 rounded-full bg-white shadow" />
                <div className="absolute right-8 top-28 h-3 w-52 -rotate-[28deg] rounded-full bg-white shadow" />
                <span className="absolute left-16 top-16 grid h-12 w-12 place-items-center rounded-full bg-white text-[#ff5a36] shadow-xl"><Store /></span>
                <span className="absolute bottom-10 right-16 grid h-14 w-14 place-items-center rounded-full bg-[#ff5a36] text-white shadow-xl"><Bike /></span>
                <span className="absolute left-1/2 top-1/2 grid h-10 w-10 place-items-center rounded-full bg-slate-950 text-white shadow-xl"><MapPin size={18} /></span>
              </div>
              <div className="mt-6 flex items-center justify-between rounded-2xl bg-slate-50 p-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><PackageCheck size={20} /></span>
                  <div><p className="text-xs text-slate-400">Seu pedido</p><p className="font-bold">Chega em 25-35 min</p></div>
                </div>
                <ArrowRight className="text-[#ff5a36]" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-orange-100 bg-white py-10">
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <p className="mb-5 text-sm font-bold text-slate-500">O que você procura hoje?</p>
          <div className="grid grid-cols-4 gap-3 md:grid-cols-8">
            {categories.map(({ name, icon: Icon, color }) => (
              <button
                key={name}
                onClick={() => setActiveCategory((value) => value === name ? "" : name)}
                className={`group flex flex-col items-center gap-3 rounded-2xl p-3 text-center transition hover:-translate-y-1 ${activeCategory === name ? "bg-slate-950 text-white shadow-lg" : "hover:bg-orange-50"}`}
              >
                <span className={`grid h-12 w-12 place-items-center rounded-2xl transition group-hover:scale-105 ${activeCategory === name ? "bg-white/15 text-white" : color}`}>
                  <Icon size={22} />
                </span>
                <span className="text-xs font-bold md:text-sm">{name}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section id="empresas" className="mx-auto max-w-7xl px-4 py-16 md:px-8 md:py-24">
        <SectionTitle eyebrow="Descubra" title={activeCategory ? `${activeCategory} na sua região` : "Empresas em destaque"} description="Escolhas locais selecionadas para você pedir agora." />
        {loading ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((item) => <div key={item} className="h-80 animate-pulse rounded-[28px] bg-white" />)}
          </div>
        ) : featured.length ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {featured.map((company) => <CompanyCard key={company.id} company={company} />)}
          </div>
        ) : (
          <div className="rounded-[28px] border border-dashed border-orange-200 bg-white p-12 text-center">
            <Store className="mx-auto text-orange-300" size={44} />
            <h3 className="mt-4 text-xl font-black">Nenhuma empresa encontrada</h3>
            <p className="mt-2 text-slate-500">Tente outra busca ou categoria.</p>
          </div>
        )}
      </section>

      {bestSellers.length > 0 && (
        <section className="bg-slate-950 py-16 text-white md:py-24">
          <div className="mx-auto max-w-7xl px-4 md:px-8">
            <div className="mb-8">
              <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-400">Queridinhas da região</p>
              <h2 className="mt-2 text-3xl font-black md:text-4xl">As mais pedidas</h2>
            </div>
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {bestSellers.map((company) => <CompanyCard key={company.id} company={company} compact />)}
            </div>
          </div>
        </section>
      )}

      {promotions.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 py-16 md:px-8 md:py-24">
          <SectionTitle eyebrow="Economize hoje" title="Promoções do dia" description="Ofertas especiais das empresas da nossa região." />
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {promotions.map((company) => <CompanyCard key={company.id} company={company} compact />)}
          </div>
        </section>
      )}

      <section className="border-y border-orange-100 bg-white py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <SectionTitle eyebrow="Na sua cidade" title="Empresas próximas" description="Comércio local, entrega rápida e atendimento com a cara da sua região." />
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {nearby.map((company) => <CompanyCard key={company.id} company={company} compact />)}
          </div>
        </div>
      </section>

      <section id="como-funciona" className="mx-auto max-w-7xl px-4 py-16 md:px-8 md:py-24">
        <SectionTitle eyebrow="Simples de verdade" title="Como funciona" description="Do desejo à sua porta em poucos passos." />
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { number: "01", icon: Search, title: "Encontre", text: "Busque o que deseja e descubra as melhores opções perto de você." },
            { number: "02", icon: ShoppingBasket, title: "Escolha", text: "Monte seu pedido direto no cardápio da empresa, com segurança e praticidade." },
            { number: "03", icon: Bike, title: "Receba", text: "Acompanhe a entrega e receba seu pedido onde estiver." }
          ].map(({ number, icon: Icon, title, text }) => (
            <article key={number} className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-white p-7">
              <span className="absolute right-5 top-2 text-7xl font-black text-slate-100">{number}</span>
              <span className="relative grid h-14 w-14 place-items-center rounded-2xl bg-orange-100 text-[#ff5a36]"><Icon /></span>
              <h3 className="relative mt-6 text-2xl font-black">{title}</h3>
              <p className="relative mt-3 leading-relaxed text-slate-500">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="parceiros" className="bg-[#ff5a36] py-16 text-white md:py-24">
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <div className="grid gap-6 lg:grid-cols-3">
            {[
              { icon: ShoppingBasket, label: "Para clientes", title: "Tudo da região na palma da mão", text: "Mais variedade, praticidade e conexão com os melhores negócios locais.", cta: "Peça agora", href: "#empresas" },
              { icon: Building2, label: "Para empresas", title: "Venda mais e alcance novos clientes", text: "Cardápio digital, gestão de pedidos, entregas e presença no marketplace regional.", cta: "Cadastrar empresa", href: "/admin/login" },
              { icon: Bike, label: "Para motoboys", title: "Mais corridas, mais oportunidades", text: "Receba rotas, organize entregas e conecte-se às empresas da sua cidade.", cta: "Quero ser motoboy", href: "https://wa.me/5575999999999" }
            ].map(({ icon: Icon, label, title, text, cta, href }) => (
              <article key={label} className="rounded-[28px] border border-white/25 bg-white/10 p-7 backdrop-blur">
                <Icon size={30} />
                <p className="mt-6 text-xs font-black uppercase tracking-[0.22em] text-orange-100">{label}</p>
                <h3 className="mt-2 text-2xl font-black">{title}</h3>
                <p className="mt-3 leading-relaxed text-orange-50/90">{text}</p>
                <a href={href} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 font-black text-[#e54424]">
                  {cta} <ArrowRight size={17} />
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="cadastro" className="px-4 py-16 md:px-8 md:py-24">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-8 overflow-hidden rounded-[40px] bg-slate-950 px-7 py-12 text-center text-white md:flex-row md:px-14 md:text-left">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-400">Cresça com a gente</p>
            <h2 className="mt-3 max-w-2xl text-3xl font-black md:text-5xl">Seu negócio merece ser encontrado por toda a região.</h2>
            <p className="mt-4 text-slate-300">Faça parte do marketplace que valoriza quem movimenta a economia local.</p>
          </div>
          <a href="/admin/login" className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-[#ff5a36] px-6 py-4 font-black shadow-lg shadow-orange-950/40">
            Cadastrar empresa <ArrowRight />
          </a>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-5 px-4 py-9 text-sm text-slate-500 md:flex-row md:items-center md:px-8">
          <div className="flex items-center gap-3 text-slate-900">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#ff5a36] text-white"><MapPin size={18} fill="currentColor" /></span>
            <strong>HubRegional</strong>
          </div>
          <p>Conectando pessoas, empresas e oportunidades na nossa região.</p>
          <p>© {new Date().getFullYear()} HubRegional</p>
        </div>
      </footer>
    </main>
  );
}
