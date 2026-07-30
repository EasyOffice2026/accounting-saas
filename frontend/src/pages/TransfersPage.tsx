import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost, apiDownload, apiFetch } from "../contexts/api";
import { useAuth } from "../contexts/AuthContext";
import { useBrand } from "../contexts/BrandContext";

interface Branch { id: number; name: string; name_ar?: string; is_central_kitchen: boolean; brand_id?: number | null; }
interface TItem { id: number; name: string; name_ar: string; unit: string; unit_price: number; opening_stock: number; category: string; }
interface OrderLine {
  id: number; item_id: number; item_name: string; item_name_ar: string | null;
  requested_qty: number; dispatched_qty: number | null; received_qty: number | null; unit: string; unit_price: number;
}

interface TOrder {
  id: number; requesting_branch_id: number; branch_name: string;
  source_branch_id: number | null; source_branch_name: string;
  date: string; status: string; notes: string; lines: OrderLine[];
}

interface BranchConsumption {
  branch_id: number; branch_name: string; branch_name_ar: string;
  items: { item_name: string; item_name_ar: string | null; unit: string; total_qty: number; total_amount: number }[];
  total_amount: number;
}

type Tab = "items" | "requests" | "history" | "consumption";

export default function TransfersPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { brands, selectedBrand } = useBrand();
  const [fromBrandId, setFromBrandId] = useState<number | "">("");
  const [toBrandId, setToBrandId] = useState<number | "">("");
  const [tab, setTab] = useState<Tab>("requests");
  const [items, setItems] = useState<TItem[]>([]);
  const [orders, setOrders] = useState<TOrder[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState<TOrder | null>(null);
  const [submitting, setSubmitting] = useState(false);
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

  // Branch consumption
  const [expandedOrders, setExpandedOrders] = useState<Record<number, boolean>>({});
  const [consumption, setConsumption] = useState<BranchConsumption[]>([]);
  const [conStartDate, setConStartDate] = useState("");
  const [conEndDate, setConEndDate] = useState("");
  const [conBranchFilter, setConBranchFilter] = useState<string>("all");
  const [conGroupView, setConGroupView] = useState(false);
  const [conExpanded, setConExpanded] = useState<Record<string, boolean>>({});



  const isOwnerManager = user?.role === "owner" || user?.role === "manager" || user?.role === "accountant";
  const isCentralKitchen = branches.find(b => b.id === user?.branch_id)?.is_central_kitchen || false;
  // Branches for each brand selector (branches with no brand, e.g. Central Kitchen, are always shown)
  const fromBranches = branches.filter(b => !fromBrandId || b.brand_id === Number(fromBrandId) || b.brand_id == null);
  const toBranches = branches.filter(b => !toBrandId || b.brand_id === Number(toBrandId) || b.brand_id == null);

  useEffect(() => {
    apiGet("/api/transfers/items").then(setItems);
    apiGet("/api/transfers/orders").then(setOrders);
    apiGet("/api/branches/?all_brands=1").then(setBranches);
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
    if (submitting) return;
    if (!window.confirm(t("confirm_submit_request"))) return;
    const fd = new FormData(e.currentTarget);
    fd.append("items", JSON.stringify(selectedItems));
    if (user?.branch_id) fd.set("requesting_branch_id", String(user.branch_id));
    setSubmitting(true);
    try {
      if (editingOrder) {
        await apiFetch(`/api/transfers/orders/${editingOrder.id}`, { method: "PUT", body: fd });
      } else {
        await apiPost("/api/transfers/orders", fd);
      }
      setShowForm(false);
      setEditingOrder(null);
      setCheckedItems({});
      reload();
    } finally {
      setSubmitting(false);
    }
  };

  const openEditOrder = (order: TOrder) => {
    setEditingOrder(order);
    setFromBrandId(branches.find(b => b.id === order.source_branch_id)?.brand_id ?? "");
    setToBrandId(branches.find(b => b.id === order.requesting_branch_id)?.brand_id ?? "");
    const checked: Record<number, string> = {};
    order.lines.forEach(l => { checked[l.item_id] = String(l.requested_qty); });
    setCheckedItems(checked);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDeleteOrder = async (orderId: number) => {
    if (!window.confirm(t("confirm_delete"))) return;
    await apiFetch(`/api/transfers/orders/${orderId}`, { method: "DELETE" });
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
    if (submitting) return;
    const fd = new FormData();
    const lines = actionQtys.map(a => ({
      line_id: a.line_id,
      [actionType === "dispatch" ? "dispatched_qty" : "received_qty"]: a.qty,
    }));
    fd.append("lines", JSON.stringify(lines));
    setSubmitting(true);
    try {
      await fetch(`/api/transfers/orders/${actionOrder.id}/${actionType}`, {
        method: "POST", body: fd,
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      setActionOrder(null);
      reload();
    } finally {
      setSubmitting(false);
    }
  };

  const pendingOrders = orders.filter(o => o.status !== "received");
  const historyOrders = orders.filter(o => o.status === "received");

  const lineName = (line: OrderLine) => i18n.language === "ar" && line.item_name_ar ? line.item_name_ar : line.item_name;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-gray-800">{t("internal_transfer")}</h2>
        {tab === "requests" && (
          <button onClick={() => { const opening = !showForm; setShowForm(!showForm); if (showForm) { setCheckedItems({}); setEditingOrder(null); } else if (opening) { setFromBrandId(selectedBrand?.id ?? ""); setToBrandId(selectedBrand?.id ?? ""); } }}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm">
            {showForm ? t("cancel") : t("new_request")}
          </button>
        )}
        {tab === "items" && (
          <div className="flex gap-2">
            <button onClick={() => apiDownload(`/api/export/transfer-items/excel?category=${itemCategory}`, `transfer_items_${itemCategory}.xlsx`)}
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">
              {t("export_excel")}
            </button>
            <button onClick={() => apiDownload(`/api/export/transfer-items/pdf?category=${itemCategory}`, `transfer_items_${itemCategory}.pdf`)}
              className="px-3 py-1.5 bg-red-600 text-white rounded text-xs hover:bg-red-700">
              {t("export_pdf")}
            </button>
            {isOwnerManager && (
              <button onClick={() => { setShowItemForm(!showItemForm); setEditItem(null); }}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm">
                {showItemForm ? t("cancel") : t("add_item")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit flex-wrap">
        {(["requests", "items", "history", "consumption"] as Tab[]).map(tb => (
          <button key={tb} onClick={() => {
            setTab(tb);
            if (tb === "consumption") {
              const params = new URLSearchParams();
              if (conStartDate) params.set("start_date", conStartDate);
              if (conEndDate) params.set("end_date", conEndDate);
              apiGet(`/api/transfers/branch-summary?${params}`).then(setConsumption);
            }
          }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              tab === tb ? "bg-white shadow text-emerald-700" : "text-gray-500 hover:text-gray-700"
            }`}>
            {tb === "requests" ? t("requests") : tb === "items" ? t("item_list") : tb === "history" ? t("history") : t("branch_consumption")}
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

              </div>
              <button type="submit" className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
                {t("save")}
              </button>
            </form>
          )}
          <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
            <table data-resp className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left">{t("item_name")}</th>
                  <th className="px-4 py-3 text-left">{t("item_name_ar")}</th>
                  <th className="px-4 py-3 text-left">{t("unit")}</th>
                  <th className="px-4 py-3 text-right">{t("unit_price")}</th>
                  {isOwnerManager && <th className="px-4 py-3 text-center">{t("actions")}</th>}
                </tr>
              </thead>
              <tbody>
                {items.filter(i => (i.category || "food") === itemCategory).length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
                ) : items.filter(i => (i.category || "food") === itemCategory).map(item => (
                  <tr key={item.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{item.name}</td>
                    <td className="px-4 py-3" dir="rtl">{item.name_ar || "—"}</td>
                    <td className="px-4 py-3">{item.unit}</td>
                    <td className="px-4 py-3 text-right font-mono">{(item.unit_price || 0).toFixed(3)}</td>
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
            <form key={editingOrder?.id ?? "new"} onSubmit={handleRequestSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-4 space-y-4">
              <h3 className="font-semibold">{editingOrder ? `${t("edit")} #${editingOrder.id}` : t("new_request")}</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t("from_brand")}</label>
                  <select value={fromBrandId}
                    onChange={e => setFromBrandId(e.target.value ? Number(e.target.value) : "")}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="">{t("all_brands")}</option>
                    {brands.map(br =>
                      <option key={br.id} value={br.id}>
                        {i18n.language === "ar" && br.name_ar ? br.name_ar : br.name_en}
                      </option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("source_branch")}</label>
                  <select key={`src-${fromBrandId}`} name="source_branch_id" required
                    defaultValue={editingOrder ? (editingOrder.source_branch_id ?? "") : (fromBranches.find(b => b.is_central_kitchen)?.id || "")}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="">{t("select")}</option>
                    {fromBranches.map(b =>
                      <option key={b.id} value={b.id}>
                        {(i18n.language === "ar" && b.name_ar ? b.name_ar : b.name)}{b.is_central_kitchen ? ` (${t("central_kitchen")})` : ""}
                      </option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("date")}</label>
                  <input type="date" name="order_date" required defaultValue={editingOrder ? editingOrder.date : new Date().toISOString().slice(0, 10)}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>

              {user?.branch_id ? (
                <input type="hidden" name="requesting_branch_id" value={user.branch_id} />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">{t("to_brand")}</label>
                    <select value={toBrandId}
                      onChange={e => setToBrandId(e.target.value ? Number(e.target.value) : "")}
                      className="w-full px-3 py-2 border rounded-lg text-sm">
                      <option value="">{t("all_brands")}</option>
                      {brands.map(br =>
                        <option key={br.id} value={br.id}>
                          {i18n.language === "ar" && br.name_ar ? br.name_ar : br.name_en}
                        </option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">{t("destination_branch")}</label>
                    <select key={`dst-${toBrandId}`} name="requesting_branch_id" required
                      defaultValue={editingOrder ? editingOrder.requesting_branch_id : ""}
                      className="w-full px-3 py-2 border rounded-lg text-sm">
                      <option value="">{t("select")}</option>
                      {toBranches.map(b =>
                        <option key={b.id} value={b.id}>
                          {(i18n.language === "ar" && b.name_ar ? b.name_ar : b.name)}{b.is_central_kitchen ? ` (${t("central_kitchen")})` : ""}
                        </option>
                      )}
                    </select>
                  </div>
                </div>
              )}

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
                <div className="flex items-center gap-3 px-4 py-2 bg-gray-100 border border-b-0 rounded-t-lg text-xs font-semibold text-gray-600">
                  <span className="w-4"></span>
                  <span className="flex-1">{t("item_name")}</span>
                  <span className="w-12">{t("unit")}</span>
                  <span className="w-16 text-right">{t("unit_price")}</span>
                  <span className="w-20 text-center">{t("requested")}</span>
                  <span className="w-20 text-right">{t("total")}</span>
                </div>
                <div className="border rounded-b-lg divide-y max-h-80 overflow-y-auto">
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
                        <span className="text-xs text-gray-500 w-16 text-right">{(item.unit_price || 0).toFixed(3)}</span>
                        {isChecked ? (
                          <>
                            <input type="number" step="0.01" min="0.01"
                              value={checkedItems[item.id]}
                              onClick={e => e.stopPropagation()}
                              onChange={e => updateItemQty(item.id, e.target.value)}
                              className="w-20 px-2 py-1 border rounded text-sm text-center" />
                            <span className="text-xs font-semibold text-emerald-700 w-20 text-right">
                              {((item.unit_price || 0) * Number(checkedItems[item.id] || 0)).toFixed(3)}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="w-20 text-center text-gray-300">—</span>
                            <span className="w-20 text-right text-gray-300">—</span>
                          </>
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

              <button type="submit" disabled={submitting}
                className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                {submitting ? t("submitting") : (editingOrder ? t("save") : t("submit_request"))}
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
                    <span className="text-sm text-gray-600">
                      {order.source_branch_name ? `${order.source_branch_name} → ${order.branch_name}` : order.branch_name}
                    </span>
                    <span className="mx-2 text-gray-400">|</span>
                    <span className="text-sm text-gray-500">{order.date}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {user?.branch_id && (user.branch_id === order.source_branch_id || user.branch_id === order.requesting_branch_id) && (
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        user.branch_id === order.source_branch_id ? "bg-purple-100 text-purple-700" : "bg-teal-100 text-teal-700"
                      }`}>
                        {user.branch_id === order.source_branch_id ? `↑ ${t("outgoing")}` : `↓ ${t("incoming")}`}
                      </span>
                    )}
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      order.status === "requested" ? "bg-yellow-100 text-yellow-700" :
                      order.status === "dispatched" ? "bg-blue-100 text-blue-700" :
                      "bg-green-100 text-green-700"
                    }`}>
                      {order.status === "requested" ? t("pending_dispatch") :
                       order.status === "dispatched" ? t("sent_pending_receipt") : t(order.status)}
                    </span>
                    {order.status === "requested" && (
                      <>
                        <button onClick={() => openEditOrder(order)}
                          className="px-3 py-1 bg-amber-500 text-white rounded text-xs hover:bg-amber-600">
                          {t("edit")}
                        </button>
                        <button onClick={() => handleDeleteOrder(order.id)}
                          className="px-3 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">
                          {t("delete")}
                        </button>
                      </>
                    )}
                    {order.status === "requested" && (isOwnerManager || isCentralKitchen || user?.branch_id === order.source_branch_id) && (
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
                <table data-resp className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left">{t("item_name")}</th>
                      <th className="px-4 py-2 text-left">{t("unit")}</th>
                      <th className="px-4 py-2 text-right">{t("unit_price")}</th>
                      <th className="px-4 py-2 text-right">{t("requested")}</th>
                      <th className="px-4 py-2 text-right">{t("total_amount")}</th>
                      <th className="px-4 py-2 text-right">{t("dispatched")}</th>
                      <th className="px-4 py-2 text-right">{t("received")}</th>
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
                        <td className="px-4 py-2">{line.unit}</td>
                        <td className="px-4 py-2 text-right font-mono">{(line.unit_price || 0).toFixed(3)}</td>
                        <td className="px-4 py-2 text-right font-mono">{line.requested_qty}</td>
                        <td className="px-4 py-2 text-right font-mono font-semibold">{((line.unit_price || 0) * line.requested_qty).toFixed(3)}</td>
                        <td className="px-4 py-2 text-right font-mono">{line.dispatched_qty ?? "-"}</td>
                        <td className="px-4 py-2 text-right font-mono">{line.received_qty ?? "-"}</td>
                      </tr>
                    ))}
                    <tr className="border-t bg-gray-50 font-bold">
                      <td colSpan={4} className="px-4 py-2 text-right">{t("total")}</td>
                      <td className="px-4 py-2 text-right font-mono text-emerald-700">
                        {order.lines.reduce((sum, l) => sum + (l.unit_price || 0) * l.requested_qty, 0).toFixed(3)}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
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
              <div className="px-5 py-3 flex items-center justify-between bg-gray-50 border-b cursor-pointer hover:bg-gray-100"
                onClick={() => setExpandedOrders(prev => ({ ...prev, [order.id]: !prev[order.id] }))}>
                <div className="flex items-center">
                  <span className="mr-2 text-gray-400 text-xs">{expandedOrders[order.id] ? "▼" : "▶"}</span>
                  <span className="font-semibold text-gray-800">#{order.id}</span>
                  <span className="mx-2 text-gray-400">|</span>
                  <span className="text-sm text-gray-600">
                    {order.source_branch_name ? `${order.source_branch_name} → ${order.branch_name}` : order.branch_name}
                  </span>
                  <span className="mx-2 text-gray-400">|</span>
                  <span className="text-sm text-gray-500">{order.date}</span>
                  <span className="mx-2 text-gray-400">|</span>
                  <span className="text-sm font-semibold text-emerald-700">
                    {t("total")}: {order.lines.reduce((sum, l) => sum + (l.unit_price || 0) * l.requested_qty, 0).toFixed(3)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {user?.branch_id && (user.branch_id === order.source_branch_id || user.branch_id === order.requesting_branch_id) && (
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      user.branch_id === order.source_branch_id ? "bg-purple-100 text-purple-700" : "bg-teal-100 text-teal-700"
                    }`}>
                      {user.branch_id === order.source_branch_id ? `↑ ${t("outgoing")}` : `↓ ${t("incoming")}`}
                    </span>
                  )}
                  <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">{t("received")}</span>
                </div>
              </div>
              {expandedOrders[order.id] && (
              <table data-resp className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left">{t("item_name")}</th>
                    <th className="px-4 py-2 text-left">{t("unit")}</th>
                    <th className="px-4 py-2 text-right">{t("unit_price")}</th>
                    <th className="px-4 py-2 text-right">{t("requested")}</th>
                    <th className="px-4 py-2 text-right">{t("total_amount")}</th>
                    <th className="px-4 py-2 text-right">{t("dispatched")}</th>
                    <th className="px-4 py-2 text-right">{t("received")}</th>
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
                      <td className="px-4 py-2">{line.unit}</td>
                      <td className="px-4 py-2 text-right font-mono">{(line.unit_price || 0).toFixed(3)}</td>
                      <td className="px-4 py-2 text-right font-mono">{line.requested_qty}</td>
                      <td className="px-4 py-2 text-right font-mono font-semibold">{((line.unit_price || 0) * line.requested_qty).toFixed(3)}</td>
                      <td className="px-4 py-2 text-right font-mono">{line.dispatched_qty ?? "-"}</td>
                      <td className="px-4 py-2 text-right font-mono">{line.received_qty ?? "-"}</td>
                    </tr>
                  ))}
                  <tr className="border-t bg-gray-50 font-bold">
                    <td colSpan={4} className="px-4 py-2 text-right">{t("total")}</td>
                    <td className="px-4 py-2 text-right font-mono text-emerald-700">
                      {order.lines.reduce((sum, l) => sum + (l.unit_price || 0) * l.requested_qty, 0).toFixed(3)}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tbody>
              </table>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ========== BRANCH CONSUMPTION TAB ========== */}
      {tab === "consumption" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="flex items-end gap-3 flex-wrap">
              {isOwnerManager && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{t("branch")}</label>
                  <select value={conBranchFilter} onChange={e => setConBranchFilter(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm">
                    <option value="all">{t("all_branches")}</option>
                    {consumption.map(bc => (
                      <option key={bc.branch_id} value={bc.branch_id}>
                        {i18n.language === "ar" ? (bc.branch_name_ar || bc.branch_name) : bc.branch_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {isOwnerManager && (
                <label className="flex items-center gap-2 text-sm text-gray-700 pb-2 cursor-pointer">
                  <input type="checkbox" checked={conGroupView} onChange={e => setConGroupView(e.target.checked)}
                    className="w-4 h-4" />
                  {t("group_view")}
                </label>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t("start_date")}</label>
                <input type="date" value={conStartDate} onChange={e => setConStartDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t("end_date")}</label>
                <input type="date" value={conEndDate} onChange={e => setConEndDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm" />
              </div>
              <button onClick={() => {
                const params = new URLSearchParams();
                if (conStartDate) params.set("start_date", conStartDate);
                if (conEndDate) params.set("end_date", conEndDate);
                apiGet(`/api/transfers/branch-summary?${params}`).then(setConsumption);
              }} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700">
                {t("filter")}
              </button>
              <button onClick={() => {
                setConStartDate(""); setConEndDate("");
                apiGet("/api/transfers/branch-summary").then(setConsumption);
              }} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300">
                {t("clear")}
              </button>
            </div>
          </div>

          {(() => {
            const filtered = conBranchFilter === "all"
              ? consumption
              : consumption.filter(bc => bc.branch_id === Number(conBranchFilter));

            let cards: { key: string; title: string; title_ar: string; items: BranchConsumption["items"]; total_amount: number }[];
            if (conGroupView) {
              const map = new Map<string, BranchConsumption["items"][number]>();
              let total = 0;
              filtered.forEach(bc => bc.items.forEach(it => {
                const k = `${it.item_name}||${it.unit}`;
                const ex = map.get(k);
                if (ex) {
                  ex.total_qty += it.total_qty;
                  ex.total_amount = Math.round((ex.total_amount + it.total_amount) * 1000) / 1000;
                } else {
                  map.set(k, { ...it });
                }
                total += it.total_amount;
              }));
              cards = [{
                key: "group", title: t("group_view"), title_ar: t("group_view"),
                items: Array.from(map.values()),
                total_amount: Math.round(total * 1000) / 1000,
              }];
            } else {
              cards = filtered.map(bc => ({
                key: String(bc.branch_id),
                title: bc.branch_name, title_ar: bc.branch_name_ar || bc.branch_name,
                items: bc.items, total_amount: bc.total_amount,
              }));
            }

            if (cards.length === 0) {
              return <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-400">{t("no_data")}</div>;
            }

            return cards.map(card => {
              const isOpen = conExpanded[card.key];
              return (
                <div key={card.key} className="bg-white rounded-xl shadow-sm border overflow-hidden">
                  <div className="px-5 py-3 bg-gray-50 border-b flex items-center justify-between cursor-pointer hover:bg-gray-100"
                    onClick={() => setConExpanded(prev => ({ ...prev, [card.key]: !prev[card.key] }))}>
                    <span className="font-semibold text-gray-800 flex items-center">
                      <span className="mr-2 text-gray-400 text-xs">{isOpen ? "▼" : "▶"}</span>
                      {i18n.language === "ar" ? card.title_ar : card.title}
                      {i18n.language === "ar" && card.title && card.title !== card.title_ar && <span className="text-xs text-gray-400 ml-2">({card.title})</span>}
                      {i18n.language !== "ar" && card.title_ar && card.title_ar !== card.title && <span className="text-xs text-gray-400 ml-2" dir="rtl">({card.title_ar})</span>}
                    </span>
                    <span className="text-sm font-bold text-emerald-700">{t("grand_total")}: {card.total_amount.toFixed(3)}</span>
                  </div>
                  {isOpen && (
                  <table data-resp className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left">{t("item_name")}</th>
                        <th className="px-4 py-2 text-left">{t("unit")}</th>
                        <th className="px-4 py-2 text-right">{t("total_qty")}</th>
                        <th className="px-4 py-2 text-right">{t("unit_price")}</th>
                        <th className="px-4 py-2 text-right">{t("total_amount")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {card.items.map((item, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="px-4 py-2">
                            {i18n.language === "ar" ? (item.item_name_ar || item.item_name) : item.item_name}
                            {i18n.language === "ar" && item.item_name && <span className="text-xs text-gray-400 ml-1">({item.item_name})</span>}
                            {i18n.language !== "ar" && item.item_name_ar && <span className="text-xs text-gray-400 ml-1" dir="rtl">({item.item_name_ar})</span>}
                          </td>
                          <td className="px-4 py-2">{item.unit}</td>
                          <td className="px-4 py-2 text-right font-mono">{item.total_qty}</td>
                          <td className="px-4 py-2 text-right font-mono">{item.total_qty > 0 ? (item.total_amount / item.total_qty).toFixed(3) : "0.000"}</td>
                          <td className="px-4 py-2 text-right font-mono font-semibold">{item.total_amount.toFixed(3)}</td>
                        </tr>
                      ))}
                      <tr className="border-t bg-emerald-50 font-bold">
                        <td colSpan={4} className="px-4 py-2 text-right">{t("grand_total")}</td>
                        <td className="px-4 py-2 text-right font-mono text-emerald-700">{card.total_amount.toFixed(3)}</td>
                      </tr>
                    </tbody>
                  </table>
                  )}
                </div>
              );
            });
          })()}
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
              <button onClick={handleActionSubmit} disabled={submitting}
                className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                {submitting ? t("submitting") : (actionType === "dispatch" ? t("confirm_dispatch") : t("confirm_receive"))}
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
