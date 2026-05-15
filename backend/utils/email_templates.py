"""Bilingual (Arabic / English) transactional email templates for tenants.

Each template is a function that returns ``(subject, html_body, text_body)``
given a ``ctx`` dict. Templates are intentionally minimal HTML so they render
well in any inbox (no external CSS, no images, RTL handled inline).

Template kinds:
  - welcome
  - trial_ending
  - payment_success
  - payment_failed
  - suspended
  - cancelled
  - final_purge_warning
  - purge_completed
"""
from datetime import datetime
from typing import Dict, Tuple, Callable

BRAND_NAME = "Champions Academy Platform"
SUPPORT_EMAIL = "support@champions-academy.app"


def _fmt_date(iso: str) -> str:
    if not iso:
        return ""
    try:
        d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return d.strftime("%Y-%m-%d")
    except Exception:
        return iso[:10] if iso else ""


def _wrap(html_ar: str, html_en: str) -> str:
    return f"""<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:600px;margin:0 auto;padding:24px;">
<div dir="rtl" style="text-align:right;line-height:1.7;">{html_ar}</div>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0;"/>
<div dir="ltr" style="text-align:left;line-height:1.6;">{html_en}</div>
<p style="color:#777;font-size:12px;margin-top:24px;">{BRAND_NAME} · {SUPPORT_EMAIL}</p>
</body></html>"""


def _welcome(ctx: Dict) -> Tuple[str, str, str]:
    name = ctx.get("academy_name", "")
    slug = ctx.get("slug", "")
    trial_days = ctx.get("trial_days", 30)
    end = _fmt_date(ctx.get("subscription_end_at", ""))
    subject = f"مرحباً بكم في {BRAND_NAME} / Welcome to {BRAND_NAME}"
    ar = f"""
<h2>مرحباً {name} 👋</h2>
<p>تم إنشاء حساب أكاديميتك بنجاح. تجربتك المجانية لمدة <b>{trial_days} يوماً</b> تبدأ الآن وتنتهي في <b>{end}</b>.</p>
<p>النطاق الفرعي: <b>{slug}</b></p>
<p>يمكنك الآن تسجيل الدخول وبدء إعداد الفروع والأنشطة والأعضاء.</p>
"""
    en = f"""
<h2>Welcome, {name} 👋</h2>
<p>Your academy account is ready. Your <b>{trial_days}-day</b> free trial starts now and ends on <b>{end}</b>.</p>
<p>Subdomain: <b>{slug}</b></p>
<p>Sign in to start configuring branches, activities, and members.</p>
"""
    text = f"Welcome {name}. Trial ends {end}. Subdomain: {slug}."
    return subject, _wrap(ar, en), text


def _trial_ending(ctx: Dict) -> Tuple[str, str, str]:
    name = ctx.get("academy_name", "")
    days = ctx.get("days_remaining", 0)
    end = _fmt_date(ctx.get("subscription_end_at", ""))
    subject = f"تنبيه: تنتهي تجربتك خلال {days} يوم / Your trial ends in {days} days"
    ar = f"""
<h2>تذكير بتجديد الاشتراك</h2>
<p>عزيزي {name}، تنتهي تجربتك المجانية خلال <b>{days}</b> يوم (في {end}).</p>
<p>يرجى التواصل معنا لتجديد الاشتراك قبل التاريخ المذكور لتجنب تعليق الحساب.</p>
"""
    en = f"""
<h2>Renewal reminder</h2>
<p>Hello {name}, your free trial ends in <b>{days}</b> days (on {end}).</p>
<p>Please contact us to renew your subscription before that date to avoid suspension.</p>
"""
    text = f"Trial ends in {days} days ({end})."
    return subject, _wrap(ar, en), text


def _payment_success(ctx: Dict) -> Tuple[str, str, str]:
    name = ctx.get("academy_name", "")
    amount = ctx.get("amount", "")
    currency = ctx.get("currency", "SAR")
    new_end = _fmt_date(ctx.get("subscription_end_at", ""))
    months = ctx.get("months", 0)
    days = ctx.get("days", 0)
    period = []
    if months:
        period.append(f"{months} شهر / {months} month(s)")
    if days:
        period.append(f"{days} يوم / {days} day(s)")
    period_str = " + ".join(period) or "—"
    subject = f"إيصال دفع — تم تجديد اشتراك {name} / Payment receipt"
    ar = f"""
<h2>تم استلام الدفعة</h2>
<p>شكراً {name}، تم تجديد اشتراكك بنجاح.</p>
<ul>
<li>المبلغ: <b>{amount} {currency}</b></li>
<li>المدة المضافة: <b>{period_str}</b></li>
<li>تاريخ انتهاء الاشتراك الجديد: <b>{new_end}</b></li>
</ul>
"""
    en = f"""
<h2>Payment received</h2>
<p>Thank you {name}, your subscription has been renewed.</p>
<ul>
<li>Amount: <b>{amount} {currency}</b></li>
<li>Added period: <b>{period_str}</b></li>
<li>New expiry date: <b>{new_end}</b></li>
</ul>
"""
    text = f"Renewal: {amount} {currency}. New expiry: {new_end}."
    return subject, _wrap(ar, en), text


