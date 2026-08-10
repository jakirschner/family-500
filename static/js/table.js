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

const SUIT_ORDER = { H: 0, C: 1, D: 2, S: 3 };
const RANK_ORDER = {
  J: 0, A: 1, K: 2, Q: 3,
  '10': 4, '9': 5, '8': 6, '7': 7, '6': 8, '5': 9, '4': 10,
};

function cardKey(card) {
  return `${card.rank}${card.suit}`;
}

function sortCards(cards) {
  const copy = cards.slice();
  copy.sort((a, b) => {
    const aJ = a.suit === 'JOKER';
    const bJ = b.suit === 'JOKER';
    if (aJ && bJ) return 0;
    if (aJ) return -1;
    if (bJ) return 1;
    const s = (SUIT_ORDER[a.suit] ?? 99) - (SUIT_ORDER[b.suit] ?? 99);
    if (s !== 0) return s;
    return (RANK_ORDER[a.rank] ?? 99) - (RANK_ORDER[b.rank] ?? 99);
  });
  return copy;
}

const body = document.body;
const code = body.dataset.code;
const name = body.dataset.name;

const socket = io({ transports: ['websocket', 'polling'] });

socket.on('connect', () => { socket.emit('hello', { code, name }); });

socket.on('error_msg', (data) => {
  console.warn('server:', data.msg);
  showToast(data.msg, { type: 'error' });
});
socket.on('info_msg', (data) => {
  showToast(data.msg, { type: 'info-strong', duration: 4000 });
});

function showToast(msg, { type = 'info', duration = 3200 } = {}) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 200);
  }, duration);
}

let isMuted = localStorage.getItem('muted500') === 'true';

const SOUNDS = {};
for (const name of ['shuffle', 'deal', 'playcard', 'taketrick']) {
  const a = new Audio(`/static/sounds/${name}.mp3`);
  a.preload = 'auto';
  SOUNDS[name] = a;
}

function playSound(name) {
  if (isMuted) return;
  const a = SOUNDS[name];
  if (!a) return;
  a.currentTime = 0;
  a.play().catch(() => {});
}

socket.on('sound', ({ name }) => { playSound(name); });

const muteBtn = document.getElementById('btn-mute');
function updateMuteBtn() {
  muteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
  muteBtn.classList.toggle('muted', isMuted);
}
updateMuteBtn();
muteBtn.addEventListener('click', () => {
  isMuted = !isMuted;
  localStorage.setItem('muted500', String(isMuted));
  updateMuteBtn();
});

let state = null;
let selectedCardId = null;
let selectedDiscards = new Set();  // card ids selected for discard (up to 5)
let firstBidHandShown = null;  // hand_id we've already shown "you bid first" for
let bidAutoOpenedHand = null;  // hand_id we've already auto-opened bid modal for
let handOrder = [];         // card IDs in player's chosen display order (includes dead slots)
let handOrderHandId = null; // hand_id handOrder was last built for

socket.on('state', (s) => {
  state = s;
  render();
});

socket.on('first_dealer', ({ seat, seats }) => {
  runDealerSpinner(seat, seats || {});
});

function runDealerSpinner(finalSeat, seatNames) {
  const overlay = document.getElementById('dealer-spinner');
  const order = ['N', 'E', 'S', 'W'];
  for (const s of order) {
    const tile = document.querySelector(`.spin-tile[data-seat="${s}"]`);
    if (!tile) continue;
    tile.classList.remove('active');
    tile.querySelector('.spin-name').textContent = seatNames[s] || '';
  }
  const resultEl = document.getElementById('spinner-result');
  resultEl.textContent = '';
  overlay.classList.add('show');

  const finalIdx = order.indexOf(finalSeat);
  const baseSteps = 13;
  const totalSteps = baseSteps + ((finalIdx - ((baseSteps - 1) % 4) + 4) % 4);
  let step = 0;
  const highlight = (idx) => {
    order.forEach((s, k) => {
      const el = document.querySelector(`.spin-tile[data-seat="${s}"]`);
      if (el) el.classList.toggle('active', k === idx);
    });
  };
  const tick = () => {
    highlight(step % 4);
    step++;
    if (step < totalSteps) {
      const delay = 70 + step * 30;
      setTimeout(tick, delay);
    } else {
      const name = seatNames[finalSeat] || finalSeat;
      resultEl.textContent = `${name} (${finalSeat}) deals first`;
      setTimeout(() => {
        overlay.classList.remove('show');
      }, 2200);
    }
  };
  tick();
}

