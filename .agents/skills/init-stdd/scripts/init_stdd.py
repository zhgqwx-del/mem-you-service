"""Initialize a project with shared STDD specifications and role entry points."""

import argparse
from collections import Counter
from pathlib import Path
import re


SKILL_HOME = Path(__file__).resolve().parents[1]
ASSETS = SKILL_HOME / "assets"
STARTER = ASSETS / "starter"
TOKEN = re.compile(r"\{\{([A-Z_]+)\}\}")
CHANGE_ID = re.compile(r"[0-9]+-[a-z0-9]+(?:-[a-z0-9]+)*")
TEAM_PATHS = ("scripts", ".github/pull_request_template.md")
DEMO_PATHS = ("shipping", "tests", "Makefile", "specs/shipping",
              "changes/archive/001-shipping-quote", ".github/workflows/check.yml")
AGENT_PATHS = {
    "codex": Path(".agents/skills"),
    "claude": Path(".claude/skills"),
    "qoder": Path(".qoder/skills"),
}
PORTABLE_PATH = Path("docs/stdd/skills")
CALLS = {
    AGENT_PATHS["codex"]: "Codex 使用 `$stdd-start`。",
    AGENT_PATHS["claude"]: "Claude Code 使用 `/stdd-start`。",
    AGENT_PATHS["qoder"]: "Qoder 使用 `/stdd-start`。",
}


def bundle_files(root: Path, paths):
    for name in paths:
        path = root / name
        if path.is_dir():
            yield from (
                item for item in sorted(path.rglob("*"))
                if item.is_file() and item.name != ".DS_Store" and "__pycache__" not in item.parts
            )
        elif path.is_file():
            yield path
        else:
            raise FileNotFoundError(path)


def skill_directories(agent: str, custom: str) -> tuple[Path, ...]:
    if custom is not None:
        parts = custom.split("/")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*", custom) or any(
            part.lower() in {".", "..", ".git"} for part in parts
        ):
            raise ValueError("--skills-dir must be a project-relative directory such as .my-agent/skills")
        return (Path(custom),)
    if agent == "portable":
        return (PORTABLE_PATH,)
    if agent in AGENT_PATHS:
        return (AGENT_PATHS[agent],)
    if agent == "auto":
        location = Path(SKILL_HOME.parent.parent.name) / SKILL_HOME.parent.name
        if location in AGENT_PATHS.values():
            return (location,)
    return tuple(AGENT_PATHS.values())


def bundled_skills(directories: tuple[Path, ...]) -> dict[Path, bytes]:
    source = STARTER / ".agents/skills"
    templates = {path.relative_to(source): path.read_bytes() for path in bundle_files(source, (".",))}
    return {directory / path: data for directory in directories for path, data in templates.items()}


def build_plan(args, target: Path, directories: tuple[Path, ...]) -> dict[Path, bytes]:
    name = args.name if args.name is not None else target.name
    goal = args.goal.strip() if args.goal else ""
    goal_block = "\n".join(f"> {line}" for line in goal.splitlines()) if goal else "项目目标待定义。"
    extras = {
        "spec": "",
        "team": "通用技能、脚本与验证命令见[研发工作流](docs/stdd/workflows.md)。",
        "demo": "运行 `make check` 验证[运费练习](specs/shipping/spec.md)。"
                "通用技能与脚本见[研发工作流](docs/stdd/workflows.md)。",
    }
    fields = {
        "PROJECT_NAME": name.strip(),
        "GOAL": goal_block,
        "CHANGE_TITLE": args.change_title.strip(),
        "CHANGE_ID": args.change_id,
        "EXTRA_README": extras[args.profile],
        "DESIGN_LINK": f" · [技术设计](../../changes/{args.change_id}/design.md)" if args.design else "",
        "DESIGN_HANDOFF": "和[技术设计](design.md)" if args.design else "",
        "SKILLS_ROOT": directories[0].as_posix(),
        "SKILL_CALLS": "\n".join(
            "- " + (CALLS.get(directory) or f"请 Agent 阅读 `{directory.as_posix()}/stdd-start/SKILL.md` 并按步骤执行。")
            for directory in directories
        ),
    }
    if any(not fields[key] or len(fields[key].splitlines()) != 1 for key in ("PROJECT_NAME", "CHANGE_TITLE")):
        raise ValueError("Project name and change title must each be a non-empty line.")

    def render(path: Path) -> bytes:
        return TOKEN.sub(lambda match: fields[match[1]], path.read_text(encoding="utf-8")).encode("utf-8")

    base = ASSETS / "base"
    files = {path.relative_to(base): render(path) for path in bundle_files(base, (".",))}
    for path in bundle_files(STARTER, ("docs/stdd/templates",)):
        files[path.relative_to(STARTER)] = path.read_bytes()

    seed = Path("changes") / args.change_id
    for name in ("change.md", "spec.md"):
        files[seed / name] = render(ASSETS / "seed" / name)
    documents = ["ux-design.md", "tasks.md", "test-plan.md", "verification.md"]
    if args.design:
        documents.append("design.md")
    for name in documents:
        template = files[Path("docs/stdd/templates") / name].decode("utf-8")
        files[seed / name] = template.replace("<变更名称>", fields["CHANGE_TITLE"], 1).encode("utf-8")

    if args.profile in ("team", "demo"):
        for path in bundle_files(STARTER, TEAM_PATHS):
            files[path.relative_to(STARTER)] = path.read_bytes()
        files.update(bundled_skills(directories))
        workflow = Path("docs/stdd/workflows.md")
        files[workflow] = render(ASSETS / "team" / workflow)
    if args.profile == "demo":
        for path in bundle_files(STARTER, DEMO_PATHS):
            files[path.relative_to(STARTER)] = path.read_bytes()
    return files


