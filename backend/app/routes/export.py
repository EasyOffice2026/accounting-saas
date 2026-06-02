from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional, List
import io, csv

from app.database import get_db
from app.models.sale import Sale
from app.models.purchase import PurchaseOrder
from app.models.expense import Expense
from app.models.hr import Employee, SalaryPayment
from app.models.cash import CashBalance
from app.models.branch import Branch
from app.utils.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/api/export", tags=["export"])

channels = ["cash", "knet", "link", "talabat", "keeta", "jahez"]


def _branch_map(db: Session):
    return {b.id: b.name for b in db.query(Branch).all()}


# ── helpers for CSV / Excel / PDF ────────────────────────────────────

def _csv_response(header: List[str], data: List[list], filename: str):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(header)
    for row in data:
        writer.writerow(row)
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}.csv"},
    )


def _excel_response(header: List[str], data: List[list], filename: str):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    wb = Workbook()
    ws = wb.active
    ws.title = filename

    # Header style
    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="2E7D32", end_color="2E7D32", fill_type="solid")
    header_align = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style="thin"), right=Side(style="thin"),
        top=Side(style="thin"), bottom=Side(style="thin"),
    )

    for col_idx, h in enumerate(header, 1):
        cell = ws.cell(row=1, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_align
        cell.border = thin_border

    for row_idx, row in enumerate(data, 2):
        for col_idx, val in enumerate(row, 1):
            cell = ws.cell(row=row_idx, column=col_idx, value=val)
            cell.border = thin_border

    # Auto-width
    for col_idx, h in enumerate(header, 1):
        max_len = len(str(h))
        for row in data:
            if col_idx - 1 < len(row):
                max_len = max(max_len, len(str(row[col_idx - 1])))
        ws.column_dimensions[ws.cell(row=1, column=col_idx).column_letter].width = min(max_len + 3, 40)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}.xlsx"},
    )


def _pdf_response(header: List[str], data: List[list], filename: str, title: str = ""):
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    buf = io.BytesIO()
    page_size = landscape(A4) if len(header) > 8 else A4
    doc = SimpleDocTemplate(buf, pagesize=page_size,
                            leftMargin=10 * mm, rightMargin=10 * mm,
                            topMargin=15 * mm, bottomMargin=15 * mm)

    styles = getSampleStyleSheet()
    elements = []

    if title:
        title_style = ParagraphStyle("title", parent=styles["Title"], fontSize=14, spaceAfter=10)
        elements.append(Paragraph(title, title_style))
        elements.append(Spacer(1, 5 * mm))

    # Truncate long strings for PDF
    def trunc(val, max_len=25):
        s = str(val) if val is not None else ""
        return s[:max_len] + ".." if len(s) > max_len else s

    table_data = [header]
    for row in data:
        table_data.append([trunc(v) for v in row])

    if not table_data or len(table_data) < 2:
        table_data.append(["No data"] + [""] * (len(header) - 1))

    num_cols = len(header)
    avail_width = page_size[0] - 20 * mm
    col_width = avail_width / num_cols

    t = Table(table_data, colWidths=[col_width] * num_cols, repeatRows=1)
    style = TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2E7D32")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("FONTSIZE", (0, 1), (-1, -1), 7),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F5F5")]),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ])
    t.setStyle(style)
    elements.append(t)

    doc.build(elements)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}.pdf"},
    )


def _respond(fmt: str, header: List[str], data: List[list], filename: str, title: str = ""):
    if fmt == "excel":
        return _excel_response(header, data, filename)
    elif fmt == "pdf":
        return _pdf_response(header, data, filename, title)
    return _csv_response(header, data, filename)


# ── Data extraction helpers ─────────────────────────────────────────

def _sales_data(db, user, branch_id):
    bmap = _branch_map(db)
    q = db.query(Sale)
    if branch_id:
        q = q.filter(Sale.branch_id == branch_id)
    elif user.role == "staff" and user.branch_id:
        q = q.filter(Sale.branch_id == user.branch_id)
    rows = q.order_by(Sale.date.desc()).all()

    header = ["Date", "Branch"]
    for prefix in ["Foodics", "Physical"]:
        for ch in channels:
            header.append(f"{prefix} {ch.title()}")
        header.append(f"{prefix} Total")
    header.append("Difference")

    data = []
    for r in rows:
        row = [str(r.date), bmap.get(r.branch_id, "")]
        for prefix in ["foodics", "physical"]:
            total = 0
            for ch in channels:
                val = getattr(r, f"{prefix}_{ch}", 0) or 0
                row.append(val)
                total += val
            row.append(total)
        f_total = sum(getattr(r, f"foodics_{ch}", 0) or 0 for ch in channels)
        p_total = sum(getattr(r, f"physical_{ch}", 0) or 0 for ch in channels)
        row.append(p_total - f_total)
        data.append(row)
    return header, data


def _purchases_data(db, user, branch_id):
    bmap = _branch_map(db)
    q = db.query(PurchaseOrder)
    if branch_id:
        q = q.filter(PurchaseOrder.branch_id == branch_id)
    elif user.role == "staff" and user.branch_id:
        q = q.filter(PurchaseOrder.branch_id == user.branch_id)
    rows = q.order_by(PurchaseOrder.date.desc()).all()
    header = ["Date", "Branch", "Supplier ID", "Payment Type", "Total Amount", "Status", "Notes"]
    data = [[str(r.date), bmap.get(r.branch_id, ""), r.supplier_id,
             r.payment_type, r.total_amount, r.status, r.notes or ""] for r in rows]
    return header, data


