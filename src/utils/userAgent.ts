export interface UserAgentInfo {
  os: string;
  browser: string;
  deviceType: string;
}

export function parseUserAgent(uaString: string): UserAgentInfo {
  const ua = uaString.toLowerCase();
  
  let os = 'Desconhecido';
  if (ua.includes('windows')) {
    os = 'Windows';
  } else if (ua.includes('macintosh') || ua.includes('mac os')) {
    if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
      os = 'iOS';
    } else {
      os = 'macOS';
    }
  } else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
    os = 'iOS';
  } else if (ua.includes('android')) {
    os = 'Android';
  } else if (ua.includes('linux')) {
    os = 'Linux';
  }

  let browser = 'Navegador';
  if (ua.includes('samsungbrowser')) {
    browser = 'Samsung Internet';
  } else if (ua.includes('chrome') || ua.includes('crios')) {
    browser = 'Chrome';
  } else if (ua.includes('firefox') || ua.includes('fxios')) {
    browser = 'Firefox';
  } else if (ua.includes('safari') && !ua.includes('chrome') && !ua.includes('android')) {
    browser = 'Safari';
  } else if (ua.includes('edge') || ua.includes('edg')) {
    browser = 'Edge';
  } else if (ua.includes('opr') || ua.includes('opera')) {
    browser = 'Opera';
  }

  let deviceType = 'Desktop';
  const hasTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  if (ua.includes('ipad') || (ua.includes('macintosh') && hasTouch)) {
    deviceType = 'Tablet';
  } else if (ua.includes('iphone') || ua.includes('ipod')) {
    deviceType = 'iPhone';
  } else if (ua.includes('android')) {
    if (ua.includes('mobile')) {
      deviceType = 'Android';
    } else {
      deviceType = 'Tablet';
    }
  } else if (ua.includes('mobile')) {
    deviceType = 'Mobile';
  }

  return { os, browser, deviceType };
}

export function generateUUID(): string {
  if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  // Safe robust fallback
  return 'fxxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
