// What the registries say (X-4 of extra_detectors.py): the address space that is not for the public Internet, as the
// ipaddress module of Python judges it (is_global of a network, Python 3.12.4 and later), and the ranges that the RIRs
// list as available or reserved in their delegated-*-extended files; the same for the AS numbers.
use crate::record::Net;

type Table = (Vec<u128>, Vec<u128>, Vec<&'static str>);

#[derive(Default)]
pub struct Registry { asn: Table, v4: Table, v6: Table }

const PRIVATE_V4: &[&str] = &["0.0.0.0/8", "10.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.0.170/31", "192.0.2.0/24",
    "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "255.255.255.255/32"];
const EXCEPT_V4: &[&str] = &["192.0.0.9/32", "192.0.0.10/32"];
const SHARED_V4: &str = "100.64.0.0/10";
const PRIVATE_V6: &[&str] = &["::1/128", "::/128", "::ffff:0.0.0.0/96", "64:ff9b:1::/48", "100::/64", "2001::/23", "2001:db8::/32", "2002::/16", "3fff::/20", "fc00::/7", "fe80::/10"];
const EXCEPT_V6: &[&str] = &["2001:1::1/128", "2001:1::2/128", "2001:3::/32", "2001:4:112::/48", "2001:20::/28", "2001:30::/28"];

const PRIVATE_ASN: &[(u64, u64)] = &[(64512, 65534), (4200000000, 4294967294)];
const RESERVED_ASN: &[(u64, u64)] = &[(0, 0), (23456, 23456), (64496, 64511), (65535, 65551), (65552, 131071), (4294967295, 4294967295)];

fn range(n: &Net) -> (u128, u128) {
    let host = (n.bits() - n.len) as u32;
    (n.addr, if host == 0 { n.addr } else if host >= 128 { u128::MAX } else { n.addr | ((1u128 << host) - 1) })
}

fn within(list: &[&str], lo: u128, hi: u128, both_in_one: bool) -> bool {
    list.iter().any(|t| { let (a, b) = range(&Net::parse(t).unwrap()); if both_in_one { a <= lo && hi <= b } else { (a <= lo && lo <= b) || (a <= hi && hi <= b) } })
}

// is_global of ipaddress for a network: its first and its last address in one private network, and neither in an exception
pub fn is_global(net: &Net) -> bool {
    let (lo, hi) = range(net);
    let (private, except) = if net.v6 { (PRIVATE_V6, EXCEPT_V6) } else { (PRIVATE_V4, EXCEPT_V4) };
    let is_private = within(private, lo, hi, true) && !within(except, lo, hi, false);
    if !net.v6 && within(&[SHARED_V4], lo, hi, true) { return false; }
    !is_private
}

fn listed(t: &Table, lo: u128, hi: u128) -> Option<&'static str> {
    let i = t.0.partition_point(|s| *s <= lo);
    if i > 0 && hi <= t.1[i - 1] { Some(t.2[i - 1]) } else { None }
}

impl Registry {
    pub fn len(&self) -> usize { self.asn.0.len() + self.v4.0.len() + self.v6.0.len() }
    // the files delegated-* of a directory
    pub fn load(dir: &str) -> Registry {
        let mut files: Vec<String> = std::fs::read_dir(dir).expect("the directory of the delegation files").filter_map(|e| e.ok()).map(|e| e.path())
            .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("delegated-"))).map(|p| p.to_string_lossy().into_owned()).collect();
        files.sort();
        Registry::load_all(&files)
    }
    pub fn load_all(files: &[String]) -> Registry {
        let (mut asn, mut v4, mut v6): (Vec<(u128, u128, &'static str)>, Vec<_>, Vec<_>) = (Vec::new(), Vec::new(), Vec::new());
        for f in files {
            let text = String::from_utf8_lossy(&std::fs::read(f).expect("read")).into_owned();
            for line in text.lines() {
                let p: Vec<&str> = line.split('|').collect();
                if p.len() < 7 { continue; }
                let status = match p[6].trim() { "available" => "available", "reserved" => "reserved", _ => continue };
                match p[2] {
                    "asn" => if let (Ok(a), Ok(n)) = (p[3].trim().parse::<i128>(), p[4].trim().parse::<i128>()) { if a >= 0 && a + n - 1 >= 0 { asn.push((a as u128, (a + n - 1) as u128, status)); } },
                    "ipv4" => if let (Ok(a), Ok(n)) = (p[3].parse::<std::net::Ipv4Addr>(), p[4].trim().parse::<u128>()) { let s = u32::from(a) as u128; v4.push((s, (s + n).wrapping_sub(1), status)); },
                    "ipv6" => if let (Ok(a), Ok(n)) = (p[3].parse::<std::net::Ipv6Addr>(), p[4].trim().parse::<u32>()) {
                        if n <= 128 { let s = u128::from(a); let size = if n == 0 { 0 } else { 1u128 << (128 - n) }; v6.push((s, s.wrapping_add(size).wrapping_sub(1), status)); }
                    },
                    _ => {}
                }
            }
        }
        let table = |mut v: Vec<(u128, u128, &'static str)>| -> Table { v.sort(); (v.iter().map(|r| r.0).collect(), v.iter().map(|r| r.1).collect(), v.iter().map(|r| r.2).collect()) };
        Registry { asn: table(asn), v4: table(v4), v6: table(v6) }
    }
    // check_unallocated_prefix: "bogon", "available" or "reserved"
    pub fn unallocated(&self, net: &Net) -> Option<&'static str> {
        if !is_global(net) { return Some("bogon"); }
        let (lo, hi) = range(net);
        listed(if net.v6 { &self.v6 } else { &self.v4 }, lo, hi)
    }
    // _asn_kind: "private", "reserved", or what the registries say
    pub fn asn_kind(&self, asn: u64) -> Option<&'static str> {
        if PRIVATE_ASN.iter().any(|(lo, hi)| *lo <= asn && asn <= *hi) { return Some("private"); }
        if RESERVED_ASN.iter().any(|(lo, hi)| *lo <= asn && asn <= *hi) { return Some("reserved"); }
        listed(&self.asn, asn as u128, asn as u128)
    }
}
