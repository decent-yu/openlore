"""Protocol definitions for Python worker."""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class WorkerRequest:
    protocol_version: int
    job_id: str
    operation: str
    input_path: str
    original_url: Optional[str] = None
    final_url: Optional[str] = None
    response_meta: Dict[str, Any] = field(default_factory=dict)
    options: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WorkerRequest":
        return cls(
            protocol_version=data["protocol_version"],
            job_id=data["job_id"],
            operation=data["operation"],
            input_path=data["input_path"],
            original_url=data.get("original_url"),
            final_url=data.get("final_url"),
            response_meta=data.get("response_meta", {}),
            options=data.get("options", {}),
        )


@dataclass
class WorkerError:
    code: str
    message: str
    retryable: bool

    def to_dict(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
        }


@dataclass
class WorkerResponse:
    protocol_version: int
    job_id: str
    status: str  # "success" | "partial" | "failed"
    data: Optional[Any] = None
    issues: List[str] = field(default_factory=list)
    error: Optional[WorkerError] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "protocol_version": self.protocol_version,
            "job_id": self.job_id,
            "status": self.status,
            "data": self.data,
            "issues": self.issues,
            "error": self.error.to_dict() if self.error else None,
        }
