jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
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