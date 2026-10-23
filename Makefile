.PHONY: check test-one services-up fmt-write

check:
	@echo "check suite is not configured: no check class is filled yet" >&2
	@exit 1

test-one:
	@echo "unit tests are not configured: no test class is filled yet" >&2
	@exit 1

services-up:
	@echo "nothing has to run for this project"

fmt-write:
	@echo "format is not configured: the format class is not filled yet" >&2
	@exit 1
