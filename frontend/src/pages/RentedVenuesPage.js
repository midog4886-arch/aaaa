import React, { useEffect, useMemo, useState } from 'react';
import { Layout } from '../components/Layout';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { branchesAPI, levelsAPI } from '../services/api';
import { toast } from 'sonner';
import { CalendarDays, Clock3, Edit, Loader2, MapPin, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { WEEKDAYS, branchVenues, emptyVenue, normalizeVenue, serializeVenues, venueState } from '../utils/rentedVenues';
import { slotsOverlap, weekdayIdForDate } from '../utils/rentedVenues';
import VenueMonthCalendar from '../components/rented-venues/VenueMonthCalendar';

const errorText = (error, fallback) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(item => item.msg).filter(Boolean).join('، ') || fallback;
  return fallback;
};

const stateStyle = {
  available: { variant: 'secondary', ar: 'متاح', en: 'Available' },
  reserved: { variant: 'default', ar: 'محجوز', en: 'Reserved' },
  expired: { variant: 'destructive', ar: 'منتهي', en: 'Expired' },
};

const RentedVenuesPage = () => {
  const { language } = useLanguage();
  const { user } = useAuth();
  const ar = language === 'ar';
  const [branches, setBranches] = useState([]);
  const [levels, setLevels] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [form, setForm] = useState(emptyVenue);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [bookingDialog, setBookingDialog] = useState(null);
  const [bookingForm, setBookingForm] = useState({
    date: '', start_time: '18:00', end_time: '19:00',
    hourly_rate: '', payment_status: 'unpaid', payment_method: 'cash',
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [branchResponse, levelResponse] = await Promise.all([
        branchesAPI.getAll(),
        levelsAPI.getAll(),
      ]);
      const nextBranches = Array.isArray(branchResponse.data) ? branchResponse.data : [];
      setBranches(nextBranches);
      setLevels(Array.isArray(levelResponse.data) ? levelResponse.data : []);
      setSelectedBranchId(current => nextBranches.some(branch => branch.id === current)
        ? current
        : (nextBranches[0]?.id || ''));
    } catch (error) {
      toast.error(errorText(error, ar ? 'تعذر تحميل بيانات الملاعب' : 'Could not load venue data'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const branch = branches.find(item => item.id === selectedBranchId);
  useEffect(() => {
    if (!selectedBranchId) return;
    branchesAPI.getVenues(selectedBranchId)
      .then(response => setBranches(current => current.map(item =>
        item.id === selectedBranchId ? { ...item, venues: response.data || [] } : item
      )))
      .catch(error => toast.error(errorText(error, ar ? 'تعذر تحميل ملاعب الفرع' : 'Could not load branch venues')));
  }, [selectedBranchId]); // eslint-disable-line react-hooks/exhaustive-deps

  const venues = useMemo(() => branchVenues(branch).map(normalizeVenue), [branch]);
  const branchLevels = useMemo(
    () => levels.filter(level => level.branch_id === selectedBranchId),
    [levels, selectedBranchId]
  );
  const activeVenueReferenced = venueId => Boolean(venueId) &&
    branchLevels.some(level => level.is_active !== false && level.venue_id === venueId);
  const activeSlotReferenced = slotId => Boolean(slotId) &&
    branchLevels.some(level => level.is_active !== false && level.booking_slot_id === slotId);

  const summaries = venues.reduce((result, venue) => {
    result[venueState(venue, branchLevels)] += 1;
    return result;
  }, { available: 0, reserved: 0, expired: 0 });

  const openAdd = () => {
    setEditingIndex(null);
    setForm(emptyVenue());
    setDialogOpen(true);
  };
  const openEdit = index => {
    setEditingIndex(index);
    setForm(normalizeVenue(venues[index]));
    setDialogOpen(true);
  };
  const updateSlot = (index, patch) => setForm(current => ({
    ...current,
    booking_slots: current.booking_slots.map((slot, slotIndex) =>
      slotIndex === index ? { ...slot, ...patch } : slot
    ),
  }));
  const addSlot = () => setForm(current => ({
    ...current,
    booking_slots: [...current.booking_slots, {
      id: '',
      weekday: 'saturday',
      start_time: '18:00',
      end_time: '19:00',
      start_date: current.contract_start_date,
      end_date: current.contract_end_date,
      cost: current.cost,
      cost_type: current.cost_type,
    }],
  }));

  const putVenues = async nextVenues => {
    const response = await branchesAPI.updateVenues(branch.id, serializeVenues(nextVenues));
    setBranches(current => current.map(item =>
      item.id === branch.id ? { ...item, venues: response.data || [] } : item
    ));
  };

  const openCalendarBooking = (venue, date) => {
    setBookingForm({
      date,
      start_time: '18:00',
      end_time: '19:00',
      hourly_rate: venue.cost ?? '',
      payment_status: 'unpaid',
      payment_method: 'cash',
    });
    setBookingDialog({ venueId: venue.id, slotId: null });
  };

  const openCalendarSlot = (venue, slot) => {
    if (activeSlotReferenced(slot.id)) {
      toast.info(ar ? 'هذا الموعد مرتبط بمستوى نشط ولا يمكن تعديله' : 'This appointment is linked to an active level and cannot be edited');
      return;
    }
    if (slot.start_date !== slot.end_date) {
      toast.info(ar ? 'هذه فترة أسبوعية متكررة؛ عدّلها من بيانات الملعب' : 'This is a recurring weekly slot; edit it from the venue details');
      return;
    }
    setBookingForm({
      date: slot.start_date,
      start_time: slot.start_time,
      end_time: slot.end_time,
      hourly_rate: slot.hourly_rate ?? slot.cost ?? venue.cost ?? '',
      payment_status: slot.payment_status || 'unpaid',
      payment_method: slot.payment_method || 'cash',
    });
    setBookingDialog({ venueId: venue.id, slotId: slot.id });
  };

  const saveCalendarBooking = async event => {
    event.preventDefault();
    const venue = venues.find(item => item.id === bookingDialog?.venueId);
    if (!venue || !bookingForm.date || !bookingForm.start_time || !bookingForm.end_time ||
        bookingForm.hourly_rate === '' || Number(bookingForm.hourly_rate) < 0 ||
        bookingForm.end_time === bookingForm.start_time) {
      toast.error(ar ? 'تحقق من تاريخ ووقت الحجز' : 'Check the booking date and time');
      return;
    }
    const [startTime, endTime] = bookingForm.start_time < bookingForm.end_time
      ? [bookingForm.start_time, bookingForm.end_time]
      : [bookingForm.end_time, bookingForm.start_time];
    const dateObject = new Date(`${bookingForm.date}T12:00:00`);
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);
    const durationHours = ((endHour * 60 + endMinute) - (startHour * 60 + startMinute)) / 60;
    const hourlyRate = Number(bookingForm.hourly_rate);
    const candidate = {
      id: bookingDialog.slotId || '',
      weekday: weekdayIdForDate(dateObject),
      start_time: startTime,
      end_time: endTime,
      start_date: bookingForm.date,
      end_date: bookingForm.date,
      cost: hourlyRate,
      cost_type: 'hourly',
      hourly_rate: hourlyRate,
      duration_hours: Number(durationHours.toFixed(2)),
      total_cost: Number((durationHours * hourlyRate).toFixed(2)),
      payment_status: bookingForm.payment_status,
      payment_method: bookingForm.payment_status === 'paid' ? bookingForm.payment_method : '',
    };
    if (venue.booking_slots.some(slot => slot.id !== bookingDialog.slotId && slotsOverlap(slot, candidate))) {
      toast.error(ar ? 'هذه الساعة محجوزة أو تتداخل مع موعد آخر في نفس الملعب' : 'This time overlaps another booking in the same venue');
      return;
    }
    setSaving(true);
    try {
      const next = venues.map(item => item.id !== venue.id ? item : {
        ...item,
        booking_slots: bookingDialog.slotId
          ? item.booking_slots.map(slot => slot.id === bookingDialog.slotId ? candidate : slot)
          : [...item.booking_slots, candidate],
      });
      await putVenues(next);
      toast.success(ar ? 'تم حجز الموعد' : 'Appointment booked');
      setBookingDialog(null);
    } catch (error) {
      toast.error(errorText(error, ar ? 'تعذر حفظ الحجز' : 'Could not save booking'));
    } finally {
      setSaving(false);
    }
  };

  const removeCalendarBooking = async () => {
    const venue = venues.find(item => item.id === bookingDialog?.venueId);
    if (!venue || !bookingDialog?.slotId || activeSlotReferenced(bookingDialog.slotId)) return;
    setSaving(true);
    try {
      await putVenues(venues.map(item => item.id !== venue.id ? item : {
        ...item,
        booking_slots: item.booking_slots.filter(slot => slot.id !== bookingDialog.slotId),
      }));
      toast.success(ar ? 'تم إلغاء الحجز' : 'Booking cancelled');
      setBookingDialog(null);
    } catch (error) {
      toast.error(errorText(error, ar ? 'تعذر إلغاء الحجز' : 'Could not cancel booking'));
    } finally {
      setSaving(false);
    }
  };

  const bookingPrice = useMemo(() => {
    if (!bookingForm.start_time || !bookingForm.end_time || bookingForm.start_time === bookingForm.end_time) {
      return { hours: 0, total: 0 };
    }
    const [from, to] = bookingForm.start_time < bookingForm.end_time
      ? [bookingForm.start_time, bookingForm.end_time]
      : [bookingForm.end_time, bookingForm.start_time];
    const [fromHour, fromMinute] = from.split(':').map(Number);
    const [toHour, toMinute] = to.split(':').map(Number);
    const hours = ((toHour * 60 + toMinute) - (fromHour * 60 + fromMinute)) / 60;
    return { hours, total: hours * Number(bookingForm.hourly_rate || 0) };
  }, [bookingForm.start_time, bookingForm.end_time, bookingForm.hourly_rate]);

  const validate = () => {
    if (!form.name.trim() || !form.contract_start_date || !form.contract_end_date ||
        form.cost === '' || Number(form.cost) < 0 || Number(form.warning_days) < 0 ||
        form.booking_slots.length === 0) {
      return ar ? 'أكمل بيانات الملعب وأضف فترة حجز واحدة على الأقل' : 'Complete venue details and add at least one booking slot';
    }
    if (form.contract_end_date < form.contract_start_date ||
        form.booking_slots.some(slot => !slot.weekday || !slot.start_time || !slot.end_time || slot.end_time <= slot.start_time)) {
      return ar ? 'تحقق من تواريخ العقد وأوقات الحجز' : 'Check contract dates and booking times';
    }
    const overlaps = form.booking_slots.some((left, index) => form.booking_slots.slice(index + 1).some(right =>
      left.weekday === right.weekday && left.start_time < right.end_time && right.start_time < left.end_time
    ));
    return overlaps ? (ar ? 'لا يمكن أن تتداخل فترات الحجز في اليوم نفسه' : 'Booking slots on the same day cannot overlap') : '';
  };

  const saveVenue = async event => {
    event.preventDefault();
    const validationError = validate();
    if (validationError) { toast.error(validationError); return; }
    setSaving(true);
    try {
      const next = editingIndex === null
        ? [...venues, form]
        : venues.map((venue, index) => index === editingIndex ? form : venue);
      await putVenues(next);
      toast.success(ar ? 'تم حفظ الملعب' : 'Venue saved');
      setDialogOpen(false);
    } catch (error) {
      toast.error(errorText(error, ar ? 'تعذر حفظ الملعب' : 'Could not save venue'));
    } finally {
      setSaving(false);
    }
  };

  const removeVenue = async index => {
    const venue = venues[index];
    if (activeVenueReferenced(venue.id)) return;
    if (!window.confirm(ar ? 'هل تريد حذف هذا الملعب؟' : 'Delete this venue?')) return;
    setSaving(true);
    try {
      await putVenues(venues.filter((_, itemIndex) => itemIndex !== index));
      toast.success(ar ? 'تم حذف الملعب' : 'Venue deleted');
    } catch (error) {
      toast.error(errorText(error, ar ? 'تعذر حذف الملعب' : 'Could not delete venue'));
    } finally {
      setSaving(false);
    }
  };

  if (!user?.is_admin) return <Layout><div className="py-16 text-center text-muted-foreground">{ar ? 'ليس لديك صلاحية الوصول لهذه الصفحة' : 'You do not have access to this page'}</div></Layout>;

  return (
    <Layout>
      <div className="space-y-6" dir={ar ? 'rtl' : 'ltr'}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">{ar ? 'الملاعب المستأجرة' : 'Rented Venues'}</h1>
            <p className="text-muted-foreground">{ar ? 'إدارة عقود الملاعب وفترات الحجز المرتبطة بالفروع' : 'Manage venue contracts and weekly booking slots attached to branches'}</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
              <SelectTrigger className="w-full sm:w-64" data-testid="venue-branch-select"><SelectValue placeholder={ar ? 'اختر الفرع' : 'Select branch'} /></SelectTrigger>
              <SelectContent>{branches.map(item => <SelectItem key={item.id} value={item.id}>{item.name_ar || item.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        {loading ? <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> : !branch ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">{ar ? 'لا توجد فروع متاحة' : 'No branches available'}</CardContent></Card>
         ) : <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {Object.entries(stateStyle).map(([key, style]) => (
              <Card key={key}><CardContent className="flex items-center justify-between p-4"><span className="text-sm text-muted-foreground">{ar ? style.ar : style.en}</span><span className="text-2xl font-bold">{summaries[key]}</span></CardContent></Card>
            ))}
          </div>
           {venues.length > 0 && (
             <VenueMonthCalendar
               ar={ar}
               month={calendarMonth}
               venues={venues}
               isSlotReserved={activeSlotReferenced}
               onMonthChange={offset => setCalendarMonth(current => new Date(current.getFullYear(), current.getMonth() + offset, 1))}
               onAddBooking={openCalendarBooking}
               onEditBooking={openCalendarSlot}
             />
           )}
          <section className="space-y-4" data-testid="venue-management-section">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-bold">{ar ? 'إضافة وإدارة الملاعب' : 'Add and manage venues'}</h2>
                <p className="text-sm text-muted-foreground">
                  {ar ? 'أضف بيانات الملعب والعقد هنا، واستخدم الجدول بالأعلى لإدارة الحجوزات.' : 'Add venue and contract details here, and use the calendar above for bookings.'}
                </p>
              </div>
              <Button onClick={openAdd} disabled={!branch || saving}><Plus className="me-2 h-4 w-4" />{ar ? 'إضافة ملعب جديد' : 'Add new venue'}</Button>
            </div>
          {venues.length === 0 ? (
            <Card><CardContent className="flex flex-col items-center py-12 text-center"><MapPin className="mb-3 h-10 w-10 text-muted-foreground" /><p className="font-medium">{ar ? 'لا توجد ملاعب مستأجرة لهذا الفرع' : 'No rented venues for this branch'}</p><Button className="mt-4" onClick={openAdd}><Plus className="me-2 h-4 w-4" />{ar ? 'إضافة أول ملعب' : 'Add first venue'}</Button></CardContent></Card>
          ) : <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {venues.map((venue, index) => {
              const status = venueState(venue, branchLevels);
              const style = stateStyle[status];
              const locked = activeVenueReferenced(venue.id);
              return <Card key={venue.id || index} data-testid={`rented-venue-card-${venue.id || index}`}>
                <CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div><CardTitle>{venue.name}{venue.number ? ` · #${venue.number}` : ''}</CardTitle>{venue.size && <p className="mt-1 text-sm text-muted-foreground">{venue.size} m²</p>}</div><Badge variant={style.variant}>{ar ? style.ar : style.en}</Badge></div></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-sm">
                    <div><span className="block text-muted-foreground">{ar ? 'العقد' : 'Contract'}</span>{venue.contract_start_date} → {venue.contract_end_date}</div>
                    <div><span className="block text-muted-foreground">{ar ? 'التكلفة' : 'Cost'}</span>{venue.cost} {ar ? 'ر.س' : 'SAR'} · {venue.cost_type}</div>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3 text-sm">
                    <span className="flex items-center gap-2 text-muted-foreground"><CalendarDays className="h-4 w-4" />{ar ? 'الحجوزات تظهر في الجدول الشهري بالأعلى' : 'Bookings appear in the monthly calendar above'}</span>
                    <Badge variant="secondary">{venue.booking_slots.length}</Badge>
                  </div>
                  {locked && <p className="flex items-center gap-2 text-xs text-amber-700"><TriangleAlert className="h-4 w-4" />{ar ? 'مرتبط بمستوى نشط؛ بيانات الحجز والحذف مقفلة.' : 'Linked to an active level; booking details and deletion are locked.'}</p>}
                  <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => openEdit(index)}><Edit className="me-1 h-4 w-4" />{ar ? 'تعديل' : 'Edit'}</Button><Button variant="outline" size="sm" className="text-red-600" disabled={locked || saving} onClick={() => removeVenue(index)}><Trash2 className="me-1 h-4 w-4" />{ar ? 'حذف' : 'Delete'}</Button></div>
                </CardContent>
              </Card>;
            })}
          </div>}
          </section>
        </>}

        <Dialog open={Boolean(bookingDialog)} onOpenChange={open => !open && setBookingDialog(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>{bookingDialog?.slotId ? (ar ? 'تعديل الحجز' : 'Edit booking') : (ar ? 'حجز ساعة' : 'Book a time')}</DialogTitle></DialogHeader>
            <form onSubmit={saveCalendarBooking} className="space-y-4">
              <div className="space-y-1"><Label>{ar ? 'التاريخ' : 'Date'}</Label><Input type="date" value={bookingForm.date} onChange={event => setBookingForm(current => ({ ...current, date: event.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>{ar ? 'من الساعة' : 'From'}</Label><Input type="time" value={bookingForm.start_time} onChange={event => setBookingForm(current => ({ ...current, start_time: event.target.value }))} /></div>
                <div className="space-y-1"><Label>{ar ? 'إلى الساعة' : 'To'}</Label><Input type="time" value={bookingForm.end_time} onChange={event => setBookingForm(current => ({ ...current, end_time: event.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>{ar ? 'سعر الساعة' : 'Hourly rate'}</Label>
                  <div className="relative">
                    <Input type="number" min="0" step="0.01" value={bookingForm.hourly_rate} onChange={event => setBookingForm(current => ({ ...current, hourly_rate: event.target.value }))} />
                    <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted-foreground">{ar ? 'ر.س' : 'SAR'}</span>
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <span className="block text-xs text-muted-foreground">{ar ? 'المدة والإجمالي' : 'Duration and total'}</span>
                  <strong className="mt-1 block text-lg">{bookingPrice.hours.toFixed(2)} {ar ? 'ساعة' : 'hours'} · {bookingPrice.total.toFixed(2)} {ar ? 'ر.س' : 'SAR'}</strong>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>{ar ? 'حالة الدفع' : 'Payment status'}</Label>
                  <Select value={bookingForm.payment_status} onValueChange={value => setBookingForm(current => ({ ...current, payment_status: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unpaid">{ar ? 'غير مدفوع' : 'Unpaid'}</SelectItem>
                      <SelectItem value="paid">{ar ? 'تم الدفع' : 'Paid'}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {bookingForm.payment_status === 'paid' && <div className="space-y-1">
                  <Label>{ar ? 'طريقة الدفع' : 'Payment method'}</Label>
                  <Select value={bookingForm.payment_method} onValueChange={value => setBookingForm(current => ({ ...current, payment_method: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">{ar ? 'نقداً' : 'Cash'}</SelectItem>
                      <SelectItem value="card">{ar ? 'بطاقة / شبكة' : 'Card'}</SelectItem>
                      <SelectItem value="transfer">{ar ? 'تحويل بنكي' : 'Bank transfer'}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>}
              </div>
              <DialogFooter className="gap-2">
                {bookingDialog?.slotId && <Button type="button" variant="destructive" onClick={removeCalendarBooking} disabled={saving}>{ar ? 'إلغاء الحجز' : 'Cancel booking'}</Button>}
                <Button type="button" variant="outline" onClick={() => setBookingDialog(null)}>{ar ? 'رجوع' : 'Back'}</Button>
                <Button type="submit" disabled={saving}>{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{ar ? 'حفظ الحجز' : 'Save booking'}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="flex max-h-[92vh] w-[96vw] max-w-3xl flex-col p-0">
            <DialogHeader className="px-6 pt-6"><DialogTitle>{editingIndex === null ? (ar ? 'إضافة ملعب مستأجر' : 'Add rented venue') : (ar ? 'تعديل الملعب' : 'Edit venue')}</DialogTitle></DialogHeader>
            <form onSubmit={saveVenue} className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 space-y-5 overflow-y-auto px-6 py-2">
                {activeVenueReferenced(form.id) && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">{ar ? 'يمكن تعديل الاسم والتكلفة والتنبيه فقط. أوقف المستوى أو غيّر حجزه لتعديل العقد والفترات.' : 'Only name, cost and warning can be edited. Deactivate or reassign the level to change the contract or slots.'}</div>}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1 sm:col-span-2"><Label>{ar ? 'اسم الملعب' : 'Venue name'} *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                  <div className="space-y-1"><Label>{ar ? 'رقم الملعب' : 'Venue number'}</Label><Input value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} /></div>
                  <div className="space-y-1"><Label>{ar ? 'المساحة (م²)' : 'Size (m²)'}</Label><Input value={form.size} onChange={e => setForm({ ...form, size: e.target.value })} /></div>
                  <div className="space-y-1"><Label>{ar ? 'بداية العقد' : 'Contract start'} *</Label><Input type="date" disabled={activeVenueReferenced(form.id)} value={form.contract_start_date} onChange={e => setForm({ ...form, contract_start_date: e.target.value, booking_slots: form.booking_slots.map(slot => ({ ...slot, start_date: e.target.value })) })} /></div>
                  <div className="space-y-1"><Label>{ar ? 'نهاية العقد' : 'Contract end'} *</Label><Input type="date" disabled={activeVenueReferenced(form.id)} min={form.contract_start_date} value={form.contract_end_date} onChange={e => setForm({ ...form, contract_end_date: e.target.value, booking_slots: form.booking_slots.map(slot => ({ ...slot, end_date: e.target.value })) })} /></div>
                  <div className="space-y-1"><Label>{ar ? 'التكلفة' : 'Cost'} *</Label><Input type="number" min="0" step="0.01" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value, booking_slots: form.booking_slots.map(slot => ({ ...slot, cost: e.target.value })) })} /></div>
                  <div className="space-y-1"><Label>{ar ? 'نوع التكلفة' : 'Cost type'}</Label><Select value={form.cost_type} onValueChange={value => setForm({ ...form, cost_type: value, booking_slots: form.booking_slots.map(slot => ({ ...slot, cost_type: value })) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="hourly">{ar ? 'بالساعة' : 'Hourly'}</SelectItem><SelectItem value="period">{ar ? 'للفترة' : 'Period'}</SelectItem><SelectItem value="monthly">{ar ? 'شهري' : 'Monthly'}</SelectItem></SelectContent></Select></div>
                  <div className="space-y-1"><Label>{ar ? 'التنبيه قبل (يوم)' : 'Warning days'}</Label><Input type="number" min="0" value={form.warning_days} onChange={e => setForm({ ...form, warning_days: e.target.value })} /></div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between"><div><Label className="font-semibold">{ar ? 'فترات الحجز الأسبوعية' : 'Weekly booking slots'}</Label><p className="text-xs text-muted-foreground">{ar ? 'يمكن إضافة أكثر من فترة في اليوم.' : 'Multiple slots can be added on the same day.'}</p></div><Button type="button" variant="outline" size="sm" onClick={addSlot}><Plus className="me-1 h-4 w-4" />{ar ? 'إضافة فترة' : 'Add slot'}</Button></div>
                  {form.booking_slots.map((slot, index) => {
                    const locked = activeSlotReferenced(slot.id);
                    return <div key={slot.id || index} className="grid grid-cols-1 items-end gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                      <div className="space-y-1"><Label>{ar ? 'اليوم' : 'Day'}</Label><Select disabled={locked} value={slot.weekday} onValueChange={value => updateSlot(index, { weekday: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{WEEKDAYS.map(day => <SelectItem key={day.id} value={day.id}>{ar ? day.ar : day.en}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-1"><Label>{ar ? 'من' : 'From'}</Label><Input type="time" disabled={locked} value={slot.start_time} onChange={e => updateSlot(index, { start_time: e.target.value })} /></div>
                      <div className="space-y-1"><Label>{ar ? 'إلى' : 'To'}</Label><Input type="time" disabled={locked} value={slot.end_time} onChange={e => updateSlot(index, { end_time: e.target.value })} /></div>
                      <Button type="button" variant="ghost" size="icon" className="text-red-600" disabled={locked} onClick={() => setForm(current => ({ ...current, booking_slots: current.booking_slots.filter((_, slotIndex) => slotIndex !== index) }))}><Trash2 className="h-4 w-4" /></Button>
                    </div>;
                  })}
                  {!form.booking_slots.length && <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"><Clock3 className="mx-auto mb-2 h-6 w-6" />{ar ? 'أضف فترة حجز واحدة على الأقل' : 'Add at least one booking slot'}</div>}
                </div>
              </div>
              <DialogFooter className="border-t px-6 py-4"><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>{ar ? 'إلغاء' : 'Cancel'}</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{ar ? 'حفظ' : 'Save'}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
};

export default RentedVenuesPage;