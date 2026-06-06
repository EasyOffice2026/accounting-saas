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


def _branch_map_ar(db: Session):
    return {b.id: (b.name_ar or b.name) for b in db.query(Branch).all()}


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


def _excel_response(header: List[str], data: List[list], filename: str, summary_rows: int = 0):
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

    # Summary row styles
    total_font = Font(bold=True, color="FFFFFF", size=11)
    total_fill = PatternFill(start_color="1B5E20", end_color="1B5E20", fill_type="solid")
    payable_font = Font(bold=True, color="2E7D32", size=11)
    payable_fill = PatternFill(start_color="E8F5E9", end_color="E8F5E9", fill_type="solid")
    hold_font = Font(bold=True, color="C62828", size=11)
    hold_fill = PatternFill(start_color="FFEBEE", end_color="FFEBEE", fill_type="solid")

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

    # Style summary rows
    if summary_rows > 0 and len(data) >= summary_rows:
        total_row_idx = len(data) - summary_rows + 2  # +2 for header row + 1-based
        for col_idx in range(1, len(header) + 1):
            cell = ws.cell(row=total_row_idx, column=col_idx)
            cell.font = total_font
            cell.fill = total_fill
        if summary_rows >= 2:
            payable_row_idx = total_row_idx + 1
            for col_idx in range(1, len(header) + 1):
                cell = ws.cell(row=payable_row_idx, column=col_idx)
                cell.font = payable_font
                cell.fill = payable_fill
        if summary_rows >= 3:
            hold_row_idx = total_row_idx + 2
            for col_idx in range(1, len(header) + 1):
                cell = ws.cell(row=hold_row_idx, column=col_idx)
                cell.font = hold_font
                cell.fill = hold_fill

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


def _pdf_response(header: List[str], data: List[list], filename: str, title: str = "", summary_rows: int = 0):
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
    style_cmds = [
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
    ]

    # Highlight summary rows at the bottom
    if summary_rows > 0 and len(table_data) > summary_rows:
        total_row = len(table_data) - summary_rows  # first summary row (TOTAL)
        # TOTAL row styling
        style_cmds.append(("BACKGROUND", (0, total_row), (-1, total_row), colors.HexColor("#1B5E20")))
        style_cmds.append(("TEXTCOLOR", (0, total_row), (-1, total_row), colors.white))
        style_cmds.append(("FONTSIZE", (0, total_row), (-1, total_row), 8))
        # PAYABLE row styling
        if summary_rows >= 2:
            payable_row = total_row + 1
            style_cmds.append(("BACKGROUND", (0, payable_row), (-1, payable_row), colors.HexColor("#E8F5E9")))
            style_cmds.append(("TEXTCOLOR", (0, payable_row), (-1, payable_row), colors.HexColor("#2E7D32")))
            style_cmds.append(("FONTSIZE", (0, payable_row), (-1, payable_row), 8))
        # ON HOLD row styling
        if summary_rows >= 3:
            hold_row = total_row + 2
            style_cmds.append(("BACKGROUND", (0, hold_row), (-1, hold_row), colors.HexColor("#FFEBEE")))
            style_cmds.append(("TEXTCOLOR", (0, hold_row), (-1, hold_row), colors.HexColor("#C62828")))
            style_cmds.append(("FONTSIZE", (0, hold_row), (-1, hold_row), 8))

    t.setStyle(TableStyle(style_cmds))
    elements.append(t)

    doc.build(elements)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}.pdf"},
    )


def _respond(fmt: str, header: List[str], data: List[list], filename: str, title: str = "", summary_rows: int = 0):
    if fmt == "excel":
        return _excel_response(header, data, filename, summary_rows=summary_rows)
    elif fmt == "pdf":
        return _pdf_response(header, data, filename, title, summary_rows=summary_rows)
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


