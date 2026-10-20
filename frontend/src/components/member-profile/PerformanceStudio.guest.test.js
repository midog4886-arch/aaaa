import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import PerformanceStudio from './PerformanceStudio';
import { memberVideoReviewsAPI } from '../../services/api';

jest.mock('../../services/api', () => ({ memberVideoReviewsAPI: { list: jest.fn() } }));

test('guest opens the full studio without calling member review endpoints', async () => {
  render(<PerformanceStudio member={{ id: 'guest' }} language="ar" canEdit guestMode />);
  await waitFor(() => expect(screen.getByText('افتح فيديو الزائر من جهازك لبدء التحليل.')).toBeTruthy());
  expect(screen.getByText('استوديو تحليل الأداء')).toBeTruthy();
  expect(screen.getByText('اسم الزائر (اختياري)')).toBeTruthy();
  expect(memberVideoReviewsAPI.list).not.toHaveBeenCalled();
});
