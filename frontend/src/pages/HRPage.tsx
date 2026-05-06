import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../contexts/api";

interface Branch { id: number; name: string; }
interface Employee {
  id: number; branch_id: number; name: string; name_ar: string;
  civil_id: string; position: string; phone: string; salary: number;
  join_date: string; is_active: boolean;
}

export default function HRPage() {
  const { t } = useTranslation();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    apiGet("/api/branches/").then(setBranches);
    apiGet("/api/hr/employees").then(setEmployees);
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await apiPost("/api/hr/employees", fd);
    setShowForm(false);
    apiGet("/api/hr/employees").then(setEmployees);
  };

  const branchName = (id: number) => branches.find(b => b.id === id)?.name || "";

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-gray-800">{t("hr")}</h2>
        <div className="flex gap-2">
          <button onClick={() => window.open("/api/export/hr/csv", "_blank")}
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
            <div>
              <label className="block text-sm font-medium mb-1">{t("branch")}</label>
              <select name="branch_id" required className="w-full px-3 py-2 border rounded-lg text-sm">
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("name")} (EN)</label>
              <input name="name" required className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("name")} (AR)</label>
              <input name="name_ar" className="w-full px-3 py-2 border rounded-lg text-sm" dir="rtl" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("civil_id")}</label>
              <input name="civil_id" pattern="\d{12}" maxLength={12} title={t("civil_id_validation")}
                placeholder="12 digits" className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("position")}</label>
              <input name="position" className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("phone")}</label>
              <input name="phone" pattern="\d{8}" maxLength={8} title={t("phone_validation")}
                placeholder="8 digits" className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("salary")}</label>
              <input type="number" step="0.001" name="salary" className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("join_date")}</label>
              <input type="date" name="join_date" className="w-full px-3 py-2 border rounded-lg text-sm" />
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
              <th className="px-4 py-3 text-left">{t("name")}</th>
              <th className="px-4 py-3 text-left">{t("branch")}</th>
              <th className="px-4 py-3 text-left">{t("position")}</th>
              <th className="px-4 py-3 text-left">{t("civil_id")}</th>
              <th className="px-4 py-3 text-left">{t("phone")}</th>
              <th className="px-4 py-3 text-right">{t("salary")}</th>
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
            ) : employees.map(emp => (
              <tr key={emp.id} className="border-b hover:bg-gray-50">
                <td className="px-4 py-3">{emp.name}</td>
                <td className="px-4 py-3">{branchName(emp.branch_id)}</td>
                <td className="px-4 py-3">{emp.position}</td>
                <td className="px-4 py-3">{emp.civil_id}</td>
                <td className="px-4 py-3">{emp.phone}</td>
                <td className="px-4 py-3 text-right font-mono">KD {emp.salary.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
