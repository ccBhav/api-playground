# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

This is an API playground for exploring and testing third-party product APIs. Each API/product gets
its own top-level directory (e.g. `quickbooks/`). The project is currently in early setup with no code
yet — this file should be updated as structure and conventions are established.

Two tools are used side by side per API directory:
- **Python** — scripts for calling APIs programmatically, handling auth flows (e.g. OAuth), and
  processing responses.
- **Bruno** — for manually exploring and testing API requests/collections (a lightweight,
  git-friendly alternative to Postman). Bruno collections are plain text files stored alongside the
  Python code for the same API.

## Structure

- `quickbooks/` — QuickBooks API exploration (currently empty; first integration to be built out)

As new product APIs are added, expect a new top-level directory per product, each containing its own
Python scripts and Bruno collection.
