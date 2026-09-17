jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
      post: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
    },
  },
}));

import axios from 'axios';
import { whatsappAPI } from '../api';

beforeEach(() => {
  jest.clearAllMocks();
});

test('adds needs_reply_only only when the optional inbox filter is selected', () => {
  whatsappAPI.getCloudInboxConversations('branch-a', false, true);

  expect(axios.get).toHaveBeenCalledWith(
    '/api/whatsapp/cloud-inbox/conversations?branch_filter=branch-a&needs_reply_only=true',
  );
});

test('preserves the existing all and unread inbox query behavior', () => {
  whatsappAPI.getCloudInboxConversations('branch-a', false);
  whatsappAPI.getCloudInboxConversations('branch-a', true);

  expect(axios.get).toHaveBeenNthCalledWith(
    1,
    '/api/whatsapp/cloud-inbox/conversations?branch_filter=branch-a',
  );
  expect(axios.get).toHaveBeenNthCalledWith(
    2,
    '/api/whatsapp/cloud-inbox/conversations?branch_filter=branch-a&unread_only=true',
  );
});

test('sends cloud inbox voice as the documented multipart audio field', () => {
  const formData = new FormData();
  formData.append('audio', new Blob(['voice'], { type: 'audio/webm;codecs=opus' }));

  whatsappAPI.sendCloudInboxVoice('branch-a:9665', formData);

  expect(axios.post).toHaveBeenCalledWith(
    '/api/whatsapp/cloud-inbox/conversations/branch-a%3A9665/voice',
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
});