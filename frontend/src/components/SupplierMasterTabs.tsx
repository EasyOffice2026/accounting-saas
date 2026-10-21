import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost, apiPut, apiDelete } from "../contexts/api";

export interface MasterSupplier { id: number; name: string; whatsapp: string | null; whatsapp_group: string | null; payment_type: string; category_id: number | null; }
export interface MasterItem { id: number; item_name: string; item_name_ar: string | null; packaging: string | null; unit: string; unit_price: number; }
export interface MasterCategory { id: number; name: string; name_ar: string | null; }

const UNITS = ["pcs", "kg", "g", "liter", "ml", "box", "carton", "pack", "bag", "bottle", "can", "tray"];
const inp = "w-full px-3 py-2 border rounded-lg text-sm";
const smallBtn = "px-2 py-1 text-white rounded text-xs";

interface Props {
  tab: "catalog" | "categories";
  canDelete: boolean;
  canManageCategories: boolean;
  showSupplierForm: boolean;
  onCloseSupplierForm: () => void;
  onChanged?: () => void;
}

/** Supplier list + item catalog + purchase categories, shared by Branch Purchases and the Purchase Office. */
export default function SupplierMasterTabs({ tab, canDelete, canManageCategories, showSupplierForm, onCloseSupplierForm, onChanged }: Props) {
  const { t, i18n } = useTranslation();
  const [suppliers, setSuppliers] = useState<MasterSupplier[]>([]);
  const [categories, setCategories] = useState<MasterCategory[]>([]);
  const [editingSupplier, setEditingSupplier] = useState<MasterSupplier | null>(null);
  const [supplierFormOpen, setSupplierFormOpen] = useState(false);
  const [catalogSupplierId, setCatalogSupplierId] = useState<number | null>(null);
  const [catalogItems, setCatalogItems] = useState<MasterItem[]>([]);
  const [showItemForm, setShowItemForm] = useState(false);
  const [editingItem, setEditingItem] = useState<MasterItem | null>(null);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<MasterCategory | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const reload = () => {
    apiGet("/api/purchases/suppliers").then(setSuppliers);
    apiGet("/api/purchases/categories").then(setCategories);
    onChanged?.();
  };
  useEffect(() => { reload(); }, []);
  useEffect(() => { if (showSupplierForm) { setEditingSupplier(null); setSupplierFormOpen(true); } }, [showSupplierForm]);

  const flash = (text: string, ok: boolean) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 4000); };
  const closeSupplierForm = () => { setSupplierFormOpen(false); setEditingSupplier(null); onCloseSupplierForm(); };
  const catName = (id: number | null) => categories.find(c => c.id === id)?.name || "—";
  const supplierName = (id: number) => suppliers.find(s => s.id === id)?.name || "";

  const loadCatalog = async (id: number) => { setCatalogSupplierId(id); setCatalogItems(await apiGet(`/api/purchases/suppliers/${id}/items`)); };

  const submitSupplier = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (editingSupplier) await apiPut(`/api/purchases/suppliers/${editingSupplier.id}`, fd);
    else await apiPost("/api/purchases/suppliers", fd);
    closeSupplierForm(); reload(); flash(t("saved"), true);
  };
  const deleteSupplier = async (id: number) => {
    if (!confirm(t("confirm_delete"))) return;
    await apiDelete(`/api/purchases/suppliers/${id}`);
    if (catalogSupplierId === id) { setCatalogSupplierId(null); setCatalogItems([]); }
    reload();
  };
  const submitItem = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!catalogSupplierId) return;
    const fd = new FormData(e.currentTarget);
    if (editingItem) await apiPut(`/api/purchases/suppliers/items/${editingItem.id}`, fd);
    else await apiPost(`/api/purchases/suppliers/${catalogSupplierId}/items`, fd);
    setShowItemForm(false); setEditingItem(null); loadCatalog(catalogSupplierId); onChanged?.();
  };
  const deleteItem = async (id: number) => {
    if (!confirm(t("confirm_delete"))) return;
    await apiDelete(`/api/purchases/suppliers/items/${id}`);
    if (catalogSupplierId) loadCatalog(catalogSupplierId);
    onChanged?.();
  };
  const submitCategory = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      const res = editingCategory
        ? await apiPut(`/api/purchases/categories/${editingCategory.id}`, fd)
        : await apiPost("/api/purchases/categories", fd);
      if (res && res.detail) throw new Error(res.detail);
      flash(t("saved"), true); setShowCategoryForm(false); setEditingCategory(null); reload();
    } catch (err: unknown) { flash((err as Error).message, false); }
  };
  const deleteCategory = async (id: number) => {
    if (!confirm(t("confirm_delete"))) return;
    await apiDelete(`/api/purchases/categories/${id}`); reload();
  };

  const supplierForm = supplierFormOpen && (
    <form onSubmit={submitSupplier} className="bg-white p-6 rounded-xl shadow-sm border mb-4 space-y-3">
      <h3 className="font-semibold">{editingSupplier ? t("edit") : t("add_new")} {t("supplier")}</h3>
      <div className="grid grid-cols-2 gap-3">
        <input name="name" defaultValue={editingSupplier?.name || ""} placeholder={t("name")} required className={inp} />
        <input name="whatsapp" defaultValue={editingSupplier?.whatsapp || ""} placeholder={t("whatsapp")} className={inp} />
        <input name="whatsapp_group" defaultValue={editingSupplier?.whatsapp_group || ""} placeholder={t("whatsapp_group_id") + " (120363XXX@g.us)"} className={inp} />
        <select name="payment_type" defaultValue={editingSupplier?.payment_type || "cash"} className={inp}>
          <option value="cash">{t("cash")}</option>
          <option value="credit">{t("credit")}</option>
        </select>
        <select name="category_id" defaultValue={editingSupplier?.category_id || ""} className={inp}>
          <option value="">{t("select_category")}</option>
          {categories.map(c => <option key={c.id} value={c.id}>{i18n.language === "ar" ? (c.name_ar || c.name) : c.name}</option>)}
        </select>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">{t("save")}</button>
        <button type="button" onClick={closeSupplierForm} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm">{t("cancel")}</button>
      </div>
    </form>
  );

  if (tab === "categories") {
    return (
      <div>
        {msg && <div className={`p-3 rounded mb-4 text-sm ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.text}</div>}
        {canManageCategories && (
          <div className="flex justify-end mb-4">
            <button onClick={() => { setEditingCategory(null); setShowCategoryForm(!showCategoryForm); }}
              className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">
              {showCategoryForm ? t("cancel") : `+ ${t("add_category")}`}
            </button>
          </div>
        )}
        {showCategoryForm && (
          <form onSubmit={submitCategory} className="bg-white p-6 rounded-xl shadow-sm border mb-4 space-y-3">
            <h3 className="font-semibold">{editingCategory ? t("edit_category") : t("add_category")}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium mb-1">{t("name")} (EN)</label>
                <input name="name" defaultValue={editingCategory?.name || ""} required className={inp} /></div>
              <div><label className="block text-xs font-medium mb-1">{t("name")} (AR)</label>
                <input name="name_ar" defaultValue={editingCategory?.name_ar || ""} dir="rtl" className={inp} /></div>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm">{t("save")}</button>
              <button type="button" onClick={() => { setShowCategoryForm(false); setEditingCategory(null); }} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm">{t("cancel")}</button>
            </div>
          </form>
        )}
        <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b"><tr>
              <th className="px-4 py-3 text-left">#</th>
              <th className="px-4 py-3 text-left">{t("name")} (EN)</th>
              <th className="px-4 py-3 text-left">{t("name")} (AR)</th>
              {canManageCategories && <th className="px-4 py-3 text-center">{t("actions")}</th>}
            </tr></thead>
            <tbody>
              {categories.length === 0 ? (
                <tr><td colSpan={canManageCategories ? 4 : 3} className="px-4 py-8 text-center text-gray-400">{t("no_data")}</td></tr>
              ) : categories.map((cat, idx) => (
                <tr key={cat.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3">{idx + 1}</td>
                  <td className="px-4 py-3 font-medium">{cat.name}</td>
                  <td className="px-4 py-3 text-gray-500" dir="rtl">{cat.name_ar || "—"}</td>
                  {canManageCategories && (
                    <td className="px-4 py-3 text-center"><div className="flex gap-1 justify-center">
                      <button onClick={() => { setEditingCategory(cat); setShowCategoryForm(true); }} className={`${smallBtn} bg-amber-500 hover:bg-amber-600`}>{t("edit")}</button>
                      <button onClick={() => deleteCategory(cat.id)} className={`${smallBtn} bg-red-500 hover:bg-red-600`}>{t("delete")}</button>
                    </div></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      {msg && <div className={`p-3 rounded mb-4 text-sm ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.text}</div>}
      {supplierForm}
      <div className="bg-white rounded-xl shadow-sm border mb-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b"><tr>
            <th className="px-4 py-3 text-left">#</th>
            <th className="px-4 py-3 text-left">{t("supplier")}</th>
            <th className="px-4 py-3 text-left">{t("category")}</th>
            <th className="px-4 py-3 text-left">{t("whatsapp")}</th>
            <th className="px-4 py-3 text-left">{t("payment_type")}</th>
            <th className="px-4 py-3 text-center">{t("actions")}</th>
          </tr></thead>
          <tbody>
            {suppliers.map((s, idx) => (
              <tr key={s.id} className={`border-b hover:bg-gray-50 cursor-pointer ${catalogSupplierId === s.id ? "bg-emerald-50" : ""}`}>
                <td className="px-4 py-3" onClick={() => loadCatalog(s.id)}>{idx + 1}</td>
                <td className="px-4 py-3 font-medium" onClick={() => loadCatalog(s.id)}>{s.name}</td>
                <td className="px-4 py-3" onClick={() => loadCatalog(s.id)}>{catName(s.category_id)}</td>
                <td className="px-4 py-3 text-gray-500" onClick={() => loadCatalog(s.id)}>{s.whatsapp || "—"}</td>
                <td className="px-4 py-3" onClick={() => loadCatalog(s.id)}>
                  <span className={`px-2 py-1 rounded-full text-xs ${s.payment_type === "cash" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>{t(s.payment_type)}</span>
                </td>
                <td className="px-4 py-3 text-center"><div className="flex gap-1 justify-center">
                  <button onClick={() => loadCatalog(s.id)} className={`${smallBtn} bg-emerald-500 hover:bg-emerald-600`}>{t("items")}</button>
                  <button onClick={() => { setEditingSupplier(s); setSupplierFormOpen(true); }} className={`${smallBtn} bg-amber-500 hover:bg-amber-600`}>{t("edit")}</button>
                  {canDelete && <button onClick={() => deleteSupplier(s.id)} className={`${smallBtn} bg-red-500 hover:bg-red-600`}>{t("delete")}</button>}
                </div></td>
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
            <button onClick={() => { setEditingItem(null); setShowItemForm(true); }} className="px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm">+ {t("add_item")}</button>
          </div>
          {showItemForm && (
            <form onSubmit={submitItem} className="bg-white p-6 rounded-xl shadow-sm border mb-4 space-y-3">
              <h3 className="font-semibold">{editingItem ? t("edit_item") : t("add_item")}</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div><label className="block text-xs font-medium mb-1">{t("item_name")}</label>
                  <input name="item_name" defaultValue={editingItem?.item_name || ""} required className={inp} /></div>
                <div><label className="block text-xs font-medium mb-1">{t("item_name_ar")}</label>
                  <input name="item_name_ar" defaultValue={editingItem?.item_name_ar || ""} className={inp} dir="rtl" /></div>
                <div><label className="block text-xs font-medium mb-1">{t("packaging")}</label>
                  <input name="packaging" defaultValue={editingItem?.packaging || ""} placeholder="e.g. 6x1.5L, Box of 24" className={inp} /></div>
                <div><label className="block text-xs font-medium mb-1">{t("unit")}</label>
                  <select name="unit" defaultValue={editingItem?.unit || "pcs"} className={inp}>{UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select></div>
                <div><label className="block text-xs font-medium mb-1">{t("unit_price")} (KD)</label>
                  <input name="unit_price" type="number" step="0.001" defaultValue={editingItem?.unit_price || 0} className={inp} /></div>
              </div>
              <div className="flex gap-2">
                <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm">{t("save")}</button>
                <button type="button" onClick={() => { setShowItemForm(false); setEditingItem(null); }} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm">{t("cancel")}</button>
              </div>
            </form>
          )}
          <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b"><tr>
                <th className="px-4 py-3 text-left">#</th>
                <th className="px-4 py-3 text-left">{t("item_name")}</th>
                <th className="px-4 py-3 text-left">{t("item_name_ar")}</th>
                <th className="px-4 py-3 text-left">{t("packaging")}</th>
                <th className="px-4 py-3 text-left">{t("unit")}</th>
                <th className="px-4 py-3 text-right">{t("unit_price")} (KD)</th>
                <th className="px-4 py-3 text-center">{t("actions")}</th>
              </tr></thead>
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
                    <td className="px-4 py-3 text-center"><div className="flex gap-1 justify-center">
                      <button onClick={() => { setEditingItem(ci); setShowItemForm(true); }} className={`${smallBtn} bg-amber-500 hover:bg-amber-600`}>{t("edit")}</button>
                      <button onClick={() => deleteItem(ci.id)} className={`${smallBtn} bg-red-500 hover:bg-red-600`}>{t("delete")}</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
