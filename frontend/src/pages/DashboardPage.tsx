import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet } from "../contexts/api";
import { useAuth } from "../contexts/AuthContext";
import DateRangeFilter, { type DateRange, dateRangeParams } from "../components/DateRangeFilter";
import { DollarSign, ShoppingCart, Receipt, Users, Banknote, ArrowLeftRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

interface BranchData {
  branch_id: number; branch_name: string;
  sales: number; purchases: number; expenses: number; transfers: number;
}

interface DashboardData {
  total_sales: number;
  total_purchases: number;
  total_expenses: number;
  total_transfers: number;
  employee_count: number;
  sales_count: number;
  branch_data: BranchData[];
}

const COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

export default function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [paymentMsg, setPaymentMsg] = useState("");
  const [range, setRange] = useState<DateRange>({ from: "", to: "" });

  useEffect(() => {
    const qs = dateRangeParams(range).join("&");
    apiGet(`/api/dashboard/${qs ? `?${qs}` : ""}`).then(setData);
  }, [range]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    if (payment === "success") {
      setPaymentMsg(t("payment_success"));
      window.history.replaceState({}, "", "/");
    } else if (payment === "failed") {
      setPaymentMsg(t("payment_failed"));
      window.history.replaceState({}, "", "/");
    }
  }, []);

  const cards = data ? [
    { label: t("total_sales"), value: `KD ${data.total_sales.toLocaleString()}`, icon: DollarSign, color: "bg-emerald-500" },
    { label: t("total_purchases"), value: `KD ${data.total_purchases.toLocaleString()}`, icon: ShoppingCart, color: "bg-blue-500" },
    { label: t("total_expenses"), value: `KD ${data.total_expenses.toLocaleString()}`, icon: Receipt, color: "bg-orange-500" },
    { label: t("total_transfers"), value: `KD ${data.total_transfers.toLocaleString()}`, icon: ArrowLeftRight, color: "bg-violet-500" },
    { label: t("employee_count"), value: data.employee_count.toString(), icon: Users, color: "bg-purple-500" },
    { label: t("sales_count"), value: data.sales_count.toString(), icon: Banknote, color: "bg-teal-500" },
  ] : [];

  const pieData = data ? [
    { name: t("total_sales"), value: data.total_sales },
    { name: t("total_purchases"), value: data.total_purchases },
    { name: t("total_expenses"), value: data.total_expenses },
    { name: t("total_transfers"), value: data.total_transfers },
  ].filter(d => d.value > 0) : [];

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-0.5">{t("dashboard")}</h2>
      <p className="text-gray-500 text-sm mb-3">{t("welcome_back")}, {user?.full_name}</p>
      <div className="mb-4"><DateRangeFilter value={range} onChange={setRange} /></div>

      {paymentMsg && (
        <div className={`p-3 rounded-lg mb-4 text-sm flex justify-between items-center ${
          paymentMsg.includes("success") || paymentMsg.includes("نجاح") ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"
        }`}>
          {paymentMsg}
          <button onClick={() => setPaymentMsg("")} className="text-xs underline ml-4">{t("close")}</button>
        </div>
      )}

      {!data ? (
        <div className="text-center py-8 text-gray-400">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {cards.map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-white rounded-lg shadow-sm border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className="text-lg font-bold text-gray-800 mt-0.5">{value}</p>
                  </div>
                  <div className={`${color} p-2 rounded-lg text-white`}>
                    <Icon size={18} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Branch Performance Bar Chart */}
            <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border p-4">
              <h3 className="font-semibold text-gray-700 mb-3">{t("branch_performance")}</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.branch_data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="branch_name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => `KD ${Number(value).toLocaleString()}`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="sales" name={t("sales")} fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="purchases" name={t("purchases")} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" name={t("expenses")} fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="transfers" name={t("total_transfers")} fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Overall Distribution Pie Chart */}
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <h3 className="font-semibold text-gray-700 mb-3">{t("summary")}</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={90} innerRadius={50}
                    dataKey="value" labelLine={false}
                    label={({ percent }) => ((percent ?? 0) >= 0.05 ? `${((percent ?? 0) * 100).toFixed(0)}%` : "")}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => `KD ${Number(value).toLocaleString()}`} />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Branch Table */}
          <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left">{t("branch")}</th>
                  <th className="px-4 py-3 text-right">{t("total_sales")}</th>
                  <th className="px-4 py-3 text-right">{t("total_purchases")}</th>
                  <th className="px-4 py-3 text-right">{t("total_expenses")}</th>
                  <th className="px-4 py-3 text-right">{t("total_transfers")}</th>
                  <th className="px-4 py-3 text-right">{t("difference")}</th>
                </tr>
              </thead>
              <tbody>
                {data.branch_data.map((b, i) => {
                  const net = b.sales - b.purchases - b.expenses - b.transfers;
                  return (
                    <tr key={b.branch_id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">
                        <span className="inline-block w-3 h-3 rounded-full mr-2" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        {b.branch_name}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-600">KD {b.sales.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right font-mono text-blue-600">KD {b.purchases.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right font-mono text-orange-600">KD {b.expenses.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right font-mono text-violet-600">KD {b.transfers.toFixed(3)}</td>
                      <td className={`px-4 py-3 text-right font-mono font-bold ${net >= 0 ? "text-green-600" : "text-red-600"}`}>
                        KD {net.toFixed(3)}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-gray-50 font-bold">
                  <td className="px-4 py-3">{t("total")}</td>
                  <td className="px-4 py-3 text-right font-mono text-emerald-700">KD {data.total_sales.toFixed(3)}</td>
                  <td className="px-4 py-3 text-right font-mono text-blue-700">KD {data.total_purchases.toFixed(3)}</td>
                  <td className="px-4 py-3 text-right font-mono text-orange-700">KD {data.total_expenses.toFixed(3)}</td>
                  <td className="px-4 py-3 text-right font-mono text-violet-700">KD {data.total_transfers.toFixed(3)}</td>
                  <td className={`px-4 py-3 text-right font-mono ${(data.total_sales - data.total_purchases - data.total_expenses - data.total_transfers) >= 0 ? "text-green-700" : "text-red-700"}`}>
                    KD {(data.total_sales - data.total_purchases - data.total_expenses - data.total_transfers).toFixed(3)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
