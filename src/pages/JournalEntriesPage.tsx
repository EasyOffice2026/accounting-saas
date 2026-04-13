import { useState, useEffect } from 'react';
import { useLang } from '../contexts/LangContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatDate } from '../lib/utils';
import { Plus, Search, CheckCircle, XCircle, Eye } from 'lucide-react';

interface Account { id: string; code: string; name: string; name_ar: string; type: string; }
interface JournalLine { id?: string; account_id: string; description: string; debit: number; credit: number; }
interface JournalEntry {
  id: string; entry_no: string; entry_date: string; description: string;
  status: string; total_amount: number; reference: string; org_id: string;
  lines?: JournalLine[];
}

export default function JournalEntriesPage() {
  const { t, lang } = useLang();
  const { user } = useAuth();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [showView, setShowView] = useState<JournalEntry | null>(null);
  const [viewLines, setViewLines] = useState<any[]>([]);
  const [form, setForm] = useState({ entry_date: new Date().toISOString().slice(0, 10), description: '', reference: '' });
  const [lines, setLines] = useState<JournalLine[]>([
    { account_id: '', description: '', debit: 0, credit: 0 },
    { account_id: '', description: '', debit: 0, credit: 0 },
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (user?.org_id) { loadEntries(); loadAccounts(); } }, [user?.org_id]);

  async function loadAccounts() {
    const { data } = await supabase.from('acct_accounts').select('id, code, name, name_ar, type').eq('org_id', user!.org_id).order('code');
    setAccounts(data || []);
  }

  async function loadEntries() {
    const { data } = await supabase.from('acct_journal_entries')
      .select('*').eq('org_id', user!.org_id).order('created_at', { ascending: false });
    setEntries(data || []);
  }

  function addLine() {
    setLines([...lines, { account_id: '', description: '', debit: 0, credit: 0 }]);
  }

  function removeLine(idx: number) {
    if (lines.length <= 2) return;
    setLines(lines.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, field: string, value: any) {
    const updated = [...lines];
    (updated[idx] as any)[field] = value;
    // Auto-clear opposite side
    if (field === 'debit' && Number(value) > 0) updated[idx].credit = 0;
    if (field === 'credit' && Number(value) > 0) updated[idx].debit = 0;
    setLines(updated);
  }

  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  async function handleSave(postImmediately = false) {
    if (!isBalanced) { alert('Entry must be balanced (total debit = total credit)'); return; }
    setSaving(true);

    // Generate entry number
    const { count } = await supabase.from('acct_journal_entries').select('*', { count: 'exact', head: true }).eq('org_id', user!.org_id);
    const entryNo = 'JE-' + String((count || 0) + 1).padStart(5, '0');

    const { data: entry, error } = await supabase.from('acct_journal_entries').insert({
      entry_no: entryNo, entry_date: form.entry_date, description: form.description,
      reference: form.reference, status: postImmediately ? 'posted' : 'draft',
      total_amount: totalDebit, org_id: user!.org_id,
    }).select().single();

    if (error || !entry) { alert('Error saving entry'); setSaving(false); return; }

    // Insert lines
    const lineData = lines.filter(l => l.account_id).map(l => ({
      entry_id: entry.id, account_id: l.account_id, description: l.description,
      debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, org_id: user!.org_id,
    }));
    await supabase.from('acct_journal_lines').insert(lineData);

    // If posting, update account balances
    if (postImmediately) await updateBalances(lineData);

    setShowDialog(false);
    setForm({ entry_date: new Date().toISOString().slice(0, 10), description: '', reference: '' });
    setLines([{ account_id: '', description: '', debit: 0, credit: 0 }, { account_id: '', description: '', debit: 0, credit: 0 }]);
    setSaving(false);
    loadEntries();
  }

  async function updateBalances(lineData: any[]) {
    for (const line of lineData) {
      const acct = accounts.find(a => a.id === line.account_id);
      if (!acct) continue;
      // Assets & Expenses increase with debit; Liabilities, Equity, Revenue increase with credit
      const isDebitNature = acct.type === 'asset' || acct.type === 'expense';
      const change = isDebitNature ? (line.debit - line.credit) : (line.credit - line.debit);
      const { data: current } = await supabase.from('acct_accounts').select('balance').eq('id', line.account_id).single();
      await supabase.from('acct_accounts').update({ balance: (Number(current?.balance) || 0) + change }).eq('id', line.account_id);
    }
  }

  async function postEntry(entry: JournalEntry) {
    if (!confirm(t('confirmPost'))) return;
    const { data: entryLines } = await supabase.from('acct_journal_lines').select('*').eq('entry_id', entry.id);
    if (entryLines) await updateBalances(entryLines);
    await supabase.from('acct_journal_entries').update({ status: 'posted' }).eq('id', entry.id);
    loadEntries();
  }

  async function voidEntry(entry: JournalEntry) {
    if (!confirm(t('confirmVoid'))) return;
    if (entry.status === 'posted') {
      // Reverse balances
      const { data: entryLines } = await supabase.from('acct_journal_lines').select('*').eq('entry_id', entry.id);
      if (entryLines) {
        const reversed = entryLines.map((l: any) => ({ ...l, debit: l.credit, credit: l.debit }));
        await updateBalances(reversed);
      }
    }
    await supabase.from('acct_journal_entries').update({ status: 'void' }).eq('id', entry.id);
    loadEntries();
  }

  async function viewEntry(entry: JournalEntry) {
    const { data: entryLines } = await supabase.from('acct_journal_lines').select('*, acct_accounts(code, name, name_ar)').eq('entry_id', entry.id);
    setViewLines(entryLines || []);
    setShowView(entry);
  }

  const filtered = entries.filter(e => {
    const matchSearch = !search || e.entry_no.toLowerCase().includes(search.toLowerCase()) ||
      e.description.toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || e.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('journalEntries')}</h1>
        <button onClick={() => setShowDialog(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition shadow-sm">
          <Plus size={18} /> {t('addJournalEntry')}
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('search') + '...'} className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none bg-white">
          <option value="">{t('status')}: All</option>
          <option value="draft">{t('draft')}</option>
          <option value="posted">{t('posted')}</option>
          <option value="void">{t('void')}</option>
        </select>
      </div>

      {/* Entries Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left py-3 px-4 font-medium text-gray-500">{t('entryNo')}</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">{t('date')}</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">{t('description')}</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">{t('reference')}</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">{t('amount')}</th>
              <th className="text-center py-3 px-4 font-medium text-gray-500">{t('status')}</th>
              <th className="text-center py-3 px-4 font-medium text-gray-500">{t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-gray-400">No journal entries yet</td></tr>
            ) : filtered.map(entry => (
              <tr key={entry.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-3 px-4 font-mono text-blue-600">{entry.entry_no}</td>
                <td className="py-3 px-4 text-gray-600">{formatDate(entry.entry_date)}</td>
                <td className="py-3 px-4 text-gray-900">{entry.description}</td>
                <td className="py-3 px-4 text-gray-500">{entry.reference || '-'}</td>
                <td className="py-3 px-4 text-right font-medium">{formatCurrency(Number(entry.total_amount) || 0)}</td>
                <td className="py-3 px-4 text-center">
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    entry.status === 'posted' ? 'bg-green-100 text-green-700' :
                    entry.status === 'void' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                  }`}>{t(entry.status)}</span>
                </td>
                <td className="py-3 px-4 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => viewEntry(entry)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600" title="View"><Eye size={15} /></button>
                    {entry.status === 'draft' && (
                      <button onClick={() => postEntry(entry)} className="p-1.5 rounded-lg hover:bg-green-50 text-green-600" title={t('postEntry')}><CheckCircle size={15} /></button>
                    )}
                    {entry.status !== 'void' && (
                      <button onClick={() => voidEntry(entry)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-600" title={t('voidEntry')}><XCircle size={15} /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Journal Entry Dialog */}
      {showDialog && (
        <div className="dialog-overlay" onClick={() => setShowDialog(false)}>
          <div className="dialog-content max-w-4xl animate-fadeIn" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-semibold text-gray-900 mb-5">{t('addJournalEntry')}</h2>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('entryDate')}</label>
                <input type="date" value={form.entry_date} onChange={e => setForm({ ...form, entry_date: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('description')}</label>
                <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('reference')}</label>
                <input type="text" value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
            </div>

            {/* Journal Lines */}
            <table className="w-full text-sm mb-4">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left py-2 px-3 font-medium text-gray-500">{t('account')}</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">{t('description')}</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-500 w-32">{t('debit')}</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-500 w-32">{t('credit')}</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={idx} className="border-b border-gray-100">
                    <td className="py-2 px-3">
                      <select value={line.account_id} onChange={e => updateLine(idx, 'account_id', e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none bg-white text-sm">
                        <option value="">{t('selectAccount')}</option>
                        {accounts.map(a => (
                          <option key={a.id} value={a.id}>{a.code} - {lang === 'ar' && a.name_ar ? a.name_ar : a.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-3">
                      <input type="text" value={line.description} onChange={e => updateLine(idx, 'description', e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                    </td>
                    <td className="py-2 px-3">
                      <input type="number" value={line.debit || ''} onChange={e => updateLine(idx, 'debit', Number(e.target.value))}
                        className="w-full px-2 py-1.5 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none text-sm text-right" min="0" step="0.01" />
                    </td>
                    <td className="py-2 px-3">
                      <input type="number" value={line.credit || ''} onChange={e => updateLine(idx, 'credit', Number(e.target.value))}
                        className="w-full px-2 py-1.5 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none text-sm text-right" min="0" step="0.01" />
                    </td>
                    <td className="py-2 px-1">
                      <button onClick={() => removeLine(idx)} className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600">&times;</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-medium">
                  <td colSpan={2} className="py-2 px-3">
                    <button onClick={addLine} className="text-blue-600 hover:underline text-sm">+ {t('addLine')}</button>
                  </td>
                  <td className="py-2 px-3 text-right">{formatCurrency(totalDebit)}</td>
                  <td className="py-2 px-3 text-right">{formatCurrency(totalCredit)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>

            {/* Balance indicator */}
            <div className={`flex items-center gap-2 mb-4 px-3 py-2 rounded-lg text-sm font-medium ${isBalanced ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {isBalanced ? <CheckCircle size={16} /> : <XCircle size={16} />}
              {isBalanced ? t('balanced') : `${t('unbalanced')} — ${t('difference')}: ${formatCurrency(Math.abs(totalDebit - totalCredit))}`}
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={() => setShowDialog(false)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition">{t('cancel')}</button>
              <button onClick={() => handleSave(false)} disabled={!isBalanced || saving}
                className="px-4 py-2 rounded-lg bg-amber-500 text-white font-medium hover:bg-amber-600 disabled:opacity-50 transition">
                {saving ? '...' : t('draft')}
              </button>
              <button onClick={() => handleSave(true)} disabled={!isBalanced || saving}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 transition">
                {saving ? '...' : t('postEntry')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Entry Dialog */}
      {showView && (
        <div className="dialog-overlay" onClick={() => setShowView(null)}>
          <div className="dialog-content max-w-3xl animate-fadeIn" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-semibold text-gray-900">{showView.entry_no}</h2>
              <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                showView.status === 'posted' ? 'bg-green-100 text-green-700' :
                showView.status === 'void' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
              }`}>{t(showView.status)}</span>
            </div>
            <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
              <div><span className="text-gray-500">{t('date')}:</span> <span className="font-medium">{formatDate(showView.entry_date)}</span></div>
              <div><span className="text-gray-500">{t('description')}:</span> <span className="font-medium">{showView.description}</span></div>
              <div><span className="text-gray-500">{t('reference')}:</span> <span className="font-medium">{showView.reference || '-'}</span></div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left py-2 px-3 font-medium text-gray-500">{t('account')}</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">{t('description')}</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-500">{t('debit')}</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-500">{t('credit')}</th>
                </tr>
              </thead>
              <tbody>
                {viewLines.map((line: any, idx: number) => (
                  <tr key={idx} className="border-b border-gray-100">
                    <td className="py-2 px-3 font-mono text-blue-600">
                      {line.acct_accounts?.code} - {lang === 'ar' && line.acct_accounts?.name_ar ? line.acct_accounts.name_ar : line.acct_accounts?.name}
                    </td>
                    <td className="py-2 px-3 text-gray-600">{line.description || '-'}</td>
                    <td className="py-2 px-3 text-right">{Number(line.debit) > 0 ? formatCurrency(Number(line.debit)) : '-'}</td>
                    <td className="py-2 px-3 text-right">{Number(line.credit) > 0 ? formatCurrency(Number(line.credit)) : '-'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-medium">
                  <td colSpan={2} className="py-2 px-3">{t('total')}</td>
                  <td className="py-2 px-3 text-right">{formatCurrency(viewLines.reduce((s: number, l: any) => s + (Number(l.debit) || 0), 0))}</td>
                  <td className="py-2 px-3 text-right">{formatCurrency(viewLines.reduce((s: number, l: any) => s + (Number(l.credit) || 0), 0))}</td>
                </tr>
              </tfoot>
            </table>
            <div className="flex justify-end mt-4">
              <button onClick={() => setShowView(null)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition">{t('cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
