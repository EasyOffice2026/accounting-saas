import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet } from "../contexts/api";

export interface PaymentChannel {
  id: number; brand_id: number | null; name: string; name_ar: string | null;
  kind: string; account_no: string | null; opening_balance: number;
  opening_date: string | null; is_active: boolean; balance?: number;
}

/** Payment channels are deducted only for transactions dated on/after this day. */
export const CHANNEL_START_DATE = "2026-10-01";

/** Payment methods that are settled from a bank / card / KNET channel (never from a cash box). */
export const CHANNEL_METHODS = [
  "bank_transfer", "knet", "cheque", "card",
  "personnel_bank_transfer", "personnel_knet",
];

export function needsChannel(method: string) {
  return CHANNEL_METHODS.includes(method);
}

export function channelLabel(ch: PaymentChannel | undefined, lang: string) {
  if (!ch) return "";
  const name = lang === "ar" ? ch.name_ar || ch.name : ch.name;
  return ch.account_no ? `${name} (${ch.account_no})` : name;
}

export function useChannels(activeOnly = true) {
  const [channels, setChannels] = useState<PaymentChannel[]>([]);
  const reload = () =>
    apiGet(`/api/payment-channels/${activeOnly ? "?active_only=true" : ""}`)
      .then((rows: PaymentChannel[]) => setChannels(Array.isArray(rows) ? rows : []))
      .catch(() => setChannels([]));
  useEffect(() => { reload(); }, [activeOnly]);
  return { channels, reload };
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  method: string;
  date?: string;
  channels?: PaymentChannel[];
  className?: string;
  required?: boolean;
  name?: string;
  label?: string;
}

/** Channel picker shown next to a payment-method select whenever the method is a non-cash one. */
export default function ChannelSelect({ value, onChange, method, date, channels, className, required, name, label }: Props) {
  const { t, i18n } = useTranslation();
  const own = useChannels();
  const list = channels ?? own.channels;
  if (!needsChannel(method)) return null;
  const before = !!date && date < CHANNEL_START_DATE;
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label || t("paid_from_channel")}</label>
      <select name={name} value={value} onChange={e => onChange(e.target.value)} required={required && !before}
        className={className || "w-full px-3 py-2 border rounded-lg text-sm"}>
        <option value="">{before ? t("channel_not_applicable") : t("select_channel")}</option>
        {list.map(c => (
          <option key={c.id} value={c.id}>{channelLabel(c, i18n.language)}</option>
        ))}
      </select>
      {before && <p className="text-[10px] text-gray-400 mt-0.5">{t("channel_before_start")}</p>}
    </div>
  );
}
