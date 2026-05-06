import { Link, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../contexts/AuthContext";
import {
  LayoutDashboard, ShoppingCart, Package, Receipt,
  Users, Clock, LogOut, Menu, X, Banknote, Settings, ArrowLeftRight,
} from "lucide-react";
import { useState } from "react";

const navItems: { path: string; icon: typeof LayoutDashboard; key: string; roles?: string[] }[] = [
  { path: "/", icon: LayoutDashboard, key: "dashboard" },
  { path: "/sales", icon: ShoppingCart, key: "sales" },
  { path: "/purchases", icon: Package, key: "purchases" },
  { path: "/expenses", icon: Receipt, key: "expenses" },
  { path: "/hr", icon: Users, key: "hr" },
  { path: "/attendance", icon: Clock, key: "attendance" },
  { path: "/cash", icon: Banknote, key: "cash_management" },
  { path: "/transfers", icon: ArrowLeftRight, key: "internal_transfer" },
  { path: "/settings", icon: Settings, key: "settings", roles: ["owner", "manager"] },
];

export default function Layout() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleLang = () => {
    const next = i18n.language === "en" ? "ar" : "en";
    i18n.changeLanguage(next);
    localStorage.setItem("lang", next);
    document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 z-30 w-64 bg-gradient-to-b from-emerald-700 to-emerald-900
        text-white transform transition-transform md:relative md:translate-x-0
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
        <div className="p-6">
          <h1 className="text-2xl font-bold">{t("app_name")}</h1>
          <p className="text-emerald-200 text-sm mt-1">{t("app_subtitle")}</p>
        </div>
        <nav className="mt-2">
          {navItems
            .filter(item => !item.roles || item.roles.includes(user?.role || ""))
            .map(({ path, icon: Icon, key }) => (
            <Link
              key={path}
              to={path}
              onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 px-6 py-3 text-sm transition-colors
                ${location.pathname === path
                  ? "bg-emerald-600 text-white"
                  : "text-emerald-100 hover:bg-emerald-600/50"}`}
            >
              <Icon size={20} />
              {t(key)}
            </Link>
          ))}
        </nav>
        <div className="absolute bottom-0 w-full p-4 border-t border-emerald-600">
          <div className="text-sm text-emerald-200 mb-2">{user?.full_name}</div>
          <div className="flex gap-2">
            <button onClick={toggleLang}
              className="flex-1 py-1.5 text-xs bg-emerald-600 rounded hover:bg-emerald-500 transition">
              {i18n.language === "en" ? t("arabic") : t("english")}
            </button>
            <button onClick={logout}
              className="flex-1 py-1.5 text-xs bg-red-600 rounded hover:bg-red-500 transition flex items-center justify-center gap-1">
              <LogOut size={14} /> {t("logout")}
            </button>
          </div>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/30 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white shadow-sm border-b px-4 py-3 flex items-center md:hidden">
          <button onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
          <h1 className="text-lg font-semibold mx-auto">{t("app_name")}</h1>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
