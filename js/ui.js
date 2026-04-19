// All DOM manipulation lives here — no game logic, no Firebase calls.

const ROWS = 6;
const COLS = 5;

// ── Screen management ──────────────────────────────────────────────────────────

export function showScreen(name) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  const screen = document.getElementById(`screen-${name}`);
  if (screen) screen.classList.add('active');
}

// ── Board initialisation ───────────────────────────────────────────────────────

export function initBoard(boardEl, isOpponent = false) {
  boardEl.innerHTML = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const tile = document.createElement('div');
      tile.className = 'tile' + (isOpponent ? ' opponent-tile' : '');
      tile.dataset.row = r;
      tile.dataset.col = c;
      const inner = document.createElement('div');
      inner.className = 'tile-inner';
      tile.appendChild(inner);
      boardEl.appendChild(tile);
    }
  }
}

function getTile(boardEl, row, col) {
  return boardEl.querySelector(`.tile[data-row="${row}"][data-col="${col}"]`);
}

function getRow(boardEl, row) {
  return Array.from({ length: COLS }, (_, c) => getTile(boardEl, row, c));
}

// ── Tile rendering ─────────────────────────────────────────────────────────────

export function setTileLetter(boardEl, row, col, letter) {
  const tile = getTile(boardEl, row, col);
  if (!tile) return;
  tile.querySelector('.tile-inner').textContent = letter ? letter.toUpperCase() : '';
  tile.dataset.letter = letter || '';
  if (letter) {
    tile.classList.remove('pop');
    void tile.offsetWidth; // reflow to restart animation
    tile.classList.add('pop');
  } else {
    tile.classList.remove('pop');
    delete tile.dataset.letter;
  }
}

// Reveal tiles one by one with a flip animation; calls onDone after last tile.
export function revealRow(boardEl, row, result, letters, isOpponent, onDone) {
  const tiles = getRow(boardEl, row);
  const FLIP_DURATION = 250; // ms per half-flip
  const STAGGER = 300;       // ms between each tile start

  tiles.forEach((tile, col) => {
    const delay = col * STAGGER;

    setTimeout(() => {
      const inner = tile.querySelector('.tile-inner');

      // Phase 1: flip tile face-down
      tile.classList.add('flip-in');
      inner.addEventListener('animationend', function onFlipIn() {
        inner.removeEventListener('animationend', onFlipIn);
        tile.classList.remove('flip-in');

        // Apply color and optionally letter while hidden
        tile.classList.add(result[col]);
        if (!isOpponent && letters) {
          inner.textContent = letters[col].toUpperCase();
        } else {
          inner.textContent = '';
        }

        // Phase 2: flip tile face-up showing color
        tile.classList.add('flip-out');
        inner.addEventListener('animationend', function onFlipOut() {
          inner.removeEventListener('animationend', onFlipOut);
          tile.classList.remove('flip-out');

          if (col === COLS - 1 && onDone) onDone();
        });
      });
    }, delay);
  });
}

// Bounce animation on a winning row
export function bounceRow(boardEl, row) {
  const tiles = getRow(boardEl, row);
  tiles.forEach((tile, col) => {
    setTimeout(() => {
      tile.classList.remove('bounce');
      void tile.offsetWidth;
      tile.classList.add('bounce');
    }, col * 100);
  });
}

// Shake animation for invalid guess
export function shakeRow(boardEl, row) {
  const tiles = getRow(boardEl, row);
  tiles.forEach(tile => {
    tile.classList.remove('row-shake');
    void tile.offsetWidth;
    tile.classList.add('row-shake');
    tile.addEventListener('animationend', () => tile.classList.remove('row-shake'), { once: true });
  });
}

// ── Keyboard ───────────────────────────────────────────────────────────────────

const KEY_PRIORITY = { correct: 3, present: 2, absent: 1 };

export function setKeyColor(letter, status) {
  const key = document.querySelector(`.key[data-key="${letter.toLowerCase()}"]`);
  if (!key) return;
  const current = key.dataset.status;
  if (current && KEY_PRIORITY[current] >= KEY_PRIORITY[status]) return;
  key.dataset.status = status;
  key.classList.remove('correct', 'present', 'absent');
  key.classList.add(status);
}

export function resetKeyboard() {
  document.querySelectorAll('.key').forEach(key => {
    key.classList.remove('correct', 'present', 'absent');
    delete key.dataset.status;
  });
}

// ── Lobby UI ───────────────────────────────────────────────────────────────────

export function showLobbyHost(shortCode) {
  document.getElementById('lobby-host').classList.remove('hidden');
  const display = document.getElementById('code-display');
  display.textContent = shortCode;
}

export function setLobbyStatus(text) {
  document.getElementById('lobby-status-text').textContent = text;
}

// ── Game header ────────────────────────────────────────────────────────────────

export function setGameStatus(text) {
  document.getElementById('game-status-bar').textContent = text;
}

export function setOpponentLabel(name) {
  document.getElementById('opponent-label').textContent = name || 'Opponent';
}

// ── Results screen ─────────────────────────────────────────────────────────────

export function renderResults({ outcome, secretWord, selfGuesses, opponentGuesses }) {
  const headline = document.getElementById('result-headline');

  if (outcome === 'win') {
    headline.textContent = '🎉 You Win!';
    headline.className = 'result-headline win';
  } else if (outcome === 'lose') {
    headline.textContent = 'Opponent Wins!';
    headline.className = 'result-headline lose';
  } else {
    headline.textContent = "It's a Draw";
    headline.className = 'result-headline draw';
  }

  // Render the secret word tiles (all green)
  const wordEl = document.getElementById('result-word');
  wordEl.innerHTML = '';
  for (const letter of secretWord.toUpperCase()) {
    const tile = document.createElement('div');
    tile.className = 'tile correct';
    const inner = document.createElement('div');
    inner.className = 'tile-inner';
    inner.textContent = letter;
    tile.appendChild(inner);
    wordEl.appendChild(tile);
  }

  // Stats
  const statsEl = document.getElementById('result-stats');
  const selfStr = selfGuesses != null
    ? (selfGuesses <= 6 ? `${selfGuesses}/6` : 'X/6')
    : '—';
  const oppStr = opponentGuesses != null
    ? (opponentGuesses <= 6 ? `${opponentGuesses}/6` : 'X/6')
    : '—';
  statsEl.innerHTML = `Your guesses: <strong>${selfStr}</strong><br>Opponent guesses: <strong>${oppStr}</strong>`;
}

// ── Toast notifications ────────────────────────────────────────────────────────

export function showToast(message, duration = 1500) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}

// ── Join error ─────────────────────────────────────────────────────────────────

export function setJoinError(msg) {
  document.getElementById('join-error').textContent = msg;
}

export function clearJoinError() {
  document.getElementById('join-error').textContent = '';
}
