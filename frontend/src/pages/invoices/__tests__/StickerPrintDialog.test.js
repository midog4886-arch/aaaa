import React from 'react';
import { render, screen } from '@testing-library/react';
import StickerPrintDialog, { openStickerPrint } from '../StickerPrintDialog';
import { fetchOriginalActivityDates } from '../cardDates';

jest.mock('../../../services/branding', () => ({
  getAcademyLogoUrl: () => '/academy-logo.png',
  getPrimaryColor: () => '#F97316',
}));
jest.mock('../cardDates', () => ({
  fetchOriginalActivityDates: jest.fn().mockResolvedValue({}),
  applyOriginalDates: (activities) => activities || [],
}));

const MEMBER = {
  id: 'member-1',
  member_code: 'GC-100',
  name_ar: 'عضو الاختبار',
  phone: '0500000000',
  activities: [{
    activity_name: 'السباحة',
    start_date: '2030-01-01',
    end_date: '2030-02-01',
    schedule: 'الأحد',
    status: 'active',
  }],
};

describe('invoice sticker card design', () => {
  test('dialog advertises the previous two landscape 9×6 stickers', () => {
    render(
      <StickerPrintDialog
        open
        onOpenChange={jest.fn()}
        member={MEMBER}
      />,
    );

    expect(screen.getByText('سيتم طباعة كرت العضوية + شعار الأكاديمية معاً')).toBeInTheDocument();
    expect(screen.getByText('📐 حجم كل كرت: 9سم × 6سم')).toBeInTheDocument();
    expect(screen.getByText('خانة 1')).toBeInTheDocument();
    expect(screen.getByText('خانة 2')).toBeInTheDocument();
    expect(screen.queryByText(/CR-80|بطاقة عضوية دائمة/)).not.toBeInTheDocument();
  });

  test('print document contains subscription dates and the landscape dimensions', async () => {
    const document = {
      open: jest.fn(),
      write: jest.fn(),
      close: jest.fn(),
    };
    const popup = { document, closed: false };
    const openSpy = jest.spyOn(window, 'open').mockReturnValue(popup);

    expect(openStickerPrint(MEMBER)).toBe(popup);
    await Promise.resolve();
    await Promise.resolve();

    const printedHTML = document.write.mock.calls.map(([html]) => html).join('');
    expect(fetchOriginalActivityDates).toHaveBeenCalledWith(MEMBER.id);
    expect(printedHTML).toContain('width: 90mm');
    expect(printedHTML).toContain('height: 60mm');
    expect(printedHTML).toContain('2030-01-01');
    expect(printedHTML).toContain('2030-02-01');
    expect(printedHTML).not.toContain('CR-80');

    openSpy.mockRestore();
  });
});