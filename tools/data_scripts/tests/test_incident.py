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
import extra_detectors  # noqa: E402
import incident  # noqa: E402


def announce(ts, prefix, peer, path):
    return {"type": "A", "collector": "rrc00", "timestamp": ts, "prefix": prefix, "peer": peer,
            "origin": path[-1], "flag": 0, "compressed_path": path}


def withdraw(ts, prefix, peer):
    return {"type": "W", "collector": "rrc00", "timestamp": ts, "prefix": prefix, "peer": peer,
            "origin": None, "flag": None, "compressed_path": None}


# AS1 is a provider of AS100; AS1 and AS3 are providers of AS2; AS4 is a provider of AS1; AS5 and AS3 are peers
REL = {(1, 100): "p2c", (100, 1): "c2p", (1, 2): "p2c", (2, 1): "c2p", (3, 2): "p2c", (2, 3): "c2p", (4, 1): "p2c", (1, 4): "c2p", (5, 3): "p2p", (3, 5): "p2p"}
ROAS = {"20.0.0.0/16": {(100, 16)}}


def run(records, rel=REL, roas=ROAS, reg=None):
    state, active, out = {}, {}, io.StringIO()
    for rec in records:
        incident.process_record(rec, rel, roas, active, incident.TIMEOUT_SECONDS, out, state, reg)
    return active, state


class Detectors(unittest.TestCase):
    def test_route_leak_is_flagged_and_valley_free_is_not(self):
        active, _ = run([announce("2026-10-22 10:00:00", "20.1.0.0/16", 3, [3, 2, 1, 100])])
        self.assertEqual(list(active), ["RLK_1_2_3"])
        active, _ = run([announce("2026-10-22 10:00:00", "20.1.0.0/16", 4, [4, 1, 100])])
        self.assertEqual(active, {})

    def test_route_leak_records_its_type(self):
        active, _ = run([announce("2026-10-22 10:00:00", "20.1.0.0/16", 3, [3, 2, 1, 100])])
        self.assertEqual(active["RLK_1_2_3"]["details"]["rlk_type"], "UL")          # to a provider
        self.assertEqual(active["RLK_1_2_3"]["details"]["learned_from"], "provider")
        rel = dict(REL); rel.update({(6, 2): "p2p", (2, 6): "p2p"})                 # 6 is a peer of 2
        active, _ = run([announce("2026-10-22 10:00:00", "20.1.0.0/16", 6, [6, 2, 1, 100])], rel=rel)
        self.assertEqual(active["RLK_1_2_6"]["details"]["rlk_type"], "LL")          # to a peer

    def test_link_that_caida_does_not_know(self):
        rel = dict(REL)
        active, _ = run([announce("2026-10-22 10:00:00", "20.1.0.0/16", 4, [4, 1, 100])], rel=rel)       # every link is known
        self.assertEqual([k for k in active if k.startswith("ASM")], [])
        active, _ = run([announce("2026-10-22 10:00:00", "20.1.0.0/16", 4, [4, 1, 666])], rel=rel)       # the origin is not next to 1
        self.assertEqual(active["ASM_FI_1_666"]["details"]["asm_type"], "FI")
        active, _ = run([announce("2026-10-22 10:00:00", "20.1.0.0/16", 4, [4, 5, 1, 100])], rel=rel)    # 4 and 5 are not linked
        self.assertEqual(active["ASM_PS_4_5"]["details"]["asm_type"], "PS")
        active, _ = run([announce("2026-10-22 10:00:00", "20.1.0.0/16", 4, [4, 5, 1, 100])], rel={})     # no relationships: off
        self.assertEqual(active, {})

    def test_hijack_by_origin_and_by_length(self):
        active, _ = run([announce("2026-10-22 10:00:00", "20.0.0.0/16", 4, [4, 1, 666]),
                         announce("2026-10-22 10:00:01", "20.0.1.0/24", 4, [4, 1, 100])])
        self.assertEqual(active["PRH_666"]["details"]["anomaly"], "Invalid_Origin (Prefix Hijack)")
        self.assertEqual(active["PRH_100"]["details"]["anomaly"], "Invalid_Length (Sub-Prefix Hijack)")


