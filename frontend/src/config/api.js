import { Capacitor } from '@capacitor/core';

const isNative = Capacitor.isNativePlatform();

const LIVE_SERVER_URL = 'https://adaa-alabtal.replit.app';

export const API_URL = isNative ? LIVE_SERVER_URL : '';

export const getApiUrl = () => API_URL;

export default API_URL;
