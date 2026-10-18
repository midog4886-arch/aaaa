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
  const [activeMarker, setActiveMarker] = useState(null);
  const videoRef = useRef(null);

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
    setActiveMarker(null);
    try {
      const response = await memberAPI.get(`/api/member-video-reviews/portal/${encodeURIComponent(report.id)}/play-ticket`);
      setVideoUrl(response.data.url);
    } catch {
      setSelected(null);
    }
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
    {selected && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3" onClick={() => { setSelected(null); setVideoUrl(''); }}>
      <div role="dialog" aria-modal="true" aria-label="تقرير الأداء" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-4" onClick={event => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-lg font-bold">{selected.title}</h3><button type="button" onClick={() => { setSelected(null); setVideoUrl(''); }} className="rounded-md border px-3 py-1">إغلاق</button></div>
        {videoUrl && <div className="relative overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} src={videoUrl} controls playsInline preload="metadata" className="aspect-video w-full" />
          {activeMarker?.drawing && <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <line x1={activeMarker.drawing.x1 * 100} y1={activeMarker.drawing.y1 * 100} x2={activeMarker.drawing.x2 * 100} y2={activeMarker.drawing.y2 * 100} stroke="#f97316" strokeWidth="0.8" />
            <circle cx={activeMarker.drawing.x2 * 100} cy={activeMarker.drawing.y2 * 100} r="1.2" fill="#f97316" />
          </svg>}
        </div>}
        <p className="my-4 whitespace-pre-wrap rounded-lg bg-blue-50 p-3 text-sm text-blue-950">{selected.parent_summary}</p>
        {(selected.markers || []).map(marker => <button key={marker.id} type="button" onClick={() => { setActiveMarker(marker); if (videoRef.current) { videoRef.current.currentTime = marker.time; videoRef.current.pause(); } }} className="mb-2 block w-full rounded-lg border p-3 text-right text-sm">
          <span className="font-mono" dir="ltr">{timeLabel(marker.time)}</span> · <strong>{marker.label}</strong>
          {marker.note && <span className="mt-1 block text-slate-600">{marker.note}</span>}
          {Object.entries(marker.pose_metrics || {}).length > 0 && <span className="mt-1 block text-xs text-emerald-800">{Object.entries(marker.pose_metrics).map(([key, value]) => `${key === 'knee_angle' ? 'الركبة' : key === 'elbow_angle' ? 'المرفق' : key === 'hip_angle' ? 'الورك' : 'ميل الجذع'} ${value}°`).join(' · ')}</span>}
        </button>)}
      </div>
    </div>}
  </section>;
}
