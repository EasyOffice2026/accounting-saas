import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiFetch, apiPost } from "../contexts/api";

interface ContractRecord {
  id: number; name: string; kind: string; place: string; period: string;
  value: number; start_date: string; end_date: string;
  monthly_payment: number; payment_day: number;
  notes: string; status: string; created_at: string;
}

interface ContractPaymentRecord {
  id: number; contract_id: number; due_date: string;
  amount: number; status: string; paid_date: string | null;
  payment_method: string | null; reference: string | null; notes: string | null;
}

const DEFAULT_CONTRACT_TYPES = ["Rent Contract", "Legal Contract", "Internet Contract"];

export default function ContractsPage() {
  const { t } = useTranslation();
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ContractRecord | null>(null);
  const [customType, setCustomType] = useState("");
  const [selectedKind, setSelectedKind] = useState("");
  const [expandedContract, setExpandedContract] = useState<number | null>(null);
  const [payments, setPayments] = useState<ContractPaymentRecord[]>([]);
  const [showPaymentForm, setShowPaymentForm] = useState(false);

  const currentUser = JSON.parse(localStorage.getItem("user") || "{}");
  const isManager = currentUser.role === "owner" || currentUser.role === "manager";

  // Build unique contract types list from defaults + existing contracts
  const contractTypes = Array.from(new Set([
    ...DEFAULT_CONTRACT_TYPES,
    ...contracts.map(c => c.kind).filter(k => k && !DEFAULT_CONTRACT_TYPES.includes(k))
  ]));

  useEffect(() => {
    apiGet("/api/hr/contracts").then(setContracts);
  }, []);

  useEffect(() => {
    if (editing) setSelectedKind(editing.kind || "");
    else setSelectedKind("");
  }, [editing]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">{t("contracts_tab")}</h1>
        {isManager && (
          <button onClick={() => { setShowForm(!showForm); setEditing(null); }}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
            {showForm ? t("cancel") : t("add_contract")}
          </button>
        )}
      </div>

      {(showForm || editing) && (
        <form onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          try {
            if (editing) {
              await apiFetch(`/api/hr/contracts/${editing.id}`, { method: "PUT", body: fd });
            } else {
              await apiFetch("/api/hr/contracts", { method: "POST", body: fd });
            }
            setShowForm(false);
            setEditing(null);
            apiGet("/api/hr/contracts").then(setContracts);
          } catch (err: unknown) { alert((err as Error).message); }
        }} className="bg-white p-6 rounded-xl shadow-sm border mb-6 space-y-4">
          <h3 className="font-semibold text-lg">{editing ? t("edit_contract") : t("add_contract")}</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">{t("contract_name")}</label>
              <input type="text" name="name" defaultValue={editing?.name || ""} required className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("contract_type")}</label>
              <select value={selectedKind} onChange={e => { setSelectedKind(e.target.value); setCustomType(""); }}
                className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="">{t("select")}</option>
                {contractTypes.map(k => <option key={k} value={k}>{k}</option>)}
                <option value="__custom__">{t("add_new_type")}</option>
              </select>
              {selectedKind === "__custom__" && (
                <input type="text" value={customType} onChange={e => setCustomType(e.target.value)}
                  placeholder={t("enter_new_type")} className="w-full px-3 py-2 border rounded-lg text-sm mt-2" />
              )}
              <input type="hidden" name="kind" value={selectedKind === "__custom__" ? customType : selectedKind} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("contract_period")}</label>
              <select name="period" defaultValue={editing?.period || ""} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="">{t("select")}</option>
                <option value="weekly">{t("weekly")}</option>
                <option value="monthly">{t("monthly")}</option>
                <option value="quarterly">{t("quarterly")}</option>
                <option value="half_yearly">{t("half_yearly")}</option>
                <option value="yearly">{t("yearly")}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("contract_value")}</label>
              <input type="number" step="0.001" name="value" defaultValue={editing?.value || 0} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("start_date")}</label>
              <input type="date" name="start_date" defaultValue={editing?.start_date || ""} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("end_date")}</label>
              <input type="date" name="end_date" defaultValue={editing?.end_date || ""} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("monthly_payment")}</label>
              <input type="number" step="0.001" name="monthly_payment" defaultValue={editing?.monthly_payment || 0} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("payment_day")}</label>
              <input type="number" min="1" max="28" name="payment_day" defaultValue={editing?.payment_day || 1} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("status")}</label>
              <select name="status" defaultValue={editing?.status || "active"} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="active">{t("active")}</option>
                <option value="expired">{t("expired")}</option>
                <option value="cancelled">{t("cancelled")}</option>
              </select>
            </div>
            <div className="col-span-2 md:col-span-3">
              <label className="block text-sm font-medium mb-1">{t("notes")}</label>
              <textarea name="notes" defaultValue={editing?.notes || ""} rows={2} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm">{t("save")}</button>
            {editing && <button type="button" onClick={() => setEditing(null)} className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm">{t("cancel")}</button>}
          </div>
        </form>
      )}

      {/* Payment Reminders */}
      {(() => {
        const today = new Date();
        const currentDay = today.getDate();
        const upcoming = contracts.filter(c => c.status === "active" && c.monthly_payment > 0);
        const due = upcoming.filter(c => {
          const diff = c.payment_day - currentDay;
          return diff >= 0 && diff <= 7;
        });
        if (due.length === 0) return null;
        return (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
            <h4 className="font-semibold text-amber-800 text-sm mb-2">⏰ {t("payment_reminders")}</h4>
            {due.map(c => (
              <div key={c.id} className="text-sm text-amber-700">
                <strong>{c.name}</strong> — {c.monthly_payment} KD {t("due_on_day")} {c.payment_day}
              </div>
            ))}
          </div>
        );
      })()}

      {/* Contracts Table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-3 py-3 text-left">{t("contract_name")}</th>
              <th className="px-3 py-3 text-left">{t("contract_type")}</th>
              <th className="px-3 py-3 text-left">{t("contract_period")}</th>
              <th className="px-3 py-3 text-right">{t("contract_value")}</th>
              <th className="px-3 py-3 text-center">{t("status")}</th>
              {isManager && <th className="px-3 py-3 text-center">{t("actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {contracts.length === 0 ? (
              <tr><td colSpan={isManager ? 6 : 5} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
            ) : contracts.map(c => (
              <React.Fragment key={c.id}>
              <tr className="border-b hover:bg-gray-50">
                <td className="px-3 py-3 font-medium">{c.name}</td>
                <td className="px-3 py-3">{c.kind || "—"}</td>
                <td className="px-3 py-3">{c.period ? t(c.period) : "—"}</td>
                <td className="px-3 py-3 text-right">{c.value}</td>
                <td className="px-3 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    c.status === "active" ? "bg-green-100 text-green-700" :
                    c.status === "expired" ? "bg-gray-100 text-gray-700" :
                    "bg-red-100 text-red-700"
                  }`}>{t(c.status)}</span>
                </td>
                {isManager && (
                  <td className="px-3 py-3 text-center">
                    <button onClick={() => {
                      if (expandedContract === c.id) { setExpandedContract(null); }
                      else { setExpandedContract(c.id); apiGet(`/api/hr/contracts/${c.id}/payments`).then(setPayments); }
                    }} className="text-purple-600 hover:underline text-xs mr-2">{t("payments")}</button>
                    <button onClick={() => { setEditing(c); setShowForm(false); }}
                      className="text-blue-600 hover:underline text-xs mr-2">{t("edit")}</button>
                    <button onClick={async () => {
                      if (!confirm(t("confirm_delete"))) return;
                      await apiFetch(`/api/hr/contracts/${c.id}`, { method: "DELETE" });
                      apiGet("/api/hr/contracts").then(setContracts);
                    }} className="text-red-600 hover:underline text-xs">{t("delete")}</button>
                  </td>
                )}
              </tr>
              {/* Payment tracking expanded row */}
              {expandedContract === c.id && (
                <tr>
                  <td colSpan={isManager ? 6 : 5} className="px-4 py-4 bg-gray-50">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-sm">{t("payment_schedule")} — {c.name}</h4>
                        <div className="flex gap-2">
                          {payments.length === 0 && c.monthly_payment > 0 && (
                            <button onClick={async () => {
                              await apiPost(`/api/hr/contracts/${c.id}/generate-payments`, new FormData());
                              apiGet(`/api/hr/contracts/${c.id}/payments`).then(setPayments);
                            }} className="px-3 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">
                              {t("generate_schedule")}
                            </button>
                          )}
                          <button onClick={() => setShowPaymentForm(!showPaymentForm)}
                            className="px-3 py-1 bg-emerald-500 text-white rounded text-xs hover:bg-emerald-600">
                            {showPaymentForm ? t("cancel") : t("add_payment")}
                          </button>
                        </div>
                      </div>

                      {showPaymentForm && (
                        <form onSubmit={async (e) => {
                          e.preventDefault();
                          const fd = new FormData(e.currentTarget);
                          await apiFetch(`/api/hr/contracts/${c.id}/payments`, { method: "POST", body: fd });
                          setShowPaymentForm(false);
                          apiGet(`/api/hr/contracts/${c.id}/payments`).then(setPayments);
                        }} className="bg-white p-4 rounded border grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div>
                            <label className="block text-xs mb-1">{t("due_date")}</label>
                            <input type="date" name="due_date" required className="w-full border rounded px-2 py-1.5 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs mb-1">{t("amount")}</label>
                            <input type="number" step="0.001" name="amount" required defaultValue={c.monthly_payment}
                              className="w-full border rounded px-2 py-1.5 text-sm" />
                          </div>
                          <div>
                            <label className="block text-xs mb-1">{t("status")}</label>
                            <select name="status" className="w-full border rounded px-2 py-1.5 text-sm">
                              <option value="pending">{t("pending")}</option>
                              <option value="paid">{t("paid")}</option>
                            </select>
                          </div>
                          <div className="flex items-end">
                            <button type="submit" className="px-4 py-1.5 bg-emerald-600 text-white rounded text-sm">{t("save")}</button>
                          </div>
                        </form>
                      )}

                      {/* Payment summary */}
                      {payments.length > 0 && (
                        <div className="flex gap-4 text-sm">
                          <span className="text-green-700 font-medium">
                            {t("paid")}: KD {payments.filter(p => p.status === "paid").reduce((s, p) => s + p.amount, 0).toFixed(3)}
                          </span>
                          <span className="text-amber-700 font-medium">
                            {t("pending")}: KD {payments.filter(p => p.status === "pending").reduce((s, p) => s + p.amount, 0).toFixed(3)}
                          </span>
                          <span className="text-red-700 font-medium">
                            {t("overdue")}: KD {payments.filter(p => p.status === "overdue").reduce((s, p) => s + p.amount, 0).toFixed(3)}
                          </span>
                          <span className="text-gray-700 font-bold">
                            {t("total")}: KD {payments.reduce((s, p) => s + p.amount, 0).toFixed(3)}
                          </span>
                        </div>
                      )}

                      {/* Payments table */}
                      <table className="w-full text-xs bg-white rounded border">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="px-3 py-2 text-left">{t("due_date")}</th>
                            <th className="px-3 py-2 text-right">{t("amount")}</th>
                            <th className="px-3 py-2 text-center">{t("status")}</th>
                            <th className="px-3 py-2 text-left">{t("paid_date")}</th>
                            <th className="px-3 py-2 text-left">{t("payment_method")}</th>
                            <th className="px-3 py-2 text-left">{t("reference")}</th>
                            <th className="px-3 py-2 text-center">{t("actions")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {payments.length === 0 ? (
                            <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-400">{t("no_payments")}</td></tr>
                          ) : payments.map(p => (
                            <tr key={p.id} className={`border-t ${p.status === "paid" ? "bg-green-50" : p.status === "overdue" ? "bg-red-50" : ""}`}>
                              <td className="px-3 py-2">{p.due_date}</td>
                              <td className="px-3 py-2 text-right font-mono">KD {p.amount.toFixed(3)}</td>
                              <td className="px-3 py-2 text-center">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                  p.status === "paid" ? "bg-green-100 text-green-700" :
                                  p.status === "overdue" ? "bg-red-100 text-red-700" :
                                  "bg-amber-100 text-amber-700"
                                }`}>{t(p.status)}</span>
                              </td>
                              <td className="px-3 py-2">{p.paid_date || "—"}</td>
                              <td className="px-3 py-2">{p.payment_method || "—"}</td>
                              <td className="px-3 py-2">{p.reference || "—"}</td>
                              <td className="px-3 py-2 text-center space-x-1">
                                {p.status !== "paid" && (
                                  <button onClick={async () => {
                                    const fd = new FormData();
                                    fd.append("status", "paid");
                                    fd.append("paid_date", new Date().toISOString().slice(0, 10));
                                    fd.append("amount", String(p.amount));
                                    await apiFetch(`/api/hr/contract-payments/${p.id}`, { method: "PUT", body: fd });
                                    apiGet(`/api/hr/contracts/${c.id}/payments`).then(setPayments);
                                  }} className="text-green-600 hover:underline">{t("mark_paid")}</button>
                                )}
                                <button onClick={async () => {
                                  if (!confirm(t("confirm_delete"))) return;
                                  await apiFetch(`/api/hr/contract-payments/${p.id}`, { method: "DELETE" });
                                  apiGet(`/api/hr/contracts/${c.id}/payments`).then(setPayments);
                                }} className="text-red-600 hover:underline">{t("delete")}</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
