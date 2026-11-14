import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost, apiFetch, apiDownload } from "../contexts/api";

interface Emp { id: number; name: string; name_ar: string; actual_salary: number; }
interface OtRecord {
  id: number; employee_id: number; date: string; month: string; hours: number; ot_type: string;
  rate_multiplier: number; hourly_rate: number; amount: number; notes: string; approval_status: string;
}
const OT_TYPES = ["weekday", "night", "rest_day", "holiday"] as const;
const MULT: Record<string, number> = { weekday: 1.25, night: 1.5, rest_day: 2, holiday: 2 };
const fmt = (n: number) => (n || 0).toFixed(3);

export default function OvertimeTab({ employees, brandId, canApprove, readOnly, onApproval }: {
  employees: Emp[]; brandId?: number | null; canApprove: boolean; readOnly: boolean;
  onApproval: (type: string, id: number, action: "approve" | "reject") => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [empFilter, setEmpFilter] = useState("");
  const [rows, setRows] = useState<OtRecord[]>([]);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<OtRecord | null>(null);
  const [formEmp, setFormEmp] = useState("");
  const [formHours, setFormHours] = useState("");
  const [formType, setFormType] = useState("weekday");

  const query = useCallback(() => {
    const p = new URLSearchParams();
    if (month) p.set("month", month);
    if (empFilter) p.set("employee_id", empFilter);
    if (brandId) p.set("brand_id", String(brandId));
    return p.toString();
  }, [month, empFilter, brandId]);
  const load = useCallback(() => apiGet(`/api/hr/overtime?${query()}`).then(setRows), [query]);
  useEffect(() => { load(); }, [load]);

  const name = (id: number) => { const e = employees.find(x => x.id === id); return e ? (i18n.language === "ar" ? (e.name_ar || e.name) : e.name) : "-"; };
  const emp = employees.find(e => String(e.id) === formEmp);
  const hourly = emp ? (emp.actual_salary || 0) / 30 / 8 : 0;
  const preview = hourly * (parseFloat(formHours) || 0) * (MULT[formType] || 1);

  const open = (r: OtRecord | null) => {
    setEditing(r); setShow(true);
    setFormEmp(r ? String(r.employee_id) : ""); setFormHours(r ? String(r.hours) : ""); setFormType(r?.ot_type || "weekday");
  };
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const res = editing ? await apiFetch(`/api/hr/overtime/${editing.id}`, { method: "PUT", body: fd }) : null;
    if (res && !res.ok) { const d = await res.json().catch(() => ({})); alert(d.detail || "Error"); return; }
    if (!editing) await apiPost("/api/hr/overtime", fd);
    setShow(false); setEditing(null); load();
  };
  const remove = async (id: number) => {
    if (!confirm(t("confirm_delete"))) return;
    const res = await apiFetch(`/api/hr/overtime/${id}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.detail || "Error"); }
    load();
  };
  const exp = (f: string) => apiDownload(`/api/hr/overtime/export/${f}?${query()}&lang=${i18n.language}`, `overtime_${month}.${f === "excel" ? "xlsx" : f}`);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const approved = rows.filter(r => r.approval_status === "approved").reduce((s, r) => s + r.amount, 0);
  const badge = (s: string) => s === "approved" ? "bg-green-100 text-green-700" : s === "rejected" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700";

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">{t("overtime_law_note")}</p>
      <div className="flex gap-3 mb-4 flex-wrap items-end">
        <div><label className="block text-xs text-gray-500 mb-1">{t("salary_month")}</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">{t("employee")}</label>
          <select value={empFilter} onChange={e => setEmpFilter(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
            <option value="">{t("all")}</option>
            {employees.map(e => <option key={e.id} value={e.id}>{name(e.id)}</option>)}
          </select></div>
        {!readOnly && <button onClick={() => (show ? setShow(false) : open(null))} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm">{show ? t("cancel") : t("add_overtime")}</button>}
        <button onClick={() => exp("excel")} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs">{t("export_excel")}</button>
        <button onClick={() => exp("pdf")} className="px-3 py-1.5 bg-red-600 text-white rounded text-xs">{t("export_pdf")}</button>
      </div>
      {show && (
        <form key={editing?.id ?? "new"} onSubmit={submit} className="bg-white p-6 rounded-xl shadow-sm border mb-6 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium mb-1">{t("employee")}</label>
              <select name="employee_id" required value={formEmp} onChange={e => setFormEmp(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="">{t("select_employee")}</option>
                {employees.map(e => <option key={e.id} value={e.id}>{name(e.id)}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium mb-1">{t("date")}</label>
              <input type="date" name="ot_date" required defaultValue={editing?.date ?? ""} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            <div><label className="block text-sm font-medium mb-1">{t("salary_month")}</label>
              <input type="month" name="month" defaultValue={editing?.month ?? month} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            <div><label className="block text-sm font-medium mb-1">{t("overtime_hours")}</label>
              <input type="number" name="hours" step="0.25" min="0.25" required value={formHours} onChange={e => setFormHours(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            <div><label className="block text-sm font-medium mb-1">{t("overtime_type")}</label>
              <select name="ot_type" value={formType} onChange={e => setFormType(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                {OT_TYPES.map(k => <option key={k} value={k}>{t(`ot_${k}`)}</option>)}
              </select></div>
            <div><label className="block text-sm font-medium mb-1">{t("notes")}</label>
              <input type="text" name="notes" defaultValue={editing?.notes ?? ""} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
          </div>
          {emp && <p className="text-sm text-gray-600">{t("monthly_salary")}: KD {fmt(emp.actual_salary)} · {t("hourly_rate")}: KD {fmt(hourly)} · {t("amount")}: <b>KD {fmt(preview)}</b></p>}
          <button type="submit" className="px-6 py-2 bg-emerald-600 text-white rounded-lg text-sm">{editing ? t("update") : t("save")}</button>
        </form>
      )}
      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr>
            <th className="px-4 py-3 text-start">{t("date")}</th><th className="px-4 py-3 text-start">{t("employee")}</th>
            <th className="px-4 py-3 text-start">{t("overtime_type")}</th><th className="px-4 py-3 text-end">{t("overtime_hours")}</th>
            <th className="px-4 py-3 text-end">{t("hourly_rate")}</th><th className="px-4 py-3 text-end">x</th>
            <th className="px-4 py-3 text-end">{t("amount")}</th><th className="px-4 py-3 text-start">{t("status")}</th>
            <th className="px-4 py-3 text-start">{t("notes")}</th><th className="px-4 py-3 text-start">{t("actions")}</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr> : rows.map(r => (
              <tr key={r.id} className="border-b hover:bg-gray-50">
                <td className="px-4 py-3">{r.date}</td><td className="px-4 py-3">{name(r.employee_id)}</td>
                <td className="px-4 py-3">{t(`ot_${r.ot_type}`)}</td><td className="px-4 py-3 text-end">{r.hours}</td>
                <td className="px-4 py-3 text-end">{fmt(r.hourly_rate)}</td><td className="px-4 py-3 text-end">{r.rate_multiplier}</td>
                <td className="px-4 py-3 text-end font-medium">{fmt(r.amount)}</td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${badge(r.approval_status)}`}>{t(r.approval_status)}</span></td>
                <td className="px-4 py-3 text-gray-500">{r.notes || "-"}</td>
                <td className="px-4 py-3"><div className="flex gap-2 flex-wrap">
                  {canApprove && !readOnly && r.approval_status === "pending_approval" && (<>
                    <button onClick={() => onApproval("overtime", r.id, "approve").then(load)} className="text-green-600 hover:underline text-xs">{t("approve")}</button>
                    <button onClick={() => onApproval("overtime", r.id, "reject").then(load)} className="text-red-600 hover:underline text-xs">{t("reject")}</button>
                  </>)}
                  {!readOnly && <button onClick={() => open(r)} className="text-blue-600 hover:underline text-xs">{t("edit")}</button>}
                  {!readOnly && <button onClick={() => remove(r.id)} className="text-red-600 hover:underline text-xs">{t("delete")}</button>}
                </div></td>
              </tr>))}
          </tbody>
          {rows.length > 0 && <tfoot className="bg-gray-50 border-t font-semibold"><tr>
            <td className="px-4 py-3" colSpan={6}>{t("total")} ({t("approved")}: {fmt(approved)})</td>
            <td className="px-4 py-3 text-end">{fmt(total)}</td><td colSpan={3} /></tr></tfoot>}
        </table>
      </div>
    </div>
  );
}