def _salary_data(db, user, month, lang: str = "en"):
    is_ar = lang == "ar"
    bmap = _branch_map_ar(db) if is_ar else _branch_map(db)
    emp_map = {e.id: e for e in db.query(Employee).all()}
    q = db.query(SalaryPayment)
    if month:
        q = q.filter(SalaryPayment.month == month)
    rows = q.order_by(SalaryPayment.month.desc()).all()
    if is_ar:
        header = ["الشهر", "رقم الموظف", "الاسم", "المنصب", "الفرع", "أيام العمل",
                  "الراتب الأساسي", "حافز", "مكافأة", "راتب الإجازة", "تذكرة", "عمل إضافي",
                  "إجمالي البدلات", "خصم الغياب", "خصم القرض", "الغرامة",
                  "خصم آخر", "إجمالي الخصومات", "صافي الراتب", "طريقة الدفع", "الحالة"]
    else:
        header = ["Month", "Staff No.", "Name", "Position", "Branch", "Days Worked",
                  "Basic Salary", "Incentive", "Bonus", "Leave Salary", "Ticket", "Overtime",
                  "Total Allowances", "Absence Deduction", "Loan Deduction", "Penalty",
                  "Other Deduction", "Total Deductions", "Net Salary", "Payment Method", "Status"]
    data = []
    # Accumulators for totals
    sum_basic = 0
    sum_incentive = 0
    sum_bonus = 0
    sum_leave_salary = 0
    sum_ticket = 0
    sum_overtime = 0
    sum_allowances = 0
    sum_absence_ded = 0
    sum_loan_ded = 0
    sum_penalty = 0
    sum_other_ded = 0
    sum_deductions = 0
    sum_net = 0
    sum_on_hold = 0
    sum_payable = 0
    for r in rows:
        emp = emp_map.get(r.employee_id)
        incentive = r.incentive or 0
        bonus = r.bonus or 0
        leave_sal = r.leave_salary or 0
        ticket = r.ticket_payment or 0
        overtime = r.overtime or 0
        allowances = r.allowances or 0
        absence_ded = r.absence_deduction or 0
        loan_ded = r.loan_deduction or 0
        penalty = r.penalty or 0
        other_ded = r.other_deduction or 0
        deductions = r.deductions or 0
        net = r.net_salary or 0
        emp_name = ""
        if emp:
            emp_name = (emp.name_ar or emp.name) if is_ar else emp.name
        data.append([
            r.month, emp.staff_no if emp else "", emp_name,
            emp.position if emp else "", bmap.get(emp.branch_id, "") if emp else "",
            r.days_worked or 30, r.basic_salary,
            incentive, bonus, leave_sal, ticket, overtime,
            allowances, absence_ded, loan_ded, penalty,
            other_ded, deductions, net,
            r.payment_method or "", r.status,
        ])
        sum_basic += r.basic_salary or 0
        sum_incentive += incentive
        sum_bonus += bonus
        sum_leave_salary += leave_sal
        sum_ticket += ticket
        sum_overtime += overtime
        sum_allowances += allowances
        sum_absence_ded += absence_ded
        sum_loan_ded += loan_ded
        sum_penalty += penalty
        sum_other_ded += other_ded
        sum_deductions += deductions
        sum_net += net
        if r.status == "on_hold":
            sum_on_hold += net
        elif r.status == "pending":
            sum_payable += net

    # Append totals row
    total_label = "الإجمالي" if is_ar else "TOTAL / الإجمالي"
    payable_label = "المستحق الدفع" if is_ar else "PAYABLE / المستحق الدفع"
    hold_label = "معلق" if is_ar else "ON HOLD / معلق"
    if data:
        data.append([
            "", "", total_label, "", "", "",
            round(sum_basic, 3),
            round(sum_incentive, 3), round(sum_bonus, 3),
            round(sum_leave_salary, 3), round(sum_ticket, 3), round(sum_overtime, 3),
            round(sum_allowances, 3),
            round(sum_absence_ded, 3), round(sum_loan_ded, 3), round(sum_penalty, 3),
            round(sum_other_ded, 3), round(sum_deductions, 3), round(sum_net, 3),
            "", "",
        ])
        # Append on-hold and payable summary rows
        data.append([
            "", "", payable_label, "", "", "",
            "", "", "", "", "", "",
            "", "", "", "", "", "", round(sum_payable, 3),
            "", "pending",
        ])
        data.append([
            "", "", hold_label, "", "", "",
            "", "", "", "", "", "",
            "", "", "", "", "", "", round(sum_on_hold, 3),
            "", "on_hold",
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
def export_salary(fmt: str, month: Optional[str] = None, lang: Optional[str] = None,
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="Not authorized")
    language = lang or "en"
    header, data = _salary_data(db, user, month, lang=language)
    title = f"كشف الرواتب - {month or 'الكل'}" if language == "ar" else f"Salary Sheet - {month or 'All'}"
    return _respond(fmt, header, data, f"salary_{month or 'all'}", title, summary_rows=3)
