"""Family 500 scoring: Avondale point schedule, slam bonus, game to 1000."""

BID_VALUES = {
    (7,  'S'): 140, (7,  'C'): 160, (7,  'D'): 180, (7,  'H'): 200, (7,  'NT'): 220,
    (8,  'S'): 240, (8,  'C'): 260, (8,  'D'): 280, (8,  'H'): 300, (8,  'NT'): 320,
    (9,  'S'): 340, (9,  'C'): 360, (9,  'D'): 380, (9,  'H'): 400, (9,  'NT'): 420,
    (10, 'S'): 440, (10, 'C'): 460, (10, 'D'): 480, (10, 'H'): 500, (10, 'NT'): 520,
}

SLAM_BONUS = 250
GAME_TARGET = 1000


def bid_value(tricks, suit):
    return BID_VALUES[(tricks, suit)]


def score_hand(bid_tricks, bid_suit, bidder_team, bidder_tricks_taken):
    """Return {'NS': int, 'EW': int} delta for one hand.

    bidder_team: 'NS' or 'EW'
    bidder_tricks_taken: 0..10 (tricks the bidding team collected)
    """
    other = 'EW' if bidder_team == 'NS' else 'NS'
    value = bid_value(bid_tricks, bid_suit)

    result = {'NS': 0, 'EW': 0}
    result[other] = 10 * (10 - bidder_tricks_taken)

    made = bidder_tricks_taken >= bid_tricks
    if made:
        if bidder_tricks_taken == 10 and value < SLAM_BONUS:
            result[bidder_team] = SLAM_BONUS
        else:
            result[bidder_team] = value
    else:
        result[bidder_team] = -value
    return result
