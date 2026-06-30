import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost, apiDownload } from "../contexts/api";
import { useAuth } from "../contexts/AuthContext";

interface PurchaseCategoryI { id: number; name: string; name_ar: string | null; is_active: boolean; }
interface Supplier { id: number; name: string; email: string; whatsapp: string; whatsapp_group?: string; payment_type: string; category_id?: number | null; }
interface SupplierItemI { id: number; supplier_id: number; category_id: number | null; item_name: string; item_name_ar: string; packaging: string; unit: string; unit_price: number; }
interface OrderItem { item_name: string; quantity: number; unit: string; unit_price: number; total: number; }
interface PurchaseOrder {
  id: number; branch_id: number; supplier_id: number; category_id: number | null; date: string;
  payment_type: string; total_amount: number; status: string; delivery_location: string | null;
}
interface Branch { id: number; name: string; name_ar?: string; }
interface InvoiceI {
  id: number; purchase_order_id: number; supplier_id: number; supplier_name: string;
  branch_id: number; branch_name: string; invoice_number: string; date: string;
  total_amount: number; status: string; paid_amount: number; paid_date: string | null; notes: string;
}
interface LedgerEntry {
  supplier_id: number; supplier_name: string;
  total_invoiced: number; total_paid: number; total_pending: number;
  pending_count: number; paid_count: number;
  invoices: { id: number; po_id: number; date: string; total_amount: number; status: string; paid_amount: number; paid_date: string | null }[];
}

type Tab = "orders" | "catalog" | "categories" | "invoices" | "ledger";

