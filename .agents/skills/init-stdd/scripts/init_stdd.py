"""Initialize or upgrade a project with shared STDD specifications and role entry points."""

import argparse
from collections import Counter
from difflib import unified_diff
from http.client import HTTPException
from io import BytesIO
from pathlib import Path
import re
from stat import S_IMODE
from tempfile import NamedTemporaryFile
from typing import BinaryIO, Optional, Union
from urllib.request import urlopen
from zipfile import BadZipFile, ZipFile


SKILL_HOME = Path(__file__).resolve().parents[1]
ASSETS = SKILL_HOME / "assets"
STARTER = ASSETS / "starter"
TOKEN = re.compile(r"\{\{([A-Z_]+)\}\}")
CHANGE_ID = re.compile(r"[0-9]+-[a-z0-9]+(?:-[a-z0-9]+)*")
RELEASE_TAG = re.compile(r"v[0-9]+\.[0-9]+\.[0-9]+")
RELEASE_ZIP = "https://github.com/zhgqwx-del/stdd-sdd/releases/download/{tag}/init-stdd.zip"
BUNDLE_VERSION = SKILL_HOME / "VERSION"
PROJECT_VERSION = Path(".stdd-version")
TEAM_PATHS = ("scripts", ".github/pull_request_template.md")
TEMPLATES = "docs/stdd/templates"
WORKFLOW = Path("docs/stdd/workflows.md")
SKILL_SOURCE = Path(".agents/skills")
SHARED_DOCS = {
    Path("AGENTS.md"),
    Path("docs/engineering.md"),
    Path("docs/stdd/roles.md"),
    Path("docs/stdd/git-workflow.md"),
    Path("docs/stdd/decisions-and-discussions.md"),
}
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


def skill_directories(agent: Optional[str], custom: Optional[str]) -> tuple[Path, ...]:
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
    source = STARTER / SKILL_SOURCE
    templates = {path.relative_to(source): path.read_bytes() for path in bundle_files(source, (".",))}
    return {directory / path: data for directory in directories for path, data in templates.items()}


def workflow_fields(directories: tuple[Path, ...]) -> dict[str, str]:
    return {
        "SKILLS_ROOT": directories[0].as_posix(),
        "SKILL_CALLS": "\n".join(
            "- " + (CALLS.get(directory) or f"请 Agent 阅读 `{directory.as_posix()}/stdd-start/SKILL.md` 并按步骤执行。")
            for directory in directories
        ),
    }


def render_template(template: str, fields: dict[str, str]) -> bytes:
    return TOKEN.sub(lambda match: fields[match[1]], template).encode("utf-8")


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
        **workflow_fields(directories),
    }
    if any(not fields[key] or len(fields[key].splitlines()) != 1 for key in ("PROJECT_NAME", "CHANGE_TITLE")):
        raise ValueError("Project name and change title must each be a non-empty line.")

    def render(path: Path) -> bytes:
        return render_template(path.read_text(encoding="utf-8"), fields)

    base = ASSETS / "base"
    files = {path.relative_to(base): render(path) for path in bundle_files(base, (".",))}
    for path in bundle_files(STARTER, (TEMPLATES,)):
        files[path.relative_to(STARTER)] = path.read_bytes()

    seed = Path("changes") / args.change_id
    for name in ("change.md", "spec.md"):
        files[seed / name] = render(ASSETS / "seed" / name)
    documents = ["ux-design.md", "tasks.md", "test-plan.md", "verification.md"]
    if args.design:
        documents.append("design.md")
    for name in documents:
        template = files[Path(TEMPLATES) / name].decode("utf-8")
        files[seed / name] = template.replace("<变更名称>", fields["CHANGE_TITLE"], 1).encode("utf-8")

    if args.profile in ("team", "demo"):
        for path in bundle_files(STARTER, TEAM_PATHS):
            files[path.relative_to(STARTER)] = path.read_bytes()
        files.update(bundled_skills(directories))
        files[WORKFLOW] = render(ASSETS / "team" / WORKFLOW)
    if args.profile == "demo":
        for path in bundle_files(STARTER, DEMO_PATHS):
            files[path.relative_to(STARTER)] = path.read_bytes()
    return files


def path_blocked(target: Path, relative: Path) -> bool:
    parent = target
    for component in relative.parts[:-1]:
        parent /= component
        if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
            return True
    path = target / relative
    return path.is_symlink() or (path.exists() and not path.is_file())


