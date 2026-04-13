import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLang } from '../contexts/LangContext';

export default function LoginPage() {
  const { login, signup } = useAuth();
  const { t, lang, setLang } = useLang();
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (isSignup && password !== confirmPw) { setError('Passwords do not match'); return; }
    setLoading(true);
    const result = isSignup
      ? await signup(email, password, fullName, companyName)
      : await login(email, password);
    if (result.error) setError(result.error);
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <div className="absolute top-4 right-4">
        <button onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
          className="px-3 py-1.5 text-sm rounded-lg bg-white shadow-sm border border-gray-200 hover:bg-gray-50">
          {lang === 'en' ? 'العربية' : 'English'}
        </button>
      </div>
      <div className="w-full max-w-md mx-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 text-white text-2xl font-bold mb-4 shadow-lg">
            AB
          </div>
          <h1 className="text-3xl font-bold text-gray-900">{t('appName')}</h1>
          <p className="text-gray-500 mt-1">{t('appTagline')}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">
            {isSignup ? t('signup') : t('login')}
          </h2>
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignup && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('fullName')}</label>
                  <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} required
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('companyName')}</label>
                  <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} required
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition" />
                </div>
              </>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('email')}</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('password')}</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6}
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition" />
            </div>
            {isSignup && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('confirmPassword')}</label>
                <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition" />
              </div>
            )}
            <button type="submit" disabled={loading}
              className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 transition shadow-sm">
              {loading ? '...' : isSignup ? t('signup') : t('login')}
            </button>
          </form>
          <div className="mt-6 text-center text-sm text-gray-500">
            {isSignup ? t('hasAccount') : t('noAccount')}{' '}
            <button onClick={() => { setIsSignup(!isSignup); setError(''); }}
              className="text-blue-600 font-medium hover:underline">
              {isSignup ? t('login') : t('signup')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
