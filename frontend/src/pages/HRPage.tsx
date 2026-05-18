import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost, apiFetch } from "../contexts/api";

interface Branch { id: number; name: string; }
interface Employee {
  id: number; branch_id: number; name: string; name_ar: string;
  civil_id: string; position: string; phone: string; salary: number;
  join_date: string; is_active: boolean;
}
interface SalaryRecord {
  id: number; employee_id: number; branch_id: number; month: string;
  basic_salary: number; total_days: number; days_worked: number;
  housing_allowance: number; transport_allowance: number;
  food_allowance: number; other_allowance: number; allowances: number;
  absence_deduction: number; late_deduction: number;
  other_deduction: number; deductions: number;
  advance: number; net_salary: number; payment_method: string;
  status: string; notes: string | null; paid_date: string | null;
}

export default function HRPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"employees" | "salary">("employees");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showForm, setShowForm] = useState(false);

  // Salary state
  const [salaryRecords, setSalaryRecords] = useState<SalaryRecord[]>([]);
  const [salaryMonth, setSalaryMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [salaryMsg, setSalaryMsg] = useState("");
  const [salaryMsgType, setSalaryMsgType] = useState<"success" | "error">("success");
  const [editingRecord, setEditingRecord] = useState<SalaryRecord | null>(null);

  // Edit fields
  const [editBasicSalary, setEditBasicSalary] = useState("0");
  const [editTotalDays, setEditTotalDays] = useState("30");
  const [editDaysWorked, setEditDaysWorked] = useState("30");
  const [editHousing, setEditHousing] = useState("0");
  const [editTransport, setEditTransport] = useState("0");
  const [editFood, setEditFood] = useState("0");
  const [editOtherAllow, setEditOtherAllow] = useState("0");
  const [editAbsence, setEditAbsence] = useState("0");
  const [editLate, setEditLate] = useState("0");
  const [editOtherDed, setEditOtherDed] = useState("0");
  const [editAdvance, setEditAdvance] = useState("0");
  const [editMethod, setEditMethod] = useState("cash");
  const [editNotes, setEditNotes] = useState("");

  const currentUser = JSON.parse(localStorage.getItem("user") || "{}");
  const isManager = currentUser.role === "owner" || currentUser.role === "manager";

  useEffect(() => {
    apiGet("/api/branches/").then(setBranches);
    apiGet("/api/hr/employees").then(setEmployees);
  }, []);

  useEffect(() => {
    if (tab === "salary") loadSalary();
  }, [tab, salaryMonth]);

  const loadSalary = () => {
    apiGet(`/api/hr/salary?month=${salaryMonth}`).then((data) => {
      if (Array.isArray(data)) setSalaryRecords(data);
    });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await apiPost("/api/hr/employees", fd);
    setShowForm(false);
    apiGet("/api/hr/employees").then(setEmployees);
  };

  const branchName = (id: number) => branches.find(b => b.id === id)?.name || "";
  const empName = (id: number) => employees.find(e => e.id === id)?.name || "-";

  const showSalaryMsg = (text: string, type: "success" | "error") => {
    setSalaryMsg(text);
    setSalaryMsgType(type);
    setTimeout(() => setSalaryMsg(""), 5000);
  };

  const handleGeneratePayroll = async () => {
    const fd = new URLSearchParams();
    fd.append("month", salaryMonth);
    try {
      const res = await apiFetch("/api/hr/salary/generate", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Error");
      showSalaryMsg(t("payroll_generated"), "success");
      loadSalary();
    } catch (err: unknown) {
      showSalaryMsg((err as Error).message, "error");
    }
  };

  const handleEditSalary = (r: SalaryRecord) => {
    setEditingRecord(r);
    setEditBasicSalary(String(r.basic_salary));
    setEditTotalDays(String(r.total_days));
    setEditDaysWorked(String(r.days_worked));
    setEditHousing(String(r.housing_allowance));
    setEditTransport(String(r.transport_allowance));
    setEditFood(String(r.food_allowance));
    setEditOtherAllow(String(r.other_allowance));
    setEditAbsence(String(r.absence_deduction));
    setEditLate(String(r.late_deduction));
    setEditOtherDed(String(r.other_deduction));
    setEditAdvance(String(r.advance));
    setEditMethod(r.payment_method);
    setEditNotes(r.notes || "");
  };

  const calcNet = () => {
    const basic = Number(editBasicSalary);
    const tDays = Number(editTotalDays) || 30;
    const dWorked = Number(editDaysWorked);
    const perDay = basic / tDays;
    const earned = perDay * dWorked;
    const totalAllow = Number(editHousing) + Number(editTransport) + Number(editFood) + Number(editOtherAllow);
    const totalDed = Number(editAbsence) + Number(editLate) + Number(editOtherDed);
    return earned + totalAllow - totalDed - Number(editAdvance);
  };

  const calcDailyRate = () => {
    return Number(editBasicSalary) / (Number(editTotalDays) || 30);
  };

  const handleSaveSalary = async () => {
    if (!editingRecord) return;
    const fd = new URLSearchParams();
    fd.append("basic_salary", editBasicSalary);
    fd.append("total_days", editTotalDays);
    fd.append("days_worked", editDaysWorked);
    fd.append("housing_allowance", editHousing);
    fd.append("transport_allowance", editTransport);
    fd.append("food_allowance", editFood);
    fd.append("other_allowance", editOtherAllow);
    fd.append("absence_deduction", editAbsence);
    fd.append("late_deduction", editLate);
    fd.append("other_deduction", editOtherDed);
    fd.append("advance", editAdvance);
    fd.append("payment_method", editMethod);
    fd.append("notes", editNotes);
    try {
      const res = await apiFetch(`/api/hr/salary/${editingRecord.id}`, { method: "PUT", body: fd });
      if (!res.ok) throw new Error("Error");
      showSalaryMsg(t("salary_updated"), "success");
      setEditingRecord(null);
      loadSalary();
    } catch (err: unknown) {
      showSalaryMsg((err as Error).message, "error");
    }
  };

  const handleMarkPaid = async (id: number) => {
    try {
      const res = await apiFetch(`/api/hr/salary/${id}/pay`, { method: "POST" });
      if (!res.ok) throw new Error("Error");
      showSalaryMsg(t("salary_marked_paid"), "success");
      loadSalary();
    } catch (err: unknown) {
      showSalaryMsg((err as Error).message, "error");
    }
  };

  const totalPayroll = salaryRecords.reduce((s, r) => s + r.net_salary, 0);
  const totalPaid = salaryRecords.filter(r => r.status === "paid").reduce((s, r) => s + r.net_salary, 0);
  const totalPending = salaryRecords.filter(r => r.status === "pending").reduce((s, r) => s + r.net_salary, 0);

  const recDailyRate = (r: SalaryRecord) => r.basic_salary / (r.total_days || 30);
  const recEarned = (r: SalaryRecord) => recDailyRate(r) * r.days_worked;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-gray-800">{t("hr")}</h2>
        <div className="flex gap-2">
          <button onClick={() => window.open("/api/export/hr/csv", "_blank")}
            className="px-3 py-1.5 bg-green-600 text-white rounded text-xs hover:bg-green-700">
            {t("export_csv")}
          </button>
          {tab === "employees" && (
            <button onClick={() => setShowForm(!showForm)}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm">
              {showForm ? t("cancel") : t("add_new")}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg w-fit">
        <button onClick={() => setTab("employees")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            tab === "employees" ? "bg-white shadow text-emerald-700" : "text-gray-600 hover:text-gray-800"
          }`}>{t("employees")}</button>
        <button onClick={() => setTab("salary")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            tab === "salary" ? "bg-white shadow text-emerald-700" : "text-gray-600 hover:text-gray-800"
          }`}>{t("salary_management")}</button>
      </div>

      {/* Employees Tab */}
      {tab === "employees" && (
        <>
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
        </>
      )}

      {/* Salary Management Tab */}
      {tab === "salary" && (
        <div>
          {/* Controls */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t("select_month")}</label>
              <input type="month" value={salaryMonth} onChange={e => setSalaryMonth(e.target.value)}
                className="px-3 py-2 border rounded-lg text-sm" />
            </div>
            {isManager && (
              <button onClick={handleGeneratePayroll}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm mt-5">
                {t("generate_payroll")}
              </button>
            )}
          </div>

          {salaryMsg && (
            <div className={`p-3 rounded mb-4 text-sm ${
              salaryMsgType === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}>{salaryMsg}</div>
          )}

          {/* Summary Cards */}
          {salaryRecords.length > 0 && (
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-blue-50 p-4 rounded-xl border border-blue-200">
                <p className="text-xs text-blue-600 font-medium">{t("total_payroll")}</p>
                <p className="text-xl font-bold text-blue-800">KD {totalPayroll.toFixed(3)}</p>
              </div>
              <div className="bg-green-50 p-4 rounded-xl border border-green-200">
                <p className="text-xs text-green-600 font-medium">{t("total_paid")}</p>
                <p className="text-xl font-bold text-green-800">KD {totalPaid.toFixed(3)}</p>
              </div>
              <div className="bg-amber-50 p-4 rounded-xl border border-amber-200">
                <p className="text-xs text-amber-600 font-medium">{t("total_pending")}</p>
                <p className="text-xl font-bold text-amber-800">KD {totalPending.toFixed(3)}</p>
              </div>
            </div>
          )}

          {/* Edit Modal */}
          {editingRecord && (
            <div className="bg-gray-50 p-5 rounded-xl border mb-4 space-y-4">
              <h4 className="font-semibold text-sm text-gray-800">{t("edit")} — {empName(editingRecord.employee_id)} ({editingRecord.month})</h4>

              {/* Salary & Days Section */}
              <div>
                <h5 className="text-xs font-semibold text-gray-500 uppercase mb-2">{t("salary_details")}</h5>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("basic_salary")}</label>
                    <input type="number" step="0.001" value={editBasicSalary}
                      onChange={e => setEditBasicSalary(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("total_days")}</label>
                    <input type="number" min="1" max="31" value={editTotalDays}
                      onChange={e => setEditTotalDays(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("days_worked")}</label>
                    <input type="number" min="0" max="31" value={editDaysWorked}
                      onChange={e => setEditDaysWorked(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("daily_rate")}</label>
                    <input disabled value={`KD ${calcDailyRate().toFixed(3)}`}
                      className="w-full px-3 py-2 border rounded-lg text-sm bg-gray-100" />
                  </div>
                </div>
              </div>

              {/* Allowances Section */}
              <div>
                <h5 className="text-xs font-semibold text-green-600 uppercase mb-2">{t("allowance_details")}</h5>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("housing_allowance")}</label>
                    <input type="number" step="0.001" value={editHousing}
                      onChange={e => setEditHousing(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("transport_allowance")}</label>
                    <input type="number" step="0.001" value={editTransport}
                      onChange={e => setEditTransport(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("food_allowance")}</label>
                    <input type="number" step="0.001" value={editFood}
                      onChange={e => setEditFood(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("other_allowance")}</label>
                    <input type="number" step="0.001" value={editOtherAllow}
                      onChange={e => setEditOtherAllow(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                </div>
              </div>

              {/* Deductions Section */}
              <div>
                <h5 className="text-xs font-semibold text-red-600 uppercase mb-2">{t("deduction_details")}</h5>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("absence_deduction")}</label>
                    <input type="number" step="0.001" value={editAbsence}
                      onChange={e => setEditAbsence(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("late_deduction")}</label>
                    <input type="number" step="0.001" value={editLate}
                      onChange={e => setEditLate(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("other_deduction")}</label>
                    <input type="number" step="0.001" value={editOtherDed}
                      onChange={e => setEditOtherDed(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("advance")}</label>
                    <input type="number" step="0.001" value={editAdvance}
                      onChange={e => setEditAdvance(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                </div>
              </div>

              {/* Payment & Notes */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">{t("payment_method")}</label>
                  <select value={editMethod} onChange={e => setEditMethod(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="cash">{t("cash")}</option>
                    <option value="bank_transfer">{t("bank_transfer")}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">{t("notes")}</label>
                  <input value={editNotes} onChange={e => setEditNotes(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>

              {/* Net Salary Calculation Display */}
              <div className="bg-white p-3 rounded-lg border text-sm space-y-1">
                <div className="flex justify-between">
                  <span>{t("earned_basic")} ({t("daily_rate")} {calcDailyRate().toFixed(3)} × {editDaysWorked} {t("days_worked").toLowerCase()})</span>
                  <span className="font-mono">KD {(calcDailyRate() * Number(editDaysWorked)).toFixed(3)}</span>
                </div>
                <div className="flex justify-between text-green-600">
                  <span>+ {t("allowances")} ({t("housing_allowance")}: {Number(editHousing).toFixed(3)} + {t("transport_allowance")}: {Number(editTransport).toFixed(3)} + {t("food_allowance")}: {Number(editFood).toFixed(3)} + {t("other_allowance")}: {Number(editOtherAllow).toFixed(3)})</span>
                  <span className="font-mono">+{(Number(editHousing) + Number(editTransport) + Number(editFood) + Number(editOtherAllow)).toFixed(3)}</span>
                </div>
                <div className="flex justify-between text-red-600">
                  <span>- {t("deductions")} ({t("absence_deduction")}: {Number(editAbsence).toFixed(3)} + {t("late_deduction")}: {Number(editLate).toFixed(3)} + {t("other_deduction")}: {Number(editOtherDed).toFixed(3)})</span>
                  <span className="font-mono">-{(Number(editAbsence) + Number(editLate) + Number(editOtherDed)).toFixed(3)}</span>
                </div>
                <div className="flex justify-between text-orange-600">
                  <span>- {t("advance")}</span>
                  <span className="font-mono">-{Number(editAdvance).toFixed(3)}</span>
                </div>
                <div className="border-t pt-1 flex justify-between font-bold text-base">
                  <span>{t("net_salary")}</span>
                  <span className="font-mono">KD {calcNet().toFixed(3)}</span>
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={handleSaveSalary}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
                  {t("save")}
                </button>
                <button onClick={() => setEditingRecord(null)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm">
                  {t("cancel")}
                </button>
              </div>
            </div>
          )}

          {/* Salary Table */}
          <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-2 py-3 text-left">{t("employee")}</th>
                  <th className="px-2 py-3 text-left">{t("branch")}</th>
                  <th className="px-2 py-3 text-right">{t("basic_salary")}</th>
                  <th className="px-2 py-3 text-center">{t("days_worked")}</th>
                  <th className="px-2 py-3 text-right">{t("daily_rate")}</th>
                  <th className="px-2 py-3 text-right">{t("earned_basic")}</th>
                  <th className="px-2 py-3 text-right text-green-600">{t("allowances")}</th>
                  <th className="px-2 py-3 text-right text-red-600">{t("deductions")}</th>
                  <th className="px-2 py-3 text-right text-orange-600">{t("advance")}</th>
                  <th className="px-2 py-3 text-right font-bold">{t("net_salary")}</th>
                  <th className="px-2 py-3 text-left">{t("status")}</th>
                  {isManager && <th className="px-2 py-3 text-left">{t("actions")}</th>}
                </tr>
              </thead>
              <tbody>
                {salaryRecords.length === 0 ? (
                  <tr><td colSpan={isManager ? 12 : 11} className="px-4 py-8 text-center text-gray-400">
                    {t("no_data")} — {t("generate_payroll")}
                  </td></tr>
                ) : salaryRecords.map(r => (
                  <tr key={r.id} className="border-b hover:bg-gray-50">
                    <td className="px-2 py-3 font-medium">{empName(r.employee_id)}</td>
                    <td className="px-2 py-3">{branchName(r.branch_id)}</td>
                    <td className="px-2 py-3 text-right font-mono">{r.basic_salary.toFixed(3)}</td>
                    <td className="px-2 py-3 text-center">
                      <span className={r.days_worked < r.total_days ? "text-orange-600 font-semibold" : ""}>
                        {r.days_worked}/{r.total_days}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-right font-mono text-gray-500">{recDailyRate(r).toFixed(3)}</td>
                    <td className="px-2 py-3 text-right font-mono">{recEarned(r).toFixed(3)}</td>
                    <td className="px-2 py-3 text-right font-mono text-green-600">
                      {r.allowances > 0 ? `+${r.allowances.toFixed(3)}` : "-"}
                    </td>
                    <td className="px-2 py-3 text-right font-mono text-red-600">
                      {r.deductions > 0 ? `-${r.deductions.toFixed(3)}` : "-"}
                    </td>
                    <td className="px-2 py-3 text-right font-mono text-orange-600">
                      {r.advance > 0 ? `-${r.advance.toFixed(3)}` : "-"}
                    </td>
                    <td className="px-2 py-3 text-right font-mono font-bold">{r.net_salary.toFixed(3)}</td>
                    <td className="px-2 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        r.status === "paid" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                      }`}>{r.status === "paid" ? t("paid") : t("pending")}</span>
                      {r.paid_date && <span className="text-xs text-gray-400 ml-1">{r.paid_date}</span>}
                    </td>
                    {isManager && (
                      <td className="px-2 py-3">
                        <div className="flex gap-2">
                          {r.status === "pending" && (
                            <>
                              <button onClick={() => handleEditSalary(r)}
                                className="text-blue-600 hover:underline text-xs">{t("edit")}</button>
                              <button onClick={() => handleMarkPaid(r.id)}
                                className="text-green-600 hover:underline text-xs">{t("mark_paid")}</button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
