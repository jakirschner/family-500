import os
import random
from flask import Flask, render_template, request, redirect, url_for, abort, session, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room

from rooms import store, deal_new_hand, Player, TEAM_OF, SEATS, next_unplayed
from scoring import score_hand, BID_VALUES

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', 'dev-secret-change-me')
JOIN_PASSCODE = os.environ.get('JOIN_PASSCODE', '')

socketio = SocketIO(app, cors_allowed_origins='*', async_mode='eventlet')


@app.route('/')
def lobby():
    return render_template('lobby.html', passcode_required=bool(JOIN_PASSCODE))


@app.post('/create')
def create_room():
    if JOIN_PASSCODE and request.form.get('passcode') != JOIN_PASSCODE:
        return render_template('lobby.html', passcode_required=True, error='Wrong passcode.'), 403
    name = (request.form.get('name') or '').strip() or 'Player'
    session['name'] = name
    room = store.create()
    return redirect(url_for('room_view', code=room.code))


@app.post('/join')
def join_room_form():
    if JOIN_PASSCODE and request.form.get('passcode') != JOIN_PASSCODE:
        return render_template('lobby.html', passcode_required=True, error='Wrong passcode.'), 403
    name = (request.form.get('name') or '').strip() or 'Player'
    code = (request.form.get('code') or '').strip().upper()
    if not store.get(code):
        return render_template('lobby.html', passcode_required=bool(JOIN_PASSCODE), error=f'Room {code} not found.'), 404
    session['name'] = name
    return redirect(url_for('room_view', code=code))


@app.route('/room/<code>')
def room_view(code):
    code = code.upper()
    room = store.get(code)
    if not room:
        abort(404)
    name = session.get('name', 'Player')
    return render_template('game.html', code=code, name=name)


@socketio.on('hello')
def on_hello(data):
    code = (data or {}).get('code', '').upper()
    name = (data or {}).get('name', 'Player')
    room = store.get(code)
    if not room:
        emit('error_msg', {'msg': 'Room not found'})
        return
    room.players[request.sid] = Player(sid=request.sid, name=name)
    join_room(code)
    emit('state', room.snapshot_for(request.sid))
    emit('seats_update', {'seats': {s: p.name for s, p in room.by_seat().items()},
                          'open_seats': room.open_seats()},
         to=code)


@socketio.on('take_seat')
def on_take_seat(data):
    code = (data or {}).get('code', '').upper()
    seat = (data or {}).get('seat')
    room = store.get(code)
    if not room or seat not in SEATS:
        return
    if seat in {p.seat for p in room.players.values() if p.seat}:
        emit('error_msg', {'msg': f'Seat {seat} taken'})
        return
    p = room.players.get(request.sid)
    if not p:
        return
    p.seat = seat
    # If this fills the room and no dealer chosen yet, spin for first dealer.
    seated = room.by_seat()
    if len(seated) == 4 and room.dealer is None:
        room.dealer = random.choice(SEATS)
        socketio.emit('first_dealer', {
            'seat': room.dealer,
            'seats': {s: pl.name for s, pl in seated.items()},
        }, to=code)
    _broadcast_state(room)


@socketio.on('redeal')
def on_redeal(data):
    code = (data or {}).get('code', '').upper()
    room = store.get(code)
    if not room:
        return
    if len(room.by_seat()) < 4:
        emit('error_msg', {'msg': 'Need 4 players seated to redeal.'})
        return
    if room.bid:
        emit('error_msg', {'msg': 'A bid is already set — end the hand to start a new one.'})
        return
    if room.trick or room.tricks_taken['NS'] > 0 or room.tricks_taken['EW'] > 0:
        emit('error_msg', {'msg': 'Cards have already been played — cannot redeal.'})
        return
    deal_new_hand(room)
    _broadcast_state(room)


@socketio.on('deal')
def on_deal(data):
    code = (data or {}).get('code', '').upper()
    room = store.get(code)
    if not room:
        return
    if len(room.by_seat()) < 4:
        emit('error_msg', {'msg': 'Need 4 players seated to deal.'})
        return
    seat = room.seat_of(request.sid)
    if room.dealer and seat != room.dealer:
        dealer_name = _seat_name(room, room.dealer)
        emit('error_msg', {'msg': f"Only the dealer ({dealer_name}) can deal."})
        return
    deal_new_hand(room)
    _broadcast_state(room)


