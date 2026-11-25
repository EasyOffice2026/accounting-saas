import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch, apiGet } from "../contexts/api";
import { useBrand } from "../contexts/BrandContext";

type Source = "supplier_item" | "transfer_item";
interface Item { source: Source; id: number; name: string; name_ar: string; group: string; unit: string; category: string }
interface Link { brand_id: number; source: Source; item_id: number; pos_ingredient_id: string; pos_ingredient_name: string; factor: number; category: string }
interface Ingredient { id: string; brandId: string; name: { en: string; ar: string }; unit: string; isActive: boolean }
interface Push { key: string; status: string; error: string | null; created_at: string | null }

const CATEGORIES = ["food", "beverage", "packaging"];
const input = "border rounded px-2 py-1 text-sm";

// Each purchase or transfer item is linked, per brand, to the POS stock item it becomes.
export default function PosStockLinksPanel() {
  const { t, i18n } = useTranslation();
  const ar = i18n.language === "ar";
  const { brands } = useBrand();
  const [brandId, setBrandId] = useState<number>(0);
  const [items, setItems] = useState<Item[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [pushes, setPushes] = useState<Push[]>([]);
  const [source, setSource] = useState<Source>("supplier_item");
  const [error, setError] = useState("");

  const load = () => {
    apiGet("/api/pos/stock-items").then(setItems);
    apiGet("/api/pos/stock-links").then(setLinks);
    apiGet("/api/pos/stock-pushes").then(setPushes);
  };
  useEffect(load, []);
  useEffect(() => { if (!brandId && brands.length) setBrandId(brands[0].id); }, [brands, brandId]);

  const linkOf = useMemo(() => {
    const m = new Map<string, Link>();
    links.filter((l) => l.brand_id === brandId).forEach((l) => m.set(`${l.source}:${l.item_id}`, l));
    return m;
  }, [links, brandId]);

  const save = async (item: Item, change: Partial<Link>) => {
    const cur = linkOf.get(`${item.source}:${item.id}`);
    const next = { pos_ingredient_id: cur?.pos_ingredient_id || "", factor: cur?.factor || 1, category: cur?.category || item.category, ...change };
    const ing = ingredients.find((x) => x.id === next.pos_ingredient_id);
    const res = await apiFetch("/api/pos/stock-links", {
      method: "POST",
      body: new URLSearchParams({
        brand_id: String(brandId), source: item.source, item_id: String(item.id),
        pos_ingredient_id: next.pos_ingredient_id, pos_ingredient_name: ing ? ing.name.en : cur?.pos_ingredient_name || "",
        factor: String(next.factor), category: next.category,
      }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).detail || res.statusText);
    else { setError(""); apiGet("/api/pos/stock-links").then(setLinks); }
  };

  const shown = items.filter((i) => i.source === source);
  return (
    <div className="bg-white rounded-xl shadow p-6 mt-6">
      <h2 className="text-lg font-semibold mb-1">{t("pos_stock_items")}</h2>
      <p className="text-sm text-gray-500 mb-4">{t("pos_stock_items_desc")}</p>
      {error && <div className="p-3 rounded mb-3 text-sm bg-red-50 text-red-700">{error}</div>}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <select className={input} value={brandId} onChange={(e) => setBrandId(Number(e.target.value))}>
          {brands.map((b) => <option key={b.id} value={b.id}>{ar ? b.name_ar || b.name_en : b.name_en}</option>)}
        </select>
        <select className={input} value={source} onChange={(e) => setSource(e.target.value as Source)}>
          <option value="supplier_item">{t("pos_stock_supplier_items")}</option>
          <option value="transfer_item">{t("pos_stock_transfer_items")}</option>
        </select>
        <button type="button" className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-sm" onClick={async () => {
          const res = await apiFetch("/api/pos/ingredients");
          if (res.ok) setIngredients((await res.json()).ingredients); else setError((await res.json().catch(() => ({}))).detail || res.statusText);
        }}>{t("pos_load_ingredients")}</button>
      </div>
      <div className="overflow-x-auto max-h-[28rem]">
        <table className="w-full text-sm">
          <thead><tr className="text-start text-gray-500">
            <th className="text-start p-2">{t("pos_stock_source_item")}</th><th className="text-start p-2">{t("pos_stock_item")}</th>
            <th className="text-start p-2">{t("pos_stock_factor")}</th><th className="text-start p-2">{t("pos_stock_category")}</th>
          </tr></thead>
          <tbody>
            {shown.map((item) => {
              const link = linkOf.get(`${item.source}:${item.id}`);
              return (
                <tr key={`${item.source}:${item.id}`} className="border-t">
                  <td className="p-2">{ar ? item.name_ar || item.name : item.name}<span className="text-gray-400"> {item.unit}{item.group ? ` · ${item.group}` : ""}</span></td>
                  <td className="p-2">
                    <select className={input} value={link?.pos_ingredient_id || ""} onChange={(e) => save(item, { pos_ingredient_id: e.target.value })}>
                      <option value="">{link && !ingredients.length ? link.pos_ingredient_name : t("pos_stock_not_linked")}</option>
                      {ingredients.map((g) => <option key={g.id} value={g.id}>{(ar ? g.name.ar : g.name.en) || g.name.en} ({g.unit})</option>)}
                    </select>
                  </td>
                  <td className="p-2"><input className={`${input} w-24`} type="number" min="0.001" step="0.001" defaultValue={link?.factor ?? 1}
                    key={`${brandId}:${link?.factor}`} disabled={!link} onBlur={(e) => { const f = Number(e.target.value); if (link && f > 0 && f !== link.factor) save(item, { factor: f }); }} /></td>
                  <td className="p-2">
                    <select className={input} value={link?.category || item.category} disabled={!link} onChange={(e) => save(item, { category: e.target.value })}>
                      {CATEGORIES.map((c) => <option key={c} value={c}>{t(`pos_stock_${c}`)}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pushes.length > 0 && (
        <div className="mt-4">
          <h3 className="font-medium mb-2">{t("pos_stock_pushes")}</h3>
          <ul className="text-sm space-y-1">
            {pushes.slice(0, 20).map((p) => (
              <li key={p.key} className={p.status === "done" ? "text-gray-600" : "text-red-700"} dir="ltr">{p.key} — {p.status}{p.error ? `: ${p.error}` : ""}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
