# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "torch>=2.4,<3",
# ]
# ///
"""Behavior-clone the current machine-only Pitwall teacher into a tiny MLP.

Run with uv so CUDA-capable PyTorch is isolated from the game repo:

    uv run tools/learning/train_teacher.py

The exported JSON is intentionally framework-neutral and is consumed directly
by PitwallNeuralPolicy.ts. Human telemetry and the human PB are never inputs.
"""

from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path

import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

OBSERVATION_SIZE = 12
HIDDEN_SIZES = (16, 16)
ACTION_SIZE = 2


class PitwallPolicy(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.layers = nn.ModuleList(
            [
                nn.Linear(OBSERVATION_SIZE, HIDDEN_SIZES[0]),
                nn.Linear(HIDDEN_SIZES[0], HIDDEN_SIZES[1]),
                nn.Linear(HIDDEN_SIZES[1], ACTION_SIZE),
            ]
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        for layer in self.layers:
            x = torch.tanh(layer(x))
        return x


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--teacher",
        type=Path,
        default=Path("artifacts/pitwall-learning/teacher.jsonl"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("artifacts/pitwall-learning/policy-teacher.json"),
    )
    parser.add_argument("--epochs", type=int, default=1200)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--learning-rate", type=float, default=2e-3)
    parser.add_argument("--seed", type=int, default=56062)
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    return parser.parse_args()


def choose_device(requested: str) -> torch.device:
    if requested == "cuda":
        if not torch.cuda.is_available():
            raise SystemExit("--device cuda requested but torch.cuda.is_available() is false")
        return torch.device("cuda")
    if requested == "cpu":
        return torch.device("cpu")
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def load_teacher(path: Path) -> tuple[torch.Tensor, torch.Tensor]:
    observations: list[list[float]] = []
    actions: list[list[float]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, raw in enumerate(handle, 1):
            line = raw.strip()
            if not line:
                continue
            row = json.loads(line)
            observation = [float(value) for value in row["observation"]]
            action = [float(value) for value in row["action"]]
            if len(observation) != OBSERVATION_SIZE:
                raise ValueError(
                    f"line {line_number}: expected {OBSERVATION_SIZE} observations, "
                    f"got {len(observation)}"
                )
            if len(action) != ACTION_SIZE:
                raise ValueError(
                    f"line {line_number}: expected {ACTION_SIZE} actions, got {len(action)}"
                )
            if not all(math.isfinite(value) for value in observation + action):
                raise ValueError(f"line {line_number}: non-finite training value")
            observations.append(observation)
            actions.append(action)

    if len(observations) < 100:
        raise ValueError(f"teacher dataset is unexpectedly small: {len(observations)} rows")
    return (
        torch.tensor(observations, dtype=torch.float32),
        torch.tensor(actions, dtype=torch.float32),
    )


def export_policy(model: PitwallPolicy) -> dict[str, object]:
    layers: list[dict[str, object]] = []
    for layer in model.layers:
        weight = layer.weight.detach().cpu()
        bias = layer.bias.detach().cpu()
        layers.append(
            {
                "inputSize": layer.in_features,
                "outputSize": layer.out_features,
                "weights": weight.reshape(-1).tolist(),
                "biases": bias.tolist(),
            }
        )
    return {
        "version": 1,
        "observationSize": OBSERVATION_SIZE,
        "actionSize": ACTION_SIZE,
        "hiddenSizes": list(HIDDEN_SIZES),
        "layers": layers,
    }


def main() -> None:
    args = parse_args()
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)

    device = choose_device(args.device)
    observations, actions = load_teacher(args.teacher)
    count = observations.shape[0]

    generator = torch.Generator().manual_seed(args.seed)
    permutation = torch.randperm(count, generator=generator)
    validation_count = max(1, int(count * 0.12))
    validation_indices = permutation[:validation_count]
    train_indices = permutation[validation_count:]

    train_dataset = TensorDataset(observations[train_indices], actions[train_indices])
    train_loader = DataLoader(
        train_dataset,
        batch_size=min(args.batch_size, len(train_dataset)),
        shuffle=True,
        generator=generator,
    )
    validation_x = observations[validation_indices].to(device)
    validation_y = actions[validation_indices].to(device)

    model = PitwallPolicy().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=1e-6)
    loss_fn = nn.MSELoss()
    best_validation = float("inf")
    best_state: dict[str, torch.Tensor] | None = None

    for epoch in range(1, args.epochs + 1):
        model.train()
        running = 0.0
        batches = 0
        for batch_x, batch_y in train_loader:
            batch_x = batch_x.to(device)
            batch_y = batch_y.to(device)
            optimizer.zero_grad(set_to_none=True)
            prediction = model(batch_x)
            loss = loss_fn(prediction, batch_y)
            loss.backward()
            optimizer.step()
            running += float(loss.detach().cpu())
            batches += 1

        model.eval()
        with torch.no_grad():
            validation_loss = float(loss_fn(model(validation_x), validation_y).cpu())
        if validation_loss < best_validation:
            best_validation = validation_loss
            best_state = {
                key: value.detach().cpu().clone()
                for key, value in model.state_dict().items()
            }

        if epoch == 1 or epoch % 100 == 0 or epoch == args.epochs:
            print(
                f"epoch={epoch:4d} train_mse={running / max(1, batches):.7f} "
                f"validation_mse={validation_loss:.7f}"
            )

    if best_state is None:
        raise RuntimeError("training did not produce a checkpoint")
    model.load_state_dict(best_state)
    model = model.cpu().eval()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    policy = export_policy(model)
    args.output.write_text(json.dumps(policy, indent=2) + "\n", encoding="utf-8")

    metadata_path = args.output.with_suffix(".meta.json")
    metadata = {
        "teacher": str(args.teacher),
        "samples": count,
        "validationSamples": validation_count,
        "bestValidationMse": best_validation,
        "epochs": args.epochs,
        "seed": args.seed,
        "device": str(device),
        "cudaDevice": torch.cuda.get_device_name(0) if device.type == "cuda" else None,
        "humanTelemetryUsed": False,
    }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    print(
        json.dumps(
            {
                "output": str(args.output),
                "metadata": str(metadata_path),
                "device": str(device),
                "cudaDevice": metadata["cudaDevice"],
                "bestValidationMse": best_validation,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
