import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Printer, FileSpreadsheet, FileText, Paperclip, Pencil, Trash2 } from "lucide-react";
import { apiGet, apiPost, apiPut, apiDelete, apiFetch, apiDownload } from "../contexts/api";
import { useAuth } from "../contexts/AuthContext";
import { useBrand } from "../contexts/BrandContext";

type Tab = "overview" | "requests" | "approvals" | "staff" | "company" | "prices";

interface RType { id: number; group: string; name: string; name_ar: string; default_fee: number; validity_months: number; reminder_days: number; is_active: boolean; }
interface Branch { id: number; name: string; name_ar: string; }
interface Emp { id: number; name: string; name_ar: string; civil_id: string; branch_id: number; position: string; }
interface License { id: number; brand_id: number; branch_id: number | null; branch_name: string; type_id: number | null; type_name: string; name: string; license_no: string; authority: string; issue_date: string; expiry_date: string; days_remaining: number | null; status: string; notes: string; file1: string | null; file2: string | null; file3: string | null; }
interface Doc { id: number; employee_id: number; employee_name: string; employee_name_ar: string; civil_id: string; branch_id: number | null; branch_name: string; type_id: number; type_name: string; doc_no: string; authority: string; issue_date: string; expiry_date: string; days_remaining: number | null; status: string; notes: string; file1: string | null; file2: string | null; file3: string | null; }
interface BoardRow { kind: string; ref_id: number; employee_id: number | null; license_id: number | null; name: string; id_no: string; branch_id: number | null; branch_name: string; type_id: number | null; type_name: string; doc_no: string; expiry_date: string; days_remaining: number | null; status: string; }
interface Summary { expired: number; due_30: number; due_90: number; pending_approval: number; approved_unpaid: number; petty_cash_branch_id: number | null; petty_cash_branch_name: string; petty_cash_balance: number; }
interface Line { id?: number; type_id: number | ""; type_name?: string; type_name_ar?: string; description: string; current_expiry: string; new_expiry: string; new_doc_no: string; fee: number; extra_charges: number; extra_desc: string; line_total?: number; actual_amount?: number | null; }
interface LastTxn { request_no: string; paid_date: string; paid_amount: number; lines: Line[]; paid_by_name: string; }
interface Req {
  id: number; request_no: string; brand_id: number; group: string; employee_id: number | null; license_id: number | null;
  subject_name: string; subject_name_ar: string; subject_id_no: string; subject_position: string; branch_id: number | null; branch_name: string;
  urgency: string; notes: string; status: string; status_label: string; total: number;
  requested_by_name: string; requested_at: string; submitted_at: string; approved_by_name: string; approved_at: string;
  approved_amount: number | null; approval_comment: string; paid_date: string; paid_amount: number | null; receipt_no: string; paid_by_name: string;
  file1: string | null; file2: string | null; file3: string | null; line_count: number;
  lines?: Line[]; logs?: { status: string; label: string; comment: string; user_name: string; at: string }[]; last_transaction?: LastTxn | null;
}

const STATUS_CLS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700", pending: "bg-amber-100 text-amber-800", approved: "bg-blue-100 text-blue-800",
  paid: "bg-green-100 text-green-800", closed: "bg-green-200 text-green-900", returned: "bg-orange-100 text-orange-800",
  rejected: "bg-red-100 text-red-800", cancelled: "bg-gray-200 text-gray-600",
};
const inp = "border rounded px-2 py-1.5 text-sm w-full";
const btn = "px-3 py-1.5 rounded text-sm font-medium";
const kd = (v: number | null | undefined) => (v || 0).toFixed(3);
const emptyLine = (): Line => ({ type_id: "", description: "", current_expiry: "", new_expiry: "", new_doc_no: "", fee: 0, extra_charges: 0, extra_desc: "" });

