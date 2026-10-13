import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiFetch, apiPost, apiPut, apiDownload } from "../contexts/api";
import { channelLabel, useChannels, CHANNEL_START_DATE } from "./ChannelSelect";

interface Brand { id: number; name_en: string; name_ar: string; }
interface Branch { id: number; name: string; name_ar: string; brand_id: number | null; }
interface MethodRow {
  method: string; label: string; label_ar: string; opening: number; sales: number;
  received: number; fees: number; outstanding: number; channel_id: number | null;
}
type Totals = Pick<MethodRow, "opening" | "sales" | "received" | "fees" | "outstanding">;
type BranchRow = { branch_id: number; branch: string; branch_ar: string; total: number } & Record<string, number | string>;
interface Summary { date_from: string; date_to: string; rows: MethodRow[]; totals: Totals; by_branch: BranchRow[]; }
interface Entry {
  id: string; receipt_id?: number; date: string; kind: "sales" | "receipt"; branch: string; branch_ar: string;
  channel?: string; channel_ar?: string; reference: string; sales: number; received: number; fees: number; balance: number;
}
interface Statement {
  method: string; label: string; label_ar: string; opening: number; total_sales: number; total_received: number;
  total_fees: number; closing: number; ageing: Record<string, number>; entries: Entry[];
}

const METHODS = ["knet", "link", "talabat", "keeta", "jahez", "snoonu"];
const AGE_KEYS = ["0_7", "8_15", "16_30", "31_plus"];

const today = () => new Date().toISOString().split("T")[0];
const monthStart = () => {
  const d = today().slice(0, 8) + "01";
  return d < CHANNEL_START_DATE ? CHANNEL_START_DATE : d;
};
const fmt = (n: number) => n.toFixed(3);