REG_TEXT = ("ripencc|EU|asn|64000|10|20200101|reserved|x\nripencc|EU|asn|300000|5|20200101|available|x\n"
            "ripencc|EU|ipv4|30.0.0.0|65536|20200101|available|x\nripencc|EU|ipv6|2001:db8:100::|40|20200101|reserved|x\n"
            "ripencc|EU|ipv4|31.0.0.0|256|20200101|allocated|x\n")


def registry():
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(d, "delegated-x"), "w") as f:
            f.write(REG_TEXT)
        return extra_detectors.load_delegations(os.path.join(d, "delegated-*"))


class Registry(unittest.TestCase):
    def test_prefix_in_space_that_nobody_has(self):
        reg = registry()
        self.assertEqual(run([announce("2026-10-22 10:00:00", "30.0.1.0/24", 4, [4, 1, 100])], reg=reg)[0]["PRH_AB_100"]["details"]["kind"], "available")
        self.assertEqual(run([announce("2026-10-22 10:00:00", "10.1.0.0/16", 4, [4, 1, 100])], reg=reg)[0]["PRH_AB_100"]["details"]["kind"], "bogon")
        active, _ = run([announce("2026-10-22 10:00:00", "31.0.0.0/24", 4, [4, 1, 100])], reg=reg)      # allocated: not listed
        self.assertNotIn("PRH_AB_100", active)
        active, _ = run([announce("2026-10-22 10:00:00", "30.0.0.0/8", 4, [4, 1, 100])], reg=reg)       # bigger than the range: not inside it
        self.assertNotIn("PRH_AB_100", active)

    def test_as_numbers_of_the_path(self):
        reg = registry()
        for path, key, kind in (([4, 1, 64005, 100], "ASM_PE_64005", "reserved"), ([4, 1, 300002, 100], "ASM_PE_300002", "available"),
                                ([4, 1, 64600, 100], "ASM_EX_64600", "private"), ([4, 1, 4, 100], "ASM_PE_4", "loop")):
            active, _ = run([announce("2026-10-22 10:00:00", "20.1.0.0/16", 4, path)], reg=reg)
            self.assertEqual(active[key]["details"]["asn_kind"], kind, key)
        active, _ = run([announce("2026-10-22 10:00:00", "20.1.0.0/16", 4, [4, 1, 100])], reg=reg)
        self.assertEqual([k for k in active if k.startswith("ASM")], [])
        # a link that goes to a number that is not allocated is reported once, as the number
        active, _ = run([announce("2026-10-22 10:00:00", "20.1.0.0/16", 4, [4, 1, 64005])], reg=reg)
        self.assertEqual([k for k in active if k.startswith("ASM")], ["ASM_PE_64005"])


