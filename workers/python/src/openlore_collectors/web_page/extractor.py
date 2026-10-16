"""Article extractor using trafilatura."""

import re
import json
import datetime
from lxml import html as lxml_html
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlsplit
import trafilatura
from trafilatura.metadata import extract_metadata


def extract_images_from_html(
    html: str, base_url: Optional[str] = None
) -> List[Dict[str, Any]]:
    images: List[Dict[str, Any]] = []
    # Match img tags and their attributes
    img_tag_pattern = re.compile(r"<img\b([^>]*)>", re.IGNORECASE)
    attr_pattern = re.compile(
        r'([a-zA-Z0-9_\-]+)\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))'
    )

    for match in img_tag_pattern.finditer(html):
        attrs_str = match.group(1)
        attrs = {}
        for attr_match in attr_pattern.finditer(attrs_str):
            name = attr_match.group(1).lower()
            val = (
                attr_match.group(2)
                or attr_match.group(3)
                or attr_match.group(4)
                or ""
            )
            attrs[name] = val

        src = (
            attrs.get("data-src")
            or attrs.get("data-original")
            or attrs.get("src")
            or ""
        )
        if not src:
            srcset = attrs.get("srcset", "")
            if srcset:
                src = srcset.split(",")[0].strip().split(" ")[0]

        if not src:
            continue

        resolved_url = urljoin(base_url, src) if base_url else src
        images.append(
            {
                "src": resolved_url,
                "alt": attrs.get("alt", ""),
                "title": attrs.get("title", ""),
                "raw_src": src,
            }
        )

    return images


def publication_evidence(html_content: str, url: Optional[str] = None) -> Dict[str, Any]:
    """Use explicit article publication metadata, never a date guessed from page links."""
    tree = lxml_html.fromstring(html_content)
    dates = []
    modified = []
    def visit(value):
        if isinstance(value, list):
            for child in value:
                visit(child)
        elif isinstance(value, dict):
            types = value.get("@type", [])
            if isinstance(types, str):
                types = [types]
            if any(t in ("Article", "BlogPosting", "NewsArticle", "TechArticle", "ScholarlyArticle") for t in types):
                if value.get("datePublished"):
                    dates.append(("jsonld.datePublished", value["datePublished"]))
                if value.get("dateModified"):
                    modified.append(value["dateModified"])
            for key in ("@graph", "mainEntity"):
                if key in value:
                    visit(value[key])
    for raw in tree.xpath('//script[@type="application/ld+json"]/text()'):
        try:
            visit(json.loads(raw, strict=False))
        except (ValueError, TypeError):
            pass
    for node in tree.xpath('//meta[@content]'):
        key = (node.get("property") or node.get("name") or "").lower()
        if key in ("article:published_time", "datepublished", "date_published"):
            dates.append((key, node.get("content")))
        if key == "article:modified_time":
            modified.append(node.get("content"))
    for node in tree.xpath('//time[@datetime and (@itemprop="datePublished" or contains(concat(" ", normalize-space(@class), " "), " dt-published "))]'):
        dates.append(("time.datePublished", node.get("datetime")))
    # Simon exposes its publication date in the entry footer, not JSON-LD.
    # Scope to the known article footer so related-article dates cannot leak in.
    if url and urlsplit(url).hostname == "simonwillison.net":
        for node in tree.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," entryFooter ")]/a[1]'):
            visible = re.sub(r"(\d+)(st|nd|rd|th)", r"\1", node.text_content().strip())
            try:
                day = datetime.datetime.strptime(visible, "%d %B %Y").date().isoformat()
                dates.append(("entryFooter.published", day))
            except ValueError:
                pass
    normalized = []
    for source, raw in dates:
        try:
            dt = datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=datetime.timezone.utc)
            normalized.append({"source": source, "raw": raw, "value": dt.astimezone(datetime.timezone.utc).isoformat()})
        except (ValueError, TypeError, AttributeError):
            pass
    conflict = len({d["value"][:10] for d in normalized}) > 1
    return {"verified": bool(normalized) and not conflict, "conflict": conflict,
            "published_at": normalized[0]["value"] if normalized else None,
            "updated_at": modified[0] if modified else None, "evidence": normalized}


def extract_article_content(
    html_content: str,
    original_url: Optional[str] = None,
    final_url: Optional[str] = None,
) -> Tuple[Dict[str, Any], List[str]]:
    url = final_url or original_url
    issues: List[str] = []

    # Metadata extraction
    meta = extract_metadata(html_content, default_url=url)
    title = meta.title if meta else None
    author = meta.author if meta else None
    evidence = publication_evidence(html_content, url)
    date = evidence["published_at"]
    if not evidence["verified"]:
        issues.append("date_conflict" if evidence["conflict"] else "date_unknown")

    # Text extraction
    extracted_text = trafilatura.extract(
        html_content,
        url=url,
        include_links=True,
        include_images=True,
        include_formatting=True,
        output_format="markdown",
    )

    if not extracted_text:
        # Fallback to plain text if markdown extraction yielded nothing
        extracted_text = trafilatura.extract(
            html_content,
            url=url,
            output_format="txt",
        )
        if extracted_text:
            issues.append("extracted_as_plain_text")
        else:
            issues.append("extraction_failed")
            extracted_text = ""

    images = extract_images_from_html(html_content, base_url=url)

    completeness = "full" if len(extracted_text.strip()) >= 80 else "summary"
    if not extracted_text.strip():
        completeness = "empty"

    data = {
        "title": title,
        "author": author,
        "published_at": date,
        "updated_at": evidence["updated_at"],
        "date_evidence": evidence,
        "canonical_url": meta.url if meta else url,
        "categories": list(meta.categories or []) if meta else [],
        "text": extracted_text,
        "format": "markdown",
        "completeness": completeness,
        "images": images,
    }
    return data, issues