export default function SalesProceedsPanel() {
  const { t, i18n } = useTranslation();
  const ar = i18n.language === "ar";
  const savedBrand = localStorage.getItem("selectedBrandId");
  const fixedBrand = savedBrand && savedBrand !== "group" ? savedBrand : "";
  const { channels } = useChannels(true);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [brandId, setBrandId] = useState(fixedBrand);
  const [branchId, setBranchId] = useState("");
  const [dateFrom, setDateFrom] = useState(monthStart());
  const [dateTo, setDateTo] = useState(today());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [showForm, setShowForm] = useState(false);
  const emptyForm = { method: "knet", receipt_date: today(), channel_id: "", amount: "", fees: "", branch_id: "",
    period_from: "", period_to: "", reference: "", notes: "" };
  const [form, setForm] = useState({ ...emptyForm });

  useEffect(() => {
    apiGet("/api/hr/brands").then((b: Brand[]) => setBrands(Array.isArray(b) ? b : [])).catch(() => {});
  }, []);

  useEffect(() => {
    const q = brandId ? `&brand_id=${brandId}` : "&all_brands=1";
    apiGet(`/api/branches/?scope=operating${q}`)
      .then((bs: Branch[]) => setBranches((Array.isArray(bs) ? bs : []).filter(b => !b.name.includes("Central"))))
      .catch(() => setBranches([]));
  }, [brandId]);

  const query = () => {
    const q = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    if (brandId) q.set("brand_id", brandId); else q.set("all_brands", "1");
    if (branchId) q.set("branch_id", branchId);
    return q.toString();
  };

  const load = () => {
    apiGet(`/api/proceeds/summary?${query()}`).then((s: Summary) => setSummary(s && Array.isArray(s.rows) ? s : null));
    if (method) apiGet(`/api/proceeds/statement/${method}?${query()}`).then((s: Statement) => setStatement(s && Array.isArray(s.entries) ? s : null));
  };
  useEffect(load, [brandId, branchId, dateFrom, dateTo, method]);

  const brandChannels = channels.filter(c => !c.brand_id || !brandId || String(c.brand_id) === brandId);
  const methodLabel = (r: { label: string; label_ar: string }) => ar ? r.label_ar : r.label;
  const branchLabel = (b: { branch: string; branch_ar: string }) => ar ? b.branch_ar || b.branch : b.branch;
  const rowFor = (m: string) => summary?.rows.find(r => r.method === m);

  const setDefaultChannel = async (m: string, channelId: string) => {
    const fd = new FormData();
    fd.append("method", m);
    fd.append("channel_id", channelId);
    fd.append("brand_id", brandId);
    const res = await apiPut("/api/proceeds/channels", fd);
    if (res && res.detail) { alert(res.detail); return; }
    load();
  };

  const openReceipt = (m: string) => {
    const r = rowFor(m);
    setForm({ ...emptyForm, method: m, channel_id: r?.channel_id ? String(r.channel_id) : "", branch_id: branchId });
    setShowForm(true);
  };

  const saveReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brandId && !form.branch_id) { alert(t("proceeds_select_brand")); return; }
    if (!window.confirm(t("confirm_transaction"))) return;
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v || (k === "amount" || k === "fees" ? "0" : "")));
    if (brandId) fd.append("brand_id", brandId);
    const res = await apiPost("/api/proceeds/receipts", fd);
    if (res && res.detail) { alert(res.detail); return; }
    setShowForm(false);
    setMethod(form.method);
    load();
  };

  const deleteReceipt = async (en: Entry) => {
    if (!en.receipt_id || !window.confirm(t("confirm_delete"))) return;
    await apiFetch(`/api/proceeds/receipts/${en.receipt_id}`, { method: "DELETE" });
    load();
  };

  const download = (path: string, name: string, f: "excel" | "pdf") =>
    apiDownload(`${path}/export/${f}?${query()}&lang=${i18n.language}`, `${name}.${f === "excel" ? "xlsx" : "pdf"}`);

  const formRow = rowFor(form.method);
  const afterReceipt = formRow ? formRow.outstanding - (parseFloat(form.amount) || 0) - (parseFloat(form.fees) || 0) : 0;

  return (
    <div className="space-y-4">
      <div className="px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
        {t("proceeds_intro", { date: CHANNEL_START_DATE })}
      </div>

      <div className="flex gap-3 flex-wrap items-end justify-between">
        <div className="flex gap-3 flex-wrap items-end">
          {!fixedBrand && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("brand")}</label>
              <select value={brandId} onChange={e => { setBrandId(e.target.value); setBranchId(""); }} className="px-3 py-2 border rounded-lg text-sm">
                <option value="">{t("all_brands")}</option>
                {brands.map(b => <option key={b.id} value={b.id}>{ar ? b.name_ar || b.name_en : b.name_en}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t("branch")}</label>
            <select value={branchId} onChange={e => setBranchId(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
              <option value="">{t("all_branches")}</option>
              {branches.map(b => <option key={b.id} value={b.id}>{ar ? b.name_ar || b.name : b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t("from")}</label>
            <input type="date" min={CHANNEL_START_DATE} value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t("to")}</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => openReceipt(method || "knet")} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700">
            + {t("proceeds_record_receipt")}
          </button>
          <button onClick={() => download("/api/proceeds/summary", "sales_proceeds", "excel")} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">{t("export_excel")}</button>
          <button onClick={() => download("/api/proceeds/summary", "sales_proceeds", "pdf")} className="px-3 py-1.5 bg-red-600 text-white rounded text-xs hover:bg-red-700">{t("export_pdf")}</button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={saveReceipt} className="bg-white p-6 rounded-xl shadow-sm border space-y-3">
          <h3 className="font-semibold">{t("proceeds_record_receipt")}</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("proceeds_method")}</label>
              <select value={form.method} onChange={e => {
                const r = rowFor(e.target.value);
                setForm({ ...form, method: e.target.value, channel_id: r?.channel_id ? String(r.channel_id) : form.channel_id });
              }} className="w-full px-3 py-2 border rounded-lg text-sm">
                {METHODS.map(m => { const r = rowFor(m); return <option key={m} value={m}>{r ? methodLabel(r) : m}</option>; })}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("proceeds_receipt_date")}</label>
              <input type="date" required min={CHANNEL_START_DATE} value={form.receipt_date} onChange={e => setForm({ ...form, receipt_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("proceeds_received_into")}</label>
              <select required value={form.channel_id} onChange={e => setForm({ ...form, channel_id: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="">{t("select_channel")}</option>
                {brandChannels.map(c => <option key={c.id} value={c.id}>{channelLabel(c, i18n.language)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("proceeds_amount_received")}</label>
              <input type="number" step="0.001" min="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("proceeds_fees")}</label>
              <input type="number" step="0.001" min="0" value={form.fees} onChange={e => setForm({ ...form, fees: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("branch")}</label>
              <select value={form.branch_id} onChange={e => setForm({ ...form, branch_id: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="">{t("all_branches")}</option>
                {branches.map(b => <option key={b.id} value={b.id}>{ar ? b.name_ar || b.name : b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("proceeds_period_from")}</label>
              <input type="date" value={form.period_from} onChange={e => setForm({ ...form, period_from: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("proceeds_period_to")}</label>
              <input type="date" value={form.period_to} onChange={e => setForm({ ...form, period_to: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("reference")}</label>
              <input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("notes")}</label>
              <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>
          {formRow && (
            <div className="text-xs text-gray-600">
              {t("proceeds_outstanding_now")}: <b>KD {fmt(formRow.outstanding)}</b> · {t("proceeds_after_receipt")}:{" "}
              <b className={afterReceipt < 0 ? "text-red-600" : ""}>KD {fmt(afterReceipt)}</b>
              {branchId || form.branch_id ? null : <span className="text-gray-400"> ({t("all_branches")})</span>}
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" className="px-6 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700">{t("save")}</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-6 py-2 bg-gray-200 rounded-lg text-sm">{t("cancel")}</button>
          </div>
        </form>
      )}

      {summary && (
        <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-start">{t("proceeds_method")}</th>
                <th className="px-4 py-3 text-start">{t("proceeds_default_channel")}</th>
                <th className="px-4 py-3 text-end">{t("proceeds_opening")}</th>
                <th className="px-4 py-3 text-end">{t("proceeds_sales")}</th>
                <th className="px-4 py-3 text-end">{t("proceeds_received")}</th>
                <th className="px-4 py-3 text-end">{t("proceeds_fees")}</th>
                <th className="px-4 py-3 text-end font-bold">{t("proceeds_outstanding")}</th>
                <th className="px-2 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map(r => (
                <tr key={r.method} onClick={() => setMethod(r.method)}
                  className={`border-b cursor-pointer hover:bg-gray-50 ${method === r.method ? "bg-emerald-50" : ""}`}>
                  <td className="px-4 py-2 font-semibold">{methodLabel(r)}</td>
                  <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                    {brandId ? (
                      <select value={r.channel_id ? String(r.channel_id) : ""} onChange={e => setDefaultChannel(r.method, e.target.value)}
                        className="px-2 py-1 border rounded text-xs">
                        <option value="">—</option>
                        {brandChannels.map(c => <option key={c.id} value={c.id}>{channelLabel(c, i18n.language)}</option>)}
                      </select>
                    ) : <span className="text-xs text-gray-400">{t("proceeds_select_brand")}</span>}
                  </td>
                  <td className="px-4 py-2 text-end">{fmt(r.opening)}</td>
                  <td className="px-4 py-2 text-end">{fmt(r.sales)}</td>
                  <td className="px-4 py-2 text-end text-green-700">{fmt(r.received)}</td>
                  <td className="px-4 py-2 text-end text-amber-700">{fmt(r.fees)}</td>
                  <td className={`px-4 py-2 text-end font-bold ${r.outstanding < 0 ? "text-red-600" : "text-blue-700"}`}>{fmt(r.outstanding)}</td>
                  <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                    <button onClick={() => openReceipt(r.method)} className="text-emerald-700 text-xs hover:underline whitespace-nowrap">{t("proceeds_receive")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-100 border-t font-bold">
              <tr>
                <td className="px-4 py-3" colSpan={2}>{t("total")}</td>
                <td className="px-4 py-3 text-end">{fmt(summary.totals.opening)}</td>
                <td className="px-4 py-3 text-end">{fmt(summary.totals.sales)}</td>
                <td className="px-4 py-3 text-end text-green-700">{fmt(summary.totals.received)}</td>
                <td className="px-4 py-3 text-end text-amber-700">{fmt(summary.totals.fees)}</td>
                <td className="px-4 py-3 text-end text-blue-700">{fmt(summary.totals.outstanding)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {method && statement && (
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="p-4 border-b flex flex-wrap gap-3 items-center justify-between">
            <h3 className="font-semibold text-lg">{t("proceeds_statement")} — {methodLabel(statement)}</h3>
            <div className="flex gap-2">
              <button onClick={() => download(`/api/proceeds/statement/${method}`, `proceeds_${method}`, "excel")} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">{t("export_excel")}</button>
              <button onClick={() => download(`/api/proceeds/statement/${method}`, `proceeds_${method}`, "pdf")} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">{t("export_pdf")}</button>
              <button onClick={() => setMethod(null)} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">{t("close")}</button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 text-sm">
            {AGE_KEYS.map(k => (
              <div key={k} className={`rounded-lg p-3 ${k === "31_plus" ? "bg-red-50" : k === "16_30" ? "bg-amber-50" : "bg-gray-50"}`}>
                <div className="text-xs text-gray-500">{t("proceeds_unpaid")} {t(`proceeds_age_${k}`)}</div>
                <div className="font-bold">KD {fmt(statement.ageing[k] || 0)}</div>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-start">{t("date")}</th>
                  <th className="px-4 py-3 text-start">{t("type")}</th>
                  <th className="px-4 py-3 text-start">{t("branch")}</th>
                  <th className="px-4 py-3 text-start">{t("proceeds_received_into")}</th>
                  <th className="px-4 py-3 text-start">{t("reference")}</th>
                  <th className="px-4 py-3 text-end">{t("proceeds_sales")}</th>
                  <th className="px-4 py-3 text-end">{t("proceeds_received")}</th>
                  <th className="px-4 py-3 text-end">{t("proceeds_fees")}</th>
                  <th className="px-4 py-3 text-end font-bold">{t("proceeds_balance_due")}</th>
                  <th className="px-2 py-3"></th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b bg-gray-50/60 italic">
                  <td className="px-4 py-2">{summary?.date_from}</td>
                  <td className="px-4 py-2" colSpan={7}>{t("proceeds_opening")}</td>
                  <td className="px-4 py-2 text-end font-bold">{fmt(statement.opening)}</td>
                  <td></td>
                </tr>
                {statement.entries.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
                ) : statement.entries.map(en => (
                  <tr key={en.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2">{en.date}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${en.kind === "sales" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                        {en.kind === "sales" ? t("proceeds_sales") : t("proceeds_receipt")}
                      </span>
                    </td>
                    <td className="px-4 py-2">{en.kind === "receipt" && !en.branch ? t("all_branches") : branchLabel(en)}</td>
                    <td className="px-4 py-2">{(ar ? en.channel_ar : en.channel) || ""}</td>
                    <td className="px-4 py-2 text-gray-500">{en.reference}</td>
                    <td className="px-4 py-2 text-end">{en.sales ? fmt(en.sales) : "-"}</td>
                    <td className="px-4 py-2 text-end text-green-700">{en.received ? fmt(en.received) : "-"}</td>
                    <td className="px-4 py-2 text-end text-amber-700">{en.fees ? fmt(en.fees) : "-"}</td>
                    <td className="px-4 py-2 text-end font-bold">{fmt(en.balance)}</td>
                    <td className="px-2 py-2">{en.receipt_id ? <button onClick={() => deleteReceipt(en)} className="text-red-500 text-xs hover:underline">{t("delete")}</button> : null}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-100 border-t font-bold">
                <tr>
                  <td className="px-4 py-3" colSpan={5}>{t("total")}</td>
                  <td className="px-4 py-3 text-end">{fmt(statement.total_sales)}</td>
                  <td className="px-4 py-3 text-end text-green-700">{fmt(statement.total_received)}</td>
                  <td className="px-4 py-3 text-end text-amber-700">{fmt(statement.total_fees)}</td>
                  <td className="px-4 py-3 text-end text-blue-700">{fmt(statement.closing)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {summary && summary.by_branch.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
          <h3 className="font-semibold p-4 border-b">{t("proceeds_by_branch")}</h3>
          <table className="w-full text-sm min-w-[800px]">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-start">{t("branch")}</th>
                {summary.rows.map(r => <th key={r.method} className="px-4 py-3 text-end">{methodLabel(r)}</th>)}
                <th className="px-4 py-3 text-end font-bold">{t("total")}</th>
              </tr>
            </thead>
            <tbody>
              {summary.by_branch.map(b => (
                <tr key={b.branch_id} className="border-b">
                  <td className="px-4 py-2">{branchLabel(b)}</td>
                  {summary.rows.map(r => <td key={r.method} className="px-4 py-2 text-end">{fmt(Number(b[r.method]) || 0)}</td>)}
                  <td className="px-4 py-2 text-end font-bold">{fmt(b.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
