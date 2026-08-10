"""45-card 500 deck: 52 standard minus 2s and 3s, plus one joker."""
import random

SUITS = ['S', 'C', 'D', 'H']
RANKS = ['4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

JOKER = {'suit': 'JOKER', 'rank': 'JOKER'}


def build_deck():
    cards = [{'suit': s, 'rank': r} for s in SUITS for r in RANKS]
    cards.append(JOKER.copy())
    return cards


def shuffled_deck(rng=None):
    deck = build_deck()
    (rng or random).shuffle(deck)
    return deck


def deal(rng=None):
    """Return (hands, kitty). hands is dict keyed by seat N/E/S/W (10 cards each)."""
    deck = shuffled_deck(rng)
    hands = {seat: [] for seat in ('N', 'E', 'S', 'W')}
    for i in range(10):
        for seat in ('N', 'E', 'S', 'W'):
            hands[seat].append(deck.pop())
    kitty = deck
    assert len(kitty) == 5
    return hands, kitty


def card_id(card):
    return f"{card['rank']}{card['suit']}"
