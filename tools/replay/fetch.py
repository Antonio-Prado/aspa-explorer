"""The RIPE RIS update files (rrc00, one every 5 minutes) of the window of an event of events.json.
usage: fetch.py EVENT DIR    (downloads with curl into DIR, which must be empty and apart from the code: the files come from outside)"""
import json, os, subprocess, sys
from datetime import datetime, timedelta

ev, out = sys.argv[1], sys.argv[2]
w = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "events.json")))[ev]["window"]
t, end = (datetime.strptime(x, "%Y-%m-%d %H:%M") for x in w)
os.makedirs(out, exist_ok=True)
while t <= end:
    url = f"https://data.ris.ripe.net/rrc00/{t:%Y.%m}/updates.{t:%Y%m%d.%H%M}.gz"
    subprocess.run(["curl", "-sS", "--retry", "3", "--max-time", "120", "-O", "--output-dir", out, url], check=True)
    t += timedelta(minutes=5)
