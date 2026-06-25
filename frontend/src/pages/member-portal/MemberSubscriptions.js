import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { CheckCircle, XCircle, Clock, Calendar, Loader2, ChevronLeft, Printer } from 'lucide-react';
import MemberLayout, { memberAPI, getDarkMode, getMemberData } from './MemberLayout';

const CoachCard = ({ name, photo, coachId, darkMode }) => {
  const [imgError, setImgError] = useState(false);
  const navigate = useNavigate();
  const initials = name
    ? name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('')
    : '?';

  const handleClick = () => {
    if (coachId) navigate(`/coach-profile/${coachId}`);
  };

  return (
    <div
      onClick={handleClick}
      className={`mt-4 pt-4 border-t flex items-center gap-3 ${coachId ? 'cursor-pointer' : ''} ${darkMode ? 'border-green-800' : 'border-green-200'}`}
    >
      {photo && !imgError ? (
        <img
          src={photo}
          alt={name}
          className="w-12 h-12 rounded-full object-cover border-2 border-green-400 flex-shrink-0"
          onError={() => setImgError(true)}
        />
      ) : (
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center text-base font-bold border-2 flex-shrink-0 ${
            darkMode ? 'bg-green-800 border-green-500 text-green-200' : 'bg-green-100 border-green-400 text-green-700'
          }`}
        >
          {initials}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium uppercase tracking-wide ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>المدرب المسؤول</p>
        <p className={`font-bold text-base ${darkMode ? 'text-green-300' : 'text-green-800'}`}>{name}</p>
      </div>
      {coachId && (
        <ChevronLeft className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
      )}
    </div>
  );
};

const MemberSubscriptions = () => {
  const [loading, setLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState({ active: [], expired: [] });
  const darkMode = getDarkMode();
  const navigate = useNavigate();

  useEffect(() => {
    fetchSubscriptions();
  }, []);

  const fetchSubscriptions = async () => {
    try {
      const res = await memberAPI.get('/api/member-portal/subscriptions');
      setSubscriptions(res.data);
    } catch (error) {
      console.error('Failed to fetch subscriptions');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    const printWindow = window.open('', '', 'width=900,height=700');
    if (!printWindow) return;

    const member = getMemberData() || {};
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const buildRows = (list, statusLabel, startIndex) => (list || []).map((sub, i) => `<tr>
      <td>${startIndex + i + 1}</td>
      <td>${esc(sub._owner_name) || esc(member.name_ar || member.name) || '-'}</td>
      <td>${esc(sub.activity_name)}</td>
      <td>${esc(sub.start_date) || '-'}</td>
      <td>${esc(sub.end_date) || '-'}</td>
      <td>${esc(sub.schedule) || '-'}</td>
      <td>${esc(sub.coach_name) || '-'}</td>
      <td>${statusLabel}</td>
    </tr>`).join('');

    const activeRows = buildRows(subscriptions.active, 'ساري', 0);
    const expiredRows = buildRows(subscriptions.expired, 'منتهي', subscriptions.active?.length || 0);
    const allRows = activeRows + expiredRows;
    const emptyRow = `<tr><td colspan="8" style="text-align:center;color:#888;padding:16px;">لا توجد اشتراكات</td></tr>`;
    const totalCount = (subscriptions.active?.length || 0) + (subscriptions.expired?.length || 0);

    printWindow.document.write(`<html><head><title>كشف اشتراكاتي</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap');
        body{font-family:'Tajawal',Arial;direction:rtl;padding:24px;color:#1f2937}
        h1{color:#2563eb;text-align:center;margin:0 0 4px;font-size:20px}
        .sub{text-align:center;color:#6b7280;font-size:13px;margin-bottom:18px}
        .info{display:flex;flex-wrap:wrap;gap:8px 24px;background:#f9fafb;border:1px solid #eee;border-radius:8px;padding:14px 18px;margin-bottom:18px;font-size:13px}
        .info div span{color:#6b7280}
        table{width:100%;border-collapse:collapse}
        th,td{border:1px solid #ddd;padding:9px;text-align:right;font-size:12px}
        th{background:#2563eb;color:white}
        tr:nth-child(even) td{background:#fafafa}
        .footer{text-align:center;margin-top:24px;font-size:11px;color:#888}
      </style></head><body>
      <h1>شركة اداء الابطال العالمية للرياضة</h1>
      <div class="sub">كشف اشتراكاتي</div>
      <div class="info">
        <div><span>الاسم:</span> ${esc(member.name_ar || member.name) || '-'}</div>
        <div><span>كود العضو:</span> ${esc(member.member_code) || '-'}</div>
        <div><span>الاشتراكات السارية:</span> ${subscriptions.active?.length || 0}</div>
        <div><span>الاشتراكات المنتهية:</span> ${subscriptions.expired?.length || 0}</div>
        <div><span>الإجمالي:</span> ${totalCount}</div>
      </div>
      <table>
        <thead><tr>
          <th>م</th><th>العضو</th><th>النشاط</th><th>تاريخ البداية</th><th>تاريخ النهاية</th>
          <th>الموعد</th><th>المدرب</th><th>الحالة</th>
        </tr></thead>
        <tbody>${allRows || emptyRow}</tbody>
      </table>
      <div class="footer">تاريخ الطباعة: ${new Date().toLocaleDateString('ar-SA')}</div>
      </body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 400);
  };

  if (loading) {
    return (
      <MemberLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </MemberLayout>
    );
  }

  return (
    <MemberLayout>
      <div className="space-y-6 page-enter">
        <div className="flex items-center justify-between gap-3">
          <h1 className={`text-xl sm:text-2xl font-bold ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>اشتراكاتي</h1>
          <button
            onClick={handlePrint}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${darkMode ? 'bg-blue-900/40 text-blue-300 hover:bg-blue-900/60' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}
          >
            <Printer className="w-4 h-4" />
            طباعة الكشف
          </button>
        </div>

        {/* Active Subscriptions */}
        <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
          <CardHeader>
            <CardTitle className={`text-lg flex items-center gap-2 ${darkMode ? 'text-green-400' : 'text-green-700'}`}>
              <CheckCircle className="w-5 h-5" />
              الاشتراكات السارية ({subscriptions.total_active})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {subscriptions.active.length > 0 ? (
              <div className="space-y-4">
                {subscriptions.active.map((sub, idx) => (
                  <div key={idx} className={`p-4 rounded-lg border-2 ${darkMode ? 'bg-green-900/20 border-green-700' : 'bg-green-50 border-green-200'}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        {sub._owner_name && (
                          <span className={`inline-flex items-center gap-1 mb-1 ps-0.5 pe-2 py-0.5 rounded-full text-xs font-bold ${darkMode ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>
                            {sub._owner_photo ? (
                              <img
                                src={sub._owner_photo}
                                alt={sub._owner_name}
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  if (e.currentTarget.nextSibling) e.currentTarget.nextSibling.style.display = 'inline';
                                }}
                                className="w-4 h-4 rounded-full object-cover"
                              />
                            ) : null}
                            <span aria-hidden style={{ display: sub._owner_photo ? 'none' : 'inline' }}>👤</span>
                            {sub._owner_name}
                          </span>
                        )}
                        <h3 className={`text-lg font-bold ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>{sub.activity_name}</h3>
                        <div className={`mt-2 space-y-1 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                          <p className="flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            من: {sub.start_date || '-'}
                          </p>
                          <p className="flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            إلى: {sub.end_date || '-'}
                          </p>
                          {sub.schedule && (
                            <p className={`mt-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>📅 {sub.schedule}</p>
                          )}
                        </div>
                        {/* Coach Card */}
                        {sub.coach_name && (
                          <CoachCard name={sub.coach_name} photo={sub.coach_photo} coachId={sub.coach_id} darkMode={darkMode} />
                        )}
                      </div>
                      <span className="px-4 py-2 bg-green-600 text-white rounded-full text-sm font-bold flex-shrink-0 mr-3">
                        ساري ✓
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={`text-center py-8 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                <CheckCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>لا توجد اشتراكات سارية</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Expired Subscriptions */}
        <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
          <CardHeader>
            <CardTitle className={`text-lg flex items-center gap-2 ${darkMode ? 'text-red-400' : 'text-red-700'}`}>
              <XCircle className="w-5 h-5" />
              الاشتراكات المنتهية ({subscriptions.total_expired})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {subscriptions.expired.length > 0 ? (
              <div className="space-y-4">
                {subscriptions.expired.map((sub, idx) => (
                  <div key={idx} className={`p-4 rounded-lg border-2 opacity-75 ${darkMode ? 'bg-red-900/20 border-red-700' : 'bg-red-50 border-red-200'}`}>
                    <div className="flex items-start justify-between">
                      <div>
                        {sub._owner_name && (
                          <span className={`inline-flex items-center gap-1 mb-1 ps-0.5 pe-2 py-0.5 rounded-full text-xs font-bold ${darkMode ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>
                            {sub._owner_photo ? (
                              <img
                                src={sub._owner_photo}
                                alt={sub._owner_name}
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  if (e.currentTarget.nextSibling) e.currentTarget.nextSibling.style.display = 'inline';
                                }}
                                className="w-4 h-4 rounded-full object-cover"
                              />
                            ) : null}
                            <span aria-hidden style={{ display: sub._owner_photo ? 'none' : 'inline' }}>👤</span>
                            {sub._owner_name}
                          </span>
                        )}
                        <h3 className={`text-lg font-bold ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>{sub.activity_name}</h3>
                        <div className={`mt-2 space-y-1 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                          <p className="flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            من: {sub.start_date || '-'}
                          </p>
                          <p className="flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            إلى: {sub.end_date || '-'}
                          </p>
                          {sub.coach_name && (
                            <p
                              onClick={() => sub.coach_id && navigate(`/coach-profile/${sub.coach_id}`)}
                              className={`mt-1 ${sub.coach_id ? 'cursor-pointer underline-offset-2 hover:underline' : ''} ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}
                            >
                              👨‍🏫 المدرب: {sub.coach_name}
                            </p>
                          )}
                        </div>
                      </div>
                      <span className="px-4 py-2 bg-red-600 text-white rounded-full text-sm font-bold">
                        منتهي ✗
                      </span>
                    </div>
                    <div className={`mt-3 pt-3 border-t ${darkMode ? 'border-red-700' : 'border-red-200'}`}>
                      <p className={`text-center font-medium ${darkMode ? 'text-red-400' : 'text-red-700'}`}>
                        ⚠️ يرجى التواصل للتجديد
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={`text-center py-8 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                <XCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>لا توجد اشتراكات منتهية</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MemberLayout>
  );
};

export default MemberSubscriptions;
