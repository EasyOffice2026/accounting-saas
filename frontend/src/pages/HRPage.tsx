import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost, apiFetch } from "../contexts/api";

interface Branch { id: number; name: string; }
interface Employee {
  id: number; staff_no: string; branch_id: number; name: string; name_ar: string;
  civil_id: string; position: string; phone: string; salary: number;
  iban: string; bank_name: string; salary_transfer_method: string; employer: string;
  join_date: string; termination_date: string | null; is_active: boolean;
}
interface SalaryRecord {
  id: number; employee_id: number; staff_no: string; designation: string;
  branch_id: number; month: string;
  basic_salary: number; total_days: number; days_worked: number;
  period_start: string; period_end: string; last_workplace: string;
  housing_allowance: number; transport_allowance: number;
  food_allowance: number; other_allowance: number; allowances: number;
  overtime: number; bonus: number; incentive: number;
  leave_salary: number; ticket_payment: number;
  absence_deduction: number; late_deduction: number;
  other_deduction: number; loan_deduction: number; penalty: number;
  deductions: number; advance: number; net_salary: number;
  payment_method: string; status: string; notes: string | null; paid_date: string | null;
}
interface Transfer {
  id: number; employee_id: number; from_branch_id: number; to_branch_id: number;
  transfer_date: string; requested_by: number | null; approved_by: number | null;
  status: string; notes: string | null;
}
interface Loan {
  id: number; employee_id: number; loan_type: string;
  amount: number; balance: number; monthly_deduction: number;
  deduction_month: string | null;
  date: string; notes: string | null; status: string;
}
interface BenefitDeduction {
  id: number; employee_id: number; category: string;
  amount: number; date: string; month: string | null; notes: string | null;
}

type Tab = "employees" | "salary" | "transfers" | "loans" | "benefits" | "deductions";

