import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ChatMessageViewport from './ChatMessageViewport';

test('opens at the latest message, follows updates and media, but preserves manual scrolling', () => {
  const height = jest.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1200);
  const client = jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(520);
  const { rerender } = render(<ChatMessageViewport key="a">Messages</ChatMessageViewport>);
  const viewport = screen.getByTestId('chat-message-viewport');
  expect(viewport.scrollTop).toBe(1200);
  viewport.scrollTop = 680;
  fireEvent.scroll(viewport);
  height.mockReturnValue(1400);
  rerender(<ChatMessageViewport key="a">New message<img alt="attachment" /></ChatMessageViewport>);
  expect(viewport.scrollTop).toBe(1400);
  height.mockReturnValue(1600);
  fireEvent.load(screen.getByAltText('attachment'));
  expect(viewport.scrollTop).toBe(1600);

  viewport.scrollTop = 100;
  fireEvent.scroll(viewport);
  rerender(<ChatMessageViewport key="a">Polled messages</ChatMessageViewport>);
  expect(viewport.scrollTop).toBe(100);
  rerender(<ChatMessageViewport key="b">Another chat</ChatMessageViewport>);
  expect(screen.getByTestId('chat-message-viewport').scrollTop).toBe(1600);
  height.mockRestore();
  client.mockRestore();
});