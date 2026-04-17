import { Capacitor } from '@capacitor/core';

export const platformService = {
  isNative: () => {
    return Capacitor.isNativePlatform();
  },

  getRedirectUrl: () => {
    if (Capacitor.isNativePlatform()) {
      return 'myapp://auth/callback';
    }
    return `${window.location.origin}/auth/callback`;
  },

  getAppId: () => {
    return 'com.remedioemdia.app';
  }
};