def path_status(target: Path, relative: Path, data: bytes) -> str:
    if path_blocked(target, relative):
        return "BLOCKED"
    path = target / relative
    if path.is_file():
        return "UNCHANGED" if path.read_bytes() == data else "KEEP"
    return "CREATE"


def initialized_project(target: Path) -> bool:
    markers = (Path("docs/stdd/project.md"), Path(TEMPLATES) / "spec.md", WORKFLOW)
    return any(not path_blocked(target, path) and (target / path).is_file() for path in markers)


def release_tag(value: str) -> str:
    tag = value.strip()
    if not RELEASE_TAG.fullmatch(tag):
        raise ValueError("Expected a release tag in the form vX.Y.Z")
    return tag


def project_version_bytes(target: Path) -> Optional[bytes]:
    if path_blocked(target, PROJECT_VERSION):
        raise ValueError(f"Blocked version record: {target / PROJECT_VERSION}")
    try:
        return (target / PROJECT_VERSION).read_bytes()
    except FileNotFoundError:
        return None


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


def managed_asset(path: Path) -> bool:
    if path.parts[0] == "base":
        return path.relative_to("base") in SHARED_DOCS
    if path.parts[0] == "team":
        return path.relative_to("team") == WORKFLOW
    if path.parts[0] == "starter":
        relative = path.relative_to("starter")
        directories = (Path(TEMPLATES), SKILL_SOURCE, Path("scripts"))
        return relative == Path(".github/pull_request_template.md") or any(
            root in relative.parents for root in directories
        )
    return False


def load_baseline(bundle: Union[Path, BinaryIO], expected_tag: Optional[str] = None) -> dict[Path, bytes]:
    assets = {}
    prefix = "init-stdd/assets/"
    with ZipFile(bundle) as archive:
        if expected_tag and "init-stdd/VERSION" in archive.namelist():
            actual_tag = release_tag(archive.read("init-stdd/VERSION").decode("ascii"))
            if actual_tag != expected_tag:
                raise ValueError(f"Baseline ZIP declares {actual_tag}, expected {expected_tag}")
        for entry in archive.infolist():
            if entry.is_dir() or not entry.filename.startswith(prefix):
                continue
            name = entry.filename[len(prefix):]
            path = Path(name)
            if not path.parts or path.as_posix() != name or path.is_absolute() or ".." in path.parts:
                raise ValueError(f"Invalid asset path in baseline ZIP: {entry.filename}")
            if managed_asset(path):
                if path in assets:
                    raise ValueError(f"Duplicate asset in baseline ZIP: {entry.filename}")
                assets[path] = archive.read(entry)
    if Path("starter") / TEMPLATES / "spec.md" not in assets:
        raise ValueError("Baseline ZIP must be a released init-stdd.zip")
    return assets


def download_baseline(tag: str) -> dict[Path, bytes]:
    print(f"Downloading baseline ZIP for {tag}")
    try:
        with urlopen(RELEASE_ZIP.format(tag=tag), timeout=30) as response:
            bundle = BytesIO(response.read())
    except (OSError, HTTPException) as error:
        raise ValueError(
            f"Could not download baseline for {tag}. Use --from-bundle with the matching ZIP. {error}"
        ) from error
    return load_baseline(bundle, expected_tag=tag)


def installed_directories(target: Path, assets: dict[Path, bytes]) -> tuple[Path, ...]:
    source = Path("starter") / SKILL_SOURCE
    skills = {Path(path.relative_to(source).parts[0]) for path in assets if source in path.parents}
    roots = (*AGENT_PATHS.values(), PORTABLE_PATH)
    workflow = target / WORKFLOW
    if not path_blocked(target, WORKFLOW) and workflow.is_file():
        text = workflow.read_text(encoding="utf-8", errors="replace")
        link = re.search(r"\]\(\.\./\.\./([A-Za-z0-9_./-]+)/stdd-start/SKILL\.md\)", text)
        if link:
            try:
                roots = (*roots, *skill_directories(None, link[1]))
            except ValueError:
                pass
    return tuple(root for root in dict.fromkeys(roots) if any(
        not path_blocked(target, root / skill / "SKILL.md") and (target / root / skill).is_dir()
        for skill in skills
    ))


def upgrade_files(assets: dict[Path, bytes], directories: tuple[Path, ...]) -> dict[Path, bytes]:
    files = {}
    fields = workflow_fields(directories) if directories else {}
    for path, data in assets.items():
        group, *parts = path.parts
        relative = Path(*parts)
        if group == "base" or relative.is_relative_to(TEMPLATES):
            files[relative] = data
        elif directories and group == "team":
            files[relative] = render_template(data.decode("utf-8"), fields)
        elif directories and relative.is_relative_to(SKILL_SOURCE):
            for directory in directories:
                files[directory / relative.relative_to(SKILL_SOURCE)] = data
        elif directories:
            files[relative] = data
    return files


