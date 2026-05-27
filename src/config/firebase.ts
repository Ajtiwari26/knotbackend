import * as admin from 'firebase-admin';

let firebaseApp: admin.app.App | null = null;
let isInitialized = false;

export const initializeFirebase = (): admin.app.App | null => {
  if (isInitialized) return firebaseApp;

  try {
    const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT;
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

    if (serviceAccountVar) {
      // Initialize from inline JSON string
      const serviceAccount = JSON.parse(serviceAccountVar);
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('Firebase Admin SDK initialized from environment variable.');
      isInitialized = true;
    } else if (serviceAccountPath) {
      // Initialize from service account JSON file
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccountPath),
      });
      console.log(`Firebase Admin SDK initialized from file: ${serviceAccountPath}`);
      isInitialized = true;
    } else if (process.env.NODE_ENV === 'production') {
      // Initialize using Google Application Default Credentials in production
      firebaseApp = admin.initializeApp();
      console.log('Firebase Admin SDK initialized using default credentials.');
      isInitialized = true;
    } else {
      console.warn(
        'WARNING: Firebase Admin SDK credentials not found. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH. Development mock mode enabled.'
      );
    }
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', (error as Error).message);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }

  return firebaseApp;
};

export const getFirebaseAdmin = (): typeof admin => {
  return admin;
};