export default function HRPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("employees");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingEmp, setEditingEmp] = useState<Employee | null>(null);

  // Salary state
  const [salaryRecords, setSalaryRecords] = useState<SalaryRecord[]>([]);
  const [salaryMonth, setSalaryMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [salaryMsg, setSalaryMsg] = useState("");
  const [salaryMsgType, setSalaryMsgType] = useState<"success" | "error">("success");
  const [editingRecord, setEditingRecord] = useState<SalaryRecord | null>(null);

  // Edit salary fields
  const [editBasicSalary, setEditBasicSalary] = useState("0");
  const [editTotalDays, setEditTotalDays] = useState("30");
  const [editDaysWorked, setEditDaysWorked] = useState("30");
  const [editPeriodStart, setEditPeriodStart] = useState("");
  const [editPeriodEnd, setEditPeriodEnd] = useState("");
  const [editLastWorkplace, setEditLastWorkplace] = useState("");
  const [editHousing, setEditHousing] = useState("0");
  const [editTransport, setEditTransport] = useState("0");
  const [editFood, setEditFood] = useState("0");
  const [editOtherAllow, setEditOtherAllow] = useState("0");
  const [editAbsence, setEditAbsence] = useState("0");
  const [editLate, setEditLate] = useState("0");
  const [editOtherDed, setEditOtherDed] = useState("0");
  const [editAdvance, setEditAdvance] = useState("0");
  const [editOvertime, setEditOvertime] = useState("0");
  const [editBonus, setEditBonus] = useState("0");
  const [editIncentive, setEditIncentive] = useState("0");
  const [editLeaveSalary, setEditLeaveSalary] = useState("0");
  const [editTicket, setEditTicket] = useState("0");
  const [editLoanDed, setEditLoanDed] = useState("0");
  const [editPenalty, setEditPenalty] = useState("0");
  const [editMethod, setEditMethod] = useState("cash");
  const [editNotes, setEditNotes] = useState("");

  // Transfer state
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [showTransferForm, setShowTransferForm] = useState(false);

  // Loan state
  const [loans, setLoans] = useState<Loan[]>([]);
  const [showLoanForm, setShowLoanForm] = useState(false);

  // Benefits state (incentive, bonus, leave_salary, ticket)
  const [benefits, setBenefits] = useState<BenefitDeduction[]>([]);
  const [showBenefitForm, setShowBenefitForm] = useState(false);

  // Deductions state (fine, penalty)
  const [deductionItems, setDeductionItems] = useState<BenefitDeduction[]>([]);
  const [showDeductionForm, setShowDeductionForm] = useState(false);

  const currentUser = JSON.parse(localStorage.getItem("user") || "{}");
  const isManager = currentUser.role === "owner" || currentUser.role === "manager";

  useEffect(() => {
    apiGet("/api/branches/").then(setBranches);
    apiGet("/api/hr/employees").then(setEmployees);
  }, []);

  useEffect(() => {
    if (tab === "salary") loadSalary();
    if (tab === "transfers") apiGet("/api/hr/transfers").then(setTransfers);
    if (tab === "loans") apiGet("/api/hr/loans").then(setLoans);
    if (tab === "benefits") apiGet("/api/hr/benefits-deductions").then((data: BenefitDeduction[]) => {
      setBenefits(data.filter(d => ["incentive", "bonus", "leave_salary", "ticket", "other_benefit"].includes(d.category)));
    });
    if (tab === "deductions") apiGet("/api/hr/benefits-deductions").then((data: BenefitDeduction[]) => {
      setDeductionItems(data.filter(d => ["fine", "penalty", "other_deduction"].includes(d.category)));
    });
  }, [tab, salaryMonth]);

  const loadSalary = () => {
    apiGet(`/api/hr/salary?month=${salaryMonth}`).then((data) => {
      if (Array.isArray(data)) setSalaryRecords(data);
    });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (editingEmp) {
      await apiFetch(`/api/hr/employees/${editingEmp.id}`, { method: "PUT", body: fd });
    } else {
      await apiPost("/api/hr/employees", fd);
    }
    setShowForm(false);
    setEditingEmp(null);
    apiGet("/api/hr/employees").then(setEmployees);
  };

  const startEditEmp = (emp: Employee) => {
    setEditingEmp(emp);
    setShowForm(true);
  };

  const branchName = (id: number) => branches.find(b => b.id === id)?.name || "";
  const empName = (id: number) => employees.find(e => e.id === id)?.name || "-";
  const empStaffNo = (id: number) => employees.find(e => e.id === id)?.staff_no || "";

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
    setEditPeriodStart(r.period_start || "");
    setEditPeriodEnd(r.period_end || "");
    setEditLastWorkplace(r.last_workplace || "");
    setEditHousing(String(r.housing_allowance));
    setEditTransport(String(r.transport_allowance));
    setEditFood(String(r.food_allowance));
    setEditOtherAllow(String(r.other_allowance));
    setEditAbsence(String(r.absence_deduction));
    setEditLate(String(r.late_deduction));
    setEditOtherDed(String(r.other_deduction));
    setEditAdvance(String(r.advance));
    setEditOvertime(String(r.overtime));
    setEditBonus(String(r.bonus));
    setEditIncentive(String(r.incentive));
    setEditLeaveSalary(String(r.leave_salary));
    setEditTicket(String(r.ticket_payment));
    setEditLoanDed(String(r.loan_deduction));
    setEditPenalty(String(r.penalty));
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
    const totalAdditions = Number(editOvertime) + Number(editBonus) + Number(editIncentive) + Number(editLeaveSalary) + Number(editTicket);
    const totalDed = Number(editAbsence) + Number(editLate) + Number(editOtherDed) + Number(editLoanDed) + Number(editPenalty);
    return earned + totalAllow + totalAdditions - totalDed - Number(editAdvance);
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
    fd.append("period_start", editPeriodStart);
    fd.append("period_end", editPeriodEnd);
    fd.append("last_workplace", editLastWorkplace);
    fd.append("housing_allowance", editHousing);
    fd.append("transport_allowance", editTransport);
    fd.append("food_allowance", editFood);
    fd.append("other_allowance", editOtherAllow);
    fd.append("absence_deduction", editAbsence);
    fd.append("late_deduction", editLate);
    fd.append("other_deduction", editOtherDed);
    fd.append("advance", editAdvance);
    fd.append("overtime", editOvertime);
    fd.append("bonus", editBonus);
    fd.append("incentive", editIncentive);
    fd.append("leave_salary", editLeaveSalary);
    fd.append("ticket_payment", editTicket);
    fd.append("loan_deduction", editLoanDed);
    fd.append("penalty", editPenalty);
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

  const _recDailyRate = (r: SalaryRecord) => r.basic_salary / (r.total_days || 30);
  void _recDailyRate;

  // Transfer handlers
  const handleTransferSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await apiPost("/api/hr/transfers", fd);
    setShowTransferForm(false);
    apiGet("/api/hr/transfers").then(setTransfers);
  };
  const handleTransferAction = async (id: number, action: "approve" | "reject") => {
    await apiFetch(`/api/hr/transfers/${id}/${action}`, { method: "POST" });
    apiGet("/api/hr/transfers").then(setTransfers);
    apiGet("/api/hr/employees").then(setEmployees);
  };

  // Loan handlers
  const handleLoanSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await apiPost("/api/hr/loans", fd);
    setShowLoanForm(false);
    apiGet("/api/hr/loans").then(setLoans);
  };

  // Benefit handlers
  const handleBenefitSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await apiPost("/api/hr/benefits-deductions", fd);
    setShowBenefitForm(false);
    apiGet("/api/hr/benefits-deductions").then((data: BenefitDeduction[]) => {
      setBenefits(data.filter(d => ["incentive", "bonus", "leave_salary", "ticket", "other_benefit"].includes(d.category)));
    });
  };

  // Deduction handlers
  const handleDeductionSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await apiPost("/api/hr/benefits-deductions", fd);
    setShowDeductionForm(false);
    apiGet("/api/hr/benefits-deductions").then((data: BenefitDeduction[]) => {
      setDeductionItems(data.filter(d => ["fine", "penalty", "other_deduction"].includes(d.category)));
    });
  };

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
            <button onClick={() => { setShowForm(!showForm); setEditingEmp(null); }}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm">
              {showForm ? t("cancel") : t("add_new")}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg w-fit flex-wrap">
        {(["employees", "salary", "transfers", "loans", "benefits", "deductions"] as Tab[]).map(tb => {
          const label = tb === "benefits" ? "benefits_tab" : tb === "deductions" ? "deductions_tab" : tb === "loans" ? "advance_loan" : tb === "transfers" ? "staff_transfers" : tb;
          return (
            <button key={tb} onClick={() => setTab(tb)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                tab === tb ? "bg-white shadow text-emerald-700" : "text-gray-600 hover:text-gray-800"
              }`}>{t(label)}</button>
          );
        })}
      </div>

      {/* Employees Tab */}
      {tab === "employees" && (
        <>
          {showForm && (
            <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-6 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t("staff_no")}</label>
                  <input name="staff_no" defaultValue={editingEmp?.staff_no || ""} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("branch")}</label>
                  <select name="branch_id" required defaultValue={editingEmp?.branch_id || ""} className="w-full px-3 py-2 border rounded-lg text-sm">
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("name")} (EN)</label>
                  <input name="name" required defaultValue={editingEmp?.name || ""} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("name")} (AR)</label>
                  <input name="name_ar" defaultValue={editingEmp?.name_ar || ""} className="w-full px-3 py-2 border rounded-lg text-sm" dir="rtl" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("civil_id")}</label>
                  <input name="civil_id" pattern="\d{12}" maxLength={12} title={t("civil_id_validation")}
                    placeholder="12 digits" defaultValue={editingEmp?.civil_id || ""} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("position")}</label>
                  <input name="position" defaultValue={editingEmp?.position || ""} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("phone")}</label>
                  <input name="phone" pattern="\d{8}" maxLength={8} title={t("phone_validation")}
                    placeholder="8 digits" defaultValue={editingEmp?.phone || ""} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("salary")}</label>
                  <input type="number" step="0.001" name="salary" defaultValue={editingEmp?.salary || 0} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("iban_no")}</label>
                  <input name="iban" defaultValue={editingEmp?.iban || ""} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("bank_name_label")}</label>
                  <input name="bank_name" defaultValue={editingEmp?.bank_name || ""} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("salary_transfer")}</label>
                  <select name="salary_transfer_method" defaultValue={editingEmp?.salary_transfer_method || "cash"} className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="cash">{t("cash")}</option>
                    <option value="bank">{t("bank_transfer")}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("employer_label")}</label>
                  <select name="employer" defaultValue={editingEmp?.employer || "mudawwarah"} className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="mudawwarah">Mudawwarah</option>
                    <option value="other">{t("other")}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("join_date")}</label>
                  <input type="date" name="join_date" defaultValue={editingEmp?.join_date || ""} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("termination_date")}</label>
                  <input type="date" name="termination_date" defaultValue={editingEmp?.termination_date || ""} className="w-full px-3 py-2 border rounded-lg text-sm" />
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
                  <th className="px-3 py-3 text-left">{t("staff_no")}</th>
                  <th className="px-3 py-3 text-left">{t("name")}</th>
                  <th className="px-3 py-3 text-left">{t("branch")}</th>
                  <th className="px-3 py-3 text-left">{t("position")}</th>
                  <th className="px-3 py-3 text-left">{t("civil_id")}</th>
                  <th className="px-3 py-3 text-left">{t("phone")}</th>
                  <th className="px-3 py-3 text-left">{t("employer_label")}</th>
                  {isManager && <th className="px-3 py-3 text-center">{t("actions")}</th>}
                </tr>
              </thead>
              <tbody>
                {employees.length === 0 ? (
                  <tr><td colSpan={isManager ? 8 : 7} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
                ) : employees.map(emp => (
                  <tr key={emp.id} className="border-b hover:bg-gray-50">
                    <td className="px-3 py-3">{emp.staff_no || "—"}</td>
                    <td className="px-3 py-3">{emp.name}</td>
                    <td className="px-3 py-3">{branchName(emp.branch_id)}</td>
                    <td className="px-3 py-3">{emp.position}</td>
                    <td className="px-3 py-3">{emp.civil_id}</td>
                    <td className="px-3 py-3">{emp.phone}</td>
                    <td className="px-3 py-3">{emp.employer === "mudawwarah" ? "Mudawwarah" : t("other")}</td>
                    {isManager && (
                      <td className="px-3 py-3 text-center">
                        <button onClick={() => startEditEmp(emp)} className="text-blue-600 hover:underline text-xs">{t("edit")}</button>
                      </td>
                    )}
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

              {/* Salary & Days */}
              <div>
                <h5 className="text-xs font-semibold text-gray-500 uppercase mb-2">{t("salary_details")}</h5>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("period_start")}</label>
                    <input type="date" value={editPeriodStart}
                      onChange={e => setEditPeriodStart(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("period_end")}</label>
                    <input type="date" value={editPeriodEnd}
                      onChange={e => setEditPeriodEnd(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("last_workplace")}</label>
                    <input value={editLastWorkplace}
                      onChange={e => setEditLastWorkplace(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                </div>
              </div>

              {/* Allowances */}
              <div>
                <h5 className="text-xs font-semibold text-green-600 uppercase mb-2">{t("allowance_details")}</h5>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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

              {/* Additions (OT, Bonus, Incentive, Leave, Ticket) */}
              <div>
                <h5 className="text-xs font-semibold text-blue-600 uppercase mb-2">{t("additions")}</h5>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("overtime")}</label>
                    <input type="number" step="0.001" value={editOvertime}
                      onChange={e => setEditOvertime(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("bonus_label")}</label>
                    <input type="number" step="0.001" value={editBonus}
                      onChange={e => setEditBonus(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("incentive_label")}</label>
                    <input type="number" step="0.001" value={editIncentive}
                      onChange={e => setEditIncentive(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("leave_salary_label")}</label>
                    <input type="number" step="0.001" value={editLeaveSalary}
                      onChange={e => setEditLeaveSalary(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("ticket_payment_label")}</label>
                    <input type="number" step="0.001" value={editTicket}
                      onChange={e => setEditTicket(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                </div>
              </div>

              {/* Deductions */}
              <div>
                <h5 className="text-xs font-semibold text-red-600 uppercase mb-2">{t("deduction_details")}</h5>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("loan_deduction_label")}</label>
                    <input type="number" step="0.001" value={editLoanDed}
                      onChange={e => setEditLoanDed(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">{t("penalty_label")}</label>
                    <input type="number" step="0.001" value={editPenalty}
                      onChange={e => setEditPenalty(e.target.value)}
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

              {/* Net Salary Calculation */}
              <div className="bg-white p-3 rounded-lg border text-sm space-y-1">
                <div className="flex justify-between">
                  <span>{t("earned_basic")} ({calcDailyRate().toFixed(3)} × {editDaysWorked})</span>
                  <span className="font-mono">KD {(calcDailyRate() * Number(editDaysWorked)).toFixed(3)}</span>
                </div>
                <div className="flex justify-between text-green-600">
                  <span>+ {t("allowances")}</span>
                  <span className="font-mono">+{(Number(editHousing) + Number(editTransport) + Number(editFood) + Number(editOtherAllow)).toFixed(3)}</span>
                </div>
                <div className="flex justify-between text-blue-600">
                  <span>+ {t("additions")} (OT + Bonus + Incentive + Leave + Ticket)</span>
                  <span className="font-mono">+{(Number(editOvertime) + Number(editBonus) + Number(editIncentive) + Number(editLeaveSalary) + Number(editTicket)).toFixed(3)}</span>
                </div>
                <div className="flex justify-between text-red-600">
                  <span>- {t("deductions")} (Absence + Late + Other + Loan + Penalty)</span>
                  <span className="font-mono">-{(Number(editAbsence) + Number(editLate) + Number(editOtherDed) + Number(editLoanDed) + Number(editPenalty)).toFixed(3)}</span>
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

          {/* Salary Summary Table */}
          <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-3 text-left">{t("staff_no")}</th>
                  <th className="px-3 py-3 text-left">{t("name")}</th>
                  <th className="px-3 py-3 text-left">{t("position")}</th>
                  <th className="px-3 py-3 text-center">{t("days_worked")}</th>
                  <th className="px-3 py-3 text-right">{t("basic_salary")}</th>
                  <th className="px-3 py-3 text-right text-green-600">{t("total_allowances")}</th>
                  <th className="px-3 py-3 text-right text-red-600">{t("total_deductions")}</th>
                  <th className="px-3 py-3 text-right font-bold">{t("net_salary")}</th>
                  <th className="px-3 py-3 text-left">{t("status")}</th>
                  {isManager && <th className="px-3 py-3 text-left">{t("actions")}</th>}
                </tr>
              </thead>
              <tbody>
                {salaryRecords.length === 0 ? (
                  <tr><td colSpan={isManager ? 10 : 9} className="px-4 py-8 text-center text-gray-400">
                    {t("no_data")} — {t("generate_payroll")}
                  </td></tr>
                ) : salaryRecords.map(r => {
                  const totalAllowances = r.allowances + r.overtime + r.bonus + r.incentive + r.leave_salary + r.ticket_payment;
                  const totalDeductions = r.deductions + r.advance + r.loan_deduction + r.penalty;
                  return (
                    <tr key={r.id} className="border-b hover:bg-gray-50">
                      <td className="px-3 py-3">{r.staff_no || empStaffNo(r.employee_id) || "—"}</td>
                      <td className="px-3 py-3 font-medium">{empName(r.employee_id)}</td>
                      <td className="px-3 py-3">{r.designation || "—"}</td>
                      <td className="px-3 py-3 text-center">
                        <span className={r.days_worked < r.total_days ? "text-orange-600 font-semibold" : ""}>
                          {r.days_worked}/{r.total_days}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-mono">{r.basic_salary.toFixed(3)}</td>
                      <td className="px-3 py-3 text-right font-mono text-green-600">
                        {totalAllowances > 0 ? `+${totalAllowances.toFixed(3)}` : "—"}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-red-600">
                        {totalDeductions > 0 ? `-${totalDeductions.toFixed(3)}` : "—"}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-bold">{r.net_salary.toFixed(3)}</td>
                      <td className="px-3 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          r.status === "paid" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                        }`}>{r.status === "paid" ? t("paid") : t("pending")}</span>
                      </td>
                      {isManager && (
                        <td className="px-3 py-3">
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Staff Transfers Tab */}
      {tab === "transfers" && (
        <div>
          {isManager && (
            <button onClick={() => setShowTransferForm(!showTransferForm)}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm mb-4">
              {showTransferForm ? t("cancel") : t("new_transfer")}
            </button>
          )}

          {showTransferForm && (
            <form onSubmit={handleTransferSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-6 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t("employee")}</label>
                  <select name="employee_id" required className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="">{t("select_employee")}</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.staff_no ? `${e.staff_no} - ` : ""}{e.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("from_branch")}</label>
                  <select name="from_branch_id" required className="w-full px-3 py-2 border rounded-lg text-sm">
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("to_branch")}</label>
                  <select name="to_branch_id" required className="w-full px-3 py-2 border rounded-lg text-sm">
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("transfer_date")}</label>
                  <input type="date" name="transfer_date" required className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("notes")}</label>
                <textarea name="notes" className="w-full px-3 py-2 border rounded-lg text-sm" rows={2} />
              </div>
              <button type="submit"
                className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
                {t("submit_transfer")}
              </button>
            </form>
          )}

          <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left">{t("staff_no")}</th>
                  <th className="px-4 py-3 text-left">{t("employee")}</th>
                  <th className="px-4 py-3 text-left">{t("from_branch")}</th>
                  <th className="px-4 py-3 text-left">{t("to_branch")}</th>
                  <th className="px-4 py-3 text-left">{t("transfer_date")}</th>
                  <th className="px-4 py-3 text-left">{t("status")}</th>
                  {isManager && <th className="px-4 py-3 text-center">{t("actions")}</th>}
                </tr>
              </thead>
              <tbody>
                {transfers.length === 0 ? (
                  <tr><td colSpan={isManager ? 7 : 6} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
                ) : transfers.map(tr => (
                  <tr key={tr.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3">{empStaffNo(tr.employee_id) || "—"}</td>
                    <td className="px-4 py-3">{empName(tr.employee_id)}</td>
                    <td className="px-4 py-3">{branchName(tr.from_branch_id)}</td>
                    <td className="px-4 py-3">{branchName(tr.to_branch_id)}</td>
                    <td className="px-4 py-3">{tr.transfer_date}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        tr.status === "approved" ? "bg-green-100 text-green-700"
                        : tr.status === "rejected" ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-700"
                      }`}>{t(tr.status)}</span>
                    </td>
                    {isManager && (
                      <td className="px-4 py-3 text-center">
                        {tr.status === "pending" && (
                          <div className="flex gap-2 justify-center">
                            <button onClick={() => handleTransferAction(tr.id, "approve")}
                              className="text-green-600 hover:underline text-xs">{t("approve")}</button>
                            <button onClick={() => handleTransferAction(tr.id, "reject")}
                              className="text-red-600 hover:underline text-xs">{t("reject")}</button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Advance / Loan Tab */}
      {tab === "loans" && (
        <div>
          {isManager && (
            <button onClick={() => setShowLoanForm(!showLoanForm)}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm mb-4">
              {showLoanForm ? t("cancel") : t("add_new")}
            </button>
          )}

          {showLoanForm && (
            <form onSubmit={handleLoanSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-6 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t("employee")}</label>
                  <select name="employee_id" required className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="">{t("select_employee")}</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.staff_no ? `${e.staff_no} - ` : ""}{e.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("loan_type_label")}</label>
                  <select name="loan_type" className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="advance">{t("advance")}</option>
                    <option value="loan">{t("loan_label")}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("amount")}</label>
                  <input type="number" step="0.001" name="amount" required className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("monthly_deduction")}</label>
                  <input type="number" step="0.001" name="monthly_deduction" defaultValue="0" className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("date")}</label>
                  <input type="date" name="loan_date" required className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("salary_month")} ({t("for_deduction")})</label>
                  <input type="month" name="deduction_month" className="w-full px-3 py-2 border rounded-lg text-sm" />
                  <p className="text-xs text-gray-400 mt-1">{t("no_month_no_deduction")}</p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("notes")}</label>
                <textarea name="notes" className="w-full px-3 py-2 border rounded-lg text-sm" rows={2} />
              </div>
              <button type="submit"
                className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
                {t("save")}
              </button>
            </form>
          )}

          <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left">{t("staff_no")}</th>
                  <th className="px-4 py-3 text-left">{t("employee")}</th>
                  <th className="px-4 py-3 text-left">{t("loan_type_label")}</th>
                  <th className="px-4 py-3 text-right">{t("amount")}</th>
                  <th className="px-4 py-3 text-right">{t("balance")}</th>
                  <th className="px-4 py-3 text-right">{t("monthly_deduction")}</th>
                  <th className="px-4 py-3 text-left">{t("salary_month")}</th>
                  <th className="px-4 py-3 text-left">{t("date")}</th>
                  <th className="px-4 py-3 text-left">{t("status")}</th>
                </tr>
              </thead>
              <tbody>
                {loans.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
                ) : loans.map(l => (
                  <tr key={l.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3">{empStaffNo(l.employee_id) || "—"}</td>
                    <td className="px-4 py-3">{empName(l.employee_id)}</td>
                    <td className="px-4 py-3">{t(l.loan_type === "loan" ? "loan_label" : "advance")}</td>
                    <td className="px-4 py-3 text-right font-mono">KD {l.amount.toFixed(3)}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold">{l.balance > 0 ? `KD ${l.balance.toFixed(3)}` : "—"}</td>
                    <td className="px-4 py-3 text-right font-mono">{l.monthly_deduction > 0 ? `KD ${l.monthly_deduction.toFixed(3)}` : "—"}</td>
                    <td className="px-4 py-3">{l.deduction_month || "—"}</td>
                    <td className="px-4 py-3">{l.date}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        l.status === "paid_off" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                      }`}>{l.status === "paid_off" ? t("paid") : t("active")}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Benefits Tab (Incentive, Bonus, Leave Salary, Ticket) */}
      {tab === "benefits" && (
        <div>
          {isManager && (
            <button onClick={() => setShowBenefitForm(!showBenefitForm)}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm mb-4">
              {showBenefitForm ? t("cancel") : t("add_new")}
            </button>
          )}

          {showBenefitForm && (
            <form onSubmit={handleBenefitSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-6 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t("employee")}</label>
                  <select name="employee_id" required className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="">{t("select_employee")}</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.staff_no ? `${e.staff_no} - ` : ""}{e.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("category")}</label>
                  <select name="category" required className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="incentive">{t("incentive_label")}</option>
                    <option value="bonus">{t("bonus_label")}</option>
                    <option value="leave_salary">{t("leave_salary_label")}</option>
                    <option value="ticket">{t("ticket_payment_label")}</option>
                    <option value="other_benefit">{t("other_benefit")}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("amount")}</label>
                  <input type="number" step="0.001" name="amount" required className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("date")}</label>
                  <input type="date" name="bd_date" required className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("salary_month")}</label>
                  <input type="month" name="month" className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("notes")}</label>
                <textarea name="notes" className="w-full px-3 py-2 border rounded-lg text-sm" rows={2} />
              </div>
              <button type="submit"
                className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
                {t("save")}
              </button>
            </form>
          )}

          <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left">{t("staff_no")}</th>
                  <th className="px-4 py-3 text-left">{t("employee")}</th>
                  <th className="px-4 py-3 text-left">{t("category")}</th>
                  <th className="px-4 py-3 text-right">{t("amount")}</th>
                  <th className="px-4 py-3 text-left">{t("date")}</th>
                  <th className="px-4 py-3 text-left">{t("salary_month")}</th>
                  <th className="px-4 py-3 text-left">{t("notes")}</th>
                </tr>
              </thead>
              <tbody>
                {benefits.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
                ) : benefits.map(b => (
                  <tr key={b.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3">{empStaffNo(b.employee_id) || "—"}</td>
                    <td className="px-4 py-3">{empName(b.employee_id)}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                        {t(b.category + "_label") || b.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">KD {b.amount.toFixed(3)}</td>
                    <td className="px-4 py-3">{b.date}</td>
                    <td className="px-4 py-3">{b.month || "—"}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{b.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Deductions Tab (Fine, Penalty) */}
      {tab === "deductions" && (
        <div>
          {isManager && (
            <button onClick={() => setShowDeductionForm(!showDeductionForm)}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm mb-4">
              {showDeductionForm ? t("cancel") : t("add_new")}
            </button>
          )}

          {showDeductionForm && (
            <form onSubmit={handleDeductionSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-6 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t("employee")}</label>
                  <select name="employee_id" required className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="">{t("select_employee")}</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.staff_no ? `${e.staff_no} - ` : ""}{e.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("category")}</label>
                  <select name="category" required className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="fine">{t("fine_label")}</option>
                    <option value="penalty">{t("penalty_label")}</option>
                    <option value="other_deduction">{t("other_deduction")}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("amount")}</label>
                  <input type="number" step="0.001" name="amount" required className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("date")}</label>
                  <input type="date" name="bd_date" required className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("salary_month")}</label>
                  <input type="month" name="month" className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("notes")}</label>
                <textarea name="notes" className="w-full px-3 py-2 border rounded-lg text-sm" rows={2} />
              </div>
              <button type="submit"
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm">
                {t("save")}
              </button>
            </form>
          )}

          <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left">{t("staff_no")}</th>
                  <th className="px-4 py-3 text-left">{t("employee")}</th>
                  <th className="px-4 py-3 text-left">{t("category")}</th>
                  <th className="px-4 py-3 text-right">{t("amount")}</th>
                  <th className="px-4 py-3 text-left">{t("date")}</th>
                  <th className="px-4 py-3 text-left">{t("salary_month")}</th>
                  <th className="px-4 py-3 text-left">{t("notes")}</th>
                </tr>
              </thead>
              <tbody>
                {deductionItems.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
                ) : deductionItems.map(d => (
                  <tr key={d.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3">{empStaffNo(d.employee_id) || "—"}</td>
                    <td className="px-4 py-3">{empName(d.employee_id)}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                        {t(d.category + "_label") || d.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">KD {d.amount.toFixed(3)}</td>
                    <td className="px-4 py-3">{d.date}</td>
                    <td className="px-4 py-3">{d.month || "—"}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{d.notes || "—"}</td>
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
