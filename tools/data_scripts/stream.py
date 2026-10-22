import websocket
import json
import gzip
import time
import signal
from datetime import datetime, timezone


stop_requested = False


def signal_handler(signum, frame):
    global stop_requested
    print("\ntermination signal received. wrapping up stream...", flush=True)
    stop_requested = True


def compressor(path):
    path = path.split()  # get list of autonomous systems
    output = []  # compressed as path in list format
    flag = 0 # turns 1 if prepending is present.

    for i in path:
        try:
            i = int(i)
        except ValueError:
            return None, None

        if output and output[-1] == i:
            flag = 1
        else:
            output.append(i)

    return output, flag


def connect_with_retry(url, max_retries=10, backoff_base=2):
    # attempts to establish websocket connection with exponential backoff
    retries = 0
    while not stop_requested and retries < max_retries:
        try:
            print(f"connecting to ripe ris live (attempt {retries + 1}/{max_retries})...", flush=True)
            ws = websocket.create_connection(url, timeout=30)
            return ws
        except Exception as err:
            retries += 1
            wait_time = backoff_base**retries
            print(f"connection failed ({err}). retrying in {wait_time}s...", flush=True)
            time.sleep(wait_time)
            
    return None


def parser(ws):
    # parsed_records = []
    # seen_path = set()

    # iterating over the records
    while not stop_requested:
        try:
            message = ws.recv()
            if not message:
                continue
            record = json.loads(message)
        except Exception:
            # break to trigger reconnect in main
            break

        # check if it's a valid message
        if record.get("type") != "ris_message":
            continue

        data = record.get("data", {})
        if not data:
            continue

        # "rrc00.ripe.net" is "rrc00", as pybgpstream (record.py) names it
        collector = (data.get("host") or "").split(".")[0] or None
        time_val = data.get("timestamp")
        
        # fallback to current time if timestamp is missing
        if time_val:
            timestamp = datetime.fromtimestamp(time_val, tz=timezone.utc).isoformat(sep=' ')[:19]
        else:
            timestamp = datetime.now(timezone.utc).isoformat(sep=' ')[:19]
            
        # RIS Live sends the peer as a string; record.py and the documentation have an integer
        try:
            peer = int(data.get("peer_asn"))
        except (TypeError, ValueError):
            continue

        # the messages of the session itself (extension of the copy of ASPA Explorer, see CROSS-CHECK.md, X-6): a NOTIFICATION that a peer
        # sends, and a change of state of the session. incident.py of the project ignores them (they have no prefix)
        if data.get("type") == "NOTIFICATION":
            note = data.get("notification") or {}
            yield {"type": "N", "collector": collector, "timestamp": timestamp, "peer": peer,
                   "code": note.get("code"), "subcode": note.get("subcode")}
            continue
        if data.get("type") == "RIS_PEER_STATE":
            yield {"type": "S", "collector": collector, "timestamp": timestamp, "peer": peer, "state": data.get("state")}
            continue

        # handle announcements
        for ann in data.get("announcements", []):
            for prefix in ann.get("prefixes", []):
                # ensure prefix is not empty
                if not prefix:
                    continue

                raw_path = data.get("path", [])
                as_path = " ".join(map(str, raw_path))

                # skip paths with as sets and confederation segments
                # if "{" in as_path or "(" in as_path:
                    # continue

                # keep one record per as path, prefix
                # if (as_path, prefix) in seen_path:
                   # continue

                # seen_path.add((as_path, prefix))

                # ensure as path is not empty
                if not as_path:
                    continue
                compressed_path, flag = compressor(as_path)
                if not compressed_path:
                    continue
                origin = compressed_path[-1]
                yield {"type": "A", "collector": collector, "timestamp": timestamp, "prefix": prefix, "peer": peer, 
                       "origin": origin, "flag": flag, "compressed_path": compressed_path}
                       
        # handle withdrawals
        for prefix in data.get("withdrawals", []):
            # ensure prefix is not empty
            if not prefix:
                continue
            
            yield {"type": "W", "collector": collector, "timestamp": timestamp, "prefix": prefix, "peer": peer, 
                   "origin": None, "flag": None, "compressed_path": None}


class DailyWriter:
    """One gzip file for each UTC day (the day of the timestamp of the records), closed when the day ends:
    a gzip file can be read in full only after it is closed, and incident.py needs complete files."""

    def __init__(self):
        self.f = None
        self.day = None
        self.name = None

    def write(self, rec):
        day = rec["timestamp"][:10]
        # a record a little late (the stream is not in strict order) stays in the current file
        if self.f is None or day > self.day:
            self.close()
            self.name = f"records_{int(time.time())}.jsonl.gz"
            self.f = gzip.open(self.name, "wt", encoding="utf-8")
            self.day = day
            print(f"\nwriting '{self.name}' (UTC day {day}).", flush=True)
        self.f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    def flush(self):
        if self.f:
            self.f.flush()

    def close(self):
        if self.f:
            self.f.close()
            self.f = None


def main():
    global stop_requested

    # register os signals for graceful shutdown (docker stop, ctrl+c)
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    url = "wss://ris-live.ripe.net/v1/ws/?client=py-bgp-stream-collector"

    count = 0
    writer = DailyWriter()
    try:
        while not stop_requested:
            ws = connect_with_retry(url)
            if not ws:
                print("exceeded maximum connection attempts. exiting.")
                break

            # subscribe to the collectors with update filter
            collectors = ["rrc00"]
            for c in collectors:
                # the updates, and the messages of the session (NOTIFICATION, RIS_PEER_STATE: a few an hour)
                for message_type in ("UPDATE", "NOTIFICATION", "RIS_PEER_STATE"):
                    ws.send(json.dumps({
                        "type": "ris_subscribe",
                        "data": {
                            "type": message_type,
                            "host": c
                        }
                    }))

            print("connected! streaming data. press Ctrl+C to stop.", flush=True)

            try:
                for rec in parser(ws):
                    writer.write(rec)
                    count += 1
                    if count % 10000 == 0:
                        writer.flush()
                        print(f"captured {count} updates...", end="\r", flush=True)
            except Exception as e:
                print(f"\nsocket dropped ({e}). re-establishing connection...", flush=True)
            finally:
                try:
                    ws.close()
                except Exception:
                    pass
    finally:
        writer.close()

    print(f"\nstream ended. total records saved: {count}.")


if __name__ == "__main__":
    main()
    