def _expenses_data(db, user, branch_id):
    bmap = _branch_map(db)
    q = db.query(Expense)
    if branch_id:
        q = q.filter(Expense.branch_id == branch_id)
    elif user.role == "staff" and user.branch_id:
        q = q.filter(Expense.branch_id == user.branch_id)
    rows = q.order_by(Expense.date.desc()).all()
    header = ["Date", "Branch", "Description", "Amount", "Payment Method", "Notes"]
    data = [[str(r.date), bmap.get(r.branch_id, ""), r.description,
             r.amount, r.payment_method, r.notes or ""] for r in rows]
    return header, data


def _hr_data(db, user, branch_id):
    bmap = _branch_map(db)
    q = db.query(Employee)
    if branch_id:
        q = q.filter(Employee.branch_id == branch_id)
    elif user.role == "staff" and user.branch_id:
        q = q.filter(Employee.branch_id == user.branch_id)
    rows = q.order_by(Employee.name).all()
    header = ["Staff No.", "Name", "Name (AR)", "Branch", "Civil ID", "Position", "Phone",
              "Employer", "Work Permit Salary", "Actual Salary", "Salary Transfer", "IBAN", "Bank",
              "Join Date", "Active"]
    data = [[r.staff_no or "", r.name, r.name_ar or "", bmap.get(r.branch_id, ""), r.civil_id or "",
             r.position or "", r.phone or "", r.employer or "",
             r.work_permit_salary or 0, r.actual_salary or 0,
             r.salary_transfer_method or "", r.iban or "", r.bank_name or "",
             str(r.join_date) if r.join_date else "", "Yes" if r.is_active else "No"] for r in rows]
    return header, data


def _cash_data(db, user, branch_id):
    bmap = _branch_map(db)
    q = db.query(CashBalance)
    if branch_id:
        q = q.filter(CashBalance.branch_id == branch_id)
    rows = q.order_by(CashBalance.date.desc()).all()
    header = ["Date", "Branch", "Opening Balance", "Cash Sales", "Petty Cash In",
              "Cash Purchases", "Cash Expenses", "Cash Withdrawn", "Deposited", "Closing Balance"]
    data = [[str(r.date), bmap.get(r.branch_id, ""), r.opening_balance, r.cash_sales,
             r.petty_cash_in, r.cash_purchases, r.cash_expenses, r.cash_withdrawn,
             r.deposited, r.closing_balance] for r in rows]
    return header, data


def _salary_data(db, user, month):
    bmap = _branch_map(db)
    emp_map = {e.id: e for e in db.query(Employee).all()}
    q = db.query(SalaryPayment)
    if month:
        q = q.filter(SalaryPayment.month == month)
    rows = q.order_by(SalaryPayment.month.desc()).all()
    header = ["Month", "Staff No.", "Name", "Position", "Branch", "Days Worked",
              "Basic Salary", "Incentive", "Bonus", "Leave Salary", "Ticket", "Overtime",
              "Total Allowances", "Absence Deduction", "Loan Deduction", "Penalty",
              "Other Deduction", "Total Deductions", "Net Salary", "Payment Method", "Status"]
    data = []
    for r in rows:
        emp = emp_map.get(r.employee_id)
        data.append([
            r.month, emp.staff_no if emp else "", emp.name if emp else "",
            emp.position if emp else "", bmap.get(emp.branch_id, "") if emp else "",
            r.days_worked or 30, r.basic_salary,
            r.incentive or 0, r.bonus or 0, r.leave_salary or 0, r.ticket_payment or 0, r.overtime or 0,
            r.allowances or 0, r.absence_deduction or 0, r.loan_deduction or 0, r.penalty or 0,
            r.other_deduction or 0, r.deductions or 0, r.net_salary,
            r.payment_method or "", r.status,
        ])
    return header, data


# ── Unified endpoints: /api/export/{module}/{format} ────────────────

@router.get("/sales/{fmt}")
def export_sales(fmt: str, branch_id: Optional[int] = None,
                 db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    header, data = _sales_data(db, user, branch_id)
    return _respond(fmt, header, data, "sales", "Sales Report")


@router.get("/purchases/{fmt}")
def export_purchases(fmt: str, branch_id: Optional[int] = None,
                     db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    header, data = _purchases_data(db, user, branch_id)
    return _respond(fmt, header, data, "purchases", "Purchases Report")


@router.get("/expenses/{fmt}")
def export_expenses(fmt: str, branch_id: Optional[int] = None,
                    db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    header, data = _expenses_data(db, user, branch_id)
    return _respond(fmt, header, data, "expenses", "Expenses Report")


@router.get("/hr/{fmt}")
def export_hr(fmt: str, branch_id: Optional[int] = None,
              db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    header, data = _hr_data(db, user, branch_id)
    return _respond(fmt, header, data, "employees", "Employees Report")


@router.get("/cash/{fmt}")
def export_cash(fmt: str, branch_id: Optional[int] = None,
                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    header, data = _cash_data(db, user, branch_id)
    return _respond(fmt, header, data, "cash_management", "Cash Management Report")


@router.get("/salary/{fmt}")
def export_salary(fmt: str, month: Optional[str] = None,
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="Not authorized")
    header, data = _salary_data(db, user, month)
    return _respond(fmt, header, data, f"salary_{month or 'all'}", f"Salary Sheet - {month or 'All'}")
