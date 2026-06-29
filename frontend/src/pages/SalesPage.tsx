import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost, apiDownload } from "../contexts/api";
import { useAuth } from "../contexts/AuthContext";

interface Branch { id: number; name: string; name_ar: string; }
interface Sale {
  id: number; branch_id: number; date: string;
  foodics_cash: number; foodics_knet: number; foodics_link: number; foodics_wamd: number;
  foodics_talabat: number; foodics_keeta: number; foodics_jahez: number; foodics_other: number; foodics_snoonu: number;
  physical_cash: number; physical_knet: number; physical_link: number; physical_wamd: number;
  physical_talabat: number; physical_keeta: number; physical_jahez: number; physical_other: number; physical_snoonu: number;
  attachment_path: string | null;
}

const displayChannels = ["cash", "knet", "link"] as const;
const allChannels = ["cash", "knet", "link", "talabat", "jahez", "keeta", "snoonu"] as const;

function sumRow(s: Sale, prefix: "foodics" | "physical") {
  return allChannels.reduce((acc, ch) => acc + ((s as unknown as Record<string, number>)[`${prefix}_${ch}`] || 0), 0);
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
  const isOwnerManager = user?.role === "owner" || user?.role === "manager";

  // Foodics sync state
  const [showFoodicsSync, setShowFoodicsSync] = useState(false);
  const [syncDate, setSyncDate] = useState(new Date().toISOString().slice(0, 10));
  const [syncEndDate, setSyncEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [syncMsgType, setSyncMsgType] = useState<"success" | "error">("success");
  const [syncRange, setSyncRange] = useState(false);

  // WhatsApp report state
  const [showReport, setShowReport] = useState(false);
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [reportPhone, setReportPhone] = useState("");
  const [reportPreview, setReportPreview] = useState("");
  const [sending, setSending] = useState(false);
  const [reportMsg, setReportMsg] = useState("");
  const [reportMsgType, setReportMsgType] = useState<"success" | "error">("success");

  const previewReport = async () => {
    const data = await apiGet(`/api/whatsapp/preview-report?report_date=${reportDate}`);
    setReportPreview(data.report || "");
  };

  const sendWhatsAppReport = async () => {
    setSending(true);
    setReportMsg("");
    try {
      const fd = new FormData();
      fd.append("report_date", reportDate);
      if (reportPhone) fd.append("phone", reportPhone);
      const res = await apiPost("/api/whatsapp/send-daily-report", fd);
      if (res.detail) throw new Error(res.detail);
      setReportMsg(t("report_sent"));
      setReportMsgType("success");
    } catch (e: unknown) {
      const err = e as Error;
      setReportMsg(err.message || t("report_send_error"));
      setReportMsgType("error");
    }
    setSending(false);
  };

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

  const exportData = (fmt: string) => {
    const params = branchFilter ? `?branch_id=${branchFilter}` : "";
    const ext = fmt === "excel" ? "xlsx" : fmt;
    apiDownload(`/api/export/sales/${fmt}${params}`, `sales.${ext}`);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-gray-800">{t("sales")}</h2>
        <div className="flex gap-2">
          {isOwnerManager && (
            <button onClick={() => setShowFoodicsSync(!showFoodicsSync)}
              className="px-3 py-1.5 bg-orange-600 text-white rounded text-xs hover:bg-orange-700 flex items-center gap-1">
              🔄 {t("sync_foodics")}
            </button>
          )}
          {isOwnerManager && (
            <button onClick={() => { setShowReport(!showReport); if (!showReport) previewReport(); }}
              className="px-3 py-1.5 bg-green-700 text-white rounded text-xs hover:bg-green-800 flex items-center gap-1">
              📱 {t("send_daily_report")}
            </button>
          )}
          <button onClick={() => exportData("csv")}
            className="px-3 py-1.5 bg-green-600 text-white rounded text-xs hover:bg-green-700">
            {t("export_csv")}
          </button>
          <button onClick={() => exportData("excel")}
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">
            {t("export_excel")}
          </button>
          <button onClick={() => exportData("pdf")}
            className="px-3 py-1.5 bg-red-600 text-white rounded text-xs hover:bg-red-700">
            {t("export_pdf")}
          </button>
          <button onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm">
            {showForm ? t("cancel") : t("add_new")}
          </button>
        </div>
      </div>

      {/* Foodics Sync Panel */}
      {showFoodicsSync && isOwnerManager && (
        <div className="bg-white p-5 rounded-xl shadow-sm border mb-4">
          <h3 className="font-semibold text-sm mb-3">🔄 {t("sync_foodics")}</h3>
          <p className="text-xs text-gray-500 mb-3">{t("sync_foodics_desc")}</p>

          {syncMsg && (
            <div className={`p-2 rounded mb-3 text-sm ${
              syncMsgType === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}>{syncMsg}</div>
          )}

          <div className="flex gap-3 items-end mb-3 flex-wrap">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={syncRange} onChange={e => setSyncRange(e.target.checked)} />
              {t("date_range")}
            </label>
            <div>
              <label className="block text-xs font-medium mb-1">{syncRange ? t("start_date") : t("date")}</label>
              <input type="date" value={syncDate} onChange={e => setSyncDate(e.target.value)}
                className="px-3 py-1.5 border rounded-lg text-sm" />
            </div>
            {syncRange && (
              <div>
                <label className="block text-xs font-medium mb-1">{t("end_date")}</label>
                <input type="date" value={syncEndDate} onChange={e => setSyncEndDate(e.target.value)}
                  className="px-3 py-1.5 border rounded-lg text-sm" />
              </div>
            )}
            <button onClick={async () => {
              setSyncing(true);
              setSyncMsg("");
              try {
                let res;
                if (syncRange) {
                  const fd = new FormData();
                  fd.append("start_date", syncDate);
                  fd.append("end_date", syncEndDate);
                  res = await apiPost("/api/foodics/sync-range", fd);
                } else {
                  const fd = new FormData();
                  fd.append("sync_date", syncDate);
                  res = await apiPost("/api/foodics/sync", fd);
                }
                if (res.detail) throw new Error(res.detail);
                if (syncRange) {
                  const ok = res.results?.filter((r: Record<string, unknown>) => !r.error).length || 0;
                  setSyncMsg(`${t("sync_complete")}: ${ok} ${t("days_synced")}`);
                } else {
                  setSyncMsg(
                    `${t("sync_complete")}: ${res.orders_fetched} ${t("orders_fetched")}, ` +
                    `${res.branches_created} ${t("created")}, ${res.branches_updated} ${t("updated")}` +
                    (res.unmapped_branches?.length ? ` | ${res.unmapped_branches.length} ${t("unmapped_branches")}` : "") +
                    (res.unmapped_payments?.length ? ` | ${res.unmapped_payments.length} ${t("unmapped_payments")}` : "")
                  );
                }
                setSyncMsgType("success");
                loadSales(branchFilter);
              } catch (e: unknown) {
                setSyncMsg((e as Error).message || t("sync_error"));
                setSyncMsgType("error");
              }
              setSyncing(false);
            }} disabled={syncing}
              className="px-4 py-1.5 bg-orange-600 text-white rounded text-xs hover:bg-orange-700 disabled:opacity-50">
              {syncing ? t("syncing") : t("sync_now")}
            </button>
          </div>
        </div>
      )}

      {/* WhatsApp Daily Report Panel */}
      {showReport && isOwnerManager && (
        <div className="bg-white p-5 rounded-xl shadow-sm border mb-4">
          <h3 className="font-semibold text-sm mb-3">📱 {t("send_daily_report")}</h3>

          {reportMsg && (
            <div className={`p-2 rounded mb-3 text-sm ${
              reportMsgType === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}>{reportMsg}</div>
          )}

          <div className="flex gap-3 items-end mb-3 flex-wrap">
            <div>
              <label className="block text-xs font-medium mb-1">{t("date")}</label>
              <input type="date" value={reportDate}
                onChange={e => { setReportDate(e.target.value); setReportPreview(""); }}
                className="px-3 py-1.5 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">{t("phone_number")}</label>
              <input value={reportPhone} onChange={e => setReportPhone(e.target.value)}
                placeholder="51414302"
                className="px-3 py-1.5 border rounded-lg text-sm w-40" />
            </div>
            <button onClick={previewReport}
              className="px-3 py-1.5 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">
              {t("preview_report")}
            </button>
            <button onClick={sendWhatsAppReport} disabled={sending}
              className="px-3 py-1.5 bg-green-700 text-white rounded text-xs hover:bg-green-800 disabled:opacity-50">
              {sending ? t("sending") : t("send_whatsapp")}
            </button>
          </div>

          {reportPreview && (
            <pre className="bg-gray-50 p-3 rounded-lg text-xs whitespace-pre-wrap border max-h-64 overflow-y-auto font-mono">
              {reportPreview}
            </pre>
          )}
        </div>
      )}

      {!isStaff && (
        <div className="mb-4">
          <select value={branchFilter} onChange={e => handleFilter(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm">
            <option value="">{t("all_branches")}</option>
            {branches.map(b => <option key={b.id} value={b.id}>{i18n.language === "ar" ? (b.name_ar || b.name) : b.name}</option>)}
          </select>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-2 rounded mb-4 text-sm">{error}</div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {user?.branch_id ? (
              <input type="hidden" name="branch_id" value={user.branch_id} />
            ) : (
              <div>
                <label className="block text-sm font-medium mb-1">{t("branch")}</label>
                <select name="branch_id" required className="w-full px-3 py-2 border rounded-lg text-sm">
                  {branches.filter(b => !b.name.includes("Central")).map(b => (
                    <option key={b.id} value={b.id}>{i18n.language === "ar" ? (b.name_ar || b.name) : b.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">{t("date")}</label>
              <input type="date" name="sale_date" required className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>

          <h3 className="font-semibold text-emerald-700 text-sm">{t("pos_data")}</h3>
          <div className="flex gap-1.5 flex-wrap">
            {allChannels.map(ch => (
              <div key={`f_${ch}`} className="flex flex-col items-center" style={{ minWidth: 0, flex: "1 1 0" }}>
                <label className="text-[10px] text-gray-500 mb-0.5 truncate w-full text-center">{t(ch)}</label>
                <input type="number" step="0.001" name={`foodics_${ch}`} defaultValue="0"
                  className="w-full px-1 py-1 border rounded text-xs text-center" style={{ minWidth: "60px" }} />
              </div>
            ))}
          </div>

          <h3 className="font-semibold text-blue-700 text-sm">{t("physical_data")}</h3>
          <div className="flex gap-1.5 flex-wrap">
            {allChannels.map(ch => (
              <div key={`p_${ch}`} className="flex flex-col items-center" style={{ minWidth: 0, flex: "1 1 0" }}>
                <label className="text-[10px] text-gray-500 mb-0.5 truncate w-full text-center">{t(ch)}</label>
                <input type="number" step="0.001" name={`physical_${ch}`} defaultValue="0"
                  className="w-full px-1 py-1 border rounded text-xs text-center" style={{ minWidth: "60px" }} />
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
              <th colSpan={displayChannels.length + 1} className="px-2 py-1 text-center border-r bg-emerald-50 text-emerald-700">
                {t("pos_data")}
              </th>
              <th colSpan={displayChannels.length + 1} className="px-2 py-1 text-center border-r bg-blue-50 text-blue-700">
                {t("physical_data")}
              </th>
              <th rowSpan={2} className="px-2 py-2 text-right">{t("difference")}</th>
            </tr>
            <tr>
              {displayChannels.map(ch => (
                <th key={`fh_${ch}`} className="px-1.5 py-1 text-right bg-emerald-50 text-emerald-600 font-medium">{t(ch)}</th>
              ))}
              <th className="px-1.5 py-1 text-right bg-emerald-50 text-emerald-700 font-bold border-r">{t("total")}</th>
              {displayChannels.map(ch => (
                <th key={`ph_${ch}`} className="px-1.5 py-1 text-right bg-blue-50 text-blue-600 font-medium">{t(ch)}</th>
              ))}
              <th className="px-1.5 py-1 text-right bg-blue-50 text-blue-700 font-bold border-r">{t("total")}</th>
            </tr>
          </thead>
          <tbody>
            {sales.length === 0 ? (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
            ) : sales.map(s => {
              const foodics = sumRow(s, "foodics");
              const physical = sumRow(s, "physical");
              const diff = physical - foodics;
              return (
                <tr key={s.id} className="border-b hover:bg-gray-50">
                  <td className="px-2 py-2 sticky left-0 bg-white border-r font-medium">{s.date}</td>
                  <td className="px-2 py-2 border-r">{branchName(s.branch_id)}</td>
                  {displayChannels.map(ch => (
                    <td key={`f_${ch}`} className="px-1.5 py-2 text-right font-mono">
                      {((s as unknown as Record<string, number>)[`foodics_${ch}`] || 0).toFixed(3)}
                    </td>
                  ))}
                  <td className="px-1.5 py-2 text-right font-mono font-bold bg-emerald-50 border-r">
                    {foodics.toFixed(3)}
                  </td>
                  {displayChannels.map(ch => (
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
