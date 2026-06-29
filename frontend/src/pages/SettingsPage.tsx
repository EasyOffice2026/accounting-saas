import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiFetch } from "../contexts/api";
import BrandManagementPage from "./BrandManagementPage";
import { useAuth } from "../contexts/AuthContext";

interface SmtpConfig {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  from_email: string;
  from_name: string;
  use_tls: boolean;
  has_password: boolean;
}

interface PaymentConfig {
  provider: string;
  is_sandbox: string;
  currency: string;
  secret_key: string;
  publishable_key: string;
  has_custom_key: boolean;
}

interface WhatsAppConfig {
  instance_id: string;
  api_url: string;
  default_phone: string;
  has_token: boolean;
  sales_group: string;
  purchases_group: string;
  expenses_group: string;
  hr_group: string;
  transfers_group: string;
}

interface FoodicsConfig {
  has_token: boolean;
  base_url: string;
  is_sandbox: boolean;
  last_sync_at: string | null;
}

interface FoodicsBranch {
  id: string;
  name: string;
  name_localized: string;
}

interface FoodicsBranchMap {
  id: number;
  foodics_branch_id: string;
  foodics_branch_name: string;
  local_branch_id: number | null;
}

interface FoodicsPaymentMethod {
  id: string;
  name: string;
  name_localized: string;
}

interface FoodicsPaymentMap {
  id: number;
  foodics_payment_id: string;
  foodics_payment_name: string;
  local_channel: string | null;
}

interface UserItem {
  id: number;
  username: string;
  full_name: string;
  role: string;
  branch_id: number | null;
  is_active: boolean;
  allowed_tabs: string[] | null;
}

interface BranchItem {
  id: number;
  name: string;
  name_ar: string;
  brand_id: number | null;
  is_central_kitchen: boolean;
  whatsapp_number: string;
  whatsapp_group: string;
  is_active: boolean;
}

