import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import GuestPerformanceStudio from './GuestPerformanceStudio';

test('opens a guest video locally without requiring a member', () => {
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn(() => 'blob:guest-video');
  URL.revokeObjectURL = jest.fn();
  try {
    const { container, unmount } = render(<GuestPerformanceStudio language="ar" />);
    const file = new File(['video'], 'guest.mp4', { type: 'video/mp4' });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
    expect(screen.getByText('guest.mp4')).toBeTruthy();
    expect(container.querySelector('video').getAttribute('src')).toBe('blob:guest-video');
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:guest-video');
  } finally {
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
  }
});