socket.on('game_won', ({ winner, scores, seats }) => {
  const myTeam = state && state.my_team;
  const won = myTeam === winner;
  const headline = document.getElementById('win-headline');
  const message = document.getElementById('win-message');
  headline.textContent = won ? 'You win!' : `${winner} wins!`;
  if (won && state && state.my_seat) {
    const partnerSeat = { N: 'S', S: 'N', E: 'W', W: 'E' }[state.my_seat];
    const partnerName = (seats && seats[partnerSeat]) || partnerSeat;
    message.textContent = `You and ${partnerName} win! Congratulations!`;
  } else {
    message.textContent = 'Better luck next time!';
  }
  for (const team of ['NS', 'EW']) {
    document.getElementById(`win-pts-${team.toLowerCase()}`).textContent = scores[team] || 0;
    document.getElementById(`win-team-${team.toLowerCase()}`).textContent = team;
    document.getElementById(`win-score-${team.toLowerCase()}`)?.classList.toggle('winner', team === winner);
  }
  document.getElementById('win-modal').classList.add('show');
  if (won && typeof confetti !== 'undefined') {
    confetti({ particleCount: 150, spread: 80, origin: { y: 0.5 } });
    setTimeout(() => confetti({ particleCount: 80, spread: 60, origin: { x: 0.1, y: 0.6 } }), 400);
    setTimeout(() => confetti({ particleCount: 80, spread: 60, origin: { x: 0.9, y: 0.6 } }), 700);
  }
});

socket.on('discards_view', ({ cards }) => {
  const row = document.getElementById('discard-review-row');
  row.innerHTML = '';
  for (const c of cards || []) {
    const el = cardEl(c, { playable: false });
    row.appendChild(el);
  }
  document.getElementById('discard-review-modal').classList.add('show');
});

socket.on('discards_recalled', ({ card_ids }) => {
  document.getElementById('discard-review-modal').classList.remove('show');
  selectedDiscards = new Set(card_ids);
});

