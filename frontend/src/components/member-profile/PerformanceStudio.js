import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { memberVideoReviewsAPI } from '../../services/api';
import { drawPose, poseMetrics } from '../../utils/poseAnalysis';
import { matchPose, pickPose, poseBox, videoPoint } from '../../utils/poseTracking';

const timeLabel = (seconds) => {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};

const errorText = (error) => error?.response?.data?.detail || 'تعذرت العملية. حاول مرة أخرى.';

export default function PerformanceStudio({ member, language = 'ar', canEdit = false }) {
  const ar = language === 'ar';
  const [reviews, setReviews] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [compareId, setCompareId] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [compareUrl, setCompareUrl] = useState('');
  const [draft, setDraft] = useState(null);
  const [activeMarkerId, setActiveMarkerId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [uploadSport, setUploadSport] = useState('swimming');
  const [poseEnabled, setPoseEnabled] = useState(false);
  const [poseLoading, setPoseLoading] = useState(false);
  const [poseError, setPoseError] = useState('');
  const [poseSide, setPoseSide] = useState('right');
  const [poseInfo, setPoseInfo] = useState(null);
  const [targetStatus, setTargetStatus] = useState('select');
  const videoRef = useRef(null);
  const poseCanvasRef = useRef(null);
  const poseModelRef = useRef(null);
  const targetRef = useRef(null);
  const candidatesRef = useRef([]);
  const targetMissesRef = useRef(0);
  const lastTargetTimeRef = useRef(0);
  const analyzeRef = useRef(null);
  const lastInferenceRef = useRef(0);
  const lastModelTimestampRef = useRef(0);
  const comparisonRef = useRef(null);
  const drawStartRef = useRef(null);

  useEffect(() => () => { poseModelRef.current?.close(); poseModelRef.current = null; }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await memberVideoReviewsAPI.list(member.id);
      setReviews(response.data || []);
      setSelectedId(current => current && response.data.some(row => row.id === current) ? current : (response.data[0]?.id || ''));
    } catch (error) {
      toast.error(errorText(error));
    }
  }, [member.id]);

  useEffect(() => {
    setReviews([]);
    setSelectedId('');
    setCompareId('');
    setDraft(null);
    refresh();
  }, [refresh]);

  const selected = reviews.find(row => row.id === selectedId);
  const activeMarker = draft?.markers?.find(row => row.id === activeMarkerId);

  useEffect(() => {
    setDraft(selected ? {
      title: selected.title || '',
      sport: selected.sport || 'swimming',
      coach_summary: selected.coach_summary || '',
      parent_summary: selected.parent_summary || '',
      markers: (selected.markers || []).map(marker => ({ ...marker })),
    } : null);
    setActiveMarkerId('');
    setDirty(false);
    setDrawing(false);
    setSourceUrl('');
    setPoseInfo(null);
    setPoseEnabled(false);
    setPoseError('');
    targetRef.current = null;
    candidatesRef.current = [];
    targetMissesRef.current = 0;
    setTargetStatus('select');
    if (!selectedId) return;
    let active = true;
    memberVideoReviewsAPI.playTicket(selectedId).then(response => {
      if (active) setSourceUrl(response.data.url);
    }).catch(error => { if (active) toast.error(errorText(error)); });
    return () => { active = false; };
  }, [selectedId]); // Review changes are applied locally until saved.

  useEffect(() => {
    setCompareUrl('');
    if (!compareId || compareId === selectedId) return;
    let active = true;
    memberVideoReviewsAPI.playTicket(compareId).then(response => {
      if (active) setCompareUrl(response.data.url);
    }).catch(error => { if (active) toast.error(errorText(error)); });
    return () => { active = false; };
  }, [compareId, selectedId]);

  const change = (patch) => {
    setDraft(current => ({ ...current, ...patch }));
    setDirty(true);
  };

  const updateMarker = (id, patch) => {
    change({ markers: draft.markers.map(marker => marker.id === id ? { ...marker, ...patch } : marker) });
  };

  const analyzeFrame = (force = false) => {
    const video = videoRef.current;
    const model = poseModelRef.current;
    if (!model || !video || video.readyState < 2 || !draft) return null;
    const now = performance.now();
    if (!force && now - lastInferenceRef.current < 80) return null;
    lastInferenceRef.current = now;
    try {
      const timestamp = Math.max(now, lastModelTimestampRef.current + 1);
      lastModelTimestampRef.current = timestamp;
      const poses = model.detectForVideo(video, timestamp).landmarks || [];
      const boxes = poses.map(poseBox);
      candidatesRef.current = poses;
      let selectedIndex = null;
      if (targetRef.current) {
        selectedIndex = matchPose(targetRef.current, boxes, Math.abs(video.currentTime - lastTargetTimeRef.current) * 1000);
        if (selectedIndex === null) {
          targetMissesRef.current += 1;
          if (targetMissesRef.current >= 5 || Math.abs(video.currentTime - lastTargetTimeRef.current) > 0.8) {
            targetRef.current = null;
            setTargetStatus('lost');
          } else {
            setTargetStatus('searching');
          }
        } else {
          targetRef.current = boxes[selectedIndex];
          targetMissesRef.current = 0;
          lastTargetTimeRef.current = video.currentTime;
          setTargetStatus('tracking');
        }
      }
      const points = selectedIndex === null ? null : poses[selectedIndex];
      drawPose(poseCanvasRef.current, video, points, boxes, selectedIndex);
      const seen = points?.filter(point => (point.visibility ?? 1) >= 0.5).length || 0;
      const metrics = seen >= 8 ? poseMetrics(points, draft.sport, poseSide, video.videoWidth / video.videoHeight) : null;
      const result = { metrics, seen, time: video.currentTime, detected: boxes.filter(Boolean).length, selected: selectedIndex !== null };
      setPoseInfo(result);
      return result;
    } catch (error) {
      setPoseError(ar ? 'تعذر تحليل هذا الإطار. جرّب موضعًا أو فيديو أوضح.' : 'Could not analyze this frame. Try a clearer view.');
      return null;
    }
  };
  analyzeRef.current = analyzeFrame;

  useEffect(() => {
    if (!poseEnabled) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;
    let active = true;
    let frameId;
    let intervalId;
    if (video.requestVideoFrameCallback) {
      const tick = () => {
        if (!active) return;
        analyzeRef.current?.();
        frameId = video.requestVideoFrameCallback(tick);
      };
      frameId = video.requestVideoFrameCallback(tick);
    } else {
      intervalId = window.setInterval(() => { if (!video.paused) analyzeRef.current?.(); }, 90);
    }
    return () => {
      active = false;
      if (frameId !== undefined) video.cancelVideoFrameCallback?.(frameId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [poseEnabled, sourceUrl]);

  const togglePose = async () => {
    if (poseEnabled) {
      setPoseEnabled(false);
      setPoseInfo(null);
      targetRef.current = null;
      candidatesRef.current = [];
      targetMissesRef.current = 0;
      setTargetStatus('select');
      drawPose(poseCanvasRef.current, videoRef.current, null);
      return;
    }
    setPoseError('');
    setPoseLoading(true);
    try {
      if (!poseModelRef.current) {
        const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
        poseModelRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: '/mediapipe/models/pose_landmarker_lite.task', delegate: 'CPU' },
          runningMode: 'VIDEO', numPoses: 6,
          minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
        });
      }
      setPoseEnabled(true);
      analyzeFrame(true);
    } catch (error) {
      setPoseError(ar ? 'تعذر تحميل نموذج التحليل. تحقق من الاتصال وأعد المحاولة.' : 'Could not load the analysis model. Please retry.');
    } finally {
      setPoseLoading(false);
    }
  };

  const selectPlayer = (event) => {
    if (!poseEnabled) return;
    const position = videoPoint(event, videoRef.current, poseCanvasRef.current);
    const poses = candidatesRef.current;
    const boxes = poses.map(poseBox);
    const index = position ? pickPose(boxes, position) : null;
    if (index === null) {
      setTargetStatus('select');
      return;
    }
    targetRef.current = boxes[index];
    targetMissesRef.current = 0;
    lastTargetTimeRef.current = videoRef.current.currentTime;
    setTargetStatus('tracking');
    const points = poses[index];
    drawPose(poseCanvasRef.current, videoRef.current, points, boxes, index);
    const seen = points.filter(point => (point.visibility ?? 1) >= 0.5).length;
    setPoseInfo({ metrics: seen >= 8 ? poseMetrics(points, draft.sport, poseSide, videoRef.current.videoWidth / videoRef.current.videoHeight) : null,
      seen, detected: boxes.filter(Boolean).length, selected: true, time: videoRef.current.currentTime });
    if (videoRef.current.paused) videoRef.current.play().catch(() => {});
  };

  const resetPlayerOnSeek = () => {
    if (!poseEnabled) return;
    targetRef.current = null;
    targetMissesRef.current = 0;
    setTargetStatus('lost');
    setPoseInfo(null);
    analyzeFrame(true);
  };

  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.mp4') || file.size > 200 * 1024 * 1024) {
      toast.error(ar ? 'ارفع فيديو MP4 لا يتجاوز 200 ميجابايت' : 'Upload an MP4 smaller than 200 MB');
      return;
    }
    setUploading(true);
    try {
      const response = await memberVideoReviewsAPI.upload(member.id, file, uploadSport);
      await refresh();
      setSelectedId(response.data.id);
      toast.success(ar ? 'تم رفع الفيديو كمسودة خاصة' : 'Video uploaded as a private draft');
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setUploading(false);
    }
  };

  const addMarker = () => {
    if (!videoRef.current || !draft) return;
    videoRef.current.pause();
    const sample = poseEnabled ? analyzeFrame(true) : null;
    const marker = {
      id: `moment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, time: Number(videoRef.current.currentTime.toFixed(2)),
      label: ar ? 'لقطة جديدة' : 'New moment', note: '', share_with_parent: false, drawing: null,
      pose_metrics: Object.fromEntries(Object.entries(sample?.metrics || {}).filter(([, value]) => Number.isFinite(value))),
      pose_side: sample?.metrics ? poseSide : null,
    };
    change({ markers: [...draft.markers, marker].sort((a, b) => a.time - b.time) });
    setActiveMarkerId(marker.id);
  };

  const save = async () => {
    if (!selected || !draft) return;
    setBusy(true);
    try {
      const response = await memberVideoReviewsAPI.update(selected.id, draft);
      setReviews(current => current.map(row => row.id === selected.id ? response.data : row));
      setDirty(false);
      toast.success(ar ? 'تم حفظ تحليل المدرب' : 'Coach review saved');
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status) => {
    if (!selected || dirty) return;
    setBusy(true);
    try {
      const response = await memberVideoReviewsAPI.setStatus(selected.id, status);
      setReviews(current => current.map(row => row.id === selected.id ? response.data : row));
      toast.success(status === 'approved' ? (ar ? 'أصبح التقرير ظاهرًا لولي الأمر' : 'Report shared with parent') : (ar ? 'عاد التقرير إلى مسودة خاصة' : 'Report returned to draft'));
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected || !window.confirm(ar ? 'حذف الفيديو وتحليله نهائيًا؟' : 'Delete this video and its review permanently?')) return;
    setBusy(true);
    try {
      await memberVideoReviewsAPI.delete(selected.id);
      setCompareId(current => current === selected.id ? '' : current);
      await refresh();
      toast.success(ar ? 'تم حذف الفيديو' : 'Video deleted');
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const seek = (seconds) => {
    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.pause();
    }
  };

  const step = (direction) => {
    if (videoRef.current) seek(Math.max(0, videoRef.current.currentTime + direction / 30));
  };

  const pointInOverlay = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
             y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
  };

  return <div className="space-y-4" dir={ar ? 'rtl' : 'ltr'}>
    <div className="rounded-xl border bg-blue-50 p-4 text-sm text-blue-900">
      <strong>{ar ? 'استوديو تحليل الأداء' : 'Performance review studio'}</strong>
      <p className="mt-1">{ar ? 'الفيديو ومسودة التحليل خاصان بالمدربين. لا يرى ولي الأمر سوى التقرير بعد اعتماده.' : 'Videos and drafts stay private to staff. Parents only see approved reports.'}</p>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {canEdit && <select aria-label={ar ? 'رياضة الفيديو الجديد' : 'Sport for new video'} value={uploadSport} onChange={event => setUploadSport(event.target.value)} className="rounded-md border bg-white p-2 text-sm">
        <option value="swimming">{ar ? 'سباحة' : 'Swimming'}</option>
        <option value="football">{ar ? 'كرة قدم' : 'Football'}</option>
      </select>}
      {canEdit && <label className="inline-flex cursor-pointer items-center rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white">
        {uploading ? (ar ? 'جارٍ الرفع...' : 'Uploading...') : (ar ? 'رفع فيديو MP4' : 'Upload MP4')}
        <input type="file" accept="video/mp4,.mp4" className="hidden" disabled={uploading} onChange={upload} />
      </label>}
      <select aria-label={ar ? 'الفيديو الحالي' : 'Current video'} value={selectedId} onChange={event => setSelectedId(event.target.value)} className="min-w-[220px] rounded-md border bg-white p-2 text-sm">
        <option value="">{ar ? 'اختر فيديو' : 'Choose video'}</option>
        {reviews.map(row => <option key={row.id} value={row.id}>{row.title} · {row.sport === 'football' ? (ar ? 'قدم' : 'Football') : (ar ? 'سباحة' : 'Swimming')} · {row.status === 'approved' ? (ar ? 'معتمد' : 'Approved') : (ar ? 'مسودة' : 'Draft')}</option>)}
      </select>
      {selected && <select aria-label={ar ? 'فيديو المقارنة' : 'Comparison video'} value={compareId} onChange={event => setCompareId(event.target.value)} className="min-w-[220px] rounded-md border bg-white p-2 text-sm">
        <option value="">{ar ? 'مقارنة مع فيديو سابق' : 'Compare with another video'}</option>
        {reviews.filter(row => row.id !== selectedId).map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
      </select>}
    </div>
    {!selected && <p className="rounded-lg border p-8 text-center text-muted-foreground">{ar ? 'لا توجد فيديوهات تحليل لهذا العضو بعد.' : 'No performance review videos yet.'}</p>}
    {selected && draft && <>
      <div className={`grid gap-3 ${compareId ? 'lg:grid-cols-2' : ''}`}>
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-lg bg-black">
            {sourceUrl && <video ref={videoRef} src={sourceUrl} controls playsInline preload="metadata" className="aspect-video w-full object-contain" onTimeUpdate={() => { if (poseEnabled) analyzeFrame(); }} onSeeked={resetPlayerOnSeek} />}
            <canvas ref={poseCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
            {poseEnabled && !drawing && <div className="absolute inset-x-0 top-0 bottom-12 cursor-crosshair" onClick={selectPlayer} role="button" tabIndex={0}
              aria-label={ar ? 'اضغط على إطار اللاعب لاختياره' : 'Click a person box to select them'} />}
            {activeMarker?.drawing && <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <line x1={activeMarker.drawing.x1 * 100} y1={activeMarker.drawing.y1 * 100} x2={activeMarker.drawing.x2 * 100} y2={activeMarker.drawing.y2 * 100} stroke="#f97316" strokeWidth="0.8" />
              <circle cx={activeMarker.drawing.x2 * 100} cy={activeMarker.drawing.y2 * 100} r="1.2" fill="#f97316" />
            </svg>}
            {drawing && activeMarker && <div className="absolute inset-0 cursor-crosshair" aria-label={ar ? 'ارسم خطًا على اللقطة' : 'Draw a line on the frame'}
              onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drawStartRef.current = pointInOverlay(event); }}
              onPointerUp={event => { if (!drawStartRef.current) return; const end = pointInOverlay(event); updateMarker(activeMarker.id, { drawing: { x1: drawStartRef.current.x, y1: drawStartRef.current.y, x2: end.x, y2: end.y } }); drawStartRef.current = null; setDrawing(false); }} />}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => step(-1)}>{ar ? 'إطار للخلف' : 'Previous frame'}</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => step(1)}>{ar ? 'إطار للأمام' : 'Next frame'}</Button>
            {[0.25, 0.5, 1].map(rate => <Button type="button" key={rate} variant="outline" size="sm" onClick={() => { if (videoRef.current) videoRef.current.playbackRate = rate; }}>{rate}×</Button>)}
            {canEdit && selected.status === 'draft' && <Button type="button" size="sm" onClick={addMarker}>{ar ? 'حدد لقطة' : 'Mark moment'}</Button>}
          </div>
          <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={togglePose} disabled={poseLoading || !sourceUrl}>
                {poseLoading ? (ar ? 'تحميل نموذج الحركة…' : 'Loading pose model…') : poseEnabled ? (ar ? 'إيقاف تتبّع المفاصل' : 'Stop pose tracking') : (ar ? 'تشغيل تحليل الحركة AI' : 'Start AI pose tracking')}
              </Button>
              <select aria-label={ar ? 'جانب الجسم للتحليل' : 'Body side to analyze'} value={poseSide} onChange={event => { setPoseSide(event.target.value); setPoseInfo(null); }} className="rounded-md border bg-white p-2">
                <option value="right">{ar ? 'الجانب الأيمن' : 'Right side'}</option><option value="left">{ar ? 'الجانب الأيسر' : 'Left side'}</option>
              </select>
              <span className="font-semibold">{draft.sport === 'football' ? (ar ? 'كرة قدم' : 'Football') : (ar ? 'سباحة' : 'Swimming')}</span>
            </div>
            {poseError && <p className="text-red-700" role="alert">{poseError}</p>}
            {poseEnabled && <p>{targetStatus === 'lost' ? (ar ? 'فُقد اللاعب أو تغيّر موضعه؛ توقفت القياسات. أوقف الفيديو وحدده مجددًا.' : 'Player lost or moved; measurements paused. Pause and select again.') : targetStatus === 'searching' ? (ar ? 'اللاعب محجوب مؤقتًا؛ القياسات متوقفة حتى يظهر بوضوح.' : 'Player temporarily obscured; measurements paused.') : !poseInfo?.selected ? (ar ? `اختر اللاعب بالضغط على إطاره في الفيديو. الأشخاص المكتشفون: ${poseInfo?.detected || 0}` : `Click the player's box. Detected people: ${poseInfo?.detected || 0}`) : poseInfo.seen >= 8 ? (ar ? `تتبّع اللاعب المحدد · نقاط ظاهرة: ${poseInfo.seen} من 33` : `Tracking selected player · ${poseInfo.seen} visible landmarks`) : (ar ? 'اللاعب المحدد غير واضح بما يكفي؛ لن تُعرض قياسات غير موثوقة.' : 'Selected player visibility is too low; no measurements shown.')}</p>}
            {poseEnabled && poseInfo?.selected && poseInfo?.seen >= 8 && <div className="flex flex-wrap gap-2">
              {Object.entries(poseInfo.metrics || {}).map(([key, value]) => Number.isFinite(value) && <span key={key} className="rounded-md bg-white px-2 py-1">
                {key === 'knee_angle' ? (ar ? 'زاوية الركبة' : 'Knee angle') : key === 'elbow_angle' ? (ar ? 'زاوية المرفق' : 'Elbow angle') : key === 'hip_angle' ? (ar ? 'زاوية الورك' : 'Hip angle') : (ar ? 'ميل الجذع عن العمودي' : 'Trunk tilt from vertical')}: {value}°
              </span>)}
            </div>}
            <p className="text-xs text-slate-600">{ar ? 'قياسات تقريبية من زاوية التصوير الحالية. يراجعها المدرب قبل حفظ اللقطة أو مشاركتها، وقد تخطئ عند حجب الجسم أو تحت الماء.' : 'Approximate single-view measurements. The coach reviews each moment before sharing; occlusion and underwater footage reduce reliability.'}</p>
          </div>
        </div>
        {compareId && <div className="space-y-2">
          {compareUrl && <video ref={comparisonRef} src={compareUrl} controls playsInline preload="metadata" className="aspect-video w-full rounded-lg bg-black" />}
          <Button type="button" variant="outline" size="sm" onClick={() => { if (videoRef.current && comparisonRef.current) { comparisonRef.current.currentTime = videoRef.current.currentTime; comparisonRef.current.pause(); } }}>{ar ? 'زامن وقت الفيديوين' : 'Sync video times'}</Button>
        </div>}
      </div>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-2 rounded-lg border p-3">
          <h3 className="font-semibold">{ar ? 'اللقطات المحددة' : 'Marked moments'}</h3>
          {draft.markers.length === 0 && <p className="text-sm text-muted-foreground">{ar ? 'أوقف الفيديو عند لحظة مهمة ثم اضغط «حدد لقطة».' : 'Pause at an important moment and mark it.'}</p>}
          {draft.markers.map(marker => <button type="button" key={marker.id} onClick={() => { setActiveMarkerId(marker.id); seek(marker.time); }} className={`block w-full rounded-md border p-2 text-start text-sm ${activeMarkerId === marker.id ? 'border-blue-500 bg-blue-50' : ''}`}>
            <span className="font-mono" dir="ltr">{timeLabel(marker.time)}</span> · {marker.label}
            {marker.share_with_parent && <span className="ms-2 text-green-700">{ar ? 'للأهل' : 'Parent'}</span>}
          </button>)}
        </div>
        <div className="space-y-3 rounded-lg border p-3">
          {canEdit && selected.status === 'draft' && <select aria-label={ar ? 'رياضة التحليل' : 'Review sport'} value={draft.sport} onChange={event => change({ sport: event.target.value })} className="w-full rounded-md border bg-white p-2 text-sm">
            <option value="swimming">{ar ? 'سباحة' : 'Swimming'}</option><option value="football">{ar ? 'كرة قدم' : 'Football'}</option>
          </select>}
          <label className="block text-sm font-medium">{ar ? 'عنوان التحليل' : 'Review title'}</label>
          <Input value={draft.title} disabled={!canEdit || selected.status !== 'draft'} onChange={event => change({ title: event.target.value })} maxLength={120} />
          <label className="block text-sm font-medium">{ar ? 'ملاحظات خاصة للمدربين' : 'Private coach notes'}</label>
          <Textarea value={draft.coach_summary} disabled={!canEdit || selected.status !== 'draft'} onChange={event => change({ coach_summary: event.target.value })} maxLength={2000} />
          <label className="block text-sm font-medium">{ar ? 'ملخص سيظهر لولي الأمر بعد الاعتماد' : 'Parent summary after approval'}</label>
          <Textarea value={draft.parent_summary} disabled={!canEdit || selected.status !== 'draft'} onChange={event => change({ parent_summary: event.target.value })} maxLength={2000} />
          {activeMarker && <div className="space-y-2 rounded-md bg-slate-50 p-3">
            <strong className="text-sm">{ar ? 'تعليق على اللقطة' : 'Moment annotation'} · {timeLabel(activeMarker.time)}</strong>
            {Object.entries(activeMarker.pose_metrics || {}).length > 0 && <p className="text-xs text-emerald-800">{ar ? 'قياسات محفوظة للمراجعة: ' : 'Saved measurements: '}{Object.entries(activeMarker.pose_metrics).map(([key, value]) => `${key}: ${value}°`).join(' · ')}</p>}
            <Input value={activeMarker.label} disabled={!canEdit || selected.status !== 'draft'} maxLength={100} onChange={event => updateMarker(activeMarker.id, { label: event.target.value })} />
            <Textarea value={activeMarker.note} disabled={!canEdit || selected.status !== 'draft'} maxLength={1000} placeholder={ar ? 'ملاحظة على الأداء' : 'Performance note'} onChange={event => updateMarker(activeMarker.id, { note: event.target.value })} />
            {canEdit && selected.status === 'draft' && <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => { seek(activeMarker.time); setDrawing(true); }}>{ar ? 'ارسم خطًا على اللقطة' : 'Draw a line'}</Button>
              {activeMarker.drawing && <Button type="button" variant="outline" size="sm" onClick={() => updateMarker(activeMarker.id, { drawing: null })}>{ar ? 'امسح الرسم' : 'Clear drawing'}</Button>}
              <label className="inline-flex items-center gap-1 text-sm"><input type="checkbox" checked={activeMarker.share_with_parent} onChange={event => updateMarker(activeMarker.id, { share_with_parent: event.target.checked })} />{ar ? 'أظهر هذه اللقطة لولي الأمر' : 'Share this moment with parent'}</label>
              <Button type="button" variant="destructive" size="sm" onClick={() => { change({ markers: draft.markers.filter(row => row.id !== activeMarker.id) }); setActiveMarkerId(''); }}>{ar ? 'حذف اللقطة' : 'Remove moment'}</Button>
            </div>}
          </div>}
        </div>
      </div>
      {canEdit && <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        {selected.status === 'draft' && <Button type="button" onClick={save} disabled={busy || !dirty}>{ar ? 'حفظ التحليل' : 'Save review'}</Button>}
        {selected.status === 'draft' && <Button type="button" variant="outline" onClick={() => setStatus('approved')} disabled={busy || dirty || !draft.parent_summary.trim()}>{ar ? 'اعتماد ومشاركة الفيديو مع ولي الأمر' : 'Approve and share video with parent'}</Button>}
        {selected.status === 'approved' && <Button type="button" variant="outline" onClick={() => setStatus('draft')} disabled={busy}>{ar ? 'إلغاء المشاركة وإعادة المسودة' : 'Unshare and return to draft'}</Button>}
        <Button type="button" variant="destructive" onClick={remove} disabled={busy}>{ar ? 'حذف الفيديو' : 'Delete video'}</Button>
        {dirty && <span className="text-sm text-amber-700">{ar ? 'احفظ التعديلات قبل الاعتماد' : 'Save changes before approval'}</span>}
        {selected.status === 'draft' && <p className="w-full text-xs text-muted-foreground">{ar ? 'الاعتماد يتيح لولي الأمر مشاهدة الفيديو كاملًا واللقطات التي اخترت إظهارها فقط.' : 'Approval lets the parent view the full video and only the moments you marked for sharing.'}</p>}
      </div>}
    </>}
  </div>;
}
