import React, { useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

/**
 * Infinite Scroll Component
 * مكون التمرير اللانهائي
 */
const InfiniteScroll = ({
  children,
  loadMore,
  hasMore = true,
  isLoading = false,
  threshold = 200,
  className = '',
  loadingText = 'جاري تحميل المزيد...',
  endText = 'لا يوجد المزيد',
}) => {
  const observerRef = useRef(null);
  const sentinelRef = useRef(null);

  const handleObserver = useCallback((entries) => {
    const [entry] = entries;
    if (entry.isIntersecting && hasMore && !isLoading) {
      loadMore?.();
    }
  }, [hasMore, isLoading, loadMore]);

  useEffect(() => {
    const options = {
      root: null,
      rootMargin: `${threshold}px`,
      threshold: 0.1,
    };

    observerRef.current = new IntersectionObserver(handleObserver, options);

    if (sentinelRef.current) {
      observerRef.current.observe(sentinelRef.current);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [handleObserver, threshold]);

  return (
    <div className={className}>
      {children}

      {/* Sentinel element for intersection observer */}
      <div ref={sentinelRef} className="h-1" />

      {/* Loading indicator */}
      {isLoading && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-center gap-3 py-8"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          >
            <Loader2 className="w-6 h-6 text-blue-500" />
          </motion.div>
          <span className="text-gray-500">{loadingText}</span>
        </motion.div>
      )}

      {/* End of list indicator */}
      {!hasMore && !isLoading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-8 text-gray-400"
        >
          <div className="flex items-center justify-center gap-2">
            <div className="w-12 h-px bg-gray-300" />
            <span className="text-sm">{endText}</span>
            <div className="w-12 h-px bg-gray-300" />
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default InfiniteScroll;
