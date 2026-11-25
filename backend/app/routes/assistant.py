import json
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.assistant import AssistantLog
from app.models.user import User
from app.utils import assistant
from app.utils.auth import get_current_user

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

MAX_AUDIO = 10 * 1024 * 1024


def _scope(db: Session, user: User) -> assistant.Scope:
    try:
        return assistant.Scope(db, user)
    except assistant.NotAllowed as e:
        raise HTTPException(403, str(e))


@router.get("/status")
def status(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        scope = assistant.Scope(db, user)
    except assistant.NotAllowed:
        return {"available": False, "configured": assistant.is_configured(), "reports": []}
    return {"available": bool(scope.reports), "configured": assistant.is_configured(), "reports": sorted(scope.reports)}


@router.post("/ask")
def ask(question: str = Form(...), lang: str = Form("en"), history: str = Form("[]"),
        db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _scope(db, user)
    try:
        past = json.loads(history or "[]")
    except ValueError:
        past = []
    try:
        return assistant.ask(db, user, question, past if isinstance(past, list) else [], lang)
    except assistant.NotAllowed as e:
        raise HTTPException(403, str(e))
    except assistant.AssistantError as e:
        raise HTTPException(502, str(e))


@router.post("/transcribe")
async def transcribe(file: UploadFile = File(...), db: Session = Depends(get_db),
                     user: User = Depends(get_current_user)):
    _scope(db, user)
    data = await file.read()
    if len(data) > MAX_AUDIO:
        raise HTTPException(413, "The voice note is too long")
    try:
        return {"text": assistant.transcribe(data, file.filename, file.content_type)}
    except assistant.AssistantError as e:
        raise HTTPException(502, str(e))


@router.post("/speech")
def speech(text: str = Form(...), lang: str = Form("en"), db: Session = Depends(get_db),
           user: User = Depends(get_current_user)):
    _scope(db, user)
    try:
        return Response(assistant.speech(text, lang), media_type="audio/mpeg")
    except assistant.AssistantError as e:
        raise HTTPException(502, str(e))


@router.get("/logs")
def logs(limit: int = 100, user_id: Optional[int] = None, db: Session = Depends(get_db),
         user: User = Depends(get_current_user)):
    if user.role not in ("owner", "admin"):
        raise HTTPException(403, "Only the owner can see the assistant log")
    q = db.query(AssistantLog, User.full_name).outerjoin(User, User.id == AssistantLog.user_id)
    if user_id:
        q = q.filter(AssistantLog.user_id == user_id)
    return [{"id": a.id, "user": name, "channel": a.channel, "question": a.question, "answer": a.answer,
             "reports": json.loads(a.reports or "[]"), "error": a.error, "created_at": a.created_at}
            for a, name in q.order_by(AssistantLog.id.desc()).limit(min(limit, 500)).all()]
