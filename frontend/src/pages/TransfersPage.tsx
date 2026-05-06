import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../contexts/api";
import { useAuth } from "../contexts/AuthContext";

interface Branch { id: number; name: string; is_central_kitchen: boolean; }
interface TItem { id: number; name: string; name_ar: string; unit: string; }
interface OrderLine {
  id: number; item_id: number; item_name: string;
  requested_qty: number; dispatched_qty: number | null; received_qty: number | null; unit: string;
}
interface TOrder {
  id: number; requesting_branch_id: number; branch_name: string;
  date: string; status: string; notes: string; lines: OrderLine[];
}

type Tab = "items" | "requests" | "history";

export default function TransfersPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("requests");
  const [items, setItems] = useState<TItem[]>([]);
  const [orders, setOrders] = useState<TOrder[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showItemForm, setShowItemForm] = useState(false);
  const [editItem, setEditItem] = useState<TItem | null>(null);

  // Request form state
  const [reqLines, setReqLines] = useState<{ item_id: number; item_name: string; requested_qty: string; unit: string }[]>([]);

  // Dispatch/Receive modal
  const [actionOrder, setActionOrder] = useState<TOrder | null>(null);
  const [actionType, setActionType] = useState<"dispatch" | "receive">("dispatch");
  const [actionQtys, setActionQtys] = useState<{ line_id: number; qty: string }[]>([]);

  const isOwnerManager = user?.role === "owner" || user?.role === "manager";
  const isCentralKitchen = branches.find(b => b.id === user?.branch_id)?.is_central_kitchen || false;

  useEffect(() => {
    apiGet("/api/transfers/items").then(setItems);
    apiGet("/api/transfers/orders").then(setOrders);
    apiGet("/api/branches/").then(setBranches);
  }, []);

  const reload = () => {
    apiGet("/api/transfers/orders").then(setOrders);
    apiGet("/api/transfers/items").then(setItems);
  };

  const handleItemSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (editItem) {
      await fetch(`/api/transfers/items/${editItem.id}`, {
        method: "PUT", body: fd,
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
    } else {
      await apiPost("/api/transfers/items", fd);
    }
    setShowItemForm(false);
    setEditItem(null);
    reload();
  };

  const handleDeleteItem = async (id: number) => {
    if (!confirm(t("confirm_delete"))) return;
    await fetch(`/api/transfers/items/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    reload();
  };

  const addReqLine = () => {
    if (items.length === 0) return;
    setReqLines([...reqLines, { item_id: items[0].id, item_name: items[0].name, requested_qty: "1", unit: items[0].unit }]);
  };

  const updateReqLine = (idx: number, field: string, value: string) => {
    const updated = [...reqLines];
    if (field === "item_id") {
      const item = items.find(i => i.id === Number(value));
      if (item) {
        updated[idx] = { ...updated[idx], item_id: item.id, item_name: item.name, unit: item.unit };
      }
    } else if (field === "requested_qty") {
      updated[idx] = { ...updated[idx], requested_qty: value };
    }
    setReqLines(updated);
  };

  const removeReqLine = (idx: number) => setReqLines(reqLines.filter((_, i) => i !== idx));

  const handleRequestSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.append("items", JSON.stringify(reqLines));
    if (user?.branch_id) fd.set("requesting_branch_id", String(user.branch_id));
    await apiPost("/api/transfers/orders", fd);
    setShowForm(false);
    setReqLines([]);
    reload();
  };

  const openAction = (order: TOrder, type: "dispatch" | "receive") => {
    setActionOrder(order);
    setActionType(type);
    setActionQtys(order.lines.map(l => ({
      line_id: l.id,
      qty: String(type === "dispatch" ? l.requested_qty : (l.dispatched_qty ?? l.requested_qty)),
    })));
  };

  const handleActionSubmit = async () => {
    if (!actionOrder) return;
    const fd = new FormData();
    const lines = actionQtys.map(a => ({
      line_id: a.line_id,
      [actionType === "dispatch" ? "dispatched_qty" : "received_qty"]: a.qty,
    }));
    fd.append("lines", JSON.stringify(lines));
    await fetch(`/api/transfers/orders/${actionOrder.id}/${actionType}`, {
      method: "POST", body: fd,
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    setActionOrder(null);
    reload();
  };

  const pendingOrders = orders.filter(o => o.status !== "received");
  const historyOrders = orders.filter(o => o.status === "received");

  const itemName = (item: TItem) => i18n.language === "ar" && item.name_ar ? item.name_ar : item.name;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-gray-800">{t("internal_transfer")}</h2>
        {tab === "requests" && (
          <button onClick={() => { setShowForm(!showForm); if (!showForm && reqLines.length === 0) addReqLine(); }}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm">
            {showForm ? t("cancel") : t("new_request")}
          </button>
        )}
        {tab === "items" && isOwnerManager && (
          <button onClick={() => { setShowItemForm(!showItemForm); setEditItem(null); }}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm">
            {showItemForm ? t("cancel") : t("add_item")}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {(["requests", "items", "history"] as Tab[]).map(tb => (
          <button key={tb} onClick={() => setTab(tb)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              tab === tb ? "bg-white shadow text-emerald-700" : "text-gray-500 hover:text-gray-700"
            }`}>
            {tb === "requests" ? t("requests") : tb === "items" ? t("item_list") : t("history")}
          </button>
        ))}
      </div>

      {/* ========== ITEMS TAB ========== */}
      {tab === "items" && (
        <>
          {showItemForm && (
            <form onSubmit={handleItemSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-4 space-y-4">
              <h3 className="font-semibold">{editItem ? t("edit_item") : t("add_item")}</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t("item_name")}</label>
                  <input name="name" required defaultValue={editItem?.name || ""}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("item_name_ar")}</label>
                  <input name="name_ar" defaultValue={editItem?.name_ar || ""}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("unit")}</label>
                  <select name="unit" defaultValue={editItem?.unit || "pcs"} className="w-full px-3 py-2 border rounded-lg text-sm">
                    {["pcs", "kg", "g", "liter", "ml", "box", "carton", "pack", "bag", "bottle", "can", "tray"].map(u =>
                      <option key={u} value={u}>{u}</option>
                    )}
                  </select>
                </div>
              </div>
              <button type="submit" className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
                {t("save")}
              </button>
            </form>
          )}
          <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left">{t("item_name")}</th>
                  <th className="px-4 py-3 text-left">{t("item_name_ar")}</th>
                  <th className="px-4 py-3 text-left">{t("unit")}</th>
                  {isOwnerManager && <th className="px-4 py-3 text-center">{t("actions")}</th>}
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
                ) : items.map(item => (
                  <tr key={item.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3">{item.name}</td>
                    <td className="px-4 py-3">{item.name_ar}</td>
                    <td className="px-4 py-3">{item.unit}</td>
                    {isOwnerManager && (
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => { setEditItem(item); setShowItemForm(true); }}
                          className="px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600 mr-1">{t("edit")}</button>
                        <button onClick={() => handleDeleteItem(item.id)}
                          className="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">{t("delete")}</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ========== REQUESTS TAB ========== */}
      {tab === "requests" && (
        <>
          {showForm && (
            <form onSubmit={handleRequestSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-4 space-y-4">
              <h3 className="font-semibold">{t("new_request")}</h3>
              <div className="grid grid-cols-2 gap-4">
                {user?.branch_id ? (
                  <input type="hidden" name="requesting_branch_id" value={user.branch_id} />
                ) : (
                  <div>
                    <label className="block text-sm font-medium mb-1">{t("requesting_branch")}</label>
                    <select name="requesting_branch_id" required className="w-full px-3 py-2 border rounded-lg text-sm">
                      {branches.filter(b => !b.is_central_kitchen).map(b =>
                        <option key={b.id} value={b.id}>{b.name}</option>
                      )}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">{t("date")}</label>
                  <input type="date" name="order_date" required defaultValue={new Date().toISOString().slice(0, 10)}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">{t("items")}</label>
                  <button type="button" onClick={addReqLine}
                    className="px-3 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">+ {t("add_item")}</button>
                </div>
                {reqLines.map((line, idx) => (
                  <div key={idx} className="flex gap-2 mb-2 items-center">
                    <select value={line.item_id} onChange={e => updateReqLine(idx, "item_id", e.target.value)}
                      className="flex-1 px-3 py-2 border rounded-lg text-sm">
                      {items.map(it => <option key={it.id} value={it.id}>{itemName(it)}</option>)}
                    </select>
                    <input type="number" step="0.01" min="0.01" value={line.requested_qty}
                      onChange={e => updateReqLine(idx, "requested_qty", e.target.value)}
                      className="w-24 px-3 py-2 border rounded-lg text-sm" placeholder={t("quantity")} />
                    <span className="text-sm text-gray-500 w-12">{line.unit}</span>
                    <button type="button" onClick={() => removeReqLine(idx)}
                      className="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">X</button>
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">{t("notes")}</label>
                <input name="notes" className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>

              <button type="submit" className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
                {t("submit_request")}
              </button>
            </form>
          )}

          <div className="space-y-3">
            {pendingOrders.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-400">{t("no_pending_requests")}</div>
            ) : pendingOrders.map(order => (
              <div key={order.id} className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <div className="px-5 py-4 flex items-center justify-between bg-gray-50 border-b">
                  <div>
                    <span className="font-semibold text-gray-800">#{order.id}</span>
                    <span className="mx-2 text-gray-400">|</span>
                    <span className="text-sm text-gray-600">{order.branch_name}</span>
                    <span className="mx-2 text-gray-400">|</span>
                    <span className="text-sm text-gray-500">{order.date}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      order.status === "requested" ? "bg-yellow-100 text-yellow-700" :
                      order.status === "dispatched" ? "bg-blue-100 text-blue-700" :
                      "bg-green-100 text-green-700"
                    }`}>{t(order.status)}</span>
                    {order.status === "requested" && (isOwnerManager || isCentralKitchen) && (
                      <button onClick={() => openAction(order, "dispatch")}
                        className="px-3 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">
                        {t("dispatch")}
                      </button>
                    )}
                    {order.status === "dispatched" && (
                      <button onClick={() => openAction(order, "receive")}
                        className="px-3 py-1 bg-emerald-500 text-white rounded text-xs hover:bg-emerald-600">
                        {t("confirm_receive")}
                      </button>
                    )}
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left">{t("item_name")}</th>
                      <th className="px-4 py-2 text-right">{t("requested")}</th>
                      <th className="px-4 py-2 text-right">{t("dispatched")}</th>
                      <th className="px-4 py-2 text-right">{t("received")}</th>
                      <th className="px-4 py-2 text-left">{t("unit")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.lines.map(line => (
                      <tr key={line.id} className="border-t">
                        <td className="px-4 py-2">{line.item_name}</td>
                        <td className="px-4 py-2 text-right font-mono">{line.requested_qty}</td>
                        <td className="px-4 py-2 text-right font-mono">{line.dispatched_qty ?? "-"}</td>
                        <td className="px-4 py-2 text-right font-mono">{line.received_qty ?? "-"}</td>
                        <td className="px-4 py-2">{line.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {order.notes && <div className="px-5 py-2 text-xs text-gray-500 border-t">{order.notes}</div>}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ========== HISTORY TAB ========== */}
      {tab === "history" && (
        <div className="space-y-3">
          {historyOrders.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-400">{t("no_data")}</div>
          ) : historyOrders.map(order => (
            <div key={order.id} className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <div className="px-5 py-3 flex items-center justify-between bg-gray-50 border-b">
                <div>
                  <span className="font-semibold text-gray-800">#{order.id}</span>
                  <span className="mx-2 text-gray-400">|</span>
                  <span className="text-sm text-gray-600">{order.branch_name}</span>
                  <span className="mx-2 text-gray-400">|</span>
                  <span className="text-sm text-gray-500">{order.date}</span>
                </div>
                <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">{t("received")}</span>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left">{t("item_name")}</th>
                    <th className="px-4 py-2 text-right">{t("requested")}</th>
                    <th className="px-4 py-2 text-right">{t("dispatched")}</th>
                    <th className="px-4 py-2 text-right">{t("received")}</th>
                    <th className="px-4 py-2 text-left">{t("unit")}</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map(line => (
                    <tr key={line.id} className="border-t">
                      <td className="px-4 py-2">{line.item_name}</td>
                      <td className="px-4 py-2 text-right font-mono">{line.requested_qty}</td>
                      <td className="px-4 py-2 text-right font-mono">{line.dispatched_qty ?? "-"}</td>
                      <td className="px-4 py-2 text-right font-mono">{line.received_qty ?? "-"}</td>
                      <td className="px-4 py-2">{line.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* ========== DISPATCH / RECEIVE MODAL ========== */}
      {actionOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-lg w-full space-y-4">
            <h3 className="text-lg font-bold">
              {actionType === "dispatch" ? t("dispatch_order") : t("confirm_receive")} #{actionOrder.id}
            </h3>
            <p className="text-sm text-gray-500">{actionOrder.branch_name} | {actionOrder.date}</p>
            <div className="space-y-2">
              {actionOrder.lines.map((line, idx) => (
                <div key={line.id} className="flex items-center gap-3">
                  <span className="flex-1 text-sm">{line.item_name}</span>
                  <span className="text-xs text-gray-400 w-20 text-right">
                    {actionType === "dispatch" ? `${t("requested")}: ${line.requested_qty}` : `${t("dispatched")}: ${line.dispatched_qty ?? line.requested_qty}`}
                  </span>
                  <input type="number" step="0.01" min="0"
                    value={actionQtys[idx]?.qty || "0"}
                    onChange={e => {
                      const updated = [...actionQtys];
                      updated[idx] = { ...updated[idx], qty: e.target.value };
                      setActionQtys(updated);
                    }}
                    className="w-24 px-3 py-2 border rounded-lg text-sm" />
                  <span className="text-xs text-gray-500 w-10">{line.unit}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={handleActionSubmit}
                className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
                {actionType === "dispatch" ? t("confirm_dispatch") : t("confirm_receive")}
              </button>
              <button onClick={() => setActionOrder(null)}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm">
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
