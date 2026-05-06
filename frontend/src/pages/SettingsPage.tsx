import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet } from "../contexts/api";

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

export default function SettingsPage() {
  const { t } = useTranslation();
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

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">{t("settings")}</h2>

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
    </div>
  );
}
