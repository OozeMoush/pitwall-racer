#!/usr/bin/env bash
set -euo pipefail

GENERATIONS="${GENERATIONS:-80}"
POPULATION="${POPULATION:-24}"
SIGMA="${SIGMA:-0.018}"
EVOLUTION_LR="${EVOLUTION_LR:-0.006}"
SIGMA_DECAY="${SIGMA_DECAY:-0.995}"
TRAIN_DEVICE="${TRAIN_DEVICE:-cuda}"

TEACHER="artifacts/pitwall-learning/teacher.jsonl"
CLONE="artifacts/pitwall-learning/policy-teacher.json"
EVOLVED="artifacts/pitwall-learning/policy-evolved.json"

echo "[1/5] Export machine-only teacher trace"
npm run learn:teacher -- "$TEACHER"

echo "[2/5] Behavior clone with PyTorch (device=$TRAIN_DEVICE)"
uv run tools/learning/train_teacher.py \
  --teacher "$TEACHER" \
  --output "$CLONE" \
  --device "$TRAIN_DEVICE"

echo "[3/5] Verify cloned policy in authoritative Rapier environment"
if ! npm run learn:evaluate -- "$CLONE"; then
  echo "Clone did not complete a valid lap. Rank evolution can still use progress curriculum, but this usually means BC needs improvement." >&2
fi

echo "[4/5] Rank-based neuroevolution directly in Rapier"
npm run learn:evolve -- \
  --input "$CLONE" \
  --output "$EVOLVED" \
  --generations "$GENERATIONS" \
  --population "$POPULATION" \
  --sigma "$SIGMA" \
  --learning-rate "$EVOLUTION_LR" \
  --sigma-decay "$SIGMA_DECAY"

echo "[5/5] Verify best evolved checkpoint"
npm run learn:evaluate -- "$EVOLVED"

echo "Done: $EVOLVED"
