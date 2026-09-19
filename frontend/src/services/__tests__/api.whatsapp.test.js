jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
      post: jest.fn(),
      delete: jest.fn(),
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

test('uses the dedicated archive and text recovery endpoints', () => {
  whatsappAPI.retryCloudInboxMediaArchive('message/a');
  whatsappAPI.recoverCloudInboxMessageText('message/a');
  whatsappAPI.deleteCloudInboxMediaArchive('message/a');

  expect(axios.post).toHaveBeenCalledWith(
    '/api/whatsapp/cloud-inbox/media/message%2Fa/archive-retry',
  );
  expect(axios.post).toHaveBeenCalledWith(
    '/api/whatsapp/cloud-inbox/messages/message%2Fa/recover-text',
  );
  expect(axios.delete).toHaveBeenCalledWith(
    '/api/whatsapp/cloud-inbox/media/message%2Fa/archive',
  );
});

test('uses the branch-scoped conversation phone-reply sync endpoint', () => {
  whatsappAPI.syncCloudInboxPhoneReplies('branch-a:9665');

  expect(axios.post).toHaveBeenCalledWith(
    '/api/whatsapp/cloud-inbox/conversations/branch-a%3A9665/sync-phone-replies',
  );
});