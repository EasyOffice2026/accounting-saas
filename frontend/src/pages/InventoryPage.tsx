import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch, apiGet } from "../contexts/api";
import { useBrand } from "../contexts/BrandContext";

// Inventory and costing: item master, links from supplier/transfer items, Central Kitchen batch recipes
// and production, opening stock, dish cost and expected vs actual usage.
interface Item { id: number; code: string; name: string; name_ar: string; kind: string; category: string; unit: string; is_active: boolean; in_pos: boolean; has_recipe: boolean }
interface Source { source: string; id: number; name: string; name_ar: string; group: string; unit: string; price: number; stock_item_id: number | null; factor: number }
interface Line { stock_item_id: number; quantity: number; unit_cost?: number; cost?: number | null }
interface Recipe { id: number; stock_item_id: number; batch_qty: number; notes: string; lines: Line[] }
interface Production { id: number; branch_id: number; date: string; stock_item_id: number; batches: number; expected_qty: number; output_qty: number; yield_pct: number | null; cost: number | null; unit_cost: number | null; status: string; error: string | null; lines: Line[] }
interface Branch { id: number; name: string; name_ar?: string; brand_id: number; unit_type: string }

const T: Record<string, [string, string]> = {
  title: ["Inventory & Costing", "المخزون والتكلفة"],
  items: ["Item master", "قائمة الأصناف"], links: ["Purchase & transfer items", "أصناف الشراء والتحويل"],
  recipes: ["Batch recipes", "وصفات الدفعات"], production: ["Production", "الإنتاج"], opening: ["Opening stock", "مخزون افتتاحي"],
  dish: ["Dish cost", "تكلفة الأطباق"], usage: ["Expected vs actual", "المتوقع مقابل الفعلي"],
  code: ["Code", "الرمز"], name: ["Name", "الاسم"], name_ar: ["Arabic name", "الاسم بالعربي"], kind: ["Type", "النوع"],
  raw: ["Raw (as bought)", "خام (كما يُشترى)"], semi: ["Semi-processed", "نصف مصنّع"], category: ["Category", "الفئة"],
  food: ["Food", "طعام"], beverage: ["Beverage", "مشروبات"], packaging: ["Packaging", "تغليف"], unit: ["Unit", "الوحدة"],
  add: ["Add", "إضافة"], save: ["Save", "حفظ"], sync: ["Sync to POS", "مزامنة مع نقاط البيع"], in_pos: ["In POS", "في نقاط البيع"],
  active: ["Active", "نشط"], factor: ["Units in one", "الوحدات في الواحد"], none: ["— not stock —", "— ليس مخزون —"],
  supplier_items: ["Supplier items", "أصناف الموردين"], transfer_items: ["Transfer items", "أصناف التحويل"],
  makes: ["One batch makes", "الدفعة الواحدة تنتج"], ingredient: ["Ingredient", "المكوّن"], qty: ["Quantity", "الكمية"],
  add_line: ["Add ingredient", "إضافة مكوّن"], output: ["Item made", "الصنف المنتج"], batches: ["Batches", "عدد الدفعات"],
  made: ["Actually made", "المنتج فعلياً"], expected: ["Expected", "المتوقع"], yield: ["Yield", "المردود"], cost: ["Cost", "التكلفة"],
  unit_cost: ["Unit cost", "تكلفة الوحدة"], status: ["Status", "الحالة"], date: ["Date", "التاريخ"], kitchen: ["Central Kitchen", "المطبخ المركزي"],
  post: ["Post production", "ترحيل الإنتاج"], unit_place: ["Branch / store", "الفرع / المخزن"], value: ["Value", "القيمة"],
  post_opening: ["Post opening stock", "ترحيل المخزون الافتتاحي"], price: ["Price", "السعر"], margin: ["Margin", "الهامش"],
  fc: ["Food cost %", "نسبة تكلفة الطعام"], no_recipe: ["No recipe in POS", "لا توجد وصفة في نقاط البيع"],
  from: ["From", "من"], to: ["To", "إلى"], show: ["Show", "عرض"], sold: ["Sold (recipe)", "مباع (وصفة)"],
  in_prod: ["Used in production", "مستخدم في الإنتاج"], waste: ["Waste", "هدر"], count: ["Count diff.", "فرق الجرد"],
  actual: ["Actual", "الفعلي"], variance: ["Variance", "الفرق"], recipe_hint: ["Dish recipes are edited in the POS (Menu → item → Recipe). Semi-processed items appear there as ingredients.", "وصفات الأطباق تُعدّل في نقاط البيع (القائمة ← الصنف ← الوصفة). الأصناف نصف المصنعة تظهر هناك كمكونات."],
};
const input = "border rounded px-2 py-1 text-sm";
const btn = "px-3 py-1 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50";
const f3 = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(3));
const today = () => new Date().toISOString().slice(0, 10);

