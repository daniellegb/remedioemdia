
import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface UserAvatarProps {
  src?: string | null;
  name?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | number;
  className?: string;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({ 
  src, 
  name, 
  size = 'md',
  className = ''
}) => {
  const [hasError, setHasError] = React.useState(false);

  const getInitials = (fullName?: string | null) => {
    if (!fullName) return '?';
    const names = fullName.trim().split(' ');
    if (names.length === 1) return names[0].charAt(0).toUpperCase();
    return (names[0].charAt(0) + names[names.length - 1].charAt(0)).toUpperCase();
  };

  const sizeClasses = {
    'xs': 'w-8 h-8 text-[10px]',
    'sm': 'w-10 h-10 text-xs',
    'md': 'w-12 h-12 text-sm',
    'lg': 'w-16 h-16 text-base',
    'xl': 'w-24 h-24 text-xl',
    '2xl': 'w-32 h-32 text-2xl',
  };

  const sizeStyle = typeof size === 'number' ? { width: size, height: size } : {};
  const currentSizeClass = typeof size === 'string' ? sizeClasses[size as keyof typeof sizeClasses] : '';

  return (
    <div 
      className={`relative rounded-full overflow-hidden flex-shrink-0 bg-slate-100 border border-slate-200 shadow-sm ${currentSizeClass} ${className}`}
      style={sizeStyle}
    >
      <AnimatePresence mode="wait">
        {src && !hasError ? (
          <motion.img
            key="avatar-img"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            src={src}
            alt={name || 'Avatar'}
            className="w-full h-full object-cover aspect-square"
            onError={() => setHasError(true)}
            referrerPolicy="no-referrer"
          />
        ) : (
          <motion.div
            key="avatar-fallback"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-bold"
          >
            {getInitials(name)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
