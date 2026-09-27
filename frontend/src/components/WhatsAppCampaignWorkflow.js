import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { toast } from 'sonner';
import WhatsAppCampaignReport from './WhatsAppCampaignReport';
import { apiErrorMessage } from '../utils/apiErrorMessage';

const templates = [
  ['تذكير التجديد', 'مرحباً {الاسم} 👋\nاشتراكك ينتهي بتاريخ {تاريخ_الانتهاء}. يسعدنا استمرارك معنا، تواصل مع الفرع للتجديد.'],
  ['مواعيد التدريب', 'مرحباً {الاسم} 🏊\nتذكير بموعد التدريب: [اليوم والوقت]\nالمكان: [الفرع].'],
  ['بطولة جديدة', 'مرحباً {الاسم} 🏆\nندعوك للمشاركة في بطولة [الاسم] يوم [التاريخ].\nتفاصيل التسجيل: [التفاصيل].'],
  ['عرض اشتراك', 'مرحباً {الاسم} ⭐\nعرض [تفاصيل العرض] متاح حتى [التاريخ].\nللاستفسار تواصل مع الفرع.'],
];
const labels = { pending_review:'بانتظار اعتماد المدير', scheduled:'معتمد ومجدول', preparing:'جارٍ تجهيز الإرسال', queued:'معتمد في طابور الإرسال', cancelled:'ملغى' };

