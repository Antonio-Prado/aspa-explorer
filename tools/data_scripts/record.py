import pybgpstream
import json
import gzip 
from datetime import datetime, timezone


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


def parser(stream):
    # parsed_records = []
    # seen_path = set()

    # iterating over the records
    for record in stream.records():
        if record.status != "valid":
            continue

        for elem in record:
            # ensure prefix is not empty
            prefix = elem.fields.get("prefix", None)
            if not prefix:
                continue

            # skip paths with as sets and confederation segments
            # if "{" in as_path or "(" in as_path:
                # continue

            # keep one record per as path, prefix
            # if (as_path, prefix) in seen_path:
               # continue

           # seen_path.add((as_path, prefix))

            collector = elem.record.collector
            timestamp = datetime.fromtimestamp(elem.record.time, tz=timezone.utc).isoformat(sep=' ')[:19]
            peer = elem.peer_asn

            if elem.type == "A":
                # ensure as path is not empty
                as_path = elem.fields.get("as-path", None)
                if not as_path:
                    continue
                compressed_path, flag = compressor(as_path)
                if not compressed_path:
                    continue
                origin = compressed_path[-1]
                yield({"type": "A", "collector": collector, "timestamp": timestamp, "prefix": prefix, "peer": peer, 
                                       "origin": origin, "flag": flag, "compressed_path": compressed_path})
            elif elem.type == "W":
                yield({"type": "W", "collector": collector, "timestamp": timestamp, "prefix": prefix, "peer": peer, 
                                       "origin": None, "flag": None, "compressed_path": None})



def main():
    start_time = "2022-11-27 00:00:00"
    end_time = "2022-11-27 00:10:00"

    # new pybgpstream instance
    bgp_stream = pybgpstream.BGPStream(
        from_time=start_time, until_time=end_time,
        collectors=["rrc00"],
        record_type="updates"
    )

    records = parser(bgp_stream)

    output_file = f"records_{start_time[5:10]}.jsonl.gz"

    # write records into a jsonl file
    with gzip.open(output_file, "wt", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
    