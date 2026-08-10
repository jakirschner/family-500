"""In-memory room + game state. Single-process (Railway default worker = 1)."""
import random
import string
from dataclasses import dataclass, field
from threading import Lock

from deck import deal as deal_deck

SEATS = ('N', 'E', 'S', 'W')
TEAM_OF = {'N': 'NS', 'S': 'NS', 'E': 'EW', 'W': 'EW'}
CLOCKWISE = ('N', 'E', 'S', 'W')


def next_seat(seat):
    return CLOCKWISE[(CLOCKWISE.index(seat) + 1) % 4]


def next_unplayed(seat, trick):
    """Next clockwise seat that hasn't played to this trick, or None if all four have."""
    for i in range(1, 5):
        s = CLOCKWISE[(CLOCKWISE.index(seat) + i) % 4]
        if s not in trick:
            return s
    return None


def _new_code():
    return ''.join(random.choices(string.ascii_uppercase, k=4))


@dataclass
class Player:
    sid: str
    name: str
    seat: str | None = None


@dataclass
class Room:
    code: str
    players: dict = field(default_factory=dict)  # sid -> Player
    hands: dict = field(default_factory=dict)    # seat -> list[card]
    kitty: list = field(default_factory=list)
    trick: dict = field(default_factory=dict)    # seat -> card (current trick on table)
    last_trick: dict = field(default_factory=dict)
    last_trick_taker: str | None = None  # 'NS' or 'EW', for undo
    tricks_taken: dict = field(default_factory=lambda: {'NS': 0, 'EW': 0})
    dealer: str | None = None
    score: dict = field(default_factory=lambda: {'NS': 0, 'EW': 0})
    history: list = field(default_factory=list)  # hand-by-hand scoring log
    bid: dict | None = None  # {'seat': 'S', 'tricks': 8, 'suit': 'H'}
    to_play: str | None = None  # seat whose turn it is to play (None = no active turn)
    hand_id: int = 0  # increments each deal; clients use for one-shot popups

    def seat_of(self, sid):
        p = self.players.get(sid)
        return p.seat if p else None

    def by_seat(self):
        return {p.seat: p for p in self.players.values() if p.seat}

    def open_seats(self):
        taken = {p.seat for p in self.players.values() if p.seat}
        return [s for s in SEATS if s not in taken]

    def snapshot_for(self, sid):
        """Public state for one client. Hides other players' hands."""
        my_seat = self.seat_of(sid)
        seat_players = {seat: p.name for seat, p in self.by_seat().items()}
        return {
            'code': self.code,
            'my_seat': my_seat,
            'my_team': TEAM_OF.get(my_seat) if my_seat else None,
            'seats': seat_players,
            'open_seats': self.open_seats(),
            'dealer': self.dealer,
            'my_hand': self.hands.get(my_seat, []) if my_seat else [],
            'hand_counts': {s: len(self.hands.get(s, [])) for s in SEATS},
            'trick': self.trick,
            'tricks_taken': self.tricks_taken,
            'score': self.score,
            'history': self.history,
            'bid': self.bid,
            'to_play': self.to_play,
            'hand_id': self.hand_id,
        }


class RoomStore:
    def __init__(self):
        self._rooms: dict[str, Room] = {}
        self._lock = Lock()

    def create(self) -> Room:
        with self._lock:
            for _ in range(10):
                code = _new_code()
                if code not in self._rooms:
                    room = Room(code=code)
                    self._rooms[code] = room
                    return room
            raise RuntimeError('could not allocate room code')

    def get(self, code) -> Room | None:
        return self._rooms.get(code.upper() if code else '')

    def remove_player(self, sid):
        for room in self._rooms.values():
            if sid in room.players:
                del room.players[sid]
                return room
        return None


store = RoomStore()


def deal_new_hand(room: Room):
    hands, kitty = deal_deck()
    room.hands = hands
    room.kitty = kitty
    room.trick = {}
    room.last_trick = {}
    room.last_trick_taker = None
    room.tricks_taken = {'NS': 0, 'EW': 0}
    room.bid = None
    room.to_play = None
    room.hand_id += 1
    # dealer is chosen by spinner when 4th seat is taken, and rotates on end_hand.
    # deal_new_hand does NOT rotate.
