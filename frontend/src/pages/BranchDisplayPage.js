/**
 * BranchDisplayPage — full-screen TV display (شاشة عرض للفرع).
 *
 * Meant to run on a wall-mounted TV at the branch: shows today's live
 * attendance stats, the levels board for the current day (current hour
 * highlighted), and a ticker of the latest check-ins. Auto-refreshes.
 * Rendered OUTSIDE the admin Layout (no sidebar) — dark, large typography.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { attendanceAPI, branchesAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { Users, UserCheck, Clock, Maximize2 } from 'lucide-react';

// Board (live cells + ticker) polls faster; the heavier today-summary is only
// needed for expected/absent counts and matches the backend's 60s SWR window.
const BOARD_REFRESH_MS = 20000;
const SUMMARY_REFRESH_MS = 60000;

const BranchDisplayPage = () => {
  const { selectedBranchId } = useAuth();
  const [summary, setSummary] = useState(null);
  const [board, setBoard] = useState(null);
  const [branchName, setBranchName] = useState('');
  const [now, setNow] = useState(new Date());
  const [error, setError] = useState(false);

  // Live clock
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const branchParams = useCallback(() => {
    const params = {};
    if (selectedBranchId && selectedBranchId !== 'all') params.branch_filter = selectedBranchId;
    return params;
  }, [selectedBranchId]);

  const loadBoard = useCallback(async () => {
    try {
      const res = await attendanceAPI.getLevelsBoard(branchParams());
      setBoard(res.data);
      setError(false);
    } catch (e) {
      setError(true);
    }
  }, [branchParams]);

  const loadSummary = useCallback(async () => {
    try {
      const res = await attendanceAPI.getTodaySummary(branchParams());
      setSummary(res.data);
    } catch (e) { /* counts keep last value; board error banner covers outages */ }
  }, [branchParams]);

  useEffect(() => {
    loadBoard();
    loadSummary();
    const idBoard = setInterval(loadBoard, BOARD_REFRESH_MS);
    const idSummary = setInterval(loadSummary, SUMMARY_REFRESH_MS);
    return () => { clearInterval(idBoard); clearInterval(idSummary); };
  }, [loadBoard, loadSummary]);

  useEffect(() => {
    if (!selectedBranchId || selectedBranchId === 'all') { setBranchName(''); return; }
    branchesAPI.getAll()
      .then(res => {
        const b = (res.data || []).find(x => x.id === selectedBranchId);
        setBranchName(b ? (b.name_ar || b.name || '') : '');
      })
      .catch(() => {});
  }, [selectedBranchId]);

  const goFullscreen = () => {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
  };

  // Latest check-ins (newest first) derived from the live board itself, so the
  // ticker updates on the fast board poll (photos come embedded in cells).
  const latest = useMemo(() => {
    if (!board) return [];
    const all = [];
    Object.values(board.hours || {}).forEach(cells => cells.forEach(c => all.push(...(c.members || []))));
    (board.no_hour || []).forEach(c => all.push(...(c.members || [])));
    all.push(...((board.unassigned && board.unassigned.members) || []));
    const seen = new Set();
    const uniq = all.filter(m => {
      const k = `${m.member_id}|${m.check_in_time || ''}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    uniq.sort((a, b) => (b.check_in_time || '').localeCompare(a.check_in_time || ''));
    return uniq.slice(0, 10);
  }, [board]);

  // Board hour keys are 12-hour values (1–12) — convert Riyadh 24h to match.
  const h24 = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', hour: 'numeric', hour12: false }).format(now), 10);
  const currentHour = h24 === 0 ? 12 : (h24 > 12 ? h24 - 12 : h24);

  const clock = new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' }).format(now);
  const dateStr = new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', weekday: 'long', day: 'numeric', month: 'long' }).format(now);

  const Stat = ({ label, value, color }) => (
    <div className="flex-1 rounded-2xl bg-gray-800/70 border border-gray-700 px-6 py-4 text-center">
      <p className={`text-5xl font-black leading-none ${color}`}>{value ?? '—'}</p>
      <p className="text-gray-400 text-lg mt-2 font-medium">{label}</p>
    </div>
  );

  const hourCells = (h) => (board?.hours?.[h] || []);

  return (
    <div dir="rtl" className="min-h-screen bg-gray-950 text-white flex flex-col" data-testid="branch-display-screen">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-gray-800 bg-gray-900/60">
        <div className="flex items-center gap-4">
          <img src="/images/academy-logo.png" alt="" className="h-14 w-auto" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          <div>
            <h1 className="text-2xl font-black">{branchName ? `فرع ${branchName}` : 'شاشة الفرع'}</h1>
            <p className="text-gray-400 text-sm">{dateStr}</p>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <span className="text-5xl font-black tabular-nums tracking-wide">{clock}</span>
          <button onClick={goFullscreen} className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300" title="ملء الشاشة">
            <Maximize2 className="w-6 h-6" />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/40 text-red-300 text-center py-2 text-sm">تعذر تحديث البيانات — ستُعاد المحاولة تلقائياً</div>
      )}

      {/* Stats */}
      <div className="flex gap-4 px-8 py-4">
        <Stat label="حضور اليوم" value={summary?.present_count} color="text-green-400" />
        <Stat label="المتوقعون اليوم" value={summary?.expected_count} color="text-blue-400" />
        <Stat label="لم يحضروا بعد" value={summary?.absent_count} color="text-amber-400" />
      </div>

      <div className="flex-1 flex gap-4 px-8 pb-6 min-h-0">
        {/* Levels board */}
        <div className="flex-1 overflow-y-auto space-y-5 pe-1">
          {(board?.hours_order || []).map(h => (
            <div key={h}>
              <div className={`flex items-center gap-2 mb-2 ${parseInt(h, 10) === currentHour ? 'text-green-400' : 'text-gray-400'}`}>
                <Clock className="w-5 h-5" />
                <span className="text-xl font-bold">{hourCells(h)[0]?.hour_label || `الساعة ${h}`}</span>
                {parseInt(h, 10) === currentHour && (
                  <span className="text-xs bg-green-500/20 text-green-300 px-2 py-0.5 rounded-full animate-pulse">الآن</span>
                )}
              </div>
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                {hourCells(h).map((cell, i) => (
                  <div key={i} className={`rounded-xl border p-3 ${parseInt(h, 10) === currentHour ? 'bg-green-900/15 border-green-700/60' : 'bg-gray-800/50 border-gray-700'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-lg truncate">{cell.title}</p>
                      <span className="shrink-0 inline-flex items-center gap-1 bg-gray-700 rounded-full px-2.5 py-0.5 text-sm font-bold">
                        <UserCheck className="w-4 h-4 text-green-400" />{cell.count}
                      </span>
                    </div>
                    {cell.coach_name && <p className="text-gray-400 text-sm mt-0.5">كابتن {cell.coach_name}</p>}
                    {(cell.members || []).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {cell.members.slice(0, 12).map((m, j) => (
                          m.member_photo
                            ? <img key={j} src={m.member_photo} alt="" title={m.member_name} className="w-9 h-9 rounded-full object-cover border border-gray-600" />
                            : <span key={j} title={m.member_name} className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold">{(m.member_name || '؟').trim().slice(0, 2)}</span>
                        ))}
                        {cell.members.length > 12 && (
                          <span className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold">+{cell.members.length - 12}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {board && !(board.hours_order || []).length && (
            <div className="text-center text-gray-500 py-16 text-xl">لا توجد مستويات مجدولة اليوم</div>
          )}
        </div>

        {/* Latest check-ins ticker */}
        <div className="w-80 shrink-0 rounded-2xl bg-gray-900/70 border border-gray-800 p-4 flex flex-col min-h-0">
          <div className="flex items-center gap-2 mb-3 text-green-400">
            <Users className="w-5 h-5" />
            <h2 className="text-lg font-bold">آخر تسجيلات الحضور</h2>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2">
            {latest.map((r, i) => (
              <div key={`${r.member_id}-${i}`} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${i === 0 ? 'bg-green-900/25 border border-green-700/50' : 'bg-gray-800/60'}`}>
                {r.member_photo
                  ? <img src={r.member_photo} alt="" className="w-11 h-11 rounded-full object-cover border border-gray-600" />
                  : <div className="w-11 h-11 rounded-full bg-gray-700 flex items-center justify-center font-bold">{(r.member_name || '؟').trim().slice(0, 2)}</div>}
                <div className="min-w-0 flex-1">
                  <p className="font-bold truncate">{r.member_name}</p>
                  <p className="text-gray-400 text-xs truncate">{r.activity_name}</p>
                </div>
                <span className="text-green-400 font-mono text-sm shrink-0">{r.check_in_time || ''}</span>
              </div>
            ))}
            {!latest.length && <p className="text-gray-500 text-center py-10">لا يوجد حضور بعد</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BranchDisplayPage;
