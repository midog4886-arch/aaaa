import React from 'react';
import { cn } from '../../lib/utils';

// Skeleton component for loading states
export const Skeleton = ({ className, ...props }) => {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-gray-200 dark:bg-gray-700",
        className
      )}
      {...props}
    />
  );
};

// Video Card Skeleton
export const VideoCardSkeleton = () => (
  <div className="bg-white dark:bg-gray-800 rounded-xl overflow-hidden shadow-sm">
    <Skeleton className="aspect-video w-full" />
    <div className="p-4 space-y-3">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  </div>
);

// Ad Banner Skeleton
export const AdBannerSkeleton = () => (
  <div className="relative rounded-xl overflow-hidden">
    <Skeleton className="aspect-[21/9] w-full" />
    <div className="absolute bottom-0 left-0 right-0 p-4 space-y-2">
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  </div>
);

// Notification Card Skeleton
export const NotificationSkeleton = () => (
  <div className="flex items-start gap-4 p-4 bg-white dark:bg-gray-800 rounded-lg">
    <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" />
    <div className="flex-1 space-y-2">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  </div>
);

// Stats Card Skeleton
export const StatsCardSkeleton = () => (
  <div className="bg-white dark:bg-gray-800 rounded-xl p-4 space-y-3">
    <div className="flex items-center gap-3">
      <Skeleton className="w-10 h-10 rounded-full" />
      <Skeleton className="h-4 w-20" />
    </div>
    <Skeleton className="h-8 w-16" />
  </div>
);

// List Item Skeleton
export const ListItemSkeleton = () => (
  <div className="flex items-center gap-4 p-3">
    <Skeleton className="w-12 h-12 rounded-lg" />
    <div className="flex-1 space-y-2">
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-3 w-1/3" />
    </div>
  </div>
);

export default Skeleton;
