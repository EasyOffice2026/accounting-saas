import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiFetch, apiDownload } from "../contexts/api";
import { useAuth } from "../contexts/AuthContext";
import { useBrand } from "../contexts/BrandContext";
import { Plus, Printer, Paperclip, X, Trash2 } from "lucide-react";
import { PO_STATUS_CLS } from "./PurchaseDashboardPage";
import SupplierMasterTabs from "../components/SupplierMasterTabs";
import ChannelSelect from "../components/ChannelSelect";

type ProcTab = "orders" | "catalog" | "categories" | "invoices" | "ledger";
const PROC_TABS: ProcTab[] = ["orders", "catalog", "categories", "invoices", "ledger"];
const TAB_KEY: Record<ProcTab, string> = { orders: "po_orders", catalog: "supplier_catalog", categories: "purchase_categories", invoices: "po_invoices", ledger: "po_ledger" };

interface Supplier { id: number; name: string; payment_type: string; category_id: number | null; category_name: string; }
interface SupItem { id: number; item_name: string; item_name_ar: string; packaging: string; unit: string; unit_price: number; }
interface Category { id: number; name: string; name_ar: string; }
interface Line { supplier_item_id: number | null; item_name: string; item_name_ar: string; packaging: string; unit: string; quantity: string; unit_price: string; }
interface OrderItem { id: number; supplier_item_id: number | null; item_name: string; item_name_ar: string; packaging: string; unit: string; quantity: number; unit_price: number; total: number; received_qty: number | null; received_total: number | null; }
interface Payment { id: number; date: string; amount: number; method: string; reference: string; notes: string; created_by_name: string; }
interface Invoice {
  id: number; order_id: number; po_no: string; supplier_id: number; supplier_name: string; payment_type: string; invoice_number: string;
  date: string; due_date: string; total_amount: number; paid_amount: number; balance: number; status: string; notes: string; attachment: string;
  days_overdue: number; payments: Payment[];
}
interface Order {
  id: number; po_no: string; brand_id: number; supplier_id: number; supplier_name: string; category_id: number | null; category_name: string;
  date: string; expected_date: string; payment_type: string; delivery_location: string; total: number; notes: string; status: string; status_label: string;
  attachment: string; created_by: number | null; created_by_name: string; created_at: string; submitted_at: string; approved_by_name: string; approved_at: string;
  approval_comment: string; ordered_at: string; received_date: string; received_by_name: string; receiving_notes: string; receiving_attachment: string;
  invoice_id: number | null; invoice_status: string; invoice_paid: number; invoice_total: number; item_count: number;
  items?: OrderItem[]; logs?: { status: string; label: string; comment: string; user_name: string; at: string }[]; invoice?: Invoice | null;
}
interface LedgerRow { supplier_id: number; supplier_name: string; invoices: number; invoiced: number; paid: number; balance: number; overdue: number; open_invoices: number; }
interface Ledger { suppliers: LedgerRow[]; total_balance: number; total_overdue: number; statement?: { date: string; kind: string; ref: string; po_no: string; debit: number; credit: number; balance: number }[]; }

const inp = "border rounded px-2 py-1.5 text-sm w-full";
const btn = "px-3 py-1.5 rounded text-sm font-medium";
const kd = (v: number | null | undefined) => (v || 0).toFixed(3);
const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): Line => ({ supplier_item_id: null, item_name: "", item_name_ar: "", packaging: "", unit: "pcs", quantity: "1", unit_price: "0" });
const APPROVERS = ["owner", "accountant", "purchase_manager"];
const METHODS = ["purchase_petty_cash", "bank_transfer", "knet", "cheque"] as const;

