import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Mic, Send, Square, Volume2, VolumeX, X } from "lucide-react";
import { apiFetch, apiGet } from "../contexts/api";

interface Report { report: string; filters: Record<string, string | string[] | number> }
interface Msg { role: "user" | "assistant"; content: string; reports?: Report[]; error?: boolean }

const L: Record<string, [string, string]> = {
  title: ["AI assistant", "المساعد الذكي"],
  hint: ["Ask about sales, expenses, purchases or stock. Example: What were Al Jahra's sales last month?",
    "اسأل عن المبيعات أو المصاريف أو المشتريات أو المخزون. مثال: كم مبيعات الجهراء الشهر الماضي؟"],
  placeholder: ["Type your question…", "اكتب سؤالك…"],
  thinking: ["Working it out…", "جاري التحضير…"],
  listening: ["Listening… press stop when done", "جاري الاستماع… اضغط إيقاف عند الانتهاء"],
  not_setup: ["The assistant is not set up yet.", "المساعد غير مفعّل بعد."],
  failed: ["Something went wrong", "حدث خطأ"],
  no_mic: ["The microphone is not available", "الميكروفون غير متاح"],
  sales_report: ["Sales", "المبيعات"],
  expense_report: ["Expenses", "المصاريف"],
  purchase_report: ["Purchases", "المشتريات"],
  stock_report: ["Stock", "المخزون"],
};

export default function AssistantPanel() {
  const { i18n } = useTranslation();
  const ar = i18n.language === "ar";
  const tr = (k: string) => (L[k] ? L[k][ar ? 1 : 0] : k);
  const [status, setStatus] = useState<{ available: boolean; configured: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [speak, setSpeak] = useState(() => localStorage.getItem("assistantSpeak") === "1");
  const recorder = useRef<MediaRecorder | null>(null);
  const end = useRef<HTMLDivElement | null>(null);

  useEffect(() => { apiGet("/api/assistant/status").then(setStatus).catch(() => setStatus(null)); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);
  useEffect(() => { localStorage.setItem("assistantSpeak", speak ? "1" : "0"); }, [speak]);

  if (!status?.available) return null;

  const play = async (answer: string) => {
    const body = new FormData();
    body.append("text", answer);
    body.append("lang", ar ? "ar" : "en");
    const res = await apiFetch("/api/assistant/speech", { method: "POST", body });
    if (res.ok) new Audio(URL.createObjectURL(await res.blob())).play().catch(() => {});
  };

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const history = msgs.filter((m) => !m.error).slice(-6).map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setText("");
    setBusy(true);
    const body = new FormData();
    body.append("question", q);
    body.append("lang", ar ? "ar" : "en");
    body.append("history", JSON.stringify(history));
    try {
      const res = await apiFetch("/api/assistant/ask", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || tr("failed"));
      setMsgs((m) => [...m, { role: "assistant", content: data.answer, reports: data.reports }]);
      if (speak) play(data.answer);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const toggleMic = async () => {
    if (recording) { recorder.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        const body = new FormData();
        body.append("file", blob, rec.mimeType.includes("mp4") ? "voice.mp4" : "voice.webm");
        setBusy(true);
        const res = await apiFetch("/api/assistant/transcribe", { method: "POST", body });
        const data = await res.json().catch(() => ({}));
        setBusy(false);
        if (res.ok && data.text) ask(data.text);
        else setMsgs((m) => [...m, { role: "assistant", content: data.detail || tr("failed"), error: true }]);
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: tr("no_mic"), error: true }]);
    }
  };

  const filters = (r: Report) => Object.values(r.filters)
    .map((v) => (Array.isArray(v) ? (v.length > 3 ? `${v.slice(0, 3).join(", ")} +${v.length - 3}` : v.join(", ")) : String(v)))
    .join(" · ");

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} title={tr("title")}
          className={`fixed bottom-5 ${ar ? "left-5" : "right-5"} z-40 rounded-full bg-emerald-700 text-white p-4 shadow-lg hover:bg-emerald-600`}>
          <Bot size={24} />
        </button>
      )}
      {open && (
        <div dir={ar ? "rtl" : "ltr"}
          className={`fixed bottom-4 ${ar ? "left-4" : "right-4"} z-40 w-[calc(100vw-2rem)] max-w-md h-[70vh] bg-white rounded-xl shadow-2xl border flex flex-col`}>
          <div className="flex items-center gap-2 px-4 py-3 bg-emerald-700 text-white rounded-t-xl">
            <Bot size={20} />
            <span className="font-semibold flex-1">{tr("title")}</span>
            <button onClick={() => setSpeak(!speak)} title={speak ? "🔊" : "🔇"} className="p-1 hover:bg-emerald-600 rounded">
              {speak ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <button onClick={() => setOpen(false)} className="p-1 hover:bg-emerald-600 rounded"><X size={18} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
            {!status.configured && <div className="text-amber-700 bg-amber-50 rounded p-2">{tr("not_setup")}</div>}
            {msgs.length === 0 && <div className="text-gray-500">{tr("hint")}</div>}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 whitespace-pre-wrap ${m.role === "user"
                  ? "bg-emerald-600 text-white" : m.error ? "bg-red-50 text-red-700" : "bg-gray-100 text-gray-800"}`}>
                  {m.content}
                  {m.reports?.map((r, j) => (
                    <div key={j} className="mt-1 text-[11px] text-gray-500">{tr(r.report)}: {filters(r)}</div>
                  ))}
                  {m.role === "assistant" && !m.error && !speak && (
                    <button onClick={() => play(m.content)} className="mt-1 block text-gray-400 hover:text-emerald-700"><Volume2 size={14} /></button>
                  )}
                </div>
              </div>
            ))}
            {busy && <div className="text-gray-400">{tr("thinking")}</div>}
            {recording && <div className="text-red-600">{tr("listening")}</div>}
            <div ref={end} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); ask(text); }} className="flex items-center gap-2 p-3 border-t">
            <button type="button" onClick={toggleMic} disabled={busy && !recording}
              className={`p-2 rounded-full ${recording ? "bg-red-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
              {recording ? <Square size={18} /> : <Mic size={18} />}
            </button>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tr("placeholder")}
              className="flex-1 border rounded-full px-3 py-2 text-sm" disabled={recording} />
            <button type="submit" disabled={busy || !text.trim()} className="p-2 rounded-full bg-emerald-700 text-white disabled:opacity-40">
              <Send size={18} className={ar ? "rotate-180" : ""} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