interface BrandItem {
  id: number;
  name_en: string;
  name_ar: string;
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const [host, setHost] = useState("smtp.gmail.com");
  const [port, setPort] = useState("587");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("Mudawwarah");
  const [useTls, setUseTls] = useState(true);
  const [hasPassword, setHasPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState<"success" | "error">("success");

  // Payment gateway state
  const [pgSecretKey, setPgSecretKey] = useState("");
  const [pgPublishableKey, setPgPublishableKey] = useState("");
  const [pgSandbox, setPgSandbox] = useState("true");
  const [pgCurrency, setPgCurrency] = useState("KWD");
  const [pgHasKey, setPgHasKey] = useState(false);
  const [pgSaving, setPgSaving] = useState(false);
  const [pgMsg, setPgMsg] = useState("");
  const [pgMsgType, setPgMsgType] = useState<"success" | "error">("success");

  // WhatsApp state
  const [waInstanceId, setWaInstanceId] = useState("");
  const [waApiToken, setWaApiToken] = useState("");
  const [waApiUrl, setWaApiUrl] = useState("");
  const [waPhone, setWaPhone] = useState("");
  const [waHasToken, setWaHasToken] = useState(false);
  const [waSalesGroup, setWaSalesGroup] = useState("");
  const [waPurchasesGroup, setWaPurchasesGroup] = useState("");
  const [waExpensesGroup, setWaExpensesGroup] = useState("");
  const [waHrGroup, setWaHrGroup] = useState("");
  const [waTransfersGroup, setWaTransfersGroup] = useState("");
  const [waGroupsList, setWaGroupsList] = useState<{id: string; name: string}[]>([]);
  const [waLoadingGroups, setWaLoadingGroups] = useState(false);
  const [waSaving, setWaSaving] = useState(false);
  const [waMsg, setWaMsg] = useState("");
  const [waMsgType, setWaMsgType] = useState<"success" | "error">("success");

  // Foodics state
  const [fcApiToken, setFcApiToken] = useState("");
  const [fcBaseUrl, setFcBaseUrl] = useState("https://api.foodics.com/v5");
  const [fcSandbox, setFcSandbox] = useState(false);
  const [fcHasToken, setFcHasToken] = useState(false);
  const [fcLastSync, setFcLastSync] = useState<string | null>(null);
  const [fcSaving, setFcSaving] = useState(false);
  const [fcTesting, setFcTesting] = useState(false);
  const [fcMsg, setFcMsg] = useState("");
  const [fcMsgType, setFcMsgType] = useState<"success" | "error">("success");
  const [fcBranches, setFcBranches] = useState<FoodicsBranch[]>([]);
  const [fcBranchMaps, setFcBranchMaps] = useState<FoodicsBranchMap[]>([]);
  const [fcPaymentMethods, setFcPaymentMethods] = useState<FoodicsPaymentMethod[]>([]);
  const [fcPaymentMaps, setFcPaymentMaps] = useState<FoodicsPaymentMap[]>([]);
  const [fcLoadingBranches, setFcLoadingBranches] = useState(false);
  const [fcLoadingPayments, setFcLoadingPayments] = useState(false);
  const [fcAutoMapping, setFcAutoMapping] = useState(false);
  const [fcBusinessName, setFcBusinessName] = useState("");

  // User Management state
  const [users, setUsers] = useState<UserItem[]>([]);
  const [branchesList, setBranchesList] = useState<BranchItem[]>([]);
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [uUsername, setUUsername] = useState("");
  const [uPassword, setUPassword] = useState("");
  const [uFullName, setUFullName] = useState("");
  const [uRole, setURole] = useState("staff");
  const [uBranchId, setUBranchId] = useState<string>("");
  const [uMsg, setUMsg] = useState("");
  const [uMsgType, setUMsgType] = useState<"success" | "error">("success");

  // Branch Management state
  const [brandsList, setBrandsList] = useState<BrandItem[]>([]);
  const [showBranchForm, setShowBranchForm] = useState(false);
  const [editingBranch, setEditingBranch] = useState<BranchItem | null>(null);
  const [brName, setBrName] = useState("");
  const [brNameAr, setBrNameAr] = useState("");
  const [brBrandId, setBrBrandId] = useState<string>("");
  const [brIsCK, setBrIsCK] = useState(false);
  const [brWhatsApp, setBrWhatsApp] = useState("");
  const [brWhatsAppGroup, setBrWhatsAppGroup] = useState("");
  const [brMsg, setBrMsg] = useState("");
  const [brMsgType, setBrMsgType] = useState<"success" | "error">("success");

  const loadBranches = () => {
    apiGet("/api/branches/?brand_id=0").then((data) => {
      if (Array.isArray(data)) setBranchesList(data);
    });
  };

  const loadUsers = () => {
    apiGet("/api/users/").then((data) => {
      if (Array.isArray(data)) setUsers(data);
    });
  };

  useEffect(() => {
    apiGet("/api/email/smtp-settings").then((data: SmtpConfig | null) => {
      if (data) {
        setHost(data.smtp_host);
        setPort(String(data.smtp_port));
        setUser(data.smtp_user);
        setFromEmail(data.from_email);
        setFromName(data.from_name);
        setUseTls(data.use_tls);
        setHasPassword(data.has_password);
      }
    });
    apiGet("/api/payment/settings").then((data: PaymentConfig | null) => {
      if (data) {
        setPgSandbox(data.is_sandbox);
        setPgCurrency(data.currency);
        setPgHasKey(data.has_custom_key);
      }
    });
    apiGet("/api/whatsapp/settings").then((data: WhatsAppConfig | null) => {
      if (data) {
        setWaInstanceId(data.instance_id);
        setWaApiUrl(data.api_url);
        setWaPhone(data.default_phone);
        setWaHasToken(data.has_token);
        setWaSalesGroup(data.sales_group || "");
        setWaPurchasesGroup(data.purchases_group || "");
        setWaExpensesGroup(data.expenses_group || "");
        setWaHrGroup(data.hr_group || "");
        setWaTransfersGroup(data.transfers_group || "");
      }
    });
    apiGet("/api/foodics/settings").then((data: FoodicsConfig | null) => {
      if (data) {
        setFcBaseUrl(data.base_url);
        setFcSandbox(data.is_sandbox);
        setFcHasToken(data.has_token);
        setFcLastSync(data.last_sync_at);
      }
    });
    apiGet("/api/foodics/branch-mappings").then((data) => {
      if (Array.isArray(data)) setFcBranchMaps(data);
    });
    apiGet("/api/foodics/payment-mappings").then((data) => {
      if (Array.isArray(data)) setFcPaymentMaps(data);
    });
    loadUsers();
    loadBranches();
    apiGet("/api/hr/brands").then((data) => {
      if (Array.isArray(data)) setBrandsList(data);
    });
  }, []);

  const showMsg = (text: string, type: "success" | "error") => {
    setMsg(text);
    setMsgType(type);
    setTimeout(() => setMsg(""), 5000);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const fd = new URLSearchParams();
      fd.append("smtp_host", host);
      fd.append("smtp_port", port);
      fd.append("smtp_user", user);
      if (password) fd.append("smtp_password", password);
      fd.append("from_email", fromEmail);
      fd.append("from_name", fromName);
      fd.append("use_tls", String(useTls));
      const res = await fetch("/api/email/smtp-settings", {
        method: "POST",
        body: fd,
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!res.ok) throw new Error("Failed to save");
      setHasPassword(true);
      setPassword("");
      showMsg(t("smtp_saved"), "success");
    } catch {
      showMsg(t("smtp_save_error"), "error");
    }
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/email/test", {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Test failed");
      showMsg(data.message, "success");
    } catch (e: unknown) {
      const err = e as Error;
      showMsg(err.message || t("smtp_test_error"), "error");
    }
    setTesting(false);
  };

  const resetUserForm = () => {
    setUUsername("");
    setUPassword("");
    setUFullName("");
    setURole("staff");
    setUBranchId("");
    setEditingUser(null);
    setShowUserForm(false);
  };

  const handleEditUser = (u: UserItem) => {
    setEditingUser(u);
    setUUsername(u.username);
    setUFullName(u.full_name);
    setURole(u.role);
    setUBranchId(u.branch_id ? String(u.branch_id) : "");
    setUPassword("");
    setShowUserForm(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new URLSearchParams();
    fd.append("username", uUsername);
    fd.append("full_name", uFullName);
    fd.append("role", uRole);
    if (uPassword) fd.append("password", uPassword);
    fd.append("branch_id", uRole === "staff" ? (uBranchId || "") : "");

    try {
      if (editingUser) {
        const res = await apiFetch(`/api/users/${editingUser.id}`, { method: "PUT", body: fd });
        if (!res.ok) { const d = await res.json(); throw new Error(d.detail || "Error"); }
        setUMsg(t("user_updated")); setUMsgType("success");
      } else {
        if (!uPassword) { setUMsg("Password required"); setUMsgType("error"); setTimeout(() => setUMsg(""), 4000); return; }
        const res = await apiFetch("/api/users/", { method: "POST", body: fd });
        if (!res.ok) { const d = await res.json(); throw new Error(d.detail || "Error"); }
        setUMsg(t("user_created")); setUMsgType("success");
      }
      loadUsers();
      resetUserForm();
    } catch (err: unknown) {
      setUMsg((err as Error).message || t("user_create_error"));
      setUMsgType("error");
    }
    setTimeout(() => setUMsg(""), 5000);
  };

  const handleDeleteUser = async (uid: number) => {
    if (!confirm(t("confirm_delete_user"))) return;
    try {
      const res = await apiFetch(`/api/users/${uid}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || "Error"); }
      setUMsg(t("user_deleted")); setUMsgType("success");
      loadUsers();
    } catch (err: unknown) {
      setUMsg((err as Error).message || t("user_delete_error"));
      setUMsgType("error");
    }
    setTimeout(() => setUMsg(""), 5000);
  };

  const getBranchName = (bid: number | null) => {
    if (!bid) return t("no_branch");
    const b = branchesList.find(x => x.id === bid);
    return b ? (i18n.language === "ar" ? (b.name_ar || b.name) : b.name) : "-";
  };

  const getBrandName = (bid: number | null) => {
    if (!bid) return "—";
    const b = brandsList.find(x => x.id === bid);
    return b ? (i18n.language === "ar" ? (b.name_ar || b.name_en) : b.name_en) : "—";
  };

  const resetBranchForm = () => {
    setBrName(""); setBrNameAr(""); setBrBrandId(""); setBrIsCK(false); setBrWhatsApp(""); setBrWhatsAppGroup("");
    setEditingBranch(null); setShowBranchForm(false);
  };

  const handleEditBranch = (b: BranchItem) => {
    setEditingBranch(b);
    setBrName(b.name);
    setBrNameAr(b.name_ar);
    setBrBrandId(b.brand_id ? String(b.brand_id) : "");
    setBrIsCK(b.is_central_kitchen);
    setBrWhatsApp(b.whatsapp_number || "");
    setBrWhatsAppGroup(b.whatsapp_group || "");
    setShowBranchForm(true);
  };

  const handleSaveBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new URLSearchParams();
    fd.append("name", brName);
    fd.append("name_ar", brNameAr);
    fd.append("is_central_kitchen", String(brIsCK));
    if (brBrandId) fd.append("brand_id", brBrandId);
    fd.append("whatsapp_number", brWhatsApp);
    fd.append("whatsapp_group", brWhatsAppGroup);
    try {
      if (editingBranch) {
        const res = await apiFetch(`/api/branches/${editingBranch.id}`, { method: "PUT", body: fd });
        if (!res.ok) { const d = await res.json(); throw new Error(d.detail || "Error"); }
        setBrMsg(t("saved")); setBrMsgType("success");
      } else {
        const res = await apiFetch("/api/branches/", { method: "POST", body: fd });
        if (!res.ok) { const d = await res.json(); throw new Error(d.detail || "Error"); }
        setBrMsg(t("saved")); setBrMsgType("success");
      }
      loadBranches();
      resetBranchForm();
    } catch (err: unknown) {
      setBrMsg((err as Error).message); setBrMsgType("error");
    }
    setTimeout(() => setBrMsg(""), 5000);
  };

  const handleDeleteBranch = async (bid: number) => {
    if (!confirm(t("confirm_delete"))) return;
    try {
      const res = await apiFetch(`/api/branches/${bid}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || "Error"); }
      setBrMsg(t("deleted")); setBrMsgType("success");
      loadBranches();
    } catch (err: unknown) {
      setBrMsg((err as Error).message); setBrMsgType("error");
    }
    setTimeout(() => setBrMsg(""), 5000);
  };

  const currentUser = useAuth().user;

  // Permissions management
  const ALL_MAIN_TABS = [
    { key: "dashboard", label: "tab_dashboard" },
    { key: "sales", label: "tab_sales" },
    { key: "purchases", label: "tab_purchases" },
    { key: "expenses", label: "tab_expenses" },
    { key: "hr", label: "tab_hr" },
    { key: "cash", label: "tab_cash" },
    { key: "transfers", label: "tab_transfers" },
    { key: "contracts", label: "tab_contracts" },
  ];
  const ALL_HR_TABS = [
    { key: "hr_employees", label: "tab_hr_employees" },
    { key: "hr_salary", label: "tab_hr_salary" },
    { key: "hr_transfers", label: "tab_hr_transfers" },
    { key: "hr_loans", label: "tab_hr_loans" },
    { key: "hr_benefits", label: "tab_hr_benefits" },
    { key: "hr_deductions", label: "tab_hr_deductions" },
    { key: "hr_leaves", label: "tab_hr_leaves" },
    { key: "hr_resignation", label: "tab_hr_resignation" },
  ];
  const ALL_TABS = [...ALL_MAIN_TABS, ...ALL_HR_TABS];
  const ALL_TAB_KEYS = ALL_TABS.map(t => t.key);

  const [permEditing, setPermEditing] = useState<number | null>(null);
  const [permTabs, setPermTabs] = useState<string[]>([]);
  const [permAllAccess, setPermAllAccess] = useState(true);
  const [permMsg, setPermMsg] = useState("");
  const [permMsgType, setPermMsgType] = useState<"success" | "error">("success");
  const [permSaving, setPermSaving] = useState(false);

  const startEditPerm = (u: UserItem) => {
    setPermEditing(u.id);
    if (!u.allowed_tabs) {
      setPermAllAccess(true);
      setPermTabs([...ALL_TAB_KEYS]);
    } else {
      setPermAllAccess(false);
      setPermTabs([...u.allowed_tabs]);
    }
  };

  const togglePermTab = (key: string) => {
    setPermTabs(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
    setPermAllAccess(false);
  };

  const togglePermAllAccess = () => {
    if (permAllAccess) {
      setPermAllAccess(false);
      setPermTabs([]);
    } else {
      setPermAllAccess(true);
      setPermTabs([...ALL_TAB_KEYS]);
    }
  };

  const savePerm = async (userId: number) => {
    setPermSaving(true);
    try {
      const body = permAllAccess ? { allowed_tabs: null } : { allowed_tabs: permTabs };
      const res = await apiFetch(`/api/users/${userId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed");
      setPermMsg(t("permissions_saved")); setPermMsgType("success");
      loadUsers();
      setPermEditing(null);
    } catch {
      setPermMsg(t("permissions_error")); setPermMsgType("error");
    }
    setPermSaving(false);
    setTimeout(() => setPermMsg(""), 5000);
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">{t("settings")}</h2>

      {/* Brand Management (owner only) */}
      {currentUser?.role === "owner" && (
        <div className="mb-6">
          <BrandManagementPage />
        </div>
      )}

      {/* Branch Management (owner, manager, accountant) */}
      {["owner", "manager", "accountant"].includes(currentUser?.role || "") && (
        <div className="bg-white p-6 rounded-xl shadow-sm border max-w-4xl mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold">{t("branch_management")}</h3>
              <p className="text-sm text-gray-500">{t("branch_management_desc")}</p>
            </div>
            <button onClick={() => { resetBranchForm(); setShowBranchForm(true); }}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
              + {t("add_branch")}
            </button>
          </div>

          {brMsg && (
            <div className={`p-3 rounded mb-4 text-sm ${
              brMsgType === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}>{brMsg}</div>
          )}

          {showBranchForm && (
            <form onSubmit={handleSaveBranch} className="bg-gray-50 p-4 rounded-lg mb-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">{t("branch_name_en")}</label>
                  <input value={brName} onChange={e => setBrName(e.target.value)} required
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Branch Name" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("branch_name_ar")}</label>
                  <input value={brNameAr} onChange={e => setBrNameAr(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm" dir="rtl" placeholder="اسم الفرع" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("brand")}</label>
                  <select value={brBrandId} onChange={e => setBrBrandId(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="">-- {t("select_brand")} --</option>
                    {brandsList.map(b => (
                      <option key={b.id} value={b.id}>{i18n.language === "ar" ? (b.name_ar || b.name_en) : b.name_en}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center pt-6">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={brIsCK} onChange={e => setBrIsCK(e.target.checked)} />
                    {t("central_kitchen")}
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("whatsapp_number")}</label>
                  <input value={brWhatsApp} onChange={e => setBrWhatsApp(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="965XXXXXXXX" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("whatsapp_group_id")}</label>
                  <input value={brWhatsAppGroup} onChange={e => setBrWhatsAppGroup(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="120363XXXXXXXXX@g.us" />
                  <p className="text-xs text-gray-400 mt-1">{t("whatsapp_group_hint")}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit"
                  className="px-5 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
                  {editingBranch ? t("save") : t("add_branch")}
                </button>
                <button type="button" onClick={resetBranchForm}
                  className="px-5 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm">
                  {t("cancel")}
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">{t("branch_name_en")}</th>
                  <th className="px-3 py-2 text-left">{t("branch_name_ar")}</th>
                  <th className="px-3 py-2 text-left">{t("brand")}</th>
                  <th className="px-3 py-2 text-left">{t("central_kitchen")}</th>
                  <th className="px-3 py-2 text-left">{t("whatsapp")}</th>
                  <th className="px-3 py-2 text-left">{t("whatsapp_group_id")}</th>
                  <th className="px-3 py-2 text-left">{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {branchesList.map(b => (
                  <tr key={b.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{b.name}</td>
                    <td className="px-3 py-2" dir="rtl">{b.name_ar || "—"}</td>
                    <td className="px-3 py-2">{getBrandName(b.brand_id)}</td>
                    <td className="px-3 py-2">
                      {b.is_central_kitchen ? <span className="text-green-600 text-xs font-medium">✓</span> : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{b.whatsapp_number || "—"}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{b.whatsapp_group ? "✓" : "—"}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => handleEditBranch(b)}
                        className="text-blue-600 hover:underline text-xs mr-3">{t("edit")}</button>
                      <button onClick={() => handleDeleteBranch(b.id)}
                        className="text-red-600 hover:underline text-xs">{t("delete")}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* User Management */}
      <div className="bg-white p-6 rounded-xl shadow-sm border max-w-4xl mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">{t("user_management")}</h3>
            <p className="text-sm text-gray-500">{t("user_management_desc")}</p>
          </div>
          <button onClick={() => { resetUserForm(); setShowUserForm(true); }}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
            + {t("add_user")}
          </button>
        </div>

        {uMsg && (
          <div className={`p-3 rounded mb-4 text-sm ${
            uMsgType === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}>{uMsg}</div>
        )}

        {showUserForm && (
          <form onSubmit={handleSaveUser} className="bg-gray-50 p-4 rounded-lg mb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">{t("username")}</label>
                <input value={uUsername} onChange={e => setUUsername(e.target.value)} required
                  className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="username" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  {editingUser ? t("new_password") : t("password")}
                </label>
                <input type="password" value={uPassword} onChange={e => setUPassword(e.target.value)}
                  required={!editingUser}
                  placeholder={editingUser ? t("leave_blank_password") : t("password")}
                  className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("full_name")}</label>
                <input value={uFullName} onChange={e => setUFullName(e.target.value)} required
                  className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Full Name" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t("role")}</label>
                <select value={uRole} onChange={e => setURole(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm">
                  <option value="owner">{t("owner")}</option>
                  <option value="manager">{t("manager")}</option>
                  <option value="staff">{t("staff")}</option>
                </select>
              </div>
              {uRole === "staff" && (
                <div>
                  <label className="block text-sm font-medium mb-1">{t("branch")}</label>
                  <select value={uBranchId} onChange={e => setUBranchId(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="">-- {t("branch")} --</option>
                    {branchesList.map(b => (
                      <option key={b.id} value={b.id}>{i18n.language === "ar" ? (b.name_ar || b.name) : b.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button type="submit"
                className="px-5 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
                {editingUser ? t("save") : t("add_user")}
              </button>
              <button type="button" onClick={resetUserForm}
                className="px-5 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm">
                {t("cancel")}
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">{t("username")}</th>
                <th className="px-3 py-2 text-left">{t("full_name")}</th>
                <th className="px-3 py-2 text-left">{t("role")}</th>
                <th className="px-3 py-2 text-left">{t("branch")}</th>
                <th className="px-3 py-2 text-left">{t("status")}</th>
                <th className="px-3 py-2 text-left">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{u.username}</td>
                  <td className="px-3 py-2">{u.full_name}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      u.role === "owner" ? "bg-purple-100 text-purple-700" :
                      u.role === "manager" ? "bg-blue-100 text-blue-700" :
                      "bg-gray-100 text-gray-700"
                    }`}>{t(u.role)}</span>
                  </td>
                  <td className="px-3 py-2">{getBranchName(u.branch_id)}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      u.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                    }`}>{u.is_active ? t("active") : t("inactive")}</span>
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => handleEditUser(u)}
                      className="text-blue-600 hover:underline text-xs mr-3">{t("edit")}</button>
                    <button onClick={() => handleDeleteUser(u.id)}
                      className="text-red-600 hover:underline text-xs">{t("delete")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Permissions (owner only) */}
      {currentUser?.role === "owner" && (
        <div className="bg-white p-6 rounded-xl shadow-sm border max-w-5xl mb-6">
          <div className="mb-4">
            <h3 className="text-lg font-semibold">{t("user_permissions")}</h3>
            <p className="text-sm text-gray-500">{t("user_permissions_desc")}</p>
          </div>

          {permMsg && (
            <div className={`p-3 rounded mb-4 text-sm ${
              permMsgType === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}>{permMsg}</div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">{t("username")}</th>
                  <th className="px-3 py-2 text-left">{t("full_name")}</th>
                  <th className="px-3 py-2 text-left">{t("role")}</th>
                  <th className="px-3 py-2 text-left">{t("status")}</th>
                  <th className="px-3 py-2 text-left">{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {users.filter(u => u.role !== "owner").map(u => (
                  <tr key={u.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{u.username}</td>
                    <td className="px-3 py-2">{u.full_name}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        u.role === "manager" ? "bg-blue-100 text-blue-700" :
                        u.role === "accountant" ? "bg-amber-100 text-amber-700" :
                        "bg-gray-100 text-gray-700"
                      }`}>{t(u.role)}</span>
                    </td>
                    <td className="px-3 py-2">
                      {u.allowed_tabs ? (
                        <span className="text-xs text-orange-600">{u.allowed_tabs.length} tabs</span>
                      ) : (
                        <span className="text-xs text-green-600">{t("all_access")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => permEditing === u.id ? setPermEditing(null) : startEditPerm(u)}
                        className="text-blue-600 hover:underline text-xs">
                        {permEditing === u.id ? t("cancel") : t("edit")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {permEditing && (() => {
            const editUser = users.find(u => u.id === permEditing);
            if (!editUser) return null;
            return (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-sm">
                    {editUser.full_name} ({editUser.username})
                  </h4>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={permAllAccess} onChange={togglePermAllAccess}
                      className="rounded" />
                    {t("all_access")}
                  </label>
                </div>

                {!permAllAccess && (
                  <>
                    <p className="text-xs text-gray-500 mb-2 font-medium">{t("dashboard")} & {t("sales")}</p>
                    <div className="grid grid-cols-4 gap-2 mb-3">
                      {ALL_MAIN_TABS.map(tab => (
                        <label key={tab.key} className="flex items-center gap-2 text-sm bg-white px-3 py-2 rounded border cursor-pointer hover:bg-emerald-50">
                          <input type="checkbox" checked={permTabs.includes(tab.key)}
                            onChange={() => togglePermTab(tab.key)} className="rounded" />
                          {t(tab.label)}
                        </label>
                      ))}
                    </div>

                    <p className="text-xs text-gray-500 mb-2 font-medium">{t("hr")} Sub-Tabs</p>
                    <div className="grid grid-cols-4 gap-2 mb-3">
                      {ALL_HR_TABS.map(tab => (
                        <label key={tab.key} className="flex items-center gap-2 text-sm bg-white px-3 py-2 rounded border cursor-pointer hover:bg-emerald-50">
                          <input type="checkbox" checked={permTabs.includes(tab.key)}
                            onChange={() => togglePermTab(tab.key)} className="rounded" />
                          {t(tab.label)}
                        </label>
                      ))}
                    </div>
                  </>
                )}

                <button onClick={() => savePerm(permEditing)} disabled={permSaving}
                  className="px-5 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm disabled:opacity-50">
                  {permSaving ? "..." : t("save_permissions")}
                </button>
              </div>
            );
          })()}
        </div>
      )}

      <div className="bg-white p-6 rounded-xl shadow-sm border max-w-2xl">
        <h3 className="text-lg font-semibold mb-4">{t("email_settings")}</h3>
        <p className="text-sm text-gray-500 mb-4">{t("smtp_description")}</p>

        {msg && (
          <div className={`p-3 rounded mb-4 text-sm ${
            msgType === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}>{msg}</div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">{t("smtp_host")}</label>
              <input value={host} onChange={e => setHost(e.target.value)} required
                placeholder="smtp.gmail.com"
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("smtp_port")}</label>
              <input type="number" value={port} onChange={e => setPort(e.target.value)} required
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("smtp_user")}</label>
              <input value={user} onChange={e => setUser(e.target.value)} required
                placeholder="your@gmail.com"
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {t("smtp_password")} {hasPassword && <span className="text-green-600 text-xs">({t("configured")})</span>}
              </label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder={hasPassword ? t("leave_blank_keep") : t("smtp_password")}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("from_email")}</label>
              <input type="email" value={fromEmail} onChange={e => setFromEmail(e.target.value)} required
                placeholder="noreply@restaurant.com"
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("from_name")}</label>
              <input value={fromName} onChange={e => setFromName(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="use_tls" checked={useTls} onChange={e => setUseTls(e.target.checked)} />
            <label htmlFor="use_tls" className="text-sm">{t("use_tls")}</label>
          </div>

          <div className="flex gap-3">
            <button type="submit" disabled={saving}
              className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm">
              {saving ? "..." : t("save")}
            </button>
            <button type="button" onClick={handleTest} disabled={testing || !hasPassword}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
              {testing ? "..." : t("test_email")}
            </button>
          </div>
        </form>

        <div className="mt-6 p-4 bg-amber-50 rounded-lg border border-amber-200">
          <h4 className="font-medium text-amber-800 text-sm mb-2">{t("gmail_setup_title")}</h4>
          <ol className="text-xs text-amber-700 space-y-1 list-decimal list-inside">
            <li>{t("gmail_step1")}</li>
            <li>{t("gmail_step2")}</li>
            <li>{t("gmail_step3")}</li>
            <li>{t("gmail_step4")}</li>
          </ol>
        </div>
      </div>

      {/* Payment Gateway Settings */}
      <div className="bg-white p-6 rounded-xl shadow-sm border max-w-2xl mt-6">
        <h3 className="text-lg font-semibold mb-4">{t("payment_settings")}</h3>
        <p className="text-sm text-gray-500 mb-4">{t("payment_settings_desc")}</p>

        {pgMsg && (
          <div className={`p-3 rounded mb-4 text-sm ${
            pgMsgType === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}>{pgMsg}</div>
        )}

        <div className="p-3 rounded-lg mb-4 text-sm bg-blue-50 text-blue-700 border border-blue-200">
          {pgSandbox === "true" ? t("sandbox_active") : t("live_mode_active")}
        </div>

        <form onSubmit={async (e) => {
          e.preventDefault();
          setPgSaving(true);
          try {
            const fd = new URLSearchParams();
            if (pgSecretKey) fd.append("secret_key", pgSecretKey);
            if (pgPublishableKey) fd.append("publishable_key", pgPublishableKey);
            fd.append("is_sandbox", pgSandbox);
            fd.append("currency", pgCurrency);
            const res = await fetch("/api/payment/settings", {
              method: "POST", body: fd,
              headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
            });
            if (!res.ok) throw new Error("Failed");
            setPgHasKey(!!pgSecretKey || pgHasKey);
            setPgSecretKey("");
            setPgMsg(t("payment_settings_saved"));
            setPgMsgType("success");
            setTimeout(() => setPgMsg(""), 5000);
          } catch {
            setPgMsg(t("payment_settings_error"));
            setPgMsgType("error");
            setTimeout(() => setPgMsg(""), 5000);
          }
          setPgSaving(false);
        }} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                {t("secret_key")} {pgHasKey && <span className="text-green-600 text-xs">({t("configured")})</span>}
              </label>
              <input type="password" value={pgSecretKey} onChange={e => setPgSecretKey(e.target.value)}
                placeholder={pgHasKey ? t("leave_blank_keep") : "sk_test_..."}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("publishable_key")}</label>
              <input value={pgPublishableKey} onChange={e => setPgPublishableKey(e.target.value)}
                placeholder="pk_test_..."
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("mode")}</label>
              <select value={pgSandbox} onChange={e => setPgSandbox(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="true">{t("sandbox")}</option>
                <option value="false">{t("live")}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("currency")}</label>
              <select value={pgCurrency} onChange={e => setPgCurrency(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="KWD">KWD</option>
                <option value="USD">USD</option>
                <option value="SAR">SAR</option>
                <option value="AED">AED</option>
              </select>
            </div>
          </div>
          <button type="submit" disabled={pgSaving}
            className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm">
            {pgSaving ? "..." : t("save")}
          </button>
        </form>

        <div className="mt-6 p-4 bg-cyan-50 rounded-lg border border-cyan-200">
          <h4 className="font-medium text-cyan-800 text-sm mb-2">{t("tap_setup_title")}</h4>
          <ol className="text-xs text-cyan-700 space-y-1 list-decimal list-inside">
            <li>{t("tap_step1")}</li>
            <li>{t("tap_step2")}</li>
            <li>{t("tap_step3")}</li>
            <li>{t("tap_step4")}</li>
          </ol>
        </div>
      </div>

      {/* WhatsApp Integration Settings */}
      <div className="bg-white p-6 rounded-xl shadow-sm border max-w-2xl mt-6">
        <h3 className="text-lg font-semibold mb-4">{t("whatsapp_settings")}</h3>
        <p className="text-sm text-gray-500 mb-4">{t("whatsapp_description")}</p>

        {waMsg && (
          <div className={`p-3 rounded mb-4 text-sm ${
            waMsgType === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}>{waMsg}</div>
        )}

        <form onSubmit={async (e) => {
          e.preventDefault();
          setWaSaving(true);
          try {
            const fd = new URLSearchParams();
            if (waInstanceId) fd.append("instance_id", waInstanceId);
            if (waApiToken) fd.append("api_token", waApiToken);
            if (waApiUrl) fd.append("api_url", waApiUrl);
            if (waPhone) fd.append("default_phone", waPhone);
            fd.append("sales_group", waSalesGroup);
            fd.append("purchases_group", waPurchasesGroup);
            fd.append("expenses_group", waExpensesGroup);
            fd.append("hr_group", waHrGroup);
            fd.append("transfers_group", waTransfersGroup);
            const res = await fetch("/api/whatsapp/settings", {
              method: "POST", body: fd,
              headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
            });
            if (!res.ok) throw new Error("Failed");
            setWaHasToken(!!waApiToken || waHasToken);
            setWaApiToken("");
            setWaMsg(t("whatsapp_saved"));
            setWaMsgType("success");
            setTimeout(() => setWaMsg(""), 5000);
          } catch {
            setWaMsg(t("whatsapp_save_error"));
            setWaMsgType("error");
            setTimeout(() => setWaMsg(""), 5000);
          }
          setWaSaving(false);
        }} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">{t("instance_id")}</label>
              <input value={waInstanceId} onChange={e => setWaInstanceId(e.target.value)}
                placeholder="1101234567"
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                {t("api_token")} {waHasToken && <span className="text-green-600 text-xs">({t("configured")})</span>}
              </label>
              <input type="password" value={waApiToken} onChange={e => setWaApiToken(e.target.value)}
                placeholder={waHasToken ? t("leave_blank_keep") : "abc123..."}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">API URL</label>
              <input value={waApiUrl} onChange={e => setWaApiUrl(e.target.value)}
                placeholder="https://7107.api.greenapi.com"
                className="w-full px-3 py-2 border rounded-lg text-sm" />
              <p className="text-xs text-gray-400 mt-1">From Green API dashboard (e.g. https://7107.api.greenapi.com)</p>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">{t("default_phone")}</label>
              <input value={waPhone} onChange={e => setWaPhone(e.target.value)}
                placeholder="96551414302"
                className="w-full px-3 py-2 border rounded-lg text-sm" />
              <p className="text-xs text-gray-400 mt-1">Include country code (e.g. 965 for Kuwait)</p>
            </div>
          </div>

          <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="font-medium text-blue-800 text-sm">{t("whatsapp_groups")}</h4>
                <p className="text-xs text-blue-600">{t("whatsapp_groups_desc")}</p>
              </div>
              <button type="button" onClick={async () => {
                setWaLoadingGroups(true);
                try {
                  const data = await apiGet("/api/whatsapp/groups");
                  setWaGroupsList(data);
                } catch { setWaGroupsList([]); }
                setWaLoadingGroups(false);
              }}
                className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 whitespace-nowrap">
                {waLoadingGroups ? "..." : t("fetch_groups")}
              </button>
            </div>
            {waGroupsList.length > 0 && (
              <div className="mb-3 max-h-32 overflow-y-auto bg-white rounded border p-2">
                <p className="text-xs font-medium text-gray-600 mb-1">{t("available_groups")}:</p>
                {waGroupsList.map(g => (
                  <div key={g.id} className="text-xs text-gray-700 py-0.5 flex justify-between items-center">
                    <span className="font-medium">{g.name}</span>
                    <code className="text-[10px] bg-gray-100 px-1 rounded select-all">{g.id}</code>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">{t("sales_group")}</label>
                <input value={waSalesGroup} onChange={e => setWaSalesGroup(e.target.value)}
                  placeholder="120363XXXXXXXXX@g.us"
                  className="w-full px-3 py-1.5 border rounded text-xs" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t("purchases_group")}</label>
                <input value={waPurchasesGroup} onChange={e => setWaPurchasesGroup(e.target.value)}
                  placeholder="120363XXXXXXXXX@g.us"
                  className="w-full px-3 py-1.5 border rounded text-xs" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t("expenses_group")}</label>
                <input value={waExpensesGroup} onChange={e => setWaExpensesGroup(e.target.value)}
                  placeholder="120363XXXXXXXXX@g.us"
                  className="w-full px-3 py-1.5 border rounded text-xs" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t("hr_group")}</label>
                <input value={waHrGroup} onChange={e => setWaHrGroup(e.target.value)}
                  placeholder="120363XXXXXXXXX@g.us"
                  className="w-full px-3 py-1.5 border rounded text-xs" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t("transfers_group")}</label>
                <input value={waTransfersGroup} onChange={e => setWaTransfersGroup(e.target.value)}
                  placeholder="120363XXXXXXXXX@g.us"
                  className="w-full px-3 py-1.5 border rounded text-xs" />
              </div>
            </div>
          </div>

          <button type="submit" disabled={waSaving}
            className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm">
            {waSaving ? "..." : t("save")}
          </button>
        </form>

        <div className="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">
          <h4 className="font-medium text-green-800 text-sm mb-2">{t("greenapi_setup_title")}</h4>
          <ol className="text-xs text-green-700 space-y-1 list-decimal list-inside">
            <li>{t("greenapi_step1")}</li>
            <li>{t("greenapi_step2")}</li>
            <li>{t("greenapi_step3")}</li>
            <li>{t("greenapi_step4")}</li>
          </ol>
        </div>
      </div>

      {/* Foodics Integration */}
      <div className="bg-white p-6 rounded-xl shadow-sm border max-w-4xl mb-6">
        <h3 className="text-lg font-semibold mb-1">{t("foodics_integration")}</h3>
        <p className="text-sm text-gray-500 mb-4">{t("foodics_integration_desc")}</p>

        {fcMsg && (
          <div className={`p-3 rounded mb-4 text-sm ${
            fcMsgType === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}>{fcMsg}</div>
        )}

        {fcBusinessName && (
          <div className="p-3 rounded mb-4 text-sm bg-blue-50 text-blue-700">
            {t("connected_to")}: <strong>{fcBusinessName}</strong>
          </div>
        )}

        <form onSubmit={async (e) => {
          e.preventDefault();
          setFcSaving(true);
          try {
            const fd = new URLSearchParams();
            if (fcApiToken) fd.append("api_token", fcApiToken);
            fd.append("base_url", fcBaseUrl);
            fd.append("is_sandbox", String(fcSandbox));
            const res = await apiFetch("/api/foodics/settings", { method: "POST", body: fd });
            if (!res.ok) throw new Error("Failed to save");
            setFcHasToken(true);
            setFcApiToken("");
            setFcMsg(t("saved")); setFcMsgType("success");
          } catch {
            setFcMsg(t("save_error")); setFcMsgType("error");
          }
          setFcSaving(false);
          setTimeout(() => setFcMsg(""), 5000);
        }} className="space-y-4 mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">
                {t("api_token")} {fcHasToken && <span className="text-green-600 text-xs">({t("configured")})</span>}
              </label>
              <input type="password" value={fcApiToken} onChange={e => setFcApiToken(e.target.value)}
                placeholder={fcHasToken ? t("leave_blank_keep") : "eyJ0eXAiOiJKV1Qi..."}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("api_base_url")}</label>
              <input value={fcBaseUrl} onChange={e => setFcBaseUrl(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={fcSandbox} onChange={e => setFcSandbox(e.target.checked)} />
                {t("sandbox_mode")}
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={fcSaving}
              className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm">
              {fcSaving ? "..." : t("save")}
            </button>
            <button type="button" disabled={fcTesting || !fcHasToken} onClick={async () => {
              setFcTesting(true);
              try {
                const res = await apiFetch("/api/foodics/test", { method: "POST" });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || "Test failed");
                setFcBusinessName(data.business || "");
                setFcMsg(t("foodics_connected")); setFcMsgType("success");
              } catch (e: unknown) {
                setFcMsg((e as Error).message || t("foodics_test_error")); setFcMsgType("error");
              }
              setFcTesting(false);
              setTimeout(() => setFcMsg(""), 5000);
            }}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
              {fcTesting ? "..." : t("test_connection")}
            </button>
          </div>
        </form>

        {fcHasToken && (
          <>
            {/* Branch Mapping */}
            <div className="border-t pt-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-sm">{t("branch_mapping")}</h4>
                <button onClick={async () => {
                  setFcLoadingBranches(true);
                  try {
                    const data = await apiGet("/api/foodics/branches");
                    if (Array.isArray(data)) setFcBranches(data);
                  } catch { /* ignore */ }
                  setFcLoadingBranches(false);
                }} disabled={fcLoadingBranches}
                  className="px-3 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200 disabled:opacity-50">
                  {fcLoadingBranches ? "..." : t("fetch_foodics_branches")}
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-3">{t("branch_mapping_desc")}</p>

              {fcBranches.length > 0 && (
                <div className="space-y-2">
                  {fcBranches.map(fb => {
                    const existing = fcBranchMaps.find(m => m.foodics_branch_id === fb.id);
                    return (
                      <div key={fb.id} className="flex items-center gap-3 bg-gray-50 p-2 rounded">
                        <span className="text-sm flex-1">
                          <strong>{fb.name}</strong>
                          {fb.name_localized && <span className="text-gray-400 ml-1">({fb.name_localized})</span>}
                        </span>
                        <span className="text-gray-400 text-xs">→</span>
                        <select
                          value={existing?.local_branch_id || ""}
                          onChange={async (e) => {
                            const localId = e.target.value;
                            if (!localId) return;
                            const fd = new URLSearchParams();
                            fd.append("foodics_branch_id", fb.id);
                            fd.append("foodics_branch_name", fb.name);
                            fd.append("local_branch_id", localId);
                            await apiFetch("/api/foodics/branch-mappings", { method: "POST", body: fd });
                            const updated = await apiGet("/api/foodics/branch-mappings");
                            if (Array.isArray(updated)) setFcBranchMaps(updated);
                          }}
                          className="px-2 py-1 border rounded text-sm min-w-[160px]">
                          <option value="">-- {t("select_branch")} --</option>
                          {branchesList.map(b => (
                            <option key={b.id} value={b.id}>{i18n.language === "ar" ? (b.name_ar || b.name) : b.name}</option>
                          ))}
                        </select>
                        {existing && <span className="text-green-500 text-xs">✓</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {fcBranchMaps.length > 0 && fcBranches.length === 0 && (
                <div className="text-xs text-gray-500">
                  {fcBranchMaps.length} {t("mappings_saved")}
                </div>
              )}
            </div>

            {/* Payment Method Mapping */}
            <div className="border-t pt-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-sm">{t("payment_mapping")}</h4>
                <div className="flex gap-2">
                  <button onClick={async () => {
                    setFcAutoMapping(true);
                    try {
                      const res = await apiFetch("/api/foodics/auto-map-payments", { method: "POST" });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.detail);
                      setFcMsg(`${t("auto_mapped")} ${data.mapped}/${data.total}`); setFcMsgType("success");
                      const updated = await apiGet("/api/foodics/payment-mappings");
                      if (Array.isArray(updated)) setFcPaymentMaps(updated);
                    } catch (e: unknown) {
                      setFcMsg((e as Error).message); setFcMsgType("error");
                    }
                    setFcAutoMapping(false);
                    setTimeout(() => setFcMsg(""), 5000);
                  }} disabled={fcAutoMapping}
                    className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded text-xs hover:bg-emerald-200 disabled:opacity-50">
                    {fcAutoMapping ? "..." : t("auto_map")}
                  </button>
                  <button onClick={async () => {
                    setFcLoadingPayments(true);
                    try {
                      const data = await apiGet("/api/foodics/payment-methods");
                      if (Array.isArray(data)) setFcPaymentMethods(data);
                    } catch { /* ignore */ }
                    setFcLoadingPayments(false);
                  }} disabled={fcLoadingPayments}
                    className="px-3 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200 disabled:opacity-50">
                    {fcLoadingPayments ? "..." : t("fetch_payment_methods")}
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500 mb-3">{t("payment_mapping_desc")}</p>

              {fcPaymentMethods.length > 0 && (
                <div className="space-y-2">
                  {fcPaymentMethods.map(pm => {
                    const existing = fcPaymentMaps.find(m => m.foodics_payment_id === pm.id);
                    return (
                      <div key={pm.id} className="flex items-center gap-3 bg-gray-50 p-2 rounded">
                        <span className="text-sm flex-1">
                          <strong>{pm.name}</strong>
                          {pm.name_localized && <span className="text-gray-400 ml-1">({pm.name_localized})</span>}
                        </span>
                        <span className="text-gray-400 text-xs">→</span>
                        <select
                          value={existing?.local_channel || ""}
                          onChange={async (e) => {
                            const channel = e.target.value;
                            if (!channel) return;
                            const fd = new URLSearchParams();
                            fd.append("foodics_payment_id", pm.id);
                            fd.append("foodics_payment_name", pm.name);
                            fd.append("local_channel", channel);
                            await apiFetch("/api/foodics/payment-mappings", { method: "POST", body: fd });
                            const updated = await apiGet("/api/foodics/payment-mappings");
                            if (Array.isArray(updated)) setFcPaymentMaps(updated);
                          }}
                          className="px-2 py-1 border rounded text-sm min-w-[120px]">
                          <option value="">-- {t("select_channel")} --</option>
                          <option value="cash">Cash</option>
                          <option value="knet">KNET</option>
                          <option value="link">Link/Card</option>
                          <option value="talabat">Talabat</option>
                          <option value="jahez">Jahez</option>
                          <option value="keeta">Keeta</option>
                        </select>
                        {existing && <span className="text-green-500 text-xs">✓</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {fcPaymentMaps.length > 0 && fcPaymentMethods.length === 0 && (
                <div className="text-xs text-gray-500">
                  {fcPaymentMaps.length} {t("mappings_saved")}
                </div>
              )}
            </div>

            {/* Last Sync Info */}
            {fcLastSync && (
              <div className="border-t pt-4">
                <p className="text-xs text-gray-500">
                  {t("last_sync")}: {new Date(fcLastSync).toLocaleString()}
                </p>
              </div>
            )}
          </>
        )}

        <div className="mt-6 p-4 bg-orange-50 rounded-lg border border-orange-200">
          <h4 className="font-medium text-orange-800 text-sm mb-2">{t("foodics_setup_title")}</h4>
          <ol className="text-xs text-orange-700 space-y-1 list-decimal list-inside">
            <li>{t("foodics_step1")}</li>
            <li>{t("foodics_step2")}</li>
            <li>{t("foodics_step3")}</li>
            <li>{t("foodics_step4")}</li>
            <li>{t("foodics_step5")}</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
