"use client";
import { useEffect, useRef, useState } from "react";
import { apiFetch, readApiJson } from "../lib/api";

type Message = { id: string; body: string; messageType?: string; mediaUrl?: string | null; latitude?: number | null; longitude?: number | null };
type Content = { text: string; messageType: string; latitude?: number; longitude?: number; base64?: string; mimeType?: string; filename?: string };
const names: Record<string, string> = { image: "Imagem", sticker: "Figurinha", audio: "Áudio", video: "Vídeo", document: "Documento" };

export default function WhatsappMessageContent({ item, token }: { item: Message; token: string }) {
  const [content, setContent] = useState<Content | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const attempted = useRef(false);
  const kind = content?.messageType || item.messageType || "text";
  const text = content?.text || item.body;
  const latitude = content?.latitude ?? item.latitude;
  const longitude = content?.longitude ?? item.longitude;
  const location = latitude != null && longitude != null && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) && Math.abs(Number(latitude)) <= 90 && Math.abs(Number(longitude)) <= 180;
  const empty = !text || /^\[(text|texto|mensagem)\]$/i.test(text);

  async function load(download = true) {
    setBusy(true); setError("");
    try {
      const res = await apiFetch(`/admin/whatsapp/inbox/content/${encodeURIComponent(item.id)}?download=${download ? 1 : 0}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await readApiJson<Content & { message?: string }>(res);
      if (!res.ok) throw new Error(data.message || "Não foi possível carregar o conteúdo.");
      setContent(data);
      if (data.base64) {
        const raw = atob(data.base64.replace(/^data:[^,]+,/, ""));
        const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        const mime = /^(image\/(jpeg|png|webp|gif)|audio\/(mpeg|mp4|ogg|wav|webm|aac)|video\/(mp4|webm|ogg))(;.*)?$/i.test(data.mimeType || "") ? data.mimeType! : "application/octet-stream";
        setUrl(URL.createObjectURL(new Blob([bytes], { type: mime })));
      } else if (!data.text && data.messageType === "text") setError("Conteúdo antigo indisponível. Peça o reenvio pelo WhatsApp.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar mídia."); }
    finally { setBusy(false); }
  }
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => {
    if (item.mediaUrl && !url) setUrl(item.mediaUrl);
  }, [item.mediaUrl, url]);
  useEffect(() => {
    if (!empty || location || kind !== "text" || attempted.current || !root.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !attempted.current) { attempted.current = true; observer.disconnect(); void load(false); }
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [item.id, empty, location, kind]);

  return <div ref={root} className="space-y-2">
    {location && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><b className="block">📍 Localização compartilhada</b><span className="block text-xs text-slate-500">{Number(latitude).toFixed(6)}, {Number(longitude).toFixed(6)}</span><a className="mt-2 inline-block font-bold text-emerald-800 underline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`} target="_blank" rel="noopener noreferrer">Abrir no mapa ↗</a></div>}
    {names[kind] && <div className="space-y-2"><b className="block">{names[kind]}</b>{!url ? <button disabled={busy} className="rounded-lg border border-emerald-600 px-3 py-2 text-emerald-800 disabled:opacity-50" onClick={() => void load()}>{busy ? "Carregando…" : `Carregar ${names[kind].toLowerCase()}`}</button> : <>
      {(kind === "image" || kind === "sticker") && <button onClick={() => setExpanded(true)} aria-label="Ampliar imagem"><img src={url} alt={text || names[kind]} className="max-h-72 max-w-full rounded-lg" onError={() => setError("Formato não compatível com o navegador. Baixe o arquivo para abrir.")} /></button>}
      {kind === "audio" && <audio controls preload="metadata" src={url} className="max-w-full" onError={() => setError("Não foi possível reproduzir. Baixe o áudio para ouvir.")} />}
      {kind === "video" && <video controls playsInline preload="metadata" src={url} className="max-h-80 max-w-full rounded-lg" onError={() => setError("Não foi possível reproduzir. Baixe o vídeo para assistir.")} />}
      <a href={url} download={content?.filename || "anexo"} className="block text-xs text-emerald-800 underline">Baixar {content?.filename || "arquivo"}</a>
    </>}</div>}
    {!empty && <p className="whitespace-pre-wrap break-words">{text}</p>}
    {empty && !names[kind] && !location && <button disabled={busy} className="text-emerald-800 underline" onClick={() => void load()}>{busy ? "Buscando conteúdo…" : "Recuperar conteúdo da mensagem"}</button>}
    {error && <p role="status" className="max-w-sm text-xs text-amber-800">{error}</p>}
    {expanded && <div role="dialog" aria-modal="true" aria-label="Imagem ampliada" className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/85 p-4" onClick={() => setExpanded(false)}><button className="mb-3 rounded-lg bg-white px-4 py-2" autoFocus onClick={() => setExpanded(false)}>Fechar imagem</button><img src={url} alt={text || "Imagem ampliada"} className="max-h-[85vh] max-w-full object-contain" /></div>}
  </div>;
}
