import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { BrandProvider, useBrand } from "./contexts/BrandContext";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import BrandSelectPage from "./pages/BrandSelectPage";
import DashboardPage from "./pages/DashboardPage";
import SalesPage from "./pages/SalesPage";
import PurchasesPage from "./pages/PurchasesPage";
import ExpensesPage from "./pages/ExpensesPage";
import HRPage from "./pages/HRPage";
import CashPage from "./pages/CashPage";
import SettingsPage from "./pages/SettingsPage";
import TransfersPage from "./pages/TransfersPage";
import ContractsPage from "./pages/ContractsPage";
import { useState, useEffect } from "react";
import "./i18n";

function ProtectedRoutes() {
  const { user } = useAuth();
  const { selectedBrand, isGroupView, brands, selectBrand } = useBrand();
  const [brandChosen, setBrandChosen] = useState(false);

  // Auto-select if only 1 brand
  useEffect(() => {
    if (brands.length === 1 && !selectedBrand && !isGroupView && !brandChosen) {
      selectBrand(brands[0]);
      setBrandChosen(true);
    }
  }, [brands, selectedBrand, isGroupView, brandChosen, selectBrand]);

  if (!user) return <Navigate to="/login" />;

  // If no brand selected and not group view, show brand selector (multi-brand)
  if (!selectedBrand && !isGroupView && !brandChosen && brands.length > 1) {
    return <BrandSelectPage onSelect={() => setBrandChosen(true)} />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/sales" element={<SalesPage />} />
        <Route path="/purchases" element={<PurchasesPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/hr" element={<HRPage />} />
        <Route path="/cash" element={<CashPage />} />
        <Route path="/transfers" element={<TransfersPage />} />
        <Route path="/contracts" element={<ContractsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/brands" element={<BrandSelectPage onSelect={() => setBrandChosen(true)} />} />
      </Route>
    </Routes>
  );
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/*" element={<ProtectedRoutes />} />
    </Routes>
  );
}

// Prevents duplicate submissions from double-clicking any form's save button.
function useGlobalSubmitGuard() {
  useEffect(() => {
    const onSubmit = (e: Event) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.dataset.submitting === "1") {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      form.dataset.submitting = "1";
      const btns = Array.from(
        form.querySelectorAll('button:not([type="button"]):not([type="reset"])')
      ) as HTMLButtonElement[];
      const justDisabled = btns.filter(b => !b.disabled);
      justDisabled.forEach(b => { b.disabled = true; });
      window.setTimeout(() => {
        form.dataset.submitting = "";
        justDisabled.forEach(b => { b.disabled = false; });
      }, 2500);
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);
}

export default function App() {
  useGlobalSubmitGuard();
  return (
    <BrowserRouter>
      <AuthProvider>
        <BrandProvider>
          <AppRoutes />
        </BrandProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