export default function PurchasesPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("orders");
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [items, setItems] = useState([{ item_name: "", quantity: "1", unit: "pcs", unit_price: "0", total: "0" }]);
  const [orderSupplierId, setOrderSupplierId] = useState<number | null>(null);
  const [orderCatalogItems, setOrderCatalogItems] = useState<SupplierItemI[]>([]);

  // Catalog state
  const [catalogSupplierId, setCatalogSupplierId] = useState<number | null>(null);
  const [catalogItems, setCatalogItems] = useState<SupplierItemI[]>([]);
  const [showItemForm, setShowItemForm] = useState(false);
  const [editingItem, setEditingItem] = useState<SupplierItemI | null>(null);

  // Receiving state
  const [receivingOrder, setReceivingOrder] = useState<PurchaseOrder | null>(null);
  const [recvItems, setRecvItems] = useState<{ item_name: string; ordered_qty: string; received_qty: string; unit: string; unit_price: string }[]>([]);

  // Invoice state
  const [invoices, setInvoices] = useState<InvoiceI[]>([]);
  const [payingInvoice, setPayingInvoice] = useState<InvoiceI | null>(null);
  const [invoiceSupplierFilter, setInvoiceSupplierFilter] = useState<number | null>(null);

  // Ledger state
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [expandedSupplier, setExpandedSupplier] = useState<number | null>(null);
  const [payOnlineLoading, setPayOnlineLoading] = useState<number | null>(null);

  // Category state
  const [categories, setCategories] = useState<PurchaseCategoryI[]>([]);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<PurchaseCategoryI | null>(null);
  const [catMsg, setCatMsg] = useState("");
  const [catMsgType, setCatMsgType] = useState<"success" | "error">("success");

  const isManager = user?.role === "owner" || user?.role === "manager";

  useEffect(() => {
    apiGet("/api/branches/").then(setBranches);
    apiGet("/api/purchases/suppliers").then(setSuppliers);
    apiGet("/api/purchases/orders").then(setOrders);
    apiGet("/api/purchases/categories").then(setCategories);
  }, []);

  useEffect(() => {
    if (tab === "invoices") apiGet("/api/purchases/invoices").then(setInvoices);
    if (tab === "ledger") apiGet("/api/purchases/supplier-ledger").then(setLedger);
    if (tab === "categories") apiGet("/api/purchases/categories").then(setCategories);
  }, [tab]);

  const categoryName = (id: number | null) => {
    if (!id) return "—";
    const cat = categories.find(c => c.id === id);
    return cat?.name || "—";
  };

  const handleCategorySubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      if (editingCategory) {
        const res = await fetch(`/api/purchases/categories/${editingCategory.id}`, {
          method: "PUT", body: fd,
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        });
        if (!res.ok) { const d = await res.json(); throw new Error(d.detail || "Error"); }
      } else {
        const res = await fetch("/api/purchases/categories", {
          method: "POST", body: fd,
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        });
        if (!res.ok) { const d = await res.json(); throw new Error(d.detail || "Error"); }
      }
      setCatMsg(t("saved")); setCatMsgType("success");
      setShowCategoryForm(false); setEditingCategory(null);
      apiGet("/api/purchases/categories").then(setCategories);
    } catch (err: unknown) {
      setCatMsg((err as Error).message); setCatMsgType("error");
    }
    setTimeout(() => setCatMsg(""), 4000);
  };

  const deleteCategory = async (catId: number) => {
    if (!confirm(t("confirm_delete"))) return;
    await fetch(`/api/purchases/categories/${catId}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    apiGet("/api/purchases/categories").then(setCategories);
  };

  const loadCatalog = async (suppId: number) => {
    setCatalogSupplierId(suppId);
    const res: SupplierItemI[] = await apiGet(`/api/purchases/suppliers/${suppId}/items`);
    setCatalogItems(res);
  };

  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<number>>(new Set());
  const [catalogQuantities, setCatalogQuantities] = useState<Record<number, string>>({});

  const loadSupplierItemsForOrder = async (suppId: number) => {
    setOrderSupplierId(suppId);
    const catItems: SupplierItemI[] = await apiGet(`/api/purchases/suppliers/${suppId}/items`);
    setOrderCatalogItems(catItems);
    setSelectedCatalogIds(new Set());
    setCatalogQuantities({});
    setItems([]);
  };

  const toggleCatalogItem = (ci: SupplierItemI) => {
    const newSet = new Set(selectedCatalogIds);
    const newQty = { ...catalogQuantities };
    if (newSet.has(ci.id)) {
      newSet.delete(ci.id);
      delete newQty[ci.id];
    } else {
      newSet.add(ci.id);
      newQty[ci.id] = "1";
    }
    setSelectedCatalogIds(newSet);
    setCatalogQuantities(newQty);
    // Sync items array for form submission
    const selected = orderCatalogItems.filter(c => newSet.has(c.id));
    setItems(selected.map(c => ({
      item_name: c.item_name,
      quantity: newQty[c.id] || "1",
      unit: c.unit,
      unit_price: c.unit_price.toFixed(3),
      total: (parseFloat(newQty[c.id] || "1") * c.unit_price).toFixed(3),
    })));
  };

  const updateCatalogQty = (ciId: number, qty: string) => {
    const newQty = { ...catalogQuantities, [ciId]: qty };
    setCatalogQuantities(newQty);
    const selected = orderCatalogItems.filter(c => selectedCatalogIds.has(c.id));
    setItems(selected.map(c => ({
      item_name: c.item_name,
      quantity: newQty[c.id] || "1",
      unit: c.unit,
      unit_price: c.unit_price.toFixed(3),
      total: (parseFloat(newQty[c.id] || "1") * c.unit_price).toFixed(3),
    })));
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

  const removeItem = (i: number) => { if (items.length > 1) setItems(items.filter((_, idx) => idx !== i)); };

  const handleOrderSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("items", JSON.stringify(items));
    if (user?.branch_id) fd.set("branch_id", String(user.branch_id));
    // Auto-set category from supplier
    if (orderSupplierId) {
      const sup = suppliers.find(s => s.id === orderSupplierId);
      if (sup?.category_id) fd.set("category_id", String(sup.category_id));
    }
    if (editingOrder) {
      await fetch(`/api/purchases/orders/${editingOrder.id}`, {
        method: "PUT", body: fd,
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
    } else {
      await apiPost("/api/purchases/orders", fd);
    }
    setShowOrderForm(false);
    setEditingOrder(null);
    setItems([{ item_name: "", quantity: "1", unit: "pcs", unit_price: "0", total: "0" }]);
    setOrderSupplierId(null);
    setOrderCatalogItems([]);
    setSelectedCatalogIds(new Set());
    setCatalogQuantities({});
    apiGet("/api/purchases/orders").then(setOrders);
  };

  const startEditOrder = async (order: PurchaseOrder) => {
    setEditingOrder(order);
    setShowOrderForm(true);
    // Load order items
    const orderItems: OrderItem[] = await apiGet(`/api/purchases/orders/${order.id}/items`);
    setItems(orderItems.map(i => ({
      item_name: i.item_name,
      quantity: String(i.quantity),
      unit: i.unit,
      unit_price: String(i.unit_price),
      total: String(i.total),
    })));
    // Load supplier catalog
    await loadSupplierItemsForOrder(order.supplier_id);
    // Pre-select items that match
    const catItems: SupplierItemI[] = await apiGet(`/api/purchases/suppliers/${order.supplier_id}/items`);
    const matchedIds = new Set<number>();
    const quantities: Record<number, string> = {};
    orderItems.forEach(oi => {
      const match = catItems.find(c => c.item_name === oi.item_name);
      if (match) {
        matchedIds.add(match.id);
        quantities[match.id] = String(oi.quantity);
      }
    });
    setSelectedCatalogIds(matchedIds);
    setCatalogQuantities(quantities);
  };

  const deleteOrder = async (orderId: number) => {
    if (!confirm(t("confirm_delete"))) return;
    await fetch(`/api/purchases/orders/${orderId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    apiGet("/api/purchases/orders").then(setOrders);
  };

  const handleSupplierSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (editingSupplier) {
      await fetch(`/api/purchases/suppliers/${editingSupplier.id}`, {
        method: "PUT", body: fd,
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
    } else {
      await apiPost("/api/purchases/suppliers", fd);
    }
    setShowSupplierForm(false);
    setEditingSupplier(null);
    apiGet("/api/purchases/suppliers").then(setSuppliers);
  };

  const deleteSupplier = async (suppId: number) => {
    if (!confirm(t("confirm_delete"))) return;
    await fetch(`/api/purchases/suppliers/${suppId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    apiGet("/api/purchases/suppliers").then(setSuppliers);
    if (catalogSupplierId === suppId) { setCatalogSupplierId(null); setCatalogItems([]); }
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
    setShowItemForm(false); setEditingItem(null);
    loadCatalog(catalogSupplierId);
  };

  const deleteCatalogItem = async (itemId: number) => {
    if (!confirm(t("confirm_delete"))) return;
    await fetch(`/api/purchases/suppliers/items/${itemId}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    if (catalogSupplierId) loadCatalog(catalogSupplierId);
  };

  // Receiving
  const startReceiving = async (order: PurchaseOrder) => {
    setReceivingOrder(order);
    const poItems: OrderItem[] = await apiGet(`/api/purchases/orders/${order.id}/items`);
    setRecvItems(poItems.map(i => ({
      item_name: i.item_name, ordered_qty: String(i.quantity),
      received_qty: String(i.quantity), unit: i.unit, unit_price: String(i.unit_price),
    })));
  };

  const handleReceiveSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!receivingOrder) return;
    const fd = new FormData(e.currentTarget);
    fd.set("items", JSON.stringify(recvItems));
    await fetch(`/api/purchases/orders/${receivingOrder.id}/receive`, {
      method: "POST", body: fd,
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    setReceivingOrder(null);
    apiGet("/api/purchases/orders").then(setOrders);
  };

  const updateRecvItem = (i: number, field: string, val: string) => {
    const u = [...recvItems];
    (u[i] as Record<string, string>)[field] = val;
    setRecvItems(u);
  };

  // Pay invoice
  const handlePaySubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!payingInvoice) return;
    const fd = new FormData(e.currentTarget);
    await fetch(`/api/purchases/invoices/${payingInvoice.id}/pay`, {
      method: "POST", body: fd,
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    setPayingInvoice(null);
    apiGet("/api/purchases/invoices").then(setInvoices);
    apiGet("/api/purchases/orders").then(setOrders);
  };

  const handlePayOnline = async (invoiceId: number) => {
    setPayOnlineLoading(invoiceId);
    try {
      const res = await fetch(`/api/payment/charge/${invoiceId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const data = await res.json();
      if (res.ok && data.redirect_url) {
        window.location.href = data.redirect_url;
      } else {
        alert(data.detail || t("payment_error"));
      }
    } catch {
      alert(t("payment_error"));
    }
    setPayOnlineLoading(null);
  };

  const supplierName = (id: number) => suppliers.find(s => s.id === id)?.name || "";
  const branchName = (id: number) => { const b = branches.find(x => x.id === id); return b ? (i18n.language === "ar" ? (b.name_ar || b.name) : b.name) : ""; };
  const getSupplier = (id: number) => suppliers.find(s => s.id === id);

  const sendWhatsApp = async (order: PurchaseOrder) => {
    const supplier = getSupplier(order.supplier_id);
    if (!supplier?.whatsapp) { alert(t("no_whatsapp")); return; }
    try {
      const fd = new FormData();
      fd.append("order_id", String(order.id));
      const res = await fetch("/api/whatsapp/send-purchase", {
        method: "POST", body: fd,
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.detail || "Failed to send via Green API");
        return;
      }
      alert(t("whatsapp_sent") || "Sent successfully via Green API!");
    } catch (e) {
      alert("Failed to send via Green API. Check Settings → WhatsApp Integration.");
    }
  };



  const statusColor = (s: string) => {
    if (s === "paid") return "bg-green-100 text-green-700";
    if (s === "invoiced") return "bg-purple-100 text-purple-700";
    if (s === "received") return "bg-blue-100 text-blue-700";
    return "bg-yellow-100 text-yellow-700";
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-gray-800">{t("purchases")}</h2>
        <div className="flex gap-2">
          <button onClick={() => apiDownload("/api/export/purchases/csv", "purchases.csv")}
            className="px-3 py-1.5 bg-green-600 text-white rounded text-xs hover:bg-green-700">
            {t("export_csv")}
          </button>
          <button onClick={() => apiDownload("/api/export/purchases/excel", "purchases.xlsx")}
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">
            {t("export_excel")}
          </button>
          <button onClick={() => apiDownload("/api/export/purchases/pdf", "purchases.pdf")}
            className="px-3 py-1.5 bg-red-600 text-white rounded text-xs hover:bg-red-700">
            {t("export_pdf")}
          </button>
          <button onClick={() => { setEditingSupplier(null); setShowSupplierForm(!showSupplierForm); }}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm">
            + {t("supplier")}
          </button>
          {tab === "orders" && (
            <button onClick={() => { setShowOrderForm(!showOrderForm); if (showOrderForm) { setEditingOrder(null); setOrderSupplierId(null); setOrderCatalogItems([]); setSelectedCatalogIds(new Set()); setCatalogQuantities({}); setItems([{ item_name: "", quantity: "1", unit: "pcs", unit_price: "0", total: "0" }]); } }}
              className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm">
              {showOrderForm ? t("cancel") : t("add_new")}
            </button>
          )}
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg w-fit flex-wrap">
        {(["orders", "catalog", "categories", "invoices", "ledger"] as Tab[]).map(tb => (
          <button key={tb} onClick={() => setTab(tb)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              tab === tb ? "bg-white shadow text-emerald-700" : "text-gray-500 hover:text-gray-700"}`}>
            {t(tb === "orders" ? "purchase_orders" : tb === "catalog" ? "supplier_catalog" : tb === "categories" ? "purchase_categories" : tb === "invoices" ? "invoices" : "supplier_ledger")}
          </button>
        ))}
      </div>

      {showSupplierForm && (
        <form onSubmit={handleSupplierSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-6 space-y-3">
          <h3 className="font-semibold">{editingSupplier ? t("edit") : t("add_new")} {t("supplier")}</h3>
          <div className="grid grid-cols-2 gap-3">
            <input name="name" defaultValue={editingSupplier?.name || ""} placeholder={t("name")} required className="px-3 py-2 border rounded-lg text-sm" />
            <input name="whatsapp" defaultValue={editingSupplier?.whatsapp || ""} placeholder={t("whatsapp")} className="px-3 py-2 border rounded-lg text-sm" />
            <input name="whatsapp_group" defaultValue={editingSupplier?.whatsapp_group || ""} placeholder={t("whatsapp_group_id") + " (120363XXX@g.us)"} className="px-3 py-2 border rounded-lg text-sm" />
            <select name="payment_type" defaultValue={editingSupplier?.payment_type || "cash"} className="px-3 py-2 border rounded-lg text-sm">
              <option value="cash">{t("cash")}</option>
              <option value="credit">{t("credit")}</option>
            </select>
            <select name="category_id" defaultValue={editingSupplier?.category_id || ""} className="px-3 py-2 border rounded-lg text-sm">
              <option value="">{t("select_category")}</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">{t("save")}</button>
            <button type="button" onClick={() => { setShowSupplierForm(false); setEditingSupplier(null); }}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm">{t("cancel")}</button>
          </div>
        </form>
      )}

      {/* ========== Receiving Modal ========== */}
      {receivingOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleReceiveSubmit} className="bg-white rounded-xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto space-y-4">
            <h3 className="text-lg font-bold">{t("receive_order")} #{receivingOrder.id}</h3>
            <p className="text-sm text-gray-500">{t("supplier")}: {supplierName(receivingOrder.supplier_id)} | {t("date")}: {receivingOrder.date}</p>
            <div>
              <label className="block text-sm font-medium mb-1">{t("receive_date")}</label>
              <input type="date" name="receive_date" required defaultValue={new Date().toISOString().split("T")[0]}
                className="px-3 py-2 border rounded-lg text-sm" />
            </div>
            <h4 className="font-semibold text-sm">{t("items")}</h4>
            <div className="space-y-2">
              {recvItems.map((ri, i) => (
                <div key={i} className="grid grid-cols-5 gap-2 items-center text-sm">
                  <span className="col-span-1 font-medium truncate">{ri.item_name}</span>
                  <div className="text-center">
                    <label className="block text-xs text-gray-400">{t("ordered")}</label>
                    <span>{ri.ordered_qty} {ri.unit}</span>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400">{t("received")}</label>
                    <input type="number" step="0.01" value={ri.received_qty}
                      onChange={e => updateRecvItem(i, "received_qty", e.target.value)}
                      className="w-full px-2 py-1 border rounded text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400">{t("unit_price")}</label>
                    <input type="number" step="0.001" value={ri.unit_price}
                      onChange={e => updateRecvItem(i, "unit_price", e.target.value)}
                      className="w-full px-2 py-1 border rounded text-sm" />
                  </div>
                  <div className="text-right font-mono">
                    KD {(parseFloat(ri.received_qty || "0") * parseFloat(ri.unit_price || "0")).toFixed(3)}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-right font-semibold">
              {t("total")}: KD {recvItems.reduce((s, ri) => s + parseFloat(ri.received_qty || "0") * parseFloat(ri.unit_price || "0"), 0).toFixed(3)}
            </div>
            <textarea name="notes" placeholder={t("notes")} className="w-full px-3 py-2 border rounded-lg text-sm" rows={2} />
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm">{t("confirm_receive")}</button>
              <button type="button" onClick={() => setReceivingOrder(null)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm">{t("cancel")}</button>
            </div>
          </form>
        </div>
      )}

      {/* ========== Pay Invoice Modal ========== */}
      {payingInvoice && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={handlePaySubmit} className="bg-white rounded-xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-lg font-bold">{t("pay_invoice")} #{payingInvoice.id}</h3>
            <p className="text-sm text-gray-500">
              {payingInvoice.supplier_name} | PO #{payingInvoice.purchase_order_id} | KD {payingInvoice.total_amount.toFixed(3)}
            </p>
            <div>
              <label className="block text-sm font-medium mb-1">{t("paid_amount")} (KD)</label>
              <input type="number" step="0.001" name="paid_amount" required
                defaultValue={payingInvoice.total_amount} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("paid_date")}</label>
              <input type="date" name="paid_date" required defaultValue={new Date().toISOString().split("T")[0]}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <textarea name="notes" placeholder={t("notes")} className="w-full px-3 py-2 border rounded-lg text-sm" rows={2} />
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm">{t("confirm_payment")}</button>
              <button type="button" onClick={() => setPayingInvoice(null)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm">{t("cancel")}</button>
            </div>
          </form>
        </div>
      )}

      {/* ========== ORDERS TAB ========== */}
      {tab === "orders" && (
        <>
          {showOrderForm && (
            <form onSubmit={handleOrderSubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-6 space-y-4" key={editingOrder?.id || "new"}>
              <h3 className="font-semibold text-lg">{editingOrder ? `${t("edit")} PO-${String(editingOrder.id).padStart(4,"0")}` : t("add_new")}</h3>
              <div className="grid grid-cols-2 gap-4">
                {user?.branch_id ? (
                  <input type="hidden" name="branch_id" value={user.branch_id} />
                ) : (
                  <div>
                    <label className="block text-sm font-medium mb-1">{t("branch")}</label>
                    <select name="branch_id" required className="w-full px-3 py-2 border rounded-lg text-sm" defaultValue={editingOrder?.branch_id || ""}>
                      {branches.map(b => <option key={b.id} value={b.id}>{i18n.language === "ar" ? (b.name_ar || b.name) : b.name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">{t("supplier")}</label>
                  <select name="supplier_id" required className="w-full px-3 py-2 border rounded-lg text-sm"
                    defaultValue={editingOrder?.supplier_id || ""}
                    onChange={e => loadSupplierItemsForOrder(Number(e.target.value))}>
                    <option value="">{t("select_supplier")}</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  {orderSupplierId && <p className="text-xs text-emerald-600 mt-1">{t("catalog_loaded")}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("date")}</label>
                  <input type="date" name="order_date" required className="w-full px-3 py-2 border rounded-lg text-sm" defaultValue={editingOrder?.date || ""} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("payment_type")}</label>
                  <select name="payment_type" className="w-full px-3 py-2 border rounded-lg text-sm" defaultValue={editingOrder?.payment_type || "cash"}>
                    <option value="cash">{t("cash")}</option>
                    <option value="credit">{t("credit")}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t("delivery_location")}</label>
                  <input name="delivery_location" placeholder={t("delivery_location")} className="w-full px-3 py-2 border rounded-lg text-sm" defaultValue={editingOrder?.delivery_location || ""} />
                </div>
              </div>

              {orderCatalogItems.length > 0 ? (
                <>
                  <h3 className="font-semibold">{t("select_products")} <span className="text-sm text-gray-400 font-normal">({selectedCatalogIds.size} {t("selected")})</span></h3>
                  <div className="bg-gray-50 rounded-lg border max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-100 border-b sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-center w-10"></th>
                          <th className="px-3 py-2 text-left">{t("item_name")}</th>
                          <th className="px-3 py-2 text-left">{t("item_name_ar")}</th>
                          <th className="px-3 py-2 text-left">{t("unit")}</th>
                          <th className="px-3 py-2 text-right">{t("unit_price")} (KD)</th>
                          <th className="px-3 py-2 text-center w-24">{t("quantity")}</th>
                          <th className="px-3 py-2 text-right w-24">{t("total")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderCatalogItems.map(ci => {
                          const isSelected = selectedCatalogIds.has(ci.id);
                          const qty = catalogQuantities[ci.id] || "1";
                          return (
                            <tr key={ci.id} className={`border-b cursor-pointer hover:bg-blue-50 ${isSelected ? "bg-emerald-50" : ""}`}
                              onClick={() => toggleCatalogItem(ci)}>
                              <td className="px-3 py-2 text-center">
                                <input type="checkbox" checked={isSelected} readOnly
                                  className="w-4 h-4 accent-emerald-600" />
                              </td>
                              <td className="px-3 py-2 font-medium">{ci.item_name}</td>
                              <td className="px-3 py-2 text-gray-500" dir="rtl">{ci.item_name_ar || "—"}</td>
                              <td className="px-3 py-2">{ci.unit}</td>
                              <td className="px-3 py-2 text-right font-mono">{ci.unit_price.toFixed(3)}</td>
                              <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                                {isSelected && (
                                  <input type="number" step="0.01" min="0.01" value={qty}
                                    onChange={e => updateCatalogQty(ci.id, e.target.value)}
                                    className="w-20 px-2 py-1 border rounded text-sm text-center" />
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-mono">
                                {isSelected ? `${(parseFloat(qty) * ci.unit_price).toFixed(3)}` : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="text-right font-semibold">
                    {t("total")}: KD {items.reduce((s, it) => s + parseFloat(it.total || "0"), 0).toFixed(3)}
                  </div>
                </>
              ) : (
                <>
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
                </>
              )}
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
                  <th className="px-4 py-3 text-left">{t("category")}</th>
                  <th className="px-4 py-3 text-left">{t("delivery_location")}</th>
                  <th className="px-4 py-3 text-left">{t("payment_type")}</th>
                  <th className="px-4 py-3 text-right">{t("total")}</th>
                  <th className="px-4 py-3 text-left">{t("status")}</th>
                  <th className="px-4 py-3 text-center">{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
                ) : orders.map(o => (
                  <tr key={o.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3">{o.id}</td>
                    <td className="px-4 py-3">{o.date}</td>
                    <td className="px-4 py-3">{branchName(o.branch_id)}</td>
                    <td className="px-4 py-3">{supplierName(o.supplier_id)}</td>
                    <td className="px-4 py-3">{categoryName(o.category_id)}</td>
                    <td className="px-4 py-3">{o.delivery_location || "—"}</td>
                    <td className="px-4 py-3">{t(o.payment_type)}</td>
                    <td className="px-4 py-3 text-right font-mono">KD {o.total_amount.toFixed(3)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs ${statusColor(o.status)}`}>{t(o.status)}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex gap-1 justify-center flex-wrap">
                        <button onClick={() => startEditOrder(o)}
                          className="px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">
                          {t("edit")}
                        </button>
                        <button onClick={() => apiDownload(`/api/export/purchase-order/${o.id}/pdf`, `PO-${String(o.id).padStart(4,"0")}.pdf`)}
                          className="px-2 py-1 bg-orange-500 text-white rounded text-xs hover:bg-orange-600">
                          {t("print")}
                        </button>
                        <button onClick={() => deleteOrder(o.id)}
                          className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700">
                          {t("delete")}
                        </button>
                        {o.status === "pending" && (
                          <button onClick={() => startReceiving(o)}
                            className="px-2 py-1 bg-indigo-500 text-white rounded text-xs hover:bg-indigo-600">
                            {t("receive")}
                          </button>
                        )}
                        <button onClick={() => sendWhatsApp(o)} title={t("send_whatsapp")}
                          className="px-2 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600">
                          {t("whatsapp")}
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
          {/* Suppliers List with Edit/Delete */}
          <div className="bg-white rounded-xl shadow-sm border mb-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">{t("supplier")}</th>
                  <th className="px-4 py-3 text-left">{t("category")}</th>
                  <th className="px-4 py-3 text-left">{t("whatsapp")}</th>
                  <th className="px-4 py-3 text-left">{t("payment_type")}</th>
                  <th className="px-4 py-3 text-center">{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s, idx) => (
                  <tr key={s.id} className={`border-b hover:bg-gray-50 cursor-pointer ${catalogSupplierId === s.id ? "bg-emerald-50" : ""}`}>
                    <td className="px-4 py-3" onClick={() => loadCatalog(s.id)}>{idx + 1}</td>
                    <td className="px-4 py-3 font-medium" onClick={() => loadCatalog(s.id)}>{s.name}</td>
                    <td className="px-4 py-3" onClick={() => loadCatalog(s.id)}>{categoryName(s.category_id ?? null)}</td>
                    <td className="px-4 py-3 text-gray-500" onClick={() => loadCatalog(s.id)}>{s.whatsapp || "—"}</td>
                    <td className="px-4 py-3" onClick={() => loadCatalog(s.id)}>
                      <span className={`px-2 py-1 rounded-full text-xs ${s.payment_type === "cash" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                        {t(s.payment_type)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex gap-1 justify-center">
                        <button onClick={() => loadCatalog(s.id)}
                          className="px-2 py-1 bg-emerald-500 text-white rounded text-xs hover:bg-emerald-600">
                          {t("items")}
                        </button>
                        <button onClick={() => { setEditingSupplier(s); setShowSupplierForm(true); }}
                          className="px-2 py-1 bg-amber-500 text-white rounded text-xs hover:bg-amber-600">
                          {t("edit")}
                        </button>
                        {isManager && (
                          <button onClick={() => deleteSupplier(s.id)}
                            className="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">
                            {t("delete")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

      {/* ========== CATEGORIES TAB ========== */}
      {tab === "categories" && (
        <div>
          {catMsg && (
            <div className={`p-3 rounded mb-4 text-sm ${
              catMsgType === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}>{catMsg}</div>
          )}

          {isManager && (
            <div className="flex justify-end mb-4">
              <button onClick={() => { setEditingCategory(null); setShowCategoryForm(!showCategoryForm); }}
                className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
                {showCategoryForm ? t("cancel") : `+ ${t("add_category")}`}
              </button>
            </div>
          )}

          {showCategoryForm && (
            <form onSubmit={handleCategorySubmit} className="bg-white p-6 rounded-xl shadow-sm border mb-4 space-y-3">
              <h3 className="font-semibold">{editingCategory ? t("edit_category") : t("add_category")}</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">{t("name")} (EN)</label>
                  <input name="name" defaultValue={editingCategory?.name || ""} required
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">{t("name")} (AR)</label>
                  <input name="name_ar" defaultValue={editingCategory?.name_ar || ""} dir="rtl"
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm">{t("save")}</button>
                <button type="button" onClick={() => { setShowCategoryForm(false); setEditingCategory(null); }}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm">{t("cancel")}</button>
              </div>
            </form>
          )}

          <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">{t("name")} (EN)</th>
                  <th className="px-4 py-3 text-left">{t("name")} (AR)</th>
                  {isManager && <th className="px-4 py-3 text-center">{t("actions")}</th>}
                </tr>
              </thead>
              <tbody>
                {categories.length === 0 ? (
                  <tr><td colSpan={isManager ? 4 : 3} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
                ) : categories.map((cat, idx) => (
                  <tr key={cat.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3">{idx + 1}</td>
                    <td className="px-4 py-3 font-medium">{cat.name}</td>
                    <td className="px-4 py-3 text-gray-500" dir="rtl">{cat.name_ar || "—"}</td>
                    {isManager && (
                      <td className="px-4 py-3 text-center">
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => { setEditingCategory(cat); setShowCategoryForm(true); }}
                            className="px-2 py-1 bg-amber-500 text-white rounded text-xs hover:bg-amber-600">
                            {t("edit")}
                          </button>
                          <button onClick={() => deleteCategory(cat.id)}
                            className="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600">
                            {t("delete")}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========== INVOICES TAB ========== */}
      {tab === "invoices" && (
        <div>
          <div className="bg-white p-4 rounded-xl shadow-sm border mb-4">
            <label className="block text-sm font-medium mb-2">{t("select_supplier")}</label>
            <select value={invoiceSupplierFilter || ""}
              onChange={e => setInvoiceSupplierFilter(e.target.value ? Number(e.target.value) : null)}
              className="w-full max-w-sm px-3 py-2 border rounded-lg text-sm">
              <option value="">{t("all_suppliers")}</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left">#</th>
                <th className="px-4 py-3 text-left">PO #</th>
                <th className="px-4 py-3 text-left">{t("date")}</th>
                <th className="px-4 py-3 text-left">{t("supplier")}</th>
                <th className="px-4 py-3 text-left">{t("branch")}</th>
                <th className="px-4 py-3 text-right">{t("total")}</th>
                <th className="px-4 py-3 text-right">{t("paid_amount")}</th>
                <th className="px-4 py-3 text-left">{t("status")}</th>
                <th className="px-4 py-3 text-center">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const filtered = invoiceSupplierFilter
                  ? invoices.filter(inv => inv.supplier_id === invoiceSupplierFilter)
                  : invoices;
                return filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">{t("no_invoices")}</td></tr>
              ) : filtered.map(inv => (
                <tr key={inv.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3">{inv.id}</td>
                  <td className="px-4 py-3">{inv.purchase_order_id}</td>
                  <td className="px-4 py-3">{inv.date}</td>
                  <td className="px-4 py-3">{inv.supplier_name}</td>
                  <td className="px-4 py-3">{inv.branch_name}</td>
                  <td className="px-4 py-3 text-right font-mono">KD {inv.total_amount.toFixed(3)}</td>
                  <td className="px-4 py-3 text-right font-mono">KD {inv.paid_amount.toFixed(3)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs ${inv.status === "paid" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                      {t(inv.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {inv.status === "pending" && (
                      <div className="flex gap-1 justify-center">
                        <button onClick={() => setPayingInvoice(inv)}
                          className="px-2 py-1 bg-emerald-500 text-white rounded text-xs hover:bg-emerald-600">
                          {t("pay")}
                        </button>
                        <button onClick={() => handlePayOnline(inv.id)}
                          disabled={payOnlineLoading === inv.id}
                          className="px-2 py-1 bg-indigo-500 text-white rounded text-xs hover:bg-indigo-600 disabled:opacity-50">
                          {payOnlineLoading === inv.id ? "..." : t("pay_online")}
                        </button>
                      </div>
                    )}
                    {inv.status === "paid" && inv.paid_date && (
                      <span className="text-xs text-gray-400">{inv.paid_date}</span>
                    )}
                  </td>
                </tr>
              ));
              })()}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {/* ========== SUPPLIER LEDGER TAB ========== */}
      {tab === "ledger" && (
        <div className="space-y-4">
          {ledger.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border p-8 text-center text-gray-400">{t("no_data")}</div>
          ) : ledger.map(entry => (
            <div key={entry.supplier_id} className="bg-white rounded-xl shadow-sm border">
              <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                onClick={() => setExpandedSupplier(expandedSupplier === entry.supplier_id ? null : entry.supplier_id)}>
                <div>
                  <h3 className="font-semibold text-lg">{entry.supplier_name}</h3>
                  <p className="text-sm text-gray-500">
                    {entry.pending_count} {t("pending")} | {entry.paid_count} {t("paid")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-500">{t("total_invoiced")}: <span className="font-mono">KD {entry.total_invoiced.toFixed(3)}</span></p>
                  <p className="text-sm text-green-600">{t("total_paid")}: <span className="font-mono">KD {entry.total_paid.toFixed(3)}</span></p>
                  <p className="text-lg font-bold text-red-600">
                    {t("balance_due")}: <span className="font-mono">KD {entry.total_pending.toFixed(3)}</span>
                  </p>
                </div>
              </div>
              {expandedSupplier === entry.supplier_id && entry.invoices.length > 0 && (
                <div className="border-t overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left">{t("invoice")} #</th>
                        <th className="px-4 py-2 text-left">PO #</th>
                        <th className="px-4 py-2 text-left">{t("date")}</th>
                        <th className="px-4 py-2 text-right">{t("amount")}</th>
                        <th className="px-4 py-2 text-right">{t("paid_amount")}</th>
                        <th className="px-4 py-2 text-left">{t("status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entry.invoices.map(inv => (
                        <tr key={inv.id} className="border-b hover:bg-gray-50">
                          <td className="px-4 py-2">{inv.id}</td>
                          <td className="px-4 py-2">{inv.po_id}</td>
                          <td className="px-4 py-2">{inv.date}</td>
                          <td className="px-4 py-2 text-right font-mono">KD {inv.total_amount.toFixed(3)}</td>
                          <td className="px-4 py-2 text-right font-mono">KD {inv.paid_amount.toFixed(3)}</td>
                          <td className="px-4 py-2">
                            <span className={`px-2 py-1 rounded-full text-xs ${inv.status === "paid" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                              {t(inv.status)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
