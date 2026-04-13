import { useState } from 'react';
import { useLang } from '../contexts/LangContext';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard, BookOpen, FileText, ClipboardList, Receipt, Users, Truck,
  CreditCard, BarChart3, Settings, LogOut, Menu, X, ChevronDown, Globe
} from 'lucide-react';

interface LayoutProps {
  children: React.ReactNode;
  activePage: string;
  onNavigate: (page: string) => void;
}

const NAV_ITEMS = [
  { key: 'dashboard', icon: LayoutDashboard, labelKey: 'dashboard' },
  { key: 'chart-of-accounts', icon: BookOpen, labelKey: 'chartOfAccounts' },
  { key: 'journal-entries', icon: FileText, labelKey: 'journalEntries' },
  { key: 'general-ledger', icon: ClipboardList, labelKey: 'generalLedger' },
  { key: 'invoices', icon: Receipt, labelKey: 'invoices' },
  { key: 'customers', icon: Users, labelKey: 'customers' },
  { key: 'vendors', icon: Truck, labelKey: 'vendors' },
  { key: 'reports', icon: BarChart3, labelKey: 'reports' },
  { key: 'settings', icon: Settings, labelKey: 'settings' },
];

export default function Layout({ children, activePage, onNavigate }: LayoutProps) {
  const { t, lang, setLang } = useLang();
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 ${lang === 'ar' ? 'right-0' : 'left-0'} z-50 
        ${sidebarOpen ? 'w-64' : 'w-20'} 
        ${mobileOpen ? 'translate-x-0' : lang === 'ar' ? 'translate-x-full lg:translate-x-0' : '-translate-x-full lg:translate-x-0'}
        bg-slate-900 text-slate-300 transition-all duration-300 flex flex-col`}>
        
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-slate-800">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            AB
          </div>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <div className="text-white font-semibold text-sm">{t('appName')}</div>
              <div className="text-slate-500 text-xs">{t('appTagline')}</div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 overflow-y-auto">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const isActive = activePage === item.key;
            return (
              <button key={item.key} onClick={() => { onNavigate(item.key); setMobileOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
                  ${isActive ? 'bg-blue-600/20 text-blue-400 border-r-2 border-blue-400' : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'}
                  ${!sidebarOpen ? 'justify-center px-0' : ''}`}
                title={!sidebarOpen ? t(item.labelKey) : undefined}>
                <Icon size={20} className="flex-shrink-0" />
                {sidebarOpen && <span>{t(item.labelKey)}</span>}
              </button>
            );
          })}
        </nav>

        {/* User section */}
        <div className="border-t border-slate-800 p-4">
          {sidebarOpen && (
            <div className="mb-3">
              <div className="text-white text-sm font-medium truncate">{user?.full_name || user?.email}</div>
              <div className="text-slate-500 text-xs truncate">{user?.org_name}</div>
            </div>
          )}
          <button onClick={logout}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-red-400 hover:bg-slate-800 transition
              ${!sidebarOpen ? 'justify-center px-0' : ''}`}>
            <LogOut size={18} />
            {sidebarOpen && <span>{t('logout')}</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Top bar */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(!mobileOpen)} className="lg:hidden p-2 rounded-lg hover:bg-gray-100">
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="hidden lg:flex p-2 rounded-lg hover:bg-gray-100 text-gray-500">
              <Menu size={20} />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition">
              <Globe size={16} />
              {lang === 'en' ? 'العربية' : 'English'}
            </button>
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-medium">
              {(user?.full_name || user?.email || 'U').charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