def _payment_failed(ctx: Dict) -> Tuple[str, str, str]:
    name = ctx.get("academy_name", "")
    reason = ctx.get("reason", "")
    subject = f"فشل عملية الدفع / Payment failed"
    ar = f"""
<h2>تعذّر إتمام الدفع</h2>
<p>عزيزي {name}، حصلت مشكلة أثناء معالجة دفعة التجديد.</p>
<p>السبب: {reason or 'غير معروف'}</p>
<p>يرجى المحاولة مجدداً أو التواصل مع فريق الدعم.</p>
"""
    en = f"""
<h2>Payment could not be completed</h2>
<p>Hello {name}, we were unable to process your renewal payment.</p>
<p>Reason: {reason or 'unknown'}</p>
<p>Please try again or contact support.</p>
"""
    text = f"Payment failed: {reason}"
    return subject, _wrap(ar, en), text


def _suspended(ctx: Dict) -> Tuple[str, str, str]:
    name = ctx.get("academy_name", "")
    reason = ctx.get("reason", "expired")
    subject = f"تم تعليق حساب أكاديميتك / Your academy has been suspended"
    ar = f"""
<h2>تنبيه: تم تعليق الحساب</h2>
<p>عزيزي {name}، تم تعليق حساب أكاديميتك (السبب: {reason}).</p>
<p>للمتابعة، يرجى التواصل مع فريق الدعم لتجديد الاشتراك.</p>
"""
    en = f"""
<h2>Account suspended</h2>
<p>Hello {name}, your academy account has been suspended (reason: {reason}).</p>
<p>To restore access, please contact support to renew your subscription.</p>
"""
    text = f"Suspended ({reason}). Contact support to renew."
    return subject, _wrap(ar, en), text


def _cancelled(ctx: Dict) -> Tuple[str, str, str]:
    name = ctx.get("academy_name", "")
    purge_at = _fmt_date(ctx.get("purge_at", ""))
    subject = f"جدولة حذف حساب أكاديميتك / Your academy is scheduled for deletion"
    ar = f"""
<h2>تم جدولة حذف الحساب</h2>
<p>عزيزي {name}، تمت جدولة حذف حسابك في <b>{purge_at}</b> (فترة سماح 7 أيام).</p>
<p>إذا كان هذا غير مقصود، يرجى التواصل معنا فوراً لإلغاء الحذف.</p>
"""
    en = f"""
<h2>Deletion scheduled</h2>
<p>Hello {name}, your academy account is scheduled for deletion on <b>{purge_at}</b> (7-day grace period).</p>
<p>If this was not intended, please contact us immediately to cancel.</p>
"""
    text = f"Account scheduled for deletion on {purge_at}."
    return subject, _wrap(ar, en), text


def _final_purge_warning(ctx: Dict) -> Tuple[str, str, str]:
    name = ctx.get("academy_name", "")
    purge_at = _fmt_date(ctx.get("purge_at", ""))
    subject = (
        f"تحذير نهائي: سيتم حذف بيانات أكاديميتك خلال 24 ساعة / "
        f"Final warning: your academy data will be permanently erased in 24 hours"
    )
    ar = f"""
<h2>تحذير نهائي قبل الحذف الدائم</h2>
<p>عزيزي {name}، انتهت فترة السماح لحساب أكاديميتك وسيتم حذف قاعدة بياناتك بشكل
نهائي ولا يمكن التراجع عنه خلال <b>24 ساعة تقريباً</b> (في موعد أقصاه {purge_at}).</p>
<p>إذا كنت ترغب في الحفاظ على بياناتك أو إلغاء الحذف، يرجى التواصل معنا فوراً
على <a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a> قبل انتهاء المهلة.</p>
<p>بعد تنفيذ الحذف، لن يكون من الممكن استعادة الأعضاء أو الفواتير أو السجلات.</p>
"""
    en = f"""
<h2>Final warning before permanent deletion</h2>
<p>Hello {name}, your academy's grace period has elapsed and your database is
scheduled to be <b>permanently and irreversibly erased within ~24 hours</b>
(no later than {purge_at}).</p>
<p>If you want to keep your data or cancel the deletion, please contact us
immediately at <a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a> before the
deadline.</p>
<p>Once the deletion runs, members, invoices and records cannot be recovered.</p>
"""
    text = (
        f"FINAL WARNING: {name}'s academy database will be permanently erased "
        f"within ~24 hours (by {purge_at}). Contact {SUPPORT_EMAIL} immediately "
        f"to cancel."
    )
    return subject, _wrap(ar, en), text


