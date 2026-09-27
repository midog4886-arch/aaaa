import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
const templates = [
  ['نتائج بطولة','🏆 نتائج بطولة [اسم البطولة]\nتهانينا لأبطالنا على الإنجاز!\n[المراكز والنتائج]\n#أداء_الأبطال'],
  ['أفضل لاعب','⭐ نبارك للاعب [اسم اللاعب] تألقه في [النشاط]!\n[سبب التكريم]\n#أبطال_الأكاديمية'],
  ['فتح التسجيل','📣 فتح التسجيل في [النشاط] بفرع [الفرع]\nالفئة العمرية: [الفئة]\nالمواعيد: [المواعيد]\nللتسجيل: [الرابط]'],
  ['عرض اشتراك','🎉 عرض [اسم العرض]\n[تفاصيل العرض وشروطه]\nمتاح حتى [التاريخ]\nللاستفسار: [رقم التواصل]'],
  ['مواعيد تدريب','📅 مواعيد تدريب [النشاط]\nالفرع: [الفرع]\nالأيام: [الأيام]\nالوقت: [الوقت]'],
];
const states={draft:'مسودة',pending_review:'بانتظار الاعتماد',approved:'معتمد للنشر اليدوي',scheduled:'مجدول',publishing:'جارٍ النشر',done:'نُشر / قُبل لدى المنصات',partial:'نجاح جزئي',failed:'فشل',cancelled:'ملغى',unknown:'النتيجة غير مؤكدة — راجع المنصات'};
const platforms={facebook:'Facebook',instagram:'Instagram',youtube:'YouTube',tiktok:'TikTok'};
export default function SocialEditorialHub({ payload, media, onRestore, onCaption }) {
  const { user,isAdmin,selectedBranchId }=useAuth();
  const admin=isAdmin||user?.is_admin;
  const [tab,setTab]=useState('drafts'),[plans,setPlans]=useState([]),[library,setLibrary]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[title,setTitle]=useState(''),[schedule,setSchedule]=useState(''),[editing,setEditing]=useState(null),[filter,setFilter]=useState(''),[category,setCategory]=useState('');
  const generation=useRef(0);
  const scopeRef=useRef('');scopeRef.current=`${user?.id||''}:${selectedBranchId}`;
  const load=async()=>{
    const request=++generation.current;setError('');
    try{const params=selectedBranchId&&selectedBranchId!=='all'?{branch_filter:selectedBranchId}:{};const [p,m]=await Promise.all([axios.get('/api/social/workflow/plans',{params}),axios.get('/api/social/workflow/media',{params})]);if(request===generation.current){setPlans(p.data);setLibrary(m.data);}}
    catch{if(request===generation.current)setError('تعذر تحميل المسودات والمكتبة.');}
  };
  useEffect(()=>{setPlans([]);setLibrary([]);setEditing(null);setTitle('');setSchedule('');load();const identity=scopeRef.current;const timer=setInterval(async()=>{try{const params=selectedBranchId&&selectedBranchId!=='all'?{branch_filter:selectedBranchId}:{};const r=await axios.get('/api/social/workflow/plans',{params});if(identity===scopeRef.current)setPlans(r.data);}catch{}},30000);return()=>{generation.current+=1;clearInterval(timer);};},[selectedBranchId,user?.id]);
  const action=async(path,body={})=>{
    const identity=scopeRef.current;
    setBusy(true);try{await axios.post(path,body);if(identity!==scopeRef.current)return;await load();toast.success('تم تحديث حالة المنشور');}catch(e){if(identity===scopeRef.current)toast.error(typeof e.response?.data?.detail==='string'?e.response.data.detail:'تعذر تنفيذ الإجراء');}finally{setBusy(false);}
  };
  const save=async()=>{
    if(!title.trim()||!payload?.media_filename){toast.error('أدخل عنوان المسودة واختر وسيطًا من مكتبة الوسائط أو ارفعه أولًا');return;}
    if(payload.video_edits?.logo?.source==='custom'&&!payload.video_edits.logo.filename){toast.error('احفظ وسيط الشعار المخصص أولًا أو اختر الشعار الافتراضي قبل حفظ المسودة');return;}
    let schedule_at=null;
    if(schedule){const date=new Date(schedule);if(!Number.isFinite(date.getTime())||date<=new Date()){toast.error('اختر موعدًا مستقبليًا');return;}schedule_at=date.toISOString();}
    setBusy(true);
    const identity=scopeRef.current;
    try{const data={title,category,branch_id:selectedBranchId==='all'?null:selectedBranchId,payload,schedule_at,revision:editing?.revision||0};const result=editing?await axios.put(`/api/social/workflow/plans/${editing.id}`,data):await axios.post('/api/social/workflow/plans',data);if(identity!==scopeRef.current)return;setEditing(result.data);await load();toast.success('حُفظت المسودة؛ أرسلها للمراجعة عند اكتمالها');}
    catch(e){toast.error(typeof e.response?.data?.detail==='string'?e.response.data.detail:'تعذر حفظ المسودة');}finally{setBusy(false);}
  };
  const restore=plan=>{
    const file=library.find(m=>m.filename===plan.payload.media_filename);
    setEditing(plan);setTitle(plan.title);setCategory(plan.category||'');
    if(plan.schedule_at){const date=new Date(plan.schedule_at);date.setMinutes(date.getMinutes()-date.getTimezoneOffset());setSchedule(date.toISOString().slice(0,16));}else setSchedule('');
    onRestore({payload:plan.payload,media:file||{filename:plan.payload.media_filename,public_url:`/uploads/social/${plan.payload.media_filename}`,kind:/\.(mp4|mov|m4v)$/i.test(plan.payload.media_filename)?'video':'image'}});setTab('preview');
  };
  const saveMedia=async item=>{setBusy(true);try{await axios.put(`/api/social/workflow/media/${encodeURIComponent(item.filename)}`,item);await load();toast.success('تم حفظ بيانات الوسيط');}catch{toast.error('تعذر حفظ بيانات الوسيط');}finally{setBusy(false);}};
  const patch=(filename,data)=>setLibrary(items=>items.map(item=>item.filename===filename?{...item,...data}:item));
  const dateText=value=>value?new Date(value).toLocaleString('ar-SA'):'غير محدد';
  const input='border rounded p-2 bg-background w-full';
  return <section className="border rounded-xl bg-card p-4 space-y-4" dir="rtl">
    <div className="flex justify-between gap-3 flex-wrap"><h2 className="font-bold text-lg">مركز المسودات والجدولة والمراجعة</h2><button onClick={load} disabled={busy}>تحديث</button></div>
    <p className="text-xs text-muted-foreground">النشر المجدول يعمل من الخادم بعد الاعتماد. الموعد يُعرض بتوقيت جهازك. المعاينة تقريبية؛ الشكل النهائي يعتمد على المنصة.</p>
    {error&&<p role="alert" className="text-red-700">{error}</p>}
    <nav className="flex gap-2 flex-wrap">{[['drafts','المسودات وسجل النشر'],['calendar','تقويم النشر'],['library','مكتبة الوسائط'],['preview','معاينة المنصات']].map(([key,label])=><button key={key} onClick={()=>{setTab(key);if(key==='library')load();}} className={`border rounded px-3 py-2 ${key===tab?'bg-orange-100':''}`}>{label}</button>)}</nav>
    <div className="grid sm:grid-cols-3 gap-3"><label>عنوان المسودة<input className={input} maxLength="150" value={title} onChange={e=>setTitle(e.target.value)}/></label><label>تصنيف المحتوى<input className={input} value={category} onChange={e=>setCategory(e.target.value)}/></label><label>موعد النشر (اختياري)<input type="datetime-local" className={input} value={schedule} onChange={e=>setSchedule(e.target.value)}/></label><label>قالب نص المنشور<select className={input} defaultValue="" onChange={e=>{if(e.target.value!=='')onCaption(templates[Number(e.target.value)][1]);e.target.value='';}}><option value="">اختر قالبًا</option>{templates.map(([label],i)=><option key={label} value={i}>{label}</option>)}</select></label><button disabled={busy} className="border rounded p-2" onClick={save}>{editing?'حفظ تعديل المسودة وإعادة المراجعة':'حفظ مسودة من محرر المنشور أدناه'}</button><button onClick={()=>{setEditing(null);setTitle('');setSchedule('');}} disabled={busy}>مسودة جديدة</button></div>
    {(tab==='drafts'||tab==='calendar')&&<div className="space-y-3"><input className={input} placeholder="بحث بالعنوان أو التصنيف" value={filter} onChange={e=>setFilter(e.target.value)}/>{[...plans].filter(p=>(`${p.title} ${p.category}`).includes(filter)&&(tab!=='calendar'||p.schedule_at)).sort((a,b)=>tab==='calendar'?String(a.schedule_at).localeCompare(String(b.schedule_at)):0).map(plan=><article key={plan.id} className="border rounded p-3 space-y-2"><div className="flex justify-between gap-2"><strong>{plan.title}</strong><span>{states[plan.status]||plan.status}</span></div><p className="text-xs">{plan.schedule_at?`موعد النشر: ${dateText(plan.schedule_at)}`:'نشر يدوي بعد الاعتماد'} · {plan.category}</p>{plan.review_note&&<p>ملاحظة المراجع: {plan.review_note}</p>}{plan.error&&<p className="text-red-700">{plan.error}</p>}<div className="flex flex-wrap gap-2">
      {['draft','pending_review','approved','scheduled'].includes(plan.status)&&<button disabled={busy} onClick={()=>restore(plan)}>فتح المسودة</button>}
      {plan.status==='draft'&&<button disabled={busy} onClick={()=>action(`/api/social/workflow/plans/${plan.id}/submit`)}>إرسال للمراجعة</button>}
      {admin&&plan.status==='pending_review'&&<><button disabled={busy} onClick={()=>{if(window.confirm('اعتماد المنشور؟ المنشور المجدول سينشر تلقائيًا في موعده.'))action(`/api/social/workflow/plans/${plan.id}/review`,{approve:true,note:''});}}>اعتماد</button><button disabled={busy} onClick={()=>{const note=window.prompt('سبب إرجاع المنشور');if(note!==null)action(`/api/social/workflow/plans/${plan.id}/review`,{approve:false,note});}}>إرجاع للتعديل</button></>}
      {plan.status==='approved'&&<button disabled={busy} onClick={()=>{if(window.confirm('نشر هذا المنشور فعليًا على الحسابات المحددة الآن؟'))action(`/api/social/workflow/plans/${plan.id}/publish`);}}>نشر الآن</button>}
      {['failed','partial'].includes(plan.status)&&<button disabled={busy} onClick={()=>{if(window.confirm('راجع المنصات للتأكد أن المحاولة الفاشلة لم تُنشر. إعادة إرسال المنصات الفاشلة فقط؟'))action(`/api/social/workflow/plans/${plan.id}/retry`);}}>إعادة محاولة المنصات الفاشلة فقط</button>}
      {['draft','pending_review','approved','scheduled'].includes(plan.status)&&<button disabled={busy} onClick={()=>action(`/api/social/workflow/plans/${plan.id}/cancel`)}>إلغاء</button>}
    </div>{Object.entries(plan.results||{}).map(([platform,result])=><div key={platform} className="text-sm border-t pt-2"><strong>{platforms[platform]}</strong> · {result.status==='success'?'قُبل لدى المنصة':result.status==='failed'?'فشل':result.status==='publishing'?'جارٍ الإرسال':'بانتظار الإرسال'}{result.error_message&&<p>{result.error_message}</p>}{result.public_post_url&&<a className="text-blue-700" href={result.public_post_url} target="_blank" rel="noreferrer">فتح المنشور</a>}</div>)}</article>)}{!plans.length&&<p>لا توجد مسودات بعد. ارفع وسيطًا في المحرر أدناه ثم صنّفه واسمح بنشره في المكتبة.</p>}</div>}
    {tab==='library'&&<div className="space-y-3"><input className={input} placeholder="بحث بالنشاط أو البطولة أو التصنيف" value={filter} onChange={e=>setFilter(e.target.value)}/>{library.filter(m=>`${m.category||''} ${m.activity||''} ${m.tournament||''} ${m.filename}`.includes(filter)).map(item=><article key={item.filename} className="border rounded p-3 grid sm:grid-cols-3 gap-3">{item.kind==='video'?<video controls src={item.public_url} className="max-h-36"/>:<img src={item.public_url} alt="وسيط الأكاديمية" className="max-h-36 object-contain"/>}<div className="space-y-2"><label>التصنيف<input className={input} value={item.category||''} onChange={e=>patch(item.filename,{category:e.target.value})}/></label><label>النشاط<input className={input} value={item.activity||''} onChange={e=>patch(item.filename,{activity:e.target.value})}/></label><label>البطولة<input className={input} value={item.tournament||''} onChange={e=>patch(item.filename,{tournament:e.target.value})}/></label></div><div className="space-y-2"><label className="block"><input type="checkbox" checked={!!item.allowed_to_publish} onChange={e=>patch(item.filename,{allowed_to_publish:e.target.checked})}/> مسموح بالنشر</label><label>ملاحظة الموافقة<textarea className={input} maxLength="2000" value={item.consent_note||''} onChange={e=>patch(item.filename,{consent_note:e.target.value})}/></label><button disabled={busy} onClick={()=>saveMedia(item)}>حفظ بيانات الوسيط</button><button onClick={()=>{onRestore({media:item});setEditing(null);setTab('preview');}}>استخدام في المنشور</button></div></article>)}<p className="text-xs text-muted-foreground">تظهر الملفات المرفوعة بعد هذا التحديث. الوسائط غير المسموح بها لا تدخل مسار النشر المعتمد. التصفية حسب الفرع المحدد أعلى البرنامج.</p></div>}
    {tab==='preview'&&<div className="grid sm:grid-cols-2 gap-3">{(payload?.targets||[]).map(target=><article key={target.platform} className="border rounded-xl bg-white dark:bg-gray-900 p-4 space-y-3"><strong>{platforms[target.platform]}</strong>{media?.kind==='video'?<video controls src={media.public_url} className="w-full max-h-64"/>:media&&<img src={media.public_url} alt="معاينة المنشور" className="w-full max-h-64 object-contain"/>}<p className="whitespace-pre-wrap break-words">{target.caption_override??payload.caption}</p><span className="text-xs text-muted-foreground">معاينة تقريبية · {String(target.caption_override??payload.caption??'').length} حرف</span></article>)}{!payload?.targets?.length&&<p>اختر المنصات واكتب النص في محرر المنشور أدناه لعرض المعاينة.</p>}</div>}
  </section>;
}
