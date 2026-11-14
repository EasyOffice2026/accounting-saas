from datetime import date, datetime, timedelta, timezone

from sqlalchemy import event
from sqlalchemy.orm import Session, with_loader_criteria

from app.models.cash import CashBalance, CashTransaction
from app.models.channel import ChannelTransaction
from app.models.expense import Expense
from app.models.hr import AdvanceLoan, Attendance, ContractPayment, LeaveRecord, LoanRepayment, SalaryPayment, StaffBenefitDeduction
from app.models.proceeds import ProceedsReceipt
from app.models.procurement import ProcInvoice, ProcOrder, ProcPayment
from app.models.purchase import DeliveryOrder, Invoice, PurchaseOrder, ReceivingOrder
from app.models.renewal import RenewalRequest
from app.models.sale import Sale, SaleReturn
from app.models.transfer import TransferOrder

KUWAIT = timezone(timedelta(hours=3))
DATED = (Sale, SaleReturn, PurchaseOrder, ReceivingOrder, Invoice, DeliveryOrder, Expense, CashTransaction, CashBalance,
         ChannelTransaction, Attendance, AdvanceLoan, LoanRepayment, StaffBenefitDeduction, ProceedsReceipt, ProcOrder,
         ProcInvoice, ProcPayment, TransferOrder)
SCOPE_KEY = "min_date"


def current_month_start() -> date:
    return datetime.now(KUWAIT).date().replace(day=1)


def limit_to_current_month(db: Session):
    db.info[SCOPE_KEY] = current_month_start()


@event.listens_for(Session, "do_orm_execute")
def _apply_month_scope(state):
    start = state.session.info.get(SCOPE_KEY)
    if start is None or not state.is_select:
        return
    since = datetime(start.year, start.month, 1) - timedelta(hours=3)
    opts = [with_loader_criteria(m, m.date >= start, include_aliases=True) for m in DATED]
    opts += [
        with_loader_criteria(SalaryPayment, SalaryPayment.month >= start.strftime("%Y-%m"), include_aliases=True),
        with_loader_criteria(LeaveRecord, LeaveRecord.end_date >= start, include_aliases=True),
        with_loader_criteria(ContractPayment, ContractPayment.due_date >= start, include_aliases=True),
        with_loader_criteria(RenewalRequest, RenewalRequest.requested_at >= since, include_aliases=True),
    ]
    state.statement = state.statement.options(*opts)
