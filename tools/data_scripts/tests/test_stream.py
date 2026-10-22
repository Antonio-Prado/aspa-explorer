import gzip
import json
import os
import sys
import tempfile
import types
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.modules.setdefault("websocket", types.ModuleType("websocket"))  # not needed by what is tested here
import stream  # noqa: E402


class FakeSocket:
    def __init__(self, messages):
        self.messages = [json.dumps(m) for m in messages]

    def recv(self):
        if not self.messages:
            raise ConnectionError("end")
        return self.messages.pop(0)


def ris(path, peer_asn="64500", host="rrc00.ripe.net"):
    return {"type": "ris_message", "data": {"host": host, "timestamp": 1792663820.5, "peer_asn": peer_asn, "path": path,
            "announcements": [{"prefixes": ["192.0.2.0/24"]}], "withdrawals": ["198.51.100.0/24"]}}


class Parser(unittest.TestCase):
    def test_compressor_flags_prepending_and_drops_sets(self):
        self.assertEqual(stream.compressor("1 2 2 2 3"), ([1, 2, 3], 1))
        self.assertEqual(stream.compressor("1 2 3"), ([1, 2, 3], 0))
        self.assertEqual(stream.compressor("1 {2,3}"), (None, None))

    def test_peer_is_an_integer_and_collector_has_no_domain(self):
        records = list(stream.parser(FakeSocket([ris([64500, 2, 2, 3])])))
        self.assertEqual([r["type"] for r in records], ["A", "W"])
        for r in records:
            self.assertEqual((r["peer"], r["collector"]), (64500, "rrc00"))
        self.assertEqual(records[0]["compressed_path"], [64500, 2, 3])

    def test_as_set_in_the_path_is_dropped(self):
        records = list(stream.parser(FakeSocket([ris([64500, [2, 3], 4])])))
        self.assertEqual([r["type"] for r in records], ["W"])


class Writer(unittest.TestCase):
    def test_one_file_for_each_day_and_late_records_stay(self):
        with tempfile.TemporaryDirectory() as d:
            cwd = os.getcwd()
            os.chdir(d)
            try:
                w = stream.DailyWriter()
                rec = lambda ts: {"timestamp": ts, "type": "W"}
                w.write(rec("2026-10-22 23:59:59"))
                first = w.name
                w.write(rec("2026-10-22 23:59:58"))      # a little late: same file
                stream.time.sleep(1.1)                    # the name has the epoch of the opening
                w.write(rec("2026-10-23 00:00:01"))
                second = w.name
                w.close()
            finally:
                os.chdir(cwd)
            self.assertNotEqual(first, second)
            with gzip.open(os.path.join(d, first), "rt") as f:
                self.assertEqual(len(f.readlines()), 2)
            with gzip.open(os.path.join(d, second), "rt") as f:
                self.assertEqual(len(f.readlines()), 1)


if __name__ == "__main__":
    unittest.main()
