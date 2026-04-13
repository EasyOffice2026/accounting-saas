import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';

interface User {
  id: string;
  email: string;
  full_name?: string;
  role?: string;
  org_id?: string;
  org_name?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ error?: string }>;
  signup: (email: string, password: string, fullName: string, companyName: string) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null, loading: true,
  login: async () => ({}),
  signup: async () => ({}),
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkUser();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => checkUser());
    return () => subscription.unsubscribe();
  }, []);

  async function checkUser() {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const { data: profile } = await supabase
          .from('acct_user_profiles')
          .select('full_name, role, org_id')
          .eq('id', authUser.id)
          .single();
        let orgName = '';
        if (profile?.org_id) {
          const { data: org } = await supabase.from('acct_organizations').select('name').eq('id', profile.org_id).single();
          orgName = org?.name || '';
        }
        setUser({
          id: authUser.id, email: authUser.email || '',
          full_name: profile?.full_name, role: profile?.role || 'owner',
          org_id: profile?.org_id, org_name: orgName,
        });
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
    setLoading(false);
  }

  async function login(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    await checkUser();
    return {};
  }

  async function signup(email: string, password: string, fullName: string, companyName: string) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    if (data.user) {
      const { data: org } = await supabase.from('acct_organizations').insert({
        name: companyName, owner_id: data.user.id, base_currency: 'KWD',
      }).select().single();
      await supabase.from('acct_user_profiles').insert({
        id: data.user.id, full_name: fullName, email,
        role: 'owner', org_id: org?.id,
      });
      if (org?.id) await createDefaultAccounts(org.id);
    }
    await checkUser();
    return {};
  }

  async function createDefaultAccounts(orgId: string) {
    const defaults = [
      { code: '1000', name: 'Cash', name_ar: 'النقدية', type: 'asset', sub_type: 'current_asset', org_id: orgId },
      { code: '1010', name: 'Bank Account', name_ar: 'الحساب البنكي', type: 'asset', sub_type: 'current_asset', org_id: orgId },
      { code: '1200', name: 'Accounts Receivable', name_ar: 'الذمم المدينة', type: 'asset', sub_type: 'current_asset', org_id: orgId },
      { code: '1300', name: 'Inventory', name_ar: 'المخزون', type: 'asset', sub_type: 'current_asset', org_id: orgId },
      { code: '1500', name: 'Equipment', name_ar: 'المعدات', type: 'asset', sub_type: 'fixed_asset', org_id: orgId },
      { code: '1510', name: 'Furniture', name_ar: 'الأثاث', type: 'asset', sub_type: 'fixed_asset', org_id: orgId },
      { code: '1520', name: 'Vehicles', name_ar: 'المركبات', type: 'asset', sub_type: 'fixed_asset', org_id: orgId },
      { code: '2000', name: 'Accounts Payable', name_ar: 'الذمم الدائنة', type: 'liability', sub_type: 'current_liability', org_id: orgId },
      { code: '2100', name: 'Accrued Expenses', name_ar: 'المصروفات المستحقة', type: 'liability', sub_type: 'current_liability', org_id: orgId },
      { code: '2200', name: 'VAT Payable', name_ar: 'ضريبة القيمة المضافة', type: 'liability', sub_type: 'current_liability', org_id: orgId },
      { code: '2500', name: 'Long-term Loan', name_ar: 'قرض طويل الأجل', type: 'liability', sub_type: 'long_term_liability', org_id: orgId },
      { code: '3000', name: 'Owner Capital', name_ar: 'رأس مال المالك', type: 'equity', sub_type: 'owners_equity', org_id: orgId },
      { code: '3100', name: 'Retained Earnings', name_ar: 'الأرباح المحتجزة', type: 'equity', sub_type: 'owners_equity', org_id: orgId },
      { code: '3200', name: 'Drawings', name_ar: 'المسحوبات', type: 'equity', sub_type: 'owners_equity', org_id: orgId },
      { code: '4000', name: 'Sales Revenue', name_ar: 'إيرادات المبيعات', type: 'revenue', sub_type: 'operating_revenue', org_id: orgId },
      { code: '4100', name: 'Service Revenue', name_ar: 'إيرادات الخدمات', type: 'revenue', sub_type: 'operating_revenue', org_id: orgId },
      { code: '4500', name: 'Other Income', name_ar: 'دخل آخر', type: 'revenue', sub_type: 'other_revenue', org_id: orgId },
      { code: '5000', name: 'Cost of Goods Sold', name_ar: 'تكلفة البضاعة المباعة', type: 'expense', sub_type: 'cost_of_goods_sold', org_id: orgId },
      { code: '6000', name: 'Rent Expense', name_ar: 'مصروف الإيجار', type: 'expense', sub_type: 'operating_expense', org_id: orgId },
      { code: '6100', name: 'Salaries Expense', name_ar: 'مصروف الرواتب', type: 'expense', sub_type: 'operating_expense', org_id: orgId },
      { code: '6200', name: 'Utilities Expense', name_ar: 'مصروف المرافق', type: 'expense', sub_type: 'operating_expense', org_id: orgId },
      { code: '6300', name: 'Office Supplies', name_ar: 'لوازم مكتبية', type: 'expense', sub_type: 'operating_expense', org_id: orgId },
      { code: '6400', name: 'Marketing Expense', name_ar: 'مصروف التسويق', type: 'expense', sub_type: 'operating_expense', org_id: orgId },
      { code: '6500', name: 'Insurance Expense', name_ar: 'مصروف التأمين', type: 'expense', sub_type: 'operating_expense', org_id: orgId },
      { code: '6600', name: 'Depreciation Expense', name_ar: 'مصروف الإهلاك', type: 'expense', sub_type: 'operating_expense', org_id: orgId },
      { code: '6700', name: 'Bank Charges', name_ar: 'رسوم بنكية', type: 'expense', sub_type: 'operating_expense', org_id: orgId },
      { code: '6800', name: 'Legal & Professional', name_ar: 'مصاريف قانونية ومهنية', type: 'expense', sub_type: 'operating_expense', org_id: orgId },
    ];
    await supabase.from('acct_accounts').insert(defaults);
  }

  async function logout() {
    await supabase.auth.signOut();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
