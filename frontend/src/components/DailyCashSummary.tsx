import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiDownload } from "../contexts/api";

interface Brand { id: number; name_en: string; name_ar: string; }
interface Row {
  branch_id: number; branch: string; branch_ar: string; brand: string; brand_ar: string;
  opening_balance: number; cash_sales: number; petty_cash_in: number; cash_expenses: number;
  cash_purchases: number; cash_withdrawn: number; deposited: number; closing_balance: number;
}
interface Daily { date: string; rows: Row[]; totals: Omit<Row, "branch_id" | "branch" | "branch_ar" | "brand" | "brand_ar">; }

const KEYS = ["opening_balance", "cash_sales", "petty_cash_in", "cash_expenses",
  "cash_purchases", "cash_withdrawn", "deposited", "closing_balance"] as const;
const LABELS: Record<typeof KEYS[number], string> = {
  opening_balance: "opening_balance", cash_sales: "cash_sales", petty_cash_in: "petty_cash_in",
  cash_expenses: "cash_expenses", cash_purchases: "cash_purchases", cash_withdrawn: "cash_withdrawn",
  deposited: "deposited", closing_balance: "closing_balance",
};

export default function DailyCashSummary() {
  const { t, i18n } = useTranslation();
  const ar = i18n.language === "ar";
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [brandId, setBrandId] = useState("");
  const [brands, setBrands] = useState<Brand[]>([]);
  const [data, setData] = useState<Daily | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { apiGet("/api/hr/brands").then(setBrands).catch(() => setBrands([])); }, []);

  const query = () => {
    const q = new URLSearchParams({ summary_date: date });
    if (brandId) q.set("brand_id", brandId);
    return q.toString();
  };

  useEffect(() => {
    setLoading(true);
    apiGet(`/api/cash/daily?${query()}`).then(setData).finally(() => setLoading(false));
  }, [date, brandId]);

  const fmt = (n: number) => n.toFixed(3);
  const neg = (n: number) => n < 0 ? "text-red-600" : "";

  return (
    <div>
      <div className="flex gap-3 mb-4 flex-wrap items-end justify-between">
        <div className="flex gap-3 flex-wrap items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t("date")}</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t("brand")}</label>
            <select value={brandId} onChange={e => setBrandId(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
              <option value="">{t("all_brands")}</option>
              {brands.map(b => <option key={b.id} value={b.id}>{ar ? b.name_ar || b.name_en : b.name_en}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => apiDownload(`/api/cash/daily/export/excel?${query()}&lang=${i18n.language}`, `daily_cash_summary_${date}.xlsx`)}
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">{t("export_excel")}</button>
          <button onClick={() => apiDownload(`/api/cash/daily/export/pdf?${query()}&lang=${i18n.language}`, `daily_cash_summary_${date}.pdf`)}
            className="px-3 py-1.5 bg-red-600 text-white rounded text-xs hover:bg-red-700">{t("export_pdf")}</button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <div className="px-4 py-3 border-b font-semibold">{t("daily_cash_summary")} — {date}</div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 text-left">{t("brand")}</th>
              <th className="px-3 py-2 text-left">{t("branch")}</th>
              {KEYS.map(k => <th key={k} className="px-3 py-2 text-right whitespace-nowrap">{t(LABELS[k])}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-400">{t("loading")}</td></tr>}
            {!loading && data?.rows.map(r => (
              <tr key={r.branch_id} className="border-t hover:bg-gray-50">
                <td className="px-3 py-2">{ar ? r.brand_ar || r.brand : r.brand}</td>
                <td className="px-3 py-2 font-medium">{ar ? r.branch_ar || r.branch : r.branch}</td>
                {KEYS.map(k => (
                  <td key={k} className={`px-3 py-2 text-right ${k === "closing_balance" ? "font-semibold" : ""} ${neg(r[k])}`}>
                    {fmt(r[k])}
                  </td>
                ))}
              </tr>
            ))}
            {!loading && data && data.rows.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-400">{t("no_data")}</td></tr>
            )}
          </tbody>
          {data && data.rows.length > 0 && (
            <tfoot className="bg-gray-100 border-t font-bold">
              <tr>
                <td className="px-3 py-3" colSpan={2}>{t("total")}</td>
                {KEYS.map(k => <td key={k} className={`px-3 py-3 text-right ${neg(data.totals[k])}`}>KD {fmt(data.totals[k])}</td>)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
