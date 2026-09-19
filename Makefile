# Every target delegates to tasks.py so Windows users without make get identical behaviour:
#   python tasks.py <target> [KEY=VALUE]
PY ?= python
DATASET_PATH ?= ./htn_challenge_logs_2026.txt

.PHONY: dev migrate import train calibrate evaluate replay-demo test benchmark build lint typecheck db-up db-down

dev:
	$(PY) tasks.py dev
db-up:
	$(PY) tasks.py db-up
db-down:
	$(PY) tasks.py db-down
migrate:
	$(PY) tasks.py migrate
import:
	$(PY) tasks.py import DATASET_PATH=$(DATASET_PATH)
train:
	$(PY) tasks.py train
calibrate:
	$(PY) tasks.py calibrate
evaluate:
	$(PY) tasks.py evaluate
replay-demo:
	$(PY) tasks.py replay-demo
test:
	$(PY) tasks.py test ARGS="$(ARGS)"
benchmark:
	$(PY) tasks.py benchmark
lint:
	$(PY) tasks.py lint
typecheck:
	$(PY) tasks.py typecheck
build:
	$(PY) tasks.py build
