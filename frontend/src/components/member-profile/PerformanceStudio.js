import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { memberVideoReviewsAPI } from '../../services/api';
import { createGuestPerformanceReviews } from '../../utils/guestPerformanceReviews';
import { applyPoseCorrections, drawPose, nearestEditableJoint, poseMetrics } from '../../utils/poseAnalysis';
import { ambiguousPose, matchPose, OCCLUSION_GRACE_SECONDS, pickPose, poseBox, videoPoint } from '../../utils/poseTracking';
import { comparisonReport, metricLabel, MOMENT_LABELS, skillLabel, SKILLS } from '../../utils/performanceReport';
import ComparisonChart from './ComparisonChart';

const timeLabel = (seconds) => {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};

const errorText = (error) => error?.response?.data?.detail || 'تعذرت العملية. حاول مرة أخرى.';
const JOINT_LABELS = ['الكتف', 'المرفق', 'الرسغ', 'الورك', 'الركبة', 'الكاحل'];

export default function PerformanceStudio({ member, language = 'ar', canEdit = false, guestMode = false }) {
  const ar = language === 'ar';
  const guestReviewsRef = useRef(null);
  if (!guestReviewsRef.current) guestReviewsRef.current = createGuestPerformanceReviews();
  const reviewAPI = guestMode ? guestReviewsRef.current : memberVideoReviewsAPI;
  const [reviews, setReviews] = useState([]);
  const [guestName, setGuestName] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [compareId, setCompareId] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [compareUrl, setCompareUrl] = useState('');
  const [overlayComparison, setOverlayComparison] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const localVideosRef = useRef(new Map());
  const [draft, setDraft] = useState(null);
  const [activeMarkerId, setActiveMarkerId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [uploadSport, setUploadSport] = useState('swimming');
  const [uploadSkill, setUploadSkill] = useState('swimming_freestyle');
  const [sampleCount, setSampleCount] = useState(0);
  const [chartMetric, setChartMetric] = useState('elbow_angle');
  const [poseEnabled, setPoseEnabled] = useState(false);
  const [poseLoading, setPoseLoading] = useState(false);
  const [poseError, setPoseError] = useState('');
  const [poseSide, setPoseSide] = useState('right');
  const [poseInfo, setPoseInfo] = useState(null);
  const [targetStatus, setTargetStatus] = useState('select');
  const [correctionMode, setCorrectionMode] = useState(false);
  const [correctionJoint, setCorrectionJoint] = useState('auto');
  const videoRef = useRef(null);
  const poseCanvasRef = useRef(null);
  const poseModelRef = useRef(null);
  const targetRef = useRef(null);
  const candidatesRef = useRef([]);
  const samplesRef = useRef(new Map());
  const targetMissesRef = useRef(0);
  const lastTargetTimeRef = useRef(0);
  const analyzeRef = useRef(null);
  const lastInferenceRef = useRef(0);
  const lastModelTimestampRef = useRef(0);
  const comparisonRef = useRef(null);
  const drawStartRef = useRef(null);
  const correctionJointRef = useRef(null);
  const selectedPointsRef = useRef(null);
  const selectedIndexRef = useRef(null);
  const boxesRef = useRef([]);

  useEffect(() => () => { poseModelRef.current?.close(); poseModelRef.current = null; }, []);
  useEffect(() => () => {
    localVideosRef.current.forEach(url => URL.revokeObjectURL(url));
    localVideosRef.current.clear();
  }, [member.id]);

  const keepLocalVideo = (reviewId, file) => {
    const previous = localVideosRef.current.get(reviewId);
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(file);
    localVideosRef.current.set(reviewId, url);
    return url;
  };

  const refresh = useCallback(async () => {
    try {
      const response = await reviewAPI.list(member.id);
      setReviews(response.data || []);
      setSelectedId(current => current && response.data.some(row => row.id === current) ? current : (response.data[0]?.id || ''));
    } catch (error) {
      toast.error(errorText(error));
    }
  }, [member.id, reviewAPI]);

  useEffect(() => {
    setReviews([]);
    setSelectedId('');
    setCompareId('');
    setDraft(null);
    refresh();
  }, [refresh]);

  const selected = reviews.find(row => row.id === selectedId);
  const baseline = reviews.find(row => row.id === compareId);
  const activeMarker = draft?.markers?.find(row => row.id === activeMarkerId);
  const currentSamples = [...samplesRef.current.values()].sort((a, b) => a.time - b.time);
  const report = draft?.comparison && baseline
    ? comparisonReport(currentSamples, baseline.samples || [], draft.comparison, draft.sport) : null;

  useEffect(() => {
    setDraft(selected ? {
      title: selected.title || '',
      sport: selected.sport || 'swimming',
      skill: selected.skill || 'general',
      coach_summary: selected.coach_summary || '',
      parent_summary: selected.parent_summary || '',
      markers: (selected.markers || []).map(marker => ({ ...marker })),
      comparison: selected.comparison || null,
    } : null);
    samplesRef.current = new Map((selected?.samples || []).map(sample => [Math.round(sample.time * 4), sample]));
    setSampleCount(samplesRef.current.size);
    setCompareId(selected?.comparison?.baseline_review_id || '');
    setOverlayComparison(false);
    setChartMetric(selected?.sport === 'football' ? 'knee_angle' : 'elbow_angle');
    setActiveMarkerId('');
    setDirty(false);
    setDrawing(false);
    setSourceUrl('');
    setPoseInfo(null);
    setPoseEnabled(false);
    setCorrectionMode(false);
    setPoseError('');
    targetRef.current = null;
    candidatesRef.current = [];
    targetMissesRef.current = 0;
    setTargetStatus('select');
    if (!selectedId) return;
    let active = true;
    if (selected?.video_mode === 'local') {
      setSourceUrl(localVideosRef.current.get(selectedId) || '');
    } else {
      reviewAPI.playTicket(selectedId).then(response => {
        if (active) setSourceUrl(response.data.url);
      }).catch(error => { if (active) toast.error(errorText(error)); });
    }
    return () => { active = false; };
  }, [selectedId]); // Review changes are applied locally until saved.

  useEffect(() => {
    setCompareUrl('');
    if (!compareId || compareId === selectedId) return;
    let active = true;
    if (reviews.find(row => row.id === compareId)?.video_mode === 'local') {
      setCompareUrl(localVideosRef.current.get(compareId) || '');
    } else {
      reviewAPI.playTicket(compareId).then(response => {
        if (active) setCompareUrl(response.data.url);
      }).catch(error => { if (active) toast.error(errorText(error)); });
    }
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
        const elapsed = Math.abs(video.currentTime - lastTargetTimeRef.current) * 1000;
        const ambiguous = ambiguousPose(targetRef.current, boxes, elapsed);
        selectedIndex = ambiguous ? null : matchPose(targetRef.current, boxes, elapsed);
        if (ambiguous) {
          targetRef.current = null;
          targetMissesRef.current = 0;
          setTargetStatus('lost');
        } else if (selectedIndex === null) {
          targetMissesRef.current += 1;
          if (Math.abs(video.currentTime - lastTargetTimeRef.current) > OCCLUSION_GRACE_SECONDS) {
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
      const rawPoints = selectedIndex === null ? null : poses[selectedIndex];
      selectedPointsRef.current = rawPoints;
      selectedIndexRef.current = selectedIndex;
      boxesRef.current = boxes;
      const marker = video.paused && draft.markers.find(row => row.id === activeMarkerId && Math.abs(row.time - video.currentTime) < 0.15);
      const points = marker ? applyPoseCorrections(rawPoints, marker.corrected_points) : rawPoints;
      drawPose(poseCanvasRef.current, video, points, boxes, selectedIndex,
        marker ? Object.keys(marker.corrected_points || {}).map(Number) : []);
      const seen = points?.filter(point => (point.visibility ?? 1) >= 0.5).length || 0;
      const metrics = seen >= 8 ? poseMetrics(points, draft.sport, poseSide, video.videoWidth / video.videoHeight) : null;
      const result = { metrics, seen, time: video.currentTime, detected: boxes.filter(Boolean).length, selected: selectedIndex !== null };
      if (canEdit && selected?.status === 'draft' && Number.isFinite(video.currentTime)) {
        const bucket = Math.round(video.currentTime * 4);
        if (bucket >= 0 && bucket <= 36000 * 4 && samplesRef.current.size < 3000) {
          const primary = draft.sport === 'football' ? ['knee_angle', 'hip_angle'] : ['elbow_angle', 'hip_angle'];
          const quality = selectedIndex === null ? 'lost'
            : primary.every(key => Number.isFinite(metrics?.[key])) ? 'valid' : 'unreliable';
          const sample = { time: Math.round(video.currentTime * 4) / 4, quality, seen, source: marker?.corrected_points && Object.keys(marker.corrected_points).length ? 'coach' : 'ai',
            metrics: Object.fromEntries(Object.entries(metrics || {}).filter(([, value]) => Number.isFinite(value))) };
          const previous = samplesRef.current.get(bucket);
          if ((!previous || previous.quality !== sample.quality || previous.seen !== sample.seen) && previous?.source !== 'coach') {
            samplesRef.current.set(bucket, sample);
            setSampleCount(samplesRef.current.size);
            setDirty(true);
          }
        }
      }
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
      setCorrectionMode(false);
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
    const rawPoints = poses[index];
    selectedPointsRef.current = rawPoints;
    selectedIndexRef.current = index;
    boxesRef.current = boxes;
    const marker = activeMarker && Math.abs(activeMarker.time - videoRef.current.currentTime) < 0.15 ? activeMarker : null;
    const points = marker ? applyPoseCorrections(rawPoints, marker.corrected_points) : rawPoints;
    drawPose(poseCanvasRef.current, videoRef.current, points, boxes, index,
      marker ? Object.keys(marker.corrected_points || {}).map(Number) : []);
    const seen = points.filter(point => (point.visibility ?? 1) >= 0.5).length;
    setPoseInfo({ metrics: seen >= 8 ? poseMetrics(points, draft.sport, poseSide, videoRef.current.videoWidth / videoRef.current.videoHeight) : null,
      seen, detected: boxes.filter(Boolean).length, selected: true, time: videoRef.current.currentTime });
    if (videoRef.current.paused && !marker) videoRef.current.play().catch(() => {});
  };

  const resetPlayerOnSeek = () => {
    if (!poseEnabled) return;
    targetRef.current = null;
    targetMissesRef.current = 0;
    setTargetStatus('lost');
    setPoseInfo(null);
    selectedPointsRef.current = null;
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
      const response = await reviewAPI.upload(member.id, file, uploadSport, uploadSkill);
      await refresh();
      setSelectedId(response.data.id);
      toast.success(ar ? 'تم رفع الفيديو كمسودة خاصة' : 'Video uploaded as a private draft');
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setUploading(false);
    }
  };

  const openLocal = async (event, reviewId = '') => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!(guestMode ? file.type.startsWith('video/') : file.name.toLowerCase().endsWith('.mp4') && (!file.type || file.type === 'video/mp4'))) {
      toast.error(guestMode ? (ar ? 'اختر ملف فيديو يمكن للمتصفح تشغيله' : 'Choose a browser-playable video') : (ar ? 'اختر فيديو MP4 من جهازك' : 'Choose an MP4 video'));
      return;
    }
    if (reviewId) {
      const url = keepLocalVideo(reviewId, file);
      if (reviewId === selectedId) setSourceUrl(url);
      if (reviewId === compareId) setCompareUrl(url);
      return;
    }
    setUploading(true);
    try {
      const response = await reviewAPI.createLocal(member.id, {
        title: file.name.replace(/\.mp4$/i, '').slice(0, 120) || 'تحليل أداء',
        sport: uploadSport, skill: uploadSkill,
      });
      keepLocalVideo(response.data.id, file);
      await refresh();
      setSelectedId(response.data.id);
      toast.success(ar ? 'فُتح الفيديو على جهازك. احفظ التقرير بعد مراجعة القياسات.' : 'Video opened locally. Save the reviewed results.');
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setUploading(false);
    }
  };

  const addMarker = (label) => {
    if (!videoRef.current || !draft) return;
    videoRef.current.pause();
    const sample = poseEnabled ? analyzeFrame(true) : null;
    const marker = {
      id: `moment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, time: Number(videoRef.current.currentTime.toFixed(2)),
      label: label || (ar ? 'لقطة جديدة' : 'New moment'), note: '', share_with_parent: false, drawing: null,
      pose_metrics: Object.fromEntries(Object.entries(sample?.metrics || {}).filter(([, value]) => Number.isFinite(value))),
      pose_side: sample?.metrics ? poseSide : null,
      corrected_points: {},
    };
    change({ markers: [...draft.markers, marker].sort((a, b) => a.time - b.time) });
    setActiveMarkerId(marker.id);
    setCorrectionMode(false);
  };

  const correctionStart = event => {
    if (!activeMarker || !videoRef.current?.paused || !selectedPointsRef.current ||
        Math.abs(videoRef.current.currentTime - activeMarker.time) > 0.15) return;
    const position = videoPoint(event, videoRef.current, poseCanvasRef.current);
    const points = applyPoseCorrections(selectedPointsRef.current, activeMarker.corrected_points);
    const index = correctionJoint === 'auto' ? nearestEditableJoint(points, position, poseSide) : Number(correctionJoint);
    if (index === null) return;
    correctionJointRef.current = index;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const correctionMove = event => {
    const index = correctionJointRef.current;
    if (index === null || !activeMarker || !selectedPointsRef.current) return;
    const position = videoPoint(event, videoRef.current, poseCanvasRef.current);
    if (!position) return;
    const corrections = { ...(activeMarker.corrected_points || {}), [String(index)]: position };
    const points = applyPoseCorrections(selectedPointsRef.current, corrections);
    drawPose(poseCanvasRef.current, videoRef.current, points, boxesRef.current, selectedIndexRef.current,
      Object.keys(corrections).map(Number));
  };

  const correctionEnd = event => {
    const index = correctionJointRef.current;
    correctionJointRef.current = null;
    if (index === null || !activeMarker || !selectedPointsRef.current) return;
    const position = videoPoint(event, videoRef.current, poseCanvasRef.current);
    if (!position) return;
    const corrections = { ...(activeMarker.corrected_points || {}), [String(index)]: position };
    const points = applyPoseCorrections(selectedPointsRef.current, corrections);
    const metrics = poseMetrics(points, draft.sport, poseSide, videoRef.current.videoWidth / videoRef.current.videoHeight);
    const savedMetrics = Object.fromEntries(Object.entries(metrics || {}).filter(([, value]) => Number.isFinite(value)));
    updateMarker(activeMarker.id, { corrected_points: corrections, pose_metrics: savedMetrics, pose_side: poseSide });
    const bucket = Math.round(activeMarker.time * 4);
    samplesRef.current.set(bucket, { time: bucket / 4, quality: Object.keys(savedMetrics).length >= 2 ? 'valid' : 'unreliable',
      seen: points.filter(point => (point?.visibility ?? 0) >= 0.5).length, metrics: savedMetrics, source: 'coach' });
    setSampleCount(samplesRef.current.size);
    setPoseInfo(current => current ? { ...current, metrics } : current);
    drawPose(poseCanvasRef.current, videoRef.current, points, boxesRef.current, selectedIndexRef.current,
      Object.keys(corrections).map(Number));
  };

  const save = async () => {
    if (!selected || !draft) return;
    setBusy(true);
    try {
      const response = await reviewAPI.update(selected.id, { ...draft, samples: [...samplesRef.current.values()].sort((a, b) => a.time - b.time) });
      setReviews(current => current.map(row => row.id === selected.id ? response.data : row));
      setDirty(false);
      toast.success(guestMode ? (ar ? 'حُفظت المسودة مؤقتًا في هذه الصفحة؛ نزّل التقرير قبل إغلاقها.' : 'Draft saved for this page session. Download before leaving.') : (ar ? 'تم حفظ تحليل المدرب' : 'Coach review saved'));
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const downloadGuestReport = () => {
    if (!guestMode || !draft) return;
    const lines = [ar ? 'تقرير تحليل أداء زائر' : 'Guest performance review',
      `${ar ? 'الاسم' : 'Name'}: ${guestName.trim() || (ar ? 'غير محدد' : 'Unnamed')}`,
      `${ar ? 'العنوان' : 'Title'}: ${draft.title}`,
      `${ar ? 'المهارة' : 'Skill'}: ${skillLabel(draft.skill)}`,
      `${ar ? 'ملاحظات المدرب' : 'Coach notes'}: ${draft.coach_summary || '—'}`,
      `${ar ? 'ملخص التقرير' : 'Report summary'}: ${draft.parent_summary || '—'}`, ''];
    for (const marker of draft.markers) {
      lines.push(`${timeLabel(marker.time)} · ${marker.label}`);
      if (marker.note) lines.push(marker.note);
      Object.entries(marker.pose_metrics || {}).filter(([, value]) => Number.isFinite(value))
        .forEach(([key, value]) => lines.push(`${metricLabel(key)}: ${value}°`));
      if (Object.keys(marker.corrected_points || {}).length) lines.push(ar ? 'مفاصل مصححة يدويًا' : 'Coach-corrected joints');
      lines.push('');
    }
    if (draft.comparison && baseline) {
      lines.push(ar ? 'مقارنة قبل/بعد' : 'Before/after comparison');
      lines.push(`${ar ? 'الفيديو السابق' : 'Baseline'}: ${baseline.title} (${timeLabel(draft.comparison.baseline_event_time)})`);
      lines.push(`${ar ? 'الفيديو الحالي' : 'Current'}: ${draft.title} (${timeLabel(draft.comparison.current_event_time)})`);
      if (report?.usable) Object.entries(report.deltas).forEach(([key, value]) => lines.push(`${metricLabel(key)}: ${value > 0 ? '+' : ''}${value}°`));
      else lines.push(ar ? 'القياسات غير كافية لمقارنة رقمية موثوقة.' : 'Not enough reliable samples for numeric comparison.');
      lines.push(`${ar ? 'استنتاج المدرب' : 'Coach finding'}: ${draft.comparison.coach_finding || '—'}`);
      lines.push(`${ar ? 'التمرين التالي' : 'Next exercise'}: ${draft.comparison.next_exercise || '—'}`, '');
    }
    lines.push(ar ? 'قياسات تقريبية من كاميرا واحدة؛ اختلاف الزوايا ليس حكمًا تلقائيًا بتحسن الأداء.' : 'Single-camera estimates; angle changes alone do not prove improvement.');
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'guest-performance-report.txt';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const setStatus = async (status) => {
    if (!selected || dirty) return;
    setBusy(true);
    try {
      const response = await reviewAPI.setStatus(selected.id, status);
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
      await reviewAPI.delete(selected.id);
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

  const syncComparison = (jumpToEvent = false) => {
    const current = videoRef.current;
    const before = comparisonRef.current;
    const comparison = draft?.comparison;
    if (!current || !before || !comparison || !Number.isFinite(before.duration)) return;
    if (jumpToEvent) current.currentTime = comparison.current_event_time;
    const desired = Math.max(0, Math.min(before.duration,
      comparison.baseline_event_time + current.currentTime - comparison.current_event_time));
    if (jumpToEvent || Math.abs(before.currentTime - desired) > 0.25) before.currentTime = desired;
    if (current.paused) before.pause();
  };

  const updateComparison = patch => {
    if (!draft?.comparison) return;
    change({ comparison: { ...draft.comparison, ...patch } });
  };

  const pointInOverlay = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
             y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
  };

  return <div className="space-y-4" dir={ar ? 'rtl' : 'ltr'}>
    <div className="rounded-xl border bg-blue-50 p-4 text-sm text-blue-900">
      <strong>{ar ? 'استوديو تحليل الأداء' : 'Performance review studio'}</strong>
      <p className="mt-1">{guestMode ? (ar ? 'نفس أدوات تحليل العضو، لكن دون عضوية أو رفع فيديو. تبقى المسودة في الصفحة الحالية فقط؛ نزّل التقرير قبل إغلاقها.' : 'The same analysis tools without membership or upload. The draft lasts only for this page session; download before leaving.') : (ar ? 'افتح الفيديو محليًا للتحليل داخل المتصفح؛ يُحفظ التقرير فقط. الفيديوهات المرفوعة سابقًا تظل متاحة. لا يرى ولي الأمر سوى التقرير بعد اعتماده.' : 'Analyze video locally in the browser and save only the report. Existing uploaded videos remain available. Parents see approved reports only.')}</p>
    </div>
    {guestMode && <label className="block max-w-lg text-sm">{ar ? 'اسم الزائر (اختياري)' : 'Guest name (optional)'}<Input value={guestName} onChange={event => setGuestName(event.target.value)} className="mt-1" maxLength={120} /></label>}
    <div className="flex flex-wrap items-center gap-2">
      {canEdit && <select aria-label={ar ? 'رياضة الفيديو الجديد' : 'Sport for new video'} value={uploadSport} onChange={event => { const sport = event.target.value; setUploadSport(sport); setUploadSkill(SKILLS[sport][0][0]); }} className="rounded-md border bg-white p-2 text-sm">
        <option value="swimming">{ar ? 'سباحة' : 'Swimming'}</option>
        <option value="football">{ar ? 'كرة قدم' : 'Football'}</option>
      </select>}
      {canEdit && <select aria-label={ar ? 'مهارة الفيديو الجديد' : 'Skill for new video'} value={uploadSkill} onChange={event => setUploadSkill(event.target.value)} className="rounded-md border bg-white p-2 text-sm">
        {SKILLS[uploadSport].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>}
      {canEdit && <label className="inline-flex cursor-pointer items-center rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white">
        {uploading ? (ar ? 'جارٍ إنشاء التقرير...' : 'Creating report...') : (ar ? 'فتح فيديو محلي وتحليل الأداء' : 'Open local video and analyze')}
        <input type="file" accept={guestMode ? 'video/*' : 'video/mp4,.mp4'} className="hidden" disabled={uploading} onChange={openLocal} />
      </label>}
      {canEdit && !guestMode && <details className="text-xs text-slate-600"><summary className="cursor-pointer">{ar ? 'خيار رفع الفيديو ومشاركته' : 'Option to upload and share video'}</summary><label className="mt-2 inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm">
        {uploading ? (ar ? 'جارٍ الرفع...' : 'Uploading...') : (ar ? 'رفع فيديو MP4 للخادم' : 'Upload MP4 to server')}
        <input type="file" accept="video/mp4,.mp4" className="hidden" disabled={uploading} onChange={upload} />
      </label></details>}
      <select aria-label={ar ? 'الفيديو الحالي' : 'Current video'} value={selectedId} onChange={event => setSelectedId(event.target.value)} className="min-w-[220px] rounded-md border bg-white p-2 text-sm">
        <option value="">{ar ? 'اختر فيديو' : 'Choose video'}</option>
        {reviews.map(row => <option key={row.id} value={row.id}>{row.title} · {row.sport === 'football' ? (ar ? 'قدم' : 'Football') : (ar ? 'سباحة' : 'Swimming')} · {guestMode ? (ar ? 'محلي' : 'Local') : row.status === 'approved' ? (ar ? 'معتمد' : 'Approved') : (ar ? 'مسودة' : 'Draft')}</option>)}
      </select>
      {selected && <select aria-label={ar ? 'فيديو المقارنة' : 'Comparison video'} value={compareId} disabled={!canEdit || selected.status !== 'draft'} onChange={event => {
        const id = event.target.value;
        setCompareId(id);
        change({ comparison: id ? {
          baseline_review_id: id, current_event_time: 0, baseline_event_time: 0,
          coach_finding: '', next_exercise: '', share_with_parent: false,
        } : null });
      }} className="min-w-[220px] rounded-md border bg-white p-2 text-sm">
        <option value="">{ar ? 'مقارنة مع فيديو سابق' : 'Compare with another video'}</option>
        {reviews.filter(row => row.id !== selectedId && row.sport === draft?.sport && (row.skill || 'general') === draft?.skill)
          .map(row => <option key={row.id} value={row.id}>{row.title} · {row.created_at?.slice(0, 10)}</option>)}
      </select>}
    </div>
    {!selected && <p className="rounded-lg border p-8 text-center text-muted-foreground">{guestMode ? (ar ? 'افتح فيديو الزائر من جهازك لبدء التحليل.' : 'Open a guest video from your device to begin.') : (ar ? 'لا توجد تقارير أداء لهذا العضو بعد.' : 'No performance reports yet.')}</p>}
    {selected && draft && <>
      {selected.video_mode === 'local' && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        {guestMode ? (ar ? 'الفيديو والمسودة على جهازك في هذه الصفحة فقط. نزّل التقرير قبل إغلاقها.' : 'The video and draft stay in this page only. Download the report before leaving.') : (ar ? 'الفيديو على جهازك فقط ولا يُحفظ في النظام. بعد إغلاق الصفحة، أعد اختيار نفس الفيديو لمراجعة التوقيت واللقطات؛ التقرير والقياسات المحفوظة ستبقى.' : 'The video stays on your device. Reopen the same file to revisit moments; saved results remain.')}
        <label className="ms-3 inline-flex cursor-pointer rounded-md border border-amber-400 bg-white px-3 py-1">
          {ar ? (sourceUrl ? 'تغيير الفيديو المحلي' : 'فتح الفيديو المحلي لهذا التقرير') : (sourceUrl ? 'Change local video' : 'Open local video for this report')}
        <input type="file" accept={guestMode ? 'video/*' : 'video/mp4,.mp4'} className="hidden" onChange={event => openLocal(event, selected.id)} />
        </label>
      </div>}
      {compareId && compareUrl && <div className="flex flex-wrap items-center gap-3 rounded-lg border p-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={overlayComparison} onChange={event => setOverlayComparison(event.target.checked)} />{ar ? 'تراكب فيديو قبل/بعد' : 'Overlay before/after videos'}</label>
        {overlayComparison && <label className="flex items-center gap-2">{ar ? 'شفافية فيديو قبل' : 'Baseline opacity'}<input type="range" min="0.2" max="0.8" step="0.1" value={overlayOpacity} onChange={event => setOverlayOpacity(Number(event.target.value))} /></label>}
        {overlayComparison && <Button type="button" variant="outline" size="sm" onClick={() => syncComparison(true)}>{ar ? 'زامن لحظة الحركة' : 'Sync movement event'}</Button>}
        {overlayComparison && <span className="text-xs text-amber-700">{ar ? 'المقارنة البصرية أنسب عند تشابه زاوية التصوير وحجم اللاعب.' : 'Overlay works best with matching camera angles and athlete scale.'}</span>}
      </div>}
      <div className={`grid gap-3 ${compareId && !overlayComparison ? 'lg:grid-cols-2' : ''}`}>
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-lg bg-black">
            {sourceUrl && <video ref={videoRef} src={sourceUrl} controls playsInline preload="metadata" className="aspect-video w-full object-contain"
              onPlay={() => { if (comparisonRef.current && draft?.comparison) { comparisonRef.current.playbackRate = videoRef.current.playbackRate; syncComparison(); comparisonRef.current.play().catch(() => {}); } }}
              onPause={() => comparisonRef.current?.pause()}
              onTimeUpdate={() => { if (poseEnabled) analyzeFrame(); if (draft?.comparison) syncComparison(); }} onSeeked={resetPlayerOnSeek} />}
            {overlayComparison && compareUrl && <video ref={comparisonRef} src={compareUrl} playsInline muted preload="metadata" aria-label={ar ? 'فيديو قبل متراكب' : 'Overlaid baseline video'}
              className="pointer-events-none absolute inset-0 h-full w-full object-contain" style={{ opacity: overlayOpacity }} />}
            <canvas ref={poseCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
            {poseEnabled && !drawing && !correctionMode && <div className="absolute inset-x-0 top-0 bottom-12 cursor-crosshair" onClick={selectPlayer} role="button" tabIndex={0}
              aria-label={ar ? 'اضغط على إطار اللاعب لاختياره' : 'Click a person box to select them'} />}
            {correctionMode && <div className="absolute inset-x-0 top-0 bottom-12 cursor-crosshair touch-none" role="button" tabIndex={0}
              aria-label={ar ? 'اسحب نقطة المفصل لتصحيح موضعها' : 'Drag a joint point to correct its position'}
              onPointerDown={correctionStart} onPointerMove={correctionMove} onPointerUp={correctionEnd}
              onPointerCancel={() => { correctionJointRef.current = null; }} />}
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
            {[0.25, 0.5, 1].map(rate => <Button type="button" key={rate} variant="outline" size="sm" onClick={() => { if (videoRef.current) videoRef.current.playbackRate = rate; if (comparisonRef.current) comparisonRef.current.playbackRate = rate; }}>{rate}×</Button>)}
            {canEdit && selected.status === 'draft' && <Button type="button" size="sm" onClick={() => addMarker()}>{ar ? 'حدد لقطة' : 'Mark moment'}</Button>}
            {canEdit && selected.status === 'draft' && activeMarker && poseEnabled && <Button type="button" variant={correctionMode ? 'default' : 'outline'} size="sm" disabled={!poseInfo?.selected && !correctionMode} onClick={() => {
              videoRef.current?.pause();
              setCorrectionMode(value => !value);
            }}>{correctionMode ? (ar ? 'إنهاء تصحيح المفاصل' : 'Finish joint correction') : (ar ? 'تصحيح مفصل يدويًا' : 'Correct a joint')}</Button>}
            {correctionMode && <select aria-label={ar ? 'المفصل المطلوب تصحيحه' : 'Joint to correct'} value={correctionJoint} onChange={event => setCorrectionJoint(event.target.value)} className="rounded-md border bg-white px-2 py-1 text-xs">
              <option value="auto">{ar ? 'اختر أقرب نقطة' : 'Nearest joint'}</option>
              {(poseSide === 'left' ? [11, 13, 15, 23, 25, 27] : [12, 14, 16, 24, 26, 28]).map((index, position) => <option key={index} value={index}>{JOINT_LABELS[position]}</option>)}
            </select>}
          </div>
          {canEdit && selected.status === 'draft' && sourceUrl && <div className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
            <span>{ar ? 'علّم لحظة:' : 'Tag moment:'}</span>
            {(MOMENT_LABELS[draft.skill] || MOMENT_LABELS.general).map(label => <Button type="button" key={label} variant="outline" size="sm" onClick={() => addMarker(label)}>{label}</Button>)}
          </div>}
          <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={togglePose} disabled={poseLoading || !sourceUrl}>
                {poseLoading ? (ar ? 'تحميل نموذج الحركة…' : 'Loading pose model…') : poseEnabled ? (ar ? 'إيقاف تتبّع المفاصل' : 'Stop pose tracking') : (ar ? 'تشغيل تحليل الحركة AI' : 'Start AI pose tracking')}
              </Button>
              <select aria-label={ar ? 'جانب الجسم للتحليل' : 'Body side to analyze'} value={poseSide} onChange={event => { setPoseSide(event.target.value); setPoseInfo(null); setCorrectionJoint('auto'); }} className="rounded-md border bg-white p-2">
                <option value="right">{ar ? 'الجانب الأيمن' : 'Right side'}</option><option value="left">{ar ? 'الجانب الأيسر' : 'Left side'}</option>
              </select>
              <span className="font-semibold">{draft.sport === 'football' ? (ar ? 'كرة قدم' : 'Football') : (ar ? 'سباحة' : 'Swimming')}</span>
            </div>
            {poseError && <p className="text-red-700" role="alert">{poseError}</p>}
            {poseEnabled && <p>{targetStatus === 'lost' ? (ar ? 'تداخل اللاعب مع شخص آخر أو فُقد مساره؛ توقفت القياسات. أوقف الفيديو وحدده مجددًا.' : 'Player overlap or lost track; measurements paused. Pause and reselect.') : targetStatus === 'searching' ? (ar ? 'اللاعب محجوب مؤقتًا؛ القياسات متوقفة حتى يظهر بوضوح.' : 'Player temporarily obscured; measurements paused.') : !poseInfo?.selected ? (ar ? `اختر اللاعب بالضغط على إطاره في الفيديو. الأشخاص المكتشفون: ${poseInfo?.detected || 0}` : `Click the player's box. Detected people: ${poseInfo?.detected || 0}`) : poseInfo.seen >= 8 ? (ar ? `تتبّع اللاعب المحدد · نقاط ظاهرة: ${poseInfo.seen} من 33` : `Tracking selected player · ${poseInfo.seen} visible landmarks`) : (ar ? 'اللاعب المحدد غير واضح بما يكفي؛ لن تُعرض قياسات غير موثوقة.' : 'Selected player visibility is too low; no measurements shown.')}</p>}
            {correctionMode && <p className="rounded-md bg-blue-100 p-2 text-blue-900">{ar ? 'أوقف الفيديو على اللقطة المحددة، ثم اسحب النقطة البرتقالية للمفصل إلى مكانها الصحيح. تظهر النقطة المصححة بالأزرق. احفظ التقرير بعد المراجعة.' : 'Pause on the marked moment, then drag the joint point. Corrected points appear blue. Save after review.'}</p>}
            {poseEnabled && poseInfo?.selected && poseInfo?.seen >= 8 && <div className="flex flex-wrap gap-2">
              {Object.entries(poseInfo.metrics || {}).map(([key, value]) => Number.isFinite(value) && <span key={key} className="rounded-md bg-white px-2 py-1">
                {key === 'knee_angle' ? (ar ? 'زاوية الركبة' : 'Knee angle') : key === 'elbow_angle' ? (ar ? 'زاوية المرفق' : 'Elbow angle') : key === 'hip_angle' ? (ar ? 'زاوية الورك' : 'Hip angle') : (ar ? 'ميل الجذع عن العمودي' : 'Trunk tilt from vertical')}: {value}°
              </span>)}
            </div>}
            <p className="text-xs text-slate-600">{ar ? 'قياسات تقريبية من زاوية التصوير الحالية. يراجعها المدرب قبل حفظ اللقطة أو مشاركتها، وقد تخطئ عند حجب الجسم أو تحت الماء.' : 'Approximate single-view measurements. The coach reviews each moment before sharing; occlusion and underwater footage reduce reliability.'}</p>
          </div>
        </div>
        {compareId && !overlayComparison && <div className="space-y-2">
          {baseline?.video_mode === 'local' && !compareUrl && <label className="inline-flex cursor-pointer rounded-md border px-3 py-2 text-sm">{ar ? 'افتح فيديو «قبل» من جهازك' : 'Open baseline video locally'}<input type="file" accept={guestMode ? 'video/*' : 'video/mp4,.mp4'} className="hidden" onChange={event => openLocal(event, compareId)} /></label>}
          {compareUrl && <video ref={comparisonRef} src={compareUrl} controls playsInline muted preload="metadata" className="aspect-video w-full rounded-lg bg-black" />}
          <Button type="button" variant="outline" size="sm" onClick={() => syncComparison(true)}>{ar ? 'اذهب للحظة الحركة في الفيديوين' : 'Jump to matched event'}</Button>
        </div>}
      </div>
      <section className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{ar ? `تقرير ${skillLabel(draft.skill)} قبل / بعد` : `Before / after: ${skillLabel(draft.skill)}`}</h3>
          <span className="text-xs text-slate-600">{ar ? `عينات الحركة المحفوظة: ${sampleCount}` : `Recorded motion samples: ${sampleCount}`}</span>
        </div>
        <p className="text-xs text-slate-600">{ar ? 'اختر فيديوين لنفس العضو والرياضة والمهارة. شغّل تتبّع اللاعب في كل فيديو واحفظ العينات، ثم حدد لحظة الحركة نفسها في الاثنين.' : 'Compare the same member, sport, and skill. Track and save both videos, then mark the matching movement event.'}</p>
        {draft.comparison && baseline && <>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border bg-white p-3 text-sm">
              <strong>{ar ? 'قبل · الفيديو السابق' : 'Before · baseline'}</strong>
              <p className="text-xs text-slate-600">{baseline.title}</p>
              <p className="mt-1">{ar ? 'لحظة الحركة:' : 'Event:'} {timeLabel(draft.comparison.baseline_event_time)}</p>
              {canEdit && selected.status === 'draft' && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => updateComparison({ baseline_event_time: Number((comparisonRef.current?.currentTime || 0).toFixed(2)) })}>{ar ? 'احفظ هذه اللحظة من الفيديو السابق' : 'Mark baseline event'}</Button>}
              {canEdit && selected.status === 'draft' && baseline.markers?.length > 0 && <select aria-label={ar ? 'اختر لحظة من الفيديو السابق' : 'Choose baseline moment'} value={String(draft.comparison.baseline_event_time)} onChange={event => updateComparison({ baseline_event_time: Number(event.target.value) })} className="mt-2 w-full rounded-md border bg-white p-2 text-xs">
                {!baseline.markers.some(marker => Number(marker.time) === Number(draft.comparison.baseline_event_time)) && <option value={draft.comparison.baseline_event_time}>{ar ? 'الوقت الحالي' : 'Current time'}</option>}
                {baseline.markers.map(marker => <option key={marker.id} value={marker.time}>{marker.label} · {timeLabel(marker.time)}</option>)}
              </select>}
            </div>
            <div className="rounded-lg border bg-white p-3 text-sm">
              <strong>{ar ? 'بعد · الفيديو الحالي' : 'After · current'}</strong>
              <p className="text-xs text-slate-600">{selected.title}</p>
              <p className="mt-1">{ar ? 'لحظة الحركة:' : 'Event:'} {timeLabel(draft.comparison.current_event_time)}</p>
              {canEdit && selected.status === 'draft' && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => updateComparison({ current_event_time: Number((videoRef.current?.currentTime || 0).toFixed(2)) })}>{ar ? 'احفظ هذه اللحظة من الفيديو الحالي' : 'Mark current event'}</Button>}
              {canEdit && selected.status === 'draft' && draft.markers.length > 0 && <select aria-label={ar ? 'اختر لحظة من الفيديو الحالي' : 'Choose current moment'} value={String(draft.comparison.current_event_time)} onChange={event => updateComparison({ current_event_time: Number(event.target.value) })} className="mt-2 w-full rounded-md border bg-white p-2 text-xs">
                {!draft.markers.some(marker => Number(marker.time) === Number(draft.comparison.current_event_time)) && <option value={draft.comparison.current_event_time}>{ar ? 'الوقت الحالي' : 'Current time'}</option>}
                {draft.markers.map(marker => <option key={marker.id} value={marker.time}>{marker.label} · {timeLabel(marker.time)}</option>)}
              </select>}
            </div>
          </div>
          {report && <>
            <div className="grid gap-2 sm:grid-cols-2 text-sm">
              <div className={`rounded-lg border p-3 ${report.before.usable ? 'bg-emerald-50' : 'bg-amber-50'}`}>{ar ? 'وضوح التتبّع قبل' : 'Baseline tracking coverage'}: {Math.round(report.before.coverage * 100)}% · {report.before.validSamples} {ar ? 'عينات صالحة' : 'valid samples'}</div>
              <div className={`rounded-lg border p-3 ${report.after.usable ? 'bg-emerald-50' : 'bg-amber-50'}`}>{ar ? 'وضوح التتبّع بعد' : 'Current tracking coverage'}: {Math.round(report.after.coverage * 100)}% · {report.after.validSamples} {ar ? 'عينات صالحة' : 'valid samples'}</div>
            </div>
            {!report.usable && <p className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900">{ar ? (guestMode ? 'المقارنة الرقمية تحتاج إلى تتبّع واضح في الفيديوين حول لحظة الحركة. لن نملأ الفجوات بقيم تخمينية.' : 'المقارنة الرقمية غير صالحة للمشاركة: يحتاج كل فيديو إلى تتبّع واضح حول لحظة الحركة. لن نملأ الفجوات بقيم تخمينية.') : 'Not enough reliable tracking around both events. Missing values are not estimated.'}</p>}
            <div className="overflow-x-auto rounded-lg border bg-white">
              <table className="w-full text-sm"><thead><tr className="bg-slate-50"><th className="p-2 text-start">{ar ? 'القياس' : 'Metric'}</th><th className="p-2">{ar ? 'قبل' : 'Before'}</th><th className="p-2">{ar ? 'بعد' : 'After'}</th><th className="p-2">{ar ? 'الفرق' : 'Change'}</th></tr></thead><tbody>
                {(draft.sport === 'football' ? ['knee_angle', 'hip_angle', 'body_tilt'] : ['elbow_angle', 'hip_angle', 'body_tilt']).map(key => <tr key={key} className="border-t"><td className="p-2">{metricLabel(key)}</td><td className="p-2 text-center">{report.before.values[key] == null ? '—' : `${report.before.values[key]}°`}</td><td className="p-2 text-center">{report.after.values[key] == null ? '—' : `${report.after.values[key]}°`}</td><td className="p-2 text-center">{report.deltas[key] == null ? '—' : `${report.deltas[key] > 0 ? '+' : ''}${report.deltas[key]}°`}</td></tr>)}
              </tbody></table>
            </div>
            <select aria-label={ar ? 'زاوية الرسم البياني' : 'Chart metric'} value={chartMetric} onChange={event => setChartMetric(event.target.value)} className="rounded-md border bg-white p-2 text-sm">
              {(draft.sport === 'football' ? ['knee_angle', 'hip_angle', 'body_tilt'] : ['elbow_angle', 'hip_angle', 'body_tilt']).map(key => <option key={key} value={key}>{metricLabel(key)}</option>)}
            </select>
            <ComparisonChart beforeSamples={baseline.samples || []} afterSamples={currentSamples} beforeAnchor={draft.comparison.baseline_event_time} afterAnchor={draft.comparison.current_event_time} metric={chartMetric} />
          </>}
          <label className="block text-sm font-medium">{ar ? 'استنتاج المدرب من المقارنة' : 'Coach comparison finding'}</label>
          <Textarea value={draft.comparison.coach_finding} disabled={!canEdit || selected.status !== 'draft'} maxLength={1000} onChange={event => updateComparison({ coach_finding: event.target.value })} placeholder={ar ? 'ما تغيّر في الحركة؟ لا تصف فرق الزاوية تلقائيًا بأنه تحسن.' : 'What changed in the movement?'} />
          <label className="block text-sm font-medium">{ar ? 'التمرين التالي المقترح' : 'Next training exercise'}</label>
          <Textarea value={draft.comparison.next_exercise} disabled={!canEdit || selected.status !== 'draft'} maxLength={500} onChange={event => updateComparison({ next_exercise: event.target.value })} />
          <div className="rounded-lg border bg-white p-3 text-sm" aria-label={ar ? 'معاينة خلاصة التقرير' : 'Report summary preview'}>
            <strong>{ar ? `خلاصة ${skillLabel(draft.skill)}` : `${skillLabel(draft.skill)} summary`}</strong>
            <p className="mt-1 text-xs text-slate-600">{ar ? `قبل ${timeLabel(draft.comparison.baseline_event_time)} · بعد ${timeLabel(draft.comparison.current_event_time)} · ${report?.usable ? 'القياسات قابلة للمراجعة' : 'القياسات غير كافية للمقارنة'}` : `Before ${timeLabel(draft.comparison.baseline_event_time)} · after ${timeLabel(draft.comparison.current_event_time)} · ${report?.usable ? 'measurements reviewable' : 'insufficient measurements'}`}</p>
            <p className="mt-2"><strong>{ar ? 'استنتاج المدرب:' : 'Coach finding:'}</strong> {draft.comparison.coach_finding || '—'}</p>
            <p className="mt-1"><strong>{ar ? 'التمرين التالي:' : 'Next exercise:'}</strong> {draft.comparison.next_exercise || '—'}</p>
            <p className="mt-2 text-xs text-slate-600">{ar ? 'فرق الزوايا وصف للحركة، وليس حكمًا تلقائيًا بالتحسن. يعتمد المدرب الخلاصة بعد مراجعة الفيديو والقياسات.' : 'Angle changes describe motion, not automatic improvement. The coach approves the interpretation.'}</p>
          </div>
          {!guestMode && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.comparison.share_with_parent} disabled={!canEdit || selected.status !== 'draft' || !report?.usable || baseline.status !== 'approved'} onChange={event => updateComparison({ share_with_parent: event.target.checked })} />{ar ? 'أظهر المقارنة المعتمدة لولي الأمر' : 'Share approved comparison with parent'}</label>}
          {!guestMode && baseline.status !== 'approved' && <p className="text-xs text-amber-700">{ar ? 'اعتمد تقرير الفيديو السابق أولًا قبل مشاركة المقارنة.' : 'Approve the baseline report before sharing the comparison.'}</p>}
        </>}
      </section>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <div className="space-y-2 rounded-lg border p-3">
          <h3 className="font-semibold">{ar ? 'اللقطات المحددة' : 'Marked moments'}</h3>
          {draft.markers.length === 0 && <p className="text-sm text-muted-foreground">{ar ? 'أوقف الفيديو عند لحظة مهمة ثم اضغط «حدد لقطة».' : 'Pause at an important moment and mark it.'}</p>}
          {draft.markers.map(marker => <button type="button" key={marker.id} onClick={() => { setActiveMarkerId(marker.id); setCorrectionMode(false); seek(marker.time); }} className={`block w-full rounded-md border p-2 text-start text-sm ${activeMarkerId === marker.id ? 'border-blue-500 bg-blue-50' : ''}`}>
            <span className="font-mono" dir="ltr">{timeLabel(marker.time)}</span> · {marker.label}
            {!guestMode && marker.share_with_parent && <span className="ms-2 text-green-700">{ar ? 'للأهل' : 'Parent'}</span>}
          </button>)}
        </div>
        <div className="space-y-3 rounded-lg border p-3">
          {canEdit && selected.status === 'draft' && <select aria-label={ar ? 'رياضة التحليل' : 'Review sport'} value={draft.sport} onChange={event => {
            const sport = event.target.value;
            samplesRef.current = new Map(); setSampleCount(0); setCompareId('');
            setChartMetric(sport === 'football' ? 'knee_angle' : 'elbow_angle');
            change({ sport, skill: SKILLS[sport][0][0], comparison: null });
          }} className="w-full rounded-md border bg-white p-2 text-sm">
            <option value="swimming">{ar ? 'سباحة' : 'Swimming'}</option><option value="football">{ar ? 'كرة قدم' : 'Football'}</option>
          </select>}
          {canEdit && selected.status === 'draft' && <select aria-label={ar ? 'مهارة التحليل' : 'Review skill'} value={draft.skill} onChange={event => {
            setCompareId(''); change({ skill: event.target.value, comparison: null });
          }} className="w-full rounded-md border bg-white p-2 text-sm">
            <option value="general">{ar ? 'مهارة غير محددة' : 'Unspecified skill'}</option>
            {SKILLS[draft.sport].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>}
          <label className="block text-sm font-medium">{ar ? 'عنوان التحليل' : 'Review title'}</label>
          <Input value={draft.title} disabled={!canEdit || selected.status !== 'draft'} onChange={event => change({ title: event.target.value })} maxLength={120} />
          <label className="block text-sm font-medium">{ar ? 'ملاحظات خاصة للمدربين' : 'Private coach notes'}</label>
          <Textarea value={draft.coach_summary} disabled={!canEdit || selected.status !== 'draft'} onChange={event => change({ coach_summary: event.target.value })} maxLength={2000} />
          <label className="block text-sm font-medium">{guestMode ? (ar ? 'ملخص تقرير الزائر' : 'Guest report summary') : (ar ? 'ملخص سيظهر لولي الأمر بعد الاعتماد' : 'Parent summary after approval')}</label>
          <Textarea value={draft.parent_summary} disabled={!canEdit || selected.status !== 'draft'} onChange={event => change({ parent_summary: event.target.value })} maxLength={2000} />
          {activeMarker && <div className="space-y-2 rounded-md bg-slate-50 p-3">
            <strong className="text-sm">{ar ? 'تعليق على اللقطة' : 'Moment annotation'} · {timeLabel(activeMarker.time)}</strong>
            {Object.entries(activeMarker.pose_metrics || {}).length > 0 && <p className="text-xs text-emerald-800">{ar ? 'قياسات محفوظة للمراجعة: ' : 'Saved measurements: '}{Object.entries(activeMarker.pose_metrics).map(([key, value]) => `${key}: ${value}°`).join(' · ')}</p>}
            {Object.keys(activeMarker.corrected_points || {}).length > 0 && <p className="text-xs text-blue-800">{ar ? `صحّح المدرب ${Object.keys(activeMarker.corrected_points).length} من نقاط المفاصل يدويًا في هذه اللقطة.` : `${Object.keys(activeMarker.corrected_points).length} joint points corrected by coach in this moment.`}</p>}
            <Input value={activeMarker.label} disabled={!canEdit || selected.status !== 'draft'} maxLength={100} onChange={event => updateMarker(activeMarker.id, { label: event.target.value })} />
            <Textarea value={activeMarker.note} disabled={!canEdit || selected.status !== 'draft'} maxLength={1000} placeholder={ar ? 'ملاحظة على الأداء' : 'Performance note'} onChange={event => updateMarker(activeMarker.id, { note: event.target.value })} />
            {canEdit && selected.status === 'draft' && <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => { seek(activeMarker.time); setCorrectionMode(false); setDrawing(true); }}>{ar ? 'ارسم خطًا على اللقطة' : 'Draw a line'}</Button>
              {activeMarker.drawing && <Button type="button" variant="outline" size="sm" onClick={() => updateMarker(activeMarker.id, { drawing: null })}>{ar ? 'امسح الرسم' : 'Clear drawing'}</Button>}
              {Object.keys(activeMarker.corrected_points || {}).length > 0 && <Button type="button" variant="outline" size="sm" onClick={() => {
                updateMarker(activeMarker.id, { corrected_points: {}, pose_metrics: {} });
                samplesRef.current.delete(Math.round(activeMarker.time * 4));
                setSampleCount(samplesRef.current.size);
                setCorrectionMode(false);
              }}>{ar ? 'إلغاء التصحيحات اليدوية' : 'Clear manual corrections'}</Button>}
              {!guestMode && <label className="inline-flex items-center gap-1 text-sm"><input type="checkbox" checked={activeMarker.share_with_parent} onChange={event => updateMarker(activeMarker.id, { share_with_parent: event.target.checked })} />{ar ? 'أظهر هذه اللقطة لولي الأمر' : 'Share this moment with parent'}</label>}
              <Button type="button" variant="destructive" size="sm" onClick={() => { change({ markers: draft.markers.filter(row => row.id !== activeMarker.id) }); setActiveMarkerId(''); }}>{ar ? 'حذف اللقطة' : 'Remove moment'}</Button>
            </div>}
          </div>}
        </div>
      </div>
      {canEdit && <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        {selected.status === 'draft' && <Button type="button" onClick={save} disabled={busy || !dirty}>{guestMode ? (ar ? 'حفظ المسودة في الصفحة' : 'Save page draft') : (ar ? 'حفظ التحليل' : 'Save review')}</Button>}
        {guestMode && <Button type="button" variant="outline" onClick={downloadGuestReport}>{ar ? 'تنزيل تقرير الزائر' : 'Download guest report'}</Button>}
        {!guestMode && selected.status === 'draft' && <Button type="button" variant="outline" onClick={() => setStatus('approved')} disabled={busy || dirty || !draft.parent_summary.trim()}>{selected.video_mode === 'local' ? (ar ? 'اعتماد التقرير لولي الأمر' : 'Approve report for parent') : (ar ? 'اعتماد ومشاركة الفيديو مع ولي الأمر' : 'Approve and share video with parent')}</Button>}
        {selected.status === 'approved' && <Button type="button" variant="outline" onClick={() => setStatus('draft')} disabled={busy}>{ar ? 'إلغاء المشاركة وإعادة المسودة' : 'Unshare and return to draft'}</Button>}
        <Button type="button" variant="destructive" onClick={remove} disabled={busy}>{selected.video_mode === 'local' ? (ar ? 'حذف التقرير' : 'Delete report') : (ar ? 'حذف الفيديو' : 'Delete video')}</Button>
        {dirty && <span className="text-sm text-amber-700">{ar ? 'احفظ التعديلات قبل الاعتماد' : 'Save changes before approval'}</span>}
        {selected.status === 'draft' && <p className="w-full text-xs text-muted-foreground">{guestMode ? (ar ? 'نزّل التقرير قبل إغلاق الصفحة. لن يُرسل الفيديو أو التقرير إلى نظام الأعضاء.' : 'Download before leaving. Neither video nor report is sent to the member system.') : selected.video_mode === 'local' ? (ar ? 'الاعتماد يعرض الملخص والقياسات التي اخترت مشاركتها فقط؛ لا يُرسل الفيديو.' : 'Approval shares only the chosen summary and metrics, never the local video.') : (ar ? 'الاعتماد يتيح لولي الأمر مشاهدة الفيديو كاملًا واللقطات التي اخترت إظهارها فقط.' : 'Approval lets the parent view the full video and only the moments you marked for sharing.')}</p>}
      </div>}
    </>}
  </div>;
}
