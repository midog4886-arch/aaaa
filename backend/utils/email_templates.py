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


def _cancel_button(cancel_url: str, label_ar: str, label_en: str) -> Tuple[str, str, str]:
    if not cancel_url:
        return "", "", ""
    btn_ar = (
        f'<p style="margin-top:18px;"><a href="{cancel_url}" '
        'style="display:inline-block;background:#dc2626;color:#fff;padding:10px 18px;'
        f'border-radius:6px;text-decoration:none;font-weight:bold;">{label_ar}</a></p>'
        '<p style="color:#666;font-size:13px;">إذا لم يعمل الزر، انسخ هذا الرابط في المتصفح:<br/>'
        f'<span style="word-break:break-all;">{cancel_url}</span></p>'
    )
    btn_en = (
        f'<p style="margin-top:18px;"><a href="{cancel_url}" '
        'style="display:inline-block;background:#dc2626;color:#fff;padding:10px 18px;'
        f'border-radius:6px;text-decoration:none;font-weight:bold;">{label_en}</a></p>'
        '<p style="color:#666;font-size:13px;">If the button does not work, copy this link into your browser:<br/>'
        f'<span style="word-break:break-all;">{cancel_url}</span></p>'
    )
    return btn_ar, btn_en, f" Cancel link: {cancel_url}"


def _cancelled(ctx: Dict) -> Tuple[str, str, str]:
    name = ctx.get("academy_name", "")
    purge_at = _fmt_date(ctx.get("purge_at", ""))
    cancel_url = (ctx.get("cancel_url") or "").strip()
    btn_ar, btn_en, txt_extra = _cancel_button(
        cancel_url,
        "إلغاء الحذف الآن",
        "Cancel deletion now",
    )
    subject = f"جدولة حذف حساب أكاديميتك / Your academy is scheduled for deletion"
    ar = f"""
<h2>تم جدولة حذف الحساب</h2>
<p>عزيزي {name}، تمت جدولة حذف حسابك في <b>{purge_at}</b> (فترة سماح 7 أيام).</p>
<p>إذا كان هذا غير مقصود، يمكنك إلغاء الحذف بنقرة واحدة من الزر أدناه أو التواصل معنا فوراً.</p>
{btn_ar}
"""
    en = f"""
<h2>Deletion scheduled</h2>
<p>Hello {name}, your academy account is scheduled for deletion on <b>{purge_at}</b> (7-day grace period).</p>
<p>If this was not intended, you can cancel the deletion in one click using the button below, or contact us immediately.</p>
{btn_en}
"""
    text = f"Account scheduled for deletion on {purge_at}.{txt_extra}"
    return subject, _wrap(ar, en), text


