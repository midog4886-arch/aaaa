import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { toast } from 'sonner';
import WhatsAppCampaignReport from './WhatsAppCampaignReport';
import { apiErrorMessage } from '../utils/apiErrorMessage';
import { campaignCalendar, riyadhDate, riyadhMonth, shiftMonth } from './campaignCalendar';

const templates = [
  ['تذكير التجديد', 'مرحباً {الاسم} 👋\nاشتراكك ينتهي بتاريخ {تاريخ_الانتهاء}. يسعدنا استمرارك معنا، تواصل مع الفرع للتجديد.'],
  ['مواعيد التدريب', 'مرحباً {الاسم} 🏊\nتذكير بموعد التدريب: [اليوم والوقت]\nالمكان: [الفرع].'],
  ['بطولة جديدة', 'مرحباً {الاسم} 🏆\nندعوك للمشاركة في بطولة [الاسم] يوم [التاريخ].\nتفاصيل التسجيل: [التفاصيل].'],
  ['عرض اشتراك', 'مرحباً {الاسم} ⭐\nعرض [تفاصيل العرض] متاح حتى [التاريخ].\nللاستفسار تواصل مع الفرع.'],
];
const labels = { pending_review:'بانتظار اعتماد المدير', scheduled:'معتمد ومجدول', preparing:'جارٍ تجهيز الإرسال', queued:'معتمد في طابور الإرسال', cancelled:'ملغى' };