def path_status(target: Path, relative: Path, data: bytes) -> str:
    parent = target
    for component in relative.parts[:-1]:
        parent /= component
        if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
            return "BLOCKED"
    path = target / relative
    if path.is_symlink() or (path.exists() and not path.is_file()):
        return "BLOCKED"
    if path.is_file():
        return "UNCHANGED" if path.read_bytes() == data else "KEEP"
    return "CREATE"


def create_file(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    created = False
    try:
        with path.open("xb") as file:
            created = True
            file.write(data)
    except OSError:
        if created:
            path.unlink(missing_ok=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", help="New project directory or existing repository root")
    parser.add_argument("--name", help="Project name (defaults to the target directory name)")
    parser.add_argument("--goal", help="Optional project goal, stored as user input in the draft")
    parser.add_argument("--profile", choices=("spec", "team", "demo"), default="team",
                        help="Content to generate (default: team)")
    destination = parser.add_mutually_exclusive_group()
    destination.add_argument("--agent", choices=("auto", "codex", "claude", "qoder", "all", "portable"),
                             default="all", help="Skill discovery layout (default: all)")
    destination.add_argument("--skills-dir", help="Custom skill directory relative to the project root")
    parser.add_argument("--skills-only", action="store_true", help="Add skill directories to an initialized project")
    parser.add_argument("--change-id", default="001-first-slice")
    parser.add_argument("--change-title", default="首个可验收切片")
    parser.add_argument("--design", action="store_true", help="Include a technical design document for the first change")
    parser.add_argument("--dry-run", action="store_true", help="Print the file plan without writing")
    args = parser.parse_args()

    if not args.skills_only and not CHANGE_ID.fullmatch(args.change_id):
        parser.error("--change-id must look like 001-first-slice")
    target = Path(args.target).expanduser().resolve()
    if target.exists() and not target.is_dir():
        parser.error("target must be a directory")
    if not args.skills_only and (target / "changes" / "archive" / args.change_id).is_dir():
        parser.error("change ID is already archived; choose --change-id for a new slice")

    try:
        directories = skill_directories(args.agent, args.skills_dir)
        files = bundled_skills(directories) if args.skills_only else build_plan(args, target, directories)
        if AGENT_PATHS["claude"] in directories and (Path("AGENTS.md") in files or (target / "AGENTS.md").is_file()):
            files[Path("CLAUDE.md")] = b"@AGENTS.md\n"
        # Read the complete plan before creating files. Recheck each path before writing.
        plan = {path: path_status(target, path, data) for path, data in sorted(files.items())}
        counts = Counter()
        mode = "skills only" if args.skills_only else args.profile
        print(f"{'Plan for' if args.dry_run else 'Initializing'} {target} ({mode})")
        for path, status in plan.items():
            if status == "CREATE" and not args.dry_run:
                status = path_status(target, path, files[path])
                if status == "CREATE":
                    try:
                        create_file(target / path, files[path])
                        status = "CREATED"
                    except FileExistsError:
                        status = path_status(target, path, files[path])
                        if status == "CREATE":
                            raise
            counts[status] += 1
            print(f"{status:9} {path.as_posix()}")
        print(", ".join(f"{count} {status.lower()}" for status, count in sorted(counts.items())))
    except (OSError, ValueError, UnicodeError) as error:
        parser.exit(1, f"Initialization failed: {error}\n")


if __name__ == "__main__":
    main()
