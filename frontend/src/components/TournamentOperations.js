import React, { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { tournamentsAPI } from '../services/api';

const emptyMatch = { team_a: '', team_b: '', start_time: '', field: '', status: 'scheduled', score_a: null, score_b: null };
const statusText = { pending: 'بانتظار المراجعة', waitlisted: 'قائمة الانتظار', approved: 'مقبول', rejected: 'مرفوض' };
const readinessItems = (data) => [
  [data.pending_registrations, 'طلبات تسجيل تنتظر المراجعة'],
  [data.waitlisted, 'طلبات في قائمة الانتظار'],
  [data.swimming_unassigned, 'مشاركات سباحة بلا شوط أو حارة'],
  [data.swimming_pending, 'نتائج سباحة لم تُسجل'],
  [data.matches_unscheduled, 'مباريات بلا موعد'],
  [data.results_pending, 'نتائج تنتظر الاعتماد'],
].filter(([count]) => count > 0);

export default function TournamentOperations({ tid, tournament, onTournamentChanged }) {
  const [ops, setOps] = useState(null);
  const [tab, setTab] = useState('readiness');
  const [busy, setBusy] = useState(false);
  const [capacity, setCapacity] = useState(0);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [checkinText, setCheckinText] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [draftMatch, setDraftMatch] = useState(emptyMatch);
  const cameraRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const response = await tournamentsAPI.operations(tid);
      setOps(response.data);
      setCapacity(response.data.capacity || 0);
      setRegistrationOpen(!!response.data.registration_open);
    } catch {
      toast.error('تعذر تحميل إدارة البطولة');
    }
  }, [tid]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (tab !== 'live') return undefined;
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, [tab, load]);
  useEffect(() => () => { if (cameraRef.current) cameraRef.current.stop().catch(() => {}); }, []);
  useEffect(() => {
    if (tab === 'checkin' || !cameraRef.current) return;
    cameraRef.current.stop().catch(() => {});
    cameraRef.current = null;
    setCameraOn(false);
  }, [tab]);

  const run = async (work, success, refreshTournament = false) => {
    setBusy(true);
    try {
      await work();
      toast.success(success);
      await load();
      if (refreshTournament) onTournamentChanged?.();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'تعذر تنفيذ العملية');
    } finally {
      setBusy(false);
    }
  };
  const checkin = (raw) => {
    const parts = String(raw || '').trim().split('|');
    const memberId = parts[0] === 'TCI' && parts[1] === tid ? parts[2] : String(raw || '').trim();
    if (!memberId || (parts[0] === 'TCI' && parts[1] !== tid)) {
      toast.error('رمز الحضور ليس لهذه البطولة');
      return;
    }
    run(() => tournamentsAPI.checkIn(tid, memberId), 'تم تسجيل الحضور');
    setCheckinText('');
  };
  const toggleCamera = async () => {
    if (cameraRef.current) {
      await cameraRef.current.stop().catch(() => {});
      cameraRef.current = null;
      setCameraOn(false);
      return;
    }
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const camera = new Html5Qrcode(`tournament-qr-${tid}`);
      cameraRef.current = camera;
      setCameraOn(true);
      await camera.start({ facingMode: 'environment' }, { fps: 10, qrbox: 230 }, (decoded) => {
        camera.stop().catch(() => {});
        cameraRef.current = null;
        setCameraOn(false);
        checkin(decoded);
      });
    } catch {
      cameraRef.current = null;
      setCameraOn(false);
      toast.error('تعذر تشغيل الكاميرا. استخدم رقم العضوية أدناه.');
    }
  };
  const saveMatchBoard = (matches) => run(
    () => tournamentsAPI.saveMatches(tid, { revision: ops.match_board.revision || 0, matches }),
    'تم تحديث المباريات'
  );
  const matches = ops?.match_board?.matches || [];
  const live = matches.filter(m => m.status === 'live');
  const next = matches.filter(m => m.status === 'scheduled').sort((a, b) => (a.start_time || '9999').localeCompare(b.start_time || '9999'));
  const recent = matches.filter(m => m.status === 'finished').slice(-5).reverse();
  const participants = tournament?.participants || [];
  const checked = new Set((ops?.checkins || []).map(c => c.member_id));
  const link = `${window.location.origin}/my-tournaments?join=${encodeURIComponent(tid)}`;

  if (!ops) return <div className="rounded-xl border bg-white p-4 text-sm" dir="rtl">جارٍ تحميل إدارة البطولة…</div>;
  return <section dir="rtl" className="rounded-xl border bg-white p-4 space-y-4 print:hidden">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-lg font-bold">مركز إدارة يوم البطولة</h2><p className="text-xs text-slate-500">التسجيل والحضور والنتائج في مكان واحد</p></div>
      <button type="button" className="rounded border px-3 py-1 text-sm" onClick={load}>تحديث</button>
    </div>
    <nav className="flex flex-wrap gap-2 text-sm" aria-label="أقسام إدارة البطولة">
      {[['readiness', 'الاستعداد'], ['registration', 'التسجيل وQR'], ['checkin', 'الحضور'], ['matches', 'مباريات القدم'], ['live', 'العرض المباشر'], ['results', 'مراجعة النتائج']].map(([key, label]) =>
        <button type="button" key={key} onClick={() => setTab(key)} className={`rounded-lg border px-3 py-2 ${tab === key ? 'bg-orange-500 text-white border-orange-500' : 'bg-white'}`}>{label}</button>
      )}
    </nav>

    {tab === 'readiness' && <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
        {[[ops.summary.participants, 'مشارك'], [ops.summary.checked_in, 'حاضر'], [ops.summary.matches_live, 'مباراة جارية'], [ops.summary.pending_registrations, 'طلب مراجعة']].map(([value, label]) =>
          <div key={label} className="rounded-lg bg-slate-50 border p-3"><strong className="block text-xl">{value}</strong><span className="text-xs text-slate-500">{label}</span></div>
        )}
      </div>
      <h3 className="font-semibold">ما الذي يحتاج انتباهك؟</h3>
      {readinessItems(ops.summary).length ? readinessItems(ops.summary).map(([count, label]) => <p key={label} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><strong>{count}</strong> {label}</p>) : <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm">كل المهام المسجلة جاهزة حاليًا.</p>}
    </div>}

    {tab === 'registration' && <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3">
        <label className="text-sm"><input type="checkbox" checked={registrationOpen} onChange={e => setRegistrationOpen(e.target.checked)} /> فتح التسجيل لولي الأمر</label>
        <label className="text-sm">السعة (0 = غير محدودة)<input className="block w-full border rounded p-2 mt-1" type="number" min="0" max="10000" value={capacity} onChange={e => setCapacity(Number(e.target.value))} /></label>
        <button type="button" disabled={busy} className="rounded bg-orange-500 text-white px-3 py-2" onClick={() => run(() => tournamentsAPI.configureRegistration(tid, { registration_open: registrationOpen, capacity }), 'تم حفظ إعدادات التسجيل')}>حفظ الإعدادات</button>
      </div>
      {ops.registration_open && <div className="flex flex-wrap items-center gap-4"><QRCodeSVG value={link} size={120} /><div><p className="text-sm font-semibold">رمز تسجيل ولي الأمر</p><a href={link} target="_blank" rel="noreferrer" className="text-blue-700 underline break-all text-xs">{link}</a><p className="text-xs text-slate-500">يجب تسجيل الدخول إلى حساب العضو. الطلب ينتظر موافقة الإدارة.</p></div></div>}
      <h3 className="font-semibold">طلبات التسجيل</h3>
      {(ops.requests || []).length === 0 ? <p className="text-sm text-slate-500">لا توجد طلبات بعد.</p> : (ops.requests || []).map(r =>
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-lg p-3 text-sm"><span>{r.member_name} · {statusText[r.status] || r.status}{r.subcategory ? ` · ${r.subcategory}` : ''}</span>{['pending', 'waitlisted'].includes(r.status) && <span className="flex gap-2"><button disabled={busy} className="rounded bg-green-600 text-white px-3 py-1" onClick={() => run(() => tournamentsAPI.reviewRegistration(tid, r.id, 'approve'), 'تم قبول الطلب', true)}>قبول</button><button disabled={busy} className="rounded border px-3 py-1" onClick={() => run(() => tournamentsAPI.reviewRegistration(tid, r.id, 'reject'), 'تم رفض الطلب')}>رفض</button></span>}</div>
      )}
    </div>}

    {tab === 'checkin' && <div className="space-y-3">
      <p className="text-sm text-slate-600">امسح رمز العضو من صفحة «بطولاتي» أو أدخل رقم العضوية. لا يُسجل الحضور إلا لمشارك معتمد في البطولة.</p>
      <button type="button" className="border rounded px-3 py-2 text-sm" onClick={toggleCamera}>{cameraOn ? 'إيقاف الكاميرا' : 'تشغيل كاميرا QR'}</button>
      <div id={`tournament-qr-${tid}`} className={cameraOn ? 'max-w-sm' : 'hidden'} />
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); checkin(checkinText); }}><input className="border rounded p-2 flex-1" placeholder="رقم العضوية أو رمز QR" value={checkinText} onChange={e => setCheckinText(e.target.value)} /><button disabled={busy} className="bg-blue-600 text-white rounded px-4">تسجيل</button></form>
      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">{participants.map(p => <div key={`${p.member_id}-${p.subcategory || ''}`} className="border rounded p-2 text-sm"><span>{p.member_name || p.member_code || p.member_id}</span><span className={`block text-xs ${checked.has(p.member_id) ? 'text-green-700' : 'text-slate-500'}`}>{checked.has(p.member_id) ? 'حاضر' : 'لم يحضر'}</span>{!checked.has(p.member_id) && <button disabled={busy} onClick={() => checkin(p.member_id)} className="text-blue-700 underline text-xs">تسجيل يدوي</button>}</div>)}</div>
    </div>}

    {tab === 'matches' && <div className="space-y-3">
      <p className="text-sm text-slate-600">أضف مباريات القدم وحدد الملعب والموعد، ثم حدّث الحالة والنتيجة أثناء البطولة.</p>
      <form className="grid sm:grid-cols-5 gap-2" onSubmit={e => { e.preventDefault(); saveMatchBoard([...matches, draftMatch]); setDraftMatch(emptyMatch); }}>
        <input required className="border rounded p-2" placeholder="الفريق الأول" value={draftMatch.team_a} onChange={e => setDraftMatch({ ...draftMatch, team_a: e.target.value })} />
        <input required className="border rounded p-2" placeholder="الفريق الثاني" value={draftMatch.team_b} onChange={e => setDraftMatch({ ...draftMatch, team_b: e.target.value })} />
        <input type="datetime-local" className="border rounded p-2" value={draftMatch.start_time} onChange={e => setDraftMatch({ ...draftMatch, start_time: e.target.value })} />
        <input className="border rounded p-2" placeholder="الملعب" value={draftMatch.field} onChange={e => setDraftMatch({ ...draftMatch, field: e.target.value })} />
        <button disabled={busy} className="bg-blue-600 text-white rounded p-2">إضافة مباراة</button>
      </form>
      {matches.map(m => <MatchRow key={m.id} match={m} disabled={busy} onSave={nextMatch => saveMatchBoard(matches.map(item => item.id === m.id ? nextMatch : item))} onDelete={() => saveMatchBoard(matches.filter(item => item.id !== m.id))} />)}
    </div>}

    {tab === 'live' && <div className="space-y-3">
      <p className="text-xs text-slate-500">يُحدَّث العرض كل 15 ثانية. النتائج هنا لفريق التشغيل حتى الاعتماد.</p>
      {[['يجري الآن', live], ['التالي', next.slice(0, 5)], ['آخر النتائج', recent]].map(([label, group]) => <div key={label}><h3 className="font-bold mb-2">{label}</h3>{group.length ? <div className="grid md:grid-cols-2 gap-2">{group.map(m => <div key={m.id} className="rounded-xl border bg-slate-50 p-4 text-center"><span className="text-xs text-slate-500">{m.field || 'ملعب غير محدد'} · {m.start_time || 'وقت غير محدد'}</span><p className="font-bold mt-1">{m.team_a} {m.score_a ?? '—'} : {m.score_b ?? '—'} {m.team_b}</p></div>)}</div> : <p className="text-xs text-slate-500">لا توجد مباريات.</p>}</div>)}
    </div>}

    {tab === 'results' && <div className="space-y-3">
      <div className={`rounded-lg p-3 text-sm ${ops.results_approved ? 'bg-green-50' : 'bg-amber-50'}`}>{ops.results_approved ? 'نتائج المشاركين معتمدة وتظهر لولي الأمر.' : 'نتائج المشاركين مسودة؛ لن تظهر المراكز أو الملاحظات لولي الأمر قبل الاعتماد.'}</div>
      <div className="grid sm:grid-cols-2 gap-2">{participants.filter(p => p.position).map(p => <p key={`${p.member_id}-${p.subcategory || ''}`} className="border rounded p-3 text-sm">{p.member_name} · {p.subcategory || p.level_label || 'عام'} · المركز {p.position}</p>)}</div>
      {!ops.results_approved && <button type="button" disabled={busy || (!participants.some(p => p.position) && !matches.some(m => m.status === 'finished'))} className="bg-green-600 text-white rounded px-4 py-2" onClick={() => { if (window.confirm('اعتماد النتائج ونشر المراكز للأعضاء وإرسال تهنئة للفائزين؟')) run(() => tournamentsAPI.approveResults(tid), 'تم اعتماد النتائج ونشرها', true); }}>اعتماد النتائج ونشرها</button>}
      <p className="text-xs text-slate-500">نتائج سباقات السباحة لها اعتماد مستقل داخل «إدارة بطولة السباحة».</p>
    </div>}
  </section>;
}

