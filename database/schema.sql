-- AccuBooks Accounting SaaS - Database Schema
-- Run this in Supabase SQL Editor to create all tables

-- Organizations (multi-tenant)
CREATE TABLE IF NOT EXISTS acct_organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID REFERENCES auth.users(id),
  address TEXT,
  phone TEXT,
  email TEXT,
  tax_id TEXT,
  base_currency TEXT DEFAULT 'KWD',
  fiscal_year_start TEXT DEFAULT '01',
  date_format TEXT DEFAULT 'YYYY-MM-DD',
  timezone TEXT DEFAULT 'Asia/Kuwait',
  invoice_prefix TEXT DEFAULT 'INV',
  bill_prefix TEXT DEFAULT 'BILL',
  subscription_plan TEXT DEFAULT 'free',
  subscription_status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Profiles
CREATE TABLE IF NOT EXISTS acct_user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  full_name TEXT,
  email TEXT,
  role TEXT DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'accountant', 'viewer')),
  org_id UUID REFERENCES acct_organizations(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chart of Accounts
CREATE TABLE IF NOT EXISTS acct_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  name_ar TEXT,
  type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  sub_type TEXT,
  parent_id UUID REFERENCES acct_accounts(id),
  balance NUMERIC(15,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  org_id UUID NOT NULL REFERENCES acct_organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Journal Entries
CREATE TABLE IF NOT EXISTS acct_journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_no TEXT NOT NULL,
  entry_date DATE NOT NULL,
  description TEXT,
  reference TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'void')),
  total_amount NUMERIC(15,2) DEFAULT 0,
  attachments JSONB DEFAULT '[]',
  org_id UUID NOT NULL REFERENCES acct_organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Journal Lines
CREATE TABLE IF NOT EXISTS acct_journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES acct_journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES acct_accounts(id),
  description TEXT,
  debit NUMERIC(15,2) DEFAULT 0,
  credit NUMERIC(15,2) DEFAULT 0,
  org_id UUID NOT NULL REFERENCES acct_organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customers
CREATE TABLE IF NOT EXISTS acct_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  tax_id TEXT,
  outstanding_balance NUMERIC(15,2) DEFAULT 0,
  org_id UUID NOT NULL REFERENCES acct_organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vendors
CREATE TABLE IF NOT EXISTS acct_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  tax_id TEXT,
  outstanding_balance NUMERIC(15,2) DEFAULT 0,
  org_id UUID NOT NULL REFERENCES acct_organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Invoices (Accounts Receivable)
CREATE TABLE IF NOT EXISTS acct_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE,
  customer_id UUID REFERENCES acct_customers(id),
  customer_name TEXT,
  customer_email TEXT,
  subtotal NUMERIC(15,2) DEFAULT 0,
  tax_amount NUMERIC(15,2) DEFAULT 0,
  total NUMERIC(15,2) DEFAULT 0,
  amount_paid NUMERIC(15,2) DEFAULT 0,
  status TEXT DEFAULT 'unpaid' CHECK (status IN ('draft', 'unpaid', 'paid', 'partially_paid', 'overdue', 'void')),
  items JSONB DEFAULT '[]',
  notes TEXT,
  attachments JSONB DEFAULT '[]',
  org_id UUID NOT NULL REFERENCES acct_organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bills (Accounts Payable)
CREATE TABLE IF NOT EXISTS acct_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no TEXT NOT NULL,
  bill_date DATE NOT NULL,
  due_date DATE,
  vendor_id UUID REFERENCES acct_vendors(id),
  vendor_name TEXT,
  subtotal NUMERIC(15,2) DEFAULT 0,
  tax_amount NUMERIC(15,2) DEFAULT 0,
  total NUMERIC(15,2) DEFAULT 0,
  amount_paid NUMERIC(15,2) DEFAULT 0,
  status TEXT DEFAULT 'unpaid' CHECK (status IN ('draft', 'unpaid', 'paid', 'partially_paid', 'overdue', 'void')),
  items JSONB DEFAULT '[]',
  notes TEXT,
  attachments JSONB DEFAULT '[]',
  org_id UUID NOT NULL REFERENCES acct_organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payments
