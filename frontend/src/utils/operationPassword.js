import axios from 'axios';

const API = process.env.REACT_APP_BACKEND_URL || '';

function _normalizeBranchId(branchId) {
  if (!branchId || branchId === 'all') return null;
  return String(branchId);
}

export async function verifyOperationPassword(key, password, branchId) {
  if (!password) return false;
  try {
    const body = { key, password };
    const bid = _normalizeBranchId(branchId);
    if (bid) body.branch_id = bid;
    const res = await axios.post(`${API}/api/settings/operation-passwords/verify`, body);
    return !!res.data?.valid;
  } catch (e) {
    return false;
  }
}

export async function promptAndVerify(key, promptText, branchId) {
  const pw = window.prompt(promptText);
  if (pw === null) return { ok: false, cancelled: true };
  const valid = await verifyOperationPassword(key, pw, branchId);
  return { ok: valid, cancelled: false };
}
