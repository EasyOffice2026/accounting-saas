import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../contexts/api";
import { useAuth } from "../contexts/AuthContext";

interface Branch { id: number; name: string; is_central_kitchen: boolean; }
interface TItem { id: number; name: string; name_ar: string; unit: string; unit_price: number; opening_stock: number; category: string; }
interface OrderLine {
  id: number; item_id: number; item_name: string; item_name_ar: string | null;
  requested_qty: number; dispatched_qty: number | null; received_qty: number | null; unit: string; unit_price: number;
}
interface InventoryItem {
  id: number; name: string; name_ar: string; unit: string; unit_price: number;
  opening_stock: number; total_dispatched: number; remaining: number; category: string;
}
interface BranchSummary {
  branch_id: number; branch_name: string; branch_name_ar: string;
  items: { item_name: string; item_name_ar: string; unit: string; total_qty: number; total_amount: number }[];
  total_amount: number;
}
interface TOrder {
  id: number; requesting_branch_id: number; branch_name: string;
  date: string; status: string; notes: string; lines: OrderLine[];
}

type Tab = "items" | "requests" | "history" | "inventory" | "branch_summary";

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

  // Category filter for items
  const [itemCategory, setItemCategory] = useState<"food" | "packaging">("food");

  // Request form state - checklist approach
  const [requestCategory, setRequestCategory] = useState<"food" | "packaging">("food");
  const [checkedItems, setCheckedItems] = useState<Record<number, string>>({});

  // Dispatch/Receive modal
  const [actionOrder, setActionOrder] = useState<TOrder | null>(null);
  const [actionType, setActionType] = useState<"dispatch" | "receive">("dispatch");
  const [actionQtys, setActionQtys] = useState<{ line_id: number; qty: string }[]>([]);

  // Inventory & Branch summary
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [branchSummary, setBranchSummary] = useState<BranchSummary[]>([]);
  const [invCategory, setInvCategory] = useState<"food" | "packaging">("food");
  const [invStartDate, setInvStartDate] = useState("");
  const [invEndDate, setInvEndDate] = useState("");

  const isOwnerManager = user?.role === "owner" || user?.role === "manager";
  const isCentralKitchen = branches.find(b => b.id === user?.branch_id)?.is_central_kitchen || false;

  useEffect(() => {
    apiGet("/api/transfers/items").then(setItems);
    apiGet("/api/transfers/orders").then(setOrders);
    apiGet("/api/branches/").then(setBranches);
    apiGet("/api/transfers/inventory").then(setInventory);
    apiGet("/api/transfers/branch-summary").then(setBranchSummary);
  }, []);

  const reload = () => {
    apiGet("/api/transfers/orders").then(setOrders);
    apiGet("/api/transfers/items").then(setItems);
    apiGet("/api/transfers/inventory").then(setInventory);
    apiGet("/api/transfers/branch-summary").then(setBranchSummary);
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

  const toggleItem = (itemId: number) => {
    setCheckedItems(prev => {
      const copy = { ...prev };
      if (copy[itemId] !== undefined) {
        delete copy[itemId];
      } else {
        copy[itemId] = "1";
      }
      return copy;
    });
  };

  const updateItemQty = (itemId: number, qty: string) => {
    setCheckedItems(prev => ({ ...prev, [itemId]: qty }));
  };

  const handleRequestSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const selectedItems = Object.entries(checkedItems)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([id, qty]) => {
        const item = items.find(i => i.id === Number(id));
        return {
          item_id: Number(id),
          item_name: item?.name || "",
          item_name_ar: item?.name_ar || "",
          requested_qty: qty,
          unit: item?.unit || "pcs",
          unit_price: item?.unit_price || 0,
        };
      });
    if (selectedItems.length === 0) return;
    const fd = new FormData(e.currentTarget);
    fd.append("items", JSON.stringify(selectedItems));
    if (user?.branch_id) fd.set("requesting_branch_id", String(user.branch_id));
    await apiPost("/api/transfers/orders", fd);
    setShowForm(false);
    setCheckedItems({});
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

  const lineName = (line: OrderLine) => i18n.language === "ar" && line.item_name_ar ? line.item_name_ar : line.item_name;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-gray-800">{t("internal_transfer")}</h2>
        {tab === "requests" && (
          <button onClick={() => { setShowForm(!showForm); if (showForm) setCheckedItems({}); }}
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
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit flex-wrap">
        {(["requests", "items", "inventory", "branch_summary", "history"] as Tab[]).map(tb => (
          <button key={tb} onClick={() => setTab(tb)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              tab === tb ? "bg-white shadow text-emerald-700" : "text-gray-500 hover:text-gray-700"
            }`}>
            {tb === "requests" ? t("requests") : tb === "items" ? t("item_list") : tb === "inventory" ? t("inventory") : tb === "branch_summary" ? t("branch_summary") : t("history")}
          </button>
        ))}
      </div>

      {/* ========== ITEMS TAB ========== */}
      {tab === "items" && (
        <>
          {/* Category selector */}
          <div className="flex gap-2 mb-4">
            <button onClick={() => setItemCategory("food")}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${itemCategory === "food" ? "bg-emerald-600 text-white" : "bg-gray-200 text-gray-700"}`}>
              {t("food_items")}
            </button>
            <button onClick={() => setItemCategory("packaging")}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${itemCategory === "packaging" ? "bg-orange-500 text-white" : "bg-gray-200 text-gray-700"}`}>
              {t("packaging_items")}
            </button>
          </div>

          {showItemForm && (
            <form onSubmit={handleItemSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-4 space-y-4">
              <h3 className="font-semibold">{editItem ? t("edit_item") : t("add_item")}</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                    {["pcs", "kg", "g", "liter", "ml", "box", "carton", "pack", "bag", "bottle", "can", "tray", "roll", "sheet"].map(u =>
                      <option key={u} value={u}>{u}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("category")}</label>
                  <select name="category" defaultValue={editItem?.category || itemCategory} className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="food">{t("food_items")}</option>
                    <option value="packaging">{t("packaging_items")}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("unit_price")}</label>
                  <input name="unit_price" type="number" step="0.001" defaultValue={editItem?.unit_price || 0}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("opening_stock")}</label>
                  <input name="opening_stock" type="number" step="0.01" defaultValue={editItem?.opening_stock || 0}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
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
                  <th className="px-4 py-3 text-right">{t("unit_price")}</th>
                  <th className="px-4 py-3 text-right">{t("opening_stock")}</th>
                  {isOwnerManager && <th className="px-4 py-3 text-center">{t("actions")}</th>}
                </tr>
              </thead>
              <tbody>
                {items.filter(i => (i.category || "food") === itemCategory).length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
                ) : items.filter(i => (i.category || "food") === itemCategory).map(item => (
                  <tr key={item.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{item.name}</td>
                    <td className="px-4 py-3" dir="rtl">{item.name_ar || "—"}</td>
                    <td className="px-4 py-3">{item.unit}</td>
                    <td className="px-4 py-3 text-right font-mono">{(item.unit_price || 0).toFixed(3)}</td>
                    <td className="px-4 py-3 text-right font-mono">{item.opening_stock || 0}</td>
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
                <label className="text-sm font-medium mb-2 block">{t("select_items")}</label>
                {/* Category selector */}
                <div className="flex gap-2 mb-3">
                  <button type="button" onClick={() => setRequestCategory("food")}
                    className={`px-3 py-1.5 rounded text-xs font-medium ${requestCategory === "food" ? "bg-emerald-600 text-white" : "bg-gray-200 text-gray-700"}`}>
                    {t("food_items")}
                  </button>
                  <button type="button" onClick={() => setRequestCategory("packaging")}
                    className={`px-3 py-1.5 rounded text-xs font-medium ${requestCategory === "packaging" ? "bg-orange-500 text-white" : "bg-gray-200 text-gray-700"}`}>
                    {t("packaging_items")}
                  </button>
                </div>
                <div className="border rounded-lg divide-y max-h-80 overflow-y-auto">
                  {items.filter(i => (i.category || "food") === requestCategory).map(item => {
                    const isChecked = checkedItems[item.id] !== undefined;
                    return (
                      <div key={item.id}
                        className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition ${
                          isChecked ? "bg-emerald-50" : "hover:bg-gray-50"
                        }`}
                        onClick={() => toggleItem(item.id)}>
                        <input type="checkbox" checked={isChecked} readOnly
                          className="w-4 h-4 text-emerald-600 rounded" />
                        <span className="flex-1 text-sm font-medium">
                          {i18n.language === "ar" ? (
                            <>{item.name_ar || item.name} <span className="text-xs text-gray-400">({item.name})</span></>
                          ) : (
                            <>{item.name} {item.name_ar && <span className="text-xs text-gray-400" dir="rtl">({item.name_ar})</span>}</>
                          )}
                        </span>
                        <span className="text-xs text-gray-400 w-12">{item.unit}</span>
                        {isChecked && (
                          <input type="number" step="0.01" min="0.01"
                            value={checkedItems[item.id]}
                            onClick={e => e.stopPropagation()}
                            onChange={e => updateItemQty(item.id, e.target.value)}
                            className="w-20 px-2 py-1 border rounded text-sm text-center" />
                        )}
                      </div>
                    );
                  })}
                  {items.filter(i => (i.category || "food") === requestCategory).length === 0 && (
                    <div className="px-4 py-6 text-center text-gray-400 text-sm">{t("no_data")}</div>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">{Object.keys(checkedItems).length} {t("items")} {t("selected")}</p>
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
                        <td className="px-4 py-2">
                          {lineName(line)}
                          {i18n.language === "ar" && line.item_name && <span className="text-xs text-gray-400 ml-1">({line.item_name})</span>}
                          {i18n.language !== "ar" && line.item_name_ar && <span className="text-xs text-gray-400 ml-1" dir="rtl">({line.item_name_ar})</span>}
                        </td>
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
                      <td className="px-4 py-2">
                        {lineName(line)}
                        {i18n.language === "ar" && line.item_name && <span className="text-xs text-gray-400 ml-1">({line.item_name})</span>}
                        {i18n.language !== "ar" && line.item_name_ar && <span className="text-xs text-gray-400 ml-1" dir="rtl">({line.item_name_ar})</span>}
                      </td>
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

      {/* ========== INVENTORY TAB ========== */}
      {tab === "inventory" && (
        <>
          <div className="flex gap-2 mb-4 flex-wrap items-end">
            <button onClick={() => setInvCategory("food")}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${invCategory === "food" ? "bg-emerald-600 text-white" : "bg-gray-200 text-gray-700"}`}>
              {t("food_items")}
            </button>
            <button onClick={() => setInvCategory("packaging")}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${invCategory === "packaging" ? "bg-orange-500 text-white" : "bg-gray-200 text-gray-700"}`}>
              {t("packaging_items")}
            </button>
            <div className="flex gap-2 items-center ml-auto">
              <div className="flex flex-col">
                <label className="text-[10px] text-gray-500 mb-0.5">{t("start_date")}</label>
                <input type="date" value={invStartDate} onChange={e => setInvStartDate(e.target.value)}
                  className="px-2 py-1.5 border rounded text-sm" />
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] text-gray-500 mb-0.5">{t("end_date")}</label>
                <input type="date" value={invEndDate} onChange={e => setInvEndDate(e.target.value)}
                  className="px-2 py-1.5 border rounded text-sm" />
              </div>
              <button onClick={() => {
                const params = new URLSearchParams();
                if (invStartDate) params.set("start_date", invStartDate);
                if (invEndDate) params.set("end_date", invEndDate);
                const qs = params.toString();
                apiGet(`/api/transfers/inventory${qs ? `?${qs}` : ""}`).then(setInventory);
                apiGet(`/api/transfers/branch-summary${qs ? `?${qs}` : ""}`).then(setBranchSummary);
              }} className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-700 mt-3">
                {t("filter")}
              </button>
              {(invStartDate || invEndDate) && (
                <button onClick={() => {
                  setInvStartDate(""); setInvEndDate("");
                  apiGet("/api/transfers/inventory").then(setInventory);
                  apiGet("/api/transfers/branch-summary").then(setBranchSummary);
                }} className="px-3 py-1.5 bg-gray-300 text-gray-700 rounded text-sm hover:bg-gray-400 mt-3">
                  {t("clear")}
                </button>
              )}
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left">{t("item_name")}</th>
                  <th className="px-4 py-3 text-left">{t("item_name_ar")}</th>
                  <th className="px-4 py-3 text-left">{t("unit")}</th>
                  <th className="px-4 py-3 text-right">{t("unit_price")}</th>
                  <th className="px-4 py-3 text-right">{t("opening_stock")}</th>
                  <th className="px-4 py-3 text-right">{t("total_dispatched")}</th>
                  <th className="px-4 py-3 text-right font-bold">{t("remaining")}</th>
                </tr>
              </thead>
              <tbody>
                {inventory.filter(i => (i.category || "food") === invCategory).length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
                ) : inventory.filter(i => (i.category || "food") === invCategory).map(inv => (
                  <tr key={inv.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{inv.name}</td>
                    <td className="px-4 py-3" dir="rtl">{inv.name_ar || "—"}</td>
                    <td className="px-4 py-3">{inv.unit}</td>
                    <td className="px-4 py-3 text-right font-mono">{(inv.unit_price || 0).toFixed(3)}</td>
                    <td className="px-4 py-3 text-right font-mono">{inv.opening_stock}</td>
                    <td className="px-4 py-3 text-right font-mono text-red-600">{inv.total_dispatched}</td>
                    <td className={`px-4 py-3 text-right font-mono font-bold ${inv.remaining < 0 ? "text-red-600" : "text-green-600"}`}>
                      {inv.remaining}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ========== BRANCH SUMMARY TAB ========== */}
      {tab === "branch_summary" && (
        <div className="space-y-4">
          {branchSummary.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-400">{t("no_data")}</div>
          ) : branchSummary.map(bs => (
            <div key={bs.branch_id} className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <div className="px-5 py-4 bg-gray-50 border-b flex items-center justify-between">
                <h3 className="font-semibold text-gray-800">
                  {i18n.language === "ar" ? (bs.branch_name_ar || bs.branch_name) : bs.branch_name}
                </h3>
                <span className="text-sm font-bold text-emerald-700">
                  {t("total")}: KD {bs.total_amount.toFixed(3)}
                </span>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left">{t("item_name")}</th>
                    <th className="px-4 py-2 text-left">{t("unit")}</th>
                    <th className="px-4 py-2 text-right">{t("total_qty")}</th>
                    <th className="px-4 py-2 text-right">{t("total_amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {bs.items.map((item, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="px-4 py-2">
                        {i18n.language === "ar" ? (item.item_name_ar || item.item_name) : item.item_name}
                        {i18n.language !== "ar" && item.item_name_ar && <span className="text-xs text-gray-400 ml-1" dir="rtl">({item.item_name_ar})</span>}
                      </td>
                      <td className="px-4 py-2">{item.unit}</td>
                      <td className="px-4 py-2 text-right font-mono">{item.total_qty}</td>
                      <td className="px-4 py-2 text-right font-mono">KD {item.total_amount.toFixed(3)}</td>
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
                  <span className="flex-1 text-sm">
                    {lineName(line)}
                    {i18n.language === "ar" && line.item_name && <span className="text-xs text-gray-400 ml-1">({line.item_name})</span>}
                    {i18n.language !== "ar" && line.item_name_ar && <span className="text-xs text-gray-400 ml-1" dir="rtl">({line.item_name_ar})</span>}
                  </span>
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
