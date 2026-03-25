import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, BellOff, Loader2, Check, X } from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'sonner';
import axios from 'axios';
import { API_URL } from '../config/api';

const isNativeApp = () => {
  return window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
};

const showLocalNotification = async (title, body, url) => {
  try {
    const LocalNotifications = window.Capacitor?.Plugins?.LocalNotifications;
    if (!LocalNotifications) return;
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      await LocalNotifications.requestPermissions();
    }
    await LocalNotifications.schedule({
      notifications: [{
        id: Math.floor(Math.random() * 100000),
        title: title || 'أكاديمية أداء الأبطال',
        body: body || '',
        extra: { url: url || '/' },
        sound: 'default',
        smallIcon: 'ic_launcher',
        iconColor: '#1e40af',
        channelId: 'default',
      }]
    });
  } catch (e) {
    console.log('LocalNotification fallback to toast:', e);
  }
};

const PushNotificationManager = ({ memberId, compact = false }) => {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [permission, setPermission] = useState('default');

  // Auto-registers FCM token silently if permission already granted (e.g. after reinstall)
  const autoRegisterNativeIfGranted = useCallback(async (memberIdArg) => {
    const mid = memberIdArg || memberId;
    if (!mid) return;
    try {
      const PushNotifications = window.Capacitor?.Plugins?.PushNotifications;
      if (!PushNotifications) return;
      const permResult = await PushNotifications.checkPermissions();
      if (permResult.receive !== 'granted') return;
      setPermission('granted');
      await PushNotifications.removeAllListeners();
      PushNotifications.addListener('registration', async (token) => {
        try {
          await axios.post(`${API_URL}/api/push-notifications/subscribe`, {
            member_id: mid,
            subscription: {
              endpoint: `fcm://${token.value}`,
              keys: { fcm_token: token.value, platform: 'android' }
            }
          });
          setIsSubscribed(true);
        } catch (e) {
          console.error('Auto-registration token save failed:', e);
        }
      });
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        showLocalNotification(notification.title, notification.body, notification.data?.url);
        toast.info(notification.title || 'إشعار جديد', { description: notification.body });
      });
      PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
        const url = notification.notification?.data?.url;
        if (url) window.location.href = url;
      });
      PushNotifications.register();
    } catch (e) {
      console.log('Auto-registration skipped:', e);
    }
  }, [memberId]);

  useEffect(() => {
    const checkSupport = () => {
      if (isNativeApp()) {
        const hasPushPlugin = !!(window.Capacitor?.Plugins?.PushNotifications);
        if (hasPushPlugin) {
          setIsSupported(true);
          autoRegisterNativeIfGranted(memberId);
        } else {
          console.log('Native app detected but PushNotifications plugin not yet available, retrying...');
          setTimeout(() => {
            const retryPlugin = !!(window.Capacitor?.Plugins?.PushNotifications);
            if (retryPlugin) {
              setIsSupported(true);
              autoRegisterNativeIfGranted(memberId);
            } else {
              console.log('PushNotifications plugin not available - notification UI will be hidden');
              setIsSupported(false);
              setIsLoading(false);
            }
          }, 3000);
        }
      } else {
        const supported = 'serviceWorker' in navigator && 
                         'PushManager' in window && 
                         'Notification' in window;
        setIsSupported(supported);
        if (supported) {
          setPermission(Notification.permission);
        }
      }
    };
    checkSupport();
  }, [autoRegisterNativeIfGranted, memberId]);

  useEffect(() => {
    const checkSubscription = async () => {
      if (!isSupported || !memberId) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await axios.get(`${API_URL}/api/push-notifications/subscription-status/${memberId}`);
        setIsSubscribed(response.data.subscribed);
        
        if (!isNativeApp()) {
          try {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription();
            if (!subscription && response.data.subscribed) {
              setIsSubscribed(false);
            }
          } catch (e) {}
        }
      } catch (error) {
        console.error('Failed to check subscription:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkSubscription();
  }, [isSupported, memberId]);

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

  const subscribeNative = useCallback(async () => {
    try {
      const Plugins = window.Capacitor?.Plugins;
      const PushNotifications = Plugins?.PushNotifications;
      
      if (!PushNotifications) {
        console.log('Native PushNotifications plugin not available');
        toast.error('مكتبة الإشعارات غير متوفرة، يرجى تحديث التطبيق');
        return false;
      }

      await PushNotifications.removeAllListeners();
      
      let permResult;
      try {
        permResult = await PushNotifications.checkPermissions();
        if (permResult.receive === 'prompt') {
          permResult = await PushNotifications.requestPermissions();
        }
      } catch (permError) {
        console.error('Permission check failed:', permError);
        toast.error('فشل في التحقق من صلاحيات الإشعارات');
        return false;
      }
      
      if (permResult.receive !== 'granted') {
        toast.error('يجب السماح بالإشعارات من إعدادات الجهاز');
        setPermission('denied');
        return false;
      }
      
      setPermission('granted');

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          console.error('FCM registration timeout');
          toast.error('انتهت مهلة التسجيل، حاول مرة أخرى');
          resolve(false);
        }, 15000);

        PushNotifications.addListener('registration', async (token) => {
          clearTimeout(timeout);
          try {
            await axios.post(`${API_URL}/api/push-notifications/subscribe`, {
              member_id: memberId,
              subscription: {
                endpoint: `fcm://${token.value}`,
                keys: {
                  fcm_token: token.value,
                  platform: 'android'
                }
              }
            });
            setIsSubscribed(true);
            toast.success('تم تفعيل الإشعارات بنجاح!');
            resolve(true);
          } catch (error) {
            console.error('Failed to save FCM token:', error);
            toast.error('فشل في حفظ التسجيل');
            resolve(false);
          }
        });

        PushNotifications.addListener('registrationError', (err) => {
          clearTimeout(timeout);
          console.error('FCM Registration error:', err);
          toast.error('فشل في التسجيل للإشعارات، تأكد من اتصال الإنترنت');
          resolve(false);
        });

        PushNotifications.addListener('pushNotificationReceived', (notification) => {
          showLocalNotification(notification.title, notification.body, notification.data?.url);
          toast.info(notification.title || 'إشعار جديد', { description: notification.body });
        });

        PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
          const url = notification.notification?.data?.url;
          if (url) {
            window.location.href = url;
          }
        });

        PushNotifications.register();
      });
    } catch (error) {
      console.error('Native push registration failed:', error);
      toast.error('فشل في تفعيل الإشعارات، حاول مرة أخرى');
      return false;
    }
  }, [memberId]);

  const subscribeWeb = useCallback(async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        toast.error('الإشعارات غير مدعومة في هذا المتصفح');
        return false;
      }

      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult);

      if (permissionResult !== 'granted') {
        toast.error('يجب السماح بالإشعارات للاشتراك');
        return false;
      }

      const vapidResponse = await axios.get(`${API_URL}/api/push-notifications/vapid-public-key`);
      const vapidPublicKey = vapidResponse.data.publicKey;

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });

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
      return true;
    } catch (error) {
      console.error('Web push subscription failed:', error);
      toast.error('فشل في تفعيل الإشعارات');
      return false;
    }
  }, [memberId]);

  const subscribe = useCallback(async () => {
    if (!isSupported || !memberId) return;
    setIsLoading(true);
    try {
      if (isNativeApp()) {
        const result = await subscribeNative();
        if (!result) {
          console.log('Native push subscription returned false');
        }
      } else {
        await subscribeWeb();
      }
    } catch (err) {
      console.error('Subscribe error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, memberId, subscribeNative, subscribeWeb]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;
    setIsLoading(true);

    try {
      if (isNativeApp() && window.Capacitor?.Plugins?.PushNotifications) {
        const PushNotifications = window.Capacitor.Plugins.PushNotifications;
        await PushNotifications.removeAllListeners();
      }
      
      const response = await axios.get(`${API_URL}/api/push-notifications/subscription-status/${memberId}`);
      if (response.data.endpoint) {
        await axios.post(`${API_URL}/api/push-notifications/unsubscribe`, null, {
          params: { endpoint: response.data.endpoint }
        });
      }
      
      if (!isNativeApp()) {
        try {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            await subscription.unsubscribe();
          }
        } catch (e) {}
      }

      setIsSubscribed(false);
      toast.success('تم إلغاء الإشعارات');
    } catch (error) {
      console.error('Failed to unsubscribe:', error);
      toast.error('فشل في إلغاء الإشعارات');
    } finally {
      setIsLoading(false);
    }
  }, [isSupported, memberId]);

  if (!isSupported) {
    return null;
  }

  if (!compact && isSubscribed && !isLoading) {
    return null;
  }

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
            <h3 className="font-bold text-gray-800">إشعارات التطبيق</h3>
            <p className="text-sm text-gray-500">
              {permission === 'denied' 
                ? 'تم حظر الإشعارات من إعدادات الجهاز'
                : isSubscribed 
                  ? 'سيتم إشعارك عند إضافة فيديو جديد أو أي تحديث'
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
              الإشعارات مفعّلة - ستصلك تنبيهات الفيديوهات والتحديثات
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default PushNotificationManager;
