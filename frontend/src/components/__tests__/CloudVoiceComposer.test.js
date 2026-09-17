import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

import CloudVoiceComposer from '../CloudVoiceComposer';

const streamWithTrack = () => {
  const track = { stop: jest.fn() };
  return { getTracks: () => [track], track };
};

class Recorder {
  constructor(stream, options) {
    Recorder.lastInstance = this;
    this.stream = stream;
    this.mimeType = options.mimeType;
    this.state = 'inactive';
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    if (this.state !== 'recording') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['voice'], { type: this.mimeType }) });
    this.onstop?.();
  }
}
Recorder.isTypeSupported = jest.fn(type => type === 'audio/webm;codecs=opus');

const renderComposer = props => render(
  <CloudVoiceComposer
    conversationId="conversation-a"
    onSend={jest.fn().mockResolvedValue({ data: { success: true } })}
    t={(ar) => ar}
    {...props}
  />,
);

beforeEach(() => {
  jest.clearAllMocks();
  global.MediaRecorder = Recorder;
  navigator.mediaDevices = { getUserMedia: jest.fn() };
  URL.createObjectURL = jest.fn(() => 'blob:voice-preview');
  URL.revokeObjectURL = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
});

test('shows a permission error and never sends when microphone permission is denied', async () => {
  navigator.mediaDevices.getUserMedia.mockRejectedValue({ name: 'NotAllowedError' });
  const onSend = jest.fn();
  renderComposer({ onSend });

  fireEvent.click(screen.getByTestId('button-record-cloud-voice'));

  expect(await screen.findByRole('alert')).toHaveTextContent('تم رفض إذن الميكروفون');
  expect(onSend).not.toHaveBeenCalled();
});

test('records, stops into preview, and sends only after explicit confirmation as multipart audio', async () => {
  const stream = streamWithTrack();
  navigator.mediaDevices.getUserMedia.mockResolvedValue(stream);
  const onSend = jest.fn().mockResolvedValue({ data: { success: true } });
  renderComposer({ onSend });

  fireEvent.click(screen.getByTestId('button-record-cloud-voice'));
  await screen.findByTestId('button-stop-cloud-voice');
  fireEvent.click(screen.getByTestId('button-stop-cloud-voice'));

  expect(await screen.findByTestId('cloud-voice-preview')).toBeInTheDocument();
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('button-send-cloud-voice'));
  await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
  const [conversationId, formData] = onSend.mock.calls[0];
  expect(conversationId).toBe('conversation-a');
  expect(formData.get('audio')).toBeInstanceOf(Blob);
  expect(formData.get('audio').type).toBe('audio/webm;codecs=opus');
  expect(stream.track.stop).toHaveBeenCalled();
});

test('discarding a preview sends nothing and revokes its Blob URL', async () => {
  navigator.mediaDevices.getUserMedia.mockResolvedValue(streamWithTrack());
  const onSend = jest.fn();
  renderComposer({ onSend });

  fireEvent.click(screen.getByTestId('button-record-cloud-voice'));
  await screen.findByTestId('button-stop-cloud-voice');
  fireEvent.click(screen.getByTestId('button-stop-cloud-voice'));
  await screen.findByTestId('cloud-voice-preview');
  fireEvent.click(screen.getByTestId('button-discard-cloud-voice'));

  expect(onSend).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:voice-preview');
  expect(screen.queryByTestId('cloud-voice-preview')).not.toBeInTheDocument();
});

test('stops a late permission stream after the conversation changes', async () => {
  let resolvePermission;
  const latePermission = new Promise(resolve => { resolvePermission = resolve; });
  navigator.mediaDevices.getUserMedia.mockReturnValue(latePermission);
  const { rerender } = renderComposer();

  fireEvent.click(screen.getByTestId('button-record-cloud-voice'));
  rerender(
    <CloudVoiceComposer
      conversationId="conversation-b"
      onSend={jest.fn()}
      t={(ar) => ar}
    />,
  );
  const stream = streamWithTrack();
  await act(async () => { resolvePermission(stream); });

  expect(stream.track.stop).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('button-stop-cloud-voice')).not.toBeInTheDocument();
});

