import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch, apiGet } from "../contexts/api";

type Name = { en: string; ar: string };
interface PosConfig {
  api_url: string; web_url: string; has_key: boolean; auto_sync: boolean; import_receipts: boolean;
  last_sync_at: string | null; last_error: string | null; channels: string[];
  sso: { issuer: string; jwks_url: string; audience: string };
}
interface PosBranch { id: string; name: Name; brand: string; is_active: boolean }
interface PosMethod { key: string; name: Name }
interface Branch { id: number; name: string }

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuwait" });

export default function PosSettingsPanel({ branches }: { branches: Branch[] }) {
  const { t, i18n } = useTranslation();
  const [cfg, setCfg] = useState<PosConfig | null>(null);
  const [apiUrl, setApiUrl] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [autoSync, setAutoSync] = useState(true);
  const [receipts, setReceipts] = useState(true);
  const [posBranches, setPosBranches] = useState<PosBranch[]>([]);
  const [methods, setMethods] = useState<PosMethod[]>([]);
  const [branchMap, setBranchMap] = useState<Record<string, string>>({});
  const [methodMap, setMethodMap] = useState<Record<string, string>>({});
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const label = (n: Name) => (i18n.language === "ar" ? n.ar || n.en : n.en || n.ar);

  const load = async () => {
    const c: PosConfig = await apiGet("/api/pos/settings");
    setCfg(c);
    setApiUrl(c.api_url); setWebUrl(c.web_url); setAutoSync(c.auto_sync); setReceipts(c.import_receipts);
    const bm = await apiGet("/api/pos/branch-mappings");
    if (Array.isArray(bm)) setBranchMap(Object.fromEntries(bm.map((m) => [m.pos_branch_id, String(m.local_branch_id)])));
    const pm = await apiGet("/api/pos/payment-mappings");
    if (Array.isArray(pm)) setMethodMap(Object.fromEntries(pm.map((m) => [m.pos_method, m.local_channel])));
  };
  useEffect(() => { Promise.resolve().then(load).catch(() => undefined); }, []);

  const call = async (key: string, path: string, body?: Record<string, string>) => {
    setBusy(key); setMsg(null);
    try {
      const res = await apiFetch(path, body ? { method: "POST", body: new URLSearchParams(body) } : { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || t("error"));
      return data;
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
      return null;
    } finally { setBusy(""); }
  };

  const fetchStructure = async () => {
    setBusy("structure"); setMsg(null);
    const res = await apiFetch("/api/pos/structure");
    const data = await res.json();
    setBusy("");
    if (!res.ok) { setMsg({ text: data.detail || t("error"), ok: false }); return; }
    setPosBranches(data.branches); setMethods(data.methods);
  };

  const saveBranch = async (b: PosBranch, local: string) => {
    setBranchMap((m) => ({ ...m, [b.id]: local }));
    await call("", "/api/pos/branch-mappings", { pos_branch_id: b.id, pos_branch_name: `${b.brand} - ${b.name.en}`, local_branch_id: local });
  };
  const saveMethod = async (m: PosMethod, channel: string) => {
    setMethodMap((x) => ({ ...x, [m.key]: channel }));
    await call("", "/api/pos/payment-mappings", { pos_method: m.key, pos_method_name: m.name.en, local_channel: channel });
  };

  const input = "w-full px-3 py-2 border rounded-lg text-sm";
  const button = "px-3 py-1.5 rounded text-xs disabled:opacity-50";
  const branchRows = posBranches.length ? posBranches
    : Object.keys(branchMap).map((id) => ({ id, name: { en: id, ar: id }, brand: "", is_active: true }));

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border max-w-4xl mb-6">
      <h3 className="text-lg font-semibold mb-1">{t("pos_integration")}</h3>
      <p className="text-sm text-gray-500 mb-4">{t("pos_integration_desc")}</p>
      {msg && <div className={`p-3 rounded mb-4 text-sm ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.text}</div>}
      {cfg?.last_error && !msg && <div className="p-3 rounded mb-4 text-sm bg-amber-50 text-amber-800">{t("pos_last_error")}: {cfg.last_error}</div>}

      <form className="grid grid-cols-1 md:grid-cols-2 gap-3" onSubmit={async (e) => {
        e.preventDefault();
        const ok = await call("save", "/api/pos/settings", {
          api_url: apiUrl, web_url: webUrl, api_key: apiKey,
          auto_sync: String(autoSync), import_receipts: String(receipts),
        });
        if (ok) { setApiKey(""); setMsg({ text: t("saved"), ok: true }); load(); }
      }}>
        <label className="text-sm">{t("pos_api_url")}
          <input className={input} value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="https://pos.example.com/api/v1" dir="ltr" />
        </label>
        <label className="text-sm">{t("pos_web_url")}
          <input className={input} value={webUrl} onChange={(e) => setWebUrl(e.target.value)} placeholder="https://pos.example.com" dir="ltr" />
        </label>
        <label className="text-sm md:col-span-2">{t("pos_api_key")}
          <input className={input} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} dir="ltr"
            placeholder={cfg?.has_key ? t("pos_key_saved") : "posk_..."} autoComplete="off" />
        </label>
        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={autoSync} onChange={(e) => setAutoSync(e.target.checked)} />{t("pos_auto_sync")}</label>
        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={receipts} onChange={(e) => setReceipts(e.target.checked)} />{t("pos_import_receipts")}</label>
        <div className="md:col-span-2 flex gap-2">
          <button disabled={!!busy} className={`${button} bg-emerald-600 text-white hover:bg-emerald-700`}>{t("save")}</button>
          <button type="button" disabled={!!busy} className={`${button} bg-gray-100 hover:bg-gray-200`} onClick={async () => {
            const r = await call("test", "/api/pos/test");
            if (r) setMsg({ text: t("pos_connected", { branches: r.branches, methods: r.methods }), ok: true });
          }}>{t("test_connection")}</button>
        </div>
      </form>

      <div className="border-t pt-4 mt-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-semibold text-sm">{t("branch_mapping")} / {t("payment_mapping")}</h4>
          <div className="flex gap-2">
            <button disabled={!!busy} className={`${button} bg-gray-100 hover:bg-gray-200`} onClick={fetchStructure}>{t("pos_fetch")}</button>
            <button disabled={!!busy} className={`${button} bg-gray-100 hover:bg-gray-200`} onClick={async () => {
              const r = await call("auto", "/api/pos/auto-map-payments");
              if (r) { setMsg({ text: t("pos_auto_mapped", { mapped: r.mapped, total: r.total }), ok: true }); load(); }
            }}>{t("auto_map")}</button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-3">{t("pos_mapping_desc")}</p>
        <table className="w-full text-sm mb-4">
          <tbody>
            {branchRows.map((b) => (
              <tr key={b.id} className="border-b">
                <td className="py-2">{b.brand && <span className="text-gray-400">{b.brand} · </span>}{label(b.name)}</td>
                <td className="py-2 w-1/2">
                  <select className={input} value={branchMap[b.id] || ""} onChange={(e) => saveBranch(b, e.target.value)}>
                    <option value="">{t("not_mapped")}</option>
                    {branches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </td>
              </tr>
            ))}
            {methods.map((m) => (
              <tr key={m.key} className="border-b">
                <td className="py-2">{label(m.name)} <span className="text-gray-400" dir="ltr">({m.key})</span></td>
                <td className="py-2 w-1/2">
                  <select className={input} value={methodMap[m.key] || ""} onChange={(e) => saveMethod(m, e.target.value)}>
                    <option value="">{t("not_mapped")}</option>
                    {cfg?.channels.map((c) => <option key={c} value={c}>{t(c)}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t pt-4 flex flex-wrap items-end gap-2">
        <label className="text-sm">{t("from")}<input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm">{t("to")}<input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button disabled={!!busy} className={`${button} bg-emerald-600 text-white hover:bg-emerald-700 py-2`} onClick={async () => {
          const r = await call("sync", "/api/pos/sync", { date_from: from, date_to: to });
          if (!r) return;
          const warn = [...r.unmapped_branches.map((x: string) => `${t("branch")} ${x}`), ...r.unmapped_methods];
          setMsg({ text: t("pos_synced", { days: r.days_created + r.days_updated, receipts: r.receipts_booked })
            + (warn.length ? ` ${t("pos_unmapped")}: ${warn.join(", ")}` : ""), ok: !warn.length });
          load();
        }}>{busy === "sync" ? "..." : t("sync_now")}</button>
        {cfg?.last_sync_at && <span className="text-xs text-gray-500">{t("last_sync")}: {new Date(cfg.last_sync_at).toLocaleString()}</span>}
      </div>

      {cfg && (
        <div className="mt-4 p-3 bg-gray-50 rounded text-xs text-gray-600" dir="ltr">
          <div className="font-medium mb-1">{t("pos_sso_settings")}</div>
          <div>SSO_ISSUER={cfg.sso.issuer}</div>
          <div>SSO_JWKS_URL={cfg.sso.jwks_url}</div>
          <div>SSO_AUDIENCE={cfg.sso.audience}</div>
        </div>
      )}
    </div>
  );
}
