import { useState, useEffect } from 'react';
import { useLang } from '../contexts/LangContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Save, Building2, Globe, Calendar } from 'lucide-react';

export default function SettingsPage() {
  const { t, lang, setLang } = useLang();
  const { user } = useAuth();
  const [form, setForm] = useState({
    name: '', address: '', phone: '', email: '', tax_id: '',
    base_currency: 'KWD', fiscal_year_start: '01', date_format: 'YYYY-MM-DD',
    invoice_prefix: 'INV', bill_prefix: 'BILL', timezone: 'Asia/Kuwait',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (user?.org_id) loadSettings(); }, [user?.org_id]);

  async function loadSettings() {
    const { data } = await supabase.from('acct_organizations').select('*').eq('id', user!.org_id).single();
    if (data) {
      setForm({
        name: data.name || '', address: data.address || '', phone: data.phone || '',
        email: data.email || '', tax_id: data.tax_id || '',
        base_currency: data.base_currency || 'KWD',
        fiscal_year_start: data.fiscal_year_start || '01',
        date_format: data.date_format || 'YYYY-MM-DD',
        invoice_prefix: data.invoice_prefix || 'INV',
        bill_prefix: data.bill_prefix || 'BILL',
        timezone: data.timezone || 'Asia/Kuwait',
      });
    }
  }

  async function handleSave() {
    setSaving(true);
    await supabase.from('acct_organizations').update(form).eq('id', user!.org_id);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">{t('settings')}</h1>

      {saved && (
        <div className="p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">Settings saved successfully!</div>
      )}

      {/* Company Information */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <Building2 size={20} className="text-blue-600" />
          <h2 className="text-lg font-semibold text-gray-900">{t('companyInfo')}</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('companyName')}</label>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('email')}</label>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('phone')}</label>
              <input type="text" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('address')}</label>
            <textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={2}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('taxId')}</label>
            <input type="text" value={form.tax_id} onChange={e => setForm({ ...form, tax_id: e.target.value })}
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
        </div>
      </div>

      {/* Accounting Settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <Calendar size={20} className="text-blue-600" />
          <h2 className="text-lg font-semibold text-gray-900">{t('generalSettings')}</h2>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('baseCurrency')}</label>
              <select value={form.base_currency} onChange={e => setForm({ ...form, base_currency: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                <option value="KWD">KWD - Kuwaiti Dinar</option>
                <option value="USD">USD - US Dollar</option>
                <option value="EUR">EUR - Euro</option>
                <option value="GBP">GBP - British Pound</option>
                <option value="SAR">SAR - Saudi Riyal</option>
                <option value="AED">AED - UAE Dirham</option>
                <option value="QAR">QAR - Qatari Riyal</option>
                <option value="BHD">BHD - Bahraini Dinar</option>
                <option value="OMR">OMR - Omani Rial</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('fiscalYear')} Start</label>
              <select value={form.fiscal_year_start} onChange={e => setForm({ ...form, fiscal_year_start: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                  <option key={i} value={String(i + 1).padStart(2, '0')}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('invoicePrefix')}</label>
              <input type="text" value={form.invoice_prefix} onChange={e => setForm({ ...form, invoice_prefix: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('billPrefix')}</label>
              <input type="text" value={form.bill_prefix} onChange={e => setForm({ ...form, bill_prefix: e.target.value })}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
        </div>
      </div>

      {/* Language Settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <Globe size={20} className="text-blue-600" />
          <h2 className="text-lg font-semibold text-gray-900">{t('language')}</h2>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setLang('en')}
            className={`px-4 py-2.5 rounded-lg border font-medium transition ${lang === 'en' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
            English
          </button>
          <button onClick={() => setLang('ar')}
            className={`px-4 py-2.5 rounded-lg border font-medium transition ${lang === 'ar' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
            العربية
          </button>
        </div>
      </div>

      <button onClick={handleSave} disabled={saving}
        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 transition shadow-sm">
        <Save size={18} /> {saving ? '...' : t('save')}
      </button>
    </div>
  );
}
