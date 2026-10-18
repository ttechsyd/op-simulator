import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getDatabase } from "firebase/database";

// The web app's config from the Firebase console (Project settings → Your apps → Web).
// These values are public by design; the security rules are what protect the data.
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
  databaseURL: "",
};

// until the config is filled in, the app runs offline-only and the sign-in row stays hidden
export const configured = firebaseConfig.apiKey !== "";

export const app = initializeApp(firebaseConfig);
// the services refuse an empty config, so without one they are never built: everything
// that uses them sits behind a signed-in user, and nobody can sign in
export const auth = configured ? getAuth(app) : (null as unknown as ReturnType<typeof getAuth>);
export const db = configured ? getFirestore(app) : (null as unknown as ReturnType<typeof getFirestore>);
export const rtdb = configured ? getDatabase(app) : (null as unknown as ReturnType<typeof getDatabase>);
