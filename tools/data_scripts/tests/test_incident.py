import bz2
import gzip
import io
import json
import lzma
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import incident  # noqa: E402


def announce(ts, prefix, peer, path):
    return {"type": "A", "collector": "rrc00", "timestamp": ts, "prefix": prefix, "peer": peer,
            "origin": path[-1], "flag": 0, "compressed_path": path}


def withdraw(ts, prefix, peer):
    return {"type": "W", "collector": "rrc00", "timestamp": ts, "prefix": prefix, "peer": peer,
            "origin": None, "flag": None, "compressed_path": None}


# AS1 is a provider of AS100; AS1 and AS3 are providers of AS2; AS4 is a provider of AS1; AS5 and AS3 are peers
REL = {(1, 100): "p2c", (100, 1): "c2p", (1, 2): "p2c", (2, 1): "c2p", (3, 2): "p2c", (2, 3): "c2p", (4, 1): "p2c", (1, 4): "c2p", (5, 3): "p2p", (3, 5): "p2p"}
ROAS = {"10.0.0.0/16": {(100, 16)}}


def run(records, rel=REL, roas=ROAS):
    state, active, out = {}, {}, io.StringIO()
    for rec in records:
        incident.process_record(rec, rel, roas, active, incident.TIMEOUT_SECONDS, out, state)
    return active, state


class Detectors(unittest.TestCase):
    def test_route_leak_is_flagged_and_valley_free_is_not(self):
        active, _ = run([announce("2026-10-22 10:00:00", "10.1.0.0/16", 3, [3, 2, 1, 100])])
        self.assertEqual(list(active), ["RLK_1_2_3"])
        active, _ = run([announce("2026-10-22 10:00:00", "10.1.0.0/16", 4, [4, 1, 100])])
        self.assertEqual(active, {})

    def test_route_leak_records_its_type(self):
        active, _ = run([announce("2026-10-22 10:00:00", "10.1.0.0/16", 3, [3, 2, 1, 100])])
        self.assertEqual(active["RLK_1_2_3"]["details"]["rlk_type"], "UL")          # to a provider
        self.assertEqual(active["RLK_1_2_3"]["details"]["learned_from"], "provider")
        rel = dict(REL); rel.update({(6, 2): "p2p", (2, 6): "p2p"})                 # 6 is a peer of 2
        active, _ = run([announce("2026-10-22 10:00:00", "10.1.0.0/16", 6, [6, 2, 1, 100])], rel=rel)
        self.assertEqual(active["RLK_1_2_6"]["details"]["rlk_type"], "LL")          # to a peer

    def test_link_that_caida_does_not_know(self):
        rel = dict(REL)
        active, _ = run([announce("2026-10-22 10:00:00", "10.1.0.0/16", 4, [4, 1, 100])], rel=rel)       # every link is known
        self.assertEqual([k for k in active if k.startswith("ASM")], [])
        active, _ = run([announce("2026-10-22 10:00:00", "10.1.0.0/16", 4, [4, 1, 666])], rel=rel)       # the origin is not next to 1
        self.assertEqual(active["ASM_FI_1_666"]["details"]["asm_type"], "FI")
        active, _ = run([announce("2026-10-22 10:00:00", "10.1.0.0/16", 4, [4, 5, 1, 100])], rel=rel)    # 4 and 5 are not linked
        self.assertEqual(active["ASM_PS_4_5"]["details"]["asm_type"], "PS")
        active, _ = run([announce("2026-10-22 10:00:00", "10.1.0.0/16", 4, [4, 5, 1, 100])], rel={})     # no relationships: off
        self.assertEqual(active, {})

    def test_hijack_by_origin_and_by_length(self):
        active, _ = run([announce("2026-10-22 10:00:00", "10.0.0.0/16", 4, [4, 1, 666]),
                         announce("2026-10-22 10:00:01", "10.0.1.0/24", 4, [4, 1, 100])])
        self.assertEqual(active["PRH_666"]["details"]["anomaly"], "Invalid_Origin (Prefix Hijack)")
        self.assertEqual(active["PRH_100"]["details"]["anomaly"], "Invalid_Length (Sub-Prefix Hijack)")


class Buffers(unittest.TestCase):
    def test_withdrawal_of_another_peer_is_not_counted(self):
        active, _ = run([announce("2026-10-22 10:00:00", "10.0.0.0/16", 4, [4, 1, 666]),
                         withdraw("2026-10-22 10:00:30", "10.0.0.0/16", 3),     # unrelated peer
                         withdraw("2026-10-22 10:01:00", "10.0.0.0/16", 4)])    # the peer of the anomaly
        self.assertEqual(active["PRH_666"]["total_updates"], 2)
        self.assertEqual([m["peer"] for m in active["PRH_666"]["messages"]], [4, 4])

    def test_volatility_counts_the_flaps_and_keeps_four_messages(self):
        records = []
        for i in range(12):
            ts = f"2026-10-22 10:00:{i:02d}"
            records.append(withdraw(ts, "10.5.0.0/24", 7) if i % 2 else announce(ts, "10.5.0.0/24", 7, [7, 100]))
        active, _ = run(records, rel={}, roas={})
        vol = active["VOL_10.5.0.0/24_7"]
        self.assertEqual(vol["total_updates"], 12)      # every event of the flapping, the ones that triggered the detection included
        self.assertEqual(len(vol["messages"]), 4)

    def test_pending_specifics_has_one_entry_for_each_prefix_and_origin(self):
        records = [announce(f"2026-10-22 10:00:{i:02d}", "192.0.2.0/24", 9, [9, 64500]) for i in range(30)]
        _, state = run(records, rel={}, roas={})
        self.assertEqual(sum(len(v) for v in state["pending_specifics"].values()), len(state["pending_specifics"]))


class Files(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        os.makedirs(os.path.join(self.dir.name, "data"))
        with bz2.open(os.path.join(self.dir.name, "20260901.as-rel.txt.bz2"), "wt") as f:
            f.write("1|2|-1|bgp\n3|2|-1|bgp\n1|100|-1|bgp\n")
        os.makedirs(os.path.join(self.dir.name, "roas"))
        with lzma.open(os.path.join(self.dir.name, "roas", "r.json.xz"), "wt") as f:
            json.dump({"roas": []}, f)
        with gzip.open(os.path.join(self.dir.name, "data", "records_1.jsonl.gz"), "wt") as f:
            f.write(json.dumps(announce("2026-10-22 10:00:00", "10.1.0.0/16", 3, [3, 2, 1, 100])) + "\n")

    def tearDown(self):
        self.dir.cleanup()

    def incident(self, *args):
        subprocess.run([sys.executable, os.path.join(ROOT, "incident.py"), *args], cwd=self.dir.name, check=True, capture_output=True)

    def test_gz_files_are_read_and_open_incidents_stay_in_the_state(self):
        self.incident()
        self.assertTrue(os.path.exists(os.path.join(self.dir.name, "incidents_records_1.jsonl")))
        self.assertFalse(os.path.exists(os.path.join(self.dir.name, "incidents_open.jsonl")))
        self.assertTrue(os.path.exists(os.path.join(self.dir.name, "active_state.pkl")))

    def test_flush_open_writes_them(self):
        self.incident("--flush-open")
        with open(os.path.join(self.dir.name, "incidents_open.jsonl")) as f:
            rows = [json.loads(line) for line in f]
        self.assertEqual([(r["incident_type"], r["end_reason"]) for r in rows], [("RLK", "dataset_end")])


if __name__ == "__main__":
    unittest.main()
