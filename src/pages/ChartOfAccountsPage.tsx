import { useState, useEffect } from 'react';
import { useLang } from '../contexts/LangContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/utils';
import { Plus, Pencil, Trash2, Search, ChevronDown, ChevronRight } from 'lucide-react';

interface Account {
  id: string;
  code: string;
  name: string;
  name_ar: string;
  type: string;
  sub_type: string;
  parent_id: string | null;
  balance: number;
  is_active: boolean;
  org_id: string;
}

const ACCOUNT_TYPES = [
  { value: 'asset', label: 'assets', subTypes: ['current_asset', 'fixed_asset'] },
  { value: 'liability', label: 'liabilities', subTypes: ['current_liability', 'long_term_liability'] },
  { value: 'equity', label: 'equity', subTypes: ['owners_equity'] },
  { value: 'revenue', label: 'revenue', subTypes: ['operating_revenue', 'other_revenue'] },
  { value: 'expense', label: 'expenses', subTypes: ['cost_of_goods_sold', 'operating_expense'] },
];

const SUB_TYPE_LABELS: Record<string, string> = {
  current_asset: 'currentAssets', fixed_asset: 'fixedAssets',
  current_liability: 'currentLiabilities', long_term_liability: 'longTermLiabilities',
  owners_equity: 'ownersEquity', operating_revenue: 'operatingRevenue', other_revenue: 'otherRevenue',
  cost_of_goods_sold: 'costOfGoodsSold', operating_expense: 'operatingExpenses',
};

const defaultForm = { code: '', name: '', name_ar: '', type: 'asset', sub_type: 'current_asset', parent_id: '', balance: 0, is_active: true };

