import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet } from "../contexts/api";
import { useAuth } from "../contexts/AuthContext";
import { DollarSign, ShoppingCart, Receipt, Users } from "lucide-react";

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
  ] : [];

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-1">{t("dashboard")}</h2>
      <p className="text-gray-500 mb-6">{t("welcome_back")}, {user?.full_name}</p>

      {!data ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white rounded-xl shadow-sm border p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">{label}</p>
                  <p className="text-2xl font-bold text-gray-800 mt-1">{value}</p>
                </div>
                <div className={`${color} p-3 rounded-lg text-white`}>
                  <Icon size={24} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
