import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { apiGet } from "../contexts/api";
import { useBrand } from "../contexts/BrandContext";
import { Wallet, ArrowDownCircle, ArrowUpCircle, Package, AlertTriangle, FileText, Banknote, Truck } from "lucide-react";

interface Order {
  id: number; po_no: string; supplier_name: string; date: string; payment_type: string; total: number;
  status: string; status_label: string; delivery_location: string; item_count: number;
}
interface CashRow { id: number; date: string; txn_type: string; category: string; amount: number; reference: string; notes: string; }
interface Data {
  petty_cash_branch_name: string; petty_cash_balance: number; cash_in_month: number; cash_out_month: number;
  purchases_month: number; cash_purchases_month: number; credit_purchases_month: number;
  outstanding: number; overdue: number; open_invoices: number;
  orders: Record<string, number>; recent_orders: Order[]; recent_cash: CashRow[];
  top_suppliers: { supplier_id: number; supplier_name: string; balance: number }[];
}

export const PO_STATUS_CLS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700", pending: "bg-amber-100 text-amber-800", approved: "bg-blue-100 text-blue-800",
  ordered: "bg-indigo-100 text-indigo-800", received: "bg-purple-100 text-purple-800", invoiced: "bg-cyan-100 text-cyan-800",
  paid: "bg-green-100 text-green-800", closed: "bg-green-200 text-green-900", returned: "bg-orange-100 text-orange-800",
  rejected: "bg-red-100 text-red-800", cancelled: "bg-gray-200 text-gray-600",
};
const kd = (v: number | null | undefined) => `KD ${(v || 0).toFixed(3)}`;

function Card({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub?: string; icon: typeof Wallet; color: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border p-4 flex items-center gap-4">
      <div className={`${color} text-white rounded-lg p-3 shrink-0`}><Icon size={22} /></div>
      <div className="min-w-0">
        <div className="text-xs text-gray-500 uppercase tracking-wide truncate">{label}</div>
        <div className="text-xl font-bold truncate">{value}</div>
        {sub && <div className="text-xs text-gray-500 truncate">{sub}</div>}
      </div>
    </div>
  );
}

