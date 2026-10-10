# ARIDE Website

ARIDE is a Vite website for customer ride booking, approved-driver ride acceptance, numeric email OTP sign-in, trip-start OTP verification, and Razorpay online checkout.

**Current branch limitation:** The API route source files are not present on `main`. Email OTP, live ride dispatch, trip-start verification, and online checkout therefore require those API routes to be restored before they can work.

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000 for the static website. Firebase API-backed email OTP, trip-start codes, and checkout require Vercel's local server:

```bash
npm run dev:vercel
```

## Installable app and offline access

The production build includes an installable PWA manifest and service worker. Open the deployed site over HTTPS (or use `localhost` during development) and choose **Install App** when the browser offers it. The service worker caches the app shell and built JavaScript for offline reopening; sign-in, live rides, maps, and payments still require a network connection.

## Firebase email OTP and live dispatch

ARIDE emails a six-digit sign-in code using Resend. The Vercel API verifies it with Firebase Admin and signs the customer into Firebase using a custom token. Trip-start codes are separate and are verified server-side before the ride can start. Configure:

1. Create a Firebase project and register a Web app.
2. Enable Firebase Authentication for the project. ARIDE uses Firebase custom-token sign-in after its server verifies the email code; it does not use Firebase email-link sign-in or ask users for a password.
3. Create the Firestore database.
4. Create a Resend account, verify the sender domain, and choose a sender address for `RESEND_FROM_EMAIL`.
5. Copy `.env.example` to `.env`. Set the Firebase Web values (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`) and server values (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `OTP_HASH_SECRET`). Use a random `OTP_HASH_SECRET` with at least 32 characters; keep all server secrets out of `VITE_*` variables.
6. Install and sign in to the Firebase CLI (`npm install -g firebase-tools`, then `firebase login`).
7. Deploy the included Firestore security rules: `firebase deploy --only firestore:rules`. OTP collections are intentionally inaccessible to clients.
8. Add the corresponding web settings and server secrets to Vercel Environment Variables, then rebuild/redeploy after changing them.

Customers sign in with email and create a ride request. The separate **Driver** dashboard is shown only to approved drivers and receives live requests while they are online. Requests are not geofenced yet. Accepting a ride is a Firestore transaction, so only one driver can accept it. On arrival, the driver can email a trip-start code to the customer and must verify the six-digit code before the server starts the trip. Drivers can share browser GPS while the dashboard stays open.

To approve a driver, first have that person sign in once. In Firebase Console, create a document in `drivers` whose document ID is the driver's Firebase Authentication UID, with fields such as:

```json
{
  "approved": true,
  "available": false,
  "name": "Captain name",
  "vehicle": "Bike · registration"
}
```

Only an administrator with Firebase Console access should create/approve driver records. The client-side security rules prevent users from granting themselves driver access. Configure Firestore rules before using real customer data.

## Payments

Customers select **Online · UPI / cards** or **Cash** when booking. Online checkout opens after the driver marks the trip complete; the fare and selected tip are sent to Razorpay, and the server verifies Razorpay's signature and captured amount before the UI reports payment success. Cash is paid directly to the driver at the end of the ride; it is not collected by the website.

1. Create Razorpay test keys and set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env` locally.
2. Run `npm run dev:vercel` to test the website with its `/api/payment/*` functions.
3. Add both Razorpay variables to Vercel Environment Variables for Preview/Production. Keep the secret server-side; never add it to a `VITE_*` variable.
4. Use Razorpay test keys for test payments. Add live keys only after completing Razorpay's account activation and payment-method setup.

Real online checkout cannot succeed until valid Razorpay credentials are configured. The Online option remains selectable so customers can see the setup guidance, but booking with Online is blocked until `/api/payment/status` confirms that the Vercel API and Razorpay keys are ready; Cash remains available. Firebase settings and Razorpay secrets are separate. Do not use `file://` previews or plain `npm run dev` for email OTP, Firestore dispatch, or checkout; use `npm run dev:vercel` or deploy to Vercel.

## Production build and deployment

```bash
npm run build
```

Import the repository into Vercel and use the included Vite configuration. Set Firebase Web values, Firebase Admin credentials, Resend settings, `OTP_HASH_SECRET`, and Razorpay server secrets in the Vercel project before deployment. Vercel builds the website from `index.html`; API functions are under `api/`.
