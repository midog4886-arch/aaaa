// Jest setup for CRA (craco test). Adds jest-dom matchers and the browser
// APIs jsdom lacks but Radix UI / layout code expect.
import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

// -- TextEncoder/TextDecoder (react-router v7 needs them) --------------------
if (!global.TextEncoder) global.TextEncoder = TextEncoder;
if (!global.TextDecoder) global.TextDecoder = TextDecoder;

// -- matchMedia -------------------------------------------------------------
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// -- ResizeObserver / IntersectionObserver ----------------------------------
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
if (!window.ResizeObserver) window.ResizeObserver = NoopObserver;
if (!window.IntersectionObserver) window.IntersectionObserver = NoopObserver;

// -- Pointer-capture APIs used by Radix -------------------------------------
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