function Panel({ title, icon, link, children }: { title: string; icon: React.ReactNode; link?: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="bg-white rounded-xl shadow-sm border">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2 font-semibold text-gray-700">{icon}{title}</div>
        {link && <Link to={link} className="text-xs text-emerald-700 hover:underline">{t("view_all")}</Link>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function PurchaseDashboardPage() {
  const { t, i18n } = useTranslation();
  const ar = i18n.language === "ar";
  const { selectedBrand } = useBrand();
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    apiGet("/api/procurement/dashboard").then(setData).catch(() => setData(null));
  }, [selectedBrand?.id]);

  if (!data) return <div className="p-6 text-gray-500">{t("loading")}</div>;
  const o = data.orders;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{t("po_title")}</h1>
          <p className="text-sm text-gray-500">{selectedBrand ? (ar && selectedBrand.name_ar ? selectedBrand.name_ar : selectedBrand.name_en) : ""} · {t("po_subtitle")}</p>
        </div>
        <Link to="/procurement?new=1" className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-4 py-2 rounded-lg flex items-center gap-2">
          <FileText size={16} /> {t("po_new_order")}
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card label={t("po_office_cash")} value={kd(data.petty_cash_balance)} sub={data.petty_cash_branch_name} icon={Wallet} color="bg-emerald-600" />
        <Card label={t("po_purchases_month")} value={kd(data.purchases_month)}
          sub={`${t("po_cash")} ${kd(data.cash_purchases_month)} · ${t("po_credit")} ${kd(data.credit_purchases_month)}`} icon={Package} color="bg-blue-500" />
        <Card label={t("po_outstanding")} value={kd(data.outstanding)} sub={`${data.open_invoices} ${t("po_open_invoices")}`} icon={Banknote} color="bg-violet-500" />
        <Card label={t("po_overdue")} value={kd(data.overdue)} icon={AlertTriangle} color={data.overdue > 0 ? "bg-red-500" : "bg-gray-400"} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6 gap-3">
        {[
          { l: t("po_pending_approval"), v: o.pending || 0, c: "border-amber-200 bg-amber-50 text-amber-800" },
          { l: t("approved"), v: o.approved || 0, c: "border-blue-200 bg-blue-50 text-blue-800" },
          { l: t("po_awaiting_receipt"), v: o.ordered || 0, c: "border-indigo-200 bg-white text-indigo-800" },
          { l: t("po_awaiting_invoice"), v: o.received || 0, c: "border-purple-200 bg-white text-purple-800" },
          { l: t("po_unpaid"), v: o.invoiced || 0, c: "border-cyan-200 bg-white text-cyan-800" },
          { l: t("po_paid"), v: o.paid || 0, c: "border-green-200 bg-white text-green-800" },
        ].map((x, i) => (
          <div key={i} className={`rounded-lg border p-3 ${x.c}`}>
            <div className="text-2xl font-bold">{x.v}</div>
            <div className="text-xs">{x.l}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Panel title={t("po_recent_orders")} icon={<Truck size={16} />} link="/procurement">
          {data.recent_orders.length === 0 ? <div className="text-sm text-gray-500">{t("po_none")}</div> : (
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-500">
                <th className="text-start py-1">{t("po_no")}</th><th className="text-start py-1">{t("po_supplier")}</th>
                <th className="text-start py-1">{t("po_cash_credit")}</th><th className="text-end py-1">{t("total")}</th><th className="text-end py-1">{t("status")}</th>
              </tr></thead>
              <tbody>
                {data.recent_orders.map(r => (
                  <tr key={r.id} className="border-t">
                    <td className="py-1.5"><div className="font-mono text-xs">{r.po_no}</div><div className="text-xs text-gray-500">{r.date}</div></td>
                    <td className="py-1.5"><div className="truncate max-w-[160px]">{r.supplier_name}</div>{r.delivery_location && <div className="text-xs text-gray-500">→ {r.delivery_location}</div>}</td>
                    <td className="py-1.5 text-gray-700">{r.payment_type === "cash" ? t("po_cash") : t("po_credit")}</td>
                    <td className="py-1.5 text-end font-semibold">{kd(r.total)}</td>
                    <td className="py-1.5 text-end"><span className={`px-2 py-0.5 rounded text-xs ${PO_STATUS_CLS[r.status] || ""}`}>{r.status_label}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title={t("po_top_suppliers")} icon={<Banknote size={16} />} link="/procurement?tab=ledger">
          {data.top_suppliers.length === 0 ? <div className="text-sm text-gray-500">{t("po_none")}</div> : (
            <table className="w-full text-sm">
              <tbody>
                {data.top_suppliers.map(s => (
                  <tr key={s.supplier_id} className="border-t">
                    <td className="py-1.5">{s.supplier_name}</td>
                    <td className="py-1.5 text-end font-semibold text-red-700">{kd(s.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title={t("po_recent_cash")} icon={<Wallet size={16} />} link="/cash">
          <div className="flex gap-4 text-xs text-gray-600 mb-3">
            <span className="flex items-center gap-1"><ArrowDownCircle size={14} className="text-teal-600" /> {t("pd_cash_in_month")}: <b>{kd(data.cash_in_month)}</b></span>
            <span className="flex items-center gap-1"><ArrowUpCircle size={14} className="text-orange-600" /> {t("pd_cash_out_month")}: <b>{kd(data.cash_out_month)}</b></span>
          </div>
          {data.recent_cash.length === 0 ? <div className="text-sm text-gray-500">{t("po_none")}</div> : (
            <table className="w-full text-sm">
              <tbody>
                {data.recent_cash.map(r => (
                  <tr key={r.id} className="border-t">
                    <td className="py-1.5 font-mono text-xs">{r.date}</td>
                    <td className="py-1.5"><div className="text-xs">{r.category}</div><div className="text-xs text-gray-500 truncate max-w-[200px]">{r.reference} {r.notes}</div></td>
                    <td className={`py-1.5 text-end font-semibold ${r.txn_type === "cash_out" || r.category === "deposit" ? "text-red-700" : "text-green-700"}`}>
                      {r.txn_type === "cash_out" || r.category === "deposit" ? "−" : "+"}{kd(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
