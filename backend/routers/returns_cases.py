from __future__ import annotations
from config import env_get
import html, mimetypes, os, re, uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from core import db, logger
from ledger import ledger_record
from maker_auth import current_admin, current_buyer, current_maker_slug

router = APIRouter()
CASE_TYPES = {"return_request":"Return request","damaged":"Item arrived damaged","not_as_described":"Item differs materially from listing","wrong_item":"Wrong item received","missing_item":"Missing item","not_received":"Package not received","late":"Arrived too late","replacement_request":"Replacement request","digital_inaccessible":"Digital file inaccessible","digital_corrupted":"Digital file corrupted","duplicate_digital_purchase":"Duplicate digital purchase","other":"Other order problem","stripe_dispute":"Stripe dispute","paypal_dispute":"PayPal dispute"}
REQUESTED_RESOLUTIONS = {"full_refund":"Full refund","partial_refund":"Partial refund","return_for_refund":"Return for refund","replacement":"Replacement","missing_item_shipment":"Missing-item shipment","digital_support":"Digital download assistance","other":"Other resolution"}
TERMINAL = {"refund_completed","resolved","denied","closed"}
TRANSITIONS = {"waiting_for_maker":{"waiting_for_buyer","return_approved","refund_pending","replacement_approved","under_admin_review","denied","closed"},"waiting_for_buyer":{"waiting_for_maker","return_in_transit","under_admin_review","closed"},"return_approved":{"return_in_transit","item_received","refund_pending","under_admin_review","closed"},"return_in_transit":{"item_received","under_admin_review","closed"},"item_received":{"refund_pending","resolved","under_admin_review","closed"},"refund_pending":{"refund_completed","under_admin_review","closed"},"refund_completed":{"resolved","closed"},"replacement_approved":{"replacement_in_progress","replacement_shipped","under_admin_review","closed"},"replacement_in_progress":{"replacement_shipped","under_admin_review","closed"},"replacement_shipped":{"resolved","under_admin_review","closed"},"under_admin_review":{"waiting_for_maker","waiting_for_buyer","return_approved","refund_pending","replacement_approved","resolved","denied","closed"},"denied":{"under_admin_review","closed"},"closed":{"waiting_for_maker","under_admin_review"},"payment_dispute_open":{"under_admin_review","refund_pending","resolved","closed"},"open":{"waiting_for_maker","waiting_for_buyer","return_approved","refund_pending","replacement_approved","under_admin_review","denied","closed"}}
ATTACH_TYPES={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","application/pdf":"pdf"}
MAX_BYTES=int(env_get("CASE_ATTACHMENT_MAX_BYTES",str(10*1024*1024)) or str(10*1024*1024))
MAX_FILES=int(env_get("CASE_ATTACHMENT_MAX_COUNT","10") or "10")
MAKER_DAYS=int(env_get("CASE_MAKER_RESPONSE_DAYS","2") or "2"); BUYER_DAYS=int(env_get("CASE_BUYER_RESPONSE_DAYS","3") or "3"); RETURN_DAYS=int(env_get("CASE_RETURN_SHIP_DAYS","7") or "7")

class CaseItemIn(BaseModel):
    order_item_id: str = Field(min_length=1, max_length=160); quantity_affected: int = Field(default=1, ge=1, le=999); requested_amount: Optional[float] = Field(default=None, ge=0)
class CaseCreate(BaseModel):
    case_type: str = "return_request"; reason_code: str; requested_resolution: str; explanation: str = Field(min_length=10, max_length=5000); items: list[CaseItemIn] = Field(min_length=1, max_length=30); used_or_altered: bool = False; preferred_outcome: str = ""
class MessageIn(BaseModel): message_body: str = Field(min_length=1, max_length=5000)
class TrackingIn(BaseModel): carrier: str = Field(min_length=2, max_length=80); tracking_number: str = Field(min_length=4, max_length=120)
class ReturnApprovalIn(BaseModel):
    return_instructions: str = Field(default="Pack the item securely and send it with tracking.", max_length=2000); shipping_paid_by: str = Field(default="buyer", max_length=40); return_deadline: Optional[str]=None; expected_refund_amount: Optional[float]=Field(default=None, ge=0); required_condition: str = Field(default="Return in the same condition received unless the issue is damage or defect.", max_length=1000)
class RefundIn(BaseModel): amount: Optional[float]=Field(default=None, ge=0); reason: str="case_resolution"; idempotency_key: Optional[str]=None
class PartialOfferIn(BaseModel): amount: float = Field(gt=0); explanation: str = Field(min_length=5, max_length=2000); expires_at: Optional[str]=None
class ReplacementIn(BaseModel): production_estimate: str=""; tracking_number: str=""; carrier: str=""; original_return_required: bool=False; notes: str=""
class DenyIn(BaseModel): reason: str = Field(min_length=5, max_length=2000)
class DeadlineIn(BaseModel): field: str; value: str; reason: str = Field(min_length=5, max_length=1000)
class ProviderDisputeIn(BaseModel): payment_provider: str; payment_provider_dispute_id: str = Field(min_length=3, max_length=200); response_due_at: Optional[str]=None; amount_at_risk: Optional[float]=Field(default=None, ge=0)

def _now(): return datetime.now(timezone.utc)
def _iso(dt=None): return (dt or _now()).isoformat()
def _parse(v, f="date"):
    if not v: return None
    try:
        d=datetime.fromisoformat(str(v).replace("Z","+00:00")); return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)
    except Exception: raise HTTPException(400, f"Invalid {f}.")
