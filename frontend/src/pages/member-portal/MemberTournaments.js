import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Trophy, Calendar, MapPin, Activity, Loader2 } from 'lucide-react';
import MemberLayout, { memberAPI, getDarkMode, getLanguage } from './MemberLayout';

const MemberTournaments = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ tournaments: [], totals: {} });
  const darkMode = getDarkMode();
  const language = getLanguage();

  useEffect(() => {
    memberAPI.get('/api/member-portal/my-tournaments')
      .then(res => setData(res.data))
      .catch(() => setData({ tournaments: [], totals: {} }))
      .finally(() => setLoading(false));
  }, []);

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
                  const posLabel = (language === 'ar' ? tr.position_label_ar : tr.position_label_en)
                    || (language === 'ar' ? 'مشاركة' : 'Participation');
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
                        </div>
                        <div className={`px-3 py-2 rounded-lg border-2 text-center min-w-[110px] ${posBadge(tr.position)}`}>
                          <div className="text-2xl leading-none">{medalEmoji(tr.position)}</div>
                          <div className="text-xs font-semibold mt-1">{posLabel}</div>
                        </div>
                      </div>
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