test('a stale permission rejection cannot stop a newer conversation stream', async () => {
  let rejectOldPermission;
  const oldPermission = new Promise((resolve, reject) => { rejectOldPermission = reject; });
  const newerStream = streamWithTrack();
  navigator.mediaDevices.getUserMedia
    .mockReturnValueOnce(oldPermission)
    .mockResolvedValueOnce(newerStream);
  const { rerender } = renderComposer();

  fireEvent.click(screen.getByTestId('button-record-cloud-voice'));
  rerender(
    <CloudVoiceComposer conversationId="conversation-b" onSend={jest.fn()} t={(ar) => ar} />,
  );
  fireEvent.click(screen.getByTestId('button-record-cloud-voice'));
  await screen.findByTestId('button-stop-cloud-voice');
  await act(async () => { rejectOldPermission({ name: 'NotAllowedError' }); });

  expect(newerStream.track.stop).not.toHaveBeenCalled();
  expect(screen.getByTestId('button-stop-cloud-voice')).toBeInTheDocument();
});

test('can cancel while recording and immediately releases microphone tracks', async () => {
  const stream = streamWithTrack();
  navigator.mediaDevices.getUserMedia.mockResolvedValue(stream);
  renderComposer();

  fireEvent.click(screen.getByTestId('button-record-cloud-voice'));
  await screen.findByTestId('button-stop-cloud-voice');
  fireEvent.click(screen.getByTestId('button-cancel-cloud-voice'));

  expect(stream.track.stop).toHaveBeenCalled();
  expect(screen.queryByTestId('cloud-voice-preview')).not.toBeInTheDocument();
  expect(screen.getByTestId('button-record-cloud-voice')).toBeInTheDocument();
});

test('can cancel while microphone permission is still pending', async () => {
  let resolvePermission;
  navigator.mediaDevices.getUserMedia.mockReturnValue(
    new Promise(resolve => { resolvePermission = resolve; }),
  );
  renderComposer();

  fireEvent.click(screen.getByTestId('button-record-cloud-voice'));
  expect(await screen.findByTestId('button-cancel-cloud-voice')).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('button-cancel-cloud-voice'));
  const lateStream = streamWithTrack();
  await act(async () => { resolvePermission(lateStream); });

  expect(lateStream.track.stop).toHaveBeenCalled();
  expect(screen.getByTestId('button-record-cloud-voice')).toBeInTheDocument();
});

test('recorder errors clear recording and release tracks without a preview', async () => {
  const stream = streamWithTrack();
  navigator.mediaDevices.getUserMedia.mockResolvedValue(stream);
  renderComposer();

  fireEvent.click(screen.getByTestId('button-record-cloud-voice'));
  await screen.findByTestId('button-stop-cloud-voice');
  act(() => { Recorder.lastInstance.onerror(new Event('error')); });

  expect(await screen.findByRole('alert')).toHaveTextContent('حدث خطأ أثناء التسجيل');
  expect(stream.track.stop).toHaveBeenCalled();
  expect(screen.queryByTestId('cloud-voice-preview')).not.toBeInTheDocument();
  expect(screen.getByTestId('button-record-cloud-voice')).toBeInTheDocument();
});

test('automatically stops at the 120-second maximum and leaves a preview', async () => {
  jest.useFakeTimers();
  navigator.mediaDevices.getUserMedia.mockResolvedValue(streamWithTrack());
  renderComposer();

  fireEvent.click(screen.getByTestId('button-record-cloud-voice'));
  await act(async () => {});
  await act(async () => { jest.advanceTimersByTime(120000); });

  expect(screen.getByTestId('cloud-voice-timer')).toHaveTextContent('02:00');
  expect(await screen.findByTestId('cloud-voice-preview')).toBeInTheDocument();
});

test('an uncertain network or 502 outcome locks the recording until it is discarded', async () => {
  navigator.mediaDevices.getUserMedia.mockResolvedValue(streamWithTrack());
  const onSend = jest.fn().mockRejectedValue({ response: { status: 502 } });
  renderComposer({ onSend });

  fireEvent.click(screen.getByTestId('button-record-cloud-voice'));
  await screen.findByTestId('button-stop-cloud-voice');
  fireEvent.click(screen.getByTestId('button-stop-cloud-voice'));
  await screen.findByTestId('cloud-voice-preview');
  fireEvent.click(screen.getByTestId('button-send-cloud-voice'));

  expect(await screen.findByRole('alert')).toHaveTextContent('تعذر تأكيد التسليم');
  expect(screen.getByTestId('button-send-cloud-voice')).toBeDisabled();
  fireEvent.click(screen.getByTestId('button-send-cloud-voice'));
  expect(onSend).toHaveBeenCalledTimes(1);
});