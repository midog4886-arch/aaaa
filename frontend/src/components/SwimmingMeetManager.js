import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
const strokes = { freestyle: 'حرة', backstroke: 'ظهر', breaststroke: 'صدر', butterfly: 'فراشة', medley: 'متنوع' };
const statuses = { pending: 'بانتظار النتيجة', finished: 'أكمل السباق', dns: 'لم يحضر', dnf: 'لم يكمل', dq: 'مستبعد' };
const genders = { male: 'ذكور', female: 'إناث', mixed: 'مختلط' };
const uid = () => crypto.randomUUID();
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const timeText = cs => cs == null ? '—' : `${String(Math.floor(cs / 6000)).padStart(2,'0')}:${String(Math.floor(cs / 100) % 60).padStart(2,'0')}.${String(cs % 100).padStart(2,'0')}`;
const heatStart = (race, heat) => {
  if (!race.start_time || !heat) return 'غير محدد';
  const [hours, minutes] = race.start_time.split(':').map(Number);
  const total = hours * 60 + minutes + (heat - 1) * race.heat_minutes;
  return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
};
export function rankEntries(entries) {
  let previous, place;
  return [...entries].sort((a,b) => (a.status !== 'finished') - (b.status !== 'finished') || (a.time_cs ?? Infinity) - (b.time_cs ?? Infinity)).map((entry,index) => {
    if (entry.status !== 'finished' || entry.time_cs == null) return { ...entry, place: null };
    if (entry.time_cs !== previous) { place = index + 1; previous = entry.time_cs; }
    return { ...entry, place };
  });
}
export default function SwimmingMeetManager({ tid }) {
  const { selectedBranchId, user } = useAuth();
  const [open, setOpen] = useState(false), [meet, setMeet] = useState(null), [tab,setTab] = useState('settings'), [busy,setBusy] = useState(false), [error,setError] = useState(''), [dirty,setDirty] = useState(false), [bests,setBests] = useState({}), [conflicts,setConflicts] = useState([]);
  const generation = useRef(0);
  const [race,setRace] = useState({ distance: 50, stroke:'freestyle', min_age:0, max_age:120, gender:'mixed', start_time:'', heat_minutes:5 });
  const [swimmer,setSwimmer] = useState({ name:'', member_id:'', birth_date:'', gender:'male', team:'', external_reference:'' });
  const [editingRace,setEditingRace] = useState(null);
  const [chosen,setChosen] = useState([]), [raceFilter,setRaceFilter] = useState('');
  useEffect(() => {
    if (!open) return;
    const request = ++generation.current; setBusy(true); setMeet(null); setError(''); setDirty(false); setBests({}); setConflicts([]);
    axios.get(`/api/tournaments/${tid}/swimming`).then(res => { if (request === generation.current) setMeet(res.data); }).catch(() => { if (request === generation.current) setError('تعذر تحميل بطولة السباحة؛ أغلق القسم وافتحه للمحاولة.'); }).finally(() => { if (request === generation.current) setBusy(false); });
    return () => { generation.current += 1; };
  }, [open, tid, selectedBranchId, user?.id]);
  useEffect(() => {
    if (!meet || dirty) return;
    let active = true;
    axios.get(`/api/tournaments/${tid}/swimming/bests`).then(res => { if(active) setBests(res.data); }).catch(() => {});
    return () => { active = false; };
  }, [tid, meet?.revision, dirty]);
  useEffect(() => {
    const warn = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload',warn); return () => window.removeEventListener('beforeunload',warn);
  }, [dirty]);
  const change = data => { setMeet(old => ({ ...old, ...data, approved:false })); setDirty(true); setBests({}); };
  const save = async (auto=false, approve=false) => {
    const request = generation.current; setBusy(true); setError('');
    try {
      const response = await axios.put(`/api/tournaments/${tid}/swimming`, { ...meet, approved:approve }, { params:{auto_seed:auto} });
      if (request !== generation.current) return;
      setMeet(old => ({ ...old, ...response.data })); setDirty(false); setConflicts(response.data.conflicts || []); toast.success(approve ? 'تم اعتماد النتائج' : 'تم حفظ بطولة السباحة');
      try { const previous = await axios.get(`/api/tournaments/${tid}/swimming/bests`); if (request === generation.current) setBests(previous.data); } catch { if (request === generation.current) toast.warning('تم الحفظ؛ تعذر تحميل مقارنة الأزمنة السابقة.'); }
    } catch (err) { if (request === generation.current) setError(typeof err.response?.data?.detail === 'string' ? err.response.data.detail : 'تعذر الحفظ؛ راجع الحقول والاتصال.'); }
    finally { if (request === generation.current) setBusy(false); }
  };
  const raceLabel = r => `${r.distance}م ${strokes[r.stroke]} · ${r.min_age}–${r.max_age} سنة · ${genders[r.gender]}`;
  const name = id => meet.swimmers.find(s => s.id === id)?.name || '—';
  const patchEntry = (id,data) => change({ entries:meet.entries.map(e => e.id === id ? { ...e,...data } : e) });
  const print = (kind, entry) => {
    if (dirty) { toast.error('احفظ التعديلات قبل الطباعة'); return; }
    if ((kind === 'results' || kind === 'certificate') && !meet.approved) { toast.error('اعتمد النتائج قبل طباعة النتائج أو الشهادات'); return; }
    const popup = window.open('','_blank'); if (!popup) { toast.error('اسمح بالنوافذ المنبثقة للطباعة'); return; }
    let body = '';
    if (kind === 'certificate') {
      const r = meet.races.find(r => r.id === entry.race_id), result = rankEntries(meet.entries.filter(e => e.race_id === r.id)).find(e => e.id === entry.id);
      body = `<div class="certificate"><h1>شهادة ${result.place && result.place <= 3 ? 'فوز' : 'مشاركة'}</h1><p>تُمنح للسباح / السباحة</p><h2>${escape(name(entry.swimmer_id))}</h2><p>في بطولة ${escape(meet.name)}</p><p>${escape(raceLabel(r))}</p><p>${result.place ? `المركز: ${result.place} · الزمن: ${escape(timeText(entry.time_cs))}` : escape(statuses[entry.status])}</p><p>${escape(meet.date)} · ${escape(meet.place)}</p><p>توقيع إدارة البطولة: __________________</p></div>`;
    } else if (kind === 'participants') {
      body = '<h2>كشف المشاركين</h2><table><tr><th>الاسم</th><th>الفريق</th><th>السباقات</th></tr>' + meet.swimmers.map(s => `<tr><td>${escape(s.name)}</td><td>${escape(s.team)}</td><td>${escape(meet.entries.filter(e => e.swimmer_id === s.id).map(e => raceLabel(meet.races.find(r => r.id === e.race_id))).join(' / '))}</td></tr>`).join('') + '</table>';
    } else {
      body = meet.races.map(r => {
        const entries = meet.entries.filter(e => e.race_id === r.id);
        const rows = kind === 'results' ? rankEntries(entries) : [...entries].sort((a,b) => a.heat-b.heat || a.lane-b.lane);
        return `<h2>${escape(raceLabel(r))}</h2><p>الموعد: ${escape(r.start_time || 'غير محدد')} · مدة الشوط المخططة: ${r.heat_minutes} دقيقة</p><table><tr><th>السباح</th><th>الشوط</th><th>الحارة</th><th>الموعد المخطط</th><th>${kind === 'results' ? 'المركز / الزمن / الحالة' : 'الزمن السابق'}</th></tr>${rows.map(e => `<tr><td>${escape(name(e.swimmer_id))}</td><td>${e.heat || '—'}</td><td>${e.lane || '—'}</td><td>${escape(heatStart(r,e.heat))}</td><td>${kind === 'results' ? escape(`${e.place || '—'} / ${timeText(e.time_cs)} / ${statuses[e.status]} ${e.reason || ''}`) : escape(e.seed_time || '—')}</td></tr>`).join('')}</table>`;
      }).join('');
    }
    popup.document.write(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>${escape(meet.name)}</title><style>body{font-family:Arial;padding:28px}table{width:100%;border-collapse:collapse;margin-bottom:24px}td,th{border:1px solid #bbb;padding:10px;text-align:right}h2{break-after:avoid}.certificate{text-align:center;border:6px double #dc9b27;padding:60px 20px}.certificate h1{font-size:42px}.certificate h2{font-size:32px}@media print{button{display:none}tr{break-inside:avoid}}</style><button onclick="window.print()">طباعة / حفظ PDF</button><h1>${escape(meet.name)}</h1><p>${escape(meet.date)} · ${escape(meet.place)} · مسبح ${meet.pool_length}م</p>${body}</html>`); popup.document.close();
  };
  const inputClass='w-full border rounded p-2 bg-background';
  return <section dir="rtl" className="border border-sky-200 bg-sky-50/30 rounded-xl p-4 my-5 print:hidden">
    <button type="button" className="font-bold text-sky-800" onClick={() => { if (dirty && !window.confirm('توجد تعديلات غير محفوظة؛ هل تريد إغلاق القسم؟')) return; setOpen(!open); }}>إدارة بطولة السباحة 🏊</button>
    {open && <div className="mt-4 space-y-4">
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {busy && <p role="status">جارٍ التحميل أو الحفظ…</p>}
      {meet && <>
        <div className="flex gap-2 flex-wrap"><span>{meet.swimmers.length} سباح · {meet.races.length} سباق · {meet.entries.length} مشاركة</span><strong>{dirty ? 'تعديلات غير محفوظة' : meet.approved ? 'نتائج معتمدة' : 'مسودة'}</strong><button disabled={busy} className="border rounded px-3 py-1" onClick={() => save()}>حفظ المسودة</button><button disabled={busy} className="bg-sky-700 text-white rounded px-3 py-1" onClick={() => { if(window.confirm('اعتماد جميع نتائج بطولة السباحة؟')) save(false,true); }}>اعتماد النتائج</button></div>
        {conflicts.length > 0 && <p role="alert" className="text-amber-800">تعارض مواعيد للسباحين: {conflicts.join('، ')}. راجع مواعيد السباقات ومدة الأشواط.</p>}
        <nav className="flex gap-2 flex-wrap">{[['settings','إعداد المسبح'],['races','السباقات'],['swimmers','المشاركون'],['heats','الأشواط والحارات'],['results','النتائج والتقدم']].map(([key,label]) => <button key={key} className={`border rounded px-3 py-2 ${tab === key ? 'bg-sky-100' : 'bg-white'}`} onClick={() => setTab(key)}>{label}</button>)}</nav>
        <fieldset disabled={busy} className="space-y-3 min-w-0">
        {tab === 'settings' && <div className="grid sm:grid-cols-2 gap-4"><label>طول المسبح<select className={inputClass} value={meet.pool_length} onChange={e => change({pool_length:Number(e.target.value)})}><option value="25">25 متر</option><option value="50">50 متر</option></select></label><label>عدد الحارات<input className={inputClass} type="number" min="1" max="10" value={meet.lanes} onChange={e => change({lanes:Number(e.target.value)})} /></label><p className="text-sm text-muted-foreground">المكان والتاريخ من إعدادات البطولة الرئيسية. حدّد تاريخ البطولة قبل تسجيل المشاركين. الفئات تُحسب بالعمر في ذلك التاريخ. مدة الشوط تُستخدم للتنبيه عن تعارض المواعيد.</p></div>}
        {tab === 'races' && <>
          <form className="grid sm:grid-cols-3 gap-3" onSubmit={e => { e.preventDefault(); change({races:editingRace?meet.races.map(r=>r.id===editingRace?{...race,id:editingRace}:r):[...meet.races,{...race,id:uid()}]});setEditingRace(null); }}>
            <label>المسافة بالمتر<input required type="number" min="25" max="10000" className={inputClass} value={race.distance} onChange={e => setRace({...race,distance:Number(e.target.value)})} /></label>
            <label>نوع السباحة<select className={inputClass} value={race.stroke} onChange={e => setRace({...race,stroke:e.target.value})}>{Object.entries(strokes).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>الفئة<select className={inputClass} value={race.gender} onChange={e => setRace({...race,gender:e.target.value})}>{Object.entries(genders).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>العمر من<input type="number" min="0" max="120" className={inputClass} value={race.min_age} onChange={e => setRace({...race,min_age:Number(e.target.value)})} /></label><label>العمر إلى<input type="number" min="0" max="120" className={inputClass} value={race.max_age} onChange={e => setRace({...race,max_age:Number(e.target.value)})} /></label><label>وقت أول شوط<input type="time" className={inputClass} value={race.start_time} onChange={e => setRace({...race,start_time:e.target.value})} /></label><label>مدة الشوط بالدقائق<input type="number" min="1" max="120" className={inputClass} value={race.heat_minutes} onChange={e => setRace({...race,heat_minutes:Number(e.target.value)})} /></label><button className="border rounded p-2">{editingRace?'حفظ تعديل السباق':'إضافة السباق'}</button>
          </form>
          {meet.races.map(r => <div key={r.id} className="border rounded p-3 space-y-2"><strong>{raceLabel(r)}</strong><div className="flex gap-2 flex-wrap"><label>بداية السباق<input type="time" className={inputClass} value={r.start_time} onChange={e => change({races:meet.races.map(x => x.id === r.id ? {...x,start_time:e.target.value} : x)})} /></label><button onClick={() => {setRace({...r});setEditingRace(r.id);}}>تعديل السباق</button><button onClick={() => {if(window.confirm('حذف السباق وجميع مشاركاته ونتائجه؟')) change({races:meet.races.filter(x=>x.id!==r.id),entries:meet.entries.filter(e=>e.race_id!==r.id)});}}>حذف السباق</button></div></div>)}
        </>}
        {tab === 'swimmers' && <>
          <form className="grid sm:grid-cols-3 gap-3" onSubmit={e => {e.preventDefault(); if(!chosen.length){toast.error('اختر سباقًا واحدًا على الأقل');return;}const id=uid(); change({swimmers:[...meet.swimmers,{...swimmer,id,member_id:swimmer.member_id || null}],entries:[...meet.entries,...chosen.map(race_id=>({id:uid(),race_id,swimmer_id:id,seed_time:'',time:'',status:'pending',reason:'',heat:0,lane:0}))]});setSwimmer({name:'',member_id:'',birth_date:'',gender:'male',team:'',external_reference:''});setChosen([]);}}>
            <label>اسم السباح<input required maxLength="150" className={inputClass} value={swimmer.name} onChange={e=>setSwimmer({...swimmer,name:e.target.value})}/></label><label>رقم العضوية (فارغ للمشارك الخارجي)<input className={inputClass} value={swimmer.member_id} onChange={e=>setSwimmer({...swimmer,member_id:e.target.value})}/></label><label>تاريخ الميلاد<input required type="date" className={inputClass} value={swimmer.birth_date} onChange={e=>setSwimmer({...swimmer,birth_date:e.target.value})}/></label><label>الجنس<select className={inputClass} value={swimmer.gender} onChange={e=>setSwimmer({...swimmer,gender:e.target.value})}><option value="male">ذكر</option><option value="female">أنثى</option></select></label><label>رقم السباح الخارجي الثابت (للمقارنة مستقبلًا)<input maxLength="100" className={inputClass} value={swimmer.external_reference || ''} onChange={e=>setSwimmer({...swimmer,external_reference:e.target.value})}/></label><label>الفريق / النادي<input maxLength="150" className={inputClass} value={swimmer.team} onChange={e=>setSwimmer({...swimmer,team:e.target.value})}/></label><div>{meet.races.map(r=><label key={r.id} className="block text-sm"><input type="checkbox" checked={chosen.includes(r.id)} onChange={e=>setChosen(e.target.checked?[...chosen,r.id]:chosen.filter(id=>id!==r.id))}/> {raceLabel(r)}</label>)}</div><button className="border rounded p-2">تسجيل السباح في السباقات</button>
          </form>
          {meet.swimmers.map(s=><div key={s.id} className="border rounded p-3"><strong>{s.name} · {s.team} · {s.member_id?'عضو أكاديمية':'مشارك خارجي'}</strong><div className="flex gap-2 flex-wrap">{meet.races.map(r=><label key={r.id} className="text-sm"><input type="checkbox" checked={meet.entries.some(e=>e.swimmer_id===s.id&&e.race_id===r.id)} onChange={event=>{if(!event.target.checked&&!window.confirm('إلغاء المشاركة وحذف نتيجتها؟'))return; change({entries:event.target.checked?[...meet.entries,{id:uid(),race_id:r.id,swimmer_id:s.id,seed_time:'',time:'',status:'pending',reason:'',heat:0,lane:0}]:meet.entries.filter(e=>!(e.swimmer_id===s.id&&e.race_id===r.id))});}}/> {raceLabel(r)}</label>)}</div><button onClick={()=>{if(window.confirm('حذف السباح وجميع مشاركاته؟'))change({swimmers:meet.swimmers.filter(x=>x.id!==s.id),entries:meet.entries.filter(e=>e.swimmer_id!==s.id)});}}>حذف السباح</button></div>)}
          <button onClick={()=>print('participants')}>طباعة كشف المشاركين</button>
        </>}
        {(tab==='heats'||tab==='results') && <>
          <select aria-label="تصفية السباق" className={inputClass} value={raceFilter} onChange={e=>setRaceFilter(e.target.value)}><option value="">كل السباقات</option>{meet.races.map(r=><option key={r.id} value={r.id}>{raceLabel(r)}</option>)}</select>
          {tab==='heats' && <><button className="border rounded p-2" onClick={()=>{if(window.confirm('إعادة توزيع جميع الأشواط والحارات حسب الأزمنة السابقة وحفظ البطولة؟'))save(true);}}>توزيع تلقائي حسب الزمن السابق</button><p className="text-sm">بدون زمن سابق: توزيع في الأشواط الأولى. الأسرع في الأشواط الأخيرة والحارات الوسطى. يمكنك التعديل يدويًا.</p></>}
          {meet.races.filter(r=>!raceFilter||r.id===raceFilter).map(r=><div key={r.id} className="space-y-2"><h3 className="font-bold">{raceLabel(r)}</h3>{(tab==='results'?rankEntries(meet.entries.filter(e=>e.race_id===r.id)):meet.entries.filter(e=>e.race_id===r.id).sort((a,b)=>a.heat-b.heat||a.lane-b.lane)).map(entry=><div key={entry.id} className="grid sm:grid-cols-4 gap-2 border rounded p-3"><strong>{name(entry.swimmer_id)}{tab==='results'&&entry.place?` · المركز ${entry.place}`:''}</strong>
            {tab==='heats'?<><label>الزمن السابق<input className={inputClass} placeholder="01:23.45" value={entry.seed_time} onChange={e=>patchEntry(entry.id,{seed_time:e.target.value})}/></label><label>الشوط<input type="number" min="0" className={inputClass} value={entry.heat} onChange={e=>patchEntry(entry.id,{heat:Number(e.target.value)})}/></label><label>الحارة<input type="number" min="0" max={meet.lanes} className={inputClass} value={entry.lane} onChange={e=>patchEntry(entry.id,{lane:Number(e.target.value)})}/></label></>:<><label>الحالة<select className={inputClass} value={entry.status} onChange={e=>patchEntry(entry.id,{status:e.target.value,time_cs:null})}>{Object.entries(statuses).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>الزمن<input disabled={entry.status!=='finished'} placeholder="01:23.45" className={inputClass} value={entry.time} onChange={e=>patchEntry(entry.id,{time:e.target.value,time_cs:null})}/></label><label>سبب الاستبعاد / ملاحظات<input className={inputClass} maxLength="500" value={entry.reason} onChange={e=>patchEntry(entry.id,{reason:e.target.value})}/></label><p className="text-sm">أفضل زمن سابق: {bests[entry.id]?.previous_best || 'احفظ لتحميل المقارنة'}{bests[entry.id]?.improvement_cs!=null?` · فرق الزمن: ${(bests[entry.id].improvement_cs/100).toFixed(2)} ثانية (الموجب تحسن)`:''}</p><button disabled={!meet.approved||dirty} onClick={()=>print('certificate',entry)}>شهادة المشاركة / المركز</button></>}
          </div>)}</div>)}
          <p className="text-sm">الترتيب بعد الحفظ حسب الزمن داخل كل سباق وفئة؛ التعادل يمنح المركز نفسه. الأزمنة بالدقيقة والثانية وأجزاء المئة. مقارنة الأداء للأعضاء المرتبطين أو للمشارك الخارجي بنفس رقمه الثابت والفريق وتاريخ الميلاد، من البطولات السابقة المعتمدة بنفس المسافة والنوع وطول المسبح.</p>
          <button onClick={()=>print(tab==='heats'?'heats':'results')}>طباعة {tab==='heats'?'جدول الأشواط':'النتائج المعتمدة'} / حفظ PDF</button>
        </>}
        </fieldset>
      </>}
    </div>}
  </section>;
}
