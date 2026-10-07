"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, readApiJson } from "../lib/api";
import WhatsappMessageContent from "./whatsapp-message-content";

type Conversation = { phone: string; name: string; unreadCount?: number; isCustomer: boolean; customerId?: string | null; address?: string | null; number?: string | null; district?: string | null; complement?: string | null; lastMessage?: string; lastMessageAt?: string };
type Message = { id: string; phone: string; direction: "in" | "out"; body: string; sentAt: string; readAt?: string | null; quotedMessage?: { id: string; text: string; messageType: string; author?: string } | null; messageType?: string; mediaUrl?: string | null; latitude?: number | null; longitude?: number | null };
type Label = { id: string; name: string };
type MediaAttachment = { url: string; filename: string; mimeType: string };
type QuickReply = { id: string; name: string; message: string; media?: MediaAttachment[] };
type Product = { id: string; name: string; price: number | string; active?: boolean; available?: boolean };
type CustomerAddress = { id: string; label?: string | null; address: string; number?: string | null; district?: string | null; complement?: string | null; latitude?: number | null; longitude?: number | null; isDefault?: boolean };

async function inboxApi<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`/admin/whatsapp/inbox${path}`, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const data: { message?: string } = await readApiJson<{ message?: string }>(response).catch(() => ({}));
    throw new Error(data.message ?? "Nao foi possivel carregar o WhatsApp");
  }
  return readApiJson<T>(response);
}

function time(value?: string) {
  return value ? new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
}

