#!/usr/bin/env python3
"""
Multi-Agent Neuroscience/ML Pipeline Orchestrator
==================================================
Runs agents in order:
  Architect → Researcher → DataMaster → Neuro Hypothesis →
  Master Coder → Chaos Engineer → Security Auditor → PM →
  [Master Coder writes to Historian]

Each stage is gated: a blocking failure halts the workflow and surfaces
the exact agent, output file, and failure reason. No silent failures.

Usage:
  python workflow.py --project <name> [--from-stage <stage>] [--dry-run]

  --project     Project name (used to name HISTORY entry)
  --from-stage  Resume from a specific stage (e.g., "chaos" to skip earlier stages)
  --dry-run     Print what would run without executing
"""

import argparse
import subprocess
import sys
import os
import re
import json
from datetime import datetime
from pathlib import Path

# ── Stage definitions ──────────────────────────────────────────────────────────

STAGES = [
    {
        "id": "architect",
        "label": "Systems Architect",
        "agent": "systems-architect",
        "output_files": ["SYSTEM_SPEC.md", "INTERFACE_CONTRACTS.md"],
        "blocking_patterns": [r"\[OPEN DECISION\]"],  # present in output = warn but don't block
        "block_on_missing_outputs": True,
        "prompt": (
            "You are the Systems Architect. Read HISTORY/ for prior related projects, "
            "then produce SYSTEM_SPEC.md and INTERFACE_CONTRACTS.md for the current project. "
            "Follow all rules in your agent definition exactly."
        ),
    },
    {
        "id": "researcher",
        "label": "Researcher",
        "agent": "researcher",
        "output_files": ["RESEARCH_BRIEF.md"],
        "blocking_patterns": [],
        "block_on_missing_outputs": True,
        "prompt": (
            "You are the Researcher. Read SYSTEM_SPEC.md and HISTORY/, then search for "
            "state-of-the-art methods and produce RESEARCH_BRIEF.md. "
            "Follow all rules in your agent definition exactly."
        ),
    },
    {
        "id": "data-master",
        "label": "DataMaster",
        "agent": "data-master",
        "output_files": ["DATA_AUDIT.md"],
        "blocking_patterns": [r"^Status:\s*BLOCKED", r"Verdict\s*\n.*BLOCKED"],
        "block_on_missing_outputs": True,
        "prompt": (
            "You are the DataMaster. Read SYSTEM_SPEC.md, INTERFACE_CONTRACTS.md, and "
            "RESEARCH_BRIEF.md, then audit all datasets and produce DATA_AUDIT.md. "
            "If you find CRITICAL issues, set Status: BLOCKED. "
            "Follow all rules in your agent definition exactly."
        ),
    },
    {
        "id": "neuro-hypothesis",
        "label": "Neuro Hypothesis",
        "agent": "neuro-hypothesis",
        "output_files": ["HYPOTHESES.md"],
        "blocking_patterns": [],
        "block_on_missing_outputs": True,
        "prompt": (
            "You are the Neuro Hypothesis Agent. Read SYSTEM_SPEC.md, RESEARCH_BRIEF.md, "
            "and DATA_AUDIT.md, then produce HYPOTHESES.md with mechanistic predictions, "
            "biologically plausible failure modes, and mandatory sanity checks. "
            "Follow all rules in your agent definition exactly."
        ),
    },
    {
        "id": "master-coder",
        "label": "Master Coder",
        "agent": "master-coder",
        "output_files": [],  # produces code; checked by pytest in later stages
        "blocking_patterns": [r"SPEC_CONFLICT:"],
        "block_on_missing_outputs": False,
        "prompt": (
            "You are the Master Coder. Read SYSTEM_SPEC.md, INTERFACE_CONTRACTS.md, "
            "RESEARCH_BRIEF.md, DATA_AUDIT.md, and HYPOTHESES.md. Implement all modules, "
            "write unit tests, and implement all HIGH PRIORITY sanity checks from HYPOTHESES.md. "
            "If you discover a spec conflict, add a SPEC_CONFLICT comment and stop. "
            "Do NOT write the HISTORY entry yet — that comes after PM sign-off. "
            "Follow all rules in your agent definition exactly."
        ),
    },
    {
        "id": "chaos",
        "label": "Chaos Engineer",
        "agent": "chaos-engineer",
        "output_files": ["CHAOS_REPORT.md"],
        "blocking_patterns": [r"^Status:\s*CRITICAL FINDINGS PRESENT", r"Status: CRITICAL FINDINGS PRESENT"],
        "block_on_missing_outputs": True,
        "prompt": (
            "You are the Chaos Engineer. Read all spec documents and all source code, "
            "then systematically inject adversarial inputs to find every failure mode. "
            "Produce CHAOS_REPORT.md. If critical findings remain unresolved, "
            "set Status: CRITICAL FINDINGS PRESENT. "
            "Follow all rules in your agent definition exactly."
        ),
    },
    {
        "id": "security",
        "label": "Security Auditor",
        "agent": "security-auditor",
        "output_files": ["SECURITY_AUDIT.md"],
        "blocking_patterns": [r"^Status:\s*BLOCKED", r"Status: BLOCKED"],
        "block_on_missing_outputs": True,
        "prompt": (
            "You are the Security/Reproducibility Auditor. Read all upstream documents "
            "and source code, then audit for reproducibility, data security, and research "
            "integrity. Produce SECURITY_AUDIT.md. If critical findings exist, set Status: BLOCKED. "
            "Follow all rules in your agent definition exactly."
        ),
    },
    {
        "id": "pm",
        "label": "Product Manager",
        "agent": "product-manager",
        "output_files": ["RELEASE_CHECKLIST.md"],
        "blocking_patterns": [r"PM Verdict:\s*RETURNED TO"],
        "block_on_missing_outputs": True,
        "prompt": (
            "You are the Product Manager. Read all upstream documents, run pytest, "
            "and verify full pipeline readiness. Produce RELEASE_CHECKLIST.md. "
            "If everything passes, set PM Verdict: SIGNED OFF. "
            "If anything fails, set PM Verdict: RETURNED TO <agent> with specific failure reasons. "
            "Follow all rules in your agent definition exactly."
        ),
    },
    {
        "id": "historian",
        "label": "Historian (post-sign-off)",
        "agent": "historian",
        "output_files": [],  # checked by verifying HISTORY/<project>.md exists
        "blocking_patterns": [],
        "block_on_missing_outputs": False,
        "prompt": (
            "The Product Manager has signed off. You are the Master Coder. "
            "Now write the HISTORY/{project}.md entry per the Historian agent template. "
            "Read SYSTEM_SPEC.md, RESEARCH_BRIEF.md, CHAOS_REPORT.md, SECURITY_AUDIT.md "
            "and RELEASE_CHECKLIST.md to fill in the entry accurately."
        ),
    },
]

