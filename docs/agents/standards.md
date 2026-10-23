<!-- devloop: 0.157.0 -->
# Standards

- A test that creates a temp directory or starts a child process removes the directory and ends the process in a `finally` block, and bounds how long it waits for the process, so a failing or hanging run leaves nothing behind.
- A test that runs the program as a process asserts its exit code, with its stderr in the failure message, before it looks at the output, so a crash shows its cause and not a missing file.
- Text written to stderr that contains a path, a link or a system error message goes through `sanitizeForStderr` in `src/main.ts`, so control characters cannot start a terminal escape sequence or a second line.
