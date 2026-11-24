# route and route6 objects of RPSL dumps -> "prefix<TAB>origin<TAB>source", one line each.
# Objects are separated by blank lines; attribute names are case-insensitive; comments (#) are dropped.
function flush() {
	if (pfx != "" && org != "") print pfx "\t" org "\t" src
	pfx = ""; org = ""; src = ""
}
/^[ \t]*$/ { flush(); next }
/^[A-Za-z0-9-]+:/ {
	name = tolower(substr($0, 1, index($0, ":") - 1))
	val = substr($0, index($0, ":") + 1)
	sub(/#.*/, "", val); gsub(/[ \t]+/, "", val)
	if (name == "route" || name == "route6") pfx = tolower(val)
	else if (name == "origin") org = toupper(val)
	else if (name == "source") src = toupper(val)
}
END { flush() }
