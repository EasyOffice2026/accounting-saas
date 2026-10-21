import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost, apiDownload } from "../contexts/api";

type Brand = { id: number; name_en: string; name_ar: string | null; journals: number };
type Branch = { id: number; name: string; name_ar: string | null; brand_id: number | null };
type Overview = {
  start_date: string | null; auto_sync: boolean; user_ids: number[];
  users: { id: number; username: string; full_name: string }[];
  last_sync_at: string | null; last_sync_result: Record<string, unknown> | null;
  brands: Brand[]; branches: Branch[];
};
type Account = { id: number; code: string; name: string; name_ar: string | null; type: string; parent_code: string | null; is_header: boolean; concept: string | null; is_active: boolean; system: boolean; balance: number };
type Line = { account_id: number; code: string; name: string; name_ar: string | null; branch_id: number | null; debit: number; credit: number; memo: string | null; party?: string | null };
type Journal = { id: number; number: number; date: string; description: string; source: string; source_key: string | null; is_active: boolean; reversal_of: number | null; reversed_by: number | null; total: number; notes: string | null; lines: Line[] };
type Mapping = { kind: string; ref_id: string; label: string; label_ar: string; mapped: boolean; account_id: number; code: string; name: string; name_ar: string | null };
type Group = { code: string; name: string; name_ar: string | null; total: number; accounts: { account_id: number; code: string; name: string; name_ar: string | null; amount: number }[] };
type PartyOpt = { party: string; kind: string; kind_name: string; kind_name_ar: string; name: string; name_ar: string };
type PartyRow = PartyOpt & { debit: number; credit: number; balance: number; last_date: string | null; accounts: string[] };
type TBRow = { account_id: number; code: string; name: string; name_ar: string | null; opening_dr: number; opening_cr: number; debit: number; credit: number; closing_dr: number; closing_cr: number };

const TABS = ["overview", "journals", "trial", "ledger", "payables", "receivables", "income", "balance", "reconcile", "accounts", "mapping"] as const;
type Tab = typeof TABS[number];

const L: Record<string, [string, string]> = {
  overview: ["Overview", "نظرة عامة"], journals: ["Journals", "القيود"], trial: ["Trial Balance", "ميزان المراجعة"],
  ledger: ["Account Ledger", "كشف حساب"], income: ["Income Statement", "قائمة الدخل"], balance: ["Balance Sheet", "الميزانية العمومية"],
  reconcile: ["Daily Check", "المطابقة اليومية"], accounts: ["Chart of Accounts", "دليل الحسابات"], mapping: ["Account Mapping", "ربط الحسابات"],
  company: ["Company", "الشركة"], from: ["From", "من"], to: ["To", "إلى"], as_of: ["As of", "كما في"], branch: ["Branch", "الفرع"],
  all_branches: ["All branches", "كل الفروع"], excel: ["Excel", "إكسل"], print: ["Print / PDF", "طباعة / PDF"], sync: ["Sync now", "مزامنة الآن"],
  code: ["Code", "الرمز"], account: ["Account", "الحساب"], debit: ["Debit", "مدين"], credit: ["Credit", "دائن"], balance_col: ["Balance", "الرصيد"],
  date: ["Date", "التاريخ"], no: ["No.", "رقم"], description: ["Description", "البيان"], source: ["Source", "المصدر"], total: ["Total", "الإجمالي"],
  opening: ["Opening", "افتتاحي"], closing: ["Closing", "ختامي"], balanced: ["Balanced", "متوازن"], not_balanced: ["NOT balanced", "غير متوازن"],
  system: ["Mudawwarah", "مدوّرة"], ledger_col: ["Ledger", "الدفتر"], difference: ["Difference", "الفرق"], matched: ["All figures match", "كل الأرقام متطابقة"],
  not_matched: ["Differences found", "توجد فروقات"], start_date: ["Ledger start date", "تاريخ بدء الدفتر"], auto_sync: ["Automatic posting every 5 minutes", "ترحيل تلقائي كل 5 دقائق"],
  access: ["Logins that can open Accounting", "المستخدمون المسموح لهم بالمحاسبة"], save: ["Save", "حفظ"], last_sync: ["Last sync", "آخر مزامنة"],
  clear: ["Clear ledger (test period only)", "مسح الدفتر (فترة الاختبار فقط)"], new_journal: ["New manual journal", "قيد يدوي جديد"],
  reverse: ["Reverse", "عكس"], reversed: ["Reversed", "معكوس"], add_line: ["Add line", "إضافة سطر"], post: ["Post journal", "ترحيل القيد"],
  memo: ["Memo", "ملاحظة"], opening_journal: ["Opening balances journal", "قيد أرصدة افتتاحية"], cancel: ["Cancel", "إلغاء"],
  gross: ["Gross profit", "مجمل الربح"], net: ["Net profit", "صافي الربح"], assets: ["Assets", "الأصول"], liabilities: ["Liabilities", "الالتزامات"],
  equity: ["Equity", "حقوق الملكية"], profit_to_date: ["Profit to date", "ربح الفترة"], total_equity: ["Total equity", "إجمالي حقوق الملكية"],
  default: ["(default)", "(افتراضي)"], item: ["Item", "البند"], posts_to: ["Posts to", "يرحّل إلى"], new_account: ["New sub-account", "حساب فرعي جديد"],
  parent: ["Parent", "الحساب الرئيسي"], name: ["Name", "الاسم"], name_ar: ["Arabic name", "الاسم بالعربي"], search: ["Search", "بحث"],
  choose_account: ["Choose an account", "اختر حساباً"], journals_count: ["journals", "قيد"], test_note: ["Visible only to the logins below during testing.", "ظاهر فقط للمستخدمين أدناه خلال فترة الاختبار."],
  kind_setting: ["General", "عام"], kind_expense_category: ["Expense categories", "فئات المصروفات"], kind_purchase_category: ["Purchase categories", "فئات المشتريات"],
  payables: ["Payables", "الذمم الدائنة"], receivables: ["Receivables", "الذمم المدينة"], party: ["Supplier / customer", "المورد / العميل"],
  type: ["Type", "النوع"], accounts_col: ["Accounts", "الحسابات"], last_entry: ["Last entry", "آخر حركة"], statement: ["Statement", "كشف حساب"],
  back: ["Back to list", "رجوع للقائمة"], control: ["Account total vs parties", "إجمالي الحساب مقابل الأطراف"], unallocated: ["Not assigned to a party", "غير مخصص لطرف"],
  parties_ok: ["Parties add up to the account totals", "مجموع الأطراف يطابق أرصدة الحسابات"], parties_diff: ["Some entries have no party", "توجد قيود بدون طرف"],
  hide_zero: ["Hide zero balances", "إخفاء الأرصدة الصفرية"], no_party: ["No party", "بدون طرف"],
  area_cash_box: ["Cash box", "الصندوق"], area_channel: ["Payment channel", "قناة الدفع"], area_sales: ["Sales", "المبيعات"], area_expenses: ["Expenses", "المصروفات"],
};

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 8) + "01";