STAGE_IDS = [s["id"] for s in STAGES]

# ── Helpers ────────────────────────────────────────────────────────────────────

def color(text: str, code: str) -> str:
    return f"\033[{code}m{text}\033[0m"

def red(t):    return color(t, "31")
def green(t):  return color(t, "32")
def yellow(t): return color(t, "33")
def blue(t):   return color(t, "34")
def bold(t):   return color(t, "1")

def header(stage: dict):
    bar = "─" * 60
    print(f"\n{bar}")
    print(bold(f"  STAGE: {stage['label'].upper()}"))
    print(f"  Agent: {stage['agent']}")
    print(f"  Time:  {datetime.now().strftime('%H:%M:%S')}")
    print(bar)

def check_output_files(stage: dict, project_root: Path) -> list[str]:
    """Returns list of missing required output files."""
    missing = []
    for fname in stage["output_files"]:
        path = project_root / fname
        if not path.exists():
            missing.append(str(fname))
    return missing

def check_blocking_patterns(stage: dict, project_root: Path) -> list[str]:
    """Returns list of blocking pattern matches found in output files."""
    findings = []
    for fname in stage["output_files"]:
        path = project_root / fname
        if not path.exists():
            continue
        content = path.read_text(errors="replace")
        for pattern in stage["blocking_patterns"]:
            if re.search(pattern, content, re.MULTILINE | re.IGNORECASE):
                findings.append(
                    f"Blocking pattern '{pattern}' found in {fname}"
                )
    return findings

