import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet } from "../contexts/api";
import { useAuth } from "../contexts/AuthContext";
import { DollarSign, ShoppingCart, Receipt, Users, Banknote } from "lucide-react";

interface DashboardData {
  total_sales: number;
  total_purchases: number;
  total_expenses: number;
  employee_count: number;
  sales_count: number;
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    apiGet("/api/dashboard/").then(setData);
  }, []);

  const cards = data ? [
    { label: t("total_sales"), value: `KD ${data.total_sales.toLocaleString()}`, icon: DollarSign, color: "bg-emerald-500" },
    { label: t("total_purchases"), value: `KD ${data.total_purchases.toLocaleString()}`, icon: ShoppingCart, color: "bg-blue-500" },
    { label: t("total_expenses"), value: `KD ${data.total_expenses.toLocaleString()}`, icon: Receipt, color: "bg-orange-500" },
    { label: t("employee_count"), value: data.employee_count.toString(), icon: Users, color: "bg-purple-500" },
    { label: t("sales_count"), value: data.sales_count.toString(), icon: Banknote, color: "bg-teal-500" },
  ] : [];

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-0.5">{t("dashboard")}</h2>
      <p className="text-gray-500 text-sm mb-3">{t("welcome_back")}, {user?.full_name}</p>

      {!data ? (
        <div className="text-center py-8 text-gray-400">Loading...</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
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
      )}
    </div>
  );
}
