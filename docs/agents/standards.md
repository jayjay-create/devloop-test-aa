<!-- devloop: 0.157.0 -->
# Standards

- A test that creates a temp directory or starts a child process removes the directory and ends the process in a `finally` block, and bounds how long it waits for the process, so a failing or hanging run leaves nothing behind.
- Text written to stderr that contains a path, a link or a system error message goes through `sanitizeForStderr` in `src/main.ts`, so control characters cannot start a terminal escape sequence or a second line.