CREATE TABLE IF NOT EXISTS acct_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_no TEXT NOT NULL,
  payment_date DATE NOT NULL,
  payment_type TEXT CHECK (payment_type IN ('received', 'made')),
  payment_method TEXT DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank_transfer', 'check', 'credit_card', 'online')),
  amount NUMERIC(15,2) NOT NULL,
  reference TEXT,
  invoice_id UUID REFERENCES acct_invoices(id),
  bill_id UUID REFERENCES acct_bills(id),
  customer_id UUID REFERENCES acct_customers(id),
  vendor_id UUID REFERENCES acct_vendors(id),
  notes TEXT,
  org_id UUID NOT NULL REFERENCES acct_organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bank Accounts
CREATE TABLE IF NOT EXISTS acct_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  bank_name TEXT,
  account_number TEXT,
  iban TEXT,
  currency TEXT DEFAULT 'KWD',
  current_balance NUMERIC(15,2) DEFAULT 0,
  account_id UUID REFERENCES acct_accounts(id),
  org_id UUID NOT NULL REFERENCES acct_organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_acct_accounts_org ON acct_accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_acct_accounts_type ON acct_accounts(type);
CREATE INDEX IF NOT EXISTS idx_acct_journal_entries_org ON acct_journal_entries(org_id);
CREATE INDEX IF NOT EXISTS idx_acct_journal_entries_date ON acct_journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_acct_journal_lines_entry ON acct_journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_acct_journal_lines_account ON acct_journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_acct_invoices_org ON acct_invoices(org_id);
CREATE INDEX IF NOT EXISTS idx_acct_customers_org ON acct_customers(org_id);
CREATE INDEX IF NOT EXISTS idx_acct_vendors_org ON acct_vendors(org_id);
CREATE INDEX IF NOT EXISTS idx_acct_user_profiles_org ON acct_user_profiles(org_id);

-- Row Level Security (Multi-tenancy isolation)
ALTER TABLE acct_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE acct_user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE acct_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE acct_journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE acct_journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE acct_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE acct_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE acct_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE acct_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE acct_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE acct_bank_accounts ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access data from their organization
-- Organizations: owners can see their own org
CREATE POLICY "Users can view own org" ON acct_organizations FOR SELECT USING (
  id IN (SELECT org_id FROM acct_user_profiles WHERE id = auth.uid())
);
CREATE POLICY "Users can update own org" ON acct_organizations FOR UPDATE USING (
  id IN (SELECT org_id FROM acct_user_profiles WHERE id = auth.uid())
);
CREATE POLICY "Anyone can create org" ON acct_organizations FOR INSERT WITH CHECK (true);

-- User profiles
CREATE POLICY "Users can view org profiles" ON acct_user_profiles FOR SELECT USING (
  org_id IN (SELECT org_id FROM acct_user_profiles WHERE id = auth.uid())
);
CREATE POLICY "Users can create profile" ON acct_user_profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update own profile" ON acct_user_profiles FOR UPDATE USING (id = auth.uid());

-- Generic org-based policies for data tables
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'acct_accounts', 'acct_journal_entries', 'acct_journal_lines',
    'acct_customers', 'acct_vendors', 'acct_invoices', 'acct_bills',
    'acct_payments', 'acct_bank_accounts'
  ])
  LOOP
    EXECUTE format('CREATE POLICY "Org isolation select" ON %I FOR SELECT USING (org_id IN (SELECT org_id FROM acct_user_profiles WHERE id = auth.uid()))', tbl);
    EXECUTE format('CREATE POLICY "Org isolation insert" ON %I FOR INSERT WITH CHECK (org_id IN (SELECT org_id FROM acct_user_profiles WHERE id = auth.uid()))', tbl);
    EXECUTE format('CREATE POLICY "Org isolation update" ON %I FOR UPDATE USING (org_id IN (SELECT org_id FROM acct_user_profiles WHERE id = auth.uid()))', tbl);
    EXECUTE format('CREATE POLICY "Org isolation delete" ON %I FOR DELETE USING (org_id IN (SELECT org_id FROM acct_user_profiles WHERE id = auth.uid()))', tbl);
  END LOOP;
END $$;