socket.on('last_trick', ({ last_trick, taker, can_undo }) => {
  if (!last_trick || Object.keys(last_trick).length === 0) {
    showToast('No previous trick to review yet.');
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
  const takerEl = document.getElementById('review-taker');
  takerEl.textContent = taker ? `Taken by ${taker}` : '';
  const undoBtn = document.getElementById('btn-review-undo');
  undoBtn.style.display = can_undo ? '' : 'none';
  document.getElementById('review-modal').classList.add('show');
});

function render() {
  if (!state) return;

  document.getElementById('room-code').textContent = `Room: ${state.code}`;
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
  maybeAutoOpenBid();

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

function canCollectKitty() {
  return !!(state.bid && state.my_seat === state.bid.seat && (state.kitty_size || 0) > 0);
}

function inDiscardPhase() {
  if (!state.bid) return false;
  const counts = state.hand_counts || {};
  return (counts[state.bid.seat] || 0) > 10;
}

function isMyDiscardTurn() {
  return inDiscardPhase() && state.my_seat === state.bid.seat;
}

function anyCardPlayedThisHand() {
  if (state.trick && Object.keys(state.trick).length > 0) return true;
  const t = state.tricks_taken || {};
  return (t.NS || 0) > 0 || (t.EW || 0) > 0;
}

function canPlayCards() {
  if (!state || !state.bid) return false;
  if ((state.kitty_size || 0) > 0) return false;
  const counts = state.hand_counts || {};
  if ((counts[state.bid.seat] || 0) > 10) return false;
  return true;
}

function renderStatus() {
  const el = document.getElementById('turn-status');
  if (!el) return;
  el.className = 'turn-status';
  let text = '';
  let mine = false;
  if (!handIsDealt()) {
    // dealer's "click deal" message is now the centered Deal button, not turn-status.
    if (state.my_seat && state.my_seat !== state.dealer && state.dealer) {
      text = `Waiting on ${nameOf(state.dealer)} to deal`;
    }
  } else if (state.bid && (state.kitty_size || 0) > 0 && !canCollectKitty()) {
    text = `Waiting on ${nameOf(state.bid.seat)} to collect the kitty`;
  } else if (inDiscardPhase()) {
    // bidder sees the center-discard button; others see waiting text.
    if (!isMyDiscardTurn()) {
      text = `Waiting on ${nameOf(state.bid.seat)} to discard`;
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
  const takeTrick = document.getElementById('btn-take-trick');
  if (takeTrick) takeTrick.disabled = !full;
  const dealModal = document.getElementById('deal-modal');
  if (dealModal) {
    const isDealer = state.my_seat && state.my_seat === state.dealer;
    dealModal.classList.toggle('show', !!(isDealer && !handIsDealt()));
  }
  const collectModal = document.getElementById('collect-kitty-modal');
  if (collectModal) collectModal.classList.toggle('show', canCollectKitty());

  const discardModal = document.getElementById('discard-modal');
  if (discardModal) {
    discardModal.classList.toggle('show', isMyDiscardTurn());
    const count = selectedDiscards.size;
    const countEl = document.getElementById('discard-modal-count');
    if (countEl) countEl.textContent = `${count} / 5 selected`;
    const confirmBtn = document.getElementById('btn-discard-confirm');
    if (confirmBtn) confirmBtn.disabled = count !== 5;
  }
  const redeal = document.getElementById('btn-redeal');
  if (redeal) {
    const canRedeal = handIsDealt() && !state.bid && !anyCardPlayedThisHand()
                      && !inDiscardPhase() && state.my_seat === state.dealer;
    redeal.style.display = canRedeal ? '' : 'none';
  }
  const rd = document.getElementById('btn-review-discards');
  if (rd) {
    const canReview = !!(state.bid && state.my_seat === state.bid.seat
                         && (state.discards_count || 0) > 0
                         && !anyCardPlayedThisHand());
    rd.style.display = canReview ? '' : 'none';
  }
}

function maybeShowFirstBidder() {
  if (!state.my_seat) return;
  if (!state.dealer || !state.hand_id) return;
  if (!handIsDealt() || state.bid) return;
  if (leftOfDealer() !== state.my_seat) return;
  if (firstBidHandShown === state.hand_id) return;
  firstBidHandShown = state.hand_id;
  showToast("You bid first — bidding opens with you.", { type: 'info-strong', duration: 5000 });
}

function maybeAutoOpenBid() {
  if (!state.my_seat) return;
  if (!state.dealer || !state.hand_id) return;
  if (!handIsDealt() || state.bid) return;
  if (state.my_seat !== state.dealer) return;
  if (bidAutoOpenedHand === state.hand_id) return;
  bidAutoOpenedHand = state.hand_id;
  openBidModal();
}

function openBidModal() {
  document.getElementById('btn-bid-reset').style.display = state?.bid ? '' : 'none';
  bidSeat.innerHTML = '';
  for (const s of SEATS) {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = (state.seats && state.seats[s]) ? `${state.seats[s]} (${s})` : s;
    bidSeat.appendChild(opt);
  }
  if (state?.bid) {
    bidSeat.value = state.bid.seat;
    bidTricks.value = String(state.bid.tricks);
    bidSuit.value = state.bid.suit;
  } else if (state?.my_seat) {
    bidSeat.value = state.my_seat;
  }
  updateBidValue();
  bidModal.classList.add('show');
}

function renderBid() {
  const disp = document.getElementById('bid-display');
  if (state.bid) {
    const { seat, tricks, suit, value } = state.bid;
    disp.textContent = `${nameOf(seat)} · ${tricks} ${SUIT_GLYPH[suit] || suit} · ${value}`;
  } else {
    disp.textContent = '— set bid —';
  }
  const btnBid = document.getElementById('btn-bid');
  if (btnBid) btnBid.classList.toggle('static', state.my_seat !== state.dealer);
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

function updateHandOrder(cards) {
  const currentSet = new Set(cards.map(cardKey));
  if (state.hand_id !== handOrderHandId) {
    // New deal — fresh sort.
    handOrder = sortCards(cards).map(cardKey);
  } else {
    // Same hand: dead IDs (played/discarded) stay in handOrder as sticky slots so
    // recalled cards return to the same position. Only insert genuinely new cards
    // (kitty collect) at their sorted position among currently visible cards.
    const existingSet = new Set(handOrder);
    const newCards = cards.filter(c => !existingSet.has(cardKey(c)));
    if (newCards.length > 0) {
      const fullSorted = sortCards(cards).map(cardKey);
      const visibleSet = new Set(handOrder.filter(id => currentSet.has(id)));
      const placed = new Set(visibleSet);
      for (const newCard of sortCards(newCards)) {
        const newId = cardKey(newCard);
        const idxInSorted = fullSorted.indexOf(newId);
        let insertAfter = -1;
        for (let i = idxInSorted - 1; i >= 0; i--) {
          const priorId = fullSorted[i];
          if (placed.has(priorId)) {
            insertAfter = handOrder.indexOf(priorId);
            break;
          }
        }
        handOrder.splice(insertAfter + 1, 0, newId);
        placed.add(newId);
      }
    }
    // (no else — dead IDs already in handOrder, renderHand skips them automatically)
  }
  handOrderHandId = state.hand_id;
}

function renderHand() {
  const container = document.getElementById('hand-bottom');
  container.innerHTML = '';
  if (!state.my_seat) return;
  updateHandOrder(state.my_hand);
  const cardById = new Map(state.my_hand.map(c => [cardKey(c), c]));
  const handIds = new Set(cardById.keys());
  const discardMode = isMyDiscardTurn();
  if (discardMode) {
    selectedCardId = null;
    for (const id of Array.from(selectedDiscards)) {
      if (!handIds.has(id)) selectedDiscards.delete(id);
    }
  } else {
    selectedDiscards.clear();
    if (selectedCardId && !handIds.has(selectedCardId)) selectedCardId = null;
    if (state.to_play && state.to_play !== state.my_seat) selectedCardId = null;
  }
  for (const id of handOrder) {
    const card = cardById.get(id);
    if (!card) continue;
    const el = cardEl(card, { playable: true, discardMode });
    if (discardMode) {
      if (selectedDiscards.has(id)) el.classList.add('selected');
    } else if (id === selectedCardId) {
      el.classList.add('selected');
    }
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
  const ns = state.score.NS || 0;
  const ew = state.score.EW || 0;
  document.getElementById('total-ns').textContent = ns;
  document.getElementById('total-ew').textContent = ew;
  const nsWon = ns >= 1000, ewWon = ew >= 1000;
  document.querySelector('.team-total.ns').classList.toggle('winner', nsWon);
  document.querySelector('.team-total.ew').classList.toggle('winner', ewWon);
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

function cardEl(card, { playable, discardMode = false }) {
  const el = document.createElement('div');
  el.dataset.cardId = cardKey(card);
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
      if (discardMode) {
        if (selectedDiscards.has(id)) {
          selectedDiscards.delete(id);
        } else if (selectedDiscards.size >= 5) {
          showToast('5 already selected — deselect one first.', { type: 'error' });
          return;
        } else {
          selectedDiscards.add(id);
        }
        renderHand();
        renderTakeButtons();
        return;
      }
      if (!canPlayCards()) {
        showToast('Waiting on the kitty to be discarded.', { type: 'error' });
        return;
      }
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
document.getElementById('btn-deal-confirm').addEventListener('click', () => {
  socket.emit('deal', { code });
});
document.getElementById('btn-collect-kitty-confirm').addEventListener('click', () => {
  socket.emit('collect_kitty', { code });
});
document.getElementById('btn-discard-confirm').addEventListener('click', () => {
  if (selectedDiscards.size !== 5) return;
  socket.emit('discard', { code, card_ids: Array.from(selectedDiscards) });
  selectedDiscards.clear();
});
document.getElementById('btn-collapse-score').addEventListener('click', () => {
  document.getElementById('app').classList.add('scorecard-collapsed');
  document.getElementById('btn-score-tab').style.display = '';
});
document.getElementById('btn-score-tab').addEventListener('click', () => {
  document.getElementById('app').classList.remove('scorecard-collapsed');
  document.getElementById('btn-score-tab').style.display = 'none';
});
document.getElementById('btn-redeal').addEventListener('click', () => {
  socket.emit('redeal', { code });
});
document.getElementById('btn-review-discards').addEventListener('click', () => {
  socket.emit('review_discards', { code });
});
document.getElementById('btn-discard-review-recall').addEventListener('click', () => {
  socket.emit('recall_discards', { code });
});
document.getElementById('btn-discard-review-close').addEventListener('click', () => {
  document.getElementById('discard-review-modal').classList.remove('show');
});
document.getElementById('btn-take-trick').addEventListener('click', () => {
  socket.emit('take_trick', { code });
});
document.getElementById('btn-review').addEventListener('click', () => {
  socket.emit('review_last_trick', { code });
});
document.getElementById('btn-review-close').addEventListener('click', () => {
  document.getElementById('review-modal').classList.remove('show');
});
document.getElementById('btn-review-undo').addEventListener('click', () => {
  socket.emit('undo_take_trick', { code });
  document.getElementById('review-modal').classList.remove('show');
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
  if (state?.bid && (state.kitty_size || 0) === 0 && handIsDealt()) {
    showToast('Bidding is locked — the kitty has been collected.', { type: 'error' });
    return;
  }
  openBidModal();
});
document.getElementById('btn-bid-reset').addEventListener('click', () => {
  socket.emit('clear_bid', { code });
  bidModal.classList.remove('show');
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
    showToast('Set the winning bid first (click the bid panel at the top).', { type: 'error' });
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
document.getElementById('btn-new-game').addEventListener('click', () => {
  socket.emit('new_game', { code });
  document.getElementById('win-modal').classList.remove('show');
});
document.getElementById('btn-end-confirm').addEventListener('click', () => {
  socket.emit('end_hand', {
    code,
    bidder_tricks_taken: parseInt(endTricks.value, 10),
  });
  endModal.classList.remove('show');
});

// ------- drag-to-reorder hand -------
if (typeof Sortable !== 'undefined') {
  const handEl = document.getElementById('hand-bottom');
  if (handEl) {
    Sortable.create(handEl, {
      animation: 150,
      draggable: '.card',
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onEnd: () => {
        const newVisible = Array.from(handEl.querySelectorAll('.card'))
          .map(el => el.dataset.cardId)
          .filter(Boolean);
        // Replace visible slots in handOrder with the new drag order,
        // leaving dead (played/discarded) slot IDs at their positions.
        const handIds = new Set(state && state.my_hand ? state.my_hand.map(cardKey) : []);
        let vIdx = 0;
        handOrder = handOrder.map(id => handIds.has(id) ? newVisible[vIdx++] : id);
      },
    });
  }
}
