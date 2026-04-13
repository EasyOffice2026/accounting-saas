import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import en from '../i18n/en';
import ar from '../i18n/ar';

type Lang = 'en' | 'ar';
interface LangContextType {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
  dir: 'ltr' | 'rtl';
}

const LangContext = createContext<LangContextType>({
  lang: 'en', setLang: () => {}, t: (k) => k, dir: 'ltr'
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('acct_lang') as Lang) || 'en');

  useEffect(() => {
    localStorage.setItem('acct_lang', lang);
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);

  const translations = lang === 'ar' ? ar : en;
  const t = (key: string) => translations[key] || key;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  return (
    <LangContext.Provider value={{ lang, setLang, t, dir }}>
      {children}
    </LangContext.Provider>
  );
}

export const useLang = () => useContext(LangContext);
