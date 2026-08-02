import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost, apiDownload, apiFetch } from "../contexts/api";
import { useAuth } from "../contexts/AuthContext";

interface Branch { id: number; name: string; name_ar?: string; }
interface Category { id: number; name: string; name_ar: string; }
interface Supplier { id: number; name: string; whatsapp?: string; whatsapp_group?: string; }
interface Expense {
  id: number; branch_id: number; category_id: number; date: string;
  description: string; amount: number; payment_method: string; supplier_id?: number;
  attachment_path?: string | null;
}
interface LedgerExpense {
  id: number; date: string; description: string; amount: number;
  payment_method: string; branch_name: string;
}
interface LedgerEntry {
  supplier_id: number; supplier_name: string;
  total_amount: number; total_cash: number; total_credit: number;
  expenses: LedgerExpense[];
}

type Tab = "expenses" | "ledger";

export default function ExpensesPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("expenses");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [expandedSupplier, setExpandedSupplier] = useState<number | null>(null);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [showCatMgr, setShowCatMgr] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatNameAr, setNewCatNameAr] = useState("");

  const isManager = user?.role === "owner" || user?.role === "manager" || user?.role === "accountant";

  const loadCategories = () => apiGet("/api/expenses/categories").then(setCategories);

  useEffect(() => {
    apiGet("/api/branches/").then(setBranches);
    loadCategories();
    apiGet("/api/expenses/").then(setExpenses);
    apiGet("/api/purchases/suppliers").then(setSuppliers);
  }, []);

  useEffect(() => {
    if (tab === "ledger") apiGet("/api/expenses/supplier-ledger").then(setLedger);
  }, [tab]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!window.confirm(t("confirm_transaction"))) return;
    const fd = new FormData(e.currentTarget);
    if (editingExpense) {
      await apiFetch(`/api/expenses/${editingExpense.id}`, { method: "PUT", body: fd });
      setEditingExpense(null);
    } else {
      await apiPost("/api/expenses/", fd);
    }
    setShowForm(false);
    apiGet("/api/expenses/").then(setExpenses);
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t("confirm_delete"))) return;
    await apiFetch(`/api/expenses/${id}`, { method: "DELETE" });
    apiGet("/api/expenses/").then(setExpenses);
  };

  const handlePrint = (exp: Expense) => {
    apiDownload(`/api/export/expense/${exp.id}/pdf`, `expense-${exp.id}.pdf`);
  };

  const handleWhatsApp = async (exp: Expense) => {
    const s = suppliers.find(su => su.id === exp.supplier_id);
    if (!s?.whatsapp && !s?.whatsapp_group) { alert(t("no_whatsapp") || "No WhatsApp group or number"); return; }
    try {
      const fd = new FormData();
      fd.append("expense_id", String(exp.id));
      const res = await fetch("/api/whatsapp/send-expense", {
        method: "POST", body: fd,
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.detail || "Failed to send");
        return;
      }
      alert(t("whatsapp_sent") || "Sent successfully!");
    } catch {
      alert("Failed to send via Green API. Check Settings → WhatsApp Integration.");
    }
  };

  const branchName = (id: number) => { const b = branches.find(x => x.id === id); return b ? (i18n.language === "ar" ? (b.name_ar || b.name) : b.name) : ""; };
  const catName = (id: number) => {
    const c = categories.find(cat => cat.id === id);
    return c ? (i18n.language === "ar" ? c.name_ar || c.name : c.name) : "";
  };
  const supplierName = (id?: number) => id ? suppliers.find(s => s.id === id)?.name || "" : "";

  const addCategory = async () => {
    if (!newCatName.trim()) return;
    const fd = new FormData();
    fd.append("name", newCatName.trim());
    fd.append("name_ar", newCatNameAr.trim());
    const res = await apiFetch("/api/expenses/categories", { method: "POST", body: fd });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.detail || "Error"); return; }
    setNewCatName(""); setNewCatNameAr("");
    loadCategories();
  };

  const deleteCategory = async (id: number) => {
    if (!confirm(t("confirm_delete"))) return;
    const res = await apiFetch(`/api/expenses/categories/${id}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.detail || "Error"); return; }
    loadCategories();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-gray-800">{t("expenses")}</h2>
        {tab === "expenses" && (
          <div className="flex gap-2">
            <button onClick={() => apiDownload("/api/export/expenses/csv", "expenses.csv")}
              className="px-3 py-1.5 bg-green-600 text-white rounded text-xs hover:bg-green-700">
              {t("export_csv")}
            </button>
            <button onClick={() => apiDownload("/api/export/expenses/excel", "expenses.xlsx")}
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">
              {t("export_excel")}
            </button>
            <button onClick={() => apiDownload("/api/export/expenses/pdf", "expenses.pdf")}
              className="px-3 py-1.5 bg-red-600 text-white rounded text-xs hover:bg-red-700">
              {t("export_pdf")}
            </button>
            <button onClick={() => { setShowForm(!showForm); setEditingExpense(null); }}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm">
              {showForm ? t("cancel") : t("add_new")}
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {(["expenses", "ledger"] as Tab[]).map(tb => (
          <button key={tb} onClick={() => setTab(tb)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              tab === tb ? "bg-white shadow text-emerald-700" : "text-gray-500 hover:text-gray-700"
            }`}>
            {tb === "expenses" ? t("expenses") : t("expense_ledger")}
          </button>
        ))}
      </div>

      {tab === "expenses" && (
        <>
          {(showForm || editingExpense) && (
            <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-6 space-y-4">
              <h3 className="font-semibold">{editingExpense ? t("edit") : t("add_new")}</h3>
              <div className="grid grid-cols-2 gap-4">
                {user?.branch_id ? (
                  <input type="hidden" name="branch_id" value={user.branch_id} />
                ) : (
                  <div>
                    <label className="block text-sm font-medium mb-1">{t("branch")}</label>
                    <select name="branch_id" required defaultValue={editingExpense?.branch_id || ""} className="w-full px-3 py-2 border rounded-lg text-sm">
                      {branches.map(b => <option key={b.id} value={b.id}>{i18n.language === "ar" ? (b.name_ar || b.name) : b.name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-medium">{t("category")}</label>
                    {isManager && (
                      <button type="button" onClick={() => setShowCatMgr(true)}
                        className="text-xs text-emerald-600 hover:underline">
                        + {t("manage_categories")}
                      </button>
                    )}
                  </div>
                  <select name="category_id" defaultValue={editingExpense?.category_id || ""} className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="">--</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{i18n.language === "ar" ? (c.name_ar || c.name) : c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("supplier")}</label>
                  <select name="supplier_id" defaultValue={editingExpense?.supplier_id || ""} className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="">-- {t("no_supplier")} --</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("date")}</label>
                  <input type="date" name="expense_date" required defaultValue={editingExpense?.date || ""} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("amount")}</label>
                  <input type="number" step="0.001" name="amount" required defaultValue={editingExpense?.amount || ""} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("payment_type")}</label>
                  <select name="payment_method" defaultValue={editingExpense?.payment_method || "cash"} className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="cash">{t("cash")}</option>
                    <option value="credit">{t("credit")}</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("description")}</label>
                <input name="description" required className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t("notes")}</label>
                  <input name="notes" className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("attachment")}</label>
                  <div className="flex gap-2">
                    <input type="file" name="attachment" accept="image/*,.pdf" className="text-sm" />
                    <button type="button" onClick={() => {
                      const inp = document.createElement("input");
                      inp.type = "file"; inp.accept = "image/*"; inp.capture = "environment";
                      inp.onchange = () => {
                        const f = inp.files?.[0];
                        if (f) {
                          const dt = new DataTransfer(); dt.items.add(f);
                          const target = document.querySelector('input[name="attachment"]') as HTMLInputElement;
                          if (target) target.files = dt.files;
                        }
                      };
                      inp.click();
                    }} className="px-3 py-1.5 bg-blue-500 text-white rounded text-xs hover:bg-blue-600 whitespace-nowrap">
                      {t("take_picture")}
                    </button>
                  </div>
                </div>
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
                  <th className="px-4 py-3 text-left">{t("category")}</th>
                  <th className="px-4 py-3 text-left">{t("supplier")}</th>
                  <th className="px-4 py-3 text-left">{t("description")}</th>
                  <th className="px-4 py-3 text-right">{t("amount")}</th>
                  <th className="px-4 py-3 text-left">{t("payment_type")}</th>
                  <th className="px-4 py-3 text-center">{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
                ) : expenses.map(exp => (
                  <tr key={exp.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3">{exp.date}</td>
                    <td className="px-4 py-3">{branchName(exp.branch_id)}</td>
                    <td className="px-4 py-3">{catName(exp.category_id)}</td>
                    <td className="px-4 py-3">{supplierName(exp.supplier_id)}</td>
                    <td className="px-4 py-3">{exp.description}</td>
                    <td className="px-4 py-3 text-right font-mono">KD {exp.amount.toFixed(3)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        exp.payment_method === "cash" ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"
                      }`}>
                        {t(exp.payment_method)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex gap-1 justify-center flex-wrap">
                        <button onClick={() => { setEditingExpense(exp); setShowForm(false); }}
                          className="px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">{t("edit")}</button>
                        <button onClick={() => handlePrint(exp)}
                          className="px-2 py-1 bg-orange-500 text-white rounded text-xs hover:bg-orange-600">{t("print")}</button>
                        {isManager && (
                          <button onClick={() => handleDelete(exp.id)}
                            className="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">{t("delete")}</button>
                        )}
                        <button onClick={() => handleWhatsApp(exp)}
                          className="px-2 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600">WhatsApp</button>
                        {exp.attachment_path && (
                          <a href={`/uploads/${exp.attachment_path}`} target="_blank" rel="noopener noreferrer"
                            className="px-2 py-1 bg-gray-600 text-white rounded text-xs hover:bg-gray-700">{t("attachment")}</a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "ledger" && (
        <div className="space-y-4">
          <div className="mb-2">
            <input type="text" value={ledgerSearch} onChange={e => setLedgerSearch(e.target.value)}
              placeholder={`🔍 ${t("search")} ${t("supplier")}...`}
              className="px-4 py-2 border rounded-lg text-sm w-full max-w-md" />
          </div>
          {ledger.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-400">
              {t("no_expense_ledger")}
            </div>
          ) : ledger.filter(e => !ledgerSearch || e.supplier_name.toLowerCase().includes(ledgerSearch.toLowerCase())).map(entry => (
            <div key={entry.supplier_id} className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <button onClick={() => setExpandedSupplier(expandedSupplier === entry.supplier_id ? null : entry.supplier_id)}
                className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-700 font-bold">
                    {entry.supplier_name[0]}
                  </div>
                  <div className="text-left">
                    <div className="font-semibold text-gray-800">{entry.supplier_name}</div>
                    <div className="text-xs text-gray-500">{entry.expenses.length} {t("transactions")}</div>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-right">
                    <div className="text-gray-500">{t("total")}</div>
                    <div className="font-bold text-gray-800">KD {entry.total_amount.toFixed(3)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-gray-500">{t("cash")}</div>
                    <div className="font-bold text-green-600">KD {entry.total_cash.toFixed(3)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-gray-500">{t("credit")}</div>
                    <div className="font-bold text-orange-600">KD {entry.total_credit.toFixed(3)}</div>
                  </div>
                  <span className="text-gray-400">{expandedSupplier === entry.supplier_id ? "▲" : "▼"}</span>
                </div>
              </button>

              {expandedSupplier === entry.supplier_id && (
                <div className="border-t">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left">{t("date")}</th>
                        <th className="px-4 py-2 text-left">{t("branch")}</th>
                        <th className="px-4 py-2 text-left">{t("description")}</th>
                        <th className="px-4 py-2 text-right">{t("amount")}</th>
                        <th className="px-4 py-2 text-left">{t("payment_type")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entry.expenses.map(exp => (
                        <tr key={exp.id} className="border-t hover:bg-gray-50">
                          <td className="px-4 py-2">{exp.date}</td>
                          <td className="px-4 py-2">{exp.branch_name}</td>
                          <td className="px-4 py-2">{exp.description}</td>
                          <td className="px-4 py-2 text-right font-mono">KD {exp.amount.toFixed(3)}</td>
                          <td className="px-4 py-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              exp.payment_method === "cash" ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"
                            }`}>
                              {t(exp.payment_method)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCatMgr && (
        <div className="fixed inset-0 bg-black/40 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto"
          onClick={() => setShowCatMgr(false)}>
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md p-6 max-h-[90vh] overflow-y-auto my-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">{t("manage_categories")}</h3>
              <button type="button" onClick={() => setShowCatMgr(false)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input value={newCatName} onChange={e => setNewCatName(e.target.value)}
                placeholder={`${t("name")} (EN)`} className="px-3 py-2 border rounded-lg text-sm" />
              <input value={newCatNameAr} onChange={e => setNewCatNameAr(e.target.value)}
                placeholder={`${t("name")} (AR)`} dir="rtl" className="px-3 py-2 border rounded-lg text-sm" />
            </div>
            <button type="button" onClick={addCategory}
              className="w-full px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm mb-4">
              {t("add")}
            </button>
            <div className="border rounded-lg divide-y max-h-72 overflow-y-auto">
              {categories.length === 0 ? (
                <div className="px-3 py-3 text-sm text-gray-400 text-center">{t("no_data")}</div>
              ) : categories.map(c => (
                <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>{c.name}{c.name_ar ? <span className="text-gray-400" dir="rtl"> — {c.name_ar}</span> : null}</span>
                  <button type="button" onClick={() => deleteCategory(c.id)}
                    className="text-red-600 hover:underline text-xs">{t("delete")}</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
