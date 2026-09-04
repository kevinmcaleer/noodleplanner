"""Read .mpp files through pymppwriter, in the shape the importer expects.

The in-house reader (:mod:`noodle_core.mpp_reader`) uses hard-coded record
offsets per format variant, so files written from a newer Microsoft Project
template come back with every row marked as a summary, no durations and
unnamed resources.  pymppwriter reads the same files from their own field
maps, which is version-proof; this module presents its ``Project`` through the
small interface :func:`noodle_core.msproject.import_from_mpp` consumes, so the
markdown builder is unchanged.

Falls back to the in-house reader when pymppwriter is not installed.
"""

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class AdaptedTask:
    unique_id: int
    name: str
    outline_level: int
    summary: bool
    duration_days: Optional[float]
    percent_complete: int


@dataclass
class AdaptedResource:
    unique_id: int
    name: str


@dataclass
class AdaptedAssignment:
    task_unique_id: int
    resource_unique_id: int


@dataclass
class AdaptedDependency:
    predecessor_unique_id: int
    successor_unique_id: int


@dataclass
class AdaptedProject:
    """The subset of the MppProject interface the markdown builder uses."""

    title: str
    tasks: List[AdaptedTask] = field(default_factory=list)
    resources: List[AdaptedResource] = field(default_factory=list)
    assignments: List[AdaptedAssignment] = field(default_factory=list)
    dependencies: List[AdaptedDependency] = field(default_factory=list)

    def real_tasks(self) -> List[AdaptedTask]:
        return [t for t in self.tasks if t.outline_level > 0]

    def real_resources(self) -> List[AdaptedResource]:
        return [r for r in self.resources if r.name]

    def resource_by_uid(self, uid: int) -> Optional[AdaptedResource]:
        return next((r for r in self.resources if r.unique_id == uid), None)


def read_with_pymppwriter(path: str) -> AdaptedProject:
    """Read an .mpp via pymppwriter.

    Raises ImportError when pymppwriter is unavailable, so callers can fall
    back, and whatever pymppwriter raises when the file cannot be read.
    """
    from pymppwriter import read_project

    project = read_project(path)
    # a task with children is a summary: pymppwriter models the rollup rather
    # than storing a flag, and the markdown builder omits durations for these
    parents = {t.parent_uid for t in project.tasks if t.parent_uid}
    tasks = [
        AdaptedTask(
            unique_id=t.uid,
            name=t.name,
            outline_level=t.outline_level,
            summary=t.uid in parents,
            duration_days=t.duration_days,
            percent_complete=int(t.percent_complete or 0),
        )
        for t in project.tasks
    ]
    return AdaptedProject(
        title=project.title,
        tasks=tasks,
        resources=[AdaptedResource(r.uid, r.name) for r in project.resources],
        assignments=[
            AdaptedAssignment(a.task_uid, a.resource_uid) for a in project.assignments
        ],
        dependencies=[
            AdaptedDependency(r.pred_uid, r.succ_uid) for r in project.relations
        ],
    )
