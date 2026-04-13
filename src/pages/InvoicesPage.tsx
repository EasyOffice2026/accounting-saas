import { useState, useEffect } from 'react';
import { useLang } from '../contexts/LangContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatDate } from '../lib/utils';
import { Plus, Search, Eye, Send } from 'lucide-react';

interface Invoice {
  id: string; invoice_no: string; invoice_date: string; due_date: string;
  customer_name: string; customer_email: string; subtotal: number; tax_amount: number;
  total: number; amount_paid: number; status: string; org_id: string; notes: string;
  items: { description: string; quantity: number; unit_price: number; tax_rate: number; total: number }[];
}

export default function InvoicesPage() {
  const { t } = useLang();
  const { user } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState({
    invoice_date: new Date().toISOString().slice(0, 10),
    due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    customer_name: '', customer_email: '', notes: '',
    items: [{ description: '', quantity: 1, unit_price: 0, tax_rate: 0, total: 0 }],
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (user?.org_id) loadInvoices(); }, [user?.org_id]);

  async function loadInvoices() {
    const { data } = await supabase.from('acct_invoices').select('*').eq('org_id', user!.org_id).order('created_at', { ascending: false });
    setInvoices(data || []);
  }

  function updateItem(idx: number, field: string, value: any) {
    const items = [...form.items];
    (items[idx] as any)[field] = value;
    items[idx].total = items[idx].quantity * items[idx].unit_price * (1 + items[idx].tax_rate / 100);
    setForm({ ...form, items });
  }

  function addItem() {
    setForm({ ...form, items: [...form.items, { description: '', quantity: 1, unit_price: 0, tax_rate: 0, total: 0 }] });
  }

  const subtotal = form.items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const taxAmount = form.items.reduce((s, i) => s + i.quantity * i.unit_price * i.tax_rate / 100, 0);
  const total = subtotal + taxAmount;

  async function handleSave() {
    setSaving(true);
    const { count } = await supabase.from('acct_invoices').select('*', { count: 'exact', head: true }).eq('org_id', user!.org_id);
    const invoiceNo = 'INV-' + String((count || 0) + 1).padStart(5, '0');

    await supabase.from('acct_invoices').insert({
      invoice_no: invoiceNo, invoice_date: form.invoice_date, due_date: form.due_date,
      customer_name: form.customer_name, customer_email: form.customer_email,
      subtotal, tax_amount: taxAmount, total, amount_paid: 0, status: 'unpaid',
      items: form.items, notes: form.notes, org_id: user!.org_id,
    });

    setShowDialog(false);
    setSaving(false);
    loadInvoices();
  }

  const filtered = invoices.filter(inv => {
    const matchSearch = !search || inv.invoice_no.toLowerCase().includes(search.toLowerCase()) ||
      inv.customer_name.toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || inv.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('invoices')}</h1>
        <button onClick={() => setShowDialog(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition shadow-sm">
          <Plus size={18} /> {t('addInvoice')}
        </button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('search') + '...'} className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-4 py-2.5 rounded-lg border border-gray-300 bg-white">
          <option value="">{t('status')}: All</option>
          <option value="unpaid">{t('unpaid')}</option>
          <option value="paid">{t('paid')}</option>
          <option value="partially_paid">{t('partiallyPaid')}</option>
          <option value="overdue">{t('overdue')}</option>
        </select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <div className="text-sm text-gray-500">{t('total')} {t('invoices')}</div>
          <div className="text-2xl font-bold text-gray-900">{invoices.length}</div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-sm text-gray-500">{t('unpaid')}</div>
          <div className="text-2xl font-bold text-amber-600">{formatCurrency(invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + (Number(i.total) - Number(i.amount_paid)), 0))}</div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-sm text-gray-500">{t('paid')}</div>
          <div className="text-2xl font-bold text-green-600">{formatCurrency(invoices.reduce((s, i) => s + Number(i.amount_paid || 0), 0))}</div>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <div className="text-sm text-gray-500">{t('overdue')}</div>
          <div className="text-2xl font-bold text-red-600">{invoices.filter(i => i.status === 'overdue').length}</div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left py-3 px-4 font-medium text-gray-500">{t('invoiceNo')}</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">{t('customer')}</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">{t('invoiceDate')}</th>
              <th className="text-left py-3 px-4 font-medium text-gray-500">{t('dueDate')}</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">{t('total')}</th>
              <th className="text-right py-3 px-4 font-medium text-gray-500">{t('balanceDue')}</th>
              <th className="text-center py-3 px-4 font-medium text-gray-500">{t('status')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-gray-400">No invoices yet</td></tr>
            ) : filtered.map(inv => (
              <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-3 px-4 font-mono text-blue-600">{inv.invoice_no}</td>
                <td className="py-3 px-4 text-gray-900">{inv.customer_name}</td>
                <td className="py-3 px-4 text-gray-600">{formatDate(inv.invoice_date)}</td>
                <td className="py-3 px-4 text-gray-600">{formatDate(inv.due_date)}</td>
                <td className="py-3 px-4 text-right font-medium">{formatCurrency(Number(inv.total))}</td>
                <td className="py-3 px-4 text-right font-medium">{formatCurrency(Number(inv.total) - Number(inv.amount_paid))}</td>
                <td className="py-3 px-4 text-center">
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    inv.status === 'paid' ? 'bg-green-100 text-green-700' :
                    inv.status === 'overdue' ? 'bg-red-100 text-red-700' :
                    inv.status === 'partially_paid' ? 'bg-blue-100 text-blue-700' :
                    'bg-amber-100 text-amber-700'
                  }`}>{t(inv.status === 'partially_paid' ? 'partiallyPaid' : inv.status)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Invoice Dialog */}
      {showDialog && (
        <div className="dialog-overlay" onClick={() => setShowDialog(false)}>
          <div className="dialog-content max-w-3xl animate-fadeIn" onClick={e => e.stopPropagation()}>
            <h2 className="text-xl font-semibold text-gray-900 mb-5">{t('addInvoice')}</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('customer')}</label>
                <input type="text" value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('email')}</label>
                <input type="email" value={form.customer_email} onChange={e => setForm({ ...form, customer_email: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('invoiceDate')}</label>
                <input type="date" value={form.invoice_date} onChange={e => setForm({ ...form, invoice_date: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('dueDate')}</label>
                <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
            </div>

            {/* Line Items */}
            <table className="w-full text-sm mb-4">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left py-2 px-3">{t('description')}</th>
                  <th className="text-right py-2 px-3 w-20">{t('quantity')}</th>
                  <th className="text-right py-2 px-3 w-28">{t('unitPrice')}</th>
                  <th className="text-right py-2 px-3 w-20">{t('taxRate')} %</th>
                  <th className="text-right py-2 px-3 w-28">{t('lineTotal')}</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {form.items.map((item, idx) => (
                  <tr key={idx} className="border-b border-gray-100">
                    <td className="py-2 px-3">
                      <input type="text" value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)}
                        className="w-full px-2 py-1.5 rounded border border-gray-300 text-sm" />
                    </td>
                    <td className="py-2 px-3">
                      <input type="number" value={item.quantity} onChange={e => updateItem(idx, 'quantity', Number(e.target.value))}
                        className="w-full px-2 py-1.5 rounded border border-gray-300 text-sm text-right" min="1" />
                    </td>
                    <td className="py-2 px-3">
                      <input type="number" value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', Number(e.target.value))}
                        className="w-full px-2 py-1.5 rounded border border-gray-300 text-sm text-right" min="0" step="0.01" />
                    </td>
                    <td className="py-2 px-3">
                      <input type="number" value={item.tax_rate} onChange={e => updateItem(idx, 'tax_rate', Number(e.target.value))}
                        className="w-full px-2 py-1.5 rounded border border-gray-300 text-sm text-right" min="0" />
                    </td>
                    <td className="py-2 px-3 text-right font-medium">{formatCurrency(item.total)}</td>
                    <td className="py-2 px-1">
                      {form.items.length > 1 && (
                        <button onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })}
                          className="text-red-400 hover:text-red-600">&times;</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={addItem} className="text-blue-600 hover:underline text-sm mb-4">+ {t('addLine')}</button>

            <div className="flex justify-end">
              <div className="w-64 space-y-1 text-sm">
                <div className="flex justify-between"><span>{t('subtotal')}</span><span>{formatCurrency(subtotal)}</span></div>
                <div className="flex justify-between"><span>{t('tax')}</span><span>{formatCurrency(taxAmount)}</span></div>
                <div className="flex justify-between font-bold text-base border-t pt-2 mt-2"><span>{t('total')}</span><span>{formatCurrency(total)}</span></div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowDialog(false)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">{t('cancel')}</button>
              <button onClick={handleSave} disabled={saving || !form.customer_name}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50">{saving ? '...' : t('save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
