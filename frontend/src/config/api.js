import { Capacitor } from '@capacitor/core';

const isNative = Capacitor.isNativePlatform();

const LIVE_SERVER_URL = 'https://2ddefb56-04e5-4119-9ddf-9a5677354f57-00-2ojc1h8ytbsj0.pike.replit.dev';

export const API_URL = isNative ? LIVE_SERVER_URL : '';

export const getApiUrl = () => API_URL;

export default API_URL;