function DaysBadge({ d }: { d: number | null }) {
  const { t } = useTranslation();
  if (d === null || d === undefined) return <span className="text-gray-400">—</span>;
  const cls = d < 0 ? "bg-red-100 text-red-800" : d <= 30 ? "bg-amber-100 text-amber-800" : d <= 90 ? "bg-yellow-100 text-yellow-800" : "bg-green-100 text-green-800";
  return <span className={`px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>{d < 0 ? `${-d} ${t("rn_days_overdue")}` : d}</span>;
}

function Files({ f1, f2, f3 }: { f1: string | null; f2: string | null; f3: string | null }) {
  const files = [f1, f2, f3].filter(Boolean) as string[];
  if (!files.length) return <span className="text-gray-400">—</span>;
  return <span className="flex gap-1">{files.map((f, i) => <a key={f} href={`/uploads/${f}`} target="_blank" rel="noreferrer" className="text-blue-600 inline-flex items-center gap-0.5 text-xs"><Paperclip size={12} />{i + 1}</a>)}</span>;
}

export default function RenewalsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { selectedBrand, brands } = useBrand();
  const ar = i18n.language === "ar";
  const isApprover = ["owner", "manager"].includes(user?.role || "");
  const canPay = user?.role === "personnel" || isApprover || user?.role === "accountant";

  const [brandId, setBrandId] = useState<number | null>(selectedBrand?.id ?? (brands[0]?.id ?? null));
  useEffect(() => { if (selectedBrand) setBrandId(selectedBrand.id); }, [selectedBrand]);

  const [tab, setTab] = useState<Tab>("overview");
  const [types, setTypes] = useState<RType[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<Emp[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [requests, setRequests] = useState<Req[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [kindFilter, setKindFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [msg, setMsg] = useState("");

  const bq = brandId ? `brand_id=${brandId}` : "";
  const bname = (b: { name: string; name_ar: string } | undefined) => (b ? (ar ? b.name_ar || b.name : b.name) : "—");
  const tname = (ty: RType | undefined) => (ty ? (ar ? ty.name_ar || ty.name : ty.name) : "—");
  const typeById = useMemo(() => Object.fromEntries(types.map(x => [x.id, x])), [types]);

  const load = useCallback(async () => {
    if (!brandId) return;
    const [ty, br, em, su, bo, rq, li, dc] = await Promise.all([
      apiGet(`/api/renewals/types?include_inactive=true&${bq}`),
      apiGet(`/api/branches/?scope=operating&${bq}`),
      apiGet(`/api/hr/employees?${bq}`),
      apiGet(`/api/renewals/summary?${bq}`),
      apiGet(`/api/renewals/expiry?${bq}`),
      apiGet(`/api/renewals/requests?${bq}`),
      apiGet(`/api/renewals/licenses?${bq}`),
      apiGet(`/api/renewals/documents?${bq}`),
    ]);
    setTypes(Array.isArray(ty) ? ty : []); setBranches(Array.isArray(br) ? br : []); setEmployees(Array.isArray(em) ? em : []);
    setSummary(su); setBoard(Array.isArray(bo) ? bo : []); setRequests(Array.isArray(rq) ? rq : []);
    setLicenses(Array.isArray(li) ? li : []); setDocs(Array.isArray(dc) ? dc : []);
  }, [brandId, bq]);
  useEffect(() => { load(); }, [load]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  // ---------------- request form
  const [showReq, setShowReq] = useState(false);
  const [editReq, setEditReq] = useState<Req | null>(null);
  const [rf, setRf] = useState<{ group: string; employee_id: string; license_id: string; urgency: string; notes: string; lines: Line[] }>(
    { group: "staff", employee_id: "", license_id: "", urgency: "normal", notes: "", lines: [emptyLine()] });
  const [lastTxn, setLastTxn] = useState<{ last: LastTxn | null; open_requests: { id: number; request_no: string; status: string }[] } | null>(null);
  const [reqFiles, setReqFiles] = useState<(File | null)[]>([null, null, null]);

  const openNew = (preset?: Partial<typeof rf>) => {
    setEditReq(null);
    setRf({ group: "staff", employee_id: "", license_id: "", urgency: "normal", notes: "", lines: [emptyLine()], ...preset });
    setLastTxn(null); setReqFiles([null, null, null]); setShowReq(true);
  };
  const openEdit = async (r: Req) => {
    const d: Req = await apiGet(`/api/renewals/requests/${r.id}`);
    setEditReq(d);
    setRf({ group: d.group, employee_id: d.employee_id ? String(d.employee_id) : "", license_id: d.license_id ? String(d.license_id) : "",
      urgency: d.urgency, notes: d.notes, lines: (d.lines || []).map(l => ({ ...l })) });
    setReqFiles([null, null, null]); setShowReq(true);
  };
  useEffect(() => {
    if (!showReq) return;
    const id = rf.group === "staff" ? rf.employee_id : rf.license_id;
    if (!id) { setLastTxn(null); return; }
    const p = rf.group === "staff" ? `employee_id=${id}` : `license_id=${id}`;
    apiGet(`/api/renewals/last-transaction?group=${rf.group}&${p}&${bq}`).then(setLastTxn);
  }, [showReq, rf.group, rf.employee_id, rf.license_id, bq]);

  const setLine = (i: number, patch: Partial<Line>) => setRf(f => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const onLineType = (i: number, tid: string) => {
    const ty = typeById[Number(tid)];
    let current_expiry = "";
    if (ty && rf.group === "staff" && rf.employee_id) {
      const d = docs.find(x => x.employee_id === Number(rf.employee_id) && x.type_id === ty.id);
      current_expiry = d?.expiry_date || "";
    } else if (ty && rf.group === "company" && rf.license_id) {
      current_expiry = licenses.find(x => x.id === Number(rf.license_id))?.expiry_date || "";
    }
    setLine(i, { type_id: tid ? Number(tid) : "", fee: ty?.default_fee || 0, current_expiry });
  };
  const reqTotal = rf.lines.reduce((s, l) => s + (Number(l.fee) || 0) + (Number(l.extra_charges) || 0), 0);

  const saveReq = async (submit: boolean) => {
    if (!brandId) return;
    const body = {
      brand_id: brandId, group: rf.group,
      employee_id: rf.group === "staff" && rf.employee_id ? Number(rf.employee_id) : null,
      license_id: rf.group === "company" && rf.license_id ? Number(rf.license_id) : null,
      urgency: rf.urgency, notes: rf.notes, submit,
      lines: rf.lines.filter(l => l.type_id).map(l => ({
        type_id: Number(l.type_id), description: l.description || null, current_expiry: l.current_expiry || null,
        new_expiry: l.new_expiry || null, new_doc_no: l.new_doc_no || null, fee: Number(l.fee) || 0,
        extra_charges: Number(l.extra_charges) || 0, extra_desc: l.extra_desc || null })),
    };
    if (!body.lines.length || (!body.employee_id && !body.license_id)) { alert(rf.group === "staff" ? t("rn_select_employee") : t("rn_select_license")); return; }
    const res = await apiFetch(editReq ? `/api/renewals/requests/${editReq.id}` : "/api/renewals/requests",
      { method: editReq ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { alert(data.detail || "Error"); return; }
    if (reqFiles.some(Boolean)) {
      const fd = new FormData();
      reqFiles.forEach((f, i) => { if (f) fd.append(`file${i + 1}`, f); });
      await apiPost(`/api/renewals/requests/${data.id}/files`, fd);
    }
    setShowReq(false); flash(t("rn_request_saved")); load();
  };

  // ---------------- request detail / actions
  const [detail, setDetail] = useState<Req | null>(null);
  const openDetail = async (id: number) => setDetail(await apiGet(`/api/renewals/requests/${id}`));
  const action = async (id: number, act: string, form?: FormData) => {
    const res = await apiFetch(`/api/renewals/requests/${id}/${act}`, { method: "POST", body: form || new FormData() });
    const data = await res.json();
    if (!res.ok) { alert(data.detail || "Error"); return false; }
    await load(); if (detail?.id === id) openDetail(id); return true;
  };
  const promptAction = async (id: number, act: "return" | "reject" | "cancel", required: boolean) => {
    const c = prompt(t("rn_comment")) ?? "";
    if (required && !c) return;
    const fd = new FormData(); fd.append("comment", c); action(id, act, fd);
  };
  const [approveReq, setApproveReq] = useState<Req | null>(null);
  const [apv, setApv] = useState({ amount: "", comment: "" });
  const doApprove = async () => {
    if (!approveReq) return;
    const fd = new FormData(); if (apv.amount) fd.append("approved_amount", apv.amount); fd.append("comment", apv.comment);
    if (await action(approveReq.id, "approve", fd)) setApproveReq(null);
  };
  const [payReq, setPayReq] = useState<Req | null>(null);
  const [pay, setPay] = useState<{ paid_date: string; receipt_no: string; notes: string; actuals: Record<number, string>; files: (File | null)[] }>(
    { paid_date: "", receipt_no: "", notes: "", actuals: {}, files: [null, null, null] });
  const openPay = async (r: Req) => {
    const d: Req = await apiGet(`/api/renewals/requests/${r.id}`);
    const actuals: Record<number, string> = {};
    (d.lines || []).forEach(l => { if (l.id) actuals[l.id] = String(l.line_total ?? 0); });
    setPay({ paid_date: new Date().toISOString().slice(0, 10), receipt_no: "", notes: "", actuals, files: [null, null, null] });
    setPayReq(d);
  };
  const doPay = async () => {
    if (!payReq) return;
    const fd = new FormData();
    fd.append("paid_date", pay.paid_date); fd.append("receipt_no", pay.receipt_no); fd.append("notes", pay.notes);
    fd.append("actuals", JSON.stringify(Object.fromEntries(Object.entries(pay.actuals).map(([k, v]) => [k, Number(v) || 0]))));
    pay.files.forEach((f, i) => { if (f) fd.append(`file${i + 1}`, f); });
    if (await action(payReq.id, "pay", fd)) setPayReq(null);
  };
  const payTotal = payReq ? Object.values(pay.actuals).reduce((s, v) => s + (Number(v) || 0), 0) : 0;

  // ---------------- price list
  const [typeForm, setTypeForm] = useState<Partial<RType> | null>(null);
  const saveType = async () => {
    if (!typeForm?.name) return;
    const fd = new FormData();
    fd.append("group", typeForm.group || "staff"); fd.append("name", typeForm.name); fd.append("name_ar", typeForm.name_ar || "");
    fd.append("default_fee", String(typeForm.default_fee ?? 0)); fd.append("validity_months", String(typeForm.validity_months ?? 12));
    fd.append("reminder_days", String(typeForm.reminder_days ?? 60)); fd.append("is_active", String(typeForm.is_active ?? true));
    const r = typeForm.id ? await apiPut(`/api/renewals/types/${typeForm.id}`, fd) : await apiPost("/api/renewals/types", fd);
    if (r.detail) { alert(r.detail); return; }
    setTypeForm(null); load();
  };

  // ---------------- licenses / documents
  const [licForm, setLicForm] = useState<Partial<License> | null>(null);
  const [licFiles, setLicFiles] = useState<(File | null)[]>([null, null, null]);
  const saveLic = async () => {
    if (!licForm?.name || !licForm.license_no || !brandId) return;
    const fd = new FormData();
    fd.append("brand_id", String(brandId));
    if (licForm.branch_id) fd.append("branch_id", String(licForm.branch_id));
    if (licForm.type_id) fd.append("type_id", String(licForm.type_id));
    fd.append("name", licForm.name); fd.append("license_no", licForm.license_no); fd.append("authority", licForm.authority || "");
    fd.append("issue_date", licForm.issue_date || ""); fd.append("expiry_date", licForm.expiry_date || ""); fd.append("notes", licForm.notes || "");
    if (licForm.id) fd.append("status", licForm.status || "active");
    licFiles.forEach((f, i) => { if (f) fd.append(`file${i + 1}`, f); });
    const r = licForm.id ? await apiPut(`/api/renewals/licenses/${licForm.id}`, fd) : await apiPost("/api/renewals/licenses", fd);
    if (r.detail) { alert(r.detail); return; }
    setLicForm(null); load();
  };
  const [docForm, setDocForm] = useState<Partial<Doc> | null>(null);
  const [docFiles, setDocFiles] = useState<(File | null)[]>([null, null, null]);
  const saveDoc = async () => {
    if (!docForm?.employee_id || !docForm.type_id) return;
    const fd = new FormData();
    fd.append("employee_id", String(docForm.employee_id)); fd.append("type_id", String(docForm.type_id));
    fd.append("doc_no", docForm.doc_no || ""); fd.append("authority", docForm.authority || "");
    fd.append("issue_date", docForm.issue_date || ""); fd.append("expiry_date", docForm.expiry_date || ""); fd.append("notes", docForm.notes || "");
    if (docForm.id) fd.append("status", docForm.status || "active");
    docFiles.forEach((f, i) => { if (f) fd.append(`file${i + 1}`, f); });
    const r = docForm.id ? await apiPut(`/api/renewals/documents/${docForm.id}`, fd) : await apiPost("/api/renewals/documents", fd);
    if (r.detail) { alert(r.detail); return; }
    setDocForm(null); load();
  };
  const del = async (path: string) => { if (!confirm(t("rn_confirm_delete"))) return; const r = await apiDelete(path); if (r.detail && r.detail !== "ok" && !r.ok) { if (typeof r.detail === "string" && r.detail.toLowerCase().includes("not")) alert(r.detail); } load(); };

  const staffTypes = types.filter(x => x.group === "staff" && x.is_active);
  const companyTypes = types.filter(x => x.group === "company" && x.is_active);
  const lineTypes = rf.group === "staff" ? staffTypes : companyTypes;
  const statusBadge = (r: Req) => <span className={`px-2 py-0.5 rounded text-xs font-semibold ${STATUS_CLS[r.status] || ""}`}>{r.status_label}</span>;
  const FileInputs = ({ files, set }: { files: (File | null)[]; set: (f: (File | null)[]) => void }) => (
    <div>
      <label className="text-xs text-gray-600">{t("rn_attachments")}</label>
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map(i => <input key={i} type="file" className="text-xs" onChange={e => { const n = [...files]; n[i] = e.target.files?.[0] || null; set(n); }} />)}
      </div>
    </div>
  );
  const exp = (kind: string, fmt: string, extra = "") =>
    apiDownload(`/api/renewals/export/${kind}/${fmt}?${bq}${extra}`, `${kind}.${fmt === "excel" ? "xlsx" : fmt}`);
  const printForm = (id: number, no: string) => apiDownload(`/api/renewals/requests/${id}/form.pdf?${bq}`, `${no}.pdf`);

  const tabs: { k: Tab; label: string; badge?: number }[] = [
    { k: "overview", label: t("rn_overview") }, { k: "requests", label: t("rn_requests") },
    ...(isApprover ? [{ k: "approvals" as Tab, label: t("rn_approvals"), badge: summary?.pending_approval }] : []),
    { k: "staff", label: t("rn_staff_docs") }, { k: "company", label: t("rn_company_licenses") }, { k: "prices", label: t("rn_price_list") },
  ];
  const filteredBoard = board.filter(x => !kindFilter || x.kind === kindFilter);
  const filteredReqs = requests.filter(r => (!statusFilter || r.status === statusFilter) && (!kindFilter || r.group === kindFilter));

  const reqTable = (rows: Req[], approvals = false) => (
    <div className="overflow-x-auto bg-white rounded shadow">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-gray-600"><tr>
          {[t("rn_request_no"), t("date"), t("rn_group"), t("rn_name"), t("rn_civil_id") + " / " + t("rn_license_no"), t("branch"), t("rn_lines"), t("rn_total"), t("rn_status"), t("rn_requested_by"), ""].map((h, i) => <th key={i} className="px-3 py-2 text-start">{h}</th>)}
        </tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={11} className="px-3 py-6 text-center text-gray-400">{t("rn_no_data")}</td></tr>}
          {rows.map(r => (
            <tr key={r.id} className="border-t hover:bg-gray-50">
              <td className="px-3 py-2 font-mono text-xs">{r.request_no}</td>
              <td className="px-3 py-2">{r.requested_at.slice(0, 10)}</td>
              <td className="px-3 py-2">{r.group === "staff" ? t("rn_staff") : t("rn_company")}</td>
              <td className="px-3 py-2">{ar && r.subject_name_ar ? r.subject_name_ar : r.subject_name}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.subject_id_no}</td>
              <td className="px-3 py-2">{r.branch_name}</td>
              <td className="px-3 py-2 text-center">{r.line_count}</td>
              <td className="px-3 py-2 font-semibold">{kd(r.total)}</td>
              <td className="px-3 py-2">{statusBadge(r)}</td>
              <td className="px-3 py-2 text-xs">{r.requested_by_name}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <div className="flex gap-1">
                  <button onClick={() => openDetail(r.id)} className={`${btn} bg-gray-100`}>{t("rn_view")}</button>
                  {approvals && <button onClick={() => { setApv({ amount: String(r.total), comment: "" }); setApproveReq(r); }} className={`${btn} bg-green-600 text-white`}>{t("rn_approve")}</button>}
                  {approvals && <button onClick={() => promptAction(r.id, "return", true)} className={`${btn} bg-orange-500 text-white`}>{t("rn_return")}</button>}
                  {approvals && <button onClick={() => promptAction(r.id, "reject", true)} className={`${btn} bg-red-600 text-white`}>{t("rn_reject")}</button>}
                  {!approvals && r.status === "approved" && canPay && <button onClick={() => openPay(r)} className={`${btn} bg-blue-600 text-white`}>{t("rn_pay")}</button>}
                  {!approvals && ["draft", "returned"].includes(r.status) && <button onClick={() => openEdit(r)} className={`${btn} bg-gray-100`}><Pencil size={14} /></button>}
                  <button onClick={() => printForm(r.id, r.request_no)} className={`${btn} bg-gray-100`} title={t("rn_print_form")}><Printer size={14} /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t("renewals")}</h1>
        <div className="flex items-center gap-2">
          {brands.length > 1 && !selectedBrand && (
            <select className={inp} value={brandId ?? ""} onChange={e => setBrandId(Number(e.target.value))}>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name_en}</option>)}
            </select>
          )}
          {summary && <div className="text-sm bg-emerald-50 border border-emerald-200 rounded px-3 py-1.5">
            <span className="text-gray-600">{t("rn_petty_cash")}:</span> <b>KD {kd(summary.petty_cash_balance)}</b>
            <span className="text-xs text-gray-500 ms-2">{summary.petty_cash_branch_name}</span>
          </div>}
          <button onClick={() => openNew()} className={`${btn} bg-emerald-600 text-white inline-flex items-center gap-1`}><Plus size={16} />{t("rn_new_request")}</button>
        </div>
      </div>
      {msg && <div className="bg-green-50 text-green-800 px-3 py-2 rounded text-sm">{msg}</div>}

      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map(x => (
          <button key={x.k} onClick={() => setTab(x.k)} className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 ${tab === x.k ? "border-emerald-600 text-emerald-700 font-semibold" : "border-transparent text-gray-600"}`}>
            {x.label}{x.badge ? <span className="ms-1 bg-amber-500 text-white rounded-full px-1.5 text-xs">{x.badge}</span> : null}
          </button>
        ))}
      </div>

      {tab === "overview" && summary && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              [t("rn_expired"), summary.expired, "bg-red-50 text-red-800"], [t("rn_due_30"), summary.due_30, "bg-amber-50 text-amber-800"],
              [t("rn_due_90"), summary.due_90, "bg-yellow-50 text-yellow-800"], [t("rn_pending_approval"), summary.pending_approval, "bg-blue-50 text-blue-800"],
              [t("rn_approved_unpaid"), summary.approved_unpaid, "bg-indigo-50 text-indigo-800"],
            ].map(([l, v, c]) => <div key={String(l)} className={`rounded p-3 ${c}`}><div className="text-xs">{l}</div><div className="text-2xl font-bold">{v}</div></div>)}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <select className="border rounded px-2 py-1.5 text-sm" value={kindFilter} onChange={e => setKindFilter(e.target.value)}>
              <option value="">{t("rn_all")}</option><option value="staff">{t("rn_staff")}</option><option value="company">{t("rn_company")}</option>
            </select>
            <div className="flex-1" />
            <button onClick={() => exp("documents", "excel", kindFilter ? `&kind=${kindFilter}` : "")} className={`${btn} bg-green-700 text-white inline-flex gap-1 items-center`}><FileSpreadsheet size={14} />Excel</button>
            <button onClick={() => exp("documents", "pdf", kindFilter ? `&kind=${kindFilter}` : "")} className={`${btn} bg-red-700 text-white inline-flex gap-1 items-center`}><FileText size={14} />PDF</button>
          </div>
          <div className="overflow-x-auto bg-white rounded shadow">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600"><tr>
                {[t("rn_group"), t("rn_name"), t("rn_civil_id") + " / " + t("rn_license_no"), t("branch"), t("rn_type"), t("rn_doc_no"), t("rn_expiry_date"), t("rn_days_remaining"), ""].map((h, i) => <th key={i} className="px-3 py-2 text-start">{h}</th>)}
              </tr></thead>
              <tbody>
                {filteredBoard.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">{t("rn_no_data")}</td></tr>}
                {filteredBoard.map(x => (
                  <tr key={`${x.kind}-${x.ref_id}`} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2">{x.kind === "staff" ? t("rn_staff") : t("rn_company")}</td>
                    <td className="px-3 py-2">{x.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{x.id_no}</td>
                    <td className="px-3 py-2">{x.branch_name}</td>
                    <td className="px-3 py-2">{tname(typeById[x.type_id || 0]) === "—" ? x.type_name : tname(typeById[x.type_id || 0])}</td>
                    <td className="px-3 py-2 font-mono text-xs">{x.doc_no}</td>
                    <td className="px-3 py-2">{x.expiry_date || "—"}</td>
                    <td className="px-3 py-2"><DaysBadge d={x.days_remaining} /></td>
                    <td className="px-3 py-2">
                      <button className={`${btn} bg-emerald-50 text-emerald-700`} onClick={() => openNew({
                        group: x.kind, employee_id: x.employee_id ? String(x.employee_id) : "", license_id: x.license_id ? String(x.license_id) : "",
                        lines: [{ ...emptyLine(), type_id: x.type_id || "", fee: typeById[x.type_id || 0]?.default_fee || 0, current_expiry: x.expiry_date }],
                      })}>{t("rn_new_request")}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "requests" && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <select className="border rounded px-2 py-1.5 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">{t("rn_all")} - {t("rn_status")}</option>
              {["draft", "pending", "approved", "paid", "closed", "returned", "rejected", "cancelled"].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="border rounded px-2 py-1.5 text-sm" value={kindFilter} onChange={e => setKindFilter(e.target.value)}>
              <option value="">{t("rn_all")}</option><option value="staff">{t("rn_staff")}</option><option value="company">{t("rn_company")}</option>
            </select>
            <div className="flex-1" />
            <button onClick={() => exp("requests", "excel", `${statusFilter ? `&status=${statusFilter}` : ""}${kindFilter ? `&group=${kindFilter}` : ""}`)} className={`${btn} bg-green-700 text-white inline-flex gap-1 items-center`}><FileSpreadsheet size={14} />Excel</button>
            <button onClick={() => exp("requests", "pdf", `${statusFilter ? `&status=${statusFilter}` : ""}${kindFilter ? `&group=${kindFilter}` : ""}`)} className={`${btn} bg-red-700 text-white inline-flex gap-1 items-center`}><FileText size={14} />PDF</button>
          </div>
          {reqTable(filteredReqs)}
        </>
      )}

      {tab === "approvals" && isApprover && reqTable(requests.filter(r => r.status === "pending"), true)}

      {tab === "staff" && (
        <>
          <div className="flex justify-end gap-2">
            <button onClick={() => exp("documents", "excel", "&kind=staff")} className={`${btn} bg-green-700 text-white inline-flex gap-1 items-center`}><FileSpreadsheet size={14} />Excel</button>
            <button onClick={() => exp("documents", "pdf", "&kind=staff")} className={`${btn} bg-red-700 text-white inline-flex gap-1 items-center`}><FileText size={14} />PDF</button>
            <button onClick={() => { setDocForm({ status: "active" }); setDocFiles([null, null, null]); }} className={`${btn} bg-emerald-600 text-white inline-flex gap-1 items-center`}><Plus size={14} />{t("rn_add_document")}</button>
          </div>
          <div className="overflow-x-auto bg-white rounded shadow">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600"><tr>
                {[t("rn_employee"), t("rn_civil_id"), t("branch"), t("rn_type"), t("rn_doc_no"), t("rn_issue_date"), t("rn_expiry_date"), t("rn_days_remaining"), t("rn_attachments"), ""].map((h, i) => <th key={i} className="px-3 py-2 text-start">{h}</th>)}
              </tr></thead>
              <tbody>
                {docs.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-400">{t("rn_no_data")}</td></tr>}
                {docs.map(d => (
                  <tr key={d.id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2">{ar && d.employee_name_ar ? d.employee_name_ar : d.employee_name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{d.civil_id}</td>
                    <td className="px-3 py-2">{d.branch_name}</td>
                    <td className="px-3 py-2">{tname(typeById[d.type_id])}</td>
                    <td className="px-3 py-2 font-mono text-xs">{d.doc_no}</td>
                    <td className="px-3 py-2">{d.issue_date || "—"}</td>
                    <td className="px-3 py-2">{d.expiry_date || "—"}</td>
                    <td className="px-3 py-2"><DaysBadge d={d.days_remaining} /></td>
                    <td className="px-3 py-2"><Files f1={d.file1} f2={d.file2} f3={d.file3} /></td>
                    <td className="px-3 py-2"><div className="flex gap-1">
                      <button onClick={() => { setDocForm(d); setDocFiles([null, null, null]); }} className={`${btn} bg-gray-100`}><Pencil size={14} /></button>
                      {isApprover && <button onClick={() => del(`/api/renewals/documents/${d.id}`)} className={`${btn} bg-red-50 text-red-700`}><Trash2 size={14} /></button>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "company" && (
        <>
          <div className="flex justify-end gap-2">
            <button onClick={() => exp("documents", "excel", "&kind=company")} className={`${btn} bg-green-700 text-white inline-flex gap-1 items-center`}><FileSpreadsheet size={14} />Excel</button>
            <button onClick={() => exp("documents", "pdf", "&kind=company")} className={`${btn} bg-red-700 text-white inline-flex gap-1 items-center`}><FileText size={14} />PDF</button>
            <button onClick={() => { setLicForm({ status: "active" }); setLicFiles([null, null, null]); }} className={`${btn} bg-emerald-600 text-white inline-flex gap-1 items-center`}><Plus size={14} />{t("rn_add_license")}</button>
          </div>
          <div className="overflow-x-auto bg-white rounded shadow">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600"><tr>
                {[t("rn_name"), t("rn_license_no"), t("branch"), t("rn_type"), t("rn_authority"), t("rn_issue_date"), t("rn_expiry_date"), t("rn_days_remaining"), t("rn_status"), t("rn_attachments"), ""].map((h, i) => <th key={i} className="px-3 py-2 text-start">{h}</th>)}
              </tr></thead>
              <tbody>
                {licenses.length === 0 && <tr><td colSpan={11} className="px-3 py-6 text-center text-gray-400">{t("rn_no_data")}</td></tr>}
                {licenses.map(l => (
                  <tr key={l.id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2">{l.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{l.license_no}</td>
                    <td className="px-3 py-2">{l.branch_name}</td>
                    <td className="px-3 py-2">{tname(typeById[l.type_id || 0])}</td>
                    <td className="px-3 py-2">{l.authority}</td>
                    <td className="px-3 py-2">{l.issue_date || "—"}</td>
                    <td className="px-3 py-2">{l.expiry_date || "—"}</td>
                    <td className="px-3 py-2"><DaysBadge d={l.days_remaining} /></td>
                    <td className="px-3 py-2">{l.status}</td>
                    <td className="px-3 py-2"><Files f1={l.file1} f2={l.file2} f3={l.file3} /></td>
                    <td className="px-3 py-2"><div className="flex gap-1">
                      <button onClick={() => { setLicForm(l); setLicFiles([null, null, null]); }} className={`${btn} bg-gray-100`}><Pencil size={14} /></button>
                      {isApprover && <button onClick={() => del(`/api/renewals/licenses/${l.id}`)} className={`${btn} bg-red-50 text-red-700`}><Trash2 size={14} /></button>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "prices" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-gray-500">{t("rn_manage_types_hint")}</p>
            <div className="flex-1" />
            <button onClick={() => exp("types", "excel")} className={`${btn} bg-green-700 text-white inline-flex gap-1 items-center`}><FileSpreadsheet size={14} />Excel</button>
            <button onClick={() => exp("types", "pdf")} className={`${btn} bg-red-700 text-white inline-flex gap-1 items-center`}><FileText size={14} />PDF</button>
            <button onClick={() => setTypeForm({ group: "staff", default_fee: 0, validity_months: 12, reminder_days: 60, is_active: true })} className={`${btn} bg-emerald-600 text-white inline-flex gap-1 items-center`}><Plus size={14} />{t("rn_add_type")}</button>
          </div>
          {(["staff", "company"] as const).map(g => (
            <div key={g} className="bg-white rounded shadow overflow-x-auto">
              <div className="px-3 py-2 font-semibold bg-gray-50 border-b">{g === "staff" ? t("rn_staff") : t("rn_company")}</div>
              <table className="min-w-full text-sm">
                <thead className="text-gray-600"><tr>
                  {[t("rn_name"), t("rn_name_ar"), t("rn_default_fee"), t("rn_validity"), t("rn_reminder"), t("rn_active"), ""].map((h, i) => <th key={i} className="px-3 py-2 text-start">{h}</th>)}
                </tr></thead>
                <tbody>
                  {types.filter(x => x.group === g).map(x => (
                    <tr key={x.id} className={`border-t ${x.is_active ? "" : "opacity-50"}`}>
                      <td className="px-3 py-2">{x.name}</td><td className="px-3 py-2">{x.name_ar}</td>
                      <td className="px-3 py-2 font-semibold">{kd(x.default_fee)}</td>
                      <td className="px-3 py-2">{x.validity_months}</td><td className="px-3 py-2">{x.reminder_days}</td>
                      <td className="px-3 py-2">{x.is_active ? "✓" : "—"}</td>
                      <td className="px-3 py-2"><div className="flex gap-1">
                        <button onClick={() => setTypeForm(x)} className={`${btn} bg-gray-100`}><Pencil size={14} /></button>
                        {isApprover && <button onClick={() => del(`/api/renewals/types/${x.id}`)} className={`${btn} bg-red-50 text-red-700`}><Trash2 size={14} /></button>}
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}

      {/* ---------- Request form modal */}
      {showReq && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center overflow-y-auto p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl p-5 space-y-4 my-4">
            <div className="flex justify-between items-center"><h2 className="text-lg font-bold">{editReq ? editReq.request_no : t("rn_new_request")}</h2><button onClick={() => setShowReq(false)} className="text-gray-500">✕</button></div>
            <div className="grid md:grid-cols-4 gap-3">
              <div><label className="text-xs text-gray-600">{t("rn_group")}</label>
                <select className={inp} value={rf.group} disabled={!!editReq} onChange={e => setRf(f => ({ ...f, group: e.target.value, employee_id: "", license_id: "", lines: [emptyLine()] }))}>
                  <option value="staff">{t("rn_staff")}</option><option value="company">{t("rn_company")}</option>
                </select></div>
              {rf.group === "staff" ? (
                <div className="md:col-span-2"><label className="text-xs text-gray-600">{t("rn_employee")}</label>
                  <select className={inp} value={rf.employee_id} disabled={!!editReq} onChange={e => setRf(f => ({ ...f, employee_id: e.target.value }))}>
                    <option value="">{t("rn_select_employee")}</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{ar && e.name_ar ? e.name_ar : e.name} — {e.civil_id || "?"} — {bname(branches.find(b => b.id === e.branch_id))}</option>)}
                  </select></div>
              ) : (
                <div className="md:col-span-2"><label className="text-xs text-gray-600">{t("rn_license")}</label>
                  <select className={inp} value={rf.license_id} disabled={!!editReq} onChange={e => setRf(f => ({ ...f, license_id: e.target.value }))}>
                    <option value="">{t("rn_select_license")}</option>
                    {licenses.map(l => <option key={l.id} value={l.id}>{l.name} — {l.license_no} — {l.branch_name}</option>)}
                  </select></div>
              )}
              <div><label className="text-xs text-gray-600">{t("rn_urgency")}</label>
                <select className={inp} value={rf.urgency} onChange={e => setRf(f => ({ ...f, urgency: e.target.value }))}>
                  <option value="normal">{t("rn_normal")}</option><option value="urgent">{t("rn_urgent")}</option>
                </select></div>
            </div>

            {lastTxn && (
              <div className={`rounded p-3 text-sm ${lastTxn.open_requests.filter(o => o.id !== editReq?.id).length ? "bg-red-50 border border-red-200" : "bg-blue-50 border border-blue-200"}`}>
                <div className="font-semibold">{t("rn_last_txn")}</div>
                {lastTxn.last ? (
                  <div>{lastTxn.last.request_no} · {lastTxn.last.paid_date} · KD {kd(lastTxn.last.paid_amount)} · {lastTxn.last.paid_by_name}
                    <ul className="list-disc ms-5 text-xs text-gray-700">{lastTxn.last.lines.map((l, i) => <li key={i}>{l.type_name}{l.new_expiry ? ` → ${l.new_expiry}` : ""} — KD {kd(l.line_total)}</li>)}</ul>
                  </div>
                ) : <div className="text-gray-600">{t("rn_no_last_txn")}</div>}
                {lastTxn.open_requests.filter(o => o.id !== editReq?.id).length > 0 && (
                  <div className="text-red-700 font-semibold mt-1">{t("rn_open_warning")}: {lastTxn.open_requests.filter(o => o.id !== editReq?.id).map(o => `${o.request_no} (${o.status})`).join(", ")}</div>
                )}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600"><tr>
                  {["#", t("rn_type"), t("rn_description"), t("rn_current_expiry"), t("rn_new_expiry"), t("rn_new_doc_no"), t("rn_fee"), t("rn_extra"), t("rn_extra_desc"), t("rn_total"), ""].map((h, i) => <th key={i} className="px-2 py-1 text-start">{h}</th>)}
                </tr></thead>
                <tbody>
                  {rf.lines.map((l, i) => {
                    const valid = l.current_expiry && new Date(l.current_expiry) > new Date();
                    const dleft = valid ? Math.ceil((new Date(l.current_expiry).getTime() - Date.now()) / 86400000) : 0;
                    return (
                      <tr key={i} className="border-t align-top">
                        <td className="px-2 py-1">{i + 1}</td>
                        <td className="px-2 py-1 min-w-[160px]">
                          <select className={inp} value={l.type_id} onChange={e => onLineType(i, e.target.value)}>
                            <option value="">—</option>{lineTypes.map(ty => <option key={ty.id} value={ty.id}>{tname(ty)}</option>)}
                          </select>
                          {valid && dleft > 90 && <div className="text-xs text-amber-700 mt-1">{t("rn_still_valid")} {dleft} {t("rn_days")}</div>}
                        </td>
                        <td className="px-2 py-1"><input className={inp} value={l.description} onChange={e => setLine(i, { description: e.target.value })} /></td>
                        <td className="px-2 py-1"><input type="date" className={inp} value={l.current_expiry} onChange={e => setLine(i, { current_expiry: e.target.value })} /></td>
                        <td className="px-2 py-1"><input type="date" className={inp} value={l.new_expiry} onChange={e => setLine(i, { new_expiry: e.target.value })} /></td>
                        <td className="px-2 py-1"><input className={inp} value={l.new_doc_no} onChange={e => setLine(i, { new_doc_no: e.target.value })} /></td>
                        <td className="px-2 py-1 w-24"><input type="number" step="0.001" className={inp} value={l.fee} onChange={e => setLine(i, { fee: Number(e.target.value) })} /></td>
                        <td className="px-2 py-1 w-24"><input type="number" step="0.001" className={inp} value={l.extra_charges} onChange={e => setLine(i, { extra_charges: Number(e.target.value) })} /></td>
                        <td className="px-2 py-1"><input className={inp} value={l.extra_desc} onChange={e => setLine(i, { extra_desc: e.target.value })} /></td>
                        <td className="px-2 py-1 font-semibold whitespace-nowrap">{kd((Number(l.fee) || 0) + (Number(l.extra_charges) || 0))}</td>
                        <td className="px-2 py-1"><button onClick={() => setRf(f => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))} className="text-red-600" disabled={rf.lines.length === 1}><Trash2 size={14} /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr className="border-t bg-gray-50 font-bold"><td colSpan={9} className="px-2 py-2 text-end">{t("rn_total")}</td><td className="px-2 py-2">KD {kd(reqTotal)}</td><td /></tr></tfoot>
              </table>
            </div>
            <button onClick={() => setRf(f => ({ ...f, lines: [...f.lines, emptyLine()] }))} className={`${btn} bg-gray-100 inline-flex items-center gap-1`}><Plus size={14} />{t("rn_add_line")}</button>

            <div className="grid md:grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-600">{t("notes")}</label><textarea className={inp} rows={2} value={rf.notes} onChange={e => setRf(f => ({ ...f, notes: e.target.value }))} /></div>
              <FileInputs files={reqFiles} set={setReqFiles} />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowReq(false)} className={`${btn} bg-gray-100`}>{t("cancel")}</button>
              <button onClick={() => saveReq(false)} className={`${btn} bg-gray-700 text-white`}>{t("rn_save_draft")}</button>
              <button onClick={() => saveReq(true)} className={`${btn} bg-emerald-600 text-white`}>{t("rn_submit")}</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Detail modal */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center overflow-y-auto p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl p-5 space-y-4 my-4 text-sm">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold flex items-center gap-2">{detail.request_no} {statusBadge(detail)}</h2>
              <div className="flex gap-2">
                <button onClick={() => printForm(detail.id, detail.request_no)} className={`${btn} bg-gray-100 inline-flex gap-1 items-center`}><Printer size={14} />{t("rn_print_form")}</button>
                <button onClick={() => setDetail(null)} className="text-gray-500">✕</button>
              </div>
            </div>
            <div className="grid md:grid-cols-3 gap-2">
              <div><b>{t("rn_group")}:</b> {detail.group === "staff" ? t("rn_staff") : t("rn_company")}</div>
              <div><b>{t("rn_name")}:</b> {detail.subject_name}</div>
              <div><b>{detail.group === "staff" ? t("rn_civil_id") : t("rn_license_no")}:</b> {detail.subject_id_no}</div>
              <div><b>{t("branch")}:</b> {detail.branch_name}</div>
              <div><b>{t("rn_urgency")}:</b> {detail.urgency}</div>
              <div><b>{t("rn_requested_by")}:</b> {detail.requested_by_name} · {detail.requested_at}</div>
              {detail.approved_by_name && <div className="md:col-span-3"><b>{t("rn_approved_by")}:</b> {detail.approved_by_name} · {detail.approved_at} · KD {kd(detail.approved_amount)} {detail.approval_comment && `· ${detail.approval_comment}`}</div>}
              {detail.paid_date && <div className="md:col-span-3"><b>{t("rn_paid_by")}:</b> {detail.paid_by_name} · {detail.paid_date} · KD {kd(detail.paid_amount)} {detail.receipt_no && `· ${t("rn_receipt_no")} ${detail.receipt_no}`}</div>}
              <div className="md:col-span-3"><b>{t("rn_attachments")}:</b> <Files f1={detail.file1} f2={detail.file2} f3={detail.file3} /></div>
              {detail.notes && <div className="md:col-span-3"><b>{t("notes")}:</b> {detail.notes}</div>}
            </div>
            <table className="min-w-full">
              <thead className="bg-gray-50 text-gray-600"><tr>{["#", t("rn_type"), t("rn_description"), t("rn_current_expiry"), t("rn_new_expiry"), t("rn_new_doc_no"), t("rn_fee"), t("rn_extra"), t("rn_total"), t("rn_actual")].map((h, i) => <th key={i} className="px-2 py-1 text-start">{h}</th>)}</tr></thead>
              <tbody>{(detail.lines || []).map((l, i) => (
                <tr key={i} className="border-t"><td className="px-2 py-1">{i + 1}</td><td className="px-2 py-1">{l.type_name}{l.type_name_ar && <span className="text-gray-500"> / {l.type_name_ar}</span>}</td>
                  <td className="px-2 py-1">{l.description}{l.extra_desc && <span className="text-gray-500"> ({l.extra_desc})</span>}</td><td className="px-2 py-1">{l.current_expiry || "—"}</td><td className="px-2 py-1">{l.new_expiry || "—"}</td>
                  <td className="px-2 py-1">{l.new_doc_no || "—"}</td><td className="px-2 py-1">{kd(l.fee)}</td><td className="px-2 py-1">{kd(l.extra_charges)}</td>
                  <td className="px-2 py-1 font-semibold">{kd(l.line_total)}</td><td className="px-2 py-1">{l.actual_amount != null ? kd(l.actual_amount) : "—"}</td></tr>
              ))}</tbody>
              <tfoot><tr className="border-t font-bold bg-gray-50"><td colSpan={8} className="px-2 py-1 text-end">{t("rn_total")}</td><td className="px-2 py-1">KD {kd(detail.total)}</td><td className="px-2 py-1">{detail.paid_amount != null ? `KD ${kd(detail.paid_amount)}` : ""}</td></tr></tfoot>
            </table>
            {detail.last_transaction && (
              <div className="bg-blue-50 border border-blue-200 rounded p-2"><b>{t("rn_last_txn")}:</b> {detail.last_transaction.request_no} · {detail.last_transaction.paid_date} · KD {kd(detail.last_transaction.paid_amount)}</div>
            )}
            <div>
              <div className="font-semibold mb-1">{t("rn_history")}</div>
              <ul className="text-xs text-gray-700 space-y-0.5">{(detail.logs || []).map((l, i) => <li key={i}>{l.at} — <b>{l.label}</b> — {l.user_name}{l.comment && ` — ${l.comment}`}</li>)}</ul>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {detail.status === "draft" && <button onClick={() => action(detail.id, "submit")} className={`${btn} bg-emerald-600 text-white`}>{t("rn_submit")}</button>}
              {["draft", "returned"].includes(detail.status) && <button onClick={() => { setDetail(null); openEdit(detail); }} className={`${btn} bg-gray-100`}>{t("edit")}</button>}
              {["draft", "returned", "pending"].includes(detail.status) && <button onClick={() => promptAction(detail.id, "cancel", false)} className={`${btn} bg-gray-200`}>{t("rn_cancel_req")}</button>}
              {detail.status === "pending" && isApprover && <>
                <button onClick={() => { setApv({ amount: String(detail.total), comment: "" }); setApproveReq(detail); }} className={`${btn} bg-green-600 text-white`}>{t("rn_approve")}</button>
                <button onClick={() => promptAction(detail.id, "return", true)} className={`${btn} bg-orange-500 text-white`}>{t("rn_return")}</button>
                <button onClick={() => promptAction(detail.id, "reject", true)} className={`${btn} bg-red-600 text-white`}>{t("rn_reject")}</button>
              </>}
              {detail.status === "approved" && canPay && <button onClick={() => openPay(detail)} className={`${btn} bg-blue-600 text-white`}>{t("rn_pay")}</button>}
              {detail.status === "paid" && <button onClick={() => action(detail.id, "close")} className={`${btn} bg-green-700 text-white`}>{t("rn_close")}</button>}
            </div>
          </div>
        </div>
      )}

      {/* ---------- Approve modal */}
      {approveReq && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-3">
            <h2 className="font-bold">{t("rn_approve")} — {approveReq.request_no}</h2>
            <div className="text-sm">{approveReq.subject_name} · {approveReq.branch_name} · {t("rn_total")} KD {kd(approveReq.total)}</div>
            <div><label className="text-xs text-gray-600">{t("rn_approved_amount")}</label><input type="number" step="0.001" className={inp} value={apv.amount} onChange={e => setApv(a => ({ ...a, amount: e.target.value }))} /></div>
            <div><label className="text-xs text-gray-600">{t("rn_comment")}</label><textarea className={inp} rows={2} value={apv.comment} onChange={e => setApv(a => ({ ...a, comment: e.target.value }))} /></div>
            <div className="flex justify-end gap-2"><button onClick={() => setApproveReq(null)} className={`${btn} bg-gray-100`}>{t("cancel")}</button><button onClick={doApprove} className={`${btn} bg-green-600 text-white`}>{t("rn_approve")}</button></div>
          </div>
        </div>
      )}

      {/* ---------- Pay modal */}
      {payReq && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-start justify-center overflow-y-auto p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-5 space-y-3 my-4">
            <h2 className="font-bold">{t("rn_pay")} — {payReq.request_no}</h2>
            <div className="text-sm text-gray-600">{payReq.subject_name} · {payReq.branch_name} · {t("rn_approved_amount")} KD {kd(payReq.approved_amount ?? payReq.total)} · {t("rn_petty_cash")} KD {kd(summary?.petty_cash_balance)}</div>
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50"><tr><th className="px-2 py-1 text-start">{t("rn_type")}</th><th className="px-2 py-1 text-start">{t("rn_description")}</th><th className="px-2 py-1 text-start">{t("rn_total")}</th><th className="px-2 py-1 text-start">{t("rn_actual")}</th></tr></thead>
              <tbody>{(payReq.lines || []).map(l => (
                <tr key={l.id} className="border-t"><td className="px-2 py-1">{l.type_name}</td><td className="px-2 py-1">{l.description}</td><td className="px-2 py-1">{kd(l.line_total)}</td>
                  <td className="px-2 py-1 w-32"><input type="number" step="0.001" className={inp} value={pay.actuals[l.id!] ?? ""} onChange={e => setPay(p => ({ ...p, actuals: { ...p.actuals, [l.id!]: e.target.value } }))} /></td></tr>
              ))}</tbody>
              <tfoot><tr className="border-t font-bold bg-gray-50"><td colSpan={3} className="px-2 py-1 text-end">{t("rn_total")}</td><td className="px-2 py-1">KD {kd(payTotal)}</td></tr></tfoot>
            </table>
            <div className="grid md:grid-cols-3 gap-3">
              <div><label className="text-xs text-gray-600">{t("rn_paid_date")}</label><input type="date" className={inp} value={pay.paid_date} onChange={e => setPay(p => ({ ...p, paid_date: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-600">{t("rn_receipt_no")}</label><input className={inp} value={pay.receipt_no} onChange={e => setPay(p => ({ ...p, receipt_no: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-600">{t("notes")}</label><input className={inp} value={pay.notes} onChange={e => setPay(p => ({ ...p, notes: e.target.value }))} /></div>
            </div>
            <FileInputs files={pay.files} set={f => setPay(p => ({ ...p, files: f }))} />
            <div className="flex justify-end gap-2"><button onClick={() => setPayReq(null)} className={`${btn} bg-gray-100`}>{t("cancel")}</button><button onClick={doPay} className={`${btn} bg-blue-600 text-white`}>{t("rn_pay")}</button></div>
          </div>
        </div>
      )}

      {/* ---------- Type modal */}
      {typeForm && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5 space-y-3">
            <h2 className="font-bold">{typeForm.id ? t("edit") : t("rn_add_type")}</h2>
            <div><label className="text-xs text-gray-600">{t("rn_group")}</label>
              <select className={inp} value={typeForm.group} disabled={!!typeForm.id} onChange={e => setTypeForm(f => ({ ...f, group: e.target.value }))}><option value="staff">{t("rn_staff")}</option><option value="company">{t("rn_company")}</option></select></div>
            <div><label className="text-xs text-gray-600">{t("rn_name")}</label><input className={inp} value={typeForm.name || ""} onChange={e => setTypeForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><label className="text-xs text-gray-600">{t("rn_name_ar")}</label><input className={inp} dir="rtl" value={typeForm.name_ar || ""} onChange={e => setTypeForm(f => ({ ...f, name_ar: e.target.value }))} /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="text-xs text-gray-600">{t("rn_default_fee")}</label><input type="number" step="0.001" className={inp} value={typeForm.default_fee ?? 0} onChange={e => setTypeForm(f => ({ ...f, default_fee: Number(e.target.value) }))} /></div>
              <div><label className="text-xs text-gray-600">{t("rn_validity")}</label><input type="number" className={inp} value={typeForm.validity_months ?? 12} onChange={e => setTypeForm(f => ({ ...f, validity_months: Number(e.target.value) }))} /></div>
              <div><label className="text-xs text-gray-600">{t("rn_reminder")}</label><input type="number" className={inp} value={typeForm.reminder_days ?? 60} onChange={e => setTypeForm(f => ({ ...f, reminder_days: Number(e.target.value) }))} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={typeForm.is_active ?? true} onChange={e => setTypeForm(f => ({ ...f, is_active: e.target.checked }))} />{t("rn_active")}</label>
            <div className="flex justify-end gap-2"><button onClick={() => setTypeForm(null)} className={`${btn} bg-gray-100`}>{t("cancel")}</button><button onClick={saveType} className={`${btn} bg-emerald-600 text-white`}>{t("save")}</button></div>
          </div>
        </div>
      )}

      {/* ---------- License modal */}
      {licForm && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-start justify-center overflow-y-auto p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5 space-y-3 my-4">
            <h2 className="font-bold">{licForm.id ? t("edit") : t("rn_add_license")}</h2>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2"><label className="text-xs text-gray-600">{t("rn_name")}</label><input className={inp} value={licForm.name || ""} onChange={e => setLicForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-600">{t("rn_license_no")}</label><input className={inp} value={licForm.license_no || ""} onChange={e => setLicForm(f => ({ ...f, license_no: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-600">{t("rn_type")}</label>
                <select className={inp} value={licForm.type_id ?? ""} onChange={e => setLicForm(f => ({ ...f, type_id: e.target.value ? Number(e.target.value) : null }))}><option value="">—</option>{companyTypes.map(ty => <option key={ty.id} value={ty.id}>{tname(ty)}</option>)}</select></div>
              <div><label className="text-xs text-gray-600">{t("branch")}</label>
                <select className={inp} value={licForm.branch_id ?? ""} onChange={e => setLicForm(f => ({ ...f, branch_id: e.target.value ? Number(e.target.value) : null }))}><option value="">—</option>{branches.map(b => <option key={b.id} value={b.id}>{bname(b)}</option>)}</select></div>
              <div><label className="text-xs text-gray-600">{t("rn_authority")}</label><input className={inp} value={licForm.authority || ""} onChange={e => setLicForm(f => ({ ...f, authority: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-600">{t("rn_issue_date")}</label><input type="date" className={inp} value={licForm.issue_date || ""} onChange={e => setLicForm(f => ({ ...f, issue_date: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-600">{t("rn_expiry_date")}</label><input type="date" className={inp} value={licForm.expiry_date || ""} onChange={e => setLicForm(f => ({ ...f, expiry_date: e.target.value }))} /></div>
              {licForm.id && <div><label className="text-xs text-gray-600">{t("rn_status")}</label>
                <select className={inp} value={licForm.status || "active"} onChange={e => setLicForm(f => ({ ...f, status: e.target.value }))}><option value="active">active</option><option value="expired">expired</option><option value="cancelled">cancelled</option></select></div>}
              <div className="col-span-2"><label className="text-xs text-gray-600">{t("notes")}</label><input className={inp} value={licForm.notes || ""} onChange={e => setLicForm(f => ({ ...f, notes: e.target.value }))} /></div>
            </div>
            <FileInputs files={licFiles} set={setLicFiles} />
            <div className="flex justify-end gap-2"><button onClick={() => setLicForm(null)} className={`${btn} bg-gray-100`}>{t("cancel")}</button><button onClick={saveLic} className={`${btn} bg-emerald-600 text-white`}>{t("save")}</button></div>
          </div>
        </div>
      )}

      {/* ---------- Document modal */}
      {docForm && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-start justify-center overflow-y-auto p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5 space-y-3 my-4">
            <h2 className="font-bold">{docForm.id ? t("edit") : t("rn_add_document")}</h2>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2"><label className="text-xs text-gray-600">{t("rn_employee")}</label>
                <select className={inp} value={docForm.employee_id ?? ""} disabled={!!docForm.id} onChange={e => setDocForm(f => ({ ...f, employee_id: Number(e.target.value) }))}>
                  <option value="">{t("rn_select_employee")}</option>{employees.map(e => <option key={e.id} value={e.id}>{ar && e.name_ar ? e.name_ar : e.name} — {e.civil_id || "?"}</option>)}
                </select></div>
              <div><label className="text-xs text-gray-600">{t("rn_type")}</label>
                <select className={inp} value={docForm.type_id ?? ""} onChange={e => setDocForm(f => ({ ...f, type_id: Number(e.target.value) }))}><option value="">—</option>{staffTypes.map(ty => <option key={ty.id} value={ty.id}>{tname(ty)}</option>)}</select></div>
              <div><label className="text-xs text-gray-600">{t("rn_doc_no")}</label><input className={inp} value={docForm.doc_no || ""} onChange={e => setDocForm(f => ({ ...f, doc_no: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-600">{t("rn_authority")}</label><input className={inp} value={docForm.authority || ""} onChange={e => setDocForm(f => ({ ...f, authority: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-600">{t("rn_issue_date")}</label><input type="date" className={inp} value={docForm.issue_date || ""} onChange={e => setDocForm(f => ({ ...f, issue_date: e.target.value }))} /></div>
              <div><label className="text-xs text-gray-600">{t("rn_expiry_date")}</label><input type="date" className={inp} value={docForm.expiry_date || ""} onChange={e => setDocForm(f => ({ ...f, expiry_date: e.target.value }))} /></div>
              {docForm.id && <div><label className="text-xs text-gray-600">{t("rn_status")}</label>
                <select className={inp} value={docForm.status || "active"} onChange={e => setDocForm(f => ({ ...f, status: e.target.value }))}><option value="active">active</option><option value="expired">expired</option><option value="cancelled">cancelled</option></select></div>}
              <div className="col-span-2"><label className="text-xs text-gray-600">{t("notes")}</label><input className={inp} value={docForm.notes || ""} onChange={e => setDocForm(f => ({ ...f, notes: e.target.value }))} /></div>
            </div>
            <FileInputs files={docFiles} set={setDocFiles} />
            <div className="flex justify-end gap-2"><button onClick={() => setDocForm(null)} className={`${btn} bg-gray-100`}>{t("cancel")}</button><button onClick={saveDoc} className={`${btn} bg-emerald-600 text-white`}>{t("save")}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
