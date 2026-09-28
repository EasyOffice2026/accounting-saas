"""Extract purchase-invoice data from a photo / PDF / screenshot with an OpenAI vision model.

Returns a plain dict the Purchase Office order form can pre-fill; nothing is booked here.
"""
import base64
import difflib
import json
import os
import re
from typing import Optional

import httpx

OPENAI_MODEL = os.environ.get("INVOICE_SCAN_MODEL", "gpt-4o")
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
MAX_PAGES = 3
PDF_DPI = 130

PROMPT = """You read supplier invoices from Kuwait (Arabic and/or English, printed or handwritten, sometimes photographed at an angle).
Extract the data as JSON only, no commentary, using exactly this schema:
{
  "supplier_name": string,          // supplier / seller company name as printed (English if available, else Arabic)
  "supplier_name_ar": string,       // Arabic supplier name if printed, else ""
  "invoice_number": string,
  "invoice_date": "YYYY-MM-DD" or "",
  "due_date": "YYYY-MM-DD" or "",
  "payment_type": "cash" | "credit" | "",   // credit if marked credit / unpaid / غير مدفوع / آجل, cash if cash / paid / نقدي
  "customer_name": string,          // the buyer as printed
  "currency": string,               // KWD unless clearly otherwise
  "lines": [
    {"item_code": string, "description": string, "description_ar": string, "unit": string,
     "quantity": number, "unit_price": number, "amount": number}
  ],
  "discount": number,
  "total": number,                  // final net total payable
  "handwritten": boolean,           // true if key figures are handwritten
  "notes": string                   // anything uncertain / unreadable, briefly
}
Rules: amounts are in KD with 3 decimals (e.g. 6.250). Dates printed as DD/MM/YYYY. If a line has weight (kg) as quantity use kg as unit.
Use the printed amount column for "amount" even if quantity*price differs. Leave unknown fields as "" or 0. Never invent lines."""


class ScanNotConfigured(Exception):
    pass


class ScanFailed(Exception):
    pass


def is_configured() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY"))


def _pdf_to_images(data: bytes) -> list[bytes]:
    import pymupdf  # lazy: only needed for PDF uploads

    doc = pymupdf.open(stream=data, filetype="pdf")
    out = []
    for page in doc:
        if len(out) >= MAX_PAGES:
            break
        out.append(page.get_pixmap(dpi=PDF_DPI).tobytes("png"))
    return out


def _image_parts(data: bytes, content_type: str, filename: str) -> list[dict]:
    is_pdf = content_type == "application/pdf" or filename.lower().endswith(".pdf")
    if is_pdf:
        images = [(img, "image/png") for img in _pdf_to_images(data)]
    else:
        mime = content_type if content_type.startswith("image/") else "image/jpeg"
        images = [(data, mime)]
    return [
        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(b).decode()}", "detail": "high"}}
        for b, mime in images
    ]


def _num(v) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d.\-]", "", str(v or "").replace("٫", ".").replace(",", ""))
    try:
        return float(s) if s else 0.0
    except ValueError:
        return 0.0


def _iso_date(v) -> str:
    s = str(v or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s
    m = re.fullmatch(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})", s)
    if m:
        d, mo, y = m.groups()
        y = y if len(y) == 4 else f"20{y}"
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    return ""


def _normalize(raw: dict) -> dict:
    lines = []
    for l in raw.get("lines") or []:
        qty = _num(l.get("quantity"))
        price = _num(l.get("unit_price"))
        amount = _num(l.get("amount"))
        if qty <= 0 and amount > 0 and price > 0:
            qty = round(amount / price, 3)
        if price <= 0 and qty > 0 and amount > 0:
            price = round(amount / qty, 3)
        if amount <= 0:
            amount = round(qty * price, 3)
        desc = str(l.get("description") or "").strip()
        desc_ar = str(l.get("description_ar") or "").strip()
        if not desc and not desc_ar:
            continue
        lines.append({
            "item_code": str(l.get("item_code") or "").strip(),
            "description": desc or desc_ar,
            "description_ar": desc_ar,
            "unit": (str(l.get("unit") or "").strip() or "pcs")[:20],
            "quantity": qty,
            "unit_price": price,
            "amount": amount,
        })
    total = _num(raw.get("total"))
    lines_sum = round(sum(l["amount"] for l in lines), 3)
    if total <= 0:
        total = lines_sum
    payment = str(raw.get("payment_type") or "").lower()
    return {
        "supplier_name": str(raw.get("supplier_name") or "").strip(),
        "supplier_name_ar": str(raw.get("supplier_name_ar") or "").strip(),
        "invoice_number": str(raw.get("invoice_number") or "").strip(),
        "invoice_date": _iso_date(raw.get("invoice_date")),
        "due_date": _iso_date(raw.get("due_date")),
        "payment_type": payment if payment in ("cash", "credit") else "",
        "customer_name": str(raw.get("customer_name") or "").strip(),
        "lines": lines,
        "discount": _num(raw.get("discount")),
        "total": total,
        "lines_total": lines_sum,
        "total_mismatch": abs(lines_sum - _num(raw.get("discount")) - total) > 0.005 if total else False,
        "handwritten": bool(raw.get("handwritten")),
        "notes": str(raw.get("notes") or "").strip(),
    }


def extract_invoice(data: bytes, content_type: str, filename: str) -> dict:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise ScanNotConfigured()
    parts = _image_parts(data, content_type or "", filename or "")
    if not parts:
        raise ScanFailed("Unsupported file")
    body = {
        "model": OPENAI_MODEL,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": PROMPT},
            {"role": "user", "content": [{"type": "text", "text": "Extract this invoice."}] + parts},
        ],
    }
    try:
        r = httpx.post(OPENAI_URL, json=body, timeout=90,
                       headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    except httpx.HTTPError as e:
        raise ScanFailed(f"AI service unreachable: {e}")
    if r.status_code != 200:
        try:
            msg = r.json()["error"]["message"]
        except (ValueError, KeyError, TypeError):
            msg = r.text[:200]
        if r.status_code == 429 and ("credit" in msg.lower() or "quota" in msg.lower()):
            raise ScanFailed("AI account has no credits — please top up the OpenAI billing account")
        if r.status_code == 401:
            raise ScanFailed("AI key rejected — please check the OpenAI API key")
        raise ScanFailed(f"AI service error {r.status_code}: {msg}")
    try:
        content = r.json()["choices"][0]["message"]["content"]
        raw = json.loads(content)
    except (KeyError, IndexError, ValueError):
        raise ScanFailed("AI returned an unreadable answer")
    return _normalize(raw)


def _norm_text(s: str) -> str:
    s = re.sub(r"[^\w\s]", " ", (s or "").lower())
    s = re.sub(r"\b(co|company|trading|trad|est|wll|w\.l\.l|general|gen|llc|ltd|the|for|and|of|شركة|مؤسسة|التجارية|العامة)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def best_match(name: str, candidates: list[tuple[int, str]], cutoff: float = 0.6) -> Optional[tuple[int, float]]:
    """Fuzzy-match `name` against (id, label) pairs; returns (id, score) or None."""
    target = _norm_text(name)
    if not target:
        return None
    best: Optional[tuple[int, float]] = None
    for cid, label in candidates:
        cand = _norm_text(label)
        if not cand:
            continue
        score = difflib.SequenceMatcher(None, target, cand).ratio()
        if target in cand or cand in target:
            score = max(score, 0.85)
        if best is None or score > best[1]:
            best = (cid, score)
    return best if best and best[1] >= cutoff else None
