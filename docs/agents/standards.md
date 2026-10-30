<!-- devloop: 0.166.0 -->
# Standards

- A glob or pattern read from a config file or an argument is matched by a loop over its parts, never by a regular expression built from it, so a crafted link cannot make the match take exponential time.
- A new error message of the program or of a script goes into the "Exit codes and messages" table of docs/links.md in the same change, so a caller who looks up a message or an exit code finds it there.