export default function ChartOfAccountsPage() {
  const { t, lang } = useLang();
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => { if (user?.org_id) loadAccounts(); }, [user?.org_id]);

  async function loadAccounts() {
    const { data } = await supabase.from('acct_accounts')
      .select('*').eq('org_id', user!.org_id).order('code');
    setAccounts(data || []);
  }

  function openAdd() {
    setEditing(null);
    setForm(defaultForm);
    setShowDialog(true);
  }

  function openEdit(acct: Account) {
    setEditing(acct);
    setForm({
      code: acct.code, name: acct.name, name_ar: acct.name_ar || '',
      type: acct.type, sub_type: acct.sub_type || '', parent_id: acct.parent_id || '',
      balance: acct.balance || 0, is_active: acct.is_active,
    });
    setShowDialog(true);
  }

  async function handleSave() {
    const data = { ...form, balance: Number(form.balance) || 0, org_id: user!.org_id, parent_id: form.parent_id || null };
    if (editing) {
      await supabase.from('acct_accounts').update(data).eq('id', editing.id);
    } else {
      await supabase.from('acct_accounts').insert(data);
    }
    setShowDialog(false);
    loadAccounts();
  }

  async function handleDelete(id: string) {
    if (!confirm(t('confirmDelete'))) return;
    await supabase.from('acct_accounts').delete().eq('id', id);
    loadAccounts();
  }

  const filtered = accounts.filter(a => {
    const matchSearch = !search || a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.code.includes(search) || (a.name_ar && a.name_ar.includes(search));
    const matchType = !filterType || a.type === filterType;
    return matchSearch && matchType;
  });

  // Group by type
  const grouped = ACCOUNT_TYPES.map(at => ({
    ...at,
    accounts: filtered.filter(a => a.type === at.value),
    total: filtered.filter(a => a.type === at.value).reduce((s, a) => s + (Number(a.balance) || 0), 0),
  }));

  function toggleType(type: string) {
    setExpanded(prev => ({ ...prev, [type]: !prev[type] }));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('chartOfAccounts')}</h1>
        <button onClick={openAdd}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition shadow-sm">
          <Plus size={18} /> {t('addAccount')}
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('search') + '...'}
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
        </div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none bg-white">
          <option value="">{t('type')}: All</option>
          {ACCOUNT_TYPES.map(at => (
            <option key={at.value} value={at.value}>{t(at.label)}</option>
          ))}
        </select>
      </div>

      {/* Account Groups */}
      <div className="space-y-3">
        {grouped.map(group => (
          <div key={group.value} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <button onClick={() => toggleType(group.value)}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition">
              <div className="flex items-center gap-3">
                {expanded[group.value] !== false ? <ChevronDown size={20} className="text-gray-400" /> : <ChevronRight size={20} className="text-gray-400" />}
                <span className="font-semibold text-gray-900">{t(group.label)}</span>
                <span className="text-sm text-gray-500">({group.accounts.length})</span>
              </div>
              <span className="font-semibold text-gray-700">{formatCurrency(group.total)}</span>
            </button>
            {expanded[group.value] !== false && group.accounts.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-t border-gray-100">
                    <th className="text-left py-2.5 px-4 font-medium text-gray-500">{t('accountCode')}</th>
                    <th className="text-left py-2.5 px-4 font-medium text-gray-500">{t('accountName')}</th>
                    <th className="text-left py-2.5 px-4 font-medium text-gray-500">{t('accountType')}</th>
                    <th className="text-right py-2.5 px-4 font-medium text-gray-500">{t('balance')}</th>
                    <th className="text-center py-2.5 px-4 font-medium text-gray-500">{t('status')}</th>
                    <th className="text-center py-2.5 px-4 font-medium text-gray-500">{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {group.accounts.map(acct => (
                    <tr key={acct.id} className="border-t border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 px-4 font-mono text-blue-600">{acct.code}</td>
                      <td className="py-2.5 px-4 text-gray-900">{lang === 'ar' && acct.name_ar ? acct.name_ar : acct.name}</td>
                      <td className="py-2.5 px-4 text-gray-500 text-xs">{acct.sub_type ? t(SUB_TYPE_LABELS[acct.sub_type] || acct.sub_type) : ''}</td>
                      <td className="py-2.5 px-4 text-right font-medium">{formatCurrency(Number(acct.balance) || 0)}</td>
                      <td className="py-2.5 px-4 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${acct.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {acct.is_active ? t('active') : t('inactive')}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => openEdit(acct)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600"><Pencil size={15} /></button>
                          <button onClick={() => handleDelete(acct.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-600"><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>

      {/* Add/Edit Dialog */}
      {showDialog && (
        <div className="dialog-overlay" onClick={() => setShowDialog(false)}>
          <div className="dialog-content max-w-lg animate-fadeIn" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-semibold text-gray-900 mb-5">{editing ? t('editAccount') : t('addAccount')}</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('accountCode')}</label>
                  <input type="text" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('accountType')}</label>
                  <select value={form.type} onChange={e => {
                    const newType = e.target.value;
                    const at = ACCOUNT_TYPES.find(a => a.value === newType);
                    setForm({ ...form, type: newType, sub_type: at?.subTypes[0] || '' });
                  }} className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    {ACCOUNT_TYPES.map(at => <option key={at.value} value={at.value}>{t(at.label)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('accountName')} (English)</label>
                <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('accountName')} (Arabic)</label>
                <input type="text" value={form.name_ar} onChange={e => setForm({ ...form, name_ar: e.target.value })} dir="rtl"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Sub Type</label>
                  <select value={form.sub_type} onChange={e => setForm({ ...form, sub_type: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                    {ACCOUNT_TYPES.find(a => a.value === form.type)?.subTypes.map(st => (
                      <option key={st} value={st}>{t(SUB_TYPE_LABELS[st] || st)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('openingBalance')}</label>
                  <input type="number" value={form.balance} onChange={e => setForm({ ...form, balance: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('parentAccount')}</label>
                <select value={form.parent_id} onChange={e => setForm({ ...form, parent_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                  <option value="">-- None --</option>
                  {accounts.filter(a => a.type === form.type && a.id !== editing?.id).map(a => (
                    <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <span className="text-sm text-gray-700">{t('active')}</span>
              </label>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowDialog(false)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition">{t('cancel')}</button>
              <button onClick={handleSave}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition">{t('save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