@socketio.on('play_card')
def on_play_card(data):
    code = (data or {}).get('code', '').upper()
    card_id = (data or {}).get('card_id')
    room = store.get(code)
    if not room:
        return
    seat = room.seat_of(request.sid)
    if not seat:
        return
    hand = room.hands.get(seat, [])
    idx = next((i for i, c in enumerate(hand) if _card_id(c) == card_id), -1)
    if idx < 0:
        return
    if seat in room.trick:
        emit('error_msg', {'msg': "You've already played to this trick."})
        return
    if room.to_play and room.to_play != seat:
        turn_name = _seat_name(room, room.to_play)
        emit('error_msg', {'msg': f"It's {turn_name}'s turn to play."})
        return
    card = hand.pop(idx)
    room.trick[seat] = card
    room.to_play = next_unplayed(seat, room.trick)
    _broadcast_state(room)


@socketio.on('recall_card')
def on_recall_card(data):
    code = (data or {}).get('code', '').upper()
    room = store.get(code)
    if not room:
        return
    seat = room.seat_of(request.sid)
    if not seat or seat not in room.trick:
        return
    card = room.trick.pop(seat)
    room.hands.setdefault(seat, []).append(card)
    room.to_play = seat
    _broadcast_state(room)


@socketio.on('take_trick')
def on_take_trick(data):
    code = (data or {}).get('code', '').upper()
    room = store.get(code)
    if not room:
        return
    seat = room.seat_of(request.sid)
    if not seat:
        emit('error_msg', {'msg': 'You must be seated to take a trick.'})
        return
    team = TEAM_OF[seat]
    if len(room.trick) != 4:
        emit('error_msg', {'msg': 'Trick is not complete yet.'})
        return
    room.tricks_taken[team] = room.tricks_taken.get(team, 0) + 1
    room.last_trick = dict(room.trick)
    room.last_trick_taker = team
    room.trick = {}
    room.to_play = None
    _broadcast_state(room)


@socketio.on('undo_take_trick')
def on_undo_take_trick(data):
    code = (data or {}).get('code', '').upper()
    room = store.get(code)
    if not room:
        return
    if not room.last_trick or not room.last_trick_taker:
        emit('error_msg', {'msg': 'Nothing to undo.'})
        return
    if room.trick:
        emit('error_msg', {'msg': 'A new trick has already started — can\'t undo.'})
        return
    team = room.last_trick_taker
    room.tricks_taken[team] = max(0, room.tricks_taken.get(team, 0) - 1)
    room.trick = dict(room.last_trick)
    room.last_trick = {}
    room.last_trick_taker = None
    room.to_play = None  # trick is full again; waiting for take-trick decision
    _broadcast_state(room)


@socketio.on('set_bid')
def on_set_bid(data):
    code = (data or {}).get('code', '').upper()
    seat = (data or {}).get('seat')
    tricks = (data or {}).get('tricks')
    suit = (data or {}).get('suit')
    room = store.get(code)
    if not room or seat not in SEATS or (tricks, suit) not in BID_VALUES:
        emit('error_msg', {'msg': 'Invalid bid.'})
        return
    was_no_bid = room.bid is None
    if not was_no_bid:
        bidder = room.bid['seat']
        if len(room.hands.get(bidder, [])) > 10 or room.discarded:
            emit('error_msg', {'msg': 'Bid is locked — the kitty has already been collected.'})
            return
    room.bid = {'seat': seat, 'tricks': tricks, 'suit': suit, 'value': BID_VALUES[(tricks, suit)]}
    room.to_play = None
    _broadcast_state(room)


@socketio.on('collect_kitty')
def on_collect_kitty(data):
    code = (data or {}).get('code', '').upper()
    room = store.get(code)
    if not room:
        return
    if not room.bid:
        emit('error_msg', {'msg': 'No bid set yet.'})
        return
    seat = room.seat_of(request.sid)
    if seat != room.bid['seat']:
        emit('error_msg', {'msg': 'Only the winning bidder can collect the kitty.'})
        return
    if not room.kitty:
        emit('error_msg', {'msg': 'Kitty already collected.'})
        return
    room.hands.setdefault(seat, []).extend(room.kitty)
    room.kitty = []
    room.to_play = None
    _broadcast_state(room)


