# flask-500

Online table for the family's variant of the card game 500.

**House rules baked in:**
- 4 players, partners (N+S vs E+W)
- 45-card deck: 52 minus 2s and 3s, plus one joker
- Bids 7–10 tricks (+ no-trump), joker is highest trump
- Game to 1000, kitty 5 cards, no misère

**What the app does / doesn't do:**
- Deals cards to each seat, shows your hand face-up, others as backs
- Lets anyone play a card to a compass slot in the center
- Manual trick collection via **NS took** / **EW took** buttons
- Does *not* enforce trump-following, bidding rules, or determine trick winners

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
# open http://localhost:5000
```

## Deploy to Railway

Railway auto-detects the `Procfile`:

```
web: gunicorn -k eventlet -w 1 -b 0.0.0.0:$PORT app:app
```

Set env vars in Railway:
- `FLASK_SECRET_KEY` — random string
- `JOIN_PASSCODE` — optional; if set, joiners must enter it

Room state is in-memory, so a redeploy drops active games.
