import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import axios from 'axios';
import {
  Camera, Check, X, User, Clock, Loader2,
  LogIn, LogOut, SwitchCamera, Phone,
} from 'lucide-react';

const extractCoachCode = (scannedData) => {
  if (!scannedData) return null;
  const raw = String(scannedData).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (parsed.employee_id) return String(parsed.employee_id);
      if (parsed.code) return String(parsed.code);
      if (parsed.id) return String(parsed.id);
    }
  } catch (e) {}
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const fromQuery = url.searchParams.get('employee_id')
        || url.searchParams.get('code')
        || url.searchParams.get('id');
      if (fromQuery) return fromQuery;
      const segs = url.pathname.split('/').filter(Boolean);
      const last = segs[segs.length - 1];
      if (last && /^[A-Za-z0-9_-]+$/.test(last)) return last;
    } catch (e) {}
    return null;
  }
  if (/^[A-Za-z0-9_-]+$/.test(raw)) return raw;
  return null;
};

const CoachCameraQRScanner = ({ open, onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  const scannerRef = useRef(null);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch (e) {}
      try { scannerRef.current.clear(); } catch (e) {}
      scannerRef.current = null;
    }
  }, []);

  const handleScanSuccess = useCallback(async (decodedText) => {
    if (processingRef.current) return;
    const code = extractCoachCode(decodedText);
    if (!code) return;
    processingRef.current = true;
    await stopScanner();
    if (!mountedRef.current) return;
    setLoading(true);
    try {
      const statusRes = await axios.get(`/api/coach-attendance/qr-status-by-code/${code}`);
      const coachInfo = statusRes.data || {};
      const checkRes = await axios.post(`/api/coach-attendance/qr-checkin-by-code/${code}`);
      const data = checkRes.data || {};
      if (!mountedRef.current) return;
      setResult({
        ok: true,
        action: data.action,
        coachName: data.coach_name || coachInfo.coach_name || coachInfo.name_ar || coachInfo.name,
        phone: coachInfo.coach_phone || coachInfo.phone,
        message: data.message,
        timestamp: data.timestamp || data.check_in_time || data.check_out_time,
      });
      if (data.action === 'checked_in') {
        toast.success(`✅ ${data.coach_name || 'المدرب'} — تم تسجيل الحضور`);
      } else if (data.action === 'checked_out') {
        toast.success(`✅ ${data.coach_name || 'المدرب'} — تم تسجيل الانصراف`);
      } else {
        toast.info(`${data.coach_name || 'المدرب'} — ${data.message || 'تم المسح'}`);
      }
      if (onSuccess) onSuccess(data);
    } catch (err) {
      if (!mountedRef.current) return;
      const detail = err?.response?.data?.detail;
      const msg = typeof detail === 'string'
        ? detail
        : (detail?.message || 'لم يتم التعرف على رمز المدرب');
      setResult({ ok: false, message: msg, code });
    } finally {
      if (mountedRef.current) setLoading(false);
      processingRef.current = false;
    }
  }, [stopScanner, onSuccess]);

  const startScanner = useCallback(async () => {
    if (!mountedRef.current) return;
    setResult(null);
    setLoading(false);
    processingRef.current = false;
    await stopScanner();
    await new Promise(r => setTimeout(r, 250));
    if (!mountedRef.current) return;
    const containerId = 'coach-camera-qr-reader';
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    try {
      const scanner = new Html5Qrcode(containerId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode },
        { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
        (decodedText) => { handleScanSuccess(decodedText); },
        () => {}
      );
    } catch (err) {
      console.error('Camera error:', err);
      if (mountedRef.current) {
        toast.error('لا يمكن فتح الكاميرا. تأكد من إعطاء الإذن.');
      }
    }
  }, [facingMode, handleScanSuccess, stopScanner]);

  useEffect(() => {
    if (!open) {
      stopScanner();
      setResult(null);
      processingRef.current = false;
      return undefined;
    }
    const t = setTimeout(() => { startScanner(); }, 350);
    return () => {
      clearTimeout(t);
      stopScanner();
    };
  }, [open, facingMode, startScanner, stopScanner]);

  const handleClose = useCallback(() => {
    stopScanner();
    setResult(null);
    processingRef.current = false;
    onClose && onClose();
  }, [stopScanner, onClose]);

  const handleSwitchCamera = useCallback(() => {
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
  }, []);

  const handleScanAgain = useCallback(() => {
    setResult(null);
    processingRef.current = false;
    startScanner();
  }, [startScanner]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-orange-500" />
            مسح كود المدرب بالكاميرا
          </DialogTitle>
        </DialogHeader>

        {!result && !loading && (
          <div className="space-y-3">
            <div
              id="coach-camera-qr-reader"
              style={{ width: '100%', minHeight: '300px', borderRadius: '12px', overflow: 'hidden' }}
            />
            <div className="flex justify-center gap-2">
              <Button variant="outline" size="sm" onClick={handleSwitchCamera}>
                <SwitchCamera className="w-4 h-4 me-2" />
                تبديل الكاميرا
              </Button>
            </div>
            <p className="text-center text-sm text-muted-foreground">
              وجّه الكاميرا نحو رمز QR في كارت المدرب لتسجيل الحضور/الانصراف
            </p>
          </div>
        )}

        {loading && (
          <div className="py-12 text-center">
            <Loader2 className="w-16 h-16 mx-auto animate-spin text-orange-500" />
            <p className="mt-4 text-lg text-gray-600">جاري التسجيل...</p>
          </div>
        )}

        {result && !result.ok && (
          <div className="py-8 text-center space-y-4">
            <div className="w-20 h-20 mx-auto rounded-full bg-red-100 flex items-center justify-center">
              <X className="w-10 h-10 text-red-500" />
            </div>
            <p className="text-xl font-bold text-red-600">{result.message}</p>
            {result.code && <p className="text-gray-500">#{result.code}</p>}
            <Button onClick={handleScanAgain} className="gap-2">
              <Camera className="w-4 h-4" />
              مسح مرة أخرى
            </Button>
          </div>
        )}

        {result && result.ok && (
          <div className="space-y-4">
            <div className="text-center border-b pb-4">
              <div className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center mb-3 ${
                result.action === 'checked_in'
                  ? 'bg-gradient-to-br from-green-500 to-emerald-500'
                  : result.action === 'checked_out'
                  ? 'bg-gradient-to-br from-blue-500 to-indigo-500'
                  : 'bg-gradient-to-br from-gray-400 to-gray-500'
              }`}>
                {result.action === 'checked_in' ? (
                  <LogIn className="w-10 h-10 text-white" />
                ) : result.action === 'checked_out' ? (
                  <LogOut className="w-10 h-10 text-white" />
                ) : (
                  <Check className="w-10 h-10 text-white" />
                )}
              </div>
              <h2 className="text-xl font-bold">{result.coachName || 'المدرب'}</h2>
              <div className="flex items-center justify-center gap-3 mt-2 text-sm text-muted-foreground">
                <Badge variant="outline" className="gap-1">
                  <User className="w-3 h-3" />
                  {result.action === 'checked_in' ? 'حضور' : result.action === 'checked_out' ? 'انصراف' : 'مسح'}
                </Badge>
                {result.phone && (
                  <span className="flex items-center gap-1" dir="ltr">
                    <Phone className="w-3 h-3" />
                    {result.phone}
                  </span>
                )}
              </div>
            </div>

            <div className={`rounded-xl p-4 text-center ${
              result.action === 'checked_in'
                ? 'bg-green-50 border-2 border-green-300'
                : result.action === 'checked_out'
                ? 'bg-blue-50 border-2 border-blue-300'
                : 'bg-gray-50 border-2 border-gray-300'
            }`}>
              <p className="font-bold text-lg">
                {result.action === 'checked_in'
                  ? '✅ تم تسجيل الحضور'
                  : result.action === 'checked_out'
                  ? '✅ تم تسجيل الانصراف'
                  : (result.message || 'تم المسح')}
              </p>
              {result.timestamp && (
                <p className="text-xs text-gray-500 mt-2 flex items-center justify-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(result.timestamp).toLocaleString('ar-EG')}
                </p>
              )}
            </div>

            <Button onClick={handleScanAgain} variant="outline" className="w-full gap-2">
              <Camera className="w-4 h-4" />
              مسح مدرب آخر
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CoachCameraQRScanner;
