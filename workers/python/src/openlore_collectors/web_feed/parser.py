"""Feed parser using feedparser."""

import calendar
import datetime
from typing import Any, Dict, List, Optional, Tuple
import feedparser


def _struct_time_to_iso(st: Optional[Any]) -> Optional[str]:
    if not st:
        return None
    try:
        ts = calendar.timegm(st)
        dt = datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc)
        return dt.isoformat()
    except Exception:
        return None


def parse_feed_content(
    content_bytes: bytes, original_url: Optional[str] = None
) -> Tuple[Dict[str, Any], List[str]]:
    parsed = feedparser.parse(content_bytes)
    issues: List[str] = []

    if getattr(parsed, "bozo", 0):
        bozo_exc = getattr(parsed, "bozo_exception", None)
        exc_name = type(bozo_exc).__name__ if bozo_exc else "UnknownBozo"
        issues.append(f"feed_bozo_{exc_name}")

    feed_meta = {
        "title": parsed.feed.get("title", ""),
        "link": parsed.feed.get("link", original_url or ""),
        "description": parsed.feed.get("description", ""),
        "updated_at": _struct_time_to_iso(parsed.feed.get("updated_parsed")),
    }

    entries: List[Dict[str, Any]] = []
    for entry in parsed.entries:
        native_id = entry.get("id") or entry.get("guid") or None
        link = entry.get("link") or None
        title = entry.get("title") or None
        author = entry.get("author") or None
        if not author and "author_detail" in entry:
            author = entry.author_detail.get("name")

        published_at = _struct_time_to_iso(
            entry.get("published_parsed") or entry.get("created_parsed")
        )
        updated_at = _struct_time_to_iso(entry.get("updated_parsed"))

        body_val = ""
        format_type = "text"
        completeness = "unknown"

        # Check content blocks first
        if "content" in entry and entry.content:
            first_c = entry.content[0]
            body_val = first_c.get("value", "")
            c_type = first_c.get("type", "text/html")
            format_type = "html" if "html" in c_type else "text"
            completeness = "full" if len(body_val.strip()) > 200 else "summary"
        elif entry.get("summary"):
            body_val = entry.get("summary", "")
            format_type = "html" if "<" in body_val and ">" in body_val else "text"
            completeness = "summary"
        elif entry.get("description"):
            body_val = entry.get("description", "")
            format_type = "html" if "<" in body_val and ">" in body_val else "text"
            completeness = "summary"
        else:
            completeness = "empty"

        tags = [t.get("term") for t in entry.get("tags", []) if t.get("term")]

        entries.append(
            {
                "native_id": native_id,
                "link": link,
                "title": title,
                "author": author,
                "published_at": published_at,
                "updated_at": updated_at,
                "body": {
                    "value": body_val,
                    "format": format_type,
                    "completeness": completeness,
                },
                "tags": tags,
            }
        )

    return {"feed": feed_meta, "entries": entries}, issues