class Scale(unittest.TestCase):
    def setUp(self):
        self.saved = (extra_detectors.DEG_EXCESS, extra_detectors.DEG_FLOOD_V6, extra_detectors.DEG_FLOOD_V4_ORIGIN)
        extra_detectors.DEG_EXCESS, extra_detectors.DEG_FLOOD_V6, extra_detectors.DEG_FLOOD_V4_ORIGIN = 5, 20, 50

    def tearDown(self):
        extra_detectors.DEG_EXCESS, extra_detectors.DEG_FLOOD_V6, extra_detectors.DEG_FLOOD_V4_ORIGIN = self.saved

    def records(self, n, peers=(7, 8), day="2026-10-22", fmt="20.9.{}.0/24"):
        out = []
        for i in range(n):
            for k, peer in enumerate(peers):
                out.append(announce(f"{day} 10:{i // 60:02d}:{i % 60:02d}", fmt.format(i), peer, [peer, 1, 100]))
        return out

    def test_excessive_when_two_peers_see_enough_more_specifics(self):
        active, _ = run(self.records(6), rel={}, roas={})
        inc = active["DEG_excessive_100"]
        self.assertEqual((inc["details"]["more_specifics"], inc["details"]["aggregate"]), (5, "20.9.0.0/16"))
        active, _ = run(self.records(6, peers=(7,)), rel={}, roas={})           # one peer only: not counted
        self.assertNotIn("DEG_excessive_100", active)
        active, _ = run(self.records(4), rel={}, roas={})                        # under the threshold
        self.assertNotIn("DEG_excessive_100", active)

    def test_flood_by_origin_for_ipv4_and_by_aggregate_for_ipv6(self):
        active, _ = run(self.records(60, fmt="20.{}.1.0/24"), rel={}, roas={})
        self.assertEqual(active["DEG_flood_100"]["details"]["origin_more_specifics"], 50)
        active, _ = run([announce(f"2026-10-22 10:00:{i % 60:02d}", f"2a00:1:{i:x}::/48", p, [p, 1, 100]) for i in range(25) for p in (7, 8)],
                        rel={}, roas={})
        self.assertEqual(active["DEG_flood_100"]["details"]["aggregate"], "2a00:1::/32")

    def test_jump_against_the_days_before(self):
        state = {"deg_hist": {100: [3, 4, 2]}}
        out = io.StringIO()
        active = {}
        for rec in self.records(110, fmt="20.{}.2.0/24"):
            incident.process_record(rec, {}, {}, active, incident.TIMEOUT_SECONDS, out, state)
        self.assertEqual(active["DEG_jump_100"]["details"]["median_before"], 3)
        state = {"deg_hist": {100: [3, 4]}}                                      # not enough days: no judgement
        active = {}
        for rec in self.records(110, fmt="20.{}.2.0/24"):
            incident.process_record(rec, {}, {}, active, incident.TIMEOUT_SECONDS, out, state)
        self.assertNotIn("DEG_jump_100", active)

    def test_a_day_ends_into_the_history(self):
        _, state = run(self.records(6), rel={}, roas={})
        extra_detectors.collect_garbage(state, incident.parse_timestamp("2026-10-23 03:00:00"))
        self.assertEqual(state["deg_hist"][100], [6])
        self.assertEqual(state["deg_scale"], {})


class Volatility(unittest.TestCase):
    def test_delayed_convergence_is_a_burst_that_does_not_stop(self):
        records = [announce(f"2026-10-22 10:{i // 60:02d}:{i % 60:02d}", "20.7.0.0/24", 7 + i % 3, [7 + i % 3, 1, 100]) for i in range(0, 700, 5)]
        active, _ = run(records, rel={}, roas={})
        inc = active["VOLDC_20.7.0.0/24"]
        self.assertEqual(inc["details"]["vol_type"], "DC")
        self.assertGreaterEqual(inc["total_updates"], 100)
        self.assertGreater(inc["total_updates"], inc["details"]["updates"] - 1)
        records = [announce(f"2026-10-22 10:{i // 60:02d}:{i % 60:02d}", "20.7.0.0/24", 7, [7, 1, 100]) for i in range(0, 700, 90)]
        active, _ = run(records, rel={}, roas={})                                 # pauses of 90 s: no burst
        self.assertNotIn("VOLDC_20.7.0.0/24", active)

    def test_amplified_churn_needs_updates_prefixes_and_peers(self):
        saved = (extra_detectors.VOL_AC_UPDATES, extra_detectors.VOL_AC_PREFIXES, extra_detectors.VOL_AC_PEERS)
        extra_detectors.VOL_AC_UPDATES, extra_detectors.VOL_AC_PREFIXES, extra_detectors.VOL_AC_PEERS = 40, 10, 3
        try:
            mk = lambda peers: [announce(f"2026-10-22 10:00:{i % 50:02d}", f"20.8.{i % 12}.0/24", peers[i % len(peers)], [peers[i % len(peers)], 1, 100]) for i in range(60)]
            active, _ = run(mk([7, 8, 9]), rel={}, roas={})
            self.assertEqual(active["VOLAC_100"]["details"]["vol_type"], "AC")
            active, _ = run(mk([7]), rel={}, roas={})
            self.assertNotIn("VOLAC_100", active)
        finally:
            extra_detectors.VOL_AC_UPDATES, extra_detectors.VOL_AC_PREFIXES, extra_detectors.VOL_AC_PEERS = saved

    def test_flapping_has_its_type(self):
        records = [withdraw(f"2026-10-22 10:00:{i:02d}", "20.5.0.0/24", 7) if i % 2 else announce(f"2026-10-22 10:00:{i:02d}", "20.5.0.0/24", 7, [7, 100]) for i in range(6)]
        active, _ = run(records, rel={}, roas={})
        self.assertEqual(active["VOL_20.5.0.0/24_7"]["details"]["vol_type"], "FO")


