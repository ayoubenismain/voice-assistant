from pydantic import BaseModel


class ClassOut(BaseModel):
    class_code: str
    subgroups: list[str]


class ClassList(BaseModel):
    synchronized: bool
    classes: list[ClassOut]


class SubgroupList(BaseModel):
    class_code: str
    subgroups: list[str]
