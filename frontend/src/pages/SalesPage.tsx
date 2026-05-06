import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../contexts/api";
import { useAuth } from "../contexts/AuthContext";

interface Branch { id: number; name: string; name_ar: string; }
interface Sale {
  id: number; branch_id: number; date: string;
  foodics_cash: number; foodics_knet: number; foodics_link: number; foodics_wamd: number;
  foodics_talabat: number; foodics_keeta: number; foodics_jahez: number; foodics_other: number;
  physical_cash: number; physical_knet: number; physical_link: number; physical_wamd: number;
  physical_talabat: number; physical_keeta: number; physical_jahez: number; physical_other: number;
  attachment_path: string | null;
}

const channels = ["cash", "knet", "link", "wamd"] as const;

function sumRow(s: Sale, prefix: "foodics" | "physical") {
  return channels.reduce((acc, ch) => acc + ((s as unknown as Record<string, number>)[`${prefix}_${ch}`] || 0), 0);
}

export default function SalesPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [branchFilter, setBranchFilter] = useState<string>("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const isStaff = user?.role === "staff";

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
    setError("");
    const fd = new FormData(e.currentTarget);
    try {
      const res = await apiPost("/api/sales/", fd);
      if (res.detail) {
        setError(t("duplicate_date_error"));
        return;
      }
      setShowForm(false);
      loadSales(branchFilter);
    } catch {
      setError(t("duplicate_date_error"));
    }
  };

  const branchName = (id: number) => {
    const b = branches.find(br => br.id === id);
    return b ? (i18n.language === "ar" ? b.name_ar || b.name : b.name) : "";
  };

  const downloadCSV = () => {
    const params = branchFilter ? `?branch_id=${branchFilter}` : "";
    window.open(`/api/export/sales/csv${params}`, "_blank");
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-gray-800">{t("sales")}</h2>
        <div className="flex gap-2">
          <button onClick={downloadCSV}
            className="px-3 py-1.5 bg-green-600 text-white rounded text-xs hover:bg-green-700">
            {t("export_csv")}
          </button>
          <button onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm">
            {showForm ? t("cancel") : t("add_new")}
          </button>
        </div>
      </div>

      <div className="mb-4">
        {!isStaff && (
          <select value={branchFilter} onChange={e => handleFilter(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm">
            <option value="">{t("all_branches")}</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-2 rounded mb-4 text-sm">{error}</div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {!isStaff ? (
              <div>
                <label className="block text-sm font-medium mb-1">{t("branch")}</label>
                <select name="branch_id" required className="w-full px-3 py-2 border rounded-lg text-sm">
                  {branches.filter(b => !b.name.includes("Central")).map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <input type="hidden" name="branch_id" value={user?.branch_id || ""} />
            )}
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
            <div className="flex gap-2">
              <input type="file" name="attachment" ref={fileRef} className="text-sm" accept="image/*,.pdf" />
              <input type="file" name="camera_attachment" ref={cameraRef} capture="environment" accept="image/*"
                className="hidden" onChange={e => {
                  if (e.target.files?.[0] && fileRef.current) {
                    const dt = new DataTransfer();
                    dt.items.add(e.target.files[0]);
                    fileRef.current.files = dt.files;
                  }
                }} />
              <button type="button" onClick={() => cameraRef.current?.click()}
                className="px-3 py-1.5 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">
                📷 {t("take_picture")}
              </button>
            </div>
          </div>
          <button type="submit"
            className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm">
            {t("save")}
          </button>
        </form>
      )}

      {/* Spreadsheet-style table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="text-xs min-w-[900px] w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th rowSpan={2} className="px-2 py-2 text-left border-r sticky left-0 bg-gray-50 z-10">{t("date")}</th>
              <th rowSpan={2} className="px-2 py-2 text-left border-r">{t("branch")}</th>
              <th colSpan={channels.length + 1} className="px-2 py-1 text-center border-r bg-emerald-50 text-emerald-700">
                {t("foodics_data")}
              </th>
              <th colSpan={channels.length + 1} className="px-2 py-1 text-center border-r bg-blue-50 text-blue-700">
                {t("physical_data")}
              </th>
              <th rowSpan={2} className="px-2 py-2 text-right">{t("difference")}</th>
            </tr>
            <tr>
              {channels.map(ch => (
                <th key={`fh_${ch}`} className="px-1.5 py-1 text-right bg-emerald-50 text-emerald-600 font-medium">{t(ch)}</th>
              ))}
              <th className="px-1.5 py-1 text-right bg-emerald-50 text-emerald-700 font-bold border-r">{t("total")}</th>
              {channels.map(ch => (
                <th key={`ph_${ch}`} className="px-1.5 py-1 text-right bg-blue-50 text-blue-600 font-medium">{t(ch)}</th>
              ))}
              <th className="px-1.5 py-1 text-right bg-blue-50 text-blue-700 font-bold border-r">{t("total")}</th>
            </tr>
          </thead>
          <tbody>
            {sales.length === 0 ? (
              <tr><td colSpan={13} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
            ) : sales.map(s => {
              const foodics = sumRow(s, "foodics");
              const physical = sumRow(s, "physical");
              const diff = physical - foodics;
              return (
                <tr key={s.id} className="border-b hover:bg-gray-50">
                  <td className="px-2 py-2 sticky left-0 bg-white border-r font-medium">{s.date}</td>
                  <td className="px-2 py-2 border-r">{branchName(s.branch_id)}</td>
                  {channels.map(ch => (
                    <td key={`f_${ch}`} className="px-1.5 py-2 text-right font-mono">
                      {((s as unknown as Record<string, number>)[`foodics_${ch}`] || 0).toFixed(3)}
                    </td>
                  ))}
                  <td className="px-1.5 py-2 text-right font-mono font-bold bg-emerald-50 border-r">
                    {foodics.toFixed(3)}
                  </td>
                  {channels.map(ch => (
                    <td key={`p_${ch}`} className="px-1.5 py-2 text-right font-mono">
                      {((s as unknown as Record<string, number>)[`physical_${ch}`] || 0).toFixed(3)}
                    </td>
                  ))}
                  <td className="px-1.5 py-2 text-right font-mono font-bold bg-blue-50 border-r">
                    {physical.toFixed(3)}
                  </td>
                  <td className={`px-2 py-2 text-right font-mono font-bold ${diff !== 0 ? "text-red-600" : "text-green-600"}`}>
                    {diff.toFixed(3)}
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
