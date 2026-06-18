import logging
from datetime import datetime

_logger = logging.getLogger("shortform_studio")


def log_message(msg: str, level: str = "inf") -> None:
    """No-op logger for the FastAPI context. Errors still go to the Python logger."""
    if level == "err":
        _logger.error(msg)
    else:
        _logger.info(msg)


def render_log(max_lines: int = 120) -> None:
    pass
