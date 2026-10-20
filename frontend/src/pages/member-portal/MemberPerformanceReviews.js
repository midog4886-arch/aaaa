import React, { useEffect, useRef, useState } from 'react';
import { memberAPI } from './MemberLayout';

const timeLabel = (seconds) => {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};

export default function MemberPerformanceReviews() {
  const [reports, setReports] = useState([]);
  const [selected, setSelected] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [baselineUrl, setBaselineUrl] = useState('');
  const [activeMarker, setActiveMarker] = useState(null);
  const videoRef = useRef(null);
  const baselineRef = useRef(null);

  useEffect(() => {
    let active = true;
    memberAPI.get('/api/member-video-reviews/portal/approved').then(response => {
      if (active) setReports(response.data || []);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const open = async (report) => {
    setSelected(report);
    setVideoUrl('');
    setBaselineUrl('');
    setActiveMarker(null);
    try {
      if (report.has_video) {
        const response = await memberAPI.get(`/api/member-video-reviews/portal/${encodeURIComponent(report.id)}/play-ticket`);
        setVideoUrl(response.data.url);
      }
      if (report.comparison?.baseline_review_id && report.comparison.baseline_has_video) {
        const before = await memberAPI.get(`/api/member-video-reviews/portal/${encodeURIComponent(report.comparison.baseline_review_id)}/play-ticket`);
        setBaselineUrl(before.data.url);
      }
    } catch {
      setSelected(null);
    }
  };

  const syncVideos = (jump = false) => {
    if (!selected?.comparison || !videoRef.current || !baselineRef.current) return;
    const current = videoRef.current;
    const before = baselineRef.current;
    if (jump) current.currentTime = selected.comparison.current_event_time;
    if (!Number.isFinite(before.duration)) return;
    const desired = Math.max(0, Math.min(before.duration,
      selected.comparison.baseline_event_time + current.currentTime - selected.comparison.current_event_time));
    if (jump || Math.abs(before.currentTime - desired) > 0.25) before.currentTime = desired;
    if (current.paused) before.pause();
  };

  if (!reports.length) return null;
  return <section className="rounded-2xl border bg-white p-4 shadow-sm" dir="rtl">
    <h2 className="mb-3 text-lg font-bold text-slate-900">تقارير الأداء المعتمدة</h2>
    <p className="mb-4 text-sm text-slate-600">لقطات وملاحظات اختارها المدرب لمشاركتها معك.</p>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {reports.map(report => <button type="button" key={report.id} onClick={() => open(report)} className="rounded-xl border p-3 text-right hover:border-blue-500 hover:bg-blue-50">
        <strong className="block text-slate-900">{report.title}</strong>
        <span className="text-xs text-slate-500">{report.member_name} · {report.sport === 'football' ? 'كرة قدم' : 'سباحة'} · {report.approved_at?.slice(0, 10)}</span>
        <p className="mt-2 line-clamp-2 text-sm text-slate-700">{report.parent_summary}</p>
      </button>)}
    </div>
    {selected && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3" onClick={() => { setSelected(null); setVideoUrl(''); setBaselineUrl(''); }}>
      <div role="dialog" aria-modal="true" aria-label="تقرير الأداء" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-4" onClick={event => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-lg font-bold">{selected.title}</h3><button type="button" onClick={() => { setSelected(null); setVideoUrl(''); setBaselineUrl(''); }} className="rounded-md border px-3 py-1">إغلاق</button></div>
        <div className={`grid gap-3 ${baselineUrl ? 'md:grid-cols-2' : ''}`}>
        {baselineUrl && <div><p className="mb-1 text-sm font-semibold">قبل · الفيديو السابق</p><video ref={baselineRef} src={baselineUrl} controls playsInline preload="metadata" className="aspect-video w-full rounded-lg bg-black" /></div>}
        {videoUrl && <div><p className="mb-1 text-sm font-semibold">{baselineUrl ? 'بعد · الفيديو الحالي' : 'الفيديو'}</p><div className="relative overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} src={videoUrl} controls playsInline preload="metadata" className="aspect-video w-full"
            onPlay={() => { if (baselineRef.current) { syncVideos(); baselineRef.current.playbackRate = videoRef.current.playbackRate; baselineRef.current.play().catch(() => {}); } }}
            onPause={() => baselineRef.current?.pause()} onTimeUpdate={() => syncVideos()} />
          {activeMarker?.drawing && <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <line x1={activeMarker.drawing.x1 * 100} y1={activeMarker.drawing.y1 * 100} x2={activeMarker.drawing.x2 * 100} y2={activeMarker.drawing.y2 * 100} stroke="#f97316" strokeWidth="0.8" />
            <circle cx={activeMarker.drawing.x2 * 100} cy={activeMarker.drawing.y2 * 100} r="1.2" fill="#f97316" />
          </svg>}
        </div></div>}
        </div>
        {!selected.has_video && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">الفيديو محفوظ على جهاز المدرب فقط؛ هذا التقرير يعرض النتائج التي اعتمدها المدرب.</p>}
        {baselineUrl && <button type="button" onClick={() => syncVideos(true)} className="mt-2 rounded-md border px-3 py-2 text-sm">اعرض لحظة الحركة نفسها في الفيديوين</button>}
        <p className="my-4 whitespace-pre-wrap rounded-lg bg-blue-50 p-3 text-sm text-blue-950">{selected.parent_summary}</p>
        {selected.comparison && <section className="mb-4 space-y-3 rounded-xl border border-blue-200 bg-blue-50/50 p-3 text-sm">
          <h4 className="font-bold">نتيجة المقارنة قبل / بعد</h4>
          <p>وضوح التتبّع: قبل {Math.round(selected.comparison.summary.before.coverage * 100)}% · بعد {Math.round(selected.comparison.summary.after.coverage * 100)}%</p>
          <div className="overflow-x-auto rounded-md border bg-white"><table className="w-full"><thead><tr><th className="p-2 text-right">القياس</th><th>قبل</th><th>بعد</th><th>الفرق</th></tr></thead><tbody>
            {Object.entries(selected.comparison.summary.deltas).map(([key, delta]) => <tr key={key} className="border-t"><td className="p-2">{key === 'knee_angle' ? 'زاوية الركبة' : key === 'elbow_angle' ? 'زاوية المرفق' : key === 'hip_angle' ? 'زاوية الورك' : 'ميل الجذع'}</td><td className="text-center">{selected.comparison.summary.before.values[key]}°</td><td className="text-center">{selected.comparison.summary.after.values[key]}°</td><td className="text-center">{delta > 0 ? '+' : ''}{delta}°</td></tr>)}
          </tbody></table></div>
          <p><strong>ملاحظة المدرب:</strong> {selected.comparison.coach_finding}</p>
          <p><strong>التمرين التالي:</strong> {selected.comparison.next_exercise}</p>
          <p className="text-xs text-slate-600">فرق الزاوية وحده لا يعني تحسنًا أو تراجعًا؛ تفسيره من ملاحظة المدرب.</p>
        </section>}
        {(selected.markers || []).map(marker => <button key={marker.id} type="button" onClick={() => { setActiveMarker(marker); if (videoRef.current) { videoRef.current.currentTime = marker.time; videoRef.current.pause(); } }} className="mb-2 block w-full rounded-lg border p-3 text-right text-sm">
          <span className="font-mono" dir="ltr">{timeLabel(marker.time)}</span> · <strong>{marker.label}</strong>
          {marker.note && <span className="mt-1 block text-slate-600">{marker.note}</span>}
          {Object.entries(marker.pose_metrics || {}).length > 0 && <span className="mt-1 block text-xs text-emerald-800">{Object.entries(marker.pose_metrics).map(([key, value]) => `${key === 'knee_angle' ? 'الركبة' : key === 'elbow_angle' ? 'المرفق' : key === 'hip_angle' ? 'الورك' : 'ميل الجذع'} ${value}°`).join(' · ')}</span>}
        </button>)}
      </div>
    </div>}
  </section>;
}
