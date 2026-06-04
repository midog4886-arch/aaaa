import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { Layout } from '../components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { attendanceAPI } from '../services/api';
import { toast } from 'sonner';
import { RefreshCcw, Users, Clock, MapPin, UserCheck } from 'lucide-react';

const REFRESH_MS = 30000;

const LevelsBoardPage = () => {
  const { language } = useLanguage();
  const { selectedBranchId } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const ar = language === 'ar';

  const hourLabel = (h) => {
    const n = parseInt(h, 10);
    if (isNaN(n)) return '';
    return ar ? `الساعة ${n}` : `${n}:00`;
  };

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = selectedBranchId && selectedBranchId !== 'all' ? { branch_filter: selectedBranchId } : {};
      const res = await attendanceAPI.getLevelsBoard(params);
      setData(res.data);
      setLastUpdated(new Date());
    } catch (e) {
      if (!silent) toast.error(ar ? 'تعذر تحميل البيانات' : 'Failed to load data');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedBranchId, ar]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [selectedBranchId]);

  useEffect(() => {
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const MemberChip = ({ m }) => (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5">
      {m.member_photo
        ? <img src={m.member_photo} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
        : <div className="w-8 h-8 rounded-full bg-muted shrink-0 flex items-center justify-center text-muted-foreground"><Users className="w-4 h-4" /></div>}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{m.member_name || '—'}</div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-1">
          {m.check_in_time && <span className="font-mono">{m.check_in_time}</span>}
          {m.off_schedule && (
            <Badge variant="destructive" className="text-[9px] px-1 py-0">
              {ar ? 'خارج الجدول' : 'Off-schedule'}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );

  const LevelCell = ({ cell }) => (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-tight">{cell.title}</CardTitle>
          <Badge className="shrink-0 flex items-center gap-1">
            <UserCheck className="w-3 h-3" />{cell.count}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
          {cell.hour_label && (
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{ar ? cell.hour_label : hourLabel(cell.hour)}</span>
          )}
          {cell.coach_name && (
            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{ar ? `كابتن ${cell.coach_name}` : `Coach ${cell.coach_name}`}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 flex-1">
        {cell.members && cell.members.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {cell.members.map((m, i) => <MemberChip key={`${m.member_id}-${i}`} m={m} />)}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground py-3 text-center">
            {ar ? 'لا يوجد حضور' : 'No attendance'}
          </div>
        )}
      </CardContent>
    </Card>
  );

  const hasAnyCell =
    data && (
      (data.hours_order || []).some(h => (data.hours?.[h] || []).length > 0) ||
      (data.no_hour || []).length > 0 ||
      (data.unassigned?.members || []).length > 0
    );

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <MapPin className="w-6 h-6" />
              {ar ? 'خريطة المستويات' : 'Levels Map'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {ar
                ? 'بورد مباشر يوزّع الأعضاء على مستوياتهم أول ما يسجّلوا حضور النهارده'
                : "Live board placing members into their levels as they check in today"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {data && (
              <div className="text-right">
                <div className="text-sm font-semibold flex items-center gap-1 justify-end">
                  <Users className="w-4 h-4" />
                  {ar ? `الحاضرون: ${data.present_count}` : `Present: ${data.present_count}`}
                </div>
                {lastUpdated && (
                  <div className="text-[11px] text-muted-foreground">
                    {ar ? 'آخر تحديث' : 'Updated'} {lastUpdated.toLocaleTimeString()}
                  </div>
                )}
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="ml-1">{ar ? 'تحديث' : 'Refresh'}</span>
            </Button>
          </div>
        </div>

        {loading && !data ? (
          <div className="text-center py-12 text-muted-foreground">{ar ? 'جارٍ التحميل...' : 'Loading...'}</div>
        ) : !hasAnyCell ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {ar ? 'لا يوجد حضور مسجّل النهارده بعد' : 'No attendance recorded today yet'}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {(data.hours_order || []).map((h) => {
              const cells = data.hours?.[h] || [];
              if (!cells.length) return null;
              return (
                <div key={h} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-primary" />
                    <h2 className="text-lg font-bold">{ar ? `الساعة ${h}` : hourLabel(h)}</h2>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {cells.map((c) => <LevelCell key={c.level_id} cell={c} />)}
                  </div>
                </div>
              );
            })}

            {(data.no_hour || []).length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-muted-foreground" />
                  <h2 className="text-lg font-bold">{ar ? 'بدون ساعة محددة' : 'No set hour'}</h2>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {data.no_hour.map((c) => <LevelCell key={c.level_id} cell={c} />)}
                </div>
              </div>
            )}

            {(data.unassigned?.members || []).length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-amber-500" />
                  <h2 className="text-lg font-bold">
                    {ar ? `حضور بدون مستوى (${data.unassigned.count})` : `Present without level (${data.unassigned.count})`}
                  </h2>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <Card>
                  <CardContent className="pt-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                      {data.unassigned.members.map((m, i) => <MemberChip key={`${m.member_id}-${i}`} m={m} />)}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default LevelsBoardPage;