export default function AccountingPage() {
  const { i18n } = useTranslation();
  const ar = i18n.language === "ar";
  const t = (k: string) => (L[k] ? L[k][ar ? 1 : 0] : k);
  const nm = (o: { name?: string | null; name_ar?: string | null; label?: string; label_ar?: string }) =>
    ar ? (o.name_ar || o.label_ar || o.name || o.label || "") : (o.name || o.label || "");

  const [tab, setTab] = useState<Tab>("overview");
  const [ov, setOv] = useState<Overview | null>(null);
  const [brandId, setBrandId] = useState<number>(1);
  const [branchId, setBranchId] = useState<string>("");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const loadOverview = useCallback(() => apiGet("/api/accounting/overview").then(setOv).catch(e => setErr(String(e.message || e))), []);
  const loadAccounts = useCallback(() => apiGet(`/api/accounting/accounts?brand_id=${brandId}`).then(setAccounts).catch(() => undefined), [brandId]);
  useEffect(() => { loadOverview(); }, [loadOverview]);
  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const branches = useMemo(() => (ov?.branches || []).filter(b => b.brand_id === brandId), [ov, brandId]);
  const branchName = (id: number | null) => { const b = ov?.branches.find(x => x.id === id); return b ? nm(b) : ""; };
  const postable = accounts.filter(a => !a.is_header && a.is_active);

  const sync = async () => {
    setBusy(true); setErr("");
    try { await apiPost("/api/accounting/sync", new FormData()); await loadOverview(); await loadAccounts(); }
    catch (e) { setErr(String((e as Error).message || e)); } finally { setBusy(false); }
  };

  const qs = (extra: Record<string, string | number | undefined> = {}) => {
    const p = new URLSearchParams({ brand_id: String(brandId), lang: ar ? "ar" : "en" });
    Object.entries(extra).forEach(([k, v]) => { if (v !== undefined && v !== "") p.set(k, String(v)); });
    return p.toString();
  };

  return (
    <div className="space-y-4" dir={ar ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h1 className="text-2xl font-bold">{ar ? "المحاسبة" : "Accounting"}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm">{t("company")}</label>
          <select className="border rounded px-2 py-1" value={brandId} onChange={e => { setBrandId(Number(e.target.value)); setBranchId(""); }}>
            {(ov?.brands || []).map(b => <option key={b.id} value={b.id}>{ar ? (b.name_ar || b.name_en) : b.name_en}</option>)}
          </select>
          <button className="px-3 py-1 rounded bg-emerald-600 text-white disabled:opacity-50" disabled={busy || !ov?.start_date} onClick={sync}>{busy ? "..." : t("sync")}</button>
        </div>
      </div>
      {err && <div className="p-2 rounded bg-red-50 text-red-700 text-sm">{err}</div>}
      <div className="flex flex-wrap gap-1 border-b print:hidden">
        {TABS.map(k => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm ${tab === k ? "border-b-2 border-blue-600 font-semibold text-blue-700" : "text-gray-600"}`}>{t(k)}</button>
        ))}
      </div>

      {["trial", "ledger", "income", "reconcile", "journals"].includes(tab) && (
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <div><div className="text-xs">{t("from")}</div><input type="date" className="border rounded px-2 py-1" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><div className="text-xs">{t("to")}</div><input type="date" className="border rounded px-2 py-1" value={to} onChange={e => setTo(e.target.value)} /></div>
          {["trial", "ledger", "income"].includes(tab) && (
            <div><div className="text-xs">{t("branch")}</div>
              <select className="border rounded px-2 py-1" value={branchId} onChange={e => setBranchId(e.target.value)}>
                <option value="">{t("all_branches")}</option>
                {branches.map(b => <option key={b.id} value={b.id}>{nm(b)}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {tab === "overview" && ov && <OverviewTab ov={ov} t={t} reload={loadOverview} setErr={setErr} />}
      {tab === "journals" && <JournalsTab brandId={brandId} from={from} to={to} t={t} nm={nm} postable={postable} branches={branches} branchName={branchName} reloadAccounts={loadAccounts} />}
      {tab === "trial" && <TrialTab q={qs({ date_from: from, date_to: to, branch_id: branchId })} t={t} nm={nm} />}
      {tab === "ledger" && <LedgerTab key={brandId} brandId={brandId} from={from} to={to} branchId={branchId} lang={ar ? "ar" : "en"} postable={accounts.filter(a => !a.is_header)} t={t} nm={nm} branchName={branchName} />}
      {(tab === "payables" || tab === "receivables") && <PartiesTab key={`${brandId}-${tab}`} brandId={brandId} side={tab === "payables" ? "payable" : "receivable"} from={from} to={to} lang={ar ? "ar" : "en"} t={t} nm={nm} branchName={branchName} />}
      {tab === "income" && <IncomeTab q={qs({ date_from: from, date_to: to, branch_id: branchId })} t={t} nm={nm} />}
      {tab === "balance" && <BalanceTab brandId={brandId} lang={ar ? "ar" : "en"} t={t} nm={nm} />}
      {tab === "reconcile" && <ReconcileTab q={qs({ date_from: from, date_to: to })} t={t} nm={nm} />}
      {tab === "accounts" && <AccountsTab brandId={brandId} accounts={accounts} reload={loadAccounts} t={t} nm={nm} />}
      {tab === "mapping" && <MappingTab brandId={brandId} postable={postable} t={t} nm={nm} />}
    </div>
  );
}

type T = (k: string) => string;
type NM = (o: { name?: string | null; name_ar?: string | null; label?: string; label_ar?: string }) => string;

function Toolbar({ excel, filename }: { excel?: string; filename?: string }) {
  const { i18n } = useTranslation();
  const ar = i18n.language === "ar";
  return (
    <div className="flex gap-2 print:hidden">
      {excel && <button className="px-3 py-1 rounded border" onClick={() => apiDownload(excel, filename || "report.xlsx")}>{ar ? "إكسل" : "Excel"}</button>}
      <button className="px-3 py-1 rounded border" onClick={() => window.print()}>{ar ? "طباعة / PDF" : "Print / PDF"}</button>
    </div>
  );
}

const th = "px-2 py-1 text-start font-semibold bg-gray-100 border";
const td = "px-2 py-1 border";
const num = "px-2 py-1 border text-end tabular-nums";

function OverviewTab({ ov, t, reload, setErr }: { ov: Overview; t: T; reload: () => void; setErr: (s: string) => void }) {
  const [start, setStart] = useState(ov.start_date || "");
  const [auto, setAuto] = useState(ov.auto_sync);
  const [ids, setIds] = useState<number[]>(ov.user_ids);
  const [confirm, setConfirm] = useState("");
  const save = async () => {
    const f = new FormData();
    f.append("start_date", start); f.append("auto_sync", String(auto)); f.append("user_ids", JSON.stringify(ids));
    try { await apiPost("/api/accounting/settings", f); setErr(""); reload(); } catch (e) { setErr(String((e as Error).message || e)); }
  };
  const clear = async () => {
    const f = new FormData(); f.append("confirm", confirm);
    try { await apiPost("/api/accounting/reset", f); setConfirm(""); setErr(""); reload(); } catch (e) { setErr(String((e as Error).message || e)); }
  };
  const res = ov.last_sync_result as { posted?: number; reposted?: number; reversed?: number; unchanged?: number; skipped?: string[] } | null;
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="border rounded p-3 space-y-2">
        {ov.brands.map(b => <div key={b.id} className="flex justify-between"><span>{b.name_en} / {b.name_ar}</span><span>{b.journals} {t("journals_count")}</span></div>)}
        <div className="text-sm text-gray-600">{t("last_sync")}: {ov.last_sync_at ? new Date(ov.last_sync_at).toLocaleString() : "-"}</div>
        {res && <div className="text-sm">+{res.posted || 0} / ↻{res.reposted || 0} / ↶{res.reversed || 0} / ={res.unchanged || 0}{res.skipped && res.skipped.length ? ` / ! ${res.skipped.join(", ")}` : ""}</div>}
      </div>
      <div className="border rounded p-3 space-y-2">
        <div className="text-sm text-gray-600">{t("test_note")}</div>
        <label className="block text-sm">{t("start_date")}<input type="date" className="border rounded px-2 py-1 ms-2" value={start} onChange={e => setStart(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />{t("auto_sync")}</label>
        <div className="text-sm font-semibold">{t("access")}</div>
        {ov.users.map(u => (
          <label key={u.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ids.includes(u.id)} onChange={e => setIds(e.target.checked ? [...ids, u.id] : ids.filter(x => x !== u.id))} />
            {u.full_name} ({u.username})
          </label>
        ))}
        <button className="px-3 py-1 rounded bg-blue-600 text-white" onClick={save}>{t("save")}</button>
        <div className="border-t pt-2 space-y-1">
          <div className="text-sm font-semibold text-red-700">{t("clear")}</div>
          <div className="flex gap-2"><input className="border rounded px-2 py-1" placeholder="CLEAR" value={confirm} onChange={e => setConfirm(e.target.value)} />
            <button className="px-3 py-1 rounded bg-red-600 text-white disabled:opacity-50" disabled={confirm !== "CLEAR"} onClick={clear}>{t("clear")}</button></div>
        </div>
      </div>
    </div>
  );
}

function JournalsTab({ brandId, from, to, t, nm, postable, branches, branchName, reloadAccounts }: {
  brandId: number; from: string; to: string; t: T; nm: NM; postable: Account[]; branches: Branch[]; branchName: (id: number | null) => string; reloadAccounts: () => void;
}) {
  const [rows, setRows] = useState<Journal[]>([]);
  const [total, setTotal] = useState(0);
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [form, setForm] = useState(false);
  const load = useCallback(() => {
    const p = new URLSearchParams({ brand_id: String(brandId), date_from: from, date_to: to });
    if (source) p.set("source", source); if (q) p.set("q", q);
    apiGet(`/api/accounting/journals?${p}`).then(d => { setRows(d.rows); setTotal(d.total); }).catch(() => undefined);
  }, [brandId, from, to, source, q]);
  useEffect(() => { load(); }, [load]);
  const reverse = async (id: number) => {
    const f = new FormData(); f.append("reason", "Reversed by Finance");
    await apiPost(`/api/accounting/journals/${id}/reverse`, f); load(); reloadAccounts();
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 print:hidden">
        <select className="border rounded px-2 py-1" value={source} onChange={e => setSource(e.target.value)}>
          <option value="">{t("source")}: *</option>
          {["sale", "purchase", "expense", "salary", "advance", "cash", "channel", "proceeds", "proc_invoice", "proc_payment", "opening", "manual", "opening_manual"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input className="border rounded px-2 py-1" placeholder={t("search")} value={q} onChange={e => setQ(e.target.value)} />
        <button className="px-3 py-1 rounded bg-blue-600 text-white" onClick={() => setForm(true)}>{t("new_journal")}</button>
        <span className="text-sm text-gray-600 self-center">{total} {t("journals_count")}</span>
      </div>
      {form && <JournalForm brandId={brandId} postable={postable} branches={branches} t={t} nm={nm} done={() => { setForm(false); load(); reloadAccounts(); }} />}
      <table className="w-full text-sm border-collapse">
        <thead><tr><th className={th}>{t("no")}</th><th className={th}>{t("date")}</th><th className={th}>{t("description")}</th><th className={th}>{t("source")}</th><th className={th}>{t("total")}</th><th className={th}></th></tr></thead>
        <tbody>
          {rows.map(j => (
            <Fragment key={j.id}>
              <tr className={`cursor-pointer hover:bg-gray-50 ${j.is_active || j.reversal_of ? "" : "text-gray-400 line-through"}`} onClick={() => setOpen(open === j.id ? null : j.id)}>
                <td className={td}>{j.number}</td><td className={td}>{j.date}</td><td className={td}>{j.description}</td>
                <td className={td}>{j.source_key || j.source}</td><td className={num}>{fmt(j.total)}</td>
                <td className={td}>{!j.source_key && j.is_active && !j.reversal_of ? <button className="text-red-600 print:hidden" onClick={e => { e.stopPropagation(); reverse(j.id); }}>{t("reverse")}</button> : (!j.is_active && !j.reversal_of ? t("reversed") : "")}</td>
              </tr>
              {open === j.id && (
                <tr><td colSpan={6} className="p-2 bg-gray-50">
                  <table className="w-full text-xs"><tbody>
                    {j.lines.map((l, i) => <tr key={i}><td className="px-2">{l.code} {nm(l)}</td><td className="px-2">{branchName(l.branch_id)}</td><td className="px-2">{l.memo}</td><td className="px-2 text-end">{l.debit ? fmt(l.debit) : ""}</td><td className="px-2 text-end">{l.credit ? fmt(l.credit) : ""}</td></tr>)}
                  </tbody></table>
                  {j.notes && <div className="text-xs text-gray-500 mt-1">{j.notes}</div>}
                </td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JournalForm({ brandId, postable, branches, t, nm, done }: { brandId: number; postable: Account[]; branches: Branch[]; t: T; nm: NM; done: () => void }) {
  const [d, setD] = useState(today());
  const [desc, setDesc] = useState("");
  const [opening, setOpening] = useState(false);
  const [lines, setLines] = useState([{ account_id: "", branch_id: "", debit: "", credit: "", memo: "", party: "" }, { account_id: "", branch_id: "", debit: "", credit: "", memo: "", party: "" }]);
  const [err, setErr] = useState("");
  const [parties, setParties] = useState<PartyOpt[]>([]);
  useEffect(() => { apiGet("/api/accounting/party-options").then(setParties).catch(() => undefined); }, []);
  const dr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const cr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const set = (i: number, k: string, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const submit = async () => {
    const f = new FormData();
    f.append("brand_id", String(brandId)); f.append("date", d); f.append("description", desc); f.append("opening", String(opening));
    f.append("lines", JSON.stringify(lines.filter(l => l.account_id).map(l => ({ ...l, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }))));
    try { await apiPost("/api/accounting/journals", f); done(); } catch (e) { setErr(String((e as Error).message || e)); }
  };
  return (
    <div className="border rounded p-3 space-y-2 bg-blue-50/40">
      <div className="flex flex-wrap gap-2">
        <input type="date" className="border rounded px-2 py-1" value={d} onChange={e => setD(e.target.value)} />
        <input className="border rounded px-2 py-1 flex-1" placeholder={t("description")} value={desc} onChange={e => setDesc(e.target.value)} />
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={opening} onChange={e => setOpening(e.target.checked)} />{t("opening_journal")}</label>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="flex flex-wrap gap-2">
          <select className="border rounded px-2 py-1 flex-1 min-w-[220px]" value={l.account_id} onChange={e => set(i, "account_id", e.target.value)}>
            <option value="">{t("choose_account")}</option>
            {postable.map(a => <option key={a.id} value={a.id}>{a.code} {nm(a)}</option>)}
          </select>
          <select className="border rounded px-2 py-1" value={l.branch_id} onChange={e => set(i, "branch_id", e.target.value)}>
            <option value="">-</option>{branches.map(b => <option key={b.id} value={b.id}>{nm(b)}</option>)}
          </select>
          <input className="border rounded px-2 py-1 w-28" placeholder={t("debit")} value={l.debit} onChange={e => set(i, "debit", e.target.value)} />
          <input className="border rounded px-2 py-1 w-28" placeholder={t("credit")} value={l.credit} onChange={e => set(i, "credit", e.target.value)} />
          <select className="border rounded px-2 py-1 w-56" value={l.party} onChange={e => set(i, "party", e.target.value)}>
            <option value="">{t("no_party")}</option>
            {parties.map(p => <option key={p.party} value={p.party}>{nm({ name: `${p.kind_name}: ${p.name}`, name_ar: `${p.kind_name_ar}: ${p.name_ar}` })}</option>)}
          </select>
          <input className="border rounded px-2 py-1 w-40" placeholder={t("memo")} value={l.memo} onChange={e => set(i, "memo", e.target.value)} />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button className="px-3 py-1 rounded border" onClick={() => setLines([...lines, { account_id: "", branch_id: "", debit: "", credit: "", memo: "", party: "" }])}>{t("add_line")}</button>
        <span className={`text-sm ${Math.abs(dr - cr) < 0.0005 && dr > 0 ? "text-emerald-700" : "text-red-700"}`}>{t("debit")} {fmt(dr)} / {t("credit")} {fmt(cr)}</span>
        <button className="px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50" disabled={!desc || dr <= 0 || Math.abs(dr - cr) > 0.0005} onClick={submit}>{t("post")}</button>
        <button className="px-3 py-1 rounded border" onClick={done}>{t("cancel")}</button>
        {err && <span className="text-sm text-red-700">{err}</span>}
      </div>
    </div>
  );
}

function TrialTab({ q, t, nm }: { q: string; t: T; nm: NM }) {
  const [d, setD] = useState<{ rows: TBRow[]; totals: Record<string, number>; balanced: boolean } | null>(null);
  useEffect(() => { apiGet(`/api/accounting/trial-balance?${q}`).then(setD).catch(() => undefined); }, [q]);
  if (!d) return null;
  return (
    <div className="space-y-2">
      <div className="flex justify-between"><span className={d.balanced ? "text-emerald-700" : "text-red-700 font-bold"}>{d.balanced ? t("balanced") : t("not_balanced")}</span><Toolbar excel={`/api/accounting/export/trial-balance?${q}`} filename="Trial_Balance.xlsx" /></div>
      <table className="w-full text-sm border-collapse">
        <thead><tr><th className={th}>{t("code")}</th><th className={th}>{t("account")}</th><th className={th}>{t("opening")} {t("debit")}</th><th className={th}>{t("opening")} {t("credit")}</th><th className={th}>{t("debit")}</th><th className={th}>{t("credit")}</th><th className={th}>{t("closing")} {t("debit")}</th><th className={th}>{t("closing")} {t("credit")}</th></tr></thead>
        <tbody>
          {d.rows.map(r => <tr key={r.account_id}><td className={td}>{r.code}</td><td className={td}>{nm(r)}</td><td className={num}>{fmt(r.opening_dr)}</td><td className={num}>{fmt(r.opening_cr)}</td><td className={num}>{fmt(r.debit)}</td><td className={num}>{fmt(r.credit)}</td><td className={num}>{fmt(r.closing_dr)}</td><td className={num}>{fmt(r.closing_cr)}</td></tr>)}
          <tr className="font-bold"><td className={td} colSpan={2}>{t("total")}</td>{["opening_dr", "opening_cr", "debit", "credit", "closing_dr", "closing_cr"].map(k => <td key={k} className={num}>{fmt(d.totals[k])}</td>)}</tr>
        </tbody>
      </table>
    </div>
  );
}

function LedgerTab({ brandId, from, to, branchId, lang, postable, t, nm, branchName }: { brandId: number; from: string; to: string; branchId: string; lang: string; postable: Account[]; t: T; nm: NM; branchName: (id: number | null) => string }) {
  const [acc, setAcc] = useState("");
  const [d, setD] = useState<{ opening: number; closing: number; debit: number; credit: number; rows: { journal_id: number; number: number; date: string; description: string; branch_id: number | null; debit: number; credit: number; balance: number }[] } | null>(null);
  const p = new URLSearchParams({ brand_id: String(brandId), account_id: acc, date_from: from, date_to: to, lang });
  if (branchId) p.set("branch_id", branchId);
  const q = p.toString();
  useEffect(() => { if (acc) apiGet(`/api/accounting/ledger?${q}`).then(setD).catch(() => undefined); }, [q, acc]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-between gap-2">
        <select className="border rounded px-2 py-1 min-w-[300px] print:hidden" value={acc} onChange={e => setAcc(e.target.value)}>
          <option value="">{t("choose_account")}</option>
          {postable.map(a => <option key={a.id} value={a.id}>{a.code} {nm(a)}</option>)}
        </select>
        {acc && <Toolbar excel={`/api/accounting/export/ledger?${q}`} filename="Account_Ledger.xlsx" />}
      </div>
      {acc && d && (
        <table className="w-full text-sm border-collapse">
          <thead><tr><th className={th}>{t("date")}</th><th className={th}>{t("no")}</th><th className={th}>{t("description")}</th><th className={th}>{t("branch")}</th><th className={th}>{t("debit")}</th><th className={th}>{t("credit")}</th><th className={th}>{t("balance_col")}</th></tr></thead>
          <tbody>
            <tr className="italic"><td className={td} colSpan={6}>{t("opening")}</td><td className={num}>{fmt(d.opening)}</td></tr>
            {d.rows.map((r, i) => <tr key={i}><td className={td}>{r.date}</td><td className={td}>{r.number}</td><td className={td}>{r.description}</td><td className={td}>{branchName(r.branch_id)}</td><td className={num}>{r.debit ? fmt(r.debit) : ""}</td><td className={num}>{r.credit ? fmt(r.credit) : ""}</td><td className={num}>{fmt(r.balance)}</td></tr>)}
            <tr className="font-bold"><td className={td} colSpan={4}>{t("total")}</td><td className={num}>{fmt(d.debit)}</td><td className={num}>{fmt(d.credit)}</td><td className={num}>{fmt(d.closing)}</td></tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function PartiesTab({ brandId, side, from, to, lang, t, nm, branchName }: { brandId: number; side: string; from: string; to: string; lang: string; t: T; nm: NM; branchName: (id: number | null) => string }) {
  const [d, setD] = useState<{ rows: PartyRow[]; total: number; matched: boolean; control: { account_id: number; code: string; name: string; name_ar: string | null; total: number; parties: number; unallocated: number }[] } | null>(null);
  const [party, setParty] = useState("");
  const [hideZero, setHideZero] = useState(true);
  const [search, setSearch] = useState("");
  const [pl, setPl] = useState<(PartyOpt & { opening: number; closing: number; debit: number; credit: number; rows: { journal_id: number; number: number; date: string; description: string; code: string; branch_id: number | null; debit: number; credit: number; balance: number }[] }) | null>(null);
  const lq = new URLSearchParams({ brand_id: String(brandId), side, as_of: to, lang }).toString();
  const pq = new URLSearchParams({ brand_id: String(brandId), party, date_from: from, date_to: to, lang }).toString();
  useEffect(() => { apiGet(`/api/accounting/parties?${lq}`).then(setD).catch(() => undefined); }, [lq]);
  useEffect(() => { if (party) apiGet(`/api/accounting/party-ledger?${pq}`).then(setPl).catch(() => undefined); }, [pq, party]);
  if (party && pl && pl.party === party) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap justify-between gap-2">
          <div><button className="px-3 py-1 rounded border print:hidden" onClick={() => setParty("")}>{t("back")}</button> <span className="font-semibold">{t("statement")}: {nm({ name: `${pl.kind_name}: ${pl.name}`, name_ar: `${pl.kind_name_ar}: ${pl.name_ar}` })}</span></div>
          <Toolbar excel={`/api/accounting/export/party-ledger?${pq}`} filename="Statement_of_Account.xlsx" />
        </div>
        <table className="w-full text-sm border-collapse">
          <thead><tr><th className={th}>{t("date")}</th><th className={th}>{t("no")}</th><th className={th}>{t("description")}</th><th className={th}>{t("account")}</th><th className={th}>{t("branch")}</th><th className={th}>{t("debit")}</th><th className={th}>{t("credit")}</th><th className={th}>{t("balance_col")}</th></tr></thead>
          <tbody>
            <tr className="italic"><td className={td} colSpan={7}>{t("opening")}</td><td className={num}>{fmt(pl.opening)}</td></tr>
            {pl.rows.map((r, i) => <tr key={i}><td className={td}>{r.date}</td><td className={td}>{r.number}</td><td className={td}>{r.description}</td><td className={td}>{r.code}</td><td className={td}>{branchName(r.branch_id)}</td><td className={num}>{r.debit ? fmt(r.debit) : ""}</td><td className={num}>{r.credit ? fmt(r.credit) : ""}</td><td className={num}>{fmt(r.balance)}</td></tr>)}
            <tr className="font-bold"><td className={td} colSpan={5}>{t("total")}</td><td className={num}>{fmt(pl.debit)}</td><td className={num}>{fmt(pl.credit)}</td><td className={num}>{fmt(pl.closing)}</td></tr>
          </tbody>
        </table>
      </div>
    );
  }
  if (!d) return null;
  const s = search.trim().toLowerCase();
  const rows = d.rows.filter(r => (!hideZero || Math.abs(r.balance) > 0.0005) && (!s || `${r.name} ${r.name_ar}`.toLowerCase().includes(s)));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <input className="border rounded px-2 py-1" placeholder={t("search")} value={search} onChange={e => setSearch(e.target.value)} />
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={hideZero} onChange={e => setHideZero(e.target.checked)} />{t("hide_zero")}</label>
          <span className="text-sm text-gray-600">{t("as_of")} {to}</span>
        </div>
        <Toolbar excel={`/api/accounting/export/parties?${lq}`} filename={side === "payable" ? "Payables.xlsx" : "Receivables.xlsx"} />
      </div>
      <table className="w-full text-sm border-collapse">
        <thead><tr><th className={th}>{t("type")}</th><th className={th}>{t("name")}</th><th className={th}>{t("accounts_col")}</th><th className={th}>{t("debit")}</th><th className={th}>{t("credit")}</th><th className={th}>{t("balance_col")}</th><th className={th}>{t("last_entry")}</th></tr></thead>
        <tbody>
          {rows.map(r => <tr key={r.party} className="cursor-pointer hover:bg-blue-50" onClick={() => setParty(r.party)}><td className={td}>{nm({ name: r.kind_name, name_ar: r.kind_name_ar })}</td><td className={`${td} text-blue-700 underline`}>{nm(r)}</td><td className={td}>{r.accounts.join(", ")}</td><td className={num}>{fmt(r.debit)}</td><td className={num}>{fmt(r.credit)}</td><td className={num}>{fmt(r.balance)}</td><td className={td}>{r.last_date}</td></tr>)}
          <tr className="font-bold"><td className={td} colSpan={5}>{t("total")}</td><td className={num}>{fmt(d.total)}</td><td className={td}></td></tr>
        </tbody>
      </table>
      <div className="mt-3">
        <div className={d.matched ? "text-emerald-700" : "text-red-700 font-bold"}>{t("control")}: {d.matched ? t("parties_ok") : t("parties_diff")}</div>
        <table className="w-full text-sm border-collapse mt-1">
          <thead><tr><th className={th}>{t("code")}</th><th className={th}>{t("account")}</th><th className={th}>{t("ledger_col")}</th><th className={th}>{t(side === "payable" ? "payables" : "receivables")}</th><th className={th}>{t("unallocated")}</th></tr></thead>
          <tbody>{d.control.map(c => <tr key={c.account_id}><td className={td}>{c.code}</td><td className={td}>{nm(c)}</td><td className={num}>{fmt(c.total)}</td><td className={num}>{fmt(c.parties)}</td><td className={`${num} ${Math.abs(c.unallocated) > 0.0005 ? "text-red-700 font-bold" : ""}`}>{fmt(c.unallocated)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function Groups({ groups, nm, t }: { groups: Group[]; nm: NM; t: T }) {
  return (
    <>
      {groups.map(g => (
        <tbody key={g.code}>
          <tr className="bg-gray-50 font-semibold"><td className={td} colSpan={2}>{nm(g)}</td></tr>
          {g.accounts.map(a => <tr key={a.account_id}><td className={td + " ps-6"}>{a.code} {nm(a)}</td><td className={num}>{fmt(a.amount)}</td></tr>)}
          <tr className="font-semibold"><td className={td}>{t("total")} {nm(g)}</td><td className={num}>{fmt(g.total)}</td></tr>
        </tbody>
      ))}
    </>
  );
}

function IncomeTab({ q, t, nm }: { q: string; t: T; nm: NM }) {
  const [d, setD] = useState<{ revenue: Group[]; expenses: Group[]; gross_profit: number; net_profit: number } | null>(null);
  useEffect(() => { apiGet(`/api/accounting/income-statement?${q}`).then(setD).catch(() => undefined); }, [q]);
  if (!d) return null;
  return (
    <div className="space-y-2 max-w-3xl">
      <div className="flex justify-end"><Toolbar excel={`/api/accounting/export/income-statement?${q}`} filename="Income_Statement.xlsx" /></div>
      <table className="w-full text-sm border-collapse">
        <thead><tr><th className={th}>{t("item")}</th><th className={th}>KWD</th></tr></thead>
        <Groups groups={d.revenue} nm={nm} t={t} />
        <Groups groups={d.expenses.filter(g => g.code === "5000")} nm={nm} t={t} />
        <tbody><tr className="font-bold bg-emerald-50"><td className={td}>{t("gross")}</td><td className={num}>{fmt(d.gross_profit)}</td></tr></tbody>
        <Groups groups={d.expenses.filter(g => g.code !== "5000")} nm={nm} t={t} />
        <tbody><tr className="font-bold bg-emerald-100"><td className={td}>{t("net")}</td><td className={num}>{fmt(d.net_profit)}</td></tr></tbody>
      </table>
    </div>
  );
}

function BalanceTab({ brandId, lang, t, nm }: { brandId: number; lang: string; t: T; nm: NM }) {
  const [asOf, setAsOf] = useState(today());
  const [d, setD] = useState<{ assets: Group[]; liabilities: Group[]; equity: Group[]; profit_to_date: number; total_assets: number; total_liabilities: number; total_equity: number; balanced: boolean } | null>(null);
  const q = `brand_id=${brandId}&as_of=${asOf}&lang=${lang}`;
  useEffect(() => { apiGet(`/api/accounting/balance-sheet?${q}`).then(setD).catch(() => undefined); }, [q]);
  return (
    <div className="space-y-2 max-w-3xl">
      <div className="flex justify-between">
        <label className="text-sm print:hidden">{t("as_of")} <input type="date" className="border rounded px-2 py-1" value={asOf} onChange={e => setAsOf(e.target.value)} /></label>
        <Toolbar excel={`/api/accounting/export/balance-sheet?${q}`} filename="Balance_Sheet.xlsx" />
      </div>
      {d && (
        <table className="w-full text-sm border-collapse">
          <thead><tr><th className={th}>{t("item")}</th><th className={th}>KWD</th></tr></thead>
          <Groups groups={d.assets} nm={nm} t={t} />
          <tbody><tr className="font-bold bg-blue-50"><td className={td}>{t("total")} {t("assets")}</td><td className={num}>{fmt(d.total_assets)}</td></tr></tbody>
          <Groups groups={d.liabilities} nm={nm} t={t} />
          <tbody><tr className="font-bold bg-blue-50"><td className={td}>{t("total")} {t("liabilities")}</td><td className={num}>{fmt(d.total_liabilities)}</td></tr></tbody>
          <Groups groups={d.equity} nm={nm} t={t} />
          <tbody>
            <tr><td className={td}>{t("profit_to_date")}</td><td className={num}>{fmt(d.profit_to_date)}</td></tr>
            <tr className="font-bold bg-blue-50"><td className={td}>{t("total_equity")}</td><td className={num}>{fmt(d.total_equity)}</td></tr>
            <tr className={d.balanced ? "text-emerald-700" : "text-red-700 font-bold"}><td className={td}>{d.balanced ? t("balanced") : t("not_balanced")}</td><td className={num}>{fmt(d.total_liabilities + d.total_equity)}</td></tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function ReconcileTab({ q, t, nm }: { q: string; t: T; nm: NM }) {
  const [d, setD] = useState<{ rows: { area: string; name: string; name_ar: string | null; system: number; ledger: number; difference: number }[]; all_matched: boolean; trial_balance_balanced: boolean } | null>(null);
  useEffect(() => { apiGet(`/api/accounting/reconciliation?${q}`).then(setD).catch(() => undefined); }, [q]);
  if (!d) return null;
  return (
    <div className="space-y-2">
      <div className="flex justify-between"><span className={d.all_matched ? "text-emerald-700 font-semibold" : "text-red-700 font-bold"}>{d.all_matched ? t("matched") : t("not_matched")}</span><Toolbar /></div>
      <table className="w-full text-sm border-collapse">
        <thead><tr><th className={th}>{t("item")}</th><th className={th}></th><th className={th}>{t("system")}</th><th className={th}>{t("ledger_col")}</th><th className={th}>{t("difference")}</th></tr></thead>
        <tbody>
          {d.rows.map((r, i) => <tr key={i} className={Math.abs(r.difference) >= 0.01 ? "bg-red-50" : ""}><td className={td}>{t("area_" + r.area)}</td><td className={td}>{nm(r)}</td><td className={num}>{fmt(r.system)}</td><td className={num}>{fmt(r.ledger)}</td><td className={num}>{fmt(r.difference)}</td></tr>)}
          <tr><td className={td} colSpan={4}>{t("trial")}</td><td className={td}>{d.trial_balance_balanced ? t("balanced") : t("not_balanced")}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function AccountsTab({ brandId, accounts, reload, t, nm }: { brandId: number; accounts: Account[]; reload: () => void; t: T; nm: NM }) {
  const [parent, setParent] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [err, setErr] = useState("");
  const add = async () => {
    const f = new FormData();
    f.append("brand_id", String(brandId)); f.append("parent_code", parent); f.append("code", code); f.append("name", name); f.append("name_ar", nameAr);
    try { await apiPost("/api/accounting/accounts", f); setCode(""); setName(""); setNameAr(""); setErr(""); reload(); } catch (e) { setErr(String((e as Error).message || e)); }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center print:hidden">
        <span className="text-sm font-semibold">{t("new_account")}:</span>
        <select className="border rounded px-2 py-1" value={parent} onChange={e => setParent(e.target.value)}>
          <option value="">{t("parent")}</option>{accounts.filter(a => a.is_header).map(a => <option key={a.id} value={a.code}>{a.code} {nm(a)}</option>)}
        </select>
        <input className="border rounded px-2 py-1 w-24" placeholder={t("code")} value={code} onChange={e => setCode(e.target.value)} />
        <input className="border rounded px-2 py-1" placeholder={t("name")} value={name} onChange={e => setName(e.target.value)} />
        <input className="border rounded px-2 py-1" placeholder={t("name_ar")} value={nameAr} onChange={e => setNameAr(e.target.value)} dir="rtl" />
        <button className="px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50" disabled={!parent || !code || !name} onClick={add}>{t("save")}</button>
        {err && <span className="text-sm text-red-700">{err}</span>}
        <Toolbar />
      </div>
      <table className="w-full text-sm border-collapse">
        <thead><tr><th className={th}>{t("code")}</th><th className={th}>{t("account")}</th><th className={th}>Type</th><th className={th}>IFRS</th><th className={th}>{t("balance_col")}</th></tr></thead>
        <tbody>
          {accounts.map(a => <tr key={a.id} className={a.is_header ? "font-semibold bg-gray-50" : ""}><td className={td}>{a.code}</td><td className={td + (a.is_header ? "" : " ps-6")}>{nm(a)}</td><td className={td}>{a.type}</td><td className={td + " text-xs"}>{a.concept}</td><td className={num}>{a.is_header ? "" : fmt(a.balance)}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

function MappingTab({ brandId, postable, t, nm }: { brandId: number; postable: Account[]; t: T; nm: NM }) {
  const [rows, setRows] = useState<Mapping[]>([]);
  const load = useCallback(() => { apiGet(`/api/accounting/mappings?brand_id=${brandId}`).then(setRows).catch(() => undefined); }, [brandId]);
  useEffect(() => { load(); }, [load]);
  const save = async (r: Mapping, accountId: string) => {
    const f = new FormData();
    f.append("brand_id", String(brandId)); f.append("kind", r.kind); f.append("ref_id", r.ref_id); f.append("account_id", accountId || "0");
    await apiPost("/api/accounting/mappings", f); load();
  };
  return (
    <div className="space-y-4">
      {["setting", "expense_category", "purchase_category"].map(kind => (
        <div key={kind}>
          <div className="font-semibold mb-1">{t("kind_" + kind)}</div>
          <table className="w-full text-sm border-collapse">
            <thead><tr><th className={th}>{t("item")}</th><th className={th}>{t("posts_to")}</th></tr></thead>
            <tbody>
              {rows.filter(r => r.kind === kind).map(r => (
                <tr key={r.kind + r.ref_id}>
                  <td className={td}>{nm(r)}</td>
                  <td className={td}>
                    <select className="border rounded px-2 py-1 w-full" value={r.mapped ? String(r.account_id) : ""} onChange={e => save(r, e.target.value)}>
                      <option value="">{r.code} {nm({ name: r.name, name_ar: r.name_ar })} {t("default")}</option>
                      {postable.map(a => <option key={a.id} value={a.id}>{a.code} {nm(a)}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