def _email_confirmation(ctx: Dict) -> Tuple[str, str, str]:
    name = ctx.get("academy_name", "")
    confirm_url = ctx.get("confirm_url", "")
    role = (ctx.get("role") or "owner").lower()
    role_ar = "بريد المالك" if role == "owner" else "بريد الفوترة"
    role_en = "owner email" if role == "owner" else "billing email"
    expires_hours = ctx.get("expires_hours", 24)
    subject = f"تأكيد البريد الإلكتروني / Confirm your {role_en}"
    ar = f"""
<h2>تأكيد البريد الإلكتروني</h2>
<p>طلبت أكاديمية <b>{name}</b> استخدام هذا البريد كـ<b>{role_ar}</b> للإشعارات.</p>
<p>اضغط على الرابط التالي لتأكيد ملكية البريد:</p>
<p><a href="{confirm_url}" style="display:inline-block;background:#0d6efd;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">تأكيد البريد</a></p>
<p style="color:#666;font-size:13px;">الرابط صالح لمدة {expires_hours} ساعة. إذا لم تطلب هذا التغيير، تجاهل هذه الرسالة.</p>
"""
    en = f"""
<h2>Confirm your email</h2>
<p>Academy <b>{name}</b> requested to use this address as the <b>{role_en}</b> for notifications.</p>
<p>Click the button below to confirm you own this address:</p>
<p><a href="{confirm_url}" style="display:inline-block;background:#0d6efd;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">Confirm email</a></p>
<p style="color:#666;font-size:13px;">This link expires in {expires_hours} hours. If you didn't request this change, you can ignore this message.</p>
"""
    text = f"Confirm your {role_en} for {name}: {confirm_url} (expires in {expires_hours} hours)."
    return subject, _wrap(ar, en), text


def _purge_completed(ctx: Dict) -> Tuple[str, str, str]:
    name = ctx.get("academy_name", "")
    deleted_at = _fmt_date(ctx.get("deleted_at", ""))
    subject = (
        f"تأكيد حذف بيانات أكاديميتك / "
        f"Confirmation: your academy data has been permanently erased"
    )
    ar = f"""
<h2>تم حذف بيانات أكاديميتك بشكل نهائي</h2>
<p>عزيزي {name}، نؤكد أنه تم حذف قاعدة بيانات أكاديميتك بشكل نهائي
ولا يمكن التراجع عنه بتاريخ <b>{deleted_at}</b>.</p>
<p>لم يعد بالإمكان استعادة الأعضاء أو الفواتير أو السجلات المرتبطة
بهذا الحساب.</p>
<p>إذا لم تكن قد طلبت هذا الحذف أو كان الأمر غير متوقع، يرجى التواصل
معنا فوراً على <a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a>.</p>
"""
    en = f"""
<h2>Your academy data has been permanently erased</h2>
<p>Hello {name}, we are confirming that your academy's database was
<b>permanently and irreversibly erased on {deleted_at}</b>.</p>
<p>Members, invoices and records associated with this account can no
longer be recovered.</p>
<p>If you did not request this deletion or it was unexpected, please
contact us immediately at
<a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a>.</p>
"""
    text = (
        f"Confirmation: {name}'s academy database was permanently erased on "
        f"{deleted_at}. Contact {SUPPORT_EMAIL} if this was unexpected."
    )
    return subject, _wrap(ar, en), text


TEMPLATES: Dict[str, Callable[[Dict], Tuple[str, str, str]]] = {
    "welcome": _welcome,
    "trial_ending": _trial_ending,
    "payment_success": _payment_success,
    "payment_failed": _payment_failed,
    "suspended": _suspended,
    "cancelled": _cancelled,
    "final_purge_warning": _final_purge_warning,
    "purge_completed": _purge_completed,
    "email_confirmation": _email_confirmation,
}


def render(kind: str, ctx: Dict) -> Tuple[str, str, str]:
    fn = TEMPLATES.get(kind)
    if not fn:
        raise ValueError(f"Unknown email template: {kind}")
    return fn(ctx or {})