@socketio.on('discard')
def on_discard(data):
    code = (data or {}).get('code', '').upper()
    card_ids = (data or {}).get('card_ids', [])
    room = store.get(code)
    if not room:
        return
    if not room.bid:
        emit('error_msg', {'msg': 'No bid set — cannot discard yet.'})
        return
    seat = room.seat_of(request.sid)
    if seat != room.bid['seat']:
        emit('error_msg', {'msg': 'Only the winning bidder can discard.'})
        return
    if not isinstance(card_ids, list) or len(card_ids) != 5:
        emit('error_msg', {'msg': 'Must discard exactly 5 cards.'})
        return
    hand = room.hands.get(seat, [])
    if len(hand) <= 10:
        emit('error_msg', {'msg': 'Nothing to discard.'})
        return
    used_indices = set()
    for cid in card_ids:
        idx = next((i for i, c in enumerate(hand)
                    if _card_id(c) == cid and i not in used_indices), -1)
        if idx < 0:
            emit('error_msg', {'msg': 'Card not in hand.'})
            return
        used_indices.add(idx)
    room.discarded = [hand[i] for i in used_indices]
    for i in sorted(used_indices, reverse=True):
        hand.pop(i)
    room.to_play = seat  # bidder leads the first trick
    _broadcast_state(room)


@socketio.on('recall_discards')
def on_recall_discards(data):
    code = (data or {}).get('code', '').upper()
    room = store.get(code)
    if not room:
        return
    seat = room.seat_of(request.sid)
    if not room.bid or seat != room.bid['seat']:
        emit('error_msg', {'msg': 'Only the winning bidder can recall discards.'})
        return
    if not room.discarded:
        emit('error_msg', {'msg': 'No discards to recall.'})
        return
    if room.trick or room.tricks_taken['NS'] > 0 or room.tricks_taken['EW'] > 0:
        emit('error_msg', {'msg': 'Too late — a card has already been played.'})
        return
    recalled_ids = [_card_id(c) for c in room.discarded]
    room.hands.setdefault(seat, []).extend(room.discarded)
    room.discarded = []
    room.to_play = None
    emit('discards_recalled', {'card_ids': recalled_ids})
    _broadcast_state(room)


@socketio.on('review_discards')
def on_review_discards(data):
    code = (data or {}).get('code', '').upper()
    room = store.get(code)
    if not room:
        return
    seat = room.seat_of(request.sid)
    if not room.bid or seat != room.bid['seat']:
        emit('error_msg', {'msg': 'Only the winning bidder can review discards.'})
        return
    if not room.discarded:
        emit('error_msg', {'msg': 'No discards to review.'})
        return
    if room.trick or room.tricks_taken['NS'] > 0 or room.tricks_taken['EW'] > 0:
        emit('error_msg', {'msg': 'Too late — a card has already been played.'})
        return
    emit('discards_view', {'cards': room.discarded})


@socketio.on('end_hand')
def on_end_hand(data):
    code = (data or {}).get('code', '').upper()
    bidder_tricks_taken = (data or {}).get('bidder_tricks_taken')
    room = store.get(code)
    if not room or not room.bid:
        emit('error_msg', {'msg': 'No bid set for this hand.'})
        return
    if not isinstance(bidder_tricks_taken, int) or not 0 <= bidder_tricks_taken <= 10:
        emit('error_msg', {'msg': 'Bidder tricks must be 0..10.'})
        return
    bidder_team = TEAM_OF[room.bid['seat']]
    deltas = score_hand(room.bid['tricks'], room.bid['suit'], bidder_team, bidder_tricks_taken)
    room.score['NS'] += deltas['NS']
    room.score['EW'] += deltas['EW']
    room.history.append({
        'dealer': room.dealer,
        'bid': room.bid,
        'bidder_team': bidder_team,
        'bidder_tricks_taken': bidder_tricks_taken,
        'delta': deltas,
        'totals': dict(room.score),
    })
    # clear per-hand state, rotate dealer, keep totals
    room.bid = None
    room.trick = {}
    room.last_trick = {}
    room.tricks_taken = {'NS': 0, 'EW': 0}
    room.hands = {}
    room.discarded = []
    room.dealer = SEATS[(SEATS.index(room.dealer) + 1) % 4] if room.dealer else 'S'
    _broadcast_state(room)


@socketio.on('review_last_trick')
def on_review_last_trick(data):
    code = (data or {}).get('code', '').upper()
    room = store.get(code)
    if not room:
        return
    emit('last_trick', {
        'last_trick': room.last_trick,
        'taker': room.last_trick_taker,
        'can_undo': bool(room.last_trick_taker) and not room.trick,
    })


@socketio.on('disconnect')
def on_disconnect():
    room = store.remove_player(request.sid)
    if room:
        _broadcast_state(room)


def _card_id(c):
    return f"{c['rank']}{c['suit']}"


def _seat_name(room, seat):
    p = room.by_seat().get(seat)
    return p.name if p else seat


def _broadcast_state(room):
    for sid in list(room.players.keys()):
        socketio.emit('state', room.snapshot_for(sid), to=sid)


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)), debug=True)
