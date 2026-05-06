import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../contexts/api";

interface Supplier { id: number; name: string; email: string; whatsapp: string; payment_type: string; }
interface PurchaseOrder {
  id: number; branch_id: number; supplier_id: number; date: string;
  payment_type: string; total_amount: number; status: string;
}
interface Branch { id: number; name: string; }

export default function PurchasesPage() {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [items, setItems] = useState([{ item_name: "", quantity: "1", unit: "pcs", unit_price: "0", total: "0" }]);

  useEffect(() => {
    apiGet("/api/branches/").then(setBranches);
    apiGet("/api/purchases/suppliers").then(setSuppliers);
    apiGet("/api/purchases/orders").then(setOrders);
  }, []);

  const addItem = () => setItems([...items, { item_name: "", quantity: "1", unit: "pcs", unit_price: "0", total: "0" }]);

  const updateItem = (i: number, field: string, val: string) => {
    const updated = [...items];
    (updated[i] as Record<string, string>)[field] = val;
    if (field === "quantity" || field === "unit_price") {
      updated[i].total = (parseFloat(updated[i].quantity || "0") * parseFloat(updated[i].unit_price || "0")).toFixed(3);
    }
    setItems(updated);
  };

  const handleOrderSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("items", JSON.stringify(items));
    await apiPost("/api/purchases/orders", fd);
    setShowOrderForm(false);
    apiGet("/api/purchases/orders").then(setOrders);
  };

  const handleSupplierSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await apiPost("/api/purchases/suppliers", fd);
    setShowSupplierForm(false);
    apiGet("/api/purchases/suppliers").then(setSuppliers);
  };

  const supplierName = (id: number) => suppliers.find(s => s.id === id)?.name || "";
  const branchName = (id: number) => branches.find(b => b.id === id)?.name || "";

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
          <button onClick={() => setShowOrderForm(!showOrderForm)}
            className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition text-sm">
            {showOrderForm ? t("cancel") : t("add_new")}
          </button>
        </div>
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
              <select name="supplier_id" required className="w-full px-3 py-2 border rounded-lg text-sm">
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
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
          {items.map((item, i) => (
            <div key={i} className="grid grid-cols-5 gap-2">
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
            </div>
          ))}
          <button type="button" onClick={addItem} className="text-sm text-emerald-600 hover:underline">
            + {t("add_new")} {t("items")}
          </button>

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
                📷 {t("take_picture")}
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
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
