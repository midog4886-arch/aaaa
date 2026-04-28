import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Checkbox } from '../ui/checkbox';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../ui/select';
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from '../ui/tooltip';
import {
  Sparkles, CheckCircle2, AlertTriangle, Loader2, Save, RotateCcw, Filter,
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

const NONE_VALUE = '__none__';

export default function LevelsCleanupDialog({ open, onOpenChange, branchFilter, onApplied, t }) {
  const tt = t || ((ar) => ar);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState(null);
  const [edits, setEdits] = useState({});
  const [filter, setFilter] = useState('incomplete');
  const [error, setError] = useState('');
  const [saveResult, setSaveResult] = useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    setSaveResult(null);
    try {
      const params = {};
      if (branchFilter && branchFilter !== 'all') params.branch_filter = branchFilter;
      const res = await levelsAPI.cleanupSuggestions(params);
      setData(res.data);
      const initial = {};
      (res.data.levels || []).forEach((lvl) => {
        initial[lvl.id] = {
          activity_id: lvl.current.activity_id || lvl.suggested.activity_id || '',
          time_slot: lvl.current.time_slot || lvl.suggested.time_slot || '',
          days: Array.isArray(lvl.current.days) ? [...lvl.current.days] : [],
          activity_name: lvl.activity_name || '',
          rename_enabled: false,
        };
      });
      setEdits(initial);
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'فشل التحميل');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, branchFilter]);

  const filteredLevels = useMemo(() => {
    if (!data?.levels) return [];
    if (filter === 'all') return data.levels;
    if (filter === 'incomplete') return data.levels.filter((l) => !l.is_complete);
    if (filter === 'complete') return data.levels.filter((l) => l.is_complete);
    return data.levels;
  }, [data, filter]);

  const setEdit = (id, patch) => {
    setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
  };

  const toggleDay = (id, day) => {
    setEdits((prev) => {
      const cur = prev[id] || { days: [] };
      const days = new Set(cur.days || []);
      if (days.has(day)) days.delete(day); else days.add(day);
      return { ...prev, [id]: { ...cur, days: Array.from(days) } };
    });
  };

  const acceptSuggestionsAll = () => {
    setEdits((prev) => {
      const out = { ...prev };
      (data?.levels || []).forEach((lvl) => {
        if (lvl.is_complete) return;
        out[lvl.id] = {
          ...(out[lvl.id] || {}),
          activity_id: lvl.suggested.activity_id || (out[lvl.id]?.activity_id || ''),
          time_slot: lvl.suggested.time_slot || (out[lvl.id]?.time_slot || ''),
        };
      });
      return out;
    });
  };

  const buildItemsToSave = () => {
    const items = [];
    (data?.levels || []).forEach((lvl) => {
      const e = edits[lvl.id];
      if (!e) return;
      const item = { id: lvl.id };
      const aid = e.activity_id === NONE_VALUE ? null : (e.activity_id || null);
      if ((aid || null) !== (lvl.current.activity_id || null)) item.activity_id = aid || '';
      const slot = (e.time_slot || '').trim();
      if (slot !== (lvl.current.time_slot || '')) item.time_slot = slot;
      const curDays = Array.isArray(lvl.current.days) ? [...lvl.current.days].sort() : [];
      const newDays = Array.isArray(e.days) ? [...e.days].sort() : [];
      const daysDiffer = curDays.length !== newDays.length || curDays.some((d, i) => d !== newDays[i]);
      if (daysDiffer) item.days = newDays;
      if (e.rename_enabled && e.activity_name && e.activity_name.trim() && e.activity_name.trim() !== lvl.activity_name) {
        item.activity_name = e.activity_name.trim();
      }
      if (Object.keys(item).length > 1) items.push(item);
    });
    return items;
  };

  const itemsToSaveCount = useMemo(() => buildItemsToSave().length, [edits, data]); // eslint-disable-line

  const onSaveAll = async () => {
    const items = buildItemsToSave();
    if (!items.length) return;
    setSaving(true);
    setError('');
    setSaveResult(null);
    try {
      const res = await levelsAPI.cleanupBulk(items);
      setSaveResult(res.data);
      await load();
      if (onApplied) onApplied();
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const totals = data?.totals || {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-hidden flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-600" />
            {tt('تنظيف بيانات المستويات', 'Clean up level data')}
          </DialogTitle>
          <p className="text-sm text-gray-500 mt-1">
            {tt(
              'حدّد النشاط والتوقيت وأيام التدريب لكل مستوى حتى يعمل الإسناد التلقائي بدقة. الاقتراحات مُسجّلة مسبقاً ويمكن قبولها أو تعديلها.',
              'Set the activity, time slot and training days for every level so auto-assignment can match accurately. Suggestions are pre-filled — accept or override.'
            )}
          </p>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-20 text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            {tt('جاري التحميل...', 'Loading...')}
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        )}

        {!loading && data && (
          <>
            <div className="flex flex-wrap items-center gap-3 py-2 border-b">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-gray-50">
                  {tt('الإجمالي', 'Total')}: {totals.total || 0}
                </Badge>
                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  {tt('مكتمل', 'Complete')}: {totals.complete || 0}
                </Badge>
                <Badge className="bg-amber-100 text-amber-700 border-amber-300">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  {tt('بحاجة لإكمال', 'Needs setup')}: {totals.incomplete || 0}
                </Badge>
              </div>

              <div className="flex items-center gap-2 ml-auto">
                <Filter className="w-4 h-4 text-gray-400" />
                <Select value={filter} onValueChange={setFilter}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="incomplete">{tt('غير مكتملة فقط', 'Incomplete only')}</SelectItem>
                    <SelectItem value="all">{tt('كل المستويات', 'All levels')}</SelectItem>
                    <SelectItem value="complete">{tt('المكتملة فقط', 'Complete only')}</SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={acceptSuggestionsAll}
                  disabled={!totals.incomplete}
                >
                  <Sparkles className="w-3 h-3" />
                  {tt('قبول كل الاقتراحات', 'Accept all suggestions')}
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-1">
              {filteredLevels.length === 0 ? (
                <div className="text-center text-gray-400 py-10">
                  {tt('لا يوجد مستويات في هذا الفلتر', 'No levels in this filter')}
                </div>
              ) : (
                <div className="space-y-3 py-3">
                  {filteredLevels.map((lvl) => {
                    const e = edits[lvl.id] || {};
                    const isComplete = lvl.is_complete;
                    return (
                      <div
                        key={lvl.id}
                        className={`border rounded-lg p-3 ${isComplete ? 'bg-emerald-50/40 border-emerald-200' : 'bg-amber-50/40 border-amber-200'}`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div>
                            <div className="font-medium text-gray-900 flex items-center gap-2">
                              {isComplete ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              ) : (
                                <AlertTriangle className="w-4 h-4 text-amber-600" />
                              )}
                              {tt('المستوى', 'Level')} {lvl.level_number} — {lvl.activity_name || tt('بدون اسم', 'no name')}
                              {lvl.custom_name ? (
                                <span className="text-xs text-gray-500"> ({lvl.custom_name})</span>
                              ) : null}
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {tt('عدد الأعضاء', 'Members')}: {lvl.members_count}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div>
                            <Label className="text-xs">{tt('النشاط', 'Activity')}</Label>
                            <Select
                              value={e.activity_id || NONE_VALUE}
                              onValueChange={(v) => setEdit(lvl.id, { activity_id: v })}
                            >
                              <SelectTrigger className="bg-white">
                                <SelectValue placeholder={tt('اختر نشاط', 'Select activity')} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE_VALUE}>
                                  {tt('— غير محدد —', '— not set —')}
                                </SelectItem>
                                {(data.activity_options || []).map((act) => (
                                  <SelectItem key={act.id} value={act.id}>
                                    {act.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {lvl.suggested.activity_id && lvl.suggested.activity_id !== e.activity_id && (
                              <button
                                type="button"
                                className="text-xs text-amber-700 hover:underline mt-1"
                                onClick={() => setEdit(lvl.id, { activity_id: lvl.suggested.activity_id })}
                              >
                                {tt('قبول الاقتراح:', 'Accept suggestion:')}{' '}
                                {(data.activity_options || []).find((a) => a.id === lvl.suggested.activity_id)?.name || ''}
                              </button>
                            )}
                          </div>

                          <div>
                            <Label className="text-xs">{tt('التوقيت', 'Time slot')}</Label>
                            <Input
                              value={e.time_slot || ''}
                              onChange={(ev) => setEdit(lvl.id, { time_slot: ev.target.value })}
                              placeholder={tt('مثال: الساعة 5', 'e.g. 5:00 PM')}
                              className="bg-white"
                            />
                            {lvl.suggested.time_slot && lvl.suggested.time_slot !== e.time_slot && (
                              <button
                                type="button"
                                className="text-xs text-amber-700 hover:underline mt-1"
                                onClick={() => setEdit(lvl.id, { time_slot: lvl.suggested.time_slot })}
                              >
                                {tt('قبول الاقتراح:', 'Accept suggestion:')} {lvl.suggested.time_slot}
                              </button>
                            )}
                          </div>

                          <div>
                            <Label className="text-xs">{tt('أيام التدريب', 'Training days')}</Label>
                            <div className="flex flex-wrap gap-1.5 pt-1.5">
                              {DAYS.map((d) => (
                                <button
                                  key={d.id}
                                  type="button"
                                  onClick={() => toggleDay(lvl.id, d.id)}
                                  className={`px-2 py-1 rounded text-xs border transition ${
                                    (e.days || []).includes(d.id)
                                      ? 'bg-emerald-600 text-white border-emerald-600'
                                      : 'bg-white text-gray-700 border-gray-300 hover:border-emerald-400'
                                  }`}
                                >
                                  {d.ar}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 mt-3 text-xs">
                          <Checkbox
                            id={`rename-${lvl.id}`}
                            checked={!!e.rename_enabled}
                            onCheckedChange={(v) => setEdit(lvl.id, { rename_enabled: !!v })}
                          />
                          <Label htmlFor={`rename-${lvl.id}`} className="cursor-pointer text-gray-600">
                            {tt('إعادة تسمية المستوى', 'Rename level')}
                          </Label>
                          {e.rename_enabled && (
                            <>
                              <Input
                                value={e.activity_name || ''}
                                onChange={(ev) => setEdit(lvl.id, { activity_name: ev.target.value })}
                                placeholder={lvl.suggested.clean_name || lvl.activity_name}
                                className="bg-white h-7 max-w-xs"
                              />
                              {lvl.suggested.clean_name && lvl.suggested.clean_name !== e.activity_name && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        className="text-amber-700 hover:underline"
                                        onClick={() => setEdit(lvl.id, { activity_name: lvl.suggested.clean_name })}
                                      >
                                        ({tt('استخدم الاسم النظيف', 'use clean name')})
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>{lvl.suggested.clean_name}</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {saveResult && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded text-sm text-emerald-800">
            {tt('تم تطبيق', 'Applied')} {saveResult.applied} {tt('من', 'of')} {saveResult.total} {tt('تعديل', 'edits')}.
          </div>
        )}

        <DialogFooter className="border-t pt-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tt('إغلاق', 'Close')}
          </Button>
          <Button variant="outline" onClick={load} disabled={loading} className="gap-1">
            <RotateCcw className="w-4 h-4" />
            {tt('إعادة تحميل', 'Reload')}
          </Button>
          <Button
            onClick={onSaveAll}
            disabled={saving || itemsToSaveCount === 0}
            className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {tt('حفظ التعديلات', 'Save changes')}
            {itemsToSaveCount > 0 ? ` (${itemsToSaveCount})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