def _final_purge_warning(ctx: Dict) -> Tuple[str, str, str]:
    name = ctx.get("academy_name", "")
    purge_at = _fmt_date(ctx.get("purge_at", ""))
    cancel_url = (ctx.get("cancel_url") or "").strip()
    btn_ar, btn_en, txt_extra = _cancel_button(
        cancel_url,
        "إلغاء الحذف الآن — احفظ بياناتي",
        "Cancel deletion now — keep my data",
    )
    subject = (
        f"تحذير نهائي: سيتم حذف بيانات أكاديميتك خلال 24 ساعة / "
        f"Final warning: your academy data will be permanently erased in 24 hours"
    )
    ar = f"""
<h2>تحذير نهائي قبل الحذف الدائم</h2>
<p>عزيزي {name}، انتهت فترة السماح لحساب أكاديميتك وسيتم حذف قاعدة بياناتك بشكل
نهائي ولا يمكن التراجع عنه خلال <b>24 ساعة تقريباً</b> (في موعد أقصاه {purge_at}).</p>
<p>لإلغاء الحذف فوراً والاحتفاظ ببياناتك، اضغط على الزر أدناه. يمكنك أيضاً
التواصل معنا على <a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a> قبل
انتهاء المهلة.</p>
{btn_ar}
<p>بعد تنفيذ الحذف، لن يكون من الممكن استعادة الأعضاء أو الفواتير أو السجلات.</p>
"""
    en = f"""
<h2>Final warning before permanent deletion</h2>
<p>Hello {name}, your academy's grace period has elapsed and your database is
scheduled to be <b>permanently and irreversibly erased within ~24 hours</b>
(no later than {purge_at}).</p>
<p>To cancel the deletion immediately and keep your data, click the button
below. You can also contact us at
<a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a> before the deadline.</p>
{btn_en}
<p>Once the deletion runs, members, invoices and records cannot be recovered.</p>
"""
    text = (
        f"FINAL WARNING: {name}'s academy database will be permanently erased "
        f"within ~24 hours (by {purge_at}). Contact {SUPPORT_EMAIL} immediately "
        f"to cancel.{txt_extra}"
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


def _email_confirmation_expired(ctx: Dict) -> Tuple[str, str, str]:
    name = ctx.get("academy_name", "")
    role = (ctx.get("role") or "owner").lower()
    role_ar = "بريد المالك" if role == "owner" else "بريد الفوترة"
    role_en = "owner email" if role == "owner" else "billing email"
    pending_email = ctx.get("pending_email", "")
    requested_at = _fmt_date(ctx.get("requested_at", ""))
    subject = (
        f"انتهت صلاحية رابط تأكيد البريد / "
        f"Your {role_en} confirmation link expired"
    )
    ar = f"""
<h2>طلب تغيير البريد لم يُؤكَّد</h2>
<p>عزيزي {name}، انتهت صلاحية رابط تأكيد <b>{role_ar}</b> الجديد
(<b>{pending_email}</b>) الذي طلبته بتاريخ {requested_at} دون النقر عليه.</p>
<p>ما زال البريد القديم (هذا العنوان) هو المعتمد لاستقبال جميع الإشعارات
الهامة، وإذا أردت إكمال التغيير افتح صفحة الإعدادات → الاشتراك والفوترة
واضغط على «إعادة إرسال التأكيد» لإصدار رابط جديد.</p>
"""
    en = f"""
<h2>Email change was not confirmed</h2>
<p>Hello {name}, the confirmation link for your new <b>{role_en}</b>
(<b>{pending_email}</b>), requested on {requested_at}, has expired without
being clicked.</p>
<p>This address (the previously confirmed one) remains in effect for all
important notifications. To complete the change, open Settings →
Subscription &amp; Billing and click "Resend confirmation" to issue a new
link.</p>
"""
    text = (
        f"Confirmation for new {role_en} {pending_email} expired without "
        f"being clicked. The old address remains active. Resend the link "
        f"from Settings → Subscription & Billing if you still want to change it."
    )
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


def _super_admin_signature_failures(ctx: Dict) -> Tuple[str, str, str]:
    provider = (ctx.get("provider") or "").strip() or "unknown"
    count = ctx.get("count", 0)
    window_minutes = ctx.get("window_minutes", 10)
    threshold = ctx.get("threshold", 5)
    secret_env = (ctx.get("secret_env") or "").strip() or "PAYMENT_WEBHOOK_SECRET"
    subject = (
        f"[Champions Academy] Payment webhook signature failures: {provider}"
    )
    en = f"""
<h2>Payment webhook signature failures</h2>
<p>The <b>{provider}</b> payment provider webhook has failed signature
verification <b>{count}</b> times in the last <b>{window_minutes} minutes</b>
(threshold: {threshold}).</p>
<p>This usually means one of:</p>
<ul>
<li>The signing secret in env var <code>{secret_env}</code> is missing or
out of date (rotated on the provider side without an update here).</li>
<li>An attacker is probing the webhook endpoint.</li>
</ul>
<p>Open <b>Super Admin → Payment Settings</b> to verify the secret and
inspect recent webhook deliveries.</p>
"""
    ar = f"""
<h2>فشل تحقق توقيع ويب-هوك الدفع</h2>
<p>فشل التحقق من توقيع ويب-هوك مزوّد الدفع <b>{provider}</b> عدد
<b>{count}</b> مرة خلال آخر <b>{window_minutes} دقيقة</b> (الحد: {threshold}).</p>
<p>الأسباب المحتملة عادةً:</p>
<ul>
<li>سر التوقيع في متغير البيئة <code>{secret_env}</code> مفقود أو قديم
(تم تدويره من جانب المزوّد دون تحديث هنا).</li>
<li>محاولة عبث على نقطة استقبال الويب-هوك.</li>
</ul>
<p>افتح <b>لوحة المشرف الأعلى ← إعدادات الدفع</b> للتحقق من السر ومراجعة
آخر عمليات استقبال الويب-هوك.</p>
"""
    text = (
        f"Payment webhook signature failures for {provider}: {count} in the "
        f"last {window_minutes}m (threshold {threshold}). Check env var "
        f"{secret_env} or the super-admin payment settings."
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
    "email_confirmation_expired": _email_confirmation_expired,
    "super_admin_signature_failures": _super_admin_signature_failures,
}


def render(kind: str, ctx: Dict) -> Tuple[str, str, str]:
    fn = TEMPLATES.get(kind)
    if not fn:
        raise ValueError(f"Unknown email template: {kind}")
    return fn(ctx or {})