async function post(path: string, fd: FormData, method = "POST") {
  const res = await apiFetch(path, { method, body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Action failed");
  return data;
}

function FileBtn({ label, file, onChange }: { label: string; file: File | null; onChange: (f: File | null) => void }) {
  const id = useMemo(() => `f${Math.random().toString(36).slice(2)}`, []);
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="inline-flex items-center gap-1 px-3 py-1.5 border rounded text-sm cursor-pointer bg-gray-50 hover:bg-gray-100">
        <Paperclip size={14} /> {label}
      </label>
      <input id={id} type="file" className="hidden" onChange={e => onChange(e.target.files?.[0] || null)} />
      {file && <span className="text-xs text-gray-600 inline-flex items-center gap-1">{file.name}<button type="button" onClick={() => onChange(null)}><X size={12} /></button></span>}
    </div>
  );
}

export default function ProcurementPage({ embedded = false }: { embedded?: boolean }) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language === "ar";
  const { user } = useAuth();
  const { selectedBrand, brands } = useBrand();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<ProcTab>((params.get("tab") as ProcTab) || "orders");
  const [showSupplierForm, setShowSupplierForm] = useState(false);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<{ name: string; name_ar: string }[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [supFilter, setSupFilter] = useState("");
  const [ledgerSup, setLedgerSup] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editOrder, setEditOrder] = useState<Order | null>(null);
  const [detail, setDetail] = useState<Order | null>(null);
  const [approveOrder, setApproveOrder] = useState<Order | null>(null);
  const [receiveOrder, setReceiveOrder] = useState<Order | null>(null);
  const [invoiceOrder, setInvoiceOrder] = useState<Order | null>(null);
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);

  const brandId = selectedBrand?.id || brands[0]?.id;
  const canApprove = APPROVERS.includes(user?.role || "");
  const canPay = canApprove;
  const isOfficer = user?.role === "purchase_officer";
  const isMaster = tab === "catalog" || tab === "categories";

  const loadRefs = () => {
    apiGet("/api/procurement/suppliers").then(setSuppliers);
    apiGet("/api/procurement/categories").then(setCategories);
    apiGet("/api/procurement/delivery-locations").then(setLocations);
  };
  const loadOrders = () => {
    const q = new URLSearchParams();
    if (statusFilter) q.set("status", statusFilter);
    if (supFilter) q.set("supplier_id", supFilter);
    apiGet(`/api/procurement/orders?${q}`).then(setOrders);
  };
  const loadInvoices = () => {
    const q = new URLSearchParams();
    if (supFilter) q.set("supplier_id", supFilter);
    apiGet(`/api/procurement/invoices?${q}`).then(setInvoices);
  };
  const loadLedger = () => apiGet(`/api/procurement/ledger${ledgerSup ? `?supplier_id=${ledgerSup}` : ""}`).then(setLedger);
  const reload = () => { loadOrders(); loadInvoices(); loadLedger(); };

  useEffect(() => { loadRefs(); }, [selectedBrand?.id]);
  useEffect(() => { loadOrders(); }, [selectedBrand?.id, statusFilter, supFilter]);
  useEffect(() => { loadInvoices(); }, [selectedBrand?.id, supFilter]);
  useEffect(() => { loadLedger(); }, [selectedBrand?.id, ledgerSup]);
  useEffect(() => {
    if (params.get("new") === "1") { setEditOrder(null); setShowForm(true); params.delete("new"); setParams(params, { replace: true }); }
  }, []);

  const openDetail = async (id: number) => setDetail(await apiGet(`/api/procurement/orders/${id}`));
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr("");
    try { await fn(); reload(); } catch (e) { setErr(e instanceof Error ? e.message : t("po_error")); alert(e instanceof Error ? e.message : t("po_error")); }
    finally { setBusy(false); }
  };
  const submitOrder = (o: Order) => { if (window.confirm(t("po_confirm_submit"))) run(() => post(`/api/procurement/orders/${o.id}/submit`, new FormData())); };
  const markOrdered = (o: Order) => run(() => post(`/api/procurement/orders/${o.id}/order`, new FormData()));
  const cancelOrder = (o: Order) => { if (window.confirm(t("po_confirm_cancel"))) run(() => post(`/api/procurement/orders/${o.id}/cancel`, new FormData())); };
  const deleteOrder = (o: Order) => { if (window.confirm(t("po_confirm_delete"))) run(() => post(`/api/procurement/orders/${o.id}`, new FormData(), "DELETE")); };
  const printPO = (o: Order) => apiDownload(`/api/procurement/orders/${o.id}/form.pdf`, `${o.po_no}.pdf`);
  const exportTab = (fmt: string) => {
    const ext = fmt === "excel" ? "xlsx" : fmt;
    apiDownload(`/api/procurement/export/${tab}/${fmt}`, `purchase_${tab}.${ext}`);
  };

  const badge = (status: string, label: string) => <span className={`px-2 py-0.5 rounded text-xs font-semibold ${PO_STATUS_CLS[status] || "bg-gray-100"}`}>{label}</span>;
  const methodLabel = (m: string) => ({ purchase_petty_cash: t("po_pm_petty"), bank_transfer: t("po_pm_bank"), knet: t("po_pm_knet"), cheque: t("po_pm_cheque") } as Record<string, string>)[m] || m;

  const actionsFor = (o: Order) => {
    const a: React.ReactNode[] = [];
    const mine = o.created_by === user?.id;
    if (o.status === "draft" || o.status === "returned") {
      a.push(<button key="e" onClick={() => { setEditOrder(o); setShowForm(true); }} className={`${btn} bg-gray-100`}>{t("po_edit")}</button>);
      a.push(<button key="s" disabled={busy} onClick={() => submitOrder(o)} className={`${btn} bg-amber-500 text-white`}>{t("po_submit")}</button>);
      if (o.status === "draft") a.push(<button key="d" onClick={() => deleteOrder(o)} className={`${btn} bg-red-50 text-red-700`}><Trash2 size={14} /></button>);
    }
    if (o.status === "pending" && canApprove && (user?.role === "owner" || !mine))
      a.push(<button key="a" onClick={() => setApproveOrder(o)} className={`${btn} bg-blue-600 text-white`}>{t("po_approve")}</button>);
    if (o.status === "approved") a.push(<button key="o" disabled={busy} onClick={() => markOrdered(o)} className={`${btn} bg-indigo-600 text-white`}>{t("po_mark_ordered")}</button>);
    if (o.status === "approved" || o.status === "ordered")
      a.push(<button key="r" onClick={async () => setReceiveOrder(await apiGet(`/api/procurement/orders/${o.id}`))} className={`${btn} bg-purple-600 text-white`}>{t("po_receive")}</button>);
    if (o.status === "received" && !o.invoice_id) a.push(<button key="i" onClick={() => setInvoiceOrder(o)} className={`${btn} bg-cyan-600 text-white`}>{t("po_record_invoice")}</button>);
    if (o.invoice_id && o.invoice_status !== "paid" && canPay)
      a.push(<button key="p" onClick={async () => { const d: Order = await apiGet(`/api/procurement/orders/${o.id}`); if (d.invoice) setPayInvoice(d.invoice); }} className={`${btn} bg-green-600 text-white`}>{t("po_pay")}</button>);
    if (["pending", "approved", "ordered"].includes(o.status) && (canApprove || mine))
      a.push(<button key="c" onClick={() => cancelOrder(o)} className={`${btn} bg-gray-100 text-red-700`}>{t("po_cancel_order")}</button>);
    return a;
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {!embedded && <h1 className="text-2xl font-bold text-gray-800">{t("procurement")}</h1>}
          <p className="text-xs text-gray-500">{t("po_delivery_hint")}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isMaster ? null : <>
            <button onClick={() => exportTab("csv")} className={`${btn} bg-green-600 text-white text-xs`}>{t("export_csv")}</button>
            <button onClick={() => exportTab("excel")} className={`${btn} bg-blue-600 text-white text-xs`}>{t("export_excel")}</button>
            <button onClick={() => exportTab("pdf")} className={`${btn} bg-red-600 text-white text-xs`}>{t("export_pdf")}</button>
          </>}
          <button onClick={() => { setTab("catalog"); setShowSupplierForm(true); }} className={`${btn} bg-blue-600 text-white inline-flex items-center gap-1`}><Plus size={16} />{t("supplier")}</button>
          <button onClick={() => { setEditOrder(null); setShowForm(true); }} className={`${btn} bg-emerald-600 text-white inline-flex items-center gap-1`}><Plus size={16} />{t("po_new_order")}</button>
        </div>
      </div>

      <div className="flex gap-1 border-b">
        {PROC_TABS.map(k => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 text-sm rounded-t-lg ${tab === k ? "bg-emerald-600 text-white" : "bg-gray-200"}`}>
            {t(TAB_KEY[k])}
          </button>
        ))}
      </div>
      {err && <div className="text-sm text-red-700">{err}</div>}

      {isMaster && (
        <SupplierMasterTabs tab={tab as "catalog" | "categories"} canDelete={!isOfficer} canManageCategories
          showSupplierForm={showSupplierForm} onCloseSupplierForm={() => setShowSupplierForm(false)} onChanged={loadRefs} />
      )}

      {(tab === "orders" || tab === "invoices") && (
        <div className="flex flex-wrap gap-2">
          <select className="border rounded px-2 py-1.5 text-sm" value={supFilter} onChange={e => setSupFilter(e.target.value)}>
            <option value="">{t("po_all_suppliers")}</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {tab === "orders" && (
            <select className="border rounded px-2 py-1.5 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">{t("po_all_status")}</option>
              {["draft", "pending", "approved", "returned", "ordered", "received", "invoiced", "paid", "rejected", "cancelled"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
      )}

      {tab === "orders" && (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="text-start p-2">{t("po_no")}</th><th className="text-start p-2">{t("date")}</th><th className="text-start p-2">{t("po_supplier")}</th>
                <th className="text-start p-2">{t("po_cash_credit")}</th><th className="text-start p-2">{t("po_delivery_location")}</th>
                <th className="text-end p-2">{t("total")}</th><th className="text-start p-2">{t("status")}</th><th className="text-end p-2">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-gray-500">{t("po_none")}</td></tr>}
              {orders.map(o => (
                <tr key={o.id} className="border-t hover:bg-gray-50">
                  <td className="p-2"><button onClick={() => openDetail(o.id)} className="font-mono text-xs text-emerald-700 hover:underline">{o.po_no}</button></td>
                  <td className="p-2 text-xs">{o.date}</td>
                  <td className="p-2">{o.supplier_name}<div className="text-xs text-gray-500">{o.item_count} {t("po_items").toLowerCase()} · {o.created_by_name}</div></td>
                  <td className="p-2">{o.payment_type === "cash" ? t("po_cash") : t("po_credit")}</td>
                  <td className="p-2 text-xs text-gray-600">{o.delivery_location || "—"}</td>
                  <td className="p-2 text-end font-semibold">{kd(o.total)}</td>
                  <td className="p-2">{badge(o.status, o.status_label)}{o.invoice_id && o.invoice_status !== "paid" && <div className="text-xs text-gray-500">{t("po_paid")} {kd(o.invoice_paid)}/{kd(o.invoice_total)}</div>}</td>
                  <td className="p-2"><div className="flex gap-1 justify-end flex-wrap">
                    <button onClick={() => printPO(o)} className={`${btn} bg-gray-100`} title={t("po_print")}><Printer size={14} /></button>
                    {actionsFor(o)}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "invoices" && (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="text-start p-2">{t("po_invoice_no")}</th><th className="text-start p-2">{t("po_no")}</th><th className="text-start p-2">{t("po_supplier")}</th>
                <th className="text-start p-2">{t("po_invoice_date")}</th><th className="text-start p-2">{t("po_due_date")}</th>
                <th className="text-end p-2">{t("total")}</th><th className="text-end p-2">{t("po_paid")}</th><th className="text-end p-2">{t("po_balance")}</th>
                <th className="text-start p-2">{t("status")}</th><th className="text-end p-2">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && <tr><td colSpan={10} className="p-4 text-center text-gray-500">{t("po_none")}</td></tr>}
              {invoices.map(i => (
                <tr key={i.id} className="border-t hover:bg-gray-50">
                  <td className="p-2 font-mono text-xs">{i.invoice_number || "—"}</td>
                  <td className="p-2"><button onClick={() => openDetail(i.order_id)} className="font-mono text-xs text-emerald-700 hover:underline">{i.po_no}</button></td>
                  <td className="p-2">{i.supplier_name}<div className="text-xs text-gray-500">{i.payment_type === "cash" ? t("po_cash") : t("po_credit")}</div></td>
                  <td className="p-2 text-xs">{i.date}</td>
                  <td className="p-2 text-xs">{i.due_date || "—"}{i.days_overdue > 0 && <div className="text-red-600">{i.days_overdue} {t("po_days_overdue").toLowerCase()}</div>}</td>
                  <td className="p-2 text-end">{kd(i.total_amount)}</td>
                  <td className="p-2 text-end text-green-700">{kd(i.paid_amount)}</td>
                  <td className="p-2 text-end font-semibold text-red-700">{kd(i.balance)}</td>
                  <td className="p-2">{badge(i.status === "partial" ? "invoiced" : i.status === "paid" ? "paid" : "pending", i.status)}</td>
                  <td className="p-2 text-end">{i.status !== "paid" && canPay && <button onClick={() => setPayInvoice(i)} className={`${btn} bg-green-600 text-white`}>{t("po_pay")}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "ledger" && ledger && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4 items-center">
            <select className="border rounded px-2 py-1.5 text-sm" value={ledgerSup} onChange={e => setLedgerSup(e.target.value)}>
              <option value="">{t("po_all_suppliers")}</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="text-sm">{t("po_outstanding")}: <b className="text-red-700">KD {kd(ledger.total_balance)}</b></div>
            <div className="text-sm">{t("po_overdue")}: <b className="text-red-700">KD {kd(ledger.total_overdue)}</b></div>
          </div>
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="bg-gray-50 text-xs text-gray-600"><tr>
                <th className="text-start p-2">{t("po_supplier")}</th><th className="text-end p-2">{t("po_invoices")}</th><th className="text-end p-2">{t("po_invoiced")}</th>
                <th className="text-end p-2">{t("po_paid")}</th><th className="text-end p-2">{t("po_balance")}</th><th className="text-end p-2">{t("po_overdue")}</th><th className="text-end p-2">{t("po_open_invoices")}</th>
              </tr></thead>
              <tbody>
                {ledger.suppliers.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-gray-500">{t("po_none")}</td></tr>}
                {ledger.suppliers.map(r => (
                  <tr key={r.supplier_id} className="border-t hover:bg-gray-50 cursor-pointer" onClick={() => setLedgerSup(String(r.supplier_id))}>
                    <td className="p-2">{r.supplier_name}</td><td className="p-2 text-end">{r.invoices}</td><td className="p-2 text-end">{kd(r.invoiced)}</td>
                    <td className="p-2 text-end text-green-700">{kd(r.paid)}</td><td className="p-2 text-end font-semibold text-red-700">{kd(r.balance)}</td>
                    <td className="p-2 text-end">{kd(r.overdue)}</td><td className="p-2 text-end">{r.open_invoices}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ledger.statement && (
            <div className="bg-white rounded-lg shadow overflow-x-auto">
              <div className="px-3 py-2 font-semibold text-sm border-b">{t("po_statement")}</div>
              <table className="w-full text-sm min-w-[600px]">
                <thead className="bg-gray-50 text-xs text-gray-600"><tr>
                  <th className="text-start p-2">{t("date")}</th><th className="text-start p-2">{t("po_no")}</th><th className="text-start p-2">{t("po_reference")}</th>
                  <th className="text-end p-2">DR</th><th className="text-end p-2">CR</th><th className="text-end p-2">{t("po_balance")}</th>
                </tr></thead>
                <tbody>
                  {ledger.statement.map((s, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2 text-xs">{s.date}</td><td className="p-2 font-mono text-xs">{s.po_no}</td>
                      <td className="p-2 text-xs">{s.kind === "invoice" ? `${t("po_invoice_no")} ${s.ref}` : `${t("po_pay")} · ${methodLabel(s.ref) !== s.ref ? methodLabel(s.ref) : s.ref}`}</td>
                      <td className="p-2 text-end">{s.debit ? kd(s.debit) : ""}</td><td className="p-2 text-end text-green-700">{s.credit ? kd(s.credit) : ""}</td>
                      <td className="p-2 text-end font-semibold">{kd(s.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showForm && brandId && (
        <OrderForm brandId={brandId} order={editOrder} suppliers={suppliers} categories={categories} locations={locations} ar={ar}
          onClose={() => { setShowForm(false); setEditOrder(null); }} onSaved={() => { setShowForm(false); setEditOrder(null); reload(); }} />
      )}

      {detail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center overflow-y-auto p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl p-5 space-y-4 my-4 text-sm">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold flex items-center gap-2">{detail.po_no} {badge(detail.status, detail.status_label)}</h2>
              <div className="flex gap-2">
                <button onClick={() => printPO(detail)} className={`${btn} bg-gray-100 inline-flex gap-1 items-center`}><Printer size={14} />{t("po_print")}</button>
                <button onClick={() => setDetail(null)} className="text-gray-500">✕</button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {[
                [t("po_supplier"), detail.supplier_name], [t("date"), detail.date], [t("po_cash_credit"), detail.payment_type === "cash" ? t("po_cash") : t("po_credit")],
                [t("po_category"), detail.category_name || "—"], [t("po_delivery_location"), detail.delivery_location || "—"], [t("po_expected_date"), detail.expected_date || "—"],
                [t("po_prepared_by"), detail.created_by_name], [t("po_approved_by"), detail.approved_by_name ? `${detail.approved_by_name} · ${detail.approved_at}` : "—"],
              ].map(([l, v], i) => <div key={i} className="bg-gray-50 rounded p-2"><div className="text-gray-500">{l}</div><div className="font-medium">{v}</div></div>)}
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs"><tr>
                <th className="text-start p-2">{t("po_item")}</th><th className="text-start p-2">{t("po_packaging")}</th><th className="text-end p-2">{t("po_qty")}</th>
                <th className="text-end p-2">{t("po_unit_price")}</th><th className="text-end p-2">{t("po_line_total")}</th><th className="text-end p-2">{t("po_received_qty")}</th>
              </tr></thead>
              <tbody>
                {detail.items?.map(i => (
                  <tr key={i.id} className="border-t">
                    <td className="p-2">{ar && i.item_name_ar ? i.item_name_ar : i.item_name}</td><td className="p-2 text-xs">{i.packaging}</td>
                    <td className="p-2 text-end">{i.quantity} {i.unit}</td><td className="p-2 text-end">{kd(i.unit_price)}</td>
                    <td className="p-2 text-end font-semibold">{kd(i.total)}</td><td className="p-2 text-end">{i.received_qty ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t font-bold"><td colSpan={4} className="p-2 text-end">{t("total")}</td><td className="p-2 text-end">KD {kd(detail.total)}</td><td /></tr></tfoot>
            </table>
            {detail.notes && <div className="text-xs"><b>{t("notes")}:</b> {detail.notes}</div>}
            {detail.attachment && <a href={detail.attachment} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 underline">{t("po_attachment")}</a>}
            {detail.received_date && <div className="text-xs"><b>{t("po_received_date")}:</b> {detail.received_date} · {detail.received_by_name} {detail.receiving_notes && `· ${detail.receiving_notes}`}
              {detail.receiving_attachment && <> · <a href={detail.receiving_attachment} target="_blank" rel="noreferrer" className="text-emerald-700 underline">{t("po_delivery_note")}</a></>}</div>}
            {detail.invoice && (
              <div className="border rounded p-3 space-y-2">
                <div className="flex flex-wrap justify-between gap-2">
                  <div className="font-semibold">{t("po_invoices")}: {detail.invoice.invoice_number || "—"} · {detail.invoice.date} {detail.invoice.due_date && `· ${t("po_due_date")} ${detail.invoice.due_date}`}</div>
                  <div>{t("total")} <b>{kd(detail.invoice.total_amount)}</b> · {t("po_paid")} <b className="text-green-700">{kd(detail.invoice.paid_amount)}</b> · {t("po_balance")} <b className="text-red-700">{kd(detail.invoice.balance)}</b></div>
                </div>
                {detail.invoice.attachment && <a href={detail.invoice.attachment} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 underline">{t("po_invoice_copy")}</a>}
                {detail.invoice.payments.length > 0 && (
                  <table className="w-full text-xs"><thead><tr className="text-gray-500"><th className="text-start p-1">{t("date")}</th><th className="text-start p-1">{t("po_paid_from")}</th><th className="text-start p-1">{t("po_reference")}</th><th className="text-end p-1">{t("amount")}</th><th className="text-start p-1">{t("po_prepared_by")}</th></tr></thead>
                    <tbody>{detail.invoice.payments.map(p => <tr key={p.id} className="border-t"><td className="p-1">{p.date}</td><td className="p-1">{methodLabel(p.method)}</td><td className="p-1">{p.reference}</td><td className="p-1 text-end">{kd(p.amount)}</td><td className="p-1">{p.created_by_name}</td></tr>)}</tbody></table>
                )}
              </div>
            )}
            <div>
              <div className="font-semibold text-xs text-gray-600 mb-1">{t("po_history")}</div>
              <ul className="text-xs space-y-0.5">{detail.logs?.map((l, i) => <li key={i}>{l.at} · <b>{l.label}</b> · {l.user_name} {l.comment && `— ${l.comment}`}</li>)}</ul>
            </div>
            <div className="flex gap-2 justify-end flex-wrap">{actionsFor(detail).map((b, i) => <span key={i} onClick={() => setDetail(null)}>{b}</span>)}</div>
          </div>
        </div>
      )}

      {approveOrder && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
          <form className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-3" onSubmit={async e => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const action = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") || "approve";
            fd.set("action", action);
            await run(() => post(`/api/procurement/orders/${approveOrder.id}/approve`, fd));
            setApproveOrder(null);
          }}>
            <h2 className="font-bold">{t("po_approve")} — {approveOrder.po_no}</h2>
            <div className="text-sm">{approveOrder.supplier_name} · {approveOrder.payment_type === "cash" ? t("po_cash") : t("po_credit")} · {t("total")} KD {kd(approveOrder.total)}</div>
            <textarea name="comment" className={inp} rows={2} placeholder={t("po_comment")} />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setApproveOrder(null)} className={`${btn} bg-gray-100`}>{t("cancel")}</button>
              <button type="submit" value="reject" className={`${btn} bg-red-600 text-white`}>{t("po_reject")}</button>
              <button type="submit" value="return" className={`${btn} bg-orange-500 text-white`}>{t("po_return")}</button>
              <button type="submit" value="approve" className={`${btn} bg-blue-600 text-white`} disabled={busy}>{t("po_approve")}</button>
            </div>
          </form>
        </div>
      )}

      {receiveOrder && <ReceiveForm order={receiveOrder} ar={ar} onClose={() => setReceiveOrder(null)} onSaved={() => { setReceiveOrder(null); reload(); }} />}

      {invoiceOrder && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
          <InvoiceForm order={invoiceOrder} onClose={() => setInvoiceOrder(null)} onSaved={() => { setInvoiceOrder(null); reload(); }} />
        </div>
      )}

      {payInvoice && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
          <PayForm inv={payInvoice} methodLabel={methodLabel} onClose={() => setPayInvoice(null)} onSaved={() => { setPayInvoice(null); reload(); }} />
        </div>
      )}
      {isOfficer && null}
    </div>
  );
}

function OrderForm({ brandId, order, suppliers, categories, locations, ar, onClose, onSaved }: {
  brandId: number; order: Order | null; suppliers: Supplier[]; categories: Category[]; locations: { name: string; name_ar: string }[]; ar: boolean;
  onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [supplierId, setSupplierId] = useState(order ? String(order.supplier_id) : "");
  const [categoryId, setCategoryId] = useState(order?.category_id ? String(order.category_id) : "");
  const [paymentType, setPaymentType] = useState(order?.payment_type || "cash");
  const [orderDate, setOrderDate] = useState(order?.date || today());
  const [expected, setExpected] = useState(order?.expected_date || "");
  const [location, setLocation] = useState(order?.delivery_location || "");
  const [notes, setNotes] = useState(order?.notes || "");
  const [file, setFile] = useState<File | null>(null);
  const [items, setItems] = useState<SupItem[]>([]);
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (order) apiGet(`/api/procurement/orders/${order.id}`).then((d: Order) => {
      setLines((d.items || []).map(i => ({ supplier_item_id: i.supplier_item_id, item_name: i.item_name, item_name_ar: i.item_name_ar, packaging: i.packaging, unit: i.unit, quantity: String(i.quantity), unit_price: String(i.unit_price) })));
    });
  }, [order?.id]);

  useEffect(() => {
    if (!supplierId) { setItems([]); return; }
    apiGet(`/api/procurement/suppliers/${supplierId}/items`).then(setItems);
    const s = suppliers.find(x => String(x.id) === supplierId);
    if (s && !order) {
      setPaymentType(s.payment_type === "credit" ? "credit" : "cash");
      if (s.category_id) setCategoryId(String(s.category_id));
    }
  }, [supplierId]);

  const setLine = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l));
  const pickItem = (i: number, id: string) => {
    const it = items.find(x => String(x.id) === id);
    if (!it) { setLine(i, { supplier_item_id: null }); return; }
    setLine(i, { supplier_item_id: it.id, item_name: it.item_name, item_name_ar: it.item_name_ar, packaging: it.packaging, unit: it.unit, unit_price: String(it.unit_price) });
  };
  const total = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0), 0);

  const save = async (submit: boolean) => {
    setError("");
    const valid = lines.filter(l => (parseFloat(l.quantity) || 0) > 0 && l.item_name.trim());
    if (!supplierId) { setError(t("po_supplier")); return; }
    if (valid.length === 0) { setError(t("po_min_item")); return; }
    const fd = new FormData();
    fd.set("brand_id", String(brandId)); fd.set("supplier_id", supplierId); if (categoryId) fd.set("category_id", categoryId);
    fd.set("order_date", orderDate); fd.set("expected_date", expected); fd.set("payment_type", paymentType);
    fd.set("delivery_location", location); fd.set("notes", notes); fd.set("submit", submit ? "true" : "false");
    fd.set("items", JSON.stringify(valid.map(l => ({ ...l, quantity: parseFloat(l.quantity), unit_price: parseFloat(l.unit_price) || 0 }))));
    if (file) fd.set("attachment", file);
    setSaving(true);
    try {
      await post(order ? `/api/procurement/orders/${order.id}` : "/api/procurement/orders", fd, order ? "PUT" : "POST");
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : t("po_error")); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl my-4 overflow-hidden">
        <div className="flex justify-between items-center px-5 py-3 bg-emerald-700 text-white">
          <div>
            <h2 className="text-lg font-bold">{order ? order.po_no : t("po_new_order")}</h2>
            <div className="text-xs text-emerald-100">{t("po_delivery_hint")}</div>
          </div>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="block"><span className="text-xs text-gray-600">{t("po_supplier")} *</span>
              <select className={inp} value={supplierId} onChange={e => setSupplierId(e.target.value)} required>
                <option value="">—</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></label>
            <label className="block"><span className="text-xs text-gray-600">{t("po_category")}</span>
              <select className={inp} value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                <option value="">—</option>{categories.map(c => <option key={c.id} value={c.id}>{ar && c.name_ar ? c.name_ar : c.name}</option>)}
              </select></label>
            <label className="block"><span className="text-xs text-gray-600">{t("po_cash_credit")}</span>
              <select className={inp} value={paymentType} onChange={e => setPaymentType(e.target.value)}>
                <option value="cash">{t("po_cash")}</option><option value="credit">{t("po_credit")}</option>
              </select></label>
            <label className="block"><span className="text-xs text-gray-600">{t("date")}</span><input type="date" className={inp} value={orderDate} onChange={e => setOrderDate(e.target.value)} /></label>
            <label className="block"><span className="text-xs text-gray-600">{t("po_expected_date")}</span><input type="date" className={inp} value={expected} onChange={e => setExpected(e.target.value)} /></label>
            <label className="block"><span className="text-xs text-gray-600">{t("po_delivery_location")}</span>
              <input list="po-locs" className={inp} value={location} onChange={e => setLocation(e.target.value)} />
              <datalist id="po-locs">{locations.map(l => <option key={l.name} value={l.name}>{ar && l.name_ar ? l.name_ar : l.name}</option>)}</datalist></label>
          </div>

          <div className="border rounded-lg">
            <div className="flex justify-between items-center px-3 py-2 bg-gray-50 border-b">
              <span className="font-semibold">{t("po_items")}</span>
              <button type="button" onClick={() => setLines(ls => [...ls, emptyLine()])} className={`${btn} bg-emerald-50 text-emerald-700 inline-flex items-center gap-1`}><Plus size={14} />{t("po_add_item")}</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[800px]">
                <thead className="text-xs text-gray-600"><tr>
                  <th className="text-start p-2 w-[40%]">{t("po_item")}</th><th className="text-start p-2">{t("po_packaging")}</th><th className="text-start p-2">{t("po_unit")}</th>
                  <th className="text-end p-2">{t("po_qty")}</th><th className="text-end p-2">{t("po_unit_price")}</th><th className="text-end p-2">{t("po_line_total")}</th><th />
                </tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2 space-y-1">
                        {items.length > 0 && (
                          <select className={inp} value={l.supplier_item_id ? String(l.supplier_item_id) : ""} onChange={e => pickItem(i, e.target.value)}>
                            <option value="">{t("po_pick_item")}</option>
                            {items.map(it => <option key={it.id} value={it.id}>{ar && it.item_name_ar ? it.item_name_ar : it.item_name}{it.packaging ? ` (${it.packaging})` : ""} — {kd(it.unit_price)}</option>)}
                          </select>
                        )}
                        <input className={inp} placeholder={t("po_custom_item")} value={l.item_name} onChange={e => setLine(i, { item_name: e.target.value, supplier_item_id: null })} />
                      </td>
                      <td className="p-2"><input className={inp} value={l.packaging} onChange={e => setLine(i, { packaging: e.target.value })} /></td>
                      <td className="p-2"><input className={`${inp} w-20`} value={l.unit} onChange={e => setLine(i, { unit: e.target.value })} /></td>
                      <td className="p-2"><input type="number" step="0.001" min="0" className={`${inp} w-24 text-end`} value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} /></td>
                      <td className="p-2"><input type="number" step="0.001" min="0" className={`${inp} w-28 text-end`} value={l.unit_price} onChange={e => setLine(i, { unit_price: e.target.value })} /></td>
                      <td className="p-2 text-end font-semibold">{kd((parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0))}</td>
                      <td className="p-2"><button type="button" onClick={() => setLines(ls => ls.length > 1 ? ls.filter((_, j) => j !== i) : ls)} className="text-red-600"><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t bg-gray-50 font-bold"><td colSpan={5} className="p-2 text-end">{t("total")}</td><td className="p-2 text-end">KD {kd(total)}</td><td /></tr></tfoot>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block"><span className="text-xs text-gray-600">{t("notes")}</span><textarea className={inp} rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>
            <div><span className="text-xs text-gray-600 block mb-1">{t("po_attachment")}</span><FileBtn label={t("po_attachment")} file={file} onChange={setFile} />
              {order?.attachment && !file && <a href={order.attachment} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 underline block mt-1">{t("po_attachment")}</a>}</div>
          </div>
          {error && <div className="text-red-700 text-sm">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t bg-gray-50">
          <button type="button" onClick={onClose} className={`${btn} bg-gray-200`}>{t("cancel")}</button>
          <button type="button" disabled={saving} onClick={() => save(false)} className={`${btn} bg-gray-700 text-white`}>{t("po_save_draft")}</button>
          <button type="button" disabled={saving} onClick={() => save(true)} className={`${btn} bg-emerald-600 text-white`}>{t("po_submit")}</button>
        </div>
      </div>
    </div>
  );
}

function ReceiveForm({ order, ar, onClose, onSaved }: { order: Order; ar: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [qty, setQty] = useState<Record<number, string>>(Object.fromEntries((order.items || []).map(i => [i.id, String(i.quantity)])));
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    const fd = new FormData();
    fd.set("received_date", date); fd.set("notes", notes);
    fd.set("received", JSON.stringify((order.items || []).map(i => ({ item_id: i.id, received_qty: parseFloat(qty[i.id]) || 0 }))));
    if (file) fd.set("attachment", file);
    setSaving(true);
    try { await post(`/api/procurement/orders/${order.id}/receive`, fd); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : t("po_error")); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-5 space-y-3 text-sm">
        <h2 className="font-bold">{t("po_receive")} — {order.po_no}</h2>
        <table className="w-full"><thead className="text-xs text-gray-600"><tr><th className="text-start p-1">{t("po_item")}</th><th className="text-end p-1">{t("po_qty")}</th><th className="text-end p-1">{t("po_received_qty")}</th></tr></thead>
          <tbody>{(order.items || []).map(i => (
            <tr key={i.id} className="border-t"><td className="p-1">{ar && i.item_name_ar ? i.item_name_ar : i.item_name} <span className="text-xs text-gray-500">{i.packaging}</span></td>
              <td className="p-1 text-end">{i.quantity} {i.unit}</td>
              <td className="p-1 text-end"><input type="number" step="0.001" min="0" className={`${inp} w-28 text-end inline-block`} value={qty[i.id]} onChange={e => setQty({ ...qty, [i.id]: e.target.value })} /></td></tr>
          ))}</tbody></table>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block"><span className="text-xs text-gray-600">{t("po_received_date")}</span><input type="date" className={inp} value={date} onChange={e => setDate(e.target.value)} /></label>
          <div><span className="text-xs text-gray-600 block mb-1">{t("po_delivery_note")}</span><FileBtn label={t("po_delivery_note")} file={file} onChange={setFile} /></div>
        </div>
        <textarea className={inp} rows={2} placeholder={t("po_receiving_notes")} value={notes} onChange={e => setNotes(e.target.value)} />
        {error && <div className="text-red-700">{error}</div>}
        <div className="flex justify-end gap-2"><button onClick={onClose} className={`${btn} bg-gray-100`}>{t("cancel")}</button><button disabled={saving} onClick={submit} className={`${btn} bg-purple-600 text-white`}>{t("po_receive")}</button></div>
      </div>
    </div>
  );
}

function InvoiceForm({ order, onClose, onSaved }: { order: Order; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <form className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-3 text-sm" onSubmit={async e => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      if (file) fd.set("attachment", file);
      setSaving(true);
      try { await post(`/api/procurement/orders/${order.id}/invoice`, fd); onSaved(); }
      catch (er) { setError(er instanceof Error ? er.message : t("po_error")); }
      finally { setSaving(false); }
    }}>
      <h2 className="font-bold">{t("po_record_invoice")} — {order.po_no}</h2>
      <div className="text-xs text-gray-600">{order.supplier_name} · {order.payment_type === "cash" ? t("po_cash") : t("po_credit")} · {t("total")} KD {kd(order.total)}</div>
      <label className="block"><span className="text-xs text-gray-600">{t("po_invoice_no")}</span><input name="invoice_number" className={inp} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="text-xs text-gray-600">{t("po_invoice_date")}</span><input type="date" name="invoice_date" className={inp} defaultValue={today()} required /></label>
        <label className="block"><span className="text-xs text-gray-600">{t("po_due_date")}</span><input type="date" name="due_date" className={inp} /></label>
      </div>
      <label className="block"><span className="text-xs text-gray-600">{t("po_invoice_amount")}</span><input type="number" step="0.001" min="0" name="total_amount" className={inp} defaultValue={kd(order.total)} required /></label>
      <FileBtn label={t("po_invoice_copy")} file={file} onChange={setFile} />
      <textarea name="notes" className={inp} rows={2} placeholder={t("notes")} />
      {error && <div className="text-red-700">{error}</div>}
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={`${btn} bg-gray-100`}>{t("cancel")}</button><button type="submit" disabled={saving} className={`${btn} bg-cyan-600 text-white`}>{t("save")}</button></div>
    </form>
  );
}

function PayForm({ inv, methodLabel, onClose, onSaved }: { inv: Invoice; methodLabel: (m: string) => string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [method, setMethod] = useState(inv.payment_type === "cash" ? "purchase_petty_cash" : "bank_transfer");
  const [channelId, setChannelId] = useState("");
  const [payDate, setPayDate] = useState(today());
  return (
    <form className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-3 text-sm" onSubmit={async e => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      setSaving(true);
      try { await post(`/api/procurement/invoices/${inv.id}/pay`, fd); onSaved(); }
      catch (er) { setError(er instanceof Error ? er.message : t("po_error")); }
      finally { setSaving(false); }
    }}>
      <h2 className="font-bold">{t("po_record_payment")} — {inv.po_no}</h2>
      <div className="text-xs text-gray-600">{inv.supplier_name} · {t("po_invoice_no")} {inv.invoice_number || "—"} · {t("po_balance")} <b className="text-red-700">KD {kd(inv.balance)}</b></div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="text-xs text-gray-600">{t("amount")}</span><input type="number" step="0.001" min="0.001" max={inv.balance} name="amount" className={inp} defaultValue={kd(inv.balance)} required /></label>
        <label className="block"><span className="text-xs text-gray-600">{t("date")}</span><input type="date" name="pay_date" className={inp} value={payDate} onChange={e => setPayDate(e.target.value)} required /></label>
      </div>
      <label className="block"><span className="text-xs text-gray-600">{t("po_paid_from")}</span>
        <select name="method" className={inp} value={method} onChange={e => { setMethod(e.target.value); setChannelId(""); }}>
          {METHODS.map(m => <option key={m} value={m}>{methodLabel(m)}</option>)}
        </select></label>
      <ChannelSelect name="channel_id" value={channelId} onChange={setChannelId} method={method} date={payDate} className={inp} required />
      <div className="text-xs text-gray-500">{t("po_pay_hint")}</div>
      <label className="block"><span className="text-xs text-gray-600">{t("po_reference")}</span><input name="reference" className={inp} /></label>
      <textarea name="notes" className={inp} rows={2} placeholder={t("notes")} />
      {error && <div className="text-red-700">{error}</div>}
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={`${btn} bg-gray-100`}>{t("cancel")}</button><button type="submit" disabled={saving} className={`${btn} bg-green-600 text-white`}>{t("po_pay")}</button></div>
    </form>
  );
}
