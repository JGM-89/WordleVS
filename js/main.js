import { evaluateGuess, isValidGuess, selectSecretWord, buildKeyboardState } from './game.js';
import {
  createRoom, joinRoom, activateRoom,
  submitGuess as fbSubmitGuess,
  setPlayerDone, subscribeToRoom, unsubscribeRoom,
} from './firebase.js';
import {
  showScreen, initBoard, setTileLetter, revealRow, bounceRow, shakeRow,
  setKeyColor, resetKeyboard, showLobbyHost, setLobbyStatus,
  setGameStatus, setOpponentLabel, renderResults, showToast,
  setJoinError, clearJoinError,
} from './ui.js';

// ── Player identity (persisted across refreshes) ───────────────────────────────
let playerId = localStorage.getItem('wvs_pid');
if (!playerId) {
  playerId = crypto.randomUUID();
  localStorage.setItem('wvs_pid', playerId);
}

// ── App state ──────────────────────────────────────────────────────────────────
const state = {
  roomId:          null,
  shortCode:       null,
  role:            null,   // 'host' | 'guest'
  secretWord:      null,
  currentRow:      0,
  currentTiles:    [],     // letters typed in the current row
  inputLocked:     false,  // true while animation plays or game is over
  done:            false,
  opponentDone:    false,
  lastOpponentRow: -1,     // last opponent row we've rendered
};

// ── Board DOM references ───────────────────────────────────────────────────────
const boardSelf     = document.getElementById('board-self');
const boardOpponent = document.getElementById('board-opponent');

// ── Landing screen ─────────────────────────────────────────────────────────────

document.getElementById('btn-create').addEventListener('click', handleCreate);
document.getElementById('btn-join').addEventListener('click', handleJoin);
document.getElementById('input-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleJoin();
});
document.getElementById('input-code').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  clearJoinError();
});

// ── Lobby screen ───────────────────────────────────────────────────────────────

document.getElementById('btn-copy').addEventListener('click', () => {
  navigator.clipboard?.writeText(state.shortCode).then(() => {
    showToast('Code copied!', 1200);
  }).catch(() => {
    showToast(state.shortCode, 3000);
  });
});

// ── Results screen ─────────────────────────────────────────────────────────────

document.getElementById('btn-home').addEventListener('click', () => {
  unsubscribeRoom();
  resetState();
  showScreen('landing');
});

document.getElementById('btn-play-again').addEventListener('click', async () => {
  unsubscribeRoom();
  resetState();
  await handleCreate();
  showToast('New game created — share the code!', 2500);
});

// ── Keyboard input ─────────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (document.getElementById('screen-game').classList.contains('active')) {
    if (!e.ctrlKey && !e.metaKey && !e.altKey) handleKey(e.key);
  }
});

document.getElementById('keyboard').addEventListener('click', e => {
  const key = e.target.closest('.key');
  if (key) handleKey(key.dataset.key);
});

// ── Flow: Create Game ──────────────────────────────────────────────────────────

async function handleCreate() {
  const secret = selectSecretWord();
  showScreen('lobby');
  setLobbyStatus('Waiting for opponent…');

  try {
    const { roomId, shortCode } = await createRoom(playerId, secret);
    state.roomId    = roomId;
    state.shortCode = shortCode;
    state.role      = 'host';
    state.secretWord = secret;

    showLobbyHost(shortCode);
    subscribeToRoom(roomId, onRoomUpdate);
  } catch (err) {
    console.error(err);
    showToast('Could not create game. Check your Firebase config.');
    showScreen('landing');
  }
}

// ── Flow: Join Game ────────────────────────────────────────────────────────────

async function handleJoin() {
  const code = document.getElementById('input-code').value.trim().toUpperCase();
  if (code.length < 6) {
    setJoinError('Enter the full 6-character code.');
    return;
  }

  const btn = document.getElementById('btn-join');
  btn.disabled = true;

  try {
    const result = await joinRoom(code, playerId);

    if (!result) {
      setJoinError('Code not found. Check and try again.');
      btn.disabled = false;
      return;
    }

    if (result.error === 'finished') {
      setJoinError('That game has already ended.');
      btn.disabled = false;
      return;
    }

    if (result.error === 'full') {
      setJoinError('That game is already full.');
      btn.disabled = false;
      return;
    }

    if (result.error === 'self') {
      setJoinError("That's your own game code!");
      btn.disabled = false;
      return;
    }

    state.roomId    = result.roomId;
    state.shortCode = code;
    state.role      = 'guest';

    showScreen('lobby');
    setLobbyStatus('Connected! Waiting for host…');
    subscribeToRoom(result.roomId, onRoomUpdate);
  } catch (err) {
    console.error(err);
    setJoinError('Connection error. Try again.');
    btn.disabled = false;
  }
}

// ── Firebase room update handler ───────────────────────────────────────────────

function onRoomUpdate(snapshot) {
  if (!snapshot.exists()) return;
  const room = snapshot.val();

  // Host detects guest joined → activate the room
  if (state.role === 'host' && room.status === 'waiting' && room.guestId) {
    activateRoom(state.roomId).catch(console.error);
    return;
  }

  if (room.status === 'active') {
    state.secretWord = room.secretWord;

    if (!document.getElementById('screen-game').classList.contains('active')) {
      startGame(room);
    } else {
      syncOpponentBoard(room);
      checkGameOver(room);
    }
  }

  if (room.status === 'finished') {
    syncOpponentBoard(room);
    showResults(room);
  }
}

