.PHONY: install dev test lint fmt eval eval-batch

install:
	pip install -e ".[dev]"

dev:
	uvicorn app.main:app --reload --port 8000

test:
	pytest -q

lint:
	ruff check . && ruff format --check .

fmt:
	ruff format . && ruff check --fix .

# Runs every fixture in tests/fixtures/bills against real Claude Haiku 5.5.
# Needs ANTHROPIC_API_KEY in env or .env
eval:
	python -m eval.run_eval

# Same fixtures through the Message Batches API (50% cheaper, slower)
eval-batch:
	python -m eval.run_eval --batch