def run_pytest(project_root: Path) -> tuple[bool, str]:
    """Run pytest if tests/ directory exists. Returns (passed, output)."""
    tests_dir = project_root / "tests"
    if not tests_dir.exists():
        return True, "(no tests/ directory found — skipping pytest)"
    result = subprocess.run(
        ["python", "-m", "pytest", "tests/", "-v", "--tb=short"],
        cwd=project_root,
        capture_output=True,
        text=True,
    )
    passed = result.returncode == 0
    return passed, result.stdout + result.stderr

def run_claude_agent(stage: dict, project: str, project_root: Path, dry_run: bool) -> bool:
    """
    Invokes `claude` CLI with the agent's prompt in a non-interactive way.
    Returns True if the stage should be considered complete, False if it should halt.
    """
    prompt = stage["prompt"].format(project=project)

    if dry_run:
        print(yellow(f"  [DRY RUN] Would invoke agent '{stage['agent']}' with prompt:"))
        print(f"    {prompt[:120]}...")
        return True

    # Build claude CLI command — use --agent flag to select the subagent
    cmd = [
        "claude",
        "--agent", stage["agent"],
        "--print",          # non-interactive output mode
        "--no-markdown",    # plain text output for parsing
        prompt,
    ]

    print(blue(f"  Invoking: claude --agent {stage['agent']}"))
    try:
        result = subprocess.run(
            cmd,
            cwd=project_root,
            text=True,
            timeout=600,  # 10 min max per stage
        )
        if result.returncode != 0:
            print(red(f"  Agent process exited with code {result.returncode}"))
            return False
    except subprocess.TimeoutExpired:
        print(red("  Agent timed out after 600 seconds."))
        return False
    except FileNotFoundError:
        # claude CLI not found — warn but don't crash; useful for dry testing
        print(yellow("  WARNING: 'claude' CLI not found on PATH. Skipping execution."))
        print(yellow("  In Claude Code, agents are invoked interactively. See CLAUDE.md."))
        return True

    return True

def halt(stage: dict, reason: str, findings: list[str]):
    print()
    print(red("╔══════════════════════════════════════════════════════════╗"))
    print(red("║               PIPELINE HALTED — BLOCKING FAILURE         ║"))
    print(red("╚══════════════════════════════════════════════════════════╝"))
    print(f"  {bold('Stage')}:   {stage['label']}")
    print(f"  {bold('Agent')}:   {stage['agent']}")
    print(f"  {bold('Reason')}:  {reason}")
    if findings:
        print(f"  {bold('Details')}:")
        for f in findings:
            print(f"    • {f}")
    print()
    print("  To resume after fixing the issue:")
    print(f"    python workflow.py --project <name> --from-stage {stage['id']}")
    print()
    sys.exit(1)