// ── Game start ─────────────────────────────────────────────────────────────────

function startGame(room) {
  resetKeyboard();
  initBoard(boardSelf, false);
  initBoard(boardOpponent, true);

  state.currentRow   = room.players?.[playerId]?.currentRow ?? 0;
  state.currentTiles = [];
  state.inputLocked  = false;
  state.done         = room.players?.[playerId]?.done ?? false;
  state.lastOpponentRow = -1;

  // Restore own guesses if reconnecting
  const myGuesses = room.players?.[playerId]?.guesses ?? {};
  const myHistory = [];
  for (let r = 0; r < state.currentRow; r++) {
    const g = myGuesses[r];
    if (g) {
      myHistory.push(g);
      revealRow(boardSelf, r, g.result, g.word.split(''), false, null);
      g.result.forEach((status, col) => setKeyColor(g.word[col], status));
    }
  }

  showScreen('game');
  setGameStatus('');
  syncOpponentBoard(room);

  if (state.done) {
    state.inputLocked = true;
    setGameStatus('Waiting for opponent to finish…');
  }
}

// ── Sync opponent board ────────────────────────────────────────────────────────

function syncOpponentBoard(room) {
  const opponentId = getOpponentId(room);
  if (!opponentId) return;

  const oppGuesses = room.players?.[opponentId]?.guesses ?? {};
  const oppRow     = room.players?.[opponentId]?.currentRow ?? 0;

  for (let r = state.lastOpponentRow + 1; r < oppRow; r++) {
    const g = oppGuesses[r];
    if (g) {
      revealRow(boardOpponent, r, g.result, null, true, null);
      state.lastOpponentRow = r;
    }
  }
}

function getOpponentId(room) {
  return state.role === 'host' ? room.guestId : room.hostId;
}

// ── Input handling ─────────────────────────────────────────────────────────────

function handleKey(key) {
  if (state.inputLocked || state.done) return;

  if (key === 'Backspace' || key === 'Delete') {
    if (state.currentTiles.length > 0) {
      state.currentTiles.pop();
      setTileLetter(boardSelf, state.currentRow, state.currentTiles.length, '');
    }
    return;
  }

  if (key === 'Enter') {
    submitCurrentGuess();
    return;
  }

  if (/^[a-zA-Z]$/.test(key) && state.currentTiles.length < COLS) {
    const letter = key.toLowerCase();
    setTileLetter(boardSelf, state.currentRow, state.currentTiles.length, letter);
    state.currentTiles.push(letter);
  }
}

const COLS = 5;

async function submitCurrentGuess() {
  const word = state.currentTiles.join('');

  if (word.length < COLS) {
    showToast('Not enough letters');
    shakeRow(boardSelf, state.currentRow);
    return;
  }

  if (!isValidGuess(word)) {
    showToast('Not in word list');
    shakeRow(boardSelf, state.currentRow);
    return;
  }

  const result = evaluateGuess(word, state.secretWord);
  const row    = state.currentRow;

  // Lock input during animation
  state.inputLocked = true;

  revealRow(boardSelf, row, result, state.currentTiles, false, async () => {
    // Update keyboard colors
    result.forEach((status, i) => setKeyColor(word[i], status));

    const won = result.every(s => s === 'correct');

    // Write guess to Firebase
    await fbSubmitGuess(state.roomId, playerId, row, word, result);

    if (won) {
      bounceRow(boardSelf, row);
      showToast('Brilliant!', 2000);
      state.done = true;
      await setPlayerDone(state.roomId, playerId, true);
    } else if (row === 5) {
      state.done = true;
      await setPlayerDone(state.roomId, playerId, false);
      setGameStatus('Waiting for opponent to finish…');
    }

    state.currentRow++;
    state.currentTiles = [];
    state.inputLocked  = false;

    if (state.done) state.inputLocked = true;
  });
}

// ── Game-over check ────────────────────────────────────────────────────────────

function checkGameOver(room) {
  if (room.status === 'finished') {
    showResults(room);
  }
}

function showResults(room) {
  const opponentId = getOpponentId(room);
  const myData     = room.players?.[playerId];
  const oppData    = room.players?.[opponentId];

  let outcome;
  if (!room.winner) {
    outcome = 'draw';
  } else if (room.winner === playerId) {
    outcome = 'win';
  } else {
    outcome = 'lose';
  }

  const selfGuesses = myData?.done
    ? (Object.values(myData.guesses || {}).some(g => g.result.every(s => s === 'correct'))
        ? Object.keys(myData.guesses).length
        : null)
    : null;

  const oppGuesses = oppData?.done
    ? (Object.values(oppData.guesses || {}).some(g => g.result.every(s => s === 'correct'))
        ? Object.keys(oppData.guesses).length
        : null)
    : null;

  renderResults({
    outcome,
    secretWord: room.secretWord,
    selfGuesses,
    opponentGuesses: oppGuesses,
  });

  showScreen('results');
  unsubscribeRoom();
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function resetState() {
  Object.assign(state, {
    roomId: null, shortCode: null, role: null, secretWord: null,
    currentRow: 0, currentTiles: [], inputLocked: false,
    done: false, opponentDone: false, lastOpponentRow: -1,
  });
  document.getElementById('input-code').value = '';
  document.getElementById('btn-join').disabled = false;
  clearJoinError();
}
