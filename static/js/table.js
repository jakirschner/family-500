const SUIT_GLYPH = { S: '♠', C: '♣', D: '♦', H: '♥', NT: 'NT' };
const SEATS = ['N', 'E', 'S', 'W'];

const BID_VALUES = {
  '7S': 140,  '7C': 160,  '7D': 180,  '7H': 200,  '7NT': 220,
  '8S': 240,  '8C': 260,  '8D': 280,  '8H': 300,  '8NT': 320,
  '9S': 340,  '9C': 360,  '9D': 380,  '9H': 400,  '9NT': 420,
  '10S': 440, '10C': 460, '10D': 480, '10H': 500, '10NT': 520,
};

const body = document.body;
const code = body.dataset.code;
const name = body.dataset.name;

const socket = io({ transports: ['websocket', 'polling'] });

socket.on('connect', () => { socket.emit('hello', { code, name }); });

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

  renderBid();
  renderBadges();
  renderHand();
  renderOpponents();
  renderTrick();
  renderScorecard();

  document.getElementById('seat-picker').classList.toggle('show', !state.my_seat);
  updateSeatButtons();
}

function renderBid() {
  const disp = document.getElementById('bid-display');
  if (state.bid) {
    const { seat, tricks, suit, value } = state.bid;
    disp.textContent = `${seat} · ${tricks} ${SUIT_GLYPH[suit] || suit} · ${value}`;
  } else {
    disp.textContent = '— set bid —';
  }
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

function renderScorecard() {
  document.getElementById('total-ns').textContent = state.score.NS || 0;
  document.getElementById('total-ew').textContent = state.score.EW || 0;
  const body = document.getElementById('score-body');
  body.innerHTML = '';
  for (const h of state.history || []) {
    const tr = document.createElement('tr');
    const bidTxt = `${h.bidder_team} ${h.bid.tricks} ${SUIT_GLYPH[h.bid.suit] || h.bid.suit}`;
    const ns = h.delta.NS >= 0 ? `+${h.delta.NS}` : String(h.delta.NS).replace('-', '−');
    const ew = h.delta.EW >= 0 ? `+${h.delta.EW}` : String(h.delta.EW).replace('-', '−');
    tr.innerHTML = `<td>${h.dealer || ''}</td><td>${bidTxt}</td>` +
                   `<td class="v ns ${h.delta.NS < 0 ? 'neg' : ''}">${ns}</td>` +
                   `<td class="v ew ${h.delta.EW < 0 ? 'neg' : ''}">${ew}</td>`;
    body.appendChild(tr);
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

// ------- seat click handlers -------
document.querySelectorAll('.seat-btns button').forEach(btn => {
  btn.addEventListener('click', () => {
    socket.emit('take_seat', { code, seat: btn.dataset.seat });
  });
});

// ------- top-level buttons -------
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

// ------- bid modal -------
const bidModal = document.getElementById('bid-modal');
const bidSeat = document.getElementById('bid-seat');
const bidTricks = document.getElementById('bid-tricks');
const bidSuit = document.getElementById('bid-suit');
const bidValueEl = document.getElementById('bid-value');

function updateBidValue() {
  const key = `${bidTricks.value}${bidSuit.value}`;
  bidValueEl.textContent = BID_VALUES[key] || '—';
}
bidTricks.addEventListener('change', updateBidValue);
bidSuit.addEventListener('change', updateBidValue);

document.getElementById('btn-bid').addEventListener('click', () => {
  if (state?.bid) {
    bidSeat.value = state.bid.seat;
    bidTricks.value = String(state.bid.tricks);
    bidSuit.value = state.bid.suit;
  }
  updateBidValue();
  bidModal.classList.add('show');
});
document.getElementById('btn-bid-cancel').addEventListener('click', () => {
  bidModal.classList.remove('show');
});
document.getElementById('btn-bid-confirm').addEventListener('click', () => {
  socket.emit('set_bid', {
    code,
    seat: bidSeat.value,
    tricks: parseInt(bidTricks.value, 10),
    suit: bidSuit.value,
  });
  bidModal.classList.remove('show');
});

// ------- end-hand modal -------
const endModal = document.getElementById('end-modal');
const endTricks = document.getElementById('end-tricks');
const endBidSummary = document.getElementById('end-bid-summary');

document.getElementById('btn-end-hand').addEventListener('click', () => {
  if (!state?.bid) {
    alert('Set the winning bid first (click the bid panel at the top).');
    return;
  }
  const { seat, tricks, suit, value } = state.bid;
  const team = teamOf(seat);
  endBidSummary.textContent = `${team} bid ${tricks} ${SUIT_GLYPH[suit] || suit} (${value})`;
  endTricks.value = String(state.tricks_taken[team] || tricks);
  endModal.classList.add('show');
});
document.getElementById('btn-end-cancel').addEventListener('click', () => {
  endModal.classList.remove('show');
});
document.getElementById('btn-end-confirm').addEventListener('click', () => {
  socket.emit('end_hand', {
    code,
    bidder_tricks_taken: parseInt(endTricks.value, 10),
  });
  endModal.classList.remove('show');
});
