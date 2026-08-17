SHELL := /bin/bash
ENTRY := index.ts

.PHONY: run setup help

## run: execute the Payworks playground script
run:
	@set -a; [ -f .env ] && . ./.env; set +a; \
	node $(ENTRY)

## setup: install @types/node so editors stop complaining (not needed to run)
setup:
	npm install

## help: list available targets
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /'
