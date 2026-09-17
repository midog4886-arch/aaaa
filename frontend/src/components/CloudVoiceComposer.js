import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Send, Square, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';

const MAX_DURATION_SECONDS = 120;
const MAX_BYTES = 10 * 1024 * 1024;
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

const extensionForMime = mime => {
  if (mime.startsWith('audio/ogg')) return 'ogg';
  if (mime.startsWith('audio/mp4')) return 'm4a';
  return 'webm';
};

const errorText = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(item => item?.msg || String(item)).join(', ');
  if (typeof detail?.message === 'string') return detail.message;
  if (typeof error?.response?.data?.message === 'string') return error.response.data.message;
  return error?.message || fallback;
};

const isUncertainDeliveryError = error => {
  if (error?.definite === true) return false;
  const status = error?.response?.status;
  // A timeout or a non-HTTP failure can have reached the provider.  Do not
  // offer a resend for it, because that could duplicate a voice message.
  return !status || status === 408 || status === 429 || status >= 500;
};

/**
 * Browser-only cloud inbox voice recorder. The parent owns the server refresh,
 * while this component owns all short-lived microphone, timer, and Blob URL
 * resources so they cannot bleed into another conversation.
 */
export default function CloudVoiceComposer({
  conversationId,
  resourceScope = '',
  disabled = false,
  onBusyChange,
  onSend,
  t = (ar, en) => en || ar,
}) {
  const [phase, setPhase] = useState('idle');
  const [seconds, setSeconds] = useState(0);
  const [preview, setPreview] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const timerRef = useRef(null);
  const previewUrlRef = useRef('');
  const sessionRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const conversationRef = useRef(conversationId);
  const mountedRef = useRef(true);
  const onBusyChangeRef = useRef(onBusyChange);
  const sendInFlightRef = useRef(false);
  onBusyChangeRef.current = onBusyChange;

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks?.().forEach(track => track.stop());
    streamRef.current = null;
  }, []);

  const revokePreviewUrl = useCallback(() => {
    if (previewUrlRef.current && typeof URL !== 'undefined' && URL.revokeObjectURL) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    previewUrlRef.current = '';
  }, []);

  const discard = useCallback(() => {
    sessionRef.current += 1;
    sendInFlightRef.current = false;
    recordingStartedAtRef.current = 0;
    clearTimer();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder?.state === 'recording') recorder.stop();
    stopTracks();
    revokePreviewUrl();
    if (mountedRef.current) {
      setPhase('idle');
      setSeconds(0);
      setPreview(null);
      setPreviewUrl('');
      setError('');
    }
  }, [clearTimer, revokePreviewUrl, stopTracks]);

  useEffect(() => {
    conversationRef.current = conversationId;
    discard();
  }, [conversationId, resourceScope, discard]);

  useEffect(() => {
    onBusyChange?.(['requesting', 'recording', 'preview', 'sending', 'uncertain'].includes(phase));
  }, [onBusyChange, phase]);

  useEffect(() => () => {
    onBusyChangeRef.current?.(false);
  }, []);

  useEffect(() => {
    // React development Strict Mode replays effects. Restore this flag on each
    // mount pass so a legitimate permission response is not mistaken for an
    // unmounted component.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      discard();
    };
  }, [discard]);

  const selectedMimeType = () => {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
    return MIME_CANDIDATES.find(type => MediaRecorder.isTypeSupported(type)) || '';
  };

  const stopRecording = useCallback(() => {
    clearTimer();
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') recorder.stop();
  }, [clearTimer]);

  const startRecording = async () => {
    if (disabled || phase !== 'idle' || !conversationId) return;
    const mimeType = selectedMimeType();
    if (!mimeType || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      const message = t(
        'التسجيل الصوتي غير مدعوم في هذا المتصفح.',
        'Voice recording is not supported in this browser.',
      );
      setError(message);
      toast.error(message);
      return;
    }

    const session = ++sessionRef.current;
    const originConversationId = conversationId;
    setError('');
    setSeconds(0);
    setPhase('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Permission can resolve after navigation; these tracks must never attach
      // to the chat currently on screen in that case.
      if (
        session !== sessionRef.current
        || conversationRef.current !== originConversationId
        || !mountedRef.current
      ) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      const chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      recorder.ondataavailable = event => {
        if (session === sessionRef.current && event.data?.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (
          session !== sessionRef.current
          || conversationRef.current !== originConversationId
          || !mountedRef.current
        ) return;
        // Invalidate onstop before asking the recorder to stop, otherwise a
        // browser which emits both events could turn a failed recording into a
        // misleading preview.
        sessionRef.current += 1;
        recorderRef.current = null;
        recordingStartedAtRef.current = 0;
        clearTimer();
        stopTracks();
        if (recorder.state === 'recording') recorder.stop();
        const message = t('حدث خطأ أثناء التسجيل الصوتي.', 'An error occurred while recording.');
        setPhase('idle');
        setSeconds(0);
        setError(message);
        toast.error(message);
      };
      recorder.onstop = () => {
        if (
          session !== sessionRef.current
          || conversationRef.current !== originConversationId
          || !mountedRef.current
        ) return;
        recorderRef.current = null;
        recordingStartedAtRef.current = 0;
        clearTimer();
        stopTracks();
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
        if (!blob.size) {
          const message = t(
            'لم يتم التقاط صوت. تحقق من الميكروفون ثم حاول مجددًا.',
            'No audio was captured. Check the microphone and try again.',
          );
          setPhase('idle');
          setSeconds(0);
          setError(message);
          toast.error(message);
          return;
        }
        if (blob.size > MAX_BYTES) {
          setPhase('idle');
          setSeconds(0);
          setError(t(
            'حجم التسجيل تجاوز 10 ميجابايت. سجّل مقطعًا أقصر.',
            'Recording exceeds 10 MiB. Please record a shorter clip.',
          ));
          return;
        }
        revokePreviewUrl();
        const url = typeof URL !== 'undefined' && URL.createObjectURL
          ? URL.createObjectURL(blob)
          : '';
        previewUrlRef.current = url;
        const audio = typeof File !== 'undefined'
          ? new File(
            [blob],
            `voice-${Date.now()}.${extensionForMime(blob.type)}`,
            { type: blob.type },
          )
          : blob;
        setPreview(audio);
        setPreviewUrl(url);
        setPhase('preview');
      };
      recorder.start();
      recordingStartedAtRef.current = Date.now();
      setPhase('recording');
      timerRef.current = setInterval(() => {
        if (session !== sessionRef.current) return;
        const elapsed = Math.max(0, Math.min(
          MAX_DURATION_SECONDS,
          Math.floor((Date.now() - recordingStartedAtRef.current) / 1000),
        ));
        setSeconds(elapsed);
        if (elapsed >= MAX_DURATION_SECONDS) stopRecording();
      }, 1000);
    } catch (requestError) {
      if (session !== sessionRef.current || !mountedRef.current) return;
      stopTracks();
      const permissionDenied = ['NotAllowedError', 'SecurityError'].includes(requestError?.name);
      const message = permissionDenied
        ? t(
          'تم رفض إذن الميكروفون. اسمح بالوصول إلى الميكروفون ثم حاول مجددًا.',
          'Microphone permission was denied. Allow microphone access and try again.',
        )
        : errorText(requestError, t('تعذر بدء التسجيل الصوتي.', 'Could not start voice recording.'));
      setPhase('idle');
      setError(message);
      toast.error(message);
    }
  };

  const sendPreview = async () => {
    if (!preview || phase !== 'preview' || disabled || sendInFlightRef.current) return;
    const originConversationId = conversationId;
    const session = sessionRef.current;
    const formData = new FormData();
    formData.append('audio', preview);
    sendInFlightRef.current = true;
    setError('');
    setPhase('sending');
    try {
      await onSend(originConversationId, formData);
      if (
        session !== sessionRef.current
        || conversationRef.current !== originConversationId
        || !mountedRef.current
      ) return;
      discard();
    } catch (sendError) {
      if (
        session !== sessionRef.current
        || conversationRef.current !== originConversationId
        || !mountedRef.current
      ) return;
      const uncertain = isUncertainDeliveryError(sendError);
      if (!uncertain) sendInFlightRef.current = false;
      setPhase(uncertain ? 'uncertain' : 'preview');
      setError(uncertain
        ? t(
          'تعذر تأكيد التسليم. راجع المحادثة قبل الإرسال؛ لن نعيد إرسال هذا التسجيل تلقائيًا.',
          'Delivery could not be confirmed. Check the conversation before sending; this recording will not be resent automatically.',
        )
        : errorText(sendError, t('تعذر إرسال المقطع الصوتي.', 'Could not send voice message.')));
    }
  };

  if (!conversationId) return null;
  const isRecording = phase === 'recording';
  const isRequesting = phase === 'requesting';
  const unsupported = typeof MediaRecorder === 'undefined'
    || (typeof MediaRecorder.isTypeSupported === 'function' && !selectedMimeType());

  return (
    <div className="mb-3 rounded-lg border border-green-200 bg-green-50/60 p-3" data-testid="cloud-voice-composer">
      {preview && (
        <div className="mb-3">
          <audio controls src={previewUrl} className="w-full" data-testid="cloud-voice-preview">
            {t('المتصفح لا يدعم تشغيل الصوت.', 'Your browser does not support audio playback.')}
          </audio>
          <p className="mt-1 text-xs text-muted-foreground">
            <span data-testid="cloud-voice-timer">
              {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}
            </span>
            {' · '}{(preview.size / 1024 / 1024).toFixed(2)} MB
          </p>
        </div>
      )}
      {error && (
        <p className="mb-2 text-xs text-red-700" role="alert">{error}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {isRecording || isRequesting ? (
          <>
            {isRecording && (
              <>
                <span className="text-sm font-medium text-red-700" data-testid="cloud-voice-timer">
                  {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}
                </span>
                <Button type="button" onClick={stopRecording} data-testid="button-stop-cloud-voice">
                  <Square className="me-1 h-4 w-4" />
                  {t('إيقاف ومعاينة', 'Stop and preview')}
                </Button>
              </>
            )}
            {isRequesting && (
              <span className="text-sm text-muted-foreground">{t('جارٍ طلب إذن الميكروفون…', 'Requesting microphone permission…')}</span>
            )}
            <Button type="button" variant="outline" onClick={discard} data-testid="button-cancel-cloud-voice">
              <Trash2 className="me-1 h-4 w-4" />
              {t('إلغاء التسجيل', 'Cancel recording')}
            </Button>
          </>
        ) : preview ? (
          <>
            <Button
              type="button"
              onClick={sendPreview}
              disabled={disabled || phase === 'sending' || phase === 'uncertain'}
              className="gap-1 bg-green-600 hover:bg-green-700"
              data-testid="button-send-cloud-voice"
            >
              {phase === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {phase === 'sending' ? t('جاري الإرسال…', 'Sending…') : t('إرسال المقطع الصوتي', 'Send voice message')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={discard}
              disabled={phase === 'sending'}
              data-testid="button-discard-cloud-voice"
            >
              <Trash2 className="me-1 h-4 w-4" />
              {t('إلغاء', 'Discard')}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={startRecording}
            disabled={disabled || phase === 'requesting' || unsupported}
            className="gap-1"
            data-testid="button-record-cloud-voice"
          >
            {phase === 'requesting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            {t('تسجيل صوتي', 'Record voice')}
          </Button>
        )}
        {isRecording && <span className="text-xs text-muted-foreground">{t('الحد الأقصى 120 ثانية', 'Maximum 120 seconds')}</span>}
        {unsupported && (
          <span className="text-xs text-muted-foreground" role="status">
            {t('التسجيل الصوتي غير متاح في هذا المتصفح.', 'Voice recording is unavailable in this browser.')}
          </span>
        )}
      </div>
    </div>
  );
}