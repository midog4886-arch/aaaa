import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { useMemberCardPrint } from '../hooks/useMemberCardPrint';
import { getMemberQRValue } from '../../../utils/memberQR';
import { openPermanentMemberCardPrint } from '../../../utils/permanentMemberCard';
import { membersAPI } from '../../../services/api';

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('../../../services/branding', () => ({
  getAcademyLogoUrl: () => '/academy-logo.png',
  getAcademyName: () => 'Test Academy',
}));
jest.mock('../../../utils/memberQR', () => ({ getMemberQRValue: jest.fn((code) => `stable:${code}`) }));
jest.mock('../../../utils/permanentMemberCard', () => ({
  openPermanentMemberCardPrint: jest.fn(),
}));
jest.mock('../../../services/api', () => ({
  membersAPI: { getById: jest.fn() },
}));

const MEMBER = {
  id: 'member-1',
  name_ar: 'عضو الاختبار',
  member_code: 'GC-100',
  activities: [{
    activity_name: 'السباحة',
    start_date: '2030-01-01',
    end_date: '2030-02-01',
    schedule: 'Sunday 6pm',
  }],
};

describe('invoice permanent member-card print flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    membersAPI.getById.mockReset();
    openPermanentMemberCardPrint.mockReturnValue({ closed: false });
  });

  test('does not derive invoice dates or auto-print when opening an invoice card dialog', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const { result } = renderHook(() => useMemberCardPrint({ members: [MEMBER], language: 'ar' }));

    await act(async () => result.current.handleOpenCardPrint({
      member_id: MEMBER.id,
      items: [{
        activity_name: 'السباحة',
        start_date: '2031-01-01',
        end_date: '2031-02-01',
        schedule: 'Tuesday 8pm',
      }],
    }));

    expect(result.current.showCardPrintDialog).toBe(true);
    expect(result.current.cardPrintMember).toBe(MEMBER);
    expect(openPermanentMemberCardPrint).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test('prints only after explicit request with the established QR identity value', async () => {
    const { result } = renderHook(() => useMemberCardPrint({ members: [MEMBER], language: 'en' }));

    await act(async () => result.current.handleOpenCardPrint({ member_id: MEMBER.id, items: [] }));
    act(() => result.current.handleStickerPrint());

    expect(getMemberQRValue).toHaveBeenCalledWith('GC-100');
    expect(openPermanentMemberCardPrint).toHaveBeenCalledWith(expect.objectContaining({
      member: MEMBER,
      qrValue: 'stable:GC-100',
      logoUrl: '/academy-logo.png',
      academyName: 'Test Academy',
      language: 'en',
    }));
    expect(result.current.showCardPrintDialog).toBe(false);
  });

  test('keeps the dialog open and reports an error if the print popup is blocked', async () => {
    openPermanentMemberCardPrint.mockReturnValue(null);
    const { result } = renderHook(() => useMemberCardPrint({ members: [MEMBER], language: 'ar' }));

    await act(async () => result.current.handleOpenCardPrint({ member_id: MEMBER.id, items: [] }));
    act(() => result.current.handleStickerPrint());

    expect(result.current.showCardPrintDialog).toBe(true);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('تعذر فتح نافذة الطباعة'));
  });

  test('registration-form cards use only their linked member code and are never printed automatically', async () => {
    const { result } = renderHook(() => useMemberCardPrint({ members: [MEMBER], language: 'ar' }));

    await act(async () => result.current.handlePrintRegFormCard({
      member_id: MEMBER.id,
      customer_name: 'عضو جديد',
      customer_phone: '0500000000',
      member_code: 'FORM-CODE-77',
      form_number: 'FORM-77',
      items: [{
        start_date: '2031-01-01',
        end_date: '2031-02-01',
        schedule: 'Wednesday',
      }],
    }));

    expect(result.current.showRegFormCardPrintDialog).toBe(true);
    expect(result.current.regFormCardData).toEqual(expect.objectContaining({
      name_ar: MEMBER.name_ar,
      member_code: MEMBER.member_code,
    }));
    expect(result.current.regFormCardData).toBe(MEMBER);
    expect(openPermanentMemberCardPrint).not.toHaveBeenCalled();
  });

  test('fetches the exact missing linked member instead of matching a shared phone number', async () => {
    const otherMemberWithSamePhone = { ...MEMBER, id: 'member-other', member_code: 'GC-OTHER', phone: '0500000000' };
    const linkedMember = { ...MEMBER, id: 'member-linked', member_code: 'GC-LINKED', phone: '0500000000' };
    membersAPI.getById.mockResolvedValue({ data: linkedMember });
    const { result } = renderHook(() => useMemberCardPrint({ members: [otherMemberWithSamePhone], language: 'ar' }));

    await act(async () => result.current.handlePrintRegFormCard({
      member_id: 'member-linked',
      customer_phone: '0500000000',
      member_code: 'FORM-UNTRUSTED',
      form_number: 'FORM-77',
    }));

    expect(membersAPI.getById).toHaveBeenCalledWith('member-linked');
    expect(result.current.regFormCardData).toBe(linkedMember);
    expect(result.current.regFormCardData.member_code).toBe('GC-LINKED');
  });

  test('blocks records without a linked member or an issued member code', async () => {
    const { result } = renderHook(() => useMemberCardPrint({ members: [{ id: 'no-code', name_ar: 'بدون كود' }], language: 'ar' }));

    await act(async () => result.current.handleOpenCardPrint({ invoice_number: 'INV-1' }));
    expect(result.current.showCardPrintDialog).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('لا يوجد عضو مرتبط'));

    await act(async () => result.current.handlePrintRegFormCard({ member_id: 'no-code', form_number: 'FORM-1' }));
    expect(result.current.showRegFormCardPrintDialog).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('لم يصدر رقم عضوية'));
  });
});