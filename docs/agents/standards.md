<!-- devloop: 0.165.0 -->
# Standards

- A shell script that captures a tool's output as a value sends the tool's stderr to a file of its own, so a warning from a tool that succeeded cannot become part of the value and turn a valid answer into an error.
- A test stub standing in for a tool records the arguments it was called with and a test asserts them, so a wrong flag, expression or path in the call turns the test red instead of passing against a stub that ignores its input.
- A glob or pattern read from a config file or an argument is matched by a loop over its parts, never by a regular expression built from it, so a crafted link cannot make the match take exponential time.
