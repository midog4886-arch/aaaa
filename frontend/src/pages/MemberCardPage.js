import React, { useState } from 'react';
import { Layout } from '../components/Layout';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { User, CreditCard, Phone, Download, Printer, CheckCircle, XCircle } from 'lucide-react';
import axios from 'axios';
import { getPrimaryColor } from '../services/branding';
import { getMemberQRValue } from '../utils/memberQR';

const API_URL = '';

const MemberCardPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPrintDialog, setShowPrintDialog] = useState(false);

  const searchMember = async () => {
    if (!searchQuery.trim()) return;
    
    setLoading(true);
    setError('');
    setMember(null);
    
    try {
      // Use public API (no auth required)
      const response = await axios.get(`${API_URL}/api/public/member-card/${encodeURIComponent(searchQuery.trim())}`);
      setMember(response.data);
    } catch (err) {
      if (err.response?.status === 404) {
        setError('لم يتم العثور على العضو');
      } else {
        setError('حدث خطأ في البحث');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    setShowPrintDialog(true);
  };

  const handleStickerPrint = () => {
    setShowPrintDialog(false);
    
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    const qrData = getQRData();
    const _brand = getPrimaryColor();
    const _headerBg = 'linear-gradient(135deg, #0369A1, #0EA5E9)';
    const _accent = _brand || '#F97316';
    
    const _allActs = member?.activities || [];
    const _today = new Date();
    const _parseEnd = (a) => {
      if (!a?.end_date) return 0;
      const t = new Date(a.end_date).getTime();
      return isNaN(t) ? 0 : t;
    };
    const _activeActs = _allActs.filter(a => a?.end_date && new Date(a.end_date) >= _today);
    const _pool = _activeActs.length ? _activeActs : _allActs;
    const latestActivity = [..._pool].sort((a, b) => _parseEnd(b) - _parseEnd(a))[0] || _allActs[0];
    const startDate = latestActivity?.start_date || '';
    const endDate = latestActivity?.end_date || '';
    const schedule = latestActivity?.schedule || '';
    
    // Get activities list
    const activitiesHtml = member?.activities?.map(act => `
      <div class="activity-item ${act.status === 'active' ? 'active' : 'expired'}">
        <div class="activity-name">${act.status === 'active' ? '✓' : '✗'} ${act.activity_name}</div>
        <div class="activity-status">${act.status === 'active' ? 'ساري' : 'منتهي'}</div>
      </div>
    `).join('') || '';
    
    // Print BOTH card and logo together
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>بطاقة العضوية - ${member?.member_code}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
            @page { size: A4; margin: 0mm; }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Tajawal', Arial, sans-serif; background: #f3f4f6; direction: rtl; }
            .screen-only { padding: 20px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }
            @media print { .screen-only { display: none !important; } .print-area { display: flex !important; position: absolute; top: 10mm; right: 10mm; gap: 5mm; } }
            @media screen { .print-area { display: none; } }
            .sticker-preview { display: flex; gap: 15px; justify-content: center; margin-bottom: 20px; }
            .card { width: 60mm; height: 95mm; background: white; border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; position: relative; }
            .accent-stripe { position: absolute; top: 0; bottom: 0; right: 0; width: 4mm; background: linear-gradient(180deg,#F97316,#EA580C,#B45309); z-index: 2; display: flex; align-items: center; justify-content: center; overflow: hidden; }
            .accent-stripe span { writing-mode: vertical-rl; transform: rotate(180deg); color: white; font-size: 6.5pt; font-weight: 900; letter-spacing: 1.5pt; text-transform: uppercase; white-space: nowrap; }
            .card-header { background: ${_headerBg}; padding: 2mm 2mm 2.5mm; display: flex; flex-direction: column; align-items: center; gap: 1mm; color: white; text-align: center; }
            .header-text h2 { font-size: 7.5pt; font-weight: 900; margin: 0; line-height: 1.2; }
            .header-text p { font-size: 5.5pt; font-weight: 800; opacity: 0.95; margin: 0.3mm 0 0; }
            .header-logo { width: 18mm; height: 18mm; border-radius: 50%; background: white; padding: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1.5px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
            .header-logo img { width: 140%; height: 140%; object-fit: cover; border-radius: 50%; }
            .card-body { padding: 2mm 5mm 1.5mm 2.5mm; display: flex; flex-direction: column; gap: 1.5mm; flex: 1; min-height: 0; }
            .info-section { text-align: right; overflow: hidden; flex: 1; min-height: 0; display: flex; flex-direction: column; }
            .qr-container { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; padding-top: 1mm; }
            .qr-section { width: 26mm; height: 26mm; background: white; border: 1px solid #eee; border-radius: 2mm; padding: 0.5mm; }
            .qr-section img { width: 100%; height: 100%; }
            .qr-dates { text-align: center; font-size: 6.5pt; color: #1f2937; margin-top: 0.8mm; line-height: 1.3; font-weight: 700; }
            .qr-dates span { display: block; }
            .qr-label { text-align: center; font-size: 6.5pt; color: ${_accent}; font-weight: 900; margin-top: 0.5mm; letter-spacing: 0.3mm; }
            .schedule-info { text-align: center; font-size: 5.5pt; color: ${_accent}; margin-top: 0.5mm; font-weight: 700; background: #FFF7ED; padding: 0.5mm 1mm; border-radius: 1.5mm; }
            .member-name { font-size: 10.5pt; font-weight: 900; color: #111827; margin: 0.3mm 0 1.2mm; line-height: 1.15; letter-spacing: -0.1pt; }
            .info-row { display: flex; align-items: center; gap: 1mm; margin-bottom: 0.5mm; font-size: 7pt; }
            .info-label { color: #6b7280; font-size: 6pt; font-weight: 600; }
            .member-code { color: ${_accent}; font-weight: 900; font-size: 9pt; }
            .activities { margin-top: 1mm; padding-top: 1mm; border-top: 1px dashed #e5e7eb; overflow: hidden; min-height: 0; flex-shrink: 1; }
            .activities-label { font-size: 6pt; color: #6b7280; font-weight: 700; margin-bottom: 0.4mm; }
            .activity-item { padding: 0.6mm 1mm; margin-bottom: 0.3mm; border-radius: 1mm; font-size: 6pt; }
            .activity-item.active { background: #D1FAE5; border-right: 2px solid #10B981; }
            .activity-item.expired { background: #FEE2E2; border-right: 2px solid #EF4444; }
            .activity-name { font-weight: 700; color: #1f2937; font-size: 6.5pt; }
            .activity-status { font-size: 5.5pt; font-weight: 700; }
            .activity-item.active .activity-status { color: #059669; }
            .activity-item.expired .activity-status { color: #DC2626; }
            .logo-card { width: 60mm; height: 95mm; background: linear-gradient(180deg,#FFFFFF,#FFF7ED); border-radius: 4mm; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 5mm 4mm; gap: 3mm; }
            .logo-card img { width: 95%; max-width: 95%; max-height: 78%; object-fit: contain; }
            .logo-card .contact-block { display: flex; flex-direction: column; gap: 1.5mm; align-items: center; width: 100%; }
            .logo-card .contact-row { font-size: 9pt; color: #111827; text-align: center; font-weight: 800; line-height: 1.3; direction: ltr; }
            .print-btn { margin-top: 20px; padding: 12px 30px; background: linear-gradient(135deg, #F97316, #EA580C); color: white; border: none; border-radius: 10px; cursor: pointer; font-family: 'Tajawal', Arial, sans-serif; font-size: 16px; font-weight: bold; }
            .position-labels { display: flex; gap: 15px; justify-content: center; margin-top: 10px; }
            .position-label { padding: 8px 16px; background: #FEF3C7; border-radius: 8px; color: #92400E; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="screen-only">
            <p style="font-size: 18px; margin-bottom: 20px;">📋 معاينة الطباعة - كرت العضوية + شعار الأكاديمية</p>
            <div class="sticker-preview">
              <!-- Member Card - Position 1 -->
              <div class="card">
                <div class="accent-stripe"><span>${(member?.activities && member.activities[0] && member.activities[0].activity_name) || 'GLOBAL CHAMPIONS'}</span></div>
                <div class="card-header">
                  <div class="header-logo"><img src="${window.location.origin}/images/academy-logo.png" alt="logo" /></div>
                  <div class="header-text"><h2>شركة اداء الابطال العالمية للرياضة</h2><p>Global Champions Sports Performance</p></div>
                </div>
                <div class="card-body">
                  <div class="info-section">
                    <div class="info-label">الاسم</div>
                    <div class="member-name">${(member?.name_ar || member?.name || '').split('+').map(n => n.trim()).filter(Boolean).join(' - ')}</div>
                    <div class="info-row"><span class="info-label">رقم العضوية:</span><span class="member-code">#${member?.member_code || ''}</span></div>
                    <div class="info-row"><span class="info-label">رقم الجوال:</span><span>${member?.phone || '-'}</span></div>
                    ${activitiesHtml ? `<div class="activities"><div class="activities-label">الأنشطة المسجلة</div>${activitiesHtml}</div>` : ''}
                  </div>
                  <div class="qr-container">
                    <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}" /></div>
                    <div class="qr-dates">
                      <span>من: ${startDate || '----'}</span>
                      <span>إلى: ${endDate || '----'}</span>
                    </div>
                    ${schedule ? `<div class="schedule-info">📅 ${schedule}</div>` : ''}
                  </div>
                </div>
              </div>
              <!-- Logo Card - Position 2 -->
              <div class="logo-card">
                <img src="${window.location.origin}/images/academy-logo.png" alt="شعار الأكاديمية" />
                <div class="contact-block">
                  <div class="contact-row">📞 0566238384</div>
                </div>
              </div>
            </div>
            <div class="position-labels">
              <div class="position-label">📍 خانة 1: كرت العضوية</div>
              <div class="position-label">📍 خانة 2: شعار الأكاديمية</div>
            </div>
            <p style="margin-top: 10px; color: #6b7280; font-size: 14px;">📐 حجم كل كرت: 6سم × 9.5سم (عمودي)</p>
            <button class="print-btn" onclick="window.print()">🖨️ طباعة الملصقات</button>
          </div>
          <div class="print-area">
            <!-- Member Card - Position 1 -->
            <div class="card">
              <div class="accent-stripe"><span>${(member?.activities && member.activities[0] && member.activities[0].activity_name) || 'GLOBAL CHAMPIONS'}</span></div>
              <div class="card-header">
                <div class="header-logo"><img src="${window.location.origin}/images/academy-logo.png" alt="logo" /></div>
                <div class="header-text"><h2>شركة اداء الابطال العالمية للرياضة</h2><p>Global Champions Sports Performance</p></div>
              </div>
              <div class="card-body">
                <div class="info-section">
                  <div class="info-label">الاسم</div>
                  <div class="member-name">${(member?.name_ar || member?.name || '').split('+').map(n => n.trim()).filter(Boolean).join(' - ')}</div>
                  <div class="info-row"><span class="info-label">رقم العضوية:</span><span class="member-code">#${member?.member_code || ''}</span></div>
                  <div class="info-row"><span class="info-label">رقم الجوال:</span><span>${member?.phone || '-'}</span></div>
                  ${activitiesHtml ? `<div class="activities"><div class="activities-label">الأنشطة المسجلة</div>${activitiesHtml}</div>` : ''}
                </div>
                <div class="qr-container">
                  <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}" /></div>
                  <div class="qr-dates">
                    <span>من: ${startDate || '----'}</span>
                    <span>إلى: ${endDate || '----'}</span>
                  </div>
                </div>
              </div>
            </div>
            <!-- Logo Card - Position 2 -->
            <div class="logo-card">
              <img src="${window.location.origin}/images/academy-logo.png" alt="شعار الأكاديمية" />
              <div class="contact-block">
                <div class="contact-row">📞 0566238384</div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleCD820Print = (mode = 'duplex') => {
    setShowPrintDialog(false);
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    const qrData = getQRData();
    const _brand = getPrimaryColor();
    const _headerBg = 'linear-gradient(135deg, #0369A1, #0EA5E9)';
    const _accent = _brand || '#F97316';
    const _allActs = member?.activities || [];
    const _today = new Date();
    const _parseEnd = (a) => {
      if (!a?.end_date) return 0;
      const t = new Date(a.end_date).getTime();
      return isNaN(t) ? 0 : t;
    };
    const _activeActs = _allActs.filter(a => a?.end_date && new Date(a.end_date) >= _today);
    const _pool = _activeActs.length ? _activeActs : _allActs;
    const latestActivity = [..._pool].sort((a, b) => _parseEnd(b) - _parseEnd(a))[0] || _allActs[0];
    const startDate = latestActivity?.start_date || '';
    const endDate = latestActivity?.end_date || '';
    const schedule = latestActivity?.schedule || '';
    const activitiesHtml = member?.activities?.map(act => `
      <div class="activity-item ${act.status === 'active' ? 'active' : 'expired'}">
        <div class="activity-name">${act.status === 'active' ? '✓' : '✗'} ${act.activity_name}</div>
      </div>
    `).join('') || '';

    const frontHtml = `
      <div class="cd-page">
        <div class="card">
          <div class="accent-stripe"><span>${(member?.activities && member.activities[0] && member.activities[0].activity_name) || 'GLOBAL CHAMPIONS'}</span></div>
          <div class="card-header">
            <div class="header-logo"><img src="${window.location.origin}/images/academy-logo.png" alt="logo" /></div>
            <div class="header-text"><h2>شركة اداء الابطال العالمية للرياضة</h2><p>Global Champions Sports Performance</p></div>
          </div>
          <div class="card-body">
            <div class="info-section">
              <div class="info-label">الاسم</div>
              <div class="member-name">${(member?.name_ar || member?.name || '').split('+').map(n => n.trim()).filter(Boolean).join(' - ')}</div>
              <div class="info-row"><span class="info-label">رقم العضوية:</span><span class="member-code">#${member?.member_code || ''}</span></div>
              <div class="info-row"><span class="info-label">رقم الجوال:</span><span>${member?.phone || '-'}</span></div>
              ${activitiesHtml ? `<div class="activities"><div class="activities-label">الأنشطة المسجلة</div>${activitiesHtml}</div>` : ''}
            </div>
            <div class="qr-container">
              <div class="qr-section"><img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}" /></div>
              <div class="qr-dates"><span>من: ${startDate || '----'}</span><span>إلى: ${endDate || '----'}</span></div>
              ${schedule ? `<div class="schedule-info">📅 ${schedule}</div>` : ''}
            </div>
          </div>
        </div>
      </div>`;
    const backHtml = `
      <div class="cd-page back">
        <div class="logo-card">
          <img src="${window.location.origin}/images/academy-logo.png" alt="شعار الأكاديمية" />
          <div class="contact-block">
            <div class="contact-row">📞 0566238384</div>
          </div>
        </div>
      </div>`;
    const pages = mode === 'duplex' ? frontHtml + backHtml : frontHtml;

    printWindow.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>CD820 - ${member?.member_code}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');
        @page { size: 54mm 85.6mm; margin: 0; }
        * { margin:0; padding:0; box-sizing:border-box; }
        html, body { width:54mm; }
        body { font-family:'Tajawal',Arial,sans-serif; background:#e5e7eb; direction:rtl; }
        .toolbar { padding:14px; text-align:center; background:white; border-bottom:1px solid #e5e7eb; position:sticky; top:0; }
        .toolbar button { padding:10px 24px; background:linear-gradient(135deg,#F97316,#EA580C); color:white; border:none; border-radius:8px; cursor:pointer; font-family:inherit; font-weight:700; font-size:15px; margin:0 4px; }
        .toolbar button.secondary { background:#374151; }
        .toolbar .meta { margin-top:6px; color:#374151; font-size:13px; }
        .toolbar .hint { margin-top:4px; color:#6b7280; font-size:11px; line-height:1.5; }
        .cd-page { width:54mm; height:85.6mm; background:white; margin:4mm auto; box-shadow:0 2px 8px rgba(0,0,0,0.15); overflow:hidden; page-break-after:always; }
        .cd-page:last-child { page-break-after:auto; }
        .card { width:54mm; height:85.6mm; display:flex; flex-direction:column; position:relative; }
        .accent-stripe { position:absolute; top:0; bottom:0; right:0; width:2.5mm; background:linear-gradient(180deg,#F97316,#EA580C,#B45309); z-index:2; }
        .card-header { background:${_headerBg}; padding:2mm 2mm 2.2mm; display:flex; flex-direction:column; align-items:center; gap:1mm; color:white; text-align:center; }
        .header-text h2 { font-size:7pt; font-weight:900; line-height:1.2; }
        .header-text p { font-size:5pt; font-weight:800; opacity:0.95; margin-top:0.2mm; }
        .header-logo { width:16mm; height:16mm; border-radius:50%; background:white; padding:0; display:flex; align-items:center; justify-content:center; overflow:hidden; border:1.5px solid white; box-shadow:0 1px 3px rgba(0,0,0,0.2); }
        .header-logo img { width:140%; height:140%; object-fit:cover; border-radius:50%; }
        .card-body { padding:2mm 5mm 1.5mm 2mm; display:flex; flex-direction:column; gap:1mm; flex:1; min-height:0; }
        .info-section { text-align:right; overflow:hidden; flex:1; min-height:0; display:flex; flex-direction:column; }
        .qr-container { display:flex; flex-direction:column; align-items:center; flex-shrink:0; padding-top:1mm; }
        .qr-section { width:24mm; height:24mm; background:white; border:1px solid #eee; border-radius:1.5mm; padding:0.4mm; }
        .qr-section img { width:100%; height:100%; }
        .qr-dates { text-align:center; font-size:6pt; color:#1f2937; margin-top:0.6mm; line-height:1.2; font-weight:700; }
        .qr-dates span { display:block; }
        .qr-label { text-align:center; font-size:6.5pt; color:${_accent}; font-weight:900; margin-top:0.4mm; letter-spacing:0.2mm; }
        .schedule-info { text-align:center; font-size:5pt; color:${_accent}; margin-top:0.4mm; font-weight:700; background:#FFF7ED; padding:0.3mm 0.8mm; border-radius:1.2mm; }
        .info-label { color:#6b7280; font-size:6.5pt; font-weight:600; }
        .member-name { font-size:10.5pt; font-weight:900; color:#111827; margin:0.3mm 0 1.2mm; line-height:1.1; letter-spacing:-0.1pt; }
        .info-row { display:flex; gap:1mm; font-size:7pt; font-weight:700; color:#111827; align-items:center; margin-bottom:0.4mm; }
        .member-code { color:${_accent}; font-weight:900; font-size:9pt; }
        .activities { margin-top:0.8mm; padding-top:0.8mm; border-top:1px dashed #e5e7eb; overflow:hidden; min-height:0; flex-shrink:1; }
        .activities-label { font-size:6.5pt; color:#6b7280; font-weight:700; margin-bottom:0.3mm; }
        .activity-item { padding:0.3mm 0.8mm; margin-bottom:0.2mm; border-radius:0.8mm; font-size:6.5pt; }
        .activity-item.active { background:transparent; border-right:2px solid #10B981; }
        .activity-item.expired { background:transparent; border-right:2px solid #EF4444; }
        .activity-name { font-weight:800; color:#111827; font-size:6.5pt; }
        .cd-page.back { transform:rotate(180deg); transform-origin:center center; }
        .accent-stripe { position:absolute; top:0; bottom:0; right:0; width:4mm; background:linear-gradient(180deg,#F97316,#EA580C,#B45309); z-index:2; display:flex; align-items:center; justify-content:center; overflow:hidden; }
        .accent-stripe span { writing-mode:vertical-rl; transform:rotate(180deg); color:white; font-size:6pt; font-weight:900; letter-spacing:1.2pt; text-transform:uppercase; white-space:nowrap; }
        .logo-card { width:54mm; height:85.6mm; background:linear-gradient(180deg,#FFFFFF,#FFF7ED); display:flex; flex-direction:column; align-items:center; justify-content:center; padding:4mm 3mm; gap:2.5mm; }
        .logo-card img { width:50mm; max-width:98%; max-height:75%; object-fit:contain; margin-bottom:0; }
        .logo-card .contact-block { display:flex; flex-direction:column; gap:1.3mm; align-items:center; width:100%; }
        .logo-card .contact-row { font-size:8pt; color:#111827; text-align:center; font-weight:800; line-height:1.3; direction:ltr; }
        @media print {
          .toolbar { display:none; }
          html, body { background:white; margin:0; padding:0; }
          .cd-page { margin:0; box-shadow:none; }
        }
      </style></head><body>
      <div class="toolbar">
        <button onclick="window.print()">🖨️ طباعة على Datacard CD820</button>
        <button class="secondary" onclick="window.close()">إغلاق</button>
        <div class="meta">عضو واحد — ${mode === 'duplex' ? '2 صفحة (وش + ظهر)' : 'صفحة 1 (وش فقط)'}</div>
        <div class="hint">
          إعدادات الطابعة:<br/>
          • Paper Size: CR-80 (54 × 85.6 mm)<br/>
          • Orientation: Portrait<br/>
          • Margins: None<br/>
          ${mode === 'duplex' ? '• Double-sided: ON (flip on long edge)<br/>' : ''}
          • Scale: 100%
        </div>
      </div>
      ${pages}
      </body></html>`);
    printWindow.document.close();
  };

  const handleDownload = () => {
    const svg = document.getElementById('member-qr-code');
    if (!svg) return;
    
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      
      const link = document.createElement('a');
      link.download = `member-${member.member_code}-qr.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  // Generate QR data - Just the member code number for easy scanning
  const getQRData = () => {
    if (!member) return '';
    return getMemberQRValue(member.member_code);
  };

  return (
    <Layout>
    <div className="bg-gradient-to-br from-orange-50 to-amber-50 p-4 md:p-8 min-h-[80vh]">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">🏆 بطاقة العضوية</h1>
          <p className="text-gray-600">شركة اداء الابطال العالمية للرياضة العالمية</p>
        </div>

        {/* Search */}
        <Card className="mb-6 shadow-lg">
          <CardContent className="p-6">
            <div className="flex gap-3">
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && searchMember()}
                placeholder="رقم العضوية أو رقم الجوال أو الاسم"
                className="text-lg"
                dir="auto"
              />
              <Button 
                onClick={searchMember} 
                disabled={loading}
                className="bg-orange-500 hover:bg-orange-600 px-6"
              >
                {loading ? '...' : 'بحث'}
              </Button>
            </div>
            {error && (
              <p className="text-red-500 mt-3 text-center">{error}</p>
            )}
          </CardContent>
        </Card>

        {/* Member Card */}
        {member && (
          <div className="space-y-4">
            {/* Print Position Dialog */}
            <Dialog open={showPrintDialog} onOpenChange={setShowPrintDialog}>
              <DialogContent className="max-w-lg" dir="rtl">
                <DialogHeader>
                  <DialogTitle className="text-center text-xl">🖨️ طباعة الملصقات</DialogTitle>
                </DialogHeader>
                <div className="py-4">
                  <p className="text-center text-gray-600 mb-2 font-bold">{(member?.name_ar || member?.name || '').split('+').map((n, i) => <span key={i}>{i > 0 && <br/>}{n.trim()}</span>)}</p>
                  <p className="text-center text-sm text-orange-600 mb-4 font-bold">#{member?.member_code}</p>
                  <p className="text-center text-sm text-gray-500 mb-4">سيتم طباعة كرت العضوية + شعار الأكاديمية معاً</p>
                  
                  {/* Preview Cards */}
                  <div className="bg-gray-100 p-4 rounded-lg">
                    <div className="flex gap-3 justify-center max-w-[360px] mx-auto">
                      {/* Preview Card 1 - Member Card */}
                      <div className="aspect-[9/6] w-[140px] bg-white border-2 border-orange-400 rounded-lg flex flex-col items-center justify-center gap-2 p-3">
                        <span className="text-3xl">📇</span>
                        <span className="text-sm font-bold text-gray-700">كرت العضوية</span>
                        <span className="text-xs text-orange-500">خانة 1</span>
                      </div>
                      
                      {/* Preview Card 2 - Academy Logo */}
                      <div className="aspect-[9/6] w-[140px] bg-white border-2 border-orange-400 rounded-lg flex flex-col items-center justify-center gap-2 p-3 overflow-hidden">
                        <img 
                          src="/images/academy-logo.png" 
                          alt="شعار الأكاديمية" 
                          className="w-14 h-14 object-contain"
                        />
                        <span className="text-sm font-bold text-gray-700">شعار الأكاديمية</span>
                        <span className="text-xs text-orange-500">خانة 2</span>
                      </div>
                    </div>
                    <p className="text-center text-xs text-gray-500 mt-3">
                      📐 حجم كل كرت: 6سم × 9.5سم (عمودي)
                    </p>
                  </div>
                  
                  <div className="mt-4 flex flex-col gap-2 items-center">
                    <Button
                      onClick={handleStickerPrint}
                      className="bg-orange-500 hover:bg-orange-600 text-white px-8 py-3 text-lg w-full max-w-sm"
                    >
                      <Printer className="w-5 h-5 ml-2" />
                      طباعة على ورق A4 (ملصقات)
                    </Button>
                    <div className="flex gap-2 w-full max-w-sm">
                      <Button
                        onClick={() => handleCD820Print('duplex')}
                        className="bg-blue-600 hover:bg-blue-700 text-white flex-1"
                        title="طباعة على Datacard CD820 — وش وظهر"
                      >
                        💳 CD820 وش وظهر
                      </Button>
                      <Button
                        onClick={() => handleCD820Print('single')}
                        variant="outline"
                        className="border-blue-600 text-blue-700 hover:bg-blue-50 flex-1"
                        title="طباعة وش فقط على CD820"
                      >
                        💳 CD820 وش فقط
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500 text-center mt-1">
                      مقاس CD820: 54 × 85.6 مم (CR-80) — عمودي
                    </p>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Printable Card */}
            <Card className="shadow-2xl overflow-hidden print:shadow-none" id="member-card">
              <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-4 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold">شركة اداء الابطال العالمية للرياضة</h2>
                    <p className="text-orange-100 text-sm">Global Champions Sports Performance</p>
                  </div>
                  <div className="text-4xl">🏆</div>
                </div>
              </div>
              
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row gap-6 items-center">
                  {/* QR Code with Dates and Schedule */}
                  <div className="flex flex-col items-center">
                    <div className="bg-white p-4 rounded-xl shadow-inner border-2 border-orange-100">
                      <QRCodeSVG
                        id="member-qr-code"
                        value={getQRData()}
                        size={180}
                        level="H"
                        includeMargin={true}
                        bgColor="#ffffff"
                        fgColor="#000000"
                      />
                    </div>
                    {/* Dates under QR */}
                    {(() => {
                      const all = member?.activities || [];
                      if (!all.length) return null;
                      const today = new Date();
                      const parseEnd = (a) => {
                        if (!a?.end_date) return 0;
                        const t = new Date(a.end_date).getTime();
                        return isNaN(t) ? 0 : t;
                      };
                      const actives = all.filter(a => a?.end_date && new Date(a.end_date) >= today);
                      const pool = actives.length ? actives : all;
                      const latest = [...pool].sort((a, b) => parseEnd(b) - parseEnd(a))[0] || all[0];
                      return (
                        <div className="mt-3 text-center">
                          <div className="text-lg font-bold text-gray-800">
                            <span>من: {latest.start_date || '----'}</span>
                            <span className="mx-2">|</span>
                            <span>إلى: {latest.end_date || '----'}</span>
                          </div>
                          {latest.schedule && (
                            <div className="mt-2 px-4 py-2 bg-orange-50 rounded-lg text-orange-600 font-semibold">
                              📅 {latest.schedule}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  
                  {/* Member Info */}
                  <div className="flex-1 space-y-4 text-right">
                    <div>
                      <p className="text-gray-500 text-sm">الاسم</p>
                      <p className="text-2xl font-bold text-gray-800">{(member.name_ar || member.name || '').split('+').map((n, i) => <span key={i}>{i > 0 && <br/>}{n.trim()}</span>)}</p>
                    </div>
                    
                    <div className="flex items-center gap-3 justify-end">
                      <div>
                        <p className="text-gray-500 text-sm">رقم العضوية</p>
                        <p className="text-xl font-bold text-orange-600">#{member.member_code}</p>
                      </div>
                      <CreditCard className="w-8 h-8 text-orange-400" />
                    </div>
                    
                    <div className="flex items-center gap-3 justify-end">
                      <div>
                        <p className="text-gray-500 text-sm">رقم الجوال</p>
                        <p className="text-lg font-medium text-gray-700" dir="ltr">{member.phone || '-'}</p>
                      </div>
                      <Phone className="w-6 h-6 text-gray-400" />
                    </div>

                    {/* Activities Status */}
                    {member.activities && member.activities.length > 0 && (
                      <div className="pt-3 border-t">
                        <p className="text-gray-500 text-sm mb-2">الأنشطة المسجلة</p>
                        <div className="flex flex-wrap gap-2 justify-end">
                          {member.activities.map((act, idx) => (
                            <span 
                              key={idx}
                              className={`px-3 py-1 rounded-full text-sm ${
                                act.status === 'active' 
                                  ? 'bg-green-100 text-green-700' 
                                  : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {act.status === 'active' ? <CheckCircle className="w-4 h-4 inline ml-1" /> : <XCircle className="w-4 h-4 inline ml-1" />}
                              {act.activity_name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Footer */}
                <div className="mt-6 pt-4 border-t border-dashed text-center text-gray-400 text-sm">
                  امسح الكود عند الدخول لتسجيل الحضور
                </div>
              </CardContent>
            </Card>

            <div className="text-center p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600 font-semibold text-sm">⚠️ في حال فقدان كرت العضوية، يتم إصدار كرت جديد برسوم 10 ر.س</p>
            </div>

            {/* Action Buttons - Hidden when printing */}
            <div className="flex gap-3 justify-center print:hidden">
              <Button onClick={handlePrint} variant="outline" className="gap-2">
                <Printer className="w-4 h-4" />
                طباعة البطاقة
              </Button>
              <Button onClick={handleDownload} variant="outline" className="gap-2">
                <Download className="w-4 h-4" />
                تحميل QR
              </Button>
            </div>
          </div>
        )}

        {/* Instructions */}
        {!member && !error && (
          <Card className="bg-white/50 border-dashed">
            <CardContent className="p-8 text-center text-gray-500">
              <User className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-lg mb-2">ابحث عن العضو لعرض بطاقته</p>
              <p className="text-sm">يمكنك البحث برقم العضوية أو رقم الجوال أو الاسم</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          @page {
            margin: 0;
            padding: 0;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
          }
          body * {
            visibility: hidden;
          }
          #member-card, #member-card * {
            visibility: visible;
          }
          #member-card {
            position: fixed !important;
            left: 50% !important;
            top: 0 !important;
            transform: translateX(-50%) !important;
            width: 400px !important;
            margin: 10px auto !important;
            padding-top: 10px !important;
          }
        }
      `}</style>
    </div>
    </Layout>
  );
};

export default MemberCardPage;
