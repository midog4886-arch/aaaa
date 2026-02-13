import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  Home, 
  Video, 
  Trophy, 
  CreditCard, 
  Bell,
  User
} from 'lucide-react';

const BottomNavigation = ({ darkMode, unreadCount = 0, language = 'ar' }) => {
  const location = useLocation();
  
  const navItems = [
    { 
      to: '/portal/dashboard', 
      icon: Home, 
      label: language === 'ar' ? 'الرئيسية' : 'Home' 
    },
    { 
      to: '/portal/daily-videos', 
      icon: Video, 
      label: language === 'ar' ? 'الفيديوهات' : 'Videos' 
    },
    { 
      to: '/portal/loyalty', 
      icon: Trophy, 
      label: language === 'ar' ? 'النقاط' : 'Points' 
    },
    { 
      to: '/portal/subscriptions', 
      icon: CreditCard, 
      label: language === 'ar' ? 'الاشتراكات' : 'Subscriptions' 
    },
    { 
      to: '/portal/notifications', 
      icon: Bell, 
      label: language === 'ar' ? 'الإشعارات' : 'Notifications',
      badge: unreadCount
    },
  ];

  return (
    <motion.nav
      initial={{ y: 100 }}
      animate={{ y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={`fixed bottom-0 left-0 right-0 z-50 ${
        darkMode 
          ? 'bg-gray-900/95 border-gray-700' 
          : 'bg-white/95 border-gray-200'
      } border-t backdrop-blur-lg safe-area-bottom`}
    >
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {navItems.map((item) => {
          const isActive = location.pathname === item.to;
          const Icon = item.icon;
          
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className="relative flex flex-col items-center justify-center flex-1 h-full"
            >
              <motion.div
                whileTap={{ scale: 0.9 }}
                className="relative flex flex-col items-center"
              >
                {/* Active indicator */}
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute -top-1 w-12 h-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                )}
                
                {/* Icon */}
                <div className={`relative p-2 rounded-xl transition-colors ${
                  isActive 
                    ? 'text-blue-600' 
                    : darkMode ? 'text-gray-400' : 'text-gray-500'
                }`}>
                  <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : ''}`} />
                  
                  {/* Badge */}
                  {item.badge > 0 && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center"
                    >
                      {item.badge > 9 ? '9+' : item.badge}
                    </motion.span>
                  )}
                </div>
                
                {/* Label */}
                <span className={`text-[10px] mt-0.5 font-medium ${
                  isActive 
                    ? 'text-blue-600' 
                    : darkMode ? 'text-gray-400' : 'text-gray-500'
                }`}>
                  {item.label}
                </span>
              </motion.div>
            </NavLink>
          );
        })}
      </div>
    </motion.nav>
  );
};

export default BottomNavigation;
