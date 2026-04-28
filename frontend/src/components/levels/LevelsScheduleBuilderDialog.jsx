import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../ui/select';
import {
  Popover, PopoverTrigger, PopoverContent,
} from '../ui/popover';
import {
  Loader2, AlertTriangle, Plus, Trash2, ArrowRightLeft, RotateCcw, Wand2,
  Clock, CalendarDays, Users, Pencil,
} from 'lucide-react';
import { levelsAPI } from '../../services/api';

const DAYS = [
  { id: 'saturday',  ar: 'السبت' },
  { id: 'sunday',    ar: 'الأحد' },
  { id: 'monday',    ar: 'الإثنين' },
  { id: 'tuesday',   ar: 'الثلاثاء' },
  { id: 'wednesday', ar: 'الأربعاء' },
  { id: 'thursday',  ar: 'الخميس' },
  { id: 'friday',    ar: 'الجمعة' },
];

const HOURS_12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const arDay = (id) => (DAYS.find((d) => d.id === id) || {}).ar || id;
const arHour = (h) => `الساعة ${h}`;

export default function LevelsScheduleBuilderDialog({
  open, onOpenChange, branchFilter, onApplied, onLaunchAutoAssign, t,
}) {
  const tt = t || ((ar) => ar);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [activeDay, setActiveDay] = useState('saturday');
  const [busyLevelId, setBusyLevelId] = useState('');
  const [extraHoursPerDay, setExtraHoursPerDay] = useState({});
  const [newHourInput, setNewHourInput] = useState({});
  const [addPickerOpen, setAddPickerOpen] = useState({});
  const [addPickerSearch, setAddPickerSearch] = useState({});
  const [movePickerOpen, setMovePickerOpen] = useState({});
  const [editPickerOpen, setEditPickerOpen] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (branchFilter && branchFilter !== 'all') params.branch_filter = branchFilter;
      const res = await levelsAPI.scheduleSnapshot(params);
      setData(res.data);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'فشل التحميل');
    } finally {
      setLoading(false);
    }
  }, [branchFilter]);

  useEffect(() => {
    if (open) {
      load();
      setExtraHoursPerDay({});
      setNewHourInput({});
      setAddPickerOpen({});
      setMovePickerOpen({});
    }
  }, [open, load]);

  const allLevels = useMemo(() => {
    if (!data) return [];
    const map = new Map();
    Object.values(data.days || {}).forEach((d) => {
      Object.values(d.hours || {}).forEach((arr) => {
        arr.forEach((lvl) => map.set(lvl.id, lvl));
      });
    });
    (data.unscheduled || []).forEach((lvl) => map.set(lvl.id, lvl));
    return Array.from(map.values());
  }, [data]);

  const hoursForDay = useCallback((dayId) => {
    if (!data) return [];
    const fromServer = Object.keys(data.days?.[dayId]?.hours || {}).map((h) => parseInt(h, 10));
    const extras = (extraHoursPerDay[dayId] || []).map((h) => parseInt(h, 10));
    const all = Array.from(new Set([...fromServer, ...extras])).filter((h) => Number.isFinite(h));
    all.sort((a, b) => a - b);
    return all;
  }, [data, extraHoursPerDay]);

  const cellLevels = useCallback((dayId, hour) => {
    if (!data) return [];
    return data.days?.[dayId]?.hours?.[String(hour)] || [];
  }, [data]);

  const callSlot = async (payload) => {
    setBusyLevelId(payload.level_id);
    try {
      await levelsAPI.scheduleSlot(payload);
      await load();
      if (onApplied) onApplied();
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'فشل التحديث');
    } finally {
      setBusyLevelId('');
    }
  };

  const removeFromCell = (dayId, level) => {
    callSlot({ level_id: level.id, days_to_remove: [dayId] });
  };

  const addLevelToCell = (dayId, hour, level) => {
    const payload = { level_id: level.id, days_to_add: [dayId], hour };
    if (level.hour && level.hour !== hour && (level.days || []).length > 1) {
      const ok = window.confirm(
        tt(
          `سيتم تغيير ساعة المستوى من "الساعة ${level.hour}" إلى "الساعة ${hour}" في كل أيامه (${(level.days||[]).map(arDay).join('، ')}). هل تريد المتابعة؟`,
          `Changing this level's hour from ${level.hour} to ${hour} will affect all of its days (${(level.days||[]).map(arDay).join(', ')}). Continue?`
        )
      );
      if (!ok) return;
    }
    callSlot(payload);
    setAddPickerOpen((p) => ({ ...p, [`${dayId}-${hour}`]: false }));
    setAddPickerSearch((p) => ({ ...p, [`${dayId}-${hour}`]: '' }));
  };

  const saveDetails = async (level, edits) => {
    setBusyLevelId(level.id);
    try {
      await levelsAPI.updateDetails({ level_id: level.id, ...edits });
      await load();
      if (onApplied) onApplied();
      setEditPickerOpen((p) => ({ ...p, [level.id]: false }));
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'فشل حفظ التفاصيل');
    } finally {
      setBusyLevelId('');
    }
  };

  const moveLevel = (oldDay, level, newDay, newHour) => {
    const payload = { level_id: level.id };
    if (newDay && newDay !== oldDay) {
      payload.days_to_remove = [oldDay];
      payload.days_to_add = [newDay];
    }
    if (newHour && newHour !== level.hour) {
      payload.hour = newHour;
      if ((level.days || []).length > 1) {
        const ok = window.confirm(
          tt(
            `تغيير الساعة سيؤثر على باقي أيام المستوى (${(level.days||[]).map(arDay).join('، ')}). متابعة؟`,
            `Changing the hour affects all of this level's days (${(level.days||[]).map(arDay).join(', ')}). Continue?`
          )
        );
        if (!ok) return;
      }
    }
    if (!payload.days_to_add && !payload.days_to_remove && !payload.hour) {
      setMovePickerOpen((p) => ({ ...p, [`${oldDay}-${level.id}`]: false }));
      return;
    }
    callSlot(payload);
    setMovePickerOpen((p) => ({ ...p, [`${oldDay}-${level.id}`]: false }));
  };

  const addNewHourLocally = (dayId) => {
    const raw = (newHourInput[dayId] || '').trim();
    const h = parseInt(raw, 10);
    if (!Number.isFinite(h) || h < 1 || h > 12) {
      setError(tt('أدخل ساعة بين 1 و 12', 'Enter an hour between 1 and 12'));
      return;
    }
    setExtraHoursPerDay((prev) => {
      const cur = new Set(prev[dayId] || []);
      cur.add(h);
      return { ...prev, [dayId]: Array.from(cur) };
    });
    setNewHourInput((p) => ({ ...p, [dayId]: '' }));
    setError('');
  };

  const totals = data?.totals || {};

  const renderHourGroup = (dayId, hour) => {
    const cellId = `${dayId}-${hour}`;
    const levels = cellLevels(dayId, hour);
    const inCellIds = new Set(levels.map((l) => l.id));
    const search = (addPickerSearch[cellId] || '').toLowerCase();
    const candidates = allLevels
      .filter((l) => !inCellIds.has(l.id))
      .filter((l) => {
        if (!search) return true;
        const hay = `${l.activity_name} ${l.custom_name} ${l.level_number}`.toLowerCase();
        return hay.includes(search);
      })
      .slice(0, 60);

    return (
      <div key={cellId} className="border border-gray-200 rounded-lg bg-white">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50 rounded-t-lg">
          <div className="flex items-center gap-2 font-medium text-gray-800">
            <Clock className="w-4 h-4 text-emerald-600" />
            {arHour(hour)}
            <Badge variant="outline" className="text-xs">{levels.length} {tt('مستوى', 'levels')}</Badge>
          </div>
          <Popover
            open={!!addPickerOpen[cellId]}
            onOpenChange={(v) => setAddPickerOpen((p) => ({ ...p, [cellId]: v }))}
          >
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                <Plus className="w-3 h-3" />
                {tt('إضافة مستوى', 'Add level')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-2" align="end" dir="rtl">
              <Input
                placeholder={tt('ابحث باسم النشاط أو رقم المستوى…', 'Search by activity or level #')}
                value={addPickerSearch[cellId] || ''}
                onChange={(e) => setAddPickerSearch((p) => ({ ...p, [cellId]: e.target.value }))}
                className="mb-2"
              />
              <div className="max-h-72 overflow-y-auto space-y-1">
                {candidates.length === 0 ? (
                  <div className="text-xs text-gray-400 text-center py-3">
                    {tt('لا يوجد مستويات أخرى', 'No other levels')}
                  </div>
                ) : candidates.map((lvl) => {
                  const here = lvl.hour ? arHour(lvl.hour) : tt('بدون ساعة', 'no hour');
                  const dayList = (lvl.days || []).map(arDay).join('، ') || tt('بدون أيام', 'no days');
                  return (
                    <button
                      key={lvl.id}
                      type="button"
                      onClick={() => addLevelToCell(dayId, hour, lvl)}
                      className="w-full text-right p-2 rounded hover:bg-emerald-50 border border-transparent hover:border-emerald-200 text-sm"
                    >
                      <div className="font-medium text-gray-800">
                        {tt('المستوى', 'Level')} {lvl.level_number} — {lvl.activity_name || lvl.custom_name || '—'}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {here} • {dayList}
                      </div>
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div className="p-3 space-y-2">
          {levels.length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-4">
              {tt('لا توجد مستويات في هذه الخانة بعد', 'No levels in this slot yet')}
            </div>
          ) : levels.map((lvl) => (
            <div
              key={lvl.id}
              className="flex items-center justify-between gap-2 p-2 border rounded bg-gray-50/60"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-900 truncate">
                  {tt('المستوى', 'Level')} {lvl.level_number} — {lvl.activity_name || lvl.custom_name || '—'}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {lvl.members_count}
                    {lvl.capacity ? ` / ${lvl.capacity}` : ''}
                  </span>
                  <span className="flex items-center gap-1">
                    <CalendarDays className="w-3 h-3" />
                    {(lvl.days || []).map(arDay).join('، ') || '—'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Popover
                  open={!!editPickerOpen[lvl.id]}
                  onOpenChange={(v) => setEditPickerOpen((p) => ({ ...p, [lvl.id]: v }))}
                >
                  <PopoverTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-amber-600 hover:bg-amber-50 h-8 px-2"
                      disabled={busyLevelId === lvl.id}
                      title={tt('تعديل التفاصيل (نشاط، سعة، اسم)', 'Edit details (activity, capacity, name)')}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-3" align="end" dir="rtl">
                    <div className="text-sm font-medium mb-2">{tt('تعديل تفاصيل المستوى', 'Edit level details')}</div>
                    <EditDetailsForm
                      level={lvl}
                      activityOptions={data?.activity_options || []}
                      onSubmit={(edits) => saveDetails(lvl, edits)}
                      busy={busyLevelId === lvl.id}
                      tt={tt}
                    />
                  </PopoverContent>
                </Popover>
                <Popover
                  open={!!movePickerOpen[`${dayId}-${lvl.id}`]}
                  onOpenChange={(v) => setMovePickerOpen((p) => ({ ...p, [`${dayId}-${lvl.id}`]: v }))}
                >
                  <PopoverTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-blue-600 hover:bg-blue-50 h-8 px-2"
                      disabled={busyLevelId === lvl.id}
                      title={tt('نقل إلى يوم/ساعة أخرى', 'Move to another day/hour')}
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-3" align="end" dir="rtl">
                    <div className="text-sm font-medium mb-2">{tt('نقل إلى', 'Move to')}</div>
                    <MoveTargetForm
                      currentDay={dayId}
                      currentHour={lvl.hour}
                      onSubmit={(newDay, newHour) => moveLevel(dayId, lvl, newDay, newHour)}
                      tt={tt}
                    />
                  </PopoverContent>
                </Popover>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-600 hover:bg-red-50 h-8 px-2"
                  disabled={busyLevelId === lvl.id}
                  onClick={() => removeFromCell(dayId, lvl)}
                  title={tt('حذف من هذه الخانة', 'Remove from this slot')}
                >
                  {busyLevelId === lvl.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-hidden flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-emerald-600" />
            {tt('جدولة المستويات حسب اليوم والساعة', 'Schedule levels by day and hour')}
          </DialogTitle>
          <p className="text-sm text-gray-500 mt-1">
            {tt(
              'اختر اليوم، أضف الساعة، ثم أسند المستويات للخانة المناسبة. الإسناد التلقائي يعتمد على الفرع واليوم والساعة فقط — النشاط وسم اختياري.',
              'Pick a day, add the hour, then place levels into the matching slot. Auto-assign matches by branch + day + hour — activity is just an optional tag.'
            )}
          </p>
        </DialogHeader>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20 text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            {tt('جاري التحميل...', 'Loading...')}
          </div>
        )}

        {!loading && data && (
          <>
            <div className="flex flex-wrap gap-2 py-2 border-b">
              <Badge variant="outline" className="bg-gray-50">
                {tt('عدد المستويات', 'Levels')}: {totals.total_levels || 0}
              </Badge>
              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300">
                {tt('مجدولة', 'Scheduled')}: {totals.scheduled || 0}
              </Badge>
              <Badge className="bg-amber-100 text-amber-700 border-amber-300">
                {tt('بحاجة لجدولة', 'Need scheduling')}: {totals.unscheduled || 0}
              </Badge>
            </div>

            <Tabs value={activeDay} onValueChange={setActiveDay} className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="flex-wrap justify-start h-auto py-1 gap-1 bg-gray-100">
                {DAYS.map((d) => {
                  const count = Object.values(data.days?.[d.id]?.hours || {}).reduce((s, a) => s + a.length, 0);
                  return (
                    <TabsTrigger key={d.id} value={d.id} className="data-[state=active]:bg-white">
                      {d.ar}
                      {count > 0 && (
                        <Badge variant="outline" className="mr-1 text-xs h-5">{count}</Badge>
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {DAYS.map((d) => {
                const hours = hoursForDay(d.id);
                return (
                  <TabsContent key={d.id} value={d.id} className="flex-1 overflow-y-auto pr-1 mt-3 space-y-3">
                    {hours.length === 0 ? (
                      <div className="text-center py-10 border-2 border-dashed border-gray-200 rounded-lg">
                        <Clock className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                        <div className="text-sm text-gray-500 mb-3">
                          {tt(`لا توجد ساعات مُعدّة لـ${d.ar} بعد`, `No hours configured for ${d.ar} yet`)}
                        </div>
                        <AddHourInline
                          dayId={d.id}
                          value={newHourInput[d.id] || ''}
                          onChange={(v) => setNewHourInput((p) => ({ ...p, [d.id]: v }))}
                          onAdd={() => addNewHourLocally(d.id)}
                          tt={tt}
                        />
                      </div>
                    ) : (
                      <>
                        {hours.map((h) => renderHourGroup(d.id, h))}
                        <div className="flex items-center gap-2 pt-2">
                          <AddHourInline
                            dayId={d.id}
                            value={newHourInput[d.id] || ''}
                            onChange={(v) => setNewHourInput((p) => ({ ...p, [d.id]: v }))}
                            onAdd={() => addNewHourLocally(d.id)}
                            tt={tt}
                            compact
                          />
                        </div>
                      </>
                    )}
                  </TabsContent>
                );
              })}
            </Tabs>

            {(data.unscheduled || []).length > 0 && (
              <div className="border-t pt-2 text-xs text-gray-500">
                {tt('مستويات بدون جدولة (بدون يوم أو ساعة):', 'Unscheduled levels (no day or hour):')}{' '}
                {(data.unscheduled || []).length}
              </div>
            )}
          </>
        )}

        <DialogFooter className="border-t pt-3 flex-wrap gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tt('إغلاق', 'Close')}
          </Button>
          <Button variant="outline" onClick={load} disabled={loading} className="gap-1">
            <RotateCcw className="w-4 h-4" />
            {tt('إعادة تحميل', 'Reload')}
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              if (onLaunchAutoAssign) onLaunchAutoAssign();
            }}
            className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Wand2 className="w-4 h-4" />
            {tt('تشغيل الإسناد التلقائي الآن', 'Run auto-assign now')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddHourInline({ dayId, value, onChange, onAdd, tt, compact }) {
  return (
    <div className={`flex items-center gap-2 ${compact ? '' : 'justify-center'}`}>
      <Label className="text-xs text-gray-500">
        {tt('أضف ساعة (1-12)', 'Add hour (1-12)')}
      </Label>
      <Select value={value || ''} onValueChange={onChange}>
        <SelectTrigger className="w-24 h-8 bg-white">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {HOURS_12.map((h) => (
            <SelectItem key={h} value={String(h)}>{h}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" onClick={onAdd} className="gap-1 h-8">
        <Plus className="w-3 h-3" />
        {tt('أضف', 'Add')}
      </Button>
    </div>
  );
}

function EditDetailsForm({ level, activityOptions, onSubmit, busy, tt }) {
  const [activityId, setActivityId] = useState(level.activity_id || '');
  const [activityName, setActivityName] = useState(level.activity_name || '');
  const [capacity, setCapacity] = useState(
    level.capacity != null ? String(level.capacity) : ''
  );
  const [customName, setCustomName] = useState(level.custom_name || '');

  const handleActivityChange = (val) => {
    if (val === '__none__') {
      setActivityId('');
      setActivityName('');
    } else {
      setActivityId(val);
      const found = (activityOptions || []).find((a) => a.id === val);
      if (found && found.name) setActivityName(found.name);
    }
  };

  const submit = () => {
    const edits = {};
    if ((activityId || '') !== (level.activity_id || '')) {
      edits.activity_id = activityId || '';
    }
    if (activityName !== (level.activity_name || '')) {
      edits.activity_name = activityName;
    }
    if (customName !== (level.custom_name || '')) {
      edits.custom_name = customName;
    }
    const curCap = level.capacity != null ? String(level.capacity) : '';
    if (capacity !== curCap) {
      const trimmed = (capacity || '').trim();
      if (trimmed === '') {
        edits.capacity = 0;
      } else {
        const n = parseInt(trimmed, 10);
        if (Number.isFinite(n)) {
          edits.capacity = n;
        }
      }
    }
    onSubmit(edits);
  };

  return (
    <div className="space-y-2">
      <div>
        <Label className="text-xs">{tt('النشاط (وسم اختياري)', 'Activity (optional tag)')}</Label>
        <Select value={activityId || '__none__'} onValueChange={handleActivityChange}>
          <SelectTrigger className="bg-white h-8">
            <SelectValue placeholder={tt('بدون نشاط', 'None')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{tt('بدون نشاط', 'None')}</SelectItem>
            {(activityOptions || []).map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">{tt('اسم المستوى المخصّص', 'Custom name')}</Label>
        <Input
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          className="h-8"
          placeholder={tt('اختياري', 'optional')}
        />
      </div>
      <div>
        <Label className="text-xs">{tt('السعة القصوى', 'Capacity')}</Label>
        <Input
          type="number"
          min="0"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          className="h-8"
          placeholder={tt('بدون حد', 'no limit')}
        />
      </div>
      <Button
        size="sm"
        className="w-full bg-amber-600 hover:bg-amber-700 text-white"
        onClick={submit}
        disabled={busy}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
        {tt('حفظ التفاصيل', 'Save details')}
      </Button>
    </div>
  );
}

function MoveTargetForm({ currentDay, currentHour, onSubmit, tt }) {
  const [day, setDay] = useState(currentDay);
  const [hour, setHour] = useState(currentHour ? String(currentHour) : '');
  return (
    <div className="space-y-2">
      <div>
        <Label className="text-xs">{tt('اليوم', 'Day')}</Label>
        <Select value={day} onValueChange={setDay}>
          <SelectTrigger className="bg-white h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DAYS.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.ar}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">{tt('الساعة', 'Hour')}</Label>
        <Select value={hour} onValueChange={setHour}>
          <SelectTrigger className="bg-white h-8">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {HOURS_12.map((h) => (
              <SelectItem key={h} value={String(h)}>{`الساعة ${h}`}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        size="sm"
        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
        onClick={() => onSubmit(day, hour ? parseInt(hour, 10) : null)}
      >
        {tt('تطبيق النقل', 'Apply move')}
      </Button>
    </div>
  );
}
