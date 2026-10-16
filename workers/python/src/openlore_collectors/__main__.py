"""CLI entrypoint for openlore_collectors."""

import json
import os
import sys
import traceback
from openlore_collectors.protocol import (
    WorkerError,
    WorkerRequest,
    WorkerResponse,
)
from openlore_collectors.web_feed.parser import parse_feed_content
from openlore_collectors.web_page.extractor import extract_article_content


def main() -> None:
    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            err_resp = WorkerResponse(
                protocol_version=1,
                job_id="unknown",
                status="failed",
                error=WorkerError(
                    code="empty_input",
                    message="No input provided to collector worker",
                    retryable=False,
                ),
            )
            print(json.dumps(err_resp.to_dict()), file=sys.stdout)
            sys.exit(0)

        req_dict = json.loads(raw_input)
        req = WorkerRequest.from_dict(req_dict)

        if not os.path.exists(req.input_path):
            resp = WorkerResponse(
                protocol_version=req.protocol_version,
                job_id=req.job_id,
                status="failed",
                error=WorkerError(
                    code="file_not_found",
                    message=f"Input file not found: {req.input_path}",
                    retryable=False,
                ),
            )
            print(json.dumps(resp.to_dict()), file=sys.stdout)
            sys.exit(0)

        if req.operation == "parse_feed":
            with open(req.input_path, "rb") as f:
                content_bytes = f.read()
            data, issues = parse_feed_content(
                content_bytes, original_url=req.original_url
            )
            status = "partial" if issues else "success"
            resp = WorkerResponse(
                protocol_version=req.protocol_version,
                job_id=req.job_id,
                status=status,
                data=data,
                issues=issues,
            )
            print(json.dumps(resp.to_dict()), file=sys.stdout)
            sys.exit(0)

        elif req.operation == "extract_article":
            with open(req.input_path, "r", encoding="utf-8", errors="replace") as f:
                html_text = f.read()
            data, issues = extract_article_content(
                html_text,
                original_url=req.original_url,
                final_url=req.final_url,
            )
            status = "partial" if issues else "success"
            resp = WorkerResponse(
                protocol_version=req.protocol_version,
                job_id=req.job_id,
                status=status,
                data=data,
                issues=issues,
            )
            print(json.dumps(resp.to_dict()), file=sys.stdout)
            sys.exit(0)

        else:
            resp = WorkerResponse(
                protocol_version=req.protocol_version,
                job_id=req.job_id,
                status="failed",
                error=WorkerError(
                    code="unsupported_operation",
                    message=f"Operation '{req.operation}' is not supported",
                    retryable=False,
                ),
            )
            print(json.dumps(resp.to_dict()), file=sys.stdout)
            sys.exit(0)

    except Exception as e:
        sys.stderr.write(traceback.format_exc() + "\n")
        resp = WorkerResponse(
            protocol_version=1,
            job_id="unknown",
            status="failed",
            error=WorkerError(
                code="internal_error",
                message=str(e),
                retryable=True,
            ),
        )
        print(json.dumps(resp.to_dict()), file=sys.stdout)
        sys.exit(0)


if __name__ == "__main__":
    main()