class Session(unittest.TestCase):
    def note(self, ts, peer, code, subcode):
        return {"type": "N", "collector": "rrc00", "timestamp": ts, "peer": peer, "code": code, "subcode": subcode}

    def test_update_message_errors_are_atr_and_other_notifications_are_not(self):
        active, _ = run([self.note("2026-10-22 10:00:00", 7, 3, 9), self.note("2026-10-22 10:00:01", 8, 3, 11), self.note("2026-10-22 10:00:02", 9, 6, 5)])
        self.assertEqual(sorted(active), ["ATR_EH_8", "ATR_MA_7"])
        self.assertEqual(active["ATR_MA_7"]["details"]["subcode"], 9)
        self.assertEqual(active["ATR_MA_7"]["prefixes"], set())

    def test_the_state_of_a_session_is_noted_on_a_mass_withdrawal(self):
        records = [{"type": "S", "collector": "rrc00", "timestamp": "2026-10-22 10:00:00", "peer": 7, "state": "down"}]
        records += [withdraw("2026-10-22 10:00:05", f"20.{i // 250}.{i % 250}.0/24", 7) for i in range(600)]
        active, _ = run(records, rel={}, roas={})
        self.assertEqual(active["ATR_7"]["details"]["session_event"], "down")


class Buffers(unittest.TestCase):
    def test_withdrawal_of_another_peer_is_not_counted(self):
        active, _ = run([announce("2026-10-22 10:00:00", "20.0.0.0/16", 4, [4, 1, 666]),
                         withdraw("2026-10-22 10:00:30", "20.0.0.0/16", 3),     # unrelated peer
                         withdraw("2026-10-22 10:01:00", "20.0.0.0/16", 4)])    # the peer of the anomaly
        self.assertEqual(active["PRH_666"]["total_updates"], 2)
        self.assertEqual([m["peer"] for m in active["PRH_666"]["messages"]], [4, 4])

    def test_index_of_prefixes_follows_the_incidents_that_end(self):
        state, active, out = {}, {}, io.StringIO()
        recs = [announce("2026-10-22 10:00:00", "20.1.0.0/16", 3, [3, 2, 1, 100]),
                withdraw("2026-10-22 10:00:10", "20.1.0.0/16", 3),                       # an incident of the prefix: it gets the withdrawal
                announce("2026-10-22 10:20:00", "20.2.0.0/16", 4, [4, 1, 100]),          # 20 minutes on: the first one has ended
                withdraw("2026-10-22 10:20:10", "20.1.0.0/16", 3)]
        for rec in recs:
            incident.process_record(rec, REL, ROAS, active, incident.TIMEOUT_SECONDS, out, state)
        self.assertNotIn("RLK_1_2_3", active)
        self.assertEqual(json.loads(out.getvalue().splitlines()[0])["total_updates"], 2)
        self.assertNotIn("20.1.0.0/16", state["_idx"])

    def test_volatility_counts_the_flaps_and_keeps_four_messages(self):
        records = []
        for i in range(12):
            ts = f"2026-10-22 10:00:{i:02d}"
            records.append(withdraw(ts, "20.5.0.0/24", 7) if i % 2 else announce(ts, "20.5.0.0/24", 7, [7, 100]))
        active, _ = run(records, rel={}, roas={})
        vol = active["VOL_20.5.0.0/24_7"]
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
            f.write(json.dumps(announce("2026-10-22 10:00:00", "20.1.0.0/16", 3, [3, 2, 1, 100])) + "\n")

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
