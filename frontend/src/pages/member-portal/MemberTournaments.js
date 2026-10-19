import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Trophy, Calendar, MapPin, Activity, Loader2 } from 'lucide-react';
import MemberLayout, { memberAPI, getDarkMode, getLanguage } from './MemberLayout';

const MemberTournaments = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ tournaments: [], totals: {} });
  const [openTournaments, setOpenTournaments] = useState([]);
  const [subcategories, setSubcategories] = useState({});
  const [registering, setRegistering] = useState(false);
  const darkMode = getDarkMode();
  const language = getLanguage();

  useEffect(() => {
    memberAPI.get('/api/member-portal/my-tournaments')
      .then(res => setData(res.data))
      .catch(() => setData({ tournaments: [], totals: {} }))
      .finally(() => setLoading(false));
    memberAPI.get('/api/tournaments/member/open').then(res => setOpenTournaments(res.data || [])).catch(() => setOpenTournaments([]));
  }, []);

  const requestPlace = async (tournament, member) => {
    setRegistering(true);
    try {
      await memberAPI.post(`/api/tournaments/${tournament.id}/member/register`, { member_id: member.id, subcategory: subcategories[`${tournament.id}:${member.id}`] || null });
      toast.success('تم إرسال الطلب للمراجعة');
      const response = await memberAPI.get('/api/tournaments/member/open');
      setOpenTournaments(response.data || []);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'تعذر إرسال الطلب');
    } finally { setRegistering(false); }
  };

  if (loading) {
    return (
      <MemberLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
        </div>
      </MemberLayout>
    );
  }

  const tournaments = data.tournaments || [];
  const totals = data.totals || {};

  const posBadge = (pos) => {
    if (pos === '1') return 'bg-yellow-100 text-yellow-700 border-yellow-300';
    if (pos === '2') return 'bg-slate-100 text-slate-700 border-slate-300';
    if (pos === '3') return 'bg-amber-100 text-amber-800 border-amber-300';
    return darkMode ? 'bg-gray-600 text-gray-200 border-gray-500' : 'bg-gray-100 text-gray-600 border-gray-300';
  };

  const medalEmoji = (pos) => (pos === '1' ? '🥇' : pos === '2' ? '🥈' : pos === '3' ? '🥉' : '🎯');

  return (
    <MemberLayout>
      <div className="space-y-6 page-enter">
        <h1 className={`text-xl sm:text-2xl font-bold flex items-center gap-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
          <Trophy className="w-6 h-6 text-amber-500" />
          {language === 'ar' ? 'بطولاتي' : 'My Tournaments'}
        </h1>

        {openTournaments.length > 0 && <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}><CardHeader><CardTitle className="text-lg">التسجيل في البطولات المفتوحة</CardTitle></CardHeader><CardContent className="space-y-3">{openTournaments.map(tournament => <div key={tournament.id} className="border rounded-xl p-3 space-y-2"><strong>{tournament.name}</strong><p className="text-xs">{tournament.date} · {tournament.place}</p>{tournament.members.map(member => <div key={member.id} className="flex flex-wrap items-center gap-2 text-sm"><span>{member.name}</span>{member.status ? <span className="text-green-700">{({pending:'بانتظار المراجعة',waitlisted:'قائمة الانتظار',registered:'مسجل',approved:'مسجل',rejected:'مرفوض'})[member.status] || member.status}</span> : <>{tournament.subcategories.length > 0 && <select className="border rounded p-2" value={subcategories[`${tournament.id}:${member.id}`] || ''} onChange={e => setSubcategories({ ...subcategories, [`${tournament.id}:${member.id}`]: e.target.value })}><option value="">اختر التصنيف</option>{tournament.subcategories.map(s => <option key={s} value={s}>{s}</option>)}</select>}<button disabled={registering || (tournament.subcategories.length > 0 && !subcategories[`${tournament.id}:${member.id}`])} className="bg-orange-500 text-white rounded px-3 py-1 disabled:opacity-50" onClick={() => requestPlace(tournament, member)}>طلب التسجيل</button></>}</div>)}</div>)}</CardContent></Card>}

        {tournaments.length === 0 ? (
          <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
            <CardContent className={`text-center py-12 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>{language === 'ar' ? 'لم تشارك في أي بطولة بعد' : 'No tournament history yet'}</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Medal totals */}
            <div className="grid grid-cols-4 gap-2 sm:gap-3">
              {[
                { emoji: '🥇', count: totals.gold || 0, label_ar: 'ذهبية', label_en: 'Gold' },
                { emoji: '🥈', count: totals.silver || 0, label_ar: 'فضية', label_en: 'Silver' },
                { emoji: '🥉', count: totals.bronze || 0, label_ar: 'برونزية', label_en: 'Bronze' },
                { emoji: '🎯', count: totals.participations || 0, label_ar: 'مشاركة', label_en: 'Total' },
              ].map((s, i) => (
                <div key={i} className={`rounded-xl p-3 text-center border ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                  <div className="text-2xl sm:text-3xl leading-none">{s.emoji}</div>
                  <div className={`text-lg sm:text-xl font-black mt-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{s.count}</div>
                  <div className={`text-[10px] sm:text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {language === 'ar' ? s.label_ar : s.label_en}
                  </div>
                </div>
              ))}
            </div>

            {/* History list */}
            <Card className={darkMode ? 'bg-gray-800 border-gray-700' : ''}>
              <CardHeader>
                <CardTitle className={`text-lg flex items-center gap-2 ${darkMode ? 'text-gray-100' : 'text-gray-800'}`}>
                  <Trophy className="w-5 h-5 text-amber-500" />
                  {language === 'ar' ? 'سجل البطولات' : 'Tournament History'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {tournaments.map((tr, idx) => {
                  const posLabel = tr.results_approved === false
                    ? (language === 'ar' ? 'النتائج قيد المراجعة' : 'Results under review')
                    : ((language === 'ar' ? tr.position_label_ar : tr.position_label_en)
                      || (language === 'ar' ? 'مشاركة' : 'Participation'));
                  return (
                    <div
                      key={`${tr.tournament_id}-${idx}`}
                      className={`p-4 rounded-xl border-2 ${darkMode ? 'bg-gray-700/40 border-gray-600' : 'bg-stone-50 border-gray-200'}`}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex-1 min-w-[200px]">
                          <div className="flex items-center gap-2 mb-2">
                            <Trophy className="w-4 h-4 text-amber-500" />
                            <h4 className={`font-bold text-base ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                              {tr.tournament_name}
                            </h4>
                          </div>
                          <div className={`text-sm space-y-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                            {tr.date && (
                              <div className="flex items-center gap-2">
                                <Calendar className="w-3.5 h-3.5" />
                                {tr.date}
                              </div>
                            )}
                            {tr.place && (
                              <div className="flex items-center gap-2">
                                <MapPin className="w-3.5 h-3.5" />
                                {tr.place}
                              </div>
                            )}
                            {tr.level_label && (
                              <div className="flex items-center gap-2">
                                <Activity className="w-3.5 h-3.5" />
                                {tr.level_label}
                              </div>
                            )}
                            {tr.activity_name && (
                              <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                {tr.activity_name}
                              </div>
                            )}
                          </div>
                          {tr.member_id && <div className="mt-3 inline-flex flex-col items-center gap-1 rounded bg-white p-2 text-slate-700"><QRCodeSVG value={`TCI|${tr.tournament_id}|${tr.member_id}`} size={76} /><span className="text-[10px]">رمز حضور البطولة</span></div>}
                        </div>
                        <div className={`px-3 py-2 rounded-lg border-2 text-center min-w-[110px] ${posBadge(tr.position)}`}>
                          <div className="text-2xl leading-none">{medalEmoji(tr.position)}</div>
                          <div className="text-xs font-semibold mt-1">{posLabel}</div>
                        </div>
                      </div>
                      {tr.matches?.length > 0 && <div className="mt-3 border-t pt-3 space-y-1 text-xs"><strong>نتائج المباريات المعتمدة</strong>{tr.matches.filter(m => m.status === 'finished').map(m => <p key={m.id}>{m.team_a} {m.score_a} : {m.score_b} {m.team_b}</p>)}</div>}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </MemberLayout>
  );
};

export default MemberTournaments;
