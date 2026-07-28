import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mazi.ordering',
  appName: 'Mazi',
  webDir: 'dist',
  backgroundColor: '#1b2350',
  server: {
    // Allow the native app to make API calls to the Vercel backend
    androidScheme: 'https',
    iosScheme: 'capacitor',
    cleartext: false,
  },
  android: {
    backgroundColor: '#1b2350',
    allowMixedContent: false,
  },
  ios: {
    backgroundColor: '#1b2350',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#1b2350',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      iosSpinnerColor: '#12207e',
      showSpinner: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1b2350',
    },
  },
};

export default config;