async function send(path: string, body: Record<string, string>, method = "POST") {
  const res = await apiFetch(path, { method, body: new URLSearchParams(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || res.statusText);
  return data;
}

export default function InventoryPage() {
  const { i18n } = useTranslation();
  const ar = i18n.language === "ar";
  const t = (k: string) => (T[k] ? T[k][ar ? 1 : 0] : k);
  const { brands } = useBrand();
  const [tab, setTab] = useState("items");
  const [items, setItems] = useState<Item[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [msg, setMsg] = useState("");
  const loadItems = () => apiGet("/api/inventory/items").then(setItems);
  useEffect(() => { loadItems(); apiGet("/api/branches/?all_brands=1").then(setBranches); }, []);
  const itemName = (id: number) => { const i = items.find((x) => x.id === id); return i ? `${ar ? i.name_ar || i.name : i.name} (${i.unit})` : "?"; };
  const branchName = (id: number) => { const b = branches.find((x) => x.id === id); return b ? (ar ? b.name_ar || b.name : b.name) : "?"; };
  const run = async (fn: () => Promise<unknown>) => { try { setMsg(""); await fn(); } catch (e) { setMsg((e as Error).message); } };
  const ctx = { t, ar, items, branches, brands, itemName, branchName, run, loadItems };
  const tabs = ["items", "links", "recipes", "production", "opening", "dish", "usage"];
  return (
    <div className="p-4 md:p-6" dir={ar ? "rtl" : "ltr"}>
      <h1 className="text-2xl font-bold mb-4">{t("title")}</h1>
      <div className="flex flex-wrap gap-2 mb-4">
        {tabs.map((k) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded text-sm ${tab === k ? "bg-blue-600 text-white" : "bg-white shadow"}`}>{t(k)}</button>)}
      </div>
      {msg && <div className="p-3 rounded mb-3 text-sm bg-red-50 text-red-700">{msg}</div>}
      <div className="bg-white rounded-xl shadow p-4 overflow-x-auto">
        {tab === "items" && <ItemsTab {...ctx} />}
        {tab === "links" && <LinksTab {...ctx} />}
        {tab === "recipes" && <RecipesTab {...ctx} />}
        {tab === "production" && <ProductionTab {...ctx} />}
        {tab === "opening" && <OpeningTab {...ctx} />}
        {tab === "dish" && <DishTab {...ctx} />}
        {tab === "usage" && <UsageTab {...ctx} />}
      </div>
    </div>
  );
}

type Ctx = { t: (k: string) => string; ar: boolean; items: Item[]; branches: Branch[]; brands: { id: number; name_en: string; name_ar?: string }[];
  itemName: (id: number) => string; branchName: (id: number) => string; run: (fn: () => Promise<unknown>) => Promise<void>; loadItems: () => Promise<void> };

function ItemsTab({ t, items, run, loadItems }: Ctx) {
  const blank = { code: "", name: "", name_ar: "", kind: "raw", category: "food", unit: "kg" };
  const [f, setF] = useState(blank);
  const [edit, setEdit] = useState<Item | null>(null);
  const field = (o: typeof blank, set: (v: typeof blank) => void) => (
    <>
      <input className={`${input} w-20`} placeholder={t("code")} value={o.code} onChange={(e) => set({ ...o, code: e.target.value })} />
      <input className={input} placeholder={t("name")} value={o.name} onChange={(e) => set({ ...o, name: e.target.value })} />
      <input className={input} placeholder={t("name_ar")} dir="rtl" value={o.name_ar} onChange={(e) => set({ ...o, name_ar: e.target.value })} />
      <select className={input} value={o.kind} onChange={(e) => set({ ...o, kind: e.target.value })}>{["raw", "semi"].map((k) => <option key={k} value={k}>{t(k)}</option>)}</select>
      <select className={input} value={o.category} onChange={(e) => set({ ...o, category: e.target.value })}>{["food", "beverage", "packaging"].map((k) => <option key={k} value={k}>{t(k)}</option>)}</select>
      <select className={input} value={o.unit} onChange={(e) => set({ ...o, unit: e.target.value })}>{["g", "kg", "ml", "l", "piece"].map((k) => <option key={k}>{k}</option>)}</select>
    </>
  );
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {field(f, setF)}
        <button className={btn} disabled={!f.name} onClick={() => run(async () => { await send("/api/inventory/items", f); setF(blank); await loadItems(); })}>{t("add")}</button>
        <button className="px-3 py-1 rounded bg-gray-100 text-sm" onClick={() => run(async () => { const r = await send("/api/inventory/items/sync", {}); if (r.error) throw new Error(r.error); await loadItems(); })}>{t("sync")}</button>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-gray-500">{["code", "name", "kind", "category", "unit", "in_pos", "active", ""].map((k) => <th key={k} className="text-start p-2">{t(k)}</th>)}</tr></thead>
        <tbody>{items.map((i) => edit?.id === i.id ? (
          <tr key={i.id} className="border-t"><td colSpan={8} className="p-2 flex flex-wrap gap-2">
            {field(edit as unknown as typeof blank, (v) => setEdit({ ...edit, ...v }))}
            <label className="text-sm"><input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> {t("active")}</label>
            <button className={btn} onClick={() => run(async () => { const r = await send(`/api/inventory/items/${i.id}`, { ...edit, code: edit.code, is_active: String(edit.is_active) } as unknown as Record<string, string>, "PUT"); setEdit(null); await loadItems(); if (r.pos_error) throw new Error(r.pos_error); })}>{t("save")}</button>
          </td></tr>
        ) : (
          <tr key={i.id} className="border-t cursor-pointer hover:bg-gray-50" onClick={() => setEdit(i)}>
            <td className="p-2">{i.code}</td><td className="p-2">{i.name}<div className="text-gray-400" dir="rtl">{i.name_ar}</div></td>
            <td className="p-2">{t(i.kind)}</td><td className="p-2">{t(i.category)}</td><td className="p-2">{i.unit}</td>
            <td className="p-2">{i.in_pos ? "✓" : "—"}</td><td className="p-2">{i.is_active ? "✓" : "—"}</td><td />
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function LinksTab({ t, ar, items, run }: Ctx) {
  const [rows, setRows] = useState<Source[]>([]);
  const [source, setSource] = useState("supplier_item");
  const load = () => apiGet("/api/inventory/sources").then(setRows);
  useEffect(() => { load(); }, []);
  const save = (r: Source, stock_item_id: number | null, factor: number) => run(async () => {
    await send("/api/inventory/sources", { source: r.source, id: String(r.id), stock_item_id: String(stock_item_id || 0), factor: String(factor) }); await load();
  });
  return (
    <div>
      <select className={`${input} mb-3`} value={source} onChange={(e) => setSource(e.target.value)}>
        <option value="supplier_item">{t("supplier_items")}</option><option value="transfer_item">{t("transfer_items")}</option>
      </select>
      <table className="w-full text-sm">
        <thead><tr className="text-gray-500"><th className="text-start p-2">{t("name")}</th><th className="text-start p-2">{t("price")}</th><th className="text-start p-2">{t("items")}</th><th className="text-start p-2">{t("factor")}</th></tr></thead>
        <tbody>{rows.filter((r) => r.source === source).map((r) => {
          const si = items.find((i) => i.id === r.stock_item_id);
          return (
            <tr key={`${r.source}:${r.id}`} className="border-t">
              <td className="p-2">{ar ? r.name_ar || r.name : r.name}<span className="text-gray-400"> {r.unit}{r.group ? ` · ${r.group}` : ""}</span></td>
              <td className="p-2">{f3(r.price)}</td>
              <td className="p-2"><select className={input} value={r.stock_item_id || ""} onChange={(e) => save(r, Number(e.target.value) || null, r.factor)}>
                <option value="">{t("none")}</option>{items.filter((i) => i.is_active).map((i) => <option key={i.id} value={i.id}>{ar ? i.name_ar || i.name : i.name} ({i.unit})</option>)}
              </select></td>
              <td className="p-2"><input className={`${input} w-24`} type="number" min="0.001" step="0.001" defaultValue={r.factor} key={`${r.id}:${r.factor}`} disabled={!si}
                onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && v !== r.factor) save(r, r.stock_item_id, v); }} /> {si?.unit}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function LinesEditor({ t, items, lines, setLines, withCost }: Ctx & { lines: Line[]; setLines: (l: Line[]) => void; withCost?: boolean }) {
  return (
    <div className="space-y-2">
      {lines.map((ln, n) => (
        <div key={n} className="flex gap-2 items-center">
          <select className={input} value={ln.stock_item_id || ""} onChange={(e) => setLines(lines.map((x, i) => (i === n ? { ...x, stock_item_id: Number(e.target.value) } : x)))}>
            <option value="">{t("ingredient")}</option>{items.filter((i) => i.is_active).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
          </select>
          <input className={`${input} w-28`} type="number" step="0.001" placeholder={t("qty")} value={ln.quantity || ""} onChange={(e) => setLines(lines.map((x, i) => (i === n ? { ...x, quantity: Number(e.target.value) } : x)))} />
          {withCost && <input className={`${input} w-28`} type="number" step="0.001" placeholder={t("unit_cost")} value={ln.unit_cost || ""} onChange={(e) => setLines(lines.map((x, i) => (i === n ? { ...x, unit_cost: Number(e.target.value) } : x)))} />}
          <button className="text-red-600" onClick={() => setLines(lines.filter((_, i) => i !== n))}>×</button>
        </div>
      ))}
      <button className="text-blue-600 text-sm" onClick={() => setLines([...lines, { stock_item_id: 0, quantity: 0 }])}>+ {t("add_line")}</button>
    </div>
  );
}

function RecipesTab(ctx: Ctx) {
  const { t, items, itemName, run } = ctx;
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [f, setF] = useState<{ stock_item_id: number; batch_qty: number; lines: Line[] }>({ stock_item_id: 0, batch_qty: 0, lines: [] });
  const load = () => apiGet("/api/inventory/recipes").then(setRecipes);
  useEffect(() => { load(); }, []);
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-3">
        <select className={input} value={f.stock_item_id || ""} onChange={(e) => {
          const id = Number(e.target.value); const r = recipes.find((x) => x.stock_item_id === id);
          setF(r ? { stock_item_id: id, batch_qty: r.batch_qty, lines: r.lines } : { ...f, stock_item_id: id });
        }}>
          <option value="">{t("output")}</option>{items.filter((i) => i.kind === "semi").map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
        </select>
        <div className="flex items-center gap-2 text-sm">{t("makes")} <input className={`${input} w-28`} type="number" step="0.001" value={f.batch_qty || ""} onChange={(e) => setF({ ...f, batch_qty: Number(e.target.value) })} /> {items.find((i) => i.id === f.stock_item_id)?.unit}</div>
        <LinesEditor {...ctx} lines={f.lines} setLines={(lines) => setF({ ...f, lines })} />
        <button className={btn} disabled={!f.stock_item_id || !f.batch_qty} onClick={() => run(async () => {
          await send("/api/inventory/recipes", { stock_item_id: String(f.stock_item_id), batch_qty: String(f.batch_qty), lines: JSON.stringify(f.lines.filter((l) => l.stock_item_id && l.quantity > 0)) });
          await load(); await ctx.loadItems();
        })}>{t("save")}</button>
      </div>
      <div className="space-y-3">{recipes.map((r) => (
        <div key={r.id} className="border rounded p-3 text-sm">
          <div className="font-medium">{itemName(r.stock_item_id)} — {t("makes")} {r.batch_qty}</div>
          <ul className="text-gray-600">{r.lines.map((l, n) => <li key={n}>{itemName(l.stock_item_id)}: {l.quantity}</li>)}</ul>
        </div>
      ))}</div>
    </div>
  );
}

function ProductionTab(ctx: Ctx) {
  const { t, branches, itemName, branchName, run } = ctx;
  const kitchens = branches.filter((b) => b.unit_type === "central_kitchen");
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [rows, setRows] = useState<Production[]>([]);
  const [f, setF] = useState({ branch_id: 0, date: today(), recipe_id: 0, batches: 1, output_qty: 0 });
  const load = () => apiGet("/api/inventory/production").then(setRows);
  useEffect(() => { apiGet("/api/inventory/recipes").then(setRecipes); load(); }, []);
  const branchId = f.branch_id || kitchens[0]?.id || 0;
  const recipe = recipes.find((r) => r.id === f.recipe_id);
  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <select className={input} value={branchId} onChange={(e) => setF({ ...f, branch_id: Number(e.target.value) })}>{kitchens.map((b) => <option key={b.id} value={b.id}>{branchName(b.id)}</option>)}</select>
        <input className={input} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <select className={input} value={f.recipe_id || ""} onChange={(e) => { const r = recipes.find((x) => x.id === Number(e.target.value)); setF({ ...f, recipe_id: Number(e.target.value), output_qty: r ? r.batch_qty * f.batches : 0 }); }}>
          <option value="">{t("output")}</option>{recipes.map((r) => <option key={r.id} value={r.id}>{itemName(r.stock_item_id)}</option>)}
        </select>
        <label className="text-sm">{t("batches")} <input className={`${input} w-20`} type="number" step="0.001" value={f.batches} onChange={(e) => setF({ ...f, batches: Number(e.target.value), output_qty: recipe ? recipe.batch_qty * Number(e.target.value) : f.output_qty })} /></label>
        <label className="text-sm">{t("made")} <input className={`${input} w-24`} type="number" step="0.001" value={f.output_qty || ""} onChange={(e) => setF({ ...f, output_qty: Number(e.target.value) })} /></label>
        <button className={btn} disabled={!f.recipe_id || !f.output_qty || !branchId} onClick={() => run(async () => {
          await send("/api/inventory/production", Object.fromEntries(Object.entries({ ...f, branch_id: branchId }).map(([k, v]) => [k, String(v)]))); await load();
          setTimeout(load, 3000);
        })}>{t("post")}</button>
      </div>
      {recipe && <div className="text-sm text-gray-600 mb-4">{recipe.lines.map((l) => `${itemName(l.stock_item_id)}: ${(l.quantity * f.batches).toFixed(3)}`).join(" · ")}</div>}
      <table className="w-full text-sm">
        <thead><tr className="text-gray-500">{["date", "output", "batches", "expected", "made", "yield", "cost", "unit_cost", "status"].map((k) => <th key={k} className="text-start p-2">{t(k)}</th>)}</tr></thead>
        <tbody>{rows.map((o) => (
          <tr key={o.id} className="border-t">
            <td className="p-2">{o.date}</td><td className="p-2">{itemName(o.stock_item_id)}</td><td className="p-2">{o.batches}</td>
            <td className="p-2">{f3(o.expected_qty)}</td><td className="p-2">{f3(o.output_qty)}</td><td className="p-2">{o.yield_pct == null ? "—" : `${o.yield_pct}%`}</td>
            <td className="p-2">{f3(o.cost)}</td><td className="p-2">{f3(o.unit_cost)}</td><td className="p-2" title={o.error || ""}>{o.status}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function OpeningTab(ctx: Ctx) {
  const { t, branches, branchName, run } = ctx;
  const units = branches.filter((b) => ["sales", "central_store", "central_kitchen"].includes(b.unit_type));
  const [rows, setRows] = useState<{ id: number; branch_id: number; date: string; value: number }[]>([]);
  const [f, setF] = useState<{ branch_id: number; date: string; lines: Line[] }>({ branch_id: 0, date: today(), lines: [] });
  const load = () => apiGet("/api/inventory/opening").then(setRows);
  useEffect(() => { load(); }, []);
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-3">
        <div className="flex gap-2">
          <select className={input} value={f.branch_id || ""} onChange={(e) => setF({ ...f, branch_id: Number(e.target.value) })}><option value="">{t("unit_place")}</option>{units.map((b) => <option key={b.id} value={b.id}>{branchName(b.id)}</option>)}</select>
          <input className={input} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </div>
        <LinesEditor {...ctx} withCost lines={f.lines} setLines={(lines) => setF({ ...f, lines })} />
        <div className="text-sm">{t("value")}: {f3(f.lines.reduce((s, l) => s + l.quantity * (l.unit_cost || 0), 0))}</div>
        <button className={btn} disabled={!f.branch_id || !f.lines.length} onClick={() => run(async () => {
          await send("/api/inventory/opening", { branch_id: String(f.branch_id), date: f.date, lines: JSON.stringify(f.lines.filter((l) => l.stock_item_id && l.quantity > 0)) });
          setF({ ...f, lines: [] }); await load();
        })}>{t("post_opening")}</button>
      </div>
      <table className="w-full text-sm h-fit"><tbody>{rows.map((r) => <tr key={r.id} className="border-t"><td className="p-2">{r.date}</td><td className="p-2">{branchName(r.branch_id)}</td><td className="p-2">{f3(r.value)}</td></tr>)}</tbody></table>
    </div>
  );
}

function BrandPick({ ar, brands, value, set }: { ar: boolean; brands: Ctx["brands"]; value: number; set: (n: number) => void }) {
  return <select className={input} value={value} onChange={(e) => set(Number(e.target.value))}>{brands.map((b) => <option key={b.id} value={b.id}>{ar ? b.name_ar || b.name_en : b.name_en}</option>)}</select>;
}

function DishTab({ t, ar, brands, run }: Ctx) {
  const [picked, setBrand] = useState(0);
  const brand = picked || brands[0]?.id || 0;
  const [rows, setRows] = useState<{ id: string; name: { en: string; ar: string }; category: { en: string; ar: string }; price: number; cost: number; margin: number; food_cost_pct: number | null; has_recipe: boolean; lines: { name: string; name_ar: string; unit: string; quantity: number; cost: number; line_cost: number }[] }[]>([]);
  const [open, setOpen] = useState("");
  useEffect(() => { if (brand) run(async () => { const r = await apiFetch(`/api/inventory/dish-costs?brand_id=${brand}`); const d = await r.json(); if (!r.ok) throw new Error(d.detail); setRows(d.rows); }); }, [brand]); // eslint-disable-line react-hooks/exhaustive-deps
  const loc = (x: { en: string; ar: string }) => (ar ? x.ar || x.en : x.en);
  return (
    <div>
      <div className="mb-2"><BrandPick ar={ar} brands={brands} value={brand} set={setBrand} /></div>
      <p className="text-sm text-gray-500 mb-3">{t("recipe_hint")}</p>
      <table className="w-full text-sm">
        <thead><tr className="text-gray-500">{["name", "category", "price", "cost", "margin", "fc"].map((k) => <th key={k} className="text-start p-2">{t(k)}</th>)}</tr></thead>
        <tbody>{rows.map((r) => (<Fragment key={r.id}>
          <tr className="border-t cursor-pointer hover:bg-gray-50" onClick={() => setOpen(open === r.id ? "" : r.id)}>
            <td className="p-2">{loc(r.name)}</td><td className="p-2">{loc(r.category)}</td><td className="p-2">{f3(r.price)}</td>
            <td className="p-2">{r.has_recipe ? f3(r.cost) : <span className="text-amber-600">{t("no_recipe")}</span>}</td>
            <td className="p-2">{f3(r.margin)}</td><td className={`p-2 ${(r.food_cost_pct || 0) > 35 ? "text-red-600" : ""}`}>{r.has_recipe && r.food_cost_pct != null ? `${r.food_cost_pct}%` : "—"}</td>
          </tr>
          {open === r.id && r.lines.map((l, n) => <tr key={`${r.id}:${n}`} className="text-gray-600 bg-gray-50"><td className="p-1 ps-6" colSpan={2}>{ar ? l.name_ar || l.name : l.name}</td><td className="p-1">{l.quantity} {l.unit}</td><td className="p-1">× {f3(l.cost)}</td><td className="p-1">{f3(l.line_cost)}</td><td /></tr>)}
        </Fragment>))}</tbody>
      </table>
    </div>
  );
}

function UsageTab({ t, ar, brands, run }: Ctx) {
  const [picked, setBrand] = useState(0);
  const brand = picked || brands[0]?.id || 0;
  const first = useMemo(() => today().slice(0, 8) + "01", []);
  const [d1, setD1] = useState(first);
  const [d2, setD2] = useState(today());
  const [rows, setRows] = useState<Record<string, string | number | null>[]>([]);
  const show = () => run(async () => { const r = await apiFetch(`/api/inventory/usage?brand_id=${brand}&date_from=${d1}&date_to=${d2}`); const d = await r.json(); if (!r.ok) throw new Error(d.detail); setRows(d.rows); });
  const cols: [string, string][] = [["sold_qty", "sold"], ["production_qty", "in_prod"], ["expected_qty", "expected"], ["waste_qty", "waste"], ["count_qty", "count"], ["actual_qty", "actual"], ["expected_cost", "expected"], ["variance_cost", "variance"]];
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <BrandPick ar={ar} brands={brands} value={brand} set={setBrand} />
        <label className="text-sm">{t("from")} <input className={input} type="date" value={d1} onChange={(e) => setD1(e.target.value)} /></label>
        <label className="text-sm">{t("to")} <input className={input} type="date" value={d2} onChange={(e) => setD2(e.target.value)} /></label>
        <button className={btn} disabled={!brand} onClick={show}>{t("show")}</button>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-gray-500"><th className="text-start p-2">{t("unit_place")}</th><th className="text-start p-2">{t("ingredient")}</th>
          {cols.map(([k, l]) => <th key={k} className="text-start p-2">{t(l)}{k.endsWith("cost") ? ` (${t("cost")})` : ""}</th>)}<th className="text-start p-2">%</th></tr></thead>
        <tbody>{rows.map((r, n) => (
          <tr key={n} className="border-t">
            <td className="p-2">{ar ? r.branch_ar : r.branch}</td><td className="p-2">{ar ? r.name_ar || r.name : r.name} <span className="text-gray-400">{r.unit}</span></td>
            {cols.map(([k]) => <td key={k} className={`p-2 ${k === "variance_cost" && Number(r[k]) > 0 ? "text-red-600" : ""}`}>{f3(r[k] as number)}</td>)}
            <td className="p-2">{r.variance_pct == null ? "—" : `${r.variance_pct}%`}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
