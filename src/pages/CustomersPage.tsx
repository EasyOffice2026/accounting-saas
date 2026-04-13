import { useState, useEffect } from 'react';
import { useLang } from '../contexts/LangContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/utils';
import { Plus, Search, Pencil, Trash2 } from 'lucide-react';

interface Customer {
  id: string; name: string; email: string; phone: string; address: string;
  tax_id: string; contact_name: string; outstanding_balance: number; org_id: string;
}

export default function CustomersPage() {
  const { t } = useLang();
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '', tax_id: '', contact_name: '' });

  useEffect(() => { if (user?.org_id) loadCustomers(); }, [user?.org_id]);

  async function loadCustomers() {
    const { data } = await supabase.from('acct_customers').select('*').eq('org_id', user!.org_id).order('name');
    setCustomers(data || []);
  }

  function openAdd() { setEditing(null); setForm({ name: '', email: '', phone: '', address: '', tax_id: '', contact_name: '' }); setShowDialog(true); }
  function openEdit(c: Customer) {
    setEditing(c);
    setForm({ name: c.name, email: c.email || '', phone: c.phone || '', address: c.address || '', tax_id: c.tax_id || '', contact_name: c.contact_name || '' });
    setShowDialog(true);
  }

  async function handleSave() {
    const data = { ...form, org_id: user!.org_id };
    if (editing) {
      await supabase.from('acct_customers').update(data).eq('id', editing.id);
    } else {
      await supabase.from('acct_customers').insert(data);
    }
    setShowDialog(false);
    loadCustomers();
  }

  async function handleDelete(id: string) {
    if (!confirm(t('confirmDelete'))) return;
    await supabase.from('acct_customers').delete().eq('id', id);
    loadCustomers();
  }

  const filtered = customers.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.email?.includes(search));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('customers')}</h1>
        <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition shadow-sm">
          <Plus size={18} /> {t('addCustomer')}
        </button>
      </div>

      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder={t('search') + '...'} className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left py-3 px-4 font-medium text-gray-500">{t('name')}</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">{t('contactName')}</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">{t('email')}</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">{t('phone')}</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">{t('outstandingBalance')}</th>
              <th className="text-center py-3 px-4 font-medium text-gray-500">{t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-gray-400">No customers yet</td></tr>
            ) : filtered.map(c => (
              <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-3 px-4 font-medium text-gray-900">{c.name}</td>
                <td className="py-3 px-4 text-gray-600">{c.contact_name || '-'}</td>
                <td className="py-3 px-4 text-gray-600">{c.email || '-'}</td>
                <td className="py-3 px-4 text-gray-600">{c.phone || '-'}</td>
                <td className="py-3 px-4 text-right font-medium">{formatCurrency(Number(c.outstanding_balance) || 0)}</td>
                <td className="py-3 px-4 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600"><Pencil size={15} /></button>
                    <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-600"><Trash2 size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showDialog && (
        <div className="dialog-overlay" onClick={() => setShowDialog(false)}>
          <div className="dialog-content max-w-lg animate-fadeIn" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-semibold text-gray-900 mb-5">{editing ? t('edit') : t('addCustomer')}</h2>
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('name')} *</label>
                <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('contactName')}</label>
                <input type="text" value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('email')}</label>
                  <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('phone')}</label>
                  <input type="text" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('address')}</label>
                <textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={2} className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('taxId')}</label>
                <input type="text" value={form.tax_id} onChange={e => setForm({ ...form, tax_id: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowDialog(false)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">{t('cancel')}</button>
              <button onClick={handleSave} disabled={!form.name} className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50">{t('save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
