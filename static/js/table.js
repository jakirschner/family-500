const SUIT_GLYPH = { S: '♠', C: '♣', D: '♦', H: '♥' };
const SEATS = ['N', 'E', 'S', 'W'];

const body = document.body;
const code = body.dataset.code;
const name = body.dataset.name;

const socket = io({ transports: ['websocket', 'polling'] });

socket.on('connect', () => {
  socket.emit('hello', { code, name });
});

socket.on('error_msg', (data) => {
  console.warn('server:', data.msg);
  alert(data.msg);
});

let state = null;

socket.on('state', (s) => {
  state = s;
  render();
});

socket.on('last_trick', ({ last_trick }) => {
  if (!last_trick || Object.keys(last_trick).length === 0) {
    alert('No previous trick to review yet.');
    return;
  }
  const rows = SEATS.map(seat => {
    const c = last_trick[seat];
    return `${seat}: ${c ? c.rank + (SUIT_GLYPH[c.suit] || '') : '—'}`;
  }).join('\n');
  alert('Last trick:\n' + rows);
});

function render() {
  if (!state) return;

  document.getElementById('room-code').textContent = state.code;
  document.getElementById('tc-ns').textContent = state.tricks_taken.NS || 0;
  document.getElementById('tc-ew').textContent = state.tricks_taken.EW || 0;

  renderBadges();
  renderHand();
  renderOpponents();
  renderTrick();

  document.getElementById('seat-picker').classList.toggle('show', !state.my_seat);
  updateSeatButtons();
}

function renderBadges() {
  const seats = state.seats || {};
  for (const s of SEATS) {
    const el = document.getElementById(`seat-${s.toLowerCase()}-badge`);
    if (!el) continue;
    const label = seats[s] || 'empty';
    const dealerMark = state.dealer === s ? ' · D' : '';
    if (s === state.my_seat) {
      el.textContent = `YOU · ${label} · TEAM ${state.my_team}${dealerMark}`;
    } else {
      const teamTag = seats[s] ? ` (${teamOf(s)})` : '';
      el.textContent = `${s} · ${label}${teamTag}${dealerMark}`;
    }
  }
}

function teamOf(seat) { return (seat === 'N' || seat === 'S') ? 'NS' : 'EW'; }

function renderHand() {
  const container = document.getElementById('hand-s');
  container.innerHTML = '';
  if (!state.my_seat) return;
  for (const card of state.my_hand) {
    container.appendChild(cardEl(card, { playable: true }));
  }
}

function renderOpponents() {
  for (const seat of ['N', 'E', 'W']) {
    const el = document.getElementById(`hand-${seat.toLowerCase()}`);
    if (!el) continue;
    const count = (state.hand_counts && state.hand_counts[seat]) || 0;
    el.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const back = document.createElement('div');
      back.className = 'card-back';
      el.appendChild(back);
    }
  }
}

function renderTrick() {
  for (const seat of SEATS) {
    const slot = document.querySelector(`.trick-slot[data-seat="${seat}"]`);
    slot.innerHTML = '';
    const c = state.trick && state.trick[seat];
    if (c) slot.appendChild(cardEl(c, { playable: false }));
    else {
      const label = document.createElement('span');
      label.className = 'seat-label';
      label.textContent = seat;
      slot.appendChild(label);
    }
  }
}

function cardEl(card, { playable }) {
  const el = document.createElement('div');
  if (card.suit === 'JOKER') {
    el.className = 'card joker';
    el.innerHTML = `<div class="rank">JKR</div><div class="suit">★</div>`;
  } else {
    el.className = `card suit-${card.suit}`;
    el.innerHTML = `<div class="rank">${card.rank}</div><div class="suit">${SUIT_GLYPH[card.suit]}</div>`;
  }
  if (playable) {
    el.addEventListener('click', () => {
      const id = `${card.rank}${card.suit}`;
      socket.emit('play_card', { code, card_id: id });
    });
  }
  return el;
}

function updateSeatButtons() {
  const open = new Set(state.open_seats || []);
  document.querySelectorAll('.seat-btns button').forEach(btn => {
    const seat = btn.dataset.seat;
    btn.disabled = !open.has(seat);
  });
}

document.querySelectorAll('.seat-btns button').forEach(btn => {
  btn.addEventListener('click', () => {
    socket.emit('take_seat', { code, seat: btn.dataset.seat });
  });
});

document.getElementById('btn-deal').addEventListener('click', () => {
  socket.emit('deal', { code });
});
document.getElementById('btn-ns-took').addEventListener('click', () => {
  socket.emit('take_trick', { code, team: 'NS' });
});
document.getElementById('btn-ew-took').addEventListener('click', () => {
  socket.emit('take_trick', { code, team: 'EW' });
});
document.getElementById('btn-review').addEventListener('click', () => {
  socket.emit('review_last_trick', { code });
});
