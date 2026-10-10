import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithCustomToken,
  signOut,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getFirestore,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const configured = Object.values(firebaseConfig).every(value => typeof value === 'string' && value.trim());
let auth;
let db;
let driverProfile = null;
let driverApproved = false;
let locationWatchId = null;
let lastLocationUpdate = 0;

if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  setPersistence(auth, browserLocalPersistence).catch(error => {
    console.error('Could not enable persistent Firebase sign-in:', error);
    window.onArideFirebaseError?.('Could not keep you signed in on this device.');
  });

  onAuthStateChanged(auth, async user => {
    driverProfile = null;
    driverApproved = false;
    if (user) {
      try {
        const profileSnapshot = await getDoc(doc(db, 'drivers', user.uid));
        if (profileSnapshot.exists()) {
          driverProfile = profileSnapshot.data();
          driverApproved = driverProfile.approved === true;
        }
      } catch (error) {
        console.error('Could not check the signed-in driver account:', error);
        window.onArideFirebaseError?.('Could not check driver access. Review the Firestore rules and try again.');
      }
    }
    window.onArideAuthChanged?.(user, {
      driverApproved,
      driverProfile,
    });
  });
}

function requireConfigured() {
  if (!configured) {
    throw new Error('Firebase is not configured. Add the VITE_FIREBASE_* settings and restart the site.');
  }
  if (!auth.currentUser) throw new Error('Sign in with your email before continuing.');
}

function requireApprovedDriver() {
  requireConfigured();
  if (!driverApproved || !driverProfile) {
    throw new Error('This account is not approved for driver access.');
  }
}

function formatCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates.every(Number.isFinite)) {
    throw new Error('Choose valid pickup and drop-off locations on the map.');
  }
  return { latitude: coordinates[0], longitude: coordinates[1] };
}

async function postOtp(path, body, authenticated = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (authenticated) {
    requireConfigured();
    headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  }
  const response = await fetch(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('ARIDE OTP service is unavailable. Use Vercel or run npm run dev:vercel.');
  }
  if (!response.ok) throw new Error(result.message || 'The OTP request failed.');
  return result;
}

async function sendEmailOtp(email) {
  if (!configured) return requireConfigured();
  await setPersistence(auth, browserLocalPersistence);
  await postOtp('/api/auth/send-otp', { email: email.trim() });
}

async function verifyEmailOtp(email, code) {
  if (!configured) return requireConfigured();
  const result = await postOtp('/api/auth/verify-otp', {
    email: email.trim(),
    code: code.trim(),
  });
  return signInWithCustomToken(auth, result.token);
}

async function sendTripStartOtp(rideId) {
  return postOtp('/api/rides/send-trip-otp', { rideId }, true);
}

async function verifyTripStartOtp(rideId, code) {
  return postOtp('/api/rides/verify-trip-otp', {
    rideId,
    code: code.trim(),
  }, true);
}

async function createRideRequest(ride) {
  requireConfigured();
  const customerUid = auth.currentUser.uid;
  const request = {
    customerUid,
    pickup: ride.pickup,
    drop: ride.drop,
    pickupCoordinates: formatCoordinates(ride.pickupCoordinates),
    dropCoordinates: formatCoordinates(ride.dropCoordinates),
    vehicleType: ride.vehicleType,
    fare: ride.fare,
    couponCode: ride.couponCode || '',
    paymentMethod: ride.paymentMethod,
    status: 'searching',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const reference = await addDoc(collection(db, 'rideRequests'), request);
  return reference.id;
}

function watchRideRequest(requestId, onUpdate, onError) {
  requireConfigured();
  return onSnapshot(
    doc(db, 'rideRequests', requestId),
    snapshot => {
      if (!snapshot.exists()) {
        onError(new Error('This ride request is no longer available.'));
        return;
      }
      onUpdate({ id: snapshot.id, ...snapshot.data() });
    },
    onError
  );
}

async function cancelRideRequest(requestId) {
  requireConfigured();
  await updateDoc(doc(db, 'rideRequests', requestId), {
    status: 'canceled',
    updatedAt: serverTimestamp(),
  });
}

function subscribeOpenRideRequests(onUpdate, onError) {
  requireApprovedDriver();
  const openRides = query(
    collection(db, 'rideRequests'),
    where('status', '==', 'searching'),
    limit(50)
  );
  return onSnapshot(openRides, snapshot => {
    onUpdate(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
  }, onError);
}

function subscribeDriverRides(onUpdate, onError) {
  requireApprovedDriver();
  const assignedRides = query(
    collection(db, 'rideRequests'),
    where('driverUid', '==', auth.currentUser.uid),
    limit(50)
  );
  return onSnapshot(assignedRides, snapshot => {
    onUpdate(snapshot.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .filter(ride => ['accepted', 'arrived', 'in_progress'].includes(ride.status)));
  }, onError);
}

async function acceptRideRequest(requestId) {
  requireApprovedDriver();
  const rideReference = doc(db, 'rideRequests', requestId);
  await runTransaction(db, async transaction => {
    const rideSnapshot = await transaction.get(rideReference);
    if (!rideSnapshot.exists() || rideSnapshot.data().status !== 'searching') {
      throw new Error('Another driver already accepted this ride.');
    }
    transaction.update(rideReference, {
      status: 'accepted',
      driverUid: auth.currentUser.uid,
      driverName: driverProfile.name,
      driverVehicle: driverProfile.vehicle,
      updatedAt: serverTimestamp(),
    });
  });
}

async function updateDriverRideStatus(requestId, status) {
  requireApprovedDriver();
  if (!['arrived', 'completed'].includes(status)) {
    throw new Error('Invalid ride status update.');
  }
  await updateDoc(doc(db, 'rideRequests', requestId), {
    status,
    updatedAt: serverTimestamp(),
  });
  if (status === 'arrived') await sendTripStartOtp(requestId);
  if (status === 'completed') stopDriverLocationSharing();
}

function startDriverLocationSharing(requestId) {
  requireApprovedDriver();
  if (!navigator.geolocation) throw new Error('Live location is not available in this browser.');
  if (locationWatchId !== null) navigator.geolocation.clearWatch(locationWatchId);
  locationWatchId = navigator.geolocation.watchPosition(async position => {
    const now = Date.now();
    if (now - lastLocationUpdate < 5000) return;
    lastLocationUpdate = now;
    try {
      await updateDoc(doc(db, 'rideRequests', requestId), {
        driverLocation: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        },
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Could not share driver location:', error);
      window.onArideFirebaseError?.('Could not share live location. Check ride access and location permission.');
    }
  }, error => {
    window.onArideFirebaseError?.(`Location sharing failed: ${error.message}`);
  }, { enableHighAccuracy: true, maximumAge: 5000 });
}

function stopDriverLocationSharing() {
  if (locationWatchId !== null) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }
}

async function setDriverAvailability(available) {
  requireApprovedDriver();
  await updateDoc(doc(db, 'drivers', auth.currentUser.uid), {
    available: Boolean(available),
    updatedAt: serverTimestamp(),
  });
}

window.ARIDEFirebase = {
  configured,
  get currentUser() {
    return auth?.currentUser || null;
  },
  sendEmailOtp,
  verifyEmailOtp,
  signOut: () => configured ? signOut(auth) : requireConfigured(),
  createRideRequest,
  watchRideRequest,
  cancelRideRequest,
  subscribeOpenRideRequests,
  subscribeDriverRides,
  acceptRideRequest,
  sendTripStartOtp,
  verifyTripStartOtp,
  updateDriverRideStatus,
  startDriverLocationSharing,
  stopDriverLocationSharing,
  setDriverAvailability,
};
