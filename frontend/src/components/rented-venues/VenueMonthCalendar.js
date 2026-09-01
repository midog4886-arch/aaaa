import React from 'react';
import { ChevronLeft, ChevronRight, Clock3, Plus } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { monthDates, toLocalDateKey, venueSlotsForDate } from '../../utils/rentedVenues';

const VenueMonthCalendar = ({
  ar,
  month,
  venues,
  isSlotReserved,
  onMonthChange,
  onAddBooking,
  onEditBooking,
}) => {
  const dates = monthDates(month);
  const today = toLocalDateKey(new Date());
  const formatter = new Intl.DateTimeFormat(ar ? 'ar-SA' : 'en-US', {
    month: 'long',
    year: 'numeric',
  });
  const dayFormatter = new Intl.DateTimeFormat(ar ? 'ar-SA' : 'en-US', {
    weekday: 'short',
  });

  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm" data-testid="venue-month-calendar">
      <div className="flex flex-col gap-3 border-b bg-muted/25 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold">{ar ? 'جدول الحجز الشهري' : 'Monthly booking calendar'}</h2>
          <p className="text-sm text-muted-foreground">
            {ar ? 'اضغط على أي يوم لحجز ساعة ومنع تداخل المواعيد.' : 'Choose any day to reserve a time and prevent overlapping appointments.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" aria-label={ar ? 'الشهر السابق' : 'Previous month'} onClick={() => onMonthChange(-1)}>
            {ar ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
          <div className="min-w-36 text-center font-semibold capitalize">{formatter.format(month)}</div>
          <Button type="button" variant="outline" size="icon" aria-label={ar ? 'الشهر التالي' : 'Next month'} onClick={() => onMonthChange(1)}>
            {ar ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[980px]">
          <div className="grid border-b bg-muted/40" style={{ gridTemplateColumns: `160px repeat(${dates.length}, minmax(96px, 1fr))` }}>
            <div className="sticky start-0 z-20 border-e bg-muted px-3 py-3 font-semibold">{ar ? 'الملعب' : 'Venue'}</div>
            {dates.map(date => {
              const key = toLocalDateKey(date);
              return (
                <div key={key} className={`border-e px-2 py-2 text-center ${key === today ? 'bg-primary/10 text-primary' : ''}`}>
                  <div className="text-xs text-muted-foreground">{dayFormatter.format(date)}</div>
                  <div className="text-base font-bold">{date.getDate()}</div>
                </div>
              );
            })}
          </div>

          {venues.map(venue => (
            <div key={venue.id} className="grid border-b last:border-b-0" style={{ gridTemplateColumns: `160px repeat(${dates.length}, minmax(96px, 1fr))` }}>
              <div className="sticky start-0 z-10 border-e bg-card px-3 py-3">
                <div className="font-semibold">{venue.name}</div>
                {venue.number && <div className="text-xs text-muted-foreground">#{venue.number}</div>}
              </div>
              {dates.map(date => {
                const key = toLocalDateKey(date);
                const slots = venueSlotsForDate(venue, date);
                return (
                  <div
                    key={key}
                    role="button"
                    tabIndex={0}
                    aria-label={`${ar ? 'حجز يوم' : 'Book'} ${key} - ${venue.name}`}
                    onClick={() => onAddBooking(venue, key)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onAddBooking(venue, key);
                      }
                    }}
                    className="group min-h-24 cursor-pointer border-e p-1.5 transition-colors hover:bg-emerald-50/80 focus:bg-emerald-50/80 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-500"
                  >
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
                              onEditBooking(venue, slot);
                            }}
                            className={`block w-full rounded-md border px-1.5 py-1 text-start text-[11px] font-medium transition-colors ${
                              reserved
                                ? 'border-rose-300 bg-rose-100 text-rose-800'
                                : 'border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            }`}
                            title={`${slot.start_time} - ${slot.end_time}`}
                          >
                            <span className="flex items-center gap-1" dir="ltr"><Clock3 className="h-3 w-3" />{slot.start_time}–{slot.end_time}</span>
                            {reserved && <span className="mt-0.5 block">{ar ? 'محجوز' : 'Reserved'}</span>}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={event => {
                        event.stopPropagation();
                        onAddBooking(venue, key);
                      }}
                      className="mt-1 flex w-full items-center justify-center rounded-md border border-dashed border-emerald-300 bg-emerald-50/60 py-1 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                    >
                      <Plus className="me-1 h-3 w-3" />{ar ? 'حجز' : 'Book'}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
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