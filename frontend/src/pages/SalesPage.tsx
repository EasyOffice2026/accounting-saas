import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../contexts/api";

interface Branch { id: number; name: string; name_ar: string; }
interface Sale {
  id: number; branch_id: number; date: string;
  foodics_cash: number; foodics_knet: number; foodics_link: number; foodics_wamd: number;
  foodics_talabat: number; foodics_keeta: number; foodics_jahez: number; foodics_other: number;
  physical_cash: number; physical_knet: number; physical_link: number; physical_wamd: number;
  physical_talabat: number; physical_keeta: number; physical_jahez: number; physical_other: number;
}

const channels = ["cash", "knet", "link", "wamd", "talabat", "keeta", "jahez", "other"] as const;

function sumRow(s: Sale, prefix: "foodics" | "physical") {
  return channels.reduce((acc, ch) => acc + ((s as Record<string, number>)[`${prefix}_${ch}`] || 0), 0);
}

export default function SalesPage() {
  const { t, i18n } = useTranslation();
  const [sales, setSales] = useState<Sale[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [branchFilter, setBranchFilter] = useState<string>("");

  useEffect(() => {
    apiGet("/api/branches/").then(setBranches);
    loadSales();
  }, []);

  const loadSales = (bid?: string) => {
    const url = bid ? `/api/sales/?branch_id=${bid}` : "/api/sales/";
    apiGet(url).then(setSales);
  };

  const handleFilter = (bid: string) => {
    setBranchFilter(bid);
    loadSales(bid);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await apiPost("/api/sales/", fd);
    setShowForm(false);
    loadSales(branchFilter);
  };

  const branchName = (id: number) => {
    const b = branches.find(br => br.id === id);
    return b ? (i18n.language === "ar" ? b.name_ar || b.name : b.name) : "";
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">{t("sales")}</h2>
        <button onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm">
          {showForm ? t("cancel") : t("add_new")}
        </button>
      </div>

      <div className="mb-4">
        <select value={branchFilter} onChange={e => handleFilter(e.target.value)}
          className="px-3 py-2 border rounded-lg text-sm">
          <option value="">{t("all_branches")}</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">{t("branch")}</label>
              <select name="branch_id" required className="w-full px-3 py-2 border rounded-lg text-sm">
                {branches.filter(b => !b.name.includes("Central")).map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("date")}</label>
              <input type="date" name="sale_date" required className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>

          <h3 className="font-semibold text-emerald-700">{t("foodics_data")}</h3>
          <div className="grid grid-cols-4 gap-3">
            {channels.map(ch => (
              <div key={`f_${ch}`}>
                <label className="block text-xs text-gray-500 mb-1">{t(ch)}</label>
                <input type="number" step="0.001" name={`foodics_${ch}`} defaultValue="0"
                  className="w-full px-2 py-1.5 border rounded text-sm" />
              </div>
            ))}
          </div>

          <h3 className="font-semibold text-blue-700">{t("physical_data")}</h3>
          <div className="grid grid-cols-4 gap-3">
            {channels.map(ch => (
              <div key={`p_${ch}`}>
                <label className="block text-xs text-gray-500 mb-1">{t(ch)}</label>
                <input type="number" step="0.001" name={`physical_${ch}`} defaultValue="0"
                  className="w-full px-2 py-1.5 border rounded text-sm" />
              </div>
            ))}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t("notes")}</label>
            <textarea name="notes" className="w-full px-3 py-2 border rounded-lg text-sm" rows={2} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("attachment")}</label>
            <input type="file" name="attachment" className="text-sm" />
          </div>
          <button type="submit"
            className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm">
            {t("save")}
          </button>
        </form>
      )}

      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left">{t("date")}</th>
              <th className="px-4 py-3 text-left">{t("branch")}</th>
              <th className="px-4 py-3 text-right">{t("foodics_data")}</th>
              <th className="px-4 py-3 text-right">{t("physical_data")}</th>
              <th className="px-4 py-3 text-right">{t("difference")}</th>
            </tr>
          </thead>
          <tbody>
            {sales.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
            ) : sales.map(s => {
              const foodics = sumRow(s, "foodics");
              const physical = sumRow(s, "physical");
              const diff = physical - foodics;
              return (
                <tr key={s.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3">{s.date}</td>
                  <td className="px-4 py-3">{branchName(s.branch_id)}</td>
                  <td className="px-4 py-3 text-right font-mono">KD {foodics.toFixed(3)}</td>
                  <td className="px-4 py-3 text-right font-mono">KD {physical.toFixed(3)}</td>
                  <td className={`px-4 py-3 text-right font-mono ${diff !== 0 ? "text-red-600 font-semibold" : "text-green-600"}`}>
                    KD {diff.toFixed(3)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
