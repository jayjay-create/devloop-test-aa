<!-- devloop: 0.161.0 -->
# Standards

- A test that creates a temp directory or starts a child process removes the directory and ends the process in a `finally` block, and bounds how long it waits for the process, so a failing or hanging run leaves nothing behind.
- A test that runs the program as a process asserts its exit code, with its stderr in the failure message, before it looks at the output, so a crash shows its cause and not a missing file.
- Text written to stderr that contains a path, a link or a system error message goes through `sanitizeForStderr` in `src/main.ts`, or through `printable` in `scripts/links.sh` for text a shell script prints, so control characters cannot start a terminal escape sequence or a second line.
- A script that replaces a committed file renders into a temp directory inside the target's own directory and moves the result over only after checking it is non-empty, so a failed or empty run leaves the old file as it was and the move stays a rename on one filesystem.
- A shell script prints text that contains a name or an argument with `printf '%s\n'`, never `echo`, because `echo` in some `sh` expands backslash sequences and a name spelled `\033[2J` would reach the terminal as a real escape sequence even after `printable` removed the control characters; a fixed message with no name in it may use `echo`.
- A shell script that captures a tool's output as a value sends the tool's stderr to a file of its own, so a warning from a tool that succeeded cannot become part of the value and turn a valid answer into an error.
- A test stub standing in for a tool records the arguments it was called with and a test asserts them, so a wrong flag, expression or path in the call turns the test red instead of passing against a stub that ignores its input.
