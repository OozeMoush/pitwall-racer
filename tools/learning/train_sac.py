# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "numpy>=2,<3",
#   "torch>=2.4,<3",
# ]
# ///

from __future__ import annotations

import argparse
import json
import math
import os
import random
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F


OBSERVATION_SIZE = 18
ACTION_SIZE = 3
ACTOR_HIDDEN = (128, 128)
LOG_STD_MIN = -5.0
LOG_STD_MAX = 1.0


@dataclass
class Config:
    envs: int
    steps: int
    learning_starts: int
    replay_size: int
    batch_size: int
    gradient_steps: int
    gamma: float
    tau: float
    actor_lr: float
    critic_lr: float
    alpha_lr: float
    initial_alpha: float
    eval_every: int
    log_every: int
    seed: int
    device: str
    output_prefix: Path
    resume: Path | None
    teacher_bootstrap: bool
    teacher_epochs: int
    dagger_rounds: int
    dagger_episodes: int
    dagger_epochs: int
    dagger_stabilization_rounds: int
    bootstrap_only: bool


class VectorRapierEnv:
    def __init__(
        self,
        repo_root: Path,
        envs: int,
        *,
        random_starts: bool = False,
        seed: int = 56068,
    ):
        tsx = repo_root / "node_modules" / ".bin" / "tsx"
        if not tsx.exists():
            raise RuntimeError(
                f"{tsx} does not exist. Run npm install before SAC training."
            )

        command = [
            str(tsx),
            "scripts/learning/rl-server.ts",
            "--envs",
            str(envs),
            "--seed",
            str(seed),
        ]
        if random_starts:
            command.append("--random-starts")

        self.process = subprocess.Popen(
            command,
            cwd=repo_root,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=None,
            text=True,
            bufsize=1,
        )
        if self.process.stdin is None or self.process.stdout is None:
            raise RuntimeError("Failed to open RL server pipes")

        self.stdin = self.process.stdin
        self.stdout = self.process.stdout
        ready = self._read()
        if ready.get("type") != "ready":
            raise RuntimeError(f"RL server did not become ready: {ready}")
        if ready.get("observationSize") != OBSERVATION_SIZE:
            raise RuntimeError(
                f"Observation size mismatch: {ready.get('observationSize')}"
            )
        if ready.get("actionSize") != ACTION_SIZE:
            raise RuntimeError(
                f"Action size mismatch: {ready.get('actionSize')}"
            )

        self.envs = int(ready["envs"])
        self.observations = np.asarray(
            ready["observations"], dtype=np.float32
        )

    def reset(self) -> np.ndarray:
        reply = self._request({"op": "reset"})
        self.observations = np.asarray(
            reply["observations"], dtype=np.float32
        )
        return self.observations.copy()

    def step(
        self, actions: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, list[Any]]:
        reply = self._request({
            "op": "step",
            "actions": actions.astype(np.float32).tolist(),
        })
        observations = np.asarray(reply["observations"], dtype=np.float32)
        rewards = np.asarray(reply["rewards"], dtype=np.float32)
        terminated = np.asarray(reply["terminated"], dtype=np.bool_)
        truncated = np.asarray(reply["truncated"], dtype=np.bool_)
        infos = list(reply["infos"])
        self.observations = observations
        return observations, rewards, terminated, truncated, infos

    def close(self) -> None:
        if self.process.poll() is not None:
            return
        try:
            self._request({"op": "close"})
        except Exception:
            pass
        finally:
            try:
                self.stdin.close()
            except Exception:
                pass
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()

    def _request(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.stdin.write(json.dumps(payload, separators=(",", ":")) + "\n")
        self.stdin.flush()
        return self._read()

    def _read(self) -> dict[str, Any]:
        line = self.stdout.readline()
        if not line:
            code = self.process.poll()
            raise RuntimeError(
                f"RL server closed unexpectedly (exit={code})"
            )
        payload = json.loads(line)
        if payload.get("type") == "error":
            raise RuntimeError(f"RL server error: {payload.get('message')}")
        return payload


class ReplayBuffer:
    def __init__(
        self,
        capacity: int,
        observation_size: int,
        action_size: int,
    ):
        self.capacity = capacity
        self.observations = np.empty(
            (capacity, observation_size), dtype=np.float32
        )
        self.actions = np.empty(
            (capacity, action_size), dtype=np.float32
        )
        self.rewards = np.empty((capacity, 1), dtype=np.float32)
        self.next_observations = np.empty(
            (capacity, observation_size), dtype=np.float32
        )
        self.dones = np.empty((capacity, 1), dtype=np.float32)
        self.position = 0
        self.size = 0

    def add_batch(
        self,
        observations: np.ndarray,
        actions: np.ndarray,
        rewards: np.ndarray,
        next_observations: np.ndarray,
        dones: np.ndarray,
    ) -> None:
        count = observations.shape[0]
        indices = (
            np.arange(self.position, self.position + count) % self.capacity
        )
        self.observations[indices] = observations
        self.actions[indices] = actions
        self.rewards[indices, 0] = rewards
        self.next_observations[indices] = next_observations
        self.dones[indices, 0] = dones.astype(np.float32)
        self.position = (self.position + count) % self.capacity
        self.size = min(self.capacity, self.size + count)

    def sample(
        self,
        batch_size: int,
        device: torch.device,
    ) -> tuple[torch.Tensor, ...]:
        indices = np.random.randint(0, self.size, size=batch_size)
        return (
            torch.as_tensor(
                self.observations[indices], device=device
            ),
            torch.as_tensor(
                self.actions[indices], device=device
            ),
            torch.as_tensor(
                self.rewards[indices], device=device
            ),
            torch.as_tensor(
                self.next_observations[indices], device=device
            ),
            torch.as_tensor(
                self.dones[indices], device=device
            ),
        )


class Actor(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.fc1 = nn.Linear(OBSERVATION_SIZE, ACTOR_HIDDEN[0])
        self.fc2 = nn.Linear(ACTOR_HIDDEN[0], ACTOR_HIDDEN[1])
        self.mean = nn.Linear(ACTOR_HIDDEN[1], ACTION_SIZE)
        self.log_std = nn.Linear(ACTOR_HIDDEN[1], ACTION_SIZE)

        # Generic driving prior only: straight steering, mostly-on throttle,
        # mostly-off brake. No corner, line, target-speed or human knowledge.
        nn.init.zeros_(self.mean.weight)
        nn.init.constant_(self.mean.bias, 0.0)
        with torch.no_grad():
            self.mean.bias[1] = 1.0
            self.mean.bias[2] = -2.0
        nn.init.zeros_(self.log_std.weight)
        nn.init.constant_(self.log_std.bias, -1.0)

    def features(self, observation: torch.Tensor) -> torch.Tensor:
        x = F.relu(self.fc1(observation))
        return F.relu(self.fc2(x))

    def distribution(
        self, observation: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor]:
        x = self.features(observation)
        mean = self.mean(x)
        log_std = self.log_std(x).clamp(LOG_STD_MIN, LOG_STD_MAX)
        return mean, log_std

    def sample(
        self, observation: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        mean, log_std = self.distribution(observation)
        std = log_std.exp()
        normal = torch.distributions.Normal(mean, std)
        raw = normal.rsample()
        action = torch.tanh(raw)
        log_prob = normal.log_prob(raw)
        log_prob -= torch.log(1 - action.pow(2) + 1e-6)
        log_prob = log_prob.sum(dim=-1, keepdim=True)
        deterministic = torch.tanh(mean)
        return action, log_prob, deterministic

    def deterministic(self, observation: torch.Tensor) -> torch.Tensor:
        mean, _ = self.distribution(observation)
        return torch.tanh(mean)


class Critic(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.network = nn.Sequential(
            nn.Linear(OBSERVATION_SIZE + ACTION_SIZE, 256),
            nn.ReLU(),
            nn.Linear(256, 256),
            nn.ReLU(),
            nn.Linear(256, 1),
        )

    def forward(
        self,
        observation: torch.Tensor,
        action: torch.Tensor,
    ) -> torch.Tensor:
        return self.network(torch.cat([observation, action], dim=-1))


def parse_args() -> Config:
    parser = argparse.ArgumentParser(
        description=(
            "Train a direct steer/throttle/brake policy with Soft Actor-Critic "
            "against the authoritative Pitwall Rapier environment."
        )
    )
    parser.add_argument("--envs", type=int, default=16)
    parser.add_argument("--steps", type=int, default=1_500_000)
    parser.add_argument("--learning-starts", type=int, default=40_000)
    parser.add_argument("--replay-size", type=int, default=500_000)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--gradient-steps", type=int, default=4)
    parser.add_argument("--gamma", type=float, default=0.9995)
    parser.add_argument("--tau", type=float, default=0.005)
    parser.add_argument("--actor-lr", type=float, default=3e-4)
    parser.add_argument("--critic-lr", type=float, default=3e-4)
    parser.add_argument("--alpha-lr", type=float, default=3e-4)
    parser.add_argument("--initial-alpha", type=float, default=0.1)
    parser.add_argument("--eval-every", type=int, default=50_000)
    parser.add_argument("--log-every", type=int, default=10_000)
    parser.add_argument("--seed", type=int, default=56068)
    parser.add_argument(
        "--device",
        choices=("cuda", "cpu", "auto"),
        default="cuda",
    )
    parser.add_argument(
        "--output-prefix",
        type=Path,
        default=Path("artifacts/pitwall-learning/policy-sac"),
    )
    parser.add_argument("--resume", type=Path)
    parser.add_argument(
        "--no-teacher-bootstrap",
        action="store_true",
        help="Start SAC from scratch instead of the machine-only teacher.",
    )
    parser.add_argument("--teacher-epochs", type=int, default=400)
    parser.add_argument("--dagger-rounds", type=int, default=4)
    parser.add_argument("--dagger-episodes", type=int, default=4)
    parser.add_argument("--dagger-epochs", type=int, default=160)
    parser.add_argument(
        "--dagger-stabilization-rounds",
        type=int,
        default=2,
        help=(
            "Additional learner-only DAgger rounds after the mixed-control "
            "ramp. These collect exactly the states where the current actor "
            "still leaves the circuit."
        ),
    )
    parser.add_argument(
        "--bootstrap-only",
        action="store_true",
        help="Pretrain/evaluate the actor from the machine teacher and exit.",
    )
    args = parser.parse_args()

    return Config(
        envs=max(1, args.envs),
        steps=max(1, args.steps),
        learning_starts=max(1, args.learning_starts),
        replay_size=max(10_000, args.replay_size),
        batch_size=max(32, args.batch_size),
        gradient_steps=max(1, args.gradient_steps),
        gamma=float(args.gamma),
        tau=float(args.tau),
        actor_lr=float(args.actor_lr),
        critic_lr=float(args.critic_lr),
        alpha_lr=float(args.alpha_lr),
        initial_alpha=max(1e-6, float(args.initial_alpha)),
        eval_every=max(1_000, args.eval_every),
        log_every=max(1_000, args.log_every),
        seed=int(args.seed),
        device=args.device,
        output_prefix=args.output_prefix,
        resume=args.resume,
        teacher_bootstrap=not args.no_teacher_bootstrap,
        teacher_epochs=max(1, args.teacher_epochs),
        dagger_rounds=max(0, args.dagger_rounds),
        dagger_episodes=max(1, args.dagger_episodes),
        dagger_epochs=max(1, args.dagger_epochs),
        dagger_stabilization_rounds=max(
            0,
            args.dagger_stabilization_rounds,
        ),
        bootstrap_only=bool(args.bootstrap_only),
    )


def select_device(requested: str) -> torch.device:
    if requested == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError(
            "CUDA was requested but torch.cuda.is_available() is false"
        )
    return torch.device(requested)


def export_machine_teacher(repo_root: Path, output: Path) -> None:
    tsx = repo_root / "node_modules" / ".bin" / "tsx"
    if not tsx.exists():
        raise RuntimeError(
            f"{tsx} does not exist. Run npm install before SAC training."
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            str(tsx),
            "scripts/learning/export-teacher.ts",
            str(output),
        ],
        cwd=repo_root,
        check=True,
    )


def load_machine_teacher(
    path: Path,
) -> tuple[torch.Tensor, torch.Tensor]:
    observations: list[list[float]] = []
    actions: list[list[float]] = []
    with path.open("r", encoding="utf-8") as handle:
        for raw in handle:
            if not raw.strip():
                continue
            row = json.loads(raw)
            observation = [float(value) for value in row["observation"]]
            physical = [float(value) for value in row["action"]]
            if len(observation) != OBSERVATION_SIZE:
                raise RuntimeError(
                    f"Teacher observation size mismatch: {len(observation)}"
                )
            if len(physical) != ACTION_SIZE:
                raise RuntimeError(
                    f"Teacher action size mismatch: {len(physical)}"
                )
            observations.append(observation)
            actions.append([
                physical[0],
                physical[1] * 2.0 - 1.0,
                physical[2] * 2.0 - 1.0,
            ])
    if len(observations) < 100:
        raise RuntimeError(
            f"Machine teacher dataset is too small: {len(observations)}"
        )
    return (
        torch.tensor(observations, dtype=torch.float32),
        torch.tensor(actions, dtype=torch.float32),
    )


def fit_actor_supervised(
    actor: Actor,
    observations: torch.Tensor,
    actions: torch.Tensor,
    device: torch.device,
    *,
    epochs: int,
    seed: int,
    learning_rate: float = 1e-3,
) -> float:
    generator = torch.Generator().manual_seed(seed)
    permutation = torch.randperm(
        observations.shape[0],
        generator=generator,
    )
    validation_count = max(1, int(observations.shape[0] * 0.12))
    validation_indices = permutation[:validation_count]
    train_indices = permutation[validation_count:]

    train_x = observations[train_indices].to(device)
    train_y = actions[train_indices].to(device)
    validation_x = observations[validation_indices].to(device)
    validation_y = actions[validation_indices].to(device)

    optimizer = torch.optim.AdamW(
        actor.parameters(),
        lr=learning_rate,
        weight_decay=1e-6,
    )
    batch_size = min(512, train_x.shape[0])
    best_validation = math.inf
    best_state: dict[str, torch.Tensor] | None = None

    for _epoch in range(1, epochs + 1):
        order = torch.randperm(
            train_x.shape[0],
            device=device,
        )
        actor.train()
        for batch_start in range(0, train_x.shape[0], batch_size):
            indices = order[batch_start:batch_start + batch_size]
            prediction = actor.deterministic(train_x[indices])
            loss = F.mse_loss(prediction, train_y[indices])
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()

        actor.eval()
        with torch.no_grad():
            validation_loss = float(
                F.mse_loss(
                    actor.deterministic(validation_x),
                    validation_y,
                ).cpu()
            )
        if validation_loss < best_validation:
            best_validation = validation_loss
            best_state = {
                key: value.detach().cpu().clone()
                for key, value in actor.state_dict().items()
            }

    if best_state is None:
        raise RuntimeError("Supervised actor fit produced no checkpoint")
    actor.load_state_dict(best_state)
    actor.eval()
    return best_validation


def collect_dagger_teacher(
    repo_root: Path,
    actor: Actor,
    *,
    round_index: int,
    learner_probability: float,
    episodes: int,
    seed: int,
) -> tuple[torch.Tensor, torch.Tensor, dict[str, Any]]:
    actor_path = (
        repo_root
        / "artifacts"
        / "pitwall-learning"
        / f"sac-dagger-actor-r{round_index}.json"
    )
    output_path = (
        repo_root
        / "artifacts"
        / "pitwall-learning"
        / f"sac-dagger-r{round_index}.jsonl"
    )
    export_actor(actor, actor_path)

    tsx = repo_root / "node_modules" / ".bin" / "tsx"
    completed = subprocess.run(
        [
            str(tsx),
            "scripts/learning/collect-dagger-teacher.ts",
            "--actor",
            str(actor_path),
            "--output",
            str(output_path),
            "--episodes",
            str(episodes),
            "--learner-probability",
            str(learner_probability),
            "--seed",
            str(seed),
        ],
        cwd=repo_root,
        check=True,
        text=True,
        capture_output=True,
    )
    summary_text = completed.stdout.strip()
    summary = json.loads(summary_text) if summary_text else {}
    observations, actions = load_machine_teacher(output_path)
    return observations, actions, summary


def pretrain_actor_from_teacher(
    actor: Actor,
    repo_root: Path,
    device: torch.device,
    epochs: int,
    seed: int,
    dagger_rounds: int,
    dagger_episodes: int,
    dagger_epochs: int,
    dagger_stabilization_rounds: int,
) -> dict[str, Any]:
    teacher_path = (
        repo_root
        / "artifacts"
        / "pitwall-learning"
        / "sac-machine-teacher.jsonl"
    )
    export_machine_teacher(repo_root, teacher_path)
    observations, actions = load_machine_teacher(teacher_path)

    best_validation = fit_actor_supervised(
        actor,
        observations,
        actions,
        device,
        epochs=epochs,
        seed=seed,
    )
    aggregate_observations = observations
    aggregate_actions = actions
    rounds: list[dict[str, Any]] = []

    best_learner_state: dict[str, torch.Tensor] | None = None
    best_learner_key: tuple[int, float] | None = None
    total_rounds = dagger_rounds + dagger_stabilization_rounds
    for round_index in range(1, total_rounds + 1):
        if round_index <= dagger_rounds:
            learner_probability = round_index / max(1, dagger_rounds)
            phase = "ramp"
        else:
            learner_probability = 1.0
            phase = "learner-only-stabilization"

        dagger_x, dagger_y, collector_summary = collect_dagger_teacher(
            repo_root,
            actor,
            round_index=round_index,
            learner_probability=learner_probability,
            episodes=dagger_episodes,
            seed=seed + round_index,
        )

        summaries = collector_summary.get("episodeSummaries", [])
        learner_only = learner_probability >= 1.0 - 1e-9
        learner_completed = (
            learner_only
            and bool(summaries)
            and all(
                summary.get("behaviorStatus") == "COMPLETED"
                for summary in summaries
            )
        )
        if learner_only and summaries:
            completed_count = sum(
                summary.get("behaviorStatus") == "COMPLETED"
                for summary in summaries
            )
            mean_progress = sum(
                float(summary.get("forwardProgressMetres") or 0.0)
                for summary in summaries
            ) / len(summaries)
            learner_key = (completed_count, mean_progress)
            if (
                best_learner_key is None
                or learner_key > best_learner_key
            ):
                best_learner_key = learner_key
                best_learner_state = {
                    key: value.detach().cpu().clone()
                    for key, value in actor.state_dict().items()
                }

        if learner_completed:
            rounds.append({
                "round": round_index,
                "phase": phase,
                "learnerProbability": learner_probability,
                "newSamples": int(dagger_x.shape[0]),
                "aggregateSamples": int(aggregate_observations.shape[0]),
                "validationMse": best_validation,
                "collector": collector_summary,
                "retrained": False,
                "bootstrapGatePassed": True,
            })
            print(
                json.dumps({
                    "event": "SAC_DAGGER_ROUND",
                    **rounds[-1],
                }),
                flush=True,
            )
            break

        aggregate_observations = torch.cat(
            [aggregate_observations, dagger_x],
            dim=0,
        )
        aggregate_actions = torch.cat(
            [aggregate_actions, dagger_y],
            dim=0,
        )
        best_validation = fit_actor_supervised(
            actor,
            aggregate_observations,
            aggregate_actions,
            device,
            epochs=dagger_epochs,
            seed=seed + 1000 + round_index,
            learning_rate=5e-4,
        )
        rounds.append({
            "round": round_index,
            "phase": phase,
            "learnerProbability": learner_probability,
            "newSamples": int(dagger_x.shape[0]),
            "aggregateSamples": int(aggregate_observations.shape[0]),
            "validationMse": best_validation,
            "collector": collector_summary,
            "retrained": True,
            "bootstrapGatePassed": False,
        })
        print(
            json.dumps({
                "event": "SAC_DAGGER_ROUND",
                **rounds[-1],
            }),
            flush=True,
        )

    if (
        best_learner_state is not None
        and not any(
            bool(round_data.get("bootstrapGatePassed"))
            for round_data in rounds
        )
    ):
        actor.load_state_dict(best_learner_state)

    actor.eval()
    return {
        "teacher": str(teacher_path),
        "samples": int(observations.shape[0]),
        "epochs": epochs,
        "bestValidationMse": best_validation,
        "daggerRounds": dagger_rounds,
        "daggerEpisodes": dagger_episodes,
        "daggerEpochs": dagger_epochs,
        "daggerStabilizationRounds": dagger_stabilization_rounds,
        "aggregateSamples": int(aggregate_observations.shape[0]),
        "rounds": rounds,
    }


def soft_update(
    source: nn.Module,
    target: nn.Module,
    tau: float,
) -> None:
    with torch.no_grad():
        for source_param, target_param in zip(
            source.parameters(), target.parameters(), strict=True
        ):
            target_param.mul_(1 - tau).add_(source_param, alpha=tau)


def normalized_episode_key(info: dict[str, Any]) -> tuple[Any, ...]:
    status = info.get("status")
    if status == "COMPLETED":
        return (
            0,
            float(info.get("lapSeconds") or math.inf),
            float(info.get("preciseLapSeconds") or math.inf),
        )
    if status == "INCOMPLETE":
        return (
            1,
            -float(info.get("forwardProgressMetres") or 0),
            math.inf,
        )
    return (
        2,
        -float(info.get("forwardProgressMetres") or 0),
        math.inf,
    )


@torch.no_grad()
def evaluate_actor(
    actor: Actor,
    environment: VectorRapierEnv,
    device: torch.device,
) -> dict[str, Any]:
    observation = environment.reset()
    while True:
        tensor = torch.as_tensor(observation, device=device)
        action = actor.deterministic(tensor).cpu().numpy()
        (
            observation,
            _reward,
            terminated,
            truncated,
            infos,
        ) = environment.step(action)
        if terminated[0] or truncated[0]:
            info = infos[0]
            if not isinstance(info, dict):
                raise RuntimeError("Evaluation episode ended without info")
            return info


def layer_json(layer: nn.Linear) -> dict[str, Any]:
    return {
        "inputSize": layer.in_features,
        "outputSize": layer.out_features,
        "weights": (
            layer.weight.detach()
            .cpu()
            .to(torch.float64)
            .numpy()
            .reshape(-1)
            .tolist()
        ),
        "biases": (
            layer.bias.detach()
            .cpu()
            .to(torch.float64)
            .numpy()
            .tolist()
        ),
    }


def export_actor(actor: Actor, path: Path) -> None:
    data = {
        "version": 1,
        "observationSize": OBSERVATION_SIZE,
        "actionSize": ACTION_SIZE,
        "hiddenSizes": list(ACTOR_HIDDEN),
        "hiddenLayers": [
            layer_json(actor.fc1),
            layer_json(actor.fc2),
        ],
        "meanLayer": layer_json(actor.mean),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, indent=2) + "\n",
        encoding="utf-8",
    )


def save_training_state(
    path: Path,
    *,
    actor: Actor,
    q1: Critic,
    q2: Critic,
    target_q1: Critic,
    target_q2: Critic,
    actor_optimizer: torch.optim.Optimizer,
    critic_optimizer: torch.optim.Optimizer,
    log_alpha: torch.Tensor,
    alpha_optimizer: torch.optim.Optimizer,
    transitions: int,
    best_info: dict[str, Any] | None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "actor": actor.state_dict(),
            "q1": q1.state_dict(),
            "q2": q2.state_dict(),
            "target_q1": target_q1.state_dict(),
            "target_q2": target_q2.state_dict(),
            "actor_optimizer": actor_optimizer.state_dict(),
            "critic_optimizer": critic_optimizer.state_dict(),
            "log_alpha": log_alpha.detach().cpu(),
            "alpha_optimizer": alpha_optimizer.state_dict(),
            "transitions": transitions,
            "best_info": best_info,
        },
        path,
    )


def write_meta(
    path: Path,
    config: Config,
    device: torch.device,
    transitions: int,
    evaluation: dict[str, Any],
    alpha: float,
) -> None:
    data = {
        "algorithm": "soft-actor-critic",
        "environment": "authoritative-rapier-120hz",
        "humanTelemetryUsed": False,
        "trajectoryTargetUsed": False,
        "targetSpeedUsed": False,
        "reward": (
            "signed forward physical progress only; positive constant scale; "
            "discounting favors faster progress; invalidity is terminal"
        ),
        "transitions": transitions,
        "device": str(device),
        "envs": config.envs,
        "gamma": config.gamma,
        "tau": config.tau,
        "alpha": alpha,
        "initialAlpha": config.initial_alpha,
        "randomTrainingStarts": True,
        "teacherBootstrap": config.teacher_bootstrap,
        "teacherBootstrapEpochs": config.teacher_epochs,
        "daggerRounds": config.dagger_rounds,
        "daggerEpisodes": config.dagger_episodes,
        "daggerEpochs": config.dagger_epochs,
        "daggerStabilizationRounds": (
            config.dagger_stabilization_rounds
        ),
        "evaluation": evaluation,
    }
    path.write_text(
        json.dumps(data, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    config = parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    output_prefix = (
        config.output_prefix
        if config.output_prefix.is_absolute()
        else repo_root / config.output_prefix
    )
    device = select_device(config.device)

    random.seed(config.seed)
    np.random.seed(config.seed)
    torch.manual_seed(config.seed)
    if device.type == "cuda":
        torch.cuda.manual_seed_all(config.seed)

    print(
        json.dumps(
            {
                "event": "SAC_START",
                "device": str(device),
                "cudaDevice": (
                    torch.cuda.get_device_name(0)
                    if device.type == "cuda"
                    else None
                ),
                "envs": config.envs,
                "targetTransitions": config.steps,
                "seed": config.seed,
                "teacherBootstrap": config.teacher_bootstrap,
                "teacherEpochs": config.teacher_epochs,
                "daggerRounds": config.dagger_rounds,
                "daggerEpisodes": config.dagger_episodes,
                "daggerEpochs": config.dagger_epochs,
                "daggerStabilizationRounds": (
                    config.dagger_stabilization_rounds
                ),
                "bootstrapOnly": config.bootstrap_only,
            }
        ),
        flush=True,
    )

    actor = Actor().to(device)
    q1 = Critic().to(device)
    q2 = Critic().to(device)
    target_q1 = Critic().to(device)
    target_q2 = Critic().to(device)
    target_q1.load_state_dict(q1.state_dict())
    target_q2.load_state_dict(q2.state_dict())
    for parameter in target_q1.parameters():
        parameter.requires_grad_(False)
    for parameter in target_q2.parameters():
        parameter.requires_grad_(False)

    bootstrap_meta: dict[str, Any] | None = None
    if config.teacher_bootstrap and config.resume is None:
        bootstrap_meta = pretrain_actor_from_teacher(
            actor,
            repo_root,
            device,
            config.teacher_epochs,
            config.seed,
            config.dagger_rounds,
            config.dagger_episodes,
            config.dagger_epochs,
            config.dagger_stabilization_rounds,
        )
        bootstrap_env = VectorRapierEnv(
            repo_root,
            1,
            random_starts=False,
            seed=config.seed + 2,
        )
        try:
            bootstrap_eval = evaluate_actor(
                actor,
                bootstrap_env,
                device,
            )
        finally:
            bootstrap_env.close()
        print(
            json.dumps({
                "event": "SAC_BOOTSTRAP_EVAL",
                "bootstrap": bootstrap_meta,
                "evaluation": bootstrap_eval,
            }),
            flush=True,
        )
        export_actor(
            actor,
            Path(f"{output_prefix}-bootstrap.json"),
        )
        if config.bootstrap_only:
            print(
                json.dumps({
                    "event": "SAC_BOOTSTRAP_DONE",
                    "evaluation": bootstrap_eval,
                    "policy": str(
                        Path(f"{output_prefix}-bootstrap.json")
                    ),
                }),
                flush=True,
            )
            return 0

    actor_optimizer = torch.optim.Adam(
        actor.parameters(), lr=config.actor_lr
    )
    critic_optimizer = torch.optim.Adam(
        list(q1.parameters()) + list(q2.parameters()),
        lr=config.critic_lr,
    )
    log_alpha = torch.tensor(
        math.log(config.initial_alpha),
        device=device,
        requires_grad=True,
    )
    alpha_optimizer = torch.optim.Adam(
        [log_alpha], lr=config.alpha_lr
    )
    target_entropy = -float(ACTION_SIZE)

    transitions = 0
    best_info: dict[str, Any] | None = None

    if config.resume is not None:
        resume_path = (
            config.resume
            if config.resume.is_absolute()
            else repo_root / config.resume
        )
        checkpoint = torch.load(
            resume_path,
            map_location=device,
            weights_only=False,
        )
        actor.load_state_dict(checkpoint["actor"])
        q1.load_state_dict(checkpoint["q1"])
        q2.load_state_dict(checkpoint["q2"])
        target_q1.load_state_dict(checkpoint["target_q1"])
        target_q2.load_state_dict(checkpoint["target_q2"])
        actor_optimizer.load_state_dict(checkpoint["actor_optimizer"])
        critic_optimizer.load_state_dict(checkpoint["critic_optimizer"])
        with torch.no_grad():
            log_alpha.copy_(checkpoint["log_alpha"].to(device))
        alpha_optimizer.load_state_dict(checkpoint["alpha_optimizer"])
        transitions = int(checkpoint.get("transitions", 0))
        best_info = checkpoint.get("best_info")
        print(
            json.dumps({
                "event": "SAC_RESUME",
                "checkpoint": str(resume_path),
                "transitions": transitions,
                "best": best_info,
            }),
            flush=True,
        )

    replay = ReplayBuffer(
        config.replay_size,
        OBSERVATION_SIZE,
        ACTION_SIZE,
    )

    train_env = VectorRapierEnv(
        repo_root,
        config.envs,
        random_starts=True,
        seed=config.seed,
    )
    eval_env = VectorRapierEnv(
        repo_root,
        1,
        random_starts=False,
        seed=config.seed + 1,
    )
    observation = train_env.observations.copy()
    next_eval = (
        (transitions // config.eval_every) + 1
    ) * config.eval_every
    next_log = (
        (transitions // config.log_every) + 1
    ) * config.log_every
    start_time = time.monotonic()
    last_actor_loss = math.nan
    last_critic_loss = math.nan
    last_alpha_loss = math.nan
    episode_count = 0
    training_lap_count = 0
    invalid_count = 0
    truncated_count = 0
    episode_progress_sum = 0.0
    episode_progress_max = 0.0
    invalid_reasons: dict[str, int] = {}

    try:
        while transitions < config.steps:
            with torch.no_grad():
                obs_tensor = torch.as_tensor(
                    observation,
                    device=device,
                )
                action, _log_prob, _deterministic = actor.sample(obs_tensor)
                action_np = action.cpu().numpy()

            (
                next_observation,
                rewards,
                terminated,
                truncated,
                infos,
            ) = train_env.step(action_np)
            done = np.logical_or(terminated, truncated)

            for index, ended in enumerate(done):
                if not ended:
                    continue
                info = infos[index]
                if not isinstance(info, dict):
                    continue
                episode_count += 1
                progress = float(info.get("forwardProgressMetres") or 0.0)
                episode_progress_sum += progress
                episode_progress_max = max(episode_progress_max, progress)
                if bool(info.get("trainingLapCompleted")):
                    training_lap_count += 1
                if info.get("status") == "INVALID":
                    invalid_count += 1
                    reason = str(info.get("invalidReason") or "UNKNOWN")
                    invalid_reasons[reason] = invalid_reasons.get(reason, 0) + 1
                if bool(truncated[index]):
                    truncated_count += 1

            replay.add_batch(
                observation,
                action_np,
                rewards,
                next_observation,
                done,
            )
            observation = next_observation
            transitions += config.envs

            if (
                replay.size >= config.batch_size
                and transitions >= config.learning_starts
            ):
                for _ in range(config.gradient_steps):
                    (
                        batch_obs,
                        batch_action,
                        batch_reward,
                        batch_next_obs,
                        batch_done,
                    ) = replay.sample(config.batch_size, device)

                    with torch.no_grad():
                        (
                            next_action,
                            next_log_prob,
                            _,
                        ) = actor.sample(batch_next_obs)
                        target_q = torch.minimum(
                            target_q1(batch_next_obs, next_action),
                            target_q2(batch_next_obs, next_action),
                        )
                        alpha = log_alpha.exp()
                        target_q = target_q - alpha * next_log_prob
                        target = batch_reward + (
                            1 - batch_done
                        ) * config.gamma * target_q

                    current_q1 = q1(batch_obs, batch_action)
                    current_q2 = q2(batch_obs, batch_action)
                    critic_loss = F.mse_loss(
                        current_q1, target
                    ) + F.mse_loss(current_q2, target)
                    critic_optimizer.zero_grad(set_to_none=True)
                    critic_loss.backward()
                    critic_optimizer.step()

                    sampled_action, log_prob, _ = actor.sample(batch_obs)
                    min_q = torch.minimum(
                        q1(batch_obs, sampled_action),
                        q2(batch_obs, sampled_action),
                    )
                    alpha_detached = log_alpha.exp().detach()
                    actor_loss = (
                        alpha_detached * log_prob - min_q
                    ).mean()
                    actor_optimizer.zero_grad(set_to_none=True)
                    actor_loss.backward()
                    actor_optimizer.step()

                    alpha_loss = -(
                        log_alpha
                        * (log_prob + target_entropy).detach()
                    ).mean()
                    alpha_optimizer.zero_grad(set_to_none=True)
                    alpha_loss.backward()
                    alpha_optimizer.step()

                    soft_update(q1, target_q1, config.tau)
                    soft_update(q2, target_q2, config.tau)

                    last_actor_loss = float(actor_loss.detach().cpu())
                    last_critic_loss = float(critic_loss.detach().cpu())
                    last_alpha_loss = float(alpha_loss.detach().cpu())

            if transitions >= next_log:
                elapsed = max(1e-6, time.monotonic() - start_time)
                print(
                    json.dumps({
                        "event": "SAC_PROGRESS",
                        "transitions": transitions,
                        "replay": replay.size,
                        "transitionsPerSecond": round(
                            transitions / elapsed, 1
                        ),
                        "actorLoss": last_actor_loss,
                        "criticLoss": last_critic_loss,
                        "alphaLoss": last_alpha_loss,
                        "alpha": float(
                            log_alpha.exp().detach().cpu()
                        ),
                        "episodes": episode_count,
                        "trainingLaps": training_lap_count,
                        "invalidEpisodes": invalid_count,
                        "truncatedEpisodes": truncated_count,
                        "meanEpisodeProgressMetres": (
                            episode_progress_sum / episode_count
                            if episode_count
                            else 0.0
                        ),
                        "maxEpisodeProgressMetres": episode_progress_max,
                        "invalidReasons": invalid_reasons,
                    }),
                    flush=True,
                )
                episode_count = 0
                training_lap_count = 0
                invalid_count = 0
                truncated_count = 0
                episode_progress_sum = 0.0
                episode_progress_max = 0.0
                invalid_reasons = {}
                next_log += config.log_every

            if transitions >= next_eval:
                info = evaluate_actor(actor, eval_env, device)
                latest_json = Path(f"{output_prefix}-latest.json")
                latest_pt = Path(f"{output_prefix}-latest.pt")
                latest_meta = Path(f"{output_prefix}-latest.meta.json")
                export_actor(actor, latest_json)
                save_training_state(
                    latest_pt,
                    actor=actor,
                    q1=q1,
                    q2=q2,
                    target_q1=target_q1,
                    target_q2=target_q2,
                    actor_optimizer=actor_optimizer,
                    critic_optimizer=critic_optimizer,
                    log_alpha=log_alpha,
                    alpha_optimizer=alpha_optimizer,
                    transitions=transitions,
                    best_info=best_info,
                )
                write_meta(
                    latest_meta,
                    config,
                    device,
                    transitions,
                    info,
                    float(log_alpha.exp().detach().cpu()),
                )

                improved = (
                    best_info is None
                    or normalized_episode_key(info)
                    < normalized_episode_key(best_info)
                )
                if improved:
                    best_info = dict(info)
                    best_json = Path(f"{output_prefix}-best.json")
                    best_pt = Path(f"{output_prefix}-best.pt")
                    best_meta = Path(f"{output_prefix}-best.meta.json")
                    export_actor(actor, best_json)
                    save_training_state(
                        best_pt,
                        actor=actor,
                        q1=q1,
                        q2=q2,
                        target_q1=target_q1,
                        target_q2=target_q2,
                        actor_optimizer=actor_optimizer,
                        critic_optimizer=critic_optimizer,
                        log_alpha=log_alpha,
                        alpha_optimizer=alpha_optimizer,
                        transitions=transitions,
                        best_info=best_info,
                    )
                    write_meta(
                        best_meta,
                        config,
                        device,
                        transitions,
                        info,
                        float(log_alpha.exp().detach().cpu()),
                    )
                    if info.get("status") == "COMPLETED":
                        export_actor(
                            actor,
                            Path(f"{output_prefix}.json"),
                        )
                        write_meta(
                            Path(f"{output_prefix}.meta.json"),
                            config,
                            device,
                            transitions,
                            info,
                            float(
                                log_alpha.exp().detach().cpu()
                            ),
                        )

                print(
                    json.dumps({
                        "event": "SAC_EVAL",
                        "transitions": transitions,
                        "improved": improved,
                        "evaluation": info,
                        "best": best_info,
                    }),
                    flush=True,
                )
                next_eval += config.eval_every

        final_info = evaluate_actor(actor, eval_env, device)
        print(
            json.dumps({
                "event": "SAC_DONE",
                "transitions": transitions,
                "final": final_info,
                "best": best_info,
                "bestPolicy": str(
                    Path(f"{output_prefix}-best.json")
                ),
                "completedPolicy": (
                    str(Path(f"{output_prefix}.json"))
                    if (
                        best_info is not None
                        and best_info.get("status") == "COMPLETED"
                    )
                    else None
                ),
            }),
            flush=True,
        )
    finally:
        train_env.close()
        eval_env.close()

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("SAC training interrupted", file=sys.stderr)
        raise
