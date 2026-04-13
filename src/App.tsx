import { useState } from 'react';
import { LangProvider } from './contexts/LangContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ChartOfAccountsPage from './pages/ChartOfAccountsPage';
import JournalEntriesPage from './pages/JournalEntriesPage';
import GeneralLedgerPage from './pages/GeneralLedgerPage';
import InvoicesPage from './pages/InvoicesPage';
import CustomersPage from './pages/CustomersPage';
import VendorsPage from './pages/VendorsPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';

function AppContent() {
  const { user, loading } = useAuth();
  const [activePage, setActivePage] = useState('dashboard');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center text-white text-xl font-bold mx-auto mb-4 animate-pulse">
            AB
          </div>
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard': return <DashboardPage />;
      case 'chart-of-accounts': return <ChartOfAccountsPage />;
      case 'journal-entries': return <JournalEntriesPage />;
      case 'general-ledger': return <GeneralLedgerPage />;
      case 'invoices': return <InvoicesPage />;
      case 'customers': return <CustomersPage />;
      case 'vendors': return <VendorsPage />;
      case 'reports': return <ReportsPage />;
      case 'settings': return <SettingsPage />;
      default: return <DashboardPage />;
    }
  };

  return (
    <Layout activePage={activePage} onNavigate={setActivePage}>
      {renderPage()}
    </Layout>
  );
}

export default function App() {
  return (
    <LangProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </LangProvider>
  );
}
