const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let app;

const normalizePrivateKey = (key) => {
  if (!key) return undefined;
  return String(key).replace(/\\n/g, '\n');
};

const initFirebaseAdmin = () => {
  if (app) return app;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  let credential;

  if (serviceAccountPath) {
    const fullPath = path.isAbsolute(serviceAccountPath)
      ? serviceAccountPath
      : path.join(__dirname, '..', serviceAccountPath);

    if (fs.existsSync(fullPath)) {
      const json = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      credential = admin.credential.cert(json);
    }
  }

  if (!credential && projectId && clientEmail && privateKey) {
    credential = admin.credential.cert({ projectId, clientEmail, privateKey });
  }

  if (!credential) {
    throw new Error(
      'Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY',
    );
  }

  app = admin.initializeApp({ credential });
  return app;
};

const getFirebaseAuth = () => {
  initFirebaseAdmin();
  return admin.auth();
};

const getFirebaseMessaging = () => {
  initFirebaseAdmin();
  return admin.messaging();
};

module.exports = { initFirebaseAdmin, getFirebaseAuth, getFirebaseMessaging };
