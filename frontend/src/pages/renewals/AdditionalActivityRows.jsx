import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import ScheduleDaysTimeEditor from '../../components/ScheduleDaysTimeEditor';
import { calcEndDate } from '../invoices/hooks/useInvoiceForm';

const AdditionalActivityRows = ({ rows, onChange, activities, levels, branchId, language, onRelevantEdit, createRow }) => {
  const update = (index, patch) => {
    onChange(rows.map((row, i) => i === index ? { ...row, ...patch } : row));
    onRelevantEdit();
  };
  const visibleActivities = activities.filter((a) => !a.branch_id || a.branch_id === branchId);

  return (
    <div className="space-y-3" data-testid="additional-activity-rows">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{language === 'ar' ? 'أنشطة إضافية' : 'Additional activities'}</h3>
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...rows, createRow()])} data-testid="add-additional-activity">
          <Plus className="w-4 h-4 me-1" />{language === 'ar' ? 'إضافة نشاط' : 'Add activity'}
        </Button>
      </div>
      {rows.map((row, index) => row && (
        <div key={row._key || index} className="p-3 border rounded-lg space-y-3" data-testid={`additional-activity-${index}`}>
          <div className="flex gap-2">
            <Select value={row.activity_id || undefined} onValueChange={(id) => {
              const activity = visibleActivities.find((a) => a.id === id);
              update(index, {
                activity_id: id,
                activity_name: activity?.name_ar || activity?.name || '',
                fee: (activity?.monthly_fee ?? activity?.fee) ?? row.fee,
                level_id: '',
              });
            }}>
              <SelectTrigger className="flex-1"><SelectValue placeholder={language === 'ar' ? 'اختر النشاط' : 'Select activity'} /></SelectTrigger>
              <SelectContent>{visibleActivities.map((a) => <SelectItem key={a.id} value={a.id}>{a.name_ar || a.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="button" size="icon" variant="ghost" className="text-red-600" aria-label="Remove additional activity"
              onClick={() => { onChange(rows.filter((_, i) => i !== index)); onRelevantEdit(); }}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
          <ScheduleDaysTimeEditor value={row} language={language} onChange={(patch) => {
            const next = { ...patch };
            if (patch.training_days && row.start_date) next.end_date = calcEndDate(row.start_date, row.weeks || 4, patch.training_days);
            update(index, next);
          }} />
          <div className="grid grid-cols-3 gap-2">
            <Input type="date" value={row.start_date} onChange={(e) => update(index, {
              start_date: e.target.value,
              end_date: e.target.value ? calcEndDate(e.target.value, row.weeks || 4, row.training_days) : '',
            })} />
            <Input type="number" min="1" max="52" aria-label="Weeks" value={row.weeks} onChange={(e) => {
              const weeks = Number(e.target.value);
              update(index, { weeks, end_date: row.start_date ? calcEndDate(row.start_date, weeks, row.training_days) : '' });
            }} />
            <Input type="date" value={row.end_date} onChange={(e) => update(index, { end_date: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select value={row.level_id || '__none__'} onValueChange={(value) => update(index, { level_id: value === '__none__' ? '' : value })}>
              <SelectTrigger><SelectValue placeholder={language === 'ar' ? 'المستوى' : 'Level'} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{language === 'ar' ? 'بدون مستوى' : 'No level'}</SelectItem>
                {levels.filter((l) => (!l.branch_id || l.branch_id === branchId) && (!l.activity_id || l.activity_id === row.activity_id))
                  .map((l) => <SelectItem key={l.id} value={l.id}>{l.display_name || l.custom_name || `${language === 'ar' ? 'المستوى' : 'Level'} ${l.level_number}`}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="number" min="0" step="0.01" aria-label="Fee" value={row.fee} onChange={(e) => update(index, { fee: e.target.value })} />
          </div>
        </div>
      ))}
    </div>
  );
};

export default AdditionalActivityRows;