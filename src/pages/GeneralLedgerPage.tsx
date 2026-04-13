import { useState, useEffect } from 'react';
import { useLang } from '../contexts/LangContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatDate } from '../lib/utils';
import { Search } from 'lucide-react';

interface Account { id: string; code: string; name: string; name_ar: string; type: string; balance: number; }

export default function GeneralLedgerPage() {
  const { t, lang } = useLang();
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [ledgerLines, setLedgerLines] = useState<any[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => { if (user?.org_id) loadAccounts(); }, [user?.org_id]);

  async function loadAccounts() {
    const { data } = await supabase.from('acct_accounts').select('id, code, name, name_ar, type, balance')
      .eq('org_id', user!.org_id).order('code');
    setAccounts(data || []);
  }

  async function loadLedger(accountId: string) {
    setSelectedAccount(accountId);
    if (!accountId) { setLedgerLines([]); return; }

    let query = supabase.from('acct_journal_lines')
      .select('*, acct_journal_entries!inner(entry_no, entry_date, description, status, org_id)')
      .eq('account_id', accountId)
      .eq('acct_journal_entries.org_id', user!.org_id)
      .eq('acct_journal_entries.status', 'posted')
      .order('created_at', { ascending: true });

    const { data } = await query;
    let filtered = data || [];

    if (dateFrom) filtered = filtered.filter((l: any) => l.acct_journal_entries.entry_date >= dateFrom);
    if (dateTo) filtered = filtered.filter((l: any) => l.acct_journal_entries.entry_date <= dateTo);

    // Calculate running balance
    const acct = accounts.find(a => a.id === accountId);
    const isDebitNature = acct?.type === 'asset' || acct?.type === 'expense';
    let runningBalance = 0;

    const withBalance = filtered.map((line: any) => {
      const change = isDebitNature
        ? (Number(line.debit) || 0) - (Number(line.credit) || 0)
        : (Number(line.credit) || 0) - (Number(line.debit) || 0);
      runningBalance += change;
      return { ...line, runningBalance };
    });

    setLedgerLines(withBalance);
  }

  useEffect(() => { if (selectedAccount) loadLedger(selectedAccount); }, [dateFrom, dateTo]);

  const selectedAcct = accounts.find(a => a.id === selectedAccount);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">{t('generalLedger')}</h1>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select value={selectedAccount} onChange={e => loadLedger(e.target.value)}
          className="flex-1 min-w-[250px] px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none bg-white">
          <option value="">{t('selectAccount')}</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.code} - {lang === 'ar' && a.name_ar ? a.name_ar : a.name}</option>
          ))}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
      </div>

      {/* Account Summary */}
      {selectedAcct && (
        <div className="bg-blue-50 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-blue-800 font-semibold text-lg">{selectedAcct.code} - {lang === 'ar' && selectedAcct.name_ar ? selectedAcct.name_ar : selectedAcct.name}</span>
            <span className="ml-3 text-sm text-blue-600 capitalize">{t(selectedAcct.type)}</span>
          </div>
          <div className="text-right">
            <span className="text-sm text-blue-600">{t('balance')}</span>
            <div className="text-xl font-bold text-blue-800">{formatCurrency(Number(selectedAcct.balance) || 0)}</div>
          </div>
        </div>
      )}

      {/* Ledger Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left py-3 px-4 font-medium text-gray-500">{t('date')}</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">{t('entryNo')}</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">{t('description')}</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">{t('debit')}</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">{t('credit')}</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">{t('balance')}</th>
            </tr>
          </thead>
          <tbody>
            {!selectedAccount ? (
              <tr><td colSpan={6} className="text-center py-8 text-gray-400">Select an account to view its ledger</td></tr>
            ) : ledgerLines.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-gray-400">No transactions for this account</td></tr>
            ) : ledgerLines.map((line: any, idx: number) => (
              <tr key={idx} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-3 px-4 text-gray-600">{formatDate(line.acct_journal_entries?.entry_date)}</td>
                <td className="py-3 px-4 font-mono text-blue-600">{line.acct_journal_entries?.entry_no}</td>
                <td className="py-3 px-4 text-gray-900">{line.description || line.acct_journal_entries?.description}</td>
                <td className="py-3 px-4 text-right">{Number(line.debit) > 0 ? formatCurrency(Number(line.debit)) : '-'}</td>
                <td className="py-3 px-4 text-right">{Number(line.credit) > 0 ? formatCurrency(Number(line.credit)) : '-'}</td>
                <td className="py-3 px-4 text-right font-medium">{formatCurrency(line.runningBalance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
