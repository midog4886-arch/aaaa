import React, { useState, useRef, useCallback } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { RefreshCw, Loader2 } from 'lucide-react';

/**
 * Pull-to-Refresh Component
 * مكون السحب للتحديث - يعمل على الأجهزة اللمسية والحواسيب
 */
const PullToRefresh = ({ 
  children, 
  onRefresh, 
  threshold = 80,
  disabled = false,
  className = ''
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const containerRef = useRef(null);
  const startY = useRef(0);
  const currentY = useRef(0);
  
  const y = useMotionValue(0);
  const pullProgress = useTransform(y, [0, threshold], [0, 1]);
  const rotation = useTransform(y, [0, threshold], [0, 180]);
  const opacity = useTransform(y, [0, threshold / 2, threshold], [0, 0.5, 1]);
  const scale = useTransform(y, [0, threshold], [0.5, 1]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing || disabled) return;
    
    setIsRefreshing(true);
    
    try {
      await onRefresh?.();
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      setIsRefreshing(false);
      animate(y, 0, { type: 'spring', stiffness: 400, damping: 30 });
    }
  }, [isRefreshing, disabled, onRefresh, y]);

  const handleTouchStart = useCallback((e) => {
    if (disabled || isRefreshing) return;
    
    const container = containerRef.current;
    if (!container) return;
    
    // Only enable pull-to-refresh when scrolled to top
    if (container.scrollTop <= 0) {
      startY.current = e.touches[0].clientY;
      setIsPulling(true);
    }
  }, [disabled, isRefreshing]);

  const handleTouchMove = useCallback((e) => {
    if (!isPulling || disabled || isRefreshing) return;
    
    const container = containerRef.current;
    if (!container || container.scrollTop > 0) {
      setIsPulling(false);
      return;
    }
    
    currentY.current = e.touches[0].clientY;
    const diff = Math.max(0, currentY.current - startY.current);
    
    // Apply resistance for a more natural feel
    const resistance = 0.4;
    const pullDistance = diff * resistance;
    
    if (pullDistance > 0) {
      e.preventDefault();
      y.set(Math.min(pullDistance, threshold * 1.5));
    }
  }, [isPulling, disabled, isRefreshing, y, threshold]);

  const handleTouchEnd = useCallback(() => {
    if (!isPulling) return;
    
    setIsPulling(false);
    
    const currentPull = y.get();
    
    if (currentPull >= threshold && !isRefreshing) {
      // Trigger refresh
      y.set(threshold / 2);
      handleRefresh();
    } else {
      // Snap back
      animate(y, 0, { type: 'spring', stiffness: 400, damping: 30 });
    }
  }, [isPulling, y, threshold, isRefreshing, handleRefresh]);

  // Mouse events for desktop testing
  const handleMouseDown = useCallback((e) => {
    if (disabled || isRefreshing) return;
    
    const container = containerRef.current;
    if (!container || container.scrollTop > 0) return;
    
    startY.current = e.clientY;
    setIsPulling(true);
    
    const handleMouseMove = (moveEvent) => {
      if (!isPulling) return;
      
      const diff = Math.max(0, moveEvent.clientY - startY.current);
      const resistance = 0.3;
      const pullDistance = diff * resistance;
      
      if (pullDistance > 0) {
        y.set(Math.min(pullDistance, threshold * 1.5));
      }
    };
    
    const handleMouseUp = () => {
      setIsPulling(false);
      
      const currentPull = y.get();
      
      if (currentPull >= threshold && !isRefreshing) {
        y.set(threshold / 2);
        handleRefresh();
      } else {
        animate(y, 0, { type: 'spring', stiffness: 400, damping: 30 });
      }
      
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [disabled, isRefreshing, isPulling, y, threshold, handleRefresh]);

  return (
    <div className={`relative ${className}`}>
      {/* Pull indicator */}
      <motion.div
        style={{ y, opacity }}
        className="absolute top-0 left-0 right-0 flex items-center justify-center z-50 pointer-events-none"
      >
        <motion.div
          style={{ scale }}
          className="bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full p-3 shadow-lg"
        >
          {isRefreshing ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            >
              <Loader2 className="w-6 h-6 text-white" />
            </motion.div>
          ) : (
            <motion.div style={{ rotate: rotation }}>
              <RefreshCw className="w-6 h-6 text-white" />
            </motion.div>
          )}
        </motion.div>
      </motion.div>

      {/* Content container */}
      <motion.div
        ref={containerRef}
        style={{ y: isRefreshing ? threshold / 2 : y }}
        className="h-full overflow-y-auto"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
      >
        {/* Pull hint text */}
        <motion.div
          style={{ opacity: pullProgress }}
          className="text-center py-2 text-sm text-gray-500"
        >
          {isRefreshing ? (
            <span>جاري التحديث...</span>
          ) : y.get() >= threshold ? (
            <span>اترك للتحديث</span>
          ) : (
            <span>اسحب للتحديث</span>
          )}
        </motion.div>
        
        {children}
      </motion.div>
    </div>
  );
};

export default PullToRefresh;
