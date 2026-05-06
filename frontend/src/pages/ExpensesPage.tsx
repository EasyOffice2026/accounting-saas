import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../contexts/api";
import { useAuth } from "../contexts/AuthContext";

interface Branch { id: number; name: string; }
interface Category { id: number; name: string; name_ar: string; }
interface Expense {
  id: number; branch_id: number; category_id: number; date: string;
  description: string; amount: number; payment_method: string;
}

export default function ExpensesPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    apiGet("/api/branches/").then(setBranches);
    apiGet("/api/expenses/categories").then(setCategories);
    apiGet("/api/expenses/").then(setExpenses);
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await apiPost("/api/expenses/", fd);
    setShowForm(false);
    apiGet("/api/expenses/").then(setExpenses);
  };

  const branchName = (id: number) => branches.find(b => b.id === id)?.name || "";
  const catName = (id: number) => {
    const c = categories.find(cat => cat.id === id);
    return c ? (i18n.language === "ar" ? c.name_ar || c.name : c.name) : "";
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-gray-800">{t("expenses")}</h2>
        <div className="flex gap-2">
          <button onClick={() => window.open("/api/export/expenses/csv", "_blank")}
            className="px-3 py-1.5 bg-green-600 text-white rounded text-xs hover:bg-green-700">
            {t("export_csv")}
          </button>
          <button onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm">
            {showForm ? t("cancel") : t("add_new")}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {user?.branch_id ? (
              <input type="hidden" name="branch_id" value={user.branch_id} />
            ) : (
              <div>
                <label className="block text-sm font-medium mb-1">{t("branch")}</label>
                <select name="branch_id" required className="w-full px-3 py-2 border rounded-lg text-sm">
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">{t("category")}</label>
              <select name="category_id" className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="">--</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("date")}</label>
              <input type="date" name="expense_date" required className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("amount")}</label>
              <input type="number" step="0.001" name="amount" required className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("description")}</label>
            <input name="description" required className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">{t("payment_type")}</label>
              <select name="payment_method" className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="cash">{t("cash")}</option>
                <option value="credit">{t("credit")}</option>
              </select>
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
                  📷 {t("take_picture")}
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
              <th className="px-4 py-3 text-left">{t("description")}</th>
              <th className="px-4 py-3 text-right">{t("amount")}</th>
              <th className="px-4 py-3 text-left">{t("payment_type")}</th>
            </tr>
          </thead>
          <tbody>
            {expenses.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
            ) : expenses.map(exp => (
              <tr key={exp.id} className="border-b hover:bg-gray-50">
                <td className="px-4 py-3">{exp.date}</td>
                <td className="px-4 py-3">{branchName(exp.branch_id)}</td>
                <td className="px-4 py-3">{catName(exp.category_id)}</td>
                <td className="px-4 py-3">{exp.description}</td>
                <td className="px-4 py-3 text-right font-mono">KD {exp.amount.toFixed(3)}</td>
                <td className="px-4 py-3">{t(exp.payment_method)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