def _cents(v): return int((Decimal(str(v or 0))*100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
def _money(c): return round(int(c or 0)/100,2)
def _clean(v, n=5000): return html.escape(re.sub(r"<\s*(script|iframe|object|embed)[^>]*>.*?<\s*/\s*\1\s*>","",(v or "").strip()[:n],flags=re.I|re.S), quote=False)
def _email(claims): return (claims.get("email") or "").lower().strip()
def _case_no(): return f"CM-RD-{_now().strftime('%y%m')}-{uuid.uuid4().hex[:6].upper()}"

async def ensure_return_case_indexes() -> None:
    await db.return_cases.create_index("id", unique=True); await db.return_cases.create_index("public_case_number", unique=True)
    await db.return_cases.create_index([("order_id",1),("current_status",1)]); await db.return_cases.create_index([("buyer_email",1),("opened_at",-1)]); await db.return_cases.create_index([("maker_id",1),("opened_at",-1)])
    await db.return_cases.create_index([("payment_provider",1),("payment_provider_dispute_id",1)], sparse=True)
    await db.return_case_items.create_index([("case_id",1),("order_item_id",1)]); await db.return_case_messages.create_index([("case_id",1),("created_at",1)]); await db.return_case_attachments.create_index([("case_id",1),("created_at",1)])
    await db.return_authorizations.create_index("case_id", unique=True); await db.return_case_resolutions.create_index([("case_id",1),("created_at",1)]); await db.return_case_resolutions.create_index("idempotency_key", unique=True, sparse=True); await db.return_case_offers.create_index([("case_id",1),("status",1)])
    await db.return_case_notifications.create_index([("case_id",1),("kind",1),("recipient",1),("dedupe_key",1)], unique=True)

async def _audit(case, actor, role, action, before=None, after=None, reason=""):
    who = actor.get("email") if isinstance(actor, dict) else str(actor or "system")
    doc={"id":str(uuid.uuid4()),"kind":"returns_case","action":action,"case_id":case.get("id"),"public_case_number":case.get("public_case_number"),"order_id":case.get("order_id"),"actor":who,"actor_role":role,"before":before or {},"after":after or {},"reason":reason,"created_at":_iso(),"ts":_iso()}
    await db.return_case_timeline.insert_one({**doc,"visibility":"participants"})
    if role=="admin" or action.startswith("admin_"): await db.admin_audit.insert_one(doc)

async def _notify(case, kind, recipients, title, body):
    for role,email in recipients:
        email=(email or "").lower().strip()
        if not email: continue
        dedupe=f"{case.get('id')}:{kind}:{role}:{email}"
        res=await db.return_case_notifications.update_one({"case_id":case["id"],"kind":kind,"recipient":email,"dedupe_key":dedupe},{"$setOnInsert":{"id":str(uuid.uuid4()),"case_id":case["id"],"kind":kind,"recipient_role":role,"recipient":email,"title":title,"body":body,"delivery_state":"queued","created_at":_iso()}},upsert=True)
        if res.upserted_id:
            try:
                from email_service import send_return_case_notice
                await send_return_case_notice(email=email,title=title,body=body,case_number=case.get("public_case_number"),case_id=case.get("id"))
                await db.return_case_notifications.update_one({"dedupe_key":dedupe},{"$set":{"delivery_state":"sent","sent_at":_iso()}})
            except Exception as exc:
                await db.return_case_notifications.update_one({"dedupe_key":dedupe},{"$set":{"delivery_state":"failed","error":str(exc)[:500]}})

def _item_key(item, idx): return str(item.get("order_item_id") or item.get("line_id") or item.get("id") or item.get("product_id") or item.get("slug") or idx)
def _qty(item):
    try: return max(1,int(item.get("quantity") or item.get("qty") or 1))
    except Exception: return 1

async def _order_items(tx):
    raw=tx.get("items") or []; pids=[str(i.get("product_id") or "") for i in raw if i.get("product_id")]; products={}
    if pids:
        async for p in db.products.find({"$or":[{"id":{"$in":pids}},{"slug":{"$in":pids}}]},{"_id":0}):
            products[str(p.get("id") or "")]=p; products[str(p.get("slug") or "")]=p
    out=[]
    for idx,item in enumerate(raw):
        prod=products.get(str(item.get("product_id") or "")) or {}; q=_qty(item); unit=item.get("price") or item.get("unit_price") or item.get("amount") or prod.get("price") or 0; imgs=prod.get("images") or []
        out.append({"order_item_id":_item_key(item,idx),"product_id":item.get("product_id"),"product_slug":item.get("slug") or prod.get("slug"),"title":str(item.get("title") or item.get("product_title") or prod.get("title") or item.get("product_id") or "Order item"),"quantity":q,"maker_slug":str(item.get("maker_slug") or item.get("maker") or prod.get("maker_slug") or ""),"image":item.get("image") or item.get("image_url") or (imgs[0] if imgs else None),"subtotal_cents":_cents(unit)*q,"is_custom":bool(item.get("personalization_text") or item.get("personalization_image_url") or prod.get("is_custom") or prod.get("personalized")),"is_digital":bool(item.get("digital") or prod.get("digital") or prod.get("listing_type")=="digital"),"accept_returns":prod.get("accept_returns",True),"accept_exchanges":prod.get("accept_exchanges",True)})
    return out

async def _get_order(sid):
    tx=await db.payment_transactions.find_one({"session_id":sid},{"_id":0})
    if not tx: raise HTTPException(404,"Order not found.")
    if tx.get("payment_status")!="paid": raise HTTPException(403,"Returns and disputes require a paid order.")
    return tx

def _assert_buyer(tx, claims):
    if (tx.get("customer_email") or "").lower().strip()!=_email(claims): raise HTTPException(404,"Order not found on this account.")

async def _case_access(case_id, role, identity):
    case=await db.return_cases.find_one({"id":case_id},{"_id":0})
    if not case: raise HTTPException(404,"Case not found.")
    if role=="buyer" and (case.get("buyer_email") or "").lower()!=identity.lower(): raise HTTPException(404,"Case not found.")
    if role=="maker" and case.get("maker_id")!=identity: raise HTTPException(404,"Case not found.")
    return case

async def _remaining(order_id):
    tx=await _get_order(order_id); total=_cents(tx.get("amount") or tx.get("total") or 0); tx_ref=_cents(tx.get("refund_amount") or 0)
    rows=await db.return_case_resolutions.aggregate([{"$match":{"order_id":order_id,"resolution_type":"refund_executed"}},{"$group":{"_id":None,"total":{"$sum":"$amount_cents"}}}]).to_list(1)
    case_ref=int((rows[0] or {}).get("total") or 0) if rows else 0
    return max(0,total-max(tx_ref,case_ref))

async def _hydrate(case, viewer):
    cid=case["id"]; mf={"case_id":cid}; tf={"case_id":cid}
    if viewer!="admin": mf["visibility"]={"$ne":"admin_internal"}; tf["visibility"]={"$ne":"admin_internal"}
    return {**case,"items":await db.return_case_items.find({"case_id":cid},{"_id":0}).to_list(200),"messages":await db.return_case_messages.find(mf,{"_id":0}).sort("created_at",1).to_list(500),"attachments":await db.return_case_attachments.find({"case_id":cid},{"_id":0}).sort("created_at",1).to_list(200),"return_authorization":await db.return_authorizations.find_one({"case_id":cid},{"_id":0}),"resolutions":await db.return_case_resolutions.find({"case_id":cid},{"_id":0}).sort("created_at",1).to_list(200),"offers":await db.return_case_offers.find({"case_id":cid},{"_id":0}).sort("created_at",-1).to_list(50),"timeline":await db.return_case_timeline.find(tf,{"_id":0}).sort("created_at",1).to_list(500),"remaining_refundable_amount":_money(await _remaining(case["order_id"]))}

async def _transition(case, new_status, actor, role, reason=""):
    old=case.get("current_status") or "open"
    if new_status!=old and new_status not in TRANSITIONS.get(old,set()): raise HTTPException(409,f"Cannot move case from {old} to {new_status}.")
    patch={"current_status":new_status,"updated_at":_iso()}
    if new_status=="under_admin_review" and not case.get("escalated_at"): patch["escalated_at"]=_iso()
    if new_status in {"resolved","denied"}: patch["resolved_at"]=_iso()
    if new_status=="closed": patch["closed_at"]=_iso()
    await db.return_cases.update_one({"id":case["id"]},{"$set":patch}); after={**case,**patch}
    await _audit(case,actor,role,"status_changed",{"current_status":old},{"current_status":new_status},reason); return after

async def _policy_snapshot(tx, items):
    snap={"source":"purchase_time" if tx.get("policy_version") else "migrated_best_known","checkout_policy_version":tx.get("policy_version"),"policy_accepted_at":tx.get("policy_accepted_at"),"maker_terms":[]}
    slugs=sorted({i.get("maker_slug") for i in items if i.get("maker_slug")})
    if slugs:
        async for m in db.makers.find({"slug":{"$in":slugs}},{"_id":0,"slug":1,"name":1,"return_policy":1,"return_policy_text":1,"shop_policies":1}): snap["maker_terms"].append({"maker_slug":m.get("slug"),"maker_name":m.get("name"),"return_policy":m.get("return_policy") or m.get("return_policy_text") or (m.get("shop_policies") or {}).get("returns") or "No maker-specific return terms recorded."})
    pv=await db.policy_versions.find_one({"policy_id":"returns","status":"published"},{"_id":0,"id":1,"version_number":1,"effective_at":1})
    if pv: snap["marketplace_returns_policy"]=pv
    return snap

@router.get("/returns-cases/reasons")
async def reasons(): return {"case_types":CASE_TYPES,"requested_resolutions":REQUESTED_RESOLUTIONS}

@router.get("/buyer/orders/{session_id}/case-eligibility")
async def buyer_case_eligibility(session_id: str, claims: dict=Depends(current_buyer)):
    tx=await _get_order(session_id); _assert_buyer(tx,claims); items=await _order_items(tx)
    existing=await db.return_cases.find({"order_id":session_id,"buyer_email":_email(claims),"current_status":{"$nin":list(TERMINAL)}},{"_id":0,"id":1,"public_case_number":1,"item_ids":1,"reason_code":1,"current_status":1}).to_list(100)
    return {"order":{"session_id":session_id,"amount":tx.get("amount"),"created_at":tx.get("created_at"),"payment_provider":tx.get("payment_provider") or "stripe"},"items":items,"existing_cases":existing,"policy_snapshot":await _policy_snapshot(tx,items)}

@router.post("/buyer/orders/{session_id}/cases")
async def buyer_create_case(session_id: str, body: CaseCreate, claims: dict=Depends(current_buyer)):
    await ensure_return_case_indexes()
    if body.case_type not in CASE_TYPES or body.reason_code not in CASE_TYPES: raise HTTPException(400,"Invalid case type or reason code.")
    if body.requested_resolution not in REQUESTED_RESOLUTIONS: raise HTTPException(400,"Invalid requested resolution.")
    tx=await _get_order(session_id); _assert_buyer(tx,claims); by_id={i["order_item_id"]:i for i in await _order_items(tx)}; selected=[]
    for line in body.items:
        item=by_id.get(line.order_item_id)
        if not item: raise HTTPException(400,"Selected item is not part of this order.")
        if line.quantity_affected>item["quantity"]: raise HTTPException(400,"Affected quantity exceeds ordered quantity.")
        selected.append({**item,"quantity_affected":line.quantity_affected,"requested_amount_cents":_cents(line.requested_amount) if line.requested_amount is not None else min(item.get("subtotal_cents") or 0,_cents(tx.get("amount")))})
    makers=sorted({i.get("maker_slug") for i in selected if i.get("maker_slug")})
    if len(makers)!=1: raise HTTPException(400,"Open one case per maker/order shipment.")
    item_ids=[i["order_item_id"] for i in selected]
    dup=await db.return_cases.find_one({"order_id":session_id,"buyer_email":_email(claims),"maker_id":makers[0],"reason_code":body.reason_code,"item_ids":{"$in":item_ids},"current_status":{"$nin":list(TERMINAL)}},{"_id":0,"public_case_number":1})
    if dup: raise HTTPException(409,f"An active case already exists for this item and reason: {dup.get('public_case_number')}.")
    now=_now(); cid=str(uuid.uuid4()); risk=sum(int(i.get("requested_amount_cents") or 0) for i in selected) or _cents(tx.get("amount")); maker=await db.makers.find_one({"slug":makers[0]},{"_id":0,"email":1,"name":1}) or {}
    case={"id":cid,"public_case_number":_case_no(),"order_id":session_id,"buyer_id":claims.get("sub"),"buyer_email":_email(claims),"maker_id":makers[0],"case_type":body.case_type,"reason_code":body.reason_code,"requested_resolution":body.requested_resolution,"current_status":"waiting_for_maker","payment_provider":tx.get("payment_provider") or "stripe","payment_provider_dispute_id":None,"amount_at_risk_cents":risk,"amount_at_risk":_money(risk),"currency":(tx.get("currency") or "usd").lower(),"item_ids":item_ids,"opened_at":_iso(now),"maker_response_due_at":_iso(now+timedelta(days=MAKER_DAYS)),"buyer_response_due_at":None,"return_ship_by":None,"escalated_at":None,"resolved_at":None,"closed_at":None,"created_at":_iso(now),"updated_at":_iso(now),"used_or_altered":body.used_or_altered,"preferred_outcome":_clean(body.preferred_outcome,500),"policy_snapshot":await _policy_snapshot(tx,selected)}
    await db.return_cases.insert_one(case); case.pop('_id', None); await db.return_case_items.insert_many([{**i,"id":str(uuid.uuid4()),"case_id":cid,"order_id":session_id,"resolution_type":body.requested_resolution,"approved_amount_cents":0,"created_at":_iso(now),"updated_at":_iso(now)} for i in selected])
    await db.return_case_messages.insert_one({"id":str(uuid.uuid4()),"case_id":cid,"sender_id":claims.get("sub"),"sender_email":_email(claims),"sender_role":"buyer","message_body":_clean(body.explanation),"visibility":"participants","created_at":_iso(now)})
    await _audit(case,claims,"buyer","case_opened",after={"items":item_ids}); await _notify(case,"case_opened",[("maker",maker.get("email")),("buyer",_email(claims))],"Return case opened",f"Case {case['public_case_number']} was opened for order {session_id}.")
    return await _hydrate(case,"buyer")

@router.get("/buyer/cases")
async def buyer_list(claims: dict=Depends(current_buyer), status: Optional[str]=None, limit: int=50):
    flt={"buyer_email":_email(claims)}
    if status: flt["current_status"]=status
    return {"cases":await db.return_cases.find(flt,{"_id":0}).sort("opened_at",-1).to_list(min(max(limit,1),100))}
@router.get("/buyer/cases/{case_id}")
async def buyer_get(case_id: str, claims: dict=Depends(current_buyer)): return await _hydrate(await _case_access(case_id,"buyer",_email(claims)),"buyer")
@router.post("/buyer/cases/{case_id}/messages")
async def buyer_msg(case_id: str, body: MessageIn, claims: dict=Depends(current_buyer)):
    case=await _case_access(case_id,"buyer",_email(claims)); msg={"id":str(uuid.uuid4()),"case_id":case_id,"sender_id":claims.get("sub"),"sender_email":_email(claims),"sender_role":"buyer","message_body":_clean(body.message_body),"visibility":"participants","created_at":_iso()}
    await db.return_case_messages.insert_one(msg); msg.pop('_id', None); case=await _transition(case,"waiting_for_maker",claims,"buyer","buyer replied"); await db.return_cases.update_one({"id":case_id},{"$set":{"maker_response_due_at":_iso(_now()+timedelta(days=MAKER_DAYS))}}); await _audit(case,claims,"buyer","message_submitted",after={"message_id":msg["id"]}); return {"ok":True,"message":msg}
@router.post("/buyer/cases/{case_id}/return-tracking")
async def buyer_tracking(case_id: str, body: TrackingIn, claims: dict=Depends(current_buyer)):
    case=await _case_access(case_id,"buyer",_email(claims))
    if case.get("current_status") not in {"return_approved","waiting_for_buyer","return_in_transit"}: raise HTTPException(409,"Return tracking can only be added after return approval.")
    patch={"tracking_number":_clean(body.tracking_number,120),"carrier":_clean(body.carrier,80),"shipment_status":"in_transit","updated_at":_iso()}; await db.return_authorizations.update_one({"case_id":case_id},{"$set":patch},upsert=True)
    after=await _transition(case,"return_in_transit",claims,"buyer","buyer added return tracking"); await _audit(after,claims,"buyer","tracking_added",after=patch); return {"ok":True,"case":await _hydrate(after,"buyer")}

async def _upload(case, role, uploader, file):
    if await db.return_case_attachments.count_documents({"case_id":case["id"]})>=MAX_FILES: raise HTTPException(400,"Maximum evidence attachments reached for this case.")
    data=await file.read(); ct=(file.content_type or mimetypes.guess_type(file.filename or "")[0] or "").lower()
    if len(data)>MAX_BYTES: raise HTTPException(400,"Attachment is too large.")
    if ct not in ATTACH_TYPES: raise HTTPException(400,"Unsupported evidence file type.")
    key=f"returns-cases/{case['id']}/{uuid.uuid4().hex}.{ATTACH_TYPES[ct]}"; url=""; scan="accepted"
    try:
        import r2_storage
        if r2_storage.is_configured(): url=r2_storage.upload_bytes(data,key,ct,cache_control="private, max-age=0",max_bytes=MAX_BYTES)
        else: scan="metadata_only_dev"
    except Exception as exc: logger.warning("case attachment storage failed: %s",exc); scan="storage_failed"
    doc={"id":str(uuid.uuid4()),"case_id":case["id"],"message_id":None,"uploader_id":uploader,"uploader_role":role,"filename":_clean(file.filename or "evidence",180),"storage_key":key,"url":url,"mime_type":ct,"size":len(data),"scan_status":scan,"created_at":_iso()}
    await db.return_case_attachments.insert_one(doc); await _audit(case,uploader,role,"attachment_uploaded",after={"attachment_id":doc["id"],"mime_type":ct,"size":len(data)}); return doc
@router.post("/buyer/cases/{case_id}/attachments")
async def buyer_attachment(case_id: str, file: UploadFile=File(...), claims: dict=Depends(current_buyer)): return {"attachment":await _upload(await _case_access(case_id,"buyer",_email(claims)),"buyer",_email(claims),file)}
@router.post("/buyer/cases/{case_id}/offers/{offer_id}/accept")
async def accept_offer(case_id: str, offer_id: str, claims: dict=Depends(current_buyer)):
    case=await _case_access(case_id,"buyer",_email(claims)); res=await db.return_case_offers.update_one({"id":offer_id,"case_id":case_id,"status":"pending"},{"$set":{"status":"accepted","accepted_at":_iso(),"updated_at":_iso()}})
    if not res.modified_count: raise HTTPException(404,"Offer not found.")
    await _audit(case,claims,"buyer","partial_refund_offer_accepted",after={"offer_id":offer_id}); return {"ok":True,"offer_status":"accepted"}
@router.post("/buyer/cases/{case_id}/offers/{offer_id}/decline")
async def decline_offer(case_id: str, offer_id: str, claims: dict=Depends(current_buyer)):
    case=await _case_access(case_id,"buyer",_email(claims)); res=await db.return_case_offers.update_one({"id":offer_id,"case_id":case_id,"status":"pending"},{"$set":{"status":"declined","declined_at":_iso(),"updated_at":_iso()}})
    if not res.modified_count: raise HTTPException(404,"Offer not found.")
    await _audit(case,claims,"buyer","partial_refund_offer_declined",after={"offer_id":offer_id}); return {"ok":True,"offer_status":"declined"}
@router.post("/buyer/cases/{case_id}/escalate")
async def buyer_escalate(case_id: str, claims: dict=Depends(current_buyer)):
    case=await _transition(await _case_access(case_id,"buyer",_email(claims)),"under_admin_review",claims,"buyer","buyer escalation"); await _audit(case,claims,"buyer","admin_escalation"); return {"case":await _hydrate(case,"buyer")}

@router.get("/maker/cases")
async def maker_list(slug: str=Depends(current_maker_slug), status: Optional[str]=None, limit: int=100):
    flt={"maker_id":slug}
    if status: flt["current_status"]=status
    return {"cases":await db.return_cases.find(flt,{"_id":0}).sort("opened_at",-1).to_list(min(max(limit,1),200))}
@router.get("/maker/cases/{case_id}")
async def maker_get(case_id: str, slug: str=Depends(current_maker_slug)): return await _hydrate(await _case_access(case_id,"maker",slug),"maker")
@router.post("/maker/cases/{case_id}/messages")
async def maker_msg(case_id: str, body: MessageIn, slug: str=Depends(current_maker_slug)):
    case=await _case_access(case_id,"maker",slug); msg={"id":str(uuid.uuid4()),"case_id":case_id,"sender_id":slug,"sender_email":slug,"sender_role":"maker","message_body":_clean(body.message_body),"visibility":"participants","created_at":_iso()}
    await db.return_case_messages.insert_one(msg); msg.pop('_id', None); case=await _transition(case,"waiting_for_buyer",slug,"maker","maker replied"); await db.return_cases.update_one({"id":case_id},{"$set":{"buyer_response_due_at":_iso(_now()+timedelta(days=BUYER_DAYS))}}); await _audit(case,slug,"maker","message_submitted",after={"message_id":msg["id"]}); return {"ok":True,"message":msg}
@router.post("/maker/cases/{case_id}/attachments")
async def maker_attachment(case_id: str, file: UploadFile=File(...), slug: str=Depends(current_maker_slug)): return {"attachment":await _upload(await _case_access(case_id,"maker",slug),"maker",slug,file)}

async def _approve_return(case, body, actor, role):
    deadline=_parse(body.return_deadline,"return deadline") or (_now()+timedelta(days=RETURN_DAYS))
    doc={"id":str(uuid.uuid4()),"case_id":case["id"],"authorization_number":f"RA-{case['public_case_number'].split('-')[-1]}","return_address_snapshot":"Maker return address on file. Confirm in messages before shipment if needed.","return_instructions":_clean(body.return_instructions,2000),"return_deadline":_iso(deadline),"shipping_paid_by":_clean(body.shipping_paid_by,40),"tracking_number":None,"carrier":None,"shipment_status":"awaiting_buyer","delivered_at":None,"item_received_at":None,"condition_notes":_clean(body.required_condition,1000),"expected_refund_amount_cents":_cents(body.expected_refund_amount) if body.expected_refund_amount is not None else case.get("amount_at_risk_cents",0),"created_at":_iso(),"updated_at":_iso()}
    await db.return_authorizations.update_one({"case_id":case["id"]},{"$set":doc},upsert=True); await db.return_case_resolutions.insert_one({"id":str(uuid.uuid4()),"case_id":case["id"],"order_id":case["order_id"],"resolution_type":"return_approved","actor":str(actor.get("email") if isinstance(actor,dict) else actor),"actor_role":role,"amount_cents":doc["expected_refund_amount_cents"],"reason":"return authorized","created_at":_iso()})
    after=await _transition(case,"return_approved",actor,role,"return authorized"); await db.return_cases.update_one({"id":case["id"]},{"$set":{"return_ship_by":_iso(deadline)}}); await _audit(after,actor,role,"return_approved",after={"authorization_number":doc["authorization_number"]}); await _notify(after,"return_approved",[("buyer",case.get("buyer_email"))],"Return approved",f"Return authorization {doc['authorization_number']} is ready for {case.get('public_case_number')}."); return await _hydrate(after,role)
@router.post("/maker/cases/{case_id}/approve-return")
async def maker_approve_return(case_id: str, body: ReturnApprovalIn, slug: str=Depends(current_maker_slug)): return await _approve_return(await _case_access(case_id,"maker",slug),body,slug,"maker")

async def _execute_refund(case, body, actor, role):
    remaining=await _remaining(case["order_id"])
    if remaining<=0: raise HTTPException(409,"This order has no refundable balance remaining.")
    amount=remaining if body.amount is None else _cents(body.amount)
    if amount<=0 or amount>remaining: raise HTTPException(400,"Refund amount exceeds the remaining refundable balance.")
    idem=body.idempotency_key or f"case-refund:{case['id']}:{amount}:{role}"; existing=await db.return_case_resolutions.find_one({"idempotency_key":idem},{"_id":0})
    if existing: return {"ok":True,"idempotent":True,"resolution":existing,"case":await _hydrate(case,role)}
    provider=case.get("payment_provider") or "stripe"; tx=await _get_order(case["order_id"]); provider_refund_id=None
    full_refund = amount==remaining and tx.get("refund_status")!="partially_refunded"
    if full_refund:
        if provider=="paypal":
            from routers.paypal_finalize import refund_paypal_session; result=await refund_paypal_session(case["order_id"])
        else:
            from routers.stripe_connect import refund_session; result=await refund_session(case["order_id"])
        provider_refund_id=result.get("refund_id") or result.get("id") or result.get("status")
    else:
        provider_refund_id=f"manual-partial-{uuid.uuid4().hex[:12]}"
        await db.payment_transactions.update_one({"session_id":case["order_id"]},{"$inc":{"refund_amount":_money(amount)},"$set":{"refund_status":"partially_refunded","updated_at":_iso()},"$push":{"refunds":{"case_id":case["id"],"amount":_money(amount),"provider":provider,"provider_refund_id":provider_refund_id,"created_at":_iso()}}})
        await ledger_record("refund",provider,f"{case['order_id']}:case:{case['id']}:{provider_refund_id}",case.get("maker_id") or "unknown",gross_cents=amount,net_cents=-amount,currency=case.get("currency") or "usd",meta={"case_id":case["id"],"partial":True,"provider_refund_id":provider_refund_id})
        payout=await db.maker_payouts.find_one({"session_id":case["order_id"],"maker_slug":case.get("maker_id")},{"_id":0})
        if payout and payout.get("status")=="deferred":
            dec=min(int(payout.get("amount_cents") or 0),amount); await db.maker_payouts.update_one({"session_id":case["order_id"],"maker_slug":case.get("maker_id"),"status":"deferred"},{"$inc":{"amount_cents":-dec},"$set":{"updated_at":_iso(),"refund_adjusted_at":_iso()}})
        elif payout: await db.maker_balance_adjustments.insert_one({"id":str(uuid.uuid4()),"maker_slug":case.get("maker_id"),"session_id":case["order_id"],"case_id":case["id"],"amount_cents":-amount,"reason":"return_case_refund_after_payout","status":"pending_recovery","created_at":_iso()})
    res={"id":str(uuid.uuid4()),"case_id":case["id"],"order_id":case["order_id"],"resolution_type":"refund_executed","actor":str(actor.get("email") if isinstance(actor,dict) else actor),"actor_role":role,"amount_cents":amount,"amount":_money(amount),"reason":_clean(body.reason,500),"provider_transaction_id":provider_refund_id,"payment_provider":provider,"idempotency_key":idem,"created_at":_iso()}
    await db.return_case_resolutions.insert_one(res); res.pop('_id', None); after=await _transition(case,"refund_completed",actor,role,"refund executed"); await _audit(after,actor,role,"refund_executed",after={"amount_cents":amount,"provider_transaction_id":provider_refund_id}); await _notify(after,"refund_issued",[("buyer",case.get("buyer_email"))],"Refund issued",f"A refund of ${_money(amount):.2f} was issued for {case.get('public_case_number')}."); return {"ok":True,"resolution":res,"case":await _hydrate(after,role)}
@router.post("/maker/cases/{case_id}/approve-refund")
async def maker_refund(case_id: str, body: RefundIn, slug: str=Depends(current_maker_slug)): return await _execute_refund(await _transition(await _case_access(case_id,"maker",slug),"refund_pending",slug,"maker","maker approved refund"),body,slug,"maker")
@router.post("/maker/cases/{case_id}/partial-refund-offers")
async def maker_offer(case_id: str, body: PartialOfferIn, slug: str=Depends(current_maker_slug)):
    case=await _case_access(case_id,"maker",slug); amount=_cents(body.amount); rem=await _remaining(case["order_id"])
    if amount<=0 or amount>rem: raise HTTPException(400,"Offer exceeds the remaining refundable balance.")
    offer={"id":str(uuid.uuid4()),"case_id":case_id,"order_id":case["order_id"],"maker_id":slug,"amount_cents":amount,"amount":_money(amount),"explanation":_clean(body.explanation,2000),"status":"pending","expires_at":_iso(_parse(body.expires_at,"offer expiry")) if body.expires_at else _iso(_now()+timedelta(days=7)),"created_by":slug,"created_at":_iso(),"updated_at":_iso()}
    await db.return_case_offers.insert_one(offer); offer.pop('_id', None); await _transition(case,"waiting_for_buyer",slug,"maker","partial refund offer"); await _audit(case,slug,"maker","partial_refund_offer_created",after={"offer_id":offer["id"],"amount_cents":amount}); await _notify(case,"partial_refund_offered",[("buyer",case.get("buyer_email"))],"Partial refund offered",f"A ${_money(amount):.2f} partial refund offer is waiting for your response."); return {"offer":offer}
@router.post("/maker/cases/{case_id}/approve-replacement")
async def maker_replacement(case_id: str, body: ReplacementIn, slug: str=Depends(current_maker_slug)):
    case=await _case_access(case_id,"maker",slug); doc={"id":str(uuid.uuid4()),"case_id":case_id,"order_id":case["order_id"],"resolution_type":"replacement","actor":slug,"actor_role":"maker","amount_cents":0,"replacement":{"production_estimate":_clean(body.production_estimate,300),"tracking_number":_clean(body.tracking_number,120),"carrier":_clean(body.carrier,80),"original_return_required":body.original_return_required,"notes":_clean(body.notes,1000),"revenue_classification":"zero_value_replacement"},"created_at":_iso()}
    await db.return_case_resolutions.insert_one(doc); after=await _transition(case,"replacement_approved",slug,"maker","replacement approved"); await _audit(after,slug,"maker","replacement_approved",after=doc["replacement"]); return await _hydrate(after,"maker")
@router.post("/maker/cases/{case_id}/deny")
async def maker_deny(case_id: str, body: DenyIn, slug: str=Depends(current_maker_slug)):
    case=await _case_access(case_id,"maker",slug); await db.return_case_resolutions.insert_one({"id":str(uuid.uuid4()),"case_id":case_id,"order_id":case["order_id"],"resolution_type":"request_denied","actor":slug,"actor_role":"maker","reason":_clean(body.reason,2000),"amount_cents":0,"created_at":_iso()}); after=await _transition(case,"denied",slug,"maker",body.reason); await _audit(after,slug,"maker","request_denied",reason=body.reason); return await _hydrate(after,"maker")
@router.post("/maker/cases/{case_id}/escalate")
async def maker_escalate(case_id: str, slug: str=Depends(current_maker_slug)):
    case=await _transition(await _case_access(case_id,"maker",slug),"under_admin_review",slug,"maker","maker escalation"); await _audit(case,slug,"maker","admin_escalation"); return await _hydrate(case,"maker")

@router.get("/admin/returns-cases/analytics")
async def admin_analytics(_: dict=Depends(current_admin)):
    total_orders=await db.payment_transactions.count_documents({"payment_status":"paid"}); total_cases=await db.return_cases.count_documents({}); refunds=await db.return_case_resolutions.find({"resolution_type":"refund_executed"},{"_id":0,"amount_cents":1}).to_list(5000); replacements=await db.return_case_resolutions.count_documents({"resolution_type":"replacement"}); escalated=await db.return_cases.count_documents({"current_status":"under_admin_review"}); reasons=await db.return_cases.aggregate([{"$group":{"_id":"$reason_code","count":{"$sum":1},"amount_cents":{"$sum":"$amount_at_risk_cents"}}}]).to_list(200)
    return {"total_orders":total_orders,"total_cases":total_cases,"case_rate":round(total_cases/total_orders,4) if total_orders else 0,"refund_count":len(refunds),"refund_amount":_money(sum(int(r.get("amount_cents") or 0) for r in refunds)),"replacement_count":replacements,"escalation_rate":round(escalated/total_cases,4) if total_cases else 0,"by_reason":reasons}
@router.get("/admin/returns-cases")
async def admin_list(_: dict=Depends(current_admin), status: Optional[str]=None, q: Optional[str]=None, limit: int=100):
    flt={}
    if status: flt["current_status"]=status
    if q: flt["$or"]=[{"public_case_number":{"$regex":re.escape(q),"$options":"i"}},{"order_id":{"$regex":re.escape(q),"$options":"i"}},{"buyer_email":{"$regex":re.escape(q),"$options":"i"}},{"maker_id":{"$regex":re.escape(q),"$options":"i"}}]
    return {"cases":await db.return_cases.find(flt,{"_id":0}).sort("opened_at",-1).to_list(min(max(limit,1),300))}
@router.get("/admin/returns-cases/{case_id}")
async def admin_get(case_id: str, _: dict=Depends(current_admin)):
    case=await db.return_cases.find_one({"id":case_id},{"_id":0})
    if not case: raise HTTPException(404,"Case not found.")
    return await _hydrate(case,"admin")
@router.post("/admin/returns-cases/{case_id}/notes")
async def admin_note(case_id: str, body: MessageIn, admin: dict=Depends(current_admin)):
    case=await db.return_cases.find_one({"id":case_id},{"_id":0})
    if not case: raise HTTPException(404,"Case not found.")
    note={"id":str(uuid.uuid4()),"case_id":case_id,"sender_id":admin.get("email"),"sender_email":admin.get("email"),"sender_role":"admin","message_body":_clean(body.message_body),"visibility":"admin_internal","created_at":_iso()}
    await db.return_case_messages.insert_one(note); note.pop('_id', None); await _audit(case,admin,"admin","admin_internal_note",after={"message_id":note["id"]}); return {"ok":True,"note":note}
@router.post("/admin/returns-cases/{case_id}/deadline")
async def admin_deadline(case_id: str, body: DeadlineIn, admin: dict=Depends(current_admin)):
    if body.field not in {"maker_response_due_at","buyer_response_due_at","return_ship_by","acknowledgement_due_at"}: raise HTTPException(400,"Invalid deadline field.")
    case=await db.return_cases.find_one({"id":case_id},{"_id":0})
    if not case: raise HTTPException(404,"Case not found.")
    val=_parse(body.value,body.field); await db.return_cases.update_one({"id":case_id},{"$set":{body.field:_iso(val),"updated_at":_iso()}}); await _audit(case,admin,"admin","deadline_changed",before={body.field:case.get(body.field)},after={body.field:_iso(val)},reason=body.reason); return {"ok":True}
@router.post("/admin/returns-cases/{case_id}/approve-return")
async def admin_return(case_id: str, body: ReturnApprovalIn, admin: dict=Depends(current_admin)):
    case=await db.return_cases.find_one({"id":case_id},{"_id":0})
    if not case: raise HTTPException(404,"Case not found.")
    return await _approve_return(case,body,admin,"admin")
@router.post("/admin/returns-cases/{case_id}/execute-refund")
async def admin_refund(case_id: str, body: RefundIn, admin: dict=Depends(current_admin)):
    case=await db.return_cases.find_one({"id":case_id},{"_id":0})
    if not case: raise HTTPException(404,"Case not found.")
    return await _execute_refund(await _transition(case,"refund_pending",admin,"admin","admin approved refund"),body,admin,"admin")
@router.post("/admin/returns-cases/{case_id}/approve-replacement")
async def admin_replacement(case_id: str, body: ReplacementIn, admin: dict=Depends(current_admin)):
    case=await db.return_cases.find_one({"id":case_id},{"_id":0})
    if not case: raise HTTPException(404,"Case not found.")
    doc={"id":str(uuid.uuid4()),"case_id":case_id,"order_id":case["order_id"],"resolution_type":"replacement","actor":admin.get("email"),"actor_role":"admin","amount_cents":0,"replacement":{"production_estimate":_clean(body.production_estimate,300),"tracking_number":_clean(body.tracking_number,120),"carrier":_clean(body.carrier,80),"original_return_required":body.original_return_required,"notes":_clean(body.notes,1000),"revenue_classification":"zero_value_replacement"},"created_at":_iso()}
    await db.return_case_resolutions.insert_one(doc); after=await _transition(case,"replacement_approved",admin,"admin","admin replacement approved"); await _audit(after,admin,"admin","replacement_approved",after=doc["replacement"]); return await _hydrate(after,"admin")
@router.post("/admin/returns-cases/{case_id}/deny")
async def admin_deny(case_id: str, body: DenyIn, admin: dict=Depends(current_admin)):
    case=await db.return_cases.find_one({"id":case_id},{"_id":0})
    if not case: raise HTTPException(404,"Case not found.")
    await db.return_case_resolutions.insert_one({"id":str(uuid.uuid4()),"case_id":case_id,"order_id":case["order_id"],"resolution_type":"admin_decision_denied","actor":admin.get("email"),"actor_role":"admin","reason":_clean(body.reason,2000),"amount_cents":0,"created_at":_iso()}); after=await _transition(case,"denied",admin,"admin",body.reason); await _audit(after,admin,"admin","admin_decision",reason=body.reason); return await _hydrate(after,"admin")
@router.post("/admin/returns-cases/{case_id}/close")
async def admin_close(case_id: str, body: DenyIn, admin: dict=Depends(current_admin)):
    case=await db.return_cases.find_one({"id":case_id},{"_id":0})
    if not case: raise HTTPException(404,"Case not found.")
    after=await _transition(case,"closed",admin,"admin",body.reason); await _audit(after,admin,"admin","case_closed",reason=body.reason); return await _hydrate(after,"admin")
@router.post("/admin/returns-cases/{case_id}/reopen")
async def admin_reopen(case_id: str, body: DenyIn, admin: dict=Depends(current_admin)):
    case=await db.return_cases.find_one({"id":case_id},{"_id":0})
    if not case: raise HTTPException(404,"Case not found.")
    after=await _transition(case,"waiting_for_maker",admin,"admin",body.reason); await _audit(after,admin,"admin","case_reopened",reason=body.reason); return await _hydrate(after,"admin")
@router.post("/admin/returns-cases/{case_id}/link-provider-dispute")
async def admin_link_dispute(case_id: str, body: ProviderDisputeIn, admin: dict=Depends(current_admin)):
    if body.payment_provider not in {"stripe","paypal"}: raise HTTPException(400,"Unsupported payment provider.")
    case=await db.return_cases.find_one({"id":case_id},{"_id":0})
    if not case: raise HTTPException(404,"Case not found.")
    patch={"payment_provider":body.payment_provider,"payment_provider_dispute_id":body.payment_provider_dispute_id,"provider_dispute_response_due_at":_iso(_parse(body.response_due_at,"response due")) if body.response_due_at else None,"current_status":"payment_dispute_open","updated_at":_iso()}
    if body.amount_at_risk is not None: patch.update({"amount_at_risk_cents":_cents(body.amount_at_risk),"amount_at_risk":body.amount_at_risk})
    await db.return_cases.update_one({"id":case_id},{"$set":patch}); await _audit(case,admin,"admin","provider_dispute_linked",after=patch); return await _hydrate({**case,**patch},"admin")

async def run_return_case_deadline_sweep() -> dict:
    now=_now(); sent=0; escalatable=0; active=await db.return_cases.find({"current_status":{"$nin":list(TERMINAL)}},{"_id":0}).to_list(1000)
    for case in active:
        for field,kind,target in [("maker_response_due_at","maker_response_due","maker"),("buyer_response_due_at","buyer_response_due","buyer"),("return_ship_by","return_ship_due","buyer")]:
            dt=_parse(case.get(field),field)
            if not dt: continue
            hours=(dt-now).total_seconds()/3600
            if 0<=hours<=24:
                recipient=case.get("buyer_email") if target=="buyer" else (await db.makers.find_one({"slug":case.get("maker_id")},{"_id":0,"email":1}) or {}).get("email")
                before=await db.return_case_notifications.count_documents({"case_id":case["id"],"kind":kind}); await _notify(case,kind,[(target,recipient)],"Case deadline approaching",f"Deadline for {case.get('public_case_number')} is {dt.isoformat()}."); after=await db.return_case_notifications.count_documents({"case_id":case["id"],"kind":kind}); sent+=max(0,after-before)
            if hours<0: escalatable+=1; await db.return_cases.update_one({"id":case["id"]},{"$set":{"escalation_eligible":True,"updated_at":_iso()}})
    return {"sent":sent,"escalation_eligible":escalatable}





