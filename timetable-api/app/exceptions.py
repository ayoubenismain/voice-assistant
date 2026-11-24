"""Application errors. Each carries an HTTP status and a stable machine code.

Messages must never contain credentials (tokens, headers, secrets).
"""


class AppError(Exception):
    status_code = 500
    code = "internal_error"

    def __init__(self, message: str, *, details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.details = details


class BadRequestError(AppError):
    status_code, code = 400, "bad_request"


class UnauthorizedError(AppError):
    status_code, code = 401, "unauthorized"


class ForbiddenError(AppError):
    status_code, code = 403, "forbidden"


class NotFoundError(AppError):
    status_code, code = 404, "not_found"


class SyncInProgressError(AppError):
    status_code, code = 409, "sync_in_progress"


class InvalidWorkbookError(AppError):
    status_code, code = 422, "invalid_workbook"


class ValidationFailedError(AppError):
    status_code, code = 422, "validation_failed"


class UpstreamError(AppError):
    status_code, code = 502, "upstream_error"


class AuthenticationError(UpstreamError):
    """ISSATSO+ rejected our credentials (HTTP 401/403) or none are configured."""

    code = "upstream_auth_failed"


class DownloadError(UpstreamError):
    code = "download_failed"