export default function WhatsAppCampaignWorkflow({ branchId, items, message, defaultName, audience, onSave, onMessage, scheduleAt='', onSchedule=()=>{}, spreadAcrossDays=false, dailyRecipients=30, startDate='', sendTime='10:00', dailyLimit=null, attachmentCount=1 }) {
  const { user } = useAuth();
  const [rows,setRows]=useState([]), [groups,setGroups]=useState([]), [group,setGroup]=useState('');
  const when=scheduleAt;
  const [preview,setPreview]=useState(null), [excluded,setExcluded]=useState([]);
  const [busy,setBusy]=useState(false), [report,setReport]=useState(null);
  const [calendarMonth,setCalendarMonth]=useState(riyadhMonth);
  const [selectedCalendarDay,setSelectedCalendarDay]=useState('');
  const scope=useRef(branchId), generation=useRef(0);
  scope.current=branchId;
  const refresh=async()=>{
    if (!branchId) return;
    const response=await axios.get('/api/whatsapp/workflow',{params:{branch_id:branchId}});
    if(scope.current===branchId) setRows(response.data);
  };
  useEffect(()=>{
    generation.current+=1; setRows([]);setGroups([]);setGroup('');setExcluded([]);setPreview(null);setReport(null);setBusy(false);setSelectedCalendarDay('');
    if(!branchId) return undefined;
    refresh().catch(e=>toast.error(apiErrorMessage(e,'تعذر تحميل الحملات المعتمدة')));
    axios.get('/api/whatsapp/workflow/groups',{params:{branch_id:branchId}}).then(r=>{if(scope.current===branchId)setGroups(r.data);}).catch(()=>{});
    const timer=setInterval(()=>refresh().catch(()=>{}),15000);
    return ()=>clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[branchId]);
  useEffect(()=>{generation.current+=1;setPreview(null);setExcluded([]);},[items,message,defaultName,audience,group,spreadAcrossDays,dailyRecipients,startDate,sendTime]);
  const data=()=>({branch_id:branchId,audience,
    recipients:audience==='pasted'?items.map(i=>({phone:i.phone,name:i.name,member_id:i.member_id})):[],message,default_name:defaultName,group_id:group,
    ...(spreadAcrossDays ? {daily_recipients:Number(dailyRecipients),start_date:startDate,send_time:sendTime} : {})});
  const act=async(fn)=>{
    const current=branchId; setBusy(true);
    try { await fn(); if(scope.current===current) await refresh(); }
    catch(e){if(scope.current===current)toast.error(apiErrorMessage(e,'تعذر تنفيذ العملية'));}
    finally {if(scope.current===current)setBusy(false);}
  };
  const showPreview=()=>act(async()=>{
    if(spreadAcrossDays && dailyLimit && Number(dailyRecipients)*attachmentCount>dailyLimit)
      throw new Error(`حد الفرع ${dailyLimit} رسالة يومياً. خفّض عدد المستلمين اليومي إلى ${Math.floor(dailyLimit/attachmentCount)} أو أقل.`);
    const version=++generation.current;
    const response=await axios.post('/api/whatsapp/workflow/preview',data());
    if(version===generation.current && scope.current===branchId) {setPreview(response.data);setExcluded([]);}
  });
  const submit=()=>act(async()=>{
    if(!preview || !preview.count)throw new Error('جهّز المعاينة أولاً');
    const repeated=(preview.recent_similar_phones||[]).filter(phone=>!excluded.includes(phone));
    if(repeated.length && !window.confirm(`هناك ${repeated.length} مستلم تلقّى النص نفسه خلال آخر 30 يوماً أو كانت نتيجة إرساله غير مؤكدة. هل تريد إبقاءهم ضمن الحملة؟`))return;
    if(!window.confirm('إرسال هذه المعاينة إلى المدير لاعتماد الإرسال؟'))return;
    const currentGeneration=generation.current;
    const id=await onSave();
    if(!id || scope.current!==branchId || currentGeneration!==generation.current)return;
    await axios.post('/api/whatsapp/workflow/submit',{...data(),audience:'pasted',
      recipients:preview.recipients,excluded_phones:excluded,campaign_id:id,
      schedule_at:spreadAcrossDays?null:(when?new Date(when).toISOString():null)});
    toast.success('تم إرسال نسخة ثابتة من الرسائل والمستلمين لاعتماد المدير');setPreview(null);
  });
  const action=(row,name)=>act(async()=>{
    const text=name==='approve'?'اعتماد هذه الرسائل وإرسالها في الموعد المحدد، أو الآن إذا لم يُحدد موعد؟':name==='retry'?'إعادة إرسال الفاشل فقط؟ الرسائل المرسلة أو ذات النتيجة غير المؤكدة لن تُعاد.':'إلغاء الرسائل التي لم تُرسل بعد؟';
    if(!window.confirm(text))return;
    await axios.post(`/api/whatsapp/workflow/${row.id}/${name}`,{}, {params:{branch_id:branchId}});
  });
  const viewMedia=(row,index)=>act(async()=>{
    const response=await axios.get(`/api/whatsapp/workflow/${row.id}/media/${index}`,{params:{branch_id:branchId},responseType:'blob'});
    if(scope.current!==branchId)return;
    const url=URL.createObjectURL(response.data);
    const link=document.createElement('a');link.href=url;link.download=row.media[index].attachment_name||'campaign-media';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  });
  const chosen=(preview?.recipients||[]).filter(r=>!excluded.includes(r.phone));
  const calendarDays=campaignCalendar(rows,calendarMonth);
  const monthLabel=new Intl.DateTimeFormat('ar-SA-u-ca-gregory',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${calendarMonth}-01T00:00:00Z`));
  const firstWeekday=new Date(`${calendarMonth}-01T00:00:00Z`).getUTCDay();
  const calendarCells=[...Array(firstWeekday).fill(null),...calendarDays];
  const selectedDay=calendarDays.find(day=>day.date===selectedCalendarDay);
  const today=riyadhDate(new Date());
  return <section className="rounded-xl border bg-white p-5 space-y-4" dir="rtl">
    <h2 className="font-bold text-lg">معاينة الحملة واعتماد الإرسال</h2>
    <p className="text-sm text-slate-500">تخصيص الاسم: {'{الاسم}'} · تاريخ انتهاء الاشتراك: {'{تاريخ_الانتهاء}'} · حتى {spreadAcrossDays?'1000 مستلم للحملة المقسمة':'200 مستلم للحملة المباشرة'}.</p>
    <div className="flex flex-wrap gap-2">{templates.map(([name,text])=><Button key={name} variant="outline" onClick={()=>onMessage(text)}>{name}</Button>)}</div>
    <div className="grid md:grid-cols-2 gap-3">
      <label>المجموعة<select aria-label="مجموعة الحملة" className="block border rounded p-2 w-full" value={group} onChange={e=>setGroup(e.target.value)}>
        <option value="">كل المجموعات</option>{groups.map(g=><option key={g.id} value={g.id}>{g.custom_name||`المستوى ${g.level_number}`}</option>)}
      </select></label>
      {!spreadAcrossDays && <label>موعد الإرسال الفعلي<input aria-label="موعد الإرسال الفعلي" type="datetime-local" className="block border rounded p-2 w-full" value={when} onChange={e=>onSchedule(e.target.value)}/><small>بتوقيت جهازك. يبدأ الإرسال بعد اعتماد المدير، حسب اتصال الخدمة وحصتها.</small></label>}
      {spreadAcrossDays && <p className="text-sm text-slate-600">تبدأ الدفعة الأولى بتاريخ {startDate||'—'} الساعة {sendTime} بتوقيت الرياض، بعد اعتماد المدير. حتى {dailyRecipients} مستلم يومياً. {dailyLimit?`حد الفرع ${dailyLimit} رسالة يومياً.`:''}</p>}
    </div>
    <Button disabled={busy||!branchId||!message.trim()} onClick={showPreview}>معاينة المستلمين والرسائل</Button>
    {preview && <div className="space-y-3">
      <p className="text-emerald-800">المحدد: {chosen.length} · مكرر: {preview.removed.duplicates} · غير صالح: {preview.removed.invalid} · طلب إيقاف الرسائل: {preview.removed.opted_out}</p>
      {!!preview.recent_similar_phones?.length && <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <p>تنبيه: {preview.recent_similar_phones.length} مستلم تلقّى النص نفسه خلال 30 يوماً أو كانت نتيجة إرساله غير مؤكدة. راجعهم قبل الاعتماد.</p>
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={()=>setExcluded(old=>[...new Set([...old,...preview.recent_similar_phones])])}>استبعاد هؤلاء المستلمين</Button>
      </div>}
      <div className="max-h-96 overflow-auto border rounded"><table className="w-full text-sm"><thead><tr><th>تحديد</th><th>المستلم</th><th>الرسالة الفعلية</th></tr></thead><tbody>
        {preview.recipients.map(r=><tr key={r.phone} className="border-t"><td className="p-2"><input aria-label={`تحديد ${r.phone}`} type="checkbox" checked={!excluded.includes(r.phone)} onChange={e=>setExcluded(old=>e.target.checked?old.filter(p=>p!==r.phone):[...old,r.phone])}/></td><td className="p-2">{r.name}<div dir="ltr">+{r.phone}</div></td><td className="p-2 whitespace-pre-wrap">{r.message}</td></tr>)}
      </tbody></table></div>
      <Button disabled={busy||!chosen.length} onClick={submit}>حفظ وإرسال لاعتماد المدير</Button>
    </div>}
    <h3 className="font-bold">طلبات الاعتماد وجدولة الحملات</h3>
    <div className="rounded-lg border p-3 space-y-3" data-testid="branch-campaign-calendar">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h4 className="font-bold">جدول إرسال حملات الفرع</h4><p className="text-xs text-slate-500">خطة الإرسال بتوقيت الرياض للفرع المختار أعلاه. الأعداد المعلّقة تنتظر اعتماد المدير؛ التنفيذ الفعلي يتبع حالة الطابور.</p></div>
        <div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" onClick={()=>{setCalendarMonth(month=>shiftMonth(month,-1));setSelectedCalendarDay('');}}>الشهر السابق</Button><span className="min-w-28 text-center font-medium">{monthLabel}</span><Button type="button" variant="outline" size="sm" onClick={()=>{setCalendarMonth(month=>shiftMonth(month,1));setSelectedCalendarDay('');}}>الشهر التالي</Button></div>
      </div>
      <div className="overflow-x-auto"><div className="min-w-[700px]"><div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500">{['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'].map(name=><div key={name} className="py-2">{name}</div>)}</div>
      <div className="grid grid-cols-7 gap-1" role="grid" aria-label={`تقويم حملات ${monthLabel}`}>
        {calendarCells.map((day,index)=>day?<button type="button" key={day.date} aria-label={`${day.date}: ${day.approved} معتمد، ${day.awaiting} بانتظار الاعتماد`} aria-pressed={selectedCalendarDay===day.date} onClick={()=>setSelectedCalendarDay(day.date)} className={`min-h-24 rounded border p-2 text-right align-top transition-colors hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${selectedCalendarDay===day.date?'border-blue-600 bg-blue-50':day.campaigns.length?'border-blue-200 bg-blue-50/40':'border-slate-200 bg-slate-50/50'}`}>
          <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-bold ${today===day.date?'bg-blue-600 text-white':'text-slate-700'}`}>{Number(day.date.slice(-2))}</span>
          {day.campaigns.length?<div className="mt-1 space-y-1 text-xs"><div className="font-semibold text-emerald-800">{day.approved} معتمد</div>{day.awaiting>0&&<div className="font-semibold text-amber-700">{day.awaiting} ينتظر</div>}<div className="truncate text-slate-600" title={day.campaigns.map(item=>item.title).join('، ')}>{day.campaigns[0].title}{day.campaigns.length>1?` +${day.campaigns.length-1}`:''}</div></div>:<div className="mt-2 text-xs text-slate-400">لا إرسال</div>}
        </button>:<div key={`blank-${index}`} aria-hidden="true" className="min-h-24 rounded bg-slate-50/40"/>)}
      </div></div></div>
      {selectedDay&&<div className="rounded border bg-white p-3 text-sm"><h5 className="mb-2 font-bold">{selectedDay.date} · {selectedDay.campaigns.length?'تفاصيل الحملات':'لا يوجد إرسال مجدول'}</h5>{selectedDay.campaigns.map(item=><div key={item.id} className="border-t py-2">{item.title} · {item.count} مستلم · {item.pending?'بانتظار اعتماد المدير':'معتمد'}</div>)}</div>}
    </div>
    {!rows.length && <p className="text-slate-500">لا توجد طلبات اعتماد لهذا الفرع.</p>}
    {rows.map(row=><details key={row.id} className="border rounded p-3">
      <summary>{row.title} · {labels[row.status]||row.status} · {row.count} مستلم {row.daily_recipients?`· ${row.daily_recipients} مستلم يومياً من ${row.start_date} ${row.send_time} بتوقيت الرياض`:(row.schedule_at?`· ${new Date(row.schedule_at).toLocaleString('ar-SA')}`:'· إرسال بعد الاعتماد')}</summary>
      <div className="space-y-3 mt-3">
        <div className="max-h-60 overflow-auto">{row.recipients.map(r=><div key={r.phone} className="border-b py-2"><b>{r.name} · +{r.phone}</b><p className="whitespace-pre-wrap">{r.message}</p></div>)}</div>
        <div className="flex gap-2 flex-wrap">{(row.media||[]).map((ref,index)=><Button variant="outline" key={index} disabled={busy} onClick={()=>viewMedia(row,index)}>معاينة المرفق: {ref.attachment_name}</Button>)}</div>
        {row.error && <p className="text-red-700">{row.error}</p>}
        {row.job && <p>مرسل: {row.job.sent} · فاشل: {row.job.failed} · متبقٍ: {row.job.pending} · غير مؤكد: {row.job.unknown}{row.job.pause_reason?` · توقف مؤقت: ${row.job.pause_reason}`:''}</p>}
        <div className="flex flex-wrap gap-2">
          {user?.is_admin && row.status==='pending_review' && <Button disabled={busy} onClick={()=>action(row,'approve')}>اعتماد وإرسال / جدولة</Button>}
          {['pending_review','scheduled','queued'].includes(row.status) && <Button disabled={busy} variant="outline" onClick={()=>action(row,'cancel')}>إلغاء</Button>}
          {user?.is_admin && row.job?.failed>0 && !row.job.pending && row.status==='queued' && <Button disabled={busy} variant="outline" onClick={()=>action(row,'retry')}>إعادة محاولة الفاشل فقط</Button>}
          {row.job && <Button variant="outline" onClick={()=>setReport(row.job)}>تقرير التسليم والقراءة</Button>}
        </div>
      </div>
    </details>)}
    {report && <WhatsAppCampaignReport job={report} branchId={branchId} open language="ar" onOpenChange={open=>{if(!open)setReport(null);}}/>}
  </section>;
}
