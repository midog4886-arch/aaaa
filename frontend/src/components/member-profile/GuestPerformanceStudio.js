import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { drawPose, poseMetrics } from '../../utils/poseAnalysis';
import { ambiguousPose, matchPose, OCCLUSION_GRACE_SECONDS, pickPose, poseBox, videoPoint } from '../../utils/poseTracking';
import { metricLabel, MOMENT_LABELS, SKILLS, skillLabel } from '../../utils/performanceReport';

const formatTime = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export default function GuestPerformanceStudio({ language = 'ar' }) {
  const ar = language === 'ar';
  const [guestName, setGuestName] = useState('');
  const [sport, setSport] = useState('swimming');
  const [skill, setSkill] = useState('swimming_freestyle');
  const [side, setSide] = useState('right');
  const [stage, setStage] = useState('after');
  const [files, setFiles] = useState({ before: null, after: null });
  const [tracking, setTracking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('select');
  const [frame, setFrame] = useState(null);
  const [captures, setCaptures] = useState({ before: null, after: null });
  const [moment, setMoment] = useState('');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const modelRef = useRef(null);
  const urlsRef = useRef({ before: null, after: null });
  const candidatesRef = useRef([]);
  const targetRef = useRef(null);
  const lastTargetTimeRef = useRef(0);
  const lastInferenceRef = useRef(0);
  const lastModelTimestampRef = useRef(0);
  const analyzeRef = useRef(null);

  useEffect(() => () => {
    modelRef.current?.close();
    Object.values(urlsRef.current).forEach(url => { if (url) URL.revokeObjectURL(url); });
  }, []);

  const resetTarget = () => {
    targetRef.current = null;
    candidatesRef.current = [];
    setStatus('select');
    setFrame(null);
    drawPose(canvasRef.current, videoRef.current, null);
  };

  const openVideo = (event, slot) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (urlsRef.current[slot]) URL.revokeObjectURL(urlsRef.current[slot]);
    const url = URL.createObjectURL(file);
    urlsRef.current[slot] = url;
    setFiles(current => ({ ...current, [slot]: { name: file.name, url } }));
    setCaptures(current => ({ ...current, [slot]: null }));
    setStage(slot);
    resetTarget();
  };

  const analyze = (force = false) => {
    const video = videoRef.current;
    if (!tracking || !modelRef.current || !video || video.readyState < 2) return;
    const now = performance.now();
    if (!force && now - lastInferenceRef.current < 80) return;
    lastInferenceRef.current = now;
    try {
      const timestamp = Math.max(now, lastModelTimestampRef.current + 1);
      lastModelTimestampRef.current = timestamp;
      const poses = modelRef.current.detectForVideo(video, timestamp).landmarks || [];
      const boxes = poses.map(poseBox);
      candidatesRef.current = poses;
      let selected = null;
      if (targetRef.current) {
        const elapsed = Math.abs(video.currentTime - lastTargetTimeRef.current) * 1000;
        if (ambiguousPose(targetRef.current, boxes, elapsed)) {
          targetRef.current = null;
          setStatus('lost');
        } else {
          selected = matchPose(targetRef.current, boxes, elapsed);
          if (selected === null) {
            if (elapsed > OCCLUSION_GRACE_SECONDS * 1000) {
              targetRef.current = null;
              setStatus('lost');
            } else setStatus('searching');
          } else {
            targetRef.current = boxes[selected];
            lastTargetTimeRef.current = video.currentTime;
            setStatus('tracking');
          }
        }
      }
      const points = selected === null ? null : poses[selected];
      drawPose(canvasRef.current, video, points, boxes, selected);
      const seen = points?.filter(point => (point.visibility ?? 1) >= 0.5 && (point.presence ?? 1) >= 0.5).length || 0;
      const metrics = seen >= 8 ? poseMetrics(points, sport, side, video.videoWidth / video.videoHeight) : null;
      const result = { time: video.currentTime, seen, metrics, detected: boxes.filter(Boolean).length, selected: selected !== null };
      setFrame(result);
      return result;
    } catch (_) {
      setError(ar ? 'تعذر تحليل هذه اللقطة. جرّب فيديو أو زاوية تصوير أوضح.' : 'Could not analyze this frame. Try a clearer video angle.');
    }
  };
  analyzeRef.current = analyze;

  useEffect(() => {
    if (!tracking || !files[stage]) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;
    let active = true;
    let handle;
    if (video.requestVideoFrameCallback) {
      const tick = () => {
        if (!active) return;
        analyzeRef.current?.();
        handle = video.requestVideoFrameCallback(tick);
      };
      handle = video.requestVideoFrameCallback(tick);
      return () => { active = false; if (handle !== undefined) video.cancelVideoFrameCallback?.(handle); };
    }
    handle = window.setInterval(() => { if (!video.paused) analyzeRef.current?.(); }, 90);
    return () => { active = false; window.clearInterval(handle); };
  }, [tracking, files, stage]);

  const toggleTracking = async () => {
    if (tracking) { setTracking(false); resetTarget(); return; }
    setError('');
    setLoading(true);
    try {
      if (!modelRef.current) {
        const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
        modelRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: '/mediapipe/models/pose_landmarker_lite.task', delegate: 'CPU' },
          runningMode: 'VIDEO', numPoses: 6,
          minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
        });
      }
      setTracking(true);
      setStatus('select');
    } catch (_) {
      setError(ar ? 'تعذر تحميل نموذج التتبّع.' : 'Could not load the tracking model.');
    } finally { setLoading(false); }
  };

  const choosePlayer = event => {
    const position = videoPoint(event, videoRef.current, canvasRef.current);
    const boxes = candidatesRef.current.map(poseBox);
    const index = position ? pickPose(boxes, position) : null;
    if (index === null) { setStatus('select'); return; }
    targetRef.current = boxes[index];
    lastTargetTimeRef.current = videoRef.current.currentTime;
    setStatus('tracking');
    analyzeRef.current?.(true);
  };

  const capture = () => {
    videoRef.current?.pause();
    const currentFrame = analyzeRef.current?.(true) || frame;
    if (!currentFrame?.selected || !currentFrame.metrics || !Object.values(currentFrame.metrics).some(Number.isFinite)) {
      setError(ar ? 'أوقف الفيديو عند لقطة واضحة وحدد اللاعب أولًا.' : 'Pause on a clear frame and select the athlete first.');
      return;
    }
    setError('');
    setCaptures(current => ({ ...current, [stage]: { time: currentFrame.time, metrics: currentFrame.metrics, moment: moment || MOMENT_LABELS[skill]?.[0] || '' } }));
  };

  const downloadReport = () => {
    const lines = [ar ? 'تقرير تحليل أداء زائر' : 'Guest performance report',
      `${ar ? 'الاسم' : 'Name'}: ${guestName.trim() || (ar ? 'غير محدد' : 'Unnamed')}`,
      `${ar ? 'الرياضة' : 'Sport'}: ${sport === 'swimming' ? (ar ? 'سباحة' : 'Swimming') : (ar ? 'كرة قدم' : 'Football')}`,
      `${ar ? 'المهارة' : 'Skill'}: ${skillLabel(skill)}`, ''];
    for (const slot of ['before', 'after']) {
      const item = captures[slot];
      if (!item) continue;
      lines.push(`${slot === 'before' ? (ar ? 'قبل' : 'Before') : (ar ? 'بعد' : 'After')} — ${item.moment} (${formatTime(item.time)})`);
      Object.entries(item.metrics || {}).filter(([, value]) => Number.isFinite(value)).forEach(([key, value]) => lines.push(`${metricLabel(key)}: ${value}°`));
      lines.push('');
    }
    if (captures.before && captures.after) {
      lines.push(ar ? 'الفرق (بعد − قبل)' : 'Difference (after − before)');
      Object.entries(captures.after.metrics || {}).filter(([key, value]) => Number.isFinite(value) && Number.isFinite(captures.before.metrics?.[key]))
        .forEach(([key, value]) => lines.push(`${metricLabel(key)}: ${value - captures.before.metrics[key]}°`));
      lines.push('');
    }
    lines.push(ar ? 'القياسات تقريبية من كاميرا واحدة؛ يراجعها المدرب، ولا يعني اختلاف الزوايا وحده تحسن الأداء.' : 'Single-camera estimates require coach review; angle differences alone do not prove improvement.');
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'guest-performance-report.txt';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const current = files[stage];
  return <div className="space-y-4 rounded-xl border bg-white p-3 shadow-sm sm:p-6" dir={ar ? 'rtl' : 'ltr'}>
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
      {ar ? 'تحليل الزائر يعمل على جهازك داخل المتصفح. لا يلزم إنشاء عضو، ولا يُرفع الفيديو أو يُحفظ التقرير في النظام. يمكنك تنزيل تقرير القياسات قبل إغلاق الصفحة.' : 'Guest analysis runs locally in your browser. No membership or video upload is required. Download the report before leaving.'}
    </div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-[180px] flex-1 text-sm">{ar ? 'اسم الزائر (اختياري)' : 'Guest name (optional)'}<Input value={guestName} onChange={event => setGuestName(event.target.value)} className="mt-1" /></label>
      <label className="text-sm">{ar ? 'الرياضة' : 'Sport'}<select value={sport} onChange={event => { const next = event.target.value; setSport(next); setSkill(SKILLS[next][0][0]); setCaptures({ before: null, after: null }); }} className="mt-1 block rounded-md border bg-white p-2"><option value="swimming">{ar ? 'سباحة' : 'Swimming'}</option><option value="football">{ar ? 'كرة قدم' : 'Football'}</option></select></label>
      <label className="text-sm">{ar ? 'المهارة' : 'Skill'}<select value={skill} onChange={event => { setSkill(event.target.value); setCaptures({ before: null, after: null }); }} className="mt-1 block rounded-md border bg-white p-2">{SKILLS[sport].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm">{ar ? 'جانب الجسم' : 'Body side'}<select value={side} onChange={event => { setSide(event.target.value); setCaptures({ before: null, after: null }); }} className="mt-1 block rounded-md border bg-white p-2"><option value="right">{ar ? 'الأيمن' : 'Right'}</option><option value="left">{ar ? 'الأيسر' : 'Left'}</option></select></label>
    </div>
    <div className="flex flex-wrap gap-2">
      {['before', 'after'].map(slot => <label key={slot} className="cursor-pointer rounded-md border px-3 py-2 text-sm hover:bg-slate-50">{slot === 'before' ? (ar ? 'افتح فيديو قبل' : 'Open before video') : (ar ? 'افتح فيديو بعد / فيديو واحد' : 'Open after / single video')}
        <input type="file" accept="video/*" className="hidden" onChange={event => openVideo(event, slot)} /></label>)}
      {files.before && <Button type="button" size="sm" variant={stage === 'before' ? 'default' : 'outline'} onClick={() => { setStage('before'); resetTarget(); }}>{ar ? 'عرض قبل' : 'View before'}</Button>}
      {files.after && <Button type="button" size="sm" variant={stage === 'after' ? 'default' : 'outline'} onClick={() => { setStage('after'); resetTarget(); }}>{ar ? 'عرض بعد' : 'View after'}</Button>}
    </div>
    {current && <>
      <p className="text-sm text-slate-600">{current.name}</p>
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video key={current.url} ref={videoRef} src={current.url} controls playsInline preload="metadata" className="aspect-video w-full object-contain" onTimeUpdate={() => analyzeRef.current?.()} onSeeked={resetTarget} />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
        {tracking && <div className="absolute inset-x-0 top-0 bottom-12 cursor-crosshair" role="button" tabIndex={0} aria-label={ar ? 'حدد اللاعب في الفيديو' : 'Select athlete in video'} onClick={choosePlayer} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.click(); }} />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={toggleTracking} disabled={loading}>{loading ? (ar ? 'تحميل النموذج…' : 'Loading model…') : tracking ? (ar ? 'إيقاف التتبّع' : 'Stop tracking') : (ar ? 'تشغيل تتبّع المفاصل' : 'Start pose tracking')}</Button>
        <select value={moment} onChange={event => setMoment(event.target.value)} className="rounded-md border bg-white p-2 text-sm" aria-label={ar ? 'لحظة الحركة' : 'Movement moment'}><option value="">{ar ? 'اختر لحظة الحركة' : 'Choose movement moment'}</option>{(MOMENT_LABELS[skill] || MOMENT_LABELS.general).map(label => <option key={label} value={label}>{label}</option>)}</select>
        <Button type="button" variant="outline" onClick={capture} disabled={!tracking}>{ar ? `حفظ لقطة ${stage === 'before' ? 'قبل' : 'بعد'}` : `Capture ${stage}`}</Button>
      </div>
      {tracking && <p className="text-sm text-slate-600">{status === 'lost' ? (ar ? 'فُقد اللاعب أو تداخل مع آخر؛ حدده مجددًا.' : 'Athlete lost or overlapping; select again.') : status === 'searching' ? (ar ? 'حجب مؤقت؛ القياسات متوقفة.' : 'Temporarily obscured; measurements paused.') : !frame?.selected ? (ar ? `اضغط على إطار اللاعب في الفيديو. الأشخاص المكتشفون: ${frame?.detected || 0}` : `Click the athlete box. Detected: ${frame?.detected || 0}`) : frame.seen < 8 ? (ar ? 'المفاصل غير واضحة بما يكفي للقياس.' : 'Landmarks are not clear enough for measurement.') : (ar ? `نقاط ظاهرة: ${frame.seen} من 33` : `${frame.seen} visible landmarks`)}</p>}
      {frame?.selected && frame.seen >= 8 && <div className="flex flex-wrap gap-2">{Object.entries(frame.metrics || {}).filter(([, value]) => Number.isFinite(value)).map(([key, value]) => <span key={key} className="rounded-md bg-blue-50 px-3 py-2 text-sm">{metricLabel(key)}: {value}°</span>)}</div>}
    </>}
    {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {(captures.before || captures.after) && <div className="rounded-lg border p-4">
      <h2 className="mb-3 font-semibold">{ar ? 'تقرير اللقطات' : 'Moment report'}</h2>
      <div className="grid gap-3 sm:grid-cols-2">{['before', 'after'].map(slot => <div key={slot} className="rounded-md bg-slate-50 p-3 text-sm"><strong>{slot === 'before' ? (ar ? 'قبل' : 'Before') : (ar ? 'بعد' : 'After')}</strong>{captures[slot] ? <><p>{captures[slot].moment} · {formatTime(captures[slot].time)}</p>{Object.entries(captures[slot].metrics || {}).filter(([, value]) => Number.isFinite(value)).map(([key, value]) => <p key={key}>{metricLabel(key)}: {value}°</p>)}</> : <p className="text-slate-500">{ar ? 'لم تُحفظ لقطة' : 'No captured moment'}</p>}</div>)}</div>
      {captures.before && captures.after && <div className="mt-3 rounded-md bg-blue-50 p-3 text-sm"><strong>{ar ? 'الفرق بين اللقطتين' : 'Difference between moments'}</strong><div className="mt-2 flex flex-wrap gap-3">{Object.entries(captures.after.metrics || {}).filter(([key, value]) => Number.isFinite(value) && Number.isFinite(captures.before.metrics?.[key])).map(([key, value]) => <span key={key}>{metricLabel(key)}: {value - captures.before.metrics[key]}°</span>)}</div></div>}
      <p className="my-3 text-xs text-amber-800">{ar ? 'الأرقام تقريبية من كاميرا واحدة. اختلاف الزوايا وحده ليس حكمًا بتحسن الأداء؛ راجع الحركة بصريًا.' : 'Single-camera measurements are approximate. Angle changes alone do not prove improvement.'}</p>
      <Button type="button" variant="outline" onClick={downloadReport}>{ar ? 'تنزيل التقرير' : 'Download report'}</Button>
    </div>}
  </div>;
}
