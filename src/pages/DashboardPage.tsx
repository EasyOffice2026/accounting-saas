import { useState, useEffect } from 'react';
import { useLang } from '../contexts/LangContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#f59e0b', '#8b5cf6', '#ec4899'];

export default function DashboardPage() {
  const { t } = useLang();
  const { user } = useAuth();
  const [kpis, setKpis] = useState({ revenue: 0, expenses: 0, netIncome: 0, cash: 0, receivable: 0, payable: 0 });
  const [monthlyData, setMonthlyData] = useState<any[]>([]);
  const [expenseBreakdown, setExpenseBreakdown] = useState<any[]>([]);
  const [recentEntries, setRecentEntries] = useState<any[]>([]);

  useEffect(() => { if (user?.org_id) loadDashboard(); }, [user?.org_id]);

  async function loadDashboard() {
    const orgId = user?.org_id;
    if (!orgId) return;

    // Load accounts for KPIs
    const { data: accounts } = await supabase.from('acct_accounts').select('*').eq('org_id', orgId);
    if (accounts) {
      const sum = (type: string) => accounts.filter((a: any) => a.type === type).reduce((s: number, a: any) => s + (Number(a.balance) || 0), 0);
      const revenue = sum('revenue');
      const expenses = sum('expense');
      const cash = accounts.filter((a: any) => a.code === '1000' || a.code === '1010').reduce((s: number, a: any) => s + (Number(a.balance) || 0), 0);
      const receivable = accounts.filter((a: any) => a.code === '1200').reduce((s: number, a: any) => s + (Number(a.balance) || 0), 0);
      const payable = accounts.filter((a: any) => a.code === '2000').reduce((s: number, a: any) => s + (Number(a.balance) || 0), 0);
      setKpis({ revenue, expenses, netIncome: revenue - expenses, cash, receivable, payable });

      // Expense breakdown for pie chart
      const expAccounts = accounts.filter((a: any) => a.type === 'expense' && Number(a.balance) > 0);
      setExpenseBreakdown(expAccounts.map((a: any) => ({ name: a.name, value: Number(a.balance) })));
    }

    // Load recent journal entries
    const { data: entries } = await supabase.from('acct_journal_entries')
      .select('*').eq('org_id', orgId).order('entry_date', { ascending: false }).limit(10);
    setRecentEntries(entries || []);

    // Monthly revenue vs expenses (from journal lines)
    const { data: lines } = await supabase.from('acct_journal_lines')
      .select('*, acct_journal_entries!inner(entry_date, org_id, status)')
      .eq('acct_journal_entries.org_id', orgId)
      .eq('acct_journal_entries.status', 'posted');
    if (lines) {
      const monthly: Record<string, { month: string; revenue: number; expenses: number }> = {};
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = d.toISOString().slice(0, 7);
        monthly[key] = { month: d.toLocaleDateString('en', { month: 'short' }), revenue: 0, expenses: 0 };
      }
      for (const line of lines) {
        const entryDate = (line as any).acct_journal_entries?.entry_date;
        if (!entryDate) continue;
        const key = entryDate.slice(0, 7);
        if (monthly[key]) {
          // Get account type
          const acct = accounts?.find((a: any) => a.id === line.account_id);
          if (acct?.type === 'revenue') monthly[key].revenue += Number(line.credit) || 0;
          if (acct?.type === 'expense') monthly[key].expenses += Number(line.debit) || 0;
        }
      }
      setMonthlyData(Object.values(monthly));
    }
  }

  const kpiCards = [
    { label: t('totalRevenue'), value: kpis.revenue, color: 'text-green-600', bg: 'bg-green-50', icon: '📈' },
    { label: t('totalExpenses'), value: kpis.expenses, color: 'text-red-600', bg: 'bg-red-50', icon: '📉' },
    { label: t('netIncome'), value: kpis.netIncome, color: kpis.netIncome >= 0 ? 'text-blue-600' : 'text-red-600', bg: 'bg-blue-50', icon: '💰' },
    { label: t('cashBalance'), value: kpis.cash, color: 'text-indigo-600', bg: 'bg-indigo-50', icon: '🏦' },
    { label: t('accountsReceivable'), value: kpis.receivable, color: 'text-amber-600', bg: 'bg-amber-50', icon: '📋' },
    { label: t('accountsPayable'), value: kpis.payable, color: 'text-purple-600', bg: 'bg-purple-50', icon: '📝' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('dashboard')}</h1>
        <span className="text-sm text-gray-500">{user?.org_name}</span>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {kpiCards.map((kpi, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-500">{kpi.label}</span>
              <span className={`w-10 h-10 rounded-lg ${kpi.bg} flex items-center justify-center text-lg`}>{kpi.icon}</span>
            </div>
            <div className={`text-2xl font-bold ${kpi.color}`}>{formatCurrency(kpi.value)}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue vs Expenses Chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('revenueVsExpenses')}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="revenue" fill="#16a34a" name={t('revenue')} radius={[4, 4, 0, 0]} />
              <Bar dataKey="expenses" fill="#dc2626" name={t('expenses')} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Expense Breakdown Pie Chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('topExpenses')}</h3>
          {expenseBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={expenseBreakdown} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name, percent }: any) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}>
                  {expenseBreakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-gray-400">No expense data yet</div>
          )}
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('recentTransactions')}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-3 px-4 font-medium text-gray-500">{t('entryNo')}</th>
                <th className="text-left py-3 px-4 font-medium text-gray-500">{t('date')}</th>
                <th className="text-left py-3 px-4 font-medium text-gray-500">{t('description')}</th>
                <th className="text-right py-3 px-4 font-medium text-gray-500">{t('amount')}</th>
                <th className="text-center py-3 px-4 font-medium text-gray-500">{t('status')}</th>
              </tr>
            </thead>
            <tbody>
              {recentEntries.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-8 text-gray-400">No transactions yet</td></tr>
              ) : (
                recentEntries.map(entry => (
                  <tr key={entry.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-3 px-4 font-mono text-blue-600">{entry.entry_no}</td>
                    <td className="py-3 px-4 text-gray-600">{entry.entry_date}</td>
                    <td className="py-3 px-4 text-gray-900">{entry.description}</td>
                    <td className="py-3 px-4 text-right font-medium">{formatCurrency(Number(entry.total_amount) || 0)}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        entry.status === 'posted' ? 'bg-green-100 text-green-700' :
                        entry.status === 'void' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>{t(entry.status)}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
