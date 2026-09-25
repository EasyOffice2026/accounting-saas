import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiFetch, apiPost, apiPut } from "../contexts/api";
import { useAuth } from "../contexts/AuthContext";
import { type PaymentChannel, channelLabel, useChannels, CHANNEL_START_DATE } from "./ChannelSelect";

interface Brand { id: number; name_en: string; name_ar: string; }
interface StatementEntry {
  id: string; txn_id?: number; date: string; source: string; description: string;
  head: string; credit: number; debit: number; balance: number; notes: string | null;
}
interface Statement {
  channel: PaymentChannel; opening_balance: number; total_in: number; total_out: number;
  closing_balance: number; entries: StatementEntry[];
}

const KINDS = ["bank", "card", "knet", "other"];
const MANAGE_ROLES = ["owner", "manager", "accountant"];

const emptyForm = {
  name: "", name_ar: "", kind: "bank", account_no: "", opening_balance: "0",
  opening_date: CHANNEL_START_DATE, brand_id: "", is_active: true,
};

export default function PaymentChannelsPanel() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const canManage = MANAGE_ROLES.includes(user?.role || "");
  const { channels, reload } = useChannels(false);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [showTxn, setShowTxn] = useState(false);
  const [txn, setTxn] = useState({ txn_date: new Date().toISOString().split("T")[0], txn_type: "deposit", amount: "", reference: "", notes: "" });

  useEffect(() => {
    apiGet("/api/hr/brands").then((b: Brand[]) => setBrands(Array.isArray(b) ? b : [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (selected == null) { setStatement(null); return; }
    const qs = new URLSearchParams();
    if (dateFrom) qs.set("date_from", dateFrom);
    if (dateTo) qs.set("date_to", dateTo);
    apiGet(`/api/payment-channels/${selected}/statement?${qs}`).then(setStatement);
  }, [selected, dateFrom, dateTo]);

  const refresh = () => {
    reload();
    if (selected != null) {
      const qs = new URLSearchParams();
      if (dateFrom) qs.set("date_from", dateFrom);
      if (dateTo) qs.set("date_to", dateTo);
      apiGet(`/api/payment-channels/${selected}/statement?${qs}`).then(setStatement);
    }
  };

  const brandName = (id: number | null) => {
    if (!id) return t("all_brands");
    const b = brands.find(x => x.id === id);
    return b ? (i18n.language === "ar" ? b.name_ar || b.name_en : b.name_en) : `#${id}`;
  };

  const openCreate = () => { setEditId(null); setForm({ ...emptyForm }); setShowForm(true); };
  const openEdit = (c: PaymentChannel) => {
    setEditId(c.id);
    setForm({
      name: c.name, name_ar: c.name_ar || "", kind: c.kind, account_no: c.account_no || "",
      opening_balance: String(c.opening_balance ?? 0), opening_date: c.opening_date || CHANNEL_START_DATE,
      brand_id: c.brand_id ? String(c.brand_id) : "", is_active: c.is_active,
    });
    setShowForm(true);
  };

  const saveChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append("name", form.name);
    fd.append("name_ar", form.name_ar);
    fd.append("kind", form.kind);
    fd.append("account_no", form.account_no);
    fd.append("opening_balance", form.opening_balance || "0");
    fd.append("opening_date", form.opening_date);
    if (form.brand_id) fd.append("brand_id", form.brand_id);
    let res;
    if (editId != null) {
      fd.append("is_active", String(form.is_active));
      res = await apiPut(`/api/payment-channels/${editId}`, fd);
    } else {
      res = await apiPost("/api/payment-channels/", fd);
    }
    if (res && res.detail) { alert(res.detail); return; }
    setShowForm(false);
    refresh();
  };

  const removeChannel = async (c: PaymentChannel) => {
    if (!window.confirm(t("confirm_delete"))) return;
    await apiFetch(`/api/payment-channels/${c.id}`, { method: "DELETE" });
    if (selected === c.id) setSelected(null);
    refresh();
  };

  const saveTxn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selected == null) return;
    if (!window.confirm(t("confirm_transaction"))) return;
    const fd = new FormData();
    fd.append("txn_date", txn.txn_date);
    fd.append("txn_type", txn.txn_type);
    fd.append("amount", txn.amount);
    fd.append("reference", txn.reference);
    fd.append("notes", txn.notes);
    const res = await apiPost(`/api/payment-channels/${selected}/transactions`, fd);
    if (res && res.detail) { alert(res.detail); return; }
    setShowTxn(false);
    setTxn({ ...txn, amount: "", reference: "", notes: "" });
    refresh();
  };

  const deleteTxn = async (en: StatementEntry) => {
    if (selected == null || !en.txn_id) return;
    if (!window.confirm(t("confirm_delete"))) return;
    await apiFetch(`/api/payment-channels/${selected}/transactions/${en.txn_id}`, { method: "DELETE" });
    refresh();
  };

  const kindLabel = (k: string) => t(`channel_kind_${k}`);
  const sourceLabel = (s: string) => t(`channel_src_${s}`);
  const total = channels.filter(c => c.is_active).reduce((s, c) => s + (c.balance || 0), 0);

  return (
    <div className="space-y-4">
      <div className="px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
        {t("channels_intro", { date: CHANNEL_START_DATE })}
      </div>

      {/* Balances overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {channels.map(c => (
          <button key={c.id} onClick={() => setSelected(c.id)}
            className={`text-left bg-white rounded-xl shadow-sm border p-4 hover:border-emerald-400 ${selected === c.id ? "border-emerald-500 ring-1 ring-emerald-300" : ""} ${!c.is_active ? "opacity-50" : ""}`}>
            <div className="flex justify-between items-start gap-2">
              <div>
                <div className="font-semibold text-gray-800">{i18n.language === "ar" ? c.name_ar || c.name : c.name}</div>
                <div className="text-xs text-gray-500">{kindLabel(c.kind)}{c.account_no ? ` · ${c.account_no}` : ""}</div>
                <div className="text-[11px] text-gray-400">{brandName(c.brand_id)}{!c.is_active ? ` · ${t("inactive")}` : ""}</div>
              </div>
              <div className={`text-lg font-bold ${(c.balance || 0) < 0 ? "text-red-600" : "text-blue-700"}`}>
                KD {(c.balance ?? 0).toFixed(3)}
              </div>
            </div>
          </button>
        ))}
        {channels.length === 0 && (
          <div className="col-span-full text-center text-gray-400 py-8 bg-white rounded-xl border">{t("no_channels_yet")}</div>
        )}
      </div>
      {channels.length > 0 && (
        <div className="flex justify-between items-center px-4 py-3 bg-white rounded-xl border">
          <span className="font-semibold">{t("total_channel_balance")}</span>
          <span className="font-bold text-xl text-blue-700">KD {total.toFixed(3)}</span>
        </div>
      )}

      {canManage && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={openCreate} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700">
            + {t("add_channel")}
          </button>
          {selected != null && (
            <>
              <button onClick={() => { const c = channels.find(x => x.id === selected); if (c) openEdit(c); }}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg text-sm hover:bg-gray-700">{t("edit")}</button>
              <button onClick={() => setShowTxn(!showTxn)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                {showTxn ? t("cancel") : t("add_channel_txn")}
              </button>
              <button onClick={() => { const c = channels.find(x => x.id === selected); if (c) removeChannel(c); }}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">{t("delete")}</button>
            </>
          )}
        </div>
      )}

      {showForm && canManage && (
        <form onSubmit={saveChannel} className="bg-white p-6 rounded-xl shadow-sm border space-y-3">
          <h3 className="font-semibold">{editId != null ? t("edit_channel") : t("add_channel")}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("channel_name")}</label>
              <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("name_ar")}</label>
              <input value={form.name_ar} onChange={e => setForm({ ...form, name_ar: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" dir="rtl" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("channel_kind")}</label>
              <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm">
                {KINDS.map(k => <option key={k} value={k}>{kindLabel(k)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("account_no")}</label>
              <input value={form.account_no} onChange={e => setForm({ ...form, account_no: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("opening_balance")}</label>
              <input type="number" step="0.001" value={form.opening_balance} onChange={e => setForm({ ...form, opening_balance: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("opening_date")}</label>
              <input type="date" value={form.opening_date} onChange={e => setForm({ ...form, opening_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("brand")}</label>
              <select value={form.brand_id} onChange={e => setForm({ ...form, brand_id: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="">{t("all_brands")}</option>
                {brands.map(b => <option key={b.id} value={b.id}>{i18n.language === "ar" ? b.name_ar || b.name_en : b.name_en}</option>)}
              </select>
            </div>
            {editId != null && (
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} />
                  {t("active")}
                </label>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-6 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700">{t("save")}</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-6 py-2 bg-gray-200 rounded-lg text-sm">{t("cancel")}</button>
          </div>
        </form>
      )}

      {showTxn && canManage && selected != null && (
        <form onSubmit={saveTxn} className="bg-white p-6 rounded-xl shadow-sm border space-y-3">
          <h3 className="font-semibold">{t("add_channel_txn")} — {channelLabel(channels.find(c => c.id === selected), i18n.language)}</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("date")}</label>
              <input type="date" required value={txn.txn_date} onChange={e => setTxn({ ...txn, txn_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("type")}</label>
              <select value={txn.txn_type} onChange={e => setTxn({ ...txn, txn_type: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="deposit">{t("channel_src_deposit")}</option>
                <option value="withdrawal">{t("channel_src_withdrawal")}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("amount")}</label>
              <input type="number" step="0.001" min="0.001" required value={txn.amount} onChange={e => setTxn({ ...txn, amount: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("reference")}</label>
              <input value={txn.reference} onChange={e => setTxn({ ...txn, reference: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("notes")}</label>
              <input value={txn.notes} onChange={e => setTxn({ ...txn, notes: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>
          <button type="submit" className="px-6 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700">{t("save")}</button>
        </form>
      )}

      {/* Statement */}
      {selected != null && statement && (
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="p-4 border-b flex flex-wrap gap-3 items-end justify-between">
            <h3 className="font-semibold text-lg">{t("channel_statement")} — {channelLabel(statement.channel, i18n.language)}</h3>
            <div className="flex gap-2 items-end">
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t("from")}</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-3 py-1.5 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t("to")}</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-3 py-1.5 border rounded-lg text-sm" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 text-sm">
            <div className="bg-gray-50 rounded-lg p-3"><div className="text-xs text-gray-500">{t("opening_balance")}</div><div className="font-bold">KD {statement.opening_balance.toFixed(3)}</div></div>
            <div className="bg-green-50 rounded-lg p-3"><div className="text-xs text-gray-500">{t("total_in")}</div><div className="font-bold text-green-700">KD {statement.total_in.toFixed(3)}</div></div>
            <div className="bg-red-50 rounded-lg p-3"><div className="text-xs text-gray-500">{t("total_out")}</div><div className="font-bold text-red-700">KD {statement.total_out.toFixed(3)}</div></div>
            <div className="bg-blue-50 rounded-lg p-3"><div className="text-xs text-gray-500">{t("closing_balance")}</div><div className="font-bold text-blue-700">KD {statement.closing_balance.toFixed(3)}</div></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left">{t("date")}</th>
                  <th className="px-4 py-3 text-left">{t("source")}</th>
                  <th className="px-4 py-3 text-left">{t("description")}</th>
                  <th className="px-4 py-3 text-left">{t("head")}</th>
                  <th className="px-4 py-3 text-right">{t("channel_in")}</th>
                  <th className="px-4 py-3 text-right">{t("channel_out")}</th>
                  <th className="px-4 py-3 text-right font-bold">{t("balance")}</th>
                  {canManage && <th className="px-2 py-3"></th>}
                </tr>
              </thead>
              <tbody>
                {statement.entries.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
                ) : statement.entries.map(en => (
                  <tr key={en.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2">{en.date}</td>
                    <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded text-xs ${en.credit > 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{sourceLabel(en.source)}</span></td>
                    <td className="px-4 py-2">{en.description}{en.notes ? <span className="text-gray-400"> · {en.notes}</span> : null}</td>
                    <td className="px-4 py-2">{en.head}</td>
                    <td className="px-4 py-2 text-right text-green-600">{en.credit > 0 ? `KD ${en.credit.toFixed(3)}` : "-"}</td>
                    <td className="px-4 py-2 text-right text-red-600">{en.debit > 0 ? `KD ${en.debit.toFixed(3)}` : "-"}</td>
                    <td className="px-4 py-2 text-right font-bold">KD {en.balance.toFixed(3)}</td>
                    {canManage && <td className="px-2 py-2">{en.txn_id ? <button onClick={() => deleteTxn(en)} className="text-red-500 text-xs hover:underline">{t("delete")}</button> : null}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
