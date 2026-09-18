#!/usr/bin/env bash
set -euo pipefail

GENERATIONS="${GENERATIONS:-80}"
POPULATION="${POPULATION:-24}"
RESIDUAL_SIGMA="${RESIDUAL_SIGMA:-0.12}"
RESIDUAL_LR="${RESIDUAL_LR:-0.03}"
SIGMA_DECAY="${SIGMA_DECAY:-0.995}"
TRAIN_DEVICE="${TRAIN_DEVICE:-cuda}"

TEACHER="artifacts/pitwall-learning/teacher.jsonl"
CLONE="artifacts/pitwall-learning/policy-teacher.json"
RESIDUAL="artifacts/pitwall-learning/policy-residual.json"

echo "[1/5] Export machine-only teacher trace"
npm run learn:teacher -- "$TEACHER"

echo "[2/5] Behavior clone with PyTorch (device=$TRAIN_DEVICE)"
uv run tools/learning/train_teacher.py \
  --teacher "$TEACHER" \
  --output "$CLONE" \
  --device "$TRAIN_DEVICE"

echo "[3/5] Verify cloned policy in authoritative Rapier environment"
if ! npm run learn:evaluate -- "$CLONE"; then
  echo "Clone did not complete a valid lap. Residual evolution requires a valid base; stopping." >&2
  exit 1
fi

echo "[4/5] Evolve bounded track-local residual controls directly in Rapier"
npm run learn:residual -- \
  --input "$CLONE" \
  --output "$RESIDUAL" \
  --generations "$GENERATIONS" \
  --population "$POPULATION" \
  --sigma "$RESIDUAL_SIGMA" \
  --learning-rate "$RESIDUAL_LR" \
  --sigma-decay "$SIGMA_DECAY"

echo "[5/5] Verify combined base + residual policy"
npm run learn:evaluate-residual -- "$CLONE" "$RESIDUAL"

echo "Done: $RESIDUAL"
