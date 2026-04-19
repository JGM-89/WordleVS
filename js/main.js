import { evaluateGuess, isValidGuess, selectSecretWord, buildKeyboardState } from './game.js';
import {
  createRoom, joinRoom, activateRoom,
  submitGuess as fbSubmitGuess,
  setPlayerDone, subscribeToRoom, unsubscribeRoom,
  expireGame, giveUp, createRematch, getRematch,
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
const GAME_DURATION_MS = 5 * 60 * 1000; // 5 minutes

const state = {
  roomId:          null,
  shortCode:       null,
  role:            null,   // 'host' | 'guest'
  secretWord:      null,
  hardMode:        false,
  guessHistory:    [],     // { word, result }[] — own guesses so far
  currentRow:      0,
  currentTiles:    [],     // letters typed in the current row
  inputLocked:     false,  // true while animation plays or game is over
  done:            false,
  opponentDone:    false,
  lastOpponentRow: -1,     // last opponent row we've rendered
  timerInterval:   null,
  startedAt:       null,
  lastRoom:        null,   // cached room snapshot for timer expiry
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

// ── Give up ────────────────────────────────────────────────────────────────────

document.getElementById('btn-give-up').addEventListener('click', async () => {
  if (state.done || !state.roomId) return;
  const btn = document.getElementById('btn-give-up');
  btn.disabled = true;
  const opponentId = getOpponentIdFromState();
  await giveUp(state.roomId, playerId, opponentId).catch(console.error);
});

// ── Results screen ─────────────────────────────────────────────────────────────

document.getElementById('btn-home').addEventListener('click', () => {
  unsubscribeRoom();
  resetState();
  showScreen('landing');
});

document.getElementById('btn-play-again').addEventListener('click', async () => {
  const btn = document.getElementById('btn-play-again');
  btn.disabled = true;
  btn.textContent = 'Starting…';

  const oldRoomId = state.roomId;
  const oldRoom   = state.lastRoom;

  try {
    // Check if the other player already created a rematch room
    const existingRematchId = await getRematch(oldRoomId);

    if (existingRematchId) {
      // Other player was first — just join their room
      await joinRematch(existingRematchId, oldRoom);
    } else {
      // We're first — create the rematch room for both players
      const secret  = selectSecretWord();
      const { roomId } = await createRematch(
        oldRoomId,
        oldRoom.hostId,
        oldRoom.guestId,
        secret,
        oldRoom.hardMode ?? false,
      );
      await joinRematch(roomId, oldRoom);
    }
  } catch (err) {
    console.error(err);
    showToast('Could not start rematch. Try again.');
    btn.disabled = false;
    btn.textContent = 'Play Again';
  }
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
  const secret   = selectSecretWord();
  const hardMode = document.getElementById('toggle-hard').checked;
  showScreen('lobby');
  setLobbyStatus('Waiting for opponent…');

  try {
    const { roomId, shortCode } = await createRoom(playerId, secret, hardMode);
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
  state.lastRoom = room;

  // Auto-join rematch if the other player created one while we're on the results screen
  if (room.rematch && document.getElementById('screen-results').classList.contains('active')) {
    joinRematch(room.rematch, room).catch(console.error);
    return;
  }

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

  state.hardMode     = room.hardMode ?? false;
  state.currentRow   = room.players?.[playerId]?.currentRow ?? 0;
  state.currentTiles = [];
  state.inputLocked  = false;
  state.done         = room.players?.[playerId]?.done ?? false;
  state.lastOpponentRow = -1;
  state.guessHistory = [];

  // Restore own guesses if reconnecting
  const myGuesses = room.players?.[playerId]?.guesses ?? {};
  for (let r = 0; r < state.currentRow; r++) {
    const g = myGuesses[r];
    if (g) {
      state.guessHistory.push(g);
      revealRow(boardSelf, r, g.result, g.word.split(''), false, null);
      g.result.forEach((status, col) => setKeyColor(g.word[col], status));
    }
  }

  showScreen('game');
  const badge = state.hardMode ? ' <span class="hard-mode-badge">Hard</span>' : '';
  document.getElementById('game-title').innerHTML = `Wordle<span class="vs">VS</span>${badge}`;
  document.getElementById('btn-give-up').disabled = false;
  setGameStatus('');
  syncOpponentBoard(room);
  startTimer(room.startedAt);

  if (state.done) {
    state.inputLocked = true;
    setGameStatus('Waiting for opponent to finish…');
  }
}

// ── Timer ──────────────────────────────────────────────────────────────────────

function startTimer(startedAt) {
  stopTimer();
  state.startedAt = startedAt;

  function tick() {
    const remaining = Math.max(0, GAME_DURATION_MS - (Date.now() - state.startedAt));
    const totalSecs = Math.ceil(remaining / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;

    const el = document.getElementById('game-timer');
    if (el) {
      el.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
      el.classList.remove('warn', 'urgent');
      if (totalSecs <= 30) el.classList.add('urgent');
      else if (totalSecs <= 60) el.classList.add('warn');
    }

    if (remaining === 0) {
      stopTimer();
      onTimerExpired();
    }
  }

  tick();
  state.timerInterval = setInterval(tick, 500);
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function onTimerExpired() {
  if (!state.roomId) return;
  state.inputLocked = true;
  const room = state.lastRoom;
  if (!room || room.status === 'finished') return;

  const opponentId = getOpponentIdFromState();
  const myGreens  = countBestGreens(room.players?.[playerId]);
  const oppGreens = countBestGreens(room.players?.[opponentId]);

  let winnerId = null;
  if (myGreens > oppGreens) winnerId = playerId;
  else if (oppGreens > myGreens) winnerId = opponentId;

  expireGame(state.roomId, winnerId).catch(console.error);
}

function countBestGreens(playerData) {
  const guesses = playerData?.guesses ?? {};
  let best = 0;
  for (const g of Object.values(guesses)) {
    const greens = g.result.filter(s => s === 'correct').length;
    if (greens > best) best = greens;
  }
  return best;
}

function getOpponentIdFromState() {
  if (!state.lastRoom) return null;
  return state.role === 'host' ? state.lastRoom.guestId : state.lastRoom.hostId;
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

// Returns an error string if the word violates hard mode constraints, else null.
function hardModeError(word) {
  for (const { word: prev, result } of state.guessHistory) {
    for (let i = 0; i < COLS; i++) {
      if (result[i] === 'correct' && word[i] !== prev[i]) {
        return `Position ${i + 1} must be ${prev[i].toUpperCase()}`;
      }
    }
    for (let i = 0; i < COLS; i++) {
      if (result[i] === 'present' && !word.includes(prev[i])) {
        return `Guess must contain ${prev[i].toUpperCase()}`;
      }
    }
  }
  return null;
}

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

  if (state.hardMode) {
    const err = hardModeError(word);
    if (err) {
      showToast(err);
      shakeRow(boardSelf, state.currentRow);
      return;
    }
  }

  const result = evaluateGuess(word, state.secretWord);
  const row    = state.currentRow;

  // Lock input during animation
  state.inputLocked = true;

  revealRow(boardSelf, row, result, state.currentTiles, false, async () => {
    // Update keyboard colors
    result.forEach((status, i) => setKeyColor(word[i], status));

    const won = result.every(s => s === 'correct');

    state.guessHistory.push({ word, result });

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
    secretWord:      room.secretWord,
    selfGuesses,
    opponentGuesses: oppGuesses,
    timerExpired:    room.timerExpired ?? false,
    gaveUp:          room.gaveUp ?? null,
    selfId:          playerId,
  });

  stopTimer();
  showScreen('results');
  // Keep Firebase subscription alive so we can detect a rematch request
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function joinRematch(newRoomId, oldRoom) {
  unsubscribeRoom();

  // Preserve role from the old room
  const newRole = oldRoom.hostId === playerId ? 'host' : 'guest';

  // Reset gameplay state, keep identity
  Object.assign(state, {
    roomId: newRoomId, shortCode: null, role: newRole,
    secretWord: null, hardMode: oldRoom.hardMode ?? false,
    guessHistory: [],
    currentRow: 0, currentTiles: [], inputLocked: false,
    done: false, opponentDone: false, lastOpponentRow: -1,
    timerInterval: null, startedAt: null, lastRoom: null,
  });

  subscribeToRoom(newRoomId, onRoomUpdate);
  // onRoomUpdate will fire with status:'active' and call startGame automatically
}

function resetState() {
  stopTimer();
  Object.assign(state, {
    roomId: null, shortCode: null, role: null, secretWord: null,
    hardMode: false, guessHistory: [],
    currentRow: 0, currentTiles: [], inputLocked: false,
    done: false, opponentDone: false, lastOpponentRow: -1,
    timerInterval: null, startedAt: null, lastRoom: null,
  });
  document.getElementById('input-code').value = '';
  document.getElementById('btn-join').disabled = false;
  clearJoinError();
}
