import axios from 'axios';

const API = process.env.REACT_APP_BACKEND_URL || '';

export async function verifyOperationPassword(key, password) {
  if (!password) return false;
  try {
    const res = await axios.post(`${API}/api/settings/operation-passwords/verify`, { key, password });
    return !!res.data?.valid;
  } catch (e) {
    return false;
  }
}

export async function promptAndVerify(key, promptText) {
  const pw = window.prompt(promptText);
  if (pw === null) return { ok: false, cancelled: true };
  const valid = await verifyOperationPassword(key, pw);
  return { ok: valid, cancelled: false };
}
