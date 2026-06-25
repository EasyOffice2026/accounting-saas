import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiFetch, apiDownload } from "../contexts/api";
import { useAuth } from "../contexts/AuthContext";

interface Branch { id: number; name: string; name_ar: string; }
interface CashTxn {
  id: number; branch_id: number; date: string;
  txn_type: string; category: string; amount: number;
  reference: string; notes: string; balance: number;
}

export default function CashPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [transactions, setTransactions] = useState<CashTxn[]>([]);
  const [showTxnForm, setShowTxnForm] = useState(false);

  useEffect(() => {
    apiGet("/api/branches/").then((bs: Branch[]) => {
      setBranches(bs.filter(b => !b.name.includes("Central")));
      if (user?.branch_id) {
        setBranchId(String(user.branch_id));
      } else if (bs.length > 0) {
        const first = bs.find(b => !b.name.includes("Central"));
        if (first) setBranchId(String(first.id));
      }
    });
  }, []);

  useEffect(() => {
    if (branchId) loadData();
  }, [branchId, dateFrom, dateTo]);

  const loadData = () => {
    let url = `/api/cash/transactions?branch_id=${branchId}`;
    if (dateFrom) url += `&date_from=${dateFrom}`;
    if (dateTo) url += `&date_to=${dateTo}`;
    apiGet(url).then(setTransactions);
  };

  const handleAddTxn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const params = new URLSearchParams({
      branch_id: branchId,
      txn_date: fd.get("txn_date") as string,
      txn_type: fd.get("txn_type") as string,
      category: fd.get("category") as string,
      amount: fd.get("amount") as string,
      reference: fd.get("reference") as string || "",
      notes: fd.get("notes") as string || "",
    });
    await apiFetch(`/api/cash/transactions?${params}`, { method: "POST" });
    setShowTxnForm(false);
    loadData();
  };

  const exportData = (fmt: string) => {
    const ext = fmt === "excel" ? "xlsx" : fmt;
    let url = `/api/export/cash/${fmt}?branch_id=${branchId}`;
    if (dateFrom) url += `&date_from=${dateFrom}`;
    if (dateTo) url += `&date_to=${dateTo}`;
    apiDownload(url, `cash_management.${ext}`);
  };

  const isStaff = user?.role === "staff";
  const finalBalance = transactions.length > 0 ? transactions[transactions.length - 1].balance : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-gray-800">{t("cash_management")}</h2>
        <div className="flex gap-2">
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
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap items-end">
        {!isStaff && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t("branch")}</label>
            <select value={branchId} onChange={e => setBranchId(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm">
              {branches.map(b => (
                <option key={b.id} value={b.id}>
                  {i18n.language === "ar" ? b.name_ar || b.name : b.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs text-gray-500 mb-1">{t("start_date")}</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">{t("end_date")}</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm" />
        </div>
        <button onClick={() => { setDateFrom(""); setDateTo(""); }}
          className="px-3 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300">
          {t("clear")}
        </button>
      </div>

      {/* Final Balance Banner */}
      <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg flex justify-between items-center">
        <span className="font-bold text-lg">{t("closing_balance")}</span>
        <span className="font-bold text-2xl text-blue-700">KD {finalBalance.toFixed(3)}</span>
      </div>

      {/* Add Transaction Button */}
      <div className="mb-4">
        <button onClick={() => setShowTxnForm(!showTxnForm)}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700">
          {showTxnForm ? t("cancel") : t("add_transaction")}
        </button>
      </div>

      {/* Transaction Form */}
      {showTxnForm && (
        <form onSubmit={handleAddTxn} className="bg-white p-6 rounded-xl shadow-sm border mb-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("date")}</label>
              <input type="date" name="txn_date" required defaultValue={new Date().toISOString().split("T")[0]}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("type")}</label>
              <select name="txn_type" className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="opening_balance">{t("opening_balance")}</option>
                <option value="cash_in">{t("cash_in")}</option>
                <option value="cash_out">{t("cash_out")}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("category")}</label>
              <select name="category" className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="opening_balance">{t("opening_balance")}</option>
                <option value="sales">{t("sales")}</option>
                <option value="petty_cash">{t("petty_cash")}</option>
                <option value="deposit">{t("deposit")}</option>
                <option value="withdrawal">{t("withdrawal")}</option>
                <option value="purchase">{t("purchases")}</option>
                <option value="expense">{t("expenses")}</option>
                <option value="other">{t("other")}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("amount")}</label>
              <input type="number" step="0.001" name="amount" required
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("reference")}</label>
              <input name="reference" className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("notes")}</label>
              <input name="notes" className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>
          <button type="submit"
            className="px-6 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700">
            {t("save")}
          </button>
        </form>
      )}

      {/* Transactions Ledger Table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full text-sm min-w-[750px]">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left">{t("date")}</th>
              <th className="px-4 py-3 text-left">{t("type")}</th>
              <th className="px-4 py-3 text-left">{t("category")}</th>
              <th className="px-4 py-3 text-right">{t("cash_in")}</th>
              <th className="px-4 py-3 text-right">{t("cash_out")}</th>
              <th className="px-4 py-3 text-right font-bold">{t("balance")}</th>
              <th className="px-4 py-3 text-left">{t("reference")}</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
            ) : transactions.map(txn => (
              <tr key={txn.id} className={`border-b hover:bg-gray-50 ${txn.txn_type === "opening_balance" ? "bg-blue-50" : ""}`}>
                <td className="px-4 py-3">{txn.date}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    txn.txn_type === "opening_balance" ? "bg-blue-100 text-blue-700" :
                    txn.txn_type === "cash_in" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                  }`}>
                    {txn.txn_type === "opening_balance" ? t("opening_balance") :
                     txn.txn_type === "cash_in" ? t("cash_in") : t("cash_out")}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs">{txn.category}</td>
                <td className="px-4 py-3 text-right font-medium text-green-600">
                  {(txn.txn_type === "cash_in" || txn.txn_type === "opening_balance") ? `KD ${txn.amount.toFixed(3)}` : "-"}
                </td>
                <td className="px-4 py-3 text-right font-medium text-red-600">
                  {txn.txn_type === "cash_out" ? `KD ${txn.amount.toFixed(3)}` : "-"}
                </td>
                <td className="px-4 py-3 text-right font-bold">
                  KD {txn.balance.toFixed(3)}
                </td>
                <td className="px-4 py-3 text-xs">{txn.reference || txn.notes || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
