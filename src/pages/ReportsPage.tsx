import { useState, useEffect } from 'react';
import { useLang } from '../contexts/LangContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/utils';
import { FileText, Download } from 'lucide-react';

interface Account { id: string; code: string; name: string; name_ar: string; type: string; sub_type: string; balance: number; }

type ReportType = 'trial_balance' | 'balance_sheet' | 'profit_loss';

export default function ReportsPage() {
  const { t, lang } = useLang();
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeReport, setActiveReport] = useState<ReportType>('trial_balance');
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => { if (user?.org_id) loadAccounts(); }, [user?.org_id]);

  async function loadAccounts() {
    const { data } = await supabase.from('acct_accounts').select('*').eq('org_id', user!.org_id).order('code');
    setAccounts(data || []);
  }

  const getName = (a: Account) => lang === 'ar' && a.name_ar ? a.name_ar : a.name;

  // Trial Balance
  function renderTrialBalance() {
    const rows = accounts.filter(a => Number(a.balance) !== 0);
    const totalDebit = rows.reduce((s, a) => {
      const isDebitNature = a.type === 'asset' || a.type === 'expense';
      return s + (isDebitNature && Number(a.balance) > 0 ? Number(a.balance) : (!isDebitNature && Number(a.balance) < 0 ? Math.abs(Number(a.balance)) : 0));
    }, 0);
    const totalCredit = rows.reduce((s, a) => {
      const isCreditNature = a.type === 'liability' || a.type === 'equity' || a.type === 'revenue';
      return s + (isCreditNature && Number(a.balance) > 0 ? Number(a.balance) : (!(isCreditNature) && Number(a.balance) < 0 ? Math.abs(Number(a.balance)) : 0));
    }, 0);

    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t('trialBalance')}</h2>
          <span className="text-sm text-gray-500">{t('asOf')}: {asOfDate}</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left py-3 px-4 font-medium text-gray-500">{t('accountCode')}</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">{t('accountName')}</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">{t('debit')}</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">{t('credit')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(a => {
              const isDebitNature = a.type === 'asset' || a.type === 'expense';
              const bal = Number(a.balance);
              const debit = isDebitNature ? (bal > 0 ? bal : 0) : (bal < 0 ? Math.abs(bal) : 0);
              const credit = !isDebitNature ? (bal > 0 ? bal : 0) : (bal < 0 ? Math.abs(bal) : 0);
              return (
                <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2.5 px-4 font-mono text-blue-600">{a.code}</td>
                  <td className="py-2.5 px-4">{getName(a)}</td>
                  <td className="py-2.5 px-4 text-right">{debit > 0 ? formatCurrency(debit) : '-'}</td>
                  <td className="py-2.5 px-4 text-right">{credit > 0 ? formatCurrency(credit) : '-'}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 font-bold">
              <td colSpan={2} className="py-3 px-4">{t('total')}</td>
              <td className="py-3 px-4 text-right">{formatCurrency(totalDebit)}</td>
              <td className="py-3 px-4 text-right">{formatCurrency(totalCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  // Balance Sheet
  function renderBalanceSheet() {
    const assets = accounts.filter(a => a.type === 'asset');
    const liabilities = accounts.filter(a => a.type === 'liability');
    const equity = accounts.filter(a => a.type === 'equity');
    const totalA = assets.reduce((s, a) => s + (Number(a.balance) || 0), 0);
    const totalL = liabilities.reduce((s, a) => s + (Number(a.balance) || 0), 0);
    const totalE = equity.reduce((s, a) => s + (Number(a.balance) || 0), 0);
    const revenue = accounts.filter(a => a.type === 'revenue').reduce((s, a) => s + (Number(a.balance) || 0), 0);
    const expenses = accounts.filter(a => a.type === 'expense').reduce((s, a) => s + (Number(a.balance) || 0), 0);
    const netIncome = revenue - expenses;

    const renderSection = (title: string, items: Account[], total: number) => (
      <div className="mb-6">
        <h3 className="font-semibold text-gray-900 mb-2 text-base border-b border-gray-200 pb-2">{title}</h3>
        {items.filter(a => Number(a.balance) !== 0).map(a => (
          <div key={a.id} className="flex justify-between py-1.5 px-2 hover:bg-gray-50 rounded">
            <span className="text-gray-700">{a.code} - {getName(a)}</span>
            <span className="font-medium">{formatCurrency(Number(a.balance))}</span>
          </div>
        ))}
        <div className="flex justify-between py-2 px-2 bg-gray-50 rounded mt-1 font-semibold">
          <span>{t('total')} {title}</span>
          <span>{formatCurrency(total)}</span>
        </div>
      </div>
    );

    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t('balanceSheet')}</h2>
          <span className="text-sm text-gray-500">{t('asOf')}: {asOfDate}</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            {renderSection(t('assets'), assets, totalA)}
          </div>
          <div>
            {renderSection(t('liabilities'), liabilities, totalL)}
            {renderSection(t('equity'), equity, totalE)}
            <div className="flex justify-between py-1.5 px-2 text-sm">
              <span className="text-gray-500">{t('netIncome')}</span>
              <span className="font-medium">{formatCurrency(netIncome)}</span>
            </div>
            <div className="flex justify-between py-2 px-2 bg-blue-50 rounded mt-2 font-bold text-blue-800">
              <span>{t('totalLiabilities')} + {t('equity')}</span>
              <span>{formatCurrency(totalL + totalE + netIncome)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Profit & Loss
  function renderProfitLoss() {
    const revenueAccts = accounts.filter(a => a.type === 'revenue');
    const expenseAccts = accounts.filter(a => a.type === 'expense');
    const cogsAccts = expenseAccts.filter(a => a.sub_type === 'cost_of_goods_sold');
    const opexAccts = expenseAccts.filter(a => a.sub_type === 'operating_expense');
    const totalRevenue = revenueAccts.reduce((s, a) => s + (Number(a.balance) || 0), 0);
    const totalCOGS = cogsAccts.reduce((s, a) => s + (Number(a.balance) || 0), 0);
    const grossProfit = totalRevenue - totalCOGS;
    const totalOpex = opexAccts.reduce((s, a) => s + (Number(a.balance) || 0), 0);
    const netProfit = grossProfit - totalOpex;

    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t('profitLoss')}</h2>
          <span className="text-sm text-gray-500">{t('forPeriod')}: {asOfDate}</span>
        </div>

        {/* Revenue */}
        <h3 className="font-semibold text-gray-900 mb-2 border-b border-gray-200 pb-2">{t('revenue')}</h3>
        {revenueAccts.filter(a => Number(a.balance) !== 0).map(a => (
          <div key={a.id} className="flex justify-between py-1.5 px-2 hover:bg-gray-50 rounded">
            <span className="text-gray-700">{getName(a)}</span>
            <span className="font-medium">{formatCurrency(Number(a.balance))}</span>
          </div>
        ))}
        <div className="flex justify-between py-2 px-2 bg-green-50 rounded mt-1 font-semibold text-green-800">
          <span>{t('totalRevenue')}</span>
          <span>{formatCurrency(totalRevenue)}</span>
        </div>

        {/* COGS */}
        <h3 className="font-semibold text-gray-900 mb-2 mt-4 border-b border-gray-200 pb-2">{t('costOfGoodsSold')}</h3>
        {cogsAccts.filter(a => Number(a.balance) !== 0).map(a => (
          <div key={a.id} className="flex justify-between py-1.5 px-2 hover:bg-gray-50 rounded">
            <span className="text-gray-700">{getName(a)}</span>
            <span className="font-medium text-red-600">{formatCurrency(Number(a.balance))}</span>
          </div>
        ))}
        <div className="flex justify-between py-2 px-2 bg-blue-50 rounded mt-1 font-semibold text-blue-800">
          <span>{t('grossProfit')}</span>
          <span>{formatCurrency(grossProfit)}</span>
        </div>

        {/* Operating Expenses */}
        <h3 className="font-semibold text-gray-900 mb-2 mt-4 border-b border-gray-200 pb-2">{t('operatingExpenses')}</h3>
        {opexAccts.filter(a => Number(a.balance) !== 0).map(a => (
          <div key={a.id} className="flex justify-between py-1.5 px-2 hover:bg-gray-50 rounded">
            <span className="text-gray-700">{getName(a)}</span>
            <span className="font-medium text-red-600">{formatCurrency(Number(a.balance))}</span>
          </div>
        ))}
        <div className="flex justify-between py-2 px-2 bg-gray-50 rounded mt-1 font-semibold">
          <span>{t('totalExpenses')}</span>
          <span className="text-red-600">{formatCurrency(totalOpex)}</span>
        </div>

        {/* Net Profit */}
        <div className={`flex justify-between py-3 px-3 rounded mt-4 font-bold text-lg ${netProfit >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          <span>{t('netProfit')}</span>
          <span>{formatCurrency(netProfit)}</span>
        </div>
      </div>
    );
  }

  const tabs = [
    { key: 'trial_balance' as ReportType, label: t('trialBalance'), icon: <FileText size={16} /> },
    { key: 'balance_sheet' as ReportType, label: t('balanceSheet'), icon: <FileText size={16} /> },
    { key: 'profit_loss' as ReportType, label: t('profitLoss'), icon: <FileText size={16} /> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('reports')}</h1>
        <input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)}
          className="px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
      </div>

      {/* Report Tabs */}
      <div className="flex gap-2 border-b border-gray-200 pb-1">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveReport(tab.key)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-sm font-medium transition ${
              activeReport === tab.key ? 'bg-white border border-b-white border-gray-200 text-blue-600 -mb-[1px]' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Report Content */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        {activeReport === 'trial_balance' && renderTrialBalance()}
        {activeReport === 'balance_sheet' && renderBalanceSheet()}
        {activeReport === 'profit_loss' && renderProfitLoss()}
      </div>
    </div>
  );
}
