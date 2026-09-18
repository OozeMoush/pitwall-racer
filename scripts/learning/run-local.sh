#!/usr/bin/env bash
set -euo pipefail

GENERATIONS="${GENERATIONS:-80}"
POPULATION="${POPULATION:-24}"
RESIDUAL_SIGMA="${RESIDUAL_SIGMA:-0.08}"
SIGMA_DECAY="${SIGMA_DECAY:-0.995}"
TRAIN_DEVICE="${TRAIN_DEVICE:-cuda}"

TEACHER="artifacts/pitwall-learning/teacher.jsonl"
RESIDUAL="artifacts/pitwall-learning/policy-residual.json"
OPTIMIZED_TRACE="artifacts/pitwall-learning/optimized-trace.jsonl"
DISTILLED="artifacts/pitwall-learning/policy-distilled.json"

echo "[1/6] Export and verify machine-only 25.458 s teacher"
npm run learn:teacher -- "$TEACHER"

echo "[2/6] Sparse trust-region residual search directly in Rapier"
npm run learn:residual -- \
  --output "$RESIDUAL" \
  --generations "$GENERATIONS" \
  --population "$POPULATION" \
  --sigma "$RESIDUAL_SIGMA" \
  --sigma-decay "$SIGMA_DECAY"

echo "[3/6] Verify machine teacher + best residual"
npm run learn:evaluate-residual -- "$RESIDUAL"

echo "[4/6] Export optimized machine-only trace for neural distillation"
npm run learn:export-residual -- "$RESIDUAL" "$OPTIMIZED_TRACE"

echo "[5/6] Distill optimized trace into standalone PyTorch MLP (device=$TRAIN_DEVICE)"
uv run tools/learning/train_teacher.py \
  --teacher "$OPTIMIZED_TRACE" \
  --output "$DISTILLED" \
  --device "$TRAIN_DEVICE"

echo "[6/6] Verify standalone distilled neural policy in authoritative Rapier"
if ! npm run learn:evaluate -- "$DISTILLED"; then
  echo "Distilled neural policy did not complete a valid lap. The verified residual policy remains the authoritative search result." >&2
fi

echo "Best searched policy: $RESIDUAL"
echo "Distilled neural candidate: $DISTILLED"