# ── Main orchestration ─────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", required=True, help="Project name (used for HISTORY entry filename)")
    parser.add_argument("--project-root", default=".", help="Project root directory (default: current directory)")
    parser.add_argument("--from-stage", choices=STAGE_IDS, default=None,
                        help="Resume from this stage (skip earlier stages)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would run without invoking agents")
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    project = args.project

    print(bold(f"\n{'═'*62}"))
    print(bold(f"  NEUROSCIENCE/ML PIPELINE ORCHESTRATOR"))
    print(bold(f"  Project: {project}"))
    print(bold(f"  Root:    {project_root}"))
    print(bold(f"  Mode:    {'DRY RUN' if args.dry_run else 'LIVE'}"))
    print(bold(f"{'═'*62}\n"))

    # Determine start index
    start_idx = 0
    if args.from_stage:
        start_idx = STAGE_IDS.index(args.from_stage)
        print(yellow(f"  Resuming from stage: {args.from_stage} (skipping {start_idx} earlier stages)\n"))

    active_stages = STAGES[start_idx:]

    for i, stage in enumerate(active_stages):
        header(stage)
        global_idx = start_idx + i + 1
        print(f"  Progress: {global_idx}/{len(STAGES)}")

        # ── Pre-flight: check upstream docs exist (skip in dry-run) ──────────
        if not args.dry_run:
            if stage["id"] == "master-coder":
                required_docs = ["SYSTEM_SPEC.md", "INTERFACE_CONTRACTS.md",
                                 "RESEARCH_BRIEF.md", "DATA_AUDIT.md", "HYPOTHESES.md"]
                missing_docs = [d for d in required_docs if not (project_root / d).exists()]
                if missing_docs:
                    halt(stage,
                         "Upstream documents missing — Master Coder cannot proceed",
                         [f"Missing: {d}" for d in missing_docs])

            if stage["id"] == "pm":
                required_docs = ["CHAOS_REPORT.md", "SECURITY_AUDIT.md"]
                missing_docs = [d for d in required_docs if not (project_root / d).exists()]
                if missing_docs:
                    halt(stage,
                         "Upstream audit reports missing — PM cannot review",
                         [f"Missing: {d}" for d in missing_docs])

        # ── Run the agent ──────────────────────────────────────────────────
        stage_prompt = stage.copy()
        stage_prompt["prompt"] = stage["prompt"].format(project=project)
        ok = run_claude_agent(stage, project, project_root, args.dry_run)
        if not ok:
            halt(stage, "Agent invocation failed", [])

        if args.dry_run:
            print(green("  [DRY RUN] Stage would complete."))
            continue

        # ── Post-run: verify output files exist ────────────────────────────
        if stage["block_on_missing_outputs"]:
            missing = check_output_files(stage, project_root)
            if missing:
                halt(stage,
                     f"Agent completed but required output files are missing",
                     [f"Missing: {f}" for f in missing])

        # ── Post-run: check for blocking patterns in outputs ───────────────
        blocking = check_blocking_patterns(stage, project_root)
        if blocking:
            halt(stage,
                 f"Output contains a blocking signal (see details below)",
                 blocking)

        # ── Special: run pytest after master-coder ─────────────────────────
        if stage["id"] == "master-coder":
            print(blue("  Running pytest..."))
            passed, output = run_pytest(project_root)
            if not passed:
                print(red("  PYTEST FAILED:"))
                print(output[-3000:])  # last 3000 chars of output
                halt(stage,
                     "Unit tests failed after Master Coder implementation",
                     ["pytest tests/ -v returned non-zero exit code"])
            else:
                print(green("  All tests passed."))

        # ── Special: verify HISTORY entry after historian stage ────────────
        if stage["id"] == "historian":
            history_file = project_root / "HISTORY" / f"{project}.md"
            if not history_file.exists():
                halt(stage,
                     "Historian stage completed but HISTORY entry was not written",
                     [f"Expected: HISTORY/{project}.md"])

        print(green(f"  ✓ Stage '{stage['label']}' complete."))

    # ── All stages passed ──────────────────────────────────────────────────────
    print()
    print(green("╔══════════════════════════════════════════════════════════╗"))
    print(green("║              PIPELINE COMPLETE — ALL STAGES PASSED       ║"))
    print(green("╚══════════════════════════════════════════════════════════╝"))
    print(f"  Project:    {project}")
    print(f"  History:    HISTORY/{project}.md")
    print(f"  Checklist:  RELEASE_CHECKLIST.md")
    print(f"  Completed:  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    # Write a run log
    log = {
        "project": project,
        "completed_at": datetime.now().isoformat(),
        "stages_run": [s["id"] for s in active_stages],
        "status": "COMPLETE",
    }
    (project_root / "pipeline_run_log.json").write_text(
        json.dumps(log, indent=2)
    )
    print(f"  Run log:    pipeline_run_log.json")
    print()

if __name__ == "__main__":
    main()
