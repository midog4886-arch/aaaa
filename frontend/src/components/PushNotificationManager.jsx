import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, BellOff, Loader2, Check, X } from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'sonner';
import axios from 'axios';

const API_URL = '';

/**
 * Push Notification Manager Component
 * مكون إدارة إشعارات Push
 */
const PushNotificationManager = ({ memberId, compact = false }) => {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [permission, setPermission] = useState('default');

  // Check if push notifications are supported
  useEffect(() => {
    const checkSupport = () => {
      const supported = 'serviceWorker' in navigator && 
                       'PushManager' in window && 
                       'Notification' in window;
      setIsSupported(supported);
      
      if (supported) {
        setPermission(Notification.permission);
      }
    };
    
    checkSupport();
  }, []);

  // Check subscription status
  useEffect(() => {
    const checkSubscription = async () => {
      if (!isSupported || !memberId) {
        setIsLoading(false);
        return;
      }

      try {
        // Check with backend
        const response = await axios.get(`${API_URL}/api/push-notifications/subscription-status/${memberId}`);
        setIsSubscribed(response.data.subscribed);
        
        // Also verify with service worker
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        
        if (!subscription && response.data.subscribed) {
          // Backend thinks we're subscribed but we're not
          setIsSubscribed(false);
        }
      } catch (error) {
        console.error('Failed to check subscription:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkSubscription();
  }, [isSupported, memberId]);

  // Convert VAPID key from base64 to Uint8Array
  const urlBase64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  // Subscribe to push notifications
  const subscribe = useCallback(async () => {
    if (!isSupported || !memberId) return;

    setIsLoading(true);

    try {
      // Request permission
      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult);

      if (permissionResult !== 'granted') {
        toast.error('يجب السماح بالإشعارات للاشتراك');
        setIsLoading(false);
        return;
      }

      // Get VAPID public key
      const vapidResponse = await axios.get(`${API_URL}/api/push-notifications/vapid-public-key`);
      const vapidPublicKey = vapidResponse.data.publicKey;

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready;

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });

      // Send subscription to backend
      await axios.post(`${API_URL}/api/push-notifications/subscribe`, {
        member_id: memberId,
        subscription: {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: btoa(String.fromCharCode.apply(null, new Uint8Array(subscription.getKey('p256dh')))),
            auth: btoa(String.fromCharCode.apply(null, new Uint8Array(subscription.getKey('auth'))))
          }
        }
      });

      setIsSubscribed(true);
      toast.success('تم تفعيل الإشعارات بنجاح! 🔔');

    } catch (error) {
      console.error('Failed to subscribe:', error);
      toast.error('فشل في تفعيل الإشعارات');
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, memberId]);

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;

    setIsLoading(true);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await subscription.unsubscribe();
        
        // Notify backend
        await axios.post(`${API_URL}/api/push-notifications/unsubscribe`, null, {
          params: { endpoint: subscription.endpoint }
        });
      }

      setIsSubscribed(false);
      toast.success('تم إلغاء الإشعارات');

    } catch (error) {
      console.error('Failed to unsubscribe:', error);
      toast.error('فشل في إلغاء الإشعارات');
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  // Don't render if not supported
  if (!isSupported) {
    return null;
  }

  // Compact version (just an icon button)
  if (compact) {
    return (
      <Button
        variant={isSubscribed ? "default" : "outline"}
        size="icon"
        onClick={isSubscribed ? unsubscribe : subscribe}
        disabled={isLoading || permission === 'denied'}
        className={`relative ${isSubscribed ? 'bg-green-600 hover:bg-green-700' : ''}`}
        title={isSubscribed ? 'إيقاف الإشعارات' : 'تفعيل الإشعارات'}
      >
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : isSubscribed ? (
          <Bell className="w-5 h-5" />
        ) : (
          <BellOff className="w-5 h-5" />
        )}
        {isSubscribed && (
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full animate-pulse" />
        )}
      </Button>
    );
  }

  // Full version
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-200"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
            isSubscribed ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'
          }`}>
            {isSubscribed ? (
              <Bell className="w-6 h-6" />
            ) : (
              <BellOff className="w-6 h-6" />
            )}
          </div>
          <div>
            <h3 className="font-bold text-gray-800">إشعارات الفيديوهات الجديدة</h3>
            <p className="text-sm text-gray-500">
              {permission === 'denied' 
                ? 'تم حظر الإشعارات من إعدادات المتصفح'
                : isSubscribed 
                  ? 'سيتم إشعارك عند إضافة فيديو جديد'
                  : 'فعّل الإشعارات لتصلك التحديثات فوراً'
              }
            </p>
          </div>
        </div>

        <Button
          variant={isSubscribed ? "outline" : "default"}
          onClick={isSubscribed ? unsubscribe : subscribe}
          disabled={isLoading || permission === 'denied'}
          className={`min-w-[120px] ${
            isSubscribed 
              ? 'border-red-200 text-red-600 hover:bg-red-50' 
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : isSubscribed ? (
            <>
              <X className="w-4 h-4 ml-2" />
              إيقاف
            </>
          ) : (
            <>
              <Check className="w-4 h-4 ml-2" />
              تفعيل
            </>
          )}
        </Button>
      </div>

      {/* Status indicator */}
      <AnimatePresence>
        {isSubscribed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 pt-3 border-t border-blue-200"
          >
            <div className="flex items-center gap-2 text-sm text-green-600">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              الإشعارات مفعّلة - ستصلك تنبيهات الفيديوهات الجديدة
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default PushNotificationManager;
