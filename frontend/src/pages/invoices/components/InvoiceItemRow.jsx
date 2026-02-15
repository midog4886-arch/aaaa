/**
 * Invoice Item Component
 * مكون عنصر الفاتورة (نشاط أو منتج)
 */
import React from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Badge } from '../../../components/ui/badge';
import { Trash2, Package, Receipt, Lock } from 'lucide-react';

// Training days in Arabic
const TRAINING_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

// Format schedule string
const formatSchedule = (days, time) => {
  if (!days || days.length === 0) return time || '';
  const dayOrder = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const sortedDays = [...days].sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));
  let daysStr;
  if (sortedDays.length === 1) {
    daysStr = sortedDays[0];
  } else {
    const lastDay = sortedDays.pop();
    daysStr = sortedDays.join('، ') + ' و ' + lastDay;
  }
  return time ? `${daysStr} - ${time}` : daysStr;
};

const InvoiceItemRow = ({
  item,
  index,
  onRemove,
  onUpdate,
  products = [],
  levels = [],
  levelSelectorState,
  onInitLevelSelector,
  onSelectLevelActivity,
  onSelectLevelTime,
  onGoBackLevelSelector,
  onResetLevelSelector,
  onUpdateLevel,
  groupedLevelsForSelector = {},
  levelCapacityWarnings = {},
  onAcceptFullLevel,
  onRejectFullLevel,
  feeEditUnlocked = false,
  onUnlockFeeEdit,
  language = 'ar',
  t,
  MAIN_ACTIVITIES_FOR_LEVELS = []
}) => {
  const handleDayToggle = (day) => {
    const currentDays = item.training_days || [];
    const newDays = currentDays.includes(day)
      ? currentDays.filter(d => d !== day)
      : [...currentDays, day];
    
    const schedule = formatSchedule(newDays, item.training_time);
    onUpdate(index, { ...item, training_days: newDays, schedule });
  };

  const handleTimeChange = (hour) => {
    const timeStr = hour ? `${hour}:00 م` : '';
    const schedule = formatSchedule(item.training_days, timeStr);
    onUpdate(index, { ...item, training_time_hour: hour, training_time: timeStr, schedule });
  };

  const handleQuantityChange = (qty) => {
    const product = products.find(p => p.id === item.product_id);
    if (product && qty <= product.quantity) {
      onUpdate(index, { ...item, quantity: qty, fee: product.price * qty });
    }
  };

  const handleDateChange = (field, value) => {
    const updated = { ...item, [field]: value };
    if (updated.start_date && updated.end_date) {
      updated.period = `${updated.start_date} - ${updated.end_date}`;
    }
    onUpdate(index, updated);
  };

  const handleFeeChange = (value) => {
    onUpdate(index, { ...item, fee: parseFloat(value) || 0 });
  };

  return (
    <div className={`p-3 bg-background rounded-lg border space-y-2 ${item.is_product ? 'border-green-300 bg-green-50/50' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {item.is_product ? (
            <Package className="w-4 h-4 text-green-600" />
          ) : (
            <Receipt className="w-4 h-4 text-blue-600" />
          )}
          <p className="font-medium">{item.activity_name}</p>
          {item.is_product && (
            <Badge variant="outline" className="bg-green-100 text-green-700 text-xs">
              {language === 'ar' ? 'منتج' : 'Product'}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={() => onRemove(index)} className="text-destructive">
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      {/* Product Fields */}
      {item.is_product ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">{language === 'ar' ? 'الكمية' : 'Quantity'}</Label>
            <Input
              type="number"
              value={item.quantity || 1}
              onChange={(e) => handleQuantityChange(parseInt(e.target.value) || 1)}
              min="1"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{language === 'ar' ? 'المبلغ' : 'Amount'}</Label>
            <Input
              type="number"
              value={item.fee}
              className="h-8 text-sm bg-muted"
              disabled
            />
          </div>
        </div>
      ) : (
        /* Activity Fields */
        <>
          {/* Dates Row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label className="text-sm font-medium">{language === 'ar' ? 'تاريخ البداية' : 'Start Date'}</Label>
              <Input
                type="date"
                value={item.start_date || ''}
                onChange={(e) => handleDateChange('start_date', e.target.value)}
                className="h-14 text-lg"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">{language === 'ar' ? 'تاريخ النهاية' : 'End Date'}</Label>
              <Input
                type="date"
                value={item.end_date || ''}
                onChange={(e) => handleDateChange('end_date', e.target.value)}
                className="h-14 text-lg"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1">
                {language === 'ar' ? 'المبلغ' : 'Fee'}
                {!feeEditUnlocked && <Lock className="w-3 h-3 text-amber-500" />}
              </Label>
              <Input
                type="number"
                value={item.fee}
                onChange={(e) => handleFeeChange(e.target.value)}
                className={`h-8 text-sm ${!feeEditUnlocked ? 'bg-amber-50 border-amber-200' : ''}`}
                onClick={() => !feeEditUnlocked && onUnlockFeeEdit?.()}
              />
            </div>
          </div>

          {/* Training Days */}
          <div className="space-y-1">
            <Label className="text-xs">{language === 'ar' ? 'أيام التدريب' : 'Training Days'}</Label>
            <div className="flex flex-wrap gap-1">
              {TRAINING_DAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => handleDayToggle(day)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${
                    (item.training_days || []).includes(day)
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          {/* Time */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">{language === 'ar' ? 'الساعة' : 'Time'}</Label>
              <Input
                type="number"
                min="1"
                max="12"
                value={item.training_time_hour || ''}
                onChange={(e) => handleTimeChange(e.target.value)}
                className="h-8 text-sm"
                placeholder={language === 'ar' ? 'مثال: 4' : 'e.g. 4'}
              />
              {item.training_time && (
                <p className="text-xs text-muted-foreground mt-1">{item.training_time}</p>
              )}
            </div>

            {/* Level Selector */}
            <div className="space-y-1">
              <Label className="text-xs">{language === 'ar' ? 'المستوى' : 'Level'}</Label>
              {!levelSelectorState?.[index] ? (
                <div>
                  {item.level_id ? (
                    <div className={`flex items-center justify-between p-2 border rounded-lg text-sm ${
                      levelCapacityWarnings[index]?.isFull && !levelCapacityWarnings[index]?.isAccepted 
                        ? 'border-orange-500 border-2 bg-orange-50' 
                        : levelCapacityWarnings[index]?.isAccepted 
                          ? 'border-green-500 border-2 bg-green-50' 
                          : 'bg-gray-50'
                    }`}>
                      <span>{item.level_name}</span>
                      <div className="flex gap-1">
                        <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onInitLevelSelector?.(index)}>
                          {language === 'ar' ? 'تغيير' : 'Change'}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs text-red-500" onClick={() => onUpdateLevel?.(index, '')}>
                          ✕
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-8 text-sm justify-start gap-2"
                      onClick={() => onInitLevelSelector?.(index)}
                    >
                      <span>🎯</span>
                      {language === 'ar' ? 'اختر المستوى' : 'Select Level'}
                    </Button>
                  )}
                </div>
              ) : (
                <LevelCascadingSelector
                  index={index}
                  state={levelSelectorState[index]}
                  groupedLevels={groupedLevelsForSelector}
                  mainActivities={MAIN_ACTIVITIES_FOR_LEVELS}
                  onSelectActivity={onSelectLevelActivity}
                  onSelectTime={onSelectLevelTime}
                  onGoBack={onGoBackLevelSelector}
                  onReset={onResetLevelSelector}
                  onSelectLevel={onUpdateLevel}
                  language={language}
                />
              )}

              {/* Capacity Warning */}
              {levelCapacityWarnings[index]?.isFull && !levelCapacityWarnings[index]?.isAccepted && (
                <div className="mt-2 p-2 bg-orange-50 border border-orange-300 rounded-lg">
                  <p className="text-xs text-orange-700 font-medium mb-2">
                    ⚠️ {levelCapacityWarnings[index].message}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white text-xs h-7"
                      onClick={() => onAcceptFullLevel?.(index)}
                    >
                      ✓ {language === 'ar' ? 'موافق' : 'Accept'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-red-500 text-red-600 hover:bg-red-50 text-xs h-7"
                      onClick={() => onRejectFullLevel?.(index)}
                    >
                      ✗ {language === 'ar' ? 'رفض' : 'Reject'}
                    </Button>
                  </div>
                </div>
              )}
              {levelCapacityWarnings[index]?.isAccepted && (
                <p className="text-xs text-green-600 font-medium mt-1">
                  ✓ {language === 'ar' ? 'تم قبول التسجيل رغم اكتمال العدد' : 'Registration accepted despite full capacity'}
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// Level Cascading Selector Component
const LevelCascadingSelector = ({
  index,
  state,
  groupedLevels,
  mainActivities,
  onSelectActivity,
  onSelectTime,
  onGoBack,
  onReset,
  onSelectLevel,
  language
}) => {
  return (
    <div className="border rounded-lg overflow-hidden bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between p-2 bg-gray-100 border-b">
        <div className="flex items-center gap-2">
          {state.step !== 'activity' && (
            <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onGoBack?.(index)}>
              {language === 'ar' ? '→' : '←'}
            </Button>
          )}
          <span className="text-xs font-medium text-gray-600">
            {state.step === 'activity' && (language === 'ar' ? 'اختر النشاط' : 'Select Activity')}
            {state.step === 'time' && (language === 'ar' ? 'اختر الساعة' : 'Select Time')}
            {state.step === 'level' && (language === 'ar' ? 'اختر المستوى' : 'Select Level')}
          </span>
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onReset?.(index)}>
          ✕
        </Button>
      </div>

      {/* Step 1: Activities */}
      {state.step === 'activity' && (
        <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
          {mainActivities.map(activity => {
            const activityLevels = groupedLevels[activity.id] || {};
            const timeCount = Object.keys(activityLevels).length;
            if (timeCount === 0) return null;
            return (
              <button
                key={activity.id}
                type="button"
                className={`w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-100 transition-colors ${activity.color} bg-opacity-10 hover:bg-opacity-20`}
                onClick={() => onSelectActivity?.(index, activity.id)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xl">{activity.icon}</span>
                  <span className="font-medium">{language === 'ar' ? activity.name_ar : activity.name_en}</span>
                </div>
                <div className="flex items-center gap-1 text-gray-500">
                  <span className="text-xs">{timeCount} {language === 'ar' ? 'أوقات' : 'times'}</span>
                  <span>{language === 'ar' ? '←' : '→'}</span>
                </div>
              </button>
            );
          })}
          {/* Other activities */}
          {groupedLevels['other'] && Object.keys(groupedLevels['other']).length > 0 && (
            <button
              type="button"
              className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-100 transition-colors bg-gray-100"
              onClick={() => onSelectActivity?.(index, 'other')}
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">📋</span>
                <span className="font-medium">{language === 'ar' ? 'أخرى' : 'Other'}</span>
              </div>
              <span>{language === 'ar' ? '←' : '→'}</span>
            </button>
          )}
        </div>
      )}

      {/* Step 2: Time Slots */}
      {state.step === 'time' && (
        <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
          {Object.entries(groupedLevels[state.selectedActivity] || {}).map(([timeSlot, timeLevels]) => {
            const totalMembers = timeLevels.reduce((sum, l) => sum + (l.members || []).length, 0);
            const totalCapacity = timeLevels.reduce((sum, l) => sum + (state.selectedActivity === 'swimming' ? 6 : (l.capacity || 10)), 0);
            return (
              <button
                key={timeSlot}
                type="button"
                className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-blue-50 transition-colors border"
                onClick={() => onSelectTime?.(index, timeSlot)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">🕐</span>
                  <span className="font-medium text-sm">{timeSlot}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">
                    {timeLevels.length} {language === 'ar' ? 'مستويات' : 'levels'} • {totalMembers}/{totalCapacity}
                  </span>
                  <span className="text-gray-400">{language === 'ar' ? '←' : '→'}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Step 3: Levels */}
      {state.step === 'level' && (
        <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
          {(groupedLevels[state.selectedActivity]?.[state.selectedTime] || [])
            .sort((a, b) => a.level_number - b.level_number)
            .map(level => {
              const memberCount = (level.members || []).length;
              const maxCapacity = state.selectedActivity === 'swimming' ? 6 : (level.capacity || 10);
              const isFull = memberCount >= maxCapacity;
              const fillPercent = Math.round((memberCount / maxCapacity) * 100);
              return (
                <button
                  key={level.id}
                  type="button"
                  className={`w-full p-2 rounded-lg transition-colors border ${isFull ? 'bg-red-50 border-red-200 hover:bg-red-100' : 'hover:bg-green-50 border-gray-200'}`}
                  onClick={() => onSelectLevel?.(index, level.id)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-bold ${isFull ? 'text-red-600' : 'text-gray-800'}`}>
                      {language === 'ar' ? 'المستوى' : 'Level'} {level.level_number}
                    </span>
                    <span className={`text-sm ${isFull ? 'text-red-600' : 'text-gray-600'}`}>
                      {memberCount}/{maxCapacity} {isFull && '⚠️'}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${isFull ? 'bg-red-500' : 'bg-green-500'}`}
                      style={{ width: `${Math.min(fillPercent, 100)}%` }}
                    />
                  </div>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
};

export default InvoiceItemRow;
