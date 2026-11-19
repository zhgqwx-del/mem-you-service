PYTHON ?= python3

.PHONY: check trace test test-acceptance

check: trace test

trace:
	$(PYTHON) -B scripts/check_traceability.py

test:
	$(PYTHON) -B -m unittest discover -s tests -t . -v

test-acceptance:
	$(PYTHON) -B -m unittest discover -s tests/acceptance -t . -v
