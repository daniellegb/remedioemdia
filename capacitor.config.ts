import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.remedioemdia.app',
  appName: 'Remédio em Dia',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
  }
};

export default config;
