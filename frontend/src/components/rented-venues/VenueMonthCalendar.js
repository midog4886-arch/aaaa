import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Plus } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { monthDates, toLocalDateKey, venueSlotsForDate } from '../../utils/rentedVenues';

const WEEK_HEADERS = {
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};

const VenueMonthCalendar = ({
  ar,
  month,
  venues,
  isSlotReserved,
  onMonthChange,
  onAddBooking,
  onEditBooking,
}) => {
  const [selectedVenueId, setSelectedVenueId] = useState(venues[0]?.id || '');
  useEffect(() => {
    setSelectedVenueId(current => venues.some(venue => venue.id === current)
      ? current
      : (venues[0]?.id || ''));
  }, [venues]);

  const selectedVenue = venues.find(venue => venue.id === selectedVenueId) || venues[0];
  const dates = monthDates(month);
  const leadingDays = dates[0]?.getDay() || 0;
  const cells = useMemo(
    () => [...Array.from({ length: leadingDays }, () => null), ...dates],
    [dates, leadingDays]
  );
  const today = toLocalDateKey(new Date());
  const formatter = new Intl.DateTimeFormat(ar ? 'ar-SA' : 'en-US', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm" data-testid="venue-month-calendar">
      <div className="flex flex-col gap-4 border-b bg-muted/20 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-2">
          <CalendarDays className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-bold">{ar ? 'تقويم حجوزات الملاعب' : 'Venue booking calendar'}</h2>
            <p className="text-sm text-muted-foreground">
              {ar ? 'اختر الملعب ثم اضغط على اليوم لإضافة حجز.' : 'Choose a venue, then select a day to add a booking.'}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={selectedVenue?.id || ''} onValueChange={setSelectedVenueId}>
            <SelectTrigger className="w-full sm:w-56" data-testid="calendar-venue-select">
              <SelectValue placeholder={ar ? 'اختر الملعب' : 'Select venue'} />
            </SelectTrigger>
            <SelectContent>
              {venues.map(venue => (
                <SelectItem key={venue.id} value={venue.id}>
                  {venue.name}{venue.number ? ` · #${venue.number}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center justify-center gap-2">
            <Button type="button" variant="outline" size="icon" aria-label={ar ? 'الشهر السابق' : 'Previous month'} onClick={() => onMonthChange(-1)}>
              {ar ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
            <div className="min-w-36 text-center font-semibold capitalize">{formatter.format(month)}</div>
            <Button type="button" variant="outline" size="icon" aria-label={ar ? 'الشهر التالي' : 'Next month'} onClick={() => onMonthChange(1)}>
              {ar ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      <div className="p-3 sm:p-4">
        <div className="mb-1 grid grid-cols-7 gap-1">
          {WEEK_HEADERS[ar ? 'ar' : 'en'].map(day => (
            <div key={day} className="py-2 text-center text-xs font-semibold text-muted-foreground sm:text-sm">{day}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((date, index) => {
            if (!date) return <div key={`empty-${index}`} className="min-h-24 rounded-lg bg-muted/20 sm:min-h-32" aria-hidden="true" />;
            const key = toLocalDateKey(date);
            const slots = selectedVenue ? venueSlotsForDate(selectedVenue, date) : [];
            const isToday = key === today;
            return (
              <div
                key={key}
                role="button"
                tabIndex={0}
                aria-label={`${ar ? 'حجز يوم' : 'Book'} ${key} - ${selectedVenue?.name || ''}`}
                onClick={() => selectedVenue && onAddBooking(selectedVenue, key)}
                onKeyDown={event => {
                  if ((event.key === 'Enter' || event.key === ' ') && selectedVenue) {
                    event.preventDefault();
                    onAddBooking(selectedVenue, key);
                  }
                }}
                className={`group relative min-h-24 cursor-pointer rounded-lg border p-1.5 text-start transition-all hover:border-primary/50 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary sm:min-h-32 sm:p-2 ${
                  isToday ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'bg-card'
                }`}
              >
                <div className={`mb-1 text-xs font-semibold sm:text-sm ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                  {date.getDate()}
                </div>
                <div className="space-y-1">
                  {slots.map(slot => {
                    const reserved = isSlotReserved(slot.id) ||
                      (slot.start_date && slot.start_date === slot.end_date);
                    return (
                      <button
                        type="button"
                        key={slot.id}
                        onClick={event => {
                          event.stopPropagation();
                          onEditBooking(selectedVenue, slot);
                        }}
                        className={`block w-full rounded-md border px-1 py-1 text-start text-[10px] font-medium transition-colors sm:px-1.5 sm:text-xs ${
                          reserved
                            ? 'border-rose-300 bg-rose-100 text-rose-800'
                            : 'border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                        }`}
                      >
                        <span className="flex items-center gap-1" dir="ltr"><Clock3 className="hidden h-3 w-3 sm:block" />{slot.start_time}–{slot.end_time}</span>
                        {reserved && <span className="mt-0.5 block">{ar ? 'محجوز' : 'Reserved'}</span>}
                        {slot.total_cost !== undefined && slot.total_cost !== null && slot.total_cost !== '' &&
                          <span className="mt-0.5 block">{Number(slot.total_cost).toFixed(2)} {ar ? 'ر.س' : 'SAR'} · {slot.payment_status === 'paid' ? (ar ? 'مدفوع' : 'Paid') : (ar ? 'غير مدفوع' : 'Unpaid')}</span>}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  aria-label={`${ar ? 'إضافة حجز يوم' : 'Add booking for'} ${key}`}
                  onClick={event => {
                    event.stopPropagation();
                    if (selectedVenue) onAddBooking(selectedVenue, key);
                  }}
                  className="mt-1 flex min-h-7 w-full items-center justify-center rounded-md border border-dashed border-muted-foreground/25 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary sm:min-h-9 sm:text-xs"
                >
                  <Plus className="me-1 h-3 w-3" />{ar ? 'حجز' : 'Book'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t bg-muted/20 px-4 py-3 text-xs">
        <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">{ar ? 'فترة متاحة' : 'Available slot'}</Badge>
        <Badge className="border-rose-300 bg-rose-100 text-rose-800 hover:bg-rose-100">{ar ? 'موعد محجوز' : 'Reserved appointment'}</Badge>
      </div>
    </section>
  );
};

export default VenueMonthCalendar;