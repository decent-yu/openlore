"""Tests for openlore_collectors."""

import json
import subprocess
import sys
import tempfile
from openlore_collectors.web_feed.parser import parse_feed_content
from openlore_collectors.web_page.extractor import extract_article_content

SAMPLE_RSS = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Sample Feed</title>
    <link>https://example.com/</link>
    <description>A test feed</description>
    <item>
      <title>Article One</title>
      <link>https://example.com/article-1</link>
      <guid>https://example.com/article-1</guid>
      <pubDate>Thu, 15 Oct 2026 10:00:00 GMT</pubDate>
      <description>Summary of article one</description>
    </item>
  </channel>
</rss>
"""

SAMPLE_HTML = """<!DOCTYPE html>
<html>
<head><title>Test Article</title></head>
<body>
<article>
  <h1>Test Article Title</h1>
  <p class="author">By Alice</p>
  <p>This is the main body paragraph of our great technical analysis about agents and MCP tools.</p>
  <img src="/images/diagram.png" alt="Architecture Diagram" />
  <p>Conclusion of the test article with plenty of insights and details.</p>
</article>
</body>
</html>
"""


def test_parse_feed():
    data, issues = parse_feed_content(SAMPLE_RSS, "https://example.com/feed.xml")
    assert len(issues) == 0
    assert data["feed"]["title"] == "Sample Feed"
    assert len(data["entries"]) == 1
    entry = data["entries"][0]
    assert entry["title"] == "Article One"
    assert entry["native_id"] == "https://example.com/article-1"
    assert entry["link"] == "https://example.com/article-1"
    assert "Summary of article one" in entry["body"]["value"]


def test_extract_article():
    data, issues = extract_article_content(
        SAMPLE_HTML,
        original_url="https://example.com/post/1",
        final_url="https://example.com/post/1",
    )
    assert "technical analysis" in data["text"]
    assert len(data["images"]) >= 1
    assert data["images"][0]["src"] == "https://example.com/images/diagram.png"
    assert data["images"][0]["alt"] == "Architecture Diagram"


def test_cli_execution():
    with tempfile.NamedTemporaryFile("w+", suffix=".xml") as f:
        f.write(SAMPLE_RSS.decode("utf-8"))
        f.flush()

        req = {
            "protocol_version": 1,
            "job_id": "test-job-1",
            "operation": "parse_feed",
            "input_path": f.name,
            "original_url": "https://example.com/rss",
        }

        res = subprocess.run(
            [sys.executable, "-m", "openlore_collectors"],
            input=json.dumps(req),
            capture_output=True,
            text=True,
        )
        assert res.returncode == 0
        output = json.loads(res.stdout.strip())
        assert output["protocol_version"] == 1
        assert output["job_id"] == "test-job-1"
        assert output["status"] == "success"
        assert len(output["data"]["entries"]) == 1


def test_publication_date_uses_explicit_article_metadata_not_modified_or_related_dates():
    from openlore_collectors.web_page.extractor import publication_evidence
    source = '''<html><head><script type="application/ld+json">{"@type":"BlogPosting","datePublished":"2023-05-10T15:47:15Z","dateModified":"2026-10-13T00:00:00Z"}</script></head><body><p>Related: October 15, 2026</p></body></html>'''
    evidence = publication_evidence(source)
    assert evidence['verified'] is True
    assert evidence['published_at'].startswith('2023-05-10')
    unknown = publication_evidence(source.replace('datePublished', 'unrelatedDate'))
    assert unknown['verified'] is False
    assert unknown['published_at'] is None


def test_conflicting_publication_metadata_is_not_verified():
    from openlore_collectors.web_page.extractor import publication_evidence
    source = '''<html><head><meta property="article:published_time" content="2026-10-13T00:00:00Z"><script type="application/ld+json">{"@type":"Article","datePublished":"2023-05-10T00:00:00Z"}</script></head></html>'''
    assert publication_evidence(source)['conflict'] is True
    assert publication_evidence(source)['verified'] is False


def test_publication_date_accepts_jsonld_with_newlines_in_description():
    from openlore_collectors.web_page.extractor import publication_evidence
    source = '<html><script type="application/ld+json">{"@type":"Article","datePublished":"2026-09-14T13:00:00Z","description":"a\nb"}</script></html>'
    assert publication_evidence(source)['verified'] is True


def test_simon_uses_article_footer_not_related_article_date():
    from openlore_collectors.web_page.extractor import publication_evidence
    source = '<html><div class="entryFooter">Posted <a href="/2026/Oct/14/">14th October 2026</a> at 9:23 pm</div><div class="recent-articles">15th October 2026</div></html>'
    evidence = publication_evidence(source, 'https://simonwillison.net/2026/Oct/14/example/')
    assert evidence['verified'] is True
    assert evidence['published_at'].startswith('2026-10-14')
    assert publication_evidence(source, 'https://example.com/')['verified'] is False