def upgrade_status(target: Path, path: Path, before: Optional[bytes], after: Optional[bytes]) -> str:
    if path_blocked(target, path):
        return "BLOCKED"
    try:
        local = (target / path).read_bytes()
    except FileNotFoundError:
        local = None
    if local == after:
        return "UNCHANGED"
    if after is None:
        return "RETIRED"
    if local is None:
        return "CREATE" if before is None else "MISSING"
    if local == before:
        return "UPDATE"
    return "KEEP" if before == after else "MERGE"


def apply_upgrade(target: Path, path: Path, before: Optional[bytes], after: bytes, status: str) -> str:
    if upgrade_status(target, path, before, after) != status:
        return "CHANGED"
    destination = target / path
    if status == "CREATE":
        try:
            create_file(destination, after)
        except FileExistsError:
            return "CHANGED"
        return "CREATED"

    try:
        mode = S_IMODE(destination.stat().st_mode)
    except FileNotFoundError:
        return "CHANGED"
    with NamedTemporaryFile(dir=destination.parent, delete=False) as pending:
        temporary = Path(pending.name)
    try:
        temporary.write_bytes(after)
        temporary.chmod(mode)
        if upgrade_status(target, path, before, after) != status:
            return "CHANGED"
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return "UPDATED"


def save_project_version(target: Path, previous: Optional[bytes], tag: str, dry_run: bool) -> None:
    data = (tag + "\n").encode("ascii")
    status = upgrade_status(target, PROJECT_VERSION, previous, data)
    if status == "UNCHANGED":
        return
    if status not in ("CREATE", "UPDATE"):
        raise ValueError(f"{PROJECT_VERSION} changed or is blocked. Preview again.")
    if not dry_run and apply_upgrade(target, PROJECT_VERSION, previous, data, status) == "CHANGED":
        raise ValueError(f"{PROJECT_VERSION} changed during the run. Preview again.")
    print(f"{'RECORD' if dry_run else 'RECORDED':9} {PROJECT_VERSION} ({tag})")


def print_upgrade_diff(path: Path, before: Optional[bytes], after: bytes) -> None:
    old_lines = (before or b"").decode("utf-8", errors="replace").splitlines(keepends=True)
    new_lines = (after or b"").decode("utf-8", errors="replace").splitlines(keepends=True)
    for line in unified_diff(old_lines, new_lines, f"baseline/{path.as_posix()}", f"new/{path.as_posix()}"):
        print(line, end="" if line.endswith("\n") else "\n\\ No newline at end of file\n")
    if old_lines == new_lines:
        print("(File bytes differ in encoding.)")


