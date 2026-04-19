// ─── Firebase Configuration ───────────────────────────────────────────────────
// Replace these placeholder values with your own Firebase project config.
// See README.md for setup instructions (takes ~5 minutes, free).
// The config object is safe to commit to a public repo — it only identifies
// your project. Access is controlled by Firebase security rules.
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyABy1JFawubYy4q27zTNxicMjeBRX45kZ0',
  authDomain:        'wordlevs-b124a.firebaseapp.com',
  databaseURL:       'https://wordlevs-b124a-default-rtdb.firebaseio.com',
  projectId:         'wordlevs-b124a',
  storageBucket:     'wordlevs-b124a.firebasestorage.app',
  messagingSenderId: '240769060851',
  appId:             '1:240769060851:web:7fa0cbb3b122f9a2634c86',
};

// ─── Firebase SDK (loaded via CDN in index.html as module scripts) ─────────────
import { initializeApp }                         from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getDatabase, ref, set, get, push,
         update, onValue, off, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

const app = initializeApp(FIREBASE_CONFIG);
const db  = getDatabase(app);

let _roomListener = null;
let _roomRef      = null;

// ─── Short invite code ─────────────────────────────────────────────────────────
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I

function generateShortCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

// ─── Room CRUD ─────────────────────────────────────────────────────────────────

export async function createRoom(hostId, secretWord) {
  const shortCode = generateShortCode();

  const roomRef  = push(ref(db, 'rooms'));
  const roomId   = roomRef.key;

  await set(roomRef, {
    secretWord,
    hostId,
    guestId:   null,
    shortCode,
    status:    'waiting',
    winner:    null,
    createdAt: Date.now(),
    players: {
      [hostId]: { guesses: {}, currentRow: 0, done: false },
    },
  });

  await set(ref(db, `codes/${shortCode}`), roomId);

  return { roomId, shortCode };
}

export async function joinRoom(shortCode, guestId) {
  const codeSnap = await get(ref(db, `codes/${shortCode.toUpperCase()}`));
  if (!codeSnap.exists()) return null;

  const roomId   = codeSnap.val();
  const roomSnap = await get(ref(db, `rooms/${roomId}`));
  if (!roomSnap.exists()) return null;

  const room = roomSnap.val();

  if (room.status === 'finished') return { error: 'finished' };

  // Reconnecting as the same guest
  if (room.guestId === guestId) return { roomId, room };

  // Room is already full with a different guest
  if (room.guestId && room.guestId !== guestId) return { error: 'full' };

  // Host trying to join their own room
  if (room.hostId === guestId) return { error: 'self' };

  await update(ref(db, `rooms/${roomId}`), {
    guestId,
    [`players/${guestId}`]: { guesses: {}, currentRow: 0, done: false },
  });

  return { roomId, room };
}

export async function activateRoom(roomId) {
  await update(ref(db, `rooms/${roomId}`), { status: 'active' });
}

export async function submitGuess(roomId, playerId, rowIndex, word, result) {
  await set(ref(db, `rooms/${roomId}/players/${playerId}/guesses/${rowIndex}`), { word, result });
  await update(ref(db, `rooms/${roomId}/players/${playerId}`), { currentRow: rowIndex + 1 });
}

export async function setPlayerDone(roomId, playerId, won) {
  const updates = { [`players/${playerId}/done`]: true };

  if (won) {
    const roomSnap = await get(ref(db, `rooms/${roomId}/winner`));
    // Only set winner if not already set (first-writer-wins)
    if (!roomSnap.exists() || roomSnap.val() === null) {
      updates.winner = playerId;
      updates.status = 'finished';
    }
  } else {
    // Check if opponent is also done — if so, finish the game as a draw
    const snap = await get(ref(db, `rooms/${roomId}/players`));
    const players = snap.val() || {};
    const allDone = Object.values(players).every(p => p.done || p.id === playerId);
    if (allDone) {
      const winnerSnap = await get(ref(db, `rooms/${roomId}/winner`));
      if (!winnerSnap.exists() || winnerSnap.val() === null) {
        updates.status = 'finished';
      }
    }
  }

  await update(ref(db, `rooms/${roomId}`), updates);
}

export function subscribeToRoom(roomId, callback) {
  _roomRef      = ref(db, `rooms/${roomId}`);
  _roomListener = onValue(_roomRef, callback);
}

export function unsubscribeRoom() {
  if (_roomRef && _roomListener) {
    off(_roomRef, 'value', _roomListener);
    _roomRef      = null;
    _roomListener = null;
  }
}