function MatchRow({ match, disabled, onSave, onDelete }) {
  const [draft, setDraft] = useState(match);
  useEffect(() => setDraft(match), [match]);
  return <div className="grid sm:grid-cols-7 gap-2 border rounded p-2 text-sm items-center">
    <span className="sm:col-span-2 font-semibold">{match.team_a} × {match.team_b}</span>
    <select className="border rounded p-2" value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}><option value="scheduled">قادمة</option><option value="live">جارية</option><option value="finished">انتهت</option></select>
    <input type="number" min="0" placeholder="الأول" className="border rounded p-2" value={draft.score_a ?? ''} onChange={e => setDraft({ ...draft, score_a: e.target.value === '' ? null : Number(e.target.value) })} />
    <input type="number" min="0" placeholder="الثاني" className="border rounded p-2" value={draft.score_b ?? ''} onChange={e => setDraft({ ...draft, score_b: e.target.value === '' ? null : Number(e.target.value) })} />
    <button disabled={disabled} className="bg-blue-600 text-white rounded p-2" onClick={() => onSave(draft)}>حفظ</button>
    <button disabled={disabled} className="border rounded p-2 text-red-600" onClick={() => { if (window.confirm('حذف المباراة؟')) onDelete(); }}>حذف</button>
  </div>;
}