def upgrade_project(args, target: Path, tag: str) -> None:
    if not target.is_dir():
        raise ValueError("Upgrade target must be an initialized project directory")
    previous = project_version_bytes(target)
    new_assets = {
        path.relative_to(ASSETS): path.read_bytes()
        for path in bundle_files(ASSETS, (".",))
        if managed_asset(path.relative_to(ASSETS))
    }
    if args.from_bundle:
        old_assets = load_baseline(Path(args.from_bundle).expanduser())
    elif previous is None:
        raise ValueError(f"No {PROJECT_VERSION} found. Use --record-version TAG or --from-bundle ZIP.")
    else:
        old_tag = release_tag(previous.decode("ascii"))
        old_assets = new_assets if old_tag == tag else download_baseline(old_tag)
    installed = installed_directories(target, {**old_assets, **new_assets})
    if args.profile == "spec":
        directories = ()
    elif args.agent or args.skills_dir:
        directories = skill_directories(args.agent, args.skills_dir)
    else:
        directories = installed
    before = upgrade_files(old_assets, directories)
    after = upgrade_files(new_assets, directories)
    paths = sorted(before.keys() | after.keys())
    plan = {path: upgrade_status(target, path, before.get(path), after.get(path)) for path in paths}
    if all(status in ("CREATE", "MISSING", "BLOCKED") for status in plan.values()):
        raise ValueError("No installed STDD files found in the selected project and skill directories")

    print(f"{'Upgrade plan for' if args.dry_run else 'Upgrading'} {target}")
    if not directories and args.profile != "spec":
        print("No known skill directory detected. For a custom directory, pass --skills-dir.")
    counts = Counter()
    for path, status in plan.items():
        latest = after.get(path)
        if status in ("CREATE", "UPDATE") and not args.dry_run:
            status = apply_upgrade(target, path, before.get(path), after[path], status)
        counts[status] += 1
        print(f"{status:9} {path.as_posix()}")
        if args.dry_run and latest is not None and status in ("CREATE", "UPDATE", "MERGE"):
            print_upgrade_diff(path, before.get(path), latest)
    print(", ".join(f"{count} {status.lower()}" for status, count in sorted(counts.items())))
    if counts["MERGE"]:
        print("MERGE files were kept. Apply the upstream changes manually.")
    if counts["CHANGED"]:
        print("CHANGED files were skipped because they changed during the run. Preview again.")
    if set(installed).difference(directories) or (not directories and (target / WORKFLOW).exists()):
        print("Version record kept because the upgrade covered only part of the installed scaffold.")
    elif any(counts[status] for status in ("MERGE", "BLOCKED", "CHANGED")):
        print("Version record kept. After resolving outstanding items, rerun or use --record-version TAG to confirm.")
    else:
        save_project_version(target, previous, tag, args.dry_run)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", help="New project directory or existing repository root")
    parser.add_argument("--name", help="Project name (defaults to the target directory name)")
    parser.add_argument("--goal", help="Optional project goal, stored as user input in the draft")
    parser.add_argument("--profile", choices=("spec", "team", "demo"),
                        help="Content to generate (default for initialization: team)")
    destination = parser.add_mutually_exclusive_group()
    destination.add_argument("--agent", choices=("auto", "codex", "claude", "qoder", "all", "portable"),
                             help="Skill layout (default: all for initialization, detected for upgrade)")
    destination.add_argument("--skills-dir", help="Custom skill directory relative to the project root")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--skills-only", action="store_true", help="Add skill directories to an initialized project")
    mode.add_argument("--upgrade", action="store_true", help="Upgrade from the recorded project version")
    mode.add_argument("--record-version", metavar="TAG", help="Record a confirmed release tag for an initialized project")
    parser.add_argument("--from-bundle", metavar="ZIP", help="Use a local baseline ZIP for --upgrade")
    parser.add_argument("--change-id", default="001-first-slice")
    parser.add_argument("--change-title", default="首个可验收切片")
    parser.add_argument("--design", action="store_true", help="Include a technical design document for the first change")
    parser.add_argument("--dry-run", action="store_true", help="Print the file plan without writing")
    args = parser.parse_args()

    if args.from_bundle is not None and not args.upgrade:
        parser.error("--from-bundle requires --upgrade")
    target = Path(args.target).expanduser().resolve()
    if args.record_version is not None:
        try:
            tag = release_tag(args.record_version)
            if not initialized_project(target):
                raise ValueError("Version recording requires an initialized STDD project")
            save_project_version(target, project_version_bytes(target), tag, args.dry_run)
        except (OSError, ValueError) as error:
            parser.exit(1, f"Version recording failed: {error}\n")
        return
    if args.upgrade:
        try:
            tag = release_tag(BUNDLE_VERSION.read_text(encoding="ascii"))
            upgrade_project(args, target, tag)
        except (OSError, ValueError, BadZipFile, RuntimeError, KeyError) as error:
            parser.exit(1, f"Upgrade failed: {error}\n")
        return

    args.profile = args.profile or "team"
    args.agent = args.agent or "all"
    if not args.skills_only and not CHANGE_ID.fullmatch(args.change_id):
        parser.error("--change-id must look like 001-first-slice")
    if target.exists() and not target.is_dir():
        parser.error("target must be a directory")
    if not args.skills_only and (target / "changes" / "archive" / args.change_id).is_dir():
        parser.error("change ID is already archived; choose --change-id for a new slice")

    try:
        record = target / PROJECT_VERSION
        record_blocked = not args.skills_only and path_blocked(target, PROJECT_VERSION)
        should_record = not args.skills_only and not record_blocked and not record.exists()
        is_new = should_record and not initialized_project(target)
        if is_new:
            tag = release_tag(BUNDLE_VERSION.read_text(encoding="ascii"))
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
        if is_new and not counts["BLOCKED"]:
            save_project_version(target, None, tag, args.dry_run)
        elif record_blocked:
            print(f"BLOCKED   {PROJECT_VERSION}")
        elif should_record:
            print(f"No {PROJECT_VERSION} written. Use --record-version TAG once the baseline is confirmed.")
    except (OSError, ValueError, UnicodeError) as error:
        parser.exit(1, f"Initialization failed: {error}\n")


if __name__ == "__main__":
    main()
