import React, { useLayoutEffect, useRef } from 'react';

// Key this component by conversation so each newly opened chat starts at its end.
export default function ChatMessageViewport({ children, className }) {
  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const followLatestRef = useRef(true);
  const scrollToLatest = () => {
    if (followLatestRef.current && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
  };

  useLayoutEffect(scrollToLatest, [children]);
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(scrollToLatest);
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={viewportRef}
      className={className}
      data-testid="chat-message-viewport"
      onScroll={event => {
        const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
        followLatestRef.current = scrollHeight - scrollTop - clientHeight <= 48;
      }}
      onLoadCapture={scrollToLatest}
    >
      <div ref={contentRef} className="space-y-3">{children}</div>
    </div>
  );
}