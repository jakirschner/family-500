const SUIT_GLYPH = { S: '♠', C: '♣', D: '♦', H: '♥', NT: 'NT' };
const SEATS = ['N', 'E', 'S', 'W'];
const CLOCKWISE = ['N', 'E', 'S', 'W'];

function positions(mySeat) {
  // Given the viewer's compass seat, return which compass seat sits
  // at each visual position: bottom (viewer), left (next clockwise),
  // top (across), right (previous clockwise).
  const anchor = mySeat && CLOCKWISE.includes(mySeat) ? mySeat : 'S';
  const i = CLOCKWISE.indexOf(anchor);
  return {
    bottom: CLOCKWISE[i],
    left:   CLOCKWISE[(i + 1) % 4],
    top:    CLOCKWISE[(i + 2) % 4],
    right:  CLOCKWISE[(i + 3) % 4],
  };
}

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
let selectedCardId = null;
let firstBidHandShown = null;  // hand_id we've already shown "you bid first" for

socket.on('state', (s) => {
  state = s;
  render();
});

socket.on('last_trick', ({ last_trick }) => {
  if (!last_trick || Object.keys(last_trick).length === 0) {
    alert('No previous trick to review yet.');
    return;
  }
  const pos = positions(state && state.my_seat);
  for (const p of ['top', 'left', 'right', 'bottom']) {
    const slot = document.querySelector(`#review-modal .review-slot[data-pos="${p}"]`);
    if (!slot) continue;
    slot.innerHTML = '';
    slot.classList.remove('empty');
    const seat = pos[p];
    const tag = document.createElement('div');
    tag.className = 'seat-tag';
    tag.textContent = seat;
    slot.appendChild(tag);
    const c = last_trick[seat];
    if (c) {
      slot.appendChild(cardEl(c, { playable: false }));
    } else {
      slot.classList.add('empty');
      const dash = document.createElement('div');
      dash.textContent = '—';
      slot.appendChild(dash);
    }
  }
  document.getElementById('review-modal').classList.add('show');
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
  renderStatus();
  renderTakeButtons();
  renderScorecard();
  maybeShowFirstBidder();

  document.getElementById('seat-picker').classList.toggle('show', !state.my_seat);
  updateSeatButtons();
}

function nameOf(seat) {
  return (state.seats && state.seats[seat]) || seat;
}

function leftOfDealer() {
  if (!state.dealer) return null;
  const i = CLOCKWISE.indexOf(state.dealer);
  return i < 0 ? null : CLOCKWISE[(i + 1) % 4];
}

function handIsDealt() {
  const counts = state.hand_counts || {};
  return SEATS.some(s => (counts[s] || 0) > 0);
}

function renderStatus() {
  const el = document.getElementById('turn-status');
  if (!el) return;
  el.className = 'turn-status';
  let text = '';
  let mine = false;
  if (!handIsDealt()) {
    if (state.my_seat && state.my_seat === state.dealer) {
      text = "You're dealing — click Deal";
      mine = true;
    } else if (state.dealer) {
      text = `Waiting on ${nameOf(state.dealer)} to deal`;
    }
  } else if (state.to_play) {
    if (state.to_play === state.my_seat) {
      text = 'Your turn';
      mine = true;
    } else {
      text = `Waiting on ${nameOf(state.to_play)}`;
    }
  } else if (state.trick && Object.keys(state.trick).length === 4) {
    text = 'Trick complete — record who took it';
  }
  el.textContent = text;
  if (mine) el.classList.add('mine');
  el.classList.toggle('empty', !text);
}

function renderTakeButtons() {
  const full = state.trick && Object.keys(state.trick).length === 4;
  for (const id of ['btn-ns-took', 'btn-ew-took']) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !full;
  }
}

function maybeShowFirstBidder() {
  if (!state.my_seat) return;
  if (!handIsDealt() || state.bid) return;
  if (leftOfDealer() !== state.my_seat) return;
  if (firstBidHandShown === state.hand_id) return;
  firstBidHandShown = state.hand_id;
  document.getElementById('firstbid-modal').classList.add('show');
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
  const pos = positions(state.my_seat);
  for (const p of ['top', 'left', 'right', 'bottom']) {
    const el = document.getElementById(`slot-${p}-badge`);
    if (!el) continue;
    const seat = pos[p];
    const label = seats[seat] || 'empty';
    const dealerMark = state.dealer === seat ? ' · D' : '';
    if (state.my_seat && p === 'bottom') {
      el.textContent = `YOU · ${label} · ${seat} · TEAM ${state.my_team}${dealerMark}`;
    } else {
      const teamTag = seats[seat] ? ` (${teamOf(seat)})` : '';
      el.textContent = `${seat} · ${label}${teamTag}${dealerMark}`;
    }
  }
}

function teamOf(seat) { return (seat === 'N' || seat === 'S') ? 'NS' : 'EW'; }

function renderHand() {
  const container = document.getElementById('hand-bottom');
  container.innerHTML = '';
  if (!state.my_seat) return;
  const handIds = new Set(state.my_hand.map(c => `${c.rank}${c.suit}`));
  if (selectedCardId && !handIds.has(selectedCardId)) selectedCardId = null;
  if (state.to_play && state.to_play !== state.my_seat) selectedCardId = null;
  for (const card of state.my_hand) {
    const id = `${card.rank}${card.suit}`;
    const el = cardEl(card, { playable: true });
    if (id === selectedCardId) el.classList.add('selected');
    container.appendChild(el);
  }
}

function renderOpponents() {
  const pos = positions(state.my_seat);
  for (const p of ['top', 'left', 'right']) {
    const el = document.getElementById(`hand-${p}`);
    if (!el) continue;
    el.innerHTML = '';
    if (!state.my_seat) continue;
    const seat = pos[p];
    const count = (state.hand_counts && state.hand_counts[seat]) || 0;
    for (let i = 0; i < count; i++) {
      const back = document.createElement('div');
      back.className = 'card-back';
      el.appendChild(back);
    }
  }
}

function renderTrick() {
  const pos = positions(state.my_seat);
  for (const p of ['top', 'left', 'right', 'bottom']) {
    const slot = document.querySelector(`.trick-slot[data-pos="${p}"]`);
    if (!slot) continue;
    slot.innerHTML = '';
    const seat = pos[p];
    const c = state.trick && state.trick[seat];
    if (c) {
      const el = cardEl(c, { playable: false });
      if (p === 'bottom' && state.my_seat) {
        el.classList.add('recallable');
        el.title = 'Click to take back';
        el.addEventListener('click', () => {
          socket.emit('recall_card', { code });
        });
      }
      slot.appendChild(el);
    } else {
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
    const id = `${card.rank}${card.suit}`;
    el.addEventListener('click', () => {
      if (selectedCardId === id) {
        selectedCardId = null;
        socket.emit('play_card', { code, card_id: id });
      } else {
        const prev = document.querySelector('#hand-bottom .card.selected');
        if (prev) prev.classList.remove('selected');
        selectedCardId = id;
        el.classList.add('selected');
      }
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
document.getElementById('btn-review-close').addEventListener('click', () => {
  document.getElementById('review-modal').classList.remove('show');
});
document.getElementById('btn-firstbid-ok').addEventListener('click', () => {
  document.getElementById('firstbid-modal').classList.remove('show');
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
