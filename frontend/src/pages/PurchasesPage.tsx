import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../contexts/api";

interface Supplier { id: number; name: string; email: string; whatsapp: string; payment_type: string; }
interface SupplierItem { id: number; supplier_id: number; item_name: string; item_name_ar: string; packaging: string; unit: string; unit_price: number; }
interface OrderItem { item_name: string; quantity: number; unit: string; unit_price: number; total: number; }
interface PurchaseOrder {
  id: number; branch_id: number; supplier_id: number; date: string;
  payment_type: string; total_amount: number; status: string;
}
interface Branch { id: number; name: string; }

type Tab = "orders" | "catalog";

export default function PurchasesPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("orders");
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [items, setItems] = useState([{ item_name: "", quantity: "1", unit: "pcs", unit_price: "0", total: "0" }]);
  const [orderSupplierId, setOrderSupplierId] = useState<number | null>(null);

  // Catalog state
  const [catalogSupplierId, setCatalogSupplierId] = useState<number | null>(null);
  const [catalogItems, setCatalogItems] = useState<SupplierItem[]>([]);
  const [showItemForm, setShowItemForm] = useState(false);
  const [editingItem, setEditingItem] = useState<SupplierItem | null>(null);

  useEffect(() => {
    apiGet("/api/branches/").then(setBranches);
    apiGet("/api/purchases/suppliers").then(setSuppliers);
    apiGet("/api/purchases/orders").then(setOrders);
  }, []);

  // Load catalog items when supplier selected
  const loadCatalog = async (suppId: number) => {
    setCatalogSupplierId(suppId);
    const items: SupplierItem[] = await apiGet(`/api/purchases/suppliers/${suppId}/items`);
    setCatalogItems(items);
  };

  useEffect(() => {
    if (catalogSupplierId) loadCatalog(catalogSupplierId);
  }, []);

  // Load supplier items when creating order
  const loadSupplierItemsForOrder = async (suppId: number) => {
    setOrderSupplierId(suppId);
    const catItems: SupplierItem[] = await apiGet(`/api/purchases/suppliers/${suppId}/items`);
    if (catItems.length > 0) {
      setItems(catItems.map(ci => ({
        item_name: ci.item_name,
        quantity: "1",
        unit: ci.unit,
        unit_price: ci.unit_price.toFixed(3),
        total: ci.unit_price.toFixed(3),
      })));
    } else {
      setItems([{ item_name: "", quantity: "1", unit: "pcs", unit_price: "0", total: "0" }]);
    }
  };

  const addItem = () => setItems([...items, { item_name: "", quantity: "1", unit: "pcs", unit_price: "0", total: "0" }]);

  const updateItem = (i: number, field: string, val: string) => {
    const updated = [...items];
    (updated[i] as Record<string, string>)[field] = val;
    if (field === "quantity" || field === "unit_price") {
      updated[i].total = (parseFloat(updated[i].quantity || "0") * parseFloat(updated[i].unit_price || "0")).toFixed(3);
    }
    setItems(updated);
  };

  const removeItem = (i: number) => {
    if (items.length > 1) setItems(items.filter((_, idx) => idx !== i));
  };

  const handleOrderSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("items", JSON.stringify(items));
    await apiPost("/api/purchases/orders", fd);
    setShowOrderForm(false);
    setItems([{ item_name: "", quantity: "1", unit: "pcs", unit_price: "0", total: "0" }]);
    apiGet("/api/purchases/orders").then(setOrders);
  };

  const handleSupplierSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await apiPost("/api/purchases/suppliers", fd);
    setShowSupplierForm(false);
    apiGet("/api/purchases/suppliers").then(setSuppliers);
  };

  const handleCatalogItemSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!catalogSupplierId) return;
    const fd = new FormData(e.currentTarget);
    if (editingItem) {
      await fetch(`/api/purchases/suppliers/items/${editingItem.id}`, {
        method: "PUT", body: fd,
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
    } else {
      await apiPost(`/api/purchases/suppliers/${catalogSupplierId}/items`, fd);
    }
    setShowItemForm(false);
    setEditingItem(null);
    loadCatalog(catalogSupplierId);
  };

  const deleteCatalogItem = async (itemId: number) => {
    if (!confirm(t("confirm_delete"))) return;
    await fetch(`/api/purchases/suppliers/items/${itemId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    if (catalogSupplierId) loadCatalog(catalogSupplierId);
  };

  const supplierName = (id: number) => suppliers.find(s => s.id === id)?.name || "";
  const branchName = (id: number) => branches.find(b => b.id === id)?.name || "";
  const getSupplier = (id: number) => suppliers.find(s => s.id === id);

  const buildOrderMessage = (order: PurchaseOrder, orderItems: OrderItem[]) => {
    const supplier = getSupplier(order.supplier_id);
    const branch = branchName(order.branch_id);
    let msg = `*Purchase Order #${order.id}*\n`;
    msg += `Date: ${order.date}\n`;
    msg += `Branch: ${branch}\n`;
    msg += `Supplier: ${supplier?.name || ""}\n`;
    msg += `Payment: ${order.payment_type}\n\n`;
    msg += `*Items:*\n`;
    orderItems.forEach((item, i) => {
      msg += `${i + 1}. ${item.item_name} - ${item.quantity} ${item.unit} x KD ${item.unit_price.toFixed(3)} = KD ${item.total.toFixed(3)}\n`;
    });
    msg += `\n*Total: KD ${order.total_amount.toFixed(3)}*`;
    return msg;
  };

  const sendWhatsApp = async (order: PurchaseOrder) => {
    const supplier = getSupplier(order.supplier_id);
    if (!supplier?.whatsapp) { alert(t("no_whatsapp")); return; }
    const orderItems: OrderItem[] = await apiGet(`/api/purchases/orders/${order.id}/items`);
    const msg = buildOrderMessage(order, orderItems);
    const phone = supplier.whatsapp.replace(/[^0-9]/g, "");
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const [sendingEmail, setSendingEmail] = useState<number | null>(null);

  const sendEmail = async (order: PurchaseOrder) => {
    const supplier = getSupplier(order.supplier_id);
    if (!supplier?.email) { alert(t("no_email")); return; }
    setSendingEmail(order.id);
    try {
      const res = await fetch(`/api/email/send-po/${order.id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed");
      alert(data.message);
    } catch (e: unknown) {
      const err = e as Error;
      alert(err.message || t("email_send_error"));
    }
    setSendingEmail(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-gray-800">{t("purchases")}</h2>
        <div className="flex gap-2">
          <button onClick={() => window.open("/api/export/purchases/csv", "_blank")}
            className="px-3 py-1.5 bg-green-600 text-white rounded text-xs hover:bg-green-700">
            {t("export_csv")}
          </button>
          <button onClick={() => setShowSupplierForm(!showSupplierForm)}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm">
            + {t("supplier")}
          </button>
          {tab === "orders" && (
            <button onClick={() => setShowOrderForm(!showOrderForm)}
              className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm">
              {showOrderForm ? t("cancel") : t("add_new")}
            </button>
          )}
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg w-fit">
        <button onClick={() => setTab("orders")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition ${
            tab === "orders" ? "bg-white shadow text-emerald-700" : "text-gray-500 hover:text-gray-700"}`}>
          {t("purchase_orders")}
        </button>
        <button onClick={() => setTab("catalog")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition ${
            tab === "catalog" ? "bg-white shadow text-emerald-700" : "text-gray-500 hover:text-gray-700"}`}>
          {t("supplier_catalog")}
        </button>
      </div>

      {showSupplierForm && (
        <form onSubmit={handleSupplierSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-6 space-y-3">
          <h3 className="font-semibold">{t("add_new")} {t("supplier")}</h3>
          <div className="grid grid-cols-2 gap-3">
            <input name="name" placeholder={t("name")} required className="px-3 py-2 border rounded-lg text-sm" />
            <input name="email" placeholder={t("email")} className="px-3 py-2 border rounded-lg text-sm" />
            <input name="whatsapp" placeholder={t("whatsapp")} className="px-3 py-2 border rounded-lg text-sm" />
            <select name="payment_type" className="px-3 py-2 border rounded-lg text-sm">
              <option value="cash">{t("cash")}</option>
              <option value="credit">{t("credit")}</option>
            </select>
          </div>
          <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">{t("save")}</button>
        </form>
      )}

      {/* ========== ORDERS TAB ========== */}
      {tab === "orders" && (
        <>
          {showOrderForm && (
            <form onSubmit={handleOrderSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t("branch")}</label>
                  <select name="branch_id" required className="w-full px-3 py-2 border rounded-lg text-sm">
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("supplier")}</label>
                  <select name="supplier_id" required className="w-full px-3 py-2 border rounded-lg text-sm"
                    onChange={e => loadSupplierItemsForOrder(Number(e.target.value))}>
                    <option value="">{t("select_supplier")}</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  {orderSupplierId && (
                    <p className="text-xs text-emerald-600 mt-1">{t("catalog_loaded")}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("date")}</label>
                  <input type="date" name="order_date" required className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("payment_type")}</label>
                  <select name="payment_type" className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="cash">{t("cash")}</option>
                    <option value="credit">{t("credit")}</option>
                  </select>
                </div>
              </div>

              <h3 className="font-semibold">{t("items")}</h3>
              <div className="space-y-2">
                {items.map((item, i) => (
                  <div key={i} className="grid grid-cols-6 gap-2 items-center">
                    <input placeholder={t("item_name")} value={item.item_name}
                      onChange={e => updateItem(i, "item_name", e.target.value)}
                      className="px-2 py-1.5 border rounded text-sm" required />
                    <input type="number" step="0.01" placeholder={t("quantity")} value={item.quantity}
                      onChange={e => updateItem(i, "quantity", e.target.value)}
                      className="px-2 py-1.5 border rounded text-sm" />
                    <input placeholder={t("unit")} value={item.unit}
                      onChange={e => updateItem(i, "unit", e.target.value)}
                      className="px-2 py-1.5 border rounded text-sm" />
                    <input type="number" step="0.001" placeholder={t("unit_price")} value={item.unit_price}
                      onChange={e => updateItem(i, "unit_price", e.target.value)}
                      className="px-2 py-1.5 border rounded text-sm" />
                    <input readOnly value={item.total} className="px-2 py-1.5 border rounded text-sm bg-gray-50" />
                    <button type="button" onClick={() => removeItem(i)}
                      className="text-red-500 hover:text-red-700 text-sm">✕</button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <button type="button" onClick={addItem} className="text-sm text-emerald-600 hover:underline">
                  + {t("add_new")} {t("items")}
                </button>
                <span className="text-sm font-semibold">
                  {t("total")}: KD {items.reduce((s, it) => s + parseFloat(it.total || "0"), 0).toFixed(3)}
                </span>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">{t("attachment")}</label>
                <div className="flex gap-2">
                  <input type="file" name="attachment" accept="image/*,.pdf" className="text-sm" />
                  <button type="button" onClick={() => {
                    const inp = document.createElement("input");
                    inp.type = "file"; inp.accept = "image/*"; inp.capture = "environment";
                    inp.onchange = () => {
                      const f = inp.files?.[0];
                      if (f) {
                        const dt = new DataTransfer(); dt.items.add(f);
                        const target = document.querySelector('input[name="attachment"]') as HTMLInputElement;
                        if (target) target.files = dt.files;
                      }
                    };
                    inp.click();
                  }} className="px-3 py-1.5 bg-blue-500 text-white rounded text-xs hover:bg-blue-600 whitespace-nowrap">
                    {t("take_picture")}
                  </button>
                </div>
              </div>
              <button type="submit"
                className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm">
                {t("save")}
              </button>
            </form>
          )}

          <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">{t("date")}</th>
                  <th className="px-4 py-3 text-left">{t("branch")}</th>
                  <th className="px-4 py-3 text-left">{t("supplier")}</th>
                  <th className="px-4 py-3 text-left">{t("payment_type")}</th>
                  <th className="px-4 py-3 text-right">{t("total")}</th>
                  <th className="px-4 py-3 text-left">{t("status")}</th>
                  <th className="px-4 py-3 text-center">{t("send_order")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
                ) : orders.map(o => (
                  <tr key={o.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3">{o.id}</td>
                    <td className="px-4 py-3">{o.date}</td>
                    <td className="px-4 py-3">{branchName(o.branch_id)}</td>
                    <td className="px-4 py-3">{supplierName(o.supplier_id)}</td>
                    <td className="px-4 py-3">{t(o.payment_type)}</td>
                    <td className="px-4 py-3 text-right font-mono">KD {o.total_amount.toFixed(3)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        o.status === "received" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                      }`}>{t(o.status)}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex gap-1 justify-center">
                        <button onClick={() => sendWhatsApp(o)} title={t("send_whatsapp")}
                          className="px-2 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600">
                          {t("whatsapp")}
                        </button>
                        <button onClick={() => sendEmail(o)} title={t("send_email")}
                          disabled={sendingEmail === o.id}
                          className="px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600 disabled:opacity-50">
                          {sendingEmail === o.id ? "..." : t("email")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ========== SUPPLIER CATALOG TAB ========== */}
      {tab === "catalog" && (
        <div>
          <div className="bg-white p-4 rounded-xl shadow-sm border mb-4">
            <label className="block text-sm font-medium mb-2">{t("select_supplier")}</label>
            <select value={catalogSupplierId || ""} onChange={e => loadCatalog(Number(e.target.value))}
              className="w-full max-w-sm px-3 py-2 border rounded-lg text-sm">
              <option value="">{t("select_supplier")}</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {catalogSupplierId && (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">
                  {supplierName(catalogSupplierId)} — {t("item_catalog")}
                  <span className="text-sm text-gray-400 ml-2">({catalogItems.length} {t("items")})</span>
                </h3>
                <button onClick={() => { setEditingItem(null); setShowItemForm(true); }}
                  className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
                  + {t("add_item")}
                </button>
              </div>

              {showItemForm && (
                <form onSubmit={handleCatalogItemSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-4 space-y-3">
                  <h3 className="font-semibold">{editingItem ? t("edit_item") : t("add_item")}</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1">{t("item_name")}</label>
                      <input name="item_name" defaultValue={editingItem?.item_name || ""} required
                        className="w-full px-3 py-2 border rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">{t("item_name_ar")}</label>
                      <input name="item_name_ar" defaultValue={editingItem?.item_name_ar || ""}
                        className="w-full px-3 py-2 border rounded-lg text-sm" dir="rtl" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">{t("packaging")}</label>
                      <input name="packaging" defaultValue={editingItem?.packaging || ""}
                        placeholder="e.g. 6x1.5L, Box of 24"
                        className="w-full px-3 py-2 border rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">{t("unit")}</label>
                      <select name="unit" defaultValue={editingItem?.unit || "pcs"}
                        className="w-full px-3 py-2 border rounded-lg text-sm">
                        {["pcs", "kg", "g", "liter", "ml", "box", "carton", "pack", "bag", "bottle", "can", "tray"].map(u => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">{t("unit_price")} (KD)</label>
                      <input name="unit_price" type="number" step="0.001"
                        defaultValue={editingItem?.unit_price || 0}
                        className="w-full px-3 py-2 border rounded-lg text-sm" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm">{t("save")}</button>
                    <button type="button" onClick={() => { setShowItemForm(false); setEditingItem(null); }}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm">{t("cancel")}</button>
                  </div>
                </form>
              )}

              <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left">#</th>
                      <th className="px-4 py-3 text-left">{t("item_name")}</th>
                      <th className="px-4 py-3 text-left">{t("item_name_ar")}</th>
                      <th className="px-4 py-3 text-left">{t("packaging")}</th>
                      <th className="px-4 py-3 text-left">{t("unit")}</th>
                      <th className="px-4 py-3 text-right">{t("unit_price")} (KD)</th>
                      <th className="px-4 py-3 text-center">{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalogItems.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">{t("no_items_catalog")}</td></tr>
                    ) : catalogItems.map((ci, idx) => (
                      <tr key={ci.id} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-3">{idx + 1}</td>
                        <td className="px-4 py-3 font-medium">{ci.item_name}</td>
                        <td className="px-4 py-3 text-gray-500" dir="rtl">{ci.item_name_ar || "—"}</td>
                        <td className="px-4 py-3">{ci.packaging || "—"}</td>
                        <td className="px-4 py-3">{ci.unit}</td>
                        <td className="px-4 py-3 text-right font-mono">{ci.unit_price.toFixed(3)}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex gap-1 justify-center">
                            <button onClick={() => { setEditingItem(ci); setShowItemForm(true); }}
                              className="px-2 py-1 bg-amber-500 text-white rounded text-xs hover:bg-amber-600">
                              {t("edit")}
                            </button>
                            <button onClick={() => deleteCatalogItem(ci.id)}
                              className="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">
                              {t("delete")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