export default function WhatsAppCampaignWorkflow({ branchId, items, message, defaultName, audience, onSave, onMessage, scheduleAt='', onSchedule=()=>{} }) {
  const { user } = useAuth();
  const [rows,setRows]=useState([]), [groups,setGroups]=useState([]), [group,setGroup]=useState('');
  const [expiring,setExpiring]=useState(false);
  const when=scheduleAt;
  const [preview,setPreview]=useState(null), [excluded,setExcluded]=useState([]);
  const [busy,setBusy]=useState(false), [report,setReport]=useState(null);
  const scope=useRef(branchId), generation=useRef(0);
  scope.current=branchId;
  const refresh=async()=>{
    if (!branchId) return;
    const response=await axios.get('/api/whatsapp/workflow',{params:{branch_id:branchId}});
    if(scope.current===branchId) setRows(response.data);
  };
  useEffect(()=>{
    generation.current+=1; setRows([]);setGroups([]);setGroup('');setExpiring(false);setExcluded([]);setPreview(null);setReport(null);setBusy(false);
    if(!branchId) return undefined;
    refresh().catch(e=>toast.error(apiErrorMessage(e,'تعذر تحميل الحملات المعتمدة')));
    axios.get('/api/whatsapp/workflow/groups',{params:{branch_id:branchId}}).then(r=>{if(scope.current===branchId)setGroups(r.data);}).catch(()=>{});
    const timer=setInterval(()=>refresh().catch(()=>{}),15000);
    return ()=>clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[branchId]);
  useEffect(()=>{generation.current+=1;setPreview(null);setExcluded([]);},[items,message,defaultName,audience,group,expiring]);
  const data=()=>({branch_id:branchId,audience:expiring?'expiring_members':audience,
    recipients:!expiring && audience==='pasted'?items.map(i=>({phone:i.phone,name:i.name,member_id:i.member_id})):[],message,default_name:defaultName,group_id:group});
  const act=async(fn)=>{
    const current=branchId; setBusy(true);
    try { await fn(); if(scope.current===current) await refresh(); }
    catch(e){if(scope.current===current)toast.error(apiErrorMessage(e,'تعذر تنفيذ العملية'));}
    finally {if(scope.current===current)setBusy(false);}
  };
  const showPreview=()=>act(async()=>{
    const version=++generation.current;
    const response=await axios.post('/api/whatsapp/workflow/preview',data());
    if(version===generation.current && scope.current===branchId) {setPreview(response.data);setExcluded([]);}
  });
  const submit=()=>act(async()=>{
    if(!preview || !preview.count)throw new Error('جهّز المعاينة أولاً');
    if(!window.confirm('إرسال هذه المعاينة إلى المدير لاعتماد الإرسال؟'))return;
    const currentGeneration=generation.current;
    const id=await onSave();
    if(!id || scope.current!==branchId || currentGeneration!==generation.current)return;
    await axios.post('/api/whatsapp/workflow/submit',{...data(),audience:'pasted',
      recipients:preview.recipients,excluded_phones:excluded,campaign_id:id,
      schedule_at:when?new Date(when).toISOString():null});
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
  return <section className="rounded-xl border bg-white p-5 space-y-4" dir="rtl">
    <h2 className="font-bold text-lg">معاينة الحملة واعتماد الإرسال</h2>
    <p className="text-sm text-slate-500">تخصيص الاسم: {'{الاسم}'} · تاريخ انتهاء الاشتراك: {'{تاريخ_الانتهاء}'} · حتى 200 مستلم للحملة.</p>
    <div className="flex flex-wrap gap-2">{templates.map(([name,text])=><Button key={name} variant="outline" onClick={()=>onMessage(text)}>{name}</Button>)}</div>
    <div className="grid md:grid-cols-2 gap-3">
      <label>المجموعة<select aria-label="مجموعة الحملة" className="block border rounded p-2 w-full" value={group} onChange={e=>setGroup(e.target.value)}>
        <option value="">كل المجموعات</option>{groups.map(g=><option key={g.id} value={g.id}>{g.custom_name||`المستوى ${g.level_number}`}</option>)}
      </select></label>
      <label>موعد الإرسال الفعلي<input aria-label="موعد الإرسال الفعلي" type="datetime-local" className="block border rounded p-2 w-full" value={when} onChange={e=>onSchedule(e.target.value)}/><small>بتوقيت جهازك. يبدأ الإرسال بعد اعتماد المدير، حسب اتصال الخدمة وحصتها.</small></label>
    </div>
    <label className="flex gap-2"><input type="checkbox" checked={expiring} onChange={e=>setExpiring(e.target.checked)}/>استهداف اشتراكات تنتهي خلال 7 أيام</label>
    <Button disabled={busy||!branchId||!message.trim()} onClick={showPreview}>معاينة المستلمين والرسائل</Button>
    {preview && <div className="space-y-3">
      <p className="text-emerald-800">المحدد: {chosen.length} · مكرر: {preview.removed.duplicates} · غير صالح: {preview.removed.invalid} · طلب إيقاف الرسائل: {preview.removed.opted_out}</p>
      <div className="max-h-96 overflow-auto border rounded"><table className="w-full text-sm"><thead><tr><th>تحديد</th><th>المستلم</th><th>الرسالة الفعلية</th></tr></thead><tbody>
        {preview.recipients.map(r=><tr key={r.phone} className="border-t"><td className="p-2"><input aria-label={`تحديد ${r.phone}`} type="checkbox" checked={!excluded.includes(r.phone)} onChange={e=>setExcluded(old=>e.target.checked?old.filter(p=>p!==r.phone):[...old,r.phone])}/></td><td className="p-2">{r.name}<div dir="ltr">+{r.phone}</div></td><td className="p-2 whitespace-pre-wrap">{r.message}</td></tr>)}
      </tbody></table></div>
      <Button disabled={busy||!chosen.length} onClick={submit}>حفظ وإرسال لاعتماد المدير</Button>
    </div>}
    <h3 className="font-bold">طلبات الاعتماد وجدولة الحملات</h3>
    {!rows.length && <p className="text-slate-500">لا توجد طلبات اعتماد لهذا الفرع.</p>}
    {rows.map(row=><details key={row.id} className="border rounded p-3">
      <summary>{row.title} · {labels[row.status]||row.status} · {row.count} مستلم {row.schedule_at?`· ${new Date(row.schedule_at).toLocaleString('ar-SA')}`:'· إرسال بعد الاعتماد'}</summary>
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