export default function WhatsAppPage({ token: tokenProp }: { token?: string }) {
  const token = tokenProp || (typeof window !== "undefined" ? localStorage.getItem("delivery:token") ?? "" : "");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const selectedPhoneRef = useRef(selectedPhone);
  selectedPhoneRef.current = selectedPhone;
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [contactName, setContactName] = useState("");
  const [labelName, setLabelName] = useState("");
  const [shortcutName, setShortcutName] = useState("");
  const [shortcutMessage, setShortcutMessage] = useState("");
  const [shortcutAttachments, setShortcutAttachments] = useState<File[]>([]);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunks = useRef<Blob[]>([]);
  const [editingShortcutId, setEditingShortcutId] = useState<string | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [showManualOrder, setShowManualOrder] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState("PIX");
  const [manualAddress, setManualAddress] = useState("");
  const [manualNumber, setManualNumber] = useState("");
  const [manualDistrict, setManualDistrict] = useState("");
  const [manualComplement, setManualComplement] = useState("");
  const [savedAddresses, setSavedAddresses] = useState<CustomerAddress[]>([]);
  const [freightQuote, setFreightQuote] = useState<{ fee: number; distanceKm?: number | null } | null>(null);
  const [freightError, setFreightError] = useState("");
  const conversationsLoaded = useRef(false);
  const messagesLoaded = useRef(false);
  const messagesViewport = useRef<HTMLDivElement>(null);
  const lastScroll = useRef({ phone: "", message: "" });

  const loadConversations = useCallback(async () => {
    if (!token) return;
    if (!conversationsLoaded.current) setLoadingConversations(true);
    try {
      const data = await inboxApi<Conversation[]>("/conversations", token);
      setConversations(data); conversationsLoaded.current = true; setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao carregar conversas"); }
    finally { setLoadingConversations(false); }
  }, [token]);

  const loadMessages = useCallback(async () => {
    if (!token || !selectedPhone) return;
    if (!messagesLoaded.current) setLoadingMessages(true);
    try {
      const data = await inboxApi<Message[]>(`/messages/${encodeURIComponent(selectedPhone)}`, token);
      if (selectedPhoneRef.current !== selectedPhone) return;
      setMessages(data); messagesLoaded.current = true;
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Erro ao carregar mensagens"); }
    finally { setLoadingMessages(false); }
  }, [selectedPhone, token]);

  useEffect(() => { void loadConversations(); }, [loadConversations]);
  useEffect(() => { void loadMessages(); }, [loadMessages]);

  useEffect(() => {
    const root = messagesViewport.current;
    if (!root || !selectedPhone || loadingMessages) return;
    let active = true;
    let sending = false;
    const visible = new Set<string>();
    async function acknowledgeVisible() {
      if (!active || sending || document.visibilityState !== "visible" || !document.hasFocus() || !visible.size) return;
      const ids = [...visible]; sending = true;
      try {
        const result = await inboxApi<{ ids: string[] }>(`/messages/${encodeURIComponent(selectedPhone)}/read`, token, { method: "POST", body: JSON.stringify({ ids }) });
        if (!active || selectedPhoneRef.current !== selectedPhone) return;
        const read = new Set(ids);
        setMessages((current) => current.map((m) => read.has(m.id) ? { ...m, readAt: new Date().toISOString() } : m));
        setConversations((current) => current.map((c) => c.phone === selectedPhone ? { ...c, unreadCount: Math.max(0, (c.unreadCount || 0) - result.ids.length) } : c));
      } catch { /* Keep unread until a later successful acknowledgement. */ }
      finally { sending = false; }
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.unreadId!;
        if (entry.isIntersecting) visible.add(id); else visible.delete(id);
      }
    }, { root, threshold: 0.1 });
    root.querySelectorAll("[data-unread-id]").forEach((el) => observer.observe(el));
    const timer = window.setInterval(() => void acknowledgeVisible(), 750);
    return () => { active = false; observer.disconnect(); window.clearInterval(timer); };
  }, [messages, selectedPhone, loadingMessages, token]);

  useEffect(() => {
    const viewport = messagesViewport.current;
    if (!viewport || loadingMessages) return;
    const lastId = messages.at(-1)?.id || "";
    const changedConversation = lastScroll.current.phone !== selectedPhone;
    const newMessage = lastScroll.current.message !== lastId;
    const nearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120;
    if (changedConversation || (newMessage && nearBottom)) requestAnimationFrame(() => { viewport.scrollTop = viewport.scrollHeight; });
    lastScroll.current = { phone: selectedPhone, message: lastId };
  }, [messages, selectedPhone, loadingMessages]);
  useEffect(() => {
    if (!token) return;
    void Promise.all([inboxApi<Label[]>("/labels", token).then(setLabels), inboxApi<QuickReply[]>("/quick-replies", token).then(setQuickReplies)]).catch(() => undefined);
    const timer = window.setInterval(() => { void loadConversations(); void loadMessages(); }, 10000);
    return () => window.clearInterval(timer);
  }, [loadConversations, loadMessages, token]);

  const selected = conversations.find((item) => item.phone === selectedPhone);
  const filtered = useMemo(() => conversations.filter((item) => (!unreadOnly || (item.unreadCount || 0) > 0) && `${item.name} ${item.phone}`.toLowerCase().includes(search.toLowerCase())), [conversations, search, unreadOnly]);
  const lastLocation = useMemo(() => [...messages].reverse().find((item) => item.latitude != null && item.longitude != null), [messages]);

  async function uploadFiles(files: File[]) {
    const media: MediaAttachment[] = [];
    for (const file of files.slice(0, 5)) { const form = new FormData(); form.append("file", file); const response = await apiFetch("/admin/whatsapp-campaigns/media", { method: "POST", body: form, headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error("Não foi possível anexar o arquivo"); media.push(await response.json()); }
    return media;
  }

  async function toggleRecording() {
    if (recording) { recorderRef.current?.stop(); return; }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks.current = [];
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => { if (event.data.size) recordedChunks.current.push(event.data); };
    recorder.onstop = () => { const type = recorder.mimeType || "audio/webm"; setAttachments((items) => [...items, new File(recordedChunks.current, `audio-${Date.now()}.webm`, { type })].slice(0, 5)); stream.getTracks().forEach((track) => track.stop()); setRecording(false); };
    recorder.start(); setRecording(true);
  }

  async function sendMessage() {
    if ((!draft.trim() && !attachments.length) || !selectedPhone || busy) return;
    setBusy(true);
    try {
      const media = await uploadFiles(attachments);
      await inboxApi("/send", token, { method: "POST", body: JSON.stringify({ phone: selectedPhone, message: draft.trim(), media }) });
      setDraft(""); setAttachments([]); await Promise.all([loadMessages(), loadConversations()]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao enviar"); }
    finally { setBusy(false); }
  }

  async function addCustomer() {
    if (!contactName.trim() || !selectedPhone) return;
    setBusy(true);
    try {
      const created = await inboxApi<{ temporaryPassword?: string | null }>("/contact", token, { method: "POST", body: JSON.stringify({ phone: selectedPhone, name: contactName.trim() }) });
      setTemporaryPassword(created.temporaryPassword || "");
      if (created.temporaryPassword) {
        const accessLink = `https://yasmimlanches.hubregional.com.br/account?phone=${encodeURIComponent(selectedPhone)}&password=${encodeURIComponent(created.temporaryPassword)}`;
        await inboxApi("/send", token, { method: "POST", body: JSON.stringify({ phone: selectedPhone, message: `Olá! Seu acesso à loja Yasmim Lanches foi criado.\n\nLogin: ${selectedPhone}\nSenha temporária: ${created.temporaryPassword}\n\nAcesse diretamente: ${accessLink}\n\nNo primeiro acesso, troque sua senha por uma senha pessoal.` }) });
      }
      setContactName(""); await loadConversations();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao adicionar cliente"); }
    finally { setBusy(false); }
  }

  async function createLabel() {
    if (!labelName.trim()) return;
    try { const created = await inboxApi<Label>("/labels", token, { method: "POST", body: JSON.stringify({ name: labelName.trim() }) }); setLabels((items) => [...items, created]); setLabelName(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao criar etiqueta"); }
  }

  async function createShortcut() {
    if (!shortcutName.trim() || (!shortcutMessage.trim() && !shortcutAttachments.length)) return;
    try { const media = await uploadFiles(shortcutAttachments); const created = await inboxApi<QuickReply>("/quick-replies", token, { method: "POST", body: JSON.stringify({ name: shortcutName.trim(), message: shortcutMessage.trim(), media }) }); setQuickReplies((items) => [...items, created]); setShortcutName(""); setShortcutMessage(""); setShortcutAttachments([]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao criar atalho"); }
  }

  async function saveShortcut() {
    if (!editingShortcutId || !shortcutName.trim()) return;
    try {
      const current = quickReplies.find((item) => item.id === editingShortcutId); const media = shortcutAttachments.length ? await uploadFiles(shortcutAttachments) : (current?.media || []);
      const updated = await inboxApi<QuickReply>(`/quick-replies/${editingShortcutId}`, token, { method: "PATCH", body: JSON.stringify({ name: shortcutName.trim(), message: shortcutMessage.trim(), media }) });
      setQuickReplies((items) => items.map((item) => item.id === updated.id ? updated : item));
      setEditingShortcutId(null); setShortcutName(""); setShortcutMessage("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao editar atalho"); }
  }

  async function sendShortcut(item: QuickReply) {
    if (!selectedPhone || busy) return; setBusy(true);
    try { await inboxApi("/send", token, { method: "POST", body: JSON.stringify({ phone: selectedPhone, message: item.message || "", media: item.media || [] }) }); await Promise.all([loadMessages(), loadConversations()]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao enviar atalho"); } finally { setBusy(false); }
  }

  async function removeShortcut(id: string) {
    if (!window.confirm("Excluir este atalho?")) return;
    try { await inboxApi(`/quick-replies/${id}`, token, { method: "DELETE" }); setQuickReplies((items) => items.filter((item) => item.id !== id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao excluir atalho"); }
  }

  async function openManualOrder() {
    if (!selectedPhone) return;
    setError("");
    setManualAddress(lastLocation ? `Localizacao WhatsApp (${Number(lastLocation.latitude).toFixed(6)}, ${Number(lastLocation.longitude).toFixed(6)})` : (selected?.address && selected.address !== "Localizacao recebida pelo WhatsApp" ? selected.address : ""));
    setManualNumber(selected?.number || (lastLocation ? "S/N" : ""));
    setManualDistrict(selected?.district || (lastLocation ? "A confirmar" : ""));
    setManualComplement(selected?.complement || "");
    setFreightQuote(null); setFreightError("");
    try {
      const saved = await inboxApi<CustomerAddress[]>(`/addresses/${encodeURIComponent(selectedPhone)}`, token).catch(() => []);
      setSavedAddresses(saved);
      if (lastLocation) {
        const geo = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lastLocation.latitude}&lon=${lastLocation.longitude}&zoom=18&addressdetails=1`, { headers: { "Accept-Language": "pt-BR" } }).then((response) => response.ok ? response.json() : null).catch(() => null) as { address?: Record<string, string>; display_name?: string } | null;
        const parts = geo?.address;
        if (parts) {
          setManualAddress(parts.road || parts.pedestrian || parts.residential || geo?.display_name || `Localizacao WhatsApp (${Number(lastLocation.latitude).toFixed(6)}, ${Number(lastLocation.longitude).toFixed(6)})`);
          setManualNumber(parts.house_number || "S/N");
          setManualDistrict(parts.suburb || parts.neighbourhood || parts.city_district || "A confirmar");
        }
      }
      const response = await apiFetch("/admin/products", { headers: { Authorization: `Bearer ${token}` } });
      const data = await readApiJson<Product[]>(response);
      setProducts(data.filter((item) => item.active !== false && item.available !== false));
      await quoteFreight(lastLocation?.latitude, lastLocation?.longitude);
      setShowManualOrder(true);
    } catch { setError("Nao foi possivel carregar os produtos para o pedido manual"); }
  }

  async function quoteFreight(latitude?: number | null, longitude?: number | null) {
    if (latitude == null || longitude == null) { setFreightQuote(null); return; }
    try {
      const response = await apiFetch(`/delivery/quote?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`);
      const data = await readApiJson<{ fee: number; distanceKm?: number | null; message?: string }>(response);
      if (!response.ok) throw new Error(data.message || "Não foi possível calcular o frete.");
      setFreightQuote({ fee: Number(data.fee), distanceKm: data.distanceKm }); setFreightError("");
    } catch (cause) { setFreightQuote(null); setFreightError(cause instanceof Error ? cause.message : "Não foi possível calcular o frete."); }
  }

  async function createManualOrder() {
    const items = Object.entries(quantities).filter(([, quantity]) => quantity > 0).map(([productId, quantity]) => ({ productId, quantity, complements: [] }));
    if (!selectedPhone || !items.length) { setError("Selecione ao menos um produto"); return; }
    if (!manualAddress.trim() || !manualNumber.trim() || !manualDistrict.trim()) { setError("Preencha endereco, numero e bairro"); return; }
    setBusy(true);
    try {
      const response = await apiFetch("/orders", { method: "POST", body: JSON.stringify({
        customer: { name: selected?.name || contactName || selectedPhone, phone: selectedPhone, address: manualAddress, number: manualNumber, district: manualDistrict, complement: manualComplement || undefined, latitude: lastLocation?.latitude != null ? Number(lastLocation.latitude) : undefined, longitude: lastLocation?.longitude != null ? Number(lastLocation.longitude) : undefined },
        fulfillmentType: "DELIVERY", source: "DELIVERY", paymentMethod, items, manualOrder: true, notes: "Pedido manual criado pelo atendimento WhatsApp"
      }) });
      if (!response.ok) { const data: { message?: string } = await readApiJson<{ message?: string }>(response).catch(() => ({})); throw new Error(data.message || "Falha ao criar pedido"); }
      setShowManualOrder(false); setQuantities({}); setError("");
      alert("Pedido manual criado e enviado para o fluxo normal da loja.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Falha ao criar pedido manual";
      setError(message.includes("pausou") || message.includes("pausada") ? "A loja está pausada para pedidos normais, mas o pedido manual deve ser liberado. Atualize a página e tente novamente." : message.includes("fora da area") ? "A localização está fora da área de entrega configurada. Confira o endereço ou confirme com a loja." : `Não foi possível criar o pedido: ${message}`);
    }
    finally { setBusy(false); }
  }

  if (!token) return <div className="rounded-2xl bg-white p-6">Entre novamente para acessar o WhatsApp.</div>;

  return <section className="mt-5 flex h-[calc(100dvh-118px)] min-h-[560px] flex-col overflow-hidden rounded-2xl border border-emerald-900/10 bg-white shadow-sm">
    <style>{`@keyframes whatsapp-unread-pulse { 0%, 100% { background-color: #ecfdf5; } 50% { background-color: #a7f3d0; } } .whatsapp-unread { animation: whatsapp-unread-pulse 2s ease-in-out infinite; border-left: 4px solid #047857; } @media (prefers-reduced-motion: reduce) { .whatsapp-unread { animation: none; background-color: #d1fae5; } }`}</style><div className="flex flex-wrap items-center justify-between gap-3 border-b bg-emerald-800 px-5 py-4 text-white"><div><p className="text-xs font-bold uppercase tracking-wider text-emerald-200">WhatsApp</p><h2 className="text-2xl font-bold">Conversas</h2></div><div className="flex gap-2"><a className="rounded-xl bg-white/15 px-4 py-2 text-sm font-bold" href="/admin/whatsapp" target="_blank" rel="noreferrer">Abrir em guia</a><button className="rounded-xl bg-white/15 px-4 py-2 text-sm font-bold" onClick={() => { void loadConversations(); void loadMessages(); }}>Atualizar</button><button className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-emerald-800" onClick={() => setShowTools((value) => !value)}>Etiquetas e atalhos</button></div></div>
    {error && <div className="bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
    {showTools && <div className="border-b bg-emerald-50 p-4"><div className="flex items-center justify-between"><h3 className="font-bold text-emerald-900">Atalhos rápidos</h3><button className="rounded-lg bg-emerald-700 px-3 py-1 text-sm font-bold text-white" onClick={() => setShowTools(false)}>Fechar</button></div><div className="mt-3 grid gap-2 md:grid-cols-[180px_1fr_auto_auto]"><input className="rounded-lg border px-3 py-2 text-sm" placeholder="Nome do atalho" value={shortcutName} onChange={(e) => setShortcutName(e.target.value)} /><input className="rounded-lg border px-3 py-2 text-sm" placeholder="Mensagem" value={shortcutMessage} onChange={(e) => setShortcutMessage(e.target.value)} /><label className="cursor-pointer rounded-lg border bg-white px-3 py-2 text-sm">📎 Anexos<input className="hidden" type="file" multiple accept="image/*,video/*,audio/*" onChange={(e) => setShortcutAttachments(Array.from(e.target.files || []).slice(0, 5))} /></label><button className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white" onClick={() => void (editingShortcutId ? saveShortcut() : createShortcut())}>{editingShortcutId ? "Salvar" : "Adicionar"}</button></div>{shortcutAttachments.length > 0 && <p className="mt-2 text-xs text-slate-600">{shortcutAttachments.length} anexo(s) selecionado(s)</p>}{quickReplies.length > 0 && <div className="mt-3 space-y-1">{quickReplies.map((item) => <div key={item.id} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm"><span><b>{item.name}</b><span className="ml-2 text-slate-500">{item.message}</span>{Boolean(item.media?.length) && <span className="ml-2">📎 {item.media?.length}</span>}</span><span className="flex gap-2"><button className="text-emerald-700 underline" onClick={() => { setEditingShortcutId(item.id); setShortcutName(item.name); setShortcutMessage(item.message); setShortcutAttachments([]); }}>Editar</button><button className="text-red-700 underline" onClick={() => void removeShortcut(item.id)}>Excluir</button></span></div>)}</div>}</div>}
    {selectedPhone && <div className="border-b bg-white px-4 py-2"><button type="button" className={`rounded-lg border px-3 py-2 text-sm font-bold ${recording ? "border-red-500 text-red-700" : "border-emerald-600 text-emerald-800"}`} onClick={() => void toggleRecording()}>{recording ? "■ Parar gravação" : "🎤 Gravar áudio"}</button></div>}
    <div className="grid min-h-0 flex-1 md:grid-cols-[270px_minmax(0,1fr)_250px]">
      <aside className="min-h-0 overflow-hidden border-r bg-slate-50"><div className="p-3"><input className="w-full rounded-xl border bg-white px-3 py-2 text-sm" placeholder="Buscar conversa" value={search} onChange={(e) => setSearch(e.target.value)} /></div><div className="px-3 pb-2"><button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly((value) => !value)} className={`w-full rounded-lg border px-3 py-2 text-sm font-bold ${unreadOnly ? "bg-emerald-700 text-white" : "bg-white text-emerald-800"}`}>Não lidas ({conversations.reduce((total, item) => total + (item.unreadCount || 0), 0)})</button></div><div className="h-[calc(100%-120px)] overflow-y-auto">{loadingConversations ? <p className="p-5 text-center text-sm text-slate-500">Carregando conversas…</p> : filtered.map((item) => <button key={item.phone} onClick={() => { if (item.phone !== selectedPhone) { selectedPhoneRef.current = item.phone; setMessages([]); messagesLoaded.current = false; setLoadingMessages(true); setSelectedPhone(item.phone); } }} className={`block w-full border-t px-4 py-3 text-left ${(item.unreadCount || 0) > 0 ? "whatsapp-unread" : ""} ${selectedPhone === item.phone ? "bg-emerald-100" : "hover:bg-white"}`}><b className="block truncate text-sm">{item.name || item.phone}</b>{(item.unreadCount || 0) > 0 && <span className="inline-block rounded-full bg-emerald-700 px-2 py-0.5 text-xs font-bold text-white" aria-label={`${item.unreadCount} mensagens não lidas`}>{item.unreadCount} não lida{item.unreadCount === 1 ? "" : "s"}</span>}<span className="block truncate text-xs text-slate-500">{item.lastMessage || "Sem mensagem"}</span><small className="text-[10px] text-slate-400">{time(item.lastMessageAt)}</small></button>)}{!loadingConversations && !filtered.length && <p className="p-5 text-center text-sm text-slate-400">{unreadOnly ? "Nenhuma mensagem não lida." : "Nenhuma conversa recebida ainda."}</p>}</div></aside>
      <div className="flex min-h-0 min-w-0 flex-col bg-[#f4faf7]"><div className="border-b bg-white px-4 py-3"><b>{selected?.name || selectedPhone || "Selecione uma conversa"}</b>{selectedPhone && <span className="ml-2 text-xs text-slate-500">{selectedPhone}</span>}</div><div ref={messagesViewport} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">{loadingMessages ? <p className="pt-20 text-center text-sm text-slate-500">Carregando mensagens…</p> : messages.map((item) => <div key={item.id} data-unread-id={item.direction === "in" && item.readAt === null ? item.id : undefined} className={`flex ${item.direction === "out" ? "justify-end" : "justify-start"}`}><div className={`max-w-[78%] rounded-2xl px-4 py-2 text-sm shadow-sm ${item.direction === "out" ? "bg-emerald-100" : "bg-white"}`}><WhatsappMessageContent item={item} token={token} /><small className="mt-1 block text-[10px] text-slate-500">{time(item.sentAt)}</small></div></div>)}{selectedPhone && !loadingMessages && !messages.length && <p className="pt-20 text-center text-sm text-slate-400">Ainda não há mensagens nesta conversa.</p>}</div><div className="border-t bg-white p-3"><div className="mb-2 flex flex-wrap gap-1">{selectedPhone && <button type="button" className="rounded-full border border-amber-600 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800" onClick={() => setDraft(`Olá, ${selected?.name || "tudo bem"}! Seu pedido está pronto para retirada no local. Estamos aguardando você!`)}>📦 Pronto para retirada</button>}{quickReplies.map((item) => <button key={item.id} className="rounded-full border border-emerald-600 px-2 py-1 text-xs text-emerald-800" onClick={() => setDraft(item.message)}>{item.name}</button>)}</div><div className="mb-2 flex items-center gap-2"><label className="cursor-pointer rounded-lg border px-3 py-2 text-sm" title="Anexar áudio, vídeo ou imagem">📎<input className="hidden" type="file" accept="image/*,audio/*,video/*" multiple onChange={(e) => setAttachments(Array.from(e.target.files || []).slice(0, 5))} /></label>{attachments.length > 0 && <span className="text-xs text-slate-600">{attachments.length} anexo(s) selecionado(s)</span>}</div><div className="flex gap-2"><textarea disabled={!selectedPhone} className="min-h-12 flex-1 resize-none rounded-xl border px-3 py-2 text-sm" placeholder="Digite uma mensagem" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }} /><button disabled={!selectedPhone || busy} className="rounded-xl bg-emerald-700 px-5 font-bold text-white disabled:opacity-50" onClick={() => void sendMessage()}>{busy ? "..." : "Enviar"}</button></div></div></div>
      <aside className="min-h-0 overflow-y-auto border-l bg-white p-4"><h3 className="font-bold">Contato</h3>{selectedPhone ? <><p className="mt-1 text-sm text-slate-500">{selectedPhone}</p>{selected?.isCustomer ? <div className="mt-4 rounded-xl bg-emerald-50 p-3"><span className="text-xs text-emerald-700">Cliente cadastrado</span><b className="block">{selected.name}</b><button className="mt-3 w-full rounded-xl bg-emerald-700 px-3 py-3 font-bold text-white" onClick={() => void openManualOrder()}>Adicionar pedido</button></div> : <div className="mt-4 space-y-2"><p className="text-sm text-slate-600">Este número ainda não é cliente.</p><input className="input mt-0" placeholder="Nome da pessoa" value={contactName} onChange={(e) => setContactName(e.target.value)} /><input className="input mt-0 bg-slate-50" value={selectedPhone} readOnly /><button className="w-full rounded-xl bg-emerald-700 px-3 py-3 font-bold text-white" onClick={() => void addCustomer()}>Adicionar cliente</button>{temporaryPassword && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Senha temporária: <b>{temporaryPassword}</b><br />No primeiro acesso, o cliente deverá criar outra senha.</p>}</div>}{lastLocation && <p className="mt-3 rounded-lg bg-sky-50 p-2 text-xs text-sky-800">Localização recebida: pronta para preencher o pedido.</p>}<div className="mt-5 border-t pt-4"><h4 className="text-sm font-bold">Etiquetas disponíveis</h4><div className="mt-2 flex flex-wrap gap-1">{labels.map((item) => <span key={item.id} className="rounded-full bg-slate-100 px-2 py-1 text-xs">{item.name}</span>)}{!labels.length && <span className="text-xs text-slate-400">Crie uma etiqueta acima.</span>}</div></div></> : <p className="mt-4 text-sm text-slate-400">Selecione uma conversa.</p>}</aside>
    </div>
    {showManualOrder && <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-4"><div className="mx-auto my-8 max-w-2xl rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><div><h3 className="text-xl font-bold">Pedido manual</h3><p className="text-sm text-slate-500">{selected?.name} · {selectedPhone}</p></div><button className="rounded-lg px-3 py-2" onClick={() => setShowManualOrder(false)}>Fechar</button></div>{savedAddresses.length > 0 && <div className="mt-4"><label className="mb-1 block text-xs font-bold text-slate-600">Endereço salvo</label><select className="w-full rounded-xl border px-3 py-2" defaultValue="" onChange={(e) => { const address = savedAddresses.find((item) => item.id === e.target.value); if (!address) return; setManualAddress(address.address); setManualNumber(address.number || "S/N"); setManualDistrict(address.district || "A confirmar"); setManualComplement(address.complement || ""); void quoteFreight(address.latitude, address.longitude); }}><option value="">Escolher endereço…</option>{savedAddresses.map((address) => <option key={address.id} value={address.id}>{address.label || "Endereço"} — {address.address}, {address.number || "S/N"}</option>)}</select></div>}<div className="mt-4 grid gap-2 md:grid-cols-2"><input className="input mt-0" value={manualAddress} onChange={(e) => setManualAddress(e.target.value)} placeholder="Endereço" /><input className="input mt-0" value={manualNumber} onChange={(e) => setManualNumber(e.target.value)} placeholder="Número" /><input className="input mt-0" value={manualDistrict} onChange={(e) => setManualDistrict(e.target.value)} placeholder="Bairro" /><input className="input mt-0" value={manualComplement} onChange={(e) => setManualComplement(e.target.value)} placeholder="Complemento" /></div>{lastLocation && <p className="mt-2 text-xs text-emerald-700">✓ Coordenadas da localização do WhatsApp serão usadas no cálculo do frete.</p>}{freightQuote && <p className="mt-2 rounded-lg bg-emerald-50 p-3 text-sm font-bold text-emerald-800">Frete: R$ {freightQuote.fee.toFixed(2)}{freightQuote.distanceKm != null ? ` · ${Number(freightQuote.distanceKm).toFixed(1)} km` : ""}</p>}{freightError && <p className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Frete não calculado: {freightError}</p>}<div className="mt-4 max-h-60 overflow-y-auto rounded-xl border">{products.map((product) => <div key={product.id} className="flex items-center justify-between border-b px-3 py-2"><span>{product.name} <small className="text-slate-500">R$ {Number(product.price).toFixed(2)}</small></span><div className="flex items-center gap-2"><button className="rounded border px-2" onClick={() => setQuantities((current) => ({ ...current, [product.id]: Math.max(0, (current[product.id] || 0) - 1) }))}>−</button><b>{quantities[product.id] || 0}</b><button className="rounded border px-2" onClick={() => setQuantities((current) => ({ ...current, [product.id]: (current[product.id] || 0) + 1 }))}>+</button></div></div>)}</div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><select className="rounded-xl border px-3 py-2" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}><option value="PIX">Pix</option><option value="CASH">Dinheiro</option><option value="CARD">Cartão</option></select><button disabled={busy} className="rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-50" onClick={() => void createManualOrder()}>{busy ? "Criando..." : "Criar pedido e enviar à loja"}</button></div></div></div>}
  </section>;
}

