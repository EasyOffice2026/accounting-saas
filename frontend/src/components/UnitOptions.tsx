import { useTranslation } from "react-i18next";

// Branch <option>s in two layers: sales units, then administrative units (Administration first, as it takes
// the combined costs that belong to no single unit).
interface Unit { id: number; name: string; name_ar?: string | null; unit_type?: string | null }

const ADMIN_ORDER = ["administration", "accounts_office", "purchase_office", "hr_office", "personnel_office", "central_store", "central_kitchen"];

function layerOf(u: Unit): "sales" | "administrative" {
  return (u.unit_type || "sales") === "sales" ? "sales" : "administrative";
}

export default function UnitOptions({ units }: { units: Unit[] }) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language === "ar";
  const name = (u: Unit) => (ar ? u.name_ar || u.name : u.name);
  const sales = units.filter((u) => layerOf(u) === "sales");
  const admin = units.filter((u) => layerOf(u) === "administrative")
    .sort((a, b) => ADMIN_ORDER.indexOf(a.unit_type || "") - ADMIN_ORDER.indexOf(b.unit_type || ""));
  if (!sales.length || !admin.length) {
    return <>{units.map((u) => <option key={u.id} value={u.id}>{name(u)}</option>)}</>;
  }
  return (
    <>
      <optgroup label={t("layer_sales")}>{sales.map((u) => <option key={u.id} value={u.id}>{name(u)}</option>)}</optgroup>
      <optgroup label={t("layer_administrative")}>
        {admin.map((u) => (
          <option key={u.id} value={u.id}>{name(u)}{u.unit_type === "administration" ? ` — ${t("combined_costs")}` : ""}</option>
        ))}
      </optgroup>
    </>
  );
}
